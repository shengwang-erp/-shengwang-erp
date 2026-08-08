import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parse } from '@babel/parser'

const REQUIRED_DEPENDENCIES = Object.freeze({
  '@zxing/browser': '^0.2.1',
  exceljs: '^4.4.0',
  qrcode: '^1.5.4',
})
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
])

function dependencyForSpecifier(value) {
  if (typeof value !== 'string') return null
  return Object.keys(REQUIRED_DEPENDENCIES).find(
    (dependency) => value === dependency || value.startsWith(`${dependency}/`),
  ) ?? null
}

function addPatternBindings(pattern, bindings) {
  if (!pattern || typeof pattern !== 'object') return
  if (pattern.type === 'Identifier') {
    bindings.add(pattern.name)
    return
  }
  if (pattern.type === 'RestElement') {
    addPatternBindings(pattern.argument, bindings)
    return
  }
  if (pattern.type === 'AssignmentPattern') {
    addPatternBindings(pattern.left, bindings)
    return
  }
  if (pattern.type === 'ObjectPattern') {
    for (const property of pattern.properties) {
      addPatternBindings(property.type === 'RestElement' ? property.argument : property.value, bindings)
    }
    return
  }
  if (pattern.type === 'ArrayPattern') {
    for (const element of pattern.elements) addPatternBindings(element, bindings)
  }
}

function collectDirectBindings(statements, bindings) {
  for (const statement of statements ?? []) {
    if (statement.type === 'VariableDeclaration') {
      for (const declaration of statement.declarations) {
        addPatternBindings(declaration.id, bindings)
      }
    } else if (statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') {
      addPatternBindings(statement.id, bindings)
    } else if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) addPatternBindings(specifier.local, bindings)
    } else if (statement.type === 'TSImportEqualsDeclaration') {
      addPatternBindings(statement.id, bindings)
    }
  }
}

function collectFunctionVarBindings(node, bindings) {
  if (!node || typeof node !== 'object') return
  if (
    node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression'
  ) return
  if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const declaration of node.declarations) addPatternBindings(declaration.id, bindings)
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (Array.isArray(value)) {
      for (const child of value) collectFunctionVarBindings(child, bindings)
    } else if (value && typeof value === 'object') {
      collectFunctionVarBindings(value, bindings)
    }
  }
}

function createScope(node, parent) {
  const bindings = new Set()
  if (node.type === 'Program' || node.type === 'BlockStatement') {
    collectDirectBindings(node.body, bindings)
  } else if (
    node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression'
  ) {
    addPatternBindings(node.id, bindings)
    for (const parameter of node.params) addPatternBindings(parameter, bindings)
    collectFunctionVarBindings(node.body, bindings)
  } else if (node.type === 'CatchClause') {
    addPatternBindings(node.param, bindings)
  }
  return { bindings, parent }
}

function createsScope(node) {
  return node.type === 'Program'
    || node.type === 'BlockStatement'
    || node.type === 'FunctionDeclaration'
    || node.type === 'FunctionExpression'
    || node.type === 'ArrowFunctionExpression'
    || node.type === 'CatchClause'
}

function visit(node, parentScope, onNode) {
  if (!node || typeof node !== 'object') return
  const scope = createsScope(node) ? createScope(node, parentScope) : parentScope
  onNode(node, scope)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (Array.isArray(value)) {
      for (const child of value) visit(child, scope, onNode)
    } else if (value && typeof value === 'object') {
      visit(value, scope, onNode)
    }
  }
}

function isUnbound(name, scope) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) return false
  }
  return true
}

function parserPluginsFor(filename) {
  const extension = path.extname(filename)
  if (extension === '.jsx') return ['jsx']
  if (extension === '.tsx') return [['typescript', { isTSX: true }], 'jsx']
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') {
    return [['typescript', {
      disallowAmbiguousJSXLike: extension === '.mts' || extension === '.cts',
    }]]
  }
  return []
}

function callDependency(node) {
  return dependencyForSpecifier(node.arguments?.[0]?.value)
}

function isModuleRequire(callee) {
  return (
    callee?.type === 'MemberExpression'
    || callee?.type === 'OptionalMemberExpression'
  )
    && callee.object?.type === 'Identifier'
    && callee.object.name === 'module'
    && !callee.computed
    && callee.property?.type === 'Identifier'
    && callee.property.name === 'require'
}

async function listProductionSources(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listProductionSources(entryPath))
      continue
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) continue
    files.push(entryPath)
  }
  return files
}

async function main() {
  const root = path.resolve(process.argv[2] ?? process.cwd())
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const violations = []

  for (const [dependency, expectedRange] of Object.entries(REQUIRED_DEPENDENCIES)) {
    const actualRange = manifest.dependencies?.[dependency]
    if (actualRange !== expectedRange) {
      violations.push(
        `package.json: ${dependency} must be a direct dependency with range ${expectedRange}; found ${actualRange ?? 'missing'}`,
      )
    }
  }

  for (const filename of await listProductionSources(path.join(root, 'src'))) {
    const source = await readFile(filename, 'utf8')
    const ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: parserPluginsFor(filename),
    })
    visit(ast, null, (node, scope) => {
      if (
        node.type === 'ImportDeclaration'
        || node.type === 'ExportNamedDeclaration'
        || node.type === 'ExportAllDeclaration'
      ) {
        const dependency = dependencyForSpecifier(node.source?.value)
        if (dependency) {
          violations.push(
            `${path.relative(root, filename)}: static import of ${dependency} is forbidden; use literal dynamic import() from warehouse-owned code`,
          )
        }
      }
      if (
        (node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
        && node.callee?.type === 'Identifier'
        && node.callee.name === 'require'
        && isUnbound('require', scope)
      ) {
        const dependency = callDependency(node)
        if (dependency) {
          const label = node.type === 'OptionalCallExpression'
            ? 'optional static require'
            : 'static require'
          violations.push(
            `${path.relative(root, filename)}: ${label} of ${dependency} is forbidden; use literal dynamic import() from warehouse-owned code`,
          )
        }
      }
      if (
        (node.type === 'CallExpression' || node.type === 'OptionalCallExpression')
        && isModuleRequire(node.callee)
        && isUnbound('module', scope)
      ) {
        const dependency = callDependency(node)
        if (dependency) {
          violations.push(
            `${path.relative(root, filename)}: module.require of ${dependency} is forbidden; use literal dynamic import() from warehouse-owned code`,
          )
        }
      }
      if (
        node.type === 'TSImportEqualsDeclaration'
        && node.moduleReference?.type === 'TSExternalModuleReference'
      ) {
        const dependency = dependencyForSpecifier(node.moduleReference.expression?.value)
        if (dependency) {
          violations.push(
            `${path.relative(root, filename)}: TypeScript import-equals of ${dependency} is forbidden; use literal dynamic import() from warehouse-owned code`,
          )
        }
      }
      if (
        node.type === 'VariableDeclarator'
        && node.init?.type === 'Identifier'
        && node.init.name === 'require'
        && isUnbound('require', scope)
      ) {
        const alias = node.id?.type === 'Identifier' ? node.id.name : '<pattern>'
        violations.push(
          `${path.relative(root, filename)}: require alias ${alias} is forbidden because reassignment cannot prove lazy loading`,
        )
      }
    })
  }

  if (violations.length > 0) {
    process.stderr.write(`${violations.join('\n')}\n`)
    process.exitCode = 1
    return
  }

  process.stdout.write('Warehouse lazy dependency boundary verified.\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`)
  process.exitCode = 1
})

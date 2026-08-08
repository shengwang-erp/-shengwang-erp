import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parse } from '@babel/parser'

const REQUIRED_DEPENDENCIES = Object.freeze({
  '@zxing/browser': '^0.2.1',
  exceljs: '^4.4.0',
  qrcode: '^1.5.4',
})
const REQUIRED_OWNED_QR_CALLSITES = Object.freeze({
  '@zxing/browser': 'src/features/warehouse/WarehouseQrScanner.jsx',
  qrcode: 'src/features/warehouse/WarehouseLabelSheet.jsx',
})
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs',
  '.ts', '.tsx', '.mts', '.cts',
])
const FUNCTION_SCOPE_TYPES = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
  'TSDeclareFunction',
  'TSDeclareMethod',
  'TSFunctionType',
  'TSMethodSignature',
  'TSCallSignatureDeclaration',
  'TSConstructSignatureDeclaration',
  'TSConstructorType',
])
const LOOP_SCOPE_TYPES = new Set(['ForStatement', 'ForInStatement', 'ForOfStatement'])
const CLASS_SCOPE_TYPES = new Set(['ClassDeclaration', 'ClassExpression'])
const TS_MODULE_SCOPE_TYPES = new Set(['TSModuleDeclaration', 'TSModuleBlock'])

function dependencyForSpecifier(value) {
  if (typeof value !== 'string') return null
  return Object.keys(REQUIRED_DEPENDENCIES).find(
    (dependency) => value === dependency || value.startsWith(`${dependency}/`),
  ) ?? null
}

function addPatternBindings(pattern, bindings) {
  if (!pattern || typeof pattern !== 'object') return
  if (pattern.type === 'TSParameterProperty') {
    addPatternBindings(pattern.parameter, bindings)
    return
  }
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

function declarationInside(statement) {
  if (
    statement?.type === 'ExportNamedDeclaration'
    || statement?.type === 'ExportDefaultDeclaration'
  ) return statement.declaration
  return statement
}

function collectDirectBindings(statements, bindings) {
  for (const statement of statements ?? []) {
    const declarationNode = declarationInside(statement)
    if (!declarationNode) continue
    if (declarationNode.type === 'VariableDeclaration') {
      for (const declaration of declarationNode.declarations) {
        addPatternBindings(declaration.id, bindings)
      }
    } else if (
      declarationNode.type === 'FunctionDeclaration'
      || declarationNode.type === 'ClassDeclaration'
      || declarationNode.type === 'TSDeclareFunction'
      || declarationNode.type === 'TSModuleDeclaration'
    ) {
      addPatternBindings(declarationNode.id, bindings)
    } else if (declarationNode.type === 'ImportDeclaration') {
      for (const specifier of declarationNode.specifiers) {
        addPatternBindings(specifier.local, bindings)
      }
    } else if (declarationNode.type === 'TSImportEqualsDeclaration') {
      addPatternBindings(declarationNode.id, bindings)
    }
  }
}

function collectFunctionVarBindings(node, bindings) {
  if (!node || typeof node !== 'object') return
  if (
    FUNCTION_SCOPE_TYPES.has(node.type)
    || CLASS_SCOPE_TYPES.has(node.type)
    || node.type === 'StaticBlock'
    || TS_MODULE_SCOPE_TYPES.has(node.type)
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
  if (node.type === 'Program') {
    collectDirectBindings(node.body, bindings)
    collectFunctionVarBindings(node, bindings)
  } else if (node.type === 'BlockStatement') {
    collectDirectBindings(node.body, bindings)
  } else if (node.type === 'StaticBlock' || node.type === 'TSModuleBlock') {
    collectDirectBindings(node.body, bindings)
    for (const child of node.body) collectFunctionVarBindings(child, bindings)
  } else if (CLASS_SCOPE_TYPES.has(node.type) || node.type === 'TSModuleDeclaration') {
    addPatternBindings(node.id, bindings)
  } else if (node.type === 'CatchClause') {
    addPatternBindings(node.param, bindings)
  } else if (LOOP_SCOPE_TYPES.has(node.type)) {
    const declaration = node.type === 'ForStatement' ? node.init : node.left
    if (declaration?.type === 'VariableDeclaration') {
      for (const item of declaration.declarations) addPatternBindings(item.id, bindings)
    }
  } else if (node.type === 'SwitchStatement') {
    collectDirectBindings(
      node.cases.flatMap((switchCase) => switchCase.consequent),
      bindings,
    )
  }
  return { bindings, parent }
}

function createsScope(node) {
  return node.type === 'Program'
    || node.type === 'BlockStatement'
    || node.type === 'StaticBlock'
    || CLASS_SCOPE_TYPES.has(node.type)
    || TS_MODULE_SCOPE_TYPES.has(node.type)
    || LOOP_SCOPE_TYPES.has(node.type)
    || node.type === 'SwitchStatement'
    || node.type === 'CatchClause'
}

function createFunctionParameterScope(node, parent) {
  const bindings = new Set()
  addPatternBindings(node.id, bindings)
  for (const parameter of node.params ?? node.parameters ?? []) {
    addPatternBindings(parameter, bindings)
  }
  return { bindings, parent }
}

function createFunctionBodyScope(node, parameterScope) {
  const bindings = new Set()
  collectFunctionVarBindings(node.body, bindings)
  return { bindings, parent: parameterScope }
}

function visit(node, parentScope, onNode) {
  if (!node || typeof node !== 'object') return
  if (FUNCTION_SCOPE_TYPES.has(node.type)) {
    const parameterScope = createFunctionParameterScope(node, parentScope)
    const bodyScope = createFunctionBodyScope(node, parameterScope)
    onNode(node, parameterScope)
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue
      const childScope = key === 'key' || key === 'decorators'
        ? parentScope
        : key === 'body'
          ? bodyScope
          : parameterScope
      if (Array.isArray(value)) {
        for (const child of value) visit(child, childScope, onNode)
      } else if (value && typeof value === 'object') {
        visit(value, childScope, onNode)
      }
    }
    return
  }
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
  const ownedQrCallsites = new Set()

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
      if (node.type === 'CallExpression' && node.callee?.type === 'Import') {
        const dependency = dependencyForSpecifier(node.arguments?.[0]?.value)
        const relativeFilename = path.relative(root, filename).split(path.sep).join('/')
        if (REQUIRED_OWNED_QR_CALLSITES[dependency] === relativeFilename) {
          ownedQrCallsites.add(dependency)
        }
      }
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
      if (
        node.type === 'AssignmentPattern'
        && node.right?.type === 'Identifier'
        && node.right.name === 'require'
        && isUnbound('require', scope)
      ) {
        const aliases = new Set()
        addPatternBindings(node.left, aliases)
        violations.push(
          `${path.relative(root, filename)}: parameter require alias ${[...aliases].join(', ') || '<pattern>'} is forbidden because parameter initialization cannot prove lazy loading`,
        )
      }
      if (
        node.type === 'AssignmentPattern'
        && isModuleRequire(node.right)
        && isUnbound('module', scope)
      ) {
        const aliases = new Set()
        addPatternBindings(node.left, aliases)
        violations.push(
          `${path.relative(root, filename)}: parameter module.require alias ${[...aliases].join(', ') || '<pattern>'} is forbidden because parameter initialization cannot prove lazy loading`,
        )
      }
    })
  }

  for (const [dependency, filename] of Object.entries(REQUIRED_OWNED_QR_CALLSITES)) {
    if (!ownedQrCallsites.has(dependency)) {
      violations.push(
        `${filename}: missing literal dynamic import() of ${dependency} in the real warehouse-owned module`,
      )
    }
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

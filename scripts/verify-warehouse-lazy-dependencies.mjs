import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { parse } from '@babel/parser'

const REQUIRED_DEPENDENCIES = Object.freeze({
  '@zxing/browser': '^0.2.1',
  exceljs: '^4.4.0',
  qrcode: '^1.5.4',
})
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])

function dependencyForSpecifier(value) {
  if (typeof value !== 'string') return null
  return Object.keys(REQUIRED_DEPENDENCIES).find(
    (dependency) => value === dependency || value.startsWith(`${dependency}/`),
  ) ?? null
}

function visit(node, onNode) {
  if (!node || typeof node !== 'object') return
  onNode(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end') continue
    if (Array.isArray(value)) {
      for (const child of value) visit(child, onNode)
    } else if (value && typeof value === 'object') {
      visit(value, onNode)
    }
  }
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
      plugins: ['jsx', 'typescript'],
    })
    visit(ast, (node) => {
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
        node.type === 'CallExpression'
        && node.callee?.type === 'Identifier'
        && node.callee.name === 'require'
      ) {
        const dependency = dependencyForSpecifier(node.arguments?.[0]?.value)
        if (dependency) {
          violations.push(
            `${path.relative(root, filename)}: static require of ${dependency} is forbidden; use literal dynamic import() from warehouse-owned code`,
          )
        }
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

import { parse } from '@babel/parser'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const CLASSIFICATION_NAMES = Object.freeze(['pureCopy', 'adapt', 'rewrite'])
const MANIFEST_ARRAY_NAMES = Object.freeze([...CLASSIFICATION_NAMES, 'forbidden'])
const MODULE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs'])

function fail(message) {
  throw new Error(message)
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function toRepoPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join('/')
}

function resolveInside(root, relativePath, escapeMessage) {
  if (typeof relativePath !== 'string' || relativePath.length === 0 || path.isAbsolute(relativePath)) {
    fail(escapeMessage)
  }
  const absolutePath = path.resolve(root, relativePath)
  if (!isInside(root, absolutePath)) fail(escapeMessage)
  return absolutePath
}

async function realDirectory(directory, label) {
  let resolved
  try {
    resolved = await realpath(path.resolve(directory))
  } catch {
    fail(`Missing ${label} root: ${directory}`)
  }
  if (!(await stat(resolved)).isDirectory()) fail(`Missing ${label} root: ${directory}`)
  return resolved
}

async function realFile(lexicalPath, root, missingMessage, escapeMessage) {
  let resolved
  try {
    resolved = await realpath(lexicalPath)
  } catch {
    fail(missingMessage)
  }
  if (!isInside(root, resolved)) fail(escapeMessage)
  if (!(await stat(resolved)).isFile()) fail(missingMessage)
  return resolved
}

function parseArguments(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--audit-source') {
      if (options.mode) fail('Choose exactly one audit mode')
      options.mode = 'source'
      continue
    }
    if (argument === '--audit-destination') {
      if (options.mode) fail('Choose exactly one audit mode')
      options.mode = 'destination'
      continue
    }
    if (['--manifest', '--source-root', '--destination-root', '--destination-stage'].includes(argument)) {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) fail(`Missing value for ${argument}`)
      options[argument.slice(2).replaceAll('-', '_')] = value
      index += 1
      continue
    }
    fail(`Unknown argument: ${argument}`)
  }

  if (!options.mode) fail('Choose exactly one audit mode')
  if (!options.manifest) fail('Missing value for --manifest')
  if (options.mode === 'source' && !options.source_root) fail('Missing value for --source-root')
  if (options.mode === 'destination' && !options.destination_root) {
    fail('Missing value for --destination-root')
  }
  return options
}

async function loadManifest(manifestPath) {
  const source = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(source)
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Manifest must be an object')
  }
  const keys = Object.keys(manifest)
  for (const name of MANIFEST_ARRAY_NAMES) {
    if (!Array.isArray(manifest[name])) fail(`Manifest field must be an array: ${name}`)
  }
  const unexpected = keys.filter((key) => !MANIFEST_ARRAY_NAMES.includes(key))
  if (unexpected.length > 0) fail(`Unexpected manifest field: ${unexpected[0]}`)

  for (const name of CLASSIFICATION_NAMES) {
    for (const entry of manifest[name]) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        fail(`Invalid ${name} entry`)
      }
      if (typeof entry.id !== 'string' || entry.id.length === 0) fail(`Missing ${name} id`)
      if (Boolean(entry.source) === Boolean(entry.reference)) {
        fail(`Entry must declare exactly one source or reference: ${entry.id}`)
      }
      if (typeof entry.destination !== 'string' || entry.destination.length === 0) {
        fail(`Missing destination: ${entry.id}`)
      }
      if (!['warehouse', 'adapter'].includes(entry.destinationKind)) {
        fail(`Invalid destination kind: ${entry.id}`)
      }
      if (typeof entry.destinationStage !== 'string' || entry.destinationStage.length === 0) {
        fail(`Missing destination stage: ${entry.id}`)
      }
    }
  }
  for (const entry of manifest.forbidden) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail('Invalid forbidden entry')
    if (typeof entry.dependency !== 'string' || entry.dependency.length === 0) {
      fail('Missing forbidden dependency')
    }
    if (!['module', 'runtime'].includes(entry.dependencyKind)) {
      fail(`Invalid forbidden dependency kind: ${entry.dependency}`)
    }
    if (entry.scope && !['source', 'destination', 'all'].includes(entry.scope)) {
      fail(`Invalid forbidden dependency scope: ${entry.dependency}`)
    }
    if (typeof entry.destinationStage !== 'string' || entry.destinationStage.length === 0) {
      fail(`Missing destination stage: ${entry.dependency}`)
    }
  }
  return manifest
}

function classificationEntries(manifest) {
  return CLASSIFICATION_NAMES.flatMap((classification) => (
    manifest[classification].map((entry) => ({ ...entry, classification }))
  ))
}

function stringLiteralValue(node) {
  if (node?.type === 'StringLiteral') return node.value
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
  return null
}

function isBrowserGlobal(node) {
  return node?.type === 'Identifier' && ['globalThis', 'window', 'self'].includes(node.name)
}

function walkAst(node, visitor, parent = null, parentKey = '') {
  if (!node || typeof node !== 'object') return
  visitor(node, parent, parentKey)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue
    if (Array.isArray(value)) {
      for (const child of value) walkAst(child, visitor, node, key)
    } else if (value && typeof value === 'object') {
      walkAst(value, visitor, node, key)
    }
  }
}

function resolveStaticString(node, stringConstants) {
  const literal = stringLiteralValue(node)
  if (literal !== null) return literal
  if (node?.type === 'Identifier') return stringConstants.get(node.name) ?? null
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = resolveStaticString(node.left, stringConstants)
    const right = resolveStaticString(node.right, stringConstants)
    if (left !== null && right !== null) return left + right
  }
  return null
}

function resolvesToBrowserGlobal(node, browserGlobalConstants) {
  return isBrowserGlobal(node) || (
    node?.type === 'Identifier' && browserGlobalConstants.has(node.name)
  )
}

function resolveConstBindings(ast) {
  const bindings = new Map()
  walkAst(ast, (node, parent) => {
    if (
      node.type === 'VariableDeclarator'
      && parent?.type === 'VariableDeclaration'
      && parent.kind === 'const'
      && node.id?.type === 'Identifier'
    ) {
      bindings.set(node.id.name, node.init)
    }
  })

  const stringConstants = new Map()
  const browserGlobalConstants = new Set()
  let changed = true
  while (changed) {
    changed = false
    for (const [name, initializer] of bindings) {
      if (!stringConstants.has(name)) {
        const value = resolveStaticString(initializer, stringConstants)
        if (value !== null) {
          stringConstants.set(name, value)
          changed = true
        }
      }
      if (
        !browserGlobalConstants.has(name)
        && resolvesToBrowserGlobal(initializer, browserGlobalConstants)
      ) {
        browserGlobalConstants.add(name)
        changed = true
      }
    }
  }
  return { stringConstants, browserGlobalConstants }
}

function propertyNamesLocalStorage(property, stringConstants) {
  if (!property) return false
  if (!property.computed && property.key?.type === 'Identifier') {
    return property.key.name === 'localStorage'
  }
  const literal = stringLiteralValue(property.key)
  if (literal !== null) return literal === 'localStorage'
  return (
    property.computed
    && property.key?.type === 'Identifier'
    && stringConstants.get(property.key.name) === 'localStorage'
  )
}

function isLocalStorageReference(
  node,
  parent,
  parentKey,
  stringConstants,
  browserGlobalConstants,
) {
  if (
    node.type === 'VariableDeclarator'
    && node.id?.type === 'ObjectPattern'
    && resolvesToBrowserGlobal(node.init, browserGlobalConstants)
  ) {
    return node.id.properties.some((property) => propertyNamesLocalStorage(property, stringConstants))
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const property = node.property
    if (!node.computed) {
      return property?.type === 'Identifier' && property.name === 'localStorage'
    }
    if (!resolvesToBrowserGlobal(node.object, browserGlobalConstants)) return false
    const propertyName = resolveStaticString(property, stringConstants)
    return propertyName === null || propertyName === 'localStorage'
  }
  if (node.type !== 'Identifier' || node.name !== 'localStorage') return false
  if (
    (parent?.type === 'MemberExpression' || parent?.type === 'OptionalMemberExpression')
    && parentKey === 'property'
    && !parent.computed
  ) return false
  if (
    (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod')
    && parentKey === 'key'
    && !parent.computed
  ) return false
  return true
}

function analyzeModule(source, file) {
  let ast
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['jsx', 'dynamicImport'],
      createImportExpressions: true,
    })
  } catch (error) {
    fail(`Parse failure: ${file}: ${error.message}`)
  }

  const dependencies = []
  const unresolvedDependencies = []
  const { stringConstants, browserGlobalConstants } = resolveConstBindings(ast)
  let usesLocalStorage = false
  walkAst(ast, (node, parent, parentKey) => {
    if (
      node.type === 'ImportDeclaration'
      || node.type === 'ExportNamedDeclaration'
      || node.type === 'ExportAllDeclaration'
    ) {
      const value = stringLiteralValue(node.source)
      if (value !== null) dependencies.push(value)
    } else if (node.type === 'ImportExpression') {
      const value = stringLiteralValue(node.source)
      if (value !== null) {
        dependencies.push(value)
      } else {
        unresolvedDependencies.push(
          node.source?.type === 'TemplateLiteral' ? 'import(<template>)' : 'import(<non-literal>)',
        )
      }
    } else if (
      node.type === 'CallExpression'
      && (
        node.callee?.type === 'Import'
        || (node.callee?.type === 'Identifier' && node.callee.name === 'require')
      )
    ) {
      const value = stringLiteralValue(node.arguments?.[0])
      if (value !== null) {
        dependencies.push(value)
      } else {
        const name = node.callee?.type === 'Import' ? 'import' : 'require'
        const argument = node.arguments?.[0]
        unresolvedDependencies.push(
          argument?.type === 'TemplateLiteral' ? `${name}(<template>)` : `${name}(<non-literal>)`,
        )
      }
    }
    if (
      isLocalStorageReference(
        node,
        parent,
        parentKey,
        stringConstants,
        browserGlobalConstants,
      )
    ) usesLocalStorage = true

  })
  return {
    dependencies: [...new Set(dependencies)],
    unresolvedDependencies: [...new Set(unresolvedDependencies)],
    usesLocalStorage,
  }
}

async function readModule(absolutePath, relativePath) {
  const extension = path.extname(absolutePath)
  if (!MODULE_EXTENSIONS.has(extension)) {
    return { dependencies: [], unresolvedDependencies: [], usesLocalStorage: false }
  }
  const source = await readFile(absolutePath, 'utf8')
  return analyzeModule(source, relativePath)
}

function appliesToAudit(entry, auditScope) {
  return !entry.scope || entry.scope === 'all' || entry.scope === auditScope
}

function moduleForbiddenSet(manifest, auditScope) {
  return new Set(
    manifest.forbidden
      .filter((entry) => entry.dependencyKind === 'module' && appliesToAudit(entry, auditScope))
      .map((entry) => entry.dependency),
  )
}

function localStorageIsForbidden(manifest, auditScope) {
  return manifest.forbidden.some((entry) => (
    entry.dependencyKind === 'runtime'
    && entry.dependency === 'localStorage'
    && appliesToAudit(entry, auditScope)
  ))
}

async function auditSource(manifest, sourceRootValue) {
  const sourceRoot = await realDirectory(sourceRootValue, 'source')
  const warehouseRootPath = path.resolve(sourceRoot, 'src/features/warehouse')
  let warehouseRoot
  const entries = classificationEntries(manifest)
  const sourceEntries = entries.filter((entry) => entry.source)
  const sourceClassifications = new Map()
  const analyses = new Map()

  for (const entry of sourceEntries) {
    const sourcePath = resolveInside(
      sourceRoot,
      entry.source,
      `Source path must stay under src/features/warehouse/: ${entry.source}`,
    )
    if (!isInside(warehouseRootPath, sourcePath)) {
      fail(`Source path must stay under src/features/warehouse/: ${entry.source}`)
    }
    if (sourceClassifications.has(entry.source)) fail(`Duplicate source: ${entry.source}`)
    sourceClassifications.set(entry.source, entry.classification)
    const realSourcePath = await realFile(
      sourcePath,
      sourceRoot,
      `Missing source: ${entry.source}`,
      `Source path escapes source root: ${entry.source}`,
    )
    if (!warehouseRoot) {
      try {
        warehouseRoot = await realpath(warehouseRootPath)
      } catch {
        fail(`Missing source: ${entry.source}`)
      }
    }
    if (!isInside(warehouseRoot, realSourcePath)) {
      fail(`Source path must stay under src/features/warehouse/: ${entry.source}`)
    }
    analyses.set(entry.source, await readModule(realSourcePath, entry.source))
  }

  for (const entry of entries.filter((candidate) => candidate.reference)) {
    const referencePath = resolveInside(
      sourceRoot,
      entry.reference,
      `Reference path escapes source root: ${entry.reference}`,
    )
    await realFile(
      referencePath,
      sourceRoot,
      `Missing reference: ${entry.reference}`,
      `Reference path escapes source root: ${entry.reference}`,
    )
  }

  const forbiddenModules = moduleForbiddenSet(manifest, 'source')
  const rewriteEdges = []
  for (const entry of manifest.pureCopy) {
    const analysis = analyses.get(entry.source)
    if (analysis.unresolvedDependencies.length > 0) {
      fail(
        `Unresolved dynamic dependency: ${entry.source} -> ${analysis.unresolvedDependencies[0]}`,
      )
    }
    if (analysis.usesLocalStorage && localStorageIsForbidden(manifest, 'source')) {
      fail(`Forbidden runtime dependency: ${entry.source} -> localStorage`)
    }
    const sourcePath = path.resolve(sourceRoot, entry.source)
    for (const specifier of analysis.dependencies) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/src/')) {
        fail(`Pure-copy dependency must be warehouse-local: ${entry.source} -> ${specifier}`)
      }
      const unresolvedDependencyPath = specifier.startsWith('/src/')
        ? path.resolve(sourceRoot, specifier.slice(1))
        : path.resolve(path.dirname(sourcePath), specifier)
      if (!isInside(warehouseRootPath, unresolvedDependencyPath)) {
        const dependency = isInside(sourceRoot, unresolvedDependencyPath)
          ? toRepoPath(sourceRoot, unresolvedDependencyPath)
          : specifier
        if (forbiddenModules.has(dependency)) {
          fail(`Forbidden dependency: ${entry.source} -> ${dependency}`)
        }
        fail(`Pure-copy dependency must be warehouse-local: ${entry.source} -> ${specifier}`)
      }
      const dependencyPath = await resolveDependencyFile(unresolvedDependencyPath)
      const dependency = toRepoPath(sourceRoot, dependencyPath)
      const realDependencyPath = await realFile(
        dependencyPath,
        sourceRoot,
        `Missing pure-copy dependency: ${entry.source} -> ${dependency}`,
        `Dependency path escapes source root: ${entry.source} -> ${dependency}`,
      )
      if (!isInside(warehouseRoot, realDependencyPath)) {
        fail(`Pure-copy dependency must be warehouse-local: ${entry.source} -> ${dependency}`)
      }
      const classification = sourceClassifications.get(dependency)
      if (!classification) fail(`Unclassified pure-copy dependency: ${entry.source} -> ${dependency}`)
      if (classification === 'rewrite') rewriteEdges.push(`${entry.source} -> ${dependency}`)
    }
  }

  rewriteEdges.sort()
  const edgeSummary = rewriteEdges.length > 0 ? rewriteEdges.join(', ') : 'none'
  console.log(
    `Source audit passed: ${sourceEntries.length} source modules; rewrite edges: ${edgeSummary}`,
  )
}

async function resolveDependencyFile(basePath) {
  const candidates = [
    basePath,
    ...[...MODULE_EXTENSIONS].map((extension) => `${basePath}${extension}`),
    ...[...MODULE_EXTENSIONS].map((extension) => path.join(basePath, `index${extension}`)),
  ]
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate
    } catch {
      // Continue through the deterministic resolution candidates.
    }
  }
  return basePath
}

async function validateDestinationRealPath(destination, realDestinationPath, warehouseRoot) {
  const { entry, destinationPath } = destination
  if (entry.destinationKind === 'adapter') {
    if (realDestinationPath !== destinationPath) {
      fail(`Adapter destination realpath must match declared path: ${entry.destination}`)
    }
    return
  }

  let realWarehouseRoot
  try {
    realWarehouseRoot = await realpath(warehouseRoot)
  } catch {
    fail(`Warehouse destination realpath must stay under src/features/warehouse/: ${entry.destination}`)
  }
  if (realWarehouseRoot !== warehouseRoot || !isInside(realWarehouseRoot, realDestinationPath)) {
    fail(`Warehouse destination realpath must stay under src/features/warehouse/: ${entry.destination}`)
  }
}

async function auditDestination(manifest, destinationRootValue, destinationStage) {
  const destinationRoot = await realDirectory(destinationRootValue, 'destination')
  const warehouseRoot = path.resolve(destinationRoot, 'src/features/warehouse')
  const entries = classificationEntries(manifest)
  const destinations = new Map()

  for (const entry of entries) {
    const destinationPath = resolveInside(
      destinationRoot,
      entry.destination,
      `Destination path escapes destination root: ${entry.destination}`,
    )
    if (entry.destinationKind === 'warehouse' && !isInside(warehouseRoot, destinationPath)) {
      fail(`Warehouse destination must stay under src/features/warehouse/: ${entry.destination}`)
    }
    if (destinations.has(entry.destination)) fail(`Duplicate destination: ${entry.destination}`)
    destinations.set(entry.destination, { entry, destinationPath })
  }

  const selected = entries.filter((entry) => (
    destinationStage ? entry.destinationStage === destinationStage : true
  ))
  if (selected.length === 0) {
    fail(`No destinations selected${destinationStage ? ` for stage ${destinationStage}` : ''}`)
  }
  for (const entry of selected) {
    const destination = destinations.get(entry.destination)
    destination.realDestinationPath = await realFile(
      destination.destinationPath,
      destinationRoot,
      `Missing destination: ${entry.destination}`,
      `Destination path escapes destination root: ${entry.destination}`,
    )
    await validateDestinationRealPath(destination, destination.realDestinationPath, warehouseRoot)
  }

  const forbiddenModules = moduleForbiddenSet(manifest, 'destination')
  const rejectLocalStorage = localStorageIsForbidden(manifest, 'destination')
  const queue = selected.map((entry) => entry.destination)
  const visited = new Set()
  while (queue.length > 0) {
    const current = queue.shift()
    if (visited.has(current)) continue
    visited.add(current)
    const destination = destinations.get(current)
    const { destinationPath } = destination
    if (!destination.realDestinationPath) {
      destination.realDestinationPath = await realFile(
        destinationPath,
        destinationRoot,
        `Missing destination: ${current}`,
        `Destination path escapes destination root: ${current}`,
      )
      await validateDestinationRealPath(destination, destination.realDestinationPath, warehouseRoot)
    }
    const analysis = await readModule(destination.realDestinationPath, current)
    if (analysis.unresolvedDependencies.length > 0) {
      fail(
        `Unresolved dynamic dependency: ${current} -> ${analysis.unresolvedDependencies[0]}`,
      )
    }
    if (analysis.usesLocalStorage && rejectLocalStorage) {
      fail(`Forbidden runtime dependency: ${current} -> localStorage`)
    }
    for (const specifier of analysis.dependencies) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue
      if (specifier.startsWith('/') && !specifier.startsWith('/src/')) {
        fail(`Path escape: ${current} -> ${specifier}`)
      }
      const unresolvedPath = specifier.startsWith('/src/')
        ? path.resolve(destinationRoot, specifier.slice(1))
        : path.resolve(path.dirname(destinationPath), specifier)
      if (!isInside(destinationRoot, unresolvedPath)) fail(`Path escape: ${current} -> ${specifier}`)
      const dependencyPath = await resolveDependencyFile(unresolvedPath)
      const dependency = toRepoPath(destinationRoot, dependencyPath)
      if (forbiddenModules.has(dependency)) {
        fail(`Forbidden dependency: ${current} -> ${dependency}`)
      }
      if (!destinations.has(dependency)) fail(`Undeclared dependency: ${current} -> ${dependency}`)
      const realDependencyPath = await realFile(
        dependencyPath,
        destinationRoot,
        `Missing dependency: ${current} -> ${dependency}`,
        `Dependency path escapes destination root: ${current} -> ${dependency}`,
      )
      const dependencyDestination = destinations.get(dependency)
      await validateDestinationRealPath(dependencyDestination, realDependencyPath, warehouseRoot)
      dependencyDestination.realDestinationPath = realDependencyPath
      queue.push(dependency)
    }
  }

  console.log(
    `Destination audit passed: ${visited.size} modules${destinationStage ? ` for stage ${destinationStage}` : ''}`,
  )
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const manifest = await loadManifest(path.resolve(options.manifest))
  if (options.mode === 'source') {
    await auditSource(manifest, options.source_root)
  } else {
    await auditDestination(manifest, options.destination_root, options.destination_stage)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

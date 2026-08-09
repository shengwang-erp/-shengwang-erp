import { execFileSync } from 'node:child_process'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

export const DEFAULT_BASELINE = '9774158'
export const DEFAULT_SOURCE_ROOT = '/Users/yu/Documents/亚马逊请求书/.worktrees/warehouse-management'

const FORBIDDEN_CHANGED_PATHS = new Set([
  'src/services/authSessionService.js',
  'src/services/sessionOperationFence.js',
  'src/services/cloudPersistenceCoordinator.js',
  'src/services/baseRecordService.js',
  'src/services/recordTableConfig.js',
  'src/services/recordPersistenceOperation.js',
  'src/services/warehouseLocalRequestStore.js',
  'src/lib/supabaseClient.js',
  'src/features/warehouse/warehousePersistence.js',
])

const FORBIDDEN_WAREHOUSE_TOKENS = Object.freeze([
  'authSessionService',
  'sessionOperationFence',
  'cloudPersistenceCoordinator',
  'baseRecordService',
  'recordTableConfig',
  'recordPersistenceOperation',
  'warehouseLocalRequestStore',
  'warehousePersistence',
  'commitStockIn',
  'commitPurchaseStockInMutation',
  'mergeInventoryItem',
  'localStorage',
])

function fail(message) {
  throw new Error(message)
}

function normalizeRepoPath(value) {
  return value.split(path.sep).join('/')
}

function command(root, executable, args) {
  return execFileSync(executable, args, { cwd: root, encoding: 'utf8' }).trim()
}

function parseArguments(argv) {
  const options = { baseline: DEFAULT_BASELINE, sourceRoot: DEFAULT_SOURCE_ROOT }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (!['--baseline', '--source-root'].includes(argument)) fail(`Unknown argument: ${argument}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) fail(`Missing value for ${argument}`)
    if (argument === '--baseline') options.baseline = value
    else options.sourceRoot = value
    index += 1
  }
  return options
}

export function forbiddenChangedPaths(changedPaths) {
  return changedPaths.filter((file) => (
    FORBIDDEN_CHANGED_PATHS.has(file)
    || file === 'vercel.json'
    || file.startsWith('.vercel/')
    || /^\.env(?:\.|$)/u.test(file)
    || file.includes('ERP第一版备份')
  ))
}

export function forbiddenTokensInContent(file, content) {
  const hits = FORBIDDEN_WAREHOUSE_TOKENS.filter((token) => content.includes(token))
  if (file === 'src/App.jsx' && /\b(?:purchaseService\.)?commitStockIn\s*\(/u.test(content)) {
    hits.push('App commitStockIn call')
  }
  return [...new Set(hits)]
}

async function productionWarehouseFiles(root) {
  const warehouseRoot = path.join(root, 'src/features/warehouse')
  const result = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) fail(`Warehouse production path must not be a symlink: ${normalizeRepoPath(path.relative(root, absolute))}`)
      if (entry.isDirectory()) {
        await visit(absolute)
        continue
      }
      if (!entry.isFile() || !/\.(?:js|jsx|mjs|css)$/u.test(entry.name)) continue
      if (entry.name.includes('.test.') || entry.name === 'warehouseReactDomTestUtils.js') continue
      result.push(absolute)
    }
  }
  await visit(warehouseRoot)
  for (const service of [
    'src/services/warehouseService.js',
    'src/services/warehouseConfirmationService.js',
    'src/services/warehouseMediaService.js',
  ]) result.push(path.join(root, service))
  return result
}

async function assertNoForbiddenRuntime(root) {
  const violations = []
  for (const absolute of await productionWarehouseFiles(root)) {
    const file = normalizeRepoPath(path.relative(root, absolute))
    const content = await readFile(absolute, 'utf8')
    for (const token of forbiddenTokensInContent(file, content)) violations.push(`${file}: ${token}`)
  }
  const appPath = path.join(root, 'src/App.jsx')
  const app = await readFile(appPath, 'utf8')
  if (/\b(?:purchaseService\.)?commitStockIn\s*\(/u.test(app)) {
    violations.push('src/App.jsx: App commitStockIn call')
  }
  if (violations.length > 0) fail(`Forbidden warehouse runtime dependency:\n${violations.join('\n')}`)
}

async function assertNoByteCopiedSharedFiles(root, sourceRoot, baseline, changedPaths) {
  const sourceReal = await realpath(sourceRoot)
  if (!(await lstat(sourceReal)).isDirectory()) fail(`Warehouse source root is not a directory: ${sourceRoot}`)
  const copied = []
  for (const file of changedPaths) {
    if (!file.startsWith('src/') || file.startsWith('src/features/warehouse/')) continue
    const destination = path.join(root, file)
    const source = path.join(sourceReal, file)
    try {
      const [destinationStat, sourceStat] = await Promise.all([lstat(destination), lstat(source)])
      if (!destinationStat.isFile() || !sourceStat.isFile()) continue
      const [destinationBytes, sourceBytes] = await Promise.all([readFile(destination), readFile(source)])
      if (destinationBytes.equals(sourceBytes)) copied.push(file)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  const manifest = JSON.parse(await readFile(path.join(root, 'docs/warehouse-forward-port-manifest.json'), 'utf8'))
  for (const entry of [...manifest.adapt, ...manifest.rewrite]) {
    const sourcePath = entry.source || entry.reference
    if (!sourcePath) continue
    try {
      const [destinationBytes, sourceBytes] = await Promise.all([
        readFile(path.join(root, entry.destination)),
        readFile(path.join(sourceReal, sourcePath)),
      ])
      if (destinationBytes.equals(sourceBytes)) copied.push(`${entry.destination} (${entry.id})`)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  if (copied.length > 0) {
    fail(`Source shared/adapted file was copied byte-for-byte after ${baseline}:\n${[...new Set(copied)].join('\n')}`)
  }
}

export async function verifyWarehouseForwardPort({
  root = path.resolve(fileURLToPath(new URL('../', import.meta.url))),
  baseline = DEFAULT_BASELINE,
  sourceRoot = DEFAULT_SOURCE_ROOT,
} = {}) {
  command(root, 'git', ['rev-parse', '--verify', `${baseline}^{commit}`])
  try {
    command(root, 'git', ['merge-base', '--is-ancestor', baseline, 'HEAD'])
  } catch {
    fail(`Warehouse baseline is not an ancestor of HEAD: ${baseline}`)
  }
  const changed = command(root, 'git', ['diff', '--name-only', baseline])
    .split('\n').filter(Boolean)
  const untracked = command(root, 'git', ['ls-files', '--others', '--exclude-standard'])
    .split('\n').filter(Boolean)
  const changedPaths = [...new Set([...changed, ...untracked])].sort()
  const forbidden = forbiddenChangedPaths(changedPaths)
  if (forbidden.length > 0) fail(`Forbidden migration path changed:\n${forbidden.join('\n')}`)
  await assertNoForbiddenRuntime(root)
  await assertNoByteCopiedSharedFiles(root, sourceRoot, baseline, changedPaths)
  return Object.freeze({ baseline, changedPathCount: changedPaths.length, forbiddenCount: 0 })
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const result = await verifyWarehouseForwardPort(parseArguments(process.argv.slice(2)))
    process.stdout.write(`Warehouse forward-port verification passed: baseline ${result.baseline}; ${result.changedPathCount} changed paths; 0 forbidden paths/imports/tokens; 0 byte-copied shared/adapted files.\n`)
  } catch (error) {
    process.stderr.write(`${error?.message || error}\n`)
    process.exitCode = 1
  }
}

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const validatorPath = fileURLToPath(
  new URL('./validate-warehouse-forward-port-boundary.mjs', import.meta.url),
)
const fixturesRoot = fileURLToPath(
  new URL('./fixtures/warehouse-forward-port-boundary/', import.meta.url),
)
const projectRoot = fileURLToPath(new URL('../', import.meta.url))

function runFixture(name, mode) {
  const fixtureRoot = `${fixturesRoot}${name}`
  const rootFlag = mode === 'source' ? '--source-root' : '--destination-root'
  const rootDirectory = `${fixtureRoot}/${mode}`
  const result = spawnSync(process.execPath, [
    validatorPath,
    `--audit-${mode}`,
    '--manifest',
    `${fixtureRoot}/manifest.json`,
    rootFlag,
    rootDirectory,
    ...(mode === 'destination' ? ['--destination-stage', 'fixture'] : []),
  ], {
    encoding: 'utf8',
  })

  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  }
}

test('npm resolves the validator parser as an exact direct development dependency', () => {
  const declared = spawnSync('npm', [
    'pkg',
    'get',
    'devDependencies.@babel/parser',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  const installed = spawnSync('npm', [
    'ls',
    '@babel/parser',
    '--depth=0',
    '--json',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
  })

  assert.equal(declared.status, 0, declared.stderr)
  assert.equal(JSON.parse(declared.stdout), '7.29.7')
  assert.equal(installed.status, 0, installed.stderr)
  assert.equal(JSON.parse(installed.stdout).dependencies?.['@babel/parser']?.version, '7.29.7')
})

test('source audit validates classified source modules without requiring destinations', () => {
  const result = runFixture('source-valid', 'source')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(
    result.stdout,
    'Source audit passed: 2 source modules; rewrite edges: src/features/warehouse/pure.js -> src/features/warehouse/warehouseConstants.js',
  )
})

test('source audit never accepts an external reference as a copyable source', () => {
  const result = runFixture('reference-as-source', 'source')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Source path must stay under src/features/warehouse/: src/services/warehouseConfirmationService.js',
  )
})

test('source audit rejects a source symlink before reading outside its real root', () => {
  const result = runFixture('source-symlink-escape', 'source')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Source path escapes source root: src/features/warehouse/main.js',
  )
})

test('source audit rejects a reference symlink before reading outside its real root', () => {
  const result = runFixture('reference-symlink-escape', 'source')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Reference path escapes source root: src/services/warehouseConfirmationService.js',
  )
})

test('source audit rejects a pure module import of source-only confirmation provenance', () => {
  const result = runFixture('source-forbidden-reference', 'source')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/main.js -> src/services/warehouseConfirmationService.js',
  )
})

test('source audit resolves extensionless files and index modules before classification', () => {
  const result = runFixture('source-extension-index', 'source')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Source audit passed: 3 source modules; rewrite edges: none')
})

test('destination audit traverses a complete declared warehouse graph', () => {
  const result = runFixture('destination-valid', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 2 modules for stage fixture')
})

test('destination audit permits declared adapters whose same paths are source-only forbidden', () => {
  const result = runFixture('scoped-adapter', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 2 modules for stage fixture')
})

test('destination audit rejects an undeclared local dependency with its exact edge and file', () => {
  const result = runFixture('undeclared-dependency', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Undeclared dependency: src/features/warehouse/main.js -> src/features/warehouse/helper.js',
  )
})

test('destination audit reports the exact selected destination that is absent before traversal', () => {
  const result = runFixture('missing-destination', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(result.stderr, 'Missing destination: src/features/warehouse/missing.js')
})

test('destination audit rejects a selected destination symlink before reading outside its real root', () => {
  const result = runFixture('destination-symlink-escape', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Destination path escapes destination root: src/features/warehouse/main.js',
  )
})

test('destination audit rejects a dependency symlink before reading outside its real root', () => {
  const result = runFixture('dependency-symlink-escape', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Dependency path escapes destination root: src/features/warehouse/main.js -> src/features/warehouse/helper.js',
  )
})

test('destination audit rejects a direct forbidden import with its exact edge and file', () => {
  const result = runFixture('direct-forbidden', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/main.js -> src/services/baseRecordService.js',
  )
})

test('destination audit rejects a transitive forbidden import with its exact edge and file', () => {
  const result = runFixture('indirect-forbidden', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/helper.js -> src/services/sessionOperationFence.js',
  )
})

test('destination audit rejects a dynamic forbidden import with its exact edge and file', () => {
  const result = runFixture('dynamic-forbidden', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden dependency: src/features/warehouse/main.js -> src/services/baseRecordService.js',
  )
})

test('destination audit fails closed on a template-literal dynamic import', () => {
  const result = runFixture('dynamic-template', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Unresolved dynamic dependency: src/features/warehouse/main.js -> import(<template>)',
  )
})

test('destination audit fails closed on a variable dynamic import', () => {
  const result = runFixture('dynamic-variable', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Unresolved dynamic dependency: src/features/warehouse/main.js -> import(<non-literal>)',
  )
})

test('destination audit fails closed on a variable require call', () => {
  const result = runFixture('require-variable', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Unresolved dynamic dependency: src/features/warehouse/main.js -> require(<non-literal>)',
  )
})

test('destination audit resolves root-relative src imports inside the repository graph', () => {
  const result = runFixture('root-relative', 'destination')

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'Destination audit passed: 2 modules for stage fixture')
})

test('destination audit rejects an import path that escapes the destination root', () => {
  const result = runFixture('path-escape', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Path escape: src/features/warehouse/main.js -> ../../../../outside.js',
  )
})

test('destination audit rejects runtime localStorage use with its exact file', () => {
  const result = runFixture('local-storage', 'destination')

  assert.notEqual(result.status, 0)
  assert.equal(
    result.stderr,
    'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
  )
})

for (const [fixture, browserGlobal] of [
  ['local-storage-destructure-global', 'globalThis'],
  ['local-storage-destructure-window', 'window'],
  ['local-storage-destructure-self', 'self'],
]) {
  test(`destination audit rejects localStorage destructuring from ${browserGlobal}`, () => {
    const result = runFixture(fixture, 'destination')

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
    )
  })
}

for (const [fixture, browserGlobal] of [
  ['local-storage-alias-global', 'globalThis'],
  ['local-storage-alias-window', 'window'],
  ['local-storage-alias-self', 'self'],
]) {
  test(`destination audit rejects a constant localStorage computed alias on ${browserGlobal}`, () => {
    const result = runFixture(fixture, 'destination')

    assert.notEqual(result.status, 0)
    assert.equal(
      result.stderr,
      'Forbidden runtime dependency: src/features/warehouse/main.js -> localStorage',
    )
  })
}

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

test('destination audit traverses a complete declared warehouse graph', () => {
  const result = runFixture('destination-valid', 'destination')

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

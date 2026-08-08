import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runWarehousePhotoStorageHttpHarness } from './run_warehouse_photo_storage_http_harness.mjs'

const baseEnvironment = Object.freeze({
  WAREHOUSE_TASK3_PROJECT_ID: 'warehouse-task3-harness-test',
  WAREHOUSE_TASK3_WORKDIR: '/private/tmp/warehouse-task3-harness.test',
  WAREHOUSE_TASK3_DB_CONTAINER: 'supabase_db_warehouse-task3-harness-test',
  WAREHOUSE_TASK3_DOCKER_CONTEXT: 'desktop-linux',
  WAREHOUSE_TASK3_DB_PORT: '62422',
  WAREHOUSE_TASK3_API_PORT: '62421',
})

function proof(ok, runId, overrides = {}) {
  return JSON.stringify({
    ok,
    runId,
    cleanupVerified: true,
    runScopedRemaining: 0,
    attemptedStoragePathsRemaining: 0,
    triggersEnabled: true,
    fixedPermissionGrants: 0,
    markerNonce: '10000000-0000-4000-8000-000000000001',
    projectId: baseEnvironment.WAREHOUSE_TASK3_PROJECT_ID,
    workdir: baseEnvironment.WAREHOUSE_TASK3_WORKDIR,
    dbPort: 62422,
    apiPort: 62421,
    ...(!ok ? { failurePoint: 'after_profiles', failureInjected: true } : {}),
    ...overrides,
  })
}

test('HTTP harness proves pass, pass, injected failure cleanup, then pass on one target', async () => {
  const calls = []
  const result = await runWarehousePhotoStorageHttpHarness(baseEnvironment, {
    async run(environment) {
      calls.push({ ...environment })
      const injected = environment.WAREHOUSE_TASK3_HTTP_FAILURE_POINT === 'after_profiles'
      const output = proof(!injected, `00000000-0000-4000-8000-00000000000${calls.length}`)
      return injected
        ? { code: 1, stdout: '', stderr: `${output}\n` }
        : { code: 0, stdout: `${output}\n`, stderr: '' }
    },
  })

  assert.deepEqual(calls.map((call) => call.WAREHOUSE_TASK3_HTTP_FAILURE_POINT ?? ''), [
    '', '', 'after_profiles', '',
  ])
  assert.equal(result.runs.length, 4)
  assert.equal(result.runs.every((run) => run.cleanupVerified), true)
  assert.equal(result.runs.every((run) => run.runScopedRemaining === 0), true)
  assert.equal(result.runs.every((run) => run.triggersEnabled), true)
  assert.equal(result.runs.every((run) => run.fixedPermissionGrants === 0), true)
})

test('HTTP harness rejects a success or injected failure without exact cleanup proof', async () => {
  await assert.rejects(
    () => runWarehousePhotoStorageHttpHarness(baseEnvironment, {
      async run() {
        return { code: 0, stdout: '{"ok":true}\n', stderr: '' }
      },
    }),
    /cleanup proof invalid/u,
  )
})

test('HTTP harness rejects an unknown attempted Storage path left behind by cleanup', async () => {
  await assert.rejects(
    () => runWarehousePhotoStorageHttpHarness(baseEnvironment, {
      async run(environment) {
        const injected = environment.WAREHOUSE_TASK3_HTTP_FAILURE_POINT === 'after_profiles'
        const output = `${proof(!injected, '20000000-0000-4000-8000-000000000001', {
            attemptedStoragePathsRemaining: 1,
          })}\n`
        return injected
          ? { code: 1, stdout: '', stderr: output }
          : { code: 0, stdout: output, stderr: '' }
      },
    }),
    /cleanup proof invalid/u,
  )
})

test('HTTP harness rejects a marker nonce change between same-target runs', async () => {
  let callCount = 0
  await assert.rejects(
    () => runWarehousePhotoStorageHttpHarness(baseEnvironment, {
      async run(environment) {
        callCount += 1
        const injected = environment.WAREHOUSE_TASK3_HTTP_FAILURE_POINT === 'after_profiles'
        const output = `${proof(!injected,
          `30000000-0000-4000-8000-00000000000${callCount}`, {
            markerNonce: callCount === 1
              ? '40000000-0000-4000-8000-000000000001'
              : '40000000-0000-4000-8000-000000000002',
          })}\n`
        return injected
          ? { code: 1, stdout: '', stderr: output }
          : { code: 0, stdout: output, stderr: '' }
      },
    }),
    /target identity changed/u,
  )
  assert.equal(callCount, 2)
})

test('failure injection cannot activate before complete isolated-target validation', async () => {
  const script = new URL('./warehouse_photo_storage_http.mjs', import.meta.url)
  const source = await readFile(script, 'utf8')
  assert.ok(
    source.indexOf('await validateConfiguration(process.env)') <
      source.indexOf('process.env.WAREHOUSE_TASK3_HTTP_FAILURE_POINT'),
  )

  const result = spawnSync(process.execPath, [fileURLToPath(script)], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      WAREHOUSE_TASK3_HTTP_FAILURE_POINT: 'after_profiles',
    },
  })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /missing explicit WAREHOUSE_TASK3_PROJECT_ID/u)
  assert.doesNotMatch(result.stderr, /failure injected/u)
})

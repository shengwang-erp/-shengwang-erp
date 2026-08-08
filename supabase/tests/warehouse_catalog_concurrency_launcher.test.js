import assert from 'node:assert/strict'
import test from 'node:test'

const launcherUrl = new URL('./run_warehouse_catalog_concurrency.mjs', import.meta.url)

const projectId = 'warehouse-task3-fix-a1b2c3'
const workdir = '/private/tmp/warehouse-task3-fix.A1b2c3'
const databaseContainer = `supabase_db_${projectId}`
const baseEnvironment = Object.freeze({
  WAREHOUSE_TASK3_PROJECT_ID: projectId,
  WAREHOUSE_TASK3_WORKDIR: workdir,
  WAREHOUSE_TASK3_DB_CONTAINER: databaseContainer,
  WAREHOUSE_TASK3_DOCKER_CONTEXT: 'desktop-linux',
  WAREHOUSE_TASK3_DB_PORT: '62322',
  WAREHOUSE_TASK3_API_PORT: '62321',
})
const config = [
  `project_id = "${projectId}"`,
  '[api]',
  'port = 62321',
  '[db]',
  'port = 62322',
  '',
].join('\n')
const inspect = JSON.stringify([{
  Name: `/${databaseContainer}`,
  State: { Running: true },
  Config: { Labels: { 'com.supabase.cli.project': projectId } },
  NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '62322' }] } },
}])

function createHarness({ markerOverride, testFailure } = {}) {
  const calls = []
  const nonces = []
  return {
    calls,
    nonces,
    dependencies: {
      async realpath(path) { return path },
      async readFile(path) {
        assert.equal(path, `${workdir}/supabase/config.toml`)
        return config
      },
      randomUuid() {
        const nonce = nonces.length === 0
          ? '81000000-0000-4000-8000-000000000001'
          : '81000000-0000-4000-8000-000000000002'
        nonces.push(nonce)
        return nonce
      },
      async run(command, args) {
        calls.push([command, ...args])
        if (command === 'docker' && args.includes('inspect')) return inspect
        if (command === 'npx' && args.includes('reset')) return 'reset complete'
        if (command === 'docker' && args.some((arg) =>
          arg.includes('insert into private.warehouse_task3_test_target'))) {
          return 'INSERT 0 1'
        }
        if (command === 'docker' && args.some((arg) => arg.includes('select concat_ws'))) {
          const expected = [
            projectId, workdir, '62322', '62321', nonces.at(-1), 't', 't', 't',
          ].join('|')
          return markerOverride ?? expected
        }
        if (command === 'npx' && args.some((arg) =>
          arg.endsWith('warehouse_catalog_concurrency.sql'))) {
          if (testFailure) throw new Error(testFailure)
          return 'Result: PASS'
        }
        if (command === 'docker') return 'CREATE TABLE\nREVOKE\nINSERT 0 1'
        throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
      },
    },
  }
}

test('launcher fresh-resets, writes a unique nonce marker, verifies it, then runs concurrency', async () => {
  const { runWarehouseCatalogConcurrency } = await import(launcherUrl)
  const first = createHarness()
  const result = await runWarehouseCatalogConcurrency(baseEnvironment, first.dependencies)
  assert.deepEqual(result, {
    projectId,
    workdir,
    dbPort: 62322,
    apiPort: 62321,
    nonce: '81000000-0000-4000-8000-000000000001',
  })
  const resetIndex = first.calls.findIndex((call) => call[0] === 'npx' && call.includes('reset'))
  const markerIndex = first.calls.findIndex((call) =>
    call[0] === 'docker' && call.some((arg) =>
      typeof arg === 'string' && arg.includes('insert into private.warehouse_task3_test_target')))
  const proofIndex = first.calls.findIndex((call) =>
    call[0] === 'docker' && call.some((arg) =>
      typeof arg === 'string' && arg.includes('select concat_ws')))
  const testIndex = first.calls.findIndex((call) =>
    call[0] === 'npx' && call.some((arg) =>
      typeof arg === 'string' && arg.endsWith('warehouse_catalog_concurrency.sql')))
  assert.equal(resetIndex >= 0 && resetIndex < markerIndex && markerIndex < proofIndex && proofIndex < testIndex, true)

  const second = createHarness()
  second.dependencies.randomUuid = () => {
    const nonce = '81000000-0000-4000-8000-000000000099'
    second.nonces.push(nonce)
    return nonce
  }
  const secondResult = await runWarehouseCatalogConcurrency(baseEnvironment, second.dependencies)
  assert.notEqual(result.nonce, secondResult.nonce)
})

test('launcher rejects default and mismatched non-default ports before reset or marker writes', async () => {
  const { runWarehouseCatalogConcurrency } = await import(launcherUrl)
  for (const environment of [
    { ...baseEnvironment, WAREHOUSE_TASK3_DB_PORT: '54322' },
    { ...baseEnvironment, WAREHOUSE_TASK3_API_PORT: '54321' },
    { ...baseEnvironment, WAREHOUSE_TASK3_DB_PORT: '62323' },
  ]) {
    const harness = createHarness()
    await assert.rejects(
      () => runWarehouseCatalogConcurrency(environment, harness.dependencies),
      /isolated Task 3/u,
    )
    assert.equal(harness.calls.some((call) => call[0] === 'npx' && call.includes('reset')), false)
  }
})

test('launcher rejects a stale or mismatched marker before concurrency SQL', async () => {
  const { runWarehouseCatalogConcurrency } = await import(launcherUrl)
  const harness = createHarness({
    markerOverride: `${projectId}|${workdir}|62322|62321|81000000-0000-4000-8000-000000000000|t|t|t`,
  })
  await assert.rejects(
    () => runWarehouseCatalogConcurrency(baseEnvironment, harness.dependencies),
    /fresh Task 3 marker/u,
  )
  assert.equal(harness.calls.some((call) => call.some((arg) =>
    typeof arg === 'string' && arg.endsWith('warehouse_catalog_concurrency.sql'))), false)
})

test('remote marker or migration proof failure is terminal and never retries test mutations', async () => {
  const { runWarehouseCatalogConcurrency } = await import(launcherUrl)
  const harness = createHarness({ testFailure: 'remote marker mismatch before fixtures' })
  await assert.rejects(
    () => runWarehouseCatalogConcurrency(baseEnvironment, harness.dependencies),
    /remote marker mismatch before fixtures/u,
  )
  assert.equal(harness.calls.filter((call) =>
    call[0] === 'npx' && call.some((arg) =>
      typeof arg === 'string' && arg.endsWith('warehouse_catalog_concurrency.sql'))).length, 1)
})

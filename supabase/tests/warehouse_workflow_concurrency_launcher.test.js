import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatWarehouseWorkflowRunFailure,
  runWarehouseWorkflowConcurrency,
} from './run_warehouse_workflow_concurrency.mjs'

const environment = Object.freeze({
  WAREHOUSE_TASK1_PROJECT_ID: 'warehouse-phase3-task1-proof',
  WAREHOUSE_TASK1_WORKDIR: '/private/tmp/warehouse-phase3-task1-proof',
  WAREHOUSE_TASK1_DB_CONTAINER: 'supabase_db_warehouse-phase3-task1-proof',
  WAREHOUSE_TASK1_DOCKER_CONTEXT: 'desktop-linux',
  WAREHOUSE_TASK1_DB_PORT: '62422',
  WAREHOUSE_TASK1_API_PORT: '62421',
})

test('launcher failure diagnostics preserve both command stderr and TAP stdout', () => {
  assert.equal(
    formatWarehouseWorkflowRunFailure('pgTAP failed', 'not ok 7 - lock proof'),
    'pgTAP failed\nnot ok 7 - lock proof',
  )
})

function dependencies() {
  const calls = []
  return {
    calls,
    realpath: async (value) => value,
    readFile: async () => 'project_id = "warehouse-phase3-task1-proof"\n[api]\nport = 62421\n[db]\nport = 62422\n',
    randomUuid: () => '12345678-1234-4234-8234-123456789abc',
    run: async (command, args) => {
      calls.push([command, args])
      if (args[0] === '--context' && args[2] === 'container') {
        return JSON.stringify([{
          Name: '/supabase_db_warehouse-phase3-task1-proof',
          State: { Running: true },
          Config: { Labels: { 'com.supabase.cli.project': 'warehouse-phase3-task1-proof' } },
          NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '62422' }] } },
        }])
      }
      if (args.some((argument) => argument.includes('concat_ws'))) {
        return 'warehouse-phase3-task1-proof|/private/tmp/warehouse-phase3-task1-proof|62422|62421|12345678-1234-4234-8234-123456789abc|t|t\n'
      }
      return ''
    },
  }
}

test('launcher proves exact Docker ownership, resets, writes a fresh marker, proves it remotely and runs only the workflow concurrency file', async () => {
  const supplied = dependencies()
  const result = await runWarehouseWorkflowConcurrency(environment, supplied)

  assert.deepEqual(result, {
    projectId: environment.WAREHOUSE_TASK1_PROJECT_ID,
    workdir: environment.WAREHOUSE_TASK1_WORKDIR,
    dbPort: 62422,
    apiPort: 62421,
    nonce: '12345678-1234-4234-8234-123456789abc',
  })
  assert.equal(supplied.calls.filter(([command, args]) =>
    command === 'docker' && args[2] === 'container' && args[3] === 'inspect').length, 2)
  assert.equal(supplied.calls.some(([command, args]) =>
    command === 'npx' && args.includes('db') && args.includes('reset') &&
    args.at(-1) === environment.WAREHOUSE_TASK1_WORKDIR), true)
  assert.equal(supplied.calls.some(([command, args]) =>
    command === 'npx' && args.some((argument) => argument.endsWith('warehouse_workflow_concurrency.sql')) &&
    args.at(-1) === environment.WAREHOUSE_TASK1_WORKDIR), true)
})

test('launcher fails closed on default ports, ambient Docker overrides and ownership mismatches before reset', async () => {
  for (const invalid of [
    { ...environment, WAREHOUSE_TASK1_DB_PORT: '54322' },
    { ...environment, WAREHOUSE_TASK1_API_PORT: '54321' },
    { ...environment, DOCKER_HOST: 'unexpected' },
    { ...environment, WAREHOUSE_TASK1_PROJECT_ID: 'wrong-project' },
  ]) {
    const supplied = dependencies()
    await assert.rejects(runWarehouseWorkflowConcurrency(invalid, supplied), /isolated Task 1/u)
    assert.equal(supplied.calls.some(([command, args]) =>
      command === 'npx' && args.includes('reset')), false)
  }

  const supplied = dependencies()
  supplied.run = async (command, args) => {
    supplied.calls.push([command, args])
    if (args[0] === '--context') return JSON.stringify([{
      Name: '/some-other-database', State: { Running: true }, Config: { Labels: {} },
      NetworkSettings: { Ports: { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '62422' }] } },
    }])
    return ''
  }
  await assert.rejects(runWarehouseWorkflowConcurrency(environment, supplied), /not the explicit isolated Task 1/u)
})

test('launcher resets committed marker state when marker creation or remote proof fails', async () => {
  for (const phase of ['marker', 'proof']) {
    const supplied = dependencies()
    const baseRun = supplied.run
    supplied.run = async (command, args) => {
      supplied.calls.push([command, args])
      if (
        phase === 'marker' && command === 'docker' &&
        args.some((argument) => argument.includes('create table private.warehouse_task1_test_target'))
      ) throw new Error('marker failed')
      if (
        phase === 'proof' && command === 'docker' &&
        args.some((argument) => argument.includes("concat_ws('|',project_id"))
      ) return 'wrong proof\n'
      supplied.calls.pop()
      return baseRun(command, args)
    }
    await assert.rejects(
      runWarehouseWorkflowConcurrency(environment, supplied),
      phase === 'marker' ? /marker failed/u : /marker proof failed/u,
    )
    assert.equal(supplied.calls.filter(([command, args]) =>
      command === 'npx' && args.includes('db') && args.includes('reset')).length, 2)
  }
})

test('launcher preserves both primary and cleanup failures', async () => {
  const supplied = dependencies()
  const baseRun = supplied.run
  let resetCount = 0
  supplied.run = async (command, args) => {
    supplied.calls.push([command, args])
    if (command === 'npx' && args.includes('db') && args.includes('reset')) {
      resetCount += 1
      if (resetCount === 2) throw new Error('cleanup failed')
    }
    if (
      command === 'docker' &&
      args.some((argument) => argument.includes('create table private.warehouse_task1_test_target'))
    ) throw new Error('marker failed')
    supplied.calls.pop()
    return baseRun(command, args)
  }
  await assert.rejects(
    runWarehouseWorkflowConcurrency(environment, supplied),
    (error) => error instanceof AggregateError &&
      error.errors.some((entry) => /marker failed/u.test(entry.message)) &&
      error.errors.some((entry) => /cleanup failed/u.test(entry.message)),
  )
})

test('post-reset inspect and nonce failures each trigger exactly one cleanup reset', async () => {
  const inspectFailure = dependencies()
  const inspectBaseRun = inspectFailure.run
  let inspectCount = 0
  inspectFailure.run = async (command, args) => {
    inspectFailure.calls.push([command, args])
    if (command === 'docker' && args[2] === 'container' && args[3] === 'inspect') {
      inspectCount += 1
      if (inspectCount === 2) throw new Error('post-reset inspect failed')
    }
    inspectFailure.calls.pop()
    return inspectBaseRun(command, args)
  }
  await assert.rejects(
    runWarehouseWorkflowConcurrency(environment, inspectFailure),
    /post-reset inspect failed/u,
  )
  assert.equal(inspectFailure.calls.filter(([command, args]) =>
    command === 'npx' && args.includes('db') && args.includes('reset')).length, 2)

  const nonceFailure = dependencies()
  nonceFailure.randomUuid = () => 'not-a-uuid'
  await assert.rejects(
    runWarehouseWorkflowConcurrency(environment, nonceFailure),
    /fresh Task 1 marker nonce is invalid/u,
  )
  assert.equal(nonceFailure.calls.filter(([command, args]) =>
    command === 'npx' && args.includes('db') && args.includes('reset')).length, 2)
})

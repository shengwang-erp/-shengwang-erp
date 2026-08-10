import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ProjectCostLedgerServiceError,
  createProjectCostLedgerService,
} from './projectCostLedgerService.js'

const LEDGER_ROW = {
  sourceKey: 'warehouse:SO-1', sourceModule: 'warehouse',
  sourceDocumentType: 'warehouse_stock_out', sourceDocumentId: 'SO-1',
  projectId: 'P1', projectName: '第一项目', category: '材料费', date: '2026-08-01',
  description: '铜管领用', originalAmount: 100, adjustmentAmount: 0,
  effectiveAmount: 100, operator: '王工', adjusted: false, version: 1,
  allocations: [{ projectId: 'P1', amount: 100 }], auditEvents: [],
}

const LEDGER_RESPONSE = {
  status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z', page: 1, pageSize: 20,
  totalRows: 1, rows: [LEDGER_ROW], categoryTotals: [{ category: '材料费', amount: 100 }],
  totalAmount: 100, adjustmentTotal: 0, incompleteSources: [],
}

function clientReturning(result) {
  const calls = []
  return {
    calls,
    client: {
      async rpc(name, params) {
        calls.push([name, params])
        return typeof result === 'function' ? result(name, params) : result
      },
    },
  }
}

test('list sends only normalized own filters to the secure ledger RPC', async () => {
  const { client, calls } = clientReturning({ data: LEDGER_RESPONSE, error: null, status: 200 })
  const service = createProjectCostLedgerService(client, { configured: true })
  const filters = { projectId: 'P1', page: 1, pageSize: 20 }
  const result = await service.list(filters)
  assert.deepEqual(calls, [['list_project_cost_ledger_secure', {
    p_filters: { projectId: 'P1', page: 1, pageSize: 20 },
  }]])
  assert.equal(result.rows[0].sourceKey, 'warehouse:SO-1')
  assert.equal(Object.isFrozen(result.rows[0]), true)
})

test('requests reject unknown, inherited, accessor, sparse, oversized and invalid date input before RPC', async () => {
  const { client, calls } = clientReturning({ data: LEDGER_RESPONSE, error: null })
  const service = createProjectCostLedgerService(client, { configured: true })
  await assert.rejects(service.list({ projectId: 'P1', unknown: true }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  await assert.rejects(service.list(Object.create({ projectId: 'P1' })), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  const accessor = {}
  Object.defineProperty(accessor, 'projectId', { enumerable: true, get() { return 'P1' } })
  await assert.rejects(service.list(accessor), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  await assert.rejects(service.list({ keyword: 'x'.repeat(201) }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  await assert.rejects(service.list({ sourceModule: 'x'.repeat(101) }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  await assert.rejects(service.list({ sourceModule: 'private_ledger' }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  await assert.rejects(service.list({ dateFrom: '2026-02-30' }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  await assert.rejects(service.list({ page: 1_000_001 }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  const allocations = new Array(1)
  await assert.rejects(service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, reason: '分摊', allocations }), errorCode('PROJECT_COST_LEDGER_INPUT_INVALID'))
  assert.equal(calls.length, 0)
})

test('neutral source filters stay valid while the seven SQL source modules are exact', async () => {
  const { client, calls } = clientReturning({ data: LEDGER_RESPONSE, error: null, status: 200 })
  const service = createProjectCostLedgerService(client, { configured: true })
  for (const sourceModule of ['', 'all', 'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual']) {
    await service.list({ sourceModule })
  }
  assert.deepEqual(calls.map(([, args]) => args.p_filters.sourceModule), ['', 'all', 'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual'])
})

test('mutation methods emit exact secure RPC argument shapes and normalize returned DTOs', async () => {
  const { client, calls } = clientReturning((name) => ({
    data: name === 'create_project_cost_adjustment_secure'
      ? { sourceKey: 'warehouse:SO-1', version: 2, effectiveAmount: 90 }
      : name === 'replace_project_cost_allocations_secure'
        ? { sourceKey: 'warehouse:SO-1', version: 3, allocations: [{ projectId: 'P1', amount: 90 }] }
        : { sourceKey: 'manual:11111111-1111-4111-8111-111111111111', projectId: 'P1', category: '其他费用', date: '2026-08-10', amount: -20, description: '退费', operator: '王工', reason: '冲销', actorName: '会计', createdAt: '2026-08-10T01:00:00.000Z' },
    error: null, status: 200,
  }))
  const service = createProjectCostLedgerService(client, { configured: true })
  assert.deepEqual(await service.adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: -10, reason: '更正' }), {
    sourceKey: 'warehouse:SO-1', version: 2, effectiveAmount: 90,
  })
  assert.deepEqual(await service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 2, reason: '分摊', allocations: [{ projectId: 'P1', amount: 90 }] }), {
    sourceKey: 'warehouse:SO-1', version: 3, allocations: [{ projectId: 'P1', amount: 90 }],
  })
  await service.createManual({ requestId: '11111111-1111-4111-8111-111111111111', entry: { projectId: 'P1', category: '其他费用', date: '2026-08-10', amount: -20, description: '退费', operator: '王工', reason: '冲销' } })
  assert.deepEqual(calls, [
    ['create_project_cost_adjustment_secure', { p_source_key: 'warehouse:SO-1', p_expected_version: 1, p_adjustment_amount: -10, p_reason: '更正' }],
    ['replace_project_cost_allocations_secure', { p_source_key: 'warehouse:SO-1', p_expected_version: 2, p_reason: '分摊', p_allocations: [{ projectId: 'P1', amount: 90 }] }],
    ['create_manual_project_cost_secure', { p_request_id: '11111111-1111-4111-8111-111111111111', p_entry: { projectId: 'P1', category: '其他费用', date: '2026-08-10', amount: -20, description: '退费', operator: '王工', reason: '冲销' } }],
  ])
})

test('listAudit accepts only documented filters and rejects hostile supplier response graphs', async () => {
  const hostile = { status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z' }
  Object.defineProperty(hostile, 'events', { enumerable: true, get() { return [] } })
  const { client, calls } = clientReturning({ data: hostile, error: null, status: 200 })
  const service = createProjectCostLedgerService(client, { configured: true })
  await assert.rejects(service.listAudit({ projectId: 'P1', dateFrom: '2026-08-01', dateTo: '2026-08-10' }), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
  assert.deepEqual(calls[0], ['list_project_cost_audit_secure', { p_filters: { projectId: 'P1', dateFrom: '2026-08-01', dateTo: '2026-08-10' } }])
})

test('audit accepts an old allocation snapshot followed by adjustment and current reallocation', async () => {
  const response = {
    status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z',
    events: [{
      eventType: 'allocation', sourceKey: 'warehouse:SO-1', sequenceNo: 3,
      amountBefore: 300, amountAfter: 300, adjustmentAmount: 0,
      allocationsBefore: [{ projectId: 'P1', amount: 200 }],
      allocationsAfter: [{ projectId: 'P1', amount: 100 }, { projectId: 'P2', amount: 200 }],
      reason: '调整后重新分摊', actorName: '会计', createdAt: '2026-08-10T01:00:00.000Z',
    }],
  }
  const { client } = clientReturning({ data: response, error: null, status: 200 })
  const result = await createProjectCostLedgerService(client, { configured: true }).listAudit({})
  assert.equal(result.events[0].allocationsBefore[0].amount, 200)
  assert.equal(result.events[0].allocationsAfter[1].amount, 200)
})

test('audit accepts only the legal single-zero default before a signed zero-total allocation', async () => {
  const event = {
    eventType: 'allocation', sourceKey: 'purchase:PO-1', sequenceNo: 2,
    amountBefore: 0, amountAfter: 0, adjustmentAmount: 0,
    allocationsBefore: [{ projectId: 'P1', amount: 0 }],
    allocationsAfter: [{ projectId: 'P1', amount: 1 }, { projectId: 'P2', amount: -1 }],
    reason: '归零后分摊', actorName: '会计', createdAt: '2026-08-10T01:00:00.000Z',
  }
  const valid = clientReturning({ data: { status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z', events: [event] }, error: null, status: 200 })
  const result = await createProjectCostLedgerService(valid.client, { configured: true }).listAudit({})
  assert.deepEqual(result.events[0].allocationsBefore, [{ projectId: 'P1', amount: 0 }])

  for (const invalidEvent of [
    { ...event, allocationsBefore: [{ projectId: 'P1', amount: 0 }, { projectId: 'P2', amount: 0 }] },
    { ...event, allocationsAfter: [{ projectId: 'P1', amount: 0 }] },
  ]) {
    const invalid = clientReturning({ data: { status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z', events: [invalidEvent] }, error: null, status: 200 })
    await assert.rejects(createProjectCostLedgerService(invalid.client, { configured: true }).listAudit({}), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
  }
})

test('audit rejects a hostile single-zero prior allocation when amountBefore is nonzero', async () => {
  const event = {
    eventType: 'allocation', sourceKey: 'purchase:PO-1', sequenceNo: 2,
    amountBefore: 100, amountAfter: 100, adjustmentAmount: 0,
    allocationsBefore: [{ projectId: 'P1', amount: 0 }],
    allocationsAfter: [{ projectId: 'P1', amount: 100 }],
    reason: '伪造历史', actorName: '会计', createdAt: '2026-08-10T01:00:00.000Z',
  }
  const { client } = clientReturning({
    data: { status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z', events: [event] },
    error: null,
    status: 200,
  })
  await assert.rejects(
    createProjectCostLedgerService(client, { configured: true }).listAudit({}),
    errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'),
  )
})

test('only documented own SQL hints map to safe errors and supplier details never escape', async () => {
  const cases = [
    ['22023', 'PROJECT_COST_LEDGER_INPUT_INVALID'],
    ['42501', 'PROJECT_COST_LEDGER_ACCESS_DENIED'],
    ['P0001', 'PROJECT_COST_LEDGER_VERSION_CONFLICT'],
    ['22023', 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED'],
    ['22023', 'PROJECT_COST_LEDGER_SOURCE_MISSING'],
  ]
  for (const [sqlState, hint] of cases) {
    const { client } = clientReturning({ data: null, error: { code: sqlState, hint, message: 'select private_secret from payroll' }, status: 400 })
    const service = createProjectCostLedgerService(client, { configured: true })
    await assert.rejects(service.adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: 1, reason: '修正' }), (error) => {
      assert.equal(error.code, hint)
      assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /private_secret|payroll|select/i)
      return true
    })
  }
  for (const supplierError of [
    { code: 'XX000', hint: 'PROJECT_COST_LEDGER_VERSION_CONFLICT', message: 'secret SQL' },
    Object.assign(Object.create({ hint: 'PROJECT_COST_LEDGER_SOURCE_MISSING' }), { code: '22023', message: 'secret payload' }),
  ]) {
    const { client } = clientReturning({ data: null, error: supplierError, status: 500 })
    await assert.rejects(createProjectCostLedgerService(client, { configured: true }).adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: 1, reason: '修正' }), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
  }
})

test('expired sessions set authInvalid while access denial and unconfigured clients do not', async () => {
  const expired = clientReturning({ data: null, error: { code: 'PGRST301', message: 'expired token' }, status: 401 })
  await assert.rejects(createProjectCostLedgerService(expired.client, { configured: true }).list({}), (error) => {
    assert.equal(error.code, 'AUTH_SESSION_INVALID')
    assert.equal(error.authInvalid, true)
    return true
  })
  const denied = clientReturning({ data: null, error: { code: '42501', hint: 'PROJECT_COST_LEDGER_ACCESS_DENIED' }, status: 403 })
  await assert.rejects(createProjectCostLedgerService(denied.client, { configured: true }).list({}), (error) => {
    assert.equal(error.code, 'PROJECT_COST_LEDGER_ACCESS_DENIED')
    assert.equal(error.authInvalid, false)
    return true
  })
  const unavailable = clientReturning({ data: LEDGER_RESPONSE, error: null })
  await assert.rejects(createProjectCostLedgerService(unavailable.client, { configured: false }).list({}), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
  assert.equal(unavailable.calls.length, 0)
})

test('malformed successful mutation responses fail closed without preserving supplier payloads', async () => {
  const payload = { sourceKey: 'warehouse:SO-1', version: 2, effectiveAmount: 90, sql: 'private' }
  const { client } = clientReturning({ data: payload, error: null, status: 200 })
  await assert.rejects(createProjectCostLedgerService(client, { configured: true }).adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: -10, reason: '更正' }), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
})

test('a thrown decorated public service error is reconstructed and cannot leak its message or payload', async () => {
  const hostile = new ProjectCostLedgerServiceError('PROJECT_COST_LEDGER_VERSION_CONFLICT')
  hostile.message = 'select secret_salary from payroll'
  hostile.hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT'
  hostile.payload = { password: 'private' }
  const service = createProjectCostLedgerService({ async rpc() { throw hostile } }, { configured: true })
  await assert.rejects(service.list({}), (error) => {
    assert.equal(error.code, 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE')
    assert.equal(error.authInvalid, false)
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error)}`, /secret_salary|payroll|password|private/i)
    return true
  })
})

test('hostile thrown proxies and client property traps always collapse to the generic safe error', async () => {
  const traps = [
    { getOwnPropertyDescriptor() { throw new Error('private descriptor SQL') } },
    { ownKeys() { throw new Error('private ownKeys SQL') } },
    { get() { throw new Error('private get SQL') } },
  ]
  for (const handler of traps) {
    const hostile = new Proxy({}, handler)
    const service = createProjectCostLedgerService({ async rpc() { throw hostile } }, { configured: true })
    await assert.rejects(service.list({}), genericWithoutPrivateDetails)
  }
  const hostileClient = new Proxy({}, { get() { throw new Error('private client getter SQL') } })
  await assert.rejects(createProjectCostLedgerService(hostileClient, { configured: true }).list({}), genericWithoutPrivateDetails)
})

test('list applies strict ISO validation after the Task 1 snapshot normalizer', async () => {
  const { client } = clientReturning({ data: { ...LEDGER_RESPONSE, generatedAt: '1' }, error: null, status: 200 })
  await assert.rejects(createProjectCostLedgerService(client, { configured: true }).list({}), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
})

test('audit responses enforce event arithmetic, allocation shape and strict ISO instants', async () => {
  const validAdjustment = {
    eventType: 'adjustment', sourceKey: 'warehouse:SO-1', sequenceNo: 1,
    amountBefore: 100, amountAfter: 110, adjustmentAmount: 10,
    allocationsBefore: null, allocationsAfter: null, reason: '更正', actorName: '会计',
    createdAt: '2026-08-10T01:00:00.000Z',
  }
  const invalidResponses = [
    { status: 'ready', generatedAt: '1', events: [] },
    { status: 'ready', generatedAt: '2026-02-30T01:00:00Z', events: [] },
    { status: 'ready', generatedAt: '2026-08-10T01:00:00Z', events: [{ ...validAdjustment, amountAfter: 111 }] },
    { status: 'ready', generatedAt: '2026-08-10T01:00:00Z', events: [{ ...validAdjustment, allocationsBefore: [] }] },
    { status: 'ready', generatedAt: '2026-08-10T01:00:00Z', events: [{ ...validAdjustment, eventType: 'allocation', adjustmentAmount: 0, amountAfter: 100, allocationsBefore: null, allocationsAfter: [{ projectId: 'P1', amount: 100 }] }] },
  ]
  for (const response of invalidResponses) {
    const { client } = clientReturning({ data: response, error: null, status: 200 })
    await assert.rejects(createProjectCostLedgerService(client, { configured: true }).listAudit({}), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
  }
})

test('successful mutation responses must correlate to the normalized request', async () => {
  const { client } = clientReturning({
    data: { sourceKey: 'warehouse:OTHER', version: 99, effectiveAmount: 90 },
    error: null, status: 200,
  })
  await assert.rejects(createProjectCostLedgerService(client, { configured: true }).adjust({
    sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: -10, reason: '更正',
  }), errorCode('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'))
})

function errorCode(code) {
  return (error) => error instanceof ProjectCostLedgerServiceError && error.code === code
}

function genericWithoutPrivateDetails(error) {
  return error instanceof ProjectCostLedgerServiceError &&
    error.code === 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE' &&
    !/private|descriptor|ownKeys|getter|SQL/i.test(`${error.message} ${JSON.stringify(error)}`)
}

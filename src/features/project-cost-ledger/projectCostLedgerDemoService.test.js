import assert from 'node:assert/strict'
import test from 'node:test'

import { ProjectCostLedgerServiceError } from '../../services/projectCostLedgerService.js'
import { createProjectCostLedgerDemoService } from './projectCostLedgerDemoService.js'

function demoSources() {
  return {
    purchaseRows: [
      { purchaseId: 'PO-DIRECT', purchaseDate: '2026-08-01', projectId: 'P1', projectName: '第一项目', totalCost: 100 },
      { purchaseId: 'PO-RECEIVED', purchaseDate: '2026-08-01', projectId: 'P1', projectName: '第一项目', totalCost: 200 },
    ],
    warehouseCosts: [{ costRecordId: 'SO-1', date: '2026-08-02', projectId: 'P1', projectName: '第一项目', amount: 200, sourceType: 'warehouse', sourcePurchaseRecordKeys: ['PO-RECEIVED'] }],
    laborRows: [], vehicleRows: [], toolRows: [], operatingExpenses: [], manualProjectCosts: [],
  }
}

function createDemo() {
  const sources = demoSources()
  const original = structuredClone(sources)
  const eventStore = { adjustments: [], allocations: [], manualEntries: [] }
  const service = createProjectCostLedgerDemoService({ getSources: () => sources, eventStore })
  return { service, sources, original, eventStore }
}

test('demo list uses local facts, excludes warehouse-tracked purchases and never mutates fixtures', async () => {
  const { service, sources, original } = createDemo()
  const snapshot = await service.list({ page: 1, pageSize: 20 })
  assert.deepEqual(snapshot.rows.map(({ sourceKey }) => sourceKey), ['warehouse:SO-1', 'purchase:PO-DIRECT'])
  assert.equal(snapshot.totalAmount, 300)
  assert.deepEqual(sources, original)
  assert.equal(Object.isFrozen(sources), false)
})

test('demo adjustments are immediately visible, append-only and stale versions match production', async () => {
  const { service, eventStore } = createDemo()
  const result = await service.adjust({ sourceKey: 'purchase:PO-DIRECT', expectedVersion: 1, adjustmentAmount: -25, reason: '价格更正' })
  assert.deepEqual(result, { sourceKey: 'purchase:PO-DIRECT', version: 2, effectiveAmount: 75 })
  assert.equal(eventStore.adjustments.length, 1)
  assert.equal((await service.list({ page: 1, pageSize: 20 })).rows.find(({ sourceKey }) => sourceKey === 'purchase:PO-DIRECT').effectiveAmount, 75)
  await assert.rejects(service.adjust({ sourceKey: 'purchase:PO-DIRECT', expectedVersion: 1, adjustmentAmount: 1, reason: '过期修正' }), (error) => error instanceof ProjectCostLedgerServiceError && error.code === 'PROJECT_COST_LEDGER_VERSION_CONFLICT')
  assert.equal(eventStore.adjustments.length, 1)
})

test('demo atomic report returns one immutable complete ledger and matching audit token', async () => {
  const { service } = createDemo()
  const report = await service.report({ projectId: 'P1' })
  assert.equal(report.status, 'ready')
  assert.match(report.snapshotToken, /^[0-9a-f]{64}$/u)
  assert.equal(report.ledgerSnapshot.totalRows, 2)
  assert.equal(report.ledgerSnapshot.rows.length, 2)
  assert.deepEqual(report.auditSnapshot.events, [])
  assert.ok(Object.isFrozen(report.ledgerSnapshot.rows))
})

test('demo allocations replace the effective view and preserve immutable history', async () => {
  const { service, eventStore } = createDemo()
  await service.adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: 100, reason: '增加运费' })
  const response = await service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 2, reason: '项目分摊', allocations: [{ projectId: 'P1', amount: 100 }, { projectId: 'P2', amount: 200 }] })
  assert.deepEqual(response, { sourceKey: 'warehouse:SO-1', version: 3, allocations: [{ projectId: 'P1', amount: 100 }, { projectId: 'P2', amount: 200 }] })
  const rows = (await service.list({ page: 1, pageSize: 20 })).rows.filter(({ sourceKey }) => sourceKey === 'warehouse:SO-1')
  assert.deepEqual(rows.map(({ projectId, allocations }) => ({ projectId, allocations })), [
    { projectId: 'P1', allocations: [{ projectId: 'P1', amount: 100 }] },
    { projectId: 'P2', allocations: [{ projectId: 'P2', amount: 200 }] },
  ])
  assert.equal(eventStore.allocations.length, 1)
  assert.throws(() => { response.allocations[0].amount = 999 }, TypeError)
  assert.equal(eventStore.allocations[0].allocations[0].amount, 100)
})

test('demo assigns the original-amount remainder after stable project sorting like secure SQL', async () => {
  const sources = demoSources()
  sources.purchaseRows.find(({ purchaseId }) => purchaseId === 'PO-DIRECT').totalCost = 1
  const service = createProjectCostLedgerDemoService({
    getSources: () => sources,
    eventStore: { adjustments: [], allocations: [], manualEntries: [] },
  })
  await service.adjust({ sourceKey: 'purchase:PO-DIRECT', expectedVersion: 1, adjustmentAmount: 2, reason: '调整为三日元' })
  await service.replaceAllocations({
    sourceKey: 'purchase:PO-DIRECT', expectedVersion: 2, reason: '三项目均分',
    allocations: [{ projectId: 'P3', amount: 1 }, { projectId: 'P1', amount: 1 }, { projectId: 'P2', amount: 1 }],
  })
  const rows = (await service.list({ sourceModule: 'purchase' })).rows.filter(({ sourceKey }) => sourceKey === 'purchase:PO-DIRECT')
  assert.deepEqual(rows.map(({ projectId, originalAmount, adjustmentAmount }) => ({ projectId, originalAmount, adjustmentAmount })), [
    { projectId: 'P1', originalAmount: 0.3333, adjustmentAmount: 0.6667 },
    { projectId: 'P2', originalAmount: 0.3333, adjustmentAmount: 0.6667 },
    { projectId: 'P3', originalAmount: 0.3334, adjustmentAmount: 0.6666 },
  ])
})

test('demo signed manual entries are idempotent and included immediately', async () => {
  const { service, eventStore } = createDemo()
  const request = { requestId: '11111111-1111-4111-8111-111111111111', entry: { projectId: 'P1', category: '其他费用', date: '2026-08-10', amount: -20, description: '退费', operator: '王工', reason: '冲销' } }
  const first = await service.createManual(request)
  const second = await service.createManual(request)
  assert.deepEqual(second, first)
  assert.equal(eventStore.manualEntries.length, 1)
  const snapshot = await service.list({ projectId: 'P1', page: 1, pageSize: 20 })
  assert.equal(snapshot.rows.find(({ sourceKey }) => sourceKey === 'manual:11111111-1111-4111-8111-111111111111').effectiveAmount, -20)
  await assert.rejects(service.createManual({ ...request, entry: { ...request.entry, amount: -21 } }), (error) => error.code === 'PROJECT_COST_LEDGER_INPUT_INVALID')
  assert.equal(eventStore.manualEntries.length, 1)
})

test('demo audit lists immutable adjustment and allocation history using documented filters', async () => {
  const { service } = createDemo()
  await service.adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, adjustmentAmount: 100, reason: '增加运费' })
  await service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 2, reason: '项目分摊', allocations: [{ projectId: 'P1', amount: 100 }, { projectId: 'P2', amount: 200 }] })
  const audit = await service.listAudit({ projectId: 'P2', dateFrom: '2026-08-01', dateTo: '2026-08-31' })
  assert.equal(audit.status, 'ready')
  assert.deepEqual(audit.events.map(({ eventType }) => eventType), ['adjustment', 'allocation'])
  assert.equal(Object.isFrozen(audit.events[0]), true)
})

test('demo rejects a new adjustment once allocation history exists and preserves both histories', async () => {
  const { service } = createDemo()
  await service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, reason: '初次分摊', allocations: [{ projectId: 'P1', amount: 200 }] })
  await assert.rejects(
    service.adjust({ sourceKey: 'warehouse:SO-1', expectedVersion: 2, adjustmentAmount: 100, reason: '增加成本' }),
    (error) => error.code === 'PROJECT_COST_LEDGER_ALLOCATION_ACTIVE',
  )
  assert.equal((await service.listAudit({})).events.length, 1)
})

test('demo supports signed first allocation after an adjustment reduces the source to zero', async () => {
  const { service } = createDemo()
  await service.adjust({ sourceKey: 'purchase:PO-DIRECT', expectedVersion: 1, adjustmentAmount: -100, reason: '成本归零' })
  await service.replaceAllocations({
    sourceKey: 'purchase:PO-DIRECT', expectedVersion: 2, reason: '正负项目分摊',
    allocations: [{ projectId: 'P1', amount: 1 }, { projectId: 'P2', amount: -1 }],
  })
  const rows = (await service.list({ sourceModule: 'purchase' })).rows.filter(({ sourceKey }) => sourceKey === 'purchase:PO-DIRECT')
  assert.deepEqual(rows.map(({ projectId, effectiveAmount }) => ({ projectId, effectiveAmount })), [
    { projectId: 'P1', effectiveAmount: 1 }, { projectId: 'P2', effectiveAmount: -1 },
  ])
  const allocation = (await service.listAudit({})).events.at(-1)
  assert.deepEqual(allocation.allocationsBefore, [{ projectId: 'P1', amount: 0 }])
  assert.deepEqual(allocation.allocationsAfter, [{ projectId: 'P1', amount: 1 }, { projectId: 'P2', amount: -1 }])
})

test('demo rejects unbalanced allocations and missing sources without appending events', async () => {
  const { service, eventStore } = createDemo()
  await assert.rejects(service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, reason: '错误分摊', allocations: [{ projectId: 'P1', amount: 199 }] }), (error) => error.code === 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED')
  await assert.rejects(service.adjust({ sourceKey: 'warehouse:missing', expectedVersion: 1, adjustmentAmount: 1, reason: '更正' }), (error) => error.code === 'PROJECT_COST_LEDGER_SOURCE_MISSING')
  assert.equal(eventStore.allocations.length, 0)
  assert.equal(eventStore.adjustments.length, 0)
})

test('demo accepts neutral filters but rejects unknown modules and oversized pages locally', async () => {
  const { service } = createDemo()
  assert.equal((await service.list({ sourceModule: '' })).totalRows, 2)
  assert.equal((await service.list({ sourceModule: 'all' })).totalRows, 2)
  await assert.rejects(service.list({ sourceModule: 'private_ledger' }), (error) => error.code === 'PROJECT_COST_LEDGER_INPUT_INVALID')
  await assert.rejects(service.list({ page: 1_000_001 }), (error) => error.code === 'PROJECT_COST_LEDGER_INPUT_INVALID')
})

test('demo rejects accessor, sparse and forged event stores with safe service errors', async () => {
  const accessorStore = { allocations: [], manualEntries: [] }
  Object.defineProperty(accessorStore, 'adjustments', { enumerable: true, get() { throw new Error('private payload') } })
  assert.throws(() => createProjectCostLedgerDemoService({ getSources: demoSources, eventStore: accessorStore }), (error) => error instanceof ProjectCostLedgerServiceError && error.code === 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE')

  const sparseStore = { adjustments: new Array(1), allocations: [], manualEntries: [] }
  assert.throws(() => createProjectCostLedgerDemoService({ getSources: demoSources, eventStore: sparseStore }), (error) => error instanceof ProjectCostLedgerServiceError && error.code === 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE')

  const frozenStore = { adjustments: Object.freeze([]), allocations: [], manualEntries: [] }
  assert.throws(() => createProjectCostLedgerDemoService({ getSources: demoSources, eventStore: frozenStore }), (error) => error instanceof ProjectCostLedgerServiceError && error.code === 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE')

  const eventStore = { adjustments: [], allocations: [], manualEntries: [] }
  const service = createProjectCostLedgerDemoService({ getSources: demoSources, eventStore })
  const forged = {}
  Object.defineProperty(forged, 'sourceKey', { enumerable: true, get() { throw new Error('select private') } })
  eventStore.adjustments.push(forged)
  await assert.rejects(service.list({}), (error) => error instanceof ProjectCostLedgerServiceError && error.code === 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE' && !/private|select/i.test(error.message))
})

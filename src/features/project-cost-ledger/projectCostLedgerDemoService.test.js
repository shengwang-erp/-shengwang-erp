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

test('demo rejects unbalanced allocations and missing sources without appending events', async () => {
  const { service, eventStore } = createDemo()
  await assert.rejects(service.replaceAllocations({ sourceKey: 'warehouse:SO-1', expectedVersion: 1, reason: '错误分摊', allocations: [{ projectId: 'P1', amount: 199 }] }), (error) => error.code === 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED')
  await assert.rejects(service.adjust({ sourceKey: 'warehouse:missing', expectedVersion: 1, adjustmentAmount: 1, reason: '更正' }), (error) => error.code === 'PROJECT_COST_LEDGER_SOURCE_MISSING')
  assert.equal(eventStore.allocations.length, 0)
  assert.equal(eventStore.adjustments.length, 0)
})

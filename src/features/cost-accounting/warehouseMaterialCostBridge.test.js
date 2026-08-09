import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_WAREHOUSE_MATERIAL_COST,
  bridgeWarehouseMaterialCosts,
  createWarehouseMaterialCostBridge,
  normalizeWarehouseMaterialCost,
} from './warehouseMaterialCostBridge.js'

const warehouseCost = (overrides = {}) => ({
  costRecordId: 'WAREHOUSE-SO:11111111-1111-4111-8111-111111111111',
  projectId: 'P-1',
  costType: '材料费',
  amount: 460,
  date: '2026-08-09',
  sourceType: 'warehouse',
  sourceDocumentId: '11111111-1111-4111-8111-111111111111',
  sourceDocumentType: 'warehouse_stock_out',
  sourcePurchaseRecordKeys: ['PO-100', 'PO-130'],
  sourceStockOutIds: ['11111111-1111-4111-8111-111111111111'],
  ...overrides,
})

test('warehouse material bridge removes only purchases proven by warehouse provenance', () => {
  const input = {
    purchaseRows: [
      { purchaseId: 'PO-100', itemName: '同名铜管', totalCost: 300 },
      { purchaseId: 'PO-DIRECT', itemName: '同名铜管', totalCost: 200 },
    ],
    projectCostRecords: [warehouseCost()],
    trackedPurchaseRecordKeys: ['PO-100'],
  }

  const bridged = bridgeWarehouseMaterialCosts(input)

  assert.deepEqual(bridged.purchaseRows.map((row) => row.purchaseId), ['PO-DIRECT'])
  assert.deepEqual(bridged.warehouseMaterialCosts.map((row) => row.costRecordId), [
    'WAREHOUSE-SO:11111111-1111-4111-8111-111111111111',
  ])
  assert.deepEqual(bridged.otherProjectCosts, [])
  assert.deepEqual(bridged.trackedPurchaseRecordKeys, ['PO-100'])
  assert.deepEqual(input.purchaseRows.map((row) => row.purchaseId), ['PO-100', 'PO-DIRECT'])
  assert.ok(Object.isFrozen(bridged))
})

test('confirmed warehouse receipt excludes purchase accrual before the first issue cost exists', () => {
  const bridged = bridgeWarehouseMaterialCosts({
    purchaseRows: [
      { purchaseId: 'PO-CONFIRMED-NO-ISSUE', totalCost: 1000 },
      { purchaseId: 'PO-PENDING-ONLY', totalCost: 200 },
    ],
    projectCostRecords: [],
    trackedPurchaseRecordKeys: ['PO-CONFIRMED-NO-ISSUE'],
  })
  assert.deepEqual(bridged.purchaseRows.map((row) => row.purchaseId), ['PO-PENDING-ONLY'])
  assert.deepEqual(bridged.trackedPurchaseRecordKeys, ['PO-CONFIRMED-NO-ISSUE'])
})

test('forged warehouse tracking in purchase payload is ignored without server proof', () => {
  const bridged = bridgeWarehouseMaterialCosts({
    purchaseRows: [{ purchaseId: 'PO-FORGED', totalCost: 800, warehouseTracked: true }],
    projectCostRecords: [],
    trackedPurchaseRecordKeys: [],
  })
  assert.deepEqual(bridged.purchaseRows.map((row) => row.purchaseId), ['PO-FORGED'])
})

test('warehouse material bridge accepts the exact safe four-decimal bound', () => {
  assert.equal(
    normalizeWarehouseMaterialCost(warehouseCost({ amount: MAX_WAREHOUSE_MATERIAL_COST })).amount,
    900719925474.0991,
  )
  assert.throws(
    () => normalizeWarehouseMaterialCost(warehouseCost({ amount: 900719925474.0992 })),
    /warehouse material cost is invalid/u,
  )
})

test('warehouse material bridge rejects malformed or cost-redacted warehouse records closed', () => {
  const invalid = [
    warehouseCost({ amount: null }),
    warehouseCost({ amount: 0 }),
    warehouseCost({ amount: -1 }),
    warehouseCost({ sourceType: 'manual' }),
    warehouseCost({ costType: '外包费' }),
    warehouseCost({ sourceDocumentId: 'not-a-uuid' }),
    warehouseCost({ sourcePurchaseRecordKeys: ['PO-100', 'PO-100'] }),
    warehouseCost({ sourcePurchaseRecordKeys: [''] }),
    warehouseCost({ sourceStockOutIds: [] }),
    warehouseCost({ sourceStockOutIds: ['22222222-2222-4222-8222-222222222222'] }),
    warehouseCost({ sourceStockOutIds: [
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ] }),
  ]
  for (const row of invalid) {
    assert.throws(() => normalizeWarehouseMaterialCost(row), /warehouse material cost is invalid/u)
  }
})

test('warehouse reversal costs use an explicit negative amount and never forge a purchase match', () => {
  const reversal = warehouseCost({
    costRecordId: 'WAREHOUSE-SR:22222222-2222-4222-8222-222222222222',
    amount: -90,
    sourceType: 'warehouseReversal',
    sourceDocumentId: '22222222-2222-4222-8222-222222222222',
    sourceDocumentType: 'warehouse_return',
    sourcePurchaseRecordKeys: [],
    sourceStockOutIds: ['11111111-1111-4111-8111-111111111111'],
  })
  const normalized = normalizeWarehouseMaterialCost(reversal)
  assert.equal(normalized.amount, -90)
  assert.deepEqual(normalized.sourcePurchaseRecordKeys, [])
})

test('bridge requires exact plain input and does not execute accessors', () => {
  let reads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'purchaseRows', {
    enumerable: true,
    get() {
      reads += 1
      return []
    },
  })
  Object.defineProperty(accessor, 'projectCostRecords', {
    enumerable: true,
    value: [],
  })
  Object.defineProperty(accessor, 'trackedPurchaseRecordKeys', {
    enumerable: true,
    value: [],
  })
  assert.throws(() => bridgeWarehouseMaterialCosts(accessor), TypeError)
  assert.equal(reads, 0)
  assert.throws(
    () => bridgeWarehouseMaterialCosts({
      purchaseRows: [], projectCostRecords: [], trackedPurchaseRecordKeys: [], extra: true,
    }),
    TypeError,
  )
})

test('warehouse material context service returns only a strict authoritative key envelope', async () => {
  const calls = []
  const service = createWarehouseMaterialCostBridge({
    rpc: async (name, args) => {
      calls.push([name, args])
      return {
        data: { trackedPurchaseRecordKeys: ['PO-100', 'PO-130'] },
        error: null,
        status: 200,
      }
    },
  }, { configured: true })
  const context = await service.loadContext()
  assert.deepEqual(context, { trackedPurchaseRecordKeys: ['PO-100', 'PO-130'] })
  assert.deepEqual(calls, [['list_warehouse_material_cost_context_secure', {}]])
  assert.ok(Object.isFrozen(context))
  await assert.rejects(
    () => createWarehouseMaterialCostBridge({ rpc: async () => ({
      data: { trackedPurchaseRecordKeys: ['PO-1', 'PO-1'] }, error: null, status: 200,
    }) }, { configured: true }).loadContext(),
    (error) => error.code === 'WAREHOUSE_MATERIAL_COST_RESPONSE_INVALID',
  )
})

test('warehouse material context service distinguishes an invalid authenticated session', async () => {
  await assert.rejects(
    () => createWarehouseMaterialCostBridge({ rpc: async () => ({
      data: null,
      error: { code: 'PGRST301' },
      status: 401,
    }) }, { configured: true }).loadContext(),
    (error) => error.code === 'WAREHOUSE_MATERIAL_COST_AUTH_INVALID',
  )
})

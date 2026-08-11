import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@babel/parser'
import {
  WarehouseServiceError,
  createWarehouseService,
} from '../../services/warehouseService.js'

import {
  PurchaseWarehouseBridgeError,
  createOfflinePurchaseArrivalContext,
  createPurchaseWarehouseBridge,
  resolvePurchaseArrivalStatus,
} from './purchaseWarehouseBridge.js'

const VARIANT_ID = '84000000-0000-4000-8000-000000000001'
const RECEIPT_ID = '81000000-0000-4000-8000-000000000001'
const LINE_ID = '82000000-0000-4000-8000-000000000001'
const EMPLOYEE_ID = '83000000-0000-4000-8000-000000000001'

const receipt = Object.freeze({
  id: RECEIPT_ID,
  purchaseRecordKey: 'PO-001',
  status: 'pending',
  submittedByEmployeeProfileId: EMPLOYEE_ID,
  submittedAt: '2026-08-09T00:00:00.000Z',
  confirmedByEmployeeProfileId: null,
  confirmedAt: null,
  rejectionReason: null,
  idempotencyKey: 'arrival-001',
  lines: Object.freeze([Object.freeze({
    id: LINE_ID,
    receiptId: RECEIPT_ID,
    variantId: VARIANT_ID,
    requestedQuantity: 2,
    confirmedQuantity: null,
    warehouseId: null,
    locationId: null,
    unitCost: null,
  })]),
})

const contextPayload = () => ({
  variants: [{
    id: VARIANT_ID,
    itemId: '85000000-0000-4000-8000-000000000001',
    itemName: '空调铜管',
    sku: 'CU-001',
    model: 'R410A',
    size: '9mm',
    material: '铜',
    unit: '米',
  }],
  purchases: [{
    purchaseRecordKey: 'PO-001',
    orderedQuantity: 5,
    pendingQuantity: 2,
    confirmedQuantity: 1,
    remainingQuantity: 2,
    hasReceipt: true,
  }],
})

test('arrival submission delegates to the secure pending receipt service without price, actor, warehouse or location authority', async () => {
  const calls = []
  const bridge = createPurchaseWarehouseBridge({
    warehouseService: {
      async submitReceipt(input) {
        calls.push(input)
        return receipt
      },
    },
    rpcClient: { rpc: async () => ({ data: contextPayload(), error: null }) },
    configured: true,
  })

  const result = await bridge.submitWarehouseArrival({
    purchaseRecordKey: 'PO-001',
    variantId: VARIANT_ID,
    requestedQuantity: 2,
    idempotencyKey: 'arrival-001',
  })

  assert.deepEqual(calls, [{
    purchaseRecordKey: 'PO-001',
    idempotencyKey: 'arrival-001',
    lines: [{
      variantId: VARIANT_ID,
      requestedQuantity: 2,
      warehouseId: null,
      locationId: null,
    }],
  }])
  assert.equal(result, receipt)
})

test('bridge accepts a cost-redacted terminal exact retry and rejects a cost-bearing terminal response', async () => {
  const terminal = {
    ...receipt,
    status: 'confirmed',
    confirmedByEmployeeProfileId: EMPLOYEE_ID,
    confirmedAt: '2026-08-09T01:00:00.000Z',
    lines: [{
      ...receipt.lines[0], confirmedQuantity: 2,
      warehouseId: '86000000-0000-4000-8000-000000000001',
      locationId: '87000000-0000-4000-8000-000000000001',
    }],
  }
  const input = {
    purchaseRecordKey: 'PO-001', variantId: VARIANT_ID,
    requestedQuantity: 2, idempotencyKey: 'arrival-001',
  }
  const bridgeFor = (data, viewCost = false) => {
    const rpcClient = {
      async rpc(name) {
        if (name === 'submit_warehouse_receipt_secure') {
          return { data, error: null, status: 200 }
        }
        return { data: contextPayload(), error: null, status: 200 }
      },
    }
    return createPurchaseWarehouseBridge({
      warehouseService: createWarehouseService(
        rpcClient,
        { configured: true, viewCost },
      ),
      rpcClient,
      configured: true,
    })
  }

  assert.deepEqual(await bridgeFor(terminal).submitWarehouseArrival(input), terminal)
  await assert.rejects(
    bridgeFor({
      ...terminal,
      lines: [{ ...terminal.lines[0], unitCost: 100 }],
    }, true).submitWarehouseArrival(input),
    (error) => error instanceof PurchaseWarehouseBridgeError &&
      error.code === 'PURCHASE_ARRIVAL_FAILED' &&
      !/100|cost|price/iu.test(error.message),
  )
})

test('arrival context validates and freezes server-authoritative active variants and purchase quantities', async () => {
  const supplier = contextPayload()
  const calls = []
  const bridge = createPurchaseWarehouseBridge({
    warehouseService: { submitReceipt: async () => receipt },
    rpcClient: {
      rpc: async (name, args) => {
        calls.push([name, args])
        return { data: supplier, error: null, status: 200 }
      },
    },
    configured: true,
  })

  const context = await bridge.loadArrivalContext()
  assert.deepEqual(calls, [['list_purchase_warehouse_arrivals_secure', {}]])
  assert.deepEqual(context, contextPayload())
  assert.equal(Object.isFrozen(context), true)
  assert.equal(Object.isFrozen(context.variants), true)
  assert.equal(Object.isFrozen(context.variants[0]), true)
  supplier.variants[0].itemName = '供应方后改'
  supplier.purchases[0].remainingQuantity = 999
  assert.equal(context.variants[0].itemName, '空调铜管')
  assert.equal(context.purchases[0].remainingQuantity, 2)
})

test('malformed context and network failure fail closed without a local success result', async () => {
  for (const result of [
    { data: { variants: [], purchases: [{ purchaseRecordKey: 'PO-001' }] }, error: null },
    { data: contextPayload(), error: { message: 'private supplier error' }, status: 503 },
  ]) {
    const bridge = createPurchaseWarehouseBridge({
      warehouseService: { submitReceipt: async () => receipt },
      rpcClient: { rpc: async () => result },
      configured: true,
    })
    await assert.rejects(
      bridge.loadArrivalContext(),
      (error) => error instanceof PurchaseWarehouseBridgeError &&
        !error.message.includes('private supplier error'),
    )
  }

  const bridge = createPurchaseWarehouseBridge({
    warehouseService: {
      async submitReceipt() { throw new Error('network offline') },
    },
    rpcClient: { rpc: async () => ({ data: contextPayload(), error: null }) },
    configured: true,
  })
  await assert.rejects(
    bridge.submitWarehouseArrival({
      purchaseRecordKey: 'PO-001', variantId: VARIANT_ID,
      requestedQuantity: 1, idempotencyKey: 'arrival-network-fail',
    }),
    (error) => error instanceof PurchaseWarehouseBridgeError,
  )
})

test('arrival context accepts normal Supabase optional envelope fields and historical rejected-only receipts', async () => {
  const payload = contextPayload()
  payload.purchases[0] = {
    purchaseRecordKey: 'PO-001', orderedQuantity: 5,
    pendingQuantity: 0, confirmedQuantity: 0, remainingQuantity: 5,
    hasReceipt: true,
  }
  const bridge = createPurchaseWarehouseBridge({
    warehouseService: { submitReceipt: async () => receipt },
    rpcClient: { rpc: async () => ({
      data: payload, error: null, status: 200, statusText: 'OK', count: null,
    }) },
    configured: true,
  })
  assert.deepEqual((await bridge.loadArrivalContext()).purchases[0], payload.purchases[0])
})

test('arrival display status fails closed while authoritative context is loading or unavailable', () => {
  const purchases = contextPayload().purchases
  assert.equal(resolvePurchaseArrivalStatus('loading', 'PO-001', purchases), '状态暂不可用')
  assert.equal(resolvePurchaseArrivalStatus('error', 'PO-001', []), '状态暂不可用')
  assert.equal(resolvePurchaseArrivalStatus('forbidden', 'PO-001', []), '状态暂不可用')
  assert.equal(resolvePurchaseArrivalStatus('ready', 'PO-001', purchases), '部分入库')
  assert.equal(resolvePurchaseArrivalStatus('ready', 'PO-UNKNOWN', purchases), '状态暂不可用')
})

test('known safe warehouse submission failures retain corrective arrival errors', async () => {
  for (const [warehouseCode, bridgeCode, status] of [
    ['WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED', 'PURCHASE_ARRIVAL_REMAINDER_EXCEEDED', 409],
    ['WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT', 'PURCHASE_ARRIVAL_IDEMPOTENCY_CONFLICT', 409],
    ['WAREHOUSE_RESOURCE_INACTIVE', 'PURCHASE_ARRIVAL_RESOURCE_INACTIVE', 409],
    ['ACCESS_DENIED', 'PURCHASE_ARRIVAL_ACCESS_DENIED', 403],
  ]) {
    const bridge = createPurchaseWarehouseBridge({
      warehouseService: {
        async submitReceipt() { throw new WarehouseServiceError(warehouseCode) },
      },
      rpcClient: { rpc: async () => ({ data: contextPayload(), error: null }) },
      configured: true,
    })
    await assert.rejects(
      bridge.submitWarehouseArrival({
        purchaseRecordKey: 'PO-001', variantId: VARIANT_ID,
        requestedQuantity: 1, idempotencyKey: `arrival-${bridgeCode}`,
      }),
      (error) => error instanceof PurchaseWarehouseBridgeError &&
        error.code === bridgeCode && error.status === status,
    )
  }
})

test('bridge rejects extra authority, non-positive quantities and malformed identifiers before dependencies run', async () => {
  let calls = 0
  const bridge = createPurchaseWarehouseBridge({
    warehouseService: { async submitReceipt() { calls += 1; return receipt } },
    rpcClient: { rpc: async () => { calls += 1; return { data: contextPayload(), error: null } } },
    configured: true,
  })
  for (const input of [
    { purchaseRecordKey: 'PO-001', variantId: VARIANT_ID, requestedQuantity: 0, idempotencyKey: 'arrival-1' },
    { purchaseRecordKey: 'PO-001', variantId: 'bad', requestedQuantity: 1, idempotencyKey: 'arrival-1' },
    { purchaseRecordKey: 'PO-001', variantId: VARIANT_ID, requestedQuantity: 1, idempotencyKey: 'arrival-1', unitCost: 1 },
    { purchaseRecordKey: 'PO-001', variantId: VARIANT_ID, requestedQuantity: 1, idempotencyKey: 'arrival-1', submittedBy: EMPLOYEE_ID },
  ]) {
    await assert.rejects(
      bridge.submitWarehouseArrival(input),
      (error) => error instanceof PurchaseWarehouseBridgeError && error.code === 'PURCHASE_ARRIVAL_INPUT_INVALID',
    )
  }
  assert.equal(calls, 0)
})

test('App purchase arrival source cannot call the legacy immediate-inventory RPC path', async () => {
  const source = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')
  const summaryStart = source.indexOf('function PurchaseSummarySection({')
  const summaryEnd = source.indexOf('\nfunction PurchaseCard({', summaryStart)
  assert.notEqual(summaryStart, -1)
  assert.notEqual(summaryEnd, -1)
  const summarySource = source.slice(summaryStart, summaryEnd)
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] })
  let legacyCalls = 0
  let arrivalBridgeCalls = 0
  let immediateHelperDefinitions = 0
  const visit = (node) => {
    if (!node || typeof node !== 'object') return
    if (
      node.type === 'FunctionDeclaration' &&
      ['commitPurchaseStockInMutation', 'mergeInventoryItem'].includes(node.id?.name)
    ) immediateHelperDefinitions += 1
    if (node.type === 'CallExpression' && node.callee?.type === 'MemberExpression') {
      const object = node.callee.object
      const property = node.callee.property
      if (object?.type === 'Identifier' && object.name === 'purchaseService' &&
          property?.type === 'Identifier' && property.name === 'commitStockIn') legacyCalls += 1
      if (object?.type === 'Identifier' && object.name === 'arrivalBridge' &&
          property?.type === 'Identifier' && property.name === 'submitWarehouseArrival') {
        arrivalBridgeCalls += 1
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') visit(value)
    }
  }
  visit(ast)
  assert.equal(legacyCalls, 0)
  assert.equal(arrivalBridgeCalls, 1)
  assert.equal(immediateHelperDefinitions, 0)
  assert.match(source, /arrivalBridge = purchaseWarehouseBridge/u)
  assert.match(source, /提交到货，等待仓库确认/u)
  assert.match(source, /arrivalContextStatus=\{arrivalContext\.status\}/u)
  assert.match(source, /disabled=\{!arrivalStatusReady\}/u)
  assert.match(source, /状态暂不可用/u)
  assert.doesNotMatch(summarySource, /getPurchaseStockInStatus|stockInRecords/u)
  assert.match(summarySource, /resolvePurchaseArrivalStatus/u)
  assert.match(summarySource, /待仓库确认采购数量/u)
  assert.match(summarySource, /入库状态暂不可用/u)
})

test('local demo purchase arrival context stays offline and read failures only escalate when fatal', async () => {
  const context = createOfflinePurchaseArrivalContext([
    { purchaseId: 'PO-001', quantity: 5 },
    { purchaseId: 'PO-ZERO', quantity: 0 },
    { purchaseId: 'bad key', quantity: 2 },
  ])
  assert.deepEqual(context, {
    variants: [],
    purchases: [{
      purchaseRecordKey: 'PO-001', orderedQuantity: 5, pendingQuantity: 0,
      confirmedQuantity: 0, remainingQuantity: 5, hasReceipt: false,
    }],
  })
  assert.equal(Object.isFrozen(context), true)
  assert.equal(Object.isFrozen(context.purchases), true)

  const source = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')
  const pageStart = source.indexOf('export function PurchaseManagementPage({')
  const pageEnd = source.indexOf('\nfunction PurchaseFormSection({', pageStart)
  assert.notEqual(pageStart, -1)
  assert.notEqual(pageEnd, -1)
  const pageSource = source.slice(pageStart, pageEnd)
  const offlineGuard = pageSource.indexOf('if (localDemoMode)')
  const cloudRead = pageSource.indexOf('purchaseWarehouseBridge.loadArrivalContext()')
  assert.notEqual(offlineGuard, -1)
  assert.notEqual(cloudRead, -1)
  assert.ok(offlineGuard < cloudRead)
  assert.match(pageSource, /createOfflinePurchaseArrivalContext\(purchaseRecords\)/u)
  assert.match(pageSource, /const classification = classifyBusinessSourceError\(error\)/u)
  assert.match(pageSource, /if \(classification\.fatal\) onPersistenceError\?\.\(error\)/u)
})

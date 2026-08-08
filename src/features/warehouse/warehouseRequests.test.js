import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildMinorWorkOrderAssignment,
  buildMinorWorkOrderRequest,
  buildWarehouseReceiptRequest,
  buildWarehouseReturnRequest,
  buildWarehouseStockOutRequest,
} from './warehouseRequests.js'

const IDS = Object.freeze({
  project: 'P001',
  minor: '81000000-0000-4000-8000-000000000001',
  stockOut: '82000000-0000-4000-8000-000000000001',
  stockOutLine: '83000000-0000-4000-8000-000000000001',
  variant: '84000000-0000-4000-8000-000000000001',
  warehouse: '85000000-0000-4000-8000-000000000001',
  location: '86000000-0000-4000-8000-000000000001',
})

test('request builders normalize exact pending workflow payloads without client audit or price fields', () => {
  const minor = buildMinorWorkOrderRequest({
    title: ' 安装空调 ',
    customerName: ' 未来社 ',
    workDate: '2026-08-09',
    locationText: ' 東京都港区 ',
    description: ' Cafe\u0301 店安装一台 ',
  })
  const receipt = buildWarehouseReceiptRequest({
    purchaseRecordKey: 'BUY-001',
    idempotencyKey: 'receipt-20260809-001',
    lines: [{
      variantId: IDS.variant,
      requestedQuantity: 2.125,
      warehouseId: null,
      locationId: null,
    }],
  })
  const outbound = buildWarehouseStockOutRequest({
    destinationType: 'minor_work_order',
    projectId: null,
    minorWorkOrderId: IDS.minor,
    destinationNameSnapshot: ' 未来社・空调安装 ',
    purpose: ' 安装使用 ',
    receiver: ' 王师傅 ',
    requestDate: '2026-08-09',
    idempotencyKey: 'out-20260809-001',
    lines: [{ variantId: IDS.variant, requestedQuantity: 1 }],
  })
  const returned = buildWarehouseReturnRequest({
    originalStockOutId: IDS.stockOut,
    reason: ' 未使用 ',
    receiver: ' 仓库负责人 ',
    requestDate: '2026-08-10',
    idempotencyKey: 'return-20260810-001',
    lines: [{ originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 0.5 }],
  })

  assert.deepEqual(minor, {
    p_payload: {
      title: '安装空调', customerName: '未来社', workDate: '2026-08-09',
      locationText: '東京都港区', description: 'Café 店安装一台',
    },
  })
  assert.deepEqual(receipt, {
    p_purchase_record_key: 'BUY-001',
    p_lines: [{
      variantId: IDS.variant, requestedQuantity: 2.125,
      warehouseId: null, locationId: null,
    }],
    p_idempotency_key: 'receipt-20260809-001',
  })
  assert.deepEqual(outbound, {
    p_request: {
      destinationType: 'minor_work_order', projectId: null,
      minorWorkOrderId: IDS.minor, destinationNameSnapshot: '未来社・空调安装',
      purpose: '安装使用', receiver: '王师傅', requestDate: '2026-08-09',
    },
    p_lines: [{ variantId: IDS.variant, requestedQuantity: 1 }],
    p_idempotency_key: 'out-20260809-001',
  })
  assert.deepEqual(returned, {
    p_original_stock_out_id: IDS.stockOut,
    p_request: { reason: '未使用', receiver: '仓库负责人', requestDate: '2026-08-10' },
    p_lines: [{ originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 0.5 }],
    p_idempotency_key: 'return-20260810-001',
  })
  for (const value of [minor, minor.p_payload, receipt, receipt.p_lines, receipt.p_lines[0], outbound, returned]) {
    assert.equal(Object.isFrozen(value), true)
  }
})

test('destination contracts require exactly the matching project, minor order or internal-use fields', () => {
  const base = {
    destinationNameSnapshot: '领用目的地', purpose: '安装', receiver: '王师傅',
    requestDate: '2026-08-09', idempotencyKey: 'out-1',
    lines: [{ variantId: IDS.variant, requestedQuantity: 1 }],
  }
  const valid = [
    { ...base, destinationType: 'project', projectId: IDS.project, minorWorkOrderId: null },
    { ...base, destinationType: 'minor_work_order', projectId: null, minorWorkOrderId: IDS.minor },
    { ...base, destinationType: 'internal_use', projectId: null, minorWorkOrderId: null },
  ]
  for (const input of valid) assert.doesNotThrow(() => buildWarehouseStockOutRequest(input))

  for (const input of [
    { ...base, destinationType: 'project', projectId: null, minorWorkOrderId: null },
    { ...base, destinationType: 'project', projectId: IDS.project, minorWorkOrderId: IDS.minor },
    { ...base, destinationType: 'minor_work_order', projectId: IDS.project, minorWorkOrderId: IDS.minor },
    { ...base, destinationType: 'internal_use', projectId: IDS.project, minorWorkOrderId: null },
    { ...base, destinationType: 'other', projectId: null, minorWorkOrderId: null },
    { ...base, destinationType: 'internal_use', projectId: null, minorWorkOrderId: null, purpose: '' },
    { ...base, destinationType: 'internal_use', projectId: null, minorWorkOrderId: null, destinationNameSnapshot: '' },
  ]) assert.throws(() => buildWarehouseStockOutRequest(input), TypeError)
})

test('builders reject extra/accessor/client-authority fields, invalid dates, ids and decimal quantities', () => {
  const baseReceipt = {
    purchaseRecordKey: 'BUY-001', idempotencyKey: 'receipt-1',
    lines: [{
      variantId: IDS.variant, requestedQuantity: 1,
      warehouseId: IDS.warehouse, locationId: IDS.location,
    }],
  }
  const accessor = { ...baseReceipt }
  let getterCalls = 0
  Object.defineProperty(accessor, 'lines', {
    enumerable: true,
    get() { getterCalls += 1; return [] },
  })
  for (const input of [
    { ...baseReceipt, submittedByEmployeeProfileId: IDS.variant },
    { ...baseReceipt, lines: [{ ...baseReceipt.lines[0], unitCost: 100 }] },
    { ...baseReceipt, lines: [{ ...baseReceipt.lines[0], requestedQuantity: 0 }] },
    { ...baseReceipt, lines: [{ ...baseReceipt.lines[0], requestedQuantity: 1.0001 }] },
    { ...baseReceipt, lines: [{ ...baseReceipt.lines[0], variantId: 'bad' }] },
    { ...baseReceipt, lines: [] },
    accessor,
  ]) assert.throws(() => buildWarehouseReceiptRequest(input), TypeError)
  assert.equal(getterCalls, 0)

  assert.throws(() => buildWarehouseReceiptRequest({
    ...baseReceipt,
    lines: [{ ...baseReceipt.lines[0], warehouseId: null }],
  }), TypeError)
  assert.throws(() => buildWarehouseReceiptRequest({
    ...baseReceipt,
    lines: [{ ...baseReceipt.lines[0], locationId: null }],
  }), TypeError)

  assert.throws(() => buildMinorWorkOrderRequest({
    title: '安装空调', customerName: '', workDate: '2026-02-30',
    locationText: '东京', description: '',
  }), TypeError)
  assert.throws(() => buildWarehouseReturnRequest({
    originalStockOutId: IDS.stockOut, reason: '退回', receiver: '仓库',
    requestDate: '2026-08-10', idempotencyKey: 'return-1',
    lines: [{ originalStockOutLineId: IDS.stockOutLine, requestedQuantity: -1 }],
  }), TypeError)
})

test('minor-work assignment accepts only an exact minor UUID and existing project record key', () => {
  assert.deepEqual(buildMinorWorkOrderAssignment({
    minorWorkOrderId: IDS.minor,
    projectId: IDS.project,
  }), {
    p_minor_work_order_id: IDS.minor,
    p_project_id: IDS.project,
  })
  assert.throws(() => buildMinorWorkOrderAssignment({
    minorWorkOrderId: IDS.minor,
    projectId: '',
  }), TypeError)
})

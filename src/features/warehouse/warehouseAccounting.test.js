import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertManualProjectCostAmount,
  calculateProjectMaterialProfitabilityCost,
  getMinorWorkOrderMaterialCost,
  isWarehouseManagedProjectCost,
  sumProjectCostRecords,
  toSignedFiniteAmount,
} from './warehouseAccounting.js'

test('warehouse accounting preserves signed finite costs and rejects invalid manual amounts', () => {
  assert.equal(toSignedFiniteAmount('240'), 240)
  assert.equal(toSignedFiniteAmount('-90'), -90)
  assert.equal(toSignedFiniteAmount(Number.NaN), 0)
  assert.equal(toSignedFiniteAmount(Number.POSITIVE_INFINITY), 0)
  assert.equal(sumProjectCostRecords([{ amount: 240 }, { amount: -90 }]), 150)

  for (const amount of ['', 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => assertManualProjectCostAmount(amount), /项目成本金额必须大于 0/)
  }
})

test('confirmed warehouse receipts replace purchase cost with signed warehouse project costs', () => {
  const purchases = [
    { purchaseId: 'PO-WAREHOUSE', projectId: 'P-001', purchaseStatus: '正常', totalCost: 1000 },
    { purchaseId: 'PO-DIRECT', projectId: 'P-001', purchaseStatus: '正常', totalCost: 300 },
  ]
  const stockInRecords = [{
    stockInId: 'SI-001',
    sourcePurchaseId: 'PO-WAREHOUSE',
    status: '已确认',
  }]
  const projectCostRecords = [
    { projectId: 'P-001', sourceType: 'warehouse', amount: 450 },
    { projectId: 'P-001', sourceType: 'warehouse', amount: -90 },
  ]

  assert.equal(calculateProjectMaterialProfitabilityCost({
    projectId: 'P-001',
    purchases,
    stockInRecords,
    projectCostRecords,
  }), 660)
})

test('minor-work material cost is the exact frozen sum of confirmed outbound lines only', () => {
  const requests = [
    {
      id: 'SO-1', destinationType: 'minor_work_order', minorWorkOrderId: 'MW-1', status: '已确认',
      lines: [{ frozenTotalCost: 300 }, { frozenTotalCost: 160 }],
    },
    {
      id: 'SO-2', destinationType: 'minor_work_order', minorWorkOrderId: 'MW-1', status: '待确认',
      lines: [{ frozenTotalCost: 999 }],
    },
    {
      id: 'SO-3', destinationType: 'minor_work_order', minorWorkOrderId: 'MW-2', status: '已确认',
      lines: [{ frozenTotalCost: 800 }],
    },
    {
      id: 'SO-4', destinationType: 'internal_use', minorWorkOrderId: 'MW-1', status: '已确认',
      lines: [{ frozenTotalCost: 700 }],
    },
  ]

  assert.equal(getMinorWorkOrderMaterialCost('MW-1', requests), 460)
  assert.equal(getMinorWorkOrderMaterialCost('MW-9', requests), 0)
})

test('minor-work material cost fails closed on malformed confirmed frozen cost', () => {
  for (const frozenTotalCost of [null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, 900719925474.0992]) {
    assert.throws(() => getMinorWorkOrderMaterialCost('MW-1', [{
      destinationType: 'minor_work_order', minorWorkOrderId: 'MW-1', status: '已确认',
      lines: [{ frozenTotalCost }],
    }]), /小工事出库成本数据无效/u)
  }
})

test('minor-work material cost aggregates frozen rows in exact 1/10000 yen units', () => {
  assert.equal(getMinorWorkOrderMaterialCost('MW-1', [{
    destinationType: 'minor_work_order', minorWorkOrderId: 'MW-1', status: '已确认',
    lines: [
      { frozenTotalCost: 0.1 },
      { frozenTotalCost: 0.2 },
      { frozenTotalCost: 1.005 },
    ],
  }]), 1.305)
})

test('warehouse and warehouse reversal project costs are immutable managed records', () => {
  assert.equal(isWarehouseManagedProjectCost({ sourceType: 'warehouse' }), true)
  assert.equal(isWarehouseManagedProjectCost({ sourceType: 'warehouseReversal' }), true)
  assert.equal(isWarehouseManagedProjectCost({ sourceType: 'manual' }), false)
})

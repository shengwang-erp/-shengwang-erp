import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertManualProjectCostAmount,
  calculateProjectMaterialProfitabilityCost,
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

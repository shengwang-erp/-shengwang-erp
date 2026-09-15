import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCustomerReceiptViewModel,
  prepareCustomerReceiptInput,
} from './customerReceipts.js'

const project = {
  projectId: 'P-DYNAMIC',
  contractRevenueSchemaVersion: 1,
  contractRevenueSetupStatus: 'configured',
  contractConfirmationStatus: 'confirmed',
  originalContractTaxExclusiveAmount: 909092,
  originalContractTaxRate: 10,
  originalContractTaxAmount: 90909,
  originalContractTaxInclusiveAmount: 1000001,
}

const actor = { employeeId: 'E-1', name: '会计' }

const plans = [
  { planId: 'plan-a', projectId: 'P-DYNAMIC', installmentOrder: 1, name: '订金', allocationWeight: 25, plannedTaxInclusiveAmount: 250001, statusCode: 'active' },
  { planId: 'plan-b', projectId: 'P-DYNAMIC', installmentOrder: 2, name: '进场款', allocationWeight: 25, plannedTaxInclusiveAmount: 250000, statusCode: 'active' },
  { planId: 'plan-c', projectId: 'P-DYNAMIC', installmentOrder: 3, name: '材料款', allocationWeight: 25, plannedTaxInclusiveAmount: 250000, statusCode: 'active' },
  { planId: 'plan-d', projectId: 'P-DYNAMIC', installmentOrder: 4, name: '验收款', allocationWeight: 25, plannedTaxInclusiveAmount: 250000, statusCode: 'active' },
]

test('receipt input links directly to a stable planId instead of a fixed stage', () => {
  const input = prepareCustomerReceiptInput(project, plans, {
    planId: 'plan-c',
    taxInclusiveAmount: 100000,
    receivedDate: '2026-09-15',
    paymentMethod: '银行转账',
  }, actor)

  assert.equal(input.planId, 'plan-c')
  assert.equal(input.stage, 'installment')
})

test('receipt input permits unallocated receipts but rejects unknown plan IDs', () => {
  const unallocated = prepareCustomerReceiptInput(project, plans, {
    planId: '',
    taxInclusiveAmount: 50000,
    receivedDate: '2026-09-15',
    paymentMethod: '现金',
  }, actor)
  assert.equal(unallocated.planId, null)
  assert.equal(unallocated.stage, 'unallocated')

  assert.throws(() => prepareCustomerReceiptInput(project, plans, {
    planId: 'missing-plan',
    taxInclusiveAmount: 50000,
    receivedDate: '2026-09-15',
    paymentMethod: '现金',
  }, actor), /收款计划/)
})

test('view model renders every installment and aggregates multiple receipts by planId', () => {
  const view = buildCustomerReceiptViewModel({
    project,
    adjustedTaxInclusiveAmount: 1000001,
    paymentPlans: plans,
    receipts: [
      { receiptId: 'r1', projectId: 'P-DYNAMIC', planId: 'plan-c', taxInclusiveAmount: 40000, receivedDate: '2026-09-14', statusCode: 'active' },
      { receiptId: 'r2', projectId: 'P-DYNAMIC', planId: 'plan-c', taxInclusiveAmount: 60000, receivedDate: '2026-09-15', statusCode: 'active' },
    ],
  })

  assert.deepEqual(view.stageSummaries.slice(0, 4).map((item) => item.label), ['订金', '进场款', '材料款', '验收款'])
  assert.equal(view.stageSummaries[2].receivedTaxInclusiveAmount, 100000)
  assert.equal(view.stageSummaries[2].activeReceiptCount, 2)
  assert.equal(view.stageSummaries[2].locked, true)
  assert.deepEqual(view.lockedPlanIds, ['plan-c'])
})

test('legacy stage-only receipt still resolves to its historical planId', () => {
  const legacyPlans = [
    { planId: 'legacy-initial', projectId: 'P-DYNAMIC', stage: 'initial', plannedTaxInclusiveAmount: 300000, statusCode: 'active' },
    { planId: 'legacy-middle', projectId: 'P-DYNAMIC', stage: 'middle', plannedTaxInclusiveAmount: 400000, statusCode: 'active' },
    { planId: 'legacy-final', projectId: 'P-DYNAMIC', stage: 'final', plannedTaxInclusiveAmount: 300001, statusCode: 'active' },
  ]
  const view = buildCustomerReceiptViewModel({
    project,
    adjustedTaxInclusiveAmount: 1000001,
    paymentPlans: legacyPlans,
    receipts: [{ receiptId: 'legacy-r', projectId: 'P-DYNAMIC', stage: 'initial', taxInclusiveAmount: 100000, statusCode: 'active' }],
  })
  assert.equal(view.stageSummaries[0].planId, 'legacy-initial')
  assert.equal(view.stageSummaries[0].locked, true)
})

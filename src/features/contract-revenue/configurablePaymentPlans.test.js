import assert from 'node:assert/strict'
import test from 'node:test'

import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const paymentPlans = await import('./paymentPlans.js').catch(() => ({}))

function requireExport(name) {
  assert.equal(typeof paymentPlans[name], 'function', `${name} must be exported`)
  return paymentPlans[name]
}

const project = {
  projectId: 'P200',
  contractRevenueSchemaVersion: 1,
  contractConfirmationStatus: 'confirmed',
}
const actor = { employeeId: 'E009', name: '会计王' }
const legacy = [
  { planId: 'plan-initial', projectId: 'P200', stage: 'initial', allocationWeight: 30, plannedTaxInclusiveAmount: 330000, dueDate: '2026-08-01', remark: '签约后支付', statusCode: 'active' },
  { planId: 'plan-middle', projectId: 'P200', stage: 'middle', allocationWeight: 40, plannedTaxInclusiveAmount: 440000, dueDate: '2026-09-01', remark: '中期验收', statusCode: 'active' },
  { planId: 'plan-final', projectId: 'P200', stage: 'final', allocationWeight: 30, plannedTaxInclusiveAmount: 330000, dueDate: '2026-10-01', remark: '竣工验收', statusCode: 'active' },
]

function validationField(field) {
  return (error) => error instanceof ContractRevenueValidationError && error.field === field
}

test('legacy three-stage plans normalize without changing stable IDs or business values', () => {
  const normalizePaymentPlans = requireExport('normalizePaymentPlans')
  assert.deepEqual(normalizePaymentPlans(legacy, 'P200').map((plan) => ({
    planId: plan.planId, installmentOrder: plan.installmentOrder, name: plan.name,
    allocationWeight: plan.allocationWeight, amount: plan.plannedTaxInclusiveAmount,
  })), [
    { planId: 'plan-initial', installmentOrder: 1, name: '首期款', allocationWeight: 30, amount: 330000 },
    { planId: 'plan-middle', installmentOrder: 2, name: '中期款', allocationWeight: 40, amount: 440000 },
    { planId: 'plan-final', installmentOrder: 3, name: '尾款', allocationWeight: 30, amount: 330000 },
  ])
})

test('new plans start as three stable blank installments without default allocation', () => {
  const createBlankPaymentPlans = requireExport('createBlankPaymentPlans')
  let sequence = 0
  assert.deepEqual(createBlankPaymentPlans('P200', 3, { createId: () => `draft-${++sequence}` }), [
    { planId: 'draft-1', projectId: 'P200', installmentOrder: 1, name: '第1期', allocationWeight: '', plannedTaxInclusiveAmount: '', dueDate: '', remark: '', statusCode: 'active' },
    { planId: 'draft-2', projectId: 'P200', installmentOrder: 2, name: '第2期', allocationWeight: '', plannedTaxInclusiveAmount: '', dueDate: '', remark: '', statusCode: 'active' },
    { planId: 'draft-3', projectId: 'P200', installmentOrder: 3, name: '第3期', allocationWeight: '', plannedTaxInclusiveAmount: '', dueDate: '', remark: '', statusCode: 'active' },
  ])
})

test('six installment preview uses basis points and final installment absorbs yen remainder', () => {
  const preview = requireExport('calculatePaymentPlanAmountPreview')
  const plans = ['16.67', '16.67', '16.67', '16.67', '16.66', '16.66'].map((allocationWeight, index) => ({
    planId: `plan-${index + 1}`, installmentOrder: index + 1, allocationWeight,
  }))
  assert.deepEqual(preview(1000001, plans), {
    'plan-1': 166700, 'plan-2': 166700, 'plan-3': 166700,
    'plan-4': 166700, 'plan-5': 166600, 'plan-6': 166601,
  })
})

test('percentage validation rejects floating precision beyond two decimals', () => {
  const preview = requireExport('calculatePaymentPlanAmountPreview')
  assert.throws(() => preview(1000000, [
    { planId: 'plan-1', installmentOrder: 1, allocationWeight: '33.333' },
    { planId: 'plan-2', installmentOrder: 2, allocationWeight: '66.667' },
  ]), validationField('plan-1.allocationWeight'))
})

test('plan-set save preserves a received installment and deletes only unpaid installments', () => {
  const prepare = requireExport('preparePaymentPlanSetSave')
  const result = prepare({
    project, adjustedTaxInclusiveAmount: 1100000, currentPlans: legacy,
    proposedPlans: [
      { ...legacy[0], installmentOrder: 1, name: '首期款' },
      { ...legacy[2], installmentOrder: 2, name: '竣工尾款', allocationWeight: 70, plannedTaxInclusiveAmount: 770000 },
    ],
    receipts: [{ receiptId: 'r1', projectId: 'P200', planId: 'plan-initial', stage: 'initial', taxInclusiveAmount: 100000, statusCode: 'active' }],
    actor,
  })
  assert.deepEqual(result.map((plan) => plan.planId), ['plan-initial', 'plan-final'])
  assert.equal(result[0].plannedTaxInclusiveAmount, 330000)
  assert.equal(result[1].plannedTaxInclusiveAmount, 770000)
})

test('plan-set save rejects deleting or changing an installment with a linked receipt', () => {
  const prepare = requireExport('preparePaymentPlanSetSave')
  const receipts = [{ receiptId: 'r1', projectId: 'P200', planId: 'plan-initial', stage: 'initial', taxInclusiveAmount: 100000, statusCode: 'active' }]
  const base = { project, adjustedTaxInclusiveAmount: 1100000, currentPlans: legacy, receipts, actor }
  assert.throws(() => prepare({
    ...base,
    proposedPlans: legacy.slice(1).map((plan, index) => ({ ...plan, installmentOrder: index + 1 })),
  }), validationField('plan-initial.planId'))
  assert.throws(() => prepare({
    ...base,
    proposedPlans: legacy.map((plan, index) => ({ ...plan, installmentOrder: index + 1, plannedTaxInclusiveAmount: index === 0 ? 329999 : plan.plannedTaxInclusiveAmount })),
  }), validationField('plan-initial.plannedTaxInclusiveAmount'))
})

test('existing editor reports contract difference without silently reallocating stored amounts', () => {
  const buildEditor = requireExport('buildPaymentPlanEditorState')
  const state = buildEditor({
    project, adjustedTaxInclusiveAmount: 1320000, paymentPlans: legacy,
    receipts: [{ receiptId: 'r1', projectId: 'P200', planId: 'plan-initial', stage: 'initial', taxInclusiveAmount: 100000, statusCode: 'active' }],
  })
  assert.deepEqual(state.plans.map((plan) => plan.plannedTaxInclusiveAmount), [330000, 440000, 330000])
  assert.equal(state.contractDifference, 220000)
  assert.equal(state.hasPendingReallocation, false)
  assert.deepEqual(state.lockedPlanIds, ['plan-initial'])
})

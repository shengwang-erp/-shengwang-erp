import assert from 'node:assert/strict'
import test from 'node:test'

import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const paymentPlans = await import('./paymentPlans.js').catch(() => ({}))

function requireExport(name) {
  assert.equal(typeof paymentPlans[name], 'function', `${name} must be exported`)
  return paymentPlans[name]
}

function confirmedProject(overrides = {}) {
  return {
    projectId: 'P200',
    projectName: '三期收款项目',
    contractRevenueSchemaVersion: 1,
    contractConfirmationStatus: 'confirmed',
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 100000,
    originalContractTaxInclusiveAmount: 1100000,
    ...overrides,
  }
}

const actor = { employeeId: 'E009', name: '会计王' }

const stageDefaults = {
  initial: { allocationWeight: 30, dueDate: '2026-08-01', remark: '签约后支付' },
  middle: { allocationWeight: 40, dueDate: '2026-09-01', remark: '中期验收' },
  final: { allocationWeight: 30, dueDate: '2026-10-01', remark: '竣工验收' },
}

function proposedPlan(stage, overrides = {}) {
  return {
    projectId: 'P200',
    stage,
    plannedTaxInclusiveAmount: 0,
    ...stageDefaults[stage],
    ...overrides,
  }
}

function storedPlan(stage, overrides = {}) {
  const amounts = { initial: 330000, middle: 440000, final: 330000 }
  return {
    planId: `plan-${stage}`,
    statusCode: 'active',
    createdById: 'E001',
    createdByName: '旧会计',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...proposedPlan(stage, {
      plannedTaxInclusiveAmount: amounts[stage],
    }),
    ...overrides,
  }
}

function receipt(stage, amount = 100000, overrides = {}) {
  return {
    receiptId: `receipt-${stage}`,
    projectId: 'P200',
    stage,
    taxInclusiveAmount: amount,
    statusCode: 'active',
    ...overrides,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertValidationError(field) {
  return (error) => {
    assert.ok(error instanceof ContractRevenueValidationError)
    assert.equal(error.field, field)
    return true
  }
}

test('only confirmed and historical confirmed projects can manage payment plans', () => {
  const canManagePaymentPlans = requireExport('canManagePaymentPlans')
  const preparePaymentPlanSave = requireExport('preparePaymentPlanSave')
  const PaymentPlanStateError = requireExport('PaymentPlanStateError')

  assert.equal(canManagePaymentPlans(confirmedProject()), true)
  assert.equal(
    canManagePaymentPlans(
      confirmedProject({ contractConfirmationStatus: 'historical_migrated_confirmed' }),
    ),
    true,
  )
  assert.equal(
    canManagePaymentPlans(confirmedProject({ contractConfirmationStatus: 'draft' })),
    false,
  )
  assert.equal(
    canManagePaymentPlans({ projectId: 'P-LEGACY', contractAmount: 1100000 }),
    false,
  )

  for (const project of [
    confirmedProject({ contractConfirmationStatus: 'draft' }),
    { projectId: 'P-LEGACY', contractAmount: 1100000, paidAmount: 0 },
  ]) {
    assert.throws(
      () =>
        preparePaymentPlanSave({
          project,
          adjustedTaxInclusiveAmount: 1100000,
          proposedPlans: ['initial', 'middle', 'final'].map((stage) =>
            proposedPlan(stage),
          ),
          actor,
        }),
      (error) => error instanceof PaymentPlanStateError,
    )
  }
})

test('first save requires exactly 100 percent and stores rounded yen amounts with final absorbing remainder', () => {
  const preparePaymentPlanSave = requireExport('preparePaymentPlanSave')
  const input = ['initial', 'middle', 'final'].map((stage) => proposedPlan(stage))
  const original = clone(input)

  const result = preparePaymentPlanSave({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1000001,
    currentPlans: [],
    proposedPlans: input,
    receipts: [],
    actor,
  })

  assert.deepEqual(
    result.map((plan) => ({
      stage: plan.stage,
      allocationWeight: plan.allocationWeight,
      plannedTaxInclusiveAmount: plan.plannedTaxInclusiveAmount,
    })),
    [
      { stage: 'initial', allocationWeight: 30, plannedTaxInclusiveAmount: 300000 },
      { stage: 'middle', allocationWeight: 40, plannedTaxInclusiveAmount: 400000 },
      { stage: 'final', allocationWeight: 30, plannedTaxInclusiveAmount: 300001 },
    ],
  )
  assert.equal(result.reduce((sum, plan) => sum + plan.plannedTaxInclusiveAmount, 0), 1000001)
  assert.equal(result[0].projectId, 'P200')
  assert.equal(result[0].createdById, 'E009')
  assert.equal(result[0].createdByName, '会计王')
  assert.equal(Object.hasOwn(result[0], 'planId'), false)
  assert.deepEqual(input, original)
})

test('amount preview uses the same final-stage rounding rule before the first save', () => {
  const calculatePaymentPlanAmountPreview = requireExport(
    'calculatePaymentPlanAmountPreview',
  )

  assert.deepEqual(
    calculatePaymentPlanAmountPreview(1000001, [
      { stage: 'initial', allocationWeight: '30' },
      { stage: 'middle', allocationWeight: '40' },
      { stage: 'final', allocationWeight: '30' },
    ]),
    {
      initial: 300000,
      middle: 400000,
      final: 300001,
    },
  )
})

test('first save rejects a percentage total other than 100 and invalid agreed dates', () => {
  const preparePaymentPlanSave = requireExport('preparePaymentPlanSave')
  const base = {
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1100000,
    currentPlans: [],
    receipts: [],
    actor,
  }

  assert.throws(
    () =>
      preparePaymentPlanSave({
        ...base,
        proposedPlans: [
          proposedPlan('initial'),
          proposedPlan('middle'),
          proposedPlan('final', { allocationWeight: 29 }),
        ],
      }),
    assertValidationError('allocationWeightTotal'),
  )
  assert.throws(
    () =>
      preparePaymentPlanSave({
        ...base,
        proposedPlans: [
          proposedPlan('initial'),
          proposedPlan('middle', { dueDate: '2026-02-30' }),
          proposedPlan('final'),
        ],
      }),
    assertValidationError('middle.dueDate'),
  )
})

test.skip('editor state locks received stages and reallocates only unpaid stages after a contract change', () => {
  const buildPaymentPlanEditorState = requireExport('buildPaymentPlanEditorState')
  const currentPlans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const original = clone(currentPlans)

  const state = buildPaymentPlanEditorState({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1320000,
    paymentPlans: currentPlans,
    receipts: [receipt('initial')],
  })

  assert.equal(state.mode, 'automatic')
  assert.equal(state.allocationStatus, 'auto_allocated')
  assert.equal(state.hasPendingReallocation, true)
  assert.deepEqual(state.lockedStages, ['initial'])
  assert.deepEqual(
    state.plans.map((plan) => ({
      stage: plan.stage,
      amount: plan.plannedTaxInclusiveAmount,
      locked: plan.locked,
    })),
    [
      { stage: 'initial', amount: 330000, locked: true },
      { stage: 'middle', amount: 565714, locked: false },
      { stage: 'final', amount: 424286, locked: false },
    ],
  )
  assert.deepEqual(currentPlans, original)
})

test('automatic save preserves locked amount, weight and stage while persisting reallocated amounts', () => {
  const buildPaymentPlanEditorState = requireExport('buildPaymentPlanEditorState')
  const preparePaymentPlanSave = requireExport('preparePaymentPlanSave')
  const currentPlans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const receipts = [receipt('initial')]
  const editor = buildPaymentPlanEditorState({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1320000,
    paymentPlans: currentPlans,
    receipts,
  })

  const result = preparePaymentPlanSave({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1320000,
    currentPlans,
    proposedPlans: editor.plans,
    receipts,
    actor,
  })

  assert.deepEqual(
    result.map((plan) => plan.plannedTaxInclusiveAmount),
    [330000, 565714, 424286],
  )
  assert.equal(result[0].allocationWeight, 30)
  assert.equal(result[0].stage, 'initial')
  assert.equal(result[0].updatedById, 'E009')
  assert.equal(result[0].updatedByName, '会计王')
  assert.equal(result[0].createdById, 'E001')
})

test('received stage amount, percentage and stage type cannot be changed', () => {
  const preparePaymentPlanSave = requireExport('preparePaymentPlanSave')
  const currentPlans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const receipts = [receipt('initial')]
  const base = {
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1100000,
    currentPlans,
    receipts,
    actor,
    mode: 'manual',
  }

  assert.throws(
    () =>
      preparePaymentPlanSave({
        ...base,
        proposedPlans: currentPlans.map((plan) =>
          plan.stage === 'initial'
            ? { ...plan, plannedTaxInclusiveAmount: 329999 }
            : plan,
        ),
      }),
    assertValidationError('plan-initial.plannedTaxInclusiveAmount'),
  )
  assert.throws(
    () =>
      preparePaymentPlanSave({
        ...base,
        proposedPlans: currentPlans.map((plan) =>
          plan.stage === 'initial' ? { ...plan, allocationWeight: 29 } : plan,
        ),
      }),
    assertValidationError('plan-initial.allocationWeight'),
  )
  assert.throws(
    () =>
      preparePaymentPlanSave({
        ...base,
        proposedPlans: currentPlans.map((plan) =>
          plan.stage === 'initial' ? { ...plan, stage: 'middle' } : plan,
        ),
      }),
    assertValidationError('plan-initial.stage'),
  )
})

test.skip('automatic allocation failure requires accounting action and manual amounts must match contract total', () => {
  const buildPaymentPlanEditorState = requireExport('buildPaymentPlanEditorState')
  const preparePaymentPlanSave = requireExport('preparePaymentPlanSave')
  const currentPlans = [
    storedPlan('initial'),
    storedPlan('middle', { allocationWeight: '' }),
    storedPlan('final', { allocationWeight: 0 }),
  ]
  const receipts = [receipt('initial')]
  const state = buildPaymentPlanEditorState({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1320000,
    paymentPlans: currentPlans,
    receipts,
  })

  assert.equal(state.mode, 'manual')
  assert.equal(state.allocationStatus, 'manual_review_required')
  assert.equal(state.needsAccountingAction, true)
  assert.equal(state.allocationReason, 'invalid_allocation_weights')
  assert.deepEqual(state.lockedStages, ['initial'])

  const proposedPlans = [
    { ...currentPlans[0] },
    {
      ...currentPlans[1],
      allocationWeight: 40,
      plannedTaxInclusiveAmount: 565714,
    },
    {
      ...currentPlans[2],
      allocationWeight: 30,
      plannedTaxInclusiveAmount: 424286,
    },
  ]
  const saved = preparePaymentPlanSave({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1320000,
    currentPlans,
    proposedPlans,
    receipts,
    actor,
    mode: 'manual',
  })
  assert.deepEqual(
    saved.map((plan) => plan.plannedTaxInclusiveAmount),
    [330000, 565714, 424286],
  )

  assert.throws(
    () =>
      preparePaymentPlanSave({
        project: confirmedProject(),
        adjustedTaxInclusiveAmount: 1320000,
        currentPlans,
        proposedPlans: proposedPlans.map((plan) =>
          plan.stage === 'final'
            ? { ...plan, plannedTaxInclusiveAmount: 424285 }
            : plan,
        ),
        receipts,
        actor,
        mode: 'manual',
      }),
    assertValidationError('paymentPlanTotal'),
  )
})

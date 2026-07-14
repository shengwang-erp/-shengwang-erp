import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPaymentPlanEditorState } from './paymentPlans.js'
import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const customerReceipts = await import('./customerReceipts.js').catch(() => ({}))

function requireExport(name) {
  assert.equal(typeof customerReceipts[name], 'function', `${name} must be exported`)
  return customerReceipts[name]
}

function confirmedProject(overrides = {}) {
  return {
    projectId: 'P300',
    projectName: '客户收款项目',
    contractRevenueSchemaVersion: 1,
    contractRevenueSetupStatus: 'configured',
    contractConfirmationStatus: 'confirmed',
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 100000,
    originalContractTaxInclusiveAmount: 1100000,
    ...overrides,
  }
}

const actor = { employeeId: 'E009', name: '会计王' }

function storedPlan(stage, overrides = {}) {
  const amounts = { initial: 330000, middle: 440000, final: 330000 }
  return {
    planId: `plan-${stage}`,
    projectId: 'P300',
    stage,
    allocationWeight: { initial: 30, middle: 40, final: 30 }[stage],
    plannedTaxInclusiveAmount: amounts[stage],
    dueDate: '2026-08-01',
    statusCode: 'active',
    ...overrides,
  }
}

function receiptInput(overrides = {}) {
  return {
    stage: 'initial',
    taxInclusiveAmount: '120000',
    receivedDate: '2026-07-14',
    paymentMethod: '银行转账',
    bankReference: 'BANK-20260714-001',
    remark: '首期款第一次到账',
    ...overrides,
  }
}

function storedReceipt(overrides = {}) {
  return {
    receiptId: 'receipt-1',
    projectId: 'P300',
    planId: 'plan-initial',
    stage: 'initial',
    taxInclusiveAmount: 120000,
    receivedDate: '2026-07-14',
    paymentMethod: '银行转账',
    bankReference: 'BANK-20260714-001',
    remark: '首期款第一次到账',
    statusCode: 'active',
    createdById: 'E009',
    createdByName: '会计王',
    createdAt: '2026-07-14T06:00:00.000Z',
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

test('only confirmed and historical confirmed projects can register customer receipts', () => {
  const canManageCustomerReceipts = requireExport('canManageCustomerReceipts')
  const prepareCustomerReceiptInput = requireExport('prepareCustomerReceiptInput')
  const CustomerReceiptStateError = requireExport('CustomerReceiptStateError')
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))

  assert.equal(canManageCustomerReceipts(confirmedProject()), true)
  assert.equal(
    canManageCustomerReceipts(
      confirmedProject({
        contractConfirmationStatus: 'historical_migrated_confirmed',
        needsManualReview: true,
      }),
    ),
    true,
  )
  assert.equal(
    canManageCustomerReceipts(
      confirmedProject({ contractConfirmationStatus: 'draft' }),
    ),
    false,
  )
  assert.equal(
    canManageCustomerReceipts({
      projectId: 'P-LEGACY',
      contractAmount: 1100000,
      paidAmount: 0,
    }),
    false,
  )

  for (const project of [
    confirmedProject({ contractConfirmationStatus: 'draft' }),
    { projectId: 'P-LEGACY', contractAmount: 1100000, paidAmount: 0 },
  ]) {
    assert.throws(
      () => prepareCustomerReceiptInput(project, plans, receiptInput(), actor),
      (error) => error instanceof CustomerReceiptStateError,
    )
  }
})

test('a planned-stage receipt is normalized, linked to its plan and records the operator', () => {
  const prepareCustomerReceiptInput = requireExport('prepareCustomerReceiptInput')
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const input = receiptInput({
    bankReference: '  BANK-20260714-001  ',
    remark: '  首期款第一次到账  ',
  })
  const originalInput = clone(input)

  const result = prepareCustomerReceiptInput(
    confirmedProject(),
    plans,
    input,
    actor,
  )

  assert.deepEqual(result, {
    projectId: 'P300',
    planId: 'plan-initial',
    stage: 'initial',
    taxInclusiveAmount: 120000,
    receivedDate: '2026-07-14',
    paymentMethod: '银行转账',
    bankReference: 'BANK-20260714-001',
    remark: '首期款第一次到账',
    createdById: 'E009',
    createdByName: '会计王',
  })
  assert.equal(Object.hasOwn(result, 'receiptId'), false)
  assert.deepEqual(input, originalInput)
})

test('receipt input requires a positive integer yen amount, valid date, stage, method and plan link', () => {
  const prepareCustomerReceiptInput = requireExport('prepareCustomerReceiptInput')
  const CustomerReceiptStateError = requireExport('CustomerReceiptStateError')
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const base = [confirmedProject(), plans]

  for (const taxInclusiveAmount of ['', '0', '-1', '1.5', 'invalid']) {
    assert.throws(
      () =>
        prepareCustomerReceiptInput(
          ...base,
          receiptInput({ taxInclusiveAmount }),
          actor,
        ),
      assertValidationError('taxInclusiveAmount'),
    )
  }
  for (const receivedDate of ['', '2026-02-30', '2026/07/14']) {
    assert.throws(
      () =>
        prepareCustomerReceiptInput(
          ...base,
          receiptInput({ receivedDate }),
          actor,
        ),
      assertValidationError('receivedDate'),
    )
  }
  assert.throws(
    () =>
      prepareCustomerReceiptInput(
        ...base,
        receiptInput({ stage: 'deposit' }),
        actor,
      ),
    assertValidationError('stage'),
  )
  assert.throws(
    () =>
      prepareCustomerReceiptInput(
        ...base,
        receiptInput({ paymentMethod: '  ' }),
        actor,
      ),
    assertValidationError('paymentMethod'),
  )
  assert.throws(
    () =>
      prepareCustomerReceiptInput(
        confirmedProject(),
        plans.filter((plan) => plan.stage !== 'middle'),
        receiptInput({ stage: 'middle' }),
        actor,
      ),
    (error) =>
      error instanceof CustomerReceiptStateError &&
      error.code === 'payment_plan_required',
  )
})

test('multiple arrivals for one stage aggregate without replacing real receipt rows', () => {
  const buildCustomerReceiptViewModel = requireExport(
    'buildCustomerReceiptViewModel',
  )
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const receipts = [
    storedReceipt({ receiptId: 'receipt-1', taxInclusiveAmount: 120000 }),
    storedReceipt({
      receiptId: 'receipt-2',
      taxInclusiveAmount: 80000,
      receivedDate: '2026-07-20',
    }),
    storedReceipt({
      receiptId: 'receipt-void',
      taxInclusiveAmount: 999999,
      statusCode: 'void',
    }),
    storedReceipt({
      receiptId: 'receipt-other-project',
      projectId: 'P999',
      taxInclusiveAmount: 500000,
    }),
  ]
  const originalPlans = clone(plans)
  const originalReceipts = clone(receipts)

  const view = buildCustomerReceiptViewModel({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1100000,
    paymentPlans: plans,
    receipts,
  })
  const initial = view.stageSummaries.find((stage) => stage.stage === 'initial')

  assert.equal(initial.plannedTaxInclusiveAmount, 330000)
  assert.equal(initial.receivedTaxInclusiveAmount, 200000)
  assert.equal(initial.remainingTaxInclusiveAmount, 130000)
  assert.equal(initial.overpaidTaxInclusiveAmount, 0)
  assert.equal(initial.status, '部分到账')
  assert.equal(initial.locked, true)
  assert.equal(initial.activeReceiptCount, 2)
  assert.equal(view.receiptRows.length, 3)
  assert.deepEqual(
    view.receiptRows.map((receipt) => receipt.receiptId),
    ['receipt-2', 'receipt-1', 'receipt-void'],
  )
  assert.equal(view.totalReceivedTaxInclusiveAmount, 200000)
  assert.equal(view.outstandingTaxInclusiveAmount, 900000)
  assert.equal(view.paymentProgress, 18)
  assert.deepEqual(plans, originalPlans)
  assert.deepEqual(receipts, originalReceipts)
})

test('voiding receipts preserves records and unlocks a stage only after every valid receipt is void', () => {
  const prepareCustomerReceiptVoid = requireExport('prepareCustomerReceiptVoid')
  const buildCustomerReceiptViewModel = requireExport(
    'buildCustomerReceiptViewModel',
  )
  const CustomerReceiptStateError = requireExport('CustomerReceiptStateError')
  const project = confirmedProject()
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const first = storedReceipt({ receiptId: 'receipt-1', taxInclusiveAmount: 120000 })
  const second = storedReceipt({ receiptId: 'receipt-2', taxInclusiveAmount: 80000 })
  const sourceReceipts = [first, second]
  const originalReceipts = clone(sourceReceipts)

  assert.deepEqual(
    prepareCustomerReceiptVoid(
      project,
      sourceReceipts,
      first,
      actor,
      '客户到账金额录入错误',
    ),
    {
      voidReason: '客户到账金额录入错误',
      voidedById: 'E009',
      voidedByName: '会计王',
    },
  )
  assert.deepEqual(sourceReceipts, originalReceipts)

  const oneActive = [
    { ...first, statusCode: 'void' },
    second,
  ]
  const oneActiveView = buildCustomerReceiptViewModel({
    project,
    adjustedTaxInclusiveAmount: 1100000,
    paymentPlans: plans,
    receipts: oneActive,
  })
  assert.deepEqual(oneActiveView.lockedStages, ['initial'])
  assert.deepEqual(
    buildPaymentPlanEditorState({
      project,
      adjustedTaxInclusiveAmount: 1100000,
      paymentPlans: plans,
      receipts: oneActive,
    }).lockedStages,
    ['initial'],
  )

  const allVoid = oneActive.map((receipt) => ({
    ...receipt,
    statusCode: 'void',
  }))
  const allVoidView = buildCustomerReceiptViewModel({
    project,
    adjustedTaxInclusiveAmount: 1100000,
    paymentPlans: plans,
    receipts: allVoid,
  })
  assert.deepEqual(allVoidView.lockedStages, [])
  assert.equal(allVoidView.totalReceivedTaxInclusiveAmount, 0)
  assert.deepEqual(
    buildPaymentPlanEditorState({
      project,
      adjustedTaxInclusiveAmount: 1100000,
      paymentPlans: plans,
      receipts: allVoid,
    }).lockedStages,
    [],
  )

  assert.throws(
    () =>
      prepareCustomerReceiptVoid(
        project,
        allVoid,
        allVoid[0],
        actor,
        '再次作废',
      ),
    (error) =>
      error instanceof CustomerReceiptStateError &&
      error.code === 'receipt_already_void',
  )
  assert.throws(
    () => prepareCustomerReceiptVoid(project, sourceReceipts, first, actor, ' '),
    assertValidationError('voidReason'),
  )
})

test('unallocated and historical opening receipts count toward the project without locking a stage', () => {
  const prepareCustomerReceiptInput = requireExport('prepareCustomerReceiptInput')
  const buildCustomerReceiptViewModel = requireExport(
    'buildCustomerReceiptViewModel',
  )
  const project = confirmedProject()
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const unallocated = prepareCustomerReceiptInput(
    project,
    plans,
    receiptInput({ stage: 'unallocated', taxInclusiveAmount: '50000' }),
    actor,
  )

  assert.equal(unallocated.stage, 'unallocated')
  assert.equal(unallocated.planId, null)
  assert.equal(unallocated.taxInclusiveAmount, 50000)

  const view = buildCustomerReceiptViewModel({
    project,
    adjustedTaxInclusiveAmount: 1100000,
    paymentPlans: plans,
    receipts: [
      { ...unallocated, receiptId: 'receipt-unallocated', statusCode: 'active' },
      {
        receiptId: 'legacy-opening-P300',
        projectId: 'P300',
        receiptType: 'opening_balance',
        taxInclusiveAmount: 200000,
        statusCode: 'active',
      },
    ],
  })
  const unallocatedSummary = view.stageSummaries.find(
    (stage) => stage.stage === 'unallocated',
  )

  assert.equal(unallocatedSummary.receivedTaxInclusiveAmount, 250000)
  assert.equal(unallocatedSummary.status, '待分配')
  assert.equal(view.unallocatedReceivedTaxInclusiveAmount, 250000)
  assert.equal(view.totalReceivedTaxInclusiveAmount, 250000)
  assert.deepEqual(view.lockedStages, [])
})

test('stage and contract overpayments preserve the full real amount and expose prominent flags', () => {
  const prepareCustomerReceiptInput = requireExport('prepareCustomerReceiptInput')
  const buildCustomerReceiptViewModel = requireExport(
    'buildCustomerReceiptViewModel',
  )
  const plans = ['initial', 'middle', 'final'].map((stage) => storedPlan(stage))
  const prepared = prepareCustomerReceiptInput(
    confirmedProject(),
    plans,
    receiptInput({ taxInclusiveAmount: '1200000' }),
    actor,
  )
  const view = buildCustomerReceiptViewModel({
    project: confirmedProject(),
    adjustedTaxInclusiveAmount: 1100000,
    paymentPlans: plans,
    receipts: [
      { ...prepared, receiptId: 'receipt-overpaid', statusCode: 'active' },
    ],
  })
  const initial = view.stageSummaries.find((stage) => stage.stage === 'initial')

  assert.equal(prepared.taxInclusiveAmount, 1200000)
  assert.equal(initial.receivedTaxInclusiveAmount, 1200000)
  assert.equal(initial.remainingTaxInclusiveAmount, 0)
  assert.equal(initial.overpaidTaxInclusiveAmount, 870000)
  assert.equal(initial.status, '超额到账')
  assert.equal(view.totalReceivedTaxInclusiveAmount, 1200000)
  assert.equal(view.outstandingTaxInclusiveAmount, 0)
  assert.equal(view.overpaidTaxInclusiveAmount, 100000)
  assert.equal(view.paymentProgress, 109)
  assert.equal(view.paymentStatus, '超额收款')
  assert.equal(view.hasStageOverpayment, true)
  assert.equal(view.hasContractOverpayment, true)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateAdjustedContractTotals,
  calculateReceiptSummary,
  reallocateUnpaidPaymentStages,
  validateManualPaymentPlanAllocation,
} from './contractRevenueCalculations.js'
import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const originalContract = {
  originalContractTaxExclusiveAmount: 1000000,
  originalContractTaxRate: 10,
  originalContractTaxAmount: 100000,
  originalContractTaxInclusiveAmount: 1100000,
}

function contractChange(overrides = {}) {
  return {
    changeId: 'change-1',
    changeType: 'increase',
    taxExclusiveAmount: 200000,
    taxRate: 10,
    taxAmount: 20000,
    taxInclusiveAmount: 220000,
    statusCode: 'active',
    ...overrides,
  }
}

function paymentPlan(stage, plannedTaxInclusiveAmount, allocationWeight, overrides = {}) {
  return {
    planId: `plan-${stage}`,
    stage,
    plannedTaxInclusiveAmount,
    allocationWeight,
    statusCode: 'active',
    ...overrides,
  }
}

function receipt(stage, taxInclusiveAmount, overrides = {}) {
  return {
    receiptId: `receipt-${stage}`,
    stage,
    taxInclusiveAmount,
    statusCode: 'active',
    ...overrides,
  }
}

function assertValidationError(field) {
  return (error) => {
    assert.ok(error instanceof ContractRevenueValidationError)
    assert.equal(error.field, field)
    return true
  }
}

test('calculateAdjustedContractTotals applies active increases and decreases and ignores void records', () => {
  const result = calculateAdjustedContractTotals(originalContract, [
    contractChange(),
    contractChange({
      changeId: 'change-2',
      changeType: 'decrease',
      taxExclusiveAmount: 50000,
      taxAmount: 5000,
      taxInclusiveAmount: 55000,
    }),
    contractChange({
      changeId: 'change-void',
      statusCode: 'void',
      taxExclusiveAmount: '',
      taxAmount: '',
      taxInclusiveAmount: '',
    }),
  ])

  assert.deepEqual(result, {
    adjustedTaxExclusiveAmount: 1150000,
    adjustedTaxAmount: 115000,
    adjustedTaxInclusiveAmount: 1265000,
  })
})

test('calculateAdjustedContractTotals rejects zero and negative adjusted tax-exclusive amounts', () => {
  for (const decrease of [
    { taxExclusiveAmount: 100, taxAmount: 10, taxInclusiveAmount: 110 },
    { taxExclusiveAmount: 150, taxAmount: 15, taxInclusiveAmount: 165 },
  ]) {
    assert.throws(
      () =>
        calculateAdjustedContractTotals(
          {
            originalContractTaxExclusiveAmount: 100,
            originalContractTaxRate: 10,
            originalContractTaxAmount: 10,
            originalContractTaxInclusiveAmount: 110,
          },
          [contractChange({ changeType: 'decrease', ...decrease })],
        ),
      assertValidationError('adjustedTaxExclusiveAmount'),
    )
  }
})

test('calculateAdjustedContractTotals rejects zero and negative adjusted tax-inclusive amounts independently', () => {
  for (const decrease of [
    { taxAmount: 150, taxInclusiveAmount: 200 },
    { taxAmount: 200, taxInclusiveAmount: 250 },
  ]) {
    assert.throws(
      () =>
        calculateAdjustedContractTotals(
          {
            originalContractTaxExclusiveAmount: 100,
            originalContractTaxRate: 100,
            originalContractTaxAmount: 100,
            originalContractTaxInclusiveAmount: 200,
          },
          [
            contractChange({
              changeType: 'decrease',
              taxExclusiveAmount: 50,
              taxRate: 100,
              ...decrease,
            }),
          ],
        ),
      assertValidationError('adjustedTaxInclusiveAmount'),
    )
  }
})

test('calculateReceiptSummary uses active tax-inclusive receipts and ignores void records', () => {
  const result = calculateReceiptSummary(1265000, [
    receipt('initial', 300000),
    receipt('initial', 200000, { receiptId: 'receipt-initial-2' }),
    receipt('middle', '', { statusCode: 'void' }),
  ])

  assert.deepEqual(result, {
    totalReceivedTaxInclusiveAmount: 500000,
    outstandingTaxInclusiveAmount: 765000,
    overpaidTaxInclusiveAmount: 0,
    paymentProgress: 40,
    paymentStatus: '部分收款',
  })
})

test('calculateReceiptSummary preserves an overpayment and reports progress above 100 percent', () => {
  assert.deepEqual(calculateReceiptSummary(1000000, [receipt('final', 1200000)]), {
    totalReceivedTaxInclusiveAmount: 1200000,
    outstandingTaxInclusiveAmount: 0,
    overpaidTaxInclusiveAmount: 200000,
    paymentProgress: 120,
    paymentStatus: '超额收款',
  })
})

test('calculateReceiptSummary reports an exactly settled contract', () => {
  assert.deepEqual(calculateReceiptSummary(1000000, [receipt('final', 1000000)]), {
    totalReceivedTaxInclusiveAmount: 1000000,
    outstandingTaxInclusiveAmount: 0,
    overpaidTaxInclusiveAmount: 0,
    paymentProgress: 100,
    paymentStatus: '已收清',
  })
})

test('calculateReceiptSummary rejects an invalid active receipt amount', () => {
  assert.throws(
    () => calculateReceiptSummary(1000000, [receipt('initial', '')]),
    assertValidationError('receipt-initial.taxInclusiveAmount'),
  )
})

test('reallocateUnpaidPaymentStages keeps a partially received stage fixed and reallocates only unpaid stages', () => {
  const plans = [
    paymentPlan('initial', 330000, 30),
    paymentPlan('middle', 440000, 40),
    paymentPlan('final', 330000, 30),
  ]

  const result = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: 1320000,
    plans,
    receipts: [receipt('initial', 100000)],
  })

  assert.equal(plans[0].plannedTaxInclusiveAmount, 330000)
  assert.equal(plans[1].plannedTaxInclusiveAmount, 440000)
  assert.deepEqual(
    result.plans.map(({ stage, plannedTaxInclusiveAmount }) => ({
      stage,
      plannedTaxInclusiveAmount,
    })),
    [
      { stage: 'initial', plannedTaxInclusiveAmount: 330000 },
      { stage: 'middle', plannedTaxInclusiveAmount: 565714 },
      { stage: 'final', plannedTaxInclusiveAmount: 424286 },
    ],
  )
  assert.equal(result.allocationStatus, 'auto_allocated')
  assert.deepEqual(result.lockedStages, ['initial'])
  assert.deepEqual(result.unlockedStages, ['middle', 'final'])
  assert.equal(result.unallocatedTaxInclusiveAmount, 0)
})

test('reallocateUnpaidPaymentStages does not lock a stage whose receipts are all void', () => {
  const result = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: 1320000,
    plans: [
      paymentPlan('initial', 330000, 30),
      paymentPlan('middle', 440000, 40),
      paymentPlan('final', 330000, 30),
    ],
    receipts: [receipt('initial', 100000, { statusCode: 'void' })],
  })

  assert.deepEqual(result.lockedStages, [])
  assert.deepEqual(
    result.plans.map((plan) => plan.plannedTaxInclusiveAmount),
    [396000, 528000, 396000],
  )
})

test('reallocateUnpaidPaymentStages assigns all remaining value to the only unpaid stage', () => {
  const result = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: 1320000,
    plans: [
      paymentPlan('initial', 330000, 30),
      paymentPlan('middle', 440000, 40),
      paymentPlan('final', 330000, 30),
    ],
    receipts: [receipt('initial', 100000), receipt('middle', 100000)],
  })

  assert.deepEqual(
    result.plans.map((plan) => plan.plannedTaxInclusiveAmount),
    [330000, 440000, 550000],
  )
  assert.deepEqual(result.lockedStages, ['initial', 'middle'])
  assert.deepEqual(result.unlockedStages, ['final'])
})

test('reallocateUnpaidPaymentStages requests manual review when every stage is locked', () => {
  const plans = [
    paymentPlan('initial', 330000, 30),
    paymentPlan('middle', 440000, 40),
    paymentPlan('final', 330000, 30),
  ]
  const result = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: 1320000,
    plans,
    receipts: [receipt('initial', 1), receipt('middle', 1), receipt('final', 1)],
  })

  assert.equal(result.allocationStatus, 'manual_review_required')
  assert.equal(result.allocationReason, 'all_stages_locked')
  assert.equal(result.unallocatedTaxInclusiveAmount, 220000)
  assert.deepEqual(result.plans, plans)
})

test('reallocateUnpaidPaymentStages requests manual review when locked plans exceed the adjusted contract', () => {
  const plans = [
    paymentPlan('initial', 600000, 60),
    paymentPlan('middle', 400000, 30),
    paymentPlan('final', 100000, 10),
  ]
  const result = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: 900000,
    plans,
    receipts: [receipt('initial', 1), receipt('middle', 1)],
  })

  assert.equal(result.allocationStatus, 'manual_review_required')
  assert.equal(result.allocationReason, 'locked_amount_exceeds_contract')
  assert.equal(result.lockedAmountExcess, 100000)
  assert.equal(result.unallocatedTaxInclusiveAmount, -200000)
  assert.deepEqual(result.plans, plans)
})

test('reallocateUnpaidPaymentStages requests manual review for invalid unpaid-stage weights', () => {
  const result = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: 1320000,
    plans: [
      paymentPlan('initial', 330000, 30),
      paymentPlan('middle', 440000, ''),
      paymentPlan('final', 330000, 0),
    ],
    receipts: [receipt('initial', 1)],
  })

  assert.equal(result.allocationStatus, 'manual_review_required')
  assert.equal(result.allocationReason, 'invalid_allocation_weights')
  assert.equal(result.unallocatedTaxInclusiveAmount, 220000)
})

test('validateManualPaymentPlanAllocation accepts manual unpaid-stage amounts that exactly match the contract', () => {
  const currentPlans = [
    paymentPlan('initial', 330000, 30),
    paymentPlan('middle', 440000, 40),
    paymentPlan('final', 330000, 30),
  ]
  const proposedPlans = [
    paymentPlan('initial', 330000, 30),
    paymentPlan('middle', 565714, 40),
    paymentPlan('final', 424286, 30),
  ]

  const result = validateManualPaymentPlanAllocation({
    adjustedTaxInclusiveAmount: 1320000,
    currentPlans,
    proposedPlans,
    receipts: [receipt('initial', 100000)],
  })

  assert.deepEqual(
    result.plans.map((plan) => plan.plannedTaxInclusiveAmount),
    [330000, 565714, 424286],
  )
  assert.deepEqual(result.lockedStages, ['initial'])
})

test('validateManualPaymentPlanAllocation rejects changing a received stage amount', () => {
  assert.throws(
    () =>
      validateManualPaymentPlanAllocation({
        adjustedTaxInclusiveAmount: 1320000,
        currentPlans: [
          paymentPlan('initial', 330000, 30),
          paymentPlan('middle', 440000, 40),
          paymentPlan('final', 330000, 30),
        ],
        proposedPlans: [
          paymentPlan('initial', 329999, 30),
          paymentPlan('middle', 565715, 40),
          paymentPlan('final', 424286, 30),
        ],
        receipts: [receipt('initial', 100000)],
      }),
    assertValidationError('initial.plannedTaxInclusiveAmount'),
  )
})

test('validateManualPaymentPlanAllocation rejects a plan total that differs from the adjusted tax-inclusive contract', () => {
  assert.throws(
    () =>
      validateManualPaymentPlanAllocation({
        adjustedTaxInclusiveAmount: 1320000,
        currentPlans: [
          paymentPlan('initial', 330000, 30),
          paymentPlan('middle', 440000, 40),
          paymentPlan('final', 330000, 30),
        ],
        proposedPlans: [
          paymentPlan('initial', 330000, 30),
          paymentPlan('middle', 500000, 40),
          paymentPlan('final', 400000, 30),
        ],
        receipts: [receipt('initial', 100000)],
      }),
    assertValidationError('paymentPlanTotal'),
  )
})

test('validateManualPaymentPlanAllocation rejects blank manual stage amounts', () => {
  assert.throws(
    () =>
      validateManualPaymentPlanAllocation({
        adjustedTaxInclusiveAmount: 1320000,
        currentPlans: [
          paymentPlan('initial', 330000, 30),
          paymentPlan('middle', 440000, 40),
          paymentPlan('final', 330000, 30),
        ],
        proposedPlans: [
          paymentPlan('initial', 330000, 30),
          paymentPlan('middle', '', 40),
          paymentPlan('final', 990000, 30),
        ],
        receipts: [receipt('initial', 100000)],
      }),
    assertValidationError('middle.plannedTaxInclusiveAmount'),
  )
})

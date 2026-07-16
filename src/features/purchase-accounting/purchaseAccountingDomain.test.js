import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPurchaseAccountingReadModel,
  canApplyPurchasePayment,
  filterPurchaseAccountingRows,
  recalculatePurchasePaymentCache,
} from './purchaseAccountingDomain.js'

function purchase(overrides = {}) {
  return {
    purchaseId: 'PO-1',
    purchaseDate: '2026-07-10',
    totalCost: 10000,
    purchaseStatus: '正常',
    projectId: 'P-1',
    purchaseSource: '中国采购',
    openingPaidAmount: 0,
    paidAmount: 0,
    ...overrides,
  }
}

function payment(overrides = {}) {
  return {
    paymentId: 'PP-1',
    purchaseId: 'PO-1',
    paymentDate: '2026-08-02',
    jpyAmount: 6000,
    ...overrides,
  }
}

test('separates July purchase cost from August payment cash flow', () => {
  const july = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase()],
    paymentRecords: [payment()],
    month: '2026-07',
  })
  const august = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase()],
    paymentRecords: [payment()],
    month: '2026-08',
  })

  assert.equal(july.summary.monthPurchaseCost, 10000)
  assert.equal(july.summary.monthPaymentCash, 0)
  assert.equal(august.summary.monthPurchaseCost, 0)
  assert.equal(august.summary.monthPaymentCash, 6000)
  assert.equal(august.summary.currentOutstanding, 4000)
})

test('does not add payment cash to project purchase cost', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase()],
    paymentRecords: [payment({ paymentDate: '2026-07-20' })],
    month: '2026-07',
    projectId: 'P-1',
  })

  assert.equal(readModel.summary.monthPurchaseCost, 10000)
  assert.equal(readModel.summary.monthPaymentCash, 6000)
  assert.equal(readModel.rows[0].totalCost, 10000)
})

test('excludes void purchases and reports payments linked to them', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase({ purchaseStatus: '作废' })],
    paymentRecords: [payment()],
    month: '2026-08',
  })

  assert.deepEqual(readModel.rows, [])
  assert.deepEqual(readModel.paymentRows, [])
  assert.deepEqual(readModel.summary, {
    monthPurchaseCost: 0,
    monthOpeningPaid: 0,
    monthPaymentCash: 0,
    currentOutstanding: 0,
    missingInvoiceCount: 0,
    anomalyCount: 1,
  })
  assert.equal(readModel.anomalies[0].code, 'void_purchase_payment')
})

test('accepts the first payment ID once and reports duplicate and orphan payments', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase()],
    paymentRecords: [
      payment({ paymentId: 'PP-1', jpyAmount: 3000 }),
      payment({ paymentId: 'PP-1', jpyAmount: 9000 }),
      payment({ paymentId: 'PP-ORPHAN', purchaseId: 'PO-MISSING', jpyAmount: 5000 }),
    ],
    month: '2026-08',
  })

  assert.equal(readModel.rows[0].ledgerPaidAmount, 3000)
  assert.equal(readModel.rows[0].paidAmount, 3000)
  assert.equal(readModel.summary.monthPaymentCash, 3000)
  assert.deepEqual(readModel.paymentRows.map((row) => row.paymentId), ['PP-1'])
  assert.deepEqual(readModel.anomalies.map((item) => item.code), [
    'duplicate_payment',
    'orphan_payment',
  ])
})

test('deduplicates purchase IDs before calculating purchase cost', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase(), purchase({ totalCost: 90000 })],
    month: '2026-07',
  })

  assert.equal(readModel.rows.length, 1)
  assert.equal(readModel.summary.monthPurchaseCost, 10000)
  assert.equal(readModel.anomalies[0].code, 'duplicate_purchase')
})

test('keeps actual overpayment cash while capping outstanding at zero', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase()],
    paymentRecords: [payment({ jpyAmount: 12000 })],
    month: '2026-08',
  })

  assert.equal(readModel.rows[0].paidAmount, 12000)
  assert.equal(readModel.rows[0].unpaidAmount, 0)
  assert.equal(readModel.rows[0].paymentStatus, '已付款')
  assert.equal(readModel.summary.monthPaymentCash, 12000)
  assert.equal(readModel.summary.currentOutstanding, 0)
  assert.equal(readModel.anomalies[0].code, 'overpayment')
  assert.equal(readModel.anomalies[0].overpaidAmount, 2000)
})

test('derives and marks a legacy opening payment without double counting the ledger', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase({ openingPaidAmount: undefined, paidAmount: 7000 })],
    paymentRecords: [payment({ jpyAmount: 2000 })],
    month: '2026-07',
  })

  assert.equal(readModel.rows[0].openingPaidAmount, 5000)
  assert.equal(readModel.rows[0].ledgerPaidAmount, 2000)
  assert.equal(readModel.rows[0].paidAmount, 7000)
  assert.equal(readModel.rows[0].unpaidAmount, 3000)
  assert.equal(readModel.rows[0].legacyOpeningEstimated, true)
  assert.equal(readModel.summary.monthOpeningPaid, 5000)
  assert.equal(readModel.anomalies[0].code, 'legacy_opening_payment')
})

test('normalizes finite yen and prevents invalid amounts from polluting totals', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [
      purchase({ purchaseId: 'PO-BAD', totalCost: Number.POSITIVE_INFINITY }),
      purchase({ purchaseId: 'PO-GOOD', totalCost: 2000.4 }),
    ],
    paymentRecords: [
      payment({ paymentId: 'PP-NAN', purchaseId: 'PO-GOOD', jpyAmount: Number.NaN }),
      payment({ paymentId: 'PP-NEG', purchaseId: 'PO-GOOD', jpyAmount: -50 }),
    ],
    month: '2026-07',
  })

  assert.equal(readModel.summary.monthPurchaseCost, 2000)
  assert.equal(readModel.summary.monthPaymentCash, 0)
  assert.equal(readModel.summary.currentOutstanding, 2000)
  assert.deepEqual(readModel.paymentRows, [])
  assert.deepEqual(readModel.anomalies.map((item) => item.code), [
    'invalid_purchase_amount',
    'invalid_payment_amount',
    'invalid_payment_amount',
  ])
})

test('scopes rows, purchase cost, payment cash, and outstanding by project and source', () => {
  const readModel = buildPurchaseAccountingReadModel({
    purchaseRecords: [
      purchase({ purchaseId: 'PO-1', projectId: 'P-1', purchaseSource: '中国采购' }),
      purchase({ purchaseId: 'PO-2', projectId: 'P-2', purchaseSource: '中国采购' }),
      purchase({ purchaseId: 'PO-3', projectId: 'P-1', purchaseSource: 'Amazon' }),
    ],
    paymentRecords: [
      payment({ paymentId: 'PP-1', purchaseId: 'PO-1', jpyAmount: 1000 }),
      payment({ paymentId: 'PP-2', purchaseId: 'PO-2', jpyAmount: 2000 }),
      payment({ paymentId: 'PP-3', purchaseId: 'PO-3', jpyAmount: 3000 }),
    ],
    month: '2026-08',
    projectId: 'P-1',
    source: '中国采购',
  })

  assert.deepEqual(readModel.rows.map((row) => row.purchaseId), ['PO-1'])
  assert.deepEqual(readModel.paymentRows.map((row) => row.paymentId), ['PP-1'])
  assert.equal(readModel.summary.monthPaymentCash, 1000)
  assert.equal(readModel.summary.currentOutstanding, 9000)
  assert.equal(readModel.anomalies.length, 0)
})

test('filters read-model rows by project, source, and derived payment status', () => {
  const rows = buildPurchaseAccountingReadModel({
    purchaseRecords: [
      purchase({ purchaseId: 'PO-1', projectId: 'P-1', purchaseSource: 'Amazon' }),
      purchase({ purchaseId: 'PO-2', projectId: 'P-1', purchaseSource: '中国采购' }),
      purchase({ purchaseId: 'PO-3', projectId: 'P-2', purchaseSource: 'Amazon' }),
    ],
    paymentRecords: [payment({ purchaseId: 'PO-1', jpyAmount: 3000 })],
  }).rows

  assert.deepEqual(
    filterPurchaseAccountingRows(rows, {
      projectId: 'P-1',
      source: 'Amazon',
      paymentStatus: '部分付款',
    }).map((row) => row.purchaseId),
    ['PO-1'],
  )
})

test('recalculates the purchase cache from opening payment and unique linked payments', () => {
  const original = purchase({ openingPaidAmount: 2000, paidAmount: 9000, unpaidAmount: 1000 })
  const recalculated = recalculatePurchasePaymentCache(original, [
    payment({ paymentId: 'PP-1', jpyAmount: 3000 }),
    payment({ paymentId: 'PP-1', jpyAmount: 8000 }),
    payment({ paymentId: 'PP-2', purchaseId: 'PO-OTHER', jpyAmount: 1000 }),
  ])

  assert.deepEqual(recalculated, {
    ...original,
    openingPaidAmount: 2000,
    paidAmount: 5000,
    unpaidAmount: 5000,
    paymentStatus: '部分付款',
  })
  assert.equal(original.paidAmount, 9000)
})

test('cache recalculation applies global first-payment-ID wins before purchase filtering', () => {
  const recalculated = recalculatePurchasePaymentCache(
    purchase({ purchaseId: 'PO-1', openingPaidAmount: 0 }),
    [
      payment({ paymentId: 'PP-DUP', purchaseId: 'PO-2', jpyAmount: 3000 }),
      payment({ paymentId: 'PP-DUP', purchaseId: 'PO-1', jpyAmount: 4000 }),
    ],
  )

  assert.equal(recalculated.paidAmount, 0)
  assert.equal(recalculated.unpaidAmount, 10000)
  assert.equal(recalculated.paymentStatus, '未付款')
})

test('legacy cache deletion estimates opening from previous payments', () => {
  const legacyPurchase = purchase({ openingPaidAmount: undefined, paidAmount: 6000 })
  const previousPayments = [payment({ paymentId: 'PP-OLD', jpyAmount: 6000 })]
  const recalculated = recalculatePurchasePaymentCache(
    legacyPurchase,
    [],
    { previousPayments },
  )

  assert.equal(recalculated.openingPaidAmount, 0)
  assert.equal(recalculated.paidAmount, 0)
  assert.equal(recalculated.unpaidAmount, 10000)
  assert.equal(recalculated.paymentStatus, '未付款')
})

test('legacy cache addition does not absorb the new payment into opening', () => {
  const legacyPurchase = purchase({ openingPaidAmount: undefined, paidAmount: 6000 })
  const recalculated = recalculatePurchasePaymentCache(
    legacyPurchase,
    [payment({ paymentId: 'PP-NEW', jpyAmount: 2000 })],
    { previousPayments: [] },
  )

  assert.equal(recalculated.openingPaidAmount, 6000)
  assert.equal(recalculated.paidAmount, 8000)
  assert.equal(recalculated.unpaidAmount, 2000)
  assert.equal(recalculated.paymentStatus, '部分付款')
})

test('allows only a positive valid payment within the derived outstanding balance', () => {
  const order = purchase({ openingPaidAmount: 2000 })
  const payments = [payment({ jpyAmount: 3000 })]

  assert.equal(canApplyPurchasePayment(order, payments, 5000), true)
  assert.equal(canApplyPurchasePayment(order, payments, 5001), false)
  assert.equal(canApplyPurchasePayment(order, payments, 0), false)
  assert.equal(canApplyPurchasePayment(order, payments, -1), false)
  assert.equal(canApplyPurchasePayment(order, payments, Number.POSITIVE_INFINITY), false)
})

test('rejects payments when the purchase ID is missing or blank', () => {
  for (const purchaseId of ['', '   ', undefined]) {
    assert.equal(
      canApplyPurchasePayment(purchase({ purchaseId }), [], 1000),
      false,
    )
  }
})

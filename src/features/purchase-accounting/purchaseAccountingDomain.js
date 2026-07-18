import {
  PURCHASE_PAYMENT_CASH_SCHEMA,
  isRecordedCashFact,
  normalizeCashFactProvenance,
} from '../cost-accounting/cashFactProvenance.js'
import { isDateInMonth, monthOfDate } from '../executive-dashboard/dashboardTime.js'

const VOID_PURCHASE_STATUS = '作废'
const PAYMENT_FIELDS = [
  'openingPaidAmount',
  'ledgerPaidAmount',
  'paidAmount',
  'unpaidAmount',
  'paymentStatus',
  'legacyOpeningEstimated',
]
const PAYMENT_SOURCE_STATUSES = new Set(['ready', 'loading', 'forbidden', 'error'])

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function frozenCopy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)

  const output = Array.isArray(value) ? [] : {}
  seen.set(value, output)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) continue
    output[key] = frozenCopy(descriptor.value, seen)
  }
  return Object.freeze(output)
}

function paymentSource(paymentState, paymentRecords) {
  if (paymentState === undefined) {
    return { status: 'ready', data: asArray(paymentRecords) }
  }
  if (paymentState === null || typeof paymentState !== 'object' ||
      Array.isArray(paymentState) || Object.getPrototypeOf(paymentState) !== Object.prototype) {
    return { status: 'error', data: null }
  }

  const descriptors = Object.getOwnPropertyDescriptors(paymentState)
  const statusDescriptor = descriptors.status
  const dataDescriptor = descriptors.data
  if (!statusDescriptor?.enumerable || !Object.hasOwn(statusDescriptor, 'value') ||
      !dataDescriptor?.enumerable || !Object.hasOwn(dataDescriptor, 'value') ||
      !PAYMENT_SOURCE_STATUSES.has(statusDescriptor.value)) {
    return { status: 'error', data: null }
  }
  if (statusDescriptor.value === 'ready' && !Array.isArray(dataDescriptor.value)) {
    return { status: 'error', data: null }
  }
  if (statusDescriptor.value !== 'ready' && dataDescriptor.value !== null) {
    return { status: 'error', data: null }
  }

  return {
    status: statusDescriptor.value,
    data: statusDescriptor.value === 'ready' ? dataDescriptor.value : null,
  }
}

function paymentBlock(status, data) {
  return frozenCopy({ status, data })
}

function stripPaymentFields(purchase) {
  const row = { ...purchase }
  for (const field of PAYMENT_FIELDS) delete row[field]
  return row
}

function normalizedId(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeYen(value, { blankIsZero = true } = {}) {
  if (value === undefined || value === null ||
      (typeof value === 'string' && value.trim() === '')) {
    return { amount: 0, valid: blankIsZero }
  }

  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { amount: 0, valid: false }
  }

  const amount = Math.round(numeric)
  return Number.isSafeInteger(amount)
    ? { amount, valid: true }
    : { amount: 0, valid: false }
}

function inMonth(date, month) {
  return isDateInMonth(date, month)
}

function paymentStatus(totalCost, paidAmount) {
  if (totalCost > 0 && paidAmount >= totalCost) return '已付款'
  if (paidAmount > 0) return '部分付款'
  return '未付款'
}

function matchesScope(record, projectId, source) {
  return (!projectId || record.projectId === projectId) &&
    (!source || record.purchaseSource === source)
}

function pushAnomaly(anomalies, code, details = {}) {
  anomalies.push({ code, ...details })
}

function normalizePurchases(purchaseRecords, anomalies) {
  const purchases = []
  const purchasesById = new Map()
  const seenIds = new Set()

  for (const record of asArray(purchaseRecords)) {
    const purchaseId = normalizedId(record?.purchaseId)
    if (!purchaseId) {
      pushAnomaly(anomalies, 'invalid_purchase_id', { record })
      continue
    }
    if (seenIds.has(purchaseId)) {
      pushAnomaly(anomalies, 'duplicate_purchase', { purchaseId, record })
      continue
    }
    seenIds.add(purchaseId)

    const normalizedTotal = normalizeYen(record?.totalCost)
    if (!normalizedTotal.valid) {
      pushAnomaly(anomalies, 'invalid_purchase_amount', {
        purchaseId,
        field: 'totalCost',
        value: record?.totalCost,
        record,
      })
    }
    if (!monthOfDate(record?.purchaseDate)) {
      pushAnomaly(anomalies, 'invalid_purchase_date', { purchaseId })
    }

    const purchase = {
      ...record,
      purchaseId,
      projectId: normalizedId(record?.projectId),
      totalCost: normalizedTotal.amount,
    }
    if (purchase.purchaseStatus !== VOID_PURCHASE_STATUS &&
        normalizedId(record?.purchasePurpose) === '项目使用' &&
        !purchase.projectId) {
      pushAnomaly(anomalies, 'missing_project_allocation', { purchaseId, record: purchase })
    }
    purchases.push(purchase)
    purchasesById.set(purchaseId, purchase)
  }

  return { purchases, purchasesById }
}

function normalizePayments(paymentRecords, purchasesById, anomalies) {
  const payments = []
  const seenIds = new Set()

  for (const record of asArray(paymentRecords)) {
    const paymentId = normalizedId(record?.paymentId)
    if (!paymentId) {
      pushAnomaly(anomalies, 'invalid_payment_id', { record })
      continue
    }
    if (seenIds.has(paymentId)) {
      pushAnomaly(anomalies, 'duplicate_payment', { paymentId, record })
      continue
    }
    seenIds.add(paymentId)

    const purchaseId = normalizedId(record?.purchaseId)
    const normalizedAmount = normalizeYen(record?.jpyAmount, { blankIsZero: false })
    if (!normalizedAmount.valid) {
      pushAnomaly(anomalies, 'invalid_payment_amount', {
        paymentId,
        purchaseId,
        field: 'jpyAmount',
        value: record?.jpyAmount,
        record,
      })
      continue
    }

    const purchase = purchasesById.get(purchaseId)
    if (!purchase) {
      pushAnomaly(anomalies, 'orphan_payment', { paymentId, purchaseId, record })
      continue
    }
    if (purchase.purchaseStatus === VOID_PURCHASE_STATUS) {
      pushAnomaly(anomalies, 'void_purchase_payment', { paymentId, purchaseId, record })
      continue
    }

    payments.push({
      ...normalizeCashFactProvenance(record, PURCHASE_PAYMENT_CASH_SCHEMA),
      paymentId,
      purchaseId,
      jpyAmount: normalizedAmount.amount,
      projectId: purchase.projectId || '',
      projectName: purchase.projectName || '',
      purchaseSource: purchase.purchaseSource || '',
    })
  }

  return payments
}

function paymentsByPurchaseId(payments) {
  const grouped = new Map()
  for (const payment of payments) {
    const existing = grouped.get(payment.purchaseId) || []
    existing.push(payment)
    grouped.set(payment.purchaseId, existing)
  }
  return grouped
}

function sumPaymentAmounts(payments) {
  return payments.reduce((total, payment) => total + payment.jpyAmount, 0)
}

function paymentCacheMismatchFields(purchase, derivedCache) {
  const mismatches = []

  for (const field of ['paidAmount', 'unpaidAmount']) {
    if (!Object.hasOwn(purchase, field)) continue
    const normalized = normalizeYen(purchase[field], { blankIsZero: false })
    if (!normalized.valid || normalized.amount !== derivedCache[field]) {
      mismatches.push(field)
    }
  }

  if (Object.hasOwn(purchase, 'paymentStatus') &&
      purchase.paymentStatus !== derivedCache.paymentStatus) {
    mismatches.push('paymentStatus')
  }

  return mismatches
}

function derivePurchaseRow(purchase, payments, anomalies, { validateCache = true } = {}) {
  const ledgerPaidAmount = sumPaymentAmounts(payments)
  const hasOpeningSnapshot = purchase.openingPaidAmount !== undefined &&
    purchase.openingPaidAmount !== null &&
    !(typeof purchase.openingPaidAmount === 'string' && purchase.openingPaidAmount.trim() === '')
  let openingPaidAmount = 0
  let legacyOpeningEstimated = false
  let openingSnapshotReliable = false

  if (hasOpeningSnapshot) {
    const normalizedOpening = normalizeYen(purchase.openingPaidAmount)
    openingPaidAmount = normalizedOpening.amount
    openingSnapshotReliable = normalizedOpening.valid
    if (!normalizedOpening.valid) {
      pushAnomaly(anomalies, 'invalid_purchase_amount', {
        purchaseId: purchase.purchaseId,
        field: 'openingPaidAmount',
        value: purchase.openingPaidAmount,
        record: purchase,
      })
    }
  } else {
    const normalizedCache = normalizeYen(purchase.paidAmount)
    openingPaidAmount = Math.max(normalizedCache.amount - ledgerPaidAmount, 0)
    legacyOpeningEstimated = true
    if (!normalizedCache.valid) {
      pushAnomaly(anomalies, 'invalid_purchase_amount', {
        purchaseId: purchase.purchaseId,
        field: 'paidAmount',
        value: purchase.paidAmount,
        record: purchase,
      })
    }
    pushAnomaly(anomalies, 'legacy_opening_payment', {
      purchaseId: purchase.purchaseId,
      openingPaidAmount,
      record: purchase,
    })
  }

  const paidAmount = openingPaidAmount + ledgerPaidAmount
  const unpaidAmount = Math.max(purchase.totalCost - paidAmount, 0)
  const derivedPaymentStatus = paymentStatus(purchase.totalCost, paidAmount)
  if (openingSnapshotReliable && validateCache) {
    const mismatchFields = paymentCacheMismatchFields(purchase, {
      paidAmount,
      unpaidAmount,
      paymentStatus: derivedPaymentStatus,
    })
    if (mismatchFields.length > 0) {
      pushAnomaly(anomalies, 'purchase_payment_cache_mismatch', {
        purchaseId: purchase.purchaseId,
        mismatchFields,
        record: purchase,
      })
    }
  }
  if (paidAmount > purchase.totalCost) {
    pushAnomaly(anomalies, 'overpayment', {
      purchaseId: purchase.purchaseId,
      paidAmount,
      totalCost: purchase.totalCost,
      overpaidAmount: paidAmount - purchase.totalCost,
      record: purchase,
    })
  }

  return {
    ...purchase,
    openingPaidAmount,
    ledgerPaidAmount,
    paidAmount,
    unpaidAmount,
    paymentStatus: derivedPaymentStatus,
    legacyOpeningEstimated,
  }
}

function uniqueLinkedPaymentTotal(purchaseId, paymentRecords) {
  const seenIds = new Set()
  let total = 0

  for (const payment of asArray(paymentRecords)) {
    const paymentId = normalizedId(payment?.paymentId)
    if (!paymentId || seenIds.has(paymentId)) continue
    seenIds.add(paymentId)
    if (normalizedId(payment?.purchaseId) !== purchaseId) continue
    const normalizedAmount = normalizeYen(payment?.jpyAmount, { blankIsZero: false })
    if (normalizedAmount.valid) total += normalizedAmount.amount
  }

  return total
}

export function buildPurchaseAccountingReadModel({
  purchaseRecords = [],
  paymentRecords = [],
  paymentState,
  month = '',
  projectId = '',
  source = '',
} = {}) {
  const anomalies = []
  const { purchases, purchasesById } = normalizePurchases(purchaseRecords, anomalies)
  const sourceState = paymentSource(paymentState, paymentRecords)

  if (sourceState.status !== 'ready') {
    const rows = purchases
      .filter((purchase) => purchase.purchaseStatus !== VOID_PURCHASE_STATUS)
      .map(stripPaymentFields)
      .filter((row) => matchesScope(row, projectId, source))
    return {
      rows,
      paymentRows: [],
      cashPaymentRows: [],
      anomalies,
      currentPayable: paymentBlock(sourceState.status, null),
      monthPayment: paymentBlock(sourceState.status, null),
      paymentHealth: paymentBlock(sourceState.status, null),
      summary: {
        monthPurchaseCost: rows
          .filter((row) => inMonth(row.purchaseDate, month))
          .reduce((total, row) => total + row.totalCost, 0),
        monthOpeningPaid: null,
        monthPaymentCash: null,
        currentOutstanding: null,
        missingInvoiceCount: rows.filter((row) => row.invoiceStatus === '未取得').length,
        anomalyCount: anomalies.length,
      },
    }
  }

  const payments = normalizePayments(sourceState.data, purchasesById, anomalies)
  const groupedPayments = paymentsByPurchaseId(payments)
  const allRows = purchases
    .filter((purchase) => purchase.purchaseStatus !== VOID_PURCHASE_STATUS)
    .map((purchase) => derivePurchaseRow(
      purchase,
      groupedPayments.get(purchase.purchaseId) || [],
      anomalies,
      { validateCache: paymentState === undefined },
    ))
  const rows = allRows.filter((row) => matchesScope(row, projectId, source))
  const paymentRows = payments.filter((payment) => matchesScope(payment, projectId, source))
  const cashPaymentRows = paymentRows.filter((payment) =>
    isRecordedCashFact(payment, PURCHASE_PAYMENT_CASH_SCHEMA),
  )

  const summary = {
    monthPurchaseCost: rows
      .filter((row) => inMonth(row.purchaseDate, month))
      .reduce((total, row) => total + row.totalCost, 0),
    monthOpeningPaid: rows
      .filter((row) => inMonth(row.purchaseDate, month))
      .reduce((total, row) => total + row.openingPaidAmount, 0),
    monthPaymentCash: cashPaymentRows
      .filter((payment) => inMonth(payment.paymentDate, month))
      .reduce((total, payment) => total + payment.jpyAmount, 0),
    currentOutstanding: rows.reduce((total, row) => total + row.unpaidAmount, 0),
    missingInvoiceCount: rows.filter((row) => row.invoiceStatus === '未取得').length,
    anomalyCount: anomalies.length,
  }

  return {
    rows,
    paymentRows,
    cashPaymentRows,
    anomalies,
    currentPayable: paymentBlock('ready', summary.currentOutstanding),
    monthPayment: paymentBlock('ready', {
      openingPaidAmount: summary.monthOpeningPaid,
      paymentCash: summary.monthPaymentCash,
    }),
    paymentHealth: paymentBlock('ready', { anomalies }),
    summary,
  }
}

export function filterPurchaseAccountingRows(rows = [], filters = {}) {
  return asArray(rows).filter((row) =>
    (!filters.projectId || row.projectId === filters.projectId) &&
    (!filters.source || row.purchaseSource === filters.source) &&
    (!filters.paymentStatus || row.paymentStatus === filters.paymentStatus)
  )
}

export function recalculatePurchasePaymentCache(purchase, payments = [], options = {}) {
  if (!purchase || typeof purchase !== 'object') return purchase

  const purchaseId = normalizedId(purchase.purchaseId)
  const totalCost = normalizeYen(purchase.totalCost).amount
  const ledgerPaidAmount = uniqueLinkedPaymentTotal(purchaseId, payments)
  const previousPayments = Array.isArray(options?.previousPayments)
    ? options.previousPayments
    : payments
  const previousLedgerPaidAmount = uniqueLinkedPaymentTotal(purchaseId, previousPayments)
  const normalizedOpening = normalizeYen(purchase.openingPaidAmount)
  const openingPaidAmount = purchase.openingPaidAmount === undefined ||
    purchase.openingPaidAmount === null ||
    (typeof purchase.openingPaidAmount === 'string' && purchase.openingPaidAmount.trim() === '')
    ? Math.max(normalizeYen(purchase.paidAmount).amount - previousLedgerPaidAmount, 0)
    : normalizedOpening.amount
  const paidAmount = openingPaidAmount + ledgerPaidAmount

  return {
    ...purchase,
    openingPaidAmount,
    paidAmount,
    unpaidAmount: Math.max(totalCost - paidAmount, 0),
    paymentStatus: paymentStatus(totalCost, paidAmount),
  }
}

export function canApplyPurchasePayment(purchase, payments = [], amount) {
  if (!purchase || !normalizedId(purchase.purchaseId) ||
      purchase.purchaseStatus === VOID_PURCHASE_STATUS) return false
  const normalizedAmount = normalizeYen(amount, { blankIsZero: false })
  const normalizedTotal = normalizeYen(purchase.totalCost, { blankIsZero: false })
  if (!normalizedAmount.valid || normalizedAmount.amount <= 0 || !normalizedTotal.valid) {
    return false
  }

  const recalculated = recalculatePurchasePaymentCache(purchase, payments)
  return normalizedAmount.amount <= recalculated.unpaidAmount
}

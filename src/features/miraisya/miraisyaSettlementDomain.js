import { calculateBillingAmounts } from './miraisyaBillingDomain.js'

const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u
const INVOICE_PATTERN = /^MIRAI-(\d{4})(\d{2})-(\d{3})$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const TOKEN_PATTERN = /^[0-9a-f]{64}$/u
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const STATUS_VALUES = new Set(['draft', 'confirmed', 'voided'])

const CANDIDATE_FIELDS = Object.freeze([
  'projectId', 'projectName', 'address', 'completionDate', 'completionMonth',
  'billingVersion', 'taxExclusiveAmount', 'taxAmount', 'taxInclusiveAmount',
  'costAmount', 'costComplete', 'incompleteSources',
])
const ITEM_FIELDS = Object.freeze([
  'itemName', 'description', 'quantity', 'unit', 'unitPrice', 'taxRate',
  'taxExclusiveAmount', 'taxAmount', 'taxInclusiveAmount',
])
const PROJECT_FIELDS = Object.freeze([
  'projectId', 'projectName', 'address', 'completionDate', 'billingVersion',
  'costSnapshotToken', 'costAmount', 'taxExclusiveAmount', 'taxAmount',
  'taxInclusiveAmount', 'items',
])
const SETTLEMENT_FIELDS = Object.freeze([
  'id', 'invoiceNo', 'month', 'issueDate', 'status', 'version',
  'taxExclusiveAmount', 'taxAmount', 'taxInclusiveAmount', 'totalCostAmount',
  'marginAmount', 'projects', 'createdAt', 'createdByName', 'confirmedAt',
  'confirmedByName', 'voidedAt', 'voidedByName', 'voidReason',
])

function invalid(message = '未来社月度结算数据无效') {
  return new TypeError(message)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactObject(value, fields) {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) throw invalid()
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== fields.length) throw invalid()
  const expected = new Set(fields)
  const result = Object.create(null)
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!expected.has(key) || POLLUTION_KEYS.has(key) || descriptor?.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')) throw invalid()
    result[key] = descriptor.value
  }
  return result
}

function denseArray(value, maximum = 500) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) throw invalid()
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum ||
      Object.getOwnPropertyNames(value).length !== length + 1) throw invalid()
  const result = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw invalid()
    result[index] = descriptor.value
  }
  return result
}

function text(value, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || value.trim() !== value || value.length > maximum ||
      (!empty && value.length === 0) || POLLUTION_KEYS.has(value)) throw invalid()
  return value
}

function yenInteger(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw invalid()
  return value
}

function money(value, { signed = false } = {}) {
  const scaled = Math.round(value * 10_000)
  if (!Number.isFinite(value) || (!signed && value < 0) || !Number.isSafeInteger(scaled) ||
      Math.abs(value * 10_000 - scaled) > 1e-7) throw invalid()
  return value
}

function positiveInteger(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw invalid()
  return value
}

function nullableText(value, maximum) {
  return value === null ? null : text(value, maximum)
}

function instant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw invalid()
  return value
}

function nullableInstant(value) {
  return value === null ? null : instant(value)
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

export function normalizeSettlementMonth(value) {
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) throw invalid('结算月份无效')
  return value
}

export function normalizeIssueDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw invalid('请求书日期无效')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day) throw invalid('请求书日期无效')
  return value
}

export function normalizeProjectIds(value) {
  const ids = denseArray(value, 500).map((id) => text(id, 500))
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw invalid('结算项目无效')
  return ids.sort((left, right) => left.localeCompare(right))
}

function normalizeIncompleteSources(value) {
  const sources = denseArray(value, 100).map((source) => text(source, 200))
  if (new Set(sources).size !== sources.length) throw invalid()
  return sources
}

export function normalizeSettlementCandidate(value, selectedMonth) {
  const source = exactObject(value, CANDIDATE_FIELDS)
  const month = normalizeSettlementMonth(selectedMonth)
  const completionDate = normalizeIssueDate(source.completionDate)
  const completionMonth = normalizeSettlementMonth(source.completionMonth)
  if (completionDate.slice(0, 7) !== completionMonth || completionMonth > month) throw invalid()
  if (typeof source.costComplete !== 'boolean') throw invalid()
  const incompleteSources = normalizeIncompleteSources(source.incompleteSources)
  if (source.costComplete !== (incompleteSources.length === 0)) throw invalid()
  const taxExclusiveAmount = yenInteger(source.taxExclusiveAmount)
  const taxAmount = yenInteger(source.taxAmount)
  const taxInclusiveAmount = yenInteger(source.taxInclusiveAmount)
  if (taxExclusiveAmount + taxAmount !== taxInclusiveAmount) throw invalid()
  return deepFreeze({
    projectId: text(source.projectId, 500),
    projectName: text(source.projectName, 500),
    address: text(source.address, 1000, { empty: true }),
    completionDate,
    completionMonth,
    billingVersion: positiveInteger(source.billingVersion),
    taxExclusiveAmount,
    taxAmount,
    taxInclusiveAmount,
    costAmount: money(source.costAmount),
    costComplete: source.costComplete,
    incompleteSources,
    carriedForward: completionMonth < month,
  })
}

function normalizeSettlementItem(value) {
  const source = exactObject(value, ITEM_FIELDS)
  const amounts = calculateBillingAmounts(source.quantity, source.unitPrice, source.taxRate)
  if (source.taxExclusiveAmount !== amounts.taxExclusiveAmount ||
      source.taxAmount !== amounts.taxAmount ||
      source.taxInclusiveAmount !== amounts.taxInclusiveAmount) throw invalid()
  return {
    itemName: text(source.itemName, 200),
    description: text(source.description, 1000, { empty: true }),
    quantity: source.quantity,
    unit: text(source.unit, 50),
    unitPrice: yenInteger(source.unitPrice),
    taxRate: source.taxRate,
    ...amounts,
  }
}

function normalizeSettlementProject(value) {
  const source = exactObject(value, PROJECT_FIELDS)
  const items = denseArray(source.items, 500).map(normalizeSettlementItem)
  if (items.length === 0) throw invalid()
  const totals = items.reduce((sum, item) => ({
    taxExclusiveAmount: sum.taxExclusiveAmount + item.taxExclusiveAmount,
    taxAmount: sum.taxAmount + item.taxAmount,
    taxInclusiveAmount: sum.taxInclusiveAmount + item.taxInclusiveAmount,
  }), { taxExclusiveAmount: 0, taxAmount: 0, taxInclusiveAmount: 0 })
  for (const key of Object.keys(totals)) {
    yenInteger(totals[key])
    if (source[key] !== totals[key]) throw invalid()
  }
  if (typeof source.costSnapshotToken !== 'string' ||
      !TOKEN_PATTERN.test(source.costSnapshotToken)) throw invalid()
  return {
    projectId: text(source.projectId, 500),
    projectName: text(source.projectName, 500),
    address: text(source.address, 1000, { empty: true }),
    completionDate: normalizeIssueDate(source.completionDate),
    billingVersion: positiveInteger(source.billingVersion),
    costSnapshotToken: source.costSnapshotToken,
    costAmount: money(source.costAmount),
    ...totals,
    items,
  }
}

export function normalizeSettlement(value) {
  const source = exactObject(value, SETTLEMENT_FIELDS)
  const month = normalizeSettlementMonth(source.month)
  const invoiceMatch = typeof source.invoiceNo === 'string' ? source.invoiceNo.match(INVOICE_PATTERN) : null
  if (!invoiceMatch || `${invoiceMatch[1]}-${invoiceMatch[2]}` !== month) throw invalid()
  const projects = denseArray(source.projects, 500).map(normalizeSettlementProject)
  if (projects.length === 0 || new Set(projects.map(({ projectId }) => projectId)).size !== projects.length) {
    throw invalid()
  }
  const totals = projects.reduce((sum, project) => ({
    taxExclusiveAmount: sum.taxExclusiveAmount + project.taxExclusiveAmount,
    taxAmount: sum.taxAmount + project.taxAmount,
    taxInclusiveAmount: sum.taxInclusiveAmount + project.taxInclusiveAmount,
    totalCostAmount: sum.totalCostAmount + project.costAmount,
  }), { taxExclusiveAmount: 0, taxAmount: 0, taxInclusiveAmount: 0, totalCostAmount: 0 })
  totals.marginAmount = totals.taxExclusiveAmount - totals.totalCostAmount
  money(totals.totalCostAmount)
  money(totals.marginAmount, { signed: true })
  for (const key of Object.keys(totals)) {
    if (source[key] !== totals[key]) throw invalid()
  }
  if (!STATUS_VALUES.has(source.status) || typeof source.id !== 'string' ||
      !UUID_PATTERN.test(source.id)) throw invalid()
  const result = {
    id: source.id,
    invoiceNo: source.invoiceNo,
    month,
    issueDate: normalizeIssueDate(source.issueDate),
    status: source.status,
    version: positiveInteger(source.version),
    ...totals,
    projects,
    createdAt: instant(source.createdAt),
    createdByName: text(source.createdByName, 500),
    confirmedAt: nullableInstant(source.confirmedAt),
    confirmedByName: nullableText(source.confirmedByName, 500),
    voidedAt: nullableInstant(source.voidedAt),
    voidedByName: nullableText(source.voidedByName, 500),
    voidReason: nullableText(source.voidReason, 1000),
  }
  if (result.status === 'draft' && [result.confirmedAt, result.confirmedByName, result.voidedAt,
    result.voidedByName, result.voidReason].some((entry) => entry !== null)) throw invalid()
  if (result.status === 'confirmed' && (!result.confirmedAt || !result.confirmedByName ||
    result.voidedAt || result.voidedByName || result.voidReason)) throw invalid()
  if (result.status === 'voided' && (!result.voidedAt || !result.voidedByName || !result.voidReason ||
    Boolean(result.confirmedAt) !== Boolean(result.confirmedByName))) throw invalid()
  return deepFreeze(result)
}

export function settlementConfirmDecision(value) {
  if (!value || value.status !== 'draft') {
    return Object.freeze({ allowed: false, reason: '只有草稿可以确认' })
  }
  if (!Array.isArray(value.projects) || value.projects.length === 0 ||
      value.projects.some((project) => typeof project?.costSnapshotToken !== 'string' ||
        !TOKEN_PATTERN.test(project.costSnapshotToken))) {
    return Object.freeze({ allowed: false, reason: '项目成本尚未完整，不能确认结算' })
  }
  return Object.freeze({ allowed: true, reason: '' })
}

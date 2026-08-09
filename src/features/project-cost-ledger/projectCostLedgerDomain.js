import {
  fromFourDecimalUnits,
  toSignedFourDecimalUnits,
} from '../cost-accounting/fixedPointCurrency.js'

const LEDGER_RESPONSE_FIELDS = Object.freeze([
  'status', 'generatedAt', 'page', 'pageSize', 'totalRows', 'rows', 'categoryTotals',
  'totalAmount', 'adjustmentTotal', 'incompleteSources',
])
const LEDGER_ROW_FIELDS = Object.freeze([
  'sourceKey', 'sourceModule', 'sourceDocumentType', 'sourceDocumentId', 'projectId',
  'projectName', 'category', 'date', 'description', 'originalAmount', 'adjustmentAmount',
  'effectiveAmount', 'operator', 'adjusted', 'version', 'allocations', 'auditEvents',
])
const CATEGORY_TOTAL_FIELDS = Object.freeze(['category', 'amount'])
const ALLOCATION_FIELDS = Object.freeze(['projectId', 'amount'])
const ALLOCATION_DRAFT_FIELDS = Object.freeze(['projectId', 'mode', 'value'])
const FILTER_FIELDS = Object.freeze([
  'projectId', 'dateFrom', 'dateTo', 'category', 'sourceModule', 'adjusted', 'keyword',
])
const LOCAL_SOURCE_FIELDS = Object.freeze([
  'purchaseRows', 'warehouseCosts', 'laborRows', 'vehicleRows', 'toolRows',
  'operatingExpenses', 'manualProjectCosts',
])
const CATEGORY_ORDER = Object.freeze([
  '人工费', '材料费', '车辆费', '工具费', '外包费', '运输费', '经营费用', '其他费用',
])
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactObject(value, fields, message) {
  try {
    if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError()
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== fields.length) throw new TypeError()
    const expected = new Set(fields)
    const result = Object.create(null)
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!expected.has(key) || descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      result[key] = descriptor.value
    }
    return result
  } catch (cause) {
    throw new TypeError(message, { cause })
  }
}

function optionalObject(value, fields, message) {
  try {
    if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError()
    const allowed = new Set(fields)
    const result = Object.create(null)
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!allowed.has(key) || descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      result[key] = descriptor.value
    }
    return result
  } catch (cause) {
    throw new TypeError(message, { cause })
  }
}

function exactArray(value, message = 'ledger array invalid') {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError()
    const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
    const names = Object.getOwnPropertyNames(value)
    if (!Number.isSafeInteger(length) || length < 0 || names.length !== length + 1) throw new TypeError()
    const result = new Array(length)
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      result[index] = descriptor.value
    }
    return result
  } catch (cause) {
    throw new TypeError(message, { cause })
  }
}

function deepCopy(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('unsafe number')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('unsupported data')
  if (ancestors.has(value)) throw new TypeError('cyclic data')
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return exactArray(value, 'unsafe array').map((item) => deepCopy(item, ancestors))
    if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError('unsafe object')
    }
    const result = {}
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (POLLUTION_KEYS.has(key) || descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) throw new TypeError('unsafe object field')
      Object.defineProperty(result, key, {
        value: deepCopy(descriptor.value, ancestors), enumerable: true, writable: true, configurable: true,
      })
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

function text(value, name, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) ||
      value.trim() !== value || POLLUTION_KEYS.has(value)) throw new TypeError(`${name} invalid`)
  return value
}

function date(value, name) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw new TypeError(`${name} invalid`)
  return value
}

function instant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new TypeError('generatedAt invalid')
  }
  return value
}

function signedMoney(value, name = 'amount') {
  if (toSignedFourDecimalUnits(value) === null) throw new TypeError(`${name} invalid`)
  return value
}

function safeInteger(value, minimum, name) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new TypeError(`${name} invalid`)
  return value
}

function allowedPageSize(value) {
  const pageSize = safeInteger(value, 1, 'pageSize')
  if (pageSize > 100) throw new TypeError('pageSize invalid')
  return pageSize
}

function sourceName(value) {
  return text(value, 'source name')
}

function normalizeAllocation(value) {
  const allocation = exactObject(value, ALLOCATION_FIELDS, 'ledger allocation invalid')
  return { projectId: text(allocation.projectId, 'allocation projectId'), amount: signedMoney(allocation.amount) }
}

function normalizeLedgerRow(value) {
  const row = exactObject(value, LEDGER_ROW_FIELDS, 'project cost ledger row invalid')
  const originalAmount = signedMoney(row.originalAmount, 'originalAmount')
  const adjustmentAmount = signedMoney(row.adjustmentAmount, 'adjustmentAmount')
  const effectiveAmount = signedMoney(row.effectiveAmount, 'effectiveAmount')
  const units = toSignedFourDecimalUnits(originalAmount) + toSignedFourDecimalUnits(adjustmentAmount)
  if (fromFourDecimalUnits(units) !== effectiveAmount || typeof row.adjusted !== 'boolean' ||
      row.adjusted !== (adjustmentAmount !== 0)) throw new TypeError('project cost ledger row invalid')
  return {
    sourceKey: text(row.sourceKey, 'sourceKey'), sourceModule: text(row.sourceModule, 'sourceModule'),
    sourceDocumentType: text(row.sourceDocumentType, 'sourceDocumentType'),
    sourceDocumentId: text(row.sourceDocumentId, 'sourceDocumentId'),
    projectId: text(row.projectId, 'projectId'), projectName: text(row.projectName, 'projectName', true),
    category: text(row.category, 'category'), date: date(row.date, 'date'),
    description: text(row.description, 'description', true), originalAmount, adjustmentAmount,
    effectiveAmount, operator: text(row.operator, 'operator', true), adjusted: row.adjusted,
    version: safeInteger(row.version, 1, 'version'),
    allocations: exactArray(row.allocations).map(normalizeAllocation),
    auditEvents: exactArray(row.auditEvents).map((event) => deepCopy(event)),
  }
}

function normalizeCategoryTotal(value) {
  const total = exactObject(value, CATEGORY_TOTAL_FIELDS, 'ledger category total invalid')
  return { category: text(total.category, 'category'), amount: signedMoney(total.amount) }
}

export function normalizeLedgerSnapshot(response) {
  const source = exactObject(response, LEDGER_RESPONSE_FIELDS, 'project cost ledger response invalid')
  if (source.status !== 'ready') throw new TypeError('project cost ledger response invalid')
  const rows = exactArray(source.rows).map(normalizeLedgerRow)
  const categoryTotals = exactArray(source.categoryTotals).map(normalizeCategoryTotal)
  return deepFreeze({
    status: 'ready', generatedAt: instant(source.generatedAt),
    page: safeInteger(source.page, 1, 'page'), pageSize: allowedPageSize(source.pageSize),
    totalRows: safeInteger(source.totalRows, 0, 'totalRows'), rows, categoryTotals,
    totalAmount: signedMoney(source.totalAmount), adjustmentTotal: signedMoney(source.adjustmentTotal),
    incompleteSources: exactArray(source.incompleteSources).map(sourceName),
  })
}

function safeLocalRow(value) {
  return deepCopy(value)
}

function localValue(row, names, fallback = '') {
  for (const name of names) {
    if (Object.hasOwn(row, name) && typeof row[name] === 'string') return row[name]
  }
  return fallback
}

function localAmount(row) {
  for (const name of ['amount', 'totalCost', 'repairCost', 'fuelAmount']) {
    if (Object.hasOwn(row, name) && toSignedFourDecimalUnits(row[name]) !== null) return row[name]
  }
  return null
}

function localFact(module, row, config) {
  const id = localValue(row, config.ids)
  const projectId = localValue(row, ['projectId'])
  const amount = localAmount(row)
  const rowDate = localValue(row, config.dates)
  if (!id || !projectId || amount === null || !DATE_PATTERN.test(rowDate)) return null
  const category = localValue(row, ['costType'], config.category)
  return {
    sourceKey: `${module}:${id}`, sourceModule: module,
    sourceDocumentType: config.documentType, sourceDocumentId: id,
    projectId, projectName: localValue(row, ['projectName'], ''), category,
    date: rowDate, description: localValue(row, ['description', 'name'], ''),
    originalAmount: amount, adjustmentAmount: 0, effectiveAmount: amount,
    operator: localValue(row, ['operator', 'createdBy'], ''), adjusted: false, version: 1,
    allocations: [], auditEvents: [],
  }
}

const LOCAL_SOURCE_CONFIG = Object.freeze([
  ['purchase', 'purchaseRows', { ids: ['purchaseId', 'id'], dates: ['purchaseDate', 'date'], category: '材料费', documentType: 'purchase_order' }],
  ['warehouse', 'warehouseCosts', { ids: ['costRecordId', 'sourceDocumentId', 'id'], dates: ['date'], category: '材料费', documentType: 'warehouse_stock_out' }],
  ['labor', 'laborRows', { ids: ['laborId', 'id'], dates: ['date', 'laborDate'], category: '人工费', documentType: 'labor_cost' }],
  ['vehicle', 'vehicleRows', { ids: ['vehicleExpenseId', 'fuelRecordId', 'issueId', 'id'], dates: ['expenseDate', 'fuelDate', 'issueDate', 'date'], category: '车辆费', documentType: 'vehicle_expense' }],
  ['tool', 'toolRows', { ids: ['toolId', 'id'], dates: ['date'], category: '工具费', documentType: 'tool_cost' }],
  ['operating', 'operatingExpenses', { ids: ['operatingExpenseId', 'id'], dates: ['date'], category: '经营费用', documentType: 'operating_expense' }],
  ['manual', 'manualProjectCosts', { ids: ['costRecordId', 'id'], dates: ['date'], category: '其他费用', documentType: 'manual_project_cost' }],
])

export function buildLocalSourceFacts(input) {
  const source = exactObject(input, LOCAL_SOURCE_FIELDS, 'local ledger sources invalid')
  const facts = []
  for (const [module, key, config] of LOCAL_SOURCE_CONFIG) {
    for (const rawRow of exactArray(source[key], `local ${key} invalid`)) {
      const fact = localFact(module, safeLocalRow(rawRow), config)
      if (fact) facts.push(fact)
    }
  }
  return deepFreeze(facts)
}

function normalizedFilters(filters) {
  const source = optionalObject(filters, FILTER_FIELDS, 'ledger filters invalid')
  const result = {}
  for (const key of ['projectId', 'category', 'sourceModule']) {
    if (Object.hasOwn(source, key) && source[key] !== 'all') result[key] = text(source[key], key)
  }
  for (const key of ['dateFrom', 'dateTo']) {
    if (Object.hasOwn(source, key) && source[key] !== '') result[key] = date(source[key], key)
  }
  if (result.dateFrom && result.dateTo && result.dateFrom > result.dateTo) throw new TypeError('ledger date range invalid')
  if (Object.hasOwn(source, 'adjusted') && source.adjusted !== 'all') {
    if (!['adjusted', 'unadjusted'].includes(source.adjusted)) throw new TypeError('adjusted filter invalid')
    result.adjusted = source.adjusted
  }
  if (Object.hasOwn(source, 'keyword') && source.keyword !== '') result.keyword = text(source.keyword, 'keyword')
  return result
}

export function applyLedgerFilters(snapshot, filters = {}) {
  const source = optionalObject(snapshot, ['rows'], 'ledger snapshot invalid')
  if (!Object.hasOwn(source, 'rows')) throw new TypeError('ledger snapshot invalid')
  const active = normalizedFilters(filters)
  const rows = exactArray(source.rows).map(normalizeLedgerRow)
  return deepFreeze(rows.filter((row) => {
    if (active.projectId && row.projectId !== active.projectId) return false
    if (active.dateFrom && row.date < active.dateFrom) return false
    if (active.dateTo && row.date > active.dateTo) return false
    if (active.category && row.category !== active.category) return false
    if (active.sourceModule && row.sourceModule !== active.sourceModule) return false
    if (active.adjusted === 'adjusted' && !row.adjusted) return false
    if (active.adjusted === 'unadjusted' && row.adjusted) return false
    return !active.keyword || `${row.description} ${row.sourceDocumentId}`.toLocaleLowerCase().includes(active.keyword.toLocaleLowerCase())
  }))
}

export function paginateLedgerRows(rows, page, pageSize) {
  const safeRows = exactArray(rows, 'ledger rows invalid').map(normalizeLedgerRow)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) return deepFreeze([])
  const start = (page - 1) * pageSize
  if (!Number.isSafeInteger(start)) return deepFreeze([])
  return deepFreeze(safeRows.slice(start, start + pageSize))
}

export function summarizeLedgerRows(rows) {
  const normalized = exactArray(rows, 'ledger rows invalid').map(normalizeLedgerRow)
  let totalUnits = 0
  let adjustmentUnits = 0
  const categories = new Map()
  for (const row of normalized) {
    const amountUnits = toSignedFourDecimalUnits(row.effectiveAmount)
    const adjustment = toSignedFourDecimalUnits(row.adjustmentAmount)
    totalUnits += amountUnits
    adjustmentUnits += adjustment
    if (!Number.isSafeInteger(totalUnits) || !Number.isSafeInteger(adjustmentUnits)) throw new TypeError('ledger total overflow')
    categories.set(row.category, (categories.get(row.category) ?? 0) + amountUnits)
    if (!Number.isSafeInteger(categories.get(row.category))) throw new TypeError('ledger total overflow')
  }
  const orderedCategories = [...categories.keys()].sort((left, right) => {
    const leftIndex = CATEGORY_ORDER.indexOf(left)
    const rightIndex = CATEGORY_ORDER.indexOf(right)
    return (leftIndex === -1 ? CATEGORY_ORDER.length : leftIndex) -
      (rightIndex === -1 ? CATEGORY_ORDER.length : rightIndex) || left.localeCompare(right, 'zh-Hans-CN')
  })
  return deepFreeze({
    totalAmount: fromFourDecimalUnits(totalUnits), adjustmentTotal: fromFourDecimalUnits(adjustmentUnits),
    rowCount: normalized.length,
    categoryTotals: orderedCategories.map((category) => ({
      category, amount: fromFourDecimalUnits(categories.get(category)),
    })),
  })
}

export function buildAllocationAmounts(effectiveAmount, drafts) {
  const effectiveUnits = toSignedFourDecimalUnits(effectiveAmount)
  if (effectiveUnits === null) throw new TypeError('effective amount invalid')
  const allocations = exactArray(drafts, 'allocation drafts invalid').map((draft) => {
    const value = exactObject(draft, ALLOCATION_DRAFT_FIELDS, 'allocation draft invalid')
    if (!['percent', 'amount'].includes(value.mode)) throw new TypeError('allocation mode invalid')
    return { projectId: text(value.projectId, 'allocation projectId'), mode: value.mode, value: signedMoney(value.value, 'allocation value') }
  })
  if (allocations.length === 0) return deepFreeze([])
  if (new Set(allocations.map(({ projectId }) => projectId)).size !== allocations.length) {
    throw new TypeError('allocation projects must be unique')
  }
  const mode = allocations[0].mode
  if (allocations.some((allocation) => allocation.mode !== mode)) throw new TypeError('allocation modes must match')
  const amounts = []
  let assignedUnits = 0
  if (mode === 'percent') {
    const percentageUnits = allocations.reduce((total, allocation) => total + toSignedFourDecimalUnits(allocation.value), 0)
    if (percentageUnits !== 1000000) throw new TypeError('allocation percentages must equal 100')
    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index]
      const amountUnits = index === allocations.length - 1
        ? effectiveUnits - assignedUnits
        : Math.round((effectiveUnits * toSignedFourDecimalUnits(allocation.value)) / 1000000)
      assignedUnits += amountUnits
      amounts.push({ projectId: allocation.projectId, amount: fromFourDecimalUnits(amountUnits) })
    }
  } else {
    for (const allocation of allocations) {
      const amountUnits = toSignedFourDecimalUnits(allocation.value)
      assignedUnits += amountUnits
      amounts.push({ projectId: allocation.projectId, amount: fromFourDecimalUnits(amountUnits) })
    }
    if (assignedUnits !== effectiveUnits) throw new TypeError('allocation amounts must equal effective amount')
  }
  return deepFreeze(amounts)
}

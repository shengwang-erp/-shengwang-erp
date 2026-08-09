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
const ALLOWED_PAGE_SIZES = new Set([20, 50, 100])
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const INACTIVE_STATUSES = new Set([
  'void', 'deleted', 'inactive', 'cancelled', 'canceled', '作废', '已删除', '取消', '已取消',
])
const CONFIRMED_WAREHOUSE_STATUSES = new Set([
  'confirmed', 'ready', 'approved', 'completed', '已确认', '已完成',
])
const WAREHOUSE_COST_SOURCE_TYPES = new Set(['warehouse', 'warehouseReversal'])
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
  if (!ALLOWED_PAGE_SIZES.has(pageSize)) throw new TypeError('pageSize invalid')
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
  const allocations = exactArray(row.allocations).map(normalizeAllocation)
  const allocationUnits = allocations.reduce(
    (total, allocation) => total + BigInt(toSignedFourDecimalUnits(allocation.amount)), 0n,
  )
  if (allocationUnits !== BigInt(toSignedFourDecimalUnits(effectiveAmount))) {
    throw new TypeError('project cost ledger row invalid')
  }
  return {
    sourceKey: text(row.sourceKey, 'sourceKey'), sourceModule: text(row.sourceModule, 'sourceModule'),
    sourceDocumentType: text(row.sourceDocumentType, 'sourceDocumentType'),
    sourceDocumentId: text(row.sourceDocumentId, 'sourceDocumentId'),
    projectId: text(row.projectId, 'projectId'), projectName: text(row.projectName, 'projectName', true),
    category: text(row.category, 'category'), date: date(row.date, 'date'),
    description: text(row.description, 'description', true), originalAmount, adjustmentAmount,
    effectiveAmount, operator: text(row.operator, 'operator', true), adjusted: row.adjusted,
    version: safeInteger(row.version, 1, 'version'),
    allocations,
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

function inactiveLocalRow(row) {
  if (row.deleted === true || row.isDeleted === true) return true
  return ['status', 'statusCode', 'recordStatus', 'purchaseStatus'].some((field) => {
    const status = row[field]
    return typeof status === 'string' && (
      INACTIVE_STATUSES.has(status) || INACTIVE_STATUSES.has(status.toLowerCase())
    )
  })
}

function safeSourcePurchaseKeys(row) {
  if (!Object.hasOwn(row, 'sourcePurchaseRecordKeys')) return []
  const keys = exactArray(row.sourcePurchaseRecordKeys, 'warehouse purchase links invalid')
  if (keys.some((key) => typeof key !== 'string' || key.length === 0 ||
      key.trim() !== key || POLLUTION_KEYS.has(key))) {
    throw new TypeError('warehouse purchase links invalid')
  }
  return keys
}

function confirmedWarehousePurchaseLinks(row) {
  if (WAREHOUSE_COST_SOURCE_TYPES.has(row.sourceType)) return true
  if (row.confirmed === true || row.isConfirmed === true) return true
  for (const field of ['status', 'batchStatus', 'confirmationStatus', 'confirmedStatus']) {
    if (!Object.hasOwn(row, field)) continue
    const status = row[field]
    return typeof status === 'string' && (
      CONFIRMED_WAREHOUSE_STATUSES.has(status) ||
      CONFIRMED_WAREHOUSE_STATUSES.has(status.toLowerCase())
    )
  }
  return false
}

function purchaseStableKeys(row) {
  return ['recordKey', 'purchaseRecordKey', 'purchaseId', 'id'].filter((field) => {
    const value = row[field]
    return typeof value === 'string' && value.length > 0 && value.trim() === value &&
      !POLLUTION_KEYS.has(value)
  }).map((field) => row[field])
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
    allocations: amount === 0 ? [] : [{ projectId, amount }], auditEvents: [],
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
  const localRows = Object.fromEntries(LOCAL_SOURCE_FIELDS.map((key) => [
    key, exactArray(source[key], `local ${key} invalid`).map(safeLocalRow),
  ]))
  const warehouseConfig = LOCAL_SOURCE_CONFIG.find(([, key]) => key === 'warehouseCosts')[2]
  const warehouseRows = localRows.warehouseCosts.filter(
    (row) => !inactiveLocalRow(row) &&
      localFact('warehouse', row, warehouseConfig) !== null,
  )
  const warehousePurchaseKeys = new Set(
    warehouseRows.filter(confirmedWarehousePurchaseLinks).flatMap((row) => safeSourcePurchaseKeys(row)),
  )
  const facts = []
  for (const [module, key, config] of LOCAL_SOURCE_CONFIG) {
    const rows = key === 'warehouseCosts' ? warehouseRows : localRows[key]
    for (const row of rows) {
      if (inactiveLocalRow(row) || (key === 'purchaseRows' &&
          purchaseStableKeys(row).some((stableKey) => warehousePurchaseKeys.has(stableKey)))) continue
      const fact = localFact(module, row, config)
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

export function paginateLedgerRows(rows, page = 1, pageSize = 20) {
  const safeRows = exactArray(rows, 'ledger rows invalid').map(normalizeLedgerRow)
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1) return deepFreeze([])
  allowedPageSize(pageSize)
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
  if (mode === 'percent') {
    const percentageUnits = allocations.reduce(
      (total, allocation) => total + BigInt(toSignedFourDecimalUnits(allocation.value)), 0n,
    )
    if (percentageUnits !== 1000000n) throw new TypeError('allocation percentages must equal 100')
    const fixedUnits = BigInt(effectiveUnits)
    const allocated = allocations.slice(0, -1).map((allocation) => stableAllocationAmount(
      roundedAllocationUnits(effectiveUnits, toSignedFourDecimalUnits(allocation.value)),
    ))
    const finalAllocation = finalStableAllocation(fixedUnits, allocated)
    for (let index = 0; index < allocations.length - 1; index += 1) {
      amounts.push({ projectId: allocations[index].projectId, amount: allocated[index].amount })
    }
    amounts.push({ projectId: allocations.at(-1).projectId, amount: finalAllocation.amount })
  } else {
    let assignedUnits = 0n
    for (const allocation of allocations) {
      const amount = stableAllocationAmount(BigInt(toSignedFourDecimalUnits(allocation.value)))
      assignedUnits += amount.units
      amounts.push({ projectId: allocation.projectId, amount: amount.amount })
    }
    if (assignedUnits !== BigInt(effectiveUnits)) throw new TypeError('allocation amounts must equal effective amount')
  }
  return deepFreeze(amounts)
}

function roundedAllocationUnits(effectiveUnits, percentageUnits) {
  const numerator = BigInt(effectiveUnits) * BigInt(percentageUnits)
  const divisor = 1000000n
  const sign = numerator < 0n ? -1n : 1n
  return sign * ((sign * numerator + divisor / 2n) / divisor)
}

function stableAllocationAmount(units) {
  if (units < BigInt(Number.MIN_SAFE_INTEGER) || units > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('allocation amount overflow')
  }
  const original = Number(units)
  const directAmount = fromFourDecimalUnits(original)
  if (toSignedFourDecimalUnits(directAmount) === original) {
    return { units, amount: directAmount }
  }
  for (let distance = 1n; distance <= 16n; distance += 1n) {
    for (const candidate of [units - distance, units + distance]) {
      if (candidate < BigInt(Number.MIN_SAFE_INTEGER) || candidate > BigInt(Number.MAX_SAFE_INTEGER)) continue
      const amount = fromFourDecimalUnits(Number(candidate))
      if (toSignedFourDecimalUnits(amount) === Number(candidate)) return { units: candidate, amount }
    }
  }
  throw new TypeError('allocation amount is not representable')
}

function finalStableAllocation(effectiveUnits, allocated) {
  const allocatedUnits = () => allocated.reduce((total, allocation) => total + allocation.units, 0n)
  let remainder = effectiveUnits - allocatedUnits()
  let final = stableAllocationAmount(remainder)
  if (final.units === remainder) return final
  for (let index = allocated.length - 1; index >= 0; index -= 1) {
    const original = allocated[index]
    for (let delta = 1n; delta <= 16n; delta += 1n) {
      for (const direction of [-1n, 1n]) {
        const adjusted = stableAllocationAmount(original.units + direction * delta)
        allocated[index] = adjusted
        remainder = effectiveUnits - allocatedUnits()
        final = stableAllocationAmount(remainder)
        if (final.units === remainder) return final
      }
    }
    allocated[index] = original
  }
  throw new TypeError('allocation remainder is not representable')
}

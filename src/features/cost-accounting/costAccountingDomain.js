import { monthOfDate, normalizeMonth } from '../executive-dashboard/dashboardTime.js'
import {
  bridgeWarehouseMaterialCosts,
  MAX_WAREHOUSE_MATERIAL_COST,
} from './warehouseMaterialCostBridge.js'
import { fromFourDecimalUnits, toSignedFourDecimalUnits } from './fixedPointCurrency.js'
import {
  normalizeLedgerSnapshot,
  normalizeProjectCostAccountingSummary,
} from '../project-cost-ledger/projectCostLedgerDomain.js'

const PENDING_MANUAL_TYPES = new Set(['人工费', '材料费', '工具费', '车辆费'])
const CONFIRMED_MANUAL_TYPES = new Set(['外包费', '运输费', '其他费用'])
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const POSIX_EDGE_SPACE = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/gu
const MAX_IDENTIFIER_LENGTH = 500
const MALFORMED_ROW = Symbol('malformed-row')
const UNSUPPORTED_OUTPUT_DATA = Symbol('unsupported-output-data')
const READY_LABOR_SOURCES = new Set(['formal', 'legacy'])
const LEDGER_COST_PARTS = Object.freeze(['labor', 'purchase', 'vehicle', 'manual', 'operating'])
const MAX_SAFE_FIXED_UNITS = BigInt(Number.MAX_SAFE_INTEGER)
const PROJECT_LEDGER_STATE_KEYS = Object.freeze(['status', 'data'])
const PROJECT_LEDGER_STATES = new Set(['ready', 'loading', 'error', 'forbidden'])
const LEDGER_CATEGORY_PART = Object.freeze({
  人工费: 'labor',
  材料费: 'purchase',
  车辆费: 'vehicle',
  工具费: 'manual',
  外包费: 'manual',
  运输费: 'manual',
  经营费用: 'operating',
  其他费用: 'manual',
})

const INPUT_KEYS = Object.freeze([
  'months',
  'selectedMonth',
  'projectId',
  'activeProjectIds',
  'laborWindow',
  'purchaseRows',
  'fuelRecords',
  'vehicleExpenseRecords',
  'vehicleIssueRecords',
  'manualProjectCosts',
  'operatingExpenses',
])
const INPUT_KEYS_WITH_PROJECT_LEDGER = Object.freeze([...INPUT_KEYS, 'projectLedgerSummary'])

const LABOR_WINDOW_KEYS = Object.freeze([
  'monthly',
  'projectLaborLifetimeById',
  'lifetimeStatus',
  'lifetimeStale',
  'incompleteMonths',
  'staleMonths',
])

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactSnapshot(value, expectedKeys, message) {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError()
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== expectedKeys.length) throw new TypeError()
    const expected = new Set(expectedKeys)
    const snapshot = {}
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!expected.has(name) || descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      snapshot[name] = descriptor.value
    }
    return snapshot
  } catch (cause) {
    throw new TypeError(message, { cause })
  }
}

function snapshotArray(value, name) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${name} must be a plain array`)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key))) {
    throw new TypeError(`${name} must not contain expanded properties`)
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw new TypeError(`${name} has an invalid length`)
  }
  const length = lengthDescriptor.value
  const entries = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    entries.push(
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
        ? descriptor.value
        : MALFORMED_ROW,
    )
  }
  return entries
}

function safeYen(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
    ? value
    : null
}

function fixedCostUnits(value) {
  return toSignedFourDecimalUnits(value)
}

function ledgerUnits(value) {
  const units = fixedCostUnits(value)
  return units === null ? null : BigInt(units)
}

function ledgerAmount(units) {
  if (typeof units !== 'bigint' || units > MAX_SAFE_FIXED_UNITS ||
      units < -MAX_SAFE_FIXED_UNITS) return null
  return fromFourDecimalUnits(Number(units))
}

function ledgerUnitRow(value, parts = LEDGER_COST_PARTS) {
  const result = {}
  for (const part of parts) {
    const units = ledgerUnits(value[part])
    if (units === null) return null
    result[part] = units
  }
  return result
}

function ledgerUnitTotal(parts) {
  let total = 0n
  for (const units of parts) total += units
  return ledgerAmount(total)
}

function ledgerSnapshotSummaryMatches(snapshot) {
  const categoryUnits = new Map()
  let totalUnits = 0n
  for (const row of snapshot.rows) {
    if (!Object.hasOwn(LEDGER_CATEGORY_PART, row.category)) return false
    const units = BigInt(fixedCostUnits(row.effectiveAmount))
    totalUnits += units
    categoryUnits.set(row.category, (categoryUnits.get(row.category) || 0n) + units)
  }
  if (totalUnits !== BigInt(fixedCostUnits(snapshot.totalAmount)) ||
      snapshot.categoryTotals.length !== categoryUnits.size) return false
  const seen = new Set()
  for (const total of snapshot.categoryTotals) {
    if (seen.has(total.category) || !categoryUnits.has(total.category) ||
        categoryUnits.get(total.category) !== BigInt(fixedCostUnits(total.amount))) return false
    seen.add(total.category)
  }
  return true
}

export function isSafeCostAccountingAmount(value) {
  return typeof value === 'number' && value >= 0 && !Object.is(value, -0) &&
    (Number.isSafeInteger(value) || fixedCostUnits(value) !== null)
}

export function isSafeSignedCostAccountingAmount(value) {
  return typeof value === 'number' && !Object.is(value, -0) &&
    (Number.isSafeInteger(value) || fixedCostUnits(value) !== null)
}

export function addSafeCostAccountingAmounts(left, right) {
  if (!isSafeCostAccountingAmount(left) || !isSafeCostAccountingAmount(right)) return null
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) {
    return right <= Number.MAX_SAFE_INTEGER - left ? left + right : null
  }
  const leftUnits = fixedCostUnits(left)
  const rightUnits = fixedCostUnits(right)
  if (leftUnits === null || rightUnits === null ||
      rightUnits > Number.MAX_SAFE_INTEGER - leftUnits) return null
  return fromFourDecimalUnits(leftUnits + rightUnits)
}

export function addSafeSignedCostAccountingAmounts(left, right) {
  if (!isSafeSignedCostAccountingAmount(left) || !isSafeSignedCostAccountingAmount(right)) {
    return null
  }
  if (Number.isSafeInteger(left) && Number.isSafeInteger(right)) {
    const result = left + right
    return Number.isSafeInteger(result) ? result : null
  }
  const leftUnits = fixedCostUnits(left)
  const rightUnits = fixedCostUnits(right)
  if (leftUnits === null || rightUnits === null) return null
  const resultUnits = leftUnits + rightUnits
  return Number.isSafeInteger(resultUnits) ? fromFourDecimalUnits(resultUnits) : null
}

function safeWarehouseYen(value) {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) &&
    Math.abs(value) <= MAX_WAREHOUSE_MATERIAL_COST &&
    fixedCostUnits(value) !== null
    ? value
    : null
}

function safeOwnValue(value, key) {
  if (!isPlainRecord(value)) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function isSafeRow(value) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return false
  try {
    return Object.getOwnPropertyNames(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    })
  } catch {
    return false
  }
}

function supportedOwnDataSnapshot(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : UNSUPPORTED_OUTPUT_DATA
  }
  if (typeof value !== 'object') return UNSUPPORTED_OUTPUT_DATA

  let registered = false
  try {
    if (ancestors.has(value)) return UNSUPPORTED_OUTPUT_DATA
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (array ? prototype !== Array.prototype :
      (prototype !== Object.prototype && prototype !== null)) {
      return UNSUPPORTED_OUTPUT_DATA
    }

    const keys = Reflect.ownKeys(value)
    if (keys.some((key) => typeof key === 'symbol')) return UNSUPPORTED_OUTPUT_DATA
    ancestors.add(value)
    registered = true

    if (array) {
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      const length = lengthDescriptor?.value
      if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
          lengthDescriptor.enumerable !== false || !Number.isSafeInteger(length) ||
          length < 0 || length > 0xffffffff) {
        return UNSUPPORTED_OUTPUT_DATA
      }
      const output = new Array(length)
      for (const key of keys) {
        if (key === 'length') continue
        if (!/^(?:0|[1-9]\d*)$/u.test(key)) return UNSUPPORTED_OUTPUT_DATA
        const index = Number(key)
        if (!Number.isSafeInteger(index) || index >= length || index > 0xfffffffe) {
          return UNSUPPORTED_OUTPUT_DATA
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || descriptor.enumerable !== true ||
            !Object.hasOwn(descriptor, 'value')) return UNSUPPORTED_OUTPUT_DATA
        const child = supportedOwnDataSnapshot(descriptor.value, ancestors)
        if (child === UNSUPPORTED_OUTPUT_DATA) return UNSUPPORTED_OUTPUT_DATA
        Object.defineProperty(output, key, {
          value: child,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      return output
    }

    const output = Object.create(prototype)
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || descriptor.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) return UNSUPPORTED_OUTPUT_DATA
      const child = supportedOwnDataSnapshot(descriptor.value, ancestors)
      if (child === UNSUPPORTED_OUTPUT_DATA) return UNSUPPORTED_OUTPUT_DATA
      Object.defineProperty(output, key, {
        value: child,
        enumerable: true,
        writable: true,
        configurable: true,
      })
    }
    return output
  } catch {
    return UNSUPPORTED_OUTPUT_DATA
  } finally {
    if (registered) ancestors.delete(value)
  }
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH && value.replace(POSIX_EDGE_SPACE, '') === value &&
    !POLLUTION_KEYS.has(value)
}

function isInactive(row) {
  if (safeOwnValue(row, 'deleted') === true || safeOwnValue(row, 'isDeleted') === true) return true
  const statuses = [
    safeOwnValue(row, 'status'),
    safeOwnValue(row, 'statusCode'),
    safeOwnValue(row, 'recordStatus'),
    safeOwnValue(row, 'purchaseStatus'),
  ]
  return statuses.some((value) => {
    if (typeof value !== 'string') return false
    const normalized = value.toLowerCase()
    return normalized === 'void' || normalized === 'deleted' || normalized === 'inactive' ||
      value === '作废' || value === '已删除'
  })
}

function anomaly(anomalies, source, recordId, code, message) {
  anomalies.push({ source, recordId, code, message })
}

function collectActiveRows(rows, { source, idFields, anomalies }) {
  const seen = new Set()
  const collected = []
  rows.forEach((row, index) => {
    const fallbackId = `row-${index + 1}`
    if (row === MALFORMED_ROW || !isSafeRow(row)) {
      anomaly(anomalies, source, fallbackId, 'malformed_row', '记录必须使用普通自有数据字段。')
      return
    }
    let recordId
    for (const field of idFields) {
      const candidate = safeOwnValue(row, field)
      if (candidate !== undefined && candidate !== null && candidate !== '') {
        recordId = candidate
        break
      }
    }
    if (recordId === undefined || recordId === null || recordId === '') {
      anomaly(anomalies, source, fallbackId, 'missing_record_id', '记录缺少稳定标识。')
      return
    }
    if (!validIdentifier(recordId)) {
      anomaly(anomalies, source, fallbackId, 'invalid_record_id', '记录标识无效。')
      return
    }
    if (seen.has(recordId)) {
      anomaly(anomalies, source, recordId, 'duplicate_record_id', '重复记录已忽略。')
      return
    }
    seen.add(recordId)
    if (isInactive(row)) {
      anomaly(anomalies, source, recordId, 'inactive_record', '作废或已删除记录已忽略。')
      return
    }
    collected.push({ row, recordId })
  })
  return collected
}

function normalizeInput(input) {
  const hasProjectLedgerSummary = isPlainRecord(input) &&
    Object.hasOwn(input, 'projectLedgerSummary')
  const snapshot = exactSnapshot(
    input,
    hasProjectLedgerSummary ? INPUT_KEYS_WITH_PROJECT_LEDGER : INPUT_KEYS,
    'cost accounting input must use exact own data fields',
  )
  const months = snapshotArray(snapshot.months, 'months')
  const activeProjectIds = snapshotArray(snapshot.activeProjectIds, 'activeProjectIds')
  if (months.length === 0 || months.some((month) => normalizeMonth(month) !== month) ||
      new Set(months).size !== months.length) throw new TypeError('months are invalid')
  if (!months.includes(snapshot.selectedMonth)) throw new TypeError('selectedMonth is invalid')
  if (activeProjectIds.some((id) => !validIdentifier(id)) ||
      activeProjectIds.includes('all') ||
      new Set(activeProjectIds).size !== activeProjectIds.length) {
    throw new TypeError('activeProjectIds are invalid')
  }
  if (snapshot.projectId !== 'all' && !activeProjectIds.includes(snapshot.projectId)) {
    throw new TypeError('projectId is invalid')
  }
  const laborWindow = exactSnapshot(
    snapshot.laborWindow,
    LABOR_WINDOW_KEYS,
    'laborWindow must use exact own data fields',
  )
  const incompleteMonths = snapshotArray(
    laborWindow.incompleteMonths,
    'laborWindow.incompleteMonths',
  )
  if (incompleteMonths.some((month) => normalizeMonth(month) !== month)) {
    throw new TypeError('laborWindow.incompleteMonths are invalid')
  }
  const purchaseRows = snapshotArray(snapshot.purchaseRows, 'purchaseRows')
  const manualProjectCosts = snapshotArray(snapshot.manualProjectCosts, 'manualProjectCosts')
  const warehouseCandidates = manualProjectCosts.filter((row) => (
    row !== MALFORMED_ROW && isSafeRow(row) &&
    ['warehouse', 'warehouseReversal'].includes(safeOwnValue(row, 'sourceType'))
  ))
  const bridge = bridgeWarehouseMaterialCosts({
    purchaseRows: [],
    projectCostRecords: warehouseCandidates,
    trackedPurchaseRecordKeys: [],
  })
  let projectLedgerSummary = null
  if (hasProjectLedgerSummary) {
    const state = exactSnapshot(
      snapshot.projectLedgerSummary,
      PROJECT_LEDGER_STATE_KEYS,
      'projectLedgerSummary must use exact own data fields',
    )
    if (!PROJECT_LEDGER_STATES.has(state.status) ||
        (state.status === 'ready' ? state.data === null : state.data !== null)) {
      throw new TypeError('projectLedgerSummary state is invalid')
    }
    if (state.status === 'ready') {
      const recognizedProjects = new Set(activeProjectIds)
      if (isPlainRecord(state.data) && Object.hasOwn(state.data, 'projectMonthCategoryTotals')) {
        const data = normalizeProjectCostAccountingSummary(state.data)
        const aggregatesAreMappable = data.projectTotals.every(({ projectId }) => (
          recognizedProjects.has(projectId)
        )) && data.categoryTotals.every(({ category }) => (
          Object.hasOwn(LEDGER_CATEGORY_PART, category)
        )) && data.projectMonthCategoryTotals.every(({ projectId, category }) => (
          recognizedProjects.has(projectId) && Object.hasOwn(LEDGER_CATEGORY_PART, category)
        ))
        projectLedgerSummary = data.incompleteSources.length === 0 && aggregatesAreMappable
          ? { status: 'ready', data, source: 'aggregate' }
          : { status: 'incomplete', data: null }
      } else {
        const data = normalizeLedgerSnapshot(state.data)
        const rowsAreMappable = data.rows.every((row) => (
          monthOfDate(row.date) !== '' && recognizedProjects.has(row.projectId) &&
          row.allocations.every((allocation) => recognizedProjects.has(allocation.projectId))
        ))
        projectLedgerSummary = data.incompleteSources.length === 0 && data.page === 1 &&
            data.totalRows === data.rows.length && ledgerSnapshotSummaryMatches(data) &&
            rowsAreMappable
          ? { status: 'ready', data, source: 'rows' }
          : { status: 'incomplete', data: null }
      }
    } else {
      projectLedgerSummary = { status: state.status, data: null }
    }
  }
  return {
    ...snapshot,
    months,
    activeProjectIds,
    laborWindow: {
      ...laborWindow,
      monthly: snapshotArray(laborWindow.monthly, 'laborWindow.monthly'),
      incompleteMonths: [...new Set(incompleteMonths)],
      staleMonths: snapshotArray(laborWindow.staleMonths, 'laborWindow.staleMonths'),
    },
    purchaseRows,
    fuelRecords: snapshotArray(snapshot.fuelRecords, 'fuelRecords'),
    vehicleExpenseRecords: snapshotArray(snapshot.vehicleExpenseRecords, 'vehicleExpenseRecords'),
    vehicleIssueRecords: snapshotArray(snapshot.vehicleIssueRecords, 'vehicleIssueRecords'),
    manualProjectCosts: manualProjectCosts.filter((row) => !warehouseCandidates.includes(row)),
    warehouseMaterialCosts: bridge.warehouseMaterialCosts,
    operatingExpenses: snapshotArray(snapshot.operatingExpenses, 'operatingExpenses'),
    projectLedgerSummary,
  }
}

function emptyCompanyMonth(month) {
  return {
    month,
    salary: null,
    purchase: 0,
    vehicle: 0,
    manual: 0,
    operating: 0,
    companyOperating: 0,
    total: null,
    laborStatus: 'error',
    laborStale: false,
    laborSource: null,
    laborPendingCount: null,
    incomplete: true,
  }
}

function emptyProjectCost(labor = 0) {
  return { labor, purchase: 0, vehicle: 0, manual: 0, operating: 0 }
}

function safeProjectMap(value) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return null
  const result = new Map()
  let total = 0
  try {
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value') ||
          !validIdentifier(key) || key === 'all') return null
      const amount = safeYen(descriptor.value)
      if (amount === null || amount > Number.MAX_SAFE_INTEGER - total) return null
      result.set(key, amount)
      total += amount
    }
    return { values: result, total }
  } catch {
    return null
  }
}

function sumCostParts(parts) {
  let total = 0
  for (const amount of parts) {
    if (amount === null) return null
    total = addSafeSignedCostAccountingAmounts(total, amount)
    if (total === null) return null
  }
  return total
}

function tryAdd(target, category, amount, signed = false) {
  const total = signed
    ? addSafeSignedCostAccountingAmounts(target[category], amount)
    : addSafeCostAccountingAmounts(target[category], amount)
  if (total === null) return false
  target[category] = total
  return true
}

function projectRelation(row, activeProjects, anomalies, source, recordId) {
  const projectId = safeOwnValue(row, 'projectId')
  if (projectId === undefined || projectId === null || projectId === '') {
    anomaly(anomalies, source, recordId, 'missing_project', '记录缺少项目归属。')
    return null
  }
  if (!validIdentifier(projectId) || !activeProjects.has(projectId)) {
    anomaly(anomalies, source, recordId, 'invalid_project', '记录项目归属无效或已失效。')
    return null
  }
  return projectId
}

function validateAmountAndMonth(
  row,
  amountField,
  dateField,
  anomalies,
  source,
  recordId,
  amountValidator = safeYen,
) {
  const amount = amountValidator(safeOwnValue(row, amountField))
  if (amount === null) {
    anomaly(
      anomalies,
      source,
      recordId,
      'invalid_amount',
      source === 'warehouseMaterialCosts'
        ? '仓库冻结成本必须是有限、安全、正数且最多四位小数。'
        : '金额必须是有限、安全、非负整数日元。',
    )
    return null
  }
  const month = monthOfDate(safeOwnValue(row, dateField))
  if (!month) {
    anomaly(anomalies, source, recordId, 'invalid_date', '记录日期无效。')
    return null
  }
  return { amount, month }
}

export function classifyManualProjectCosts(records = []) {
  const rows = snapshotArray(records, 'records')
  const result = {
    confirmedRows: [],
    manualLaborCosts: [],
    manualMaterialCosts: [],
    manualToolCosts: [],
    manualVehicleCosts: [],
  }
  const pendingKeyByType = {
    人工费: 'manualLaborCosts',
    材料费: 'manualMaterialCosts',
    工具费: 'manualToolCosts',
    车辆费: 'manualVehicleCosts',
  }
  for (const row of rows) {
    if (row === MALFORMED_ROW || !isSafeRow(row)) continue
    const snapshot = supportedOwnDataSnapshot(row)
    if (snapshot === UNSUPPORTED_OUTPUT_DATA) continue
    const type = safeOwnValue(snapshot, 'costType')
    if (CONFIRMED_MANUAL_TYPES.has(type)) {
      result.confirmedRows.push(snapshot)
    } else if (PENDING_MANUAL_TYPES.has(type)) {
      result[pendingKeyByType[type]].push(snapshot)
    }
  }
  return result
}

export function buildCostAccountingReadModel(input) {
  const normalized = normalizeInput(input)
  const ledgerProvided = normalized.projectLedgerSummary !== null
  let ledgerStatus = normalized.projectLedgerSummary?.status || 'legacy'
  const ledgerReady = ledgerStatus === 'ready'
  const anomalies = []
  const monthSet = new Set(normalized.months)
  const activeProjects = new Set(normalized.activeProjectIds)
  let companyByMonth = new Map(normalized.months.map((month) => [month, emptyCompanyMonth(month)]))
  let projectByMonth = new Map(normalized.months.map((month) => [
    month,
    new Map(normalized.activeProjectIds.map((projectId) => [
      projectId,
      emptyProjectCost(ledgerProvided ? (ledgerReady ? 0 : null) : null),
    ])),
  ]))
  let lifetime = new Map(normalized.activeProjectIds.map((projectId) => [
    projectId,
    emptyProjectCost(ledgerProvided ? (ledgerReady ? 0 : null) : null),
  ]))
  const incompleteMonthSet = new Set(normalized.laborWindow.incompleteMonths)

  const laborRows = new Map()
  const duplicateLaborMonths = new Set()
  for (const row of normalized.laborWindow.monthly) {
    if (row === MALFORMED_ROW || !isSafeRow(row)) continue
    const month = safeOwnValue(row, 'month')
    if (normalizeMonth(month) !== month) continue
    if (laborRows.has(month)) {
      if (!duplicateLaborMonths.has(month)) {
        duplicateLaborMonths.add(month)
        anomaly(anomalies, 'laborWindow', month, 'duplicate_labor_month', '重复人工月份已按首条记录处理。')
      }
      continue
    }
    laborRows.set(month, row)
  }
  for (const month of normalized.months) {
    const target = companyByMonth.get(month)
    if (incompleteMonthSet.has(month)) {
      anomaly(anomalies, 'laborWindow', month, 'incomplete_labor_month', '人工月份不完整，未以零值替代。')
      continue
    }
    const labor = laborRows.get(month)
    const salary = labor ? safeYen(safeOwnValue(labor, 'salaryTotal')) : null
    const projectLaborTotal = labor ? safeYen(safeOwnValue(labor, 'projectLaborTotal')) : null
    const projectMap = labor ? safeProjectMap(safeOwnValue(labor, 'projectLaborById')) : null
    const laborStatus = safeOwnValue(labor, 'status')
    const laborSource = safeOwnValue(labor, 'source')
    if (laborStatus === 'ready' && !READY_LABOR_SOURCES.has(laborSource)) {
      anomaly(anomalies, 'laborWindow', month, 'invalid_labor_source', '人工来源必须是 formal 或 legacy。')
      anomaly(anomalies, 'laborWindow', month, 'incomplete_labor_month', '人工月份不完整，未以零值替代。')
      continue
    }
    if (laborStatus !== 'ready' || salary === null ||
        projectLaborTotal === null || !projectMap || projectMap.total !== projectLaborTotal) {
      anomaly(anomalies, 'laborWindow', month, 'incomplete_labor_month', '人工月份不完整，未以零值替代。')
      continue
    }
    target.salary = salary
    target.laborStatus = 'ready'
    target.laborStale = safeOwnValue(labor, 'stale') === true
    target.laborSource = laborSource
    target.laborPendingCount = safeYen(safeOwnValue(labor, 'pendingCount'))
    target.incomplete = false
    if (!ledgerProvided) {
      for (const projectId of normalized.activeProjectIds) {
        projectByMonth.get(month).get(projectId).labor = projectMap.values.get(projectId) || 0
      }
    }
  }

  if (!ledgerProvided) {
    const lifetimeMap = normalized.laborWindow.lifetimeStatus === 'ready'
      ? safeProjectMap(normalized.laborWindow.projectLaborLifetimeById)
      : null
    if (!lifetimeMap) {
      anomaly(anomalies, 'laborWindow', 'lifetime', 'incomplete_labor_lifetime', '累计人工分摊不完整。')
    } else {
      for (const projectId of normalized.activeProjectIds) {
        lifetime.get(projectId).labor = lifetimeMap.values.get(projectId) || 0
      }
    }
  }

  const addFact = ({ source, recordId, month, amount, category, projectId = null }) => {
    if (ledgerProvided && projectId !== null) return
    const targets = []
    if (monthSet.has(month)) targets.push(companyByMonth.get(month))
    if (projectId !== null) {
      if (monthSet.has(month)) targets.push(projectByMonth.get(month).get(projectId))
      targets.push(lifetime.get(projectId))
    }
    let overflowed = false
    for (const target of targets) {
      if (!tryAdd(target, category, amount, source === 'warehouseMaterialCosts')) overflowed = true
    }
    if (projectId === null && category === 'operating' && monthSet.has(month) &&
        !tryAdd(companyByMonth.get(month), 'companyOperating', amount)) {
      overflowed = true
    }
    if (overflowed) {
      anomaly(anomalies, source, recordId, 'amount_overflow', '金额累计超出安全整数范围。')
    }
  }

  for (const { row, recordId } of collectActiveRows(normalized.purchaseRows, {
    source: 'purchaseRows', idFields: ['purchaseId'], anomalies,
  })) {
    const fact = validateAmountAndMonth(row, 'totalCost', 'purchaseDate', anomalies, 'purchaseRows', recordId)
    if (!fact) continue
    const projectId = projectRelation(row, activeProjects, anomalies, 'purchaseRows', recordId)
    addFact({ source: 'purchaseRows', recordId, ...fact, category: 'purchase', projectId })
  }

  for (const { row, recordId } of collectActiveRows(normalized.warehouseMaterialCosts, {
    source: 'warehouseMaterialCosts', idFields: ['costRecordId'], anomalies,
  })) {
    const fact = validateAmountAndMonth(
      row,
      'amount',
      'date',
      anomalies,
      'warehouseMaterialCosts',
      recordId,
      safeWarehouseYen,
    )
    if (!fact) continue
    const projectId = projectRelation(
      row, activeProjects, anomalies, 'warehouseMaterialCosts', recordId,
    )
    if (!projectId) continue
    addFact({ source: 'warehouseMaterialCosts', recordId, ...fact, category: 'purchase', projectId })
  }

  const vehicleSources = [
    [normalized.fuelRecords, 'fuelRecords', 'fuelRecordId', 'fuelAmount', 'fuelDate'],
    [normalized.vehicleExpenseRecords, 'vehicleExpenseRecords', 'vehicleExpenseId', 'amount', 'expenseDate'],
  ]
  for (const [rows, source, idField, amountField, dateField] of vehicleSources) {
    for (const { row, recordId } of collectActiveRows(rows, {
      source, idFields: [idField], anomalies,
    })) {
      const fact = validateAmountAndMonth(row, amountField, dateField, anomalies, source, recordId)
      if (!fact) continue
      let projectId = null
      if (safeOwnValue(row, 'allocateToProject') === true) {
        projectId = projectRelation(row, activeProjects, anomalies, source, recordId)
      } else if (safeOwnValue(row, 'projectId')) {
        anomaly(anomalies, source, recordId, 'ignored_project_fields', '未启用项目分摊，项目字段已忽略。')
      }
      addFact({ source, recordId, ...fact, category: 'vehicle', projectId })
    }
  }

  const pending = {
    manualLaborCosts: [],
    manualMaterialCosts: [],
    manualToolCosts: [],
    manualVehicleCosts: [],
    vehicleRepairEstimates: [],
  }
  const pendingKeyByType = {
    人工费: 'manualLaborCosts', 材料费: 'manualMaterialCosts',
    工具费: 'manualToolCosts', 车辆费: 'manualVehicleCosts',
  }
  for (const { row, recordId } of collectActiveRows(normalized.manualProjectCosts, {
    source: 'manualProjectCosts', idFields: ['costRecordId'], anomalies,
  })) {
    const snapshot = supportedOwnDataSnapshot(row)
    if (snapshot === UNSUPPORTED_OUTPUT_DATA) {
      anomaly(anomalies, 'manualProjectCosts', recordId, 'unsupported_output_data', '记录包含不支持的输出数据。')
      continue
    }
    const fact = validateAmountAndMonth(snapshot, 'amount', 'date', anomalies, 'manualProjectCosts', recordId)
    if (!fact) continue
    const projectId = projectRelation(snapshot, activeProjects, anomalies, 'manualProjectCosts', recordId)
    if (!projectId) continue
    const type = safeOwnValue(snapshot, 'costType')
    if (PENDING_MANUAL_TYPES.has(type)) {
      if (monthSet.has(fact.month) &&
          (normalized.projectId === 'all' || normalized.projectId === projectId)) {
        pending[pendingKeyByType[type]].push(snapshot)
      }
    } else if (CONFIRMED_MANUAL_TYPES.has(type)) {
      addFact({
        source: 'manualProjectCosts', recordId, ...fact,
        category: 'manual', projectId,
      })
    } else {
      anomaly(anomalies, 'manualProjectCosts', recordId, 'unsupported_manual_type', '手工成本类型不受支持。')
    }
  }

  for (const { row, recordId } of collectActiveRows(normalized.operatingExpenses, {
    source: 'operatingExpenses', idFields: ['operatingExpenseId', 'expenseRecordId'], anomalies,
  })) {
    const fact = validateAmountAndMonth(row, 'amount', 'date', anomalies, 'operatingExpenses', recordId)
    if (!fact) continue
    let projectId = null
    if (safeOwnValue(row, 'allocateToProject') === true) {
      projectId = projectRelation(row, activeProjects, anomalies, 'operatingExpenses', recordId)
    } else if (safeOwnValue(row, 'projectId')) {
      anomaly(anomalies, 'operatingExpenses', recordId, 'ignored_project_fields', '未启用项目分摊，项目字段已忽略。')
    }
    addFact({ source: 'operatingExpenses', recordId, ...fact, category: 'operating', projectId })
  }

  for (const { row, recordId } of collectActiveRows(normalized.vehicleIssueRecords, {
    source: 'vehicleIssueRecords', idFields: ['issueId'], anomalies,
  })) {
    const snapshot = supportedOwnDataSnapshot(row)
    if (snapshot === UNSUPPORTED_OUTPUT_DATA) {
      anomaly(anomalies, 'vehicleIssueRecords', recordId, 'unsupported_output_data', '记录包含不支持的输出数据。')
      continue
    }
    const fact = validateAmountAndMonth(snapshot, 'repairCost', 'issueDate', anomalies, 'vehicleIssueRecords', recordId)
    if (!fact) continue
    let allocatedProject = null
    if (safeOwnValue(snapshot, 'allocateToProject') === true) {
      allocatedProject = projectRelation(snapshot, activeProjects, anomalies, 'vehicleIssueRecords', recordId)
    } else if (safeOwnValue(snapshot, 'projectId')) {
      anomaly(anomalies, 'vehicleIssueRecords', recordId, 'ignored_project_fields', '未启用项目分摊，项目字段已忽略。')
    }
    if (monthSet.has(fact.month) && (
      normalized.projectId === 'all' || normalized.projectId === allocatedProject
    )) pending.vehicleRepairEstimates.push(snapshot)
  }

  let ledgerMonthlyTotal = null
  let ledgerLifetimeTotal = null
  if (ledgerReady) {
    const nextCompanyByMonth = new Map([...companyByMonth].map(([month, row]) => [
      month, { ...row },
    ]))
    const nextProjectByMonth = new Map([...projectByMonth].map(([month, rows]) => [
      month,
      new Map([...rows].map(([projectId, row]) => [projectId, { ...row }])),
    ]))
    const nextLifetime = new Map([...lifetime].map(([projectId, row]) => [
      projectId, { ...row },
    ]))
    const companyUnitsByMonth = new Map([...nextCompanyByMonth].map(([month, row]) => [
      month, ledgerUnitRow(row, ['purchase', 'vehicle', 'manual', 'operating']),
    ]))
    const projectUnitsByMonth = new Map([...nextProjectByMonth].map(([month, rows]) => [
      month,
      new Map([...rows].map(([projectId, row]) => [projectId, ledgerUnitRow(row)])),
    ]))
    const lifetimeUnits = new Map([...nextLifetime].map(([projectId, row]) => [
      projectId, ledgerUnitRow(row),
    ]))
    let aggregationComplete = [...companyUnitsByMonth.values()].every(Boolean) &&
      [...projectUnitsByMonth.values()].every((rows) => [...rows.values()].every(Boolean)) &&
      [...lifetimeUnits.values()].every(Boolean)
    if (!aggregationComplete) {
      anomaly(anomalies, 'aggregation', 'initial', 'amount_overflow', '成本基础值超出固定精度范围。')
    }
    let ledgerMonthlyUnits = 0n
    let ledgerLifetimeUnits = 0n
    const ledgerEntries = normalized.projectLedgerSummary.source === 'aggregate'
      ? normalized.projectLedgerSummary.data.projectMonthCategoryTotals.map((total) => ({
          projectId: total.projectId,
          category: total.category,
          month: total.month,
          effectiveAmount: total.amount,
          recordId: `${total.projectId}:${total.month}:${total.category}`,
        }))
      : normalized.projectLedgerSummary.data.rows.map((row) => ({
          projectId: row.projectId,
          category: row.category,
          month: monthOfDate(row.date),
          effectiveAmount: row.effectiveAmount,
          recordId: row.sourceKey,
        }))
    for (const row of ledgerEntries) {
      if (!aggregationComplete) break
      const category = LEDGER_CATEGORY_PART[row.category]
      const month = row.month
      const projectId = row.projectId
      const amountUnits = ledgerUnits(row.effectiveAmount)
      if (amountUnits === null) {
        anomaly(anomalies, 'projectLedgerSummary', row.recordId, 'amount_overflow', '项目成本账本金额超出固定精度范围。')
        aggregationComplete = false
        break
      }
      ledgerLifetimeUnits += amountUnits
      if (month === normalized.selectedMonth) {
        ledgerMonthlyUnits += amountUnits
      }
      if (monthSet.has(month)) {
        projectUnitsByMonth.get(month).get(projectId)[category] += amountUnits
      }
      lifetimeUnits.get(projectId)[category] += amountUnits
      if (monthSet.has(month) && category !== 'labor' &&
          companyUnitsByMonth.get(month)) {
        companyUnitsByMonth.get(month)[category] += amountUnits
      }
    }
    if (aggregationComplete) {
      ledgerMonthlyTotal = ledgerAmount(ledgerMonthlyUnits)
      ledgerLifetimeTotal = ledgerAmount(ledgerLifetimeUnits)
      if (ledgerMonthlyTotal === null || ledgerLifetimeTotal === null) {
        anomaly(anomalies, 'projectLedgerSummary', 'totals', 'amount_overflow', '项目成本账本汇总超出固定精度范围。')
        aggregationComplete = false
      }
    }
    if (aggregationComplete) {
      for (const [month, units] of companyUnitsByMonth) {
        const row = nextCompanyByMonth.get(month)
        for (const part of ['purchase', 'vehicle', 'manual', 'operating']) {
          const amount = ledgerAmount(units[part])
          if (amount === null) {
            anomaly(anomalies, 'aggregation', `${month}:${part}`, 'amount_overflow', '公司月度成本分类超出固定精度范围。')
            aggregationComplete = false
            break
          }
          row[part] = amount
        }
        if (!aggregationComplete) break
        if (row.salary !== null) {
          const salaryUnits = ledgerUnits(row.salary)
          if (salaryUnits === null || ledgerUnitTotal([
            salaryUnits, units.purchase, units.vehicle, units.manual, units.operating,
          ]) === null) {
            anomaly(anomalies, 'aggregation', month, 'amount_overflow', '公司月度成本合计超出固定精度范围。')
            aggregationComplete = false
            break
          }
        }
      }
    }
    if (aggregationComplete) {
      for (const [month, rows] of projectUnitsByMonth) {
        for (const [projectId, units] of rows) {
          const row = nextProjectByMonth.get(month).get(projectId)
          for (const part of LEDGER_COST_PARTS) {
            const amount = ledgerAmount(units[part])
            if (amount === null) {
              anomaly(anomalies, 'aggregation', `${projectId}:${month}:${part}`, 'amount_overflow', '项目月度成本分类超出固定精度范围。')
              aggregationComplete = false
              break
            }
            row[part] = amount
          }
          if (!aggregationComplete) break
          if (ledgerUnitTotal(LEDGER_COST_PARTS.map((part) => units[part])) === null) {
            anomaly(anomalies, 'aggregation', `${projectId}:${month}`, 'amount_overflow', '项目月度成本合计超出固定精度范围。')
            aggregationComplete = false
            break
          }
        }
        if (!aggregationComplete) break
      }
    }
    if (aggregationComplete) {
      for (const [projectId, units] of lifetimeUnits) {
        const row = nextLifetime.get(projectId)
        for (const part of LEDGER_COST_PARTS) {
          const amount = ledgerAmount(units[part])
          if (amount === null) {
            anomaly(anomalies, 'aggregation', `${projectId}:${part}`, 'amount_overflow', '项目累计成本分类超出固定精度范围。')
            aggregationComplete = false
            break
          }
          row[part] = amount
        }
        if (!aggregationComplete) break
        if (ledgerUnitTotal(LEDGER_COST_PARTS.map((part) => units[part])) === null) {
          anomaly(anomalies, 'aggregation', projectId, 'amount_overflow', '项目累计成本合计超出固定精度范围。')
          aggregationComplete = false
          break
        }
      }
    }
    if (aggregationComplete) {
      companyByMonth = nextCompanyByMonth
      projectByMonth = nextProjectByMonth
      lifetime = nextLifetime
    } else {
      ledgerStatus = 'incomplete'
      ledgerMonthlyTotal = null
      ledgerLifetimeTotal = null
    }
  }

  if (ledgerProvided && ledgerStatus !== 'ready') {
    for (const row of companyByMonth.values()) {
      row.purchase = null
      row.vehicle = null
      row.manual = null
      row.operating = null
      row.incomplete = true
    }
    for (const row of projectByMonth.values()) {
      for (const value of row.values()) {
        value.labor = null
        value.purchase = null
        value.vehicle = null
        value.manual = null
        value.operating = null
      }
    }
    for (const value of lifetime.values()) {
      value.labor = null
      value.purchase = null
      value.vehicle = null
      value.manual = null
      value.operating = null
    }
  }

  const monthlyByMonth = {}
  for (const month of normalized.months) {
    const row = companyByMonth.get(month)
    row.total = row.salary === null
      ? null
      : sumCostParts([row.salary, row.purchase, row.vehicle, row.manual, row.operating])
    if (row.salary !== null && row.total === null) {
      anomaly(anomalies, 'aggregation', month, 'total_overflow', '公司月度成本合计超出安全整数范围。')
    }
    monthlyByMonth[month] = row
  }

  const projectLifetimeById = {}
  for (const projectId of normalized.activeProjectIds) {
    const value = lifetime.get(projectId)
    const total = value.labor === null
      ? null
      : sumCostParts([value.labor, value.purchase, value.vehicle, value.manual, value.operating])
    if (value.labor !== null && total === null) {
      anomaly(anomalies, 'aggregation', projectId, 'total_overflow', '项目累计成本合计超出安全整数范围。')
    }
    projectLifetimeById[projectId] = { ...value, total }
  }

  const companyMonthlyTotal = supportedOwnDataSnapshot(
    monthlyByMonth[normalized.selectedMonth],
  )
  if (companyMonthlyTotal === UNSUPPORTED_OUTPUT_DATA) {
    throw new TypeError('company monthly total contains unsupported output data')
  }
  const selectedProjectMonth = normalized.projectId === 'all'
    ? null
    : projectByMonth.get(normalized.selectedMonth).get(normalized.projectId)
  const selectedParts = normalized.projectId === 'all'
    ? {
        labor: companyMonthlyTotal.salary,
        purchase: companyMonthlyTotal.purchase,
        vehicle: companyMonthlyTotal.vehicle,
        manual: companyMonthlyTotal.manual,
        operating: companyMonthlyTotal.operating,
      }
    : selectedProjectMonth
  const selectedTotal = selectedParts.labor === null
    ? null
    : sumCostParts([
        selectedParts.labor, selectedParts.purchase, selectedParts.vehicle,
        selectedParts.manual, selectedParts.operating,
      ])
  if (selectedParts.labor !== null && selectedTotal === null) {
    anomaly(anomalies, 'aggregation', normalized.projectId, 'total_overflow', '所选成本构成超出安全整数范围。')
  }
  const selectedComposition = {
    month: normalized.selectedMonth,
    scope: normalized.projectId,
    ...selectedParts,
    total: selectedTotal,
    incomplete: selectedTotal === null,
  }

  return {
    monthlyByMonth,
    projectLifetimeById,
    selectedComposition,
    companyMonthlyTotal,
    projectLedger: {
      status: ledgerStatus,
      monthlyTotal: ledgerMonthlyTotal,
      lifetimeTotal: ledgerLifetimeTotal,
    },
    pending,
    anomalies,
  }
}

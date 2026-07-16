import { monthOfDate, normalizeMonth } from '../executive-dashboard/dashboardTime.js'

const PENDING_MANUAL_TYPES = new Set(['人工费', '材料费', '工具费', '车辆费'])
const CONFIRMED_MANUAL_TYPES = new Set(['外包费', '运输费', '其他费用'])
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const POSIX_EDGE_SPACE = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/gu
const MAX_IDENTIFIER_LENGTH = 500
const MALFORMED_ROW = Symbol('malformed-row')

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
  const snapshot = exactSnapshot(input, INPUT_KEYS, 'cost accounting input must use exact own data fields')
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
  return {
    ...snapshot,
    months,
    activeProjectIds,
    laborWindow: {
      ...laborWindow,
      monthly: snapshotArray(laborWindow.monthly, 'laborWindow.monthly'),
      incompleteMonths: snapshotArray(laborWindow.incompleteMonths, 'laborWindow.incompleteMonths'),
      staleMonths: snapshotArray(laborWindow.staleMonths, 'laborWindow.staleMonths'),
    },
    purchaseRows: snapshotArray(snapshot.purchaseRows, 'purchaseRows'),
    fuelRecords: snapshotArray(snapshot.fuelRecords, 'fuelRecords'),
    vehicleExpenseRecords: snapshotArray(snapshot.vehicleExpenseRecords, 'vehicleExpenseRecords'),
    vehicleIssueRecords: snapshotArray(snapshot.vehicleIssueRecords, 'vehicleIssueRecords'),
    manualProjectCosts: snapshotArray(snapshot.manualProjectCosts, 'manualProjectCosts'),
    operatingExpenses: snapshotArray(snapshot.operatingExpenses, 'operatingExpenses'),
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
          !validIdentifier(key)) return null
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
    if (amount === null || amount > Number.MAX_SAFE_INTEGER - total) return null
    total += amount
  }
  return total
}

function tryAdd(target, category, amount) {
  if (target[category] > Number.MAX_SAFE_INTEGER - amount) {
    return false
  }
  target[category] += amount
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

function validateAmountAndMonth(row, amountField, dateField, anomalies, source, recordId) {
  const amount = safeYen(safeOwnValue(row, amountField))
  if (amount === null) {
    anomaly(anomalies, source, recordId, 'invalid_amount', '金额必须是有限、安全、非负整数日元。')
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
    const type = safeOwnValue(row, 'costType')
    if (CONFIRMED_MANUAL_TYPES.has(type)) result.confirmedRows.push(row)
    else if (PENDING_MANUAL_TYPES.has(type)) result[pendingKeyByType[type]].push(row)
  }
  return result
}

export function buildCostAccountingReadModel(input) {
  const normalized = normalizeInput(input)
  const anomalies = []
  const monthSet = new Set(normalized.months)
  const activeProjects = new Set(normalized.activeProjectIds)
  const companyByMonth = new Map(normalized.months.map((month) => [month, emptyCompanyMonth(month)]))
  const projectByMonth = new Map(normalized.months.map((month) => [
    month,
    new Map(normalized.activeProjectIds.map((projectId) => [projectId, emptyProjectCost(null)])),
  ]))
  const lifetime = new Map(normalized.activeProjectIds.map((projectId) => [projectId, emptyProjectCost(null)]))

  const laborRows = new Map()
  for (const row of normalized.laborWindow.monthly) {
    if (row === MALFORMED_ROW || !isSafeRow(row)) continue
    const month = safeOwnValue(row, 'month')
    if (normalizeMonth(month) === month && !laborRows.has(month)) laborRows.set(month, row)
  }
  for (const month of normalized.months) {
    const target = companyByMonth.get(month)
    const labor = laborRows.get(month)
    const salary = labor ? safeYen(safeOwnValue(labor, 'salaryTotal')) : null
    const projectLaborTotal = labor ? safeYen(safeOwnValue(labor, 'projectLaborTotal')) : null
    const projectMap = labor ? safeProjectMap(safeOwnValue(labor, 'projectLaborById')) : null
    if (safeOwnValue(labor, 'status') !== 'ready' || salary === null ||
        projectLaborTotal === null || !projectMap || projectMap.total !== projectLaborTotal) {
      anomaly(anomalies, 'laborWindow', month, 'incomplete_labor_month', '人工月份不完整，未以零值替代。')
      continue
    }
    target.salary = salary
    target.laborStatus = 'ready'
    target.laborStale = safeOwnValue(labor, 'stale') === true
    target.laborSource = safeOwnValue(labor, 'source') ?? null
    target.laborPendingCount = safeYen(safeOwnValue(labor, 'pendingCount'))
    target.incomplete = false
    for (const projectId of normalized.activeProjectIds) {
      projectByMonth.get(month).get(projectId).labor = projectMap.values.get(projectId) || 0
    }
  }

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

  const addFact = ({ source, recordId, month, amount, category, projectId = null }) => {
    const targets = []
    if (monthSet.has(month)) targets.push(companyByMonth.get(month))
    if (projectId !== null) {
      if (monthSet.has(month)) targets.push(projectByMonth.get(month).get(projectId))
      targets.push(lifetime.get(projectId))
    }
    let overflowed = false
    for (const target of targets) {
      if (!tryAdd(target, category, amount)) overflowed = true
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
    const fact = validateAmountAndMonth(row, 'amount', 'date', anomalies, 'manualProjectCosts', recordId)
    if (!fact) continue
    const projectId = projectRelation(row, activeProjects, anomalies, 'manualProjectCosts', recordId)
    if (!projectId) continue
    const type = safeOwnValue(row, 'costType')
    if (PENDING_MANUAL_TYPES.has(type)) {
      if (monthSet.has(fact.month) &&
          (normalized.projectId === 'all' || normalized.projectId === projectId)) {
        pending[pendingKeyByType[type]].push(row)
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
    const fact = validateAmountAndMonth(row, 'repairCost', 'issueDate', anomalies, 'vehicleIssueRecords', recordId)
    if (!fact) continue
    let allocatedProject = null
    if (safeOwnValue(row, 'allocateToProject') === true) {
      allocatedProject = projectRelation(row, activeProjects, anomalies, 'vehicleIssueRecords', recordId)
    } else if (safeOwnValue(row, 'projectId')) {
      anomaly(anomalies, 'vehicleIssueRecords', recordId, 'ignored_project_fields', '未启用项目分摊，项目字段已忽略。')
    }
    if (monthSet.has(fact.month) && (
      normalized.projectId === 'all' || normalized.projectId === allocatedProject
    )) pending.vehicleRepairEstimates.push(row)
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

  const companyMonthlyTotal = monthlyByMonth[normalized.selectedMonth]
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
    incomplete: selectedParts.labor === null,
  }

  return {
    monthlyByMonth,
    projectLifetimeById,
    selectedComposition,
    companyMonthlyTotal,
    pending,
    anomalies,
  }
}

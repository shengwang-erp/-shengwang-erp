import { buildCostAccountingReadModel } from '../cost-accounting/costAccountingDomain.js'
import { buildRecordedCashFlow } from '../cost-accounting/recordedCashFlowDomain.js'
import { buildPurchaseAccountingReadModel } from '../purchase-accounting/purchaseAccountingDomain.js'
import { PROJECT_STATUS_OPTIONS } from '../projects/projectDomain.js'
import { resolveRequiredSources } from '../../services/businessSourceState.js'
import { buildMonthWindow, monthOfDate, normalizeMonth } from './dashboardTime.js'

const INPUT_KEYS = Object.freeze(['asOfDate', 'selectedMonth', 'filters', 'access', 'sources'])
const FILTER_KEYS = Object.freeze([
  'projectId', 'projectStatus', 'rankingMetric', 'page', 'pageSize',
])
const SOURCE_NAMES = Object.freeze([
  'projects', 'contractRevenue', 'receipts', 'laborWindow', 'purchaseAccrual',
  'purchasePayments', 'projectCosts', 'operatingExpenses', 'vehicles',
  'vehicleUsage', 'fuel', 'vehicleExpenses', 'vehicleIssues', 'attendance',
  'inventoryItems', 'stockInRecords', 'stockOutRecords', 'stockReturnRecords',
  'toolRecords', 'toolBorrowRecords', 'toolReturnRecords',
  'lifelongToolAssignments', 'toolResponsibilityRecords',
])
const ACCESS_KEYS = Object.freeze([
  'page', 'projectSnapshot', 'contracts', 'profit', 'attendance', 'labor',
  'purchase', 'vehicle', 'inventory', 'tools', 'costCategories',
])
const SOURCE_STATE_KEYS = new Set([
  'status', 'data', 'code', 'message', 'stale', 'updatedAt', 'source', 'fatal',
])
const SOURCE_STATUSES = new Set(['ready', 'loading', 'error', 'forbidden'])
const RANKING_METRICS = new Set(['profit', 'margin', 'revenue', 'confirmedCost'])
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const PENDING_COST_TYPES = new Set(['人工费', '材料费', '工具费', '车辆费'])
const INACTIVE_VALUES = new Set([
  'void', 'deleted', 'inactive', '作废', '已删除', '取消',
])
const NORMAL_ATTENDANCE = new Set([
  '正常', '出勤', '已确认', 'confirmed', 'ready', 'approved',
])
const ATTENDANCE_STATUS_KEYS = new Set([
  ...NORMAL_ATTENDANCE, '异常', '迟到', '早退', '缺勤', '请假', '休假', '其他', '未设置',
])
const INVENTORY_STATUS_KEYS = new Set([
  '库存充足', '库存不足', '低库存', '缺货', '正常', '在库', '已出库', '已退回',
  '停用', '其他', '未设置',
])
const TOOL_STATUS_KEYS = new Set([
  '可用', '借出', '在库', '临时借出', '已归还', '已终身领用', '已丢失', '已损坏',
  '维修中', '已报废', '报废', '丢失', '停用', '其他', '未设置',
])
const COST_REQUIRED = Object.freeze([
  'laborWindow', 'purchaseAccrual', 'projectCosts', 'operatingExpenses',
  'fuel', 'vehicleExpenses', 'vehicleIssues',
])
const FINANCIAL_REQUIRED = Object.freeze([
  'projects', 'contractRevenue', 'laborWindow', 'purchaseAccrual',
  'projectCosts', 'operatingExpenses', 'fuel', 'vehicleExpenses', 'vehicleIssues',
])
const VEHICLE_REQUIRED = Object.freeze([
  'vehicles', 'vehicleUsage', 'fuel', 'vehicleExpenses', 'vehicleIssues',
])
const INVENTORY_REQUIRED = Object.freeze([
  'inventoryItems', 'stockInRecords', 'stockOutRecords', 'stockReturnRecords',
])
const TOOL_REQUIRED = Object.freeze([
  'toolRecords', 'toolBorrowRecords', 'toolReturnRecords',
  'lifelongToolAssignments', 'toolResponsibilityRecords',
])
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u
const MAX_IDENTIFIER_LENGTH = 500

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownDataRecord(value, expectedKeys, name) {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError()
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== expectedKeys.length) throw new TypeError()
    const expected = new Set(expectedKeys)
    const output = {}
    for (const key of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!expected.has(key) || descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      output[key] = descriptor.value
    }
    return output
  } catch (cause) {
    throw new TypeError(`${name} must use exact own data fields`, { cause })
  }
}

function cloneOwnData(value, ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new TypeError('number is unsafe')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('unsupported input data')

  let registered = false
  try {
    if (ancestors.has(value)) throw new TypeError('cyclic input data')
    const array = Array.isArray(value)
    const prototype = Object.getPrototypeOf(value)
    if (array ? prototype !== Array.prototype :
      (prototype !== Object.prototype && prototype !== null)) {
      throw new TypeError('input data must be plain')
    }
    if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError('symbol input')
    ancestors.add(value)
    registered = true

    if (array) {
      const names = Object.getOwnPropertyNames(value)
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value
      if (!Number.isSafeInteger(length) || length < 0 ||
          names.length !== length + 1 ||
          names.some((key) => {
            if (key === 'length') return false
            if (!/^(?:0|[1-9]\d*)$/u.test(key)) return true
            const index = Number(key)
            return !Number.isSafeInteger(index) || index < 0 || index >= length
          })) {
        throw new TypeError('expanded array input')
      }
      const output = new Array(length)
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('sparse or accessor array input')
        }
        output[index] = cloneOwnData(descriptor.value, ancestors)
      }
      return output
    }

    const output = Object.create(null)
    for (const key of Object.getOwnPropertyNames(value)) {
      if (POLLUTION_KEYS.has(key)) throw new TypeError('pollution key')
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError('accessor or hidden input')
      }
      output[key] = cloneOwnData(descriptor.value, ancestors)
    }
    return output
  } finally {
    if (registered) ancestors.delete(value)
  }
}

function invalidSourceData(updatedAt = null) {
  return {
    status: 'error', data: null, code: 'INVALID_SOURCE_DATA',
    message: '数据格式无效', stale: false, updatedAt,
  }
}

function recordArray(value) {
  return Array.isArray(value) && value.every((row) => isPlainRecord(row))
}

function sourceDataShapeIsValid(name, data) {
  if (name === 'laborWindow') {
    if (!isPlainRecord(data) || !recordArray(data.monthly) ||
        !Array.isArray(data.incompleteMonths) || !Array.isArray(data.staleMonths)) return false
    if (data.monthly.some((row) => !isPlainRecord(row.projectLaborById))) return false
    return isPlainRecord(data.projectLaborLifetimeById) ||
      (data.projectLaborLifetimeById === null && data.lifetimeStatus !== 'ready')
  }
  if (name === 'contractRevenue' && isPlainRecord(data)) {
    if (Object.hasOwn(data, 'snapshots')) return recordArray(data.snapshots)
    const map = Object.hasOwn(data, 'byProjectId') ? data.byProjectId : data
    return isPlainRecord(map) && Object.values(map).every((row) => isPlainRecord(row))
  }
  return recordArray(data)
}

function sourceState(value, name) {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError()
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const key of Object.keys(descriptors)) {
      if (!SOURCE_STATE_KEYS.has(key) || descriptors[key]?.enumerable !== true ||
          !Object.hasOwn(descriptors[key], 'value')) throw new TypeError()
    }
    if (!descriptors.status || !descriptors.data) throw new TypeError()
    const status = SOURCE_STATUSES.has(descriptors.status.value)
      ? descriptors.status.value
      : 'error'
    const updatedAt = typeof descriptors.updatedAt?.value === 'string'
      ? descriptors.updatedAt.value
      : null
    let data = null
    if (status === 'ready') {
      try {
        data = cloneOwnData(descriptors.data.value)
      } catch {
        return invalidSourceData(updatedAt)
      }
      if (!sourceDataShapeIsValid(name, data)) return invalidSourceData(updatedAt)
    }
    const stale = status === 'ready' && descriptors.stale?.value === true
    const callerCode = typeof descriptors.code?.value === 'string' ? descriptors.code.value : ''
    const code = status === 'forbidden'
      ? 'ACCESS_DENIED'
      : status === 'error'
        ? callerCode === 'INVALID_SOURCE_DATA' ? 'INVALID_SOURCE_DATA' : 'DATA_OPERATION_FAILED'
        : status === 'loading' ? 'SOURCE_LOADING' : ''
    const message = status === 'forbidden'
      ? '当前权限下无法查看该数据'
      : status === 'error'
        ? code === 'INVALID_SOURCE_DATA' ? '数据格式无效' : '数据暂不可用'
        : status === 'loading' ? '数据正在加载' : stale ? '数据可能已过期' : ''
    const state = {
      status, data, code, message, stale,
      updatedAt,
    }
    if (status !== 'ready' && descriptors.data.value !== null) state.data = null
    return state
  } catch (cause) {
    throw new TypeError(`${name} source state is invalid`, { cause })
  }
}

function normalizeSources(value) {
  const snapshot = ownDataRecord(value, SOURCE_NAMES, 'sources')
  const states = {}
  for (const name of SOURCE_NAMES) states[name] = sourceState(snapshot[name], name)
  for (const name of SOURCE_NAMES) {
    const state = states[name]
    if (state.status !== 'ready') continue
    const objectAllowed = name === 'laborWindow' || name === 'contractRevenue'
    if (objectAllowed ? !(Array.isArray(state.data) || isPlainRecord(state.data)) :
      !Array.isArray(state.data)) {
      states[name] = invalidSourceData(state.updatedAt)
    }
  }
  return states
}

function booleanRecord(value, keys, name) {
  const snapshot = ownDataRecord(value, keys, name)
  for (const key of keys) {
    if (typeof snapshot[key] !== 'boolean') throw new TypeError(`${name}.${key} is invalid`)
  }
  return snapshot
}

function normalizeAccess(value) {
  const snapshot = ownDataRecord(value, ACCESS_KEYS, 'access')
  if (typeof snapshot.page !== 'boolean' || typeof snapshot.projectSnapshot !== 'boolean') {
    throw new TypeError('access booleans are invalid')
  }
  return {
    page: snapshot.page,
    projectSnapshot: snapshot.projectSnapshot,
    contracts: booleanRecord(snapshot.contracts, ['view', 'amounts'], 'access.contracts'),
    profit: booleanRecord(
      snapshot.profit, ['view', 'completeCostRequired'], 'access.profit',
    ),
    attendance: booleanRecord(
      snapshot.attendance, ['view', 'identities'], 'access.attendance',
    ),
    labor: booleanRecord(snapshot.labor, ['view', 'amounts'], 'access.labor'),
    purchase: booleanRecord(
      snapshot.purchase, ['accrual', 'payments', 'payable', 'anomalies'], 'access.purchase',
    ),
    vehicle: booleanRecord(snapshot.vehicle, ['view', 'amounts'], 'access.vehicle'),
    inventory: booleanRecord(snapshot.inventory, ['view', 'amounts'], 'access.inventory'),
    tools: booleanRecord(snapshot.tools, ['view', 'amounts'], 'access.tools'),
    costCategories: booleanRecord(
      snapshot.costCategories,
      ['labor', 'purchase', 'vehicle', 'manualSupplement', 'operatingExpense'],
      'access.costCategories',
    ),
  }
}

function validDate(value) {
  return typeof value === 'string' && DATE_PATTERN.test(value) &&
    monthOfDate(value) === value.slice(0, 7)
}

function normalizeInput(input) {
  const snapshot = ownDataRecord(input, INPUT_KEYS, 'executive dashboard input')
  if (!validDate(snapshot.asOfDate)) throw new TypeError('asOfDate must be an ISO calendar date')
  const filterSnapshot = ownDataRecord(snapshot.filters, FILTER_KEYS, 'filters')
  const selectedMonth = normalizeMonth(snapshot.selectedMonth) || snapshot.asOfDate.slice(0, 7)
  const months = buildMonthWindow(selectedMonth, 12)
  if (months.length !== 12) throw new TypeError('selectedMonth is outside the supported range')
  return {
    asOfDate: snapshot.asOfDate,
    selectedMonth,
    months,
    rawFilters: cloneOwnData(filterSnapshot),
    access: normalizeAccess(snapshot.access),
    states: normalizeSources(snapshot.sources),
  }
}

function safeIdentifier(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH && value.trim() === value &&
    !POLLUTION_KEYS.has(value)
}

function normalizedStatusKey(value, allowed) {
  if (typeof value !== 'string' || value.length === 0) return '未设置'
  if (value.trim() !== value || POLLUTION_KEYS.has(value) || !allowed.has(value)) return '其他'
  return value
}

function safeYen(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= 0 && !Object.is(value, -0) ? value : null
}

function safeSignedYen(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && !Object.is(value, -0)
    ? value
    : null
}

function safeAdd(total, value) {
  return safeYen(total) !== null && safeYen(value) !== null &&
    value <= Number.MAX_SAFE_INTEGER - total ? total + value : null
}

function isInactive(row) {
  if (row?.deleted === true || row?.isDeleted === true) return true
  return ['status', 'statusCode', 'recordStatus', 'purchaseStatus', 'receiptStatus'].some((field) => {
    const value = row?.[field]
    return typeof value === 'string' && INACTIVE_VALUES.has(value.toLowerCase())
  })
}

function collectProjects(rows, issues) {
  const seen = new Set()
  const output = []
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    const projectId = row?.projectId
    if (!isPlainRecord(row) || !safeIdentifier(projectId) || seen.has(projectId) ||
        isInactive(row) || !PROJECT_STATUS_OPTIONS.includes(row.status)) {
      issues.push({ source: 'projects', code: 'invalid_or_duplicate_project', recordId: `row-${index + 1}` })
      continue
    }
    seen.add(projectId)
    output.push({
      ...row,
      projectId,
      projectName: typeof row.projectName === 'string' && row.projectName.trim()
        ? row.projectName.trim()
        : projectId,
      status: row.status,
    })
  }
  return output
}

function normalizedFilters(raw, projects) {
  const projectIds = new Set(projects.map((project) => project.projectId))
  const projectId = raw.projectId === 'all' || projectIds.has(raw.projectId)
    ? raw.projectId
    : 'all'
  return {
    projectId,
    projectStatus: raw.projectStatus === 'all' || PROJECT_STATUS_OPTIONS.includes(raw.projectStatus)
      ? raw.projectStatus
      : 'all',
    rankingMetric: RANKING_METRICS.has(raw.rankingMetric) ? raw.rankingMetric : 'profit',
    page: Number.isSafeInteger(raw.page) && raw.page > 0 ? raw.page : 1,
    pageSize: Number.isSafeInteger(raw.pageSize) && raw.pageSize > 0 && raw.pageSize <= 100
      ? raw.pageSize
      : 10,
  }
}

function makeBlock({ status, data, requiredSources, stale = false, code = '', message = '', updatedAt = null }) {
  return { status, stale, data, code, message, requiredSources: [...requiredSources], updatedAt }
}

function firstBlockingState(states, requiredSources, status) {
  return requiredSources.map((name) => states[name]).find((state) => state.status === status) || null
}

function blockResolution(states, requiredSources) {
  const resolved = resolveRequiredSources(states, requiredSources)
  if (resolved.status === 'ready') return null
  const state = firstBlockingState(states, requiredSources, resolved.status)
  return makeBlock({
    status: resolved.status,
    data: null,
    requiredSources,
    code: state?.code || (resolved.status === 'forbidden' ? 'ACCESS_DENIED' :
      resolved.status === 'error' ? 'DATA_OPERATION_FAILED' : ''),
    message: state?.message || (resolved.status === 'forbidden'
      ? '当前权限下无法查看该数据'
      : resolved.status === 'error' ? '数据暂不可用' : '数据正在加载'),
  })
}

function readyBlock(states, requiredSources, data, extraStale = false) {
  const timestamps = requiredSources
    .map((name) => states[name]?.updatedAt)
    .filter((value) => typeof value === 'string')
    .sort()
  return makeBlock({
    status: 'ready', data, requiredSources,
    stale: extraStale || requiredSources.some((name) => states[name]?.stale === true),
    updatedAt: timestamps[0] || null,
  })
}

function forbiddenBlock(requiredSources, message = '当前权限下无法查看该数据') {
  return makeBlock({
    status: 'forbidden', data: null, requiredSources,
    code: 'ACCESS_DENIED', message,
  })
}

function errorBlock(requiredSources, message, code = 'INVALID_AGGREGATE') {
  return makeBlock({ status: 'error', data: null, requiredSources, code, message })
}

function mini(status, data) {
  return { status, data: status === 'ready' ? data : null }
}

function stateMini(state, data) {
  return state.status === 'ready' ? mini('ready', data) : mini(state.status, null)
}

function rowsForScope(rows, scopeIds, projectId) {
  return rows.filter((row) => {
    const rowProjectId = row?.projectId
    if (projectId !== 'all') return scopeIds.has(projectId) && rowProjectId === projectId
    return !rowProjectId || scopeIds.has(rowProjectId)
  })
}

function recordMonth(row, fields) {
  for (const field of fields) {
    const value = row?.[field]
    if (value === undefined || value === null || value === '') continue
    return monthOfDate(value) || null
  }
  return null
}

function dateInMonth(row, fields, month) {
  return recordMonth(row, fields) === month
}

function recordId(row, fields) {
  for (const field of fields) if (safeIdentifier(row?.[field])) return row[field]
  return ''
}

function prepareRows(rows, { source, idFields, anomalyScope = null }) {
  const output = []
  const anomalies = []
  const seen = new Set()
  rows.forEach((row, index) => {
    if (isPlainRecord(row) && isInactive(row)) return
    const id = isPlainRecord(row) ? recordId(row, idFields) : ''
    if (!id || seen.has(id)) {
      const anomaly = {
        source,
        code: seen.has(id) ? 'duplicate_record' : 'invalid_record',
        recordId: id || `row-${index + 1}`,
        projectId: isPlainRecord(row) && safeIdentifier(row.projectId) ? row.projectId : '',
      }
      if (anomalyScope) anomaly.scopeProjectIds = anomalyScope(row, id)
      anomalies.push(anomaly)
      return
    }
    seen.add(id)
    output.push(row)
  })
  return { rows: output, anomalies }
}

function projectPurchaseHealthAnomaly(issue) {
  const code = safeIdentifier(issue?.code) ? issue.code : 'invalid_record'
  const paymentIssue = issue?.source === 'purchasePayments' ||
    safeIdentifier(issue?.paymentId) || code.includes('payment')
  const source = issue?.source === 'purchaseAccrual' || issue?.source === 'purchasePayments'
    ? issue.source
    : paymentIssue ? 'purchasePayments' : 'purchaseAccrual'
  const recordIdValue = safeIdentifier(issue?.recordId)
    ? issue.recordId
    : paymentIssue && safeIdentifier(issue?.paymentId)
      ? issue.paymentId
      : !paymentIssue && safeIdentifier(issue?.purchaseId)
        ? issue.purchaseId
        : ''
  return { source, code, recordId: recordIdValue }
}

function validateMoneyRows(rows, {
  source, amountField, allowMissingAmount = false, groupBy = () => 'all',
}) {
  const output = []
  const anomalies = []
  const aggregates = new Map()
  let blocking = false
  for (const row of rows) {
    const id = recordId(row, []) || ''
    const rawAmount = row[amountField]
    const amount = safeYen(rawAmount)
    const missingAllowed = allowMissingAmount &&
      (rawAmount === undefined || rawAmount === null || rawAmount === '')
    if (amount === null && !missingAllowed) {
      anomalies.push({ source, code: 'invalid_amount', recordId: id })
      blocking = true
      continue
    }
    if (amount !== null) {
      const group = groupBy(row)
      const aggregate = aggregates.get(group) || 0
      const next = safeAdd(aggregate, amount)
      if (next === null) {
        anomalies.push({ source, code: 'amount_overflow', recordId: id })
        blocking = true
        continue
      }
      aggregates.set(group, next)
    }
    output.push(row)
  }
  return { rows: output, anomalies, blocking }
}

function datedRows(rows, { source, dateFields, months = null }) {
  const output = []
  const anomalies = []
  let blocking = false
  for (const row of rows) {
    const month = recordMonth(row, dateFields)
    if (!month) {
      anomalies.push({ source, code: 'invalid_date', recordId: '' })
      blocking = true
      continue
    }
    if (months === null || months.has(month)) output.push(row)
  }
  return { rows: output, anomalies, blocking }
}

function validateDatedMoneyRows(prepared, {
  source, amountField, dateFields, months = null, allowMissingAmount = false,
}) {
  const dated = datedRows(prepared.rows, { source, dateFields, months })
  const money = validateMoneyRows(dated.rows, {
    source,
    amountField,
    allowMissingAmount,
    groupBy: months === null
      ? () => 'all'
      : (row) => recordMonth(row, dateFields) || '',
  })
  return {
    rows: money.rows,
    anomalies: [...prepared.anomalies, ...dated.anomalies, ...money.anomalies],
    blocking: dated.blocking || money.blocking,
  }
}

function validateCurrentMoneyRows(prepared, options) {
  const money = validateMoneyRows(prepared.rows, options)
  return {
    rows: money.rows,
    anomalies: [...prepared.anomalies, ...money.anomalies],
    blocking: money.blocking,
  }
}

function laborScopeProjectIds(projects, filters) {
  return filters.projectId === 'all' && filters.projectStatus === 'all'
    ? null
    : new Set(projects.map((project) => project.projectId))
}

function laborMonthlyMoneyIsBlocking(value, projects, filters, months) {
  const projectIds = laborScopeProjectIds(projects, filters)
  for (const row of value.monthly) {
    if (!months.has(row.month)) continue
    if (row.status !== 'ready') continue
    const pending = safeYen(row.pendingCount)
    if (pending === null) return true
    let mapTotal = 0
    const amounts = projectIds === null
      ? Object.values(row.projectLaborById)
      : [...projectIds].map((projectId) => row.projectLaborById[projectId] ?? 0)
    for (const rawAmount of amounts) {
      const amount = safeYen(rawAmount)
      if (amount === null) return true
      const next = safeAdd(mapTotal, amount)
      if (next === null) return true
      mapTotal = next
    }
    if (projectIds === null) {
      const salary = safeYen(row.salaryTotal)
      const projectTotal = safeYen(row.projectLaborTotal)
      if (salary === null || projectTotal === null || mapTotal !== projectTotal) return true
    }
  }
  return false
}

function laborLifetimeMoneyIsBlocking(value, projects, filters) {
  if (value.lifetimeStatus === 'ready') {
    const projectIds = laborScopeProjectIds(projects, filters)
    const amounts = projectIds === null
      ? Object.values(value.projectLaborLifetimeById)
      : [...projectIds].map((projectId) => value.projectLaborLifetimeById[projectId] ?? 0)
    let lifetimeTotal = 0
    for (const rawAmount of amounts) {
      const amount = safeYen(rawAmount)
      if (amount === null) return true
      const next = safeAdd(lifetimeTotal, amount)
      if (next === null) return true
      lifetimeTotal = next
    }
  }
  return false
}

function contractRows(data) {
  if (Array.isArray(data)) return data
  if (!isPlainRecord(data)) return []
  if (Array.isArray(data.snapshots)) return data.snapshots
  const map = isPlainRecord(data.byProjectId) ? data.byProjectId : data
  return Object.keys(map).flatMap((key) => {
    const value = map[key]
    return isPlainRecord(value) ? [{ projectId: value.projectId || key, ...value }] : []
  })
}

function buildContractMap(data, projects, anomalies) {
  const map = new Map()
  for (const row of contractRows(data)) {
    const projectId = row?.projectId
    if (!safeIdentifier(projectId) || map.has(projectId)) {
      anomalies.push({ source: 'contractRevenue', code: 'invalid_or_duplicate_snapshot', recordId: projectId || '' })
      continue
    }
    map.set(projectId, row)
  }
  for (const project of projects) {
    if (!map.has(project.projectId) && safeYen(project.adjustedTaxInclusiveAmount) !== null) {
      map.set(project.projectId, project)
    }
  }
  return map
}

function revenueFacts(projects, contractMap) {
  const issues = []
  const facts = []
  for (const project of projects) {
    const snapshot = contractMap.get(project.projectId)
    const contract = safeYen(snapshot?.adjustedTaxInclusiveAmount ?? snapshot?.contractAmount)
    const received = safeYen(
      snapshot?.totalReceivedTaxInclusiveAmount ?? snapshot?.paidAmount,
    )
    if (!snapshot || contract === null || received === null) {
      return { error: '合同收入快照不完整，无法发布部分合计。', facts: [], issues }
    }
    const outstanding = Math.max(contract - received, 0)
    const excess = Math.max(received - contract, 0)
    if (excess > 0) {
      issues.push({
        code: 'over_receipt', projectId: project.projectId,
        excessTaxInclusiveAmount: excess,
      })
    }
    facts.push({ project, snapshot, contract, received, outstanding, excess })
  }
  return { error: '', facts, issues }
}

function sumFacts(facts, field) {
  let total = 0
  for (const fact of facts) {
    total = safeAdd(total, fact[field])
    if (total === null) return null
  }
  return total
}

function comparison(current, prior) {
  if (safeSignedYen(current) === null || safeSignedYen(prior) === null) return null
  const change = current - prior
  if (!Number.isSafeInteger(change)) return null
  return {
    current,
    prior,
    change,
    percentChange: prior === 0 ? null : Math.round((change / Math.abs(prior)) * 1000) / 10,
  }
}

function sumField(rows, field, anomalies, source) {
  let total = 0
  for (const row of rows) {
    const amount = safeYen(row?.[field])
    const next = amount === null ? null : safeAdd(total, amount)
    if (next === null) {
      anomalies.push({ source, code: 'invalid_or_overflow_amount', recordId: '' })
      return null
    }
    total = next
  }
  return total
}

function pendingCostByProject(projectCosts, vehicleIssues) {
  const totals = new Map()
  let blocking = false
  const add = (projectId, amount) => {
    if (!safeIdentifier(projectId)) return
    if (safeYen(amount) === null) {
      blocking = true
      return
    }
    const current = totals.get(projectId) || 0
    const next = safeAdd(current, amount)
    if (next === null) blocking = true
    else totals.set(projectId, next)
  }
  const seenCosts = new Set()
  for (const row of projectCosts) {
    const id = recordId(row, ['costRecordId'])
    if (!id || seenCosts.has(id) || isInactive(row)) continue
    seenCosts.add(id)
    if (PENDING_COST_TYPES.has(row.costType)) add(row.projectId, row.amount)
  }
  const seenIssues = new Set()
  for (const row of vehicleIssues) {
    const id = recordId(row, ['issueId'])
    if (!id || seenIssues.has(id) || isInactive(row)) continue
    seenIssues.add(id)
    if (row.allocateToProject === true) add(row.projectId, row.repairCost)
  }
  return { totals, blocking }
}

function buildFinancialRows(projects, contractMap, costModel, pendingMap) {
  return projects.map((project) => {
    const snapshot = contractMap.get(project.projectId)
    const contract = safeYen(snapshot?.adjustedTaxInclusiveAmount ?? snapshot?.contractAmount)
    const received = safeYen(
      snapshot?.totalReceivedTaxInclusiveAmount ?? snapshot?.paidAmount,
    )
    const anchor = safeYen(snapshot?.profitAnchorTaxExclusiveAmount)
    const validAnchor = anchor !== null && anchor > 0
    const legacy = validAnchor && (
      snapshot?.allocationStatus === 'legacy_compatibility' ||
      snapshot?.allocationReason === 'contract_revenue_schema_not_migrated'
    )
    const confirmedCost = safeYen(costModel.projectLifetimeById?.[project.projectId]?.total)
    const profit = validAnchor && confirmedCost !== null
      ? safeSignedYen(anchor - confirmedCost)
      : null
    const margin = profit !== null
      ? Math.round((profit / anchor) * 1000) / 10
      : null
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      projectStatus: project.status,
      contractTaxInclusiveAmount: contract,
      receivedTaxInclusiveAmount: received,
      outstandingTaxInclusiveAmount: contract !== null && received !== null
        ? Math.max(contract - received, 0)
        : null,
      profitAnchorTaxExclusiveAmount: validAnchor ? anchor : null,
      confirmedCost,
      pendingManualCost: pendingMap.get(project.projectId) || 0,
      estimatedProfit: profit,
      margin,
      profitStatus: !validAnchor ? 'missing_anchor' : legacy
        ? 'legacy_compatibility'
        : 'ready',
      profitStatusLabel: !validAnchor ? '待完成合同收入确认' : legacy
        ? '历史税额未拆分'
        : '',
    }
  })
}

function rankRows(rows, metric) {
  const field = {
    profit: 'estimatedProfit', margin: 'margin', revenue: 'contractTaxInclusiveAmount',
    confirmedCost: 'confirmedCost',
  }[metric]
  return rows
    .filter((row) => typeof row[field] === 'number' &&
      (!(metric === 'profit' || metric === 'margin') || row.profitStatus !== 'missing_anchor'))
    .map((row) => ({
      projectId: row.projectId,
      projectName: row.projectName,
      projectStatus: row.projectStatus,
      metric,
      value: row[field],
      profit: row.estimatedProfit,
      margin: row.margin,
      revenue: row.contractTaxInclusiveAmount,
      confirmedCost: row.confirmedCost,
    }))
    .sort((left, right) => right.value - left.value ||
      left.projectName.localeCompare(right.projectName, 'zh-CN') ||
      left.projectId.localeCompare(right.projectId))
}

function internalEmptyLaborWindow() {
  return {
    monthly: [], projectLaborLifetimeById: {}, lifetimeStatus: 'ready',
    lifetimeStale: false, incompleteMonths: [], staleMonths: [],
  }
}

function scopedLaborWindow(value, projects, filters) {
  if (filters.projectId === 'all' && filters.projectStatus === 'all') return value
  const ids = new Set(projects.map((project) => project.projectId))
  const monthly = value.monthly.map((row) => {
    const projectLaborById = {}
    let projectLaborTotal = 0
    let invalidAmount = false
    for (const projectId of ids) {
      const rawAmount = row?.projectLaborById?.[projectId]
      const amount = rawAmount === undefined ? 0 : safeYen(rawAmount)
      if (amount === null) {
        projectLaborById[projectId] = rawAmount
        invalidAmount = true
        continue
      }
      const next = safeAdd(projectLaborTotal, amount)
      if (next === null) {
        invalidAmount = true
        continue
      }
      projectLaborTotal = next
      projectLaborById[projectId] = amount
    }
    return {
      ...row,
      salaryTotal: invalidAmount ? null : projectLaborTotal,
      projectLaborTotal: invalidAmount ? null : projectLaborTotal,
      projectLaborById,
    }
  })
  const projectLaborLifetimeById = {}
  for (const projectId of ids) {
    const rawAmount = value.projectLaborLifetimeById?.[projectId]
    const amount = rawAmount === undefined ? 0 : safeYen(rawAmount)
    projectLaborLifetimeById[projectId] = amount === null ? rawAmount : amount
  }
  return {
    monthly,
    projectLaborLifetimeById,
    lifetimeStatus: value.lifetimeStatus,
    lifetimeStale: value.lifetimeStale,
    incompleteMonths: [...value.incompleteMonths],
    staleMonths: [...value.staleMonths],
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

export function buildExecutiveDashboardReadModel(input) {
  const normalized = normalizeInput(input)
  const { access, states, selectedMonth, months, asOfDate } = normalized
  const sourceAnomalies = []
  const projectRowsSource = states.projects.status === 'ready' ? states.projects.data : []
  const allProjects = collectProjects(projectRowsSource, sourceAnomalies)
  const projectOptions = allProjects
    .map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
    }))
    .sort((left, right) => left.projectId.localeCompare(right.projectId))
  const filters = normalizedFilters(normalized.rawFilters, allProjects)
  const filteredProjects = allProjects.filter((project) =>
    (filters.projectId === 'all' || project.projectId === filters.projectId) &&
    (filters.projectStatus === 'all' || project.status === filters.projectStatus),
  )
  const scopeIds = new Set(filteredProjects.map((project) => project.projectId))
  const projectScopeLabel = filters.projectId === 'all'
    ? '全部项目'
    : allProjects.find((project) => project.projectId === filters.projectId)?.projectName || '全部项目'
  const meta = {
    asOfDate,
    selectedMonth,
    windowStartMonth: months[0],
    windowEndMonth: months.at(-1),
    projectScopeLabel,
    monthScopeLabel: selectedMonth,
  }

  if (!access.page) {
    const denied = (requiredSources = []) => forbiddenBlock(requiredSources, '当前权限下无法查看老板驾驶舱')
    return deepFreeze({
      meta,
      kpis: denied(['projects']),
      revenue: denied(['projects', 'contractRevenue']),
      projectStatus: denied(['projects']),
      cashFlow: denied([]),
      costs: denied(COST_REQUIRED),
      alerts: denied([]),
      purchaseOperations: denied(['purchaseAccrual']),
      laborOperations: denied(['attendance', 'laborWindow']),
      vehicleOperations: denied(VEHICLE_REQUIRED),
      inventoryOperations: denied(INVENTORY_REQUIRED),
      toolOperations: denied(TOOL_REQUIRED),
      projectRanking: denied(FINANCIAL_REQUIRED),
      projectRows: denied(FINANCIAL_REQUIRED),
      sourceIssues: denied([]),
    })
  }

  const contractAnomalies = []
  const contractMap = states.contractRevenue.status === 'ready'
    ? buildContractMap(states.contractRevenue.data, allProjects, contractAnomalies)
    : new Map()

  const emptyPrepared = { rows: [], anomalies: [] }
  const emptyValidated = { rows: [], anomalies: [], blocking: false }
  const purchasePrepared = states.purchaseAccrual.status === 'ready'
    ? prepareRows(states.purchaseAccrual.data, {
        source: 'purchaseAccrual', idFields: ['purchaseId'],
      })
    : emptyPrepared
  const knownProjectIds = new Set(allProjects.map((project) => project.projectId))
  const activePurchaseIds = new Set(purchasePrepared.rows
    .map((row) => row.purchaseId)
    .filter(safeIdentifier))
  const duplicateActivePurchaseIds = new Set(purchasePrepared.anomalies
    .filter((issue) => issue.code === 'duplicate_record')
    .map((issue) => issue.recordId)
    .filter(safeIdentifier))
  const purchaseProjectById = new Map(purchasePrepared.rows.flatMap((row) =>
    safeIdentifier(row.purchaseId) && safeIdentifier(row.projectId) &&
      knownProjectIds.has(row.projectId) && !duplicateActivePurchaseIds.has(row.purchaseId)
      ? [[row.purchaseId, row.projectId]]
      : []))
  const inactiveOnlyPurchaseIds = new Set((states.purchaseAccrual.status === 'ready'
    ? states.purchaseAccrual.data
        .filter((row) => isInactive(row))
        .map((row) => row.purchaseId)
        .filter(safeIdentifier)
    : []).filter((purchaseId) => !activePurchaseIds.has(purchaseId)))
  const paymentInputRows = states.purchasePayments.status === 'ready'
    ? states.purchasePayments.data.filter((row) =>
        !isInactive(row) && !inactiveOnlyPurchaseIds.has(row.purchaseId))
    : []
  const paymentHealthProjects = (row) => {
    const purchaseId = safeIdentifier(row?.purchaseId) ? row.purchaseId : ''
    if (activePurchaseIds.has(purchaseId)) {
      const linkedProjectId = purchaseProjectById.get(purchaseId)
      return linkedProjectId ? [linkedProjectId] : []
    }
    return safeIdentifier(row?.projectId) && knownProjectIds.has(row.projectId)
      ? [row.projectId]
      : []
  }
  const paymentProjectsById = new Map()
  for (const row of paymentInputRows) {
    const paymentId = recordId(row, ['paymentId'])
    if (!paymentId) continue
    const projectsForId = paymentProjectsById.get(paymentId) || new Set()
    for (const projectId of paymentHealthProjects(row)) projectsForId.add(projectId)
    paymentProjectsById.set(paymentId, projectsForId)
  }
  const paymentPrepared = states.purchasePayments.status === 'ready'
    ? prepareRows(paymentInputRows, {
        source: 'purchasePayments', idFields: ['paymentId'],
        anomalyScope: (row, paymentId) => paymentId
          ? [...(paymentProjectsById.get(paymentId) || [])]
          : paymentHealthProjects(row),
      })
    : emptyPrepared
  const receiptPrepared = states.receipts.status === 'ready'
    ? prepareRows(states.receipts.data, {
        source: 'receipts', idFields: ['receiptId'],
      })
    : emptyPrepared
  const projectCostPrepared = states.projectCosts.status === 'ready'
    ? prepareRows(states.projectCosts.data, {
        source: 'projectCosts', idFields: ['costRecordId'],
      })
    : emptyPrepared
  const operatingPrepared = states.operatingExpenses.status === 'ready'
    ? prepareRows(states.operatingExpenses.data, {
        source: 'operatingExpenses',
        idFields: ['operatingExpenseId', 'expenseRecordId'],
      })
    : emptyPrepared
  const fuelPrepared = states.fuel.status === 'ready'
    ? prepareRows(states.fuel.data, {
        source: 'fuel', idFields: ['fuelRecordId'],
      })
    : emptyPrepared
  const vehicleExpensePrepared = states.vehicleExpenses.status === 'ready'
    ? prepareRows(states.vehicleExpenses.data, {
        source: 'vehicleExpenses', idFields: ['vehicleExpenseId'],
      })
    : emptyPrepared
  const vehicleIssuePrepared = states.vehicleIssues.status === 'ready'
    ? prepareRows(states.vehicleIssues.data, {
        source: 'vehicleIssues', idFields: ['issueId'],
      })
    : emptyPrepared
  const vehicleUsagePrepared = states.vehicleUsage.status === 'ready'
    ? prepareRows(states.vehicleUsage.data, {
        source: 'vehicleUsage', idFields: ['usageId'],
      })
    : emptyPrepared
  const inventoryPrepared = states.inventoryItems.status === 'ready'
    ? prepareRows(states.inventoryItems.data, {
        source: 'inventoryItems', idFields: ['inventoryId', 'itemId'],
      })
    : emptyPrepared
  const responsibilityPrepared = states.toolResponsibilityRecords.status === 'ready'
    ? prepareRows(states.toolResponsibilityRecords.data.filter((row) =>
        row.compensationStatus === '未赔偿'), {
        source: 'toolResponsibilityRecords',
        idFields: ['responsibilityId', 'responsibilityRecordId'],
      })
    : emptyPrepared

  const scopePrepared = (prepared) => ({
    rows: rowsForScope(prepared.rows, scopeIds, filters.projectId),
    anomalies: prepared.anomalies.filter((issue) => {
      if (!issue.projectId) return true
      if (filters.projectId !== 'all') return issue.projectId === filters.projectId
      return scopeIds.has(issue.projectId)
    }),
  })
  const scopedPurchasePrepared = scopePrepared(purchasePrepared)
  const companyWideScope = filters.projectId === 'all' && filters.projectStatus === 'all'
  const paymentProjectsIntersectScope = (projectIds) =>
    Array.isArray(projectIds) && projectIds.some((projectId) => scopeIds.has(projectId))
  const scopedPaymentPrepared = {
    rows: paymentPrepared.rows.filter((row) => {
      if (!activePurchaseIds.has(row.purchaseId)) return false
      if (companyWideScope) return true
      const linkedProjectId = purchaseProjectById.get(row.purchaseId)
      return Boolean(linkedProjectId && scopeIds.has(linkedProjectId))
    }),
    anomalies: paymentPrepared.anomalies
      .filter((issue) => companyWideScope ||
        paymentProjectsIntersectScope(issue.scopeProjectIds))
      .map(projectPurchaseHealthAnomaly),
  }
  const scopedOrphanPaymentAnomalies = paymentPrepared.rows
    .filter((row) => !activePurchaseIds.has(row.purchaseId))
    .filter((row) => companyWideScope || paymentProjectsIntersectScope(
      paymentHealthProjects(row),
    ))
    .map((row) => ({
      source: 'purchasePayments', code: 'orphan_payment', recordId: row.paymentId,
    }))
  const scopedReceiptPrepared = scopePrepared(receiptPrepared)
  const scopedProjectCostPrepared = scopePrepared(projectCostPrepared)
  const scopedOperatingPrepared = scopePrepared(operatingPrepared)
  const scopedFuelPrepared = scopePrepared(fuelPrepared)
  const scopedVehicleExpensePrepared = scopePrepared(vehicleExpensePrepared)
  const scopedVehicleIssuePrepared = scopePrepared(vehicleIssuePrepared)
  const scopedVehicleUsagePrepared = scopePrepared(vehicleUsagePrepared)
  const scopedInventoryPrepared = scopePrepared(inventoryPrepared)
  const scopedResponsibilityPrepared = scopePrepared(responsibilityPrepared)
  const windowMonths = new Set(months)
  const selectedMonths = new Set([selectedMonth])
  const priorMonth = months.at(-2)
  const priorMonths = new Set([priorMonth])

  const purchaseSanitized = states.purchaseAccrual.status === 'ready'
    ? validateDatedMoneyRows(scopedPurchasePrepared, {
        source: 'purchaseAccrual', amountField: 'totalCost', dateFields: ['purchaseDate'],
      })
    : emptyValidated
  const purchaseWindow = states.purchaseAccrual.status === 'ready'
    ? validateDatedMoneyRows(scopedPurchasePrepared, {
        source: 'purchaseAccrual', amountField: 'totalCost', dateFields: ['purchaseDate'],
        months: windowMonths,
      })
    : emptyValidated
  const purchaseMonth = states.purchaseAccrual.status === 'ready'
    ? validateDatedMoneyRows(scopedPurchasePrepared, {
        source: 'purchaseAccrual', amountField: 'totalCost', dateFields: ['purchaseDate'],
        months: selectedMonths,
      })
    : emptyValidated
  const purchasePriorMonth = states.purchaseAccrual.status === 'ready'
    ? validateDatedMoneyRows(scopedPurchasePrepared, {
        source: 'purchaseAccrual', amountField: 'totalCost', dateFields: ['purchaseDate'],
        months: priorMonths,
      })
    : emptyValidated
  const paymentSanitized = states.purchasePayments.status === 'ready'
    ? validateDatedMoneyRows(scopedPaymentPrepared, {
        source: 'purchasePayments', amountField: 'jpyAmount', dateFields: ['paymentDate'],
      })
    : emptyValidated
  const paymentWindow = states.purchasePayments.status === 'ready'
    ? validateDatedMoneyRows(scopedPaymentPrepared, {
        source: 'purchasePayments', amountField: 'jpyAmount', dateFields: ['paymentDate'],
        months: windowMonths,
      })
    : emptyValidated
  const paymentMonth = states.purchasePayments.status === 'ready'
    ? validateDatedMoneyRows(scopedPaymentPrepared, {
        source: 'purchasePayments', amountField: 'jpyAmount', dateFields: ['paymentDate'],
        months: selectedMonths,
      })
    : emptyValidated
  const receiptSanitized = states.receipts.status === 'ready'
    ? validateDatedMoneyRows(scopedReceiptPrepared, {
        source: 'receipts', amountField: 'taxInclusiveAmount', dateFields: ['receivedDate'],
        months: windowMonths,
      })
    : emptyValidated
  const projectCostSanitized = states.projectCosts.status === 'ready'
    ? validateDatedMoneyRows(scopedProjectCostPrepared, {
        source: 'projectCosts', amountField: 'amount', dateFields: ['date'],
      })
    : emptyValidated
  const projectCostWindow = states.projectCosts.status === 'ready'
    ? validateDatedMoneyRows(scopedProjectCostPrepared, {
        source: 'projectCosts', amountField: 'amount', dateFields: ['date'],
        months: windowMonths,
      })
    : emptyValidated
  const operatingSanitized = states.operatingExpenses.status === 'ready'
    ? validateDatedMoneyRows(scopedOperatingPrepared, {
        source: 'operatingExpenses', amountField: 'amount', dateFields: ['date'],
      })
    : emptyValidated
  const operatingWindow = states.operatingExpenses.status === 'ready'
    ? validateDatedMoneyRows(scopedOperatingPrepared, {
        source: 'operatingExpenses', amountField: 'amount', dateFields: ['date'],
        months: windowMonths,
      })
    : emptyValidated
  const fuelSanitized = states.fuel.status === 'ready'
    ? validateDatedMoneyRows(scopedFuelPrepared, {
        source: 'fuel', amountField: 'fuelAmount', dateFields: ['fuelDate'],
      })
    : emptyValidated
  const fuelWindow = states.fuel.status === 'ready'
    ? validateDatedMoneyRows(scopedFuelPrepared, {
        source: 'fuel', amountField: 'fuelAmount', dateFields: ['fuelDate'],
        months: windowMonths,
      })
    : emptyValidated
  const fuelMonth = states.fuel.status === 'ready'
    ? validateDatedMoneyRows(scopedFuelPrepared, {
        source: 'fuel', amountField: 'fuelAmount', dateFields: ['fuelDate'],
        months: selectedMonths,
      })
    : emptyValidated
  const vehicleExpenseSanitized = states.vehicleExpenses.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleExpensePrepared, {
        source: 'vehicleExpenses', amountField: 'amount', dateFields: ['expenseDate'],
      })
    : emptyValidated
  const vehicleExpenseWindow = states.vehicleExpenses.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleExpensePrepared, {
        source: 'vehicleExpenses', amountField: 'amount', dateFields: ['expenseDate'],
        months: windowMonths,
      })
    : emptyValidated
  const vehicleExpenseMonth = states.vehicleExpenses.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleExpensePrepared, {
        source: 'vehicleExpenses', amountField: 'amount', dateFields: ['expenseDate'],
        months: selectedMonths,
      })
    : emptyValidated
  const vehicleIssueSanitized = states.vehicleIssues.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleIssuePrepared, {
        source: 'vehicleIssues', amountField: 'repairCost', dateFields: ['issueDate'],
      })
    : emptyValidated
  const vehicleIssueWindow = states.vehicleIssues.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleIssuePrepared, {
        source: 'vehicleIssues', amountField: 'repairCost', dateFields: ['issueDate'],
        months: windowMonths,
      })
    : emptyValidated
  const vehicleIssueMonth = states.vehicleIssues.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleIssuePrepared, {
        source: 'vehicleIssues', amountField: 'repairCost', dateFields: ['issueDate'],
        months: selectedMonths,
      })
    : emptyValidated
  const vehicleUsageSanitized = states.vehicleUsage.status === 'ready'
    ? validateDatedMoneyRows(scopedVehicleUsagePrepared, {
        source: 'vehicleUsage', amountField: 'dailyMileage', dateFields: ['usageDate', 'date'],
        months: selectedMonths,
      })
    : emptyValidated
  const inventorySanitized = states.inventoryItems.status === 'ready'
    ? validateCurrentMoneyRows(scopedInventoryPrepared, {
        source: 'inventoryItems', amountField: 'totalCost',
      })
    : emptyValidated
  const responsibilitySanitized = states.toolResponsibilityRecords.status === 'ready'
    ? validateCurrentMoneyRows(scopedResponsibilityPrepared, {
        source: 'toolResponsibilityRecords', amountField: 'compensationAmount',
      })
    : emptyValidated

  const laborWindowBlocking = states.laborWindow.status === 'ready' &&
    laborMonthlyMoneyIsBlocking(
      states.laborWindow.data, filteredProjects, filters, windowMonths,
    )
  const laborCurrentBlocking = states.laborWindow.status === 'ready' &&
    laborMonthlyMoneyIsBlocking(
      states.laborWindow.data, filteredProjects, filters, selectedMonths,
    )
  const laborLifetimeBlocking = states.laborWindow.status === 'ready' &&
    laborLifetimeMoneyIsBlocking(states.laborWindow.data, filteredProjects, filters)
  const scopedPurchases = purchaseSanitized.rows
  const scopedProjectCosts = projectCostSanitized.rows
  const scopedOperating = operatingSanitized.rows
  const scopedFuel = fuelSanitized.rows
  const scopedVehicleExpenses = vehicleExpenseSanitized.rows
  const scopedVehicleIssues = vehicleIssueSanitized.rows

  const contractAmountAccess = access.contracts.view && access.contracts.amounts
  const completeCostAccess = Object.values(access.costCategories).every(Boolean) &&
    access.profit.completeCostRequired &&
    access.labor.view && access.labor.amounts &&
    access.purchase.accrual &&
    access.vehicle.view && access.vehicle.amounts
  const dashboardCostAccess = completeCostAccess && access.profit.view
  const dashboardProfitAccess = dashboardCostAccess && contractAmountAccess
  const costSourceBlock = blockResolution(states, COST_REQUIRED)
  const costWindowBlocking = laborWindowBlocking || purchaseWindow.blocking ||
    projectCostWindow.blocking || operatingWindow.blocking || fuelWindow.blocking ||
    vehicleExpenseWindow.blocking || vehicleIssueWindow.blocking
  const financialCostBlocking = laborLifetimeBlocking || purchaseSanitized.blocking ||
    projectCostSanitized.blocking || operatingSanitized.blocking || fuelSanitized.blocking ||
    vehicleExpenseSanitized.blocking || vehicleIssueSanitized.blocking
  let costModel = null
  let costModelError = ''
  let financialCostModelError = ''
  if (dashboardCostAccess && !costSourceBlock) {
    try {
      const laborForScope = scopedLaborWindow(states.laborWindow.data, filteredProjects, filters)
      const domainProjectId = filters.projectId !== 'all' && scopeIds.has(filters.projectId)
        ? filters.projectId
        : 'all'
      costModel = buildCostAccountingReadModel({
        months,
        selectedMonth,
        projectId: domainProjectId,
        activeProjectIds: filteredProjects.map((project) => project.projectId),
        laborWindow: laborForScope,
        purchaseRows: scopedPurchases,
        fuelRecords: scopedFuel,
        vehicleExpenseRecords: scopedVehicleExpenses,
        vehicleIssueRecords: scopedVehicleIssues,
        manualProjectCosts: scopedProjectCosts,
        operatingExpenses: scopedOperating,
      })
      const hasUnsafeWindowAggregate = costModel.selectedComposition.total === null
      const hasUnsafeLifetimeAggregate =
        costModel.anomalies.some((issue) =>
          typeof issue.code === 'string' && issue.code.includes('overflow'))
      if (costWindowBlocking || hasUnsafeWindowAggregate) {
        costModelError = '成本金额不完整或超出安全范围，未发布部分合计。'
      }
      if (financialCostBlocking || hasUnsafeLifetimeAggregate) {
        financialCostModelError = '成本金额不完整或超出安全范围，未发布部分合计。'
      }
    } catch {
      costModelError = '成本来源格式无效，未发布部分成本。'
      financialCostModelError = costModelError
    }
  }

  const revenueRequired = ['projects', 'contractRevenue']
  let revenue
  let revenueResult = { error: '', facts: [], issues: [] }
  if (!access.contracts.view || !access.contracts.amounts) {
    revenue = forbiddenBlock(revenueRequired)
  } else {
    const blocked = blockResolution(states, revenueRequired)
    if (blocked) revenue = blocked
    else {
      revenueResult = revenueFacts(filteredProjects, contractMap)
      const contract = sumFacts(revenueResult.facts, 'contract')
      const received = sumFacts(revenueResult.facts, 'received')
      const outstanding = sumFacts(revenueResult.facts, 'outstanding')
      if (revenueResult.error || contract === null || received === null || outstanding === null) {
        revenue = errorBlock(revenueRequired, revenueResult.error || '合同金额累计超出安全范围。')
      } else {
        revenue = readyBlock(states, revenueRequired, {
          contractTaxInclusiveAmount: contract,
          receivedTaxInclusiveAmount: received,
          outstandingTaxInclusiveAmount: outstanding,
          collectionRate: contract === 0 ? null : Math.round((received / contract) * 1000) / 10,
          comparison: null,
          issues: revenueResult.issues,
        })
      }
    }
  }

  let projectStatus
  const projectRequired = ['projects']
  if (!access.projectSnapshot) projectStatus = forbiddenBlock(projectRequired)
  else {
    const blocked = blockResolution(states, projectRequired)
    projectStatus = blocked || readyBlock(states, projectRequired,
      PROJECT_STATUS_OPTIONS.map((status) => ({
        status,
        count: filteredProjects.filter((project) => project.status === status).length,
      })),
    )
  }

  let costs
  if (!dashboardCostAccess) costs = forbiddenBlock(COST_REQUIRED)
  else if (costSourceBlock) costs = costSourceBlock
  else if (!costModel || costModelError) costs = errorBlock(COST_REQUIRED, costModelError)
  else {
    const selected = costModel.selectedComposition
    const priorMonth = months.at(-2)
    const prior = costModel.monthlyByMonth[priorMonth]
    costs = readyBlock(states, COST_REQUIRED, {
      ...selected,
      monthlyByMonth: costModel.monthlyByMonth,
      pending: costModel.pending,
      anomalies: costModel.anomalies,
      comparison: comparison(selected.total, filters.projectId === 'all' ? prior?.total : null),
    }, Boolean(states.laborWindow.data?.staleMonths?.includes(selectedMonth)))
  }

  const lifetimeReady = states.laborWindow.status === 'ready' &&
    states.laborWindow.data?.lifetimeStatus === 'ready' &&
    isPlainRecord(states.laborWindow.data?.projectLaborLifetimeById)
  const financialSourceBlock = blockResolution(states, FINANCIAL_REQUIRED)
  const pendingCostResult = pendingCostByProject(scopedProjectCosts, scopedVehicleIssues)
  let projectRanking
  let projectRows
  let financialRows = []
  let profitAggregate = { status: 'error', value: null, message: '累计成本暂不可用' }
  if (!dashboardProfitAccess) {
    projectRanking = forbiddenBlock(FINANCIAL_REQUIRED)
    projectRows = forbiddenBlock(FINANCIAL_REQUIRED)
    profitAggregate = { status: 'forbidden', value: null, message: '当前权限下无法查看利润' }
  } else if (financialSourceBlock) {
    projectRanking = financialSourceBlock
    projectRows = { ...financialSourceBlock, requiredSources: [...FINANCIAL_REQUIRED] }
    profitAggregate = {
      status: financialSourceBlock.status, value: null, message: financialSourceBlock.message,
    }
  } else if (!lifetimeReady || !costModel || financialCostModelError || pendingCostResult.blocking) {
    const message = !lifetimeReady
      ? '当前累计人工快照不完整，未发布累计成本与利润。'
      : pendingCostResult.blocking
        ? '待确认成本累计超出安全范围，未发布部分累计成本与利润。'
        : financialCostModelError
    projectRanking = errorBlock(FINANCIAL_REQUIRED, message)
    projectRows = errorBlock(FINANCIAL_REQUIRED, message)
    profitAggregate = { status: 'error', value: null, message }
  } else {
    financialRows = buildFinancialRows(
      filteredProjects, contractMap, costModel, pendingCostResult.totals,
    )
      .sort((left, right) => left.projectName.localeCompare(right.projectName, 'zh-CN') ||
        left.projectId.localeCompare(right.projectId))
    const missingAnchor = financialRows.some((row) => row.profitStatus === 'missing_anchor')
    const invalidCost = financialRows.some((row) => row.confirmedCost === null)
    if (missingAnchor) {
      profitAggregate = {
        status: 'error', value: null,
        message: '部分项目待完成合同收入确认，未发布部分利润合计。',
      }
    } else if (invalidCost) {
      profitAggregate = {
        status: 'error', value: null,
        message: '部分项目累计成本不完整，未发布部分利润合计。',
      }
    } else {
      let total = 0
      for (const row of financialRows) {
        const next = row.estimatedProfit === null ? null : total + row.estimatedProfit
        if (!Number.isSafeInteger(next)) { total = null; break }
        total = next
      }
      profitAggregate = total === null
        ? { status: 'error', value: null, message: '利润累计超出安全范围。' }
        : { status: 'ready', value: total, message: '' }
    }
    projectRanking = readyBlock(
      states, FINANCIAL_REQUIRED, rankRows(financialRows, filters.rankingMetric),
      states.laborWindow.data?.lifetimeStale === true,
    )
    const totalItems = financialRows.length
    const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize))
    const page = Math.min(filters.page, totalPages)
    const start = (page - 1) * filters.pageSize
    projectRows = readyBlock(states, FINANCIAL_REQUIRED, {
      projectOptions,
      items: financialRows.slice(start, start + filters.pageSize),
      page,
      pageSize: filters.pageSize,
      totalItems,
      totalPages,
    }, states.laborWindow.data?.lifetimeStale === true)
  }

  const card = (key, label, status, value, message = '') => ({
    key, label, status, value: status === 'ready' ? value : null, comparison: null, message,
  })
  let kpis
  if (!access.projectSnapshot) kpis = forbiddenBlock(projectRequired)
  else {
    const blocked = blockResolution(states, projectRequired)
    if (blocked) kpis = blocked
    else {
      const revenueStatus = revenue.status
      const revenueData = revenue.data
      kpis = readyBlock(states, projectRequired, [
        card('activeProjects', '当前有效项目', 'ready', filteredProjects.length),
        card('contractTaxInclusive', '当前含税合同额', revenueStatus,
          revenueData?.contractTaxInclusiveAmount, revenue.message),
        card('receivedTaxInclusive', '当前累计含税收款', revenueStatus,
          revenueData?.receivedTaxInclusiveAmount, revenue.message),
        card('outstandingTaxInclusive', '当前含税未收', revenueStatus,
          revenueData?.outstandingTaxInclusiveAmount, revenue.message),
        card('estimatedProfitTaxExclusive', '当前累计税抜预计利润',
          profitAggregate.status, profitAggregate.value, profitAggregate.message),
      ])
    }
  }

  let purchaseOperations
  if (!access.purchase.accrual) purchaseOperations = forbiddenBlock(['purchaseAccrual'])
  else {
    const blocked = blockResolution(states, ['purchaseAccrual'])
    if (blocked) purchaseOperations = blocked
    else {
      const paymentAccess = access.purchase.payments
      const payableAccess = paymentAccess && access.purchase.payable
      const anomalyAccess = paymentAccess && access.purchase.anomalies
      const projectId = filters.projectId === 'all' || !scopeIds.has(filters.projectId)
        ? ''
        : filters.projectId

      let occurrence = mini('error', null)
      if (!purchaseMonth.blocking) {
        const monthCost = sumField(
          purchaseMonth.rows, 'totalCost', [], 'purchaseAccrual',
        )
        const previousCost = purchasePriorMonth.blocking
          ? null
          : sumField(purchasePriorMonth.rows, 'totalCost', [], 'purchaseAccrual')
        if (monthCost !== null) {
          occurrence = mini('ready', {
            count: purchaseMonth.rows.length,
            monthCost,
            comparison: comparison(monthCost, previousCost),
          })
        }
      }

      let paymentStatus = paymentAccess ? states.purchasePayments.status : 'forbidden'
      let monthPaymentAccounting = null
      if (paymentAccess && paymentStatus === 'ready') {
        if (paymentMonth.blocking) paymentStatus = 'error'
        else {
          try {
            const paymentTotals = new Map()
            for (const payment of paymentMonth.rows) {
              const total = safeAdd(
                paymentTotals.get(payment.purchaseId) || 0,
                payment.jpyAmount,
              )
              if (total === null) throw new TypeError('purchase payment overflow')
              paymentTotals.set(payment.purchaseId, total)
            }
            const linkPurchases = scopedPurchasePrepared.rows.map((row) => ({
              ...row,
              totalCost: safeYen(row.totalCost) ?? paymentTotals.get(row.purchaseId) ?? 0,
              openingPaidAmount: 0,
            }))
            monthPaymentAccounting = buildPurchaseAccountingReadModel({
              purchaseRecords: linkPurchases,
              paymentRecords: paymentMonth.rows,
              paymentState: { status: 'ready', data: paymentMonth.rows },
              month: selectedMonth,
              projectId,
            })
          } catch {
            paymentStatus = 'error'
          }
        }
      }

      let lifetimeStatus = paymentAccess ? states.purchasePayments.status : 'forbidden'
      let lifetimeAccounting = null
      if (paymentAccess && lifetimeStatus === 'ready') {
        if (purchaseSanitized.blocking || paymentSanitized.blocking) {
          lifetimeStatus = 'error'
        } else {
          try {
            lifetimeAccounting = buildPurchaseAccountingReadModel({
              purchaseRecords: purchaseSanitized.rows,
              paymentRecords: paymentSanitized.rows,
              paymentState: { status: 'ready', data: paymentSanitized.rows },
              month: selectedMonth,
              projectId,
            })
          } catch {
            lifetimeStatus = 'error'
          }
        }
      }

      const anomalies = lifetimeStatus === 'ready'
        ? [
            ...purchaseSanitized.anomalies,
            ...paymentSanitized.anomalies,
            ...scopedOrphanPaymentAnomalies,
            ...lifetimeAccounting.anomalies,
          ].map(projectPurchaseHealthAnomaly)
        : []
      const payableStatus = payableAccess ? lifetimeStatus : 'forbidden'
      const healthStatus = anomalyAccess ? lifetimeStatus : 'forbidden'
      purchaseOperations = readyBlock(states, ['purchaseAccrual'], {
        occurrence,
        payment: paymentStatus === 'ready'
          ? mini('ready', {
              monthPaymentCash: monthPaymentAccounting.summary.monthPaymentCash,
              comparison: null,
            })
          : mini(paymentStatus, null),
        payable: payableStatus === 'ready'
          ? mini('ready', { currentOutstanding: lifetimeAccounting.summary.currentOutstanding })
          : mini(payableStatus, null),
        health: healthStatus === 'ready'
          ? mini('ready', {
              anomalyCount: anomalies.length,
              missingInvoiceCount: lifetimeAccounting.summary.missingInvoiceCount,
              anomalies,
            })
          : mini(healthStatus, null),
      })
    }
  }

  const cashRequired = []
  const cashIncomeAllowed = contractAmountAccess
  const cashPurchaseAllowed = access.purchase.accrual && access.purchase.payments
  const cashVehicleAllowed = access.vehicle.view && access.vehicle.amounts
  if (cashIncomeAllowed) cashRequired.push('receipts')
  if (cashPurchaseAllowed) cashRequired.push('purchasePayments')
  if (cashVehicleAllowed) cashRequired.push('fuel', 'vehicleExpenses')
  const cashContributorBlocking =
    (cashIncomeAllowed && receiptSanitized.blocking) ||
    (cashPurchaseAllowed && paymentWindow.blocking) ||
    (cashVehicleAllowed && (fuelWindow.blocking || vehicleExpenseWindow.blocking))
  let cashFlow
  if (cashRequired.length === 0) cashFlow = forbiddenBlock([])
  else {
    const blocked = blockResolution(states, cashRequired)
    if (blocked) cashFlow = blocked
    else if (cashContributorBlocking) {
      cashFlow = errorBlock(
        cashRequired, '现金金额不完整或超出安全范围，未发布部分合计。',
      )
    }
    else {
      try {
        let purchaseComponentStatus = cashPurchaseAllowed
          ? states.purchaseAccrual.status
          : 'forbidden'
        let purchasePaymentRows = []
        let purchaseAnomalies = []
        if (cashPurchaseAllowed && states.purchaseAccrual.status === 'ready' &&
            scopedPurchasePrepared.anomalies.some((issue) => issue.code === 'invalid_record')) {
          purchaseComponentStatus = 'error'
        } else if (cashPurchaseAllowed && states.purchaseAccrual.status === 'ready') {
          try {
            const paymentTotals = new Map()
            for (const payment of paymentWindow.rows) {
              const total = safeAdd(
                paymentTotals.get(payment.purchaseId) || 0,
                payment.jpyAmount,
              )
              if (total === null) throw new TypeError('purchase payment overflow')
              paymentTotals.set(payment.purchaseId, total)
            }
            const linkPurchases = scopedPurchasePrepared.rows.map((row) => ({
              ...row,
              totalCost: safeYen(row.totalCost) ?? paymentTotals.get(row.purchaseId) ?? 0,
              openingPaidAmount: 0,
            }))
            const cashPurchaseAccounting = buildPurchaseAccountingReadModel({
              purchaseRecords: linkPurchases,
              paymentRecords: paymentWindow.rows,
              paymentState: { status: 'ready', data: paymentWindow.rows },
              month: selectedMonth,
              projectId: filters.projectId === 'all' || !scopeIds.has(filters.projectId)
                ? ''
                : filters.projectId,
            })
            purchasePaymentRows = cashPurchaseAccounting.cashPaymentRows
            purchaseAnomalies = cashPurchaseAccounting.anomalies
            purchaseComponentStatus = 'ready'
          } catch {
            purchaseComponentStatus = 'error'
          }
        }
        const raw = buildRecordedCashFlow({
          months,
          projectId: filters.projectId !== 'all' && scopeIds.has(filters.projectId)
            ? filters.projectId
            : 'all',
          activeProjectIds: filteredProjects.map((project) => project.projectId),
          receipts: cashIncomeAllowed
            ? receiptSanitized.rows
            : [],
          purchasePaymentRows: purchaseComponentStatus === 'ready' ? purchasePaymentRows : [],
          fuelRecords: cashVehicleAllowed ? fuelWindow.rows : [],
          vehicleExpenseRecords: cashVehicleAllowed ? vehicleExpenseWindow.rows : [],
          laborWindow: internalEmptyLaborWindow(),
          operatingExpenses: [],
          manualProjectCosts: [],
          vehicleIssueRecords: [],
        })
        const unsafeCash = raw.series.some((row) =>
          (cashIncomeAllowed && safeYen(row.income) === null) ||
          (purchaseComponentStatus === 'ready' && safeYen(row.purchaseOutflow) === null) ||
          (cashVehicleAllowed && safeYen(row.vehicleOutflow) === null) ||
          (purchaseComponentStatus === 'ready' && cashVehicleAllowed &&
            safeYen(row.totalOutflow) === null),
        ) || raw.anomalies.some((issue) =>
          typeof issue.code === 'string' &&
          (issue.code.includes('overflow') || issue.code.includes('invalid_amount')),
        )
        if (unsafeCash) throw new TypeError('unsafe cash aggregate')
        const incomeStatus = cashIncomeAllowed ? 'ready' : 'forbidden'
        const vehicleStatus = cashVehicleAllowed ? 'ready' : 'forbidden'
        const outflowStatus = purchaseComponentStatus === 'ready' && vehicleStatus === 'ready'
          ? 'ready'
          : purchaseComponentStatus !== 'ready'
            ? purchaseComponentStatus
            : vehicleStatus
        const netStatus = incomeStatus === 'ready' && outflowStatus === 'ready'
          ? 'ready'
          : incomeStatus !== 'ready'
            ? incomeStatus
            : outflowStatus
        const series = raw.series.map((row) => {
          const income = cashIncomeAllowed ? row.income : null
          const purchaseOutflow = purchaseComponentStatus === 'ready'
            ? row.purchaseOutflow
            : null
          const vehicleOutflow = cashVehicleAllowed ? row.vehicleOutflow : null
          const outflow = outflowStatus === 'ready' ? row.totalOutflow : null
          const net = netStatus === 'ready' ? safeSignedYen(income - outflow) : null
          return {
            month: row.month, income, outflow, net, purchaseOutflow, vehicleOutflow,
          }
        })
        const selected = series.at(-1)
        const prior = series.at(-2)
        cashFlow = readyBlock(states, cashRequired, {
          series,
          points: series.map(({ month, income, outflow, net }) => ({ month, income, outflow, net })),
          coverage: raw.coverage,
          anomalies: [...purchaseAnomalies, ...raw.anomalies],
          componentStatus: {
            income: incomeStatus,
            purchaseOutflow: purchaseComponentStatus,
            vehicleOutflow: vehicleStatus,
            outflow: outflowStatus,
            net: netStatus,
          },
          comparison: {
            income: comparison(selected.income, prior.income),
            outflow: comparison(selected.outflow, prior.outflow),
            net: comparison(selected.net, prior.net),
          },
        })
      } catch {
        cashFlow = errorBlock(cashRequired, '现金事实格式无效。')
      }
    }
  }

  const attendanceState = !access.attendance.view
    ? mini('forbidden', null)
    : states.attendance.status !== 'ready'
      ? mini(states.attendance.status, null)
      : (() => {
          const rows = rowsForScope(states.attendance.data, scopeIds, filters.projectId)
            .filter((row) => !isInactive(row))
            .filter((row) => dateInMonth(row, ['workDate', 'attendanceDate', 'date'], selectedMonth))
          const statusCounts = Object.create(null)
          for (const row of rows) {
            const status = normalizedStatusKey(row.status, ATTENDANCE_STATUS_KEYS)
            statusCounts[status] = (statusCounts[status] || 0) + 1
          }
          const abnormalCount = rows.filter((row) => !NORMAL_ATTENDANCE.has(row.status)).length
          return mini('ready', { count: rows.length, abnormalCount, statusCounts, comparison: null })
        })()
  const laborState = !access.labor.view
    ? mini('forbidden', null)
    : states.laborWindow.status !== 'ready'
      ? mini(states.laborWindow.status, null)
      : access.labor.amounts && laborCurrentBlocking
        ? mini('error', null)
      : (() => {
          const rows = states.laborWindow.data.monthly.filter((row) => row?.month === selectedMonth)
          if (rows.length !== 1 || rows[0]?.status !== 'ready') return mini('error', null)
          const row = rows[0]
          let fee = null
          if (access.labor.amounts) {
            if (filters.projectId === 'all') {
              if (filters.projectStatus === 'all') fee = safeYen(row.salaryTotal)
              else fee = filteredProjects.reduce((total, project) => {
                const amount = safeYen(row.projectLaborById?.[project.projectId]) || 0
                return safeAdd(total, amount) ?? total
              }, 0)
            } else fee = scopeIds.has(filters.projectId)
              ? safeYen(row.projectLaborById?.[filters.projectId]) || 0
              : 0
          }
          return mini('ready', {
            fee,
            feeStatus: access.labor.amounts ? 'ready' : 'forbidden',
            pendingConfirmationCount: safeYen(row.pendingCount),
            source: row.source,
            comparison: null,
          })
        })()
  const laborChildren = [attendanceState.status, laborState.status]
  const laborOverall = laborChildren.includes('ready')
    ? 'ready'
    : ['forbidden', 'error', 'loading'].find((status) => laborChildren.includes(status))
  const laborRequired = [
    ...(access.attendance.view ? ['attendance'] : []),
    ...(access.labor.view ? ['laborWindow'] : []),
  ]
  const laborOperations = laborOverall === 'ready'
    ? readyBlock(states, laborRequired, { attendance: attendanceState, labor: laborState })
    : makeBlock({
        status: laborOverall, data: null, requiredSources: laborRequired,
        code: laborOverall === 'forbidden' ? 'ACCESS_DENIED' : '',
        message: laborOverall === 'loading' ? '数据正在加载' : '数据暂不可用',
      })

  let vehicleOperations
  if (!access.vehicle.view) vehicleOperations = forbiddenBlock(VEHICLE_REQUIRED)
  else {
    const blocked = blockResolution(states, VEHICLE_REQUIRED)
    if (blocked) vehicleOperations = blocked
    else if (vehicleUsageSanitized.blocking || (access.vehicle.amounts && (
      fuelMonth.blocking || vehicleExpenseMonth.blocking ||
      vehicleIssueMonth.blocking
    ))) {
      vehicleOperations = errorBlock(
        VEHICLE_REQUIRED, '车辆金额或里程不完整，未发布部分合计。',
      )
    }
    else {
      const usage = rowsForScope(vehicleUsageSanitized.rows, scopeIds, filters.projectId)
        .filter((row) => dateInMonth(row, ['usageDate', 'date'], selectedMonth))
      const fuel = fuelMonth.rows
      const expenses = vehicleExpenseMonth.rows
      const issues = vehicleIssueMonth.rows.filter((row) => row.issueStatus !== '已处理')
      const opAnomalies = []
      const fee = access.vehicle.amounts
        ? safeAdd(
            sumField(fuel, 'fuelAmount', opAnomalies, 'fuel'),
            sumField(expenses, 'amount', opAnomalies, 'vehicleExpenses'),
          )
        : null
      const mileage = sumField(usage, 'dailyMileage', opAnomalies, 'vehicleUsage')
      const pendingRepairAmount = access.vehicle.amounts
        ? sumField(issues, 'repairCost', opAnomalies, 'vehicleIssues')
        : null
      vehicleOperations = mileage === null || (access.vehicle.amounts && (
        fee === null || pendingRepairAmount === null
      ))
        ? errorBlock(VEHICLE_REQUIRED, '车辆金额或里程不完整，未发布部分合计。')
        : readyBlock(states, VEHICLE_REQUIRED, {
            vehicleCount: states.vehicles.data.filter((row) => !isInactive(row)).length,
            usageCount: usage.length,
            mileage,
            fee,
            pendingRepairAmount,
            issueCount: issues.length,
            comparison: null,
            anomalies: opAnomalies,
          })
    }
  }

  let inventoryOperations
  if (!access.inventory.view) inventoryOperations = forbiddenBlock(INVENTORY_REQUIRED)
  else {
    const blocked = blockResolution(states, INVENTORY_REQUIRED)
    if (blocked) inventoryOperations = blocked
    else if (access.inventory.amounts && inventorySanitized.blocking) {
      inventoryOperations = errorBlock(
        INVENTORY_REQUIRED, '库存金额不完整或超出安全范围，未发布部分合计。',
      )
    }
    else {
      const itemRows = access.inventory.amounts
        ? inventorySanitized.rows
        : states.inventoryItems.data
      const items = rowsForScope(itemRows, scopeIds, filters.projectId)
        .filter((row) => !isInactive(row))
      const statusCounts = Object.create(null)
      for (const row of items) {
        const status = normalizedStatusKey(
          row.currentStatus || row.status,
          INVENTORY_STATUS_KEYS,
        )
        statusCounts[status] = (statusCounts[status] || 0) + 1
      }
      const countMonth = (name, fields) => rowsForScope(states[name].data, scopeIds, filters.projectId)
        .filter((row) => !isInactive(row) && dateInMonth(row, fields, selectedMonth)).length
      inventoryOperations = readyBlock(states, INVENTORY_REQUIRED, {
        itemCount: items.length,
        statusCounts,
        stockInCount: countMonth('stockInRecords', ['stockInDate', 'date']),
        stockOutCount: countMonth('stockOutRecords', ['stockOutDate', 'date']),
        returnCount: countMonth('stockReturnRecords', ['returnDate', 'stockReturnDate', 'date']),
        totalCost: access.inventory.amounts
          ? sumField(items, 'totalCost', [], 'inventoryItems')
          : null,
        comparison: null,
      })
    }
  }

  let toolOperations
  if (!access.tools.view) toolOperations = forbiddenBlock(TOOL_REQUIRED)
  else {
    const blocked = blockResolution(states, TOOL_REQUIRED)
    if (blocked) toolOperations = blocked
    else if (access.tools.amounts && responsibilitySanitized.blocking) {
      toolOperations = errorBlock(
        TOOL_REQUIRED, '工具赔偿金额不完整或超出安全范围，未发布部分合计。',
      )
    }
    else {
      const tools = states.toolRecords.data.filter((row) => !isInactive(row))
      const statusCounts = Object.create(null)
      for (const row of tools) {
        const status = normalizedStatusKey(row.currentStatus || row.status, TOOL_STATUS_KEYS)
        statusCounts[status] = (statusCounts[status] || 0) + 1
      }
      const returned = new Set(states.toolReturnRecords.data.filter((row) => !isInactive(row))
        .map((row) => row.borrowRecordId).filter(safeIdentifier))
      const monthBorrows = rowsForScope(states.toolBorrowRecords.data, scopeIds, filters.projectId)
        .filter((row) => !isInactive(row) &&
          dateInMonth(row, ['borrowDate', 'date'], selectedMonth))
      const openTemporary = monthBorrows.filter((row) =>
        row.borrowType === '临时借用' && safeIdentifier(row.borrowRecordId) &&
        !returned.has(row.borrowRecordId),
      )
      const assignments = rowsForScope(
        states.lifelongToolAssignments.data, scopeIds, filters.projectId,
      ).filter((row) => !isInactive(row))
      const responsibilityRows = access.tools.amounts
        ? responsibilitySanitized.rows
        : states.toolResponsibilityRecords.data
      const responsibilities = rowsForScope(
        responsibilityRows, scopeIds, filters.projectId,
      ).filter((row) => !isInactive(row) && row.compensationStatus === '未赔偿')
      toolOperations = readyBlock(states, TOOL_REQUIRED, {
        toolCount: tools.length,
        statusCounts,
        borrowCount: monthBorrows.length,
        openTemporaryBorrowCount: openTemporary.length,
        lifelongAssignmentCount: assignments.length,
        unpaidResponsibilityCount: responsibilities.length,
        unpaidCompensation: access.tools.amounts
          ? sumField(responsibilities, 'compensationAmount', [], 'toolResponsibilityRecords')
          : null,
        comparison: null,
      })
    }
  }

  const sourceIssueRows = SOURCE_NAMES
    .filter((name) => states[name].status !== 'ready' || states[name].stale)
    .map((name) => ({
      source: name,
      status: states[name].status,
      stale: states[name].stale,
      message: states[name].message,
    }))
  const sourceIssues = readyBlock(states, [], sourceIssueRows)

  const alertsData = []
  const pushAlert = (alert, gates = {}) => {
    const canNavigate = gates.canNavigate === true
    const revealAmount = canNavigate && gates.revealAmount === true
    const revealRecord = canNavigate && gates.revealRecord === true
    alertsData.push({
      id: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      reason: alert.reason,
      count: Number.isSafeInteger(alert.count) && alert.count >= 0 ? alert.count : 1,
      amount: revealAmount && safeYen(alert.amount) !== null ? alert.amount : null,
      targetView: canNavigate ? alert.targetView : null,
      canNavigate,
      recordRef: revealRecord && safeIdentifier(alert.recordRef) ? alert.recordRef : null,
    })
  }
  if (attendanceState.status === 'ready' && attendanceState.data.abnormalCount > 0) {
    const row = states.attendance.data.find((item) =>
      !isInactive(item) && rowsForScope([item], scopeIds, filters.projectId).length > 0 &&
      dateInMonth(item, ['workDate', 'attendanceDate', 'date'], selectedMonth) &&
      !NORMAL_ATTENDANCE.has(item.status),
    )
    pushAlert({
      id: `attendance:${selectedMonth}`,
      type: 'attendance_exception', severity: 'warning', title: '考勤异常',
      reason: '所选月份存在待核对考勤。', count: attendanceState.data.abnormalCount,
      amount: null, targetView: 'labor', recordRef: row?.attendanceId || '',
    }, {
      canNavigate: access.attendance.view,
      revealAmount: false,
      revealRecord: access.attendance.identities,
    })
  }
  if (laborState.status === 'ready' && laborState.data.pendingConfirmationCount > 0) {
    pushAlert({
      id: `labor:${selectedMonth}`, type: 'labor_pending', severity: 'warning',
      title: '人工费用待确认', reason: '所选月份存在待确认人工记录。',
      count: laborState.data.pendingConfirmationCount, amount: laborState.data.fee,
      targetView: 'labor', recordRef: '',
    }, {
      canNavigate: access.labor.view,
      revealAmount: access.labor.amounts,
      revealRecord: false,
    })
  }
  if (purchaseOperations.status === 'ready' &&
      purchaseOperations.data.payable.status === 'ready' &&
      purchaseOperations.data.payable.data.currentOutstanding > 0) {
    pushAlert({
      id: 'purchase:current-payable', type: 'purchase_payable', severity: 'warning',
      title: '采购应付待处理', reason: '当前仍有采购应付余额。', count: 1,
      amount: purchaseOperations.data.payable.data.currentOutstanding,
      targetView: 'purchase', recordRef: '',
    }, {
      canNavigate: access.purchase.accrual,
      revealAmount: access.purchase.payable,
      revealRecord: false,
    })
  }
  if (purchaseOperations.status === 'ready' &&
      purchaseOperations.data.health.status === 'ready' &&
      purchaseOperations.data.health.data.anomalyCount > 0) {
    pushAlert({
      id: 'purchase:anomalies', type: 'purchase_anomaly', severity: 'warning',
      title: '采购数据待核对', reason: '采购台账存在异常记录。',
      count: purchaseOperations.data.health.data.anomalyCount,
      amount: null, targetView: 'purchase', recordRef: '',
    }, {
      canNavigate: access.purchase.accrual,
      revealAmount: false,
      revealRecord: false,
    })
  }
  if (access.costCategories.manualSupplement && states.projectCosts.status === 'ready') {
    const unbound = states.projectCosts.data.filter((row) =>
      !isInactive(row) && !safeIdentifier(row?.projectId),
    )
    if (unbound.length > 0) {
      pushAlert({
        id: 'project-costs:unbound', type: 'unbound_project_fact', severity: 'warning',
        title: '项目成本归属待核对', reason: '存在未绑定项目的成本事实。',
        count: unbound.length,
        amount: null, targetView: 'accounting', recordRef: '',
      }, {
        canNavigate: access.costCategories.manualSupplement,
        revealAmount: false,
        revealRecord: false,
      })
    }
  }
  for (const row of access.vehicle.view
    ? scopedVehicleIssues.filter((item) =>
        dateInMonth(item, ['issueDate'], selectedMonth) && item.issueStatus !== '已处理')
    : []) {
    const id = recordId(row, ['issueId'])
    if (!id) continue
    pushAlert({
      id: `vehicle:${selectedMonth}:${alertsData.filter((item) => item.type === 'vehicle_issue').length + 1}`,
      type: 'vehicle_issue', severity: 'warning',
      title: '车辆异常待处理', reason: '所选月份存在未处理车辆异常。', count: 1,
      amount: row.repairCost, targetView: 'vehicle', recordRef: id,
    }, {
      canNavigate: access.vehicle.view,
      revealAmount: access.vehicle.amounts,
      revealRecord: access.vehicle.amounts,
    })
  }
  for (const row of access.costCategories.manualSupplement
    ? scopedProjectCosts.filter((item) =>
        PENDING_COST_TYPES.has(item.costType) && dateInMonth(item, ['date'], selectedMonth))
    : []) {
    const id = recordId(row, ['costRecordId'])
    if (!id) continue
    pushAlert({
      id: `pending-cost:${selectedMonth}:${alertsData.filter((item) => item.type === 'pending_manual_cost').length + 1}`,
      type: 'pending_manual_cost', severity: 'warning',
      title: '手工成本待核对', reason: `${row.costType}尚未计入确认成本。`, count: 1,
      amount: row.amount, targetView: 'accounting', recordRef: id,
    }, {
      canNavigate: access.costCategories.manualSupplement,
      revealAmount: access.costCategories.manualSupplement,
      revealRecord: access.costCategories.manualSupplement,
    })
  }
  for (const row of access.tools.view &&
    states.toolResponsibilityRecords.status === 'ready' &&
    !(access.tools.amounts && responsibilitySanitized.blocking)
    ? rowsForScope(
        access.tools.amounts
          ? responsibilitySanitized.rows
          : states.toolResponsibilityRecords.data,
        scopeIds,
        filters.projectId,
      )
    : []) {
    if (isInactive(row) || row.compensationStatus !== '未赔偿') continue
    const id = recordId(row, ['responsibilityId', 'responsibilityRecordId'])
    if (!id) continue
    pushAlert({
      id: `tool:${alertsData.filter((item) => item.type === 'tool_responsibility').length + 1}`,
      type: 'tool_responsibility', severity: 'warning',
      title: '工具赔偿待处理', reason: '存在未赔偿工具责任记录。', count: 1,
      amount: row.compensationAmount, targetView: 'toolBorrow', recordRef: id,
    }, {
      canNavigate: access.tools.view,
      revealAmount: access.tools.amounts,
      revealRecord: access.tools.amounts,
    })
  }
  for (const row of financialRows.filter((item) => item.profitStatus === 'missing_anchor')) {
    pushAlert({
      id: `profit-anchor:${alertsData.filter((item) => item.type === 'missing_profit_anchor').length + 1}`,
      type: 'missing_profit_anchor', severity: 'error',
      title: '合同收入待确认', reason: '项目尚无有效税抜利润收入锚点。', count: 1,
      amount: null, targetView: 'contractRevenue', recordRef: row.projectId,
    }, {
      canNavigate: access.contracts.view,
      revealAmount: false,
      revealRecord: access.contracts.view,
    })
  }
  for (const issue of revenueResult.issues) {
    pushAlert({
      id: `over-receipt:${alertsData.filter((item) => item.type === 'over_receipt').length + 1}`,
      type: 'over_receipt', severity: 'warning',
      title: '收款超过合同额', reason: '含税未收已夹紧为零，超收金额需核对。', count: 1,
      amount: issue.excessTaxInclusiveAmount, targetView: 'contractRevenue',
      recordRef: issue.projectId,
    }, {
      canNavigate: access.contracts.view,
      revealAmount: access.contracts.amounts,
      revealRecord: access.contracts.view,
    })
  }
  for (const issue of sourceIssueRows) {
    pushAlert({
      id: `source:${issue.source}`, type: 'source_issue', severity: 'info',
      title: '数据源状态提示', reason: issue.message || `${issue.source}数据暂不可用`,
      count: 1, amount: null, targetView: null, recordRef: '',
    }, { canNavigate: false, revealAmount: false, revealRecord: false })
  }
  const dedupedAlerts = [...new Map(alertsData.map((alert) => [alert.id, alert])).values()]
    .sort((left, right) => left.id.localeCompare(right.id))
  const alerts = readyBlock(states, [], dedupedAlerts)

  const model = {
    meta,
    kpis,
    revenue,
    projectStatus,
    cashFlow,
    costs,
    alerts,
    purchaseOperations,
    laborOperations,
    vehicleOperations,
    inventoryOperations,
    toolOperations,
    projectRanking,
    projectRows,
    sourceIssues,
  }
  return deepFreeze(model)
}

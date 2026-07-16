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
          names.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key))) {
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
    let data = null
    if (status === 'ready') data = cloneOwnData(descriptors.data.value)
    const state = {
      status,
      data,
      code: typeof descriptors.code?.value === 'string' ? descriptors.code.value : '',
      message: typeof descriptors.message?.value === 'string' ? descriptors.message.value : '',
      stale: status === 'ready' && descriptors.stale?.value === true,
      updatedAt: typeof descriptors.updatedAt?.value === 'string'
        ? descriptors.updatedAt.value
        : null,
    }
    if (status !== 'ready' && descriptors.data.value !== null) state.data = null
    if (status === 'forbidden' && !state.code) state.code = 'ACCESS_DENIED'
    if (status === 'forbidden') state.message = '无权读取该数据'
    if (status === 'error' && !state.code) state.code = 'DATA_OPERATION_FAILED'
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
      states[name] = {
        status: 'error', data: null, code: 'INVALID_SOURCE_DATA',
        message: `${name}数据格式无效`, stale: false, updatedAt: state.updatedAt,
      }
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
  return ['statusCode', 'recordStatus', 'purchaseStatus'].some((field) => {
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

function dateInMonth(row, fields, month) {
  for (const field of fields) {
    if (monthOfDate(row?.[field]) === month) return true
  }
  return false
}

function recordId(row, fields) {
  for (const field of fields) if (safeIdentifier(row?.[field])) return row[field]
  return ''
}

function sanitizeMoneyRows(rows, {
  source, idFields, amountField, allowMissingAmount = false,
}) {
  const output = []
  const anomalies = []
  const seen = new Set()
  let aggregate = 0
  rows.forEach((row, index) => {
    const id = isPlainRecord(row) ? recordId(row, idFields) : ''
    const amount = isPlainRecord(row) ? safeYen(row[amountField]) : null
    if (!id || seen.has(id) || isInactive(row) ||
        (amount === null && !allowMissingAmount)) {
      anomalies.push({ source, code: seen.has(id) ? 'duplicate_record' : 'invalid_record', recordId: id || `row-${index + 1}` })
      return
    }
    if (amount !== null) {
      const next = safeAdd(aggregate, amount)
      if (next === null) {
        anomalies.push({ source, code: 'amount_overflow', recordId: id })
        return
      }
      aggregate = next
    }
    seen.add(id)
    output.push(row)
  })
  return { rows: output, anomalies }
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
      continue
    }
    total = next
  }
  return total
}

function pendingCostByProject(projectCosts, vehicleIssues) {
  const totals = new Map()
  const add = (projectId, amount) => {
    if (!safeIdentifier(projectId) || safeYen(amount) === null) return
    const current = totals.get(projectId) || 0
    const next = safeAdd(current, amount)
    if (next !== null) totals.set(projectId, next)
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
  return totals
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
    for (const projectId of ids) {
      const amount = safeYen(row?.projectLaborById?.[projectId]) || 0
      const next = safeAdd(projectLaborTotal, amount)
      if (next === null) throw new TypeError('scoped labor overflow')
      projectLaborTotal = next
      projectLaborById[projectId] = amount
    }
    return {
      ...row,
      salaryTotal: projectLaborTotal,
      projectLaborTotal,
      projectLaborById,
    }
  })
  const projectLaborLifetimeById = {}
  for (const projectId of ids) {
    projectLaborLifetimeById[projectId] = value.projectLaborLifetimeById?.[projectId] ?? 0
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

  const purchaseSanitized = states.purchaseAccrual.status === 'ready'
    ? sanitizeMoneyRows(states.purchaseAccrual.data, {
        source: 'purchaseAccrual', idFields: ['purchaseId'], amountField: 'totalCost',
      })
    : { rows: [], anomalies: [] }
  const paymentSanitized = states.purchasePayments.status === 'ready'
    ? sanitizeMoneyRows(states.purchasePayments.data, {
        source: 'purchasePayments', idFields: ['paymentId'], amountField: 'jpyAmount',
      })
    : { rows: [], anomalies: [] }
  const scopedPurchases = rowsForScope(purchaseSanitized.rows, scopeIds, filters.projectId)
  const scopedPayments = rowsForScope(paymentSanitized.rows, scopeIds, filters.projectId)
  const scopedProjectCosts = rowsForScope(
    states.projectCosts.status === 'ready' ? states.projectCosts.data : [],
    scopeIds,
    filters.projectId,
  )
  const scopedOperating = rowsForScope(
    states.operatingExpenses.status === 'ready' ? states.operatingExpenses.data : [],
    scopeIds,
    filters.projectId,
  )
  const scopedFuel = rowsForScope(
    states.fuel.status === 'ready' ? states.fuel.data : [], scopeIds, filters.projectId,
  )
  const scopedVehicleExpenses = rowsForScope(
    states.vehicleExpenses.status === 'ready' ? states.vehicleExpenses.data : [],
    scopeIds,
    filters.projectId,
  )
  const scopedVehicleIssues = rowsForScope(
    states.vehicleIssues.status === 'ready' ? states.vehicleIssues.data : [],
    scopeIds,
    filters.projectId,
  )

  const contractAmountAccess = access.contracts.view && access.contracts.amounts
  const completeCostAccess = Object.values(access.costCategories).every(Boolean) &&
    access.profit.completeCostRequired &&
    access.labor.view && access.labor.amounts &&
    access.purchase.accrual &&
    access.vehicle.view && access.vehicle.amounts
  const dashboardCostAccess = completeCostAccess && access.profit.view
  const dashboardProfitAccess = dashboardCostAccess && contractAmountAccess
  const costSourceBlock = blockResolution(states, COST_REQUIRED)
  let costModel = null
  let costModelError = ''
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
      const hasUnsafeAggregate = costModel.selectedComposition.total === null ||
        costModel.anomalies.some((issue) =>
          typeof issue.code === 'string' && issue.code.includes('overflow'))
      if (hasUnsafeAggregate) costModelError = '成本金额不完整或超出安全范围，未发布部分合计。'
    } catch {
      costModelError = '成本来源格式无效，未发布部分成本。'
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
  } else if (!lifetimeReady || !costModel || costModelError) {
    const message = !lifetimeReady ? '当前累计人工快照不完整，未发布累计成本与利润。' : costModelError
    projectRanking = errorBlock(FINANCIAL_REQUIRED, message)
    projectRows = errorBlock(FINANCIAL_REQUIRED, message)
    profitAggregate = { status: 'error', value: null, message }
  } else {
    const pendingMap = pendingCostByProject(scopedProjectCosts, scopedVehicleIssues)
    financialRows = buildFinancialRows(filteredProjects, contractMap, costModel, pendingMap)
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
  let purchaseAccounting = null
  if (!access.purchase.accrual) purchaseOperations = forbiddenBlock(['purchaseAccrual'])
  else {
    const blocked = blockResolution(states, ['purchaseAccrual'])
    if (blocked) purchaseOperations = blocked
    else {
      try {
        const paymentAccess = access.purchase.accrual && access.purchase.payments
        const payableAccess = paymentAccess && access.purchase.payable
        const anomalyAccess = paymentAccess && access.purchase.anomalies
        const paymentState = paymentAccess
          ? { status: states.purchasePayments.status, data: states.purchasePayments.data }
          : { status: 'forbidden', data: null }
        purchaseAccounting = buildPurchaseAccountingReadModel({
          purchaseRecords: scopedPurchases,
          paymentRecords: paymentAccess && states.purchasePayments.status === 'ready'
            ? scopedPayments
            : [],
          paymentState,
          month: selectedMonth,
          projectId: filters.projectId === 'all' || !scopeIds.has(filters.projectId)
            ? ''
            : filters.projectId,
        })
        const occurrenceRows = purchaseAccounting.rows.filter((row) =>
          dateInMonth(row, ['purchaseDate'], selectedMonth),
        )
        const paymentStatus = paymentAccess
          ? states.purchasePayments.status
          : 'forbidden'
        const payableStatus = payableAccess
          ? states.purchasePayments.status
          : 'forbidden'
        const healthStatus = anomalyAccess
          ? states.purchasePayments.status
          : 'forbidden'
        const anomalies = [
          ...purchaseSanitized.anomalies,
          ...paymentSanitized.anomalies,
          ...purchaseAccounting.anomalies,
        ]
        const previousMonth = months.at(-2)
        const previousCost = sumField(
          purchaseAccounting.rows.filter((row) => dateInMonth(row, ['purchaseDate'], previousMonth)),
          'totalCost', [], 'purchaseAccrual',
        )
        purchaseOperations = readyBlock(states, ['purchaseAccrual'], {
          occurrence: mini('ready', {
            count: occurrenceRows.length,
            monthCost: purchaseAccounting.summary.monthPurchaseCost,
            comparison: comparison(purchaseAccounting.summary.monthPurchaseCost, previousCost),
          }),
          payment: paymentStatus === 'ready'
            ? mini('ready', {
                monthPaymentCash: purchaseAccounting.summary.monthPaymentCash,
                comparison: null,
              })
            : mini(paymentStatus, null),
          payable: payableStatus === 'ready'
            ? mini('ready', { currentOutstanding: purchaseAccounting.summary.currentOutstanding })
            : mini(payableStatus, null),
          health: healthStatus === 'ready'
            ? mini('ready', {
                anomalyCount: anomalies.length,
                missingInvoiceCount: purchaseAccounting.summary.missingInvoiceCount,
                anomalies,
              })
            : mini(healthStatus, null),
        })
      } catch {
        purchaseOperations = errorBlock(['purchaseAccrual'], '采购数据格式无效。')
      }
    }
  }

  const cashRequired = []
  const cashIncomeAllowed = contractAmountAccess
  const cashPurchaseAllowed = access.purchase.accrual && access.purchase.payments
  const cashVehicleAllowed = access.vehicle.view && access.vehicle.amounts
  if (cashIncomeAllowed) cashRequired.push('receipts')
  if (cashPurchaseAllowed) cashRequired.push('purchasePayments')
  if (cashVehicleAllowed) cashRequired.push('fuel', 'vehicleExpenses')
  let cashFlow
  if (cashRequired.length === 0) cashFlow = forbiddenBlock([])
  else {
    const blocked = blockResolution(states, cashRequired)
    if (blocked) cashFlow = blocked
    else {
      try {
        const raw = buildRecordedCashFlow({
          months,
          projectId: filters.projectId !== 'all' && scopeIds.has(filters.projectId)
            ? filters.projectId
            : 'all',
          activeProjectIds: filteredProjects.map((project) => project.projectId),
          receipts: cashIncomeAllowed
            ? rowsForScope(states.receipts.data, scopeIds, filters.projectId)
            : [],
          purchasePaymentRows: cashPurchaseAllowed ? scopedPayments : [],
          fuelRecords: cashVehicleAllowed ? scopedFuel : [],
          vehicleExpenseRecords: cashVehicleAllowed ? scopedVehicleExpenses : [],
          laborWindow: internalEmptyLaborWindow(),
          operatingExpenses: [],
          manualProjectCosts: [],
          vehicleIssueRecords: [],
        })
        const series = raw.series.map((row) => {
          const outflowComplete = cashPurchaseAllowed && cashVehicleAllowed
          const income = cashIncomeAllowed ? row.income : null
          const purchaseOutflow = cashPurchaseAllowed ? row.purchaseOutflow : null
          const vehicleOutflow = cashVehicleAllowed ? row.vehicleOutflow : null
          const outflow = outflowComplete ? row.totalOutflow : null
          const net = income !== null && outflow !== null ? safeSignedYen(income - outflow) : null
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
          anomalies: raw.anomalies,
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
            .filter((row) => dateInMonth(row, ['workDate', 'attendanceDate', 'date'], selectedMonth))
          const statusCounts = {}
          for (const row of rows) {
            const status = typeof row.status === 'string' && row.status ? row.status : '未设置'
            statusCounts[status] = (statusCounts[status] || 0) + 1
          }
          const abnormalCount = rows.filter((row) => !NORMAL_ATTENDANCE.has(row.status)).length
          return mini('ready', { count: rows.length, abnormalCount, statusCounts, comparison: null })
        })()
  const laborState = !access.labor.view
    ? mini('forbidden', null)
    : states.laborWindow.status !== 'ready'
      ? mini(states.laborWindow.status, null)
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
    else {
      const usage = rowsForScope(states.vehicleUsage.data, scopeIds, filters.projectId)
        .filter((row) => dateInMonth(row, ['usageDate', 'date'], selectedMonth))
      const fuel = scopedFuel.filter((row) => dateInMonth(row, ['fuelDate'], selectedMonth))
      const expenses = scopedVehicleExpenses.filter((row) =>
        dateInMonth(row, ['expenseDate'], selectedMonth),
      )
      const issues = scopedVehicleIssues.filter((row) =>
        dateInMonth(row, ['issueDate'], selectedMonth) && row.issueStatus !== '已处理',
      )
      const opAnomalies = []
      const fee = access.vehicle.amounts
        ? safeAdd(
            sumField(fuel, 'fuelAmount', opAnomalies, 'fuel'),
            sumField(expenses, 'amount', opAnomalies, 'vehicleExpenses'),
          )
        : null
      vehicleOperations = readyBlock(states, VEHICLE_REQUIRED, {
        vehicleCount: states.vehicles.data.filter((row) => !isInactive(row)).length,
        usageCount: usage.length,
        mileage: sumField(usage, 'dailyMileage', opAnomalies, 'vehicleUsage'),
        fee,
        pendingRepairAmount: access.vehicle.amounts
          ? sumField(issues, 'repairCost', opAnomalies, 'vehicleIssues')
          : null,
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
    else {
      const items = rowsForScope(states.inventoryItems.data, scopeIds, filters.projectId)
        .filter((row) => !isInactive(row))
      const statusCounts = {}
      for (const row of items) {
        const status = row.currentStatus || row.status || '未设置'
        statusCounts[status] = (statusCounts[status] || 0) + 1
      }
      const countMonth = (name, fields) => rowsForScope(states[name].data, scopeIds, filters.projectId)
        .filter((row) => dateInMonth(row, fields, selectedMonth)).length
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
    else {
      const tools = states.toolRecords.data.filter((row) => !isInactive(row))
      const statusCounts = {}
      for (const row of tools) {
        const status = row.currentStatus || row.status || '未设置'
        statusCounts[status] = (statusCounts[status] || 0) + 1
      }
      const returned = new Set(states.toolReturnRecords.data
        .map((row) => row.borrowRecordId).filter(safeIdentifier))
      const monthBorrows = rowsForScope(states.toolBorrowRecords.data, scopeIds, filters.projectId)
        .filter((row) => dateInMonth(row, ['borrowDate', 'date'], selectedMonth))
      const openTemporary = monthBorrows.filter((row) =>
        row.borrowType === '临时借用' && safeIdentifier(row.borrowRecordId) &&
        !returned.has(row.borrowRecordId),
      )
      const assignments = rowsForScope(
        states.lifelongToolAssignments.data, scopeIds, filters.projectId,
      ).filter((row) => !isInactive(row))
      const responsibilities = rowsForScope(
        states.toolResponsibilityRecords.data, scopeIds, filters.projectId,
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
  const pushAlert = (alert, allowed, revealAmount = allowed, revealRecord = allowed) => {
    const canNavigate = allowed === true
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
      rowsForScope([item], scopeIds, filters.projectId).length > 0 &&
      dateInMonth(item, ['workDate', 'attendanceDate', 'date'], selectedMonth) &&
      !NORMAL_ATTENDANCE.has(item.status),
    )
    pushAlert({
      id: `attendance:${selectedMonth}`,
      type: 'attendance_exception', severity: 'warning', title: '考勤异常',
      reason: '所选月份存在待核对考勤。', count: attendanceState.data.abnormalCount,
      amount: null, targetView: 'labor', recordRef: row?.attendanceId || '',
    }, access.attendance.identities, false, access.attendance.identities)
  }
  if (laborState.status === 'ready' && laborState.data.pendingConfirmationCount > 0) {
    pushAlert({
      id: `labor:${selectedMonth}`, type: 'labor_pending', severity: 'warning',
      title: '人工费用待确认', reason: '所选月份存在待确认人工记录。',
      count: laborState.data.pendingConfirmationCount, amount: laborState.data.fee,
      targetView: 'labor', recordRef: '',
    }, access.labor.amounts, access.labor.amounts, false)
  }
  if (purchaseOperations.status === 'ready' &&
      purchaseOperations.data.payable.status === 'ready' &&
      purchaseOperations.data.payable.data.currentOutstanding > 0) {
    pushAlert({
      id: 'purchase:current-payable', type: 'purchase_payable', severity: 'warning',
      title: '采购应付待处理', reason: '当前仍有采购应付余额。', count: 1,
      amount: purchaseOperations.data.payable.data.currentOutstanding,
      targetView: 'purchase', recordRef: '',
    }, access.purchase.payable, access.purchase.payable, false)
  }
  if (purchaseOperations.status === 'ready' &&
      purchaseOperations.data.health.status === 'ready' &&
      purchaseOperations.data.health.data.anomalyCount > 0) {
    pushAlert({
      id: 'purchase:anomalies', type: 'purchase_anomaly', severity: 'warning',
      title: '采购数据待核对', reason: '采购台账存在异常记录。',
      count: purchaseOperations.data.health.data.anomalyCount,
      amount: null, targetView: 'purchase', recordRef: '',
    }, access.purchase.anomalies, false, false)
  }
  if (states.projectCosts.status === 'ready') {
    const unbound = states.projectCosts.data.filter((row) =>
      !isInactive(row) && !safeIdentifier(row?.projectId),
    )
    if (unbound.length > 0) {
      pushAlert({
        id: 'project-costs:unbound', type: 'unbound_project_fact', severity: 'warning',
        title: '项目成本归属待核对', reason: '存在未绑定项目的成本事实。',
        count: unbound.length,
        amount: null, targetView: 'accounting', recordRef: '',
      }, access.costCategories.manualSupplement, false, false)
    }
  }
  for (const row of scopedVehicleIssues.filter((item) =>
    dateInMonth(item, ['issueDate'], selectedMonth) && item.issueStatus !== '已处理')) {
    const id = recordId(row, ['issueId'])
    if (!id) continue
    pushAlert({
      id: `vehicle:${id}`, type: 'vehicle_issue', severity: 'warning',
      title: '车辆异常待处理', reason: '所选月份存在未处理车辆异常。', count: 1,
      amount: row.repairCost, targetView: 'vehicle', recordRef: id,
    }, access.vehicle.amounts, access.vehicle.amounts, access.vehicle.amounts)
  }
  for (const row of scopedProjectCosts.filter((item) =>
    PENDING_COST_TYPES.has(item.costType) && dateInMonth(item, ['date'], selectedMonth))) {
    const id = recordId(row, ['costRecordId'])
    if (!id) continue
    pushAlert({
      id: `pending-cost:${id}`, type: 'pending_manual_cost', severity: 'warning',
      title: '手工成本待核对', reason: `${row.costType}尚未计入确认成本。`, count: 1,
      amount: row.amount, targetView: 'accounting', recordRef: id,
    }, access.costCategories.manualSupplement, access.costCategories.manualSupplement,
    access.costCategories.manualSupplement)
  }
  for (const row of states.toolResponsibilityRecords.status === 'ready'
    ? rowsForScope(states.toolResponsibilityRecords.data, scopeIds, filters.projectId)
    : []) {
    if (row.compensationStatus !== '未赔偿') continue
    const id = recordId(row, ['responsibilityId'])
    if (!id) continue
    pushAlert({
      id: `tool:${id}`, type: 'tool_responsibility', severity: 'warning',
      title: '工具赔偿待处理', reason: '存在未赔偿工具责任记录。', count: 1,
      amount: row.compensationAmount, targetView: 'tools', recordRef: id,
    }, access.tools.amounts, access.tools.amounts, access.tools.amounts)
  }
  for (const row of financialRows.filter((item) => item.profitStatus === 'missing_anchor')) {
    pushAlert({
      id: `profit-anchor:${row.projectId}`, type: 'missing_profit_anchor', severity: 'error',
      title: '合同收入待确认', reason: '项目尚无有效税抜利润收入锚点。', count: 1,
      amount: null, targetView: 'contractRevenue', recordRef: row.projectId,
    }, access.contracts.view, false, access.contracts.view)
  }
  for (const issue of revenueResult.issues) {
    pushAlert({
      id: `over-receipt:${issue.projectId}`, type: 'over_receipt', severity: 'warning',
      title: '收款超过合同额', reason: '含税未收已夹紧为零，超收金额需核对。', count: 1,
      amount: issue.excessTaxInclusiveAmount, targetView: 'contractRevenue',
      recordRef: issue.projectId,
    }, access.contracts.amounts, access.contracts.amounts, access.contracts.view)
  }
  for (const issue of sourceIssueRows) {
    pushAlert({
      id: `source:${issue.source}`, type: 'source_issue', severity: 'info',
      title: '数据源状态提示', reason: issue.message || `${issue.source}数据暂不可用`,
      count: 1, amount: null, targetView: null, recordRef: '',
    }, false, false, false)
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

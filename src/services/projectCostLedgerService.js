import { normalizeLedgerSnapshot } from '../features/project-cost-ledger/projectCostLedgerDomain.js'
import { toSignedFourDecimalUnits } from '../features/cost-accounting/fixedPointCurrency.js'

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const PAGE_SIZES = new Set([20, 50, 100])
const SOURCE_MODULES = new Set(['', 'all', 'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual'])
const STRICT_INSTANT_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const FILTER_FIELDS = ['projectId', 'dateFrom', 'dateTo', 'category', 'sourceModule', 'adjusted', 'keyword', 'page', 'pageSize']
const AUDIT_FILTER_FIELDS = ['projectId', 'dateFrom', 'dateTo']
const ADJUST_FIELDS = ['sourceKey', 'expectedVersion', 'adjustmentAmount', 'reason']
const ALLOCATION_REQUEST_FIELDS = ['sourceKey', 'expectedVersion', 'reason', 'allocations']
const ALLOCATION_FIELDS = ['projectId', 'amount']
const MANUAL_REQUEST_FIELDS = ['requestId', 'entry']
const MANUAL_ENTRY_FIELDS = ['projectId', 'category', 'date', 'amount', 'description', 'operator', 'reason']

const SAFE_MESSAGES = Object.freeze({
  PROJECT_COST_LEDGER_INPUT_INVALID: '请检查项目成本输入后重试',
  PROJECT_COST_LEDGER_ACCESS_DENIED: '您没有操作项目成本的权限',
  PROJECT_COST_LEDGER_VERSION_CONFLICT: '记录已被修改，请刷新后重试',
  PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED: '项目分摊合计必须与当前成本一致',
  PROJECT_COST_LEDGER_SOURCE_MISSING: '原始费用记录已不可用，请刷新后重试',
  AUTH_SESSION_INVALID: '登录已失效，请重新登录',
  PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE: '项目成本服务暂时不可用，请稍后重试',
})

const TRUSTED_HINTS = new Map([
  ['PROJECT_COST_LEDGER_INPUT_INVALID', '22023'],
  ['PROJECT_COST_LEDGER_ACCESS_DENIED', '42501'],
  ['PROJECT_COST_LEDGER_VERSION_CONFLICT', 'P0001'],
  ['PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED', '22023'],
  ['PROJECT_COST_LEDGER_SOURCE_MISSING', '22023'],
])

export class ProjectCostLedgerServiceError extends Error {
  constructor(code, { authInvalid = false } = {}) {
    super(SAFE_MESSAGES[code] ?? SAFE_MESSAGES.PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE)
    this.name = 'ProjectCostLedgerServiceError'
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : 'PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE'
    this.authInvalid = authInvalid
  }
}

export function projectCostLedgerError(code, options) {
  return new ProjectCostLedgerServiceError(code, options)
}

function ownDataValue(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function objectFields(value, allowedFields) {
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length !== 0) throw inputError()
  const allowed = new Set(allowedFields)
  const result = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!allowed.has(key) || POLLUTION_KEYS.has(key) || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw inputError()
    }
    result[key] = descriptor.value
  }
  return result
}

function exactObject(value, fields) {
  const result = objectFields(value, fields)
  if (Object.keys(result).length !== fields.length) throw unavailableError()
  return result
}

function inputExactObject(value, fields) {
  const result = objectFields(value, fields)
  if (Object.keys(result).length !== fields.length) throw inputError()
  return result
}

function exactArray(value, { input = false, maximum = 10_000 } = {}) {
  const fail = input ? inputError : unavailableError
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length !== 0) throw fail()
  const length = ownDataValue(value, 'length')
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || Object.getOwnPropertyNames(value).length !== length + 1) throw fail()
  const result = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw fail()
    result[index] = descriptor.value
  }
  return result
}

function inputError() {
  return projectCostLedgerError('PROJECT_COST_LEDGER_INPUT_INVALID')
}

function unavailableError() {
  return projectCostLedgerError('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE')
}

function text(value, maximum, { empty = false, input = true } = {}) {
  const fail = input ? inputError : unavailableError
  if (typeof value !== 'string' || value.trim() !== value || value.length > maximum || (!empty && value.length === 0) || POLLUTION_KEYS.has(value)) throw fail()
  return value
}

function validDate(value, { input = true } = {}) {
  const fail = input ? inputError : unavailableError
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) throw fail()
  const [year, month, day] = value.split('-').map(Number)
  const instant = new Date(Date.UTC(year, month - 1, day))
  if (instant.getUTCFullYear() !== year || instant.getUTCMonth() !== month - 1 || instant.getUTCDate() !== day) throw fail()
  return value
}

function validInstant(value) {
  if (typeof value !== 'string' || !STRICT_INSTANT_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw unavailableError()
  validDate(value.slice(0, 10), { input: false })
  return value
}

function money(value, { nonzero = false, input = true } = {}) {
  const fail = input ? inputError : unavailableError
  const units = toSignedFourDecimalUnits(value)
  if (units === null || (nonzero && units === 0)) throw fail()
  return value
}

function positiveInteger(value, { input = true, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  const fail = input ? inputError : unavailableError
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw fail()
  return value
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

function normalizeFilters(value = {}, audit = false) {
  const source = objectFields(value, audit ? AUDIT_FILTER_FIELDS : FILTER_FIELDS)
  const result = {}
  for (const key of ['projectId', 'category', 'sourceModule']) {
    if (Object.hasOwn(source, key)) result[key] = text(source[key], key === 'projectId' ? 500 : 100, { empty: true })
  }
  if (Object.hasOwn(result, 'sourceModule') && !SOURCE_MODULES.has(result.sourceModule)) throw inputError()
  for (const key of ['dateFrom', 'dateTo']) {
    if (Object.hasOwn(source, key)) result[key] = source[key] === '' ? '' : validDate(source[key])
  }
  if (result.dateFrom && result.dateTo && result.dateFrom > result.dateTo) throw inputError()
  if (Object.hasOwn(source, 'adjusted')) {
    if (!['all', 'adjusted', 'unadjusted'].includes(source.adjusted)) throw inputError()
    result.adjusted = source.adjusted
  }
  if (Object.hasOwn(source, 'keyword')) result.keyword = text(source.keyword, 200, { empty: true })
  if (Object.hasOwn(source, 'page')) result.page = positiveInteger(source.page, { maximum: 1_000_000 })
  if (Object.hasOwn(source, 'pageSize')) {
    if (!PAGE_SIZES.has(source.pageSize)) throw inputError()
    result.pageSize = source.pageSize
  }
  return result
}

function normalizeAllocation(value, { input = true, nonzero = false } = {}) {
  const source = input ? inputExactObject(value, ALLOCATION_FIELDS) : exactObject(value, ALLOCATION_FIELDS)
  return { projectId: text(source.projectId, 500, { input }), amount: money(source.amount, { input, nonzero }) }
}

export function normalizeProjectCostLedgerListFilters(value = {}) {
  return normalizeFilters(value, false)
}

export function normalizeProjectCostLedgerAuditFilters(value = {}) {
  return normalizeFilters(value, true)
}

export function normalizeProjectCostAdjustmentRequest(value) {
  const source = inputExactObject(value, ADJUST_FIELDS)
  return {
    sourceKey: text(source.sourceKey, 600), expectedVersion: positiveInteger(source.expectedVersion),
    adjustmentAmount: money(source.adjustmentAmount, { nonzero: true }), reason: text(source.reason, 2000),
  }
}

export function normalizeProjectCostAllocationRequest(value) {
  const source = inputExactObject(value, ALLOCATION_REQUEST_FIELDS)
  const allocations = exactArray(source.allocations, { input: true, maximum: 100 }).map((item) => normalizeAllocation(item, { input: true, nonzero: true }))
  if (allocations.length === 0 || new Set(allocations.map(({ projectId }) => projectId)).size !== allocations.length) throw inputError()
  return {
    sourceKey: text(source.sourceKey, 600), expectedVersion: positiveInteger(source.expectedVersion),
    reason: text(source.reason, 2000), allocations,
  }
}

export function normalizeProjectCostManualRequest(value) {
  const source = inputExactObject(value, MANUAL_REQUEST_FIELDS)
  if (typeof source.requestId !== 'string' || !UUID_PATTERN.test(source.requestId) || source.requestId !== source.requestId.toLowerCase()) throw inputError()
  const entry = inputExactObject(source.entry, MANUAL_ENTRY_FIELDS)
  return {
    requestId: source.requestId,
    entry: {
      projectId: text(entry.projectId, 500), category: text(entry.category, 100), date: validDate(entry.date),
      amount: money(entry.amount, { nonzero: true }), description: text(entry.description, 2000),
      operator: text(entry.operator, 500), reason: text(entry.reason, 2000),
    },
  }
}

function normalizeAdjustmentResponse(value) {
  const source = exactObject(value, ['sourceKey', 'version', 'effectiveAmount'])
  return deepFreeze({ sourceKey: text(source.sourceKey, 600, { input: false }), version: positiveInteger(source.version, { input: false }), effectiveAmount: money(source.effectiveAmount, { input: false }) })
}

function normalizeAllocationResponse(value) {
  const source = exactObject(value, ['sourceKey', 'version', 'allocations'])
  const allocations = exactArray(source.allocations, { maximum: 100 }).map((item) => normalizeAllocation(item, { input: false, nonzero: true }))
  if (allocations.length === 0 || new Set(allocations.map(({ projectId }) => projectId)).size !== allocations.length) throw unavailableError()
  return deepFreeze({ sourceKey: text(source.sourceKey, 600, { input: false }), version: positiveInteger(source.version, { input: false }), allocations })
}

function normalizeManualResponse(value) {
  const source = exactObject(value, ['sourceKey', 'projectId', 'category', 'date', 'amount', 'description', 'operator', 'reason', 'actorName', 'createdAt'])
  return deepFreeze({
    sourceKey: text(source.sourceKey, 600, { input: false }), projectId: text(source.projectId, 500, { input: false }),
    category: text(source.category, 100, { input: false }), date: validDate(source.date, { input: false }), amount: money(source.amount, { input: false }),
    description: text(source.description, 2000, { input: false }), operator: text(source.operator, 500, { input: false }),
    reason: text(source.reason, 2000, { input: false }), actorName: text(source.actorName, 500, { input: false }), createdAt: validInstant(source.createdAt),
  })
}

function normalizeAuditAllocations(value, { required = false, allowSingleZero = false } = {}) {
  if (value === null) return null
  const allocations = exactArray(value, { maximum: 100 }).map((item) => normalizeAllocation(item, { input: false, nonzero: !allowSingleZero }))
  if ((required && allocations.length === 0) || new Set(allocations.map(({ projectId }) => projectId)).size !== allocations.length) throw unavailableError()
  if (allowSingleZero && allocations.some(({ amount }) => amount === 0) &&
      !(allocations.length === 1 && allocations[0].amount === 0)) throw unavailableError()
  return allocations
}

function moneyUnits(value) {
  const units = toSignedFourDecimalUnits(value)
  if (units === null) throw unavailableError()
  return BigInt(units)
}

function normalizeAuditResponse(value) {
  const source = exactObject(value, ['status', 'generatedAt', 'events'])
  if (source.status !== 'ready') throw unavailableError()
  const events = exactArray(source.events).map((candidate) => {
    const event = exactObject(candidate, ['eventType', 'sourceKey', 'sequenceNo', 'amountBefore', 'amountAfter', 'adjustmentAmount', 'allocationsBefore', 'allocationsAfter', 'reason', 'actorName', 'createdAt'])
    if (!['adjustment', 'allocation'].includes(event.eventType)) throw unavailableError()
    const amountBefore = money(event.amountBefore, { input: false })
    const amountAfter = money(event.amountAfter, { input: false })
    const adjustmentAmount = money(event.adjustmentAmount, { input: false })
    const allocationsBefore = normalizeAuditAllocations(event.allocationsBefore, { required: event.eventType === 'allocation', allowSingleZero: event.eventType === 'allocation' })
    const allocationsAfter = normalizeAuditAllocations(event.allocationsAfter, { required: event.eventType === 'allocation' })
    if (event.eventType === 'adjustment') {
      if (allocationsBefore !== null || allocationsAfter !== null || moneyUnits(amountBefore) + moneyUnits(adjustmentAmount) !== moneyUnits(amountAfter)) throw unavailableError()
    } else {
      if (allocationsBefore === null || allocationsAfter === null || adjustmentAmount !== 0 || amountBefore !== amountAfter) throw unavailableError()
      const hasDefaultZeroBefore = allocationsBefore.length === 1 && moneyUnits(allocationsBefore[0].amount) === 0n
      if (hasDefaultZeroBefore && moneyUnits(amountBefore) !== 0n) throw unavailableError()
      const currentTotal = allocationsAfter.reduce((sum, allocation) => sum + moneyUnits(allocation.amount), 0n)
      if (currentTotal !== moneyUnits(amountBefore)) throw unavailableError()
    }
    return {
      eventType: event.eventType, sourceKey: text(event.sourceKey, 600, { input: false }), sequenceNo: positiveInteger(event.sequenceNo, { input: false }),
      amountBefore, amountAfter, adjustmentAmount, allocationsBefore, allocationsAfter,
      reason: text(event.reason, 2000, { input: false }), actorName: text(event.actorName, 500, { input: false }), createdAt: validInstant(event.createdAt),
    }
  })
  return deepFreeze({ status: 'ready', generatedAt: validInstant(source.generatedAt), events })
}

function safeRemoteError(error, responseStatus) {
  try {
    const codeValue = ownDataValue(error, 'code')
    const code = typeof codeValue === 'string' && codeValue.length <= 32 ? codeValue.toUpperCase() : ''
    const ownStatus = ownDataValue(error, 'status')
    const status = responseStatus ?? ownStatus
    if (status === 401 || status === '401' || ['PGRST301', 'JWT_EXPIRED'].includes(code)) {
      return projectCostLedgerError('AUTH_SESSION_INVALID', { authInvalid: true })
    }
    const hint = ownDataValue(error, 'hint')
    if (typeof hint === 'string' && TRUSTED_HINTS.get(hint) === code) return projectCostLedgerError(hint)
  } catch {
    return unavailableError()
  }
  return unavailableError()
}

function responseParts(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw unavailableError()
  const data = Object.getOwnPropertyDescriptor(value, 'data')
  const error = Object.getOwnPropertyDescriptor(value, 'error')
  const status = Object.getOwnPropertyDescriptor(value, 'status')
  if (!data || !Object.hasOwn(data, 'value') || !error || !Object.hasOwn(error, 'value') || (status && !Object.hasOwn(status, 'value'))) throw unavailableError()
  return { data: data.value, error: error.value, status: status?.value }
}

function normalizeListResponse(value) {
  const snapshot = normalizeLedgerSnapshot(value)
  validInstant(snapshot.generatedAt)
  return snapshot
}

export const projectCostLedgerResponseNormalizers = Object.freeze({
  list: normalizeListResponse,
  listAudit: normalizeAuditResponse,
  adjust: normalizeAdjustmentResponse,
  replaceAllocations: normalizeAllocationResponse,
  createManual: normalizeManualResponse,
})

export function createProjectCostLedgerService(client, { configured } = {}) {
  async function rpc(name, params, normalize) {
    if (configured !== true || !client) throw unavailableError()
    let raw
    try {
      const rpcMethod = client.rpc
      if (typeof rpcMethod !== 'function') throw unavailableError()
      raw = await Reflect.apply(rpcMethod, client, [name, params])
    } catch (error) {
      throw safeRemoteError(error)
    }
    let response
    try {
      response = responseParts(raw)
    } catch {
      throw unavailableError()
    }
    if (response.error !== null) throw safeRemoteError(response.error, response.status)
    try {
      return normalize(response.data)
    } catch {
      throw unavailableError()
    }
  }

  return Object.freeze({
    async list(filters = {}) {
      const value = normalizeProjectCostLedgerListFilters(filters)
      const result = await rpc('list_project_cost_ledger_secure', { p_filters: value }, projectCostLedgerResponseNormalizers.list)
      if (result.page !== (value.page ?? 1) || result.pageSize !== (value.pageSize ?? 20)) throw unavailableError()
      return result
    },
    async listAudit(filters = {}) {
      return rpc('list_project_cost_audit_secure', { p_filters: normalizeProjectCostLedgerAuditFilters(filters) }, projectCostLedgerResponseNormalizers.listAudit)
    },
    async adjust(request) {
      const value = normalizeProjectCostAdjustmentRequest(request)
      const result = await rpc('create_project_cost_adjustment_secure', { p_source_key: value.sourceKey, p_expected_version: value.expectedVersion, p_adjustment_amount: value.adjustmentAmount, p_reason: value.reason }, projectCostLedgerResponseNormalizers.adjust)
      if (result.sourceKey !== value.sourceKey || result.version !== value.expectedVersion + 1) throw unavailableError()
      return result
    },
    async replaceAllocations(request) {
      const value = normalizeProjectCostAllocationRequest(request)
      const result = await rpc('replace_project_cost_allocations_secure', { p_source_key: value.sourceKey, p_expected_version: value.expectedVersion, p_reason: value.reason, p_allocations: value.allocations }, projectCostLedgerResponseNormalizers.replaceAllocations)
      if (result.sourceKey !== value.sourceKey || result.version !== value.expectedVersion + 1 || JSON.stringify(result.allocations) !== JSON.stringify(value.allocations)) throw unavailableError()
      return result
    },
    async createManual(request) {
      const value = normalizeProjectCostManualRequest(request)
      const result = await rpc('create_manual_project_cost_secure', { p_request_id: value.requestId, p_entry: value.entry }, projectCostLedgerResponseNormalizers.createManual)
      if (result.sourceKey !== `manual:${value.requestId}` || ['projectId', 'category', 'date', 'amount', 'description', 'operator', 'reason'].some((key) => result[key] !== value.entry[key])) throw unavailableError()
      return result
    },
  })
}

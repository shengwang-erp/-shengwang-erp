import {
  normalizeIssueDate,
  normalizeProjectIds,
  normalizeSettlement,
  normalizeSettlementCandidate,
  normalizeSettlementMonth,
} from '../features/miraisya/miraisyaSettlementDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u
const SAFE_MESSAGES = Object.freeze({
  inputInvalid: '请检查月度结算内容后重试',
  accessDenied: '只有社长或财务部可以操作未来社月度结算',
  versionConflict: '月度结算已被其他人修改，请刷新后重试',
  incompleteCost: '项目成本尚未完整，不能冻结月度结算',
  projectAlreadySettled: '所选项目已包含在其他有效结算中，请刷新后重试',
  authInvalid: '登录已失效，请重新登录',
  notConfigured: '云端数据服务未配置',
  unavailable: '未来社月度结算服务暂时不可用，请稍后重试',
})

export class MiraisyaSettlementServiceError extends Error {
  constructor(code, { authInvalid = false } = {}) {
    super(SAFE_MESSAGES[code] || SAFE_MESSAGES.unavailable)
    this.name = 'MiraisyaSettlementServiceError'
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : 'unavailable'
    this.authInvalid = authInvalid
  }
}

function fail(code, options) {
  return new MiraisyaSettlementServiceError(code, options)
}

function ownValue(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function denseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) throw fail('unavailable')
  const length = ownValue(value, 'length')
  if (!Number.isSafeInteger(length) || length < 0 || length > 500 ||
      Object.getOwnPropertyNames(value).length !== length + 1) throw fail('unavailable')
  const result = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw fail('unavailable')
    result[index] = descriptor.value
  }
  return result
}

function settlementId(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw fail('inputInvalid')
  return value
}

function expectedVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw fail('inputInvalid')
  return value
}

function reason(value) {
  if (typeof value !== 'string') throw fail('inputInvalid')
  const normalized = value.trim()
  if (!normalized || normalized.length > 1000) throw fail('inputInvalid')
  return normalized
}

function input(action) {
  try {
    return action()
  } catch (error) {
    if (error instanceof MiraisyaSettlementServiceError) throw error
    throw fail('inputInvalid')
  }
}

function exactInputObject(value, fields) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Object.getOwnPropertySymbols(value).length !== 0) throw fail('inputInvalid')
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== fields.length) throw fail('inputInvalid')
  const expected = new Set(fields)
  const result = {}
  for (const key of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!expected.has(key) || descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw fail('inputInvalid')
    }
    result[key] = descriptor.value
  }
  return result
}

function remoteError(error, responseStatus) {
  const code = ownValue(error, 'code')
  const status = responseStatus ?? ownValue(error, 'status')
  const hint = ownValue(error, 'hint')
  if (status === 401 || status === '401' || code === 'PGRST301' || code === 'JWT_EXPIRED') {
    return fail('authInvalid', { authInvalid: true })
  }
  const trusted = new Map([
    ['MIRAISYA_SETTLEMENT_ACCESS_DENIED', ['42501', 'accessDenied']],
    ['MIRAISYA_SETTLEMENT_VERSION_CONFLICT', ['P0001', 'versionConflict']],
    ['MIRAISYA_SETTLEMENT_COST_INCOMPLETE', ['22023', 'incompleteCost']],
    ['MIRAISYA_SETTLEMENT_PROJECT_DUPLICATE', ['23505', 'projectAlreadySettled']],
  ])
  const mapping = trusted.get(hint)
  return mapping && mapping[0] === code ? fail(mapping[1]) : fail('unavailable')
}

function envelope(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw fail('unavailable')
  const data = Object.getOwnPropertyDescriptor(value, 'data')
  const error = Object.getOwnPropertyDescriptor(value, 'error')
  const status = Object.getOwnPropertyDescriptor(value, 'status')
  if (!data || !Object.hasOwn(data, 'value') || !error || !Object.hasOwn(error, 'value') ||
      (status && !Object.hasOwn(status, 'value'))) throw fail('unavailable')
  return { data: data.value, error: error.value, status: status?.value }
}

function normalizeResponse(value) {
  try {
    return normalizeSettlement(value)
  } catch {
    throw fail('unavailable')
  }
}

export function createMiraisyaSettlementService(
  client = supabase,
  { configured = isSupabaseConfigured } = {},
) {
  async function call(name, args, normalizer = normalizeResponse) {
    if (!configured || !client || typeof client.rpc !== 'function') throw fail('notConfigured')
    let raw
    try {
      raw = await client.rpc(name, args)
    } catch (error) {
      throw remoteError(error)
    }
    const result = envelope(raw)
    if (result.error) throw remoteError(result.error, result.status)
    return normalizer(result.data)
  }

  return Object.freeze({
    async listCandidates(value) {
      const month = input(() => normalizeSettlementMonth(value))
      return call('list_miraisya_settlement_candidates_secure', { p_month: month }, (data) => {
        try {
          return Object.freeze(denseArray(data).map((candidate) =>
            normalizeSettlementCandidate(candidate, month)))
        } catch (error) {
          if (error instanceof MiraisyaSettlementServiceError) throw error
          throw fail('unavailable')
        }
      })
    },
    async list(value) {
      const month = input(() => normalizeSettlementMonth(value))
      return call('list_miraisya_settlements_secure', { p_month: month }, (data) => {
        try {
          return Object.freeze(denseArray(data).map(normalizeSettlement))
        } catch (error) {
          if (error instanceof MiraisyaSettlementServiceError) throw error
          throw fail('unavailable')
        }
      })
    },
    async get(value) {
      const id = settlementId(value)
      return call('get_miraisya_settlement_secure', { p_settlement_id: id })
    },
    async createDraft(value) {
      const request = exactInputObject(value, ['month', 'issueDate', 'projectIds'])
      const normalized = input(() => ({
        month: normalizeSettlementMonth(request.month),
        issueDate: normalizeIssueDate(request.issueDate),
        projectIds: normalizeProjectIds(request.projectIds),
      }))
      return call('create_miraisya_settlement_draft_secure', {
        p_month: normalized.month,
        p_issue_date: normalized.issueDate,
        p_project_ids: normalized.projectIds,
      })
    },
    async confirm(value) {
      const request = exactInputObject(value, ['settlementId', 'expectedVersion'])
      return call('confirm_miraisya_settlement_secure', {
        p_settlement_id: settlementId(request.settlementId),
        p_expected_version: expectedVersion(request.expectedVersion),
      })
    },
    async void(value) {
      const request = exactInputObject(value, ['settlementId', 'expectedVersion', 'reason'])
      return call('void_miraisya_settlement_secure', {
        p_settlement_id: settlementId(request.settlementId),
        p_expected_version: expectedVersion(request.expectedVersion),
        p_reason: reason(request.reason),
      })
    },
  })
}

export const miraisyaSettlementService = createMiraisyaSettlementService()

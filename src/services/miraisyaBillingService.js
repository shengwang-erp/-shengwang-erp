import {
  normalizeBillingItems,
  summarizeBillingItems,
} from '../features/miraisya/miraisyaBillingDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const RESPONSE_FIELDS = Object.freeze([
  'projectId', 'version', 'items', 'taxExclusiveAmount', 'taxAmount',
  'taxInclusiveAmount', 'updatedAt',
])

const SAFE_MESSAGES = Object.freeze({
  inputInvalid: '请检查未来社收费明细后重试',
  versionConflict: '收费明细已被其他人修改，请刷新后重试',
  accessDenied: '您没有编辑未来社收费明细的权限',
  authInvalid: '登录已失效，请重新登录',
  notConfigured: '云端数据服务未配置',
  unavailable: '未来社收费服务暂时不可用，请稍后重试',
})

export class MiraisyaBillingServiceError extends Error {
  constructor(code, { authInvalid = false } = {}) {
    super(SAFE_MESSAGES[code] || SAFE_MESSAGES.unavailable)
    this.name = 'MiraisyaBillingServiceError'
    this.code = Object.hasOwn(SAFE_MESSAGES, code) ? code : 'unavailable'
    this.authInvalid = authInvalid
  }
}

function fail(code, options) {
  return new MiraisyaBillingServiceError(code, options)
}

function descriptors(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw fail('unavailable')
  }
  const result = Object.getOwnPropertyDescriptors(value)
  if (Reflect.ownKeys(result).some((key) => typeof key !== 'string')) throw fail('unavailable')
  return result
}

function exactResponse(value) {
  const fields = descriptors(value)
  const keys = Object.keys(fields)
  if (keys.length !== RESPONSE_FIELDS.length || keys.some((key) => !RESPONSE_FIELDS.includes(key)) ||
      RESPONSE_FIELDS.some((key) => fields[key]?.enumerable !== true || !Object.hasOwn(fields[key], 'value'))) {
    throw fail('unavailable')
  }
  const data = Object.fromEntries(RESPONSE_FIELDS.map((key) => [key, fields[key].value]))
  if (typeof data.projectId !== 'string' || !data.projectId.trim() ||
      !Number.isSafeInteger(data.version) || data.version < 1 ||
      typeof data.updatedAt !== 'string' || !Number.isFinite(Date.parse(data.updatedAt))) {
    throw fail('unavailable')
  }
  let items
  let totals
  try {
    items = normalizeBillingItems(data.items)
    totals = summarizeBillingItems(items)
  } catch {
    throw fail('unavailable')
  }
  for (const key of ['taxExclusiveAmount', 'taxAmount', 'taxInclusiveAmount']) {
    if (data[key] !== totals[key]) throw fail('unavailable')
  }
  const result = { ...data, items }
  Object.freeze(result.items)
  return Object.freeze(result)
}

function projectId(value) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > 500) {
    throw fail('inputInvalid')
  }
  return value
}

function replaceRequest(value) {
  let fields
  try {
    fields = descriptors(value)
  } catch {
    throw fail('inputInvalid')
  }
  const expected = ['projectId', 'expectedVersion', 'items']
  const keys = Object.keys(fields)
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)) ||
      expected.some((key) => fields[key]?.enumerable !== true || !Object.hasOwn(fields[key], 'value'))) {
    throw fail('inputInvalid')
  }
  if (!Number.isSafeInteger(fields.expectedVersion.value) || fields.expectedVersion.value < 1) {
    throw fail('inputInvalid')
  }
  let items
  try {
    items = normalizeBillingItems(fields.items.value, { allowEmpty: false })
  } catch {
    throw fail('inputInvalid')
  }
  return {
    projectId: projectId(fields.projectId.value),
    expectedVersion: fields.expectedVersion.value,
    items,
  }
}

function ownValue(value, key) {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function remoteError(error, status) {
  const code = ownValue(error, 'code')
  const hint = ownValue(error, 'hint')
  const remoteStatus = status ?? ownValue(error, 'status')
  if (remoteStatus === 401 || remoteStatus === '401' || code === 'PGRST301' || code === 'JWT_EXPIRED') {
    return fail('authInvalid', { authInvalid: true })
  }
  if (remoteStatus === 400 && code === 'P0001' && hint === 'MIRAISYA_BILLING_VERSION_CONFLICT') {
    return fail('versionConflict')
  }
  if (remoteStatus === 403 && code === '42501' && hint === 'MIRAISYA_BILLING_ACCESS_DENIED') {
    return fail('accessDenied')
  }
  return fail('unavailable')
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

export function createMiraisyaBillingService(
  client = supabase,
  { configured = isSupabaseConfigured } = {},
) {
  async function call(name, args) {
    if (!configured || !client || typeof client.rpc !== 'function') throw fail('notConfigured')
    let raw
    try {
      raw = await client.rpc(name, args)
    } catch (error) {
      throw remoteError(error)
    }
    const result = envelope(raw)
    if (result.error) throw remoteError(result.error, result.status)
    return exactResponse(result.data)
  }

  return Object.freeze({
    async get(value) {
      return call('get_miraisya_billing_secure', { p_project_id: projectId(value) })
    },
    async replace(value) {
      const request = replaceRequest(value)
      return call('replace_miraisya_billing_secure', {
        p_project_id: request.projectId,
        p_expected_version: request.expectedVersion,
        p_items: request.items,
      })
    },
  })
}

export const miraisyaBillingService = createMiraisyaBillingService()

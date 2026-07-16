import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'
import {
  getList as getBaseList,
  softDelete as softDeleteBaseRecord,
  upsertRecord as upsertBaseRecord,
} from './baseRecordService.js'

const PAYMENT_STORAGE_KEY = 'erp.purchasePaymentRecords'
const CLIENT_AUDIT_FIELDS = new Set([
  'created_by_employee_id',
  'created_by_employee_name',
  'updated_by_employee_id',
  'updated_by_employee_name',
  'createdByEmployeeId',
  'createdByEmployeeName',
  'updatedByEmployeeId',
  'updatedByEmployeeName',
])
const FORBIDDEN_ENVELOPE_STATUSES = new Set(['deleted', 'void'])

const SAFE_ERRORS = Object.freeze({
  ACCESS_DENIED: Object.freeze({ message: '没有权限读取或修改采购数据', status: 403 }),
  AUTH_SESSION_INVALID: Object.freeze({ message: '登录状态无效，请重新登录', status: 401 }),
  CONFIGURATION_ERROR: Object.freeze({ message: '云端采购服务未配置，请联系管理员', status: 503 }),
  PURCHASE_INPUT_INVALID: Object.freeze({ message: '采购数据格式无效', status: 400 }),
  PURCHASE_OPERATION_FAILED: Object.freeze({ message: '采购数据操作失败，请稍后重试', status: 503 }),
  PURCHASE_RESPONSE_INVALID: Object.freeze({ message: '采购数据响应格式无效', status: 503 }),
})

export class PurchaseServiceError extends Error {
  constructor(code) {
    const safe = SAFE_ERRORS[code] || SAFE_ERRORS.PURCHASE_OPERATION_FAILED
    super(safe.message)
    this.name = 'PurchaseServiceError'
    this.code = SAFE_ERRORS[code] ? code : 'PURCHASE_OPERATION_FAILED'
    this.status = safe.status
  }
}

function fail(code) {
  throw new PurchaseServiceError(code)
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function readOwnData(object, key, { required = true } = {}) {
  if (object === null || (typeof object !== 'object' && typeof object !== 'function')) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (!descriptor) {
    if (required) fail('PURCHASE_RESPONSE_INVALID')
    return undefined
  }
  if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  return descriptor.value
}

function cloneJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('PURCHASE_RESPONSE_INVALID')
    return value
  }
  if (typeof value !== 'object') fail('PURCHASE_RESPONSE_INVALID')
  if (seen.has(value)) fail('PURCHASE_RESPONSE_INVALID')
  seen.add(value)

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('PURCHASE_RESPONSE_INVALID')
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(descriptors).filter((key) => key !== 'length')
    if (
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    ) {
      fail('PURCHASE_RESPONSE_INVALID')
    }
    const cloned = []
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        fail('PURCHASE_RESPONSE_INVALID')
      }
      cloned.push(cloneJson(descriptor.value, seen))
    }
    seen.delete(value)
    return cloned
  }

  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  const cloned = {}
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      fail('PURCHASE_RESPONSE_INVALID')
    }
    Object.defineProperty(cloned, key, {
      configurable: true,
      enumerable: true,
      value: cloneJson(descriptor.value, seen),
      writable: true,
    })
  }
  seen.delete(value)
  return cloned
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function supplierField(error, key) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) {
    return undefined
  }
  const descriptor = Object.getOwnPropertyDescriptor(error, key)
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ? descriptor.value
    : undefined
}

function normalizeSupplierError(error, outerStatus) {
  if (error instanceof PurchaseServiceError) return error
  const status = Number(outerStatus ?? supplierField(error, 'status'))
  const code = String(supplierField(error, 'code') || '').toUpperCase()
  if (status === 401 || ['401', 'PGRST301', 'JWT_EXPIRED'].includes(code)) {
    return new PurchaseServiceError('AUTH_SESSION_INVALID')
  }
  if (status === 403 || code === '42501') {
    return new PurchaseServiceError('ACCESS_DENIED')
  }
  return new PurchaseServiceError('PURCHASE_OPERATION_FAILED')
}

function validatePurchaseId(value, errorCode = 'PURCHASE_INPUT_INVALID') {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail(errorCode)
  return value
}

function cloneMutationPayload(record) {
  let payload
  try {
    payload = cloneJson(record)
  } catch (error) {
    if (error instanceof PurchaseServiceError) fail('PURCHASE_INPUT_INVALID')
    throw error
  }
  if (!isPlainObject(payload)) fail('PURCHASE_INPUT_INVALID')
  validatePurchaseId(payload.purchaseId)
  for (const field of CLIENT_AUDIT_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(payload, field)) fail('PURCHASE_INPUT_INVALID')
  }
  for (const field of ['cloudStatus', 'statusCode']) {
    if (!Object.prototype.hasOwnProperty.call(payload, field)) continue
    const status = String(payload[field]).trim().toLowerCase()
    if (FORBIDDEN_ENVELOPE_STATUSES.has(status)) fail('PURCHASE_INPUT_INVALID')
  }
  return payload
}

function validateEnvelope(row, expectedRecordKey) {
  if (!isPlainObject(row)) fail('PURCHASE_RESPONSE_INVALID')
  const recordKey = readOwnData(row, 'record_key')
  const payloadSource = readOwnData(row, 'payload')
  const status = readOwnData(row, 'status')
  const updatedAt = readOwnData(row, 'updated_at')
  validatePurchaseId(recordKey, 'PURCHASE_RESPONSE_INVALID')
  if (status !== 'active' || typeof updatedAt !== 'string' || !updatedAt.trim()) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  const payload = cloneJson(payloadSource)
  if (!isPlainObject(payload)) fail('PURCHASE_RESPONSE_INVALID')
  const purchaseId = readOwnData(payload, 'purchaseId')
  validatePurchaseId(purchaseId, 'PURCHASE_RESPONSE_INVALID')
  if (recordKey !== purchaseId || (expectedRecordKey && recordKey !== expectedRecordKey)) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  return payload
}

const defaultPaymentAdapter = Object.freeze({
  getList: getBaseList,
  softDelete: softDeleteBaseRecord,
  upsertRecord: upsertBaseRecord,
})

export function createPurchaseService(
  client = supabase,
  { configured = isSupabaseConfigured, paymentAdapter = defaultPaymentAdapter } = {},
) {
  function ensureConfigured() {
    if (!configured || !client || typeof client.rpc !== 'function') {
      fail('CONFIGURATION_ERROR')
    }
  }

  async function call(name, args) {
    ensureConfigured()
    let result
    try {
      result = await client.rpc(name, args)
    } catch (error) {
      throw normalizeSupplierError(error)
    }
    if (!isPlainObject(result)) fail('PURCHASE_RESPONSE_INVALID')
    const data = readOwnData(result, 'data')
    const supplierError = readOwnData(result, 'error')
    const outerStatus = readOwnData(result, 'status', { required: false })
    if (supplierError !== null && supplierError !== undefined) {
      throw normalizeSupplierError(supplierError, outerStatus)
    }
    if ([401, 403].includes(Number(outerStatus))) {
      throw normalizeSupplierError(null, outerStatus)
    }
    if (Number(outerStatus) >= 400) {
      throw new PurchaseServiceError('PURCHASE_OPERATION_FAILED')
    }
    return data
  }

  async function getList() {
    const data = await call('list_purchase_records_secure', {})
    if (!Array.isArray(data) || Object.getPrototypeOf(data) !== Array.prototype) {
      fail('PURCHASE_RESPONSE_INVALID')
    }
    const records = data.map((row) => validateEnvelope(row))
    return deepFreeze(records)
  }

  async function mutate(recordKey, record) {
    const expectedRecordKey = validatePurchaseId(recordKey)
    const payload = cloneMutationPayload(record)
    if (payload.purchaseId !== expectedRecordKey) fail('PURCHASE_INPUT_INVALID')
    const data = await call('upsert_purchase_record_secure', {
      p_record_key: expectedRecordKey,
      p_payload: payload,
      p_status: 'active',
    })
    return deepFreeze(validateEnvelope(data, expectedRecordKey))
  }

  return Object.freeze({
    async getList() {
      return getList()
    },
    async getById(recordKey) {
      const id = validatePurchaseId(recordKey)
      return (await getList()).find((record) => record.purchaseId === id)
    },
    async create(record) {
      const payload = cloneMutationPayload(record)
      return mutate(payload.purchaseId, payload)
    },
    async update(recordKey, record) {
      return mutate(recordKey, record)
    },
    async softDelete(recordKey) {
      const id = validatePurchaseId(recordKey)
      const deletedId = await call('soft_delete_purchase_record_secure', { p_record_key: id })
      if (deletedId !== id) fail('PURCHASE_RESPONSE_INVALID')
      return deletedId
    },
    async getPaymentList() {
      return paymentAdapter.getList(PAYMENT_STORAGE_KEY)
    },
    async upsertPayment(record) {
      return paymentAdapter.upsertRecord(PAYMENT_STORAGE_KEY, record)
    },
    async softDeletePayment(recordKey) {
      return paymentAdapter.softDelete(PAYMENT_STORAGE_KEY, recordKey)
    },
  })
}

export const purchaseService = createPurchaseService()

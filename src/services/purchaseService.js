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
  PURCHASE_HAS_WAREHOUSE_RECEIPTS: Object.freeze({
    message: '该采购已有仓库到货记录，请作废而不要删除', status: 409,
  }),
  PURCHASE_QUANTITY_BELOW_WAREHOUSE_RECEIPTS: Object.freeze({
    message: '采购数量不能低于已提交或已确认的仓库到货数量', status: 409,
  }),
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

function snapshotDenseArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail('PURCHASE_RESPONSE_INVALID')
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  const lengthDescriptor = descriptors.length
  const length = lengthDescriptor && Object.hasOwn(lengthDescriptor, 'value')
    ? lengthDescriptor.value
    : -1
  if (!Number.isSafeInteger(length) || length < 0) {
    fail('PURCHASE_RESPONSE_INVALID')
  }

  const keys = Object.keys(descriptors)
  if (keys.length !== length + 1 || !Object.hasOwn(descriptors, 'length')) {
    fail('PURCHASE_RESPONSE_INVALID')
  }

  const snapshot = new Array(length)
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      fail('PURCHASE_RESPONSE_INVALID')
    }
    snapshot[index] = descriptor.value
  }
  return snapshot
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
  if (
    status === 409 && code === '23503' &&
    supplierField(error, 'hint') === 'PURCHASE_HAS_WAREHOUSE_RECEIPTS'
  ) {
    return new PurchaseServiceError('PURCHASE_HAS_WAREHOUSE_RECEIPTS')
  }
  if (
    status === 400 && code === '23514' &&
    supplierField(error, 'hint') === 'PURCHASE_QUANTITY_BELOW_WAREHOUSE_RECEIPTS'
  ) {
    return new PurchaseServiceError('PURCHASE_QUANTITY_BELOW_WAREHOUSE_RECEIPTS')
  }
  return new PurchaseServiceError('PURCHASE_OPERATION_FAILED')
}

function validatePurchaseId(value, errorCode = 'PURCHASE_INPUT_INVALID') {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail(errorCode)
  return value
}

function cloneBoundMutationPayload(record, idField, expectedRecordKey) {
  let payload
  try {
    payload = cloneJson(record)
  } catch (error) {
    if (error instanceof PurchaseServiceError) fail('PURCHASE_INPUT_INVALID')
    throw error
  }
  if (!isPlainObject(payload)) fail('PURCHASE_INPUT_INVALID')
  const recordKey = validatePurchaseId(payload[idField])
  if (expectedRecordKey && recordKey !== expectedRecordKey) fail('PURCHASE_INPUT_INVALID')
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

function cloneMutationPayload(record) {
  return cloneBoundMutationPayload(record, 'purchaseId')
}

function validateBoundEnvelope(row, idField, expectedRecordKey) {
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
  const payloadRecordKey = readOwnData(payload, idField)
  validatePurchaseId(payloadRecordKey, 'PURCHASE_RESPONSE_INVALID')
  if (recordKey !== payloadRecordKey || (expectedRecordKey && recordKey !== expectedRecordKey)) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  return payload
}

function validateEnvelope(row, expectedRecordKey) {
  return validateBoundEnvelope(row, 'purchaseId', expectedRecordKey)
}

function cloneStockInCommitInput(input) {
  let request
  try {
    request = cloneJson(input)
  } catch (error) {
    if (error instanceof PurchaseServiceError) fail('PURCHASE_INPUT_INVALID')
    throw error
  }
  if (!isPlainObject(request)) fail('PURCHASE_INPUT_INVALID')
  const expectedKeys = [
    'purchaseRecordKey',
    'purchasePatch',
    'stockInRecordKey',
    'stockInPayload',
    'inventoryRecordKey',
    'inventoryPayload',
  ]
  const keys = Object.keys(request)
  if (keys.length !== expectedKeys.length ||
      expectedKeys.some((key) => !Object.hasOwn(request, key))) {
    fail('PURCHASE_INPUT_INVALID')
  }
  const purchaseRecordKey = validatePurchaseId(request.purchaseRecordKey)
  const stockInRecordKey = validatePurchaseId(request.stockInRecordKey)
  const inventoryRecordKey = validatePurchaseId(request.inventoryRecordKey)
  const purchasePatch = cloneBoundMutationPayload(
    request.purchasePatch, 'purchaseId', purchaseRecordKey,
  )
  const stockInPayload = cloneBoundMutationPayload(
    request.stockInPayload, 'stockInId', stockInRecordKey,
  )
  const inventoryPayload = cloneBoundMutationPayload(
    request.inventoryPayload, 'inventoryId', inventoryRecordKey,
  )
  if (stockInPayload.sourcePurchaseId !== purchaseRecordKey) {
    fail('PURCHASE_INPUT_INVALID')
  }
  return {
    purchaseRecordKey,
    purchasePatch,
    stockInRecordKey,
    stockInPayload,
    inventoryRecordKey,
    inventoryPayload,
  }
}

function validateStockInCommitResponse(data, request) {
  if (!isPlainObject(data) || Object.getOwnPropertySymbols(data).length !== 0) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  const descriptors = Object.getOwnPropertyDescriptors(data)
  const expectedKeys = ['purchase', 'stock_in', 'inventory_item']
  if (Object.keys(descriptors).length !== expectedKeys.length ||
      expectedKeys.some((key) => !descriptors[key]?.enumerable ||
        !Object.hasOwn(descriptors[key], 'value'))) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  const stockIn = validateBoundEnvelope(
    descriptors.stock_in.value, 'stockInId', request.stockInRecordKey,
  )
  if (readOwnData(stockIn, 'sourcePurchaseId') !== request.purchaseRecordKey) {
    fail('PURCHASE_RESPONSE_INVALID')
  }
  return deepFreeze({
    purchase: validateBoundEnvelope(
      descriptors.purchase.value, 'purchaseId', request.purchaseRecordKey,
    ),
    stockIn,
    inventoryItem: validateBoundEnvelope(
      descriptors.inventory_item.value, 'inventoryId', request.inventoryRecordKey,
    ),
  })
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
    const rows = snapshotDenseArray(data)
    const records = new Array(rows.length)
    for (let index = 0; index < rows.length; index += 1) {
      records[index] = validateEnvelope(rows[index])
    }
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
    async commitStockIn(input) {
      const request = cloneStockInCommitInput(input)
      const data = await call('commit_purchase_stock_in_secure', {
        p_purchase_record_key: request.purchaseRecordKey,
        p_purchase_patch: request.purchasePatch,
        p_stock_in_record_key: request.stockInRecordKey,
        p_stock_in_payload: request.stockInPayload,
        p_inventory_record_key: request.inventoryRecordKey,
        p_inventory_payload: request.inventoryPayload,
      })
      return validateStockInCommitResponse(data, request)
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

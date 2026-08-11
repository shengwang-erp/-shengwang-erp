import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient.js'
import {
  createWarehouseService,
  WarehouseServiceError,
} from '../../services/warehouseService.js'
import {
  parseQuantityUnits,
  quantityUnitsToNumber,
} from './warehouseDecimal.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u

const ERRORS = Object.freeze({
  PURCHASE_ARRIVAL_INPUT_INVALID: Object.freeze({ message: '采购到货申请数据无效', status: 400 }),
  PURCHASE_ARRIVAL_NOT_CONFIGURED: Object.freeze({ message: '采购到货服务未配置', status: 503 }),
  PURCHASE_ARRIVAL_RESPONSE_INVALID: Object.freeze({ message: '采购到货数据响应无效', status: 503 }),
  PURCHASE_ARRIVAL_FAILED: Object.freeze({ message: '采购到货操作失败，请稍后重试', status: 503 }),
  PURCHASE_ARRIVAL_REMAINDER_EXCEEDED: Object.freeze({ message: '到货数量超过采购剩余数量，请刷新后重试', status: 409 }),
  PURCHASE_ARRIVAL_IDEMPOTENCY_CONFLICT: Object.freeze({ message: '该次提交编号已用于其他到货内容，请刷新后重试', status: 409 }),
  PURCHASE_ARRIVAL_RESOURCE_INACTIVE: Object.freeze({ message: '所选物品型号已停用，请刷新后重新选择', status: 409 }),
  PURCHASE_ARRIVAL_ACCESS_DENIED: Object.freeze({ message: '没有权限提交采购到货', status: 403 }),
})

export class PurchaseWarehouseBridgeError extends Error {
  constructor(code) {
    const selected = ERRORS[code] || ERRORS.PURCHASE_ARRIVAL_FAILED
    super(selected.message)
    this.name = 'PurchaseWarehouseBridgeError'
    this.code = ERRORS[code] ? code : 'PURCHASE_ARRIVAL_FAILED'
    this.status = selected.status
  }
}

function fail(code) {
  return new PurchaseWarehouseBridgeError(code)
}

function ownExact(value, fields, errorCode) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw fail(errorCode)
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    Object.keys(descriptors).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(descriptors, field)) ||
    Object.keys(descriptors).some((field) => !fields.includes(field)) ||
    Object.values(descriptors).some((descriptor) =>
      !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
  ) throw fail(errorCode)
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
}

function denseArray(value, errorCode) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw fail(errorCode)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = descriptors.length?.value
  if (
    !Number.isSafeInteger(length) || length < 0 || length > 10_000 ||
    Object.keys(descriptors).length !== length + 1
  ) throw fail(errorCode)
  const result = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw fail(errorCode)
    }
    result.push(descriptor.value)
  }
  return result
}

function text(value, pattern, errorCode) {
  if (typeof value !== 'string' || value !== value.trim() || !pattern.test(value)) {
    throw fail(errorCode)
  }
  return value
}

function displayText(value, errorCode) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 500) {
    throw fail(errorCode)
  }
  return value
}

function quantity(value, { positive = false } = {}) {
  try {
    const units = parseQuantityUnits(value)
    if ((positive && units <= 0n) || (!positive && units < 0n)) {
      throw fail('PURCHASE_ARRIVAL_INPUT_INVALID')
    }
    return { units, value: quantityUnitsToNumber(units) }
  } catch (error) {
    if (error instanceof PurchaseWarehouseBridgeError) throw error
    throw fail('PURCHASE_ARRIVAL_INPUT_INVALID')
  }
}

function freeze(value) {
  if (Array.isArray(value)) value.forEach(freeze)
  else if (value && typeof value === 'object') Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

function normalizeSubmission(input) {
  const row = ownExact(input, [
    'purchaseRecordKey', 'variantId', 'requestedQuantity', 'idempotencyKey',
  ], 'PURCHASE_ARRIVAL_INPUT_INVALID')
  return {
    purchaseRecordKey: text(row.purchaseRecordKey, RECORD_KEY, 'PURCHASE_ARRIVAL_INPUT_INVALID'),
    variantId: text(row.variantId, UUID, 'PURCHASE_ARRIVAL_INPUT_INVALID').toLowerCase(),
    requestedQuantity: quantity(row.requestedQuantity, { positive: true }).value,
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, 'PURCHASE_ARRIVAL_INPUT_INVALID'),
  }
}

function validateVariant(candidate) {
  const row = ownExact(candidate, [
    'id', 'itemId', 'itemName', 'sku', 'model', 'size', 'material', 'unit',
  ], 'PURCHASE_ARRIVAL_RESPONSE_INVALID')
  return {
    id: text(row.id, UUID, 'PURCHASE_ARRIVAL_RESPONSE_INVALID').toLowerCase(),
    itemId: text(row.itemId, UUID, 'PURCHASE_ARRIVAL_RESPONSE_INVALID').toLowerCase(),
    itemName: displayText(row.itemName, 'PURCHASE_ARRIVAL_RESPONSE_INVALID'),
    sku: displayText(row.sku, 'PURCHASE_ARRIVAL_RESPONSE_INVALID'),
    model: displayText(row.model, 'PURCHASE_ARRIVAL_RESPONSE_INVALID'),
    size: displayText(row.size, 'PURCHASE_ARRIVAL_RESPONSE_INVALID'),
    material: displayText(row.material, 'PURCHASE_ARRIVAL_RESPONSE_INVALID'),
    unit: displayText(row.unit, 'PURCHASE_ARRIVAL_RESPONSE_INVALID'),
  }
}

function responseQuantity(value) {
  try {
    const units = parseQuantityUnits(value)
    if (units < 0n) throw new TypeError()
    return { units, value: quantityUnitsToNumber(units) }
  } catch {
    throw fail('PURCHASE_ARRIVAL_RESPONSE_INVALID')
  }
}

function validatePurchase(candidate) {
  const row = ownExact(candidate, [
    'purchaseRecordKey', 'orderedQuantity', 'pendingQuantity', 'confirmedQuantity',
    'remainingQuantity', 'hasReceipt',
  ], 'PURCHASE_ARRIVAL_RESPONSE_INVALID')
  const ordered = responseQuantity(row.orderedQuantity)
  const pending = responseQuantity(row.pendingQuantity)
  const confirmed = responseQuantity(row.confirmedQuantity)
  const remaining = responseQuantity(row.remainingQuantity)
  if (
    typeof row.hasReceipt !== 'boolean' ||
    remaining.units !== ordered.units - pending.units - confirmed.units ||
    remaining.units < 0n ||
    ((pending.units > 0n || confirmed.units > 0n) && row.hasReceipt !== true)
  ) throw fail('PURCHASE_ARRIVAL_RESPONSE_INVALID')
  return {
    purchaseRecordKey: text(
      row.purchaseRecordKey,
      RECORD_KEY,
      'PURCHASE_ARRIVAL_RESPONSE_INVALID',
    ),
    orderedQuantity: ordered.value,
    pendingQuantity: pending.value,
    confirmedQuantity: confirmed.value,
    remainingQuantity: remaining.value,
    hasReceipt: row.hasReceipt,
  }
}

function validateContext(candidate) {
  const row = ownExact(
    candidate,
    ['variants', 'purchases'],
    'PURCHASE_ARRIVAL_RESPONSE_INVALID',
  )
  const variants = denseArray(row.variants, 'PURCHASE_ARRIVAL_RESPONSE_INVALID')
    .map(validateVariant)
  const purchases = denseArray(row.purchases, 'PURCHASE_ARRIVAL_RESPONSE_INVALID')
    .map(validatePurchase)
  if (
    new Set(variants.map((variant) => variant.id)).size !== variants.length ||
    new Set(purchases.map((purchase) => purchase.purchaseRecordKey)).size !== purchases.length
  ) throw fail('PURCHASE_ARRIVAL_RESPONSE_INVALID')
  return freeze({ variants, purchases })
}

export function createOfflinePurchaseArrivalContext(purchaseRecords = []) {
  const records = Array.isArray(purchaseRecords) ? purchaseRecords : []
  const seen = new Set()
  const purchases = []
  for (const record of records) {
    const purchaseRecordKey = typeof record?.purchaseId === 'string'
      ? record.purchaseId.trim()
      : ''
    if (!RECORD_KEY.test(purchaseRecordKey) || seen.has(purchaseRecordKey)) continue
    try {
      const orderedQuantity = responseQuantity(record.quantity)
      if (orderedQuantity.units <= 0n) continue
      purchases.push({
        purchaseRecordKey,
        orderedQuantity: orderedQuantity.value,
        pendingQuantity: 0,
        confirmedQuantity: 0,
        remainingQuantity: orderedQuantity.value,
        hasReceipt: false,
      })
      seen.add(purchaseRecordKey)
    } catch {
      // Local compatibility records that cannot satisfy the cloud contract stay unavailable.
    }
  }
  return validateContext({ variants: [], purchases })
}

function supplierData(result) {
  if (
    result === null || typeof result !== 'object' || Array.isArray(result) ||
    Object.getPrototypeOf(result) !== Object.prototype
  ) throw fail('PURCHASE_ARRIVAL_RESPONSE_INVALID')
  const descriptors = Object.getOwnPropertyDescriptors(result)
  const allowed = new Set(['data', 'error', 'status', 'statusText', 'count'])
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    !Object.hasOwn(descriptors, 'data') ||
    Object.keys(descriptors).some((key) => !allowed.has(key)) ||
    Object.values(descriptors).some((descriptor) =>
      !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
  ) throw fail('PURCHASE_ARRIVAL_RESPONSE_INVALID')
  const row = Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  )
  const error = Object.hasOwn(row, 'error') ? row.error : null
  const status = Object.hasOwn(row, 'status') ? row.status : undefined
  if (
    error !== null && error !== undefined ||
    status !== undefined && (!Number.isSafeInteger(status) || status < 200 || status >= 300) ||
    Object.hasOwn(row, 'statusText') && row.statusText !== null && typeof row.statusText !== 'string' ||
    Object.hasOwn(row, 'count') && row.count !== null &&
      (!Number.isSafeInteger(row.count) || row.count < 0)
  ) {
    throw fail('PURCHASE_ARRIVAL_FAILED')
  }
  return row.data
}

function mapWarehouseSubmissionError(error) {
  if (!(error instanceof WarehouseServiceError)) return fail('PURCHASE_ARRIVAL_FAILED')
  const mapping = Object.freeze({
    WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED: 'PURCHASE_ARRIVAL_REMAINDER_EXCEEDED',
    WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT: 'PURCHASE_ARRIVAL_IDEMPOTENCY_CONFLICT',
    WAREHOUSE_RESOURCE_INACTIVE: 'PURCHASE_ARRIVAL_RESOURCE_INACTIVE',
    ACCESS_DENIED: 'PURCHASE_ARRIVAL_ACCESS_DENIED',
    WAREHOUSE_WORKFLOW_INPUT_INVALID: 'PURCHASE_ARRIVAL_INPUT_INVALID',
  })
  return fail(mapping[error.code] || 'PURCHASE_ARRIVAL_FAILED')
}

export function resolvePurchaseArrivalStatus(contextStatus, purchaseRecordKey, purchases) {
  if (contextStatus !== 'ready' || !Array.isArray(purchases)) return '状态暂不可用'
  const summary = purchases.find((row) => row.purchaseRecordKey === purchaseRecordKey)
  if (!summary) return '状态暂不可用'
  if (summary.confirmedQuantity >= summary.orderedQuantity) return '已入库'
  if (summary.confirmedQuantity > 0) return '部分入库'
  if (summary.pendingQuantity > 0) return '待仓库确认'
  return '未入库'
}

export function createPurchaseWarehouseBridge({ warehouseService, rpcClient, configured }) {
  if (
    typeof configured !== 'boolean' || (configured && (
      !warehouseService || typeof warehouseService.submitReceipt !== 'function' ||
      !rpcClient || typeof rpcClient.rpc !== 'function'
    ))
  ) throw fail('PURCHASE_ARRIVAL_NOT_CONFIGURED')

  return Object.freeze({
    async submitWarehouseArrival(input) {
      const request = normalizeSubmission(input)
      if (!configured) throw fail('PURCHASE_ARRIVAL_NOT_CONFIGURED')
      try {
        return await warehouseService.submitReceipt({
          purchaseRecordKey: request.purchaseRecordKey,
          idempotencyKey: request.idempotencyKey,
          lines: [{
            variantId: request.variantId,
            requestedQuantity: request.requestedQuantity,
            warehouseId: null,
            locationId: null,
          }],
        })
      } catch (error) {
        if (error instanceof PurchaseWarehouseBridgeError) throw error
        throw mapWarehouseSubmissionError(error)
      }
    },
    async loadArrivalContext() {
      if (!configured) throw fail('PURCHASE_ARRIVAL_NOT_CONFIGURED')
      let result
      try {
        result = await rpcClient.rpc('list_purchase_warehouse_arrivals_secure', {})
      } catch {
        throw fail('PURCHASE_ARRIVAL_FAILED')
      }
      return validateContext(supplierData(result))
    },
  })
}

export const purchaseWarehouseBridge = createPurchaseWarehouseBridge({
  warehouseService: createWarehouseService(supabase, { configured: isSupabaseConfigured }),
  rpcClient: supabase,
  configured: isSupabaseConfigured,
})

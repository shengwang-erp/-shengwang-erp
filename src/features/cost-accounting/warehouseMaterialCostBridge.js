import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient.js'

export const MAX_WAREHOUSE_MATERIAL_COST = 900719925474.0991

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const IDENTIFIER_PATTERN = /^[^\u0000-\u0020\u007f]{1,500}$/u
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function plainDataObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.getOwnPropertySymbols(value).length !== 0) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.getOwnPropertyNames(value).every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value') &&
      !POLLUTION_KEYS.has(key)
  })
}

function dataValue(value, key) {
  if (!plainDataObject(value)) return undefined
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function cloneData(value, ancestors = new WeakSet()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('warehouse material cost is invalid')
    return value
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    throw new TypeError('warehouse material cost is invalid')
  }
  const array = Array.isArray(value)
  if (array ? Object.getPrototypeOf(value) !== Array.prototype : !plainDataObject(value)) {
    throw new TypeError('warehouse material cost is invalid')
  }
  ancestors.add(value)
  try {
    if (array) {
      if (Object.getOwnPropertySymbols(value).length !== 0 ||
          Object.getOwnPropertyNames(value).some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key))) {
        throw new TypeError('warehouse material cost is invalid')
      }
      const output = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new TypeError('warehouse material cost is invalid')
        }
        output.push(cloneData(descriptor.value, ancestors))
      }
      return output
    }
    const output = Object.getPrototypeOf(value) === null ? Object.create(null) : {}
    for (const key of Object.getOwnPropertyNames(value)) {
      output[key] = cloneData(Object.getOwnPropertyDescriptor(value, key).value, ancestors)
    }
    return output
  } finally {
    ancestors.delete(value)
  }
}

function validIdentifier(value) {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value)
}

function validWarehouseAmount(value, sourceType) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) || value === 0 ||
      Math.abs(value) > MAX_WAREHOUSE_MATERIAL_COST ||
      Number(Math.abs(value).toFixed(4)) !== Math.abs(value)) return false
  return sourceType === 'warehouse' ? value > 0 : value < 0
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) deepFreeze(value[key])
    Object.freeze(value)
  }
  return value
}

export function normalizeWarehouseMaterialCost(record) {
  const sourceType = dataValue(record, 'sourceType')
  const sourceDocumentType = dataValue(record, 'sourceDocumentType')
  const sourceDocumentId = dataValue(record, 'sourceDocumentId')
  const costRecordId = dataValue(record, 'costRecordId')
  const projectId = dataValue(record, 'projectId')
  const amount = dataValue(record, 'amount')
  const sourcePurchaseRecordKeys = dataValue(record, 'sourcePurchaseRecordKeys')
  const sourceStockOutIds = dataValue(record, 'sourceStockOutIds')
  const validSource = sourceType === 'warehouse'
    ? ['warehouse_stock_out', 'warehouse_minor_work_order'].includes(sourceDocumentType)
    : sourceType === 'warehouseReversal' && sourceDocumentType === 'warehouse_return'
  const validKey = sourceType === 'warehouseReversal'
    ? costRecordId === `WAREHOUSE-SR:${sourceDocumentId}`
    : sourceDocumentType === 'warehouse_minor_work_order'
      ? costRecordId === `WAREHOUSE-MWO:${sourceDocumentId}`
      : costRecordId === `WAREHOUSE-SO:${sourceDocumentId}`
  if (!plainDataObject(record) || !validSource || !UUID_PATTERN.test(sourceDocumentId || '') ||
      !validKey || !validIdentifier(projectId) || dataValue(record, 'costType') !== '材料费' ||
      !validWarehouseAmount(amount, sourceType) || !Array.isArray(sourcePurchaseRecordKeys) ||
      Object.getPrototypeOf(sourcePurchaseRecordKeys) !== Array.prototype ||
      sourcePurchaseRecordKeys.some((key) => !validIdentifier(key)) ||
      new Set(sourcePurchaseRecordKeys).size !== sourcePurchaseRecordKeys.length ||
      !Array.isArray(sourceStockOutIds) ||
      Object.getPrototypeOf(sourceStockOutIds) !== Array.prototype ||
      sourceStockOutIds.length === 0 ||
      sourceStockOutIds.some((id) => !UUID_PATTERN.test(id)) ||
      new Set(sourceStockOutIds).size !== sourceStockOutIds.length ||
      (sourceDocumentType === 'warehouse_stock_out' && (
        sourceStockOutIds.length !== 1 || sourceStockOutIds[0] !== sourceDocumentId
      ))) {
    throw new TypeError('warehouse material cost is invalid')
  }
  return deepFreeze(cloneData(record))
}

export function bridgeWarehouseMaterialCosts(input) {
  if (!plainDataObject(input) ||
      Object.getOwnPropertyNames(input).length !== 3 ||
      !Object.hasOwn(input, 'purchaseRows') || !Object.hasOwn(input, 'projectCostRecords') ||
      !Object.hasOwn(input, 'trackedPurchaseRecordKeys')) {
    throw new TypeError('warehouse material cost bridge input is invalid')
  }
  const purchaseRows = dataValue(input, 'purchaseRows')
  const projectCostRecords = dataValue(input, 'projectCostRecords')
  const trackedPurchaseRecordKeys = dataValue(input, 'trackedPurchaseRecordKeys')
  if (!Array.isArray(purchaseRows) || !Array.isArray(projectCostRecords) ||
      !Array.isArray(trackedPurchaseRecordKeys) ||
      Object.getPrototypeOf(purchaseRows) !== Array.prototype ||
      Object.getPrototypeOf(projectCostRecords) !== Array.prototype ||
      Object.getPrototypeOf(trackedPurchaseRecordKeys) !== Array.prototype ||
      trackedPurchaseRecordKeys.some((key) => !validIdentifier(key)) ||
      new Set(trackedPurchaseRecordKeys).size !== trackedPurchaseRecordKeys.length) {
    throw new TypeError('warehouse material cost bridge input is invalid')
  }
  const warehouseMaterialCosts = []
  const otherProjectCosts = []
  const trackedPurchaseKeys = new Set(trackedPurchaseRecordKeys)
  for (const record of projectCostRecords) {
    const sourceType = dataValue(record, 'sourceType')
    if (sourceType === 'warehouse' || sourceType === 'warehouseReversal') {
      const normalized = normalizeWarehouseMaterialCost(record)
      warehouseMaterialCosts.push(normalized)
    } else {
      otherProjectCosts.push(deepFreeze(cloneData(record)))
    }
  }
  const directPurchases = purchaseRows
    .map((row) => deepFreeze(cloneData(row)))
    .filter((row) => {
      const key = dataValue(row, 'purchaseId') ?? dataValue(row, 'purchaseRecordKey')
      return !trackedPurchaseKeys.has(key)
    })
  return deepFreeze({
    purchaseRows: directPurchases,
    warehouseMaterialCosts,
    otherProjectCosts,
    trackedPurchaseRecordKeys: [...trackedPurchaseKeys].sort(),
  })
}

const SERVICE_ERRORS = Object.freeze({
  WAREHOUSE_MATERIAL_COST_CONFIGURATION_ERROR: Object.freeze({
    message: '仓库成本服务未配置', status: 503,
  }),
  WAREHOUSE_MATERIAL_COST_ACCESS_DENIED: Object.freeze({
    message: '没有权限读取仓库成本桥接', status: 403,
  }),
  WAREHOUSE_MATERIAL_COST_AUTH_INVALID: Object.freeze({
    message: '登录状态已失效', status: 401,
  }),
  WAREHOUSE_MATERIAL_COST_RESPONSE_INVALID: Object.freeze({
    message: '仓库成本桥接响应无效', status: 503,
  }),
  WAREHOUSE_MATERIAL_COST_OPERATION_FAILED: Object.freeze({
    message: '仓库成本桥接暂不可用', status: 503,
  }),
})

export class WarehouseMaterialCostBridgeError extends Error {
  constructor(code) {
    const safe = SERVICE_ERRORS[code] || SERVICE_ERRORS.WAREHOUSE_MATERIAL_COST_OPERATION_FAILED
    super(safe.message)
    this.name = 'WarehouseMaterialCostBridgeError'
    this.code = SERVICE_ERRORS[code] ? code : 'WAREHOUSE_MATERIAL_COST_OPERATION_FAILED'
    this.status = safe.status
  }
}

function supplierData(error, key) {
  if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(error, key)
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
}

function normalizeContext(data) {
  if (!plainDataObject(data) || Object.getOwnPropertyNames(data).length !== 1 ||
      !Object.hasOwn(data, 'trackedPurchaseRecordKeys')) {
    throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_RESPONSE_INVALID')
  }
  const keys = dataValue(data, 'trackedPurchaseRecordKeys')
  if (!Array.isArray(keys) || Object.getPrototypeOf(keys) !== Array.prototype ||
      Object.getOwnPropertySymbols(keys).length !== 0 ||
      Object.getOwnPropertyNames(keys).some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key)) ||
      keys.some((key) => !validIdentifier(key)) || new Set(keys).size !== keys.length) {
    throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_RESPONSE_INVALID')
  }
  return deepFreeze({ trackedPurchaseRecordKeys: [...keys] })
}

export function createWarehouseMaterialCostBridge(
  client = supabase,
  { configured = isSupabaseConfigured } = {},
) {
  return Object.freeze({
    async loadContext() {
      if (!configured || !client || typeof client.rpc !== 'function') {
        throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_CONFIGURATION_ERROR')
      }
      let result
      try {
        result = await client.rpc('list_warehouse_material_cost_context_secure', {})
      } catch {
        throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_OPERATION_FAILED')
      }
      if (!plainDataObject(result)) {
        throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_RESPONSE_INVALID')
      }
      const error = supplierData(result, 'error')
      const status = supplierData(result, 'status')
      if (error !== null && error !== undefined) {
        const code = supplierData(error, 'code')
        if (code === 'PGRST301' || status === 401) {
          throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_AUTH_INVALID')
        }
        if (code === '42501' || status === 403) {
          throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_ACCESS_DENIED')
        }
        throw new WarehouseMaterialCostBridgeError('WAREHOUSE_MATERIAL_COST_OPERATION_FAILED')
      }
      if (status !== undefined && (!Number.isInteger(status) || status < 200 || status >= 300)) {
        throw new WarehouseMaterialCostBridgeError(
          status === 401
            ? 'WAREHOUSE_MATERIAL_COST_AUTH_INVALID'
            : status === 403
            ? 'WAREHOUSE_MATERIAL_COST_ACCESS_DENIED'
            : 'WAREHOUSE_MATERIAL_COST_OPERATION_FAILED',
        )
      }
      return normalizeContext(supplierData(result, 'data'))
    },
  })
}

export const warehouseMaterialCostBridge = createWarehouseMaterialCostBridge()

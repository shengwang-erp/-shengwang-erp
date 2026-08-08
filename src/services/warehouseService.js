import { MOVEMENT_TYPES } from '../features/warehouse/warehouseConstants.js'
import {
  costUnitsToNumber,
  deriveStockValueUnits,
  parseCostUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from '../features/warehouse/warehouseDecimal.js'
import {
  buildWarehouseItemMutation,
  buildWarehouseLocationMutation,
  buildWarehouseSiteMutation,
  buildWarehouseVariantMutation,
} from '../features/warehouse/warehouseCatalogPersistence.js'

const SAFE_ERRORS = Object.freeze({
  WAREHOUSE_NOT_CONFIGURED: Object.freeze({
    message: '云端仓库服务未配置，请联系管理员',
    status: 503,
  }),
  AUTH_SESSION_INVALID: Object.freeze({
    message: '登录状态无效，请重新登录',
    status: 401,
  }),
  ACCESS_DENIED: Object.freeze({
    message: '没有权限查看仓库数据',
    status: 403,
  }),
  WAREHOUSE_INVALID_FILTER: Object.freeze({
    message: '仓库筛选条件无效',
    status: 400,
  }),
  WAREHOUSE_INVALID_RESPONSE: Object.freeze({
    message: '仓库服务返回了无效数据',
    status: 502,
  }),
  WAREHOUSE_SERVICE_UNAVAILABLE: Object.freeze({
    message: '仓库服务暂不可用，请稍后重试',
    status: 503,
  }),
  WAREHOUSE_CATALOG_INPUT_INVALID: Object.freeze({
    message: '仓库资料输入无效，请检查后重试',
    status: 400,
  }),
  WAREHOUSE_CATALOG_ID_MISMATCH: Object.freeze({
    message: '仓库资料编号不一致，请刷新后重试',
    status: 400,
  }),
  WAREHOUSE_CATALOG_CONFLICT: Object.freeze({
    message: '仓库资料编号、货号或二维码已被使用',
    status: 409,
  }),
  WAREHOUSE_CATALOG_RELATION_INVALID: Object.freeze({
    message: '关联的仓库资料无效或已停用',
    status: 409,
  }),
  WAREHOUSE_SITE_IN_USE: Object.freeze({
    message: '请先停用该仓库下的全部货架区',
    status: 409,
  }),
  WAREHOUSE_LOCATION_HAS_STOCK: Object.freeze({
    message: '该货架区仍有库存，不能停用',
    status: 409,
  }),
  WAREHOUSE_ITEM_IN_USE: Object.freeze({
    message: '请先停用该物品下的全部型号',
    status: 409,
  }),
  WAREHOUSE_VARIANT_HAS_STOCK: Object.freeze({
    message: '该型号仍有库存，不能停用',
    status: 409,
  }),
  WAREHOUSE_VARIANT_HAS_PENDING_DOCUMENT: Object.freeze({
    message: '该型号仍有待确认的出入库单据，不能停用',
    status: 409,
  }),
})
const CATALOG_ERROR_HINTS = new Set([
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'WAREHOUSE_CATALOG_ID_MISMATCH',
  'WAREHOUSE_CATALOG_CONFLICT',
  'WAREHOUSE_CATALOG_RELATION_INVALID',
  'WAREHOUSE_SITE_IN_USE',
  'WAREHOUSE_LOCATION_HAS_STOCK',
  'WAREHOUSE_ITEM_IN_USE',
  'WAREHOUSE_VARIANT_HAS_STOCK',
  'WAREHOUSE_VARIANT_HAS_PENDING_DOCUMENT',
])

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MOVEMENT_TYPE_SET = new Set(Object.values(MOVEMENT_TYPES))
const SENSITIVE_COST_KEYS = new Set([
  'unitCost',
  'unit_cost',
  'stockValue',
  'stock_value',
  'defaultPurchasePrice',
  'default_purchase_price',
])
const ITEM_FIELDS = Object.freeze([
  'id', 'name', 'category', 'brand', 'description', 'active', 'createdAt', 'updatedAt',
])
const VARIANT_FIELDS = Object.freeze([
  'id', 'itemId', 'sku', 'model', 'size', 'material', 'unit', 'minimumStock',
  'systemQr', 'manufacturerQr', 'active', 'createdAt', 'updatedAt',
])
const SITE_FIELDS = Object.freeze([
  'id', 'code', 'name', 'kind', 'active', 'createdAt', 'updatedAt',
])
const LOCATION_FIELDS = Object.freeze([
  'id', 'warehouseId', 'shelfCode', 'shelfName', 'active', 'createdAt', 'updatedAt',
])
const BALANCE_FIELDS = Object.freeze(['variantId', 'warehouseId', 'locationId', 'quantity'])
const MOVEMENT_FIELDS = Object.freeze([
  'id', 'movementType', 'variantId', 'batchId', 'warehouseId', 'locationId',
  'quantityDelta', 'sourceDocumentType', 'sourceDocumentId', 'projectId',
  'destinationType', 'destinationId', 'destinationName', 'operatorEmployeeProfileId',
  'occurredAt', 'reversalOfMovementId', 'metadata',
])
const BALANCE_FILTERS = Object.freeze(['variantId', 'warehouseId', 'locationId', 'page', 'pageSize'])
const MOVEMENT_FILTERS = Object.freeze([
  'variantId', 'warehouseId', 'locationId', 'projectId', 'movementType',
  'occurredFrom', 'occurredTo', 'page', 'pageSize',
])

export class WarehouseServiceError extends Error {
  constructor(code, { authInvalid = false } = {}) {
    const safe = SAFE_ERRORS[code] ?? SAFE_ERRORS.WAREHOUSE_SERVICE_UNAVAILABLE
    super(safe.message)
    this.name = 'WarehouseServiceError'
    this.code = SAFE_ERRORS[code] ? code : 'WAREHOUSE_SERVICE_UNAVAILABLE'
    this.status = safe.status
    this.authInvalid = authInvalid === true
  }
}

function fail(code, options) {
  return new WarehouseServiceError(code, options)
}

function invalidResponse() {
  return fail('WAREHOUSE_INVALID_RESPONSE')
}

function ownDataDescriptors(value) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    Object.values(descriptors).some((descriptor) =>
      !('value' in descriptor) || descriptor.enumerable !== true
    )
  ) return null
  return descriptors
}

function exactObject(value, requiredFields, optionalFields = []) {
  const descriptors = ownDataDescriptors(value)
  if (!descriptors) throw invalidResponse()
  const keys = Object.keys(descriptors).sort()
  const required = [...requiredFields].sort()
  const allowed = new Set([...requiredFields, ...optionalFields])
  if (
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    keys.some((key) => !allowed.has(key))
  ) throw invalidResponse()
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]))
}

function exactFilterObject(value, allowedFields) {
  const descriptors = ownDataDescriptors(value)
  if (!descriptors || Object.keys(descriptors).some((key) => !allowedFields.includes(key))) {
    throw fail('WAREHOUSE_INVALID_FILTER')
  }
  return Object.fromEntries(
    Object.keys(descriptors).map((key) => [key, descriptors[key].value]),
  )
}

function exactArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalidResponse()
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const lengthDescriptor = descriptors.length
  if (
    !lengthDescriptor ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')
  ) throw invalidResponse()
  const length = lengthDescriptor.value
  const keys = Object.keys(descriptors)
  if (keys.length !== length + 1) throw invalidResponse()
  const result = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
      throw invalidResponse()
    }
    result.push(descriptor.value)
  }
  return result
}

function nonemptyString(value) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    throw invalidResponse()
  }
  return value
}

function stringValue(value) {
  if (typeof value !== 'string' || value !== value.trim()) throw invalidResponse()
  return value
}

function nullableString(value) {
  return value === null ? null : nonemptyString(value)
}

function uuidValue(value) {
  const text = nonemptyString(value)
  if (!UUID.test(text)) throw invalidResponse()
  return text
}

function nullableUuid(value) {
  return value === null ? null : uuidValue(value)
}

function finiteNumber(value, { nonnegative = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0)) {
    throw invalidResponse()
  }
  return value
}

function decimalResponse(operation) {
  try {
    return operation()
  } catch {
    throw invalidResponse()
  }
}

function quantityResponse(value) {
  return decimalResponse(() => {
    const units = parseQuantityUnits(value)
    return { units, value: quantityUnitsToNumber(units) }
  })
}

function costResponse(value) {
  return decimalResponse(() => {
    const units = parseCostUnits(value)
    return { units, value: costUnitsToNumber(units) }
  })
}

function booleanValue(value) {
  if (typeof value !== 'boolean') throw invalidResponse()
  return value
}

function timestampValue(value) {
  const text = nonemptyString(value)
  if (!Number.isFinite(Date.parse(text))) throw invalidResponse()
  return text
}

function cloneJsonValue(value, allowCost) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidResponse()
    return value
  }
  if (Array.isArray(value)) {
    return exactArray(value).map((entry) => cloneJsonValue(entry, allowCost))
  }
  const descriptors = ownDataDescriptors(value)
  if (!descriptors) throw invalidResponse()
  return Object.fromEntries(Object.keys(descriptors).sort().map((key) => {
    if (!allowCost && SENSITIVE_COST_KEYS.has(key)) throw invalidResponse()
    return [key, cloneJsonValue(descriptors[key].value, allowCost)]
  }))
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function ownDataValue(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function safeMethod(value, key) {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return null
  }
  try {
    let target = value
    for (let depth = 0; target !== null && depth < 100; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(target, key)
      if (descriptor) {
        return 'value' in descriptor && typeof descriptor.value === 'function'
          ? descriptor.value
          : null
      }
      target = Object.getPrototypeOf(target)
    }
  } catch {
    return null
  }
  return null
}

function validateItem(candidate) {
  const row = exactObject(candidate, ITEM_FIELDS)
  return {
    id: uuidValue(row.id),
    name: nonemptyString(row.name),
    category: stringValue(row.category),
    brand: stringValue(row.brand),
    description: stringValue(row.description),
    active: booleanValue(row.active),
    createdAt: timestampValue(row.createdAt),
    updatedAt: timestampValue(row.updatedAt),
  }
}

function validateVariant(candidate, viewCost) {
  const row = exactObject(
    candidate,
    viewCost ? [...VARIANT_FIELDS, 'defaultPurchasePrice'] : VARIANT_FIELDS,
  )
  const result = {
    id: uuidValue(row.id),
    itemId: uuidValue(row.itemId),
    sku: nonemptyString(row.sku),
    model: stringValue(row.model),
    size: stringValue(row.size),
    material: stringValue(row.material),
    unit: nonemptyString(row.unit),
    minimumStock: quantityResponse(row.minimumStock).value,
    systemQr: nonemptyString(row.systemQr),
    manufacturerQr: nullableString(row.manufacturerQr),
    active: booleanValue(row.active),
    createdAt: timestampValue(row.createdAt),
    updatedAt: timestampValue(row.updatedAt),
  }
  if (viewCost) {
    result.defaultPurchasePrice = costResponse(row.defaultPurchasePrice).value
  }
  return result
}

function validateCatalog(value, viewCost) {
  const row = exactObject(value, ['items', 'variants'])
  return deepFreeze({
    items: exactArray(row.items).map(validateItem),
    variants: exactArray(row.variants).map((variant) => validateVariant(variant, viewCost)),
  })
}

function validateSite(candidate) {
  const row = exactObject(candidate, SITE_FIELDS)
  const kind = nonemptyString(row.kind)
  if (!['normal', 'project_site', 'shared_tool'].includes(kind)) throw invalidResponse()
  return {
    id: uuidValue(row.id),
    code: nonemptyString(row.code),
    name: nonemptyString(row.name),
    kind,
    active: booleanValue(row.active),
    createdAt: timestampValue(row.createdAt),
    updatedAt: timestampValue(row.updatedAt),
  }
}

function validateLocation(candidate) {
  const row = exactObject(candidate, LOCATION_FIELDS)
  return {
    id: uuidValue(row.id),
    warehouseId: uuidValue(row.warehouseId),
    shelfCode: nonemptyString(row.shelfCode),
    shelfName: nonemptyString(row.shelfName),
    active: booleanValue(row.active),
    createdAt: timestampValue(row.createdAt),
    updatedAt: timestampValue(row.updatedAt),
  }
}

function validateLocations(value) {
  const row = exactObject(value, ['sites', 'locations'])
  return deepFreeze({
    sites: exactArray(row.sites).map(validateSite),
    locations: exactArray(row.locations).map(validateLocation),
  })
}

function validateBalance(candidate, viewCost) {
  const row = exactObject(
    candidate,
    viewCost ? [...BALANCE_FIELDS, 'unitCost', 'stockValue'] : BALANCE_FIELDS,
  )
  const quantity = quantityResponse(row.quantity)
  const result = {
    variantId: uuidValue(row.variantId),
    warehouseId: uuidValue(row.warehouseId),
    locationId: uuidValue(row.locationId),
    quantity: quantity.value,
  }
  if (viewCost) {
    const unitCost = costResponse(row.unitCost)
    const suppliedStockValue = costResponse(row.stockValue)
    if (
      quantity.units === 0n &&
      (unitCost.units !== 0n || suppliedStockValue.units !== 0n)
    ) throw invalidResponse()
    const stockValueUnits = decimalResponse(() =>
      deriveStockValueUnits(quantity.units, unitCost.units))
    result.unitCost = unitCost.value
    result.stockValue = decimalResponse(() => costUnitsToNumber(stockValueUnits))
  }
  return result
}

function validateBalances(value, viewCost) {
  return deepFreeze(exactArray(value).map((row) => validateBalance(row, viewCost)))
}

function validateMovement(candidate, viewCost) {
  const row = exactObject(
    candidate,
    viewCost ? [...MOVEMENT_FIELDS, 'unitCost'] : MOVEMENT_FIELDS,
  )
  const movementType = nonemptyString(row.movementType)
  if (!MOVEMENT_TYPE_SET.has(movementType)) throw invalidResponse()
  if (!ownDataDescriptors(row.metadata)) throw invalidResponse()
  const result = {
    id: uuidValue(row.id),
    movementType,
    variantId: uuidValue(row.variantId),
    batchId: nullableUuid(row.batchId),
    warehouseId: uuidValue(row.warehouseId),
    locationId: uuidValue(row.locationId),
    quantityDelta: finiteNumber(row.quantityDelta),
    sourceDocumentType: nonemptyString(row.sourceDocumentType),
    sourceDocumentId: nonemptyString(row.sourceDocumentId),
    projectId: nullableString(row.projectId),
    destinationType: nullableString(row.destinationType),
    destinationId: nullableString(row.destinationId),
    destinationName: nullableString(row.destinationName),
    operatorEmployeeProfileId: uuidValue(row.operatorEmployeeProfileId),
    occurredAt: timestampValue(row.occurredAt),
    reversalOfMovementId: nullableUuid(row.reversalOfMovementId),
    metadata: cloneJsonValue(row.metadata, viewCost),
  }
  if (viewCost) result.unitCost = costResponse(row.unitCost).value
  return result
}

function validateMovements(value, viewCost) {
  return deepFreeze(exactArray(value).map((row) => validateMovement(row, viewCost)))
}

function primitiveSupplierStatus(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && Number.isSafeInteger(value) ? value : null
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && Number.isSafeInteger(parsed) ? parsed : null
}

function normalizeSupplierError(error, responseStatus) {
  if (error instanceof WarehouseServiceError) return error
  const responsePrimitive = primitiveSupplierStatus(responseStatus)
  const status = responsePrimitive ?? primitiveSupplierStatus(ownDataValue(error, 'status'))
  const rawCode = ownDataValue(error, 'code')
  const code = typeof rawCode === 'string' && rawCode.length <= 32
    ? rawCode.toUpperCase()
    : ''
  if (status === 401 || ['PGRST301', 'JWT_EXPIRED'].includes(code)) {
    return fail('AUTH_SESSION_INVALID', { authInvalid: true })
  }
  if (status === 403 || code === '42501') return fail('ACCESS_DENIED')
  const rawHint = ownDataValue(error, 'hint')
  if (typeof rawHint === 'string' && CATALOG_ERROR_HINTS.has(rawHint)) {
    return fail(rawHint)
  }
  return fail('WAREHOUSE_SERVICE_UNAVAILABLE')
}

function filterUuid(value) {
  if (typeof value !== 'string' || value !== value.trim() || !UUID.test(value)) {
    throw fail('WAREHOUSE_INVALID_FILTER')
  }
  return value
}

function filterText(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.length > 300
  ) throw fail('WAREHOUSE_INVALID_FILTER')
  return value
}

function filterTimestamp(value) {
  const text = filterText(value)
  if (!Number.isFinite(Date.parse(text))) throw fail('WAREHOUSE_INVALID_FILTER')
  return text
}

function filterPage(value, { size = false } = {}) {
  const maximum = size ? 500 : 2_147_483_647
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw fail('WAREHOUSE_INVALID_FILTER')
  }
  return value
}

function normalizeFilters(filters, movement) {
  const allowed = movement ? MOVEMENT_FILTERS : BALANCE_FILTERS
  const input = exactFilterObject(filters, allowed)
  const result = {}
  for (const field of allowed) {
    if (!Object.hasOwn(input, field)) continue
    if (['variantId', 'warehouseId', 'locationId'].includes(field)) {
      result[field] = filterUuid(input[field])
    } else if (field === 'projectId') {
      result[field] = filterText(input[field])
    } else if (field === 'movementType') {
      const value = filterText(input[field])
      if (!MOVEMENT_TYPE_SET.has(value)) throw fail('WAREHOUSE_INVALID_FILTER')
      result[field] = value
    } else if (field === 'occurredFrom' || field === 'occurredTo') {
      result[field] = filterTimestamp(input[field])
    } else if (field === 'page') {
      result[field] = filterPage(input[field])
    } else if (field === 'pageSize') {
      result[field] = filterPage(input[field], { size: true })
    }
  }
  if (
    result.occurredFrom &&
    result.occurredTo &&
    Date.parse(result.occurredFrom) > Date.parse(result.occurredTo)
  ) throw fail('WAREHOUSE_INVALID_FILTER')
  if (!Object.hasOwn(result, 'page')) result.page = 1
  if (!Object.hasOwn(result, 'pageSize')) result.pageSize = 100
  return result
}

function normalizeOptions(options, client) {
  const descriptors = ownDataDescriptors(options)
  const allowed = new Set(['configured', 'viewCost'])
  if (!descriptors || Object.keys(descriptors).some((key) => !allowed.has(key))) {
    throw fail('WAREHOUSE_NOT_CONFIGURED')
  }
  const configured = Object.hasOwn(descriptors, 'configured')
    ? descriptors.configured.value
    : Boolean(client)
  const viewCost = Object.hasOwn(descriptors, 'viewCost')
    ? descriptors.viewCost.value
    : false
  if (typeof configured !== 'boolean' || typeof viewCost !== 'boolean') {
    throw fail('WAREHOUSE_NOT_CONFIGURED')
  }
  return { configured, viewCost }
}

export function createWarehouseService(client, options = {}) {
  const { configured, viewCost } = normalizeOptions(options, client)
  const ensureConfigured = () => {
    const rpc = configured ? safeMethod(client, 'rpc') : null
    if (!rpc) {
      throw fail('WAREHOUSE_NOT_CONFIGURED')
    }
    return rpc
  }
  const call = async (name, args) => {
    const rpc = ensureConfigured()
    let result
    try {
      result = await rpc.call(client, name, args)
    } catch (error) {
      throw normalizeSupplierError(error)
    }
    const descriptors = ownDataDescriptors(result)
    if (!descriptors || !Object.hasOwn(descriptors, 'data')) throw invalidResponse()
    const error = Object.hasOwn(descriptors, 'error') ? descriptors.error.value : null
    const status = Object.hasOwn(descriptors, 'status') ? descriptors.status.value : undefined
    if (error) throw normalizeSupplierError(error, status)
    return descriptors.data.value
  }
  const mutation = async (builder, rpcName, idArgument, input, validator) => {
    let request
    try {
      request = builder(input)
    } catch {
      throw fail('WAREHOUSE_CATALOG_INPUT_INVALID')
    }
    const response = validator(await call(rpcName, {
      [idArgument]: request.id,
      p_payload: request.payload,
    }))
    if (response.id !== request.id) throw invalidResponse()
    return deepFreeze(response)
  }

  return Object.freeze({
    async listCatalog() {
      return validateCatalog(await call('list_warehouse_catalog_secure', {}), viewCost)
    },
    async listLocations() {
      return validateLocations(await call('list_warehouse_locations_secure', {}))
    },
    async listBalances(filters = {}) {
      const normalized = normalizeFilters(filters, false)
      return validateBalances(
        await call('list_warehouse_balances_secure', { p_filters: normalized }),
        viewCost,
      )
    },
    async listMovements(filters = {}) {
      const normalized = normalizeFilters(filters, true)
      return validateMovements(
        await call('list_warehouse_movements_secure', { p_filters: normalized }),
        viewCost,
      )
    },
    async saveSite(input) {
      return mutation(
        buildWarehouseSiteMutation,
        'upsert_warehouse_site_secure',
        'p_site_id',
        input,
        validateSite,
      )
    },
    async saveLocation(input) {
      return mutation(
        buildWarehouseLocationMutation,
        'upsert_warehouse_location_secure',
        'p_location_id',
        input,
        (value) => {
          const response = validateLocation(value)
          if (response.warehouseId !== input.warehouseId.toLowerCase()) throw invalidResponse()
          return response
        },
      )
    },
    async saveItem(input) {
      return mutation(
        buildWarehouseItemMutation,
        'upsert_warehouse_item_secure',
        'p_item_id',
        input,
        validateItem,
      )
    },
    async saveVariant(input) {
      return mutation(
        buildWarehouseVariantMutation,
        'upsert_warehouse_variant_secure',
        'p_variant_id',
        input,
        (value) => {
          const response = validateVariant(value, viewCost)
          if (
            response.itemId !== input.itemId.toLowerCase() ||
            response.systemQr !== `SWERP:VARIANT:${response.id}`
          ) throw invalidResponse()
          return response
        },
      )
    },
  })
}

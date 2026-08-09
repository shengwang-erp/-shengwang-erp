import {
  costUnitsToNumber,
  parseCostUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from '../features/warehouse/warehouseDecimal.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
const SUPPLIER_FIELDS = new Set(['data', 'error', 'status', 'statusText', 'count'])

const ERRORS = Object.freeze({
  WAREHOUSE_CONFIRMATION_NOT_CONFIGURED: Object.freeze({ message: '仓库确认服务未配置', status: 503 }),
  WAREHOUSE_CONFIRMATION_INPUT_INVALID: Object.freeze({ message: '仓库确认数据无效，请检查后重试', status: 400 }),
  WAREHOUSE_CONFIRMATION_RESPONSE_INVALID: Object.freeze({ message: '仓库确认服务返回了无效数据', status: 502 }),
  WAREHOUSE_CONFIRMATION_FAILED: Object.freeze({ message: '仓库确认服务暂不可用，请稍后重试', status: 503 }),
  AUTH_SESSION_INVALID: Object.freeze({ message: '登录状态无效，请重新登录', status: 401 }),
  ACCESS_DENIED: Object.freeze({ message: '没有仓库确认权限', status: 403 }),
  WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT: Object.freeze({ message: '该确认编号已用于其他内容，请刷新后重试', status: 409 }),
  WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED: Object.freeze({ message: '该仓库单据已经确认，请刷新后查看', status: 409 }),
  WAREHOUSE_RESOURCE_INACTIVE: Object.freeze({ message: '物品型号或仓库位置已停用，请刷新后重试', status: 409 }),
  WAREHOUSE_LOCATION_MISMATCH: Object.freeze({ message: '仓库与货架区不匹配，请刷新后重试', status: 409 }),
  WAREHOUSE_PURCHASE_COST_INVALID: Object.freeze({ message: '采购价格或数量无效，不能确认入库', status: 409 }),
  WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED: Object.freeze({ message: '确认数量超过采购剩余数量，请刷新后重试', status: 409 }),
  WAREHOUSE_INSUFFICIENT_STOCK: Object.freeze({ message: '所选货架区库存不足，未执行任何出库', status: 409 }),
})

const TRUSTED_HINTS = new Map([
  ['WAREHOUSE_CONFIRMATION_INPUT_INVALID', '22023'],
  ['WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT', '23505'],
  ['WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED', '55000'],
  ['WAREHOUSE_RESOURCE_INACTIVE', '55000'],
  ['WAREHOUSE_LOCATION_MISMATCH', '23503'],
  ['WAREHOUSE_PURCHASE_COST_INVALID', '22023'],
  ['WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED', '23514'],
  ['WAREHOUSE_INSUFFICIENT_STOCK', '23514'],
])

export class WarehouseConfirmationServiceError extends Error {
  constructor(code, { authInvalid = false } = {}) {
    const selected = ERRORS[code] ?? ERRORS.WAREHOUSE_CONFIRMATION_FAILED
    super(selected.message)
    this.name = 'WarehouseConfirmationServiceError'
    this.code = ERRORS[code] ? code : 'WAREHOUSE_CONFIRMATION_FAILED'
    this.status = selected.status
    this.authInvalid = authInvalid === true
  }
}

function fail(code, options) {
  return new WarehouseConfirmationServiceError(code, options)
}

function ownObject(value) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    Object.values(descriptors).some((descriptor) =>
      !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
  ) return null
  return descriptors
}

function exactObject(value, fields, errorCode) {
  const descriptors = ownObject(value)
  if (
    !descriptors || Object.keys(descriptors).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(descriptors, field)) ||
    Object.keys(descriptors).some((field) => !fields.includes(field))
  ) throw fail(errorCode)
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
}

function denseArray(value, errorCode, { minimum = 1, maximum = 100 } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw fail(errorCode)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = descriptors.length?.value
  if (
    !Number.isSafeInteger(length) || length < minimum || length > maximum ||
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

function displayText(value, maximum, errorCode, { required = true } = {}) {
  if (
    typeof value !== 'string' || value !== value.trim() || value.length > maximum ||
    (required && value.length === 0)
  ) throw fail(errorCode)
  return value
}

function uuid(value, errorCode) {
  return text(value, UUID, errorCode).toLowerCase()
}

function nullableUuid(value, errorCode) {
  return value === null ? null : uuid(value, errorCode)
}

function quantity(value, errorCode, { positive = true } = {}) {
  try {
    const units = parseQuantityUnits(value)
    if (positive ? units <= 0n : units < 0n) throw new TypeError()
    return { units, value: quantityUnitsToNumber(units) }
  } catch {
    throw fail(errorCode)
  }
}

function nullableCost(value, errorCode, viewCost) {
  if (!viewCost) {
    if (value !== null) throw fail(errorCode)
    return null
  }
  try {
    const units = parseCostUnits(value)
    return costUnitsToNumber(units)
  } catch {
    throw fail(errorCode)
  }
}

function timestamp(value, errorCode) {
  if (
    typeof value !== 'string' || value !== value.trim() || value.length > 50 ||
    !Number.isFinite(Date.parse(value))
  ) throw fail(errorCode)
  return value
}

function deepFreeze(value) {
  if (Array.isArray(value)) value.forEach(deepFreeze)
  else if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

function confirmationLine(value, idField) {
  const row = exactObject(value, [
    idField, 'confirmedQuantity', 'warehouseId', 'locationId',
  ], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
  return {
    [idField]: uuid(row[idField], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
    confirmedQuantity: quantity(
      row.confirmedQuantity,
      'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
    ).value,
    warehouseId: uuid(row.warehouseId, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
    locationId: uuid(row.locationId, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
  }
}

function confirmationRequest(input, documentField, lineField) {
  const row = exactObject(input, [
    documentField, 'idempotencyKey', 'lines',
  ], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
  const lines = denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
    .map((line) => confirmationLine(line, lineField))
  if (new Set(lines.map((line) => line[lineField])).size !== lines.length) {
    throw fail('WAREHOUSE_CONFIRMATION_INPUT_INVALID')
  }
  return deepFreeze({
    documentId: uuid(row[documentField], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
    idempotencyKey: text(
      row.idempotencyKey,
      IDEMPOTENCY_KEY,
      'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
    ),
    lines,
  })
}

function receiptLine(value, viewCost) {
  const row = exactObject(value, [
    'id', 'receiptId', 'variantId', 'requestedQuantity', 'confirmedQuantity',
    'warehouseId', 'locationId', 'unitCost',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const requested = quantity(row.requestedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const confirmed = quantity(row.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const warehouseId = nullableUuid(row.warehouseId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const locationId = nullableUuid(row.locationId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  if (confirmed.units > requested.units || warehouseId === null || locationId === null) {
    throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  }
  return {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    receiptId: uuid(row.receiptId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    variantId: uuid(row.variantId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestedQuantity: requested.value,
    confirmedQuantity: confirmed.value,
    warehouseId,
    locationId,
    unitCost: nullableCost(row.unitCost, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID', viewCost),
  }
}

function stockOutLine(value, viewCost) {
  const row = exactObject(value, [
    'id', 'requestId', 'variantId', 'requestedQuantity', 'confirmedQuantity',
    'warehouseId', 'locationId', 'frozenTotalCost',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const requested = quantity(row.requestedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const confirmed = quantity(row.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  if (confirmed.units > requested.units) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  return {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestId: uuid(row.requestId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    variantId: uuid(row.variantId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestedQuantity: requested.value,
    confirmedQuantity: confirmed.value,
    warehouseId: uuid(row.warehouseId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    locationId: uuid(row.locationId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    frozenTotalCost: nullableCost(
      row.frozenTotalCost,
      'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
      viewCost,
    ),
  }
}

function receiptResponse(value, request, viewCost) {
  const row = exactObject(value, [
    'id', 'purchaseRecordKey', 'status', 'submittedByEmployeeProfileId', 'submittedAt',
    'confirmedByEmployeeProfileId', 'confirmedAt', 'rejectionReason', 'idempotencyKey', 'lines',
    'confirmationIdempotencyKey',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const lines = denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    .map((line) => receiptLine(line, viewCost))
  const result = {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    purchaseRecordKey: text(row.purchaseRecordKey, RECORD_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    status: row.status,
    submittedByEmployeeProfileId: uuid(row.submittedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    submittedAt: timestamp(row.submittedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedByEmployeeProfileId: uuid(row.confirmedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedAt: timestamp(row.confirmedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    rejectionReason: row.rejectionReason === null
      ? null
      : displayText(row.rejectionReason, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmationIdempotencyKey: text(
      row.confirmationIdempotencyKey,
      IDEMPOTENCY_KEY,
      'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    ),
    lines,
  }
  if (
    result.id !== request.documentId || !['confirmed', 'void'].includes(result.status) ||
    result.confirmationIdempotencyKey !== request.idempotencyKey ||
    (result.status === 'confirmed' && result.rejectionReason !== null) ||
    (result.status === 'void' && result.rejectionReason === null) ||
    lines.length !== request.lines.length
  ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const expected = new Map(request.lines.map((line) => [line.receiptLineId, line]))
  for (const line of lines) {
    const input = expected.get(line.id)
    if (
      !input || line.receiptId !== request.documentId ||
      quantity(line.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').units !==
        quantity(input.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').units ||
      line.warehouseId !== input.warehouseId || line.locationId !== input.locationId
    ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    expected.delete(line.id)
  }
  if (expected.size !== 0) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  return deepFreeze(result)
}

function stockOutResponse(value, request, viewCost) {
  const row = exactObject(value, [
    'id', 'destinationType', 'projectId', 'minorWorkOrderId', 'destinationNameSnapshot',
    'purpose', 'receiver', 'requestDate', 'status', 'submittedByEmployeeProfileId',
    'submittedAt', 'confirmedByEmployeeProfileId', 'confirmedAt', 'rejectionReason',
    'idempotencyKey', 'confirmationIdempotencyKey', 'lines',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const lines = denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    .map((line) => stockOutLine(line, viewCost))
  const projectId = row.projectId === null
    ? null
    : text(row.projectId, RECORD_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const minorWorkOrderId = nullableUuid(row.minorWorkOrderId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  if (
    !['project', 'minor_work_order', 'internal_use'].includes(row.destinationType) ||
    (row.destinationType === 'project' && (projectId === null || minorWorkOrderId !== null)) ||
    (row.destinationType === 'minor_work_order' && (projectId !== null || minorWorkOrderId === null)) ||
    (row.destinationType === 'internal_use' && (projectId !== null || minorWorkOrderId !== null))
  ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const result = {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    destinationType: row.destinationType,
    projectId,
    minorWorkOrderId,
    destinationNameSnapshot: displayText(row.destinationNameSnapshot, 500, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    purpose: displayText(row.purpose, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    receiver: displayText(row.receiver, 300, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestDate: text(row.requestDate, DATE, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    status: row.status,
    submittedByEmployeeProfileId: uuid(row.submittedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    submittedAt: timestamp(row.submittedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedByEmployeeProfileId: uuid(row.confirmedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedAt: timestamp(row.confirmedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    rejectionReason: row.rejectionReason === null
      ? null
      : displayText(row.rejectionReason, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmationIdempotencyKey: text(
      row.confirmationIdempotencyKey,
      IDEMPOTENCY_KEY,
      'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    ),
    lines,
  }
  if (
    result.id !== request.documentId || !['confirmed', 'void'].includes(result.status) ||
    result.confirmationIdempotencyKey !== request.idempotencyKey ||
    (result.status === 'confirmed' && result.rejectionReason !== null) ||
    (result.status === 'void' && result.rejectionReason === null) ||
    lines.length !== request.lines.length
  ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const expected = new Map(request.lines.map((line) => [line.stockOutLineId, line]))
  for (const line of lines) {
    const input = expected.get(line.id)
    if (
      !input || line.requestId !== request.documentId ||
      quantity(line.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').units !==
      quantity(input.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').units ||
      line.warehouseId !== input.warehouseId || line.locationId !== input.locationId
    ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    expected.delete(line.id)
  }
  if (expected.size !== 0) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  return deepFreeze(result)
}

function supplierField(value, key) {
  const descriptors = ownObject(value)
  return descriptors?.[key]?.value
}

function supplierStatus(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  return null
}

function normalizeSupplierError(error, outerStatus) {
  if (error instanceof WarehouseConfirmationServiceError) return error
  const suppliedCode = supplierField(error, 'code')
  const code = typeof suppliedCode === 'string' ? suppliedCode.toUpperCase() : ''
  const status = supplierStatus(outerStatus) ?? supplierStatus(supplierField(error, 'status'))
  if (status === 401 || ['PGRST301', 'JWT_EXPIRED'].includes(code)) {
    return fail('AUTH_SESSION_INVALID', { authInvalid: true })
  }
  if (status === 403 || code === '42501') return fail('ACCESS_DENIED')
  const hint = supplierField(error, 'hint')
  if (
    typeof hint === 'string' && TRUSTED_HINTS.get(hint) === code && ERRORS[hint] &&
    status !== null && status >= 400 && status < 500
  ) return fail(hint)
  return fail('WAREHOUSE_CONFIRMATION_FAILED')
}

function normalizeOptions(client, options) {
  const descriptors = ownObject(options)
  if (!descriptors || Object.keys(descriptors).some((key) => !['configured', 'viewCost'].includes(key))) {
    throw fail('WAREHOUSE_CONFIRMATION_NOT_CONFIGURED')
  }
  const configured = Object.hasOwn(descriptors, 'configured')
    ? descriptors.configured.value
    : Boolean(client)
  const viewCost = Object.hasOwn(descriptors, 'viewCost') ? descriptors.viewCost.value : false
  if (typeof configured !== 'boolean' || typeof viewCost !== 'boolean') {
    throw fail('WAREHOUSE_CONFIRMATION_NOT_CONFIGURED')
  }
  return { configured, viewCost }
}

export function createWarehouseConfirmationService(client, options = {}) {
  const { configured, viewCost } = normalizeOptions(client, options)
  const call = async (name, args) => {
    if (!configured || !client || typeof client.rpc !== 'function') {
      throw fail('WAREHOUSE_CONFIRMATION_NOT_CONFIGURED')
    }
    let response
    try {
      response = await client.rpc(name, args)
    } catch (error) {
      throw normalizeSupplierError(error)
    }
    const descriptors = ownObject(response)
    if (
      !descriptors || !Object.hasOwn(descriptors, 'data') ||
      Object.keys(descriptors).some((key) => !SUPPLIER_FIELDS.has(key))
    ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    const error = Object.hasOwn(descriptors, 'error') ? descriptors.error.value : null
    const status = Object.hasOwn(descriptors, 'status') ? descriptors.status.value : undefined
    const statusText = Object.hasOwn(descriptors, 'statusText') ? descriptors.statusText.value : undefined
    const count = Object.hasOwn(descriptors, 'count') ? descriptors.count.value : undefined
    if (
      (error !== null && !ownObject(error)) ||
      (status !== undefined && (!Number.isSafeInteger(status) || status < 100 || status > 599)) ||
      (statusText !== undefined && statusText !== null && typeof statusText !== 'string') ||
      (count !== undefined && count !== null && (!Number.isSafeInteger(count) || count < 0))
    ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    if (error) throw normalizeSupplierError(error, status)
    if (status !== undefined && (status < 200 || status >= 300)) {
      throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    }
    return descriptors.data.value
  }

  return Object.freeze({
    async confirmReceipt(input) {
      const request = confirmationRequest(input, 'receiptId', 'receiptLineId')
      return receiptResponse(await call('confirm_warehouse_receipt_secure', {
        p_receipt_id: request.documentId,
        p_lines: request.lines,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
    async confirmStockOut(input) {
      const request = confirmationRequest(input, 'requestId', 'stockOutLineId')
      return stockOutResponse(await call('confirm_warehouse_stock_out_secure', {
        p_request_id: request.documentId,
        p_lines: request.lines,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
  })
}

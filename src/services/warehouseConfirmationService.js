import {
  costUnitsToNumber,
  parseCostUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from '../features/warehouse/warehouseDecimal.js'
import {
  buildOperationReversalCommand,
  buildStocktakeConfirmationCommand,
  buildTransferConfirmationCommand,
} from '../features/warehouse/warehouseOperations.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const DATE = /^\d{4}-\d{2}-\d{2}$/u
const SUPPLIER_FIELDS = new Set([
  'success', 'data', 'error', 'status', 'statusText', 'count',
])
const MAX_OPERATION_MOVEMENT_IDS = 20_000

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
  WAREHOUSE_RETURN_QUANTITY_EXCEEDED: Object.freeze({ message: '退回数量超过原出库可退数量，请刷新后重试', status: 409 }),
  WAREHOUSE_OPERATION_TOO_COMPLEX: Object.freeze({ message: '本次仓库操作涉及的批次数量过多，请拆分后重试', status: 409 }),
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
  ['WAREHOUSE_RETURN_QUANTITY_EXCEEDED', '23514'],
  ['WAREHOUSE_OPERATION_TOO_COMPLEX', '54000'],
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
    Reflect.ownKeys(descriptors).length !== length + 1
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

function signedQuantity(value, errorCode) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw fail(errorCode)
  const sign = value < 0 ? -1n : 1n
  try {
    const absoluteUnits = parseQuantityUnits(Math.abs(value))
    return {
      units: sign * absoluteUnits,
      value: Number(sign) * quantityUnitsToNumber(absoluteUnits),
    }
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

function nullableSignedCost(value, errorCode, viewCost) {
  if (!viewCost) {
    if (value !== null) throw fail(errorCode)
    return null
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) throw fail(errorCode)
  const sign = value < 0 ? -1 : 1
  try {
    return sign * costUnitsToNumber(parseCostUnits(Math.abs(value)))
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

function returnConfirmationRequest(input) {
  const row = exactObject(input, [
    'returnId', 'idempotencyKey', 'lines',
  ], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
  const lines = denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
    .map((value) => {
      const line = exactObject(value, [
        'returnLineId', 'confirmedQuantity',
      ], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
      return {
        returnLineId: uuid(line.returnLineId, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
        confirmedQuantity: quantity(
          line.confirmedQuantity,
          'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
        ).value,
      }
    })
  if (new Set(lines.map((line) => line.returnLineId)).size !== lines.length) {
    throw fail('WAREHOUSE_CONFIRMATION_INPUT_INVALID')
  }
  return deepFreeze({
    documentId: uuid(row.returnId, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
    idempotencyKey: text(
      row.idempotencyKey,
      IDEMPOTENCY_KEY,
      'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
    ),
    lines,
  })
}

function rejectionRequest(input, documentField) {
  const row = exactObject(input, [
    documentField, 'reason', 'idempotencyKey',
  ], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID')
  return deepFreeze({
    documentId: uuid(row[documentField], 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
    reason: displayText(row.reason, 1000, 'WAREHOUSE_CONFIRMATION_INPUT_INVALID'),
    idempotencyKey: text(
      row.idempotencyKey,
      IDEMPOTENCY_KEY,
      'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
    ),
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

function returnResponse(value, request, viewCost) {
  const row = exactObject(value, [
    'id', 'originalStockOutId', 'destinationType', 'projectId', 'minorWorkOrderId',
    'destinationNameSnapshot', 'reason', 'receiver', 'requestDate', 'status',
    'submittedByEmployeeProfileId', 'submittedAt', 'confirmedByEmployeeProfileId',
    'confirmedAt', 'rejectionReason', 'idempotencyKey',
    'confirmationIdempotencyKey', 'lines',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const lines = denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    .map((value) => {
      const line = exactObject(value, [
        'id', 'returnId', 'originalStockOutLineId', 'variantId',
        'requestedQuantity', 'confirmedQuantity', 'frozenTotalCost',
      ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
      const requestedQuantity = quantity(
        line.requestedQuantity,
        'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
      )
      const confirmedQuantity = quantity(
        line.confirmedQuantity,
        'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
      )
      if (confirmedQuantity.units > requestedQuantity.units) {
        throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
      }
      return {
        id: uuid(line.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        returnId: uuid(line.returnId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        originalStockOutLineId: uuid(
          line.originalStockOutLineId,
          'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
        ),
        variantId: uuid(line.variantId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        requestedQuantity: requestedQuantity.value,
        confirmedQuantity: confirmedQuantity.value,
        frozenTotalCost: nullableCost(
          line.frozenTotalCost,
          'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
          viewCost,
        ),
      }
    })
  const result = {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    originalStockOutId: uuid(row.originalStockOutId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    destinationType: row.destinationType,
    projectId: row.projectId === null
      ? null
      : text(row.projectId, RECORD_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    minorWorkOrderId: nullableUuid(row.minorWorkOrderId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    destinationNameSnapshot: displayText(
      row.destinationNameSnapshot, 500, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    ),
    reason: displayText(row.reason, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    receiver: displayText(row.receiver, 300, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestDate: text(row.requestDate, DATE, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    status: row.status,
    submittedByEmployeeProfileId: uuid(
      row.submittedByEmployeeProfileId,
      'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    ),
    submittedAt: timestamp(row.submittedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedByEmployeeProfileId: uuid(
      row.confirmedByEmployeeProfileId,
      'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    ),
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
    lines.length !== request.lines.length
  ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const expected = new Map(request.lines.map((line) => [line.returnLineId, line]))
  for (const line of lines) {
    const input = expected.get(line.id)
    if (
      !input || line.returnId !== result.id ||
      quantity(line.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').units !==
        quantity(input.confirmedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').units
    ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    expected.delete(line.id)
  }
  if (expected.size !== 0) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  return deepFreeze(result)
}

function stockOutRejectionResponse(value, request, viewCost) {
  const row = exactObject(value, [
    'id', 'destinationType', 'projectId', 'minorWorkOrderId', 'destinationNameSnapshot',
    'purpose', 'receiver', 'requestDate', 'status', 'submittedByEmployeeProfileId',
    'submittedAt', 'confirmedByEmployeeProfileId', 'confirmedAt', 'rejectionReason',
    'idempotencyKey', 'lines', 'confirmationIdempotencyKey',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const result = {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    destinationType: row.destinationType,
    projectId: row.projectId === null
      ? null
      : text(row.projectId, RECORD_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    minorWorkOrderId: nullableUuid(row.minorWorkOrderId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    destinationNameSnapshot: displayText(row.destinationNameSnapshot, 500, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    purpose: displayText(row.purpose, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    receiver: displayText(row.receiver, 300, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestDate: text(row.requestDate, DATE, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    status: row.status,
    submittedByEmployeeProfileId: uuid(row.submittedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    submittedAt: timestamp(row.submittedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedByEmployeeProfileId: uuid(row.confirmedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedAt: timestamp(row.confirmedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    rejectionReason: displayText(row.rejectionReason, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmationIdempotencyKey: text(row.confirmationIdempotencyKey, IDEMPOTENCY_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    lines: denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').map((value) => {
      const line = exactObject(value, [
        'id', 'requestId', 'variantId', 'requestedQuantity',
        'confirmedQuantity', 'frozenTotalCost',
      ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
      const normalized = {
        id: uuid(line.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        requestId: uuid(line.requestId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        variantId: uuid(line.variantId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        requestedQuantity: quantity(line.requestedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').value,
        confirmedQuantity: line.confirmedQuantity,
        frozenTotalCost: line.frozenTotalCost,
      }
      if (
        normalized.requestId !== request.documentId ||
        normalized.confirmedQuantity !== null || normalized.frozenTotalCost !== null
      ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
      return normalized
    }),
  }
  if (
    result.id !== request.documentId || result.status !== 'rejected' ||
    result.rejectionReason !== request.reason ||
    result.confirmationIdempotencyKey !== request.idempotencyKey ||
    !['project', 'minor_work_order', 'internal_use'].includes(result.destinationType) ||
    (result.destinationType === 'project' && (result.projectId === null || result.minorWorkOrderId !== null)) ||
    (result.destinationType === 'minor_work_order' && (result.projectId !== null || result.minorWorkOrderId === null)) ||
    (result.destinationType === 'internal_use' && (result.projectId !== null || result.minorWorkOrderId !== null))
  ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  if (viewCost && result.lines.some((line) => line.frozenTotalCost !== null)) {
    throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  }
  return deepFreeze(result)
}

function returnRejectionResponse(value, request) {
  const row = exactObject(value, [
    'id', 'originalStockOutId', 'reason', 'receiver', 'requestDate', 'status',
    'submittedByEmployeeProfileId', 'submittedAt', 'confirmedByEmployeeProfileId',
    'confirmedAt', 'rejectionReason', 'idempotencyKey', 'lines',
    'confirmationIdempotencyKey',
  ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  const result = {
    id: uuid(row.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    originalStockOutId: uuid(row.originalStockOutId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    reason: displayText(row.reason, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    receiver: displayText(row.receiver, 300, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    requestDate: text(row.requestDate, DATE, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    status: row.status,
    submittedByEmployeeProfileId: uuid(row.submittedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    submittedAt: timestamp(row.submittedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedByEmployeeProfileId: uuid(row.confirmedByEmployeeProfileId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmedAt: timestamp(row.confirmedAt, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    rejectionReason: displayText(row.rejectionReason, 1000, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    confirmationIdempotencyKey: text(row.confirmationIdempotencyKey, IDEMPOTENCY_KEY, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
    lines: denseArray(row.lines, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').map((value) => {
      const line = exactObject(value, [
        'id', 'returnId', 'originalStockOutLineId', 'requestedQuantity',
        'confirmedQuantity', 'frozenTotalCost',
      ], 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
      const normalized = {
        id: uuid(line.id, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        returnId: uuid(line.returnId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        originalStockOutLineId: uuid(line.originalStockOutLineId, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'),
        requestedQuantity: quantity(line.requestedQuantity, 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID').value,
        confirmedQuantity: line.confirmedQuantity,
        frozenTotalCost: line.frozenTotalCost,
      }
      if (
        normalized.returnId !== request.documentId ||
        normalized.confirmedQuantity !== null || normalized.frozenTotalCost !== null
      ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
      return normalized
    }),
  }
  if (
    result.id !== request.documentId || result.status !== 'rejected' ||
    result.rejectionReason !== request.reason ||
    result.confirmationIdempotencyKey !== request.idempotencyKey
  ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
  return deepFreeze(result)
}

function movementIds(value, errorCode, {
  exactLength,
  maximum = MAX_OPERATION_MOVEMENT_IDS,
} = {}) {
  const ids = denseArray(value, errorCode, {
    minimum: exactLength ?? 1,
    maximum: exactLength ?? maximum,
  }).map((entry) => uuid(entry, errorCode))
  if (
    (exactLength !== undefined && ids.length !== exactLength) ||
    new Set(ids).size !== ids.length
  ) throw fail(errorCode)
  return ids
}

function transferMovementIds(value, errorCode) {
  const ids = movementIds(value, errorCode)
  if (ids.length < 2 || ids.length % 2 !== 0) throw fail(errorCode)
  return ids
}

function operationOutcome(row, errorCode) {
  if (!['confirmed', 'void'].includes(row.status)) throw fail(errorCode)
  const reversalId = row.reversalId === null ? null : uuid(row.reversalId, errorCode)
  const reversalReason = row.reversalReason === null
    ? null
    : displayText(row.reversalReason, 1000, errorCode)
  if (
    (row.status === 'confirmed' && (reversalId !== null || reversalReason !== null)) ||
    (row.status === 'void' && (reversalId === null || reversalReason === null))
  ) throw fail(errorCode)
  return { reversalId, reversalReason }
}

function transferResponse(value, request, viewCost) {
  const errorCode = 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'
  const row = exactObject(value, [
    'id', 'status', 'variantId', 'sourceWarehouseId', 'sourceLocationId',
    'destinationWarehouseId', 'destinationLocationId', 'quantity', 'totalCost',
    'confirmedByEmployeeProfileId', 'confirmedAt', 'idempotencyKey', 'movementIds',
    'reversalId', 'reversalReason',
  ], errorCode)
  const result = {
    id: uuid(row.id, errorCode),
    status: row.status,
    variantId: uuid(row.variantId, errorCode),
    sourceWarehouseId: uuid(row.sourceWarehouseId, errorCode),
    sourceLocationId: uuid(row.sourceLocationId, errorCode),
    destinationWarehouseId: uuid(row.destinationWarehouseId, errorCode),
    destinationLocationId: uuid(row.destinationLocationId, errorCode),
    quantity: quantity(row.quantity, errorCode).value,
    totalCost: nullableCost(row.totalCost, errorCode, viewCost),
    confirmedByEmployeeProfileId: uuid(row.confirmedByEmployeeProfileId, errorCode),
    confirmedAt: timestamp(row.confirmedAt, errorCode),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, errorCode),
    movementIds: transferMovementIds(row.movementIds, errorCode),
    ...operationOutcome(row, errorCode),
  }
  if (
    result.id !== request.transferId || result.variantId !== request.variantId ||
    result.sourceWarehouseId !== request.sourceWarehouseId ||
    result.sourceLocationId !== request.sourceLocationId ||
    result.destinationWarehouseId !== request.destinationWarehouseId ||
    result.destinationLocationId !== request.destinationLocationId ||
    quantity(result.quantity, errorCode).units !== quantity(request.quantity, errorCode).units ||
    result.idempotencyKey !== request.idempotencyKey
  ) throw fail(errorCode)
  return deepFreeze(result)
}

function stocktakeResponse(value, request, viewCost) {
  const errorCode = 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'
  const row = exactObject(value, [
    'id', 'warehouseId', 'stocktakeMonth', 'status', 'confirmedByEmployeeProfileId',
    'confirmedAt', 'idempotencyKey', 'reversalId', 'reversalReason', 'lines',
  ], errorCode)
  const expected = new Map(request.lines.map((line) => [line.stocktakeLineId, line]))
  const lines = denseArray(row.lines, errorCode).map((value) => {
    const line = exactObject(value, [
      'id', 'variantId', 'locationId', 'bookQuantity', 'countedQuantity',
      'quantityDelta', 'differenceType', 'reason', 'totalCost', 'movementIds',
    ], errorCode)
    if (!['gain', 'loss', 'damaged', 'scrapped', 'no_change'].includes(line.differenceType)) {
      throw fail(errorCode)
    }
    const bookQuantity = quantity(line.bookQuantity, errorCode, { positive: false })
    const countedQuantity = quantity(line.countedQuantity, errorCode, { positive: false })
    const quantityDelta = signedQuantity(line.quantityDelta, errorCode)
    const expectedDelta = countedQuantity.units - bookQuantity.units
    const expectedType = expectedDelta > 0n
      ? 'gain'
      : expectedDelta === 0n
        ? 'no_change'
        : null
    const reason = line.reason === '' ? '' : displayText(line.reason, 1000, errorCode)
    if (
      quantityDelta.units !== expectedDelta ||
      (expectedType !== null && line.differenceType !== expectedType) ||
      (expectedDelta < 0n && !['loss', 'damaged', 'scrapped'].includes(line.differenceType)) ||
      (expectedDelta === 0n ? reason !== '' : reason === '')
    ) throw fail(errorCode)
    const normalized = {
      id: uuid(line.id, errorCode),
      variantId: uuid(line.variantId, errorCode),
      locationId: uuid(line.locationId, errorCode),
      bookQuantity: bookQuantity.value,
      countedQuantity: countedQuantity.value,
      quantityDelta: quantityDelta.value,
      differenceType: line.differenceType,
      reason,
      totalCost: nullableCost(line.totalCost, errorCode, viewCost),
      movementIds: movementIds(line.movementIds, errorCode),
    }
    const input = expected.get(normalized.id)
    if (
      !input || normalized.variantId !== input.variantId ||
      normalized.locationId !== input.locationId ||
      quantity(normalized.countedQuantity, errorCode, { positive: false }).units !==
        quantity(input.countedQuantity, errorCode, { positive: false }).units ||
      normalized.differenceType !== input.differenceType || normalized.reason !== input.reason
    ) throw fail(errorCode)
    expected.delete(normalized.id)
    return normalized
  })
  const result = {
    id: uuid(row.id, errorCode),
    warehouseId: uuid(row.warehouseId, errorCode),
    stocktakeMonth: text(row.stocktakeMonth, /^\d{4}-(?:0[1-9]|1[0-2])$/u, errorCode),
    status: row.status,
    confirmedByEmployeeProfileId: uuid(row.confirmedByEmployeeProfileId, errorCode),
    confirmedAt: timestamp(row.confirmedAt, errorCode),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, errorCode),
    ...operationOutcome(row, errorCode),
    lines,
  }
  if (
    result.id !== request.stocktakeId || result.warehouseId !== request.warehouseId ||
    result.stocktakeMonth !== request.stocktakeMonth ||
    result.idempotencyKey !== request.idempotencyKey || expected.size !== 0
  ) throw fail(errorCode)
  return deepFreeze(result)
}

function reversalResponse(value, request, viewCost) {
  const errorCode = 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'
  const row = exactObject(value, [
    'id', 'sourceDocumentType', 'sourceDocumentId', 'status', 'reason',
    'reversedByEmployeeProfileId', 'reversedAt', 'idempotencyKey', 'movementIds',
    'costAdjustment',
  ], errorCode)
  const result = {
    id: uuid(row.id, errorCode),
    sourceDocumentType: row.sourceDocumentType,
    sourceDocumentId: uuid(row.sourceDocumentId, errorCode),
    status: row.status,
    reason: displayText(row.reason, 1000, errorCode),
    reversedByEmployeeProfileId: uuid(row.reversedByEmployeeProfileId, errorCode),
    reversedAt: timestamp(row.reversedAt, errorCode),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY, errorCode),
    movementIds: movementIds(row.movementIds, errorCode),
    costAdjustment: nullableSignedCost(row.costAdjustment, errorCode, viewCost),
  }
  if (
    result.sourceDocumentType !== request.sourceDocumentType ||
    result.sourceDocumentId !== request.sourceDocumentId || result.status !== 'confirmed' ||
    result.reason !== request.reason || result.idempotencyKey !== request.idempotencyKey
  ) throw fail(errorCode)
  return deepFreeze(result)
}

function requestContextResponse(value, viewCost) {
  const errorCode = 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID'
  const root = exactObject(value, [
    'stockOutRequests', 'returnRequests', 'minorWorkOrders',
  ], errorCode)
  const rows = (input, maximum = 1000) => denseArray(input, errorCode, {
    minimum: 0, maximum,
  })
  const nullableTimestamp = (input) => input === null ? null : timestamp(input, errorCode)
  const nullableProfile = (input) => input === null ? null : uuid(input, errorCode)
  const nullableRecordKey = (input) => input === null ? null : text(input, RECORD_KEY, errorCode)
  const contextCost = (input, { positive = false, nonnegative = false } = {}) => {
    if (input === null) return null
    if (!viewCost) throw fail(errorCode)
    const normalized = nullableCost(input, errorCode, true)
    if ((positive && normalized <= 0) || (nonnegative && normalized < 0)) throw fail(errorCode)
    return normalized
  }
  const contextQuantity = (input, { nullable = false, positive = true } = {}) => {
    if (nullable && input === null) return null
    return quantity(input, errorCode, { positive }).value
  }
  const status = (input) => {
    if (!['pending', 'confirmed', 'rejected', 'void'].includes(input)) throw fail(errorCode)
    return input
  }
  const destination = (type, projectId, minorWorkOrderId) => {
    if (
      (type === 'project' && projectId !== null && minorWorkOrderId === null) ||
      (type === 'minor_work_order' && projectId === null && minorWorkOrderId !== null) ||
      (type === 'internal_use' && projectId === null && minorWorkOrderId === null)
    ) return
    throw fail(errorCode)
  }
  const outcome = (row, normalizedStatus) => {
    const confirmedByEmployeeProfileId = nullableProfile(row.confirmedByEmployeeProfileId)
    const confirmedAt = nullableTimestamp(row.confirmedAt)
    const rejectionReason = row.rejectionReason === null
      ? null
      : displayText(row.rejectionReason, 1000, errorCode)
    if (
      (normalizedStatus === 'confirmed' &&
        (confirmedByEmployeeProfileId === null || confirmedAt === null || rejectionReason !== null)) ||
      (['rejected', 'void'].includes(normalizedStatus) &&
        (confirmedByEmployeeProfileId === null || confirmedAt === null || rejectionReason === null)) ||
      (normalizedStatus === 'pending' &&
        (confirmedByEmployeeProfileId !== null || confirmedAt !== null || rejectionReason !== null))
    ) throw fail(errorCode)
    return { confirmedByEmployeeProfileId, confirmedAt, rejectionReason }
  }
  const stockOutRequests = rows(root.stockOutRequests).map((value) => {
    const row = exactObject(value, [
      'id', 'destinationType', 'projectId', 'minorWorkOrderId',
      'destinationNameSnapshot', 'purpose', 'receiver', 'requestDate', 'status',
      'submittedByEmployeeProfileId', 'submittedAt', 'confirmedByEmployeeProfileId',
      'confirmedAt', 'rejectionReason', 'lines',
    ], errorCode)
    const normalizedStatus = status(row.status)
    const normalized = {
      id: uuid(row.id, errorCode),
      destinationType: ['project', 'minor_work_order', 'internal_use'].includes(row.destinationType)
        ? row.destinationType
        : (() => { throw fail(errorCode) })(),
      projectId: nullableRecordKey(row.projectId),
      minorWorkOrderId: nullableProfile(row.minorWorkOrderId),
      destinationNameSnapshot: displayText(row.destinationNameSnapshot, 500, errorCode),
      purpose: displayText(row.purpose, 1000, errorCode),
      receiver: displayText(row.receiver, 300, errorCode),
      requestDate: text(row.requestDate, DATE, errorCode),
      status: normalizedStatus,
      submittedByEmployeeProfileId: uuid(row.submittedByEmployeeProfileId, errorCode),
      submittedAt: timestamp(row.submittedAt, errorCode),
      ...outcome(row, normalizedStatus),
      lines: rows(row.lines, 100).map((value) => {
        const line = exactObject(value, [
          'id', 'requestId', 'variantId', 'requestedQuantity', 'confirmedQuantity',
          'remainingReturnable', 'frozenTotalCost',
        ], errorCode)
        const normalizedLine = {
          id: uuid(line.id, errorCode),
          requestId: uuid(line.requestId, errorCode),
          variantId: uuid(line.variantId, errorCode),
          requestedQuantity: contextQuantity(line.requestedQuantity),
          confirmedQuantity: contextQuantity(line.confirmedQuantity, { nullable: true }),
          remainingReturnable: contextQuantity(line.remainingReturnable, { positive: false }),
          frozenTotalCost: contextCost(line.frozenTotalCost, { nonnegative: true }),
        }
        if (
          normalizedLine.requestId !== uuid(row.id, errorCode) ||
          (normalizedLine.confirmedQuantity !== null &&
            normalizedLine.confirmedQuantity > normalizedLine.requestedQuantity) ||
          normalizedLine.remainingReturnable > (normalizedLine.confirmedQuantity ?? 0)
        ) throw fail(errorCode)
        const confirmedGroup = normalizedLine.confirmedQuantity !== null &&
          (!viewCost || normalizedLine.frozenTotalCost !== null)
        const emptyGroup = normalizedLine.confirmedQuantity === null &&
          normalizedLine.frozenTotalCost === null && normalizedLine.remainingReturnable === 0
        if (
          (normalizedStatus === 'confirmed' && !confirmedGroup) ||
          (['pending', 'rejected'].includes(normalizedStatus) && !emptyGroup) ||
          (normalizedStatus === 'void' && !confirmedGroup && !emptyGroup)
        ) throw fail(errorCode)
        return normalizedLine
      }),
    }
    destination(normalized.destinationType, normalized.projectId, normalized.minorWorkOrderId)
    return normalized
  })
  const returnRequests = rows(root.returnRequests).map((value) => {
    const row = exactObject(value, [
      'id', 'originalStockOutId', 'destinationType', 'projectId', 'minorWorkOrderId',
      'destinationNameSnapshot', 'reason', 'receiver', 'requestDate', 'status',
      'submittedByEmployeeProfileId', 'submittedAt', 'confirmedByEmployeeProfileId',
      'confirmedAt', 'rejectionReason', 'lines',
    ], errorCode)
    const normalizedStatus = status(row.status)
    const normalized = {
      id: uuid(row.id, errorCode),
      originalStockOutId: uuid(row.originalStockOutId, errorCode),
      destinationType: ['project', 'minor_work_order', 'internal_use'].includes(row.destinationType)
        ? row.destinationType
        : (() => { throw fail(errorCode) })(),
      projectId: nullableRecordKey(row.projectId),
      minorWorkOrderId: nullableProfile(row.minorWorkOrderId),
      destinationNameSnapshot: displayText(row.destinationNameSnapshot, 500, errorCode),
      reason: displayText(row.reason, 1000, errorCode),
      receiver: displayText(row.receiver, 300, errorCode),
      requestDate: text(row.requestDate, DATE, errorCode),
      status: normalizedStatus,
      submittedByEmployeeProfileId: uuid(row.submittedByEmployeeProfileId, errorCode),
      submittedAt: timestamp(row.submittedAt, errorCode),
      ...outcome(row, normalizedStatus),
      lines: rows(row.lines, 100).map((value) => {
        const line = exactObject(value, [
          'id', 'returnId', 'originalStockOutLineId', 'variantId', 'requestedQuantity',
          'confirmedQuantity', 'frozenTotalCost',
        ], errorCode)
        const normalizedLine = {
          id: uuid(line.id, errorCode),
          returnId: uuid(line.returnId, errorCode),
          originalStockOutLineId: uuid(line.originalStockOutLineId, errorCode),
          variantId: uuid(line.variantId, errorCode),
          requestedQuantity: contextQuantity(line.requestedQuantity),
          confirmedQuantity: contextQuantity(line.confirmedQuantity, { nullable: true }),
          frozenTotalCost: contextCost(line.frozenTotalCost, { nonnegative: true }),
        }
        if (
          normalizedLine.returnId !== uuid(row.id, errorCode) ||
          (normalizedLine.confirmedQuantity !== null &&
            normalizedLine.confirmedQuantity > normalizedLine.requestedQuantity)
        ) throw fail(errorCode)
        const confirmedGroup = normalizedLine.confirmedQuantity !== null &&
          (!viewCost || normalizedLine.frozenTotalCost !== null)
        const emptyGroup = normalizedLine.confirmedQuantity === null &&
          normalizedLine.frozenTotalCost === null
        if (
          (normalizedStatus === 'confirmed' && !confirmedGroup) ||
          (['pending', 'rejected'].includes(normalizedStatus) && !emptyGroup) ||
          (normalizedStatus === 'void' && !confirmedGroup && !emptyGroup)
        ) throw fail(errorCode)
        return normalizedLine
      }),
    }
    destination(normalized.destinationType, normalized.projectId, normalized.minorWorkOrderId)
    return normalized
  })
  const minorWorkOrders = rows(root.minorWorkOrders).map((value) => {
    const row = exactObject(value, [
      'id', 'title', 'customerName', 'workDate', 'locationText', 'description',
      'status', 'assignedProjectId', 'materialCost', 'createdByEmployeeProfileId',
      'createdAt', 'updatedAt',
    ], errorCode)
    const normalized = {
      id: uuid(row.id, errorCode),
      title: displayText(row.title, 300, errorCode),
      customerName: displayText(row.customerName, 300, errorCode),
      workDate: text(row.workDate, DATE, errorCode),
      locationText: displayText(row.locationText, 500, errorCode),
      description: displayText(row.description, 2000, errorCode, { required: false }),
      status: ['open', 'assigned', 'closed', 'void'].includes(row.status)
        ? row.status
        : (() => { throw fail(errorCode) })(),
      assignedProjectId: nullableRecordKey(row.assignedProjectId),
      materialCost: contextCost(row.materialCost, { nonnegative: true }),
      createdByEmployeeProfileId: uuid(row.createdByEmployeeProfileId, errorCode),
      createdAt: timestamp(row.createdAt, errorCode),
      updatedAt: timestamp(row.updatedAt, errorCode),
    }
    if (
      (normalized.status === 'open' && normalized.assignedProjectId !== null) ||
      (normalized.status === 'assigned' && normalized.assignedProjectId === null)
    ) throw fail(errorCode)
    return normalized
  })
  return deepFreeze({ stockOutRequests, returnRequests, minorWorkOrders })
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
    const success = Object.hasOwn(descriptors, 'success')
      ? descriptors.success.value
      : undefined
    if (
      (error !== null && !ownObject(error)) ||
      (success !== undefined && typeof success !== 'boolean') ||
      (status !== undefined && (!Number.isSafeInteger(status) || status < 100 || status > 599)) ||
      (statusText !== undefined && statusText !== null && typeof statusText !== 'string') ||
      (count !== undefined && count !== null && (!Number.isSafeInteger(count) || count < 0))
    ) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
    if (error) throw normalizeSupplierError(error, status)
    if (success === false) throw fail('WAREHOUSE_CONFIRMATION_RESPONSE_INVALID')
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
    async confirmReturn(input) {
      const request = returnConfirmationRequest(input)
      return returnResponse(await call('confirm_warehouse_return_secure', {
        p_return_id: request.documentId,
        p_lines: request.lines,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
    async rejectStockOut(input) {
      const request = rejectionRequest(input, 'requestId')
      return stockOutRejectionResponse(await call('reject_warehouse_stock_out_secure', {
        p_request_id: request.documentId,
        p_reason: request.reason,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
    async rejectReturn(input) {
      const request = rejectionRequest(input, 'returnId')
      return returnRejectionResponse(await call('reject_warehouse_return_secure', {
        p_return_id: request.documentId,
        p_reason: request.reason,
        p_idempotency_key: request.idempotencyKey,
      }), request)
    },
    async confirmTransfer(input) {
      let request
      try {
        request = buildTransferConfirmationCommand(input)
      } catch {
        throw fail('WAREHOUSE_CONFIRMATION_INPUT_INVALID')
      }
      return transferResponse(await call('confirm_warehouse_transfer_secure', {
        p_transfer_id: request.transferId,
        p_variant_id: request.variantId,
        p_source_warehouse_id: request.sourceWarehouseId,
        p_source_location_id: request.sourceLocationId,
        p_destination_warehouse_id: request.destinationWarehouseId,
        p_destination_location_id: request.destinationLocationId,
        p_quantity: request.quantity,
        p_reason: request.reason,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
    async confirmStocktake(input) {
      let request
      try {
        request = buildStocktakeConfirmationCommand(input)
      } catch {
        throw fail('WAREHOUSE_CONFIRMATION_INPUT_INVALID')
      }
      if (!viewCost && request.lines.some((line) => line.approvedUnitCost !== null)) {
        throw fail('WAREHOUSE_CONFIRMATION_INPUT_INVALID')
      }
      return stocktakeResponse(await call('confirm_warehouse_stocktake_secure', {
        p_stocktake_id: request.stocktakeId,
        p_warehouse_id: request.warehouseId,
        p_stocktake_month: request.stocktakeMonth,
        p_lines: request.lines,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
    async reverseOperation(input) {
      let request
      try {
        request = buildOperationReversalCommand(input)
      } catch {
        throw fail('WAREHOUSE_CONFIRMATION_INPUT_INVALID')
      }
      return reversalResponse(await call('reverse_warehouse_operation_secure', {
        p_source_document_type: request.sourceDocumentType,
        p_source_document_id: request.sourceDocumentId,
        p_reason: request.reason,
        p_idempotency_key: request.idempotencyKey,
      }), request, viewCost)
    },
    async listRequestContext() {
      return requestContextResponse(
        await call('list_warehouse_request_context_secure', {}),
        viewCost,
      )
    },
  })
}

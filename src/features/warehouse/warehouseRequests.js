import {
  parseQuantityUnits,
  quantityUnitsToNumber,
} from './warehouseDecimal.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const EDGE_TRIM = /^[\s\u200b\u200c\u200d\u2060]+|[\s\u200b\u200c\u200d\u2060]+$/gu
const INTERNAL_INVISIBLE = /[\ufeff\u200b\u200c\u200d\u2060]/u

function invalid() {
  return new TypeError('仓库申请数据无效')
}

function exactObject(value, fields) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key)) ||
    fields.some((field) => !Object.hasOwn(descriptors, field)) ||
    Object.values(descriptors).some((descriptor) =>
      !('value' in descriptor) || descriptor.enumerable !== true)
  ) throw invalid()
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
}

function exactArray(value, minimum = 1, maximum = 100) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw invalid()
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = descriptors.length?.value
  if (
    !Number.isSafeInteger(length) || length < minimum || length > maximum ||
    Object.keys(descriptors).length !== length + 1 ||
    Array.from({ length }, (_, index) => descriptors[String(index)]).some(
      (descriptor) => !descriptor || !('value' in descriptor) || descriptor.enumerable !== true,
    )
  ) throw invalid()
  return Array.from({ length }, (_, index) => descriptors[String(index)].value)
}

function text(value, maximum, { required = false } = {}) {
  if (typeof value !== 'string') throw invalid()
  const normalized = value.replace(EDGE_TRIM, '').normalize('NFC')
  if (
    (required && normalized.length === 0) ||
    normalized.length > maximum ||
    INTERNAL_INVISIBLE.test(normalized)
  ) throw invalid()
  return normalized
}

function uuid(value) {
  const normalized = text(value, 36, { required: true })
  if (!UUID.test(normalized)) throw invalid()
  return normalized.toLowerCase()
}

function nullableUuid(value) {
  return value === null ? null : uuid(value)
}

function recordKey(value) {
  const normalized = text(value, 200, { required: true })
  if (!RECORD_KEY.test(normalized)) throw invalid()
  return normalized
}

function idempotencyKey(value) {
  const normalized = text(value, 200, { required: true })
  if (!IDEMPOTENCY_KEY.test(normalized)) throw invalid()
  return normalized
}

function date(value) {
  const normalized = text(value, 10, { required: true })
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(normalized)
  if (!match) throw invalid()
  const [year, month, day] = match.slice(1).map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) throw invalid()
  return normalized
}

function quantity(value) {
  try {
    const units = parseQuantityUnits(value)
    if (units <= 0n) throw invalid()
    return quantityUnitsToNumber(units)
  } catch {
    throw invalid()
  }
}

function freeze(value) {
  if (Array.isArray(value)) {
    for (const item of value) freeze(item)
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
  }
  return Object.freeze(value)
}

function receiptLine(value) {
  const line = exactObject(value, [
    'variantId', 'requestedQuantity', 'warehouseId', 'locationId',
  ])
  const warehouseId = nullableUuid(line.warehouseId)
  const locationId = nullableUuid(line.locationId)
  if ((warehouseId === null) !== (locationId === null)) throw invalid()
  return {
    variantId: uuid(line.variantId),
    requestedQuantity: quantity(line.requestedQuantity),
    warehouseId,
    locationId,
  }
}

function stockOutLine(value) {
  const line = exactObject(value, ['variantId', 'requestedQuantity'])
  return {
    variantId: uuid(line.variantId),
    requestedQuantity: quantity(line.requestedQuantity),
  }
}

function returnLine(value) {
  const line = exactObject(value, ['originalStockOutLineId', 'requestedQuantity'])
  return {
    originalStockOutLineId: uuid(line.originalStockOutLineId),
    requestedQuantity: quantity(line.requestedQuantity),
  }
}

export function buildMinorWorkOrderRequest(input) {
  const value = exactObject(input, [
    'title', 'customerName', 'workDate', 'locationText', 'description',
  ])
  return freeze({
    p_payload: {
      title: text(value.title, 300, { required: true }),
      customerName: text(value.customerName, 300, { required: true }),
      workDate: date(value.workDate),
      locationText: text(value.locationText, 500, { required: true }),
      description: text(value.description, 2000),
    },
  })
}

export function buildMinorWorkOrderAssignment(input) {
  const value = exactObject(input, ['minorWorkOrderId', 'projectId'])
  return freeze({
    p_minor_work_order_id: uuid(value.minorWorkOrderId),
    p_project_id: recordKey(value.projectId),
  })
}

export function buildWarehouseReceiptRequest(input) {
  const value = exactObject(input, ['purchaseRecordKey', 'idempotencyKey', 'lines'])
  return freeze({
    p_purchase_record_key: recordKey(value.purchaseRecordKey),
    p_lines: exactArray(value.lines).map(receiptLine),
    p_idempotency_key: idempotencyKey(value.idempotencyKey),
  })
}

export function buildWarehouseStockOutRequest(input) {
  const value = exactObject(input, [
    'destinationType', 'projectId', 'minorWorkOrderId', 'destinationNameSnapshot',
    'purpose', 'receiver', 'requestDate', 'idempotencyKey', 'lines',
  ])
  const destinationType = text(value.destinationType, 30, { required: true })
  const projectId = value.projectId === null ? null : recordKey(value.projectId)
  const minorWorkOrderId = nullableUuid(value.minorWorkOrderId)
  if (
    !['project', 'minor_work_order', 'internal_use'].includes(destinationType) ||
    (destinationType === 'project' && (projectId === null || minorWorkOrderId !== null)) ||
    (destinationType === 'minor_work_order' && (projectId !== null || minorWorkOrderId === null)) ||
    (destinationType === 'internal_use' && (projectId !== null || minorWorkOrderId !== null))
  ) throw invalid()
  return freeze({
    p_request: {
      destinationType,
      projectId,
      minorWorkOrderId,
      destinationNameSnapshot: text(value.destinationNameSnapshot, 500, { required: true }),
      purpose: text(value.purpose, 1000, { required: true }),
      receiver: text(value.receiver, 300, { required: true }),
      requestDate: date(value.requestDate),
    },
    p_lines: exactArray(value.lines).map(stockOutLine),
    p_idempotency_key: idempotencyKey(value.idempotencyKey),
  })
}

export function buildWarehouseReturnRequest(input) {
  const value = exactObject(input, [
    'originalStockOutId', 'reason', 'receiver', 'requestDate', 'idempotencyKey', 'lines',
  ])
  return freeze({
    p_original_stock_out_id: uuid(value.originalStockOutId),
    p_request: {
      reason: text(value.reason, 1000, { required: true }),
      receiver: text(value.receiver, 300, { required: true }),
      requestDate: date(value.requestDate),
    },
    p_lines: exactArray(value.lines).map(returnLine),
    p_idempotency_key: idempotencyKey(value.idempotencyKey),
  })
}

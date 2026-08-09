import {
  costUnitsToNumber,
  parseCostUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from './warehouseDecimal.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/u
const DIFFERENCE_TYPES = new Set(['gain', 'loss', 'damaged', 'scrapped', 'no_change'])
const REVERSIBLE_DOCUMENT_TYPES = new Set([
  'warehouse_receipt',
  'warehouse_stock_out',
  'warehouse_return',
  'warehouse_transfer',
  'warehouse_stocktake',
])

function invalid() {
  return new TypeError('仓库操作数据无效')
}

function ownExact(value, fields) {
  if (
    value === null || typeof value !== 'object' || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) throw invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    Object.keys(descriptors).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(descriptors, field)) ||
    Object.keys(descriptors).some((field) => !fields.includes(field)) ||
    Object.values(descriptors).some((descriptor) =>
      !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true)
  ) throw invalid()
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
}

function denseArray(value, { minimum = 1, maximum = 100 } = {}) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = descriptors.length?.value
  if (
    !Number.isSafeInteger(length) || length < minimum || length > maximum ||
    Reflect.ownKeys(descriptors).length !== length + 1
  ) throw invalid()
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)]
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) {
      throw invalid()
    }
    return descriptor.value
  })
}

function text(value, pattern, maximum = 200) {
  if (
    typeof value !== 'string' || value !== value.trim() || value.length < 1 ||
    value.length > maximum || (pattern && !pattern.test(value))
  ) throw invalid()
  return value
}

function uuid(value) {
  return text(value, UUID).toLowerCase()
}

function quantity(value, { positive }) {
  try {
    const units = parseQuantityUnits(value)
    if (positive ? units <= 0n : units < 0n) throw invalid()
    return quantityUnitsToNumber(units)
  } catch {
    throw invalid()
  }
}

function nullableCost(value) {
  if (value === null) return null
  try {
    return costUnitsToNumber(parseCostUnits(value))
  } catch {
    throw invalid()
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) value.forEach(deepFreeze)
  else if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

export function buildTransferConfirmationCommand(input) {
  const row = ownExact(input, [
    'transferId', 'variantId', 'sourceWarehouseId', 'sourceLocationId',
    'destinationWarehouseId', 'destinationLocationId', 'quantity', 'reason',
    'idempotencyKey',
  ])
  const result = {
    transferId: uuid(row.transferId),
    variantId: uuid(row.variantId),
    sourceWarehouseId: uuid(row.sourceWarehouseId),
    sourceLocationId: uuid(row.sourceLocationId),
    destinationWarehouseId: uuid(row.destinationWarehouseId),
    destinationLocationId: uuid(row.destinationLocationId),
    quantity: quantity(row.quantity, { positive: true }),
    reason: text(row.reason, null, 1000),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY),
  }
  if (
    result.sourceWarehouseId === result.destinationWarehouseId &&
    result.sourceLocationId === result.destinationLocationId
  ) throw invalid()
  return deepFreeze(result)
}

export function buildStocktakeConfirmationCommand(input) {
  const row = ownExact(input, [
    'stocktakeId', 'warehouseId', 'stocktakeMonth', 'idempotencyKey', 'lines',
  ])
  const lines = denseArray(row.lines).map((value) => {
    const line = ownExact(value, [
      'stocktakeLineId', 'variantId', 'locationId', 'countedQuantity',
      'differenceType', 'reason', 'approvedUnitCost',
    ])
    if (!DIFFERENCE_TYPES.has(line.differenceType)) throw invalid()
    const reason = line.reason === '' ? '' : text(line.reason, null, 1000)
    const approvedUnitCost = nullableCost(line.approvedUnitCost)
    if (approvedUnitCost !== null && line.differenceType !== 'gain') throw invalid()
    if (line.differenceType === 'no_change' ? reason !== '' : reason === '') throw invalid()
    return {
      stocktakeLineId: uuid(line.stocktakeLineId),
      variantId: uuid(line.variantId),
      locationId: uuid(line.locationId),
      countedQuantity: quantity(line.countedQuantity, { positive: false }),
      differenceType: line.differenceType,
      reason,
      approvedUnitCost,
    }
  })
  const identities = lines.map((line) => `${line.variantId}:${line.locationId}`)
  const lineIds = lines.map((line) => line.stocktakeLineId)
  if (new Set(identities).size !== lines.length || new Set(lineIds).size !== lines.length) {
    throw invalid()
  }
  return deepFreeze({
    stocktakeId: uuid(row.stocktakeId),
    warehouseId: uuid(row.warehouseId),
    stocktakeMonth: text(row.stocktakeMonth, MONTH, 7),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY),
    lines,
  })
}

export function buildOperationReversalCommand(input) {
  const row = ownExact(input, [
    'sourceDocumentType', 'sourceDocumentId', 'reason', 'idempotencyKey',
  ])
  if (!REVERSIBLE_DOCUMENT_TYPES.has(row.sourceDocumentType)) throw invalid()
  return deepFreeze({
    sourceDocumentType: row.sourceDocumentType,
    sourceDocumentId: uuid(row.sourceDocumentId),
    reason: text(row.reason, null, 1000),
    idempotencyKey: text(row.idempotencyKey, IDEMPOTENCY_KEY),
  })
}

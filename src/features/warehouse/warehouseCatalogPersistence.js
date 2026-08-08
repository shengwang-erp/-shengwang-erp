import {
  costUnitsToNumber,
  parseCostUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from './warehouseDecimal.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function invalid() {
  return new TypeError('仓库目录数据无效')
}

function exactInput(value, fields) {
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
    fields.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.values(descriptors).some((descriptor) =>
      !('value' in descriptor) || descriptor.enumerable !== true)
  ) throw invalid()
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid()
  return value.toLowerCase()
}

function text(value, maximum, { required = false } = {}) {
  if (typeof value !== 'string') throw invalid()
  const normalized = value.trim().normalize('NFC')
  if ((required && normalized.length === 0) || normalized.length > maximum) throw invalid()
  return normalized
}

function active(value) {
  if (typeof value !== 'boolean') throw invalid()
  return value
}

function scaledQuantity(value) {
  try {
    return quantityUnitsToNumber(parseQuantityUnits(value))
  } catch {
    throw invalid()
  }
}

function scaledCost(value) {
  try {
    return costUnitsToNumber(parseCostUnits(value))
  } catch {
    throw invalid()
  }
}

function result(id, payload) {
  return Object.freeze({ id, payload: Object.freeze(payload) })
}

export function buildWarehouseSiteMutation(input) {
  const row = exactInput(input, ['id', 'code', 'name', 'kind', 'active'])
  const id = uuid(row.id)
  const kind = text(row.kind, 30, { required: true })
  if (!['normal', 'project_site', 'shared_tool'].includes(kind)) throw invalid()
  return result(id, {
    id,
    code: text(row.code, 100, { required: true }),
    name: text(row.name, 200, { required: true }),
    kind,
    active: active(row.active),
  })
}

export function buildWarehouseLocationMutation(input) {
  const row = exactInput(
    input, ['id', 'warehouseId', 'shelfCode', 'shelfName', 'active'],
  )
  const id = uuid(row.id)
  return result(id, {
    id,
    warehouseId: uuid(row.warehouseId),
    shelfCode: text(row.shelfCode, 100, { required: true }),
    shelfName: text(row.shelfName, 200, { required: true }),
    active: active(row.active),
  })
}

export function buildWarehouseItemMutation(input) {
  const row = exactInput(
    input, ['id', 'name', 'category', 'brand', 'description', 'active'],
  )
  const id = uuid(row.id)
  return result(id, {
    id,
    name: text(row.name, 300, { required: true }),
    category: text(row.category, 200),
    brand: text(row.brand, 200),
    description: text(row.description, 2000),
    active: active(row.active),
  })
}

export function buildWarehouseVariantMutation(input) {
  const row = exactInput(input, [
    'id', 'itemId', 'sku', 'model', 'size', 'material', 'unit', 'minimumStock',
    'defaultPurchasePrice', 'manufacturerQr', 'active',
  ])
  const id = uuid(row.id)
  const manufacturerQr = row.manufacturerQr === null
    ? null
    : text(row.manufacturerQr, 500)
  if (manufacturerQr?.toLocaleLowerCase('en-US').startsWith('swerp:variant:')) {
    throw invalid()
  }
  return result(id, {
    id,
    itemId: uuid(row.itemId),
    sku: text(row.sku, 100, { required: true }),
    model: text(row.model, 300),
    size: text(row.size, 300),
    material: text(row.material, 300),
    unit: text(row.unit, 50, { required: true }),
    minimumStock: scaledQuantity(row.minimumStock),
    defaultPurchasePrice: scaledCost(row.defaultPurchasePrice),
    manufacturerQr: manufacturerQr || null,
    active: active(row.active),
  })
}

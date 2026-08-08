const ITEM_FIELDS = Object.freeze([
  'id', 'name', 'category', 'brand', 'description', 'active', 'createdAt', 'updatedAt',
])
const VARIANT_FIELDS = Object.freeze([
  'id', 'itemId', 'sku', 'model', 'size', 'material', 'unit', 'minimumStock',
  'systemQr', 'manufacturerQr', 'active', 'createdAt', 'updatedAt',
])
const LOCATION_FIELDS = Object.freeze([
  'id', 'warehouseId', 'shelfCode', 'shelfName', 'active', 'createdAt', 'updatedAt',
])
const BALANCE_FIELDS = Object.freeze(['variantId', 'warehouseId', 'locationId', 'quantity'])
const INVALID = '仓库快照数据无效'

function invalid() {
  return new TypeError(INVALID)
}

function plainDescriptors(value) {
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

function exactObject(value, required, optional = []) {
  const descriptors = plainDescriptors(value)
  const allowed = new Set([...required, ...optional])
  if (
    !descriptors ||
    required.some((key) => !Object.hasOwn(descriptors, key)) ||
    Object.keys(descriptors).some((key) => !allowed.has(key))
  ) throw invalid()
  return Object.fromEntries(
    Object.keys(descriptors).map((key) => [key, descriptors[key].value]),
  )
}

function exactArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = descriptors.length?.value
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    Object.keys(descriptors).length !== length + 1
  ) throw invalid()
  return Array.from({ length }, (_, index) => {
    const descriptor = descriptors[String(index)]
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) throw invalid()
    return descriptor.value
  })
}

function text(value, { empty = false, nullable = false } = {}) {
  if (nullable && value === null) return null
  if (
    typeof value !== 'string' ||
    value !== value.trim() ||
    (!empty && value.length === 0)
  ) throw invalid()
  return value
}

function finite(value, { nonnegative = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || (nonnegative && value < 0)) {
    throw invalid()
  }
  return value
}

function boolean(value) {
  if (typeof value !== 'boolean') throw invalid()
  return value
}

function timestamp(value) {
  const result = text(value)
  if (!Number.isFinite(Date.parse(result))) throw invalid()
  return result
}

function itemValue(value) {
  const row = exactObject(value, ITEM_FIELDS)
  return {
    id: text(row.id),
    name: text(row.name),
    category: text(row.category, { empty: true }),
    brand: text(row.brand, { empty: true }),
    description: text(row.description, { empty: true }),
    active: boolean(row.active),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  }
}

function variantValue(value, viewCost) {
  const row = exactObject(
    value,
    viewCost ? [...VARIANT_FIELDS, 'defaultPurchasePrice'] : VARIANT_FIELDS,
  )
  const result = {
    id: text(row.id),
    itemId: text(row.itemId),
    sku: text(row.sku),
    model: text(row.model, { empty: true }),
    size: text(row.size, { empty: true }),
    material: text(row.material, { empty: true }),
    unit: text(row.unit),
    minimumStock: finite(row.minimumStock, { nonnegative: true }),
    systemQr: text(row.systemQr),
    manufacturerQr: text(row.manufacturerQr, { nullable: true }),
    active: boolean(row.active),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  }
  if (viewCost) {
    result.defaultPurchasePrice = finite(row.defaultPurchasePrice, { nonnegative: true })
  }
  return result
}

function locationValue(value) {
  const row = exactObject(value, LOCATION_FIELDS)
  return {
    id: text(row.id),
    warehouseId: text(row.warehouseId),
    shelfCode: text(row.shelfCode),
    shelfName: text(row.shelfName),
    active: boolean(row.active),
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
  }
}

function balanceValue(value, viewCost) {
  const row = exactObject(
    value,
    viewCost ? [...BALANCE_FIELDS, 'unitCost', 'stockValue'] : BALANCE_FIELDS,
  )
  const result = {
    variantId: text(row.variantId),
    warehouseId: text(row.warehouseId),
    locationId: text(row.locationId),
    quantity: finite(row.quantity, { nonnegative: true }),
  }
  if (viewCost) {
    result.unitCost = finite(row.unitCost, { nonnegative: true })
    result.stockValue = finite(row.stockValue, { nonnegative: true })
  }
  return result
}

function uniqueMap(values, field) {
  const result = new Map()
  for (const value of values) {
    if (result.has(value[field])) throw invalid()
    result.set(value[field], value)
  }
  return result
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

export function buildWarehouseSnapshot(input) {
  const root = exactObject(input, ['items', 'variants', 'locations', 'balances'], ['viewCost'])
  const viewCost = Object.hasOwn(root, 'viewCost') ? root.viewCost : false
  if (typeof viewCost !== 'boolean') throw invalid()

  const items = exactArray(root.items).map(itemValue)
  const variants = exactArray(root.variants).map((value) => variantValue(value, viewCost))
  const locations = exactArray(root.locations).map(locationValue)
  const balances = exactArray(root.balances).map((value) => balanceValue(value, viewCost))
  const itemsById = uniqueMap(items, 'id')
  const variantsById = uniqueMap(variants, 'id')
  const locationsById = uniqueMap(locations, 'id')
  const balanceKeys = new Set()

  for (const variant of variants) {
    if (!itemsById.has(variant.itemId)) throw invalid()
  }
  for (const balance of balances) {
    const location = locationsById.get(balance.locationId)
    if (!variantsById.has(balance.variantId) || !location || location.warehouseId !== balance.warehouseId) {
      throw invalid()
    }
    const key = `${balance.variantId}\u0000${balance.locationId}`
    if (balanceKeys.has(key)) throw invalid()
    balanceKeys.add(key)
  }

  const balancesByVariant = new Map()
  for (const balance of balances) {
    const list = balancesByVariant.get(balance.variantId) ?? []
    list.push(balance)
    balancesByVariant.set(balance.variantId, list)
  }

  const inventory = [...variants]
    .sort((left, right) => compareText(left.sku, right.sku) || compareText(left.id, right.id))
    .map((variant) => {
      const item = itemsById.get(variant.itemId)
      const variantBalances = [...(balancesByVariant.get(variant.id) ?? [])]
        .sort((left, right) => {
          const leftLocation = locationsById.get(left.locationId)
          const rightLocation = locationsById.get(right.locationId)
          return compareText(leftLocation.shelfCode, rightLocation.shelfCode) ||
            compareText(left.locationId, right.locationId)
        })
      const quantity = variantBalances.reduce((sum, balance) => sum + balance.quantity, 0)
      const locationRows = variantBalances.map((balance) => {
        const location = locationsById.get(balance.locationId)
        const row = {
          warehouseId: balance.warehouseId,
          locationId: balance.locationId,
          shelfCode: location.shelfCode,
          shelfName: location.shelfName,
          quantity: balance.quantity,
        }
        if (viewCost) {
          row.unitCost = balance.unitCost
          row.stockValue = balance.stockValue
        }
        return row
      })
      const row = {
        variantId: variant.id,
        itemId: variant.itemId,
        itemName: item.name,
        sku: variant.sku,
        model: variant.model,
        size: variant.size,
        material: variant.material,
        unit: variant.unit,
        minimumStock: variant.minimumStock,
        quantity,
        isLowStock: quantity < variant.minimumStock,
        locations: locationRows,
      }
      if (viewCost) {
        row.stockValue = variantBalances.reduce((sum, balance) => sum + balance.stockValue, 0)
        row.unitCost = quantity > 0 ? row.stockValue / quantity : 0
      }
      return row
    })

  const lowStock = inventory.filter((row) => row.isLowStock)
  const overview = {
    itemCount: items.length,
    variantCount: variants.length,
    locationCount: locations.length,
    stockedVariantCount: inventory.filter((row) => row.quantity > 0).length,
    totalQuantity: inventory.reduce((sum, row) => sum + row.quantity, 0),
    lowStockCount: lowStock.length,
  }
  if (viewCost) {
    overview.totalStockValue = inventory.reduce((sum, row) => sum + row.stockValue, 0)
  }

  return deepFreeze({ overview, inventory, lowStock })
}

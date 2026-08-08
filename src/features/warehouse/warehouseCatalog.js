import { isVariantSystemQrValue, normalizeVariantQrValue } from './warehouseQr.js'

const trimmedText = (value) => String(value ?? '').trim()
const normalizedCatalogName = (value) =>
  trimmedText(value).replace(/\s+/g, ' ').toLocaleLowerCase('zh-CN')

export const buildWarehouseSku = (sequence) =>
  `SW-${String(sequence).padStart(6, '0')}`

export const buildVariantSystemQr = (variantId) =>
  `SWERP:VARIANT:${variantId}`

export function validateVariant(draft = {}, variants = []) {
  const variantId = trimmedText(draft.variantId)
  const sku = trimmedText(draft.sku)
  const manufacturerQr = trimmedText(draft.manufacturerQr)
  const normalizedManufacturerQr = normalizeVariantQrValue(manufacturerQr)
  const systemQr = trimmedText(draft.systemQr)
  const otherVariants = variants.filter(
    (variant) => !variantId || variant.variantId !== variantId,
  )

  if (!sku) return { error: '物品编码不能为空' }
  if (otherVariants.some((variant) => trimmedText(variant.sku) === sku)) {
    return { error: '物品编码已存在' }
  }
  if (manufacturerQr && isVariantSystemQrValue(manufacturerQr)) {
    return { error: '厂家二维码不能使用系统保留前缀' }
  }
  if (manufacturerQr && manufacturerQr === systemQr) {
    return { error: '厂家二维码不能与系统二维码相同' }
  }
  if (
    manufacturerQr
    && otherVariants.some(
      (variant) => (
        normalizeVariantQrValue(variant.manufacturerQr) === normalizedManufacturerQr
        || trimmedText(variant.systemQr) === manufacturerQr
      ),
    )
  ) {
    return { error: '厂家二维码已存在' }
  }
  if (
    systemQr
    && otherVariants.some((variant) => (
      trimmedText(variant.systemQr) === systemQr
      || trimmedText(variant.manufacturerQr) === systemQr
    ))
  ) {
    return { error: '系统二维码已存在' }
  }

  return { error: '' }
}

export function validateWarehouseLocation(draft = {}, locations = []) {
  const warehouseName = trimmedText(draft.warehouseName)
  const shelfCode = trimmedText(draft.shelfCode)
  const shelfName = trimmedText(draft.shelfName)

  if (!warehouseName) return { error: '仓库名称不能为空' }
  if (!shelfCode) return { error: '货架编码不能为空' }
  if (!shelfName) return { error: '货架名称不能为空' }

  const currentLocation = locations.find(
    (location) => location.locationId === draft.locationId,
  )
  const draftWarehouseId = trimmedText(
    draft.warehouseId || currentLocation?.warehouseId,
  )
  const matchingWarehouseIds = new Set(
    locations
      .filter((location) => (
        normalizedCatalogName(location.warehouseName)
          === normalizedCatalogName(warehouseName)
      ))
      .map((location) => trimmedText(location.warehouseId))
      .filter(Boolean),
  )
  const warehouseNameOwnerCollision = draftWarehouseId
    ? [...matchingWarehouseIds].some((warehouseId) => warehouseId !== draftWarehouseId)
    : matchingWarehouseIds.size > 1
  if (warehouseNameOwnerCollision) {
    return { error: '仓库名称已被其他仓库使用' }
  }

  const duplicate = locations.some((location) => (
    location.locationId !== draft.locationId
    && normalizedCatalogName(location.warehouseName)
      === normalizedCatalogName(warehouseName)
    && trimmedText(location.shelfCode) === shelfCode
  ))
  return duplicate
    ? { error: '该仓库的货架编码已存在' }
    : { error: '' }
}

export function nextCatalogId(prefix, records = [], field) {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^${escapedPrefix}(\\d+)$`)
  const maxSequence = records.reduce((max, record) => {
    const match = trimmedText(record[field]).match(pattern)
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)
  return `${prefix}${String(maxSequence + 1).padStart(6, '0')}`
}

export function getNextVariantSequence(variants = []) {
  return variants.reduce((max, variant) => {
    const variantSequence = Number(trimmedText(variant.variantId).match(/^V(\d+)$/)?.[1] || 0)
    const skuSequence = Number(trimmedText(variant.sku).match(/^SW-(\d+)$/)?.[1] || 0)
    return Math.max(max, variantSequence, skuSequence)
  }, 0) + 1
}

export function refreshVariantDraftIdentifiers(
  draft = {},
  variants = [],
  preserveSku = false,
  createId = () => globalThis.crypto.randomUUID(),
) {
  const sequence = getNextVariantSequence(variants)
  const variantId = trimmedText(draft.variantId) || createId()
  return {
    ...draft,
    variantId,
    sku: preserveSku ? draft.sku : buildWarehouseSku(sequence),
    systemQr: buildVariantSystemQr(variantId),
  }
}

export function validateVariantItem(draft = {}, items = []) {
  const itemId = trimmedText(draft.itemId)
  if (!itemId) return { error: '请选择关联物品' }
  return items.some((item) => trimmedText(item.itemId) === itemId)
    ? { error: '' }
    : { error: '关联物品不存在，请重新选择' }
}

export function getOrphanWarehouseVariants(variants = [], items = []) {
  const itemIds = new Set(items.map((item) => trimmedText(item.itemId)))
  return variants.filter((variant) => !itemIds.has(trimmedText(variant.itemId)))
}

export const createWarehousePhotoUploadToken = (generation, itemId = '') => ({
  generation,
  itemId: trimmedText(itemId),
})

export const isWarehousePhotoUploadCurrent = (
  token,
  generation,
  itemId = '',
) => Boolean(
  token
  && token.generation === generation
  && token.itemId === trimmedText(itemId),
)

export function upsertWarehouseVariant(variants = [], payload, editingVariantId = '') {
  if (!editingVariantId) return [payload, ...variants]
  return variants.map((variant) =>
    (variant.variantId === editingVariantId ? payload : variant))
}

export const getEnabledWarehouseLocations = (locations = []) =>
  locations.filter((location) => location.status === '启用')

export function getActiveWarehouseVariants(variants = [], items = []) {
  const activeItemIds = new Set(
    items.filter((item) => item.status === '启用').map((item) => item.itemId),
  )
  return variants.filter(
    (variant) =>
      variant.status === '启用'
      && activeItemIds.has(variant.itemId),
  )
}

export function matchesWarehouseCatalogSearch(item, variants = [], query = '') {
  const normalizedQuery = trimmedText(query).toLocaleLowerCase('zh-CN')
  if (!normalizedQuery) return true

  const itemValues = [item.name, item.category, item.brand, item.description]
  const variantValues = variants.flatMap((variant) => [
    variant.sku,
    variant.model,
    variant.size,
    variant.material,
    variant.unit,
    variant.manufacturerQr,
    variant.systemQr,
  ])
  return [...itemValues, ...variantValues].some((value) =>
    trimmedText(value).toLocaleLowerCase('zh-CN').includes(normalizedQuery),
  )
}

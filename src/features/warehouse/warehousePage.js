import { getActiveWarehouseVariants } from './warehouseCatalog.js'
import { WAREHOUSE_STATUS } from './warehouseConstants.js'
import { getInventorySnapshot } from './warehouseDomain.js'

const text = (value) => String(value ?? '').trim()
const normalizedSearchText = (value) => text(value).toLocaleLowerCase('zh-CN')

export const WAREHOUSE_TABS = Object.freeze([
  { id: 'overview', label: '仓库概览' },
  { id: 'catalog', label: '物品档案' },
  { id: 'inventory', label: '当前库存' },
  { id: 'pending', label: '待办确认' },
  { id: 'transfers', label: '仓间调拨' },
  { id: 'stocktake', label: '月度盘点' },
  { id: 'movements', label: '库存流水' },
])

export function nextWarehouseTabIndex(currentIndex, key, count = WAREHOUSE_TABS.length) {
  if (count <= 0) return -1
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (currentIndex + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (currentIndex - 1 + count) % count
  return currentIndex
}

export function isPrimaryTransferMovement(movement = {}) {
  if (movement.sourceDocumentType !== 'transfer') return true
  return movement.movementType === '调拨出库'
    || String(movement.movementId || '').startsWith('MOV:TRANSFER_OUT:')
}

export function buildWarehouseOverviewMetrics({
  items = [],
  variants = [],
  movements = [],
  stockInRecords = [],
  stockOutRecords = [],
  stockReturnRecords = [],
  stocktakes = [],
  currentMonth = '',
} = {}) {
  const activeVariants = getActiveWarehouseVariants(variants, items)
  const inventory = getInventorySnapshot(activeVariants, movements)
  const pendingCount = [stockInRecords, stockOutRecords, stockReturnRecords]
    .flat()
    .filter((record) => record.status === WAREHOUSE_STATUS.pending)
    .length
  const currentMonthCompleted = stocktakes.some(
    (stocktake) => (
      stocktake.month === currentMonth
      && stocktake.status === WAREHOUSE_STATUS.confirmed
    ),
  )

  return {
    totalStockValue: inventory.reduce((total, row) => total + row.stockValue, 0),
    activeVariantCount: activeVariants.length,
    pendingCount,
    lowStockCount: inventory.filter((row) => row.isLowStock).length,
    currentMonthStocktakeStatus: currentMonthCompleted ? '已完成' : '待盘点',
  }
}

export function buildWarehouseInventoryRows({
  items = [],
  variants = [],
  locations = [],
  movements = [],
} = {}) {
  const activeVariants = getActiveWarehouseVariants(variants, items)
  const itemById = new Map(items.map((item) => [item.itemId, item]))
  const variantById = new Map(activeVariants.map((variant) => [variant.variantId, variant]))

  return getInventorySnapshot(activeVariants, movements, locations, { byLocation: true })
    .map((snapshot) => {
      const variant = variantById.get(snapshot.variantId) || {}
      const item = itemById.get(snapshot.itemId) || {}
      const specification = [variant.model, variant.size, variant.material]
        .map(text)
        .filter(Boolean)
        .join(' / ')
      return {
        ...snapshot,
        itemName: item.name || '未命名物品',
        category: item.category || '',
        specification: specification || '未填写',
        material: variant.material || '',
        photo: Array.isArray(item.photos) ? item.photos[0] || '' : '',
        amount: snapshot.stockValue,
      }
    })
}

export function buildWarehouseLowStockRows({
  items = [],
  variants = [],
  locations = [],
  movements = [],
} = {}) {
  const activeVariants = getActiveWarehouseVariants(variants, items)
  const itemById = new Map(items.map((item) => [item.itemId, item]))
  const locationSnapshots = getInventorySnapshot(
    activeVariants,
    movements,
    locations,
    { byLocation: true },
  )
  const locationsByVariant = new Map()
  for (const snapshot of locationSnapshots) {
    if (!snapshot.locationId) continue
    const rows = locationsByVariant.get(snapshot.variantId) || []
    rows.push({
      locationId: snapshot.locationId,
      warehouseId: snapshot.warehouseId,
      warehouseName: snapshot.warehouseName,
      shelfCode: snapshot.shelfCode,
      shelfName: snapshot.shelfName,
      quantity: snapshot.quantity,
    })
    locationsByVariant.set(snapshot.variantId, rows)
  }

  return getInventorySnapshot(activeVariants, movements)
    .filter((snapshot) => snapshot.isLowStock)
    .map((snapshot) => {
      const variant = activeVariants.find(
        (candidate) => candidate.variantId === snapshot.variantId,
      ) || {}
      const item = itemById.get(snapshot.itemId) || {}
      const specification = [variant.model, variant.size, variant.material]
        .map(text)
        .filter(Boolean)
        .join(' / ')
      return {
        variantId: snapshot.variantId,
        itemId: snapshot.itemId,
        itemName: item.name || '未命名物品',
        category: item.category || '',
        specification: specification || '未填写',
        sku: snapshot.sku,
        unit: snapshot.unit,
        quantity: snapshot.quantity,
        minimumStock: snapshot.minimumStock,
        shortageQuantity: Math.max(snapshot.minimumStock - snapshot.quantity, 0),
        locations: locationsByVariant.get(snapshot.variantId) || [],
      }
    })
}

export function filterWarehouseInventoryRows(rows = [], filters = {}) {
  const keyword = normalizedSearchText(filters.keyword)
  return rows.filter((row) => {
    if (filters.warehouseId && row.warehouseId !== filters.warehouseId) return false
    if (filters.locationId && row.locationId !== filters.locationId) return false
    if (filters.category && row.category !== filters.category) return false
    if (filters.lowStockOnly === true && row.isLowStock !== true) return false
    if (!keyword) return true
    return [
      row.itemName,
      row.specification,
      row.sku,
      row.warehouseName,
      row.shelfCode,
      row.shelfName,
    ].some((value) => normalizedSearchText(value).includes(keyword))
  })
}

export function buildMonthlyStocktakeLines(
  rows = [],
  warehouseId = '',
  initialVariantId = '',
) {
  const lines = rows
    .filter((row) => row.warehouseId === warehouseId && text(row.locationId))
    .map((row) => ({
      variantId: row.variantId,
      locationId: row.locationId,
      bookQuantity: row.quantity,
      countedQuantity: '',
      difference: null,
      reason: '',
    }))
  return prioritizeWarehouseStocktakeLines(lines, initialVariantId)
}

export function prioritizeWarehouseStocktakeLines(lines = [], initialVariantId = '') {
  const targetVariantId = text(initialVariantId)
  if (!targetVariantId || !lines.some((line) => text(line.variantId) === targetVariantId)) {
    return lines
  }
  return [
    ...lines.filter((line) => text(line.variantId) === targetVariantId),
    ...lines.filter((line) => text(line.variantId) !== targetVariantId),
  ]
}

export function validateWarehouseTransfer(draft = {}) {
  const variantId = text(draft.variantId)
  const sourceLocationId = text(draft.sourceLocationId)
  const destinationLocationId = text(draft.destinationLocationId)
  const quantity = Number(draft.quantity)
  const reason = text(draft.reason)

  if (!variantId) return { error: '请选择物品规格' }
  if (!sourceLocationId) return { error: '请选择来源仓位' }
  if (!destinationLocationId) return { error: '请选择目标仓位' }
  if (sourceLocationId === destinationLocationId) {
    return { error: '来源和目标仓位必须不同' }
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { error: '调拨数量必须大于 0' }
  }
  if (!reason) return { error: '请填写调拨原因' }

  return {
    error: '',
    value: {
      variantId,
      sourceLocationId,
      destinationLocationId,
      quantity,
      reason,
    },
  }
}

export function updateMonthlyStocktakeLine(line = {}, patch = {}) {
  const next = { ...line, ...patch }
  const countedText = text(next.countedQuantity)
  const countedQuantity = Number(countedText)
  return {
    ...next,
    difference: countedText && Number.isFinite(countedQuantity)
      ? countedQuantity - Number(next.bookQuantity)
      : null,
  }
}

export function validateMonthlyStocktakeLines(lines = []) {
  if (lines.length === 0) return { error: '盘点清单不能为空' }
  const normalized = []

  for (const line of lines) {
    const countedText = text(line.countedQuantity)
    const countedQuantity = Number(countedText)
    if (!countedText) return { error: '请输入全部实盘数量' }
    if (!Number.isFinite(countedQuantity) || countedQuantity < 0) {
      return { error: '实盘数量必须是非负有限数字' }
    }
    const difference = countedQuantity - Number(line.bookQuantity)
    const differenceType = text(line.differenceType)
    const reason = text(line.reason)
    if (difference !== 0 && !differenceType) {
      return { error: '盘点差异必须选择原因类型' }
    }
    if (difference > 0 && differenceType !== '盘盈') {
      return { error: '只有盘盈才能增加库存' }
    }
    if (difference < 0 && !['盘亏', '损坏', '报废'].includes(differenceType)) {
      return { error: '盘亏、损坏或报废才能减少库存' }
    }
    if (difference !== 0 && !reason) return { error: '请填写盘点差异原因' }
    normalized.push({
      ...line,
      countedQuantity,
      difference,
      ...(difference === 0 ? { differenceType: '', reason: '' } : { differenceType, reason }),
    })
  }

  return { error: '', lines: normalized }
}

export function canReverseWarehouseMovement(movement = {}, permissions = {}, movements = []) {
  if (movement.movementType === '冲销' || movement.sourceDocumentType === 'reversal') return false
  if (movement.sourceDocumentType === 'stockIn') return permissions.confirmStockIn === true
  if (['stockOut', 'stockReturn'].includes(movement.sourceDocumentType)) {
    return permissions.confirmStockFlow === true
  }
  if (movement.sourceDocumentType === 'transfer') return permissions.transfer === true
  if (movement.sourceDocumentType === 'stocktake') return permissions.stocktake === true
  return false
}

import { MOVEMENT_TYPES, WAREHOUSE_STATUS } from './warehouseConstants.js'
import { tokyoDate } from './warehouseDate.js'

const finiteNonnegativeNumber = (value, fallback = 0) => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

const positiveQuantity = (value) => {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('数量必须是大于 0 的有限数字')
  }
  return quantity
}

const nonnegativeStocktakeQuantity = (value) => {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('盘点数量必须是非负有限数字')
  }
  return quantity
}

export const normalizeWarehouseItem = (record = {}) => ({
  itemId: record.itemId || '',
  name: record.name || '',
  category: record.category || '',
  brand: record.brand || '',
  description: record.description || '',
  photos: Array.isArray(record.photos) ? [...record.photos] : [],
  status: record.status || '启用',
  createdAt: record.createdAt || '',
  updatedAt: record.updatedAt || '',
})

export const normalizeWarehouseVariant = (record = {}) => ({
  variantId: record.variantId || '',
  itemId: record.itemId || '',
  sku: record.sku || '',
  model: record.model || '',
  size: record.size || '',
  material: record.material || '',
  unit: record.unit || '',
  manufacturerQr: record.manufacturerQr || '',
  systemQr: record.systemQr || '',
  warehouseUnitPrice: finiteNonnegativeNumber(record.warehouseUnitPrice),
  minimumStock: finiteNonnegativeNumber(record.minimumStock),
  status: record.status || '启用',
})

export const normalizeWarehouseLocation = (record = {}) => ({
  locationId: record.locationId || '',
  warehouseId: record.warehouseId || '',
  warehouseName: record.warehouseName || '',
  shelfCode: record.shelfCode || '',
  shelfName: record.shelfName || '',
  status: record.status || '启用',
})

const getEffectiveMovements = (movements = []) => {
  const indexByMovementId = new Map(
    movements.map((movement, index) => [movement.movementId, index]),
  )
  const canceledIds = new Set()

  for (let index = movements.length - 1; index >= 0; index -= 1) {
    const movement = movements[index]
    if (canceledIds.has(movement.movementId)) continue

    const originalIndex = indexByMovementId.get(movement.reversalOf)
    if (movement.reversalOf && originalIndex !== undefined && originalIndex < index) {
      canceledIds.add(movement.movementId)
      canceledIds.add(movement.reversalOf)
    }
  }

  return movements.filter((movement) => !canceledIds.has(movement.movementId))
}

const costReplayOrder = (left = {}, right = {}) => {
  const occurredAtOrder = String(left.occurredAt || '').localeCompare(String(right.occurredAt || ''))
  return occurredAtOrder || String(left.movementId || '').localeCompare(String(right.movementId || ''))
}

const exactArray = (left, right) => (
  Array.isArray(left)
  && Array.isArray(right)
  && left.length === right.length
  && left.every((value, index) => value === right[index])
)

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const finiteEqual = (left, right) => (
  finiteNumber(left)
  && finiteNumber(right)
  && left === right
)

const hasFiniteNumberField = (record, field) => (
  Object.hasOwn(record, field)
  && finiteNumber(record[field])
)

const nonemptyText = (value) => String(value ?? '').trim().length > 0

const validReversalPairFields = (reversal, original, snapshot) => (
  nonemptyText(original.movementId)
  && nonemptyText(reversal.movementId)
  && nonemptyText(reversal.reversalOf)
  && reversal.movementId === `MOV:REVERSAL:${original.movementId}`
  && reversal.movementType === MOVEMENT_TYPES.reversal
  && reversal.sourceDocumentType === 'reversal'
  && reversal.sourceDocumentId === snapshot.reversalId
  && original.movementType !== MOVEMENT_TYPES.reversal
  && original.sourceDocumentType !== 'reversal'
  && !original.reversalOf
  && nonemptyText(original.variantId)
  && nonemptyText(original.warehouseId)
  && nonemptyText(original.locationId)
  && reversal.variantId === original.variantId
  && (reversal.itemId || '') === (original.itemId || '')
  && (reversal.warehouseId || '') === (original.warehouseId || '')
  && (reversal.locationId || '') === (original.locationId || '')
  && (reversal.projectId || '') === (original.projectId || '')
  && (reversal.projectName || '') === (original.projectName || '')
  && hasFiniteNumberField(original, 'quantityDelta')
  && hasFiniteNumberField(reversal, 'quantityDelta')
  && hasFiniteNumberField(original, 'unitPrice')
  && hasFiniteNumberField(reversal, 'unitPrice')
  && hasFiniteNumberField(original, 'amount')
  && hasFiniteNumberField(reversal, 'amount')
  && finiteEqual(reversal.quantityDelta, -original.quantityDelta)
  && finiteEqual(reversal.unitPrice, original.unitPrice)
  && finiteEqual(reversal.amount, original.amount)
  && finiteEqual(original.amount, Math.abs(original.quantityDelta) * original.unitPrice)
  && original.unitPrice >= 0
  && original.amount >= 0
  && reversal.reason === snapshot.reason
  && reversal.operatorEmployeeId === snapshot.operatorEmployeeId
  && reversal.operatorEmployeeName === snapshot.operatorEmployeeName
  && reversal.occurredAt === snapshot.occurredAt
)

const validReversalSourceGroup = (originals, snapshot, movements) => {
  const sourceTypes = new Set(originals.map((movement) => movement.sourceDocumentType))
  const sourceIds = new Set(originals.map((movement) => movement.sourceDocumentId))
  if (sourceTypes.size !== 1 || sourceIds.size !== 1) return false
  const [sourceType] = sourceTypes
  const [sourceId] = sourceIds
  if (!nonemptyText(sourceId)) return false
  if (['stockIn', 'stockOut', 'stockReturn'].includes(sourceType)) {
    const expectedMovementType = {
      stockIn: MOVEMENT_TYPES.stockIn,
      stockOut: MOVEMENT_TYPES.stockOut,
      stockReturn: MOVEMENT_TYPES.returnIn,
    }[sourceType]
    return (
      originals.length === 1
      && originals[0].movementType === expectedMovementType
      && snapshot.reversalId === `REVERSAL:${originals[0].movementId}`
    )
  }
  if (sourceType === 'transfer') {
    const movementTypes = originals.map((movement) => movement.movementType).sort()
    return (
      originals.length === 2
      && exactArray(
        movementTypes,
        [MOVEMENT_TYPES.transferIn, MOVEMENT_TYPES.transferOut].sort(),
      )
      && snapshot.reversalId === `REVERSAL:TRANSFER:${sourceId}`
    )
  }
  if (sourceType === 'stocktake') {
    const stocktakeTypes = new Set([
      MOVEMENT_TYPES.gain,
      MOVEMENT_TYPES.loss,
      MOVEMENT_TYPES.stocktakeNoChange,
      MOVEMENT_TYPES.damaged,
      MOVEMENT_TYPES.scrapped,
    ])
    const physicalTargetIds = movements
      .filter((movement) => (
        movement.sourceDocumentType === 'stocktake'
        && movement.sourceDocumentId === sourceId
        && !movement.reversalOf
      ))
      .map((movement) => movement.movementId)
    return (
      physicalTargetIds.length === originals.length
      && new Set(physicalTargetIds).size === physicalTargetIds.length
      && physicalTargetIds.every((movementId) => snapshot.targetMovementIds.includes(movementId))
      && originals.every((movement) => stocktakeTypes.has(movement.movementType))
      && snapshot.reversalId === `REVERSAL:STOCKTAKE:${sourceId}`
    )
  }
  return false
}

const validReversalCanceledIds = (movements = []) => {
  const ordered = [...movements].sort(costReplayOrder)
  const rowsByMovementId = new Map()
  const orderByMovement = new Map()
  ordered.forEach((movement, index) => {
    const rows = rowsByMovementId.get(movement.movementId) || []
    rows.push(movement)
    rowsByMovementId.set(movement.movementId, rows)
    orderByMovement.set(movement, index)
  })
  const reversalGroupIds = new Set(
    ordered.filter((movement) => movement.reversalOf).map((movement) => movement.sourceDocumentId),
  )
  const canceledIds = new Set()
  for (const groupId of reversalGroupIds) {
    const group = ordered.filter((movement) => (
      movement.reversalOf && movement.sourceDocumentId === groupId
    ))
    const snapshot = group[0]?.reversalSnapshot
    const targetMovementIds = snapshot?.targetMovementIds
    if (
      !snapshot
      || snapshot.reversalId !== groupId
      || !nonemptyText(snapshot.reason)
      || !nonemptyText(snapshot.operatorEmployeeId)
      || !nonemptyText(snapshot.operatorEmployeeName)
      || !nonemptyText(snapshot.occurredAt)
      || !Array.isArray(targetMovementIds)
      || targetMovementIds.length === 0
      || targetMovementIds.some((movementId) => (
        typeof movementId !== 'string' || !nonemptyText(movementId)
      ))
      || new Set(targetMovementIds).size !== targetMovementIds.length
      || group.length !== targetMovementIds.length
      || group.some((reversal) => (
        !reversal.reversalSnapshot
        || !exactJsonEqual(reversal.reversalSnapshot, snapshot)
        || reversal.reversalSnapshot.reversalId !== snapshot.reversalId
        || reversal.reversalSnapshot.reason !== snapshot.reason
        || reversal.reversalSnapshot.operatorEmployeeId !== snapshot.operatorEmployeeId
        || reversal.reversalSnapshot.operatorEmployeeName !== snapshot.operatorEmployeeName
        || reversal.reversalSnapshot.occurredAt !== snapshot.occurredAt
        || !exactArray(reversal.reversalSnapshot.targetMovementIds, targetMovementIds)
      ))
    ) {
      continue
    }
    const linkedRows = ordered.filter((movement) => targetMovementIds.includes(movement.reversalOf))
    if (
      linkedRows.length !== group.length
      || linkedRows.some((movement) => !group.includes(movement))
      || targetMovementIds.some((targetId) => (
        group.filter((movement) => movement.reversalOf === targetId).length !== 1
      ))
    ) {
      continue
    }
    const originals = targetMovementIds.map((targetId) => rowsByMovementId.get(targetId))
    if (
      originals.some((matches) => matches?.length !== 1)
      || !validReversalSourceGroup(originals.map(([original]) => original), snapshot, ordered)
    ) {
      continue
    }
    const pairsMatch = targetMovementIds.every((targetId) => {
      const [original] = rowsByMovementId.get(targetId)
      const reversal = group.find((movement) => movement.reversalOf === targetId)
      return (
        orderByMovement.get(original) < orderByMovement.get(reversal)
        && validReversalPairFields(reversal, original, snapshot)
      )
    })
    if (!pairsMatch) continue
    group.forEach((movement) => canceledIds.add(movement.movementId))
    targetMovementIds.forEach((movementId) => canceledIds.add(movementId))
  }
  return canceledIds
}

const getEffectiveCostMovements = (movements = []) => {
  const canceledIds = validReversalCanceledIds(movements)
  return [...movements]
    .sort(costReplayOrder)
    .filter((movement) => (
      !canceledIds.has(movement.movementId)
      && !movement.reversalOf
    ))
}

const costStateKey = (variantId, warehouseId) => `${variantId}\u0000${warehouseId}`
const stableCostNumber = (value) => Math.round(Number(value) * 1e10) / 1e10
const stableStockValue = (value) => Math.round(Number(value) * 1e8) / 1e8

const movementWarehouseId = (movement = {}, locationById = new Map()) => (
  movement.warehouseId || locationById.get(movement.locationId)?.warehouseId || ''
)

const buildWarehouseCostStatesFromEffective = (movements = [], locations = []) => {
  const locationById = new Map(
    locations.map((entry) => [entry.locationId, normalizeWarehouseLocation(entry)]),
  )
  const states = new Map()
  for (const movement of movements) {
    const variantId = movement.variantId || ''
    const warehouseId = movementWarehouseId(movement, locationById)
    if (!variantId) continue
    const quantityDelta = Number(movement.quantityDelta)
    const persistedUnitPrice = Number(movement.unitPrice)
    if (
      !Number.isFinite(quantityDelta)
      || !Number.isFinite(persistedUnitPrice)
      || persistedUnitPrice < 0
    ) {
      throw new Error(`库存流水成本数据无效：${movement.movementId || ''}`)
    }
    const unitPrice = persistedUnitPrice
    const key = costStateKey(variantId, warehouseId)
    const current = states.get(key) || { variantId, warehouseId, quantity: 0, stockValue: 0 }
    const quantity = stableCostNumber(current.quantity + quantityDelta)
    const stockValue = current.stockValue + (quantityDelta * unitPrice)
    states.set(key, {
      variantId,
      warehouseId,
      quantity: Object.is(quantity, -0) ? 0 : quantity,
      stockValue: quantity === 0 ? 0 : stockValue,
    })
  }
  return states
}

const buildWarehouseCostStates = (movements = [], locations = []) => (
  buildWarehouseCostStatesFromEffective(getEffectiveCostMovements(movements), locations)
)

export const getWarehouseCostState = (
  movements = [],
  variantId,
  warehouseId,
  locations = [],
) => {
  const locationById = new Map(
    locations.map((entry) => [entry.locationId, normalizeWarehouseLocation(entry)]),
  )
  const relevantMovements = getEffectiveCostMovements(movements).filter((movement) => (
    movement.variantId === variantId
    && movementWarehouseId(movement, locationById) === warehouseId
  ))
  const state = buildWarehouseCostStatesFromEffective(relevantMovements, locations)
    .get(costStateKey(variantId, warehouseId)) || {
    variantId,
    warehouseId,
    quantity: 0,
    stockValue: 0,
  }
  return {
    ...state,
    warehouseUnitPrice: state.quantity === 0
      ? 0
      : stableCostNumber(state.stockValue / state.quantity),
  }
}

const getVariantCostState = (movements = [], variantId, locations = []) => {
  const states = [...buildWarehouseCostStates(movements, locations).values()]
    .filter((state) => state.variantId === variantId)
  const quantity = states.reduce((sum, state) => sum + state.quantity, 0)
  const stockValue = states.reduce((sum, state) => sum + state.stockValue, 0)
  return {
    quantity,
    stockValue: quantity === 0 ? 0 : stockValue,
    warehouseUnitPrice: quantity === 0 ? 0 : stableCostNumber(stockValue / quantity),
  }
}

export const getLocationBalance = (movements = [], variantId, locationId) =>
  getEffectiveMovements(movements).reduce(
    (quantity, movement) =>
      movement.variantId === variantId && movement.locationId === locationId
        ? quantity + Number(movement.quantityDelta || 0)
        : quantity,
    0,
  )

export const getVariantBalance = (movements = [], variantId) =>
  getEffectiveMovements(movements).reduce(
    (quantity, movement) =>
      movement.variantId === variantId
        ? quantity + Number(movement.quantityDelta || 0)
        : quantity,
    0,
  )

const snapshotBase = (variant, quantity, costState = {}) => {
  const normalized = normalizeWarehouseVariant(variant)
  const warehouseUnitPrice = finiteNonnegativeNumber(costState.warehouseUnitPrice)
  const stockValue = Number.isFinite(Number(costState.stockValue))
    ? stableStockValue(costState.stockValue)
    : quantity * warehouseUnitPrice

  return {
    variantId: normalized.variantId,
    itemId: normalized.itemId,
    sku: normalized.sku,
    model: normalized.model,
    size: normalized.size,
    unit: normalized.unit,
    quantity,
    warehouseUnitPrice,
    stockValue,
    minimumStock: normalized.minimumStock,
    isLowStock: quantity < normalized.minimumStock,
  }
}

export const getInventorySnapshot = (
  variants = [],
  movements = [],
  locations = [],
  options = {},
) => {
  if (options.byLocation !== true) {
    return variants.map((variant) => {
      const costState = getVariantCostState(movements, variant.variantId, locations)
      return snapshotBase(variant, costState.quantity, costState)
    })
  }

  const effectiveMovements = getEffectiveMovements(movements)
  const locationById = new Map(
    locations.map((location) => [location.locationId, normalizeWarehouseLocation(location)]),
  )

  return variants.flatMap((variant) => {
    const variantMovements = effectiveMovements.filter(
      (movement) => movement.variantId === variant.variantId,
    )
    const locationIds = [...new Set(variantMovements.map((movement) => movement.locationId))]
    const variantTotalQuantity = getVariantBalance(movements, variant.variantId)

    if (locationIds.length === 0) {
      return [{
        ...snapshotBase(variant, 0, { warehouseUnitPrice: 0, stockValue: 0 }),
        variantTotalQuantity,
        isLowStock: variantTotalQuantity < normalizeWarehouseVariant(variant).minimumStock,
        warehouseId: '',
        warehouseName: '',
        locationId: '',
        shelfCode: '',
        shelfName: '',
      }]
    }

    return locationIds.map((locationId) => {
      const location = locationById.get(locationId) || normalizeWarehouseLocation({ locationId })
      const quantity = getLocationBalance(movements, variant.variantId, locationId)
      const warehouseCost = getWarehouseCostState(
        movements,
        variant.variantId,
        location.warehouseId || movementWarehouseId(variantMovements.find(
          (movement) => movement.locationId === locationId,
        ), locationById),
        locations,
      )

      return {
        ...snapshotBase(variant, quantity, {
          warehouseUnitPrice: warehouseCost.warehouseUnitPrice,
          stockValue: quantity * warehouseCost.warehouseUnitPrice,
        }),
        variantTotalQuantity,
        isLowStock: variantTotalQuantity < normalizeWarehouseVariant(variant).minimumStock,
        warehouseId: location.warehouseId,
        warehouseName: location.warehouseName,
        locationId: location.locationId,
        shelfCode: location.shelfCode,
        shelfName: location.shelfName,
      }
    })
  })
}

const hasMovement = (movements, movementId) =>
  movements.some((movement) => movement.movementId === movementId)

const hasProjectCostRecord = (projectCostRecords, costRecordId) =>
  projectCostRecords.some((record) => record.costRecordId === costRecordId)

const operatorFields = (operator = {}) => ({
  operatorEmployeeId: operator.employeeId || '',
  operatorEmployeeName: operator.name || '',
  occurredAt: operator.occurredAt || '',
})

const confirmationFields = (operator = {}) => ({
  status: WAREHOUSE_STATUS.confirmed,
  confirmedByEmployeeId: operator.employeeId || '',
  confirmedByEmployeeName: operator.name || '',
  confirmedAt: operator.occurredAt || '',
})

const createMovement = ({
  movementId,
  movementType,
  sourceDocumentType,
  sourceDocumentId,
  variantId,
  itemId,
  warehouseId,
  locationId,
  quantityDelta,
  unitPrice,
  projectId = '',
  projectName = '',
  reason = '',
  operator,
  reversalOf = '',
}) => ({
  movementId,
  movementType,
  sourceDocumentType,
  sourceDocumentId,
  variantId,
  itemId,
  warehouseId,
  locationId,
  quantityDelta,
  unitPrice,
  amount: Math.abs(quantityDelta) * unitPrice,
  projectId,
  projectName,
  reason,
  ...operatorFields(operator),
  reversalOf,
})

const confirmedDocument = ({
  source,
  operator,
  confirmedQuantity,
  unitPrice,
  totalCost,
  movementId,
  movementIds,
}) => ({
  ...source,
  ...confirmationFields(operator),
  ...(confirmedQuantity === undefined ? {} : { confirmedQuantity }),
  ...(unitPrice === undefined ? {} : { unitPrice }),
  ...(totalCost === undefined ? {} : { totalCost }),
  ...(movementId === undefined ? {} : { movementId }),
  ...(movementIds === undefined ? {} : { movementIds }),
})

const operatorFromMovement = (movement, fallback = {}) => ({
  employeeId: movement?.operatorEmployeeId || fallback.employeeId || '',
  name: movement?.operatorEmployeeName || fallback.name || '',
  occurredAt: movement?.occurredAt || fallback.occurredAt || '',
})

const movementTotalCost = (movement) =>
  movement.amount ?? Math.abs(Number(movement.quantityDelta)) * Number(movement.unitPrice)

const isNonemptyString = (value) =>
  typeof value === 'string' && value.trim().length > 0

const TRANSFER_SNAPSHOT_FIELDS = [
  'transferId',
  'variantId',
  'itemId',
  'sourceWarehouseId',
  'sourceLocationId',
  'destinationWarehouseId',
  'destinationLocationId',
  'quantity',
  'unitPrice',
  'projectId',
  'projectName',
  'reason',
  'operatorEmployeeId',
  'operatorEmployeeName',
  'occurredAt',
]

const TRANSFER_DISPLAY_SNAPSHOT_FIELDS = [
  'itemName',
  'model',
  'size',
  'sku',
  'unit',
  'category',
  'sourceWarehouseName',
  'sourceShelfCode',
  'sourceShelfName',
  'destinationWarehouseName',
  'destinationShelfCode',
  'destinationShelfName',
]

const TRANSFER_SNAPSHOT_ID_FIELDS = [
  'transferId',
  'variantId',
  'itemId',
  'sourceWarehouseId',
  'sourceLocationId',
  'destinationWarehouseId',
  'destinationLocationId',
]

const cloneTransferSnapshot = (snapshot) => ({ ...snapshot })

const TRANSFER_CONFIRMATION_FIELDS = new Set([
  'status',
  'confirmedQuantity',
  'totalCost',
  'confirmedByEmployeeId',
  'confirmedByEmployeeName',
  'confirmedAt',
  'movementIds',
])

const transferDocumentSnapshot = (document) => Object.fromEntries(
  Object.entries(document || {}).filter(([field]) => !TRANSFER_CONFIRMATION_FIELDS.has(field)),
)

const isValidTransferSnapshot = (snapshot, transferId) => {
  if (!snapshot || typeof snapshot !== 'object') return false
  if (!TRANSFER_SNAPSHOT_FIELDS.every((field) => Object.hasOwn(snapshot, field))) return false
  if (!TRANSFER_SNAPSHOT_ID_FIELDS.every((field) => isNonemptyString(snapshot[field]))) {
    return false
  }
  if (snapshot.transferId !== transferId) return false
  if (
    snapshot.sourceWarehouseId === snapshot.destinationWarehouseId
    && snapshot.sourceLocationId === snapshot.destinationLocationId
  ) {
    return false
  }
  if (!Number.isFinite(snapshot.quantity) || snapshot.quantity <= 0) return false
  if (!Number.isFinite(snapshot.unitPrice) || snapshot.unitPrice < 0) return false
  return true
}

const sameTransferSnapshot = (left, right) =>
  [...TRANSFER_SNAPSHOT_FIELDS, ...TRANSFER_DISPLAY_SNAPSHOT_FIELDS]
    .every((field) => left[field] === right[field])

const transferRequestMatchesSnapshot = (transfer = {}, snapshot = {}) => {
  const fields = [
    'transferId',
    'variantId',
    'sourceLocationId',
    'destinationLocationId',
    'projectId',
    'reason',
  ]
  if (fields.some((field) => String(transfer[field] ?? '') !== String(snapshot[field] ?? ''))) {
    return false
  }
  const requestedQuantity = Number(transfer.quantity ?? transfer.confirmedQuantity)
  if (!Number.isFinite(requestedQuantity) || requestedQuantity !== snapshot.quantity) return false
  return true
}

const transferMovementMatchesSnapshot = (movement, snapshot, direction) => {
  if (!movement || !snapshot) return false
  const isOut = direction === 'out'
  const expected = {
    movementId: `MOV:TRANSFER_${isOut ? 'OUT' : 'IN'}:${snapshot.transferId}`,
    movementType: isOut ? MOVEMENT_TYPES.transferOut : MOVEMENT_TYPES.transferIn,
    sourceDocumentType: 'transfer',
    sourceDocumentId: snapshot.transferId,
    variantId: snapshot.variantId,
    itemId: snapshot.itemId,
    warehouseId: isOut ? snapshot.sourceWarehouseId : snapshot.destinationWarehouseId,
    locationId: isOut ? snapshot.sourceLocationId : snapshot.destinationLocationId,
    quantityDelta: isOut ? -snapshot.quantity : snapshot.quantity,
    unitPrice: snapshot.unitPrice,
    amount: snapshot.quantity * snapshot.unitPrice,
  }
  return Object.entries(expected).every(([field, value]) => movement[field] === value)
    && sameTransferSnapshot(movement.transferSnapshot, snapshot)
}

const STOCKTAKE_SNAPSHOT_FIELDS = [
  'stocktakeId',
  'warehouseId',
  'month',
  'date',
  'operatorEmployeeId',
  'operatorEmployeeName',
  'occurredAt',
  'lines',
]

const STOCKTAKE_LINE_FIELDS = [
  'variantId',
  'itemId',
  'warehouseId',
  'locationId',
  'bookQuantity',
  'countedQuantity',
  'quantityDelta',
  'unitPrice',
]

const STOCKTAKE_OPTIONAL_LINE_FIELDS = ['differenceType', 'reason']

const cloneStocktakeSnapshot = (snapshot) => ({
  ...snapshot,
  lines: snapshot.lines.map((line) => ({ ...line })),
})

const isValidStocktakeSnapshot = (snapshot, stocktakeId) => {
  if (!snapshot || typeof snapshot !== 'object') {
    return false
  }
  if (!STOCKTAKE_SNAPSHOT_FIELDS.every((field) => Object.hasOwn(snapshot, field))) return false
  if (!Array.isArray(snapshot.lines)) return false
  if (!isNonemptyString(snapshot.stocktakeId) || !isNonemptyString(snapshot.warehouseId)) {
    return false
  }
  if (snapshot.stocktakeId !== stocktakeId) return false

  const lineKeys = new Set()
  return snapshot.lines.every((line) => {
    if (!line || typeof line !== 'object') return false
    if (!STOCKTAKE_LINE_FIELDS.every((field) => Object.hasOwn(line, field))) return false
    if (!['variantId', 'itemId', 'warehouseId', 'locationId'].every(
      (field) => isNonemptyString(line[field]),
    )) {
      return false
    }
    if (!Number.isFinite(line.bookQuantity) || line.bookQuantity < 0) return false
    if (!Number.isFinite(line.countedQuantity) || line.countedQuantity < 0) return false
    if (line.quantityDelta !== line.countedQuantity - line.bookQuantity) return false
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) return false
    if (Object.hasOwn(line, 'differenceType')) {
      if (!['', '盘盈', '盘亏', '损坏', '报废'].includes(line.differenceType)) return false
      if (line.quantityDelta > 0 && line.differenceType !== '盘盈') return false
      if (line.quantityDelta < 0 && !['盘亏', '损坏', '报废'].includes(line.differenceType)) {
        return false
      }
    }
    if (Object.hasOwn(line, 'reason') && typeof line.reason !== 'string') return false
    const lineKey = `${line.variantId}\u0000${line.locationId}`
    if (lineKeys.has(lineKey)) return false
    lineKeys.add(lineKey)
    return true
  })
}

const sameStocktakeSnapshot = (left, right) => {
  const headerFields = STOCKTAKE_SNAPSHOT_FIELDS.filter((field) => field !== 'lines')
  return headerFields.every((field) => left[field] === right[field])
    && left.lines.length === right.lines.length
    && left.lines.every((line, index) =>
      [...STOCKTAKE_LINE_FIELDS, ...STOCKTAKE_OPTIONAL_LINE_FIELDS]
        .every((field) => (line[field] || '') === (right.lines[index][field] || '')))
}

const stocktakeMovementId = (stocktakeId, line) =>
  `MOV:STOCKTAKE:${stocktakeId}:${line.variantId}:${line.locationId}`

const stocktakeRequestMatchesSnapshot = (stocktake = {}, snapshot = {}) => {
  if (
    String(stocktake.stocktakeId ?? '') !== String(snapshot.stocktakeId ?? '')
    || String(stocktake.warehouseId ?? '') !== String(snapshot.warehouseId ?? '')
    || String(stocktake.month ?? '') !== String(snapshot.month ?? '')
    || String(stocktake.date ?? '') !== String(snapshot.date ?? '')
    || !Array.isArray(stocktake.lines)
    || stocktake.lines.length !== snapshot.lines.length
  ) {
    return false
  }
  const requestedByKey = new Map(
    stocktake.lines.map((line) => [`${line.variantId}\u0000${line.locationId}`, line]),
  )
  if (requestedByKey.size !== stocktake.lines.length) return false
  return snapshot.lines.every((line) => {
    const requested = requestedByKey.get(`${line.variantId}\u0000${line.locationId}`)
    return requested
      && Number(requested.countedQuantity) === line.countedQuantity
      && String(requested.differenceType ?? '') === String(line.differenceType ?? '')
      && String(requested.reason ?? '') === String(line.reason ?? '')
  })
}

const stocktakeMovementType = (line) => (
  line.differenceType === '损坏'
    ? MOVEMENT_TYPES.damaged
    : line.differenceType === '报废'
      ? MOVEMENT_TYPES.scrapped
      : line.quantityDelta > 0
        ? MOVEMENT_TYPES.gain
        : line.quantityDelta < 0
          ? MOVEMENT_TYPES.loss
          : MOVEMENT_TYPES.stocktakeNoChange
)

const stocktakeMovementMatchesSnapshotLine = (movement, snapshot, line) => {
  const expected = {
    movementId: stocktakeMovementId(snapshot.stocktakeId, line),
    movementType: stocktakeMovementType(line),
    sourceDocumentType: 'stocktake',
    sourceDocumentId: snapshot.stocktakeId,
    variantId: line.variantId,
    itemId: line.itemId,
    warehouseId: line.warehouseId,
    locationId: line.locationId,
    quantityDelta: line.quantityDelta,
    unitPrice: line.unitPrice,
    amount: Math.abs(line.quantityDelta) * line.unitPrice,
    bookQuantity: line.bookQuantity,
    countedQuantity: line.countedQuantity,
  }
  return Object.entries(expected).every(([field, value]) => movement?.[field] === value)
    && sameStocktakeSnapshot(movement.stocktakeSnapshot, snapshot)
}

const confirmedDocumentFromMovement = ({ source, movement, locationKey }) => ({
  ...confirmedDocument({
    source: {
      ...source,
      variantId: movement.variantId,
      itemId: movement.itemId,
      warehouseId: movement.warehouseId,
      [locationKey]: movement.locationId,
      projectId: movement.projectId || '',
      projectName: movement.projectName || '',
      reason: movement.reason || '',
    },
    operator: operatorFromMovement(movement),
    confirmedQuantity: positiveQuantity(Math.abs(Number(movement.quantityDelta))),
    unitPrice: movement.unitPrice,
    totalCost: movementTotalCost(movement),
    movementId: movement.movementId,
  }),
  ...(movement.sourceDocumentType === 'stockIn'
    ? { totalCostIsAuthoritative: true }
    : {}),
})

const createProjectCostRecord = ({ request, operator, idPrefix, sourceDocumentId, amount, remark }) => ({
  costRecordId: `${idPrefix}:${sourceDocumentId}`,
  projectId: request.projectId || '',
  projectName: request.projectName || '',
  employeeId: operator.employeeId || '',
  employeeName: operator.name || '',
  costType: '材料费',
  amount,
  date: tokyoDate(new Date(operator.occurredAt)),
  operator: operator.name || '',
  remark,
  sourceType: 'warehouse',
  sourceDocumentId,
})

export const confirmStockIn = ({ receipt, movements = [], variant, operator }) => {
  const movementId = `MOV:STOCK_IN:${receipt.stockInId}`
  const existingMovement = movements.find((movement) => movement.movementId === movementId)
  const quantity = existingMovement
    ? positiveQuantity(Math.abs(Number(existingMovement.quantityDelta)))
    : positiveQuantity(receipt.requestedQuantity)
  const enteredUnitPrice = Number(
    receipt.purchaseUnitPrice ?? receipt.unitPrice,
  )
  if (!existingMovement && (!Number.isFinite(enteredUnitPrice) || enteredUnitPrice < 0)) {
    throw new Error('采购入库单价无效')
  }
  const unitPrice = existingMovement ? existingMovement.unitPrice : enteredUnitPrice

  if (existingMovement) {
    return {
      document: confirmedDocumentFromMovement({
        source: receipt,
        movement: existingMovement,
        locationKey: 'locationId',
      }),
      movements,
      projectCostRecords: [],
    }
  }

  const movement = createMovement({
    movementId,
    movementType: MOVEMENT_TYPES.stockIn,
    sourceDocumentType: 'stockIn',
    sourceDocumentId: receipt.stockInId,
    variantId: receipt.variantId || variant.variantId,
    itemId: receipt.itemId || variant.itemId,
    warehouseId: receipt.warehouseId,
    locationId: receipt.locationId,
    quantityDelta: quantity,
    unitPrice,
    projectId: receipt.projectId || '',
    projectName: receipt.projectName || '',
    reason: receipt.reason || '',
    operator,
  })

  return {
    document: confirmedDocumentFromMovement({
      source: receipt,
      movement,
      locationKey: 'locationId',
    }),
    movements: [...movements, movement],
    projectCostRecords: [],
  }
}

export const confirmStockOut = ({
  request,
  movements = [],
  projectCostRecords = [],
  variant,
  operator,
}) => {
  const movementId = `MOV:STOCK_OUT:${request.stockOutId}`
  const existingMovement = movements.find((movement) => movement.movementId === movementId)
  const quantity = existingMovement
    ? positiveQuantity(Math.abs(Number(existingMovement.quantityDelta)))
    : positiveQuantity(request.requestedQuantity)
  const variantId = existingMovement?.variantId || request.variantId || variant.variantId
  if (
    !existingMovement
    && getLocationBalance(movements, variantId, request.sourceLocationId) < quantity
  ) {
    throw new Error('库存不足')
  }

  const warehouseId = request.warehouseId || movements.find(
    (entry) => entry.variantId === variantId && entry.locationId === request.sourceLocationId,
  )?.warehouseId || ''
  const unitPrice = existingMovement?.unitPrice ?? getWarehouseCostState(
    movements,
    variantId,
    warehouseId,
  ).warehouseUnitPrice
  const movement = existingMovement || createMovement({
    movementId,
    movementType: MOVEMENT_TYPES.stockOut,
    sourceDocumentType: 'stockOut',
    sourceDocumentId: request.stockOutId,
    variantId,
    itemId: request.itemId || variant.itemId,
    warehouseId: request.warehouseId,
    locationId: request.sourceLocationId,
    quantityDelta: -quantity,
    unitPrice,
    projectId: request.projectId || '',
    projectName: request.projectName || '',
    reason: request.reason || '',
    operator,
  })
  const totalCost = movementTotalCost(movement)
  const costOperator = operatorFromMovement(movement, operator)
  const costRecord = createProjectCostRecord({
    request: {
      ...request,
      projectId: movement.projectId || '',
      projectName: movement.projectName || '',
    },
    operator: costOperator,
    idPrefix: 'WAREHOUSE-SO',
    sourceDocumentId: request.stockOutId,
    amount: totalCost,
    remark: `仓库出库 ${request.stockOutId}`,
  })

  return {
    document: confirmedDocumentFromMovement({
      source: request,
      movement,
      locationKey: 'sourceLocationId',
    }),
    movements: existingMovement ? movements : [...movements, movement],
    projectCostRecords: hasProjectCostRecord(projectCostRecords, costRecord.costRecordId)
      ? projectCostRecords
      : [...projectCostRecords, costRecord],
  }
}

export const confirmStockReturn = ({
  request,
  originalStockOut,
  movements = [],
  projectCostRecords = [],
  variant,
  operator,
}) => {
  const movementId = `MOV:RETURN:${request.stockReturnId}`
  const existingMovement = movements.find((movement) => movement.movementId === movementId)
  const quantity = existingMovement
    ? positiveQuantity(Math.abs(Number(existingMovement.quantityDelta)))
    : positiveQuantity(request.requestedQuantity)
  const originalUnitPrice = Number(originalStockOut?.unitPrice)
  if (!existingMovement && (!Number.isFinite(originalUnitPrice) || originalUnitPrice < 0)) {
    throw new Error('原始出库单价无效')
  }

  const unitPrice = existingMovement?.unitPrice ?? originalUnitPrice
  const movement = existingMovement || createMovement({
    movementId,
    movementType: MOVEMENT_TYPES.returnIn,
    sourceDocumentType: 'stockReturn',
    sourceDocumentId: request.stockReturnId,
    variantId: request.variantId || variant.variantId,
    itemId: request.itemId || variant.itemId,
    warehouseId: request.warehouseId,
    locationId: request.locationId,
    quantityDelta: quantity,
    unitPrice,
    projectId: request.projectId || '',
    projectName: request.projectName || '',
    reason: request.reason || '',
    operator,
  })
  const totalCost = movementTotalCost(movement)
  const costOperator = operatorFromMovement(movement, operator)
  const costRecord = createProjectCostRecord({
    request: {
      ...request,
      projectId: movement.projectId || '',
      projectName: movement.projectName || '',
    },
    operator: costOperator,
    idPrefix: 'WAREHOUSE-SR',
    sourceDocumentId: request.stockReturnId,
    amount: -totalCost,
    remark: `仓库退回 ${request.stockReturnId}`,
  })

  return {
    document: confirmedDocumentFromMovement({
      source: request,
      movement,
      locationKey: 'locationId',
    }),
    movements: existingMovement ? movements : [...movements, movement],
    projectCostRecords: hasProjectCostRecord(projectCostRecords, costRecord.costRecordId)
      ? projectCostRecords
      : [...projectCostRecords, costRecord],
  }
}

export const createTransfer = ({
  transfer,
  movements = [],
  existingTransfer,
  variant,
  item = {},
  sourceLocation = {},
  destinationLocation = {},
  operator,
}) => {
  const deterministicMovementIds = [
    `MOV:TRANSFER_OUT:${transfer.transferId}`,
    `MOV:TRANSFER_IN:${transfer.transferId}`,
  ]
  const existingOut = movements.find(
    (movement) => movement.movementId === deterministicMovementIds[0],
  )
  const existingIn = movements.find(
    (movement) => movement.movementId === deterministicMovementIds[1],
  )
  const authoritativeMovement = existingOut || existingIn
  const persistedDocumentSnapshot = existingTransfer
    ? transferDocumentSnapshot(existingTransfer)
    : null
  let transferSnapshot
  if (existingTransfer || authoritativeMovement) {
    if (!existingOut || !existingIn) {
      throw new Error('调拨流水必须完整成对，请人工修复')
    }
    const existingSnapshots = [existingOut, existingIn]
      .filter(Boolean)
      .map((movement) => movement.transferSnapshot)
    if (
      existingSnapshots.some((snapshot) => !isValidTransferSnapshot(snapshot, transfer.transferId))
      || existingSnapshots.some((snapshot) => !sameTransferSnapshot(snapshot, existingSnapshots[0]))
    ) {
      throw new Error('调拨快照缺失或无效，请人工修复')
    }
    transferSnapshot = cloneTransferSnapshot(existingSnapshots[0])
    if (
      persistedDocumentSnapshot
      && (
        existingTransfer.status !== WAREHOUSE_STATUS.confirmed
        || !isValidTransferSnapshot(persistedDocumentSnapshot, transfer.transferId)
        || !sameTransferSnapshot(persistedDocumentSnapshot, transferSnapshot)
      )
    ) {
      throw new Error('调拨确定性流水与单据不一致')
    }
    if (
      !transferMovementMatchesSnapshot(existingOut, transferSnapshot, 'out')
      || !transferMovementMatchesSnapshot(existingIn, transferSnapshot, 'in')
    ) {
      throw new Error('调拨成对流水与持久化快照不一致，请人工修复')
    }
    if (!transferRequestMatchesSnapshot(transfer, transferSnapshot)) {
      throw new Error('调拨重试请求与已确认快照冲突')
    }
  } else {
    const normalizedVariant = normalizeWarehouseVariant(variant)
    const normalizedItem = normalizeWarehouseItem(item)
    const normalizedSourceLocation = normalizeWarehouseLocation(sourceLocation)
    const normalizedDestinationLocation = normalizeWarehouseLocation(destinationLocation)
    transferSnapshot = {
      transferId: transfer.transferId,
      variantId: transfer.variantId || normalizedVariant.variantId,
      itemId: transfer.itemId || normalizedVariant.itemId,
      sourceWarehouseId: transfer.sourceWarehouseId,
      sourceLocationId: transfer.sourceLocationId,
      destinationWarehouseId: transfer.destinationWarehouseId,
      destinationLocationId: transfer.destinationLocationId,
      itemName: normalizedItem.name,
      model: normalizedVariant.model,
      size: normalizedVariant.size,
      sku: normalizedVariant.sku,
      unit: normalizedVariant.unit,
      category: normalizedItem.category,
      sourceWarehouseName: normalizedSourceLocation.warehouseName,
      sourceShelfCode: normalizedSourceLocation.shelfCode,
      sourceShelfName: normalizedSourceLocation.shelfName,
      destinationWarehouseName: normalizedDestinationLocation.warehouseName,
      destinationShelfCode: normalizedDestinationLocation.shelfCode,
      destinationShelfName: normalizedDestinationLocation.shelfName,
      quantity: positiveQuantity(transfer.quantity),
      unitPrice: getWarehouseCostState(
        movements,
        transfer.variantId || normalizedVariant.variantId,
        transfer.sourceWarehouseId,
      ).warehouseUnitPrice,
      projectId: transfer.projectId || '',
      projectName: transfer.projectName || '',
      reason: transfer.reason || '',
      operatorEmployeeId: operator.employeeId || '',
      operatorEmployeeName: operator.name || '',
      occurredAt: operator.occurredAt || '',
    }
  }
  const quantity = transferSnapshot.quantity
  const unitPrice = transferSnapshot.unitPrice
  const variantId = transferSnapshot.variantId
  const itemId = transferSnapshot.itemId
  const projectId = transferSnapshot.projectId || ''
  const projectName = transferSnapshot.projectName || ''
  const reason = transferSnapshot.reason
  const movementOperator = {
    employeeId: transferSnapshot.operatorEmployeeId,
    name: transferSnapshot.operatorEmployeeName,
    occurredAt: transferSnapshot.occurredAt,
  }
  if (
    !existingOut
    && getLocationBalance(movements, variantId, transferSnapshot.sourceLocationId) < quantity
  ) {
    throw new Error('调拨库存不足')
  }
  const movementBase = {
    sourceDocumentType: 'transfer',
    sourceDocumentId: transferSnapshot.transferId,
    variantId,
    itemId,
    unitPrice,
    projectId,
    projectName,
    reason,
    operator: movementOperator,
  }
  const outMovement = existingOut || {
    ...createMovement({
      ...movementBase,
      movementId: deterministicMovementIds[0],
      movementType: MOVEMENT_TYPES.transferOut,
      warehouseId: transferSnapshot.sourceWarehouseId,
      locationId: transferSnapshot.sourceLocationId,
      quantityDelta: -quantity,
    }),
    transferSnapshot: cloneTransferSnapshot(transferSnapshot),
  }
  const inMovement = existingIn || {
    ...createMovement({
      ...movementBase,
      movementId: deterministicMovementIds[1],
      movementType: MOVEMENT_TYPES.transferIn,
      warehouseId: transferSnapshot.destinationWarehouseId,
      locationId: transferSnapshot.destinationLocationId,
      quantityDelta: quantity,
    }),
    transferSnapshot: cloneTransferSnapshot(transferSnapshot),
  }
  const transferMovements = [
    ...(existingOut ? [] : [outMovement]),
    ...(existingIn ? [] : [inMovement]),
  ]
  const movementIds = [outMovement.movementId, inMovement.movementId]

  return {
    document: confirmedDocument({
      source: cloneTransferSnapshot(transferSnapshot),
      operator: {
        employeeId: transferSnapshot.operatorEmployeeId,
        name: transferSnapshot.operatorEmployeeName,
        occurredAt: transferSnapshot.occurredAt,
      },
      confirmedQuantity: transferSnapshot.quantity,
      unitPrice: transferSnapshot.unitPrice,
      totalCost: transferSnapshot.quantity * transferSnapshot.unitPrice,
      movementIds,
    }),
    movements: transferMovements.length > 0 ? [...movements, ...transferMovements] : movements,
    projectCostRecords: [],
  }
}

export const confirmStocktake = ({ stocktake, movements = [], variants = [], operator }) => {
  const persistedMovements = movements.filter(
    (movement) =>
      movement.sourceDocumentType === 'stocktake'
      && movement.sourceDocumentId === stocktake.stocktakeId,
  )
  const variantById = new Map(variants.map((variant) => [variant.variantId, variant]))
  const authoritativeMovement = persistedMovements[0]
  let stocktakeSnapshot
  if (authoritativeMovement) {
    const persistedSnapshots = persistedMovements.map((movement) => movement.stocktakeSnapshot)
    if (
      persistedSnapshots.some(
        (snapshot) => !isValidStocktakeSnapshot(snapshot, stocktake.stocktakeId),
      )
      || persistedSnapshots.some(
        (snapshot) => !sameStocktakeSnapshot(snapshot, persistedSnapshots[0]),
      )
    ) {
      throw new Error('盘点快照缺失或无效，请人工修复')
    }
    stocktakeSnapshot = cloneStocktakeSnapshot(persistedSnapshots[0])
    const canonicalMovementIds = new Set(
      stocktakeSnapshot.lines.map((line) => stocktakeMovementId(stocktakeSnapshot.stocktakeId, line)),
    )
    if (
      persistedMovements.length !== stocktakeSnapshot.lines.length
      || persistedMovements.some((movement) => !canonicalMovementIds.has(movement.movementId))
      || stocktakeSnapshot.lines.some((line) => {
        const movement = persistedMovements.find(
          (candidate) => candidate.movementId === stocktakeMovementId(stocktakeSnapshot.stocktakeId, line),
        )
        return !stocktakeMovementMatchesSnapshotLine(movement, stocktakeSnapshot, line)
      })
    ) {
      throw new Error('盘点快照缺失或无效，请人工修复')
    }
    if (!stocktakeRequestMatchesSnapshot(stocktake, stocktakeSnapshot)) {
      throw new Error('盘点重试请求与已确认快照冲突')
    }
  } else {
    const lineKeys = new Set()
    const lines = stocktake.lines.map((line) => {
      const lineKey = `${line.variantId}\u0000${line.locationId}`
      if (lineKeys.has(lineKey)) {
        throw new Error('盘点明细重复：同一物料规格和库位只能出现一次')
      }
      lineKeys.add(lineKey)
      const bookQuantity = nonnegativeStocktakeQuantity(
        getLocationBalance(movements, line.variantId, line.locationId),
      )
      const countedQuantity = nonnegativeStocktakeQuantity(line.countedQuantity)
      const variant = variantById.get(line.variantId) || {}
      const quantityDelta = countedQuantity - bookQuantity
      const warehouseId = line.warehouseId || stocktake.warehouseId
      const warehouseCost = getWarehouseCostState(
        movements,
        line.variantId,
        warehouseId,
      )
      if (quantityDelta > 0 && warehouseCost.quantity === 0) {
        throw new Error('零库存盘盈缺少权威成本')
      }
      const differenceType = typeof line.differenceType === 'string'
        ? line.differenceType.trim()
        : ''
      const lineReason = typeof line.reason === 'string' ? line.reason.trim() : ''
      return {
        variantId: line.variantId,
        itemId: line.itemId || variant.itemId || '',
        warehouseId,
        locationId: line.locationId,
        bookQuantity,
        countedQuantity,
        quantityDelta,
        unitPrice: warehouseCost.warehouseUnitPrice,
        ...(differenceType ? { differenceType } : {}),
        ...(lineReason ? { reason: lineReason } : {}),
      }
    })
    stocktakeSnapshot = {
      stocktakeId: stocktake.stocktakeId,
      warehouseId: stocktake.warehouseId,
      month: stocktake.month || '',
      date: stocktake.date || '',
      operatorEmployeeId: operator.employeeId || '',
      operatorEmployeeName: operator.name || '',
      occurredAt: operator.occurredAt || '',
      lines,
    }
  }

  const snapshotOperator = {
    employeeId: stocktakeSnapshot.operatorEmployeeId,
    name: stocktakeSnapshot.operatorEmployeeName,
    occurredAt: stocktakeSnapshot.occurredAt,
  }
  const projectId = authoritativeMovement
    ? authoritativeMovement.projectId || ''
    : stocktake.projectId || ''
  const projectName = authoritativeMovement
    ? authoritativeMovement.projectName || ''
    : stocktake.projectName || ''
  const reason = authoritativeMovement ? authoritativeMovement.reason || '' : stocktake.reason || ''
  const stocktakeMovements = []
  const resolvedMovements = stocktakeSnapshot.lines.map((line) => {
    const movementId = stocktakeMovementId(stocktakeSnapshot.stocktakeId, line)
    const existingMovement = movements.find((movement) => movement.movementId === movementId)
    if (existingMovement) return existingMovement

    const movement = {
      ...createMovement({
        movementId,
        movementType: stocktakeMovementType(line),
        sourceDocumentType: 'stocktake',
        sourceDocumentId: stocktakeSnapshot.stocktakeId,
        variantId: line.variantId,
        itemId: line.itemId,
        warehouseId: line.warehouseId,
        locationId: line.locationId,
        quantityDelta: line.quantityDelta,
        unitPrice: line.unitPrice,
        projectId,
        projectName,
        reason: line.reason || reason,
        operator: snapshotOperator,
      }),
      bookQuantity: line.bookQuantity,
      countedQuantity: line.countedQuantity,
      stocktakeSnapshot: cloneStocktakeSnapshot(stocktakeSnapshot),
    }
    stocktakeMovements.push(movement)
    return movement
  })
  const movementIds = resolvedMovements.map((movement) => movement.movementId)
  const confirmedLines = stocktakeSnapshot.lines.map((line) => ({
    ...line,
    totalCost: Math.abs(line.quantityDelta) * line.unitPrice,
    movementId: stocktakeMovementId(stocktakeSnapshot.stocktakeId, line),
  }))

  return {
    document: {
      ...confirmedDocument({
        source: {
          ...stocktake,
          stocktakeId: stocktakeSnapshot.stocktakeId,
          warehouseId: stocktakeSnapshot.warehouseId,
          month: stocktakeSnapshot.month,
          date: stocktakeSnapshot.date,
          lines: stocktakeSnapshot.lines.map((line) => ({ ...line })),
          projectId,
          projectName,
          reason,
        },
        operator: snapshotOperator,
        movementIds,
      }),
      confirmedLines,
    },
    movements: stocktakeMovements.length > 0 ? [...movements, ...stocktakeMovements] : movements,
    projectCostRecords: [],
  }
}

const transferTargetsForReversal = (movement, movements) => {
  const targets = movements.filter((candidate) => (
    candidate.sourceDocumentType === 'transfer'
    && candidate.sourceDocumentId === movement.sourceDocumentId
  ))
  if (targets.length !== 2) throw new Error('调拨流水必须完整成对，请人工修复')
  const out = targets.find((candidate) => candidate.movementType === MOVEMENT_TYPES.transferOut)
  const incoming = targets.find((candidate) => candidate.movementType === MOVEMENT_TYPES.transferIn)
  const snapshot = out?.transferSnapshot
  if (
    !out
    || !incoming
    || !isValidTransferSnapshot(snapshot, movement.sourceDocumentId)
    || !sameTransferSnapshot(incoming.transferSnapshot, snapshot)
    || !transferMovementMatchesSnapshot(out, snapshot, 'out')
    || !transferMovementMatchesSnapshot(incoming, snapshot, 'in')
  ) {
    throw new Error('调拨成对流水与持久化快照不一致，请人工修复')
  }
  return [out, incoming]
}

const canonicalJson = (value) => {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]),
    )
  }
  return value
}

const exactJsonEqual = (left, right) => (
  JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right))
)

const cloneJson = (value) => JSON.parse(JSON.stringify(value))

const confirmedSourceDocumentSnapshot = (sourceDocument) => {
  const snapshot = cloneJson(sourceDocument)
  if (snapshot.status !== WAREHOUSE_STATUS.void) return snapshot
  snapshot.status = WAREHOUSE_STATUS.confirmed
  for (const field of [
    'reversalId',
    'reversalMovementIds',
    'reversedByEmployeeId',
    'reversedByEmployeeName',
    'reversedAt',
    'reversalReason',
  ]) {
    delete snapshot[field]
  }
  return snapshot
}

const resolveAuthoritativeReversalMovement = (movement, movements) => {
  const movementId = movement?.movementId || ''
  const matches = movements.filter((candidate) => candidate?.movementId === movementId)
  if (matches.length === 0) throw new Error('冲销库存流水不存在')
  if (matches.length > 1) throw new Error('冲销库存流水编号重复')
  if (!exactJsonEqual(movement, matches[0])) {
    throw new Error('冲销库存流水与权威记录不一致')
  }
  return matches[0]
}

const simpleReversalSourceMatchesMovement = (movement, sourceDocument) => {
  const config = ({
    stockIn: {
      idField: 'stockInId',
      movementId: `MOV:STOCK_IN:${movement.sourceDocumentId}`,
      movementType: MOVEMENT_TYPES.stockIn,
      locationField: 'locationId',
    },
    stockOut: {
      idField: 'stockOutId',
      movementId: `MOV:STOCK_OUT:${movement.sourceDocumentId}`,
      movementType: MOVEMENT_TYPES.stockOut,
      locationField: 'sourceLocationId',
    },
    stockReturn: {
      idField: 'stockReturnId',
      movementId: `MOV:RETURN:${movement.sourceDocumentId}`,
      movementType: MOVEMENT_TYPES.returnIn,
      locationField: 'locationId',
    },
  })[movement.sourceDocumentType]
  if (!config) return false
  const source = confirmedSourceDocumentSnapshot(sourceDocument)
  const expectedDocumentFields = {
    [config.idField]: movement.sourceDocumentId,
    status: WAREHOUSE_STATUS.confirmed,
    movementId: movement.movementId,
    variantId: movement.variantId,
    itemId: movement.itemId,
    warehouseId: movement.warehouseId,
    [config.locationField]: movement.locationId,
    projectId: movement.projectId || '',
    projectName: movement.projectName || '',
    reason: movement.reason || '',
    confirmedQuantity: Math.abs(Number(movement.quantityDelta)),
    unitPrice: movement.unitPrice,
    totalCost: movementTotalCost(movement),
    confirmedByEmployeeId: movement.operatorEmployeeId || '',
    confirmedByEmployeeName: movement.operatorEmployeeName || '',
    confirmedAt: movement.occurredAt || '',
  }
  return (
    movement.movementId === config.movementId
    && movement.movementType === config.movementType
    && ['stockIn', 'stockOut', 'stockReturn'].includes(movement.sourceDocumentType)
    && movement.reversalOf === ''
    && Object.entries(expectedDocumentFields)
      .every(([field, value]) => source?.[field] === value)
    && (
      movement.sourceDocumentType !== 'stockIn'
      || source.totalCostIsAuthoritative === true
    )
  )
}

const transferReversalSourceMatchesTargets = (sourceDocument, targets) => {
  const source = confirmedSourceDocumentSnapshot(sourceDocument)
  const out = targets.find((target) => target.movementType === MOVEMENT_TYPES.transferOut)
  const incoming = targets.find((target) => target.movementType === MOVEMENT_TYPES.transferIn)
  const snapshot = out?.transferSnapshot
  return Boolean(
    out
    && incoming
    && source?.status === WAREHOUSE_STATUS.confirmed
    && isValidTransferSnapshot(snapshot, out.sourceDocumentId)
    && sameTransferSnapshot(transferDocumentSnapshot(source), snapshot)
    && source.confirmedQuantity === snapshot.quantity
    && source.unitPrice === snapshot.unitPrice
    && source.totalCost === snapshot.quantity * snapshot.unitPrice
    && source.confirmedByEmployeeId === snapshot.operatorEmployeeId
    && source.confirmedByEmployeeName === snapshot.operatorEmployeeName
    && source.confirmedAt === snapshot.occurredAt
    && exactJsonEqual(source.movementIds, [out.movementId, incoming.movementId])
  )
}

const stocktakeReversalSourceMatchesTargets = (sourceDocument, targets) => {
  const source = confirmedSourceDocumentSnapshot(sourceDocument)
  const snapshot = targets[0]?.stocktakeSnapshot
  if (
    source?.status !== WAREHOUSE_STATUS.confirmed
    || !isValidStocktakeSnapshot(snapshot, source?.stocktakeId)
    || source.warehouseId !== snapshot.warehouseId
    || source.month !== snapshot.month
    || source.date !== snapshot.date
    || source.confirmedByEmployeeId !== snapshot.operatorEmployeeId
    || source.confirmedByEmployeeName !== snapshot.operatorEmployeeName
    || source.confirmedAt !== snapshot.occurredAt
    || !exactJsonEqual(source.lines, snapshot.lines)
  ) {
    return false
  }
  const expectedMovementIds = snapshot.lines.map(
    (line) => stocktakeMovementId(snapshot.stocktakeId, line),
  )
  const expectedConfirmedLines = snapshot.lines.map((line) => ({
    ...line,
    totalCost: Math.abs(line.quantityDelta) * line.unitPrice,
    movementId: stocktakeMovementId(snapshot.stocktakeId, line),
  }))
  return (
    exactJsonEqual(source.movementIds, expectedMovementIds)
    && exactJsonEqual(source.confirmedLines, expectedConfirmedLines)
    && targets.length === snapshot.lines.length
    && targets.every((target, index) => (
      target.movementId === expectedMovementIds[index]
      && stocktakeMovementMatchesSnapshotLine(target, snapshot, snapshot.lines[index])
    ))
  )
}

const assertReversalSourceMatchesTargets = (movement, sourceDocument, targets) => {
  const matches = ['stockIn', 'stockOut', 'stockReturn'].includes(movement.sourceDocumentType)
    ? simpleReversalSourceMatchesMovement(movement, sourceDocument)
    : movement.sourceDocumentType === 'transfer'
      ? transferReversalSourceMatchesTargets(sourceDocument, targets)
      : movement.sourceDocumentType === 'stocktake'
        ? stocktakeReversalSourceMatchesTargets(sourceDocument, targets)
        : false
  if (!matches) {
    throw new Error('冲销源单据与库存流水确定性快照不一致')
  }
}

const stocktakeTargetsForReversal = (movement, movements, sourceDocument) => {
  const stocktakeId = movement.sourceDocumentId
  const stocktakeReversalId = `REVERSAL:STOCKTAKE:${stocktakeId}`
  const sourceStatusIsReversible = (
    sourceDocument?.status === WAREHOUSE_STATUS.confirmed
    || (
      sourceDocument?.status === WAREHOUSE_STATUS.void
      && sourceDocument?.reversalId === stocktakeReversalId
    )
  )
  if (
    !sourceDocument
    || sourceDocument.stocktakeId !== stocktakeId
    || !sourceStatusIsReversible
    || !sourceDocument.confirmedAt
    || !Array.isArray(sourceDocument.movementIds)
    || !Array.isArray(sourceDocument.confirmedLines)
    || sourceDocument.movementIds.length === 0
    || sourceDocument.movementIds.length !== sourceDocument.confirmedLines.length
  ) {
    throw new Error('盘点源单据或完整确认快照无效，请人工修复')
  }
  const expectedIds = sourceDocument.movementIds
  const expectedIdSet = new Set(expectedIds)
  if (
    expectedIdSet.size !== expectedIds.length
    || !expectedIdSet.has(movement.movementId)
    || sourceDocument.confirmedLines.some(
      (line, index) => line.movementId !== expectedIds[index],
    )
  ) {
    throw new Error('盘点源单据或完整确认快照无效，请人工修复')
  }
  const physicalTargets = movements.filter((candidate) => (
    candidate.sourceDocumentType === 'stocktake'
    && candidate.sourceDocumentId === stocktakeId
  ))
  if (
    physicalTargets.length !== expectedIds.length
    || physicalTargets.some((candidate) => !expectedIdSet.has(candidate.movementId))
  ) {
    throw new Error('盘点源流水物理键集合与单据不一致，请人工修复')
  }
  return expectedIds.map((movementId) => {
    const target = physicalTargets.find((candidate) => candidate.movementId === movementId)
    if (!target) throw new Error('盘点源流水物理键集合与单据不一致，请人工修复')
    return target
  })
}

const reversalTargets = (movement, movements, sourceDocument) => {
  if (movement.sourceDocumentType === 'transfer') {
    return transferTargetsForReversal(movement, movements)
  }
  if (movement.sourceDocumentType === 'stocktake') {
    return stocktakeTargetsForReversal(movement, movements, sourceDocument)
  }
  const snapshotTargets = movement.reversalSnapshot?.targetMovementIds
  if (movement.sourceDocumentType === 'reversal' && Array.isArray(snapshotTargets)) {
    const grouped = movements.filter((candidate) => (
      candidate.sourceDocumentType === 'reversal'
      && candidate.sourceDocumentId === movement.sourceDocumentId
      && snapshotTargets.includes(candidate.reversalOf)
    ))
    if (grouped.length !== snapshotTargets.length) {
      throw new Error('成组冲销流水不完整，请人工修复')
    }
    return grouped.sort(
      (left, right) => snapshotTargets.indexOf(left.reversalOf) - snapshotTargets.indexOf(right.reversalOf),
    )
  }
  return [movement]
}

const reversalSnapshotMatches = (snapshot, expected) => (
  snapshot
  && snapshot.reversalId === expected.reversalId
  && snapshot.reason === expected.reason
  && Array.isArray(snapshot.targetMovementIds)
  && snapshot.targetMovementIds.length === expected.targetMovementIds.length
  && snapshot.targetMovementIds.every((id, index) => id === expected.targetMovementIds[index])
)

const sourceSnapshotForReversal = (target, sourceDocument) => (
  target.sourceDocumentType === 'stocktake'
    ? {
        recordKey: target.movementId,
        payload: cloneJson(target),
        businessDocumentRecordKey: target.sourceDocumentId,
        businessDocumentPayload: confirmedSourceDocumentSnapshot(sourceDocument),
      }
    : undefined
)

const reversalMovementMatchesTarget = (reversal, target, snapshot, sourceDocument) => {
  if (!reversalSnapshotMatches(reversal?.reversalSnapshot, snapshot)) return false
  const auditOperator = {
    employeeId: snapshot.operatorEmployeeId,
    name: snapshot.operatorEmployeeName,
    occurredAt: snapshot.occurredAt,
  }
  const expected = {
    ...createMovement({
      movementId: `MOV:REVERSAL:${target.movementId}`,
      movementType: MOVEMENT_TYPES.reversal,
      sourceDocumentType: 'reversal',
      sourceDocumentId: snapshot.reversalId,
      variantId: target.variantId,
      itemId: target.itemId,
      warehouseId: target.warehouseId,
      locationId: target.locationId,
      quantityDelta: -Number(target.quantityDelta),
      unitPrice: target.unitPrice,
      projectId: target.projectId || '',
      projectName: target.projectName || '',
      reason: snapshot.reason,
      operator: auditOperator,
      reversalOf: target.movementId,
    }),
    reversalSnapshot: cloneJson(snapshot),
    ...(target.sourceDocumentType === 'stocktake'
      ? { sourceDocumentSnapshot: sourceSnapshotForReversal(target, sourceDocument) }
      : {}),
  }
  return exactJsonEqual(reversal, expected)
}

const reversalCostRecord = ({ movement, projectCostRecords, operator, reason, reversalId }) => {
  if (!['stockOut', 'stockReturn'].includes(movement.sourceDocumentType)) return undefined
  const sourcePrefix = movement.sourceDocumentType === 'stockOut' ? 'WAREHOUSE-SO' : 'WAREHOUSE-SR'
  const correctionType = movement.sourceDocumentType === 'stockOut' ? 'STOCK_OUT' : 'STOCK_RETURN'
  const originalCostRecordId = `${sourcePrefix}:${movement.sourceDocumentId}`
  const originalCost = projectCostRecords.find(
    (record) => record.costRecordId === originalCostRecordId,
  )
  const expectedOriginalAmount = movement.sourceDocumentType === 'stockOut'
    ? movementTotalCost(movement)
    : -movementTotalCost(movement)
  const originalAmount = Number(originalCost?.amount)
  const originalCostMatches = (
    originalCost
    && originalCost.sourceType === 'warehouse'
    && originalCost.sourceDocumentId === movement.sourceDocumentId
    && originalCost.projectId === (movement.projectId || '')
    && originalCost.projectName === (movement.projectName || '')
    && originalCost.costType === '材料费'
    && Number.isFinite(originalAmount)
    && originalAmount === expectedOriginalAmount
  )
  if (!originalCostMatches) {
    throw new Error('原项目成本记录不存在或不匹配')
  }
  const amount = -originalAmount
  return {
    ...createProjectCostRecord({
      request: movement,
      operator,
      idPrefix: `WAREHOUSE-REVERSAL:${correctionType}`,
      sourceDocumentId: movement.sourceDocumentId,
      amount,
      remark: `仓库冲销 ${movement.sourceDocumentId}`,
    }),
    reversalOfCostRecordId: originalCostRecordId,
    reversalId,
    sourceType: 'warehouseReversal',
  }
}

export const createReversal = ({
  movement,
  movements = [],
  projectCostRecords = [],
  sourceDocument,
  operator,
  reason,
}) => {
  movement = resolveAuthoritativeReversalMovement(movement, movements)
  if (
    movement.movementType === MOVEMENT_TYPES.reversal
    || movement.sourceDocumentType === 'reversal'
  ) {
    throw new Error('冲销流水不能再次冲销')
  }
  const sourceDocumentIdField = ({
    stockIn: 'stockInId',
    stockOut: 'stockOutId',
    stockReturn: 'stockReturnId',
    transfer: 'transferId',
    stocktake: 'stocktakeId',
  })[movement.sourceDocumentType]
  if (!sourceDocumentIdField) throw new Error('冲销源单据类型无效')
  if (!sourceDocument) throw new Error('冲销源单据不存在')
  const sourceDocumentId = sourceDocument[sourceDocumentIdField] || sourceDocument.id
  if (sourceDocumentId !== movement.sourceDocumentId) {
    throw new Error('冲销源单据与库存流水不匹配')
  }
  const targets = reversalTargets(movement, movements, sourceDocument)
  assertReversalSourceMatchesTargets(movement, sourceDocument, targets)
  const targetMovementIds = targets.map((target) => target.movementId)
  const isTransferPair = targets.length === 2 && movement.sourceDocumentType === 'transfer'
  const reversalId = movement.sourceDocumentType === 'stocktake'
    ? `REVERSAL:STOCKTAKE:${movement.sourceDocumentId}`
    : isTransferPair
      ? `REVERSAL:TRANSFER:${movement.sourceDocumentId}`
      : `REVERSAL:${movement.movementId}`
  const requestedSnapshot = {
    reversalId,
    reason,
    targetMovementIds,
  }
  const existingReversals = targets.map((target) => movements.find(
    (candidate) => candidate.movementId === `MOV:REVERSAL:${target.movementId}`,
  ))
  const reversalGroup = movements.filter((candidate) => (
    candidate.sourceDocumentId === reversalId
  ))
  const expectedReversalIds = new Set(
    targetMovementIds.map((movementId) => `MOV:REVERSAL:${movementId}`),
  )
  if (
    reversalGroup.length > 0
    && (
      reversalGroup.length !== expectedReversalIds.size
      || reversalGroup.some((candidate) => (
        candidate.sourceDocumentType !== 'reversal'
        || !expectedReversalIds.has(candidate.movementId)
      ))
    )
  ) {
    throw new Error('冲销物理键集合与预期不一致，请人工修复')
  }
  const existingCount = existingReversals.filter(Boolean).length
  if (existingCount > 0 && existingCount !== targets.length) {
    throw new Error('冲销目标集不完整，请人工修复')
  }
  const auditOperator = existingCount
    ? operatorFromMovement(existingReversals[0], operator)
    : operator
  const persistedSnapshot = existingCount
    ? cloneJson(existingReversals[0].reversalSnapshot)
    : {
        ...requestedSnapshot,
        operatorEmployeeId: auditOperator.employeeId || '',
        operatorEmployeeName: auditOperator.name || '',
        occurredAt: auditOperator.occurredAt || '',
      }
  if (existingCount && !reversalSnapshotMatches(persistedSnapshot, requestedSnapshot)) {
    throw new Error('冲销重试请求与已确认快照冲突')
  }
  if (
    existingCount === targets.length
    && existingReversals.some((existing, index) => (
      !reversalMovementMatchesTarget(existing, targets[index], persistedSnapshot, sourceDocument)
    ))
  ) {
    throw new Error('冲销重试请求与已确认快照冲突')
  }
  const createdReversals = existingCount ? [] : targets.map((target) => ({
    ...createMovement({
      movementId: `MOV:REVERSAL:${target.movementId}`,
      movementType: MOVEMENT_TYPES.reversal,
      sourceDocumentType: 'reversal',
      sourceDocumentId: reversalId,
      variantId: target.variantId,
      itemId: target.itemId,
      warehouseId: target.warehouseId,
      locationId: target.locationId,
      quantityDelta: -Number(target.quantityDelta),
      unitPrice: target.unitPrice,
      projectId: target.projectId || '',
      projectName: target.projectName || '',
      reason,
      operator: auditOperator,
      reversalOf: target.movementId,
    }),
    reversalSnapshot: { ...persistedSnapshot, targetMovementIds: [...targetMovementIds] },
    ...(target.sourceDocumentType === 'stocktake'
      ? { sourceDocumentSnapshot: sourceSnapshotForReversal(target, sourceDocument) }
      : {}),
  }))
  const resolvedReversals = existingCount ? existingReversals : createdReversals
  const movementIds = resolvedReversals.map((entry) => entry.movementId)
  const document = {
    reversalId,
    originalMovementId: targets[0].movementId,
    originalMovementIds: targetMovementIds,
    reason,
    ...confirmationFields(auditOperator),
    movementId: movementIds[0],
    movementIds,
  }

  const correction = reversalCostRecord({
    movement: targets[0],
    projectCostRecords,
    operator: auditOperator,
    reason,
    reversalId,
  })
  const expectedCorrectionIds = new Set(correction ? [correction.costRecordId] : [])
  const reversalCosts = projectCostRecords.filter((record) => (
    record.reversalId === reversalId
  ))
  if (
    reversalCosts.length > 0
    && (
      reversalCosts.length !== expectedCorrectionIds.size
      || reversalCosts.some((record) => (
        record.sourceType !== 'warehouseReversal'
        || !expectedCorrectionIds.has(record.costRecordId)
      ))
    )
  ) {
    throw new Error('冲销项目成本物理键集合与预期不一致，请人工修复')
  }
  let nextProjectCosts = projectCostRecords
  if (correction) {
    const existingCorrection = projectCostRecords.find(
      (record) => record.costRecordId === correction.costRecordId,
    )
    if (existingCorrection) {
      if (JSON.stringify(existingCorrection) !== JSON.stringify(correction)) {
        throw new Error('冲销成本记录与已确认快照冲突')
      }
    } else {
      nextProjectCosts = [...projectCostRecords, correction]
    }
  }

  if (
    sourceDocument.status !== WAREHOUSE_STATUS.confirmed
    && !(sourceDocument.status === WAREHOUSE_STATUS.void && sourceDocument.reversalId === reversalId)
  ) {
    throw new Error('仅已确认源单据可执行冲销')
  }
  const reversedSourceDocument = {
    ...confirmedSourceDocumentSnapshot(sourceDocument),
    status: WAREHOUSE_STATUS.void,
    reversalId,
    reversalMovementIds: movementIds,
    reversedByEmployeeId: auditOperator.employeeId || '',
    reversedByEmployeeName: auditOperator.name || '',
    reversedAt: auditOperator.occurredAt || '',
    reversalReason: reason,
  }
  if (
    sourceDocument.status === WAREHOUSE_STATUS.void
    && !exactJsonEqual(sourceDocument, reversedSourceDocument)
  ) {
    throw new Error('已冲销源单据与确定性快照冲突')
  }

  return {
    document,
    sourceDocument: reversedSourceDocument,
    movements: createdReversals.length > 0 ? [...movements, ...createdReversals] : movements,
    projectCostRecords: nextProjectCosts,
  }
}

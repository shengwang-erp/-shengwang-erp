import assert from 'node:assert/strict'
import test from 'node:test'

import { MOVEMENT_TYPES } from './warehouseConstants.js'
import {
  confirmStockIn,
  confirmStockOut,
  confirmStockReturn,
  confirmStocktake,
  createReversal,
  createTransfer,
  getLocationBalance,
  getVariantBalance,
  getWarehouseCostState,
  normalizeWarehouseVariant,
} from './warehouseDomain.js'

const operator = {
  employeeId: 'E-WH',
  name: '仓管员',
  occurredAt: '2026-08-05T15:30:00.000Z',
}

const variant = {
  variantId: 'V-001',
  itemId: 'I-001',
  sku: 'SW-000001',
  unit: '个',
  warehouseUnitPrice: 999,
  minimumStock: 0,
}

const openingMovement = {
  movementId: 'MOV:OPENING:V-001:L-A',
  movementType: MOVEMENT_TYPES.stockIn,
  sourceDocumentType: 'opening',
  sourceDocumentId: 'OPENING-1',
  variantId: 'V-001',
  itemId: 'I-001',
  warehouseId: 'W-A',
  locationId: 'L-A',
  quantityDelta: 5,
  unitPrice: 120,
  amount: 600,
  projectId: '',
  projectName: '',
  reason: '期初库存',
  operatorEmployeeId: 'SYSTEM',
  operatorEmployeeName: '系统',
  occurredAt: '2026-08-01T00:00:00.000Z',
  reversalOf: '',
}

test('warehouse quantities reject non-finite or nonpositive commands and normalize nonnegative fields', () => {
  assert.equal(normalizeWarehouseVariant({ minimumStock: -1 }).minimumStock, 0)
  assert.equal(
    normalizeWarehouseVariant({ warehouseUnitPrice: Number.POSITIVE_INFINITY }).warehouseUnitPrice,
    0,
  )

  for (const requestedQuantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => confirmStockIn({
      receipt: {
        stockInId: `SI-${String(requestedQuantity)}`,
        variantId: variant.variantId,
        warehouseId: 'W-A',
        locationId: 'L-A',
        requestedQuantity,
        purchaseUnitPrice: 120,
      },
      variant,
      operator,
    }), /数量必须是大于 0 的有限数字/)
  }

  for (const countedQuantity of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => confirmStocktake({
      stocktake: {
        stocktakeId: `ST-${String(countedQuantity)}`,
        warehouseId: 'W-A',
        lines: [{
          variantId: variant.variantId,
          locationId: 'L-A',
          countedQuantity,
        }],
      },
      movements: [openingMovement],
      variants: [variant],
      operator,
    }), /盘点数量必须是非负有限数字/)
  }

  const zeroStocktake = confirmStocktake({
    stocktake: {
      stocktakeId: 'ST-ZERO',
      warehouseId: 'W-A',
      lines: [{ variantId: variant.variantId, locationId: 'L-A', countedQuantity: 0 }],
    },
    variants: [variant],
    operator,
  })
  assert.equal(zeroStocktake.movements[0].movementType, MOVEMENT_TYPES.stocktakeNoChange)
})

test('cost replay preserves FIFO-priced outflows across two purchase prices', () => {
  const movements = [
    { ...openingMovement, movementId: 'IN-OLD', quantityDelta: 2, unitPrice: 100, occurredAt: '2026-08-01T00:00:00Z' },
    { ...openingMovement, movementId: 'IN-NEW', quantityDelta: 2, unitPrice: 200, occurredAt: '2026-08-02T00:00:00Z' },
    { ...openingMovement, movementId: 'OUT-OLD', movementType: MOVEMENT_TYPES.stockOut, quantityDelta: -2, unitPrice: 100, occurredAt: '2026-08-03T00:00:00Z' },
    { ...openingMovement, movementId: 'OUT-NEW', movementType: MOVEMENT_TYPES.stockOut, quantityDelta: -1, unitPrice: 200, occurredAt: '2026-08-03T00:00:01Z' },
  ]

  assert.deepEqual(getWarehouseCostState(movements, 'V-001', 'W-A'), {
    variantId: 'V-001',
    warehouseId: 'W-A',
    quantity: 1,
    stockValue: 200,
    warehouseUnitPrice: 200,
  })
})

test('stock-out freezes its historical cost snapshot instead of using the mutable catalog price', () => {
  const result = confirmStockOut({
    request: {
      stockOutId: 'SO-HISTORY',
      variantId: 'V-001',
      warehouseId: 'W-A',
      sourceLocationId: 'L-A',
      requestedQuantity: 2,
      projectId: 'P-001',
      projectName: '东京项目',
    },
    movements: [openingMovement],
    projectCostRecords: [],
    variant,
    operator,
  })

  assert.equal(result.movements.at(-1).unitPrice, 120)
  assert.equal(result.document.totalCost, 240)
  assert.equal(result.projectCostRecords[0].amount, 240)

  const replay = confirmStockOut({
    request: result.document,
    movements: result.movements,
    projectCostRecords: result.projectCostRecords,
    variant: { ...variant, warehouseUnitPrice: 5000 },
    operator,
  })
  assert.equal(replay.movements.at(-1).unitPrice, 120)
  assert.equal(replay.movements, result.movements)
})

test('a partial return restores quantity and reverses project cost at the original outflow price', () => {
  const result = confirmStockReturn({
    request: {
      stockReturnId: 'SR-PARTIAL',
      variantId: 'V-001',
      warehouseId: 'W-A',
      locationId: 'L-A',
      requestedQuantity: 1,
      projectId: 'P-001',
      projectName: '东京项目',
      reason: '项目余料',
    },
    originalStockOut: { stockOutId: 'SO-ORIGINAL', confirmedQuantity: 3, unitPrice: 135 },
    movements: [openingMovement],
    projectCostRecords: [],
    variant: { ...variant, warehouseUnitPrice: 9000 },
    operator,
  })

  assert.equal(result.movements.at(-1).quantityDelta, 1)
  assert.equal(result.movements.at(-1).unitPrice, 135)
  assert.equal(result.projectCostRecords.at(-1).amount, -135)
})

test('a transfer conserves company quantity and cost while moving the source balance', () => {
  const result = createTransfer({
    transfer: {
      transferId: 'TR-001',
      variantId: 'V-001',
      sourceWarehouseId: 'W-A',
      sourceLocationId: 'L-A',
      destinationWarehouseId: 'W-B',
      destinationLocationId: 'L-B',
      quantity: 2,
      reason: '仓位调整',
    },
    movements: [openingMovement],
    variant,
    item: { itemId: 'I-001', name: '铜管', category: '材料' },
    sourceLocation: { locationId: 'L-A', warehouseId: 'W-A', warehouseName: '主仓' },
    destinationLocation: { locationId: 'L-B', warehouseId: 'W-B', warehouseName: '辅仓' },
    operator,
  })

  assert.equal(getVariantBalance(result.movements, 'V-001'), 5)
  assert.equal(getLocationBalance(result.movements, 'V-001', 'L-A'), 3)
  assert.equal(getLocationBalance(result.movements, 'V-001', 'L-B'), 2)
  assert.deepEqual(result.movements.slice(-2).map((movement) => movement.quantityDelta), [-2, 2])
  assert.equal(result.movements.at(-2).amount, result.movements.at(-1).amount)
  const sourceCost = getWarehouseCostState(result.movements, 'V-001', 'W-A')
  const destinationCost = getWarehouseCostState(result.movements, 'V-001', 'W-B')
  assert.equal(sourceCost.stockValue + destinationCost.stockValue, 600)
})

test('stocktake records gain and loss differences with deterministic line ids', () => {
  const secondVariant = { ...variant, variantId: 'V-002', itemId: 'I-002' }
  const secondOpening = {
    ...openingMovement,
    movementId: 'MOV:OPENING:V-002:L-A',
    variantId: 'V-002',
    itemId: 'I-002',
    quantityDelta: 4,
    unitPrice: 50,
    amount: 200,
  }
  const result = confirmStocktake({
    stocktake: {
      stocktakeId: 'ST-001',
      warehouseId: 'W-A',
      month: '2026-08',
      lines: [
        { variantId: 'V-001', locationId: 'L-A', countedQuantity: 7, differenceType: '盘盈', reason: '补录' },
        { variantId: 'V-002', locationId: 'L-A', countedQuantity: 3, differenceType: '损坏', reason: '破损' },
      ],
    },
    movements: [openingMovement, secondOpening],
    variants: [variant, secondVariant],
    operator,
  })

  assert.deepEqual(result.movements.slice(-2).map((movement) => ({
    id: movement.movementId,
    type: movement.movementType,
    delta: movement.quantityDelta,
  })), [
    { id: 'MOV:STOCKTAKE:ST-001:V-001:L-A', type: MOVEMENT_TYPES.gain, delta: 2 },
    { id: 'MOV:STOCKTAKE:ST-001:V-002:L-A', type: MOVEMENT_TYPES.damaged, delta: -1 },
  ])
})

test('reversal identifiers are deterministic and append the exact inverse movement', () => {
  const stockOut = confirmStockOut({
    request: {
      stockOutId: 'SO-REV',
      variantId: 'V-001',
      warehouseId: 'W-A',
      sourceLocationId: 'L-A',
      requestedQuantity: 2,
      projectId: 'P-001',
      projectName: '东京项目',
      reason: '领料',
    },
    movements: [openingMovement],
    projectCostRecords: [],
    variant,
    operator,
  })
  const original = stockOut.movements.at(-1)
  const result = createReversal({
    movement: original,
    movements: stockOut.movements,
    projectCostRecords: stockOut.projectCostRecords,
    sourceDocument: stockOut.document,
    operator,
    reason: '录入错误',
  })

  assert.equal(result.document.reversalId, 'REVERSAL:MOV:STOCK_OUT:SO-REV')
  assert.equal(result.movements.at(-1).movementId, 'MOV:REVERSAL:MOV:STOCK_OUT:SO-REV')
  assert.equal(result.movements.at(-1).reversalOf, original.movementId)
  assert.equal(result.movements.at(-1).quantityDelta, -original.quantityDelta)
})

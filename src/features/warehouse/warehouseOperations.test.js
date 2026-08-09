import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildOperationReversalCommand,
  buildStocktakeConfirmationCommand,
  buildTransferConfirmationCommand,
} from './warehouseOperations.js'

const ID = Object.freeze({
  transfer: 'b1000000-0000-4000-8000-000000000001',
  stocktake: 'b2000000-0000-4000-8000-000000000001',
  line: 'b2100000-0000-4000-8000-000000000001',
  sourceDocument: 'b3000000-0000-4000-8000-000000000001',
  variant: 'b4000000-0000-4000-8000-000000000001',
  warehouseA: 'b5000000-0000-4000-8000-000000000001',
  warehouseB: 'b5000000-0000-4000-8000-000000000002',
  locationA: 'b5100000-0000-4000-8000-000000000001',
  locationB: 'b5100000-0000-4000-8000-000000000002',
})

test('transfer command is exact, fixed-decimal, immutable, and contains no authority fields', () => {
  const command = buildTransferConfirmationCommand({
    transferId: ID.transfer,
    variantId: ID.variant,
    sourceWarehouseId: ID.warehouseA,
    sourceLocationId: ID.locationA,
    destinationWarehouseId: ID.warehouseB,
    destinationLocationId: ID.locationB,
    quantity: 0.3,
    reason: '项目间调拨',
    idempotencyKey: 'transfer-confirm-1',
  })

  assert.deepEqual(command, {
    transferId: ID.transfer,
    variantId: ID.variant,
    sourceWarehouseId: ID.warehouseA,
    sourceLocationId: ID.locationA,
    destinationWarehouseId: ID.warehouseB,
    destinationLocationId: ID.locationB,
    quantity: 0.3,
    reason: '项目间调拨',
    idempotencyKey: 'transfer-confirm-1',
  })
  assert.equal(Object.isFrozen(command), true)
  assert.throws(() => buildTransferConfirmationCommand({ ...command, operatorId: ID.line }))
  assert.throws(() => buildTransferConfirmationCommand({ ...command, unitCost: 0 }))
  assert.throws(() => buildTransferConfirmationCommand({
    ...command,
    destinationWarehouseId: ID.warehouseA,
    destinationLocationId: ID.locationA,
  }))
  assert.throws(() => buildTransferConfirmationCommand({ ...command, quantity: 0.0001 }))
})

test('stocktake command accepts exact nonnegative quantities and closed difference types', () => {
  const command = buildStocktakeConfirmationCommand({
    stocktakeId: ID.stocktake,
    warehouseId: ID.warehouseA,
    stocktakeMonth: '2026-08',
    idempotencyKey: 'stocktake-confirm-1',
    lines: [{
      stocktakeLineId: ID.line,
      variantId: ID.variant,
      locationId: ID.locationA,
      countedQuantity: 0,
      differenceType: 'scrapped',
      reason: '破损报废',
      approvedUnitCost: null,
    }],
  })

  assert.equal(command.lines[0].countedQuantity, 0)
  assert.equal(Object.isFrozen(command.lines), true)
  assert.equal(Object.isFrozen(command.lines[0]), true)
  assert.throws(() => buildStocktakeConfirmationCommand({
    ...command,
    lines: [{ ...command.lines[0], approvedUnitCost: 10 }],
  }))
  assert.throws(() => buildStocktakeConfirmationCommand({
    ...command,
    lines: [{ ...command.lines[0], differenceType: 'repair' }],
  }))
  assert.throws(() => buildStocktakeConfirmationCommand({
    ...command,
    lines: [{ ...command.lines[0], reason: '' }],
  }))
  assert.throws(() => buildStocktakeConfirmationCommand({
    ...command,
    lines: [{
      ...command.lines[0],
      differenceType: 'no_change',
      reason: '不应携带差异原因',
      approvedUnitCost: null,
    }],
  }))
  assert.throws(() => buildStocktakeConfirmationCommand({
    ...command,
    lines: [command.lines[0], command.lines[0]],
  }))

  const zeroStockGain = buildStocktakeConfirmationCommand({
    ...command,
    lines: [{
      ...command.lines[0],
      differenceType: 'gain',
      reason: '首次盘盈审批',
      approvedUnitCost: 0,
    }],
  })
  assert.equal(zeroStockGain.lines[0].approvedUnitCost, 0)
  assert.throws(() => buildStocktakeConfirmationCommand({
    ...command,
    lines: [{
      ...command.lines[0],
      differenceType: 'gain',
      approvedUnitCost: 0.00001,
    }],
  }))
})

test('reversal command selects one complete source document and forbids reversal-of-reversal', () => {
  const command = buildOperationReversalCommand({
    sourceDocumentType: 'warehouse_stock_out',
    sourceDocumentId: ID.sourceDocument,
    reason: '整单录入错误',
    idempotencyKey: 'reverse-operation-1',
  })
  assert.deepEqual(command, {
    sourceDocumentType: 'warehouse_stock_out',
    sourceDocumentId: ID.sourceDocument,
    reason: '整单录入错误',
    idempotencyKey: 'reverse-operation-1',
  })
  assert.equal(Object.isFrozen(command), true)
  assert.throws(() => buildOperationReversalCommand({
    ...command,
    sourceDocumentType: 'warehouse_reversal',
  }))
  assert.throws(() => buildOperationReversalCommand({
    ...command,
    movementIds: [ID.line],
  }))
})

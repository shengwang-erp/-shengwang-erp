import assert from 'node:assert/strict'
import test from 'node:test'

import {
  updateMonthlyStocktakeLine,
  validateMonthlyStocktakeLines,
  validateWarehouseTransfer,
} from './warehousePage.js'

test('transfer draft validation accepts only a finite positive quantity', () => {
  const base = {
    variantId: 'V-001',
    sourceLocationId: 'L-A',
    destinationLocationId: 'L-B',
    reason: '仓位调整',
  }

  for (const quantity of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(validateWarehouseTransfer({ ...base, quantity }), {
      error: '调拨数量必须大于 0',
    })
  }
  assert.deepEqual(validateWarehouseTransfer({ ...base, quantity: '2.5' }), {
    error: '',
    value: { ...base, quantity: 2.5 },
  })
})

test('monthly stocktake lines compute differences and require matching reasons', () => {
  const gain = updateMonthlyStocktakeLine(
    { variantId: 'V-001', locationId: 'L-A', bookQuantity: 5 },
    { countedQuantity: '7', differenceType: '盘盈', reason: '补录' },
  )
  const damaged = updateMonthlyStocktakeLine(
    { variantId: 'V-002', locationId: 'L-A', bookQuantity: 4 },
    { countedQuantity: '3', differenceType: '损坏', reason: '破损' },
  )

  assert.equal(gain.difference, 2)
  assert.equal(damaged.difference, -1)
  assert.deepEqual(validateMonthlyStocktakeLines([gain, damaged]), {
    error: '',
    lines: [
      { ...gain, countedQuantity: 7, difference: 2 },
      { ...damaged, countedQuantity: 3, difference: -1 },
    ],
  })
  assert.deepEqual(validateMonthlyStocktakeLines([{ ...gain, countedQuantity: -1 }]), {
    error: '实盘数量必须是非负有限数字',
  })
  assert.deepEqual(validateMonthlyStocktakeLines([{ ...gain, countedQuantity: Infinity }]), {
    error: '实盘数量必须是非负有限数字',
  })
})

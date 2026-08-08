import assert from 'node:assert/strict'
import test from 'node:test'

import {
  addScaledUnits,
  costUnitsToNumber,
  deriveStockValueUnits,
  deriveWeightedUnitCostUnits,
  parseCostUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from './warehouseDecimal.js'

const MAX_SAFE_UNITS = 9007199254740991n

test('canonical number decimals and exponent forms convert to exact scaled BigInt units', () => {
  assert.equal(parseCostUnits(100000000000.0001), 1000000000000001n)
  assert.equal(parseCostUnits(0.0001), 1n)
  assert.equal(parseCostUnits(1e-4), 1n)
  assert.equal(parseQuantityUnits(0.001), 1n)
  assert.equal(parseQuantityUnits(1e3), 1000000n)
  assert.equal(costUnitsToNumber(1000000000000001n), 100000000000.0001)
  assert.equal(quantityUnitsToNumber(1000000n), 1000)
})

test('nonnegative scaled division rounds exact halves away from zero', () => {
  assert.equal(deriveStockValueUnits(499n, 1n), 0n)
  assert.equal(deriveStockValueUnits(500n, 1n), 1n)
  assert.equal(deriveStockValueUnits(1500n, 1n), 2n)
  assert.equal(deriveWeightedUnitCostUnits(1n, 2001n), 0n)
  assert.equal(deriveWeightedUnitCostUnits(1n, 2000n), 1n)
  assert.equal(deriveWeightedUnitCostUnits(3n, 2000n), 2n)
})

test('scaled units preserve the exact maximum safe boundary and reject overflow', () => {
  assert.equal(parseCostUnits(900719925474.0991), MAX_SAFE_UNITS)
  assert.equal(costUnitsToNumber(MAX_SAFE_UNITS), 900719925474.0991)
  assert.equal(addScaledUnits(MAX_SAFE_UNITS - 1n, 1n), MAX_SAFE_UNITS)
  assert.throws(() => parseCostUnits(900719925474.0992), TypeError)
  assert.throws(() => addScaledUnits(MAX_SAFE_UNITS, 1n), TypeError)
  assert.throws(() => deriveStockValueUnits(MAX_SAFE_UNITS, MAX_SAFE_UNITS), TypeError)
})

test('scaled parsing rejects strings, negatives, non-finite values, and excess nonzero decimals', () => {
  for (const value of ['1', -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
    assert.throws(() => parseCostUnits(value), TypeError)
  }
  assert.throws(() => parseCostUnits(1.00001), TypeError)
  assert.throws(() => parseCostUnits(1e-7), TypeError)
  assert.throws(() => parseQuantityUnits(1.0001), TypeError)
  assert.throws(() => parseQuantityUnits(0.0001), TypeError)
})

test('BigInt aggregation and weighted derivation do not repeat floating-point rounding', () => {
  const unitCost = parseCostUnits(100000000000.0001)
  const quantity = parseQuantityUnits(1)
  const firstValue = deriveStockValueUnits(quantity, unitCost)
  const totalValue = addScaledUnits(firstValue, firstValue)
  const totalQuantity = addScaledUnits(quantity, quantity)

  assert.equal(firstValue, 1000000000000001n)
  assert.equal(totalValue, 2000000000000002n)
  assert.equal(deriveWeightedUnitCostUnits(totalValue, totalQuantity), unitCost)
  assert.equal(costUnitsToNumber(totalValue), 200000000000.0002)
})

test('zero quantity requires zero cost and value', () => {
  assert.equal(deriveStockValueUnits(0n, 0n), 0n)
  assert.equal(deriveWeightedUnitCostUnits(0n, 0n), 0n)
  assert.throws(() => deriveStockValueUnits(0n, 1n), TypeError)
  assert.throws(() => deriveWeightedUnitCostUnits(1n, 0n), TypeError)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  calculateBillingAmounts,
  createEmptyBillingItem,
  normalizeBillingItem,
  summarizeBillingItems,
} from './miraisyaBillingDomain.js'

test('new billing rows use one unit and ten percent tax defaults', () => {
  assert.deepEqual(createEmptyBillingItem(), {
    itemName: '', description: '', quantity: 1, unit: '式', unitPrice: 0, taxRate: 10,
  })
})

test('ten and zero percent lines calculate independently', () => {
  const totals = summarizeBillingItems([
    { itemName: '工事费', description: '', quantity: 1, unit: '式', unitPrice: 12000, taxRate: 10 },
    { itemName: '本体', description: '', quantity: 1, unit: '台', unitPrice: 120000, taxRate: 0 },
  ])
  assert.deepEqual(totals, {
    taxExclusiveAmount: 132000,
    taxAmount: 1200,
    taxInclusiveAmount: 133200,
  })
})

test('quantity supports at most four decimal places and rounds each line to yen', () => {
  assert.deepEqual(calculateBillingAmounts(1.2345, 1000, 10), {
    taxExclusiveAmount: 1235,
    taxAmount: 124,
    taxInclusiveAmount: 1359,
  })
})

test('billing rows normalize to six exact fields', () => {
  assert.deepEqual(normalizeBillingItem({
    itemName: ' 空调安装 ', description: ' 2階 ', quantity: 1,
    unit: ' 式 ', unitPrice: 50000, taxRate: 10, callerAuthority: true,
  }), {
    itemName: '空调安装', description: '2階', quantity: 1,
    unit: '式', unitPrice: 50000, taxRate: 10,
  })
})

test('invalid numbers, rates, rows, and sparse arrays fail closed', () => {
  for (const input of [
    [0, 100, 10],
    [-1, 100, 10],
    [1.00001, 100, 10],
    [1, -1, 10],
    [1, Number.MAX_SAFE_INTEGER + 1, 10],
    [1, 100, 8],
  ]) assert.throws(() => calculateBillingAmounts(...input), /收费明细无效/)

  assert.throws(() => normalizeBillingItem(null), /收费明细无效/)
  assert.throws(() => normalizeBillingItem({
    itemName: '', description: '', quantity: 1, unit: '式', unitPrice: 0, taxRate: 10,
  }), /收费明细无效/)

  const sparse = []
  sparse.length = 1
  assert.throws(() => summarizeBillingItems(sparse), /收费明细无效/)
})

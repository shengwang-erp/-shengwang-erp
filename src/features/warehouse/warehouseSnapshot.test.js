import assert from 'node:assert/strict'
import test from 'node:test'

import { buildWarehouseSnapshot } from './warehouseSnapshot.js'

const ITEM_A = Object.freeze({
  id: '92000000-0000-4000-8000-000000000001',
  name: '铜管',
  category: '空调材料',
  brand: '厂家A',
  description: '',
  active: true,
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
})
const ITEM_B = Object.freeze({ ...ITEM_A, id: '92000000-0000-4000-8000-000000000002', name: '保温棉' })
const VARIANT_A = Object.freeze({
  id: '93000000-0000-4000-8000-000000000001',
  itemId: ITEM_A.id,
  sku: 'CU-6MM',
  model: 'R410A',
  size: '6mm',
  material: '铜',
  unit: '米',
  minimumStock: 20,
  systemQr: 'SWERP:VARIANT:CU-6MM',
  manufacturerQr: null,
  active: true,
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
})
const VARIANT_B = Object.freeze({
  ...VARIANT_A,
  id: '93000000-0000-4000-8000-000000000002',
  itemId: ITEM_B.id,
  sku: 'INS-20MM',
  model: 'STANDARD',
  size: '20mm',
  material: '橡塑',
  unit: '根',
  minimumStock: 5,
  systemQr: 'SWERP:VARIANT:INS-20MM',
})
const LOCATIONS = Object.freeze([
  Object.freeze({
    id: '91000000-0000-4000-8000-000000000002',
    warehouseId: '90000000-0000-4000-8000-000000000001',
    shelfCode: 'B-01',
    shelfName: 'B区一号架',
    active: true,
    createdAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
  }),
  Object.freeze({
    id: '91000000-0000-4000-8000-000000000001',
    warehouseId: '90000000-0000-4000-8000-000000000001',
    shelfCode: 'A-01',
    shelfName: 'A区一号架',
    active: true,
    createdAt: '2026-08-08T00:00:00Z',
    updatedAt: '2026-08-08T00:00:00Z',
  }),
])

function balance(variantId, locationId, quantity, costs = {}) {
  return {
    variantId,
    warehouseId: '90000000-0000-4000-8000-000000000001',
    locationId,
    quantity,
    ...costs,
  }
}

test('snapshot deterministically aggregates balances and identifies low stock by variant total', () => {
  const snapshot = buildWarehouseSnapshot({
    items: [ITEM_B, ITEM_A],
    variants: [VARIANT_B, VARIANT_A],
    locations: LOCATIONS,
    balances: [
      balance(VARIANT_A.id, LOCATIONS[0].id, 4),
      balance(VARIANT_B.id, LOCATIONS[1].id, 6),
      balance(VARIANT_A.id, LOCATIONS[1].id, 10),
    ],
  })

  assert.deepEqual(snapshot.overview, {
    itemCount: 2,
    variantCount: 2,
    locationCount: 2,
    stockedVariantCount: 2,
    totalQuantity: 20,
    lowStockCount: 1,
  })
  assert.deepEqual(snapshot.inventory.map(({ sku, quantity, isLowStock }) => ({ sku, quantity, isLowStock })), [
    { sku: 'CU-6MM', quantity: 14, isLowStock: true },
    { sku: 'INS-20MM', quantity: 6, isLowStock: false },
  ])
  assert.deepEqual(snapshot.inventory[0].locations.map(({ locationId, quantity }) => ({ locationId, quantity })), [
    { locationId: LOCATIONS[1].id, quantity: 10 },
    { locationId: LOCATIONS[0].id, quantity: 4 },
  ])
  assert.deepEqual(snapshot.lowStock.map(({ variantId }) => variantId), [VARIANT_A.id])
})

test('zero-balance variants remain visible and are low stock only when their threshold is positive', () => {
  const noMinimum = { ...VARIANT_B, minimumStock: 0 }
  const snapshot = buildWarehouseSnapshot({
    items: [ITEM_A, ITEM_B],
    variants: [VARIANT_A, noMinimum],
    locations: LOCATIONS,
    balances: [],
  })

  assert.deepEqual(snapshot.inventory.map(({ quantity, isLowStock }) => ({ quantity, isLowStock })), [
    { quantity: 0, isLowStock: true },
    { quantity: 0, isLowStock: false },
  ])
  assert.equal(snapshot.overview.stockedVariantCount, 0)
  assert.equal(snapshot.overview.lowStockCount, 1)
})

test('cost output is wholly absent by default even if unrelated records have cost-like names', () => {
  const snapshot = buildWarehouseSnapshot({
    items: [ITEM_A],
    variants: [VARIANT_A],
    locations: LOCATIONS,
    balances: [balance(VARIANT_A.id, LOCATIONS[0].id, 2)],
  })

  assert.equal(Object.hasOwn(snapshot.overview, 'totalStockValue'), false)
  assert.equal(Object.hasOwn(snapshot.inventory[0], 'unitCost'), false)
  assert.equal(Object.hasOwn(snapshot.inventory[0], 'stockValue'), false)
  assert.equal(Object.hasOwn(snapshot.inventory[0].locations[0], 'unitCost'), false)
  assert.equal(Object.hasOwn(snapshot.inventory[0].locations[0], 'stockValue'), false)
})

test('explicit viewCost adds weighted costs without changing low-stock decisions', () => {
  const snapshot = buildWarehouseSnapshot({
    items: [ITEM_A],
    variants: [{ ...VARIANT_A, defaultPurchasePrice: 999 }],
    locations: LOCATIONS,
    balances: [
      balance(VARIANT_A.id, LOCATIONS[0].id, 2, { unitCost: 100, stockValue: 200 }),
      balance(VARIANT_A.id, LOCATIONS[1].id, 3, { unitCost: 120, stockValue: 360 }),
    ],
    viewCost: true,
  })

  assert.equal(snapshot.overview.totalStockValue, 560)
  assert.equal(snapshot.inventory[0].quantity, 5)
  assert.equal(snapshot.inventory[0].unitCost, 112)
  assert.equal(snapshot.inventory[0].stockValue, 560)
  assert.equal(snapshot.inventory[0].isLowStock, true)
  assert.deepEqual(snapshot.inventory[0].locations.map(({ unitCost, stockValue }) => ({ unitCost, stockValue })), [
    { unitCost: 120, stockValue: 360 },
    { unitCost: 100, stockValue: 200 },
  ])
})

test('snapshot results are deep frozen copies and do not mutate inputs', () => {
  const items = [{ ...ITEM_A }]
  const variants = [{ ...VARIANT_A }]
  const locations = LOCATIONS.map((entry) => ({ ...entry }))
  const balances = [balance(VARIANT_A.id, LOCATIONS[0].id, 2)]
  const snapshot = buildWarehouseSnapshot({ items, variants, locations, balances })

  for (const value of [
    snapshot,
    snapshot.overview,
    snapshot.inventory,
    snapshot.inventory[0],
    snapshot.inventory[0].locations,
    snapshot.inventory[0].locations[0],
    snapshot.lowStock,
    snapshot.lowStock[0],
  ]) assert.equal(Object.isFrozen(value), true)
  assert.throws(() => { snapshot.inventory[0].quantity = 999 }, TypeError)
  assert.equal(variants[0].quantity, undefined)
  assert.equal(balances[0].quantity, 2)
})

test('snapshot rejects malformed exact shapes, duplicate IDs and orphan relations', () => {
  const base = {
    items: [ITEM_A],
    variants: [VARIANT_A],
    locations: LOCATIONS,
    balances: [balance(VARIANT_A.id, LOCATIONS[0].id, 2)],
  }
  const invalid = [
    { ...base, unexpected: true },
    { ...base, items: Object.assign([ITEM_A], { extra: true }) },
    { ...base, items: [{ ...ITEM_A, extra: true }] },
    { ...base, items: [ITEM_A, ITEM_A] },
    { ...base, variants: [{ ...VARIANT_A, itemId: ITEM_B.id }] },
    { ...base, locations: [LOCATIONS[0], LOCATIONS[0]] },
    { ...base, balances: [balance(VARIANT_B.id, LOCATIONS[0].id, 2)] },
    { ...base, balances: [balance(VARIANT_A.id, '99999999-0000-4000-8000-000000000001', 2)] },
    { ...base, balances: [balance(VARIANT_A.id, LOCATIONS[0].id, -1)] },
    { ...base, viewCost: true },
    { ...base, balances: [{ ...base.balances[0], unitCost: 1, stockValue: 1 }] },
  ]
  for (const input of invalid) {
    assert.throws(() => buildWarehouseSnapshot(input), /仓库快照数据无效/u)
  }
})

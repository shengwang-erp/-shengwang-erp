import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildWarehouseItemMutation,
  buildWarehouseLocationMutation,
  buildWarehouseSiteMutation,
  buildWarehouseVariantMutation,
} from './warehouseCatalogPersistence.js'

const IDS = Object.freeze({
  site: '90000000-0000-4000-8000-000000000001',
  location: '91000000-0000-4000-8000-000000000001',
  item: '92000000-0000-4000-8000-000000000001',
  variant: '93000000-0000-4000-8000-000000000001',
})

test('catalog builders Unicode-trim and NFC-normalize exact mutation payloads', () => {
  const site = buildWarehouseSiteMutation({
    id: IDS.site,
    code: '\u2003MAIN\u00a0',
    name: ' 本社倉 ',
    kind: 'normal',
    active: true,
  })
  const location = buildWarehouseLocationMutation({
    id: IDS.location,
    warehouseId: IDS.site,
    shelfCode: '\u3000A-01\u2009',
    shelfName: 'Ａ区一号架 ',
    active: true,
  })
  const item = buildWarehouseItemMutation({
    id: IDS.item,
    name: ' Cafe\u0301铜管 ',
    category: ' 空调材料 ',
    brand: ' 厂家A ',
    description: '\u00a0冷媒铜管\u3000',
    active: true,
  })
  const variant = buildWarehouseVariantMutation({
    id: IDS.variant,
    itemId: IDS.item,
    sku: ' CU-6MM ',
    model: ' R410A ',
    size: ' 6mm ',
    material: ' 铜 ',
    unit: ' 米 ',
    minimumStock: 20.125,
    defaultPurchasePrice: 118.2501,
    manufacturerQr: '\u2002Maker-Cafe\u0301-01\u00a0',
    active: true,
  })

  assert.deepEqual(site, {
    id: IDS.site,
    payload: { id: IDS.site, code: 'MAIN', name: '本社倉', kind: 'normal', active: true },
  })
  assert.deepEqual(location, {
    id: IDS.location,
    payload: {
      id: IDS.location,
      warehouseId: IDS.site,
      shelfCode: 'A-01',
      shelfName: 'Ａ区一号架',
      active: true,
    },
  })
  assert.deepEqual(item, {
    id: IDS.item,
    payload: {
      id: IDS.item,
      name: 'Café铜管',
      category: '空调材料',
      brand: '厂家A',
      description: '冷媒铜管',
      active: true,
    },
  })
  assert.deepEqual(variant, {
    id: IDS.variant,
    payload: {
      id: IDS.variant,
      itemId: IDS.item,
      sku: 'CU-6MM',
      model: 'R410A',
      size: '6mm',
      material: '铜',
      unit: '米',
      minimumStock: 20.125,
      defaultPurchasePrice: 118.2501,
      manufacturerQr: 'Maker-Café-01',
      active: true,
    },
  })
  for (const value of [site, site.payload, location, item, variant, variant.payload]) {
    assert.equal(Object.isFrozen(value), true)
  }
})

test('variant builder canonicalizes an edge-whitespace-only manufacturer QR to null', () => {
  const mutation = buildWarehouseVariantMutation({
    id: IDS.variant,
    itemId: IDS.item,
    sku: 'CU-6MM',
    model: '',
    size: '',
    material: '',
    unit: '米',
    minimumStock: 0,
    defaultPurchasePrice: 0,
    manufacturerQr: '\u00a0\u2003\u3000',
    active: false,
  })

  assert.equal(mutation.payload.manufacturerQr, null)
})

test('builders share an explicit invisible-edge policy and reject internal visual duplicates', () => {
  const edge = '\t\n\ufeff\u200b\u200c\u200d\u2060'
  const site = buildWarehouseSiteMutation({
    id: IDS.site,
    code: `${edge}MAIN${edge}`,
    name: `${edge}本社仓${edge}`,
    kind: 'normal',
    active: true,
  })
  assert.equal(site.payload.code, 'MAIN')
  assert.equal(site.payload.name, '本社仓')

  const blankQr = buildWarehouseVariantMutation({
    id: IDS.variant,
    itemId: IDS.item,
    sku: 'CU-6MM',
    model: '',
    size: '',
    material: '',
    unit: '米',
    minimumStock: 0,
    defaultPurchasePrice: 0,
    manufacturerQr: edge,
    active: true,
  })
  assert.equal(blankQr.payload.manufacturerQr, null)

  for (const manufacturerQr of [
    `${edge}SWERP:VARIANT:forged${edge}`,
    'Maker\u200b-QR',
    'Maker\u200c-QR',
    'Maker\u200d-QR',
    'Maker\u2060-QR',
    'Maker\ufeff-QR',
  ]) {
    assert.throws(() => buildWarehouseVariantMutation({
      id: IDS.variant,
      itemId: IDS.item,
      sku: 'CU-6MM',
      model: '',
      size: '',
      material: '',
      unit: '米',
      minimumStock: 0,
      defaultPurchasePrice: 0,
      manufacturerQr,
      active: true,
    }), TypeError)
  }
})

test('builders reject extra fields, accessors, inherited records and browser system QR input', () => {
  let getterCalls = 0
  const accessor = {
    id: IDS.site,
    code: 'MAIN',
    name: '本社仓',
    kind: 'normal',
    active: true,
  }
  Object.defineProperty(accessor, 'name', {
    enumerable: true,
    get() {
      getterCalls += 1
      return '不应读取'
    },
  })

  for (const operation of [
    () => buildWarehouseSiteMutation({
      id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true, extra: true,
    }),
    () => buildWarehouseSiteMutation(accessor),
    () => buildWarehouseSiteMutation(Object.assign(Object.create({ inherited: true }), {
      id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true,
    })),
    () => buildWarehouseVariantMutation({
      id: IDS.variant,
      itemId: IDS.item,
      sku: 'CU-6MM',
      model: '',
      size: '',
      material: '',
      unit: '米',
      minimumStock: 0,
      defaultPurchasePrice: 0,
      manufacturerQr: null,
      systemQr: `SWERP:VARIANT:${IDS.variant}`,
      active: true,
    }),
  ]) assert.throws(operation, TypeError)
  assert.equal(getterCalls, 0)
})

test('builders enforce UUIDs, closed enums, lengths and exact nonnegative decimal scales', () => {
  const baseVariant = {
    id: IDS.variant,
    itemId: IDS.item,
    sku: 'CU-6MM',
    model: '',
    size: '',
    material: '',
    unit: '米',
    minimumStock: 0,
    defaultPurchasePrice: 0,
    manufacturerQr: null,
    active: true,
  }
  for (const operation of [
    () => buildWarehouseSiteMutation({ id: 'bad', code: 'MAIN', name: '本社仓', kind: 'normal', active: true }),
    () => buildWarehouseSiteMutation({ id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'other', active: true }),
    () => buildWarehouseItemMutation({ id: IDS.item, name: ' ', category: '', brand: '', description: '', active: true }),
    () => buildWarehouseVariantMutation({ ...baseVariant, minimumStock: 1.0001 }),
    () => buildWarehouseVariantMutation({ ...baseVariant, defaultPurchasePrice: 1.00001 }),
    () => buildWarehouseVariantMutation({ ...baseVariant, defaultPurchasePrice: Number.NaN }),
    () => buildWarehouseVariantMutation({ ...baseVariant, minimumStock: -1 }),
    () => buildWarehouseVariantMutation({ ...baseVariant, manufacturerQr: `SWERP:VARIANT:${IDS.variant}` }),
    () => buildWarehouseVariantMutation({ ...baseVariant, sku: 'S'.repeat(101) }),
  ]) assert.throws(operation, TypeError)
})

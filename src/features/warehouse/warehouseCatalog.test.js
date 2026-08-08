import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildVariantSystemQr,
  buildWarehouseSku,
  validateVariant,
} from './warehouseCatalog.js'

test('warehouse SKU and system QR builders use canonical formats', () => {
  assert.equal(buildWarehouseSku(7), 'SW-000007')
  assert.equal(buildVariantSystemQr('V-007'), 'SWERP:VARIANT:V-007')
})

test('variant validation normalizes manufacturer QR uniqueness and protects system QR space', () => {
  const variants = [{
    variantId: 'V-001',
    sku: 'SW-000001',
    manufacturerQr: ' Maker-ABC ',
    systemQr: 'SWERP:VARIANT:V-001',
  }]

  assert.deepEqual(validateVariant({
    variantId: 'V-002',
    sku: 'SW-000002',
    manufacturerQr: ' maker-abc ',
    systemQr: 'SWERP:VARIANT:V-002',
  }, variants), { error: '厂家二维码已存在' })

  assert.deepEqual(validateVariant({
    variantId: 'V-003',
    sku: 'SW-000003',
    manufacturerQr: '  swerp:variant:external ',
    systemQr: 'SWERP:VARIANT:V-003',
  }, variants), { error: '厂家二维码不能使用系统保留前缀' })
})

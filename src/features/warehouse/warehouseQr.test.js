import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isVariantSystemQrValue,
  normalizeVariantQrValue,
  VARIANT_QR_PREFIX,
} from './warehouseQr.js'

test('warehouse QR values normalize whitespace and case deterministically', () => {
  assert.equal(normalizeVariantQrValue('  SwErP:VaRiAnT:V-001  '), 'swerp:variant:v-001')
  assert.equal(normalizeVariantQrValue(null), '')
  assert.equal(VARIANT_QR_PREFIX, 'SWERP:VARIANT:')
})

test('system QR detection uses the normalized reserved prefix', () => {
  assert.equal(isVariantSystemQrValue('  swerp:variant:V-001'), true)
  assert.equal(isVariantSystemQrValue('manufacturer:V-001'), false)
})

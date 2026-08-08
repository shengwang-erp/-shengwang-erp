import assert from 'node:assert/strict'
import test from 'node:test'

import * as qrModule from './warehouseQr.js'

const {
  normalizeWarehouseQrInput,
  isVariantSystemQrValue,
  normalizeVariantQrValue,
  VARIANT_QR_PREFIX,
} = qrModule

test('warehouse QR values normalize whitespace and case deterministically', () => {
  assert.equal(normalizeVariantQrValue('  SwErP:VaRiAnT:V-001  '), 'swerp:variant:v-001')
  assert.equal(normalizeVariantQrValue(null), '')
  assert.equal(VARIANT_QR_PREFIX, 'SWERP:VARIANT:')
})

test('system QR detection uses the normalized reserved prefix', () => {
  assert.equal(isVariantSystemQrValue('  swerp:variant:V-001'), true)
  assert.equal(isVariantSystemQrValue('manufacturer:V-001'), false)
})

test('manual warehouse QR input preserves payload case while trimming Unicode edge whitespace', () => {
  assert.equal(typeof normalizeWarehouseQrInput, 'function')
  assert.equal(normalizeWarehouseQrInput('\ufeff  Maker-QR-AbC　'), 'Maker-QR-AbC')
  assert.throws(() => normalizeWarehouseQrInput('  \t\n  '), /二维码/u)
  assert.throws(() => normalizeWarehouseQrInput(`M${'X'.repeat(500)}`), /二维码/u)
})

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
  assert.equal(normalizeWarehouseQrInput('\u0085\u200bMaker-QR-0085\u2060\u0085'), 'Maker-QR-0085')
  assert.equal(normalizeWarehouseQrInput('😀'.repeat(500)), '😀'.repeat(500))
  assert.throws(() => normalizeWarehouseQrInput('  \t\n  '), /二维码/u)
  assert.throws(() => normalizeWarehouseQrInput('😀'.repeat(501)), /二维码/u)
  for (const invisible of ['\ufeff', '\u200b', '\u200c', '\u200d', '\u2060']) {
    assert.throws(() => normalizeWarehouseQrInput(`Maker${invisible}QR`), /二维码/u)
  }
})

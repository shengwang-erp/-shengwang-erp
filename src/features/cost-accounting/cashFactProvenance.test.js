import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PURCHASE_PAYMENT_CASH_SCHEMA,
  VEHICLE_FUEL_CASH_SCHEMA,
  isLegacyInferredCashFact,
  isRecordedCashFact,
  markCashFactAsRecorded,
  normalizeCashFactProvenance,
} from './cashFactProvenance.js'

test('compatibility defaults never become recorded after repeated normalization', () => {
  const first = normalizeCashFactProvenance({}, VEHICLE_FUEL_CASH_SCHEMA, {
    defaultDate: '2026-07-16', defaultPaymentMethod: '现金',
  })
  const second = normalizeCashFactProvenance(first, VEHICLE_FUEL_CASH_SCHEMA, {
    defaultDate: '2026-07-16', defaultPaymentMethod: '现金',
  })

  assert.equal(first.fuelDateSource, 'defaulted')
  assert.equal(first.paymentMethodSource, 'defaulted')
  assert.equal(second.fuelDateSource, 'defaulted')
  assert.equal(isRecordedCashFact(second, VEHICLE_FUEL_CASH_SCHEMA), false)
})

test('a submitted payment is explicitly recorded', () => {
  const saved = markCashFactAsRecorded(
    { paymentDate: '2026-07-10' },
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )

  assert.equal(saved.paymentDateSource, 'recorded')
  assert.equal(isRecordedCashFact(saved, PURCHASE_PAYMENT_CASH_SCHEMA), true)
})

test('empty or invalid submitted values cannot be upgraded by UI defaults', () => {
  const empty = normalizeCashFactProvenance(
    markCashFactAsRecorded({}, VEHICLE_FUEL_CASH_SCHEMA),
    VEHICLE_FUEL_CASH_SCHEMA,
    { defaultDate: '2026-07-16', defaultPaymentMethod: '现金' },
  )
  const invalid = markCashFactAsRecorded(
    { paymentDate: '2026-02-31' },
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )

  assert.equal(empty.fuelDateSource, 'defaulted')
  assert.equal(empty.paymentMethodSource, 'defaulted')
  assert.equal(isRecordedCashFact(empty, VEHICLE_FUEL_CASH_SCHEMA), false)
  assert.equal(invalid.paymentDateSource, 'defaulted')
  assert.equal(isRecordedCashFact(invalid, PURCHASE_PAYMENT_CASH_SCHEMA), false)
})

test('legacy persisted dates remain usable with a permanent audit disclosure marker', () => {
  const legacy = normalizeCashFactProvenance(
    { paymentDate: '2026-07-01' },
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )
  const normalizedAgain = normalizeCashFactProvenance(
    legacy,
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )
  const markedAgain = markCashFactAsRecorded(
    normalizedAgain,
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )

  assert.equal(legacy.paymentDateSource, 'recorded')
  assert.equal(legacy.paymentDateLegacyInferred, true)
  assert.equal(isLegacyInferredCashFact(legacy, PURCHASE_PAYMENT_CASH_SCHEMA), true)
  assert.equal(normalizedAgain.paymentDateLegacyInferred, true)
  assert.equal(markedAgain.paymentDateLegacyInferred, true)
})

test('recorded metadata cannot make compatibility defaults cash eligible', () => {
  const normalized = normalizeCashFactProvenance({
    fuelDate: '',
    fuelDateSource: 'recorded',
    paymentMethod: '',
    paymentMethodSource: 'recorded',
  }, VEHICLE_FUEL_CASH_SCHEMA, {
    defaultDate: '2026-07-16',
    defaultPaymentMethod: '现金',
  })

  assert.equal(normalized.fuelDate, '2026-07-16')
  assert.equal(normalized.fuelDateSource, 'defaulted')
  assert.equal(normalized.paymentMethod, '现金')
  assert.equal(normalized.paymentMethodSource, 'defaulted')
  assert.equal(isRecordedCashFact(normalized, VEHICLE_FUEL_CASH_SCHEMA), false)
})

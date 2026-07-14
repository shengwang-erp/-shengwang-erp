import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ContractRevenueValidationError,
  parseRequiredRate,
  parseRequiredYen,
  validateTaxBreakdown,
} from './contractRevenueValidation.js'

function assertValidationError(field) {
  return (error) => {
    assert.ok(error instanceof ContractRevenueValidationError)
    assert.equal(error.field, field)
    return true
  }
}

test('parseRequiredYen accepts positive integer yen values', () => {
  assert.equal(parseRequiredYen(120000, '合同金额'), 120000)
  assert.equal(parseRequiredYen('120000', '合同金额'), 120000)
})

test('parseRequiredYen rejects blank values instead of converting them to zero', () => {
  for (const value of ['', '   ', null, undefined]) {
    assert.throws(() => parseRequiredYen(value, '合同金额'), assertValidationError('合同金额'))
  }
})

test('parseRequiredYen rejects negative, non-finite, non-numeric and fractional values', () => {
  for (const value of [-1, Number.NaN, Number.POSITIVE_INFINITY, 'invalid', '10.5', false]) {
    assert.throws(() => parseRequiredYen(value, '合同金额'), assertValidationError('合同金额'))
  }
})

test('parseRequiredYen rejects zero by default and permits explicit zero when requested', () => {
  assert.throws(() => parseRequiredYen(0, '合同金额'), assertValidationError('合同金额'))
  assert.equal(parseRequiredYen(0, '税额', { allowZero: true }), 0)
  assert.equal(parseRequiredYen('0', '税额', { allowZero: true }), 0)
})

test('parseRequiredRate accepts valid tax rates including zero and decimals', () => {
  assert.equal(parseRequiredRate(0, '税率'), 0)
  assert.equal(parseRequiredRate('8', '税率'), 8)
  assert.equal(parseRequiredRate(10.5, '税率'), 10.5)
})

test('parseRequiredRate rejects blank, invalid, negative and above-100 rates', () => {
  for (const value of ['', '   ', null, undefined, Number.NaN, 'invalid', -0.1, 100.1, false]) {
    assert.throws(() => parseRequiredRate(value, '税率'), assertValidationError('税率'))
  }
})

test('validateTaxBreakdown normalizes and returns a valid tax breakdown', () => {
  assert.deepEqual(
    validateTaxBreakdown({
      taxExclusiveAmount: '1000000',
      taxRate: '10',
      taxAmount: '100000',
      taxInclusiveAmount: '1100000',
    }),
    {
      taxExclusiveAmount: 1000000,
      taxRate: 10,
      taxAmount: 100000,
      taxInclusiveAmount: 1100000,
    },
  )
})

test('validateTaxBreakdown allows an explicitly confirmed zero tax amount', () => {
  assert.deepEqual(
    validateTaxBreakdown({
      taxExclusiveAmount: 500000,
      taxRate: 0,
      taxAmount: 0,
      taxInclusiveAmount: 500000,
    }),
    {
      taxExclusiveAmount: 500000,
      taxRate: 0,
      taxAmount: 0,
      taxInclusiveAmount: 500000,
    },
  )
})

test('validateTaxBreakdown rejects empty component amounts', () => {
  assert.throws(
    () =>
      validateTaxBreakdown({
        taxExclusiveAmount: 1000000,
        taxRate: 10,
        taxAmount: '',
        taxInclusiveAmount: 1100000,
      }),
    assertValidationError('taxAmount'),
  )
})

test('validateTaxBreakdown rejects a tax-inclusive amount that does not equal tax-exclusive plus tax', () => {
  assert.throws(
    () =>
      validateTaxBreakdown({
        taxExclusiveAmount: 1000000,
        taxRate: 10,
        taxAmount: 100000,
        taxInclusiveAmount: 1099999,
      }),
    assertValidationError('taxInclusiveAmount'),
  )
})

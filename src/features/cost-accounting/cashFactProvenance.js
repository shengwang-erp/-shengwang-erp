import { monthOfDate } from '../executive-dashboard/dashboardTime.js'

const RECORDED = 'recorded'
const DEFAULTED = 'defaulted'

export const PURCHASE_PAYMENT_CASH_SCHEMA = Object.freeze({
  dateField: 'paymentDate',
  dateSourceField: 'paymentDateSource',
  dateLegacyField: 'paymentDateLegacyInferred',
})

export const VEHICLE_FUEL_CASH_SCHEMA = Object.freeze({
  dateField: 'fuelDate',
  dateSourceField: 'fuelDateSource',
  dateLegacyField: 'fuelDateLegacyInferred',
  methodField: 'paymentMethod',
  methodSourceField: 'paymentMethodSource',
  methodLegacyField: 'paymentMethodLegacyInferred',
})

export const VEHICLE_EXPENSE_CASH_SCHEMA = Object.freeze({
  dateField: 'expenseDate',
  dateSourceField: 'expenseDateSource',
  dateLegacyField: 'expenseDateLegacyInferred',
  methodField: 'paymentMethod',
  methodSourceField: 'paymentMethodSource',
  methodLegacyField: 'paymentMethodLegacyInferred',
})

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validDate(value) {
  return monthOfDate(value) !== ''
}

function resolveSource(record, valueField, sourceField, legacyField, validator) {
  if (record?.[sourceField] === RECORDED || record?.[sourceField] === DEFAULTED) {
    return {
      source: record[sourceField] === RECORDED && !validator(record?.[valueField])
        ? DEFAULTED
        : record[sourceField],
      legacyInferred: record?.[legacyField] === true,
    }
  }

  return validator(record?.[valueField])
    ? { source: RECORDED, legacyInferred: true }
    : { source: DEFAULTED, legacyInferred: false }
}

export function normalizeCashFactProvenance(record = {}, schema, {
  defaultDate = '',
  defaultPaymentMethod = '',
} = {}) {
  const date = resolveSource(
    record,
    schema.dateField,
    schema.dateSourceField,
    schema.dateLegacyField,
    validDate,
  )
  const next = {
    ...record,
    [schema.dateField]: hasText(record[schema.dateField])
      ? record[schema.dateField]
      : defaultDate,
    [schema.dateSourceField]: date.source,
    [schema.dateLegacyField]: date.legacyInferred,
  }

  if (schema.methodField) {
    const method = resolveSource(
      record,
      schema.methodField,
      schema.methodSourceField,
      schema.methodLegacyField,
      hasText,
    )
    next[schema.methodSourceField] = method.source
    next[schema.methodLegacyField] = method.legacyInferred
    next[schema.methodField] = hasText(record[schema.methodField])
      ? record[schema.methodField]
      : defaultPaymentMethod
  }

  return next
}

export function markCashFactAsRecorded(record = {}, schema) {
  const next = {
    ...record,
    [schema.dateSourceField]: validDate(record[schema.dateField]) ? RECORDED : DEFAULTED,
    [schema.dateLegacyField]: record[schema.dateLegacyField] === true,
  }

  if (schema.methodField) {
    next[schema.methodSourceField] = hasText(record[schema.methodField])
      ? RECORDED
      : DEFAULTED
    next[schema.methodLegacyField] = record[schema.methodLegacyField] === true
  }

  return next
}

export function isRecordedCashFact(record = {}, schema) {
  if (record[schema.dateSourceField] !== RECORDED || !validDate(record[schema.dateField])) {
    return false
  }

  return !schema.methodField || (
    record[schema.methodSourceField] === RECORDED && hasText(record[schema.methodField])
  )
}

export function isLegacyInferredCashFact(record = {}, schema) {
  return record[schema.dateLegacyField] === true ||
    Boolean(schema.methodLegacyField && record[schema.methodLegacyField] === true)
}

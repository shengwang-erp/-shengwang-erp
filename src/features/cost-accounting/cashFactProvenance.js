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

function asPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null ? value : {}
}

function validDate(value) {
  return monthOfDate(value) !== ''
}

function canonicalDate(value) {
  return validDate(value) ? value.trim() : value
}

function resolveSource(record, valueField, sourceField, legacyField, validator) {
  if (Object.hasOwn(record, sourceField)) {
    const source = record[sourceField]
    if (source !== RECORDED && source !== DEFAULTED) {
      return {
        source: DEFAULTED,
        legacyInferred: record?.[legacyField] === true,
      }
    }

    return {
      source: source === RECORDED && !validator(record?.[valueField])
        ? DEFAULTED
        : source,
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
  const safeRecord = asPlainRecord(record)
  const date = resolveSource(
    safeRecord,
    schema.dateField,
    schema.dateSourceField,
    schema.dateLegacyField,
    validDate,
  )
  const dateValue = hasText(safeRecord[schema.dateField])
    ? safeRecord[schema.dateField]
    : defaultDate
  const next = {
    ...safeRecord,
    [schema.dateField]: canonicalDate(dateValue),
    [schema.dateSourceField]: date.source,
    [schema.dateLegacyField]: date.legacyInferred,
  }

  if (schema.methodField) {
    const method = resolveSource(
      safeRecord,
      schema.methodField,
      schema.methodSourceField,
      schema.methodLegacyField,
      hasText,
    )
    next[schema.methodSourceField] = method.source
    next[schema.methodLegacyField] = method.legacyInferred
    next[schema.methodField] = hasText(safeRecord[schema.methodField])
      ? safeRecord[schema.methodField]
      : defaultPaymentMethod
  }

  return next
}

export function markCashFactAsRecorded(record = {}, schema) {
  const safeRecord = asPlainRecord(record)
  const next = {
    ...safeRecord,
    [schema.dateField]: canonicalDate(safeRecord[schema.dateField]),
    [schema.dateSourceField]: validDate(safeRecord[schema.dateField]) ? RECORDED : DEFAULTED,
    [schema.dateLegacyField]: safeRecord[schema.dateLegacyField] === true,
  }

  if (schema.methodField) {
    next[schema.methodSourceField] = hasText(safeRecord[schema.methodField])
      ? RECORDED
      : DEFAULTED
    next[schema.methodLegacyField] = safeRecord[schema.methodLegacyField] === true
  }

  return next
}

export function isRecordedCashFact(record = {}, schema) {
  const safeRecord = asPlainRecord(record)
  if (safeRecord[schema.dateSourceField] !== RECORDED ||
      !validDate(safeRecord[schema.dateField])) {
    return false
  }

  return !schema.methodField || (
    safeRecord[schema.methodSourceField] === RECORDED && hasText(safeRecord[schema.methodField])
  )
}

export function isLegacyInferredCashFact(record = {}, schema) {
  const safeRecord = asPlainRecord(record)
  return safeRecord[schema.dateLegacyField] === true ||
    Boolean(schema.methodLegacyField && safeRecord[schema.methodLegacyField] === true)
}

export class ContractRevenueValidationError extends Error {
  constructor(field, message) {
    super(message)
    this.name = 'ContractRevenueValidationError'
    this.field = field
  }
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim())
}

function parseRequiredNumber(value, fieldName) {
  if (isBlank(value)) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}不能为空`)
  }

  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}必须是有效数字`)
  }

  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}必须是有效数字`)
  }

  const numberValue = typeof value === 'string' ? Number(value.trim()) : value
  if (!Number.isFinite(numberValue)) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}必须是有效数字`)
  }

  return numberValue
}

export function parseRequiredYen(value, fieldName, { allowZero = false } = {}) {
  const amount = parseRequiredNumber(value, fieldName)

  if (!Number.isInteger(amount)) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}必须是整数日元`)
  }

  if (amount < 0) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}不能为负数`)
  }

  if (!allowZero && amount === 0) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}必须大于0`)
  }

  return amount
}

export function parseRequiredRate(value, fieldName) {
  const rate = parseRequiredNumber(value, fieldName)

  if (rate < 0 || rate > 100) {
    throw new ContractRevenueValidationError(fieldName, `${fieldName}必须在0到100之间`)
  }

  return rate
}

export function validateTaxBreakdown({
  taxExclusiveAmount,
  taxRate,
  taxAmount,
  taxInclusiveAmount,
}) {
  const normalized = {
    taxExclusiveAmount: parseRequiredYen(taxExclusiveAmount, 'taxExclusiveAmount'),
    taxRate: parseRequiredRate(taxRate, 'taxRate'),
    taxAmount: parseRequiredYen(taxAmount, 'taxAmount', { allowZero: true }),
    taxInclusiveAmount: parseRequiredYen(taxInclusiveAmount, 'taxInclusiveAmount'),
  }

  if (normalized.taxInclusiveAmount !== normalized.taxExclusiveAmount + normalized.taxAmount) {
    throw new ContractRevenueValidationError(
      'taxInclusiveAmount',
      'taxInclusiveAmount必须等于taxExclusiveAmount与taxAmount之和',
    )
  }

  return normalized
}

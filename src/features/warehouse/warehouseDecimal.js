const MAX_SAFE_UNITS = BigInt(Number.MAX_SAFE_INTEGER)
const NUMBER_TO_STRING = Number.prototype.toString
const DECIMAL_NUMBER = /^(?<integer>[0-9]+)(?:\.(?<fraction>[0-9]+))?(?:e(?<exponent>[+-]?[0-9]+))?$/iu

function invalid() {
  return new TypeError('仓库十进制数据无效')
}

function assertUnits(value) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_SAFE_UNITS) throw invalid()
  return value
}

function parseScaledUnits(value, scale) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw invalid()
  const source = NUMBER_TO_STRING.call(value)
  const match = DECIMAL_NUMBER.exec(source)
  if (!match?.groups) throw invalid()

  const integer = match.groups.integer
  const fraction = match.groups.fraction ?? ''
  const exponent = match.groups.exponent === undefined
    ? 0
    : Number(match.groups.exponent)
  if (!Number.isSafeInteger(exponent)) throw invalid()

  const digits = `${integer}${fraction}`.replace(/^0+(?=[0-9])/u, '')
  const shift = exponent - fraction.length + scale
  let units

  if (shift >= 0) {
    if (digits === '0') return 0n
    if (digits.length + shift > 16) throw invalid()
    units = BigInt(digits) * (10n ** BigInt(shift))
  } else {
    const retainedLength = digits.length + shift
    if (retainedLength <= 0) {
      if (/[1-9]/u.test(digits)) throw invalid()
      units = 0n
    } else {
      const discarded = digits.slice(retainedLength)
      if (/[1-9]/u.test(discarded)) throw invalid()
      units = BigInt(digits.slice(0, retainedLength))
    }
  }

  return assertUnits(units)
}

function unitsToNumber(value, factor) {
  return Number(assertUnits(value)) / factor
}

function divideHalfAway(numerator, denominator) {
  if (typeof numerator !== 'bigint' || numerator < 0n) throw invalid()
  if (typeof denominator !== 'bigint' || denominator <= 0n) throw invalid()
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  return quotient + (remainder * 2n >= denominator ? 1n : 0n)
}

export function parseQuantityUnits(value) {
  return parseScaledUnits(value, 3)
}

export function parseCostUnits(value) {
  return parseScaledUnits(value, 4)
}

export function quantityUnitsToNumber(value) {
  return unitsToNumber(value, 1_000)
}

export function costUnitsToNumber(value) {
  return unitsToNumber(value, 10_000)
}

export function addScaledUnits(total, value) {
  const result = assertUnits(total) + assertUnits(value)
  return assertUnits(result)
}

export function deriveStockValueUnits(quantityUnits, unitCostUnits) {
  const quantity = assertUnits(quantityUnits)
  const unitCost = assertUnits(unitCostUnits)
  if (quantity === 0n) {
    if (unitCost !== 0n) throw invalid()
    return 0n
  }
  return assertUnits(divideHalfAway(quantity * unitCost, 1_000n))
}

export function deriveWeightedUnitCostUnits(stockValueUnits, quantityUnits) {
  const stockValue = assertUnits(stockValueUnits)
  const quantity = assertUnits(quantityUnits)
  if (quantity === 0n) {
    if (stockValue !== 0n) throw invalid()
    return 0n
  }
  return assertUnits(divideHalfAway(stockValue * 1_000n, quantity))
}

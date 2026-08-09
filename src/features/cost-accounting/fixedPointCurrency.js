const FOUR_DECIMAL_SCALE_BIGINT = 10000n
const MAX_SAFE_UNITS_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

export const FOUR_DECIMAL_SCALE = 10000

export function toSignedFourDecimalUnits(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    return null
  }
  const absolute = Math.abs(value)
  const fixed = absolute.toFixed(4)
  if (Number(fixed) !== absolute) return null
  const [whole, fraction] = fixed.split('.')
  const units = BigInt(whole) * FOUR_DECIMAL_SCALE_BIGINT + BigInt(fraction)
  if (units > MAX_SAFE_UNITS_BIGINT) return null
  const signedUnits = value < 0 ? -units : units
  return Number(signedUnits)
}

export function fromFourDecimalUnits(units) {
  return Number.isSafeInteger(units) ? units / FOUR_DECIMAL_SCALE : null
}

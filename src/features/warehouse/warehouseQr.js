export const VARIANT_QR_PREFIX = 'SWERP:VARIANT:'

const QR_EDGE_TRIM = /^[\s\ufeff\u200b\u200c\u200d\u2060]+|[\s\ufeff\u200b\u200c\u200d\u2060]+$/gu
const QR_INTERNAL_INVISIBLE = /[\ufeff\u200b\u200c\u200d\u2060]/u

export function normalizeWarehouseQrInput(value) {
  if (typeof value !== 'string') throw new TypeError('二维码内容无效')
  const normalized = value.replace(QR_EDGE_TRIM, '').normalize('NFC')
  if (
    normalized.length === 0
    || normalized.length > 500
    || QR_INTERNAL_INVISIBLE.test(normalized)
  ) throw new TypeError('二维码内容无效')
  return normalized
}

export const normalizeVariantQrValue = (value) => (
  String(value ?? '').trim().toLocaleLowerCase('en-US')
)

export const isVariantSystemQrValue = (value) => (
  normalizeVariantQrValue(value).startsWith(normalizeVariantQrValue(VARIANT_QR_PREFIX))
)

export const VARIANT_QR_PREFIX = 'SWERP:VARIANT:'

export const normalizeVariantQrValue = (value) => (
  String(value ?? '').trim().toLocaleLowerCase('en-US')
)

export const isVariantSystemQrValue = (value) => (
  normalizeVariantQrValue(value).startsWith(normalizeVariantQrValue(VARIANT_QR_PREFIX))
)

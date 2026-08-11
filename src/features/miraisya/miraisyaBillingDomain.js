const ITEM_FIELDS = Object.freeze([
  'itemName', 'description', 'quantity', 'unit', 'unitPrice', 'taxRate',
])

function invalid() {
  return new TypeError('收费明细无效')
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function text(value, { empty = false, maximum = 500 } = {}) {
  if (typeof value !== 'string') throw invalid()
  const normalized = value.trim()
  if ((!empty && !normalized) || normalized.length > maximum) throw invalid()
  return normalized
}

function exactArray(value, maximum = 500) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw invalid()
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const length = descriptors.length?.value
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum ||
      Object.keys(descriptors).length !== length + 1) throw invalid()
  const result = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)]
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      throw invalid()
    }
    result.push(descriptor.value)
  }
  return result
}

export function createEmptyBillingItem() {
  return {
    itemName: '',
    description: '',
    quantity: 1,
    unit: '式',
    unitPrice: 0,
    taxRate: 10,
  }
}

export function calculateBillingAmounts(quantity, unitPrice, taxRate) {
  const scaledQuantity = Math.round(quantity * 10_000)
  if (!Number.isFinite(quantity) || quantity <= 0 ||
      !Number.isSafeInteger(scaledQuantity) || scaledQuantity <= 0 ||
      Math.abs(quantity * 10_000 - scaledQuantity) > 1e-7 ||
      !Number.isSafeInteger(unitPrice) || unitPrice < 0 ||
      ![0, 10].includes(taxRate)) throw invalid()
  const taxExclusiveAmount = Math.round((scaledQuantity * unitPrice) / 10_000)
  if (!Number.isSafeInteger(taxExclusiveAmount) || taxExclusiveAmount < 0) throw invalid()
  const taxAmount = taxRate === 0 ? 0 : Math.round(taxExclusiveAmount * 0.1)
  const taxInclusiveAmount = taxExclusiveAmount + taxAmount
  if (!Number.isSafeInteger(taxInclusiveAmount)) throw invalid()
  return { taxExclusiveAmount, taxAmount, taxInclusiveAmount }
}

export function normalizeBillingItem(value) {
  if (!plainObject(value)) throw invalid()
  const item = {
    itemName: text(value.itemName, { maximum: 200 }),
    description: text(value.description, { empty: true, maximum: 1000 }),
    quantity: value.quantity,
    unit: text(value.unit, { maximum: 50 }),
    unitPrice: value.unitPrice,
    taxRate: value.taxRate,
  }
  calculateBillingAmounts(item.quantity, item.unitPrice, item.taxRate)
  return Object.fromEntries(ITEM_FIELDS.map((field) => [field, item[field]]))
}

export function normalizeBillingItems(value, { allowEmpty = true } = {}) {
  const items = exactArray(value).map(normalizeBillingItem)
  if (!allowEmpty && items.length === 0) throw invalid()
  return items
}

export function summarizeBillingItems(value) {
  const totals = {
    taxExclusiveAmount: 0,
    taxAmount: 0,
    taxInclusiveAmount: 0,
  }
  for (const item of normalizeBillingItems(value)) {
    const amounts = calculateBillingAmounts(item.quantity, item.unitPrice, item.taxRate)
    for (const key of Object.keys(totals)) {
      totals[key] += amounts[key]
      if (!Number.isSafeInteger(totals[key])) throw invalid()
    }
  }
  return totals
}

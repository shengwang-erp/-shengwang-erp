import { WAREHOUSE_STATUS } from './warehouseConstants.js'

function toWarehouseCostUnits(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0)) {
    return null
  }
  const fixed = Math.abs(value).toFixed(4)
  if (Number(fixed) !== Math.abs(value)) return null
  const [whole, fraction] = fixed.split('.')
  const units = BigInt(whole) * 10000n + BigInt(fraction)
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(value < 0 ? -units : units)
}

export function toSignedFiniteAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

export function projectCostAmount(record = {}) {
  return toSignedFiniteAmount(record.amount)
}

export function sumProjectCostRecords(records = []) {
  return records.reduce((total, record) => total + projectCostAmount(record), 0)
}

export function assertManualProjectCostAmount(value) {
  if (typeof value === 'string' && !value.trim()) {
    throw new Error('项目成本金额必须大于 0')
  }
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('项目成本金额必须大于 0')
  }
  return amount
}

export function isWarehouseManagedProjectCost(record = {}) {
  return ['warehouse', 'warehouseReversal'].includes(record.sourceType)
}

export function assertManualProjectCostMutable(record = {}) {
  if (isWarehouseManagedProjectCost(record)) {
    throw new Error('仓库自动生成的项目成本只能通过仓库冲销更正')
  }
  return record
}

export function getMinorWorkOrderMaterialCost(minorWorkOrderId, stockOutRequests = []) {
  const maxUnits = Number.MAX_SAFE_INTEGER
  const totalUnits = stockOutRequests.reduce((total, request) => {
    if (request?.destinationType !== 'minor_work_order' ||
        request?.minorWorkOrderId !== minorWorkOrderId ||
        request?.status !== WAREHOUSE_STATUS.confirmed || !Array.isArray(request.lines)) {
      return total
    }
    return request.lines.reduce((lineTotal, line) => {
      const amount = line?.frozenTotalCost
      const amountUnits = toWarehouseCostUnits(amount)
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
          Object.is(amount, -0) || amount > 900719925474.0991 ||
          amountUnits === null || amountUnits > maxUnits - lineTotal) {
        throw new Error('小工事出库成本数据无效')
      }
      return lineTotal + amountUnits
    }, total)
  }, 0)
  return totalUnits / 10000
}

export function getWarehouseTrackedPurchaseIds(stockInRecords = []) {
  return new Set(
    stockInRecords
      .filter((record) => (
        record.status === WAREHOUSE_STATUS.confirmed
        && String(record.sourcePurchaseId || '').trim()
      ))
      .map((record) => record.sourcePurchaseId),
  )
}

export function getDirectProfitabilityPurchases(purchases = [], stockInRecords = []) {
  const trackedPurchaseIds = getWarehouseTrackedPurchaseIds(stockInRecords)
  return purchases.filter((purchase) => (
    purchase.purchaseStatus !== '作废'
    && !trackedPurchaseIds.has(purchase.purchaseId)
  ))
}

const purchaseCostAmount = (record = {}) => {
  const amount = Number(record.totalCost)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

export function calculateProjectMaterialProfitabilityCost({
  projectId,
  purchases = [],
  stockInRecords = [],
  projectCostRecords = [],
}) {
  const projectCostTotal = sumProjectCostRecords(
    projectCostRecords.filter((record) => record.projectId === projectId),
  )
  const directPurchaseTotal = getDirectProfitabilityPurchases(purchases, stockInRecords)
    .filter((purchase) => purchase.projectId === projectId)
    .reduce((total, purchase) => total + purchaseCostAmount(purchase), 0)

  return projectCostTotal + directPurchaseTotal
}

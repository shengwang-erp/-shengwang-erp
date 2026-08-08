import { WAREHOUSE_STATUS } from './warehouseConstants.js'

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

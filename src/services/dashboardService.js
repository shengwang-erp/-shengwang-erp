import { getList } from './baseRecordService.js'

export async function getDashboardSourceData(inputs = {}) {
  const load = inputs.load || getList
  const projectLoader = inputs.projectLoader || (() => load('erp.projects'))
  const [
    employees,
    projects,
    laborRecords,
    purchaseRecords,
    purchasePaymentRecords,
    inventoryItems,
    vehicleUsageRecords,
    lifelongToolAssignments,
    toolResponsibilityRecords,
  ] = await Promise.all([
    inputs.employees || load('erp.employees'),
    inputs.projects || projectLoader(),
    inputs.laborRecords || load('erp.laborRecords'),
    inputs.purchaseRecords || load('erp.purchaseRecords'),
    inputs.purchasePaymentRecords || load('erp.purchasePaymentRecords'),
    inputs.inventoryItems || load('erp.inventoryItems'),
    inputs.vehicleUsageRecords || load('erp.vehicleUsageRecords'),
    inputs.lifelongToolAssignments || load('erp.lifelongToolAssignments'),
    inputs.toolResponsibilityRecords || load('erp.toolResponsibilityRecords'),
  ])

  return {
    employees: employees || [],
    projects: projects || [],
    laborRecords: laborRecords || [],
    purchaseRecords: purchaseRecords || [],
    purchasePaymentRecords: purchasePaymentRecords || [],
    inventoryItems: inventoryItems || [],
    vehicleUsageRecords: vehicleUsageRecords || [],
    lifelongToolAssignments: lifelongToolAssignments || [],
    toolResponsibilityRecords: toolResponsibilityRecords || [],
  }
}

import { getList } from './baseRecordService'

export async function getDashboardSourceData() {
  const [
    employees,
    projects,
    laborRecords,
    purchaseRecords,
    inventoryItems,
    vehicleUsageRecords,
    lifelongToolAssignments,
    toolResponsibilityRecords,
  ] = await Promise.all([
    getList('erp.employees'),
    getList('erp.projects'),
    getList('erp.laborRecords'),
    getList('erp.purchaseRecords'),
    getList('erp.inventoryItems'),
    getList('erp.vehicleUsageRecords'),
    getList('erp.lifelongToolAssignments'),
    getList('erp.toolResponsibilityRecords'),
  ])

  return {
    employees: employees || [],
    projects: projects || [],
    laborRecords: laborRecords || [],
    purchaseRecords: purchaseRecords || [],
    inventoryItems: inventoryItems || [],
    vehicleUsageRecords: vehicleUsageRecords || [],
    lifelongToolAssignments: lifelongToolAssignments || [],
    toolResponsibilityRecords: toolResponsibilityRecords || [],
  }
}

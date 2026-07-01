export const recordTableConfigs = {
  'erp.employees': { tableName: 'employees', recordKeyField: 'employeeId' },
  'erp.projects': { tableName: 'projects', recordKeyField: 'projectId' },
  'erp.laborRecords': { tableName: 'labor_records', recordKeyField: 'laborRecordId' },
  'erp.purchaseRecords': { tableName: 'purchase_records', recordKeyField: 'purchaseId' },
  'erp.purchasePaymentRecords': {
    tableName: 'purchase_payment_records',
    recordKeyField: 'paymentId',
  },
  'erp.inventoryItems': { tableName: 'inventory_items', recordKeyField: 'inventoryId' },
  'erp.stockInRecords': { tableName: 'stock_in_records', recordKeyField: 'stockInId' },
  'erp.stockOutRecords': { tableName: 'stock_out_records', recordKeyField: 'id' },
  'erp.stockReturnRecords': { tableName: 'stock_return_records', recordKeyField: 'id' },
  'erp.toolRecords': { tableName: 'tool_records', recordKeyField: 'toolId' },
  'erp.toolBorrowRecords': { tableName: 'tool_borrow_records', recordKeyField: 'id' },
  'erp.toolReturnRecords': { tableName: 'tool_return_records', recordKeyField: 'id' },
  'erp.lifelongToolAssignments': {
    tableName: 'lifelong_tool_assignments',
    recordKeyField: 'assignmentId',
  },
  'erp.toolResponsibilityRecords': {
    tableName: 'tool_responsibility_records',
    recordKeyField: 'responsibilityRecordId',
  },
  'erp.vehicleRecords': { tableName: 'vehicle_records', recordKeyField: 'vehicleId' },
  'erp.vehicleUsageRecords': {
    tableName: 'vehicle_usage_records',
    recordKeyField: 'usageRecordId',
  },
  'erp.fuelRecords': { tableName: 'fuel_records', recordKeyField: 'fuelRecordId' },
  'erp.vehicleExpenseRecords': {
    tableName: 'vehicle_expense_records',
    recordKeyField: 'vehicleExpenseId',
  },
  'erp.vehicleIssueRecords': {
    tableName: 'vehicle_issue_records',
    recordKeyField: 'vehicleIssueId',
  },
  'erp.salaryRecords': { tableName: 'salary_records', recordKeyField: 'salaryRecordId' },
  'erp.projectCostRecords': {
    tableName: 'project_cost_records',
    recordKeyField: 'costRecordId',
  },
  'erp.operatingExpenseRecords': {
    tableName: 'operating_expense_records',
    recordKeyField: 'expenseRecordId',
  },
}

export function getRecordTableConfig(storageKey) {
  return recordTableConfigs[storageKey] || null
}

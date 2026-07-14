import { create, getById, getList, softDelete, update } from './baseRecordService'

const salaryKey = 'erp.salaryRecords'
const projectCostKey = 'erp.projectCostRecords'
const operatingExpenseKey = 'erp.operatingExpenseRecords'

export const accountingService = {
  getSalaryList: () => getList(salaryKey),
  createSalary: (record) => create(salaryKey, record),
  updateSalary: (id, patch) => update(salaryKey, id, patch),
  deleteSalary: (id) => softDelete(salaryKey, id),
  getProjectCostList: () => getList(projectCostKey),
  getProjectCostById: (id) => getById(projectCostKey, id),
  getOperatingExpenseList: () => getList(operatingExpenseKey),
}

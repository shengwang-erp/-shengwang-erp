import { canAccessModule, canEdit } from '../../utils/permissions.js'

export function isProjectFinancialWhitelistEmployee(employee = {}) {
  return (
    employee.department === '设计部' ||
    employee.department === '财务部' ||
    employee.position === '社长' ||
    employee.employeeNumber === 'SW-000'
  )
}

function isActiveProjectEmployee(employee = {}) {
  return (
    employee.employmentStatus === '在职' &&
    employee.accountStatus === 'active' &&
    employee.mustChangePassword === false
  )
}

export function canViewProjectFinancials(employee) {
  return isActiveProjectEmployee(employee) &&
    isProjectFinancialWhitelistEmployee(employee) &&
    canAccessModule(employee, '工程项目')
}

export function canUpdateProjectFinancials(employee) {
  return isActiveProjectEmployee(employee) &&
    isProjectFinancialWhitelistEmployee(employee) &&
    canEdit(employee, '工程项目')
}

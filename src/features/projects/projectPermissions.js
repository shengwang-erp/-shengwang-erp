import {
  canAccessModule,
  canCreate,
  canDelete,
  canEdit,
} from '../../utils/permissions.js'

const PROJECT_EDITOR_DEPARTMENTS = new Set([
  '后勤部',
  '财务部',
  '设计部',
  '总务部',
])

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

function isTypedProjectEditor(employee = {}) {
  return employee.employeeNumber === 'SW-000' ||
    employee.position === '社长' ||
    PROJECT_EDITOR_DEPARTMENTS.has(employee.department)
}

function isTypedProjectSettlementManager(employee = {}) {
  return employee.employeeNumber === 'SW-000' ||
    employee.position === '社长' ||
    employee.department === '财务部'
}

export function canCreateTypedProject(employee) {
  return isActiveProjectEmployee(employee) &&
    isTypedProjectEditor(employee) &&
    canCreate(employee, '工程项目')
}

export function canEditTypedProject(employee) {
  return isActiveProjectEmployee(employee) &&
    isTypedProjectEditor(employee) &&
    canEdit(employee, '工程项目')
}

export function canDeleteTypedProject(employee) {
  return isActiveProjectEmployee(employee) &&
    isTypedProjectSettlementManager(employee) &&
    canDelete(employee, '工程项目')
}

export function canManageMiraisyaSettlement(employee) {
  return isActiveProjectEmployee(employee) &&
    isTypedProjectSettlementManager(employee) &&
    canEdit(employee, '工程项目')
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

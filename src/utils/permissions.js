import { normalizeEmployeeNumber } from '../auth/employeeAuthDomain.js'

export const roleOptions = [
  { value: 'super_admin', label: '最高权限' },
  { value: 'custom', label: '自定义权限' },
  { value: 'employee', label: '普通员工' },
]

export const permissionModuleOptions = [
  '老板驾驶舱',
  '工程项目',
  '人员管理',
  '人工记录',
  '采购管理',
  '仓库库存',
  '工具管理',
  '车辆管理',
  '会计成本',
  '工资记录',
  '项目成本',
  '经营费用',
  '系统设置',
]

export const sensitivePermissionOptions = [
  '查看工资',
  '修改工资',
  '查看合同金额',
  '修改合同金额',
  '查看利润',
  '查看采购付款',
  '修改采购付款',
  '查看人员身份资料',
  '修改人员身份资料',
  '查看老板驾驶舱全部数据',
]

const allPermission = ['all']
const modulePermissionCodes = {
  老板驾驶舱: 'owner_dashboard',
  工程项目: 'projects',
  人员管理: 'employees',
  人工记录: 'labor',
  采购管理: 'purchases',
  仓库库存: 'inventory',
  工具管理: 'tools',
  车辆管理: 'vehicles',
  会计成本: 'accounting',
  工资记录: 'salaries',
  项目成本: 'project_costs',
  经营费用: 'operating_expenses',
  系统设置: 'settings',
}
const sensitivePermissionCodes = {
  查看工资: 'salary_view',
  修改工资: 'salary_update',
  查看合同金额: 'contract_amount_view',
  修改合同金额: 'contract_amount_update',
  查看利润: 'profit_view',
  查看采购付款: 'purchase_payments_view',
  修改采购付款: 'purchase_payments_update',
  查看人员身份资料: 'employee_identity_view',
  修改人员身份资料: 'employee_identity_update',
  查看老板驾驶舱全部数据: 'owner_dashboard_full_view',
}
const employeeDefaults = {
  role: 'employee',
  accessibleModules: [],
  canCreateModules: [],
  canEditModules: [],
  canDeleteModules: [],
  sensitivePermissions: [],
  effectivePermissionKeys: [],
}

export function isSuperAdmin(employee = {}) {
  const employeeNumber = employee.employeeNumber ?? employee.employee_number
  return normalizeEmployeeNumber(employeeNumber) === 'SW-000'
}

export function isHiddenSystemEmployee(employee = {}) {
  return (
    employee.employeeId === 'SUPER_ADMIN' ||
    employee.isHiddenSystemAccount === true ||
    employee.name === '超级管理员'
  )
}

export function getRoleLabel(role) {
  return roleOptions.find((item) => item.value === role)?.label || '普通员工'
}

export function getPermissionCount(values = []) {
  return values.includes('all') ? '全部' : values.length
}

export function getPermissionDefaults(position) {
  void position
  return employeeDefaults
}

export function normalizePermissionFields(employee = {}) {
  const role = employee.role || employeeDefaults.role
  const normalized = {
    role,
    accessibleModules: Array.isArray(employee.accessibleModules)
      ? employee.accessibleModules
      : employeeDefaults.accessibleModules,
    canCreateModules: Array.isArray(employee.canCreateModules)
      ? employee.canCreateModules
      : employeeDefaults.canCreateModules,
    canEditModules: Array.isArray(employee.canEditModules)
      ? employee.canEditModules
      : employeeDefaults.canEditModules,
    canDeleteModules: Array.isArray(employee.canDeleteModules)
      ? employee.canDeleteModules
      : employeeDefaults.canDeleteModules,
    sensitivePermissions: Array.isArray(employee.sensitivePermissions)
      ? employee.sensitivePermissions
      : employeeDefaults.sensitivePermissions,
    effectivePermissionKeys: Array.isArray(employee.effectivePermissionKeys)
      ? employee.effectivePermissionKeys
      : employeeDefaults.effectivePermissionKeys,
  }

  if (normalized.role === 'super_admin') {
    return {
      role: 'super_admin',
      accessibleModules: allPermission,
      canCreateModules: allPermission,
      canEditModules: allPermission,
      canDeleteModules: allPermission,
      sensitivePermissions: allPermission,
      effectivePermissionKeys: normalized.effectivePermissionKeys,
    }
  }

  return normalized
}

function hasEffectivePermission(employee, permissionKey) {
  if (isSuperAdmin(employee)) return true
  const permissions = Array.isArray(employee.effectivePermissionKeys)
    ? employee.effectivePermissionKeys
    : []
  return permissions.includes('all') || Boolean(permissionKey && permissions.includes(permissionKey))
}

function getModulePermissionKey(moduleName, action) {
  const moduleCode = modulePermissionCodes[moduleName]
  return moduleCode ? `module.${moduleCode}.${action}` : ''
}

function getSensitivePermissionKey(permissionName) {
  const permissionCode = sensitivePermissionCodes[permissionName]
  return permissionCode ? `sensitive.${permissionCode}` : ''
}

export function canAccessModule(employee, moduleName) {
  return hasEffectivePermission(employee, getModulePermissionKey(moduleName, 'view'))
}

export function canCreate(employee, moduleName) {
  return hasEffectivePermission(employee, getModulePermissionKey(moduleName, 'create'))
}

export function canEdit(employee, moduleName) {
  return hasEffectivePermission(employee, getModulePermissionKey(moduleName, 'update'))
}

export function canDelete(employee, moduleName) {
  return hasEffectivePermission(employee, getModulePermissionKey(moduleName, 'delete'))
}

export function canViewSensitive(employee, permissionName) {
  return hasEffectivePermission(employee, getSensitivePermissionKey(permissionName))
}

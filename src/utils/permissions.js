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
const employeeDefaults = {
  role: 'employee',
  accessibleModules: [],
  canCreateModules: [],
  canEditModules: [],
  canDeleteModules: [],
  sensitivePermissions: [],
}

export function isSuperAdmin(employee = {}) {
  return employee.role === 'super_admin'
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
  }

  if (normalized.role === 'super_admin') {
    return {
      role: 'super_admin',
      accessibleModules: allPermission,
      canCreateModules: allPermission,
      canEditModules: allPermission,
      canDeleteModules: allPermission,
      sensitivePermissions: allPermission,
    }
  }

  return normalized
}

function hasPermission(employee, field, value) {
  if (isSuperAdmin(employee)) return true
  const permissions = Array.isArray(employee[field]) ? employee[field] : []
  return permissions.includes('all') || permissions.includes(value)
}

export function canAccessModule(employee, moduleName) {
  return hasPermission(employee, 'accessibleModules', moduleName)
}

export function canCreate(employee, moduleName) {
  return hasPermission(employee, 'canCreateModules', moduleName)
}

export function canEdit(employee, moduleName) {
  return hasPermission(employee, 'canEditModules', moduleName)
}

export function canDelete(employee, moduleName) {
  return hasPermission(employee, 'canDeleteModules', moduleName)
}

export function canViewSensitive(employee, permissionName) {
  return hasPermission(employee, 'sensitivePermissions', permissionName)
}

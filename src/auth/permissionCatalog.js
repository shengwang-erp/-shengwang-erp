import { WAREHOUSE_PERMISSION_KEYS } from '../features/warehouse/warehouseConstants.js'

export const PERMISSION_MODULES = Object.freeze([
  Object.freeze({ code: 'owner_dashboard', label: '老板驾驶舱' }),
  Object.freeze({ code: 'projects', label: '工程项目' }),
  Object.freeze({ code: 'employees', label: '人员管理' }),
  Object.freeze({ code: 'labor', label: '人工记录' }),
  Object.freeze({ code: 'purchases', label: '采购管理' }),
  Object.freeze({ code: 'inventory', label: '仓库库存' }),
  Object.freeze({ code: 'tools', label: '工具管理' }),
  Object.freeze({ code: 'vehicles', label: '车辆管理' }),
  Object.freeze({ code: 'accounting', label: '会计成本' }),
  Object.freeze({ code: 'salaries', label: '工资记录' }),
  Object.freeze({ code: 'project_costs', label: '项目成本' }),
  Object.freeze({ code: 'operating_expenses', label: '经营费用' }),
  Object.freeze({ code: 'settings', label: '系统设置' }),
])

export const PERMISSION_ACTIONS = Object.freeze([
  Object.freeze({ code: 'view', label: '查看' }),
  Object.freeze({ code: 'create', label: '新增' }),
  Object.freeze({ code: 'update', label: '编辑' }),
  Object.freeze({ code: 'delete', label: '删除' }),
])

export const SENSITIVE_PERMISSION_CATALOG = Object.freeze([
  Object.freeze({ key: 'sensitive.salary_view', label: '查看工资' }),
  Object.freeze({ key: 'sensitive.salary_update', label: '修改工资' }),
  Object.freeze({
    key: 'sensitive.contract_amount_view',
    label: '查看合同金额',
  }),
  Object.freeze({
    key: 'sensitive.contract_amount_update',
    label: '修改合同金额',
  }),
  Object.freeze({ key: 'sensitive.profit_view', label: '查看利润' }),
  Object.freeze({
    key: 'sensitive.purchase_payments_view',
    label: '查看采购付款',
  }),
  Object.freeze({
    key: 'sensitive.purchase_payments_update',
    label: '修改采购付款',
  }),
  Object.freeze({
    key: 'sensitive.employee_identity_view',
    label: '查看人员身份资料',
  }),
  Object.freeze({
    key: 'sensitive.employee_identity_update',
    label: '修改人员身份资料',
  }),
  Object.freeze({
    key: 'sensitive.owner_dashboard_full_view',
    label: '查看老板驾驶舱全部数据',
  }),
])

export const WAREHOUSE_PERMISSION_CATALOG = Object.freeze([
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.catalogManage,
    label: '管理仓库物品与仓位',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.receiptSubmit,
    label: '提交采购到货',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.receiptConfirm,
    label: '确认采购入库',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.stockFlowRequest,
    label: '发起出库与退回申请',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.stockFlowConfirm,
    label: '确认出库与退回',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.transferManage,
    label: '管理仓间调拨',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.stocktakeConfirm,
    label: '确认库存盘点',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.costView,
    label: '查看仓库成本',
  }),
  Object.freeze({
    key: WAREHOUSE_PERMISSION_KEYS.reportExport,
    label: '导出仓库报表',
  }),
])

export const PERMISSION_CATALOG = Object.freeze([
  ...PERMISSION_MODULES.flatMap(({ code }) =>
    PERMISSION_ACTIONS.map(({ code: action }) => `module.${code}.${action}`)
  ),
  ...SENSITIVE_PERMISSION_CATALOG.map(({ key }) => key),
  ...WAREHOUSE_PERMISSION_CATALOG.map(({ key }) => key),
])

const PERMISSION_CATALOG_SET = new Set(PERMISSION_CATALOG)
const PROJECT_FINANCIAL_KEYS = new Set([
  'sensitive.contract_amount_view',
  'sensitive.contract_amount_update',
])

export function isTemplatePermissionKey(value) {
  return typeof value === 'string' && PERMISSION_CATALOG_SET.has(value)
}

export function canTemplateSubjectReceiveProjectFinancials(
  subjectType,
  subjectCode,
) {
  return (
    (subjectType === 'department' &&
      ['设计部', '财务部'].includes(subjectCode)) ||
    (subjectType === 'position' && subjectCode === '社长')
  )
}

export function templateContainsForbiddenProjectFinancialGrant(
  subjectType,
  subjectCode,
  permissionKeys,
) {
  return permissionKeys.some((key) => PROJECT_FINANCIAL_KEYS.has(key)) &&
    !canTemplateSubjectReceiveProjectFinancials(subjectType, subjectCode)
}

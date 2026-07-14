import { useEffect, useMemo, useState } from 'react'
import { isCloudDatabaseReady, getList, migrateLocalStorageToSupabase, saveList, upsertRecord } from './services/baseRecordService'
import {
  buildProjectRevenueReadModel,
  buildProjectRevenueSnapshotCollection,
  getProfitAnchorTaxExclusiveAmount,
} from './features/contract-revenue/contractRevenueCalculations'
import ContractRevenuePage from './features/contract-revenue/ContractRevenuePage'
import ContractRevenueMigrationPanel from './features/contract-revenue/ContractRevenueMigrationPanel'
import DesktopAdminShell from './DesktopAdminShell'
import { initializeOriginalContractProject } from './features/contract-revenue/originalContract'
import { createLocalStorageUpsertRecord } from './services/contractRevenueLocalMigration'
import {
  CONTRACT_REVENUE_STORAGE_KEYS,
  createContractChange as persistContractChange,
  createPaymentPlan as persistCreatePaymentPlan,
  createProjectReceipt as persistCreateCustomerReceipt,
  sanitizeProjectForPersistence,
  updatePaymentPlan as persistUpdatePaymentPlan,
  voidContractChange as persistVoidContractChange,
  voidProjectReceipt as persistVoidCustomerReceipt,
} from './services/contractRevenueService'
import {
  canAccessModule,
  canEdit,
  getPermissionCount,
  getPermissionDefaults,
  getRoleLabel,
  isHiddenSystemEmployee,
  isSuperAdmin,
  normalizePermissionFields,
  permissionModuleOptions,
  roleOptions,
  sensitivePermissionOptions,
} from './utils/permissions'

const STORAGE_KEYS = {
  projects: 'erp.projects',
  projectContractChanges: CONTRACT_REVENUE_STORAGE_KEYS.contractChanges,
  projectPaymentPlans: CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans,
  projectReceipts: CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
  employees: 'erp.employees',
  stockOutRecords: 'erp.stockOutRecords',
  stockReturnRecords: 'erp.stockReturnRecords',
  laborRecords: 'erp.laborRecords',
  vehicleRecords: 'erp.vehicleRecords',
  vehicleUsageRecords: 'erp.vehicleUsageRecords',
  fuelRecords: 'erp.fuelRecords',
  vehicleExpenseRecords: 'erp.vehicleExpenseRecords',
  vehicleIssueRecords: 'erp.vehicleIssueRecords',
  toolBorrowRecords: 'erp.toolBorrowRecords',
  toolReturnRecords: 'erp.toolReturnRecords',
  toolRecords: 'erp.toolRecords',
  lifelongToolAssignments: 'erp.lifelongToolAssignments',
  toolResponsibilityRecords: 'erp.toolResponsibilityRecords',
  salaryRecords: 'erp.salaryRecords',
  projectCostRecords: 'erp.projectCostRecords',
  operatingExpenseRecords: 'erp.operatingExpenseRecords',
  purchaseRecords: 'erp.purchaseRecords',
  purchasePaymentRecords: 'erp.purchasePaymentRecords',
  stockInRecords: 'erp.stockInRecords',
  inventoryItems: 'erp.inventoryItems',
  currentUser: 'currentUser',
}

const BUSINESS_STORAGE_KEYS = Object.values(STORAGE_KEYS).filter(
  (key) => key !== STORAGE_KEYS.currentUser,
)

const statusOptions = ['进行中', '已完工', '暂停']
const paymentStatusOptions = ['未付款', '部分付款', '已付清', '超额收款']
const genderOptions = ['男', '女', '其他']
const employmentStatusOptions = ['在职', '离职', '休假', '停工']
const departmentOptions = ['现场', '仓库', '设计', '事务', '会计', '管理', '其他']
const positionOptions = ['老板', '小工', '操作员', '中工', '职长', '主任', '部长', '总务部长', '设计部部长', '设计', '事务', '会计', '管理', '其他']
const levelOptions = ['1星', '2星', '3星', '4星', '5星']
const salaryTypeOptions = ['月薪', '日薪', '时薪', '未设置']
const workTypeOptions = ['正常出勤', '加班', '半天', '休息', '请假', '调休', '其他']
const workLocationTypeOptions = ['工程项目', '仓库', '采购运输', '公司内部', '休息请假', '其他']
const costTypeOptions = ['人工费', '材料费', '车辆费', '工具费', '外包费', '运输费', '其他费用']
const vehicleStatusOptions = ['使用中', '维修中', '停用', '已报废']
const vehicleUsagePurposeOptions = ['工程项目', '材料运输', '采购', '仓库搬运', '公司事务', '其他']
const fuelTypeOptions = ['汽油', '柴油', '其他']
const vehicleExpenseTypeOptions = ['停车费', '高速费', 'ETC', '洗车费', '维修费', '保养费', '车检费', '保险费', '罚款', '其他']
const vehicleIssueLocationOptions = ['发动机', '轮胎', '刹车', '车灯', '车身划伤', '后视镜', '车内', '行车记录仪', '其他']
const vehicleSeverityOptions = ['轻微', '一般', '严重']
const vehicleIssueStatusOptions = ['未处理', '处理中', '已处理', '暂不处理']
const toolStatusOptions = ['在库', '临时借出', '已归还', '已终身领用', '已丢失', '已损坏', '维修中', '已报废']
const toolHolderTypeOptions = ['无', '临时借用', '终身领用']
const toolBorrowTypeOptions = ['临时借用', '终身领用']
const toolResponsibilityStatusOptions = ['正常使用中', '已丢失', '已损坏', '已赔偿', '已修复', '已退回公司', '作废']
const toolIssueTypeOptions = ['丢失', '损坏', '修复', '赔偿', '退回公司', '其他']
const compensationStatusOptions = ['不需要赔偿', '未赔偿', '部分赔偿', '已赔偿']
const purchaseSourceOptions = ['中国采购', 'Amazon', 'Yahoo拍卖', '东鹏株式会社', '其他日本供应商', '其他']
const purchasePlatformOptions = ['淘宝', '1688', '拼多多', 'Amazon', 'Yahoo拍卖', '东鹏株式会社', '线下店铺', '其他']
const purchaseTypeOptions = ['材料', '工具', '设备', '消耗品', '定制品', '其他']
const purchasePurposeOptions = ['项目使用', '仓库备货', '工具入库', '公司自用', '其他']
const currencyOptions = ['JPY', 'CNY']
const purchasePaymentStatusOptions = ['未付款', '部分付款', '已付款']
const invoiceStatusOptions = ['未取得', '已取得', '不需要']
const arrivalStatusOptions = ['未到货', '部分到货', '已到货']
const stockInStatusOptions = ['未入库', '部分入库', '已入库']
const purchaseStatusOptions = ['正常', '作废']
const paymentMethodOptions = ['银行转账', '信用卡', '现金', 'PayPay', '微信', '支付宝', '公司账户', '个人垫付', '其他']
const expenseTypeOptions = [
  '房租',
  '水电',
  '车辆保险',
  '车检',
  '税理士费用',
  '办公用品',
  '通信费',
  '招待费',
  '其他',
]

const businessConfigs = {
  stockOut: {
    title: '我要出库',
    storageKey: STORAGE_KEYS.stockOutRecords,
    idPrefix: 'SO',
    emptyText: '暂无出库记录',
    submitText: '保存出库记录',
    personLabel: '经手人',
    personField: 'operator',
    fields: [
      { name: 'materialName', label: '材料名称', placeholder: '例如 空调铜管', required: true },
      { name: 'quantity', label: '数量', type: 'number', placeholder: '例如 2', required: true },
      { name: 'unit', label: '单位', placeholder: '例如 卷 / 个 / 米', required: true },
      { name: 'date', label: '日期', type: 'date', required: true },
      { name: 'remark', label: '备注', type: 'textarea', placeholder: '可填写用途、位置等' },
    ],
    summaryFields: ['materialName', 'quantity', 'unit', 'employeeName', 'date'],
  },
  stockReturn: {
    title: '我要退回',
    storageKey: STORAGE_KEYS.stockReturnRecords,
    idPrefix: 'SR',
    emptyText: '暂无退回记录',
    submitText: '保存退回记录',
    personLabel: '经手人',
    personField: 'operator',
    fields: [
      { name: 'materialName', label: '材料名称', placeholder: '例如 电线', required: true },
      { name: 'quantity', label: '数量', type: 'number', placeholder: '例如 5', required: true },
      { name: 'unit', label: '单位', placeholder: '例如 米 / 个 / 卷', required: true },
      { name: 'date', label: '日期', type: 'date', required: true },
      { name: 'remark', label: '备注', type: 'textarea', placeholder: '可填写退回原因' },
    ],
    summaryFields: ['materialName', 'quantity', 'unit', 'employeeName', 'date'],
  },
  vehicle: {
    title: '车辆管理',
    storageKey: STORAGE_KEYS.vehicleRecords,
    idPrefix: 'VR',
    emptyText: '暂无车辆使用记录',
    submitText: '保存车辆记录',
    personLabel: '使用人/司机',
    personField: 'driver',
    fields: [
      { name: 'vehicleNo', label: '车辆号', placeholder: '例如 品川 500', required: true },
      { name: 'purpose', label: '用途', placeholder: '例如 送材料到现场', required: true },
      { name: 'date', label: '日期', type: 'date', required: true },
      { name: 'remark', label: '备注', type: 'textarea', placeholder: '可填写油费、停车费等' },
    ],
    summaryFields: ['vehicleNo', 'employeeName', 'purpose', 'date'],
  },
  toolBorrow: {
    title: '借工具',
    storageKey: STORAGE_KEYS.toolBorrowRecords,
    idPrefix: 'TB',
    emptyText: '暂无借工具记录',
    submitText: '保存借工具记录',
    personLabel: '借用人',
    personField: 'borrower',
    fields: [
      { name: 'toolName', label: '工具名称', placeholder: '例如 电锤', required: true },
      { name: 'quantity', label: '数量', type: 'number', placeholder: '例如 1', required: true },
      { name: 'date', label: '日期', type: 'date', required: true },
      { name: 'remark', label: '备注', type: 'textarea', placeholder: '可填写预计归还时间' },
    ],
    summaryFields: ['toolName', 'quantity', 'employeeName', 'date'],
  },
  toolReturn: {
    title: '还工具',
    storageKey: STORAGE_KEYS.toolReturnRecords,
    idPrefix: 'TR',
    emptyText: '暂无还工具记录',
    submitText: '保存还工具记录',
    personLabel: '归还人',
    personField: 'returner',
    fields: [
      { name: 'toolName', label: '工具名称', placeholder: '例如 切割机', required: true },
      { name: 'quantity', label: '数量', type: 'number', placeholder: '例如 1', required: true },
      { name: 'date', label: '日期', type: 'date', required: true },
      { name: 'remark', label: '备注', type: 'textarea', placeholder: '可填写工具状态' },
    ],
    summaryFields: ['toolName', 'quantity', 'employeeName', 'date'],
  },
}

function todayValue() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function currentMonthValue() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}`
}

function monthFromDate(value) {
  return value ? value.slice(0, 7) : ''
}

function dateTimeValue() {
  const date = new Date()
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${todayValue()} ${hours}:${minutes}`
}

function timeToMinutes(value) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function calculateHours(startTime, endTime) {
  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)
  if (start === null || end === null || end <= start) return ''
  return Number(((end - start) / 60).toFixed(2))
}

function daysUntil(dateValue) {
  if (!dateValue) return null
  const today = new Date(todayValue())
  const target = new Date(dateValue)
  if (Number.isNaN(target.getTime())) return null
  return Math.ceil((target.getTime() - today.getTime()) / 86400000)
}

function readStorage(key, fallback) {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) : fallback
  } catch {
    return fallback
  }
}

function toAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function getPaymentInfo(contractAmount, paidAmount) {
  const contract = toAmount(contractAmount)
  const paid = toAmount(paidAmount)
  const progress = contract > 0 ? Math.round((paid / contract) * 100) : 0

  if (progress >= 100) {
    return { paymentProgress: progress, paymentStatus: '已付清' }
  }

  if (progress > 0) {
    return { paymentProgress: progress, paymentStatus: '部分付款' }
  }

  return { paymentProgress: 0, paymentStatus: '未付款' }
}

function normalizeProject(project) {
  const contractAmount = toAmount(project.contractAmount)
  const paidAmount = toAmount(project.paidAmount)
  const paymentInfo = getPaymentInfo(contractAmount, paidAmount)

  return {
    ...project,
    projectId: project.projectId,
    projectName: project.projectName || '',
    customerName: project.customerName || '',
    address: project.address || '',
    status: project.status || '进行中',
    manager: project.manager || '',
    startDate: project.startDate || '',
    endDate: project.endDate || '',
    contractAmount,
    paidAmount,
    paymentProgress: paymentInfo.paymentProgress,
    paymentStatus: paymentInfo.paymentStatus,
    remark: project.remark || '',
  }
}

function prepareProjectForPersistence(project) {
  const normalizedProject = normalizeProject(project)
  const revenueSchemaVersion = Number(normalizedProject.contractRevenueSchemaVersion)
  const isOriginalContractPending =
    normalizedProject.contractRevenueSetupStatus === 'not_started'

  return (Number.isInteger(revenueSchemaVersion) && revenueSchemaVersion >= 1) ||
    isOriginalContractPending
    ? sanitizeProjectForPersistence(normalizedProject)
    : normalizedProject
}

function normalizeEmployee(employee) {
  const now = todayValue()
  const permissionInfo = normalizePermissionFields(employee)
  const salaryStandard = getSalaryStandard(employee)

  return {
    employeeId: employee.employeeId,
    name: employee.name || '',
    gender: employee.gender || '男',
    birthDate: employee.birthDate || '',
    nationality: employee.nationality || '',
    employmentStatus: employee.employmentStatus || '在职',
    hireDate: employee.hireDate || todayValue(),
    resignDate: employee.resignDate || '',
    department: employee.department || '现场',
    position: employee.position || '操作员',
    level: employee.level || '1星',
    phone: employee.phone || '',
    emergencyContactName: employee.emergencyContactName || '',
    emergencyContactPhone: employee.emergencyContactPhone || '',
    currentAddress: employee.currentAddress || '',
    visaAgency: employee.visaAgency || '',
    visaType: employee.visaType || '',
    visaExpireDate: employee.visaExpireDate || '',
    passportNumber: employee.passportNumber || '',
    residenceCardNumber: employee.residenceCardNumber || '',
    salaryType: salaryStandard.salaryType,
    baseSalary: salaryStandard.baseSalary,
    dailySalary: salaryStandard.dailySalary,
    hourlyWage: salaryStandard.hourlyWage,
    salaryRemark: employee.salaryRemark || '',
    username: employee.username || employee.name || '',
    passwordHash: employee.passwordHash || '',
    loginEnabled:
      employee.loginEnabled === undefined ? false : Boolean(employee.loginEnabled),
    mustChangePassword: Boolean(employee.mustChangePassword),
    role: permissionInfo.role,
    accessibleModules: permissionInfo.accessibleModules,
    canCreateModules: permissionInfo.canCreateModules,
    canEditModules: permissionInfo.canEditModules,
    canDeleteModules: permissionInfo.canDeleteModules,
    sensitivePermissions: permissionInfo.sensitivePermissions,
    source: employee.source || '',
    lastLoginAt: employee.lastLoginAt || '',
    wecomUserId: employee.wecomUserId || '',
    wecomDepartmentId: employee.wecomDepartmentId || '',
    wecomDepartmentName: employee.wecomDepartmentName || '',
    authProvider: employee.authProvider || 'password',
    isHiddenSystemAccount: Boolean(employee.isHiddenSystemAccount),
    remark: employee.remark || '',
    createdAt: employee.createdAt || now,
    updatedAt: employee.updatedAt || now,
  }
}

function buildProjectPayload(form) {
  return {
    projectId: form.projectId || '',
    projectName: form.projectName || '',
    customerName: form.customerName || '',
    address: form.address || '',
    status: form.status || '进行中',
    manager: form.manager || '',
    startDate: form.startDate || '',
    endDate: form.endDate || '',
    remark: form.remark || '',
  }
}

function formatYen(value) {
  const amount = Number(value)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return `¥${safeAmount.toLocaleString('ja-JP')}`
}

function formatPercent(value) {
  return `${Math.round(Number(value) || 0)}%`
}

function formatPermissionCount(values) {
  const count = getPermissionCount(values)
  return count === '全部' ? '全部模块' : `${count} 个模块`
}

function inferSalaryType(employee = {}) {
  if (employee.salaryType) return employee.salaryType
  if (toAmount(employee.baseSalary) > 0) return '月薪'
  if (toAmount(employee.dailySalary) > 0) return '日薪'
  if (toAmount(employee.hourlyWage) > 0) return '时薪'
  return '未设置'
}

function getSalaryStandard(employee = {}) {
  const salaryType = inferSalaryType(employee)
  const baseSalary = toAmount(employee.baseSalary)
  const rawDailySalary = toAmount(employee.dailySalary)
  const rawHourlyWage = toAmount(employee.hourlyWage)

  if (salaryType === '月薪') {
    const dailySalary = Math.round(baseSalary / 24)
    const hourlyWage = Math.round(dailySalary / 8)
    return { salaryType, baseSalary, dailySalary, hourlyWage }
  }

  if (salaryType === '日薪') {
    const dailySalary = rawDailySalary
    const hourlyWage = Math.round(dailySalary / 8)
    return { salaryType, baseSalary, dailySalary, hourlyWage }
  }

  if (salaryType === '时薪') {
    const hourlyWage = rawHourlyWage
    const dailySalary = rawDailySalary || Math.round(hourlyWage * 8)
    return { salaryType, baseSalary, dailySalary, hourlyWage }
  }

  return { salaryType, baseSalary, dailySalary: rawDailySalary, hourlyWage: rawHourlyWage }
}

function getSalaryTypeNote(employee = {}) {
  const standard = getSalaryStandard(employee)
  if (standard.salaryType === '月薪') {
    return `月薪：${formatYen(standard.baseSalary)}｜项目分摊日工费：${formatYen(standard.dailySalary)}｜按月薪/24天换算，仅用于项目成本分摊`
  }
  if (standard.salaryType === '日薪') {
    return `日工费：${formatYen(standard.dailySalary)}｜按日薪计入项目人工分摊`
  }
  if (standard.salaryType === '时薪') {
    return `时薪：${formatYen(standard.hourlyWage)}｜按实际工时计入项目人工分摊`
  }
  return '工资类型未设置，请在人员管理中维护工资标准'
}

function countBy(records, field) {
  return Object.entries(
    records.reduce((result, record) => {
      const key = record[field] || '未填写'
      return { ...result, [key]: (result[key] || 0) + 1 }
    }, {}),
  ).map(([label, value]) => ({ label, value }))
}

function calculateLaborCost(workType, dailySalary, hourlyWage, workHours, manualCost, salaryType = '') {
  if (['休息', '请假', '调休'].includes(workType)) return 0
  if (salaryType === '时薪') return Math.round(toAmount(hourlyWage) * (Number(workHours) || 0))
  if (workType === '正常出勤') return toAmount(dailySalary)
  if (workType === '半天') return Math.round(toAmount(dailySalary) / 2)
  if (workType === '加班') return Math.round(toAmount(hourlyWage) * (Number(workHours) || 0))
  if (workType === '其他' && manualCost !== '' && manualCost !== undefined) return toAmount(manualCost)
  return Math.round(toAmount(hourlyWage) * (Number(workHours) || 0))
}

function normalizeLaborRecord(record) {
  return {
    laborRecordId: record.laborRecordId || record.id || '',
    id: record.id || record.laborRecordId || '',
    batchId: record.batchId || '',
    workDate: record.workDate || record.date || todayValue(),
    workLocationType: record.workLocationType || (record.projectId ? '工程项目' : '公司内部'),
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || record.workerName || '',
    department: record.department || '',
    position: record.position || '',
    level: record.level || '',
    workType: record.workType || '正常出勤',
    startTime: record.startTime || '',
    endTime: record.endTime || '',
    workHours: Number(record.workHours ?? record.hours) || 0,
    salaryType: record.salaryType || '',
    dailySalary: toAmount(record.dailySalary),
    hourlyWage: toAmount(record.hourlyWage),
    laborCost: toAmount(record.laborCost),
    jobContent: record.jobContent || record.workContent || '',
    operatorId: record.operatorId || '',
    operatorName: record.operatorName || '',
    remark: record.remark || '',
    status: record.status || 'active',
    createdAt: record.createdAt || '',
    updatedAt: record.updatedAt || '',
  }
}

function generateLaborBatchId(workDate, records) {
  const datePart = (workDate || todayValue()).replaceAll('-', '')
  const prefix = `LB${datePart}`
  const maxNumber = records.reduce((max, record) => {
    const batchId = normalizeLaborRecord(record).batchId || ''
    if (!batchId.startsWith(prefix)) return max
    const number = Number(batchId.slice(prefix.length))
    return Number.isFinite(number) ? Math.max(max, number) : max
  }, 0)
  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

function groupLaborRecords(records) {
  const groups = records.reduce((result, rawRecord) => {
    const record = normalizeLaborRecord(rawRecord)
    const key =
      record.batchId ||
      `${record.laborRecordId}-${record.workDate}-${record.employeeId}-${record.projectId}`
    const current = result[key] || {
      key,
      batchId: record.batchId,
      workDate: record.workDate,
      projectName: record.projectName || record.workLocationType,
      startTime: record.startTime,
      endTime: record.endTime,
      records: [],
    }

    return {
      ...result,
      [key]: {
        ...current,
        records: [...current.records, record],
      },
    }
  }, {})

  return Object.values(groups).sort((a, b) =>
    `${b.workDate} ${b.startTime}`.localeCompare(`${a.workDate} ${a.startTime}`),
  )
}

function isBlockingLaborWorkType(workType) {
  return !['休息', '请假', '调休'].includes(workType)
}

function isActiveLaborAssignment(record) {
  const normalized = normalizeLaborRecord(record)
  return (
    normalized.status !== 'deleted' &&
    Boolean(normalized.employeeId) &&
    isBlockingLaborWorkType(normalized.workType)
  )
}

function getAssignedLaborRecordsForDate(records, workDate, excludeRecordId = '') {
  return records
    .map((record) => normalizeLaborRecord(record))
    .filter(
      (record) =>
        isActiveLaborAssignment(record) &&
        record.workDate === workDate &&
        record.laborRecordId !== excludeRecordId,
    )
}

function getTimeConflictRecords(record, allRecords) {
  const start = timeToMinutes(record.startTime)
  const end = timeToMinutes(record.endTime)
  if (start === null || end === null) return []

  return allRecords
    .map((item) => normalizeLaborRecord(item))
    .filter((current) => {
      if (
        !isActiveLaborAssignment(current) ||
        current.laborRecordId === record.laborRecordId ||
        current.employeeId !== record.employeeId ||
        current.workDate !== record.workDate
      ) {
        return false
      }
      const itemStart = timeToMinutes(current.startTime)
      const itemEnd = timeToMinutes(current.endTime)
      if (itemStart === null || itemEnd === null) return false
      return start < itemEnd && end > itemStart
    })
}

function hasTimeConflict(record, allRecords) {
  return getTimeConflictRecords(record, allRecords).length > 0
}

function getDuplicateLaborAssignmentGroups(records) {
  const grouped = records
    .map((record) => normalizeLaborRecord(record))
    .filter((record) => isActiveLaborAssignment(record))
    .reduce((result, record) => {
      const key = `${record.workDate}-${record.employeeId}`
      const current = result[key] || []
      return { ...result, [key]: [...current, record] }
    }, {})

  return Object.values(grouped).filter((items) => items.length > 1)
}

function getLaborTimeConflictPairs(records) {
  const normalizedRecords = records
    .map((record) => normalizeLaborRecord(record))
    .filter((record) => isActiveLaborAssignment(record))
  const pairs = []

  normalizedRecords.forEach((record, recordIndex) => {
    normalizedRecords.slice(recordIndex + 1).forEach((current) => {
      if (
        record.employeeId !== current.employeeId ||
        record.workDate !== current.workDate
      ) {
        return
      }
      const start = timeToMinutes(record.startTime)
      const end = timeToMinutes(record.endTime)
      const currentStart = timeToMinutes(current.startTime)
      const currentEnd = timeToMinutes(current.endTime)
      if (
        start !== null &&
        end !== null &&
        currentStart !== null &&
        currentEnd !== null &&
        start < currentEnd &&
        end > currentStart
      ) {
        pairs.push([record, current])
      }
    })
  })

  return pairs
}

function canForceLaborRepeat(currentUser) {
  return (
    isSuperAdmin(currentUser) ||
    ['老板', '操作员', '超级管理员'].includes(currentUser?.position) ||
    canEdit(currentUser, '人工记录')
  )
}

function getLaborPlaceLabel(record) {
  return record.projectName || record.workLocationType || '未填写'
}

function getLaborTimeLabel(record) {
  return `${record.startTime || '--'}-${record.endTime || '--'}`
}

function isLongWorkDay(record, allRecords) {
  const totalHours = allRecords
    .map((item) => normalizeLaborRecord(item))
    .filter(
      (item) =>
        isActiveLaborAssignment(item) &&
        item.employeeId === record.employeeId &&
        item.workDate === record.workDate &&
        item.laborRecordId !== record.laborRecordId,
    )
    .reduce((total, item) => total + (Number(item.workHours) || 0), Number(record.workHours) || 0)
  return totalHours > 12
}

function getLaborExceptions(records) {
  const normalizedRecords = records.map((record) => normalizeLaborRecord(record))
  const rowExceptions = normalizedRecords.flatMap((record) => {
    const issues = []

    if (isLongWorkDay(record, normalizedRecords)) {
      issues.push('当天累计工时超过12小时')
    }
    if (!record.employeeId) {
      issues.push('人工记录没有绑定员工ID')
    }
    if (record.workLocationType === '工程项目' && !record.projectId) {
      issues.push('工程项目出工但没有绑定项目ID')
    }
    if (
      (Number(record.workHours) || 0) === 0 &&
      !['休息', '请假', '调休'].includes(record.workType)
    ) {
      issues.push('工时为0但出工类型不是休息/请假/调休')
    }

    return issues.map((message) => ({
      id: `${record.laborRecordId}-${message}`,
      type: message,
      message,
      record,
    }))
  })

  const duplicateExceptions = getDuplicateLaborAssignmentGroups(normalizedRecords).map((items) => {
    const [firstRecord, secondRecord] = items
    return {
      id: `duplicate-${firstRecord.workDate}-${firstRecord.employeeId}`,
      type: '同一天重复安排',
      message: `员工${firstRecord.employeeName}在 ${firstRecord.workDate} 已有多条出工记录，请确认是否合理。`,
      record: secondRecord || firstRecord,
      relatedRecord: firstRecord,
      records: items,
    }
  })

  const timeConflictExceptions = getLaborTimeConflictPairs(normalizedRecords).map(
    ([firstRecord, secondRecord]) => ({
      id: `time-conflict-${firstRecord.laborRecordId}-${secondRecord.laborRecordId}`,
      type: '时间冲突',
      message: '同一员工同一天同一时间段存在多条出工记录。',
      record: secondRecord,
      relatedRecord: firstRecord,
    }),
  )

  return [...rowExceptions, ...duplicateExceptions, ...timeConflictExceptions]
}

function calculateNetSalary(record) {
  return (
    toAmount(record.baseSalary) +
    toAmount(record.overtimePay) +
    toAmount(record.bonus) -
    toAmount(record.deduction)
  )
}

function getMonthlySalaryPaidTotal(salaryRecords = [], employees = [], month = currentMonthValue()) {
  const monthlySalaryRecords = salaryRecords.filter((record) => record.salaryMonth === month)
  if (monthlySalaryRecords.length > 0) {
    return monthlySalaryRecords.reduce((total, record) => total + toAmount(record.netSalary), 0)
  }

  return employees
    .filter(
      (employee) =>
        !isHiddenSystemEmployee(employee) &&
        employee.employmentStatus === '在职' &&
        employee.salaryType === '月薪',
    )
    .reduce((total, employee) => total + toAmount(employee.baseSalary), 0)
}

function getMonthlyAllocatedLaborCost(laborRecords = [], month = currentMonthValue()) {
  return laborRecords
    .map((record) => normalizeLaborRecord(record))
    .filter((record) => monthFromDate(record.workDate) === month)
    .reduce((total, record) => total + toAmount(record.laborCost), 0)
}

function getLaborAllocationInfo(salaryRecords = [], employees = [], laborRecords = [], month = currentMonthValue()) {
  const salaryPaidTotal = getMonthlySalaryPaidTotal(salaryRecords, employees, month)
  const allocatedLaborCostTotal = getMonthlyAllocatedLaborCost(laborRecords, month)
  const unallocatedLaborCost = salaryPaidTotal - allocatedLaborCostTotal
  const laborAllocationRate =
    salaryPaidTotal > 0 ? Math.round((allocatedLaborCostTotal / salaryPaidTotal) * 100) : 0

  return {
    salaryPaidTotal,
    allocatedLaborCostTotal,
    unallocatedLaborCost,
    laborAllocationRate,
    isOverAllocated: allocatedLaborCostTotal > salaryPaidTotal && salaryPaidTotal > 0,
  }
}

function getProjectCostTotal(projectId, projectCostRecords, laborRecords = []) {
  const manualCostTotal = projectCostRecords
    .filter((record) => record.projectId === projectId)
    .reduce((total, record) => total + toAmount(record.amount), 0)
  const laborCostTotal = laborRecords
    .filter((record) => record.projectId === projectId)
    .reduce((total, record) => total + toAmount(record.laborCost), 0)

  return manualCostTotal + laborCostTotal
}

function getProjectPurchaseTotal(projectId, purchaseRecords) {
  return purchaseRecords
    .filter((record) => record.projectId === projectId && record.purchaseStatus !== '作废')
    .reduce((total, record) => total + toAmount(record.totalCost), 0)
}

function getProjectVehicleCostTotal(projectId, fuelRecords = [], vehicleExpenseRecords = [], vehicleIssueRecords = []) {
  const fuelTotal = fuelRecords
    .filter((record) => record.allocateToProject && record.projectId === projectId)
    .reduce((total, record) => total + toAmount(record.fuelAmount), 0)
  const expenseTotal = vehicleExpenseRecords
    .filter((record) => record.allocateToProject && record.projectId === projectId)
    .reduce((total, record) => total + toAmount(record.amount), 0)
  const issueTotal = vehicleIssueRecords
    .filter((record) => record.allocateToProject && record.projectId === projectId)
    .reduce((total, record) => total + toAmount(record.repairCost), 0)

  return fuelTotal + expenseTotal + issueTotal
}

function getVehicleCostTotal(fuelRecords = [], vehicleExpenseRecords = [], vehicleIssueRecords = []) {
  return (
    fuelRecords.reduce((total, record) => total + toAmount(record.fuelAmount), 0) +
    vehicleExpenseRecords.reduce((total, record) => total + toAmount(record.amount), 0) +
    vehicleIssueRecords.reduce((total, record) => total + toAmount(record.repairCost), 0)
  )
}

function getGrossProfitInfo(project, projectCostRecords, laborRecords = [], vehicleCostTotal = 0) {
  const profitAnchorTaxExclusiveAmount = getProfitAnchorTaxExclusiveAmount(project)
  const projectCostTotal =
    getProjectCostTotal(project.projectId, projectCostRecords, laborRecords) + vehicleCostTotal
  const estimatedGrossProfit = profitAnchorTaxExclusiveAmount - projectCostTotal
  const grossProfitRate =
    profitAnchorTaxExclusiveAmount > 0
      ? Math.round((estimatedGrossProfit / profitAnchorTaxExclusiveAmount) * 100)
      : 0

  return {
    profitAnchorTaxExclusiveAmount,
    projectCostTotal,
    estimatedGrossProfit,
    grossProfitRate,
  }
}

function normalizeVehicleRecord(record) {
  const now = todayValue()

  return {
    vehicleId: record.vehicleId || record.id || '',
    plateNumber: record.plateNumber || record.vehicleNo || '',
    vehicleName: record.vehicleName || record.vehicleNo || '',
    vehicleType: record.vehicleType || '面包车',
    brand: record.brand || '',
    model: record.model || '',
    status: record.status || '使用中',
    currentMileage: Number(record.currentMileage) || 0,
    inspectionExpireDate: record.inspectionExpireDate || '',
    insuranceExpireDate: record.insuranceExpireDate || '',
    responsibleEmployeeId: record.responsibleEmployeeId || record.employeeId || '',
    responsibleEmployeeName: record.responsibleEmployeeName || record.employeeName || '',
    remark: record.remark || '',
    createdAt: record.createdAt || now,
    updatedAt: record.updatedAt || now,
  }
}

function normalizeVehicleUsageRecord(record) {
  const startMileage = Number(record.startMileage) || 0
  const endMileage = Number(record.endMileage) || 0
  const dailyMileage =
    record.dailyMileage !== undefined && record.dailyMileage !== ''
      ? Number(record.dailyMileage) || 0
      : endMileage && startMileage
        ? endMileage - startMileage
        : 0

  return {
    usageRecordId: record.usageRecordId || record.id || '',
    id: record.id || record.usageRecordId || '',
    usageDate: record.usageDate || record.date || todayValue(),
    vehicleId: record.vehicleId || '',
    plateNumber: record.plateNumber || record.vehicleNo || '',
    vehicleName: record.vehicleName || record.vehicleNo || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || record.driver || '',
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    usagePurpose: record.usagePurpose || record.purpose || '工程项目',
    startLocation: record.startLocation || '',
    endLocation: record.endLocation || '',
    startTime: record.startTime || '',
    endTime: record.endTime || '',
    startMileage,
    endMileage,
    dailyMileage,
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
    updatedAt: record.updatedAt || todayValue(),
  }
}

function normalizeFuelRecord(record) {
  const allocateToProject = Boolean(record.allocateToProject)

  return {
    fuelRecordId: record.fuelRecordId || '',
    fuelDate: record.fuelDate || todayValue(),
    vehicleId: record.vehicleId || '',
    plateNumber: record.plateNumber || '',
    vehicleName: record.vehicleName || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    fuelStation: record.fuelStation || '',
    fuelType: record.fuelType || '汽油',
    fuelLiters: Number(record.fuelLiters) || 0,
    fuelAmount: toAmount(record.fuelAmount),
    mileageAtFuel: Number(record.mileageAtFuel) || 0,
    paymentMethod: record.paymentMethod || '现金',
    allocateToProject,
    projectId: allocateToProject ? record.projectId || '' : '',
    projectName: allocateToProject ? record.projectName || '' : '',
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
  }
}

function normalizeVehicleExpenseRecord(record) {
  const allocateToProject = Boolean(record.allocateToProject)

  return {
    vehicleExpenseId: record.vehicleExpenseId || '',
    expenseDate: record.expenseDate || todayValue(),
    vehicleId: record.vehicleId || '',
    plateNumber: record.plateNumber || '',
    vehicleName: record.vehicleName || '',
    expenseType: record.expenseType || '停车费',
    amount: toAmount(record.amount),
    paymentMethod: record.paymentMethod || '现金',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    allocateToProject,
    projectId: allocateToProject ? record.projectId || '' : '',
    projectName: allocateToProject ? record.projectName || '' : '',
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
  }
}

function normalizeVehicleIssueRecord(record) {
  const allocateToProject = Boolean(record.allocateToProject)

  return {
    issueId: record.issueId || '',
    issueDate: record.issueDate || todayValue(),
    vehicleId: record.vehicleId || '',
    plateNumber: record.plateNumber || '',
    vehicleName: record.vehicleName || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    issueLocation: record.issueLocation || '其他',
    issueDescription: record.issueDescription || '',
    severity: record.severity || '一般',
    issueStatus: record.issueStatus || '未处理',
    resolution: record.resolution || '',
    repairCost: toAmount(record.repairCost),
    resolvedDate: record.resolvedDate || '',
    allocateToProject,
    projectId: allocateToProject ? record.projectId || '' : '',
    projectName: allocateToProject ? record.projectName || '' : '',
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
    updatedAt: record.updatedAt || todayValue(),
  }
}

function normalizeToolRecord(record) {
  return {
    toolId: record.toolId || '',
    toolName: record.toolName || '',
    specification: record.specification || '',
    brand: record.brand || '',
    serialNumber: record.serialNumber || '',
    category: record.category || '工具',
    purchasePrice: toAmount(record.purchasePrice),
    quantity: Number(record.quantity) || 1,
    currentStatus: record.currentStatus || '在库',
    currentHolderEmployeeId: record.currentHolderEmployeeId || '',
    currentHolderEmployeeName: record.currentHolderEmployeeName || '',
    holderType: record.holderType || '无',
    storageLocation: record.storageLocation || '',
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
    updatedAt: record.updatedAt || todayValue(),
  }
}

function normalizeToolBorrowRecord(record) {
  return {
    id: record.id || record.borrowRecordId || '',
    borrowRecordId: record.borrowRecordId || record.id || '',
    borrowType: record.borrowType || '临时借用',
    toolId: record.toolId || '',
    toolName: record.toolName || '',
    specification: record.specification || '',
    brand: record.brand || '',
    serialNumber: record.serialNumber || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || record.borrower || '',
    borrower: record.borrower || record.employeeName || '',
    quantity: Number(record.quantity) || 1,
    date: record.date || todayValue(),
    expectedReturnDate: record.expectedReturnDate || '',
    toolValue: toAmount(record.toolValue),
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    remark: record.remark || '',
  }
}

function normalizeLifelongToolAssignment(record) {
  return {
    assignmentId: record.assignmentId || '',
    toolId: record.toolId || '',
    toolName: record.toolName || '',
    specification: record.specification || '',
    brand: record.brand || '',
    serialNumber: record.serialNumber || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    department: record.department || '',
    position: record.position || '',
    assignDate: record.assignDate || todayValue(),
    toolValue: toAmount(record.toolValue),
    responsibilityStatus: record.responsibilityStatus || '正常使用中',
    compensationRule:
      record.compensationRule || '丢失按原价赔偿，损坏按维修费用赔偿',
    remark: record.remark || '',
    voidReason: record.voidReason || '',
    createdAt: record.createdAt || todayValue(),
    updatedAt: record.updatedAt || todayValue(),
  }
}

function normalizeToolResponsibilityRecord(record) {
  return {
    responsibilityRecordId: record.responsibilityRecordId || '',
    assignmentId: record.assignmentId || '',
    toolId: record.toolId || '',
    toolName: record.toolName || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    recordDate: record.recordDate || todayValue(),
    issueType: record.issueType || '丢失',
    issueDescription: record.issueDescription || '',
    toolValue: toAmount(record.toolValue),
    repairCost: toAmount(record.repairCost),
    compensationAmount: toAmount(record.compensationAmount),
    compensationStatus: record.compensationStatus || '未赔偿',
    deductFromSalary: Boolean(record.deductFromSalary),
    salaryDeductionMonth: record.salaryDeductionMonth || currentMonthValue(),
    handlerEmployeeId: record.handlerEmployeeId || '',
    handlerEmployeeName: record.handlerEmployeeName || '',
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
  }
}

function getToolUnpaidCompensation(records = []) {
  return records
    .filter((record) => ['未赔偿', '部分赔偿'].includes(record.compensationStatus))
    .reduce((total, record) => total + toAmount(record.compensationAmount), 0)
}

function getAssignmentUnpaidCompensation(assignmentId, records = []) {
  return getToolUnpaidCompensation(records.filter((record) => record.assignmentId === assignmentId))
}

function getVehicleWarnings(vehicleRecords, vehicleUsageRecords, fuelRecords, vehicleExpenseRecords, vehicleIssueRecords) {
  const warnings = []

  vehicleIssueRecords.forEach((record) => {
    if (record.severity === '严重' && record.issueStatus !== '已处理') {
      warnings.push({ id: `issue-${record.issueId}`, message: '有严重异常未处理', record })
    }
  })

  vehicleRecords.forEach((record) => {
    const inspectionDays = daysUntil(record.inspectionExpireDate)
    const insuranceDays = daysUntil(record.insuranceExpireDate)
    if (inspectionDays !== null && inspectionDays <= 30) {
      warnings.push({ id: `inspection-${record.vehicleId}`, message: '车辆车检30天内到期', record })
    }
    if (insuranceDays !== null && insuranceDays <= 30) {
      warnings.push({ id: `insurance-${record.vehicleId}`, message: '车辆保险30天内到期', record })
    }
  })

  vehicleUsageRecords.forEach((record) => {
    if (!record.endMileage) {
      warnings.push({ id: `mileage-empty-${record.usageRecordId}`, message: '用车记录缺少返回里程', record })
    }
    if (record.endMileage && record.startMileage && record.endMileage < record.startMileage) {
      warnings.push({ id: `mileage-${record.usageRecordId}`, message: '返回里程小于出发里程', record })
    }
  })

  ;[...fuelRecords, ...vehicleExpenseRecords, ...vehicleIssueRecords].forEach((record, index) => {
    if (record.allocateToProject && !record.projectId) {
      warnings.push({ id: `vehicle-project-${index}`, message: '费用选择分摊项目但未选择工程项目', record })
    }
  })

  return warnings
}

function calculatePurchaseAmounts(record) {
  const quantity = Number(record.quantity) || 0
  const unitPrice = Number(record.unitPrice) || 0
  const exchangeRate = Number(record.exchangeRate) || 0.048
  const originalAmount = quantity * unitPrice
  const jpyAmount = record.currency === 'CNY' ? originalAmount / exchangeRate : originalAmount
  const totalCost =
    jpyAmount + toAmount(record.shippingFee) + toAmount(record.customsFee) + toAmount(record.otherFee)
  const paidAmount = toAmount(record.paidAmount)
  const unpaidAmount = Math.max(totalCost - paidAmount, 0)
  let paymentStatus = '未付款'

  if (paidAmount >= totalCost && totalCost > 0) {
    paymentStatus = '已付款'
  } else if (paidAmount > 0) {
    paymentStatus = '部分付款'
  }

  return {
    originalAmount: Math.round(originalAmount),
    jpyAmount: Math.round(jpyAmount),
    totalCost: Math.round(totalCost),
    paidAmount: Math.round(paidAmount),
    unpaidAmount: Math.round(unpaidAmount),
    paymentStatus,
  }
}

function formatOriginalAmount(value, currency) {
  const amount = Number(value) || 0
  return currency === 'CNY'
    ? `RMB ${amount.toLocaleString('zh-CN')}`
    : formatYen(amount)
}

function getPurchaseStockInQuantity(purchaseId, stockInRecords) {
  return stockInRecords
    .filter((record) => record.sourcePurchaseId === purchaseId)
    .reduce((total, record) => total + (Number(record.stockInQuantity) || 0), 0)
}

function getPurchaseStockInStatus(purchase, stockInRecords) {
  const stockInQuantity = getPurchaseStockInQuantity(purchase.purchaseId, stockInRecords)
  const quantity = Number(purchase.quantity) || 0

  if (stockInQuantity <= 0) return '未入库'
  if (stockInQuantity < quantity) return '部分入库'
  return '已入库'
}

function normalizePurchaseRecord(record) {
  const amounts = calculatePurchaseAmounts(record)

  return {
    purchaseId: record.purchaseId,
    purchaseDate: record.purchaseDate || todayValue(),
    purchaseSource: record.purchaseSource || '中国采购',
    supplierName: record.supplierName || '',
    platform: record.platform || '1688',
    purchaseType: record.purchaseType || '材料',
    itemName: record.itemName || '',
    specification: record.specification || '',
    quantity: Number(record.quantity) || 0,
    unit: record.unit || '',
    unitPrice: Number(record.unitPrice) || 0,
    currency: record.currency || 'JPY',
    exchangeRate: Number(record.exchangeRate) || 0.048,
    originalAmount: amounts.originalAmount,
    jpyAmount: amounts.jpyAmount,
    shippingFee: toAmount(record.shippingFee),
    customsFee: toAmount(record.customsFee),
    otherFee: toAmount(record.otherFee),
    totalCost: amounts.totalCost,
    purchasePurpose: record.purchasePurpose || '仓库备货',
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    paymentStatus: amounts.paymentStatus,
    paidAmount: amounts.paidAmount,
    unpaidAmount: amounts.unpaidAmount,
    invoiceStatus: record.invoiceStatus || '未取得',
    arrivalStatus: record.arrivalStatus || '未到货',
    stockInStatus: record.stockInStatus || '未入库',
    purchaseStatus: record.purchaseStatus || '正常',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
    updatedAt: record.updatedAt || todayValue(),
  }
}

function normalizePurchasePaymentRecord(record) {
  const paymentAmount = Number(record.paymentAmount) || 0
  const exchangeRate = Number(record.exchangeRate) || 0.048
  const jpyAmount = record.currency === 'CNY' ? paymentAmount / exchangeRate : paymentAmount

  return {
    paymentId: record.paymentId,
    purchaseId: record.purchaseId || '',
    paymentDate: record.paymentDate || todayValue(),
    paymentAmount,
    currency: record.currency || 'JPY',
    exchangeRate,
    jpyAmount: Math.round(jpyAmount),
    paymentMethod: record.paymentMethod || '银行转账',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    remark: record.remark || '',
  }
}

function normalizeStockInRecord(record) {
  return {
    stockInId: record.stockInId,
    sourceType: record.sourceType || '采购入库',
    sourcePurchaseId: record.sourcePurchaseId || '',
    itemName: record.itemName || '',
    specification: record.specification || '',
    stockInQuantity: Number(record.stockInQuantity) || 0,
    unit: record.unit || '',
    stockInDate: record.stockInDate || todayValue(),
    warehouseLocation: record.warehouseLocation || '',
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    remark: record.remark || '',
  }
}

function normalizeInventoryItem(item) {
  return {
    inventoryId: item.inventoryId,
    itemName: item.itemName || '',
    specification: item.specification || '',
    category: item.category || '材料',
    quantity: Number(item.quantity) || 0,
    unit: item.unit || '',
    warehouseLocation: item.warehouseLocation || '',
    sourceType: item.sourceType || '采购入库',
    sourcePurchaseId: item.sourcePurchaseId || '',
    averageCost: toAmount(item.averageCost),
    totalCost: toAmount(item.totalCost),
    updatedAt: item.updatedAt || todayValue(),
  }
}

function normalizeSalaryRecord(record) {
  return {
    salaryRecordId: record.salaryRecordId,
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    salaryMonth: record.salaryMonth || currentMonthValue(),
    baseSalary: toAmount(record.baseSalary),
    workDays: Number(record.workDays) || 0,
    overtimePay: toAmount(record.overtimePay),
    bonus: toAmount(record.bonus),
    deduction: toAmount(record.deduction),
    netSalary: calculateNetSalary(record),
    remark: record.remark || '',
    createdAt: record.createdAt || todayValue(),
  }
}

function normalizeProjectCostRecord(record) {
  return {
    costRecordId: record.costRecordId,
    projectId: record.projectId || '',
    projectName: record.projectName || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    costType: record.costType || '材料费',
    amount: toAmount(record.amount),
    date: record.date || todayValue(),
    operator: record.operator || '',
    remark: record.remark || '',
  }
}

function normalizeOperatingExpenseRecord(record) {
  const allocateToProject = Boolean(record.allocateToProject)

  return {
    expenseRecordId: record.expenseRecordId,
    expenseType: record.expenseType || '房租',
    amount: toAmount(record.amount),
    date: record.date || todayValue(),
    operator: record.operator || '',
    employeeId: record.employeeId || '',
    employeeName: record.employeeName || '',
    allocateToProject,
    projectId: allocateToProject ? record.projectId || '' : '',
    projectName: allocateToProject ? record.projectName || '' : '',
    remark: record.remark || '',
  }
}

function usePersistentState(key, fallback, options = {}) {
  const cloudPersistence = options.cloudPersistence || 'list'
  const [value, setValue] = useState(() => readStorage(key, fallback))
  const [cloudState, setCloudState] = useState({
    loading: isCloudDatabaseReady(),
    error: '',
    source: isCloudDatabaseReady() ? 'supabase' : 'local',
  })

  useEffect(() => {
    let isMounted = true

    async function loadCloudValue() {
      if (!isCloudDatabaseReady()) return

      setCloudState((current) => ({ ...current, loading: true, error: '' }))
      try {
        const cloudValue = await getList(key)
        if (!isMounted || cloudValue === undefined) return

        const localValue = readStorage(key, fallback)
        const cloudOnlyHasHiddenAccount =
          key === STORAGE_KEYS.employees &&
          Array.isArray(cloudValue) &&
          cloudValue.length === 1 &&
          cloudValue[0]?.employeeId === 'SUPER_ADMIN'
        const shouldKeepLocalCache =
          Array.isArray(localValue) &&
          localValue.length > 0 &&
          Array.isArray(cloudValue) &&
          (cloudValue.length === 0 || cloudOnlyHasHiddenAccount)

        if (!shouldKeepLocalCache) {
          setValue(cloudValue)
          window.localStorage.setItem(key, JSON.stringify(cloudValue))
        }
        setCloudState({ loading: false, error: '', source: 'supabase' })
      } catch (error) {
        console.error(`Supabase 读取失败: ${key}`, error)
        if (isMounted) {
          setCloudState({
            loading: false,
            error: '数据读取失败，已暂时使用本机缓存。',
            source: 'local-cache',
          })
        }
      }
    }

    loadCloudValue()

    return () => {
      isMounted = false
    }
  }, [key])

  const updateValue = (nextValue, updateOptions = {}) => {
    setValue((currentValue) => {
      const resolvedValue =
        typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
      if (!updateOptions.stateOnly) {
        window.localStorage.setItem(key, JSON.stringify(resolvedValue))
        if (isCloudDatabaseReady() && cloudPersistence === 'list') {
          saveList(key, resolvedValue).catch((error) => {
            console.error(`Supabase 保存失败: ${key}`, error)
            setCloudState({
              loading: false,
              error: '保存失败，请检查网络或 Supabase 配置。',
              source: 'local-cache',
            })
          })
        }
      }
      return resolvedValue
    })
  }

  return [value, updateValue, cloudState]
}

function nextId(prefix, records, field = 'id') {
  const maxNumber = records.reduce((max, record) => {
    const rawValue = record[field] || ''
    const match = rawValue.match(new RegExp(`^${prefix}(\\d+)$`))
    return match ? Math.max(max, Number(match[1])) : max
  }, 0)

  return `${prefix}${String(maxNumber + 1).padStart(3, '0')}`
}

function createEmptyProject() {
  return {
    projectName: '',
    customerName: '',
    address: '',
    status: '进行中',
    manager: '',
    startDate: todayValue(),
    endDate: '',
    remark: '',
  }
}

function createEmptyEmployee() {
  return {
    name: '',
    gender: '男',
    birthDate: '',
    nationality: '中国',
    employmentStatus: '在职',
    hireDate: todayValue(),
    resignDate: '',
    department: '现场',
    position: '小工',
    level: '1星',
    phone: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    currentAddress: '',
    visaAgency: '',
    visaType: '',
    visaExpireDate: '',
    passportNumber: '',
    residenceCardNumber: '',
    salaryType: '未设置',
    baseSalary: '',
    dailySalary: '',
    hourlyWage: '',
    salaryRemark: '',
    username: '',
    passwordHash: '',
    loginEnabled: false,
    mustChangePassword: false,
    role: 'employee',
    accessibleModules: [],
    canCreateModules: [],
    canEditModules: [],
    canDeleteModules: [],
    sensitivePermissions: [],
    source: '人员管理新增',
    lastLoginAt: '',
    wecomUserId: '',
    wecomDepartmentId: '',
    wecomDepartmentName: '',
    authProvider: 'password',
    remark: '',
  }
}

function createDefaultAdmin() {
  const now = dateTimeValue()

  return normalizeEmployee({
    employeeId: 'SUPER_ADMIN',
    name: '超级管理员',
    username: '超级管理员',
    passwordHash: '320086',
    phone: '',
    department: '管理',
    position: '超级管理员',
    employmentStatus: '在职',
    role: 'super_admin',
    loginEnabled: true,
    mustChangePassword: false,
    accessibleModules: ['all'],
    canCreateModules: ['all'],
    canEditModules: ['all'],
    canDeleteModules: ['all'],
    sensitivePermissions: ['all'],
    isHiddenSystemAccount: true,
    source: '系统恢复账号',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: '',
  })
}

function ensureSuperAdminEmployee(employees = []) {
  const hasSuperAdmin = employees.some((employee) => employee.employeeId === 'SUPER_ADMIN')
  if (hasSuperAdmin) {
    return employees.map((employee) =>
      employee.employeeId === 'SUPER_ADMIN'
        ? normalizeEmployee({
            ...employee,
            name: '超级管理员',
            username: '超级管理员',
            passwordHash: employee.passwordHash || '320086',
            position: '超级管理员',
            role: 'super_admin',
            loginEnabled: true,
            accessibleModules: ['all'],
            canCreateModules: ['all'],
            canEditModules: ['all'],
            canDeleteModules: ['all'],
            sensitivePermissions: ['all'],
            isHiddenSystemAccount: true,
            source: '系统恢复账号',
          })
        : employee,
    )
  }

  return [createDefaultAdmin(), ...employees]
}

function buildCurrentUser(employee) {
  return {
    employeeId: employee.employeeId,
    name: employee.name,
    position: employee.position,
    department: employee.department,
    role: employee.role,
    accessibleModules: employee.accessibleModules || [],
    canCreateModules: employee.canCreateModules || [],
    canEditModules: employee.canEditModules || [],
    canDeleteModules: employee.canDeleteModules || [],
    sensitivePermissions: employee.sensitivePermissions || [],
    loginAt: dateTimeValue(),
  }
}

function isSixDigitPassword(password) {
  return /^\d{6}$/.test(password)
}

function createEmptyBusinessForm(fields) {
  return fields.reduce(
    (form, field) => ({
      ...form,
      [field.name]: field.type === 'date' ? todayValue() : '',
    }),
    { projectId: '', employeeId: '', externalPersonName: '' },
  )
}

function createEmptyLaborForm() {
  return {
    projectId: '',
    employeeId: '',
    operatorId: '',
    workLocationType: '工程项目',
    workDate: todayValue(),
    startTime: '08:00',
    endTime: '17:00',
    workType: '正常出勤',
    workHours: '8',
    laborCost: '',
    jobContent: '',
    remark: '',
  }
}

function createEmptySalaryForm() {
  return {
    employeeId: '',
    employeeName: '',
    salaryMonth: currentMonthValue(),
    baseSalary: '',
    workDays: '',
    overtimePay: '',
    bonus: '',
    deduction: '',
    remark: '',
    createdAt: todayValue(),
  }
}

function createEmptyProjectCostForm() {
  return {
    projectId: '',
    employeeId: '',
    externalPersonName: '',
    costType: '材料费',
    amount: '',
    date: todayValue(),
    operator: '',
    remark: '',
  }
}

function createEmptyOperatingExpenseForm() {
  return {
    expenseType: '房租',
    amount: '',
    date: todayValue(),
    operator: '',
    employeeId: '',
    externalPersonName: '',
    allocateToProject: false,
    projectId: '',
    remark: '',
  }
}

function createEmptyPurchaseForm() {
  return {
    purchaseDate: todayValue(),
    purchaseSource: '中国采购',
    supplierName: '',
    platform: '1688',
    purchaseType: '材料',
    itemName: '',
    specification: '',
    quantity: '',
    unit: '',
    unitPrice: '',
    currency: 'JPY',
    exchangeRate: '0.048',
    shippingFee: '',
    customsFee: '',
    otherFee: '',
    purchasePurpose: '仓库备货',
    projectId: '',
    paidAmount: '',
    invoiceStatus: '未取得',
    arrivalStatus: '未到货',
    purchaseStatus: '正常',
    employeeId: '',
    externalPersonName: '',
    remark: '',
  }
}

function createEmptyStockInForm() {
  return {
    purchaseId: '',
    stockInQuantity: '',
    stockInDate: todayValue(),
    warehouseLocation: '',
    employeeId: '',
    externalPersonName: '',
    remark: '',
  }
}

function createEmptyPurchasePaymentForm() {
  return {
    purchaseId: '',
    paymentDate: todayValue(),
    paymentAmount: '',
    currency: 'JPY',
    exchangeRate: '0.048',
    paymentMethod: '银行转账',
    employeeId: '',
    externalPersonName: '',
    remark: '',
  }
}

function createEmptyVehicleForm() {
  return {
    plateNumber: '',
    vehicleName: '',
    vehicleType: '面包车',
    brand: '',
    model: '',
    status: '使用中',
    currentMileage: '',
    inspectionExpireDate: '',
    insuranceExpireDate: '',
    responsibleEmployeeId: '',
    remark: '',
  }
}

function createEmptyVehicleUsageForm() {
  return {
    usageDate: todayValue(),
    vehicleId: '',
    employeeId: '',
    usagePurpose: '工程项目',
    projectId: '',
    startLocation: '',
    endLocation: '',
    startTime: '08:00',
    endTime: '17:00',
    startMileage: '',
    endMileage: '',
    remark: '',
  }
}

function createEmptyFuelForm() {
  return {
    fuelDate: todayValue(),
    vehicleId: '',
    employeeId: '',
    fuelStation: '',
    fuelType: '汽油',
    fuelLiters: '',
    fuelAmount: '',
    mileageAtFuel: '',
    paymentMethod: '现金',
    allocateToProject: false,
    projectId: '',
    remark: '',
  }
}

function createEmptyVehicleExpenseForm() {
  return {
    expenseDate: todayValue(),
    vehicleId: '',
    expenseType: '停车费',
    amount: '',
    paymentMethod: '现金',
    employeeId: '',
    allocateToProject: false,
    projectId: '',
    remark: '',
  }
}

function createEmptyVehicleIssueForm() {
  return {
    issueDate: todayValue(),
    vehicleId: '',
    employeeId: '',
    issueLocation: '其他',
    issueDescription: '',
    severity: '一般',
    issueStatus: '未处理',
    resolution: '',
    repairCost: '',
    resolvedDate: '',
    allocateToProject: false,
    projectId: '',
    remark: '',
  }
}

function createEmptyToolForm() {
  return {
    toolName: '',
    specification: '',
    brand: '',
    serialNumber: '',
    category: '工具',
    purchasePrice: '',
    quantity: '1',
    currentStatus: '在库',
    currentHolderEmployeeId: '',
    holderType: '无',
    storageLocation: '',
    remark: '',
  }
}

function createEmptyToolBorrowForm() {
  return {
    borrowType: '临时借用',
    toolId: '',
    employeeId: '',
    quantity: '1',
    date: todayValue(),
    expectedReturnDate: '',
    toolValue: '',
    projectId: '',
    remark: '',
  }
}

function createEmptyLifelongToolAssignmentForm() {
  return {
    toolId: '',
    employeeId: '',
    assignDate: todayValue(),
    toolValue: '',
    compensationRule: '丢失按原价赔偿，损坏按维修费用赔偿',
    remark: '',
  }
}

function createEmptyToolResponsibilityForm() {
  return {
    assignmentId: '',
    recordDate: todayValue(),
    issueType: '丢失',
    issueDescription: '',
    toolValue: '',
    repairCost: '',
    compensationAmount: '',
    compensationStatus: '未赔偿',
    deductFromSalary: false,
    salaryDeductionMonth: currentMonthValue(),
    handlerEmployeeId: '',
    remark: '',
  }
}

function App() {
  const [currentView, setCurrentView] = useState('home')
  const [contractRevenueProjectId, setContractRevenueProjectId] = useState('')
  const [currentUser, setCurrentUserState] = useState(() =>
    readStorage(STORAGE_KEYS.currentUser, null),
  )
  const [storedProjects, setStoredProjects] = usePersistentState(STORAGE_KEYS.projects, [])
  const [projectContractChanges, setProjectContractChanges] = usePersistentState(
    STORAGE_KEYS.projectContractChanges,
    [],
    { cloudPersistence: 'record' },
  )
  const [projectPaymentPlans, setProjectPaymentPlans] = usePersistentState(
    STORAGE_KEYS.projectPaymentPlans,
    [],
    { cloudPersistence: 'record' },
  )
  const [projectReceipts, setProjectReceipts] = usePersistentState(
    STORAGE_KEYS.projectReceipts,
    [],
    { cloudPersistence: 'record' },
  )
  const [storedEmployees, setStoredEmployees] = usePersistentState(STORAGE_KEYS.employees, [])
  const [stockOutRecords, setStockOutRecords] = usePersistentState(
    STORAGE_KEYS.stockOutRecords,
    [],
  )
  const [stockReturnRecords, setStockReturnRecords] = usePersistentState(
    STORAGE_KEYS.stockReturnRecords,
    [],
  )
  const [laborRecords, setLaborRecords] = usePersistentState(STORAGE_KEYS.laborRecords, [])
  const [vehicleRecords, setVehicleRecords] = usePersistentState(
    STORAGE_KEYS.vehicleRecords,
    [],
  )
  const [storedVehicleUsageRecords, setStoredVehicleUsageRecords] = usePersistentState(
    STORAGE_KEYS.vehicleUsageRecords,
    [],
  )
  const [storedFuelRecords, setStoredFuelRecords] = usePersistentState(
    STORAGE_KEYS.fuelRecords,
    [],
  )
  const [storedVehicleExpenseRecords, setStoredVehicleExpenseRecords] = usePersistentState(
    STORAGE_KEYS.vehicleExpenseRecords,
    [],
  )
  const [storedVehicleIssueRecords, setStoredVehicleIssueRecords] = usePersistentState(
    STORAGE_KEYS.vehicleIssueRecords,
    [],
  )
  const [toolBorrowRecords, setToolBorrowRecords] = usePersistentState(
    STORAGE_KEYS.toolBorrowRecords,
    [],
  )
  const [toolReturnRecords, setToolReturnRecords] = usePersistentState(
    STORAGE_KEYS.toolReturnRecords,
    [],
  )
  const [storedToolRecords, setStoredToolRecords] = usePersistentState(
    STORAGE_KEYS.toolRecords,
    [],
  )
  const [storedLifelongToolAssignments, setStoredLifelongToolAssignments] = usePersistentState(
    STORAGE_KEYS.lifelongToolAssignments,
    [],
  )
  const [storedToolResponsibilityRecords, setStoredToolResponsibilityRecords] = usePersistentState(
    STORAGE_KEYS.toolResponsibilityRecords,
    [],
  )
  const [storedSalaryRecords, setStoredSalaryRecords] = usePersistentState(
    STORAGE_KEYS.salaryRecords,
    [],
  )
  const [storedProjectCostRecords, setStoredProjectCostRecords] = usePersistentState(
    STORAGE_KEYS.projectCostRecords,
    [],
  )
  const [storedOperatingExpenseRecords, setStoredOperatingExpenseRecords] = usePersistentState(
    STORAGE_KEYS.operatingExpenseRecords,
    [],
  )
  const [storedPurchaseRecords, setStoredPurchaseRecords] = usePersistentState(
    STORAGE_KEYS.purchaseRecords,
    [],
  )
  const [storedPurchasePaymentRecords, setStoredPurchasePaymentRecords] = usePersistentState(
    STORAGE_KEYS.purchasePaymentRecords,
    [],
  )
  const [storedStockInRecords, setStoredStockInRecords] = usePersistentState(
    STORAGE_KEYS.stockInRecords,
    [],
  )
  const [storedInventoryItems, setStoredInventoryItems] = usePersistentState(
    STORAGE_KEYS.inventoryItems,
    [],
  )

  const refreshStoredProjectsFromLocal = () => {
    setStoredProjects(readStorage(STORAGE_KEYS.projects, []), { stateOnly: true })
  }
  const refreshProjectReceiptsFromLocal = () => {
    setProjectReceipts(readStorage(STORAGE_KEYS.projectReceipts, []), {
      stateOnly: true,
    })
  }

  const recordGroups = {
    stockOut: stockOutRecords,
    stockReturn: stockReturnRecords,
    labor: laborRecords,
    vehicle: storedVehicleUsageRecords,
    toolBorrow: toolBorrowRecords,
    toolReturn: toolReturnRecords,
  }

  const recordSetters = {
    stockOut: setStockOutRecords,
    stockReturn: setStockReturnRecords,
    labor: setLaborRecords,
    vehicle: setStoredVehicleUsageRecords,
    toolBorrow: setToolBorrowRecords,
    toolReturn: setToolReturnRecords,
  }

  const rawEmployees = ensureSuperAdminEmployee(storedEmployees)

  useEffect(() => {
    if (!isCloudDatabaseReady()) return
    upsertRecord(STORAGE_KEYS.employees, createDefaultAdmin()).catch((error) => {
      console.error('Supabase 隐藏恢复账号初始化失败', error)
    })
  }, [])

  const projects = useMemo(
    () => storedProjects.map((project) => normalizeProject(project)),
    [storedProjects],
  )
  const projectRevenueSnapshots = useMemo(
    () =>
      buildProjectRevenueSnapshotCollection(
        projects,
        projectContractChanges,
        projectPaymentPlans,
        projectReceipts,
      ),
    [projects, projectContractChanges, projectPaymentPlans, projectReceipts],
  )
  const projectRevenueProjects = useMemo(
    () =>
      projects.map((project) =>
        buildProjectRevenueReadModel(
          project,
          projectRevenueSnapshots.get(project.projectId),
        ),
      ),
    [projects, projectRevenueSnapshots],
  )
  const employees = useMemo(
    () => rawEmployees.map((employee) => normalizeEmployee(employee)),
    [rawEmployees],
  )
  const vehicles = useMemo(
    () => vehicleRecords.map((record) => normalizeVehicleRecord(record)),
    [vehicleRecords],
  )
  const vehicleUsageRecords = useMemo(
    () => storedVehicleUsageRecords.map((record) => normalizeVehicleUsageRecord(record)),
    [storedVehicleUsageRecords],
  )
  const fuelRecords = useMemo(
    () => storedFuelRecords.map((record) => normalizeFuelRecord(record)),
    [storedFuelRecords],
  )
  const vehicleExpenseRecords = useMemo(
    () => storedVehicleExpenseRecords.map((record) => normalizeVehicleExpenseRecord(record)),
    [storedVehicleExpenseRecords],
  )
  const vehicleIssueRecords = useMemo(
    () => storedVehicleIssueRecords.map((record) => normalizeVehicleIssueRecord(record)),
    [storedVehicleIssueRecords],
  )
  const salaryRecords = useMemo(
    () => storedSalaryRecords.map((record) => normalizeSalaryRecord(record)),
    [storedSalaryRecords],
  )
  const projectCostRecords = useMemo(
    () => storedProjectCostRecords.map((record) => normalizeProjectCostRecord(record)),
    [storedProjectCostRecords],
  )
  const operatingExpenseRecords = useMemo(
    () =>
      storedOperatingExpenseRecords.map((record) => normalizeOperatingExpenseRecord(record)),
    [storedOperatingExpenseRecords],
  )
  const purchaseRecords = useMemo(
    () => storedPurchaseRecords.map((record) => normalizePurchaseRecord(record)),
    [storedPurchaseRecords],
  )
  const purchasePaymentRecords = useMemo(
    () => storedPurchasePaymentRecords.map((record) => normalizePurchasePaymentRecord(record)),
    [storedPurchasePaymentRecords],
  )
  const stockInRecords = useMemo(
    () => storedStockInRecords.map((record) => normalizeStockInRecord(record)),
    [storedStockInRecords],
  )
  const inventoryItems = useMemo(
    () => storedInventoryItems.map((item) => normalizeInventoryItem(item)),
    [storedInventoryItems],
  )
  const toolRecords = useMemo(
    () => storedToolRecords.map((record) => normalizeToolRecord(record)),
    [storedToolRecords],
  )
  const normalizedToolBorrowRecords = useMemo(
    () => toolBorrowRecords.map((record) => normalizeToolBorrowRecord(record)),
    [toolBorrowRecords],
  )
  const lifelongToolAssignments = useMemo(
    () =>
      storedLifelongToolAssignments.map((record) =>
        normalizeLifelongToolAssignment(record),
      ),
    [storedLifelongToolAssignments],
  )
  const toolResponsibilityRecords = useMemo(
    () =>
      storedToolResponsibilityRecords.map((record) =>
        normalizeToolResponsibilityRecord(record),
      ),
    [storedToolResponsibilityRecords],
  )

  const setProjects = (nextProjects) => {
    setStoredProjects((currentProjects) => {
      const normalizedCurrent = currentProjects.map((project) => normalizeProject(project))
      const resolvedProjects =
        typeof nextProjects === 'function' ? nextProjects(normalizedCurrent) : nextProjects
      return resolvedProjects.map((project) => prepareProjectForPersistence(project))
    })
  }
  const setEmployees = (nextEmployees) => {
    setStoredEmployees((currentEmployees) => {
      const normalizedCurrent = ensureSuperAdminEmployee(currentEmployees).map((employee) => normalizeEmployee(employee))
      const resolvedEmployees =
        typeof nextEmployees === 'function' ? nextEmployees(normalizedCurrent) : nextEmployees
      return ensureSuperAdminEmployee(resolvedEmployees).map((employee) => normalizeEmployee(employee))
    })
  }
  const setCurrentUser = (nextUser) => {
    if (nextUser) {
      window.localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(nextUser))
    } else {
      window.localStorage.removeItem(STORAGE_KEYS.currentUser)
    }
    setCurrentUserState(nextUser)
  }
  const setVehicles = (nextVehicles) => {
    setVehicleRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeVehicleRecord(record))
      const resolvedRecords =
        typeof nextVehicles === 'function' ? nextVehicles(normalizedCurrent) : nextVehicles
      return resolvedRecords.map((record) => normalizeVehicleRecord(record))
    })
  }
  const setVehicleUsageRecords = (nextRecords) => {
    setStoredVehicleUsageRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeVehicleUsageRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeVehicleUsageRecord(record))
    })
  }
  const setFuelRecords = (nextRecords) => {
    setStoredFuelRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeFuelRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeFuelRecord(record))
    })
  }
  const setVehicleExpenseRecords = (nextRecords) => {
    setStoredVehicleExpenseRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeVehicleExpenseRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeVehicleExpenseRecord(record))
    })
  }
  const setVehicleIssueRecords = (nextRecords) => {
    setStoredVehicleIssueRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeVehicleIssueRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeVehicleIssueRecord(record))
    })
  }
  const setSalaryRecords = (nextRecords) => {
    setStoredSalaryRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeSalaryRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeSalaryRecord(record))
    })
  }
  const setProjectCostRecords = (nextRecords) => {
    setStoredProjectCostRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeProjectCostRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeProjectCostRecord(record))
    })
  }
  const setOperatingExpenseRecords = (nextRecords) => {
    setStoredOperatingExpenseRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) =>
        normalizeOperatingExpenseRecord(record),
      )
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeOperatingExpenseRecord(record))
    })
  }
  const setPurchaseRecords = (nextRecords) => {
    setStoredPurchaseRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizePurchaseRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizePurchaseRecord(record))
    })
  }
  const setPurchasePaymentRecords = (nextRecords) => {
    setStoredPurchasePaymentRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) =>
        normalizePurchasePaymentRecord(record),
      )
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizePurchasePaymentRecord(record))
    })
  }
  const setStockInRecords = (nextRecords) => {
    setStoredStockInRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeStockInRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeStockInRecord(record))
    })
  }
  const setInventoryItems = (nextItems) => {
    setStoredInventoryItems((currentItems) => {
      const normalizedCurrent = currentItems.map((item) => normalizeInventoryItem(item))
      const resolvedItems =
        typeof nextItems === 'function' ? nextItems(normalizedCurrent) : nextItems
      return resolvedItems.map((item) => normalizeInventoryItem(item))
    })
  }
  const setToolRecords = (nextRecords) => {
    setStoredToolRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeToolRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeToolRecord(record))
    })
  }
  const setNormalizedToolBorrowRecords = (nextRecords) => {
    setToolBorrowRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeToolBorrowRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeToolBorrowRecord(record))
    })
  }
  const setLifelongToolAssignments = (nextRecords) => {
    setStoredLifelongToolAssignments((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) =>
        normalizeLifelongToolAssignment(record),
      )
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeLifelongToolAssignment(record))
    })
  }
  const setToolResponsibilityRecords = (nextRecords) => {
    setStoredToolResponsibilityRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) =>
        normalizeToolResponsibilityRecord(record),
      )
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeToolResponsibilityRecord(record))
    })
  }

  const accountingRecords = {
    salary: salaryRecords,
    projectCost: projectCostRecords,
    operatingExpense: operatingExpenseRecords,
    purchase: purchaseRecords,
    fuel: fuelRecords,
    vehicleExpense: vehicleExpenseRecords,
    vehicleIssue: vehicleIssueRecords,
  }
  const contractRevenueProject = projects.find(
    (project) => project.projectId === contractRevenueProjectId,
  )

  const openContractRevenue = (projectId) => {
    setContractRevenueProjectId(projectId)
    setCurrentView('contractRevenue')
  }

  const handleContractRevenueProjectChange = (nextProject) => {
    setProjects((currentProjects) =>
      currentProjects.map((project) =>
        project.projectId === nextProject.projectId
          ? { ...project, ...nextProject }
          : project,
      ),
    )
  }

  const handleHistoricalContractReview = async (nextProject) => {
    const upsertLocalRecord = createLocalStorageUpsertRecord(window.localStorage)
    const persistedProject = prepareProjectForPersistence(nextProject)
    await upsertLocalRecord(STORAGE_KEYS.projects, persistedProject)
    refreshStoredProjectsFromLocal()
    return persistedProject
  }

  const handleLocalContractRevenueMigrationComplete = () => {
    refreshStoredProjectsFromLocal()
    refreshProjectReceiptsFromLocal()
  }

  const handleCreateContractChange = async (input) => {
    const created = await persistContractChange(input)
    setProjectContractChanges((currentChanges) => [
      created,
      ...currentChanges.filter((change) => change.changeId !== created.changeId),
    ])
    return created
  }

  const handleVoidContractChange = async (record, details) => {
    const voided = await persistVoidContractChange(record, details)
    setProjectContractChanges((currentChanges) =>
      currentChanges.map((change) =>
        change.changeId === voided.changeId ? voided : change,
      ),
    )
    return voided
  }

  const handleSavePaymentPlan = async (input) => {
    const saved = input.planId
      ? await persistUpdatePaymentPlan(input)
      : await persistCreatePaymentPlan(input)
    setProjectPaymentPlans((currentPlans) => [
      saved,
      ...currentPlans.filter((plan) => {
        const sameActiveStage =
          plan.projectId === saved.projectId &&
          plan.stage === saved.stage &&
          plan.statusCode !== 'void' &&
          plan.statusCode !== 'deleted'
        return plan.planId !== saved.planId && !sameActiveStage
      }),
    ])
    return saved
  }

  const handleCreateCustomerReceipt = async (input) => {
    const created = await persistCreateCustomerReceipt(input)
    setProjectReceipts((currentReceipts) => [
      created,
      ...currentReceipts.filter(
        (receipt) => receipt.receiptId !== created.receiptId,
      ),
    ])
    return created
  }

  const handleVoidCustomerReceipt = async (record, details) => {
    const voided = await persistVoidCustomerReceipt(record, details)
    setProjectReceipts((currentReceipts) =>
      currentReceipts.map((receipt) =>
        receipt.receiptId === voided.receiptId ? voided : receipt,
      ),
    )
    return voided
  }

  const handleLogin = ({ name, password }) => {
    const matchedEmployees = employees.filter((employee) => employee.name === name.trim())

    if (matchedEmployees.length === 0) {
      return { ok: false, error: '未找到该员工，请先注册或联系管理员' }
    }
    if (matchedEmployees.length > 1) {
      return { ok: false, error: '存在同名员工，请联系管理员确认账号' }
    }

    const employee = matchedEmployees[0]
    if (!employee.loginEnabled) {
      return { ok: false, error: '该账号未启用，请联系管理员' }
    }
    if (!employee.passwordHash || employee.passwordHash !== password) {
      return { ok: false, error: '密码错误' }
    }

    const lastLoginAt = dateTimeValue()
    const nextEmployee = normalizeEmployee({ ...employee, lastLoginAt, updatedAt: lastLoginAt })
    setEmployees((currentEmployees) =>
      currentEmployees.map((item) =>
        item.employeeId === employee.employeeId ? nextEmployee : item,
      ),
    )
    setCurrentUser(buildCurrentUser(nextEmployee))
    setCurrentView('home')
    return { ok: true, error: '' }
  }

  const handleRegister = async ({ name, password, confirmPassword, phone, department, position }) => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      return { ok: false, error: '真实姓名不能为空' }
    }
    if (!isSixDigitPassword(password)) {
      return { ok: false, error: '密码必须是 6 位数字' }
    }
    if (password !== confirmPassword) {
      return { ok: false, error: '确认密码必须一致' }
    }
    if (employees.some((employee) => employee.name === trimmedName)) {
      return { ok: false, error: '该姓名已存在，请联系管理员确认是否已建档' }
    }

    const now = dateTimeValue()
    const newEmployee = normalizeEmployee({
      employeeId: `E${Date.now()}`,
      name: trimmedName,
      username: trimmedName,
      passwordHash: password,
      phone,
      department: department || '其他',
      position: position || '其他',
      employmentStatus: '在职',
      role: 'employee',
      loginEnabled: true,
      mustChangePassword: false,
      accessibleModules: [],
      canCreateModules: [],
      canEditModules: [],
      canDeleteModules: [],
      sensitivePermissions: [],
      source: '员工自助注册',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      authProvider: 'password',
    })

    if (isCloudDatabaseReady()) {
      try {
        await upsertRecord(STORAGE_KEYS.employees, newEmployee)
      } catch (error) {
        console.error('员工注册保存到 Supabase 失败', error)
        return {
          ok: false,
          error: '注册信息保存到云端失败，请检查网络后重试。',
        }
      }
    }

    setEmployees((currentEmployees) => [newEmployee, ...currentEmployees])
    setCurrentUser(buildCurrentUser(newEmployee))
    setCurrentView('home')
    return { ok: true, error: '' }
  }

  const handleLogout = () => {
    setCurrentUser(null)
    setCurrentView('home')
  }

  const handleClearTestData = async () => {
    const systemAdmin = createDefaultAdmin()

    for (const key of BUSINESS_STORAGE_KEYS) {
      const nextValue = key === STORAGE_KEYS.employees ? [systemAdmin] : []
      window.localStorage.setItem(key, JSON.stringify(nextValue))
      if (isCloudDatabaseReady()) {
        await saveList(key, nextValue)
      }
    }

    if (currentUser.employeeId === 'SUPER_ADMIN') {
      setCurrentUser(buildCurrentUser(systemAdmin))
    } else {
      setCurrentUser(null)
    }

    window.location.reload()
  }

  if (!currentUser) {
    return (
      <LoginPage
        employees={employees}
        onLogin={handleLogin}
        onRegister={handleRegister}
      />
    )
  }

  const renderInDesktopShell = (page) => (
    <DesktopAdminShell
      currentView={currentView}
      currentUser={currentUser}
      onNavigate={setCurrentView}
      onLogout={handleLogout}
    >
      {page}
    </DesktopAdminShell>
  )

  if (currentView === 'contractRevenue') {
    return renderInDesktopShell(
      <ContractRevenuePage
        project={contractRevenueProject}
        revenueSnapshot={projectRevenueSnapshots.get(contractRevenueProjectId)}
        contractChanges={projectContractChanges}
        paymentPlans={projectPaymentPlans}
        receipts={projectReceipts}
        currentUser={currentUser}
        onProjectChange={handleContractRevenueProjectChange}
        onHistoricalReview={handleHistoricalContractReview}
        onCreateContractChange={handleCreateContractChange}
        onVoidContractChange={handleVoidContractChange}
        onSavePaymentPlan={handleSavePaymentPlan}
        onCreateCustomerReceipt={handleCreateCustomerReceipt}
        onVoidCustomerReceipt={handleVoidCustomerReceipt}
        onBack={() => setCurrentView('projects')}
      />
    )
  }

  if (currentView === 'projects') {
    return renderInDesktopShell(
      <ProjectPage
        projects={projects}
        projectRevenueSnapshots={projectRevenueSnapshots}
        setProjects={setProjects}
        onOpenContractRevenue={openContractRevenue}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'employees') {
    return renderInDesktopShell(
      <PersonnelPage
        employees={employees}
        setEmployees={setEmployees}
        currentUser={currentUser}
        references={{
          salaryRecords,
          laborRecords,
          stockOutRecords,
          stockReturnRecords,
          vehicleArchiveRecords: vehicles,
          vehicleRecords: vehicleUsageRecords,
          fuelRecords,
          vehicleExpenseRecords,
          vehicleIssueRecords,
          toolBorrowRecords,
          toolReturnRecords,
          lifelongToolAssignments,
          toolResponsibilityRecords,
          projectCostRecords,
          operatingExpenseRecords,
        }}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'dashboard') {
    return renderInDesktopShell(
      <DashboardPage
        projects={projectRevenueProjects}
        employees={employees}
        records={recordGroups}
        projectCostRecords={projectCostRecords}
        purchaseRecords={purchaseRecords}
        stockInRecords={stockInRecords}
        inventoryItems={inventoryItems}
        salaryRecords={salaryRecords}
        vehicles={vehicles}
        vehicleUsageRecords={vehicleUsageRecords}
        fuelRecords={fuelRecords}
        vehicleExpenseRecords={vehicleExpenseRecords}
        vehicleIssueRecords={vehicleIssueRecords}
        toolRecords={toolRecords}
        toolBorrowRecords={normalizedToolBorrowRecords}
        toolReturnRecords={toolReturnRecords}
        lifelongToolAssignments={lifelongToolAssignments}
        toolResponsibilityRecords={toolResponsibilityRecords}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'purchase') {
    return renderInDesktopShell(
      <PurchaseManagementPage
        projects={projects}
        employees={employees}
        purchaseRecords={purchaseRecords}
        setPurchaseRecords={setPurchaseRecords}
        purchasePaymentRecords={purchasePaymentRecords}
        setPurchasePaymentRecords={setPurchasePaymentRecords}
        stockInRecords={stockInRecords}
        setStockInRecords={setStockInRecords}
        inventoryItems={inventoryItems}
        setInventoryItems={setInventoryItems}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'labor') {
    return renderInDesktopShell(
      <LaborPage
        projects={projects}
        employees={employees}
        records={laborRecords}
        setRecords={setLaborRecords}
        currentUser={currentUser}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'vehicle') {
    return renderInDesktopShell(
      <VehicleManagementPage
        projects={projects}
        employees={employees}
        vehicles={vehicles}
        setVehicles={setVehicles}
        vehicleUsageRecords={vehicleUsageRecords}
        setVehicleUsageRecords={setVehicleUsageRecords}
        fuelRecords={fuelRecords}
        setFuelRecords={setFuelRecords}
        vehicleExpenseRecords={vehicleExpenseRecords}
        setVehicleExpenseRecords={setVehicleExpenseRecords}
        vehicleIssueRecords={vehicleIssueRecords}
        setVehicleIssueRecords={setVehicleIssueRecords}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'toolBorrow' || currentView === 'toolReturn') {
    return renderInDesktopShell(
      <ToolManagementPage
        initialSection={currentView === 'toolReturn' ? 'returns' : 'borrow'}
        projects={projects}
        employees={employees}
        currentUser={currentUser}
        toolRecords={toolRecords}
        setToolRecords={setToolRecords}
        toolBorrowRecords={normalizedToolBorrowRecords}
        setToolBorrowRecords={setNormalizedToolBorrowRecords}
        toolReturnRecords={toolReturnRecords}
        setToolReturnRecords={setToolReturnRecords}
        lifelongToolAssignments={lifelongToolAssignments}
        setLifelongToolAssignments={setLifelongToolAssignments}
        toolResponsibilityRecords={toolResponsibilityRecords}
        setToolResponsibilityRecords={setToolResponsibilityRecords}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'accounting') {
    return renderInDesktopShell(
      <AccountingCostPage
        projects={projects}
        employees={employees}
        salaryRecords={salaryRecords}
        setSalaryRecords={setSalaryRecords}
        projectCostRecords={projectCostRecords}
        setProjectCostRecords={setProjectCostRecords}
        operatingExpenseRecords={operatingExpenseRecords}
        setOperatingExpenseRecords={setOperatingExpenseRecords}
        purchaseRecords={purchaseRecords}
        laborRecords={laborRecords}
        fuelRecords={fuelRecords}
        vehicleExpenseRecords={vehicleExpenseRecords}
        vehicleIssueRecords={vehicleIssueRecords}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (currentView === 'settings') {
    return renderInDesktopShell(
      <SystemSettingsPage
        currentUser={currentUser}
        storageKeys={BUSINESS_STORAGE_KEYS}
        onLocalContractRevenueMigrationComplete={
          handleLocalContractRevenueMigrationComplete
        }
        onClearTestData={handleClearTestData}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  if (businessConfigs[currentView]) {
    return renderInDesktopShell(
      <BusinessPage
        config={businessConfigs[currentView]}
        projects={projects}
        employees={employees}
        records={recordGroups[currentView]}
        setRecords={recordSetters[currentView]}
        onBack={() => setCurrentView('home')}
      />
    )
  }

  return renderInDesktopShell(
    <HomePage
      projects={projectRevenueProjects}
      employees={employees}
      records={recordGroups}
      accountingRecords={accountingRecords}
      currentUser={currentUser}
      onLogout={handleLogout}
      onOpenView={(view) => setCurrentView(view)}
    />
  )
}

function LoginPage({ onLogin, onRegister }) {
  const [activeTab, setActiveTab] = useState('login')
  const [formError, setFormError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loginForm, setLoginForm] = useState({ name: '', password: '' })
  const [registerForm, setRegisterForm] = useState({
    name: '',
    password: '',
    confirmPassword: '',
    phone: '',
    department: '其他',
    position: '其他',
  })

  return (
    <main className="app-shell login-shell">
      <section className="login-panel">
        <div className="login-title">
          <p className="eyebrow dark-text">独立网页版 ERP</p>
          <h1>生旺 ERP 数据中心</h1>
          <span>请输入姓名和密码登录</span>
        </div>
        <div className="login-tabs">
          <button
            className={activeTab === 'login' ? 'active' : ''}
            type="button"
            onClick={() => {
              setActiveTab('login')
              setFormError('')
            }}
          >
            登录
          </button>
          <button
            className={activeTab === 'register' ? 'active' : ''}
            type="button"
            onClick={() => {
              setActiveTab('register')
              setFormError('')
            }}
          >
            注册
          </button>
        </div>

        {activeTab === 'login' ? (
          <form
            className="login-form"
            onSubmit={async (event) => {
              event.preventDefault()
              setIsSubmitting(true)
              try {
                const result = await onLogin(loginForm)
                setFormError(result?.error || '')
              } finally {
                setIsSubmitting(false)
              }
            }}
          >
            {formError && <div className="form-error">{formError}</div>}
            <Field
              label="真实姓名"
              value={loginForm.name}
              onChange={(value) => setLoginForm({ ...loginForm, name: value })}
              required
            />
            <Field
              label="6位数字密码"
              type="password"
              value={loginForm.password}
              onChange={(value) => setLoginForm({ ...loginForm, password: value })}
              required
            />
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '处理中...' : '登录'}
            </button>
          </form>
        ) : (
          <form
            className="login-form"
            onSubmit={async (event) => {
              event.preventDefault()
              setIsSubmitting(true)
              try {
                const result = await onRegister(registerForm)
                setFormError(result?.error || '')
              } finally {
                setIsSubmitting(false)
              }
            }}
          >
            {formError && <div className="form-error">{formError}</div>}
            <Field
              label="真实姓名"
              value={registerForm.name}
              onChange={(value) => setRegisterForm({ ...registerForm, name: value })}
              required
            />
            <Field
              label="6位数字密码"
              type="password"
              value={registerForm.password}
              onChange={(value) => setRegisterForm({ ...registerForm, password: value })}
              placeholder="只能输入 6 位数字"
              required
            />
            <Field
              label="确认密码"
              type="password"
              value={registerForm.confirmPassword}
              onChange={(value) => setRegisterForm({ ...registerForm, confirmPassword: value })}
              required
            />
            <Field
              label="联系电话"
              value={registerForm.phone}
              onChange={(value) => setRegisterForm({ ...registerForm, phone: value })}
            />
            <OptionField
              label="所属部门"
              value={registerForm.department}
              onChange={(value) => setRegisterForm({ ...registerForm, department: value })}
              options={departmentOptions}
            />
            <OptionField
              label="职位"
              value={registerForm.position}
              onChange={(value) => setRegisterForm({ ...registerForm, position: value })}
              options={positionOptions}
            />
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '正在保存...' : '注册并进入 ERP'}
            </button>
            <div className="empty-state cost-note">
              自助注册默认是普通员工，需要管理员开通业务模块权限。
            </div>
          </form>
        )}
      </section>
    </main>
  )
}

function HomePage({ projects, employees, records, accountingRecords, currentUser, onLogout, onOpenView }) {
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(new Date())

  const activeProjects = projects.filter((project) => project.status === '进行中').length
  const activeEmployees = employees.filter(
    (employee) => !isHiddenSystemEmployee(employee) && employee.employmentStatus === '在职',
  ).length
  const totalRecords = Object.values(records).reduce((total, list) => total + list.length, 0)
  const pausedProjects = projects.filter((project) => project.status === '暂停').length
  const monthlyPurchaseTotal = accountingRecords.purchase
    .filter(
      (record) =>
        monthFromDate(record.purchaseDate) === currentMonthValue() &&
        record.purchaseStatus !== '作废',
    )
    .reduce((total, record) => total + toAmount(record.totalCost), 0)
  const monthlyCostTotal =
    getMonthlySalaryPaidTotal(accountingRecords.salary, employees) +
    accountingRecords.projectCost
      .filter((record) => monthFromDate(record.date) === currentMonthValue() && record.costType !== '人工费')
      .reduce((total, record) => total + toAmount(record.amount), 0) +
    accountingRecords.operatingExpense
      .filter((record) => monthFromDate(record.date) === currentMonthValue())
      .reduce((total, record) => total + toAmount(record.amount), 0)
    +
    accountingRecords.fuel
      .filter((record) => monthFromDate(record.fuelDate) === currentMonthValue())
      .reduce((total, record) => total + toAmount(record.fuelAmount), 0) +
    accountingRecords.vehicleExpense
      .filter((record) => monthFromDate(record.expenseDate) === currentMonthValue())
      .reduce((total, record) => total + toAmount(record.amount), 0) +
    accountingRecords.vehicleIssue
      .filter((record) => monthFromDate(record.issueDate) === currentMonthValue())
      .reduce((total, record) => total + toAmount(record.repairCost), 0) +
    monthlyPurchaseTotal

  const summary = [
    { value: activeProjects, label: '进行中项目' },
    { value: totalRecords, label: '业务记录' },
    { value: pausedProjects, label: '暂停项目' },
  ]

  const modules = [
    {
      title: '工程项目',
      code: 'GC',
      color: 'blue',
      count: projects.length,
      label: '项目主数据',
      view: 'projects',
    },
    {
      title: '人员管理',
      code: '人员',
      color: 'violet',
      count: activeEmployees,
      label: '员工档案・工资・身份',
      view: 'employees',
    },
    { title: '仓库库存', code: 'KC', color: 'green', count: '静态', label: '库存物料' },
    {
      title: '我要出库',
      permissionName: '材料出入库',
      code: '出库',
      color: 'orange',
      count: records.stockOut.length,
      label: '材料领用',
      view: 'stockOut',
    },
    {
      title: '我要退回',
      permissionName: '材料出入库',
      code: '退回',
      color: 'rose',
      count: records.stockReturn.length,
      label: '余料退库',
      view: 'stockReturn',
    },
    {
      title: '人工记录',
      code: 'RG',
      color: 'violet',
      count: records.labor.length,
      label: '今日出勤',
      view: 'labor',
    },
    {
      title: '车辆管理',
      code: 'CL',
      color: 'cyan',
      count: records.vehicle.length,
      label: '轨迹・费用・异常',
      view: 'vehicle',
    },
    {
      title: '借工具',
      permissionName: '工具管理',
      code: '借',
      color: 'lime',
      count: records.toolBorrow.length,
      label: '工具领用',
      view: 'toolBorrow',
    },
    {
      title: '还工具',
      permissionName: '工具管理',
      code: '还',
      color: 'green',
      count: records.toolReturn.length,
      label: '工具归还',
      view: 'toolReturn',
    },
    {
      title: '会计成本',
      code: '会计',
      color: 'blue',
      count: formatYen(monthlyCostTotal),
      label: '做账・工资・成本',
      view: 'accounting',
    },
    {
      title: '采购管理',
      code: '采购',
      color: 'orange',
      count: formatYen(monthlyPurchaseTotal),
      label: '国内・日本・关系单位',
      view: 'purchase',
    },
    {
      title: '系统设置',
      code: '设置',
      color: 'blue',
      count: isCloudDatabaseReady() ? '云端' : '本机',
      label: '云端数据库・迁移',
      view: 'settings',
    },
    {
      title: '老板驾驶舱',
      code: 'JS',
      color: 'dark',
      count: '查看',
      label: '经营看板 · 利润统计',
      view: 'dashboard',
    },
  ]
  const visibleModules = modules.filter((module) =>
    canAccessModule(currentUser, module.permissionName || module.title),
  )
  const isPendingAuthorization =
    currentUser.role === 'employee' && (currentUser.accessibleModules || []).length === 0

  return (
    <main className="app-shell">
      <section className="top-panel">
        <div className="title-row">
          <div>
            <p className="eyebrow">企业经营工作台</p>
            <h1>生旺 ERP 数据中心</h1>
            <span className="home-subtitle">工程・人员・采购・库存・成本管理</span>
          </div>
          <div className="home-user-box">
            <div className="date-pill">{today}</div>
            <span>当前用户：{currentUser.name}｜{currentUser.position}</span>
            <button className="ghost-button" type="button" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </div>

        <div className="summary-grid" aria-label="数据概览">
          {summary.map((item) => (
            <div className="summary-item" key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        {currentUser.employeeId === 'SUPER_ADMIN' && (
          <div className="system-account-panel">
            <strong>当前为系统恢复账号</strong>
            <span>状态：已启用</span>
            <span>权限：最高权限</span>
            <span>是否隐藏：是</span>
          </div>
        )}
      </section>

      <section className="module-section" aria-labelledby="module-title">
        <div className="section-heading">
          <h2 id="module-title">业务模块</h2>
          <span>今日工作台</span>
        </div>

        <div className="module-grid">
          {visibleModules.map((module) => (
            <button
              className={`module-card ${module.color}`}
              type="button"
              key={module.title}
              onClick={() => module.view && onOpenView(module.view)}
            >
              <span className="module-icon" aria-hidden="true">
                {module.code}
              </span>
              <span className="module-copy">
                <strong>{module.title}</strong>
                <small>{module.label}</small>
              </span>
              <span className="module-count">{module.count}</span>
              <span className="module-action">查看详情</span>
            </button>
          ))}
        </div>
        {visibleModules.length === 0 && (
          <div className="empty-state pending-auth-state">
            <strong>账号已创建，请联系管理员开通业务模块权限。</strong>
            <span>姓名：{currentUser.name}</span>
            <span>部门：{currentUser.department || '未填写'}</span>
            <span>职位：{currentUser.position || '未填写'}</span>
            <span>权限状态：{isPendingAuthorization ? '待授权' : '无可访问模块'}</span>
          </div>
        )}
      </section>
    </main>
  )
}

function SystemSettingsPage({
  currentUser,
  storageKeys,
  onLocalContractRevenueMigrationComplete: handleLocalContractRevenueMigrationComplete,
  onClearTestData,
  onBack,
}) {
  const [isMigrating, setIsMigrating] = useState(false)
  const [isClearing, setIsClearing] = useState(false)
  const [migrationResults, setMigrationResults] = useState([])
  const [message, setMessage] = useState('')
  const canMigrate = isSuperAdmin(currentUser)

  const handleMigration = async () => {
    if (!canMigrate) {
      window.alert('您没有权限操作此模块')
      return
    }
    if (!isCloudDatabaseReady()) {
      window.alert('请先配置 Supabase 环境变量。')
      return
    }
    const confirmed = window.confirm(
      '这是测试数据迁移功能，请确认是否上传当前浏览器数据到云端数据库。',
    )
    if (!confirmed) return

    setIsMigrating(true)
    setMessage('')
    setMigrationResults([])
    try {
      const results = await migrateLocalStorageToSupabase(storageKeys)
      setMigrationResults(results)
      const saved = results.reduce((total, item) => total + item.saved, 0)
      const failed = results.reduce((total, item) => total + item.failed, 0)
      setMessage(`迁移完成：成功 ${saved} 条，失败 ${failed} 条。`)
    } catch (error) {
      console.error('Supabase 数据迁移失败', error)
      setMessage('保存失败，请重试。')
    } finally {
      setIsMigrating(false)
    }
  }

  const handleClearTestData = async () => {
    if (!canMigrate) {
      window.alert('您没有权限操作此模块')
      return
    }

    const confirmed = window.confirm(
      '确定清空当前测试数据吗？本机和 Supabase 中的业务测试数据都会清空，只保留系统恢复账号。',
    )
    if (!confirmed) return

    setIsClearing(true)
    setMessage('正在清空测试数据...')
    try {
      await onClearTestData()
    } catch (error) {
      console.error('清空测试数据失败', error)
      setMessage('清空失败，请检查 Supabase 连接后重试。')
      setIsClearing(false)
    }
  }

  return (
    <PageShell title="系统设置" subtitle="云端数据库与数据迁移" onBack={onBack}>
      <section className="form-card">
        <div className="section-heading">
          <h2>Supabase 云端数据库</h2>
          <span>{isCloudDatabaseReady() ? '已配置' : '未配置'}</span>
        </div>
        <div className="detail-list">
          <span>业务数据：{isCloudDatabaseReady() ? '优先读取和保存到 Supabase' : '当前仍使用本机缓存'}</span>
          <span>登录状态：仍保存在本机 currentUser</span>
          <span>附件：已预留 attachments 字段，后续接 Supabase Storage</span>
        </div>
      </section>

      {currentUser.employeeId === 'SUPER_ADMIN' && (
        <section className="form-card">
          <div className="section-heading">
            <h2>系统恢复账号状态</h2>
            <span>仅当前账号可见</span>
          </div>
          <div className="detail-list">
            <span>当前为系统恢复账号</span>
            <span>权限：最高权限</span>
            <span>是否隐藏：是</span>
          </div>
        </section>
      )}

      <ContractRevenueMigrationPanel
        canExecute={canMigrate}
        onMigrationComplete={handleLocalContractRevenueMigrationComplete}
      />

      <section className="form-card">
        <div className="section-heading">
          <h2>localStorage → Supabase 数据迁移</h2>
          <span>{canMigrate ? '最高权限可用' : '无权限'}</span>
        </div>
        <div className="empty-state cost-note">
          迁移工具用于把当前浏览器已有测试数据上传到云端。迁移前请先在 Supabase SQL Editor 执行
          docs/supabase-schema.sql。
        </div>
        <div className="form-actions">
          <button
            className="primary-button"
            type="button"
            onClick={handleMigration}
            disabled={!canMigrate || isMigrating}
          >
            {isMigrating ? '迁移中...' : '上传当前浏览器数据到 Supabase'}
          </button>
        </div>
        {message && <div className="empty-state">{message}</div>}
        {migrationResults.length > 0 && (
          <div className="record-grid">
            {migrationResults.map((result) => (
              <article className="record-card" key={result.storageKey}>
                <strong>{result.storageKey}</strong>
                <span>成功：{result.saved}</span>
                <span>失败：{result.failed}</span>
                {result.errors?.length > 0 && (
                  <div className="migration-error">
                    <strong>失败原因</strong>
                    {result.errors.slice(0, 3).map((errorText) => (
                      <span key={errorText}>{errorText}</span>
                    ))}
                    {result.errors.length > 3 && <span>还有 {result.errors.length - 3} 条错误未显示。</span>}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="form-card danger-zone">
        <div className="section-heading">
          <h2>测试数据清理</h2>
          <span>上传前整理</span>
        </div>
        <div className="empty-state cost-note">
          仅用于测试阶段。会清空本机和 Supabase 中的业务测试数据，员工表只保留隐藏系统恢复账号。
        </div>
        <div className="form-actions">
          <button
            className="danger-button"
            type="button"
            onClick={handleClearTestData}
            disabled={!canMigrate || isClearing}
          >
            {isClearing ? '清空中...' : '清空测试数据'}
          </button>
        </div>
      </section>
    </PageShell>
  )
}

function PersonnelPage({ employees, setEmployees, currentUser, references, onBack }) {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [form, setForm] = useState(createEmptyEmployee)
  const [nameFilter, setNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')
  const canManagePermissions = isSuperAdmin(currentUser) && editingId !== currentUser.employeeId
  const formSalaryStandard = getSalaryStandard(form)

  const agencies = Array.from(
    new Set(employees.map((employee) => employee.visaAgency).filter(Boolean)),
  )

  const resetForm = () => {
    setForm(createEmptyEmployee())
    setEditingId('')
    setIsFormOpen(false)
  }

  const updatePosition = (position) => {
    setForm((currentForm) => ({
      ...currentForm,
      position,
      ...getPermissionDefaults(position),
    }))
  }

  const updateRole = (role) => {
    if (role === 'super_admin') {
      setForm((currentForm) => ({
        ...currentForm,
        role: 'super_admin',
        accessibleModules: ['all'],
        canCreateModules: ['all'],
        canEditModules: ['all'],
        canDeleteModules: ['all'],
        sensitivePermissions: ['all'],
      }))
      return
    }

    setForm((currentForm) => ({
      ...currentForm,
      role,
      accessibleModules: role === 'employee' ? [] : currentForm.accessibleModules.filter((item) => item !== 'all'),
      canCreateModules: role === 'employee' ? [] : currentForm.canCreateModules.filter((item) => item !== 'all'),
      canEditModules: role === 'employee' ? [] : currentForm.canEditModules.filter((item) => item !== 'all'),
      canDeleteModules: role === 'employee' ? [] : currentForm.canDeleteModules.filter((item) => item !== 'all'),
      sensitivePermissions: role === 'employee' ? [] : currentForm.sensitivePermissions.filter((item) => item !== 'all'),
    }))
  }

  const isEmployeeReferenced = (employeeId) =>
    [
      references.salaryRecords,
      references.laborRecords,
      references.stockOutRecords,
      references.stockReturnRecords,
      references.vehicleArchiveRecords,
      references.vehicleRecords,
      references.fuelRecords,
      references.vehicleExpenseRecords,
      references.vehicleIssueRecords,
      references.toolBorrowRecords,
      references.toolReturnRecords,
      references.lifelongToolAssignments,
      references.toolResponsibilityRecords,
      references.projectCostRecords,
      references.operatingExpenseRecords,
    ].some((list) =>
      list.some(
        (record) =>
          record.employeeId === employeeId || record.responsibleEmployeeId === employeeId,
      ),
    )

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!form.name.trim()) {
      window.alert('请填写员工姓名')
      return
    }

    if (form.name.trim() === '超级管理员' && editingId !== 'SUPER_ADMIN') {
      window.alert('不允许通过普通方式创建或修改系统恢复账号。')
      return
    }

    if (editingId === 'SUPER_ADMIN' && form.loginEnabled === false) {
      window.alert('系统恢复账号不能禁用。')
      return
    }

    if (
      form.employmentStatus === '离职' &&
      (references.lifelongToolAssignments || []).some(
        (assignment) =>
          assignment.employeeId === editingId &&
          !['已退回公司', '作废'].includes(assignment.responsibilityStatus),
      )
    ) {
      window.alert('该员工名下仍有工具，请处理退回、赔偿或作废。')
    }

    if (editingId) {
      const existingEmployee = employees.find((employee) => employee.employeeId === editingId)
      const protectedPermissionFields =
        existingEmployee && !canManagePermissions
          ? {
              role: existingEmployee.role,
              accessibleModules: existingEmployee.accessibleModules,
              canCreateModules: existingEmployee.canCreateModules,
              canEditModules: existingEmployee.canEditModules,
              canDeleteModules: existingEmployee.canDeleteModules,
              sensitivePermissions: existingEmployee.sensitivePermissions,
              username: existingEmployee.username,
              passwordHash: existingEmployee.passwordHash,
              loginEnabled: existingEmployee.loginEnabled,
              mustChangePassword: existingEmployee.mustChangePassword,
            }
          : {}
      const payload = normalizeEmployee({
        ...form,
        ...protectedPermissionFields,
        employeeId: editingId,
        updatedAt: todayValue(),
      })
      setEmployees((currentEmployees) =>
        currentEmployees.map((employee) => (employee.employeeId === editingId ? payload : employee)),
      )
    } else {
      const payload = normalizeEmployee({
        ...form,
        employeeId: nextId('E', employees, 'employeeId'),
        createdAt: todayValue(),
        updatedAt: todayValue(),
      })
      setEmployees((currentEmployees) => [payload, ...currentEmployees])
    }

    resetForm()
  }

  const filteredEmployees = employees.filter((employee) => {
    if (isHiddenSystemEmployee(employee)) return false
    const nameMatched = nameFilter ? employee.name.includes(nameFilter.trim()) : true
    const statusMatched = statusFilter ? employee.employmentStatus === statusFilter : true
    const agencyMatched = agencyFilter ? employee.visaAgency === agencyFilter : true
    return nameMatched && statusMatched && agencyMatched
  })

  return (
    <PageShell
      title="人员管理"
      subtitle="员工档案・工资・身份"
      onBack={onBack}
      action={
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setForm(createEmptyEmployee())
            setEditingId('')
            setIsFormOpen(true)
          }}
        >
          新增员工
        </button>
      }
    >
      {isFormOpen && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field label="姓名" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <OptionField label="性别" value={form.gender} onChange={(value) => setForm({ ...form, gender: value })} options={genderOptions} />
            <Field label="出生日期" type="date" value={form.birthDate} onChange={(value) => setForm({ ...form, birthDate: value })} />
            <Field label="国籍" value={form.nationality} onChange={(value) => setForm({ ...form, nationality: value })} />
            <OptionField label="在职状态" value={form.employmentStatus} onChange={(value) => setForm({ ...form, employmentStatus: value })} options={employmentStatusOptions} />
            <Field label="入职日期" type="date" value={form.hireDate} onChange={(value) => setForm({ ...form, hireDate: value })} />
            <Field label="离职日期" type="date" value={form.resignDate} onChange={(value) => setForm({ ...form, resignDate: value })} />
            <OptionField label="所属部门" value={form.department} onChange={(value) => setForm({ ...form, department: value })} options={departmentOptions} />
            <OptionField label="职位" value={form.position} onChange={updatePosition} options={positionOptions} />
            <OptionField label="星级" value={form.level} onChange={(value) => setForm({ ...form, level: value })} options={levelOptions} />
            <Field label="联系电话" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
            <Field label="紧急联系人" value={form.emergencyContactName} onChange={(value) => setForm({ ...form, emergencyContactName: value })} />
            <Field label="紧急联系人电话" value={form.emergencyContactPhone} onChange={(value) => setForm({ ...form, emergencyContactPhone: value })} />
            <Field label="现住址" value={form.currentAddress} onChange={(value) => setForm({ ...form, currentAddress: value })} />
            <Field label="身份办理组合/机构" value={form.visaAgency} onChange={(value) => setForm({ ...form, visaAgency: value })} />
            <Field label="在留资格" value={form.visaType} onChange={(value) => setForm({ ...form, visaType: value })} />
            <Field label="在留期限" type="date" value={form.visaExpireDate} onChange={(value) => setForm({ ...form, visaExpireDate: value })} />
            <Field label="护照号码" value={form.passportNumber} onChange={(value) => setForm({ ...form, passportNumber: value })} />
            <Field label="在留卡号码" value={form.residenceCardNumber} onChange={(value) => setForm({ ...form, residenceCardNumber: value })} />
            <OptionField label="工资类型" value={form.salaryType || '未设置'} onChange={(value) => setForm({ ...form, salaryType: value })} options={salaryTypeOptions} />
            <Field label="基本工资（月薪）" type="number" value={form.baseSalary} onChange={(value) => setForm({ ...form, baseSalary: value })} />
            <Field label="日工资（日薪）" type="number" value={form.dailySalary} onChange={(value) => setForm({ ...form, dailySalary: value })} />
            <Field label="时薪" type="number" value={form.hourlyWage} onChange={(value) => setForm({ ...form, hourlyWage: value })} />
            <ReadOnlyField label="项目分摊日工费" value={formatYen(formSalaryStandard.dailySalary)} />
            <ReadOnlyField label="项目分摊时薪" value={formatYen(formSalaryStandard.hourlyWage)} />
            <Field label="工资备注" type="textarea" value={form.salaryRemark} onChange={(value) => setForm({ ...form, salaryRemark: value })} />
            <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
          </div>
          <div className="empty-state cost-note">
            月薪人员按基本工资 / 24 天换算项目分摊日工费；项目人工成本只是分摊，不额外增加工资支出。
          </div>
          {canManagePermissions && (
            <FormGroup title="系统登录设置">
              <Field
                label="登录账号"
                value={form.username}
                onChange={(value) => setForm({ ...form, username: value })}
                placeholder="默认使用真实姓名"
              />
              <Field
                label="6位数字密码"
                type="password"
                value={form.passwordHash}
                onChange={(value) => setForm({ ...form, passwordHash: value })}
                placeholder="测试阶段暂存 6 位数字"
              />
              <OptionField
                label="登录是否启用"
                value={form.loginEnabled ? '是' : '否'}
                onChange={(value) => setForm({ ...form, loginEnabled: value === '是' })}
                options={['否', '是']}
              />
              <OptionField
                label="是否要求改密码"
                value={form.mustChangePassword ? '是' : '否'}
                onChange={(value) => setForm({ ...form, mustChangePassword: value === '是' })}
                options={['否', '是']}
              />
            </FormGroup>
          )}
          {canManagePermissions ? (
            <FormGroup title="系统权限设置">
              <label className="field">
                <span>权限角色</span>
                <select
                  value={form.role}
                  onChange={(event) => updateRole(event.target.value)}
                  disabled={['老板', '操作员'].includes(form.position)}
                >
                  {roleOptions.map((role) => (
                    <option value={role.value} key={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <PermissionCheckboxGroup
                title="可访问模块"
                options={permissionModuleOptions}
                value={form.accessibleModules}
                onChange={(value) => setForm({ ...form, accessibleModules: value })}
                disabled={form.role === 'super_admin'}
              />
              <PermissionCheckboxGroup
                title="可新增权限"
                options={permissionModuleOptions}
                value={form.canCreateModules}
                onChange={(value) => setForm({ ...form, canCreateModules: value })}
                disabled={form.role === 'super_admin'}
              />
              <PermissionCheckboxGroup
                title="可编辑权限"
                options={permissionModuleOptions}
                value={form.canEditModules}
                onChange={(value) => setForm({ ...form, canEditModules: value })}
                disabled={form.role === 'super_admin'}
              />
              <PermissionCheckboxGroup
                title="可删除权限"
                options={permissionModuleOptions}
                value={form.canDeleteModules}
                onChange={(value) => setForm({ ...form, canDeleteModules: value })}
                disabled={form.role === 'super_admin'}
              />
              <PermissionCheckboxGroup
                title="敏感数据权限"
                options={sensitivePermissionOptions}
                value={form.sensitivePermissions}
                onChange={(value) => setForm({ ...form, sensitivePermissions: value })}
                disabled={form.role === 'super_admin'}
              />
            </FormGroup>
          ) : (
            <div className="empty-state cost-note">当前用户不是最高权限，或正在编辑本人档案，不能修改系统权限设置。</div>
          )}
          <div className="form-actions">
            <button className="primary-button" type="submit">
              {editingId ? '保存修改' : '保存员工'}
            </button>
            <button className="ghost-button" type="button" onClick={resetForm}>
              取消
            </button>
          </div>
        </form>
      )}

      <div className="filter-panel">
        <Field label="按姓名搜索" value={nameFilter} onChange={setNameFilter} placeholder="输入姓名" />
        <OptionField label="在职状态" value={statusFilter} onChange={setStatusFilter} options={employmentStatusOptions} includeAll />
        <OptionField label="组合/办理机构" value={agencyFilter} onChange={setAgencyFilter} options={agencies} includeAll />
      </div>

      <div className="record-list">
        {filteredEmployees.length === 0 ? (
          <EmptyState text="暂无员工档案" />
        ) : (
          filteredEmployees.map((employee) => (
            <article className="record-card" key={employee.employeeId}>
              <div className="record-header">
                <div>
                  <strong>{employee.name}</strong>
                  <span>{employee.employeeId}</span>
                </div>
                <span className={`status-badge ${employee.employmentStatus}`}>{employee.employmentStatus}</span>
              </div>
              <dl className="detail-list compact">
                <div><dt>部门</dt><dd>{employee.department}</dd></div>
                <div><dt>职位</dt><dd>{employee.position}</dd></div>
                <div><dt>来源</dt><dd>{employee.source || '未填写'}</dd></div>
                <div><dt>登录启用</dt><dd>{employee.loginEnabled ? '已启用' : '未启用'}</dd></div>
                <div><dt>权限角色</dt><dd>{getRoleLabel(employee.role)}</dd></div>
                <div><dt>可访问模块</dt><dd>{formatPermissionCount(employee.accessibleModules)}</dd></div>
                <div><dt>可编辑模块</dt><dd>{formatPermissionCount(employee.canEditModules)}</dd></div>
                <div><dt>授权状态</dt><dd>{employee.role === 'employee' && employee.accessibleModules.length === 0 ? '待授权' : '已配置'}</dd></div>
                <div><dt>星级</dt><dd>{employee.level}</dd></div>
                <div><dt>入职日期</dt><dd>{employee.hireDate || '未填写'}</dd></div>
                <div><dt>联系电话</dt><dd>{employee.phone || '未填写'}</dd></div>
                <div><dt>现住址</dt><dd>{employee.currentAddress || '未填写'}</dd></div>
                <div><dt>办理机构</dt><dd>{employee.visaAgency || '未填写'}</dd></div>
                <div><dt>在留期限</dt><dd>{employee.visaExpireDate || '未填写'}</dd></div>
                <div><dt>工资类型</dt><dd>{employee.salaryType}</dd></div>
                <div><dt>基本工资</dt><dd>{formatYen(employee.baseSalary)}</dd></div>
                <div><dt>项目分摊日工费</dt><dd>{formatYen(employee.dailySalary)}</dd></div>
                <div><dt>项目分摊时薪</dt><dd>{formatYen(employee.hourlyWage)}</dd></div>
              </dl>
              <EmployeeOwnedTools
                employee={employee}
                assignments={references.lifelongToolAssignments || []}
                responsibilityRecords={references.toolResponsibilityRecords || []}
              />
              <RecordActions
                onEdit={() => {
                  setEditingId(employee.employeeId)
                  setForm(employee)
                  setIsFormOpen(true)
                }}
                onDelete={() => {
                  if (employee.employeeId === 'SUPER_ADMIN') {
                    window.alert('系统恢复账号不能删除。')
                    return
                  }
                  if (isEmployeeReferenced(employee.employeeId)) {
                    window.alert('该员工已有业务记录，建议改为离职状态，不建议删除。')
                    return
                  }
                  if (window.confirm('确定删除这个员工档案吗？')) {
                    setEmployees((currentEmployees) =>
                      currentEmployees.filter((item) => item.employeeId !== employee.employeeId),
                    )
                  }
                }}
              />
            </article>
          ))
        )}
      </div>
    </PageShell>
  )
}

function EmployeeOwnedTools({ employee, assignments, responsibilityRecords }) {
  const ownedTools = assignments.filter(
    (assignment) =>
      assignment.employeeId === employee.employeeId && assignment.responsibilityStatus !== '作废',
  )

  if (ownedTools.length === 0) return null

  return (
    <div className="owned-tools-panel">
      <strong>员工名下工具</strong>
      <div className="owned-tools-list">
        {ownedTools.map((assignment) => (
          <div className="owned-tool-row" key={assignment.assignmentId}>
            <span>
              {assignment.toolName}｜{assignment.specification || '未填写规格'}｜{assignment.brand || '未填写品牌'}｜{assignment.serialNumber || '无编号'}
            </span>
            <small>
              领用 {assignment.assignDate}｜价值 {formatYen(assignment.toolValue)}｜{assignment.responsibilityStatus}｜未赔偿 {formatYen(getAssignmentUnpaidCompensation(assignment.assignmentId, responsibilityRecords))}
            </small>
          </div>
        ))}
      </div>
    </div>
  )
}

function ProjectPage({
  projects,
  projectRevenueSnapshots,
  setProjects,
  onOpenContractRevenue,
  onBack,
}) {
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingProjectId, setEditingProjectId] = useState('')
  const [form, setForm] = useState(createEmptyProject)

  const resetForm = () => {
    setForm(createEmptyProject())
    setEditingProjectId('')
    setIsFormOpen(false)
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!form.projectName.trim()) {
      window.alert('请填写项目名称')
      return
    }

    if (editingProjectId) {
      const projectPayload = buildProjectPayload({ ...form, projectId: editingProjectId })
      setProjects((currentProjects) =>
        currentProjects.map((project) =>
          project.projectId === editingProjectId
            ? { ...project, ...projectPayload, projectId: editingProjectId }
            : project,
        ),
      )
    } else {
      const project = initializeOriginalContractProject(
        buildProjectPayload({
          ...form,
          projectId: nextId('P', projects, 'projectId'),
        }),
      )
      setProjects((currentProjects) => [project, ...currentProjects])
      resetForm()
      onOpenContractRevenue(project.projectId)
      return
    }

    resetForm()
  }

  const handleEdit = (project) => {
    setEditingProjectId(project.projectId)
    setForm({
      projectName: project.projectName,
      customerName: project.customerName,
      address: project.address,
      status: project.status,
      manager: project.manager,
      startDate: project.startDate,
      endDate: project.endDate,
      remark: project.remark,
    })
    setIsFormOpen(true)
  }

  const handleDelete = (projectId) => {
    if (window.confirm('确定删除这个工程项目吗？')) {
      setProjects((currentProjects) =>
        currentProjects.filter((project) => project.projectId !== projectId),
      )
    }
  }

  return (
    <PageShell
      title="工程项目"
      subtitle="项目主数据"
      onBack={onBack}
      action={
        <button
          className="primary-button"
          type="button"
          onClick={() => {
            setForm(createEmptyProject())
            setEditingProjectId('')
            setIsFormOpen(true)
          }}
        >
          新增项目
        </button>
      }
    >
      {isFormOpen && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <div className="form-grid">
            <Field
              label="项目名称"
              value={form.projectName}
              onChange={(value) => setForm({ ...form, projectName: value })}
              placeholder="例如 森下702空调安装"
              required
            />
            <Field
              label="客户名称"
              value={form.customerName}
              onChange={(value) => setForm({ ...form, customerName: value })}
              placeholder="例如 客户A"
            />
            <Field
              label="地址"
              value={form.address}
              onChange={(value) => setForm({ ...form, address: value })}
              placeholder="例如 東京都江東区森下4-17-5"
            />
            <label className="field">
              <span>项目状态</span>
              <select
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              >
                {statusOptions.map((status) => (
                  <option value={status} key={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="负责人"
              value={form.manager}
              onChange={(value) => setForm({ ...form, manager: value })}
              placeholder="例如 张三"
            />
            <Field
              label="开始日期"
              type="date"
              value={form.startDate}
              onChange={(value) => setForm({ ...form, startDate: value })}
            />
            <Field
              label="工程结束日期"
              type="date"
              value={form.endDate}
              onChange={(value) => setForm({ ...form, endDate: value })}
            />
            <Field
              label="备注"
              type="textarea"
              value={form.remark}
              onChange={(value) => setForm({ ...form, remark: value })}
              placeholder="可填写施工范围、注意事项等"
            />
          </div>

          <div className="form-actions">
            <button className="primary-button" type="submit">
              {editingProjectId ? '保存修改' : '保存项目'}
            </button>
            <button className="ghost-button" type="button" onClick={resetForm}>
              取消
            </button>
          </div>
        </form>
      )}

      <div className="record-list">
        {projects.length === 0 ? (
          <EmptyState text="暂无工程项目，请先新增项目" />
        ) : (
          projects.map((project) => {
            const displayProject = buildProjectRevenueReadModel(
              project,
              projectRevenueSnapshots.get(project.projectId),
            )

            return (
              <article className="record-card" key={project.projectId}>
                <div className="record-header">
                  <div>
                    <strong>{project.projectName}</strong>
                    <span>{project.projectId}</span>
                  </div>
                  <span className={`status-badge ${project.status}`}>{project.status}</span>
                </div>
                <dl className="detail-list">
                  <div>
                    <dt>客户</dt>
                    <dd>{project.customerName || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>地址</dt>
                    <dd>{project.address || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>负责人</dt>
                    <dd>{project.manager || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>开始日期</dt>
                    <dd>{project.startDate || '未填写'}</dd>
                  </div>
                  <div>
                    <dt>工程结束日期</dt>
                    <dd>{project.endDate || '未结束'}</dd>
                  </div>
                  <div>
                    <dt>合同金额</dt>
                    <dd>{formatYen(displayProject.adjustedTaxInclusiveAmount)}</dd>
                  </div>
                  <div>
                    <dt>已收款</dt>
                    <dd>{formatYen(displayProject.totalReceivedTaxInclusiveAmount)}</dd>
                  </div>
                  <div>
                    <dt>付款进度</dt>
                    <dd>
                      <PaymentProgress project={displayProject} />
                    </dd>
                  </div>
                  <div>
                    <dt>付款状态</dt>
                    <dd>
                      <span className={`payment-badge ${displayProject.paymentStatus}`}>
                        {displayProject.paymentStatus}
                      </span>
                    </dd>
                  </div>
                  {project.remark && (
                    <div>
                      <dt>备注</dt>
                      <dd>{project.remark}</dd>
                    </div>
                  )}
                </dl>
                <div className="record-actions">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => onOpenContractRevenue(project.projectId)}
                  >
                    合同收入
                  </button>
                  <button className="ghost-button" type="button" onClick={() => handleEdit(project)}>
                    编辑
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => handleDelete(project.projectId)}
                  >
                    删除
                  </button>
                </div>
              </article>
            )
          })
        )}
      </div>
    </PageShell>
  )
}

function BusinessPage({ config, projects, employees, records, setRecords, onBack }) {
  const [form, setForm] = useState(() => createEmptyBusinessForm(config.fields))
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const updateField = (name, value) => {
    setForm((currentForm) => ({ ...currentForm, [name]: value }))
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }

    if (!selectedProject) {
      window.alert('请选择工程项目')
      return
    }

    if (config.personField && !selectedEmployee && !form.externalPersonName.trim()) {
      window.alert(`请选择${config.personLabel}，或填写外部人员`)
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()

    const record = {
      id: nextId(config.idPrefix, records),
      projectId: selectedProject.projectId,
      projectName: selectedProject.projectName,
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
      [config.personField]: personName,
      ...form,
    }

    setRecords((currentRecords) => [record, ...currentRecords])
    setForm(createEmptyBusinessForm(config.fields))
  }

  return (
    <PageShell title={config.title} subtitle="业务记录" onBack={onBack}>
      {projects.length === 0 && <EmptyState text="请先在工程项目中新增项目" />}

      <form className="form-panel" onSubmit={handleSubmit}>
        <ProjectSelect
          projects={projects}
          value={form.projectId}
          onChange={(value) => updateField('projectId', value)}
        />
        {config.personField && (
          <EmployeeSelect
            employees={employees}
            value={form.employeeId}
            externalValue={form.externalPersonName}
            label={config.personLabel}
            onChange={(value) => updateField('employeeId', value)}
            onExternalChange={(value) => updateField('externalPersonName', value)}
            allowExternal
          />
        )}

        <div className="form-grid">
          {config.fields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              type={field.type}
              value={form[field.name]}
              onChange={(value) => updateField(field.name, value)}
              placeholder={field.placeholder}
              required={field.required}
            />
          ))}
        </div>

        <div className="form-actions">
          <button className="primary-button" type="submit">
            {config.submitText}
          </button>
        </div>
      </form>

      <div className="record-list">
        {records.length === 0 ? (
          <EmptyState text={config.emptyText} />
        ) : (
          records.map((record) => (
            <article className="record-card" key={record.id}>
              <div className="record-header">
                <div>
                  <strong>{record.projectName}</strong>
                  <span>{record.id}</span>
                </div>
              </div>
              <dl className="detail-list compact">
                {config.summaryFields.map((fieldName) => (
                  <div key={fieldName}>
                    <dt>{fieldLabel(config.fields, fieldName)}</dt>
                    <dd>{record[fieldName] || '未填写'}</dd>
                  </div>
                ))}
                {record.remark && (
                  <div>
                    <dt>备注</dt>
                    <dd>{record.remark}</dd>
                  </div>
                )}
              </dl>
            </article>
          ))
        )}
      </div>
    </PageShell>
  )
}

function LaborPage({ projects, employees, records, setRecords, currentUser, onBack }) {
  const [form, setForm] = useState(createEmptyLaborForm)
  const [editingId, setEditingId] = useState('')
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([])
  const [showAssignedEmployees, setShowAssignedEmployees] = useState(false)
  const [showAssignedList, setShowAssignedList] = useState(false)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const selectedOperator = employees.find((employee) => employee.employeeId === form.operatorId)
  const canForceRepeat = canForceLaborRepeat(currentUser)
  const assignedRecordsForDate = getAssignedLaborRecordsForDate(records, form.workDate, editingId)
  const assignedEmployeeIds = Array.from(
    new Set(assignedRecordsForDate.map((record) => record.employeeId).filter(Boolean)),
  )
  const assignmentInfoByEmployee = assignedRecordsForDate.reduce((result, record) => {
    const current = result[record.employeeId] || []
    return { ...result, [record.employeeId]: [...current, record] }
  }, {})
  const computedHours = calculateHours(form.startTime, form.endTime)
  const effectiveHours = form.workHours || computedHours || 0
  const previewEmployees = editingId
    ? selectedEmployee
      ? [selectedEmployee]
      : []
    : employees.filter((employee) => selectedEmployeeIds.includes(employee.employeeId))
  const laborCost = selectedEmployee
    ? calculateLaborCost(
        form.workType,
        selectedEmployee.dailySalary,
        selectedEmployee.hourlyWage,
        effectiveHours,
        form.laborCost,
        selectedEmployee.salaryType,
      )
    : 0

  const resetForm = () => {
    setForm(createEmptyLaborForm())
    setEditingId('')
    setSelectedEmployeeIds([])
    setShowAssignedEmployees(false)
    setShowAssignedList(false)
  }

  useEffect(() => {
    if (editingId || showAssignedEmployees) return
    setSelectedEmployeeIds((currentIds) =>
      currentIds.filter((employeeId) => !assignedEmployeeIds.includes(employeeId)),
    )
  }, [editingId, form.workDate, showAssignedEmployees, assignedEmployeeIds.join('|')])

  const handleSubmit = (event) => {
    event.preventDefault()

    if (form.workLocationType === '工程项目' && projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }

    if (form.workLocationType === '工程项目' && !selectedProject) {
      window.alert('请选择工程项目')
      return
    }

    if (editingId && !selectedEmployee) {
      window.alert('请选择员工')
      return
    }

    if (!editingId && selectedEmployeeIds.length === 0) {
      window.alert('请选择员工')
      return
    }

    if (form.workLocationType !== '工程项目' && !form.jobContent.trim() && !form.remark.trim()) {
      window.alert('非工程项目出工，请填写工作内容或备注')
      return
    }

    const targetEmployees = editingId ? [selectedEmployee] : previewEmployees
    const repeatedEmployees = targetEmployees.filter((employee) =>
      assignedEmployeeIds.includes(employee.employeeId),
    )

    if (!editingId && repeatedEmployees.length > 0) {
      const repeatedNames = repeatedEmployees.map((employee) => employee.name).join('、')
      if (!canForceRepeat) {
        window.alert(`员工${repeatedNames}当天已有出工记录，普通账号不能重复安排。`)
        return
      }
      const confirmed = window.confirm(
        `员工${repeatedNames}当天已有出工记录，确定要再次安排吗？`,
      )
      if (!confirmed) return
    }

    const batchId = editingId
      ? normalizeLaborRecord(records.find((item) => normalizeLaborRecord(item).laborRecordId === editingId) || {})
          .batchId
      : generateLaborBatchId(form.workDate, records)
    const startIndex = records.reduce((max, record) => {
      const id = normalizeLaborRecord(record).laborRecordId
      const match = id.match(/^LR(\d+)$/)
      return match ? Math.max(max, Number(match[1])) : max
    }, 0)
    const createdAt = dateTimeValue()
    const nextRecords = targetEmployees.map((employee, index) => {
      const previousRecord = editingId
        ? normalizeLaborRecord(records.find((item) => normalizeLaborRecord(item).laborRecordId === editingId) || {})
        : null
      const resolvedId = editingId || `LR${String(startIndex + index + 1).padStart(3, '0')}`
      const cost = calculateLaborCost(
        form.workType,
        employee.dailySalary,
        employee.hourlyWage,
        effectiveHours,
        form.laborCost,
        employee.salaryType,
      )

      return {
        laborRecordId: resolvedId,
        id: resolvedId,
        batchId,
        workDate: form.workDate,
        workLocationType: form.workLocationType,
        projectId: form.workLocationType === '工程项目' ? selectedProject.projectId : '',
        projectName: form.workLocationType === '工程项目' ? selectedProject.projectName : form.workLocationType,
        employeeId: employee.employeeId,
        employeeName: employee.name,
        department: employee.department,
        position: employee.position,
        level: employee.level,
        workType: form.workType,
        startTime: form.startTime,
        endTime: form.endTime,
        workHours: Number(effectiveHours) || 0,
        salaryType: employee.salaryType,
        dailySalary: employee.dailySalary,
        hourlyWage: employee.hourlyWage,
        laborCost: cost,
        jobContent: form.jobContent,
        operatorId: selectedOperator?.employeeId || '',
        operatorName: selectedOperator?.name || '',
        remark: form.remark,
        createdAt: previousRecord?.createdAt || createdAt,
        updatedAt: createdAt,
      }
    })

    for (const record of nextRecords) {
      const conflictRecords = getTimeConflictRecords(record, records)
      if (conflictRecords.length > 0) {
        if (!canForceRepeat) {
          window.alert(`员工${record.employeeName}当天该时间段已有出工记录，不能重复安排。`)
          return
        }
        const confirmed = window.confirm(
          `员工${record.employeeName}当天该时间段已有出工记录，确定要强制保存吗？`,
        )
        if (!confirmed) return
      }

      if (isLongWorkDay(record, records)) {
        window.alert(`员工${record.employeeName}当天累计工时超过12小时，请确认。`)
      }
    }

    if (editingId) {
      setRecords((currentRecords) =>
        currentRecords.map((item) =>
          normalizeLaborRecord(item).laborRecordId === editingId ? nextRecords[0] : item,
        ),
      )
    } else {
      setRecords((currentRecords) => [...nextRecords, ...currentRecords])
    }

    resetForm()
  }

  return (
    <PageShell title="人工记录" subtitle="业务记录 · 引用人员管理" onBack={onBack}>
      {employees.length === 0 && <EmptyState text="请先在人员管理中新增员工" />}

      <form className="form-panel" onSubmit={handleSubmit}>
        <OptionField
          label="工作地点类型"
          value={form.workLocationType}
          onChange={(value) => setForm({ ...form, workLocationType: value, projectId: '' })}
          options={workLocationTypeOptions}
        />
        {form.workLocationType === '工程项目' && (
          <ProjectSelect
            projects={projects}
            value={form.projectId}
            onChange={(value) => setForm({ ...form, projectId: value })}
          />
        )}
        {editingId ? (
          <EmployeeSelect
            employees={employees}
            value={form.employeeId}
            label="员工姓名"
            onChange={(value) => setForm({ ...form, employeeId: value })}
          />
        ) : (
          <>
            <EmployeeMultiSelect
              employees={employees}
              selectedIds={selectedEmployeeIds}
              onChange={setSelectedEmployeeIds}
              assignedEmployeeIds={assignedEmployeeIds}
              assignmentInfoByEmployee={assignmentInfoByEmployee}
              showAssignedEmployees={showAssignedEmployees}
            />
            {assignedEmployeeIds.length > 0 && (
              <div className="empty-state cost-note labor-assignment-note">
                <span>已隐藏当天已安排出工的员工，避免重复派工。</span>
                <strong>当天已安排：{assignedEmployeeIds.length} 人</strong>
              </div>
            )}
            <div className="form-actions split-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setShowAssignedList((value) => !value)}
              >
                查看当天已安排人员
              </button>
              <label className="toggle-line force-toggle">
                <input
                  type="checkbox"
                  checked={showAssignedEmployees}
                  onChange={(event) => {
                    const nextChecked = event.target.checked
                    setShowAssignedEmployees(nextChecked)
                    if (!nextChecked) {
                      setSelectedEmployeeIds((currentIds) =>
                        currentIds.filter((employeeId) => !assignedEmployeeIds.includes(employeeId)),
                      )
                    }
                  }}
                />
                <span>显示当天已安排员工</span>
              </label>
            </div>
            {showAssignedEmployees && !canForceRepeat && (
              <div className="empty-state cost-note">
                当前账号只能查看已安排员工，不能强制重复安排。
              </div>
            )}
            {showAssignedList && (
              <div className="record-list compact-list">
                {assignedRecordsForDate.length === 0 ? (
                  <EmptyState text="当天暂无已安排人员" />
                ) : (
                  assignedRecordsForDate.map((record) => (
                    <article className="record-card" key={record.laborRecordId}>
                      <div className="record-header">
                        <div>
                          <strong>{record.employeeName}</strong>
                          <span>{getLaborPlaceLabel(record)}｜{record.workType}</span>
                        </div>
                        <span className="amount-pill">{getLaborTimeLabel(record)}</span>
                      </div>
                      <dl className="detail-list compact">
                        <div><dt>工作内容</dt><dd>{record.jobContent || '未填写'}</dd></div>
                      </dl>
                    </article>
                  ))
                )}
              </div>
            )}
          </>
        )}
        {previewEmployees.length > 0 && (
          <dl className="detail-list compact employee-snapshot">
            {previewEmployees.map((employee) => (
              <div key={employee.employeeId}>
                <dt>{employee.name}</dt>
                <dd>{employee.department}｜{employee.position}｜{employee.level}｜{getSalaryTypeNote(employee)}</dd>
              </div>
            ))}
          </dl>
        )}
        <div className="form-grid">
          <Field label="工作日期" type="date" value={form.workDate} onChange={(value) => setForm({ ...form, workDate: value })} />
          <OptionField label="出勤类型" value={form.workType} onChange={(value) => setForm({ ...form, workType: value })} options={workTypeOptions} />
          <Field
            label="开始时间"
            type="time"
            value={form.startTime}
            onChange={(value) => {
              const hours = calculateHours(value, form.endTime)
              setForm({ ...form, startTime: value, workHours: hours || form.workHours })
            }}
          />
          <Field
            label="结束时间"
            type="time"
            value={form.endTime}
            onChange={(value) => {
              const hours = calculateHours(form.startTime, value)
              setForm({ ...form, endTime: value, workHours: hours || form.workHours })
            }}
          />
          <Field label="工作小时数" type="number" value={form.workHours} onChange={(value) => setForm({ ...form, workHours: value })} />
          {form.workType === '其他' && (
            <Field label="手动项目人工分摊" type="number" value={form.laborCost} onChange={(value) => setForm({ ...form, laborCost: value })} />
          )}
          <ReadOnlyField
            label={editingId ? '项目人工分摊' : '本次项目人工分摊合计'}
            value={formatYen(
              editingId
                ? laborCost
                : previewEmployees.reduce(
                    (total, employee) =>
                      total +
                      calculateLaborCost(
                        form.workType,
                        employee.dailySalary,
                        employee.hourlyWage,
                        effectiveHours,
                        form.laborCost,
                        employee.salaryType,
                      ),
                    0,
                  ),
            )}
          />
          <Field label="工作内容" type="textarea" value={form.jobContent} onChange={(value) => setForm({ ...form, jobContent: value })} placeholder="例如 安装空调铜管、室外机定位" />
          <EmployeeSelect
            employees={employees}
            value={form.operatorId}
            label="录入人"
            onChange={(value) => setForm({ ...form, operatorId: value })}
          />
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">
            {editingId ? '保存修改' : '保存人工记录'}
          </button>
          {editingId && (
            <button className="ghost-button" type="button" onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
      </form>

      <div className="record-list">
        {records.length === 0 ? (
          <EmptyState text="暂无人工记录" />
        ) : (
          groupLaborRecords(records).map((group) => {
            const groupTotal = group.records.reduce(
              (total, record) => total + toAmount(record.laborCost),
              0,
            )
            return (
            <article className="record-card" key={group.key}>
              <div className="record-header">
                <div>
                  <strong>{group.workDate}｜{group.projectName}｜{group.records.length}人｜{group.startTime || '--'}-{group.endTime || '--'}</strong>
                  <span>{group.batchId ? `批量录入：${group.batchId}` : '单条录入'}</span>
                </div>
                <span className="amount-pill">{formatYen(groupTotal)}</span>
              </div>
              <details className="batch-detail">
                <summary>展开人员明细</summary>
                <div className="batch-employee-list">
                  {group.records.map((record) => (
                    <div className="batch-employee-row" key={record.laborRecordId}>
                      <span>{record.employeeName}｜{record.department}｜{record.position}</span>
                      <strong>{formatYen(record.laborCost)}</strong>
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => {
                          setEditingId(record.laborRecordId)
                          setSelectedEmployeeIds([])
                          setForm({
                            projectId: record.projectId,
                            employeeId: record.employeeId,
                            operatorId: record.operatorId,
                            workLocationType: record.workLocationType,
                            workDate: record.workDate,
                            startTime: record.startTime,
                            endTime: record.endTime,
                            workType: record.workType,
                            workHours: record.workHours,
                            laborCost: record.laborCost,
                            jobContent: record.jobContent,
                            remark: record.remark,
                          })
                        }}
                      >
                        编辑
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        onClick={() => {
                          if (window.confirm('确定删除这条人工记录吗？')) {
                            setRecords((currentRecords) =>
                              currentRecords.filter(
                                (item) =>
                                  normalizeLaborRecord(item).laborRecordId !== record.laborRecordId,
                              ),
                            )
                          }
                        }}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            </article>
          )})
        )}
      </div>
    </PageShell>
  )
}

function VehicleManagementPage({
  projects,
  employees,
  vehicles,
  setVehicles,
  vehicleUsageRecords,
  setVehicleUsageRecords,
  fuelRecords,
  setFuelRecords,
  vehicleExpenseRecords,
  setVehicleExpenseRecords,
  vehicleIssueRecords,
  setVehicleIssueRecords,
  onBack,
}) {
  const [section, setSection] = useState('vehicles')
  const sections = [
    { id: 'vehicles', title: '车辆档案' },
    { id: 'usage', title: '用车记录' },
    { id: 'fuel', title: '加油记录' },
    { id: 'expenses', title: '停车/高速费用' },
    { id: 'issues', title: '异常记录' },
    { id: 'summary', title: '车辆费用汇总' },
  ]

  return (
    <PageShell title="车辆管理" subtitle="车辆轨迹・费用・项目分摊" onBack={onBack}>
      <div className="accounting-entry-grid">
        {sections.map((item) => (
          <button
            className={`accounting-entry ${section === item.id ? 'active' : ''}`}
            type="button"
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {section === 'vehicles' && (
        <VehicleArchiveSection
          employees={employees}
          vehicles={vehicles}
          setVehicles={setVehicles}
          vehicleUsageRecords={vehicleUsageRecords}
          fuelRecords={fuelRecords}
          vehicleExpenseRecords={vehicleExpenseRecords}
          vehicleIssueRecords={vehicleIssueRecords}
        />
      )}
      {section === 'usage' && (
        <VehicleUsageSection
          projects={projects}
          employees={employees}
          vehicles={vehicles}
          records={vehicleUsageRecords}
          setRecords={setVehicleUsageRecords}
          setVehicles={setVehicles}
        />
      )}
      {section === 'fuel' && (
        <VehicleFuelSection
          projects={projects}
          employees={employees}
          vehicles={vehicles}
          records={fuelRecords}
          setRecords={setFuelRecords}
        />
      )}
      {section === 'expenses' && (
        <VehicleExpenseSection
          projects={projects}
          employees={employees}
          vehicles={vehicles}
          records={vehicleExpenseRecords}
          setRecords={setVehicleExpenseRecords}
        />
      )}
      {section === 'issues' && (
        <VehicleIssueSection
          projects={projects}
          employees={employees}
          vehicles={vehicles}
          records={vehicleIssueRecords}
          setRecords={setVehicleIssueRecords}
        />
      )}
      {section === 'summary' && (
        <VehicleSummarySection
          vehicles={vehicles}
          vehicleUsageRecords={vehicleUsageRecords}
          fuelRecords={fuelRecords}
          vehicleExpenseRecords={vehicleExpenseRecords}
          vehicleIssueRecords={vehicleIssueRecords}
        />
      )}
    </PageShell>
  )
}

function VehicleArchiveSection({
  employees,
  vehicles,
  setVehicles,
  vehicleUsageRecords,
  fuelRecords,
  vehicleExpenseRecords,
  vehicleIssueRecords,
}) {
  const [form, setForm] = useState(createEmptyVehicleForm)
  const [editingId, setEditingId] = useState('')
  const responsibleEmployee = employees.find((employee) => employee.employeeId === form.responsibleEmployeeId)

  const resetForm = () => {
    setForm(createEmptyVehicleForm())
    setEditingId('')
  }

  const isReferenced = (vehicleId) =>
    [vehicleUsageRecords, fuelRecords, vehicleExpenseRecords, vehicleIssueRecords].some((list) =>
      list.some((record) => record.vehicleId === vehicleId),
    )

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!form.plateNumber.trim() || !form.vehicleName.trim()) {
      window.alert('请填写车牌号和车辆名称')
      return
    }

    const payload = normalizeVehicleRecord({
      ...form,
      vehicleId: editingId || nextId('V', vehicles, 'vehicleId'),
      responsibleEmployeeName: responsibleEmployee?.name || '',
      createdAt: vehicles.find((item) => item.vehicleId === editingId)?.createdAt || todayValue(),
      updatedAt: todayValue(),
    })

    if (editingId) {
      setVehicles((current) => current.map((item) => (item.vehicleId === editingId ? payload : item)))
    } else {
      setVehicles((current) => [payload, ...current])
    }
    resetForm()
  }

  return (
    <>
      <SectionTitle title="车辆档案" note={`${vehicles.length} 台`} />
      <form className="form-panel" onSubmit={handleSubmit}>
        <FormGroup title="基本信息">
          <Field label="车牌号" value={form.plateNumber} onChange={(value) => setForm({ ...form, plateNumber: value })} required />
          <Field label="车辆名称" value={form.vehicleName} onChange={(value) => setForm({ ...form, vehicleName: value })} required />
          <Field label="车辆类型" value={form.vehicleType} onChange={(value) => setForm({ ...form, vehicleType: value })} />
          <Field label="品牌" value={form.brand} onChange={(value) => setForm({ ...form, brand: value })} />
          <Field label="型号" value={form.model} onChange={(value) => setForm({ ...form, model: value })} />
          <OptionField label="状态" value={form.status} onChange={(value) => setForm({ ...form, status: value })} options={vehicleStatusOptions} />
          <Field label="当前总里程" type="number" value={form.currentMileage} onChange={(value) => setForm({ ...form, currentMileage: value })} />
        </FormGroup>
        <FormGroup title="车检/保险">
          <Field label="车检到期日" type="date" value={form.inspectionExpireDate} onChange={(value) => setForm({ ...form, inspectionExpireDate: value })} />
          <Field label="保险到期日" type="date" value={form.insuranceExpireDate} onChange={(value) => setForm({ ...form, insuranceExpireDate: value })} />
        </FormGroup>
        <FormGroup title="负责人">
          <EmployeeSelect employees={employees} value={form.responsibleEmployeeId} label="负责人" onChange={(value) => setForm({ ...form, responsibleEmployeeId: value })} />
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </FormGroup>
        <div className="form-actions">
          <button className="primary-button" type="submit">{editingId ? '保存车辆' : '新增车辆'}</button>
          {editingId && <button className="ghost-button" type="button" onClick={resetForm}>取消编辑</button>}
        </div>
      </form>

      <div className="record-list">
        {vehicles.length === 0 ? (
          <EmptyState text="暂无车辆档案" />
        ) : (
          vehicles.map((vehicle) => (
            <article className="record-card" key={vehicle.vehicleId}>
              <div className="record-header">
                <div>
                  <strong>{vehicle.vehicleName}｜{vehicle.plateNumber}</strong>
                  <span>{vehicle.vehicleId}</span>
                </div>
                <span className={`status-badge ${vehicle.status}`}>{vehicle.status}</span>
              </div>
              <dl className="detail-list compact">
                <div><dt>类型</dt><dd>{vehicle.vehicleType}</dd></div>
                <div><dt>品牌/型号</dt><dd>{vehicle.brand || '未填写'} {vehicle.model}</dd></div>
                <div><dt>当前里程</dt><dd>{vehicle.currentMileage} km</dd></div>
                <div><dt>车检到期</dt><dd>{vehicle.inspectionExpireDate || '未填写'}</dd></div>
                <div><dt>保险到期</dt><dd>{vehicle.insuranceExpireDate || '未填写'}</dd></div>
                <div><dt>负责人</dt><dd>{vehicle.responsibleEmployeeName || '未填写'}</dd></div>
              </dl>
              <RecordActions
                onEdit={() => {
                  setEditingId(vehicle.vehicleId)
                  setForm(vehicle)
                }}
                onDelete={() => {
                  if (isReferenced(vehicle.vehicleId)) {
                    window.alert('该车辆已有业务记录，建议改为停用，不建议删除。')
                    return
                  }
                  if (window.confirm('确定删除这个车辆档案吗？')) {
                    setVehicles((current) => current.filter((item) => item.vehicleId !== vehicle.vehicleId))
                  }
                }}
              />
            </article>
          ))
        )}
      </div>
    </>
  )
}

function VehicleUsageSection({ projects, employees, vehicles, records, setRecords, setVehicles }) {
  const [form, setForm] = useState(createEmptyVehicleUsageForm)
  const selectedVehicle = vehicles.find((vehicle) => vehicle.vehicleId === form.vehicleId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const dailyMileage =
    form.endMileage && form.startMileage ? Number(form.endMileage) - Number(form.startMileage) : 0

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!selectedVehicle) {
      window.alert('请选择车辆')
      return
    }
    if (!selectedEmployee) {
      window.alert('请选择使用人')
      return
    }
    if (form.usagePurpose === '工程项目' && projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }
    if (form.usagePurpose === '工程项目' && !selectedProject) {
      window.alert('请选择工程项目')
      return
    }
    if (form.endMileage && form.startMileage && Number(form.endMileage) < Number(form.startMileage)) {
      window.alert('返回里程不能小于出发里程')
      return
    }

    const record = normalizeVehicleUsageRecord({
      ...form,
      usageRecordId: nextId('VU', records, 'usageRecordId'),
      id: nextId('VU', records, 'usageRecordId'),
      plateNumber: selectedVehicle.plateNumber,
      vehicleName: selectedVehicle.vehicleName,
      employeeName: selectedEmployee.name,
      projectId: form.usagePurpose === '工程项目' ? selectedProject.projectId : '',
      projectName: form.usagePurpose === '工程项目' ? selectedProject.projectName : '',
      dailyMileage,
      createdAt: todayValue(),
      updatedAt: todayValue(),
    })

    setRecords((current) => [record, ...current])
    if (record.endMileage > selectedVehicle.currentMileage) {
      setVehicles((current) =>
        current.map((vehicle) =>
          vehicle.vehicleId === selectedVehicle.vehicleId
            ? { ...vehicle, currentMileage: record.endMileage, updatedAt: todayValue() }
            : vehicle,
        ),
      )
    }
    setForm(createEmptyVehicleUsageForm())
  }

  return (
    <>
      <SectionTitle title="用车记录" note={`${records.length} 条`} />
      {vehicles.length === 0 && <EmptyState text="请先在车辆档案中新增车辆" />}
      <form className="form-panel" onSubmit={handleSubmit}>
        <FormGroup title="车辆与人员">
          <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(value) => setForm({ ...form, vehicleId: value })} />
          <EmployeeSelect employees={employees} value={form.employeeId} label="使用人" onChange={(value) => setForm({ ...form, employeeId: value })} />
        </FormGroup>
        <FormGroup title="工程项目/用途">
          <OptionField label="使用目的" value={form.usagePurpose} onChange={(value) => setForm({ ...form, usagePurpose: value, projectId: value === '工程项目' ? form.projectId : '' })} options={vehicleUsagePurposeOptions} />
          {form.usagePurpose === '工程项目' && <ProjectSelect projects={projects} value={form.projectId} onChange={(value) => setForm({ ...form, projectId: value })} />}
        </FormGroup>
        <FormGroup title="时间地点">
          <Field label="使用日期" type="date" value={form.usageDate} onChange={(value) => setForm({ ...form, usageDate: value })} />
          <Field label="出发地" value={form.startLocation} onChange={(value) => setForm({ ...form, startLocation: value })} />
          <Field label="到达地" value={form.endLocation} onChange={(value) => setForm({ ...form, endLocation: value })} />
          <Field label="出发时间" type="time" value={form.startTime} onChange={(value) => setForm({ ...form, startTime: value })} />
          <Field label="返回时间" type="time" value={form.endTime} onChange={(value) => setForm({ ...form, endTime: value })} />
        </FormGroup>
        <FormGroup title="里程信息">
          <Field label="出发里程" type="number" value={form.startMileage} onChange={(value) => setForm({ ...form, startMileage: value })} />
          <Field label="返回里程" type="number" value={form.endMileage} onChange={(value) => setForm({ ...form, endMileage: value })} />
          <ReadOnlyField label="当天行驶里程" value={`${Math.max(dailyMileage, 0)} km`} />
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </FormGroup>
        <div className="form-actions"><button className="primary-button" type="submit">保存用车记录</button></div>
      </form>
      <VehicleUsageList records={records} />
    </>
  )
}

function VehicleFuelSection({ projects, employees, vehicles, records, setRecords }) {
  const [form, setForm] = useState(createEmptyFuelForm)
  const selectedVehicle = vehicles.find((vehicle) => vehicle.vehicleId === form.vehicleId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!selectedVehicle) {
      window.alert('请选择车辆')
      return
    }
    if (!selectedEmployee) {
      window.alert('请选择加油人')
      return
    }
    if (form.allocateToProject && projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }
    if (form.allocateToProject && !selectedProject) {
      window.alert('请选择工程项目')
      return
    }

    const record = normalizeFuelRecord({
      ...form,
      fuelRecordId: nextId('VF', records, 'fuelRecordId'),
      plateNumber: selectedVehicle.plateNumber,
      vehicleName: selectedVehicle.vehicleName,
      employeeName: selectedEmployee.name,
      projectName: form.allocateToProject ? selectedProject.projectName : '',
      createdAt: todayValue(),
    })
    setRecords((current) => [record, ...current])
    setForm(createEmptyFuelForm())
  }

  return (
    <>
      <SectionTitle title="加油记录" note={`${records.length} 条`} />
      <form className="form-panel" onSubmit={handleSubmit}>
        <FormGroup title="车辆与人员">
          <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(value) => setForm({ ...form, vehicleId: value })} />
          <EmployeeSelect employees={employees} value={form.employeeId} label="加油人" onChange={(value) => setForm({ ...form, employeeId: value })} />
        </FormGroup>
        <FormGroup title="加油信息">
          <Field label="加油日期" type="date" value={form.fuelDate} onChange={(value) => setForm({ ...form, fuelDate: value })} />
          <Field label="加油地点" value={form.fuelStation} onChange={(value) => setForm({ ...form, fuelStation: value })} />
          <OptionField label="加油类型" value={form.fuelType} onChange={(value) => setForm({ ...form, fuelType: value })} options={fuelTypeOptions} />
          <Field label="加油量(L)" type="number" value={form.fuelLiters} onChange={(value) => setForm({ ...form, fuelLiters: value })} />
          <Field label="当前里程" type="number" value={form.mileageAtFuel} onChange={(value) => setForm({ ...form, mileageAtFuel: value })} />
        </FormGroup>
        <FormGroup title="金额付款">
          <Field label="加油金额" type="number" value={form.fuelAmount} onChange={(value) => setForm({ ...form, fuelAmount: value })} />
          <OptionField label="付款方式" value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value })} options={paymentMethodOptions} />
        </FormGroup>
        <VehicleProjectAllocation projects={projects} form={form} setForm={setForm} />
        <FormGroup title="备注">
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </FormGroup>
        <div className="form-actions"><button className="primary-button" type="submit">保存加油记录</button></div>
      </form>
      <VehicleFinanceList records={records} amountField="fuelAmount" dateField="fuelDate" typeField="fuelType" emptyText="暂无加油记录" />
    </>
  )
}

function VehicleExpenseSection({ projects, employees, vehicles, records, setRecords }) {
  const [form, setForm] = useState(createEmptyVehicleExpenseForm)
  const selectedVehicle = vehicles.find((vehicle) => vehicle.vehicleId === form.vehicleId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!selectedVehicle) {
      window.alert('请选择车辆')
      return
    }
    if (!selectedEmployee) {
      window.alert('请选择经办人')
      return
    }
    if (form.allocateToProject && projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }
    if (form.allocateToProject && !selectedProject) {
      window.alert('请选择工程项目')
      return
    }

    const record = normalizeVehicleExpenseRecord({
      ...form,
      vehicleExpenseId: nextId('VE', records, 'vehicleExpenseId'),
      plateNumber: selectedVehicle.plateNumber,
      vehicleName: selectedVehicle.vehicleName,
      employeeName: selectedEmployee.name,
      projectName: form.allocateToProject ? selectedProject.projectName : '',
      createdAt: todayValue(),
    })
    setRecords((current) => [record, ...current])
    setForm(createEmptyVehicleExpenseForm())
  }

  return (
    <>
      <SectionTitle title="停车/高速费用" note={`${records.length} 条`} />
      <form className="form-panel" onSubmit={handleSubmit}>
        <FormGroup title="车辆与人员">
          <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(value) => setForm({ ...form, vehicleId: value })} />
          <EmployeeSelect employees={employees} value={form.employeeId} label="经办人" onChange={(value) => setForm({ ...form, employeeId: value })} />
        </FormGroup>
        <FormGroup title="费用信息">
          <Field label="日期" type="date" value={form.expenseDate} onChange={(value) => setForm({ ...form, expenseDate: value })} />
          <OptionField label="费用类型" value={form.expenseType} onChange={(value) => setForm({ ...form, expenseType: value })} options={vehicleExpenseTypeOptions} />
          <Field label="金额" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} />
          <OptionField label="付款方式" value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value })} options={paymentMethodOptions} />
        </FormGroup>
        <VehicleProjectAllocation projects={projects} form={form} setForm={setForm} />
        <FormGroup title="备注">
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </FormGroup>
        <div className="form-actions"><button className="primary-button" type="submit">保存费用记录</button></div>
      </form>
      <VehicleFinanceList records={records} amountField="amount" dateField="expenseDate" typeField="expenseType" emptyText="暂无车辆费用记录" />
    </>
  )
}

function VehicleIssueSection({ projects, employees, vehicles, records, setRecords }) {
  const [form, setForm] = useState(createEmptyVehicleIssueForm)
  const selectedVehicle = vehicles.find((vehicle) => vehicle.vehicleId === form.vehicleId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!selectedVehicle) {
      window.alert('请选择车辆')
      return
    }
    if (!selectedEmployee) {
      window.alert('请选择发现人')
      return
    }
    if (!form.issueDescription.trim()) {
      window.alert('请填写异常描述')
      return
    }
    if (form.allocateToProject && projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }
    if (form.allocateToProject && !selectedProject) {
      window.alert('请选择工程项目')
      return
    }

    const record = normalizeVehicleIssueRecord({
      ...form,
      issueId: nextId('VI', records, 'issueId'),
      plateNumber: selectedVehicle.plateNumber,
      vehicleName: selectedVehicle.vehicleName,
      employeeName: selectedEmployee.name,
      projectName: form.allocateToProject ? selectedProject.projectName : '',
      createdAt: todayValue(),
      updatedAt: todayValue(),
    })
    setRecords((current) => [record, ...current])
    setForm(createEmptyVehicleIssueForm())
  }

  return (
    <>
      <SectionTitle title="异常记录" note={`${records.length} 条`} />
      <form className="form-panel" onSubmit={handleSubmit}>
        <FormGroup title="车辆与发现人">
          <VehicleSelect vehicles={vehicles} value={form.vehicleId} onChange={(value) => setForm({ ...form, vehicleId: value })} />
          <EmployeeSelect employees={employees} value={form.employeeId} label="发现人" onChange={(value) => setForm({ ...form, employeeId: value })} />
        </FormGroup>
        <FormGroup title="异常信息">
          <Field label="发现日期" type="date" value={form.issueDate} onChange={(value) => setForm({ ...form, issueDate: value })} />
          <OptionField label="异常位置" value={form.issueLocation} onChange={(value) => setForm({ ...form, issueLocation: value })} options={vehicleIssueLocationOptions} />
          <OptionField label="严重程度" value={form.severity} onChange={(value) => setForm({ ...form, severity: value })} options={vehicleSeverityOptions} />
          <Field label="异常描述" type="textarea" value={form.issueDescription} onChange={(value) => setForm({ ...form, issueDescription: value })} required />
        </FormGroup>
        <FormGroup title="处理信息">
          <OptionField label="处理状态" value={form.issueStatus} onChange={(value) => setForm({ ...form, issueStatus: value })} options={vehicleIssueStatusOptions} />
          <Field label="处理结果" type="textarea" value={form.resolution} onChange={(value) => setForm({ ...form, resolution: value })} />
          <Field label="处理费用" type="number" value={form.repairCost} onChange={(value) => setForm({ ...form, repairCost: value })} />
          <Field label="处理日期" type="date" value={form.resolvedDate} onChange={(value) => setForm({ ...form, resolvedDate: value })} />
        </FormGroup>
        <VehicleProjectAllocation projects={projects} form={form} setForm={setForm} />
        <FormGroup title="备注">
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </FormGroup>
        <div className="form-actions"><button className="primary-button" type="submit">保存异常记录</button></div>
      </form>
      <VehicleIssueList records={records} />
    </>
  )
}

function VehicleProjectAllocation({ projects, form, setForm }) {
  return (
    <FormGroup title="项目分摊">
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={form.allocateToProject}
          onChange={(event) =>
            setForm({ ...form, allocateToProject: event.target.checked, projectId: event.target.checked ? form.projectId : '' })
          }
        />
        <span>分摊到工程项目</span>
      </label>
      {form.allocateToProject && <ProjectSelect projects={projects} value={form.projectId} onChange={(value) => setForm({ ...form, projectId: value })} />}
    </FormGroup>
  )
}

function VehicleSummarySection({ vehicles, vehicleUsageRecords, fuelRecords, vehicleExpenseRecords, vehicleIssueRecords }) {
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const usage = vehicleUsageRecords.filter((record) => monthFromDate(record.usageDate) === monthFilter)
  const fuel = fuelRecords.filter((record) => monthFromDate(record.fuelDate) === monthFilter)
  const expenses = vehicleExpenseRecords.filter((record) => monthFromDate(record.expenseDate) === monthFilter)
  const issues = vehicleIssueRecords.filter((record) => monthFromDate(record.issueDate) === monthFilter)
  const totalFuel = fuel.reduce((total, record) => total + toAmount(record.fuelAmount), 0)
  const totalExpense = expenses.reduce((total, record) => total + toAmount(record.amount), 0)
  const totalIssue = issues.reduce((total, record) => total + toAmount(record.repairCost), 0)

  return (
    <>
      <SectionTitle title="车辆费用汇总" note={monthFilter} />
      <div className="filter-panel">
        <Field label="统计月份" type="month" value={monthFilter} onChange={setMonthFilter} />
      </div>
      <div className="stats-grid">
        <div className="stat-card"><strong>{vehicles.length}</strong><span>车辆档案</span></div>
        <div className="stat-card"><strong>{usage.length}</strong><span>本月用车次数</span></div>
        <div className="stat-card"><strong>{usage.reduce((total, record) => total + (Number(record.dailyMileage) || 0), 0)} km</strong><span>本月行驶里程</span></div>
        <div className="stat-card money"><strong>{formatYen(totalFuel)}</strong><span>加油费用</span></div>
        <div className="stat-card money"><strong>{formatYen(totalExpense)}</strong><span>停车/高速/维修费用</span></div>
        <div className="stat-card money"><strong>{formatYen(totalIssue)}</strong><span>异常处理费用</span></div>
        <div className="stat-card money"><strong>{formatYen(totalFuel + totalExpense + totalIssue)}</strong><span>车辆费用合计</span></div>
        <div className="stat-card"><strong>{vehicleIssueRecords.filter((record) => record.issueStatus !== '已处理').length}</strong><span>未处理异常</span></div>
      </div>
    </>
  )
}

function VehicleUsageList({ records }) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text="暂无用车记录" />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record.usageRecordId}>
            <div className="record-header">
              <div>
                <strong>{record.usageDate}｜{record.vehicleName}｜{record.employeeName}</strong>
                <span>{record.projectName || record.usagePurpose}</span>
              </div>
              <span className="amount-pill">{record.dailyMileage} km</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>车牌</dt><dd>{record.plateNumber}</dd></div>
              <div><dt>路线</dt><dd>{record.startLocation || '未填写'} → {record.endLocation || '未填写'}</dd></div>
              <div><dt>时间</dt><dd>{record.startTime || '--'}-{record.endTime || '--'}</dd></div>
              <div><dt>里程</dt><dd>{record.startMileage} → {record.endMileage}</dd></div>
              <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function VehicleFinanceList({ records, amountField, dateField, typeField, emptyText }) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record.fuelRecordId || record.vehicleExpenseId}>
            <div className="record-header">
              <div>
                <strong>{record[dateField]}｜{record.vehicleName}｜{record[typeField]}</strong>
                <span>{record.projectName || '公司车辆成本'}</span>
              </div>
              <span className="amount-pill">{formatYen(record[amountField])}</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>车牌</dt><dd>{record.plateNumber}</dd></div>
              <div><dt>经办人</dt><dd>{record.employeeName || '未填写'}</dd></div>
              <div><dt>付款方式</dt><dd>{record.paymentMethod || '未填写'}</dd></div>
              <div><dt>项目分摊</dt><dd>{record.allocateToProject ? '是' : '否'}</dd></div>
              <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function VehicleIssueList({ records }) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text="暂无车辆异常记录" />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record.issueId}>
            <div className="record-header">
              <div>
                <strong>{record.issueDate}｜{record.vehicleName}｜{record.issueLocation}</strong>
                <span>{record.issueDescription}</span>
              </div>
              <span className={`status-badge ${record.issueStatus}`}>{record.issueStatus}</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>严重程度</dt><dd>{record.severity}</dd></div>
              <div><dt>发现人</dt><dd>{record.employeeName || '未填写'}</dd></div>
              <div><dt>处理费用</dt><dd>{formatYen(record.repairCost)}</dd></div>
              <div><dt>工程项目</dt><dd>{record.projectName || '未分摊'}</dd></div>
              <div><dt>处理结果</dt><dd>{record.resolution || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function ToolManagementPage({
  initialSection,
  projects,
  employees,
  currentUser,
  toolRecords,
  setToolRecords,
  toolBorrowRecords,
  setToolBorrowRecords,
  toolReturnRecords,
  setToolReturnRecords,
  lifelongToolAssignments,
  setLifelongToolAssignments,
  toolResponsibilityRecords,
  setToolResponsibilityRecords,
  onBack,
}) {
  const [section, setSection] = useState(initialSection || 'borrow')
  const canManageTools = isSuperAdmin(currentUser) || currentUser.canEditModules?.includes('工具管理')
  const sections = [
    { id: 'tools', title: '工具档案' },
    { id: 'borrow', title: '临时借用' },
    { id: 'returns', title: '归还工具' },
    { id: 'lifelong', title: '终身领用' },
    { id: 'holderTools', title: '员工名下工具' },
    { id: 'responsibility', title: '丢失损坏记录' },
    { id: 'summary', title: '工具汇总' },
  ]

  return (
    <PageShell title="工具管理" subtitle="临时借用・终身领用・责任记录" onBack={onBack}>
      <div className="accounting-entry-grid">
        {sections.map((item) => (
          <button
            className={`accounting-entry ${section === item.id ? 'active' : ''}`}
            type="button"
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>
      {!canManageTools && (
        <div className="empty-state cost-note">
          当前用户不是老板、操作员或工具管理授权人员，只能查看工具记录。
        </div>
      )}

      {section === 'tools' && (
        <ToolArchiveSection
          employees={employees}
          toolRecords={toolRecords}
          setToolRecords={setToolRecords}
          canManageTools={canManageTools}
        />
      )}
      {section === 'borrow' && (
        <ToolBorrowSection
          projects={projects}
          employees={employees}
          toolRecords={toolRecords}
          setToolRecords={setToolRecords}
          records={toolBorrowRecords}
          setRecords={setToolBorrowRecords}
          returnRecords={toolReturnRecords}
          assignments={lifelongToolAssignments}
          setAssignments={setLifelongToolAssignments}
          canManageTools={canManageTools}
        />
      )}
      {section === 'returns' && (
        <ToolReturnSection
          employees={employees}
          toolRecords={toolRecords}
          setToolRecords={setToolRecords}
          borrowRecords={toolBorrowRecords}
          records={toolReturnRecords}
          setRecords={setToolReturnRecords}
          canManageTools={canManageTools}
        />
      )}
      {section === 'lifelong' && (
        <LifelongToolSection
          employees={employees}
          toolRecords={toolRecords}
          setToolRecords={setToolRecords}
          assignments={lifelongToolAssignments}
          setAssignments={setLifelongToolAssignments}
          responsibilityRecords={toolResponsibilityRecords}
          canManageTools={canManageTools}
        />
      )}
      {section === 'holderTools' && (
        <EmployeeToolHolderSection
          employees={employees}
          assignments={lifelongToolAssignments}
          responsibilityRecords={toolResponsibilityRecords}
        />
      )}
      {section === 'responsibility' && (
        <ToolResponsibilitySection
          employees={employees}
          assignments={lifelongToolAssignments}
          setAssignments={setLifelongToolAssignments}
          toolRecords={toolRecords}
          setToolRecords={setToolRecords}
          records={toolResponsibilityRecords}
          setRecords={setToolResponsibilityRecords}
          canManageTools={canManageTools}
        />
      )}
      {section === 'summary' && (
        <ToolSummarySection
          toolRecords={toolRecords}
          toolBorrowRecords={toolBorrowRecords}
          assignments={lifelongToolAssignments}
          responsibilityRecords={toolResponsibilityRecords}
        />
      )}
    </PageShell>
  )
}

function ToolArchiveSection({ employees, toolRecords, setToolRecords, canManageTools }) {
  const [form, setForm] = useState(createEmptyToolForm)
  const [editingId, setEditingId] = useState('')
  const holder = employees.find((employee) => employee.employeeId === form.currentHolderEmployeeId)

  const resetForm = () => {
    setForm(createEmptyToolForm())
    setEditingId('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canManageTools) return
    if (!form.toolName.trim()) {
      window.alert('请填写工具名称')
      return
    }
    const payload = normalizeToolRecord({
      ...form,
      toolId: editingId || nextId('T', toolRecords, 'toolId'),
      currentHolderEmployeeName: holder?.name || '',
      createdAt: toolRecords.find((tool) => tool.toolId === editingId)?.createdAt || todayValue(),
      updatedAt: todayValue(),
    })

    if (editingId) {
      setToolRecords((current) => current.map((tool) => (tool.toolId === editingId ? payload : tool)))
    } else {
      setToolRecords((current) => [payload, ...current])
    }
    resetForm()
  }

  return (
    <>
      <SectionTitle title="工具档案" note={`${toolRecords.length} 件/类`} />
      {canManageTools && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <FormGroup title="工具信息">
            <Field label="工具名称" value={form.toolName} onChange={(value) => setForm({ ...form, toolName: value })} required />
            <Field label="规格" value={form.specification} onChange={(value) => setForm({ ...form, specification: value })} />
            <Field label="品牌" value={form.brand} onChange={(value) => setForm({ ...form, brand: value })} />
            <Field label="序列号/编号" value={form.serialNumber} onChange={(value) => setForm({ ...form, serialNumber: value })} />
            <Field label="分类" value={form.category} onChange={(value) => setForm({ ...form, category: value })} />
            <Field label="工具价值/购入价" type="number" value={form.purchasePrice} onChange={(value) => setForm({ ...form, purchasePrice: value })} />
            <Field label="库存数量" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
            <OptionField label="当前状态" value={form.currentStatus} onChange={(value) => setForm({ ...form, currentStatus: value })} options={toolStatusOptions} />
            <OptionField label="持有人类型" value={form.holderType} onChange={(value) => setForm({ ...form, holderType: value })} options={toolHolderTypeOptions} />
          </FormGroup>
          <FormGroup title="位置/持有人">
            <EmployeeSelect employees={employees} value={form.currentHolderEmployeeId} label="当前持有人" onChange={(value) => setForm({ ...form, currentHolderEmployeeId: value })} />
            <Field label="存放位置" value={form.storageLocation} onChange={(value) => setForm({ ...form, storageLocation: value })} />
            <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
          </FormGroup>
          <div className="form-actions">
            <button className="primary-button" type="submit">{editingId ? '保存工具' : '新增工具'}</button>
            {editingId && <button className="ghost-button" type="button" onClick={resetForm}>取消编辑</button>}
          </div>
        </form>
      )}
      <ToolRecordList
        records={toolRecords}
        onEdit={canManageTools ? (tool) => {
          setEditingId(tool.toolId)
          setForm(tool)
        } : null}
      />
    </>
  )
}

function ToolBorrowSection({
  projects,
  employees,
  toolRecords,
  setToolRecords,
  records,
  setRecords,
  returnRecords,
  assignments,
  setAssignments,
  canManageTools,
}) {
  const [form, setForm] = useState(createEmptyToolBorrowForm)
  const selectedTool = toolRecords.find((tool) => tool.toolId === form.toolId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canManageTools) return
    if (!selectedEmployee) {
      window.alert('请选择员工')
      return
    }
    if (!selectedTool) {
      window.alert('请选择工具')
      return
    }
    if (selectedTool.currentStatus === '已终身领用') {
      window.alert('该工具已终身领用，不能再临时借出。')
      return
    }

    if (form.borrowType === '终身领用') {
      const toolValue = toAmount(form.toolValue || selectedTool.purchasePrice)
      if (!toolValue) {
        window.alert('终身领用必须填写或带出工具价格')
        return
      }
      const assignment = normalizeLifelongToolAssignment({
        assignmentId: nextId('LTA', assignments, 'assignmentId'),
        toolId: selectedTool.toolId,
        toolName: selectedTool.toolName,
        specification: selectedTool.specification,
        brand: selectedTool.brand,
        serialNumber: selectedTool.serialNumber,
        employeeId: selectedEmployee.employeeId,
        employeeName: selectedEmployee.name,
        department: selectedEmployee.department,
        position: selectedEmployee.position,
        assignDate: form.date,
        toolValue,
        compensationRule: '丢失按原价赔偿，损坏按维修费用赔偿',
        remark: form.remark,
        createdAt: todayValue(),
        updatedAt: todayValue(),
      })
      setAssignments((current) => [assignment, ...current])
      setToolRecords((current) =>
        current.map((tool) =>
          tool.toolId === selectedTool.toolId
            ? {
                ...tool,
                quantity: Math.max((Number(tool.quantity) || 1) - 1, 0),
                currentStatus: '已终身领用',
                currentHolderEmployeeId: selectedEmployee.employeeId,
                currentHolderEmployeeName: selectedEmployee.name,
                holderType: '终身领用',
                updatedAt: todayValue(),
              }
            : tool,
        ),
      )
    } else {
      const record = normalizeToolBorrowRecord({
        ...form,
        id: nextId('TB', records),
        borrowRecordId: nextId('TB', records),
        toolName: selectedTool.toolName,
        specification: selectedTool.specification,
        brand: selectedTool.brand,
        serialNumber: selectedTool.serialNumber,
        toolValue: form.toolValue || selectedTool.purchasePrice,
        employeeName: selectedEmployee.name,
        borrower: selectedEmployee.name,
        projectName: selectedProject?.projectName || '',
      })
      setRecords((current) => [record, ...current])
      setToolRecords((current) =>
        current.map((tool) =>
          tool.toolId === selectedTool.toolId
            ? {
                ...tool,
                currentStatus: '临时借出',
                currentHolderEmployeeId: selectedEmployee.employeeId,
                currentHolderEmployeeName: selectedEmployee.name,
                holderType: '临时借用',
                updatedAt: todayValue(),
              }
            : tool,
        ),
      )
    }

    setForm(createEmptyToolBorrowForm())
  }

  return (
    <>
      <SectionTitle title="临时借用 / 终身领用" note="选择借用类型" />
      {toolRecords.length === 0 && <EmptyState text="请先在工具档案中新增工具" />}
      {canManageTools && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <FormGroup title="员工信息">
            <EmployeeSelect employees={employees} value={form.employeeId} label="借用/领用员工" onChange={(value) => setForm({ ...form, employeeId: value })} />
          </FormGroup>
          <FormGroup title="工具信息">
            <OptionField label="借用类型" value={form.borrowType} onChange={(value) => setForm({ ...form, borrowType: value })} options={toolBorrowTypeOptions} />
            <ToolSelect tools={toolRecords} value={form.toolId} onChange={(value) => {
              const tool = toolRecords.find((item) => item.toolId === value)
              setForm({ ...form, toolId: value, toolValue: tool?.purchasePrice || form.toolValue })
            }} />
            <Field label="数量" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
            <Field label="工具价值/赔偿参考金额" type="number" value={form.toolValue} onChange={(value) => setForm({ ...form, toolValue: value })} />
          </FormGroup>
          <FormGroup title="领用信息">
            <Field label="日期" type="date" value={form.date} onChange={(value) => setForm({ ...form, date: value })} />
            {form.borrowType === '临时借用' && (
              <Field label="预计归还日期" type="date" value={form.expectedReturnDate} onChange={(value) => setForm({ ...form, expectedReturnDate: value })} />
            )}
            {form.borrowType === '临时借用' && <ProjectSelect projects={projects} value={form.projectId} onChange={(value) => setForm({ ...form, projectId: value })} allowAll />}
          </FormGroup>
          <FormGroup title="备注">
            <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
          </FormGroup>
          <div className="form-actions">
            <button className="primary-button" type="submit">保存工具记录</button>
          </div>
        </form>
      )}
      <ToolBorrowList records={records} returnRecords={returnRecords} />
    </>
  )
}

function ToolReturnSection({ employees, toolRecords, setToolRecords, borrowRecords, records, setRecords, canManageTools }) {
  const [form, setForm] = useState({ borrowRecordId: '', employeeId: '', date: todayValue(), quantity: '1', remark: '' })
  const temporaryBorrowRecords = borrowRecords.filter((record) => record.borrowType === '临时借用')
  const returnedIds = new Set(records.map((record) => record.borrowRecordId).filter(Boolean))
  const pendingRecords = temporaryBorrowRecords.filter((record) => !returnedIds.has(record.borrowRecordId))
  const selectedBorrow = pendingRecords.find((record) => record.borrowRecordId === form.borrowRecordId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canManageTools) return
    if (!selectedBorrow) {
      window.alert('请选择待归还工具')
      return
    }
    const returnEmployee = selectedEmployee || employees.find((employee) => employee.employeeId === selectedBorrow.employeeId)
    const record = {
      id: nextId('TR', records),
      borrowRecordId: selectedBorrow.borrowRecordId,
      toolId: selectedBorrow.toolId,
      toolName: selectedBorrow.toolName,
      quantity: Number(form.quantity) || selectedBorrow.quantity,
      date: form.date,
      employeeId: returnEmployee?.employeeId || selectedBorrow.employeeId,
      employeeName: returnEmployee?.name || selectedBorrow.employeeName,
      returner: returnEmployee?.name || selectedBorrow.employeeName,
      remark: form.remark,
    }
    setRecords((current) => [record, ...current])
    setToolRecords((current) =>
      current.map((tool) =>
        tool.toolId === selectedBorrow.toolId
          ? {
              ...tool,
              currentStatus: '已归还',
              currentHolderEmployeeId: '',
              currentHolderEmployeeName: '',
              holderType: '无',
              updatedAt: todayValue(),
            }
          : tool,
      ),
    )
    setForm({ borrowRecordId: '', employeeId: '', date: todayValue(), quantity: '1', remark: '' })
  }

  return (
    <>
      <SectionTitle title="归还工具" note={`待归还 ${pendingRecords.length} 条`} />
      {canManageTools && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <label className="field full-width">
            <span>待归还工具</span>
            <select value={form.borrowRecordId} onChange={(event) => setForm({ ...form, borrowRecordId: event.target.value })}>
              <option value="">请选择待归还工具</option>
              {pendingRecords.map((record) => (
                <option value={record.borrowRecordId} key={record.borrowRecordId}>
                  {record.toolName}｜{record.employeeName}｜{record.date}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <EmployeeSelect employees={employees} value={form.employeeId} label="归还人" onChange={(value) => setForm({ ...form, employeeId: value })} />
            <Field label="归还日期" type="date" value={form.date} onChange={(value) => setForm({ ...form, date: value })} />
            <Field label="数量" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} />
            <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
          </div>
          <div className="form-actions"><button className="primary-button" type="submit">保存归还记录</button></div>
        </form>
      )}
      <ToolReturnList records={records} />
    </>
  )
}

function LifelongToolSection({ employees, toolRecords, setToolRecords, assignments, setAssignments, responsibilityRecords, canManageTools }) {
  const [form, setForm] = useState(createEmptyLifelongToolAssignmentForm)
  const selectedTool = toolRecords.find((tool) => tool.toolId === form.toolId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canManageTools) return
    if (!selectedEmployee || !selectedTool) {
      window.alert('请选择员工和工具')
      return
    }
    if (selectedTool.currentStatus === '已终身领用') {
      window.alert('同一件独立编号工具不能重复终身领用')
      return
    }
    const toolValue = toAmount(form.toolValue || selectedTool.purchasePrice)
    if (!toolValue) {
      window.alert('必须填写或带出工具价格')
      return
    }
    const assignment = normalizeLifelongToolAssignment({
      ...form,
      assignmentId: nextId('LTA', assignments, 'assignmentId'),
      toolId: selectedTool.toolId,
      toolName: selectedTool.toolName,
      specification: selectedTool.specification,
      brand: selectedTool.brand,
      serialNumber: selectedTool.serialNumber,
      employeeName: selectedEmployee.name,
      department: selectedEmployee.department,
      position: selectedEmployee.position,
      toolValue,
      createdAt: todayValue(),
      updatedAt: todayValue(),
    })
    setAssignments((current) => [assignment, ...current])
    setToolRecords((current) =>
      current.map((tool) =>
        tool.toolId === selectedTool.toolId
          ? {
              ...tool,
              quantity: Math.max((Number(tool.quantity) || 1) - 1, 0),
              currentStatus: '已终身领用',
              currentHolderEmployeeId: selectedEmployee.employeeId,
              currentHolderEmployeeName: selectedEmployee.name,
              holderType: '终身领用',
              updatedAt: todayValue(),
            }
          : tool,
      ),
    )
    setForm(createEmptyLifelongToolAssignmentForm())
  }

  return (
    <>
      <SectionTitle title="终身领用" note={`${assignments.length} 条`} />
      {canManageTools && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <FormGroup title="员工信息">
            <EmployeeSelect employees={employees} value={form.employeeId} label="领用员工" onChange={(value) => setForm({ ...form, employeeId: value })} />
          </FormGroup>
          <FormGroup title="工具信息">
            <ToolSelect tools={toolRecords} value={form.toolId} onChange={(value) => {
              const tool = toolRecords.find((item) => item.toolId === value)
              setForm({ ...form, toolId: value, toolValue: tool?.purchasePrice || form.toolValue })
            }} />
            <Field label="工具价值" type="number" value={form.toolValue} onChange={(value) => setForm({ ...form, toolValue: value })} />
          </FormGroup>
          <FormGroup title="领用信息">
            <Field label="领用日期" type="date" value={form.assignDate} onChange={(value) => setForm({ ...form, assignDate: value })} />
          </FormGroup>
          <FormGroup title="赔偿规则">
            <Field label="赔偿规则" type="textarea" value={form.compensationRule} onChange={(value) => setForm({ ...form, compensationRule: value })} />
          </FormGroup>
          <FormGroup title="备注">
            <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
          </FormGroup>
          <div className="form-actions"><button className="primary-button" type="submit">保存终身领用</button></div>
        </form>
      )}
      <LifelongAssignmentList assignments={assignments} responsibilityRecords={responsibilityRecords} />
    </>
  )
}

function EmployeeToolHolderSection({ employees, assignments, responsibilityRecords }) {
  const [filters, setFilters] = useState({ employeeId: '', department: '', position: '', status: '', query: '' })
  const filteredAssignments = assignments.filter((assignment) => {
    const employeeMatched = filters.employeeId ? assignment.employeeId === filters.employeeId : true
    const departmentMatched = filters.department ? assignment.department === filters.department : true
    const positionMatched = filters.position ? assignment.position === filters.position : true
    const statusMatched = filters.status ? assignment.responsibilityStatus === filters.status : true
    const queryMatched = filters.query ? assignment.toolName.includes(filters.query.trim()) : true
    return employeeMatched && departmentMatched && positionMatched && statusMatched && queryMatched
  })

  return (
    <>
      <SectionTitle title="员工名下工具" note={`${filteredAssignments.length} 条`} />
      <div className="filter-panel">
        <EmployeeSelect employees={employees} value={filters.employeeId} label="员工" onChange={(value) => setFilters({ ...filters, employeeId: value })} />
        <OptionField label="部门" value={filters.department} onChange={(value) => setFilters({ ...filters, department: value })} options={departmentOptions} includeAll />
        <OptionField label="职位" value={filters.position} onChange={(value) => setFilters({ ...filters, position: value })} options={positionOptions} includeAll />
        <OptionField label="责任状态" value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} options={toolResponsibilityStatusOptions} includeAll />
        <Field label="工具名称搜索" value={filters.query} onChange={(value) => setFilters({ ...filters, query: value })} />
      </div>
      <LifelongAssignmentList assignments={filteredAssignments} responsibilityRecords={responsibilityRecords} />
    </>
  )
}

function ToolResponsibilitySection({ employees, assignments, setAssignments, toolRecords, setToolRecords, records, setRecords, canManageTools }) {
  const [form, setForm] = useState(createEmptyToolResponsibilityForm)
  const selectedAssignment = assignments.find((assignment) => assignment.assignmentId === form.assignmentId)
  const handler = employees.find((employee) => employee.employeeId === form.handlerEmployeeId)

  const calculateCompensation = (issueType, toolValue, repairCost) => {
    if (issueType === '丢失') return toAmount(toolValue)
    if (issueType === '损坏') return toAmount(repairCost)
    return 0
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    if (!canManageTools) return
    if (!selectedAssignment) {
      window.alert('请选择终身领用记录')
      return
    }
    const compensationAmount =
      form.compensationAmount !== ''
        ? toAmount(form.compensationAmount)
        : calculateCompensation(form.issueType, form.toolValue || selectedAssignment.toolValue, form.repairCost)
    const record = normalizeToolResponsibilityRecord({
      ...form,
      responsibilityRecordId: nextId('TRP', records, 'responsibilityRecordId'),
      toolId: selectedAssignment.toolId,
      toolName: selectedAssignment.toolName,
      employeeId: selectedAssignment.employeeId,
      employeeName: selectedAssignment.employeeName,
      toolValue: form.toolValue || selectedAssignment.toolValue,
      compensationAmount,
      handlerEmployeeName: handler?.name || '',
      createdAt: todayValue(),
    })
    setRecords((current) => [record, ...current])
    const nextStatus =
      form.issueType === '丢失'
        ? '已丢失'
        : form.issueType === '损坏'
          ? '已损坏'
          : form.issueType === '修复'
            ? '已修复'
            : form.issueType === '赔偿'
              ? '已赔偿'
              : form.issueType === '退回公司'
                ? '已退回公司'
                : selectedAssignment.responsibilityStatus
    setAssignments((current) =>
      current.map((assignment) =>
        assignment.assignmentId === selectedAssignment.assignmentId
          ? { ...assignment, responsibilityStatus: nextStatus, updatedAt: todayValue() }
          : assignment,
      ),
    )
    if (['丢失', '损坏', '退回公司'].includes(form.issueType)) {
      setToolRecords((current) =>
        current.map((tool) =>
          tool.toolId === selectedAssignment.toolId
            ? {
                ...tool,
                currentStatus:
                  form.issueType === '丢失'
                    ? '已丢失'
                    : form.issueType === '损坏'
                      ? '已损坏'
                      : '已归还',
                currentHolderEmployeeId: form.issueType === '退回公司' ? '' : tool.currentHolderEmployeeId,
                currentHolderEmployeeName: form.issueType === '退回公司' ? '' : tool.currentHolderEmployeeName,
                holderType: form.issueType === '退回公司' ? '无' : tool.holderType,
                updatedAt: todayValue(),
              }
            : tool,
        ),
      )
    }
    setForm(createEmptyToolResponsibilityForm())
  }

  return (
    <>
      <SectionTitle title="丢失损坏记录" note={`${records.length} 条`} />
      {canManageTools && (
        <form className="form-panel" onSubmit={handleSubmit}>
          <FormGroup title="终身领用记录">
            <label className="field full-width">
              <span>员工名下工具</span>
              <select value={form.assignmentId} onChange={(event) => {
                const assignment = assignments.find((item) => item.assignmentId === event.target.value)
                setForm({
                  ...form,
                  assignmentId: event.target.value,
                  toolValue: assignment?.toolValue || '',
                  compensationAmount: calculateCompensation(form.issueType, assignment?.toolValue || '', form.repairCost),
                })
              }}>
                <option value="">请选择员工名下工具</option>
                {assignments.filter((item) => item.responsibilityStatus !== '作废').map((assignment) => (
                  <option value={assignment.assignmentId} key={assignment.assignmentId}>
                    {assignment.employeeName}｜{assignment.toolName}｜{assignment.serialNumber || '无编号'}
                  </option>
                ))}
              </select>
            </label>
          </FormGroup>
          <FormGroup title="责任信息">
            <Field label="记录日期" type="date" value={form.recordDate} onChange={(value) => setForm({ ...form, recordDate: value })} />
            <OptionField label="问题类型" value={form.issueType} onChange={(value) => setForm({ ...form, issueType: value, compensationAmount: calculateCompensation(value, form.toolValue, form.repairCost) })} options={toolIssueTypeOptions} />
            <Field label="问题说明" type="textarea" value={form.issueDescription} onChange={(value) => setForm({ ...form, issueDescription: value })} />
            <Field label="工具价值" type="number" value={form.toolValue} onChange={(value) => setForm({ ...form, toolValue: value })} />
            <Field label="修复费用" type="number" value={form.repairCost} onChange={(value) => setForm({ ...form, repairCost: value, compensationAmount: calculateCompensation(form.issueType, form.toolValue, value) })} />
            <Field label="赔偿金额" type="number" value={form.compensationAmount} onChange={(value) => setForm({ ...form, compensationAmount: value })} />
            <OptionField label="赔偿状态" value={form.compensationStatus} onChange={(value) => setForm({ ...form, compensationStatus: value })} options={compensationStatusOptions} />
          </FormGroup>
          <FormGroup title="工资扣款预留">
            <OptionField label="是否从工资扣款" value={form.deductFromSalary ? '是' : '否'} onChange={(value) => setForm({ ...form, deductFromSalary: value === '是' })} options={['否', '是']} />
            <Field label="扣款月份" type="month" value={form.salaryDeductionMonth} onChange={(value) => setForm({ ...form, salaryDeductionMonth: value })} />
            <EmployeeSelect employees={employees} value={form.handlerEmployeeId} label="处理人" onChange={(value) => setForm({ ...form, handlerEmployeeId: value })} />
            <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
          </FormGroup>
          <div className="form-actions"><button className="primary-button" type="submit">保存责任记录</button></div>
        </form>
      )}
      <ToolResponsibilityList records={records} />
    </>
  )
}

function ToolSummarySection({ toolRecords, toolBorrowRecords, assignments, responsibilityRecords }) {
  const temporaryBorrowCount = toolBorrowRecords.filter((record) => record.borrowType === '临时借用').length
  const unpaidAmount = getToolUnpaidCompensation(responsibilityRecords)

  return (
    <>
      <SectionTitle title="工具汇总" note="全部工具" />
      <div className="stats-grid">
        <div className="stat-card"><strong>{toolRecords.length}</strong><span>工具总数</span></div>
        <div className="stat-card"><strong>{toolRecords.filter((tool) => tool.currentStatus === '在库').length}</strong><span>在库工具</span></div>
        <div className="stat-card"><strong>{temporaryBorrowCount}</strong><span>临时借出</span></div>
        <div className="stat-card"><strong>{assignments.filter((item) => item.responsibilityStatus !== '作废').length}</strong><span>终身领用</span></div>
        <div className="stat-card"><strong>{assignments.filter((item) => item.responsibilityStatus === '已丢失').length}</strong><span>丢失工具</span></div>
        <div className="stat-card"><strong>{assignments.filter((item) => item.responsibilityStatus === '已损坏').length}</strong><span>损坏工具</span></div>
        <div className="stat-card money"><strong>{formatYen(unpaidAmount)}</strong><span>未赔偿金额</span></div>
      </div>
    </>
  )
}

function ToolRecordList({ records, onEdit }) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text="暂无工具档案" />
      ) : (
        records.map((tool) => (
          <article className="record-card" key={tool.toolId}>
            <div className="record-header">
              <div>
                <strong>{tool.toolName}</strong>
                <span>{tool.toolId}｜{tool.brand || '未填写品牌'}｜{tool.serialNumber || '无编号'}</span>
              </div>
              <span className={`status-badge ${tool.currentStatus}`}>{tool.currentStatus}</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>规格</dt><dd>{tool.specification || '未填写'}</dd></div>
              <div><dt>分类</dt><dd>{tool.category}</dd></div>
              <div><dt>价值</dt><dd>{formatYen(tool.purchasePrice)}</dd></div>
              <div><dt>数量</dt><dd>{tool.quantity}</dd></div>
              <div><dt>持有人</dt><dd>{tool.currentHolderEmployeeName || '无'}</dd></div>
              <div><dt>持有人类型</dt><dd>{tool.holderType}</dd></div>
              <div><dt>位置</dt><dd>{tool.storageLocation || '未填写'}</dd></div>
            </dl>
            {onEdit && (
              <div className="record-actions">
                <button className="ghost-button" type="button" onClick={() => onEdit(tool)}>编辑</button>
              </div>
            )}
          </article>
        ))
      )}
    </div>
  )
}

function ToolBorrowList({ records, returnRecords }) {
  const returnedIds = new Set(returnRecords.map((record) => record.borrowRecordId).filter(Boolean))

  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text="暂无临时借用记录" />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record.borrowRecordId || record.id}>
            <div className="record-header">
              <div>
                <strong>{record.toolName}｜{record.employeeName}</strong>
                <span>{record.borrowType}｜{record.date}</span>
              </div>
              <span className={`status-badge ${returnedIds.has(record.borrowRecordId) ? '已归还' : record.borrowType}`}>
                {record.borrowType === '临时借用'
                  ? returnedIds.has(record.borrowRecordId)
                    ? '已归还'
                    : '待归还'
                  : '终身领用'}
              </span>
            </div>
            <dl className="detail-list compact">
              <div><dt>规格</dt><dd>{record.specification || '未填写'}</dd></div>
              <div><dt>品牌</dt><dd>{record.brand || '未填写'}</dd></div>
              <div><dt>编号</dt><dd>{record.serialNumber || '无'}</dd></div>
              <div><dt>数量</dt><dd>{record.quantity}</dd></div>
              <div><dt>预计归还</dt><dd>{record.expectedReturnDate || '未填写'}</dd></div>
              <div><dt>工具价值</dt><dd>{formatYen(record.toolValue)}</dd></div>
              <div><dt>工程项目</dt><dd>{record.projectName || '未绑定'}</dd></div>
              <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function ToolReturnList({ records }) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text="暂无归还记录" />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record.id}>
            <div className="record-header">
              <div>
                <strong>{record.toolName}｜{record.employeeName}</strong>
                <span>{record.date}</span>
              </div>
              <span className="status-badge 已归还">已归还</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>数量</dt><dd>{record.quantity}</dd></div>
              <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function LifelongAssignmentList({ assignments, responsibilityRecords }) {
  return (
    <div className="record-list">
      {assignments.length === 0 ? (
        <EmptyState text="暂无终身领用工具" />
      ) : (
        assignments.map((assignment) => (
          <article className="record-card" key={assignment.assignmentId}>
            <div className="record-header">
              <div>
                <strong>{assignment.employeeName}｜{assignment.toolName}</strong>
                <span>{assignment.assignmentId}｜{assignment.assignDate}</span>
              </div>
              <span className={`status-badge ${assignment.responsibilityStatus}`}>{assignment.responsibilityStatus}</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>部门/职位</dt><dd>{assignment.department}｜{assignment.position}</dd></div>
              <div><dt>规格</dt><dd>{assignment.specification || '未填写'}</dd></div>
              <div><dt>品牌</dt><dd>{assignment.brand || '未填写'}</dd></div>
              <div><dt>序列号</dt><dd>{assignment.serialNumber || '无'}</dd></div>
              <div><dt>工具价值</dt><dd>{formatYen(assignment.toolValue)}</dd></div>
              <div><dt>未赔偿金额</dt><dd>{formatYen(getAssignmentUnpaidCompensation(assignment.assignmentId, responsibilityRecords))}</dd></div>
              <div><dt>备注</dt><dd>{assignment.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function ToolResponsibilityList({ records }) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text="暂无丢失损坏或赔偿记录" />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record.responsibilityRecordId}>
            <div className="record-header">
              <div>
                <strong>{record.employeeName}｜{record.toolName}</strong>
                <span>{record.recordDate}｜{record.issueType}</span>
              </div>
              <span className={`status-badge ${record.compensationStatus}`}>{record.compensationStatus}</span>
            </div>
            <dl className="detail-list compact">
              <div><dt>问题说明</dt><dd>{record.issueDescription || '未填写'}</dd></div>
              <div><dt>工具价值</dt><dd>{formatYen(record.toolValue)}</dd></div>
              <div><dt>修复费用</dt><dd>{formatYen(record.repairCost)}</dd></div>
              <div><dt>赔偿金额</dt><dd>{formatYen(record.compensationAmount)}</dd></div>
              <div><dt>工资扣款</dt><dd>{record.deductFromSalary ? `是｜${record.salaryDeductionMonth}` : '否'}</dd></div>
              <div><dt>处理人</dt><dd>{record.handlerEmployeeName || '未填写'}</dd></div>
              <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

function AccountingCostPage({
  projects,
  employees,
  salaryRecords,
  setSalaryRecords,
  projectCostRecords,
  setProjectCostRecords,
  operatingExpenseRecords,
  setOperatingExpenseRecords,
  purchaseRecords,
  laborRecords,
  fuelRecords,
  vehicleExpenseRecords,
  vehicleIssueRecords,
  onBack,
}) {
  const [section, setSection] = useState('salary')
  const sections = [
    { id: 'salary', title: '工资记录' },
    { id: 'projectCost', title: '项目成本' },
    { id: 'operatingExpense', title: '经营费用' },
    { id: 'monthlySummary', title: '月度汇总' },
  ]

  return (
    <PageShell title="会计成本中心" subtitle="AccountingCostCenter" onBack={onBack}>
      <div className="accounting-entry-grid">
        {sections.map((item) => (
          <button
            className={`accounting-entry ${section === item.id ? 'active' : ''}`}
            type="button"
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {section === 'salary' && (
        <SalaryRecordsSection employees={employees} records={salaryRecords} setRecords={setSalaryRecords} />
      )}
      {section === 'projectCost' && (
        <ProjectCostSection
          projects={projects}
          employees={employees}
          records={projectCostRecords}
          setRecords={setProjectCostRecords}
        />
      )}
      {section === 'operatingExpense' && (
        <OperatingExpenseSection
          projects={projects}
          employees={employees}
          records={operatingExpenseRecords}
          setRecords={setOperatingExpenseRecords}
        />
      )}
      {section === 'monthlySummary' && (
        <MonthlySummarySection
          salaryRecords={salaryRecords}
          employees={employees}
          laborRecords={laborRecords}
          projectCostRecords={projectCostRecords}
          operatingExpenseRecords={operatingExpenseRecords}
          purchaseRecords={purchaseRecords}
          fuelRecords={fuelRecords}
          vehicleExpenseRecords={vehicleExpenseRecords}
          vehicleIssueRecords={vehicleIssueRecords}
        />
      )}
    </PageShell>
  )
}

function SalaryRecordsSection({ employees, records, setRecords }) {
  const [form, setForm] = useState(createEmptySalaryForm)
  const [editingId, setEditingId] = useState('')
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const [employeeFilter, setEmployeeFilter] = useState('')
  const previewSalary = calculateNetSalary(form)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const resetForm = () => {
    setForm(createEmptySalaryForm())
    setEditingId('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!selectedEmployee) {
      window.alert('请选择员工')
      return
    }

    const payload = normalizeSalaryRecord({
      ...form,
      salaryRecordId: editingId || nextId('SR', records, 'salaryRecordId'),
      employeeId: selectedEmployee.employeeId,
      employeeName: selectedEmployee.name,
    })

    if (editingId) {
      setRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.salaryRecordId === editingId ? payload : record,
        ),
      )
    } else {
      setRecords((currentRecords) => [payload, ...currentRecords])
    }

    resetForm()
  }

  const filteredRecords = records.filter((record) => {
    const monthMatched = monthFilter ? record.salaryMonth === monthFilter : true
    const employeeMatched = employeeFilter
      ? record.employeeName.includes(employeeFilter.trim())
      : true
    return monthMatched && employeeMatched
  })

  return (
    <>
      <SectionTitle title="工资记录" note="公司级成本" />
      <form className="form-panel" onSubmit={handleSubmit}>
        <EmployeeSelect
          employees={employees}
          value={form.employeeId}
          label="员工姓名"
          onChange={(value) => {
            const employee = employees.find((item) => item.employeeId === value)
            setForm({
              ...form,
              employeeId: value,
              employeeName: employee?.name || '',
              baseSalary: employee?.baseSalary || '',
              dailySalary: employee?.dailySalary || '',
              hourlyWage: employee?.hourlyWage || '',
            })
          }}
        />
        {selectedEmployee && (
          <dl className="detail-list compact employee-snapshot">
            <div><dt>工资类型</dt><dd>{selectedEmployee.salaryType}</dd></div>
            <div><dt>月薪/基本工资</dt><dd>{formatYen(selectedEmployee.baseSalary)}</dd></div>
            <div><dt>项目分摊日工费</dt><dd>{formatYen(selectedEmployee.dailySalary)}</dd></div>
            <div><dt>项目分摊时薪</dt><dd>{formatYen(selectedEmployee.hourlyWage)}</dd></div>
          </dl>
        )}
        <div className="form-grid">
          <Field
            label="所属月份"
            type="month"
            value={form.salaryMonth}
            onChange={(value) => setForm({ ...form, salaryMonth: value })}
            required
          />
          <Field
            label="基本工资"
            type="number"
            value={form.baseSalary}
            onChange={(value) => setForm({ ...form, baseSalary: value })}
            placeholder="例如 300000"
          />
          <Field
            label="出勤天数"
            type="number"
            value={form.workDays}
            onChange={(value) => setForm({ ...form, workDays: value })}
            placeholder="例如 22"
          />
          <Field
            label="加班费"
            type="number"
            value={form.overtimePay}
            onChange={(value) => setForm({ ...form, overtimePay: value })}
            placeholder="例如 20000"
          />
          <Field
            label="奖金"
            type="number"
            value={form.bonus}
            onChange={(value) => setForm({ ...form, bonus: value })}
            placeholder="例如 10000"
          />
          <Field
            label="扣款"
            type="number"
            value={form.deduction}
            onChange={(value) => setForm({ ...form, deduction: value })}
            placeholder="例如 5000"
          />
          <ReadOnlyField label="实发工资" value={formatYen(previewSalary)} />
          <Field
            label="记录日期"
            type="date"
            value={form.createdAt}
            onChange={(value) => setForm({ ...form, createdAt: value })}
          />
          <Field
            label="备注"
            type="textarea"
            value={form.remark}
            onChange={(value) => setForm({ ...form, remark: value })}
            placeholder="可填写工资说明"
          />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">
            {editingId ? '保存修改' : '新增工资记录'}
          </button>
          {editingId && (
            <button className="ghost-button" type="button" onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
      </form>

      <div className="filter-panel">
        <Field label="按月份筛选" type="month" value={monthFilter} onChange={setMonthFilter} />
        <Field
          label="按员工姓名筛选"
          value={employeeFilter}
          onChange={setEmployeeFilter}
          placeholder="输入姓名"
        />
      </div>

      <div className="record-list">
        {filteredRecords.length === 0 ? (
          <EmptyState text="暂无工资记录" />
        ) : (
          filteredRecords.map((record) => (
            <article className="record-card" key={record.salaryRecordId}>
              <div className="record-header">
                <div>
                  <strong>{record.employeeName}</strong>
                  <span>{record.salaryRecordId}｜{record.salaryMonth}</span>
                </div>
                <span className="amount-pill">{formatYen(record.netSalary)}</span>
              </div>
              <dl className="detail-list compact">
                <div>
                  <dt>基本工资</dt>
                  <dd>{formatYen(record.baseSalary)}</dd>
                </div>
                <div>
                  <dt>出勤天数</dt>
                  <dd>{record.workDays}</dd>
                </div>
                <div>
                  <dt>加班费</dt>
                  <dd>{formatYen(record.overtimePay)}</dd>
                </div>
                <div>
                  <dt>奖金</dt>
                  <dd>{formatYen(record.bonus)}</dd>
                </div>
                <div>
                  <dt>扣款</dt>
                  <dd>{formatYen(record.deduction)}</dd>
                </div>
                <div>
                  <dt>记录日期</dt>
                  <dd>{record.createdAt}</dd>
                </div>
                {record.remark && (
                  <div>
                    <dt>备注</dt>
                    <dd>{record.remark}</dd>
                  </div>
                )}
              </dl>
              <RecordActions
                onEdit={() => {
                  setEditingId(record.salaryRecordId)
                  setForm({
                    employeeId: record.employeeId,
                    employeeName: record.employeeName,
                    salaryMonth: record.salaryMonth,
                    baseSalary: record.baseSalary,
                    workDays: record.workDays,
                    overtimePay: record.overtimePay,
                    bonus: record.bonus,
                    deduction: record.deduction,
                    remark: record.remark,
                    createdAt: record.createdAt,
                  })
                }}
                onDelete={() => {
                  if (window.confirm('确定删除这条工资记录吗？')) {
                    setRecords((currentRecords) =>
                      currentRecords.filter(
                        (item) => item.salaryRecordId !== record.salaryRecordId,
                      ),
                    )
                  }
                }}
              />
            </article>
          ))
        )}
      </div>
    </>
  )
}

function ProjectCostSection({ projects, employees, records, setRecords }) {
  const [form, setForm] = useState(createEmptyProjectCostForm)
  const [editingId, setEditingId] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const resetForm = () => {
    setForm(createEmptyProjectCostForm())
    setEditingId('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }

    if (!selectedProject) {
      window.alert('请选择工程项目')
      return
    }

    if (!selectedEmployee && !form.externalPersonName.trim()) {
      window.alert('请选择经办人，或填写外部人员')
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()

    const payload = normalizeProjectCostRecord({
      ...form,
      costRecordId: editingId || nextId('PC', records, 'costRecordId'),
      projectId: selectedProject.projectId,
      projectName: selectedProject.projectName,
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
      operator: personName,
    })

    if (editingId) {
      setRecords((currentRecords) =>
        currentRecords.map((record) => (record.costRecordId === editingId ? payload : record)),
      )
    } else {
      setRecords((currentRecords) => [payload, ...currentRecords])
    }

    resetForm()
  }

  const filteredRecords = records.filter((record) => {
    const projectMatched = projectFilter ? record.projectId === projectFilter : true
    const typeMatched = typeFilter ? record.costType === typeFilter : true
    const dateMatched = dateFilter ? record.date === dateFilter : true
    return projectMatched && typeMatched && dateMatched
  })

  return (
    <>
      <SectionTitle title="项目成本" note="必须绑定工程项目" />
      {projects.length === 0 && <EmptyState text="请先在工程项目中新增项目" />}

      <form className="form-panel" onSubmit={handleSubmit}>
        <ProjectSelect
          projects={projects}
          value={form.projectId}
          onChange={(value) => setForm({ ...form, projectId: value })}
        />
        <EmployeeSelect
          employees={employees}
          value={form.employeeId}
          externalValue={form.externalPersonName}
          label="经办人"
          onChange={(value) => setForm({ ...form, employeeId: value })}
          onExternalChange={(value) => setForm({ ...form, externalPersonName: value })}
          allowExternal
        />
        <div className="form-grid">
          <OptionField
            label="成本类型"
            value={form.costType}
            onChange={(value) => setForm({ ...form, costType: value })}
            options={costTypeOptions}
          />
          <Field
            label="金额"
            type="number"
            value={form.amount}
            onChange={(value) => setForm({ ...form, amount: value })}
            placeholder="例如 50000"
            required
          />
          <Field
            label="日期"
            type="date"
            value={form.date}
            onChange={(value) => setForm({ ...form, date: value })}
            required
          />
          <Field
            label="备注"
            type="textarea"
            value={form.remark}
            onChange={(value) => setForm({ ...form, remark: value })}
            placeholder="例如 空调铜管"
          />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">
            {editingId ? '保存修改' : '新增项目成本'}
          </button>
          {editingId && (
            <button className="ghost-button" type="button" onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
      </form>

      <div className="filter-panel">
        <ProjectSelect projects={projects} value={projectFilter} onChange={setProjectFilter} allowAll />
        <OptionField
          label="成本类型"
          value={typeFilter}
          onChange={setTypeFilter}
          options={costTypeOptions}
          includeAll
        />
        <Field label="日期" type="date" value={dateFilter} onChange={setDateFilter} />
      </div>

      <AccountingRecordList
        emptyText="暂无项目成本记录"
        records={filteredRecords}
        idField="costRecordId"
        titleField="projectName"
        amountField="amount"
        details={[
          ['成本类型', 'costType'],
          ['日期', 'date'],
          ['经办人', 'operator'],
          ['备注', 'remark'],
        ]}
        onEdit={(record) => {
          setEditingId(record.costRecordId)
          setForm({
            projectId: record.projectId,
            costType: record.costType,
            amount: record.amount,
            date: record.date,
            operator: record.operator,
            employeeId: record.employeeId || '',
            externalPersonName: record.employeeId ? '' : record.employeeName || record.operator || '',
            remark: record.remark,
          })
        }}
        onDelete={(record) => {
          if (window.confirm('确定删除这条项目成本记录吗？')) {
            setRecords((currentRecords) =>
              currentRecords.filter((item) => item.costRecordId !== record.costRecordId),
            )
          }
        }}
      />
    </>
  )
}

function OperatingExpenseSection({ projects, employees, records, setRecords }) {
  const [form, setForm] = useState(createEmptyOperatingExpenseForm)
  const [editingId, setEditingId] = useState('')
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const [typeFilter, setTypeFilter] = useState('')
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const resetForm = () => {
    setForm(createEmptyOperatingExpenseForm())
    setEditingId('')
  }

  const handleSubmit = (event) => {
    event.preventDefault()

    if (form.allocateToProject && !selectedProject) {
      window.alert('选择分摊到项目时，必须选择工程项目')
      return
    }

    if (!selectedEmployee && !form.externalPersonName.trim()) {
      window.alert('请选择经办人，或填写外部人员')
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()

    const payload = normalizeOperatingExpenseRecord({
      ...form,
      expenseRecordId: editingId || nextId('OE', records, 'expenseRecordId'),
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
      operator: personName,
      projectId: form.allocateToProject ? selectedProject.projectId : '',
      projectName: form.allocateToProject ? selectedProject.projectName : '',
    })

    if (editingId) {
      setRecords((currentRecords) =>
        currentRecords.map((record) =>
          record.expenseRecordId === editingId ? payload : record,
        ),
      )
    } else {
      setRecords((currentRecords) => [payload, ...currentRecords])
    }

    resetForm()
  }

  const filteredRecords = records.filter((record) => {
    const monthMatched = monthFilter ? monthFromDate(record.date) === monthFilter : true
    const typeMatched = typeFilter ? record.expenseType === typeFilter : true
    return monthMatched && typeMatched
  })

  return (
    <>
      <SectionTitle title="经营费用" note="公司日常费用" />
      <form className="form-panel" onSubmit={handleSubmit}>
        <div className="form-grid">
          <OptionField
            label="费用类型"
            value={form.expenseType}
            onChange={(value) => setForm({ ...form, expenseType: value })}
            options={expenseTypeOptions}
          />
          <Field
            label="金额"
            type="number"
            value={form.amount}
            onChange={(value) => setForm({ ...form, amount: value })}
            placeholder="例如 80000"
            required
          />
          <Field
            label="日期"
            type="date"
            value={form.date}
            onChange={(value) => setForm({ ...form, date: value })}
            required
          />
          <EmployeeSelect
            employees={employees}
            value={form.employeeId}
            externalValue={form.externalPersonName}
            label="经办人"
            onChange={(value) => setForm({ ...form, employeeId: value })}
            onExternalChange={(value) => setForm({ ...form, externalPersonName: value })}
            allowExternal
          />
          <OptionField
            label="是否分摊到项目"
            value={form.allocateToProject ? '是' : '否'}
            onChange={(value) =>
              setForm({ ...form, allocateToProject: value === '是', projectId: '' })
            }
            options={['否', '是']}
          />
        </div>
        {form.allocateToProject && (
          <ProjectSelect
            projects={projects}
            value={form.projectId}
            onChange={(value) => setForm({ ...form, projectId: value })}
          />
        )}
        <div className="form-grid">
          <Field
            label="备注"
            type="textarea"
            value={form.remark}
            onChange={(value) => setForm({ ...form, remark: value })}
            placeholder="可填写费用说明"
          />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">
            {editingId ? '保存修改' : '新增经营费用'}
          </button>
          {editingId && (
            <button className="ghost-button" type="button" onClick={resetForm}>
              取消编辑
            </button>
          )}
        </div>
      </form>

      <div className="filter-panel">
        <Field label="按月份筛选" type="month" value={monthFilter} onChange={setMonthFilter} />
        <OptionField
          label="费用类型"
          value={typeFilter}
          onChange={setTypeFilter}
          options={expenseTypeOptions}
          includeAll
        />
      </div>

      <AccountingRecordList
        emptyText="暂无经营费用记录"
        records={filteredRecords}
        idField="expenseRecordId"
        titleField="expenseType"
        amountField="amount"
        details={[
          ['日期', 'date'],
          ['经办人', 'operator'],
          ['分摊项目', 'projectName'],
          ['备注', 'remark'],
        ]}
        onEdit={(record) => {
          setEditingId(record.expenseRecordId)
          setForm({
            expenseType: record.expenseType,
            amount: record.amount,
            date: record.date,
            operator: record.operator,
            employeeId: record.employeeId || '',
            externalPersonName: record.employeeId ? '' : record.employeeName || record.operator || '',
            allocateToProject: record.allocateToProject,
            projectId: record.projectId,
            remark: record.remark,
          })
        }}
        onDelete={(record) => {
          if (window.confirm('确定删除这条经营费用记录吗？')) {
            setRecords((currentRecords) =>
              currentRecords.filter((item) => item.expenseRecordId !== record.expenseRecordId),
            )
          }
        }}
      />
    </>
  )
}

function MonthlySummarySection({
  salaryRecords,
  employees,
  laborRecords,
  projectCostRecords,
  operatingExpenseRecords,
  purchaseRecords,
  fuelRecords,
  vehicleExpenseRecords,
  vehicleIssueRecords,
}) {
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const laborAllocationInfo = getLaborAllocationInfo(salaryRecords, employees, laborRecords, monthFilter)
  const totalSalary = laborAllocationInfo.salaryPaidTotal
  const totalProjectCost = projectCostRecords
    .filter((record) => monthFromDate(record.date) === monthFilter)
    .reduce((total, record) => total + toAmount(record.amount), 0)
  const companyProjectCost = projectCostRecords
    .filter((record) => monthFromDate(record.date) === monthFilter && record.costType !== '人工费')
    .reduce((total, record) => total + toAmount(record.amount), 0)
  const totalOperatingExpense = operatingExpenseRecords
    .filter((record) => monthFromDate(record.date) === monthFilter)
    .reduce((total, record) => total + toAmount(record.amount), 0)
  const monthlyPurchases = purchaseRecords.filter(
    (record) => monthFromDate(record.purchaseDate) === monthFilter && record.purchaseStatus !== '作废',
  )
  const totalPurchaseCost = monthlyPurchases.reduce(
    (total, record) => total + toAmount(record.totalCost),
    0,
  )
  const purchaseBySource = (source) =>
    monthlyPurchases
      .filter((record) => record.purchaseSource === source)
      .reduce((total, record) => total + toAmount(record.totalCost), 0)
  const unpaidPurchaseCost = monthlyPurchases.reduce(
    (total, record) => total + toAmount(record.unpaidAmount),
    0,
  )
  const paidPurchaseCost = monthlyPurchases.reduce(
    (total, record) => total + toAmount(record.paidAmount),
    0,
  )
  const monthlyFuelRecords = fuelRecords.filter((record) => monthFromDate(record.fuelDate) === monthFilter)
  const monthlyVehicleExpenses = vehicleExpenseRecords.filter(
    (record) => monthFromDate(record.expenseDate) === monthFilter,
  )
  const monthlyVehicleIssues = vehicleIssueRecords.filter(
    (record) => monthFromDate(record.issueDate) === monthFilter,
  )
  const totalFuelCost = monthlyFuelRecords.reduce((total, record) => total + toAmount(record.fuelAmount), 0)
  const totalParkingTollCost = monthlyVehicleExpenses
    .filter((record) => ['停车费', '高速费', 'ETC'].includes(record.expenseType))
    .reduce((total, record) => total + toAmount(record.amount), 0)
  const totalVehicleMaintenanceCost =
    monthlyVehicleExpenses
      .filter((record) => ['维修费', '保养费', '车检费', '保险费'].includes(record.expenseType))
      .reduce((total, record) => total + toAmount(record.amount), 0) +
    monthlyVehicleIssues.reduce((total, record) => total + toAmount(record.repairCost), 0)
  const totalVehicleCost =
    totalFuelCost +
    monthlyVehicleExpenses.reduce((total, record) => total + toAmount(record.amount), 0) +
    monthlyVehicleIssues.reduce((total, record) => total + toAmount(record.repairCost), 0)
  const totalCost =
    totalSalary + companyProjectCost + totalOperatingExpense + totalPurchaseCost + totalVehicleCost

  return (
    <>
      <SectionTitle title="月度汇总" note={monthFilter} />
      <div className="filter-panel">
        <Field label="统计月份" type="month" value={monthFilter} onChange={setMonthFilter} />
      </div>
      <div className="stats-grid">
        <div className="stat-card money">
          <strong>{formatYen(totalSalary)}</strong>
          <span>本月工资发放</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(laborAllocationInfo.allocatedLaborCostTotal)}</strong>
          <span>本月项目人工分摊</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(laborAllocationInfo.unallocatedLaborCost)}</strong>
          <span>本月未分摊人工成本</span>
        </div>
        <div className="stat-card">
          <strong>{formatPercent(laborAllocationInfo.laborAllocationRate)}</strong>
          <span>项目人工分摊率</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalProjectCost)}</strong>
          <span>项目成本记录合计</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalOperatingExpense)}</strong>
          <span>经营费用合计</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalPurchaseCost)}</strong>
          <span>采购金额合计</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalVehicleCost)}</strong>
          <span>车辆费用合计</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalCost)}</strong>
          <span>公司总成本</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(purchaseBySource('中国采购'))}</strong>
          <span>中国采购金额</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(purchaseBySource('Amazon'))}</strong>
          <span>Amazon 采购金额</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(purchaseBySource('Yahoo拍卖'))}</strong>
          <span>Yahoo拍卖采购金额</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(purchaseBySource('东鹏株式会社'))}</strong>
          <span>东鹏株式会社采购金额</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(unpaidPurchaseCost)}</strong>
          <span>未付款采购金额</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(paidPurchaseCost)}</strong>
          <span>已付款采购金额</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalFuelCost)}</strong>
          <span>加油费用</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalParkingTollCost)}</strong>
          <span>停车/高速费用</span>
        </div>
        <div className="stat-card money">
          <strong>{formatYen(totalVehicleMaintenanceCost)}</strong>
          <span>维修/保养/车检/保险</span>
        </div>
      </div>
      <div className="empty-state cost-note">工资发放是公司实际支出；项目人工成本是工资向工程项目的分摊，不重复计入公司总成本。采购支出、绑定项目的车辆费用已计入项目成本统计时，请避免再手工重复录入同一笔费用。</div>
      {laborAllocationInfo.isOverAllocated && (
        <div className="empty-state cost-note warning-note">
          项目人工分摊成本超过工资发放总额，请检查人工记录是否重复或工资标准是否错误。
        </div>
      )}
    </>
  )
}

function AccountingRecordList({
  records,
  emptyText,
  idField,
  titleField,
  amountField,
  details,
  onEdit,
  onDelete,
}) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        records.map((record) => (
          <article className="record-card" key={record[idField]}>
            <div className="record-header">
              <div>
                <strong>{record[titleField] || '未填写'}</strong>
                <span>{record[idField]}</span>
              </div>
              <span className="amount-pill">{formatYen(record[amountField])}</span>
            </div>
            <dl className="detail-list compact">
              {details.map(([label, field]) => (
                <div key={field}>
                  <dt>{label}</dt>
                  <dd>{record[field] || '未填写'}</dd>
                </div>
              ))}
            </dl>
            <RecordActions onEdit={() => onEdit(record)} onDelete={() => onDelete(record)} />
          </article>
        ))
      )}
    </div>
  )
}

function RecordActions({ onEdit, onDelete }) {
  return (
    <div className="record-actions">
      <button className="ghost-button" type="button" onClick={onEdit}>
        编辑
      </button>
      <button className="danger-button" type="button" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

function PurchaseManagementPage({
  projects,
  employees,
  purchaseRecords,
  setPurchaseRecords,
  purchasePaymentRecords,
  setPurchasePaymentRecords,
  stockInRecords,
  setStockInRecords,
  inventoryItems,
  setInventoryItems,
  onBack,
}) {
  const [section, setSection] = useState('create')
  const sections = [
    { id: 'create', title: '新增采购' },
    { id: 'list', title: '采购列表' },
    { id: 'stockIn', title: '到货入库' },
    { id: 'payment', title: '付款记录' },
    { id: 'summary', title: '采购汇总' },
  ]

  return (
    <PageShell title="采购管理" subtitle="国内・日本・关系单位" onBack={onBack}>
      <div className="accounting-entry-grid">
        {sections.map((item) => (
          <button
            className={`accounting-entry ${section === item.id ? 'active' : ''}`}
            type="button"
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {section === 'create' && (
        <PurchaseFormSection
          projects={projects}
          employees={employees}
          records={purchaseRecords}
          setRecords={setPurchaseRecords}
        />
      )}
      {section === 'list' && (
        <PurchaseListSection
          projects={projects}
          records={purchaseRecords}
          setRecords={setPurchaseRecords}
          paymentRecords={purchasePaymentRecords}
          stockInRecords={stockInRecords}
        />
      )}
      {section === 'stockIn' && (
        <PurchaseStockInSection
          employees={employees}
          purchaseRecords={purchaseRecords}
          setPurchaseRecords={setPurchaseRecords}
          stockInRecords={stockInRecords}
          setStockInRecords={setStockInRecords}
          inventoryItems={inventoryItems}
          setInventoryItems={setInventoryItems}
        />
      )}
      {section === 'payment' && (
        <PurchasePaymentSection
          employees={employees}
          purchaseRecords={purchaseRecords}
          setPurchaseRecords={setPurchaseRecords}
          records={purchasePaymentRecords}
          setRecords={setPurchasePaymentRecords}
        />
      )}
      {section === 'summary' && (
        <PurchaseSummarySection
          purchaseRecords={purchaseRecords}
          stockInRecords={stockInRecords}
          inventoryItems={inventoryItems}
        />
      )}
    </PageShell>
  )
}

function PurchaseFormSection({ projects, employees, records, setRecords }) {
  const [form, setForm] = useState(createEmptyPurchaseForm)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const amountPreview = calculatePurchaseAmounts(form)

  const handleSubmit = (event) => {
    event.preventDefault()

    if (form.purchasePurpose === '项目使用' && projects.length === 0) {
      window.alert('请先在工程项目中新增项目')
      return
    }

    if (form.purchasePurpose === '项目使用' && !selectedProject) {
      window.alert('采购用途为项目使用时，必须选择工程项目')
      return
    }

    if (form.currency === 'CNY' && !(Number(form.exchangeRate) > 0)) {
      window.alert('人民币采购必须填写汇率')
      return
    }

    if (!selectedEmployee && !form.externalPersonName.trim()) {
      window.alert('请选择经办人，或填写外部人员')
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()
    const purchase = normalizePurchaseRecord({
      ...form,
      purchaseId: nextId('PO', records, 'purchaseId'),
      projectId: selectedProject?.projectId || '',
      projectName: selectedProject?.projectName || '',
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
      createdAt: todayValue(),
      updatedAt: todayValue(),
    })

    setRecords((currentRecords) => [purchase, ...currentRecords])
    setForm(createEmptyPurchaseForm())
  }

  return (
    <>
      <SectionTitle title="新增采购" note="形成采购成本" />
      <form className="form-panel" onSubmit={handleSubmit}>
        <FormGroup title="基本信息">
          <Field label="采购日期" type="date" value={form.purchaseDate} onChange={(value) => setForm({ ...form, purchaseDate: value })} required />
          <OptionField label="采购来源" value={form.purchaseSource} onChange={(value) => setForm({ ...form, purchaseSource: value })} options={purchaseSourceOptions} />
          <Field label="供应商" value={form.supplierName} onChange={(value) => setForm({ ...form, supplierName: value })} placeholder="例如 广东某材料厂" />
          <OptionField label="采购平台" value={form.platform} onChange={(value) => setForm({ ...form, platform: value })} options={purchasePlatformOptions} />
          <EmployeeSelect
            employees={employees}
            value={form.employeeId}
            externalValue={form.externalPersonName}
            label="经办人"
            onChange={(value) => setForm({ ...form, employeeId: value })}
            onExternalChange={(value) => setForm({ ...form, externalPersonName: value })}
            allowExternal
          />
        </FormGroup>

        <FormGroup title="商品信息">
          <OptionField label="采购类型" value={form.purchaseType} onChange={(value) => setForm({ ...form, purchaseType: value })} options={purchaseTypeOptions} />
          <Field label="商品名称" value={form.itemName} onChange={(value) => setForm({ ...form, itemName: value })} placeholder="例如 空调铜管" required />
          <Field label="商品规格" value={form.specification} onChange={(value) => setForm({ ...form, specification: value })} placeholder="例如 3分5分 20米" />
          <Field label="数量" type="number" value={form.quantity} onChange={(value) => setForm({ ...form, quantity: value })} required />
          <Field label="单位" value={form.unit} onChange={(value) => setForm({ ...form, unit: value })} placeholder="例如 卷" />
        </FormGroup>

        <FormGroup title="金额信息">
          <Field label="单价" type="number" value={form.unitPrice} onChange={(value) => setForm({ ...form, unitPrice: value })} required />
          <OptionField label="币种" value={form.currency} onChange={(value) => setForm({ ...form, currency: value })} options={currencyOptions} />
          <Field label="汇率" type="number" value={form.exchangeRate} onChange={(value) => setForm({ ...form, exchangeRate: value })} />
          <Field label="运费（日元）" type="number" value={form.shippingFee} onChange={(value) => setForm({ ...form, shippingFee: value })} />
          <Field label="关税（日元）" type="number" value={form.customsFee} onChange={(value) => setForm({ ...form, customsFee: value })} />
          <Field label="其他费用（日元）" type="number" value={form.otherFee} onChange={(value) => setForm({ ...form, otherFee: value })} />
          <ReadOnlyField label="原币金额" value={formatOriginalAmount(amountPreview.originalAmount, form.currency)} />
          <ReadOnlyField label="日元金额" value={formatYen(amountPreview.jpyAmount)} />
          <ReadOnlyField label="总成本" value={formatYen(amountPreview.totalCost)} />
        </FormGroup>

        <FormGroup title="项目/库存信息">
          <OptionField label="采购用途" value={form.purchasePurpose} onChange={(value) => setForm({ ...form, purchasePurpose: value, projectId: value === '项目使用' ? form.projectId : '' })} options={purchasePurposeOptions} />
          {form.purchasePurpose === '项目使用' && (
            <ProjectSelect projects={projects} value={form.projectId} onChange={(value) => setForm({ ...form, projectId: value })} />
          )}
          <OptionField label="到货状态" value={form.arrivalStatus} onChange={(value) => setForm({ ...form, arrivalStatus: value })} options={arrivalStatusOptions} />
        </FormGroup>

        <FormGroup title="付款/发票信息">
          <Field label="已付款金额（日元）" type="number" value={form.paidAmount} onChange={(value) => setForm({ ...form, paidAmount: value })} />
          <ReadOnlyField label="未付款金额" value={formatYen(amountPreview.unpaidAmount)} />
          <ReadOnlyField label="付款状态" value={amountPreview.paymentStatus} />
          <OptionField label="发票/收据状态" value={form.invoiceStatus} onChange={(value) => setForm({ ...form, invoiceStatus: value })} options={invoiceStatusOptions} />
        </FormGroup>

        <FormGroup title="备注">
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </FormGroup>

        <div className="form-actions">
          <button className="primary-button" type="submit">
            保存采购记录
          </button>
        </div>
      </form>
    </>
  )
}

function PurchaseListSection({ projects, records, setRecords, paymentRecords, stockInRecords }) {
  const [filters, setFilters] = useState({
    source: '',
    platform: '',
    type: '',
    projectId: '',
    paymentStatus: '',
    arrivalStatus: '',
    stockInStatus: '',
    startDate: '',
    endDate: '',
    supplier: '',
    keyword: '',
  })

  const normalRecords = records.filter((record) => record.purchaseStatus !== '作废')
  const filteredRecords = normalRecords.filter((record) => {
    const stockInStatus = getPurchaseStockInStatus(record, stockInRecords)
    const startMatched = filters.startDate ? record.purchaseDate >= filters.startDate : true
    const endMatched = filters.endDate ? record.purchaseDate <= filters.endDate : true

    return (
      (!filters.source || record.purchaseSource === filters.source) &&
      (!filters.platform || record.platform === filters.platform) &&
      (!filters.type || record.purchaseType === filters.type) &&
      (!filters.projectId || record.projectId === filters.projectId) &&
      (!filters.paymentStatus || record.paymentStatus === filters.paymentStatus) &&
      (!filters.arrivalStatus || record.arrivalStatus === filters.arrivalStatus) &&
      (!filters.stockInStatus || stockInStatus === filters.stockInStatus) &&
      startMatched &&
      endMatched &&
      (!filters.supplier || record.supplierName.includes(filters.supplier.trim())) &&
      (!filters.keyword || record.itemName.includes(filters.keyword.trim()))
    )
  })

  return (
    <>
      <SectionTitle title="采购列表" note={`${filteredRecords.length} 条`} />
      <div className="filter-panel">
        <OptionField label="采购来源" value={filters.source} onChange={(value) => setFilters({ ...filters, source: value })} options={purchaseSourceOptions} includeAll />
        <OptionField label="采购平台" value={filters.platform} onChange={(value) => setFilters({ ...filters, platform: value })} options={purchasePlatformOptions} includeAll />
        <OptionField label="采购类型" value={filters.type} onChange={(value) => setFilters({ ...filters, type: value })} options={purchaseTypeOptions} includeAll />
        <ProjectSelect projects={projects} value={filters.projectId} onChange={(value) => setFilters({ ...filters, projectId: value })} allowAll />
        <OptionField label="付款状态" value={filters.paymentStatus} onChange={(value) => setFilters({ ...filters, paymentStatus: value })} options={purchasePaymentStatusOptions} includeAll />
        <OptionField label="到货状态" value={filters.arrivalStatus} onChange={(value) => setFilters({ ...filters, arrivalStatus: value })} options={arrivalStatusOptions} includeAll />
        <OptionField label="入库状态" value={filters.stockInStatus} onChange={(value) => setFilters({ ...filters, stockInStatus: value })} options={stockInStatusOptions} includeAll />
        <Field label="开始日期" type="date" value={filters.startDate} onChange={(value) => setFilters({ ...filters, startDate: value })} />
        <Field label="结束日期" type="date" value={filters.endDate} onChange={(value) => setFilters({ ...filters, endDate: value })} />
        <Field label="供应商" value={filters.supplier} onChange={(value) => setFilters({ ...filters, supplier: value })} />
        <Field label="商品名称" value={filters.keyword} onChange={(value) => setFilters({ ...filters, keyword: value })} />
      </div>

      <div className="record-list">
        {filteredRecords.length === 0 ? (
          <EmptyState text="暂无采购记录" />
        ) : (
          filteredRecords.map((record) => (
            <PurchaseCard
              key={record.purchaseId}
              record={record}
              stockInStatus={getPurchaseStockInStatus(record, stockInRecords)}
              onVoid={() => {
                setRecords((currentRecords) =>
                  currentRecords.map((item) =>
                    item.purchaseId === record.purchaseId
                      ? normalizePurchaseRecord({ ...item, purchaseStatus: '作废', updatedAt: todayValue() })
                      : item,
                  ),
                )
              }}
              onDelete={() => {
                const hasPayment = paymentRecords.some((item) => item.purchaseId === record.purchaseId)
                const hasStockIn = stockInRecords.some((item) => item.sourcePurchaseId === record.purchaseId)
                if (hasPayment || hasStockIn) {
                  window.alert('该采购已有付款或入库记录，建议作废，不建议删除。')
                  return
                }
                if (window.confirm('确定删除这条采购记录吗？')) {
                  setRecords((currentRecords) =>
                    currentRecords.filter((item) => item.purchaseId !== record.purchaseId),
                  )
                }
              }}
            />
          ))
        )}
      </div>
    </>
  )
}

function PurchaseStockInSection({
  employees,
  purchaseRecords,
  setPurchaseRecords,
  stockInRecords,
  setStockInRecords,
  inventoryItems,
  setInventoryItems,
}) {
  const [form, setForm] = useState(createEmptyStockInForm)
  const activePurchases = purchaseRecords.filter((record) => record.purchaseStatus !== '作废')
  const selectedPurchase = activePurchases.find((record) => record.purchaseId === form.purchaseId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!selectedPurchase) {
      window.alert('请选择采购记录')
      return
    }

    if (!selectedEmployee && !form.externalPersonName.trim()) {
      window.alert('请选择经办人，或填写外部人员')
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()
    const stockIn = normalizeStockInRecord({
      ...form,
      stockInId: nextId('SI', stockInRecords, 'stockInId'),
      sourceType: '采购入库',
      sourcePurchaseId: selectedPurchase.purchaseId,
      itemName: selectedPurchase.itemName,
      specification: selectedPurchase.specification,
      unit: selectedPurchase.unit,
      projectId: selectedPurchase.projectId,
      projectName: selectedPurchase.projectName,
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
    })

    setStockInRecords((currentRecords) => [stockIn, ...currentRecords])
    setInventoryItems((currentItems) =>
      mergeInventoryItem(currentItems, selectedPurchase, stockIn, inventoryItems),
    )

    const nextStockIns = [stockIn, ...stockInRecords]
    setPurchaseRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.purchaseId === selectedPurchase.purchaseId
          ? normalizePurchaseRecord({
              ...record,
              stockInStatus: getPurchaseStockInStatus(record, nextStockIns),
              updatedAt: todayValue(),
            })
          : record,
      ),
    )
    setForm(createEmptyStockInForm())
  }

  return (
    <>
      <SectionTitle title="到货入库" note="支持分批入库" />
      <form className="form-panel" onSubmit={handleSubmit}>
        <label className="field full-width">
          <span>采购记录</span>
          <select value={form.purchaseId} onChange={(event) => setForm({ ...form, purchaseId: event.target.value })}>
            <option value="">请选择采购记录</option>
            {activePurchases.map((record) => (
              <option value={record.purchaseId} key={record.purchaseId}>
                {record.purchaseId}｜{record.itemName}｜剩余 {Math.max((Number(record.quantity) || 0) - getPurchaseStockInQuantity(record.purchaseId, stockInRecords), 0)} {record.unit}
              </option>
            ))}
          </select>
        </label>
        {selectedPurchase && (
          <dl className="detail-list compact employee-snapshot">
            <div><dt>商品</dt><dd>{selectedPurchase.itemName}</dd></div>
            <div><dt>采购数量</dt><dd>{selectedPurchase.quantity} {selectedPurchase.unit}</dd></div>
            <div><dt>已入库</dt><dd>{getPurchaseStockInQuantity(selectedPurchase.purchaseId, stockInRecords)} {selectedPurchase.unit}</dd></div>
            <div><dt>项目</dt><dd>{selectedPurchase.projectName || '未绑定'}</dd></div>
          </dl>
        )}
        <div className="form-grid">
          <Field label="入库数量" type="number" value={form.stockInQuantity} onChange={(value) => setForm({ ...form, stockInQuantity: value })} required />
          <Field label="入库日期" type="date" value={form.stockInDate} onChange={(value) => setForm({ ...form, stockInDate: value })} />
          <Field label="仓库位置" value={form.warehouseLocation} onChange={(value) => setForm({ ...form, warehouseLocation: value })} placeholder="例如 一号仓库A区" />
          <EmployeeSelect
            employees={employees}
            value={form.employeeId}
            externalValue={form.externalPersonName}
            label="经办人"
            onChange={(value) => setForm({ ...form, employeeId: value })}
            onExternalChange={(value) => setForm({ ...form, externalPersonName: value })}
            allowExternal
          />
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">保存入库</button>
        </div>
      </form>
    </>
  )
}

function PurchasePaymentSection({ employees, purchaseRecords, setPurchaseRecords, records, setRecords }) {
  const [form, setForm] = useState(createEmptyPurchasePaymentForm)
  const activePurchases = purchaseRecords.filter((record) => record.purchaseStatus !== '作废')
  const selectedPurchase = activePurchases.find((record) => record.purchaseId === form.purchaseId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const paymentPreview = normalizePurchasePaymentRecord({ ...form, paymentId: 'PREVIEW' })

  const handleSubmit = (event) => {
    event.preventDefault()

    if (!selectedPurchase) {
      window.alert('请选择采购记录')
      return
    }

    if (!selectedEmployee && !form.externalPersonName.trim()) {
      window.alert('请选择付款人，或填写外部人员')
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()
    const payment = normalizePurchasePaymentRecord({
      ...form,
      paymentId: nextId('PP', records, 'paymentId'),
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
    })

    setRecords((currentRecords) => [payment, ...currentRecords])
    setPurchaseRecords((currentRecords) =>
      currentRecords.map((record) =>
        record.purchaseId === selectedPurchase.purchaseId
          ? normalizePurchaseRecord({
              ...record,
              paidAmount: toAmount(record.paidAmount) + payment.jpyAmount,
              updatedAt: todayValue(),
            })
          : record,
      ),
    )
    setForm(createEmptyPurchasePaymentForm())
  }

  return (
    <>
      <SectionTitle title="付款记录" note="支持分批付款" />
      <form className="form-panel" onSubmit={handleSubmit}>
        <label className="field full-width">
          <span>采购记录</span>
          <select value={form.purchaseId} onChange={(event) => setForm({ ...form, purchaseId: event.target.value, currency: activePurchases.find((item) => item.purchaseId === event.target.value)?.currency || 'JPY' })}>
            <option value="">请选择采购记录</option>
            {activePurchases.map((record) => (
              <option value={record.purchaseId} key={record.purchaseId}>
                {record.purchaseId}｜{record.itemName}｜未付款 {formatYen(record.unpaidAmount)}
              </option>
            ))}
          </select>
        </label>
        <div className="form-grid">
          <Field label="付款日期" type="date" value={form.paymentDate} onChange={(value) => setForm({ ...form, paymentDate: value })} />
          <Field label="付款金额" type="number" value={form.paymentAmount} onChange={(value) => setForm({ ...form, paymentAmount: value })} required />
          <OptionField label="币种" value={form.currency} onChange={(value) => setForm({ ...form, currency: value })} options={currencyOptions} />
          <Field label="汇率" type="number" value={form.exchangeRate} onChange={(value) => setForm({ ...form, exchangeRate: value })} />
          <ReadOnlyField label="日元金额" value={formatYen(paymentPreview.jpyAmount)} />
          <OptionField label="付款方式" value={form.paymentMethod} onChange={(value) => setForm({ ...form, paymentMethod: value })} options={paymentMethodOptions} />
          <EmployeeSelect
            employees={employees}
            value={form.employeeId}
            externalValue={form.externalPersonName}
            label="付款人"
            onChange={(value) => setForm({ ...form, employeeId: value })}
            onExternalChange={(value) => setForm({ ...form, externalPersonName: value })}
            allowExternal
          />
          <Field label="备注" type="textarea" value={form.remark} onChange={(value) => setForm({ ...form, remark: value })} />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit">保存付款记录</button>
        </div>
      </form>
      <AccountingRecordList
        emptyText="暂无采购付款记录"
        records={records}
        idField="paymentId"
        titleField="purchaseId"
        amountField="jpyAmount"
        details={[
          ['付款日期', 'paymentDate'],
          ['付款方式', 'paymentMethod'],
          ['付款人', 'employeeName'],
          ['备注', 'remark'],
        ]}
        onEdit={() => window.alert('付款记录暂不支持编辑，请作废采购或补充付款记录。')}
        onDelete={(record) => {
          if (window.confirm('确定删除这条付款记录吗？')) {
            setRecords((currentRecords) =>
              currentRecords.filter((item) => item.paymentId !== record.paymentId),
            )
          }
        }}
      />
    </>
  )
}

function PurchaseSummarySection({ purchaseRecords, stockInRecords, inventoryItems }) {
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const activePurchases = purchaseRecords.filter(
    (record) => record.purchaseStatus !== '作废' && monthFromDate(record.purchaseDate) === monthFilter,
  )
  const total = activePurchases.reduce((sum, record) => sum + toAmount(record.totalCost), 0)
  const unpaid = activePurchases.reduce((sum, record) => sum + toAmount(record.unpaidAmount), 0)
  const stockStatusCount = (status) =>
    activePurchases.filter((record) => getPurchaseStockInStatus(record, stockInRecords) === status).length
  const inventoryTotal = inventoryItems.reduce((sum, item) => sum + toAmount(item.totalCost), 0)

  return (
    <>
      <SectionTitle title="采购汇总" note={monthFilter} />
      <div className="filter-panel">
        <Field label="统计月份" type="month" value={monthFilter} onChange={setMonthFilter} />
      </div>
      <div className="stats-grid">
        <div className="stat-card money"><strong>{formatYen(total)}</strong><span>本月采购总额</span></div>
        <div className="stat-card money"><strong>{formatYen(sourceTotal(activePurchases, '中国采购'))}</strong><span>中国采购金额</span></div>
        <div className="stat-card money"><strong>{formatYen(sourceTotal(activePurchases, 'Amazon'))}</strong><span>Amazon 采购金额</span></div>
        <div className="stat-card money"><strong>{formatYen(sourceTotal(activePurchases, 'Yahoo拍卖'))}</strong><span>Yahoo拍卖金额</span></div>
        <div className="stat-card money"><strong>{formatYen(sourceTotal(activePurchases, '东鹏株式会社'))}</strong><span>东鹏株式会社采购金额</span></div>
        <div className="stat-card money"><strong>{formatYen(unpaid)}</strong><span>未付款采购金额</span></div>
        <div className="stat-card"><strong>{stockStatusCount('未入库')}</strong><span>未入库采购数量</span></div>
        <div className="stat-card"><strong>{stockStatusCount('部分入库')}</strong><span>部分入库采购数量</span></div>
        <div className="stat-card"><strong>{stockStatusCount('已入库')}</strong><span>已入库采购数量</span></div>
        <div className="stat-card money"><strong>{formatYen(inventoryTotal)}</strong><span>仓库库存总成本</span></div>
      </div>
    </>
  )
}

function PurchaseCard({ record, stockInStatus, onVoid, onDelete }) {
  return (
    <article className="record-card">
      <div className="record-header">
        <div>
          <strong>{record.itemName}</strong>
          <span>{record.purchaseId}｜{record.purchaseSource}｜{record.platform}</span>
        </div>
        <span className="amount-pill">{formatYen(record.totalCost)}</span>
      </div>
      <dl className="detail-list compact">
        <div><dt>供应商</dt><dd>{record.supplierName || '未填写'}</dd></div>
        <div><dt>类型</dt><dd>{record.purchaseType}</dd></div>
        <div><dt>数量</dt><dd>{record.quantity} {record.unit}</dd></div>
        <div><dt>原币金额</dt><dd>{formatOriginalAmount(record.originalAmount, record.currency)}</dd></div>
        <div><dt>付款状态</dt><dd>{record.paymentStatus}</dd></div>
        <div><dt>未付款</dt><dd>{formatYen(record.unpaidAmount)}</dd></div>
        <div><dt>到货状态</dt><dd>{record.arrivalStatus}</dd></div>
        <div><dt>入库状态</dt><dd>{stockInStatus}</dd></div>
        <div><dt>工程项目</dt><dd>{record.projectName || '未绑定'}</dd></div>
        <div><dt>经办人</dt><dd>{record.employeeName || '未填写'}</dd></div>
      </dl>
      <div className="record-actions">
        <button className="ghost-button" type="button" onClick={onVoid}>作废</button>
        <button className="danger-button" type="button" onClick={onDelete}>删除</button>
      </div>
    </article>
  )
}

function sourceTotal(records, source) {
  return records
    .filter((record) => record.purchaseSource === source)
    .reduce((total, record) => total + toAmount(record.totalCost), 0)
}

function mergeInventoryItem(currentItems, purchase, stockIn, allItems) {
  const category = purchase.purchaseType === '工具' || purchase.purchaseType === '设备' ? '工具' : purchase.purchaseType
  const stockQuantity = Number(stockIn.stockInQuantity) || 0
  const unitCost = purchase.quantity > 0 ? purchase.totalCost / purchase.quantity : 0
  const addedCost = Math.round(unitCost * stockQuantity)
  const matchedItem = currentItems.find(
    (item) =>
      item.itemName === purchase.itemName &&
      item.specification === purchase.specification &&
      item.category === category &&
      item.warehouseLocation === stockIn.warehouseLocation,
  )

  if (!matchedItem) {
    return [
      normalizeInventoryItem({
        inventoryId: nextId('INV', allItems, 'inventoryId'),
        itemName: purchase.itemName,
        specification: purchase.specification,
        category,
        quantity: stockQuantity,
        unit: purchase.unit,
        warehouseLocation: stockIn.warehouseLocation,
        sourceType: '采购入库',
        sourcePurchaseId: purchase.purchaseId,
        averageCost: unitCost,
        totalCost: addedCost,
        updatedAt: todayValue(),
      }),
      ...currentItems,
    ]
  }

  return currentItems.map((item) => {
    if (item.inventoryId !== matchedItem.inventoryId) return item
    const quantity = item.quantity + stockQuantity
    const totalCost = item.totalCost + addedCost
    return normalizeInventoryItem({
      ...item,
      quantity,
      totalCost,
      averageCost: quantity > 0 ? totalCost / quantity : 0,
      updatedAt: todayValue(),
    })
  })
}

function LaborMovementSection({ laborRecords, employees, projects }) {
  const normalizedRecords = laborRecords
    .map((record) => normalizeLaborRecord(record))
    .sort((a, b) => `${b.workDate} ${b.startTime}`.localeCompare(`${a.workDate} ${a.startTime}`))
  const [filters, setFilters] = useState({
    startDate: currentMonthValue() + '-01',
    endDate: todayValue(),
    employeeId: '',
    projectId: '',
    department: '',
    position: '',
    workType: '',
  })
  const [movementEmployeeId, setMovementEmployeeId] = useState('')
  const [movementDate, setMovementDate] = useState(todayValue())
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const [viewMode, setViewMode] = useState('detail')
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState('')

  const filteredRecords = normalizedRecords
    .filter((record) => {
      const startMatched = filters.startDate ? record.workDate >= filters.startDate : true
      const endMatched = filters.endDate ? record.workDate <= filters.endDate : true
      return (
        startMatched &&
        endMatched &&
        (!filters.employeeId || record.employeeId === filters.employeeId) &&
        (!filters.projectId || record.projectId === filters.projectId) &&
        (!filters.department || record.department === filters.department) &&
        (!filters.position || record.position === filters.position) &&
        (!filters.workType || record.workType === filters.workType)
      )
    })
    .sort((a, b) => `${a.workDate} ${a.startTime}`.localeCompare(`${b.workDate} ${b.startTime}`))

  const uniqueEmployeeCount = new Set(filteredRecords.map((record) => record.employeeId).filter(Boolean)).size
  const totalHours = filteredRecords.reduce((total, record) => total + (Number(record.workHours) || 0), 0)
  const totalLaborCost = filteredRecords.reduce((total, record) => total + toAmount(record.laborCost), 0)
  const restLeaveCount = filteredRecords.filter((record) =>
    ['休息', '请假', '调休'].includes(record.workType),
  ).length
  const employeeTimeline = movementEmployeeId
    ? normalizedRecords
        .filter((record) => record.employeeId === movementEmployeeId)
        .sort((a, b) => `${a.workDate} ${a.startTime}`.localeCompare(`${b.workDate} ${b.startTime}`))
    : []
  const dailyMovements = normalizedRecords
    .filter((record) => record.workDate === movementDate)
    .sort((a, b) => `${a.employeeName} ${a.startTime}`.localeCompare(`${b.employeeName} ${b.startTime}`))
  const monthlyStats = buildEmployeeMonthlyLaborStats(normalizedRecords, monthFilter)
  const exceptions = getLaborExceptions(filteredRecords)
  const duplicateAssignmentCount = getDuplicateLaborAssignmentGroups(filteredRecords).length
  const timeConflictCount = getLaborTimeConflictPairs(filteredRecords).length
  const employeeStats = buildEmployeeLaborStats(filteredRecords).map((item) => ({
    ...item,
    records: filteredRecords.filter((record) => record.employeeId === item.employeeId),
  }))
  const dateGroups = groupRecordsBy(filteredRecords, 'workDate')
  const projectStats = buildProjectLaborStats(filteredRecords)
  const selectedProjectRecords = selectedProjectId
    ? filteredRecords.filter((record) => (record.projectId || record.workLocationType) === selectedProjectId)
    : []

  return (
    <>
      <SectionTitle title="员工出工动向" note="按员工、项目、日期查询" />
      <div className="filter-panel">
        <Field label="开始日期" type="date" value={filters.startDate} onChange={(value) => setFilters({ ...filters, startDate: value })} />
        <Field label="结束日期" type="date" value={filters.endDate} onChange={(value) => setFilters({ ...filters, endDate: value })} />
        <EmployeeSelect employees={employees} value={filters.employeeId} label="员工姓名" onChange={(value) => setFilters({ ...filters, employeeId: value })} />
        <ProjectSelect projects={projects} value={filters.projectId} onChange={(value) => setFilters({ ...filters, projectId: value })} allowAll />
        <OptionField label="部门" value={filters.department} onChange={(value) => setFilters({ ...filters, department: value })} options={departmentOptions} includeAll />
        <OptionField label="职位" value={filters.position} onChange={(value) => setFilters({ ...filters, position: value })} options={positionOptions} includeAll />
        <OptionField label="出工类型" value={filters.workType} onChange={(value) => setFilters({ ...filters, workType: value })} options={workTypeOptions} includeAll />
      </div>

      <div className="stats-grid">
        <div className="stat-card"><strong>{filteredRecords.length}</strong><span>出工记录数</span></div>
        <div className="stat-card"><strong>{uniqueEmployeeCount}</strong><span>出工员工数</span></div>
        <div className="stat-card"><strong>{totalHours}</strong><span>总工时</span></div>
        <div className="stat-card money"><strong>{formatYen(totalLaborCost)}</strong><span>项目人工分摊合计</span></div>
        <div className="stat-card"><strong>{filteredRecords.filter((record) => record.workType === '正常出勤').length}</strong><span>正常出勤数量</span></div>
        <div className="stat-card"><strong>{filteredRecords.filter((record) => record.workType === '加班').length}</strong><span>加班数量</span></div>
        <div className="stat-card"><strong>{restLeaveCount}</strong><span>请假/休息数量</span></div>
        <div className="stat-card"><strong>{exceptions.length}</strong><span>异常记录数量</span></div>
        <div className="stat-card"><strong>{duplicateAssignmentCount}</strong><span>同一天重复安排人数</span></div>
        <div className="stat-card"><strong>{timeConflictCount}</strong><span>时间冲突记录数量</span></div>
      </div>

      <div className="view-switcher">
        {[
          ['detail', '明细列表'],
          ['employee', '按员工查看'],
          ['date', '按日期查看'],
          ['project', '按项目查看'],
        ].map(([value, label]) => (
          <button
            className={viewMode === value ? 'active' : ''}
            type="button"
            key={value}
            onClick={() => setViewMode(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {viewMode === 'detail' && (
        <>
          <div className="labor-card-list">
            {filteredRecords.length === 0 ? (
              <EmptyState text="暂无符合条件的出工记录" />
            ) : (
              filteredRecords.map((record) => (
                <LaborMovementCard
                  key={record.laborRecordId}
                  record={record}
                  hasConflict={hasTimeConflict(record, normalizedRecords)}
                  isLongDay={isLongWorkDay(record, normalizedRecords)}
                />
              ))
            )}
          </div>
          {exceptions.length > 0 && (
            <>
              <SectionTitle title="异常明细" note={`${exceptions.length} 条`} />
              <div className="labor-card-list">
                {exceptions.map((item) => (
                  <article className="labor-movement-card" key={item.id}>
                    <div className="record-header">
                      <div>
                        <strong>{item.type || item.message}</strong>
                        <span>{item.message}</span>
                      </div>
                    </div>
                    <dl className="detail-list compact">
                      <div><dt>日期</dt><dd>{item.record.workDate}</dd></div>
                      <div><dt>员工姓名</dt><dd>{item.record.employeeName || '未绑定员工'}</dd></div>
                      <div><dt>已有项目</dt><dd>{item.relatedRecord ? getLaborPlaceLabel(item.relatedRecord) : '无'}</dd></div>
                      <div><dt>新项目</dt><dd>{getLaborPlaceLabel(item.record)}</dd></div>
                      <div><dt>已有时间</dt><dd>{item.relatedRecord ? getLaborTimeLabel(item.relatedRecord) : '--'}</dd></div>
                      <div><dt>新时间</dt><dd>{getLaborTimeLabel(item.record)}</dd></div>
                    </dl>
                  </article>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {viewMode === 'employee' && (
        <div className="labor-card-list">
          {employeeStats.length === 0 ? (
            <EmptyState text="暂无员工出工统计" />
          ) : (
            employeeStats.map((employee) => (
              <article className="labor-movement-card" key={employee.employeeId}>
                <div className="record-header">
                  <div>
                    <strong>{employee.employeeName}</strong>
                    <span>{employee.department}｜{employee.position}</span>
                  </div>
                  <span className="amount-pill">{formatYen(employee.totalLaborCost)}</span>
                </div>
                <dl className="detail-list compact">
                  <div><dt>出工天数</dt><dd>{employee.workDays}</dd></div>
                  <div><dt>总工时</dt><dd>{employee.totalHours}</dd></div>
                  <div><dt>涉及工程项目数量</dt><dd>{employee.projectCount}</dd></div>
                </dl>
                <details className="batch-detail">
                  <summary>查看每日出工动向</summary>
                  <div className="timeline-list">
                    {employee.records.map((record) => (
                      <article className="timeline-card" key={record.laborRecordId}>
                        <strong>{record.workDate}</strong>
                        <span>工程项目：{record.projectName || record.workLocationType}</span>
                        <span>时间：{record.startTime || '--'}-{record.endTime || '--'}</span>
                        <span>工时：{record.workHours} 小时</span>
                        <span>工作内容：{record.jobContent || record.remark || '未填写'}</span>
                        <span>项目人工分摊：{formatYen(record.laborCost)}</span>
                      </article>
                    ))}
                  </div>
                </details>
              </article>
            ))
          )}
        </div>
      )}

      {viewMode === 'date' && (
        <div className="labor-card-list">
          {dateGroups.length === 0 ? (
            <EmptyState text="暂无日期动向" />
          ) : (
            dateGroups.map((group) => (
              <article className="labor-movement-card" key={group.key}>
                <div className="record-header">
                  <div>
                    <strong>{group.key}</strong>
                    <span>{group.items.length} 条出工记录</span>
                  </div>
                </div>
                <div className="timeline-list">
                  {group.items.map((record) => (
                    <div className="compact-line" key={record.laborRecordId}>
                      {record.employeeName}｜{record.projectName || record.workLocationType}｜{record.startTime || '--'}-{record.endTime || '--'}｜{record.workHours}小时｜{formatYen(record.laborCost)}
                    </div>
                  ))}
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {viewMode === 'project' && (
        <div className="labor-card-list">
          {projectStats.length === 0 ? (
            <EmptyState text="暂无项目人工统计" />
          ) : (
            projectStats.map((project) => (
              <article className="labor-movement-card" key={project.key}>
                <div className="record-header">
                  <div>
                    <strong>{project.projectName}</strong>
                    <span>{project.recordCount} 条出工记录</span>
                  </div>
                  <span className="amount-pill">{formatYen(project.totalLaborCost)}</span>
                </div>
                <dl className="detail-list compact">
                  <div><dt>出工人数</dt><dd>{project.peopleCount}</dd></div>
                  <div><dt>总工时</dt><dd>{project.totalHours}</dd></div>
                  <div><dt>项目人工分摊合计</dt><dd>{formatYen(project.totalLaborCost)}</dd></div>
                </dl>
                <details className="batch-detail">
                  <summary>查看项目人工明细</summary>
                  <div className="timeline-list">
                    {project.records.map((record) => (
                      <div className="compact-line" key={record.laborRecordId}>
                        {record.workDate}｜{record.employeeName}｜{record.startTime || '--'}-{record.endTime || '--'}｜{record.workHours}小时｜{record.jobContent || '未填写'}｜{formatYen(record.laborCost)}
                      </div>
                    ))}
                  </div>
                </details>
              </article>
            ))
          )}
        </div>
      )}

      <SectionTitle title="员工月度出工统计" note={monthFilter} />
      <div className="filter-panel">
        <Field label="月份" type="month" value={monthFilter} onChange={setMonthFilter} />
      </div>
      <div className="payment-table-wrap">
        {monthlyStats.length === 0 ? (
          <EmptyState text="该月份暂无人工统计" />
        ) : (
          <table className="payment-table compact-table">
            <thead>
              <tr>
                <th>员工姓名</th>
                <th>部门</th>
                <th>职位</th>
                <th>出工天数</th>
                <th>总工时</th>
                <th>正常出勤天数</th>
                <th>加班次数</th>
                <th>请假/休息次数</th>
                <th>涉及工程项目数量</th>
                <th>项目人工分摊合计</th>
              </tr>
            </thead>
            <tbody>
              {monthlyStats.map((item) => (
                <tr key={item.employeeId}>
                  <td>{item.employeeName}</td>
                  <td>{item.department}</td>
                  <td>{item.position}</td>
                  <td>{item.workDays}</td>
                  <td>{item.totalHours}</td>
                  <td>{item.normalDays}</td>
                  <td>{item.overtimeCount}</td>
                  <td>{item.restLeaveCount}</td>
                  <td>{item.projectCount}</td>
                  <td>{formatYen(item.totalLaborCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function LaborMovementCard({ record, hasConflict = false, isLongDay = false, compact = false }) {
  return (
    <article className="labor-movement-card">
      <div className="record-header">
        <div>
          <strong>{record.employeeName}</strong>
          <span>{record.workDate}｜{record.projectName || record.workLocationType}</span>
        </div>
        <span className="amount-pill">{formatYen(record.laborCost)}</span>
      </div>
      <dl className="detail-list compact">
        <div><dt>部门</dt><dd>{record.department || '未填写'}</dd></div>
        <div><dt>职位</dt><dd>{record.position || '未填写'}</dd></div>
        <div><dt>开始时间</dt><dd>{record.startTime || '--'}</dd></div>
        <div><dt>结束时间</dt><dd>{record.endTime || '--'}</dd></div>
        <div><dt>工时</dt><dd>{record.workHours}</dd></div>
        <div><dt>出工类型</dt><dd>{record.workType}</dd></div>
        {!compact && <div><dt>工作内容</dt><dd>{record.jobContent || '未填写'}</dd></div>}
        {!compact && <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>}
      </dl>
      {(hasConflict || isLongDay) && (
        <div className="warning-list">
          {hasConflict && <span>时间冲突，请确认</span>}
          {isLongDay && <span>工时异常，请确认</span>}
        </div>
      )}
    </article>
  )
}

function buildEmployeeMonthlyLaborStats(records, month) {
  const grouped = records
    .filter((record) => monthFromDate(record.workDate) === month)
    .reduce((result, record) => {
      const key = record.employeeId || record.employeeName
      const current = result[key] || {
        employeeId: key,
        employeeName: record.employeeName,
        department: record.department,
        position: record.position,
        dates: new Set(),
        totalHours: 0,
        normalDates: new Set(),
        overtimeCount: 0,
        restLeaveCount: 0,
        projectIds: new Set(),
        totalLaborCost: 0,
      }
      current.dates.add(record.workDate)
      current.totalHours += Number(record.workHours) || 0
      if (record.workType === '正常出勤') current.normalDates.add(record.workDate)
      if (record.workType === '加班') current.overtimeCount += 1
      if (['休息', '请假', '调休'].includes(record.workType)) current.restLeaveCount += 1
      if (record.projectId) current.projectIds.add(record.projectId)
      current.totalLaborCost += toAmount(record.laborCost)
      return { ...result, [key]: current }
    }, {})

  return Object.values(grouped).map((item) => ({
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    department: item.department,
    position: item.position,
    workDays: item.dates.size,
    totalHours: Number(item.totalHours.toFixed(2)),
    normalDays: item.normalDates.size,
    overtimeCount: item.overtimeCount,
    restLeaveCount: item.restLeaveCount,
    projectCount: item.projectIds.size,
    totalLaborCost: item.totalLaborCost,
  }))
}

function buildEmployeeLaborStats(records) {
  const grouped = records.reduce((result, record) => {
    const key = record.employeeId || record.employeeName
    const current = result[key] || {
      employeeId: key,
      employeeName: record.employeeName,
      department: record.department,
      position: record.position,
      dates: new Set(),
      totalHours: 0,
      projectIds: new Set(),
      totalLaborCost: 0,
    }
    current.dates.add(record.workDate)
    current.totalHours += Number(record.workHours) || 0
    if (record.projectId) current.projectIds.add(record.projectId)
    current.totalLaborCost += toAmount(record.laborCost)
    return { ...result, [key]: current }
  }, {})

  return Object.values(grouped).map((item) => ({
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    department: item.department,
    position: item.position,
    workDays: item.dates.size,
    totalHours: Number(item.totalHours.toFixed(2)),
    projectCount: item.projectIds.size,
    totalLaborCost: item.totalLaborCost,
  }))
}

function groupRecordsBy(records, field) {
  return Object.entries(
    records.reduce((result, record) => {
      const key = record[field] || '未填写'
      return { ...result, [key]: [...(result[key] || []), record] }
    }, {}),
  )
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => b.key.localeCompare(a.key))
}

function buildProjectLaborStats(records) {
  return groupRecordsBy(
    records.map((record) => ({
      ...record,
      projectGroupKey: record.projectId || record.workLocationType,
    })),
    'projectGroupKey',
  ).map((group) => {
    const first = group.items[0]
    return {
      key: group.key,
      projectName: first.projectName || first.workLocationType,
      peopleCount: new Set(group.items.map((record) => record.employeeId).filter(Boolean)).size,
      recordCount: group.items.length,
      totalHours: group.items.reduce((total, record) => total + (Number(record.workHours) || 0), 0),
      totalLaborCost: group.items.reduce((total, record) => total + toAmount(record.laborCost), 0),
      records: group.items,
    }
  })
}

function VehicleDashboardDetail({
  projects,
  employees,
  vehicles,
  vehicleUsageRecords,
  fuelRecords,
  vehicleExpenseRecords,
  vehicleIssueRecords,
}) {
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    vehicleId: '',
    employeeId: '',
    projectId: '',
    usagePurpose: '',
    expenseType: '',
    issueStatus: '',
  })
  const [viewMode, setViewMode] = useState('usage')
  const modes = [
    { id: 'usage', title: '用车明细' },
    { id: 'vehicle', title: '按车辆查看' },
    { id: 'project', title: '按项目查看' },
    { id: 'finance', title: '费用明细' },
    { id: 'issues', title: '异常记录' },
  ]
  const dateMatched = (date) => {
    const startMatched = filters.startDate ? date >= filters.startDate : true
    const endMatched = filters.endDate ? date <= filters.endDate : true
    return startMatched && endMatched
  }
  const baseMatched = (record) => {
    const vehicleMatched = filters.vehicleId ? record.vehicleId === filters.vehicleId : true
    const employeeMatched = filters.employeeId ? record.employeeId === filters.employeeId : true
    const projectMatched = filters.projectId ? record.projectId === filters.projectId : true
    return vehicleMatched && employeeMatched && projectMatched
  }
  const usage = vehicleUsageRecords.filter(
    (record) =>
      dateMatched(record.usageDate) &&
      baseMatched(record) &&
      (!filters.usagePurpose || record.usagePurpose === filters.usagePurpose),
  )
  const fuel = fuelRecords.filter((record) => dateMatched(record.fuelDate) && baseMatched(record))
  const expenses = vehicleExpenseRecords.filter(
    (record) =>
      dateMatched(record.expenseDate) &&
      baseMatched(record) &&
      (!filters.expenseType || record.expenseType === filters.expenseType),
  )
  const issues = vehicleIssueRecords.filter(
    (record) =>
      dateMatched(record.issueDate) &&
      baseMatched(record) &&
      (!filters.issueStatus || record.issueStatus === filters.issueStatus),
  )
  const totalMileage = usage.reduce((total, record) => total + (Number(record.dailyMileage) || 0), 0)
  const fuelTotal = fuel.reduce((total, record) => total + toAmount(record.fuelAmount), 0)
  const expenseTotal = expenses.reduce((total, record) => total + toAmount(record.amount), 0)
  const issueTotal = issues.reduce((total, record) => total + toAmount(record.repairCost), 0)
  const warnings = getVehicleWarnings(vehicles, usage, fuel, expenses, issues)
  const vehicleSummary = vehicles.map((vehicle) => {
    const vehicleUsage = usage.filter((record) => record.vehicleId === vehicle.vehicleId)
    const vehicleFuel = fuel.filter((record) => record.vehicleId === vehicle.vehicleId)
    const vehicleExpenses = expenses.filter((record) => record.vehicleId === vehicle.vehicleId)
    const vehicleIssues = issues.filter((record) => record.vehicleId === vehicle.vehicleId)

    return {
      vehicle,
      usageCount: vehicleUsage.length,
      mileage: vehicleUsage.reduce((total, record) => total + (Number(record.dailyMileage) || 0), 0),
      fuelCost: vehicleFuel.reduce((total, record) => total + toAmount(record.fuelAmount), 0),
      expenseCost: vehicleExpenses.reduce((total, record) => total + toAmount(record.amount), 0),
      issueCost: vehicleIssues.reduce((total, record) => total + toAmount(record.repairCost), 0),
      openIssues: vehicleIssues.filter((record) => record.issueStatus !== '已处理').length,
    }
  })
  const projectSummary = projects
    .map((project) => {
      const projectUsage = usage.filter((record) => record.projectId === project.projectId)
      const projectFuel = fuel.filter((record) => record.allocateToProject && record.projectId === project.projectId)
      const projectExpenses = expenses.filter((record) => record.allocateToProject && record.projectId === project.projectId)
      const projectIssues = issues.filter((record) => record.allocateToProject && record.projectId === project.projectId)
      const fuelCost = projectFuel.reduce((total, record) => total + toAmount(record.fuelAmount), 0)
      const expenseCost = projectExpenses.reduce((total, record) => total + toAmount(record.amount), 0)
      const issueCost = projectIssues.reduce((total, record) => total + toAmount(record.repairCost), 0)

      return {
        project,
        usageCount: projectUsage.length,
        mileage: projectUsage.reduce((total, record) => total + (Number(record.dailyMileage) || 0), 0),
        fuelCost,
        expenseCost,
        issueCost,
        totalCost: fuelCost + expenseCost + issueCost,
      }
    })
    .filter((item) => item.usageCount || item.totalCost)
  const financeRows = [
    ...fuel.map((record) => ({
      id: record.fuelRecordId,
      date: record.fuelDate,
      vehicleName: record.vehicleName,
      type: `加油-${record.fuelType}`,
      amount: record.fuelAmount,
      paymentMethod: record.paymentMethod,
      employeeName: record.employeeName,
      projectName: record.projectName,
      remark: record.remark,
    })),
    ...expenses.map((record) => ({
      id: record.vehicleExpenseId,
      date: record.expenseDate,
      vehicleName: record.vehicleName,
      type: record.expenseType,
      amount: record.amount,
      paymentMethod: record.paymentMethod,
      employeeName: record.employeeName,
      projectName: record.projectName,
      remark: record.remark,
    })),
    ...issues
      .filter((record) => toAmount(record.repairCost) > 0)
      .map((record) => ({
        id: record.issueId,
        date: record.issueDate,
        vehicleName: record.vehicleName,
        type: `异常处理-${record.issueLocation}`,
        amount: record.repairCost,
        paymentMethod: '未填写',
        employeeName: record.employeeName,
        projectName: record.projectName,
        remark: record.remark || record.issueDescription,
      })),
  ].sort((a, b) => b.date.localeCompare(a.date))

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card"><strong>{usage.length}</strong><span>用车记录总数</span></div>
        <div className="stat-card"><strong>{new Set(usage.map((record) => record.vehicleId).filter(Boolean)).size}</strong><span>使用车辆数</span></div>
        <div className="stat-card"><strong>{totalMileage} km</strong><span>总行驶里程</span></div>
        <div className="stat-card money"><strong>{formatYen(fuelTotal)}</strong><span>加油费用合计</span></div>
        <div className="stat-card money"><strong>{formatYen(expenseTotal)}</strong><span>停车/高速费用合计</span></div>
        <div className="stat-card money"><strong>{formatYen(issueTotal)}</strong><span>维修/异常费用合计</span></div>
        <div className="stat-card money"><strong>{formatYen(fuelTotal + expenseTotal + issueTotal)}</strong><span>车辆费用合计</span></div>
        <div className="stat-card"><strong>{issues.filter((record) => record.issueStatus !== '已处理').length}</strong><span>未处理异常数量</span></div>
      </div>

      <div className="filter-panel">
        <Field label="开始日期" type="date" value={filters.startDate} onChange={(value) => setFilters({ ...filters, startDate: value })} />
        <Field label="结束日期" type="date" value={filters.endDate} onChange={(value) => setFilters({ ...filters, endDate: value })} />
        <VehicleSelect vehicles={vehicles} value={filters.vehicleId} onChange={(value) => setFilters({ ...filters, vehicleId: value })} allowAll />
        <EmployeeSelect employees={employees} value={filters.employeeId} label="使用人/经办人" onChange={(value) => setFilters({ ...filters, employeeId: value })} />
        <ProjectSelect projects={projects} value={filters.projectId} onChange={(value) => setFilters({ ...filters, projectId: value })} allowAll />
        <OptionField label="使用目的" value={filters.usagePurpose} onChange={(value) => setFilters({ ...filters, usagePurpose: value })} options={vehicleUsagePurposeOptions} includeAll />
        <OptionField label="费用类型" value={filters.expenseType} onChange={(value) => setFilters({ ...filters, expenseType: value })} options={vehicleExpenseTypeOptions} includeAll />
        <OptionField label="异常状态" value={filters.issueStatus} onChange={(value) => setFilters({ ...filters, issueStatus: value })} options={vehicleIssueStatusOptions} includeAll />
      </div>

      <div className="accounting-entry-grid">
        {modes.map((mode) => (
          <button className={`accounting-entry ${viewMode === mode.id ? 'active' : ''}`} type="button" key={mode.id} onClick={() => setViewMode(mode.id)}>
            {mode.title}
          </button>
        ))}
      </div>

      {warnings.length > 0 && (
        <>
          <SectionTitle title="车辆风险提醒" note={`${warnings.length} 条`} />
          <div className="record-list">
            {warnings.map((warning) => (
              <article className="record-card warning-card" key={warning.id}>
                <div className="record-header">
                  <strong>{warning.message}</strong>
                  <span>{warning.record.vehicleName || warning.record.plateNumber || warning.record.issueDescription || '车辆记录'}</span>
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {viewMode === 'usage' && <VehicleUsageList records={usage} />}
      {viewMode === 'vehicle' && (
        <div className="record-list">
          {vehicleSummary.map((item) => (
            <article className="record-card" key={item.vehicle.vehicleId}>
              <div className="record-header">
                <div><strong>{item.vehicle.vehicleName}</strong><span>{item.vehicle.plateNumber}</span></div>
                <span className="amount-pill">{formatYen(item.fuelCost + item.expenseCost + item.issueCost)}</span>
              </div>
              <dl className="detail-list compact">
                <div><dt>使用次数</dt><dd>{item.usageCount}</dd></div>
                <div><dt>行驶总里程</dt><dd>{item.mileage} km</dd></div>
                <div><dt>加油费用</dt><dd>{formatYen(item.fuelCost)}</dd></div>
                <div><dt>停车/高速费用</dt><dd>{formatYen(item.expenseCost)}</dd></div>
                <div><dt>维修/异常费用</dt><dd>{formatYen(item.issueCost)}</dd></div>
                <div><dt>未处理异常</dt><dd>{item.openIssues}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
      {viewMode === 'project' && (
        <div className="record-list">
          {projectSummary.length === 0 ? <EmptyState text="暂无项目车辆统计" /> : projectSummary.map((item) => (
            <article className="record-card" key={item.project.projectId}>
              <div className="record-header">
                <div><strong>{item.project.projectName}</strong><span>{item.project.address || '未填写地址'}</span></div>
                <span className="amount-pill">{formatYen(item.totalCost)}</span>
              </div>
              <dl className="detail-list compact">
                <div><dt>用车次数</dt><dd>{item.usageCount}</dd></div>
                <div><dt>行驶总里程</dt><dd>{item.mileage} km</dd></div>
                <div><dt>加油费用</dt><dd>{formatYen(item.fuelCost)}</dd></div>
                <div><dt>停车/高速费用</dt><dd>{formatYen(item.expenseCost)}</dd></div>
                <div><dt>维修/异常费用</dt><dd>{formatYen(item.issueCost)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
      {viewMode === 'finance' && (
        <div className="record-list">
          {financeRows.length === 0 ? <EmptyState text="暂无车辆费用明细" /> : financeRows.map((row) => (
            <article className="record-card" key={`${row.type}-${row.id}`}>
              <div className="record-header">
                <div><strong>{row.date}｜{row.vehicleName}｜{row.type}</strong><span>{row.projectName || '公司车辆成本'}</span></div>
                <span className="amount-pill">{formatYen(row.amount)}</span>
              </div>
              <dl className="detail-list compact">
                <div><dt>付款方式</dt><dd>{row.paymentMethod}</dd></div>
                <div><dt>经办人</dt><dd>{row.employeeName || '未填写'}</dd></div>
                <div><dt>备注</dt><dd>{row.remark || '未填写'}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
      {viewMode === 'issues' && <VehicleIssueList records={issues} />}
    </>
  )
}

function ToolDashboardDetail({
  employees,
  toolRecords,
  toolBorrowRecords,
  toolReturnRecords,
  lifelongToolAssignments,
  toolResponsibilityRecords,
}) {
  const [viewMode, setViewMode] = useState('holderTools')
  const modes = [
    { id: 'holderTools', title: '员工名下工具' },
    { id: 'assignments', title: '终身领用记录' },
    { id: 'issues', title: '丢失/损坏记录' },
    { id: 'unpaid', title: '未赔偿明细' },
    { id: 'employee', title: '按员工查看' },
  ]
  const returnedIds = new Set(toolReturnRecords.map((record) => record.borrowRecordId).filter(Boolean))
  const pendingBorrowCount = toolBorrowRecords.filter(
    (record) => record.borrowType === '临时借用' && !returnedIds.has(record.borrowRecordId),
  ).length
  const unpaidRecords = toolResponsibilityRecords.filter((record) =>
    ['未赔偿', '部分赔偿'].includes(record.compensationStatus),
  )
  const employeeSummaries = employees
    .map((employee) => {
      const assignments = lifelongToolAssignments.filter(
        (assignment) =>
          assignment.employeeId === employee.employeeId && assignment.responsibilityStatus !== '作废',
      )
      const responsibilities = toolResponsibilityRecords.filter(
        (record) => record.employeeId === employee.employeeId,
      )
      return {
        employee,
        assignments,
        unpaidAmount: getToolUnpaidCompensation(responsibilities),
      }
    })
    .filter((item) => item.assignments.length || item.unpaidAmount)

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card"><strong>{toolRecords.length}</strong><span>工具总数</span></div>
        <div className="stat-card"><strong>{toolRecords.filter((tool) => tool.currentStatus === '在库').length}</strong><span>在库工具数量</span></div>
        <div className="stat-card"><strong>{pendingBorrowCount}</strong><span>临时借出数量</span></div>
        <div className="stat-card"><strong>{lifelongToolAssignments.filter((item) => item.responsibilityStatus !== '作废').length}</strong><span>终身领用数量</span></div>
        <div className="stat-card"><strong>{lifelongToolAssignments.filter((item) => item.responsibilityStatus === '已丢失').length}</strong><span>丢失工具数量</span></div>
        <div className="stat-card"><strong>{lifelongToolAssignments.filter((item) => item.responsibilityStatus === '已损坏').length}</strong><span>损坏工具数量</span></div>
        <div className="stat-card money"><strong>{formatYen(getToolUnpaidCompensation(toolResponsibilityRecords))}</strong><span>未赔偿金额合计</span></div>
      </div>
      <div className="accounting-entry-grid">
        {modes.map((mode) => (
          <button className={`accounting-entry ${viewMode === mode.id ? 'active' : ''}`} type="button" key={mode.id} onClick={() => setViewMode(mode.id)}>
            {mode.title}
          </button>
        ))}
      </div>
      {viewMode === 'holderTools' && (
        <EmployeeToolHolderSection
          employees={employees}
          assignments={lifelongToolAssignments}
          responsibilityRecords={toolResponsibilityRecords}
        />
      )}
      {viewMode === 'assignments' && (
        <LifelongAssignmentList
          assignments={lifelongToolAssignments}
          responsibilityRecords={toolResponsibilityRecords}
        />
      )}
      {viewMode === 'issues' && (
        <ToolResponsibilityList records={toolResponsibilityRecords} />
      )}
      {viewMode === 'unpaid' && (
        <ToolResponsibilityList records={unpaidRecords} />
      )}
      {viewMode === 'employee' && (
        <div className="record-list">
          {employeeSummaries.length === 0 ? (
            <EmptyState text="暂无员工工具责任" />
          ) : (
            employeeSummaries.map((item) => (
              <article className="record-card" key={item.employee.employeeId}>
                <div className="record-header">
                  <div>
                    <strong>{item.employee.name}</strong>
                    <span>{item.employee.department}｜{item.employee.position}</span>
                  </div>
                  <span className="amount-pill">{formatYen(item.unpaidAmount)}</span>
                </div>
                <dl className="detail-list compact">
                  <div><dt>名下工具</dt><dd>{item.assignments.length}</dd></div>
                  <div><dt>未赔偿金额</dt><dd>{formatYen(item.unpaidAmount)}</dd></div>
                  <div><dt>工具明细</dt><dd>{item.assignments.map((assignment) => assignment.toolName).join('、') || '无'}</dd></div>
                </dl>
              </article>
            ))
          )}
        </div>
      )}
    </>
  )
}

function DashboardPage({
  projects,
  employees,
  records,
  projectCostRecords,
  purchaseRecords,
  stockInRecords,
  inventoryItems,
  salaryRecords,
  vehicles,
  vehicleUsageRecords,
  fuelRecords,
  vehicleExpenseRecords,
  vehicleIssueRecords,
  toolRecords,
  toolBorrowRecords,
  toolReturnRecords,
  lifelongToolAssignments,
  toolResponsibilityRecords,
  onBack,
}) {
  const [projectId, setProjectId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [dashboardDetail, setDashboardDetail] = useState('')
  const selectedProject = projects.find((project) => project.projectId === projectId)
  const normalizedLaborRecords = records.labor.map((record) => normalizeLaborRecord(record))
  const todayLaborRecords = normalizedLaborRecords.filter((record) => record.workDate === todayValue())
  const currentMonthLaborRecords = normalizedLaborRecords.filter(
    (record) => monthFromDate(record.workDate) === currentMonthValue(),
  )
  const laborAllocationInfo = getLaborAllocationInfo(
    salaryRecords,
    employees,
    normalizedLaborRecords,
  )
  const laborExceptionCount = getLaborExceptions(normalizedLaborRecords).length
  const returnedToolBorrowIds = new Set(
    toolReturnRecords.map((record) => record.borrowRecordId).filter(Boolean),
  )
  const temporaryToolBorrowCount = toolBorrowRecords.filter(
    (record) => record.borrowType === '临时借用' && !returnedToolBorrowIds.has(record.borrowRecordId),
  ).length
  const toolUnpaidCompensation = getToolUnpaidCompensation(toolResponsibilityRecords)
  const currentMonthVehicleUsageRecords = vehicleUsageRecords.filter(
    (record) => monthFromDate(record.usageDate) === currentMonthValue(),
  )
  const currentMonthFuelRecords = fuelRecords.filter(
    (record) => monthFromDate(record.fuelDate) === currentMonthValue(),
  )
  const currentMonthVehicleExpenseRecords = vehicleExpenseRecords.filter(
    (record) => monthFromDate(record.expenseDate) === currentMonthValue(),
  )
  const currentMonthVehicleIssueRecords = vehicleIssueRecords.filter(
    (record) => monthFromDate(record.issueDate) === currentMonthValue(),
  )
  const vehicleWarningCount = getVehicleWarnings(
    vehicles,
    vehicleUsageRecords,
    fuelRecords,
    vehicleExpenseRecords,
    vehicleIssueRecords,
  ).length

  const businessStats = useMemo(() => {
    const byProject = (list) =>
      projectId ? list.filter((record) => record.projectId === projectId).length : list.length

    return [
      { label: '出库记录数量', value: byProject(records.stockOut) },
      { label: '退回记录数量', value: byProject(records.stockReturn) },
      {
        label: '人工记录数量',
        value: byProject(records.labor),
        clickable: true,
        detail: 'labor',
        extra: [
          `今日出工人数 ${new Set(todayLaborRecords.map((record) => record.employeeId).filter(Boolean)).size}`,
          `本月项目人工分摊 ${formatYen(currentMonthLaborRecords.reduce((total, record) => total + toAmount(record.laborCost), 0))}`,
          `异常提醒 ${laborExceptionCount}`,
        ],
      },
      { label: '借工具数量', value: byProject(records.toolBorrow) },
      { label: '还工具数量', value: byProject(records.toolReturn) },
      {
        label: '工具管理',
        value: toolRecords.length,
        clickable: true,
        detail: 'tools',
        extra: [
          `在库 ${toolRecords.filter((tool) => tool.currentStatus === '在库').length}`,
          `临时借出 ${temporaryToolBorrowCount}`,
          `终身领用 ${lifelongToolAssignments.filter((item) => item.responsibilityStatus !== '作废').length}`,
          `未赔偿 ${formatYen(toolUnpaidCompensation)}`,
        ],
      },
      {
        label: '车辆使用记录数量',
        value: projectId
          ? vehicleUsageRecords.filter((record) => record.projectId === projectId).length
          : vehicleUsageRecords.length,
        clickable: true,
        detail: 'vehicle',
        extra: [
          `今日用车 ${vehicleUsageRecords.filter((record) => record.usageDate === todayValue()).length}`,
          `本月里程 ${currentMonthVehicleUsageRecords.reduce((total, record) => total + (Number(record.dailyMileage) || 0), 0)} km`,
          `本月车辆费用 ${formatYen(getVehicleCostTotal(currentMonthFuelRecords, currentMonthVehicleExpenseRecords, currentMonthVehicleIssueRecords))}`,
          `未处理异常 ${vehicleIssueRecords.filter((record) => record.issueStatus !== '已处理').length}`,
        ],
      },
    ]
  }, [
    projectId,
    records,
    vehicleUsageRecords,
    currentMonthVehicleUsageRecords,
    currentMonthFuelRecords,
    currentMonthVehicleExpenseRecords,
    currentMonthVehicleIssueRecords,
    vehicleIssueRecords,
    toolRecords,
    toolBorrowRecords,
    toolReturnRecords,
    lifelongToolAssignments,
    toolResponsibilityRecords,
    temporaryToolBorrowCount,
    toolUnpaidCompensation,
    todayLaborRecords,
    currentMonthLaborRecords,
    laborExceptionCount,
  ])

  const financialScopeProjects = selectedProject ? [selectedProject] : projects

  const financialStats = useMemo(() => {
    const totalContractAmount = financialScopeProjects.reduce(
      (total, project) => total + toAmount(project.adjustedTaxInclusiveAmount),
      0,
    )
    const totalPaidAmount = financialScopeProjects.reduce(
      (total, project) => total + toAmount(project.totalReceivedTaxInclusiveAmount),
      0,
    )
    const totalUnpaidAmount = financialScopeProjects.reduce(
      (total, project) => total + toAmount(project.outstandingTaxInclusiveAmount),
      0,
    )
    const totalPaymentProgress =
      totalContractAmount > 0 ? Math.round((totalPaidAmount / totalContractAmount) * 100) : 0

    return [
      { label: '合同金额合计', value: formatYen(totalContractAmount), tone: 'money' },
      { label: '已收款金额合计', value: formatYen(totalPaidAmount), tone: 'money' },
      { label: '未收款金额合计', value: formatYen(totalUnpaidAmount), tone: 'money' },
      { label: '总体收款进度', value: formatPercent(totalPaymentProgress) },
      {
        label: '进行中项目数量',
        value: financialScopeProjects.filter((project) => project.status === '进行中').length,
      },
      {
        label: '已完工项目数量',
        value: financialScopeProjects.filter((project) => project.status === '已完工').length,
      },
      {
        label: '暂停项目数量',
        value: financialScopeProjects.filter((project) => project.status === '暂停').length,
      },
      {
        label: '未付款项目数量',
        value: financialScopeProjects.filter((project) => project.paymentStatus === '未付款').length,
      },
      {
        label: '部分付款项目数量',
        value: financialScopeProjects.filter((project) => project.paymentStatus === '部分付款')
          .length,
      },
      {
        label: '已付清项目数量',
        value: financialScopeProjects.filter((project) => project.paymentStatus === '已付清').length,
      },
    ]
  }, [financialScopeProjects])

  const profitStats = useMemo(() => {
    const totalProfitAnchorTaxExclusiveAmount = financialScopeProjects.reduce(
      (total, project) => total + getProfitAnchorTaxExclusiveAmount(project),
      0,
    )
    const totalProjectCost = financialScopeProjects.reduce(
      (total, project) =>
        total +
        getProjectCostTotal(project.projectId, projectCostRecords, records.labor) +
        getProjectPurchaseTotal(project.projectId, purchaseRecords) +
        getProjectVehicleCostTotal(
          project.projectId,
          fuelRecords,
          vehicleExpenseRecords,
          vehicleIssueRecords,
        ),
      0,
    )
    const estimatedGrossProfit = totalProfitAnchorTaxExclusiveAmount - totalProjectCost
    const grossProfitRate =
      totalProfitAnchorTaxExclusiveAmount > 0
        ? Math.round((estimatedGrossProfit / totalProfitAnchorTaxExclusiveAmount) * 100)
        : 0

    return [
      {
        label: '利润计算收入（税抜）',
        value: formatYen(totalProfitAnchorTaxExclusiveAmount),
        tone: 'money',
      },
      { label: '项目成本合计', value: formatYen(totalProjectCost), tone: 'money' },
      { label: '预估毛利润', value: formatYen(estimatedGrossProfit), tone: 'money' },
      { label: '毛利率', value: formatPercent(grossProfitRate) },
    ]
  }, [financialScopeProjects, projectCostRecords, records.labor, purchaseRecords, fuelRecords, vehicleExpenseRecords, vehicleIssueRecords])

  const personnelStats = useMemo(() => {
    const visibleEmployees = employees.filter((employee) => !isHiddenSystemEmployee(employee))
    const byStatus = (status) =>
      visibleEmployees.filter((employee) => employee.employmentStatus === status).length

    return [
      { label: '在职人数', value: byStatus('在职') },
      { label: '离职人数', value: byStatus('离职') },
      { label: '休假人数', value: byStatus('休假') },
      { label: '停工人数', value: byStatus('停工') },
      { label: '本月工资发放', value: formatYen(laborAllocationInfo.salaryPaidTotal), tone: 'money' },
      { label: '本月项目人工分摊', value: formatYen(laborAllocationInfo.allocatedLaborCostTotal), tone: 'money' },
      { label: '本月未分摊人工成本', value: formatYen(laborAllocationInfo.unallocatedLaborCost), tone: 'money' },
      { label: '项目人工分摊率', value: formatPercent(laborAllocationInfo.laborAllocationRate) },
      { label: '最高权限人数', value: visibleEmployees.filter((employee) => isSuperAdmin(employee)).length },
      { label: '自定义权限人数', value: visibleEmployees.filter((employee) => employee.role === 'custom').length },
      { label: '普通员工人数', value: visibleEmployees.filter((employee) => employee.role === 'employee').length },
      { label: '老板人数', value: visibleEmployees.filter((employee) => employee.position === '老板').length },
      { label: '操作员人数', value: visibleEmployees.filter((employee) => employee.position === '操作员').length },
      { label: '设计部部长人数', value: visibleEmployees.filter((employee) => employee.position === '设计部部长').length },
    ]
  }, [employees, laborAllocationInfo])

  const dashboardEmployees = employees.filter((employee) => !isHiddenSystemEmployee(employee))
  const departmentStats = countBy(dashboardEmployees, 'department')
  const positionStats = countBy(dashboardEmployees, 'position')
  const levelStats = countBy(dashboardEmployees, 'level')
  const visaWarnings = dashboardEmployees
    .map((employee) => ({ ...employee, remainingDays: daysUntil(employee.visaExpireDate) }))
    .filter(
      (employee) => employee.visaExpireDate && employee.remainingDays !== null && employee.remainingDays <= 90,
    )
    .sort((a, b) => a.remainingDays - b.remainingDays)
  const activePurchases = purchaseRecords.filter((record) => record.purchaseStatus !== '作废')
  const currentMonthPurchases = activePurchases.filter(
    (record) => monthFromDate(record.purchaseDate) === currentMonthValue(),
  )
  const purchaseStats = [
    {
      label: '本月采购总额',
      value: formatYen(currentMonthPurchases.reduce((total, record) => total + toAmount(record.totalCost), 0)),
      tone: 'money',
    },
    { label: '中国采购金额', value: formatYen(sourceTotal(currentMonthPurchases, '中国采购')), tone: 'money' },
    { label: 'Amazon 采购金额', value: formatYen(sourceTotal(currentMonthPurchases, 'Amazon')), tone: 'money' },
    { label: 'Yahoo拍卖金额', value: formatYen(sourceTotal(currentMonthPurchases, 'Yahoo拍卖')), tone: 'money' },
    { label: '东鹏株式会社采购金额', value: formatYen(sourceTotal(currentMonthPurchases, '东鹏株式会社')), tone: 'money' },
    {
      label: '未付款采购金额',
      value: formatYen(activePurchases.reduce((total, record) => total + toAmount(record.unpaidAmount), 0)),
      tone: 'money',
    },
    {
      label: '未入库采购数量',
      value: activePurchases.filter((record) => getPurchaseStockInStatus(record, stockInRecords) === '未入库').length,
    },
    {
      label: '部分入库采购数量',
      value: activePurchases.filter((record) => getPurchaseStockInStatus(record, stockInRecords) === '部分入库').length,
    },
    {
      label: '已入库采购数量',
      value: activePurchases.filter((record) => getPurchaseStockInStatus(record, stockInRecords) === '已入库').length,
    },
    {
      label: '仓库库存总成本',
      value: formatYen(inventoryItems.reduce((total, item) => total + toAmount(item.totalCost), 0)),
      tone: 'money',
    },
  ]

  const detailProjects = financialScopeProjects.filter((project) => {
    const statusMatched = statusFilter ? project.status === statusFilter : true
    const paymentMatched = paymentFilter ? project.paymentStatus === paymentFilter : true
    return statusMatched && paymentMatched
  })

  if (dashboardDetail === 'labor') {
    return (
      <main className="app-shell page-shell">
        <header className="page-header">
          <button className="back-button" type="button" onClick={() => setDashboardDetail('')}>
            返回老板驾驶舱
          </button>
          <div>
            <p className="eyebrow dark-text">人工记录数量</p>
            <h1>人工记录详情</h1>
          </div>
        </header>
        <LaborMovementSection laborRecords={records.labor} employees={employees} projects={projects} />
      </main>
    )
  }

  if (dashboardDetail === 'vehicle') {
    return (
      <main className="app-shell page-shell">
        <header className="page-header">
          <button className="back-button" type="button" onClick={() => setDashboardDetail('')}>
            返回老板驾驶舱
          </button>
          <div>
            <p className="eyebrow dark-text">车辆使用记录数量</p>
            <h1>车辆使用详情</h1>
          </div>
        </header>
        <VehicleDashboardDetail
          projects={projects}
          employees={employees}
          vehicles={vehicles}
          vehicleUsageRecords={vehicleUsageRecords}
          fuelRecords={fuelRecords}
          vehicleExpenseRecords={vehicleExpenseRecords}
          vehicleIssueRecords={vehicleIssueRecords}
        />
      </main>
    )
  }

  if (dashboardDetail === 'tools') {
    return (
      <main className="app-shell page-shell">
        <header className="page-header">
          <button className="back-button" type="button" onClick={() => setDashboardDetail('')}>
            返回老板驾驶舱
          </button>
          <div>
            <p className="eyebrow dark-text">工具管理</p>
            <h1>工具详情</h1>
          </div>
        </header>
        <ToolDashboardDetail
          employees={employees}
          toolRecords={toolRecords}
          toolBorrowRecords={toolBorrowRecords}
          toolReturnRecords={toolReturnRecords}
          lifelongToolAssignments={lifelongToolAssignments}
          toolResponsibilityRecords={toolResponsibilityRecords}
        />
      </main>
    )
  }

  return (
    <PageShell title="老板驾驶舱" subtitle="经营看板 · 利润统计" onBack={onBack}>
      {projects.length === 0 && <EmptyState text="请先在工程项目中新增项目" />}

      <div className="form-panel">
        <ProjectSelect projects={projects} value={projectId} onChange={setProjectId} allowAll />
        {selectedProject && (
          <div className="project-filter-note">
            当前筛选：{selectedProject.projectName}｜{selectedProject.address || '未填写地址'}
          </div>
        )}
      </div>

      <SectionTitle title="收款总览" note={selectedProject ? '当前项目' : '全部项目'} />
      <div className="stats-grid">
        {financialStats.map((item) => (
          <div className={`stat-card ${item.tone || ''}`} key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <SectionTitle title="业务记录汇总" note={selectedProject ? '当前项目' : '全部项目'} />
      <div className="stats-grid">
        {businessStats.map((item) => (
          <button
            className={`stat-card ${item.clickable ? 'clickable-card' : ''}`}
            type="button"
            key={item.label}
            onClick={() => item.clickable && setDashboardDetail(item.detail)}
          >
            <strong>{item.value}</strong>
            <span>{item.label}</span>
            {item.extra && (
              <small>
                {item.extra.map((line) => (
                  <em key={line}>{line}</em>
                ))}
              </small>
            )}
          </button>
        ))}
      </div>

      <SectionTitle title="成本与利润" note={selectedProject ? '当前项目' : '全部项目'} />
      <div className="stats-grid">
        {profitStats.map((item) => (
          <div className={`stat-card ${item.tone || ''}`} key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <SectionTitle title="人员与工资" note={currentMonthValue()} />
      <div className="stats-grid">
        {personnelStats.map((item) => (
          <div className={`stat-card ${item.tone || ''}`} key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="empty-state cost-note">
        工资发放是公司实际支出；项目人工成本是工资向工程项目的分摊，不重复计入公司总成本。
      </div>
      {laborAllocationInfo.isOverAllocated && (
        <div className="empty-state cost-note warning-note">
          项目人工分摊成本超过工资发放总额，请检查人工记录是否重复或工资标准是否错误。
        </div>
      )}

      <SectionTitle title="采购与库存" note={currentMonthValue()} />
      <div className="stats-grid">
        {purchaseStats.map((item) => (
          <div className={`stat-card ${item.tone || ''}`} key={item.label}>
            <strong>{item.value}</strong>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="mini-summary-grid">
        <CountList title="按部门统计人数" items={departmentStats} />
        <CountList title="按职位统计人数" items={positionStats} />
        <CountList title="按星级统计人数" items={levelStats} />
      </div>
      <SectionTitle title="在留期限提醒" note="90天内" />
      <div className="payment-table-wrap">
        {visaWarnings.length === 0 ? (
          <EmptyState text="暂无即将到期人员" />
        ) : (
          <table className="payment-table compact-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>在留资格</th>
                <th>在留期限</th>
                <th>剩余天数</th>
                <th>办理组合/机构</th>
                <th>联系电话</th>
              </tr>
            </thead>
            <tbody>
              {visaWarnings.map((employee) => (
                <tr key={employee.employeeId}>
                  <td>{employee.name}</td>
                  <td>{employee.visaType || '未填写'}</td>
                  <td>{employee.visaExpireDate}</td>
                  <td>{employee.remainingDays} 天</td>
                  <td>{employee.visaAgency || '未填写'}</td>
                  <td>{employee.phone || '未填写'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <SectionTitle title="项目收款明细表" note={`${detailProjects.length} 个项目`} />
      <div className="filter-panel">
        <label className="field">
          <span>项目状态</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">全部</option>
            {statusOptions.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>付款状态</span>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
            <option value="">全部</option>
            {paymentStatusOptions.map((status) => (
              <option value={status} key={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="payment-table-wrap owner-dashboard-project-table-wrap">
        {detailProjects.length === 0 ? (
          <EmptyState text="暂无符合条件的项目收款明细" />
        ) : (
          <table className="payment-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>地址</th>
                <th>项目状态</th>
                <th>开始日期</th>
                <th>工程结束日期</th>
                <th>合同金额</th>
                <th>已收款金额</th>
                <th>未收款金额</th>
                <th>付款进度</th>
                <th>付款状态</th>
                <th>项目成本合计</th>
                <th>项目人工分摊</th>
                <th>项目人工工时</th>
                <th>项目出工人数</th>
                <th>项目出工记录数</th>
                <th>项目采购金额</th>
                <th>项目材料采购金额</th>
                <th>项目工具采购金额</th>
                <th>项目未付款采购金额</th>
                <th>项目未入库采购数量</th>
                <th>项目车辆费用</th>
                <th>项目用车次数</th>
                <th>项目行驶里程</th>
                <th>项目停车费</th>
                <th>项目加油费</th>
                <th>项目高速/ETC费</th>
                <th>项目车辆异常数</th>
                <th>预估毛利润</th>
                <th>毛利率</th>
              </tr>
            </thead>
            <tbody>
              {detailProjects.map((project) => {
                const unpaidAmount = toAmount(project.outstandingTaxInclusiveAmount)
                const projectPurchases = activePurchases.filter(
                  (record) => record.projectId === project.projectId,
                )
                const projectLaborRecords = records.labor
                  .map((record) => normalizeLaborRecord(record))
                  .filter((record) => record.projectId === project.projectId)
                const projectLaborCost = projectLaborRecords.reduce(
                  (total, record) => total + toAmount(record.laborCost),
                  0,
                )
                const projectLaborHours = projectLaborRecords.reduce(
                  (total, record) => total + (Number(record.workHours) || 0),
                  0,
                )
                const projectLaborPeople = new Set(
                  projectLaborRecords.map((record) => record.employeeId).filter(Boolean),
                ).size
                const purchaseTotal = projectPurchases.reduce(
                  (total, record) => total + toAmount(record.totalCost),
                  0,
                )
                const materialPurchaseTotal = projectPurchases
                  .filter((record) => record.purchaseType === '材料')
                  .reduce((total, record) => total + toAmount(record.totalCost), 0)
                const toolPurchaseTotal = projectPurchases
                  .filter((record) => record.purchaseType === '工具')
                  .reduce((total, record) => total + toAmount(record.totalCost), 0)
                const unpaidPurchaseTotal = projectPurchases.reduce(
                  (total, record) => total + toAmount(record.unpaidAmount),
                  0,
                )
                const notStockedPurchaseCount = projectPurchases.filter(
                  (record) => getPurchaseStockInStatus(record, stockInRecords) === '未入库',
                ).length
                const projectVehicleUsage = vehicleUsageRecords.filter(
                  (record) => record.projectId === project.projectId,
                )
                const projectFuel = fuelRecords.filter(
                  (record) => record.allocateToProject && record.projectId === project.projectId,
                )
                const projectVehicleExpenses = vehicleExpenseRecords.filter(
                  (record) => record.allocateToProject && record.projectId === project.projectId,
                )
                const projectVehicleIssues = vehicleIssueRecords.filter(
                  (record) => record.allocateToProject && record.projectId === project.projectId,
                )
                const projectFuelTotal = projectFuel.reduce(
                  (total, record) => total + toAmount(record.fuelAmount),
                  0,
                )
                const projectVehicleExpenseTotal = projectVehicleExpenses.reduce(
                  (total, record) => total + toAmount(record.amount),
                  0,
                )
                const projectIssueTotal = projectVehicleIssues.reduce(
                  (total, record) => total + toAmount(record.repairCost),
                  0,
                )
                const projectVehicleTotal =
                  projectFuelTotal + projectVehicleExpenseTotal + projectIssueTotal
                const projectParkingTotal = projectVehicleExpenses
                  .filter((record) => record.expenseType === '停车费')
                  .reduce((total, record) => total + toAmount(record.amount), 0)
                const projectTollTotal = projectVehicleExpenses
                  .filter((record) => ['高速费', 'ETC'].includes(record.expenseType))
                  .reduce((total, record) => total + toAmount(record.amount), 0)
                const projectMileage = projectVehicleUsage.reduce(
                  (total, record) => total + (Number(record.dailyMileage) || 0),
                  0,
                )
                const profitInfo = getGrossProfitInfo(
                  project,
                  projectCostRecords,
                  records.labor,
                  projectVehicleTotal,
                )
                const estimatedGrossProfit =
                  profitInfo.profitAnchorTaxExclusiveAmount -
                  profitInfo.projectCostTotal -
                  purchaseTotal
                const grossProfitRate =
                  profitInfo.profitAnchorTaxExclusiveAmount > 0
                    ? Math.round(
                        (estimatedGrossProfit / profitInfo.profitAnchorTaxExclusiveAmount) * 100,
                      )
                    : 0

                return (
                  <tr key={project.projectId}>
                    <td>{project.projectName}</td>
                    <td>{project.address || '未填写'}</td>
                    <td>{project.status}</td>
                    <td>{project.startDate || '未填写'}</td>
                    <td>{project.endDate || '未结束'}</td>
                    <td>{formatYen(project.adjustedTaxInclusiveAmount)}</td>
                    <td>{formatYen(project.totalReceivedTaxInclusiveAmount)}</td>
                    <td>{formatYen(unpaidAmount)}</td>
                    <td>
                      <PaymentProgress project={project} />
                    </td>
                    <td>
                      <span className={`payment-badge ${project.paymentStatus}`}>
                        {project.paymentStatus}
                      </span>
                    </td>
                    <td>{formatYen(profitInfo.projectCostTotal + purchaseTotal)}</td>
                    <td>{formatYen(projectLaborCost)}</td>
                    <td>{projectLaborHours}</td>
                    <td>{projectLaborPeople}</td>
                    <td>{projectLaborRecords.length}</td>
                    <td>{formatYen(purchaseTotal)}</td>
                    <td>{formatYen(materialPurchaseTotal)}</td>
                    <td>{formatYen(toolPurchaseTotal)}</td>
                    <td>{formatYen(unpaidPurchaseTotal)}</td>
                    <td>{notStockedPurchaseCount}</td>
                    <td>{formatYen(projectVehicleTotal)}</td>
                    <td>{projectVehicleUsage.length}</td>
                    <td>{projectMileage} km</td>
                    <td>{formatYen(projectParkingTotal)}</td>
                    <td>{formatYen(projectFuelTotal)}</td>
                    <td>{formatYen(projectTollTotal)}</td>
                    <td>{projectVehicleIssues.length}</td>
                    <td>{formatYen(estimatedGrossProfit)}</td>
                    <td>{formatPercent(grossProfitRate)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </PageShell>
  )
}

function PageShell({ title, subtitle, onBack, action, children }) {
  return (
    <main className="app-shell page-shell">
      <header className="page-header">
        <button className="back-button" type="button" onClick={onBack}>
          返回首页
        </button>
        <div>
          <p className="eyebrow dark-text">{subtitle}</p>
          <h1>{title}</h1>
        </div>
        {action && <div className="page-action">{action}</div>}
      </header>
      {children}
    </main>
  )
}

function ProjectSelect({ projects, value, onChange, allowAll = false }) {
  return (
    <label className="field full-width">
      <span>工程项目</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {allowAll ? (
          <option value="">全部工程项目</option>
        ) : (
          <option value="">请选择工程项目</option>
        )}
        {projects.map((project) => (
          <option value={project.projectId} key={project.projectId}>
            {project.projectName}｜{project.address || '未填写地址'}
          </option>
        ))}
      </select>
    </label>
  )
}

function VehicleSelect({ vehicles, value, onChange, allowAll = false }) {
  const [query, setQuery] = useState('')
  const availableVehicles = vehicles.filter((vehicle) => {
    if (!query.trim()) return true
    return `${vehicle.vehicleName}${vehicle.plateNumber}`.includes(query.trim())
  })

  return (
    <div className="person-select">
      <Field label="搜索车辆" value={query} onChange={setQuery} placeholder="输入车辆名称或车牌" />
      <label className="field full-width">
        <span>车辆</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {allowAll ? <option value="">全部车辆</option> : <option value="">请选择车辆</option>}
          {availableVehicles.map((vehicle) => (
            <option value={vehicle.vehicleId} key={vehicle.vehicleId}>
              {vehicle.vehicleName}｜{vehicle.plateNumber}｜{vehicle.status}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function ToolSelect({ tools, value, onChange, allowAll = false }) {
  const [query, setQuery] = useState('')
  const availableTools = tools.filter((tool) => {
    const keyword = query.trim()
    if (!keyword) return true
    return `${tool.toolName}${tool.specification}${tool.brand}${tool.serialNumber}`.includes(keyword)
  })

  return (
    <div className="person-select">
      <Field label="搜索工具" value={query} onChange={setQuery} placeholder="输入工具名称、品牌或编号" />
      <label className="field full-width">
        <span>工具</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          {allowAll ? <option value="">全部工具</option> : <option value="">请选择工具</option>}
          {availableTools.map((tool) => (
            <option value={tool.toolId} key={tool.toolId}>
              {tool.toolName}｜{tool.specification || '无规格'}｜{tool.serialNumber || '无编号'}｜{tool.currentStatus}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function EmployeeSelect({
  employees,
  value,
  onChange,
  label,
  allowExternal = false,
  externalValue = '',
  onExternalChange = () => {},
}) {
  const [showResigned, setShowResigned] = useState(false)
  const availableEmployees = employees.filter(
    (employee) =>
      !isHiddenSystemEmployee(employee) &&
      (showResigned || employee.employmentStatus !== '离职'),
  )

  return (
    <div className="person-select">
      <label className="field full-width">
        <span>{label}</span>
        <select
          value={value || (allowExternal && externalValue ? '__external__' : '')}
          onChange={(event) => {
            const nextValue = event.target.value
            if (nextValue === '__external__') {
              onChange('')
              return
            }
            onExternalChange('')
            onChange(nextValue)
          }}
        >
          <option value="">请选择员工</option>
          {availableEmployees.map((employee) => (
            <option value={employee.employeeId} key={employee.employeeId}>
              {employee.name}｜{employee.department}｜{employee.position}｜{employee.level}
            </option>
          ))}
          {allowExternal && <option value="__external__">外部人员手动输入</option>}
        </select>
      </label>
      <label className="toggle-line">
        <input
          type="checkbox"
          checked={showResigned}
          onChange={(event) => setShowResigned(event.target.checked)}
        />
        <span>显示离职人员</span>
      </label>
      {allowExternal && !value && (
        <Field
          label="外部人员"
          value={externalValue}
          onChange={onExternalChange}
          placeholder="例如 外包人员姓名"
        />
      )}
    </div>
  )
}

function EmployeeMultiSelect({
  employees,
  selectedIds,
  onChange,
  assignedEmployeeIds = [],
  assignmentInfoByEmployee = {},
  showAssignedEmployees = false,
}) {
  const [query, setQuery] = useState('')
  const [showResigned, setShowResigned] = useState(false)
  const availableEmployees = employees.filter((employee) => {
    if (isHiddenSystemEmployee(employee)) return false
    const isAssigned = assignedEmployeeIds.includes(employee.employeeId)
    if (isAssigned && !showAssignedEmployees) return false
    const statusMatched = showResigned || employee.employmentStatus === '在职'
    const queryMatched = query ? employee.name.includes(query.trim()) : true
    return statusMatched && queryMatched
  })
  const selectedEmployees = employees.filter(
    (employee) => !isHiddenSystemEmployee(employee) && selectedIds.includes(employee.employeeId),
  )

  const toggleEmployee = (employeeId) => {
    if (selectedIds.includes(employeeId)) {
      onChange(selectedIds.filter((id) => id !== employeeId))
    } else {
      onChange([...selectedIds, employeeId])
    }
  }

  return (
    <div className="multi-select-panel">
      <div className="multi-select-header">
        <Field label="搜索员工姓名" value={query} onChange={setQuery} placeholder="输入姓名搜索" />
        <label className="toggle-line">
          <input
            type="checkbox"
            checked={showResigned}
            onChange={(event) => setShowResigned(event.target.checked)}
          />
          <span>显示离职人员</span>
        </label>
      </div>
      {employees.length === 0 ? (
        <EmptyState text="请先在人员管理中新增员工" />
      ) : (
        <>
          <div className="selected-strip">
            <span>已选 {selectedIds.length} 人</span>
            <button className="ghost-button" type="button" onClick={() => onChange([])}>
              清空已选员工
            </button>
          </div>
          {selectedEmployees.length > 0 && (
            <div className="selected-tags">
              {selectedEmployees.map((employee) => (
                <button
                  type="button"
                  key={employee.employeeId}
                  onClick={() => toggleEmployee(employee.employeeId)}
                >
                  {employee.name} ×
                </button>
              ))}
            </div>
          )}
          <div className="employee-option-grid">
            {availableEmployees.map((employee) => (
              <label
                className={`employee-option ${
                  assignedEmployeeIds.includes(employee.employeeId) ? 'assigned' : ''
                }`}
                key={employee.employeeId}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(employee.employeeId)}
                  onChange={() => toggleEmployee(employee.employeeId)}
                />
                <span>
                  <strong>{employee.name}</strong>
                  <small>{employee.department}｜{employee.position}｜{employee.level}</small>
                  {assignedEmployeeIds.includes(employee.employeeId) && (
                    <small className="assigned-label">
                      已安排：{getLaborPlaceLabel(assignmentInfoByEmployee[employee.employeeId]?.[0] || {})}
                    </small>
                  )}
                </span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="field readonly-field">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function PaymentProgress({ project }) {
  const progress = Math.max(0, Math.min(Number(project.paymentProgress) || 0, 100))

  return (
    <div className="payment-progress">
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <strong>{formatPercent(project.paymentProgress)}</strong>
    </div>
  )
}

function PermissionCheckboxGroup({ title, options, value, onChange, disabled = false }) {
  const selectedValues = Array.isArray(value) ? value : []
  const isAll = selectedValues.includes('all')

  const toggleOption = (option) => {
    if (disabled || isAll) return
    if (selectedValues.includes(option)) {
      onChange(selectedValues.filter((item) => item !== option))
    } else {
      onChange([...selectedValues, option])
    }
  }

  return (
    <div className="permission-panel">
      <div className="permission-panel-title">
        <span>{title}</span>
        <button className="ghost-button" type="button" onClick={() => onChange([])} disabled={disabled}>
          清空
        </button>
      </div>
      {isAll ? (
        <div className="selected-strip"><span>全部权限</span></div>
      ) : (
        <div className="employee-option-grid">
          {options.map((option) => (
            <label className="employee-option" key={option}>
              <input
                type="checkbox"
                checked={selectedValues.includes(option)}
                onChange={() => toggleOption(option)}
                disabled={disabled}
              />
              <span>
                <strong>{option}</strong>
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function SectionTitle({ title, note }) {
  return (
    <div className="subsection-title">
      <h2>{title}</h2>
      {note && <span>{note}</span>}
    </div>
  )
}

function CountList({ title, items }) {
  return (
    <div className="count-list">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p>暂无数据</p>
      ) : (
        items.map((item) => (
          <div className="count-row" key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))
      )}
    </div>
  )
}

function OptionField({ label, value, onChange, options, includeAll = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {includeAll && <option value="">全部</option>}
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  )
}

function FormGroup({ title, children }) {
  return (
    <fieldset className="form-group">
      <legend>{title}</legend>
      <div className="form-grid">{children}</div>
    </fieldset>
  )
}

function Field({ label, type = 'text', value, onChange, placeholder, required = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          rows="3"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
    </label>
  )
}

function EmptyState({ text }) {
  return <div className="empty-state">{text}</div>
}

function fieldLabel(fields, fieldName) {
  const labels = {
    employeeName: '人员',
    workDate: '工作日期',
    workHours: '工时',
    laborCost: '项目人工分摊',
  }

  return fields.find((field) => field.name === fieldName)?.label || labels[fieldName] || fieldName
}

export default App

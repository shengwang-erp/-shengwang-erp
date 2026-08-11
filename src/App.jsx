import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  getList,
  isCloudDatabaseReady,
  migrateLocalStorageToSupabase,
  saveList,
  softDelete,
  upsertRecord,
} from './services/baseRecordService'
import {
  buildProjectRevenueReadModel,
  buildProjectRevenueSnapshotCollection,
} from './features/contract-revenue/contractRevenueCalculations'
import ContractRevenuePage from './features/contract-revenue/ContractRevenuePage'
import ContractRevenueMigrationPanel from './features/contract-revenue/ContractRevenueMigrationPanel'
import ProjectPage from './features/projects/ProjectPage'
import MiraisyaProjectPanel from './features/miraisya/MiraisyaProjectPanel.jsx'
import MiraisyaSettlementPage from './features/miraisya/MiraisyaSettlementPage.jsx'
import {
  PROJECT_STATUS_OPTIONS,
  normalizeProject as normalizeProjectDomain,
} from './features/projects/projectDomain'
import PersonnelPage from './features/employees/PersonnelPage'
import TodayAttendancePage from './features/attendance/TodayAttendancePage.jsx'
import LaborAccountingPage from './features/labor-accounting/LaborAccountingPage.jsx'
import useLaborAlertCount from './features/labor-accounting/useLaborAlertCount.js'
import PurchaseAccountingSection from './features/purchase-accounting/PurchaseAccountingSection.jsx'
import { createManualProjectCostPersistence } from './features/cost-accounting/projectCostPersistence.js'
import ExecutiveDashboardPage from './features/executive-dashboard/ExecutiveDashboardPage.jsx'
import { buildExecutiveDashboardReadModel } from './features/executive-dashboard/executiveDashboardDomain.js'
import { buildMonthWindow } from './features/executive-dashboard/dashboardTime.js'
import {
  buildCostAccountingReadModel,
  isSafeCostAccountingAmount,
} from './features/cost-accounting/costAccountingDomain.js'
import {
  bridgeWarehouseMaterialCosts,
  warehouseMaterialCostBridge,
} from './features/cost-accounting/warehouseMaterialCostBridge.js'
import {
  assertManualProjectCostMutable,
  isWarehouseManagedProjectCost,
} from './features/warehouse/warehouseAccounting.js'
import { buildLaborCostWindow } from './features/cost-accounting/laborCostWindow.js'
import {
  buildPurchaseAccountingReadModel,
  canApplyPurchasePayment,
  recalculatePurchasePaymentCache,
} from './features/purchase-accounting/purchaseAccountingDomain.js'
import {
  PURCHASE_PAYMENT_CASH_SCHEMA,
  VEHICLE_EXPENSE_CASH_SCHEMA,
  VEHICLE_FUEL_CASH_SCHEMA,
  markCashFactAsRecorded,
  normalizeCashFactProvenance,
} from './features/cost-accounting/cashFactProvenance.js'
import {
  canRequestLaborAccountingBridge,
  isLaborAccountingMonth,
  normalizeBridgeSummary,
} from './features/labor-accounting/laborAccountingBridge.js'
import {
  combinePersonnelProtectionSources,
  shouldBlockPersonnelExit,
} from './features/employees/personnelCriticalState.js'
import DesktopAdminShell from './DesktopAdminShell'
import MobileMessagesPage from './features/workbench/MobileMessagesPage.jsx'
import MobileProfilePage from './features/workbench/MobileProfilePage.jsx'
import MobileWorkbenchPage from './features/workbench/MobileWorkbenchPage.jsx'
import {
  buildUnavailableHomeFinancialState,
  buildAuthorizedHomeModel,
  getAuthorizedHomeSummary,
} from './features/workbench/authorizedHomeModel.js'
import {
  buildAuthorizedMessages,
  buildWorkbenchItems,
  resolveDashboardBridgeMonth,
} from './features/workbench/workbenchModel.js'
import AuthGate from './auth/AuthGate'
import { employeeAdminService } from './services/employeeAdminService'
import { permissionTemplateService } from './services/permissionTemplateService'
import { initializeOriginalContractProject } from './features/contract-revenue/originalContract'
import { previewLocalContractRevenueMigration } from './services/contractRevenueLocalMigration'
import { persistLegacyContractRevenueMigration } from './services/contractRevenueMigration.js'
import { supabase } from './lib/supabaseClient.js'
import { projectService } from './services/projectService.js'
import { miraisyaBillingService } from './services/miraisyaBillingService.js'
import { miraisyaSettlementService } from './services/miraisyaSettlementService.js'
import { laborAccountingService } from './services/laborAccountingService.js'
import { createDashboardLaborBridgeLoader } from './services/dashboardLaborBridgeService.js'
import { purchaseService } from './services/purchaseService.js'
import { createProjectCostLedgerService } from './services/projectCostLedgerService.js'
import { createProjectCostLedgerDemoService } from './features/project-cost-ledger/projectCostLedgerDemoService.js'
import ProjectCostLedgerSection from './features/project-cost-ledger/ProjectCostLedgerSection.jsx'
import { loadCompleteProjectCostLedgerSnapshot } from './features/project-cost-ledger/projectCostLedgerExport.js'
import './features/project-cost-ledger/projectCostLedger.css'
import { createWarehouseService } from './services/warehouseService.js'
import { createWarehouseConfirmationService } from './services/warehouseConfirmationService.js'
import { createWarehouseMediaService } from './services/warehouseMediaService.js'
import {
  createOfflinePurchaseArrivalContext,
  purchaseWarehouseBridge,
  resolvePurchaseArrivalStatus,
} from './features/warehouse/purchaseWarehouseBridge.js'

const WarehouseManagementPage = lazy(() => import('./features/warehouse/WarehouseManagementPage.jsx'))
const WarehouseRequestPage = lazy(() => import('./features/warehouse/WarehouseRequestPage.jsx'))
export { ProjectCostLedgerSection }
import {
  classifyBusinessSourceError,
  toBusinessSourceState,
} from './services/businessSourceState.js'
import {
  canUpdateProjectFinancials,
  canViewProjectFinancials,
} from './features/projects/projectPermissions.js'
import {
  canAccessView,
  getAccountingAccess,
  getDashboardAccess,
  getProjectReferenceAccess,
  getPurchaseAccess,
  getVisibleAdminRoutes,
  getWarehouseAccess,
} from './auth/businessAccess.js'
export { getProjectReferenceAccess } from './auth/businessAccess.js'
import { getAdminRoute } from './navigation/adminRoutes.js'

const localDemoMode = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEMO_MODE === 'true'
import {
  CONTRACT_REVENUE_STORAGE_KEYS,
  createContractChange as persistContractChange,
  createPaymentPlan as persistCreatePaymentPlan,
  createProjectReceipt as persistCreateCustomerReceipt,
  sanitizeProjectForPersistence,
  updatePaymentPlan as persistUpdatePaymentPlan,
  voidContractChange as persistVoidContractChange,
  voidProjectReceipt as persistVoidCustomerReceipt,
  loadContractChanges,
  loadPaymentPlans,
  loadProjectReceipts,
} from './services/contractRevenueService'
import {
  canEdit,
  isHiddenSystemEmployee,
  isSuperAdmin,
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
}

const MIGRATABLE_STORAGE_KEYS = Object.values(STORAGE_KEYS).filter(
  (storageKey) => storageKey !== STORAGE_KEYS.employees,
)

const manualProjectCostPersistence = createManualProjectCostPersistence({
  upsertRecord,
  softDelete,
  storageKey: STORAGE_KEYS.projectCostRecords,
})

const configuredProjectCostLedgerService = createProjectCostLedgerService(supabase, {
  configured: Boolean(supabase),
})
const localProjectCostLedgerEventStore = {
  adjustments: [],
  allocations: [],
  manualEntries: [],
}

const statusOptions = PROJECT_STATUS_OPTIONS
const DASHBOARD_PROJECT_STATUSES = new Set(['all', ...PROJECT_STATUS_OPTIONS])
const DASHBOARD_RANKING_METRICS = new Set(['profit', 'margin', 'revenue', 'confirmedCost'])
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
const stockInStatusOptions = ['未入库', '待仓库确认', '部分入库', '已入库']
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
  const projectMaster = normalizeProjectDomain(project)
  const contractAmount = toAmount(project.contractAmount)
  const paidAmount = toAmount(project.paidAmount)
  const paymentInfo = getPaymentInfo(contractAmount, paidAmount)

  return {
    ...projectMaster,
    contractAmount,
    paidAmount,
    paymentProgress: paymentInfo.paymentProgress,
    paymentStatus: paymentInfo.paymentStatus,
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
    source: employee.source || '',
    wecomUserId: employee.wecomUserId || '',
    wecomDepartmentId: employee.wecomDepartmentId || '',
    wecomDepartmentName: employee.wecomDepartmentName || '',
    isHiddenSystemAccount: Boolean(employee.isHiddenSystemAccount),
    remark: employee.remark || '',
    createdAt: employee.createdAt || now,
    updatedAt: employee.updatedAt || now,
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
  return isSuperAdmin(currentUser) || canEdit(currentUser, '人工记录')
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
      type: '历史出工冲突（非考勤提醒）',
      message,
      record,
    }))
  })

  const duplicateExceptions = getDuplicateLaborAssignmentGroups(normalizedRecords).map((items) => {
    const [firstRecord, secondRecord] = items
    return {
      id: `duplicate-${firstRecord.workDate}-${firstRecord.employeeId}`,
      type: '历史出工冲突：同日重复安排（非考勤提醒）',
      message: `员工${firstRecord.employeeName}在 ${firstRecord.workDate} 已有多条出工记录，请确认是否合理。`,
      record: secondRecord || firstRecord,
      relatedRecord: firstRecord,
      records: items,
    }
  })

  const timeConflictExceptions = getLaborTimeConflictPairs(normalizedRecords).map(
    ([firstRecord, secondRecord]) => ({
      id: `time-conflict-${firstRecord.laborRecordId}-${secondRecord.laborRecordId}`,
      type: '历史出工冲突：时间重叠（非考勤提醒）',
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
  const cashFact = normalizeCashFactProvenance(record, VEHICLE_FUEL_CASH_SCHEMA, {
    defaultDate: todayValue(),
    defaultPaymentMethod: '现金',
  })
  const allocateToProject = Boolean(cashFact.allocateToProject)

  return {
    fuelRecordId: cashFact.fuelRecordId || '',
    fuelDate: cashFact.fuelDate,
    fuelDateSource: cashFact.fuelDateSource,
    fuelDateLegacyInferred: cashFact.fuelDateLegacyInferred,
    vehicleId: cashFact.vehicleId || '',
    plateNumber: cashFact.plateNumber || '',
    vehicleName: cashFact.vehicleName || '',
    employeeId: cashFact.employeeId || '',
    employeeName: cashFact.employeeName || '',
    fuelStation: cashFact.fuelStation || '',
    fuelType: cashFact.fuelType || '汽油',
    fuelLiters: Number(cashFact.fuelLiters) || 0,
    fuelAmount: toAmount(cashFact.fuelAmount),
    mileageAtFuel: Number(cashFact.mileageAtFuel) || 0,
    paymentMethod: cashFact.paymentMethod,
    paymentMethodSource: cashFact.paymentMethodSource,
    paymentMethodLegacyInferred: cashFact.paymentMethodLegacyInferred,
    allocateToProject,
    projectId: allocateToProject ? cashFact.projectId || '' : '',
    projectName: allocateToProject ? cashFact.projectName || '' : '',
    remark: cashFact.remark || '',
    createdAt: cashFact.createdAt || todayValue(),
  }
}

function normalizeSubmittedFuelRecord(record) {
  return normalizeFuelRecord(markCashFactAsRecorded(record, VEHICLE_FUEL_CASH_SCHEMA))
}

function normalizeVehicleExpenseRecord(record) {
  const cashFact = normalizeCashFactProvenance(record, VEHICLE_EXPENSE_CASH_SCHEMA, {
    defaultDate: todayValue(),
    defaultPaymentMethod: '现金',
  })
  const allocateToProject = Boolean(cashFact.allocateToProject)

  return {
    vehicleExpenseId: cashFact.vehicleExpenseId || '',
    expenseDate: cashFact.expenseDate,
    expenseDateSource: cashFact.expenseDateSource,
    expenseDateLegacyInferred: cashFact.expenseDateLegacyInferred,
    vehicleId: cashFact.vehicleId || '',
    plateNumber: cashFact.plateNumber || '',
    vehicleName: cashFact.vehicleName || '',
    expenseType: cashFact.expenseType || '停车费',
    amount: toAmount(cashFact.amount),
    paymentMethod: cashFact.paymentMethod,
    paymentMethodSource: cashFact.paymentMethodSource,
    paymentMethodLegacyInferred: cashFact.paymentMethodLegacyInferred,
    employeeId: cashFact.employeeId || '',
    employeeName: cashFact.employeeName || '',
    allocateToProject,
    projectId: allocateToProject ? cashFact.projectId || '' : '',
    projectName: allocateToProject ? cashFact.projectName || '' : '',
    remark: cashFact.remark || '',
    createdAt: cashFact.createdAt || todayValue(),
  }
}

function normalizeSubmittedVehicleExpenseRecord(record) {
  return normalizeVehicleExpenseRecord(
    markCashFactAsRecorded(record, VEHICLE_EXPENSE_CASH_SCHEMA),
  )
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

export function normalizeToolResponsibilityRecord(record) {
  const allocateToProject = Boolean(record.allocateToProject)
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
    allocateToProject,
    projectId: allocateToProject ? record.projectId || '' : '',
    projectName: allocateToProject ? record.projectName || '' : '',
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

function getPurchaseArrivalSummary(purchaseId, arrivalPurchases) {
  return Array.isArray(arrivalPurchases)
    ? arrivalPurchases.find((row) => row.purchaseRecordKey === purchaseId) || null
    : null
}

function normalizePurchaseRecord(record) {
  const amounts = calculatePurchaseAmounts(record)
  const hasPaymentFacts = [
    'openingPaidAmount',
    'paidAmount',
    'unpaidAmount',
    'paymentStatus',
  ].some((field) => Object.hasOwn(record, field))
  const openingPaidAmount = Number(record.openingPaidAmount)
  const normalizedOpeningPaidAmount = Math.round(openingPaidAmount)
  const hasOpeningPaidAmount = record.openingPaidAmount !== undefined &&
    record.openingPaidAmount !== null &&
    !(typeof record.openingPaidAmount === 'string' && record.openingPaidAmount.trim() === '') &&
    openingPaidAmount >= 0 &&
    Number.isSafeInteger(normalizedOpeningPaidAmount) &&
    normalizedOpeningPaidAmount >= 0

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
    ...(hasPaymentFacts
      ? {
          paymentStatus: amounts.paymentStatus,
          paidAmount: amounts.paidAmount,
          unpaidAmount: amounts.unpaidAmount,
          ...(hasOpeningPaidAmount
            ? { openingPaidAmount: normalizedOpeningPaidAmount }
            : {}),
        }
      : {}),
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
  const cashFact = normalizeCashFactProvenance(record, PURCHASE_PAYMENT_CASH_SCHEMA, {
    defaultDate: todayValue(),
  })
  const paymentAmount = Number(cashFact.paymentAmount) || 0
  const exchangeRate = Number(cashFact.exchangeRate) || 0.048
  const jpyAmount = cashFact.currency === 'CNY' ? paymentAmount / exchangeRate : paymentAmount

  return {
    paymentId: cashFact.paymentId,
    purchaseId: cashFact.purchaseId || '',
    paymentDate: cashFact.paymentDate,
    paymentDateSource: cashFact.paymentDateSource,
    paymentDateLegacyInferred: cashFact.paymentDateLegacyInferred,
    paymentAmount,
    currency: cashFact.currency || 'JPY',
    exchangeRate,
    jpyAmount: Math.round(jpyAmount),
    paymentMethod: cashFact.paymentMethod || '银行转账',
    employeeId: cashFact.employeeId || '',
    employeeName: cashFact.employeeName || '',
    remark: cashFact.remark || '',
  }
}

function normalizeSubmittedPurchasePaymentRecord(record) {
  return normalizePurchasePaymentRecord(
    markCashFactAsRecorded(record, PURCHASE_PAYMENT_CASH_SCHEMA),
  )
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
    ...(Object.hasOwn(record, 'sourceType') ? { sourceType: record.sourceType } : {}),
    ...(Object.hasOwn(record, 'sourceDocumentId')
      ? { sourceDocumentId: record.sourceDocumentId }
      : {}),
    ...(Object.hasOwn(record, 'sourceDocumentType')
      ? { sourceDocumentType: record.sourceDocumentType }
      : {}),
    ...(Object.hasOwn(record, 'sourcePurchaseRecordKeys')
      ? {
          sourcePurchaseRecordKeys: Array.isArray(record.sourcePurchaseRecordKeys)
            ? [...record.sourcePurchaseRecordKeys]
            : record.sourcePurchaseRecordKeys,
        }
      : {}),
    ...(Object.hasOwn(record, 'sourceStockOutIds')
      ? {
          sourceStockOutIds: Array.isArray(record.sourceStockOutIds)
            ? [...record.sourceStockOutIds]
            : record.sourceStockOutIds,
        }
      : {}),
    ...(Object.hasOwn(record, 'createdAt') ? { createdAt: record.createdAt } : {}),
    ...(Object.hasOwn(record, 'updatedAt') ? { updatedAt: record.updatedAt } : {}),
    ...(Object.hasOwn(record, 'updatedByEmployeeId')
      ? { updatedByEmployeeId: record.updatedByEmployeeId }
      : {}),
    ...(Object.hasOwn(record, 'updatedByEmployeeName')
      ? { updatedByEmployeeName: record.updatedByEmployeeName }
      : {}),
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

function strictRawSourceState(rawState) {
  try {
    if (rawState === null || typeof rawState !== 'object' || Array.isArray(rawState)) {
      throw new TypeError()
    }
    const prototype = Object.getPrototypeOf(rawState)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError()
    const descriptors = Object.getOwnPropertyDescriptors(rawState)
    if (Object.hasOwn(descriptors, 'status')) throw new TypeError()
    const snapshot = {}
    for (const key of ['loading', 'error', 'code', 'source', 'updatedAt']) {
      const descriptor = descriptors[key]
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      snapshot[key] = descriptor.value
    }
    if (typeof snapshot.loading !== 'boolean' ||
        typeof snapshot.error !== 'string' ||
        typeof snapshot.code !== 'string' ||
        typeof snapshot.source !== 'string' ||
        (snapshot.updatedAt !== null && typeof snapshot.updatedAt !== 'string')) {
      throw new TypeError()
    }
    return snapshot
  } catch {
    return {
      loading: false,
      error: '业务数据状态无效',
      code: 'DATA_OPERATION_FAILED',
      source: 'blocked',
      updatedAt: null,
    }
  }
}

function projectRawBusinessSource(rawState, options = {}) {
  const strictState = strictRawSourceState(rawState)
  return Object.freeze(toBusinessSourceState(strictState, {
    readAllowed: options.readAllowed !== false,
    data: options.data ?? null,
    stale: options.stale === true,
    updatedAt: strictState.updatedAt,
  }))
}

export function projectPersistentSource(rawState, options = {}) {
  return projectRawBusinessSource(rawState, options)
}

export function projectPromiseSource(rawState, options = {}) {
  return projectRawBusinessSource(rawState, options)
}

export function projectLaborSource(rawState, options = {}) {
  return projectRawBusinessSource(rawState, options)
}

function warehouseBridgeUnavailableState(states) {
  if (states.some((state) => state?.stale === true || state?.status === 'loading')) {
    return Object.freeze({ status: 'loading', data: null, stale: false })
  }
  if (states.some((state) => state?.status === 'error')) {
    return Object.freeze({ status: 'error', data: null, stale: false })
  }
  if (states.some((state) => state?.status === 'forbidden')) {
    return Object.freeze({ status: 'forbidden', data: null, stale: false })
  }
  return Object.freeze({ status: 'error', data: null, stale: false })
}

export function buildWarehouseAccountingSourceStates({
  purchaseLedgerAccrual,
  projectCosts,
  warehouseContext,
}) {
  const requiredStates = [purchaseLedgerAccrual, projectCosts, warehouseContext]
  const ready = requiredStates.every((state) => (
    state?.status === 'ready' && state.stale !== true && state.data !== null
  ))
  if (!ready || !Array.isArray(purchaseLedgerAccrual.data) ||
      !Array.isArray(projectCosts.data)) {
    return Object.freeze({
      purchaseLedgerAccrual,
      purchaseAccrual: warehouseBridgeUnavailableState(requiredStates),
      projectCosts,
    })
  }
  try {
    const bridged = bridgeWarehouseMaterialCosts({
      purchaseRows: purchaseLedgerAccrual.data,
      projectCostRecords: projectCosts.data,
      trackedPurchaseRecordKeys: warehouseContext.data.trackedPurchaseRecordKeys,
    })
    return Object.freeze({
      purchaseLedgerAccrual,
      purchaseAccrual: Object.freeze({
        ...purchaseLedgerAccrual,
        data: bridged.purchaseRows,
      }),
      projectCosts,
    })
  } catch {
    return Object.freeze({
      purchaseLedgerAccrual,
      purchaseAccrual: Object.freeze({ status: 'error', data: null, stale: false }),
      projectCosts,
    })
  }
}

export function bindWarehouseContextToActor(state, actorKey) {
  if (typeof actorKey !== 'string' || actorKey.length === 0 || state?.actorKey !== actorKey) {
    return Object.freeze({ status: 'loading', data: null, stale: false, actorKey })
  }
  return state
}

function usePersistentState(key, fallback, options = {}) {
  const cloudPersistence = localDemoMode ? 'none' : options.cloudPersistence || 'list'
  const cloudRead = localDemoMode ? false : options.cloudRead !== false
  const readAllowed = options.readAllowed !== false
  const localCompatibility = options.localCompatibility === true
  const readOnly = options.readOnly === true
  const cloudLoader = options.cloudLoader || getList
  const cloudSaver = options.cloudSaver || saveList
  const [value, setValue] = useState(() =>
    readAllowed && localCompatibility ? readStorage(key, fallback) : fallback,
  )
  const [cloudState, setCloudState] = useState(() => readAllowed
    ? {
        loading: cloudRead,
        error: '',
        code: '',
        source: localCompatibility ? 'compatibility-local' : 'supabase',
        updatedAt: null,
      }
    : {
        loading: false,
        error: '无权读取该数据',
        code: 'ACCESS_DENIED',
        source: 'blocked',
        updatedAt: null,
      })

  const failClosed = (error, message, { write = false } = {}) => {
    const classification = classifyBusinessSourceError(error)
    setValue(fallback)
    window.localStorage.removeItem(key)
    setCloudState({
      loading: false,
      error: classification.status === 'forbidden' ? classification.message : message,
      code: classification.code,
      source: 'blocked',
      updatedAt: null,
    })
    const failure = {
      key,
      code: classification.code,
      httpStatus: error?.status || 503,
      message,
    }
    if (write) {
      options.onWriteError?.(failure)
      return classification
    }
    if (classification.status === 'forbidden') {
      return classification
    }
    if (classification.fatal) options.onFatalError?.(failure)
    return classification
  }

  useEffect(() => {
    let isMounted = true

    async function loadCloudValue() {
      if (!readAllowed) {
        setValue(fallback)
        window.localStorage.removeItem(key)
        setCloudState({
          loading: false,
          error: '无权读取该数据',
          code: 'ACCESS_DENIED',
          source: 'blocked',
          updatedAt: null,
        })
        return
      }
      if (!cloudRead) {
        setCloudState({
          loading: false,
          error: '',
          code: '',
          source: localCompatibility ? 'compatibility-local' : 'disabled',
          updatedAt: null,
        })
        return
      }
      if (!isCloudDatabaseReady()) {
        failClosed(
          { code: 'CONFIGURATION_ERROR' },
          '云端数据服务未配置，已停止访问业务数据。',
        )
        return
      }

      setCloudState((current) => ({ ...current, loading: true, error: '', code: '' }))
      try {
        const cloudValue = await cloudLoader(key)
        if (!isMounted || cloudValue === undefined) return
        setValue(cloudValue)
        window.localStorage.setItem(key, JSON.stringify(cloudValue))
        setCloudState({
          loading: false,
          error: '',
          code: '',
          source: 'supabase',
          updatedAt: new Date().toISOString(),
        })
      } catch (error) {
        console.error(`Supabase 读取失败: ${key}`, error)
        if (isMounted) failClosed(error, '云端数据读取失败，已停止访问业务数据。')
      }
    }

    loadCloudValue()

    return () => {
      isMounted = false
    }
  }, [key, cloudLoader, cloudRead, localCompatibility, readAllowed])

  const updateValue = (nextValue, updateOptions = {}) => {
    setValue((currentValue) => {
      if (readOnly || !readAllowed) return currentValue
      const resolvedValue =
        typeof nextValue === 'function' ? nextValue(currentValue) : nextValue
      if (updateOptions.stateOnly) {
        if (updateOptions.syncLocal) {
          window.localStorage.setItem(key, JSON.stringify(resolvedValue))
        }
        return resolvedValue
      }

      if (cloudPersistence === 'record') {
        window.localStorage.setItem(key, JSON.stringify(resolvedValue))
        return resolvedValue
      }

      if (!isCloudDatabaseReady()) {
        queueMicrotask(() =>
          failClosed(
            { code: 'CONFIGURATION_ERROR' },
            '云端数据服务未配置，已停止保存业务数据。',
            { write: true },
          ),
        )
        return fallback
      }

      cloudSaver(key, resolvedValue)
        .then(() => {
          window.localStorage.setItem(key, JSON.stringify(resolvedValue))
          setCloudState({
            loading: false,
            error: '',
            code: '',
            source: 'supabase',
            updatedAt: new Date().toISOString(),
          })
        })
        .catch((error) => {
          console.error(`Supabase 保存失败: ${key}`, error)
          failClosed(
            error,
            '云端数据保存失败，已停止访问业务数据。',
            { write: true },
          )
        })
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
    allocateToProject: false,
    projectId: '',
    remark: '',
  }
}

export function toolResponsibilityGrossCost(record = {}) {
  return record.issueType === '丢失'
    ? toAmount(record.toolValue)
    : toAmount(record.repairCost)
}

export function createProjectCostLedgerActorFingerprint(currentUser, access) {
  const permissionKeys = Array.isArray(currentUser?.effectivePermissionKeys)
    ? [...new Set(currentUser.effectivePermissionKeys.filter((key) => typeof key === 'string'))]
        .sort()
    : []
  return JSON.stringify([
    typeof currentUser?.tenantId === 'string' ? currentUser.tenantId : '',
    typeof currentUser?.id === 'string' ? currentUser.id : currentUser?.employeeId || '',
    permissionKeys,
    Boolean(access?.view),
    Boolean(access?.create),
    Boolean(access?.update),
  ])
}

function initialProjectLedgerSummaryState(identity, canRead) {
  return {
    identity,
    status: canRead ? 'loading' : 'forbidden',
    data: null,
  }
}

export function useProjectLedgerSummaryLifecycle({
  service,
  access,
  actorFingerprint,
  sourceFingerprint,
  onAuthInvalid,
}) {
  const canRead = Boolean(access?.readLedger ?? access?.view)
  const activeIdentityRef = useRef(actorFingerprint)
  activeIdentityRef.current = actorFingerprint
  const onAuthInvalidRef = useRef(onAuthInvalid)
  onAuthInvalidRef.current = onAuthInvalid
  const requestSequenceRef = useRef(0)
  const sourceFingerprintRef = useRef({
    actorFingerprint,
    value: sourceFingerprint,
  })
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const [state, setState] = useState(() =>
    initialProjectLedgerSummaryState(actorFingerprint, canRead))

  const invalidate = useCallback(() => {
    if (!canRead || activeIdentityRef.current !== actorFingerprint) return false
    setRefreshGeneration((current) => current + 1)
    return true
  }, [actorFingerprint, canRead])

  useEffect(() => {
    const identity = actorFingerprint
    const sequence = requestSequenceRef.current + 1
    requestSequenceRef.current = sequence
    let active = true
    const isCurrent = () => active && requestSequenceRef.current === sequence &&
      activeIdentityRef.current === identity

    if (!canRead) {
      setState(initialProjectLedgerSummaryState(identity, false))
      return () => {
        active = false
        requestSequenceRef.current += 1
      }
    }

    setState(initialProjectLedgerSummaryState(identity, true))
    void loadCompleteProjectCostLedgerSnapshot({ service, filters: {}, isCurrent })
      .then((snapshot) => {
        if (!snapshot || !isCurrent()) return
        setState({ identity, status: 'ready', data: snapshot })
      })
      .catch((error) => {
        if (!isCurrent()) return
        setState({ identity, status: 'error', data: null })
        if (error?.authInvalid === true) onAuthInvalidRef.current?.(error)
      })

    return () => {
      active = false
      requestSequenceRef.current += 1
    }
  }, [actorFingerprint, canRead, refreshGeneration, service])

  useEffect(() => {
    const previous = sourceFingerprintRef.current
    sourceFingerprintRef.current = { actorFingerprint, value: sourceFingerprint }
    if (previous.actorFingerprint !== actorFingerprint) return
    if (!Object.is(previous.value, sourceFingerprint)) invalidate()
  }, [actorFingerprint, invalidate, sourceFingerprint])

  if (state.identity !== actorFingerprint) {
    return { ...initialProjectLedgerSummaryState(actorFingerprint, canRead), invalidate }
  }
  return { status: state.status, data: state.data, invalidate }
}

function markLaborBridgeRetry(targetRef, requestIdentity) {
  targetRef.current = typeof requestIdentity === 'string' ? requestIdentity : ''
}

function shouldRefreshLaborBridgeRequest(targetRef, requestIdentity) {
  const targetIdentity = targetRef.current
  if (typeof targetIdentity !== 'string' || targetIdentity.length === 0) return false
  if (targetIdentity !== requestIdentity) {
    targetRef.current = ''
    return false
  }
  return true
}

function consumeLaborBridgeRetry(targetRef, requestIdentity) {
  if (targetRef.current === requestIdentity) targetRef.current = ''
}

function notifyBridgeAuthInvalid(callback, error) {
  if (error?.authInvalid !== true || typeof callback !== 'function') return
  try {
    const result = callback(error)
    if (result && typeof result.catch === 'function') void result.catch(() => {})
  } catch {
    // Authentication is already being invalidated; callback failures stay isolated.
  }
}

function LaborBridgeStatusNotice({ eligible, state, onRetry }) {
  if (!eligible) return null

  const hasBridge = Boolean(state.bridge)
  const messages = []
  if (!hasBridge && state.loading) {
    messages.push('正式核算正在加载，当前为历史估算')
  } else if (!hasBridge && state.error) {
    messages.push('正式核算暂不可用，当前为历史估算')
  } else if (hasBridge && state.stale) {
    messages.push(
      state.error
        ? '当前显示上次正式核算数据，刷新失败'
        : '当前显示上次正式核算数据，正在刷新',
    )
  } else if (hasBridge && !state.bridge.isAuthoritative) {
    messages.push('该月份尚未启用正式核算，当前为历史估算')
  }
  if (hasBridge && state.bridge.pendingCount > 0) {
    messages.push(`正式核算还有 ${state.bridge.pendingCount} 项待确认`)
  }
  if (messages.length === 0) return null

  return (
    <div
      className="empty-state cost-note warning-note"
      role={state.error ? 'alert' : 'status'}
      aria-live={state.error ? 'assertive' : 'polite'}
    >
      <span>{messages.join('；')}</span>
      {state.error && (
        <button className="back-button" type="button" onClick={onRetry}>
          重试正式核算
        </button>
      )}
    </div>
  )
}

export function resolveAuthorizedView(currentUser, currentView) {
  if (!canAccessView(currentUser, 'home')) return null
  return canAccessView(currentUser, currentView) ? currentView : 'home'
}

export function resolveGuardedNavigation({
  currentUser,
  currentView,
  nextView,
  protectedStateActive = false,
}) {
  const authorizedView = resolveAuthorizedView(currentUser, currentView)
  if (authorizedView === null || !canAccessView(currentUser, nextView)) {
    return { accepted: false, view: authorizedView }
  }

  const exitBlocked = shouldBlockPersonnelExit({
    currentView: authorizedView,
    protectedStateActive,
  })
  if (exitBlocked && nextView !== authorizedView) {
    return { accepted: false, view: authorizedView }
  }
  return { accepted: true, view: nextView }
}

export function getContractRevenueAccess(currentUser) {
  const view = canAccessView(currentUser, 'contractRevenue') &&
    canViewProjectFinancials(currentUser)
  return {
    view,
    update: view && canUpdateProjectFinancials(currentUser),
  }
}

function emptyHomeSummary() {
  return {
    activeProjects: 0,
    activeEmployees: 0,
    totalRecords: 0,
    pausedProjects: 0,
    monthlyPurchaseTotal: null,
    monthlyCostTotal: null,
    moduleCounts: {
      projects: 0,
      employees: 0,
      stockOut: 0,
      stockReturn: 0,
      labor: 0,
      vehicle: 0,
      toolBorrow: 0,
    },
  }
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function readyProjectedArray(state) {
  return state?.status === 'ready' && state.stale !== true && Array.isArray(state.data)
    ? state.data
    : null
}

function readyProjectedObject(state) {
  return state?.status === 'ready' && state.stale !== true && state.data !== null &&
    typeof state.data === 'object' && !Array.isArray(state.data)
    ? state.data
    : null
}

export function buildHomeFinancialModels({ currentUser, selectedMonth, sourceStates }) {
  const accountingAccess = getAccountingAccess(currentUser)
  const purchaseAccess = getPurchaseAccess(currentUser)
  const vehicleAccess = canAccessView(currentUser, 'vehicle')
  const costAccess = canAccessView(currentUser, 'accounting') &&
    accountingAccess.monthlySummary.salary &&
    accountingAccess.monthlySummary.projectCost &&
    accountingAccess.monthlySummary.operatingExpense &&
    accountingAccess.monthlySummary.purchaseAccrual && vehicleAccess
  const result = {
    cost: { status: costAccess ? 'loading' : 'forbidden', data: null },
    purchase: { status: purchaseAccess.summary.view ? 'loading' : 'forbidden', data: null },
  }
  if (!isLaborAccountingMonth(selectedMonth)) {
    if (costAccess) result.cost = { status: 'error', data: null }
    if (purchaseAccess.summary.view) result.purchase = { status: 'error', data: null }
    return result
  }

  if (costAccess) {
    const hasProjectLedgerSummary = Object.hasOwn(sourceStates || {}, 'projectLedgerSummary')
    const requiredStates = [
      sourceStates?.projects,
      sourceStates?.laborWindow,
      sourceStates?.purchaseAccrual,
      sourceStates?.projectCosts,
      sourceStates?.operatingExpenses,
      sourceStates?.fuel,
      sourceStates?.vehicleExpenses,
      sourceStates?.vehicleIssues,
      ...(hasProjectLedgerSummary ? [sourceStates?.projectLedgerSummary] : []),
    ]
    const projectRows = readyProjectedArray(requiredStates[0])
    const laborWindow = readyProjectedObject(requiredStates[1])
    const purchaseRows = readyProjectedArray(requiredStates[2])
    const manualProjectCosts = readyProjectedArray(requiredStates[3])
    const operatingExpenses = readyProjectedArray(requiredStates[4])
    const fuelRecords = readyProjectedArray(requiredStates[5])
    const vehicleExpenseRecords = readyProjectedArray(requiredStates[6])
    const vehicleIssueRecords = readyProjectedArray(requiredStates[7])
    const projectLedgerSummary = hasProjectLedgerSummary
      ? readyProjectedObject(requiredStates[8])
      : null
    if ([
      projectRows,
      laborWindow,
      purchaseRows,
      manualProjectCosts,
      operatingExpenses,
      fuelRecords,
      vehicleExpenseRecords,
      vehicleIssueRecords,
      ...(!hasProjectLedgerSummary || projectLedgerSummary !== null ? [] : [null]),
    ].every((value) => value !== null)) {
      const activeProjectIds = [...new Set(projectRows
        .map((project) => project?.projectId)
        .filter((projectId) => typeof projectId === 'string' &&
          projectId.length > 0 && projectId !== 'all'))]
      try {
        const model = buildCostAccountingReadModel({
          months: [selectedMonth],
          selectedMonth,
          projectId: 'all',
          activeProjectIds,
          laborWindow,
          purchaseRows,
          fuelRecords,
          vehicleExpenseRecords,
          vehicleIssueRecords,
          manualProjectCosts,
          operatingExpenses,
          ...(hasProjectLedgerSummary
            ? { projectLedgerSummary: { status: 'ready', data: projectLedgerSummary } }
            : {}),
        })
        result.cost = isSafeCostAccountingAmount(model.companyMonthlyTotal?.total)
          ? { status: 'ready', data: model }
          : { status: 'error', data: null }
      } catch {
        result.cost = { status: 'error', data: null }
      }
    } else {
      result.cost = buildUnavailableHomeFinancialState(requiredStates)
    }
  }

  if (purchaseAccess.summary.view) {
    const accrualState = sourceStates?.purchaseLedgerAccrual
    const purchaseRecords = readyProjectedArray(accrualState)
    if (purchaseRecords === null) {
      result.purchase = buildUnavailableHomeFinancialState([accrualState])
    } else {
      const rawPaymentState = purchaseAccess.payments.view
        ? sourceStates?.purchasePayments
        : { status: 'forbidden', data: null }
      const paymentRecords = readyProjectedArray(rawPaymentState)
      const paymentStatus = paymentRecords !== null
        ? 'ready'
        : rawPaymentState?.stale === true
          ? 'loading'
          : ['loading', 'forbidden', 'error'].includes(rawPaymentState?.status)
            ? rawPaymentState.status
            : 'error'
      try {
        const model = buildPurchaseAccountingReadModel({
          purchaseRecords,
          paymentRecords: paymentRecords || [],
          paymentState: {
            status: paymentStatus,
            data: paymentStatus === 'ready' ? paymentRecords : null,
          },
          month: selectedMonth,
        })
        result.purchase = Number.isSafeInteger(model.summary?.monthPurchaseCost) &&
          model.summary.monthPurchaseCost >= 0
          ? { status: 'ready', data: model }
          : { status: 'error', data: null }
      } catch {
        result.purchase = { status: 'error', data: null }
      }
    }
  }

  return result
}

export function buildAuthorizedHomeSummary(currentUser, sources) {
  if (!canAccessView(currentUser, 'home')) return emptyHomeSummary()

  try {
    const descriptor = sources && typeof sources === 'object'
      ? Object.getOwnPropertyDescriptor(sources, 'homeModel')
      : null
    const projectedSummary = descriptor && 'value' in descriptor
      ? getAuthorizedHomeSummary(descriptor.value)
      : null
    if (projectedSummary) return projectedSummary
  } catch {
    // Continue through the legacy permission projection for compatibility callers.
  }

  const projectAccess = canAccessView(currentUser, 'projects')
  const employeeAccess = canAccessView(currentUser, 'employees')
  const stockOutAccess = canAccessView(currentUser, 'stockOut')
  const stockReturnAccess = canAccessView(currentUser, 'stockReturn')
  const laborAccess = canAccessView(currentUser, 'labor')
  const vehicleAccess = canAccessView(currentUser, 'vehicle')
  const toolAccess = canAccessView(currentUser, 'toolBorrow')
  const accountingPageAccess = canAccessView(currentUser, 'accounting')
  const accountingAccess = getAccountingAccess(currentUser)
  const purchaseAccess = getPurchaseAccess(currentUser)

  const projects = projectAccess ? arrayValue(sources?.projects) : []
  const personnelEmployees = employeeAccess ? arrayValue(sources?.employees) : []
  const stockOutRecords = stockOutAccess
    ? arrayValue(sources?.records?.stockOut)
    : []
  const stockReturnRecords = stockReturnAccess
    ? arrayValue(sources?.records?.stockReturn)
    : []
  const laborRecords = laborAccess ? arrayValue(sources?.records?.labor) : []
  const vehicleRecords = vehicleAccess ? arrayValue(sources?.records?.vehicle) : []
  const toolBorrowRecords = toolAccess ? arrayValue(sources?.records?.toolBorrow) : []
  const toolReturnRecords = toolAccess ? arrayValue(sources?.records?.toolReturn) : []
  const activeProjects = projects.filter((project) => project.status === '进行中').length
  const pausedProjects = projects.filter((project) => project.status === '暂停').length
  const activeEmployees = personnelEmployees.filter(
    (employee) => !isHiddenSystemEmployee(employee) && employee.employmentStatus === '在职',
  ).length
  const completeAccountingAccess = accountingPageAccess &&
    accountingAccess.monthlySummary.salary &&
    accountingAccess.monthlySummary.projectCost &&
    accountingAccess.monthlySummary.operatingExpense &&
    accountingAccess.monthlySummary.purchaseAccrual && vehicleAccess
  const costModelState = completeAccountingAccess ? sources?.financialModels?.cost : null
  const purchaseModelState = purchaseAccess.summary.view
    ? sources?.financialModels?.purchase
    : null
  const monthlyCostTotal = costModelState?.status === 'ready' &&
      isSafeCostAccountingAmount(costModelState.data?.companyMonthlyTotal?.total)
    ? costModelState.data.companyMonthlyTotal.total
    : null
  const monthlyPurchaseTotal = purchaseModelState?.status === 'ready' &&
      Number.isSafeInteger(purchaseModelState.data?.summary?.monthPurchaseCost) &&
      purchaseModelState.data.summary.monthPurchaseCost >= 0
    ? purchaseModelState.data.summary.monthPurchaseCost
    : null

  return {
    activeProjects,
    activeEmployees,
    totalRecords:
      stockOutRecords.length +
      stockReturnRecords.length +
      laborRecords.length +
      vehicleRecords.length +
      toolBorrowRecords.length +
      toolReturnRecords.length,
    pausedProjects,
    monthlyPurchaseTotal,
    monthlyCostTotal,
    moduleCounts: {
      projects: projects.length,
      employees: activeEmployees,
      stockOut: stockOutRecords.length,
      stockReturn: stockReturnRecords.length,
      labor: laborRecords.length,
      vehicle: vehicleRecords.length,
      toolBorrow: toolBorrowRecords.length,
    },
  }
}

export function loadProjectDirectoryForAccess(service, access) {
  if (!access?.view) return Promise.resolve([])
  return access.full ? service.listProjects() : service.listProjectReferences()
}

export function createProjectDirectoryActorFingerprint(currentUser, access) {
  const permissionKeys = Array.isArray(currentUser?.effectivePermissionKeys)
    ? [...new Set(currentUser.effectivePermissionKeys.filter(
        (key) => typeof key === 'string',
      ))].sort()
    : []
  return JSON.stringify([
    typeof currentUser?.tenantId === 'string' ? currentUser.tenantId : '',
    typeof currentUser?.id === 'string' ? currentUser.id : currentUser?.employeeId || '',
    permissionKeys,
    Boolean(access?.view),
    Boolean(access?.full),
  ])
}

function projectDirectoryRawState(identity, status) {
  if (status === 'forbidden') {
    return {
      identity, loading: false, error: '无权读取该数据', code: 'ACCESS_DENIED',
      source: 'blocked', updatedAt: null,
    }
  }
  return {
    identity, loading: status === 'loading', error: '', code: '',
    source: 'project-service', updatedAt: null,
  }
}

export function useProjectDirectoryLifecycle({
  service,
  currentUser,
  access,
  onFatalError,
}) {
  const identity = createProjectDirectoryActorFingerprint(currentUser, access)
  const activeIdentityRef = useRef(identity)
  activeIdentityRef.current = identity
  const onFatalErrorRef = useRef(onFatalError)
  onFatalErrorRef.current = onFatalError
  const requestSequenceRef = useRef(0)
  const [directoryState, setDirectoryState] = useState(() => ({
    identity,
    rows: [],
    rawState: projectDirectoryRawState(identity, access?.view ? 'loading' : 'forbidden'),
  }))

  useEffect(() => {
    const requestIdentity = identity
    const sequence = requestSequenceRef.current + 1
    requestSequenceRef.current = sequence
    let active = true

    if (!access?.view) {
      setDirectoryState({
        identity: requestIdentity,
        rows: [],
        rawState: projectDirectoryRawState(requestIdentity, 'forbidden'),
      })
      return () => {
        active = false
        requestSequenceRef.current += 1
      }
    }

    setDirectoryState({
      identity: requestIdentity,
      rows: [],
      rawState: projectDirectoryRawState(requestIdentity, 'loading'),
    })
    void loadProjectDirectoryForAccess(service, access).then((rows) => {
      if (!active || requestSequenceRef.current !== sequence ||
          activeIdentityRef.current !== requestIdentity) return
      setDirectoryState({
        identity: requestIdentity,
        rows,
        rawState: {
          ...projectDirectoryRawState(requestIdentity, 'ready'),
          updatedAt: new Date().toISOString(),
        },
      })
    }).catch((error) => {
      if (!active || requestSequenceRef.current !== sequence ||
          activeIdentityRef.current !== requestIdentity) return
      const classification = classifyBusinessSourceError(error)
      setDirectoryState({
        identity: requestIdentity,
        rows: [],
        rawState: {
          identity: requestIdentity,
          loading: false,
          error: classification.message,
          code: classification.code,
          source: 'blocked',
          updatedAt: null,
        },
      })
      if (classification.fatal) onFatalErrorRef.current?.(error)
    })

    return () => {
      active = false
      requestSequenceRef.current += 1
    }
  }, [access?.full, access?.view, identity, service])

  const setRows = useCallback((nextRows) => {
    setDirectoryState((current) => {
      if (current.identity !== identity) return current
      const rows = current.rows
      return {
        ...current,
        identity,
        rows: typeof nextRows === 'function' ? nextRows(rows) : nextRows,
        rawState: { ...current.rawState, identity },
      }
    })
  }, [identity])

  if (directoryState.identity !== identity) {
    return {
      rows: [],
      rawState: projectDirectoryRawState(
        identity,
        access?.view ? 'loading' : 'forbidden',
      ),
      setRows,
    }
  }
  return { rows: directoryState.rows, rawState: directoryState.rawState, setRows }
}

export function AuthenticatedApp({ currentUser, onLogout }) {
  const [currentView, setCurrentView] = useState('home')
  const [miraisyaProjectId, setMiraisyaProjectId] = useState('')
  const authorizedView = resolveAuthorizedView(currentUser, currentView)
  useEffect(() => {
    if (authorizedView !== null && authorizedView !== currentView) {
      setCurrentView(authorizedView)
    }
  }, [authorizedView, currentView])
  const activeActorId = authorizedView === null ? '' : currentUser.id
  const activePermissionKeys = authorizedView === null
    ? []
    : currentUser.effectivePermissionKeys
  const accountingAccess = getAccountingAccess(currentUser)
  const purchaseAccess = getPurchaseAccess(currentUser)
  const dashboardAccess = getDashboardAccess(currentUser)
  const warehouseAccess = getWarehouseAccess(currentUser)
  const warehouseService = useMemo(() => createWarehouseService(supabase, {
    configured: Boolean(supabase),
    viewCost: warehouseAccess.viewCost,
    manageCatalog: warehouseAccess.manageCatalog,
    exportReports: warehouseAccess.exportReports,
  }), [warehouseAccess.exportReports, warehouseAccess.manageCatalog, warehouseAccess.viewCost])
  const warehouseConfirmationService = useMemo(() => createWarehouseConfirmationService(
    supabase,
    { configured: Boolean(supabase), viewCost: warehouseAccess.viewCost },
  ), [warehouseAccess.viewCost])
  const warehouseRequestMediaService = useMemo(() => createWarehouseMediaService(
    supabase,
    { configured: Boolean(supabase) },
  ), [])
  const [warehouseHomeState, setWarehouseHomeState] = useState(() => ({
    status: warehouseAccess.page ? 'loading' : 'forbidden',
    data: null,
    stale: false,
  }))
  useEffect(() => {
    if (!warehouseAccess.page) {
      setWarehouseHomeState({ status: 'forbidden', data: null, stale: false })
      return undefined
    }
    let active = true
    setWarehouseHomeState({ status: 'loading', data: null, stale: false })
    Promise.all([
      warehouseService.listCatalog(),
      warehouseService.listReport('low_stock', { page: 1, pageSize: 500 }),
    ]).then(([catalog, lowStock]) => {
      if (!active) return
      setWarehouseHomeState({
        status: 'ready',
        data: {
          totalSku: catalog.variants.filter((variant) => variant.active !== false).length,
          lowStockSku: lowStock.rows.length,
        },
        stale: false,
      })
    }).catch((error) => {
      if (!active) return
      if (error?.authInvalid) onLogout()
      setWarehouseHomeState({ status: 'error', data: null, stale: false })
    })
    return () => { active = false }
  }, [onLogout, warehouseAccess.page, warehouseService])
  const accountingReadAccess = {
    salary: accountingAccess.salary.view || dashboardAccess.labor.amounts,
    projectCost: accountingAccess.projectCost.view || dashboardAccess.costCategories.manualSupplement,
    operatingExpense: accountingAccess.operatingExpense.view ||
      dashboardAccess.costCategories.operatingExpense,
  }
  const purchaseReadAccess = {
    records: purchaseAccess.records.view ||
      accountingAccess.purchaseAccounting.view ||
      dashboardAccess.purchase.accrual,
    payments: purchaseAccess.payments.view ||
      accountingAccess.monthlySummary.purchasePayments ||
      dashboardAccess.purchase.payments,
  }
  const projectReferenceAccess = getProjectReferenceAccess(currentUser)
  const projectRelationReadAccess = projectReferenceAccess.view
  const warehouseContextReadAccess = purchaseReadAccess.records &&
    accountingReadAccess.projectCost
  const [warehouseMaterialCostContextState, setWarehouseMaterialCostContextState] = useState(
    () => warehouseContextReadAccess
      ? { status: 'loading', data: null, stale: false, actorKey: activeActorId }
      : { status: 'forbidden', data: null, stale: false, actorKey: activeActorId },
  )
  useEffect(() => {
    let active = true
    if (!warehouseContextReadAccess) {
      setWarehouseMaterialCostContextState({
        status: 'forbidden', data: null, stale: false, actorKey: activeActorId,
      })
      return () => { active = false }
    }
    setWarehouseMaterialCostContextState({
      status: 'loading', data: null, stale: false, actorKey: activeActorId,
    })
    warehouseMaterialCostBridge.loadContext().then((context) => {
      if (!active) return
      setWarehouseMaterialCostContextState({
        status: 'ready', data: context, stale: false, actorKey: activeActorId,
      })
    }).catch((error) => {
      if (!active) return
      setWarehouseMaterialCostContextState({
        status: error?.code === 'WAREHOUSE_MATERIAL_COST_ACCESS_DENIED'
          ? 'forbidden'
          : 'error',
        data: null,
        stale: false,
        actorKey: activeActorId,
      })
      if (error?.code === 'WAREHOUSE_MATERIAL_COST_AUTH_INVALID') onLogout()
    })
    return () => { active = false }
  }, [warehouseContextReadAccess, activeActorId, onLogout])
  const {
    count: laborAlertCount,
    stale: laborAlertStale,
    refresh: refreshLaborAlertCount,
  } = useLaborAlertCount({
    actorKey: activeActorId,
    effectivePermissionKeys: activePermissionKeys,
    onAuthInvalid: onLogout,
  })
  const [accountingMonth, setAccountingMonth] = useState(currentMonthValue())
  const handleAccountingMonthChange = useCallback((nextMonth) => {
    if (!isLaborAccountingMonth(nextMonth)) return
    setAccountingMonth(nextMonth)
  }, [])
  const [dashboardQuery, setDashboardQuery] = useState(() => ({
    selectedMonth: currentMonthValue(),
    projectId: 'all',
    projectStatus: 'all',
    rankingMetric: 'profit',
    page: 1,
    pageSize: 10,
  }))
  const handleDashboardFiltersChange = useCallback((nextFilters) => {
    if (nextFilters === null || typeof nextFilters !== 'object' || Array.isArray(nextFilters)) {
      return
    }
    setDashboardQuery((current) => {
      const selectedMonth = isLaborAccountingMonth(nextFilters.selectedMonth)
        ? nextFilters.selectedMonth
        : current.selectedMonth
      const projectId = typeof nextFilters.projectId === 'string' &&
          nextFilters.projectId.trim() === nextFilters.projectId &&
          nextFilters.projectId.length > 0
        ? nextFilters.projectId
        : current.projectId
      const projectStatus = DASHBOARD_PROJECT_STATUSES.has(nextFilters.projectStatus)
        ? nextFilters.projectStatus
        : current.projectStatus
      const rankingMetric = DASHBOARD_RANKING_METRICS.has(nextFilters.rankingMetric)
        ? nextFilters.rankingMetric
        : current.rankingMetric
      const page = Number.isSafeInteger(nextFilters.page) && nextFilters.page > 0
        ? nextFilters.page
        : current.page
      const pageSize = Number.isSafeInteger(nextFilters.pageSize) &&
          nextFilters.pageSize > 0 && nextFilters.pageSize <= 100
        ? nextFilters.pageSize
        : current.pageSize
      const scopeChanged = selectedMonth !== current.selectedMonth ||
        projectId !== current.projectId || projectStatus !== current.projectStatus ||
        rankingMetric !== current.rankingMetric
      return {
        selectedMonth,
        projectId,
        projectStatus,
        rankingMetric,
        page: scopeChanged ? 1 : page,
        pageSize,
      }
    })
  }, [])
  const bridgeTargetActive = ['home', 'accounting', 'dashboard', 'projects'].includes(authorizedView) ||
    dashboardAccess.page
  const dashboardBridgeMonthContext = {
    authorizedView,
    dashboardSelectedMonth: dashboardQuery.selectedMonth,
    accountingMonth,
    currentMonth: currentMonthValue(),
  }
  const bridgeRequestedMonth = authorizedView === 'accounting'
    ? resolveDashboardBridgeMonth({ ...dashboardBridgeMonthContext, accountingMonth })
    : authorizedView === 'dashboard'
      ? resolveDashboardBridgeMonth({
          ...dashboardBridgeMonthContext,
          dashboardSelectedMonth: dashboardQuery.selectedMonth,
          currentMonth: currentMonthValue(),
        })
      : resolveDashboardBridgeMonth(dashboardBridgeMonthContext)
  const bridgeSnapshotMonth = currentMonthValue()
  const bridgePermissionFingerprint = useMemo(() => {
    if (!Array.isArray(activePermissionKeys)) return ''
    return [...new Set(
      activePermissionKeys.filter((key) => typeof key === 'string'),
    )].sort().join('\u001f')
  }, [activePermissionKeys])
  const bridgeEligible = canRequestLaborAccountingBridge({
    actorKey: activeActorId,
    effectivePermissionKeys: activePermissionKeys,
  })
  const bridgeTenantScope = typeof currentUser.tenantId === 'string'
    ? currentUser.tenantId
    : ''
  const bridgeActorScope = JSON.stringify([
    bridgeTenantScope,
    activeActorId,
    bridgePermissionFingerprint,
  ])
  const bridgeRequestIdentity = JSON.stringify([
    bridgeActorScope,
    bridgeTargetActive && bridgeEligible ? bridgeRequestedMonth : '',
    bridgeTargetActive && bridgeEligible ? bridgeSnapshotMonth : '',
  ])
  const bridgeRequestIdentityRef = useRef(bridgeRequestIdentity)
  bridgeRequestIdentityRef.current = bridgeRequestIdentity
  const bridgeRequestGenerationRef = useRef(0)
  const laborBridgeLoaderRef = useRef(null)
  if (laborBridgeLoaderRef.current === null) {
    laborBridgeLoaderRef.current = createDashboardLaborBridgeLoader({
      getBridgeSummary: ({ month }) => laborAccountingService.getBridgeSummary({ month }),
    })
  }
  const previousBridgeActorScopeRef = useRef('')
  const activeBridgeActorScopeRef = useRef(bridgeActorScope)
  activeBridgeActorScopeRef.current = bridgeActorScope
  useEffect(() => {
    const previousActorScope = previousBridgeActorScopeRef.current
    if (previousActorScope && previousActorScope !== bridgeActorScope) {
      laborBridgeLoaderRef.current.clear(previousActorScope)
    }
    previousBridgeActorScopeRef.current = bridgeActorScope
  }, [bridgeActorScope])
  useEffect(() => () => {
    const actorScope = activeBridgeActorScopeRef.current
    if (actorScope) laborBridgeLoaderRef.current.clear(actorScope)
  }, [])
  const [bridgeRetryToken, setBridgeRetryToken] = useState(0)
  const bridgeRetryTargetIdentityRef = useRef('')
  const [laborBridgeState, setLaborBridgeState] = useState({
    identity: '',
    endMonth: '',
    snapshotMonth: '',
    result: null,
    loading: false,
    stale: false,
    error: '',
    updatedAt: null,
  })
  const retryLaborBridge = useCallback(() => {
    markLaborBridgeRetry(bridgeRetryTargetIdentityRef, bridgeRequestIdentityRef.current)
    setBridgeRetryToken((value) => value + 1)
  }, [])
  useEffect(() => {
    const generation = bridgeRequestGenerationRef.current + 1
    bridgeRequestGenerationRef.current = generation
    const requestIdentity = bridgeRequestIdentity
    const refreshBridgeRequest = shouldRefreshLaborBridgeRequest(
      bridgeRetryTargetIdentityRef,
      requestIdentity,
    )
    let active = true

    if (!bridgeTargetActive || !bridgeEligible) {
      setLaborBridgeState({
        identity: '',
        endMonth: '',
        snapshotMonth: '',
        result: null,
        loading: false,
        stale: false,
        error: '',
        updatedAt: null,
      })
      return () => { active = false }
    }

    const abortController = new AbortController()

    setLaborBridgeState((current) => {
      const sameWindowResult = current.identity === requestIdentity &&
        current.endMonth === bridgeRequestedMonth &&
        current.snapshotMonth === bridgeSnapshotMonth &&
        current.result
        ? current.result
        : null
      return {
        identity: requestIdentity,
        endMonth: bridgeRequestedMonth,
        snapshotMonth: bridgeSnapshotMonth,
        result: sameWindowResult,
        loading: true,
        stale: Boolean(sameWindowResult),
        error: '',
        updatedAt: sameWindowResult ? current.updatedAt : null,
      }
    })

    const isCurrentRequest = () => !(
      active === false ||
      generation !== bridgeRequestGenerationRef.current ||
      bridgeRequestIdentityRef.current !== requestIdentity
    )

    void laborBridgeLoaderRef.current.load({
      actorScope: bridgeActorScope,
      endMonth: bridgeRequestedMonth,
      length: 12,
      snapshotMonth: bridgeSnapshotMonth,
      signal: abortController.signal,
      refresh: refreshBridgeRequest,
    })
      .then((result) => {
        if (!isCurrentRequest()) return
        if (result.snapshotMonth !== bridgeSnapshotMonth || !result.windowStatus) {
          throw new Error('invalid labor accounting bridge response')
        }
        consumeLaborBridgeRetry(bridgeRetryTargetIdentityRef, requestIdentity)
        const updatedAt = Object.values(result.updatedAtByMonth || {})
          .filter((value) => value instanceof Date && Number.isFinite(value.getTime()))
          .sort((left, right) => left.getTime() - right.getTime())[0]
        setLaborBridgeState({
          identity: requestIdentity,
          endMonth: bridgeRequestedMonth,
          snapshotMonth: bridgeSnapshotMonth,
          result,
          loading: false,
          stale: result.snapshotStale === true || result.windowStaleMonths.length > 0,
          error: '',
          updatedAt: updatedAt?.toISOString?.() || null,
        })
      })
      .catch((error) => {
        if (!isCurrentRequest()) return
        if (error?.name === 'AbortError') return
        consumeLaborBridgeRetry(bridgeRetryTargetIdentityRef, requestIdentity)
        notifyBridgeAuthInvalid(onLogout, error)
        setLaborBridgeState((current) => {
          const sameWindowResult = current.identity === requestIdentity &&
            current.endMonth === bridgeRequestedMonth &&
            current.snapshotMonth === bridgeSnapshotMonth &&
            current.result
            ? current.result
            : null
          return {
            identity: requestIdentity,
            endMonth: bridgeRequestedMonth,
            snapshotMonth: bridgeSnapshotMonth,
            result: sameWindowResult,
            loading: false,
            stale: Boolean(sameWindowResult),
            error: '正式核算暂不可用',
            updatedAt: sameWindowResult ? current.updatedAt : null,
          }
        })
      })

    return () => {
      active = false
      abortController.abort()
    }
  }, [
    bridgeEligible,
    bridgeActorScope,
    bridgeRequestIdentity,
    bridgeRequestedMonth,
    bridgeSnapshotMonth,
    bridgeRetryToken,
    bridgeTargetActive,
    onLogout,
  ])
  const [personnelEmployees, setPersonnelEmployees] = useState([])
  const [personnelLoadState, setPersonnelLoadState] = useState({
    loading: false,
    error: '',
  })
  const [employeeCritical, setEmployeeCritical] = useState(false)
  const employeeCriticalRef = useRef(false)
  const [projectEmployeeDirectory, setProjectEmployeeDirectory] = useState([])
  const [projectDirectoryState, setProjectDirectoryState] = useState({
    loading: false,
    error: '',
  })
  const [templateCritical, setTemplateCritical] = useState(false)
  const templateCriticalRef = useRef(false)
  const personnelProtectedStateRef = useRef(false)
  const personnelRequestVersion = useRef(0)
  const projectDirectoryRequestVersion = useRef(0)
  const [contractRevenueProjectId, setContractRevenueProjectId] = useState('')
  const [persistenceFailure, setPersistenceFailure] = useState(null)
  const persistenceOptions = {
    onFatalError: setPersistenceFailure,
    onWriteError: setPersistenceFailure,
  }
  const contractRevenueAccess = getContractRevenueAccess(currentUser)
  const {
    rows: storedProjects,
    rawState: projectRawState,
    setRows: setStoredProjects,
  } = useProjectDirectoryLifecycle({
    service: projectService,
    currentUser,
    access: projectReferenceAccess,
    onFatalError: setPersistenceFailure,
  })
  const [projectContractChanges, setProjectContractChanges] = useState([])
  const [projectPaymentPlans, setProjectPaymentPlans] = useState([])
  const [projectReceipts, setProjectReceipts] = useState([])
  const [contractRevenueRawState, setContractRevenueRawState] = useState({
    loading: contractRevenueAccess.view,
    error: '',
    code: '',
    source: 'contract-revenue-service',
    updatedAt: null,
  })
  useEffect(() => {
    let active = true
    if (!contractRevenueAccess.view) {
      setProjectContractChanges([])
      setProjectPaymentPlans([])
      setProjectReceipts([])
      setContractRevenueRawState({
        loading: false,
        error: '无权读取该数据',
        code: 'ACCESS_DENIED',
        source: 'blocked',
        updatedAt: null,
      })
      return () => { active = false }
    }
    setContractRevenueRawState((current) => ({
      ...current,
      loading: true,
      error: '',
      code: '',
    }))
    Promise.all([loadContractChanges(), loadPaymentPlans(), loadProjectReceipts()])
      .then(([changes, plans, receipts]) => {
        if (!active) return
        setProjectContractChanges(Array.isArray(changes) ? changes : [])
        setProjectPaymentPlans(Array.isArray(plans) ? plans : [])
        setProjectReceipts(Array.isArray(receipts) ? receipts : [])
        setContractRevenueRawState({
          loading: false,
          error: '',
          code: '',
          source: 'contract-revenue-service',
          updatedAt: new Date().toISOString(),
        })
      })
      .catch((error) => {
        if (!active) return
        const classification = classifyBusinessSourceError(error)
        setProjectContractChanges([])
        setProjectPaymentPlans([])
        setProjectReceipts([])
        setContractRevenueRawState({
          loading: false,
          error: classification.message,
          code: classification.code,
          source: 'blocked',
          updatedAt: null,
        })
        if (classification.fatal) setPersistenceFailure(error)
      })
    return () => { active = false }
  }, [contractRevenueAccess.view])
  const employeeReadAccess = canAccessView(currentUser, 'employees') ||
    dashboardAccess.attendance.identities || accountingReadAccess.salary ||
    purchaseAccess.records.view || accountingAccess.projectCost.view ||
    accountingAccess.operatingExpense.view
  const laborReadAccess = canAccessView(currentUser, 'labor') || bridgeEligible ||
    dashboardAccess.labor.view
  const vehicleReadAccess = canAccessView(currentUser, 'vehicle') || dashboardAccess.vehicle.view
  const toolReadAccess = canAccessView(currentUser, 'toolBorrow') || dashboardAccess.tools.view
  const inventoryReadAccess = purchaseAccess.stockIn.view || dashboardAccess.inventory.view
  const [storedEmployees, , employeeRawState] = usePersistentState(STORAGE_KEYS.employees, [], {
    cloudRead: false,
    cloudPersistence: 'none',
    localCompatibility: true,
    readOnly: true,
    readAllowed: employeeReadAccess,
  })
  const [stockOutRecords, setStockOutRecords, stockOutRawState] = usePersistentState(
    STORAGE_KEYS.stockOutRecords,
    [],
    {
      ...persistenceOptions,
      readAllowed: canAccessView(currentUser, 'stockOut') || dashboardAccess.inventory.view,
    },
  )
  const [stockReturnRecords, setStockReturnRecords, stockReturnRawState] = usePersistentState(
    STORAGE_KEYS.stockReturnRecords,
    [],
    {
      ...persistenceOptions,
      readAllowed: canAccessView(currentUser, 'stockReturn') || dashboardAccess.inventory.view,
    },
  )
  const [laborRecords, setLaborRecords, laborRawState] = usePersistentState(
    STORAGE_KEYS.laborRecords,
    [],
    { ...persistenceOptions, readAllowed: laborReadAccess },
  )
  const [vehicleRecords, setVehicleRecords, vehicleRawState] = usePersistentState(
    STORAGE_KEYS.vehicleRecords,
    [],
    { ...persistenceOptions, readAllowed: vehicleReadAccess },
  )
  const [storedVehicleUsageRecords, setStoredVehicleUsageRecords, vehicleUsageRawState] = usePersistentState(
    STORAGE_KEYS.vehicleUsageRecords,
    [],
    { ...persistenceOptions, readAllowed: vehicleReadAccess },
  )
  const [storedFuelRecords, setStoredFuelRecords, fuelRawState] = usePersistentState(
    STORAGE_KEYS.fuelRecords,
    [],
    { ...persistenceOptions, readAllowed: vehicleReadAccess },
  )
  const [storedVehicleExpenseRecords, setStoredVehicleExpenseRecords, vehicleExpenseRawState] = usePersistentState(
    STORAGE_KEYS.vehicleExpenseRecords,
    [],
    { ...persistenceOptions, readAllowed: vehicleReadAccess },
  )
  const [storedVehicleIssueRecords, setStoredVehicleIssueRecords, vehicleIssueRawState] = usePersistentState(
    STORAGE_KEYS.vehicleIssueRecords,
    [],
    { ...persistenceOptions, readAllowed: vehicleReadAccess },
  )
  const [toolBorrowRecords, setToolBorrowRecords, toolBorrowRawState] = usePersistentState(
    STORAGE_KEYS.toolBorrowRecords,
    [],
    { ...persistenceOptions, readAllowed: toolReadAccess },
  )
  const [toolReturnRecords, setToolReturnRecords, toolReturnRawState] = usePersistentState(
    STORAGE_KEYS.toolReturnRecords,
    [],
    { ...persistenceOptions, readAllowed: toolReadAccess },
  )
  const [storedToolRecords, setStoredToolRecords, toolRawState] = usePersistentState(
    STORAGE_KEYS.toolRecords,
    [],
    { ...persistenceOptions, readAllowed: toolReadAccess },
  )
  const [storedLifelongToolAssignments, setStoredLifelongToolAssignments, lifelongToolRawState] = usePersistentState(
    STORAGE_KEYS.lifelongToolAssignments,
    [],
    { ...persistenceOptions, readAllowed: toolReadAccess },
  )
  const [storedToolResponsibilityRecords, setStoredToolResponsibilityRecords, toolResponsibilityRawState] = usePersistentState(
    STORAGE_KEYS.toolResponsibilityRecords,
    [],
    { ...persistenceOptions, readAllowed: toolReadAccess },
  )
  const [storedSalaryRecords, setStoredSalaryRecords, salaryRawState] = usePersistentState(
    STORAGE_KEYS.salaryRecords,
    [],
    { ...persistenceOptions, readAllowed: accountingReadAccess.salary },
  )
  const [storedProjectCostRecords, setStoredProjectCostRecords, projectCostRawState] = usePersistentState(
    STORAGE_KEYS.projectCostRecords,
    [],
    {
      ...persistenceOptions,
      readAllowed: accountingReadAccess.projectCost,
      cloudPersistence: 'record',
    },
  )
  const [storedOperatingExpenseRecords, setStoredOperatingExpenseRecords, operatingExpenseRawState] = usePersistentState(
    STORAGE_KEYS.operatingExpenseRecords,
    [],
    { ...persistenceOptions, readAllowed: accountingReadAccess.operatingExpense },
  )
  const [storedPurchaseRecords, setStoredPurchaseRecords, purchaseRawState] = usePersistentState(
    STORAGE_KEYS.purchaseRecords,
    [],
    {
      ...persistenceOptions,
      readAllowed: purchaseReadAccess.records,
      cloudLoader: purchaseService.getList,
      cloudPersistence: 'record',
    },
  )
  const [storedPurchasePaymentRecords, setStoredPurchasePaymentRecords, purchasePaymentRawState] = usePersistentState(
    STORAGE_KEYS.purchasePaymentRecords,
    [],
    {
      ...persistenceOptions,
      readAllowed: purchaseReadAccess.payments,
      cloudLoader: purchaseService.getPaymentList,
      cloudPersistence: 'record',
    },
  )
  const [storedStockInRecords, setStoredStockInRecords, stockInRawState] = usePersistentState(
    STORAGE_KEYS.stockInRecords,
    [],
    { ...persistenceOptions, readAllowed: inventoryReadAccess },
  )
  const [storedInventoryItems, setStoredInventoryItems, inventoryRawState] = usePersistentState(
    STORAGE_KEYS.inventoryItems,
    [],
    { ...persistenceOptions, readAllowed: inventoryReadAccess },
  )

  const refreshPersonnelEmployees = useCallback(async () => {
    const requestVersion = personnelRequestVersion.current + 1
    personnelRequestVersion.current = requestVersion
    setPersonnelLoadState({ loading: true, error: '' })
    try {
      const directory = await employeeAdminService.listEmployeeDirectory()
      if (personnelRequestVersion.current !== requestVersion) return directory
      setPersonnelEmployees(directory)
      setPersonnelLoadState({ loading: false, error: '' })
      return directory
    } catch (error) {
      if (personnelRequestVersion.current !== requestVersion) return []
      setPersonnelEmployees([])
      setPersonnelLoadState({
        loading: false,
        error:
          error?.name === 'EmployeeAdminError'
            ? error.message
            : '规范员工目录暂时无法读取，请稍后重试',
      })
      throw error
    }
  }, [])

  const refreshProjectEmployeeDirectory = useCallback(async () => {
    const requestVersion = projectDirectoryRequestVersion.current + 1
    projectDirectoryRequestVersion.current = requestVersion
    setProjectDirectoryState({ loading: true, error: '' })
    try {
      const directory = await employeeAdminService.listEmployeeDirectory()
      if (projectDirectoryRequestVersion.current !== requestVersion) return directory
      setProjectEmployeeDirectory(directory)
      setProjectDirectoryState({ loading: false, error: '' })
      return directory
    } catch (error) {
      if (projectDirectoryRequestVersion.current !== requestVersion) return []
      setProjectEmployeeDirectory([])
      setProjectDirectoryState({
        loading: false,
        error:
          error?.name === 'EmployeeAdminError'
            ? error.message
            : '规范员工目录暂时无法读取，请稍后重试',
      })
      if (error?.authInvalid) onLogout()
      throw error
    }
  }, [onLogout])

  const personnelProtectedState = combinePersonnelProtectionSources({
    employeeCritical,
    templateCritical,
  })
  const personnelExitBlocked = shouldBlockPersonnelExit({
    currentView: authorizedView,
    protectedStateActive: personnelProtectedState,
  })
  const synchronizePersonnelProtectionRef = useCallback(() => {
    personnelProtectedStateRef.current = combinePersonnelProtectionSources({
      employeeCritical: employeeCriticalRef.current,
      templateCritical: templateCriticalRef.current,
    })
  }, [])
  const handlePersonnelCriticalStateChange = useCallback((active) => {
    const nextActive = active === true
    employeeCriticalRef.current = nextActive
    setEmployeeCritical(nextActive)
    synchronizePersonnelProtectionRef()
    return true
  }, [synchronizePersonnelProtectionRef])
  const handleTemplateCriticalStateChange = useCallback((active) => {
    const nextActive = active === true
    templateCriticalRef.current = nextActive
    setTemplateCritical(nextActive)
    synchronizePersonnelProtectionRef()
    return true
  }, [synchronizePersonnelProtectionRef])
  const handlePersonnelAwareNavigate = useCallback(
    (nextView) => {
      const decision = resolveGuardedNavigation({
        currentUser,
        currentView,
        nextView,
        protectedStateActive: personnelProtectedStateRef.current,
      })
      if (!decision.accepted) return false
      setCurrentView(decision.view)
      return true
    },
    [currentUser, currentView],
  )
  const handlePersonnelAwareLogout = useCallback(() => {
    const exitBlockedNow = shouldBlockPersonnelExit({
      currentView: authorizedView,
      protectedStateActive: personnelProtectedStateRef.current,
    })
    if (exitBlockedNow) return
    return onLogout()
  }, [authorizedView, onLogout])

  useEffect(() => {
    const preventProtectedExit = (event) => {
      const exitBlockedNow = shouldBlockPersonnelExit({
        currentView: authorizedView,
        protectedStateActive: personnelProtectedStateRef.current,
      })
      if (!exitBlockedNow) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', preventProtectedExit)
    return () => {
      window.removeEventListener('beforeunload', preventProtectedExit)
    }
  }, [authorizedView, personnelExitBlocked])

  useEffect(() => {
    if (currentView !== 'employees' || authorizedView !== 'employees') {
      personnelRequestVersion.current += 1
      setPersonnelEmployees([])
      setPersonnelLoadState({ loading: false, error: '' })
      return undefined
    }

    refreshPersonnelEmployees().catch((error) => {
      if (error?.authInvalid) onLogout()
    })
    return () => {
      personnelRequestVersion.current += 1
    }
  }, [authorizedView, currentView, onLogout, refreshPersonnelEmployees])

  useEffect(() => {
    if (currentView !== 'projects' || authorizedView !== 'projects') {
      projectDirectoryRequestVersion.current += 1
      setProjectEmployeeDirectory([])
      setProjectDirectoryState({ loading: false, error: '' })
      return undefined
    }

    refreshProjectEmployeeDirectory().catch(() => {})
    return () => {
      projectDirectoryRequestVersion.current += 1
    }
  }, [authorizedView, currentView, refreshProjectEmployeeDirectory])

  const refreshStoredProjectsFromLocal = async () => {
    const rows = await projectService.listProjects()
    setStoredProjects(rows)
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
    () => storedEmployees.map((employee) => normalizeEmployee(employee)),
    [storedEmployees],
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
  const projectCostLedgerSourcesRef = useRef(null)
  projectCostLedgerSourcesRef.current = {
    purchaseRows: purchaseRecords,
    warehouseCosts: projectCostRecords.filter((record) => isWarehouseManagedProjectCost(record)),
    laborRows: laborRecords.map((record) => ({
      id: record.laborRecordId,
      date: record.workDate,
      projectId: record.projectId,
      projectName: record.projectName,
      amount: record.laborCost,
      description: record.jobContent || record.remark,
      operator: record.operatorName,
      status: record.status,
    })),
    vehicleRows: [...fuelRecords, ...vehicleExpenseRecords, ...vehicleIssueRecords],
    toolRows: toolResponsibilityRecords
      .filter((record) => record.allocateToProject && toolResponsibilityGrossCost(record) > 0)
      .map((record) => ({
        id: record.responsibilityRecordId,
        date: record.recordDate,
        projectId: record.projectId,
        projectName: record.projectName,
        amount: toolResponsibilityGrossCost(record),
        description: `${record.toolName}${record.issueDescription ? `｜${record.issueDescription}` : ''}`,
        operator: record.handlerEmployeeName,
      })),
    operatingExpenses: operatingExpenseRecords,
    manualProjectCosts: projectCostRecords.filter((record) => !isWarehouseManagedProjectCost(record)),
  }
  const activeProjectCostLedgerService = useMemo(() => (
    localDemoMode
      ? createProjectCostLedgerDemoService({
          getSources: () => projectCostLedgerSourcesRef.current,
          eventStore: localProjectCostLedgerEventStore,
        })
      : configuredProjectCostLedgerService
  ), [])
  const projectCostActorFingerprint = createProjectCostLedgerActorFingerprint(
    currentUser,
    accountingAccess.projectCost,
  )
  const projectLedgerSourceFingerprint = useMemo(() => ({}), [
    projects,
    purchaseRecords,
    projectCostRecords,
    laborRecords,
    fuelRecords,
    vehicleExpenseRecords,
    vehicleIssueRecords,
    toolResponsibilityRecords,
    operatingExpenseRecords,
  ])
  const projectLedgerSummaryState = useProjectLedgerSummaryLifecycle({
    service: activeProjectCostLedgerService,
    access: accountingAccess.projectCost,
    actorFingerprint: projectCostActorFingerprint,
    sourceFingerprint: projectLedgerSourceFingerprint,
    onAuthInvalid: onLogout,
  })

  if (authorizedView === null) return null

  if (persistenceFailure) {
    return (
      <main className="auth-shell">
        <section className="auth-panel auth-status-panel" role="alert">
          <img
            className="auth-brand-mark"
            src="/sw-erp-logo.jpg"
            alt="生旺株式会社标志"
          />
          <p>生旺株式会社 · ERP 数据中心</p>
          <h1>云端数据访问已停止</h1>
          <span>{persistenceFailure.message}</span>
          <div className="auth-account-actions">
            <button
              className="auth-primary-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              重新验证
            </button>
            <button className="auth-secondary-button" type="button" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </section>
      </main>
    )
  }

  const setProjects = (nextProjects) => {
    setStoredProjects((currentProjects) => {
      const normalizedCurrent = currentProjects.map((project) => normalizeProject(project))
      const resolvedProjects =
        typeof nextProjects === 'function' ? nextProjects(normalizedCurrent) : nextProjects
      return resolvedProjects.map((project) => prepareProjectForPersistence(project))
    })
  }
  const handleCreateProject = async (payload) => {
    const created = normalizeProject(await projectService.createProject(payload))
    setProjects((currentProjects) => [
      created,
      ...currentProjects.filter((project) => project.projectId !== created.projectId),
    ])
    return created
  }
  const handleUpdateProject = async (projectId, patch) => {
    const existing = projects.find((project) => project.projectId === projectId)
    if (!existing) throw new Error('Project not found')
    const saved = normalizeProject(await projectService.updateProject(projectId, patch))
    setStoredProjects((currentProjects) => currentProjects.map((project) => project.projectId === projectId ? saved : project))
    return saved
  }
  const handleDeleteProject = async (projectId) => {
    await projectService.softDeleteProject(projectId)
    setProjects((currentProjects) => currentProjects.filter(
      (project) => project.projectId !== projectId,
    ))
    return projectId
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
  const setProjectCostRecords = (nextRecords, updateOptions = {}) => {
    setStoredProjectCostRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizeProjectCostRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizeProjectCostRecord(record))
    }, updateOptions)
  }
  const projectCostStateOnlyOptions = { stateOnly: true, syncLocal: true }
  const handleSaveManualProjectCost = async (record) => {
    const normalized = normalizeProjectCostRecord(record)
    assertManualProjectCostMutable(normalized)
    const previousRecords = projectCostRecords
    setProjectCostRecords((current) => {
      const exists = current.some((item) => item.costRecordId === normalized.costRecordId)
      return exists
        ? current.map((item) => item.costRecordId === normalized.costRecordId ? normalized : item)
        : [normalized, ...current]
    }, projectCostStateOnlyOptions)
    if (localDemoMode) return normalized
    try {
      await manualProjectCostPersistence.save(normalized)
      return normalized
    } catch (error) {
      setProjectCostRecords(previousRecords, projectCostStateOnlyOptions)
      setPersistenceFailure(error)
      throw error
    }
  }
  const handleDeleteManualProjectCost = async (record) => {
    assertManualProjectCostMutable(record)
    const previousRecords = projectCostRecords
    setProjectCostRecords(
      previousRecords.filter((item) => item.costRecordId !== record.costRecordId),
      projectCostStateOnlyOptions,
    )
    if (localDemoMode) return record.costRecordId
    try {
      await manualProjectCostPersistence.remove(record)
      return record.costRecordId
    } catch (error) {
      setProjectCostRecords(previousRecords, projectCostStateOnlyOptions)
      setPersistenceFailure(error)
      throw error
    }
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
  const setPurchaseRecords = (nextRecords, updateOptions = {}) => {
    setStoredPurchaseRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) => normalizePurchaseRecord(record))
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizePurchaseRecord(record))
    }, updateOptions)
  }
  const setPurchasePaymentRecords = (nextRecords, updateOptions = {}) => {
    setStoredPurchasePaymentRecords((currentRecords) => {
      const normalizedCurrent = currentRecords.map((record) =>
        normalizePurchasePaymentRecord(record),
      )
      const resolvedRecords =
        typeof nextRecords === 'function' ? nextRecords(normalizedCurrent) : nextRecords
      return resolvedRecords.map((record) => normalizePurchasePaymentRecord(record))
    }, updateOptions)
  }
  const purchaseStateOnlyOptions = localDemoMode
    ? {}
    : { stateOnly: true, syncLocal: true }
  const handleCreatePurchase = async (record) => {
    const normalized = normalizePurchaseRecord(record)
    const previousRecords = purchaseRecords
    setPurchaseRecords(
      [normalized, ...previousRecords.filter((item) => item.purchaseId !== normalized.purchaseId)],
      purchaseStateOnlyOptions,
    )
    if (localDemoMode) return normalized
    try {
      const saved = normalizePurchaseRecord(await purchaseService.create(normalized))
      setPurchaseRecords((current) => [
        saved,
        ...current.filter((item) => item.purchaseId !== saved.purchaseId),
      ], purchaseStateOnlyOptions)
      return saved
    } catch (error) {
      setPurchaseRecords(previousRecords, purchaseStateOnlyOptions)
      setPersistenceFailure(error)
      throw error
    }
  }
  const handleUpdatePurchase = async (record) => {
    const normalized = normalizePurchaseRecord(record)
    const previousRecords = purchaseRecords
    setPurchaseRecords((current) => current.map((item) =>
      item.purchaseId === normalized.purchaseId ? normalized : item
    ), purchaseStateOnlyOptions)
    if (localDemoMode) return normalized
    try {
      const saved = normalizePurchaseRecord(
        await purchaseService.update(normalized.purchaseId, normalized),
      )
      setPurchaseRecords((current) => current.map((item) =>
        item.purchaseId === saved.purchaseId ? saved : item
      ), purchaseStateOnlyOptions)
      return saved
    } catch (error) {
      setPurchaseRecords(previousRecords, purchaseStateOnlyOptions)
      setPersistenceFailure(error)
      throw error
    }
  }
  const handleDeletePurchase = async (recordKey) => {
    const previousRecords = purchaseRecords
    setPurchaseRecords(
      previousRecords.filter((item) => item.purchaseId !== recordKey),
      purchaseStateOnlyOptions,
    )
    if (localDemoMode) return recordKey
    try {
      await purchaseService.softDelete(recordKey)
      return recordKey
    } catch (error) {
      setPurchaseRecords(previousRecords, purchaseStateOnlyOptions)
      setPersistenceFailure(error)
      throw error
    }
  }
  const persistPurchasePaymentCache = (record) => localDemoMode
    ? Promise.resolve(record)
    : purchaseService.update(record.purchaseId, record)
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

  const contractRevenueProject = projects.find(
    (project) => project.projectId === contractRevenueProjectId,
  )
  const miraisyaProject = projects.find(
    (project) => project.projectId === miraisyaProjectId && project.projectType === 'miraisya',
  )

  const openContractRevenue = (projectId) => {
    if (!handlePersonnelAwareNavigate('contractRevenue')) return
    setContractRevenueProjectId(projectId)
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
    const persistedProject = prepareProjectForPersistence(nextProject)
    const serverProject = await projectService.updateProject(
      persistedProject.projectId,
      persistedProject,
    )
    await refreshStoredProjectsFromLocal()
    return serverProject
  }

  const loadContractMigrationPreview = () => previewLocalContractRevenueMigration(window.localStorage)
  const executeContractMigration = (preview) => persistLegacyContractRevenueMigration(preview, {
    migrateLegacyProjectContractSecure: async (projectId, project, openingReceipt) => {
      const result = await supabase.rpc('migrate_legacy_project_contract_secure', {
        p_project_id: projectId,
        p_project: project,
        p_opening_receipt: openingReceipt,
      })
      if (result?.error) throw result.error
      return result?.data
    },
  })
  const handleLocalContractRevenueMigrationComplete = () => {}

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

  const currentLaborBridgeResult = laborBridgeState.identity === bridgeRequestIdentity &&
      laborBridgeState.endMonth === bridgeRequestedMonth &&
      laborBridgeState.snapshotMonth === bridgeSnapshotMonth
    ? laborBridgeState.result
    : null
  const bridgeMonths = buildMonthWindow(bridgeRequestedMonth, 12)
  const laborWindowInputStates = [salaryRawState, employeeRawState, laborRawState]
  const laborWindowInputLoading = laborWindowInputStates.some((state) => state.loading)
  const laborWindowInputFailure = laborWindowInputStates.find(
    (state) => state.error || state.code,
  )
  let dashboardLaborWindow = null
  let laborWindowProjectionError = ''
  if (currentLaborBridgeResult && !laborWindowInputLoading && !laborWindowInputFailure) {
    try {
      dashboardLaborWindow = buildLaborCostWindow({
        months: bridgeMonths,
        snapshotMonth: bridgeSnapshotMonth,
        bridgeState: currentLaborBridgeResult,
        salaryRecords,
        employees,
        laborRecords,
      })
    } catch {
      laborWindowProjectionError = '正式核算数据格式无效'
    }
  }
  const laborBridge = normalizeBridgeSummary(
    currentLaborBridgeResult?.data?.[bridgeRequestedMonth],
  )
  const laborBridgeLoading = laborBridgeState.loading || Boolean(
    bridgeTargetActive && bridgeEligible && !currentLaborBridgeResult &&
    !laborBridgeState.error,
  )
  const laborWindowUpdatedAt = [
    laborBridgeState.updatedAt,
    ...laborWindowInputStates.map((state) => state.updatedAt),
  ]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort()[0] || null
  const laborBridgeDisplayState = {
    identity: bridgeRequestIdentity,
    month: bridgeRequestedMonth,
    bridge: laborBridge,
    loading: laborBridgeLoading,
    stale: Boolean(
      laborBridge && (
        laborBridgeLoading ||
        laborBridgeState.error ||
        currentLaborBridgeResult?.windowStaleMonths?.includes(bridgeRequestedMonth)
      )
    ),
    error: laborBridgeState.error,
    updatedAt: laborBridgeState.updatedAt,
  }
  const laborWindowStateRaw = {
    loading: laborWindowInputLoading || (!currentLaborBridgeResult && laborBridgeLoading),
    error: laborWindowProjectionError || laborWindowInputFailure?.error ||
      (!currentLaborBridgeResult ? laborBridgeState.error : ''),
    code: laborWindowProjectionError
      ? 'DATA_OPERATION_FAILED'
      : laborWindowInputFailure?.code ||
        (!currentLaborBridgeResult && laborBridgeState.error ? 'DATA_OPERATION_FAILED' : ''),
    source: 'labor-bridge',
    updatedAt: laborWindowUpdatedAt,
  }
  const dashboardFilters = {
    projectId: dashboardQuery.projectId,
    projectStatus: dashboardQuery.projectStatus,
    rankingMetric: dashboardQuery.rankingMetric,
    page: dashboardQuery.page,
    pageSize: dashboardQuery.pageSize,
  }
  const purchaseLedgerAccrualSource = projectPersistentSource(purchaseRawState, {
    readAllowed: purchaseReadAccess.records,
    data: purchaseRecords,
  })
  const projectCostSource = projectPersistentSource(projectCostRawState, {
    readAllowed: dashboardAccess.costCategories.manualSupplement ||
      accountingAccess.monthlySummary.projectCost,
    data: projectCostRecords,
  })
  const warehouseAccountingSourceStates = buildWarehouseAccountingSourceStates({
    purchaseLedgerAccrual: purchaseLedgerAccrualSource,
    projectCosts: projectCostSource,
    warehouseContext: bindWarehouseContextToActor(
      warehouseMaterialCostContextState,
      activeActorId,
    ),
  })
  const dashboardSourceStates = {
    projects: projectPromiseSource(projectRawState, {
      readAllowed: projectRelationReadAccess,
      data: projects,
    }),
    contractRevenue: projectPromiseSource(contractRevenueRawState, {
      readAllowed: dashboardAccess.contracts.view,
      data: projectRevenueProjects,
    }),
    receipts: projectPromiseSource(contractRevenueRawState, {
      readAllowed: dashboardAccess.contracts.amounts,
      data: projectReceipts,
    }),
    laborWindow: projectLaborSource(laborWindowStateRaw, {
      readAllowed: (dashboardAccess.labor.amounts ||
        accountingAccess.monthlySummary.salary) && bridgeEligible,
      data: dashboardLaborWindow,
      stale: Boolean(
        currentLaborBridgeResult && (
          laborBridgeState.stale || dashboardLaborWindow?.lifetimeStale ||
          dashboardLaborWindow?.staleMonths?.length > 0
        )
      ),
    }),
    purchaseAccrual: warehouseAccountingSourceStates.purchaseLedgerAccrual,
    profitabilityPurchaseAccrual: warehouseAccountingSourceStates.purchaseAccrual,
    purchasePayments: projectPersistentSource(purchasePaymentRawState, {
      readAllowed: purchaseReadAccess.payments,
      data: purchasePaymentRecords,
    }),
    projectCosts: warehouseAccountingSourceStates.projectCosts,
    operatingExpenses: projectPersistentSource(operatingExpenseRawState, {
      readAllowed: dashboardAccess.costCategories.operatingExpense ||
        accountingAccess.monthlySummary.operatingExpense,
      data: operatingExpenseRecords,
    }),
    vehicles: projectPersistentSource(vehicleRawState, {
      readAllowed: dashboardAccess.vehicle.view,
      data: vehicles,
    }),
    vehicleUsage: projectPersistentSource(vehicleUsageRawState, {
      readAllowed: dashboardAccess.vehicle.view,
      data: vehicleUsageRecords,
    }),
    fuel: projectPersistentSource(fuelRawState, {
      readAllowed: dashboardAccess.vehicle.amounts || canAccessView(currentUser, 'vehicle'),
      data: fuelRecords,
    }),
    vehicleExpenses: projectPersistentSource(vehicleExpenseRawState, {
      readAllowed: dashboardAccess.vehicle.amounts || canAccessView(currentUser, 'vehicle'),
      data: vehicleExpenseRecords,
    }),
    vehicleIssues: projectPersistentSource(vehicleIssueRawState, {
      readAllowed: dashboardAccess.vehicle.amounts || canAccessView(currentUser, 'vehicle'),
      data: vehicleIssueRecords,
    }),
    attendance: projectPersistentSource(laborRawState, {
      readAllowed: dashboardAccess.attendance.view,
      data: laborRecords,
    }),
    inventoryItems: projectPersistentSource(inventoryRawState, {
      readAllowed: dashboardAccess.inventory.view,
      data: inventoryItems,
    }),
    stockInRecords: projectPersistentSource(stockInRawState, {
      readAllowed: dashboardAccess.inventory.view,
      data: stockInRecords,
    }),
    stockOutRecords: projectPersistentSource(stockOutRawState, {
      readAllowed: dashboardAccess.inventory.view,
      data: stockOutRecords,
    }),
    stockReturnRecords: projectPersistentSource(stockReturnRawState, {
      readAllowed: dashboardAccess.inventory.view,
      data: stockReturnRecords,
    }),
    toolRecords: projectPersistentSource(toolRawState, {
      readAllowed: dashboardAccess.tools.view,
      data: toolRecords,
    }),
    toolBorrowRecords: projectPersistentSource(toolBorrowRawState, {
      readAllowed: dashboardAccess.tools.view,
      data: normalizedToolBorrowRecords,
    }),
    toolReturnRecords: projectPersistentSource(toolReturnRawState, {
      readAllowed: dashboardAccess.tools.view,
      data: toolReturnRecords,
    }),
    lifelongToolAssignments: projectPersistentSource(lifelongToolRawState, {
      readAllowed: dashboardAccess.tools.view,
      data: lifelongToolAssignments,
    }),
    toolResponsibilityRecords: projectPersistentSource(toolResponsibilityRawState, {
      readAllowed: dashboardAccess.tools.view,
      data: toolResponsibilityRecords,
    }),
  }
  const accountingSourceStates = {
    ...dashboardSourceStates,
    purchaseAccrual: warehouseAccountingSourceStates.purchaseAccrual,
    purchaseLedgerAccrual: warehouseAccountingSourceStates.purchaseLedgerAccrual,
    projectLedgerSummary: projectLedgerSummaryState,
  }
  const handleDashboardNavigate = (targetView) => {
    const requestedRoute = getAdminRoute(targetView)
    const normalizedView = requestedRoute?.normalizeTo || requestedRoute?.view
    const route = getAdminRoute(normalizedView)
    if (!requestedRoute || !route || route.view !== normalizedView ||
        !canAccessView(currentUser, route.view)) {
      return false
    }
    return handlePersonnelAwareNavigate(route.view)
  }
  const bridgeStatusNotice = (
    <LaborBridgeStatusNotice
      eligible={bridgeTargetActive && bridgeEligible}
      state={laborBridgeDisplayState}
      onRetry={retryLaborBridge}
    />
  )
  const homeFinancialModels = buildHomeFinancialModels({
    currentUser,
    selectedMonth: currentMonthValue(),
    sourceStates: accountingSourceStates,
  })
  const homeSourceStates = {
    projects: projectPromiseSource(projectRawState, {
      readAllowed: canAccessView(currentUser, 'projects'),
      data: projects,
    }),
    employees: projectPersistentSource(employeeRawState, {
      readAllowed: canAccessView(currentUser, 'employees'),
      data: employees,
    }),
    stockOutRecords: projectPersistentSource(stockOutRawState, {
      readAllowed: canAccessView(currentUser, 'stockOut'),
      data: stockOutRecords,
    }),
    stockReturnRecords: projectPersistentSource(stockReturnRawState, {
      readAllowed: canAccessView(currentUser, 'stockReturn'),
      data: stockReturnRecords,
    }),
    attendance: projectPersistentSource(laborRawState, {
      readAllowed: canAccessView(currentUser, 'labor'),
      data: laborRecords,
    }),
    vehicles: projectPersistentSource(vehicleRawState, {
      readAllowed: canAccessView(currentUser, 'vehicle'),
      data: vehicles,
    }),
    toolBorrowRecords: projectPersistentSource(toolBorrowRawState, {
      readAllowed: canAccessView(currentUser, 'toolBorrow'),
      data: normalizedToolBorrowRecords,
    }),
    warehouseSummary: warehouseHomeState,
    costSummary: homeFinancialModels.cost,
    purchaseSummary: homeFinancialModels.purchase,
  }
  const homeModel = buildAuthorizedHomeModel({
    user: currentUser,
    routes: getVisibleAdminRoutes(currentUser),
    sourceStates: homeSourceStates,
  })
  const homeSummary = buildAuthorizedHomeSummary(currentUser, {
    homeModel,
    projects: projectRevenueProjects,
  })
  const dashboardAlertState = dashboardAccess.page
    ? buildExecutiveDashboardReadModel({
        asOfDate: todayValue(),
        selectedMonth: bridgeRequestedMonth,
        filters: dashboardFilters,
        access: dashboardAccess,
        sources: dashboardSourceStates,
      }).alerts
    : { status: 'forbidden', data: [], stale: false }
  const authorizedMessages = buildAuthorizedMessages({
    access: { user: currentUser, dashboard: dashboardAccess },
    alerts: dashboardAlertState,
  })
  const workbenchCounts = Object.fromEntries(
    homeModel.modules.map((module) => [
      module.view,
      module.view === 'labor' ? laborAlertCount : module.badgeCount,
    ]),
  )
  const workbenchItems = buildWorkbenchItems({ user: currentUser, counts: workbenchCounts })

  const renderInDesktopShell = (page) => (
    <DesktopAdminShell
      currentView={authorizedView}
      currentUser={currentUser}
      onNavigate={handlePersonnelAwareNavigate}
      onLogout={handlePersonnelAwareLogout}
      laborAlertCount={laborAlertCount}
      laborAlertStale={laborAlertStale}
      workbenchItems={workbenchItems}
      messages={authorizedMessages}
    >
      {page}
    </DesktopAdminShell>
  )

  if (authorizedView === 'workbench') {
    return renderInDesktopShell(
      <MobileWorkbenchPage
        currentUser={currentUser}
        items={workbenchItems}
        onNavigate={handlePersonnelAwareNavigate}
      />,
    )
  }

  if (authorizedView === 'messages') {
    return renderInDesktopShell(
      <MobileMessagesPage
        currentUser={currentUser}
        messages={authorizedMessages}
        onNavigate={handleDashboardNavigate}
      />,
    )
  }

  if (authorizedView === 'profile') {
    return renderInDesktopShell(
      <MobileProfilePage currentUser={currentUser} onLogout={handlePersonnelAwareLogout} />,
    )
  }

  if (authorizedView === 'contractRevenue') {
    return renderInDesktopShell(
      <ContractRevenuePage
        project={contractRevenueProject}
        revenueSnapshot={projectRevenueSnapshots.get(contractRevenueProjectId)}
        contractChanges={projectContractChanges}
        paymentPlans={projectPaymentPlans}
        receipts={projectReceipts}
        currentUser={currentUser}
        canViewFinancials={contractRevenueAccess.view}
        canUpdateFinancials={contractRevenueAccess.update}
        onProjectChange={handleContractRevenueProjectChange}
        onHistoricalReview={handleHistoricalContractReview}
        onCreateContractChange={handleCreateContractChange}
        onVoidContractChange={handleVoidContractChange}
        onSavePaymentPlan={handleSavePaymentPlan}
        onCreateCustomerReceipt={handleCreateCustomerReceipt}
        onVoidCustomerReceipt={handleVoidCustomerReceipt}
        onBack={() => handlePersonnelAwareNavigate('projects')}
      />
    )
  }

  if (authorizedView === 'miraisyaSettlement') {
    return renderInDesktopShell(
      <MiraisyaSettlementPage
        currentUser={currentUser}
        service={miraisyaSettlementService}
        onBack={() => handlePersonnelAwareNavigate('projects')}
        onAuthInvalid={onLogout}
      />,
    )
  }

  if (authorizedView === 'projects') {
    if (miraisyaProject) {
      return renderInDesktopShell(
        <MiraisyaProjectPanel
          project={miraisyaProject}
          billingService={miraisyaBillingService}
          costLedgerService={activeProjectCostLedgerService}
          onClose={() => setMiraisyaProjectId('')}
        />,
      )
    }
    return renderInDesktopShell(
      <>
        {bridgeStatusNotice}
        <ProjectPage
          projects={projects}
          projectRevenueSnapshots={projectRevenueSnapshots}
          currentUser={currentUser}
          employeeDirectory={projectEmployeeDirectory}
          directoryState={projectDirectoryState}
          onRetryDirectory={refreshProjectEmployeeDirectory}
          onCreateProject={handleCreateProject}
          onUpdateProject={handleUpdateProject}
          onDeleteProject={handleDeleteProject}
          onOpenContractRevenue={openContractRevenue}
          onOpenMiraisyaProject={setMiraisyaProjectId}
          onOpenMiraisyaSettlement={() => handlePersonnelAwareNavigate('miraisyaSettlement')}
          onBack={() => handlePersonnelAwareNavigate('home')}
        />
      </>
    )
  }

  if (authorizedView === 'todayAttendance') {
    return renderInDesktopShell(
      <TodayAttendancePage
        currentUser={currentUser}
        onAuthInvalid={onLogout}
        onBack={() => handlePersonnelAwareNavigate('home')}
      />,
    )
  }

  if (authorizedView === 'employees') {
    return renderInDesktopShell(
      <PersonnelPage
        employees={personnelEmployees}
        currentEmployee={currentUser}
        employeeAdmin={employeeAdminService}
        loadState={personnelLoadState}
        onRefreshEmployees={refreshPersonnelEmployees}
        onAuthInvalid={onLogout}
        onCriticalStateChange={handlePersonnelCriticalStateChange}
        permissionTemplateService={permissionTemplateService}
        onPermissionTemplatesChanged={onLogout}
        onTemplateCriticalStateChange={handleTemplateCriticalStateChange}
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  if (authorizedView === 'dashboard') {
    return renderInDesktopShell(
      <DashboardPage
        asOfDate={todayValue()}
        selectedMonth={dashboardQuery.selectedMonth}
        filters={dashboardFilters}
        access={dashboardAccess}
        sources={dashboardSourceStates}
        viewerName={currentUser.name}
        onFiltersChange={handleDashboardFiltersChange}
        onNavigate={handleDashboardNavigate}
      />
    )
  }

  if (authorizedView === 'purchase') {
    return renderInDesktopShell(
      <PurchaseManagementPage
        access={purchaseAccess}
        projects={projects}
        employees={employees}
        purchaseRecords={purchaseRecords}
        setPurchaseRecords={setPurchaseRecords}
        onCreatePurchase={handleCreatePurchase}
        onUpdatePurchase={handleUpdatePurchase}
        onDeletePurchase={handleDeletePurchase}
        persistPurchasePaymentCache={persistPurchasePaymentCache}
        purchasePaymentRecords={purchasePaymentRecords}
        purchasePaymentState={dashboardSourceStates.purchasePayments}
        setPurchasePaymentRecords={setPurchasePaymentRecords}
        onPersistenceError={setPersistenceFailure}
        stockInRecords={stockInRecords}
        inventoryItems={inventoryItems}
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  if (authorizedView === 'labor') {
    return renderInDesktopShell(
      <LaborAccountingPage
        currentUser={currentUser}
        onBack={() => handlePersonnelAwareNavigate('home')}
        onAuthInvalid={onLogout}
        onAlertCountChange={refreshLaborAlertCount}
      />
    )
  }

  if (authorizedView === 'vehicle') {
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
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  if (authorizedView === 'toolBorrow') {
    return renderInDesktopShell(
      <ToolManagementPage
        initialSection="borrow"
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
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  if (authorizedView === 'accounting') {
    return renderInDesktopShell(
      <AccountingCostPage
        access={accountingAccess}
        projectCostLedgerService={activeProjectCostLedgerService}
        projectCostActorFingerprint={projectCostActorFingerprint}
        onProjectCostAuthInvalid={onLogout}
        onProjectCostLedgerInvalidated={projectLedgerSummaryState.invalidate}
        vehicleAccess={canAccessView(currentUser, 'vehicle')}
        sourceStates={accountingSourceStates}
        projects={projects}
        employees={employees}
        salaryRecords={salaryRecords}
        setSalaryRecords={setSalaryRecords}
        projectCostRecords={projectCostRecords}
        setProjectCostRecords={setProjectCostRecords}
        saveManualProjectCost={handleSaveManualProjectCost}
        deleteManualProjectCost={handleDeleteManualProjectCost}
        operatingExpenseRecords={operatingExpenseRecords}
        setOperatingExpenseRecords={setOperatingExpenseRecords}
        purchaseRecords={purchaseRecords}
        purchasePaymentRecords={purchasePaymentRecords}
        purchasePaymentState={dashboardSourceStates.purchasePayments}
        laborRecords={laborRecords}
        fuelRecords={fuelRecords}
        vehicleExpenseRecords={vehicleExpenseRecords}
        vehicleIssueRecords={vehicleIssueRecords}
        monthFilter={accountingMonth}
        onMonthFilterChange={handleAccountingMonthChange}
        laborBridge={laborBridge}
        bridgeStatusNotice={bridgeStatusNotice}
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  if (authorizedView === 'settings') {
    return renderInDesktopShell(
      <SystemSettingsPage
        currentUser={currentUser}
        storageKeys={MIGRATABLE_STORAGE_KEYS}
        loadContractMigrationPreview={loadContractMigrationPreview}
        executeContractMigration={executeContractMigration}
        onLocalContractRevenueMigrationComplete={
          handleLocalContractRevenueMigrationComplete
        }
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  if (authorizedView === 'warehouse') {
    return renderInDesktopShell(
      <Suspense fallback={<main className="warehouse-management-page"><p>正在载入仓库管理…</p></main>}>
        <WarehouseManagementPage
          access={warehouseAccess}
          currentUser={currentUser}
          companyName="生旺株式会社"
          warehouseService={warehouseService}
          warehouseConfirmationService={warehouseConfirmationService}
          warehouseMediaService={warehouseRequestMediaService}
          onNavigate={handlePersonnelAwareNavigate}
          onBack={() => handlePersonnelAwareNavigate('home')}
          onAuthInvalid={onLogout}
        />
      </Suspense>
    )
  }

  if (authorizedView === 'stockOut' || authorizedView === 'stockReturn') {
    if (!warehouseAccess.requestStockFlow && !warehouseAccess.confirmStockFlow) return null
    return renderInDesktopShell(
      <Suspense fallback={<main className="warehouse-management-page"><p>正在载入仓库申请…</p></main>}>
        <WarehouseRequestPage
          mode={authorizedView}
          projects={projects}
          currentUser={currentUser}
          onBack={() => handlePersonnelAwareNavigate('home')}
          onAuthInvalid={onLogout}
          warehouseService={warehouseService}
          confirmationService={warehouseConfirmationService}
          warehouseMediaService={warehouseRequestMediaService}
          viewCost={warehouseAccess.viewCost}
          canRequest={warehouseAccess.requestStockFlow}
          canConfirm={warehouseAccess.confirmStockFlow}
        />
      </Suspense>
    )
  }

  if (businessConfigs[authorizedView]) {
    return renderInDesktopShell(
      <BusinessPage
        config={businessConfigs[authorizedView]}
        projects={projects}
        employees={employees}
        records={recordGroups[authorizedView]}
        setRecords={recordSetters[authorizedView]}
        onBack={() => handlePersonnelAwareNavigate('home')}
      />
    )
  }

  return renderInDesktopShell(
    <HomePage
      summary={homeSummary}
      model={homeModel}
      currentUser={currentUser}
      onLogout={onLogout}
      onOpenView={handlePersonnelAwareNavigate}
    />
  )
}

function buildLegacyHomePresentation(currentUser, summary) {
  const safeSummary = summary && typeof summary === 'object' ? summary : emptyHomeSummary()
  const moduleCounts = safeSummary.moduleCounts && typeof safeSummary.moduleCounts === 'object'
    ? safeSummary.moduleCounts
    : {}
  const modules = getVisibleAdminRoutes(currentUser)
    .filter((route) => route.view !== 'home')
    .map((route) => {
      let displayValue = '进入'
      if (route.view === 'accounting') {
        displayValue = isSafeCostAccountingAmount(safeSummary.monthlyCostTotal)
          ? formatYen(safeSummary.monthlyCostTotal)
          : '待核算'
      } else if (route.view === 'purchase') {
        displayValue = Number.isSafeInteger(safeSummary.monthlyPurchaseTotal)
          ? formatYen(safeSummary.monthlyPurchaseTotal)
          : '待核算'
      } else if (Number.isSafeInteger(moduleCounts[route.view])) {
        displayValue = String(moduleCounts[route.view])
      } else if (route.view === 'dashboard' || route.view === 'settings') {
        displayValue = '查看'
      }
      return {
        view: route.view,
        label: route.label,
        iconText: route.iconText,
        badgeCount: Number.isSafeInteger(moduleCounts[route.view])
          ? moduleCounts[route.view]
          : 0,
        displayValue,
        sourceStatus: 'ready',
        sourceStale: false,
      }
    })

  return {
    viewer: {
      name: currentUser?.name || '',
      department: currentUser?.department || '',
      position: currentUser?.position || '',
      isSuperAdmin: isSuperAdmin(currentUser),
    },
    overview: [
      { key: 'active-projects', value: safeSummary.activeProjects || 0, label: '进行中项目' },
      { key: 'authorized-records', value: safeSummary.totalRecords || 0, label: '已授权业务记录' },
      { key: 'paused-projects', value: safeSummary.pausedProjects || 0, label: '暂停项目' },
    ],
    modules,
    sourceNotices: [],
    summary: safeSummary,
  }
}

function HomePage({ model, summary, currentUser, onLogout, onOpenView }) {
  const today = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).format(new Date())
  model = getAuthorizedHomeSummary(model)
    ? model
    : buildLegacyHomePresentation(currentUser, summary)
  const isPendingAuthorization =
    (currentUser.effectivePermissionKeys || []).length === 0

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
          {model.overview.map((item) => (
            <div className="summary-item" key={item.key}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        {model.viewer.isSuperAdmin && (
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
          {model.modules.map((module) => (
            <button
              className={`module-card module-${module.view} is-${module.sourceStatus}`}
              type="button"
              key={module.view}
              onClick={() => onOpenView(module.view)}
            >
              <span className="module-icon" aria-hidden="true">
                {module.iconText}
              </span>
              <span className="module-copy">
                <strong>{module.label}</strong>
                <small>{module.sourceStale ? '数据可能已过期' : '进入业务模块'}</small>
              </span>
              <span className="module-count">{module.displayValue}</span>
              <span className="module-action">查看详情</span>
            </button>
          ))}
        </div>
        {model.sourceNotices.length > 0 && (
          <div className="home-source-notices" aria-label="授权数据源状态">
            {model.sourceNotices.map((notice) => (
              <span className={`status-${notice.status}`} key={notice.view}>{notice.message}</span>
            ))}
          </div>
        )}
        {model.modules.length === 0 && (
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
  loadContractMigrationPreview,
  executeContractMigration,
  onLocalContractRevenueMigrationComplete: handleLocalContractRevenueMigrationComplete,
  onBack,
}) {
  const [isMigrating, setIsMigrating] = useState(false)
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

  return (
    <PageShell title="系统设置" subtitle="云端数据库与数据迁移" onBack={onBack}>
      <section className="form-card">
        <div className="section-heading">
          <h2>Supabase 云端数据库</h2>
          <span>{isCloudDatabaseReady() ? '已配置' : '未配置'}</span>
        </div>
        <div className="detail-list">
          <span>业务数据：仅在认证会话与云端权限验证成功后读取和保存</span>
          <span>登录状态：由 Supabase Auth 安全会话管理</span>
          <span>失败策略：认证、权限或网络错误时停止访问，不回退本机旧数据</span>
          <span>附件：已预留 attachments 字段，后续接 Supabase Storage</span>
        </div>
      </section>

      {isSuperAdmin(currentUser) && (
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

      {canMigrate && (
        <ContractRevenueMigrationPanel
          canExecute={canMigrate}
          onMigrationComplete={handleLocalContractRevenueMigrationComplete}
          loadPreview={loadContractMigrationPreview}
          executeMigration={executeContractMigration}
        />
      )}

      {canMigrate && (
        <section className="form-card">
          <div className="section-heading">
            <h2>localStorage → Supabase 数据迁移</h2>
            <span>{canMigrate ? '最高权限可用' : '无权限'}</span>
          </div>
          <div className="empty-state cost-note">
            迁移工具只处理明确允许的旧业务缓存，不包含旧员工档案。每次迁移都会重新确认登录会话并由云端 RLS 校验权限；失败后不会继续重试整表。
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
      )}

    </PageShell>
  )
}

function LegacyEmployeeCompatibilityPage({ employees, onBack }) {
  const [nameFilter, setNameFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [agencyFilter, setAgencyFilter] = useState('')

  const agencies = Array.from(
    new Set(employees.map((employee) => employee.visaAgency).filter(Boolean)),
  )

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
      subtitle="旧员工兼容档案（不可信，只读）"
      onBack={onBack}
    >
      <div className="empty-state cost-note" role="note">
        此处只用于识别历史业务记录中的旧员工编号，不是当前认证员工目录，也不能用于登录、授权、新增或修改。规范员工资料由服务端人员管理接口维护。
      </div>

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
                <div><dt>兼容用途</dt><dd>仅历史记录人工映射</dd></div>
              </dl>
            </article>
          ))
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
    <PageShell
      title="车辆管理"
      subtitle="车辆轨迹・费用・项目分摊"
      rootClassName="vehicle-management-page"
      onBack={onBack}
    >
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

    const record = normalizeSubmittedFuelRecord({
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

    const record = normalizeSubmittedVehicleExpenseRecord({
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
  const canManageTools = isSuperAdmin(currentUser) || canEdit(currentUser, '工具管理')
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
    <PageShell
      title="工具管理"
      subtitle="临时借用・终身领用・责任记录"
      rootClassName="tool-management-page"
      onBack={onBack}
    >
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
          projects={projects}
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

export function ToolResponsibilitySection({ projects = [], employees, assignments, setAssignments, toolRecords, setToolRecords, records, setRecords, canManageTools }) {
  const [form, setForm] = useState(createEmptyToolResponsibilityForm)
  const selectedAssignment = assignments.find((assignment) => assignment.assignmentId === form.assignmentId)
  const handler = employees.find((employee) => employee.employeeId === form.handlerEmployeeId)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)

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
    const grossCost = toolResponsibilityGrossCost({
      issueType: form.issueType,
      toolValue: form.toolValue || selectedAssignment.toolValue,
      repairCost: form.repairCost,
    })
    const allocateToProject = form.allocateToProject && grossCost > 0
    if (allocateToProject && !selectedProject) {
      window.alert('请选择工程项目')
      return
    }
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
      allocateToProject,
      projectId: allocateToProject ? selectedProject.projectId : '',
      projectName: allocateToProject ? selectedProject.projectName : '',
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
          {toolResponsibilityGrossCost({
            issueType: form.issueType,
            toolValue: form.toolValue || selectedAssignment?.toolValue,
            repairCost: form.repairCost,
          }) > 0 && (
            <FormGroup title="项目成本">
              <label className="field full-width">
                <span>计入项目成本</span>
                <input
                  type="checkbox"
                  checked={form.allocateToProject}
                  onChange={(event) => setForm({
                    ...form,
                    allocateToProject: event.target.checked,
                    projectId: event.target.checked ? form.projectId : '',
                  })}
                />
              </label>
              {form.allocateToProject && (
                <ProjectSelect
                  projects={projects}
                  value={form.projectId}
                  onChange={(value) => setForm({ ...form, projectId: value })}
                />
              )}
            </FormGroup>
          )}
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
              <div><dt>项目成本</dt><dd>{record.allocateToProject ? record.projectName : '公司级'}</dd></div>
              <div><dt>备注</dt><dd>{record.remark || '未填写'}</dd></div>
            </dl>
          </article>
        ))
      )}
    </div>
  )
}

export function AccountingCostPage({
  access,
  projectCostLedgerService,
  projectCostActorFingerprint,
  onProjectCostAuthInvalid,
  onProjectCostLedgerInvalidated,
  vehicleAccess,
  sourceStates,
  projects,
  employees,
  salaryRecords,
  setSalaryRecords,
  projectCostRecords,
  setProjectCostRecords,
  saveManualProjectCost,
  deleteManualProjectCost,
  operatingExpenseRecords,
  setOperatingExpenseRecords,
  purchaseRecords,
  purchasePaymentRecords,
  purchasePaymentState,
  laborRecords,
  fuelRecords,
  vehicleExpenseRecords,
  vehicleIssueRecords,
  monthFilter,
  onMonthFilterChange,
  laborBridge,
  bridgeStatusNotice,
  onBack,
}) {
  const resolvedAccess = access || {
    salary: { view: true, create: true, update: true, delete: true },
    projectCost: { view: true, create: true, update: true, delete: true },
    operatingExpense: { view: true, create: true, update: true, delete: true },
    purchaseAccounting: { view: true },
    monthlySummary: {
      salary: true,
      projectCost: true,
      operatingExpense: true,
      purchaseAccrual: true,
      purchasePayments: true,
    },
  }
  const monthlySummaryVisible = Object.values(resolvedAccess.monthlySummary).some(Boolean)
  const sections = [
    ...(resolvedAccess.salary.view ? [{ id: 'salary', title: '工资记录' }] : []),
    ...(resolvedAccess.projectCost.view ? [{ id: 'projectCost', title: '项目成本' }] : []),
    ...(resolvedAccess.operatingExpense.view
      ? [{ id: 'operatingExpense', title: '经营费用' }]
      : []),
    ...(resolvedAccess.purchaseAccounting.view
      ? [{ id: 'purchaseAccounting', title: '采购对账' }]
      : []),
    ...(monthlySummaryVisible ? [{ id: 'monthlySummary', title: '月度汇总' }] : []),
  ]
  const [section, setSection] = useState(() => sections[0]?.id || '')
  const visibleSection = sections.some((item) => item.id === section)
    ? section
    : sections[0]?.id || ''
  useEffect(() => {
    if (!sections.some((item) => item.id === section)) setSection(sections[0]?.id || '')
  }, [section, sections])

  return (
    <PageShell
      title="会计成本中心"
      subtitle="AccountingCostCenter"
      rootClassName="accounting-cost-page"
      onBack={onBack}
    >
      {bridgeStatusNotice}
      {sections.length === 0 && <EmptyState text="当前账号无可用功能" />}
      <div className="accounting-entry-grid">
        {sections.map((item) => (
          <button
            className={`accounting-entry ${visibleSection === item.id ? 'active' : ''}`}
            type="button"
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {visibleSection === 'salary' && (
        <SalaryRecordsSection access={resolvedAccess.salary} employees={employees} records={salaryRecords} setRecords={setSalaryRecords} />
      )}
      {visibleSection === 'projectCost' && (
        <ProjectCostLedgerSection
          service={projectCostLedgerService}
          actorFingerprint={projectCostActorFingerprint}
          onAuthInvalid={onProjectCostAuthInvalid}
          onLedgerInvalidated={onProjectCostLedgerInvalidated}
          projects={projects}
          access={resolvedAccess.projectCost}
        />
      )}
      {visibleSection === 'operatingExpense' && (
        <OperatingExpenseSection
          projects={projects}
          employees={employees}
          records={operatingExpenseRecords}
          setRecords={setOperatingExpenseRecords}
          access={resolvedAccess.operatingExpense}
        />
      )}
      {visibleSection === 'purchaseAccounting' && (
        <PurchaseAccountingSection
          projects={projects}
          purchaseRecords={purchaseRecords}
          purchasePaymentRecords={purchasePaymentRecords}
          paymentState={purchasePaymentState}
          accrualState={sourceStates.purchaseLedgerAccrual}
          monthFilter={monthFilter}
          onMonthFilterChange={onMonthFilterChange}
        />
      )}
      {visibleSection === 'monthlySummary' && (
        <MonthlySummarySection
          access={resolvedAccess.monthlySummary}
          vehicleAccess={vehicleAccess}
          sourceStates={sourceStates}
          monthFilter={monthFilter}
          onMonthFilterChange={onMonthFilterChange}
        />
      )}
    </PageShell>
  )
}

function SalaryRecordsSection({ access, employees, records, setRecords }) {
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
    if ((editingId && !access.update) || (!editingId && !access.create)) return

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
      {(access.create || (editingId && access.update)) && (
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
      )}

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
                canEdit={access.update}
                canDelete={access.delete}
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

export function ProjectCostSection({
  access,
  projects,
  employees,
  records,
  setRecords,
  saveRecord,
  deleteRecord,
}) {
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

  const handleSubmit = async (event) => {
    event.preventDefault()
    if ((editingId && !access.update) || (!editingId && !access.create)) return

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

    try {
      if (typeof saveRecord === 'function') {
        await saveRecord(payload)
      } else if (editingId) {
        setRecords((currentRecords) =>
          currentRecords.map((record) => (record.costRecordId === editingId ? payload : record)),
        )
      } else {
        setRecords((currentRecords) => [payload, ...currentRecords])
      }
      resetForm()
    } catch {
      return
    }
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
      <div className="empty-state cost-note">
        采购成本已由采购管理自动归集，不得重复手工录入；需要更正时请前往采购管理。
      </div>
      {records.some((record) => isWarehouseManagedProjectCost(record)) && (
        <div className="empty-state cost-note">
          仓库自动成本仅能通过仓库冲销更正
        </div>
      )}
      {projects.length === 0 && <EmptyState text="请先在工程项目中新增项目" />}

      {(access.create || (editingId && access.update)) && (
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
      )}

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
        canEdit={(record) => access.update && !isWarehouseManagedProjectCost(record)}
        canDelete={(record) => access.delete && !isWarehouseManagedProjectCost(record)}
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
          try {
            assertManualProjectCostMutable(record)
          } catch {
            return
          }
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
        onDelete={async (record) => {
          try {
            assertManualProjectCostMutable(record)
          } catch {
            return
          }
          if (window.confirm('确定删除这条项目成本记录吗？')) {
            try {
              if (typeof deleteRecord === 'function') {
                await deleteRecord(record)
              } else {
                setRecords((currentRecords) =>
                  currentRecords.filter((item) => item.costRecordId !== record.costRecordId),
                )
              }
            } catch {
              return
            }
          }
        }}
      />
    </>
  )
}

function OperatingExpenseSection({ access, projects, employees, records, setRecords }) {
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
    if ((editingId && !access.update) || (!editingId && !access.create)) return

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
      {(access.create || (editingId && access.update)) && (
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
      )}

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
        canEdit={access.update}
        canDelete={access.delete}
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

export function MonthlySummarySection({
  access,
  vehicleAccess = false,
  sourceStates,
  monthFilter,
  onMonthFilterChange,
}) {
  const resolvedAccess = access || {
    salary: true,
    projectCost: true,
    operatingExpense: true,
    purchaseAccrual: true,
    purchasePayments: true,
  }
  const resolveArraySource = (key, allowed) => {
    if (!allowed) return { status: 'forbidden', data: null }
    const state = sourceStates?.[key]
    if (state?.stale === true) return { status: 'loading', data: null }
    if (state?.status !== 'ready' || !Array.isArray(state.data)) {
      return { status: state?.status === 'error' ? 'error' : 'loading', data: null }
    }
    return { status: 'ready', data: state.data }
  }
  const resolveLaborWindowSource = (allowed) => {
    if (!allowed) return { status: 'forbidden', data: null }
    const state = sourceStates?.laborWindow
    if (state?.stale === true) return { status: 'loading', data: null }
    if (state?.status !== 'ready' || state.data === null ||
        typeof state.data !== 'object' || Array.isArray(state.data)) {
      return { status: state?.status === 'error' ? 'error' : 'loading', data: null }
    }
    return { status: 'ready', data: state.data }
  }
  const resolveProjectLedgerSummarySource = (allowed) => {
    if (!allowed) return { status: 'forbidden', data: null }
    if (!Object.hasOwn(sourceStates || {}, 'projectLedgerSummary')) return null
    const state = sourceStates.projectLedgerSummary
    if (state?.stale === true) return { status: 'loading', data: null }
    if (state?.status !== 'ready' || state.data === null ||
        typeof state.data !== 'object' || Array.isArray(state.data)) {
      return { status: state?.status === 'error' ? 'error' : 'loading', data: null }
    }
    return { status: 'ready', data: state.data }
  }

  const laborWindowState = resolveLaborWindowSource(resolvedAccess.salary)
  const projectCostState = resolveArraySource('projectCosts', resolvedAccess.projectCost)
  const projectLedgerSummaryState = resolveProjectLedgerSummarySource(
    resolvedAccess.projectCost,
  )
  const operatingExpenseState = resolveArraySource(
    'operatingExpenses', resolvedAccess.operatingExpense,
  )
  const purchaseAccrualState = resolveArraySource(
    'purchaseAccrual', resolvedAccess.purchaseAccrual,
  )
  const purchaseLedgerAccrualState = resolveArraySource(
    'purchaseLedgerAccrual', resolvedAccess.purchaseAccrual,
  )
  const purchasePaymentState = resolveArraySource(
    'purchasePayments', resolvedAccess.purchasePayments,
  )
  const projectRelationAccess = resolvedAccess.projectCost ||
    resolvedAccess.operatingExpense || resolvedAccess.purchaseAccrual || vehicleAccess
  const projectState = resolveArraySource('projects', projectRelationAccess)
  const fuelState = resolveArraySource('fuel', vehicleAccess)
  const vehicleExpenseState = resolveArraySource('vehicleExpenses', vehicleAccess)
  const vehicleIssueState = resolveArraySource('vehicleIssues', vehicleAccess)
  const months = buildMonthWindow(monthFilter, 12)
  const projectRelationsReady = projectState.status === 'ready'
  const activeProjectIds = [...new Set((projectState.data || [])
    .map((project) => project?.projectId)
    .filter((projectId) => typeof projectId === 'string' &&
      projectId.length > 0 && projectId !== 'all'))]
  const completeTotalVisible = Boolean(
    resolvedAccess.salary && resolvedAccess.projectCost &&
    resolvedAccess.operatingExpense && resolvedAccess.purchaseAccrual && vehicleAccess,
  )
  const costSourceStates = [
    projectState, laborWindowState,
    projectCostState,
    operatingExpenseState,
    purchaseAccrualState,
    fuelState,
    vehicleExpenseState,
    vehicleIssueState,
    ...(projectLedgerSummaryState ? [projectLedgerSummaryState] : []),
  ]
  const allCostSourcesReady = costSourceStates.every((state) => state.status === 'ready')
  const unavailableLaborWindow = {
    monthly: [],
    projectLaborLifetimeById: null,
    lifetimeStatus: 'error',
    lifetimeStale: false,
    incompleteMonths: months,
    staleMonths: [],
  }
  let costModel = null
  let costModelError = false
  if (months.length === 12) {
    try {
      costModel = buildCostAccountingReadModel({
        months,
        selectedMonth: monthFilter,
        projectId: 'all',
        activeProjectIds,
        laborWindow: laborWindowState.status === 'ready'
          ? laborWindowState.data
          : unavailableLaborWindow,
        purchaseRows: purchaseAccrualState.data || [],
        fuelRecords: fuelState.data || [],
        vehicleExpenseRecords: vehicleExpenseState.data || [],
        vehicleIssueRecords: vehicleIssueState.data || [],
        manualProjectCosts: projectCostState.data || [],
        operatingExpenses: operatingExpenseState.data || [],
        ...(projectLedgerSummaryState
          ? { projectLedgerSummary: projectLedgerSummaryState }
          : {}),
      })
    } catch {
      costModelError = true
    }
  }
  const companyMonthlyTotal = costModel ? costModel.companyMonthlyTotal : null
  const projectLedgerStatus = costModel?.projectLedger?.status || null
  const selectedComposition = costModel ? costModel.selectedComposition : null
  const pending = costModel ? costModel.pending : {
    manualLaborCosts: [],
    manualMaterialCosts: [],
    manualToolCosts: [],
    manualVehicleCosts: [],
    vehicleRepairEstimates: [],
  }
  const selectedLaborMonth = laborWindowState.status === 'ready'
    ? laborWindowState.data.monthly?.find((row) => row?.month === monthFilter)
    : null
  const laborSalary = selectedLaborMonth?.status === 'ready'
    ? selectedLaborMonth.salaryTotal
    : null
  const allocatedLabor = selectedLaborMonth?.status === 'ready'
    ? selectedLaborMonth.projectLaborTotal
    : null
  const unallocatedLabor = Number.isFinite(laborSalary) && Number.isFinite(allocatedLabor)
    ? Math.max(laborSalary - allocatedLabor, 0)
    : null
  const allocationRate = Number.isFinite(laborSalary) && laborSalary > 0 &&
      Number.isFinite(allocatedLabor)
    ? Math.round((allocatedLabor / laborSalary) * 100)
    : 0

  const purchaseAccounting = purchaseLedgerAccrualState.status === 'ready'
    ? buildPurchaseAccountingReadModel({
      purchaseRecords: purchaseLedgerAccrualState.data,
      paymentRecords: purchasePaymentState.data || [],
      paymentState: purchasePaymentState,
      month: monthFilter,
    })
    : null
  const monthlyPurchases = purchaseAccounting
    ? purchaseAccounting.rows.filter(
      (record) => monthFromDate(record.purchaseDate) === monthFilter &&
        record.purchaseStatus !== '作废',
    )
    : []
  const totalPurchaseCost = purchaseAccounting?.summary.monthPurchaseCost
  const purchaseBySource = (source) => monthlyPurchases
    .filter((record) => record.purchaseSource === source)
    .reduce((total, record) => total + toAmount(record.totalCost), 0)
  const unpaidPurchaseCost = purchaseAccounting?.summary.currentOutstanding
  const monthPaymentCash = purchaseAccounting?.summary.monthPaymentCash
  const purchasePaymentVisible = purchaseLedgerAccrualState.status === 'ready' &&
    resolvedAccess.purchasePayments &&
    purchasePaymentState.status === 'ready' &&
    purchaseAccounting?.currentPayable.status === 'ready'
  const visibleSourceFailures = costSourceStates.filter(
    (state) => state !== projectLedgerSummaryState &&
      (state.status === 'loading' || state.status === 'error'),
  )
  const pendingDefinitions = [
    ['manualLaborCosts', '待核算手工人工费', 'amount'],
    ['manualMaterialCosts', '待核算手工材料费', 'amount'],
    ['manualToolCosts', '待核算手工工具费', 'amount'],
    ['manualVehicleCosts', '待核算手工车辆费', 'amount'],
    ['vehicleRepairEstimates', '待核算维修估算', 'repairCost'],
  ]

  return (
    <>
      <SectionTitle title="月度汇总" note={monthFilter} />
      <div className="filter-panel">
        <Field label="统计月份" type="month" value={monthFilter} onChange={onMonthFilterChange} />
      </div>

      {visibleSourceFailures.some((state) => state.status === 'loading') && (
        <EmptyState text="成本数据正在加载" />
      )}
      {visibleSourceFailures.some((state) => state.status === 'error') && (
        <EmptyState text="成本数据暂不可用" />
      )}
      {projectLedgerSummaryState?.status === 'loading' && (
        <EmptyState text="项目成本明细账正在加载" />
      )}
      {projectLedgerSummaryState?.status === 'error' && (
        <EmptyState text="项目成本明细账暂不可用" />
      )}
      {projectLedgerStatus === 'incomplete' && (
        <EmptyState text="项目成本明细账数据不完整" />
      )}
      {costModelError && <EmptyState text="成本数据格式异常，暂不可用" />}

      <div className="stats-grid">
        {Number.isFinite(laborSalary) && (
          <div className="stat-card money">
            <strong>{formatYen(laborSalary)}</strong>
            <span>本月工资发放</span>
          </div>
        )}
        {Number.isFinite(allocatedLabor) && (
          <div className="stat-card money">
            <strong>{formatYen(allocatedLabor)}</strong>
            <span>本月项目人工分摊</span>
          </div>
        )}
        {Number.isFinite(unallocatedLabor) && (
          <div className="stat-card money">
            <strong>{formatYen(unallocatedLabor)}</strong>
            <span>本月未分摊人工成本</span>
          </div>
        )}
        {Number.isFinite(laborSalary) && (
          <div className="stat-card">
            <strong>{formatPercent(allocationRate)}</strong>
            <span>项目人工分摊率</span>
          </div>
        )}
        {projectRelationsReady && purchaseLedgerAccrualState.status === 'ready' && (
          <div className="stat-card money">
            <strong>{formatYen(totalPurchaseCost)}</strong>
            <span>本月采购确认成本</span>
          </div>
        )}
        {projectRelationsReady && vehicleAccess && fuelState.status === 'ready' &&
          vehicleExpenseState.status === 'ready' && vehicleIssueState.status === 'ready' &&
          companyMonthlyTotal && Number.isFinite(companyMonthlyTotal.vehicle) && (
          <div className="stat-card money">
            <strong>{formatYen(companyMonthlyTotal.vehicle)}</strong>
            <span>车辆费用合计</span>
          </div>
        )}
        {projectRelationsReady && resolvedAccess.projectCost &&
          projectCostState.status === 'ready' &&
          companyMonthlyTotal && Number.isFinite(companyMonthlyTotal.manual) && (
          <div className="stat-card money">
            <strong>{formatYen(companyMonthlyTotal.manual)}</strong>
            <span>已确认项目补充成本</span>
          </div>
        )}
        {projectRelationsReady && resolvedAccess.operatingExpense &&
          operatingExpenseState.status === 'ready' &&
          companyMonthlyTotal && Number.isFinite(companyMonthlyTotal.operating) && (
          <div className="stat-card money">
            <strong>{formatYen(companyMonthlyTotal.operating)}</strong>
            <span>经营费用合计</span>
          </div>
        )}
        {projectLedgerSummaryState && projectLedgerStatus !== 'ready' &&
          resolvedAccess.operatingExpense && operatingExpenseState.status === 'ready' &&
          companyMonthlyTotal && companyMonthlyTotal.companyOperating > 0 && (
          <div className="stat-card money">
            <strong>{formatYen(companyMonthlyTotal.companyOperating)}</strong>
            <span>公司经营费用（不含项目）</span>
          </div>
        )}
        {completeTotalVisible && allCostSourcesReady && companyMonthlyTotal &&
          Number.isFinite(companyMonthlyTotal.total) && (
          <div className="stat-card money">
            <strong>{formatYen(companyMonthlyTotal.total)}</strong>
            <span>公司总成本</span>
          </div>
        )}
        {projectRelationsReady && purchaseLedgerAccrualState.status === 'ready' && [
          ['中国采购', '中国采购金额'],
          ['Amazon', 'Amazon 采购金额'],
          ['Yahoo拍卖', 'Yahoo拍卖采购金额'],
          ['东鹏株式会社', '东鹏株式会社采购金额'],
        ].map(([source, label]) => (
          <div className="stat-card money" key={source}>
            <strong>{formatYen(purchaseBySource(source))}</strong>
            <span>{label}</span>
          </div>
        ))}
        {purchasePaymentVisible && (
          <div className="stat-card money">
            <strong>{formatYen(unpaidPurchaseCost)}</strong>
            <span>当前采购应付余额</span>
          </div>
        )}
        {purchasePaymentVisible && (
          <div className="stat-card money">
            <strong>{formatYen(monthPaymentCash)}</strong>
            <span>本月采购付款现金流</span>
          </div>
        )}
      </div>

      {costModel && (
        <>
          <SectionTitle title="待核算成本" note="不计入公司总成本" />
          <div className="stats-grid">
            {pendingDefinitions.filter(([key]) => (
              projectRelationsReady && (key === 'vehicleRepairEstimates'
                ? vehicleAccess && fuelState.status === 'ready' &&
                  vehicleExpenseState.status === 'ready' && vehicleIssueState.status === 'ready'
                : resolvedAccess.projectCost && projectCostState.status === 'ready'
              )
            )).map(([key, label, amountField]) => {
              const rows = pending[key]
              const amount = rows.reduce(
                (total, row) => total + toAmount(row?.[amountField]),
                0,
              )
              return (
                <div className="stat-card money" key={key}>
                  <strong>{formatYen(amount)}</strong>
                  <span>{label} · {rows.length} 项</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      <div className="empty-state cost-note">
        {costModel && selectedComposition
          ? '公司总成本仅使用共享成本模型中的已确认口径；工资与项目人工分摊不重复计算，采购付款现金流不计入采购确认成本。'
          : '已按当前账号可见的成本分类分别展示；数据不完整时不提供公司总成本。'}
      </div>
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
  canEdit = true,
  canDelete = true,
}) {
  return (
    <div className="record-list">
      {records.length === 0 ? (
        <EmptyState text={emptyText} />
      ) : (
        records.map((record) => {
          const recordCanEdit = typeof canEdit === 'function' ? canEdit(record) : canEdit
          const recordCanDelete = typeof canDelete === 'function' ? canDelete(record) : canDelete
          return (
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
            <RecordActions
              canEdit={recordCanEdit}
              canDelete={recordCanDelete}
              onEdit={() => onEdit(record)}
              onDelete={() => onDelete(record)}
            />
          </article>
          )
        })
      )}
    </div>
  )
}

function RecordActions({ onEdit, onDelete, canEdit = true, canDelete = true }) {
  if (!canEdit && !canDelete) return null
  return (
    <div className="record-actions">
      {canEdit && (
        <button className="ghost-button" type="button" onClick={onEdit}>
          编辑
        </button>
      )}
      {canDelete && (
        <button className="danger-button" type="button" onClick={onDelete}>
          删除
        </button>
      )}
    </div>
  )
}

export function PurchaseManagementPage({
  access,
  projects,
  employees,
  purchaseRecords,
  setPurchaseRecords,
  onCreatePurchase,
  onUpdatePurchase,
  onDeletePurchase,
  persistPurchasePaymentCache,
  purchasePaymentRecords,
  purchasePaymentState,
  setPurchasePaymentRecords,
  onPersistenceError,
  stockInRecords,
  inventoryItems,
  onBack,
}) {
  const resolvedAccess = access || {
    records: { view: true, create: true, update: true, delete: true },
    payments: { view: true, create: true, update: true, delete: true },
    stockIn: { view: true, create: true, update: true, delete: true },
    summary: { view: true },
  }
  const paymentReady = resolvedAccess.payments.view &&
    purchasePaymentState?.status === 'ready' &&
    purchasePaymentState.stale !== true &&
    Array.isArray(purchasePaymentState.data)
  const readyPaymentRecords = paymentReady ? purchasePaymentState.data : []
  const deleteAdvisoryPaymentRecords = paymentReady
    ? readyPaymentRecords
    : localDemoMode && Array.isArray(purchasePaymentRecords)
      ? purchasePaymentRecords
      : []
  const [arrivalContext, setArrivalContext] = useState({
    status: resolvedAccess.stockIn.view ? 'loading' : 'forbidden',
    variants: [],
    purchases: [],
  })
  const refreshArrivalContext = useCallback(async () => {
    if (!resolvedAccess.stockIn.view) {
      setArrivalContext({ status: 'forbidden', variants: [], purchases: [] })
      return null
    }
    if (localDemoMode) {
      const context = createOfflinePurchaseArrivalContext(purchaseRecords)
      setArrivalContext({
        status: 'ready',
        variants: context.variants,
        purchases: context.purchases,
      })
      return context
    }
    setArrivalContext((current) => ({ ...current, status: 'loading' }))
    try {
      const context = await purchaseWarehouseBridge.loadArrivalContext()
      setArrivalContext({
        status: 'ready',
        variants: context.variants,
        purchases: context.purchases,
      })
      return context
    } catch (error) {
      setArrivalContext({ status: 'error', variants: [], purchases: [] })
      const classification = classifyBusinessSourceError(error)
      if (classification.fatal) onPersistenceError?.(error)
      return null
    }
  }, [onPersistenceError, purchaseRecords, resolvedAccess.stockIn.view])
  useEffect(() => {
    refreshArrivalContext()
  }, [refreshArrivalContext])
  const sections = [
    ...(resolvedAccess.records.create ? [{ id: 'create', title: '新增采购' }] : []),
    ...(resolvedAccess.records.view ? [{ id: 'list', title: '采购列表' }] : []),
    ...(resolvedAccess.stockIn.view ? [{ id: 'stockIn', title: '到货入库' }] : []),
    ...(paymentReady ? [{ id: 'payment', title: '付款记录' }] : []),
    ...(resolvedAccess.summary.view ? [{ id: 'summary', title: '采购汇总' }] : []),
  ]
  const [section, setSection] = useState(() => sections[0]?.id || '')
  const visibleSection = sections.some((item) => item.id === section)
    ? section
    : sections[0]?.id || ''
  useEffect(() => {
    if (!sections.some((item) => item.id === section)) setSection(sections[0]?.id || '')
  }, [section, sections])

  return (
    <PageShell
      title="采购管理"
      subtitle="国内・日本・关系单位"
      rootClassName="purchase-management-page"
      onBack={onBack}
    >
      {sections.length === 0 && <EmptyState text="当前账号无可用功能" />}
      {resolvedAccess.payments.view && !paymentReady && (
        <EmptyState text="当前付款数据不可用" />
      )}
      <div className="accounting-entry-grid">
        {sections.map((item) => (
          <button
            className={`accounting-entry ${visibleSection === item.id ? 'active' : ''}`}
            type="button"
            key={item.id}
            onClick={() => setSection(item.id)}
          >
            {item.title}
          </button>
        ))}
      </div>

      {visibleSection === 'create' && (
        <PurchaseFormSection
          projects={projects}
          employees={employees}
          records={purchaseRecords}
          setRecords={setPurchaseRecords}
          onCreate={onCreatePurchase}
          canUpdatePayments={paymentReady && resolvedAccess.payments.update}
        />
      )}
      {visibleSection === 'list' && (
        <PurchaseListSection
          projects={projects}
          records={purchaseRecords}
          setRecords={setPurchaseRecords}
          paymentRecords={deleteAdvisoryPaymentRecords}
          stockInRecords={stockInRecords}
          arrivalPurchases={arrivalContext.purchases}
          arrivalContextStatus={arrivalContext.status}
          access={resolvedAccess.records}
          paymentVisible={paymentReady}
          onUpdate={onUpdatePurchase}
          onDelete={onDeletePurchase}
        />
      )}
      {visibleSection === 'stockIn' && (
        <PurchaseStockInSection
          employees={employees}
          purchaseRecords={purchaseRecords}
          setPurchaseRecords={setPurchaseRecords}
          stockInRecords={stockInRecords}
          arrivalContext={arrivalContext}
          onRefreshArrivalContext={refreshArrivalContext}
          access={resolvedAccess.stockIn}
          onPersistenceError={onPersistenceError}
        />
      )}
      {visibleSection === 'payment' && (
        <PurchasePaymentSection
          employees={employees}
          purchaseRecords={purchaseRecords}
          setPurchaseRecords={setPurchaseRecords}
          records={readyPaymentRecords}
          setRecords={setPurchasePaymentRecords}
          onPersistenceError={onPersistenceError}
          access={resolvedAccess.payments}
          paymentReady={paymentReady}
          persistPurchase={persistPurchasePaymentCache}
        />
      )}
      {visibleSection === 'summary' && (
        <PurchaseSummarySection
          purchaseRecords={purchaseRecords}
          inventoryItems={inventoryItems}
          arrivalContext={arrivalContext}
          paymentVisible={paymentReady}
          paymentState={purchasePaymentState}
        />
      )}
    </PageShell>
  )
}

function PurchaseFormSection({
  projects,
  employees,
  records,
  setRecords,
  onCreate,
  canUpdatePayments = true,
}) {
  const [form, setForm] = useState(createEmptyPurchaseForm)
  const selectedProject = projects.find((project) => project.projectId === form.projectId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const amountPreview = calculatePurchaseAmounts(form)

  const handleSubmit = async (event) => {
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
    const { paidAmount: _redactedPaidAmount, ...accrualForm } = form
    const purchase = normalizePurchaseRecord({
      ...accrualForm,
      purchaseId: nextId('PO', records, 'purchaseId'),
      ...(canUpdatePayments
        ? {
            paidAmount: form.paidAmount,
            openingPaidAmount: amountPreview.paidAmount,
          }
        : {}),
      projectId: selectedProject?.projectId || '',
      projectName: selectedProject?.projectName || '',
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
      createdAt: todayValue(),
      updatedAt: todayValue(),
    })

    if (onCreate) await onCreate(purchase)
    else setRecords((currentRecords) => [purchase, ...currentRecords])
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

        <FormGroup title={canUpdatePayments ? '付款/发票信息' : '发票信息'}>
          {canUpdatePayments && (
            <>
              <Field label="已付款金额（日元）" type="number" value={form.paidAmount} onChange={(value) => setForm({ ...form, paidAmount: value })} />
              <ReadOnlyField label="未付款金额" value={formatYen(amountPreview.unpaidAmount)} />
              <ReadOnlyField label="付款状态" value={amountPreview.paymentStatus} />
            </>
          )}
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

function PurchaseListSection({
  projects,
  records,
  setRecords,
  paymentRecords,
  stockInRecords,
  arrivalPurchases = [],
  arrivalContextStatus = 'loading',
  access,
  paymentVisible,
  onUpdate,
  onDelete,
}) {
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
  const arrivalStatusReady = arrivalContextStatus === 'ready'

  const normalRecords = records.filter((record) => record.purchaseStatus !== '作废')
  const filteredRecords = normalRecords.filter((record) => {
    const stockInStatus = resolvePurchaseArrivalStatus(
      arrivalContextStatus,
      record.purchaseId,
      arrivalPurchases,
    )
    const startMatched = filters.startDate ? record.purchaseDate >= filters.startDate : true
    const endMatched = filters.endDate ? record.purchaseDate <= filters.endDate : true

    return (
      (!filters.source || record.purchaseSource === filters.source) &&
      (!filters.platform || record.platform === filters.platform) &&
      (!filters.type || record.purchaseType === filters.type) &&
      (!filters.projectId || record.projectId === filters.projectId) &&
      (!paymentVisible || !filters.paymentStatus || record.paymentStatus === filters.paymentStatus) &&
      (!filters.arrivalStatus || record.arrivalStatus === filters.arrivalStatus) &&
      (!filters.stockInStatus || (arrivalStatusReady && stockInStatus === filters.stockInStatus)) &&
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
        {paymentVisible && (
          <OptionField label="付款状态" value={filters.paymentStatus} onChange={(value) => setFilters({ ...filters, paymentStatus: value })} options={purchasePaymentStatusOptions} includeAll />
        )}
        <OptionField label="到货状态" value={filters.arrivalStatus} onChange={(value) => setFilters({ ...filters, arrivalStatus: value })} options={arrivalStatusOptions} includeAll />
        <OptionField label="入库状态" value={filters.stockInStatus} onChange={(value) => setFilters({ ...filters, stockInStatus: value })} options={stockInStatusOptions} includeAll disabled={!arrivalStatusReady} />
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
              stockInStatus={resolvePurchaseArrivalStatus(
                arrivalContextStatus,
                record.purchaseId,
                arrivalPurchases,
              )}
              showPayments={paymentVisible}
              canVoid={access.update}
              canDelete={access.delete}
              onVoid={async () => {
                const nextRecord = normalizePurchaseRecord({
                  ...record,
                  purchaseStatus: '作废',
                  updatedAt: todayValue(),
                })
                if (onUpdate) await onUpdate(nextRecord)
                else setRecords((currentRecords) => currentRecords.map((item) =>
                  item.purchaseId === record.purchaseId ? nextRecord : item
                ))
              }}
              onDelete={async () => {
                const hasPayment = paymentRecords.some(
                  (item) => item.purchaseId === record.purchaseId,
                )
                const hasStockIn = stockInRecords.some((item) => item.sourcePurchaseId === record.purchaseId)
                const hasWarehouseReceipt = getPurchaseArrivalSummary(
                  record.purchaseId,
                  arrivalPurchases,
                )?.hasReceipt === true
                if (hasPayment || hasStockIn || hasWarehouseReceipt) {
                  window.alert('该采购已有付款、旧入库或仓库到货记录，建议作废，不建议删除。')
                  return
                }
                if (window.confirm('确定删除这条采购记录吗？')) {
                  if (onDelete) await onDelete(record.purchaseId)
                  else setRecords((currentRecords) =>
                    currentRecords.filter((item) => item.purchaseId !== record.purchaseId))
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
  access,
  purchaseRecords,
  arrivalContext,
  onRefreshArrivalContext,
  onPersistenceError,
  arrivalBridge = purchaseWarehouseBridge,
  createIdempotencyId = () => globalThis.crypto?.randomUUID?.(),
}) {
  const [form, setForm] = useState({
    purchaseRecordKey: '',
    variantId: '',
    requestedQuantity: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submittedMessage, setSubmittedMessage] = useState('')
  const idempotencyKeyRef = useRef('')
  const arrivalPurchases = arrivalContext?.purchases || []
  const variants = arrivalContext?.variants || []
  const activePurchases = purchaseRecords.filter((record) =>
    record.purchaseStatus !== '作废' &&
    getPurchaseArrivalSummary(record.purchaseId, arrivalPurchases)?.remainingQuantity > 0
  )
  const selectedPurchase = activePurchases.find(
    (record) => record.purchaseId === form.purchaseRecordKey,
  )
  const selectedSummary = getPurchaseArrivalSummary(form.purchaseRecordKey, arrivalPurchases)
  const selectedVariant = variants.find((variant) => variant.id === form.variantId)
  const updateForm = (patch) => {
    idempotencyKeyRef.current = ''
    setSubmittedMessage('')
    setForm((current) => ({ ...current, ...patch }))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!access.create || submitting) return

    if (!selectedPurchase) {
      window.alert('请选择采购记录')
      return
    }
    if (!selectedVariant) {
      window.alert('请选择仓库物品型号')
      return
    }
    const requestedQuantity = Number(form.requestedQuantity)
    if (!(requestedQuantity > 0) || requestedQuantity > selectedSummary.remainingQuantity) {
      window.alert('到货数量必须大于 0，且不能超过采购剩余数量')
      return
    }
    if (!idempotencyKeyRef.current) {
      const randomId = createIdempotencyId()
      if (!randomId) {
        onPersistenceError?.(new Error('浏览器无法生成安全的到货提交编号'))
        return
      }
      idempotencyKeyRef.current = `arrival-${randomId}`
    }
    setSubmitting(true)
    try {
      await arrivalBridge.submitWarehouseArrival({
        purchaseRecordKey: selectedPurchase.purchaseId,
        variantId: selectedVariant.id,
        requestedQuantity,
        idempotencyKey: idempotencyKeyRef.current,
      })
      await onRefreshArrivalContext?.()
      idempotencyKeyRef.current = ''
      setForm({ purchaseRecordKey: '', variantId: '', requestedQuantity: '' })
      setSubmittedMessage('到货已提交，等待仓库负责人确认；当前库存尚未增加。')
    } catch (error) {
      onPersistenceError?.(error)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SectionTitle title="采购到货" note="支持分批提交，仓库负责人确认后才增加库存" />
      {arrivalContext?.status === 'loading' && <EmptyState text="正在读取仓库到货状态…" />}
      {arrivalContext?.status === 'error' && <EmptyState text="仓库到货状态暂不可用，请稍后刷新" />}
      {submittedMessage && <div className="empty-state cost-note">{submittedMessage}</div>}
      {access.create && <form className="form-panel" onSubmit={handleSubmit}>
        <label className="field full-width">
          <span>采购记录</span>
          <select
            value={form.purchaseRecordKey}
            onChange={(event) => updateForm({ purchaseRecordKey: event.target.value })}
            disabled={arrivalContext?.status !== 'ready' || submitting}
          >
            <option value="">请选择采购记录</option>
            {activePurchases.map((record) => (
              <option value={record.purchaseId} key={record.purchaseId}>
                {record.purchaseId}｜{record.itemName}｜剩余 {getPurchaseArrivalSummary(record.purchaseId, arrivalPurchases)?.remainingQuantity ?? 0} {record.unit}
              </option>
            ))}
          </select>
        </label>
        {selectedPurchase && (
          <dl className="detail-list compact employee-snapshot">
            <div><dt>商品</dt><dd>{selectedPurchase.itemName}</dd></div>
            <div><dt>采购数量</dt><dd>{selectedSummary?.orderedQuantity ?? 0} {selectedPurchase.unit}</dd></div>
            <div><dt>待仓库确认</dt><dd>{selectedSummary?.pendingQuantity ?? 0} {selectedPurchase.unit}</dd></div>
            <div><dt>仓库已确认</dt><dd>{selectedSummary?.confirmedQuantity ?? 0} {selectedPurchase.unit}</dd></div>
            <div><dt>还可提交</dt><dd>{selectedSummary?.remainingQuantity ?? 0} {selectedPurchase.unit}</dd></div>
            <div><dt>项目</dt><dd>{selectedPurchase.projectName || '未绑定'}</dd></div>
          </dl>
        )}
        <div className="form-grid">
          <label className="field full-width">
            <span>仓库物品型号</span>
            <select
              value={form.variantId}
              onChange={(event) => updateForm({ variantId: event.target.value })}
              disabled={arrivalContext?.status !== 'ready' || submitting}
              required
            >
              <option value="">请选择启用中的物品型号</option>
              {variants.map((variant) => (
                <option value={variant.id} key={variant.id}>
                  {variant.itemName}｜{variant.sku}｜{variant.model || '无型号'}｜{variant.size || '无尺寸'}｜{variant.unit}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="本次到货数量"
            type="number"
            value={form.requestedQuantity}
            onChange={(value) => updateForm({ requestedQuantity: value })}
            min="0.001"
            step="0.001"
            disabled={arrivalContext?.status !== 'ready' || submitting}
            required
          />
        </div>
        <div className="form-actions">
          <button className="primary-button" type="submit" disabled={arrivalContext?.status !== 'ready' || submitting}>
            {submitting ? '正在提交…' : '提交到货，等待仓库确认'}
          </button>
        </div>
      </form>}
    </>
  )
}

async function commitPurchasePaymentMutation({
  paymentReady,
  purchaseToSave,
  persistPurchase,
  persistLedger,
  nextPurchaseRecords,
  nextPaymentRecords,
  setPurchaseRecords,
  setPaymentRecords,
  onPersistenceError,
  demoMode,
}) {
  if (!paymentReady) return false
  if (!demoMode) {
    try {
      if (purchaseToSave) await persistPurchase(purchaseToSave)
      await persistLedger()
    } catch (error) {
      onPersistenceError?.(error)
      return false
    }
  }

  const stateUpdateOptions = demoMode
    ? {}
    : { stateOnly: true, syncLocal: true }
  setPurchaseRecords(nextPurchaseRecords, stateUpdateOptions)
  setPaymentRecords(nextPaymentRecords, stateUpdateOptions)
  return true
}

function PurchasePaymentSection({
  access,
  paymentReady,
  employees,
  purchaseRecords,
  setPurchaseRecords,
  records,
  setRecords,
  onPersistenceError,
  persistPurchase,
}) {
  const [form, setForm] = useState(createEmptyPurchasePaymentForm)
  const activePurchases = purchaseRecords.filter(
    (record) =>
      record.purchaseStatus !== '作废' &&
      typeof record.purchaseId === 'string' &&
      record.purchaseId.trim() !== '',
  )
  const selectedPurchase = activePurchases.find((record) => record.purchaseId === form.purchaseId)
  const selectedEmployee = employees.find((employee) => employee.employeeId === form.employeeId)
  const paymentPreview = normalizePurchasePaymentRecord({ ...form, paymentId: 'PREVIEW' })

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!paymentReady || !access.create) return

    if (!selectedPurchase) {
      window.alert('请选择采购记录')
      return
    }

    if (!selectedEmployee && !form.externalPersonName.trim()) {
      window.alert('请选择付款人，或填写外部人员')
      return
    }

    const personName = selectedEmployee?.name || form.externalPersonName.trim()
    const payment = normalizeSubmittedPurchasePaymentRecord({
      ...form,
      paymentId: nextId('PP', records, 'paymentId'),
      employeeId: selectedEmployee?.employeeId || '',
      employeeName: personName,
    })

    if (!canApplyPurchasePayment(selectedPurchase, records, payment.jpyAmount)) {
      window.alert('付款金额必须为有效正数，且不能超过当前未付款金额')
      return
    }

    const nextPayments = [payment, ...records]
    const nextPurchases = purchaseRecords.map((record) =>
      record.purchaseId === selectedPurchase.purchaseId
        ? {
            ...recalculatePurchasePaymentCache(
              record,
              nextPayments,
              { previousPayments: records },
            ),
            updatedAt: todayValue(),
          }
        : record,
    )
    const purchaseToSave = nextPurchases.find(
      (record) => record.purchaseId === selectedPurchase.purchaseId,
    )

    const committed = await commitPurchasePaymentMutation({
      paymentReady,
      purchaseToSave,
      persistPurchase: (purchase) =>
        persistPurchase?.(purchase) || purchaseService.update(purchase.purchaseId, purchase),
      persistLedger: () =>
        purchaseService.upsertPayment(payment),
      nextPurchaseRecords: nextPurchases,
      nextPaymentRecords: nextPayments,
      setPurchaseRecords,
      setPaymentRecords: setRecords,
      onPersistenceError,
      demoMode: localDemoMode,
    })
    if (!committed) return
    setForm(createEmptyPurchasePaymentForm())
  }

  return (
    <>
      <SectionTitle title="付款记录" note="支持分批付款" />
      {paymentReady && access.create && <form className="form-panel" onSubmit={handleSubmit}>
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
      </form>}
      <AccountingRecordList
        canEdit={paymentReady && access.update}
        canDelete={paymentReady && access.delete}
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
        onDelete={async (record) => {
          if (!paymentReady) return
          if (window.confirm('确定删除这条付款记录吗？')) {
            const remainingPayments = records.filter(
              (item) => item.paymentId !== record.paymentId,
            )
            const nextPurchases = purchaseRecords.map((purchase) =>
              purchase.purchaseId === record.purchaseId
                ? {
                    ...recalculatePurchasePaymentCache(
                      purchase,
                      remainingPayments,
                      { previousPayments: records },
                    ),
                    updatedAt: todayValue(),
                  }
                : purchase,
            )
            const purchaseToSave = nextPurchases.find(
              (purchase) => purchase.purchaseId === record.purchaseId,
            )

            await commitPurchasePaymentMutation({
              paymentReady,
              purchaseToSave,
              persistPurchase: (purchase) =>
                persistPurchase?.(purchase) || purchaseService.update(purchase.purchaseId, purchase),
              persistLedger: () =>
                purchaseService.softDeletePayment(record.paymentId),
              nextPurchaseRecords: nextPurchases,
              nextPaymentRecords: remainingPayments,
              setPurchaseRecords,
              setPaymentRecords: setRecords,
              onPersistenceError,
              demoMode: localDemoMode,
            })
          }
        }}
      />
    </>
  )
}

function PurchaseSummarySection({
  purchaseRecords,
  inventoryItems,
  arrivalContext,
  paymentVisible = true,
  paymentState,
}) {
  const [monthFilter, setMonthFilter] = useState(currentMonthValue())
  const activePurchases = purchaseRecords.filter(
    (record) => record.purchaseStatus !== '作废' && monthFromDate(record.purchaseDate) === monthFilter,
  )
  const total = activePurchases.reduce((sum, record) => sum + toAmount(record.totalCost), 0)
  const unpaid = activePurchases.reduce((sum, record) => sum + toAmount(record.unpaidAmount), 0)
  const showPayments = paymentVisible &&
    (paymentState === undefined || paymentState?.status === 'ready')
  const arrivalPurchases = arrivalContext?.purchases
  const arrivalStatusReady = arrivalContext?.status === 'ready' &&
    Array.isArray(arrivalPurchases) &&
    activePurchases.every((record) => resolvePurchaseArrivalStatus(
      arrivalContext.status,
      record.purchaseId,
      arrivalPurchases,
    ) !== '状态暂不可用')
  const stockStatusCount = (status) =>
    activePurchases.filter((record) => resolvePurchaseArrivalStatus(
      arrivalContext.status,
      record.purchaseId,
      arrivalPurchases,
    ) === status).length
  const inventoryTotal = inventoryItems.reduce((sum, item) => sum + toAmount(item.totalCost), 0)

  return (
    <section className="inventory-section">
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
        {showPayments && (
          <div className="stat-card money"><strong>{formatYen(unpaid)}</strong><span>未付款采购金额</span></div>
        )}
        {arrivalStatusReady ? <>
          <div className="stat-card"><strong>{stockStatusCount('未入库')}</strong><span>未入库采购数量</span></div>
          <div className="stat-card"><strong>{stockStatusCount('待仓库确认')}</strong><span>待仓库确认采购数量</span></div>
          <div className="stat-card"><strong>{stockStatusCount('部分入库')}</strong><span>部分入库采购数量</span></div>
          <div className="stat-card"><strong>{stockStatusCount('已入库')}</strong><span>已入库采购数量</span></div>
        </> : (
          <div className="stat-card"><strong>--</strong><span>入库状态暂不可用</span></div>
        )}
        <div className="stat-card money"><strong>{formatYen(inventoryTotal)}</strong><span>仓库库存总成本</span></div>
      </div>
    </section>
  )
}

function PurchaseCard({
  record,
  stockInStatus,
  onVoid,
  onDelete,
  showPayments = true,
  canVoid = true,
  canDelete = true,
}) {
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
        {showPayments && <div><dt>付款状态</dt><dd>{record.paymentStatus}</dd></div>}
        {showPayments && <div><dt>未付款</dt><dd>{formatYen(record.unpaidAmount)}</dd></div>}
        <div><dt>到货状态</dt><dd>{record.arrivalStatus}</dd></div>
        <div><dt>入库状态</dt><dd>{stockInStatus}</dd></div>
        <div><dt>工程项目</dt><dd>{record.projectName || '未绑定'}</dd></div>
        <div><dt>经办人</dt><dd>{record.employeeName || '未填写'}</dd></div>
      </dl>
      {(canVoid || canDelete) && (
        <div className="record-actions">
          {canVoid && <button className="ghost-button" type="button" onClick={onVoid}>作废</button>}
          {canDelete && <button className="danger-button" type="button" onClick={onDelete}>删除</button>}
        </div>
      )}
    </article>
  )
}

function sourceTotal(records, source) {
  return records
    .filter((record) => record.purchaseSource === source)
    .reduce((total, record) => total + toAmount(record.totalCost), 0)
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
      <div className="empty-state cost-note">
        历史出工明细仅供核对人数、工时和记录；其中的历史出工冲突（非考勤提醒）来自旧人工记录。
        正式考勤异常请到“人工记录”看板处理，金额请以人工记录中的正式核算看板为准。
      </div>
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
        <div className="stat-card"><strong>{filteredRecords.filter((record) => record.workType === '正常出勤').length}</strong><span>正常出勤数量</span></div>
        <div className="stat-card"><strong>{filteredRecords.filter((record) => record.workType === '加班').length}</strong><span>加班数量</span></div>
        <div className="stat-card"><strong>{restLeaveCount}</strong><span>请假/休息数量</span></div>
        <div className="stat-card"><strong>{exceptions.length}</strong><span>历史出工冲突（非考勤提醒）</span></div>
        <div className="stat-card"><strong>{duplicateAssignmentCount}</strong><span>历史同日重复安排人数（非考勤提醒）</span></div>
        <div className="stat-card"><strong>{timeConflictCount}</strong><span>历史时间重叠记录数（非考勤提醒）</span></div>
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
              <SectionTitle title="历史出工冲突（非考勤提醒）" note={`${exceptions.length} 条`} />
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
                      {record.employeeName}｜{record.projectName || record.workLocationType}｜{record.startTime || '--'}-{record.endTime || '--'}｜{record.workHours}小时
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
                </div>
                <dl className="detail-list compact">
                  <div><dt>出工人数</dt><dd>{project.peopleCount}</dd></div>
                  <div><dt>总工时</dt><dd>{project.totalHours}</dd></div>
                </dl>
                <details className="batch-detail">
                  <summary>查看项目人工明细</summary>
                  <div className="timeline-list">
                    {project.records.map((record) => (
                      <div className="compact-line" key={record.laborRecordId}>
                        {record.workDate}｜{record.employeeName}｜{record.startTime || '--'}-{record.endTime || '--'}｜{record.workHours}小时｜{record.jobContent || '未填写'}
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
          {hasConflict && <span>历史时间冲突（非考勤提醒）</span>}
          {isLongDay && <span>历史工时冲突（非考勤提醒）</span>}
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
      }
      current.dates.add(record.workDate)
      current.totalHours += Number(record.workHours) || 0
      if (record.workType === '正常出勤') current.normalDates.add(record.workDate)
      if (record.workType === '加班') current.overtimeCount += 1
      if (['休息', '请假', '调休'].includes(record.workType)) current.restLeaveCount += 1
      if (record.projectId) current.projectIds.add(record.projectId)
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
    }
    current.dates.add(record.workDate)
    current.totalHours += Number(record.workHours) || 0
    if (record.projectId) current.projectIds.add(record.projectId)
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
      records: group.items,
    }
  })
}

function DashboardPage({
  asOfDate,
  selectedMonth,
  filters,
  access,
  sources,
  viewerName,
  onFiltersChange,
  onNavigate,
}) {
  const model = buildExecutiveDashboardReadModel({
    asOfDate,
    selectedMonth,
    filters,
    access,
    sources,
  })
  return (
    <ExecutiveDashboardPage
      model={model}
      filters={{ selectedMonth, ...filters }}
      viewerName={viewerName}
      onFiltersChange={onFiltersChange}
      onNavigate={onNavigate}
    />
  )
}

function PageShell({ title, subtitle, rootClassName = '', onBack, action, children }) {
  return (
    <main className={`app-shell page-shell ${rootClassName}`.trim()}>
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

function OptionField({ label, value, onChange, options, includeAll = false, disabled = false }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
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

function Field({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  disabled = false,
  min,
  step,
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {type === 'textarea' ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          rows="3"
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          min={min}
          step={step}
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

function App() {
  return (
    <AuthGate>
      {({ currentUser, onLogout }) => (
        <AuthenticatedApp currentUser={currentUser} onLogout={onLogout} />
      )}
    </AuthGate>
  )
}

export default App

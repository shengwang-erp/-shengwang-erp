import { ADMIN_ROUTES, getAdminRoute } from '../navigation/adminRoutes.js'
import {
  canAccessModule,
  canCreate,
  canDelete,
  canEdit,
  canViewSensitive,
  hasEffectivePermissionKey,
  isSuperAdmin,
} from '../utils/permissions.js'
import { canViewProjectFinancials } from '../features/projects/projectPermissions.js'
import { WAREHOUSE_PERMISSION_KEYS } from '../features/warehouse/warehouseConstants.js'

const ACTIVE_ONLY_VIEWS = new Set([
  'home',
  'todayAttendance',
  'workbench',
  'messages',
  'profile',
])

const REQUIRED_USER_STRING_FIELDS = [
  'employeeId',
  'employeeNumber',
  'name',
  'department',
  'position',
]

function ownDataValue(descriptors, propertyName) {
  const descriptor = descriptors[propertyName]
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function safePermissionKeys(value) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return null
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const length = ownDataValue(descriptors, 'length')
    if (!Number.isSafeInteger(length) || length < 0 || length > 1000) return null
    if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string')) return null

    const keys = []
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)]
      if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'string') {
        return null
      }
      keys.push(descriptor.value)
    }

    const expectedProperties = new Set(['length', ...keys.map((_, index) => String(index))])
    if (Object.keys(descriptors).some((key) => !expectedProperties.has(key))) return null
    return keys
  } catch {
    return null
  }
}

function activeUserSnapshot(user) {
  try {
    if (
      user === null ||
      typeof user !== 'object' ||
      Array.isArray(user) ||
      Object.getPrototypeOf(user) !== Object.prototype
    ) {
      return null
    }

    const descriptors = Object.getOwnPropertyDescriptors(user)
    if (
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
      Object.values(descriptors).some((descriptor) => !('value' in descriptor))
    ) {
      return null
    }

    for (const field of REQUIRED_USER_STRING_FIELDS) {
      const value = ownDataValue(descriptors, field)
      if (typeof value !== 'string' || value.trim().length === 0) return null
    }

    if (
      ownDataValue(descriptors, 'employmentStatus') !== '在职' ||
      ownDataValue(descriptors, 'accountStatus') !== 'active' ||
      ownDataValue(descriptors, 'mustChangePassword') !== false
    ) {
      return null
    }

    const effectivePermissionKeys = safePermissionKeys(
      ownDataValue(descriptors, 'effectivePermissionKeys'),
    )
    if (effectivePermissionKeys === null) return null

    return {
      employeeId: ownDataValue(descriptors, 'employeeId'),
      employeeNumber: ownDataValue(descriptors, 'employeeNumber'),
      name: ownDataValue(descriptors, 'name'),
      department: ownDataValue(descriptors, 'department'),
      position: ownDataValue(descriptors, 'position'),
      employmentStatus: '在职',
      accountStatus: 'active',
      mustChangePassword: false,
      effectivePermissionKeys,
    }
  } catch {
    return null
  }
}

function freezeProjection(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeProjection(child)
  return Object.freeze(value)
}

function hasModule(user, moduleName) {
  return Boolean(moduleName) && (isSuperAdmin(user) || canAccessModule(user, moduleName))
}

function canAccessSafeUser(user, view) {
  const route = getAdminRoute(view)
  if (!route) return false
  if (ACTIVE_ONLY_VIEWS.has(route.view)) return true
  if (route.view === 'contractRevenue') return canViewProjectFinancials(user)
  if (route.view === 'stockOut' || route.view === 'stockReturn') {
    return hasModule(user, route.moduleName) &&
      (hasEffectivePermissionKey(user, WAREHOUSE_PERMISSION_KEYS.stockFlowRequest) ||
        hasEffectivePermissionKey(user, WAREHOUSE_PERMISSION_KEYS.stockFlowConfirm))
  }
  return hasModule(user, route.moduleName)
}

export function canAccessView(user, view) {
  const snapshot = activeUserSnapshot(user)
  return snapshot ? canAccessSafeUser(snapshot, view) : false
}

export function getVisibleAdminRoutes(user) {
  const snapshot = activeUserSnapshot(user)
  if (!snapshot) return Object.freeze([])

  return Object.freeze(
    ADMIN_ROUTES
      .filter((route) => route.desktop && canAccessSafeUser(snapshot, route.view))
      .map((route) => Object.freeze({ ...route })),
  )
}

export function getDashboardAccess(user) {
  const snapshot = activeUserSnapshot(user)
  const page = snapshot ? canAccessSafeUser(snapshot, 'dashboard') : false
  const ownerFull = page && canViewSensitive(snapshot, '查看老板驾驶舱全部数据')

  const projectSnapshot = page && hasModule(snapshot, '工程项目')
  const contractView = page && canViewProjectFinancials(snapshot)
  const contractAmounts = contractView && ownerFull &&
    canViewSensitive(snapshot, '查看合同金额')

  const attendanceView = page && hasModule(snapshot, '人工记录')
  const attendanceIdentities = attendanceView && ownerFull &&
    hasModule(snapshot, '人员管理') &&
    canViewSensitive(snapshot, '查看人员身份资料')

  const laborView = page && hasModule(snapshot, '人工记录')
  const laborAmounts = laborView && ownerFull &&
    hasModule(snapshot, '工资记录') &&
    hasModule(snapshot, '项目成本') &&
    canViewSensitive(snapshot, '查看工资')

  const purchaseAccrual = page && ownerFull && hasModule(snapshot, '采购管理')
  const purchasePayments = purchaseAccrual &&
    canViewSensitive(snapshot, '查看采购付款')

  const vehicleView = page && hasModule(snapshot, '车辆管理')
  const vehicleAmounts = vehicleView && ownerFull
  const inventoryView = page && hasModule(snapshot, '仓库库存')
  const inventoryAmounts = inventoryView && ownerFull
  const toolsView = page && hasModule(snapshot, '工具管理')
  const toolsAmounts = toolsView && ownerFull

  const costCategories = {
    labor: laborAmounts,
    purchase: purchaseAccrual,
    vehicle: vehicleAmounts,
    manualSupplement: page && ownerFull && hasModule(snapshot, '项目成本'),
    operatingExpense: page && ownerFull && hasModule(snapshot, '经营费用'),
  }
  const completeCost = Object.values(costCategories).every(Boolean)
  const profitView = contractAmounts && completeCost &&
    canViewSensitive(snapshot, '查看利润')

  return freezeProjection({
    page,
    projectSnapshot,
    contracts: { view: contractView, amounts: contractAmounts },
    profit: { view: profitView, completeCostRequired: true },
    attendance: { view: attendanceView, identities: attendanceIdentities },
    labor: { view: laborView, amounts: laborAmounts },
    purchase: {
      accrual: purchaseAccrual,
      payments: purchasePayments,
      payable: purchasePayments,
      anomalies: purchasePayments,
    },
    vehicle: { view: vehicleView, amounts: vehicleAmounts },
    inventory: { view: inventoryView, amounts: inventoryAmounts },
    tools: { view: toolsView, amounts: toolsAmounts },
    costCategories,
  })
}

function sectionActions(user, page, moduleName, sensitiveView, sensitiveUpdate) {
  const view = page && hasModule(user, moduleName) &&
    (!sensitiveView || canViewSensitive(user, sensitiveView))
  const updateSensitive = view &&
    (!sensitiveUpdate || canViewSensitive(user, sensitiveUpdate))
  return {
    view,
    create: view && updateSensitive && canCreate(user, moduleName),
    update: view && updateSensitive && canEdit(user, moduleName),
    delete: view && updateSensitive && canDelete(user, moduleName),
  }
}

export function getAccountingAccess(user) {
  const snapshot = activeUserSnapshot(user)
  const page = snapshot ? canAccessSafeUser(snapshot, 'accounting') : false
  const salary = sectionActions(
    snapshot,
    page,
    '工资记录',
    '查看工资',
    '修改工资',
  )
  const projectCostActions = sectionActions(snapshot, page, '项目成本')
  const projectCost = {
    ...projectCostActions,
    readLedger: projectCostActions.view,
    createManual: projectCostActions.create,
    adjust: projectCostActions.update,
    allocate: projectCostActions.update,
  }
  const operatingExpense = sectionActions(snapshot, page, '经营费用')
  const purchaseAccountingView = page && hasModule(snapshot, '采购管理')
  const purchasePayments = purchaseAccountingView &&
    canViewSensitive(snapshot, '查看采购付款')

  return freezeProjection({
    salary,
    projectCost,
    operatingExpense,
    purchaseAccounting: { view: purchaseAccountingView },
    monthlySummary: {
      salary: salary.view,
      projectCost: projectCost.view,
      operatingExpense: operatingExpense.view,
      purchaseAccrual: purchaseAccountingView,
      purchasePayments,
    },
  })
}

export function getPurchaseAccess(user) {
  const snapshot = activeUserSnapshot(user)
  const view = snapshot ? canAccessSafeUser(snapshot, 'purchase') : false
  const records = {
    view,
    create: view && canCreate(snapshot, '采购管理'),
    update: view && canEdit(snapshot, '采购管理'),
    delete: view && canDelete(snapshot, '采购管理'),
  }
  const paymentView = view && canViewSensitive(snapshot, '查看采购付款')
  const paymentUpdate = paymentView && canViewSensitive(snapshot, '修改采购付款')
  const payments = {
    view: paymentView,
    create: paymentUpdate && canCreate(snapshot, '采购管理'),
    update: paymentUpdate && canEdit(snapshot, '采购管理'),
    delete: paymentUpdate && canDelete(snapshot, '采购管理'),
  }
  const receiptSubmit = view && hasEffectivePermissionKey(
    snapshot,
    WAREHOUSE_PERMISSION_KEYS.receiptSubmit,
  )

  return freezeProjection({
    records,
    payments,
    stockIn: {
      view: receiptSubmit,
      create: receiptSubmit && records.create,
      update: false,
      delete: false,
    },
    summary: { view },
  })
}

export function getWarehouseAccess(user) {
  const snapshot = activeUserSnapshot(user)
  const page = snapshot ? hasModule(snapshot, '仓库库存') : false
  const hasWarehouseAction = (permissionKey) =>
    page && hasEffectivePermissionKey(snapshot, permissionKey)
  const manageCatalog = hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.catalogManage)

  return freezeProjection({
    page,
    manageCatalog,
    submitReceipt: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.receiptSubmit),
    confirmReceipt: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.receiptConfirm),
    requestStockFlow: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.stockFlowRequest),
    confirmStockFlow: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.stockFlowConfirm),
    transfer: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.transferManage),
    stocktake: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.stocktakeConfirm),
    viewCost: manageCatalog || hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.costView),
    exportReports: hasWarehouseAction(WAREHOUSE_PERMISSION_KEYS.reportExport),
  })
}

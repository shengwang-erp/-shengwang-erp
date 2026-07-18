import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canAccessView,
  getAccountingAccess,
  getDashboardAccess,
  getPurchaseAccess,
  getVisibleAdminRoutes,
} from './businessAccess.js'
import { isPersonnelAdministrator } from './employeeAuthDomain.js'
import {
  buildAuthorizedHomeModel,
} from '../features/workbench/authorizedHomeModel.js'
import {
  buildWorkbenchItems,
  projectAuthorizedWorkbenchItems,
} from '../features/workbench/workbenchModel.js'
import {
  isHiddenSystemEmployee,
  isSuperAdmin,
} from '../utils/permissions.js'

const PRESIDENT_VIEW_KEYS = Object.freeze([
  'module.owner_dashboard.view',
  'module.projects.view',
  'module.employees.view',
  'module.accounting.view',
  'module.labor.view',
  'module.purchases.view',
  'module.inventory.view',
  'module.tools.view',
  'module.vehicles.view',
  'module.salaries.view',
  'module.project_costs.view',
  'module.operating_expenses.view',
])

const EXPECTED_PRESIDENT_DESKTOP_VIEWS = [
  'home',
  'dashboard',
  'projects',
  'employees',
  'accounting',
  'labor',
  'stockOut',
  'stockReturn',
  'purchase',
  'vehicle',
  'toolBorrow',
  'todayAttendance',
]

function ordinaryPresident(effectivePermissionKeys = PRESIDENT_VIEW_KEYS, overrides = {}) {
  return {
    employeeId: 'E-PRESIDENT-101',
    employeeNumber: 'SW-901',
    name: '权限验收社长',
    department: '总务部',
    position: '社长',
    employmentStatus: '在职',
    accountStatus: 'active',
    mustChangePassword: false,
    effectivePermissionKeys: [...effectivePermissionKeys],
    isHiddenSystemAccount: false,
    role: 'employee',
    ...overrides,
  }
}

test('社长职位只保留既定人员管理职责，不会隐式升级成 SW-000 或开放业务模块', () => {
  const titleOnly = ordinaryPresident([])

  assert.equal(isPersonnelAdministrator(titleOnly), true)
  assert.equal(isSuperAdmin(titleOnly), false)
  assert.equal(isHiddenSystemEmployee(titleOnly), false)
  assert.deepEqual(
    getVisibleAdminRoutes(titleOnly).map(({ view }) => view),
    ['home', 'todayAttendance'],
  )
  assert.equal(canAccessView(titleOnly, 'dashboard'), false)
  assert.equal(canAccessView(titleOnly, 'employees'), false)
  assert.equal(canAccessView(titleOnly, 'settings'), false)
  assert.equal(canAccessView(titleOnly, 'contractRevenue'), false)

  const forgedLegacyRole = ordinaryPresident([], { role: 'super_admin' })
  assert.equal(isSuperAdmin(forgedLegacyRole), false)
  assert.deepEqual(
    getVisibleAdminRoutes(forgedLegacyRole).map(({ view }) => view),
    ['home', 'todayAttendance'],
  )
})

test('普通社长的显式业务查看矩阵在侧栏、路由守卫和移动工作台保持一致', () => {
  const president = ordinaryPresident()
  const visibleViews = getVisibleAdminRoutes(president).map(({ view }) => view)

  assert.deepEqual(visibleViews, EXPECTED_PRESIDENT_DESKTOP_VIEWS)
  for (const view of EXPECTED_PRESIDENT_DESKTOP_VIEWS) {
    assert.equal(canAccessView(president, view), true, view)
  }
  assert.equal(canAccessView(president, 'settings'), false)
  assert.equal(canAccessView(president, 'contractRevenue'), true)

  const expectedWorkbenchViews = EXPECTED_PRESIDENT_DESKTOP_VIEWS.filter(
    (view) => view !== 'home',
  )
  const counts = Object.fromEntries(
    expectedWorkbenchViews.map((view, index) => [view, index + 1]),
  )
  const items = buildWorkbenchItems({ user: president, counts })
  assert.deepEqual(items.map(({ view }) => view), expectedWorkbenchViews)
  assert.deepEqual(
    projectAuthorizedWorkbenchItems(president, items).map(({ route }) => route.view),
    expectedWorkbenchViews,
  )
})

test('普通社长的工资、合同额、采购付款和身份信息只由对应敏感键开放', () => {
  const ownerFull = [
    ...PRESIDENT_VIEW_KEYS,
    'sensitive.owner_dashboard_full_view',
  ]
  const redactedDashboard = getDashboardAccess(ordinaryPresident(ownerFull))
  const redactedAccounting = getAccountingAccess(ordinaryPresident(ownerFull))
  const redactedPurchase = getPurchaseAccess(ordinaryPresident(ownerFull))

  assert.equal(redactedDashboard.page, true)
  assert.equal(redactedDashboard.contracts.view, true)
  assert.equal(redactedDashboard.contracts.amounts, false)
  assert.equal(redactedDashboard.labor.amounts, false)
  assert.equal(redactedDashboard.attendance.identities, false)
  assert.equal(redactedDashboard.purchase.accrual, true)
  assert.equal(redactedDashboard.purchase.payments, false)
  assert.equal(redactedDashboard.profit.view, false)
  assert.equal(redactedAccounting.salary.view, false)
  assert.equal(redactedAccounting.monthlySummary.purchasePayments, false)
  assert.equal(redactedPurchase.records.view, true)
  assert.equal(redactedPurchase.payments.view, false)

  const salaryKeys = [...ownerFull, 'sensitive.salary_view']
  assert.equal(getDashboardAccess(ordinaryPresident(salaryKeys)).labor.amounts, true)
  const salaryAccess = getAccountingAccess(ordinaryPresident(salaryKeys)).salary
  assert.deepEqual(salaryAccess, {
    view: true,
    create: false,
    update: false,
    delete: false,
  })

  const contractKeys = [...ownerFull, 'sensitive.contract_amount_view']
  assert.equal(getDashboardAccess(ordinaryPresident(contractKeys)).contracts.amounts, true)

  const purchasePaymentKeys = [...ownerFull, 'sensitive.purchase_payments_view']
  assert.deepEqual(getDashboardAccess(ordinaryPresident(purchasePaymentKeys)).purchase, {
    accrual: true,
    payments: true,
    payable: true,
    anomalies: true,
  })
  assert.deepEqual(getPurchaseAccess(ordinaryPresident(purchasePaymentKeys)).payments, {
    view: true,
    create: false,
    update: false,
    delete: false,
  })

  const identityKeys = [...ownerFull, 'sensitive.employee_identity_view']
  assert.equal(
    getDashboardAccess(ordinaryPresident(identityKeys)).attendance.identities,
    true,
  )

  const profitKeys = [
    ...ownerFull,
    'sensitive.salary_view',
    'sensitive.contract_amount_view',
    'sensitive.profit_view',
  ]
  assert.equal(getDashboardAccess(ordinaryPresident(profitKeys)).profit.view, true)
  assert.equal(
    getDashboardAccess(ordinaryPresident(
      profitKeys.filter((key) => key !== 'sensitive.profit_view'),
    )).profit.view,
    false,
  )
})

test('普通社长首页不会把未就绪的会计或采购金额伪装成零', () => {
  const president = ordinaryPresident()
  const routes = getVisibleAdminRoutes(president).filter(
    ({ view }) => view === 'accounting' || view === 'purchase',
  )
  const model = buildAuthorizedHomeModel({
    user: president,
    routes,
    sourceStates: {
      costSummary: { status: 'forbidden', data: null, stale: false },
      purchaseSummary: { status: 'error', data: null, stale: false },
    },
  })
  const modules = new Map(model.modules.map((module) => [module.view, module]))

  assert.equal(modules.get('accounting').displayValue, '权限受限')
  assert.equal(modules.get('purchase').displayValue, '读取失败')
  assert.equal(model.summary.monthlyCostTotal, null)
  assert.equal(model.summary.monthlyPurchaseTotal, null)
  assert.equal(JSON.stringify(model).includes('¥0'), false)
})

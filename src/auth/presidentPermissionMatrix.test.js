import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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
  'warehouse',
  'purchase',
  'vehicle',
  'toolBorrow',
  'todayAttendance',
]

let appPagesPromise

function loadAppPages() {
  if (appPagesPromise) return appPagesPromise
  appPagesPromise = (async () => {
    const server = await createServer({
      root: process.cwd(),
      logLevel: 'silent',
      appType: 'custom',
      plugins: [{
        name: 'president-permission-app-pages',
        enforce: 'pre',
        resolveId(source) {
          return source === 'leaflet' ? '\0president-permission-leaflet-stub' : null
        },
        load(id) {
          return id === '\0president-permission-leaflet-stub'
            ? 'export default { icon: () => ({}) }'
            : null
        },
        transform(code, id) {
          if (!id.endsWith('/src/App.jsx')) return null
          return code
            .replace('function HomePage(', 'export function HomePage(')
            .replace('function SystemSettingsPage(', 'export function SystemSettingsPage(')
        },
      }],
      ssr: { noExternal: ['leaflet'] },
      server: { middlewareMode: true },
    })
    try {
      return {
        app: await server.ssrLoadModule('/src/App.jsx'),
        home: await server.ssrLoadModule(
          '/src/features/workbench/authorizedHomeModel.js',
        ),
      }
    } finally {
      await server.close()
    }
  })()
  return appPagesPromise
}

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

test('普通社长的工资修改需要模块 update 与工资敏感 update 两个精确授权', () => {
  const salaryViewKeys = [...PRESIDENT_VIEW_KEYS, 'sensitive.salary_view']
  const moduleUpdateOnly = ordinaryPresident([
    ...salaryViewKeys,
    'module.salaries.update',
  ])
  assert.deepEqual(getAccountingAccess(moduleUpdateOnly).salary, {
    view: true,
    create: false,
    update: false,
    delete: false,
  })

  const sensitiveUpdateOnly = ordinaryPresident([
    ...salaryViewKeys,
    'sensitive.salary_update',
  ])
  assert.equal(getAccountingAccess(sensitiveUpdateOnly).salary.update, false)

  const exactUpdate = ordinaryPresident([
    ...salaryViewKeys,
    'module.salaries.update',
    'sensitive.salary_update',
  ])
  assert.deepEqual(getAccountingAccess(exactUpdate).salary, {
    view: true,
    create: false,
    update: true,
    delete: false,
  })
})

test('普通社长的采购付款修改需要采购 update 与付款敏感 update 两个精确授权', () => {
  const paymentViewKeys = [
    ...PRESIDENT_VIEW_KEYS,
    'sensitive.purchase_payments_view',
  ]
  const moduleUpdateOnly = ordinaryPresident([
    ...paymentViewKeys,
    'module.purchases.update',
  ])
  assert.equal(getPurchaseAccess(moduleUpdateOnly).records.update, true)
  assert.deepEqual(getPurchaseAccess(moduleUpdateOnly).payments, {
    view: true,
    create: false,
    update: false,
    delete: false,
  })

  const sensitiveUpdateOnly = ordinaryPresident([
    ...paymentViewKeys,
    'sensitive.purchase_payments_update',
  ])
  assert.equal(getPurchaseAccess(sensitiveUpdateOnly).payments.update, false)

  const exactUpdate = ordinaryPresident([
    ...paymentViewKeys,
    'module.purchases.update',
    'sensitive.purchase_payments_update',
  ])
  assert.deepEqual(getPurchaseAccess(exactUpdate).payments, {
    view: true,
    create: false,
    update: true,
    delete: false,
  })
})

test('普通社长即使显式获准系统设置页也看不到 SW-000 恢复与迁移工具', async () => {
  const { app } = await loadAppPages()
  const president = ordinaryPresident([
    ...PRESIDENT_VIEW_KEYS,
    'module.settings.view',
  ])
  assert.equal(canAccessView(president, 'settings'), true)

  const html = renderToStaticMarkup(createElement(app.SystemSettingsPage, {
    currentUser: president,
    storageKeys: ['erp.projects'],
    loadContractMigrationPreview() {
      throw new Error('普通社长不得触发迁移预览')
    },
    executeContractMigration() {
      throw new Error('普通社长不得触发迁移执行')
    },
    onLocalContractRevenueMigrationComplete() {},
    onBack() {},
  }))

  assert.match(html, /系统设置/u)
  assert.match(html, /Supabase 云端数据库/u)
  assert.doesNotMatch(html, /系统恢复账号|最高权限/u)
  assert.doesNotMatch(
    html,
    /旧合同收入数据迁移|只读预览|执行云端迁移|localStorage → Supabase 数据迁移|上传当前浏览器数据到 Supabase/u,
  )

  const recoveryAccount = ordinaryPresident(['all'], {
    employeeId: 'SUPER_ADMIN',
    employeeNumber: 'SW-000',
    name: '系统恢复账号',
    isHiddenSystemAccount: true,
  })
  const recoveryHtml = renderToStaticMarkup(createElement(app.SystemSettingsPage, {
    currentUser: recoveryAccount,
    storageKeys: ['erp.projects'],
    loadContractMigrationPreview() {
      return null
    },
    executeContractMigration() {},
    onLocalContractRevenueMigrationComplete() {},
    onBack() {},
  }))
  assert.match(recoveryHtml, /系统恢复账号状态/u)
  assert.match(recoveryHtml, /旧合同收入数据迁移/u)
  assert.match(recoveryHtml, /只读预览/u)
  assert.match(recoveryHtml, /localStorage → Supabase 数据迁移/u)
  assert.match(recoveryHtml, /上传当前浏览器数据到 Supabase/u)
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

test('普通社长的实际 Home SSR 从 App 原始源投影保留未就绪状态且不渲染零金额', async () => {
  const { app, home } = await loadAppPages()
  const president = ordinaryPresident([
    ...PRESIDENT_VIEW_KEYS,
    'sensitive.salary_view',
  ])
  const routes = getVisibleAdminRoutes(president).filter(
    ({ view }) => view === 'accounting' || view === 'purchase',
  )
  const ready = (data) => ({ status: 'ready', data, stale: false })
  const financialModels = app.buildHomeFinancialModels({
    currentUser: president,
    selectedMonth: '2026-07',
    sourceStates: {
      projects: {
        status: 'forbidden',
        data: [{ projectId: 'SECRET', contractAmount: 999999 }],
        stale: false,
      },
      laborWindow: ready({ monthly: [], projectLaborLifetimeById: {} }),
      purchaseAccrual: {
        status: 'error',
        data: [{ purchaseId: 'PRIVATE', totalCost: 987654 }],
        stale: false,
      },
      purchaseLedgerAccrual: {
        status: 'error',
        data: [{ purchaseId: 'PRIVATE', totalCost: 987654 }],
        stale: false,
      },
      purchasePayments: ready([]),
      projectCosts: ready([]),
      operatingExpenses: ready([]),
      fuel: ready([]),
      vehicleExpenses: ready([]),
      vehicleIssues: ready([]),
    },
  })
  assert.deepEqual(financialModels, {
    cost: { status: 'forbidden', data: null, stale: false },
    purchase: { status: 'error', data: null, stale: false },
  })

  const model = home.buildAuthorizedHomeModel({
    user: president,
    routes,
    sourceStates: {
      costSummary: financialModels.cost,
      purchaseSummary: financialModels.purchase,
    },
  })
  assert.equal(model.summary.monthlyCostTotal, null)
  assert.equal(model.summary.monthlyPurchaseTotal, null)
  const html = renderToStaticMarkup(createElement(app.HomePage, {
    model,
    summary: model.summary,
    currentUser: president,
    onLogout() {},
    onOpenView() {},
  }))

  assert.match(html, /会计成本/u)
  assert.match(html, /采购管理/u)
  assert.match(html, /权限受限/u)
  assert.match(html, /读取失败/u)
  assert.doesNotMatch(html, /<span class="module-count">¥0<\/span>/u)
  assert.doesNotMatch(html, /当前为系统恢复账号/u)
  assert.doesNotMatch(html, /999,?999|987,?654|SECRET|PRIVATE/u)
})

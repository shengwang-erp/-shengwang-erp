import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import { buildMonthWindow } from '../features/executive-dashboard/dashboardTime.js'

async function loadRuntime() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    plugins: [{
      name: 'business-access-leaflet-ssr-stub',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0business-access-leaflet-ssr-stub' : null
      },
      load(id) {
        if (id !== '\0business-access-leaflet-ssr-stub') return null
        return 'export default { icon: () => ({}) }'
      },
      transform(code, id) {
        if (!id.endsWith('/src/App.jsx')) return null
        return code.replace(
          'function DashboardPage({',
          'export function DashboardPage({',
        )
      },
    }],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true },
  })
  try {
    const [app, businessAccess] = await Promise.all([
      server.ssrLoadModule('/src/App.jsx'),
      server.ssrLoadModule('/src/auth/businessAccess.js'),
    ])
    return { app, businessAccess }
  } finally {
    await server.close()
  }
}

const [runtime, appSource] = await Promise.all([
  loadRuntime(),
  readFile(new URL('../App.jsx', import.meta.url), 'utf8'),
])

const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  id: 'auth-user-route',
  employeeId: 'E-ROUTE',
  employeeNumber: 'SW-123',
  name: '路由测试员工',
  department: '现场',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys,
  ...overrides,
})

function requireExport(name) {
  const value = runtime.app[name]
  assert.equal(typeof value, 'function', `${name} must be executable production code`)
  return typeof value === 'function' ? value : null
}

const currentMonth = (() => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
})()

const populatedHomeInput = Object.freeze({
  projects: Object.freeze([
    Object.freeze({ projectId: 'P-1', status: '进行中' }),
    Object.freeze({ projectId: 'P-2', status: '暂停' }),
  ]),
  employees: Object.freeze([
    Object.freeze({
      employeeId: 'E-1',
      employmentStatus: '在职',
      salaryType: '月薪',
      baseSalary: 999999,
    }),
  ]),
  records: Object.freeze({
    stockOut: Object.freeze([{ id: 'SO-SECRET' }]),
    stockReturn: Object.freeze([{ id: 'SR-SECRET' }]),
    labor: Object.freeze([{ id: 'L-SECRET' }]),
    vehicle: Object.freeze([{ id: 'V-SECRET' }]),
    toolBorrow: Object.freeze([{ id: 'TB-SECRET' }]),
    toolReturn: Object.freeze([{ id: 'TR-SECRET' }]),
  }),
  financialModels: Object.freeze({
    cost: Object.freeze({
      status: 'ready',
      data: Object.freeze({
        companyMonthlyTotal: Object.freeze({ total: 500 }),
      }),
    }),
    purchase: Object.freeze({
      status: 'ready',
      data: Object.freeze({
        summary: Object.freeze({ monthPurchaseCost: 400 }),
      }),
    }),
  }),
})

const emptyHomeSummary = {
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

test('production view resolution fails closed for invalid actors and normalizes only active users', () => {
  const resolveAuthorizedView = requireExport('resolveAuthorizedView')
  if (!resolveAuthorizedView) return

  const inactiveActors = [
    null,
    {},
    activeUser(['all'], { employmentStatus: '离职' }),
    activeUser(['all'], { accountStatus: 'disabled' }),
    activeUser(['all'], { mustChangePassword: true }),
  ]
  for (const actor of inactiveActors) {
    assert.equal(resolveAuthorizedView(actor, 'dashboard'), null)
    assert.equal(resolveAuthorizedView(actor, 'home'), null)
  }

  const zeroModuleUser = activeUser()
  assert.equal(resolveAuthorizedView(zeroModuleUser, 'dashboard'), 'home')
  assert.equal(resolveAuthorizedView(zeroModuleUser, 'home'), 'home')
  assert.equal(resolveAuthorizedView(zeroModuleUser, 'todayAttendance'), 'todayAttendance')

  const dashboardUser = activeUser(['module.owner_dashboard.view'])
  assert.equal(resolveAuthorizedView(dashboardUser, 'dashboard'), 'dashboard')
  const revokedUser = { ...dashboardUser, effectivePermissionKeys: [] }
  assert.equal(resolveAuthorizedView(revokedUser, 'dashboard'), 'home')
  assert.equal(resolveAuthorizedView(revokedUser, 'home'), 'home')
})

test('production navigation rejects denied targets and retains the personnel dirty lock', () => {
  const resolveGuardedNavigation = requireExport('resolveGuardedNavigation')
  if (!resolveGuardedNavigation) return

  const zeroModuleUser = activeUser()
  assert.deepEqual(resolveGuardedNavigation({
    currentUser: zeroModuleUser,
    currentView: 'home',
    nextView: 'dashboard',
  }), { accepted: false, view: 'home' })
  assert.deepEqual(resolveGuardedNavigation({
    currentUser: zeroModuleUser,
    currentView: 'home',
    nextView: 'workbench',
  }), { accepted: true, view: 'workbench' })

  const personnelUser = activeUser(['module.employees.view'])
  assert.deepEqual(resolveGuardedNavigation({
    currentUser: personnelUser,
    currentView: 'employees',
    nextView: 'home',
    protectedStateActive: true,
  }), { accepted: false, view: 'employees' })
  assert.deepEqual(resolveGuardedNavigation({
    currentUser: personnelUser,
    currentView: 'employees',
    nextView: 'employees',
    protectedStateActive: true,
  }), { accepted: true, view: 'employees' })
  assert.deepEqual(resolveGuardedNavigation({
    currentUser: personnelUser,
    currentView: 'employees',
    nextView: 'home',
    protectedStateActive: false,
  }), { accepted: true, view: 'home' })

  assert.deepEqual(resolveGuardedNavigation({
    currentUser: activeUser(['all'], { accountStatus: 'disabled' }),
    currentView: 'dashboard',
    nextView: 'home',
  }), { accepted: false, view: null })
})

test('contract revenue navigation and view/update permissions remain separate', () => {
  const resolveAuthorizedView = requireExport('resolveAuthorizedView')
  const resolveGuardedNavigation = requireExport('resolveGuardedNavigation')
  const getContractRevenueAccess = requireExport('getContractRevenueAccess')
  if (!resolveAuthorizedView || !resolveGuardedNavigation || !getContractRevenueAccess) return

  const ordinaryProjectUser = activeUser(['module.projects.view'])
  assert.equal(resolveAuthorizedView(ordinaryProjectUser, 'contractRevenue'), 'home')
  assert.deepEqual(getContractRevenueAccess(ordinaryProjectUser), {
    view: false,
    update: false,
  })

  const financeViewOnly = activeUser(['module.projects.view'], { department: '财务部' })
  assert.equal(resolveAuthorizedView(financeViewOnly, 'contractRevenue'), 'contractRevenue')
  assert.deepEqual(resolveGuardedNavigation({
    currentUser: financeViewOnly,
    currentView: 'projects',
    nextView: 'contractRevenue',
  }), { accepted: true, view: 'contractRevenue' })
  assert.deepEqual(getContractRevenueAccess(financeViewOnly), {
    view: true,
    update: false,
  })

  const financeEditor = activeUser(
    ['module.projects.view', 'module.projects.update'],
    { department: '财务部' },
  )
  assert.deepEqual(getContractRevenueAccess(financeEditor), {
    view: true,
    update: true,
  })

  const updateOnly = activeUser(['module.projects.update'], { department: '财务部' })
  assert.deepEqual(getContractRevenueAccess(updateOnly), {
    view: false,
    update: false,
  })
})

test('Home summary data is synchronously sanitized on entry and permission revocation', () => {
  const buildAuthorizedHomeSummary = requireExport('buildAuthorizedHomeSummary')
  if (!buildAuthorizedHomeSummary) return

  const deniedInput = new Proxy({}, {
    get() {
      throw new Error('unauthorized Home data was read')
    },
  })
  assert.deepEqual(buildAuthorizedHomeSummary(activeUser(), deniedInput), emptyHomeSummary)
  assert.deepEqual(
    buildAuthorizedHomeSummary(activeUser(['all'], { accountStatus: 'disabled' }), deniedInput),
    emptyHomeSummary,
  )

  const projectOnly = buildAuthorizedHomeSummary(
    activeUser(['module.projects.view']),
    populatedHomeInput,
  )
  assert.deepEqual(projectOnly, {
    ...emptyHomeSummary,
    activeProjects: 1,
    pausedProjects: 1,
    moduleCounts: { ...emptyHomeSummary.moduleCounts, projects: 2 },
  })

  const fullUser = activeUser(['all'], { employeeNumber: 'SW-000' })
  const fullSummary = buildAuthorizedHomeSummary(fullUser, populatedHomeInput)
  assert.deepEqual(fullSummary, {
    activeProjects: 1,
    activeEmployees: 1,
    totalRecords: 6,
    pausedProjects: 1,
    monthlyPurchaseTotal: 400,
    monthlyCostTotal: 500,
    moduleCounts: {
      projects: 2,
      employees: 1,
      stockOut: 1,
      stockReturn: 1,
      labor: 1,
      vehicle: 1,
      toolBorrow: 1,
    },
  })

  const partialAccounting = buildAuthorizedHomeSummary(activeUser([
    'module.accounting.view',
    'module.salaries.view',
    'sensitive.salary_view',
    'module.project_costs.view',
    'module.operating_expenses.view',
    'module.purchases.view',
  ]), populatedHomeInput)
  assert.equal(partialAccounting.monthlyCostTotal, null)
  assert.equal(partialAccounting.monthlyPurchaseTotal, 400)

  const revokedUser = { ...fullUser, employeeNumber: 'SW-123', effectivePermissionKeys: [] }
  const revokedSummary = buildAuthorizedHomeSummary(revokedUser, populatedHomeInput)
  assert.deepEqual(revokedSummary, emptyHomeSummary)
  assert.equal(JSON.stringify(revokedSummary).includes('SECRET'), false)
})

test('AuthenticatedApp SSR renders no Home or business content for an invalid actor', () => {
  const AuthenticatedApp = requireExport('AuthenticatedApp')
  if (!AuthenticatedApp) return

  for (const currentUser of [
    {},
    activeUser(['all'], { employmentStatus: '离职' }),
    activeUser(['all'], { accountStatus: 'disabled' }),
    activeUser(['all'], { mustChangePassword: true }),
  ]) {
    const markup = renderToStaticMarkup(createElement(AuthenticatedApp, {
      currentUser,
      onLogout() {},
    }))
    assert.equal(markup, '')
  }

  const activeMarkup = renderToStaticMarkup(createElement(AuthenticatedApp, {
    currentUser: activeUser(),
    onLogout() {},
  }))
  assert.match(activeMarkup, /生旺 ERP 数据中心/u)
  assert.match(activeMarkup, /今日打卡/u)
  assert.doesNotMatch(activeMarkup, /老板驾驶舱|工程项目/u)
})

test('AuthenticatedApp consumes the executed resolver, controller, summary, and finance access', () => {
  assert.match(appSource, /resolveAuthorizedView\(currentUser, currentView\)/u)
  assert.match(appSource, /resolveGuardedNavigation\(\{/u)
  assert.match(appSource, /buildAuthorizedHomeSummary\(currentUser, \{/u)
  assert.match(appSource, /summary=\{homeSummary\}/u)
  assert.match(appSource, /if \(authorizedView === null\) return null/u)
  assert.match(appSource, /const contractRevenueAccess = getContractRevenueAccess\(currentUser\)/u)
  assert.match(appSource, /canViewFinancials=\{contractRevenueAccess\.view\}/u)
  assert.match(appSource, /canUpdateFinancials=\{contractRevenueAccess\.update\}/u)

  assert.equal(runtime.businessAccess.canAccessView(activeUser(), 'home'), true)
  assert.equal(runtime.businessAccess.canAccessView({}, 'home'), false)
})

test('persistent, Promise, and labor adapters project one strict raw state without status upgrades', () => {
  const projectPersistentSource = requireExport('projectPersistentSource')
  const projectPromiseSource = requireExport('projectPromiseSource')
  const projectLaborSource = requireExport('projectLaborSource')
  if (!projectPersistentSource || !projectPromiseSource || !projectLaborSource) return

  const forbiddenRaw = Object.freeze({
    loading: false,
    error: '无权读取该数据',
    code: 'ACCESS_DENIED',
    source: 'blocked',
    updatedAt: null,
  })
  const errorRaw = Object.freeze({
    loading: false,
    error: '读取失败',
    code: 'DATA_OPERATION_FAILED',
    source: 'blocked',
    updatedAt: null,
  })
  const data = Object.freeze([{ secret: 'must not become ready' }])

  const persistent = projectPersistentSource(forbiddenRaw, {
    readAllowed: true,
    data,
  })
  const promised = projectPromiseSource(errorRaw, { readAllowed: true, data })
  const labor = projectLaborSource({
    loading: false,
    error: '无权读取该数据',
    code: 'ACCESS_DENIED',
    source: 'labor-bridge',
    updatedAt: null,
  }, { readAllowed: true, data })

  assert.equal(persistent.status, 'forbidden')
  assert.equal(persistent.data, null)
  assert.equal(promised.status, 'error')
  assert.equal(promised.data, null)
  assert.equal(labor.status, 'forbidden')
  assert.equal(labor.data, null)
  for (const state of [persistent, promised, labor]) {
    assert.equal(Object.isFrozen(state), true)
    assert.notEqual(state, forbiddenRaw)
    assert.notEqual(state, errorRaw)
  }

  for (const adapter of [projectPersistentSource, projectPromiseSource]) {
    const malformedNormalizedInput = adapter(
      { status: 'forbidden', data: null },
      { readAllowed: true, data },
    )
    assert.equal(malformedNormalizedInput.status, 'error')
    assert.equal(malformedNormalizedInput.data, null)
  }
})

test('purchase-only access stays ready through projection and preserves payment UI authorization', () => {
  const projectPersistentSource = requireExport('projectPersistentSource')
  const PurchaseManagementPage = requireExport('PurchaseManagementPage')
  if (!projectPersistentSource || !PurchaseManagementPage) return

  const currentUser = activeUser([
    'module.purchases.view',
    'module.purchases.create',
    'module.purchases.update',
    'module.purchases.delete',
    'sensitive.purchase_payments_view',
    'sensitive.purchase_payments_update',
  ])
  const access = runtime.businessAccess.getPurchaseAccess(currentUser)
  assert.equal(access.records.view, true)
  assert.equal(access.payments.view, true)
  assert.equal(access.payments.create, true)
  const rawReady = Object.freeze({
    loading: false,
    error: '',
    code: '',
    source: 'supabase',
    updatedAt: '2026-07-18T00:00:00.000Z',
  })
  const purchaseRecords = Object.freeze([Object.freeze({
    purchaseId: 'PO-PURCHASE-ONLY',
    purchaseDate: '2026-07-18',
    itemName: '采购专员材料',
    purchaseSource: '中国采购',
    purchaseType: '材料',
    platform: '线下店铺',
    totalCost: 10000,
    purchaseStatus: '正常',
    arrivalStatus: '未到货',
    currency: 'JPY',
  })])
  const paymentRecords = Object.freeze([Object.freeze({
    paymentId: 'PP-PURCHASE-ONLY',
    purchaseId: 'PO-PURCHASE-ONLY',
    paymentDate: '2026-07-18',
    paymentAmount: 2000,
    jpyAmount: 2000,
    paymentMethod: '银行转账',
    employeeName: '采购专员',
  })])
  const accrualState = projectPersistentSource(rawReady, {
    readAllowed: access.records.view,
    data: purchaseRecords,
  })
  const paymentState = projectPersistentSource(rawReady, {
    readAllowed: access.payments.view,
    data: paymentRecords,
  })
  assert.equal(accrualState.status, 'ready')
  assert.equal(paymentState.status, 'ready')

  const html = renderToStaticMarkup(createElement(PurchaseManagementPage, {
    access,
    projects: [],
    employees: [],
    purchaseRecords: accrualState.data,
    setPurchaseRecords() {},
    purchasePaymentRecords: paymentState.data,
    purchasePaymentState: paymentState,
    setPurchasePaymentRecords() {},
    onPersistenceError() {},
    stockInRecords: [],
    setStockInRecords() {},
    inventoryItems: [],
    setInventoryItems() {},
    onBack() {},
  }))
  assert.match(html, />付款记录<\/button>/u)
  assert.doesNotMatch(html, /当前付款数据不可用/u)
})

test('Accounting defaults to the first authorized section and hides forbidden salary/actions', () => {
  const AccountingCostPage = requireExport('AccountingCostPage')
  if (!AccountingCostPage) return

  const access = {
    salary: { view: false, create: false, update: false, delete: false },
    projectCost: {
      view: true, create: false, update: false, delete: false,
      readLedger: true, createManual: false, adjust: false, allocate: false,
    },
    operatingExpense: { view: false, create: false, update: false, delete: false },
    purchaseAccounting: { view: false },
    monthlySummary: {
      salary: false,
      projectCost: true,
      operatingExpense: false,
      purchaseAccrual: false,
      purchasePayments: false,
    },
  }
  const html = renderToStaticMarkup(createElement(AccountingCostPage, {
    access,
    projects: [],
    employees: [{ employeeId: 'E-SALARY', name: '工资机密', baseSalary: 999999 }],
    salaryRecords: [{ salaryRecordId: 'SALARY-SECRET', netSalary: 999999 }],
    setSalaryRecords() {},
    projectCostRecords: [{
      costRecordId: 'PC-1',
      projectId: 'P-1',
      projectName: '允许项目',
      costType: '材料费',
      amount: 1200,
      date: '2026-07-01',
      operator: '经办人',
      remark: '',
    }],
    setProjectCostRecords() {},
    operatingExpenseRecords: [],
    setOperatingExpenseRecords() {},
    purchaseRecords: [],
    purchasePaymentRecords: [],
    purchasePaymentState: { status: 'forbidden', data: null },
    laborRecords: [],
    fuelRecords: [],
    vehicleExpenseRecords: [],
    vehicleIssueRecords: [],
    monthFilter: '2026-07',
    onMonthFilterChange() {},
    laborBridge: null,
    bridgeStatusNotice: null,
    onBack() {},
  }))

  assert.match(html, /项目成本/u)
  assert.match(html, /项目成本尚未读取/u)
  assert.match(html, /¥1,200/u)
  assert.doesNotMatch(html, /工资记录|工资机密|SALARY-SECRET|¥999,999/u)
  assert.doesNotMatch(html, /<form|>编辑<|>删除</u)
})

test('Accounting monthly summary blocks an inferable total when any category is hidden', () => {
  const MonthlySummarySection = requireExport('MonthlySummarySection')
  if (!MonthlySummarySection) return

  const html = renderToStaticMarkup(createElement(MonthlySummarySection, {
    access: {
      salary: false,
      projectCost: true,
      operatingExpense: false,
      purchaseAccrual: true,
      purchasePayments: false,
    },
    vehicleAccess: false,
    monthFilter: '2026-07',
    onMonthFilterChange() {},
    sourceStates: {
      projects: {
        status: 'ready',
        data: [{ projectId: 'P-1', projectName: '允许项目', status: '进行中' }],
      },
      projectCosts: {
        status: 'ready',
        data: [{
          costRecordId: 'PC-1', projectId: 'P-1', date: '2026-07-01',
          costType: '材料费', amount: 1000,
        }],
      },
      purchaseAccrual: {
        status: 'ready',
        data: [{
          purchaseId: 'PO-1', projectId: 'P-1', purchaseDate: '2026-07-01',
          totalCost: 3000, purchaseStatus: '正常', openingPaidAmount: 0,
        }],
      },
      purchaseLedgerAccrual: {
        status: 'ready',
        data: [{
          purchaseId: 'PO-1', projectId: 'P-1', purchaseDate: '2026-07-01',
          totalCost: 3000, purchaseStatus: '正常', openingPaidAmount: 0,
        }],
      },
    },
  }))

  assert.match(html, /待核算手工材料费/u)
  assert.match(html, /¥1,000/u)
  assert.match(html, /本月采购确认成本/u)
  assert.doesNotMatch(html, /本月工资发放|经营费用合计|<span>公司总成本<\/span>|当前采购应付余额/u)
  assert.doesNotMatch(html, /¥904,000/u)
})

test('Purchase sections and controls follow exact record, payment, stock, and summary access', () => {
  const PurchaseManagementPage = requireExport('PurchaseManagementPage')
  if (!PurchaseManagementPage) return
  const baseProps = {
    projects: [],
    employees: [],
    purchaseRecords: [{
      purchaseId: 'PO-READ', purchaseDate: '2026-07-01', itemName: '可见材料',
      purchaseSource: '中国采购', purchaseType: '材料', platform: '线下店铺',
      totalCost: 80000, purchaseStatus: '正常', arrivalStatus: '未到货',
      projectName: '', supplierName: '', quantity: 1, unit: '件', currency: 'JPY',
    }],
    setPurchaseRecords() {},
    purchasePaymentRecords: [],
    purchasePaymentState: { status: 'forbidden', data: null },
    setPurchasePaymentRecords() {},
    onPersistenceError() {},
    stockInRecords: [],
    setStockInRecords() {},
    inventoryItems: [],
    setInventoryItems() {},
    onBack() {},
  }
  const viewOnly = {
    records: { view: true, create: false, update: false, delete: false },
    payments: { view: false, create: false, update: false, delete: false },
    stockIn: { view: false, create: false, update: false, delete: false },
    summary: { view: true },
  }
  const readHtml = renderToStaticMarkup(createElement(PurchaseManagementPage, {
    ...baseProps,
    access: viewOnly,
  }))
  assert.match(readHtml, /采购列表|采购汇总|可见材料|¥80,000/u)
  assert.doesNotMatch(readHtml, /新增采购|付款记录|到货入库|<form|>作废<|>删除</u)
  assert.doesNotMatch(readHtml, /付款状态|未付款/u)

  const createHtml = renderToStaticMarkup(createElement(PurchaseManagementPage, {
    ...baseProps,
    access: {
      ...viewOnly,
      records: { view: true, create: true, update: false, delete: false },
    },
  }))
  assert.match(createHtml, /新增采购|保存采购记录/u)
  assert.doesNotMatch(createHtml, /已付款金额|未付款金额|付款状态/u)

  const noAccessHtml = renderToStaticMarkup(createElement(PurchaseManagementPage, {
    ...baseProps,
    access: {
      records: { view: false, create: false, update: false, delete: false },
      payments: { view: false, create: false, update: false, delete: false },
      stockIn: { view: false, create: false, update: false, delete: false },
      summary: { view: false },
    },
  }))
  assert.match(noAccessHtml, /当前账号无可用功能/u)
  assert.doesNotMatch(noAccessHtml, /新增采购|采购列表|付款记录|采购汇总/u)
})

test('Purchase payment UI requires a ready source while purchase delete follows record access', () => {
  const PurchaseManagementPage = requireExport('PurchaseManagementPage')
  if (!PurchaseManagementPage) return

  const paymentAccess = {
    records: { view: false, create: false, update: false, delete: false },
    payments: { view: true, create: true, update: true, delete: true },
    stockIn: { view: false, create: false, update: false, delete: false },
    summary: { view: false },
  }
  const paymentRecord = {
    paymentId: 'PP-SECRET',
    purchaseId: 'PO-SECRET',
    paymentDate: '2026-07-17',
    paymentAmount: 5000,
    jpyAmount: 5000,
    paymentMethod: '银行转账',
    employeeName: '付款机密人员',
  }
  const props = {
    access: paymentAccess,
    projects: [],
    employees: [],
    purchaseRecords: [{
      purchaseId: 'PO-SECRET', itemName: '付款机密采购', totalCost: 10000,
      unpaidAmount: 5000, purchaseStatus: '正常', currency: 'JPY',
    }],
    setPurchaseRecords() {},
    purchasePaymentRecords: [paymentRecord],
    setPurchasePaymentRecords() {},
    onPersistenceError() {},
    stockInRecords: [],
    setStockInRecords() {},
    inventoryItems: [],
    setInventoryItems() {},
    onBack() {},
  }

  for (const status of ['forbidden', 'loading', 'error']) {
    const html = renderToStaticMarkup(createElement(PurchaseManagementPage, {
      ...props,
      purchasePaymentState: {
        status,
        data: null,
        message: status === 'error' ? '付款源失败' : '',
      },
    }))
    assert.match(html, /当前付款数据不可用/u)
    assert.doesNotMatch(
      html,
      /付款记录|保存付款记录|PP-SECRET|付款机密人员|付款机密采购|编辑|删除|¥5,000/u,
    )
  }

  const deleteOnlyHtml = renderToStaticMarkup(createElement(PurchaseManagementPage, {
    ...props,
    access: {
      ...paymentAccess,
      records: { view: true, create: false, update: false, delete: true },
    },
    purchasePaymentState: { status: 'loading', data: null },
  }))
  assert.match(deleteOnlyHtml, /付款机密采购/u)
  assert.match(deleteOnlyHtml, />删除</u)
  assert.doesNotMatch(
    deleteOnlyHtml,
    /付款记录|保存付款记录|PP-SECRET|付款机密人员|¥5,000/u,
  )
  assert.match(appSource, /canDelete=\{access\.delete\}/u)
  assert.doesNotMatch(appSource, /canDelete=\{access\.delete && paymentVisible\}/u)
  assert.doesNotMatch(appSource, /if \(!paymentVisible\) return/u)
  assert.match(
    appSource,
    /const deleteAdvisoryPaymentRecords = paymentReady[\s\S]*localDemoMode[\s\S]*purchasePaymentRecords/u,
  )
  assert.match(appSource, /paymentRecords=\{deleteAdvisoryPaymentRecords\}/u)
  assert.match(appSource, /const hasPayment = paymentRecords\.some/u)

  const readyHtml = renderToStaticMarkup(createElement(PurchaseManagementPage, {
    ...props,
    purchasePaymentState: { status: 'ready', data: [paymentRecord] },
  }))
  assert.match(readyHtml, /付款记录|保存付款记录|PP-SECRET|付款机密人员|编辑|删除/u)
})

test('Monthly summary blocks vehicle amounts and company total until vehicle access and sources are ready', () => {
  const MonthlySummarySection = requireExport('MonthlySummarySection')
  if (!MonthlySummarySection) return

  const ready = (data) => ({ status: 'ready', data })
  const laborWindow = {
    monthly: [{
      month: '2026-07', status: 'ready', stale: false, salaryTotal: 0,
      projectLaborTotal: 0, projectLaborById: {}, source: 'formal', pendingCount: 0,
    }],
    projectLaborLifetimeById: {},
    lifetimeStatus: 'ready', lifetimeStale: false, incompleteMonths: [], staleMonths: [],
  }
  const fuelRecords = [{
    fuelRecordId: 'F-SECRET', fuelDate: '2026-07-01', fuelAmount: 987654,
    allocateToProject: false,
    fuelDateSource: 'recorded', fuelDateLegacyInferred: false,
    paymentMethod: '现金', paymentMethodSource: 'recorded',
    paymentMethodLegacyInferred: false,
  }]
  const vehicleIssueRecords = [{
    issueId: 'VI-PENDING', issueDate: '2026-07-02', repairCost: 222222,
    allocateToProject: false, issueStatus: '未处理', severity: '一般',
  }]
  const baseProps = {
    access: {
      salary: true,
      projectCost: true,
      operatingExpense: true,
      purchaseAccrual: true,
      purchasePayments: false,
    },
    vehicleAccess: true,
    projects: [],
    monthFilter: '2026-07',
    onMonthFilterChange() {},
    sourceStates: {
      projects: ready([]),
      laborWindow: ready(laborWindow),
      projectCosts: ready([]),
      operatingExpenses: ready([]),
      purchaseAccrual: ready([]),
      fuel: { status: 'loading', data: null },
      vehicleExpenses: ready([]),
      vehicleIssues: ready(vehicleIssueRecords),
    },
  }

  const loadingHtml = renderToStaticMarkup(createElement(MonthlySummarySection, baseProps))
  assert.match(loadingHtml, /成本数据正在加载/u)
  assert.doesNotMatch(
    loadingHtml,
    /车辆费用合计|<span>公司总成本<\/span>|¥987,654|¥222,222/u,
  )

  const staleHtml = renderToStaticMarkup(createElement(MonthlySummarySection, {
    ...baseProps,
    sourceStates: {
      ...baseProps.sourceStates,
      fuel: { status: 'ready', data: fuelRecords, stale: true },
    },
  }))
  assert.match(staleHtml, /成本数据正在加载/u)
  assert.doesNotMatch(
    staleHtml,
    /车辆费用合计|<span>公司总成本<\/span>|¥987,654|¥222,222/u,
  )

  const forbiddenHtml = renderToStaticMarkup(createElement(MonthlySummarySection, {
    ...baseProps,
    vehicleAccess: false,
  }))
  assert.doesNotMatch(
    forbiddenHtml,
    /车辆费用合计|<span>公司总成本<\/span>|¥987,654|¥222,222/u,
  )

  const readyHtml = renderToStaticMarkup(createElement(MonthlySummarySection, {
    ...baseProps,
    sourceStates: {
      ...baseProps.sourceStates,
      fuel: ready(fuelRecords),
    },
  }))
  assert.match(readyHtml, /车辆费用合计|<span>公司总成本<\/span>|¥987,654/u)
  assert.match(readyHtml, /待核算维修估算|¥222,222/u)
  assert.doesNotMatch(readyHtml, /<strong>¥1,209,876<\/strong><span>公司总成本<\/span>/u)
})

test('Dashboard executed SSR access/source matrix removes stale values synchronously on revocation', () => {
  const DashboardPage = requireExport('DashboardPage')
  if (!DashboardPage) return

  const months = buildMonthWindow(currentMonth, 12)
  const ready = (data) => ({
    status: 'ready', data, code: '', message: '', stale: false, updatedAt: null,
  })
  const blocked = (status = 'forbidden') => ({
    status, data: null,
    code: status === 'forbidden' ? 'ACCESS_DENIED' : 'DATA_OPERATION_FAILED',
    message: status === 'forbidden' ? '当前权限下无法查看该数据' : '数据暂不可用',
    stale: false, updatedAt: null,
  })
  const exactSources = (overrides = {}) => ({
    projects: overrides.projects || blocked(),
    contractRevenue: overrides.contractRevenue || blocked(),
    receipts: overrides.receipts || blocked(),
    laborWindow: overrides.laborWindow || blocked(),
    purchaseAccrual: overrides.purchaseAccrual || blocked(),
    profitabilityPurchaseAccrual: overrides.profitabilityPurchaseAccrual ||
      overrides.purchaseAccrual || blocked(),
    purchasePayments: overrides.purchasePayments || blocked(),
    projectCosts: overrides.projectCosts || blocked(),
    operatingExpenses: overrides.operatingExpenses || blocked(),
    vehicles: overrides.vehicles || blocked(),
    vehicleUsage: overrides.vehicleUsage || blocked(),
    fuel: overrides.fuel || blocked(),
    vehicleExpenses: overrides.vehicleExpenses || blocked(),
    vehicleIssues: overrides.vehicleIssues || blocked(),
    attendance: overrides.attendance || blocked(),
    inventoryItems: overrides.inventoryItems || blocked(),
    stockInRecords: overrides.stockInRecords || blocked(),
    stockOutRecords: overrides.stockOutRecords || blocked(),
    stockReturnRecords: overrides.stockReturnRecords || blocked(),
    toolRecords: overrides.toolRecords || blocked(),
    toolBorrowRecords: overrides.toolBorrowRecords || blocked(),
    toolReturnRecords: overrides.toolReturnRecords || blocked(),
    lifelongToolAssignments: overrides.lifelongToolAssignments || blocked(),
    toolResponsibilityRecords: overrides.toolResponsibilityRecords || blocked(),
  })
  const project = {
    projectId: 'P-SECRET', projectName: '机密项目', address: '机密地址', status: '进行中',
  }
  const purchase = {
    purchaseId: 'PO-SECRET', purchaseDate: currentMonth + '-01', projectId: 'P-SECRET',
    purchaseSource: '中国采购', purchaseType: '材料', totalCost: 77000,
    openingPaidAmount: 1000, purchaseStatus: '正常', invoiceStatus: '已取得',
  }
  const payment = {
    paymentId: 'PP-SECRET', purchaseId: 'PO-SECRET', paymentDate: currentMonth + '-02',
    jpyAmount: 1000, paymentDateSource: 'recorded', paymentDateLegacyInferred: false,
  }
  const laborWindow = {
    monthly: months.map((month) => ({
      month, status: 'ready', stale: false, salaryTotal: 0,
      projectLaborTotal: 0, projectLaborById: { 'P-SECRET': 0 },
      source: 'formal', pendingCount: 0,
    })),
    projectLaborLifetimeById: { 'P-SECRET': 0 },
    lifetimeStatus: 'ready', lifetimeStale: false, incompleteMonths: [], staleMonths: [],
  }
  const readySources = exactSources({
    projects: ready([project]),
    contractRevenue: ready([{
      projectId: 'P-SECRET', adjustedTaxInclusiveAmount: 880000,
      totalReceivedTaxInclusiveAmount: 330000, profitAnchorTaxExclusiveAmount: 800000,
    }]),
    receipts: ready([]),
    laborWindow: ready(laborWindow),
    purchaseAccrual: ready([purchase]),
    purchasePayments: ready([payment]),
    projectCosts: ready([{
      costRecordId: 'PC-SECRET', projectId: 'P-SECRET',
      costType: '外包费', date: currentMonth + '-03', amount: 1000,
    }]),
    operatingExpenses: ready([]),
    vehicles: ready([{ vehicleId: 'V-SECRET', vehicleName: '机密车辆', status: '使用中' }]),
    vehicleUsage: ready([]),
    fuel: ready([{
      fuelRecordId: 'F-SECRET', projectId: 'P-SECRET', allocateToProject: true,
      fuelDate: currentMonth + '-04', fuelAmount: 44000,
      fuelDateSource: 'recorded', fuelDateLegacyInferred: false,
      paymentMethod: '现金', paymentMethodSource: 'recorded',
      paymentMethodLegacyInferred: false,
    }]),
    vehicleExpenses: ready([]),
    vehicleIssues: ready([]),
    attendance: ready([{
      attendanceId: 'A-SECRET', projectId: 'P-SECRET',
      workDate: currentMonth + '-05', status: '异常',
    }]),
    inventoryItems: ready([{ inventoryId: 'INV-SECRET', totalCost: 66000 }]),
    stockInRecords: ready([]),
    stockOutRecords: ready([{ stockOutId: 'SO-SECRET', projectId: 'P-SECRET' }]),
    stockReturnRecords: ready([]),
    toolRecords: ready([{ toolId: 'T-SECRET', toolName: '机密工具', currentStatus: '在库' }]),
    toolBorrowRecords: ready([]),
    toolReturnRecords: ready([]),
    lifelongToolAssignments: ready([]),
    toolResponsibilityRecords: ready([{
      responsibilityId: 'TR-SECRET', projectId: 'P-SECRET',
      compensationStatus: '未赔偿', compensationAmount: 22000,
    }]),
  })
  const fullAccess = {
    page: true,
    projectSnapshot: true,
    contracts: { view: true, amounts: true },
    profit: { view: true, completeCostRequired: true },
    attendance: { view: true, identities: true },
    labor: { view: true, amounts: true },
    purchase: { accrual: true, payments: true, payable: true, anomalies: true },
    vehicle: { view: true, amounts: true },
    inventory: { view: true, amounts: true },
    tools: { view: true, amounts: true },
    costCategories: {
      labor: true, purchase: true, vehicle: true,
      manualSupplement: true, operatingExpense: true,
    },
  }
  const revokedAccess = {
    ...fullAccess,
    projectSnapshot: false,
    contracts: { view: false, amounts: false },
    profit: { view: false, completeCostRequired: true },
    attendance: { view: false, identities: false },
    labor: { view: false, amounts: false },
    purchase: { accrual: false, payments: false, payable: false, anomalies: false },
    vehicle: { view: false, amounts: false },
    inventory: { view: false, amounts: false },
    tools: { view: false, amounts: false },
    costCategories: {
      labor: false, purchase: false, vehicle: false,
      manualSupplement: false, operatingExpense: false,
    },
  }
  const renderDashboard = (access, sources) => renderToStaticMarkup(createElement(
    DashboardPage,
    {
      asOfDate: `${currentMonth}-15`,
      selectedMonth: currentMonth,
      filters: {
        projectId: 'all', projectStatus: 'all', rankingMetric: 'profit',
        page: 1, pageSize: 10,
      },
      access,
      sources,
      viewerName: '社长验收员',
      onFiltersChange() {},
      onNavigate() {},
    },
  ))

  const fullHtml = renderDashboard(fullAccess, readySources)
  assert.match(fullHtml, /欢迎回来，社长验收员|机密项目|当前含税合同额|¥880,000/u)
  assert.match(fullHtml, /考勤异常|工具赔偿待处理|¥22,000/u)
  assert.doesNotMatch(fullHtml, /正式考勤待处理 97/u)

  const revokedHtml = renderDashboard(revokedAccess, readySources)
  assert.match(revokedHtml, /当前权限下无法查看/u)
  assert.doesNotMatch(
    revokedHtml,
    /机密项目|机密地址|¥880,000|¥77,000|¥66,000|机密车辆|¥44,000|机密工具|¥22,000/u,
  )

  const loadingProjectHtml = renderDashboard(fullAccess, {
    ...readySources,
    projects: { status: 'loading', data: null, stale: false, updatedAt: null },
  })
  assert.match(loadingProjectHtml, /数据正在加载/u)
  assert.doesNotMatch(loadingProjectHtml, /机密项目|当前含税合同额[^<]*¥880,000|预计利润[^<]*¥/u)

  const staleProjectHtml = renderDashboard(fullAccess, {
    ...readySources,
    projects: { status: 'loading', data: null, stale: true, updatedAt: null },
  })
  assert.match(staleProjectHtml, /数据正在加载/u)
  assert.doesNotMatch(staleProjectHtml, /机密项目|当前含税合同额[^<]*¥880,000|预计利润[^<]*¥/u)
})

test('Dashboard attendance alerts derive only from the standard attendance source state', () => {
  const DashboardPage = requireExport('DashboardPage')
  if (!DashboardPage) return

  const ready = (data) => ({ status: 'ready', data, stale: false, updatedAt: null })
  const forbidden = () => ({
    status: 'forbidden', data: null, stale: false,
    code: 'ACCESS_DENIED', message: '当前权限下无法查看该数据', updatedAt: null,
  })
  const sourcesFor = (attendance) => ({
    projects: ready([{ projectId: 'P-ALERT', projectName: '考勤测试项目', status: '进行中' }]),
    contractRevenue: forbidden(),
    receipts: forbidden(),
    laborWindow: forbidden(),
    purchaseAccrual: forbidden(),
    profitabilityPurchaseAccrual: forbidden(),
    purchasePayments: forbidden(),
    projectCosts: forbidden(),
    operatingExpenses: forbidden(),
    vehicles: forbidden(),
    vehicleUsage: forbidden(),
    fuel: forbidden(),
    vehicleExpenses: forbidden(),
    vehicleIssues: forbidden(),
    attendance,
    inventoryItems: forbidden(),
    stockInRecords: forbidden(),
    stockOutRecords: forbidden(),
    stockReturnRecords: forbidden(),
    toolRecords: forbidden(),
    toolBorrowRecords: forbidden(),
    toolReturnRecords: forbidden(),
    lifelongToolAssignments: forbidden(),
    toolResponsibilityRecords: forbidden(),
  })
  const access = {
    page: true,
    projectSnapshot: true,
    contracts: { view: false, amounts: false },
    profit: { view: false, completeCostRequired: true },
    attendance: { view: true, identities: true },
    labor: { view: false, amounts: false },
    purchase: { accrual: false, payments: false, payable: false, anomalies: false },
    vehicle: { view: false, amounts: false },
    inventory: { view: false, amounts: false },
    tools: { view: false, amounts: false },
    costCategories: {
      labor: false, purchase: false, vehicle: false,
      manualSupplement: false, operatingExpense: false,
    },
  }
  const renderAttendance = (attendance) => renderToStaticMarkup(createElement(DashboardPage, {
    asOfDate: `${currentMonth}-15`,
    selectedMonth: currentMonth,
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access,
    sources: sourcesFor(attendance),
    viewerName: '考勤验收员',
    onFiltersChange() {},
    onNavigate() {},
  }))

  const readyHtml = renderAttendance(ready([{
    attendanceId: 'A-ALERT', projectId: 'P-ALERT',
    workDate: `${currentMonth}-01`, status: '异常',
  }]))
  assert.match(readyHtml, /<strong>考勤异常<\/strong><span>1 项<\/span>/u)
  assert.doesNotMatch(readyHtml, /正式考勤待处理|97 项/u)

  const staleRefreshHtml = renderAttendance({
    status: 'loading', data: null, stale: true, updatedAt: null,
  })
  assert.match(staleRefreshHtml, /数据源状态提示|数据正在加载/u)
  assert.doesNotMatch(staleRefreshHtml, /考勤异常|A-ALERT|97 项/u)

  const errorHtml = renderAttendance({
    status: 'error', data: null, stale: false, code: 'DATA_OPERATION_FAILED',
  })
  assert.match(errorHtml, /数据源状态提示|数据暂不可用/u)
  assert.doesNotMatch(errorHtml, /考勤异常|A-ALERT|97 项/u)

  const malformedReadyHtml = renderAttendance(ready('7'))
  assert.match(malformedReadyHtml, /数据源状态提示|数据格式无效/u)
  assert.doesNotMatch(malformedReadyHtml, /考勤异常|A-ALERT|97 项/u)

  const forbiddenHtml = renderAttendance(forbidden())
  assert.match(forbiddenHtml, /数据源状态提示|当前权限下无法查看该数据/u)
  assert.doesNotMatch(forbiddenHtml, /考勤异常|A-ALERT|97 项/u)
})

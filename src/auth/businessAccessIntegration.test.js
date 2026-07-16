import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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
  accountingRecords: Object.freeze({
    salary: Object.freeze([{ salaryMonth: currentMonth, netSalary: 1200 }]),
    projectCost: Object.freeze([{
      date: `${currentMonth}-01`,
      costType: '材料费',
      amount: 200,
    }]),
    operatingExpense: Object.freeze([{ date: `${currentMonth}-01`, amount: 300 }]),
    purchase: Object.freeze([{
      purchaseDate: `${currentMonth}-01`,
      purchaseStatus: '正常',
      totalCost: 400,
    }]),
    fuel: Object.freeze([{ fuelDate: `${currentMonth}-01`, fuelAmount: 500 }]),
    vehicleExpense: Object.freeze([{ expenseDate: `${currentMonth}-01`, amount: 600 }]),
    vehicleIssue: Object.freeze([{ issueDate: `${currentMonth}-01`, repairCost: 700 }]),
  }),
})

const emptyHomeSummary = {
  activeProjects: 0,
  activeEmployees: 0,
  totalRecords: 0,
  pausedProjects: 0,
  monthlyPurchaseTotal: 0,
  monthlyCostTotal: 0,
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
    monthlyCostTotal: 3900,
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

test('Accounting defaults to the first authorized section and hides forbidden salary/actions', () => {
  const AccountingCostPage = requireExport('AccountingCostPage')
  if (!AccountingCostPage) return

  const access = {
    salary: { view: false, create: false, update: false, delete: false },
    projectCost: { view: true, create: false, update: false, delete: false },
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
    salaryRecords: [{ netSalary: 900000, salaryMonth: '2026-07' }],
    employees: [],
    laborRecords: [],
    projectCostRecords: [{ date: '2026-07-01', costType: '材料费', amount: 1000 }],
    operatingExpenseRecords: [{ date: '2026-07-01', amount: 2000 }],
    purchaseRecords: [{
      purchaseId: 'PO-1', purchaseDate: '2026-07-01', totalCost: 3000,
      purchaseStatus: '正常', openingPaidAmount: 0,
    }],
    purchasePaymentRecords: [],
    purchasePaymentState: { status: 'forbidden', data: null },
    fuelRecords: [],
    vehicleExpenseRecords: [],
    vehicleIssueRecords: [],
    monthFilter: '2026-07',
    onMonthFilterChange() {},
    laborBridge: null,
  }))

  assert.match(html, /项目成本记录合计/u)
  assert.match(html, /本月采购确认成本/u)
  assert.doesNotMatch(html, /本月工资发放|经营费用合计|公司总成本|当前采购应付余额/u)
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

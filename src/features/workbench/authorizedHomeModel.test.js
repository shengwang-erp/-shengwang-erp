import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

import { getVisibleAdminRoutes } from '../../auth/businessAccess.js'
import {
  buildUnavailableHomeFinancialState,
  buildAuthorizedHomeModel,
  getAuthorizedHomeSummary,
} from './authorizedHomeModel.js'

const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  employeeId: 'E-HOME',
  employeeNumber: 'SW-123',
  name: '首页员工',
  department: '现场',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys,
  ...overrides,
})

const ready = (data, overrides = {}) => ({
  status: 'ready', data, stale: false, message: '', ...overrides,
})

async function loadAppModule() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    plugins: [{
      name: 'home-financial-leaflet-ssr-stub',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0home-financial-leaflet-ssr-stub' : null
      },
      load(id) {
        return id === '\0home-financial-leaflet-ssr-stub'
          ? 'export default { icon: () => ({}) }'
          : null
      },
    }],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/App.jsx')
  } finally {
    await server.close()
  }
}

test('ordinary Home never reads or aggregates hidden business source states', () => {
  let hiddenReads = 0
  const hidden = () => ({
    get status() {
      hiddenReads += 1
      return 'ready'
    },
    data: [{ amount: 999999 }],
  })
  const user = activeUser()
  const model = buildAuthorizedHomeModel({
    user,
    routes: getVisibleAdminRoutes(user),
    sourceStates: {
      projects: hidden(),
      employees: hidden(),
      purchaseSummary: hidden(),
      costSummary: hidden(),
      inventoryItems: hidden(),
    },
  })

  assert.equal(hiddenReads, 0)
  assert.deepEqual(model.modules.map(({ view }) => view), ['todayAttendance'])
  assert.equal(JSON.stringify(model).includes('999999'), false)
  assert.deepEqual(model.overview, [])
  assert.equal(getAuthorizedHomeSummary(Object.freeze({ summary: model.summary })), null)
  assert.equal(getAuthorizedHomeSummary(model), model.summary)
})

test('finance Home exposes only ready authorized accounting and purchase projections', () => {
  const user = activeUser([
    'module.accounting.view',
    'module.salaries.view',
    'module.project_costs.view',
    'module.operating_expenses.view',
    'module.purchases.view',
    'module.vehicles.view',
    'sensitive.salary_view',
  ], {
    name: '财务员工', department: '会计', position: '会计',
  })
  const model = buildAuthorizedHomeModel({
    user,
    routes: getVisibleAdminRoutes(user),
    sourceStates: {
      costSummary: ready({ companyMonthlyTotal: { total: 700 } }),
      purchaseSummary: ready({ summary: { monthPurchaseCost: 400 } }),
      vehicles: { status: 'error', data: [{ amount: 999 }], message: '车辆数据暂不可用' },
    },
  })

  const byView = new Map(model.modules.map((item) => [item.view, item]))
  assert.equal(byView.get('accounting').displayValue, '¥700')
  assert.equal(byView.get('purchase').displayValue, '¥400')
  assert.equal(model.summary.monthlyCostTotal, 700)
  assert.equal(model.summary.monthlyPurchaseTotal, 400)
  assert.equal(byView.get('vehicle').displayValue, '读取失败')
  assert.equal(model.sourceNotices.some((notice) =>
    notice.view === 'vehicle' && notice.status === 'error'), true)
  assert.equal(JSON.stringify(model).includes('999'), false)
  assert.equal(byView.has('projects'), false)
  assert.equal(byView.has('employees'), false)
})

test('stale finance inputs reach Home as ready-stale without an amount or zero fallback', () => {
  const user = activeUser([
    'module.accounting.view',
    'module.salaries.view',
    'module.project_costs.view',
    'module.operating_expenses.view',
    'module.purchases.view',
    'module.vehicles.view',
    'sensitive.salary_view',
  ], {
    name: '财务员工', department: '会计', position: '会计',
  })
  const staleCost = buildUnavailableHomeFinancialState([
    ready([], { stale: true }),
    ready([]),
  ])
  const stalePurchase = buildUnavailableHomeFinancialState([
    ready([{ totalCost: 880000 }], { stale: true }),
  ])

  assert.deepEqual(staleCost, { status: 'ready', data: null, stale: true })
  assert.deepEqual(stalePurchase, { status: 'ready', data: null, stale: true })

  const model = buildAuthorizedHomeModel({
    user,
    routes: getVisibleAdminRoutes(user),
    sourceStates: {
      costSummary: staleCost,
      purchaseSummary: stalePurchase,
      vehicles: ready([]),
    },
  })
  const byView = new Map(model.modules.map((item) => [item.view, item]))
  assert.equal(byView.get('accounting').displayValue, '数据过期')
  assert.equal(byView.get('purchase').displayValue, '数据过期')
  assert.equal(byView.get('accounting').sourceStale, true)
  assert.equal(byView.get('purchase').sourceStale, true)
  assert.equal(model.summary.monthlyCostTotal, null)
  assert.equal(model.summary.monthlyPurchaseTotal, null)
  assert.equal(JSON.stringify(model).includes('880000'), false)
})

test('financial source failures keep fail-closed priority over a separate stale source', () => {
  const stale = ready([], { stale: true })
  assert.deepEqual(buildUnavailableHomeFinancialState([
    stale,
    { status: 'forbidden', data: null, stale: false },
  ]), { status: 'forbidden', data: null, stale: false })
  assert.deepEqual(buildUnavailableHomeFinancialState([
    stale,
    { status: 'error', data: null, stale: false },
  ]), { status: 'error', data: null, stale: false })
  assert.deepEqual(buildUnavailableHomeFinancialState([
    stale,
    { status: 'loading', data: null, stale: false },
  ]), { status: 'loading', data: null, stale: false })
})

test('App financial builder preserves stale cost and purchase inputs as amount-free Home states', async () => {
  const { buildHomeFinancialModels } = await loadAppModule()
  const owner = activeUser(['all'], {
    employeeId: 'SUPER_ADMIN',
    employeeNumber: 'SW-000',
    name: '本地验收社长',
    department: '总务部',
    position: '社长',
  })
  const staleArray = ready([{ totalCost: 880000 }], { stale: true })
  const staleObject = ready({ secretTotal: 990000 }, { stale: true })
  const model = buildHomeFinancialModels({
    currentUser: owner,
    selectedMonth: '2026-07',
    sourceStates: {
      projects: staleArray,
      laborWindow: staleObject,
      purchaseAccrual: staleArray,
      purchaseLedgerAccrual: staleArray,
      purchasePayments: staleArray,
      projectCosts: staleArray,
      operatingExpenses: staleArray,
      fuel: staleArray,
      vehicleExpenses: staleArray,
      vehicleIssues: staleArray,
    },
  })

  assert.deepEqual(model, {
    cost: { status: 'ready', data: null, stale: true },
    purchase: { status: 'ready', data: null, stale: true },
  })
  assert.equal(JSON.stringify(model).includes('880000'), false)
  assert.equal(JSON.stringify(model).includes('990000'), false)
})

test('Home publishes a safe four-decimal frozen warehouse cost without downgrading the accounting card', async () => {
  const { buildHomeFinancialModels } = await loadAppModule()
  const owner = activeUser(['all'], {
    employeeId: 'SUPER_ADMIN', employeeNumber: 'SW-000', name: '本地验收社长',
    department: '总务部', position: '社长',
  })
  const warehouseCost = {
    costRecordId: 'WAREHOUSE-SO:55555555-5555-4555-8555-555555555555',
    projectId: 'P1', projectName: '共享成本项目', costType: '材料费',
    amount: 166.6667, date: '2026-07-09', sourceType: 'warehouse',
    sourceDocumentId: '55555555-5555-4555-8555-555555555555',
    sourceDocumentType: 'warehouse_stock_out', sourcePurchaseRecordKeys: [],
    sourceStockOutIds: ['55555555-5555-4555-8555-555555555555'],
  }
  const financial = buildHomeFinancialModels({
    currentUser: owner,
    selectedMonth: '2026-07',
    sourceStates: {
      projects: ready([{ projectId: 'P1', projectName: '共享成本项目' }]),
      laborWindow: ready({
        monthly: [{
          month: '2026-07', status: 'ready', stale: false, source: 'formal',
          pendingCount: 0, salaryTotal: 0, projectLaborTotal: 0,
          projectLaborById: { P1: 0 },
        }],
        projectLaborLifetimeById: { P1: 0 }, lifetimeStatus: 'ready',
        lifetimeStale: false, incompleteMonths: [], staleMonths: [],
      }),
      purchaseAccrual: ready([]), purchaseLedgerAccrual: ready([]),
      purchasePayments: ready([]), projectCosts: ready([warehouseCost]),
      operatingExpenses: ready([]), fuel: ready([]),
      vehicleExpenses: ready([]), vehicleIssues: ready([]),
    },
  })

  assert.equal(financial.cost.status, 'ready')
  assert.equal(financial.cost.data.companyMonthlyTotal.total, 166.6667)
  const home = buildAuthorizedHomeModel({
    user: owner,
    routes: getVisibleAdminRoutes(owner).filter(({ view }) => view === 'accounting'),
    sourceStates: { costSummary: financial.cost },
  })
  assert.equal(home.modules[0].sourceStatus, 'ready')
  assert.equal(home.summary.monthlyCostTotal, 166.6667)
  assert.equal(home.modules[0].displayValue, '¥166.667')
})

test('SW-000 Home derives counts from ready states and discloses stale or failed sources', () => {
  const owner = activeUser(['all'], {
    employeeId: 'SUPER_ADMIN',
    employeeNumber: 'SW-000',
    name: '本地验收社长',
    department: '总务部',
    position: '社长',
  })
  const model = buildAuthorizedHomeModel({
    user: owner,
    routes: getVisibleAdminRoutes(owner),
    sourceStates: {
      projects: ready([{ status: '进行中' }, { status: '暂停' }]),
      employees: ready([
        { employeeId: 'E-1', employmentStatus: '在职' },
        { employeeId: 'SUPER_ADMIN', employmentStatus: '在职' },
      ]),
      stockOutRecords: ready([{ id: 'SO-1' }]),
      stockReturnRecords: ready([]),
      attendance: ready([{ id: 'A-1' }, { id: 'A-2' }]),
      vehicles: ready([], { stale: true, message: '车辆数据可能已过期' }),
      toolBorrowRecords: { status: 'error', data: [{ id: 'SECRET' }], message: '工具读取失败' },
      costSummary: ready({ companyMonthlyTotal: { total: 500 } }),
      purchaseSummary: ready({ summary: { monthPurchaseCost: 300 } }),
    },
  })

  const byView = new Map(model.modules.map((item) => [item.view, item]))
  assert.equal(byView.get('projects').badgeCount, 2)
  assert.equal(byView.get('employees').badgeCount, 1)
  assert.equal(byView.get('vehicle').displayValue, '数据过期')
  assert.equal(byView.get('vehicle').sourceStatus, 'ready')
  assert.equal(byView.get('vehicle').sourceStale, true)
  assert.equal(byView.get('toolBorrow').displayValue, '读取失败')
  assert.equal(JSON.stringify(model).includes('SECRET'), false)
  assert.deepEqual(
    model.overview.map(({ label, value }) => [label, value]),
    [['进行中项目', 1], ['已授权业务记录', 3], ['暂停项目', 1]],
  )
  assert.deepEqual(model.summary, {
    activeProjects: 1,
    activeEmployees: 1,
    totalRecords: 3,
    pausedProjects: 1,
    monthlyPurchaseTotal: 300,
    monthlyCostTotal: 500,
    moduleCounts: {
      projects: 2,
      employees: 1,
      stockOut: 1,
      stockReturn: 0,
      labor: 2,
      vehicle: 0,
      toolBorrow: 0,
    },
  })
  const missingStockReturn = byView.get('stockReturn')
  assert.equal(missingStockReturn.sourceStatus, 'ready')

  const missingModel = buildAuthorizedHomeModel({
    user: owner,
    routes: getVisibleAdminRoutes(owner).filter(({ view }) => view === 'stockReturn'),
    sourceStates: {},
  })
  assert.equal(missingModel.modules[0].sourceStatus, 'loading')
})

test('injected routes are canonicalized and authorization is checked before state access', () => {
  const user = activeUser()
  let reads = 0
  const model = buildAuthorizedHomeModel({
    user,
    routes: [
      { view: 'projects', label: '伪造项目', iconText: 'X' },
      { view: 'inventory', label: '仓库库存', iconText: '库' },
      { view: 'todayAttendance', label: '伪造打卡', iconText: 'X' },
    ],
    sourceStates: Object.defineProperty({}, 'projects', {
      enumerable: true,
      get() {
        reads += 1
        return ready([{ id: 'PRIVATE' }])
      },
    }),
  })

  assert.equal(reads, 0)
  assert.deepEqual(model.modules.map(({ view, label, iconText }) => ({ view, label, iconText })), [{
    view: 'todayAttendance', label: '今日打卡', iconText: '勤',
  }])
})

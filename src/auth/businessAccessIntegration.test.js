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

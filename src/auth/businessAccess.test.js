import assert from 'node:assert/strict'
import test from 'node:test'

import { ADMIN_ROUTES } from '../navigation/adminRoutes.js'
import {
  canAccessView,
  getAccountingAccess,
  getDashboardAccess,
  getProjectReferenceAccess,
  getPurchaseAccess,
  getVisibleAdminRoutes,
} from './businessAccess.js'

const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  employeeId: 'E-1',
  employeeNumber: 'SW-101',
  name: '测试员工',
  department: '工程部',
  position: '社员',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys,
  ...overrides,
})

const activeFinanceUser = (effectivePermissionKeys = [], overrides = {}) => activeUser(
  effectivePermissionKeys,
  {
    employeeId: 'E-FIN',
    department: '财务部',
    position: '会计',
    ...overrides,
  },
)

const fullDashboardKeys = [
  'module.owner_dashboard.view',
  'module.projects.view',
  'module.employees.view',
  'module.labor.view',
  'module.salaries.view',
  'module.project_costs.view',
  'module.purchases.view',
  'module.vehicles.view',
  'module.inventory.view',
  'module.tools.view',
  'module.operating_expenses.view',
  'sensitive.owner_dashboard_full_view',
  'sensitive.contract_amount_view',
  'sensitive.profit_view',
  'sensitive.salary_view',
  'sensitive.purchase_payments_view',
  'sensitive.employee_identity_view',
]

const noDashboardAccess = {
  page: false,
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
    labor: false,
    purchase: false,
    vehicle: false,
    manualSupplement: false,
    operatingExpense: false,
  },
}

test('zero-permission users get only active-only routes and module routes require exact keys', () => {
  const user = activeUser()

  assert.deepEqual(
    getVisibleAdminRoutes(user).map(({ view }) => view),
    ['home', 'todayAttendance'],
  )
  for (const view of ['home', 'todayAttendance', 'workbench', 'messages', 'profile']) {
    assert.equal(canAccessView(user, view), true, view)
  }
  for (const view of ADMIN_ROUTES.map(({ view }) => view).filter(
    (view) => !['home', 'todayAttendance', 'workbench', 'messages', 'profile'].includes(view),
  )) {
    assert.equal(canAccessView(user, view), false, view)
  }

  const inventoryUser = activeUser(['module.inventory.view'])
  assert.equal(canAccessView(inventoryUser, 'warehouse'), true)
  assert.equal(canAccessView(inventoryUser, 'stockOut'), false)
  assert.equal(canAccessView(inventoryUser, 'stockReturn'), false)
  const requester = activeUser(['module.inventory.view', 'warehouse.stock_flow.request'])
  assert.equal(canAccessView(requester, 'stockOut'), true)
  assert.equal(canAccessView(requester, 'stockReturn'), true)
  const confirmer = activeUser(['module.inventory.view', 'warehouse.stock_flow.confirm'])
  assert.equal(canAccessView(confirmer, 'stockOut'), true)
  assert.equal(canAccessView(confirmer, 'stockReturn'), true)
  assert.equal(canAccessView(inventoryUser, 'purchase'), false)
})

test('every route requires an active authenticated employee and unknown views fail closed', () => {
  const inactiveUsers = [
    activeUser(['all'], { employmentStatus: '离职' }),
    activeUser(['all'], { accountStatus: 'disabled' }),
    activeUser(['all'], { mustChangePassword: true }),
  ]

  for (const user of inactiveUsers) {
    for (const route of ADMIN_ROUTES) {
      assert.equal(canAccessView(user, route.view), false, route.view)
    }
    assert.deepEqual(getVisibleAdminRoutes(user), [])
  }

  assert.equal(canAccessView(activeUser(['all']), 'unknown'), false)
  assert.equal(canAccessView(activeUser(['all']), new String('home')), false)
})

test('direct project revenue access keeps the fixed project-financial whitelist', () => {
  assert.equal(canAccessView(activeUser(['module.projects.view']), 'contractRevenue'), false)
  assert.equal(canAccessView(activeFinanceUser(['module.projects.view']), 'contractRevenue'), true)
  assert.equal(
    canAccessView(activeUser(['all'], { department: '设计部' }), 'contractRevenue'),
    true,
  )
  assert.equal(canAccessView(activeUser(['all']), 'contractRevenue'), false)
})

test('active SW-000 is fully authorized while effective all still respects identity whitelists', () => {
  const sw000 = activeUser([], { employeeNumber: 'SW-000' })
  assert.equal(getVisibleAdminRoutes(sw000).length, 14)
  assert.equal(canAccessView(sw000, 'contractRevenue'), true)
  assert.equal(getDashboardAccess(sw000).profit.view, true)

  const transitionalAll = activeUser(['all'])
  assert.equal(getVisibleAdminRoutes(transitionalAll).length, 14)
  assert.equal(canAccessView(transitionalAll, 'contractRevenue'), false)
  assert.equal(getDashboardAccess(transitionalAll).contracts.amounts, false)
  assert.equal(getDashboardAccess(transitionalAll).profit.view, false)
})

test('dashboard shell permission never implies financial data permission', () => {
  const access = getDashboardAccess(activeUser(['module.owner_dashboard.view']))
  assert.deepEqual(access, {
    ...noDashboardAccess,
    page: true,
  })
})

test('dashboard non-amount views are separate from the owner full-data gate', () => {
  const access = getDashboardAccess(activeFinanceUser([
    'module.owner_dashboard.view',
    'module.projects.view',
    'module.employees.view',
    'module.labor.view',
    'module.vehicles.view',
    'module.inventory.view',
    'module.tools.view',
    'sensitive.employee_identity_view',
  ]))

  assert.equal(access.projectSnapshot, true)
  assert.deepEqual(access.contracts, { view: true, amounts: false })
  assert.deepEqual(access.attendance, { view: true, identities: false })
  assert.deepEqual(access.labor, { view: true, amounts: false })
  assert.deepEqual(access.vehicle, { view: true, amounts: false })
  assert.deepEqual(access.inventory, { view: true, amounts: false })
  assert.deepEqual(access.tools, { view: true, amounts: false })
})

test('full finance dashboard access exposes every field only with all contributing gates', () => {
  const access = getDashboardAccess(activeFinanceUser(fullDashboardKeys))

  assert.deepEqual(access, {
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
      labor: true,
      purchase: true,
      vehicle: true,
      manualSupplement: true,
      operatingExpense: true,
    },
  })
})

test('owner full view never bypasses the project whitelist or specific sensitive permissions', () => {
  const ordinary = getDashboardAccess(activeUser(fullDashboardKeys))
  assert.equal(ordinary.contracts.view, false)
  assert.equal(ordinary.contracts.amounts, false)
  assert.equal(ordinary.profit.view, false)

  const missingContractPermission = getDashboardAccess(activeFinanceUser(
    fullDashboardKeys.filter((key) => key !== 'sensitive.contract_amount_view'),
  ))
  assert.equal(missingContractPermission.contracts.view, true)
  assert.equal(missingContractPermission.contracts.amounts, false)
  assert.equal(missingContractPermission.profit.view, false)

  const missingProfitPermission = getDashboardAccess(activeFinanceUser(
    fullDashboardKeys.filter((key) => key !== 'sensitive.profit_view'),
  ))
  assert.equal(missingProfitPermission.contracts.amounts, true)
  assert.equal(missingProfitPermission.profit.view, false)
})

test('profit completeness requires every contributing cost-category gate', () => {
  const missingModuleByCategory = {
    labor: 'module.salaries.view',
    purchase: 'module.purchases.view',
    vehicle: 'module.vehicles.view',
    manualSupplement: 'module.project_costs.view',
    operatingExpense: 'module.operating_expenses.view',
  }

  for (const [category, missingKey] of Object.entries(missingModuleByCategory)) {
    const access = getDashboardAccess(activeFinanceUser(
      fullDashboardKeys.filter((key) => key !== missingKey),
    ))
    assert.equal(access.costCategories[category], false, category)
    assert.equal(access.profit.view, false, category)
  }
})

test('purchase dashboard accrual is separate from payment, payable, and anomaly sensitivity', () => {
  const accrual = getDashboardAccess(activeUser([
    'module.owner_dashboard.view',
    'module.purchases.view',
    'sensitive.owner_dashboard_full_view',
  ]))
  assert.deepEqual(accrual.purchase, {
    accrual: true,
    payments: false,
    payable: false,
    anomalies: false,
  })

  const paymentView = getDashboardAccess(activeUser([
    'module.owner_dashboard.view',
    'module.purchases.view',
    'sensitive.owner_dashboard_full_view',
    'sensitive.purchase_payments_view',
  ]))
  assert.deepEqual(paymentView.purchase, {
    accrual: true,
    payments: true,
    payable: true,
    anomalies: true,
  })
})

test('accounting sections use exact module, sensitive, and action permissions', () => {
  const keys = [
    'module.accounting.view',
    'module.salaries.view',
    'module.salaries.create',
    'module.salaries.update',
    'module.salaries.delete',
    'module.project_costs.view',
    'module.project_costs.create',
    'module.project_costs.update',
    'module.project_costs.delete',
    'module.operating_expenses.view',
    'module.operating_expenses.create',
    'module.operating_expenses.update',
    'module.operating_expenses.delete',
    'module.purchases.view',
    'sensitive.salary_view',
    'sensitive.salary_update',
    'sensitive.purchase_payments_view',
  ]

  assert.deepEqual(getAccountingAccess(activeFinanceUser(keys)), {
    salary: { view: true, create: true, update: true, delete: true },
    projectCost: {
      view: true, create: true, update: true, delete: true,
      readLedger: true, createManual: true, adjust: true, allocate: true,
    },
    operatingExpense: { view: true, create: true, update: true, delete: true },
    purchaseAccounting: { view: true },
    monthlySummary: {
      salary: true,
      projectCost: true,
      operatingExpense: true,
      purchaseAccrual: true,
      purchasePayments: true,
    },
  })

  const salaryReadOnly = getAccountingAccess(activeFinanceUser([
    'module.accounting.view',
    'module.salaries.view',
    'module.salaries.create',
    'sensitive.salary_view',
  ]))
  assert.deepEqual(salaryReadOnly.salary, {
    view: true,
    create: false,
    update: false,
    delete: false,
  })
})

test('project cost ledger permission is independent and maps create/update to accounting operations', () => {
  const user = activeFinanceUser([
    'module.accounting.view',
    'module.project_costs.view',
    'module.project_costs.create',
    'module.project_costs.update',
  ])
  const access = getAccountingAccess(user)

  assert.deepEqual(access.projectCost, {
    view: true,
    create: true,
    update: true,
    delete: false,
    readLedger: true,
    createManual: true,
    adjust: true,
    allocate: true,
  })
  assert.equal(access.purchaseAccounting.view, false)
  assert.equal(access.monthlySummary.purchaseAccrual, false)
  assert.equal(access.monthlySummary.purchasePayments, false)
  for (const view of ['purchase', 'warehouse', 'vehicle', 'toolBorrow']) {
    assert.equal(canAccessView(user, view), false, view)
  }
  assert.deepEqual(getProjectReferenceAccess(user), {
    view: true,
    full: false,
  })
})

test('tool responsibility managers get project references without project module access', () => {
  const manager = activeUser([
    'module.tools.view',
    'module.tools.update',
  ])
  const viewer = activeUser(['module.tools.view'])

  assert.deepEqual(getProjectReferenceAccess(manager), { view: true, full: false })
  assert.deepEqual(getProjectReferenceAccess(viewer), { view: false, full: false })
  assert.equal(canAccessView(manager, 'projects'), false)
})

test('owner dashboard cost cards preserve both narrow project relation read chains', () => {
  const dashboardProjectCost = [
    'module.owner_dashboard.view',
    'sensitive.owner_dashboard_full_view',
    'module.project_costs.view',
  ]
  const dashboardOperatingExpense = [
    'module.owner_dashboard.view',
    'sensitive.owner_dashboard_full_view',
    'module.operating_expenses.view',
  ]

  assert.deepEqual(
    getProjectReferenceAccess(activeFinanceUser(dashboardProjectCost)),
    { view: true, full: false },
  )
  assert.deepEqual(
    getProjectReferenceAccess(activeFinanceUser(dashboardOperatingExpense)),
    { view: true, full: false },
  )
  for (const keys of [dashboardProjectCost, dashboardOperatingExpense]) {
    for (const missingKey of keys) {
      assert.deepEqual(
        getProjectReferenceAccess(activeFinanceUser(
          keys.filter((key) => key !== missingKey),
        )),
        { view: false, full: false },
        missingKey,
      )
    }
  }
})

test('purchase sections separate accrual actions from payment sensitive actions', () => {
  const keys = [
    'module.purchases.view',
    'module.purchases.create',
    'module.purchases.update',
    'module.purchases.delete',
    'sensitive.purchase_payments_view',
    'sensitive.purchase_payments_update',
    'warehouse.receipt.submit',
  ]
  assert.deepEqual(getPurchaseAccess(activeUser(keys)), {
    records: { view: true, create: true, update: true, delete: true },
    payments: { view: true, create: true, update: true, delete: true },
    stockIn: { view: true, create: true, update: false, delete: false },
    summary: { view: true },
  })

  const accrualOnly = getPurchaseAccess(activeUser([
    'module.purchases.view',
    'module.purchases.create',
    'module.purchases.update',
    'module.purchases.delete',
    'warehouse.receipt.submit',
  ]))
  assert.deepEqual(accrualOnly, {
    records: { view: true, create: true, update: true, delete: true },
    payments: { view: false, create: false, update: false, delete: false },
    stockIn: { view: true, create: true, update: false, delete: false },
    summary: { view: true },
  })
})

test('purchase arrival submission requires purchase view/create and warehouse receipt submit while confirmation stays independent', () => {
  assert.deepEqual(getPurchaseAccess(activeUser([
    'module.purchases.view',
    'module.purchases.create',
  ])).stockIn, { view: false, create: false, update: false, delete: false })

  assert.deepEqual(getPurchaseAccess(activeUser([
    'module.purchases.view',
    'warehouse.receipt.submit',
  ])).stockIn, { view: true, create: false, update: false, delete: false })

  assert.deepEqual(getPurchaseAccess(activeUser([
    'module.purchases.view',
    'module.purchases.create',
    'warehouse.receipt.submit',
  ])).stockIn, { view: true, create: true, update: false, delete: false })

  assert.deepEqual(getPurchaseAccess(activeUser([
    'module.purchases.view',
    'module.purchases.create',
    'warehouse.receipt.confirm',
  ])).stockIn, { view: false, create: false, update: false, delete: false })
})

test('legacy personal arrays and action-only effective keys never unlock projections', () => {
  const user = activeUser(['module.purchases.create'], {
    accessibleModules: ['采购管理', '会计成本'],
    canCreateModules: ['采购管理', '工资记录'],
    canEditModules: ['采购管理', '工资记录'],
    canDeleteModules: ['采购管理', '工资记录'],
    sensitivePermissions: ['查看采购付款', '修改采购付款', '查看工资', '修改工资'],
  })

  assert.deepEqual(getPurchaseAccess(user), {
    records: { view: false, create: false, update: false, delete: false },
    payments: { view: false, create: false, update: false, delete: false },
    stockIn: { view: false, create: false, update: false, delete: false },
    summary: { view: false },
  })
  assert.equal(getAccountingAccess(user).salary.view, false)
})

test('malformed, inherited, and accessor users fail closed without invoking getters', () => {
  const inherited = Object.create(activeUser(['all']))
  let getterCalls = 0
  const accessor = activeUser(['all'])
  Object.defineProperty(accessor, 'accountStatus', {
    configurable: true,
    get() {
      getterCalls += 1
      return 'active'
    },
  })

  for (const user of [null, undefined, [], inherited, accessor]) {
    assert.equal(canAccessView(user, 'home'), false)
    assert.deepEqual(getVisibleAdminRoutes(user), [])
    assert.deepEqual(getDashboardAccess(user), noDashboardAccess)
    assert.equal(getAccountingAccess(user).salary.view, false)
    assert.equal(getPurchaseAccess(user).records.view, false)
  }
  assert.equal(getterCalls, 0)
})

test('all returned route and access projections are detached and deeply immutable', () => {
  const user = activeFinanceUser(fullDashboardKeys)
  const firstRoutes = getVisibleAdminRoutes(user)
  const secondRoutes = getVisibleAdminRoutes(user)
  const firstDashboard = getDashboardAccess(user)
  const secondDashboard = getDashboardAccess(user)
  const accounting = getAccountingAccess(activeFinanceUser(['all']))
  const purchase = getPurchaseAccess(activeFinanceUser(['all']))

  assert.notEqual(firstRoutes, secondRoutes)
  assert.notEqual(firstRoutes[0], secondRoutes[0])
  assert.notEqual(firstRoutes[0], ADMIN_ROUTES[0])
  assert.notEqual(firstDashboard, secondDashboard)
  assert.notEqual(firstDashboard.contracts, secondDashboard.contracts)

  for (const value of [firstRoutes, firstRoutes[0], firstDashboard,
    firstDashboard.contracts, accounting, accounting.salary, purchase, purchase.records]) {
    assert.equal(Object.isFrozen(value), true)
  }
  assert.throws(() => {
    firstDashboard.contracts.amounts = false
  }, TypeError)
  assert.throws(() => {
    firstRoutes[0].label = 'changed'
  }, TypeError)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import { buildCostAccountingReadModel } from './costAccountingDomain.js'
import { buildExecutiveDashboardReadModel } from '../executive-dashboard/executiveDashboardDomain.js'
import { buildPurchaseAccountingReadModel } from '../purchase-accounting/purchaseAccountingDomain.js'

const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`)
  return source.slice(start, end)
}

async function loadAppModule() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    plugins: [{
      name: 'cost-app-leaflet-ssr-stub',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0cost-app-leaflet-ssr-stub' : null
      },
      load(id) {
        return id === '\0cost-app-leaflet-ssr-stub'
          ? 'export default { icon: () => ({}) }'
          : null
      },
      transform(code, id) {
        if (!id.endsWith('/src/App.jsx')) return null
        return code.replace('function HomePage(', 'export function HomePage(')
      },
    }],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true },
  })
  try {
    return { module: await server.ssrLoadModule('/src/App.jsx'), error: null }
  } catch (error) {
    return { module: null, error }
  } finally {
    await server.close()
  }
}

function ready(data) {
  return {
    status: 'ready', data, code: '', message: '', stale: false,
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
}

const month = '2026-08'
const projects = [{ projectId: 'P1', projectName: '共享成本项目', status: '进行中' }]
const laborWindow = {
  monthly: [{
    month, status: 'ready', stale: false, salaryTotal: 100,
    projectLaborTotal: 80, projectLaborById: { P1: 80 }, source: 'formal', pendingCount: 0,
  }],
  projectLaborLifetimeById: { P1: 80 },
  lifetimeStatus: 'ready', lifetimeStale: false, incompleteMonths: [], staleMonths: [],
}
const purchases = [{
  purchaseId: 'PO1', purchaseDate: '2026-08-01', projectId: 'P1',
  totalCost: 200, openingPaidAmount: 0, purchaseStatus: '正常', invoiceStatus: '已取得',
}]
const manualCosts = [
  { costRecordId: 'C-L', projectId: 'P1', costType: '人工费', amount: 10, date: '2026-08-02' },
  { costRecordId: 'C-M', projectId: 'P1', costType: '材料费', amount: 20, date: '2026-08-03' },
  { costRecordId: 'C-T', projectId: 'P1', costType: '工具费', amount: 30, date: '2026-08-04' },
  { costRecordId: 'C-V', projectId: 'P1', costType: '车辆费', amount: 40, date: '2026-08-05' },
  { costRecordId: 'C-O', projectId: 'P1', costType: '外包费', amount: 100, date: '2026-08-06' },
]
const operating = [{
  expenseRecordId: 'OE1', projectId: 'P1', allocateToProject: true,
  amount: 50, date: '2026-08-07', expenseType: '其他',
}]
const fuel = [{
  fuelRecordId: 'F1', projectId: 'P1', allocateToProject: true,
  fuelAmount: 30, fuelDate: '2026-08-08',
  fuelDateSource: 'recorded', fuelDateLegacyInferred: false,
  paymentMethod: '现金', paymentMethodSource: 'recorded', paymentMethodLegacyInferred: false,
}]
const vehicleExpenses = [{
  vehicleExpenseId: 'VE1', projectId: 'P1', allocateToProject: true,
  amount: 20, expenseDate: '2026-08-09', expenseType: '停车费',
  expenseDateSource: 'recorded', expenseDateLegacyInferred: false,
  paymentMethod: '现金', paymentMethodSource: 'recorded', paymentMethodLegacyInferred: false,
}]
const vehicleIssues = [{
  issueId: 'VI1', projectId: 'P1', allocateToProject: true,
  repairCost: 50, issueDate: '2026-08-10', severity: '一般', issueStatus: '未处理',
}]

const costInput = {
  months: [month], selectedMonth: month, projectId: 'all', activeProjectIds: ['P1'],
  laborWindow, purchaseRows: purchases, fuelRecords: fuel,
  vehicleExpenseRecords: vehicleExpenses, vehicleIssueRecords: vehicleIssues,
  manualProjectCosts: manualCosts, operatingExpenses: operating,
}

const loaded = await loadAppModule()

test('MonthlySummarySection delegates every cost total to buildCostAccountingReadModel', () => {
  const summary = sliceBetween(appSource, 'function MonthlySummarySection', '\nfunction AccountingRecordList')
  assert.equal((summary.match(/buildCostAccountingReadModel\(/gu) || []).length, 1)
  for (const input of [
    'laborWindow', 'purchaseRows', 'fuelRecords', 'vehicleExpenseRecords',
    'vehicleIssueRecords', 'manualProjectCosts', 'operatingExpenses',
  ]) assert.match(summary, new RegExp(`${input}:`, 'u'))
  assert.match(summary, /costModel\.companyMonthlyTotal/u)
  assert.match(summary, /costModel\.selectedComposition/u)
  assert.match(summary, /costModel\.pending/u)
  assert.doesNotMatch(
    summary,
    /totalSalary\s*\+|totalPurchaseCost\s*\+|totalVehicleCost\s*\+|companyProjectCost/u,
  )
})

test('accounting project relations use an authorized projected project source', () => {
  const authenticated = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
  const projectProjection = sliceBetween(
    authenticated,
    'projects: projectPromiseSource(projectRawState, {',
    '\n    contractRevenue:',
  )
  assert.match(
    authenticated,
    /const projectRelationReadAccess = [\s\S]*?dashboardAccess\.projectSnapshot[\s\S]*?purchaseReadAccess\.records[\s\S]*?accountingReadAccess\.projectCost[\s\S]*?accountingReadAccess\.operatingExpense[\s\S]*?canAccessView\(currentUser, 'vehicle'\)/u,
  )
  assert.match(projectProjection, /readAllowed:\s*projectRelationReadAccess/u)
})

test('legacy App cost and gross-profit helpers and tax-inclusive profit arithmetic are gone', () => {
  for (const helper of [
    'getProjectCostTotal', 'getProjectVehicleCostTotal',
    'getVehicleCostTotal', 'getGrossProfitInfo', 'getMonthlySalaryPaidTotal',
  ]) assert.doesNotMatch(appSource, new RegExp(`\\b${helper}\\b`, 'u'))
  assert.doesNotMatch(appSource, /monthlySalaryRecords[\s\S]{0,240}\.reduce\(/u)
  assert.doesNotMatch(
    appSource,
    /adjustedTaxInclusiveAmount\s*-|\.adjustedTaxInclusiveAmount\s*-/u,
  )
  const dashboard = sliceBetween(appSource, 'function DashboardPage({', '\nfunction PageShell')
  assert.doesNotMatch(dashboard, /purchase|vehicle|labor|cost.*reduce|grossProfit/u)
})

test('shared cost domain keeps four manual categories and repair estimates pending', () => {
  const model = buildCostAccountingReadModel(costInput)
  assert.equal(model.companyMonthlyTotal.total, 500)
  assert.equal(model.projectLifetimeById.P1.total, 480)
  assert.deepEqual(Object.fromEntries(Object.entries(model.pending).map(([key, rows]) => [
    key, rows.map((row) => row.costRecordId || row.issueId),
  ])), {
    manualLaborCosts: ['C-L'],
    manualMaterialCosts: ['C-M'],
    manualToolCosts: ['C-T'],
    manualVehicleCosts: ['C-V'],
    vehicleRepairEstimates: ['VI1'],
  })
})

test('Home financial cards consume only ready shared models and never raw cost arithmetic', () => {
  assert.ifError(loaded.error)
  const currentUser = {
    id: 'owner-home', employeeId: 'E-HOME', employeeNumber: 'SW-000', name: '首页社长',
    department: '总务部', position: '社长', employmentStatus: '在职',
    accountStatus: 'active', mustChangePassword: false, effectivePermissionKeys: ['all'],
  }
  const sharedCostModel = buildCostAccountingReadModel(costInput)
  const sharedPurchaseModel = buildPurchaseAccountingReadModel({
    purchaseRecords: purchases,
    paymentRecords: [],
    paymentState: { status: 'ready', data: [] },
    month,
  })
  const homeMonth = (() => {
    const date = new Date()
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })()
  const rawAccountingRecords = {
    salary: [{ salaryMonth: homeMonth, netSalary: 100 }],
    projectCost: [
      { date: `${homeMonth}-01`, costType: '材料费', amount: 20 },
      { date: `${homeMonth}-02`, costType: '外包费', amount: 100 },
    ],
    operatingExpense: [{ date: `${homeMonth}-03`, amount: 50 }],
    purchase: [{ purchaseDate: `${homeMonth}-04`, purchaseStatus: '正常', totalCost: 200 }],
    fuel: [{ fuelDate: `${homeMonth}-05`, fuelAmount: 30 }],
    vehicleExpense: [{ expenseDate: `${homeMonth}-06`, amount: 20 }],
    vehicleIssue: [{ issueDate: `${homeMonth}-07`, repairCost: 50 }],
  }
  const baseSources = {
    projects,
    employees: [],
    records: {
      stockOut: [], stockReturn: [], labor: [], vehicle: [], toolBorrow: [], toolReturn: [],
    },
    accountingRecords: rawAccountingRecords,
    financialModels: {
      cost: { status: 'ready', data: sharedCostModel },
      purchase: { status: 'ready', data: sharedPurchaseModel },
    },
  }

  const summary = loaded.module.buildAuthorizedHomeSummary(currentUser, baseSources)
  assert.equal(summary.monthlyCostTotal, 500)
  assert.equal(summary.monthlyPurchaseTotal, 200)

  const unavailable = loaded.module.buildAuthorizedHomeSummary(currentUser, {
    ...baseSources,
    financialModels: {
      cost: { status: 'loading', data: null },
      purchase: { status: 'error', data: null },
    },
  })
  assert.equal(unavailable.monthlyCostTotal, null)
  assert.equal(unavailable.monthlyPurchaseTotal, null)

  const html = renderToStaticMarkup(createElement(loaded.module.HomePage, {
    summary: unavailable,
    currentUser,
    onLogout() {},
    onOpenView() {},
  }))
  assert.equal((html.match(/>待核算</gu) || []).length, 2)
  assert.doesNotMatch(html, /<span class="module-count">¥0<\/span>/u)

  const homeBuilder = sliceBetween(
    appSource,
    'export function buildAuthorizedHomeSummary',
    '\nexport function AuthenticatedApp',
  )
  assert.match(homeBuilder, /financialModels/u)
  assert.doesNotMatch(
    homeBuilder,
    /accountingRecords|getMonthlySalaryPaidTotal|\.reduce\(|repairCost|totalCost/u,
  )
})

test('AuthenticatedApp builds Home shared models only after projecting exact source states', () => {
  const authenticated = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
  const homeFinancialBuilder = sliceBetween(
    appSource,
    'export function buildHomeFinancialModels',
    '\nexport function buildAuthorizedHomeSummary',
  )
  const sourceIndex = authenticated.indexOf('const dashboardSourceStates = {')
  const modelIndex = authenticated.indexOf('const homeFinancialModels = buildHomeFinancialModels({')
  const summaryIndex = authenticated.indexOf('const homeSummary = buildAuthorizedHomeSummary(')

  assert.equal((homeFinancialBuilder.match(/buildCostAccountingReadModel\(/gu) || []).length, 1)
  assert.equal((homeFinancialBuilder.match(/buildPurchaseAccountingReadModel\(/gu) || []).length, 1)
  assert.doesNotMatch(homeFinancialBuilder, /\.reduce\(|accountingRecords/u)
  assert.ok(sourceIndex >= 0)
  assert.ok(modelIndex > sourceIndex)
  assert.ok(summaryIndex > modelIndex)
  assert.match(
    authenticated,
    /buildHomeFinancialModels\(\{[\s\S]*?selectedMonth:\s*currentMonthValue\(\)[\s\S]*?sourceStates:\s*dashboardSourceStates/u,
  )
  assert.match(
    authenticated,
    /bridgeTargetActive\s*=\s*\['home', 'accounting', 'dashboard', 'projects'\]\.includes\(authorizedView\)/u,
  )
  assert.doesNotMatch(authenticated, /const accountingRecords\s*=/u)
})

test('monthly purchase payment facts fail closed until the accrual source is ready', () => {
  assert.ifError(loaded.error)
  const secretPayment = {
    paymentId: 'PAY-SECRET', purchaseId: 'PO-SECRET', paymentDate: `${month}-12`,
    paymentDateSource: 'recorded', paymentDateLegacyInferred: false, jpyAmount: 987654,
  }
  const baseProps = {
    access: {
      salary: false, projectCost: false, operatingExpense: false,
      purchaseAccrual: true, purchasePayments: true,
    },
    vehicleAccess: false,
    sourceStates: {
      projects: ready(projects),
      purchasePayments: ready([secretPayment]),
    },
    monthFilter: month,
    onMonthFilterChange() {},
  }
  const renderAccrual = (purchaseAccrual) => renderToStaticMarkup(createElement(
    loaded.module.MonthlySummarySection,
    {
      ...baseProps,
      sourceStates: { ...baseProps.sourceStates, purchaseAccrual },
    },
  ))

  for (const state of [
    { status: 'loading', data: null, stale: false },
    { status: 'error', data: null, stale: false },
    { status: 'forbidden', data: null, stale: false },
    { status: 'ready', data: [{ ...purchases[0], totalCost: 987654 }], stale: true },
  ]) {
    const html = renderAccrual(state)
    assert.doesNotMatch(
      html,
      /当前采购应付余额|本月采购付款现金流|¥987,654/u,
    )
  }

  const readyHtml = renderToStaticMarkup(createElement(loaded.module.MonthlySummarySection, {
    ...baseProps,
    sourceStates: {
      ...baseProps.sourceStates,
      purchaseAccrual: ready(purchases),
      purchasePayments: ready([{
        paymentId: 'PAY-READY', purchaseId: 'PO1', paymentDate: `${month}-12`,
        paymentDateSource: 'recorded', paymentDateLegacyInferred: false, jpyAmount: 50,
      }]),
    },
  }))
  assert.match(readyHtml, /<strong>¥150<\/strong><span>当前采购应付余额<\/span>/u)
  assert.match(readyHtml, /<strong>¥50<\/strong><span>本月采购付款现金流<\/span>/u)
})

test('dashboard project rows reuse cost-domain lifetime totals and pending classifications', () => {
  const empty = ready([])
  const dashboard = buildExecutiveDashboardReadModel({
    asOfDate: '2026-08-15',
    selectedMonth: month,
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access: {
      page: true, projectSnapshot: true,
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
    },
    sources: {
      projects: ready(projects),
      contractRevenue: ready([{
        projectId: 'P1', adjustedTaxInclusiveAmount: 1100,
        totalReceivedTaxInclusiveAmount: 0, profitAnchorTaxExclusiveAmount: 1000,
      }]),
      receipts: empty,
      laborWindow: ready(laborWindow),
      purchaseAccrual: ready(purchases),
      purchasePayments: empty,
      projectCosts: ready(manualCosts),
      operatingExpenses: ready(operating),
      vehicles: empty,
      vehicleUsage: empty,
      fuel: ready(fuel),
      vehicleExpenses: ready(vehicleExpenses),
      vehicleIssues: ready(vehicleIssues),
      attendance: empty,
      inventoryItems: empty,
      stockInRecords: empty,
      stockOutRecords: empty,
      stockReturnRecords: empty,
      toolRecords: empty,
      toolBorrowRecords: empty,
      toolReturnRecords: empty,
      lifelongToolAssignments: empty,
      toolResponsibilityRecords: empty,
    },
  })
  assert.equal(dashboard.projectRows.status, 'ready')
  assert.equal(dashboard.projectRows.data.items[0].confirmedCost, 480)
  assert.equal(dashboard.projectRows.data.items[0].pendingManualCost, 150)
  assert.equal(dashboard.projectRows.data.items[0].estimatedProfit, 520)
})

test('monthly summary renders only confirmed shared totals and separate pending queues', () => {
  assert.ifError(loaded.error)
  assert.ok(loaded.module?.MonthlySummarySection)
  const sourceStates = {
    projects: ready(projects),
    laborWindow: ready(laborWindow),
    purchaseAccrual: ready(purchases),
    purchasePayments: ready([]),
    projectCosts: ready(manualCosts),
    operatingExpenses: ready(operating),
    fuel: ready(fuel),
    vehicleExpenses: ready(vehicleExpenses),
    vehicleIssues: ready(vehicleIssues),
  }
  const html = renderToStaticMarkup(createElement(loaded.module.MonthlySummarySection, {
    access: {
      salary: true, projectCost: true, operatingExpense: true,
      purchaseAccrual: true, purchasePayments: true,
    },
    vehicleAccess: true,
    sourceStates,
    monthFilter: month,
    onMonthFilterChange() {},
  }))

  assert.match(html, /<strong>¥500<\/strong><span>公司总成本<\/span>/u)
  for (const label of [
    '待核算手工人工费', '待核算手工材料费', '待核算手工工具费',
    '待核算手工车辆费', '待核算维修估算',
  ]) assert.match(html, new RegExp(label, 'u'))
  assert.doesNotMatch(html, /<strong>¥650<\/strong><span>公司总成本<\/span>/u)
})

test('monthly summary publishes no project-related zero while the project source is unavailable', () => {
  assert.ifError(loaded.error)
  const sourceStates = {
    projects: ready(projects),
    laborWindow: ready(laborWindow),
    purchaseAccrual: ready(purchases),
    purchasePayments: ready([]),
    projectCosts: ready(manualCosts),
    operatingExpenses: ready(operating),
    fuel: ready(fuel),
    vehicleExpenses: ready(vehicleExpenses),
    vehicleIssues: ready(vehicleIssues),
  }
  const renderProjectState = (projectState) => renderToStaticMarkup(createElement(
    loaded.module.MonthlySummarySection,
    {
      access: {
        salary: true, projectCost: true, operatingExpense: true,
        purchaseAccrual: true, purchasePayments: true,
      },
      vehicleAccess: true,
      sourceStates: { ...sourceStates, projects: projectState },
      monthFilter: month,
      onMonthFilterChange() {},
    },
  ))

  for (const [state, expectedNotice] of [
    [{ status: 'loading', data: null }, '成本数据正在加载'],
    [{ status: 'ready', data: projects, stale: true }, '成本数据正在加载'],
    [{ status: 'error', data: null }, '成本数据暂不可用'],
    [{ status: 'forbidden', data: null }, ''],
  ]) {
    const html = renderProjectState(state)
    if (expectedNotice) assert.match(html, new RegExp(expectedNotice, 'u'))
    assert.doesNotMatch(
      html,
      /<span>公司总成本<\/span>|本月采购确认成本|车辆费用合计|已确认项目补充成本|经营费用合计|待核算手工材料费/u,
    )
  }

  const readyHtml = renderProjectState(ready(projects))
  assert.match(readyHtml, /<strong>¥500<\/strong><span>公司总成本<\/span>/u)
  assert.match(readyHtml, /待核算手工材料费/u)
})

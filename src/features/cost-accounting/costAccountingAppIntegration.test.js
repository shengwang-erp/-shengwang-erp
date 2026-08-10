import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { flushSync } from 'react-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'
import ExcelJS from 'exceljs'

import { buildCostAccountingReadModel } from './costAccountingDomain.js'
import { buildExecutiveDashboardReadModel } from '../executive-dashboard/executiveDashboardDomain.js'
import { buildPurchaseAccountingReadModel } from '../purchase-accounting/purchaseAccountingDomain.js'
import { createProjectCostWorkbook } from '../project-cost-ledger/projectCostLedgerExport.js'
import { installWarehouseReactDom } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

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
    configFile: false,
    cacheDir: '/private/tmp/task5-cost-accounting-vite-cache',
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
    const module = await server.ssrLoadModule('/src/App.jsx')
    const printModule = await server.ssrLoadModule(
      '/src/features/project-cost-ledger/ProjectCostPrintSheet.jsx',
    )
    return { module, ProjectCostPrintSheet: printModule.default, error: null }
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

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
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

function accountingLedgerSnapshot({ amount = 250.125, description = '会计调整后的仓库材料' } = {}) {
  const adjustmentAmount = 50.125
  const originalAmount = Math.round((amount - adjustmentAmount) * 10000) / 10000
  const allocations = [{ projectId: 'P1', amount }]
  return {
    status: 'ready', generatedAt: '2026-08-15T01:00:00.000Z', page: 1, pageSize: 100,
    totalRows: 1, totalAmount: amount, adjustmentTotal: adjustmentAmount,
    incompleteSources: [], categoryTotals: [{ category: '材料费', amount }],
    rows: [{
      sourceKey: 'warehouse:ACCOUNTING', sourceModule: 'warehouse',
      sourceDocumentType: 'warehouse_stock_out', sourceDocumentId: 'ACCOUNTING',
      projectId: 'P1', projectName: '共享成本项目', category: '材料费', date: '2026-08-11',
      description, originalAmount, adjustmentAmount,
      effectiveAmount: amount, operator: '会计甲', adjusted: true, version: 2,
      allocations, auditEvents: [],
    }],
  }
}

const loaded = await loadAppModule()

function ProjectLedgerSummaryProbe(props) {
  const state = loaded.module.useProjectLedgerSummaryLifecycle(props)
  props.capture?.(state)
  return createElement('output', null,
    `${state.status}:${state.data?.rows?.[0]?.description || ''}`)
}

const summaryAccess = {
  salary: true, projectCost: true, operatingExpense: true,
  purchaseAccrual: true, purchasePayments: true,
}

const owner = {
  id: 'owner-summary', employeeId: 'E-SUMMARY', employeeNumber: 'SW-000', name: '会计社长',
  department: '总务部', position: '社长', employmentStatus: '在职', accountStatus: 'active',
  mustChangePassword: false, effectivePermissionKeys: ['all'],
}

function ProjectLedgerConsumerProbe(props) {
  const projectLedgerSummary = loaded.module.useProjectLedgerSummaryLifecycle(props)
  props.capture?.(projectLedgerSummary)
  const sourceStates = {
    projects: ready(projects), laborWindow: ready(laborWindow),
    purchaseAccrual: ready(purchases), purchaseLedgerAccrual: ready(purchases),
    purchasePayments: ready([]), projectCosts: ready(manualCosts),
    operatingExpenses: ready(operating), fuel: ready(fuel),
    vehicleExpenses: ready(vehicleExpenses), vehicleIssues: ready(vehicleIssues),
    projectLedgerSummary,
  }
  const home = loaded.module.buildHomeFinancialModels({
    currentUser: owner, selectedMonth: month, sourceStates,
  })
  return createElement('div', null,
    createElement(loaded.module.MonthlySummarySection, {
      access: summaryAccess, vehicleAccess: true, sourceStates,
      monthFilter: month, onMonthFilterChange() {},
    }),
    createElement('output', { 'data-kind': 'home-cost' },
      `home:${home.cost.status}:${home.cost.data?.companyMonthlyTotal?.total ?? ''}`),
  )
}

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

test('project ledger accounting summary is actor-isolated and never refills from a late account', async () => {
  assert.ifError(loaded.error)
  assert.equal(typeof loaded.module.useProjectLedgerSummaryLifecycle, 'function')
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const first = deferred()
  const second = deferred()
  let calls = 0
  let actorAInvalidate = null
  let currentInvalidate = null
  const access = { view: true, readLedger: true }
  try {
    await act(async () => { root.render(createElement(ProjectLedgerSummaryProbe, {
      service: { list() { calls += 1; return first.promise } },
      access, actorFingerprint: 'actor-a', onAuthInvalid() {},
      capture(state) { actorAInvalidate = state.invalidate },
    })) })
    assert.equal(calls, 1)
    assert.match(container.textContent, /loading:/u)

    await act(async () => { flushSync(() => { root.render(createElement(ProjectLedgerSummaryProbe, {
      service: { list() { calls += 1; return second.promise } },
      access, actorFingerprint: 'actor-b', onAuthInvalid() {},
      capture(state) { currentInvalidate = state.invalidate },
    })) }) })
    assert.equal(calls, 2)
    assert.doesNotMatch(container.textContent, /会计调整后的仓库材料/u)

    second.resolve({
      ...accountingLedgerSnapshot(),
      rows: [{ ...accountingLedgerSnapshot().rows[0], description: '新账号账本' }],
    })
    await act(async () => {})
    assert.match(container.textContent, /ready:新账号账本/u)

    first.resolve({
      ...accountingLedgerSnapshot(),
      rows: [{ ...accountingLedgerSnapshot().rows[0], description: '旧账号机密' }],
    })
    await act(async () => {})
    assert.match(container.textContent, /ready:新账号账本/u)
    assert.doesNotMatch(container.textContent, /旧账号机密/u)
    assert.equal(actorAInvalidate(), false)
    assert.equal(calls, 2)
    assert.equal(typeof currentInvalidate, 'function')

    const callsBeforeDenied = calls
    await act(async () => { flushSync(() => { root.render(createElement(ProjectLedgerSummaryProbe, {
      service: { list() { calls += 1; return Promise.resolve(accountingLedgerSnapshot()) } },
      access: { view: false, readLedger: false }, actorFingerprint: 'actor-b-denied',
      onAuthInvalid() {},
    })) }) })
    assert.equal(calls, callsBeforeDenied)
    assert.match(container.textContent, /forbidden:/u)
    assert.doesNotMatch(container.textContent, /新账号账本/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('one actor-safe invalidation path refreshes both monthly and Home consumers for mutations and source changes', async () => {
  assert.ifError(loaded.error)
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const first = deferred()
  const mutation = deferred()
  const sourceChange = deferred()
  const pending = [first, mutation, sourceChange]
  const service = {
    list() {
      const request = pending.shift()
      assert.ok(request, 'unexpected duplicate project ledger summary load')
      return request.promise
    },
  }
  const access = { view: true, readLedger: true }
  const sourceA = {}
  const sourceB = {}
  let latestState = null
  const props = (sourceFingerprint) => ({
    service, access, actorFingerprint: 'actor-refresh', sourceFingerprint,
    onAuthInvalid() {}, capture(state) { latestState = state },
  })
  try {
    await act(async () => { root.render(createElement(ProjectLedgerConsumerProbe, props(sourceA))) })
    assert.match(container.textContent, /项目成本明细账正在加载/u)
    assert.match(container.textContent, /home:loading:/u)

    first.resolve(accountingLedgerSnapshot({ amount: 250.125, description: '初始账本' }))
    await act(async () => {})
    assert.match(container.textContent, /¥350\.125/u)
    assert.match(container.textContent, /home:ready:350\.125/u)
    assert.equal(typeof latestState.invalidate, 'function')

    await act(async () => { latestState.invalidate() })
    assert.match(container.textContent, /项目成本明细账正在加载/u)
    assert.doesNotMatch(container.textContent, /¥350\.125|home:ready:350\.125/u)
    mutation.resolve(accountingLedgerSnapshot({ amount: 400, description: '调整后账本' }))
    await act(async () => {})
    assert.match(container.textContent, /¥500/u)
    assert.match(container.textContent, /home:ready:500/u)

    await act(async () => { root.render(createElement(ProjectLedgerConsumerProbe, props(sourceB))) })
    assert.match(container.textContent, /项目成本明细账正在加载/u)
    assert.doesNotMatch(container.textContent, /home:ready:500/u)
    sourceChange.resolve(accountingLedgerSnapshot({ amount: 450, description: '来源更新账本' }))
    await act(async () => {})
    assert.match(container.textContent, /¥550/u)
    assert.match(container.textContent, /home:ready:550/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
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
    /const projectReferenceAccess = getProjectReferenceAccess\(currentUser\)[\s\S]*?const projectRelationReadAccess = projectReferenceAccess\.view/u,
  )
  assert.match(
    authenticated,
    /useProjectDirectoryLifecycle\(\{[\s\S]*?service: projectService,[\s\S]*?access: projectReferenceAccess/u,
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

test('App normalization preserves authoritative warehouse accounting provenance', () => {
  const purchaseNormalizer = sliceBetween(
    appSource,
    'function normalizePurchaseRecord',
    '\nfunction normalizePurchasePaymentRecord',
  )
  const costNormalizer = sliceBetween(
    appSource,
    'function normalizeProjectCostRecord',
    '\nfunction normalizeOperatingExpenseRecord',
  )
  assert.doesNotMatch(purchaseNormalizer, /warehouseTracked/u)
  for (const field of [
    'sourceType', 'sourceDocumentId', 'sourceDocumentType',
    'sourcePurchaseRecordKeys', 'sourceStockOutIds',
  ]) {
    assert.match(costNormalizer, new RegExp(field, 'u'))
  }
})

test('authoritative warehouse context filters only the shared cost purchase source', () => {
  assert.ifError(loaded.error)
  const warehouseCost = {
    costRecordId: 'WAREHOUSE-SO:11111111-1111-4111-8111-111111111111',
    projectId: 'P1', projectName: '共享成本项目', costType: '材料费',
    amount: 460, date: `${month}-09`, sourceType: 'warehouse',
    sourceDocumentId: '11111111-1111-4111-8111-111111111111',
    sourceDocumentType: 'warehouse_stock_out',
    sourcePurchaseRecordKeys: ['PO-WAREHOUSE'],
    sourceStockOutIds: ['11111111-1111-4111-8111-111111111111'],
  }
  const sources = loaded.module.buildWarehouseAccountingSourceStates({
    purchaseLedgerAccrual: ready([
      { purchaseId: 'PO-WAREHOUSE', projectId: 'P1', totalCost: 1000 },
      { purchaseId: 'PO-DIRECT', projectId: 'P1', totalCost: 25 },
    ]),
    projectCosts: ready([warehouseCost]),
    warehouseContext: ready({ trackedPurchaseRecordKeys: ['PO-WAREHOUSE'] }),
  })
  assert.deepEqual(sources.purchaseLedgerAccrual.data.map((row) => row.purchaseId), [
    'PO-WAREHOUSE', 'PO-DIRECT',
  ])
  assert.deepEqual(sources.purchaseAccrual.data.map((row) => row.purchaseId), ['PO-DIRECT'])
  assert.equal(sources.projectCosts.data[0].sourceType, 'warehouse')

  const unavailable = loaded.module.buildWarehouseAccountingSourceStates({
    purchaseLedgerAccrual: ready([{ purchaseId: 'PO-WAREHOUSE', totalCost: 1000 }]),
    projectCosts: ready([warehouseCost]),
    warehouseContext: { status: 'error', data: null, stale: false },
  })
  assert.equal(unavailable.purchaseAccrual.status, 'error')
  assert.equal(unavailable.purchaseAccrual.data, null)
  assert.equal(unavailable.purchaseLedgerAccrual.status, 'ready')
})

test('warehouse context cannot cross an authenticated actor switch', () => {
  assert.ifError(loaded.error)
  const previous = {
    status: 'ready',
    data: { trackedPurchaseRecordKeys: ['PO-OLD'] },
    stale: false,
    actorKey: 'employee-old',
  }
  assert.equal(
    loaded.module.bindWarehouseContextToActor(previous, 'employee-old').status,
    'ready',
  )
  const switched = loaded.module.bindWarehouseContextToActor(previous, 'employee-new')
  assert.equal(switched.status, 'loading')
  assert.equal(switched.data, null)
})

test('warehouse-managed project costs render read-only in the generic project-cost list', () => {
  assert.ifError(loaded.error)
  const html = renderToStaticMarkup(createElement(loaded.module.ProjectCostSection, {
    access: { view: true, create: false, update: true, delete: true },
    projects,
    employees: [],
    records: [
      {
        costRecordId: 'WAREHOUSE-SO:11111111-1111-4111-8111-111111111111',
        projectId: 'P1', projectName: '共享成本项目', costType: '材料费',
        amount: 460, date: `${month}-09`, sourceType: 'warehouse',
      },
      {
        costRecordId: 'MANUAL-1', projectId: 'P1', projectName: '共享成本项目',
        costType: '外包费', amount: 20, date: `${month}-09`, sourceType: 'manual',
      },
    ],
    setRecords() {},
  }))
  assert.equal((html.match(/>编辑<\/button>/gu) || []).length, 1)
  assert.equal((html.match(/>删除<\/button>/gu) || []).length, 1)
  assert.match(html, /仓库自动成本仅能通过仓库冲销更正/u)
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
    /buildHomeFinancialModels\(\{[\s\S]*?selectedMonth:\s*currentMonthValue\(\)[\s\S]*?sourceStates:\s*accountingSourceStates/u,
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
  const renderAccrual = (purchaseLedgerAccrual) => renderToStaticMarkup(createElement(
    loaded.module.MonthlySummarySection,
    {
      ...baseProps,
      sourceStates: { ...baseProps.sourceStates, purchaseLedgerAccrual },
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
      purchaseLedgerAccrual: ready(purchases),
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
      profitabilityPurchaseAccrual: ready(purchases),
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
    purchaseLedgerAccrual: ready(purchases),
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

test('monthly accounting consumes the ready unified ledger once and blocks stale legacy fallback', () => {
  assert.ifError(loaded.error)
  const snapshot = accountingLedgerSnapshot()
  const sourceStates = {
    projects: ready(projects), laborWindow: ready(laborWindow),
    purchaseAccrual: ready(purchases), purchaseLedgerAccrual: ready(purchases),
    purchasePayments: ready([]), projectCosts: ready(manualCosts),
    operatingExpenses: ready(operating), fuel: ready(fuel),
    vehicleExpenses: ready(vehicleExpenses), vehicleIssues: ready(vehicleIssues),
    projectLedgerSummary: ready(snapshot),
  }
  const props = {
    access: {
      salary: true, projectCost: true, operatingExpense: true,
      purchaseAccrual: true, purchasePayments: true,
    },
    vehicleAccess: true, sourceStates, monthFilter: month, onMonthFilterChange() {},
  }
  const html = renderToStaticMarkup(createElement(loaded.module.MonthlySummarySection, props))

  assert.match(html, /<strong>¥350\.125<\/strong><span>公司总成本<\/span>/u)
  assert.doesNotMatch(html, /<strong>¥500<\/strong><span>公司总成本<\/span>/u)

  const incomplete = renderToStaticMarkup(createElement(loaded.module.MonthlySummarySection, {
    ...props,
    sourceStates: {
      ...sourceStates,
      projectLedgerSummary: { status: 'loading', data: null, stale: false },
    },
  }))
  assert.match(incomplete, /项目成本明细账正在加载/u)
  assert.doesNotMatch(incomplete, />成本数据正在加载</u)
  assert.doesNotMatch(incomplete, /公司经营费用（不含项目）/u)
  assert.doesNotMatch(incomplete, /<span>公司总成本<\/span>/u)

  const partial = renderToStaticMarkup(createElement(loaded.module.MonthlySummarySection, {
    ...props,
    sourceStates: {
      ...sourceStates,
      projectLedgerSummary: ready({
        ...snapshot,
        incompleteSources: ['仓库出库'],
      }),
      operatingExpenses: ready([
        ...operating,
        {
          expenseRecordId: 'OE-COMPANY', projectId: '', allocateToProject: false,
          amount: 75, date: '2026-08-12', expenseType: '办公室租金',
        },
      ]),
    },
  }))
  assert.match(partial, /项目成本明细账数据不完整/u)
  assert.match(partial, /<strong>¥75<\/strong><span>公司经营费用（不含项目）<\/span>/u)
  assert.doesNotMatch(partial, /<span>公司总成本<\/span>/u)
})

test('accounting, print and Excel consume the same fixed-point project ledger total', () => {
  const snapshot = accountingLedgerSnapshot()
  const model = buildCostAccountingReadModel({
    ...costInput,
    projectLedgerSummary: { status: 'ready', data: snapshot },
  })
  const auditSnapshot = {
    status: 'ready', generatedAt: snapshot.generatedAt,
    events: [{
      eventType: 'adjustment', sourceKey: 'warehouse:ACCOUNTING', sequenceNo: 1,
      amountBefore: 200, amountAfter: 250.125, adjustmentAmount: 50.125,
      allocationsBefore: null, allocationsAfter: null, reason: '发票差额',
      actorName: '会计甲', createdAt: snapshot.generatedAt,
    }],
  }
  const workbook = createProjectCostWorkbook(ExcelJS, snapshot, auditSnapshot, {
    companyName: '生旺株式会社', projectName: '共享成本项目', dateRange: '2026-08',
    generatedAt: snapshot.generatedAt,
  })
  const summarySheet = workbook.getWorksheet('分类汇总')
  const excelTotal = summarySheet.getRows(1, summarySheet.rowCount)
    .find((row) => row.getCell(1).value === '项目总计').getCell(2).value.result
  assert.ifError(loaded.error)
  const printHtml = renderToStaticMarkup(createElement(loaded.ProjectCostPrintSheet, {
    ledgerSnapshot: snapshot,
    auditSnapshot,
    metadata: {
      companyName: '生旺株式会社', projectName: '共享成本项目', dateRange: '2026-08',
      generatedAt: snapshot.generatedAt,
    },
  }))

  assert.equal(model.projectLedger.monthlyTotal, 250.125)
  assert.equal(model.projectLedger.monthlyTotal, snapshot.totalAmount)
  assert.equal(excelTotal, snapshot.totalAmount)
  assert.match(printHtml, /￥250\.125/u)
})

test('monthly summary publishes no project-related zero while the project source is unavailable', () => {
  assert.ifError(loaded.error)
  const sourceStates = {
    projects: ready(projects),
    laborWindow: ready(laborWindow),
    purchaseAccrual: ready(purchases),
    purchaseLedgerAccrual: ready(purchases),
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

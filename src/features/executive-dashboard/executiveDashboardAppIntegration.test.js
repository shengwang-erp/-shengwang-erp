import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import { buildMonthWindow } from './dashboardTime.js'

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
      name: 'dashboard-app-leaflet-ssr-stub',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0dashboard-app-leaflet-ssr-stub' : null
      },
      load(id) {
        return id === '\0dashboard-app-leaflet-ssr-stub'
          ? 'export default { icon: () => ({}) }'
          : null
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

const selectedMonth = '2026-08'
const months = buildMonthWindow(selectedMonth, 12)
const projects = [{ projectId: 'P1', projectName: '跨月采购项目', status: '进行中' }]
const purchases = [{
  purchaseId: 'PO-JUL', purchaseDate: '2026-07-10', purchaseSource: '中国采购',
  purchaseType: '材料', itemName: '七月材料', supplierName: '供应商', projectId: 'P1',
  projectName: '跨月采购项目', totalCost: 10000, openingPaidAmount: 0,
  invoiceStatus: '已取得', purchaseStatus: '正常',
}]
const payments = [{
  paymentId: 'PP-AUG', purchaseId: 'PO-JUL', paymentDate: '2026-08-08',
  paymentDateSource: 'recorded', paymentDateLegacyInferred: false,
  paymentMethod: '银行转账', jpyAmount: 3000,
}]
const laborWindow = {
  monthly: months.map((month) => ({
    month, status: 'ready', stale: false, salaryTotal: 0,
    projectLaborTotal: 0, projectLaborById: { P1: 0 }, source: 'formal', pendingCount: 0,
  })),
  projectLaborLifetimeById: { P1: 0 },
  lifetimeStatus: 'ready', lifetimeStale: false, incompleteMonths: [], staleMonths: [],
}

const sources = {
  projects: ready(projects),
  contractRevenue: ready([{
    projectId: 'P1', adjustedTaxInclusiveAmount: 110000,
    totalReceivedTaxInclusiveAmount: 0, profitAnchorTaxExclusiveAmount: 100000,
  }]),
  receipts: ready([]),
  laborWindow: ready(laborWindow),
  purchaseAccrual: ready(purchases),
  purchasePayments: ready(payments),
  projectCosts: ready([]),
  operatingExpenses: ready([]),
  vehicles: ready([]),
  vehicleUsage: ready([]),
  fuel: ready([]),
  vehicleExpenses: ready([]),
  vehicleIssues: ready([]),
  attendance: ready([]),
  inventoryItems: ready([]),
  stockInRecords: ready([]),
  stockOutRecords: ready([]),
  stockReturnRecords: ready([]),
  toolRecords: ready([]),
  toolBorrowRecords: ready([]),
  toolReturnRecords: ready([]),
  lifelongToolAssignments: ready([]),
  toolResponsibilityRecords: ready([]),
}

const dashboardAccess = {
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

const loaded = await loadAppModule()

test('AuthenticatedApp owns validated dashboard filters before requesting the labor window', () => {
  const authenticated = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
  const stateIndex = authenticated.indexOf('const [dashboardQuery, setDashboardQuery]')
  const requestIndex = authenticated.indexOf('laborBridgeLoaderRef.current.load(')
  assert.ok(stateIndex >= 0 && requestIndex > stateIndex)
  assert.match(authenticated, /selectedMonth:\s*currentMonthValue\(\)/u)
  assert.match(authenticated, /projectId:\s*'all'/u)
  assert.match(authenticated, /projectStatus:\s*'all'/u)
  assert.match(authenticated, /rankingMetric:\s*'profit'/u)
  assert.match(authenticated, /page:\s*1/u)
  assert.match(authenticated, /pageSize:\s*10/u)
  assert.match(authenticated, /handleDashboardFiltersChange/u)
  assert.match(authenticated, /scopeChanged[\s\S]*?page:\s*scopeChanged \? 1/u)
  assert.match(authenticated, /isLaborAccountingMonth\(nextFilters\.selectedMonth\)/u)
  assert.match(authenticated, /DASHBOARD_RANKING_METRICS/u)
  assert.match(authenticated, /DASHBOARD_PROJECT_STATUSES/u)
})

test('Dashboard route passes the exact Task 8 source-state map and explicit render context', () => {
  const authenticated = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
  const sourceMap = sliceBetween(
    authenticated,
    'const dashboardSourceStates = {',
    '\n  const bridgeStatusNotice',
  )
  const expectedKeys = [
    'projects', 'contractRevenue', 'receipts', 'laborWindow', 'purchaseAccrual',
    'purchasePayments', 'projectCosts', 'operatingExpenses', 'vehicles',
    'vehicleUsage', 'fuel', 'vehicleExpenses', 'vehicleIssues', 'attendance',
    'inventoryItems', 'stockInRecords', 'stockOutRecords', 'stockReturnRecords',
    'toolRecords', 'toolBorrowRecords', 'toolReturnRecords',
    'lifelongToolAssignments', 'toolResponsibilityRecords',
  ]
  const actualKeys = [...sourceMap.matchAll(/^\s{4}([A-Za-z][A-Za-z0-9]*):/gmu)]
    .map((match) => match[1])
  assert.deepEqual(actualKeys, expectedKeys)
  assert.match(sourceMap, /receipts:[\s\S]*?data:\s*projectReceipts/u)
  assert.match(sourceMap, /purchaseAccrual:[\s\S]*?purchaseRawState/u)
  assert.match(sourceMap, /purchasePayments:[\s\S]*?purchasePaymentRawState/u)
  assert.match(sourceMap, /fuel:[\s\S]*?data:\s*fuelRecords/u)
  assert.match(sourceMap, /vehicleExpenses:[\s\S]*?data:\s*vehicleExpenseRecords/u)
  assert.match(sourceMap, /laborWindow:[\s\S]*?data:\s*dashboardLaborWindow/u)

  const route = sliceBetween(
    authenticated,
    "if (authorizedView === 'dashboard')",
    "\n  if (authorizedView === 'purchase')",
  )
  assert.match(route, /<DashboardPage/u)
  assert.match(route, /asOfDate=\{todayValue\(\)\}/u)
  assert.match(route, /selectedMonth=\{dashboardQuery\.selectedMonth\}/u)
  assert.match(route, /filters=\{dashboardFilters\}/u)
  assert.match(route, /access=\{dashboardAccess\}/u)
  assert.match(route, /sources=\{dashboardSourceStates\}/u)
  assert.match(route, /viewerName=\{currentUser\.name\}/u)
  assert.match(route, /onFiltersChange=\{handleDashboardFiltersChange\}/u)
  assert.match(route, /onNavigate=\{handleDashboardNavigate\}/u)
  assert.doesNotMatch(route, /projects=|purchaseRecords=|laborBridge=|sourceStates=/u)
})

test('DashboardPage is a thin deterministic ExecutiveDashboardPage wrapper', () => {
  const wrapper = sliceBetween(appSource, 'function DashboardPage({', '\nfunction PageShell')
  assert.equal((wrapper.match(/buildExecutiveDashboardReadModel\(/gu) || []).length, 1)
  assert.match(wrapper, /asOfDate,[\s\S]*?selectedMonth,[\s\S]*?filters,[\s\S]*?access,[\s\S]*?sources,/u)
  assert.match(wrapper, /<ExecutiveDashboardPage/u)
  assert.match(wrapper, /model=\{model\}/u)
  assert.match(wrapper, /filters=\{\{ selectedMonth, \.\.\.filters \}\}/u)
  assert.match(wrapper, /viewerName=\{viewerName\}/u)
  assert.match(wrapper, /onFiltersChange=\{onFiltersChange\}/u)
  assert.match(wrapper, /onNavigate=\{onNavigate\}/u)
  assert.doesNotMatch(wrapper, /useState|useEffect|currentMonthValue|new Date/u)
})

test('historical dashboard windows keep current cumulative labor identity isolated', () => {
  const authenticated = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
  assert.match(authenticated, /endMonth:\s*bridgeRequestedMonth/u)
  assert.match(authenticated, /length:\s*12/u)
  assert.match(authenticated, /snapshotMonth:\s*bridgeSnapshotMonth/u)
  assert.match(authenticated, /const bridgeSnapshotMonth = currentMonthValue\(\)/u)
  assert.match(authenticated, /const bridgeActorScope = JSON\.stringify\(\[[\s\S]*?activeActorId[\s\S]*?bridgePermissionFingerprint/u)
  assert.doesNotMatch(
    sliceBetween(authenticated, 'const bridgeActorScope', '\n  const bridgeRequestIdentity'),
    /currentUser\.name|viewerName|employeeName/u,
  )
  assert.match(authenticated, /const abortController = new AbortController\(\)/u)
  assert.match(authenticated, /abortController\.abort\(\)/u)
  assert.match(authenticated, /bridgeRequestIdentityRef\.current !== requestIdentity/u)
  assert.match(authenticated, /laborBridgeLoaderRef\.current\.clear\(previousActorScope\)/u)
})

test('July accrual and August cash render through the shared dashboard and monthly-summary models', () => {
  assert.ifError(loaded.error)
  assert.ok(loaded.module?.DashboardPage)
  assert.ok(loaded.module?.MonthlySummarySection)

  const dashboardHtml = renderToStaticMarkup(createElement(loaded.module.DashboardPage, {
    asOfDate: '2026-08-15',
    selectedMonth,
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access: dashboardAccess,
    sources,
    viewerName: '会计测试员',
    onFiltersChange() {},
    onNavigate() {},
  }))
  const summaryHtml = renderToStaticMarkup(createElement(loaded.module.MonthlySummarySection, {
    access: {
      salary: true, projectCost: true, operatingExpense: true,
      purchaseAccrual: true, purchasePayments: true,
    },
    vehicleAccess: true,
    sourceStates: sources,
    projects,
    monthFilter: selectedMonth,
    onMonthFilterChange() {},
  }))

  assert.match(dashboardHtml, /所选月成本合计/u)
  assert.match(dashboardHtml, /¥0/u)
  assert.match(dashboardHtml, /¥3,000/u)
  assert.match(dashboardHtml, /¥7,000/u)
  assert.match(summaryHtml, /<strong>¥0<\/strong><span>本月采购确认成本<\/span>/u)
  assert.match(summaryHtml, /<strong>¥0<\/strong><span>公司总成本<\/span>/u)
  assert.match(summaryHtml, /<strong>¥3,000<\/strong><span>本月采购付款现金流<\/span>/u)
  assert.match(summaryHtml, /<strong>¥7,000<\/strong><span>当前采购应付余额<\/span>/u)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'
import { getDashboardSourceData } from '../../services/dashboardService.js'
import {
  findWarehouseTestElement,
  installWarehouseReactDom,
  TestEvent,
} from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const DASHBOARD_CURRENT_MONTH = '2026-08'
const DASHBOARD_PRIOR_MONTH = '2026-07'

const appSource = await readFile(new URL('../../App.jsx', import.meta.url), 'utf8')
const componentSource = await readFile(
  new URL('./PurchaseAccountingSection.jsx', import.meta.url),
  'utf8',
).catch(() => '')

async function loadComponent() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return {
      error: null,
      module: await server.ssrLoadModule(
        '/src/features/purchase-accounting/PurchaseAccountingSection.jsx',
      ),
    }
  } catch (error) {
    return { error, module: null }
  } finally {
    await server.close()
  }
}

async function loadAppModule() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    plugins: [{
      name: 'purchase-accounting-leaflet-ssr-stub',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0purchase-accounting-leaflet-ssr-stub' : null
      },
      load(id) {
        if (id !== '\0purchase-accounting-leaflet-ssr-stub') return null
        return 'export default { icon: () => ({}) }'
      },
      transform(code, id) {
        if (!id.endsWith('/src/App.jsx')) return null
        const exported = code
          .replace(
            'function normalizePurchaseRecord(record) {',
            'export function normalizePurchaseRecord(record) {',
          )
          .replace(
            'function normalizeFuelRecord(record) {',
            'export function normalizeFuelRecord(record) {',
          )
          .replace(
            'function normalizeSubmittedFuelRecord(record) {',
            'export function normalizeSubmittedFuelRecord(record) {',
          )
          .replace(
            'function normalizeVehicleExpenseRecord(record) {',
            'export function normalizeVehicleExpenseRecord(record) {',
          )
          .replace(
            'function normalizeSubmittedVehicleExpenseRecord(record) {',
            'export function normalizeSubmittedVehicleExpenseRecord(record) {',
          )
          .replace(
            'function normalizePurchasePaymentRecord(record) {',
            'export function normalizePurchasePaymentRecord(record) {',
          )
          .replace(
            'function normalizeSubmittedPurchasePaymentRecord(record) {',
            'export function normalizeSubmittedPurchasePaymentRecord(record) {',
          )
          .replace(
            'async function commitPurchasePaymentMutation({',
            'export async function commitPurchasePaymentMutation({',
          )
          .replace(
            'function DashboardPage({',
            'export function DashboardPage({',
          )
        return exported
      },
    }],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true },
  })
  try {
    return {
      error: null,
      module: await server.ssrLoadModule('/src/App.jsx'),
    }
  } catch (error) {
    return { error, module: null }
  } finally {
    await server.close()
  }
}

function sliceBetween(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

function assertMarkersInOrder(source, markers) {
  let previousIndex = -1
  for (const marker of markers) {
    const markerIndex = source.indexOf(marker)
    assert.ok(markerIndex > previousIndex, `expected source marker in order: ${marker}`)
    previousIndex = markerIndex
  }
}

const loaded = await loadComponent()
const appLoaded = await loadAppModule()

const projects = [
  { projectId: 'P-1', projectName: '东京站现场' },
  { projectId: 'P-2', projectName: '横滨仓库' },
]

const purchases = [
  {
    purchaseId: 'PO-JUL',
    purchaseDate: '2026-07-10',
    itemName: '电钻',
    supplierName: '上海工具商',
    projectId: 'P-1',
    projectName: '东京站现场',
    purchaseSource: '中国采购',
    totalCost: 10000,
    openingPaidAmount: 0,
    paidAmount: 9000,
    invoiceStatus: '已取得',
    purchaseStatus: '正常',
  },
  {
    purchaseId: 'PO-AUG',
    purchaseDate: '2026-08-03',
    itemName: '安全帽',
    supplierName: 'Amazon Japan',
    projectId: 'P-2',
    projectName: '横滨仓库',
    purchaseSource: 'Amazon',
    totalCost: 5000,
    openingPaidAmount: 2000,
    paidAmount: 2000,
    invoiceStatus: '未取得',
    purchaseStatus: '正常',
  },
]

const payments = [
  {
    paymentId: 'PP-AUG',
    purchaseId: 'PO-JUL',
    paymentDate: '2026-08-08',
    jpyAmount: 3000,
  },
  {
    paymentId: 'PP-ORPHAN',
    purchaseId: 'PO-MISSING',
    paymentDate: '2026-08-09',
    jpyAmount: 500,
  },
]

const reportPurchases = [
  purchases[0],
  {
    ...purchases[1], purchaseId: 'PO-AUG-P1', projectId: 'P-1', projectName: '东京站现场',
    purchaseSource: '中国采购', totalCost: 6000, openingPaidAmount: 0, paidAmount: 0,
  },
  {
    ...purchases[1], purchaseId: 'PO-AUG-P2-CHINA', purchaseSource: '中国采购',
    totalCost: 7000, openingPaidAmount: 0, paidAmount: 0,
  },
  purchases[1],
  {
    ...purchases[1], purchaseId: 'PO-AUG-AMAZON-UNPAID', totalCost: 4000,
    openingPaidAmount: 0, paidAmount: 0,
  },
]

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function button(container, label) {
  return findWarehouseTestElement(container, (element) =>
    element.nodeName === 'BUTTON' && element.textContent.trim() === label)
}

function field(container, label) {
  const wrapper = findWarehouseTestElement(container, (element) =>
    element.nodeName === 'LABEL'
    && element.children.some((child) => child.nodeName === 'SPAN' && child.textContent === label))
  assert.ok(wrapper, `field ${label}`)
  const control = elements(wrapper, (element) => ['INPUT', 'SELECT'].includes(element.nodeName))[0]
  assert.ok(control, `control ${label}`)
  return control
}

async function change(control, value) {
  await act(async () => {
    control.value = value
    control.dispatchEvent(new TestEvent('input'))
    control.dispatchEvent(new TestEvent('change'))
  })
}

function reportDetailRows(report) {
  const details = report.sections.find((section) => section.id === 'purchase-details')
  assert.ok(details)
  return details.rows
}

function PurchaseAccountingHarness({ initialMonth = '', ...props }) {
  const [month, setMonth] = useState(initialMonth)
  return createElement(appLoaded.module.AccountingCostPage, {
    access: {
      salary: { view: false }, projectCost: { view: false }, operatingExpense: { view: false },
      purchaseAccounting: { view: true },
      monthlySummary: {
        salary: false, projectCost: false, operatingExpense: false,
        purchaseAccrual: false, purchasePayments: false,
      },
    },
    projects,
    purchaseRecords: props.purchaseRecords,
    purchasePaymentRecords: props.purchasePaymentRecords,
    purchasePaymentState: props.paymentState,
    sourceStates: { purchaseLedgerAccrual: props.accrualState },
    monthFilter: month,
    onMonthFilterChange: setMonth,
    onBack() {},
    reportPreparedBy: props.reportPreparedBy,
    reportActionDependencies: props.reportActionDependencies,
  })
}

async function mountPurchaseReport(overrides = {}) {
  assert.ifError(appLoaded.error)
  const paymentRecords = overrides.purchasePaymentRecords ?? payments
  const purchaseRecords = overrides.purchaseRecords ?? reportPurchases
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(PurchaseAccountingHarness, {
      initialMonth: '',
      purchaseRecords,
      purchasePaymentRecords: paymentRecords,
      paymentState: { status: 'ready', data: paymentRecords, stale: false },
      accrualState: { status: 'ready', data: purchaseRecords, stale: false },
      reportPreparedBy: '系统管理员',
      ...overrides,
    }))
  })
  return { dom, container, root }
}

async function cleanupMounted(scenario) {
  await act(async () => scenario.root.unmount())
  scenario.dom.cleanup()
}

function renderSection(overrides = {}) {
  assert.ifError(loaded.error)
  assert.ok(loaded.module?.default)
  const paymentRecords = overrides.purchasePaymentRecords ?? payments
  const paymentState = Object.hasOwn(overrides, 'paymentState')
    ? overrides.paymentState
    : { status: 'ready', data: paymentRecords, stale: false }
  const accrualState = Object.hasOwn(overrides, 'accrualState')
    ? overrides.accrualState
    : { status: 'ready', data: overrides.purchaseRecords ?? purchases, stale: false }
  return renderToStaticMarkup(createElement(loaded.module.default, {
    projects,
    purchaseRecords: purchases,
    purchasePaymentRecords: paymentRecords,
    paymentState,
    accrualState,
    monthFilter: '2026-08',
    onMonthFilterChange: () => {},
    ...overrides,
  }))
}

test('renders order cost, payment cash, current payable, and source notice', () => {
  const html = renderSection()

  assert.match(html, /<strong>¥5,000<\/strong><span>本月采购确认成本<\/span>/u)
  assert.match(html, /<strong>¥3,000<\/strong><span>本月已记录付款<\/span>/u)
  assert.match(html, /<strong>¥10,000<\/strong><span>当前未付采购款<\/span>/u)
  assert.match(html, /<strong>¥2,000<\/strong><span>本月初始付款<\/span>/u)
  assert.match(html, /<strong>1<\/strong><span>未取得发票数量<\/span>/u)
  assert.match(html, /<strong>1<\/strong><span>异常付款数量<\/span>/u)
  assert.match(html, /数据来源：采购管理/u)
})

test('missing, stale, or forbidden accrual state fails closed before rendering purchase facts', () => {
  for (const accrualState of [
    undefined,
    { status: 'ready', data: purchases, stale: true },
    { status: 'forbidden', data: null, stale: false },
  ]) {
    const html = renderSection({ accrualState })
    assert.doesNotMatch(html, /PO-JUL|PO-AUG|本月采购确认成本/u)
    assert.match(html, /采购成本数据(?:正在加载|暂不可用|当前不可见)/u)
  }
})

test('renders read-only filters, anomaly guidance, and purchase detail rows', () => {
  const html = renderSection()

  for (const label of ['统计月份', '项目', '数据来源', '付款状态']) {
    assert.match(html, new RegExp(label, 'u'))
  }
  for (const heading of [
    '采购编号',
    '日期',
    '商品',
    '供应商',
    '项目',
    '采购成本',
    '已付',
    '未付',
    '付款状态',
    '发票状态',
  ]) {
    assert.match(html, new RegExp(`<th>${heading}</th>`, 'u'))
  }

  assert.match(html, /PO-AUG/u)
  assert.doesNotMatch(html, /PO-JUL/u)
  assert.match(html, /孤立付款/u)
  assert.doesNotMatch(html, /采购付款缓存与流水不一致/u)
  assert.match(html, /采购数据更正请前往采购管理/u)
  assert.doesNotMatch(html, /保存|删除/u)

  for (const className of [
    'filter-panel',
    'field',
    'stats-grid',
    'stat-card',
    'payment-table-wrap',
    'payment-table',
    'empty-state',
    'cost-note',
  ]) {
    assert.match(componentSource, new RegExp(className, 'u'))
  }
})

test('shows project-allocation health without counting it as a payment anomaly', () => {
  const html = renderSection({
    purchaseRecords: [purchases[1], {
      ...purchases[0],
      purchaseId: 'PO-MISSING-PROJECT',
      purchasePurpose: '项目使用',
      projectId: '',
      projectName: '',
      paidAmount: 0,
    }],
    purchasePaymentRecords: [],
  })

  assert.match(html, /项目使用采购未绑定项目/u)
  assert.match(html, /<strong>0<\/strong><span>异常付款数量<\/span>/u)
})

test('renders an empty detail state without mutation controls', () => {
  const html = renderSection({
    projects,
    purchaseRecords: [],
    purchasePaymentRecords: [],
  })

  assert.match(html, /暂无采购对账明细/u)
  assert.doesNotMatch(html, /保存|删除/u)
})

test('forbidden payment state renders accrual only and exposes no payable inference', () => {
  const redactedPurchase = {
    purchaseId: 'PO-ACCRUAL-ONLY',
    purchaseDate: '2026-08-03',
    itemName: '仅应计材料',
    supplierName: '合规供应商',
    projectId: 'P-2',
    projectName: '横滨仓库',
    purchaseSource: 'Amazon',
    totalCost: 80000,
    invoiceStatus: '未取得',
    purchaseStatus: '正常',
  }
  const html = renderSection({
    purchaseRecords: [redactedPurchase],
    purchasePaymentRecords: [{
      paymentId: 'PP-MUST-NOT-BE-USED',
      purchaseId: redactedPurchase.purchaseId,
      paymentDate: '2026-08-04',
      jpyAmount: 80000,
    }],
    paymentState: { status: 'forbidden', data: null },
  })

  assert.match(html, /<strong>¥80,000<\/strong><span>本月采购确认成本<\/span>/u)
  assert.match(html, /仅应计材料/u)
  assert.match(html, /采购成本/u)
  assert.doesNotMatch(html, /本月已记录付款|本月初始付款|当前未付采购款|异常付款数量/u)
  assert.doesNotMatch(html, /付款状态|<th>已付<\/th>|<th>未付<\/th>|全部状态/u)
  assert.doesNotMatch(html, /legacy_opening_payment|旧采购初始付款|全部未付/u)
  assert.doesNotMatch(html, /PP-MUST-NOT-BE-USED/u)
})

test('missing or stale payment state fails closed without payment-derived UI', () => {
  for (const paymentState of [undefined, {
    status: 'ready', data: payments, stale: true,
  }]) {
    const html = renderSection({ paymentState })
    assert.doesNotMatch(
      html,
      /付款状态|本月已记录付款|当前未付采购款|本月初始付款|异常付款数量/u,
    )
    assert.doesNotMatch(html, /¥3,000/u)
  }
})

test('ready purchase actions export the actually rendered month, project, source, and payment-status result', async () => {
  let capturedReport
  const scenario = await mountPurchaseReport({
    reportActionDependencies: {
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    for (const label of ['导出 Excel', '导出 PDF', '打印']) assert.ok(button(scenario.container, label))
    assert.equal(elements(scenario.container, (element) => element.nodeName === 'TBODY')[0].children.length, 5)

    await change(field(scenario.container, '统计月份'), '2026-08')
    assert.equal(elements(scenario.container, (element) => element.nodeName === 'TBODY')[0].children.length, 4)
    await change(field(scenario.container, '项目'), 'P-2')
    assert.equal(elements(scenario.container, (element) => element.nodeName === 'TBODY')[0].children.length, 3)
    await change(field(scenario.container, '数据来源'), 'Amazon')
    assert.equal(elements(scenario.container, (element) => element.nodeName === 'TBODY')[0].children.length, 2)
    await change(field(scenario.container, '付款状态'), '部分付款')
    const visibleRows = elements(scenario.container, (element) => element.nodeName === 'TBODY')[0].children
    assert.equal(visibleRows.length, 1)
    assert.match(visibleRows[0].textContent, /PO-AUG/u)
    assert.doesNotMatch(visibleRows[0].textContent, /PO-AUG-AMAZON-UNPAID/u)

    await act(async () => button(scenario.container, '导出 Excel').click())
    assert.ok(capturedReport, 'injected Excel action captures the real report')
    assert.equal(capturedReport.preparedBy, '系统管理员')
    assert.deepEqual(capturedReport.filterLines, [
      { label: '统计月份', value: '2026-08' },
      { label: '项目', value: '横滨仓库' },
      { label: '数据来源', value: 'Amazon' },
      { label: '付款状态', value: '部分付款' },
    ])
    assert.deepEqual(reportDetailRows(capturedReport).map((row) => row.purchaseId), ['PO-AUG'])
    assert.deepEqual(capturedReport.summary, [
      { label: '采购成本', value: 9000, format: 'money' },
      { label: '付款现金', value: 0, format: 'money' },
      { label: '未付余额', value: 7000, format: 'money' },
      { label: '缺少发票', value: 2, format: 'number' },
      { label: '异常数量', value: 1, format: 'number' },
    ])
    assert.deepEqual(
      capturedReport.sections.find((section) => section.id === 'purchase-anomalies').rows,
      [{ anomaly: '孤立付款（找不到对应采购单）：PP-ORPHAN（采购 PO-MISSING）' }],
    )
  } finally {
    await cleanupMounted(scenario)
  }
})

test('purchase exports remain available for ready accrual while omitting payment fields for an unavailable payment source', async () => {
  let capturedReport
  const scenario = await mountPurchaseReport({
    initialMonth: '2026-08',
    paymentState: { status: 'forbidden', data: null, stale: false },
    reportActionDependencies: {
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    assert.ok(button(scenario.container, '导出 Excel'))
    assert.equal(field(scenario.container, '统计月份').value, '2026-08')
    assert.equal(elements(scenario.container, (element) =>
      element.nodeName === 'LABEL' && element.textContent.includes('付款状态')).length, 0)
    await act(async () => button(scenario.container, '导出 Excel').click())
    assert.ok(capturedReport)
    const details = capturedReport.sections.find((section) => section.id === 'purchase-details')
    assert.ok(details)
    assert.deepEqual(details.columns.map((column) => column.label), [
      '采购编号', '日期', '商品', '供应商', '项目', '采购来源', '采购成本', '发票状态',
    ])
    assert.equal(details.rows.some((row) =>
      Object.hasOwn(row, 'paidAmount')
      || Object.hasOwn(row, 'unpaidAmount')
      || Object.hasOwn(row, 'paymentStatus')), false)
  } finally {
    await cleanupMounted(scenario)
  }
})

test('loading, error, and forbidden accrual states expose no report action', () => {
  for (const status of ['loading', 'error', 'forbidden']) {
    const html = renderSection({ accrualState: { status, data: null, stale: false } })
    assert.doesNotMatch(html, /导出 Excel|导出 PDF|打印/u)
  }
})

test('AuthenticatedApp purchase normalization preserves the opening snapshot for ledger-derived accounting', () => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.normalizePurchaseRecord)

  const rawPurchase = {
    purchaseId: 'PO-NORMALIZED',
    purchaseDate: '2026-07-10',
    purchaseSource: '中国采购',
    purchaseType: '材料',
    itemName: '标准化采购',
    quantity: 1,
    unitPrice: 10000,
    currency: 'JPY',
    projectId: 'P-1',
    projectName: '东京站现场',
    paidAmount: 9999,
    unpaidAmount: 1,
    purchaseStatus: '正常',
  }
  const normalizedPurchase = appLoaded.module.normalizePurchaseRecord({
    ...rawPurchase,
    openingPaidAmount: 0,
  })
  const normalizedOpeningPurchase = appLoaded.module.normalizePurchaseRecord({
    ...rawPurchase,
    purchaseId: 'PO-OPENING',
    openingPaidAmount: 2000.4,
  })
  const maxSafeOpeningPurchase = appLoaded.module.normalizePurchaseRecord({
    ...rawPurchase,
    purchaseId: 'PO-MAX-SAFE',
    openingPaidAmount: Number.MAX_SAFE_INTEGER,
  })
  const legacyPurchase = appLoaded.module.normalizePurchaseRecord({
    ...rawPurchase,
    purchaseId: 'PO-LEGACY',
  })

  assert.equal(normalizedPurchase.openingPaidAmount, 0)
  assert.equal(normalizedOpeningPurchase.openingPaidAmount, 2000)
  assert.equal(maxSafeOpeningPurchase.openingPaidAmount, Number.MAX_SAFE_INTEGER)
  assert.equal(normalizedPurchase.paidAmount, 9999)
  assert.equal(normalizedPurchase.unpaidAmount, 1)
  assert.equal(Object.hasOwn(legacyPurchase, 'openingPaidAmount'), false)
  for (const [label, openingPaidAmount] of [
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
    ['infinity', Number.POSITIVE_INFINITY],
    ['negative', -1],
    ['fractional negative', -0.4],
    ['blank', '   '],
  ]) {
    const normalized = appLoaded.module.normalizePurchaseRecord({
      ...rawPurchase,
      purchaseId: `PO-${label}`,
      openingPaidAmount,
    })
    assert.equal(
      Object.hasOwn(normalized, 'openingPaidAmount'),
      false,
      `${label} opening snapshot must stay absent`,
    )
  }

  const html = renderSection({
    purchaseRecords: [{ ...normalizedPurchase, purchaseDate: '2026-08-01' }],
    purchasePaymentRecords: [{
      paymentId: 'PP-NORMALIZED',
      purchaseId: 'PO-NORMALIZED',
      paymentDate: '2026-08-08',
      jpyAmount: 3000,
    }],
  })

  assert.match(html, /<strong>¥3,000<\/strong><span>本月已记录付款<\/span>/u)
  assert.match(html, /<strong>¥7,000<\/strong><span>当前未付采购款<\/span>/u)
  assert.match(
    html,
    /<td>¥10,000<\/td><td>¥3,000<\/td><td>¥7,000<\/td><td>部分付款<\/td>/u,
  )
})

test('purchase payment mutation orchestration executes durable writes before local state', async (t) => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.commitPurchasePaymentMutation)
  const commitMutation = appLoaded.module.commitPurchasePaymentMutation
  const purchaseToSave = { purchaseId: 'PO-ORCHESTRATION' }
  const nextPurchaseRecords = [purchaseToSave]
  const nextPaymentRecords = [{ paymentId: 'PP-ORCHESTRATION' }]
  const cloudStateOptions = { stateOnly: true, syncLocal: true }

  await t.test('non-ready payment source blocks every durable and local mutation', async () => {
    const events = []
    const committed = await commitMutation({
      paymentReady: false,
      purchaseToSave,
      persistPurchase: async () => { events.push('purchase') },
      persistLedger: async () => { events.push('ledger') },
      nextPurchaseRecords,
      nextPaymentRecords,
      setPurchaseRecords: () => { events.push('purchase-state') },
      setPaymentRecords: () => { events.push('payment-state') },
      onPersistenceError: () => { events.push('error') },
      demoMode: false,
    })

    assert.equal(committed, false)
    assert.deepEqual(events, [])
  })

  await t.test('success awaits purchase then ledger before both local commits', async () => {
    const events = []
    const purchaseStateCalls = []
    const paymentStateCalls = []
    const committed = await commitMutation({
      paymentReady: true,
      purchaseToSave,
      persistPurchase: async (purchase) => {
        assert.equal(purchase, purchaseToSave)
        events.push('purchase:start')
        await Promise.resolve()
        events.push('purchase:end')
      },
      persistLedger: async () => { events.push('ledger') },
      nextPurchaseRecords,
      nextPaymentRecords,
      setPurchaseRecords: (...args) => {
        events.push('purchase-state')
        purchaseStateCalls.push(args)
      },
      setPaymentRecords: (...args) => {
        events.push('payment-state')
        paymentStateCalls.push(args)
      },
      onPersistenceError: (error) => { throw error },
      demoMode: false,
    })

    assert.equal(committed, true)
    assert.deepEqual(events, [
      'purchase:start',
      'purchase:end',
      'ledger',
      'purchase-state',
      'payment-state',
    ])
    assert.deepEqual(purchaseStateCalls, [[nextPurchaseRecords, cloudStateOptions]])
    assert.deepEqual(paymentStateCalls, [[nextPaymentRecords, cloudStateOptions]])
  })

  await t.test('first durable rejection reports the error without ledger or local state', async () => {
    const failure = new Error('purchase failed')
    const events = []
    const committed = await commitMutation({
      paymentReady: true,
      purchaseToSave,
      persistPurchase: async () => {
        events.push('purchase')
        throw failure
      },
      persistLedger: async () => { events.push('ledger') },
      nextPurchaseRecords,
      nextPaymentRecords,
      setPurchaseRecords: () => { events.push('purchase-state') },
      setPaymentRecords: () => { events.push('payment-state') },
      onPersistenceError: (error) => {
        assert.equal(error, failure)
        events.push('error')
      },
      demoMode: false,
    })

    assert.equal(committed, false)
    assert.deepEqual(events, ['purchase', 'error'])
  })

  await t.test('second durable rejection keeps both local states untouched', async () => {
    const failure = new Error('ledger failed')
    const events = []
    const committed = await commitMutation({
      paymentReady: true,
      purchaseToSave,
      persistPurchase: async () => { events.push('purchase') },
      persistLedger: async () => {
        events.push('ledger')
        throw failure
      },
      nextPurchaseRecords,
      nextPaymentRecords,
      setPurchaseRecords: () => { events.push('purchase-state') },
      setPaymentRecords: () => { events.push('payment-state') },
      onPersistenceError: (error) => {
        assert.equal(error, failure)
        events.push('error')
      },
      demoMode: false,
    })

    assert.equal(committed, false)
    assert.deepEqual(events, ['purchase', 'ledger', 'error'])
  })

  await t.test('orphan deletion skips purchase persistence but still commits the ledger', async () => {
    const events = []
    const committed = await commitMutation({
      paymentReady: true,
      purchaseToSave: undefined,
      persistPurchase: async () => { events.push('purchase') },
      persistLedger: async () => { events.push('ledger') },
      nextPurchaseRecords,
      nextPaymentRecords,
      setPurchaseRecords: (_records, options) => {
        assert.deepEqual(options, cloudStateOptions)
        events.push('purchase-state')
      },
      setPaymentRecords: (_records, options) => {
        assert.deepEqual(options, cloudStateOptions)
        events.push('payment-state')
      },
      onPersistenceError: (error) => { throw error },
      demoMode: false,
    })

    assert.equal(committed, true)
    assert.deepEqual(events, ['ledger', 'purchase-state', 'payment-state'])
  })

  await t.test('local demo skips durable writes and uses ordinary setter options', async () => {
    const events = []
    const committed = await commitMutation({
      paymentReady: true,
      purchaseToSave,
      persistPurchase: async () => { events.push('purchase') },
      persistLedger: async () => { events.push('ledger') },
      nextPurchaseRecords,
      nextPaymentRecords,
      setPurchaseRecords: (records, options) => {
        assert.equal(records, nextPurchaseRecords)
        assert.deepEqual(options, {})
        events.push('purchase-state')
      },
      setPaymentRecords: (records, options) => {
        assert.equal(records, nextPaymentRecords)
        assert.deepEqual(options, {})
        events.push('payment-state')
      },
      onPersistenceError: (error) => { throw error },
      demoMode: true,
    })

    assert.equal(committed, true)
    assert.deepEqual(events, ['purchase-state', 'payment-state'])
  })
})

test('App cash normalizers preserve loaded provenance and fail closed for null records', () => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.normalizeFuelRecord)
  assert.ok(appLoaded.module?.normalizeVehicleExpenseRecord)
  assert.ok(appLoaded.module?.normalizePurchasePaymentRecord)

  const defaultedFuel = appLoaded.module.normalizeFuelRecord({
    fuelDate: '2026-07-16',
    fuelDateSource: 'defaulted',
    paymentMethod: '现金',
    paymentMethodSource: 'defaulted',
  })
  const legacyExpense = appLoaded.module.normalizeVehicleExpenseRecord({
    expenseDate: '2026-07-15',
    paymentMethod: '公司账户',
  })
  const legacyPayment = appLoaded.module.normalizePurchasePaymentRecord({
    paymentDate: '2026-07-14',
    paymentAmount: 1000,
    currency: 'JPY',
  })
  const safeFuel = appLoaded.module.normalizeFuelRecord(null)
  const safeExpense = appLoaded.module.normalizeVehicleExpenseRecord(null)
  const safePayment = appLoaded.module.normalizePurchasePaymentRecord(null)

  assert.equal(defaultedFuel.fuelDateSource, 'defaulted')
  assert.equal(defaultedFuel.paymentMethodSource, 'defaulted')
  assert.equal(legacyExpense.expenseDateSource, 'recorded')
  assert.equal(legacyExpense.expenseDateLegacyInferred, true)
  assert.equal(legacyExpense.paymentMethodSource, 'recorded')
  assert.equal(legacyExpense.paymentMethodLegacyInferred, true)
  assert.equal(legacyPayment.paymentDateSource, 'recorded')
  assert.equal(legacyPayment.paymentDateLegacyInferred, true)
  assert.equal(safeFuel.fuelDateSource, 'defaulted')
  assert.equal(safeFuel.paymentMethodSource, 'defaulted')
  assert.equal(safeExpense.expenseDateSource, 'defaulted')
  assert.equal(safeExpense.paymentMethodSource, 'defaulted')
  assert.equal(safePayment.paymentDateSource, 'defaulted')
})

test('submitted cash record builders execute recorded and defaulted provenance', () => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.normalizeSubmittedFuelRecord)
  assert.ok(appLoaded.module?.normalizeSubmittedVehicleExpenseRecord)
  assert.ok(appLoaded.module?.normalizeSubmittedPurchasePaymentRecord)

  const purchase = appLoaded.module.normalizeSubmittedPurchasePaymentRecord({
    paymentDate: ' 2026-07-14 ',
    paymentAmount: 1000,
    currency: 'JPY',
  })
  const invalidPurchase = appLoaded.module.normalizeSubmittedPurchasePaymentRecord({
    paymentDate: '2026-02-31',
    paymentAmount: 1000,
    currency: 'JPY',
  })
  const fuel = appLoaded.module.normalizeSubmittedFuelRecord({
    fuelDate: '2026-07-15',
    paymentMethod: '现金',
  })
  const fuelWithoutMethod = appLoaded.module.normalizeSubmittedFuelRecord({
    fuelDate: '2026-07-15',
    paymentMethod: '',
  })
  const expense = appLoaded.module.normalizeSubmittedVehicleExpenseRecord({
    expenseDate: '2026-07-16',
    paymentMethod: '公司账户',
  })
  const expenseWithoutDate = appLoaded.module.normalizeSubmittedVehicleExpenseRecord({
    expenseDate: '',
    paymentMethod: '公司账户',
  })

  assert.equal(purchase.paymentDate, '2026-07-14')
  assert.equal(purchase.paymentDateSource, 'recorded')
  assert.equal(purchase.paymentDateLegacyInferred, false)
  assert.equal(invalidPurchase.paymentDateSource, 'defaulted')
  assert.equal(fuel.fuelDateSource, 'recorded')
  assert.equal(fuel.paymentMethodSource, 'recorded')
  assert.equal(fuel.fuelDateLegacyInferred, false)
  assert.equal(fuel.paymentMethodLegacyInferred, false)
  assert.equal(fuelWithoutMethod.paymentMethodSource, 'defaulted')
  assert.equal(expense.expenseDateSource, 'recorded')
  assert.equal(expense.paymentMethodSource, 'recorded')
  assert.equal(expense.expenseDateLegacyInferred, false)
  assert.equal(expense.paymentMethodLegacyInferred, false)
  assert.equal(expenseWithoutDate.expenseDateSource, 'defaulted')

  const fuelSection = sliceBetween(
    appSource,
    'function VehicleFuelSection',
    '\nfunction VehicleExpenseSection',
  )
  const expenseSection = sliceBetween(
    appSource,
    'function VehicleExpenseSection',
    '\nfunction VehicleIssueSection',
  )
  const paymentSection = sliceBetween(
    appSource,
    'function PurchasePaymentSection',
    '\nfunction PurchaseSummarySection',
  )

  assert.match(
    appSource,
    /from '.\/features\/cost-accounting\/cashFactProvenance\.js'/u,
  )
  assert.match(
    fuelSection,
    /const record = normalizeSubmittedFuelRecord\(\{/u,
  )
  assert.match(
    expenseSection,
    /const record = normalizeSubmittedVehicleExpenseRecord\(\{/u,
  )
  assert.match(
    paymentSection,
    /const payment = normalizeSubmittedPurchasePaymentRecord\(\{/u,
  )
})

test('purchase payment App handlers guard and reconcile add/delete before saving the ledger', () => {
  const purchaseForm = sliceBetween(
    appSource,
    'function PurchaseFormSection',
    '\nfunction PurchaseListSection',
  )
  const paymentSection = sliceBetween(
    appSource,
    'function PurchasePaymentSection',
    '\nfunction PurchaseSummarySection',
  )
  const mutationHelper = sliceBetween(
    appSource,
    'async function commitPurchasePaymentMutation({',
    '\nfunction PurchasePaymentSection',
  )
  const authenticatedApp = sliceBetween(
    appSource,
    'function AuthenticatedApp',
    '\nfunction BusinessPage',
  )
  const purchaseManagementPage = sliceBetween(
    appSource,
    'function PurchaseManagementPage',
    '\nfunction PurchaseFormSection',
  )
  const submitHandler = sliceBetween(
    paymentSection,
    '  const handleSubmit = ',
    '\n\n  return (',
  )
  const deleteHandler = sliceBetween(
    paymentSection,
    '        onDelete={',
    '\n        }}\n      />',
  )
  const purchaseSetter = sliceBetween(
    appSource,
    '  const setPurchaseRecords = ',
    '\n  const setPurchasePaymentRecords = ',
  )
  const paymentSetter = sliceBetween(
    appSource,
    '  const setPurchasePaymentRecords = ',
    '\n  const purchaseStateOnlyOptions = ',
  )
  const persistentState = sliceBetween(
    appSource,
    'function usePersistentState',
    '\nfunction nextId',
  )
  const stateOnlyBranch = sliceBetween(
    persistentState,
    '      if (updateOptions.stateOnly)',
    '\n\n      if (cloudPersistence',
  )
  const baseRecordImport = appSource.match(
    /import \{[^}]*\} from '\.\/services\/baseRecordService'/u,
  )?.[0] || ''
  const purchaseManagementOpeningTag = authenticatedApp.match(
    /<PurchaseManagementPage\b[\s\S]*?\/>/u,
  )?.[0]
  const paymentSectionOpeningTag = purchaseManagementPage.match(
    /<PurchasePaymentSection\b[\s\S]*?\/>/u,
  )?.[0]

  assert.ok(
    appSource.includes(
      "import {\n  buildPurchaseAccountingReadModel,\n  canApplyPurchasePayment,\n  recalculatePurchasePaymentCache,\n} from './features/purchase-accounting/purchaseAccountingDomain.js'",
    ),
  )
  assert.match(baseRecordImport, /\bsoftDelete\b/u)
  assert.match(baseRecordImport, /\bupsertRecord\b/u)
  assert.match(purchaseSetter, /setStoredPurchaseRecords\([\s\S]*?, updateOptions\)/u)
  assert.match(paymentSetter, /setStoredPurchasePaymentRecords\([\s\S]*?, updateOptions\)/u)
  assert.match(stateOnlyBranch, /updateOptions\.syncLocal/u)
  assert.match(stateOnlyBranch, /window\.localStorage\.setItem\(key, JSON\.stringify\(resolvedValue\)\)/u)
  assert.doesNotMatch(stateOnlyBranch, /saveList/u)
  assert.ok(purchaseManagementOpeningTag)
  assert.match(purchaseManagementOpeningTag, /onPersistenceError=\{setPersistenceFailure\}/u)
  assert.ok(paymentSectionOpeningTag)
  assert.match(paymentSectionOpeningTag, /onPersistenceError=\{onPersistenceError\}/u)
  assert.match(purchaseForm, /openingPaidAmount:\s*amountPreview\.paidAmount,/u)
  assert.match(
    paymentSection,
    /const activePurchases = purchaseRecords\.filter\(\s*\(record\) =>\s*record\.purchaseStatus !== '作废' &&\s*typeof record\.purchaseId === 'string' &&\s*record\.purchaseId\.trim\(\) !== '',?\s*\)/u,
  )
  assert.doesNotMatch(mutationHelper, /canApplyPurchasePayment|recalculatePurchasePaymentCache/u)
  assert.match(
    submitHandler,
    /^  const handleSubmit = async \(event\) => \{/u,
  )
  assert.match(
    submitHandler,
    /if \(!selectedPurchase\) \{\s*window\.alert\('请选择采购记录'\)\s*return\s*\}/u,
  )
  assert.match(
    submitHandler,
    /if \(!canApplyPurchasePayment\(selectedPurchase, records, payment\.jpyAmount\)\) \{\s*window\.alert\('付款金额必须为有效正数，且不能超过当前未付款金额'\)\s*return\s*\}/u,
  )
  assert.match(submitHandler, /const nextPayments = \[payment, \.\.\.records\]/u)
  assert.match(submitHandler, /const nextPurchases = purchaseRecords\.map/u)
  assert.match(
    submitHandler,
    /recalculatePurchasePaymentCache\(\s*record,\s*nextPayments,\s*\{ previousPayments: records \},\s*\)/u,
  )
  assert.equal((submitHandler.match(/updatedAt: todayValue\(\)/gu) || []).length, 1)
  assert.match(submitHandler, /const committed = await commitPurchasePaymentMutation\(\{/u)
  assert.match(
    submitHandler,
    /persistPurchase:\s*\(purchase\) =>\s*persistPurchase\?\.\(purchase\) \|\| purchaseService\.update\(purchase\.purchaseId, purchase\)/u,
  )
  assert.match(
    submitHandler,
    /persistLedger:\s*\(\) =>\s*purchaseService\.upsertPayment\(payment\)/u,
  )
  assert.match(
    submitHandler,
    /nextPurchaseRecords:\s*nextPurchases[\s\S]*?nextPaymentRecords:\s*nextPayments[\s\S]*?setPaymentRecords:\s*setRecords[\s\S]*?demoMode:\s*localDemoMode/u,
  )
  assert.match(submitHandler, /if \(!committed\) return\s*setForm\(createEmptyPurchasePaymentForm\(\)\)/u)
  assertMarkersInOrder(submitHandler, [
    'canApplyPurchasePayment(selectedPurchase, records, payment.jpyAmount)',
    'const nextPayments = [payment, ...records]',
    'recalculatePurchasePaymentCache(',
    'const committed = await commitPurchasePaymentMutation({',
    'persistPurchase:',
    'persistLedger:',
    'if (!committed) return',
    'setForm(createEmptyPurchasePaymentForm())',
  ])

  assert.match(deleteHandler, /^        onDelete=\{async \(record\) => \{/u)
  assert.match(
    deleteHandler,
    /const remainingPayments = records\.filter\(\s*\(item\) => item\.paymentId !== record\.paymentId,?\s*\)/u,
  )
  assert.match(
    deleteHandler,
    /recalculatePurchasePaymentCache\(\s*purchase,\s*remainingPayments,\s*\{ previousPayments: records \},\s*\)/u,
  )
  assert.equal((deleteHandler.match(/updatedAt: todayValue\(\)/gu) || []).length, 1)
  assert.match(deleteHandler, /await commitPurchasePaymentMutation\(\{/u)
  assert.match(
    deleteHandler,
    /persistPurchase:\s*\(purchase\) =>\s*persistPurchase\?\.\(purchase\) \|\| purchaseService\.update\(purchase\.purchaseId, purchase\)/u,
  )
  assert.match(
    deleteHandler,
    /persistLedger:\s*\(\) =>\s*purchaseService\.softDeletePayment\(record\.paymentId\)/u,
  )
  assert.match(
    deleteHandler,
    /nextPurchaseRecords:\s*nextPurchases[\s\S]*?nextPaymentRecords:\s*remainingPayments[\s\S]*?setPaymentRecords:\s*setRecords[\s\S]*?demoMode:\s*localDemoMode/u,
  )
  assertMarkersInOrder(deleteHandler, [
    'const remainingPayments = records.filter(',
    'recalculatePurchasePaymentCache(',
    'await commitPurchasePaymentMutation({',
    'persistPurchase:',
    'persistLedger:',
  ])
})

test('monthly summary executes cross-month purchase accounting without adding payment cash to company cost', () => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.MonthlySummarySection)

  const summaryPayments = [
    payments[0],
    {
      paymentId: 'PP-VOID',
      purchaseId: 'PO-VOID',
      paymentDate: '2026-08-13',
      jpyAmount: 1000,
    },
  ]
  const summaryPurchases = [
    purchases[0],
    purchases[1],
    {
      ...purchases[0],
      purchaseId: 'PO-VOID',
      purchaseDate: '2026-08-12',
      totalCost: 7000,
      purchaseStatus: '作废',
    },
  ]
  const summaryProjectCosts = [
    { costRecordId: 'PC-1', date: '2026-08-10', costType: '材料费', amount: 4000 },
  ]
  const summaryOperatingExpenses = [
    { expenseRecordId: 'OE-1', date: '2026-08-11', amount: 2000 },
  ]
  const summaryFuel = [
    {
      fuelRecordId: 'FR-1', fuelDate: '2026-08-14', fuelAmount: 500,
      fuelDateSource: 'recorded', fuelDateLegacyInferred: false,
      paymentMethod: '现金', paymentMethodSource: 'recorded', paymentMethodLegacyInferred: false,
    },
  ]
  const summaryVehicleExpenses = [
    {
      vehicleExpenseId: 'VE-1', expenseDate: '2026-08-15', expenseType: '停车费', amount: 300,
      expenseDateSource: 'recorded', expenseDateLegacyInferred: false,
      paymentMethod: '现金', paymentMethodSource: 'recorded', paymentMethodLegacyInferred: false,
    },
  ]
  const summaryVehicleIssues = [
    { issueId: 'VI-1', issueDate: '2026-08-16', repairCost: 200 },
  ]
  const ready = (data) => ({ status: 'ready', data, stale: false })
  const summaryLaborWindow = {
    monthly: [{
      month: '2026-08', status: 'ready', stale: false, salaryTotal: 0,
      projectLaborTotal: 0, projectLaborById: {}, source: 'formal', pendingCount: 0,
    }],
    projectLaborLifetimeById: {}, lifetimeStatus: 'ready', lifetimeStale: false,
    incompleteMonths: [], staleMonths: [],
  }
  const html = renderToStaticMarkup(createElement(appLoaded.module.MonthlySummarySection, {
    access: {
      salary: true,
      projectCost: true,
      operatingExpense: true,
      purchaseAccrual: true,
      purchasePayments: true,
    },
    vehicleAccess: true,
    sourceStates: {
      projects: ready([]),
      laborWindow: ready(summaryLaborWindow),
      projectCosts: ready(summaryProjectCosts),
      operatingExpenses: ready(summaryOperatingExpenses),
      purchaseAccrual: ready(summaryPurchases),
      purchaseLedgerAccrual: ready(summaryPurchases),
      purchasePayments: ready(summaryPayments),
      fuel: ready(summaryFuel),
      vehicleExpenses: ready(summaryVehicleExpenses),
      vehicleIssues: ready(summaryVehicleIssues),
    },
    monthFilter: '2026-08',
    onMonthFilterChange: () => {},
  }))

  assert.match(html, /<strong>¥5,000<\/strong><span>本月采购确认成本<\/span>/u)
  assert.match(html, /<strong>¥3,000<\/strong><span>本月采购付款现金流<\/span>/u)
  assert.match(html, /<strong>¥10,000<\/strong><span>当前采购应付余额<\/span>/u)
  assert.match(html, /<strong>¥0<\/strong><span>中国采购金额<\/span>/u)
  assert.match(html, /<strong>¥5,000<\/strong><span>Amazon 采购金额<\/span>/u)
  assert.match(html, /<strong>¥7,800<\/strong><span>公司总成本<\/span>/u)
  assert.match(html, /待核算手工材料费/u)
  assert.match(html, /待核算维修估算/u)
})

test('App wires the purchase accounting tab and payment ledger through monthly summary', () => {
  const authenticatedApp = sliceBetween(
    appSource,
    'function AuthenticatedApp',
    '\nfunction BusinessPage',
  )
  const accountingPage = sliceBetween(
    appSource,
    'function AccountingCostPage',
    '\nfunction SalaryRecordsSection',
  )
  const monthlySummary = sliceBetween(
    appSource,
    'function MonthlySummarySection',
    '\nfunction AccountingRecordList',
  )
  const projectCostSection = sliceBetween(
    appSource,
    'function ProjectCostSection',
    '\nfunction OperatingExpenseSection',
  )

  assert.match(
    appSource,
    /import PurchaseAccountingSection from '.\/features\/purchase-accounting\/PurchaseAccountingSection\.jsx'/u,
  )
  assert.match(authenticatedApp, /<AccountingCostPage[\s\S]*?purchasePaymentRecords=\{purchasePaymentRecords\}/u)
  assert.match(accountingPage, /\{ id: 'purchaseAccounting', title: '采购对账' \}/u)
  assert.match(
    accountingPage,
    /<PurchaseAccountingSection[\s\S]*?purchaseRecords=\{purchaseRecords\}[\s\S]*?purchasePaymentRecords=\{purchasePaymentRecords\}[\s\S]*?monthFilter=\{monthFilter\}[\s\S]*?onMonthFilterChange=\{onMonthFilterChange\}/u,
  )
  assert.match(
    accountingPage,
    /<MonthlySummarySection[\s\S]*?sourceStates=\{sourceStates\}/u,
  )
  assert.doesNotMatch(
    sliceBetween(accountingPage, '<MonthlySummarySection', '/>'),
    /projects=\{projects\}/u,
  )
  assert.match(
    monthlySummary,
    /const purchaseAccounting = purchaseLedgerAccrualState\.status === 'ready'[\s\S]*?\? buildPurchaseAccountingReadModel\(\{[\s\S]*?purchaseRecords:\s*purchaseLedgerAccrualState\.data,[\s\S]*?paymentRecords:\s*purchasePaymentState\.data \|\| \[\],[\s\S]*?paymentState:\s*purchasePaymentState[\s\S]*?month:\s*monthFilter[\s\S]*?: null/u,
  )
  assert.match(
    monthlySummary,
    /const purchasePaymentVisible = purchaseLedgerAccrualState\.status === 'ready' &&[\s\S]*?purchasePaymentState\.status === 'ready'/u,
  )
  assert.match(
    monthlySummary,
    /const monthlyPurchases = purchaseAccounting[\s\S]*?\? purchaseAccounting\.rows\.filter/u,
  )
  assert.match(
    monthlySummary,
    /const totalPurchaseCost = purchaseAccounting\?\.summary\.monthPurchaseCost/u,
  )
  assert.match(
    monthlySummary,
    /const unpaidPurchaseCost = purchaseAccounting\?\.summary\.currentOutstanding/u,
  )
  assert.match(
    monthlySummary,
    /const monthPaymentCash = purchaseAccounting\?\.summary\.monthPaymentCash/u,
  )
  assert.doesNotMatch(monthlySummary, /record\.paidAmount|const paidPurchaseCost/u)
  assert.match(monthlySummary, /采购确认成本/u)
  assert.match(monthlySummary, /采购付款现金流/u)
  assert.match(
    projectCostSection,
    /采购成本已由采购管理自动归集[^。]*不得重复手工录入/u,
  )

  assert.equal((monthlySummary.match(/buildCostAccountingReadModel\(/gu) || []).length, 1)
  assert.match(monthlySummary, /costModel\.companyMonthlyTotal/u)
  assert.doesNotMatch(monthlySummary, /companyMonthlyTotal[\s\S]*?monthPaymentCash\s*\+/u)
})

test('owner dashboard executes shared purchase rows for cross-month cash, payable, and project profit', async () => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.DashboardPage)
  assert.ok(appLoaded.module?.normalizePurchaseRecord)

  const normalizedDashboardPurchases = [
    appLoaded.module.normalizePurchaseRecord({
      purchaseId: 'PO-DASH',
      purchaseDate: `${DASHBOARD_PRIOR_MONTH}-10`,
      projectId: 'P-DASH',
      projectName: '跨月付款项目',
      purchaseSource: '中国采购',
      purchaseType: '材料',
      itemName: '跨月材料',
      quantity: 1,
      unitPrice: 10000,
      currency: 'JPY',
      totalCost: 10000,
      openingPaidAmount: 0,
      paidAmount: 9999,
      unpaidAmount: 1,
      purchaseStatus: '正常',
    }),
  ]

  assert.equal(normalizedDashboardPurchases[0].openingPaidAmount, 0)

  const source = await getDashboardSourceData({
    employees: [],
    projects: [{
      projectId: 'P-DASH',
      projectName: '跨月付款项目',
      address: '东京',
      status: '进行中',
      startDate: `${DASHBOARD_PRIOR_MONTH}-01`,
      endDate: '',
      profitAnchorTaxExclusiveAmount: 100000,
      adjustedTaxInclusiveAmount: 110000,
      totalReceivedTaxInclusiveAmount: 40000,
      outstandingTaxInclusiveAmount: 70000,
      paymentStatus: '部分付款',
    }],
    laborRecords: [],
    purchaseRecords: normalizedDashboardPurchases,
    purchasePaymentRecords: [
      {
        paymentId: 'PP-DASH',
        purchaseId: 'PO-DASH',
        paymentDate: `${DASHBOARD_CURRENT_MONTH}-08`,
        paymentDateSource: 'recorded',
        paymentDateLegacyInferred: false,
        paymentMethod: '银行转账',
        jpyAmount: 3000,
      },
      {
        paymentId: 'PP-ORPHAN-DASH',
        purchaseId: 'PO-MISSING',
        paymentDate: `${DASHBOARD_CURRENT_MONTH}-09`,
        jpyAmount: 500,
      },
    ],
    inventoryItems: [],
    vehicleUsageRecords: [],
    lifelongToolAssignments: [],
    toolResponsibilityRecords: [],
    load: async () => { throw new Error('unexpected persistence read') },
  })
  const ready = (data) => ({ status: 'ready', data, stale: false })
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
  const dashboardSources = {
    projects: ready(source.projects),
    contractRevenue: ready(source.projects),
    receipts: ready([]),
    laborWindow: ready({
      monthly: [
        '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
        '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
      ].map((month) => ({
        month, status: 'ready', stale: false, salaryTotal: 0,
        projectLaborTotal: 0, projectLaborById: { 'P-DASH': 0 },
        source: 'formal', pendingCount: 0,
      })),
      projectLaborLifetimeById: { 'P-DASH': 0 }, lifetimeStatus: 'ready',
      lifetimeStale: false, incompleteMonths: [], staleMonths: [],
    }),
    purchaseAccrual: ready(source.purchaseRecords),
    profitabilityPurchaseAccrual: ready(source.purchaseRecords),
    purchasePayments: ready(source.purchasePaymentRecords),
    projectCosts: ready([]),
    operatingExpenses: ready([]),
    vehicles: ready([]),
    vehicleUsage: ready(source.vehicleUsageRecords),
    fuel: ready([]),
    vehicleExpenses: ready([]),
    vehicleIssues: ready([]),
    attendance: ready(source.laborRecords),
    inventoryItems: ready(source.inventoryItems),
    stockInRecords: ready([]),
    stockOutRecords: ready([]),
    stockReturnRecords: ready([]),
    toolRecords: ready([]),
    toolBorrowRecords: ready([]),
    toolReturnRecords: ready([]),
    lifelongToolAssignments: ready(source.lifelongToolAssignments),
    toolResponsibilityRecords: ready(source.toolResponsibilityRecords),
  }

  const html = renderToStaticMarkup(createElement(appLoaded.module.DashboardPage, {
    asOfDate: '2026-08-15',
    selectedMonth: DASHBOARD_CURRENT_MONTH,
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access: dashboardAccess,
    sources: dashboardSources,
    viewerName: '采购会计',
    onFiltersChange: () => {},
    onNavigate: () => {},
  }))

  assert.match(html, /所选月成本合计/u)
  assert.match(html, /¥0/u)
  assert.match(html, /¥3,000/u)
  assert.match(html, /¥7,000/u)
  assert.match(html, /¥10,000/u)
  assert.match(html, /¥90,000/u)
  assert.match(html, /项目经营明细/u)
})

test('AuthenticatedApp wires separate purchase accrual and payment states into the owner dashboard', () => {
  const authenticatedApp = sliceBetween(
    appSource,
    'function AuthenticatedApp',
    '\nfunction BusinessPage',
  )
  const dashboardPage = sliceBetween(
    appSource,
    'function DashboardPage',
    '\nfunction PageShell',
  )
  const dashboardOpeningTag = authenticatedApp.match(/<DashboardPage\b[\s\S]*?\/>/u)?.[0]

  assert.ok(dashboardOpeningTag, 'expected one DashboardPage opening tag')
  assert.match(dashboardOpeningTag, /\bsources=\{dashboardSourceStates\}/u)
  assert.match(dashboardOpeningTag, /\bselectedMonth=\{dashboardQuery\.selectedMonth\}/u)
  assert.equal(
    (dashboardPage.match(/buildExecutiveDashboardReadModel\(/gu) || []).length,
    1,
  )
  assert.match(
    authenticatedApp,
    /const purchaseLedgerAccrualSource = projectPersistentSource\(purchaseRawState,[\s\S]*?data:\s*purchaseRecords/u,
  )
  assert.match(
    authenticatedApp,
    /purchasePayments:\s*projectPersistentSource\(purchasePaymentRawState,[\s\S]*?data:\s*purchasePaymentRecords/u,
  )
  assert.doesNotMatch(dashboardPage, /purchaseRecords|purchasePaymentRecords|currentMonthValue/u)
})

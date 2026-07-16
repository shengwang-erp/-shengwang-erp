import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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

function renderSection(overrides = {}) {
  assert.ifError(loaded.error)
  assert.ok(loaded.module?.default)
  return renderToStaticMarkup(createElement(loaded.module.default, {
    projects,
    purchaseRecords: purchases,
    purchasePaymentRecords: payments,
    monthFilter: '2026-08',
    onMonthFilterChange: () => {},
    ...overrides,
  }))
}

test('renders order cost, payment cash, current payable, and source notice', () => {
  const html = renderSection()

  assert.match(html, /<strong>¥5,000<\/strong><span>本月采购确认成本<\/span>/u)
  assert.match(html, /<strong>¥3,000<\/strong><span>本月采购付款<\/span>/u)
  assert.match(html, /<strong>¥10,000<\/strong><span>当前采购应付余额<\/span>/u)
  assert.match(html, /<strong>¥2,000<\/strong><span>本月初始付款<\/span>/u)
  assert.match(html, /<strong>1<\/strong><span>未取得发票数量<\/span>/u)
  assert.match(html, /<strong>1<\/strong><span>异常付款数量<\/span>/u)
  assert.match(html, /数据来源：采购管理/u)
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

  assert.match(html, /PO-JUL/u)
  assert.match(html, /PO-AUG/u)
  assert.match(html, /孤立付款/u)
  assert.match(html, /采购数据更正请前往采购管理/u)
  assert.doesNotMatch(html, /<button|保存|删除/u)

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

test('renders an empty detail state without mutation controls', () => {
  const html = renderSection({
    projects: [],
    purchaseRecords: [],
    purchasePaymentRecords: [],
  })

  assert.match(html, /暂无采购对账明细/u)
  assert.doesNotMatch(html, /<button|保存|删除/u)
})

test('monthly summary executes cross-month purchase accounting without adding payment cash to company cost', () => {
  assert.ifError(appLoaded.error)
  assert.ok(appLoaded.module?.MonthlySummarySection)

  const html = renderToStaticMarkup(createElement(appLoaded.module.MonthlySummarySection, {
    salaryRecords: [],
    employees: [],
    laborRecords: [],
    projectCostRecords: [
      { costRecordId: 'PC-1', date: '2026-08-10', costType: '材料费', amount: 4000 },
    ],
    operatingExpenseRecords: [
      { expenseRecordId: 'OE-1', date: '2026-08-11', amount: 2000 },
    ],
    purchaseRecords: [
      purchases[0],
      purchases[1],
      {
        ...purchases[0],
        purchaseId: 'PO-VOID',
        purchaseDate: '2026-08-12',
        totalCost: 7000,
        purchaseStatus: '作废',
      },
    ],
    purchasePaymentRecords: [
      payments[0],
      {
        paymentId: 'PP-VOID',
        purchaseId: 'PO-VOID',
        paymentDate: '2026-08-13',
        jpyAmount: 1000,
      },
    ],
    fuelRecords: [
      { fuelRecordId: 'FR-1', fuelDate: '2026-08-14', fuelAmount: 500 },
    ],
    vehicleExpenseRecords: [
      { vehicleExpenseId: 'VE-1', expenseDate: '2026-08-15', expenseType: '停车费', amount: 300 },
    ],
    vehicleIssueRecords: [
      { vehicleIssueId: 'VI-1', issueDate: '2026-08-16', repairCost: 200 },
    ],
    monthFilter: '2026-08',
    onMonthFilterChange: () => {},
    laborBridge: null,
  }))

  assert.match(html, /<strong>¥5,000<\/strong><span>本月采购确认成本<\/span>/u)
  assert.match(html, /<strong>¥3,000<\/strong><span>本月采购付款现金流<\/span>/u)
  assert.match(html, /<strong>¥10,000<\/strong><span>当前采购应付余额<\/span>/u)
  assert.match(html, /<strong>¥0<\/strong><span>中国采购金额<\/span>/u)
  assert.match(html, /<strong>¥5,000<\/strong><span>Amazon 采购金额<\/span>/u)
  assert.match(html, /<strong>¥12,000<\/strong><span>公司总成本<\/span>/u)
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
    /<MonthlySummarySection[\s\S]*?purchasePaymentRecords=\{purchasePaymentRecords\}/u,
  )
  assert.match(
    monthlySummary,
    /buildPurchaseAccountingReadModel\(\{[\s\S]*?purchaseRecords,[\s\S]*?paymentRecords:\s*purchasePaymentRecords,[\s\S]*?month:\s*monthFilter/u,
  )
  assert.match(
    monthlySummary,
    /const monthlyPurchases = purchaseAccounting\.rows\.filter/u,
  )
  assert.match(
    monthlySummary,
    /const totalPurchaseCost = purchaseAccounting\.summary\.monthPurchaseCost/u,
  )
  assert.match(
    monthlySummary,
    /const unpaidPurchaseCost = purchaseAccounting\.summary\.currentOutstanding/u,
  )
  assert.match(
    monthlySummary,
    /const monthPaymentCash = purchaseAccounting\.summary\.monthPaymentCash/u,
  )
  assert.doesNotMatch(monthlySummary, /record\.paidAmount|const paidPurchaseCost/u)
  assert.match(monthlySummary, /采购确认成本/u)
  assert.match(monthlySummary, /采购付款现金流/u)
  assert.match(
    projectCostSection,
    /采购成本已由采购管理自动归集[^。]*不得重复手工录入/u,
  )

  const totalCostCalculation = sliceBetween(monthlySummary, 'const totalCost =', '\n\n  return (')
  assert.equal((totalCostCalculation.match(/totalPurchaseCost/gu) || []).length, 1)
  assert.doesNotMatch(totalCostCalculation, /monthPaymentCash/u)
})

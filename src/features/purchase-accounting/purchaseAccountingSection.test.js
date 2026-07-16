import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'
import { getDashboardSourceData } from '../../services/dashboardService.js'

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
            'function DashboardPage({',
            'export function DashboardPage({',
          )
        const currentMonthNeedle =
          '  const currentMonth = currentMonthValue()\n  const purchaseAccounting = useMemo('
        assert.ok(
          exported.includes(currentMonthNeedle),
          'expected DashboardPage current-month marker',
        )
        return exported.replace(
          currentMonthNeedle,
          `  const currentMonth = '${DASHBOARD_CURRENT_MONTH}'\n  const purchaseAccounting = useMemo(`,
        )
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
    openingPaidAmount: 2000,
  })
  const legacyPurchase = appLoaded.module.normalizePurchaseRecord({
    ...rawPurchase,
    purchaseId: 'PO-LEGACY',
  })

  assert.equal(normalizedPurchase.openingPaidAmount, 0)
  assert.equal(normalizedOpeningPurchase.openingPaidAmount, 2000)
  assert.equal(normalizedPurchase.paidAmount, 9999)
  assert.equal(normalizedPurchase.unpaidAmount, 1)
  assert.equal(Object.hasOwn(legacyPurchase, 'openingPaidAmount'), false)

  const html = renderSection({
    purchaseRecords: [normalizedPurchase],
    purchasePaymentRecords: [{
      paymentId: 'PP-NORMALIZED',
      purchaseId: 'PO-NORMALIZED',
      paymentDate: '2026-08-08',
      jpyAmount: 3000,
    }],
  })

  assert.match(html, /<strong>¥3,000<\/strong><span>本月采购付款<\/span>/u)
  assert.match(html, /<strong>¥7,000<\/strong><span>当前采购应付余额<\/span>/u)
  assert.match(
    html,
    /<td>¥10,000<\/td><td>¥3,000<\/td><td>¥7,000<\/td><td>部分付款<\/td>/u,
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
    '\n  const setStockInRecords = ',
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
    /const activePurchases = purchaseRecords\.filter\(\(record\) => record\.purchaseStatus !== '作废'\)/u,
  )
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
  assert.match(
    submitHandler,
    /await upsertRecord\(STORAGE_KEYS\.purchaseRecords, purchaseToSave\)/u,
  )
  assert.match(
    submitHandler,
    /await upsertRecord\(STORAGE_KEYS\.purchasePaymentRecords, payment\)/u,
  )
  assert.match(
    submitHandler,
    /const stateUpdateOptions = localDemoMode\s*\? \{\}\s*:\s*\{ stateOnly: true, syncLocal: true \}/u,
  )
  assert.match(submitHandler, /onPersistenceError\?\.\(error\)/u)
  assert.match(
    submitHandler,
    /try \{[\s\S]*?if \(!localDemoMode\) \{[\s\S]*?await upsertRecord\(STORAGE_KEYS\.purchaseRecords, purchaseToSave\)[\s\S]*?await upsertRecord\(STORAGE_KEYS\.purchasePaymentRecords, payment\)[\s\S]*?setPurchaseRecords\(nextPurchases, stateUpdateOptions\)[\s\S]*?setRecords\(nextPayments, stateUpdateOptions\)[\s\S]*?\} catch \(error\) \{\s*onPersistenceError\?\.\(error\)\s*return\s*\}/u,
  )
  assertMarkersInOrder(submitHandler, [
    'canApplyPurchasePayment(selectedPurchase, records, payment.jpyAmount)',
    'const nextPayments = [payment, ...records]',
    'recalculatePurchasePaymentCache(',
    'await upsertRecord(STORAGE_KEYS.purchaseRecords, purchaseToSave)',
    'await upsertRecord(STORAGE_KEYS.purchasePaymentRecords, payment)',
    'setPurchaseRecords(nextPurchases, stateUpdateOptions)',
    'setRecords(nextPayments, stateUpdateOptions)',
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
  assert.match(
    deleteHandler,
    /await upsertRecord\(STORAGE_KEYS\.purchaseRecords, purchaseToSave\)/u,
  )
  assert.match(
    deleteHandler,
    /await softDelete\(STORAGE_KEYS\.purchasePaymentRecords, record\.paymentId\)/u,
  )
  assert.match(
    deleteHandler,
    /const stateUpdateOptions = localDemoMode\s*\? \{\}\s*:\s*\{ stateOnly: true, syncLocal: true \}/u,
  )
  assert.match(deleteHandler, /onPersistenceError\?\.\(error\)/u)
  assert.match(
    deleteHandler,
    /try \{[\s\S]*?if \(!localDemoMode\) \{[\s\S]*?await upsertRecord\(STORAGE_KEYS\.purchaseRecords, purchaseToSave\)[\s\S]*?await softDelete\(STORAGE_KEYS\.purchasePaymentRecords, record\.paymentId\)[\s\S]*?setPurchaseRecords\(nextPurchases, stateUpdateOptions\)[\s\S]*?setRecords\(remainingPayments, stateUpdateOptions\)[\s\S]*?\} catch \(error\) \{\s*onPersistenceError\?\.\(error\)\s*return\s*\}/u,
  )
  assertMarkersInOrder(deleteHandler, [
    'const remainingPayments = records.filter(',
    'recalculatePurchasePaymentCache(',
    'await upsertRecord(STORAGE_KEYS.purchaseRecords, purchaseToSave)',
    'await softDelete(STORAGE_KEYS.purchasePaymentRecords, record.paymentId)',
    'setPurchaseRecords(nextPurchases, stateUpdateOptions)',
    'setRecords(remainingPayments, stateUpdateOptions)',
  ])
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
    appLoaded.module.normalizePurchaseRecord({
      purchaseId: 'PO-DASH',
      purchaseDate: `${DASHBOARD_PRIOR_MONTH}-11`,
      projectId: 'P-DASH',
      projectName: '不应重复计费',
      purchaseSource: '中国采购',
      purchaseType: '材料',
      itemName: '重复采购',
      quantity: 1,
      unitPrice: 50000,
      currency: 'JPY',
      totalCost: 50000,
      openingPaidAmount: 0,
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

  const html = renderToStaticMarkup(createElement(appLoaded.module.DashboardPage, {
    projects: source.projects,
    employees: source.employees,
    records: {
      stockOut: [],
      stockReturn: [],
      labor: source.laborRecords,
      toolBorrow: [],
      toolReturn: [],
    },
    projectCostRecords: [],
    purchaseRecords: source.purchaseRecords,
    purchasePaymentRecords: source.purchasePaymentRecords,
    stockInRecords: [],
    inventoryItems: source.inventoryItems,
    salaryRecords: [],
    vehicles: [],
    vehicleUsageRecords: source.vehicleUsageRecords,
    fuelRecords: [],
    vehicleExpenseRecords: [],
    vehicleIssueRecords: [],
    toolRecords: [],
    toolBorrowRecords: [],
    toolReturnRecords: [],
    lifelongToolAssignments: source.lifelongToolAssignments,
    toolResponsibilityRecords: source.toolResponsibilityRecords,
    laborBridge: null,
    bridgeStatusNotice: null,
    laborAlertCount: 0,
    onBack: () => {},
  }))

  assert.match(html, /<strong>¥0<\/strong><span>本月采购总额<\/span>/u)
  assert.match(html, /<strong>¥3,000<\/strong><span>本月实际付款<\/span>/u)
  assert.match(html, /<strong>¥7,000<\/strong><span>当前采购应付余额<\/span>/u)
  assert.match(html, /<strong>2<\/strong><span>采购数据异常数量<\/span>/u)
  assert.match(html, /<strong>¥10,000<\/strong><span>项目成本合计<\/span>/u)
  assert.match(html, /<strong>¥90,000<\/strong><span>预估毛利润<\/span>/u)
  assert.match(html, /<th>项目已付采购金额<\/th>/u)
  assert.match(html, /<th>项目未付采购金额<\/th>/u)

  const projectRow = html.match(/<tr><td>跨月付款项目<\/td>[\s\S]*?<\/tr>/u)?.[0]
  assert.ok(projectRow, 'expected the dashboard project detail row')
  assert.match(
    projectRow,
    /payment-badge 部分付款[^>]*>部分付款<\/span><\/td><td>¥10,000<\/td>/u,
  )
  assert.match(
    projectRow,
    /<td>¥10,000<\/td><td>¥10,000<\/td><td>¥0<\/td><td>¥3,000<\/td><td>¥7,000<\/td>/u,
  )
  assert.match(projectRow, /<td>¥90,000<\/td><td>90%<\/td><\/tr>$/u)
})

test('AuthenticatedApp wires one shared purchase accounting model into the owner dashboard', () => {
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
  assert.match(dashboardOpeningTag, /\bpurchaseRecords=\{purchaseRecords\}/u)
  assert.match(
    dashboardOpeningTag,
    /\bpurchasePaymentRecords=\{purchasePaymentRecords\}/u,
  )
  assert.equal(
    (dashboardPage.match(/buildPurchaseAccountingReadModel\(/gu) || []).length,
    1,
  )
  assert.match(dashboardPage, /const currentMonth = currentMonthValue\(\)/u)
  assert.match(
    dashboardPage,
    /paymentRecords:\s*purchasePaymentRecords[\s\S]*?month:\s*currentMonth[\s\S]*?\[purchaseRecords, purchasePaymentRecords, currentMonth\]/u,
  )
  assert.match(dashboardPage, /purchaseAccounting\.summary\.monthPaymentCash/u)
  assert.match(dashboardPage, /purchaseAccounting\.summary\.currentOutstanding/u)
  assert.match(dashboardPage, /purchaseAccounting\.rows\.filter/u)
  assert.match(dashboardPage, /row\.paidAmount/u)
  assert.match(dashboardPage, /row\.unpaidAmount/u)
})

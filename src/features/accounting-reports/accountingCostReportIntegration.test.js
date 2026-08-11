import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import {
  findWarehouseTestElement,
  installWarehouseReactDom,
  TestEvent,
} from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/task5-accounting-cost-report-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [{
    name: 'accounting-cost-report-leaflet-stub',
    enforce: 'pre',
    resolveId(source) {
      return source === 'leaflet' ? '\0accounting-cost-report-leaflet-stub' : null
    },
    load(id) {
      if (id !== '\0accounting-cost-report-leaflet-stub') return null
      return 'export default { icon: () => ({}) }'
    },
  }],
  ssr: { noExternal: ['leaflet'] },
  server: { middlewareMode: true },
})
const { AccountingCostPage, MonthlySummarySection } = await server.ssrLoadModule('/src/App.jsx')
after(() => server.close())

const salaryAccess = {
  salary: { view: true, create: false, update: false, delete: false },
  projectCost: { view: false, create: false, update: false, delete: false },
  operatingExpense: { view: false, create: false, update: false, delete: false },
  purchaseAccounting: { view: false },
  monthlySummary: {
    salary: false, projectCost: false, operatingExpense: false,
    purchaseAccrual: false, purchasePayments: false,
  },
}

const operatingAccess = {
  ...salaryAccess,
  salary: { ...salaryAccess.salary, view: false },
  operatingExpense: { ...salaryAccess.operatingExpense, view: true },
}

const employees = [
  { employeeId: 'E-001', name: '员工甲' },
  { employeeId: 'E-002', name: '员工乙' },
]
const projects = [
  { projectId: 'P-001', projectName: '新宿改造', address: '新宿' },
  { projectId: 'P-002', projectName: '涩谷改造', address: '涩谷' },
]
const OUTPUT_TIMESTAMP = '2026-08-12T03:04:05.678Z'

function outputNow() {
  return new Date(OUTPUT_TIMESTAMP)
}

function ready(data) {
  return { status: 'ready', data, stale: false }
}

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const monthlyAccess = {
  salary: true, projectCost: true, operatingExpense: true,
  purchaseAccrual: true, purchasePayments: true,
}
const monthlyLaborWindow = {
  monthly: [{
    month: '2026-08', status: 'ready', stale: false, salaryTotal: 100,
    projectLaborTotal: 80, projectLaborById: { 'P-001': 80 }, source: 'formal', pendingCount: 0,
  }],
  projectLaborLifetimeById: { 'P-001': 80 },
  lifetimeStatus: 'ready', lifetimeStale: false, incompleteMonths: [], staleMonths: [],
}
const monthlyPurchases = [{
  purchaseId: 'PO-001', purchaseDate: '2026-08-01', projectId: 'P-001',
  purchaseSource: 'Amazon', totalCost: 200, openingPaidAmount: 0,
  purchaseStatus: '正常', invoiceStatus: '已取得',
}]
const monthlyManualCosts = [
  { costRecordId: 'C-L', projectId: 'P-001', costType: '人工费', amount: 10, date: '2026-08-02' },
  { costRecordId: 'C-M', projectId: 'P-001', costType: '材料费', amount: 20, date: '2026-08-03' },
  { costRecordId: 'C-T', projectId: 'P-001', costType: '工具费', amount: 30, date: '2026-08-04' },
  { costRecordId: 'C-V', projectId: 'P-001', costType: '车辆费', amount: 40, date: '2026-08-05' },
  { costRecordId: 'C-O', projectId: 'P-001', costType: '外包费', amount: 100, date: '2026-08-06' },
]
const monthlyOperating = [{
  expenseRecordId: 'OE-001', projectId: 'P-001', allocateToProject: true,
  amount: 50, date: '2026-08-07', expenseType: '其他',
}]
const monthlyFuel = [{
  fuelRecordId: 'F-001', projectId: 'P-001', allocateToProject: true,
  fuelAmount: 30, fuelDate: '2026-08-08',
  fuelDateSource: 'recorded', fuelDateLegacyInferred: false,
  paymentMethod: '现金', paymentMethodSource: 'recorded', paymentMethodLegacyInferred: false,
}]
const monthlyVehicleExpenses = [{
  vehicleExpenseId: 'VE-001', projectId: 'P-001', allocateToProject: true,
  amount: 20, expenseDate: '2026-08-09', expenseType: '停车费',
  expenseDateSource: 'recorded', expenseDateLegacyInferred: false,
  paymentMethod: '现金', paymentMethodSource: 'recorded', paymentMethodLegacyInferred: false,
}]
const monthlyVehicleIssues = [{
  issueId: 'VI-001', projectId: 'P-001', allocateToProject: true,
  repairCost: 50, issueDate: '2026-08-10', severity: '一般', issueStatus: '未处理',
}]

function monthlySourceStates(overrides = {}) {
  return {
    projects: ready([{ projectId: 'P-001', projectName: '新宿改造', status: '进行中' }]),
    laborWindow: ready(monthlyLaborWindow),
    purchaseAccrual: ready(monthlyPurchases),
    purchaseLedgerAccrual: ready(monthlyPurchases),
    purchasePayments: ready([]),
    projectCosts: ready(monthlyManualCosts),
    operatingExpenses: ready(monthlyOperating),
    fuel: ready(monthlyFuel),
    vehicleExpenses: ready(monthlyVehicleExpenses),
    vehicleIssues: ready(monthlyVehicleIssues),
    ...overrides,
  }
}

function monthlyProps(overrides = {}) {
  return {
    access: monthlyAccess,
    vehicleAccess: true,
    sourceStates: monthlySourceStates(),
    monthFilter: '2026-08',
    onMonthFilterChange() {},
    reportPreparedBy: '系统管理员',
    ...overrides,
  }
}

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
  const control = elements(wrapper, (element) =>
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName))[0]
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

function detailRows(report, sectionId) {
  const section = report.sections.find((item) => item.id === sectionId)
  assert.ok(section, `report section ${sectionId}`)
  return section.rows
}

async function mount(props) {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const sourceStates = props.sourceStates ?? {
    salaryRecords: ready(props.salaryRecords ?? []),
    operatingExpenseRecords: ready(props.operatingExpenseRecords ?? []),
  }
  await act(async () => {
    root.render(createElement(AccountingCostPage, {
      projects,
      employees,
      setSalaryRecords() {},
      setOperatingExpenseRecords() {},
      onBack() {},
      sourceStates,
      ...props,
    }))
  })
  return { dom, container, root }
}

test('salary report actions fail closed by source readiness without exposing fallback rows', async (t) => {
  const sensitiveRecord = {
    salaryRecordId: 'SR-SENSITIVE', salaryMonth: '2026-08', employeeId: 'E-001',
    employeeName: '社外秘员', baseSalary: 900000, workDays: 22, overtimePay: 0,
    bonus: 0, deduction: 0, netSalary: 900000, createdAt: '2026-08-31', remark: '',
  }
  const cases = [
    ['loading', { status: 'loading', data: null, stale: false }, /工资数据正在加载/u],
    ['error', { status: 'error', data: null, stale: false }, /工资数据暂不可用/u],
    ['stale', { status: 'ready', data: [sensitiveRecord], stale: true }, /工资数据正在加载/u],
    ['forbidden', { status: 'forbidden', data: null, stale: false }, /工资数据当前不可见/u],
  ]

  for (const [name, salaryState, reason] of cases) {
    await t.test(name, async () => {
      const scenario = await mount({
        access: salaryAccess,
        salaryRecords: [sensitiveRecord],
        operatingExpenseRecords: [],
        sourceStates: {
          salaryRecords: salaryState,
          operatingExpenseRecords: ready([]),
        },
        reportPreparedBy: '系统管理员',
        reportActionDependencies: { exportExcel() {}, printReport() {} },
      })
      try {
        assert.match(scenario.container.textContent, reason)
        assert.doesNotMatch(scenario.container.textContent, /社外秘员|SR-SENSITIVE/u)
        for (const label of ['导出 Excel', '导出 PDF', '打印']) {
          assert.equal(button(scenario.container, label)?.disabled ?? true, true)
        }
      } finally {
        await cleanup(scenario)
      }
    })
  }
})

test('salary ready-zero source keeps actions enabled and exports an explicit empty report', async () => {
  let capturedReport
  const scenario = await mount({
    access: salaryAccess,
    salaryRecords: [],
    operatingExpenseRecords: [],
    sourceStates: { salaryRecords: ready([]), operatingExpenseRecords: ready([]) },
    reportPreparedBy: '系统管理员',
    reportActionDependencies: {
      now: outputNow,
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    await act(async () => button(scenario.container, '导出 Excel').click())
    assert.equal(capturedReport.recordCount, 0)
    assert.deepEqual(detailRows(capturedReport, 'salary-details'), [])
    assert.equal(
      capturedReport.sections.find((section) => section.id === 'salary-details').emptyText,
      '当前筛选条件下无记录',
    )
  } finally {
    await cleanup(scenario)
  }
})

test('operating report actions fail closed by source readiness without exposing fallback rows', async (t) => {
  const sensitiveRecord = {
    expenseRecordId: 'OE-SENSITIVE', date: '2026-08-01', expenseType: '机密费用', amount: 88000,
    allocateToProject: false, projectId: '', projectName: '', operator: '社外秘员', remark: '',
  }
  const cases = [
    ['loading', { status: 'loading', data: null, stale: false }, /经营费用数据正在加载/u],
    ['error', { status: 'error', data: null, stale: false }, /经营费用数据暂不可用/u],
    ['stale', { status: 'ready', data: [sensitiveRecord], stale: true }, /经营费用数据正在加载/u],
    ['forbidden', { status: 'forbidden', data: null, stale: false }, /经营费用数据当前不可见/u],
  ]

  for (const [name, operatingState, reason] of cases) {
    await t.test(name, async () => {
      const scenario = await mount({
        access: operatingAccess,
        salaryRecords: [],
        operatingExpenseRecords: [sensitiveRecord],
        sourceStates: {
          salaryRecords: ready([]),
          operatingExpenseRecords: operatingState,
        },
        reportPreparedBy: '系统管理员',
        reportActionDependencies: { exportExcel() {}, printReport() {} },
      })
      try {
        assert.match(scenario.container.textContent, reason)
        assert.doesNotMatch(scenario.container.textContent, /机密费用|OE-SENSITIVE|社外秘员/u)
        for (const label of ['导出 Excel', '导出 PDF', '打印']) {
          assert.equal(button(scenario.container, label)?.disabled ?? true, true)
        }
      } finally {
        await cleanup(scenario)
      }
    })
  }
})

test('operating ready-zero source keeps report actions enabled', async () => {
  let capturedReport
  const scenario = await mount({
    access: operatingAccess,
    salaryRecords: [],
    operatingExpenseRecords: [],
    sourceStates: { salaryRecords: ready([]), operatingExpenseRecords: ready([]) },
    reportPreparedBy: '系统管理员',
    reportActionDependencies: {
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    await act(async () => button(scenario.container, '导出 Excel').click())
    assert.equal(capturedReport.recordCount, 0)
    assert.deepEqual(detailRows(capturedReport, 'expense-details'), [])
  } finally {
    await cleanup(scenario)
  }
})

test('operating report readiness stays independent from the monthly-summary projection', async () => {
  const record = {
    expenseRecordId: 'OE-DIRECT', date: '2026-08-01', expenseType: '交通费', amount: 1200,
    allocateToProject: false, projectId: '', projectName: '', operator: '员工甲', remark: '',
  }
  const scenario = await mount({
    access: operatingAccess,
    salaryRecords: [],
    operatingExpenseRecords: [record],
    sourceStates: {
      salaryRecords: ready([]),
      operatingExpenses: { status: 'forbidden', data: null, stale: false },
      operatingExpenseRecords: ready([record]),
    },
    reportPreparedBy: '系统管理员',
    reportActionDependencies: { exportExcel() {}, printReport() {} },
  })
  try {
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    assert.match(scenario.container.textContent, /OE-DIRECT|交通费/u)
    assert.doesNotMatch(scenario.container.textContent, /经营费用数据当前不可见/u)
  } finally {
    await cleanup(scenario)
  }
})

async function cleanup(scenario) {
  await act(async () => scenario.root.unmount())
  scenario.dom.cleanup()
}

async function mountMonthly(overrides = {}) {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const render = async (nextOverrides = {}) => {
    await act(async () => {
      root.render(createElement(MonthlySummarySection, monthlyProps({
        ...overrides,
        ...nextOverrides,
      })))
    })
  }
  await render()
  return { dom, container, root, render }
}

test('salary actions retain and export the previous active month when clearing is attempted', async () => {
  let capturedReport
  const records = [
    {
      salaryRecordId: 'SR-001', salaryMonth: '2026-07', employeeId: 'E-001',
      employeeName: '员工甲', baseSalary: 300000, workDays: 22, overtimePay: 10000,
      bonus: 5000, deduction: 1000, netSalary: 314000, createdAt: '2026-07-31', remark: '',
    },
    {
      salaryRecordId: 'SR-002', salaryMonth: '2026-07', employeeId: 'E-002',
      employeeName: '员工乙', baseSalary: 280000, workDays: 22, overtimePay: 0,
      bonus: 0, deduction: 0, netSalary: 280000, createdAt: '2026-07-31', remark: '',
    },
    {
      salaryRecordId: 'SR-003', salaryMonth: '2026-06', employeeId: 'E-001',
      employeeName: '员工甲', baseSalary: 300000, workDays: 21, overtimePay: 0,
      bonus: 0, deduction: 0, netSalary: 300000, createdAt: '2026-06-30', remark: '',
    },
  ]
  const scenario = await mount({
    access: salaryAccess,
    salaryRecords: records,
    operatingExpenseRecords: [],
    reportPreparedBy: '系统管理员',
    reportActionDependencies: {
      now: outputNow,
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    for (const label of ['导出 Excel', '导出 PDF', '打印']) {
      assert.ok(button(scenario.container, label), `button ${label}`)
    }
    const monthInput = field(scenario.container, '按月份筛选')
    await change(monthInput, '2026-07')
    await change(monthInput, '')
    assert.equal(monthInput.value, '2026-07')
    await change(field(scenario.container, '按员工姓名筛选'), '员工乙')
    await act(async () => button(scenario.container, '导出 Excel').click())

    assert.ok(capturedReport, 'Excel action receives the real salary report')
    assert.equal(capturedReport.preparedBy, '系统管理员')
    assert.equal(capturedReport.generatedAt, OUTPUT_TIMESTAMP)
    assert.equal(capturedReport.recordCount, 1)
    assert.equal(capturedReport.fileName, '工资报表_2026-07_2026-08-12')
    assert.deepEqual(capturedReport.filterLines, [
      { label: '工资月份', value: '2026-07' },
      { label: '员工', value: '员工乙' },
    ])
    assert.deepEqual(
      detailRows(capturedReport, 'salary-details').map((row) => row.salaryRecordId),
      ['SR-002'],
    )
  } finally {
    await cleanup(scenario)
  }
})

test('operating actions retain the active month and records follow the selected project scope', async () => {
  let capturedReport
  const records = [
    {
      expenseRecordId: 'OE-001', date: '2026-07-01', expenseType: '交通费', amount: 1000,
      allocateToProject: false, projectId: '', projectName: '', operator: '员工甲', remark: '',
    },
    {
      expenseRecordId: 'OE-002', date: '2026-07-02', expenseType: '交通费', amount: 2000,
      allocateToProject: true, projectId: 'P-001', projectName: '新宿改造', operator: '员工甲', remark: '',
    },
    {
      expenseRecordId: 'OE-003', date: '2026-07-03', expenseType: '交通费', amount: 3000,
      allocateToProject: true, projectId: 'P-002', projectName: '涩谷改造', operator: '员工乙', remark: '',
    },
  ]
  const scenario = await mount({
    access: operatingAccess,
    salaryRecords: [],
    operatingExpenseRecords: records,
    reportPreparedBy: '系统管理员',
    reportActionDependencies: {
      now: outputNow,
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    for (const label of ['导出 Excel', '导出 PDF', '打印']) {
      assert.ok(button(scenario.container, label), `button ${label}`)
    }
    const monthInput = field(scenario.container, '按月份筛选')
    await change(monthInput, '2026-07')
    await change(monthInput, '')
    assert.equal(monthInput.value, '2026-07')
    await change(field(scenario.container, '费用归属'), 'project')
    await change(field(scenario.container, '项目'), 'P-001')

    const cards = elements(scenario.container, (element) =>
      element.nodeName === 'ARTICLE' && element.className.includes('record-card'))
    assert.equal(cards.length, 1)
    assert.match(cards[0].textContent, /OE-002/u)
    assert.match(cards[0].textContent, /新宿改造/u)
    assert.doesNotMatch(cards[0].textContent, /OE-001|OE-003|涩谷改造/u)

    await act(async () => button(scenario.container, '导出 Excel').click())
    assert.ok(capturedReport, 'Excel action receives the real operating-expense report')
    assert.equal(capturedReport.preparedBy, '系统管理员')
    assert.equal(capturedReport.generatedAt, OUTPUT_TIMESTAMP)
    assert.equal(capturedReport.recordCount, 1)
    assert.equal(capturedReport.fileName, '经营费用报表_2026-07_2026-08-12')
    assert.deepEqual(capturedReport.filterLines[0], { label: '费用月份', value: '2026-07' })
    assert.deepEqual(capturedReport.filterLines.slice(2), [
      { label: '费用归属', value: '项目费用' },
      { label: '项目', value: '新宿改造' },
    ])
    assert.deepEqual(
      detailRows(capturedReport, 'expense-details').map((row) => row.expenseRecordId),
      ['OE-002'],
    )
  } finally {
    await cleanup(scenario)
  }
})

test('monthly actions export the exact labels and values rendered by the shared metric arrays', async () => {
  let capturedReport
  const scenario = await mountMonthly({
    reportActionDependencies: {
      now: outputNow,
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    const expectedCore = [
      ['本月工资发放', 100, '¥100'],
      ['本月项目人工分摊', 80, '¥80'],
      ['本月未分摊人工成本', 20, '¥20'],
      ['项目人工分摊率', 80, '80%'],
      ['本月采购确认成本', 200, '¥200'],
      ['车辆费用合计', 50, '¥50'],
      ['已确认项目补充成本', 100, '¥100'],
      ['经营费用合计', 50, '¥50'],
      ['公司总成本', 500, '¥500'],
      ['当前采购应付余额', 200, '¥200'],
      ['本月采购付款现金流', 0, '¥0'],
    ]
    const expectedSources = [
      ['中国采购金额', 0, '¥0'],
      ['Amazon 采购金额', 200, '¥200'],
      ['Yahoo拍卖采购金额', 0, '¥0'],
      ['东鹏株式会社采购金额', 0, '¥0'],
    ]
    for (const [label, _value, displayed] of [...expectedCore, ...expectedSources]) {
      assert.match(scenario.container.textContent, new RegExp(`${displayed}${label}`, 'u'))
    }

    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    await act(async () => button(scenario.container, '导出 Excel').click())

    assert.ok(capturedReport)
    assert.equal(capturedReport.preparedBy, '系统管理员')
    assert.equal(capturedReport.generatedAt, OUTPUT_TIMESTAMP)
    assert.ok(capturedReport.recordCount > 0)
    assert.equal(capturedReport.fileName, '月度成本汇总_2026-08_2026-08-12')
    assert.deepEqual(detailRows(capturedReport, 'monthly-core').map((row) => [row.item, row.value]),
      expectedCore.map(([label, value]) => [label, value]))
    assert.deepEqual(
      detailRows(capturedReport, 'monthly-purchase-sources').map((row) => [row.item, row.value]),
      expectedSources.map(([label, value]) => [label, value]),
    )
    assert.deepEqual(detailRows(capturedReport, 'monthly-pending'), [
      { item: '待核算手工人工费', amount: 10, itemCount: 1 },
      { item: '待核算手工材料费', amount: 20, itemCount: 1 },
      { item: '待核算手工工具费', amount: 30, itemCount: 1 },
      { item: '待核算手工车辆费', amount: 40, itemCount: 1 },
      { item: '待核算维修估算', amount: 50, itemCount: 1 },
    ])
  } finally {
    await cleanup(scenario)
  }
})

test('monthly actions fail closed for unavailable, incomplete, and malformed allowed sources', async (t) => {
  const incompleteLedger = ready({
    status: 'ready', generatedAt: '2026-08-11T09:00:00Z', totalAmount: 250,
    monthlyTotals: [{ month: '2026-08', amount: 250 }],
    projectTotals: [{ projectId: 'P-001', amount: 250 }],
    categoryTotals: [{ category: '材料费', amount: 250 }],
    projectMonthCategoryTotals: [{
      projectId: 'P-001', month: '2026-08', category: '材料费', amount: 250,
    }],
    incompleteSources: ['warehouse'],
  })
  const cases = [
    ['loading', { laborWindow: { status: 'loading', data: null, stale: false } }],
    ['error', { laborWindow: { status: 'error', data: null, stale: false } }],
    ['stale', { laborWindow: { status: 'ready', data: monthlyLaborWindow, stale: true } }],
    ['incomplete ledger', { projectLedgerSummary: incompleteLedger }],
    ['model error', { laborWindow: ready({ ...monthlyLaborWindow, unexpected: true }) }],
  ]

  for (const [name, sourceOverride] of cases) {
    await t.test(name, async () => {
      const scenario = await mountMonthly({
        sourceStates: monthlySourceStates(sourceOverride),
        reportActionDependencies: { exportExcel() {}, printReport() {} },
      })
      try {
        for (const label of ['导出 Excel', '导出 PDF', '打印']) {
          assert.equal(button(scenario.container, label)?.disabled ?? true, true)
        }
      } finally {
        await cleanup(scenario)
      }
    })
  }
})

test('monthly actions omit forbidden source facts and export the remaining visible scope', async () => {
  let capturedReport
  const forbidden = { status: 'forbidden', data: null, stale: false }
  const scenario = await mountMonthly({
    access: {
      salary: true, projectCost: false, operatingExpense: false,
      purchaseAccrual: true, purchasePayments: true,
    },
    vehicleAccess: false,
    sourceStates: monthlySourceStates({
      purchaseAccrual: forbidden,
      purchaseLedgerAccrual: forbidden,
      purchasePayments: forbidden,
    }),
    reportActionDependencies: {
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    assert.doesNotMatch(scenario.container.textContent, /Amazon 采购金额|¥200/u)
    await act(async () => button(scenario.container, '导出 Excel').click())

    assert.ok(capturedReport)
    assert.deepEqual(capturedReport.filterLines, [
      { label: '统计月份', value: '2026-08' },
      { label: '统计范围', value: '按当前账号可见范围' },
    ])
    assert.deepEqual(
      detailRows(capturedReport, 'monthly-core').map((row) => row.item),
      ['本月工资发放', '本月项目人工分摊', '本月未分摊人工成本', '项目人工分摊率'],
    )
    assert.deepEqual(detailRows(capturedReport, 'monthly-purchase-sources'), [])
  } finally {
    await cleanup(scenario)
  }
})

test('monthly blocked transitions invalidate a delayed export when visible facts stay unchanged', async (t) => {
  const emptyLaborWindow = {
    ...monthlyLaborWindow,
    monthly: [],
    projectLaborLifetimeById: {},
  }
  const ledgerSummary = (incompleteSources) => ready({
    status: 'ready', generatedAt: '2026-08-11T09:00:00Z', totalAmount: 0,
    monthlyTotals: [], projectTotals: [], categoryTotals: [],
    projectMonthCategoryTotals: [], incompleteSources,
  })
  const cases = [
    {
      name: 'cost model error',
      initial: {
        access: {
          salary: true, projectCost: false, operatingExpense: false,
          purchaseAccrual: false, purchasePayments: false,
        },
        vehicleAccess: false,
        sourceStates: monthlySourceStates({ laborWindow: ready(emptyLaborWindow) }),
      },
      blocked: {
        sourceStates: monthlySourceStates({
          laborWindow: ready({ ...emptyLaborWindow, unexpected: true }),
        }),
      },
    },
    {
      name: 'incomplete project ledger',
      initial: {
        access: {
          salary: true, projectCost: true, operatingExpense: false,
          purchaseAccrual: false, purchasePayments: false,
        },
        vehicleAccess: false,
        sourceStates: monthlySourceStates({
          projects: { status: 'forbidden', data: null, stale: false },
          laborWindow: ready(emptyLaborWindow),
          projectCosts: ready([]),
          projectLedgerSummary: ledgerSummary([]),
        }),
      },
      blocked: {
        sourceStates: monthlySourceStates({
          projects: { status: 'forbidden', data: null, stale: false },
          laborWindow: ready(emptyLaborWindow),
          projectCosts: ready([]),
          projectLedgerSummary: ledgerSummary(['warehouse']),
        }),
      },
    },
  ]

  for (const scenarioCase of cases) {
    await t.test(scenarioCase.name, async () => {
      const release = deferred()
      let downloads = 0
      let staleGuard
      const reportActionDependencies = {
        exportExcel: async (_report, { outputGuard }) => {
          staleGuard = outputGuard
          await release.promise
          if (outputGuard()) downloads += 1
        },
        printReport() {},
      }
      const scenario = await mountMonthly({
        ...scenarioCase.initial,
        reportActionDependencies,
      })
      try {
        const visibleFacts = elements(scenario.container, (element) =>
          element.nodeName === 'DIV' && element.className.includes('stat-card'))
          .map((element) => element.textContent)
        await act(async () => button(scenario.container, '导出 Excel').click())
        assert.equal(staleGuard(), true)

        await scenario.render({
          ...scenarioCase.blocked,
          reportActionDependencies,
        })

        assert.deepEqual(
          elements(scenario.container, (element) =>
            element.nodeName === 'DIV' && element.className.includes('stat-card'))
            .map((element) => element.textContent),
          visibleFacts,
        )
        assert.equal(button(scenario.container, '导出 Excel').disabled, true)
        assert.equal(staleGuard(), false)
        release.resolve()
        await act(async () => { await release.promise })
        assert.equal(downloads, 0)
      } finally {
        release.resolve()
        await cleanup(scenario)
      }
    })
  }
})

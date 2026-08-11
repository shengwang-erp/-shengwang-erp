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
const { AccountingCostPage } = await server.ssrLoadModule('/src/App.jsx')
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
  await act(async () => {
    root.render(createElement(AccountingCostPage, {
      projects,
      employees,
      setSalaryRecords() {},
      setOperatingExpenseRecords() {},
      onBack() {},
      ...props,
    }))
  })
  return { dom, container, root }
}

async function cleanup(scenario) {
  await act(async () => scenario.root.unmount())
  scenario.dom.cleanup()
}

test('salary actions export the report produced by the active month and employee filters', async () => {
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
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    for (const label of ['导出 Excel', '导出 PDF', '打印']) {
      assert.ok(button(scenario.container, label), `button ${label}`)
    }
    await change(field(scenario.container, '按月份筛选'), '2026-07')
    await change(field(scenario.container, '按员工姓名筛选'), '员工乙')
    await act(async () => button(scenario.container, '导出 Excel').click())

    assert.ok(capturedReport, 'Excel action receives the real salary report')
    assert.equal(capturedReport.preparedBy, '系统管理员')
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

test('operating actions and records follow the selected project allocation scope', async () => {
  let capturedReport
  const records = [
    {
      expenseRecordId: 'OE-001', date: '2026-08-01', expenseType: '交通费', amount: 1000,
      allocateToProject: false, projectId: '', projectName: '', operator: '员工甲', remark: '',
    },
    {
      expenseRecordId: 'OE-002', date: '2026-08-02', expenseType: '交通费', amount: 2000,
      allocateToProject: true, projectId: 'P-001', projectName: '新宿改造', operator: '员工甲', remark: '',
    },
    {
      expenseRecordId: 'OE-003', date: '2026-08-03', expenseType: '交通费', amount: 3000,
      allocateToProject: true, projectId: 'P-002', projectName: '涩谷改造', operator: '员工乙', remark: '',
    },
  ]
  const scenario = await mount({
    access: operatingAccess,
    salaryRecords: [],
    operatingExpenseRecords: records,
    reportPreparedBy: '系统管理员',
    reportActionDependencies: {
      exportExcel: async (report) => { capturedReport = report },
      printReport() {},
    },
  })
  try {
    for (const label of ['导出 Excel', '导出 PDF', '打印']) {
      assert.ok(button(scenario.container, label), `button ${label}`)
    }
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

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { createAccountingReportModel } from './accountingReportModel.js'
import { createMonthlySummaryReport } from './monthlySummaryReport.js'
import { createMonthlyPayrollReport } from './monthlyPayrollReport.js'
import { createOperatingExpenseReport } from './operatingExpenseReport.js'
import { createPurchaseAccountingReport } from './purchaseAccountingReport.js'
import { createSalaryReport } from './salaryReport.js'
import { installWarehouseReactDom } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(), cacheDir: '/private/tmp/task3-accounting-print-sheet-vite-cache',
  configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/accounting-reports/AccountingReportPrintSheet.jsx')
after(() => server.close())
const AccountingReportPrintSheet = loaded.default

const report = createAccountingReportModel({
  id: 'payroll-2026-07',
  title: '工资记录表',
  companyName: '生旺株式会社',
  generatedAt: '2026-08-11 09:30',
  preparedBy: '会计甲',
  orientation: 'landscape',
  fileName: '2026年7月工资记录表',
  filterLines: [{ label: '筛选条件', value: '2026年7月／全部人员' }],
  recordCount: 1,
  summary: [{ label: '应发合计', value: 123456, format: 'money' }],
  sections: [{
    id: 'payroll', title: '工资明细', sheetName: '工资明细', emptyText: '无工资记录',
    columns: [
      { key: 'name', label: '姓名', align: 'left', format: 'text' },
      { key: 'gross', label: '应发工资', align: 'right', format: 'money' },
    ],
    rows: [{ name: '山田太郎', gross: 123456 }],
  }],
  notes: ['本表仅供内部核对。'],
})

const emptyReport = createAccountingReportModel({
  id: 'empty-payroll', title: '空工资记录表', generatedAt: '2026-08-11 09:35',
  preparedBy: '会计甲', fileName: '空工资记录表', recordCount: 0,
  sections: [{
    id: 'empty-payroll', title: '工资明细', sheetName: '工资明细',
    emptyText: '调用方自定义空文案',
    columns: [{ key: 'name', label: '姓名' }], rows: [],
  }],
})

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

test('print sheet renders the frozen accounting model as a leadership-ready paper report', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report }))
  for (const text of [
    '生旺株式会社', '工资记录表', '筛选条件', '2026年7月／全部人员',
    '¥123,456', '山田太郎', '制表人', '复核人', '审批人',
  ]) assert.match(html, new RegExp(text, 'u'), text)
  assert.match(html, /accounting-report-sheet landscape/u)
  assert.match(html, /align-right/u)
})

test('money summaries are visibly classified for right alignment', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report }))
  assert.match(html, /accounting-report-summary"><h2>汇总<\/h2><table><tbody><tr><th>应发合计<\/th><td class="align-right">¥123,456<\/td>/u)
})

test('zero-row print sections always use the binding no-record wording', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: emptyReport }))
  assert.match(html, /当前筛选条件下无记录/u)
  assert.doesNotMatch(html, /调用方自定义空文案/u)
})

test('print CSS selects named A4 pages, repeats headers, and stays independent of the ERP theme', async () => {
  const css = await readFile(new URL('./accountingReportPrint.css', import.meta.url), 'utf8')
  assert.match(css, /@page\s+accounting-report-landscape\s*\{[^}]*size:\s*A4 landscape/isu)
  assert.match(css, /@page\s+accounting-report-portrait\s*\{[^}]*size:\s*A4 portrait/isu)
  assert.match(css, /\.accounting-report-sheet\s*\{[^}]*font-size:\s*10pt/isu)
  assert.match(css, /\.accounting-report-sheet\.landscape\s*\{[^}]*page:\s*accounting-report-landscape/isu)
  assert.match(css, /\.accounting-report-sheet\.portrait\s*\{[^}]*page:\s*accounting-report-portrait/isu)
  assert.match(css, /\.accounting-report-sheet\s*>\s*section\s*>\s*h2\s*\{[^}]*font-size:\s*1[2-4]pt/isu)
  assert.match(css, /thead\s*\{[^}]*display:\s*table-header-group/isu)
  assert.match(css, /break-inside:\s*avoid/iu)
  assert.match(css, /overflow-wrap:\s*anywhere/iu)
  assert.match(css, /body\.accounting-report-printing\s*>\s*:not\(\.accounting-report-print-root\)\s*\{[^}]*display:\s*none/isu)
  assert.equal((css.match(/@bottom-center\s*\{/gu) || []).length, 2)
  assert.match(css, /content:\s*"第 " counter\(page\) " 页 \/ 共 " counter\(pages\) " 页"/u)
  assert.doesNotMatch(css, /accounting-report-page-number/u)
  assert.doesNotMatch(css, /visibility:\s*hidden|position:\s*(?:absolute|fixed)/iu)
  assert.doesNotMatch(css, /#(?:c69a45|d6a84b|b88736)/iu)
  assert.doesNotMatch(css, /background(?:-color)?:\s*#(?:000|000000|171513)/iu)
})

test('real four-adapter print markup formats and aligns values and preserves proportional widths', () => {
  const salary = createSalaryReport({
    records: [{
      salaryRecordId: 'SR-1', salaryMonth: '2026-08', employeeId: 'E-1', employeeName: '社员甲',
      baseSalary: 300000, workDays: 22, overtimePay: 10000, bonus: 5000,
      deduction: 1000, netSalary: 314000, createdAt: '2026-08-31', remark: '长备注',
    }],
    month: '2026-08', preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })
  const operating = createOperatingExpenseReport({
    records: [{
      expenseRecordId: 'OE-1', date: '2026-08-01', expenseType: '交通费', amount: 1200,
      allocateToProject: false, operator: '社员甲', remark: '电车费',
    }],
    month: '2026-08', preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })
  const purchase = createPurchaseAccountingReport({
    rows: [{
      purchaseId: 'PO-1', purchaseDate: '2026-08-02', itemName: '材料', supplierName: '供应商',
      projectName: '项目甲', purchaseSource: 'Amazon', totalCost: 5000,
      paidAmount: 2000, unpaidAmount: 3000, paymentStatus: '部分付款', invoiceStatus: '未取得',
    }],
    summary: {
      monthPurchaseCost: 5000, monthPaymentCash: 2000, currentOutstanding: 3000,
      missingInvoiceCount: 1, anomalyCount: 0,
    },
    anomalies: [], month: '2026-08', paymentVisible: true,
    preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })
  const monthly = createMonthlySummaryReport({
    month: '2026-08',
    coreMetrics: [
      { label: '公司总成本', value: 654321, format: 'money' },
      { label: '项目人工分摊率', value: 80, format: 'percent' },
    ],
    sourceMetrics: [], pendingMetrics: [], notes: [],
    preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })

  const salaryHtml = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: salary }))
  assert.match(salaryHtml, /<td class="align-right">¥300,000<\/td>/u)
  assert.match(salaryHtml, /<td class="align-center">2026-08-31<\/td>/u)
  const detailTable = salaryHtml.match(/<h2>工资明细<\/h2><table>([\s\S]*?)<\/table>/u)?.[1] || ''
  const widths = [...detailTable.matchAll(/<col style="width:([^%]+)%"\/>/gu)]
    .map((match) => Number(match[1]))
  assert.equal(widths.length, 11)
  assert.ok(widths.at(-1) > widths[1] * 2)

  const operatingHtml = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: operating }))
  assert.match(operatingHtml, /<td class="align-center">2026-08-01<\/td>/u)
  assert.match(operatingHtml, /<td class="align-right">¥1,200<\/td>/u)

  const purchaseHtml = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: purchase }))
  assert.match(purchaseHtml, /<td class="align-left">采购成本<\/td><td class="align-right">¥5,000<\/td>/u)
  assert.match(purchaseHtml, /<td class="align-center">部分付款<\/td>/u)
  assert.match(purchaseHtml, /<td class="align-center">未取得<\/td>/u)

  const monthlyHtml = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: monthly }))
  assert.match(monthlyHtml, /<td class="align-left">公司总成本<\/td><td class="align-right">¥654,321<\/td>/u)
  assert.match(monthlyHtml, /<td class="align-left">项目人工分摊率<\/td><td class="align-right">80%<\/td>/u)
})

test('monthly payroll print keeps formula-like names readable and long location reviews in proportional tables', () => {
  const locationReviewSummary = '判定异常：员工到达临时材料搬入口，距离现场中心点 420 米，已核实原始定位并保留管理记录。'
  const payroll = createMonthlyPayrollReport({
    employees: [{
      employeeNumber: 'SW-001', employeeName: '=工程员工', department: '工程部', position: '大工',
      attendanceMethod: 'project', fullDays: 20, halfDays: 1, excusedDays: 0,
      absenceDays: 0, pendingDays: 1, locationAbnormalCount: 1, locationReviewSummary,
      basePay: 290000, overtimePay: 10000, bonus: 0, deduction: 0, netSalary: 300000,
      projectAllocatedAmount: 300000, companyPersonnelCost: 0, status: 'confirmed',
      confirmationNote: '工资不因定位记录自动变化', confirmedAt: '2026-08-31T09:00:00+09:00',
    }],
    month: '2026-08', preparedBy: '会计甲', generatedAt: '2026-09-01T03:04:05.678Z',
  })
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: payroll }))

  assert.match(html, /accounting-report-sheet landscape/u)
  assert.match(html, />=工程员工</u)
  assert.match(html, new RegExp(locationReviewSummary, 'u'))
  assert.match(html, /<footer><span>制表人：会计甲<\/span><span>复核人：<\/span><span>审批人：<\/span><\/footer>/u)
  const anomalyTable = html.match(/<h2>定位异常记录<\/h2><table>([\s\S]*?)<\/table>/u)?.[1] || ''
  const widths = [...anomalyTable.matchAll(/<col style="width:([^%]+)%"\/>/gu)]
    .map((match) => Number(match[1]))
  assert.equal(widths.length, 5)
  assert.ok(widths[3] > widths[2])
})

test('forced-multipage salary and monthly markup retain named pages, repeated tables, and signature-only footers', () => {
  const salary = createSalaryReport({
    records: Array.from({ length: 80 }, (_, index) => ({
      salaryRecordId: `SR-${index + 1}`, salaryMonth: '2026-08', employeeId: `E-${index + 1}`,
      employeeName: `社员${index + 1}`, baseSalary: 1000, workDays: 20,
      overtimePay: 0, bonus: 0, deduction: 0, netSalary: 1000,
      createdAt: '2026-08-31', remark: '跨页验证',
    })),
    month: '2026-08', preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })
  const monthly = createMonthlySummaryReport({
    month: '2026-08',
    coreMetrics: Array.from({ length: 60 }, (_, index) => ({
      label: `成本指标${index + 1}`, value: index + 1, format: 'money',
    })),
    sourceMetrics: [], pendingMetrics: [], notes: ['强制多页结构验证'],
    preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })

  const salaryHtml = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: salary }))
  const monthlyHtml = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: monthly }))
  assert.match(salaryHtml, /accounting-report-sheet landscape/u)
  assert.match(monthlyHtml, /accounting-report-sheet portrait/u)
  assert.equal((salaryHtml.match(/SR-\d+/gu) || []).length, 80)
  assert.equal((monthlyHtml.match(/成本指标\d+/gu) || []).length, 120)
  for (const html of [salaryHtml, monthlyHtml]) {
    assert.match(html, /<footer><span>制表人：会计甲<\/span><span>复核人：<\/span><span>审批人：<\/span><\/footer>/u)
    assert.doesNotMatch(html, /accounting-report-page-number/u)
  }
})

test('print sheet portals a normal-flow root directly under body and removes it on unmount', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(AccountingReportPrintSheet, { report })) })
    const roots = elements(dom.document.body, (element) => element.className === 'accounting-report-print-root')
    assert.equal(roots.length, 1)
    assert.equal(roots[0].parentNode, dom.document.body)
    assert.notEqual(roots[0].parentNode, container)
    assert.match(roots[0].textContent, /工资记录表/u)
    await act(async () => { root.unmount() })
    assert.equal(elements(dom.document.body, (element) => element.className === 'accounting-report-print-root').length, 0)
  } finally {
    dom.cleanup()
  }
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ExcelJS from 'exceljs'

import { createAccountingReportModel } from './accountingReportModel.js'
import {
  ACCOUNTING_REPORT_MONEY_FORMAT,
  createAccountingReportWorkbook,
  exportAccountingReportXlsx,
  printAccountingReport,
} from './accountingReportExport.js'
import { createMonthlySummaryReport } from './monthlySummaryReport.js'
import { createOperatingExpenseReport } from './operatingExpenseReport.js'
import { createPurchaseAccountingReport } from './purchaseAccountingReport.js'
import { createSalaryReport } from './salaryReport.js'

function createReport(overrides = {}) {
  return createAccountingReportModel({
    id: 'payroll',
    title: '工资与付款核对表',
    companyName: '生旺株式会社',
    generatedAt: '2026-08-11T03:00:00.000Z',
    preparedBy: '财务部',
    orientation: 'portrait',
    fileName: '工资/付款:2026-08',
    filterLines: [{ label: '月份', value: '2026-08' }, { label: '部门', value: '制造部' }],
    recordCount: 2,
    summary: [{ label: '应付合计', value: 2400, format: 'money' }],
    sections: [
      {
        id: 'salary', title: '工资明细', sheetName: '核对',
        columns: [
          { key: 'employee', label: '员工', width: 14, align: 'left', format: 'text' },
          { key: 'detail', label: '长说明', width: 38, align: 'left', format: 'text' },
          { key: 'amount', label: '金额', width: 16, align: 'right', format: 'money' },
        ],
        rows: [{ employee: '=张三', detail: '这是一段用于验证单元格自动换行和适中行高的较长说明文本。', amount: 1200 }],
        emptyText: '当前筛选条件下无记录',
      },
      {
        id: 'payment', title: '付款明细', sheetName: '核对',
        columns: [
          { key: 'supplier', label: '供应商', width: 14, align: 'left', format: 'text' },
          { key: 'amount', label: '付款金额', width: 16, align: 'right', format: 'money' },
        ],
        rows: [],
        emptyText: '当前筛选条件下无记录',
      },
    ],
    notes: [],
    ...overrides,
  })
}

function findHeaderRow(sheet, firstLabel) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (sheet.getCell(rowNumber, 1).value === firstLabel) return rowNumber
  }
  throw new Error(`header row not found: ${firstLabel}`)
}

function findValueRow(sheet, firstCellValue) {
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (sheet.getCell(rowNumber, 1).value === firstCellValue) return rowNumber
  }
  throw new Error(`value row not found: ${firstCellValue}`)
}

function headerColumn(sheet, headerRow, label) {
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (sheet.getCell(headerRow, column).value === label) return column
  }
  throw new Error(`header column not found: ${label}`)
}

test('renders a white A4 workbook with readable two-section detail tables', () => {
  const report = createReport()
  const workbook = createAccountingReportWorkbook(ExcelJS, report)
  const sheet = workbook.getWorksheet('核对')
  const firstHeaderRow = findHeaderRow(sheet, '员工')
  const firstDataRow = firstHeaderRow + 1
  const secondHeaderRow = findHeaderRow(sheet, '供应商')

  assert.equal(sheet.pageSetup.paperSize, 9)
  assert.equal(sheet.pageSetup.orientation, report.orientation)
  assert.equal(sheet.pageSetup.fitToWidth, 1)
  assert.equal(sheet.getCell('A1').font.size, 18)
  assert.equal(sheet.getRow(firstHeaderRow).height, 26)
  assert.equal(sheet.getCell(firstHeaderRow, 1).fill.fgColor.argb, 'FFF2F2F2')
  assert.equal(sheet.getCell(firstHeaderRow, 1).font.color.argb, 'FF111111')
  assert.ok(sheet.getCell(firstHeaderRow - 1, 1).font.size >= 12)
  assert.ok(sheet.getCell(firstHeaderRow - 1, 1).font.size <= 14)
  assert.ok(sheet.getRows(1, sheet.rowCount).some((row) =>
    row.values.includes('本文件为 ERP 导出副本，可编辑；修改不会回写系统。')))
  assert.ok(sheet.getRows(1, sheet.rowCount).some((row) =>
    row.values.includes('记录数：2')))
  assert.ok(sheet.getRows(1, sheet.rowCount).some((row) => row.values.includes('复核人：')))
  assert.ok(sheet.getRows(1, sheet.rowCount).some((row) => row.values.includes('审批人：')))
  assert.equal(sheet.getCell(secondHeaderRow + 2, 1).value, '制表人：财务部')
  assert.ok(sheet.getRow(firstDataRow).height >= 24 && sheet.getRow(firstDataRow).height <= 28)
  assert.equal(sheet.getCell(firstDataRow, 1).border.left.style, 'thin')
  assert.equal(sheet.getCell(firstDataRow, 1).border.left.color.argb, 'FFB7B7B7')
  assert.equal(sheet.getCell(firstDataRow, 2).alignment.wrapText, true)
  assert.equal(sheet.getCell(firstDataRow, 3).numFmt, ACCOUNTING_REPORT_MONEY_FORMAT)
  assert.equal(sheet.getCell(firstDataRow, 1).value, "'=张三")
  assert.equal(sheet.views[0].state, 'frozen')
  assert.equal(sheet.views[0].ySplit, firstHeaderRow)
  const safeMetadataEndRow = findValueRow(sheet, report.editableNotice)
  assert.equal(sheet.pageSetup.printTitlesRow, `1:${safeMetadataEndRow}`)
  assert.ok(safeMetadataEndRow < firstHeaderRow)
  assert.match(sheet.pageSetup.printArea, /^A1:C\d+$/u)
  assert.equal(sheet.autoFilter, null)
})

test('adds an auto-filter only when a sheet contains one detail section', () => {
  const report = createReport({ sections: [createReport().sections[0]], recordCount: 1 })
  const sheet = createAccountingReportWorkbook(ExcelJS, report).getWorksheet('核对')
  const headerRow = findHeaderRow(sheet, '员工')

  assert.deepEqual(sheet.autoFilter, { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: 3 } })
})

test('real four-adapter workbooks preserve typed formats and inferred date, amount, and status alignment', () => {
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

  const salarySheet = createAccountingReportWorkbook(ExcelJS, salary).getWorksheet('工资明细')
  const salaryHeader = findHeaderRow(salarySheet, '工资编号')
  const salaryData = salaryHeader + 1
  const salaryMoney = salarySheet.getCell(salaryData, headerColumn(salarySheet, salaryHeader, '基本工资'))
  const salaryDate = salarySheet.getCell(salaryData, headerColumn(salarySheet, salaryHeader, '记录日期'))
  assert.equal(typeof salaryMoney.value, 'number')
  assert.equal(salaryMoney.numFmt, ACCOUNTING_REPORT_MONEY_FORMAT)
  assert.equal(salaryMoney.alignment.horizontal, 'right')
  assert.equal(salaryDate.alignment.horizontal, 'center')

  const operatingSheet = createAccountingReportWorkbook(ExcelJS, operating).getWorksheet('费用明细')
  const operatingHeader = findHeaderRow(operatingSheet, '费用编号')
  const operatingData = operatingHeader + 1
  assert.equal(
    operatingSheet.getCell(operatingData, headerColumn(operatingSheet, operatingHeader, '日期')).alignment.horizontal,
    'center',
  )
  assert.equal(
    operatingSheet.getCell(operatingData, headerColumn(operatingSheet, operatingHeader, '金额')).alignment.horizontal,
    'right',
  )

  const purchaseWorkbook = createAccountingReportWorkbook(ExcelJS, purchase)
  const purchaseSummary = purchaseWorkbook.getWorksheet('对账汇总')
  const purchaseSummaryRow = findValueRow(purchaseSummary, '采购成本')
  const purchaseSummaryValue = purchaseSummary.getCell(purchaseSummaryRow, 2)
  assert.equal(purchaseSummaryValue.value, 5000)
  assert.equal(purchaseSummaryValue.numFmt, ACCOUNTING_REPORT_MONEY_FORMAT)
  assert.equal(purchaseSummaryValue.alignment.horizontal, 'right')
  const purchaseDetail = purchaseWorkbook.getWorksheet('对账明细')
  const purchaseHeader = findHeaderRow(purchaseDetail, '采购编号')
  const purchaseData = purchaseHeader + 1
  for (const label of ['日期', '付款状态', '发票状态']) {
    assert.equal(
      purchaseDetail.getCell(purchaseData, headerColumn(purchaseDetail, purchaseHeader, label)).alignment.horizontal,
      'center',
      label,
    )
  }

  const monthlySheet = createAccountingReportWorkbook(ExcelJS, monthly).getWorksheet('月度汇总')
  const moneyRow = findValueRow(monthlySheet, '公司总成本')
  const percentRow = findValueRow(monthlySheet, '项目人工分摊率')
  assert.equal(monthlySheet.getCell(moneyRow, 2).value, 654321)
  assert.equal(monthlySheet.getCell(moneyRow, 2).numFmt, ACCOUNTING_REPORT_MONEY_FORMAT)
  assert.equal(monthlySheet.getCell(percentRow, 2).value, 80)
  assert.equal(monthlySheet.getCell(percentRow, 2).numFmt, '0.####"%"')
  assert.equal(monthlySheet.getCell(percentRow, 2).alignment.horizontal, 'right')
})

test('forced-multipage salary repeats its exact header while monthly repeats only safe metadata', () => {
  const salary = createSalaryReport({
    records: Array.from({ length: 80 }, (_, index) => ({
      salaryRecordId: `SR-${index + 1}`, salaryMonth: '2026-08', employeeId: `E-${index + 1}`,
      employeeName: `社员${index + 1}`, baseSalary: 1000 + index, workDays: 20,
      overtimePay: 0, bonus: 0, deduction: 0, netSalary: 1000 + index,
      createdAt: '2026-08-31', remark: '跨页验证',
    })),
    month: '2026-08', preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })
  const salarySheet = createAccountingReportWorkbook(ExcelJS, salary).getWorksheet('工资明细')
  const salaryHeader = findHeaderRow(salarySheet, '工资编号')
  assert.ok(salarySheet.rowCount > 80)
  assert.equal(salarySheet.pageSetup.printTitlesRow, `1:${salaryHeader}`)

  const monthly = createMonthlySummaryReport({
    month: '2026-08',
    coreMetrics: Array.from({ length: 60 }, (_, index) => ({
      label: `成本指标${index + 1}`, value: index + 1, format: 'money',
    })),
    sourceMetrics: [], pendingMetrics: [], notes: ['强制多页结构验证'],
    preparedBy: '会计甲', generatedAt: '2026-08-12T03:04:05.678Z',
  })
  const monthlySheet = createAccountingReportWorkbook(ExcelJS, monthly).getWorksheet('月度汇总')
  const noticeRow = findValueRow(monthlySheet, monthly.editableNotice)
  const firstSectionHeader = findHeaderRow(monthlySheet, '汇总项目')
  assert.ok(monthlySheet.rowCount > 120)
  assert.equal(monthlySheet.pageSetup.printTitlesRow, `1:${noticeRow}`)
  assert.ok(noticeRow < firstSectionHeader - 1)
})

test('keeps the ExcelJS dependency dynamic at the export boundary', async () => {
  const source = await readFile(new URL('./accountingReportExport.js', import.meta.url), 'utf8')

  assert.match(source, /import\('exceljs'\)/u)
})

test('revokes the Blob URL after clicking a guarded workbook download', async () => {
  const originalDocument = globalThis.document
  const originalURL = globalThis.URL
  const originalBlob = globalThis.Blob
  const link = { clickCount: 0, click() { this.clickCount += 1 } }
  const calls = []
  globalThis.document = {
    body: { appendChild(node) { calls.push(['append', node]) }, removeChild(node) { calls.push(['remove', node]) } },
    createElement() { return link },
  }
  globalThis.URL = {
    createObjectURL(blob) { calls.push(['create', blob]); return 'blob:workbook' },
    revokeObjectURL(url) { calls.push(['revoke', url]) },
  }
  globalThis.Blob = class Blob { constructor(parts, options) { this.parts = parts; this.options = options } }

  try {
    assert.equal(await exportAccountingReportXlsx(createReport(), { outputGuard: () => true }), true)
    assert.equal(link.download, '工资_付款_2026-08.xlsx')
    assert.equal(link.clickCount, 1)
    assert.deepEqual(calls.map(([name]) => name), ['create', 'append', 'remove', 'revoke'])
  } finally {
    globalThis.document = originalDocument
    globalThis.URL = originalURL
    globalThis.Blob = originalBlob
  }
})

test('cancels export when the guard turns false before link click', async () => {
  const originalDocument = globalThis.document
  const originalURL = globalThis.URL
  const originalBlob = globalThis.Blob
  let clickCount = 0
  let revocations = 0
  globalThis.document = {
    body: { appendChild() {}, removeChild() {} },
    createElement() { return { click() { clickCount += 1 } } },
  }
  globalThis.URL = {
    createObjectURL() { return 'blob:cancelled' },
    revokeObjectURL() { revocations += 1 },
  }
  globalThis.Blob = class Blob { constructor() {} }
  let checks = 0

  try {
    assert.equal(await exportAccountingReportXlsx(createReport(), {
      outputGuard: () => { checks += 1; return checks < 3 },
    }), false)
    assert.equal(checks, 3)
    assert.equal(clickCount, 0)
    assert.equal(revocations, 0)
  } finally {
    globalThis.document = originalDocument
    globalThis.URL = originalURL
    globalThis.Blob = originalBlob
  }
})

test('restores the exact body class after print success and failure', () => {
  const documentRef = { body: { className: 'app-shell  compact' } }
  printAccountingReport(() => {
    assert.equal(documentRef.body.className, 'app-shell  compact accounting-report-printing')
  }, documentRef)
  assert.equal(documentRef.body.className, 'app-shell  compact')

  assert.throws(() => printAccountingReport(() => {
    throw new Error('printer unavailable')
  }, documentRef), /printer unavailable/u)
  assert.equal(documentRef.body.className, 'app-shell  compact')
})

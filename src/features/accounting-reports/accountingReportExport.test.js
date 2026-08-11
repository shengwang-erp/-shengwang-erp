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
  assert.equal(sheet.pageSetup.printTitlesRow, `1:${firstHeaderRow}`)
  assert.match(sheet.pageSetup.printArea, /^A1:C\d+$/u)
  assert.equal(sheet.autoFilter, null)
})

test('adds an auto-filter only when a sheet contains one detail section', () => {
  const report = createReport({ sections: [createReport().sections[0]], recordCount: 1 })
  const sheet = createAccountingReportWorkbook(ExcelJS, report).getWorksheet('核对')
  const headerRow = findHeaderRow(sheet, '员工')

  assert.deepEqual(sheet.autoFilter, { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: 3 } })
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

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ExcelJS from 'exceljs'

import { createProjectCostWorkbook } from './projectCostLedgerExport.js'

const MONEY_FORMAT = '¥#,##0.0000;[Red]-¥#,##0.0000'

const ledgerSnapshot = Object.freeze({
  status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', page: 1, pageSize: 20,
  totalRows: 2, totalAmount: 120.25, adjustmentTotal: -9.75, incompleteSources: [],
  categoryTotals: Object.freeze([
    Object.freeze({ category: '材料费', amount: 100.25 }),
    Object.freeze({ category: '人工费', amount: 20 }),
  ]),
  rows: Object.freeze([
    Object.freeze({
      sourceKey: 'warehouse:OUT-1', sourceModule: 'warehouse', sourceDocumentType: 'warehouse_outflow',
      sourceDocumentId: 'OUT-1', projectId: 'P-1', projectName: '东京站项目', category: '材料费',
      date: '2026-08-09', description: '=HYPERLINK("https://evil")', originalAmount: 110,
      adjustmentAmount: -9.75, effectiveAmount: 100.25, operator: '@仓库员', adjusted: true,
      version: 2, allocations: Object.freeze([Object.freeze({ projectId: 'P-1', amount: 100.25 })]),
      auditEvents: Object.freeze([]),
    }),
    Object.freeze({
      sourceKey: 'labor:LAB-1', sourceModule: 'labor', sourceDocumentType: 'project_labor',
      sourceDocumentId: 'LAB-1', projectId: 'P-1', projectName: '东京站项目', category: '人工费',
      date: '2026-08-10', description: '+现场安装', originalAmount: 20,
      adjustmentAmount: 0, effectiveAmount: 20, operator: '施工员', adjusted: false,
      version: 1, allocations: Object.freeze([Object.freeze({ projectId: 'P-1', amount: 20 })]),
      auditEvents: Object.freeze([]),
    }),
  ]),
})

const auditSnapshot = Object.freeze({
  status: 'ready', generatedAt: '2026-08-10T03:00:01.000Z',
  events: Object.freeze([Object.freeze({
    eventType: 'adjustment', sourceKey: 'warehouse:OUT-1', sequenceNo: 1,
    amountBefore: 110, amountAfter: 100.25, adjustmentAmount: -9.75,
    allocationsBefore: null, allocationsAfter: null, reason: '-供应商折扣',
    actorName: '+会计甲', createdAt: '2026-08-10T02:00:00.000Z',
  })]),
})

const metadata = Object.freeze({
  companyName: '生旺株式会社', projectName: '东京站项目',
  filterSummary: '材料费与人工费', dateRange: '2026-08-01 至 2026-08-31',
  generatedAt: '2026-08-10T04:05:06.000Z', reportComplete: true,
})

test('project cost workbook keeps exactly three readable A4 landscape sheets', () => {
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  assert.deepEqual(workbook.worksheets.map(({ name }) => name), [
    '项目成本明细', '分类汇总', '调整记录',
  ])
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0].state, 'frozen')
    assert.equal(sheet.views[0].ySplit, 6)
    assert.ok(sheet.autoFilter)
    assert.equal(sheet.pageSetup.orientation, 'landscape')
    assert.equal(sheet.pageSetup.paperSize, 9)
    assert.equal(sheet.pageSetup.fitToWidth, 1)
    assert.equal(sheet.pageSetup.printTitlesRow, '1:6')
    assert.match(sheet.pageSetup.printArea, /^A1:/u)
    assert.ok(sheet.columns.every(({ width }) => width >= 12))
    assert.match(String(sheet.getCell('A2').value), /生旺株式会社/u)
    assert.match(String(sheet.getCell('A3').value), /东京站项目/u)
    assert.match(String(sheet.getCell('A5').value), /完整/u)
  }
})

test('detail and summary sheets contain fixed-point subtotals, formulas and project total', () => {
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  const detail = workbook.getWorksheet('项目成本明细')
  const categoryRows = detail.getRows(1, detail.rowCount).filter((row) =>
    typeof row.getCell(1).value === 'string' && row.getCell(1).value.endsWith('小计'))
  assert.equal(categoryRows.length, 2)
  assert.deepEqual(categoryRows.map((row) => row.getCell(8).value.result), [100.25, 20])
  assert.ok(categoryRows.every((row) => typeof row.getCell(8).value.formula === 'string'))
  const totalRow = detail.getRows(1, detail.rowCount).find((row) => row.getCell(1).value === '项目总计')
  assert.equal(totalRow.getCell(8).value.result, 120.25)
  assert.match(totalRow.getCell(8).value.formula, /^SUM\(/u)
  for (const row of [...categoryRows, totalRow]) assert.equal(row.getCell(8).numFmt, MONEY_FORMAT)

  const summary = workbook.getWorksheet('分类汇总')
  const summaryTotal = summary.getRows(1, summary.rowCount).find((row) => row.getCell(1).value === '项目总计')
  assert.equal(summaryTotal.getCell(2).value.result, 120.25)
  assert.match(summaryTotal.getCell(2).value.formula, /^SUM\(/u)
  assert.equal(summaryTotal.getCell(2).numFmt, MONEY_FORMAT)
})

test('business and audit text is formula-safe while audit identity and reason remain visible', () => {
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  const detail = workbook.getWorksheet('项目成本明细')
  const descriptionCell = detail.getRows(7, detail.rowCount - 6)
    .flatMap((row) => row.values.slice(1)).find((value) => String(value).includes('HYPERLINK'))
  assert.equal(descriptionCell, "'=HYPERLINK(\"https://evil\")")
  assert.ok(detail.getRows(7, detail.rowCount - 6).flatMap((row) => row.values.slice(1)).includes("'@仓库员"))

  const audit = workbook.getWorksheet('调整记录')
  const dataRow = audit.getRow(7)
  assert.equal(dataRow.getCell(9).value, "'-供应商折扣")
  assert.equal(dataRow.getCell(10).value, "'+会计甲")
  assert.equal(dataRow.getCell(11).value, '2026-08-10T02:00:00.000Z')
  for (const column of [4, 5, 6]) assert.equal(dataRow.getCell(column).numFmt, MONEY_FORMAT)
})

test('empty reports use zero formulas without self-referencing total cells', () => {
  const emptySnapshot = {
    ...ledgerSnapshot, totalRows: 0, totalAmount: 0, adjustmentTotal: 0, rows: [], categoryTotals: [],
  }
  const workbook = createProjectCostWorkbook(ExcelJS, emptySnapshot, { ...auditSnapshot, events: [] }, metadata)
  const detail = workbook.getWorksheet('项目成本明细')
  const summary = workbook.getWorksheet('分类汇总')
  assert.deepEqual(detail.getCell('H7').value, { formula: '0' })
  assert.deepEqual(summary.getCell('B7').value, { formula: '0' })
})

test('production Excel entry retains a literal dynamic ExcelJS import', async () => {
  const source = await readFile(new URL('./projectCostLedgerExport.js', import.meta.url), 'utf8')
  assert.match(source, /import\(\s*['"]exceljs['"]\s*\)/u)
  assert.doesNotMatch(source, /^\s*import\s+[^('\n]+from\s+['"]exceljs['"]/mu)
})

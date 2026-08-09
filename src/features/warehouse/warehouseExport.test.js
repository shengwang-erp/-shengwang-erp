import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ExcelJS from 'exceljs'

import {
  buildWarehouseReportRows,
  createWarehouseReportWorkbook,
  escapeSpreadsheetText,
  printWarehouseReport,
  WAREHOUSE_REPORTS,
} from './warehouseExport.js'

const source = await readFile(new URL('./warehouseExport.js', import.meta.url), 'utf8')

test('report registry covers all nine authoritative server report types', () => {
  assert.deepEqual(WAREHOUSE_REPORTS.map((report) => report.id), [
    'items', 'current_stock', 'receipts', 'issues', 'returns',
    'transfers', 'stocktakes', 'low_stock', 'movements',
  ])
  for (const report of WAREHOUSE_REPORTS) {
    assert.match(report.title, /[\p{Script=Han}]/u)
    assert.ok(report.columns.length > 0)
  }
})

test('production export keeps ExcelJS behind a literal dynamic import', () => {
  assert.match(source, /import\(\s*['"]exceljs['"]\s*\)/u)
  assert.doesNotMatch(source, /^\s*import\s+[^('\n]+from\s+['"]exceljs['"]/mu)
  assert.doesNotMatch(source, /require\(\s*['"]exceljs['"]\s*\)/u)
})

test('row mapping selects only declared columns and does not filter or invent inventory data', () => {
  const sourceRows = [{
    variantId: '93000000-0000-4000-8000-000000000001',
    itemName: '铜管', category: '材料', model: 'R410A', size: '6mm',
    sku: 'CU-6', unit: '米', quantity: 8, minimumStock: 10,
    shortageQuantity: 2, unitCost: null, totalCost: null, forged: 'drop me',
  }]
  const mapped = buildWarehouseReportRows('low_stock', sourceRows)
  assert.deepEqual(mapped, [{
    itemName: '铜管', model: 'R410A', size: '6mm', sku: 'CU-6', category: '材料',
    quantity: 8, unit: '米', minimumStock: 10, shortageQuantity: 2,
    unitCost: null, totalCost: null,
  }])
  assert.notEqual(mapped[0], sourceRows[0])
  assert.equal(sourceRows[0].forged, 'drop me')
  assert.throws(() => buildWarehouseReportRows('unknown', sourceRows), TypeError)
  assert.throws(() => buildWarehouseReportRows('low_stock', {}), TypeError)
})

test('formula-leading spreadsheet text is escaped while numeric cells remain numeric', () => {
  for (const value of ['=2+2', '+CMD', '-1+2', '@SUM(A1:A2)', '\t=2+2', ' \n@evil']) {
    assert.equal(escapeSpreadsheetText(value), `'${value}`)
  }
  assert.equal(escapeSpreadsheetText('铜管'), '铜管')
  assert.equal(escapeSpreadsheetText(12.5), 12.5)
  assert.equal(escapeSpreadsheetText(null), '')
})

test('workbook contains title, company, timestamp, filter summary, frozen header and safe cells', async () => {
  const workbook = createWarehouseReportWorkbook(ExcelJS, 'low_stock', [{
    variantId: '93000000-0000-4000-8000-000000000001',
    itemName: '=HYPERLINK("https://evil")', category: '@分类', model: 'R410A', size: '6mm',
    sku: 'CU-6', unit: '米', quantity: 8, minimumStock: 10,
    shortageQuantity: 2, unitCost: 120.5, totalCost: 964,
  }], {
    companyName: '生旺株式会社',
    generatedAt: '2026-08-09T01:02:03Z',
    filterSummary: '分类：材料',
  })
  const sheet = workbook.getWorksheet('低库存报表')
  assert.equal(sheet.getCell('A1').value, '低库存报表')
  assert.equal(sheet.getCell('A2').value, '生旺株式会社')
  assert.match(String(sheet.getCell('A3').value), /2026-08-09/u)
  assert.equal(sheet.getCell('A4').value, '筛选条件：分类：材料')
  assert.equal(sheet.views[0].state, 'frozen')
  assert.equal(sheet.views[0].ySplit, 5)
  assert.equal(sheet.getRow(5).values.slice(1)[0], '物品名称')
  assert.equal(sheet.getRow(6).getCell(1).value, "'=HYPERLINK(\"https://evil\")")
  assert.equal(sheet.getRow(6).getCell(5).value, "'@分类")
  assert.equal(typeof sheet.getRow(6).getCell(6).value, 'number')
  assert.equal(typeof sheet.getRow(6).getCell(10).value, 'number')
  assert.ok(sheet.autoFilter)

  const buffer = await workbook.xlsx.writeBuffer()
  const loaded = new ExcelJS.Workbook()
  await loaded.xlsx.load(buffer)
  assert.equal(loaded.getWorksheet('低库存报表').getCell('A6').value, "'=HYPERLINK(\"https://evil\")")
})

test('print scope exists only during the print call and is restored after success or failure', () => {
  for (const fails of [false, true]) {
    const body = { className: 'erp-black-gold' }
    const documentRef = { body }
    const operation = () => {
      assert.match(body.className, /warehouse-report-printing/u)
      if (fails) throw new Error('print failed')
    }
    if (fails) assert.throws(() => printWarehouseReport(operation, documentRef), /print failed/u)
    else printWarehouseReport(operation, documentRef)
    assert.equal(body.className, 'erp-black-gold')
  }
})

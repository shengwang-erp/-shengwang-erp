import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ExcelJS from 'exceljs'

import {
  buildMiraisyaInvoiceWorkbook,
  downloadMiraisyaInvoice,
  formatMiraisyaInvoiceFilename,
} from './miraisyaInvoiceExport.js'

const templateUrl = new URL('../../../public/templates/miraisya-invoice-template.xlsx', import.meta.url)
const sourceUrl = new URL('./miraisyaInvoiceExport.js', import.meta.url)

function makeItem(projectIndex, itemIndex, taxRate = 10) {
  const quantity = itemIndex + 1
  const unitPrice = 10_000 + (projectIndex * 1_000) + (itemIndex * 500)
  const taxExclusiveAmount = quantity * unitPrice
  const taxAmount = Math.round(taxExclusiveAmount * taxRate / 100)
  return {
    itemName: `工事项${projectIndex + 1}-${itemIndex + 1}`,
    description: itemIndex === 0 ? '材料与施工' : '停车费',
    quantity,
    unit: itemIndex === 0 ? '式' : '回',
    unitPrice,
    taxRate,
    taxExclusiveAmount,
    taxAmount,
    taxInclusiveAmount: taxExclusiveAmount + taxAmount,
  }
}

function makeSettlement(projectCount = 6) {
  const projects = Array.from({ length: projectCount }, (_, projectIndex) => {
    const items = [
      makeItem(projectIndex, 0, projectIndex === 1 ? 0 : 10),
      makeItem(projectIndex, 1, 10),
    ]
    const totals = items.reduce((sum, item) => ({
      taxExclusiveAmount: sum.taxExclusiveAmount + item.taxExclusiveAmount,
      taxAmount: sum.taxAmount + item.taxAmount,
      taxInclusiveAmount: sum.taxInclusiveAmount + item.taxInclusiveAmount,
    }), { taxExclusiveAmount: 0, taxAmount: 0, taxInclusiveAmount: 0 })
    return {
      projectId: `mirai-${projectIndex + 1}`,
      projectName: `未来舎维修项目 ${projectIndex + 1}`,
      address: `東京都测试区${projectIndex + 1}-2-3`,
      completionDate: `2026-08-${String(projectIndex + 1).padStart(2, '0')}`,
      billingVersion: 1,
      costSnapshotToken: String(projectIndex + 1).repeat(64),
      costAmount: 5_000 + projectIndex,
      ...totals,
      items,
    }
  })
  const totals = projects.reduce((sum, project) => ({
    taxExclusiveAmount: sum.taxExclusiveAmount + project.taxExclusiveAmount,
    taxAmount: sum.taxAmount + project.taxAmount,
    taxInclusiveAmount: sum.taxInclusiveAmount + project.taxInclusiveAmount,
    totalCostAmount: sum.totalCostAmount + project.costAmount,
  }), { taxExclusiveAmount: 0, taxAmount: 0, taxInclusiveAmount: 0, totalCostAmount: 0 })
  return {
    id: '34d774ce-a63b-4b7c-b604-4b7b2a7d377a',
    invoiceNo: 'MIRAI-202608-001',
    month: '2026-08',
    issueDate: '2026-08-11',
    status: 'confirmed',
    version: 2,
    ...totals,
    marginAmount: totals.taxExclusiveAmount - totals.totalCostAmount,
    projects,
    createdAt: '2026-08-11T01:02:03.000Z',
    createdByName: '财务担当',
    confirmedAt: '2026-08-11T01:05:00.000Z',
    confirmedByName: '社长',
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
  }
}

test('builds an editable request workbook from the exact template with formulas and pagination', async () => {
  const template = await readFile(templateUrl)
  const settlement = makeSettlement()
  const workbook = await buildMiraisyaInvoiceWorkbook(ExcelJS, template, settlement)
  const sheet = workbook.getWorksheet('Sheet2')

  assert.equal(sheet.getCell('A1').value, '請')
  assert.equal(sheet.getCell('C1').value, '求')
  assert.equal(sheet.getCell('A4').value, '書')
  assert.equal(sheet.getCell('A1').isMerged, true)
  assert.equal(sheet.getCell('H2').value, '2026 年8月 11日')
  assert.equal(sheet.getCell('G3').value, '請求書番号：')
  assert.equal(sheet.getCell('H3').value, 'MIRAI-202608-001')
  assert.equal(sheet.getCell('A7').value, '株式会社未来舎サポート')
  assert.equal(sheet.getCell('F5').value, '　生旺　株　式　会　社')
  assert.equal(sheet.getCell('G13').value, '銀 行 名')
  assert.equal(sheet.getCell('H16').value, 2244411)
  assert.equal(sheet.getImages().length, 1)
  assert.equal(sheet.protection.sheet, false)
  assert.match(sheet.pageSetup.printArea, /^A1:H\d+$/u)
  assert.ok(sheet.rowCount > 72, 'six projects must expand beyond the original template body')
  assert.ok(sheet.rowBreaks.length >= 1, 'long requests must contain printable page breaks')

  const firstItemRow = 22
  assert.equal(sheet.getCell(`F${firstItemRow}`).value.formula, `C${firstItemRow}*E${firstItemRow}`)
  assert.match(sheet.getCell(`G${firstItemRow}`).value.formula, new RegExp(`F${firstItemRow}`))
  assert.equal(sheet.getCell(`H${firstItemRow}`).value.formula, `SUM(F${firstItemRow},G${firstItemRow})`)

  const grandTotalRow = Number(sheet.pageSetup.printArea.match(/\d+$/u)[0])
  assert.match(sheet.getCell(`F${grandTotalRow}`).value.formula, /SUM\(/u)
  assert.equal(sheet.getCell('C13').value.formula, `F${grandTotalRow}`)
  assert.equal(sheet.getCell(`F${grandTotalRow}`).value.result, settlement.taxInclusiveAmount)
})

test('uses the standard editable filename and browser-safe lazy loading', async () => {
  assert.equal(
    formatMiraisyaInvoiceFilename(makeSettlement(1)),
    '株式会社未来舎サポート_2026年08月_請求書_MIRAI-202608-001.xlsx',
  )
  const source = await readFile(sourceUrl, 'utf8')
  assert.match(source, /import\('exceljs'\)/u)
  assert.match(source, /fetch\('\/templates\/miraisya-invoice-template\.xlsx'/u)
  assert.match(source, /getSettlementVersion/u)
})

test('refuses to download a stale settlement version', async () => {
  const template = await readFile(templateUrl)
  await assert.rejects(
    downloadMiraisyaInvoice(makeSettlement(1), {
      fetch: async () => ({ ok: true, arrayBuffer: async () => template }),
      getSettlementVersion: async () => 3,
    }),
    /月度结算已更新/u,
  )
})

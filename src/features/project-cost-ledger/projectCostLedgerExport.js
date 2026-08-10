import { fromFourDecimalUnits, toSignedFourDecimalUnits } from '../cost-accounting/fixedPointCurrency.js'

export const PROJECT_COST_MONEY_FORMAT = '¥#,##0.0000;[Red]-¥#,##0.0000'

const SHEET_NAMES = Object.freeze(['项目成本明细', '分类汇总', '调整记录'])
const SOURCE_LABELS = Object.freeze({
  purchase: '采购', warehouse: '仓库', labor: '人工', vehicle: '车辆', tool: '工具',
  operating: '经营费用', manual: '手工费用',
})

export function escapeProjectCostSpreadsheetText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return value
  return /^(?:[\u0000-\u0020]*[=+\-@]|[\t\r\n])/u.test(value) ? `'${value}` : value
}

function metadataText(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function reportMetadata(metadata, snapshot) {
  const generatedAt = metadataText(metadata?.generatedAt, snapshot?.generatedAt || new Date().toISOString())
  return {
    companyName: metadataText(metadata?.companyName, '生旺株式会社'),
    projectName: metadataText(metadata?.projectName, '全部项目'),
    filterSummary: metadataText(metadata?.filterSummary, '全部项目'),
    dateRange: metadataText(metadata?.dateRange, '全部日期'),
    generatedAt,
    reportComplete: metadata?.reportComplete !== false && (snapshot?.incompleteSources?.length ?? 0) === 0,
  }
}

function moneySum(values) {
  let units = 0
  for (const value of values) {
    const next = toSignedFourDecimalUnits(value)
    if (next === null || !Number.isSafeInteger(units + next)) throw new TypeError('项目成本金额无效')
    units += next
  }
  return fromFourDecimalUnits(units)
}

function safeCell(value) {
  return escapeProjectCostSpreadsheetText(value)
}

function applyTitleRows(sheet, title, columns, metadata) {
  for (let row = 1; row <= 5; row += 1) sheet.mergeCells(row, 1, row, columns)
  sheet.getCell('A1').value = title
  sheet.getCell('A2').value = safeCell(`公司：${metadata.companyName}`)
  sheet.getCell('A3').value = safeCell(`项目/筛选：${metadata.projectName} · ${metadata.filterSummary}`)
  sheet.getCell('A4').value = safeCell(`统计日期：${metadata.dateRange}`)
  sheet.getCell('A5').value = safeCell(`生成时间：${metadata.generatedAt} · 报表状态：${metadata.reportComplete ? '完整' : '数据不完整'}`)
  sheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFC69A45' } }
  sheet.getCell('A2').font = { bold: true, size: 12 }
  for (let row = 1; row <= 5; row += 1) {
    sheet.getRow(row).height = row === 1 ? 28 : 21
    sheet.getCell(row, 1).alignment = { vertical: 'middle', wrapText: true }
  }
}

function applyHeader(sheet, headers) {
  const row = sheet.getRow(6)
  headers.forEach((header, index) => {
    const cell = row.getCell(index + 1)
    cell.value = header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF171513' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
  })
  row.height = 25
  sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6, column: headers.length } }
}

function applyPageSetup(sheet, lastColumn) {
  sheet.views = [{ state: 'frozen', ySplit: 6 }]
  Object.assign(sheet.pageSetup, {
    paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    horizontalCentered: true, printTitlesRow: '1:6',
    margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  })
  sheet.pageSetup.printArea = `A1:${columnLetter(lastColumn)}${Math.max(6, sheet.rowCount)}`
}

function columnLetter(number) {
  let value = number
  let result = ''
  while (value > 0) {
    value -= 1
    result = String.fromCharCode(65 + (value % 26)) + result
    value = Math.floor(value / 26)
  }
  return result
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = Math.max(12, width) })
}

function applyMoney(cell, value) {
  cell.value = value
  cell.numFmt = PROJECT_COST_MONEY_FORMAT
  cell.alignment = { vertical: 'middle', horizontal: 'right' }
}

function styleBodyRow(row, moneyColumns = []) {
  row.height = 24
  row.eachCell((cell, column) => {
    cell.alignment = {
      vertical: 'middle', horizontal: moneyColumns.includes(column) ? 'right' : 'left', wrapText: true,
    }
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFD8D1C4' } } }
  })
}

function groupRowsByCategory(rows) {
  const groups = new Map()
  for (const row of rows ?? []) {
    const group = groups.get(row.category)
    if (group) group.push(row)
    else groups.set(row.category, [row])
  }
  return groups
}

function allocationText(allocations) {
  if (!Array.isArray(allocations)) return ''
  return allocations.map(({ projectId, amount }) => `${projectId}: ${amount}`).join(' / ')
}

function buildDetailSheet(workbook, snapshot, metadata) {
  const sheet = workbook.addWorksheet(SHEET_NAMES[0])
  const headers = ['日期', '费用类别', '来源', '业务单号', '费用说明', '原金额', '会计调整', '最终金额', '项目', '经办人', '调整标记', '来源键']
  applyTitleRows(sheet, '项目成本明细', headers.length, metadata)
  applyHeader(sheet, headers)
  setWidths(sheet, [13, 14, 13, 18, 34, 16, 16, 16, 22, 16, 13, 28])

  const subtotalRows = []
  for (const [category, rows] of groupRowsByCategory(snapshot.rows)) {
    const start = sheet.rowCount + 1
    for (const source of rows) {
      const row = sheet.addRow([
        safeCell(source.date), safeCell(source.category), safeCell(SOURCE_LABELS[source.sourceModule] || source.sourceModule),
        safeCell(source.sourceDocumentId), safeCell(source.description), source.originalAmount,
        source.adjustmentAmount, source.effectiveAmount, safeCell(source.projectName || source.projectId),
        safeCell(source.operator), source.adjusted ? '已调整' : '原始', safeCell(source.sourceKey),
      ])
      for (const column of [6, 7, 8]) row.getCell(column).numFmt = PROJECT_COST_MONEY_FORMAT
      styleBodyRow(row, [6, 7, 8])
    }
    const end = sheet.rowCount
    const subtotal = sheet.addRow([])
    subtotal.getCell(1).value = safeCell(`${category}小计`)
    subtotal.getCell(1).font = { bold: true }
    subtotal.getCell(8).value = { formula: `SUM(H${start}:H${end})`, result: moneySum(rows.map(({ effectiveAmount }) => effectiveAmount)) }
    subtotal.getCell(8).numFmt = PROJECT_COST_MONEY_FORMAT
    subtotal.getCell(8).font = { bold: true }
    subtotal.getCell(8).alignment = { horizontal: 'right' }
    subtotalRows.push(subtotal.number)
  }
  const total = sheet.addRow([])
  total.getCell(1).value = '项目总计'
  total.getCell(1).font = { bold: true, size: 12 }
  const formula = subtotalRows.length ? `SUM(${subtotalRows.map((row) => `H${row}`).join(',')})` : '0'
  total.getCell(8).value = { formula, result: snapshot.totalAmount }
  total.getCell(8).numFmt = PROJECT_COST_MONEY_FORMAT
  total.getCell(8).font = { bold: true, size: 12 }
  total.getCell(8).alignment = { horizontal: 'right' }
  applyPageSetup(sheet, headers.length)
  return sheet
}

function buildSummarySheet(workbook, snapshot, metadata, detailSheet) {
  const sheet = workbook.addWorksheet(SHEET_NAMES[1])
  const headers = ['费用类别', '金额', '占项目总额', '记录说明']
  applyTitleRows(sheet, '分类汇总', headers.length, metadata)
  applyHeader(sheet, headers)
  setWidths(sheet, [22, 20, 20, 30])
  const first = 7
  for (const total of snapshot.categoryTotals) {
    const row = sheet.addRow([])
    row.getCell(1).value = safeCell(total.category)
    const detailEnd = Math.max(7, detailSheet.rowCount - 1)
    row.getCell(2).value = {
      formula: `SUMIF('项目成本明细'!$B$7:$B$${detailEnd},A${row.number},'项目成本明细'!$H$7:$H$${detailEnd})`,
      result: total.amount,
    }
    row.getCell(2).numFmt = PROJECT_COST_MONEY_FORMAT
    row.getCell(3).value = snapshot.totalAmount === 0 ? 0 : total.amount / snapshot.totalAmount
    row.getCell(3).numFmt = '0.00%'
    row.getCell(4).value = safeCell(`当前筛选明细：${total.category}`)
    styleBodyRow(row, [2, 3])
  }
  const total = sheet.addRow([])
  total.getCell(1).value = '项目总计'
  const last = total.number - 1
  total.getCell(2).value = {
    formula: last >= first ? `SUM(B${first}:B${last})` : '0',
    result: snapshot.totalAmount,
  }
  total.getCell(2).numFmt = PROJECT_COST_MONEY_FORMAT
  total.getCell(3).value = snapshot.totalAmount === 0 ? 0 : 1
  total.getCell(3).numFmt = '0.00%'
  total.font = { bold: true, size: 12 }
  applyPageSetup(sheet, headers.length)
  return sheet
}

function buildAuditSheet(workbook, auditSnapshot, metadata) {
  const sheet = workbook.addWorksheet(SHEET_NAMES[2])
  const headers = ['来源键', '事件类型', '序号', '调整前', '调整值', '调整后', '调整前分摊', '调整后分摊', '修改原因', '修改人', '修改时间']
  applyTitleRows(sheet, '调整记录', headers.length, metadata)
  applyHeader(sheet, headers)
  setWidths(sheet, [28, 16, 12, 16, 16, 16, 32, 32, 28, 18, 24])
  for (const event of auditSnapshot.events ?? []) {
    const row = sheet.addRow([
      safeCell(event.sourceKey), safeCell(event.eventType === 'allocation' ? '项目拆分' : '金额调整'),
      event.sequenceNo, event.amountBefore, event.adjustmentAmount, event.amountAfter,
      safeCell(allocationText(event.allocationsBefore)), safeCell(allocationText(event.allocationsAfter)),
      safeCell(event.reason), safeCell(event.actorName), safeCell(event.createdAt),
    ])
    for (const column of [4, 5, 6]) row.getCell(column).numFmt = PROJECT_COST_MONEY_FORMAT
    styleBodyRow(row, [3, 4, 5, 6])
  }
  applyPageSetup(sheet, headers.length)
  return sheet
}

export function createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata = {}) {
  if (!ExcelJS || typeof ExcelJS.Workbook !== 'function') throw new TypeError('Excel 服务不可用')
  if (!ledgerSnapshot || ledgerSnapshot.status !== 'ready' || !Array.isArray(ledgerSnapshot.rows) ||
      !Array.isArray(ledgerSnapshot.categoryTotals) || !auditSnapshot || auditSnapshot.status !== 'ready' ||
      !Array.isArray(auditSnapshot.events)) throw new TypeError('项目成本报表数据无效')
  const normalizedMetadata = reportMetadata(metadata, ledgerSnapshot)
  const workbook = new ExcelJS.Workbook()
  workbook.creator = normalizedMetadata.companyName
  workbook.created = new Date(normalizedMetadata.generatedAt)
  const detailSheet = buildDetailSheet(workbook, ledgerSnapshot, normalizedMetadata)
  buildSummarySheet(workbook, ledgerSnapshot, normalizedMetadata, detailSheet)
  buildAuditSheet(workbook, auditSnapshot, normalizedMetadata)
  return workbook
}

function safeFileName(value) {
  return metadataText(value, '项目成本明细').replace(/[\\/:*?"<>|]/gu, '_')
}

export async function exportProjectCostXlsx(ledgerSnapshot, auditSnapshot, metadata = {}) {
  const excelModule = await import('exceljs')
  const ExcelJS = excelModule.default ?? excelModule
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  const buffer = await workbook.xlsx.writeBuffer()
  const documentRef = globalThis.document
  const urlApi = globalThis.URL
  if (!documentRef || typeof documentRef.createElement !== 'function' ||
      typeof urlApi?.createObjectURL !== 'function' || typeof globalThis.Blob !== 'function') {
    throw new TypeError('当前环境不能下载 Excel')
  }
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const href = urlApi.createObjectURL(blob)
  const link = documentRef.createElement('a')
  try {
    link.href = href
    link.download = `${safeFileName(metadata.fileName || `${metadata.projectName || '项目成本'}_明细`)}.xlsx`
    link.rel = 'noopener'
    link.click()
  } finally {
    urlApi.revokeObjectURL(href)
  }
}

export function printProjectCostReport(
  printOperation = globalThis.print,
  documentRef = globalThis.document,
) {
  if (typeof printOperation !== 'function') throw new TypeError('当前环境不能打印')
  const body = documentRef?.body
  const previousClassName = typeof body?.className === 'string' ? body.className : null
  if (previousClassName !== null) body.className = `${previousClassName} project-cost-ledger-printing`.trim()
  try {
    printOperation.call(globalThis)
  } finally {
    if (previousClassName !== null) body.className = previousClassName
  }
}

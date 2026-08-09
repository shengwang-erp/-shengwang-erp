const column = (header, key, { numeric = false } = {}) => Object.freeze({
  header,
  key,
  numeric,
})

const report = (id, title, filters, columns) => Object.freeze({
  id,
  title,
  filters: Object.freeze(filters),
  columns: Object.freeze(columns),
})

const itemColumns = [
  column('物品名称', 'itemName'), column('分类', 'category'), column('品牌', 'brand'),
  column('型号', 'model'), column('尺寸', 'size'), column('材质', 'material'),
  column('物品编码', 'sku'), column('单位', 'unit'),
]
const stockIdentityColumns = [
  column('物品名称', 'itemName'), column('型号', 'model'), column('尺寸', 'size'),
  column('物品编码', 'sku'), column('分类', 'category'),
]
const locationColumns = [
  column('仓库', 'warehouseName'), column('货架编码', 'shelfCode'),
  column('货架名称', 'shelfName'),
]
const costColumns = [
  column('单价', 'unitCost', { numeric: true }),
  column('金额', 'totalCost', { numeric: true }),
]

export const WAREHOUSE_REPORTS = Object.freeze([
  report('items', '物品档案报表', ['category', 'keyword', 'status'], [
    ...itemColumns,
    column('最低库存', 'minimumStock', { numeric: true }),
    column('物品状态', 'itemStatus'), column('型号状态', 'variantStatus'),
    ...costColumns,
  ]),
  report('current_stock', '当前库存报表', ['warehouseId', 'locationId', 'category', 'variantId', 'keyword'], [
    ...stockIdentityColumns, ...locationColumns,
    column('数量', 'quantity', { numeric: true }), column('单位', 'unit'), ...costColumns,
  ]),
  report('receipts', '采购入库报表', ['dateFrom', 'dateTo', 'warehouseId', 'locationId', 'category', 'variantId', 'status', 'keyword'], [
    column('日期', 'date'), column('入库单号', 'receiptId'), column('采购单号', 'purchaseRecordKey'),
    ...stockIdentityColumns, ...locationColumns,
    column('数量', 'quantity', { numeric: true }), column('单位', 'unit'),
    column('状态', 'status'), column('经办人', 'operator'), column('原因', 'reason'), ...costColumns,
  ]),
  report('issues', '出库报表', ['dateFrom', 'dateTo', 'projectId', 'destinationType', 'warehouseId', 'locationId', 'category', 'variantId', 'status', 'keyword'], [
    column('日期', 'date'), column('出库单号', 'issueId'), ...stockIdentityColumns,
    ...locationColumns, column('数量', 'quantity', { numeric: true }), column('单位', 'unit'),
    column('去向类型', 'destinationType'), column('去向名称', 'destinationName'),
    column('领用人', 'receiver'), column('状态', 'status'), column('经办人', 'operator'),
    column('原因', 'reason'), ...costColumns,
  ]),
  report('returns', '退回报表', ['dateFrom', 'dateTo', 'projectId', 'destinationType', 'warehouseId', 'locationId', 'category', 'variantId', 'status', 'keyword'], [
    column('日期', 'date'), column('退回单号', 'returnId'), column('原出库单号', 'originalIssueId'),
    ...stockIdentityColumns, ...locationColumns,
    column('数量', 'quantity', { numeric: true }), column('单位', 'unit'),
    column('去向类型', 'destinationType'), column('去向名称', 'destinationName'),
    column('退回人', 'receiver'), column('状态', 'status'), column('经办人', 'operator'),
    column('原因', 'reason'), ...costColumns,
  ]),
  report('transfers', '调拨报表', ['dateFrom', 'dateTo', 'warehouseId', 'locationId', 'category', 'variantId', 'status', 'keyword'], [
    column('日期', 'date'), column('调拨单号', 'transferId'), ...stockIdentityColumns,
    column('调出仓库', 'sourceWarehouseName'), column('调出货架编码', 'sourceShelfCode'),
    column('调出货架名称', 'sourceShelfName'), column('调入仓库', 'destinationWarehouseName'),
    column('调入货架编码', 'destinationShelfCode'), column('调入货架名称', 'destinationShelfName'),
    column('数量', 'quantity', { numeric: true }), column('单位', 'unit'),
    column('状态', 'status'), column('经办人', 'operator'), column('原因', 'reason'), ...costColumns,
  ]),
  report('stocktakes', '盘点报表', ['dateFrom', 'dateTo', 'month', 'warehouseId', 'locationId', 'category', 'variantId', 'status', 'keyword'], [
    column('日期', 'date'), column('盘点单号', 'stocktakeId'), column('盘点月份', 'month'),
    ...stockIdentityColumns, ...locationColumns,
    column('账面数量', 'bookQuantity', { numeric: true }),
    column('实盘数量', 'countedQuantity', { numeric: true }),
    column('差异数量', 'quantityDelta', { numeric: true }), column('差异类型', 'differenceType'),
    column('单位', 'unit'), column('状态', 'status'), column('经办人', 'operator'),
    column('原因', 'reason'), ...costColumns,
  ]),
  report('low_stock', '低库存报表', ['category', 'variantId', 'keyword'], [
    ...stockIdentityColumns, column('数量', 'quantity', { numeric: true }), column('单位', 'unit'),
    column('最低库存', 'minimumStock', { numeric: true }),
    column('短缺数量', 'shortageQuantity', { numeric: true }), ...costColumns,
  ]),
  report('movements', '库存流水报表', ['dateFrom', 'dateTo', 'projectId', 'destinationType', 'warehouseId', 'locationId', 'category', 'variantId', 'keyword'], [
    column('日期', 'date'), column('流水类型', 'movementType'),
    column('来源类型', 'sourceDocumentType'), column('来源单号', 'sourceDocumentId'),
    ...stockIdentityColumns, ...locationColumns,
    column('正负数量', 'quantityDelta', { numeric: true }), column('单位', 'unit'),
    column('去向类型', 'destinationType'), column('去向名称', 'destinationName'),
    column('经办人', 'operator'), column('原因', 'reason'), ...costColumns,
  ]),
])

const REPORT_BY_ID = new Map(WAREHOUSE_REPORTS.map((entry) => [entry.id, entry]))

function getReport(reportType) {
  const selected = REPORT_BY_ID.get(reportType)
  if (!selected) throw new TypeError('仓库报表类型无效')
  return selected
}

export function buildWarehouseReportRows(reportType, rows) {
  const selected = getReport(reportType)
  if (!Array.isArray(rows)) throw new TypeError('仓库报表数据无效')
  return rows.map((row) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new TypeError('仓库报表数据无效')
    }
    return Object.fromEntries(selected.columns.map(({ key }) => [key, row[key] ?? null]))
  })
}

export function escapeSpreadsheetText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return value
  return /^(?:[\u0000-\u0020]*[=+\-@]|[\t\r\n])/u.test(value) ? `'${value}` : value
}

const spreadsheetCell = (value, numeric) => {
  if (numeric) return typeof value === 'number' && Number.isFinite(value) ? value : ''
  return escapeSpreadsheetText(value)
}

export function createWarehouseReportWorkbook(ExcelJS, reportType, rows, metadata = {}) {
  const selected = getReport(reportType)
  if (!ExcelJS || typeof ExcelJS.Workbook !== 'function') {
    throw new TypeError('Excel 服务不可用')
  }
  const mappedRows = buildWarehouseReportRows(reportType, rows)
  const companyName = typeof metadata.companyName === 'string' && metadata.companyName.trim()
    ? metadata.companyName.trim()
    : '生旺株式会社'
  const generatedAt = typeof metadata.generatedAt === 'string' && metadata.generatedAt.trim()
    ? metadata.generatedAt.trim()
    : new Date().toISOString()
  const filterSummary = typeof metadata.filterSummary === 'string' && metadata.filterSummary.trim()
    ? metadata.filterSummary.trim()
    : '全部数据'

  const workbook = new ExcelJS.Workbook()
  workbook.creator = companyName
  workbook.created = new Date(generatedAt)
  const worksheet = workbook.addWorksheet(selected.title.slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 5 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 },
  })
  const lastColumn = Math.max(selected.columns.length, 1)
  for (let rowNumber = 1; rowNumber <= 4; rowNumber += 1) {
    worksheet.mergeCells(rowNumber, 1, rowNumber, lastColumn)
  }
  worksheet.getCell('A1').value = selected.title
  worksheet.getCell('A2').value = companyName
  worksheet.getCell('A3').value = `生成时间：${generatedAt}`
  worksheet.getCell('A4').value = `筛选条件：${filterSummary}`
  worksheet.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFC69A45' } }
  worksheet.getCell('A2').font = { bold: true, size: 12 }

  const header = worksheet.getRow(5)
  selected.columns.forEach((definition, index) => {
    const cell = header.getCell(index + 1)
    cell.value = definition.header
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF151515' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    worksheet.getColumn(index + 1).width = Math.max(12, Math.min(28, definition.header.length * 2 + 4))
  })
  header.height = 24

  mappedRows.forEach((row, rowIndex) => {
    const output = worksheet.getRow(rowIndex + 6)
    selected.columns.forEach((definition, columnIndex) => {
      const cell = output.getCell(columnIndex + 1)
      cell.value = spreadsheetCell(row[definition.key], definition.numeric)
      if (definition.numeric) cell.numFmt = '#,##0.####'
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
  })
  worksheet.autoFilter = {
    from: { row: 5, column: 1 },
    to: { row: 5, column: lastColumn },
  }
  worksheet.pageSetup.printTitlesRow = '1:5'
  return workbook
}

export async function exportWarehouseXlsx(reportType, rows, metadata = {}) {
  const excelModule = await import('exceljs')
  const ExcelJS = excelModule.default ?? excelModule
  const workbook = createWarehouseReportWorkbook(ExcelJS, reportType, rows, metadata)
  const buffer = await workbook.xlsx.writeBuffer()
  if (
    typeof document === 'undefined' ||
    typeof URL?.createObjectURL !== 'function' ||
    typeof Blob !== 'function'
  ) throw new TypeError('当前环境不能下载 Excel')
  const selected = getReport(reportType)
  const fileName = typeof metadata.fileName === 'string' && metadata.fileName.trim()
    ? metadata.fileName.trim().replace(/[\\/:*?"<>|]/gu, '_')
    : selected.title
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = href
    link.download = `${fileName}.xlsx`
    link.rel = 'noopener'
    link.click()
  } finally {
    URL.revokeObjectURL(href)
  }
}

export function printWarehouseReport(
  printOperation = globalThis.print,
  documentRef = globalThis.document,
) {
  if (typeof printOperation !== 'function') throw new TypeError('当前环境不能打印')
  const body = documentRef?.body
  const previousClassName = typeof body?.className === 'string' ? body.className : null
  if (previousClassName !== null) {
    body.className = `${previousClassName} warehouse-report-printing`.trim()
  }
  try {
    printOperation.call(globalThis)
  } finally {
    if (previousClassName !== null) body.className = previousClassName
  }
}

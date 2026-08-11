import { normalizeSettlement } from './miraisyaSettlementDomain.js'

const TEMPLATE_URL = '/templates/miraisya-invoice-template.xlsx'
const CUSTOMER_NAME = '株式会社未来舎サポート'
const BODY_START_ROW = 19
const ORIGINAL_LAST_ROW = 72
const MINIMUM_PROJECT_BLOCK_ROWS = 9

function cloneStyle(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {}
}

function snapshotRow(sheet, rowNumber) {
  const row = sheet.getRow(rowNumber)
  return Object.freeze({
    height: row.height,
    cells: Array.from({ length: 8 }, (_, index) => ({
      style: cloneStyle(row.getCell(index + 1).style),
      value: row.getCell(index + 1).value,
    })),
  })
}

function applyRowTemplate(sheet, rowNumber, template, { values = null } = {}) {
  const row = sheet.getRow(rowNumber)
  row.height = template.height
  for (let column = 1; column <= 8; column += 1) {
    const cell = row.getCell(column)
    cell.style = cloneStyle(template.cells[column - 1].style)
    cell.value = values ? (values[column - 1] ?? null) : null
  }
  return row
}

function unmergeGeneratedArea(sheet) {
  const mergedRanges = Object.values(sheet._merges || {})
    .map((range) => range?.model)
    .filter((range) => range && range.top >= BODY_START_ROW)
    .map((range) => sheet.getCell(range.top, range.left).address)
  for (const address of mergedRanges) sheet.unMergeCells(address)
}

function clearGeneratedArea(sheet, lastRow) {
  for (let rowNumber = BODY_START_ROW; rowNumber <= lastRow; rowNumber += 1) {
    const row = sheet.getRow(rowNumber)
    row.height = undefined
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.value = null
      cell.style = {}
    })
  }
  sheet.rowBreaks = []
}

function japaneseProjectDate(value) {
  const [, month, day] = value.split('-').map(Number)
  return `${month}/${day}`
}

function projectHeading(project) {
  return [project.address, project.projectName, japaneseProjectDate(project.completionDate)]
    .filter(Boolean)
    .join('　')
}

function itemText(item) {
  if (!item.description || item.description === item.itemName) return item.itemName
  return `${item.itemName}\n${item.description}`
}

function itemTaxFormula(rowNumber, taxRate) {
  return `ROUND(F${rowNumber}*${taxRate}/100,0)`
}

function formula(value, result) {
  return { formula: value, result }
}

function setEditableInvoiceTitle(sheet) {
  const titleParts = [
    { range: 'A1:B3', cell: 'A1', value: '請' },
    { range: 'C1:D3', cell: 'C1', value: '求' },
    { range: 'A4:B6', cell: 'A4', value: '書' },
  ]
  for (const part of titleParts) {
    sheet.mergeCells(part.range)
    const cell = sheet.getCell(part.cell)
    cell.value = part.value
    cell.font = { name: 'MS Mincho', size: 40, bold: true, color: { argb: 'FF000000' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
  }
}

function setHeaderRows(sheet, startRow, templates) {
  applyRowTemplate(sheet, startRow, templates.header)
  applyRowTemplate(sheet, startRow + 1, templates.headerSecond)
  for (let column = 1; column <= 8; column += 1) {
    const value = templates.header.cells[column - 1].value
    sheet.getCell(startRow, column).value = value
    sheet.mergeCells(startRow, column, startRow + 1, column)
  }
}

function setProjectDescription(sheet, rowNumber, project, template) {
  applyRowTemplate(sheet, rowNumber, template)
  sheet.mergeCells(rowNumber, 1, rowNumber, 8)
  const cell = sheet.getCell(rowNumber, 1)
  cell.value = projectHeading(project)
  cell.alignment = { ...cell.alignment, vertical: 'middle', wrapText: true }
}

function setItemRow(sheet, rowNumber, item, template) {
  applyRowTemplate(sheet, rowNumber, template)
  sheet.mergeCells(rowNumber, 1, rowNumber, 2)
  sheet.getCell(rowNumber, 1).value = itemText(item)
  sheet.getCell(rowNumber, 3).value = item.quantity
  sheet.getCell(rowNumber, 4).value = item.unit
  sheet.getCell(rowNumber, 5).value = item.unitPrice
  sheet.getCell(rowNumber, 6).value = formula(`C${rowNumber}*E${rowNumber}`, item.taxExclusiveAmount)
  sheet.getCell(rowNumber, 7).value = formula(itemTaxFormula(rowNumber, item.taxRate), item.taxAmount)
  sheet.getCell(rowNumber, 8).value = formula(`SUM(F${rowNumber},G${rowNumber})`, item.taxInclusiveAmount)
}

function setBlankItemRow(sheet, rowNumber, template) {
  applyRowTemplate(sheet, rowNumber, template)
  sheet.mergeCells(rowNumber, 1, rowNumber, 2)
}

function setProjectSubtotal(sheet, rowNumber, itemRows, project, template) {
  applyRowTemplate(sheet, rowNumber, template)
  sheet.mergeCells(rowNumber, 1, rowNumber, 2)
  sheet.getCell(rowNumber, 4).value = '小計：'
  const first = itemRows[0]
  const last = itemRows[itemRows.length - 1]
  sheet.getCell(rowNumber, 6).value = formula(`SUM(F${first}:F${last})`, project.taxExclusiveAmount)
  sheet.getCell(rowNumber, 7).value = formula(`SUM(G${first}:G${last})`, project.taxAmount)
  sheet.getCell(rowNumber, 8).value = formula(`SUM(H${first}:H${last})`, project.taxInclusiveAmount)
}

function setGrandTotals(sheet, startRow, subtotalRows, settlement, templates) {
  const [subtotalRow, taxRow, totalRow] = [startRow, startRow + 1, startRow + 2]
  const sumCells = (column) => subtotalRows.map((row) => `${column}${row}`).join(',')

  applyRowTemplate(sheet, subtotalRow, templates.subtotalTotal)
  applyRowTemplate(sheet, taxRow, templates.taxTotal)
  applyRowTemplate(sheet, totalRow, templates.grandTotal)

  for (const rowNumber of [subtotalRow, taxRow, totalRow]) {
    sheet.mergeCells(rowNumber, 1, rowNumber, 4)
    sheet.mergeCells(rowNumber, 6, rowNumber, 8)
  }
  sheet.getCell(subtotalRow, 1).value = '小　　　　計'
  sheet.getCell(taxRow, 1).value = '消費税'
  sheet.getCell(totalRow, 1).value = '合　　　　計'
  sheet.getCell(taxRow, 5).value = 0.1
  sheet.getCell(subtotalRow, 6).value = formula(`SUM(${sumCells('F')})`, settlement.taxExclusiveAmount)
  sheet.getCell(taxRow, 6).value = formula(`SUM(${sumCells('G')})`, settlement.taxAmount)
  sheet.getCell(totalRow, 6).value = formula(`SUM(F${subtotalRow},F${taxRow})`, settlement.taxInclusiveAmount)
  return totalRow
}

export function formatMiraisyaInvoiceFilename(value) {
  const settlement = normalizeSettlement(value)
  const [year, month] = settlement.month.split('-')
  return `${CUSTOMER_NAME}_${year}年${month}月_請求書_${settlement.invoiceNo}.xlsx`
}

export function formatJapaneseIssueDate(value) {
  const [year, month, day] = value.split('-').map(Number)
  return `${year} 年${month}月 ${day}日`
}

export async function buildMiraisyaInvoiceWorkbook(ExcelJSModule, templateBytes, value) {
  const settlement = normalizeSettlement(value)
  const ExcelJS = ExcelJSModule?.default || ExcelJSModule
  if (!ExcelJS?.Workbook) throw new TypeError('Excel 导出组件不可用')

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)
  const sheet = workbook.getWorksheet('Sheet2')
  if (!sheet) throw new TypeError('未来舎请求书模板无效')

  const templates = Object.freeze({
    header: snapshotRow(sheet, 19),
    headerSecond: snapshotRow(sheet, 20),
    description: snapshotRow(sheet, 27),
    item: snapshotRow(sheet, 28),
    subtotal: snapshotRow(sheet, 25),
    subtotalTotal: snapshotRow(sheet, 70),
    taxTotal: snapshotRow(sheet, 71),
    grandTotal: snapshotRow(sheet, 72),
  })
  const blockSizes = settlement.projects.map((project) =>
    Math.max(MINIMUM_PROJECT_BLOCK_ROWS, project.items.length + 4))
  const generatedLastRow = BODY_START_ROW + blockSizes.reduce((sum, size) => sum + size, 0) + 2

  unmergeGeneratedArea(sheet)
  clearGeneratedArea(sheet, Math.max(ORIGINAL_LAST_ROW, generatedLastRow))

  setEditableInvoiceTitle(sheet)
  sheet.getCell('H2').value = formatJapaneseIssueDate(settlement.issueDate)
  sheet.getCell('G3').value = '請求書番号：'
  sheet.getCell('H3').value = settlement.invoiceNo
  sheet.getCell('A7').value = CUSTOMER_NAME

  let cursor = BODY_START_ROW
  const subtotalRows = []
  settlement.projects.forEach((project, projectIndex) => {
    const blockSize = blockSizes[projectIndex]
    setHeaderRows(sheet, cursor, templates)
    setProjectDescription(sheet, cursor + 2, project, templates.description)
    const itemRows = []
    let itemCursor = cursor + 3
    for (const item of project.items) {
      setItemRow(sheet, itemCursor, item, templates.item)
      itemRows.push(itemCursor)
      itemCursor += 1
    }
    const subtotalRow = cursor + blockSize - 1
    while (itemCursor < subtotalRow) {
      setBlankItemRow(sheet, itemCursor, templates.item)
      itemCursor += 1
    }
    setProjectSubtotal(sheet, subtotalRow, itemRows, project, templates.subtotal)
    subtotalRows.push(subtotalRow)
    cursor += blockSize
    if ((projectIndex + 1) % 2 === 0 && projectIndex < settlement.projects.length - 1) {
      sheet.getRow(subtotalRow).addPageBreak()
    }
  })

  const grandTotalRow = setGrandTotals(sheet, cursor, subtotalRows, settlement, templates)
  sheet.getCell('C13').value = formula(`F${grandTotalRow}`, settlement.taxInclusiveAmount)
  sheet.pageSetup.printArea = `A1:H${grandTotalRow}`
  sheet.pageSetup.fitToPage = true
  sheet.pageSetup.fitToWidth = 1
  sheet.pageSetup.fitToHeight = 0
  sheet.protection = { sheet: false }
  workbook.calcProperties.fullCalcOnLoad = true
  workbook.calcProperties.forceFullCalc = true
  return workbook
}

export async function downloadMiraisyaInvoice(value, runtime = {}) {
  const settlement = normalizeSettlement(value)
  const expectedVersion = settlement.version
  const ExcelJSModule = await import('exceljs')
  const response = runtime.fetch
    ? await runtime.fetch(TEMPLATE_URL)
    : await fetch('/templates/miraisya-invoice-template.xlsx')
  if (!response?.ok) throw new Error('请求书模板读取失败，请稍后重试')
  const workbook = await buildMiraisyaInvoiceWorkbook(
    ExcelJSModule,
    await response.arrayBuffer(),
    settlement,
  )
  const buffer = await workbook.xlsx.writeBuffer()

  if (typeof runtime.getSettlementVersion === 'function') {
    const latestVersion = await runtime.getSettlementVersion(settlement.id)
    if (latestVersion !== expectedVersion) {
      throw new Error('该月度结算已更新，请刷新页面后重新下载')
    }
  }

  const BlobConstructor = runtime.Blob || globalThis.Blob
  const urlApi = runtime.URL || globalThis.URL
  const documentObject = runtime.document || globalThis.document
  if (!BlobConstructor || !urlApi?.createObjectURL || !documentObject?.createElement) {
    throw new Error('当前浏览器不支持 Excel 下载')
  }
  const blob = new BlobConstructor([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const objectUrl = urlApi.createObjectURL(blob)
  const anchor = documentObject.createElement('a')
  anchor.href = objectUrl
  anchor.download = formatMiraisyaInvoiceFilename(settlement)
  anchor.style.display = 'none'
  documentObject.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    urlApi.revokeObjectURL(objectUrl)
  }
}

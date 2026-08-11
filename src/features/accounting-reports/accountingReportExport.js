import {
  escapeAccountingSpreadsheetText,
  formatAccountingReportDisplayValue,
  formatAccountingReportFileName,
} from './accountingReportModel.js'

export const ACCOUNTING_REPORT_MONEY_FORMAT = '¥#,##0;[Red]-¥#,##0'

const PAPER_A4 = 9
const COLORS = Object.freeze({
  text: 'FF111111',
  muted: 'FF555555',
  header: 'FFF2F2F2',
  border: 'FFB7B7B7',
})
const THIN_GRAY_BORDER = Object.freeze({
  top: { style: 'thin', color: { argb: COLORS.border } },
  left: { style: 'thin', color: { argb: COLORS.border } },
  bottom: { style: 'thin', color: { argb: COLORS.border } },
  right: { style: 'thin', color: { argb: COLORS.border } },
})

function writeCell(cell, value, format = 'text') {
  if ((format === 'money' || format === 'number') && Number.isFinite(Number(value))) {
    cell.value = Number(value)
  } else {
    cell.value = escapeAccountingSpreadsheetText(formatAccountingReportDisplayValue(value, format))
  }
  if (format === 'money') cell.numFmt = ACCOUNTING_REPORT_MONEY_FORMAT
  if (format === 'number') cell.numFmt = '#,##0.####;[Red]-#,##0.####'
}

function mergeTextRow(sheet, rowNumber, columnCount, value, style = {}) {
  sheet.mergeCells(rowNumber, 1, rowNumber, columnCount)
  const cell = sheet.getCell(rowNumber, 1)
  writeCell(cell, value)
  cell.font = { color: { argb: COLORS.muted }, ...style.font }
  cell.alignment = { vertical: 'center', wrapText: true, ...style.alignment }
  return rowNumber + 1
}

function configureColumns(sheet, sections, columnCount) {
  for (let index = 1; index <= columnCount; index += 1) {
    const width = Math.max(10, ...sections.map((section) => section.columns[index - 1]?.width ?? 10))
    sheet.getColumn(index).width = width
  }
}

function writeSection(sheet, section, startRow) {
  const columnCount = section.columns.length
  let rowNumber = mergeTextRow(sheet, startRow, columnCount, section.title, {
    font: { size: 13, bold: true, color: { argb: COLORS.text } },
  })
  const headerRow = rowNumber
  for (const [index, column] of section.columns.entries()) {
    const cell = sheet.getCell(rowNumber, index + 1)
    writeCell(cell, column.label)
    cell.font = { bold: true, color: { argb: COLORS.text } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.header } }
    cell.border = THIN_GRAY_BORDER
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true }
  }
  sheet.getRow(rowNumber).height = 26
  rowNumber += 1

  if (section.rows.length === 0) {
    sheet.mergeCells(rowNumber, 1, rowNumber, columnCount)
    const cell = sheet.getCell(rowNumber, 1)
    writeCell(cell, section.emptyText)
    cell.border = THIN_GRAY_BORDER
    cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true }
    sheet.getRow(rowNumber).height = 26
    return { nextRow: rowNumber + 1, headerRow }
  }

  for (const data of section.rows) {
    for (const [index, column] of section.columns.entries()) {
      const cell = sheet.getCell(rowNumber, index + 1)
      writeCell(cell, data[column.key], column.format)
      cell.border = THIN_GRAY_BORDER
      cell.alignment = {
        horizontal: column.align ?? (column.format === 'money' || column.format === 'number' ? 'right' : 'left'),
        vertical: 'center',
        wrapText: true,
      }
    }
    sheet.getRow(rowNumber).height = 26
    rowNumber += 1
  }
  return { nextRow: rowNumber, headerRow }
}

function configurePrintLayout(sheet, columnCount, firstHeaderRow, lastRow, sectionCount, orientation) {
  sheet.pageSetup = {
    paperSize: PAPER_A4,
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
    printTitlesRow: `1:${firstHeaderRow}`,
    printArea: `A1:${sheet.getColumn(columnCount).letter}${lastRow}`,
  }
  sheet.views = [{ state: 'frozen', ySplit: firstHeaderRow }]
  if (sectionCount === 1) {
    sheet.autoFilter = {
      from: { row: firstHeaderRow, column: 1 },
      to: { row: firstHeaderRow, column: columnCount },
    }
  }
}

/**
 * Creates the leadership-facing, editable Excel copy of an accounting report.
 * Formula escaping occurs exclusively while values cross into Excel cells.
 */
export function createAccountingReportWorkbook(ExcelJS, report) {
  const workbook = new ExcelJS.Workbook()
  const groups = new Map()
  for (const section of report.sections) {
    const sections = groups.get(section.sheetName) ?? []
    sections.push(section)
    groups.set(section.sheetName, sections)
  }

  for (const [sheetName, sections] of groups) {
    const sheet = workbook.addWorksheet(sheetName)
    const columnCount = Math.max(...sections.map((section) => section.columns.length))
    configureColumns(sheet, sections, columnCount)
    let rowNumber = 1
    rowNumber = mergeTextRow(sheet, rowNumber, columnCount, report.title, {
      font: { size: 18, bold: true, color: { argb: COLORS.text } },
      alignment: { horizontal: 'center' },
    })
    rowNumber = mergeTextRow(sheet, rowNumber, columnCount, `公司：${report.companyName}`)
    for (const filter of report.filterLines) {
      rowNumber = mergeTextRow(sheet, rowNumber, columnCount, `${filter.label}：${formatAccountingReportDisplayValue(filter.value, filter.format)}`)
    }
    rowNumber = mergeTextRow(sheet, rowNumber, columnCount, `生成时间：${report.generatedAt}`)
    rowNumber = mergeTextRow(sheet, rowNumber, columnCount, `制表人：${report.preparedBy}`)
    rowNumber = mergeTextRow(sheet, rowNumber, columnCount, report.editableNotice)
    for (const summary of report.summary) {
      rowNumber = mergeTextRow(sheet, rowNumber, columnCount,
        `${summary.label}：${formatAccountingReportDisplayValue(summary.value, summary.format)}`)
    }

    let firstHeaderRow = 0
    for (const section of sections) {
      const result = writeSection(sheet, section, rowNumber)
      firstHeaderRow ||= result.headerRow
      rowNumber = result.nextRow
    }
    for (const label of [`制表人：${report.preparedBy}`, '复核人：', '审批人：']) {
      rowNumber = mergeTextRow(sheet, rowNumber, columnCount, label, {
        font: { color: { argb: COLORS.text } },
      })
    }
    configurePrintLayout(sheet, columnCount, firstHeaderRow, rowNumber - 1, sections.length, report.orientation)
  }
  return workbook
}

function canOutput(outputGuard) {
  return typeof outputGuard !== 'function' || outputGuard()
}

export async function exportAccountingReportXlsx(report, { outputGuard } = {}) {
  if (!canOutput(outputGuard)) return false
  const { default: ExcelJS } = await import('exceljs')
  if (!canOutput(outputGuard)) return false
  const workbook = createAccountingReportWorkbook(ExcelJS, report)
  const buffer = await workbook.xlsx.writeBuffer()
  if (!canOutput(outputGuard)) return false

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  let link
  try {
    if (!canOutput(outputGuard)) return false
    link = document.createElement('a')
    link.href = url
    link.download = `${formatAccountingReportFileName(report.fileName)}.xlsx`
    document.body.appendChild(link)
    link.click()
    return true
  } finally {
    if (link) document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}

export function printAccountingReport(printOperation, documentRef = document) {
  const body = documentRef?.body
  const originalClassName = body?.className
  if (body) {
    body.className = originalClassName
      ? `${originalClassName} accounting-report-printing`
      : 'accounting-report-printing'
  }
  try {
    const nativePrint = printOperation ?? documentRef?.defaultView?.print
    if (typeof nativePrint !== 'function') throw new TypeError('print operation is required')
    return nativePrint()
  } finally {
    if (body) body.className = originalClassName
  }
}

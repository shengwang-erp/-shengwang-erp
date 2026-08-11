export const ACCOUNTING_REPORT_EDITABLE_NOTICE =
  '本文件为 ERP 导出副本，可编辑；修改不会回写系统。'

const EMPTY_SECTION_TEXT = '当前筛选条件下无记录'
const ORIENTATIONS = new Set(['portrait', 'landscape'])
const CELL_FORMATS = new Set(['money', 'number', 'percent', 'date', 'text'])
const CELL_ALIGNMENTS = new Set(['left', 'center', 'right'])

/**
 * @typedef {Object} AccountingReportColumn
 * @property {string} key
 * @property {string} label
 * @property {number} [width]
 * @property {'left'|'center'|'right'} [align]
 * @property {'money'|'number'|'percent'|'date'|'text'} [format]
 * @property {string} [formatKey] Row property containing this cell's format.
 */

/**
 * @typedef {Object} AccountingReportSection
 * @property {string} id
 * @property {string} title
 * @property {string} sheetName
 * @property {AccountingReportColumn[]} columns
 * @property {Object[]} rows
 * @property {string} emptyText
 */

/**
 * @typedef {Object} AccountingReportModel
 * @property {string} id
 * @property {string} title
 * @property {string} companyName
 * @property {string} generatedAt
 * @property {string} preparedBy
 * @property {'portrait'|'landscape'} orientation
 * @property {string} fileName
 * @property {Object[]} filterLines
 * @property {number} recordCount
 * @property {Object[]} summary
 * @property {AccountingReportSection[]} sections
 * @property {Object[]} notes
 * @property {string} editableNotice
 */

export function escapeAccountingSpreadsheetText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return value
  return /^(?:[\u0000-\u0020]*[=+\-@]|[\t\r\n])/u.test(value) ? `'${value}` : value
}

export function formatAccountingReportFileName(value) {
  return String(value || '会计报表').replace(/[\\/:*?"<>|]/gu, '_')
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} is required`)
  return value
}

function cloneReportValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) return value.toISOString()
  const clone = Array.isArray(value) ? [] : {}
  seen.set(value, clone)
  for (const [key, child] of Object.entries(value)) clone[key] = cloneReportValue(child, seen)
  return clone
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return value
  seen.add(value)
  for (const child of Object.values(value)) deepFreeze(child, seen)
  return Object.freeze(value)
}

function array(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`)
  return value
}

function sectionModel(section, sectionIds) {
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    throw new TypeError('section must be an object')
  }
  const id = requiredText(section.id, 'section id')
  if (sectionIds.has(id)) throw new TypeError(`duplicate section id: ${id}`)
  sectionIds.add(id)
  const sheetName = requiredText(section.sheetName, 'sheetName')
  const columns = array(section.columns, 'section columns')
  if (columns.length === 0) throw new TypeError('section must have at least one column')
  const columnKeys = new Set()
  for (const column of columns) {
    if (!column || typeof column !== 'object' || Array.isArray(column)) {
      throw new TypeError('column must be an object')
    }
    const key = requiredText(column.key, 'column key')
    requiredText(column.label, 'column label')
    if (columnKeys.has(key)) throw new TypeError(`duplicate column key: ${key}`)
    columnKeys.add(key)
  }
  return {
    ...cloneReportValue(section),
    id,
    title: text(section.title, sheetName),
    sheetName,
    columns: cloneReportValue(columns),
    rows: cloneReportValue(array(section.rows ?? [], 'section rows')),
    emptyText: text(section.emptyText, EMPTY_SECTION_TEXT),
  }
}

/**
 * Creates the immutable contract shared by accounting Excel and print exports.
 * Formula escaping is intentionally excluded: print/PDF consumers receive the
 * original human-readable text and Excel writers call the escape helper.
 *
 * @param {Partial<AccountingReportModel>} input
 * @returns {AccountingReportModel}
 */
export function createAccountingReportModel(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('report input must be an object')
  }
  const orientation = input.orientation ?? 'portrait'
  if (!ORIENTATIONS.has(orientation)) throw new TypeError('orientation must be portrait or landscape')
  const sections = array(input.sections ?? [], 'sections')
  if (sections.length === 0) throw new TypeError('report must have at least one section')
  const sectionIds = new Set()
  const report = {
    id: text(input.id, 'accounting-report'),
    title: text(input.title, '会计报表'),
    companyName: text(input.companyName, '生旺株式会社'),
    generatedAt: text(input.generatedAt, ''),
    preparedBy: text(input.preparedBy, ''),
    orientation,
    fileName: formatAccountingReportFileName(input.fileName),
    filterLines: cloneReportValue(array(input.filterLines ?? [], 'filterLines')),
    recordCount: input.recordCount ?? 0,
    summary: cloneReportValue(array(input.summary ?? [], 'summary')),
    sections: sections.map((section) => sectionModel(section, sectionIds)),
    notes: cloneReportValue(array(input.notes ?? [], 'notes')),
    editableNotice: ACCOUNTING_REPORT_EDITABLE_NOTICE,
  }
  if (!Number.isSafeInteger(report.recordCount) || report.recordCount < 0) {
    throw new TypeError('recordCount must be a non-negative safe integer')
  }
  return deepFreeze(report)
}

/**
 * Stamps one immutable report at the output boundary. The filename date is
 * derived from the same instant written into the report header.
 */
export function createAccountingReportOutputSnapshot(report, generatedAt = new Date()) {
  const timestamp = generatedAt instanceof Date
    ? new Date(generatedAt.getTime())
    : new Date(generatedAt)
  if (!Number.isFinite(timestamp.getTime())) {
    throw new TypeError('generatedAt must be a valid date')
  }
  const generatedAtText = timestamp.toISOString()
  const generationDate = generatedAtText.slice(0, 10)
  const baseFileName = formatAccountingReportFileName(report?.fileName)
  const dateSuffix = `_${generationDate}`
  return createAccountingReportModel({
    ...report,
    generatedAt: generatedAtText,
    fileName: baseFileName.endsWith(dateSuffix)
      ? baseFileName
      : `${baseFileName}${dateSuffix}`,
  })
}

export function accountingReportAlignment(format = 'text', align) {
  if (CELL_ALIGNMENTS.has(align)) return align
  if (format === 'money' || format === 'number' || format === 'percent') return 'right'
  if (format === 'date') return 'center'
  return 'left'
}

export function resolveAccountingReportCell(row, column) {
  const keyedFormat = typeof column?.formatKey === 'string'
    ? row?.[column.formatKey]
    : undefined
  const cellFormat = row?.formats && typeof row.formats === 'object'
    ? row.formats[column?.key]
    : undefined
  const format = [cellFormat, keyedFormat, column?.format]
    .find((candidate) => CELL_FORMATS.has(candidate)) || 'text'
  return {
    value: row?.[column?.key],
    format,
    align: accountingReportAlignment(format, column?.align),
  }
}

export function formatAccountingReportDisplayValue(value, format = 'text') {
  if (value === null || value === undefined) return ''
  if (format === 'text') return String(value)
  if (format === 'date') {
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10)
  }
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  if (format === 'money') return `¥${number.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}`
  if (format === 'number') return number.toLocaleString('ja-JP', { maximumFractionDigits: 4 })
  if (format === 'percent') return `${number.toLocaleString('ja-JP', { maximumFractionDigits: 4 })}%`
  return String(value)
}

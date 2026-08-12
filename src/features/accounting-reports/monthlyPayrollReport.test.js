import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import ExcelJS from 'exceljs'
import { createServer } from 'vite'

import { createAccountingReportWorkbook } from './accountingReportExport.js'
import { createMonthlyPayrollReport } from './monthlyPayrollReport.js'

const server = await createServer({
  root: process.cwd(), cacheDir: '/private/tmp/task7-monthly-payroll-report-vite-cache',
  configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/accounting-reports/AccountingReportPrintSheet.jsx')
after(() => server.close())
const AccountingReportPrintSheet = loaded.default

const employees = Object.freeze([
  Object.freeze({
    employeeProfileId: '52000000-0000-4000-8000-000000000001',
    employeeNumber: 'SW-001', employeeName: '=工程员工', department: '工程部', position: '大工',
    attendanceMethod: 'project', locationAbnormalCount: 1,
    locationReviewSummary: '判定异常 1 条：距离现场 420 米，已由会计复核并保留管理记录。',
    fullDays: 20, halfDays: 1, excusedDays: 0, absenceDays: 0, pendingDays: 1,
    basePay: 285000, overtimePay: 10000, bonus: 5000, deduction: 0, netSalary: 300000,
    projectAllocatedAmount: 250000, projectUnallocatedAmount: 50000, companyPersonnelCost: 0,
    status: 'confirmed', confirmationNote: '工程工资已确认', confirmedAt: '2026-08-31T09:00:00+09:00',
    version: 3,
  }),
  Object.freeze({
    employeeProfileId: '52000000-0000-4000-8000-000000000002',
    employeeNumber: 'SW-002', employeeName: '总务员工', department: '总务部', position: '总务',
    attendanceMethod: 'general', locationAbnormalCount: 0, locationReviewSummary: '',
    fullDays: 21, halfDays: 0, excusedDays: 1, absenceDays: 0, pendingDays: 0,
    basePay: 300000, overtimePay: 0, bonus: 0, deduction: 0, netSalary: 300000,
    projectAllocatedAmount: 0, projectUnallocatedAmount: 0, companyPersonnelCost: 300000,
    status: 'ready', confirmationNote: '计入公司人员成本', confirmedAt: null, version: 0,
  }),
  Object.freeze({
    employeeProfileId: '52000000-0000-4000-8000-000000000003',
    employeeNumber: 'SW-003', employeeName: '管理员工', department: '管理部', position: '经理',
    attendanceMethod: 'exempt', locationAbnormalCount: 0, locationReviewSummary: '',
    fullDays: 22, halfDays: 0, excusedDays: 0, absenceDays: 0, pendingDays: 0,
    basePay: 310000, overtimePay: 0, bonus: 0, deduction: 10000, netSalary: 300000,
    projectAllocatedAmount: 0, projectUnallocatedAmount: 0, companyPersonnelCost: 300000,
    status: 'ready', confirmationNote: '免打卡默认全勤', confirmedAt: null, version: 0,
  }),
])

function createReport(overrides = {}) {
  return createMonthlyPayrollReport({
    employees,
    summary: {
      employeeCount: 3, scheduledAttendanceUnits: 66,
      confirmedAttendanceUnits: 65.5, pendingCount: 1,
      salaryPreviewTotal: 900000, projectAllocatedTotal: 250000,
      projectUnallocatedTotal: 50000,
    },
    month: '2026-08', department: '', employeeLabel: '', onlyPending: false,
    preparedBy: '会计甲', generatedAt: '2026-09-01T03:04:05.678Z',
    ...overrides,
  })
}

function headerRow(sheet, label) {
  for (let row = 1; row <= sheet.rowCount; row += 1) {
    if (sheet.getCell(row, 1).value === label) return row
  }
  throw new Error(`header row not found: ${label}`)
}

function headerColumn(sheet, row, label) {
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    if (sheet.getCell(row, column).value === label) return column
  }
  throw new Error(`header column not found: ${label}`)
}

test('adapts the supplied filtered cohort into exact leadership payroll totals and sheets', () => {
  const report = createReport()

  assert.equal(report.orientation, 'landscape')
  assert.equal(report.fileName, '月度工资表_2026-08')
  assert.equal(report.recordCount, 3)
  assert.deepEqual(report.filterLines, [
    { label: '工资月份', value: '2026-08' },
    { label: '部门', value: '全部部门' },
    { label: '员工', value: '全部员工' },
    { label: '状态', value: '全部状态' },
  ])
  assert.deepEqual(report.summary, [
    { label: '员工人数', value: 3, format: 'number' },
    { label: '实发工资合计', value: 900000, format: 'money' },
    { label: '项目人工成本', value: 300000, format: 'money' },
    { label: '公司人员成本', value: 600000, format: 'money' },
    { label: '超范围记录', value: 1, format: 'number' },
  ])
  assert.deepEqual(report.sections.map(({ sheetName }) => sheetName), [
    '工资汇总', '工资明细', '定位异常记录',
  ])
  assert.deepEqual(report.sections[0].rows, [
    { item: '项目人工成本', amount: 300000 },
    { item: '公司人员成本', amount: 600000 },
    { item: '加班费合计', amount: 10000 },
    { item: '奖金合计', amount: 5000 },
    { item: '扣款合计', amount: 10000 },
    { item: '实发工资合计', amount: 900000 },
  ])
  assert.equal(report.sections[1].rows[0].employeeName, '=工程员工')
  assert.equal(report.sections[1].rows[0].scheduledDays, 22)
  assert.equal(typeof report.sections[1].rows[0].netSalary, 'number')
  assert.equal(report.sections[1].rows[0].confirmedAt, '2026-08-31T09:00:00+09:00')
  assert.equal(report.sections[1].columns.find(({ key }) => key === 'confirmedAt').format, 'date')
  assert.deepEqual(report.sections[2].rows.map(({ employeeName }) => employeeName), ['=工程员工'])
  for (const section of report.sections) {
    for (const column of section.columns) assert.ok(column.width >= 10 && column.width <= 24)
  }
})

test('uses filter arguments only as labels and never re-filters supplied employees', () => {
  const report = createReport({
    department: '总务部', employeeLabel: '总务员工 · SW-002', onlyPending: true,
  })

  assert.equal(report.recordCount, 3)
  assert.equal(report.sections[1].rows.length, 3)
  assert.deepEqual(report.filterLines, [
    { label: '工资月份', value: '2026-08' },
    { label: '部门', value: '总务部' },
    { label: '员工', value: '总务员工 · SW-002' },
    { label: '状态', value: '只看待确认' },
  ])
})

test('keeps formula-like names readable in print and escapes them only in native Excel cells', async () => {
  const report = createReport()
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report }))
  assert.match(html, />=工程员工</u)
  assert.doesNotMatch(html, /&(?:#x27|apos);=工程员工/u)
  assert.match(html, /判定异常 1 条：距离现场 420 米/u)

  const workbook = createAccountingReportWorkbook(ExcelJS, report)
  const detailSheet = workbook.getWorksheet('工资明细')
  const detailHeader = headerRow(detailSheet, '员工编号')
  const nameColumn = headerColumn(detailSheet, detailHeader, '员工姓名')
  const payColumn = headerColumn(detailSheet, detailHeader, '实发工资')
  const dateColumn = headerColumn(detailSheet, detailHeader, '确认日期')
  assert.equal(detailSheet.getCell(detailHeader + 1, nameColumn).value, "'=工程员工")
  assert.equal(typeof detailSheet.getCell(detailHeader + 1, payColumn).value, 'number')
  assert.ok(detailSheet.getCell(detailHeader + 1, dateColumn).value instanceof Date)

  const anomalySheet = workbook.getWorksheet('定位异常记录')
  const anomalyHeader = headerRow(anomalySheet, '员工编号')
  const reviewColumn = headerColumn(anomalySheet, anomalyHeader, '定位复核摘要')
  assert.equal(anomalySheet.getCell(anomalyHeader + 1, reviewColumn).alignment.wrapText, true)

  const roundTripBuffer = await workbook.xlsx.writeBuffer()
  const roundTrip = new ExcelJS.Workbook()
  await roundTrip.xlsx.load(roundTripBuffer)
  assert.deepEqual(roundTrip.worksheets.map(({ name }) => name), [
    '工资汇总', '工资明细', '定位异常记录',
  ])
  assert.ok(roundTrip.getWorksheet('工资明细').getCell(detailHeader + 1, dateColumn).value instanceof Date)
})

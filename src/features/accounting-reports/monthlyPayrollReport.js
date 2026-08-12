import { createAccountingReportModel } from './accountingReportModel.js'

const ATTENDANCE_METHOD_LABELS = Object.freeze({
  project: '项目打卡',
  general: '非项目打卡',
  exempt: '免打卡 · 默认全勤',
})

const PAYROLL_STATUS_LABELS = Object.freeze({
  confirmed: '已确认',
  salary_required: '工资标准缺失',
  invalid_money: '工资金额异常',
  incomplete: '未完成',
  ready: '可确认',
})

const DETAIL_COLUMNS = Object.freeze([
  { key: 'employeeNumber', label: '员工编号', width: 14 },
  { key: 'employeeName', label: '员工姓名', width: 16 },
  { key: 'department', label: '部门', width: 14 },
  { key: 'position', label: '职位', width: 14 },
  { key: 'attendanceMethod', label: '考勤方式', width: 16, align: 'center' },
  { key: 'scheduledDays', label: '应出勤天数', width: 12, format: 'number' },
  { key: 'fullDays', label: '整天', width: 10, format: 'number' },
  { key: 'halfDays', label: '半天', width: 10, format: 'number' },
  { key: 'absenceDays', label: '缺勤', width: 10, format: 'number' },
  { key: 'locationAbnormalCount', label: '超范围记录', width: 12, format: 'number' },
  { key: 'basePay', label: '基本工资', width: 14, format: 'money' },
  { key: 'overtimePay', label: '加班费', width: 14, format: 'money' },
  { key: 'bonus', label: '奖金', width: 14, format: 'money' },
  { key: 'deduction', label: '扣款', width: 14, format: 'money' },
  { key: 'netSalary', label: '实发工资', width: 14, format: 'money' },
  { key: 'projectCost', label: '项目人工成本', width: 16, format: 'money' },
  { key: 'companyPersonnelCost', label: '公司人员成本', width: 16, format: 'money' },
  { key: 'status', label: '状态', width: 14, align: 'center' },
  { key: 'confirmedAt', label: '确认日期', width: 14, format: 'date' },
  { key: 'confirmationNote', label: '工资备注', width: 24 },
])

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function nullableAmount(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function tokyoBusinessDate(value) {
  if (value === null || value === undefined || value === '') return ''
  const instant = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(instant.getTime())) return text(value)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant)
  const part = (type) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function payrollRow(employee = {}) {
  const fullDays = amount(employee.fullDays)
  const halfDays = amount(employee.halfDays)
  const excusedDays = amount(employee.excusedDays)
  const absenceDays = amount(employee.absenceDays)
  const pendingDays = amount(employee.pendingDays)
  return {
    employeeNumber: text(employee.employeeNumber),
    employeeName: text(employee.employeeName),
    department: text(employee.department, '部门未记录'),
    position: text(employee.position, '职位未记录'),
    attendanceMethod: ATTENDANCE_METHOD_LABELS[employee.attendanceMethod]
      || text(employee.attendanceMethod),
    scheduledDays: nullableAmount(employee.scheduledAttendanceUnits),
    fullDays,
    halfDays,
    absenceDays,
    locationAbnormalCount: amount(employee.locationAbnormalCount),
    basePay: nullableAmount(employee.basePay),
    overtimePay: amount(employee.overtimePay),
    bonus: amount(employee.bonus),
    deduction: amount(employee.deduction),
    netSalary: nullableAmount(employee.netSalary),
    projectCost: amount(employee.projectAllocatedAmount) + amount(employee.projectUnallocatedAmount),
    companyPersonnelCost: amount(employee.companyPersonnelCost),
    status: PAYROLL_STATUS_LABELS[employee.status] || text(employee.status),
    confirmedAt: tokyoBusinessDate(employee.confirmedAt),
    confirmationNote: text(employee.confirmationNote),
  }
}

/**
 * Adapts the server-filtered monthly payroll cohort without applying any
 * additional employee, department, or status filtering.
 */
export function createMonthlyPayrollReport({
  employees = [], summary: _summary = {}, month, department, employeeLabel,
  onlyPending = false, preparedBy, generatedAt,
} = {}) {
  const suppliedEmployees = Array.isArray(employees) ? employees : []
  const rows = suppliedEmployees.map(payrollRow)
  const addAvailable = (total, value) => value === null || !Number.isFinite(value) ? total : total + value
  const totals = rows.reduce((current, row) => ({
    netSalary: addAvailable(current.netSalary, row.netSalary),
    projectCost: addAvailable(current.projectCost, row.projectCost),
    companyPersonnelCost: addAvailable(current.companyPersonnelCost, row.companyPersonnelCost),
    overtimePay: addAvailable(current.overtimePay, row.overtimePay),
    bonus: addAvailable(current.bonus, row.bonus),
    deduction: addAvailable(current.deduction, row.deduction),
    locationAbnormalCount: addAvailable(current.locationAbnormalCount, row.locationAbnormalCount),
  }), {
    netSalary: 0, projectCost: 0, companyPersonnelCost: 0,
    overtimePay: 0, bonus: 0, deduction: 0, locationAbnormalCount: 0,
  })
  const reportSummary = [
    { label: '员工人数', value: rows.length, format: 'number' },
    { label: '实发工资合计', value: totals.netSalary, format: 'money' },
    { label: '项目人工成本', value: totals.projectCost, format: 'money' },
    { label: '公司人员成本', value: totals.companyPersonnelCost, format: 'money' },
    { label: '超范围记录', value: totals.locationAbnormalCount, format: 'number' },
  ]
  const anomalyRows = rows
    .map((row, index) => ({ row, employee: suppliedEmployees[index] || {} }))
    .filter(({ row }) => row.locationAbnormalCount > 0)
    .map(({ row, employee }) => ({
      employeeNumber: row.employeeNumber,
      employeeName: row.employeeName,
      locationAbnormalCount: row.locationAbnormalCount,
      locationReviewSummary: text(employee.locationReviewSummary),
      confirmationNote: row.confirmationNote,
    }))

  return createAccountingReportModel({
    id: 'monthly-payroll-report',
    title: '月度工资表',
    preparedBy,
    generatedAt,
    orientation: 'landscape',
    fileName: `月度工资表_${text(month, '不限月份')}`,
    filterLines: [
      { label: '工资月份', value: text(month, '不限月份') },
      { label: '部门', value: text(department, '全部部门') },
      { label: '员工', value: text(employeeLabel, '全部员工') },
      { label: '状态', value: onlyPending ? '只看待确认' : '全部状态' },
    ],
    recordCount: rows.length,
    summary: reportSummary,
    sections: [
      {
        id: 'monthly-payroll-summary', title: '工资汇总', sheetName: '工资汇总',
        columns: [
          { key: 'item', label: '汇总项目', width: 22 },
          { key: 'amount', label: '金额', width: 18, format: 'money' },
        ],
        rows: [
          { item: '项目人工成本', amount: totals.projectCost },
          { item: '公司人员成本', amount: totals.companyPersonnelCost },
          { item: '加班费合计', amount: totals.overtimePay },
          { item: '奖金合计', amount: totals.bonus },
          { item: '扣款合计', amount: totals.deduction },
          { item: '实发工资合计', amount: totals.netSalary },
        ],
      },
      {
        id: 'monthly-payroll-details', title: '工资明细', sheetName: '工资明细',
        columns: DETAIL_COLUMNS,
        rows,
      },
      {
        id: 'monthly-payroll-location-anomalies', title: '定位异常记录', sheetName: '定位异常记录',
        columns: [
          { key: 'employeeNumber', label: '员工编号', width: 14 },
          { key: 'employeeName', label: '员工姓名', width: 16 },
          { key: 'locationAbnormalCount', label: '超范围记录', width: 12, format: 'number' },
          { key: 'locationReviewSummary', label: '定位复核摘要', width: 24 },
          { key: 'confirmationNote', label: '工资备注', width: 24 },
        ],
        rows: anomalyRows,
      },
    ],
    notes: ['定位异常为管理记录，不自动扣款或改变工资金额。'],
  })
}

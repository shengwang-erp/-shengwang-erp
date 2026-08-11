import { createAccountingReportModel } from './accountingReportModel.js'

const detailColumns = [
  { key: 'salaryRecordId', label: '工资编号', width: 16 },
  { key: 'salaryMonth', label: '工资月份', width: 12 },
  { key: 'employeeName', label: '员工', width: 20 },
  { key: 'baseSalary', label: '基本工资', width: 14, format: 'money' },
  { key: 'workDays', label: '出勤天数', width: 12, format: 'number' },
  { key: 'overtimePay', label: '加班费', width: 14, format: 'money' },
  { key: 'bonus', label: '奖金', width: 14, format: 'money' },
  { key: 'deduction', label: '扣款', width: 14, format: 'money' },
  { key: 'netSalary', label: '实发工资', width: 14, format: 'money' },
  { key: 'createdAt', label: '记录日期', width: 14, format: 'date' },
  { key: 'remark', label: '备注', width: 28 },
]

function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

/**
 * Adapts already-filtered salary records into the shared Excel/print report model.
 */
export function createSalaryReport({
  records = [], month, employee, preparedBy, generatedAt,
} = {}) {
  const suppliedRecords = Array.isArray(records) ? records : []
  const selectedEmployee = typeof employee === 'string' && employee.trim()
    ? employee.trim()
    : '全部员工'
  const totals = {
    baseSalary: 0, overtimePay: 0, bonus: 0, deduction: 0, netSalary: 0,
  }
  const employeeKeys = new Set()
  const rows = suppliedRecords.map((record = {}) => {
    const row = {
      salaryRecordId: text(record.salaryRecordId),
      salaryMonth: text(record.salaryMonth),
      employeeName: text(record.employeeName),
      baseSalary: amount(record.baseSalary),
      workDays: amount(record.workDays),
      overtimePay: amount(record.overtimePay),
      bonus: amount(record.bonus),
      deduction: amount(record.deduction),
      netSalary: amount(record.netSalary),
      createdAt: text(record.createdAt),
      remark: text(record.remark),
    }
    totals.baseSalary += row.baseSalary
    totals.overtimePay += row.overtimePay
    totals.bonus += row.bonus
    totals.deduction += row.deduction
    totals.netSalary += row.netSalary
    employeeKeys.add(text(record.employeeId) || row.employeeName)
    return row
  })
  const summary = [
    { label: '记录数', value: rows.length, format: 'number' },
    { label: '员工人数', value: employeeKeys.size, format: 'number' },
    { label: '基本工资合计', value: totals.baseSalary, format: 'money' },
    { label: '加班费合计', value: totals.overtimePay, format: 'money' },
    { label: '奖金合计', value: totals.bonus, format: 'money' },
    { label: '扣款合计', value: totals.deduction, format: 'money' },
    { label: '实发工资合计', value: totals.netSalary, format: 'money' },
  ]

  return createAccountingReportModel({
    id: 'salary-report',
    title: '工资报表',
    preparedBy,
    generatedAt,
    orientation: 'landscape',
    fileName: `工资报表_${text(month, '不限月份')}`,
    filterLines: [
      { label: '工资月份', value: text(month, '不限月份') },
      { label: '员工', value: selectedEmployee },
    ],
    recordCount: rows.length,
    summary,
    sections: [
      {
        id: 'salary-summary', title: '工资汇总', sheetName: '工资汇总',
        columns: [
          { key: 'item', label: '汇总项目', width: 22 },
          { key: 'amount', label: '金额', width: 18, format: 'money' },
        ],
        rows: [
          { item: '基本工资合计', amount: totals.baseSalary },
          { item: '加班费合计', amount: totals.overtimePay },
          { item: '奖金合计', amount: totals.bonus },
          { item: '扣款合计', amount: totals.deduction },
          { item: '实发工资合计', amount: totals.netSalary },
        ],
      },
      {
        id: 'salary-details', title: '工资明细', sheetName: '工资明细',
        columns: detailColumns, rows,
      },
    ],
  })
}

import assert from 'node:assert/strict'
import test from 'node:test'

import { createOperatingExpenseReport } from './operatingExpenseReport.js'
import { createSalaryReport } from './salaryReport.js'
import { escapeAccountingSpreadsheetText } from './accountingReportModel.js'

const salaryRecords = [
  {
    salaryRecordId: 'SR-001', salaryMonth: '2026-07', employeeId: 'E-001',
    employeeName: '=HYPERLINK("https://example.com","员工甲")', baseSalary: '300000',
    workDays: 22, overtimePay: '20000', bonus: '10000', deduction: '5000',
    netSalary: 325000, createdAt: '2026-07-31', remark: '+备注',
  },
  {
    salaryRecordId: 'SR-002', salaryMonth: '2026-07', employeeId: 'E-001',
    employeeName: '=HYPERLINK("https://example.com","员工甲")', baseSalary: 100000,
    workDays: 8, overtimePay: 5000, bonus: 0, deduction: 0,
    netSalary: 105000, createdAt: '2026-07-31', remark: '补发工资',
  },
  {
    salaryRecordId: 'SR-OUTSIDE-FILTER', salaryMonth: '2026-06', employeeId: 'E-002',
    employeeName: '不应被适配器再次筛选', baseSalary: 'not-a-number', workDays: 'not-a-number',
    overtimePay: Infinity, bonus: null, deduction: undefined, netSalary: Infinity,
    createdAt: '2026-06-30', remark: '',
  },
]

const expenseRecords = [
  {
    expenseRecordId: 'OE-001', date: '2026-07-01', expenseType: '房租', amount: '80000',
    allocateToProject: false, projectId: '', projectName: '', operator: '+经办人', remark: '=HYPERLINK("https://example.com","备注")',
  },
  {
    expenseRecordId: 'OE-002', date: '2026-07-02', expenseType: '材料补充', amount: 12000,
    allocateToProject: true, projectId: 'P-001', projectName: '新宿改造', operator: '田中', remark: '项目费用',
  },
  {
    expenseRecordId: 'OE-003', date: '2026-07-03', expenseType: '材料补充', amount: 3000,
    allocateToProject: true, projectId: '', projectName: '', operator: '佐藤', remark: '未绑定项目也应保留',
  },
]

function section(report, id) {
  const value = report.sections.find((item) => item.id === id)
  assert.ok(value, `expected ${id} section`)
  return value
}

test('salary adapter keeps every supplied row and derives employee and pay totals without filtering again', () => {
  const report = createSalaryReport({
    records: salaryRecords, month: '2026-07', employee: '  员工甲  ',
    preparedBy: '财务部', generatedAt: '2026-08-11T09:00:00Z',
  })

  assert.deepEqual(report.sections.map((item) => item.sheetName), ['工资汇总', '工资明细'])
  assert.equal(report.recordCount, 3)
  assert.deepEqual(report.filterLines, [
    { label: '工资月份', value: '2026-07' },
    { label: '员工', value: '员工甲' },
  ])
  assert.deepEqual(report.summary, [
    { label: '记录数', value: 3, format: 'number' },
    { label: '员工人数', value: 2, format: 'number' },
    { label: '基本工资合计', value: 400000, format: 'money' },
    { label: '加班费合计', value: 25000, format: 'money' },
    { label: '奖金合计', value: 10000, format: 'money' },
    { label: '扣款合计', value: 5000, format: 'money' },
    { label: '实发工资合计', value: 430000, format: 'money' },
  ])

  const detail = section(report, 'salary-details')
  assert.deepEqual(detail.columns.map((column) => column.label), [
    '工资编号', '工资月份', '员工', '基本工资', '出勤天数', '加班费', '奖金', '扣款', '实发工资', '记录日期', '备注',
  ])
  assert.deepEqual(detail.rows.map((row) => row.salaryRecordId), ['SR-001', 'SR-002', 'SR-OUTSIDE-FILTER'])
  assert.equal(detail.rows[0].employeeName, '=HYPERLINK("https://example.com","员工甲")')
  assert.equal(detail.rows[0].remark, '+备注')
})

test('salary adapter supplies meaningful empty defaults while retaining its two-sheet contract', () => {
  const report = createSalaryReport({ records: [], month: '', employee: '   ', preparedBy: '', generatedAt: '' })

  assert.equal(report.recordCount, 0)
  assert.deepEqual(report.filterLines, [
    { label: '工资月份', value: '不限月份' },
    { label: '员工', value: '全部员工' },
  ])
  assert.deepEqual(report.sections.map((item) => [item.sheetName, item.rows]), [
    ['工资汇总', [
      { item: '基本工资合计', amount: 0 }, { item: '加班费合计', amount: 0 },
      { item: '奖金合计', amount: 0 }, { item: '扣款合计', amount: 0 },
      { item: '实发工资合计', amount: 0 },
    ]],
    ['工资明细', []],
  ])
})

test('operating-expense adapter aggregates supplied categories and project allocations exactly', () => {
  const report = createOperatingExpenseReport({
    records: expenseRecords, month: '2026-07', expenseType: '材料补充', allocationScope: '项目费用',
    projectId: 'P-001', projectName: '新宿改造', preparedBy: '财务部', generatedAt: '2026-08-11T09:00:00Z',
  })

  assert.equal(report.orientation, 'landscape')
  assert.match(report.fileName, /2026-07/u)
  assert.equal(report.recordCount, 3)
  assert.deepEqual(report.filterLines, [
    { label: '费用月份', value: '2026-07' },
    { label: '费用类别', value: '材料补充' },
    { label: '费用归属', value: '项目费用' },
    { label: '项目', value: '新宿改造' },
  ])
  assert.deepEqual(report.summary, [
    { label: '费用记录数', value: 3, format: 'number' },
    { label: '费用总额', value: 95000, format: 'money' },
    { label: '公司费用', value: 80000, format: 'money' },
    { label: '项目费用', value: 15000, format: 'money' },
  ])

  assert.deepEqual(section(report, 'expense-category-summary').rows, [
    { expenseType: '房租', amount: 80000 }, { expenseType: '材料补充', amount: 15000 },
  ])
  assert.deepEqual(section(report, 'expense-project-summary').rows, [
    { projectName: '公司费用', amount: 80000 }, { projectName: '新宿改造', amount: 12000 },
    { projectName: '未绑定项目', amount: 3000 },
  ])
  const detail = section(report, 'expense-details')
  assert.deepEqual(detail.columns.map((column) => column.label), [
    '费用编号', '日期', '费用类别', '金额', '费用归属', '项目', '经办人', '备注',
  ])
  assert.deepEqual(detail.rows.map((row) => [row.allocation, row.projectName, row.operator, row.remark]), [
    ['公司费用', '公司费用', '+经办人', '=HYPERLINK("https://example.com","备注")'],
    ['项目费用', '新宿改造', '田中', '项目费用'],
    ['项目费用', '未绑定项目', '佐藤', '未绑定项目也应保留'],
  ])
})

test('adapters preserve business text and leave formula neutralization to Excel cell writing', () => {
  const report = createOperatingExpenseReport({
    records: expenseRecords.slice(0, 1), month: '', expenseType: '', allocationScope: '',
    projectId: '', projectName: '', preparedBy: '=制表人', generatedAt: '',
  })

  assert.equal(section(report, 'expense-details').rows[0].operator, '+经办人')
  assert.equal(section(report, 'expense-details').rows[0].remark, '=HYPERLINK("https://example.com","备注")')
  assert.equal(escapeAccountingSpreadsheetText('+经办人'), "'+经办人")
  assert.equal(escapeAccountingSpreadsheetText('=HYPERLINK("https://example.com","备注")'), "'=HYPERLINK(\"https://example.com\",\"备注\")")
})

test('operating-expense adapter keeps empty reports printable with unrestricted filter defaults', () => {
  const report = createOperatingExpenseReport({
    records: [], month: '', expenseType: '   ', allocationScope: '', projectId: '', projectName: '',
    preparedBy: '', generatedAt: '',
  })

  assert.deepEqual(report.filterLines, [
    { label: '费用月份', value: '不限月份' }, { label: '费用类别', value: '全部类别' },
    { label: '费用归属', value: '全部归属' }, { label: '项目', value: '全部项目' },
  ])
  assert.deepEqual(section(report, 'expense-category-summary').rows, [])
  assert.deepEqual(section(report, 'expense-project-summary').rows, [])
  assert.deepEqual(section(report, 'expense-details').rows, [])
})

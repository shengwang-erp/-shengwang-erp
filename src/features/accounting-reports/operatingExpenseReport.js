import { createAccountingReportModel } from './accountingReportModel.js'

const detailColumns = [
  { key: 'expenseRecordId', label: '费用编号', width: 16 },
  { key: 'date', label: '日期', width: 14, format: 'date' },
  { key: 'expenseType', label: '费用类别', width: 16 },
  { key: 'amount', label: '金额', width: 14, format: 'money' },
  { key: 'allocation', label: '费用归属', width: 14 },
  { key: 'projectName', label: '项目', width: 24 },
  { key: 'operator', label: '经办人', width: 16 },
  { key: 'remark', label: '备注', width: 28 },
]

function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function aggregate(rows, key) {
  const totals = new Map()
  for (const row of rows) totals.set(row[key], (totals.get(row[key]) ?? 0) + row.amount)
  return [...totals].map(([name, value]) => ({ [key]: name, amount: value }))
}

/**
 * Adapts already-filtered operating-expense records into the shared report model.
 */
export function createOperatingExpenseReport({
  records = [], month, expenseType, allocationScope, projectId, projectName, preparedBy, generatedAt,
} = {}) {
  const suppliedRecords = Array.isArray(records) ? records : []
  const rows = suppliedRecords.map((record = {}) => {
    const allocated = Boolean(record.allocateToProject)
    const allocation = allocated ? '项目费用' : '公司费用'
    return {
      expenseRecordId: text(record.expenseRecordId),
      date: text(record.date),
      expenseType: text(record.expenseType, '未分类'),
      amount: amount(record.amount),
      allocation,
      projectName: allocated ? text(record.projectName, '未绑定项目') : '公司费用',
      operator: text(record.operator, text(record.employeeName)),
      remark: text(record.remark),
    }
  })
  const total = rows.reduce((sum, row) => sum + row.amount, 0)
  const companyAmount = rows
    .filter((row) => row.allocation === '公司费用')
    .reduce((sum, row) => sum + row.amount, 0)
  const projectAmount = total - companyAmount
  const selectedProject = text(projectName) || text(projectId) || '全部项目'

  return createAccountingReportModel({
    id: 'operating-expense-report',
    title: '经营费用报表',
    preparedBy,
    generatedAt,
    orientation: 'landscape',
    fileName: `经营费用报表_${text(month, '不限月份')}`,
    filterLines: [
      { label: '费用月份', value: text(month, '不限月份') },
      { label: '费用类别', value: text(expenseType, '全部类别') },
      { label: '费用归属', value: text(allocationScope, '全部归属') },
      { label: '项目', value: selectedProject },
    ],
    recordCount: rows.length,
    summary: [
      { label: '费用记录数', value: rows.length, format: 'number' },
      { label: '费用总额', value: total, format: 'money' },
      { label: '公司费用', value: companyAmount, format: 'money' },
      { label: '项目费用', value: projectAmount, format: 'money' },
    ],
    sections: [
      {
        id: 'expense-category-summary', title: '费用类别汇总', sheetName: '费用汇总',
        columns: [
          { key: 'expenseType', label: '费用类别', width: 20 },
          { key: 'amount', label: '金额', width: 18, format: 'money' },
        ],
        rows: aggregate(rows, 'expenseType'),
      },
      {
        id: 'expense-project-summary', title: '项目费用汇总', sheetName: '费用汇总',
        columns: [
          { key: 'projectName', label: '项目', width: 26 },
          { key: 'amount', label: '金额', width: 18, format: 'money' },
        ],
        rows: aggregate(rows, 'projectName'),
      },
      {
        id: 'expense-details', title: '费用明细', sheetName: '费用明细',
        columns: detailColumns, rows,
      },
    ],
  })
}

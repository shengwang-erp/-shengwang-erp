import { createAccountingReportModel } from './accountingReportModel.js'

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function metrics(value) {
  return (Array.isArray(value) ? value : []).map((metric = {}) => ({
    item: metric.label,
    value: metric.value,
    format: metric.format,
  }))
}

/** Adapts the exact metrics already visible in the monthly summary into a report. */
export function createMonthlySummaryReport({
  month,
  coreMetrics = [],
  sourceMetrics = [],
  pendingMetrics = [],
  notes = [],
  preparedBy,
  generatedAt,
  scopeLabel,
} = {}) {
  const coreRows = metrics(coreMetrics)
  const sourceRows = metrics(sourceMetrics)
  const pendingRows = (Array.isArray(pendingMetrics) ? pendingMetrics : []).map(
    (metric = {}) => ({
      item: metric.label,
      amount: metric.value,
      itemCount: metric.count,
    }),
  )
  const reportNotes = (Array.isArray(notes) ? notes : []).map((note) => String(note))

  return createAccountingReportModel({
    id: 'monthly-summary-report',
    title: '月度成本汇总',
    preparedBy,
    generatedAt,
    orientation: 'portrait',
    fileName: `月度成本汇总_${text(month, '不限月份')}`,
    filterLines: [
      { label: '统计月份', value: text(month, '不限月份') },
      { label: '统计范围', value: text(scopeLabel, '完整成本范围') },
    ],
    recordCount: coreRows.length + sourceRows.length + pendingRows.length,
    summary: coreRows.map(({ item: label, value, format }) => ({ label, value, format })),
    sections: [
      {
        id: 'monthly-core', title: '核心成本汇总', sheetName: '月度汇总',
        columns: [
          { key: 'item', label: '汇总项目', width: 28 },
          { key: 'value', label: '数值', width: 18, align: 'right' },
        ],
        rows: coreRows,
      },
      {
        id: 'monthly-purchase-sources', title: '采购来源汇总', sheetName: '月度汇总',
        columns: [
          { key: 'item', label: '采购来源', width: 28 },
          { key: 'value', label: '金额', width: 18, align: 'right', format: 'money' },
        ],
        rows: sourceRows,
      },
      {
        id: 'monthly-pending', title: '待核算成本', sheetName: '月度汇总',
        columns: [
          { key: 'item', label: '待核算项目', width: 28 },
          { key: 'amount', label: '金额', width: 18, align: 'right', format: 'money' },
          { key: 'itemCount', label: '项数', width: 12, align: 'right', format: 'number' },
        ],
        rows: pendingRows,
      },
      {
        id: 'monthly-notes', title: '数据口径说明', sheetName: '月度汇总',
        columns: [{ key: 'note', label: '口径说明', width: 64 }],
        rows: reportNotes.map((note) => ({ note })),
      },
    ],
    notes: reportNotes,
  })
}

import { createAccountingReportModel } from './accountingReportModel.js'

const baseDetailColumns = [
  { key: 'purchaseId', label: '采购编号', width: 18 },
  { key: 'purchaseDate', label: '日期', width: 14, format: 'date' },
  { key: 'itemName', label: '商品', width: 20 },
  { key: 'supplierName', label: '供应商', width: 22 },
  { key: 'projectName', label: '项目', width: 22 },
  { key: 'purchaseSource', label: '采购来源', width: 18 },
  { key: 'totalCost', label: '采购成本', width: 16, format: 'money' },
]

const paymentDetailColumns = [
  { key: 'paidAmount', label: '已付', width: 14, format: 'money' },
  { key: 'unpaidAmount', label: '未付', width: 14, format: 'money' },
  { key: 'paymentStatus', label: '付款状态', width: 14 },
]

const anomalyLabels = {
  invalid_purchase_id: '采购编号无效',
  duplicate_purchase: '重复采购记录',
  invalid_purchase_amount: '采购金额异常',
  invalid_purchase_date: '采购日期异常',
  invalid_payment_id: '付款编号无效',
  duplicate_payment: '重复付款记录',
  invalid_payment_amount: '付款金额异常',
  orphan_payment: '孤立付款（找不到对应采购单）',
  void_purchase_payment: '作废采购仍有关联付款',
  legacy_opening_payment: '旧采购初始付款为估算值',
  overpayment: '采购存在超额付款',
  missing_project_allocation: '项目使用采购未绑定项目',
  purchase_payment_cache_mismatch: '采购付款缓存与流水不一致',
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function amount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function anomalyText(anomaly = {}) {
  const label = anomalyLabels[anomaly.code] || '采购数据异常'
  const reference = text(anomaly.paymentId) || text(anomaly.purchaseId)
  const purchaseReference = anomaly.paymentId && text(anomaly.purchaseId)
    ? `（采购 ${text(anomaly.purchaseId)}）`
    : ''
  return reference ? `${label}：${reference}${purchaseReference}` : label
}

/** Adapts already-filtered purchase reconciliation rows into the shared report model. */
export function createPurchaseAccountingReport({
  rows = [], summary = {}, anomalies = [], month, projectLabel, source, paymentStatus,
  paymentVisible = false, preparedBy, generatedAt,
} = {}) {
  const suppliedRows = Array.isArray(rows) ? rows : []
  const reportRows = suppliedRows.map((row = {}) => ({
    purchaseId: text(row.purchaseId),
    purchaseDate: text(row.purchaseDate),
    itemName: text(row.itemName),
    supplierName: text(row.supplierName),
    projectName: text(row.projectName, text(row.projectId, '未绑定')),
    purchaseSource: text(row.purchaseSource),
    totalCost: amount(row.totalCost),
    ...(paymentVisible ? {
      paidAmount: amount(row.paidAmount),
      unpaidAmount: amount(row.unpaidAmount),
      paymentStatus: text(row.paymentStatus),
    } : {}),
    invoiceStatus: text(row.invoiceStatus),
  }))
  const anomalyRows = (Array.isArray(anomalies) ? anomalies : [])
    .map((anomaly) => ({ anomaly: anomalyText(anomaly) }))
  const reportSummary = [
    { label: '采购成本', value: amount(summary.monthPurchaseCost), format: 'money' },
    ...(paymentVisible ? [
      { label: '付款现金', value: amount(summary.monthPaymentCash), format: 'money' },
      { label: '未付余额', value: amount(summary.currentOutstanding), format: 'money' },
    ] : []),
    { label: '缺少发票', value: amount(summary.missingInvoiceCount), format: 'number' },
    { label: '异常数量', value: amount(summary.anomalyCount), format: 'number' },
  ]

  return createAccountingReportModel({
    id: 'purchase-accounting-report',
    title: '采购对账报表',
    preparedBy,
    generatedAt,
    orientation: 'landscape',
    fileName: `采购对账报表_${text(month, '不限月份')}`,
    filterLines: [
      { label: '统计月份', value: text(month, '不限月份') },
      { label: '项目', value: text(projectLabel, '全部项目') },
      { label: '数据来源', value: text(source, '全部来源') },
      ...(paymentVisible ? [
        { label: '付款状态', value: text(paymentStatus, '全部状态') },
      ] : []),
    ],
    recordCount: reportRows.length,
    summary: reportSummary,
    sections: [
      {
        id: 'purchase-summary', title: '对账汇总', sheetName: '对账汇总',
        columns: [
          { key: 'item', label: '汇总项目', width: 22 },
          { key: 'value', label: '数值', width: 18 },
        ],
        rows: reportSummary.map(({ label, value }) => ({ item: label, value })),
      },
      {
        id: 'purchase-anomalies', title: '异常明细', sheetName: '对账汇总',
        columns: [{ key: 'anomaly', label: '异常内容', width: 54 }],
        rows: anomalyRows,
      },
      {
        id: 'purchase-details', title: '对账明细', sheetName: '对账明细',
        columns: [
          ...baseDetailColumns,
          ...(paymentVisible ? paymentDetailColumns : []),
          { key: 'invoiceStatus', label: '发票状态', width: 14 },
        ],
        rows: reportRows,
      },
    ],
  })
}

import { useMemo, useState } from 'react'

import AccountingReportActions from '../accounting-reports/AccountingReportActions.jsx'
import { createPurchaseAccountingReport } from '../accounting-reports/purchaseAccountingReport.js'
import { isDateInMonth } from '../executive-dashboard/dashboardTime.js'
import {
  buildPurchaseAccountingReadModel,
  filterPurchaseAccountingRows,
} from './purchaseAccountingDomain.js'

const PURCHASE_SOURCE_OPTIONS = [
  '中国采购',
  'Amazon',
  'Yahoo拍卖',
  '东鹏株式会社',
  '其他日本供应商',
  '其他',
]

const PAYMENT_STATUS_OPTIONS = ['未付款', '部分付款', '已付款']

const PAYMENT_ANOMALY_CODES = new Set([
  'invalid_payment_id',
  'duplicate_payment',
  'invalid_payment_amount',
  'orphan_payment',
  'void_purchase_payment',
  'overpayment',
  'purchase_payment_cache_mismatch',
])

const ANOMALY_LABELS = {
  invalid_purchase_id: '采购编号无效',
  duplicate_purchase: '重复采购记录',
  invalid_purchase_amount: '采购金额异常',
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

const PAYMENT_SOURCE_LOADING = Object.freeze({ status: 'loading', data: null })

function failClosedPaymentState(paymentState) {
  if (paymentState === undefined) return PAYMENT_SOURCE_LOADING
  if (paymentState === null || typeof paymentState !== 'object' || Array.isArray(paymentState)) {
    return paymentState
  }
  const staleDescriptor = Object.getOwnPropertyDescriptor(paymentState, 'stale')
  if (!staleDescriptor) return paymentState
  if (!staleDescriptor.enumerable || !Object.hasOwn(staleDescriptor, 'value')) {
    return PAYMENT_SOURCE_LOADING
  }
  return staleDescriptor.value === true ? PAYMENT_SOURCE_LOADING : paymentState
}

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function formatYen(value) {
  const amount = Number(value)
  const safeAmount = Number.isFinite(amount) ? amount : 0
  return `¥${safeAmount.toLocaleString('ja-JP')}`
}

function projectOptions(projects, purchaseRecords) {
  const options = new Map()

  for (const project of asArray(projects)) {
    if (!project?.projectId) continue
    options.set(project.projectId, project.projectName || project.projectId)
  }
  for (const purchase of asArray(purchaseRecords)) {
    if (!purchase?.projectId || options.has(purchase.projectId)) continue
    options.set(purchase.projectId, purchase.projectName || purchase.projectId)
  }

  return [...options].map(([projectId, projectName]) => ({ projectId, projectName }))
}

function groupAnomalies(anomalies) {
  const groups = new Map()

  for (const anomaly of asArray(anomalies)) {
    const key = anomaly?.code || 'unknown'
    const current = groups.get(key) || { code: key, count: 0, references: new Set() }
    current.count += 1
    if (anomaly?.paymentId) current.references.add(anomaly.paymentId)
    else if (anomaly?.purchaseId) current.references.add(anomaly.purchaseId)
    groups.set(key, current)
  }

  return [...groups.values()]
}

function anomalyText(group) {
  const label = ANOMALY_LABELS[group.code] || '采购数据异常'
  const references = [...group.references]
  return references.length > 0
    ? `${label}：${group.count} 条（${references.join('、')}）`
    : `${label}：${group.count} 条`
}

function finiteAmount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function reportFactsForRows(rows, readModel, month, paymentVisible) {
  const purchaseIds = new Set(rows.map((row) => row.purchaseId))
  const anomalies = readModel.anomalies.filter((anomaly) => {
    const purchaseId = anomaly?.purchaseId || anomaly?.record?.purchaseId
    return typeof purchaseId === 'string' && purchaseIds.has(purchaseId.trim())
  })
  const cashPayments = paymentVisible
    ? readModel.cashPaymentRows.filter((payment) => (
      purchaseIds.has(payment.purchaseId) && (!month || isDateInMonth(payment.paymentDate, month))
    ))
    : []
  return {
    summary: {
      monthPurchaseCost: rows.reduce(
        (total, row) => total + finiteAmount(row.totalCost), 0,
      ),
      monthOpeningPaid: paymentVisible
        ? rows.reduce((total, row) => total + finiteAmount(row.openingPaidAmount), 0)
        : null,
      monthPaymentCash: paymentVisible
        ? cashPayments.reduce((total, payment) => total + finiteAmount(payment.jpyAmount), 0)
        : null,
      currentOutstanding: paymentVisible
        ? rows.reduce((total, row) => total + finiteAmount(row.unpaidAmount), 0)
        : null,
      missingInvoiceCount: rows.filter((row) => row.invoiceStatus === '未取得').length,
      anomalyCount: anomalies.length,
    },
    anomalies,
  }
}

export default function PurchaseAccountingSection({
  projects = [],
  purchasePaymentRecords = [],
  paymentState,
  accrualState,
  monthFilter = '',
  onMonthFilterChange = () => {},
  reportPreparedBy = '',
  reportActionDependencies,
}) {
  const [projectFilter, setProjectFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('')

  const effectiveAccrualState = failClosedPaymentState(accrualState)
  const effectivePaymentState = failClosedPaymentState(paymentState)
  const accrualReady = effectiveAccrualState?.status === 'ready' &&
    Array.isArray(effectiveAccrualState.data)
  const effectivePurchaseRecords = accrualReady ? effectiveAccrualState.data : []
  const readModel = useMemo(() => buildPurchaseAccountingReadModel({
    purchaseRecords: effectivePurchaseRecords,
    paymentRecords: purchasePaymentRecords,
    paymentState: effectivePaymentState,
    month: monthFilter,
    projectId: projectFilter,
    source: sourceFilter,
  }), [
    effectivePurchaseRecords,
    purchasePaymentRecords,
    effectivePaymentState,
    monthFilter,
    projectFilter,
    sourceFilter,
  ])

  const paymentForbidden = effectivePaymentState?.status === 'forbidden'
  const paymentVisible = effectivePaymentState?.status === 'ready' &&
    Array.isArray(effectivePaymentState.data) &&
    readModel.currentPayable.status === 'ready'
  const paymentReportBlocked = !paymentForbidden && !paymentVisible

  const rows = useMemo(() => filterPurchaseAccountingRows(readModel.rows, {
    paymentStatus: paymentVisible ? paymentStatusFilter : '',
  }).filter((row) => !monthFilter || isDateInMonth(row.purchaseDate, monthFilter)), [
    readModel.rows, monthFilter, paymentStatusFilter, paymentVisible,
  ])
  const reportFacts = useMemo(
    () => reportFactsForRows(rows, readModel, monthFilter, paymentVisible),
    [monthFilter, paymentVisible, readModel, rows],
  )

  const availableProjects = useMemo(
    () => projectOptions(projects, effectivePurchaseRecords),
    [projects, effectivePurchaseRecords],
  )
  const anomalyGroups = useMemo(
    () => groupAnomalies(readModel.anomalies),
    [readModel.anomalies],
  )
  const paymentAnomalyCount = readModel.anomalies.filter(
    (anomaly) => PAYMENT_ANOMALY_CODES.has(anomaly.code),
  ).length
  const projectLabel = projectFilter
    ? availableProjects.find((project) => project.projectId === projectFilter)?.projectName
      || projectFilter
    : ''
  const report = useMemo(() => paymentReportBlocked ? null : createPurchaseAccountingReport({
    rows,
    summary: reportFacts.summary,
    anomalies: reportFacts.anomalies,
    month: monthFilter,
    projectLabel,
    source: sourceFilter,
    paymentStatus: paymentVisible ? paymentStatusFilter : '',
    paymentVisible,
    preparedBy: reportPreparedBy,
  }), [
    rows, reportFacts, monthFilter, projectLabel, sourceFilter,
    paymentStatusFilter, paymentVisible, paymentReportBlocked, reportPreparedBy,
  ])
  const reportContextIdentity = JSON.stringify({
    month: monthFilter,
    project: projectFilter,
    source: sourceFilter,
    paymentStatus: paymentVisible ? paymentStatusFilter : '',
    accrualReady,
    accrualStatus: effectiveAccrualState?.status || '',
    paymentVisible,
    paymentReportBlocked,
    paymentSourceStatus: effectivePaymentState?.status || '',
    rows: rows.map((row) => ({
      purchaseId: row.purchaseId,
      paidAmount: paymentVisible ? row.paidAmount : null,
      unpaidAmount: paymentVisible ? row.unpaidAmount : null,
    })),
    reportOutput: report,
  })

  if (!accrualReady) {
    const notice = effectiveAccrualState?.status === 'forbidden'
      ? '采购成本数据当前不可见'
      : effectiveAccrualState?.status === 'error'
        ? '采购成本数据暂不可用'
        : '采购成本数据正在加载'
    return (
      <section aria-labelledby="purchase-accounting-title">
        <div className="subsection-title">
          <h2 id="purchase-accounting-title">采购对账</h2>
          <span>{monthFilter}</span>
        </div>
        <div className="empty-state cost-note" role="status">{notice}</div>
      </section>
    )
  }

  return (
    <section aria-label="采购对账报表">
      <AccountingReportActions
        title="采购对账报表"
        report={report}
        disabled={paymentReportBlocked}
        contextIdentity={reportContextIdentity}
        {...reportActionDependencies}
      />

      <div className="filter-panel">
        <label className="field">
          <span>统计月份</span>
          <input
            type="month"
            value={monthFilter}
            onChange={(event) => onMonthFilterChange(event.target.value)}
          />
        </label>
        <label className="field">
          <span>项目</span>
          <select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
            <option value="">全部项目</option>
            {availableProjects.map((project) => (
              <option value={project.projectId} key={project.projectId}>
                {project.projectName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>数据来源</span>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="">全部来源</option>
            {PURCHASE_SOURCE_OPTIONS.map((source) => (
              <option value={source} key={source}>{source}</option>
            ))}
          </select>
        </label>
        {paymentVisible && (
          <label className="field">
            <span>付款状态</span>
            <select
              value={paymentStatusFilter}
              onChange={(event) => setPaymentStatusFilter(event.target.value)}
            >
              <option value="">全部状态</option>
              {PAYMENT_STATUS_OPTIONS.map((status) => (
                <option value={status} key={status}>{status}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {paymentReportBlocked && (
        <div className="empty-state cost-note" role="status">
          {effectivePaymentState?.status === 'error' ||
            effectivePaymentState?.status === 'ready'
            ? '采购付款数据暂不可用'
            : '采购付款数据正在加载'}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card money">
          <strong>{formatYen(readModel.summary.monthPurchaseCost)}</strong>
          <span>本月采购确认成本</span>
        </div>
        {paymentVisible && (
          <>
            <div className="stat-card money">
              <strong>{formatYen(readModel.summary.monthPaymentCash)}</strong>
              <span>本月已记录付款</span>
            </div>
            <div className="stat-card money">
              <strong>{formatYen(readModel.summary.currentOutstanding)}</strong>
              <span>当前未付采购款</span>
            </div>
            <div className="stat-card money">
              <strong>{formatYen(readModel.summary.monthOpeningPaid)}</strong>
              <span>本月初始付款</span>
            </div>
          </>
        )}
        <div className="stat-card">
          <strong>{readModel.summary.missingInvoiceCount}</strong>
          <span>未取得发票数量</span>
        </div>
        {paymentVisible && (
          <div className="stat-card">
            <strong>{paymentAnomalyCount}</strong>
            <span>异常付款数量</span>
          </div>
        )}
      </div>

      <div className="empty-state cost-note">
        数据来源：采购管理。本月采购付款按付款流水日期统计；采购数据更正请前往采购管理。
      </div>

      {anomalyGroups.length > 0 && (
        <div className="empty-state cost-note warning-note" role="alert">
          <strong>数据健康提示</strong>
          <ul>
            {anomalyGroups.map((group) => (
              <li key={group.code}>{anomalyText(group)}</li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty-state">暂无采购对账明细</div>
      ) : (
        <div className="payment-table-wrap">
          <table className="payment-table">
            <thead>
              <tr>
                <th>采购编号</th>
                <th>日期</th>
                <th>商品</th>
                <th>供应商</th>
                <th>项目</th>
                <th>采购成本</th>
                {paymentVisible && <th>已付</th>}
                {paymentVisible && <th>未付</th>}
                {paymentVisible && <th>付款状态</th>}
                <th>发票状态</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.purchaseId}>
                  <td>{row.purchaseId}</td>
                  <td>{row.purchaseDate || '未填写'}</td>
                  <td>{row.itemName || '未填写'}</td>
                  <td>{row.supplierName || '未填写'}</td>
                  <td>{row.projectName || row.projectId || '未绑定'}</td>
                  <td>{formatYen(row.totalCost)}</td>
                  {paymentVisible && <td>{formatYen(row.paidAmount)}</td>}
                  {paymentVisible && <td>{formatYen(row.unpaidAmount)}</td>}
                  {paymentVisible && <td>{row.paymentStatus}</td>}
                  <td>{row.invoiceStatus || '未填写'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

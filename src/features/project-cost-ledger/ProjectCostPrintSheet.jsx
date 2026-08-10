import React from 'react'
import { createPortal } from 'react-dom'

import './projectCostLedgerPrint.css'

const SOURCE_LABELS = Object.freeze({
  purchase: '采购', warehouse: '仓库', labor: '人工', vehicle: '车辆', tool: '工具',
  operating: '经营费用', manual: '手工费用',
})

function formatYen(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 4,
  }).format(number)
}

function formatInstant(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return value || '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false,
  }).format(new Date(value))
}

function groupRows(rows) {
  const result = new Map()
  for (const row of rows ?? []) {
    const categoryRows = result.get(row.category)
    if (categoryRows) categoryRows.push(row)
    else result.set(row.category, [row])
  }
  return result
}

function sumAmounts(rows) {
  return rows.reduce((total, row) => total + Number(row.effectiveAmount || 0), 0)
}

function allocationSummary(allocations) {
  if (!Array.isArray(allocations) || allocations.length === 0) return '—'
  return allocations.map(({ projectId, amount }) => `${projectId} ${formatYen(amount)}`).join(' / ')
}

export default function ProjectCostPrintSheet({ ledgerSnapshot, auditSnapshot, metadata = {} }) {
  if (!ledgerSnapshot || ledgerSnapshot.status !== 'ready') return null
  const companyName = metadata.companyName || '生旺株式会社'
  const projectName = metadata.projectName || '全部项目'
  const dateRange = metadata.dateRange || '全部日期'
  const filterSummary = metadata.filterSummary || '全部项目'
  const generatedAt = metadata.generatedAt || ledgerSnapshot.generatedAt
  const reportComplete = metadata.reportComplete !== false && ledgerSnapshot.incompleteSources.length === 0 &&
    auditSnapshot?.status === 'ready'
  const groupedRows = groupRows(ledgerSnapshot.rows)

  const sheet = (
    <article className="project-cost-print-sheet" aria-label="项目成本打印报表">
      <header className="project-cost-print-header">
        <div><strong>{companyName}</strong><span>项目成本明细账</span></div>
        <dl>
          <div><dt>项目</dt><dd>{projectName}</dd></div>
          <div><dt>统计日期</dt><dd>{dateRange}</dd></div>
          <div><dt>当前筛选</dt><dd>{filterSummary}</dd></div>
          <div><dt>生成时间</dt><dd>{formatInstant(generatedAt)}</dd></div>
          <div><dt>报表状态</dt><dd>{reportComplete ? '完整' : '数据不完整'}</dd></div>
        </dl>
      </header>

      <table className="project-cost-print-main-table">
        <thead><tr>
          {['日期', '费用类别', '来源/单号', '费用说明', '原金额', '会计调整', '最终金额', '项目', '经办人', '标记'].map((header) => <th key={header}>{header}</th>)}
        </tr></thead>
        {Array.from(groupedRows, ([category, rows]) => (
          <tbody key={category}>
            {rows.map((row) => <tr key={`${row.sourceKey}:${row.projectId}`}>
              <td>{row.date}</td><td>{row.category}</td>
              <td>{SOURCE_LABELS[row.sourceModule] || row.sourceModule}<small>{row.sourceDocumentId}</small></td>
              <td>{row.description || '—'}</td>
              <td className="project-cost-print-money">{formatYen(row.originalAmount)}</td>
              <td className="project-cost-print-money">{formatYen(row.adjustmentAmount)}</td>
              <td className="project-cost-print-money"><strong>{formatYen(row.effectiveAmount)}</strong></td>
              <td>{row.projectName || row.projectId}</td><td>{row.operator || '—'}</td>
              <td>{row.adjusted ? <strong className="project-cost-print-adjusted">已调整</strong> : '原始'}</td>
            </tr>)}
            <tr className="project-cost-print-subtotal">
              <th colSpan="6" scope="row">{category}小计</th>
              <td className="project-cost-print-money"><strong>{formatYen(sumAmounts(rows))}</strong></td>
              <td colSpan="3" />
            </tr>
          </tbody>
        ))}
        <tfoot><tr>
          <th colSpan="6" scope="row">项目总计</th>
          <td className="project-cost-print-money"><strong>{formatYen(ledgerSnapshot.totalAmount)}</strong></td>
          <td colSpan="3">共 {ledgerSnapshot.totalRows} 条</td>
        </tr></tfoot>
      </table>

      <section className="project-cost-print-audit-appendix">
        <header><h2>调整记录附页</h2><p>原始业务记录保持不变，以下为会计调整和项目拆分留痕。</p></header>
        <table>
          <thead><tr>
            {['来源键', '类型/序号', '调整前', '调整值', '调整后', '分摊变更', '修改原因', '修改人', '修改时间'].map((header) => <th key={header}>{header}</th>)}
          </tr></thead>
          <tbody>
            {(auditSnapshot?.events ?? []).map((event, index) => <tr key={`${event.sourceKey}:${event.sequenceNo}:${index}`}>
              <td>{event.sourceKey}</td><td>{event.eventType === 'allocation' ? '项目拆分' : '金额调整'} / {event.sequenceNo}</td>
              <td className="project-cost-print-money">{formatYen(event.amountBefore)}</td>
              <td className="project-cost-print-money">{formatYen(event.adjustmentAmount)}</td>
              <td className="project-cost-print-money">{formatYen(event.amountAfter)}</td>
              <td>{event.eventType === 'allocation'
                ? <><span>{allocationSummary(event.allocationsBefore)}</span><small>→ {allocationSummary(event.allocationsAfter)}</small></>
                : '—'}</td>
              <td>{event.reason || '—'}</td><td>{event.actorName || '—'}</td><td>{formatInstant(event.createdAt)}</td>
            </tr>)}
            {(auditSnapshot?.events?.length ?? 0) === 0 && <tr><td colSpan="9">暂无会计调整记录</td></tr>}
          </tbody>
        </table>
      </section>
    </article>
  )
  const root = <div className="project-cost-print-root">{sheet}</div>
  const portalTarget = globalThis.document?.body
  return portalTarget?.nodeType === 1 ? createPortal(root, portalTarget) : root
}

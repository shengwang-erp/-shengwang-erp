import { useCallback, useEffect, useMemo, useState } from 'react'

import { localDateValue } from '../projects/projectDomain.js'
import { canManageMiraisyaSettlement } from '../projects/projectPermissions.js'
import { settlementConfirmDecision } from './miraisyaSettlementDomain.js'
import { buildSettlementSelectionSummary } from './miraisyaSettlementPageModel.js'
import './miraisya.css'

function yen(value) {
  return `¥${Number(value || 0).toLocaleString('ja-JP', { maximumFractionDigits: 4 })}`
}

function statusLabel(status) {
  return { draft: '草稿', confirmed: '已冻结', voided: '已解冻/作废' }[status] || status
}

export default function MiraisyaSettlementPage({
  currentUser,
  service,
  onBack,
  onAuthInvalid,
}) {
  const today = localDateValue()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [issueDate, setIssueDate] = useState(today)
  const [candidates, setCandidates] = useState([])
  const [history, setHistory] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [voidReasons, setVoidReasons] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const canManage = canManageMiraisyaSettlement(currentUser)

  const handleError = useCallback((operationError) => {
    if (operationError?.authInvalid === true) onAuthInvalid?.(operationError)
    setError(operationError?.message || '未来社月度结算处理失败，请稍后重试')
  }, [onAuthInvalid])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextCandidates, nextHistory] = await Promise.all([
        service.listCandidates(month),
        service.list(month),
      ])
      setCandidates(nextCandidates)
      setHistory(nextHistory)
      setSelectedIds((current) => current.filter((projectId) =>
        nextCandidates.some((candidate) => candidate.projectId === projectId)
      ))
    } catch (operationError) {
      handleError(operationError)
    } finally {
      setLoading(false)
    }
  }, [handleError, month, service])

  useEffect(() => {
    void reload()
  }, [reload])

  const summary = useMemo(
    () => buildSettlementSelectionSummary(candidates, selectedIds),
    [candidates, selectedIds],
  )

  const toggleProject = (projectId) => {
    setSelectedIds((current) => current.includes(projectId)
      ? current.filter((value) => value !== projectId)
      : [...current, projectId])
  }

  const createDraft = async () => {
    if (!summary.canCreateDraft) return
    setBusy('draft')
    setError('')
    try {
      await service.createDraft({ month, issueDate, projectIds: selectedIds })
      await reload()
    } catch (operationError) {
      handleError(operationError)
    } finally {
      setBusy('')
    }
  }

  const confirm = async (settlement) => {
    const decision = settlementConfirmDecision(settlement)
    if (!decision.allowed) {
      setError(decision.reason)
      return
    }
    setBusy(`confirm:${settlement.id}`)
    setError('')
    try {
      await service.confirm({ settlementId: settlement.id, expectedVersion: settlement.version })
      await reload()
    } catch (operationError) {
      handleError(operationError)
    } finally {
      setBusy('')
    }
  }

  const voidSettlement = async (settlement) => {
    const reason = voidReasons[settlement.id]?.trim() || ''
    if (!reason) {
      setError('请填写解冻原因')
      return
    }
    setBusy(`void:${settlement.id}`)
    setError('')
    try {
      await service.void({ settlementId: settlement.id, expectedVersion: settlement.version, reason })
      await reload()
    } catch (operationError) {
      handleError(operationError)
    } finally {
      setBusy('')
    }
  }

  if (!canManage) {
    return (
      <main className="app-shell page-shell miraisya-settlement-page">
        <header className="page-header">
          <button className="back-button" type="button" onClick={onBack}>返回工程项目</button>
          <div><p className="eyebrow dark-text">株式会社未来舎サポート</p><h1>未来社月度结算</h1></div>
        </header>
        <div className="empty-state">只有社长和财务部可以进行月度结算。</div>
      </main>
    )
  }

  return (
    <main className="app-shell page-shell miraisya-settlement-page">
      <header className="page-header">
        <button className="back-button" type="button" onClick={onBack}>返回工程项目</button>
        <div><p className="eyebrow dark-text">株式会社未来舎サポート</p><h1>未来社月度结算</h1></div>
      </header>

      <section className="form-panel miraisya-settlement-filters">
        <label className="field"><span>结算月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} disabled={busy !== ''} /></label>
        <label className="field"><span>请求书日期</span><input type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} disabled={busy !== ''} /></label>
        <button className="ghost-button" type="button" onClick={reload} disabled={busy !== '' || loading}>重新读取</button>
      </section>

      {error ? <p className="project-form-error" role="alert">{error}</p> : null}

      <section className="form-panel miraisya-candidate-section">
        <div className="miraisya-section-heading"><div><h2>待结算项目</h2><span>完工月份较早但尚未确认的项目会显示为顺延项目。</span></div></div>
        {loading ? <div className="empty-state">结算候选项目读取中…</div> : null}
        {!loading && candidates.length === 0 ? <div className="empty-state">本月没有可结算的未来社项目。</div> : null}
        <div className="miraisya-candidate-list">
          {candidates.map((candidate) => (
            <label className={`miraisya-candidate-card${candidate.costComplete ? '' : ' blocked'}`} key={candidate.projectId}>
              <input type="checkbox" checked={selectedIds.includes(candidate.projectId)} onChange={() => toggleProject(candidate.projectId)} disabled={busy !== '' || !candidate.costComplete} />
              <span className="miraisya-candidate-main"><strong>{candidate.projectName}</strong><small>{candidate.address || '地址未填写'}｜完工 {candidate.completionDate}</small></span>
              {candidate.carriedForward ? <span className="miraisya-carry-badge">顺延项目</span> : null}
              <span>{yen(candidate.taxInclusiveAmount)}</span>
              {!candidate.costComplete ? <small className="miraisya-cost-blocker">成本未完整：{candidate.incompleteSources.join('、')}</small> : null}
            </label>
          ))}
        </div>
      </section>

      <section className="miraisya-summary-grid" aria-label="选中项目结算汇总">
        <article><span>已选项目</span><strong>{summary.selectedCount}</strong></article>
        <article><span>税前金额</span><strong>{yen(summary.taxExclusiveAmount)}</strong></article>
        <article><span>消费税</span><strong>{yen(summary.taxAmount)}</strong></article>
        <article><span>含税合计</span><strong>{yen(summary.taxInclusiveAmount)}</strong></article>
        <article><span>冻结成本/毛利</span><strong>{yen(summary.totalCostAmount)} / {yen(summary.marginAmount)}</strong></article>
      </section>
      {summary.carriedForwardCount > 0 ? <p className="miraisya-carry-note">包含 {summary.carriedForwardCount} 个顺延项目。</p> : null}
      {summary.incompleteSources.length > 0 ? <p className="miraisya-incomplete-cost">成本未完整：{summary.incompleteSources.join('、')}，不能生成结算草稿。</p> : null}
      <div className="form-actions"><button className="primary-button" type="button" onClick={createDraft} disabled={busy !== '' || loading || !summary.canCreateDraft}>{busy === 'draft' ? '生成中…' : '生成结算草稿'}</button></div>

      <section className="form-panel miraisya-settlement-history">
        <div className="miraisya-section-heading"><div><h2>历史结算</h2><span>冻结后保持原始项目、收费与成本快照。</span></div></div>
        {history.length === 0 && !loading ? <div className="empty-state">本月尚未生成结算。</div> : null}
        <div className="miraisya-settlement-list">
          {history.map((settlement) => (
            <article className="miraisya-settlement-card" key={settlement.id}>
              <header><div><strong>{settlement.invoiceNo}</strong><span>{statusLabel(settlement.status)}</span></div><small>{settlement.issueDate}｜{settlement.projects.length} 个项目</small></header>
              <dl>
                <div><dt>含税金额</dt><dd>{yen(settlement.taxInclusiveAmount)}</dd></div>
                <div><dt>冻结成本</dt><dd>{yen(settlement.totalCostAmount)}</dd></div>
                <div><dt>毛利</dt><dd>{yen(settlement.marginAmount)}</dd></div>
              </dl>
              <div className="miraisya-settlement-actions">
                {settlement.status === 'draft' ? <button className="primary-button" type="button" onClick={() => confirm(settlement)} disabled={busy !== ''}>确认冻结</button> : null}
                {settlement.status !== 'voided' ? <>
                  <label className="field miraisya-void-reason"><span>解冻原因</span><input value={voidReasons[settlement.id] || ''} onChange={(event) => setVoidReasons((current) => ({ ...current, [settlement.id]: event.target.value }))} disabled={busy !== ''} /></label>
                  <button className="danger-button" type="button" onClick={() => voidSettlement(settlement)} disabled={busy !== ''}>解冻并重新结算</button>
                </> : null}
              </div>
              {settlement.voidReason ? <p className="miraisya-void-note">解冻记录：{settlement.voidReason}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

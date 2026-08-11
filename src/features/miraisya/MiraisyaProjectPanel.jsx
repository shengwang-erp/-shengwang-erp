import { useEffect, useMemo, useState } from 'react'

import { createEmptyBillingItem, summarizeBillingItems } from './miraisyaBillingDomain.js'
import './miraisya.css'

function yen(value) {
  return `¥${Number(value || 0).toLocaleString('ja-JP')}`
}

export function buildMiraisyaMarginModel(billing, report) {
  const ledger = report?.ledgerSnapshot
  const incompleteSources = Array.isArray(ledger?.incompleteSources)
    ? [...ledger.incompleteSources]
    : ['project_cost_ledger']
  const categoryTotals = Array.isArray(ledger?.categoryTotals)
    ? ledger.categoryTotals.map((row) => ({ category: row.category, amount: row.amount }))
    : []
  const totalCost = Number.isFinite(ledger?.totalAmount) ? ledger.totalAmount : null
  const complete = totalCost !== null && incompleteSources.length === 0
  return {
    taxExclusiveAmount: billing.taxExclusiveAmount,
    taxAmount: billing.taxAmount,
    taxInclusiveAmount: billing.taxInclusiveAmount,
    totalCost,
    margin: complete ? billing.taxExclusiveAmount - totalCost : null,
    complete,
    incompleteSources,
    categoryTotals,
  }
}

export default function MiraisyaProjectPanel({
  project,
  billingService,
  costLedgerService,
  onClose,
}) {
  const [billing, setBilling] = useState(null)
  const [billingItems, setBillingItems] = useState([])
  const [billingError, setBillingError] = useState('')
  const [costReport, setCostReport] = useState(null)
  const [costError, setCostError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async (active = () => true) => {
    setLoading(true)
    setBillingError('')
    setCostError('')
    const [billingResult, costResult] = await Promise.allSettled([
      billingService.get(project.projectId),
      costLedgerService.report({ projectId: project.projectId }),
    ])
    if (!active()) return
    if (billingResult.status === 'fulfilled') {
      const billing = billingResult.value
      setBilling(billing)
      setBillingItems(billing.items)
    } else {
      setBilling(null)
      setBillingItems([])
      setBillingError(billingResult.reason?.message || '收费明细加载失败，请稍后重试')
    }
    if (costResult.status === 'fulfilled') {
      setCostReport(costResult.value)
    } else {
      setCostReport(null)
      setCostError(costResult.reason?.message || '项目成本加载失败，请稍后重试')
    }
    setLoading(false)
  }

  useEffect(() => {
    let mounted = true
    load(() => mounted)
    return () => { mounted = false }
  }, [project.projectId, billingService, costLedgerService])

  const draftTotals = useMemo(() => {
    try {
      return summarizeBillingItems(billingItems)
    } catch {
      return null
    }
  }, [billingItems])
  const marginModel = billing && costReport
    ? buildMiraisyaMarginModel(billing, costReport)
    : null

  const updateItem = (index, field, value) => {
    setBillingItems((current) => current.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item
    ))
  }

  const save = async () => {
    if (!billing) return
    setSaving(true)
    setBillingError('')
    try {
      const saved = await billingService.replace({
        projectId: project.projectId,
        expectedVersion: billing.version,
        items: billingItems,
      })
      setBilling(saved)
      setBillingItems(saved.items)
    } catch (error) {
      if (error?.code === 'versionConflict') {
        setBillingError('收费明细已被其他人修改，正在重新加载最新内容')
        await load()
      } else {
        setBillingError(error?.message || '收费明细保存失败，请稍后重试')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="app-shell page-shell miraisya-project-panel">
      <header className="page-header">
        <button className="back-button" type="button" onClick={onClose}>返回项目列表</button>
        <div>
          <p className="eyebrow dark-text">株式会社未来舎サポート</p>
          <h1>{project.projectName}</h1>
        </div>
      </header>

      <section className="miraisya-summary-grid" aria-label="未来社项目收支摘要">
        <article><span>税前收入</span><strong>{yen(draftTotals?.taxExclusiveAmount)}</strong></article>
        <article><span>消费税</span><strong>{yen(draftTotals?.taxAmount)}</strong></article>
        <article><span>含税收入</span><strong>{yen(draftTotals?.taxInclusiveAmount)}</strong></article>
        <article><span>总成本</span><strong>{marginModel?.totalCost === null || !marginModel ? '确认中' : yen(marginModel.totalCost)}</strong></article>
        <article>
          <span>毛利</span>
          <strong>{marginModel?.complete ? yen(marginModel.margin) : '成本未完整，暂不核算'}</strong>
        </article>
      </section>

      <section className="form-panel miraisya-billing-section">
        <div className="miraisya-section-heading">
          <div><h2>收费明细</h2><span>对外请求项目；不会从内部成本自动生成。</span></div>
          <button
            className="ghost-button"
            type="button"
            onClick={() => setBillingItems((current) => [...current, createEmptyBillingItem()])}
            disabled={loading || saving}
          >
            新增收费行
          </button>
        </div>
        {billingError ? <p className="project-form-error" role="alert">{billingError}</p> : null}
        {loading && !billing ? <div className="empty-state">收费明细加载中…</div> : null}
        <div className="miraisya-billing-list">
          {billingItems.map((item, index) => (
            <article className="miraisya-billing-row" key={`${index}-${item.itemName}`}>
              <label><span>品名</span><input value={item.itemName} onChange={(event) => updateItem(index, 'itemName', event.target.value)} /></label>
              <label><span>摘要</span><input value={item.description} onChange={(event) => updateItem(index, 'description', event.target.value)} /></label>
              <label><span>数量</span><input type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(event) => updateItem(index, 'quantity', Number(event.target.value))} /></label>
              <label><span>单位</span><input value={item.unit} onChange={(event) => updateItem(index, 'unit', event.target.value)} /></label>
              <label><span>税前单价</span><input type="number" min="0" step="1" value={item.unitPrice} onChange={(event) => updateItem(index, 'unitPrice', Number(event.target.value))} /></label>
              <label>
                <span>税率</span>
                <select value={item.taxRate} onChange={(event) => updateItem(index, 'taxRate', Number(event.target.value))}>
                  <option value="10">10%</option>
                  <option value="0">0%</option>
                </select>
              </label>
              <button className="danger-button" type="button" onClick={() => setBillingItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除行</button>
            </article>
          ))}
        </div>
        <div className="form-actions">
          <button className="primary-button" type="button" onClick={save} disabled={saving || !draftTotals || billingItems.length === 0}>
            {saving ? '保存中…' : '保存收费明细'}
          </button>
        </div>
      </section>

      <section className="form-panel miraisya-cost-section">
        <div className="miraisya-section-heading">
          <div><h2>自动归集成本</h2><span>来自采购、仓库、考勤、车辆、停车及其他现有成本来源。</span></div>
        </div>
        {costError ? <p className="project-form-error" role="alert">{costError}</p> : null}
        {costReport ? (
          <dl className="detail-list miraisya-cost-categories">
            {costReport.ledgerSnapshot.categoryTotals.map((row) => (
              <div key={row.category}><dt>{row.category}</dt><dd>{yen(row.amount)}</dd></div>
            ))}
            <div><dt>总成本</dt><dd>{yen(costReport.ledgerSnapshot.totalAmount)}</dd></div>
          </dl>
        ) : !costError ? <div className="empty-state">项目成本加载中…</div> : null}
        {marginModel && !marginModel.complete ? (
          <p className="miraisya-incomplete-cost" role="status">
            成本来源尚未完整：{marginModel.incompleteSources.join('、') || '未知来源'}。确认结算前必须补齐。
          </p>
        ) : null}
      </section>
    </main>
  )
}

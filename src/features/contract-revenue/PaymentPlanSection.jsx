import './configurablePaymentPlans.css'

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  buildPaymentPlanEditorState,
  canManagePaymentPlans,
  createBlankPaymentPlans,
  parseAllocationBasisPoints,
  preparePaymentPlanSetSave,
} from './paymentPlans.js'
import { createPaymentPlanDraftStore } from './paymentPlanDraft.js'
import { getOriginalContractMode } from './originalContract.js'

function formatYen(value) {
  const amount = Number(value)
  return `¥${(Number.isFinite(amount) ? amount : 0).toLocaleString('ja-JP')}`
}

function accountId(user) { return user?.employeeId || user?.accountId || '' }
function toFormPlans(plans) {
  return (Array.isArray(plans) ? plans : []).map((plan) => ({
    ...plan,
    allocationWeight: String(plan.allocationWeight ?? ''),
    plannedTaxInclusiveAmount: String(plan.plannedTaxInclusiveAmount ?? ''),
    dueDate: plan.dueDate || '',
    remark: plan.remark || '',
  }))
}
function hasEnteredData(plan) { return Boolean(plan?.allocationWeight || plan?.dueDate || plan?.remark || (plan?.name && !/^第\d+期$/.test(plan.name))) }
function roundPercent(points) { return (points / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1') }

function previewAmounts(total, plans) {
  try {
    const lockedAmount = plans.filter((plan) => plan.locked).reduce((sum, plan) => sum + Number(plan.plannedTaxInclusiveAmount || 0), 0)
    const unlocked = plans.filter((plan) => !plan.locked)
    const unlockedPoints = unlocked.reduce((sum, plan) => sum + parseAllocationBasisPoints(plan.allocationWeight, `${plan.planId}.allocationWeight`), 0)
    if (plans.reduce((sum, plan) => sum + parseAllocationBasisPoints(plan.allocationWeight, `${plan.planId}.allocationWeight`), 0) !== 10000) return null
    if (unlocked.length === 0) return Object.fromEntries(plans.map((plan) => [plan.planId, Number(plan.plannedTaxInclusiveAmount)]))
    if (unlockedPoints <= 0 || total < lockedAmount) return null
    const remaining = total - lockedAmount
    let allocated = 0
    const values = {}
    plans.forEach((plan) => {
      if (plan.locked) { values[plan.planId] = Number(plan.plannedTaxInclusiveAmount); return }
      const index = unlocked.findIndex((item) => item.planId === plan.planId)
      const amount = index === unlocked.length - 1 ? remaining - allocated : Math.round(remaining * parseAllocationBasisPoints(plan.allocationWeight) / unlockedPoints)
      allocated += amount
      values[plan.planId] = amount
    })
    return values
  } catch { return null }
}

export default function PaymentPlanSection({
  project,
  revenueSnapshot,
  paymentPlans = [],
  receipts = [],
  currentUser,
  onSavePaymentPlanSet,
}) {
  const [formPlans, setFormPlans] = useState([])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const loadedKey = useRef('')
  const draftStore = useMemo(() => createPaymentPlanDraftStore(), [])
  const mode = getOriginalContractMode(project)
  const creationAllowed = canManagePaymentPlans(project)
  const adjustedTaxInclusiveAmount = revenueSnapshot?.adjustedTaxInclusiveAmount ?? 0

  const editorResult = useMemo(() => {
    if (!creationAllowed) return { state: null, error: '' }
    try { return { state: buildPaymentPlanEditorState({ project, adjustedTaxInclusiveAmount, paymentPlans, receipts }), error: '' } }
    catch (readError) { return { state: null, error: readError?.message || '收款计划读取失败' } }
  }, [creationAllowed, project, adjustedTaxInclusiveAmount, paymentPlans, receipts])
  const editorState = editorResult.state
  const draftKey = `${accountId(currentUser)}:${project?.projectId || ''}`

  useEffect(() => {
    if (!editorState || loadedKey.current === draftKey) return
    loadedKey.current = draftKey
    const draft = draftStore.load(accountId(currentUser), project.projectId)
    setFormPlans(toFormPlans(draft || editorState.plans))
    setDirty(Boolean(draft))
    setError('')
    setMessage(draft ? '已恢复本项目尚未保存的收款计划草稿。' : '')
  }, [draftKey, draftStore, editorState, currentUser, project])

  useEffect(() => {
    if (!dirty || !project?.projectId || formPlans.length === 0) return
    draftStore.save(accountId(currentUser), project.projectId, formPlans)
  }, [dirty, draftStore, currentUser, project?.projectId, formPlans])

  const setPlansAsEdit = (next) => {
    setFormPlans(next.map((plan, index) => ({ ...plan, installmentOrder: index + 1 })))
    setDirty(true); setError(''); setMessage('')
  }
  const updateField = (planId, field, value) => setPlansAsEdit(formPlans.map((plan) => plan.planId === planId ? { ...plan, [field]: value } : plan))

  const changeCount = (count) => {
    if (count < 1 || count > 24 || count === formPlans.length) return
    const removed = formPlans.slice(count)
    if (removed.some((plan) => plan.locked)) { setError('已有关联实际到账的期次不能删除。'); return }
    if (removed.some(hasEnteredData) && !globalThis.confirm?.('减少期数会删除已填写的未收款期次，是否继续？')) return
    const next = formPlans.slice(0, count)
    while (next.length < count) next.push({ ...createBlankPaymentPlans(project.projectId, 1)[0], installmentOrder: next.length + 1, name: `第${next.length + 1}期` })
    setPlansAsEdit(next)
  }

  const addPlan = () => changeCount(formPlans.length + 1)
  const removePlan = (planId) => {
    if (formPlans.length <= 1) { setError('收款计划至少保留一期。'); return }
    const target = formPlans.find((plan) => plan.planId === planId)
    if (target?.locked) { setError('该期已有实际到账，不能删除。'); return }
    if (hasEnteredData(target) && !globalThis.confirm?.('删除后该期已填写内容将丢失，是否继续？')) return
    setPlansAsEdit(formPlans.filter((plan) => plan.planId !== planId))
  }

  const average = () => {
    const unlocked = formPlans.filter((plan) => !plan.locked)
    if (!unlocked.length) { setError('全部期次已锁定，不能重新平均分配。'); return }
    const lockedPoints = formPlans.filter((plan) => plan.locked).reduce((sum, plan) => { try { return sum + parseAllocationBasisPoints(plan.allocationWeight) } catch { return sum } }, 0)
    const remaining = 10000 - lockedPoints
    if (remaining < 0) { setError('已锁定期次比例合计超过100%。'); return }
    const base = Math.floor(remaining / unlocked.length)
    const next = formPlans.map((plan) => {
      if (plan.locked) return plan
      const index = unlocked.findIndex((item) => item.planId === plan.planId)
      return { ...plan, allocationWeight: roundPercent(index === unlocked.length - 1 ? remaining - base * (unlocked.length - 1) : base) }
    })
    setPlansAsEdit(next)
  }

  let weightPoints = 0
  let weightError = ''
  for (const plan of formPlans) { try { weightPoints += parseAllocationBasisPoints(plan.allocationWeight) } catch (e) { weightError = e.message; break } }
  const amounts = useMemo(() => previewAmounts(adjustedTaxInclusiveAmount, formPlans), [adjustedTaxInclusiveAmount, formPlans])
  const displayedAmountTotal = amounts ? Object.values(amounts).reduce((sum, amount) => sum + amount, 0) : formPlans.reduce((sum, plan) => sum + (Number(plan.plannedTaxInclusiveAmount) || 0), 0)
  const amountDifference = adjustedTaxInclusiveAmount - displayedAmountTotal

  const handleSave = async (event) => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('')
    try {
      const proposed = formPlans.map((plan) => ({ ...plan, plannedTaxInclusiveAmount: amounts?.[plan.planId] ?? plan.plannedTaxInclusiveAmount }))
      const prepared = preparePaymentPlanSetSave({ project, adjustedTaxInclusiveAmount, currentPlans: paymentPlans, proposedPlans: proposed, receipts, actor: currentUser })
      const saved = await onSavePaymentPlanSet(project.projectId, prepared)
      draftStore.clear(accountId(currentUser), project.projectId)
      setFormPlans(toFormPlans(saved)); setDirty(false)
      setMessage('收款计划已完整保存。')
    } catch (saveError) { setError(saveError?.message || '收款计划保存失败，已保留当前内容。') }
    finally { setSaving(false) }
  }

  const discard = () => {
    if (dirty && !globalThis.confirm?.('确定放弃当前未保存的收款计划内容吗？')) return
    draftStore.clear(accountId(currentUser), project.projectId)
    setFormPlans(toFormPlans(editorState?.plans || [])); setDirty(false); setError(''); setMessage('已恢复为最近一次成功保存的内容。')
  }

  return (
    <section className="form-panel contract-section payment-plan-section">
      <div className="contract-section-heading"><div><p className="eyebrow payment-plan-eyebrow">收款安排</p><h2>收款计划</h2></div><span className={`contract-state-badge ${creationAllowed ? 'confirmed' : ''}`}>{editorState?.mode === 'initial' ? '待建立' : `${formPlans.length}期`}</span></div>
      {mode === 'legacy_readonly' && <div className="warning-note contract-warning">需要完成历史合同迁移。未迁移旧项目仅可查看，暂时不能建立收款计划。</div>}
      {mode !== 'legacy_readonly' && !creationAllowed && <div className="warning-note contract-warning">请先完整保存原始合同后再设置收款计划。</div>}
      {editorResult.error && <div className="form-error contract-message">{editorResult.error}</div>}
      {creationAllowed && editorState && (
        <form onSubmit={handleSave}>
          <div className="payment-plan-note">比例合计必须为100%。计划金额以调整后税入合同金额为基础按日元整数计算，最后一个未锁定期次承接取整差额。</div>
          {editorState.contractDifference !== 0 && editorState.mode !== 'initial' && <div className="payment-plan-manual-alert" role="alert"><strong>合同金额与已保存计划存在差额</strong><span>{formatYen(editorState.contractDifference)}</span><small>系统不会静默改写历史计划；请检查未收款期次后主动保存。</small></div>}
          <div className="payment-plan-controls">
            <span>期数：</span>
            <button type="button" className={formPlans.length === 3 ? 'active' : ''} onClick={() => changeCount(3)}>三期</button>
            <button type="button" className={formPlans.length === 4 ? 'active' : ''} onClick={() => changeCount(4)}>四期</button>
            <button type="button" className={!([3, 4].includes(formPlans.length)) ? 'active' : ''} onClick={addPlan}>自定义／增加一期</button>
            <button type="button" onClick={average}>平均分配</button>
          </div>
          <div className="payment-plan-summary">
            <div><span>调整后税入合同金额</span><strong>{formatYen(adjustedTaxInclusiveAmount)}</strong></div>
            <div><span>比例合计</span><strong className={weightPoints === 10000 && !weightError ? '' : 'danger-text'}>{(weightPoints / 100).toFixed(2).replace(/\.00$/, '')}%</strong></div>
            <div><span>计划金额合计</span><strong className={amountDifference === 0 ? '' : 'danger-text'}>{formatYen(displayedAmountTotal)}</strong></div>
            <div><span>未分配差额</span><strong className={amountDifference === 0 ? '' : 'danger-text'}>{formatYen(amountDifference)}</strong></div>
          </div>
          {weightError && <div className="form-error contract-message">{weightError}</div>}
          <div className="payment-plan-list">
            {formPlans.map((plan) => (
              <fieldset className={`payment-plan-card ${plan.locked ? 'locked' : ''}`} key={plan.planId}>
                <legend>第{plan.installmentOrder}期 {plan.locked && <span>已有到账 · 比例和金额已锁定</span>}</legend>
                <div className="payment-plan-row">
                  <label className="field"><span>名称</span><input value={plan.name} maxLength="80" onChange={(e) => updateField(plan.planId, 'name', e.target.value)} required /></label>
                  <label className="field"><span>比例（%）</span><input type="number" min="0" max="100" step="0.01" value={plan.allocationWeight} disabled={plan.locked} onChange={(e) => updateField(plan.planId, 'allocationWeight', e.target.value)} required /></label>
                  <label className="field"><span>计划金额（日元）</span><input type="number" value={amounts?.[plan.planId] ?? plan.plannedTaxInclusiveAmount} disabled /></label>
                  <label className="field"><span>约定日期</span><input type="date" value={plan.dueDate} onChange={(e) => updateField(plan.planId, 'dueDate', e.target.value)} required /></label>
                  <label className="field payment-plan-remark"><span>付款条件／备注</span><textarea value={plan.remark} maxLength="1000" onChange={(e) => updateField(plan.planId, 'remark', e.target.value)} /></label>
                  <button className="danger-button payment-plan-delete" type="button" disabled={plan.locked || formPlans.length <= 1} onClick={() => removePlan(plan.planId)}>删除本期</button>
                </div>
              </fieldset>
            ))}
          </div>
          {error && <div className="form-error contract-message">{error}</div>}
          {message && <div className="contract-success contract-message">{message}</div>}
          <div className="form-actions contract-actions"><button className="primary-button" type="submit" disabled={saving || !onSavePaymentPlanSet}>{saving ? '保存中…' : '保存收款计划'}</button><button className="ghost-button" type="button" disabled={saving} onClick={discard}>放弃／清空未保存内容</button></div>
        </form>
      )}
    </section>
  )
}

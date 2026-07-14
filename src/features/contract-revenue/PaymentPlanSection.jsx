import { useEffect, useMemo, useState } from 'react'

import {
  PAYMENT_STAGE_LABELS,
  buildPaymentPlanEditorState,
  calculatePaymentPlanAmountPreview,
  canManagePaymentPlans,
  preparePaymentPlanSave,
} from './paymentPlans.js'
import { getOriginalContractMode } from './originalContract.js'

const MANUAL_REASON_LABELS = Object.freeze({
  incomplete_payment_plan: '三期计划记录不完整',
  locked_amount_exceeds_contract: '锁定阶段金额超过调整后合同金额',
  all_stages_locked: '三期均已有实际收款，无法自动调整',
  no_positive_remaining_amount: '没有可供未收阶段分配的正数金额',
  invalid_allocation_weights: '未锁定阶段比例无效',
})

function formatYen(value) {
  const amount = Number(value)
  return `¥${(Number.isFinite(amount) ? amount : 0).toLocaleString('ja-JP')}`
}

function toFormPlans(plans) {
  return (Array.isArray(plans) ? plans : []).map((plan) => ({
    ...plan,
    allocationWeight: String(plan.allocationWeight ?? ''),
    plannedTaxInclusiveAmount: String(plan.plannedTaxInclusiveAmount ?? ''),
    dueDate: plan.dueDate || '',
    remark: plan.remark || '',
  }))
}

function numericTotal(plans, field) {
  return plans.reduce((total, plan) => {
    const value = Number(plan[field])
    return total + (Number.isFinite(value) ? value : 0)
  }, 0)
}

export default function PaymentPlanSection({
  project,
  revenueSnapshot,
  paymentPlans = [],
  receipts = [],
  currentUser,
  onSavePaymentPlan,
}) {
  const [formPlans, setFormPlans] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const mode = getOriginalContractMode(project)
  const creationAllowed = canManagePaymentPlans(project)
  const adjustedTaxInclusiveAmount =
    revenueSnapshot?.adjustedTaxInclusiveAmount ?? 0

  const editorResult = useMemo(() => {
    if (!creationAllowed) return { state: null, error: '' }
    try {
      return {
        state: buildPaymentPlanEditorState({
          project,
          adjustedTaxInclusiveAmount,
          paymentPlans,
          receipts,
        }),
        error: '',
      }
    } catch (editorError) {
      return {
        state: null,
        error: editorError?.message || '收款计划读取失败',
      }
    }
  }, [
    creationAllowed,
    project,
    adjustedTaxInclusiveAmount,
    paymentPlans,
    receipts,
  ])
  const editorState = editorResult.state

  useEffect(() => {
    setFormPlans(toFormPlans(editorState?.plans))
    setError('')
    setMessage('')
  }, [editorState])

  const initialAmountPreview = useMemo(() => {
    if (editorState?.mode !== 'initial' || formPlans.length !== 3) return null
    try {
      return calculatePaymentPlanAmountPreview(
        adjustedTaxInclusiveAmount,
        formPlans,
      )
    } catch {
      return null
    }
  }, [editorState?.mode, adjustedTaxInclusiveAmount, formPlans])

  const updatePlanField = (stage, field, value) => {
    setFormPlans((current) =>
      current.map((plan) =>
        plan.stage === stage ? { ...plan, [field]: value } : plan,
      ),
    )
    setError('')
    setMessage('')
  }

  const handleSave = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const proposedPlans = formPlans.map((plan) => ({
        ...plan,
        plannedTaxInclusiveAmount:
          initialAmountPreview?.[plan.stage] ?? plan.plannedTaxInclusiveAmount,
      }))
      const preparedPlans = preparePaymentPlanSave({
        project,
        adjustedTaxInclusiveAmount,
        currentPlans: paymentPlans,
        proposedPlans,
        receipts,
        actor: currentUser,
        mode: editorState.mode,
      })
      await Promise.all(preparedPlans.map((plan) => onSavePaymentPlan(plan)))
      setMessage('首期款、中期款、尾款计划已保存。')
    } catch (saveError) {
      setError(saveError?.message || '收款计划保存失败')
    } finally {
      setSaving(false)
    }
  }

  const weightTotal = numericTotal(formPlans, 'allocationWeight')
  const displayedAmountTotal = formPlans.reduce((total, plan) => {
    const previewValue = initialAmountPreview?.[plan.stage]
    const amount = Number(
      previewValue === undefined ? plan.plannedTaxInclusiveAmount : previewValue,
    )
    return total + (Number.isFinite(amount) ? amount : 0)
  }, 0)

  return (
    <section className="form-panel contract-section payment-plan-section">
      <div className="contract-section-heading">
        <div>
          <p className="eyebrow dark-text">收款安排</p>
          <h2>首期款、中期款、尾款计划</h2>
        </div>
        <span className={`contract-state-badge ${creationAllowed ? 'confirmed' : ''}`}>
          {editorState?.mode === 'initial' ? '待建立' : '三期固定'}
        </span>
      </div>

      {mode === 'legacy_readonly' && (
        <div className="warning-note contract-warning">
          需要迁移后复核。未迁移旧项目仅可查看，暂时不能建立收款计划。
        </div>
      )}
      {mode !== 'legacy_readonly' && !creationAllowed && (
        <div className="warning-note contract-warning">
          原始合同完成会计确认后才能设置收款计划。
        </div>
      )}
      {editorResult.error && (
        <div className="form-error contract-message">{editorResult.error}</div>
      )}

      {creationAllowed && editorState && (
        <form onSubmit={handleSave}>
          {editorState.mode === 'initial' && (
            <div className="payment-plan-note">
              首次保存时三期比例合计必须等于100%；计划金额按调整后税込合同金额计算，尾款吸收日元取整差额。
            </div>
          )}
          {editorState.hasPendingReallocation && (
            <div className="payment-plan-reallocation-note">
              合同金额已变化：已有实际收款的阶段保持锁定，未收款阶段已重新分配，请确认后保存。
            </div>
          )}
          {editorState.needsAccountingAction && (
            <div className="payment-plan-manual-alert" role="alert">
              <strong>需要会计处理</strong>
              <span>
                {MANUAL_REASON_LABELS[editorState.allocationReason] ||
                  editorState.allocationReason ||
                  '自动分配失败'}
              </span>
              <small>
                请手动填写未锁定阶段金额；全部阶段合计必须等于调整后税込合同金额。
              </small>
            </div>
          )}

          <div className="payment-plan-summary">
            <div>
              <span>调整后税込合同金额</span>
              <strong>{formatYen(adjustedTaxInclusiveAmount)}</strong>
            </div>
            <div>
              <span>比例合计</span>
              <strong className={Math.abs(weightTotal - 100) < 1e-9 ? '' : 'danger-text'}>
                {weightTotal}%
              </strong>
            </div>
            <div>
              <span>三期计划合计</span>
              <strong
                className={
                  displayedAmountTotal === adjustedTaxInclusiveAmount
                    ? ''
                    : 'danger-text'
                }
              >
                {formatYen(displayedAmountTotal)}
              </strong>
            </div>
          </div>

          <div className="payment-plan-grid">
            {formPlans.map((plan) => {
              const displayedAmount =
                initialAmountPreview?.[plan.stage] ??
                plan.plannedTaxInclusiveAmount
              return (
                <fieldset
                  className={`payment-plan-card ${plan.locked ? 'locked' : ''}`}
                  key={plan.stage}
                >
                  <legend>
                    {PAYMENT_STAGE_LABELS[plan.stage]}
                    {plan.locked && <span>已有收款 · 已锁定</span>}
                  </legend>
                  <label className="field">
                    <span>分配比例（%）</span>
                    <input
                      name={`${plan.stage}.allocationWeight`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={plan.allocationWeight}
                      disabled={plan.locked}
                      onChange={(event) =>
                        updatePlanField(
                          plan.stage,
                          'allocationWeight',
                          event.target.value,
                        )
                      }
                      required
                    />
                  </label>
                  <label className="field">
                    <span>计划金额（税込日元）</span>
                    <input
                      name={`${plan.stage}.plannedTaxInclusiveAmount`}
                      type="number"
                      min="0"
                      step="1"
                      value={displayedAmount}
                      disabled={editorState.mode !== 'manual' || plan.locked}
                      onChange={(event) =>
                        updatePlanField(
                          plan.stage,
                          'plannedTaxInclusiveAmount',
                          event.target.value,
                        )
                      }
                      required
                    />
                    <small>该金额将作为 plannedTaxInclusiveAmount 保存。</small>
                  </label>
                  <label className="field">
                    <span>约定日期</span>
                    <input
                      name={`${plan.stage}.dueDate`}
                      type="date"
                      value={plan.dueDate}
                      onChange={(event) =>
                        updatePlanField(plan.stage, 'dueDate', event.target.value)
                      }
                      required
                    />
                  </label>
                  <label className="field">
                    <span>备注</span>
                    <textarea
                      name={`${plan.stage}.remark`}
                      value={plan.remark}
                      onChange={(event) =>
                        updatePlanField(plan.stage, 'remark', event.target.value)
                      }
                      placeholder="填写付款条件或提醒事项"
                    />
                  </label>
                </fieldset>
              )
            })}
          </div>

          {error && <div className="form-error contract-message">{error}</div>}
          {message && <div className="contract-success contract-message">{message}</div>}

          <div className="form-actions contract-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存三期计划'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}

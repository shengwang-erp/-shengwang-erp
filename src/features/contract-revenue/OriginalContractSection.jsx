import { useEffect, useState } from 'react'

import {
  confirmHistoricalContractReview,
  confirmOriginalContract,
  getOriginalContractMode,
  saveOriginalContractDraft,
} from './originalContract.js'

function formatYen(value) {
  const amount = Number(value)
  return `¥${(Number.isFinite(amount) ? amount : 0).toLocaleString('ja-JP')}`
}

function formatProgress(value) {
  const progress = Number(value)
  return `${Number.isFinite(progress) ? Math.round(progress) : 0}%`
}

function createFormValue(project) {
  return {
    taxExclusiveAmount: project?.originalContractTaxExclusiveAmount ?? '',
    taxRate: project?.originalContractTaxRate ?? '',
    taxAmount: project?.originalContractTaxAmount ?? '',
    taxInclusiveAmount: project?.originalContractTaxInclusiveAmount ?? '',
  }
}

function ContractAmountDetails({ project }) {
  return (
    <dl className="detail-list contract-amount-details">
      <div>
        <dt>税抜金额</dt>
        <dd>{formatYen(project.originalContractTaxExclusiveAmount)}</dd>
      </div>
      <div>
        <dt>税率</dt>
        <dd>{Number(project.originalContractTaxRate) || 0}%</dd>
      </div>
      <div>
        <dt>税额</dt>
        <dd>{formatYen(project.originalContractTaxAmount)}</dd>
      </div>
      <div>
        <dt>税込金额</dt>
        <dd>{formatYen(project.originalContractTaxInclusiveAmount)}</dd>
      </div>
    </dl>
  )
}

export default function OriginalContractSection({
  project,
  revenueSnapshot,
  currentUser,
  onProjectChange,
  onHistoricalReview,
}) {
  const mode = getOriginalContractMode(project)
  const [form, setForm] = useState(() => createFormValue(project))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const savedForm = createFormValue(project)
  const isDraftDirty =
    mode === 'draft' &&
    Object.keys(savedForm).some(
      (field) => String(form[field]) !== String(savedForm[field]),
    )

  useEffect(() => {
    setForm(createFormValue(project))
    setError('')
  }, [project])

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
    setMessage('')
  }

  const handleSaveDraft = (event) => {
    event.preventDefault()
    try {
      const nextProject = saveOriginalContractDraft(project, form)
      onProjectChange(nextProject)
      setMessage('原始合同草稿已保存，可以执行会计确认。')
      setError('')
    } catch (saveError) {
      setError(saveError?.message || '原始合同草稿保存失败')
      setMessage('')
    }
  }

  const handleConfirm = () => {
    if (isDraftDirty) {
      setError('请先保存最新草稿后再执行会计确认。')
      setMessage('')
      return
    }

    if (
      typeof window !== 'undefined' &&
      !window.confirm('会计确认后原始合同金额将锁定，确定继续吗？')
    ) {
      return
    }

    try {
      const nextProject = confirmOriginalContract(
        project,
        currentUser,
        new Date().toISOString(),
      )
      onProjectChange(nextProject)
      setMessage('原始合同已完成会计确认并锁定。')
      setError('')
    } catch (confirmError) {
      setError(confirmError?.message || '会计确认失败')
      setMessage('')
    }
  }

  const handleHistoricalReview = async () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('历史合同复核确认后将转为正式确认并锁定，确定继续吗？')
    ) {
      return
    }

    try {
      const nextProject = confirmHistoricalContractReview(
        project,
        form,
        currentUser,
        new Date().toISOString(),
      )
      await onHistoricalReview(nextProject)
      setMessage('历史合同已完成会计复核并锁定。')
      setError('')
    } catch (reviewError) {
      setError(reviewError?.message || '历史合同复核失败')
      setMessage('')
    }
  }

  if (mode === 'legacy_readonly') {
    return (
      <section className="form-panel contract-section">
        <div className="contract-section-heading">
          <div>
            <p className="eyebrow dark-text">原始合同</p>
            <h2>历史合同金额</h2>
          </div>
          <span className="contract-state-badge legacy">未迁移</span>
        </div>
        <div className="warning-note contract-warning">
          需要迁移后复核。当前仅显示旧合同金额和旧已收款金额，暂时不能编辑。
        </div>
        <dl className="detail-list">
          <div>
            <dt>旧合同金额</dt>
            <dd>{formatYen(project.contractAmount)}</dd>
          </div>
          <div>
            <dt>旧已收款金额</dt>
            <dd>{formatYen(project.paidAmount)}</dd>
          </div>
        </dl>
      </section>
    )
  }

  if (mode === 'confirmed') {
    const historical =
      project.contractConfirmationStatus === 'historical_migrated_confirmed'

    if (historical && project.needsManualReview) {
      return (
        <section className="form-panel contract-section historical-contract-review">
          <div className="contract-section-heading">
            <div>
              <p className="eyebrow dark-text">原始合同</p>
              <h2>历史合同人工复核</h2>
            </div>
            <span className="contract-state-badge legacy">待会计复核</span>
          </div>

          <div className="warning-note contract-warning">
            复核确认前，当前历史税込合同金额、累计收款和收款进度保持不变。
          </div>
          <ContractAmountDetails project={project} />
          <dl className="detail-list compact historical-review-baseline">
            <div>
              <dt>当前税込合同金额</dt>
              <dd>
                {formatYen(
                  revenueSnapshot?.adjustedTaxInclusiveAmount ??
                    project.originalContractTaxInclusiveAmount,
                )}
              </dd>
            </div>
            <div>
              <dt>当前累计收款</dt>
              <dd>{formatYen(revenueSnapshot?.totalReceivedTaxInclusiveAmount)}</dd>
            </div>
            <div>
              <dt>当前收款进度</dt>
              <dd>{formatProgress(revenueSnapshot?.paymentProgress)}</dd>
            </div>
          </dl>

          <div className="contract-change-form">
            <div className="form-grid">
              <label className="field">
                <span>正确税抜金额（日元）</span>
                <input
                  name="taxExclusiveAmount"
                  type="number"
                  min="1"
                  step="1"
                  value={form.taxExclusiveAmount}
                  onChange={(event) =>
                    updateField('taxExclusiveAmount', event.target.value)
                  }
                  required
                />
              </label>
              <label className="field">
                <span>正确税率（%）</span>
                <input
                  name="taxRate"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.taxRate}
                  onChange={(event) => updateField('taxRate', event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>正确税额（日元）</span>
                <input
                  name="taxAmount"
                  type="number"
                  min="0"
                  step="1"
                  value={form.taxAmount}
                  onChange={(event) => updateField('taxAmount', event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>正确税込金额（日元）</span>
                <input
                  name="taxInclusiveAmount"
                  type="number"
                  min="1"
                  step="1"
                  value={form.taxInclusiveAmount}
                  onChange={(event) =>
                    updateField('taxInclusiveAmount', event.target.value)
                  }
                  required
                />
              </label>
            </div>

            {error && <div className="form-error contract-message">{error}</div>}
            {message && <div className="contract-success contract-message">{message}</div>}

            <div className="form-actions contract-actions">
              <button
                className="primary-button"
                type="button"
                onClick={handleHistoricalReview}
              >
                确认历史合同复核
              </button>
            </div>
          </div>
        </section>
      )
    }

    return (
      <section className="form-panel contract-section">
        <div className="contract-section-heading">
          <div>
            <p className="eyebrow dark-text">原始合同</p>
            <h2>已确认合同</h2>
          </div>
          <span className="contract-state-badge confirmed">
            {historical ? '历史迁移确认' : '已确认'}
          </span>
        </div>
        <div className="contract-lock-note">原始合同已锁定，不能直接修改。</div>
        {historical && project.needsManualReview && (
          <div className="warning-note contract-warning">历史迁移数据仍需要会计复核。</div>
        )}
        <ContractAmountDetails project={project} />
        <dl className="detail-list compact contract-confirmation-details">
          <div>
            <dt>确认人</dt>
            <dd>{project.contractConfirmedByName || '历史迁移记录'}</dd>
          </div>
          <div>
            <dt>确认人ID</dt>
            <dd>{project.contractConfirmedById || '未记录'}</dd>
          </div>
          <div>
            <dt>确认时间</dt>
            <dd>{project.contractConfirmedAt || '未记录'}</dd>
          </div>
        </dl>
      </section>
    )
  }

  return (
    <section className="form-panel contract-section">
      <div className="contract-section-heading">
        <div>
          <p className="eyebrow dark-text">原始合同</p>
          <h2>{mode === 'draft' ? '合同金额草稿' : '录入原始合同'}</h2>
        </div>
        <span className={`contract-state-badge ${mode}`}>
          {mode === 'draft' ? '草稿' : '待录入'}
        </span>
      </div>

      <form onSubmit={handleSaveDraft}>
        <div className="form-grid">
          <label className="field">
            <span>税抜金额（日元）</span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.taxExclusiveAmount}
              onChange={(event) => updateField('taxExclusiveAmount', event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>税率（%）</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.taxRate}
              onChange={(event) => updateField('taxRate', event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>税额（日元）</span>
            <input
              type="number"
              min="0"
              step="1"
              value={form.taxAmount}
              onChange={(event) => updateField('taxAmount', event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>税込金额（日元）</span>
            <input
              type="number"
              min="1"
              step="1"
              value={form.taxInclusiveAmount}
              onChange={(event) => updateField('taxInclusiveAmount', event.target.value)}
              required
            />
          </label>
        </div>

        {error && <div className="form-error contract-message">{error}</div>}
        {message && <div className="contract-success contract-message">{message}</div>}

        <div className="form-actions contract-actions">
          <button className="primary-button" type="submit">
            保存草稿
          </button>
          {mode === 'draft' && (
            <button className="ghost-button contract-confirm-button" type="button" onClick={handleConfirm}>
              会计确认
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

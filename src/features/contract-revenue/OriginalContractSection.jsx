import { useEffect, useMemo, useRef, useState } from 'react'

import {
  calculateOriginalContractAmounts,
  getOriginalContractMode,
  getOriginalContractRoundingWarning,
  isOriginalContractSaved,
  saveOriginalContract,
} from './originalContract.js'
import { createOriginalContractDraftStore } from './originalContractDraft.js'

function formatYen(value) {
  const amount = Number(value)
  return `¥${(Number.isFinite(amount) ? amount : 0).toLocaleString('ja-JP')}`
}

function createFormValue(project) {
  return {
    taxInclusiveAmount: String(project?.originalContractTaxInclusiveAmount ?? ''),
    taxRate: String(project?.originalContractTaxRate ?? ''),
    taxExclusiveAmount: String(project?.originalContractTaxExclusiveAmount ?? ''),
    taxAmount: String(project?.originalContractTaxAmount ?? ''),
  }
}

function accountId(currentUser) {
  return currentUser?.id || currentUser?.employeeId || currentUser?.accountId || ''
}

function ContractAmountDetails({ project }) {
  return (
    <dl className="detail-list contract-amount-details">
      <div>
        <dt>含税总金额</dt>
        <dd>{formatYen(project.originalContractTaxInclusiveAmount)}</dd>
      </div>
      <div>
        <dt>税率</dt>
        <dd>{Number(project.originalContractTaxRate) || 0}%</dd>
      </div>
      <div>
        <dt>税拔金额</dt>
        <dd>{formatYen(project.originalContractTaxExclusiveAmount)}</dd>
      </div>
      <div>
        <dt>税额</dt>
        <dd>{formatYen(project.originalContractTaxAmount)}</dd>
      </div>
    </dl>
  )
}

export default function OriginalContractSection({
  project,
  currentUser,
  canEditContract = false,
  editBlockedByRevenueActivity = false,
  onProjectChange,
}) {
  const mode = getOriginalContractMode(project)
  const persisted = isOriginalContractSaved(project)
  const isEditable = canEditContract && !editBlockedByRevenueActivity
  const [form, setForm] = useState(() => createFormValue(project))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const loadedKey = useRef('')
  const draftStore = useMemo(() => createOriginalContractDraftStore(), [])
  const draftKey = `${accountId(currentUser)}:${project?.projectId || ''}`

  useEffect(() => {
    if (!project?.projectId || loadedKey.current === draftKey) return
    loadedKey.current = draftKey
    const storedDraft = mode === 'confirmed'
      ? null
      : draftStore.load(accountId(currentUser), project.projectId)
    setForm(storedDraft || createFormValue(project))
    setDirty(Boolean(storedDraft))
    setError('')
    setMessage(storedDraft ? '已恢复本项目尚未保存的原始合同内容。' : '')
  }, [draftKey, draftStore, currentUser, mode, project])

  useEffect(() => {
    if (!dirty || mode === 'confirmed' || !project?.projectId) return
    draftStore.save(accountId(currentUser), project.projectId, form)
  }, [dirty, draftStore, form, currentUser, mode, project?.projectId])

  const updateCalculationField = (field, value) => {
    let nextForm = { ...form, [field]: value }
    let nextError = ''
    if (nextForm.taxInclusiveAmount === '' || nextForm.taxRate === '') {
      nextForm = { ...nextForm, taxExclusiveAmount: '', taxAmount: '' }
    } else {
      try {
        const calculated = calculateOriginalContractAmounts(
          nextForm.taxInclusiveAmount,
          nextForm.taxRate,
        )
        nextForm = {
          ...nextForm,
          taxExclusiveAmount: String(calculated.taxExclusiveAmount),
          taxAmount: String(calculated.taxAmount),
        }
      } catch (calculationError) {
        nextForm = { ...nextForm, taxExclusiveAmount: '', taxAmount: '' }
        nextError = calculationError?.message || '合同金额输入无效'
      }
    }
    setForm(nextForm)
    setDirty(true)
    setError(nextError)
    setMessage('')
  }

  const handleSave = async (event) => {
    event.preventDefault()
    if (!isEditable || typeof onProjectChange !== 'function') {
      setError('当前账号没有修改合同金额的权限。')
      return
    }
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const nextProject = saveOriginalContract(project, form)
      const savedProject = await onProjectChange(nextProject)
      if (
        !savedProject ||
        savedProject.projectId !== project.projectId ||
        !isOriginalContractSaved(savedProject)
      ) {
        throw new Error('数据库未返回完整有效的合同记录')
      }
      draftStore.clear(accountId(currentUser), project.projectId)
      setForm(createFormValue(savedProject))
      setDirty(false)
      setMessage('合同已成功保存到数据库，可以建立收款计划。')
    } catch (saveError) {
      setError(`${saveError?.message || '合同保存失败'}，已保留当前输入。`)
    } finally {
      setSaving(false)
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
          需要完成历史合同迁移。当前仅显示旧合同金额和旧已收款金额，暂时不能编辑。
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
    const historical = project.contractConfirmationStatus === 'historical_migrated_confirmed'
    const roundingWarning = getOriginalContractRoundingWarning(project)
    return (
      <section className="form-panel contract-section">
        <div className="contract-section-heading">
          <div>
            <p className="eyebrow dark-text">原始合同</p>
            <h2>已保存合同</h2>
          </div>
          <span className="contract-state-badge confirmed">
            {historical ? '历史合同' : '已锁定'}
          </span>
        </div>
        <div className="contract-lock-note">该历史合同保持原有锁定规则，不能直接修改。</div>
        {historical && project.needsManualReview && (
          <div className="warning-note contract-warning">
            历史合同资料已保留；金额完整有效时可直接用于收款业务。
          </div>
        )}
        {roundingWarning && (
          <div className="warning-note contract-warning" role="alert">{roundingWarning}</div>
        )}
        <ContractAmountDetails project={project} />
        {(project.contractConfirmedByName || project.contractConfirmedAt) && (
          <dl className="detail-list compact contract-confirmation-details">
            <div>
              <dt>历史记录人</dt>
              <dd>{project.contractConfirmedByName || '未记录'}</dd>
            </div>
            <div>
              <dt>历史记录时间</dt>
              <dd>{project.contractConfirmedAt || '未记录'}</dd>
            </div>
          </dl>
        )}
      </section>
    )
  }

  const roundingWarning = !dirty ? getOriginalContractRoundingWarning(project) : ''
  return (
    <section className="form-panel contract-section">
      <div className="contract-section-heading">
        <div>
          <p className="eyebrow dark-text">原始合同</p>
          <h2>{persisted ? '合同金额' : '录入原始合同'}</h2>
        </div>
        <span className={`contract-state-badge ${persisted ? 'confirmed' : mode}`}>
          {persisted ? '已保存' : '待录入'}
        </span>
      </div>

      {editBlockedByRevenueActivity && (
        <div className="warning-note contract-warning">
          已有合同增减项、收款计划或实际到账，原始合同金额不能直接修改，请按现有调整流程处理。
        </div>
      )}
      {!canEditContract && !editBlockedByRevenueActivity && (
        <div className="warning-note contract-warning">当前账号只能查看合同，不能修改。</div>
      )}
      {roundingWarning && (
        <div className="warning-note contract-warning" role="alert">{roundingWarning}</div>
      )}

      <form onSubmit={handleSave}>
        <div className="form-grid">
          <label className="field">
            <span>含税总金额（日元）</span>
            <input
              name="taxInclusiveAmount"
              type="number"
              min="1"
              step="1"
              value={form.taxInclusiveAmount}
              onChange={(event) =>
                updateCalculationField('taxInclusiveAmount', event.target.value)
              }
              readOnly={!isEditable}
              required
            />
          </label>
          <label className="field">
            <span>税率（%）</span>
            <input
              name="taxRate"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.taxRate}
              onChange={(event) => updateCalculationField('taxRate', event.target.value)}
              readOnly={!isEditable}
              required
            />
          </label>
          <label className="field">
            <span>税拔金额（日元）</span>
            <input
              name="taxExclusiveAmount"
              type="number"
              value={form.taxExclusiveAmount}
              readOnly
              aria-readonly="true"
            />
          </label>
          <label className="field">
            <span>税额（日元）</span>
            <input
              name="taxAmount"
              type="number"
              value={form.taxAmount}
              readOnly
              aria-readonly="true"
            />
          </label>
        </div>

        {error && <div className="form-error contract-message" role="alert">{error}</div>}
        {message && <div className="contract-success contract-message">{message}</div>}

        {isEditable && (
          <div className="form-actions contract-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存合同'}
            </button>
          </div>
        )}
      </form>
    </section>
  )
}

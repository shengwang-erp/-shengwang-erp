import { useState } from 'react'

import {
  buildContractChangeRunningBalances,
  canCreateContractChange,
  prepareContractChangeInput,
  prepareContractChangeVoid,
} from './contractChanges.js'
import { getOriginalContractMode } from './originalContract.js'

function todayValue() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function createEmptyForm() {
  return {
    changeType: 'increase',
    taxExclusiveAmount: '',
    taxRate: '10',
    taxAmount: '',
    taxInclusiveAmount: '',
    effectiveDate: todayValue(),
    reason: '',
  }
}

function formatYen(value) {
  const amount = Number(value)
  return `¥${(Number.isFinite(amount) ? amount : 0).toLocaleString('ja-JP')}`
}

function formatDateTime(value) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ja-JP')
}

export default function ContractChangesSection({
  project,
  contractChanges = [],
  currentUser,
  onCreateContractChange,
  onVoidContractChange,
}) {
  const [form, setForm] = useState(createEmptyForm)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [voidingChangeId, setVoidingChangeId] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const mode = getOriginalContractMode(project)
  const creationAllowed = canCreateContractChange(project)
  let runningRows = []
  let runningError = ''

  if (mode !== 'legacy_readonly' && mode !== 'not_started') {
    try {
      runningRows = buildContractChangeRunningBalances(project, contractChanges)
    } catch (listError) {
      runningError = listError?.message || '增减项流水读取失败'
    }
  }

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }))
    setError('')
    setMessage('')
  }

  const handleCreate = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const input = prepareContractChangeInput(
        project,
        contractChanges,
        form,
        currentUser,
      )
      await onCreateContractChange(input)
      setForm(createEmptyForm())
      setMessage('合同增减项已保存，合同收入快照已更新。')
    } catch (saveError) {
      setError(saveError?.message || '合同增减项保存失败')
    } finally {
      setSaving(false)
    }
  }

  const beginVoid = (changeId) => {
    setVoidingChangeId(changeId)
    setVoidReason('')
    setError('')
    setMessage('')
  }

  const cancelVoid = () => {
    setVoidingChangeId('')
    setVoidReason('')
  }

  const handleVoid = async (change) => {
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const persistedChange = contractChanges.find(
        (record) =>
          record.changeId === change.changeId &&
          record.projectId === project.projectId,
      )
      const details = prepareContractChangeVoid(
        project,
        contractChanges,
        persistedChange,
        currentUser,
        voidReason,
      )
      await onVoidContractChange(persistedChange, details)
      cancelVoid()
      setMessage('错误流水已作废，合同收入快照已更新。')
    } catch (voidError) {
      setError(voidError?.message || '合同增减项作废失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="form-panel contract-section contract-changes-section">
      <div className="contract-section-heading">
        <div>
          <p className="eyebrow dark-text">合同变更</p>
          <h2>增项、减项流水</h2>
        </div>
        <span className="contract-state-badge confirmed">
          {
            runningRows.filter(
              (row) => row.statusCode !== 'void' && row.statusCode !== 'deleted',
            ).length
          }{' '}
          笔有效
        </span>
      </div>

      {mode === 'legacy_readonly' && (
        <div className="warning-note contract-warning">
          需要迁移后复核。未迁移旧项目仅可查看，暂时不能新增增减项。
        </div>
      )}
      {mode !== 'legacy_readonly' && !creationAllowed && (
        <div className="warning-note contract-warning">
          原始合同完成会计确认后才能新增增减项。
        </div>
      )}

      {creationAllowed && (
        <form className="contract-change-form" onSubmit={handleCreate}>
          <div className="form-grid contract-change-form-grid">
            <label className="field">
              <span>变更类型</span>
              <select
                name="changeType"
                value={form.changeType}
                onChange={(event) => updateField('changeType', event.target.value)}
                required
              >
                <option value="increase">增项</option>
                <option value="decrease">减项</option>
              </select>
            </label>
            <label className="field">
              <span>税抜金额（日元）</span>
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
              <span>税率（%）</span>
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
              <span>税额（日元）</span>
              <input
                name="taxAmount"
                type="number"
                min="1"
                step="1"
                value={form.taxAmount}
                onChange={(event) => updateField('taxAmount', event.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>税込金额（日元）</span>
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
            <label className="field">
              <span>生效日期</span>
              <input
                name="effectiveDate"
                type="date"
                value={form.effectiveDate}
                onChange={(event) => updateField('effectiveDate', event.target.value)}
                required
              />
            </label>
            <label className="field contract-change-reason-field">
              <span>变更原因</span>
              <textarea
                name="reason"
                value={form.reason}
                onChange={(event) => updateField('reason', event.target.value)}
                placeholder="说明客户确认的增项或减项内容"
                required
              />
            </label>
          </div>

          <div className="form-actions contract-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存增减项'}
            </button>
          </div>
        </form>
      )}

      {error && <div className="form-error contract-message">{error}</div>}
      {message && <div className="contract-success contract-message">{message}</div>}
      {runningError && (
        <div className="form-error contract-message">{runningError}</div>
      )}

      <div className="contract-change-list-heading">
        <h3>变更流水</h3>
        <span>运行余额按生效日期计算；已作废流水不参与余额。</span>
      </div>

      {runningRows.length === 0 ? (
        <div className="empty-state">暂无合同增减项流水。</div>
      ) : (
        <div className="contract-change-table-wrap">
          <table className="contract-change-table">
            <thead>
              <tr>
                <th>生效日 / 类型</th>
                <th>原因</th>
                <th>本次税抜 / 税额 / 税込</th>
                <th>变化后税抜</th>
                <th>变化后税込</th>
                <th>操作记录</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {[...runningRows].reverse().map((row) => {
                const isVoid = row.statusCode === 'void'
                return (
                  <tr key={row.changeId} className={isVoid ? 'void-row' : ''}>
                    <td>
                      <strong>{row.effectiveDate}</strong>
                      <span
                        className={`contract-change-type ${row.changeType}`}
                      >
                        {row.changeType === 'increase' ? '增项' : '减项'}
                      </span>
                    </td>
                    <td>
                      <strong>{row.reason}</strong>
                      <small>流水ID：{row.changeId}</small>
                    </td>
                    <td>
                      <span>税抜 {formatYen(row.taxExclusiveAmount)}</span>
                      <span>税额 {formatYen(row.taxAmount)}</span>
                      <strong>税込 {formatYen(row.taxInclusiveAmount)}</strong>
                    </td>
                    <td>{formatYen(row.runningTaxExclusiveAmount)}</td>
                    <td>{formatYen(row.runningTaxInclusiveAmount)}</td>
                    <td>
                      <span>{row.createdByName || '未记录'}</span>
                      <small>{formatDateTime(row.createdAt)}</small>
                      {isVoid && (
                        <small className="contract-change-void-note">
                          作废：{row.voidReason || '未记录原因'}｜
                          {row.voidedByName || '未记录'}｜
                          {formatDateTime(row.voidedAt)}
                        </small>
                      )}
                    </td>
                    <td>
                      {isVoid ? (
                        <span className="contract-change-status void">已作废</span>
                      ) : voidingChangeId === row.changeId ? (
                        <div className="contract-change-void-form">
                          <label>
                            <span>作废原因</span>
                            <textarea
                              value={voidReason}
                              onChange={(event) => setVoidReason(event.target.value)}
                              placeholder="必须说明错误原因"
                            />
                          </label>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={saving}
                            onClick={() => handleVoid(row)}
                          >
                            确认作废
                          </button>
                          <button
                            className="ghost-button"
                            type="button"
                            disabled={saving}
                            onClick={cancelVoid}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          className="danger-button"
                          type="button"
                          onClick={() => beginVoid(row.changeId)}
                        >
                          作废
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

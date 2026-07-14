import { useMemo, useState } from 'react'

import {
  CUSTOMER_RECEIPT_STAGE_LABELS,
  buildCustomerReceiptViewModel,
  canManageCustomerReceipts,
  prepareCustomerReceiptInput,
  prepareCustomerReceiptVoid,
} from './customerReceipts.js'
import { getOriginalContractMode } from './originalContract.js'

const PAYMENT_METHODS = Object.freeze([
  '银行转账',
  '现金',
  '信用卡',
  'PayPay',
  '支票',
  '其他',
])

function todayValue() {
  const date = new Date()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function createEmptyForm() {
  return {
    stage: 'initial',
    taxInclusiveAmount: '',
    receivedDate: todayValue(),
    paymentMethod: '银行转账',
    bankReference: '',
    remark: '',
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

export default function CustomerReceiptsSection({
  project,
  revenueSnapshot,
  paymentPlans = [],
  receipts = [],
  currentUser,
  onCreateCustomerReceipt,
  onVoidCustomerReceipt,
}) {
  const [form, setForm] = useState(createEmptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [voidingReceiptId, setVoidingReceiptId] = useState('')
  const [voidReason, setVoidReason] = useState('')
  const mode = getOriginalContractMode(project)
  const creationAllowed = canManageCustomerReceipts(project)
  const adjustedTaxInclusiveAmount =
    revenueSnapshot?.adjustedTaxInclusiveAmount ?? 0

  const viewResult = useMemo(() => {
    const schemaVersion = Number(project?.contractRevenueSchemaVersion)
    if (
      !Number.isInteger(schemaVersion) ||
      schemaVersion < 1 ||
      adjustedTaxInclusiveAmount <= 0
    ) {
      return { view: null, error: '' }
    }

    try {
      return {
        view: buildCustomerReceiptViewModel({
          project,
          adjustedTaxInclusiveAmount,
          paymentPlans,
          receipts,
        }),
        error: '',
      }
    } catch (viewError) {
      return {
        view: null,
        error: viewError?.message || '实际收款流水读取失败',
      }
    }
  }, [project, adjustedTaxInclusiveAmount, paymentPlans, receipts])
  const receiptView = viewResult.view

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
      const input = prepareCustomerReceiptInput(
        project,
        paymentPlans,
        form,
        currentUser,
      )
      await onCreateCustomerReceipt(input)
      setForm(createEmptyForm())
      setMessage('客户实际收款已保存，收入快照和付款计划锁定状态已更新。')
    } catch (saveError) {
      setError(saveError?.message || '客户实际收款保存失败')
    } finally {
      setSaving(false)
    }
  }

  const beginVoid = (receiptId) => {
    setVoidingReceiptId(receiptId)
    setVoidReason('')
    setError('')
    setMessage('')
  }

  const cancelVoid = () => {
    setVoidingReceiptId('')
    setVoidReason('')
  }

  const handleVoid = async (receiptRow) => {
    setSaving(true)
    setError('')
    setMessage('')

    try {
      const persistedReceipt = receipts.find(
        (record) =>
          record.receiptId === receiptRow.receiptId &&
          record.projectId === project.projectId,
      )
      const details = prepareCustomerReceiptVoid(
        project,
        receipts,
        persistedReceipt,
        currentUser,
        voidReason,
      )
      await onVoidCustomerReceipt(persistedReceipt, details)
      cancelVoid()
      setMessage('错误收款流水已作废，收入快照和付款计划锁定状态已更新。')
    } catch (voidError) {
      setError(voidError?.message || '客户实际收款作废失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="form-panel contract-section customer-receipts-section">
      <div className="contract-section-heading">
        <div>
          <p className="eyebrow dark-text">客户到账</p>
          <h2>客户实际收款流水</h2>
        </div>
        <span className={`contract-state-badge ${creationAllowed ? 'confirmed' : ''}`}>
          {receiptView?.activeReceiptCount || 0} 笔有效
        </span>
      </div>

      {mode === 'legacy_readonly' && (
        <div className="warning-note contract-warning">
          需要迁移后复核。未迁移旧项目仅可查看原金额，暂时不能登记实际收款。
        </div>
      )}
      {mode !== 'legacy_readonly' && !creationAllowed && (
        <div className="warning-note contract-warning">
          原始合同完成会计确认后才能登记实际收款。
        </div>
      )}
      {viewResult.error && (
        <div className="form-error contract-message">{viewResult.error}</div>
      )}

      {creationAllowed && (
        <form className="customer-receipt-form" onSubmit={handleCreate}>
          <div className="form-grid customer-receipt-form-grid">
            <label className="field">
              <span>收款阶段</span>
              <select
                name="stage"
                value={form.stage}
                onChange={(event) => updateField('stage', event.target.value)}
                required
              >
                <option value="initial">首期款</option>
                <option value="middle">中期款</option>
                <option value="final">尾款</option>
                <option value="unallocated">未分配</option>
              </select>
            </label>
            <label className="field">
              <span>实际到账金额（税込日元）</span>
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
              <span>到账日期</span>
              <input
                name="receivedDate"
                type="date"
                value={form.receivedDate}
                onChange={(event) =>
                  updateField('receivedDate', event.target.value)
                }
                required
              />
            </label>
            <label className="field">
              <span>支付方式</span>
              <select
                name="paymentMethod"
                value={form.paymentMethod}
                onChange={(event) =>
                  updateField('paymentMethod', event.target.value)
                }
                required
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>银行流水号</span>
              <input
                name="bankReference"
                type="text"
                value={form.bankReference}
                onChange={(event) =>
                  updateField('bankReference', event.target.value)
                }
                placeholder="转账时填写银行流水号"
              />
            </label>
            <label className="field customer-receipt-remark-field">
              <span>备注</span>
              <textarea
                name="remark"
                value={form.remark}
                onChange={(event) => updateField('remark', event.target.value)}
                placeholder="填写付款人、付款条件或其他说明"
              />
            </label>
          </div>

          <div className="form-actions contract-actions">
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '保存中…' : '登记实际收款'}
            </button>
          </div>
        </form>
      )}

      {error && <div className="form-error contract-message">{error}</div>}
      {message && <div className="contract-success contract-message">{message}</div>}

      {receiptView && (
        <>
          <div className="customer-receipt-project-summary">
            <div>
              <span>项目累计收款</span>
              <strong>{formatYen(receiptView.totalReceivedTaxInclusiveAmount)}</strong>
            </div>
            <div>
              <span>项目未收款</span>
              <strong>{formatYen(receiptView.outstandingTaxInclusiveAmount)}</strong>
            </div>
            <div>
              <span>收款进度</span>
              <strong>{receiptView.paymentProgress}%</strong>
            </div>
            <div>
              <span>合同超额收款</span>
              <strong className={receiptView.hasContractOverpayment ? 'danger-text' : ''}>
                {formatYen(receiptView.overpaidTaxInclusiveAmount)}
              </strong>
            </div>
          </div>

          {receiptView.hasContractOverpayment && (
            <div className="customer-receipt-overpayment-alert" role="alert">
              <strong>项目实际收款超过合同金额</strong>
              <span>
                超额 {formatYen(receiptView.overpaidTaxInclusiveAmount)}，已保留真实到账金额，不会静默截断。
              </span>
            </div>
          )}
          {receiptView.hasStageOverpayment && (
            <div className="customer-receipt-overpayment-alert stage" role="alert">
              <strong>存在阶段超额到账</strong>
              <span>阶段实际到账超过计划金额，已保留真实到账金额并在下方标记。</span>
            </div>
          )}
          {receiptView.unallocatedReceivedTaxInclusiveAmount > 0 && (
            <div className="customer-receipt-unallocated-note">
              未分配收款：
              <strong>
                {formatYen(receiptView.unallocatedReceivedTaxInclusiveAmount)}
              </strong>
              ，计入项目累计收款，但不会锁定首期、中期或尾款计划。
            </div>
          )}

          <div className="customer-receipt-stage-grid">
            {receiptView.stageSummaries.map((stageSummary) => (
              <article
                className={`customer-receipt-stage-card ${
                  stageSummary.overpaidTaxInclusiveAmount > 0 ? 'overpaid' : ''
                }`}
                key={stageSummary.stage}
              >
                <div className="customer-receipt-stage-heading">
                  <h3>{stageSummary.label}</h3>
                  <span className={`customer-receipt-status ${stageSummary.status}`}>
                    {stageSummary.status}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>计划金额</dt>
                    <dd>
                      {stageSummary.plannedTaxInclusiveAmount === null
                        ? '—'
                        : formatYen(stageSummary.plannedTaxInclusiveAmount)}
                    </dd>
                  </div>
                  <div>
                    <dt>累计到账</dt>
                    <dd>{formatYen(stageSummary.receivedTaxInclusiveAmount)}</dd>
                  </div>
                  <div>
                    <dt>剩余金额</dt>
                    <dd>
                      {stageSummary.remainingTaxInclusiveAmount === null
                        ? '待分配'
                        : formatYen(stageSummary.remainingTaxInclusiveAmount)}
                    </dd>
                  </div>
                </dl>
                {stageSummary.locked && (
                  <div className="customer-receipt-lock-note">
                    已有有效收款，计划金额已锁定
                  </div>
                )}
                {stageSummary.overpaidTaxInclusiveAmount > 0 && (
                  <div className="customer-receipt-stage-overpaid">
                    超额到账 {formatYen(stageSummary.overpaidTaxInclusiveAmount)}
                  </div>
                )}
              </article>
            ))}
          </div>

          <div className="contract-change-list-heading customer-receipt-list-heading">
            <h3>实际收款流水</h3>
            <span>同一阶段允许多次到账；已作废流水不参与汇总和锁定。</span>
          </div>

          {receiptView.receiptRows.length === 0 ? (
            <div className="empty-state">暂无客户实际收款流水。</div>
          ) : (
            <div className="customer-receipt-table-wrap">
              <table className="customer-receipt-table">
                <thead>
                  <tr>
                    <th>到账日期 / 阶段</th>
                    <th>实际到账</th>
                    <th>支付信息</th>
                    <th>备注 / 计划</th>
                    <th>登记记录</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {receiptView.receiptRows.map((receiptRow) => {
                    const isVoid =
                      receiptRow.statusCode === 'void' ||
                      receiptRow.statusCode === 'deleted'
                    return (
                      <tr
                        className={isVoid ? 'void-row' : ''}
                        key={receiptRow.receiptId}
                      >
                        <td>
                          <strong>{receiptRow.receivedDate || '期初迁移'}</strong>
                          <span className="customer-receipt-stage-label">
                            {CUSTOMER_RECEIPT_STAGE_LABELS[receiptRow.stage]}
                          </span>
                          <small>流水ID：{receiptRow.receiptId}</small>
                        </td>
                        <td>
                          <strong>{formatYen(receiptRow.taxInclusiveAmount)}</strong>
                        </td>
                        <td>
                          <span>{receiptRow.paymentMethod || '未记录'}</span>
                          <small>
                            银行流水：{receiptRow.bankReference || '未填写'}
                          </small>
                        </td>
                        <td>
                          <span>{receiptRow.remark || '无备注'}</span>
                          <small>计划ID：{receiptRow.planId || '未分配'}</small>
                        </td>
                        <td>
                          <span>{receiptRow.createdByName || '历史迁移'}</span>
                          <small>{formatDateTime(receiptRow.createdAt)}</small>
                          {isVoid && (
                            <small className="contract-change-void-note">
                              作废：{receiptRow.voidReason || '未记录原因'}｜
                              {receiptRow.voidedByName || '未记录'}｜
                              {formatDateTime(receiptRow.voidedAt)}
                            </small>
                          )}
                        </td>
                        <td>
                          {isVoid ? (
                            <span className="contract-change-status void">已作废</span>
                          ) : voidingReceiptId === receiptRow.receiptId ? (
                            <div className="contract-change-void-form">
                              <label>
                                <span>作废原因</span>
                                <textarea
                                  value={voidReason}
                                  onChange={(event) =>
                                    setVoidReason(event.target.value)
                                  }
                                  placeholder="必须说明错误原因"
                                />
                              </label>
                              <button
                                className="danger-button"
                                type="button"
                                disabled={saving}
                                onClick={() => handleVoid(receiptRow)}
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
                          ) : creationAllowed ? (
                            <button
                              className="danger-button"
                              type="button"
                              onClick={() => beginVoid(receiptRow.receiptId)}
                            >
                              作废
                            </button>
                          ) : (
                            <span className="contract-change-status">有效</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

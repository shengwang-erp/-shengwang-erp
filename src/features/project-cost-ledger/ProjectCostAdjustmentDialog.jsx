import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { fromFourDecimalUnits, toSignedFourDecimalUnits } from '../cost-accounting/fixedPointCurrency.js'
import { useProjectCostModalA11y } from './useProjectCostModalA11y.js'

const SAFE_ERROR_MESSAGES = Object.freeze({
  PROJECT_COST_LEDGER_VERSION_CONFLICT: '记录已被修改，请刷新后重试',
  PROJECT_COST_LEDGER_ACCESS_DENIED: '您没有操作项目成本的权限',
  PROJECT_COST_LEDGER_INPUT_INVALID: '请检查项目成本输入后重试',
  PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED: '项目分摊合计必须与当前成本一致',
  PROJECT_COST_LEDGER_SOURCE_MISSING: '原始费用记录已不可用，请刷新后重试',
  AUTH_SESSION_INVALID: '登录已失效，请重新登录',
})

export function safeProjectCostDialogError(error) {
  return SAFE_ERROR_MESSAGES[error?.code] || '项目成本服务暂时不可用，请稍后重试'
}

export function projectCostDialogOutcome(value, fallback) {
  if (value === true || value?.ok === true) return { ok: true, message: '' }
  if (typeof value?.message === 'string' && value.message) return { ok: false, message: value.message }
  return { ok: false, message: fallback }
}

function formatYen(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 4,
  }).format(number)
}

function addMoney(left, right) {
  const leftUnits = toSignedFourDecimalUnits(left)
  const rightUnits = toSignedFourDecimalUnits(right)
  if (leftUnits === null || rightUnits === null || !Number.isSafeInteger(leftUnits + rightUnits)) return null
  return fromFourDecimalUnits(leftUnits + rightUnits)
}

export default function ProjectCostAdjustmentDialog({
  row, allowed, onSubmit, onSuccess, onCancel, onRefresh, onAuthInvalid,
}) {
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [refreshable, setRefreshable] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useRef(true)
  const operationRef = useRef(0)
  const submitLatchRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      operationRef.current += 1
    }
  }, [])
  const adjustmentAmount = amount === '' ? null : Number(amount)
  const amountUnits = toSignedFourDecimalUnits(adjustmentAmount)
  const afterAmount = useMemo(
    () => amountUnits === null || amountUnits === 0 ? null : addMoney(row?.effectiveAmount, adjustmentAmount),
    [adjustmentAmount, amountUnits, row?.effectiveAmount],
  )
  if (!row) return null

  const valid = allowed && !row.allocationLocked && typeof onSubmit === 'function' && amountUnits !== null && amountUnits !== 0 &&
    afterAmount !== null && reason.trim().length > 0 && reason === reason.trim()

  const submit = async (event) => {
    event.preventDefault()
    if (!valid || submitLatchRef.current) return
    submitLatchRef.current = true
    const operation = operationRef.current + 1
    operationRef.current = operation
    setSubmitting(true)
    setError('')
    setErrorCode('')
    setRefreshable(false)
    try {
      const result = await onSubmit({
        sourceKey: row.sourceKey,
        expectedVersion: row.expectedVersion ?? row.version,
        adjustmentAmount,
        reason,
      })
      if (!mountedRef.current || operationRef.current !== operation) return
      const refreshed = projectCostDialogOutcome(
        await onSuccess?.(result, {
          sourceKey: row.sourceKey, projectId: row.projectId,
          expectedVersion: row.expectedVersion ?? row.version,
        }),
        '调整已保存，但最新项目成本读取失败，请重新读取',
      )
      if (!mountedRef.current || operationRef.current !== operation) return
      if (!refreshed.ok) {
        const prefix = '调整已保存，但最新项目成本读取失败，请重新读取'
        setError(refreshed.message === prefix ? prefix : `${prefix}：${refreshed.message}`)
      }
    } catch (caught) {
      if (!mountedRef.current || operationRef.current !== operation) return
      if (caught?.authInvalid) onAuthInvalid?.()
      setErrorCode(typeof caught?.code === 'string' ? caught.code : '')
      setRefreshable(['PROJECT_COST_LEDGER_VERSION_CONFLICT', 'PROJECT_COST_LEDGER_SOURCE_MISSING'].includes(caught?.code))
      setError(safeProjectCostDialogError(caught))
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        submitLatchRef.current = false
        setSubmitting(false)
      }
    }
  }

  const refresh = async () => {
    if (typeof onRefresh !== 'function' || submitLatchRef.current) return
    submitLatchRef.current = true
    const operation = operationRef.current + 1
    operationRef.current = operation
    setSubmitting(true)
    try {
      const refreshed = projectCostDialogOutcome(await onRefresh({
        sourceKey: row.sourceKey, projectId: row.projectId,
        expectedVersion: row.expectedVersion ?? row.version,
        requireNewerVersion: errorCode === 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      }), '最新项目成本读取失败，请稍后重试')
      if (!mountedRef.current || operationRef.current !== operation) return
      if (refreshed.ok) {
        setRefreshable(false)
        setErrorCode('')
        setError('')
      } else setError(refreshed.message)
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        submitLatchRef.current = false
        setSubmitting(false)
      }
    }
  }

  const cancelOperation = () => {
    mountedRef.current = false
    operationRef.current += 1
    submitLatchRef.current = true
    onCancel?.()
  }
  const modal = useProjectCostModalA11y({ open: Boolean(row), submitting, onRequestClose: cancelOperation })

  const content = (
    <div className="erp-black-gold project-cost-dialog-backdrop" role="presentation">
      <section ref={modal.dialogRef} tabIndex="-1" className="project-cost-dialog" role="dialog" aria-modal="true" aria-labelledby="project-cost-adjust-title">
        <header><div><small>会计调整 · 原始业务记录不变</small><h2 id="project-cost-adjust-title">调整项目成本</h2></div><button ref={modal.initialFocusRef} type="button" onClick={modal.requestClose} aria-label="关闭调整窗口">关闭</button></header>
        <div className="project-cost-dialog-amounts">
          <article><span>原始金额</span><strong>{formatYen(row.originalAmount)}</strong></article>
          <article><span>累计会计调整</span><strong>{formatYen(row.adjustmentTotal ?? row.adjustmentAmount)}</strong></article>
          <article><span>当前最终金额</span><strong>{formatYen(row.effectiveAmount)}</strong></article>
        </div>
        <form onSubmit={submit}>
          <label>本次调整金额（可输入正数或负数）
            <input type="number" step="0.0001" value={amount} disabled={!allowed || submitting} onChange={(event) => setAmount(event.target.value)} placeholder="例如 -500 或 300" />
          </label>
          <label>调整原因
            <textarea value={reason} disabled={!allowed || submitting} maxLength="2000" onChange={(event) => setReason(event.target.value)} placeholder="说明调整依据，保存后自动留痕" />
          </label>
          <div className="project-cost-dialog-preview" aria-live="polite"><span>调整后金额</span><strong>{afterAmount === null ? '—' : formatYen(afterAmount)}</strong></div>
          {row.allocationLocked && <div className="project-cost-dialog-error" role="alert">该费用已有项目分摊历史，直接调整会造成分摊失配。请使用“新增调整费用”分别补录或冲销。</div>}
          {error && <div className="project-cost-dialog-error" role="alert"><span>{error}</span>{refreshable && <button type="button" disabled={submitting} onClick={refresh}>刷新最新记录</button>}</div>}
          {!allowed && <div className="project-cost-dialog-error" role="alert">您没有调整项目成本的权限</div>}
          <footer><button type="button" onClick={modal.requestClose}>取消</button><button className="project-cost-ledger-primary" type="submit" disabled={!valid || submitting}>{submitting ? '保存中…' : '保存调整'}</button></footer>
        </form>
      </section>
    </div>
  )
  const portalTarget = globalThis.document?.body
  return portalTarget?.nodeType === 1 ? createPortal(content, portalTarget) : content
}

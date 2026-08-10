import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { buildAllocationAmounts } from './projectCostLedgerDomain.js'
import { projectCostDialogOutcome, safeProjectCostDialogError } from './ProjectCostAdjustmentDialog.jsx'
import { fromFourDecimalUnits, toSignedFourDecimalUnits } from '../cost-accounting/fixedPointCurrency.js'
import { useProjectCostModalA11y } from './useProjectCostModalA11y.js'

function formatYen(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency', currency: 'JPY', minimumFractionDigits: 0, maximumFractionDigits: 4,
  }).format(number)
}

function initialDrafts(allocations) {
  const rows = Array.isArray(allocations) && allocations.length > 0 ? allocations : [{ projectId: '', amount: '' }]
  return rows.slice(0, 100).map((allocation) => ({
    projectId: allocation.projectId || '', value: String(allocation.amount ?? ''),
  }))
}

function roundedProductUnits(amountUnits, percentageUnits) {
  const numerator = BigInt(amountUnits) * BigInt(percentageUnits)
  const divisor = 1000000n
  const sign = numerator < 0n ? -1n : 1n
  const result = sign * ((sign * numerator + divisor / 2n) / divisor)
  if (result < BigInt(Number.MIN_SAFE_INTEGER) || result > BigInt(Number.MAX_SAFE_INTEGER)) return null
  return Number(result)
}

function totals(effectiveAmount, mode, drafts) {
  const effectiveUnits = toSignedFourDecimalUnits(effectiveAmount)
  if (effectiveUnits === null) return { allocated: null, difference: null }
  let inputUnits = 0
  for (const draft of drafts) {
    const units = toSignedFourDecimalUnits(draft.value === '' ? 0 : Number(draft.value))
    if (units === null || !Number.isSafeInteger(inputUnits + units)) return { allocated: null, difference: null }
    inputUnits += units
  }
  const allocatedUnits = mode === 'percent' ? roundedProductUnits(effectiveUnits, inputUnits) : inputUnits
  if (allocatedUnits === null || !Number.isSafeInteger(effectiveUnits - allocatedUnits)) return { allocated: null, difference: null }
  return {
    allocated: fromFourDecimalUnits(allocatedUnits),
    difference: fromFourDecimalUnits(effectiveUnits - allocatedUnits),
  }
}

function percentValue(amount, effectiveAmount) {
  const amountUnits = toSignedFourDecimalUnits(amount)
  const effectiveUnits = toSignedFourDecimalUnits(effectiveAmount)
  if (amountUnits === null || effectiveUnits === null || effectiveUnits === 0) return '0'
  const percentUnits = Number((BigInt(amountUnits) * 1000000n + BigInt(effectiveUnits) / 2n) / BigInt(effectiveUnits))
  return String(fromFourDecimalUnits(percentUnits))
}

function amountValue(percent, effectiveAmount) {
  const percentUnits = toSignedFourDecimalUnits(percent)
  const effectiveUnits = toSignedFourDecimalUnits(effectiveAmount)
  if (percentUnits === null || effectiveUnits === null) return '0'
  const units = roundedProductUnits(effectiveUnits, percentUnits)
  return units === null ? '' : String(fromFourDecimalUnits(units))
}

export default function ProjectCostAllocationDialog({
  row, projects = [], allocations, allowed, onSubmit, onSuccess, onCancel, onRefresh, onAuthInvalid,
}) {
  const [mode, setMode] = useState('amount')
  const [drafts, setDrafts] = useState(() => initialDrafts(allocations))
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
  if (!row) return null

  const currentTotals = totals(row.effectiveAmount, mode, drafts)
  const uniqueProjects = drafts.every(({ projectId }) => projectId) &&
    new Set(drafts.map(({ projectId }) => projectId)).size === drafts.length
  let fixedAllocations = null
  try {
    fixedAllocations = buildAllocationAmounts(row.effectiveAmount, drafts.map((draft) => ({
      projectId: draft.projectId, mode, value: Number(draft.value),
    })))
    if (fixedAllocations.some(({ amount }) => toSignedFourDecimalUnits(amount) === 0)) fixedAllocations = null
  } catch {
    fixedAllocations = null
  }
  const balanced = fixedAllocations !== null && toSignedFourDecimalUnits(currentTotals.difference) === 0
  const valid = allowed && typeof onSubmit === 'function' && drafts.length <= 100 && uniqueProjects &&
    balanced && reason.trim().length > 0 && reason === reason.trim()

  const updateDraft = (index, field, value) => {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, [field]: value } : draft))
  }

  const changeMode = (nextMode) => {
    if (nextMode === mode) return
    setDrafts((current) => current.map((draft) => ({
      ...draft,
      value: nextMode === 'percent'
        ? percentValue(Number(draft.value || 0), row.effectiveAmount)
        : amountValue(Number(draft.value || 0), row.effectiveAmount),
    })))
    setMode(nextMode)
  }

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
        sourceKey: row.sourceKey, expectedVersion: row.expectedVersion ?? row.version, reason,
        allocations: fixedAllocations.map((allocation) => ({ ...allocation })),
      })
      if (!mountedRef.current || operationRef.current !== operation) return
      const refreshed = projectCostDialogOutcome(await onSuccess?.(result, {
        sourceKey: row.sourceKey, projectId: row.projectId,
        expectedVersion: row.expectedVersion ?? row.version,
      }), '拆分已保存，但最新项目成本读取失败，请重新读取')
      if (!mountedRef.current || operationRef.current !== operation) return
      if (!refreshed.ok) {
        const prefix = '拆分已保存，但最新项目成本读取失败，请重新读取'
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
      if (refreshed.ok) { setRefreshable(false); setErrorCode(''); setError('') }
      else setError(refreshed.message)
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
    <div className="project-cost-dialog-backdrop" role="presentation">
      <section ref={modal.dialogRef} tabIndex="-1" className="project-cost-dialog project-cost-allocation-dialog" role="dialog" aria-modal="true" aria-labelledby="project-cost-allocation-title">
        <header><div><small>拆分后以固定金额保存并自动留痕</small><h2 id="project-cost-allocation-title">拆分项目成本</h2></div><button ref={modal.initialFocusRef} type="button" onClick={modal.requestClose} aria-label="关闭拆分窗口">关闭</button></header>
        <div className="project-cost-dialog-amounts"><article><span>当前最终金额</span><strong>{formatYen(row.effectiveAmount)}</strong></article><article><span>最多项目数</span><strong>100</strong></article></div>
        <form onSubmit={submit}>
          <label className="project-cost-allocation-mode">分摊方式
            <select value={mode} disabled={!allowed || submitting} onChange={(event) => changeMode(event.target.value)}><option value="amount">固定金额</option><option value="percent">百分比</option></select>
          </label>
          <div className="project-cost-allocation-rows">
            {drafts.map((draft, index) => <div className="project-cost-allocation-row" key={index}>
              <label>项目
                <select value={draft.projectId} disabled={!allowed || submitting} onChange={(event) => updateDraft(index, 'projectId', event.target.value)}><option value="">请选择项目</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select>
              </label>
              <label>{mode === 'percent' ? '比例（%）' : '分摊金额'}
                <input type="number" step="0.0001" value={draft.value} disabled={!allowed || submitting} onChange={(event) => updateDraft(index, 'value', event.target.value)} />
              </label>
              <button type="button" disabled={!allowed || submitting || drafts.length <= 1} onClick={() => setDrafts((current) => current.filter((_, draftIndex) => draftIndex !== index))}>删除</button>
            </div>)}
          </div>
          <button type="button" disabled={!allowed || submitting || drafts.length >= 100} onClick={() => setDrafts((current) => current.length >= 100 ? current : [...current, { projectId: '', value: '' }])}>新增项目</button>
          {!uniqueProjects && drafts.some(({ projectId }) => projectId) && <div className="project-cost-dialog-hint" role="alert">每个项目只能出现一次</div>}
          <div className="project-cost-allocation-totals" aria-live="polite">
            <article><span>已分摊</span><strong>{currentTotals.allocated === null ? '—' : formatYen(currentTotals.allocated)}</strong></article>
            <article className={balanced ? 'is-balanced' : 'is-unbalanced'}><span>差额</span><strong>{currentTotals.difference === null ? '—' : formatYen(currentTotals.difference)}</strong></article>
          </div>
          <label>调整原因
            <textarea value={reason} disabled={!allowed || submitting} maxLength="2000" onChange={(event) => setReason(event.target.value)} placeholder="说明拆分依据，保存后自动留痕" />
          </label>
          {error && <div className="project-cost-dialog-error" role="alert"><span>{error}</span>{refreshable && <button type="button" disabled={submitting} onClick={refresh}>刷新最新记录</button>}</div>}
          {!allowed && <div className="project-cost-dialog-error" role="alert">您没有拆分项目成本的权限</div>}
          <footer><button type="button" onClick={modal.requestClose}>取消</button><button className="project-cost-ledger-primary" type="submit" disabled={!valid || submitting}>{submitting ? '保存中…' : '保存拆分'}</button></footer>
        </form>
      </section>
    </div>
  )
  const portalTarget = globalThis.document?.body
  return portalTarget?.nodeType === 1 ? createPortal(content, portalTarget) : content
}

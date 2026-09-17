import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { projectCostDialogOutcome, safeProjectCostDialogError } from './ProjectCostAdjustmentDialog.jsx'
import { toSignedFourDecimalUnits } from '../cost-accounting/fixedPointCurrency.js'
import { useProjectCostModalA11y } from './useProjectCostModalA11y.js'

const CATEGORY_OPTIONS = Object.freeze([
  '人工费', '材料费', '车辆费', '工具费', '外包费', '运输费', '经营费用', '其他费用',
])

function today() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultRequestId() {
  return globalThis.crypto?.randomUUID?.() || ''
}

export default function ProjectCostManualEntryDialog({
  open, projects = [], allowed, onSubmit, onSuccess, onCancel, onAuthInvalid,
  createRequestId = defaultRequestId,
}) {
  const [requestId] = useState(() => createRequestId())
  const [form, setForm] = useState(() => ({
    projectId: '', category: '', date: today(), amount: '', description: '', operator: '', reason: '',
  }))
  const [error, setError] = useState('')
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
  if (!open) return null

  const amount = form.amount === '' ? null : Number(form.amount)
  const amountUnits = toSignedFourDecimalUnits(amount)
  const requiredTextFieldsValid = ['projectId', 'category', 'date'].every((field) =>
    typeof form[field] === 'string' && form[field].trim().length > 0 && form[field] === form[field].trim())
  const optionalTextFieldsValid = ['description', 'operator', 'reason'].every((field) =>
    typeof form[field] === 'string' && form[field] === form[field].trim())
  const textFieldsValid = requiredTextFieldsValid && optionalTextFieldsValid
  const valid = allowed && typeof onSubmit === 'function' && requestId && textFieldsValid && amountUnits !== null && amountUnits !== 0

  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (!valid || submitLatchRef.current) return
    submitLatchRef.current = true
    const operation = operationRef.current + 1
    operationRef.current = operation
    setSubmitting(true)
    setError('')
    try {
      const request = { requestId, ...form, amount }
      const result = await onSubmit(request)
      if (!mountedRef.current || operationRef.current !== operation) return
      const refreshed = projectCostDialogOutcome(await onSuccess?.(result, {
        sourceKey: result?.sourceKey || `manual:${requestId}`, projectId: form.projectId,
      }), '费用已保存，但最新项目成本读取失败，请重新读取')
      if (!mountedRef.current || operationRef.current !== operation) return
      if (!refreshed.ok) {
        const prefix = '费用已保存，但最新项目成本读取失败，请重新读取'
        setError(refreshed.message === prefix ? prefix : `${prefix}：${refreshed.message}`)
      }
    } catch (caught) {
      if (!mountedRef.current || operationRef.current !== operation) return
      if (caught?.authInvalid) onAuthInvalid?.()
      setError(safeProjectCostDialogError(caught))
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
  const modal = useProjectCostModalA11y({ open, submitting, onRequestClose: cancelOperation })

  const content = (
    <div className="erp-black-gold project-cost-dialog-backdrop" role="presentation">
      <section ref={modal.dialogRef} tabIndex="-1" className="project-cost-dialog project-cost-manual-dialog" role="dialog" aria-modal="true" aria-labelledby="project-cost-manual-title">
        <header><div><small>费用保存后立即进入项目成本</small><h2 id="project-cost-manual-title">新增调整费用</h2></div><button ref={modal.initialFocusRef} type="button" onClick={modal.requestClose} aria-label="关闭新增费用窗口">关闭</button></header>
        <form onSubmit={submit}>
          <div className="project-cost-dialog-form-grid">
            <label>项目
              <select value={form.projectId} disabled={!allowed || submitting} onChange={(event) => update('projectId', event.target.value)}><option value="">请选择项目</option>{projects.map((project) => <option key={project.projectId} value={project.projectId}>{project.projectName}</option>)}</select>
            </label>
            <label>费用类别
              <select value={form.category} disabled={!allowed || submitting} onChange={(event) => update('category', event.target.value)}><option value="">请选择类别</option>{CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{category}</option>)}</select>
            </label>
            <label>日期<input type="date" value={form.date} disabled={!allowed || submitting} onChange={(event) => update('date', event.target.value)} /></label>
            <label>金额（可输入正数或负数）<input type="number" step="0.0001" value={form.amount} disabled={!allowed || submitting} onChange={(event) => update('amount', event.target.value)} /></label>
            <label>经办人（选填）<input value={form.operator} maxLength="500" disabled={!allowed || submitting} onChange={(event) => update('operator', event.target.value)} /></label>
          </div>
          <label>费用说明（选填）<textarea value={form.description} maxLength="2000" disabled={!allowed || submitting} onChange={(event) => update('description', event.target.value)} /></label>
          <label>录入原因（选填）<textarea value={form.reason} maxLength="2000" disabled={!allowed || submitting} onChange={(event) => update('reason', event.target.value)} placeholder="说明新增或冲销依据，保存后自动留痕" /></label>
          {error && <div className="project-cost-dialog-error" role="alert">{error}</div>}
          {!allowed && <div className="project-cost-dialog-error" role="alert">您没有新增项目成本的权限</div>}
          <footer><button type="button" onClick={modal.requestClose}>取消</button><button className="project-cost-ledger-primary" type="submit" disabled={!valid || submitting}>{submitting ? '保存中…' : '保存费用'}</button></footer>
        </form>
      </section>
    </div>
  )
  const portalTarget = globalThis.document?.body
  return portalTarget?.nodeType === 1 ? createPortal(content, portalTarget) : content
}

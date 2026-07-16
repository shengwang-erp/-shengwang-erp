import React, { useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  suggestProjectCost,
  validateProjectAllocations,
} from './laborAccountingDomain.js'
import {
  ATTENDANCE_ISSUE_LABELS,
  formatTokyoTime,
  formatWorkedMinutes,
} from './AttendanceStatusTable.jsx'

const RESOLUTION_OPTIONS = Object.freeze([
  ['full_day', '整天', 1, '计 1 人天'],
  ['half_day', '半天', 0.5, '计 0.5 人天'],
  ['rest', '休息', 0, '计 0 人天'],
  ['leave', '请假', 0, '计 0 人天'],
  ['comp_time', '调休', 0, '计 0 人天'],
  ['absence', '缺勤', 0, '计 0 人天'],
])

const UNITS_BY_RESOLUTION = Object.freeze(Object.fromEntries(
  RESOLUTION_OPTIONS.map(([value, , units]) => [value, units]),
))

const YEN_FORMATTER = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})

function safeYen(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function salarySuggestedCost(detail) {
  const savedCost = detail?.resolution?.finalProjectCost
  if (safeYen(savedCost)) return savedCost
  const suggestedCost = detail?.salary?.suggestedProjectCost
  return safeYen(suggestedCost) ? suggestedCost : 0
}

export function deriveFactProjects(detail) {
  const projects = []
  const seen = new Set()
  for (const session of detail?.facts?.sessions || []) {
    const projectId = typeof session?.projectId === 'string' ? session.projectId.trim() : ''
    if (!projectId || seen.has(projectId)) continue
    seen.add(projectId)
    projects.push({
      projectId,
      projectName: String(session?.projectName || '未命名项目'),
    })
  }
  return projects
}

function cloneAllocations(allocations) {
  return allocations.map((allocation) => ({
    projectId: allocation.projectId,
    amount: safeYen(allocation.amount) ? allocation.amount : 0,
    allocationNote: String(allocation.allocationNote || ''),
  }))
}

export function buildInitialResolutionDraft(detail) {
  const resolutionType = detail?.resolution?.resolutionType || 'full_day'
  const attendanceUnits = UNITS_BY_RESOLUTION[resolutionType] ?? 1
  const finalProjectCost = attendanceUnits === 0 ? 0 : salarySuggestedCost(detail)
  let allocations

  if (attendanceUnits === 0) {
    allocations = []
  } else if (Array.isArray(detail?.allocations) && detail.allocations.length > 0) {
    allocations = cloneAllocations(detail.allocations)
  } else {
    const projects = deriveFactProjects(detail)
    allocations = projects.map((project) => ({
      projectId: project.projectId,
      amount: projects.length === 1 ? finalProjectCost : 0,
      allocationNote: '',
    }))
  }

  return {
    resolutionType,
    attendanceUnits,
    finalProjectCost,
    allocations,
    resolutionNote: String(detail?.resolution?.resolutionNote || ''),
    version: Number.isSafeInteger(detail?.resolution?.version) ? detail.resolution.version : 0,
  }
}

function validResolutionUnits(draft) {
  return UNITS_BY_RESOLUTION[draft?.resolutionType] === draft?.attendanceUnits
}

export function resolutionReadOnlyReason(detail) {
  if (!detail?.permissions?.canResolve) return '当前账号没有日结处理权限'
  if (detail?.facts?.dayStatus === 'unconfigured') return '考勤核算尚未启用'
  if (detail?.facts?.dayStatus === 'before_activation') return '启用日期之前不能创建日结'
  if (detail?.resolution?.accountingStatus === 'month_locked') return '该日结已被月度工资锁定'
  return ''
}

export function detailHasMoneyScope(detail) {
  return detail?.hasMoneyScope === true
}

export function resolutionWriteBlockedReason(detail) {
  const readOnlyReason = resolutionReadOnlyReason(detail)
  if (readOnlyReason) return readOnlyReason
  if (detailHasMoneyScope(detail) &&
      detail?.permissions?.canUpdateProjectCosts !== true) {
    return '该日结已有项目人工成本；当前账号缺少完整费用权限，不能修改或清空原结论'
  }
  return ''
}

export function resolutionConfirmBlockers(detail, draft, { saving = false } = {}) {
  const blockers = []
  const writeBlockedReason = resolutionWriteBlockedReason(detail)
  if (writeBlockedReason) blockers.push(writeBlockedReason)
  if (saving) blockers.push('请求正在处理中')
  if (detail?.facts?.hasOpenSession) blockers.push('员工仍在打卡中，请完成下班打卡后确认')
  if (!validResolutionUnits(draft)) blockers.push('核算类型与确认人天不一致')
  if (!safeYen(draft?.finalProjectCost)) blockers.push('最终项目人工成本必须是非负整数日元')

  const allocations = Array.isArray(draft?.allocations) ? draft.allocations : []
  const moneyRequired = Number(draft?.attendanceUnits) > 0 ||
    Number(draft?.finalProjectCost) > 0 || allocations.length > 0
  if (moneyRequired && detail?.permissions?.canViewSalary !== true) {
    blockers.push('工资信息已按权限隐藏，不能确认含工资或项目费用的日结')
  } else if (moneyRequired && detail?.salary?.salaryType === '未设置') {
    blockers.push('员工工资标准未设置，请先到人员管理补充')
  }
  if (moneyRequired && (
    detail?.permissions?.canViewProjectCosts !== true ||
    detail?.permissions?.canUpdateProjectCosts !== true
  )) {
    blockers.push('当前账号没有项目费用确认权限')
  }

  const allocationResult = validateProjectAllocations({
    finalProjectCost: draft?.finalProjectCost,
    allocations,
  })
  if (!allocationResult.valid) blockers.push('项目分摊金额合计必须等于最终项目人工成本')
  return [...new Set(blockers)]
}

const LABOR_MODAL_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function laborModalFocusableElements(dialog) {
  if (!dialog || typeof dialog.querySelectorAll !== 'function') return []
  return [...dialog.querySelectorAll(LABOR_MODAL_FOCUSABLE_SELECTOR)].filter((element) => (
    element?.disabled !== true &&
    element?.getAttribute?.('aria-hidden') !== 'true' &&
    element?.matches?.(':disabled') !== true
  ))
}

export function focusLaborModal(dialog, previousFocus = globalThis.document?.activeElement) {
  const explicitTarget = dialog?.querySelector?.('[data-dialog-initial-focus]')
  const target = explicitTarget || laborModalFocusableElements(dialog)[0] || dialog
  target?.focus?.()
  let restored = false
  return () => {
    if (restored) return
    restored = true
    if (previousFocus && previousFocus !== target &&
        previousFocus.isConnected !== false) previousFocus.focus?.()
  }
}

export function handleLaborModalKeyDown({
  event,
  dialog,
  activeElement = globalThis.document?.activeElement,
  saving = false,
  onClose,
}) {
  if (event?.key === 'Escape') {
    if (saving) return false
    event.preventDefault?.()
    onClose?.()
    return true
  }
  if (event?.key !== 'Tab') return false

  const focusable = laborModalFocusableElements(dialog)
  if (focusable.length === 0) {
    event.preventDefault?.()
    dialog?.focus?.()
    return true
  }
  const first = focusable[0]
  const last = focusable.at(-1)
  const containsActive = dialog?.contains?.(activeElement) === true
  const nextTarget = event.shiftKey
    ? (!containsActive || activeElement === first ? last : null)
    : (!containsActive || activeElement === last ? first : null)
  if (!nextTarget) return false
  event.preventDefault?.()
  nextTarget.focus?.()
  return true
}

export function useLaborModalFocus(dialogRef, { onClose, saving = false } = {}) {
  const onCloseRef = useRef(onClose)
  const savingRef = useRef(saving)
  onCloseRef.current = onClose
  savingRef.current = saving

  useEffect(() => {
    const documentRef = globalThis.document
    const dialog = dialogRef?.current
    if (!documentRef || !dialog) return undefined
    const restoreFocus = focusLaborModal(dialog, documentRef.activeElement)
    const onKeyDown = (event) => handleLaborModalKeyDown({
      event,
      dialog,
      activeElement: documentRef.activeElement,
      saving: savingRef.current,
      onClose: onCloseRef.current,
    })
    documentRef.addEventListener('keydown', onKeyDown)
    return () => {
      documentRef.removeEventListener('keydown', onKeyDown)
      restoreFocus()
    }
  }, [dialogRef])
}

function nextSuggestedCost(detail, attendanceUnits) {
  if (!detail?.salary || detail.salary.salaryType === '未设置') return 0
  const calculated = suggestProjectCost({ ...detail.salary, attendanceUnits })
  return safeYen(calculated) ? calculated : 0
}

function draftForResolutionType(detail, previous, resolutionType) {
  const attendanceUnits = UNITS_BY_RESOLUTION[resolutionType]
  if (attendanceUnits === 0) {
    return {
      ...previous,
      resolutionType,
      attendanceUnits,
      finalProjectCost: 0,
      allocations: [],
    }
  }
  const finalProjectCost = nextSuggestedCost(detail, attendanceUnits)
  const projects = deriveFactProjects(detail)
  return {
    ...previous,
    resolutionType,
    attendanceUnits,
    finalProjectCost,
    allocations: projects.map((project) => ({
      projectId: project.projectId,
      amount: projects.length === 1 ? finalProjectCost : 0,
      allocationNote: '',
    })),
  }
}

function SalarySummary({ detail }) {
  if (detail.permissions.canViewSalary !== true) {
    return (
      <div className="labor-redacted-note" role="note">
        <strong>工资信息已按权限隐藏</strong>
        <span>仍可查看原始考勤事实；含金额结论需要有工资与项目费用权限的会计确认。</span>
      </div>
    )
  }
  if (detail.salary?.salaryType === '未设置') {
    return (
      <div className="labor-salary-warning" role="alert">
        <strong>未设置工资标准</strong>
        <span>整天或半天结论确认前，请先到人员管理补齐工资标准。</span>
      </div>
    )
  }
  const salary = detail.salary
  const rate = salary?.salaryType === '月薪'
    ? salary.baseSalary
    : salary?.salaryType === '日薪'
      ? salary.dailySalary
      : salary?.hourlyWage
  return (
    <dl className="labor-salary-summary">
      <div><dt>工资类型</dt><dd>{salary?.salaryType || '—'}</dd></div>
      <div><dt>档案工资标准</dt><dd>{safeYen(rate) ? YEN_FORMATTER.format(rate) : '—'}</dd></div>
      <div>
        <dt>建议项目日成本</dt>
        <dd>{safeYen(salary?.suggestedProjectCost)
          ? YEN_FORMATTER.format(salary.suggestedProjectCost)
          : detail.permissions.canViewProjectCosts ? '—' : '按权限隐藏'}</dd>
      </div>
    </dl>
  )
}

function EventLocationResult({ event }) {
  if (!event) return <span className="labor-muted-text">无事件</span>
  const abnormal = event.result === 'abnormal'
  return (
    <span className="labor-fact-location" data-result={event.result}>
      <strong>{abnormal ? '定位异常' : '定位正常'}</strong>
      {abnormalReason(event)}
    </span>
  )
}

function abnormalReason(event) {
  return event?.abnormalReason
    ? <small>{event.abnormalReason}</small>
    : null
}

function AttendanceFacts({ detail }) {
  const facts = detail.facts
  return (
    <section className="labor-dialog-section labor-facts-section" aria-labelledby="labor-facts-title">
      <header>
        <span>
          <small>只读 · 不覆盖员工记录</small>
          <h3 id="labor-facts-title">原始打卡事实</h3>
        </span>
        <span className="labor-readonly-badge">不可修改</span>
      </header>
      <dl className="labor-fact-summary">
        <div><dt>首次上班</dt><dd>{formatTokyoTime(facts.firstClockInAt)}</dd></div>
        <div><dt>最后下班</dt><dd>{formatTokyoTime(facts.lastClockOutAt)}</dd></div>
        <div><dt>工时参考</dt><dd>{formatWorkedMinutes(facts.workedMinutesReference)}</dd></div>
        <div><dt>应出勤</dt><dd>{detail.scheduleRequired ? '是' : '否（周日仍可打卡）'}</dd></div>
      </dl>

      {facts.issueCodes.length > 0 && (
        <div className="labor-dialog-issues" aria-label="原始考勤异常">
          {facts.issueCodes.map((code) => (
            <span className="labor-issue-chip" key={code}>{ATTENDANCE_ISSUE_LABELS[code] || code}</span>
          ))}
        </div>
      )}

      <div className="labor-fact-sessions">
        {facts.sessions.length === 0 ? (
          <p className="labor-empty-inline">当天没有打卡场次。</p>
        ) : facts.sessions.map((session, index) => (
          <article key={session.sessionId}>
            <header>
              <strong>{session.projectName}</strong>
              <span>{session.status === 'open' ? '进行中' : `场次 ${index + 1}`}</span>
            </header>
            <div className="labor-session-events">
              <div>
                <small>上班</small>
                <strong>{formatTokyoTime(
                  session.clockInEvent?.serverRecordedAt || session.openedAt,
                )}</strong>
                <EventLocationResult event={session.clockInEvent} />
              </div>
              <div>
                <small>下班</small>
                <strong>{formatTokyoTime(
                  session.clockOutEvent?.serverRecordedAt || session.closedAt,
                )}</strong>
                <EventLocationResult event={session.clockOutEvent} />
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function AllocationFields({ detail, draft, disabled, onDraftChange }) {
  const projectNames = new Map(deriveFactProjects(detail).map((project) => [
    project.projectId,
    project.projectName,
  ]))
  for (const allocation of detail.allocations || []) {
    if (!projectNames.has(allocation.projectId)) {
      projectNames.set(allocation.projectId, allocation.projectName)
    }
  }
  const allocationResult = validateProjectAllocations({
    finalProjectCost: draft.finalProjectCost,
    allocations: draft.allocations,
  })

  if (detail.permissions.canViewSalary !== true ||
      detail.permissions.canViewProjectCosts !== true) {
    return <p className="labor-redacted-inline">项目分摊金额已按权限隐藏。</p>
  }

  const changeAllocation = (index, key, value) => {
    onDraftChange({
      ...draft,
      allocations: draft.allocations.map((allocation, allocationIndex) => (
        allocationIndex === index ? { ...allocation, [key]: value } : allocation
      )),
    })
  }

  return (
    <div className="labor-allocation-editor">
      <label>
        <span>最终项目人工成本（日元）</span>
        <input
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          aria-label="最终项目人工成本（日元）"
          value={draft.finalProjectCost}
          disabled={disabled}
          onChange={(event) => {
            const amount = Math.max(0, Math.trunc(Number(event.target.value) || 0))
            const allocations = draft.allocations.length === 1
              ? [{ ...draft.allocations[0], amount }]
              : draft.allocations
            onDraftChange({ ...draft, finalProjectCost: amount, allocations })
          }}
        />
      </label>

      <div className="labor-allocation-list">
        {draft.allocations.length === 0 ? (
          <p className="labor-empty-inline">
            {draft.attendanceUnits === 0 ? '0 人天结论不产生项目分摊。' : '当天没有可分摊的打卡项目。'}
          </p>
        ) : draft.allocations.map((allocation, index) => {
          const projectName = projectNames.get(allocation.projectId) || allocation.projectId
          return (
            <article key={allocation.projectId}>
              <strong>{projectName}</strong>
              <label>
                <span>{projectName}分摊金额（日元）</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  aria-label={`${projectName}分摊金额（日元）`}
                  value={allocation.amount}
                  disabled={disabled}
                  onChange={(event) => changeAllocation(
                    index, 'amount', Math.max(0, Math.trunc(Number(event.target.value) || 0)),
                  )}
                />
              </label>
              <label>
                <span>{projectName}分摊备注</span>
                <input
                  type="text"
                  maxLength="2000"
                  aria-label={`${projectName}分摊备注`}
                  value={allocation.allocationNote}
                  disabled={disabled}
                  onChange={(event) => changeAllocation(index, 'allocationNote', event.target.value)}
                />
              </label>
            </article>
          )
        })}
      </div>

      <div className="labor-allocation-balance" data-valid={allocationResult.valid}>
        <span>项目分摊合计</span>
        <strong>{allocationResult.allocatedTotal === null
          ? '输入无效'
          : YEN_FORMATTER.format(allocationResult.allocatedTotal)}</strong>
        <small>{allocationResult.valid
          ? '金额已平衡，可以确认。'
          : `还差 ${YEN_FORMATTER.format(allocationResult.difference ?? 0)}，确认前必须平衡。`}</small>
      </div>
    </div>
  )
}

export default function AttendanceResolutionDialog({
  detail,
  draft: providedDraft,
  saving = false,
  error = '',
  onChange,
  onSaveDraft,
  onConfirm,
  onClose,
}) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const initialDraft = useMemo(
    () => providedDraft ? { ...providedDraft, allocations: cloneAllocations(providedDraft.allocations) }
      : buildInitialResolutionDraft(detail),
    [detail, providedDraft],
  )
  const [draft, setDraft] = useState(initialDraft)
  const readOnlyReason = resolutionWriteBlockedReason(detail)
  const blockers = resolutionConfirmBlockers(detail, draft, { saving })
  const controlsDisabled = saving || Boolean(readOnlyReason)
  useLaborModalFocus(dialogRef, { onClose, saving })

  const changeDraft = (nextDraft) => {
    setDraft(nextDraft)
    onChange?.(nextDraft)
  }

  return (
    <div className="labor-dialog-backdrop">
      <section
        ref={dialogRef}
        className="labor-resolution-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex="-1"
      >
        <header className="labor-dialog-heading">
          <span>
            <small>{detail.workDate} · {detail.employee.employeeNumber}</small>
            <h2 id={titleId}>{detail.employee.employeeName} · 考勤日结</h2>
            <p>{detail.employee.department} · {detail.employee.position}</p>
          </span>
          <button
            type="button"
            className="labor-dialog-close"
            data-dialog-initial-focus
            aria-label="关闭考勤日结弹窗"
            disabled={saving}
            onClick={() => onClose?.()}
          >
            ×
          </button>
        </header>

        <div className="labor-dialog-scroll">
          <AttendanceFacts detail={detail} />

          <section className="labor-dialog-section" aria-labelledby="labor-resolution-title">
            <header>
              <span>
                <small>会计结论 · 不修改上方事实</small>
                <h3 id="labor-resolution-title">当天核算结论</h3>
              </span>
              {detail.resolution?.accountingStatus && (
                <span className="labor-accounting-badge">
                  {detail.resolution.accountingStatus === 'draft' ? '草稿' :
                    detail.resolution.accountingStatus === 'month_locked' ? '月结已锁定' : '已确认'}
                </span>
              )}
            </header>

            {readOnlyReason && <p className="labor-locked-notice" role="status">{readOnlyReason}</p>}
            <fieldset className="labor-resolution-options" disabled={controlsDisabled}>
              <legend>出勤核算类型</legend>
              {RESOLUTION_OPTIONS.map(([value, label, units, hint]) => {
                const inputId = `${titleId}-${value}`
                return (
                  <label htmlFor={inputId} key={value}>
                    <input
                      id={inputId}
                      type="radio"
                      name={`${titleId}-resolution-type`}
                      value={value}
                      checked={draft.resolutionType === value}
                      onChange={() => changeDraft(draftForResolutionType(detail, draft, value))}
                    />
                    <span><strong>{label}</strong><small>{hint}</small></span>
                  </label>
                )
              })}
            </fieldset>

            <SalarySummary detail={detail} />

            <section className="labor-project-allocation" aria-labelledby="labor-allocation-title">
              <header>
                <span>
                  <small>确认后才进入正式项目成本</small>
                  <h4 id="labor-allocation-title">项目分摊金额</h4>
                </span>
              </header>
              <AllocationFields
                detail={detail}
                draft={draft}
                disabled={controlsDisabled}
                onDraftChange={changeDraft}
              />
            </section>

            <label className="labor-resolution-note">
              <span>会计处理备注</span>
              <textarea
                aria-label="会计处理备注"
                maxLength="2000"
                rows="3"
                value={draft.resolutionNote}
                disabled={controlsDisabled}
                placeholder="填写请假依据、异常核对结果或成本分摊说明"
                onChange={(event) => changeDraft({ ...draft, resolutionNote: event.target.value })}
              />
            </label>

            {error && <p className="labor-dialog-error" role="alert">{error}</p>}
            {blockers.length > 0 && !readOnlyReason && (
              <div className="labor-confirm-blockers" role="status">
                <strong>暂不能确认</strong>
                <ul>{blockers.map((reason) => <li key={reason}>{reason}</li>)}</ul>
              </div>
            )}
          </section>
        </div>

        <footer className="labor-dialog-actions">
          <button type="button" disabled={saving} onClick={() => onClose?.()}>取消</button>
          <button
            type="button"
            className="labor-save-draft"
            disabled={controlsDisabled}
            onClick={() => onSaveDraft?.(draft)}
          >
            {saving ? '正在保存…' : '保存草稿'}
          </button>
          <button
            type="button"
            className="labor-confirm-resolution"
            disabled={blockers.length > 0}
            onClick={() => onConfirm?.(draft)}
          >
            {saving ? '正在提交…' : '确认并计入核算'}
          </button>
        </footer>
      </section>
    </div>
  )
}

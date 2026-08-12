import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import AccountingReportActions from '../accounting-reports/AccountingReportActions.jsx'
import { createMonthlyPayrollReport } from '../accounting-reports/monthlyPayrollReport.js'
import { useLaborModalFocus } from './AttendanceResolutionDialog.jsx'
import { ATTENDANCE_ISSUE_LABELS } from './AttendanceStatusTable.jsx'

const PAYROLL_STATUS_LABELS = Object.freeze({
  confirmed: '已确认',
  salary_required: '工资标准缺失',
  invalid_money: '工资金额异常',
  incomplete: '未完成',
  ready: '可确认',
})

const ATTENDANCE_METHOD_LABELS = Object.freeze({
  project: '项目打卡',
  general: '非项目打卡',
  exempt: '免打卡 · 默认全勤',
})

const POSIX_EDGE_SPACE = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/gu
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u
const WORK_DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u
const CALENDAR_WEEKDAYS = Object.freeze(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
const CALENDAR_DAY_STATUS_LABELS = Object.freeze({
  unconfigured: '未启用',
  before_activation: '启用前日期',
  full_day: '整天已确认',
  half_day: '半天已确认',
  rest: '休息',
  leave: '请假',
  comp_time: '调休',
  absence: '缺勤',
  optional_not_worked: '非应出勤日',
  missing_clock_in: '未打卡',
  not_started: '尚未到上班时间',
  working: '正在工作',
  completed: '已完成打卡',
})
const CALENDAR_ACCOUNTING_STATUS_LABELS = Object.freeze({
  draft: '草稿',
  confirmed: '已确认',
  month_locked: '月结已锁定',
})
const CALENDAR_ISSUE_ORDER = new Map([
  'missing_clock_in', 'missing_clock_out', 'late', 'early',
  'abnormal_location', 'overtime_pending',
].map((code, index) => [code, index]))

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
}

function monthLength(year, monthNumber) {
  if (monthNumber === 2) return isLeapYear(year) ? 29 : 28
  return [4, 6, 9, 11].includes(monthNumber) ? 30 : 31
}

export function buildMonthCalendarGrid(month, days = []) {
  if (!MONTH_PATTERN.test(String(month ?? '')) || !Array.isArray(days)) return []
  const [yearText, monthText] = month.split('-')
  const year = Number(yearText)
  const monthNumber = Number(monthText)
  const firstWeekday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7
  const totalDays = monthLength(year, monthNumber)
  const byDate = new Map(days
    .filter((day) => WORK_DATE_PATTERN.test(String(day?.workDate ?? '')) &&
      day.workDate.startsWith(`${month}-`))
    .map((day) => [day.workDate, day]))
  const cells = new Array(firstWeekday).fill(null)
  for (let dayNumber = 1; dayNumber <= totalDays; dayNumber += 1) {
    const workDate = `${month}-${String(dayNumber).padStart(2, '0')}`
    cells.push(byDate.get(workDate) || {
      workDate,
      eligible: false,
      scheduleRequired: false,
      dayStatus: null,
      issueCodes: [],
      accountingStatus: null,
      missing: true,
    })
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

export function calendarDayPresentation(day) {
  if (day?.missing === true) {
    return {
      dayStatusLabel: '数据缺失',
      accountingStatusLabel: '待核对',
      issueLabel: '无数据',
      scheduleLabel: '日期数据缺失',
      tone: 'warning',
    }
  }
  if (day?.eligible !== true) {
    return {
      dayStatusLabel: '不适用',
      accountingStatusLabel: '无需核算',
      issueLabel: '无异常',
      scheduleLabel: '非适用日期',
      tone: 'muted',
    }
  }
  const issueCodes = Array.isArray(day.issueCodes) ? day.issueCodes : []
  const issueLabel = issueCodes.length > 0
    ? [...issueCodes]
      .sort((left, right) =>
        (CALENDAR_ISSUE_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (CALENDAR_ISSUE_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER))
      .map((code) => ATTENDANCE_ISSUE_LABELS[code] || code).join('、')
    : '无异常'
  const dayStatusLabel = CALENDAR_DAY_STATUS_LABELS[day.dayStatus] || '未知状态'
  const accountingStatusLabel = day.accountingStatus
    ? CALENDAR_ACCOUNTING_STATUS_LABELS[day.accountingStatus] || day.accountingStatus
    : '待核算'
  const danger = issueCodes.length > 0 || ['absence', 'missing_clock_in'].includes(day.dayStatus)
  const warning = day.accountingStatus === 'draft' || day.dayStatus === 'working'
  return {
    dayStatusLabel,
    accountingStatusLabel,
    issueLabel,
    scheduleLabel: day.scheduleRequired === true ? '应出勤' : '非应出勤日',
    tone: danger ? 'danger' : warning ? 'warning' : 'success',
  }
}

function safeError(error, fallback) {
  return typeof error?.userMessage === 'string' && error.userMessage.trim()
    ? error.userMessage
    : fallback
}

function trimPosix(value) {
  return String(value ?? '').replace(POSIX_EDGE_SPACE, '')
}

function safeYenInput(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0) ? value : null
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function yen(value) {
  return `¥${Number(value ?? 0).toLocaleString('ja-JP')}`
}

function employeeKey(employee) {
  return employee.employeeProfileId || `legacy:${employee.employeeNumber}:${employee.employeeName}`
}

function draftFromEmployee(employee) {
  return {
    overtimePay: String(employee.overtimePay ?? 0),
    bonus: String(employee.bonus ?? 0),
    deduction: String(employee.deduction ?? 0),
    confirmationNote: employee.confirmationNote ?? '',
  }
}

function draftsFromReport(report) {
  return Object.fromEntries((report?.employees || [])
    .filter((employee) => employee.employeeProfileId)
    .map((employee) => [employeeKey(employee), draftFromEmployee(employee)]))
}

function optionsFromReport(report) {
  const departments = [...new Set((report?.employees || [])
    .map((employee) => employee.department)
    .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'zh-CN'))
  const employees = []
  const seen = new Set()
  for (const employee of report?.employees || []) {
    if (!employee.employeeProfileId || seen.has(employee.employeeProfileId)) continue
    seen.add(employee.employeeProfileId)
    employees.push({
      employeeProfileId: employee.employeeProfileId,
      employeeNumber: employee.employeeNumber,
      employeeName: employee.employeeName,
    })
  }
  return { departments, employees }
}

export function buildMonthlyPayrollPayload({ employee, month, draft }) {
  if (!UUID_PATTERN.test(String(employee?.employeeProfileId ?? '')) ||
      !MONTH_PATTERN.test(String(month ?? ''))) return null
  const overtimePay = safeYenInput(draft?.overtimePay)
  const bonus = safeYenInput(draft?.bonus)
  const deduction = safeYenInput(draft?.deduction)
  if (overtimePay === null || bonus === null || deduction === null ||
      !Number.isSafeInteger(employee.version) || employee.version < 0) return null
  const confirmationNote = trimPosix(draft?.confirmationNote)
  if (confirmationNote.length > 2000) return null
  return {
    employeeProfileId: employee.employeeProfileId,
    month,
    overtimePay,
    bonus,
    deduction,
    confirmationNote,
    version: employee.version,
  }
}

export function buildPayrollReopenPayload({ employee, reason }) {
  const normalized = trimPosix(reason)
  if (!UUID_PATTERN.test(String(employee?.payrollId ?? '')) || !normalized ||
      normalized.length > 2000 ||
      !Number.isSafeInteger(employee.version) || employee.version < 1) return null
  return { payrollId: employee.payrollId, reason: normalized, version: employee.version }
}

function ReconciliationWarning({ reconciliation }) {
  const postActivation = reconciliation?.postActivationLegacyRows || 0
  const malformed = reconciliation?.globalMalformedLegacyRows || 0
  if (postActivation === 0 && malformed === 0) return null
  return (
    <div className="labor-reconciliation-warning" role="alert">
      <strong>历史数据核对</strong>
      <span>启用日期后仍有 {postActivation} 条历史人工记录；另有 {malformed} 条历史数据格式异常。</span>
    </div>
  )
}

function EmployeeMonthCalendarDay({ day, onOpenDailyDate }) {
  const presentation = calendarDayPresentation(day)
  const content = (
    <>
      <span className="labor-month-calendar-date">
        <time dateTime={day.workDate}>{Number(day.workDate.slice(-2))}日</time>
        <small>{presentation.scheduleLabel}</small>
      </span>
      <strong>{presentation.dayStatusLabel}</strong>
      <span>核算：{presentation.accountingStatusLabel}</span>
      <span>异常：{presentation.issueLabel}</span>
    </>
  )
  return (
    <article
      className="labor-month-calendar-day"
      data-tone={presentation.tone}
      data-eligible={day.eligible === true}
      role="gridcell"
    >
      {day.eligible === true ? (
        <button
          type="button"
          aria-label={`查看 ${day.workDate} 考勤`}
          onClick={() => onOpenDailyDate?.(day.workDate)}
        >
          {content}
        </button>
      ) : content}
    </article>
  )
}

export function EmployeeMonthCalendarDialog({
  state,
  onClose,
  onRetry,
  onOpenDailyDate,
}) {
  const dialogRef = useRef(null)
  const titleId = useId()
  useLaborModalFocus(dialogRef, { onClose, saving: false })
  const salaryMonth = state?.salaryMonth || ''
  const employeeName = state?.employee?.employeeName || '员工'
  const days = Array.isArray(state?.days) ? state.days : []
  const calendarCells = useMemo(
    () => buildMonthCalendarGrid(salaryMonth, days),
    [days, salaryMonth],
  )
  const calendarRows = useMemo(() => {
    const rows = []
    for (let index = 0; index < calendarCells.length; index += 7) {
      rows.push(calendarCells.slice(index, index + 7))
    }
    return rows
  }, [calendarCells])

  return (
    <div className="labor-dialog-backdrop">
      <section
        ref={dialogRef}
        className="labor-month-calendar-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex="-1"
      >
        <header className="labor-dialog-heading">
          <span>
            <small>员工月度考勤明细</small>
            <h2 id={titleId}>{employeeName} · {salaryMonth} 整月考勤</h2>
            <p>{state?.employee?.employeeNumber || '工号未记录'} · {state?.employee?.department || '部门未记录'}</p>
          </span>
          <button
            type="button"
            className="labor-dialog-close"
            aria-label="关闭整月考勤"
            data-dialog-initial-focus
            onClick={() => onClose?.()}
          >
            ×
          </button>
        </header>

        <div className="labor-month-calendar-scroll">
          {state?.status === 'loading' && (
            <div className="labor-month-calendar-state" role="status">
              <span className="labor-loading-dot" aria-hidden="true" />
              <strong>正在加载整月考勤…</strong>
              <span>正在取得 {employeeName} 的 {salaryMonth} 逐日核算状态。</span>
            </div>
          )}
          {state?.status === 'error' && (
            <div className="labor-month-calendar-state">
              <strong>整月考勤暂时无法显示</strong>
              <p role="alert">{state.error || '整月考勤读取失败，请稍后重试。'}</p>
              <button type="button" onClick={() => onRetry?.()}>重新加载整月考勤</button>
            </div>
          )}
          {state?.status === 'success' && days.length === 0 && (
            <div className="labor-month-calendar-state" role="status">
              <strong>没有可显示的逐日考勤记录</strong>
              <span>当前员工与月份没有返回逐日数据，请重新加载。</span>
              <button type="button" onClick={() => onRetry?.()}>重新加载整月考勤</button>
            </div>
          )}
          {state?.status === 'success' && days.length > 0 && (
            <div className="labor-month-calendar-wrap">
              <div
                className="labor-month-calendar-grid"
                role="grid"
                aria-label={`${employeeName} ${salaryMonth} 整月考勤日历`}
              >
                <div className="labor-month-calendar-weekdays" role="row">
                  {CALENDAR_WEEKDAYS.map((weekday) => (
                    <span key={weekday} role="columnheader">{weekday}</span>
                  ))}
                </div>
                {calendarRows.map((week, weekIndex) => (
                  <div className="labor-month-calendar-week" role="row" key={`week-${weekIndex}`}>
                    {week.map((day, dayIndex) => day ? (
                      <EmployeeMonthCalendarDay
                        key={day.workDate}
                        day={day}
                        onOpenDailyDate={onOpenDailyDate}
                      />
                    ) : (
                      <span
                        className="labor-month-calendar-spacer"
                        role="gridcell"
                        aria-label="本月以外日期"
                        key={`spacer-${weekIndex}-${dayIndex}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <footer className="labor-dialog-actions">
          <button type="button" onClick={() => onClose?.()}>取消</button>
        </footer>
      </section>
    </div>
  )
}

function MonthCalendarAction({ employee, month, disabled, onOpen }) {
  const canonical = employee.source !== 'legacy' && Boolean(employee.employeeProfileId)
  if (!canonical) {
    return <span className="labor-month-calendar-unavailable">历史人工记录无逐日考勤</span>
  }
  if (employee.attendanceMethod === 'exempt') {
    return (
      <span className="labor-month-calendar-unavailable">
        免打卡员工无虚构逐日记录
      </span>
    )
  }
  return (
    <button
      type="button"
      className="labor-row-action labor-month-calendar-action"
      aria-label={`查看${employee.employeeName} ${month} 整月考勤`}
      disabled={disabled}
      onClick={() => onOpen?.(employee)}
    >
      查看整月考勤
    </button>
  )
}

function PayrollMoneyEditor({ employee, draft, disabled, variant, onChange }) {
  const prefix = variant === 'mobile' ? '移动卡片 ' : ''
  return (
    <div className="labor-payroll-money-editor">
      {[
        ['overtimePay', '加班费'],
        ['bonus', '奖金'],
        ['deduction', '扣款'],
      ].map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            aria-label={`${prefix}${employee.employeeName} ${label}`}
            value={draft[key]}
            disabled={disabled}
            onChange={(event) => onChange({ ...draft, [key]: event.target.value })}
          />
        </label>
      ))}
      <label className="labor-payroll-note-field">
        <span>确认备注</span>
        <input
          type="text"
          aria-label={`${prefix}${employee.employeeName} 确认备注`}
          maxLength="2000"
          value={draft.confirmationNote}
          disabled={disabled}
          onChange={(event) => onChange({ ...draft, confirmationNote: event.target.value })}
        />
      </label>
    </div>
  )
}

function PayrollActions({
  employee,
  draft,
  canUpdateSalary,
  reportCurrent,
  locked,
  rowError,
  reopenReason,
  variant,
  onDraftChange,
  onReopenReasonChange,
  onSubmit,
}) {
  const canonical = employee.source !== 'legacy' && Boolean(employee.employeeProfileId)
  const confirmed = employee.status === 'confirmed'
  const editable = canonical && canUpdateSalary && reportCurrent && !confirmed
  const prefix = variant === 'mobile' ? '移动卡片 ' : ''
  if (!canonical) {
    return <span className="labor-readonly-badge">历史人工记录 · 只读</span>
  }
  if (!canUpdateSalary) {
    return <span className="labor-readonly-badge">只读 · 无工资修改权限</span>
  }
  if (confirmed) {
    return (
      <div className="labor-payroll-reopen">
        <label>
          <span>重新打开原因</span>
          <input
            type="text"
            aria-label={`${prefix}${employee.employeeName} 重新打开原因`}
            maxLength="2000"
            value={reopenReason}
            disabled={locked || !reportCurrent}
            onChange={(event) => onReopenReasonChange(event.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={locked || !reportCurrent || !trimPosix(reopenReason)}
          onClick={() => onSubmit('reopen')}
        >
          {locked ? '处理中…' : '重新打开'}
        </button>
        {!reportCurrent && <small className="labor-muted-text">等待当前筛选数据刷新后再操作。</small>}
        {rowError && <span className="labor-row-error" role="alert">{rowError}</span>}
      </div>
    )
  }
  return (
    <div className="labor-payroll-write-area">
      <PayrollMoneyEditor
        employee={employee}
        draft={draft}
        disabled={!editable || locked}
        variant={variant}
        onChange={onDraftChange}
      />
      {!reportCurrent && <small className="labor-muted-text">等待当前筛选数据刷新后再操作。</small>}
      <div className="labor-payroll-row-actions">
        <button
          type="button"
          disabled={!editable || locked}
          onClick={() => onSubmit('draft')}
        >
          {locked ? '保存中…' : '保存工资草稿'}
        </button>
        <button
          type="button"
          className="labor-primary-action"
          disabled={!editable || locked || employee.status !== 'ready'}
          onClick={() => onSubmit('confirm')}
        >
          {locked ? '确认中…' : '确认月度工资'}
        </button>
      </div>
      {employee.status !== 'ready' && (
        <small className="labor-muted-text">处理完当月考勤、工资标准和项目分摊后才可确认。</small>
      )}
      {rowError && <span className="labor-row-error" role="alert">{rowError}</span>}
    </div>
  )
}

function PayrollCountFacts({ employee }) {
  return (
    <dl className="labor-payroll-counts">
      <div><dt>整天</dt><dd>{employee.fullDays}</dd></div>
      <div><dt>半天</dt><dd>{employee.halfDays}</dd></div>
      <div><dt>休息/请假/调休</dt><dd>{employee.excusedDays}</dd></div>
      <div><dt>缺勤</dt><dd>{employee.absenceDays}</dd></div>
      <div><dt>待处理</dt><dd>{employee.pendingDays}</dd></div>
    </dl>
  )
}

function PayrollIssueFacts({ employee }) {
  return (
    <div className="labor-payroll-issues">
      <span>
        迟到 {employee.issueCounts.late} · 早退 {employee.issueCounts.early} ·
        定位异常 {employee.locationAbnormalCount} 条 · 加班待确认 {employee.issueCounts.overtimePending}
      </span>
      {employee.locationReviewSummary && <small>{employee.locationReviewSummary}</small>}
    </div>
  )
}

function AttendanceMethodBadge({ employee }) {
  return (
    <span className="labor-attendance-method-badge" data-method={employee.attendanceMethod}>
      {ATTENDANCE_METHOD_LABELS[employee.attendanceMethod] || employee.attendanceMethod}
    </span>
  )
}

function PayrollMoneyFacts({ employee }) {
  return (
    <dl className="labor-payroll-money-facts">
      <div><dt>工资类型</dt><dd>{employee.salaryType}</dd></div>
      <div><dt>基本工资预览</dt><dd>{employee.basePay === null ? '—' : yen(employee.basePay)}</dd></div>
      <div><dt>实发工资</dt><dd>{employee.netSalary === null ? '—' : yen(employee.netSalary)}</dd></div>
      <div><dt>项目已分摊</dt><dd>{yen(employee.projectAllocatedAmount)}</dd></div>
      <div><dt>项目未分摊</dt><dd>{yen(employee.projectUnallocatedAmount)}</dd></div>
      <div><dt>公司人员成本</dt><dd>{yen(employee.companyPersonnelCost)}</dd></div>
    </dl>
  )
}

export default function MonthlyPayrollTab({
  service,
  month,
  onMonthChange,
  onAuthInvalid,
  onOpenDailyDate,
  initialReport = null,
  reportPreparedBy = '',
  reportActionDependencies = {},
}) {
  const [department, setDepartment] = useState('')
  const [employeeProfileId, setEmployeeProfileId] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)
  const [report, setReport] = useState(initialReport)
  const [loadState, setLoadState] = useState({
    status: initialReport ? 'success' : 'idle', error: '',
  })
  const [drafts, setDrafts] = useState(() => draftsFromReport(initialReport))
  const [reopenReasons, setReopenReasons] = useState({})
  const [rowErrors, setRowErrors] = useState({})
  const [writeLocked, setWriteLocked] = useState({})
  const [monthCalendar, setMonthCalendar] = useState(null)
  const [filterEpoch, setFilterEpoch] = useState(0)
  const initialOptions = optionsFromReport(initialReport)
  const [departmentOptions, setDepartmentOptions] = useState(initialOptions.departments)
  const [employeeOptions, setEmployeeOptions] = useState(initialOptions.employees)

  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const contextGenerationRef = useRef(0)
  const writeGenerationRef = useRef(new Map())
  const writeLockedRef = useRef(new Set())
  const calendarGenerationRef = useRef(0)
  const calendarPendingRef = useRef(false)
  const calendarOpenRef = useRef(false)
  const monthRef = useRef(month)
  const optionCacheRef = useRef({ month, ...initialOptions })
  const canUpdateSalaryRef = useRef(initialReport?.permissions?.canUpdateSalary === true)
  const reportCurrentRef = useRef(Boolean(initialReport))
  monthRef.current = month
  canUpdateSalaryRef.current = report?.permissions?.canUpdateSalary === true

  const closeMonthCalendar = useCallback(() => {
    calendarGenerationRef.current += 1
    calendarPendingRef.current = false
    calendarOpenRef.current = false
    setMonthCalendar(null)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      contextGenerationRef.current += 1
      writeGenerationRef.current.clear()
      writeLockedRef.current.clear()
      calendarGenerationRef.current += 1
      calendarPendingRef.current = false
      calendarOpenRef.current = false
    }
  }, [])

  useEffect(() => {
    closeMonthCalendar()
  }, [closeMonthCalendar, month])

  useEffect(() => {
    contextGenerationRef.current += 1
  }, [month, department, employeeProfileId, onlyPending])

  const loadReport = useCallback(async () => {
    if (!month) return { status: 'invalid' }
    const generation = ++loadGenerationRef.current
    reportCurrentRef.current = false
    setLoadState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      const value = await service.listMonthlyPayroll({
        month,
        department,
        employeeProfileId: employeeProfileId || null,
        onlyPending,
      })
      const current = mountedRef.current && generation === loadGenerationRef.current
      if (!current) return { status: 'stale' }
      if (!value.permissions.canUpdateSalary && canUpdateSalaryRef.current) {
        contextGenerationRef.current += 1
        setWriteLocked({})
      }
      canUpdateSalaryRef.current = value.permissions.canUpdateSalary
      reportCurrentRef.current = true
      setReport(value)
      setDrafts(draftsFromReport(value))
      setLoadState({ status: 'success', error: '' })
      if (!department && !employeeProfileId && !onlyPending) {
        const options = optionsFromReport(value)
        optionCacheRef.current = { month, ...options }
        setDepartmentOptions(options.departments)
        setEmployeeOptions(options.employees)
      }
      return { status: 'success', value }
    } catch (error) {
      const current = mountedRef.current && generation === loadGenerationRef.current
      if (!current) return { status: 'stale' }
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      reportCurrentRef.current = false
      setLoadState({
        status: 'error',
        error: safeError(error, '月度工资加载失败，请稍后重试。'),
      })
      return { status: 'error' }
    }
  }, [department, employeeProfileId, month, onAuthInvalid, onlyPending, service])

  const requestMonthCalendar = useCallback(async ({ employee, requestedMonth }) => {
    const employeeProfileId = employee?.employeeProfileId
    if (!UUID_PATTERN.test(String(employeeProfileId ?? '')) ||
        !MONTH_PATTERN.test(String(requestedMonth ?? ''))) return { status: 'invalid' }
    if (calendarPendingRef.current || !calendarOpenRef.current) return { status: 'locked' }
    calendarPendingRef.current = true
    const generation = ++calendarGenerationRef.current
    const contextGeneration = contextGenerationRef.current
    setMonthCalendar({
      status: 'loading',
      salaryMonth: requestedMonth,
      employee,
      days: [],
      error: '',
    })
    try {
      const value = await service.listEmployeeMonthCalendar({
        employeeProfileId,
        month: requestedMonth,
      })
      const current = mountedRef.current &&
        calendarOpenRef.current &&
        generation === calendarGenerationRef.current &&
        contextGeneration === contextGenerationRef.current &&
        monthRef.current === requestedMonth
      if (!current) return { status: 'stale' }
      if (value?.salaryMonth !== requestedMonth ||
          value?.employee?.employeeProfileId !== employeeProfileId) {
        setMonthCalendar({
          status: 'error',
          salaryMonth: requestedMonth,
          employee,
          days: [],
          error: '返回的整月考勤与当前员工或月份不一致，请重新加载。',
        })
        return { status: 'invalid-response' }
      }
      setMonthCalendar({
        status: 'success',
        salaryMonth: value.salaryMonth,
        employee: value.employee,
        days: Array.isArray(value.days) ? value.days : [],
        error: '',
      })
      return { status: 'success', value }
    } catch (error) {
      const current = mountedRef.current &&
        calendarOpenRef.current &&
        generation === calendarGenerationRef.current &&
        contextGeneration === contextGenerationRef.current &&
        monthRef.current === requestedMonth
      if (!current) return { status: 'stale' }
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      setMonthCalendar({
        status: 'error',
        salaryMonth: requestedMonth,
        employee,
        days: [],
        error: safeError(error, '整月考勤加载失败，请稍后重试。'),
      })
      return { status: 'error' }
    } finally {
      const current = mountedRef.current &&
        calendarOpenRef.current &&
        generation === calendarGenerationRef.current &&
        contextGeneration === contextGenerationRef.current &&
        monthRef.current === requestedMonth
      if (current) calendarPendingRef.current = false
    }
  }, [onAuthInvalid, service])

  const openMonthCalendar = (employee) => {
    if (calendarOpenRef.current || calendarPendingRef.current ||
        employee?.source === 'legacy' ||
        !UUID_PATTERN.test(String(employee?.employeeProfileId ?? '')) ||
        !MONTH_PATTERN.test(String(month ?? ''))) return
    calendarOpenRef.current = true
    const identity = {
      employeeProfileId: employee.employeeProfileId,
      employeeNumber: employee.employeeNumber,
      employeeName: employee.employeeName,
      department: employee.department,
      position: employee.position,
    }
    void requestMonthCalendar({ employee: identity, requestedMonth: month })
  }

  const retryMonthCalendar = () => {
    if (!calendarOpenRef.current || !monthCalendar?.employee ||
        monthCalendar.salaryMonth !== monthRef.current) return
    void requestMonthCalendar({
      employee: monthCalendar.employee,
      requestedMonth: monthCalendar.salaryMonth,
    })
  }

  const openDailyDateFromCalendar = (nextWorkDate) => {
    const eligible = monthCalendar?.status === 'success' &&
      monthCalendar.days.some((day) =>
        day?.eligible === true && day.workDate === nextWorkDate)
    if (!eligible || !WORK_DATE_PATTERN.test(String(nextWorkDate ?? ''))) return
    closeMonthCalendar()
    onOpenDailyDate?.(nextWorkDate)
  }

  useEffect(() => {
    if (optionCacheRef.current.month !== month) {
      optionCacheRef.current = { month, departments: [], employees: [] }
      loadGenerationRef.current += 1
      contextGenerationRef.current += 1
      reportCurrentRef.current = false
      setReport(null)
      setLoadState({ status: 'idle', error: '' })
      setDrafts({})
      setReopenReasons({})
      setRowErrors({})
      setWriteLocked({})
      setDepartmentOptions([])
      setEmployeeOptions([])
      setDepartment('')
      setEmployeeProfileId('')
      setOnlyPending(false)
      setFilterEpoch((current) => current + 1)
      return
    }
    if (month) void loadReport()
  }, [filterEpoch, loadReport, month])

  const changeMonth = (nextMonth) => {
    closeMonthCalendar()
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    setWriteLocked({})
    onMonthChange?.(nextMonth)
  }

  const changeDepartment = (value) => {
    closeMonthCalendar()
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    setWriteLocked({})
    setDepartment(value)
  }

  const changeEmployee = (value) => {
    closeMonthCalendar()
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    setWriteLocked({})
    setEmployeeProfileId(value)
  }

  const changeOnlyPending = (value) => {
    closeMonthCalendar()
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    setWriteLocked({})
    setOnlyPending(value)
  }

  const updateDraft = (employee, nextDraft) => {
    const key = employeeKey(employee)
    setDrafts((current) => ({ ...current, [key]: nextDraft }))
    setRowErrors((current) => ({ ...current, [key]: '' }))
  }

  const submit = async (mode, employee) => {
    const key = employeeKey(employee)
    if (!canUpdateSalaryRef.current || !reportCurrentRef.current) return
    if (writeLockedRef.current.has(key)) {
      setRowErrors((current) => ({ ...current, [key]: '该员工上一项工资操作仍在处理中。' }))
      return
    }
    const payload = mode === 'reopen'
      ? buildPayrollReopenPayload({ employee, reason: reopenReasons[key] })
      : buildMonthlyPayrollPayload({ employee, month, draft: drafts[key] })
    if (!payload) {
      setRowErrors((current) => ({
        ...current,
        [key]: mode === 'reopen'
          ? '请填写非空的重新打开原因。'
          : '加班费、奖金和扣款必须是非负日元整数。',
      }))
      return
    }
    writeLockedRef.current.add(key)
    const generation = (writeGenerationRef.current.get(key) || 0) + 1
    writeGenerationRef.current.set(key, generation)
    const contextGeneration = contextGenerationRef.current
    setWriteLocked((current) => ({ ...current, [key]: true }))
    setRowErrors((current) => ({ ...current, [key]: '' }))
    try {
      const method = mode === 'reopen'
        ? 'reopenMonthlyPayroll'
        : mode === 'confirm' ? 'confirmMonthlyPayroll' : 'saveMonthlyPayrollDraft'
      await service[method](payload)
      const current = mountedRef.current &&
        generation === writeGenerationRef.current.get(key) &&
        contextGeneration === contextGenerationRef.current &&
        canUpdateSalaryRef.current
      if (!current) return
      setReopenReasons((reasons) => ({ ...reasons, [key]: '' }))
      await loadReport()
    } catch (error) {
      const current = mountedRef.current &&
        generation === writeGenerationRef.current.get(key) &&
        contextGeneration === contextGenerationRef.current &&
        canUpdateSalaryRef.current
      if (!current) return
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      setRowErrors((errors) => ({
        ...errors,
        [key]: safeError(error, mode === 'reopen'
          ? '重新打开月度工资失败，请稍后重试。'
          : mode === 'confirm'
            ? '月度工资确认失败，请检查待处理项目。'
            : '工资草稿保存失败，请稍后重试。'),
      }))
    } finally {
      const current = mountedRef.current &&
        generation === writeGenerationRef.current.get(key) &&
        contextGeneration === contextGenerationRef.current && canUpdateSalaryRef.current
      writeLockedRef.current.delete(key)
      if (current) {
        setWriteLocked((locks) => ({ ...locks, [key]: false }))
      }
    }
  }

  const permissions = report?.permissions || { canViewSalary: false, canUpdateSalary: false }
  const employees = report?.employees || []
  const filtersDisabled = !month || loadState.status === 'loading'
  const stale = Boolean(report) && loadState.status === 'error'
  const summaryCards = useMemo(() => report ? [
    ['应出勤人天', report.summary.scheduledAttendanceUnits],
    ['已确认人天', report.summary.confirmedAttendanceUnits],
    ['待处理人次', report.summary.pendingCount],
  ] : [], [report])
  const companyPersonnelCostTotal = useMemo(() => permissions.canViewSalary
    ? employees.reduce((total, employee) => total + employee.companyPersonnelCost, 0)
    : 0, [employees, permissions.canViewSalary])
  const outputBlocked = loadState.status !== 'success' ||
    report === null || permissions.canViewSalary !== true
  const selectedEmployee = employeeProfileId
    ? employeeOptions.find((employee) => employee.employeeProfileId === employeeProfileId)
    : null
  const employeeLabel = selectedEmployee
    ? `${selectedEmployee.employeeName} · ${selectedEmployee.employeeNumber}`
    : ''
  const payrollReport = useMemo(() => {
    if (loadState.status !== 'success' || report === null ||
        report.permissions.canViewSalary !== true) return null
    return createMonthlyPayrollReport({
      employees,
      summary: report.summary,
      month,
      department,
      employeeLabel,
      onlyPending,
      preparedBy: reportPreparedBy,
    })
  }, [
    department, employeeLabel, employees, loadState.status, month,
    onlyPending, report, reportPreparedBy,
  ])
  const reportContextIdentity = JSON.stringify({
    month,
    department,
    employeeProfileId,
    onlyPending,
    rows: employees.map((row) => `${row.employeeProfileId}:${row.version}`).join('|'),
    outputBlocked,
  })

  return (
    <div className="labor-report-tab labor-monthly-payroll-tab">
      <header className="labor-report-heading">
        <span>
          <small>按员工汇总 · 会计确认 · 月结锁定</small>
          <h2>月度工资</h2>
          <p>只使用服务器已核算的出勤结果，工资金额由授权会计保存并确认。</p>
        </span>
      </header>

      <div className="labor-report-filters" aria-label="月度工资筛选">
        <label>
          <span>工资月份</span>
          <input
            type="month"
            aria-label="工资月份"
            value={month || ''}
            onChange={(event) => changeMonth(event.target.value)}
          />
        </label>
        <label>
          <span>部门</span>
          <select
            aria-label="月度工资部门"
            value={department}
            disabled={filtersDisabled}
            onChange={(event) => changeDepartment(event.target.value)}
          >
            <option value="">全部部门</option>
            {departmentOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>
          <span>员工</span>
          <select
            aria-label="月度工资员工"
            value={employeeProfileId}
            disabled={filtersDisabled}
            onChange={(event) => changeEmployee(event.target.value)}
          >
            <option value="">全部员工</option>
            {employeeOptions.map((option) => (
              <option key={option.employeeProfileId} value={option.employeeProfileId}>
                {option.employeeName} · {option.employeeNumber}
              </option>
            ))}
          </select>
        </label>
        <label className="labor-checkbox-filter">
          <input
            type="checkbox"
            aria-label="月度工资只看待确认"
            checked={onlyPending}
            disabled={filtersDisabled}
            onChange={(event) => changeOnlyPending(event.target.checked)}
          />
          <span>只看待确认</span>
        </label>
      </div>

      <div className="labor-live-region" aria-live="polite" aria-atomic="true">
        {loadState.status === 'loading' && <span>正在加载月度工资…</span>}
        {loadState.status === 'error' && (
          <span role="alert">{stale ? '刷新失败，当前显示上次数据：' : ''}{loadState.error}</span>
        )}
      </div>
      {loadState.status === 'error' && (
        <button type="button" className="labor-retry-button" onClick={() => void loadReport()}>
          重新加载月度工资
        </button>
      )}

      {!month && (
        <div className="labor-empty-state" role="status">
          <strong>等待服务器工作日期</strong>
          <span>取得服务器东京日期后才会确定初始工资月份。</span>
        </div>
      )}

      {report && (
        <>
          {payrollReport && (
            <AccountingReportActions
              title="月度工资表"
              report={payrollReport}
              disabled={outputBlocked}
              contextIdentity={reportContextIdentity}
              {...reportActionDependencies}
            />
          )}
          <section className="labor-report-summary" aria-label="月度工资汇总">
            {summaryCards.map(([label, value]) => (
              <article key={label}><small>{label}</small><strong>{value}</strong></article>
            ))}
            {permissions.canViewSalary && (
              <>
                <article><small>工资预览总额</small><strong>{yen(report.summary.salaryPreviewTotal)}</strong></article>
                <article><small>已分摊项目成本</small><strong>{yen(report.summary.projectAllocatedTotal)}</strong></article>
                <article><small>未分摊项目成本</small><strong>{yen(report.summary.projectUnallocatedTotal)}</strong></article>
                <article><small>公司人员成本</small><strong>{yen(companyPersonnelCostTotal)}</strong></article>
              </>
            )}
          </section>

          {!permissions.canViewSalary && (
            <div className="labor-redacted-note" role="note">
              <strong>工资金额已按权限隐藏</strong>
              <span>仍可查看应出勤、已确认与待处理统计。</span>
            </div>
          )}
          <ReconciliationWarning reconciliation={report.reconciliation} />

          <section className="labor-report-table-card" aria-labelledby="monthly-payroll-employees">
            <header className="labor-section-heading">
              <span><h3 id="monthly-payroll-employees">员工工资明细</h3><small>{employees.length} 名员工</small></span>
            </header>
            {employees.length === 0 ? (
              <div className="labor-empty-state"><strong>没有符合条件的员工</strong></div>
            ) : (
              <>
                <div className="labor-report-desktop-table">
                  <table className="labor-report-table">
                    <thead><tr>
                      <th scope="col">员工 / 状态</th>
                      <th scope="col">确认出勤</th>
                      <th scope="col">异常参考</th>
                      <th scope="col">逐日考勤</th>
                      {permissions.canViewSalary && <th scope="col">工资与项目金额</th>}
                      {permissions.canViewSalary && <th scope="col">会计操作</th>}
                    </tr></thead>
                    <tbody>
                      {employees.map((row) => {
                        const key = employeeKey(row)
                        const rowDraft = drafts[key] || draftFromEmployee(row)
                        return (
                          <tr key={key}>
                            <th scope="row">
                              <strong>{row.employeeName}</strong>
                              <small>{row.employeeNumber} · {row.department || '部门未记录'} · {row.position || '职务未记录'}</small>
                              <AttendanceMethodBadge employee={row} />
                              <span className="labor-status-text" data-tone={row.status === 'confirmed' ? 'locked' : 'warning'}>
                                <span className="labor-status-dot" aria-hidden="true" />
                                {PAYROLL_STATUS_LABELS[row.status] || row.status}
                              </span>
                              {row.source === 'legacy' && <span className="labor-readonly-badge">历史人工记录</span>}
                            </th>
                            <td><PayrollCountFacts employee={row} /></td>
                            <td><PayrollIssueFacts employee={row} /></td>
                            <td>
                              <MonthCalendarAction
                                employee={row}
                                month={month}
                                disabled={loadState.status !== 'success'}
                                onOpen={openMonthCalendar}
                              />
                            </td>
                            {permissions.canViewSalary && <td><PayrollMoneyFacts employee={row} /></td>}
                            {permissions.canViewSalary && (
                              <td>
                                <PayrollActions
                                  employee={row}
                                  draft={rowDraft}
                                  canUpdateSalary={permissions.canUpdateSalary}
                                  reportCurrent={loadState.status === 'success'}
                                  locked={Boolean(writeLocked[key])}
                                  rowError={rowErrors[key] || ''}
                                  reopenReason={reopenReasons[key] || ''}
                                  variant="desktop"
                                  onDraftChange={(next) => updateDraft(row, next)}
                                  onReopenReasonChange={(reason) => setReopenReasons((current) => ({ ...current, [key]: reason }))}
                                  onSubmit={(mode) => void submit(mode, row)}
                                />
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="labor-payroll-mobile-cards">
                  {employees.map((row) => {
                    const key = employeeKey(row)
                    const rowDraft = drafts[key] || draftFromEmployee(row)
                    return (
                      <article key={key} className="labor-report-mobile-card">
                        <header>
                          <span><strong>{row.employeeName}</strong><small>{row.employeeNumber} · {row.department || '部门未记录'} · {row.position || '职务未记录'}</small></span>
                          <span className="labor-accounting-badge">{PAYROLL_STATUS_LABELS[row.status] || row.status}</span>
                        </header>
                        <AttendanceMethodBadge employee={row} />
                        {row.source === 'legacy' && <span className="labor-readonly-badge">历史人工记录</span>}
                        <PayrollCountFacts employee={row} />
                        <PayrollIssueFacts employee={row} />
                        <MonthCalendarAction
                          employee={row}
                          month={month}
                          disabled={loadState.status !== 'success'}
                          onOpen={openMonthCalendar}
                        />
                        {permissions.canViewSalary && <PayrollMoneyFacts employee={row} />}
                        {permissions.canViewSalary && (
                          <PayrollActions
                            employee={row}
                            draft={rowDraft}
                            canUpdateSalary={permissions.canUpdateSalary}
                            reportCurrent={loadState.status === 'success'}
                            locked={Boolean(writeLocked[key])}
                            rowError={rowErrors[key] || ''}
                            reopenReason={reopenReasons[key] || ''}
                            variant="mobile"
                            onDraftChange={(next) => updateDraft(row, next)}
                            onReopenReasonChange={(reason) => setReopenReasons((current) => ({ ...current, [key]: reason }))}
                            onSubmit={(mode) => void submit(mode, row)}
                          />
                        )}
                      </article>
                    )
                  })}
                </div>
              </>
            )}
          </section>
        </>
      )}
      {monthCalendar && (
        <EmployeeMonthCalendarDialog
          state={monthCalendar}
          onClose={closeMonthCalendar}
          onRetry={retryMonthCalendar}
          onOpenDailyDate={openDailyDateFromCalendar}
        />
      )}
    </div>
  )
}

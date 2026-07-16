import React from 'react'

export const ATTENDANCE_ISSUE_LABELS = Object.freeze({
  abnormal_location: '定位异常',
  missing_clock_in: '未打卡',
  missing_clock_out: '未下班',
  late: '迟到',
  early: '早退',
  overtime_pending: '加班待确认',
})

const DAY_STATUS_META = Object.freeze({
  unconfigured: ['未启用', 'muted'],
  before_activation: ['启用前日期', 'muted'],
  full_day: ['整天已确认', 'success'],
  half_day: ['半天已确认', 'success'],
  rest: ['休息', 'neutral'],
  leave: ['请假', 'neutral'],
  comp_time: ['调休', 'neutral'],
  absence: ['缺勤', 'danger'],
  optional_not_worked: ['非应出勤日', 'muted'],
  missing_clock_in: ['未打卡', 'danger'],
  not_started: ['尚未到上班时间', 'muted'],
  working: ['正在工作', 'working'],
  completed: ['已完成打卡', 'success'],
})

const ACCOUNTING_STATUS_META = Object.freeze({
  draft: ['草稿', 'warning'],
  confirmed: ['已确认', 'success'],
  month_locked: ['月结已锁定', 'locked'],
})

const TOKYO_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function formatTokyoTime(value) {
  if (typeof value !== 'string' || !value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return TOKYO_TIME_FORMATTER.format(date)
}

export function formatWorkedMinutes(value) {
  if (!Number.isSafeInteger(value) || value < 0) return '—'
  const hours = Math.floor(value / 60)
  const minutes = value % 60
  return minutes === 0 ? `${hours}小时` : `${hours}小时${minutes}分`
}

export function employeeProjectNames(employee) {
  const names = []
  const seen = new Set()
  for (const session of employee?.sessions || []) {
    const projectId = String(session?.projectId ?? '')
    if (!projectId || seen.has(projectId)) continue
    seen.add(projectId)
    names.push(String(session?.projectName || '未命名项目'))
  }
  return names
}

export function resolutionUnavailableReason(employee, dashboard) {
  if (!dashboard?.permissions?.canResolve) return '当前账号没有日结处理权限'
  if (dashboard?.settings?.configured !== true || employee?.dayStatus === 'unconfigured') {
    return '请先完成考勤设置并启用核算'
  }
  if (employee?.dayStatus === 'before_activation') return '启用日期之前不生成日结'
  if (employee?.resolution?.accountingStatus === 'month_locked') return '该日期已被月度工资锁定'
  return ''
}

function StatusText({ meta }) {
  const [label, tone] = meta || ['未知状态', 'muted']
  return (
    <span className="labor-status-text" data-tone={tone}>
      <span className="labor-status-dot" aria-hidden="true" />
      {label}
    </span>
  )
}

function IssueChips({ issueCodes }) {
  if (!Array.isArray(issueCodes) || issueCodes.length === 0) {
    return <span className="labor-muted-text">无异常</span>
  }
  return (
    <span className="labor-issue-chips" aria-label="考勤异常">
      {issueCodes.map((code) => (
        <span className="labor-issue-chip" key={code}>{ATTENDANCE_ISSUE_LABELS[code] || code}</span>
      ))}
    </span>
  )
}

function ProjectNames({ employee }) {
  const names = employeeProjectNames(employee)
  return names.length > 0 ? names.join('、') : <span className="labor-muted-text">未关联项目</span>
}

function ResolutionButton({ employee, dashboard, onOpenResolution }) {
  const reason = resolutionUnavailableReason(employee, dashboard)
  const label = employee?.resolution?.accountingStatus === 'confirmed' ? '查看或调整' : '处理日结'
  return (
    <button
      type="button"
      className="labor-row-action"
      disabled={Boolean(reason)}
      title={reason || `${label}：${employee.name}`}
      aria-label={`${label} ${employee.name}`}
      onClick={() => onOpenResolution?.(employee)}
    >
      {label}
    </button>
  )
}

function AccountingStatus({ resolution }) {
  if (!resolution) return <StatusText meta={['待核算', 'warning']} />
  return <StatusText meta={ACCOUNTING_STATUS_META[resolution.accountingStatus]} />
}

function EmployeeCard({ employee, dashboard, onOpenResolution }) {
  return (
    <article className="labor-employee-card" data-has-issues={employee.issueCodes.length > 0}>
      <header>
        <span>
          <strong>{employee.name}</strong>
          <small>{employee.employeeNumber} · {employee.department} · {employee.position}</small>
        </span>
        <StatusText meta={DAY_STATUS_META[employee.dayStatus]} />
      </header>
      <dl>
        <div><dt>今日项目</dt><dd><ProjectNames employee={employee} /></dd></div>
        <div><dt>上班</dt><dd>{formatTokyoTime(employee.firstClockInAt)}</dd></div>
        <div><dt>下班</dt><dd>{formatTokyoTime(employee.lastClockOutAt)}</dd></div>
        <div><dt>工时参考</dt><dd>{formatWorkedMinutes(employee.workedMinutesReference)}</dd></div>
        <div><dt>核算状态</dt><dd><AccountingStatus resolution={employee.resolution} /></dd></div>
        <div><dt>异常</dt><dd><IssueChips issueCodes={employee.issueCodes} /></dd></div>
      </dl>
      <ResolutionButton
        employee={employee}
        dashboard={dashboard}
        onOpenResolution={onOpenResolution}
      />
    </article>
  )
}

export default function AttendanceStatusTable({ employees = [], dashboard, onOpenResolution }) {
  if (employees.length === 0) {
    return (
      <div className="labor-empty-state" role="status">
        <strong>没有符合条件的员工</strong>
        <span>请调整部门、项目、状态或员工搜索条件。</span>
      </div>
    )
  }

  return (
    <div className="labor-status-table-wrap">
      <div className="labor-desktop-table">
        <table className="labor-status-table">
          <caption className="labor-visually-hidden">所有在职员工当天打卡与核算状态</caption>
          <thead>
            <tr>
              <th scope="col">员工</th>
              <th scope="col">今日项目</th>
              <th scope="col">上班</th>
              <th scope="col">下班</th>
              <th scope="col">工时参考</th>
              <th scope="col">打卡状态</th>
              <th scope="col">核算状态</th>
              <th scope="col">异常</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.employeeProfileId} data-has-issues={employee.issueCodes.length > 0}>
                <th scope="row">
                  <strong>{employee.name}</strong>
                  <small>{employee.employeeNumber} · {employee.department}</small>
                </th>
                <td><ProjectNames employee={employee} /></td>
                <td>{formatTokyoTime(employee.firstClockInAt)}</td>
                <td>{formatTokyoTime(employee.lastClockOutAt)}</td>
                <td>{formatWorkedMinutes(employee.workedMinutesReference)}</td>
                <td><StatusText meta={DAY_STATUS_META[employee.dayStatus]} /></td>
                <td><AccountingStatus resolution={employee.resolution} /></td>
                <td><IssueChips issueCodes={employee.issueCodes} /></td>
                <td>
                  <ResolutionButton
                    employee={employee}
                    dashboard={dashboard}
                    onOpenResolution={onOpenResolution}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="labor-mobile-cards">
        {employees.map((employee) => (
          <EmployeeCard
            key={employee.employeeProfileId}
            employee={employee}
            dashboard={dashboard}
            onOpenResolution={onOpenResolution}
          />
        ))}
      </div>
    </div>
  )
}

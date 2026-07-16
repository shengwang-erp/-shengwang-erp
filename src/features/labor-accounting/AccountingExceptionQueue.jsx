import React from 'react'

import {
  ATTENDANCE_ISSUE_LABELS,
  formatTokyoTime,
  resolutionActionMeta,
} from './AttendanceStatusTable.jsx'

const EXCEPTION_PRIORITY = Object.freeze([
  'missing_clock_in',
  'abnormal_location',
  'missing_clock_out',
  'late',
  'early',
  'overtime_pending',
])

export function buildAccountingExceptionQueue(employees = []) {
  return employees
    .filter((employee) => Array.isArray(employee?.issueCodes) && employee.issueCodes.length > 0)
    .map((employee, order) => ({
      employee,
      order,
      priority: Math.min(...employee.issueCodes.map((code) => {
        const index = EXCEPTION_PRIORITY.indexOf(code)
        return index === -1 ? EXCEPTION_PRIORITY.length : index
      })),
    }))
    .sort((left, right) => left.priority - right.priority || left.order - right.order)
    .map(({ employee }) => employee)
}

function ExceptionTime({ employee }) {
  if (employee.dayStatus === 'missing_clock_in') return '超过上班时间仍未打卡'
  if (employee.hasOpenSession) return `上班 ${formatTokyoTime(employee.firstClockInAt)} · 尚未下班`
  if (employee.firstClockInAt || employee.lastClockOutAt) {
    return `${formatTokyoTime(employee.firstClockInAt)}－${formatTokyoTime(employee.lastClockOutAt)}`
  }
  return '暂无有效打卡时间'
}

export default function AccountingExceptionQueue({
  employees = [],
  dashboard,
  onOpenResolution,
}) {
  const queuedEmployees = buildAccountingExceptionQueue(employees)

  return (
    <aside className="labor-exception-queue" aria-labelledby="labor-exception-title">
      <header className="labor-section-heading">
        <span>
          <small>会计持续提醒</small>
          <h2 id="labor-exception-title">异常待处理</h2>
        </span>
        <strong className="labor-alert-count" aria-label={`${queuedEmployees.length} 人待处理`}>
          {queuedEmployees.length}
        </strong>
      </header>

      {queuedEmployees.length === 0 ? (
        <div className="labor-queue-empty" role="status">
          <span aria-hidden="true">✓</span>
          <strong>今日暂无考勤异常</strong>
          <small>异常由服务器判定，刷新或换设备不会被清除。</small>
        </div>
      ) : (
        <ol className="labor-exception-list">
          {queuedEmployees.map((employee) => {
            const action = resolutionActionMeta(employee, dashboard)
            return (
              <li key={employee.employeeProfileId}>
                <button
                  type="button"
                  disabled={!action.openable}
                  title={action.editable
                    ? `处理 ${employee.name} 的考勤异常`
                    : action.title}
                  aria-label={`${action.openable ? '查看' : '尚不可查看'} ${employee.name}：${employee.issueCodes.map((code) =>
                    ATTENDANCE_ISSUE_LABELS[code] || code).join('、')}`}
                  onClick={() => onOpenResolution?.(employee)}
                >
                  <span className="labor-queue-person">
                    <strong>{employee.name}</strong>
                    <small>{employee.employeeNumber} · {employee.department}</small>
                  </span>
                  <span className="labor-issue-chips">
                    {employee.issueCodes.map((code) => (
                      <span className="labor-issue-chip" key={code}>
                        {ATTENDANCE_ISSUE_LABELS[code] || code}
                      </span>
                    ))}
                  </span>
                  <span className="labor-queue-time"><ExceptionTime employee={employee} /></span>
                  <span className="labor-queue-action">
                    {!action.openable ? '尚不可查看' : action.editable ? '立即处理' : '查看事实'}{' '}
                    <span aria-hidden="true">→</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </aside>
  )
}

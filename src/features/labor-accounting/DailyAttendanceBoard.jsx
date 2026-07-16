import React from 'react'

import AccountingExceptionQueue from './AccountingExceptionQueue.jsx'
import AttendanceStatusTable from './AttendanceStatusTable.jsx'

const DAY_STATUS_FILTER_LABELS = Object.freeze({
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
  not_started: '尚未开始',
  working: '正在工作',
  completed: '已完成打卡',
})

const SUMMARY_CARDS = Object.freeze([
  ['requiredEmployees', '今日应出勤', '按已启用的服务器班次规则', 'required'],
  ['normalCompleted', '正常完成', '打卡完成且没有异常', 'success'],
  ['working', '正在工作', '已有上班记录、尚未下班', 'working'],
  ['excused', '休息 / 请假 / 调休', '已登记的非出勤结论', 'neutral'],
  ['alertCount', '异常待处理', '确认前会持续提醒会计', 'danger'],
])

export const EMPTY_DAILY_FILTERS = Object.freeze({
  department: '',
  projectId: '',
  dayStatus: '',
  employeeSearch: '',
  onlyPending: false,
})

function normalizedSearch(value) {
  return String(value ?? '').trim().toLocaleLowerCase('zh-CN')
}

export function employeeNeedsAccounting(employee) {
  const status = employee?.resolution?.accountingStatus
  return (Array.isArray(employee?.issueCodes) && employee.issueCodes.length > 0) ||
    status === 'draft' || (!employee?.resolution && employee?.dayStatus !== 'optional_not_worked')
}

export function filterDailyEmployees(employees = [], filters = EMPTY_DAILY_FILTERS) {
  const search = normalizedSearch(filters.employeeSearch)
  return employees.filter((employee) => {
    if (filters.department && employee.department !== filters.department) return false
    if (filters.projectId && !employee.sessions.some(
      (session) => session.projectId === filters.projectId,
    )) return false
    if (filters.dayStatus && employee.dayStatus !== filters.dayStatus) return false
    if (filters.onlyPending && !employeeNeedsAccounting(employee)) return false
    if (search) {
      const haystack = normalizedSearch([
        employee.name,
        employee.employeeNumber,
        employee.department,
        employee.position,
      ].join(' '))
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

export function addIsoDateDays(isoDate, amount) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(isoDate ?? ''))
  if (!match || !Number.isInteger(amount)) return isoDate
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function updateFilter(filters, onFiltersChange, key, value) {
  onFiltersChange?.({ ...EMPTY_DAILY_FILTERS, ...filters, [key]: value })
}

function SummaryCards({ summary }) {
  return (
    <section className="labor-summary-grid" aria-label="当天考勤汇总">
      {SUMMARY_CARDS.map(([key, label, description, tone]) => (
        <article className="labor-summary-card" data-tone={tone} key={key}>
          <span className="labor-status-dot" aria-hidden="true" />
          <div>
            <small>{label}</small>
            <strong>{summary[key]}</strong>
            <span>{description}</span>
          </div>
        </article>
      ))}
    </section>
  )
}

function DailyFilters({ dashboard, filters, onFiltersChange }) {
  return (
    <div className="labor-daily-filters" aria-label="员工状态筛选">
      <label>
        <span>部门</span>
        <select
          aria-label="按部门筛选"
          value={filters.department}
          onChange={(event) => updateFilter(filters, onFiltersChange, 'department', event.target.value)}
        >
          <option value="">全部部门</option>
          {dashboard.filters.departments.map((department) => (
            <option value={department} key={department}>{department}</option>
          ))}
        </select>
      </label>

      <label>
        <span>项目</span>
        <select
          aria-label="按项目筛选"
          value={filters.projectId}
          onChange={(event) => updateFilter(filters, onFiltersChange, 'projectId', event.target.value)}
        >
          <option value="">全部项目</option>
          {dashboard.filters.projects.map((project) => (
            <option value={project.projectId} key={project.projectId}>{project.projectName}</option>
          ))}
        </select>
      </label>

      <label>
        <span>状态</span>
        <select
          aria-label="按打卡状态筛选"
          value={filters.dayStatus}
          onChange={(event) => updateFilter(filters, onFiltersChange, 'dayStatus', event.target.value)}
        >
          <option value="">全部状态</option>
          {dashboard.filters.dayStatuses.map((status) => (
            <option value={status} key={status}>{DAY_STATUS_FILTER_LABELS[status] || status}</option>
          ))}
        </select>
      </label>

      <label className="labor-search-filter">
        <span>员工搜索</span>
        <input
          type="search"
          aria-label="搜索员工姓名或编号"
          value={filters.employeeSearch}
          placeholder="姓名、员工编号、部门"
          onChange={(event) => updateFilter(
            filters, onFiltersChange, 'employeeSearch', event.target.value,
          )}
        />
      </label>

      <label className="labor-checkbox-filter">
        <input
          type="checkbox"
          aria-label="只看待处理员工"
          checked={filters.onlyPending}
          onChange={(event) => updateFilter(
            filters, onFiltersChange, 'onlyPending', event.target.checked,
          )}
        />
        <span>只看待处理</span>
      </label>
    </div>
  )
}

export default function DailyAttendanceBoard({
  dashboard,
  filters = EMPTY_DAILY_FILTERS,
  onFiltersChange,
  onDateChange,
  onOpenResolution,
}) {
  const normalizedFilters = { ...EMPTY_DAILY_FILTERS, ...filters }
  const visibleEmployees = filterDailyEmployees(dashboard.employees, normalizedFilters)

  return (
    <section className="labor-daily-board" aria-labelledby="labor-daily-title">
      <header className="labor-board-toolbar">
        <span>
          <small>所有在职员工 · 东京时间</small>
          <h2 id="labor-daily-title">每日打卡状态看板</h2>
        </span>
        <div className="labor-date-navigation">
          <button
            type="button"
            aria-label="查看前一天"
            onClick={() => onDateChange?.(addIsoDateDays(dashboard.workDate, -1))}
          >
            <span aria-hidden="true">‹</span> 前一天
          </button>
          <label>
            <span className="labor-visually-hidden">工作日期</span>
            <input
              type="date"
              aria-label="工作日期"
              value={dashboard.workDate}
              onChange={(event) => onDateChange?.(event.target.value)}
            />
          </label>
          <button
            type="button"
            aria-label="查看后一天"
            onClick={() => onDateChange?.(addIsoDateDays(dashboard.workDate, 1))}
          >
            后一天 <span aria-hidden="true">›</span>
          </button>
        </div>
      </header>

      {dashboard.settings.configured !== true && (
        <div className="labor-configuration-notice" role="status">
          <strong>考勤核算尚未启用</strong>
          <span>当前仅预览默认班次；保存启用日期后才会生成未打卡提醒。</span>
        </div>
      )}

      <SummaryCards summary={dashboard.summary} />
      <DailyFilters
        dashboard={dashboard}
        filters={normalizedFilters}
        onFiltersChange={onFiltersChange}
      />

      <div className="labor-daily-layout">
        <AccountingExceptionQueue
          employees={dashboard.employees}
          dashboard={dashboard}
          onOpenResolution={onOpenResolution}
        />
        <section className="labor-all-employees" aria-labelledby="labor-all-employees-title">
          <header className="labor-section-heading">
            <span>
              <small>当前筛选 {visibleEmployees.length} / {dashboard.summary.totalEmployees} 人</small>
              <h2 id="labor-all-employees-title">所有在职员工</h2>
            </span>
          </header>
          <AttendanceStatusTable
            employees={visibleEmployees}
            dashboard={dashboard}
            onOpenResolution={onOpenResolution}
          />
        </section>
      </div>
    </section>
  )
}

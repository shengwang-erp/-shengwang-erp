import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildProjectLaborCsv } from './laborAccountingDomain.js'

const PROJECT_STATUSES = new Set(['all', 'confirmed', 'pending'])
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u

function safeError(error, fallback) {
  return typeof error?.userMessage === 'string' && error.userMessage.trim()
    ? error.userMessage
    : fallback
}

function yen(value) {
  return `¥${Number(value ?? 0).toLocaleString('ja-JP')}`
}

function nullableSelection(value) {
  return typeof value === 'string' && value ? value : null
}

export function buildProjectReportRequest({ month, filters }) {
  if (!MONTH_PATTERN.test(String(month ?? '')) || !PROJECT_STATUSES.has(filters?.status)) return null
  return {
    month,
    projectId: nullableSelection(filters?.projectId),
    employeeProfileId: nullableSelection(filters?.employeeProfileId),
    status: filters.status,
  }
}

export function buildProjectExportRequest({ month, filters }) {
  if (!MONTH_PATTERN.test(String(month ?? ''))) return null
  return {
    month,
    projectId: nullableSelection(filters?.projectId),
    employeeProfileId: nullableSelection(filters?.employeeProfileId),
  }
}

export function downloadProjectLaborCsv(csv, month, runtime) {
  const browser = runtime || {
    Blob: globalThis.Blob,
    document: globalThis.document,
    URL: globalThis.URL,
  }
  const blob = new browser.Blob([csv], { type: 'text/csv;charset=utf-8' })
  const objectUrl = browser.URL.createObjectURL(blob)
  let anchor = null
  try {
    anchor = browser.document.createElement('a')
    anchor.href = objectUrl
    anchor.download = `项目用工费用-${month}.csv`
    browser.document.body.appendChild(anchor)
    anchor.click()
  } finally {
    try {
      anchor?.remove()
    } finally {
      browser.URL.revokeObjectURL(objectUrl)
    }
  }
}

function reportOptions(report) {
  const projects = []
  const seenProjects = new Set()
  for (const row of report?.projectComparison || []) {
    if (seenProjects.has(row.projectId)) continue
    seenProjects.add(row.projectId)
    projects.push({ projectId: row.projectId, projectName: row.projectName })
  }
  const employees = []
  const seenEmployees = new Set()
  for (const row of report?.employeeComposition || []) {
    if (!row.employeeProfileId || seenEmployees.has(row.employeeProfileId)) continue
    seenEmployees.add(row.employeeProfileId)
    employees.push({
      employeeProfileId: row.employeeProfileId,
      employeeNumber: row.employeeNumber,
      employeeName: row.employeeName,
    })
  }
  return { projects, employees }
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

function sourceLabel(row) {
  return row.source === 'legacy' ? '历史人工记录' : '新考勤核算'
}

function accountingStatusLabel(status) {
  return {
    legacy: '历史已入账',
    confirmed: '日结已确认',
    month_locked: '月结已锁定',
    draft: '待确认',
  }[status] || status
}

function TrendChart({ rows }) {
  const maximum = Math.max(1, ...rows.map((row) => row.amount))
  return (
    <div className="labor-trend-chart" role="img" aria-label="最近六个月项目用工费用趋势">
      {rows.map((row) => (
        <div key={row.salaryMonth}>
          <span>{row.salaryMonth}</span>
          <i aria-hidden="true"><b style={{ width: `${(row.amount / maximum) * 100}%` }} /></i>
          <strong>{yen(row.amount)}</strong>
        </div>
      ))}
    </div>
  )
}

export default function ProjectLaborCostTab({
  service,
  month,
  onMonthChange,
  onAuthInvalid,
  initialReport = null,
}) {
  const [projectId, setProjectId] = useState('')
  const [employeeProfileId, setEmployeeProfileId] = useState('')
  const [status, setStatus] = useState('all')
  const [report, setReport] = useState(initialReport)
  const [loadState, setLoadState] = useState({
    status: initialReport ? 'success' : 'idle', error: '',
  })
  const [exportState, setExportState] = useState({ status: 'idle', error: '' })
  const [filterEpoch, setFilterEpoch] = useState(0)
  const initialOptions = reportOptions(initialReport)
  const [projectOptions, setProjectOptions] = useState(initialOptions.projects)
  const [employeeOptions, setEmployeeOptions] = useState(initialOptions.employees)

  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const contextGenerationRef = useRef(0)
  const exportGenerationRef = useRef(0)
  const exportLockedRef = useRef(false)
  const optionCacheRef = useRef({ month, ...initialOptions })
  const canViewSalaryRef = useRef(initialReport?.permissions?.canViewSalary === true)
  const reportCurrentRef = useRef(Boolean(initialReport))
  canViewSalaryRef.current = report?.permissions?.canViewSalary === true

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      contextGenerationRef.current += 1
      exportGenerationRef.current += 1
      exportLockedRef.current = false
    }
  }, [])

  useEffect(() => {
    contextGenerationRef.current += 1
    exportGenerationRef.current += 1
    exportLockedRef.current = false
    setExportState({ status: 'idle', error: '' })
  }, [month, projectId, employeeProfileId])

  const loadReport = useCallback(async () => {
    if (!month) return { status: 'invalid' }
    const generation = ++loadGenerationRef.current
    reportCurrentRef.current = false
    setLoadState((current) => ({ ...current, status: 'loading', error: '' }))
    try {
      const request = buildProjectReportRequest({
        month,
        filters: { projectId, employeeProfileId, status },
      })
      if (!request) throw new Error('invalid project report request')
      const value = await service.listProjectLaborCosts(request)
      const current = mountedRef.current && generation === loadGenerationRef.current
      if (!current) return { status: 'stale' }
      if (!value.permissions.canViewSalary) {
        exportGenerationRef.current += 1
        exportLockedRef.current = false
        setExportState({ status: 'idle', error: '' })
      }
      canViewSalaryRef.current = value.permissions.canViewSalary
      reportCurrentRef.current = true
      setReport(value)
      setLoadState({ status: 'success', error: '' })
      const options = reportOptions(value)
      if (!projectId && !employeeProfileId) {
        optionCacheRef.current = { month, ...options }
        setProjectOptions(options.projects)
        if (value.permissions.canViewSalary) setEmployeeOptions(options.employees)
      }
      if (!value.permissions.canViewSalary && employeeProfileId) setEmployeeProfileId('')
      return { status: 'success', value }
    } catch (error) {
      const current = mountedRef.current && generation === loadGenerationRef.current
      if (!current) return { status: 'stale' }
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      reportCurrentRef.current = false
      setLoadState({
        status: 'error',
        error: safeError(error, '项目用工费用加载失败，请稍后重试。'),
      })
      return { status: 'error' }
    }
  }, [employeeProfileId, month, onAuthInvalid, projectId, service, status])

  useEffect(() => {
    if (optionCacheRef.current.month !== month) {
      optionCacheRef.current = { month, projects: [], employees: [] }
      loadGenerationRef.current += 1
      contextGenerationRef.current += 1
      reportCurrentRef.current = false
      exportGenerationRef.current += 1
      exportLockedRef.current = false
      setReport(null)
      setLoadState({ status: 'idle', error: '' })
      setExportState({ status: 'idle', error: '' })
      setProjectOptions([])
      setEmployeeOptions([])
      setProjectId('')
      setEmployeeProfileId('')
      setStatus('all')
      setFilterEpoch((current) => current + 1)
      return
    }
    if (month) void loadReport()
  }, [filterEpoch, loadReport, month])

  const changeMonth = (nextMonth) => {
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    exportGenerationRef.current += 1
    exportLockedRef.current = false
    onMonthChange?.(nextMonth)
  }

  const changeProject = (value) => {
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    exportGenerationRef.current += 1
    exportLockedRef.current = false
    setProjectId(value)
  }

  const changeEmployee = (value) => {
    loadGenerationRef.current += 1
    contextGenerationRef.current += 1
    reportCurrentRef.current = false
    exportGenerationRef.current += 1
    exportLockedRef.current = false
    setEmployeeProfileId(value)
  }

  const changeStatus = (value) => {
    loadGenerationRef.current += 1
    reportCurrentRef.current = false
    setStatus(value)
  }

  const canViewSalary = report?.permissions?.canViewSalary === true
  useEffect(() => {
    if (canViewSalary) return
    exportGenerationRef.current += 1
    exportLockedRef.current = false
    setExportState({ status: 'idle', error: '' })
    if (employeeProfileId) setEmployeeProfileId('')
  }, [canViewSalary, employeeProfileId])

  const exportCsv = async () => {
    if (!canViewSalaryRef.current || !reportCurrentRef.current ||
        exportLockedRef.current || !month) return
    exportLockedRef.current = true
    const generation = ++exportGenerationRef.current
    const contextGeneration = contextGenerationRef.current
    setExportState({ status: 'loading', error: '' })
    try {
      const request = buildProjectExportRequest({
        month,
        filters: { projectId, employeeProfileId },
      })
      if (!request) throw new Error('invalid project export request')
      const rows = await service.exportProjectLaborCosts(request)
      const current = mountedRef.current && generation === exportGenerationRef.current &&
        contextGeneration === contextGenerationRef.current && canViewSalaryRef.current
      if (!current) return
      downloadProjectLaborCsv(buildProjectLaborCsv(rows), month)
      if (mountedRef.current && generation === exportGenerationRef.current) {
        setExportState({ status: 'success', error: '' })
      }
    } catch (error) {
      const current = mountedRef.current && generation === exportGenerationRef.current &&
        contextGeneration === contextGenerationRef.current && canViewSalaryRef.current
      if (!current) return
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      setExportState({
        status: 'error',
        error: safeError(error, 'CSV 导出失败，请单独重试。'),
      })
    } finally {
      if (mountedRef.current && generation === exportGenerationRef.current) {
        exportLockedRef.current = false
        setExportState((current) => current.status === 'loading'
          ? { status: 'idle', error: '' }
          : current)
      }
    }
  }

  const maximumComparison = useMemo(() => Math.max(
    1,
    ...(report?.projectComparison || []).map((row) => row.monthlyConfirmedCost),
  ), [report])
  const stale = Boolean(report) && loadState.status === 'error'
  const filtersDisabled = !month || loadState.status === 'loading'

  return (
    <div className="labor-report-tab labor-project-cost-tab">
      <header className="labor-report-heading">
        <span>
          <small>正式分摊 · 月度查询 · 项目累计</small>
          <h2>项目用工费用</h2>
          <p>确认状态只筛选每日明细，不会改写正式汇总、趋势、员工构成或项目对比。</p>
        </span>
        {canViewSalary && (
          <button
            type="button"
            className="labor-primary-action"
            disabled={exportState.status === 'loading' || loadState.status !== 'success' || !month}
            onClick={() => void exportCsv()}
          >
            {exportState.status === 'loading' ? '正在导出…' : '导出项目用工明细'}
          </button>
        )}
      </header>

      <div className="labor-report-filters" aria-label="项目用工费用筛选">
        <label>
          <span>费用月份</span>
          <input
            type="month"
            aria-label="项目用工费用月份"
            value={month || ''}
            onChange={(event) => changeMonth(event.target.value)}
          />
        </label>
        <label>
          <span>项目</span>
          <select
            aria-label="项目筛选"
            value={projectId}
            disabled={filtersDisabled}
            onChange={(event) => changeProject(event.target.value)}
          >
            <option value="">全部项目</option>
            {projectOptions.map((project) => (
              <option key={project.projectId} value={project.projectId}>{project.projectName}</option>
            ))}
          </select>
        </label>
        {canViewSalary && (
          <label>
            <span>员工筛选</span>
            <select
              aria-label="项目费用员工筛选"
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
        )}
        <label>
          <span>每日明细状态</span>
          <select
            aria-label="项目费用确认状态"
            value={status}
            disabled={filtersDisabled}
            onChange={(event) => changeStatus(event.target.value)}
          >
            <option value="all">全部</option>
            <option value="confirmed">已确认</option>
            <option value="pending">待确认</option>
          </select>
        </label>
      </div>

      <div className="labor-live-region" aria-live="polite" aria-atomic="true">
        {loadState.status === 'loading' && <span>正在加载项目用工费用…</span>}
        {loadState.status === 'error' && (
          <span role="alert">{stale ? '刷新失败，当前显示上次数据：' : ''}{loadState.error}</span>
        )}
      </div>
      {loadState.status === 'error' && (
        <button type="button" className="labor-retry-button" onClick={() => void loadReport()}>
          重新加载项目费用
        </button>
      )}
      {canViewSalary && (
        <div className="labor-export-status" aria-live="polite" aria-atomic="true">
          {exportState.status === 'success' && <span>CSV 已生成。</span>}
          {exportState.status === 'error' && <span role="alert">{exportState.error}</span>}
        </div>
      )}

      {!month && (
        <div className="labor-empty-state" role="status">
          <strong>等待服务器工作日期</strong>
          <span>取得服务器东京日期后才会确定初始费用月份。</span>
        </div>
      )}

      {report && (
        <>
          <section className="labor-project-summary" aria-label="项目费用正式汇总">
            <article><small>指定月份已确认用工费用</small><strong>{yen(report.summary.monthlyConfirmedCost)}</strong></article>
            <article><small>项目开工至今累计</small><strong>{yen(report.summary.lifetimeConfirmedCost)}</strong></article>
            <article><small>本月确认人天</small><strong>{report.summary.confirmedAttendanceUnits}</strong></article>
            <article data-tone={report.summary.pendingAllocationCount > 0 ? 'danger' : 'success'}>
              <small>待确认分摊</small>
              <strong>{report.summary.pendingAllocationCount} 笔</strong>
              <span>{yen(report.summary.pendingAllocationAmount)}</span>
            </article>
          </section>
          <ReconciliationWarning reconciliation={report.reconciliation} />

          <div className="labor-project-analytics">
            <section className="labor-report-card" aria-labelledby="project-trend-title">
              <header className="labor-section-heading"><span><h3 id="project-trend-title">最近六个月费用趋势</h3><small>正式已确认金额</small></span></header>
              <TrendChart rows={report.trend} />
            </section>

            {canViewSalary && (
              <section className="labor-report-card" aria-labelledby="employee-composition-title">
                <header className="labor-section-heading"><span><h3 id="employee-composition-title">员工费用构成</h3><small>当前筛选范围</small></span></header>
                <div className="labor-composition-list">
                  {report.employeeComposition.length === 0 ? <p>暂无员工费用构成</p> : report.employeeComposition.map((row) => (
                    <article key={row.employeeProfileId || `${row.employeeNumber}:${row.employeeName}`}>
                      <span><strong>{row.employeeName || '历史员工'}</strong><small>{row.employeeNumber || '编号未记录'} · {row.attendanceUnits} 人天</small></span>
                      <strong>{yen(row.amount)}</strong>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </div>

          {canViewSalary && (
            <section className="labor-report-table-card" aria-labelledby="project-daily-details-title">
              <header className="labor-section-heading"><span><h3 id="project-daily-details-title">每日分摊明细</h3><small>状态筛选只作用于本表</small></span></header>
              {report.dailyDetails.length === 0 ? (
                <div className="labor-empty-state"><strong>没有符合状态的每日明细</strong></div>
              ) : (
                <>
                  <div className="labor-report-desktop-table">
                    <table className="labor-report-table">
                      <thead><tr>
                        <th scope="col">日期</th><th scope="col">项目</th><th scope="col">员工</th>
                        <th scope="col">人天</th><th scope="col">金额</th><th scope="col">来源 / 状态</th>
                      </tr></thead>
                      <tbody>{report.dailyDetails.map((row) => (
                        <tr key={`${row.source}:${row.sourceKey}`}>
                          <td>{row.workDate}</td>
                          <td>{row.projectName}</td>
                          <td>{row.employeeName || '历史员工'}<small>{row.employeeNumber}</small></td>
                          <td>{row.attendanceUnits}</td>
                          <td>{yen(row.amount)}</td>
                          <td><strong>{sourceLabel(row)}</strong><small>{accountingStatusLabel(row.accountingStatus)}</small></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div className="labor-project-mobile-cards">
                    {report.dailyDetails.map((row) => (
                      <article className="labor-report-mobile-card" key={`${row.source}:${row.sourceKey}`}>
                        <header><span><strong>{row.projectName}</strong><small>{row.workDate}</small></span><strong>{yen(row.amount)}</strong></header>
                        <dl>
                          <div><dt>员工</dt><dd>{row.employeeName || '历史员工'} · {row.employeeNumber}</dd></div>
                          <div><dt>确认人天</dt><dd>{row.attendanceUnits}</dd></div>
                          <div><dt>来源</dt><dd>{sourceLabel(row)}</dd></div>
                          <div><dt>状态</dt><dd>{accountingStatusLabel(row.accountingStatus)}</dd></div>
                        </dl>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}

          <section className="labor-report-card" aria-labelledby="project-comparison-title">
            <header className="labor-section-heading"><span><h3 id="project-comparison-title">全部项目费用对比</h3><small>本月与开工至今正式费用</small></span></header>
            <div className="labor-project-comparison">
              {report.projectComparison.length === 0 ? <p>暂无项目费用</p> : report.projectComparison.map((row) => (
                <article key={row.projectId}>
                  <span><strong>{row.projectName}</strong><small>累计 {yen(row.lifetimeConfirmedCost)}</small></span>
                  <i aria-hidden="true"><b style={{ width: `${(row.monthlyConfirmedCost / maximumComparison) * 100}%` }} /></i>
                  <strong>{yen(row.monthlyConfirmedCost)}</strong>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

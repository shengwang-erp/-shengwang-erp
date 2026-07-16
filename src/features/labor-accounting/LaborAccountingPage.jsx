import React, { useCallback, useEffect, useRef, useState } from 'react'

import { laborAccountingService } from '../../services/laborAccountingService.js'
import AttendanceResolutionDialog, {
  useLaborModalFocus,
} from './AttendanceResolutionDialog.jsx'
import AttendanceAccountingSettings from './AttendanceAccountingSettings.jsx'
import DailyAttendanceBoard, { EMPTY_DAILY_FILTERS } from './DailyAttendanceBoard.jsx'
import MonthlyPayrollTab from './MonthlyPayrollTab.jsx'
import ProjectLaborCostTab from './ProjectLaborCostTab.jsx'
import './laborAccounting.css'

const LABOR_TABS = Object.freeze([
  { id: 'daily', label: '今日看板' },
  { id: 'monthly', label: '月度工资' },
  { id: 'project', label: '项目用工费用', requiresProjectCosts: true },
  { id: 'settings', label: '考勤设置' },
])

export function laborTabsForPermissions(permissions = {}) {
  return LABOR_TABS.filter((tab) =>
    !tab.requiresProjectCosts || permissions.canViewProjectCosts === true)
}

export function monthFromServerWorkDate(workDate) {
  return /^\d{4}-(?:0[1-9]|1[0-2])-\d{2}$/u.test(String(workDate ?? ''))
    ? workDate.slice(0, 7)
    : ''
}

export function handleLaborTabKeyDown({
  event,
  tabs,
  activeTabId,
  onSelect,
  focusTab,
}) {
  if (!Array.isArray(tabs) || tabs.length === 0) return false
  const currentIndex = tabs.findIndex((tab) => tab.id === activeTabId)
  if (currentIndex < 0) return false
  let targetIndex
  if (event?.key === 'ArrowRight') targetIndex = (currentIndex + 1) % tabs.length
  else if (event?.key === 'ArrowLeft') targetIndex = (currentIndex - 1 + tabs.length) % tabs.length
  else if (event?.key === 'Home') targetIndex = 0
  else if (event?.key === 'End') targetIndex = tabs.length - 1
  else return false
  const targetId = tabs[targetIndex].id
  event.preventDefault()
  onSelect?.(targetId)
  focusTab?.(targetId)
  return true
}

function displayError(error, fallback) {
  return typeof error?.userMessage === 'string' && error.userMessage.trim()
    ? error.userMessage
    : fallback
}

function forwardAuthInvalid(error, onAuthInvalid) {
  if (error?.authInvalid === true) onAuthInvalid?.(error)
}

export async function executeLaborPageRequest({ request }) {
  try {
    return { ok: true, value: await request() }
  } catch (error) {
    return { ok: false, error }
  }
}

export function settleLaborPageRequest({ result, current, onAuthInvalid }) {
  if (!current) return { status: 'stale' }
  if (!result.ok) {
    forwardAuthInvalid(result.error, onAuthInvalid)
    return { status: 'error', error: result.error }
  }
  return { status: 'success', value: result.value }
}

function notifyAlertCountChange(onAlertCountChange) {
  try {
    const result = onAlertCountChange?.()
    if (result && typeof result.catch === 'function') void result.catch(() => {})
  } catch {
    // The daily workflow is already saved; a parent badge refresh cannot undo it.
  }
}

export function dailyDashboardPresentationState(loadState, dashboard) {
  const showDashboard = Boolean(dashboard)
  const stale = showDashboard && ['loading', 'error'].includes(loadState?.status)
  return {
    showDashboard,
    stale,
    error: loadState?.status === 'error' ? String(loadState.error || '') : '',
  }
}

export function DashboardLoadNotice({ loadState, dashboard, onRetry }) {
  const presentation = dailyDashboardPresentationState(loadState, dashboard)
  if (!presentation.stale) return null
  const failed = loadState.status === 'error'
  return (
    <div className="labor-stale-warning" role={failed ? 'alert' : 'status'}>
      <span>
        <strong>{failed
          ? '看板刷新失败，当前数据可能已过期'
          : '正在刷新，当前仍显示上次数据'}</strong>
        <small>{failed
          ? presentation.error
          : '刷新成功后会自动替换，并清除此提示。'}</small>
      </span>
      {failed && (
        <button type="button" onClick={() => onRetry?.()}>重新加载</button>
      )}
    </div>
  )
}

export function DetailLoadingDialog({ selectedEmployee, detailLoadState, onClose }) {
  const dialogRef = useRef(null)
  useLaborModalFocus(dialogRef, { onClose, saving: false })
  const failed = detailLoadState.status === 'error'
  return (
    <div className="labor-dialog-backdrop">
      <section
        ref={dialogRef}
        className="labor-detail-loading-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`${selectedEmployee.employeeName}考勤详情`}
        tabIndex="-1"
      >
        {failed ? (
          <>
            <strong>考勤详情加载失败</strong>
            <p role="alert">{detailLoadState.error}</p>
          </>
        ) : (
          <p role="status">正在加载 {selectedEmployee.employeeName} 的原始打卡事实…</p>
        )}
        <button
          type="button"
          data-dialog-initial-focus
          onClick={() => onClose?.()}
        >
          {failed ? '关闭' : '取消查看'}
        </button>
      </section>
    </div>
  )
}

export default function LaborAccountingPage({
  service = laborAccountingService,
  initialWorkDate = '',
  onAuthInvalid,
  onAlertCountChange,
  onBack,
}) {
  const [activeTab, setActiveTab] = useState('daily')
  const [workDate, setWorkDate] = useState(initialWorkDate)
  const [dashboard, setDashboard] = useState(null)
  const [loadState, setLoadState] = useState({
    status: initialWorkDate ? 'idle' : 'loading',
    error: '',
  })
  const [filters, setFilters] = useState(EMPTY_DAILY_FILTERS)
  const [selectedEmployee, setSelectedEmployee] = useState(null)
  const [resolutionDetail, setResolutionDetail] = useState(null)
  const [detailLoadState, setDetailLoadState] = useState({ status: 'idle', error: '' })
  const [saving, setSaving] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [accountingMonth, setAccountingMonth] = useState('')

  const mountedRef = useRef(true)
  const monthInitializedRef = useRef(false)
  const tabButtonRefs = useRef(new Map())
  const initializationGenerationRef = useRef(0)
  const dashboardGenerationRef = useRef(0)
  const detailGenerationRef = useRef(0)
  const writeGenerationRef = useRef(0)
  const writeLockedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      initializationGenerationRef.current += 1
      dashboardGenerationRef.current += 1
      detailGenerationRef.current += 1
      writeGenerationRef.current += 1
      writeLockedRef.current = false
    }
  }, [])

  const initializeServerWorkDate = useCallback(async () => {
    const generation = ++initializationGenerationRef.current
    setLoadState({ status: 'loading', error: '' })
    const result = await executeLaborPageRequest({
      request: () => service.getAlertCount(),
    })
    const settled = settleLaborPageRequest({
      result,
      current: mountedRef.current && generation === initializationGenerationRef.current,
      onAuthInvalid,
    })
    if (settled.status === 'stale') return settled
    if (settled.status === 'error') {
      setLoadState({
        status: 'error',
        error: displayError(
          settled.error, '无法取得服务器东京日期，请重试或手动选择日期。',
        ),
      })
      return { status: 'error' }
    }
    setWorkDate(settled.value.workDate)
    return { status: 'accepted', workDate: settled.value.workDate }
  }, [onAuthInvalid, service])

  const loadDashboard = useCallback(async (date) => {
    if (!date) return { status: 'invalid' }
    const generation = ++dashboardGenerationRef.current
    setLoadState({ status: 'loading', error: '' })
    const result = await executeLaborPageRequest({
      request: () => service.listDailyDashboard({ workDate: date }),
    })
    const settled = settleLaborPageRequest({
      result,
      current: mountedRef.current && generation === dashboardGenerationRef.current,
      onAuthInvalid,
    })
    if (settled.status === 'stale') return settled
    if (settled.status === 'error') {
      setLoadState({
        status: 'error',
        error: displayError(settled.error, '当天考勤看板加载失败，请稍后重试。'),
      })
      return { status: 'error' }
    }
    const nextDashboard = settled.value
    setDashboard(nextDashboard)
    setLoadState({ status: 'success', error: '' })
    const serverMonth = monthFromServerWorkDate(nextDashboard.workDate)
    if (serverMonth && !monthInitializedRef.current) {
      monthInitializedRef.current = true
      setAccountingMonth(serverMonth)
    }
    if (nextDashboard.workDate !== date) setWorkDate(nextDashboard.workDate)
    return { status: 'accepted', dashboard: nextDashboard }
  }, [onAuthInvalid, service])

  useEffect(() => {
    if (initialWorkDate) return
    void initializeServerWorkDate()
  }, [initialWorkDate, initializeServerWorkDate])

  useEffect(() => {
    if (!workDate) return
    void loadDashboard(workDate)
  }, [loadDashboard, workDate])

  const canViewProjectCosts = dashboard?.permissions?.canViewProjectCosts === true
  const availableTabs = laborTabsForPermissions(dashboard?.permissions)

  useEffect(() => {
    if (activeTab === 'project' && !canViewProjectCosts) setActiveTab('daily')
  }, [activeTab, canViewProjectCosts])

  const changeWorkDate = (nextDate) => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(nextDate)) return
    initializationGenerationRef.current += 1
    dashboardGenerationRef.current += 1
    detailGenerationRef.current += 1
    setSelectedEmployee(null)
    setResolutionDetail(null)
    setDashboard(null)
    setWorkDate(nextDate)
  }

  const closeResolution = () => {
    if (writeLockedRef.current) return
    detailGenerationRef.current += 1
    setSelectedEmployee(null)
    setResolutionDetail(null)
    setDetailLoadState({ status: 'idle', error: '' })
    setWriteError('')
  }

  const openResolution = async (employee) => {
    if (!employee?.employeeProfileId || !workDate) return
    const generation = ++detailGenerationRef.current
    const selection = {
      employeeProfileId: employee.employeeProfileId,
      employeeName: employee.name,
      workDate,
    }
    setSelectedEmployee(selection)
    setResolutionDetail(null)
    setWriteError('')
    setDetailLoadState({ status: 'loading', error: '' })
    const result = await executeLaborPageRequest({
      request: () => service.getResolutionDetail({
        employeeProfileId: selection.employeeProfileId,
        workDate: selection.workDate,
      }),
    })
    const settled = settleLaborPageRequest({
      result,
      current: mountedRef.current && generation === detailGenerationRef.current,
      onAuthInvalid,
    })
    if (settled.status === 'stale') return
    if (settled.status === 'error') {
      setDetailLoadState({
        status: 'error',
        error: displayError(settled.error, '员工考勤详情加载失败，请关闭后重试。'),
      })
      return
    }
    setResolutionDetail(settled.value)
    setDetailLoadState({ status: 'success', error: '' })
  }

  const submitResolution = async (mode, draft) => {
    if (!selectedEmployee || writeLockedRef.current) return
    writeLockedRef.current = true
    const generation = ++writeGenerationRef.current
    const targetDate = selectedEmployee.workDate
    setSaving(true)
    setWriteError('')
    const payload = {
      employeeProfileId: selectedEmployee.employeeProfileId,
      workDate: targetDate,
      ...draft,
    }
    try {
      const result = await executeLaborPageRequest({
        request: () => mode === 'confirm'
          ? service.confirmResolution(payload)
          : service.saveResolutionDraft(payload),
      })
      const settled = settleLaborPageRequest({
        result,
        current: mountedRef.current && generation === writeGenerationRef.current,
        onAuthInvalid,
      })
      if (settled.status === 'stale') return
      if (settled.status === 'error') {
        setWriteError(displayError(settled.error, mode === 'confirm'
          ? '日结确认失败，请检查输入后重试。'
          : '草稿保存失败，请稍后重试。'))
        return
      }

      detailGenerationRef.current += 1
      setSelectedEmployee(null)
      setResolutionDetail(null)
      setDetailLoadState({ status: 'idle', error: '' })
      notifyAlertCountChange(onAlertCountChange)
      if (mountedRef.current) await loadDashboard(targetDate)
    } finally {
      if (mountedRef.current && generation === writeGenerationRef.current) {
        writeLockedRef.current = false
        setSaving(false)
      }
    }
  }

  const handleSettingsSaved = useCallback(async () => {
    if (!workDate) return { status: 'invalid' }
    const result = await loadDashboard(workDate)
    if (mountedRef.current) notifyAlertCountChange(onAlertCountChange)
    return result
  }, [loadDashboard, onAlertCountChange, workDate])

  const changeAccountingMonth = useCallback((nextMonth) => {
    if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(String(nextMonth ?? ''))) return
    monthInitializedRef.current = true
    setAccountingMonth(nextMonth)
  }, [])

  return (
    <main className="labor-accounting-page">
      <header className="labor-page-heading">
        <span>
          <small>考勤事实 · 会计确认 · 成本归集</small>
          <h1>人工考勤与工资</h1>
          <p>查看所有在职员工每天的打卡状态，处理异常后再进入工资与项目成本。</p>
        </span>
        {onBack && (
          <button type="button" className="labor-back-button" onClick={onBack}>返回首页</button>
        )}
      </header>

      <nav className="labor-tabs" role="tablist" aria-label="人工考勤与工资功能">
        {availableTabs.map((tab) => (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) tabButtonRefs.current.set(tab.id, node)
              else tabButtonRefs.current.delete(tab.id)
            }}
            id={`labor-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`labor-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleLaborTabKeyDown({
              event,
              tabs: availableTabs,
              activeTabId: activeTab,
              onSelect: setActiveTab,
              focusTab: (tabId) => tabButtonRefs.current.get(tabId)?.focus(),
            })}
          >
            {tab.label}
            {tab.id === 'daily' && dashboard?.summary?.alertCount > 0 && (
              <span className="labor-tab-badge" aria-label={`${dashboard.summary.alertCount} 个异常待处理`}>
                {dashboard.summary.alertCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {activeTab === 'daily' && (
        <section
          id="labor-panel-daily"
          role="tabpanel"
          aria-labelledby="labor-tab-daily"
          tabIndex="0"
        >
          {loadState.status === 'loading' && !dashboard && (
            <div className="labor-loading-panel" role="status">
              <span className="labor-loading-dot" aria-hidden="true" />
              <strong>{workDate ? '正在加载全员考勤看板…' : '正在取得服务器东京日期…'}</strong>
            </div>
          )}

          {loadState.status === 'error' && !dashboard && (
            <div className="labor-page-error" role="alert">
              <strong>看板暂时无法显示</strong>
              <span>{loadState.error}</span>
              <div>
                <button
                  type="button"
                  onClick={() => workDate ? void loadDashboard(workDate) : void initializeServerWorkDate()}
                >
                  重新加载
                </button>
                {!workDate && (
                  <label>
                    <span>手动选择工作日期</span>
                    <input
                      type="date"
                      aria-label="手动选择工作日期"
                      value=""
                      onChange={(event) => changeWorkDate(event.target.value)}
                    />
                  </label>
                )}
              </div>
            </div>
          )}

          <DashboardLoadNotice
            loadState={loadState}
            dashboard={dashboard}
            onRetry={() => void loadDashboard(workDate)}
          />

          {dashboard && (
            <DailyAttendanceBoard
              dashboard={dashboard}
              filters={filters}
              onFiltersChange={setFilters}
              onDateChange={changeWorkDate}
              onOpenResolution={openResolution}
            />
          )}
        </section>
      )}

      {activeTab === 'monthly' && (
        <section
          id="labor-panel-monthly"
          role="tabpanel"
          aria-labelledby="labor-tab-monthly"
          tabIndex="0"
        >
          <MonthlyPayrollTab
            service={service}
            month={accountingMonth}
            onMonthChange={changeAccountingMonth}
            onAuthInvalid={onAuthInvalid}
          />
        </section>
      )}

      {(activeTab === 'project' && canViewProjectCosts) && (
        <section
          id="labor-panel-project"
          role="tabpanel"
          aria-labelledby="labor-tab-project"
          tabIndex="0"
        >
          <ProjectLaborCostTab
            service={service}
            month={accountingMonth}
            onMonthChange={changeAccountingMonth}
            onAuthInvalid={onAuthInvalid}
          />
        </section>
      )}

      {activeTab === 'settings' && (
        <section
          id="labor-panel-settings"
          role="tabpanel"
          aria-labelledby="labor-tab-settings"
          tabIndex="0"
        >
          <AttendanceAccountingSettings
            service={service}
            canUpdateSettings={dashboard?.permissions?.canUpdateSettings === true}
            onAuthInvalid={onAuthInvalid}
            onSaved={handleSettingsSaved}
          />
        </section>
      )}

      {selectedEmployee && !resolutionDetail && (
        <DetailLoadingDialog
          selectedEmployee={selectedEmployee}
          detailLoadState={detailLoadState}
          onClose={closeResolution}
        />
      )}

      {selectedEmployee && resolutionDetail && (
        <AttendanceResolutionDialog
          key={`${resolutionDetail.employee.employeeProfileId}:${resolutionDetail.workDate}:${resolutionDetail.resolution?.version || 0}`}
          detail={resolutionDetail}
          saving={saving}
          error={writeError}
          onSaveDraft={(draft) => void submitResolution('draft', draft)}
          onConfirm={(draft) => void submitResolution('confirm', draft)}
          onClose={closeResolution}
        />
      )}
    </main>
  )
}

import React, { useCallback, useEffect, useRef, useState } from 'react'

import { laborAccountingService } from '../../services/laborAccountingService.js'
import AttendanceResolutionDialog from './AttendanceResolutionDialog.jsx'
import DailyAttendanceBoard, { EMPTY_DAILY_FILTERS } from './DailyAttendanceBoard.jsx'
import './laborAccounting.css'

function displayError(error, fallback) {
  return typeof error?.userMessage === 'string' && error.userMessage.trim()
    ? error.userMessage
    : fallback
}

function forwardAuthInvalid(error, onAuthInvalid) {
  if (error?.authInvalid === true) onAuthInvalid?.(error)
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

  const mountedRef = useRef(true)
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
    try {
      const alertSnapshot = await service.getAlertCount()
      if (!mountedRef.current || generation !== initializationGenerationRef.current) {
        return { status: 'stale' }
      }
      setWorkDate(alertSnapshot.workDate)
      return { status: 'accepted', workDate: alertSnapshot.workDate }
    } catch (error) {
      if (!mountedRef.current || generation !== initializationGenerationRef.current) {
        return { status: 'stale' }
      }
      forwardAuthInvalid(error, onAuthInvalid)
      setLoadState({
        status: 'error',
        error: displayError(error, '无法取得服务器东京日期，请重试或手动选择日期。'),
      })
      return { status: 'error' }
    }
  }, [onAuthInvalid, service])

  const loadDashboard = useCallback(async (date) => {
    if (!date) return { status: 'invalid' }
    const generation = ++dashboardGenerationRef.current
    setLoadState({ status: 'loading', error: '' })
    try {
      const nextDashboard = await service.listDailyDashboard({ workDate: date })
      if (!mountedRef.current || generation !== dashboardGenerationRef.current) {
        return { status: 'stale' }
      }
      setDashboard(nextDashboard)
      setLoadState({ status: 'success', error: '' })
      if (nextDashboard.workDate !== date) setWorkDate(nextDashboard.workDate)
      return { status: 'accepted', dashboard: nextDashboard }
    } catch (error) {
      if (!mountedRef.current || generation !== dashboardGenerationRef.current) {
        return { status: 'stale' }
      }
      forwardAuthInvalid(error, onAuthInvalid)
      setLoadState({
        status: 'error',
        error: displayError(error, '当天考勤看板加载失败，请稍后重试。'),
      })
      return { status: 'error' }
    }
  }, [onAuthInvalid, service])

  useEffect(() => {
    if (initialWorkDate) return
    void initializeServerWorkDate()
  }, [initialWorkDate, initializeServerWorkDate])

  useEffect(() => {
    if (!workDate) return
    void loadDashboard(workDate)
  }, [loadDashboard, workDate])

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
    try {
      const detail = await service.getResolutionDetail({
        employeeProfileId: selection.employeeProfileId,
        workDate: selection.workDate,
      })
      if (!mountedRef.current || generation !== detailGenerationRef.current) return
      setResolutionDetail(detail)
      setDetailLoadState({ status: 'success', error: '' })
    } catch (error) {
      if (!mountedRef.current || generation !== detailGenerationRef.current) return
      forwardAuthInvalid(error, onAuthInvalid)
      setDetailLoadState({
        status: 'error',
        error: displayError(error, '员工考勤详情加载失败，请关闭后重试。'),
      })
    }
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
      if (mode === 'confirm') await service.confirmResolution(payload)
      else await service.saveResolutionDraft(payload)
      if (!mountedRef.current || generation !== writeGenerationRef.current) return

      detailGenerationRef.current += 1
      setSelectedEmployee(null)
      setResolutionDetail(null)
      setDetailLoadState({ status: 'idle', error: '' })
      notifyAlertCountChange(onAlertCountChange)
      await loadDashboard(targetDate)
    } catch (error) {
      if (!mountedRef.current || generation !== writeGenerationRef.current) return
      forwardAuthInvalid(error, onAuthInvalid)
      setWriteError(displayError(error, mode === 'confirm'
        ? '日结确认失败，请检查输入后重试。'
        : '草稿保存失败，请稍后重试。'))
    } finally {
      if (mountedRef.current && generation === writeGenerationRef.current) {
        writeLockedRef.current = false
        setSaving(false)
      }
    }
  }

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

      <nav className="labor-tabs" aria-label="人工考勤与工资功能">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'daily'}
          onClick={() => setActiveTab('daily')}
        >
          今日看板
          {dashboard?.summary?.alertCount > 0 && (
            <span className="labor-tab-badge" aria-label={`${dashboard.summary.alertCount} 个异常待处理`}>
              {dashboard.summary.alertCount}
            </span>
          )}
        </button>
      </nav>

      <section role="tabpanel" aria-label="今日看板">
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

      {selectedEmployee && !resolutionDetail && (
        <div className="labor-dialog-backdrop">
          <section
            className="labor-detail-loading-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedEmployee.employeeName}考勤详情`}
          >
            {detailLoadState.status === 'error' ? (
              <>
                <strong>考勤详情加载失败</strong>
                <p role="alert">{detailLoadState.error}</p>
                <button type="button" onClick={closeResolution}>关闭</button>
              </>
            ) : (
              <p role="status">正在加载 {selectedEmployee.employeeName} 的原始打卡事实…</p>
            )}
          </section>
        </div>
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

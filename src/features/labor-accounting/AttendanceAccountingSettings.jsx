import React, { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_SETTINGS_PREVIEW = Object.freeze({
  configured: false,
  effectiveFrom: null,
  workWeekdays: [1, 2, 3, 4, 5, 6],
  workStartTime: '08:00',
  workEndTime: '17:00',
  breakMinutes: 60,
  standardDayMinutes: 480,
  version: 0,
})

const WEEKDAYS = Object.freeze([
  [1, '周一'], [2, '周二'], [3, '周三'], [4, '周四'],
  [5, '周五'], [6, '周六'], [7, '周日'],
])

function safeError(error, fallback) {
  return typeof error?.userMessage === 'string' && error.userMessage.trim()
    ? error.userMessage
    : fallback
}

function formFromSettings(settings) {
  const value = settings || DEFAULT_SETTINGS_PREVIEW
  return {
    effectiveFrom: value.effectiveFrom || '',
    workWeekdays: [...value.workWeekdays],
    workStartTime: value.workStartTime,
    workEndTime: value.workEndTime,
    breakMinutes: String(value.breakMinutes),
    standardDayMinutes: String(value.standardDayMinutes),
  }
}

function safeIntegerInput(value, minimum) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= minimum && !Object.is(value, -0) ? value : null
  }
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(String(value ?? ''))
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1) return false
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= days[month - 1]
}

function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/u.exec(String(value ?? ''))
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

export function buildAttendanceSettingsPayload({ form, version }) {
  if (!validDate(form?.effectiveFrom) ||
      !Number.isSafeInteger(version) || version < 0 || Object.is(version, -0)) return null
  if (!Array.isArray(form.workWeekdays) || form.workWeekdays.length < 1 ||
      form.workWeekdays.length > 7) return null
  const workWeekdays = [...new Set(form.workWeekdays)]
  if (workWeekdays.length !== form.workWeekdays.length || workWeekdays.some((day) =>
    !Number.isSafeInteger(day) || day < 1 || day > 7)) return null
  workWeekdays.sort((left, right) => left - right)
  const start = timeMinutes(form.workStartTime)
  const end = timeMinutes(form.workEndTime)
  const breakMinutes = safeIntegerInput(form.breakMinutes, 0)
  const standardDayMinutes = safeIntegerInput(form.standardDayMinutes, 1)
  if (start === null || end === null || end <= start || breakMinutes === null ||
      standardDayMinutes === null || breakMinutes >= end - start ||
      breakMinutes > 1439 || standardDayMinutes > 1440 ||
      standardDayMinutes > end - start - breakMinutes) return null
  return {
    effectiveFrom: form.effectiveFrom,
    workWeekdays,
    workStartTime: form.workStartTime,
    workEndTime: form.workEndTime,
    breakMinutes,
    standardDayMinutes,
    version,
  }
}

export default function AttendanceAccountingSettings({
  service,
  canUpdateSettings,
  onAuthInvalid,
  onSaved,
  initialSettings = null,
}) {
  const [settings, setSettings] = useState(initialSettings)
  const [form, setForm] = useState(() => formFromSettings(initialSettings))
  const [loadState, setLoadState] = useState({
    status: initialSettings ? 'success' : 'loading', error: '',
  })
  const [writeState, setWriteState] = useState({ status: 'idle', error: '' })

  const mountedRef = useRef(true)
  const loadGenerationRef = useRef(0)
  const writeGenerationRef = useRef(0)
  const contextGenerationRef = useRef(0)
  const writeLockedRef = useRef(false)
  const canUpdateSettingsRef = useRef(canUpdateSettings === true)
  canUpdateSettingsRef.current = canUpdateSettings === true

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      loadGenerationRef.current += 1
      writeGenerationRef.current += 1
      contextGenerationRef.current += 1
      writeLockedRef.current = false
    }
  }, [])

  useEffect(() => {
    contextGenerationRef.current += 1
    if (!canUpdateSettings) {
      writeGenerationRef.current += 1
      writeLockedRef.current = false
      setWriteState({ status: 'idle', error: '' })
    }
  }, [canUpdateSettings])

  const loadSettings = useCallback(async ({ preserveWriteError = false } = {}) => {
    const generation = ++loadGenerationRef.current
    setLoadState({ status: 'loading', error: '' })
    try {
      const value = await service.getSettings()
      const current = mountedRef.current && generation === loadGenerationRef.current
      if (!current) return { status: 'stale' }
      setSettings(value)
      setForm(formFromSettings(value))
      setLoadState({ status: 'success', error: '' })
      if (!preserveWriteError) setWriteState({ status: 'idle', error: '' })
      return { status: 'success', value }
    } catch (error) {
      const current = mountedRef.current && generation === loadGenerationRef.current
      if (!current) return { status: 'stale' }
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      setLoadState({
        status: 'error',
        error: safeError(error, '考勤设置加载失败，请稍后重试。'),
      })
      return { status: 'error' }
    }
  }, [onAuthInvalid, service])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const updateWeekday = (weekday, checked) => {
    setForm((current) => ({
      ...current,
      workWeekdays: checked
        ? [...new Set([...current.workWeekdays, weekday])].sort((left, right) => left - right)
        : current.workWeekdays.filter((value) => value !== weekday),
    }))
    setWriteState({ status: 'idle', error: '' })
  }

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }))
    setWriteState({ status: 'idle', error: '' })
  }

  const save = async () => {
    if (!canUpdateSettingsRef.current || writeLockedRef.current) return
    const payload = buildAttendanceSettingsPayload({
      form,
      version: settings?.version ?? 0,
    })
    if (!payload) {
      setWriteState({
        status: 'error',
        error: '请填写有效启用日期、工作日和班次；标准分钟数不能超过扣除休息后的班次。',
      })
      return
    }
    writeLockedRef.current = true
    const generation = ++writeGenerationRef.current
    const contextGeneration = contextGenerationRef.current
    setWriteState({ status: 'loading', error: '' })
    try {
      const value = await service.updateSettings(payload)
      const current = mountedRef.current && generation === writeGenerationRef.current &&
        contextGeneration === contextGenerationRef.current && canUpdateSettingsRef.current
      if (!current) return
      setSettings(value)
      setForm(formFromSettings(value))
      setWriteState({ status: 'success', error: '' })
      const callbackResult = onSaved?.(value)
      if (callbackResult && typeof callbackResult.catch === 'function') {
        void callbackResult.catch(() => {})
      }
    } catch (error) {
      const current = mountedRef.current && generation === writeGenerationRef.current &&
        contextGeneration === contextGenerationRef.current && canUpdateSettingsRef.current
      if (!current) return
      if (error?.authInvalid === true) onAuthInvalid?.(error)
      const conflict = error?.code === 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT'
      setWriteState({
        status: 'error',
        error: safeError(error, conflict
          ? '设置已被其他人更新，已重新加载最新设置，请确认后再保存。'
          : '考勤设置保存失败，请检查输入后重试。'),
      })
      if (conflict) await loadSettings({ preserveWriteError: true })
    } finally {
      writeLockedRef.current = false
      if (mountedRef.current && generation === writeGenerationRef.current &&
          contextGeneration === contextGenerationRef.current && canUpdateSettingsRef.current) {
        setWriteState((current) => current.status === 'loading'
          ? { status: 'idle', error: '' }
          : current)
      }
    }
  }

  const controlsDisabled = !canUpdateSettings || writeState.status === 'loading' ||
    loadState.status === 'loading'
  const preview = settings || DEFAULT_SETTINGS_PREVIEW

  return (
    <div className="labor-report-tab labor-settings-tab">
      <header className="labor-report-heading">
        <span>
          <small>服务器东京时间 · 未确认日期生效</small>
          <h2>考勤设置</h2>
          <p>默认周一至周六为工作日；周日仍可打卡，但不打卡不会产生缺卡异常。</p>
        </span>
      </header>

      {!canUpdateSettings && (
        <div className="labor-redacted-note" role="note">
          <strong>当前为只读设置</strong>
          <span>需要考勤设置修改权限才能保存。</span>
        </div>
      )}
      {!preview.configured && (
        <div className="labor-configuration-notice" role="status">
          <span className="labor-status-dot" aria-hidden="true" />
          <span>尚未配置启用日期。下面仅预览默认班次，不会虚构启用日期。</span>
        </div>
      )}

      <div className="labor-live-region" aria-live="polite" aria-atomic="true">
        {loadState.status === 'loading' && <span>正在加载考勤设置…</span>}
        {loadState.status === 'error' && <span role="alert">{loadState.error}</span>}
        {writeState.status === 'success' && <span>考勤设置已保存，并正在刷新当天看板。</span>}
        {writeState.status === 'error' && <span role="alert">{writeState.error}</span>}
      </div>
      {loadState.status === 'error' && (
        <button type="button" onClick={() => void loadSettings()}>
          重新加载设置
        </button>
      )}

      <section className="labor-settings-card" aria-labelledby="attendance-settings-form-title">
        <header className="labor-section-heading">
          <span><h3 id="attendance-settings-form-title">标准班次</h3><small>保存后只影响尚未确认的日期</small></span>
        </header>
        <div className="labor-settings-grid">
          <label>
            <span>启用日期</span>
            <input
              type="date"
              aria-label="考勤设置启用日期"
              value={form.effectiveFrom}
              disabled={controlsDisabled}
              onChange={(event) => updateField('effectiveFrom', event.target.value)}
            />
          </label>
          <label>
            <span>上班时间</span>
            <input
              type="time"
              aria-label="默认上班时间"
              value={form.workStartTime}
              disabled={controlsDisabled}
              onChange={(event) => updateField('workStartTime', event.target.value)}
            />
          </label>
          <label>
            <span>下班时间</span>
            <input
              type="time"
              aria-label="默认下班时间"
              value={form.workEndTime}
              disabled={controlsDisabled}
              onChange={(event) => updateField('workEndTime', event.target.value)}
            />
          </label>
          <label>
            <span>休息分钟数</span>
            <input
              type="number"
              inputMode="numeric"
              min="0"
              step="1"
              aria-label="默认休息分钟数"
              value={form.breakMinutes}
              disabled={controlsDisabled}
              onChange={(event) => updateField('breakMinutes', event.target.value)}
            />
          </label>
          <label>
            <span>标准日分钟数（480 = 8 小时）</span>
            <input
              type="number"
              inputMode="numeric"
              min="1"
              step="1"
              aria-label="标准日分钟数"
              value={form.standardDayMinutes}
              disabled={controlsDisabled}
              onChange={(event) => updateField('standardDayMinutes', event.target.value)}
            />
          </label>
        </div>

        <fieldset className="labor-weekday-options" disabled={controlsDisabled}>
          <legend>默认工作日</legend>
          {WEEKDAYS.map(([weekday, label]) => (
            <label key={weekday}>
              <input
                type="checkbox"
                name={`weekday-${weekday}`}
                aria-label={`${label}设为工作日`}
                checked={form.workWeekdays.includes(weekday)}
                disabled={controlsDisabled}
                onChange={(event) => updateWeekday(weekday, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div className="labor-settings-actions">
          <span>当前版本：{settings?.version ?? 0}</span>
          <button
            type="button"
            className="labor-primary-action"
            disabled={controlsDisabled}
            onClick={() => void save()}
          >
            {writeState.status === 'loading' ? '正在保存…' : '保存考勤设置'}
          </button>
        </div>
      </section>
    </div>
  )
}

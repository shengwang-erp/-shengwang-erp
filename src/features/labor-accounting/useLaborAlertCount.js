import { useCallback, useEffect, useRef, useState } from 'react'

import { laborAccountingService } from '../../services/laborAccountingService.js'

export const LABOR_ALERT_POLL_INTERVAL_MS = 300000
export const LABOR_ALERT_SOURCE = 'labor-alert-service'

const defaultWindowTarget = typeof window === 'undefined' ? null : window
const defaultSetInterval = (...args) => globalThis.setInterval(...args)
const defaultClearInterval = (timerId) => globalThis.clearInterval(timerId)

export function hasLaborViewPermission(effectivePermissionKeys) {
  return Array.isArray(effectivePermissionKeys) && (
    effectivePermissionKeys.includes('module.labor.view') ||
    effectivePermissionKeys.includes('all')
  )
}

export function canRequestLaborAlertCount({ actorKey, effectivePermissionKeys } = {}) {
  return typeof actorKey === 'string' && actorKey.trim().length > 0 &&
    hasLaborViewPermission(effectivePermissionKeys)
}

export function createLaborAlertState() {
  return {
    count: 0,
    stale: false,
    loading: true,
    error: '',
    code: '',
    source: LABOR_ALERT_SOURCE,
    updatedAt: null,
  }
}

export function applyLaborAlertRefreshResult(previousState, result) {
  const previousCount = Number.isSafeInteger(previousState?.count) && previousState.count >= 0
    ? previousState.count
    : 0
  const previousUpdatedAt = typeof previousState?.updatedAt === 'string'
    ? previousState.updatedAt
    : null
  if (result?.ok !== true || !Number.isSafeInteger(result.count) || result.count < 0) {
    return {
      count: previousCount,
      stale: true,
      loading: false,
      error: typeof result?.message === 'string' && result.message
        ? result.message
        : '正式考勤提醒读取失败',
      code: typeof result?.code === 'string' && result.code
        ? result.code
        : 'DATA_OPERATION_FAILED',
      source: LABOR_ALERT_SOURCE,
      updatedAt: previousUpdatedAt,
    }
  }
  return {
    count: result.count,
    stale: false,
    loading: false,
    error: '',
    code: '',
    source: LABOR_ALERT_SOURCE,
    updatedAt: typeof result.updatedAt === 'string' ? result.updatedAt : null,
  }
}

function fingerprintPermissions(effectivePermissionKeys) {
  if (!Array.isArray(effectivePermissionKeys)) return 'not-an-array'
  return effectivePermissionKeys.map((key) => (
    typeof key === 'string' ? `string:${key.length}:${key}` : `${typeof key}:${String(key)}`
  )).join('|')
}

function notifyCurrentAuthInvalid(callback, error) {
  if (error?.authInvalid === true && typeof callback === 'function') {
    try {
      const result = callback(error)
      if (result && typeof result.catch === 'function') void result.catch(() => {})
    } catch {
      // Authentication is already being invalidated; callback failures stay isolated.
    }
  }
}

export default function useLaborAlertCount({
  actorKey,
  effectivePermissionKeys,
  onAuthInvalid,
  service = laborAccountingService,
  windowTarget = defaultWindowTarget,
  setIntervalFn = defaultSetInterval,
  clearIntervalFn = defaultClearInterval,
} = {}) {
  const permissionFingerprint = fingerprintPermissions(effectivePermissionKeys)
  const enabled = canRequestLaborAlertCount({ actorKey, effectivePermissionKeys })
  const requestIdentity = `${actorKey ?? ''}\u0000${permissionFingerprint}`
  const [state, setState] = useState(createLaborAlertState)
  const stateIdentityRef = useRef(requestIdentity)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const onAuthInvalidRef = useRef(onAuthInvalid)
  onAuthInvalidRef.current = onAuthInvalid

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled || !mountedRef.current) return { status: 'skipped' }
    const generation = generationRef.current + 1
    generationRef.current = generation
    try {
      const response = await service.getAlertCount()
      if (!mountedRef.current || generation !== generationRef.current) {
        return { status: 'stale' }
      }
      stateIdentityRef.current = requestIdentity
      setState((previousState) => applyLaborAlertRefreshResult(previousState, {
        ok: true,
        count: response?.count,
        updatedAt: new Date().toISOString(),
      }))
      return { status: 'accepted' }
    } catch (error) {
      if (!mountedRef.current || generation !== generationRef.current) {
        return { status: 'stale' }
      }
      stateIdentityRef.current = requestIdentity
      setState((previousState) => applyLaborAlertRefreshResult(previousState, {
        ok: false,
        code: typeof error?.code === 'string' ? error.code : 'DATA_OPERATION_FAILED',
        message: typeof error?.message === 'string' && error.message
          ? error.message
          : '正式考勤提醒读取失败',
      }))
      notifyCurrentAuthInvalid(onAuthInvalidRef.current, error)
      return { status: 'error' }
    }
  }, [enabled, requestIdentity, service])

  useEffect(() => {
    generationRef.current += 1
    stateIdentityRef.current = requestIdentity
    setState(createLaborAlertState())
    if (!enabled) return undefined

    void refresh()
    const handleFocus = () => {
      void refresh()
    }
    if (typeof windowTarget?.addEventListener === 'function') {
      windowTarget.addEventListener('focus', handleFocus)
    }
    const timerId = typeof setIntervalFn === 'function'
      ? setIntervalFn(() => {
        void refresh()
      }, LABOR_ALERT_POLL_INTERVAL_MS)
      : null

    return () => {
      generationRef.current += 1
      if (typeof windowTarget?.removeEventListener === 'function') {
        windowTarget.removeEventListener('focus', handleFocus)
      }
      if (timerId !== null && typeof clearIntervalFn === 'function') {
        clearIntervalFn(timerId)
      }
    }
  }, [
    actorKey,
    clearIntervalFn,
    enabled,
    permissionFingerprint,
    refresh,
    requestIdentity,
    setIntervalFn,
    windowTarget,
  ])

  const visibleState = enabled && stateIdentityRef.current === requestIdentity
    ? state
    : createLaborAlertState()
  return { ...visibleState, allowed: enabled, refresh }
}

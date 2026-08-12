import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import {
  isAttendanceTargetGeometryValid,
} from './attendanceLocationAttempt.js'
import { previewAttendanceLocation } from './attendanceDomain.js'

const ERROR_MESSAGES = Object.freeze({
  GEOLOCATION_UNSUPPORTED: '当前设备不支持定位',
  GEOLOCATION_PERMISSION_DENIED: '定位权限已被拒绝，请在浏览器设置中允许定位',
  GEOLOCATION_UNAVAILABLE: '暂时无法取得位置，请移动到开阔区域后重试',
  GEOLOCATION_TIMEOUT: '定位超时，请重新获取位置',
  GEOLOCATION_INVALID: '设备返回了无效位置，请重新定位',
  ATTENDANCE_REFRESH_FAILED: '打卡已提交，但刷新失败，请重新读取服务器记录',
  ATTENDANCE_SERVICE_UNAVAILABLE: '考勤服务暂不可用，请重试提交',
})

const defaultActionLabel = (action) => action === 'clock_out' ? '打卡下班' : '打卡上班'
const safeErrorCode = (error, fallback) =>
  typeof error?.code === 'string' && error.code ? error.code : fallback

function stateFor(phase = 'idle', patch = {}) {
  return { phase, submission: null, preview: null, errorCode: null, failureStage: null, ...patch }
}

function phaseStatus(phase) {
  return {
    idle: '尚未获取本次打卡位置。',
    locating: '正在获取当前位置…',
    submitting: '正在提交打卡…',
    awaiting_confirmation: '等待确认本次范围外打卡。',
    refreshing: '打卡已提交，正在刷新今日记录…',
    failed: '本次操作需要处理后重试。',
  }[phase] || ''
}

export function AttendanceLocationResult({ attempt }) {
  if (!attempt?.preview) return null
  return (
    <div className="attendance-location-result" data-result={attempt.preview.result}>
      <p>定位预览，服务器结果为准</p>
      <strong>
        {attempt.preview.result === 'normal' ? '预览结果：范围内' : '预览结果：范围外或精度不足'}
      </strong>
      <span>
        距离 {Math.round(attempt.preview.distanceMeters)} 米・精度 ±{Math.round(attempt.preview.accuracyMeters)} 米・半径 {attempt.preview.radiusMeters} 米
      </span>
    </div>
  )
}

export function createAttendanceLocationSubmissionController({
  attendanceMode = 'project',
  targetLocation,
  locationService,
  createRequestId,
  onSubmit,
  onSuccess,
  onConfirmationRequired,
  onState,
} = {}) {
  let state = stateFor()
  let mounted = true
  let locked = false
  let generation = 0
  let controller = null
  const emit = (next) => {
    state = next
    if (mounted) onState?.(state)
    return state
  }
  const submitReusable = async (submission, token, returnFocus) => {
    emit(stateFor('submitting', { submission, preview: state.preview }))
    let result
    try {
      result = await onSubmit(submission)
    } catch (error) {
      if (!mounted || token !== generation) return { status: 'stale' }
      locked = false
      emit(stateFor('failed', {
        submission,
        preview: state.preview,
        errorCode: safeErrorCode(error, 'ATTENDANCE_SERVICE_UNAVAILABLE'),
        failureStage: 'submit',
      }))
      return { status: 'failed', stage: 'submit', error }
    }
    if (!mounted || token !== generation) return { status: 'stale' }
    if (result?.status === 'confirmation_required') {
      locked = false
      emit(stateFor('awaiting_confirmation', { submission, preview: state.preview }))
      let resolved = false
      onConfirmationRequired?.({
        submission,
        confirmation: result.confirmation,
        returnFocus,
        onConfirmed() {
          if (resolved || !mounted || token !== generation ||
              state.phase !== 'awaiting_confirmation' ||
              state.submission !== submission) return { status: 'stale' }
          resolved = true
          locked = true
          generation += 1
          emit(stateFor('refreshing', { submission, preview: state.preview }))
          return { status: 'confirmed' }
        },
        onCancelled() {
          if (resolved || !mounted || token !== generation ||
              state.phase !== 'awaiting_confirmation' ||
              state.submission !== submission) return { status: 'stale' }
          resolved = true
          locked = false
          generation += 1
          emit(stateFor())
          return { status: 'cancelled' }
        },
      })
      return result
    }
    emit(stateFor('refreshing', { submission, preview: state.preview }))
    try {
      await onSuccess?.(result)
    } catch (error) {
      if (!mounted || token !== generation) return { status: 'stale' }
      locked = false
      emit(stateFor('failed', {
        submission,
        preview: state.preview,
        errorCode: safeErrorCode(error, 'ATTENDANCE_REFRESH_FAILED'),
        failureStage: 'refresh',
      }))
      return { status: 'failed', stage: 'refresh', error }
    }
    if (!mounted || token !== generation) return { status: 'stale' }
    locked = false
    emit(stateFor())
    return { status: 'succeeded', result }
  }
  return Object.freeze({
    getState: () => state,
    mount() {
      if (mounted) return
      mounted = true
      locked = false
      controller = null
      generation += 1
    },
    async begin(returnFocus = null) {
      if (!mounted || locked) return { status: 'busy' }
      if (attendanceMode === 'project' && !isAttendanceTargetGeometryValid(targetLocation)) {
        return { status: 'invalid' }
      }
      locked = true
      generation += 1
      const token = generation
      controller = new AbortController()
      emit(stateFor('locating'))
      let location
      try {
        location = await locationService.getCurrentLocation({ signal: controller.signal })
      } catch (error) {
        if (!mounted || token !== generation) return { status: 'stale' }
        locked = false
        controller = null
        emit(stateFor('failed', {
          errorCode: safeErrorCode(error, 'GEOLOCATION_UNAVAILABLE'),
          failureStage: 'locate',
        }))
        return { status: 'failed', stage: 'locate', error }
      }
      if (!mounted || token !== generation) return { status: 'stale' }
      controller = null
      let requestId
      let preview
      try {
        requestId = createRequestId()
        if (typeof requestId !== 'string' || !requestId.trim()) throw new TypeError('invalid request id')
        preview = attendanceMode === 'project'
          ? previewAttendanceLocation({ center: targetLocation, location })
          : null
      } catch (error) {
        locked = false
        emit(stateFor('failed', { errorCode: 'GEOLOCATION_INVALID', failureStage: 'locate' }))
        return { status: 'failed', stage: 'locate', error }
      }
      const submission = { requestId, location }
      state = { ...state, preview }
      return submitReusable(submission, token, returnFocus)
    },
    async retry(returnFocus = null) {
      if (!mounted || locked || !state.submission) return { status: 'invalid' }
      locked = true
      generation += 1
      return submitReusable(state.submission, generation, returnFocus)
    },
    abort() {
      controller?.abort()
      controller = null
      generation += 1
      locked = false
      emit(stateFor())
    },
    unmount() {
      mounted = false
      controller?.abort()
      controller = null
      generation += 1
      locked = false
    },
  })
}

export default function AttendanceLocationAction({
  action,
  attendanceMode = 'project',
  buttonLabel,
  targetLocation,
  locationService,
  createRequestId,
  onSubmit,
  onSuccess,
  onConfirmationRequired,
  disabled = false,
  disabledReason = '',
}) {
  const [attempt, setAttempt] = useState(() => stateFor())
  const originRef = useRef(null)
  const controllerRef = useRef(null)
  const statusId = useId()
  const errorId = useId()
  const disabledDescriptionId = useId()
  const targetInvalid = attendanceMode === 'project' &&
    !isAttendanceTargetGeometryValid(targetLocation)
  const effectiveDisabled = disabled || targetInvalid
  const label = buttonLabel || defaultActionLabel(action)
  const targetSignature = JSON.stringify([
    action, attendanceMode, targetLocation?.projectId ?? null,
    targetLocation?.sessionId ?? null, targetLocation?.latitude ?? null,
    targetLocation?.longitude ?? null, targetLocation?.attendanceRadiusMeters ?? null,
  ])
  const currentTargetSignatureRef = useRef(targetSignature)
  const callbacksRef = useRef(null)
  callbacksRef.current = {
    createRequestId,
    onSubmit,
    onSuccess,
    onConfirmationRequired,
  }

  const controller = useMemo(() => createAttendanceLocationSubmissionController({
    attendanceMode,
    targetLocation,
    locationService,
    createRequestId: () => callbacksRef.current.createRequestId(),
    onSubmit: (submission) => callbacksRef.current.onSubmit(submission),
    onSuccess: (result) => callbacksRef.current.onSuccess?.(result),
    onConfirmationRequired: (value) =>
      callbacksRef.current.onConfirmationRequired?.(value),
    onState: setAttempt,
  // The semantic signature, not render-time object identity, owns an in-flight attempt.
  }), [attendanceMode, locationService, targetSignature])

  useEffect(() => {
    controller.mount()
    return () => controller.unmount()
  }, [controller])
  useLayoutEffect(() => {
    const previous = controllerRef.current
    controllerRef.current = controller
    if (currentTargetSignatureRef.current !== targetSignature) {
      currentTargetSignatureRef.current = targetSignature
    }
    if (previous && previous !== controller) {
      previous.unmount()
      setAttempt(stateFor())
    }
  }, [controller, targetSignature])

  const busy = ['locating', 'submitting', 'refreshing'].includes(attempt.phase)
  const errorMessage = attempt.errorCode
    ? ERROR_MESSAGES[attempt.errorCode] || '本次操作失败，请重试'
    : ''
  const disabledExplanation = targetInvalid
    ? action === 'clock_out'
      ? '当前场次的项目定位不可用，请刷新后重试。'
      : '当前项目定位不可用，请重新选择项目。'
    : disabled ? disabledReason || '当前打卡操作暂不可用。' : ''
  const describedBy = [
    statusId,
    errorMessage ? errorId : '',
    disabledExplanation ? disabledDescriptionId : '',
  ].filter(Boolean).join(' ')
  const begin = () => void controller.begin(originRef.current)
  const retry = () => void controller.retry(originRef.current)

  return (
    <section className="attendance-location-action" aria-label={label} aria-busy={busy}>
      <AttendanceLocationResult attempt={attempt} />
      {['idle', 'awaiting_confirmation'].includes(attempt.phase) ? (
        <button
          ref={originRef}
          className="attendance-location-start"
          type="button"
          disabled={effectiveDisabled}
          aria-describedby={describedBy}
          onClick={begin}
        >
          {label}
        </button>
      ) : null}
      {attempt.phase === 'failed' ? (
        <div className="attendance-location-recovery">
          {attempt.submission ? (
            <button
              className="attendance-location-retry"
              type="button"
              disabled={effectiveDisabled || busy}
              aria-describedby={describedBy}
              onClick={retry}
            >
              重试提交
            </button>
          ) : null}
          <button
            className="attendance-location-relocate"
            type="button"
            disabled={effectiveDisabled || busy}
            aria-describedby={describedBy}
            onClick={begin}
          >
            重新定位
          </button>
        </div>
      ) : null}
      <p id={statusId} className="attendance-location-status" role="status" aria-live="polite">
        {phaseStatus(attempt.phase)}
      </p>
      {errorMessage ? <p id={errorId} className="attendance-location-error" role="alert">{errorMessage}</p> : null}
      {disabledExplanation ? (
        <p id={disabledDescriptionId} className="attendance-location-guidance">{disabledExplanation}</p>
      ) : null}
    </section>
  )
}

import { useEffect, useId, useLayoutEffect, useReducer, useRef } from 'react'

import {
  acquireAttendanceLocationAttempt,
  attendanceLocationAttemptReducer,
  buildAttendanceSubmission,
  createAttendanceLocationAttempt,
  createAttendanceLocationOperationContext,
  createAttendanceLocationOperationGuard,
  isAttendanceTargetGeometryValid,
  submitAttendanceLocationAttempt,
} from './attendanceLocationAttempt.js'

const ERROR_MESSAGES = Object.freeze({
  GEOLOCATION_UNSUPPORTED: '当前设备不支持定位',
  GEOLOCATION_PERMISSION_DENIED: '定位权限已被拒绝，请在浏览器设置中允许定位',
  GEOLOCATION_UNAVAILABLE: '暂时无法取得位置，请移动到开阔区域后重试',
  GEOLOCATION_TIMEOUT: '定位超时，请重新获取位置',
  GEOLOCATION_INVALID: '设备返回了无效位置，请重新定位',
  ATTENDANCE_ABNORMAL_REASON_INVALID: '异常原因需填写 1–500 个字符',
  ATTENDANCE_ABNORMAL_REASON_REQUIRED: '服务器判定本次打卡异常，请填写异常原因',
  ATTENDANCE_REFRESH_FAILED: '打卡已提交，但刷新失败，请重试同一请求',
  ATTENDANCE_SERVICE_UNAVAILABLE: '考勤服务暂不可用，请重试提交',
})

const actionLabel = (action) => action === 'clock_out' ? '打卡下班' : '打卡上班'
const safeErrorCode = (error, fallback) =>
  typeof error?.code === 'string' && error.code ? error.code : fallback

function phaseStatus(phase) {
  return {
    idle: '尚未获取本次打卡位置。',
    locating: '正在获取当前位置…',
    ready: '定位完成，正在准备提交。',
    reason_required: '请填写异常原因后提交。',
    submitting: '正在提交打卡…',
    refreshing: '打卡已提交，正在刷新今日记录…',
    succeeded: '打卡成功。',
    failed: '本次操作需要处理后重试。',
  }[phase] || ''
}

export default function AttendanceLocationAction({
  action,
  targetLocation,
  locationService,
  createRequestId,
  onSubmit,
  onSuccess,
  disabled = false,
  disabledReason = '',
}) {
  const [attempt, dispatch] = useReducer(
    attendanceLocationAttemptReducer,
    undefined,
    createAttendanceLocationAttempt,
  )
  const guardRef = useRef(null)
  if (guardRef.current === null) {
    guardRef.current = createAttendanceLocationOperationGuard()
  }
  const controllerRef = useRef(null)
  const reasonRef = useRef(null)
  const attemptTargetSignatureRef = useRef(null)

  const statusId = useId()
  const errorId = useId()
  const reasonId = useId()
  const disabledDescriptionId = useId()
  const targetInvalid = !isAttendanceTargetGeometryValid(targetLocation)
  const effectiveDisabled = disabled || targetInvalid
  const targetSignature = JSON.stringify([
    action,
    targetLocation?.projectId ?? null,
    targetLocation?.sessionId ?? null,
    targetLocation?.latitude ?? null,
    targetLocation?.longitude ?? null,
    targetLocation?.attendanceRadiusMeters ?? null,
  ])
  const currentTargetSignatureRef = useRef(targetSignature)

  const createOperationContext = (generation) =>
    createAttendanceLocationOperationContext({
      guard: guardRef.current,
      generation,
      targetSignature,
      isTargetCurrent: (signature) => currentTargetSignatureRef.current === signature,
      targetLocation,
      locationService,
      createRequestId,
      onSubmit,
      onSuccess,
    })

  const invalidateCurrentOperation = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    attemptTargetSignatureRef.current = null
    const generation = guardRef.current.invalidate()
    dispatch({ type: 'restart', generation })
    return generation
  }

  useEffect(() => () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    attemptTargetSignatureRef.current = null
    guardRef.current.unmount()
  }, [])

  useLayoutEffect(() => {
    if (currentTargetSignatureRef.current === targetSignature) return
    currentTargetSignatureRef.current = targetSignature
    invalidateCurrentOperation()
  }, [targetSignature])

  useEffect(() => {
    if (attempt.phase === 'reason_required') reasonRef.current?.focus()
  }, [attempt.phase])

  const submitCurrentAttempt = async (
    submission,
    generation,
    transitionType,
    operationContext,
  ) => {
    dispatch({ type: transitionType, generation })
    const operation = await submitAttendanceLocationAttempt({
      guard: operationContext.guard,
      generation,
      submission,
      onSubmit: operationContext.onSubmit,
      onSuccess: operationContext.onSuccess,
      onSubmitted: () => dispatch({ type: 'submit-success', generation }),
    })
    if (!operationContext.guard.isCurrent(generation) || operation.status === 'stale') return

    if (operation.status === 'failed') {
      if (operation.stage === 'submit' &&
          operation.error?.code === 'ATTENDANCE_ABNORMAL_REASON_REQUIRED') {
        dispatch({
          type: 'reason-required',
          generation,
          errorCode: 'ATTENDANCE_ABNORMAL_REASON_REQUIRED',
        })
      } else if (operation.stage === 'refresh') {
        dispatch({
          type: 'refresh-failure',
          generation,
          errorCode: safeErrorCode(operation.error, 'ATTENDANCE_REFRESH_FAILED'),
        })
      } else {
        dispatch({
          type: 'submit-failure',
          generation,
          errorCode: safeErrorCode(operation.error, 'ATTENDANCE_SERVICE_UNAVAILABLE'),
        })
      }
      guardRef.current.finish(generation)
      return
    }

    dispatch({ type: 'refresh-success', generation })
    if (!operationContext.guard.isCurrent(generation)) return
    const restartGeneration = guardRef.current.invalidate()
    attemptTargetSignatureRef.current = null
    dispatch({ type: 'restart', generation: restartGeneration })
  }

  const beginLocation = async () => {
    if (effectiveDisabled) return
    const generation = guardRef.current.begin()
    if (generation === null) return
    const operationContext = createOperationContext(generation)

    const controller = new AbortController()
    controllerRef.current = controller
    dispatch({ type: 'locate-start', generation })
    const located = await acquireAttendanceLocationAttempt({
      guard: operationContext.guard,
      generation,
      signal: controller.signal,
      locationService: operationContext.locationService,
      createRequestId: operationContext.createRequestId,
      targetLocation: operationContext.targetLocation,
    })
    if (!operationContext.guard.isCurrent(generation) || located.status === 'stale') return
    if (controllerRef.current === controller) controllerRef.current = null

    if (located.status === 'failed') {
      dispatch({
        type: 'locate-failure',
        generation,
        errorCode: safeErrorCode(located.error, 'GEOLOCATION_UNAVAILABLE'),
      })
      guardRef.current.finish(generation)
      return
    }

    attemptTargetSignatureRef.current = operationContext.targetSignature
    dispatch({
      type: 'locate-success',
      generation,
      requestId: located.requestId,
      location: located.location,
      preview: located.preview,
    })
    if (located.preview.result === 'abnormal') {
      guardRef.current.finish(generation)
      return
    }
    await submitCurrentAttempt({
      requestId: located.requestId,
      location: located.location,
      abnormalReason: null,
    }, generation, 'submit-start', operationContext)
    if (!operationContext.guard.isCurrent(generation)) return
  }

  const handleReasonSubmit = () => {
    if (attemptTargetSignatureRef.current !== targetSignature) {
      invalidateCurrentOperation()
      return
    }
    const generation = guardRef.current.begin()
    if (generation === null) return
    const operationContext = createOperationContext(generation)
    let submission
    try {
      submission = buildAttendanceSubmission(attempt)
    } catch (error) {
      dispatch({
        type: 'validation-failure',
        errorCode: safeErrorCode(error, 'ATTENDANCE_ABNORMAL_REASON_INVALID'),
      })
      guardRef.current.finish(generation)
      return
    }
    void submitCurrentAttempt(submission, generation, 'submit-start', operationContext)
  }

  const handleRetrySubmit = () => {
    if (attemptTargetSignatureRef.current !== targetSignature) {
      invalidateCurrentOperation()
      return
    }
    const generation = guardRef.current.begin()
    if (generation === null) return
    const operationContext = createOperationContext(generation)
    let submission
    try {
      submission = buildAttendanceSubmission(attempt)
    } catch (error) {
      dispatch({
        type: 'submit-failure',
        generation,
        errorCode: safeErrorCode(error, 'ATTENDANCE_SERVICE_UNAVAILABLE'),
      })
      guardRef.current.finish(generation)
      return
    }
    void submitCurrentAttempt(submission, generation, 'retry-submit', operationContext)
  }

  const handleRelocate = () => {
    invalidateCurrentOperation()
    void beginLocation()
  }

  const busy = ['locating', 'submitting', 'refreshing'].includes(attempt.phase)
  const errorMessage = attempt.errorCode
    ? ERROR_MESSAGES[attempt.errorCode] || '本次操作失败，请重试'
    : ''
  const disabledExplanation = targetInvalid
    ? action === 'clock_out'
      ? '当前场次的项目定位不可用，请刷新后重试。'
      : '当前项目定位不可用，请重新选择项目。'
    : disabled
      ? disabledReason || '当前打卡操作暂不可用。'
      : ''
  const describedBy = [
    statusId,
    errorMessage ? errorId : '',
    disabledExplanation ? disabledDescriptionId : '',
  ].filter(Boolean).join(' ')

  return (
    <section
      className="attendance-location-action"
      aria-label={actionLabel(action)}
      aria-busy={busy}
    >
      {attempt.preview ? (
        <div className="attendance-location-result">
          <p>定位预览，服务器结果为准</p>
          <strong>
            {attempt.preview.result === 'normal' ? '预览结果：范围内' : '预览结果：范围外或精度不足'}
          </strong>
          <span>
            距离 {Math.round(attempt.preview.distanceMeters)} 米・精度 ±{Math.round(attempt.preview.accuracyMeters)} 米・半径 {attempt.preview.radiusMeters} 米
          </span>
        </div>
      ) : null}

      {attempt.phase === 'reason_required' ? (
        <div className="attendance-location-reason">
          <label htmlFor={reasonId}>异常原因</label>
          <textarea
            ref={reasonRef}
            id={reasonId}
            value={attempt.abnormalReason}
            aria-describedby={describedBy}
            disabled={effectiveDisabled}
            onChange={(event) => dispatch({ type: 'reason-change', value: event.target.value })}
          />
          <button
            className="attendance-location-submit"
            type="button"
            disabled={effectiveDisabled || busy}
            aria-describedby={describedBy}
            onClick={handleReasonSubmit}
          >
            提交异常打卡
          </button>
        </div>
      ) : null}

      {attempt.phase === 'idle' ? (
        <button
          className="attendance-location-start"
          type="button"
          disabled={effectiveDisabled}
          aria-describedby={describedBy}
          onClick={() => void beginLocation()}
        >
          {actionLabel(action)}
        </button>
      ) : null}

      {attempt.phase === 'failed' && attempt.requestId && attempt.location ? (
        <div className="attendance-location-recovery">
          <button
            className="attendance-location-retry"
            type="button"
            disabled={effectiveDisabled || busy}
            aria-describedby={describedBy}
            onClick={handleRetrySubmit}
          >
            重试提交
          </button>
          <button
            className="attendance-location-relocate"
            type="button"
            disabled={effectiveDisabled || busy}
            aria-describedby={describedBy}
            onClick={handleRelocate}
          >
            重新定位
          </button>
        </div>
      ) : attempt.phase === 'failed' ? (
        <button
          className="attendance-location-relocate"
          type="button"
          disabled={effectiveDisabled || busy}
          aria-describedby={describedBy}
          onClick={handleRelocate}
        >
          重新定位
        </button>
      ) : null}

      {attempt.phase === 'reason_required' ? (
        <button
          className="attendance-location-relocate"
          type="button"
          disabled={effectiveDisabled || busy}
          aria-describedby={describedBy}
          onClick={handleRelocate}
        >
          重新定位
        </button>
      ) : null}

      <p
        id={statusId}
        className="attendance-location-status"
        role="status"
        aria-live="polite"
      >
        {phaseStatus(attempt.phase)}
      </p>
      {errorMessage ? (
        <p id={errorId} className="attendance-location-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {disabledExplanation ? (
        <p id={disabledDescriptionId} className="attendance-location-guidance">
          {disabledExplanation}
        </p>
      ) : null}
    </section>
  )
}

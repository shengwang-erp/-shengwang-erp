import {
  normalizeAbnormalReason,
  previewAttendanceLocation,
} from './attendanceDomain.js'

const isGeneration = (value) => Number.isInteger(value) && value >= 0
const isNonBlankString = (value) => typeof value === 'string' && Boolean(value.trim())

export function isAttendanceTargetGeometryValid(targetLocation) {
  return Number.isFinite(targetLocation?.latitude) &&
    targetLocation.latitude >= -90 && targetLocation.latitude <= 90 &&
    Number.isFinite(targetLocation?.longitude) &&
    targetLocation.longitude >= -180 && targetLocation.longitude <= 180 &&
    Number.isFinite(targetLocation?.attendanceRadiusMeters) &&
    targetLocation.attendanceRadiusMeters > 0
}

function currentAction(state, action) {
  return action.generation === undefined || action.generation === state.generation
}

function nextLocationGeneration(state, action) {
  const generation = action.generation === undefined
    ? state.generation + 1
    : action.generation
  return isGeneration(generation) && generation > state.generation ? generation : null
}

function submissionGeneration(state, action) {
  const generation = action.generation === undefined
    ? state.generation
    : action.generation
  return isGeneration(generation) && generation >= state.generation ? generation : null
}

function retryGeneration(state, action) {
  const generation = action.generation === undefined
    ? state.generation + 1
    : action.generation
  return isGeneration(generation) && generation > state.generation ? generation : null
}

function hasMeasuredAttempt(state) {
  return isNonBlankString(state?.requestId) && Boolean(state?.location)
}

function canBuildSubmission(state) {
  try {
    buildAttendanceSubmission(state)
    return true
  } catch {
    return false
  }
}

export function createAttendanceLocationAttempt(generation = 0) {
  return {
    phase: 'idle',
    generation: isGeneration(generation) ? generation : 0,
    requestId: null,
    location: null,
    preview: null,
    abnormalReason: '',
    requiresReason: false,
    errorCode: null,
    failureStage: null,
  }
}

export function attendanceLocationAttemptReducer(state, action) {
  switch (action?.type) {
    case 'locate-start': {
      if (state.phase !== 'idle') return state
      const generation = nextLocationGeneration(state, action)
      if (generation === null) return state
      return { ...createAttendanceLocationAttempt(generation), phase: 'locating' }
    }
    case 'locate-success':
      if (state.phase !== 'locating' || !currentAction(state, action) ||
          !isNonBlankString(action.requestId) || !action.location ||
          !['normal', 'abnormal'].includes(action.preview?.result)) return state
      return {
        ...state,
        phase: action.preview.result === 'abnormal' ? 'reason_required' : 'ready',
        requestId: action.requestId,
        location: action.location,
        preview: action.preview,
        requiresReason: action.preview.result === 'abnormal',
        errorCode: null,
        failureStage: null,
      }
    case 'locate-failure':
      if (state.phase !== 'locating' || !currentAction(state, action)) return state
      return {
        ...state,
        phase: 'failed',
        errorCode: action.errorCode || 'GEOLOCATION_UNAVAILABLE',
        failureStage: 'locate',
      }
    case 'reason-change':
      if (state.phase !== 'reason_required') return state
      return { ...state, abnormalReason: String(action.value ?? ''), errorCode: null }
    case 'validation-failure':
      if (state.phase !== 'reason_required') return state
      return {
        ...state,
        errorCode: action.errorCode || 'ATTENDANCE_ABNORMAL_REASON_INVALID',
      }
    case 'reason-required':
      if (state.phase !== 'submitting' || !currentAction(state, action) ||
          !hasMeasuredAttempt(state)) return state
      return {
        ...state,
        phase: 'reason_required',
        requiresReason: true,
        errorCode: action.errorCode || 'ATTENDANCE_ABNORMAL_REASON_REQUIRED',
        failureStage: null,
      }
    case 'submit-start': {
      if (!['ready', 'reason_required'].includes(state.phase) ||
          !hasMeasuredAttempt(state) || !canBuildSubmission(state)) return state
      const generation = submissionGeneration(state, action)
      if (generation === null) return state
      return {
        ...state,
        phase: 'submitting',
        generation,
        errorCode: null,
        failureStage: null,
      }
    }
    case 'retry-submit': {
      if (state.phase !== 'failed' ||
          !['submit', 'refresh'].includes(state.failureStage) ||
          !hasMeasuredAttempt(state) || !canBuildSubmission(state)) return state
      const generation = retryGeneration(state, action)
      if (generation === null) return state
      return {
        ...state,
        phase: 'submitting',
        generation,
        errorCode: null,
        failureStage: null,
      }
    }
    case 'submit-failure':
      if (state.phase !== 'submitting' || !currentAction(state, action)) return state
      return {
        ...state,
        phase: 'failed',
        errorCode: action.errorCode || 'ATTENDANCE_SERVICE_UNAVAILABLE',
        failureStage: 'submit',
      }
    case 'submit-success':
      if (state.phase !== 'submitting' || !currentAction(state, action)) return state
      return {
        ...state,
        phase: 'refreshing',
        errorCode: null,
        failureStage: null,
      }
    case 'refresh-failure':
      if (state.phase !== 'refreshing' || !currentAction(state, action)) return state
      return {
        ...state,
        phase: 'failed',
        errorCode: action.errorCode || 'ATTENDANCE_REFRESH_FAILED',
        failureStage: 'refresh',
      }
    case 'refresh-success':
      if (state.phase !== 'refreshing' || !currentAction(state, action)) return state
      return {
        ...state,
        phase: 'succeeded',
        errorCode: null,
        failureStage: null,
      }
    case 'restart': {
      const generation = action.generation === undefined
        ? state.generation + 1
        : action.generation
      if (!isGeneration(generation) || generation <= state.generation) return state
      return createAttendanceLocationAttempt(generation)
    }
    default:
      return state
  }
}

export function buildAttendanceSubmission(state) {
  if (!hasMeasuredAttempt(state)) {
    throw new TypeError('attendance location attempt is incomplete')
  }
  return {
    requestId: state.requestId,
    location: state.location,
    abnormalReason: state.requiresReason
      ? normalizeAbnormalReason(state.abnormalReason, { required: true })
      : null,
  }
}

export function createAttendanceLocationOperationGuard() {
  let mounted = true
  let locked = false
  let generation = 0

  return Object.freeze({
    mount() {
      if (mounted) return generation
      mounted = true
      locked = false
      generation += 1
      return generation
    },
    begin() {
      if (!mounted || locked) return null
      locked = true
      generation += 1
      return generation
    },
    isCurrent(token) {
      return mounted && locked && token === generation
    },
    finish(token) {
      if (mounted && locked && token === generation) locked = false
    },
    invalidate() {
      generation += 1
      locked = false
      return generation
    },
    unmount() {
      mounted = false
      locked = false
      generation += 1
      return generation
    },
  })
}

export function createAttendanceLocationOperationScope({
  guard,
  generation,
  isContextCurrent,
}) {
  return Object.freeze({
    isCurrent(token) {
      if (token !== generation || !guard?.isCurrent(token)) return false
      try {
        return isContextCurrent() === true
      } catch {
        return false
      }
    },
  })
}

export function createAttendanceLocationOperationContext({
  guard,
  generation,
  targetSignature,
  isTargetCurrent,
  targetLocation,
  locationService,
  createRequestId,
  onSubmit,
  onSuccess,
}) {
  const operationGuard = createAttendanceLocationOperationScope({
    guard,
    generation,
    isContextCurrent: () => isTargetCurrent(targetSignature),
  })
  return Object.freeze({
    guard: operationGuard,
    targetSignature,
    targetLocation,
    locationService,
    createRequestId,
    onSubmit,
    onSuccess,
  })
}

export async function acquireAttendanceLocationAttempt({
  guard,
  generation,
  signal,
  locationService,
  createRequestId,
  targetLocation,
}) {
  let measuredLocation
  try {
    measuredLocation = await locationService.getCurrentLocation({ signal })
  } catch (error) {
    if (!guard.isCurrent(generation)) return { status: 'stale' }
    return { status: 'failed', stage: 'locate', error }
  }
  if (!guard.isCurrent(generation)) return { status: 'stale' }

  try {
    const requestId = createRequestId()
    if (!guard.isCurrent(generation)) return { status: 'stale' }
    if (!isNonBlankString(requestId)) {
      throw new TypeError('attendance request id is required')
    }
    const preview = previewAttendanceLocation({
      center: targetLocation,
      location: measuredLocation,
    })
    if (!guard.isCurrent(generation)) return { status: 'stale' }
    return {
      status: 'located',
      requestId,
      location: measuredLocation,
      preview,
    }
  } catch (error) {
    if (!guard.isCurrent(generation)) return { status: 'stale' }
    return { status: 'failed', stage: 'locate', error }
  }
}

export async function submitAttendanceLocationAttempt({
  guard,
  generation,
  submission,
  onSubmit,
  onSuccess,
  onSubmitted,
}) {
  let serverResult
  try {
    serverResult = await onSubmit(submission)
  } catch (error) {
    if (!guard.isCurrent(generation)) return { status: 'stale' }
    return { status: 'failed', stage: 'submit', error }
  }
  if (!guard.isCurrent(generation)) return { status: 'stale' }
  onSubmitted?.(serverResult)
  if (!guard.isCurrent(generation)) return { status: 'stale' }

  try {
    await onSuccess(serverResult)
  } catch (error) {
    if (!guard.isCurrent(generation)) return { status: 'stale' }
    return { status: 'failed', stage: 'refresh', error, serverResult }
  }
  if (!guard.isCurrent(generation)) return { status: 'stale' }
  return { status: 'succeeded', serverResult }
}

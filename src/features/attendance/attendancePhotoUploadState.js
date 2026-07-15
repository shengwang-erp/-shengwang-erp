import { ATTENDANCE_PHOTO_PHASES } from './attendancePhotoDomain.js'

const isNonBlankString = (value) => typeof value === 'string' && Boolean(value.trim())

function isPendingReservation(value) {
  return value?.uploadStatus === 'pending' &&
    isNonBlankString(value.photoId) &&
    isNonBlankString(value.workPointId) &&
    ATTENDANCE_PHOTO_PHASES.includes(value.phase)
}

function actionMatchesReservation(action, reservation) {
  return isPendingReservation(reservation) &&
    isNonBlankString(action?.photoId) &&
    action.photoId === reservation.photoId
}

function photoMatchesReservation(photo, reservation, uploadStatus) {
  return isPendingReservation(reservation) &&
    photo?.uploadStatus === uploadStatus &&
    photo.photoId === reservation.photoId &&
    photo.workPointId === reservation.workPointId &&
    photo.phase === reservation.phase
}

function isInitialState(state) {
  return state?.phase === 'idle' &&
    state.file === null &&
    state.reservation === null &&
    state.activePhoto === null &&
    state.failedStage === null &&
    state.errorCode === null
}

function canSelect(state) {
  if (state?.reservation !== null) return false
  return state?.phase === 'idle' ||
    state?.phase === 'selected' ||
    state?.phase === 'cleanup_pending' ||
    (state?.phase === 'failed' && state.failedStage === 'reserve')
}

function canReset(state) {
  if (state?.reservation !== null) return false
  return state?.phase === 'idle' ||
    state?.phase === 'selected' ||
    state?.phase === 'active' ||
    state?.phase === 'cleanup_pending' ||
    (state?.phase === 'failed' && state.failedStage === 'reserve')
}

export function createAttendancePhotoUploadState() {
  return {
    phase: 'idle', file: null, reservation: null, activePhoto: null,
    failedStage: null, errorCode: null,
  }
}

export function attendancePhotoUploadReducer(state, action) {
  switch (action.type) {
    case 'hydrate-pending':
      if (!isInitialState(state) || !isPendingReservation(action.reservation)) return state
      return {
        ...createAttendancePhotoUploadState(), phase: 'failed',
        reservation: action.reservation, failedStage: 'finalize',
        errorCode: 'ATTENDANCE_PHOTO_CONFIRMATION_PENDING',
      }
    case 'select':
      if (!canSelect(state)) return state
      return { ...createAttendancePhotoUploadState(), phase: 'selected', file: action.file }
    case 'reserve-start':
      if (state.phase !== 'selected' || !state.file || state.reservation !== null) return state
      return { ...state, phase: 'reserving', failedStage: null, errorCode: null }
    case 'reserve-success':
      if (state.phase !== 'reserving' || !isPendingReservation(action.reservation)) return state
      return { ...state, phase: 'uploading', reservation: action.reservation }
    case 'reserve-failure':
      if (state.phase !== 'reserving') return state
      return { ...state, phase: 'failed', failedStage: 'reserve', errorCode: action.errorCode }
    case 'upload-success':
      if (state.phase !== 'uploading' || !actionMatchesReservation(action, state.reservation)) return state
      return { ...state, phase: 'confirming' }
    case 'upload-failure':
      if (state.phase !== 'uploading' || !actionMatchesReservation(action, state.reservation)) return state
      return { ...state, phase: 'failed', failedStage: 'upload', errorCode: action.errorCode }
    case 'finalize-retry':
      if (state.phase !== 'failed' || state.failedStage !== 'finalize' ||
          !isPendingReservation(state.reservation)) return state
      return { ...state, phase: 'confirming', failedStage: null, errorCode: null }
    case 'finalize-success':
      if (state.phase !== 'confirming' ||
          !photoMatchesReservation(action.photo, state.reservation, 'active')) return state
      return {
        ...state, phase: 'active', activePhoto: action.photo,
        file: null, reservation: null, failedStage: null, errorCode: null,
      }
    case 'finalize-failure':
      if (state.phase !== 'confirming' ||
          !actionMatchesReservation(action, state.reservation)) return state
      return { ...state, phase: 'failed', failedStage: 'finalize', errorCode: action.errorCode }
    case 'abandon-start':
      if (state.phase !== 'failed' ||
          !['upload', 'abandon'].includes(state.failedStage) ||
          !actionMatchesReservation(action, state.reservation)) return state
      return { ...state, failedStage: 'abandon', errorCode: null }
    case 'abandon-success':
      if (state.phase !== 'failed' || state.failedStage !== 'abandon' ||
          !photoMatchesReservation(action.photo, state.reservation, 'cleanup_pending')) return state
      return { ...createAttendancePhotoUploadState(), phase: 'cleanup_pending' }
    case 'abandon-failure':
      if (state.phase !== 'failed' || state.failedStage !== 'abandon' ||
          !actionMatchesReservation(action, state.reservation)) return state
      return { ...state, errorCode: action.errorCode }
    case 'reset':
      if (!canReset(state)) return state
      return createAttendancePhotoUploadState()
    default:
      return state
  }
}

export function canRetryAttendancePhotoUpload(state) {
  return state?.phase === 'failed' &&
    state.failedStage === 'finalize' &&
    isPendingReservation(state.reservation)
}

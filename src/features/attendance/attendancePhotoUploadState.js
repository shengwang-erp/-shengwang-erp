export function createAttendancePhotoUploadState() {
  return {
    phase: 'idle', file: null, reservation: null, activePhoto: null,
    failedStage: null, errorCode: null,
  }
}

export function attendancePhotoUploadReducer(state, action) {
  switch (action.type) {
    case 'hydrate-pending':
      return {
        ...createAttendancePhotoUploadState(), phase: 'failed',
        reservation: action.reservation, failedStage: 'finalize',
        errorCode: 'ATTENDANCE_PHOTO_CONFIRMATION_PENDING',
      }
    case 'select':
      return { ...createAttendancePhotoUploadState(), phase: 'selected', file: action.file }
    case 'reserve-start':
      if (state.phase !== 'selected') return state
      return { ...state, phase: 'reserving', failedStage: null, errorCode: null }
    case 'reserve-success':
      if (state.phase !== 'reserving') return state
      return { ...state, phase: 'uploading', reservation: action.reservation }
    case 'reserve-failure':
      return { ...state, phase: 'failed', failedStage: 'reserve', errorCode: action.errorCode }
    case 'upload-success':
      if (state.phase !== 'uploading') return state
      return { ...state, phase: 'confirming' }
    case 'upload-failure':
      return { ...state, phase: 'failed', failedStage: 'upload', errorCode: action.errorCode }
    case 'finalize-retry':
      if (state.failedStage !== 'finalize' || !state.reservation) return state
      return { ...state, phase: 'confirming', errorCode: null }
    case 'finalize-success':
      return { ...state, phase: 'active', activePhoto: action.photo, file: null, reservation: null, failedStage: null, errorCode: null }
    case 'finalize-failure':
      return { ...state, phase: 'failed', failedStage: 'finalize', errorCode: action.errorCode }
    case 'abandon-start':
      return { ...state, phase: 'failed', failedStage: 'abandon', errorCode: null }
    case 'abandon-success':
      return { ...createAttendancePhotoUploadState(), phase: 'cleanup_pending' }
    case 'abandon-failure':
      return { ...state, phase: 'failed', failedStage: 'abandon', errorCode: action.errorCode }
    case 'reset':
      return createAttendancePhotoUploadState()
    default:
      return state
  }
}

export function canRetryAttendancePhotoUpload(state) {
  return state?.phase === 'failed' && (
    state.failedStage === 'reserve' || state.failedStage === 'upload' ||
    (state.failedStage === 'finalize' && Boolean(state.reservation))
  )
}

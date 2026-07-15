import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attendancePhotoUploadReducer,
  canRetryAttendancePhotoUpload,
  createAttendancePhotoUploadState,
} from './attendancePhotoUploadState.js'

test('upload only becomes active after finalize succeeds', () => {
  const file = { name: 'a.jpg', type: 'image/jpeg', size: 4 }
  const reservation = { photoId: 'photo-1', uploadStatus: 'pending' }
  let state = createAttendancePhotoUploadState()
  state = attendancePhotoUploadReducer(state, { type: 'select', file })
  state = attendancePhotoUploadReducer(state, { type: 'reserve-start' })
  state = attendancePhotoUploadReducer(state, { type: 'reserve-success', reservation })
  state = attendancePhotoUploadReducer(state, { type: 'upload-success' })
  assert.equal(state.phase, 'confirming')
  assert.equal(state.activePhoto, null)
  state = attendancePhotoUploadReducer(state, { type: 'finalize-success', photo: { photoId: 'photo-1', uploadStatus: 'active' } })
  assert.equal(state.phase, 'active')
  assert.equal(state.activePhoto.uploadStatus, 'active')
})

test('uncertain finalize failures keep reservation for finalize-only retry', () => {
  const reservation = { photoId: 'photo-1', uploadStatus: 'pending' }
  const state = attendancePhotoUploadReducer({
    ...createAttendancePhotoUploadState(), phase: 'confirming', reservation,
  }, { type: 'finalize-failure', errorCode: 'ATTENDANCE_SERVICE_UNAVAILABLE' })
  assert.equal(state.phase, 'failed')
  assert.equal(state.failedStage, 'finalize')
  assert.equal(state.reservation, reservation)
  assert.equal(canRetryAttendancePhotoUpload(state), true)
})

test('abandon reaches cleanup_pending and reset does not mutate another state', () => {
  const first = attendancePhotoUploadReducer({
    ...createAttendancePhotoUploadState(), phase: 'failed', failedStage: 'upload',
  }, { type: 'abandon-success' })
  const second = createAttendancePhotoUploadState()
  assert.equal(first.phase, 'cleanup_pending')
  assert.equal(second.phase, 'idle')
})

test('a pending reservation restored after reload is finalize-retryable', () => {
  const reservation = { photoId: 'photo-restored', uploadStatus: 'pending' }
  const state = attendancePhotoUploadReducer(
    createAttendancePhotoUploadState(),
    { type: 'hydrate-pending', reservation },
  )
  assert.equal(state.phase, 'failed')
  assert.equal(state.failedStage, 'finalize')
  assert.equal(state.reservation, reservation)
  assert.equal(canRetryAttendancePhotoUpload(state), true)
})

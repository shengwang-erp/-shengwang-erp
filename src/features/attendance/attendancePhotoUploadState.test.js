import assert from 'node:assert/strict'
import test from 'node:test'

import {
  attendancePhotoUploadReducer,
  canRetryAttendancePhotoUpload,
  createAttendancePhotoUploadState,
} from './attendancePhotoUploadState.js'

const file = Object.freeze({ name: 'a.jpg', type: 'image/jpeg', size: 4 })
const replacementFile = Object.freeze({ name: 'b.jpg', type: 'image/jpeg', size: 5 })
const reservation = Object.freeze({
  photoId: '74000000-0000-4000-8000-000000000001',
  workPointId: '73000000-0000-4000-8000-000000000001',
  phase: 'before',
  uploadStatus: 'pending',
})
const otherReservation = Object.freeze({
  photoId: '74000000-0000-4000-8000-000000000002',
  workPointId: '73000000-0000-4000-8000-000000000002',
  phase: 'after',
  uploadStatus: 'pending',
})
const activePhoto = Object.freeze({ ...reservation, uploadStatus: 'active' })
const cleanupPhoto = Object.freeze({ ...reservation, uploadStatus: 'cleanup_pending' })
const ATTEMPT_A = 'attempt-a'
const ATTEMPT_B = 'attempt-b'

function stateAtUploading() {
  let state = createAttendancePhotoUploadState()
  state = attendancePhotoUploadReducer(state, { type: 'select', file })
  state = attendancePhotoUploadReducer(state, { type: 'reserve-start', attemptId: ATTEMPT_A })
  state = attendancePhotoUploadReducer(state, {
    type: 'reserve-success', attemptId: ATTEMPT_A, reservation,
  })
  return state
}

function stateAtConfirming() {
  return attendancePhotoUploadReducer(stateAtUploading(), {
    type: 'upload-success', photoId: reservation.photoId,
  })
}

test('upload only becomes active after a correlated active finalize result', () => {
  const confirming = stateAtConfirming()
  assert.equal(confirming.phase, 'confirming')
  assert.equal(confirming.activePhoto, null)

  const active = attendancePhotoUploadReducer(confirming, {
    type: 'finalize-success', photo: activePhoto,
  })
  assert.equal(active.phase, 'active')
  assert.equal(active.activePhoto, activePhoto)
  assert.equal(active.file, null)
  assert.equal(active.reservation, null)
})

test('uncertain finalize failures keep the pending reservation for finalize-only retry', () => {
  const failed = attendancePhotoUploadReducer(stateAtConfirming(), {
    type: 'finalize-failure',
    photoId: reservation.photoId,
    errorCode: 'ATTENDANCE_SERVICE_UNAVAILABLE',
  })
  assert.equal(failed.phase, 'failed')
  assert.equal(failed.failedStage, 'finalize')
  assert.equal(failed.reservation, reservation)
  assert.equal(canRetryAttendancePhotoUpload(failed), true)
  assert.equal(attendancePhotoUploadReducer(failed, {
    type: 'abandon-start', photoId: reservation.photoId,
  }), failed)

  const retrying = attendancePhotoUploadReducer(failed, { type: 'finalize-retry' })
  assert.equal(retrying.phase, 'confirming')
  assert.equal(retrying.reservation, reservation)
  assert.equal(retrying.errorCode, null)
})

test('retry helper advertises only finalize with a valid pending reservation', () => {
  for (const failedStage of ['reserve', 'upload', 'abandon']) {
    assert.equal(canRetryAttendancePhotoUpload({
      ...createAttendancePhotoUploadState(),
      phase: 'failed',
      failedStage,
      reservation: failedStage === 'reserve' ? null : reservation,
    }), false)
  }
  assert.equal(canRetryAttendancePhotoUpload({
    ...createAttendancePhotoUploadState(),
    phase: 'failed',
    failedStage: 'recovered',
    reservation,
  }), true)
  for (const invalidReservation of [
    null,
    { ...reservation, uploadStatus: 'active' },
    { ...reservation, photoId: '' },
    { ...reservation, workPointId: '   ' },
    { ...reservation, phase: 'during' },
  ]) {
    const state = {
      ...createAttendancePhotoUploadState(),
      phase: 'failed',
      failedStage: 'finalize',
      reservation: invalidReservation,
    }
    assert.equal(canRetryAttendancePhotoUpload(state), false)
    assert.equal(attendancePhotoUploadReducer(state, { type: 'finalize-retry' }), state)
  }
})

test('hydrate accepts only a valid pending reservation in an initial state', () => {
  const initial = createAttendancePhotoUploadState()
  const hydrated = attendancePhotoUploadReducer(initial, { type: 'hydrate-pending', reservation })
  assert.equal(hydrated.phase, 'failed')
  assert.equal(hydrated.failedStage, 'recovered')
  assert.equal(hydrated.reservation, reservation)
  assert.equal(canRetryAttendancePhotoUpload(hydrated), true)

  for (const invalidReservation of [
    null,
    { ...reservation, uploadStatus: 'active' },
    { ...reservation, photoId: '' },
    { ...reservation, workPointId: '   ' },
    { ...reservation, phase: 'during' },
  ]) {
    const state = createAttendancePhotoUploadState()
    assert.equal(attendancePhotoUploadReducer(
      state,
      { type: 'hydrate-pending', reservation: invalidReservation },
    ), state)
  }

  const selected = attendancePhotoUploadReducer(initial, { type: 'select', file })
  assert.equal(attendancePhotoUploadReducer(
    selected,
    { type: 'hydrate-pending', reservation: otherReservation },
  ), selected)

  const staleAttempt = { ...initial, attemptId: ATTEMPT_A }
  assert.equal(attendancePhotoUploadReducer(
    staleAttempt,
    { type: 'hydrate-pending', reservation },
  ), staleAttempt)
})

test('recovered pending reservation stays locked and can finalize', () => {
  const recovered = attendancePhotoUploadReducer(
    createAttendancePhotoUploadState(),
    { type: 'hydrate-pending', reservation },
  )
  assert.equal(recovered.failedStage, 'recovered')
  assert.equal(canRetryAttendancePhotoUpload(recovered), true)
  assert.equal(attendancePhotoUploadReducer(recovered, { type: 'select', file }), recovered)
  assert.equal(attendancePhotoUploadReducer(recovered, { type: 'reset' }), recovered)

  const confirming = attendancePhotoUploadReducer(recovered, { type: 'finalize-retry' })
  assert.equal(confirming.phase, 'confirming')
  assert.equal(confirming.reservation, reservation)
  const active = attendancePhotoUploadReducer(confirming, {
    type: 'finalize-success', photo: activePhoto,
  })
  assert.equal(active.phase, 'active')
  assert.equal(active.activePhoto, activePhoto)
})

test('recovered pending reservation can abandon only through correlated cleanup', () => {
  const recovered = attendancePhotoUploadReducer(
    createAttendancePhotoUploadState(),
    { type: 'hydrate-pending', reservation },
  )
  assert.equal(attendancePhotoUploadReducer(recovered, {
    type: 'abandon-start', photoId: otherReservation.photoId,
  }), recovered)
  const abandoning = attendancePhotoUploadReducer(recovered, {
    type: 'abandon-start', photoId: reservation.photoId,
  })
  assert.equal(abandoning.failedStage, 'abandon')
  assert.equal(abandoning.reservation, reservation)
  assert.equal(attendancePhotoUploadReducer(abandoning, {
    type: 'abandon-success', photo: { ...cleanupPhoto, phase: 'after' },
  }), abandoning)
  const cleaned = attendancePhotoUploadReducer(abandoning, {
    type: 'abandon-success', photo: cleanupPhoto,
  })
  assert.equal(cleaned.phase, 'cleanup_pending')
  assert.equal(cleaned.reservation, null)
})

test('every async success and failure is phase-guarded and photo-correlated', () => {
  const idle = createAttendancePhotoUploadState()
  for (const action of [
    { type: 'reserve-success', attemptId: ATTEMPT_A, reservation },
    { type: 'reserve-failure', attemptId: ATTEMPT_A, errorCode: 'STALE' },
    { type: 'upload-success', photoId: reservation.photoId },
    { type: 'upload-failure', photoId: reservation.photoId, errorCode: 'STALE' },
    { type: 'finalize-success', photo: activePhoto },
    { type: 'finalize-failure', photoId: reservation.photoId, errorCode: 'STALE' },
    { type: 'abandon-success', photo: cleanupPhoto },
    { type: 'abandon-failure', photoId: reservation.photoId, errorCode: 'STALE' },
  ]) assert.equal(attendancePhotoUploadReducer(idle, action), idle)

  const reserving = attendancePhotoUploadReducer(
    attendancePhotoUploadReducer(idle, { type: 'select', file }),
    { type: 'reserve-start', attemptId: ATTEMPT_A },
  )
  const badReservation = { ...reservation, uploadStatus: 'active' }
  assert.equal(attendancePhotoUploadReducer(
    reserving,
    { type: 'reserve-success', attemptId: ATTEMPT_A, reservation: badReservation },
  ), reserving)
  const reserveFailed = attendancePhotoUploadReducer(reserving, {
    type: 'reserve-failure', attemptId: ATTEMPT_A, errorCode: 'RESERVE_FAILED',
  })
  assert.equal(reserveFailed.failedStage, 'reserve')
  assert.equal(reserveFailed.attemptId, null)

  const uploading = stateAtUploading()
  for (const action of [
    { type: 'upload-success', photoId: otherReservation.photoId },
    { type: 'upload-failure', photoId: otherReservation.photoId, errorCode: 'STALE' },
  ]) assert.equal(attendancePhotoUploadReducer(uploading, action), uploading)
  const uploadFailed = attendancePhotoUploadReducer(uploading, {
    type: 'upload-failure', photoId: reservation.photoId, errorCode: 'UPLOAD_FAILED',
  })
  assert.equal(uploadFailed.failedStage, 'upload')
  assert.equal(uploadFailed.reservation, reservation)

  const confirming = stateAtConfirming()
  assert.equal(attendancePhotoUploadReducer(confirming, {
    type: 'finalize-failure', photoId: otherReservation.photoId, errorCode: 'STALE',
  }), confirming)
  const finalizeFailed = attendancePhotoUploadReducer(confirming, {
    type: 'finalize-failure', photoId: reservation.photoId, errorCode: 'FINALIZE_FAILED',
  })
  assert.equal(finalizeFailed.failedStage, 'finalize')
  assert.equal(finalizeFailed.reservation, reservation)

  const abandoning = attendancePhotoUploadReducer(uploadFailed, {
    type: 'abandon-start', photoId: reservation.photoId,
  })
  assert.equal(attendancePhotoUploadReducer(abandoning, {
    type: 'abandon-failure', photoId: otherReservation.photoId, errorCode: 'STALE',
  }), abandoning)
  const abandonFailed = attendancePhotoUploadReducer(abandoning, {
    type: 'abandon-failure', photoId: reservation.photoId, errorCode: 'ABANDON_FAILED',
  })
  assert.equal(abandonFailed.failedStage, 'abandon')
  assert.equal(abandonFailed.reservation, reservation)
})

test('finalize success rejects stale, mismatched, non-active and null photos', () => {
  const confirming = stateAtConfirming()
  for (const photo of [
    null,
    reservation,
    { ...activePhoto, photoId: otherReservation.photoId },
    { ...activePhoto, workPointId: otherReservation.workPointId },
    { ...activePhoto, phase: 'after' },
  ]) assert.equal(attendancePhotoUploadReducer(
    confirming,
    { type: 'finalize-success', photo },
  ), confirming)
})

test('unresolved async phases and pending reservations lock select reset and hydrate', () => {
  const initial = createAttendancePhotoUploadState()
  const selected = attendancePhotoUploadReducer(initial, { type: 'select', file })
  const reserving = attendancePhotoUploadReducer(selected, {
    type: 'reserve-start', attemptId: ATTEMPT_A,
  })
  const uploading = stateAtUploading()
  const confirming = stateAtConfirming()
  const uploadFailed = attendancePhotoUploadReducer(uploading, {
    type: 'upload-failure', photoId: reservation.photoId, errorCode: 'UPLOAD_FAILED',
  })
  const finalizeFailed = attendancePhotoUploadReducer(confirming, {
    type: 'finalize-failure', photoId: reservation.photoId, errorCode: 'FINALIZE_FAILED',
  })
  const abandoning = attendancePhotoUploadReducer(uploadFailed, {
    type: 'abandon-start', photoId: reservation.photoId,
  })

  for (const locked of [reserving, uploading, confirming, uploadFailed, finalizeFailed, abandoning]) {
    for (const action of [
      { type: 'select', file: replacementFile },
      { type: 'reset' },
      { type: 'hydrate-pending', reservation: otherReservation },
    ]) assert.equal(attendancePhotoUploadReducer(locked, action), locked)
  }
})

test('reserve failures restart only through a fresh select and reserve flow', () => {
  const selected = attendancePhotoUploadReducer(createAttendancePhotoUploadState(), { type: 'select', file })
  const reserving = attendancePhotoUploadReducer(selected, {
    type: 'reserve-start', attemptId: ATTEMPT_A,
  })
  const failed = attendancePhotoUploadReducer(reserving, {
    type: 'reserve-failure', attemptId: ATTEMPT_A, errorCode: 'RESERVE_FAILED',
  })
  assert.equal(canRetryAttendancePhotoUpload(failed), false)

  const reselected = attendancePhotoUploadReducer(failed, { type: 'select', file: replacementFile })
  assert.equal(reselected.phase, 'selected')
  assert.equal(reselected.file, replacementFile)
  assert.equal(attendancePhotoUploadReducer(
    reselected,
    { type: 'reserve-start', attemptId: ATTEMPT_B },
  ).phase, 'reserving')
})

test('reserve completions require a nonblank matching attempt and reject stale attempt A during B', () => {
  const selectedA = attendancePhotoUploadReducer(
    createAttendancePhotoUploadState(),
    { type: 'select', file },
  )
  for (const attemptId of [undefined, '', '   ']) {
    assert.equal(attendancePhotoUploadReducer(
      selectedA,
      { type: 'reserve-start', attemptId },
    ), selectedA)
  }

  const reservingA = attendancePhotoUploadReducer(selectedA, {
    type: 'reserve-start', attemptId: ATTEMPT_A,
  })
  assert.equal(reservingA.phase, 'reserving')
  assert.equal(reservingA.attemptId, ATTEMPT_A)
  const failedA = attendancePhotoUploadReducer(reservingA, {
    type: 'reserve-failure', attemptId: ATTEMPT_A, errorCode: 'A_FAILED',
  })
  assert.equal(failedA.phase, 'failed')
  assert.equal(failedA.failedStage, 'reserve')
  assert.equal(failedA.attemptId, null)

  const selectedB = attendancePhotoUploadReducer(failedA, {
    type: 'select', file: replacementFile,
  })
  const reservingB = attendancePhotoUploadReducer(selectedB, {
    type: 'reserve-start', attemptId: ATTEMPT_B,
  })
  assert.equal(reservingB.attemptId, ATTEMPT_B)
  for (const staleAction of [
    { type: 'reserve-success', attemptId: ATTEMPT_A, reservation },
    { type: 'reserve-failure', attemptId: ATTEMPT_A, errorCode: 'STALE_A' },
  ]) assert.equal(attendancePhotoUploadReducer(reservingB, staleAction), reservingB)

  const uploadingB = attendancePhotoUploadReducer(reservingB, {
    type: 'reserve-success', attemptId: ATTEMPT_B, reservation: otherReservation,
  })
  assert.equal(uploadingB.phase, 'uploading')
  assert.equal(uploadingB.reservation, otherReservation)
  assert.equal(uploadingB.attemptId, null)
})

test('upload failures require correlated abandon cleanup before a new attempt', () => {
  const failed = attendancePhotoUploadReducer(stateAtUploading(), {
    type: 'upload-failure', photoId: reservation.photoId, errorCode: 'UPLOAD_FAILED',
  })
  assert.equal(canRetryAttendancePhotoUpload(failed), false)
  assert.equal(attendancePhotoUploadReducer(
    failed,
    { type: 'abandon-start', photoId: otherReservation.photoId },
  ), failed)

  const abandoning = attendancePhotoUploadReducer(failed, {
    type: 'abandon-start', photoId: reservation.photoId,
  })
  for (const photo of [
    null,
    activePhoto,
    { ...cleanupPhoto, photoId: otherReservation.photoId },
    { ...cleanupPhoto, workPointId: otherReservation.workPointId },
    { ...cleanupPhoto, phase: 'after' },
  ]) assert.equal(attendancePhotoUploadReducer(
    abandoning,
    { type: 'abandon-success', photo },
  ), abandoning)

  const cleaned = attendancePhotoUploadReducer(abandoning, {
    type: 'abandon-success', photo: cleanupPhoto,
  })
  assert.equal(cleaned.phase, 'cleanup_pending')
  assert.equal(cleaned.reservation, null)
  assert.equal(cleaned.activePhoto, null)
  assert.equal(attendancePhotoUploadReducer(
    cleaned,
    { type: 'abandon-success', photo: cleanupPhoto },
  ), cleaned)

  const selected = attendancePhotoUploadReducer(cleaned, { type: 'select', file: replacementFile })
  assert.equal(selected.phase, 'selected')
  assert.equal(selected.file, replacementFile)
})

test('successful transitions return distinct state without mutating frozen input', () => {
  const selected = Object.freeze({
    ...createAttendancePhotoUploadState(),
    phase: 'selected',
    file,
  })
  const snapshot = { ...selected }
  const reserving = attendancePhotoUploadReducer(selected, {
    type: 'reserve-start', attemptId: ATTEMPT_A,
  })
  assert.notEqual(reserving, selected)
  assert.deepEqual(selected, snapshot)

  const reset = attendancePhotoUploadReducer(selected, { type: 'reset' })
  assert.notEqual(reset, selected)
  assert.deepEqual(reset, createAttendancePhotoUploadState())
  assert.deepEqual(selected, snapshot)
})

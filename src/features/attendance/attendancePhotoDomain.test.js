import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendancePhotoValidationError,
  MAX_ATTENDANCE_PHOTO_BYTES,
  normalizeAttendancePhotoPhase,
  validateAttendancePhotoFile,
} from './attendancePhotoDomain.js'

function file(name, type, size, lastModified = Date.parse('2026-07-15T08:00:00Z')) {
  return { name, type, size, lastModified }
}

function assertPhotoError(callback, code) {
  assert.throws(callback, (error) =>
    error instanceof AttendancePhotoValidationError && error.code === code
  )
}

test('photo validation accepts five MIME types and exact 20 MiB', () => {
  for (const [name, type] of [
    ['a.jpg', 'image/jpeg'],
    ['a.png', 'image/png'],
    ['a.webp', 'image/webp'],
    ['a.heic', 'image/heic'],
    ['a.heif', 'image/heif'],
  ]) assert.equal(validateAttendancePhotoFile(file(name, type, MAX_ATTENDANCE_PHOTO_BYTES)).contentType, type)
  assert.equal(validateAttendancePhotoFile(file('camera.heic', '', 1)).contentType, 'image/heic')
  assert.equal(validateAttendancePhotoFile(file('camera.heif', '', 1)).contentType, 'image/heif')
})

test('photo validation rejects empty, oversize and spoofed files', () => {
  for (const [candidate, code] of [
    [file('a.jpg', 'image/jpeg', 0), 'ATTENDANCE_PHOTO_SIZE_INVALID'],
    [file('a.jpg', 'image/jpeg', MAX_ATTENDANCE_PHOTO_BYTES + 1), 'ATTENDANCE_PHOTO_SIZE_INVALID'],
    [file('a.jpg', 'application/pdf', 1), 'ATTENDANCE_PHOTO_TYPE_INVALID'],
    [file('a.png', 'image/jpeg', 1), 'ATTENDANCE_PHOTO_TYPE_INVALID'],
    [file('a.jpg', '', 1), 'ATTENDANCE_PHOTO_TYPE_INVALID'],
  ]) assertPhotoError(() => validateAttendancePhotoFile(candidate), code)
})

test('photo filenames require a non-leading extension and reject control characters', () => {
  for (const name of ['jpg', '.jpg', 'photo.']) {
    assertPhotoError(
      () => validateAttendancePhotoFile(file(name, 'image/jpeg', 1)),
      'ATTENDANCE_PHOTO_TYPE_INVALID',
    )
  }
  assertPhotoError(
    () => validateAttendancePhotoFile(file('', 'image/jpeg', 1)),
    'ATTENDANCE_PHOTO_NAME_INVALID',
  )
  assertPhotoError(
    () => validateAttendancePhotoFile(file('bad\u0000.jpg', 'image/jpeg', 1)),
    'ATTENDANCE_PHOTO_NAME_INVALID',
  )

  const exactName = `${'😀'.repeat(251)}.jpg`
  assert.equal([...validateAttendancePhotoFile(file(exactName, 'image/jpeg', 1)).originalFileName].length, 255)
  assertPhotoError(
    () => validateAttendancePhotoFile(file(`${'😀'.repeat(252)}.jpg`, 'image/jpeg', 1)),
    'ATTENDANCE_PHOTO_NAME_INVALID',
  )
})

test('photo phases accept only the two public canonical values', () => {
  assert.equal(normalizeAttendancePhotoPhase('before'), 'before')
  assert.equal(normalizeAttendancePhotoPhase('after'), 'after')
  assertPhotoError(
    () => normalizeAttendancePhotoPhase('during'),
    'ATTENDANCE_PHOTO_PHASE_INVALID',
  )
})

test('photo capture time is projected safely when representable', () => {
  assert.equal(
    validateAttendancePhotoFile(file('a.jpg', 'image/jpeg', 1)).capturedAt,
    '2026-07-15T08:00:00.000Z',
  )
  assert.equal(validateAttendancePhotoFile(file('a.jpg', 'image/jpeg', 1, 0)).capturedAt, null)
  assert.equal(
    validateAttendancePhotoFile(file('a.jpg', 'image/jpeg', 1, 8_640_000_000_000_001)).capturedAt,
    null,
  )
})

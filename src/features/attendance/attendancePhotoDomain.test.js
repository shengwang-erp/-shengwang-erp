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
  for (const candidate of [
    file('a.jpg', 'image/jpeg', 0),
    file('a.jpg', 'image/jpeg', MAX_ATTENDANCE_PHOTO_BYTES + 1),
    file('a.jpg', 'application/pdf', 1),
    file('a.png', 'image/jpeg', 1),
    file('a.jpg', '', 1),
  ]) assert.throws(() => validateAttendancePhotoFile(candidate), AttendancePhotoValidationError)
  assert.throws(() => normalizeAttendancePhotoPhase('during'), AttendancePhotoValidationError)
})

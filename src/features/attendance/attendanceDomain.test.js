import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendanceValidationError,
  canClockOut,
  classifyAttendanceLocation,
  createAttendanceWorkPointDraft,
  isAttendanceProjectEligible,
  isCompleteAttendanceWorkPoint,
  normalizeAbnormalReason,
  normalizeAttendanceLocation,
  normalizeAttendanceWorkPointInput,
  previewAttendanceLocation,
  surfaceDistanceMeters,
} from './attendanceDomain.js'

function assertAttendanceError(callback, code) {
  assert.throws(callback, (error) =>
    error instanceof AttendanceValidationError && error.code === code
  )
}

const eligibleProject = {
  projectId: 'P001',
  projectName: '东京站现场',
  status: '进行中',
  address: '東京都 千代田区 1-1',
  latitude: 35.681236,
  longitude: 139.767125,
  attendanceRadiusMeters: 300,
  locationConfirmedAt: '2026-07-15T00:00:00.000Z',
  locationAddressSnapshot: '東京都　千代田区 1-1',
}

test('attendance project eligibility is strict and never defaults a bad radius', () => {
  assert.equal(isAttendanceProjectEligible(eligibleProject), true)
  for (const patch of [
    { status: '报价中' },
    { address: ' ' },
    { latitude: null },
    { longitude: 181 },
    { attendanceRadiusMeters: undefined },
    { attendanceRadiusMeters: '300' },
    { attendanceRadiusMeters: true },
    { attendanceRadiusMeters: Number.NaN },
    { attendanceRadiusMeters: 0 },
    { attendanceRadiusMeters: -1 },
    { locationConfirmedAt: '' },
    { locationAddressSnapshot: '別住所' },
  ]) assert.equal(isAttendanceProjectEligible({ ...eligibleProject, ...patch }), false)
})

test('location normalization accepts raw valid numbers and rejects repaired inputs', () => {
  assert.deepEqual(normalizeAttendanceLocation({
    latitude: 35.681236,
    longitude: 139.767125,
    accuracyMeters: 12.5,
    deviceRecordedAt: '2026-07-15T08:00:00.000Z',
  }), {
    latitude: 35.681236,
    longitude: 139.767125,
    accuracyMeters: 12.5,
    deviceRecordedAt: '2026-07-15T08:00:00.000Z',
  })
  assert.equal(normalizeAttendanceLocation({
    latitude: 35.681236,
    longitude: 139.767125,
    accuracyMeters: 1,
    deviceRecordedAt: 123,
  }).deviceRecordedAt, null)

  for (const location of [
    { latitude: 91, longitude: 139.767125, accuracyMeters: 1 },
    { latitude: 35.681236, longitude: -181, accuracyMeters: 1 },
    { latitude: 35.681236, longitude: 139.767125, accuracyMeters: 0 },
    { latitude: 35.681236, longitude: 139.767125, accuracyMeters: '10' },
  ]) assertAttendanceError(
    () => normalizeAttendanceLocation(location),
    'ATTENDANCE_LOCATION_INVALID',
  )
})

test('location preview preserves and validates the raw project radius', () => {
  const center = {
    latitude: 35.681236,
    longitude: 139.767125,
    attendanceRadiusMeters: 300,
  }
  const location = {
    latitude: 35.681236,
    longitude: 139.767125,
    accuracyMeters: 50,
  }
  assert.deepEqual(previewAttendanceLocation({ center, location }), {
    distanceMeters: 0,
    accuracyMeters: 50,
    radiusMeters: 300,
    result: 'normal',
  })

  for (const attendanceRadiusMeters of ['300', true, undefined, Number.NaN]) {
    assertAttendanceError(
      () => previewAttendanceLocation({
        center: { ...center, attendanceRadiusMeters },
        location,
      }),
      'ATTENDANCE_LOCATION_INVALID',
    )
  }
})

test('normal location includes the exact distance plus accuracy boundary', () => {
  assert.equal(classifyAttendanceLocation({ distanceMeters: 250, accuracyMeters: 50, radiusMeters: 300 }), 'normal')
  assert.equal(classifyAttendanceLocation({ distanceMeters: 250.001, accuracyMeters: 50, radiusMeters: 300 }), 'abnormal')
  assert.equal(classifyAttendanceLocation({ distanceMeters: 0, accuracyMeters: 301, radiusMeters: 300 }), 'abnormal')
  assert.equal(Math.round(surfaceDistanceMeters(
    { latitude: 35.681236, longitude: 139.767125 },
    { latitude: 35.681236, longitude: 139.767125 },
  )), 0)
})

test('abnormal reasons and work point text use code-point limits', () => {
  assert.equal(normalizeAbnormalReason(' 交通管制 ', { required: true }), '交通管制')
  const exactReason = '😀'.repeat(500)
  assert.equal(normalizeAbnormalReason(exactReason, { required: true }), exactReason)
  assert.equal([...normalizeAbnormalReason(exactReason, { required: true })].length, 500)
  assertAttendanceError(
    () => normalizeAbnormalReason('  ', { required: true }),
    'ATTENDANCE_ABNORMAL_REASON_INVALID',
  )
  assertAttendanceError(
    () => normalizeAbnormalReason('😀'.repeat(501), { required: true }),
    'ATTENDANCE_ABNORMAL_REASON_INVALID',
  )
  assert.equal(normalizeAttendanceWorkPointInput({
    ordinal: 1,
    areaName: '  北侧墙面 ',
    workDescription: ' 下地施工 ',
    completionNote: ' 完成 ',
  }).areaName, '北侧墙面')
  for (const [field, limit] of [
    ['areaName', 100],
    ['workDescription', 1000],
    ['completionNote', 1000],
  ]) {
    const exact = '😀'.repeat(limit)
    assert.equal(normalizeAttendanceWorkPointInput({ ordinal: 1, [field]: exact })[field], exact)
    assertAttendanceError(
      () => normalizeAttendanceWorkPointInput({ ordinal: 1, [field]: '😀'.repeat(limit + 1) }),
      'ATTENDANCE_WORK_POINT_TEXT_INVALID',
    )
  }
  assertAttendanceError(
    () => normalizeAttendanceWorkPointInput({ ordinal: 8 }),
    'ATTENDANCE_WORK_POINT_ORDINAL_INVALID',
  )
})

test('work point draft creation and completeness are directly observable', () => {
  assert.deepEqual(createAttendanceWorkPointDraft(3), {
    ordinal: 3,
    areaName: '',
    workDescription: '',
    completionNote: '',
  })
  assertAttendanceError(
    () => createAttendanceWorkPointDraft(0),
    'ATTENDANCE_WORK_POINT_ORDINAL_INVALID',
  )

  const complete = {
    ordinal: 1,
    areaName: '北侧墙面',
    workDescription: '完成下地施工',
    photos: {
      before: { uploadStatus: 'active' },
      after: { uploadStatus: 'active' },
    },
  }
  assert.equal(isCompleteAttendanceWorkPoint(complete), true)
  assert.equal(isCompleteAttendanceWorkPoint({
    ...complete,
    photos: { before: { uploadStatus: 'active' }, after: null },
  }), false)
})

test('one complete point permits clock out while other incomplete points are neutral', () => {
  const complete = {
    ordinal: 1,
    areaName: '北侧墙面',
    workDescription: '完成下地施工',
    photos: {
      before: { uploadStatus: 'active' },
      after: { uploadStatus: 'active' },
    },
  }
  assert.equal(canClockOut([complete]), true)
  assert.equal(canClockOut([{ ordinal: 2, areaName: '南侧', photos: {} }, complete]), true)
  assert.equal(canClockOut([{ ...complete, photos: { before: { uploadStatus: 'pending' }, after: null } }]), false)
})

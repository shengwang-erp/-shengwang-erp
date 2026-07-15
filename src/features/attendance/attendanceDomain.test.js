import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendanceValidationError,
  canClockOut,
  classifyAttendanceLocation,
  isAttendanceProjectEligible,
  normalizeAbnormalReason,
  normalizeAttendanceWorkPointInput,
  surfaceDistanceMeters,
} from './attendanceDomain.js'

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
    { attendanceRadiusMeters: 0 },
    { attendanceRadiusMeters: -1 },
    { locationConfirmedAt: '' },
    { locationAddressSnapshot: '別住所' },
  ]) assert.equal(isAttendanceProjectEligible({ ...eligibleProject, ...patch }), false)
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
  assert.equal(normalizeAbnormalReason('理'.repeat(500), { required: true }).length, 500)
  assert.throws(() => normalizeAbnormalReason('  ', { required: true }), AttendanceValidationError)
  assert.throws(() => normalizeAbnormalReason('理'.repeat(501), { required: true }), AttendanceValidationError)
  assert.equal(normalizeAttendanceWorkPointInput({
    ordinal: 1,
    areaName: '  北侧墙面 ',
    workDescription: ' 下地施工 ',
    completionNote: ' 完成 ',
  }).areaName, '北侧墙面')
  assert.throws(() => normalizeAttendanceWorkPointInput({ ordinal: 8 }), AttendanceValidationError)
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
  assert.equal(canClockOut([complete, { ordinal: 2, areaName: '南侧', photos: {} }]), true)
  assert.equal(canClockOut([{ ...complete, photos: { before: { uploadStatus: 'pending' }, after: null } }]), false)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { AttendanceServiceError, createAttendanceService } from './attendanceService.js'

const source = await readFile(new URL('./attendanceService.js', import.meta.url), 'utf8').catch(() => '')

function responseFor(name, args = {}) {
  if (name === 'list_attendance_projects_secure') return []
  if (name === 'get_my_today_attendance_secure') return {
    workDate: '2026-07-15', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: null, completedSessions: [], pendingPhotoReservations: [],
  }
  if (name === 'list_attendance_records_secure') return {
    access: { scope: 'own' }, filterOptions: { projects: [], employees: [] }, items: [], nextCursor: null,
  }
  if (name === 'reserve_attendance_photo_secure') return {
    photoId: '74000000-0000-4000-8000-000000000001', workPointId: '73000000-0000-4000-8000-000000000001',
    phase: 'before', bucketId: 'erp-attendance-photos',
    objectPath: 'a/b/c/d/before', originalFileName: 'a.jpg', contentType: 'image/jpeg',
    sizeBytes: 1, uploadStatus: 'pending', capturedAt: null, createdAt: '2026-07-15T00:00:00Z',
  }
  if (name.includes('photo')) return { ...responseFor('reserve_attendance_photo_secure'), uploadStatus: name.startsWith('finalize') ? 'active' : 'cleanup_pending' }
  if (name.includes('work_point')) return {
    workPointId: '73000000-0000-4000-8000-000000000001', sessionId: '71000000-0000-4000-8000-000000000001',
    ordinal: 1, areaName: '北侧', workDescription: '施工', completionNote: '',
    createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    photos: { before: null, after: null },
  }
  const eventType = name.startsWith('clock_out') ? 'clock_out' : 'clock_in'
  const event = {
    eventId: eventType === 'clock_out'
      ? '72000000-0000-4000-8000-000000000002'
      : '72000000-0000-4000-8000-000000000001',
    requestId: args.p_request_id,
    eventType,
    serverRecordedAt: '2026-07-15T08:00:00Z',
    deviceRecordedAt: args.p_device_recorded_at,
    latitude: args.p_latitude,
    longitude: args.p_longitude,
    accuracyMeters: args.p_accuracy_meters,
    distanceMeters: 10,
    radiusMeters: 300,
    result: 'normal',
    abnormalReason: null,
  }
  const clockInEvent = eventType === 'clock_in' ? event : {
    ...event,
    eventId: '72000000-0000-4000-8000-000000000001',
    requestId: '70000000-0000-4000-8000-000000000001',
    eventType: 'clock_in',
  }
  return {
    session: {
      sessionId: '71000000-0000-4000-8000-000000000001',
      employeeProfileId: '52000000-0000-4000-8000-000000000001',
      employeeNumberSnapshot: 'SW-5101',
      employeeNameSnapshot: '普通员工',
      projectId: 'P001',
      projectNameSnapshot: '东京站现场',
      projectAddressSnapshot: '東京都 千代田区 1-1',
      projectLatitudeSnapshot: 35.681236,
      projectLongitudeSnapshot: 139.767125,
      attendanceRadiusMetersSnapshot: 300,
      workDate: '2026-07-15',
      status: eventType === 'clock_out' ? 'closed' : 'open',
      openedAt: '2026-07-15T08:00:00Z',
      closedAt: eventType === 'clock_out' ? '2026-07-15T17:00:00Z' : null,
      clockInEvent,
      clockOutEvent: eventType === 'clock_out' ? event : null,
      workPoints: [],
    },
    event,
  }
}

test('clock calls send device facts but no trusted server fields', async () => {
  const calls = []
  const service = createAttendanceService({ rpc: async (name, args) => {
    calls.push([name, args])
    return { data: responseFor(name, args), error: null }
  } }, { configured: true })
  const location = { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: '2026-07-15T00:00:00Z' }
  const clockInRequestId = '70000000-0000-4000-8000-000000000001'
  const clockOutRequestId = '70000000-0000-4000-8000-000000000002'
  await service.clockIn({ projectId: 'P001', requestId: clockInRequestId, location, abnormalReason: null })
  await service.clockOut({ sessionId: '71000000-0000-4000-8000-000000000001', requestId: clockOutRequestId, location, abnormalReason: ' 交通管制 ' })
  assert.deepEqual(calls, [
    ['clock_in_project_secure', {
      p_project_id: 'P001', p_request_id: clockInRequestId, p_latitude: 35, p_longitude: 139,
      p_accuracy_meters: 10, p_device_recorded_at: '2026-07-15T00:00:00Z', p_abnormal_reason: null,
    }],
    ['clock_out_project_secure', {
      p_session_id: '71000000-0000-4000-8000-000000000001',
      p_request_id: clockOutRequestId, p_latitude: 35, p_longitude: 139,
      p_accuracy_meters: 10, p_device_recorded_at: '2026-07-15T00:00:00Z', p_abnormal_reason: '交通管制',
    }],
  ])
  for (const forbidden of [
    'employeeId', 'employeeName', 'workDate', 'distanceMeters', 'result',
    'radiusMeters', 'projectId', 'projectLatitude', 'p_employee_id',
    'p_employee_name', 'p_work_date', 'p_distance_meters', 'p_result',
    'p_radius_meters', 'p_project_id', 'p_project_latitude',
  ]) {
    assert.equal(Object.hasOwn(calls[1][1], forbidden), false)
  }
})

test('attendance service is RPC-only and fails closed', async () => {
  assert.doesNotMatch(source, /\.from\(|localStorage|sessionStorage|indexedDB|baseRecordService|console\./)
  const service = createAttendanceService({ rpc: async () => ({
    data: null, error: { message: 'private auth detail' }, status: 401,
  }) }, { configured: true })
  await assert.rejects(() => service.listAttendanceProjects(), (error) =>
    error instanceof AttendanceServiceError && error.code === 'AUTH_INVALID' &&
    error.authInvalid === true && !error.message.includes('private'))
  const forbidden = createAttendanceService({ rpc: async () => ({
    data: null, error: { message: 'private policy detail' }, status: 403,
  }) }, { configured: true })
  await assert.rejects(() => forbidden.getMyTodayAttendance(), (error) =>
    error.code === 'ATTENDANCE_ACCESS_DENIED' && !error.message.includes('private'))
  const offline = createAttendanceService(null, { configured: false })
  await assert.rejects(() => offline.getMyTodayAttendance(), (error) => error.code === 'ATTENDANCE_NOT_CONFIGURED')
})

test('all non-clock methods use exact secure RPC names and arguments', async () => {
  const calls = []
  const service = createAttendanceService({ rpc: async (name, args) => {
    calls.push([name, args])
    return { data: responseFor(name, args), error: null }
  } }, { configured: true })
  await service.listAttendanceProjects()
  await service.getMyTodayAttendance()
  await service.upsertWorkPoint({
    sessionId: '71000000-0000-4000-8000-000000000001', ordinal: 1,
    areaName: ' 北侧 ', workDescription: ' 施工 ', completionNote: '',
  })
  const metadata = {
    workPointId: '73000000-0000-4000-8000-000000000001', phase: 'before',
    originalFileName: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 1,
    checksumSha256: null, capturedAt: null,
  }
  await service.reservePhoto(metadata)
  await service.finalizePhoto({ photoId: '74000000-0000-4000-8000-000000000001' })
  await service.abandonPhoto({ photoId: '74000000-0000-4000-8000-000000000001' })
  await service.listAttendanceRecords({
    workDate: '2026-07-15', projectId: 'P001',
    employeeProfileId: '52000000-0000-4000-8000-000000000001',
    beforeOpenedAt: null, beforeSessionId: null, limit: 50,
  })
  assert.deepEqual(calls, [
    ['list_attendance_projects_secure', {}],
    ['get_my_today_attendance_secure', {}],
    ['upsert_attendance_work_point_secure', {
      p_session_id: '71000000-0000-4000-8000-000000000001', p_ordinal: 1,
      p_area_name: '北侧', p_work_description: '施工', p_completion_note: '',
    }],
    ['reserve_attendance_photo_secure', {
      p_work_point_id: metadata.workPointId, p_phase: 'before',
      p_original_file_name: 'a.jpg', p_content_type: 'image/jpeg', p_size_bytes: 1,
      p_checksum_sha256: null, p_captured_at: null,
    }],
    ['finalize_attendance_photo_secure', {
      p_photo_id: '74000000-0000-4000-8000-000000000001',
    }],
    ['abandon_attendance_photo_secure', {
      p_photo_id: '74000000-0000-4000-8000-000000000001',
    }],
    ['list_attendance_records_secure', {
      p_work_date: '2026-07-15', p_project_id: 'P001',
      p_employee_profile_id: '52000000-0000-4000-8000-000000000001',
      p_before_opened_at: null, p_before_session_id: null, p_limit: 50,
    }],
  ])
})

test('known hints are safe and malformed DTOs fail closed', async () => {
  const known = createAttendanceService({ rpc: async () => ({
    data: null, error: { status: 400, hint: 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED', message: 'private detail' },
  }) }, { configured: true })
  await assert.rejects(() => known.getMyTodayAttendance(), (error) =>
    error.code === 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED' && !error.message.includes('private'))
  const malformed = createAttendanceService({ rpc: async () => ({
    data: { workDate: '2026-07-15', viewerAccess: { scope: 'root', canViewScopedRecords: true }, activeSession: null, completedSessions: [], pendingPhotoReservations: [] },
    error: null,
  }) }, { configured: true })
  await assert.rejects(() => malformed.getMyTodayAttendance(), (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE')
})

test('DTO validators reject missing, extra, invalid enum and malformed nested fields', async () => {
  const valid = responseFor('clock_in_project_secure', {
    p_request_id: '70000000-0000-4000-8000-000000000001',
    p_latitude: 35, p_longitude: 139, p_accuracy_meters: 10,
    p_device_recorded_at: null,
  })
  const cases = [
    { session: { ...valid.session, projectId: undefined }, event: valid.event },
    { session: { ...valid.session, unknownServerField: 'secret' }, event: valid.event },
    { session: { ...valid.session, status: 'approved' }, event: valid.event },
    { session: valid.session, event: { ...valid.event, result: 'outside' } },
    { session: {
      ...valid.session,
      workPoints: [{
        workPointId: '73000000-0000-4000-8000-000000000001',
        sessionId: valid.session.sessionId, ordinal: 1, areaName: '', workDescription: '', completionNote: '',
        createdAt: valid.session.openedAt, updatedAt: valid.session.openedAt,
        photos: { before: { uploadStatus: 'active' }, after: null },
      }],
    }, event: valid.event },
  ]
  delete cases[0].session.projectId
  for (const data of cases) {
    const service = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(
      () => service.clockIn({
        projectId: 'P001', requestId: valid.event.requestId,
        location: { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: null },
        abnormalReason: null,
      }),
      (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE' && !error.message.includes('secret'),
    )
  }
})

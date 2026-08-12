import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { AttendanceServiceError, createAttendanceService } from './attendanceService.js'

const source = await readFile(new URL('./attendanceService.js', import.meta.url), 'utf8').catch(() => '')

const REQUEST_ID = '70000000-0000-4000-8000-000000000001'
const SESSION_ID = '71000000-0000-4000-8000-000000000001'
const LOCATION = {
  latitude: 35,
  longitude: 139,
  accuracyMeters: 10,
  deviceRecordedAt: '2026-07-15T00:00:00Z',
}

function eventFor({ eventType = 'clock_in', attendanceMode = 'project', requestId = REQUEST_ID } = {}) {
  return {
    eventId: eventType === 'clock_out'
      ? '72000000-0000-4000-8000-000000000002'
      : '72000000-0000-4000-8000-000000000001',
    requestId,
    eventType,
    serverRecordedAt: '2026-07-15T08:00:00Z',
    deviceRecordedAt: LOCATION.deviceRecordedAt,
    latitude: LOCATION.latitude,
    longitude: LOCATION.longitude,
    accuracyMeters: LOCATION.accuracyMeters,
    distanceMeters: attendanceMode === 'general' ? null : 10,
    radiusMeters: attendanceMode === 'general' ? null : 300,
    result: attendanceMode === 'general' ? 'not_applicable' : 'normal',
    abnormalReason: null,
    outOfRangeConfirmedAt: null,
  }
}

function sessionFor({ attendanceMode = 'project', eventType = 'clock_in', requestId = REQUEST_ID } = {}) {
  const event = eventFor({ eventType, attendanceMode, requestId })
  const clockInEvent = eventType === 'clock_in' ? event : eventFor({ attendanceMode })
  return {
    sessionId: SESSION_ID,
    attendanceMode,
    employeeProfileId: '52000000-0000-4000-8000-000000000001',
    employeeNumberSnapshot: 'SW-5101',
    employeeNameSnapshot: '普通员工',
    projectId: attendanceMode === 'project' ? 'P001' : null,
    projectNameSnapshot: attendanceMode === 'project' ? '东京站现场' : null,
    projectAddressSnapshot: attendanceMode === 'project' ? '東京都 千代田区 1-1' : null,
    projectLatitudeSnapshot: attendanceMode === 'project' ? 35.681236 : null,
    projectLongitudeSnapshot: attendanceMode === 'project' ? 139.767125 : null,
    attendanceRadiusMetersSnapshot: attendanceMode === 'project' ? 300 : null,
    workDate: '2026-07-15',
    status: eventType === 'clock_out' ? 'closed' : 'open',
    openedAt: '2026-07-15T08:00:00Z',
    closedAt: eventType === 'clock_out' ? '2026-07-15T17:00:00Z' : null,
    clockInEvent,
    clockOutEvent: eventType === 'clock_out' ? event : null,
    workPoints: [],
  }
}

function savedFor({ attendanceMode = 'project', eventType = 'clock_in', requestId = REQUEST_ID } = {}) {
  return {
    status: 'saved',
    session: sessionFor({ attendanceMode, eventType, requestId }),
    event: eventFor({ attendanceMode, eventType, requestId }),
  }
}

function legacySessionFor({ attendanceMode = 'project', abnormal = false } = {}) {
  const session = sessionFor({ attendanceMode })
  const { attendanceMode: omittedMode, ...legacySession } = session
  void omittedMode
  const legacyEvent = (event) => {
    if (event === null) return null
    const { outOfRangeConfirmedAt: omittedConfirmation, ...candidate } = event
    void omittedConfirmation
    return abnormal
      ? { ...candidate, result: 'abnormal', abnormalReason: '历史异常原因' }
      : candidate
  }
  return {
    ...legacySession,
    clockInEvent: legacyEvent(session.clockInEvent),
    clockOutEvent: legacyEvent(session.clockOutEvent),
  }
}

function responseFor(name, args = {}) {
  if (name === 'list_attendance_projects_v2_secure') return []
  if (name === 'get_my_today_attendance_v2_secure') return {
    workDate: '2026-07-15',
    policy: { attendanceRequired: true, attendanceMode: 'project' },
    viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: null,
    completedSessions: [],
    pendingPhotoReservations: [],
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
  if (name.includes('photo')) {
    return {
      ...responseFor('reserve_attendance_photo_secure'),
      uploadStatus: name.startsWith('finalize') ? 'active' : 'cleanup_pending',
    }
  }
  if (name.includes('work_point')) return {
    workPointId: '73000000-0000-4000-8000-000000000001', sessionId: SESSION_ID,
    ordinal: 1, areaName: '北侧', workDescription: '施工', completionNote: '',
    createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
    photos: { before: null, after: null },
  }
  return savedFor({
    attendanceMode: name === 'clock_in_general_secure' ? 'general' : 'project',
    eventType: name.startsWith('clock_out') ? 'clock_out' : 'clock_in',
    requestId: args.p_request_id,
  })
}

test('clock mutations route general, project and clock-out calls with exact v2 arguments', async () => {
  const calls = []
  const responseModes = ['general', 'project', 'general', 'project']
  const service = createAttendanceService({ rpc: async (name, args) => {
    calls.push([name, args])
    return {
      data: savedFor({
        attendanceMode: responseModes[calls.length - 1],
        eventType: name.startsWith('clock_out') ? 'clock_out' : 'clock_in',
        requestId: args.p_request_id,
      }),
      error: null,
    }
  } }, { configured: true })

  await service.clockIn({ attendanceMode: 'general', requestId: REQUEST_ID, location: LOCATION })
  await service.clockIn({ attendanceMode: 'project', projectId: 'P001', requestId: REQUEST_ID, location: LOCATION })
  await service.clockOut({ attendanceMode: 'general', sessionId: SESSION_ID, requestId: REQUEST_ID, location: LOCATION })
  await service.clockOut({ attendanceMode: 'project', sessionId: SESSION_ID, requestId: REQUEST_ID, location: LOCATION })

  assert.deepEqual(calls, [
    ['clock_in_general_secure', {
      p_request_id: REQUEST_ID,
      p_latitude: 35,
      p_longitude: 139,
      p_accuracy_meters: 10,
      p_device_recorded_at: LOCATION.deviceRecordedAt,
    }],
    ['clock_in_project_v2_secure', {
      p_project_id: 'P001',
      p_request_id: REQUEST_ID,
      p_latitude: 35,
      p_longitude: 139,
      p_accuracy_meters: 10,
      p_device_recorded_at: LOCATION.deviceRecordedAt,
      p_out_of_range_confirmed: false,
    }],
    ['clock_out_attendance_v2_secure', {
      p_session_id: SESSION_ID,
      p_request_id: REQUEST_ID,
      p_latitude: 35,
      p_longitude: 139,
      p_accuracy_meters: 10,
      p_device_recorded_at: LOCATION.deviceRecordedAt,
      p_out_of_range_confirmed: false,
    }],
    ['clock_out_attendance_v2_secure', {
      p_session_id: SESSION_ID,
      p_request_id: REQUEST_ID,
      p_latitude: 35,
      p_longitude: 139,
      p_accuracy_meters: 10,
      p_device_recorded_at: LOCATION.deviceRecordedAt,
      p_out_of_range_confirmed: false,
    }],
  ])
})

test('project mutation returns only a validated saved or confirmation-required result', async () => {
  const confirmation = {
    status: 'confirmation_required',
    confirmation: {
      projectId: 'P001',
      projectName: '东京站现场',
      distanceMeters: 420.5,
      radiusMeters: 300,
      accuracyMeters: 12,
    },
  }
  const service = createAttendanceService({ rpc: async () => ({ data: confirmation, error: null }) }, { configured: true })
  assert.deepEqual(await service.clockIn({
    attendanceMode: 'project',
    projectId: 'P001',
    requestId: REQUEST_ID,
    location: LOCATION,
  }), confirmation)

  for (const data of [
    { ...confirmation, unknown: true },
    { ...confirmation, status: 'pending_confirmation' },
    { ...confirmation, confirmation: { ...confirmation.confirmation, distanceMeters: Number.NaN } },
    { ...confirmation, confirmation: { ...confirmation.confirmation, radiusMeters: Number.POSITIVE_INFINITY } },
    { ...confirmation, confirmation: { ...confirmation.confirmation, extra: 'secret' } },
  ]) {
    const malformed = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(
      () => malformed.clockIn({ attendanceMode: 'project', projectId: 'P001', requestId: REQUEST_ID, location: LOCATION }),
      (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE',
    )
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
    sessionId: SESSION_ID, ordinal: 1,
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
    ['list_attendance_projects_v2_secure', {}],
    ['get_my_today_attendance_v2_secure', {}],
    ['upsert_attendance_work_point_secure', {
      p_session_id: SESSION_ID, p_ordinal: 1,
      p_area_name: '北侧', p_work_description: '施工', p_completion_note: '',
    }],
    ['reserve_attendance_photo_secure', {
      p_work_point_id: metadata.workPointId, p_phase: 'before',
      p_original_file_name: 'a.jpg', p_content_type: 'image/jpeg', p_size_bytes: 1,
      p_checksum_sha256: null, p_captured_at: null,
    }],
    ['finalize_attendance_photo_secure', { p_photo_id: '74000000-0000-4000-8000-000000000001' }],
    ['abandon_attendance_photo_secure', { p_photo_id: '74000000-0000-4000-8000-000000000001' }],
    ['list_attendance_records_secure', {
      p_work_date: '2026-07-15', p_project_id: 'P001',
      p_employee_profile_id: '52000000-0000-4000-8000-000000000001',
      p_before_opened_at: null, p_before_session_id: null, p_limit: 50,
    }],
  ])
})

test('record read normalizes strict v1 project and general sessions without losing historical reasons', async () => {
  const page = {
    access: { scope: 'own' },
    filterOptions: { projects: [], employees: [] },
    items: [
      legacySessionFor({ attendanceMode: 'project', abnormal: true }),
      legacySessionFor({ attendanceMode: 'general' }),
    ],
    nextCursor: null,
  }
  const service = createAttendanceService({ rpc: async () => ({ data: page, error: null }) }, { configured: true })
  const result = await service.listAttendanceRecords({ workDate: '2026-07-15' })
  assert.equal(result.items[0].attendanceMode, 'project')
  assert.equal(result.items[0].clockInEvent.abnormalReason, '历史异常原因')
  assert.equal(result.items[0].clockInEvent.outOfRangeConfirmedAt, null)
  assert.equal(result.items[1].attendanceMode, 'general')
  assert.equal(result.items[1].clockInEvent.result, 'not_applicable')
})

test('known hints are safe and today policy rejects active-session mode mismatch', async () => {
  const known = createAttendanceService({ rpc: async () => ({
    data: null, error: { status: 400, hint: 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED', message: 'private detail' },
  }) }, { configured: true })
  await assert.rejects(() => known.getMyTodayAttendance(), (error) =>
    error.code === 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED' && !error.message.includes('private'))

  const today = responseFor('get_my_today_attendance_v2_secure')
  const cases = [
    { ...today, policy: { attendanceRequired: true, attendanceMode: 'general' }, activeSession: sessionFor({ attendanceMode: 'project' }) },
    { ...today, policy: { attendanceRequired: false, attendanceMode: 'exempt' }, activeSession: sessionFor({ attendanceMode: 'project' }) },
    { ...today, policy: { attendanceRequired: false, attendanceMode: 'general' } },
    { ...today, policy: { ...today.policy, unknownServerField: true } },
  ]
  for (const data of cases) {
    const malformed = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(() => malformed.getMyTodayAttendance(), (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE')
  }
})

test('v2 DTOs reject project shape, event semantics, extra keys and non-finite numbers', async () => {
  const project = savedFor()
  const general = savedFor({ attendanceMode: 'general' })
  const abnormalEvent = {
    ...project.event,
    result: 'abnormal',
    abnormalReason: 'outside attendance radius confirmed',
    outOfRangeConfirmedAt: null,
  }
  const cases = [
    { ...general, session: { ...general.session, projectId: 'P001' } },
    { ...project, session: { ...project.session, projectNameSnapshot: null } },
    { ...general, event: { ...general.event, distanceMeters: 1 } },
    { ...project, event: abnormalEvent },
    { ...project, event: { ...project.event, unknownServerField: 'secret' } },
    { ...project, event: { ...project.event, latitude: Number.NaN } },
    { ...project, session: { ...project.session, attendanceRadiusMetersSnapshot: Number.POSITIVE_INFINITY } },
    { ...project, session: { ...project.session, attendanceMode: 'general' } },
  ]
  for (const data of cases) {
    const service = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(
      () => service.clockIn({ attendanceMode: 'project', projectId: 'P001', requestId: REQUEST_ID, location: LOCATION }),
      (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE' && !error.message.includes('secret'),
    )
  }
})

test('historical abnormal reason remains readable only with structured v2 confirmation time', async () => {
  const event = {
    ...eventFor(),
    result: 'abnormal',
    abnormalReason: '历史异常原因',
    outOfRangeConfirmedAt: '2026-07-15T08:00:01Z',
  }
  const activeSession = {
    ...sessionFor(),
    clockInEvent: event,
  }
  const today = {
    ...responseFor('get_my_today_attendance_v2_secure'),
    activeSession,
  }
  const service = createAttendanceService({ rpc: async () => ({ data: today, error: null }) }, { configured: true })
  assert.equal((await service.getMyTodayAttendance()).activeSession.clockInEvent.abnormalReason, '历史异常原因')
})

test('browser clock mutations reject handwritten abnormal reasons before RPC', async () => {
  let calls = 0
  const service = createAttendanceService({ rpc: async () => {
    calls += 1
    return { data: savedFor(), error: null }
  } }, { configured: true })
  await assert.rejects(
    () => service.clockIn({
      attendanceMode: 'project', projectId: 'P001', requestId: REQUEST_ID,
      location: LOCATION, abnormalReason: '交通管制',
    }),
    (error) => error.code === 'ATTENDANCE_MUTATION_INPUT_INVALID',
  )
  assert.equal(calls, 0)
})

test('clock-in and clock-out reject malformed nested locations before RPC', async () => {
  let calls = 0
  const service = createAttendanceService({ rpc: async () => {
    calls += 1
    return { data: savedFor(), error: null }
  } }, { configured: true })
  const malformedLocations = [
    { ...LOCATION, unknown: true },
    { latitude: 35, longitude: 139, accuracyMeters: 10 },
    { ...LOCATION, deviceRecordedAt: 123 },
    { ...LOCATION, deviceRecordedAt: 'not-a-date' },
    { ...LOCATION, latitude: Number.NaN },
    { ...LOCATION, accuracyMeters: Number.POSITIVE_INFINITY },
  ]
  for (const location of malformedLocations) {
    await assert.rejects(
      () => service.clockIn({
        attendanceMode: 'project', projectId: 'P001', requestId: REQUEST_ID, location,
      }),
      (error) => error.code === 'ATTENDANCE_MUTATION_INPUT_INVALID',
    )
    await assert.rejects(
      () => service.clockOut({
        attendanceMode: 'project', sessionId: SESSION_ID, requestId: REQUEST_ID, location,
      }),
      (error) => error.code === 'ATTENDANCE_MUTATION_INPUT_INVALID',
    )
  }
  assert.equal(calls, 0)
})

test('saved clock-in response requires the requested event in the session clock-in slot', async () => {
  const otherRequestId = '70000000-0000-4000-8000-000000000002'
  const valid = savedFor()
  const malformed = [
    { ...valid, session: { ...valid.session, clockInEvent: null } },
    { ...valid, session: { ...valid.session, clockInEvent: 'invalid-event' } },
    { ...valid, session: {
      ...valid.session,
      clockInEvent: {
        ...valid.session.clockInEvent,
        eventId: '72000000-0000-4000-8000-000000000003',
      },
    } },
    { ...valid, session: {
      ...valid.session,
      clockInEvent: { ...valid.session.clockInEvent, eventType: 'clock_out' },
    } },
    { ...valid, session: {
      ...valid.session,
      clockInEvent: { ...valid.session.clockInEvent, serverRecordedAt: '2026-07-15T08:00:01Z' },
    } },
    savedFor({ requestId: otherRequestId }),
  ]
  for (const data of malformed) {
    const service = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(
      () => service.clockIn({
        attendanceMode: 'project', projectId: 'P001', requestId: REQUEST_ID, location: LOCATION,
      }),
      (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE',
    )
  }
})

test('saved clock-out response requires the requested event in the session clock-out slot', async () => {
  const valid = savedFor({ eventType: 'clock_out' })
  const malformed = [
    { ...valid, session: { ...valid.session, clockOutEvent: null } },
    { ...valid, session: {
      ...valid.session,
      clockOutEvent: {
        ...valid.session.clockOutEvent,
        requestId: '70000000-0000-4000-8000-000000000002',
      },
    } },
    { ...valid, session: {
      ...valid.session,
      clockOutEvent: { ...valid.session.clockOutEvent, latitude: 35.5 },
    } },
  ]
  for (const data of malformed) {
    const service = createAttendanceService({ rpc: async () => ({ data, error: null }) }, { configured: true })
    await assert.rejects(
      () => service.clockOut({
        attendanceMode: 'project', sessionId: SESSION_ID, requestId: REQUEST_ID, location: LOCATION,
      }),
      (error) => error.code === 'ATTENDANCE_INVALID_RESPONSE',
    )
  }
})

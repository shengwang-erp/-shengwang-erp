import {
  normalizeAbnormalReason,
  normalizeAttendanceLocation,
  normalizeAttendanceWorkPointInput,
} from '../features/attendance/attendanceDomain.js'
import { normalizeAttendancePhotoPhase } from '../features/attendance/attendancePhotoDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const SAFE_ERRORS = Object.freeze({
  ATTENDANCE_OPEN_SESSION_EXISTS: '请先完成当前项目的下班打卡',
  ATTENDANCE_SESSION_CLOSED: '该项目场次已经结束',
  ATTENDANCE_ABNORMAL_REASON_REQUIRED: '当前位置超出打卡范围，请填写异常原因',
  ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED: '至少完成一个含前后照片的工作点位后才能下班',
  ATTENDANCE_WORK_POINT_LIMIT_REACHED: '一个场次最多建立七个工作点位',
  ATTENDANCE_BEFORE_PHOTO_REQUIRED: '请先上传开工前照片',
  ATTENDANCE_PHOTO_NOT_PENDING: '照片预约状态已变化，请刷新后重试',
  ATTENDANCE_REQUEST_CONFLICT: '该打卡请求编号已被其他操作使用',
})

const INVALID_RESPONSE_MESSAGE = '考勤服务返回了无效数据'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_KEYS = ['projectId', 'projectName', 'status', 'address', 'latitude', 'longitude', 'attendanceRadiusMeters', 'locationConfirmedAt', 'locationAddressSnapshot']
const EVENT_KEYS = ['eventId', 'requestId', 'eventType', 'serverRecordedAt', 'deviceRecordedAt', 'latitude', 'longitude', 'accuracyMeters', 'distanceMeters', 'radiusMeters', 'result', 'abnormalReason']
const PHOTO_KEYS = ['photoId', 'workPointId', 'phase', 'bucketId', 'objectPath', 'originalFileName', 'contentType', 'sizeBytes', 'uploadStatus', 'capturedAt', 'createdAt']
const POINT_KEYS = ['workPointId', 'sessionId', 'ordinal', 'areaName', 'workDescription', 'completionNote', 'createdAt', 'updatedAt', 'photos']
const SESSION_KEYS = ['sessionId', 'employeeProfileId', 'employeeNumberSnapshot', 'employeeNameSnapshot', 'projectId', 'projectNameSnapshot', 'projectAddressSnapshot', 'projectLatitudeSnapshot', 'projectLongitudeSnapshot', 'attendanceRadiusMetersSnapshot', 'workDate', 'status', 'openedAt', 'closedAt', 'clockInEvent', 'clockOutEvent', 'workPoints']

export class AttendanceServiceError extends Error {
  constructor(code, message, { authInvalid = false } = {}) {
    super(message)
    this.name = 'AttendanceServiceError'
    this.code = code
    this.authInvalid = authInvalid
  }
}

function invalidResponse() {
  return new AttendanceServiceError('ATTENDANCE_INVALID_RESPONSE', INVALID_RESPONSE_MESSAGE)
}

function exactObject(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) {
    throw invalidResponse()
  }
  return value
}

function stringValue(value, { nullable = false, uuid = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !value || (uuid && !UUID.test(value))) {
    throw invalidResponse()
  }
  return value
}

function finiteNumber(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw invalidResponse()
  }
  return value
}

function validateEvent(value) {
  const row = exactObject(value, EVENT_KEYS)
  const eventType = stringValue(row.eventType)
  const result = stringValue(row.result)
  if (!['clock_in', 'clock_out'].includes(eventType) || !['normal', 'abnormal'].includes(result)) {
    throw invalidResponse()
  }
  const abnormalReason = row.abnormalReason === null ? null : stringValue(row.abnormalReason)
  if ((result === 'normal' && abnormalReason !== null) || (result === 'abnormal' && abnormalReason === null)) {
    throw invalidResponse()
  }
  return {
    eventId: stringValue(row.eventId, { uuid: true }),
    requestId: stringValue(row.requestId, { uuid: true }),
    eventType,
    serverRecordedAt: stringValue(row.serverRecordedAt),
    deviceRecordedAt: row.deviceRecordedAt === null ? null : stringValue(row.deviceRecordedAt),
    latitude: finiteNumber(row.latitude),
    longitude: finiteNumber(row.longitude),
    accuracyMeters: finiteNumber(row.accuracyMeters),
    distanceMeters: finiteNumber(row.distanceMeters),
    radiusMeters: finiteNumber(row.radiusMeters),
    result,
    abnormalReason,
  }
}

function validatePhoto(value, requiredStatus) {
  const row = exactObject(value, PHOTO_KEYS)
  if (!['before', 'after'].includes(row.phase) ||
      !['pending', 'active', 'superseded', 'cleanup_pending'].includes(row.uploadStatus) ||
      (requiredStatus && row.uploadStatus !== requiredStatus)) {
    throw invalidResponse()
  }
  return {
    photoId: stringValue(row.photoId, { uuid: true }),
    workPointId: stringValue(row.workPointId, { uuid: true }),
    phase: row.phase,
    bucketId: stringValue(row.bucketId),
    objectPath: stringValue(row.objectPath),
    originalFileName: stringValue(row.originalFileName),
    contentType: stringValue(row.contentType),
    sizeBytes: finiteNumber(row.sizeBytes),
    uploadStatus: row.uploadStatus,
    capturedAt: row.capturedAt === null ? null : stringValue(row.capturedAt),
    createdAt: stringValue(row.createdAt),
  }
}

function validateWorkPoint(value) {
  const row = exactObject(value, POINT_KEYS)
  const photos = exactObject(row.photos, ['before', 'after'])
  return {
    workPointId: stringValue(row.workPointId, { uuid: true }),
    sessionId: stringValue(row.sessionId, { uuid: true }),
    ordinal: finiteNumber(row.ordinal),
    areaName: typeof row.areaName === 'string' ? row.areaName : stringValue(row.areaName),
    workDescription: typeof row.workDescription === 'string' ? row.workDescription : stringValue(row.workDescription),
    completionNote: typeof row.completionNote === 'string' ? row.completionNote : stringValue(row.completionNote),
    createdAt: stringValue(row.createdAt),
    updatedAt: stringValue(row.updatedAt),
    photos: {
      before: photos.before === null ? null : validatePhoto(photos.before, 'active'),
      after: photos.after === null ? null : validatePhoto(photos.after, 'active'),
    },
  }
}

function validateSession(value) {
  const row = exactObject(value, SESSION_KEYS)
  if (!['open', 'closed'].includes(row.status) || !Array.isArray(row.workPoints)) {
    throw invalidResponse()
  }
  return {
    sessionId: stringValue(row.sessionId, { uuid: true }),
    employeeProfileId: stringValue(row.employeeProfileId, { uuid: true }),
    employeeNumberSnapshot: stringValue(row.employeeNumberSnapshot),
    employeeNameSnapshot: stringValue(row.employeeNameSnapshot),
    projectId: stringValue(row.projectId),
    projectNameSnapshot: stringValue(row.projectNameSnapshot),
    projectAddressSnapshot: stringValue(row.projectAddressSnapshot),
    projectLatitudeSnapshot: finiteNumber(row.projectLatitudeSnapshot),
    projectLongitudeSnapshot: finiteNumber(row.projectLongitudeSnapshot),
    attendanceRadiusMetersSnapshot: finiteNumber(row.attendanceRadiusMetersSnapshot),
    workDate: stringValue(row.workDate),
    status: row.status,
    openedAt: stringValue(row.openedAt),
    closedAt: row.closedAt === null ? null : stringValue(row.closedAt),
    clockInEvent: row.clockInEvent === null ? null : validateEvent(row.clockInEvent),
    clockOutEvent: row.clockOutEvent === null ? null : validateEvent(row.clockOutEvent),
    workPoints: row.workPoints.map(validateWorkPoint),
  }
}

function validateProjectList(value) {
  if (!Array.isArray(value)) throw invalidResponse()
  return value.map((candidate) => {
    const row = exactObject(candidate, PROJECT_KEYS)
    return {
      projectId: stringValue(row.projectId),
      projectName: stringValue(row.projectName),
      status: stringValue(row.status),
      address: stringValue(row.address),
      latitude: finiteNumber(row.latitude),
      longitude: finiteNumber(row.longitude),
      attendanceRadiusMeters: finiteNumber(row.attendanceRadiusMeters),
      locationConfirmedAt: stringValue(row.locationConfirmedAt),
      locationAddressSnapshot: stringValue(row.locationAddressSnapshot),
    }
  })
}

function validateToday(value) {
  const row = exactObject(value, ['workDate', 'viewerAccess', 'activeSession', 'completedSessions', 'pendingPhotoReservations'])
  const access = exactObject(row.viewerAccess, ['scope', 'canViewScopedRecords'])
  if (!['own', 'assigned_projects', 'all'].includes(access.scope) ||
      typeof access.canViewScopedRecords !== 'boolean' ||
      !Array.isArray(row.completedSessions) ||
      !Array.isArray(row.pendingPhotoReservations)) {
    throw invalidResponse()
  }
  return {
    workDate: stringValue(row.workDate),
    viewerAccess: { ...access },
    activeSession: row.activeSession === null ? null : validateSession(row.activeSession),
    completedSessions: row.completedSessions.map(validateSession),
    pendingPhotoReservations: row.pendingPhotoReservations.map((photo) => validatePhoto(photo, 'pending')),
  }
}

function validateClockResult(value, eventType) {
  const row = exactObject(value, ['session', 'event'])
  const event = validateEvent(row.event)
  if (event.eventType !== eventType) throw invalidResponse()
  return { session: validateSession(row.session), event }
}

function validateRecordPage(value) {
  const row = exactObject(value, ['access', 'filterOptions', 'items', 'nextCursor'])
  const access = exactObject(row.access, ['scope'])
  const filterOptions = exactObject(row.filterOptions, ['projects', 'employees'])
  if (!['own', 'assigned_projects', 'all'].includes(access.scope) ||
      !Array.isArray(filterOptions.projects) ||
      !Array.isArray(filterOptions.employees) ||
      !Array.isArray(row.items)) {
    throw invalidResponse()
  }
  const cursor = row.nextCursor === null ? null : exactObject(row.nextCursor, ['openedAt', 'sessionId'])
  return {
    access: { scope: access.scope },
    filterOptions: {
      projects: filterOptions.projects.map((item) => ({
        projectId: stringValue(exactObject(item, ['projectId', 'projectName']).projectId),
        projectName: stringValue(item.projectName),
      })),
      employees: filterOptions.employees.map((item) => ({
        employeeProfileId: stringValue(exactObject(item, ['employeeProfileId', 'employeeNumberSnapshot', 'employeeNameSnapshot']).employeeProfileId, { uuid: true }),
        employeeNumberSnapshot: stringValue(item.employeeNumberSnapshot),
        employeeNameSnapshot: stringValue(item.employeeNameSnapshot),
      })),
    },
    items: row.items.map(validateSession),
    nextCursor: cursor === null ? null : {
      openedAt: stringValue(cursor.openedAt),
      sessionId: stringValue(cursor.sessionId, { uuid: true }),
    },
  }
}

function normalizeServiceError(error, responseStatus = error?.status) {
  const status = Number(responseStatus)
  const pgCode = String(error?.code ?? '').toUpperCase()
  const hint = String(error?.hint ?? '').toUpperCase()
  if (status === 401 || ['PGRST301', 'JWT_EXPIRED'].includes(pgCode)) {
    return new AttendanceServiceError('AUTH_INVALID', '登录状态无效，请重新登录', { authInvalid: true })
  }
  if (SAFE_ERRORS[hint]) return new AttendanceServiceError(hint, SAFE_ERRORS[hint])
  if (status === 403 || pgCode === '42501') {
    return new AttendanceServiceError('ATTENDANCE_ACCESS_DENIED', '没有权限执行此操作')
  }
  return new AttendanceServiceError('ATTENDANCE_SERVICE_UNAVAILABLE', '考勤服务暂不可用，请稍后重试')
}

export function createAttendanceService(client = supabase, { configured = isSupabaseConfigured } = {}) {
  const ensureConfigured = () => {
    if (!configured || !client || typeof client.rpc !== 'function') {
      throw new AttendanceServiceError('ATTENDANCE_NOT_CONFIGURED', '云端考勤服务未配置')
    }
  }
  const call = async (name, args = {}) => {
    ensureConfigured()
    let result
    try {
      result = await client.rpc(name, args)
    } catch (error) {
      throw normalizeServiceError(error)
    }
    if (result?.error) throw normalizeServiceError(result.error, result.status)
    return result?.data
  }
  const clockArgs = ({ requestId, location, abnormalReason }) => {
    const position = normalizeAttendanceLocation(location)
    return {
      p_request_id: requestId,
      p_latitude: position.latitude,
      p_longitude: position.longitude,
      p_accuracy_meters: position.accuracyMeters,
      p_device_recorded_at: position.deviceRecordedAt,
      p_abnormal_reason: normalizeAbnormalReason(abnormalReason),
    }
  }
  return Object.freeze({
    async listAttendanceProjects() {
      return validateProjectList(await call('list_attendance_projects_secure'))
    },
    async getMyTodayAttendance() {
      return validateToday(await call('get_my_today_attendance_secure'))
    },
    async clockIn(input) {
      return validateClockResult(await call('clock_in_project_secure', {
        p_project_id: input.projectId,
        ...clockArgs(input),
      }), 'clock_in')
    },
    async upsertWorkPoint(input) {
      const point = normalizeAttendanceWorkPointInput(input)
      return validateWorkPoint(await call('upsert_attendance_work_point_secure', {
        p_session_id: input.sessionId,
        p_ordinal: point.ordinal,
        p_area_name: point.areaName,
        p_work_description: point.workDescription,
        p_completion_note: point.completionNote,
      }))
    },
    async reservePhoto(input) {
      return validatePhoto(await call('reserve_attendance_photo_secure', {
        p_work_point_id: input.workPointId,
        p_phase: normalizeAttendancePhotoPhase(input.phase),
        p_original_file_name: input.originalFileName,
        p_content_type: input.contentType,
        p_size_bytes: input.sizeBytes,
        p_checksum_sha256: input.checksumSha256 ?? null,
        p_captured_at: input.capturedAt ?? null,
      }), 'pending')
    },
    async finalizePhoto({ photoId }) {
      return validatePhoto(await call('finalize_attendance_photo_secure', { p_photo_id: photoId }), 'active')
    },
    async abandonPhoto({ photoId }) {
      return validatePhoto(await call('abandon_attendance_photo_secure', { p_photo_id: photoId }), 'cleanup_pending')
    },
    async clockOut(input) {
      return validateClockResult(await call('clock_out_project_secure', {
        p_session_id: input.sessionId,
        ...clockArgs(input),
      }), 'clock_out')
    },
    async listAttendanceRecords({
      workDate,
      projectId = null,
      employeeProfileId = null,
      beforeOpenedAt = null,
      beforeSessionId = null,
      limit = 50,
    }) {
      return validateRecordPage(await call('list_attendance_records_secure', {
        p_work_date: workDate,
        p_project_id: projectId,
        p_employee_profile_id: employeeProfileId,
        p_before_opened_at: beforeOpenedAt,
        p_before_session_id: beforeSessionId,
        p_limit: limit,
      }))
    },
  })
}

export const attendanceService = createAttendanceService()

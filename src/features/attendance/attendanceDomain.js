import { normalizeAddress } from '../projects/projectDomain.js'

export const MAX_ATTENDANCE_WORK_POINTS = 7
export const MAX_ATTENDANCE_AREA_CHARS = 100
export const MAX_ATTENDANCE_TEXT_CHARS = 1000
export const MAX_ABNORMAL_REASON_CHARS = 500

export class AttendanceValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendanceValidationError'
    this.code = code
  }
}

const textLength = (value) => [...String(value ?? '')].length
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isNumberInRange = (value, minimum, maximum) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

function invalidMutationInput() {
  throw new AttendanceValidationError('ATTENDANCE_MUTATION_INPUT_INVALID', '打卡请求数据无效')
}

function hasOnlyKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key))
}

export function normalizeAttendanceMutationInput(value, { action } = {}) {
  const isClockIn = action === 'clockIn'
  const isClockOut = action === 'clockOut'
  const keys = isClockIn
    ? ['attendanceMode', 'projectId', 'requestId', 'location', 'outOfRangeConfirmed']
    : ['attendanceMode', 'sessionId', 'requestId', 'location', 'outOfRangeConfirmed']
  if ((!isClockIn && !isClockOut) || !hasOnlyKeys(value, keys) ||
      !['project', 'general'].includes(value.attendanceMode) ||
      typeof value.requestId !== 'string' || !UUID.test(value.requestId) ||
      !value.location || typeof value.location !== 'object' || Array.isArray(value.location) ||
      (value.outOfRangeConfirmed !== undefined && typeof value.outOfRangeConfirmed !== 'boolean')) {
    invalidMutationInput()
  }

  const outOfRangeConfirmed = value.outOfRangeConfirmed ?? false
  if (value.attendanceMode === 'general' && outOfRangeConfirmed) invalidMutationInput()

  if (isClockIn) {
    const projectId = value.projectId ?? null
    if ((value.attendanceMode === 'project' && (typeof projectId !== 'string' || !projectId.trim())) ||
        (value.attendanceMode === 'general' && projectId !== null)) {
      invalidMutationInput()
    }
    return {
      attendanceMode: value.attendanceMode,
      projectId: value.attendanceMode === 'project' ? projectId.trim() : null,
      requestId: value.requestId,
      location: value.location,
      outOfRangeConfirmed,
    }
  }

  if (typeof value.sessionId !== 'string' || !UUID.test(value.sessionId)) invalidMutationInput()
  return {
    attendanceMode: value.attendanceMode,
    sessionId: value.sessionId,
    requestId: value.requestId,
    location: value.location,
    outOfRangeConfirmed,
  }
}

export function isAttendanceProjectEligible(project) {
  return Boolean(
    project &&
    ['待开工', '进行中'].includes(project.status) &&
    String(project.projectName ?? '').trim() &&
    normalizeAddress(project.address) &&
    isNumberInRange(project.latitude, -90, 90) &&
    isNumberInRange(project.longitude, -180, 180) &&
    typeof project.attendanceRadiusMeters === 'number' &&
    Number.isFinite(project.attendanceRadiusMeters) &&
    project.attendanceRadiusMeters > 0 &&
    String(project.locationConfirmedAt ?? '').trim() &&
    normalizeAddress(project.locationAddressSnapshot) === normalizeAddress(project.address)
  )
}

export function normalizeAttendanceLocation(value) {
  if (!isNumberInRange(value?.latitude, -90, 90) ||
      !isNumberInRange(value?.longitude, -180, 180) ||
      typeof value?.accuracyMeters !== 'number' ||
      !Number.isFinite(value.accuracyMeters) || value.accuracyMeters <= 0) {
    throw new AttendanceValidationError('ATTENDANCE_LOCATION_INVALID', '无法取得有效定位，请重新定位')
  }
  return {
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyMeters: value.accuracyMeters,
    deviceRecordedAt: typeof value.deviceRecordedAt === 'string' ? value.deviceRecordedAt : null,
  }
}

export function surfaceDistanceMeters(from, to) {
  const a = normalizeAttendanceLocation({ ...from, accuracyMeters: 1 })
  const b = normalizeAttendanceLocation({ ...to, accuracyMeters: 1 })
  const radians = (degrees) => degrees * Math.PI / 180
  const latitudeDelta = radians(b.latitude - a.latitude)
  const longitudeDelta = radians(b.longitude - a.longitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) *
    Math.sin(longitudeDelta / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
}

export function classifyAttendanceLocation({ distanceMeters, accuracyMeters, radiusMeters }) {
  for (const value of [distanceMeters, accuracyMeters, radiusMeters]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new AttendanceValidationError('ATTENDANCE_LOCATION_INVALID', '定位预览数据无效')
    }
  }
  if (distanceMeters < 0 || accuracyMeters <= 0 || radiusMeters <= 0) {
    throw new AttendanceValidationError('ATTENDANCE_LOCATION_INVALID', '定位预览数据无效')
  }
  return distanceMeters + accuracyMeters <= radiusMeters ? 'normal' : 'abnormal'
}

export function previewAttendanceLocation({ center, location }) {
  const normalized = normalizeAttendanceLocation(location)
  const distanceMeters = surfaceDistanceMeters(center, normalized)
  const radiusMeters = center.attendanceRadiusMeters
  return {
    distanceMeters,
    accuracyMeters: normalized.accuracyMeters,
    radiusMeters,
    result: classifyAttendanceLocation({ distanceMeters, accuracyMeters: normalized.accuracyMeters, radiusMeters }),
  }
}

export function normalizeAbnormalReason(value, { required = false } = {}) {
  const reason = String(value ?? '').trim()
  if ((required && !reason) || textLength(reason) > MAX_ABNORMAL_REASON_CHARS) {
    throw new AttendanceValidationError('ATTENDANCE_ABNORMAL_REASON_INVALID', '异常原因需填写 1–500 个字符')
  }
  return reason || null
}

export function createAttendanceWorkPointDraft(ordinal) {
  return normalizeAttendanceWorkPointInput({ ordinal, areaName: '', workDescription: '', completionNote: '' })
}

export function normalizeAttendanceWorkPointInput(value = {}) {
  const ordinal = Number(value.ordinal)
  const areaName = String(value.areaName ?? '').trim()
  const workDescription = String(value.workDescription ?? '').trim()
  const completionNote = String(value.completionNote ?? '').trim()
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > MAX_ATTENDANCE_WORK_POINTS) {
    throw new AttendanceValidationError('ATTENDANCE_WORK_POINT_ORDINAL_INVALID', '工作点位序号必须在 1–7 之间')
  }
  if (textLength(areaName) > MAX_ATTENDANCE_AREA_CHARS ||
      textLength(workDescription) > MAX_ATTENDANCE_TEXT_CHARS ||
      textLength(completionNote) > MAX_ATTENDANCE_TEXT_CHARS) {
    throw new AttendanceValidationError('ATTENDANCE_WORK_POINT_TEXT_INVALID', '现场日志文字超过长度限制')
  }
  return { ...value, ordinal, areaName, workDescription, completionNote }
}

export function isCompleteAttendanceWorkPoint(workPoint) {
  const value = normalizeAttendanceWorkPointInput(workPoint)
  return Boolean(
    value.areaName && value.workDescription &&
    value.photos?.before?.uploadStatus === 'active' &&
    value.photos?.after?.uploadStatus === 'active'
  )
}

export function canClockOut(workPoints) {
  return Array.isArray(workPoints) && workPoints.some(isCompleteAttendanceWorkPoint)
}

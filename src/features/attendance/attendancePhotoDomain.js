export const ATTENDANCE_PHOTO_BUCKET = 'erp-attendance-photos'
export const MAX_ATTENDANCE_PHOTO_BYTES = 20 * 1024 * 1024
export const ATTENDANCE_PHOTO_PHASES = Object.freeze(['before', 'after'])
export const ATTENDANCE_PHOTO_CONTENT_TYPES = Object.freeze([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
])
export const ATTENDANCE_SIGNED_URL_TTL_SECONDS = 300

export class AttendancePhotoValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendancePhotoValidationError'
    this.code = code
  }
}

const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif',
})

export function normalizeAttendancePhotoPhase(value) {
  if (!ATTENDANCE_PHOTO_PHASES.includes(value)) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_PHASE_INVALID', '照片阶段无效')
  }
  return value
}

export function validateAttendancePhotoFile(file) {
  const originalFileName = String(file?.name ?? '').trim()
  const extension = originalFileName.split('.').pop()?.toLowerCase() || ''
  const expectedType = MIME_BY_EXTENSION[extension]
  const suppliedType = String(file?.type ?? '').toLowerCase()
  const contentType = !suppliedType && ['heic', 'heif'].includes(extension)
    ? expectedType
    : suppliedType
  if (!originalFileName || [...originalFileName].length > 255 || /[\u0000-\u001f\u007f]/u.test(originalFileName)) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_NAME_INVALID', '照片文件名无效')
  }
  if (!Number.isInteger(file?.size) || file.size < 1 || file.size > MAX_ATTENDANCE_PHOTO_BYTES) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_SIZE_INVALID', '照片大小必须在 1 字节至 20 MiB 之间')
  }
  if (!ATTENDANCE_PHOTO_CONTENT_TYPES.includes(contentType) || expectedType !== contentType) {
    throw new AttendancePhotoValidationError('ATTENDANCE_PHOTO_TYPE_INVALID', '只允许 JPEG、PNG、WEBP、HEIC 或 HEIF 照片')
  }
  const timestamp = Number(file.lastModified)
  return {
    originalFileName,
    contentType,
    sizeBytes: file.size,
    capturedAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
  }
}

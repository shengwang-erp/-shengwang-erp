import {
  ATTENDANCE_PHOTO_BUCKET,
  ATTENDANCE_SIGNED_URL_TTL_SECONDS,
  validateAttendancePhotoFile,
} from '../features/attendance/attendancePhotoDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

export class AttendancePhotoStorageError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendancePhotoStorageError'
    this.code = code
  }
}

const fail = (code, message) => new AttendancePhotoStorageError(code, message)

export function createAttendancePhotoStorage(client = supabase, { configured = isSupabaseConfigured } = {}) {
  const ensureStorage = () => {
    if (!configured || !client?.storage || typeof client.storage.from !== 'function') {
      throw fail('ATTENDANCE_STORAGE_NOT_CONFIGURED', '照片存储服务未配置')
    }
  }
  return Object.freeze({
    async uploadReservedPhoto({ reservation, file }) {
      ensureStorage()
      const metadata = validateAttendancePhotoFile(file)
      if (reservation?.bucketId !== ATTENDANCE_PHOTO_BUCKET ||
          reservation?.uploadStatus !== 'pending' ||
          typeof reservation?.objectPath !== 'string' || !reservation.objectPath ||
          reservation.originalFileName !== metadata.originalFileName ||
          reservation.contentType !== metadata.contentType ||
          reservation.sizeBytes !== metadata.sizeBytes) {
        throw fail('ATTENDANCE_STORAGE_RESERVATION_MISMATCH', '照片与服务器预约不一致')
      }
      let result
      try {
        result = await client.storage.from(reservation.bucketId).upload(
          reservation.objectPath,
          file,
          { contentType: reservation.contentType, cacheControl: '0', upsert: false },
        )
      } catch {
        throw fail('ATTENDANCE_STORAGE_UPLOAD_FAILED', '照片上传失败，请重试')
      }
      if (result?.error) throw fail('ATTENDANCE_STORAGE_UPLOAD_FAILED', '照片上传失败，请重试')
      return { bucketId: reservation.bucketId, objectPath: reservation.objectPath, uploaded: true }
    },
    async createAttendancePhotoSignedUrl({ photo }) {
      ensureStorage()
      if (photo?.bucketId !== ATTENDANCE_PHOTO_BUCKET || photo?.uploadStatus !== 'active' || !photo?.objectPath) {
        throw fail('ATTENDANCE_STORAGE_PHOTO_NOT_ACTIVE', '该照片尚不可查看')
      }
      let result
      try {
        result = await client.storage.from(photo.bucketId)
          .createSignedUrl(photo.objectPath, ATTENDANCE_SIGNED_URL_TTL_SECONDS)
      } catch {
        throw fail('ATTENDANCE_STORAGE_SIGN_FAILED', '暂时无法打开照片')
      }
      if (result?.error || typeof result?.data?.signedUrl !== 'string') {
        throw fail('ATTENDANCE_STORAGE_SIGN_FAILED', '暂时无法打开照片')
      }
      return result.data.signedUrl
    },
  })
}

export const attendancePhotoStorage = createAttendancePhotoStorage()

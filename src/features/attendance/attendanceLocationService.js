import { normalizeAttendanceLocation } from './attendanceDomain.js'

export class AttendanceLocationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AttendanceLocationError'
    this.code = code
  }
}

const ERROR_MESSAGES = Object.freeze({
  GEOLOCATION_UNSUPPORTED: '当前设备不支持定位',
  GEOLOCATION_PERMISSION_DENIED: '定位权限已被拒绝，请在浏览器设置中允许定位',
  GEOLOCATION_UNAVAILABLE: '暂时无法取得位置，请移动到开阔区域后重试',
  GEOLOCATION_TIMEOUT: '定位超时，请重新获取位置',
  GEOLOCATION_INVALID: '设备返回了无效位置，请重新定位',
  GEOLOCATION_ABORTED: '本次定位已取消',
})

function locationError(code) {
  return new AttendanceLocationError(code, ERROR_MESSAGES[code])
}

export function createBrowserGeolocationAdapter({ geolocation = globalThis.navigator?.geolocation } = {}) {
  return Object.freeze({
    getCurrentPosition({ signal } = {}) {
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
        return Promise.reject(locationError('GEOLOCATION_UNSUPPORTED'))
      }
      return new Promise((resolve, reject) => {
        let settled = false
        const finish = (callback, value) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          callback(value)
        }
        const onAbort = () => finish(reject, locationError('GEOLOCATION_ABORTED'))
        if (signal?.aborted) return onAbort()
        signal?.addEventListener('abort', onAbort, { once: true })
        geolocation.getCurrentPosition(
          (position) => finish(resolve, position),
          (error) => finish(reject, locationError({
            1: 'GEOLOCATION_PERMISSION_DENIED',
            2: 'GEOLOCATION_UNAVAILABLE',
            3: 'GEOLOCATION_TIMEOUT',
          }[error?.code] || 'GEOLOCATION_UNAVAILABLE')),
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
        )
      })
    },
  })
}

export function createAttendanceLocationService({ adapter = createBrowserGeolocationAdapter() } = {}) {
  return Object.freeze({
    async getCurrentLocation({ signal } = {}) {
      let position
      try {
        position = await adapter.getCurrentPosition({ signal })
        const timestamp = Number(position?.timestamp)
        return normalizeAttendanceLocation({
          latitude: position?.coords?.latitude,
          longitude: position?.coords?.longitude,
          accuracyMeters: position?.coords?.accuracy,
          deviceRecordedAt: Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp).toISOString()
            : null,
        })
      } catch (error) {
        if (error instanceof AttendanceLocationError) throw error
        throw locationError('GEOLOCATION_INVALID')
      }
    },
  })
}

export const attendanceLocationService = createAttendanceLocationService()

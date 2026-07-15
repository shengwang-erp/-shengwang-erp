import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AttendanceLocationError,
  createAttendanceLocationService,
  createBrowserGeolocationAdapter,
} from './attendanceLocationService.js'

test('every request calls browser geolocation with fresh high-accuracy options', async () => {
  const calls = []
  const geolocation = { getCurrentPosition(success, failure, options) {
    calls.push({ failure, options })
    success({
      coords: { latitude: 35.681236, longitude: 139.767125, accuracy: 12 },
      timestamp: Date.parse('2026-07-15T08:00:00Z'),
    })
  } }
  const service = createAttendanceLocationService({ adapter: createBrowserGeolocationAdapter({ geolocation }) })
  await service.getCurrentLocation()
  await service.getCurrentLocation()
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].options, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
})

test('permission, unavailable, timeout and invalid positions fail closed', async () => {
  for (const [browserCode, expectedCode] of [
    [1, 'GEOLOCATION_PERMISSION_DENIED'],
    [2, 'GEOLOCATION_UNAVAILABLE'],
    [3, 'GEOLOCATION_TIMEOUT'],
  ]) {
    const adapter = createBrowserGeolocationAdapter({
      geolocation: { getCurrentPosition(success, failure) { failure({ code: browserCode }) } },
    })
    await assert.rejects(
      () => createAttendanceLocationService({ adapter }).getCurrentLocation(),
      (error) => error instanceof AttendanceLocationError && error.code === expectedCode,
    )
  }
  const invalid = createBrowserGeolocationAdapter({
    geolocation: { getCurrentPosition(success) {
      success({ coords: { latitude: 91, longitude: 139, accuracy: 0 }, timestamp: 0 })
    } },
  })
  await assert.rejects(
    () => createAttendanceLocationService({ adapter: invalid }).getCurrentLocation(),
    (error) => error.code === 'GEOLOCATION_INVALID',
  )
})

test('abort rejects and ignores a late success callback', async () => {
  let succeed
  const controller = new AbortController()
  const service = createAttendanceLocationService({ adapter: createBrowserGeolocationAdapter({
    geolocation: { getCurrentPosition(success) { succeed = success } },
  }) })
  const pending = service.getCurrentLocation({ signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (error) => error.code === 'GEOLOCATION_ABORTED')
  succeed({ coords: { latitude: 35, longitude: 139, accuracy: 10 }, timestamp: Date.now() })
})

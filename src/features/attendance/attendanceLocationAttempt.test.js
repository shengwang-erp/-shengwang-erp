import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acquireAttendanceLocationAttempt,
  attendanceLocationAttemptReducer,
  buildAttendanceSubmission,
  createAttendanceLocationAttempt,
  createAttendanceLocationOperationContext,
  createAttendanceLocationOperationGuard,
  createAttendanceLocationOperationScope,
  isAttendanceTargetGeometryValid,
  submitAttendanceLocationAttempt,
} from './attendanceLocationAttempt.js'

const normalPreview = Object.freeze({
  result: 'normal',
  distanceMeters: 10,
  accuracyMeters: 10,
  radiusMeters: 300,
})
const abnormalPreview = Object.freeze({
  result: 'abnormal',
  distanceMeters: 300,
  accuracyMeters: 50,
  radiusMeters: 300,
})
const location = Object.freeze({
  latitude: 35,
  longitude: 139,
  accuracyMeters: 10,
  deviceRecordedAt: null,
})

function beginLocatedAttempt(preview = normalPreview, requestId = 'request-1') {
  let state = createAttendanceLocationAttempt()
  state = attendanceLocationAttemptReducer(state, { type: 'locate-start', generation: 1 })
  return attendanceLocationAttemptReducer(state, {
    type: 'locate-success',
    generation: 1,
    requestId,
    location,
    preview,
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('attendance target geometry accepts only finite coordinates in range and a positive radius', () => {
  assert.equal(isAttendanceTargetGeometryValid({
    latitude: -90,
    longitude: 180,
    attendanceRadiusMeters: 0.1,
  }), true)
  for (const target of [
    null,
    {},
    { latitude: Number.NaN, longitude: 139, attendanceRadiusMeters: 300 },
    { latitude: 91, longitude: 139, attendanceRadiusMeters: 300 },
    { latitude: 35, longitude: -181, attendanceRadiusMeters: 300 },
    { latitude: 35, longitude: 139, attendanceRadiusMeters: 0 },
    { latitude: 35, longitude: 139, attendanceRadiusMeters: Number.POSITIVE_INFINITY },
    { latitude: '35', longitude: 139, attendanceRadiusMeters: 300 },
  ]) assert.equal(isAttendanceTargetGeometryValid(target), false)
})

test('location attempt follows only the legal generation-aware transition table', () => {
  const idle = createAttendanceLocationAttempt()
  assert.deepEqual(idle, {
    phase: 'idle',
    generation: 0,
    requestId: null,
    location: null,
    preview: null,
    abnormalReason: '',
    requiresReason: false,
    errorCode: null,
    failureStage: null,
  })

  for (const action of [
    { type: 'locate-success', generation: 0, requestId: 'bad', location, preview: normalPreview },
    { type: 'locate-failure', generation: 0, errorCode: 'BAD' },
    { type: 'submit-start', generation: 0 },
    { type: 'retry-submit', generation: 1 },
    { type: 'submit-success', generation: 0 },
    { type: 'refresh-success', generation: 0 },
  ]) assert.equal(attendanceLocationAttemptReducer(idle, action), idle)

  const locating = attendanceLocationAttemptReducer(idle, {
    type: 'locate-start',
    generation: 1,
  })
  assert.equal(locating.phase, 'locating')
  assert.equal(locating.generation, 1)
  assert.equal(attendanceLocationAttemptReducer(locating, {
    type: 'locate-start', generation: 2,
  }), locating)
  assert.equal(attendanceLocationAttemptReducer(locating, {
    type: 'locate-success', generation: 0, requestId: 'stale', location, preview: abnormalPreview,
  }), locating)

  const ready = attendanceLocationAttemptReducer(locating, {
    type: 'locate-success', generation: 1, requestId: 'request-1', location, preview: normalPreview,
  })
  assert.equal(ready.phase, 'ready')
  assert.equal(attendanceLocationAttemptReducer(ready, {
    type: 'locate-success', generation: 1, requestId: 'duplicate', location, preview: abnormalPreview,
  }), ready)

  const submitting = attendanceLocationAttemptReducer(ready, {
    type: 'submit-start', generation: 1,
  })
  assert.equal(submitting.phase, 'submitting')
  assert.equal(attendanceLocationAttemptReducer(submitting, {
    type: 'submit-start', generation: 1,
  }), submitting)
  assert.equal(attendanceLocationAttemptReducer(submitting, {
    type: 'retry-submit', generation: 2,
  }), submitting)

  const refreshing = attendanceLocationAttemptReducer(submitting, {
    type: 'submit-success', generation: 1,
  })
  assert.equal(refreshing.phase, 'refreshing')
  const succeeded = attendanceLocationAttemptReducer(refreshing, {
    type: 'refresh-success', generation: 1,
  })
  assert.equal(succeeded.phase, 'succeeded')
  const restarted = attendanceLocationAttemptReducer(succeeded, {
    type: 'restart', generation: 2,
  })
  assert.deepEqual(restarted, createAttendanceLocationAttempt(2))
})

test('normal and abnormal previews move to ready and reason-required respectively', () => {
  const normal = beginLocatedAttempt(normalPreview, 'normal-request')
  assert.equal(normal.phase, 'ready')
  assert.equal(normal.requiresReason, false)
  assert.deepEqual(buildAttendanceSubmission(normal), {
    requestId: 'normal-request',
    location,
    abnormalReason: null,
  })

  const abnormal = beginLocatedAttempt(abnormalPreview, 'abnormal-request')
  assert.equal(abnormal.phase, 'reason_required')
  assert.equal(abnormal.requiresReason, true)
  assert.equal(abnormal.requestId, 'abnormal-request')
})

test('abnormal reason validation is trimmed and counts Unicode code points at 500/501', () => {
  const abnormal = beginLocatedAttempt(abnormalPreview)
  assert.throws(
    () => buildAttendanceSubmission(abnormal),
    (error) => error.code === 'ATTENDANCE_ABNORMAL_REASON_INVALID',
  )
  assert.equal(attendanceLocationAttemptReducer(abnormal, {
    type: 'submit-start', generation: 2,
  }), abnormal)

  const exactReason = `  ${'😀'.repeat(500)}  `
  const exact = attendanceLocationAttemptReducer(abnormal, {
    type: 'reason-change', value: exactReason,
  })
  assert.equal([...buildAttendanceSubmission(exact).abnormalReason].length, 500)
  assert.equal(attendanceLocationAttemptReducer(exact, {
    type: 'submit-start', generation: 2,
  }).phase, 'submitting')

  const tooLong = attendanceLocationAttemptReducer(abnormal, {
    type: 'reason-change', value: '😀'.repeat(501),
  })
  assert.throws(
    () => buildAttendanceSubmission(tooLong),
    (error) => error.code === 'ATTENDANCE_ABNORMAL_REASON_INVALID',
  )
  assert.equal(attendanceLocationAttemptReducer(tooLong, {
    type: 'submit-start', generation: 2,
  }), tooLong)
})

test('server reason-required overrides a normal preview and preserves the measurement', () => {
  const ready = beginLocatedAttempt(normalPreview, 'request-server-override')
  const submitting = attendanceLocationAttemptReducer(ready, {
    type: 'submit-start', generation: 1,
  })
  const reasonRequired = attendanceLocationAttemptReducer(submitting, {
    type: 'reason-required',
    generation: 1,
    errorCode: 'ATTENDANCE_ABNORMAL_REASON_REQUIRED',
  })
  assert.equal(reasonRequired.phase, 'reason_required')
  assert.equal(reasonRequired.requiresReason, true)
  assert.equal(reasonRequired.requestId, 'request-server-override')
  assert.equal(reasonRequired.location, location)
  assert.equal(reasonRequired.preview, normalPreview)

  const changed = attendanceLocationAttemptReducer(reasonRequired, {
    type: 'reason-change', value: ' 服务端判定超界 ',
  })
  assert.deepEqual(buildAttendanceSubmission(changed), {
    requestId: 'request-server-override',
    location,
    abnormalReason: '服务端判定超界',
  })
})

test('network and refresh retries retain the exact request id, position, and reason', () => {
  let state = beginLocatedAttempt(abnormalPreview, 'stable-request')
  state = attendanceLocationAttemptReducer(state, {
    type: 'reason-change', value: '现场入口封闭',
  })
  state = attendanceLocationAttemptReducer(state, { type: 'submit-start', generation: 2 })
  state = attendanceLocationAttemptReducer(state, {
    type: 'submit-failure', generation: 2, errorCode: 'ATTENDANCE_SERVICE_UNAVAILABLE',
  })
  assert.equal(state.phase, 'failed')
  assert.equal(state.failureStage, 'submit')
  const retrying = attendanceLocationAttemptReducer(state, {
    type: 'retry-submit', generation: 3,
  })
  assert.equal(retrying.phase, 'submitting')
  assert.deepEqual(buildAttendanceSubmission(retrying), {
    requestId: 'stable-request',
    location,
    abnormalReason: '现场入口封闭',
  })

  const refreshing = attendanceLocationAttemptReducer(retrying, {
    type: 'submit-success', generation: 3,
  })
  const refreshFailed = attendanceLocationAttemptReducer(refreshing, {
    type: 'refresh-failure', generation: 3, errorCode: 'ATTENDANCE_REFRESH_FAILED',
  })
  assert.equal(refreshFailed.failureStage, 'refresh')
  assert.deepEqual(buildAttendanceSubmission(refreshFailed), {
    requestId: 'stable-request',
    location,
    abnormalReason: '现场入口封闭',
  })
})

test('locate failures cannot submit and restart invalidates every stale completion', () => {
  const locating = attendanceLocationAttemptReducer(createAttendanceLocationAttempt(), {
    type: 'locate-start', generation: 1,
  })
  const failed = attendanceLocationAttemptReducer(locating, {
    type: 'locate-failure', generation: 1, errorCode: 'GEOLOCATION_TIMEOUT',
  })
  assert.equal(failed.failureStage, 'locate')
  assert.equal(attendanceLocationAttemptReducer(failed, {
    type: 'retry-submit', generation: 2,
  }), failed)
  assert.throws(() => buildAttendanceSubmission(failed), /incomplete/u)

  const restarted = attendanceLocationAttemptReducer(failed, {
    type: 'restart', generation: 2,
  })
  assert.deepEqual(restarted, createAttendanceLocationAttempt(2))
  for (const staleAction of [
    { type: 'locate-success', generation: 1, requestId: 'stale', location, preview: normalPreview },
    { type: 'locate-failure', generation: 1, errorCode: 'STALE' },
    { type: 'submit-failure', generation: 1, errorCode: 'STALE' },
    { type: 'submit-success', generation: 1 },
  ]) assert.equal(attendanceLocationAttemptReducer(restarted, staleAction), restarted)
})

test('operation guard synchronously rejects double clicks and invalidates old generations', () => {
  const guard = createAttendanceLocationOperationGuard()
  const first = guard.begin()
  assert.equal(first, 1)
  assert.equal(guard.begin(), null)
  assert.equal(guard.isCurrent(first), true)

  guard.finish(first)
  const second = guard.begin()
  assert.equal(second, 2)
  const invalidatedGeneration = guard.invalidate()
  assert.equal(invalidatedGeneration, 3)
  assert.equal(guard.isCurrent(second), false)

  const third = guard.begin()
  assert.equal(third, 4)
  guard.unmount()
  assert.equal(guard.isCurrent(third), false)
  assert.equal(guard.begin(), null)
})

test('location acquisition creates the request id only after fresh GPS resolves', async () => {
  const calls = []
  const guard = createAttendanceLocationOperationGuard()
  const targetLocation = {
    latitude: 35,
    longitude: 139,
    attendanceRadiusMeters: 300,
  }
  const locationService = {
    async getCurrentLocation({ signal }) {
      calls.push({ type: 'location', signal })
      return location
    },
  }
  const createRequestId = () => {
    calls.push({ type: 'request-id' })
    return `request-${calls.filter((call) => call.type === 'request-id').length}`
  }

  for (let index = 0; index < 2; index += 1) {
    const generation = guard.begin()
    const result = await acquireAttendanceLocationAttempt({
      guard,
      generation,
      signal: new AbortController().signal,
      locationService,
      createRequestId,
      targetLocation,
    })
    assert.equal(result.status, 'located')
    assert.equal(result.requestId, `request-${index + 1}`)
    guard.finish(generation)
  }
  assert.deepEqual(calls.map((call) => call.type), [
    'location', 'request-id', 'location', 'request-id',
  ])
})

test('stale location completion has no request id or preview side effect', async () => {
  const guard = createAttendanceLocationOperationGuard()
  const pendingLocation = deferred()
  let requestIdCalls = 0
  const generation = guard.begin()
  const pending = acquireAttendanceLocationAttempt({
    guard,
    generation,
    signal: new AbortController().signal,
    locationService: { getCurrentLocation: () => pendingLocation.promise },
    createRequestId: () => {
      requestIdCalls += 1
      return 'must-not-exist'
    },
    targetLocation: { latitude: 35, longitude: 139, attendanceRadiusMeters: 300 },
  })
  guard.invalidate()
  pendingLocation.resolve(location)
  assert.deepEqual(await pending, { status: 'stale' })
  assert.equal(requestIdCalls, 0)
})

test('semantic operation scope turns stale before passive target cleanup can run', async () => {
  const guard = createAttendanceLocationOperationGuard()
  const pendingLocation = deferred()
  let currentTargetSignature = 'project-a'
  let requestIdCalls = 0
  const generation = guard.begin()
  const operationScope = createAttendanceLocationOperationScope({
    guard,
    generation,
    isContextCurrent: () => currentTargetSignature === 'project-a',
  })
  const pending = acquireAttendanceLocationAttempt({
    guard: operationScope,
    generation,
    signal: new AbortController().signal,
    locationService: { getCurrentLocation: () => pendingLocation.promise },
    createRequestId: () => {
      requestIdCalls += 1
      return 'must-not-exist'
    },
    targetLocation: { latitude: 35, longitude: 139, attendanceRadiusMeters: 300 },
  })

  currentTargetSignature = 'project-b'
  assert.equal(guard.isCurrent(generation), true)
  pendingLocation.resolve(location)
  assert.deepEqual(await pending, { status: 'stale' })
  assert.equal(requestIdCalls, 0)
})

test('operation context captures callbacks while semantic target identity stays authoritative', async () => {
  const guard = createAttendanceLocationOperationGuard()
  const generation = guard.begin()
  let currentTargetSignature = 'project-a'
  const events = []
  const oldSubmit = async (submission) => {
    events.push(['old-submit', submission.requestId])
    return { ok: true }
  }
  const oldSuccess = async () => { events.push(['old-refresh']) }
  const operationContext = createAttendanceLocationOperationContext({
    guard,
    generation,
    targetSignature: 'project-a',
    isTargetCurrent: (signature) => currentTargetSignature === signature,
    targetLocation: { latitude: 35, longitude: 139, attendanceRadiusMeters: 300 },
    locationService: { getCurrentLocation: async () => location },
    createRequestId: () => 'request-a',
    onSubmit: oldSubmit,
    onSuccess: oldSuccess,
  })
  const latestSubmit = async () => { events.push(['new-submit']) }
  void latestSubmit

  const result = await submitAttendanceLocationAttempt({
    guard: operationContext.guard,
    generation,
    submission: { requestId: 'request-a', location, abnormalReason: null },
    onSubmit: operationContext.onSubmit,
    onSuccess: operationContext.onSuccess,
  })
  assert.equal(result.status, 'succeeded')
  assert.deepEqual(events, [['old-submit', 'request-a'], ['old-refresh']])

  currentTargetSignature = 'project-b'
  assert.equal(operationContext.guard.isCurrent(generation), false)
})

test('submission awaits server then refresh and reports refresh failure for idempotent retry', async () => {
  const events = []
  const guard = createAttendanceLocationOperationGuard()
  const generation = guard.begin()
  const submission = { requestId: 'request-1', location, abnormalReason: null }
  const serverResult = { sessionId: 'session-1' }
  const result = await submitAttendanceLocationAttempt({
    guard,
    generation,
    submission,
    async onSubmit(value) {
      events.push(['submit', value])
      return serverResult
    },
    async onSuccess(value) {
      events.push(['refresh', value])
      throw new Error('refresh unavailable')
    },
  })
  assert.deepEqual(events, [
    ['submit', submission],
    ['refresh', serverResult],
  ])
  assert.equal(result.status, 'failed')
  assert.equal(result.stage, 'refresh')
  assert.match(result.error.message, /refresh unavailable/u)
})

test('stale submit and refresh completions cannot continue or report success', async () => {
  const submitDeferred = deferred()
  const guardAfterSubmit = createAttendanceLocationOperationGuard()
  const firstGeneration = guardAfterSubmit.begin()
  let refreshCalls = 0
  const firstPending = submitAttendanceLocationAttempt({
    guard: guardAfterSubmit,
    generation: firstGeneration,
    submission: { requestId: 'request-1', location, abnormalReason: null },
    onSubmit: () => submitDeferred.promise,
    onSuccess: async () => { refreshCalls += 1 },
  })
  guardAfterSubmit.invalidate()
  submitDeferred.resolve({ ok: true })
  assert.deepEqual(await firstPending, { status: 'stale' })
  assert.equal(refreshCalls, 0)

  const refreshDeferred = deferred()
  const guardDuringRefresh = createAttendanceLocationOperationGuard()
  const secondGeneration = guardDuringRefresh.begin()
  const secondPending = submitAttendanceLocationAttempt({
    guard: guardDuringRefresh,
    generation: secondGeneration,
    submission: { requestId: 'request-2', location, abnormalReason: null },
    onSubmit: async () => ({ ok: true }),
    onSuccess: () => refreshDeferred.promise,
  })
  await Promise.resolve()
  guardDuringRefresh.unmount()
  refreshDeferred.resolve()
  assert.deepEqual(await secondPending, { status: 'stale' })
})

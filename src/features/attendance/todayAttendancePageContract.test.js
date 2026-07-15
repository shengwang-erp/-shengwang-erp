import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer, transformWithEsbuild } from 'vite'

const COMPONENT_FILES = Object.freeze({
  picker: 'AttendanceProjectPicker.jsx',
  location: 'AttendanceLocationAction.jsx',
  point: 'AttendanceWorkPointCard.jsx',
  active: 'ActiveAttendanceSession.jsx',
  history: 'TodayAttendanceHistory.jsx',
})

const TASK9_COMPONENT_FILES = Object.freeze({
  page: 'TodayAttendancePage.jsx',
  viewer: 'AttendanceRecordViewer.jsx',
})

const sourceEntries = await Promise.all(Object.entries(COMPONENT_FILES).map(async ([key, name]) => [
  key,
  await readFile(new URL(`./${name}`, import.meta.url), 'utf8').catch(() => ''),
]))
const sources = Object.fromEntries(sourceEntries)

const task9SourceEntries = await Promise.all(
  Object.entries(TASK9_COMPONENT_FILES).map(async ([key, name]) => [
    key,
    await readFile(new URL(`./${name}`, import.meta.url), 'utf8').catch(() => ''),
  ]),
)
const task9Sources = Object.fromEntries(task9SourceEntries)
const task9Css = await readFile(
  new URL('./todayAttendance.css', import.meta.url),
  'utf8',
).catch(() => '')

async function loadComponentModules() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    const entries = await Promise.all(Object.entries(COMPONENT_FILES).map(async ([key, name]) => [
      key,
      await server.ssrLoadModule(`/src/features/attendance/${name}`),
    ]))
    return { error: null, modules: Object.fromEntries(entries) }
  } catch (error) {
    return { error, modules: {} }
  } finally {
    await server.close()
  }
}

const loaded = await loadComponentModules()

async function loadTask9Modules() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    const entries = await Promise.all(
      Object.entries(TASK9_COMPONENT_FILES).map(async ([key, name]) => [
        key,
        await server.ssrLoadModule(`/src/features/attendance/${name}`),
      ]),
    )
    return { error: null, modules: Object.fromEntries(entries) }
  } catch (error) {
    return { error, modules: {} }
  } finally {
    await server.close()
  }
}

const task9Loaded = await loadTask9Modules()

function componentModule(name) {
  assert.ifError(loaded.error)
  assert.ok(loaded.modules[name])
  return loaded.modules[name]
}

function task9Module(name) {
  assert.ifError(task9Loaded.error)
  assert.ok(task9Loaded.modules[name])
  return task9Loaded.modules[name]
}

function render(Component, props) {
  return renderToStaticMarkup(createElement(Component, props))
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

const eligibleProject = Object.freeze({
  projectId: 'P001',
  projectName: '东京站现场',
  status: '进行中',
  address: '東京都千代田区丸の内 1-9',
  latitude: 35.681236,
  longitude: 139.767125,
  attendanceRadiusMeters: 300,
  locationConfirmedAt: '2026-07-15T00:00:00.000Z',
  locationAddressSnapshot: '東京都千代田区丸の内 1-9',
})
const ineligibleProject = Object.freeze({
  ...eligibleProject,
  projectId: 'P002',
  projectName: '定位失效项目',
  locationAddressSnapshot: '另一个地址',
})

const activeBeforePhoto = Object.freeze({
  photoId: 'photo-before',
  workPointId: 'point-1',
  phase: 'before',
  uploadStatus: 'active',
  originalFileName: 'before.jpg',
})
const activeAfterPhoto = Object.freeze({
  photoId: 'photo-after',
  workPointId: 'point-1',
  phase: 'after',
  uploadStatus: 'active',
  originalFileName: 'after.jpg',
})
const pendingBeforeReservation = Object.freeze({
  ...activeBeforePhoto,
  photoId: 'pending-before',
  uploadStatus: 'pending',
})

function uploadState(overrides = {}) {
  return {
    phase: 'idle',
    file: null,
    reservation: null,
    activePhoto: null,
    failedStage: null,
    errorCode: null,
    attemptId: null,
    ...overrides,
  }
}

function point(overrides = {}) {
  return {
    workPointId: 'point-1',
    sessionId: 'session-1',
    ordinal: 1,
    areaName: ' 北侧墙面 ',
    workDescription: ' 下地施工 ',
    completionNote: ' 完成 ',
    photos: { before: null, after: null },
    ...overrides,
  }
}

function completePoint(ordinal = 1) {
  return point({
    ordinal,
    workPointId: `point-${ordinal}`,
    areaName: `区域 ${ordinal}`,
    workDescription: `工作 ${ordinal}`,
    photos: {
      before: { ...activeBeforePhoto, workPointId: `point-${ordinal}` },
      after: { ...activeAfterPhoto, workPointId: `point-${ordinal}` },
    },
  })
}

function clockEvent(eventType, result, timestamp, abnormalReason = null) {
  return {
    eventId: `${eventType}-${timestamp}`,
    requestId: `request-${eventType}-${timestamp}`,
    eventType,
    serverRecordedAt: timestamp,
    deviceRecordedAt: timestamp,
    latitude: 35,
    longitude: 139,
    accuracyMeters: 10,
    distanceMeters: result === 'normal' ? 10 : 500,
    radiusMeters: 300,
    result,
    abnormalReason,
  }
}

function session(overrides = {}) {
  return {
    sessionId: 'session-1',
    employeeProfileId: 'employee-1',
    employeeNumberSnapshot: 'SW-001',
    employeeNameSnapshot: '山田太郎',
    projectId: 'P001',
    projectNameSnapshot: '东京站现场',
    projectAddressSnapshot: '東京都千代田区丸の内 1-9',
    projectLatitudeSnapshot: 35.681236,
    projectLongitudeSnapshot: 139.767125,
    attendanceRadiusMetersSnapshot: 300,
    workDate: '2026-07-16',
    status: 'open',
    openedAt: '2026-07-16T00:00:00.000Z',
    closedAt: null,
    clockInEvent: clockEvent('clock_in', 'normal', '2026-07-16T00:00:00.000Z'),
    clockOutEvent: null,
    workPoints: [],
    ...overrides,
  }
}

test('all five JSX files compile independently through the Vite JSX transform', async () => {
  for (const [key, name] of Object.entries(COMPONENT_FILES)) {
    assert.ok(sources[key], `${name} must exist`)
    const result = await transformWithEsbuild(sources[key], name, {
      loader: 'jsx',
      jsx: 'automatic',
    })
    assert.ok(result.code.includes('jsx') || result.code.includes('createElement'))
  }
})

test('project picker fails closed, is controlled, and emits only an eligible project id', () => {
  const picker = componentModule('picker')
  assert.deepEqual(
    picker.getEligibleAttendanceProjects([eligibleProject, ineligibleProject]),
    [eligibleProject],
  )
  const changes = []
  assert.equal(picker.notifyAttendanceProjectChange({
    projects: [eligibleProject, ineligibleProject],
    requestedProjectId: 'P001',
    onChange: (projectId) => changes.push(projectId),
  }), 'P001')
  assert.equal(picker.notifyAttendanceProjectChange({
    projects: [eligibleProject, ineligibleProject],
    requestedProjectId: 'P002',
    onChange: (projectId) => changes.push(projectId),
  }), '')
  assert.deepEqual(changes, ['P001', ''])

  const markup = render(picker.default, {
    projects: [eligibleProject, ineligibleProject],
    selectedProjectId: 'P001',
    onChange() {},
  })
  assert.match(markup, /<label for="([^"]+)">项目名称<\/label>/u)
  assert.match(markup, /<select[^>]*id="[^"]+"[^>]*>/u)
  assert.match(markup, /东京站现场/u)
  assert.match(markup, /東京都千代田区丸の内 1-9/u)
  assert.match(markup, /300 米/u)
  assert.doesNotMatch(markup, /定位失效项目/u)
  assert.match(markup, /<option value="P001" selected="">/u)
})

test('project picker renders the exact empty copy and disables selection for an open session', () => {
  const Picker = componentModule('picker').default
  const emptyMarkup = render(Picker, {
    projects: [ineligibleProject],
    selectedProjectId: 'P002',
    onChange() {},
  })
  assert.match(emptyMarkup, /暂无可打卡项目，请联系办公室完善项目定位。/u)
  assert.match(emptyMarkup, /<option value="" selected="">请选择项目<\/option>/u)
  assert.doesNotMatch(emptyMarkup, /定位失效项目/u)

  const openSessionMarkup = render(Picker, {
    projects: [eligibleProject],
    selectedProjectId: 'P001',
    hasOpenSession: true,
    onChange() {},
  })
  assert.match(openSessionMarkup, /<select[^>]*disabled=""/u)
  assert.match(openSessionMarkup, /aria-describedby=/u)

  const genericDisabledMarkup = render(Picker, {
    projects: [eligibleProject],
    selectedProjectId: 'P001',
    disabled: true,
    onChange() {},
  })
  assert.match(genericDisabledMarkup, /<select[^>]*disabled=""/u)
  assert.doesNotMatch(genericDisabledMarkup, /aria-describedby=/u)
})

test('location action exposes fresh clock labels, live status, and the server-authoritative preview copy', () => {
  const LocationAction = componentModule('location').default
  for (const [action, label] of [['clock_in', '打卡上班'], ['clock_out', '打卡下班']]) {
    const markup = render(LocationAction, {
      action,
      targetLocation: eligibleProject,
      locationService: { getCurrentLocation: async () => ({}) },
      createRequestId: () => 'request-1',
      onSubmit: async () => ({}),
      onSuccess: async () => {},
      disabled: action === 'clock_out',
    })
    assert.match(markup, new RegExp(label, 'u'))
    assert.match(markup, /<button[^>]*type="button"/u)
    assert.match(markup, /role="status"/u)
    assert.match(markup, /aria-live="polite"/u)
    if (action === 'clock_out') assert.match(markup, /aria-describedby=/u)
  }
  assert.match(sources.location, /定位预览，服务器结果为准/u)
  assert.match(sources.location, /异常原因/u)
  assert.match(sources.location, /useId\(/u)
  assert.match(sources.location, /\.focus\(\)/u)
})

test('location action fails closed with an explained disabled control when target geometry is absent or malformed', () => {
  const LocationAction = componentModule('location').default
  for (const targetLocation of [
    null,
    {},
    { latitude: Number.NaN, longitude: 139, attendanceRadiusMeters: 300 },
    { latitude: 35, longitude: 139, attendanceRadiusMeters: 0 },
  ]) {
    const markup = render(LocationAction, {
      action: 'clock_in',
      targetLocation,
      locationService: { getCurrentLocation: async () => ({}) },
      createRequestId: () => 'request-1',
      onSubmit: async () => ({}),
      onSuccess: async () => {},
    })
    const button = markup.match(/<button[^>]*>打卡上班<\/button>/u)?.[0] || ''
    assert.match(button, /disabled=""/u)
    assert.match(button, /aria-describedby=/u)
    assert.match(markup, /当前项目定位不可用，请重新选择项目。/u)
  }
})

test('location action consumes guarded helpers and isolates retry from geolocation', () => {
  assert.match(sources.location, /createAttendanceLocationOperationGuard/u)
  assert.match(sources.location, /acquireAttendanceLocationAttempt/u)
  assert.match(sources.location, /submitAttendanceLocationAttempt/u)
  assert.match(sources.location, /targetSignature/u)
  assert.match(sources.location, /currentTargetSignatureRef\.current = targetSignature/u)
  assert.match(sources.location, /useLayoutEffect\(/u)
  assert.match(sources.location, /createAttendanceLocationOperationContext/u)
  assert.match(sources.location, /operationContext/u)
  assert.doesNotMatch(sources.location, /latestRef/u)
  assert.match(sources.location, /controllerRef\.current\?\.abort\(\)/u)
  assert.match(sources.location, /guardRef\.current\.invalidate\(\)/u)
  assert.match(sources.location, /guardRef\.current\.unmount\(\)/u)

  const retryBody = sources.location.match(
    /const handleRetrySubmit = [\s\S]*?\n\s*const handleRelocate =/u,
  )?.[0] || ''
  assert.match(retryBody, /buildAttendanceSubmission/u)
  assert.match(retryBody, /submitCurrentAttempt/u)
  assert.doesNotMatch(retryBody, /acquireAttendanceLocationAttempt|getCurrentLocation|createRequestId/u)

  const relocateBody = sources.location.match(
    /const handleRelocate = [\s\S]*?\n\s*return \(/u,
  )?.[0] || ''
  assert.match(relocateBody, /invalidateCurrentOperation/u)
  assert.match(relocateBody, /beginLocation/u)
})

test('every disabled location recovery control references its rendered explanation', () => {
  for (const className of [
    'attendance-location-submit',
    'attendance-location-retry',
    'attendance-location-relocate',
  ]) {
    const opening = sources.location.match(
      new RegExp(`<button[\\s\\S]*?className=["']${className}["'][\\s\\S]*?>`, 'u'),
    )?.[0] || ''
    assert.match(opening, /aria-describedby=/u, className)
  }
  assert.match(sources.location, /disabledReason/u)
})

test('work point callback payloads are controlled, ordinal-authoritative, and domain-normalized', () => {
  const pointModule = componentModule('point')
  const current = point({ ordinal: 7 })
  assert.deepEqual(
    pointModule.createAttendanceWorkPointChange(current, 2, 'areaName', ' 新区域 '),
    { ...current, ordinal: 2, areaName: ' 新区域 ' },
  )
  assert.deepEqual(pointModule.createAttendanceWorkPointSave(current, 2), {
    ...current,
    ordinal: 2,
    areaName: '北侧墙面',
    workDescription: '下地施工',
    completionNote: '完成',
  })
  const file = { name: 'a.jpg', type: 'image/jpeg', size: 1 }
  assert.deepEqual(
    pointModule.createAttendancePhotoSelection(current, 'before', file),
    { workPointId: 'point-1', phase: 'before', file },
  )
  assert.deepEqual(
    pointModule.createAttendancePhotoReservationAction(current, 'before', {
      reservation: pendingBeforeReservation,
    }),
    { workPointId: 'point-1', phase: 'before', photoId: 'pending-before' },
  )
})

test('work point allows partial text saves without HTML required and gates cameras by server truth', () => {
  const PointCard = componentModule('point').default
  const markup = render(PointCard, {
    point: point({
      workPointId: null,
      areaName: '',
      workDescription: '',
      completionNote: '',
    }),
    ordinal: 1,
    readOnly: false,
    saveState: { saving: false, error: '' },
    photoStates: { before: uploadState(), after: uploadState() },
    onChange() {},
    onSave() {},
    onSelectPhoto() {},
    onRetryFinalize() {},
    onAbandonPhoto() {},
    onOpenPhoto() {},
  })
  assert.doesNotMatch(markup, /\srequired(?:=|\s|>)/u)
  assert.match(markup, /工作区域/u)
  assert.match(markup, /工作内容/u)
  assert.match(markup, /开工前照片/u)
  assert.match(markup, /完工照片/u)
  assert.equal((markup.match(/type="file"/gu) || []).length, 2)
  assert.equal((markup.match(/type="file"[^>]*disabled=""/gu) || []).length, 2)
  assert.equal((markup.match(/accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif"/gu) || []).length, 2)
  assert.equal((markup.match(/capture="environment"/gu) || []).length, 2)
  assert.match(markup, /aria-describedby=/u)

  const savedPointMarkup = render(PointCard, {
    point: point(),
    ordinal: 1,
    saveState: { saving: false, error: '' },
    photoStates: { before: uploadState(), after: uploadState() },
    onChange() {}, onSave() {}, onSelectPhoto() {}, onOpenPhoto() {},
  })
  const fileInputs = savedPointMarkup.match(/<input[^>]*type="file"[^>]*>/gu) || []
  assert.equal(fileInputs.length, 2)
  assert.doesNotMatch(fileInputs[0], /disabled=""/u)
  assert.match(fileInputs[1], /disabled=""/u)
})

test('photo phases render independently and use the exact Task 4 capability matrix', () => {
  const pointModule = componentModule('point')
  const PointCard = pointModule.default
  const phaseCases = [
    ['idle', uploadState(), '尚未选择照片'],
    ['selected', uploadState({ phase: 'selected', file: { name: 'a.jpg' } }), '已选择照片'],
    ['reserving', uploadState({ phase: 'reserving', attemptId: 'attempt-1' }), '正在预约上传'],
    ['uploading', uploadState({ phase: 'uploading', reservation: pendingBeforeReservation }), '正在上传照片'],
    ['confirming', uploadState({ phase: 'confirming', reservation: pendingBeforeReservation }), '正在确认照片'],
    ['failed', uploadState({ phase: 'failed', failedStage: 'reserve', errorCode: 'FAILED' }), '照片处理失败'],
    ['active', uploadState({ phase: 'active', activePhoto: activeBeforePhoto }), '照片已保存'],
    ['cleanup_pending', uploadState({ phase: 'cleanup_pending' }), '服务器正在清理本次上传'],
  ]
  for (const [, state, label] of phaseCases) {
    const markup = render(PointCard, {
      point: point(),
      ordinal: 1,
      saveState: { saving: false, error: '' },
      photoStates: { before: state, after: uploadState() },
      onChange() {}, onSave() {}, onSelectPhoto() {},
      onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    })
    assert.match(markup, new RegExp(label, 'u'))
    assert.match(markup, /role="status"/u)
  }

  const capabilityCases = [
    ['upload', false, true],
    ['finalize', true, false],
    ['recovered', true, true],
    ['abandon', false, true],
  ]
  for (const [failedStage, canRetryFinalize, canAbandon] of capabilityCases) {
    const state = uploadState({
      phase: 'failed',
      failedStage,
      errorCode: failedStage === 'abandon' ? 'ABANDON_FAILED' : 'FAILED',
      reservation: pendingBeforeReservation,
    })
    const capabilities = pointModule.getAttendancePhotoCapabilities(state, point(), 'before')
    assert.equal(capabilities.canRetryFinalize, canRetryFinalize)
    assert.equal(capabilities.canAbandon, canAbandon)
    const markup = render(PointCard, {
      point: point(), ordinal: 1,
      saveState: { saving: false, error: '' },
      photoStates: { before: state, after: uploadState() },
      onChange() {}, onSave() {}, onSelectPhoto() {},
      onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    })
    assert.equal(markup.includes('重试确认'), canRetryFinalize)
    assert.equal(/放弃本次上传/u.test(markup), canAbandon)
  }

  assert.deepEqual(pointModule.getAttendancePhotoCapabilities(uploadState({
    phase: 'failed',
    failedStage: 'abandon',
    errorCode: null,
    reservation: pendingBeforeReservation,
  }), point(), 'before'), { canRetryFinalize: false, canAbandon: false })
})

test('photo actions and previews fail closed when reservation or photo identity is mis-keyed', () => {
  const pointModule = componentModule('point')
  const PointCard = pointModule.default
  const currentPoint = point()
  for (const reservation of [
    { ...pendingBeforeReservation, workPointId: 'foreign-point' },
    { ...pendingBeforeReservation, phase: 'after' },
  ]) {
    const state = uploadState({
      phase: 'failed',
      failedStage: 'recovered',
      errorCode: 'PENDING',
      reservation,
    })
    assert.deepEqual(
      pointModule.getAttendancePhotoCapabilities(state, currentPoint, 'before'),
      { canRetryFinalize: false, canAbandon: false },
    )
    assert.throws(
      () => pointModule.createAttendancePhotoReservationAction(currentPoint, 'before', state),
      /does not match/u,
    )
    const markup = render(PointCard, {
      point: currentPoint,
      ordinal: 1,
      saveState: { saving: false, error: '' },
      photoStates: { before: state, after: uploadState() },
      onChange() {}, onSave() {}, onSelectPhoto() {},
      onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    })
    assert.doesNotMatch(markup, /重试确认|放弃本次上传/u)
  }

  for (const mismatchedPhoto of [
    { ...activeBeforePhoto, workPointId: 'foreign-point' },
    { ...activeBeforePhoto, phase: 'after' },
  ]) {
    const localMarkup = render(PointCard, {
      point: currentPoint,
      ordinal: 1,
      readOnly: true,
      photoStates: {
        before: uploadState({ phase: 'active', activePhoto: mismatchedPhoto }),
        after: uploadState(),
      },
      onOpenPhoto() {},
    })
    assert.doesNotMatch(localMarkup, /查看第 1 点位开工前照片/u)

    const serverMarkup = render(PointCard, {
      point: point({ photos: { before: mismatchedPhoto, after: null } }),
      ordinal: 1,
      readOnly: false,
      photoStates: { before: uploadState(), after: uploadState() },
      onSelectPhoto() {},
      onOpenPhoto() {},
    })
    assert.doesNotMatch(serverMarkup, /查看第 1 点位开工前照片/u)
    const serverFileInputs = serverMarkup.match(/<input[^>]*type="file"[^>]*>/gu) || []
    assert.match(serverFileInputs[1], /disabled=""/u)
  }
})

test('read-only point locks mutations while active photos remain viewable without signed URLs', () => {
  const PointCard = componentModule('point').default
  const markup = render(PointCard, {
    point: point({ photos: { before: activeBeforePhoto, after: activeAfterPhoto } }),
    ordinal: 1,
    readOnly: true,
    saveState: { saving: false, error: '' },
    photoStates: { before: uploadState(), after: uploadState() },
    onChange() {}, onSave() {}, onSelectPhoto() {},
    onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
  })
  const textControls = markup.match(/<(?:input|textarea)[^>]*>/gu) || []
  assert.ok(textControls.length >= 5)
  assert.ok(textControls.every((control) => /disabled=""/u.test(control)))
  assert.equal((markup.match(/查看第 1 点位(?:开工前|完工)照片/gu) || []).length, 2)
  assert.doesNotMatch(markup, /<img|signed|blob:/iu)
  assert.doesNotMatch(markup, /重试确认|放弃本次上传/u)
})

test('server-active photo with idle local state can be replaced and same-file selection is cleared', () => {
  const PointCard = componentModule('point').default
  const markup = render(PointCard, {
    point: point({ photos: { before: activeBeforePhoto, after: null } }),
    ordinal: 1,
    saveState: { saving: false, error: '' },
    photoStates: { before: uploadState(), after: uploadState() },
    onChange() {}, onSave() {}, onSelectPhoto() {}, onOpenPhoto() {},
  })
  const fileInputs = markup.match(/<input[^>]*type="file"[^>]*>/gu) || []
  assert.doesNotMatch(fileInputs[0], /disabled=""/u)
  assert.doesNotMatch(fileInputs[1], /disabled=""/u)
  assert.match(sources.point, /event\.currentTarget\.value = ['"]{2}/u)
})

test('active session sorts ordinals, chooses the first unused slot, and caps seven points', () => {
  const activeModule = componentModule('active')
  assert.equal(activeModule.getNextAttendanceWorkPointOrdinal([
    point({ ordinal: 3 }), point({ ordinal: 1 }), point({ ordinal: 5 }),
  ]), 2)
  assert.equal(activeModule.getNextAttendanceWorkPointOrdinal(
    Array.from({ length: 7 }, (_, index) => point({ ordinal: index + 1 })),
  ), null)

  const points = [point({ ordinal: 5 }), point({ ordinal: 1 }), point({ ordinal: 3 })]
  const markup = render(activeModule.default, {
    session: session({ workPoints: [] }),
    points,
    saveStates: {},
    photoStates: {},
    mutationPending: false,
    locationService: { getCurrentLocation: async () => ({}) },
    createRequestId: () => 'request-1',
    onAddPoint() {}, onChangePoint() {}, onSavePoint() {},
    onSelectPhoto() {}, onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    onClockOut: async () => ({}), onClockOutSuccess: async () => {},
  })
  assert.ok(markup.indexOf('第 1 点位') < markup.indexOf('第 3 点位'))
  assert.ok(markup.indexOf('第 3 点位') < markup.indexOf('第 5 点位'))

  const eightPoints = Array.from({ length: 8 }, (_, index) => completePoint(index + 1))
  const cappedMarkup = render(activeModule.default, {
    session: session({ workPoints: eightPoints }),
    points: eightPoints,
    saveStates: {}, photoStates: {}, mutationPending: false,
    locationService: { getCurrentLocation: async () => ({}) },
    createRequestId: () => 'request-1',
    onAddPoint() {}, onChangePoint() {}, onSavePoint() {},
    onSelectPhoto() {}, onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    onClockOut: async () => ({}), onClockOutSuccess: async () => {},
  })
  assert.equal((cappedMarkup.match(/class="attendance-work-point-card"/gu) || []).length, 7)
  assert.equal((cappedMarkup.match(/type="file"/gu) || []).length, 14)
})

test('clock-out eligibility is existential and based only on authoritative session points', () => {
  const ActiveSession = componentModule('active').default
  const common = {
    saveStates: {}, photoStates: {}, mutationPending: false,
    locationService: { getCurrentLocation: async () => ({}) },
    createRequestId: () => 'request-1',
    onAddPoint() {}, onChangePoint() {}, onSavePoint() {},
    onSelectPhoto() {}, onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    onClockOut: async () => ({}), onClockOutSuccess: async () => {},
  }
  const serverAllowsMarkup = render(ActiveSession, {
    ...common,
    session: session({ workPoints: [point({ ordinal: 2 }), completePoint(1)] }),
    points: [point({ ordinal: 2 })],
  })
  const allowedButton = serverAllowsMarkup.match(/<button[^>]*>打卡下班<\/button>/u)?.[0] || ''
  assert.ok(allowedButton)
  assert.doesNotMatch(allowedButton, /disabled=""/u)

  const localOnlyMarkup = render(ActiveSession, {
    ...common,
    session: session({ workPoints: [point({ ordinal: 1 })] }),
    points: [completePoint(1)],
  })
  const disabledButton = localOnlyMarkup.match(/<button[^>]*>打卡下班<\/button>/u)?.[0] || ''
  assert.match(disabledButton, /disabled=""/u)
  assert.match(disabledButton, /aria-describedby=/u)
  assert.match(localOnlyMarkup, /至少完成一个含开工前和完工照片的点位后可打卡下班。/u)

  const mutationMarkup = render(ActiveSession, {
    ...common,
    mutationPending: true,
    session: session({ workPoints: [completePoint(1)] }),
    points: [completePoint(1)],
  })
  assert.match(mutationMarkup, /其他考勤操作正在处理中，请稍候。/u)
  assert.doesNotMatch(mutationMarkup, /至少完成一个含开工前和完工照片的点位后可打卡下班。/u)
})

test('active session disables clock-out when its snapshotted target geometry is malformed', () => {
  const ActiveSession = componentModule('active').default
  for (const malformedSnapshot of [
    { projectLatitudeSnapshot: Number.NaN },
    { projectLongitudeSnapshot: 181 },
    { attendanceRadiusMetersSnapshot: 0 },
  ]) {
    const markup = render(ActiveSession, {
      session: session({ workPoints: [completePoint(1)], ...malformedSnapshot }),
      points: [completePoint(1)],
      saveStates: {}, photoStates: {}, mutationPending: false,
      locationService: { getCurrentLocation: async () => ({}) },
      createRequestId: () => 'request-1',
      onAddPoint() {}, onChangePoint() {}, onSavePoint() {},
      onSelectPhoto() {}, onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
      onClockOut: async () => ({}), onClockOutSuccess: async () => {},
    })
    const button = markup.match(/<button[^>]*>打卡下班<\/button>/u)?.[0] || ''
    assert.match(button, /disabled=""/u)
    assert.match(button, /aria-describedby=/u)
    assert.match(markup, /当前场次的项目定位不可用，请刷新后重试。/u)
  }
})

test('closed session makes every mutation read-only but keeps active photo preview available', () => {
  const ActiveSession = componentModule('active').default
  const closed = session({
    status: 'closed',
    closedAt: '2026-07-16T09:00:00.000Z',
    clockOutEvent: clockEvent('clock_out', 'normal', '2026-07-16T09:00:00.000Z'),
    workPoints: [completePoint(1)],
  })
  const markup = render(ActiveSession, {
    session: closed,
    points: closed.workPoints,
    saveStates: {}, photoStates: {}, mutationPending: false,
    locationService: { getCurrentLocation: async () => ({}) },
    createRequestId: () => 'request-1',
    onAddPoint() {}, onChangePoint() {}, onSavePoint() {},
    onSelectPhoto() {}, onRetryFinalize() {}, onAbandonPhoto() {}, onOpenPhoto() {},
    onClockOut: async () => ({}), onClockOutSuccess: async () => {},
  })
  assert.match(markup, /查看第 1 点位开工前照片/u)
  assert.match(markup, /查看第 1 点位完工照片/u)
  const textControls = markup.match(/<(?:input|textarea)[^>]*>/gu) || []
  assert.ok(textControls.every((control) => /disabled=""/u.test(control)))
  assert.doesNotMatch(markup, /添加工作点位/u)
})

test('history renders every closed same-day session with Tokyo times, events, points, and active photos', () => {
  const History = componentModule('history').default
  const first = session({
    status: 'closed',
    closedAt: '2026-07-16T08:00:00.000Z',
    clockOutEvent: clockEvent('clock_out', 'abnormal', '2026-07-16T08:00:00.000Z', '交通管制'),
    workPoints: [completePoint(1)],
  })
  const second = session({
    sessionId: 'session-2',
    projectId: 'P002',
    projectNameSnapshot: '品川现场',
    status: 'closed',
    openedAt: '2026-07-16T03:00:00.000Z',
    closedAt: '2026-07-16T10:00:00.000Z',
    clockInEvent: clockEvent('clock_in', 'abnormal', '2026-07-16T03:00:00.000Z', '入口封闭'),
    clockOutEvent: clockEvent('clock_out', 'normal', '2026-07-16T10:00:00.000Z'),
    workPoints: [completePoint(2)],
  })
  const markup = render(History, {
    completedSessions: [first, second, session({ projectNameSnapshot: '开放场次' })],
    onOpenPhoto() {},
  })
  assert.match(markup, /今日已完成/u)
  assert.equal((markup.match(/class="attendance-history-session"/gu) || []).length, 2)
  assert.match(markup, /东京站现场/u)
  assert.match(markup, /品川现场/u)
  assert.doesNotMatch(markup, /开放场次/u)
  assert.match(markup, /上班：正常/u)
  assert.match(markup, /下班：异常/u)
  assert.match(markup, /交通管制/u)
  assert.match(markup, /入口封闭/u)
  assert.match(markup, /<time dateTime="2026-07-16T00:00:00.000Z">[^<]*09:00/u)
  assert.match(markup, /<time dateTime="2026-07-16T08:00:00.000Z">[^<]*17:00/u)
  assert.match(markup, /查看第 1 点位开工前照片/u)
  assert.match(markup, /查看第 2 点位完工照片/u)
})

test('history exposes no mutation contract and all new classes stay attendance-prefixed', () => {
  assert.doesNotMatch(
    sources.history,
    /onChange|onSave|onSelectPhoto|onRetryFinalize|onAbandonPhoto/u,
  )
  assert.match(sources.history, /onOpenPhoto\?\.\(photo\)/u)
  assert.match(sources.history, /timeZone:\s*['"]Asia\/Tokyo['"]/u)

  const allSources = Object.values(sources).join('\n')
  assert.doesNotMatch(
    sources.point + sources.active + sources.history,
    /资料未完整|待补齐|未完成|资料不全|资料不完整/u,
  )
  assert.doesNotMatch(allSources, /localStorage|sessionStorage|indexedDB|signedUrl|createObjectURL/iu)

  const classNames = [...allSources.matchAll(/className=(?:['"]([^'"]+)['"]|`([^`]+)`)/gu)]
    .flatMap((match) => (match[1] || match[2]).split(/\s+/u))
    .filter((name) => name && !name.includes('${'))
  assert.ok(classNames.length >= 20)
  assert.ok(classNames.every((name) => name.startsWith('attendance-')))
})

test('buttons are explicit non-submit controls and progress/errors use accessible live semantics', () => {
  const combinedSource = Object.values(sources).join('\n')
  const buttonOpenings = combinedSource.match(/<button\b[\s\S]*?>/gu) || []
  assert.ok(buttonOpenings.length >= 8)
  assert.ok(buttonOpenings.every((opening) => /type=['"]button['"]/u.test(opening)))
  assert.match(combinedSource, /role=['"]status['"]/u)
  assert.match(combinedSource, /aria-live=['"]polite['"]/u)
  assert.match(combinedSource, /role=['"]alert['"]/u)
  assert.match(combinedSource, /aria-describedby=/u)
})

test('Task 9 page and viewer compile independently through Vite', async () => {
  for (const [key, name] of Object.entries(TASK9_COMPONENT_FILES)) {
    assert.ok(task9Sources[key], `${name} must exist`)
    const result = await transformWithEsbuild(task9Sources[key], name, {
      loader: 'jsx',
      jsx: 'automatic',
    })
    assert.ok(result.code.includes('jsx') || result.code.includes('createElement'))
  }
})

test('initial page snapshot starts both server reads together and accepts only eligible selection', async () => {
  const page = task9Module('page')
  const projectsDeferred = deferred()
  const todayDeferred = deferred()
  const calls = []
  const accepted = []
  const controller = page.createTodayAttendanceSnapshotController({
    service: {
      listAttendanceProjects() {
        calls.push('projects')
        return projectsDeferred.promise
      },
      getMyTodayAttendance() {
        calls.push('today')
        return todayDeferred.promise
      },
    },
    onSnapshot: (snapshot) => accepted.push(snapshot),
  })

  const pending = controller.loadInitial({ selectedProjectId: ineligibleProject.projectId })
  assert.deepEqual(calls, ['projects', 'today'])
  projectsDeferred.resolve([eligibleProject, ineligibleProject])
  const today = {
    workDate: '2026-07-16',
    viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: null,
    completedSessions: [],
    pendingPhotoReservations: [],
  }
  todayDeferred.resolve(today)

  const result = await pending
  assert.equal(result.status, 'accepted')
  assert.deepEqual(result.snapshot.projects, [eligibleProject])
  assert.equal(result.snapshot.selectedProjectId, '')
  assert.equal(result.snapshot.today, today)
  assert.deepEqual(accepted, [result.snapshot])
})

test('page snapshot requests are latest-only, mounted-aware, and forward auth invalidation', async () => {
  const page = task9Module('page')
  const first = deferred()
  const second = deferred()
  const accepted = []
  let request = 0
  const controller = page.createTodayAttendanceSnapshotController({
    service: {
      listAttendanceProjects: async () => [],
      getMyTodayAttendance() {
        request += 1
        return request === 1 ? first.promise : second.promise
      },
    },
    onSnapshot: (snapshot) => accepted.push(snapshot.today.workDate),
  })
  const older = controller.refreshToday()
  const newer = controller.refreshToday()
  second.resolve({
    workDate: '2026-07-17', viewerAccess: { scope: 'all', canViewScopedRecords: true },
    activeSession: null, completedSessions: [], pendingPhotoReservations: [],
  })
  assert.equal((await newer).status, 'accepted')
  first.resolve({
    workDate: '2026-07-16', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: null, completedSessions: [], pendingPhotoReservations: [],
  })
  assert.equal((await older).status, 'stale')
  assert.deepEqual(accepted, ['2026-07-17'])

  const authEvents = []
  const authError = Object.assign(new Error('private'), { code: 'AUTH_INVALID', authInvalid: true })
  const failing = page.createTodayAttendanceSnapshotController({
    service: {
      listAttendanceProjects: async () => [],
      getMyTodayAttendance: async () => { throw authError },
    },
    onAuthInvalid: (error) => authEvents.push(error.code),
  })
  await assert.rejects(() => failing.refreshToday(), authError)
  assert.deepEqual(authEvents, ['AUTH_INVALID'])
  failing.unmount()
  assert.equal((await failing.refreshToday()).status, 'stale')
})

test('draft overlays are session-keyed, text-only, versioned, and clear only after a matching refresh', () => {
  const page = task9Module('page')
  const authoritativePoint = point({
    workPointId: 'server-point',
    sessionId: 'session-1',
    areaName: '服务器区域',
    workDescription: '服务器工作',
    completionNote: '服务器说明',
    photos: { before: activeBeforePhoto, after: null },
  })
  const active = session({ sessionId: 'session-1', workPoints: [authoritativePoint] })
  let drafts = page.updateAttendanceDraft({}, {
    sessionId: 'session-1',
    point: {
      ...authoritativePoint,
      workPointId: 'forged-point',
      areaName: '本地区域',
      workDescription: '本地工作',
      completionNote: '本地说明',
      photos: { before: null, after: activeAfterPhoto },
    },
  })
  const key = page.createAttendanceDraftKey('session-1', 1)
  assert.deepEqual(Object.keys(drafts[key]).sort(), [
    'areaName', 'completionNote', 'ordinal', 'sessionId', 'version', 'workDescription',
  ])
  const overlaid = page.overlayAttendanceDrafts(active, drafts)
  assert.equal(overlaid[0].workPointId, 'server-point')
  assert.equal(overlaid[0].photos, authoritativePoint.photos)
  assert.equal(overlaid[0].areaName, '本地区域')
  assert.equal(drafts[key].version, 1)

  const capturedVersion = drafts[key].version
  drafts = page.updateAttendanceDraft(drafts, {
    sessionId: 'session-1',
    point: { ...overlaid[0], areaName: '更新中的新文字' },
  })
  assert.equal(drafts[key].version, 2)
  assert.equal(page.clearAttendanceDraftAfterRefresh(drafts, {
    sessionId: 'session-1', ordinal: 1, version: capturedVersion,
    today: { activeSession: session({ sessionId: 'session-1', workPoints: [authoritativePoint] }) },
  }), drafts)
  assert.equal(page.clearAttendanceDraftAfterRefresh(drafts, {
    sessionId: 'old-session', ordinal: 1, version: 2,
    today: { activeSession: session({ sessionId: 'new-session', workPoints: [] }) },
  }), drafts)

  const refreshedPoint = {
    ...authoritativePoint,
    areaName: '更新中的新文字',
    workDescription: '本地工作',
    completionNote: '本地说明',
  }
  const cleared = page.clearAttendanceDraftAfterRefresh(drafts, {
    sessionId: 'session-1', ordinal: 1, version: 2,
    today: { activeSession: session({ sessionId: 'session-1', workPoints: [refreshedPoint] }) },
  })
  assert.equal(Object.hasOwn(cleared, key), false)
})

test('photo selection is synchronously single-flight and follows the exact correlated success trace', async () => {
  const page = task9Module('page')
  const reserveDeferred = deferred()
  const actions = []
  const calls = []
  const file = { name: 'before.jpg', type: 'image/jpeg', size: 4, lastModified: 0 }
  const reservation = {
    photoId: 'photo-pending', workPointId: 'point-1', phase: 'before',
    bucketId: 'erp-attendance-photos', objectPath: 'employee/session/point/photo/before',
    originalFileName: 'before.jpg', contentType: 'image/jpeg', sizeBytes: 4,
    uploadStatus: 'pending', capturedAt: null, createdAt: '2026-07-16T00:00:00Z',
  }
  const activePhoto = { ...reservation, uploadStatus: 'active' }
  let today = {
    workDate: '2026-07-16', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: session({ workPoints: [point()] }),
    completedSessions: [], pendingPhotoReservations: [],
  }
  const controller = page.createAttendancePhotoOperationController({
    service: {
      reservePhoto(input) {
        calls.push(['reserve', input])
        return reserveDeferred.promise
      },
      async finalizePhoto(input) {
        calls.push(['finalize', input])
        return activePhoto
      },
      async abandonPhoto(input) {
        calls.push(['abandon', input])
        throw new Error('must not abandon a successful upload')
      },
    },
    photoStorage: {
      async uploadReservedPhoto(input) {
        calls.push(['upload', input])
        return { uploaded: true }
      },
    },
    createAttemptId: () => 'attempt-1',
    getToday: () => today,
    async refreshToday() {
      calls.push(['refresh'])
      today = {
        ...today,
        activeSession: session({
          workPoints: [point({ photos: { before: activePhoto, after: null } })],
        }),
      }
      return { status: 'accepted', today }
    },
    onAction: (key, action) => actions.push([key, action]),
  })

  const first = controller.selectPhoto({ workPointId: 'point-1', phase: 'before', file })
  const duplicate = controller.selectPhoto({ workPointId: 'point-1', phase: 'before', file })
  assert.equal((await duplicate).status, 'busy')
  assert.equal(calls.filter(([name]) => name === 'reserve').length, 1)
  reserveDeferred.resolve(reservation)
  assert.equal((await first).status, 'succeeded')
  assert.deepEqual(calls.map(([name]) => name), ['reserve', 'upload', 'finalize', 'refresh'])
  assert.deepEqual(calls[0][1], {
    workPointId: 'point-1', phase: 'before', originalFileName: 'before.jpg',
    contentType: 'image/jpeg', sizeBytes: 4, capturedAt: null,
  })
  assert.equal(calls[1][1].reservation, reservation)
  assert.equal(calls[1][1].file, file)
  assert.deepEqual(calls[2][1], { photoId: 'photo-pending' })
  assert.deepEqual(actions.map(([, action]) => action.type), [
    'select', 'reserve-start', 'reserve-success', 'upload-success', 'finalize-success',
  ])
  assert.equal(actions[1][1].attemptId, 'attempt-1')
  assert.equal(actions[2][1].attemptId, 'attempt-1')
  assert.equal(actions[3][1].photoId, 'photo-pending')
  assert.equal(actions[4][1].photo, activePhoto)
  assert.equal(controller.getState('point-1:before').phase, 'active')
})

function createPhotoHarness(overrides = {}) {
  const file = overrides.file || {
    name: 'before.jpg', type: 'image/jpeg', size: 4, lastModified: 0,
  }
  const reservation = overrides.reservation || {
    photoId: 'photo-pending', workPointId: 'point-1', phase: 'before',
    bucketId: 'erp-attendance-photos', objectPath: 'employee/session/point/photo/before',
    originalFileName: 'before.jpg', contentType: 'image/jpeg', sizeBytes: 4,
    uploadStatus: 'pending', capturedAt: null, createdAt: '2026-07-16T00:00:00Z',
  }
  const activePhoto = overrides.activePhoto || { ...reservation, uploadStatus: 'active' }
  const cleanupPhoto = overrides.cleanupPhoto || { ...reservation, uploadStatus: 'cleanup_pending' }
  let today = overrides.today || {
    workDate: '2026-07-16', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: session({ workPoints: [point()] }),
    completedSessions: [], pendingPhotoReservations: [],
  }
  const actions = []
  const calls = []
  const service = {
    async reservePhoto(input) {
      calls.push(['reserve', input])
      if (overrides.reservePhoto) return overrides.reservePhoto(input)
      return reservation
    },
    async finalizePhoto(input) {
      calls.push(['finalize', input])
      if (overrides.finalizePhoto) return overrides.finalizePhoto(input)
      return activePhoto
    },
    async abandonPhoto(input) {
      calls.push(['abandon', input])
      if (overrides.abandonPhoto) return overrides.abandonPhoto(input)
      return cleanupPhoto
    },
  }
  const photoStorage = {
    async uploadReservedPhoto(input) {
      calls.push(['upload', input])
      if (overrides.uploadReservedPhoto) return overrides.uploadReservedPhoto(input)
      return { uploaded: true }
    },
  }
  const authEvents = []
  const page = task9Module('page')
  const controller = page.createAttendancePhotoOperationController({
    service,
    photoStorage,
    createAttemptId: overrides.createAttemptId || (() => 'attempt-1'),
    getToday: () => today,
    async refreshToday() {
      calls.push(['refresh'])
      if (overrides.refreshToday) return overrides.refreshToday({ today, setToday })
      return { status: 'accepted', today }
    },
    onAuthInvalid: (error) => authEvents.push(error.code),
    onAction: (key, action) => actions.push([key, action]),
  })
  function setToday(nextToday) {
    today = nextToday
  }
  return {
    controller, service, photoStorage, file, reservation, activePhoto, cleanupPhoto,
    actions, calls, authEvents, getToday: () => today, setToday,
  }
}

test('photo validation and reservation failures stop before storage with exact attempt correlation', async () => {
  for (const createAttemptId of [() => '', () => '   ', () => { throw new Error('broken uuid source') }]) {
    const harness = createPhotoHarness({ createAttemptId })
    const result = await harness.controller.selectPhoto({
      workPointId: 'point-1', phase: 'before', file: harness.file,
    })
    assert.equal(result.status, 'invalid')
    assert.equal(harness.calls.length, 0)
    assert.equal(harness.actions.length, 0)
  }
  const invalidFile = createPhotoHarness()
  assert.equal((await invalidFile.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before',
    file: { name: 'payload.pdf', type: 'application/pdf', size: 4 },
  })).status, 'invalid')
  assert.equal(invalidFile.calls.length, 0)

  const authError = Object.assign(new Error('private'), {
    code: 'AUTH_INVALID', authInvalid: true,
  })
  const failed = createPhotoHarness({ reservePhoto: async () => { throw authError } })
  assert.deepEqual(await failed.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: failed.file,
  }), { status: 'failed', stage: 'reserve' })
  assert.deepEqual(failed.actions.map(([, action]) => action.type), [
    'select', 'reserve-start', 'reserve-failure',
  ])
  assert.equal(failed.actions[1][1].attemptId, 'attempt-1')
  assert.equal(failed.actions[2][1].attemptId, 'attempt-1')
  assert.deepEqual(failed.authEvents, ['AUTH_INVALID'])
  assert.equal(failed.calls.some(([name]) => name === 'upload'), false)

  for (const patch of [
    { workPointId: 'foreign-point' },
    { phase: 'after' },
    { uploadStatus: 'active' },
    { photoId: '' },
    { photoId: '   ' },
  ]) {
    const foreign = createPhotoHarness({
      reservePhoto: async () => ({ ...createPhotoHarness().reservation, ...patch }),
    })
    const result = await foreign.controller.selectPhoto({
      workPointId: 'point-1', phase: 'before', file: foreign.file,
    })
    assert.deepEqual(result, { status: 'failed', stage: 'reserve' })
    assert.equal(foreign.calls.some(([name]) => name === 'upload'), false)
    assert.equal(foreign.controller.getState('point-1:before').failedStage, 'reserve')
  }
})

test('upload failure performs correlated abandon cleanup and never reports refresh as cleanup failure', async () => {
  const uploadError = Object.assign(new Error('storage down'), { code: 'UPLOAD_FAILED' })
  const cleaned = createPhotoHarness({
    uploadReservedPhoto: async () => { throw uploadError },
  })
  assert.deepEqual(await cleaned.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: cleaned.file,
  }), { status: 'cleaned' })
  assert.deepEqual(cleaned.calls.map(([name]) => name), [
    'reserve', 'upload', 'abandon', 'refresh',
  ])
  assert.deepEqual(cleaned.actions.map(([, action]) => action.type), [
    'select', 'reserve-start', 'reserve-success', 'upload-failure',
    'abandon-start', 'abandon-success',
  ])
  assert.equal(cleaned.actions[3][1].photoId, cleaned.reservation.photoId)
  assert.equal(cleaned.actions[4][1].photoId, cleaned.reservation.photoId)
  assert.equal(cleaned.actions[5][1].photo, cleaned.cleanupPhoto)
  assert.equal(cleaned.controller.getState('point-1:before').phase, 'cleanup_pending')

  for (const cleanupPhoto of [
    null,
    { ...cleaned.cleanupPhoto, photoId: 'stale-photo' },
    { ...cleaned.cleanupPhoto, workPointId: 'foreign-point' },
    { ...cleaned.cleanupPhoto, phase: 'after' },
    { ...cleaned.cleanupPhoto, uploadStatus: 'active' },
  ]) {
    const malformed = createPhotoHarness({
      uploadReservedPhoto: async () => { throw uploadError },
      abandonPhoto: async () => cleanupPhoto,
    })
    assert.deepEqual(await malformed.controller.selectPhoto({
      workPointId: 'point-1', phase: 'before', file: malformed.file,
    }), { status: 'failed', stage: 'abandon' })
    assert.equal(malformed.calls.some(([name]) => name === 'refresh'), false)
    const state = malformed.controller.getState('point-1:before')
    assert.equal(state.failedStage, 'abandon')
    assert.ok(state.errorCode)
  }

  const refreshError = Object.assign(new Error('refresh down'), { code: 'REFRESH_FAILED' })
  const refreshFailed = createPhotoHarness({
    uploadReservedPhoto: async () => { throw uploadError },
    refreshToday: async () => { throw refreshError },
  })
  assert.deepEqual(await refreshFailed.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: refreshFailed.file,
  }), { status: 'refresh-failed', stage: 'abandon', errorCode: 'REFRESH_FAILED' })
  assert.equal(refreshFailed.controller.getState('point-1:before').phase, 'cleanup_pending')
  assert.equal(refreshFailed.actions.some(([, action]) => action.type === 'abandon-failure'), false)
})

test('finalize failures remain finalize-only across reconciliation and retry only finalize', async () => {
  let finalizeCalls = 0
  const finalizeError = Object.assign(new Error('uncertain'), { code: 'FINALIZE_UNCERTAIN' })
  const harness = createPhotoHarness({
    finalizePhoto: async () => {
      finalizeCalls += 1
      if (finalizeCalls === 1) throw finalizeError
      return harness.activePhoto
    },
  })
  assert.deepEqual(await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  }), { status: 'failed', stage: 'finalize' })
  assert.equal(harness.controller.getState('point-1:before').failedStage, 'finalize')
  harness.controller.reconcile({
    ...harness.getToday(),
    pendingPhotoReservations: [harness.reservation],
  })
  assert.equal(harness.controller.getState('point-1:before').failedStage, 'finalize')
  assert.deepEqual(await harness.controller.abandonPhoto({
    workPointId: 'point-1', phase: 'before', photoId: harness.reservation.photoId,
  }), { status: 'prohibited' })
  const beforeRetry = harness.calls.length
  assert.equal((await harness.controller.retryFinalize({
    workPointId: 'point-1', phase: 'before', photoId: harness.reservation.photoId,
  })).status, 'succeeded')
  assert.deepEqual(harness.calls.slice(beforeRetry).map(([name]) => name), ['finalize', 'refresh'])
  assert.equal(harness.calls.some(([name]) => name === 'abandon'), false)
  assert.deepEqual(harness.actions.slice(-2).map(([, action]) => action.type), [
    'finalize-retry', 'finalize-success',
  ])

  const malformed = createPhotoHarness({
    finalizePhoto: async () => ({ ...harness.activePhoto, photoId: 'stale-photo' }),
  })
  assert.deepEqual(await malformed.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: malformed.file,
  }), { status: 'failed', stage: 'finalize' })
  assert.equal(malformed.calls.some(([name]) => name === 'refresh'), false)
  assert.equal(malformed.controller.getState('point-1:before').failedStage, 'finalize')

  const refreshError = Object.assign(new Error('refresh down'), { code: 'REFRESH_FAILED' })
  const refreshFailed = createPhotoHarness({ refreshToday: async () => { throw refreshError } })
  assert.deepEqual(await refreshFailed.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: refreshFailed.file,
  }), { status: 'refresh-failed', stage: 'finalize', errorCode: 'REFRESH_FAILED' })
  assert.equal(refreshFailed.controller.getState('point-1:before').phase, 'active')
  assert.equal(refreshFailed.actions.some(([, action]) => action.type === 'finalize-failure'), false)
})

test('recovered pending reservations support correlated finalize or repeatable abandon only', async () => {
  let abandonCalls = 0
  const abandonError = Object.assign(new Error('cleanup uncertain'), { code: 'ABANDON_FAILED' })
  const harness = createPhotoHarness({
    abandonPhoto: async () => {
      abandonCalls += 1
      if (abandonCalls === 1) throw abandonError
      return harness.cleanupPhoto
    },
  })
  harness.controller.reconcile({
    ...harness.getToday(), pendingPhotoReservations: [harness.reservation],
  })
  assert.equal(harness.controller.getState('point-1:before').failedStage, 'recovered')
  assert.deepEqual(await harness.controller.abandonPhoto({
    workPointId: 'point-1', phase: 'before', photoId: 'stale-photo',
  }), { status: 'invalid' })
  assert.deepEqual(await harness.controller.abandonPhoto({
    workPointId: 'point-1', phase: 'before', photoId: harness.reservation.photoId,
  }), { status: 'failed', stage: 'abandon' })
  assert.equal(harness.controller.getState('point-1:before').failedStage, 'abandon')
  assert.deepEqual(await harness.controller.abandonPhoto({
    workPointId: 'point-1', phase: 'before', photoId: harness.reservation.photoId,
  }), { status: 'cleaned' })
  assert.equal(abandonCalls, 2)
  assert.deepEqual(harness.actions.slice(-4).map(([, action]) => action.type), [
    'abandon-start', 'abandon-failure', 'abandon-start', 'abandon-success',
  ])

  const recoveredFinalize = createPhotoHarness()
  recoveredFinalize.controller.reconcile({
    ...recoveredFinalize.getToday(),
    pendingPhotoReservations: [recoveredFinalize.reservation],
  })
  assert.equal((await recoveredFinalize.controller.retryFinalize({
    workPointId: 'point-1', phase: 'before', photoId: recoveredFinalize.reservation.photoId,
  })).status, 'succeeded')
  assert.deepEqual(recoveredFinalize.calls.map(([name]) => name), ['finalize', 'refresh'])
})

test('stale photo attempt cannot dispatch into a replacement session or start the next phase', async () => {
  const reserveA = deferred()
  const harness = createPhotoHarness({ reservePhoto: () => reserveA.promise })
  const attemptA = harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })
  harness.setToday({
    ...harness.getToday(),
    activeSession: session({ sessionId: 'session-2', workPoints: [point({ sessionId: 'session-2' })] }),
  })
  reserveA.resolve(harness.reservation)
  assert.deepEqual(await attemptA, { status: 'stale' })
  assert.deepEqual(harness.actions.map(([, action]) => action.type), ['select', 'reserve-start'])
  assert.equal(harness.calls.some(([name]) => name === 'upload'), false)
  assert.equal(harness.calls.some(([name]) => name === 'finalize'), false)
})

test('work-point save is same-tick single-flight, refresh-authoritative, and version-safe', async () => {
  const page = task9Module('page')
  const upsertDeferred = deferred()
  const calls = []
  let today = {
    workDate: '2026-07-16', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: session({ workPoints: [point()] }),
    completedSessions: [], pendingPhotoReservations: [],
  }
  let drafts = page.updateAttendanceDraft({}, {
    sessionId: 'session-1',
    point: point({ areaName: '编辑区域', workDescription: '编辑工作', completionNote: '编辑说明' }),
  })
  const controller = page.createAttendanceWorkPointSaveController({
    service: {
      upsertWorkPoint(input) {
        calls.push(['save', input])
        return upsertDeferred.promise
      },
    },
    getToday: () => today,
    getDrafts: () => drafts,
    setDrafts: (next) => { drafts = next },
    async refreshToday() {
      calls.push(['refresh'])
      today = {
        ...today,
        activeSession: session({
          workPoints: [point({
            areaName: '编辑区域', workDescription: '编辑工作', completionNote: '编辑说明',
          })],
        }),
      }
      return { status: 'accepted', today }
    },
  })
  const edited = page.overlayAttendanceDrafts(today.activeSession, drafts)[0]
  const first = controller.savePoint(edited)
  const duplicate = controller.savePoint(edited)
  assert.deepEqual(await duplicate, { status: 'busy' })
  assert.equal(calls.filter(([name]) => name === 'save').length, 1)
  assert.deepEqual(calls[0][1], {
    sessionId: 'session-1', ordinal: 1,
    areaName: '编辑区域', workDescription: '编辑工作', completionNote: '编辑说明',
  })
  upsertDeferred.resolve(point())
  assert.deepEqual(await first, { status: 'succeeded' })
  assert.deepEqual(calls.map(([name]) => name), ['save', 'refresh'])
  assert.equal(Object.hasOwn(drafts, 'session-1:1'), false)
})

test('save refresh failure preserves dirty text and old-session completion cannot clear a new draft', async () => {
  const page = task9Module('page')
  const refreshError = Object.assign(new Error('refresh failed'), { code: 'REFRESH_FAILED' })
  let today = {
    workDate: '2026-07-16', viewerAccess: { scope: 'own', canViewScopedRecords: false },
    activeSession: session({ workPoints: [point()] }),
    completedSessions: [], pendingPhotoReservations: [],
  }
  let drafts = page.updateAttendanceDraft({}, {
    sessionId: 'session-1', point: point({ areaName: '未保存文字' }),
  })
  const failed = page.createAttendanceWorkPointSaveController({
    service: { upsertWorkPoint: async () => point() },
    getToday: () => today,
    getDrafts: () => drafts,
    setDrafts: (next) => { drafts = next },
    refreshToday: async () => { throw refreshError },
  })
  assert.deepEqual(await failed.savePoint(page.overlayAttendanceDrafts(today.activeSession, drafts)[0]), {
    status: 'refresh-failed', errorCode: 'REFRESH_FAILED',
  })
  assert.equal(drafts['session-1:1'].areaName, '未保存文字')

  const saveDeferred = deferred()
  const oldDrafts = drafts
  let refreshCalls = 0
  const stale = page.createAttendanceWorkPointSaveController({
    service: { upsertWorkPoint: () => saveDeferred.promise },
    getToday: () => today,
    getDrafts: () => drafts,
    setDrafts: (next) => { drafts = next },
    refreshToday: async () => { refreshCalls += 1; return { status: 'accepted', today } },
  })
  const pending = stale.savePoint(page.overlayAttendanceDrafts(today.activeSession, drafts)[0])
  today = {
    ...today,
    activeSession: session({ sessionId: 'session-2', workPoints: [point({ sessionId: 'session-2' })] }),
  }
  drafts = page.updateAttendanceDraft(drafts, {
    sessionId: 'session-2', point: point({ sessionId: 'session-2', areaName: '新场次文字' }),
  })
  saveDeferred.resolve(point())
  assert.deepEqual(await pending, { status: 'stale' })
  assert.equal(refreshCalls, 0)
  assert.equal(drafts['session-1:1'], oldDrafts['session-1:1'])
  assert.equal(drafts['session-2:1'].areaName, '新场次文字')
})

test('clock controller sends the immutable server target and holds its lock through refresh', async () => {
  const page = task9Module('page')
  const calls = []
  let today = {
    activeSession: session({ sessionId: 'session-1', projectId: 'P001' }),
  }
  const selectedProject = eligibleProject
  const controller = page.createAttendanceClockController({
    service: {
      async clockIn(input) { calls.push(['clock-in', input]); return { session: session() } },
      async clockOut(input) { calls.push(['clock-out', input]); return { session: session() } },
    },
    getToday: () => today,
    getSelectedProject: () => selectedProject,
    async refreshToday() { calls.push(['refresh']); return { status: 'accepted', today } },
  })
  const submission = {
    requestId: 'request-1',
    location: { latitude: 35, longitude: 139, accuracyMeters: 10, deviceRecordedAt: null },
    abnormalReason: null,
  }
  assert.equal((await controller.clockOut(submission)).status, 'submitted')
  assert.deepEqual(calls[0], ['clock-out', { sessionId: 'session-1', ...submission }])
  assert.equal(Object.hasOwn(calls[0][1], 'projectId'), false)
  assert.deepEqual(await controller.clockIn(submission), { status: 'busy' })
  assert.deepEqual(await controller.refreshAfterClock(), { status: 'succeeded' })

  today = { activeSession: null }
  assert.equal((await controller.clockIn(submission)).status, 'submitted')
  assert.deepEqual(calls[2], ['clock-in', { projectId: 'P001', ...submission }])
  assert.equal(Object.hasOwn(calls[2][1], 'sessionId'), false)
  assert.deepEqual(await controller.refreshAfterClock(), { status: 'succeeded' })
})

test('signed preview is component-memory only and invalidates older, closed, and unmounted requests', async () => {
  const page = task9Module('page')
  const previewA = deferred()
  const previewB = deferred()
  const committed = []
  const controller = page.createAttendancePhotoPreviewController({
    photoStorage: {
      createAttendancePhotoSignedUrl({ photo }) {
        return photo.photoId === 'A' ? previewA.promise : previewB.promise
      },
    },
    onPreview: (preview) => committed.push(preview),
  })
  const photoA = { photoId: 'A', uploadStatus: 'active' }
  const photoB = { photoId: 'B', uploadStatus: 'active' }
  const openingA = controller.open({ photo: photoA, context: { projectName: 'A项目', ordinal: 1, phase: 'before' } })
  const openingB = controller.open({ photo: photoB, context: { projectName: 'B项目', ordinal: 2, phase: 'after' } })
  previewB.resolve('https://signed.invalid/B')
  assert.equal((await openingB).status, 'opened')
  previewA.resolve('https://signed.invalid/A')
  assert.deepEqual(await openingA, { status: 'stale' })
  assert.equal(committed.at(-1).url, 'https://signed.invalid/B')

  const pendingClose = deferred()
  const closeController = page.createAttendancePhotoPreviewController({
    photoStorage: { createAttendancePhotoSignedUrl: () => pendingClose.promise },
    onPreview: (preview) => committed.push(preview),
  })
  const openingClose = closeController.open({ photo: photoA, context: {} })
  closeController.close()
  pendingClose.resolve('https://signed.invalid/closed')
  assert.deepEqual(await openingClose, { status: 'stale' })
  assert.equal(committed.at(-1), null)

  const pendingUnmount = deferred()
  const unmounted = page.createAttendancePhotoPreviewController({
    photoStorage: { createAttendancePhotoSignedUrl: () => pendingUnmount.promise },
    onPreview: (preview) => committed.push(preview),
  })
  const openingUnmount = unmounted.open({ photo: photoA, context: {} })
  unmounted.unmount()
  pendingUnmount.resolve('https://signed.invalid/unmounted')
  assert.deepEqual(await openingUnmount, { status: 'stale' })
})

test('record viewer performs zero calls without server access and normalizes cursor halves', async () => {
  const viewer = task9Module('viewer')
  let calls = 0
  const denied = viewer.createAttendanceRecordViewerController({
    access: { scope: 'own', canViewScopedRecords: false },
    workDate: '2026-07-16',
    service: { listAttendanceRecords: async () => { calls += 1 } },
  })
  assert.deepEqual(await denied.search(), { status: 'denied' })
  assert.deepEqual(await denied.loadMore(), { status: 'denied' })
  assert.equal(calls, 0)
  assert.deepEqual(viewer.normalizeAttendanceRecordCursor({
    openedAt: '2026-07-16T00:00:00Z', sessionId: '',
  }), { beforeOpenedAt: null, beforeSessionId: null })
  assert.deepEqual(viewer.createAttendanceRecordQuery({
    workDate: '2026-07-16', projectId: '', employeeProfileId: undefined,
    cursor: { openedAt: '2026-07-16T00:00:00Z', sessionId: '' },
  }), {
    workDate: '2026-07-16', projectId: null, employeeProfileId: null,
    beforeOpenedAt: null, beforeSessionId: null, limit: 50,
  })
})

test('record viewer searches latest-only and load-more is cursor-paired, deduplicated, and same-tick locked', async () => {
  const viewer = task9Module('viewer')
  const first = deferred()
  const second = deferred()
  const pageMore = deferred()
  const calls = []
  const states = []
  let call = 0
  const controller = viewer.createAttendanceRecordViewerController({
    access: { scope: 'all', canViewScopedRecords: true },
    workDate: '2026-07-16',
    service: {
      listAttendanceRecords(query) {
        calls.push(query)
        call += 1
        return call === 1 ? first.promise : call === 2 ? second.promise : pageMore.promise
      },
    },
    onState: (state) => states.push(state),
  })
  const oldSearch = controller.search({
    workDate: '2026-07-16', projectId: 'P001', employeeProfileId: null,
  })
  const newSearch = controller.search({
    workDate: '2026-07-17', projectId: 'P002', employeeProfileId: 'employee-2',
  })
  second.resolve({
    access: { scope: 'all' },
    filterOptions: { projects: [{ projectId: 'P002', projectName: '新项目' }], employees: [] },
    items: [session({ sessionId: 'session-new' })],
    nextCursor: { openedAt: '2026-07-17T00:00:00Z', sessionId: 'session-new' },
  })
  assert.equal((await newSearch).status, 'accepted')
  first.resolve({
    access: { scope: 'own' }, filterOptions: { projects: [], employees: [] },
    items: [session({ sessionId: 'session-old' })], nextCursor: null,
  })
  assert.deepEqual(await oldSearch, { status: 'stale' })
  assert.equal(controller.getState().items[0].sessionId, 'session-new')
  assert.equal(controller.getState().filterOptions.projects[0].projectName, '新项目')
  assert.deepEqual(controller.getState().access, { scope: 'all' })

  const load = controller.loadMore()
  const duplicate = controller.loadMore()
  assert.deepEqual(await duplicate, { status: 'busy' })
  assert.deepEqual(calls[2], {
    workDate: '2026-07-17', projectId: 'P002', employeeProfileId: 'employee-2',
    beforeOpenedAt: '2026-07-17T00:00:00Z', beforeSessionId: 'session-new', limit: 50,
  })
  pageMore.resolve({
    access: { scope: 'assigned_projects' },
    filterOptions: { projects: [{ projectId: 'P003', projectName: '更新选项' }], employees: [] },
    items: [session({ sessionId: 'session-new' }), session({ sessionId: 'session-next' })],
    nextCursor: null,
  })
  assert.equal((await load).status, 'accepted')
  assert.deepEqual(controller.getState().items.map((item) => item.sessionId), [
    'session-new', 'session-next',
  ])
  assert.equal(controller.getState().filterOptions.projects[0].projectName, '更新选项')
  assert.deepEqual(controller.getState().access, { scope: 'assigned_projects' })
})

test('server access alone resolves the active tab and revocation forces mine', () => {
  const page = task9Module('page')
  assert.equal(page.resolveAttendanceViewTab('records', {
    scope: 'all', canViewScopedRecords: true,
  }), 'records')
  assert.equal(page.resolveAttendanceViewTab('records', {
    scope: 'own', canViewScopedRecords: false,
  }), 'mine')
  assert.equal(page.resolveAttendanceViewTab('records', null), 'mine')
  assert.equal(page.resolveAttendanceViewTab('unknown', {
    scope: 'all', canViewScopedRecords: true,
  }), 'mine')
})

test('today view composes picker or committed active-session props with accessible tabs', () => {
  const page = task9Module('page')
  const common = {
    loading: false,
    errorCode: null,
    drafts: {},
    saveStates: {},
    photoStates: {},
    mutationPending: false,
    locationService: { getCurrentLocation: async () => ({}) },
    createRequestId: () => 'request-1',
    recordService: { listAttendanceRecords: async () => { throw new Error('effect must not run in SSR') } },
    handlers: {
      selectProject() {}, addPoint() {}, changePoint() {}, savePoint() {},
      selectPhoto() {}, retryFinalize() {}, abandonPhoto() {}, openPhoto() {},
      clockIn: async () => ({}), clockOut: async () => ({}), clockRefresh: async () => {},
    },
    onTabChange() {}, onBack() {}, onAuthInvalid() {},
  }
  const noSessionToday = {
    workDate: '2026-07-16',
    viewerAccess: { scope: 'all', canViewScopedRecords: true },
    activeSession: null, completedSessions: [], pendingPhotoReservations: [],
  }
  const clockInMarkup = render(page.TodayAttendanceView, {
    ...common,
    tab: 'mine',
    snapshot: { projects: [eligibleProject], selectedProjectId: 'P001', today: noSessionToday },
  })
  assert.match(clockInMarkup, /<main class="app-shell page-shell attendance-page">/u)
  assert.match(clockInMarkup, /<h1>今日打卡<\/h1>/u)
  assert.match(clockInMarkup, /返回/u)
  assert.match(clockInMarkup, /role="tablist"/u)
  assert.equal((clockInMarkup.match(/role="tab"/gu) || []).length, 2)
  assert.match(clockInMarkup, /选择打卡项目/u)
  assert.match(clockInMarkup, /打卡上班/u)
  assert.doesNotMatch(clockInMarkup, /当前项目场次/u)

  const activeToday = {
    ...noSessionToday,
    activeSession: session({ workPoints: [point()] }),
  }
  const activeMarkup = render(page.TodayAttendanceView, {
    ...common,
    tab: 'mine',
    snapshot: { projects: [eligibleProject], selectedProjectId: 'P001', today: activeToday },
    drafts: task9Module('page').updateAttendanceDraft({}, {
      sessionId: 'session-1',
      point: point({ areaName: '本地完整文字', workDescription: '本地完整工作' }),
    }),
  })
  assert.match(activeMarkup, /当前项目场次/u)
  assert.doesNotMatch(activeMarkup, /选择打卡项目/u)
  const clockOutButton = activeMarkup.match(/<button[^>]*>打卡下班<\/button>/u)?.[0] || ''
  assert.match(clockOutButton, /disabled=""/u)
  assert.match(activeMarkup, /至少完成一个含开工前和完工照片的点位后可打卡下班。/u)
})

test('record viewer SSR is authorization-gated, filter-driven, and read-only', () => {
  const viewer = task9Module('viewer')
  assert.equal(render(viewer.default, {
    access: { scope: 'own', canViewScopedRecords: false },
    workDate: '2026-07-16',
    service: { listAttendanceRecords: async () => { throw new Error('must not run') } },
  }), '')

  const record = session({
    status: 'closed',
    closedAt: '2026-07-16T09:00:00Z',
    clockOutEvent: clockEvent('clock_out', 'abnormal', '2026-07-16T09:00:00Z', '交通管制'),
    workPoints: [completePoint(1)],
  })
  const state = {
    filters: { workDate: '2026-07-16', projectId: 'P001', employeeProfileId: null },
    access: { scope: 'all' },
    filterOptions: {
      projects: [{ projectId: 'P001', projectName: '东京站现场' }],
      employees: [{
        employeeProfileId: 'employee-1', employeeNumberSnapshot: 'SW-001',
        employeeNameSnapshot: '山田太郎',
      }],
    },
    items: [record], nextCursor: null, loading: false, errorCode: null,
  }
  const markup = render(viewer.AttendanceRecordViewerView, {
    state,
    onSearch() {}, onLoadMore() {}, onOpenPhoto() {},
  })
  assert.match(markup, /<label[^>]*>日期<\/label>/u)
  assert.match(markup, /项目筛选/u)
  assert.match(markup, /员工筛选/u)
  assert.match(markup, /山田太郎/u)
  assert.match(markup, /SW-001/u)
  assert.match(markup, /东京站现场/u)
  assert.match(markup, /下班：异常/u)
  assert.match(markup, /交通管制/u)
  assert.match(markup, /查看第 1 点位开工前照片/u)
  assert.doesNotMatch(markup, /保存现场日志|添加工作点位|重试确认|放弃本次上传|批准|拒绝|修正/u)
})

test('photo modal has contextual alt text, labeled close, dialog semantics, focus, and Escape handling', () => {
  const page = task9Module('page')
  const markup = render(page.AttendancePhotoModal, {
    preview: {
      status: 'opened',
      url: 'https://signed.invalid/photo',
      photo: { photoId: 'photo-1', phase: 'before', uploadStatus: 'active' },
      context: { projectName: '东京站现场', ordinal: 2, phase: 'before' },
    },
    onClose() {},
  })
  assert.match(markup, /role="dialog"/u)
  assert.match(markup, /aria-modal="true"/u)
  assert.match(markup, /aria-label="关闭照片预览"/u)
  assert.match(markup, /alt="东京站现场第 2 点位开工前照片"/u)
  assert.match(task9Sources.page, /\.focus\(\)/u)
  assert.match(task9Sources.page, /event\.key === ['"]Escape['"]/u)
})

test('Task 9 source is server-authorized, ephemeral, scoped, and free of mutation backdoors', () => {
  const combined = `${task9Sources.page}\n${task9Sources.viewer}`
  assert.match(task9Sources.page, /import ['"]\.\/todayAttendance\.css['"]/u)
  assert.doesNotMatch(
    combined,
    /currentUser\s*\?*\.|\.position\b|employeeNumber\s*===|SW-000|社长|localStorage|sessionStorage|indexedDB|createObjectURL|getPublicUrl|upsert:\s*true|console\.|location\.(?:search|hash)|URLSearchParams/iu,
  )
  assert.doesNotMatch(combined, /批准|拒绝|修正|approve|reject|correction/iu)
  assert.doesNotMatch(task9Sources.viewer, /canViewScopedRecords[^\n]*page|page[^\n]*canViewScopedRecords/u)
  assert.match(task9Sources.page, /AttendanceProjectPicker/u)
  assert.match(task9Sources.page, /AttendanceLocationAction/u)
  assert.match(task9Sources.page, /ActiveAttendanceSession/u)
  assert.match(task9Sources.page, /TodayAttendanceHistory/u)
})

test('attendance stylesheet exists, stays page-scoped, and visibly focuses controls', () => {
  assert.ok(task9Css, 'todayAttendance.css must exist')
  for (const selector of [
    '.attendance-page', '.attendance-view-tabs', '.attendance-session-card',
    '.attendance-work-point-grid', '.attendance-photo-grid',
    '.attendance-location-result', '.attendance-error', '.attendance-photo-modal',
  ]) assert.match(task9Css, new RegExp(selector.replace('.', '\\.'), 'u'))
  assert.match(task9Css, /:focus-visible/u)
  const selectors = task9Css
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .split('{')
    .slice(0, -1)
    .map((block) => block.split('}').at(-1).trim())
    .filter(Boolean)
  assert.ok(selectors.every((selector) => selector.split(',').every(
    (part) => part.trim().startsWith('.attendance-page'),
  )))
})

test('accepted server active photo resets terminal local presentation so the slot can be replaced', async () => {
  let attempt = 0
  let harness
  harness = createPhotoHarness({
    createAttemptId: () => `attempt-${++attempt}`,
    reservePhoto: async () => ({
      ...harness.reservation,
      photoId: `photo-${attempt}`,
    }),
    finalizePhoto: async ({ photoId }) => ({
      ...harness.activePhoto,
      photoId,
    }),
  })
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).status, 'succeeded')
  const firstActive = harness.controller.getState('point-1:before').activePhoto
  const acceptedToday = {
    ...harness.getToday(),
    activeSession: session({
      workPoints: [point({ photos: { before: firstActive, after: null } })],
    }),
  }
  harness.setToday(acceptedToday)
  harness.controller.reconcile(acceptedToday)
  assert.equal(harness.controller.getState('point-1:before').phase, 'idle')

  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).status, 'succeeded')
  assert.equal(harness.calls.filter(([name]) => name === 'reserve').length, 2)
  assert.equal(harness.controller.getState('point-1:before').activePhoto.photoId, 'photo-2')
})

test('a reused local photo attempt id fails closed before a second reserve call', async () => {
  const reserveError = Object.assign(new Error('reserve failed'), { code: 'RESERVE_FAILED' })
  const harness = createPhotoHarness({
    createAttemptId: () => 'duplicate-attempt',
    reservePhoto: async () => { throw reserveError },
  })
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).status, 'failed')
  assert.deepEqual(await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  }), { status: 'invalid', errorCode: 'ATTENDANCE_PHOTO_ATTEMPT_INVALID' })
  assert.equal(harness.calls.filter(([name]) => name === 'reserve').length, 1)
})

test('controller replacement cleanup does not permanently unmount an externally owned write guard', () => {
  const page = task9Module('page')
  const factories = [
    (writeGuard) => page.createAttendanceWorkPointSaveController({
      service: {}, getToday() {}, getDrafts: () => ({}), setDrafts() {},
      refreshToday() {}, writeGuard,
    }),
    (writeGuard) => page.createAttendancePhotoOperationController({
      service: {}, photoStorage: {}, createAttemptId() {}, getToday() {},
      refreshToday() {}, writeGuard,
    }),
    (writeGuard) => page.createAttendanceClockController({
      service: {}, getToday() {}, getSelectedProject() {}, refreshToday() {}, writeGuard,
    }),
  ]
  for (const factory of factories) {
    const sharedGuard = page.createAttendancePageWriteGuard()
    factory(sharedGuard).unmount()
    const token = sharedGuard.begin()
    assert.notEqual(token, null)
    sharedGuard.finish(token)
  }
})

test('new record search synchronously clears the old cursor and blocks load-more while pending', async () => {
  const viewer = task9Module('viewer')
  const nextSearch = deferred()
  let call = 0
  const queries = []
  const controller = viewer.createAttendanceRecordViewerController({
    access: { scope: 'all', canViewScopedRecords: true },
    workDate: '2026-07-16',
    service: {
      async listAttendanceRecords(query) {
        queries.push(query)
        call += 1
        if (call === 1) return {
          access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
          items: [session({ sessionId: 'old-item' })],
          nextCursor: { openedAt: '2026-07-16T00:00:00Z', sessionId: 'old-item' },
        }
        return nextSearch.promise
      },
    },
  })
  assert.equal((await controller.search()).status, 'accepted')
  const pending = controller.search({
    workDate: '2026-07-17', projectId: 'P002', employeeProfileId: null,
  })
  assert.deepEqual(controller.getState().items, [])
  assert.equal(controller.getState().nextCursor, null)
  assert.deepEqual(await controller.loadMore(), { status: 'busy' })
  assert.equal(queries.length, 2)
  nextSearch.resolve({
    access: { scope: 'assigned_projects' },
    filterOptions: { projects: [], employees: [] }, items: [], nextCursor: null,
  })
  assert.equal((await pending).status, 'accepted')
})

test('authorized viewer identity change synchronously hides old broader-scope results', async () => {
  const viewer = task9Module('viewer')
  const broad = viewer.createAttendanceRecordViewerController({
    access: { scope: 'all', canViewScopedRecords: true },
    workDate: '2026-07-16',
    service: { listAttendanceRecords: async () => ({
      access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
      items: [session({ sessionId: 'all-scope-item' })], nextCursor: null,
    }) },
  })
  await broad.search()
  const oldEnvelope = { owner: broad, state: broad.getState() }
  const narrowed = viewer.createAttendanceRecordViewerController({
    access: { scope: 'assigned_projects', canViewScopedRecords: true },
    workDate: '2026-07-17',
    service: { listAttendanceRecords: async () => ({
      access: { scope: 'assigned_projects' }, filterOptions: { projects: [], employees: [] },
      items: [], nextCursor: null,
    }) },
  })
  const visible = viewer.resolveAttendanceRecordViewState(narrowed, oldEnvelope)
  assert.deepEqual(visible.access, { scope: 'assigned_projects' })
  assert.deepEqual(visible.items, [])
  assert.equal(visible.filters.workDate, '2026-07-17')
})

test('page errors distinguish authoritative load failures from photo-operation failures', () => {
  const page = task9Module('page')
  assert.equal(page.attendancePageErrorMessage('ATTENDANCE_LOAD_FAILED'), '考勤读取失败，请重试。')
  assert.equal(page.attendancePageErrorMessage('ATTENDANCE_PHOTO_FAILED'), '照片处理失败，请按当前操作重试。')
  assert.notEqual(
    page.attendancePageErrorMessage('ATTENDANCE_LOAD_FAILED'),
    page.attendancePageErrorMessage('ATTENDANCE_PHOTO_FAILED'),
  )
})

test('record event timestamps explicitly render in Asia Tokyo', () => {
  assert.match(task9Sources.viewer, /timeZone:\s*['"]Asia\/Tokyo['"]/u)
})

test('page-level shared guard is unmounted only by a guard-owned lifecycle cleanup', () => {
  const controllerSetupIndex = task9Sources.page.indexOf('saveController.mount()')
  const controllerEffectStart = task9Sources.page.lastIndexOf(
    'useEffect(() => {',
    controllerSetupIndex,
  )
  const controllerEffectEnd = task9Sources.page.indexOf(
    '}, [clockController, photoController, previewController, saveController])',
    controllerSetupIndex,
  )
  const controllerCleanup = task9Sources.page.slice(
    controllerEffectStart,
    controllerEffectEnd,
  )
  assert.ok(controllerCleanup)
  assert.match(controllerCleanup, /saveController\.unmount\(\)/u)
  assert.doesNotMatch(controllerCleanup, /writeGuard\.unmount\(\)/u)
  assert.match(
    task9Sources.page,
    /useEffect\(\(\) => \{\s*writeGuard\.mount\(\)\s*return \(\) => writeGuard\.unmount\(\)\s*\}, \[writeGuard\]\)/u,
  )
})

test('clock controller replacement releases its held shared lock after a stale RPC settles', async () => {
  const page = task9Module('page')
  const rpc = deferred()
  const sharedGuard = page.createAttendancePageWriteGuard()
  const controller = page.createAttendanceClockController({
    service: { clockOut: () => rpc.promise },
    getToday: () => ({ activeSession: session() }),
    getSelectedProject: () => eligibleProject,
    refreshToday: async () => ({}),
    writeGuard: sharedGuard,
  })
  const pending = controller.clockOut({
    requestId: 'request-1',
    location: { latitude: 35, longitude: 139, accuracyMeters: 10 },
    abnormalReason: null,
  })
  controller.unmount()
  rpc.resolve({ session: session() })
  assert.deepEqual(await pending, { status: 'stale' })
  const nextToken = sharedGuard.begin()
  assert.notEqual(nextToken, null)
  sharedGuard.finish(nextToken)
})

test('finalize-only local state rejects a fresh select before any second reserve RPC', async () => {
  const finalizeError = Object.assign(new Error('uncertain'), { code: 'FINALIZE_UNCERTAIN' })
  const harness = createPhotoHarness({
    createAttemptId: (() => {
      let value = 0
      return () => `attempt-${++value}`
    })(),
    finalizePhoto: async () => { throw finalizeError },
  })
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).stage, 'finalize')
  const reserveCalls = harness.calls.filter(([name]) => name === 'reserve').length
  assert.deepEqual(await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  }), { status: 'invalid', errorCode: 'ATTENDANCE_PHOTO_STATE_LOCKED' })
  assert.equal(harness.calls.filter(([name]) => name === 'reserve').length, reserveCalls)
  assert.equal(harness.controller.getState('point-1:before').failedStage, 'finalize')
})

test('layered refresh forwarding notifies one auth-invalid event exactly once', async () => {
  const page = task9Module('page')
  const authError = Object.assign(new Error('private'), {
    code: 'AUTH_INVALID', authInvalid: true,
  })
  const authEvents = []
  let today = {
    activeSession: session({ workPoints: [point()] }),
  }
  let drafts = page.updateAttendanceDraft({}, {
    sessionId: 'session-1', point: point({ areaName: '编辑文字' }),
  })
  const snapshots = page.createTodayAttendanceSnapshotController({
    service: { getMyTodayAttendance: async () => { throw authError } },
    onAuthInvalid: (error) => authEvents.push(error.code),
  })
  const saves = page.createAttendanceWorkPointSaveController({
    service: { upsertWorkPoint: async () => point() },
    getToday: () => today,
    getDrafts: () => drafts,
    setDrafts: (next) => { drafts = next },
    refreshToday: () => snapshots.refreshToday(),
    onAuthInvalid: (error) => authEvents.push(error.code),
  })
  const result = await saves.savePoint(page.overlayAttendanceDrafts(today.activeSession, drafts)[0])
  assert.equal(result.status, 'refresh-failed')
  assert.deepEqual(authEvents, ['AUTH_INVALID'])
})

test('Task 9 controllers can remount after Strict Effects cleanup without reviving stale work', async () => {
  const page = task9Module('page')
  const viewer = task9Module('viewer')
  const firstToday = deferred()
  const secondToday = deferred()
  let todayCalls = 0
  const acceptedSnapshots = []
  const snapshots = page.createTodayAttendanceSnapshotController({
    service: {
      listAttendanceProjects: async () => [eligibleProject],
      getMyTodayAttendance: () => (++todayCalls === 1 ? firstToday.promise : secondToday.promise),
    },
    onSnapshot: (value) => acceptedSnapshots.push(value.today?.workDate),
  })
  const oldLoad = snapshots.loadInitial()
  snapshots.unmount()
  assert.equal(typeof snapshots.mount, 'function')
  snapshots.mount()
  const replayedLoad = snapshots.loadInitial()
  secondToday.resolve({ workDate: '2026-07-16', activeSession: null })
  assert.equal((await replayedLoad).status, 'accepted')
  firstToday.resolve({ workDate: '2026-07-15', activeSession: null })
  assert.deepEqual(await oldLoad, { status: 'stale' })
  assert.deepEqual(acceptedSnapshots, ['2026-07-16'])

  const sharedGuard = page.createAttendancePageWriteGuard()
  const oldToken = sharedGuard.begin()
  sharedGuard.unmount()
  assert.equal(sharedGuard.begin(), null)
  assert.equal(typeof sharedGuard.mount, 'function')
  sharedGuard.mount()
  const replayToken = sharedGuard.begin()
  assert.notEqual(replayToken, null)
  assert.notEqual(replayToken, oldToken)
  sharedGuard.finish(replayToken)

  const controllerFactories = [
    () => page.createAttendanceWorkPointSaveController(),
    () => page.createAttendanceClockController(),
    () => page.createAttendancePhotoPreviewController(),
    () => page.createAttendancePhotoOperationController(),
  ]
  for (const createController of controllerFactories) {
    const controller = createController()
    controller.unmount()
    assert.equal(typeof controller.mount, 'function')
    controller.mount()
  }

  const firstRecords = deferred()
  const secondRecords = deferred()
  let recordCalls = 0
  const recordController = viewer.createAttendanceRecordViewerController({
    access: { canViewScopedRecords: true, scope: 'all' },
    workDate: '2026-07-16',
    service: {
      listAttendanceRecords: () => (++recordCalls === 1
        ? firstRecords.promise
        : secondRecords.promise),
    },
  })
  const oldSearch = recordController.search()
  recordController.unmount()
  assert.equal(typeof recordController.mount, 'function')
  recordController.mount()
  const replayedSearch = recordController.search()
  secondRecords.resolve({
    access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
    items: [session({ sessionId: 'session-new' })], nextCursor: null,
  })
  assert.equal((await replayedSearch).status, 'accepted')
  firstRecords.resolve({
    access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
    items: [session({ sessionId: 'session-old' })], nextCursor: null,
  })
  assert.deepEqual(await oldSearch, { status: 'stale' })
  assert.equal(recordController.getState().items[0].sessionId, 'session-new')
})

test('page and viewer effects reactivate their memoized controllers before Strict Effects work', () => {
  for (const name of [
    'writeGuard',
    'snapshotController',
    'saveController',
    'photoController',
    'clockController',
    'previewController',
  ]) {
    assert.match(task9Sources.page, new RegExp(`${name}\\.mount\\(\\)`))
  }
  assert.match(task9Sources.viewer, /controller\.mount\(\)[\s\S]*?controller\.search\(\)/u)
})

test('save controller remount cannot revive a pre-cleanup completion', async () => {
  const page = task9Module('page')
  const oldRpc = deferred()
  const sharedGuard = page.createAttendancePageWriteGuard()
  let serviceCalls = 0
  let refreshCalls = 0
  let today = {
    activeSession: session({ workPoints: [point({ areaName: '服务器旧值' })] }),
  }
  let drafts = page.updateAttendanceDraft({}, {
    sessionId: 'session-1', point: point({ areaName: '旧编辑' }),
  })
  const controller = page.createAttendanceWorkPointSaveController({
    service: {
      upsertWorkPoint: () => (++serviceCalls === 1 ? oldRpc.promise : Promise.resolve(point())),
    },
    getToday: () => today,
    getDrafts: () => drafts,
    setDrafts: (next) => { drafts = next },
    refreshToday: async () => {
      refreshCalls += 1
      return { status: 'accepted', today }
    },
    writeGuard: sharedGuard,
  })
  const oldSave = controller.savePoint(page.overlayAttendanceDrafts(today.activeSession, drafts)[0])
  controller.unmount()
  sharedGuard.unmount()
  sharedGuard.mount()
  controller.mount()

  drafts = page.updateAttendanceDraft(drafts, {
    sessionId: 'session-1', point: point({ areaName: '新编辑' }),
  })
  today = {
    activeSession: session({
      workPoints: [point({
        areaName: '新编辑', workDescription: '下地施工', completionNote: '完成',
      })],
    }),
  }
  assert.equal((await controller.savePoint(
    page.overlayAttendanceDrafts(today.activeSession, drafts)[0],
  )).status, 'succeeded')
  assert.deepEqual(drafts, {})

  oldRpc.resolve(point({ areaName: '旧编辑' }))
  assert.deepEqual(await oldSave, { status: 'stale' })
  assert.equal(refreshCalls, 1)
})

test('photo reconciliation replaces a stale reservation and accepts correlated active server truth', async () => {
  const finalizeError = Object.assign(new Error('uncertain'), { code: 'FINALIZE_UNCERTAIN' })
  const replaced = createPhotoHarness({ finalizePhoto: async () => { throw finalizeError } })
  assert.equal((await replaced.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: replaced.file,
  })).stage, 'finalize')
  const reservationB = { ...replaced.reservation, photoId: 'photo-pending-b' }
  replaced.setToday({
    ...replaced.getToday(), pendingPhotoReservations: [reservationB],
  })
  replaced.controller.reconcile(replaced.getToday())
  const recoveredB = replaced.controller.getState('point-1:before')
  assert.equal(recoveredB.failedStage, 'recovered')
  assert.equal(recoveredB.reservation.photoId, 'photo-pending-b')
  assert.deepEqual(await replaced.controller.retryFinalize({
    workPointId: 'point-1', phase: 'before', photoId: replaced.reservation.photoId,
  }), { status: 'invalid' })

  const confirmed = createPhotoHarness({ finalizePhoto: async () => { throw finalizeError } })
  assert.equal((await confirmed.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: confirmed.file,
  })).stage, 'finalize')
  confirmed.setToday({
    ...confirmed.getToday(),
    activeSession: session({
      workPoints: [point({ photos: { before: confirmed.activePhoto, after: null } })],
    }),
    pendingPhotoReservations: [],
  })
  confirmed.controller.reconcile(confirmed.getToday())
  assert.deepEqual(confirmed.controller.getState('point-1:before'), uploadState())
})

test('authoritative photo replacement invalidates an in-flight phase before another side effect', async () => {
  let harness
  harness = createPhotoHarness({
    uploadReservedPhoto: async () => {
      harness.setToday({
        ...harness.getToday(),
        activeSession: session({
          workPoints: [point({ photos: { before: harness.activePhoto, after: null } })],
        }),
        pendingPhotoReservations: [],
      })
      harness.controller.reconcile(harness.getToday())
      return { uploaded: true }
    },
  })
  assert.deepEqual(await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  }), { status: 'stale' })
  assert.equal(harness.calls.some(([name]) => name === 'finalize'), false)
  assert.deepEqual(harness.controller.getState('point-1:before'), uploadState())
})

test('a stale load-more lock cannot block or unlock pagination for a newer search generation', async () => {
  const viewer = task9Module('viewer')
  const oldMore = deferred()
  const newMore = deferred()
  const responses = [
    Promise.resolve({
      access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
      items: [session({ sessionId: 'initial' })],
      nextCursor: { openedAt: '2026-07-16T00:00:00Z', sessionId: 'initial' },
    }),
    oldMore.promise,
    Promise.resolve({
      access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
      items: [session({ sessionId: 'new-search' })],
      nextCursor: { openedAt: '2026-07-15T00:00:00Z', sessionId: 'new-search' },
    }),
    newMore.promise,
  ]
  let calls = 0
  const controller = viewer.createAttendanceRecordViewerController({
    access: { canViewScopedRecords: true, scope: 'all' },
    workDate: '2026-07-16',
    service: { listAttendanceRecords: () => responses[calls++] },
  })
  await controller.search()
  const stalePage = controller.loadMore()
  await controller.search({ workDate: '2026-07-15' })
  const currentPage = controller.loadMore()
  assert.equal(calls, 4)
  assert.deepEqual(await controller.loadMore(), { status: 'busy' })

  oldMore.resolve({
    access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
    items: [session({ sessionId: 'stale-page' })], nextCursor: null,
  })
  assert.deepEqual(await stalePage, { status: 'stale' })
  assert.deepEqual(await controller.loadMore(), { status: 'busy' })

  newMore.resolve({
    access: { scope: 'all' }, filterOptions: { projects: [], employees: [] },
    items: [session({ sessionId: 'new-page' })], nextCursor: null,
  })
  assert.equal((await currentPage).status, 'accepted')
  assert.deepEqual(
    controller.getState().items.map((item) => item.sessionId),
    ['new-search', 'new-page'],
  )
})

test('the same auth-invalid error object is forwarded for each later current service failure', async () => {
  const page = task9Module('page')
  const reusedError = Object.assign(new Error('expired'), {
    code: 'AUTH_INVALID', authInvalid: true,
  })
  const events = []
  const snapshots = page.createTodayAttendanceSnapshotController({
    service: { getMyTodayAttendance: async () => { throw reusedError } },
    onAuthInvalid: () => events.push('first-controller'),
  })
  await assert.rejects(() => snapshots.refreshToday(), reusedError)
  await assert.rejects(() => snapshots.refreshToday(), reusedError)

  const laterPageInstance = page.createTodayAttendanceSnapshotController({
    service: { getMyTodayAttendance: async () => { throw reusedError } },
    onAuthInvalid: () => events.push('later-controller'),
  })
  await assert.rejects(() => laterPageInstance.refreshToday(), reusedError)
  assert.deepEqual(events, [
    'first-controller', 'first-controller', 'later-controller',
  ])
})

test('a successful normalized point save clears the matching raw-text draft version', async () => {
  const page = task9Module('page')
  let today = {
    activeSession: session({ workPoints: [point()] }),
  }
  let drafts = page.updateAttendanceDraft({}, {
    sessionId: 'session-1',
    point: point({
      areaName: '  区域  ',
      workDescription: '  工作  ',
      completionNote: '  说明  ',
    }),
  })
  let savedInput
  const controller = page.createAttendanceWorkPointSaveController({
    service: {
      upsertWorkPoint: async (input) => {
        savedInput = input
        return point(input)
      },
    },
    getToday: () => today,
    getDrafts: () => drafts,
    setDrafts: (next) => { drafts = next },
    refreshToday: async () => {
      today = {
        activeSession: session({
          workPoints: [point({
            areaName: '区域', workDescription: '工作', completionNote: '说明',
          })],
        }),
      }
      return { status: 'accepted', today }
    },
  })
  assert.deepEqual(await controller.savePoint(
    page.overlayAttendanceDrafts(today.activeSession, drafts)[0],
  ), { status: 'succeeded' })
  assert.deepEqual(savedInput, {
    sessionId: 'session-1', ordinal: 1,
    areaName: '区域', workDescription: '工作', completionNote: '说明',
  })
  assert.deepEqual(drafts, {})
})

test('confirmed photo refresh failure has an authoritative-only retry and visible recovery control', async () => {
  const page = task9Module('page')
  const refreshError = Object.assign(new Error('refresh down'), { code: 'REFRESH_FAILED' })
  const harness = createPhotoHarness({ refreshToday: async () => { throw refreshError } })
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).status, 'refresh-failed')
  const mutationCallsBeforeRetry = harness.calls.filter(
    ([name]) => ['reserve', 'upload', 'finalize', 'abandon'].includes(name),
  ).length
  const authoritativeToday = {
    ...harness.getToday(),
    activeSession: session({
      workPoints: [point({ photos: { before: harness.activePhoto, after: null } })],
    }),
    pendingPhotoReservations: [],
  }
  let initialCalls = 0
  let refreshCalls = 0
  const errorCodes = []
  const retried = await page.retryAttendanceAuthoritativeSnapshot({
    snapshotController: {
      loadInitial: async () => { initialCalls += 1; throw new Error('wrong path') },
      refreshToday: async () => {
        refreshCalls += 1
        return { status: 'accepted', today: authoritativeToday }
      },
    },
    snapshot: { selectedProjectId: 'P001', today: harness.getToday() },
    onErrorCode: (value) => errorCodes.push(value),
  })
  harness.controller.reconcile(retried.today)
  assert.equal(initialCalls, 0)
  assert.equal(refreshCalls, 1)
  assert.deepEqual(errorCodes, [null])
  assert.deepEqual(harness.controller.getState('point-1:before'), uploadState())
  assert.equal(harness.calls.filter(
    ([name]) => ['reserve', 'upload', 'finalize', 'abandon'].includes(name),
  ).length, mutationCallsBeforeRetry)

  const markup = render(page.TodayAttendanceView, {
    snapshot: { projects: [], selectedProjectId: '', today: harness.getToday() },
    errorCode: 'REFRESH_FAILED',
    handlers: { retryRefresh() {} },
  })
  assert.match(markup, /重新读取服务器记录/u)
  assert.match(markup, /attendance-retry-refresh/u)
  assert.match(task9Sources.page, /setErrorCode\(null\)[\s\S]*?runPhotoOperation/u)
})

test('authoritative retry reloads both initial resources when no today snapshot exists', async () => {
  const page = task9Module('page')
  const calls = []
  const result = await page.retryAttendanceAuthoritativeSnapshot({
    snapshotController: {
      loadInitial: async (input) => {
        calls.push(['initial', input])
        return { status: 'accepted', today: { workDate: '2026-07-16' } }
      },
      refreshToday: async () => { calls.push(['refresh']); return { status: 'accepted' } },
    },
    snapshot: { selectedProjectId: 'P001', today: null },
    onErrorCode() {},
  })
  assert.equal(result.status, 'accepted')
  assert.deepEqual(calls, [['initial', { selectedProjectId: 'P001' }]])
})

test('attendance tabs expose roving focus and deterministic arrow-key navigation', () => {
  const page = task9Module('page')
  assert.equal(page.resolveAttendanceTabKey('mine', 'ArrowRight', true), 'records')
  assert.equal(page.resolveAttendanceTabKey('records', 'ArrowRight', true), 'mine')
  assert.equal(page.resolveAttendanceTabKey('mine', 'ArrowLeft', true), 'records')
  assert.equal(page.resolveAttendanceTabKey('records', 'Home', true), 'mine')
  assert.equal(page.resolveAttendanceTabKey('mine', 'End', true), 'records')
  assert.equal(page.resolveAttendanceTabKey('mine', 'ArrowRight', false), null)
  assert.equal(page.resolveAttendanceTabKey('mine', 'Enter', true), null)

  const markup = render(page.TodayAttendanceView, {
    snapshot: {
      projects: [], selectedProjectId: '',
      today: {
        workDate: '2026-07-16', activeSession: null, completedSessions: [],
        viewerAccess: { scope: 'all', canViewScopedRecords: true },
      },
    },
    tab: 'mine',
    handlers: {},
  })
  assert.match(markup, /id="attendance-tab-mine"[^>]*tabindex="0"/u)
  assert.match(markup, /id="attendance-tab-records"[^>]*tabindex="-1"/u)
  assert.match(task9Sources.page, /onKeyDown=\{handleTabKeyDown\}/u)
})

test('photo modal traps focus and every page-driven close restores a safe focus target', () => {
  assert.match(task9Sources.page, /event\.key === 'Tab'[\s\S]*?event\.preventDefault\(\)/u)
  assert.match(task9Sources.page, /sibling\.inert = true/u)
  assert.match(task9Sources.page, /sibling\.inert = previous\.inert/u)
  assert.match(task9Sources.page, /returnFocus\?\.isConnected/u)
  assert.match(
    task9Sources.page,
    /previewController\.close\(\)[\s\S]*?attendance-tab-\$\{activeTab\}/u,
  )
  const pageDrivenCloseCalls = task9Sources.page.match(/handleClosePreview\(/gu) || []
  assert.ok(pageDrivenCloseCalls.length >= 2)
})

test('photo reconciliation preserves a correlated replacement pending beside the old active photo', async () => {
  let harness
  const oldActivePhoto = {
    ...activeBeforePhoto,
    photoId: 'old-active-photo',
  }
  harness = createPhotoHarness({
    uploadReservedPhoto: async () => {
      harness.setToday({
        ...harness.getToday(),
        activeSession: session({
          workPoints: [point({ photos: { before: oldActivePhoto, after: null } })],
        }),
        pendingPhotoReservations: [harness.reservation],
      })
      harness.controller.reconcile(harness.getToday())
      return { uploaded: true }
    },
  })
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).status, 'succeeded')
  assert.equal(harness.calls.some(([name]) => name === 'finalize'), true)
})

test('photo reconciliation keeps local active until the accepted DTO represents that exact photo', async () => {
  const harness = createPhotoHarness()
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).status, 'succeeded')
  const oldActivePhoto = { ...harness.activePhoto, photoId: 'old-active-photo' }
  harness.setToday({
    ...harness.getToday(),
    activeSession: session({
      workPoints: [point({ photos: { before: oldActivePhoto, after: null } })],
    }),
    pendingPhotoReservations: [],
  })
  harness.controller.reconcile(harness.getToday())
  assert.equal(
    harness.controller.getState('point-1:before').activePhoto.photoId,
    harness.activePhoto.photoId,
  )

  harness.setToday({
    ...harness.getToday(),
    activeSession: session({
      workPoints: [point({ photos: { before: harness.activePhoto, after: null } })],
    }),
  })
  harness.controller.reconcile(harness.getToday())
  assert.deepEqual(harness.controller.getState('point-1:before'), uploadState())
})

test('authoritative pending reservation replaces a local reserve failure at the same slot', async () => {
  const reserveError = Object.assign(new Error('response lost'), { code: 'RESERVE_FAILED' })
  const harness = createPhotoHarness({ reservePhoto: async () => { throw reserveError } })
  assert.equal((await harness.controller.selectPhoto({
    workPointId: 'point-1', phase: 'before', file: harness.file,
  })).stage, 'reserve')
  const serverPending = { ...harness.reservation, photoId: 'server-pending' }
  harness.setToday({
    ...harness.getToday(), pendingPhotoReservations: [serverPending],
  })
  harness.controller.reconcile(harness.getToday())
  const recovered = harness.controller.getState('point-1:before')
  assert.equal(recovered.failedStage, 'recovered')
  assert.equal(recovered.reservation.photoId, 'server-pending')
})

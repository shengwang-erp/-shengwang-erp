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

const sourceEntries = await Promise.all(Object.entries(COMPONENT_FILES).map(async ([key, name]) => [
  key,
  await readFile(new URL(`./${name}`, import.meta.url), 'utf8').catch(() => ''),
]))
const sources = Object.fromEntries(sourceEntries)

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

function componentModule(name) {
  assert.ifError(loaded.error)
  assert.ok(loaded.modules[name])
  return loaded.modules[name]
}

function render(Component, props) {
  return renderToStaticMarkup(createElement(Component, props))
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

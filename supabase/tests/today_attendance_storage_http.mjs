import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const DISPOSABLE_CONFIRMATION = 'shengwang-attendance-task7'
const DISPOSABLE_API_HOST = '127.0.0.1'
const DISPOSABLE_API_PORT = '58321'
const DISPOSABLE_DB_HOST = '127.0.0.1'
const DISPOSABLE_DB_PORT = '58322'
const DISPOSABLE_DB_CONTAINER = 'supabase_db_shengwang-attendance-task7'

function fail(message) {
  throw new Error(message)
}

function requireExactEnvironment(environment, name, expected) {
  const value = environment[name]
  if (value !== expected) fail(`${name} does not identify the disposable Task 7 stack`)
  return value
}

function requireSecretEnvironment(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    fail(`missing or non-canonical environment variable: ${name}`)
  }
  return value
}

function validateDisposableConfiguration(environment) {
  requireExactEnvironment(
    environment,
    'ATTENDANCE_DISPOSABLE_CONFIRM',
    DISPOSABLE_CONFIRMATION,
  )

  const rawUrl = requireSecretEnvironment(environment, 'SUPABASE_URL')
  let apiUrl
  try {
    apiUrl = new URL(rawUrl)
  } catch {
    fail('SUPABASE_URL must be the disposable loopback API URL')
  }
  if (
    apiUrl.protocol !== 'http:' || apiUrl.hostname !== DISPOSABLE_API_HOST ||
    apiUrl.port !== DISPOSABLE_API_PORT ||
    apiUrl.username || apiUrl.password || apiUrl.pathname !== '/' ||
    apiUrl.search || apiUrl.hash
  ) {
    fail('SUPABASE_URL must be the exact credential-free disposable loopback API URL')
  }

  requireExactEnvironment(
    environment,
    'ATTENDANCE_DB_HOST',
    DISPOSABLE_DB_HOST,
  )
  requireExactEnvironment(
    environment,
    'ATTENDANCE_DB_PORT',
    DISPOSABLE_DB_PORT,
  )
  requireExactEnvironment(
    environment,
    'ATTENDANCE_DB_CONTAINER',
    DISPOSABLE_DB_CONTAINER,
  )

  return Object.freeze({
    apiUrl: apiUrl.origin,
    anonKey: requireSecretEnvironment(environment, 'SUPABASE_ANON_KEY'),
    serviceRoleKey: requireSecretEnvironment(
      environment,
      'SUPABASE_SERVICE_ROLE_KEY',
    ),
    cleanupSecret: requireSecretEnvironment(
      environment,
      'ATTENDANCE_CLEANUP_SECRET',
    ),
    databaseContainer: DISPOSABLE_DB_CONTAINER,
  })
}

// The safety gate intentionally runs before importing application modules, creating
// any Supabase client, calling fetch, authenticating, or spawning Docker/psql.
const configuration = validateDisposableConfiguration(process.env)

const [
  { createClient },
  { validateAttendancePhotoFile },
  { createAttendancePhotoStorage },
  { createAttendanceService },
] = await Promise.all([
  import('@supabase/supabase-js'),
  import('../../src/features/attendance/attendancePhotoDomain.js'),
  import('../../src/services/attendancePhotoStorage.js'),
  import('../../src/services/attendanceService.js'),
])

function must(condition, message) {
  if (!condition) fail(message)
}

function requireNoProviderError(result, message) {
  must(result && !result.error, message)
  return result.data
}

function deleteWasDenied(result, objectPath) {
  if (result?.error) return true
  if (!Array.isArray(result?.data)) return false
  return !result.data.some((entry) =>
    entry === objectPath || entry?.name === objectPath || entry?.path === objectPath
  )
}

function statelessClient(key) {
  return createClient(configuration.apiUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function pngFile(name, bytes) {
  const blob = new Blob([bytes], { type: 'image/png' })
  Object.defineProperties(blob, {
    name: { value: name },
    lastModified: { value: Date.now() },
  })
  return blob
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function spawnPsql(sql) {
  const child = spawn('docker', [
    'exec', '-i', configuration.databaseContainer,
    'psql', '-X', '-U', 'postgres', '-d', 'postgres',
  ], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const done = new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('failed to start disposable psql')))
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout,
      stderr,
    }))
  })
  child.stdin.end(sql)
  return {
    child,
    done,
    stdout: () => stdout,
  }
}

async function psqlScalar(query) {
  const child = spawn('docker', [
    'exec', configuration.databaseContainer,
    'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
    '-c', query,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  const result = await new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('failed to start disposable observer psql')))
    child.once('close', (code) => resolve({ code, stdout }))
  })
  must(result.code === 0, 'disposable observer query failed')
  return result.stdout.trim()
}

async function waitUntil(check, message, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  fail(message)
}

function psqlClockInSql({
  applicationName,
  authUserId,
  projectId,
  requestId,
  holdSeconds = 0,
  marker = null,
}) {
  return `\\set ON_ERROR_STOP on
\\set VERBOSITY verbose
set application_name = ${sqlLiteral(applicationName)};
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', ${sqlLiteral(authUserId)}, true);
select public.clock_in_project_secure(
  ${sqlLiteral(projectId)},
  ${sqlLiteral(requestId)}::uuid,
  35.681236::double precision,
  139.767125::double precision,
  1::numeric,
  statement_timestamp(),
  null::text
);
${marker ? `select ${sqlLiteral(marker)} as task7_barrier;` : ''}
${holdSeconds > 0 ? `select pg_sleep(${holdSeconds});` : ''}
commit;
`
}

async function seedRealCleanupCandidate({
  admin,
  employeeProfileId,
  sessionId,
  bytes,
}) {
  const workPointId = randomUUID()
  const photoId = randomUUID()
  const bucketId = 'erp-attendance-photos'
  const objectPath = [
    employeeProfileId,
    sessionId,
    workPointId,
    photoId,
    'before',
  ].join('/')
  must(
    objectPath.split('/').length === 5 &&
      objectPath.split('/')[0] === employeeProfileId &&
      objectPath.split('/')[3] === photoId,
    'real cleanup candidate path was not canonical',
  )

  const pointSeed = await admin.from('project_attendance_work_points').insert({
    work_point_id: workPointId,
    session_id: sessionId,
    ordinal: 2,
    area_name: 'Cleanup Edge 验证点位',
    work_description: '验证真实 Storage 对象清理',
    completion_note: '',
  })
  requireNoProviderError(pointSeed, 'failed to seed cleanup work point')

  const objectSeed = await admin.storage.from(bucketId).upload(
    objectPath,
    new Blob([bytes], { type: 'image/png' }),
    { contentType: 'image/png', cacheControl: '0', upsert: false },
  )
  const objectSeedData = requireNoProviderError(
    objectSeed,
    'failed to seed real cleanup Storage object',
  )
  must(objectSeedData?.path === objectPath, 'cleanup Storage seed path mismatched')

  const staleUpdatedAt = new Date(Date.now() - 48 * 60 * 60 * 1_000).toISOString()
  const metadataSeed = await admin.from('project_attendance_photos').insert({
    photo_id: photoId,
    work_point_id: workPointId,
    phase: 'before',
    bucket_id: bucketId,
    object_path: objectPath,
    original_file_name: 'cleanup-stale.png',
    content_type: 'image/png',
    size_bytes: bytes.length,
    upload_status: 'cleanup_pending',
    updated_at: staleUpdatedAt,
  })
  requireNoProviderError(metadataSeed, 'failed to seed stale cleanup metadata')

  const metadataCheck = await admin
    .from('project_attendance_photos')
    .select('photo_id,object_path,upload_status,updated_at')
    .eq('photo_id', photoId)
    .single()
  const metadata = requireNoProviderError(
    metadataCheck,
    'failed to verify stale cleanup metadata',
  )
  must(
    metadata.photo_id === photoId && metadata.object_path === objectPath &&
      metadata.upload_status === 'cleanup_pending' &&
      Date.parse(metadata.updated_at) < Date.now() - 24 * 60 * 60 * 1_000,
    'real cleanup metadata was not canonical and stale',
  )

  const objectCheck = await admin.storage.from(bucketId).download(objectPath)
  const downloaded = requireNoProviderError(
    objectCheck,
    'failed to verify real cleanup Storage object',
  )
  must(
    Buffer.compare(Buffer.from(await downloaded.arrayBuffer()), bytes) === 0,
    'cleanup Storage seed bytes mismatched',
  )

  return Object.freeze({ bucketId, objectPath, photoId })
}

async function verifyCleanupEdgeGateway({ admin, candidate }) {
  const endpoint = `${configuration.apiUrl}/functions/v1/attendance-photo-cleanup`
  const commonHeaders = { apikey: configuration.anonKey }

  const invalidGateway = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      Authorization: `Bearer ${configuration.cleanupSecret}`,
      'x-attendance-cleanup-secret': configuration.cleanupSecret,
    },
  })
  must(invalidGateway.status === 401, 'cleanup gateway accepted a non-JWT scheduler secret')

  const wrongIndependentSecret = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      Authorization: `Bearer ${configuration.anonKey}`,
      'x-attendance-cleanup-secret': 'task7-definitely-wrong-secret',
    },
  })
  must(
    wrongIndependentSecret.status === 401,
    'cleanup handler accepted the wrong independent secret',
  )
  must(
    wrongIndependentSecret.headers.get('cache-control') === 'no-store',
    'cleanup handler authentication response is cacheable',
  )
  const wrongText = await wrongIndependentSecret.text()
  must(
    !wrongText.includes(configuration.cleanupSecret) &&
      !wrongText.includes(configuration.anonKey),
    'cleanup handler authentication response leaked a secret',
  )

  const accepted = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...commonHeaders,
      Authorization: `Bearer ${configuration.anonKey}`,
      'x-attendance-cleanup-secret': configuration.cleanupSecret,
    },
  })
  must(accepted.status === 200, 'cleanup Edge invocation failed')
  must(
    accepted.headers.get('cache-control') === 'no-store',
    'cleanup Edge success response is cacheable',
  )
  const acceptedText = await accepted.text()
  must(
    !acceptedText.includes(configuration.cleanupSecret) &&
      !acceptedText.includes(configuration.anonKey) &&
      !acceptedText.includes('objectPath'),
    'cleanup Edge success response leaked private details',
  )
  let payload
  try {
    payload = JSON.parse(acceptedText)
  } catch {
    fail('cleanup Edge success response was not JSON')
  }
  must(
    payload?.claimed === 1 && payload.deleted === 1 && payload.failed === 0 &&
      Object.keys(payload).sort().join('|') === 'claimed|deleted|failed',
    'cleanup Edge did not remove exactly one stale real object and metadata row',
  )

  const metadataAfter = await admin
    .from('project_attendance_photos')
    .select('photo_id', { count: 'exact', head: true })
    .eq('photo_id', candidate.photoId)
  requireNoProviderError(metadataAfter, 'failed to verify completed cleanup metadata')
  must(metadataAfter.count === 0, 'cleanup Edge retained completed metadata')
  const objectAfter = await admin.storage
    .from(candidate.bucketId)
    .download(candidate.objectPath)
  must(Boolean(objectAfter.error), 'cleanup Edge retained the real Storage object')

  return Object.freeze({
    gatewayJwtEnforced: true,
    independentSecretEnforced: true,
    invoked: true,
    realObjectAndMetadataDeleted: true,
  })
}

async function verifyTrueClockInSerialization({
  admin,
  authUserId,
  employeeProfileId,
  projectId,
}) {
  const requestA = randomUUID()
  const requestB = randomUUID()
  const runSuffix = randomUUID().slice(0, 8)
  const appA = `task7_attendance_a_${runSuffix}`
  const appB = `task7_attendance_b_${runSuffix}`
  const marker = `TASK7_A_BARRIER_${runSuffix}`

  const connectionA = spawnPsql(psqlClockInSql({
    applicationName: appA,
    authUserId,
    projectId,
    requestId: requestA,
    holdSeconds: 12,
    marker,
  }))
  let aSettled = false
  connectionA.done.then(
    () => { aSettled = true },
    () => { aSettled = true },
  )

  await waitUntil(
    () => connectionA.stdout().includes(marker),
    'connection A did not reach its post-clock-in barrier',
  )
  await waitUntil(
    async () => (await psqlScalar(
      `select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') ` +
      `from pg_stat_activity where application_name = ${sqlLiteral(appA)}`,
    )) === 'Timeout:PgSleep',
    'connection A was not observably holding its transaction open',
  )
  must(!aSettled, 'connection A committed before the concurrency barrier was observed')

  const bStartedAt = Date.now()
  const connectionB = spawnPsql(psqlClockInSql({
    applicationName: appB,
    authUserId,
    projectId,
    requestId: requestB,
  }))
  let bSettled = false
  let bCompletedAt = null
  const connectionBDone = connectionB.done.then(
    (result) => {
      bSettled = true
      bCompletedAt = Date.now()
      return result
    },
    (error) => {
      bSettled = true
      bCompletedAt = Date.now()
      throw error
    },
  )
  await waitUntil(
    async () => (await psqlScalar(
      `select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') ` +
      `from pg_stat_activity where application_name = ${sqlLiteral(appB)}`,
    )) === 'Lock:advisory',
    'connection B did not wait on the actor advisory lock',
  )
  must(!aSettled, 'connection A committed before connection B was observed waiting')
  must(!bSettled, 'connection B was not pending before connection A committed')

  const resultA = await connectionA.done
  const resultB = await connectionBDone
  const bWaitMs = bCompletedAt - bStartedAt
  must(resultA.code === 0, 'connection A clock-in transaction failed')
  must(resultB.code !== 0, 'connection B unexpectedly created a second open session')
  must(bWaitMs >= 7_000, 'connection B did not exhibit a real serialization wait')
  must(
    /ERROR:\s+55000:/u.test(resultB.stderr) &&
      /HINT:\s+ATTENDANCE_OPEN_SESSION_EXISTS/u.test(resultB.stderr),
    'connection B did not fail with the required SQLSTATE and hint',
  )

  const openSessions = await admin
    .from('project_attendance_sessions')
    .select('session_id', { count: 'exact', head: true })
    .eq('employee_profile_id', employeeProfileId)
    .eq('status', 'open')
  requireNoProviderError(openSessions, 'failed to count serialized open sessions')
  must(openSessions.count === 1, 'serialization left other than exactly one open session')

  const events = await admin
    .from('project_attendance_events')
    .select('request_id')
    .in('request_id', [requestA, requestB])
  const eventRows = requireNoProviderError(events, 'failed to verify serialized event rows')
  must(
    eventRows.filter((row) => row.request_id === requestA).length === 1 &&
      eventRows.filter((row) => row.request_id === requestB).length === 0,
    'serialization did not preserve exactly request A and reject request B',
  )

  return Object.freeze({
    observedWait: true,
    sqlstateAndHint: true,
    singleOpenSession: true,
    eventRowsExact: true,
  })
}

const admin = statelessClient(configuration.serviceRoleKey)
const ownerClient = statelessClient(configuration.anonKey)
const otherClient = statelessClient(configuration.anonKey)
const runId = randomUUID()
const ownerAuthPassword = `Task7!Owner!${randomUUID()}Aa9`
const otherAuthPassword = `Task7!Other!${randomUUID()}Aa9`
const ownerEmail = `task7-owner-${runId}@attendance.invalid`
const otherEmail = `task7-other-${runId}@attendance.invalid`

const ownerCreated = await admin.auth.admin.createUser({
  email: ownerEmail,
  password: ownerAuthPassword,
  email_confirm: true,
})
const otherCreated = await admin.auth.admin.createUser({
  email: otherEmail,
  password: otherAuthPassword,
  email_confirm: true,
})
const ownerAuthUser = requireNoProviderError(ownerCreated, 'failed to seed owner Auth user').user
const otherAuthUser = requireNoProviderError(otherCreated, 'failed to seed unrelated Auth user').user
must(ownerAuthUser?.id && otherAuthUser?.id, 'fresh Auth seed did not return user identifiers')

const ownerProfileId = randomUUID()
const otherProfileId = randomUUID()
const numericSeed = `${Date.now()}${String(process.pid).padStart(6, '0')}`
const ownerEmployeeNumber = `SW-${numericSeed}1`
const otherEmployeeNumber = `SW-${numericSeed}2`
const profileSeed = await admin.from('employee_profiles').insert([
  {
    id: ownerProfileId,
    employee_number: ownerEmployeeNumber,
    auth_user_id: ownerAuthUser.id,
    name: 'Task 7 Storage Owner',
    department: '工程部',
    position: '小工',
    employment_status: '在职',
    account_status: 'active',
    must_change_password: false,
    is_hidden_system_account: false,
  },
  {
    id: otherProfileId,
    employee_number: otherEmployeeNumber,
    auth_user_id: otherAuthUser.id,
    name: 'Task 7 Unrelated Employee',
    department: '工程部',
    position: '小工',
    employment_status: '在职',
    account_status: 'active',
    must_change_password: false,
    is_hidden_system_account: false,
  },
])
requireNoProviderError(profileSeed, 'failed to seed disposable employee profiles')

const projectId = `ATT-HTTP-${runId}`
const projectPayload = {
  projectId,
  projectName: 'Task 7 HTTP Storage Site',
  status: '进行中',
  address: '東京都 千代田区 1-1',
  latitude: 35.681236,
  longitude: 139.767125,
  attendanceRadiusMeters: 300,
  locationConfirmedAt: new Date().toISOString(),
  locationAddressSnapshot: '東京都 千代田区 1-1',
  designAssigneeEmployeeId: '',
  designAssigneeEmployeeNumber: '',
  designAssigneeName: '',
  siteAssigneeEmployeeId: ownerProfileId,
  siteAssigneeEmployeeNumber: ownerEmployeeNumber,
  siteAssigneeName: 'Task 7 Storage Owner',
  startDate: '',
  endDate: '',
  remark: '',
}
const projectSeed = await admin.from('projects').insert({
  record_key: projectId,
  payload: projectPayload,
  status: 'active',
})
requireNoProviderError(projectSeed, 'failed to seed disposable attendance project')

const projectBindingRead = await admin
  .from('projects')
  .select('record_key,status,payload')
  .eq('record_key', projectId)
  .single()
const projectBinding = requireNoProviderError(
  projectBindingRead,
  'failed to verify disposable attendance project binding',
)
must(
  projectBinding.record_key === projectId && projectBinding.status === 'active' &&
    projectBinding.payload?.siteAssigneeEmployeeId === ownerProfileId &&
    projectBinding.payload?.siteAssigneeEmployeeId !== otherProfileId &&
    projectBinding.payload?.status === '进行中',
  'fresh active project binding was not exact',
)

const bindingRead = await admin
  .from('employee_profiles')
  .select('id,employee_number,auth_user_id,position,account_status,must_change_password')
  .in('id', [ownerProfileId, otherProfileId])
const bindings = requireNoProviderError(bindingRead, 'failed to verify Auth/profile bindings')
must(bindings.length === 2, 'fresh profile binding count was not exact')
const ownerBinding = bindings.find((row) => row.id === ownerProfileId)
const otherBinding = bindings.find((row) => row.id === otherProfileId)
must(
  ownerBinding?.auth_user_id === ownerAuthUser.id &&
    ownerBinding.employee_number === ownerEmployeeNumber &&
    ownerBinding.position === '小工' && ownerBinding.account_status === 'active' &&
    ownerBinding.must_change_password === false,
  'owner Auth/profile binding was not exact',
)
must(
  otherBinding?.auth_user_id === otherAuthUser.id &&
    otherBinding.employee_number === otherEmployeeNumber &&
    otherBinding.position === '小工' && otherBinding.account_status === 'active' &&
    otherBinding.must_change_password === false &&
    projectBinding.payload.siteAssigneeEmployeeId !== otherProfileId,
  'unrelated Auth/profile/project binding was not exact',
)

const ownerLogin = await ownerClient.auth.signInWithPassword({
  email: ownerEmail,
  password: ownerAuthPassword,
})
const otherLogin = await otherClient.auth.signInWithPassword({
  email: otherEmail,
  password: otherAuthPassword,
})
const ownerSession = requireNoProviderError(ownerLogin, 'owner disposable login failed')
const otherSession = requireNoProviderError(otherLogin, 'unrelated disposable login failed')
must(
  ownerSession.user?.id === ownerAuthUser.id &&
    otherSession.user?.id === otherAuthUser.id,
  'fresh login users did not match seeded Auth/profile bindings',
)

const service = createAttendanceService(ownerClient, { configured: true })
const ownerStorage = createAttendancePhotoStorage(ownerClient, { configured: true })
const otherStorage = createAttendancePhotoStorage(otherClient, { configured: true })
const projects = await service.listAttendanceProjects()
const project = projects.find((candidate) => candidate.projectId === projectId)
must(project && projects.filter((candidate) => candidate.projectId === projectId).length === 1,
  'fresh eligible project was not visible exactly once')

const location = {
  latitude: project.latitude,
  longitude: project.longitude,
  accuracyMeters: 1,
  deviceRecordedAt: new Date().toISOString(),
}
const existing = await service.getMyTodayAttendance()
must(existing.activeSession === null, 'fresh owner began with an open attendance session')
const clockIn = await service.clockIn({
  projectId,
  requestId: randomUUID(),
  location,
  abnormalReason: null,
})
const point = await service.upsertWorkPoint({
  sessionId: clockIn.session.sessionId,
  ordinal: 1,
  areaName: 'Storage HTTP 验证点位',
  workDescription: '验证私有照片上传与读取门禁',
  completionNote: '',
})

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=',
  'base64',
)

const oversizeReservation = await service.reservePhoto({
  workPointId: point.workPointId,
  phase: 'before',
  originalFileName: 'oversize.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 20 * 1024 * 1024,
  checksumSha256: null,
  capturedAt: null,
})
const oversizeAttempt = await ownerClient.storage
  .from(oversizeReservation.bucketId)
  .upload(
    oversizeReservation.objectPath,
    new Blob([new Uint8Array(20 * 1024 * 1024 + 1)], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', cacheControl: '0', upsert: false },
  )
must(Boolean(oversizeAttempt.error), 'Storage gateway accepted more than 20 MiB')
await service.abandonPhoto({ photoId: oversizeReservation.photoId })

const mimeReservation = await service.reservePhoto({
  workPointId: point.workPointId,
  phase: 'before',
  originalFileName: 'mime.jpg',
  contentType: 'image/jpeg',
  sizeBytes: pngBytes.length,
  checksumSha256: null,
  capturedAt: null,
})
const mimeAttempt = await ownerClient.storage
  .from(mimeReservation.bucketId)
  .upload(
    mimeReservation.objectPath,
    new Blob([pngBytes], { type: 'application/pdf' }),
    { contentType: 'application/pdf', cacheControl: '0', upsert: false },
  )
must(Boolean(mimeAttempt.error), 'Storage gateway accepted a disallowed MIME type')
await service.abandonPhoto({ photoId: mimeReservation.photoId })

const unreservedPath = [
  ownerProfileId,
  randomUUID(),
  randomUUID(),
  randomUUID(),
  'before',
].join('/')
must(
  unreservedPath.split('/').length === 5 &&
    unreservedPath.split('/')[0] === ownerProfileId &&
    unreservedPath.split('/')[0] !== ownerAuthUser.id,
  'unreserved test path was not bound to the real employee profile identifier',
)
const unreservedAttempt = await ownerClient.storage
  .from('erp-attendance-photos')
  .upload(unreservedPath, pngFile('unreserved.png', pngBytes), {
    contentType: 'image/png',
    cacheControl: '0',
    upsert: false,
  })
must(Boolean(unreservedAttempt.error), 'Storage gateway accepted an unreserved canonical path')

async function uploadPhase(phase) {
  const file = pngFile(`${phase}.png`, pngBytes)
  const metadata = validateAttendancePhotoFile(file)
  const reservation = await service.reservePhoto({
    workPointId: point.workPointId,
    phase,
    ...metadata,
    checksumSha256: null,
  })
  await ownerStorage.uploadReservedPhoto({ reservation, file })
  return service.finalizePhoto({ photoId: reservation.photoId })
}

const before = await uploadPhase('before')
const after = await uploadPhase('after')
must(before.uploadStatus === 'active' && after.uploadStatus === 'active',
  'standard reserved uploads did not finalize as active')

const ownerSignedUrl = await ownerStorage.createAttendancePhotoSignedUrl({ photo: before })
const signedRead = await fetch(ownerSignedUrl)
must(signedRead.ok, 'owner signed URL did not read the private photo')
const signedBytes = Buffer.from(await signedRead.arrayBuffer())
must(Buffer.compare(signedBytes, pngBytes) === 0, 'signed URL bytes did not match upload bytes')

const ownerUpdateAttempt = await ownerClient.storage.from(before.bucketId).update(
  before.objectPath,
  pngFile('owner-overwrite.png', pngBytes),
  { contentType: 'image/png', cacheControl: '0', upsert: false },
)
const ownerDeleteAttempt = await ownerClient.storage
  .from(before.bucketId)
  .remove([before.objectPath])
must(Boolean(ownerUpdateAttempt.error), 'owner updated an active attendance photo')
const ownerDeleteDenied = deleteWasDenied(ownerDeleteAttempt, before.objectPath)
must(ownerDeleteDenied, 'owner delete reported a removed active attendance photo')

const otherDownloadAttempt = await otherClient.storage
  .from(before.bucketId)
  .download(before.objectPath)
let otherSignedDenied = false
try {
  await otherStorage.createAttendancePhotoSignedUrl({ photo: before })
} catch {
  otherSignedDenied = true
}
const otherUpdateAttempt = await otherClient.storage.from(before.bucketId).update(
  before.objectPath,
  pngFile('other-overwrite.png', pngBytes),
  { contentType: 'image/png', cacheControl: '0', upsert: false },
)
const otherDeleteAttempt = await otherClient.storage
  .from(before.bucketId)
  .remove([before.objectPath])
must(Boolean(otherDownloadAttempt.error), 'unrelated employee downloaded a private photo')
must(otherSignedDenied, 'unrelated employee created a signed private-photo URL')
must(Boolean(otherUpdateAttempt.error), 'unrelated employee updated a private photo')
const otherDeleteDenied = deleteWasDenied(otherDeleteAttempt, before.objectPath)
must(otherDeleteDenied, 'unrelated delete reported a removed private photo')

const publicReadAttempt = await fetch(
  `${configuration.apiUrl}/storage/v1/object/public/${before.bucketId}/${before.objectPath}`,
)
must(!publicReadAttempt.ok, 'private attendance photo had a permanent public read')

const unchangedRead = await fetch(ownerSignedUrl)
must(unchangedRead.ok, 'signed URL stopped reading after denied mutations')
const unchangedBytes = Buffer.from(await unchangedRead.arrayBuffer())
must(
  Buffer.compare(unchangedBytes, pngBytes) === 0,
  'private photo bytes changed after denied mutations',
)

const clockOut = await service.clockOut({
  sessionId: clockIn.session.sessionId,
  requestId: randomUUID(),
  location: { ...location, deviceRecordedAt: new Date().toISOString() },
  abnormalReason: null,
})
must(clockOut.session.status === 'closed', 'HTTP verification session did not close')

const cleanupCandidate = await seedRealCleanupCandidate({
  admin,
  employeeProfileId: ownerProfileId,
  sessionId: clockIn.session.sessionId,
  bytes: pngBytes,
})
const cleanup = await verifyCleanupEdgeGateway({
  admin,
  candidate: cleanupCandidate,
})
const concurrency = await verifyTrueClockInSerialization({
  admin,
  authUserId: ownerAuthUser.id,
  employeeProfileId: ownerProfileId,
  projectId,
})

const result = Object.freeze({
  disposableGuard: true,
  freshAuthProfileProjectBindings: true,
  standardReservedUpload: true,
  signedUrlByteMatch: true,
  oversizeDenied: Boolean(oversizeAttempt.error),
  disallowedMimeDenied: Boolean(mimeAttempt.error),
  unreservedProfilePathDenied: Boolean(unreservedAttempt.error),
  ownerActiveMutationDenied:
    Boolean(ownerUpdateAttempt.error) && ownerDeleteDenied,
  unrelatedReadSignMutationDenied:
    Boolean(otherDownloadAttempt.error) && otherSignedDenied &&
    Boolean(otherUpdateAttempt.error) && otherDeleteDenied,
  publicReadDenied: !publicReadAttempt.ok,
  bytesUnchangedAfterDeniedMutations:
    Buffer.compare(unchangedBytes, pngBytes) === 0,
  clockOutClosed: clockOut.session.status === 'closed',
  cleanupGatewayJwtEnforced: cleanup.gatewayJwtEnforced,
  cleanupIndependentSecretEnforced: cleanup.independentSecretEnforced,
  cleanupEdgeInvoked: cleanup.invoked,
  cleanupRealObjectAndMetadataDeleted: cleanup.realObjectAndMetadataDeleted,
  concurrencyObservedAdvisoryWait: concurrency.observedWait,
  concurrencySqlstateAndHint: concurrency.sqlstateAndHint,
  concurrencySingleOpenSession: concurrency.singleOpenSession,
  concurrencyEventRowsExact: concurrency.eventRowsExact,
})

assert.ok(Object.values(result).every((value) => value === true))
process.stdout.write(`${JSON.stringify(result)}\n`)

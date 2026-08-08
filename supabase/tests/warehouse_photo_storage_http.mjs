import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'

function fail(message) {
  throw new Error(message)
}

function required(environment, name) {
  const value = environment[name]
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    fail(`missing explicit ${name}`)
  }
  return value
}

function integerPort(environment, name, forbidden) {
  const value = required(environment, name)
  if (!/^[0-9]+$/u.test(value)) fail(`${name} must be an explicit port`)
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535 || port === forbidden) {
    fail(`${name} does not identify an isolated Task 3 port`)
  }
  return port
}

async function run(command, args) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  if (result.code !== 0 || result.signal !== null) {
    fail(`isolated target preflight failed: ${stderr.trim()}`)
  }
  return stdout
}

async function validateConfiguration(environment) {
  for (const name of Object.keys(environment)) {
    if (/^DOCKER_/u.test(name) || name === 'BUILDKIT_HOST') {
      fail('ambient Docker overrides are forbidden')
    }
  }
  const projectId = required(environment, 'WAREHOUSE_TASK3_PROJECT_ID')
  const workdir = required(environment, 'WAREHOUSE_TASK3_WORKDIR')
  const databaseContainer = required(environment, 'WAREHOUSE_TASK3_DB_CONTAINER')
  const dockerContext = required(environment, 'WAREHOUSE_TASK3_DOCKER_CONTEXT')
  const dbPort = integerPort(environment, 'WAREHOUSE_TASK3_DB_PORT', 54322)
  const apiPort = integerPort(environment, 'WAREHOUSE_TASK3_API_PORT', 54321)
  if (
    !/^warehouse-task3-[a-z0-9-]+$/u.test(projectId) ||
    !/^\/private\/tmp\/warehouse-task3-[A-Za-z0-9._-]+$/u.test(workdir) ||
    databaseContainer !== `supabase_db_${projectId}` ||
    !/^[a-z0-9][a-z0-9_.-]{0,127}$/u.test(dockerContext)
  ) fail('Task 3 target identity is not explicit and isolated')

  const resolvedWorkdir = await realpath(workdir).catch(() => '')
  if (resolvedWorkdir !== workdir) fail('Task 3 workdir is absent or not canonical')
  const configText = await readFile(`${workdir}/supabase/config.toml`, 'utf8')
  const projectMatch = /^project_id = "([^"]+)"$/mu.exec(configText)
  const apiMatch = /\[api\][\s\S]*?\nport = ([0-9]+)\n/u.exec(configText)
  const dbMatch = /\[db\][\s\S]*?\nport = ([0-9]+)\n/u.exec(configText)
  if (
    projectMatch?.[1] !== projectId ||
    Number(apiMatch?.[1]) !== apiPort ||
    Number(dbMatch?.[1]) !== dbPort
  ) fail('Task 3 workdir config does not match explicit target')

  const inspectText = await run('docker', [
    '--context', dockerContext, 'container', 'inspect', databaseContainer,
  ])
  const inspected = JSON.parse(inspectText)
  const container = Array.isArray(inspected) && inspected.length === 1 ? inspected[0] : null
  const binding = container?.NetworkSettings?.Ports?.['5432/tcp']
  if (
    container?.Name !== `/${databaseContainer}` ||
    container?.State?.Running !== true ||
    container?.Config?.Labels?.['com.supabase.cli.project'] !== projectId ||
    !Array.isArray(binding) || binding.length < 1 || binding.length > 2 ||
    binding.some((entry) =>
      entry?.HostPort !== String(dbPort) || !['0.0.0.0', '::'].includes(entry?.HostIp))
  ) fail('Docker container does not match the explicit Task 3 target')

  const markerSql = [
    'begin read only;',
    "select concat_ws('|', project_id, test_workdir, db_port, api_port,",
    "  to_regprocedure('public.register_warehouse_variant_photo_secure(uuid,text,text,bigint)') is not null,",
    "  exists (select 1 from storage.buckets where id='warehouse-item-photos' and public=false),",
    "  exists (select 1 from supabase_migrations.schema_migrations where version='202608080003'))",
    'from private.warehouse_task3_test_target;',
    'commit;',
  ].join(' ')
  const markerOutput = await run('docker', [
    '--context', dockerContext, 'exec', databaseContainer,
    'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', markerSql,
  ])
  const expectedMarker = `${projectId}|${workdir}|${dbPort}|${apiPort}|t|t|t`
  if (!markerOutput.split('\n').map((line) => line.trim()).includes(expectedMarker)) {
    fail('Task 3 database marker or migration preflight is missing')
  }

  const statusText = await run('npx', [
    '--no-install', 'supabase', 'status', '--workdir', workdir, '-o', 'env',
  ])
  const status = Object.create(null)
  for (const line of statusText.split('\n')) {
    const match = /^([A-Z0-9_]+)="([^"]*)"$/u.exec(line.trim())
    if (match) status[match[1]] = match[2]
  }
  const rawUrl = status.API_URL
  let apiUrl
  try { apiUrl = new URL(rawUrl) } catch { fail('isolated Supabase status API_URL is invalid') }
  if (
    apiUrl.protocol !== 'http:' ||
    apiUrl.hostname !== '127.0.0.1' ||
    Number(apiUrl.port) !== apiPort ||
    apiUrl.pathname !== '/' || apiUrl.search || apiUrl.hash ||
    apiUrl.username || apiUrl.password
  ) fail('Supabase status does not identify the explicit isolated loopback API')
  if (typeof status.ANON_KEY !== 'string' || !status.ANON_KEY ||
      typeof status.SERVICE_ROLE_KEY !== 'string' || !status.SERVICE_ROLE_KEY) {
    fail('isolated Supabase status did not provide in-process test credentials')
  }

  return Object.freeze({
    projectId,
    workdir,
    dbPort,
    apiPort,
    apiUrl: apiUrl.origin,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
  })
}

// This gate completes before importing Supabase, creating a client, authenticating,
// fetching HTTP, or mutating any database or Storage object.
const configuration = await validateConfiguration(process.env)
const { createClient } = await import('@supabase/supabase-js')

function client(key) {
  return createClient(configuration.apiUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

function data(result, message) {
  if (result?.error) {
    const code = typeof result.error.code === 'string' && result.error.code.length <= 64
      ? result.error.code
      : 'provider_error'
    fail(`${message} (${code})`)
  }
  return result?.data
}

function removed(result, path) {
  return !result?.error && Array.isArray(result?.data) &&
    result.data.some((entry) => entry?.name === path)
}

const admin = client(configuration.serviceRoleKey)
const manager = client(configuration.anonKey)
const otherManager = client(configuration.anonKey)
const viewer = client(configuration.anonKey)
const anonymous = client(configuration.anonKey)
const runId = randomUUID()
const managerEmail = `warehouse-task3-manager-${runId}@invalid.local`
const otherManagerEmail = `warehouse-task3-other-manager-${runId}@invalid.local`
const viewerEmail = `warehouse-task3-viewer-${runId}@invalid.local`
const managerPassword = `Task3!Manager!${randomUUID()}Aa9`
const otherManagerPassword = `Task3!OtherManager!${randomUUID()}Aa9`
const viewerPassword = `Task3!Viewer!${randomUUID()}Aa9`

const managerUser = data(await admin.auth.admin.createUser({
  email: managerEmail, password: managerPassword, email_confirm: true,
}), 'failed to create disposable manager')?.user
const otherManagerUser = data(await admin.auth.admin.createUser({
  email: otherManagerEmail, password: otherManagerPassword, email_confirm: true,
}), 'failed to create second disposable manager')?.user
const viewerUser = data(await admin.auth.admin.createUser({
  email: viewerEmail, password: viewerPassword, email_confirm: true,
}), 'failed to create disposable viewer')?.user
assert.ok(managerUser?.id && otherManagerUser?.id && viewerUser?.id)

const managerProfileId = randomUUID()
const otherManagerProfileId = randomUUID()
const viewerProfileId = randomUUID()
const employeeSeed = String(Date.now()).slice(-9)
data(await admin.from('employee_profiles').insert([
  {
    id: otherManagerProfileId,
    employee_number: `SW-8${employeeSeed}3`,
    auth_user_id: otherManagerUser.id,
    name: 'Task 3 Other Photo Manager',
    department: '仓库管理部',
    position: '大工',
    employment_status: '在职',
    account_status: 'active',
    must_change_password: false,
    is_hidden_system_account: false,
  },
  {
    id: managerProfileId,
    employee_number: `SW-8${employeeSeed}1`,
    auth_user_id: managerUser.id,
    name: 'Task 3 Photo Manager',
    department: '仓库管理部',
    position: '大工',
    employment_status: '在职',
    account_status: 'active',
    must_change_password: false,
    is_hidden_system_account: false,
  },
  {
    id: viewerProfileId,
    employee_number: `SW-8${employeeSeed}2`,
    auth_user_id: viewerUser.id,
    name: 'Task 3 Photo Viewer',
    department: '工程部',
    position: '中工',
    employment_status: '在职',
    account_status: 'active',
    must_change_password: false,
    is_hidden_system_account: false,
  },
]), 'failed to create disposable employee profiles')
data(await admin.from('permission_grants').insert([
  { subject_type: 'department', subject_code: '仓库管理部', permission_key: 'warehouse.catalog.manage' },
  { subject_type: 'position', subject_code: '中工', permission_key: 'module.inventory.view' },
]), 'failed to create disposable photo permissions')

const itemId = randomUUID()
const variantId = randomUUID()
const otherVariantId = randomUUID()
data(await admin.from('warehouse_items').insert({
  id: itemId, name: 'Task 3 HTTP Test Item', category: '', brand: '', description: '', active: true,
}), 'failed to create disposable warehouse item')
data(await admin.from('warehouse_variants').insert([
  {
    id: variantId, item_id: itemId, sku: `HTTP-${runId}-A`, model: '', size: '',
    material: '', unit: '个', minimum_stock: 0, default_purchase_price: 0,
    system_qr: `SWERP:VARIANT:${variantId}`, manufacturer_qr: null, active: true,
  },
  {
    id: otherVariantId, item_id: itemId, sku: `HTTP-${runId}-B`, model: '', size: '',
    material: '', unit: '个', minimum_stock: 0, default_purchase_price: 0,
    system_qr: `SWERP:VARIANT:${otherVariantId}`, manufacturer_qr: null, active: true,
  },
]), 'failed to create disposable warehouse variants')

data(await manager.auth.signInWithPassword({ email: managerEmail, password: managerPassword }),
  'manager login failed')
data(await otherManager.auth.signInWithPassword({
  email: otherManagerEmail, password: otherManagerPassword,
}), 'other manager login failed')
data(await viewer.auth.signInWithPassword({ email: viewerEmail, password: viewerPassword }),
  'viewer login failed')

const bucket = 'warehouse-item-photos'
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const uploadOptions = { contentType: 'image/jpeg', cacheControl: '3600', upsert: false }
const deniedPath = `${variantId}/${randomUUID()}.jpg`
const viewerUpload = await viewer.storage.from(bucket).upload(
  deniedPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
)
assert.ok(viewerUpload.error, 'inventory viewer uploaded without catalog permission')

const unknownVariantPath = `${randomUUID()}/${randomUUID()}.jpg`
const unknownVariantUpload = await manager.storage.from(bucket).upload(
  unknownVariantPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
)
assert.ok(unknownVariantUpload.error, 'manager uploaded under an unknown variant prefix')

const invalidMimePath = `${variantId}/${randomUUID()}.jpg`
const invalidMimeUpload = await manager.storage.from(bucket).upload(
  invalidMimePath,
  new Blob([jpegBytes], { type: 'application/pdf' }),
  { ...uploadOptions, contentType: 'application/pdf' },
)
assert.ok(invalidMimeUpload.error, 'Storage accepted a disallowed MIME type')

const oversizePath = `${variantId}/${randomUUID()}.jpg`
const oversizeUpload = await manager.storage.from(bucket).upload(
  oversizePath,
  new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/jpeg' }),
  uploadOptions,
)
assert.ok(oversizeUpload.error, 'Storage accepted an output that was not below 2 MiB')

const orphanPath = `${variantId}/${randomUUID()}.jpg`
const orphanUpload = await manager.storage.from(bucket).upload(
  orphanPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
)
assert.equal(data(orphanUpload, 'manager could not upload a canonical private object')?.path, orphanPath)
const orphanSigned = await viewer.storage.from(bucket).createSignedUrl(orphanPath, 300)
assert.ok(orphanSigned.error, 'viewer signed an unregistered orphan object')
const ownerOrphanSigned = await manager.storage.from(bucket).createSignedUrl(orphanPath, 300)
assert.ok(ownerOrphanSigned.error, 'upload owner signed an unregistered orphan object')
const foreignOrphanTicket = await otherManager.rpc('begin_warehouse_photo_orphan_delete_secure', {
  p_variant_id: variantId,
  p_object_path: orphanPath,
})
assert.equal(foreignOrphanTicket.error?.hint, 'WAREHOUSE_PHOTO_OBJECT_NOT_OWNED',
  'another manager created an orphan cleanup ticket for an object they did not upload')
const orphanTicket = data(await manager.rpc('begin_warehouse_photo_orphan_delete_secure', {
  p_variant_id: variantId,
  p_object_path: orphanPath,
}), 'upload owner could not create an orphan cleanup ticket')
assert.equal(orphanTicket.objectPath, orphanPath)
assert.equal(orphanTicket.photoId, null)
const foreignOrphanCleanup = await otherManager.storage.from(bucket).remove([orphanPath])
assert.equal(removed(foreignOrphanCleanup, orphanPath), false,
  'a different catalog manager used another requester orphan ticket')
const cancelledOrphan = data(await manager.rpc('cancel_warehouse_photo_delete_secure', {
  p_deletion_id: orphanTicket.deletionId,
  p_variant_id: variantId,
  p_photo_id: null,
}), 'owner could not cancel a known Storage failure while its orphan still existed')
assert.equal(cancelledOrphan, true)
const retriedOrphanTicket = data(await manager.rpc(
  'begin_warehouse_photo_orphan_delete_secure',
  { p_variant_id: variantId, p_object_path: orphanPath },
), 'owner could not retry orphan cleanup after cancellation')
assert.notEqual(retriedOrphanTicket.deletionId, orphanTicket.deletionId)
const orphanCleanup = await manager.storage.from(bucket).remove([orphanPath])
assert.equal(removed(orphanCleanup, orphanPath), true,
  'upload owner could not compensate-delete an unregistered orphan')
assert.equal(data(await manager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: retriedOrphanTicket.deletionId,
  p_variant_id: variantId,
  p_photo_id: null,
}), 'owner could not finalize orphan cleanup'), true)

const objectPath = `${variantId}/${randomUUID()}.jpg`
const uploaded = await manager.storage.from(bucket).upload(
  objectPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
)
assert.equal(data(uploaded, 'canonical warehouse photo upload failed')?.path, objectPath)

const crossVariant = await manager.rpc('register_warehouse_variant_photo_secure', {
  p_variant_id: otherVariantId,
  p_object_path: objectPath,
  p_mime_type: 'image/jpeg',
  p_byte_size: jpegBytes.length,
})
assert.equal(crossVariant.error?.hint, 'WAREHOUSE_PHOTO_PATH_INVALID',
  'cross-variant metadata path was not rejected')

const registered = data(await manager.rpc('register_warehouse_variant_photo_secure', {
  p_variant_id: variantId,
  p_object_path: objectPath,
  p_mime_type: 'image/jpeg',
  p_byte_size: jpegBytes.length,
}), 'photo registration failed')
assert.equal(registered.objectPath, objectPath)
assert.equal(registered.sortOrder, 0)
const managerList = await manager.rpc('list_warehouse_variant_photos_secure', {
  p_variant_id: variantId,
})
assert.ok(managerList.error,
  'manage-only uploader unexpectedly required or received inventory read permission')

const listed = data(await viewer.rpc('list_warehouse_variant_photos_secure', {
  p_variant_id: variantId,
}), 'inventory viewer could not list photo metadata')
assert.equal(listed.length, 1)
assert.equal(listed[0].objectPath, objectPath)

const anonymousSigned = await anonymous.storage.from(bucket).createSignedUrl(objectPath, 300)
assert.ok(anonymousSigned.error, 'anonymous user created a signed warehouse photo URL')
const viewerSigned = data(await viewer.storage.from(bucket).createSignedUrl(objectPath, 300),
  'inventory viewer could not create a short-lived signed URL')
const signedToken = new URL(viewerSigned.signedUrl).searchParams.get('token')
assert.match(signedToken ?? '', /^[^.]+\.[^.]+\.[^.]+$/u,
  'warehouse photo signed URL did not contain a JWT')
const signedPayload = JSON.parse(Buffer.from(signedToken.split('.')[1], 'base64url').toString('utf8'))
assert.equal(signedPayload.exp - signedPayload.iat, 300,
  'warehouse photo signed URL lifetime was not exactly 300 seconds')
const signedRead = await fetch(viewerSigned.signedUrl)
assert.equal(signedRead.ok, true, 'signed warehouse photo URL was unreadable')
assert.deepEqual(new Uint8Array(await signedRead.arrayBuffer()), jpegBytes)

const publicRead = await fetch(
  `${configuration.apiUrl}/storage/v1/object/public/${bucket}/${objectPath}`,
)
assert.equal(publicRead.ok, false, 'warehouse photo had a permanent public URL')

const viewerDelete = await viewer.storage.from(bucket).remove([objectPath])
assert.equal(removed(viewerDelete, objectPath), false,
  'inventory viewer deleted a warehouse photo object')
const overwrite = await manager.storage.from(bucket).update(
  objectPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
)
assert.ok(overwrite.error, 'catalog manager overwrote immutable photo bytes')

const registeredTicket = data(await otherManager.rpc(
  'begin_warehouse_variant_photo_delete_secure', {
    p_variant_id: variantId,
    p_photo_id: registered.id,
  },
), 'manage-only manager B could not begin deletion of manager A registered photo')
assert.equal(registeredTicket.objectPath, objectPath)
assert.equal(registeredTicket.photoId, registered.id)
const ownerCannotTakeTicket = await manager.rpc('begin_warehouse_variant_photo_delete_secure', {
  p_variant_id: variantId,
  p_photo_id: registered.id,
})
assert.equal(ownerCannotTakeTicket.error?.hint, 'WAREHOUSE_PHOTO_DELETE_OWNED',
  'photo uploader took over another requester deletion ticket')
const finalizeWhilePresent = await otherManager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: registeredTicket.deletionId,
  p_variant_id: variantId,
  p_photo_id: registered.id,
})
assert.equal(finalizeWhilePresent.error?.hint, 'WAREHOUSE_PHOTO_STORAGE_PRESENT',
  'finalize deleted metadata while the exact Storage object still existed')
const ownerCannotUseTicket = await manager.storage.from(bucket).remove([objectPath])
assert.equal(removed(ownerCannotUseTicket, objectPath), false,
  'photo uploader used another requester deletion ticket')
const managerDelete = await otherManager.storage.from(bucket).remove([objectPath])
assert.equal(managerDelete.error, null,
  'manage-only ticket requester could not delete the exact registered object')
assert.equal(managerDelete.data?.length, 1,
  'Storage removal did not return one exact target')
assert.equal(managerDelete.data?.[0]?.name, objectPath,
  'Storage removal returned a different target')

const forgedFinalize = await otherManager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: registeredTicket.deletionId,
  p_variant_id: otherVariantId,
  p_photo_id: registered.id,
})
assert.equal(forgedFinalize.error?.hint, 'WAREHOUSE_PHOTO_INPUT_INVALID',
  'forged variant binding finalized a pending deletion')
const recoveredTicket = data(await otherManager.rpc(
  'begin_warehouse_variant_photo_delete_secure', {
    p_variant_id: variantId,
    p_photo_id: registered.id,
  },
), 'pending ticket was not recoverable after Storage success/finalize failure')
assert.equal(recoveredTicket.deletionId, registeredTicket.deletionId)
assert.equal(recoveredTicket.storageDeleted, true)
const metadataDelete = data(await otherManager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: recoveredTicket.deletionId,
  p_variant_id: variantId,
  p_photo_id: registered.id,
}), 'ticket requester could not finalize matching photo metadata')
assert.equal(metadataDelete, true)
const afterDelete = data(await viewer.rpc('list_warehouse_variant_photos_secure', {
  p_variant_id: variantId,
}), 'viewer could not verify deletion')
assert.deepEqual(afterDelete, [])
const deletedSigned = await viewer.storage.from(bucket).createSignedUrl(objectPath, 300)
assert.ok(deletedSigned.error, 'deleted photo retained signed access')

process.stdout.write(`${JSON.stringify({
  projectId: configuration.projectId,
  workdir: configuration.workdir,
  dbPort: configuration.dbPort,
  apiPort: configuration.apiPort,
  privateBucket: true,
  orphanCleanup: true,
  crossVariantDenied: true,
  anonymousSignedUrlDenied: true,
  viewerSignedUrlSeconds: 300,
  deleteCompleted: true,
})}\n`)

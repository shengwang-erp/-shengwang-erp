import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

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
    "  marker_nonce, created_at > clock_timestamp() - interval '5 minutes',",
    '  created_at <= clock_timestamp(),',
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
  const marker = markerOutput.split('\n').map((line) => line.trim())
    .find((line) => line.startsWith(`${projectId}|${workdir}|${dbPort}|${apiPort}|`))
  const markerFields = marker?.split('|') ?? []
  const markerNonce = markerFields[4]
  if (
    markerFields.length !== 10 ||
    !UUID.test(markerNonce ?? '') ||
    markerFields.slice(5).some((field) => field !== 't')
  ) {
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
    databaseContainer,
    dockerContext,
    dbPort,
    apiPort,
    apiUrl: apiUrl.origin,
    anonKey: status.ANON_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY,
    markerNonce,
  })
}

function quoted(value) {
  if (typeof value !== 'string' || value.includes('\u0000')) fail('unsafe owner SQL value')
  return `'${value.replaceAll("'", "''")}'`
}

async function ownerSql(configuration, sql) {
  return run('docker', [
    '--context', configuration.dockerContext,
    'exec', configuration.databaseContainer,
    'psql', '-X', '-A', '-t', '-U', 'postgres', '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-c', sql,
  ])
}

function targetMarkerPredicate(configuration) {
  return [
    `project_id = ${quoted(configuration.projectId)}`,
    `and test_workdir = ${quoted(configuration.workdir)}`,
    `and db_port = ${configuration.dbPort}`,
    `and api_port = ${configuration.apiPort}`,
    `and marker_nonce = ${quoted(configuration.markerNonce)}::uuid`,
  ].join(' ')
}

async function verifyTargetMarker(configuration) {
  const output = await ownerSql(configuration, [
    'begin read only;',
    "select count(*) = 1 and bool_and(",
    `${targetMarkerPredicate(configuration)}`,
    "and exists(select 1 from supabase_migrations.schema_migrations where version='202608080003')",
    "and exists(select 1 from storage.buckets where id='warehouse-item-photos' and public=false)",
    ') from private.warehouse_task3_test_target;',
    'commit;',
  ].join(' '))
  if (!output.split('\n').map((line) => line.trim()).includes('t')) {
    fail('Task 3 target marker changed before cleanup')
  }
}

function idList(values) {
  if (!Array.isArray(values) || values.length < 1 || values.some((value) => !UUID.test(value))) {
    fail('invalid run-scoped UUID set')
  }
  return values.map((value) => `${quoted(value)}::uuid`).join(',')
}

function cleanupDiagnosticsSql(configuration, scope) {
  const profileIds = idList(scope.profileIds)
  const authUserIds = scope.authUserIds.length > 0
    ? idList(scope.authUserIds)
    : "'00000000-0000-4000-8000-000000000000'::uuid"
  const variantIds = idList(scope.variantIds)
  const itemIds = idList(scope.itemIds)
  return [
    'select json_build_object(',
    "'runScopedRemaining', (",
    ` (select count(*) from auth.users where id in (${authUserIds}) or email like ${quoted(`%${scope.runId}%`)}) +`,
    ` (select count(*) from auth.identities where user_id in (${authUserIds})) +`,
    ` (select count(*) from public.employee_profiles where id in (${profileIds})) +`,
    ` (select count(*) from storage.objects where bucket_id='warehouse-item-photos' and split_part(name,'/',1)::text in (${scope.variantIds.map(quoted).join(',')})) +`,
    ` (select count(*) from public.warehouse_variant_photos where variant_id in (${variantIds})) +`,
    ` (select count(*) from public.warehouse_photo_delete_outbox where variant_id in (${variantIds}) or original_requested_by_employee_profile_id in (${profileIds}) or requested_by_employee_profile_id in (${profileIds})) +`,
    ` (select count(*) from public.warehouse_photo_audit where variant_id in (${variantIds}) or actor_employee_profile_id in (${profileIds})) +`,
    ` (select count(*) from private.warehouse_photo_delete_receipts where variant_id in (${variantIds}) or requested_by_employee_profile_id in (${profileIds})) +`,
    ` (select count(*) from private.warehouse_photo_delete_takeover_receipts where original_requested_by_employee_profile_id in (${profileIds}) or previous_requested_by_employee_profile_id in (${profileIds}) or new_requested_by_employee_profile_id in (${profileIds})) +`,
    ` (select count(*) from public.warehouse_catalog_audit where entity_id in (${itemIds},${variantIds}) or actor_employee_profile_id in (${profileIds})) +`,
    ` (select count(*) from public.warehouse_variants where id in (${variantIds})) +`,
    ` (select count(*) from public.warehouse_items where id in (${itemIds})) +`,
    " (select count(*) from public.permission_grants where (subject_type,subject_code,permission_key) in (('department','仓库管理部','warehouse.catalog.manage'),('position','中工','module.inventory.view')))",
    '),',
    "'triggersEnabled', (select count(*) = 4 and bool_and(trigger.tgenabled = 'O')",
    ' from pg_trigger trigger where (trigger.tgrelid, trigger.tgname) in (',
    "  ('public.warehouse_catalog_audit'::regclass,'reject_warehouse_catalog_audit_mutation'),",
    "  ('public.warehouse_photo_audit'::regclass,'reject_warehouse_photo_audit_mutation'),",
    "  ('private.warehouse_photo_delete_receipts'::regclass,'reject_warehouse_photo_delete_receipt_mutation'),",
    "  ('private.warehouse_photo_delete_takeover_receipts'::regclass,'reject_warehouse_photo_delete_takeover_receipt_mutation')",
    ' )),',
    "'fixedPermissionGrants', (select count(*) from public.permission_grants",
    " where (subject_type,subject_code,permission_key) in (('department','仓库管理部','warehouse.catalog.manage'),('position','中工','module.inventory.view')))",
    ');',
  ].join(' ')
}

function parseCleanupProof(output) {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  let proof
  try { proof = JSON.parse(lines.at(-1) ?? '') } catch { fail('cleanup proof invalid') }
  if (
    proof === null || typeof proof !== 'object' || Array.isArray(proof) ||
    !Number.isSafeInteger(proof.runScopedRemaining) || proof.runScopedRemaining < 0 ||
    typeof proof.triggersEnabled !== 'boolean' ||
    !Number.isSafeInteger(proof.fixedPermissionGrants) || proof.fixedPermissionGrants < 0
  ) fail('cleanup proof invalid')
  return proof
}

async function cleanupDiagnostics(configuration, scope) {
  await verifyTargetMarker(configuration)
  return parseCleanupProof(await ownerSql(
    configuration,
    cleanupDiagnosticsSql(configuration, scope),
  ))
}

async function assertCleanStart(configuration, scope) {
  const proof = await cleanupDiagnostics(configuration, scope)
  if (
    proof.runScopedRemaining !== 0 ||
    proof.triggersEnabled !== true ||
    proof.fixedPermissionGrants !== 0
  ) fail('isolated HTTP fixture target is polluted before mutation')
}

async function cleanupRun(configuration, scope) {
  await verifyTargetMarker(configuration)
  const profileIds = idList(scope.profileIds)
  const authUserIds = scope.authUserIds.length > 0
    ? idList(scope.authUserIds)
    : "'00000000-0000-4000-8000-000000000000'::uuid"
  const variantIds = idList(scope.variantIds)
  const itemIds = idList(scope.itemIds)
  const sql = [
    'begin;',
    'do $target$ begin if not exists (select 1 from private.warehouse_task3_test_target where',
    `${targetMarkerPredicate(configuration)}) then raise exception 'isolated Task 3 marker mismatch'; end if; end $target$;`,
    'alter table public.warehouse_catalog_audit disable trigger reject_warehouse_catalog_audit_mutation;',
    'alter table public.warehouse_photo_audit disable trigger reject_warehouse_photo_audit_mutation;',
    'alter table private.warehouse_photo_delete_receipts disable trigger reject_warehouse_photo_delete_receipt_mutation;',
    'alter table private.warehouse_photo_delete_takeover_receipts disable trigger reject_warehouse_photo_delete_takeover_receipt_mutation;',
    `delete from private.warehouse_photo_delete_takeover_receipts where original_requested_by_employee_profile_id in (${profileIds}) or previous_requested_by_employee_profile_id in (${profileIds}) or new_requested_by_employee_profile_id in (${profileIds});`,
    `delete from private.warehouse_photo_delete_receipts where variant_id in (${variantIds}) or requested_by_employee_profile_id in (${profileIds});`,
    `delete from public.warehouse_photo_audit where variant_id in (${variantIds}) or actor_employee_profile_id in (${profileIds});`,
    `delete from public.warehouse_catalog_audit where entity_id in (${itemIds},${variantIds}) or actor_employee_profile_id in (${profileIds});`,
    'alter table public.warehouse_catalog_audit enable trigger reject_warehouse_catalog_audit_mutation;',
    'alter table public.warehouse_photo_audit enable trigger reject_warehouse_photo_audit_mutation;',
    'alter table private.warehouse_photo_delete_receipts enable trigger reject_warehouse_photo_delete_receipt_mutation;',
    'alter table private.warehouse_photo_delete_takeover_receipts enable trigger reject_warehouse_photo_delete_takeover_receipt_mutation;',
    `delete from public.warehouse_photo_delete_outbox where variant_id in (${variantIds}) or original_requested_by_employee_profile_id in (${profileIds}) or requested_by_employee_profile_id in (${profileIds});`,
    `delete from public.warehouse_variant_photos where variant_id in (${variantIds});`,
    'set local session_replication_role = replica;',
    `delete from storage.objects where bucket_id='warehouse-item-photos' and split_part(name,'/',1)::text in (${scope.variantIds.map(quoted).join(',')});`,
    'set local session_replication_role = origin;',
    `delete from public.warehouse_variants where id in (${variantIds});`,
    `delete from public.warehouse_items where id in (${itemIds});`,
    "delete from public.permission_grants where (subject_type,subject_code,permission_key) in (('department','仓库管理部','warehouse.catalog.manage'),('position','中工','module.inventory.view'));",
    `delete from public.employee_profiles where id in (${profileIds});`,
    `delete from auth.users where id in (${authUserIds}) or email like ${quoted(`%${scope.runId}%`)};`,
    'commit;',
  ].join(' ')
  await ownerSql(configuration, sql)
  const proof = await cleanupDiagnostics(configuration, scope)
  if (
    proof.runScopedRemaining !== 0 ||
    proof.triggersEnabled !== true ||
    proof.fixedPermissionGrants !== 0
  ) fail('HTTP fixture cleanup incomplete')
  return proof
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
const failurePoint = process.env.WAREHOUSE_TASK3_HTTP_FAILURE_POINT ?? ''
if (!['', 'after_profiles'].includes(failurePoint)) {
  fail('unsupported isolated HTTP failure point')
}
const runId = randomUUID()
const managerEmail = `warehouse-task3-manager-${runId}@invalid.local`
const otherManagerEmail = `warehouse-task3-other-manager-${runId}@invalid.local`
const viewerEmail = `warehouse-task3-viewer-${runId}@invalid.local`
const managerPassword = `Task3!Manager!${randomUUID()}Aa9`
const otherManagerPassword = `Task3!OtherManager!${randomUUID()}Aa9`
const viewerPassword = `Task3!Viewer!${randomUUID()}Aa9`
const managerProfileId = randomUUID()
const otherManagerProfileId = randomUUID()
const viewerProfileId = randomUUID()
const itemId = randomUUID()
const variantId = randomUUID()
const otherVariantId = randomUUID()
const scope = {
  runId,
  authUserIds: [],
  profileIds: [managerProfileId, otherManagerProfileId, viewerProfileId],
  itemIds: [itemId],
  variantIds: [variantId, otherVariantId],
}
let operationFailed = false
let injectedFailureReached = false
let cleanupProof = null

await assertCleanStart(configuration, scope)

try {

const managerUser = data(await admin.auth.admin.createUser({
  email: managerEmail, password: managerPassword, email_confirm: true,
}), 'failed to create disposable manager')?.user
if (managerUser?.id) scope.authUserIds.push(managerUser.id)
const otherManagerUser = data(await admin.auth.admin.createUser({
  email: otherManagerEmail, password: otherManagerPassword, email_confirm: true,
}), 'failed to create second disposable manager')?.user
if (otherManagerUser?.id) scope.authUserIds.push(otherManagerUser.id)
const viewerUser = data(await admin.auth.admin.createUser({
  email: viewerEmail, password: viewerPassword, email_confirm: true,
}), 'failed to create disposable viewer')?.user
if (viewerUser?.id) scope.authUserIds.push(viewerUser.id)
assert.ok(managerUser?.id && otherManagerUser?.id && viewerUser?.id)

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

if (failurePoint === 'after_profiles') {
  injectedFailureReached = true
  throw new Error('isolated HTTP failure injected')
}

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

// A fresh pending registered delete becomes immediately claimable when its
// requester is disabled. Candidate discovery remains exact and path-free.
const takeoverPath = `${variantId}/${randomUUID()}.jpg`
data(await manager.storage.from(bucket).upload(
  takeoverPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
), 'takeover fixture upload failed')
const takeoverPhoto = data(await manager.rpc('register_warehouse_variant_photo_secure', {
  p_variant_id: variantId,
  p_object_path: takeoverPath,
  p_mime_type: 'image/jpeg',
  p_byte_size: jpegBytes.length,
}), 'takeover fixture registration failed')
const takeoverOldTicket = data(await manager.rpc(
  'begin_warehouse_variant_photo_delete_secure', {
    p_variant_id: variantId,
    p_photo_id: takeoverPhoto.id,
  },
), 'takeover fixture ticket failed')
data(await admin.from('employee_profiles').update({ account_status: 'disabled' })
  .eq('id', managerProfileId), 'failed to disable original requester')
const takeoverCandidates = data(await otherManager.rpc(
  'list_warehouse_photo_delete_candidates_secure',
), 'eligible manager could not list sanitized takeover candidates')
const takeoverCandidate = takeoverCandidates.find(
  (candidate) => candidate.deletionId === takeoverOldTicket.deletionId,
)
assert.deepEqual(Object.keys(takeoverCandidate ?? {}).sort(), [
  'createdAt', 'deletionId', 'kind', 'originalRequesterLabel',
])
assert.equal(takeoverCandidate.originalRequesterLabel, 'Task 3 Photo Manager')
assert.equal(JSON.stringify(takeoverCandidate).includes(takeoverPath), false,
  'sanitized candidate leaked the Storage object path')
const takeoverNewTicket = data(await otherManager.rpc(
  'claim_warehouse_photo_delete_secure', {
    p_deletion_id: takeoverOldTicket.deletionId,
  },
), 'eligible manager could not claim disabled-requester ticket')
assert.notEqual(takeoverNewTicket.deletionId, takeoverOldTicket.deletionId,
  'HTTP takeover did not rotate the deletion ID')
const oldRequesterDelete = await manager.storage.from(bucket).remove([takeoverPath])
assert.equal(removed(oldRequesterDelete, takeoverPath), false,
  'old requester retained Storage delete access after takeover')
assert.equal(removed(
  await otherManager.storage.from(bucket).remove([takeoverPath]), takeoverPath,
), true, 'new requester could not remove the exact claimed object')
assert.equal(data(await otherManager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: takeoverNewTicket.deletionId,
  p_variant_id: takeoverNewTicket.variantId,
  p_photo_id: takeoverNewTicket.photoId,
}), 'new requester could not finalize claimed registered deletion'), true)
const oldClaim = await otherManager.rpc('claim_warehouse_photo_delete_secure', {
  p_deletion_id: takeoverOldTicket.deletionId,
})
assert.equal(oldClaim.error?.hint, 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID',
  'rotated old deletion ID remained usable over HTTP')
data(await admin.from('employee_profiles').update({ account_status: 'active' })
  .eq('id', managerProfileId), 'failed to restore original requester')

// Simulate an orphan finalize response being discarded, then recover from a
// new browser session using only the deletion ID and immutable receipt.
const lostFinalizeOrphanPath = `${variantId}/${randomUUID()}.jpg`
data(await manager.storage.from(bucket).upload(
  lostFinalizeOrphanPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
), 'lost-finalize orphan upload failed')
const lostFinalizeOrphanTicket = data(await manager.rpc(
  'begin_warehouse_photo_orphan_delete_secure', {
    p_variant_id: variantId,
    p_object_path: lostFinalizeOrphanPath,
  },
), 'lost-finalize orphan ticket failed')
assert.equal(removed(
  await manager.storage.from(bucket).remove([lostFinalizeOrphanPath]),
  lostFinalizeOrphanPath,
), true, 'lost-finalize orphan Storage remove failed')
// The caller deliberately discards this successful response.
data(await manager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: lostFinalizeOrphanTicket.deletionId,
  p_variant_id: lostFinalizeOrphanTicket.variantId,
  p_photo_id: null,
}), 'orphan finalize fixture failed')
const refreshedManager = client(configuration.anonKey)
data(await refreshedManager.auth.signInWithPassword({
  email: managerEmail, password: managerPassword,
}), 'refreshed manager login failed')
const recoveredCompletedOrphan = data(await refreshedManager.rpc(
  'claim_warehouse_photo_delete_secure', {
    p_deletion_id: lostFinalizeOrphanTicket.deletionId,
  },
), 'refreshed manager could not recover discarded orphan finalize response')
assert.equal(recoveredCompletedOrphan.deletionId, lostFinalizeOrphanTicket.deletionId)
assert.equal(recoveredCompletedOrphan.storageDeleted, true)
assert.equal(data(await refreshedManager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: recoveredCompletedOrphan.deletionId,
  p_variant_id: recoveredCompletedOrphan.variantId,
  p_photo_id: null,
}), 'orphan finalize retry was not idempotent'), true)

// A registered object can be recovered after refresh even though this manager
// cannot list inventory metadata or sign the now-absent object.
const refreshRegisteredPath = `${variantId}/${randomUUID()}.jpg`
data(await manager.storage.from(bucket).upload(
  refreshRegisteredPath, new Blob([jpegBytes], { type: 'image/jpeg' }), uploadOptions,
), 'registered refresh fixture upload failed')
const refreshRegisteredPhoto = data(await manager.rpc(
  'register_warehouse_variant_photo_secure', {
    p_variant_id: variantId,
    p_object_path: refreshRegisteredPath,
    p_mime_type: 'image/jpeg',
    p_byte_size: jpegBytes.length,
  },
), 'registered refresh fixture registration failed')
const refreshRegisteredTicket = data(await manager.rpc(
  'begin_warehouse_variant_photo_delete_secure', {
    p_variant_id: variantId,
    p_photo_id: refreshRegisteredPhoto.id,
  },
), 'registered refresh ticket failed')
assert.equal(removed(
  await manager.storage.from(bucket).remove([refreshRegisteredPath]),
  refreshRegisteredPath,
), true, 'registered refresh Storage remove failed')
assert.ok((await refreshedManager.rpc('list_warehouse_variant_photos_secure', {
  p_variant_id: variantId,
})).error, 'refresh recovery unexpectedly depended on inventory list access')
assert.ok((await refreshedManager.storage.from(bucket).createSignedUrl(
  refreshRegisteredPath, 300,
)).error, 'refresh recovery unexpectedly depended on signing the deleted object')
const refreshRecoveredTicket = data(await refreshedManager.rpc(
  'claim_warehouse_photo_delete_secure', {
    p_deletion_id: refreshRegisteredTicket.deletionId,
  },
), 'registered pending delete was not recoverable by deletion ID only')
assert.equal(refreshRecoveredTicket.storageDeleted, true)
assert.equal(data(await refreshedManager.rpc('finalize_warehouse_photo_delete_secure', {
  p_deletion_id: refreshRecoveredTicket.deletionId,
  p_variant_id: refreshRecoveredTicket.variantId,
  p_photo_id: refreshRecoveredTicket.photoId,
}), 'registered refresh recovery could not finalize metadata'), true)
} catch {
  operationFailed = true
} finally {
  let cleanupFailed = false
  try {
    cleanupProof = await cleanupRun(configuration, scope)
  } catch {
    cleanupFailed = true
    try {
      cleanupProof = await cleanupDiagnostics(configuration, scope)
    } catch {
      cleanupProof = {
        runScopedRemaining: -1,
        triggersEnabled: false,
        fixedPermissionGrants: -1,
      }
    }
  }

  const cleanupVerified = !cleanupFailed &&
    cleanupProof.runScopedRemaining === 0 &&
    cleanupProof.triggersEnabled === true &&
    cleanupProof.fixedPermissionGrants === 0
  const result = {
    ok: !operationFailed && cleanupVerified,
    runId,
    cleanupVerified,
    runScopedRemaining: cleanupProof.runScopedRemaining,
    triggersEnabled: cleanupProof.triggersEnabled,
    fixedPermissionGrants: cleanupProof.fixedPermissionGrants,
  }
  if (operationFailed || !cleanupVerified) {
    if (failurePoint) {
      result.failurePoint = failurePoint
      result.failureInjected = injectedFailureReached
    }
    process.stderr.write(`${JSON.stringify(result)}\n`)
    process.exitCode = 1
  } else {
    Object.assign(result, {
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
      sanitizedCandidates: true,
      disabledRequesterTakeover: true,
      orphanLostFinalizeRecovered: true,
      registeredRefreshRecoveredWithoutListOrSign: true,
    })
    process.stdout.write(`${JSON.stringify(result)}\n`)
  }
}

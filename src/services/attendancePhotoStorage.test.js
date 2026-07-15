import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  AttendancePhotoStorageError,
  createAttendancePhotoStorage,
} from './attendancePhotoStorage.js'

const source = await readFile(new URL('./attendancePhotoStorage.js', import.meta.url), 'utf8').catch(() => '')
const reservation = {
  photoId: '74000000-0000-4000-8000-000000000001',
  bucketId: 'erp-attendance-photos',
  objectPath: 'employee/session/point/photo/before',
  originalFileName: '原始名.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 4,
  uploadStatus: 'pending',
}
const matchingFile = () => ({ name: '原始名.jpg', type: 'image/jpeg', size: 4 })

async function assertStorageError(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof AttendancePhotoStorageError, true)
    assert.equal(error.code, code)
    return true
  })
}

test('upload uses only the reserved private path and never overwrites', async () => {
  const calls = []
  const bucket = {
    async upload(...args) { calls.push(['upload', ...args]); return { data: { path: args[0] }, error: null } },
    async createSignedUrl(...args) { calls.push(['signed', ...args]); return { data: { signedUrl: 'https://signed.invalid/photo' }, error: null } },
  }
  const storage = createAttendancePhotoStorage({ storage: { from(name) { calls.push(['from', name]); return bucket } } }, { configured: true })
  const file = matchingFile()
  assert.deepEqual(await storage.uploadReservedPhoto({ reservation, file }), {
    bucketId: 'erp-attendance-photos', objectPath: reservation.objectPath, uploaded: true,
  })
  assert.deepEqual(calls[1], ['upload', reservation.objectPath, file, {
    contentType: 'image/jpeg', cacheControl: '0', upsert: false,
  }])
  assert.equal(Object.hasOwn(await storage.uploadReservedPhoto({ reservation, file }), 'uploadStatus'), false)
})

test('signed URLs are only for server-returned active photos and always live 300 seconds', async () => {
  const calls = []
  const storage = createAttendancePhotoStorage({ storage: { from(name) { return {
    async createSignedUrl(path, ttl) { calls.push([name, path, ttl]); return { data: { signedUrl: 'https://signed.invalid/photo' }, error: null } },
  } } } }, { configured: true })
  const url = await storage.createAttendancePhotoSignedUrl({ photo: { ...reservation, uploadStatus: 'active' } })
  assert.equal(url, 'https://signed.invalid/photo')
  assert.deepEqual(calls, [['erp-attendance-photos', reservation.objectPath, 300]])
  await assertStorageError(
    () => storage.createAttendancePhotoSignedUrl({ photo: reservation }),
    'ATTENDANCE_STORAGE_PHOTO_NOT_ACTIVE',
  )
})

test('transport source has no public URL, overwrite, update or delete path', () => {
  assert.doesNotMatch(source, /getPublicUrl|upsert:\s*true|\.update\(|\.remove\(|\.delete\(/)
})

test('reservation mismatch and unconfigured storage fail before network I/O', async () => {
  let storageCalls = 0
  const client = { storage: { from() { storageCalls += 1; throw new Error('must not run') } } }
  const storage = createAttendancePhotoStorage(client, { configured: true })
  const file = matchingFile()
  for (const bad of [
    { ...reservation, bucketId: 'public-bucket' },
    { ...reservation, objectPath: '' },
    { ...reservation, objectPath: '   ' },
    { ...reservation, objectPath: 42 },
    { ...reservation, originalFileName: 'other.jpg' },
    { ...reservation, contentType: 'image/png' },
    { ...reservation, sizeBytes: 5 },
    { ...reservation, uploadStatus: 'active' },
  ]) await assertStorageError(
    () => storage.uploadReservedPhoto({ reservation: bad, file }),
    'ATTENDANCE_STORAGE_RESERVATION_MISMATCH',
  )
  await assertStorageError(
    () => createAttendancePhotoStorage(client, { configured: false })
      .uploadReservedPhoto({ reservation, file }),
    'ATTENDANCE_STORAGE_NOT_CONFIGURED',
  )
  assert.equal(storageCalls, 0)
})

test('upload rejects null, missing and wrong-path Storage success payloads', async () => {
  for (const result of [
    null,
    {},
    { data: null, error: null },
    { data: {}, error: null },
    { data: { path: '' }, error: null },
    { data: { path: '   ' }, error: null },
    { data: { path: 'another/private/path' }, error: null },
  ]) {
    const storage = createAttendancePhotoStorage({ storage: { from() { return {
      async upload() { return result },
    } } } }, { configured: true })
    await assertStorageError(
      () => storage.uploadReservedPhoto({ reservation, file: matchingFile() }),
      'ATTENDANCE_STORAGE_UPLOAD_FAILED',
    )
  }
})

test('upload maps thrown and explicit Storage errors to a stable failure', async () => {
  for (const upload of [
    async () => { throw new Error('provider details') },
    async () => ({ data: { path: reservation.objectPath }, error: new Error('provider details') }),
  ]) {
    const storage = createAttendancePhotoStorage({ storage: { from() { return { upload } } } }, { configured: true })
    await assertStorageError(
      () => storage.uploadReservedPhoto({ reservation, file: matchingFile() }),
      'ATTENDANCE_STORAGE_UPLOAD_FAILED',
    )
  }
})

test('signed URL paths fail before I/O and empty or failed responses are rejected', async () => {
  let storageCalls = 0
  const noIoStorage = createAttendancePhotoStorage({ storage: { from() {
    storageCalls += 1
    throw new Error('must not run')
  } } }, { configured: true })
  for (const objectPath of ['', '   ', 42]) {
    await assertStorageError(
      () => noIoStorage.createAttendancePhotoSignedUrl({
        photo: { ...reservation, objectPath, uploadStatus: 'active' },
      }),
      'ATTENDANCE_STORAGE_PHOTO_NOT_ACTIVE',
    )
  }
  assert.equal(storageCalls, 0)

  for (const createSignedUrl of [
    async () => null,
    async () => ({}),
    async () => ({ data: { signedUrl: '' }, error: null }),
    async () => ({ data: { signedUrl: '   ' }, error: null }),
    async () => ({ data: { signedUrl: 'https://signed.invalid/photo' }, error: new Error('provider details') }),
    async () => { throw new Error('provider details') },
  ]) {
    const storage = createAttendancePhotoStorage({ storage: { from() { return { createSignedUrl } } } }, { configured: true })
    await assertStorageError(
      () => storage.createAttendancePhotoSignedUrl({ photo: { ...reservation, uploadStatus: 'active' } }),
      'ATTENDANCE_STORAGE_SIGN_FAILED',
    )
  }
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createAttendancePhotoStorage } from './attendancePhotoStorage.js'

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

test('upload uses only the reserved private path and never overwrites', async () => {
  const calls = []
  const bucket = {
    async upload(...args) { calls.push(['upload', ...args]); return { data: { path: args[0] }, error: null } },
    async createSignedUrl(...args) { calls.push(['signed', ...args]); return { data: { signedUrl: 'https://signed.invalid/photo' }, error: null } },
  }
  const storage = createAttendancePhotoStorage({ storage: { from(name) { calls.push(['from', name]); return bucket } } }, { configured: true })
  const file = { name: '原始名.jpg', type: 'image/jpeg', size: 4 }
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
  await assert.rejects(() => storage.createAttendancePhotoSignedUrl({ photo: reservation }))
})

test('transport source has no public URL, overwrite, update or delete path', () => {
  assert.doesNotMatch(source, /getPublicUrl|upsert:\s*true|\.update\(|\.remove\(|\.delete\(/)
})

test('reservation mismatch and unconfigured storage fail before network I/O', async () => {
  let storageCalls = 0
  const client = { storage: { from() { storageCalls += 1; throw new Error('must not run') } } }
  const storage = createAttendancePhotoStorage(client, { configured: true })
  const file = { name: 'a.jpg', type: 'image/jpeg', size: 4 }
  for (const bad of [
    { ...reservation, bucketId: 'public-bucket' },
    { ...reservation, objectPath: '' },
    { ...reservation, originalFileName: 'other.jpg' },
    { ...reservation, contentType: 'image/png' },
    { ...reservation, sizeBytes: 5 },
    { ...reservation, uploadStatus: 'active' },
  ]) await assert.rejects(() => storage.uploadReservedPhoto({ reservation: bad, file }))
  await assert.rejects(() => createAttendancePhotoStorage(client, { configured: false })
    .uploadReservedPhoto({ reservation, file }))
  assert.equal(storageCalls, 0)
})

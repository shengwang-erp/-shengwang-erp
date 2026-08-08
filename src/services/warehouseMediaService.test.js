import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  WAREHOUSE_PHOTO_BUCKET,
  WarehouseMediaServiceError,
  createWarehouseMediaService,
} from './warehouseMediaService.js'

const variantId = '73000000-0000-4000-8000-000000000001'
const photoId = '73000000-0000-4000-8000-000000000002'
const objectId = '73000000-0000-4000-8000-000000000003'
const createdAt = '2026-08-08T12:00:00.000Z'
const objectPath = `${variantId}/${objectId}.jpg`
const photoRow = Object.freeze({
  id: photoId,
  variantId,
  objectPath,
  sortOrder: 0,
  mimeType: 'image/jpeg',
  byteSize: 256,
  createdAt,
})
const source = await readFile(new URL('./warehouseMediaService.js', import.meta.url), 'utf8').catch(() => '')

function createClient({ rpcHandler, bucketOverrides = {} } = {}) {
  const calls = []
  const bucket = {
    async upload(...args) {
      calls.push(['upload', ...args])
      return { data: { path: args[0] }, error: null }
    },
    async remove(...args) {
      calls.push(['remove', ...args])
      return { data: args[0].map((name) => ({ name })), error: null }
    },
    async createSignedUrl(...args) {
      calls.push(['signed', ...args])
      return { data: { signedUrl: `https://signed.invalid/${args[0]}` }, error: null }
    },
    ...bucketOverrides,
  }
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push(['rpc', name, args])
        return rpcHandler ? rpcHandler(name, args) : { data: [], error: null, status: 200 }
      },
      storage: {
        from(name) {
          calls.push(['from', name])
          return bucket
        },
      },
    },
  }
}

async function assertServiceError(operation, code) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof WarehouseMediaServiceError, true)
    assert.equal(error.code, code)
    return true
  })
}

test('list returns ordered metadata with 300-second signed URLs from the private bucket', async () => {
  const second = {
    ...photoRow,
    id: '73000000-0000-4000-8000-000000000004',
    objectPath: `${variantId}/73000000-0000-4000-8000-000000000005.png`,
    sortOrder: 1,
    mimeType: 'image/png',
  }
  const { client, calls } = createClient({
    rpcHandler(name) {
      assert.equal(name, 'list_warehouse_variant_photos_secure')
      return { data: [photoRow, second], error: null, status: 200 }
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })
  const result = await service.listVariantPhotos(variantId)
  assert.deepEqual(result.map(({ signedUrl, ...row }) => row), [photoRow, second])
  assert.deepEqual(result.map((row) => row.signedUrl), [
    `https://signed.invalid/${photoRow.objectPath}`,
    `https://signed.invalid/${second.objectPath}`,
  ])
  assert.deepEqual(calls.filter((call) => call[0] === 'signed'), [
    ['signed', photoRow.objectPath, 300],
    ['signed', second.objectPath, 300],
  ])
  assert.equal(result.every(Object.isFrozen), true)
})

test('upload compresses, uses a generated variant-bound path, then registers exact metadata', async () => {
  const compressed = new Blob([new Uint8Array(256)], { type: 'image/jpeg' })
  const { client, calls } = createClient({
    rpcHandler(name, args) {
      if (name === 'list_warehouse_variant_photos_secure') {
        return { data: [], error: null, status: 200 }
      }
      assert.equal(name, 'register_warehouse_variant_photo_secure')
      assert.deepEqual(args, {
        p_variant_id: variantId,
        p_object_path: objectPath,
        p_mime_type: 'image/jpeg',
        p_byte_size: 256,
      })
      return { data: photoRow, error: null, status: 200 }
    },
  })
  const service = createWarehouseMediaService(client, {
    configured: true,
    randomUuid: () => objectId,
    compressPhoto: async () => compressed,
  })
  assert.deepEqual(
    await service.uploadVariantPhoto({
      variantId,
      file: { name: 'photo.jpg', type: 'image/jpeg', size: 1024 },
    }),
    photoRow,
  )
  assert.deepEqual(calls.find((call) => call[0] === 'upload'), [
    'upload', objectPath, compressed,
    { contentType: 'image/jpeg', cacheControl: '3600', upsert: false },
  ])
  assert.equal(calls.filter((call) => call[0] === 'from').every((call) =>
    call[1] === WAREHOUSE_PHOTO_BUCKET), true)
})

test('client rejects a ninth photo before compression or Storage I/O', async () => {
  let compressed = false
  const rows = Array.from({ length: 8 }, (_, sortOrder) => ({
    ...photoRow,
    id: `73000000-0000-4000-8000-${String(sortOrder + 10).padStart(12, '0')}`,
    objectPath: `${variantId}/73000000-0000-4000-8000-${String(sortOrder + 20).padStart(12, '0')}.jpg`,
    sortOrder,
  }))
  const { client, calls } = createClient({
    rpcHandler() { return { data: rows, error: null, status: 200 } },
  })
  const service = createWarehouseMediaService(client, {
    configured: true,
    randomUuid: () => objectId,
    compressPhoto: async () => { compressed = true; return new Blob() },
  })
  await assertServiceError(
    () => service.uploadVariantPhoto({
      variantId,
      file: { name: 'photo.jpg', type: 'image/jpeg', size: 1 },
    }),
    'WAREHOUSE_PHOTO_LIMIT_REACHED',
  )
  assert.equal(compressed, false)
  assert.equal(calls.some((call) => ['from', 'upload'].includes(call[0])), false)
})

test('registration failure removes the just-uploaded orphan before returning a safe error', async () => {
  const { client, calls } = createClient({
    rpcHandler(name) {
      if (name === 'list_warehouse_variant_photos_secure') {
        return { data: [], error: null, status: 200 }
      }
      return {
        data: null,
        error: { code: 'PGRST999', message: 'sensitive provider detail' },
        status: 500,
      }
    },
  })
  const service = createWarehouseMediaService(client, {
    configured: true,
    randomUuid: () => objectId,
    compressPhoto: async () => new Blob([new Uint8Array(256)], { type: 'image/jpeg' }),
  })
  await assertServiceError(
    () => service.uploadVariantPhoto({
      variantId,
      file: { name: 'photo.jpg', type: 'image/jpeg', size: 1024 },
    }),
    'WAREHOUSE_PHOTO_SERVICE_UNAVAILABLE',
  )
  assert.deepEqual(calls.find((call) => call[0] === 'remove'), ['remove', [objectPath]])
  assert.equal(calls.findIndex((call) => call[0] === 'remove') >
    calls.findIndex((call) => call[0] === 'rpc' && call[1] === 'register_warehouse_variant_photo_secure'), true)
})

test('failed orphan cleanup is reported explicitly without exposing provider details', async () => {
  const { client } = createClient({
    rpcHandler(name) {
      if (name === 'list_warehouse_variant_photos_secure') {
        return { data: [], error: null, status: 200 }
      }
      return { data: null, error: { code: 'PGRST999', message: 'secret' }, status: 500 }
    },
    bucketOverrides: {
      async remove() { return { data: null, error: { message: 'secret cleanup failure' } } },
    },
  })
  const service = createWarehouseMediaService(client, {
    configured: true,
    randomUuid: () => objectId,
    compressPhoto: async () => new Blob([new Uint8Array(256)], { type: 'image/jpeg' }),
  })
  await assertServiceError(
    () => service.uploadVariantPhoto({
      variantId,
      file: { name: 'photo.jpg', type: 'image/jpeg', size: 1024 },
    }),
    'WAREHOUSE_PHOTO_ORPHAN_CLEANUP_FAILED',
  )
})

test('reorder accepts one exact variant-owned permutation and delegates atomically to the RPC', async () => {
  const secondId = '73000000-0000-4000-8000-000000000004'
  const reordered = [
    { ...photoRow, id: secondId, sortOrder: 0 },
    { ...photoRow, id: photoId, sortOrder: 1 },
  ]
  const { client, calls } = createClient({
    rpcHandler(name, args) {
      assert.equal(name, 'reorder_warehouse_variant_photos_secure')
      assert.deepEqual(args, { p_variant_id: variantId, p_photo_ids: [secondId, photoId] })
      return { data: reordered, error: null, status: 200 }
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })
  assert.deepEqual(await service.reorderVariantPhotos(variantId, [secondId, photoId]), reordered)
  assert.equal(calls.some((call) => call[0] === 'from'), false)

  await assertServiceError(
    () => service.reorderVariantPhotos(variantId, [photoId, photoId]),
    'WAREHOUSE_PHOTO_INPUT_INVALID',
  )
})

test('delete removes the exact private object before deleting matching metadata', async () => {
  const { client, calls } = createClient({
    rpcHandler(name, args) {
      assert.equal(name, 'delete_warehouse_variant_photo_secure')
      assert.deepEqual(args, {
        p_variant_id: variantId,
        p_photo_id: photoId,
        p_object_path: objectPath,
      })
      return { data: true, error: null, status: 200 }
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })
  assert.equal(await service.deleteVariantPhoto(photoRow), true)
  const removeIndex = calls.findIndex((call) => call[0] === 'remove')
  const deleteIndex = calls.findIndex((call) => call[0] === 'rpc')
  assert.deepEqual(calls[removeIndex], ['remove', [objectPath]])
  assert.equal(removeIndex < deleteIndex, true)
})

test('Storage delete failure leaves metadata untouched for a safe retry', async () => {
  const { client, calls } = createClient({
    bucketOverrides: {
      async remove() { return { data: null, error: { message: 'provider detail' } } },
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })
  await assertServiceError(
    () => service.deleteVariantPhoto(photoRow),
    'WAREHOUSE_PHOTO_DELETE_FAILED',
  )
  assert.equal(calls.some((call) => call[0] === 'rpc'), false)
})

test('service rejects malformed responses, cross-variant paths and unconfigured access', async () => {
  for (const data of [
    [{ ...photoRow, objectPath: `73000000-0000-4000-8000-000000000099/${objectId}.jpg` }],
    [{ ...photoRow, mimeType: 'image/png' }],
    [{ ...photoRow, extra: 'field' }],
  ]) {
    const { client } = createClient({
      rpcHandler() { return { data, error: null, status: 200 } },
    })
    const service = createWarehouseMediaService(client, { configured: true })
    await assertServiceError(
      () => service.listVariantPhotos(variantId),
      'WAREHOUSE_PHOTO_INVALID_RESPONSE',
    )
  }
  const service = createWarehouseMediaService(null, { configured: false })
  await assertServiceError(
    () => service.listVariantPhotos(variantId),
    'WAREHOUSE_PHOTO_NOT_CONFIGURED',
  )
})

test('warehouse photo transport contains no public URL, base64, local persistence or generic record fallback', () => {
  assert.doesNotMatch(
    source,
    /getPublicUrl|readAsDataURL|toDataURL|base64|localStorage|sessionStorage|indexedDB|baseRecordService|console\./iu,
  )
})

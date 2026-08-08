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
const deletionId = '73000000-0000-4000-8000-000000000006'
const claimedDeletionId = '73000000-0000-4000-8000-000000000007'
const deleteTicket = Object.freeze({
  deletionId,
  kind: 'registered',
  photoId,
  variantId,
  objectPath,
  storageDeleted: false,
})
const pendingCandidate = Object.freeze({
  deletionId,
  kind: 'registered',
  createdAt,
  originalRequesterLabel: '仓库管理员',
})
const source = await readFile(new URL('./warehouseMediaService.js', import.meta.url), 'utf8').catch(() => '')

function rpcResult(data, overrides = {}) {
  return {
    data,
    error: null,
    count: null,
    status: 200,
    statusText: 'OK',
    ...overrides,
  }
}

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
      return rpcResult([photoRow, second])
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
        throw new Error('upload must not list photos')
      }
      assert.equal(name, 'register_warehouse_variant_photo_secure')
      assert.deepEqual(args, {
        p_variant_id: variantId,
        p_object_path: objectPath,
        p_mime_type: 'image/jpeg',
        p_byte_size: 256,
      })
      return rpcResult(photoRow)
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

test('trusted registration rejects a ninth photo after upload and orphan cleanup completes', async () => {
  let compressed = false
  const { client, calls } = createClient({
    rpcHandler(name) {
      if (name === 'register_warehouse_variant_photo_secure') {
        return rpcResult(null, {
          error: { code: '55000', hint: 'WAREHOUSE_PHOTO_LIMIT_REACHED' },
          status: 500,
          statusText: 'Internal Server Error',
        })
      }
      if (name === 'begin_warehouse_photo_orphan_delete_secure') {
        return rpcResult({ ...deleteTicket, kind: 'orphan', photoId: null })
      }
      if (name === 'finalize_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
  })
  const service = createWarehouseMediaService(client, {
    configured: true,
    randomUuid: () => objectId,
    compressPhoto: async () => {
      compressed = true
      return new Blob([new Uint8Array(256)], { type: 'image/jpeg' })
    },
  })
  await assertServiceError(
    () => service.uploadVariantPhoto({
      variantId,
      file: { name: 'photo.jpg', type: 'image/jpeg', size: 1 },
    }),
    'WAREHOUSE_PHOTO_LIMIT_REACHED',
  )
  assert.equal(compressed, true)
  assert.deepEqual(calls.find((call) => call[0] === 'remove'), ['remove', [objectPath]])
})

test('registration failure removes the just-uploaded orphan before returning a safe error', async () => {
  const { client, calls } = createClient({
    rpcHandler(name) {
      if (name === 'register_warehouse_variant_photo_secure') {
        return rpcResult(null, {
          error: { code: 'PGRST999', message: 'sensitive provider detail' },
          status: 500,
          statusText: 'Internal Server Error',
        })
      }
      if (name === 'begin_warehouse_photo_orphan_delete_secure') {
        return rpcResult({ ...deleteTicket, kind: 'orphan', photoId: null })
      }
      if (name === 'finalize_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
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
      if (name === 'register_warehouse_variant_photo_secure') {
        return rpcResult(null, {
          error: { code: 'PGRST999', message: 'secret' },
          status: 500,
          statusText: 'Internal Server Error',
        })
      }
      if (name === 'begin_warehouse_photo_orphan_delete_secure') {
        return rpcResult({ ...deleteTicket, kind: 'orphan', photoId: null })
      }
      if (name === 'cancel_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
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
      return rpcResult(reordered)
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
      if (name === 'begin_warehouse_variant_photo_delete_secure') return rpcResult(deleteTicket)
      assert.equal(name, 'finalize_warehouse_photo_delete_secure')
      return rpcResult(true)
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })
  assert.equal(await service.deleteVariantPhoto(photoRow), true)
  const beginIndex = calls.findIndex((call) =>
    call[0] === 'rpc' && call[1] === 'begin_warehouse_variant_photo_delete_secure')
  const removeIndex = calls.findIndex((call) => call[0] === 'remove')
  const deleteIndex = calls.findIndex((call) =>
    call[0] === 'rpc' && call[1] === 'finalize_warehouse_photo_delete_secure')
  assert.deepEqual(calls[removeIndex], ['remove', [objectPath]])
  assert.equal(beginIndex < removeIndex && removeIndex < deleteIndex, true)
})

test('Storage delete failure leaves metadata untouched for a safe retry', async () => {
  const { client, calls } = createClient({
    rpcHandler(name) {
      if (name === 'begin_warehouse_variant_photo_delete_secure') return rpcResult(deleteTicket)
      if (name === 'cancel_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
    bucketOverrides: {
      async remove() { return { data: null, error: { message: 'provider detail' } } },
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })
  await assertServiceError(
    () => service.deleteVariantPhoto(photoRow),
    'WAREHOUSE_PHOTO_DELETE_FAILED',
  )
  assert.equal(calls.some((call) =>
    call[0] === 'rpc' && call[1] === 'finalize_warehouse_photo_delete_secure'), false)
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

test('upload relies on the linearized register RPC and does not require inventory list permission', async () => {
  const compressed = new Blob([new Uint8Array(256)], { type: 'image/jpeg' })
  const { client, calls } = createClient({
    rpcHandler(name, args) {
      assert.equal(name, 'register_warehouse_variant_photo_secure')
      assert.deepEqual(args, {
        p_variant_id: variantId,
        p_object_path: objectPath,
        p_mime_type: 'image/jpeg',
        p_byte_size: 256,
      })
      return rpcResult(photoRow)
    },
  })
  const service = createWarehouseMediaService(client, {
    configured: true,
    randomUuid: () => objectId,
    compressPhoto: async () => compressed,
  })

  assert.deepEqual(await service.uploadVariantPhoto({
    variantId,
    file: { name: 'photo.jpg', type: 'image/jpeg', size: 1024 },
  }), photoRow)
  assert.equal(calls.some((call) =>
    call[0] === 'rpc' && call[1] === 'list_warehouse_variant_photos_secure'), false)
})

test('photo list rejects sparse and accessor arrays without invoking supplier getters', async () => {
  const sparse = new Array(1)
  const sparseClient = createClient({
    rpcHandler() { return rpcResult(sparse) },
  }).client
  await assertServiceError(
    () => createWarehouseMediaService(sparseClient, { configured: true })
      .listVariantPhotos(variantId),
    'WAREHOUSE_PHOTO_INVALID_RESPONSE',
  )

  let getterCalled = false
  const accessor = []
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() { getterCalled = true; throw new Error('supplier getter ran') },
  })
  accessor.length = 1
  const accessorClient = createClient({
    rpcHandler() { return rpcResult(accessor) },
  }).client
  await assertServiceError(
    () => createWarehouseMediaService(accessorClient, { configured: true })
      .listVariantPhotos(variantId),
    'WAREHOUSE_PHOTO_INVALID_RESPONSE',
  )
  assert.equal(getterCalled, false)
})

test('RPC envelopes require every exact field and error null', async () => {
  for (const response of [
    {},
    undefined,
    { data: [], count: null, status: 200, statusText: 'OK' },
    rpcResult([], { extra: true }),
    rpcResult([], { error: false }),
  ]) {
    const { client } = createClient({ rpcHandler() { return response } })
    await assertServiceError(
      () => createWarehouseMediaService(client, { configured: true })
        .listVariantPhotos(variantId),
      'WAREHOUSE_PHOTO_INVALID_RESPONSE',
    )
  }
})

test('registered delete begins a bound ticket, removes its server path, then finalizes', async () => {
  const forgedLocalPath = `${variantId}/73000000-0000-4000-8000-000000000099.jpg`
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      if (name === 'begin_warehouse_variant_photo_delete_secure') {
        return rpcResult(deleteTicket)
      }
      if (name === 'finalize_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
    storage: {
      from(name) {
        calls.push(['from', name])
        return {
          async remove(paths) {
            calls.push(['remove', paths])
            return { data: [{ name: objectPath }], error: null }
          },
        }
      },
    },
  }
  const service = createWarehouseMediaService(client, { configured: true })

  assert.equal(await service.deleteVariantPhoto({ ...photoRow, objectPath: forgedLocalPath }), true)
  assert.deepEqual(calls.filter((call) => call[0] !== 'from'), [
    ['rpc', 'begin_warehouse_variant_photo_delete_secure', {
      p_variant_id: variantId,
      p_photo_id: photoId,
    }],
    ['remove', [objectPath]],
    ['rpc', 'finalize_warehouse_photo_delete_secure', {
      p_deletion_id: deletionId,
      p_variant_id: variantId,
      p_photo_id: photoId,
    }],
  ])
})

test('registered delete cancels its ticket when Storage fails', async () => {
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      if (name === 'begin_warehouse_variant_photo_delete_secure') return rpcResult(deleteTicket)
      if (name === 'cancel_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
    storage: {
      from() {
        return {
          async remove(paths) {
            calls.push(['remove', paths])
            return { data: null, error: { message: 'provider detail' } }
          },
        }
      },
    },
  }
  const service = createWarehouseMediaService(client, { configured: true })

  await assertServiceError(
    () => service.deleteVariantPhoto(photoRow),
    'WAREHOUSE_PHOTO_DELETE_FAILED',
  )
  assert.deepEqual(calls.at(-1), ['rpc', 'cancel_warehouse_photo_delete_secure', {
    p_deletion_id: deletionId,
    p_variant_id: variantId,
    p_photo_id: photoId,
  }])
})

test('finalize retry reuses a pending ticket and skips an already deleted Storage object', async () => {
  let beginCount = 0
  let finalizeCount = 0
  let removeCount = 0
  const client = {
    async rpc(name) {
      if (name === 'begin_warehouse_variant_photo_delete_secure') {
        beginCount += 1
        return rpcResult({ ...deleteTicket, storageDeleted: beginCount > 1 })
      }
      if (name === 'finalize_warehouse_photo_delete_secure') {
        finalizeCount += 1
        if (finalizeCount === 1) return rpcResult(null, {
          error: { code: 'XX000', message: 'transient finalize failure' },
          status: 500,
          statusText: 'Internal Server Error',
        })
        return rpcResult(true)
      }
      throw new Error(`unexpected RPC ${name}`)
    },
    storage: {
      from() {
        return {
          async remove() {
            removeCount += 1
            return { data: [{ name: objectPath }], error: null }
          },
        }
      },
    },
  }
  const service = createWarehouseMediaService(client, { configured: true })

  await assertServiceError(
    () => service.deleteVariantPhoto(photoRow),
    'WAREHOUSE_PHOTO_SERVICE_UNAVAILABLE',
  )
  assert.equal(await service.deleteVariantPhoto(photoRow), true)
  assert.equal(removeCount, 1)
  assert.equal(beginCount, 2)
  assert.equal(finalizeCount, 2)
})

test('Storage remove requires an exact envelope with one dense matching target', async () => {
  const malformed = [
    {},
    undefined,
    { data: [], error: null },
    { data: [{ name: `${variantId}/73000000-0000-4000-8000-000000000098.jpg` }], error: null },
    { data: [{ name: objectPath }, { name: objectPath }], error: null },
    { data: [{ name: objectPath }], error: null, extra: true },
    { data: new Array(1), error: null },
  ]
  for (const response of malformed) {
    const { client } = createClient({
      rpcHandler(name) {
        if (name === 'begin_warehouse_variant_photo_delete_secure') return rpcResult(deleteTicket)
        if (name === 'cancel_warehouse_photo_delete_secure') return rpcResult(true)
        throw new Error(`unexpected RPC ${name}`)
      },
      bucketOverrides: { async remove() { return response } },
    })
    await assertServiceError(
      () => createWarehouseMediaService(client, { configured: true }).deleteVariantPhoto(photoRow),
      'WAREHOUSE_PHOTO_DELETE_FAILED',
    )
  }

  let getterCalled = false
  const row = {}
  Object.defineProperty(row, 'name', {
    enumerable: true,
    get() { getterCalled = true; throw new Error('supplier getter ran') },
  })
  const { client } = createClient({
    rpcHandler(name) {
      if (name === 'begin_warehouse_variant_photo_delete_secure') return rpcResult(deleteTicket)
      if (name === 'cancel_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
    bucketOverrides: { async remove() { return { data: [row], error: null } } },
  })
  await assertServiceError(
    () => createWarehouseMediaService(client, { configured: true }).deleteVariantPhoto(photoRow),
    'WAREHOUSE_PHOTO_DELETE_FAILED',
  )
  assert.equal(getterCalled, false)
})

test('ambiguous Storage removal never cancels the recoverable pending ticket', async () => {
  for (const remove of [
    async () => { throw new Error('network outcome unknown') },
    async () => ({}),
    async () => ({ data: [], error: null }),
  ]) {
    const calls = []
    const { client } = createClient({
      rpcHandler(name) {
        calls.push(name)
        if (name === 'begin_warehouse_variant_photo_delete_secure') return rpcResult(deleteTicket)
        if (name === 'cancel_warehouse_photo_delete_secure') return rpcResult(true)
        throw new Error(`unexpected RPC ${name}`)
      },
      bucketOverrides: { remove },
    })
    await assertServiceError(
      () => createWarehouseMediaService(client, { configured: true }).deleteVariantPhoto(photoRow),
      'WAREHOUSE_PHOTO_DELETE_FAILED',
    )
    assert.equal(calls.includes('cancel_warehouse_photo_delete_secure'), false)
  }
})

test('pending deletion candidates expose only the exact sanitized recovery fields', async () => {
  const { client, calls } = createClient({
    rpcHandler(name, args) {
      assert.equal(name, 'list_warehouse_photo_delete_candidates_secure')
      assert.equal(args, undefined)
      return rpcResult([pendingCandidate])
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })

  assert.deepEqual(await service.listPendingPhotoDeletes(), [pendingCandidate])
  assert.deepEqual(calls[0], ['rpc', 'list_warehouse_photo_delete_candidates_secure', undefined])
})

test('pending deletion candidates reject metadata and identity predicate leaks', async () => {
  for (const leakedField of [
    ['objectPath', objectPath],
    ['photoId', photoId],
    ['variantId', variantId],
    ['employeeNumber', 'SW-042'],
    ['employeeProfileId', '73000000-0000-4000-8000-000000000099'],
    ['authUserId', '73000000-0000-4000-8000-000000000098'],
    ['requesterActive', true],
    ['requesterCanManage', false],
    ['eligibleReason', 'requester_unavailable'],
  ]) {
    const { client } = createClient({
      rpcHandler() { return rpcResult([{ ...pendingCandidate, [leakedField[0]]: leakedField[1] }]) },
    })
    await assertServiceError(
      () => createWarehouseMediaService(client, { configured: true })
        .listPendingPhotoDeletes(),
      'WAREHOUSE_PHOTO_INVALID_RESPONSE',
    )
  }
})

test('recovery claims by deletion id only and resumes registered finalization after refresh', async () => {
  const calls = []
  const { client } = createClient({
    rpcHandler(name, args) {
      calls.push(['handled', name, args])
      if (name === 'claim_warehouse_photo_delete_secure') {
        assert.deepEqual(args, { p_deletion_id: deletionId })
        return rpcResult({ ...deleteTicket, deletionId: claimedDeletionId, storageDeleted: true })
      }
      if (name === 'finalize_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })

  assert.equal(await service.recoverPendingPhotoDelete(deletionId), true)
  assert.equal(calls.some((call) => call[1] === 'claim_warehouse_photo_delete_secure'), true)
})

test('orphan recovery needs no list or sign call and deletes the claimed server path', async () => {
  const orphanTicket = {
    ...deleteTicket,
    deletionId: claimedDeletionId,
    kind: 'orphan',
    photoId: null,
  }
  const { client, calls } = createClient({
    rpcHandler(name, args) {
      if (name === 'claim_warehouse_photo_delete_secure') {
        assert.deepEqual(args, { p_deletion_id: deletionId })
        return rpcResult(orphanTicket)
      }
      if (name === 'finalize_warehouse_photo_delete_secure') return rpcResult(true)
      throw new Error(`unexpected RPC ${name}`)
    },
  })
  const service = createWarehouseMediaService(client, { configured: true })

  assert.equal(await service.recoverPendingPhotoDelete(deletionId), true)
  assert.deepEqual(calls.find((call) => call[0] === 'remove'), ['remove', [objectPath]])
  assert.equal(calls.some((call) => call[0] === 'signed'), false)
  assert.equal(calls.some((call) => call[1] === 'list_warehouse_photo_delete_candidates_secure'), false)
})

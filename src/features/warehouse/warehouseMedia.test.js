import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  MAX_WAREHOUSE_PHOTO_BYTES,
  MAX_WAREHOUSE_PHOTO_EDGE,
  MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES,
  WarehouseMediaError,
  buildWarehousePhotoObjectPath,
  compressWarehousePhoto,
  validateWarehousePhotoFile,
} from './warehouseMedia.js'

const variantId = '73000000-0000-4000-8000-000000000001'
const objectId = '73000000-0000-4000-8000-000000000002'
const source = await readFile(new URL('./warehouseMedia.js', import.meta.url), 'utf8').catch(() => '')

function photo(name, type, size) {
  return { name, type, size }
}

function assertMediaError(operation, code) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof WarehouseMediaError, true)
    assert.equal(error.code, code)
    return true
  })
}

test('warehouse photos accept only matching JPEG, PNG and WebP files through 12 MiB', () => {
  for (const [name, mimeType, extension] of [
    ['photo.jpg', 'image/jpeg', 'jpg'],
    ['photo.jpeg', 'image/jpeg', 'jpg'],
    ['photo.png', 'image/png', 'png'],
    ['photo.webp', 'image/webp', 'webp'],
  ]) {
    assert.deepEqual(
      validateWarehousePhotoFile(photo(name, mimeType, MAX_WAREHOUSE_PHOTO_BYTES)),
      { mimeType, byteSize: MAX_WAREHOUSE_PHOTO_BYTES, extension },
    )
  }
})

test('warehouse photos reject invalid MIME, spoofed extensions, empty files and inputs over 12 MiB', () => {
  for (const [candidate, code] of [
    [photo('photo.gif', 'image/gif', 1), 'WAREHOUSE_PHOTO_TYPE_INVALID'],
    [photo('photo.jpg', 'image/png', 1), 'WAREHOUSE_PHOTO_TYPE_INVALID'],
    [photo('photo.jpg', '', 1), 'WAREHOUSE_PHOTO_TYPE_INVALID'],
    [photo('photo.jpg', 'image/jpeg', 0), 'WAREHOUSE_PHOTO_SIZE_INVALID'],
    [photo('photo.jpg', 'image/jpeg', MAX_WAREHOUSE_PHOTO_BYTES + 1), 'WAREHOUSE_PHOTO_SIZE_INVALID'],
  ]) assertMediaError(() => validateWarehousePhotoFile(candidate), code)
})

test('object paths are bound to one variant and one generated UUID with a canonical extension', () => {
  assert.equal(
    buildWarehousePhotoObjectPath({ variantId, objectId, mimeType: 'image/jpeg' }),
    `${variantId}/${objectId}.jpg`,
  )
  assert.equal(
    buildWarehousePhotoObjectPath({ variantId, objectId, mimeType: 'image/png' }),
    `${variantId}/${objectId}.png`,
  )
  for (const input of [
    { variantId: '../other', objectId, mimeType: 'image/jpeg' },
    { variantId, objectId: `${objectId}/other`, mimeType: 'image/jpeg' },
    { variantId, objectId, mimeType: 'image/gif' },
  ]) assertMediaError(
    () => buildWarehousePhotoObjectPath(input),
    'WAREHOUSE_PHOTO_PATH_INVALID',
  )
})

test('compression scales the long edge to 2000 px and returns a blob strictly below 2 MiB', async () => {
  const renders = []
  const file = photo('photo.jpg', 'image/jpeg', 8 * 1024 * 1024)
  const compressed = await compressWarehousePhoto(file, {
    async decode() { return { source: { kind: 'decoded' }, width: 4000, height: 1000 } },
    async render(input) {
      renders.push(input)
      return new Blob([new Uint8Array(256 * 1024)], { type: input.mimeType })
    },
  })
  assert.equal(renders.length, 1)
  assert.deepEqual(
    { width: renders[0].width, height: renders[0].height, mimeType: renders[0].mimeType },
    { width: MAX_WAREHOUSE_PHOTO_EDGE, height: 500, mimeType: 'image/jpeg' },
  )
  assert.equal(compressed.type, 'image/jpeg')
  assert.equal(compressed.size < MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES, true)
})

test('compression retries at smaller dimensions and fails closed if output cannot go below 2 MiB', async () => {
  let attempts = 0
  const adapter = {
    async decode() { return { source: {}, width: 2000, height: 2000 } },
    async render(input) {
      attempts += 1
      const size = attempts < 3 ? MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES : 512 * 1024
      return new Blob([new Uint8Array(size)], { type: input.mimeType })
    },
  }
  const compressed = await compressWarehousePhoto(
    photo('photo.webp', 'image/webp', 4 * 1024 * 1024),
    adapter,
  )
  assert.equal(attempts, 3)
  assert.equal(compressed.size, 512 * 1024)

  await assert.rejects(
    () => compressWarehousePhoto(photo('photo.png', 'image/png', 1024), {
      async decode() { return { source: {}, width: 1, height: 1 } },
      async render(input) {
        return new Blob(
          [new Uint8Array(MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES)],
          { type: input.mimeType },
        )
      },
    }),
    (error) => error instanceof WarehouseMediaError &&
      error.code === 'WAREHOUSE_PHOTO_COMPRESSION_FAILED',
  )
})

test('warehouse media source never persists data URLs or browser storage', () => {
  assert.doesNotMatch(source, /readAsDataURL|toDataURL|getPublicUrl|localStorage|sessionStorage|indexedDB/iu)
})

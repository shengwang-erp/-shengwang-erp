import assert from 'node:assert/strict'
import test from 'node:test'

import {
  exactAttemptedStoragePaths,
  registerAttemptedStoragePath,
} from './warehouse_photo_storage_scope.mjs'

const bucket = 'warehouse-item-photos'
const unknownVariantPath =
  '51000000-0000-4000-8000-000000000001/51000000-0000-4000-8000-000000000002.jpg'
const unlistedPath =
  '51000000-0000-4000-8000-000000000003/51000000-0000-4000-8000-000000000004.jpg'

test('unknown-variant upload path is registered as one exact cleanup pair', () => {
  const scope = {
    allowedStoragePaths: [{ bucket, path: unknownVariantPath }],
    attemptedStoragePaths: [],
  }

  registerAttemptedStoragePath(scope, bucket, unknownVariantPath)
  registerAttemptedStoragePath(scope, bucket, unknownVariantPath)

  assert.deepEqual(exactAttemptedStoragePaths(scope), [
    { bucket, path: unknownVariantPath },
  ])
})

test('attempted Storage path scope rejects cleanup authority outside its exact allowlist', () => {
  const scope = {
    allowedStoragePaths: [{ bucket, path: unknownVariantPath }],
    attemptedStoragePaths: [],
  }

  assert.throws(
    () => registerAttemptedStoragePath(scope, bucket, unlistedPath),
    /not in the run allowlist/u,
  )
  assert.throws(
    () => registerAttemptedStoragePath(scope, 'other-bucket', unknownVariantPath),
    /invalid warehouse photo Storage pair/u,
  )
  assert.deepEqual(exactAttemptedStoragePaths(scope), [])
})

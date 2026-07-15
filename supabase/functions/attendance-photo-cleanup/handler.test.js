import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { createAttendancePhotoCleanupHandler } from './handler.js'

const configSource = await readFile(
  new URL('../../config.toml', import.meta.url),
  'utf8',
).catch(() => '')
const envSource = await readFile(
  new URL('../../../.env.example', import.meta.url),
  'utf8',
).catch(() => '')
const handlerSource = await readFile(
  new URL('./handler.js', import.meta.url),
  'utf8',
).catch(() => '')
const indexSource = await readFile(
  new URL('./index.ts', import.meta.url),
  'utf8',
).catch(() => '')

function request({
  method = 'POST',
  gatewayToken = 'gateway.jwt.token',
  cleanupSecret = 'expected-cleanup-secret',
} = {}) {
  const headers = new Headers()
  if (gatewayToken !== null) {
    headers.set('Authorization', `Bearer ${gatewayToken}`)
  }
  if (cleanupSecret !== null) {
    headers.set('x-attendance-cleanup-secret', cleanupSecret)
  }
  return new Request('https://edge.invalid/attendance-photo-cleanup', {
    method,
    headers,
  })
}

function candidate(suffix = '701', phase = 'before') {
  const employeeId = `62000000-0000-4000-8000-000000000${suffix}`
  const sessionId = `71000000-0000-4000-8000-000000000${suffix}`
  const pointId = `73000000-0000-4000-8000-000000000${suffix}`
  const photoId = `74000000-0000-4000-8000-000000000${suffix}`
  return {
    photoId,
    bucketId: 'erp-attendance-photos',
    objectPath: `${employeeId}/${sessionId}/${pointId}/${photoId}/${phase}`,
  }
}

function assertNoStore(response) {
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(
    response.headers.get('content-type'),
    'application/json; charset=utf-8',
  )
}

test('cleanup deployment uses verified gateway JWTs, a separate server secret and shared admin client', () => {
  assert.match(
    configSource,
    /\[functions\.attendance-photo-cleanup\]\s*verify_jwt\s*=\s*true/i,
  )
  assert.match(envSource, /^ATTENDANCE_CLEANUP_SECRET=$/m)
  assert.doesNotMatch(envSource, /^VITE_.*ATTENDANCE_CLEANUP_SECRET/m)
  assert.match(handlerSource, /\.\.\/_shared\/clients\.ts/)
  assert.doesNotMatch(handlerSource, /npm:@supabase\/supabase-js|SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(indexSource, /createAttendancePhotoCleanupHandler/)
  assert.doesNotMatch(indexSource, /createClient|SUPABASE_(?:SECRET|SERVICE_ROLE)/)
})

test('method, gateway bearer and independent cleanup secret fail before admin creation', async () => {
  let adminCreated = 0
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => {
      adminCreated += 1
      throw new Error('must not run')
    },
  })

  const responses = [
    await handler(request({ gatewayToken: null })),
    await handler(request({ gatewayToken: 'bad token' })),
    await handler(request({ gatewayToken: 'gateway.jwt.token,second' })),
    await handler(request({
      gatewayToken: 'expected-cleanup-secret',
      cleanupSecret: null,
    })),
    await handler(request({ cleanupSecret: 'expected cleanup-secret' })),
    await handler(request({ cleanupSecret: 'wrong-cleanup-secret' })),
  ]
  for (const response of responses) {
    assert.equal(response.status, 401)
    assertNoStore(response)
    assert.deepEqual(await response.json(), { code: 'UNAUTHORIZED' })
  }

  const methodResponse = await handler(request({ method: 'GET' }))
  assert.equal(methodResponse.status, 405)
  assertNoStore(methodResponse)
  assert.deepEqual(await methodResponse.json(), { code: 'METHOD_NOT_ALLOWED' })
  assert.equal(adminCreated, 0)
})

test('blank or non-canonical configured cleanup secrets fail closed before admin creation', async () => {
  for (const cleanupSecret of ['', '   ', ' expected-cleanup-secret ']) {
    let adminCreated = false
    const handler = createAttendancePhotoCleanupHandler({
      cleanupSecret,
      createAdminClient: async () => {
        adminCreated = true
        throw new Error('must not run')
      },
    })
    const response = await handler(request({ cleanupSecret }))
    assert.equal(response.status, 503)
    assertNoStore(response)
    assert.deepEqual(await response.json(), { code: 'CLEANUP_UNAVAILABLE' })
    assert.equal(adminCreated, false)
  }
})

test('successful removal completes only the matching claimed metadata row', async () => {
  const calls = []
  const claimed = candidate('701')
  const admin = {
    async rpc(name, args) {
      calls.push(['rpc', name, args])
      return name === 'claim_attendance_photo_cleanup_secure'
        ? { data: [claimed], error: null }
        : { data: true, error: null }
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            calls.push(['remove', bucket, paths])
            return { data: [{ name: paths[0] }], error: null }
          },
        }
      },
    },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => admin,
  })

  const response = await handler(request())
  assert.equal(response.status, 200)
  assertNoStore(response)
  assert.deepEqual(await response.json(), { claimed: 1, deleted: 1, failed: 0 })
  assert.deepEqual(calls, [
    ['rpc', 'claim_attendance_photo_cleanup_secure', { p_limit: 100 }],
    ['remove', 'erp-attendance-photos', [claimed.objectPath]],
    ['rpc', 'complete_attendance_photo_cleanup_secure', {
      p_photo_id: claimed.photoId,
    }],
  ])
})

test('Storage provider failure is safe and leaves metadata for a later retry', async () => {
  const claimed = candidate('702')
  let removalAttempt = 0
  const completed = []
  const admin = {
    async rpc(name, args) {
      if (name === 'claim_attendance_photo_cleanup_secure') {
        return { data: [claimed], error: null }
      }
      completed.push(args.p_photo_id)
      return { data: true, error: null }
    },
    storage: {
      from() {
        return {
          async remove() {
            removalAttempt += 1
            return removalAttempt === 1
              ? {
                data: null,
                error: {
                  message: `provider leaked ${claimed.objectPath}`,
                  token: 'provider-token',
                },
              }
              : { data: [], error: null }
          },
        }
      },
    },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => admin,
  })

  const first = await handler(request())
  assert.equal(first.status, 200)
  assertNoStore(first)
  const firstText = await first.text()
  assert.deepEqual(JSON.parse(firstText), { claimed: 1, deleted: 0, failed: 1 })
  assert.doesNotMatch(firstText, /provider|object|token|74000000|62000000/i)
  assert.deepEqual(completed, [])

  const second = await handler(request())
  assert.equal(second.status, 200)
  assertNoStore(second)
  assert.deepEqual(await second.json(), { claimed: 1, deleted: 1, failed: 0 })
  assert.deepEqual(completed, [claimed.photoId])
})

test('unverifiable Storage SDK removal responses fail closed without completing metadata', async () => {
  const claimed = candidate('708')
  const removalResponses = [null, {}, { data: null, error: null }, {
    data: { name: claimed.objectPath },
    error: null,
  }, {
    data: [{}],
    error: null,
  }, {
    data: [{ name: 'another/profile/object/path' }],
    error: null,
  }, {
    data: [{ name: claimed.objectPath }, { name: claimed.objectPath }],
    error: null,
  }, {
    data: [claimed.objectPath],
    error: null,
  }]
  let removalIndex = 0
  const completed = []
  const admin = {
    async rpc(name, args) {
      if (name === 'claim_attendance_photo_cleanup_secure') {
        return { data: [claimed], error: null }
      }
      completed.push(args.p_photo_id)
      return { data: true, error: null }
    },
    storage: {
      from() {
        return {
          async remove() {
            const response = removalResponses[removalIndex]
            removalIndex += 1
            return response
          },
        }
      },
    },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => admin,
  })

  for (const ignored of removalResponses) {
    const response = await handler(request())
    assert.equal(response.status, 200)
    assertNoStore(response)
    assert.deepEqual(await response.json(), { claimed: 1, deleted: 0, failed: 1 })
  }
  assert.deepEqual(completed, [])
})

test('malformed UUID, bucket, canonical path, photo binding or extra fields never reach Storage', async () => {
  const valid = candidate('703')
  const uppercase = candidate('abc')
  const malformed = [
    null,
    { ...valid, photoId: 'not-a-uuid' },
    { ...valid, bucketId: 'other-bucket' },
    { ...valid, objectPath: `${valid.objectPath}/extra` },
    {
      ...valid,
      objectPath: valid.objectPath.replace(valid.photoId, candidate('704').photoId),
    },
    { ...valid, objectPath: valid.objectPath.replace(/before$/, 'during') },
    {
      ...uppercase,
      photoId: uppercase.photoId.toUpperCase(),
      objectPath: uppercase.objectPath.toUpperCase().replace(/BEFORE$/, 'before'),
    },
    { ...valid, providerMetadata: { secret: true } },
  ]
  let storageCalls = 0
  const admin = {
    async rpc(name) {
      return name === 'claim_attendance_photo_cleanup_secure'
        ? { data: malformed, error: null }
        : { data: true, error: null }
    },
    storage: {
      from() {
        storageCalls += 1
        return { async remove() { return { data: [], error: null } } }
      },
    },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => admin,
  })

  const response = await handler(request())
  assert.equal(response.status, 200)
  assertNoStore(response)
  assert.deepEqual(await response.json(), {
    claimed: malformed.length,
    deleted: 0,
    failed: malformed.length,
  })
  assert.equal(storageCalls, 0)
})

test('completion refusal is counted as failed without exposing the candidate', async () => {
  const claimed = candidate('705', 'after')
  const admin = {
    async rpc(name) {
      return name === 'claim_attendance_photo_cleanup_secure'
        ? { data: [claimed], error: null }
        : { data: false, error: null }
    },
    storage: {
      from() {
        return { async remove() { return { data: [], error: null } } }
      },
    },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => admin,
  })

  const response = await handler(request())
  assertNoStore(response)
  const text = await response.text()
  assert.deepEqual(JSON.parse(text), { claimed: 1, deleted: 0, failed: 1 })
  assert.doesNotMatch(text, /74000000|objectPath|erp-attendance-photos/)
})

test('completion error and throw retain metadata logically and do not stop later candidates', async () => {
  const claimed = [candidate('709'), candidate('710'), candidate('711')]
  const completions = []
  const admin = {
    async rpc(name, args) {
      if (name === 'claim_attendance_photo_cleanup_secure') {
        return { data: claimed, error: null }
      }
      completions.push(args.p_photo_id)
      if (args.p_photo_id === claimed[0].photoId) {
        return { data: null, error: { message: 'database detail' } }
      }
      if (args.p_photo_id === claimed[1].photoId) {
        throw new Error('database throw detail')
      }
      return { data: true, error: null }
    },
    storage: {
      from() {
        return { async remove() { return { data: [], error: null } } }
      },
    },
  }
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    createAdminClient: async () => admin,
  })

  const response = await handler(request())
  assert.equal(response.status, 200)
  assertNoStore(response)
  const text = await response.text()
  assert.deepEqual(JSON.parse(text), { claimed: 3, deleted: 1, failed: 2 })
  assert.doesNotMatch(text, /database|74000000|objectPath/i)
  assert.deepEqual(completions, claimed.map(({ photoId }) => photoId))
})

test('admin, claim and thrown provider failures return only a safe unavailable response', async () => {
  const claimed = candidate('706')
  const handlers = [
    createAttendancePhotoCleanupHandler({
      cleanupSecret: 'expected-cleanup-secret',
      createAdminClient: async () => {
        throw new Error('service key leaked')
      },
    }),
    createAttendancePhotoCleanupHandler({
      cleanupSecret: 'expected-cleanup-secret',
      createAdminClient: async () => ({
        async rpc() {
          return { data: null, error: { message: 'database provider detail' } }
        },
      }),
    }),
    createAttendancePhotoCleanupHandler({
      cleanupSecret: 'expected-cleanup-secret',
      createAdminClient: async () => ({
        async rpc(name) {
          return name === 'claim_attendance_photo_cleanup_secure'
            ? { data: [claimed], error: null }
            : { data: true, error: null }
        },
        storage: {
          from() {
            return { async remove() { throw new Error('storage provider detail') } }
          },
        },
      }),
    }),
  ]

  for (const [index, handler] of handlers.entries()) {
    const response = await handler(request())
    assertNoStore(response)
    if (index < 2) {
      assert.equal(response.status, 503)
      assert.deepEqual(await response.json(), { code: 'CLEANUP_UNAVAILABLE' })
    } else {
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { claimed: 1, deleted: 0, failed: 1 })
    }
  }
})

test('invalid cleanup limits fail closed before creating an admin client', async () => {
  for (const claimLimit of [0, 501, null, 1.5]) {
    let adminCreated = false
    const handler = createAttendancePhotoCleanupHandler({
      cleanupSecret: 'expected-cleanup-secret',
      claimLimit,
      createAdminClient: async () => {
        adminCreated = true
        throw new Error('must not run')
      },
    })
    const response = await handler(request())
    assert.equal(response.status, 503)
    assertNoStore(response)
    assert.deepEqual(await response.json(), { code: 'CLEANUP_UNAVAILABLE' })
    assert.equal(adminCreated, false)
  }
})

test('a claim response larger than the configured limit fails closed before Storage', async () => {
  let storageCalls = 0
  const handler = createAttendancePhotoCleanupHandler({
    cleanupSecret: 'expected-cleanup-secret',
    claimLimit: 1,
    createAdminClient: async () => ({
      async rpc() {
        return { data: [candidate('712'), candidate('713')], error: null }
      },
      storage: {
        from() {
          storageCalls += 1
          return { async remove() { return { data: [], error: null } } }
        },
      },
    }),
  })

  const response = await handler(request())
  assert.equal(response.status, 503)
  assertNoStore(response)
  assert.deepEqual(await response.json(), { code: 'CLEANUP_UNAVAILABLE' })
  assert.equal(storageCalls, 0)
})

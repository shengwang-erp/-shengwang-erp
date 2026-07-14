import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'

import {
  createEmployeeLoginHandler,
  createPublicAuthClient,
  deriveSourceFingerprint,
} from './handler.js'

const VALID_PASSWORD = 'ExistingPasswordValue'
const INTERNAL_ALIAS = 'opaque-internal-identity@auth.invalid'
const SERVICE_ROLE_VALUE = 'server-service-role-value'
const ACTIVE_PROFILE = Object.freeze({
  id: 'employee-profile-1',
  employee_number: 'SW-001',
  auth_user_id: 'auth-user-1',
  employment_status: '在职',
  account_status: 'active',
  must_change_password: true,
  deleted_at: null,
})
const SESSION = Object.freeze({
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
  expires_at: 1_800_000_000,
  expires_in: 3600,
  token_type: 'bearer',
  user: {
    id: 'auth-user-1',
    email: INTERNAL_ALIAS,
    phone: 'not-for-browser',
  },
})

function jsonRequest(body, init = {}) {
  return new Request('https://edge.example.test/employee-login', {
    method: 'POST',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.9',
      ...(init.headers || {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function createDependencies(overrides = {}) {
  const calls = {
    order: [],
    createAdminClient: 0,
    createPublicAuthClient: 0,
    deriveSourceFingerprint: [],
    beginLoginAttempt: [],
    findEmployeeByNumber: [],
    deriveAuthEmail: [],
    signInWithPassword: [],
    finalizeLoginFailure: [],
    completeLoginSuccess: [],
    cancelLoginAttempt: [],
  }
  const adminClient = { kind: 'admin', secret: SERVICE_ROLE_VALUE }
  const publicClient = {
    kind: 'public',
    auth: {
      signInWithPassword: async (credentials) => {
        calls.order.push('sign-in')
        calls.signInWithPassword.push(credentials)
        return { data: { session: SESSION }, error: null }
      },
    },
  }
  const dependencies = {
    createAdminClient: async () => {
      calls.order.push('admin-client')
      calls.createAdminClient += 1
      return adminClient
    },
    createPublicAuthClient: async () => {
      calls.order.push('public-client')
      calls.createPublicAuthClient += 1
      return publicClient
    },
    deriveSourceFingerprint: async (request) => {
      calls.order.push('fingerprint')
      calls.deriveSourceFingerprint.push(request)
      return 'source-fingerprint'
    },
    beginLoginAttempt: async (client, key) => {
      calls.order.push('begin-attempt')
      calls.beginLoginAttempt.push({ client, key })
      return {
        allowed: true,
        attemptId: 'attempt-1',
        locked: false,
        failureCount: 1,
        lockedUntil: null,
      }
    },
    findEmployeeByNumber: async (client, employeeNumber) => {
      calls.order.push('profile')
      calls.findEmployeeByNumber.push({ client, employeeNumber })
      return ACTIVE_PROFILE
    },
    deriveAuthEmail: async (employeeNumber) => {
      calls.order.push('derive-alias')
      calls.deriveAuthEmail.push(employeeNumber)
      return INTERNAL_ALIAS
    },
    finalizeLoginFailure: async (client, failure) => {
      calls.order.push('finalize-failure')
      calls.finalizeLoginFailure.push({ client, failure })
      return { locked: false, failureCount: 1, lockedUntil: null }
    },
    completeLoginSuccess: async (client, attempt) => {
      calls.order.push('complete-success')
      calls.completeLoginSuccess.push({ client, attempt })
    },
    cancelLoginAttempt: async (client, attempt) => {
      calls.order.push('cancel-attempt')
      calls.cancelLoginAttempt.push({ client, attempt })
    },
    ...overrides,
  }
  return { calls, dependencies, adminClient, publicClient }
}

async function responseBody(response) {
  return JSON.parse(await response.text())
}

test('successful login normalizes the number, prechecks state, and returns session fields only', async () => {
  const { calls, dependencies, adminClient } = createDependencies()
  const handler = createEmployeeLoginHandler(dependencies)

  const response = await handler(
    jsonRequest({ employeeNumber: ' sw-001 ', password: VALID_PASSWORD }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await responseBody(response), {
    access_token: SESSION.access_token,
    refresh_token: SESSION.refresh_token,
    expires_at: SESSION.expires_at,
    expires_in: SESSION.expires_in,
  })
  assert.deepEqual(calls.findEmployeeByNumber, [
    { client: adminClient, employeeNumber: 'SW-001' },
  ])
  assert.deepEqual(calls.deriveAuthEmail, ['SW-001'])
  assert.deepEqual(calls.signInWithPassword, [
    { email: INTERNAL_ALIAS, password: VALID_PASSWORD },
  ])
  assert.deepEqual(calls.completeLoginSuccess, [
    {
      client: adminClient,
      attempt: {
        attemptId: 'attempt-1',
        employeeNumber: 'SW-001',
        sourceFingerprint: 'source-fingerprint',
      },
    },
  ])
  assert.deepEqual(calls.order, [
    'fingerprint',
    'admin-client',
    'begin-attempt',
    'profile',
    'derive-alias',
    'public-client',
    'sign-in',
    'complete-success',
  ])
  assert.equal(ACTIVE_PROFILE.must_change_password, true)
})

test('successful Auth must match the prechecked profile link before tokens are returned', async () => {
  const { calls, dependencies } = createDependencies({
    createPublicAuthClient: async () => ({
      auth: {
        signInWithPassword: async () => ({
          data: {
            user: { id: 'different-auth-user', email: INTERNAL_ALIAS },
            session: {
              ...SESSION,
              user: { id: 'different-auth-user', email: INTERNAL_ALIAS },
            },
          },
          error: null,
        }),
      },
    }),
  })

  const response = await createEmployeeLoginHandler(dependencies)(
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 403)
  assert.equal(JSON.parse(text).error.code, 'AUTH_IDENTITY_MISMATCH')
  assert.equal(calls.completeLoginSuccess.length, 0)
  assert.doesNotMatch(text, /different-auth-user|auth\.invalid|access-token|refresh-token/i)
})

test('production completion and cancellation adapters require an exact true RPC result', async () => {
  const handlerModule = await import('./handler.js')
  assert.equal(typeof handlerModule.completeLoginSuccessRpc, 'function')
  assert.equal(typeof handlerModule.cancelLoginAttemptRpc, 'function')

  const adminClient = {
    rpc: async () => ({ data: false, error: null }),
  }
  const attempt = {
    attemptId: 1,
    employeeNumber: 'SW-001',
    sourceFingerprint: 'source-fingerprint',
  }

  await assert.rejects(
    handlerModule.completeLoginSuccessRpc(adminClient, attempt),
    (error) => error?.code === 'AUTH_SERVICE_UNAVAILABLE' && error?.status === 503,
  )
  await assert.rejects(
    handlerModule.cancelLoginAttemptRpc(adminClient, attempt),
    (error) => error?.code === 'AUTH_SERVICE_UNAVAILABLE' && error?.status === 503,
  )
})

test('a false success-finalization result never releases an authenticated session', async () => {
  const { dependencies, adminClient } = createDependencies()
  delete dependencies.completeLoginSuccess
  delete dependencies.cancelLoginAttempt
  const rpcCalls = []
  adminClient.rpc = async (name) => {
    rpcCalls.push(name)
    if (name === 'complete_employee_login_success') {
      return { data: false, error: null }
    }
    if (name === 'cancel_employee_login_attempt') {
      return { data: true, error: null }
    }
    throw new Error(`unexpected RPC ${name}`)
  }

  const response = await createEmployeeLoginHandler(dependencies)(
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'AUTH_SERVICE_UNAVAILABLE')
  assert.deepEqual(rpcCalls, [
    'complete_employee_login_success',
    'cancel_employee_login_attempt',
  ])
  assert.doesNotMatch(text, /access-token-value|refresh-token-value/i)
})

test('public Auth client uses only a publishable key and never falls back to service role', async () => {
  const calls = []
  const publicClient = { kind: 'public-auth' }
  const client = await createPublicAuthClient({
    getEnv: (name) =>
      ({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_VALUE,
      })[name],
    createClient: (...args) => {
      calls.push(args)
      return publicClient
    },
  })

  assert.equal(client, publicClient)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'https://project.supabase.co')
  assert.equal(calls[0][1], 'publishable-key')
  assert.notEqual(calls[0][1], SERVICE_ROLE_VALUE)
  assert.equal(calls[0][2]?.global?.headers?.Authorization, undefined)
  assert.deepEqual(calls[0][2]?.auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  })

  await assert.rejects(
    createPublicAuthClient({
      getEnv: (name) =>
        ({
          SUPABASE_URL: 'https://project.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_VALUE,
        })[name],
      createClient: () => assert.fail('must not initialize without a public key'),
    }),
    (error) => error?.code === 'CONFIGURATION_ERROR' && error?.status === 500,
  )

  const namedCalls = []
  await createPublicAuthClient({
    getEnv: (name) =>
      ({
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ browser: 'named-publishable-key' }),
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_VALUE,
      })[name],
    createClient: (...args) => {
      namedCalls.push(args)
      return { kind: 'named-public-auth' }
    },
  })
  assert.equal(namedCalls[0][1], 'named-publishable-key')
})

test('login rejects unsafe methods, content types, JSON shapes, identity modes, and oversized fields', async () => {
  const invalidRequests = [
    new Request('https://edge.example.test/employee-login', { method: 'GET' }),
    new Request('https://edge.example.test/employee-login', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    }),
    jsonRequest('{not-json'),
    jsonRequest(null),
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD, email: 'x@example.com' }),
    jsonRequest({ employeeNumber: 'SW-001' }),
    jsonRequest({ employeeNumber: 'employee@example.com', password: VALID_PASSWORD }),
    jsonRequest({ employeeNumber: `SW-${'1'.repeat(40)}`, password: VALID_PASSWORD }),
    jsonRequest({ employeeNumber: 'SW-001', password: 'x'.repeat(257) }),
  ]

  for (const request of invalidRequests) {
    const { calls, dependencies } = createDependencies()
    const response = await createEmployeeLoginHandler(dependencies)(request)
    const text = await response.text()

    assert.ok([400, 405, 413, 415].includes(response.status))
    assert.doesNotMatch(text, /employee@example\.com|ExistingPasswordValue|service-role/i)
    assert.equal(calls.createAdminClient, 0)
    assert.equal(calls.createPublicAuthClient, 0)
  }
})

test('source fingerprint uses trusted header priority, HMAC, normalization, and no raw IP', async () => {
  const environment = {
    LOGIN_RATE_LIMIT_SECRET: 'rate-limit-test-secret',
  }
  const dependencies = {
    getEnv: (name) => environment[name],
    cryptoImpl: webcrypto,
  }
  const withAllHeaders = new Request('https://edge.example.test/employee-login', {
    headers: {
      'CF-Connecting-IP': ' 2001:DB8::1 ',
      'X-Forwarded-For': '198.51.100.1, 198.51.100.2',
      'X-Real-IP': '192.0.2.4',
    },
  })
  const withPriorityOnly = new Request('https://edge.example.test/employee-login', {
    headers: { 'CF-Connecting-IP': '2001:db8::1' },
  })
  const withForwarded = new Request('https://edge.example.test/employee-login', {
    headers: { 'X-Forwarded-For': '198.51.100.1, 198.51.100.99' },
  })

  const first = await deriveSourceFingerprint(withAllHeaders, dependencies)
  const same = await deriveSourceFingerprint(withPriorityOnly, dependencies)
  const different = await deriveSourceFingerprint(withForwarded, dependencies)

  assert.equal(first, same)
  assert.notEqual(first, different)
  assert.match(first, /^[A-Za-z0-9_-]{43}$/)
  assert.doesNotMatch(first, /2001|db8|198\.51/iu)
  await assert.rejects(
    deriveSourceFingerprint(withPriorityOnly, {
      getEnv: () => undefined,
      cryptoImpl: webcrypto,
    }),
    (error) => error?.code === 'CONFIGURATION_ERROR' && error?.status === 500,
  )
})

test('source fingerprint fails closed for missing, malformed, or oversized proxy identities', async () => {
  const dependencies = {
    getEnv: (name) => name === 'LOGIN_RATE_LIMIT_SECRET' ? 'rate-limit-test-secret' : undefined,
    cryptoImpl: webcrypto,
  }
  const invalidHeaderSets = [
    {},
    { 'CF-Connecting-IP': 'not-an-ip' },
    { 'CF-Connecting-IP': '203.0.113.999' },
    { 'CF-Connecting-IP': '203.0.113.5:99999' },
    { 'X-Forwarded-For': ', 198.51.100.1' },
    { 'X-Real-IP': 'x'.repeat(129) },
  ]

  for (const headers of invalidHeaderSets) {
    await assert.rejects(
      deriveSourceFingerprint(
        new Request('https://edge.example.test/employee-login', { headers }),
        dependencies,
      ),
      (error) => error?.code === 'SOURCE_IDENTITY_INVALID' && error?.status === 400,
    )
  }
})

test('failures zero through four are attempted and the fifth failure creates a lock', async () => {
  for (let priorFailures = 0; priorFailures < 5; priorFailures += 1) {
    const { calls, dependencies } = createDependencies({
      beginLoginAttempt: async (client, key) => {
        calls.beginLoginAttempt.push({ client, key })
        return {
          allowed: true,
          attemptId: `attempt-${priorFailures + 1}`,
          locked: priorFailures === 4,
          failureCount: priorFailures + 1,
          lockedUntil: priorFailures === 4 ? '2026-07-14T12:15:00.000Z' : null,
        }
      },
      createPublicAuthClient: async () => ({
        auth: {
          signInWithPassword: async (credentials) => {
            calls.signInWithPassword.push(credentials)
            return { data: { session: null }, error: new Error('upstream credential detail') }
          },
        },
      }),
      finalizeLoginFailure: async (client, failure) => {
        calls.finalizeLoginFailure.push({ client, failure })
        const failureCount = priorFailures + 1
        return {
          locked: failureCount >= 5,
          failureCount,
          lockedUntil: failureCount >= 5 ? '2026-07-14T12:15:00.000Z' : null,
        }
      },
    })

    const response = await createEmployeeLoginHandler(dependencies)(
      jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
    )
    const body = await responseBody(response)

    assert.equal(calls.signInWithPassword.length, 1)
    assert.equal(calls.finalizeLoginFailure.length, 1)
    assert.equal(calls.finalizeLoginFailure[0].failure.failureCode, 'INVALID_CREDENTIALS')
    if (priorFailures === 4) {
      assert.equal(response.status, 429)
      assert.equal(body.error.code, 'LOGIN_LOCKED')
    } else {
      assert.equal(response.status, 401)
      assert.deepEqual(body, {
        error: { code: 'LOGIN_FAILED', message: '员工编号或密码错误' },
      })
    }
    assert.doesNotMatch(JSON.stringify(body), /upstream|credential detail|auth\.invalid/i)
  }
})

test('a currently locked request never looks up a profile or calls Supabase Auth', async () => {
  const { calls, dependencies } = createDependencies({
    beginLoginAttempt: async () => ({
      allowed: false,
      attemptId: null,
      locked: true,
      failureCount: 5,
      lockedUntil: '2026-07-14T12:15:00.000Z',
    }),
  })

  const response = await createEmployeeLoginHandler(dependencies)(
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
  )

  assert.equal(response.status, 429)
  assert.equal((await responseBody(response)).error.code, 'LOGIN_LOCKED')
  assert.equal(calls.findEmployeeByNumber.length, 0)
  assert.equal(calls.deriveAuthEmail.length, 0)
  assert.equal(calls.createPublicAuthClient, 0)
  assert.equal(calls.signInWithPassword.length, 0)
})

test('an atomic pending reservation prevents the sixth concurrent request from reaching Auth', async () => {
  let reservationCount = 0
  let authCalls = 0
  const beginCalls = []
  const finalizeCalls = []
  const { dependencies } = createDependencies({
    beginLoginAttempt: async (_client, key) => {
      beginCalls.push(key)
      if (reservationCount >= 5) {
        return { allowed: false, attemptId: null, failureCount: 5, locked: true }
      }
      reservationCount += 1
      return {
        allowed: true,
        attemptId: reservationCount,
        failureCount: reservationCount,
        locked: reservationCount >= 5,
      }
    },
    createPublicAuthClient: async () => ({
      auth: {
        signInWithPassword: async () => {
          authCalls += 1
          await Promise.resolve()
          return { data: { session: null }, error: new Error('wrong password') }
        },
      },
    }),
    finalizeLoginFailure: async (_client, failure) => {
      finalizeCalls.push(failure)
      return {
        locked: failure.attemptId === 5,
        failureCount: failure.attemptId,
      }
    },
  })

  const responses = await Promise.all(
    Array.from({ length: 6 }, () =>
      createEmployeeLoginHandler(dependencies)(
        jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
      )),
  )

  assert.equal(beginCalls.length, 6)
  assert.equal(authCalls, 5)
  assert.equal(finalizeCalls.length, 5)
  assert.equal(responses.filter((response) => response.status === 429).length, 2)
})

test('an expired lock permits Auth and success clears only the current number-source key', async () => {
  const { calls, dependencies, adminClient } = createDependencies({
    beginLoginAttempt: async () => ({
      allowed: true,
      attemptId: 'expired-lock-attempt',
      locked: false,
      failureCount: 0,
      lockedUntil: '2026-07-14T11:59:59.000Z',
    }),
  })

  const response = await createEmployeeLoginHandler(dependencies)(
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(calls.completeLoginSuccess, [
    {
      client: adminClient,
      attempt: {
        attemptId: 'expired-lock-attempt',
        employeeNumber: 'SW-001',
        sourceFingerprint: 'source-fingerprint',
      },
    },
  ])
})

test('unknown employee and wrong password return the same response and both are counted', async () => {
  const unknownSetup = createDependencies({
    findEmployeeByNumber: async () => null,
  })
  const wrongSetup = createDependencies({
    createPublicAuthClient: async () => ({
      auth: {
        signInWithPassword: async () => ({
          data: { session: null },
          error: new Error('invalid supplier credential'),
        }),
      },
    }),
  })

  const unknownResponse = await createEmployeeLoginHandler(unknownSetup.dependencies)(
    jsonRequest({ employeeNumber: 'SW-999', password: VALID_PASSWORD }),
  )
  const wrongResponse = await createEmployeeLoginHandler(wrongSetup.dependencies)(
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
  )
  const unknownText = await unknownResponse.text()
  const wrongText = await wrongResponse.text()

  assert.equal(unknownResponse.status, 401)
  assert.equal(wrongResponse.status, 401)
  assert.equal(unknownText, wrongText)
  assert.equal(unknownSetup.calls.createPublicAuthClient, 0)
  assert.equal(unknownSetup.calls.finalizeLoginFailure.length, 1)
  assert.equal(wrongSetup.calls.finalizeLoginFailure.length, 1)
  assert.equal(
    unknownSetup.calls.finalizeLoginFailure[0].failure.failureCode,
    'INVALID_CREDENTIALS',
  )
  assert.equal(
    wrongSetup.calls.finalizeLoginFailure[0].failure.failureCode,
    'INVALID_CREDENTIALS',
  )
})

test('disabled and non-employed profiles are explicitly denied before Auth', async () => {
  const cases = [
    { ...ACTIVE_PROFILE, account_status: 'disabled' },
    { ...ACTIVE_PROFILE, employment_status: '离职' },
  ]

  for (const profile of cases) {
    const { calls, dependencies } = createDependencies({
      findEmployeeByNumber: async () => profile,
    })
    const response = await createEmployeeLoginHandler(dependencies)(
      jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
    )
    const body = await responseBody(response)

    assert.equal(response.status, 403)
    assert.deepEqual(body, {
      error: { code: 'ACCOUNT_UNAVAILABLE', message: '当前账号不可登录' },
    })
    assert.equal(calls.createPublicAuthClient, 0)
    assert.equal(calls.signInWithPassword.length, 0)
    assert.equal(calls.finalizeLoginFailure.length, 1)
  }
})

test('deleted and unlinked profiles are indistinguishable from unknown or wrong credentials', async () => {
  const cases = [
    { ...ACTIVE_PROFILE, deleted_at: '2026-07-14T00:00:00.000Z' },
    { ...ACTIVE_PROFILE, auth_user_id: null },
  ]

  for (const profile of cases) {
    const { calls, dependencies } = createDependencies({
      findEmployeeByNumber: async () => profile,
    })
    const response = await createEmployeeLoginHandler(dependencies)(
      jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
    )

    assert.equal(response.status, 401)
    assert.deepEqual(await responseBody(response), {
      error: { code: 'LOGIN_FAILED', message: '员工编号或密码错误' },
    })
    assert.equal(calls.createPublicAuthClient, 0)
    assert.equal(calls.finalizeLoginFailure.length, 1)
    assert.equal(calls.finalizeLoginFailure[0].failure.failureCode, 'INVALID_CREDENTIALS')
  }
})

test('unexpected upstream failures are sanitized without credentials, aliases, or service-role data', async () => {
  const { dependencies } = createDependencies({
    findEmployeeByNumber: async () => {
      throw new Error(
        `database dump ${VALID_PASSWORD} ${INTERNAL_ALIAS} ${SERVICE_ROLE_VALUE}`,
      )
    },
  })

  const response = await createEmployeeLoginHandler(dependencies)(
    jsonRequest({ employeeNumber: 'SW-001', password: VALID_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 500)
  assert.deepEqual(JSON.parse(text), {
    error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' },
  })
  assert.doesNotMatch(text, /database dump|ExistingPasswordValue|auth\.invalid|service-role/i)
})

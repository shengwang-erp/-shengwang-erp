import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'

import { withCors } from './cors.ts'
import { createAdminClient, createUserClient } from './clients.ts'
import {
  createTemporaryPassword,
  deriveAuthEmail,
  requireActiveEmployee,
  requirePersonnelAdministrator,
} from './employee-auth.ts'
import { EdgeSecurityError, jsonResponse } from './responses.ts'

const TEST_URL = 'https://example.supabase.co'
const VALID_TOKEN = 'header.payload.signature'
const ACTIVE_PROFILE = Object.freeze({
  auth_user_id: 'auth-user-1',
  employee_number: 'SW-001',
  name: '测试员工',
  department: '工程部',
  position: '职长',
  employment_status: '在职',
  account_status: 'active',
  must_change_password: false,
  deleted_at: null,
  effective_permission_keys: ['module.projects.view'],
})

function getEnv(values = {}) {
  return (name) => values[name]
}

function errorWithCode(expectedCode, expectedStatus) {
  return (error) => {
    assert.ok(error instanceof EdgeSecurityError)
    assert.equal(error.code, expectedCode)
    assert.equal(error.status, expectedStatus)
    return true
  }
}

function requestWithToken(token = VALID_TOKEN, init = {}) {
  return new Request('https://edge.example.test/function', {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  })
}

function createAuthDependencies({
  profile = ACTIVE_PROFILE,
  user = { id: 'auth-user-1' },
  authError = null,
  profileError = null,
} = {}) {
  const calls = {
    createUserClient: [],
    getUser: [],
    rpc: [],
  }
  const client = {
    auth: {
      getUser: async (token) => {
        calls.getUser.push(token)
        return { data: { user }, error: authError }
      },
    },
    rpc: async (name) => {
      calls.rpc.push(name)
      return { data: profile, error: profileError }
    },
  }

  return {
    calls,
    dependencies: {
      createUserClient: async (token) => {
        calls.createUserClient.push(token)
        return client
      },
    },
  }
}

test('jsonResponse emits JSON with the requested status and no reflected secrets', async () => {
  const response = jsonResponse({ ok: true }, 201)

  assert.equal(response.status, 201)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  assert.deepEqual(await response.json(), { ok: true })
})

test('withCors echoes only an explicitly allowed origin and handles preflight without the handler', async () => {
  const dependencies = {
    getEnv: getEnv({ CORS_ALLOWED_ORIGINS: 'https://erp.example.com, https://admin.example.com' }),
  }
  let handlerCalls = 0
  const handler = async () => {
    handlerCalls += 1
    return jsonResponse({ ok: true }, 200)
  }

  const response = await withCors(
    new Request('https://edge.example.test/function', {
      method: 'POST',
      headers: { Origin: 'https://erp.example.com' },
    }),
    handler,
    dependencies,
  )
  const preflight = await withCors(
    new Request('https://edge.example.test/function', {
      method: 'OPTIONS',
      headers: { Origin: 'https://admin.example.com' },
    }),
    handler,
    dependencies,
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://erp.example.com')
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true')
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://admin.example.com')
  assert.equal(handlerCalls, 1)
})

test('withCors rejects disallowed origins and fails closed when its allowlist is missing', async () => {
  let handlerCalls = 0
  const handler = async () => {
    handlerCalls += 1
    return jsonResponse({ ok: true }, 200)
  }

  const denied = await withCors(
    new Request('https://edge.example.test/function', {
      method: 'POST',
      headers: { Origin: 'https://evil.example.com' },
    }),
    handler,
    { getEnv: getEnv({ CORS_ALLOWED_ORIGINS: 'https://erp.example.com' }) },
  )
  const unconfigured = await withCors(
    new Request('https://edge.example.test/function', {
      method: 'POST',
      headers: { Origin: 'https://erp.example.com' },
    }),
    handler,
    { getEnv: getEnv() },
  )

  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)
  assert.deepEqual(await denied.json(), {
    error: { code: 'CORS_ORIGIN_DENIED', message: '请求来源不被允许' },
  })
  assert.equal(unconfigured.status, 500)
  assert.deepEqual(await unconfigured.json(), {
    error: { code: 'CONFIGURATION_ERROR', message: '认证服务未配置' },
  })
  assert.equal(handlerCalls, 0)
})

test('withCors sanitizes unexpected handler failures and never returns upstream text', async () => {
  const leakedText = `supplier failed with jwt ${VALID_TOKEN} and secret-value`
  const response = await withCors(
    new Request('https://edge.example.test/function', {
      method: 'POST',
      headers: { Origin: 'https://erp.example.com' },
    }),
    async () => {
      throw new Error(leakedText)
    },
    { getEnv: getEnv({ CORS_ALLOWED_ORIGINS: 'https://erp.example.com' }) },
  )
  const bodyText = await response.text()

  assert.equal(response.status, 500)
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://erp.example.com')
  assert.deepEqual(JSON.parse(bodyText), {
    error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用' },
  })
  assert.doesNotMatch(bodyText, /supplier|jwt|secret-value|header\.payload\.signature/i)
})

test('createAdminClient uses only server configuration and never attaches a caller JWT', async () => {
  const calls = []
  const client = { kind: 'admin' }
  const result = await createAdminClient({
    getEnv: getEnv({
      SUPABASE_URL: TEST_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    }),
    createClient: (...args) => {
      calls.push(args)
      return client
    },
    accessToken: VALID_TOKEN,
  })

  assert.equal(result, client)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], TEST_URL)
  assert.equal(calls[0][1], 'service-role-secret')
  assert.equal(calls[0][2]?.global?.headers?.Authorization, undefined)
  assert.deepEqual(calls[0][2]?.auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  })
})

test('client factories prefer modern singular and named key collections with legacy fallback', async () => {
  const adminCalls = []
  const userCalls = []

  await createAdminClient({
    getEnv: getEnv({
      SUPABASE_URL: TEST_URL,
      SUPABASE_SECRET_KEY: 'modern-secret-key',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy-service-role-key',
    }),
    createClient: (...args) => {
      adminCalls.push(args)
      return { kind: 'admin-modern' }
    },
  })
  await createAdminClient({
    getEnv: getEnv({
      SUPABASE_URL: TEST_URL,
      SUPABASE_SECRET_KEYS: JSON.stringify({
        primary: 'named-secret-key',
        rotating: 'next-secret-key',
      }),
    }),
    createClient: (...args) => {
      adminCalls.push(args)
      return { kind: 'admin-named' }
    },
  })
  await createUserClient(VALID_TOKEN, {
    getEnv: getEnv({
      SUPABASE_URL: TEST_URL,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({
        browser: 'named-publishable-key',
      }),
    }),
    createClient: (...args) => {
      userCalls.push(args)
      return { kind: 'user-named' }
    },
  })

  assert.equal(adminCalls[0][1], 'modern-secret-key')
  assert.equal(adminCalls[1][1], 'named-secret-key')
  assert.equal(userCalls[0][1], 'named-publishable-key')
  assert.notEqual(adminCalls[0][1], 'legacy-service-role-key')
})

test('createUserClient uses a public key and the caller token without service-role fallback', async () => {
  const calls = []
  const client = { kind: 'user' }
  const result = await createUserClient(VALID_TOKEN, {
    getEnv: getEnv({
      SUPABASE_URL: TEST_URL,
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    }),
    createClient: (...args) => {
      calls.push(args)
      return client
    },
  })

  assert.equal(result, client)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], TEST_URL)
  assert.equal(calls[0][1], 'publishable-key')
  assert.equal(calls[0][2].global.headers.Authorization, `Bearer ${VALID_TOKEN}`)
  assert.notEqual(calls[0][1], 'service-role-secret')
})

test('client factories fail closed for missing configuration and invalid access tokens', async () => {
  const createClient = () => assert.fail('client factory must not run without configuration')

  await assert.rejects(
    createAdminClient({ getEnv: getEnv({ SUPABASE_URL: TEST_URL }), createClient }),
    errorWithCode('CONFIGURATION_ERROR', 500),
  )
  await assert.rejects(
    createUserClient(VALID_TOKEN, {
      getEnv: getEnv({
        SUPABASE_URL: TEST_URL,
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
      }),
      createClient,
    }),
    errorWithCode('CONFIGURATION_ERROR', 500),
  )
  await assert.rejects(
    createUserClient('', {
      getEnv: getEnv({ SUPABASE_URL: TEST_URL, SUPABASE_PUBLISHABLE_KEY: 'public' }),
      createClient,
    }),
    errorWithCode('AUTH_TOKEN_INVALID', 401),
  )
})

test('requireActiveEmployee rejects missing, malformed, or multiple Bearer credentials before client creation', async () => {
  const invalidHeaders = [
    undefined,
    'Basic abc',
    'Bearer',
    'Bearer token with spaces',
    'Bearer first-token, Bearer second-token',
  ]

  for (const authorization of invalidHeaders) {
    let clientCalls = 0
    const headers = authorization ? { Authorization: authorization } : undefined
    await assert.rejects(
      requireActiveEmployee(new Request('https://edge.example.test/function', { headers }), {
        createUserClient: async () => {
          clientCalls += 1
          return null
        },
      }),
      errorWithCode('AUTH_TOKEN_INVALID', 401),
    )
    assert.equal(clientCalls, 0)
  }
})

test('requireActiveEmployee resolves Auth and fresh database state on every call', async () => {
  const { calls, dependencies } = createAuthDependencies()
  const request = requestWithToken()

  const first = await requireActiveEmployee(request, dependencies)
  const second = await requireActiveEmployee(request, dependencies)

  assert.equal(first.employeeNumber, 'SW-001')
  assert.equal(first.authUserId, 'auth-user-1')
  assert.deepEqual(first.effectivePermissionKeys, ['module.projects.view'])
  assert.deepEqual(second, first)
  assert.deepEqual(calls.createUserClient, [VALID_TOKEN, VALID_TOKEN])
  assert.deepEqual(calls.getUser, [VALID_TOKEN, VALID_TOKEN])
  assert.deepEqual(calls.rpc, ['current_employee_profile', 'current_employee_profile'])
})

test('requireActiveEmployee accepts the safe current-profile RPC shape without exposing auth_user_id', async () => {
  const { dependencies } = createAuthDependencies({
    profile: {
      id: '5d43ab52-fd37-4432-9daa-11562f9a1da8',
      employeeNumber: 'SW-001',
      name: '测试员工',
      department: '工程部',
      position: '职长',
      employmentStatus: '在职',
      accountStatus: 'active',
      mustChangePassword: false,
      isHiddenSystemAccount: false,
      effectivePermissionKeys: ['module.projects.view'],
    },
  })

  const employee = await requireActiveEmployee(requestWithToken(), dependencies)

  assert.equal(employee.authUserId, 'auth-user-1')
  assert.equal(employee.employeeNumber, 'SW-001')
  assert.deepEqual(employee.effectivePermissionKeys, ['module.projects.view'])
})

test('requireActiveEmployee rejects invalid Auth users without leaking upstream errors', async () => {
  const upstreamText = `invalid jwt ${VALID_TOKEN} service-role-secret`
  const { calls, dependencies } = createAuthDependencies({
    user: null,
    authError: new Error(upstreamText),
  })

  await assert.rejects(
    requireActiveEmployee(requestWithToken(), dependencies),
    (error) => {
      assert.ok(error instanceof EdgeSecurityError)
      assert.equal(error.code, 'AUTH_INVALID')
      assert.equal(error.status, 401)
      assert.doesNotMatch(error.message, /invalid jwt|service-role-secret|header\.payload/i)
      return true
    },
  )
  assert.deepEqual(calls.rpc, [])
})

test('requireActiveEmployee rejects unlinked, deleted, disabled, non-employed, and must-change accounts', async () => {
  const cases = [
    {
      name: 'missing profile',
      profile: null,
      code: 'EMPLOYEE_NOT_LINKED',
      status: 403,
    },
    {
      name: 'mismatched Auth link',
      profile: { ...ACTIVE_PROFILE, auth_user_id: 'other-user' },
      code: 'EMPLOYEE_NOT_LINKED',
      status: 403,
    },
    {
      name: 'deleted profile',
      profile: { ...ACTIVE_PROFILE, deleted_at: '2026-07-14T00:00:00.000Z' },
      code: 'EMPLOYEE_INACTIVE',
      status: 403,
    },
    {
      name: 'disabled account',
      profile: { ...ACTIVE_PROFILE, account_status: 'disabled' },
      code: 'ACCOUNT_DISABLED',
      status: 403,
    },
    {
      name: 'non-employed profile',
      profile: { ...ACTIVE_PROFILE, employment_status: '离职' },
      code: 'EMPLOYEE_INACTIVE',
      status: 403,
    },
    {
      name: 'temporary password',
      profile: { ...ACTIVE_PROFILE, must_change_password: true },
      code: 'PASSWORD_CHANGE_REQUIRED',
      status: 403,
    },
  ]

  for (const item of cases) {
    const { dependencies } = createAuthDependencies({ profile: item.profile })
    await assert.rejects(
      requireActiveEmployee(requestWithToken(), dependencies),
      errorWithCode(item.code, item.status),
      item.name,
    )
  }
})

test('requireActiveEmployee sanitizes profile lookup failures', async () => {
  const upstreamText = 'database failed with profile dump and service-role-secret'
  const { dependencies } = createAuthDependencies({
    profile: null,
    profileError: new Error(upstreamText),
  })

  await assert.rejects(
    requireActiveEmployee(requestWithToken(), dependencies),
    (error) => {
      assert.ok(error instanceof EdgeSecurityError)
      assert.equal(error.code, 'AUTH_SERVICE_UNAVAILABLE')
      assert.equal(error.status, 503)
      assert.doesNotMatch(error.message, /database|profile dump|service-role-secret/i)
      return true
    },
  )
})

test('requirePersonnelAdministrator accepts only active SW-000 and 社长 profiles', async () => {
  for (
    const profile of [
      { ...ACTIVE_PROFILE, employee_number: 'SW-000', position: '小工' },
      { ...ACTIVE_PROFILE, employee_number: 'SW-002', position: '社长' },
    ]
  ) {
    const { dependencies } = createAuthDependencies({ profile })
    const employee = await requirePersonnelAdministrator(requestWithToken(), dependencies)
    assert.equal(employee.employeeNumber, profile.employee_number)
  }

  const { dependencies } = createAuthDependencies({
    profile: { ...ACTIVE_PROFILE, employee_number: 'SW-003', position: '部长' },
  })
  await assert.rejects(
    requirePersonnelAdministrator(
      requestWithToken(VALID_TOKEN, {
        method: 'POST',
        body: JSON.stringify({ employeeNumber: 'SW-000', position: '社长' }),
      }),
      dependencies,
    ),
    errorWithCode('PERSONNEL_ADMIN_REQUIRED', 403),
  )
})

test('deriveAuthEmail uses normalized employee number and the server-only HMAC secret', async () => {
  const email = await deriveAuthEmail(' sw-001 ', {
    getEnv: getEnv({ AUTH_ID_DERIVATION_SECRET: 'test-secret' }),
    cryptoImpl: webcrypto,
  })

  assert.equal(
    email,
    'sw-4EE6aNeHyUq9RI-dX9Heubp8UdWeBxbxjD0elz43fXQ@auth.invalid',
  )
  assert.doesNotMatch(email, /SW-001|test-secret/i)

  await assert.rejects(
    deriveAuthEmail('SW-001', { getEnv: getEnv(), cryptoImpl: webcrypto }),
    errorWithCode('CONFIGURATION_ERROR', 500),
  )
  await assert.rejects(
    deriveAuthEmail('SW-001', {
      getEnv: getEnv({ AUTH_ID_DERIVATION_SECRET: '   ' }),
      cryptoImpl: webcrypto,
    }),
    errorWithCode('CONFIGURATION_ERROR', 500),
  )
})

test('createTemporaryPassword returns 12 composed characters without ambiguous symbols', () => {
  const password = createTemporaryPassword({
    randomBytes: (size) => Uint8Array.from({ length: size }, (_, index) => (index * 29 + 7) % 256),
  })

  assert.equal(password.length, 12)
  assert.match(password, /[A-Z]/)
  assert.match(password, /[a-z]/)
  assert.match(password, /[2-9]/)
  assert.doesNotMatch(password, /[0O1Il]/)
})

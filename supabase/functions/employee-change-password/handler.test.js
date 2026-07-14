import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmployeeChangePasswordHandler } from './handler.js'

const ACCESS_TOKEN = 'caller-access-token'
const NEW_PASSWORD = 'SecureValue2468'
const AUTH_USER_ID = 'auth-user-1'
const ACTIVE_PROFILE = Object.freeze({
  id: 'employee-profile-1',
  employeeNumber: 'SW-001',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: true,
  effectivePermissionKeys: [],
})

function passwordRequest(body, init = {}) {
  return new Request('https://edge.example.test/employee-change-password', {
    method: 'POST',
    ...init,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function createDependencies({
  user = { id: AUTH_USER_ID },
  authError = null,
  profile = ACTIVE_PROFILE,
  profileError = null,
  updateError = null,
  flagError = null,
} = {}) {
  const calls = {
    createUserClient: [],
    getUser: [],
    rpc: [],
    adminRpc: [],
    createAdminClient: 0,
    updateUserById: [],
    callerUpdateUser: [],
  }
  const userClient = {
    auth: {
      getUser: async (token) => {
        calls.getUser.push(token)
        return { data: { user }, error: authError }
      },
      updateUser: async (...args) => {
        calls.callerUpdateUser.push(args)
        throw new Error('caller updateUser must not be used without a hydrated session')
      },
    },
    rpc: async (name) => {
      calls.rpc.push(name)
      if (name === 'current_employee_profile') {
        return { data: profile, error: profileError }
      }
      throw new Error(`unexpected RPC ${name}`)
    },
  }
  const adminClient = {
    rpc: async (name, args) => {
      calls.adminRpc.push({ name, args })
      if (name !== 'complete_employee_password_change') {
        throw new Error(`unexpected admin RPC ${name}`)
      }
      return { data: flagError ? null : true, error: flagError }
    },
    auth: {
      admin: {
        updateUserById: async (authUserId, attributes) => {
          calls.updateUserById.push({ authUserId, attributes })
          return {
            data: { user: updateError ? null : { id: authUserId } },
            error: updateError,
          }
        },
      },
    },
  }
  return {
    calls,
    dependencies: {
      createUserClient: async (token) => {
        calls.createUserClient.push(token)
        return userClient
      },
      createAdminClient: async () => {
        calls.createAdminClient += 1
        return adminClient
      },
    },
  }
}

async function responseBody(response) {
  return JSON.parse(await response.text())
}

test('temporary-password caller updates only its verified Auth user then clears its own flag', async () => {
  const { calls, dependencies } = createDependencies()
  const handler = createEmployeeChangePasswordHandler(dependencies)

  const response = await handler(passwordRequest({ password: NEW_PASSWORD }))

  assert.equal(response.status, 200)
  assert.deepEqual(await responseBody(response), { ok: true })
  assert.deepEqual(calls.createUserClient, [ACCESS_TOKEN])
  assert.deepEqual(calls.getUser, [ACCESS_TOKEN])
  assert.deepEqual(calls.rpc, ['current_employee_profile'])
  assert.deepEqual(calls.adminRpc, [
    {
      name: 'complete_employee_password_change',
      args: { p_auth_user_id: AUTH_USER_ID },
    },
  ])
  assert.deepEqual(calls.updateUserById, [
    { authUserId: AUTH_USER_ID, attributes: { password: NEW_PASSWORD } },
  ])
  assert.equal(calls.callerUpdateUser.length, 0)
})

test('missing or malformed Bearer credentials are rejected before any client is created', async () => {
  const invalidAuthorizations = [
    undefined,
    'Basic token',
    'Bearer',
    'Bearer token with spaces',
    'Bearer first, Bearer second',
  ]

  for (const authorization of invalidAuthorizations) {
    const { calls, dependencies } = createDependencies()
    const request = passwordRequest(
      { password: NEW_PASSWORD },
      { headers: authorization ? { Authorization: authorization } : { Authorization: '' } },
    )
    const response = await createEmployeeChangePasswordHandler(dependencies)(request)

    assert.equal(response.status, 401)
    assert.equal((await responseBody(response)).error.code, 'AUTH_TOKEN_INVALID')
    assert.equal(calls.createUserClient.length, 0)
    assert.equal(calls.createAdminClient, 0)
  }
})

test('weak passwords and any caller-selected target are rejected before Auth', async () => {
  const invalidBodies = [
    { password: '' },
    { password: 'Short2A' },
    { password: 'alllowercase2468' },
    { password: 'ALLUPPERCASE2468' },
    { password: 'NoDigitsInValue' },
    { password: `Secure2A${'x'.repeat(121)}` },
    { password: NEW_PASSWORD, authUserId: 'another-user' },
    { password: NEW_PASSWORD, employeeNumber: 'SW-999' },
  ]

  for (const body of invalidBodies) {
    const { calls, dependencies } = createDependencies()
    const response = await createEmployeeChangePasswordHandler(dependencies)(passwordRequest(body))
    const text = await response.text()

    assert.equal(response.status, 400)
    assert.doesNotMatch(text, /SecureValue2468|another-user|SW-999/i)
    assert.equal(calls.createUserClient.length, 0)
    assert.equal(calls.createAdminClient, 0)
  }
})

test('invalid Auth user is rejected before profile or admin operations', async () => {
  const { calls, dependencies } = createDependencies({
    user: null,
    authError: new Error('supplier JWT detail'),
  })

  const response = await createEmployeeChangePasswordHandler(dependencies)(
    passwordRequest({ password: NEW_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 401)
  assert.equal(JSON.parse(text).error.code, 'AUTH_INVALID')
  assert.deepEqual(calls.rpc, [])
  assert.equal(calls.createAdminClient, 0)
  assert.doesNotMatch(text, /supplier|JWT detail|caller-access-token/i)
})

test('disabled, non-employed, deleted, or unlinked caller cannot update Auth', async () => {
  const cases = [
    { profile: { ...ACTIVE_PROFILE, accountStatus: 'disabled' }, code: 'ACCOUNT_DISABLED' },
    { profile: { ...ACTIVE_PROFILE, employmentStatus: '离职' }, code: 'EMPLOYEE_INACTIVE' },
    {
      profile: { ...ACTIVE_PROFILE, deletedAt: '2026-07-14T00:00:00.000Z' },
      code: 'EMPLOYEE_NOT_LINKED',
    },
    { profile: null, code: 'EMPLOYEE_NOT_LINKED' },
  ]

  for (const item of cases) {
    const { calls, dependencies } = createDependencies({ profile: item.profile })
    const response = await createEmployeeChangePasswordHandler(dependencies)(
      passwordRequest({ password: NEW_PASSWORD }),
    )

    assert.equal(response.status, 403)
    assert.equal((await responseBody(response)).error.code, item.code)
    assert.equal(calls.createAdminClient, 0)
    assert.equal(calls.updateUserById.length, 0)
    assert.deepEqual(calls.rpc, ['current_employee_profile'])
  }
})

test('Auth update failure leaves the database flag untouched and sanitizes the supplier error', async () => {
  const { calls, dependencies } = createDependencies({
    updateError: new Error(`supplier rejected ${NEW_PASSWORD}`),
  })

  const response = await createEmployeeChangePasswordHandler(dependencies)(
    passwordRequest({ password: NEW_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'PASSWORD_UPDATE_FAILED')
  assert.deepEqual(calls.rpc, ['current_employee_profile'])
  assert.deepEqual(calls.adminRpc, [])
  assert.equal(calls.updateUserById.length, 1)
  assert.doesNotMatch(text, /supplier|SecureValue2468/i)
})

test('database flag failure after Auth success returns a safe retry error', async () => {
  const { calls, dependencies } = createDependencies({
    flagError: new Error(`database profile dump ${NEW_PASSWORD}`),
  })

  const response = await createEmployeeChangePasswordHandler(dependencies)(
    passwordRequest({ password: NEW_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'PASSWORD_STATE_SYNC_FAILED')
  assert.equal(calls.updateUserById.length, 1)
  assert.deepEqual(calls.rpc, ['current_employee_profile'])
  assert.deepEqual(calls.adminRpc, [
    {
      name: 'complete_employee_password_change',
      args: { p_auth_user_id: AUTH_USER_ID },
    },
  ])
  assert.doesNotMatch(text, /database|profile dump|SecureValue2468/i)
})

test('profile lookup failures are sanitized and never reach the admin password path', async () => {
  const { calls, dependencies } = createDependencies({
    profile: null,
    profileError: new Error(`profile supplier dump ${ACCESS_TOKEN} ${NEW_PASSWORD}`),
  })

  const response = await createEmployeeChangePasswordHandler(dependencies)(
    passwordRequest({ password: NEW_PASSWORD }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'AUTH_SERVICE_UNAVAILABLE')
  assert.equal(calls.createAdminClient, 0)
  assert.doesNotMatch(text, /supplier|caller-access-token|SecureValue2468/i)
})

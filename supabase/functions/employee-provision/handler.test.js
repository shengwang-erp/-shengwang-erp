import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmployeeProvisionHandler,
  deriveProvisioningPassword,
  findAuthUsersByEmail,
} from './handler.js'

const REQUEST_ID = '10000000-0000-4000-8000-000000000001'
const OWNER_TOKEN = '20000000-0000-4000-8000-000000000001'
const ACTOR_ID = '30000000-0000-4000-8000-000000000001'
const AUTH_USER_ID = '40000000-0000-4000-8000-000000000001'
const INITIAL_PASSWORD = 'Abcdef234567'
const INTERNAL_ALIAS = 'opaque-internal-identity@auth.invalid'
const SAFE_EMPLOYEE = Object.freeze({
  id: '50000000-0000-4000-8000-000000000001',
  employeeNumber: 'SW-001',
  name: '测试员工',
  department: '工程部',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: true,
})

function request(body, init = {}) {
  return new Request('https://edge.example.test/employee-provision', {
    method: 'POST',
    ...init,
    headers: {
      Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function dependencies(overrides = {}) {
  const calls = []
  const adminClient = { kind: 'admin' }
  return {
    calls,
    values: {
      randomUUID: () => OWNER_TOKEN,
      requirePersonnelAdministrator: async () => {
        calls.push('authorize')
        return { authUserId: ACTOR_ID, employeeNumber: 'SW-000' }
      },
      createAdminClient: async () => {
        calls.push('admin-client')
        return adminClient
      },
      reserveEmployeeNumber: async (_client, requestId) => {
        calls.push('reserve')
        assert.equal(requestId, REQUEST_ID)
        return 'SW-001'
      },
      claimProvisioning: async () => {
        calls.push('claim')
        return {
          ownerAcquired: true,
          status: 'reserved',
          employeeNumber: 'SW-001',
        }
      },
      createTemporaryPassword: () => {
        calls.push('password')
        return INITIAL_PASSWORD
      },
      deriveInitialPassword: async () => {
        calls.push('password')
        return INITIAL_PASSWORD
      },
      renewProvisioningOwner: async () => {
        calls.push('renew-owner')
        return true
      },
      deriveAuthEmail: async (employeeNumber) => {
        calls.push('alias')
        assert.equal(employeeNumber, 'SW-001')
        return INTERNAL_ALIAS
      },
      findAuthUsersByEmail: async () => {
        calls.push('find-auth')
        return []
      },
      getAuthUserById: async () => {
        calls.push('get-auth')
        return {
          id: AUTH_USER_ID,
          email: INTERNAL_ALIAS,
          user_metadata: {
            employeeNumber: 'SW-001',
            provisioningRequestId: REQUEST_ID,
          },
        }
      },
      createAuthUser: async (_client, input) => {
        calls.push('create-auth')
        assert.deepEqual(input, {
          email: INTERNAL_ALIAS,
          password: INITIAL_PASSWORD,
          employeeNumber: 'SW-001',
          requestId: REQUEST_ID,
        })
        return { id: AUTH_USER_ID }
      },
      updateAuthPassword: async () => {
        calls.push('update-auth-password')
        return true
      },
      recordAuthCreated: async () => {
        calls.push('record-auth')
        return true
      },
      completeProvisioning: async (_client, input) => {
        calls.push('complete')
        assert.equal(input.actorAuthUserId, ACTOR_ID)
        assert.equal(input.authUserId, AUTH_USER_ID)
        assert.equal(input.profile.department, '工程部')
        assert.equal(input.profile.position, '小工')
        assert.equal(Object.hasOwn(input.profile, 'employeeNumber'), false)
        return SAFE_EMPLOYEE
      },
      prepareCompensation: async () => {
        calls.push('prepare-compensation')
        return { cleanupAllowed: true }
      },
      deleteAuthUser: async () => {
        calls.push('delete-auth')
        return true
      },
      completeCompensation: async () => {
        calls.push('complete-compensation')
        return true
      },
      ...overrides,
    },
  }
}

async function body(response) {
  return JSON.parse(await response.text())
}

test('provisions in server order and returns the generated password once', async () => {
  const fixture = dependencies()
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 201)
  assert.deepEqual(await body(response), {
    employee: SAFE_EMPLOYEE,
    initialPassword: INITIAL_PASSWORD,
  })
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
    'password',
    'alias',
    'find-auth',
    'renew-owner',
    'create-auth',
    'record-auth',
    'complete',
  ])
})

test('completed replay returns only the stable employee and performs no Auth work', async () => {
  const fixture = dependencies({
    claimProvisioning: async () => {
      fixture.calls.push('claim')
      return {
        ownerAcquired: false,
        status: 'completed',
        employeeNumber: 'SW-001',
        employee: SAFE_EMPLOYEE,
      }
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await body(response), { employee: SAFE_EMPLOYEE })
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
  ])
})

test('rejects mutable security fields and invalid fixed department before authorization', async () => {
  for (
    const profile of [
      { name: '测试', department: '现场', position: '小工' },
      {
        name: '测试',
        department: '工程部',
        position: '小工',
        employeeNumber: 'SW-999',
      },
      {
        name: '测试',
        department: '工程部',
        position: '小工',
        permissions: ['all'],
      },
    ]
  ) {
    const fixture = dependencies()
    const response = await createEmployeeProvisionHandler(fixture.values)(
      request({ requestId: REQUEST_ID, profile }),
    )
    assert.equal(response.status, 400)
    assert.equal((await body(response)).error.code, 'PROVISION_INPUT_INVALID')
    assert.deepEqual(fixture.calls, [])
  }
})

test('profile failure deletes only the Auth user created by this call', async () => {
  const fixture = dependencies({
    completeProvisioning: async () => {
      fixture.calls.push('complete')
      throw new Error('upstream details must stay private')
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'PROVISION_PROFILE_FAILED')
  assert.deepEqual(fixture.calls.slice(-5), [
    'complete',
    'prepare-compensation',
    'renew-owner',
    'delete-auth',
    'complete-compensation',
  ])
  assert.doesNotMatch(text, /upstream|auth\.invalid|Abcdef234567/i)
})

test('sensitive fields require the matching fresh server permission before admin client creation', async () => {
  const fixture = dependencies({
    requirePersonnelAdministrator: async () => {
      fixture.calls.push('authorize')
      return {
        authUserId: ACTOR_ID,
        employeeNumber: 'SW-010',
        position: '社长',
        accountStatus: 'active',
        employmentStatus: '在职',
        effectivePermissionKeys: [],
      }
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: {
        name: '测试员工',
        department: '工程部',
        position: '小工',
        passportNumber: 'private-value',
      },
    }),
  )
  const text = await response.text()

  assert.equal(response.status, 403)
  assert.equal(JSON.parse(text).error.code, 'SENSITIVE_PERMISSION_REQUIRED')
  assert.deepEqual(fixture.calls, ['authorize'])
  assert.doesNotMatch(text, /private-value/i)
})

test('an active owner prevents concurrent Auth or password work', async () => {
  const fixture = dependencies({
    claimProvisioning: async () => {
      fixture.calls.push('claim')
      return {
        ownerAcquired: false,
        status: 'reserved',
        employeeNumber: 'SW-001',
      }
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 409)
  assert.equal((await body(response)).error.code, 'PROVISION_IN_PROGRESS')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
  ])
})

test('failed Auth deletion leaves compensation pending and never returns the password', async () => {
  const fixture = dependencies({
    completeProvisioning: async () => {
      fixture.calls.push('complete')
      throw new Error('profile failed')
    },
    deleteAuthUser: async () => {
      fixture.calls.push('delete-auth')
      throw new Error('delete failed')
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'PROVISION_COMPENSATION_PENDING')
  assert.deepEqual(fixture.calls.slice(-4), [
    'complete',
    'prepare-compensation',
    'renew-owner',
    'delete-auth',
  ])
  assert.doesNotMatch(text, /Abcdef234567|delete failed|profile failed/i)
})

test('an adopted profile detected during compensation is returned without deleting Auth', async () => {
  const fixture = dependencies({
    completeProvisioning: async () => {
      fixture.calls.push('complete')
      throw new Error('ambiguous completion')
    },
    prepareCompensation: async () => {
      fixture.calls.push('prepare-compensation')
      return { cleanupAllowed: false, employee: SAFE_EMPLOYEE }
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await body(response), { employee: SAFE_EMPLOYEE })
  assert.deepEqual(fixture.calls.slice(-2), [
    'complete',
    'prepare-compensation',
  ])
})

test('strict request framing and profile bounds fail before authorization', async () => {
  const invalidRequests = [
    new Request('https://edge.example.test/employee-provision', {
      method: 'GET',
    }),
    new Request('https://edge.example.test/employee-provision', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: '{}',
    }),
    request('{bad-json'),
    request({ requestId: REQUEST_ID, profile: null }),
    request({
      requestId: REQUEST_ID,
      profile: { name: 'x', department: '工程部', position: '小工' },
      extra: true,
    }),
    request({
      requestId: 'not-a-uuid',
      profile: { name: 'x', department: '工程部', position: '小工' },
    }),
    request({
      requestId: REQUEST_ID,
      profile: {
        name: 'x'.repeat(101),
        department: '工程部',
        position: '小工',
      },
    }),
    request({
      requestId: REQUEST_ID,
      profile: { name: 'x', department: '工程部', position: '不存在' },
    }),
  ]

  for (const invalidRequest of invalidRequests) {
    const fixture = dependencies()
    const response = await createEmployeeProvisionHandler(fixture.values)(
      invalidRequest,
    )
    assert.ok([400, 405, 415].includes(response.status))
    assert.deepEqual(fixture.calls, [])
  }
})

test('an interrupted auth_created state is safely resumed and completed with a new one-time password', async () => {
  const fixture = dependencies({
    claimProvisioning: async () => {
      fixture.calls.push('claim')
      return {
        ownerAcquired: true,
        status: 'auth_created',
        employeeNumber: 'SW-001',
        authUserId: AUTH_USER_ID,
      }
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 201)
  assert.deepEqual(await body(response), {
    employee: SAFE_EMPLOYEE,
    initialPassword: INITIAL_PASSWORD,
  })
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
    'password',
    'alias',
    'get-auth',
    'renew-owner',
    'update-auth-password',
    'record-auth',
    'complete',
  ])
})

test('compensation_pending retry proves ownership, cleans Auth, and asks for a password-safe retry', async () => {
  const fixture = dependencies({
    claimProvisioning: async () => {
      fixture.calls.push('claim')
      return {
        ownerAcquired: true,
        status: 'compensation_pending',
        employeeNumber: 'SW-001',
        authUserId: AUTH_USER_ID,
      }
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )
  const text = await response.text()

  assert.equal(response.status, 409)
  assert.equal(JSON.parse(text).error.code, 'PROVISION_RETRY_REQUIRED')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
    'alias',
    'get-auth',
    'prepare-compensation',
    'renew-owner',
    'delete-auth',
    'complete-compensation',
  ])
  assert.doesNotMatch(text, /Abcdef234567|auth\.invalid/i)
})

test('Auth lookup stops on an explicitly final full page', async () => {
  let calls = 0
  const users = Array.from({ length: 100 }, (_, index) => ({
    id: `user-${index}`,
    email: `user-${index}@auth.invalid`,
  }))
  const matches = await findAuthUsersByEmail(
    {
      auth: {
        admin: {
          listUsers: async () => {
            calls += 1
            return { data: { users, nextPage: null }, error: null }
          },
        },
      },
    },
    INTERNAL_ALIAS,
  )

  assert.deepEqual(matches, [])
  assert.equal(calls, 1)
})

test('Auth lookup ignores the pinned SDK two-digit nextPage parsing bug and uses total', async () => {
  const requestedPages = []
  const matches = await findAuthUsersByEmail(
    {
      auth: {
        admin: {
          listUsers: async ({ page, perPage }) => {
            requestedPages.push(page)
            assert.equal(perPage, 100)
            const start = (page - 1) * perPage
            const count = Math.min(perPage, 950 - start)
            return {
              data: {
                users: Array.from({ length: count }, (_, index) => ({
                  id: `user-${start + index}`,
                  email: `user-${start + index}@auth.invalid`,
                })),
                total: 950,
                // @supabase/auth-js 2.110.0 parses the page=10 Link marker as 1.
                nextPage: page === 9 ? 1 : page + 1,
              },
              error: null,
            }
          },
        },
      },
    },
    INTERNAL_ALIAS,
  )

  assert.deepEqual(matches, [])
  assert.deepEqual(requestedPages, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
})

test('provision password PRF is stable per request, distinct across requests, and policy-compliant', async () => {
  const dependencies = { getEnv: () => 'stable-server-only-test-secret' }
  const first = await deriveProvisioningPassword(
    REQUEST_ID,
    'SW-001',
    dependencies,
  )
  const retry = await deriveProvisioningPassword(
    REQUEST_ID,
    'SW-001',
    dependencies,
  )
  const another = await deriveProvisioningPassword(
    '10000000-0000-4000-8000-000000000002',
    'SW-001',
    dependencies,
  )

  assert.equal(first, retry)
  assert.notEqual(first, another)
  assert.equal(first.length, 12)
  assert.match(first, /[A-Z]/u)
  assert.match(first, /[a-z]/u)
  assert.match(first, /[2-9]/u)
  assert.doesNotMatch(first, /SW-001|10000000/iu)
})

test('a stale provision worker cannot invalidate the password returned by the winner', async () => {
  let authPassword = null
  let releaseStaleWrite
  let staleWriteReached
  const staleWriteWaiting = new Promise((resolve) => {
    staleWriteReached = resolve
  })
  const releaseStale = new Promise((resolve) => {
    releaseStaleWrite = resolve
  })
  const winnerPassword = 'WinnerA23456'
  const stalePassword = 'StaleBb23456'

  const shared = {
    claimProvisioning: async () => ({
      ownerAcquired: true,
      status: 'auth_created',
      employeeNumber: 'SW-001',
      authUserId: AUTH_USER_ID,
    }),
    getAuthUserById: async () => ({
      id: AUTH_USER_ID,
      email: INTERNAL_ALIAS,
      user_metadata: {
        employeeNumber: 'SW-001',
        provisioningRequestId: REQUEST_ID,
      },
    }),
  }
  const staleFixture = dependencies({
    ...shared,
    createTemporaryPassword: () => stalePassword,
    deriveInitialPassword: async () => winnerPassword,
    updateAuthPassword: async (_client, _authUserId, password) => {
      staleWriteReached()
      await releaseStale
      authPassword = password
    },
    recordAuthCreated: async () => {
      throw new Error('stale owner rejected')
    },
  })
  const winnerFixture = dependencies({
    ...shared,
    createTemporaryPassword: () => winnerPassword,
    deriveInitialPassword: async () => winnerPassword,
    updateAuthPassword: async (_client, _authUserId, password) => {
      authPassword = password
    },
  })
  const provisionRequest = () =>
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    })

  const staleResponsePromise = createEmployeeProvisionHandler(
    staleFixture.values,
  )(
    provisionRequest(),
  )
  await staleWriteWaiting
  const winnerResponse = await createEmployeeProvisionHandler(
    winnerFixture.values,
  )(
    provisionRequest(),
  )
  const winnerBody = await body(winnerResponse)
  assert.equal(winnerResponse.status, 201)

  releaseStaleWrite()
  const staleResponse = await staleResponsePromise

  assert.notEqual(staleResponse.status, 201)
  assert.equal(authPassword, winnerBody.initialPassword)
})

test('compensation retry recovers when Auth was deleted before state completion', async () => {
  const fixture = dependencies({
    claimProvisioning: async () => {
      fixture.calls.push('claim')
      return {
        ownerAcquired: true,
        status: 'compensation_pending',
        employeeNumber: 'SW-001',
        authUserId: AUTH_USER_ID,
      }
    },
    getAuthUserById: async () => {
      fixture.calls.push('get-auth')
      return null
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 409)
  assert.equal((await body(response)).error.code, 'PROVISION_RETRY_REQUIRED')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
    'alias',
    'get-auth',
    'prepare-compensation',
    'complete-compensation',
  ])
})

test('auth_created retry repairs a confirmed missing Auth user into a recoverable state', async () => {
  const fixture = dependencies({
    claimProvisioning: async () => {
      fixture.calls.push('claim')
      return {
        ownerAcquired: true,
        status: 'auth_created',
        employeeNumber: 'SW-001',
        authUserId: AUTH_USER_ID,
      }
    },
    getAuthUserById: async () => {
      fixture.calls.push('get-auth')
      return null
    },
  })
  const response = await createEmployeeProvisionHandler(fixture.values)(
    request({
      requestId: REQUEST_ID,
      profile: { name: '测试员工', department: '工程部', position: '小工' },
    }),
  )

  assert.equal(response.status, 409)
  assert.equal((await body(response)).error.code, 'PROVISION_RETRY_REQUIRED')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'reserve',
    'claim',
    'password',
    'alias',
    'get-auth',
    'prepare-compensation',
    'complete-compensation',
  ])
})

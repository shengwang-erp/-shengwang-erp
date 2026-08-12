import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createEmployeeAdminHandler,
  derivePasswordResetCredential,
  HANDLER_DEADLINE_MS,
} from './handler.js'

const ACTOR_ID = '30000000-0000-4000-8000-000000000001'
const EMPLOYEE_ID = '50000000-0000-4000-8000-000000000001'
const AUTH_USER_ID = '40000000-0000-4000-8000-000000000001'
const TEMPORARY_PASSWORD = 'Abcdef234567'
const RESET_REQUEST_ID = '60000000-0000-4000-8000-000000000001'
const RESET_OWNER_TOKEN = '70000000-0000-4000-8000-000000000001'
const SAFE_EMPLOYEE = Object.freeze({
  id: EMPLOYEE_ID,
  employeeNumber: 'SW-001',
  name: '测试员工',
  department: '工程部',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  attendanceRequired: true,
})

function request(body, init = {}) {
  return new Request('https://edge.example.test/employee-admin', {
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
  return {
    calls,
    values: {
      requirePersonnelAdministrator: async () => {
        calls.push('authorize')
        return { authUserId: ACTOR_ID, employeeNumber: 'SW-000' }
      },
      createAdminClient: async () => {
        calls.push('admin-client')
        return { kind: 'admin' }
      },
      updateEmployeeProfile: async () => {
        calls.push('update-profile')
        return SAFE_EMPLOYEE
      },
      disableEmployeeAccount: async () => {
        calls.push('disable-db')
        return {
          employee: { ...SAFE_EMPLOYEE, accountStatus: 'disabled' },
          authUserId: AUTH_USER_ID,
          sessionsRevoked: true,
        }
      },
      getEmployeeAdminTarget: async () => {
        calls.push('get-target')
        return { employee: SAFE_EMPLOYEE, authUserId: AUTH_USER_ID }
      },
      setAuthBan: async (_client, authUserId, disabled) => {
        calls.push(disabled ? 'ban-auth' : 'unban-auth')
        assert.equal(authUserId, AUTH_USER_ID)
        return true
      },
      activateEmployeeAccount: async () => {
        calls.push('activate-db')
        return SAFE_EMPLOYEE
      },
      createTemporaryPassword: () => {
        calls.push('password')
        return TEMPORARY_PASSWORD
      },
      randomUUID: () => RESET_OWNER_TOKEN,
      claimPasswordReset: async () => {
        calls.push('claim-reset')
        return {
          ownerAcquired: true,
          status: 'pending',
          requestId: RESET_REQUEST_ID,
          authUserId: AUTH_USER_ID,
          employee: SAFE_EMPLOYEE,
        }
      },
      deriveResetPassword: async () => {
        calls.push('password')
        return TEMPORARY_PASSWORD
      },
      renewPasswordResetOwner: async () => {
        calls.push('renew-reset')
        return true
      },
      updateAuthPassword: async () => {
        calls.push('update-auth-password')
        return true
      },
      markTemporaryPassword: async () => {
        calls.push('mark-temp-password')
        return { ...SAFE_EMPLOYEE, mustChangePassword: true }
      },
      completePasswordReset: async () => {
        calls.push('complete-reset')
        return { ...SAFE_EMPLOYEE, mustChangePassword: true }
      },
      ...overrides,
    },
  }
}

async function body(response) {
  return JSON.parse(await response.text())
}

test('disables the database profile before banning Auth', async () => {
  const fixture = dependencies()
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'set_account_status',
      employeeId: EMPLOYEE_ID,
      accountStatus: 'disabled',
    }),
  )

  assert.equal(response.status, 200)
  assert.equal((await body(response)).employee.accountStatus, 'disabled')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'disable-db',
    'ban-auth',
  ])
})

test('unbans Auth before activating the database profile', async () => {
  const fixture = dependencies()
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'set_account_status',
      employeeId: EMPLOYEE_ID,
      accountStatus: 'active',
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await body(response), { employee: SAFE_EMPLOYEE })
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'get-target',
    'unban-auth',
    'activate-db',
  ])
})

test('resets Auth first, then marks the password temporary, and returns it once', async () => {
  const fixture = dependencies()
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({ operation: 'reset_temporary_password', employeeId: EMPLOYEE_ID }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(await body(response), {
    employee: { ...SAFE_EMPLOYEE, mustChangePassword: true },
    temporaryPassword: TEMPORARY_PASSWORD,
  })
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'claim-reset',
    'password',
    'renew-reset',
    'update-auth-password',
    'complete-reset',
  ])
})

test('rejects employee-number and security-field patches before authorization', async () => {
  for (
    const patch of [
      { employeeNumber: 'SW-999' },
      { authUserId: AUTH_USER_ID },
      { accountStatus: 'disabled' },
      { permissions: ['all'] },
      { department: '现场' },
    ]
  ) {
    const fixture = dependencies()
    const response = await createEmployeeAdminHandler(fixture.values)(
      request({ operation: 'update_profile', employeeId: EMPLOYEE_ID, patch }),
    )
    assert.equal(response.status, 400)
    assert.equal(
      (await body(response)).error.code,
      'EMPLOYEE_ADMIN_INPUT_INVALID',
    )
    assert.deepEqual(fixture.calls, [])
  }
})

test('updates an allowlisted profile patch after fresh authorization', async () => {
  const fixture = dependencies({
    updateEmployeeProfile: async (_client, input) => {
      fixture.calls.push('update-profile')
      assert.deepEqual(input, {
        operation: 'update_profile',
        employeeId: EMPLOYEE_ID,
        patch: { department: '设计部', position: '设计师' },
        actorAuthUserId: ACTOR_ID,
      })
      return { ...SAFE_EMPLOYEE, department: '设计部', position: '设计师' }
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'update_profile',
      employeeId: EMPLOYEE_ID,
      patch: { department: '设计部', position: '设计师' },
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'update-profile',
  ])
})

test('preserves an exact attendanceRequired boolean through fresh authorization', async () => {
  const fixture = dependencies({
    updateEmployeeProfile: async (_client, input) => {
      fixture.calls.push('update-profile')
      assert.deepEqual(input.patch, { attendanceRequired: false })
      return SAFE_EMPLOYEE
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'update_profile',
      employeeId: EMPLOYEE_ID,
      patch: { attendanceRequired: false },
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'update-profile',
  ])
})

test('rejects attendanceRequired coercion before authorization', async () => {
  for (const attendanceRequired of ['false', 0, null]) {
    const fixture = dependencies()
    const response = await createEmployeeAdminHandler(fixture.values)(
      request({
        operation: 'update_profile',
        employeeId: EMPLOYEE_ID,
        patch: { attendanceRequired },
      }),
    )

    assert.equal(response.status, 400)
    assert.equal(
      (await body(response)).error.code,
      'EMPLOYEE_ADMIN_INPUT_INVALID',
    )
    assert.deepEqual(fixture.calls, [])
  }
})

test('sensitive update fields require the matching server permission before mutation', async () => {
  for (
    const patch of [{ passportNumber: 'private-value' }, { baseSalary: 12345 }]
  ) {
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
    const response = await createEmployeeAdminHandler(fixture.values)(
      request({ operation: 'update_profile', employeeId: EMPLOYEE_ID, patch }),
    )
    const text = await response.text()

    assert.equal(response.status, 403)
    assert.equal(JSON.parse(text).error.code, 'SENSITIVE_PERMISSION_REQUIRED')
    assert.deepEqual(fixture.calls, ['authorize'])
    assert.doesNotMatch(text, /private-value|12345/i)
  }
})

test('disable Auth failure leaves the database disabled and returns only a safe sync error', async () => {
  const fixture = dependencies({
    setAuthBan: async () => {
      fixture.calls.push('ban-auth')
      throw new Error('private upstream failure')
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'set_account_status',
      employeeId: EMPLOYEE_ID,
      accountStatus: 'disabled',
    }),
  )
  const text = await response.text()

  assert.equal(response.status, 503)
  assert.equal(JSON.parse(text).error.code, 'ACCOUNT_AUTH_SYNC_FAILED')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'disable-db',
    'ban-auth',
  ])
  assert.doesNotMatch(text, /private upstream/i)
})

test('disable fails closed unless the database transaction confirms session revocation', async () => {
  const fixture = dependencies({
    disableEmployeeAccount: async () => {
      fixture.calls.push('disable-db')
      return {
        employee: { ...SAFE_EMPLOYEE, accountStatus: 'disabled' },
        authUserId: AUTH_USER_ID,
        sessionsRevoked: false,
      }
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'set_account_status',
      employeeId: EMPLOYEE_ID,
      accountStatus: 'disabled',
    }),
  )

  assert.equal(response.status, 503)
  assert.equal(
    (await body(response)).error.code,
    'ACCOUNT_SESSION_REVOKE_FAILED',
  )
  assert.deepEqual(fixture.calls, ['authorize', 'admin-client', 'disable-db'])
})

test('enable Auth failure never activates the database profile', async () => {
  const fixture = dependencies({
    setAuthBan: async () => {
      fixture.calls.push('unban-auth')
      throw new Error('private upstream failure')
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'set_account_status',
      employeeId: EMPLOYEE_ID,
      accountStatus: 'active',
    }),
  )

  assert.equal(response.status, 503)
  assert.equal((await body(response)).error.code, 'ACCOUNT_AUTH_SYNC_FAILED')
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'get-target',
    'unban-auth',
  ])
})

test('disabled, non-active, or hidden system targets cannot receive a temporary password', async () => {
  for (
    const employee of [
      { ...SAFE_EMPLOYEE, accountStatus: 'disabled' },
      { ...SAFE_EMPLOYEE, employmentStatus: '离职' },
      { ...SAFE_EMPLOYEE, employeeNumber: 'SW-000' },
    ]
  ) {
    const fixture = dependencies({
      claimPasswordReset: async () => {
        fixture.calls.push('claim-reset')
        return {
          ownerAcquired: true,
          status: 'pending',
          requestId: RESET_REQUEST_ID,
          employee,
          authUserId: AUTH_USER_ID,
        }
      },
    })
    const response = await createEmployeeAdminHandler(fixture.values)(
      request({
        operation: 'reset_temporary_password',
        employeeId: EMPLOYEE_ID,
      }),
    )

    assert.equal(response.status, 409)
    assert.equal((await body(response)).error.code, 'EMPLOYEE_TARGET_INVALID')
    assert.deepEqual(fixture.calls, [
      'authorize',
      'admin-client',
      'claim-reset',
    ])
  }
})

test('password-state failure never returns the generated password', async () => {
  const fixture = dependencies({
    completePasswordReset: async () => {
      fixture.calls.push('complete-reset')
      throw new Error('database details')
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({ operation: 'reset_temporary_password', employeeId: EMPLOYEE_ID }),
  )
  const text = await response.text()

  assert.equal(response.status, 500)
  assert.equal(JSON.parse(text).error.code, 'INTERNAL_ERROR')
  assert.doesNotMatch(text, /Abcdef234567|database details/i)
  assert.deepEqual(fixture.calls.slice(-3), [
    'renew-reset',
    'update-auth-password',
    'complete-reset',
  ])
})

test('concurrent reset workers cannot both return credentials or leave the winner invalid', async () => {
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
    claimPasswordReset: async () => ({
      ownerAcquired: true,
      status: 'pending',
      requestId: RESET_REQUEST_ID,
      authUserId: AUTH_USER_ID,
      employee: SAFE_EMPLOYEE,
    }),
  }
  const staleFixture = dependencies({
    ...shared,
    createTemporaryPassword: () => stalePassword,
    deriveResetPassword: async () => winnerPassword,
    updateAuthPassword: async (_client, _authUserId, password) => {
      staleWriteReached()
      await releaseStale
      authPassword = password
    },
    completePasswordReset: async () => {
      throw new Error('stale reset owner rejected')
    },
  })
  const winnerFixture = dependencies({
    ...shared,
    createTemporaryPassword: () => winnerPassword,
    deriveResetPassword: async () => winnerPassword,
    updateAuthPassword: async (_client, _authUserId, password) => {
      authPassword = password
    },
  })
  const resetRequest = () =>
    request({ operation: 'reset_temporary_password', employeeId: EMPLOYEE_ID })

  const staleResponsePromise = createEmployeeAdminHandler(staleFixture.values)(
    resetRequest(),
  )
  await staleWriteWaiting
  const winnerResponse = await createEmployeeAdminHandler(winnerFixture.values)(
    resetRequest(),
  )
  const winnerBody = await body(winnerResponse)
  assert.equal(winnerResponse.status, 200)

  releaseStaleWrite()
  const staleResponse = await staleResponsePromise

  assert.notEqual(staleResponse.status, 200)
  assert.equal(authPassword, winnerBody.temporaryPassword)
})

test('reset password PRF is stable only for one reset request and policy-compliant', async () => {
  const dependencies = { getEnv: () => 'stable-server-only-test-secret' }
  const first = await derivePasswordResetCredential(
    RESET_REQUEST_ID,
    EMPLOYEE_ID,
    dependencies,
  )
  const retry = await derivePasswordResetCredential(
    RESET_REQUEST_ID,
    EMPLOYEE_ID,
    dependencies,
  )
  const another = await derivePasswordResetCredential(
    '60000000-0000-4000-8000-000000000002',
    EMPLOYEE_ID,
    dependencies,
  )

  assert.equal(first, retry)
  assert.notEqual(first, another)
  assert.equal(first.length, 12)
  assert.match(first, /[A-Z]/u)
  assert.match(first, /[a-z]/u)
  assert.match(first, /[2-9]/u)
})

test('an active password-reset owner rejects a second request before password or Auth work', async () => {
  const fixture = dependencies({
    claimPasswordReset: async () => {
      fixture.calls.push('claim-reset')
      return {
        ownerAcquired: false,
        status: 'pending',
        requestId: RESET_REQUEST_ID,
        employee: SAFE_EMPLOYEE,
      }
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({ operation: 'reset_temporary_password', employeeId: EMPLOYEE_ID }),
  )

  assert.equal(response.status, 409)
  assert.equal((await body(response)).error.code, 'PASSWORD_RESET_IN_PROGRESS')
  assert.deepEqual(fixture.calls, ['authorize', 'admin-client', 'claim-reset'])
})

test('the absolute handler deadline is shorter than the database fence and blocks a late Auth write', async () => {
  assert.equal(HANDLER_DEADLINE_MS, 45_000)
  const controller = new AbortController()
  controller.abort(new DOMException('deadline', 'TimeoutError'))
  let closed = false
  const fixture = dependencies({
    createRequestDeadline: () => ({
      signal: controller.signal,
      close: () => {
        closed = true
      },
    }),
    createAdminClient: async ({ requestSignal }) => {
      fixture.calls.push('admin-client')
      assert.equal(requestSignal, controller.signal)
      return { kind: 'admin' }
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({ operation: 'reset_temporary_password', employeeId: EMPLOYEE_ID }),
  )

  assert.equal(response.status, 503)
  assert.equal((await body(response)).error.code, 'PASSWORD_RESET_FAILED')
  assert.equal(closed, true)
  assert.deepEqual(fixture.calls, [
    'authorize',
    'admin-client',
    'claim-reset',
    'password',
    'renew-reset',
  ])
})

test('strict operation shapes and methods fail before authorization', async () => {
  const invalidRequests = [
    new Request('https://edge.example.test/employee-admin', { method: 'GET' }),
    request('{bad-json'),
    request({ operation: 'unknown', employeeId: EMPLOYEE_ID }),
    request({
      operation: 'reset_temporary_password',
      employeeId: EMPLOYEE_ID,
      extra: true,
    }),
    request({
      operation: 'set_account_status',
      employeeId: EMPLOYEE_ID,
      accountStatus: 'deleted',
    }),
    request({
      operation: 'update_profile',
      employeeId: EMPLOYEE_ID,
      patch: {},
    }),
  ]
  for (const invalidRequest of invalidRequests) {
    const fixture = dependencies()
    const response = await createEmployeeAdminHandler(fixture.values)(
      invalidRequest,
    )
    assert.ok([400, 405].includes(response.status))
    assert.deepEqual(fixture.calls, [])
  }
})

test('rejects an upstream employee response outside the fixed department and position domains', async () => {
  const fixture = dependencies({
    updateEmployeeProfile: async () => {
      fixture.calls.push('update-profile')
      return { ...SAFE_EMPLOYEE, department: '任意部门' }
    },
  })
  const response = await createEmployeeAdminHandler(fixture.values)(
    request({
      operation: 'update_profile',
      employeeId: EMPLOYEE_ID,
      patch: { name: '新姓名' },
    }),
  )

  assert.equal(response.status, 503)
  assert.equal((await body(response)).error.code, 'EMPLOYEE_ADMIN_FAILED')
})

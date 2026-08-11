import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EmployeeAuthError,
  createEmployeeAuthService,
} from './employeeAuthService.js'

const EDGE_SESSION = Object.freeze({
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
  expires_at: 1_800_000_000,
  expires_in: 3600,
})

const ACTIVE_PROFILE = Object.freeze({
  id: 'employee-profile-1',
  employeeNumber: 'SW-001',
  name: '测试员工',
  department: '工程部',
  position: '职长',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  isHiddenSystemAccount: false,
  effectivePermissionKeys: ['module.projects.view'],
})

function createClient(overrides = {}) {
  const calls = {
    order: [],
    invoke: [],
    setSession: [],
    getSession: 0,
    signOut: 0,
    signOutArgs: [],
    rpc: [],
    authStateCallbacks: [],
  }

  const client = {
    functions: {
      invoke: async (name, options) => {
        calls.order.push('invoke')
        calls.invoke.push({ name, options })
        return { data: EDGE_SESSION, error: null }
      },
    },
    auth: {
      setSession: async (session) => {
        calls.order.push('setSession')
        calls.setSession.push(session)
        return {
          data: { session: { ...EDGE_SESSION, user: { id: 'auth-user-1' } } },
          error: null,
        }
      },
      getSession: async () => {
        calls.order.push('getSession')
        calls.getSession += 1
        return { data: { session: { ...EDGE_SESSION } }, error: null }
      },
      onAuthStateChange: (callback) => {
        calls.authStateCallbacks.push(callback)
        return { data: { subscription: { unsubscribe() {} } } }
      },
      signOut: async (options) => {
        calls.order.push('signOut')
        calls.signOut += 1
        calls.signOutArgs.push(options)
        return { error: null }
      },
    },
    rpc: async (name) => {
      calls.order.push('profile')
      calls.rpc.push(name)
      return { data: [ACTIVE_PROFILE], error: null }
    },
  }

  if (overrides.functions) Object.assign(client.functions, overrides.functions)
  if (overrides.auth) Object.assign(client.auth, overrides.auth)
  if (overrides.rpc) client.rpc = overrides.rpc

  return { client, calls }
}

test('employee-number login invokes the Edge endpoint with an exact body before setting session', async () => {
  const { client, calls } = createClient()
  const service = createEmployeeAuthService(client, { configured: true })

  const session = await service.loginWithEmployeeNumber({
    employeeNumber: ' sw-001 ',
    password: 'TemporaryPassword2',
  })

  assert.deepEqual(calls.invoke, [
    {
      name: 'employee-login',
      options: {
        body: {
          employeeNumber: 'SW-001',
          password: 'TemporaryPassword2',
        },
      },
    },
  ])
  assert.deepEqual(calls.setSession, [
    {
      access_token: EDGE_SESSION.access_token,
      refresh_token: EDGE_SESSION.refresh_token,
    },
  ])
  assert.deepEqual(calls.order, ['invoke', 'setSession'])
  assert.equal(session.user.id, 'auth-user-1')
})

test('login rejects non-exact session responses without calling setSession', async () => {
  for (const invalidSession of [
    { ...EDGE_SESSION, internalAlias: 'must-not-reach-browser' },
    { ...EDGE_SESSION, access_token: '' },
    { ...EDGE_SESSION, expires_at: '1800000000' },
    null,
  ]) {
    const { client, calls } = createClient({
      functions: {
        invoke: async () => ({ data: invalidSession, error: null }),
      },
    })
    const service = createEmployeeAuthService(client, { configured: true })

    await assert.rejects(
      service.loginWithEmployeeNumber({
        employeeNumber: 'SW-001',
        password: 'TemporaryPassword2',
      }),
      (error) =>
        error instanceof EmployeeAuthError &&
        error.code === 'AUTH_RESPONSE_INVALID' &&
        error.message === '认证服务响应无效，请稍后重试',
    )
    assert.equal(calls.setSession.length, 0)
  }
})

test('login exposes only safe Edge errors and never upstream details', async () => {
  const response = new Response(
    JSON.stringify({
      error: { code: 'LOGIN_FAILED', message: '员工编号或密码错误' },
      debug: 'database detail must stay hidden',
    }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  )
  const { client } = createClient({
    functions: {
      invoke: async () => ({
        data: null,
        error: { message: 'upstream internal detail', context: response },
      }),
    },
  })
  const service = createEmployeeAuthService(client, { configured: true })

  await assert.rejects(
    service.loginWithEmployeeNumber({
      employeeNumber: 'SW-001',
      password: 'WrongPassword2',
    }),
    (error) =>
      error instanceof EmployeeAuthError &&
      error.code === 'LOGIN_FAILED' &&
      error.message === '员工编号或密码错误' &&
      !error.message.includes('upstream') &&
      !error.message.includes('database'),
  )
})

test('thrown browser-client failures are normalized instead of exposing supplier details', async () => {
  const suppliers = [
    {
      action: (service) =>
        service.loginWithEmployeeNumber({
          employeeNumber: 'SW-001',
          password: 'TemporaryPassword2',
        }),
      overrides: {
        functions: {
          invoke: async () => {
            throw new Error('private edge network detail')
          },
        },
      },
    },
    {
      action: (service) => service.getSession(),
      overrides: {
        auth: {
          getSession: async () => {
            throw new Error('private auth storage detail')
          },
        },
      },
    },
    {
      action: (service) => service.getCurrentEmployee(),
      overrides: {
        rpc: async () => {
          throw new Error('private database detail')
        },
      },
    },
    {
      action: (service) => service.logout(),
      overrides: {
        auth: {
          signOut: async () => {
            throw new Error('private revoke detail')
          },
        },
      },
    },
  ]

  for (const entry of suppliers) {
    const { client } = createClient(entry.overrides)
    const service = createEmployeeAuthService(client, { configured: true })
    await assert.rejects(
      entry.action(service),
      (error) =>
        error instanceof EmployeeAuthError &&
        !error.message.includes('private') &&
        !error.message.includes('detail'),
    )
  }
})

test('getSession and auth-state subscription delegate only to Supabase Auth', async () => {
  const { client, calls } = createClient()
  const service = createEmployeeAuthService(client, { configured: true })
  const callback = () => {}

  const session = await service.getSession()
  const subscription = service.onAuthStateChange(callback)

  assert.deepEqual(session, EDGE_SESSION)
  assert.equal(calls.getSession, 1)
  assert.deepEqual(calls.authStateCallbacks, [callback])
  assert.equal(typeof subscription.unsubscribe, 'function')
})

test('current employee is freshly mapped from current_employee_profile', async () => {
  const { client, calls } = createClient({
    rpc: async (name) => {
      calls.order.push('profile')
      calls.rpc.push(name)
      return {
        data: [
          {
            id: 'employee-profile-1',
            employee_number: 'SW-001',
            name: '测试员工',
            department: '工程部',
            position: '职长',
            employment_status: '在职',
            account_status: 'active',
            must_change_password: true,
            is_hidden_system_account: false,
            effective_permission_keys: ['module.projects.view'],
          },
        ],
        error: null,
      }
    },
  })
  const service = createEmployeeAuthService(client, { configured: true })

  assert.deepEqual(await service.getCurrentEmployee(), {
    ...ACTIVE_PROFILE,
    mustChangePassword: true,
  })
  assert.deepEqual(calls.rpc, ['current_employee_profile'])
})

test('transient session and profile reads stay retryable while rejected credentials terminate', async () => {
  const cases = [
    {
      action: 'getSession',
      overrides: {
        auth: {
          getSession: async () => {
            throw new Error('temporary browser storage failure')
          },
        },
      },
      code: 'AUTH_SERVICE_UNAVAILABLE',
    },
    {
      action: 'getCurrentEmployee',
      overrides: {
        rpc: async () => {
          throw new Error('temporary network failure')
        },
      },
      code: 'AUTH_SERVICE_UNAVAILABLE',
    },
    {
      action: 'getCurrentEmployee',
      overrides: {
        rpc: async () => ({
          data: null,
          error: { code: 'PGRST000', message: 'private upstream detail' },
          status: 503,
        }),
      },
      code: 'AUTH_SERVICE_UNAVAILABLE',
    },
    {
      action: 'getCurrentEmployee',
      overrides: {
        rpc: async () => ({
          data: null,
          error: { code: 'PGRST301', message: 'private token detail' },
          status: 401,
        }),
      },
      code: 'AUTH_SESSION_INVALID',
    },
  ]

  for (const entry of cases) {
    const { client } = createClient(entry.overrides)
    const service = createEmployeeAuthService(client, { configured: true })
    await assert.rejects(
      service[entry.action](),
      (error) =>
        error instanceof EmployeeAuthError &&
        error.code === entry.code &&
        !error.message.includes('private'),
      `${entry.action}:${entry.code}`,
    )
  }
})

test('current employee rejects unknown, disabled, inactive, unlinked, and malformed profiles', async () => {
  const cases = [
    { data: [], code: 'AUTH_SESSION_INVALID' },
    { data: [{ ...ACTIVE_PROFILE, accountStatus: 'disabled' }], code: 'ACCOUNT_UNAVAILABLE' },
    { data: [{ ...ACTIVE_PROFILE, employmentStatus: '离职' }], code: 'ACCOUNT_UNAVAILABLE' },
    { data: [{ ...ACTIVE_PROFILE, employeeNumber: '' }], code: 'AUTH_SESSION_INVALID' },
    { data: [ACTIVE_PROFILE, ACTIVE_PROFILE], code: 'AUTH_SESSION_INVALID' },
  ]

  for (const entry of cases) {
    const { client } = createClient({
      rpc: async () => ({ data: entry.data, error: null }),
    })
    const service = createEmployeeAuthService(client, { configured: true })

    await assert.rejects(
      service.getCurrentEmployee(),
      (error) => error instanceof EmployeeAuthError && error.code === entry.code,
    )
  }
})

test('temporary password change uses the authenticated endpoint and refresh remains caller-controlled', async () => {
  const { client, calls } = createClient({
    functions: {
      invoke: async (name, options) => {
        calls.order.push('changePassword')
        calls.invoke.push({ name, options })
        return { data: { ok: true }, error: null }
      },
    },
  })
  const service = createEmployeeAuthService(client, { configured: true })

  await service.changeTemporaryPassword('NewSecurePassword2')
  const employee = await service.getCurrentEmployee()

  assert.deepEqual(calls.invoke, [
    {
      name: 'employee-change-password',
      options: { body: { password: 'NewSecurePassword2' } },
    },
  ])
  assert.deepEqual(calls.order, ['changePassword', 'profile'])
  assert.equal(employee.mustChangePassword, false)
})

test('terminal password-change account errors remain distinguishable and safe', async () => {
  for (const code of [
    'AUTH_INVALID',
    'AUTH_TOKEN_INVALID',
    'EMPLOYEE_NOT_LINKED',
    'ACCOUNT_DISABLED',
    'EMPLOYEE_INACTIVE',
    'PASSWORD_STATE_SYNC_FAILED',
  ]) {
    const response = new Response(
      JSON.stringify({ error: { code, message: 'upstream text is not trusted' } }),
      { status: 403, headers: { 'content-type': 'application/json' } },
    )
    const { client } = createClient({
      functions: {
        invoke: async () => ({ data: null, error: { context: response } }),
      },
    })
    const service = createEmployeeAuthService(client, { configured: true })

    await assert.rejects(
      service.changeTemporaryPassword('NewSecurePassword2'),
      (error) =>
        error instanceof EmployeeAuthError &&
        error.code === code &&
        !error.message.includes('upstream'),
    )
  }
})

test('logout clears the persisted Supabase session even when remote sign-out fails', async () => {
  let persistedSession = { ...EDGE_SESSION }
  let clearCount = 0
  const { client, calls } = createClient({
    auth: {
      getSession: async () => ({ data: { session: persistedSession }, error: null }),
      signOut: async (options) => {
        calls.signOut += 1
        calls.signOutArgs.push(options)
        return { error: new Error('remote sign-out unavailable') }
      },
    },
  })
  const service = createEmployeeAuthService(client, {
    configured: true,
    clearPersistedSession: async () => {
      clearCount += 1
      persistedSession = null
    },
  })

  await service.logout()

  assert.equal(clearCount, 1)
  assert.deepEqual(calls.signOutArgs, [{ scope: 'local' }])
  assert.equal(await service.getSession(), null)
})

test('logout calls Supabase Auth signOut and configuration errors fail closed before network use', async () => {
  const { client, calls } = createClient()
  const configuredService = createEmployeeAuthService(client, { configured: true })
  await configuredService.logout()
  assert.equal(calls.signOut, 1)
  assert.deepEqual(calls.signOutArgs, [{ scope: 'local' }])

  const unconfiguredService = createEmployeeAuthService(client, { configured: false })
  for (const action of [
    () => unconfiguredService.getSession(),
    () => unconfiguredService.getCurrentEmployee(),
    () =>
      unconfiguredService.loginWithEmployeeNumber({
        employeeNumber: 'SW-001',
        password: 'TemporaryPassword2',
      }),
    () => unconfiguredService.changeTemporaryPassword('NewSecurePassword2'),
    () => unconfiguredService.logout(),
  ]) {
    await assert.rejects(
      action(),
      (error) =>
        error instanceof EmployeeAuthError && error.code === 'CONFIGURATION_ERROR',
    )
  }
  assert.deepEqual(calls.order, ['signOut'])
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmployeeBootstrapAdminHandler, findAuthUsersByEmail } from './handler.js'
import { runBootstrap } from '../../../scripts/bootstrap-sw000.mjs'

const SERVER_SECRET_KEY = 'server-only-secret-key-value'
const PUBLIC_KEY = 'browser-publishable-key-value'
const BOOTSTRAP_PASSWORD = 'ServerOnlyBootstrapValue2468'
const INTERNAL_ALIAS = 'opaque-bootstrap-identity@auth.invalid'
const AUTH_USER_ID = 'auth-sw000'
const LEGAL_PROFILE = Object.freeze({
  id: 'profile-sw000',
  employee_number: 'SW-000',
  auth_user_id: AUTH_USER_ID,
  name: 'システム管理者',
  department: '总务部',
  position: '社长',
  employment_status: '在职',
  account_status: 'active',
  must_change_password: false,
  is_hidden_system_account: true,
  deleted_at: null,
})

function bootstrapRequest({ apiKey = SERVER_SECRET_KEY, body = {}, headers = {} } = {}) {
  return new Request('https://edge.example.test/employee-bootstrap-admin', {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function createDependencies({
  profile = null,
  authUsers = [],
  env = {},
  createAuthError = null,
  createProfileError = null,
  linkProfileError = null,
  deleteAuthError = null,
} = {}) {
  let currentProfile = profile ? { ...profile } : null
  const currentAuthUsers = authUsers.map((user) => ({ ...user }))
  const calls = {
    createAdminClient: 0,
    deriveAuthEmail: [],
    findAuthUsersByEmail: [],
    getAuthUserById: [],
    findProfileByNumber: [],
    createAuthUser: [],
    createProfile: [],
    linkProfile: [],
    deleteAuthUser: [],
  }
  const adminClient = { kind: 'admin' }
  const environment = {
    SUPABASE_SECRET_KEY: SERVER_SECRET_KEY,
    SUPABASE_PUBLISHABLE_KEY: PUBLIC_KEY,
    SW000_BOOTSTRAP_PASSWORD: BOOTSTRAP_PASSWORD,
    ...env,
  }
  const dependencies = {
    getEnv: (name) => environment[name],
    createAdminClient: async () => {
      calls.createAdminClient += 1
      return adminClient
    },
    deriveAuthEmail: async (employeeNumber) => {
      calls.deriveAuthEmail.push(employeeNumber)
      return INTERNAL_ALIAS
    },
    findAuthUsersByEmail: async (client, email) => {
      calls.findAuthUsersByEmail.push({ client, email })
      return currentAuthUsers.filter((user) => user.email === email)
    },
    getAuthUserById: async (client, authUserId) => {
      calls.getAuthUserById.push({ client, authUserId })
      return currentAuthUsers.find((user) => user.id === authUserId) ?? null
    },
    findProfileByNumber: async (client, employeeNumber) => {
      calls.findProfileByNumber.push({ client, employeeNumber })
      return currentProfile ? { ...currentProfile } : null
    },
    createAuthUser: async (client, input) => {
      calls.createAuthUser.push({ client, input })
      if (createAuthError) throw createAuthError
      const user = { id: AUTH_USER_ID, email: input.email }
      currentAuthUsers.push(user)
      return user
    },
    createProfile: async (client, input) => {
      calls.createProfile.push({ client, input })
      if (createProfileError) throw createProfileError
      currentProfile = { id: 'profile-sw000', ...input }
      return { ...currentProfile }
    },
    linkProfile: async (client, input) => {
      calls.linkProfile.push({ client, input })
      if (linkProfileError) throw linkProfileError
      currentProfile = { ...currentProfile, auth_user_id: input.authUserId }
      return { ...currentProfile }
    },
    deleteAuthUser: async (client, authUserId) => {
      calls.deleteAuthUser.push({ client, authUserId })
      if (deleteAuthError) throw deleteAuthError
      const index = currentAuthUsers.findIndex((user) => user.id === authUserId)
      if (index >= 0) currentAuthUsers.splice(index, 1)
    },
  }

  return {
    calls,
    dependencies,
    state: {
      profile: () => currentProfile,
      authUsers: () => currentAuthUsers,
      setProfile: (nextProfile) => {
        currentProfile = nextProfile ? { ...nextProfile } : null
      },
    },
  }
}

async function responseBody(response) {
  return JSON.parse(await response.text())
}

test('bootstrap requires an exact server apikey before reading password or mutating state', async () => {
  for (const apiKey of ['', PUBLIC_KEY, `${SERVER_SECRET_KEY}-wrong`]) {
    let passwordReads = 0
    const { calls, dependencies } = createDependencies()
    const getEnv = dependencies.getEnv
    dependencies.getEnv = (name) => {
      if (name === 'SW000_BOOTSTRAP_PASSWORD') passwordReads += 1
      return getEnv(name)
    }

    const response = await createEmployeeBootstrapAdminHandler(dependencies)(
      bootstrapRequest({ apiKey }),
    )

    assert.equal(response.status, 401)
    assert.equal((await responseBody(response)).error.code, 'BOOTSTRAP_UNAUTHORIZED')
    assert.equal(passwordReads, 0)
    assert.equal(calls.createAdminClient, 0)
    assert.equal(calls.deriveAuthEmail.length, 0)
  }
})

test('bootstrap accepts rotated secret-key lists and rejects password-bearing request bodies', async () => {
  const rotatedKey = 'rotated-server-secret-key'
  const setup = createDependencies({
    env: {
      SUPABASE_SECRET_KEY: '',
      SUPABASE_SECRET_KEYS: JSON.stringify({
        default: SERVER_SECRET_KEY,
        bootstrap: rotatedKey,
      }),
    },
  })

  const rejected = await createEmployeeBootstrapAdminHandler(setup.dependencies)(
    bootstrapRequest({ apiKey: rotatedKey, body: { password: BOOTSTRAP_PASSWORD } }),
  )
  const text = await rejected.text()

  assert.equal(rejected.status, 400)
  assert.equal(JSON.parse(text).error.code, 'BOOTSTRAP_INPUT_INVALID')
  assert.equal(setup.calls.createAdminClient, 0)
  assert.doesNotMatch(text, /ServerOnlyBootstrapValue2468/i)
})

test('missing bootstrap password fails closed after authorization without creating clients', async () => {
  const { calls, dependencies } = createDependencies({
    env: { SW000_BOOTSTRAP_PASSWORD: '   ' },
  })

  const response = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())

  assert.equal(response.status, 500)
  assert.equal((await responseBody(response)).error.code, 'CONFIGURATION_ERROR')
  assert.equal(calls.createAdminClient, 0)
  assert.equal(calls.deriveAuthEmail.length, 0)
})

test('none/none state creates one Auth user and the exact hidden SW-000 profile', async () => {
  const { calls, dependencies, state } = createDependencies()

  const response = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())
  const text = await response.text()

  assert.equal(response.status, 200)
  assert.deepEqual(JSON.parse(text), { ok: true, employeeNumber: 'SW-000', created: true })
  assert.deepEqual(calls.deriveAuthEmail, ['SW-000'])
  assert.equal(calls.createAuthUser.length, 1)
  assert.deepEqual(calls.createAuthUser[0].input, {
    email: INTERNAL_ALIAS,
    password: BOOTSTRAP_PASSWORD,
  })
  assert.equal(calls.createProfile.length, 1)
  assert.deepEqual(
    {
      employee_number: state.profile().employee_number,
      auth_user_id: state.profile().auth_user_id,
      department: state.profile().department,
      position: state.profile().position,
      employment_status: state.profile().employment_status,
      account_status: state.profile().account_status,
      must_change_password: state.profile().must_change_password,
      is_hidden_system_account: state.profile().is_hidden_system_account,
      deleted_at: state.profile().deleted_at,
    },
    {
      employee_number: 'SW-000',
      auth_user_id: AUTH_USER_ID,
      department: '总务部',
      position: '社长',
      employment_status: '在职',
      account_status: 'active',
      must_change_password: false,
      is_hidden_system_account: true,
      deleted_at: null,
    },
  )
  assert.doesNotMatch(text, /ServerOnlyBootstrapValue2468|auth\.invalid|server-only-secret/i)
})

test('derived Auth-only state creates the profile without resetting the existing password', async () => {
  const { calls, dependencies } = createDependencies({
    authUsers: [{ id: AUTH_USER_ID, email: INTERNAL_ALIAS }],
  })

  const response = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())

  assert.equal(response.status, 200)
  assert.deepEqual(await responseBody(response), {
    ok: true,
    employeeNumber: 'SW-000',
    created: true,
  })
  assert.equal(calls.createAuthUser.length, 0)
  assert.equal(calls.createProfile.length, 1)
  assert.equal(calls.deleteAuthUser.length, 0)
})

test('exact profile with a null link safely creates and links the derived Auth identity', async () => {
  const { calls, dependencies } = createDependencies({
    profile: { ...LEGAL_PROFILE, auth_user_id: null },
  })

  const response = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())

  assert.equal(response.status, 200)
  assert.equal((await responseBody(response)).created, true)
  assert.equal(calls.createAuthUser.length, 1)
  assert.equal(calls.createProfile.length, 0)
  assert.deepEqual(calls.linkProfile[0].input, {
    profileId: LEGAL_PROFILE.id,
    authUserId: AUTH_USER_ID,
  })
})

test('already-correct association is idempotent and never changes or resends its password', async () => {
  const { calls, dependencies } = createDependencies({
    profile: LEGAL_PROFILE,
    authUsers: [{ id: AUTH_USER_ID, email: INTERNAL_ALIAS }],
  })

  const first = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())
  const second = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())

  assert.deepEqual(await responseBody(first), {
    ok: true,
    employeeNumber: 'SW-000',
    created: false,
  })
  assert.deepEqual(await responseBody(second), {
    ok: true,
    employeeNumber: 'SW-000',
    created: false,
  })
  assert.equal(calls.createAuthUser.length, 0)
  assert.equal(calls.createProfile.length, 0)
  assert.equal(calls.linkProfile.length, 0)
  assert.equal(calls.deleteAuthUser.length, 0)
})

test('ambiguous or mismatched Auth/profile states fail closed without mutation', async () => {
  const cases = [
    {
      profile: { ...LEGAL_PROFILE, department: '财务部' },
      authUsers: [{ id: AUTH_USER_ID, email: INTERNAL_ALIAS }],
    },
    {
      profile: { ...LEGAL_PROFILE, auth_user_id: 'different-auth-user' },
      authUsers: [{ id: AUTH_USER_ID, email: INTERNAL_ALIAS }],
    },
    {
      profile: LEGAL_PROFILE,
      authUsers: [{ id: AUTH_USER_ID, email: 'different-internal-identity@auth.invalid' }],
    },
    {
      profile: null,
      authUsers: [
        { id: AUTH_USER_ID, email: INTERNAL_ALIAS },
        { id: 'duplicate-user', email: INTERNAL_ALIAS },
      ],
    },
  ]

  for (const item of cases) {
    const { calls, dependencies } = createDependencies(item)
    const response = await createEmployeeBootstrapAdminHandler(dependencies)(bootstrapRequest())
    const text = await response.text()

    assert.equal(response.status, 409)
    assert.equal(JSON.parse(text).error.code, 'BOOTSTRAP_STATE_CONFLICT')
    assert.equal(calls.createAuthUser.length, 0)
    assert.equal(calls.createProfile.length, 0)
    assert.equal(calls.linkProfile.length, 0)
    assert.doesNotMatch(text, /auth\.invalid|different-auth-user|duplicate-user/i)
  }
})

test('an Auth-only partial state is retained and completed safely on retry', async () => {
  const setup = createDependencies()
  const baseCreateProfile = setup.dependencies.createProfile
  let failOnce = true
  setup.dependencies.createProfile = async (...args) => {
    if (failOnce) {
      failOnce = false
      setup.calls.createProfile.push({ client: args[0], input: args[1] })
      throw new Error(`database dump ${BOOTSTRAP_PASSWORD}`)
    }
    return baseCreateProfile(...args)
  }
  const handler = createEmployeeBootstrapAdminHandler(setup.dependencies)

  const failed = await handler(bootstrapRequest())
  const failedText = await failed.text()

  assert.equal(failed.status, 503)
  assert.equal(JSON.parse(failedText).error.code, 'BOOTSTRAP_FAILED')
  assert.equal(setup.calls.createAuthUser.length, 1)
  assert.equal(setup.calls.deleteAuthUser.length, 0)
  assert.equal(setup.state.authUsers().length, 1)
  assert.equal(setup.state.profile(), null)
  assert.doesNotMatch(failedText, /database dump|ServerOnlyBootstrapValue2468/i)

  const retried = await handler(bootstrapRequest())

  assert.equal(retried.status, 200)
  assert.equal((await responseBody(retried)).created, true)
  assert.equal(setup.calls.createAuthUser.length, 1)
  assert.equal(setup.state.profile().auth_user_id, AUTH_USER_ID)
})

test('bootstrap never deletes an Auth user adopted by a concurrent profile flow', async () => {
  const setup = createDependencies()
  const baseFindProfile = setup.dependencies.findProfileByNumber
  let profileReads = 0
  setup.dependencies.findProfileByNumber = async (...args) => {
    profileReads += 1
    if (profileReads === 3) throw new Error('transient final-state read failure')
    return baseFindProfile(...args)
  }
  setup.dependencies.createProfile = async (_client, input) => {
    setup.calls.createProfile.push({ client: { kind: 'admin' }, input })
    setup.state.setProfile({ id: 'profile-sw000', ...input })
    throw new Error('concurrent flow adopted the Auth user')
  }

  const response = await createEmployeeBootstrapAdminHandler(setup.dependencies)(
    bootstrapRequest(),
  )

  assert.equal(response.status, 503)
  assert.equal(setup.state.profile().auth_user_id, AUTH_USER_ID)
  assert.equal(setup.state.authUsers().some((user) => user.id === AUTH_USER_ID), true)
  assert.equal(setup.calls.deleteAuthUser.length, 0)
})

test('duplicate Auth creation race rereads the unique derived identity and continues safely', async () => {
  const setup = createDependencies()
  setup.dependencies.createAuthUser = async (_client, input) => {
    setup.calls.createAuthUser.push({ client: { kind: 'admin' }, input })
    setup.state.authUsers().push({ id: AUTH_USER_ID, email: INTERNAL_ALIAS })
    throw new Error('duplicate Auth identity')
  }

  const response = await createEmployeeBootstrapAdminHandler(setup.dependencies)(
    bootstrapRequest(),
  )

  assert.equal(response.status, 200)
  assert.equal((await responseBody(response)).created, true)
  assert.equal(setup.calls.createAuthUser.length, 1)
  assert.equal(setup.calls.createProfile.length, 1)
  assert.equal(setup.calls.deleteAuthUser.length, 0)
})

test('profile insert and null-link races succeed only after exact final-state reread', async () => {
  const insertRace = createDependencies({
    authUsers: [{ id: AUTH_USER_ID, email: INTERNAL_ALIAS }],
  })
  insertRace.dependencies.createProfile = async (_client, input) => {
    insertRace.calls.createProfile.push({ client: { kind: 'admin' }, input })
    insertRace.state.setProfile({ id: 'profile-sw000', ...input })
    throw new Error('duplicate employee profile')
  }

  const inserted = await createEmployeeBootstrapAdminHandler(insertRace.dependencies)(
    bootstrapRequest(),
  )
  assert.equal(inserted.status, 200)
  assert.equal((await responseBody(inserted)).created, false)
  assert.equal(insertRace.calls.deleteAuthUser.length, 0)

  const linkRace = createDependencies({
    profile: { ...LEGAL_PROFILE, auth_user_id: null },
    authUsers: [{ id: AUTH_USER_ID, email: INTERNAL_ALIAS }],
  })
  linkRace.dependencies.linkProfile = async (_client, input) => {
    linkRace.calls.linkProfile.push({ client: { kind: 'admin' }, input })
    linkRace.state.setProfile({ ...LEGAL_PROFILE, auth_user_id: input.authUserId })
    throw new Error('concurrent profile link')
  }

  const linked = await createEmployeeBootstrapAdminHandler(linkRace.dependencies)(
    bootstrapRequest(),
  )
  assert.equal(linked.status, 200)
  assert.equal((await responseBody(linked)).created, false)
  assert.equal(linkRace.calls.deleteAuthUser.length, 0)
})

test('default Auth lookup paginates until the derived alias is found', async () => {
  const calls = []
  const target = { id: AUTH_USER_ID, email: INTERNAL_ALIAS }
  const client = {
    auth: {
      admin: {
        listUsers: async ({ page, perPage }) => {
          calls.push({ page, perPage })
          if (page === 1) {
            return {
              data: {
                users: Array.from({ length: 100 }, (_, index) => ({
                  id: `page-one-${index}`,
                  email: `page-one-${index}@auth.invalid`,
                })),
                nextPage: 2,
              },
              error: null,
            }
          }
          return { data: { users: [target], nextPage: null }, error: null }
        },
      },
    },
  }

  const users = await findAuthUsersByEmail(client, INTERNAL_ALIAS)

  assert.deepEqual(users, [target])
  assert.deepEqual(calls, [
    { page: 1, perPage: 100 },
    { page: 2, perPage: 100 },
  ])
})

test('default Auth lookup stops on an explicitly final full page', async () => {
  let calls = 0
  const client = {
    auth: {
      admin: {
        listUsers: async () => {
          calls += 1
          return {
            data: {
              users: Array.from({ length: 100 }, (_, index) => ({
                id: `final-page-${index}`,
                email: `final-page-${index}@auth.invalid`,
              })),
              nextPage: null,
            },
            error: null,
          }
        },
      },
    },
  }

  const users = await findAuthUsersByEmail(client, INTERNAL_ALIAS)

  assert.deepEqual(users, [])
  assert.equal(calls, 1)
})

test('bootstrap script sends only apikey, never reads the password, and prints a safe summary', async () => {
  const calls = []
  const output = []
  const errors = []
  const environment = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEYS: JSON.stringify({ bootstrap: SERVER_SECRET_KEY }),
    get SW000_BOOTSTRAP_PASSWORD() {
      throw new Error('script must not read the Edge password secret')
    },
  }

  const exitCode = await runBootstrap({
    env: environment,
    fetchImpl: async (...args) => {
      calls.push(args)
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, employeeNumber: 'SW-000', created: true }),
      }
    },
    writeOut: (message) => output.push(message),
    writeErr: (message) => errors.push(message),
  })

  assert.equal(exitCode, 0)
  assert.equal(calls.length, 1)
  assert.equal(
    calls[0][0],
    'https://project.supabase.co/functions/v1/employee-bootstrap-admin',
  )
  assert.equal(calls[0][1].method, 'POST')
  assert.equal(calls[0][1].headers.apikey, SERVER_SECRET_KEY)
  assert.equal(calls[0][1].headers.Authorization, undefined)
  assert.equal(calls[0][1].body, '{}')
  assert.equal(calls[0][1].redirect, 'error')
  assert.ok(calls[0][1].signal instanceof AbortSignal)
  assert.deepEqual(errors, [])
  assert.equal(output.length, 1)
  assert.match(output[0], /SW-000.*created/i)
  assert.doesNotMatch(
    JSON.stringify({ output, errors }),
    /ServerOnlyBootstrapValue2468|server-only-secret-key-value/i,
  )
})

test('bootstrap script accepts the bracketed IPv6 loopback used by URL.hostname', async () => {
  const calls = []
  const exitCode = await runBootstrap({
    env: {
      SUPABASE_URL: 'http://[::1]:54321',
      SUPABASE_SECRET_KEY: SERVER_SECRET_KEY,
    },
    fetchImpl: async (...args) => {
      calls.push(args)
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, employeeNumber: 'SW-000', created: false }),
      }
    },
    writeOut: () => {},
    writeErr: () => assert.fail('must not reject local IPv6 loopback'),
  })

  assert.equal(exitCode, 0)
  assert.equal(calls[0][0], 'http://[::1]:54321/functions/v1/employee-bootstrap-admin')
})

test('bootstrap script fails closed without config and never prints raw remote failures', async () => {
  let fetchCalls = 0
  const missingErrors = []
  const missingCode = await runBootstrap({
    env: {},
    fetchImpl: async () => {
      fetchCalls += 1
      throw new Error('must not fetch')
    },
    writeOut: () => assert.fail('must not print success'),
    writeErr: (message) => missingErrors.push(message),
  })
  assert.equal(missingCode, 1)
  assert.equal(fetchCalls, 0)
  assert.deepEqual(missingErrors, ['SW-000 bootstrap configuration is missing.'])

  const remoteErrors = []
  const remoteCode = await runBootstrap({
    env: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: SERVER_SECRET_KEY,
    },
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({ raw: BOOTSTRAP_PASSWORD, key: SERVER_SECRET_KEY }),
    }),
    writeOut: () => assert.fail('must not print success'),
    writeErr: (message) => remoteErrors.push(message),
  })
  assert.equal(remoteCode, 1)
  assert.deepEqual(remoteErrors, ['SW-000 bootstrap failed (HTTP 503).'])
  assert.doesNotMatch(JSON.stringify(remoteErrors), /ServerOnly|server-only-secret/i)
})

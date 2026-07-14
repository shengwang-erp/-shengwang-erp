import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  EmployeeAdminError,
  createEmployeeAdminService,
} from './employeeAdminService.js'

const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333'
const REQUEST_ID = '22222222-2222-4222-8222-222222222222'

const DIRECTORY_ROW = Object.freeze({
  id: EMPLOYEE_ID,
  employeeNumber: 'SW-001',
  name: '测试员工',
  department: '工程部',
  position: '职长',
  employmentStatus: '在职',
  accountStatus: 'active',
})

const SAFE_EMPLOYEE = Object.freeze({
  ...DIRECTORY_ROW,
  mustChangePassword: true,
})

const BASE_DETAIL = Object.freeze({
  ...SAFE_EMPLOYEE,
  legacyEmployeeId: 'E001',
  hireDate: '2024-01-01',
  resignDate: null,
  level: '3星',
  phone: '09000000000',
  remark: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2026-07-14T00:00:00.000Z',
})

const SENSITIVE_DETAIL = Object.freeze({
  ...BASE_DETAIL,
  gender: '女',
  birthDate: '1990-01-02',
  nationality: '日本',
  emergencyContactName: null,
  emergencyContactPhone: null,
  currentAddress: '东京都',
  visaAgency: null,
  visaType: null,
  visaExpireDate: null,
  passportNumber: null,
  residenceCardNumber: null,
  baseSalary: 320000,
  dailySalary: null,
  hourlyWage: null,
  salaryRemark: '月薪',
})

function createClient({ rpc, invoke } = {}) {
  const calls = { rpc: [], invoke: [] }
  const client = {
    rpc: async (...args) => {
      calls.rpc.push(args)
      return rpc ? rpc(...args) : { data: [], error: null }
    },
    functions: {
      invoke: async (...args) => {
        calls.invoke.push(args)
        return invoke
          ? invoke(...args)
          : { data: { employee: SAFE_EMPLOYEE }, error: null }
      },
    },
  }
  return { client, calls }
}

function edgeFailure(code, status = 503) {
  const context = new Response(
    JSON.stringify({
      error: { code, message: '不可信的服务端消息' },
      debug: 'private-database-detail',
    }),
    { status, headers: { 'content-type': 'application/json' } },
  )
  return {
    data: null,
    error: { message: 'private-provider-detail', context },
  }
}

test('missing configuration fails before any RPC or Edge invocation', async () => {
  const { client, calls } = createClient()
  const service = createEmployeeAdminService(client, { configured: false })

  await assert.rejects(
    service.listEmployeeDirectory(),
    (error) =>
      error instanceof EmployeeAdminError &&
      error.code === 'CONFIGURATION_ERROR' &&
      error.authInvalid === false,
  )
  assert.deepEqual(calls, { rpc: [], invoke: [] })
})

test('directory uses the exact RPC, maps seven safe fields, and removes SW-000', async () => {
  const { client, calls } = createClient({
    rpc: async () => ({
      data: [
        DIRECTORY_ROW,
        { ...DIRECTORY_ROW, id: '33333333-3333-4333-8333-333333333333', employeeNumber: 'SW-000' },
      ],
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  assert.deepEqual(await service.listEmployeeDirectory(), [DIRECTORY_ROW])
  assert.deepEqual(calls.rpc, [['employee_directory']])
  assert.deepEqual(calls.invoke, [])
})

test('directory rejects malformed or expanded supplier rows', async () => {
  for (const row of [
    { ...DIRECTORY_ROW, authUserId: 'must-not-reach-page' },
    { ...DIRECTORY_ROW, employeeNumber: 'E001' },
    { ...DIRECTORY_ROW, department: '现场' },
    { ...DIRECTORY_ROW, accountStatus: 'banned' },
    null,
  ]) {
    const { client } = createClient({
      rpc: async () => ({ data: [row], error: null }),
    })
    const service = createEmployeeAdminService(client, { configured: true })
    await assert.rejects(
      service.listEmployeeDirectory(),
      (error) =>
        error instanceof EmployeeAdminError &&
        error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
    )
  }
})

test('detail uses the exact RPC and preserves conditional sensitive-field presence', async () => {
  for (const expected of [null, BASE_DETAIL, SENSITIVE_DETAIL]) {
    const { client, calls } = createClient({
      rpc: async () => ({ data: expected, error: null }),
    })
    const service = createEmployeeAdminService(client, { configured: true })

    assert.deepEqual(await service.getEmployeeProfileDetail(EMPLOYEE_ID), expected)
    assert.deepEqual(calls.rpc, [
      ['employee_profile_detail', { p_employee_id: EMPLOYEE_ID }],
    ])
  }
})

test('detail rejects invalid IDs, partial sensitive groups, and unknown response keys', async () => {
  const { client, calls } = createClient()
  const service = createEmployeeAdminService(client, { configured: true })
  await assert.rejects(
    service.getEmployeeProfileDetail('not-a-uuid'),
    (error) => error.code === 'EMPLOYEE_ADMIN_INPUT_INVALID',
  )
  assert.deepEqual(calls.rpc, [])

  for (const detail of [
    { ...BASE_DETAIL, passportNumber: 'P123' },
    { ...BASE_DETAIL, baseSalary: 1000 },
    { ...BASE_DETAIL, authUserId: 'hidden-auth-id' },
  ]) {
    const entry = createClient({ rpc: async () => ({ data: detail, error: null }) })
    const entryService = createEmployeeAdminService(entry.client, { configured: true })
    await assert.rejects(
      entryService.getEmployeeProfileDetail(EMPLOYEE_ID),
      (error) => error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
    )
  }
})

test('detail rejects an otherwise valid employee returned for a different target UUID', async () => {
  const { client } = createClient({
    rpc: async () => ({
      data: { ...BASE_DETAIL, id: OTHER_EMPLOYEE_ID, employeeNumber: 'SW-002' },
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  await assert.rejects(
    service.getEmployeeProfileDetail(EMPLOYEE_ID),
    (error) => error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
  )
})

test('provision sends an exact allowlisted and normalized profile', async () => {
  const { client, calls } = createClient({
    invoke: async () => ({
      data: { employee: SAFE_EMPLOYEE, initialPassword: 'SecureStart2A' },
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  const result = await service.provisionEmployee({
    requestId: REQUEST_ID,
    profile: {
      name: '  新员工  ',
      department: '工程部',
      position: '中工',
      employmentStatus: '在职',
      hireDate: '',
      phone: ' 09011112222 ',
      gender: '女',
      baseSalary: '320000',
      dailySalary: '',
      salaryRemark: '  ',
    },
  })

  assert.deepEqual(calls.invoke, [
    [
      'employee-provision',
      {
        body: {
          requestId: REQUEST_ID,
          profile: {
            name: '新员工',
            department: '工程部',
            position: '中工',
            employmentStatus: '在职',
            hireDate: null,
            phone: '09011112222',
            gender: '女',
            baseSalary: 320000,
            dailySalary: null,
            salaryRemark: null,
          },
        },
      },
    ],
  ])
  assert.deepEqual(result, {
    employee: SAFE_EMPLOYEE,
    initialPassword: 'SecureStart2A',
  })
})

test('provision validates fixed required fields and rejects unknown or security fields locally', async () => {
  const invalidProfiles = [
    { department: '工程部', position: '中工' },
    { name: '员工', department: '', position: '中工' },
    { name: '员工', department: '现场', position: '中工' },
    { name: '员工', department: '工程部', position: '操作员' },
    { name: '员工', department: '工程部', position: '中工', hireDate: '2026-02-30' },
    { name: '员工', department: '工程部', position: '中工', baseSalary: -1 },
    { name: '员工', department: '工程部', position: '中工', employeeNumber: 'SW-900' },
    { name: '员工', department: '工程部', position: '中工', authUserId: 'secret' },
    { name: '员工', department: '工程部', position: '中工', role: 'admin' },
    { name: '员工', department: '工程部', position: '中工', salaryType: '月薪' },
  ]

  for (const profile of invalidProfiles) {
    const { client, calls } = createClient()
    const service = createEmployeeAdminService(client, { configured: true })
    await assert.rejects(
      service.provisionEmployee({ requestId: REQUEST_ID, profile }),
      (error) => error.code === 'EMPLOYEE_ADMIN_INPUT_INVALID',
    )
    assert.deepEqual(calls.invoke, [])
  }
})

test('completed provision replay succeeds without inventing a password', async () => {
  const { client } = createClient({
    invoke: async () => ({ data: { employee: SAFE_EMPLOYEE }, error: null }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  const result = await service.provisionEmployee({
    requestId: REQUEST_ID,
    profile: {
      name: '员工',
      department: '工程部',
      position: '中工',
    },
  })

  assert.deepEqual(result, { employee: SAFE_EMPLOYEE })
  assert.equal(Object.hasOwn(result, 'initialPassword'), false)
})

test('a failed provision retry preserves the caller-owned request ID', async () => {
  let attempt = 0
  const { client, calls } = createClient({
    invoke: async () => {
      attempt += 1
      return attempt === 1
        ? edgeFailure('PROVISION_RETRY_REQUIRED', 409)
        : { data: { employee: SAFE_EMPLOYEE }, error: null }
    },
  })
  const service = createEmployeeAdminService(client, { configured: true })
  const input = {
    requestId: REQUEST_ID,
    profile: { name: '员工', department: '工程部', position: '中工' },
  }

  await assert.rejects(service.provisionEmployee(input))
  await service.provisionEmployee(input)

  assert.equal(calls.invoke.length, 2)
  assert.equal(calls.invoke[0][1].body.requestId, REQUEST_ID)
  assert.equal(calls.invoke[1][1].body.requestId, REQUEST_ID)
})

test('update sends only a non-empty normalized patch and rejects immutable fields', async () => {
  const { client, calls } = createClient()
  const service = createEmployeeAdminService(client, { configured: true })

  assert.deepEqual(
    await service.updateProfile({
      employeeId: EMPLOYEE_ID,
      patch: { name: '  新姓名 ', resignDate: '', dailySalary: '12000' },
    }),
    { employee: SAFE_EMPLOYEE },
  )
  assert.deepEqual(calls.invoke, [
    [
      'employee-admin',
      {
        body: {
          operation: 'update_profile',
          employeeId: EMPLOYEE_ID,
          patch: { name: '新姓名', resignDate: null, dailySalary: 12000 },
        },
      },
    ],
  ])

  for (const patch of [{}, { employeeNumber: 'SW-999' }, { accountStatus: 'disabled' }, { permissions: [] }]) {
    await assert.rejects(
      service.updateProfile({ employeeId: EMPLOYEE_ID, patch }),
      (error) => error.code === 'EMPLOYEE_ADMIN_INPUT_INVALID',
    )
  }
  assert.equal(calls.invoke.length, 1)
})

test('update rejects an otherwise valid employee returned for a different target UUID', async () => {
  const { client } = createClient({
    invoke: async () => ({
      data: {
        employee: { ...SAFE_EMPLOYEE, id: OTHER_EMPLOYEE_ID, employeeNumber: 'SW-002' },
      },
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  await assert.rejects(
    service.updateProfile({ employeeId: EMPLOYEE_ID, patch: { name: '员工' } }),
    (error) => error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
  )
})

test('account status uses the exact field and accepts only active or disabled', async () => {
  const { client, calls } = createClient()
  const service = createEmployeeAdminService(client, { configured: true })

  assert.deepEqual(
    await service.setAccountStatus({ employeeId: EMPLOYEE_ID, accountStatus: 'disabled' }),
    { employee: SAFE_EMPLOYEE },
  )
  assert.deepEqual(calls.invoke, [
    [
      'employee-admin',
      {
        body: {
          operation: 'set_account_status',
          employeeId: EMPLOYEE_ID,
          accountStatus: 'disabled',
        },
      },
    ],
  ])

  await assert.rejects(
    service.setAccountStatus({ employeeId: EMPLOYEE_ID, status: 'disabled' }),
    (error) => error.code === 'EMPLOYEE_ADMIN_INPUT_INVALID',
  )
  await assert.rejects(
    service.setAccountStatus({ employeeId: EMPLOYEE_ID, accountStatus: 'banned' }),
    (error) => error.code === 'EMPLOYEE_ADMIN_INPUT_INVALID',
  )
  assert.equal(calls.invoke.length, 1)
})

test('account status rejects an otherwise valid employee returned for a different target UUID', async () => {
  const { client } = createClient({
    invoke: async () => ({
      data: {
        employee: { ...SAFE_EMPLOYEE, id: OTHER_EMPLOYEE_ID, employeeNumber: 'SW-002' },
      },
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  await assert.rejects(
    service.setAccountStatus({ employeeId: EMPLOYEE_ID, accountStatus: 'disabled' }),
    (error) => error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
  )
})

test('reset uses the exact operation and maps temporaryPassword to initialPassword', async () => {
  const { client, calls } = createClient({
    invoke: async () => ({
      data: { employee: SAFE_EMPLOYEE, temporaryPassword: 'ResetSecure2A' },
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  assert.deepEqual(
    await service.resetTemporaryPassword({ employeeId: EMPLOYEE_ID }),
    { employee: SAFE_EMPLOYEE, initialPassword: 'ResetSecure2A' },
  )
  assert.deepEqual(calls.invoke, [
    [
      'employee-admin',
      {
        body: { operation: 'reset_temporary_password', employeeId: EMPLOYEE_ID },
      },
    ],
  ])
})

test('reset rejects a password response bound to a different target UUID', async () => {
  const { client } = createClient({
    invoke: async () => ({
      data: {
        employee: { ...SAFE_EMPLOYEE, id: OTHER_EMPLOYEE_ID, employeeNumber: 'SW-002' },
        temporaryPassword: 'ResetSecure2A',
      },
      error: null,
    }),
  })
  const service = createEmployeeAdminService(client, { configured: true })

  await assert.rejects(
    service.resetTemporaryPassword({ employeeId: EMPLOYEE_ID }),
    (error) => error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
  )
})

test('mutation responses reject extra aliases, Auth IDs, permissions, and credential keys', async () => {
  for (const extra of [
    { internalAuthAlias: 'hidden' },
    { authUserId: 'hidden' },
    { role: 'admin' },
    { effectivePermissionKeys: ['all'] },
    { temporaryPassword: 'must-not-appear-inside-employee' },
  ]) {
    const { client } = createClient({
      invoke: async () => ({
        data: { employee: { ...SAFE_EMPLOYEE, ...extra } },
        error: null,
      }),
    })
    const service = createEmployeeAdminService(client, { configured: true })
    await assert.rejects(
      service.updateProfile({ employeeId: EMPLOYEE_ID, patch: { name: '员工' } }),
      (error) => error.code === 'EMPLOYEE_ADMIN_RESPONSE_INVALID',
    )
  }
})

test('known Edge errors use safe messages while only terminal auth codes invalidate the session', async () => {
  const knownCases = [
    ['PERSONNEL_ADMIN_REQUIRED', 403, '没有人员管理权限', false],
    ['SENSITIVE_PERMISSION_REQUIRED', 403, '没有修改敏感员工资料的权限', false],
    ['AUTH_INVALID', 401, '登录状态无效，请重新登录', true],
    ['ACCOUNT_DISABLED', 403, '当前账号已停用，请重新登录', true],
  ]

  for (const [code, status, message, authInvalid] of knownCases) {
    const { client } = createClient({ invoke: async () => edgeFailure(code, status) })
    const service = createEmployeeAdminService(client, { configured: true })
    await assert.rejects(
      service.setAccountStatus({ employeeId: EMPLOYEE_ID, accountStatus: 'active' }),
      (error) =>
        error instanceof EmployeeAdminError &&
        error.code === code &&
        error.message === message &&
        error.authInvalid === authInvalid &&
        !error.message.includes('不可信') &&
        !error.message.includes('private'),
    )
  }
})

test('unknown and thrown supplier failures collapse to one generic safe error', async () => {
  const suppliers = [
    async () => edgeFailure('UPSTREAM_PRIVATE_FAILURE', 502),
    async () => {
      throw new Error('private-network-detail')
    },
  ]

  for (const invoke of suppliers) {
    const { client } = createClient({ invoke })
    const service = createEmployeeAdminService(client, { configured: true })
    await assert.rejects(
      service.resetTemporaryPassword({ employeeId: EMPLOYEE_ID }),
      (error) =>
        error instanceof EmployeeAdminError &&
        error.code === 'EMPLOYEE_ADMIN_SERVICE_UNAVAILABLE' &&
        error.message === '人员管理服务暂不可用，请稍后重试' &&
        error.authInvalid === false &&
        !error.message.includes('private'),
    )
  }
})

test('service source has no legacy mutation, storage, logging, or credential persistence path', async () => {
  const source = await readFile(new URL('./employeeAdminService.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /employeeService|saveList|upsertRecord|\.from\(/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\./i)
  assert.doesNotMatch(source, /setItem|analytics|passwordHash|internalAuthAlias/)
})

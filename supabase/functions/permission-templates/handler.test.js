import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../../../src/auth/employeeAuthDomain.js'
import { PERMISSION_CATALOG } from '../../../src/auth/permissionCatalog.js'
import { createPermissionTemplatesHandler } from './handler.js'

const ACTOR = Object.freeze({
  authUserId: '00000000-0000-4000-8000-000000000001',
  employeeNumber: 'SW-000',
})

function emptySnapshot() {
  return {
    departments: Object.fromEntries(
      DEPARTMENT_OPTIONS.map((subject) => [subject, []]),
    ),
    positions: Object.fromEntries(
      POSITION_OPTIONS.map((subject) => [subject, []]),
    ),
  }
}

function request(body, options = {}) {
  return new Request('http://localhost/functions/v1/permission-templates', {
    method: options.method ?? 'POST',
    headers: {
      authorization: 'Bearer verified-user-jwt',
      'content-type': options.contentType ?? 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.method === 'GET' ? undefined : JSON.stringify(body),
  })
}

function createDependencies(overrides = {}) {
  const calls = []
  const adminClient = { kind: 'service-role-client' }
  return {
    calls,
    adminClient,
    dependencies: {
      requirePersonnelAdministrator: async (receivedRequest) => {
        calls.push(['authorize', receivedRequest.headers.get('authorization')])
        return ACTOR
      },
      createAdminClient: async () => {
        calls.push(['createAdminClient'])
        return adminClient
      },
      readTemplates: async (client, input) => {
        calls.push(['read', client, input])
        return emptySnapshot()
      },
      replaceTemplate: async (client, input) => {
        calls.push(['replace', client, input])
        const snapshot = emptySnapshot()
        const collection = input.subjectType === 'department'
          ? snapshot.departments
          : snapshot.positions
        collection[input.subjectCode] = [...input.permissionKeys]
        return snapshot
      },
      ...overrides,
    },
  }
}

async function responseBody(response) {
  return JSON.parse(await response.text())
}

test('read uses the exact operation and performs fresh authorization before service-role access', async () => {
  const setup = createDependencies()
  const handler = createPermissionTemplatesHandler(setup.dependencies)

  const response = await handler(request({ operation: 'read' }))

  assert.equal(response.status, 200)
  assert.deepEqual(await responseBody(response), emptySnapshot())
  assert.deepEqual(setup.calls, [
    ['authorize', 'Bearer verified-user-jwt'],
    ['createAdminClient'],
    ['read', setup.adminClient, { actorAuthUserId: ACTOR.authUserId }],
  ])
})

test('replace accepts only one fixed subject and sends a sorted atomic replacement', async () => {
  const setup = createDependencies()
  const handler = createPermissionTemplatesHandler(setup.dependencies)
  const permissions = [
    'sensitive.salary_view',
    'module.projects.update',
    'module.projects.view',
  ]

  const response = await handler(request({
    operation: 'replace',
    subjectType: 'department',
    subjectCode: '工程部',
    permissionKeys: permissions,
  }))

  assert.equal(response.status, 200)
  const sortedPermissions = [...permissions].sort()
  assert.deepEqual(
    (await responseBody(response)).departments['工程部'],
    sortedPermissions,
  )
  assert.deepEqual(setup.calls, [
    ['authorize', 'Bearer verified-user-jwt'],
    ['createAdminClient'],
    ['replace', setup.adminClient, {
      actorAuthUserId: ACTOR.authUserId,
      subjectType: 'department',
      subjectCode: '工程部',
      permissionKeys: sortedPermissions,
    }],
  ])
})

test('forbidden project financial grants return 400 before authorization or admin client creation', async () => {
  const financialKeys = [
    'sensitive.contract_amount_view',
    'sensitive.contract_amount_update',
  ]

  for (
    const [subjectType, subjectCode] of [
      ['department', '工程部'],
      ['position', '主任'],
    ]
  ) {
    for (const financialKey of financialKeys) {
      const setup = createDependencies()
      const handler = createPermissionTemplatesHandler(setup.dependencies)
      const response = await handler(request({
        operation: 'replace',
        subjectType,
        subjectCode,
        permissionKeys: [financialKey],
      }))

      assert.equal(response.status, 400)
      assert.deepEqual(await responseBody(response), {
        error: {
          code: 'PERMISSION_TEMPLATE_INPUT_INVALID',
          message: '权限模板请求格式无效',
        },
      })
      assert.deepEqual(setup.calls, [])
    }
  }
})

test('allowed project financial subjects reach atomic replacement', async () => {
  for (
    const [subjectType, subjectCode] of [
      ['department', '设计部'],
      ['department', '财务部'],
      ['position', '社长'],
    ]
  ) {
    const setup = createDependencies()
    const handler = createPermissionTemplatesHandler(setup.dependencies)
    const response = await handler(request({
      operation: 'replace',
      subjectType,
      subjectCode,
      permissionKeys: [
        'sensitive.contract_amount_view',
        'sensitive.contract_amount_update',
      ],
    }))

    assert.equal(response.status, 200)
    assert.deepEqual(
      setup.calls.map(([operation]) => operation),
      ['authorize', 'createAdminClient', 'replace'],
    )
    assert.deepEqual(setup.calls[2][2], {
      actorAuthUserId: ACTOR.authUserId,
      subjectType,
      subjectCode,
      permissionKeys: [
        'sensitive.contract_amount_update',
        'sensitive.contract_amount_view',
      ],
    })
  }
})

test('default adapters invoke only the exact service-role read and replacement RPC shapes', async () => {
  const rpcCalls = []
  const adminClient = {
    rpc: async (name, parameters) => {
      rpcCalls.push({ name, parameters })
      const snapshot = emptySnapshot()
      if (name === 'replace_permission_template_admin') {
        snapshot.positions[parameters.p_subject_code] = [
          ...parameters.p_permission_keys,
        ]
      }
      return { data: snapshot, error: null }
    },
  }
  const setup = createDependencies({
    createAdminClient: async () => adminClient,
    readTemplates: undefined,
    replaceTemplate: undefined,
  })
  const handler = createPermissionTemplatesHandler(setup.dependencies)

  assert.equal((await handler(request({ operation: 'read' }))).status, 200)
  assert.equal(
    (await handler(request({
      operation: 'replace',
      subjectType: 'position',
      subjectCode: '主任',
      permissionKeys: ['module.employees.view'],
    }))).status,
    200,
  )

  assert.deepEqual(rpcCalls, [
    {
      name: 'read_permission_templates_admin',
      parameters: { p_actor_auth_user_id: ACTOR.authUserId },
    },
    {
      name: 'replace_permission_template_admin',
      parameters: {
        p_subject_type: 'position',
        p_subject_code: '主任',
        p_permission_keys: ['module.employees.view'],
        p_actor_auth_user_id: ACTOR.authUserId,
      },
    },
  ])
})

test('strict input validation rejects unknown fields, employee subjects, duplicates, all, self and unknown keys before auth', async () => {
  const invalidRequests = [
    [{ operation: 'read', extra: true }],
    [{
      operation: 'replace',
      subjectType: 'employee',
      subjectCode: 'SW-001',
      permissionKeys: [],
    }],
    [{
      operation: 'replace',
      subjectType: 'department',
      subjectCode: '现场',
      permissionKeys: [],
    }],
    [{
      operation: 'replace',
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['module.projects.view', 'module.projects.view'],
    }],
    [{
      operation: 'replace',
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['all'],
    }],
    [{
      operation: 'replace',
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['module.permission_templates.view'],
    }],
    [{
      operation: 'replace',
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['module.unknown.view'],
    }],
    [{
      operation: 'replace',
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: [PERMISSION_CATALOG[0]],
      extra: true,
    }],
    [{
      operation: 'partial_add',
      subjectType: 'department',
      subjectCode: '工程部',
      permissionKeys: [],
    }],
    [null],
    [{ operation: 'read' }, { method: 'GET' }],
    [{ operation: 'read' }, { contentType: 'text/plain' }],
  ]

  for (const [body, options] of invalidRequests) {
    let authorized = false
    const handler = createPermissionTemplatesHandler(
      createDependencies({
        requirePersonnelAdministrator: async () => {
          authorized = true
          return ACTOR
        },
      }).dependencies,
    )
    const response = await handler(request(body, options))
    const payload = await responseBody(response)

    assert.ok([400, 405, 415].includes(response.status))
    assert.equal(authorized, false)
    assert.equal(typeof payload.error.code, 'string')
    assert.deepEqual(Object.keys(payload), ['error'])
  }
})

test('an authorization failure prevents service-role client creation', async () => {
  let createdAdminClient = false
  const handler = createPermissionTemplatesHandler(
    createDependencies({
      requirePersonnelAdministrator: async () => {
        throw new Error('private auth detail')
      },
      createAdminClient: async () => {
        createdAdminClient = true
        return {}
      },
    }).dependencies,
  )

  const response = await handler(request({ operation: 'read' }))
  const payload = await responseBody(response)

  assert.equal(response.status, 500)
  assert.equal(createdAdminClient, false)
  assert.equal(payload.error.code, 'INTERNAL_ERROR')
  assert.doesNotMatch(JSON.stringify(payload), /private auth detail/iu)
})

test('server accepts only exact full snapshots with every fixed key and sorted unique catalog values', async () => {
  const valid = emptySnapshot()
  valid.departments['工程部'] = [
    'module.projects.update',
    'module.projects.view',
  ]
  valid.positions['社长'] = ['sensitive.profit_view']

  const variants = [
    valid,
    { ...valid, audit: [] },
    { departments: valid.departments },
    { ...valid, departments: { ...valid.departments, 现场: [] } },
    {
      ...valid,
      departments: Object.fromEntries(
        Object.entries(valid.departments).slice(1),
      ),
    },
    {
      ...valid,
      positions: {
        ...valid.positions,
        社长: ['module.projects.view', 'module.projects.view'],
      },
    },
    {
      ...valid,
      positions: {
        ...valid.positions,
        社长: ['module.projects.view', 'module.projects.create'],
      },
    },
    { ...valid, positions: { ...valid.positions, 社长: ['all'] } },
    {
      ...valid,
      positions: {
        ...valid.positions,
        社长: ['module.permission_templates.update'],
      },
    },
  ]

  for (const [index, snapshot] of variants.entries()) {
    const handler = createPermissionTemplatesHandler(
      createDependencies({
        readTemplates: async () => snapshot,
      }).dependencies,
    )
    const response = await handler(request({ operation: 'read' }))
    if (index === 0) {
      assert.equal(response.status, 200)
      assert.deepEqual(await responseBody(response), valid)
    } else {
      assert.equal(response.status, 503)
      const payload = await responseBody(response)
      assert.equal(payload.error.code, 'PERMISSION_TEMPLATES_FAILED')
      assert.deepEqual(Object.keys(payload), ['error'])
    }
  }
})

test('raw database failures and response internals are never exposed', async () => {
  const handler = createPermissionTemplatesHandler(
    createDependencies({
      readTemplates: async () => {
        throw new Error('postgres relation and service-role key detail')
      },
    }).dependencies,
  )

  const response = await handler(request({ operation: 'read' }))
  const serialized = JSON.stringify(await responseBody(response))

  assert.equal(response.status, 500)
  assert.doesNotMatch(serialized, /postgres|relation|service-role|key detail/iu)
  assert.doesNotMatch(serialized, /authUserId|audit|alias/iu)
})

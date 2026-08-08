import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../auth/employeeAuthDomain.js'
import {
  canTemplateSubjectReceiveProjectFinancials,
  PERMISSION_ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  SENSITIVE_PERMISSION_CATALOG,
  templateContainsForbiddenProjectFinancialGrant,
  WAREHOUSE_PERMISSION_CATALOG,
} from '../auth/permissionCatalog.js'
import {
  createPermissionTemplateService,
  PermissionTemplateError,
} from './permissionTemplateService.js'

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

function createClient(result = { data: emptySnapshot(), error: null }) {
  const calls = []
  return {
    calls,
    client: {
      functions: {
        invoke: async (name, options) => {
          calls.push({ name, options })
          return result
        },
      },
    },
  }
}

test('permission catalog is the closed 71-key module, sensitive and warehouse set', () => {
  assert.equal(PERMISSION_MODULES.length, 13)
  assert.equal(PERMISSION_ACTIONS.length, 4)
  assert.equal(SENSITIVE_PERMISSION_CATALOG.length, 10)
  assert.equal(WAREHOUSE_PERMISSION_CATALOG.length, 9)
  assert.equal(PERMISSION_CATALOG.length, 71)
  assert.equal(new Set(PERMISSION_CATALOG).size, 71)
  assert.ok(
    PERMISSION_CATALOG.every((key) =>
      /^module\.[a-z0-9_]+\.(?:view|create|update|delete)$/u.test(key) ||
      /^sensitive\.[a-z0-9_]+$/u.test(key) ||
      /^warehouse\.[a-z0-9_]+\.[a-z0-9_]+$/u.test(key)
    ),
  )
  assert.ok(!PERMISSION_CATALOG.includes('all'))
  assert.ok(
    !PERMISSION_CATALOG.some((key) =>
      key.startsWith('module.permission_templates.')
    ),
  )
})

test('department and position replacements round-trip every warehouse action key', async () => {
  const warehouseKeys = WAREHOUSE_PERMISSION_CATALOG.map(({ key }) => key).sort()

  for (const [subjectType, subjectCode, collection] of [
    ['department', '仓库管理部', 'departments'],
    ['position', '仓库管理员', 'positions'],
  ]) {
    const snapshot = emptySnapshot()
    snapshot[collection][subjectCode] = warehouseKeys
    const { client, calls } = createClient({ data: snapshot, error: null })
    const service = createPermissionTemplateService(client, { configured: true })

    const result = await service.replacePermissionTemplate({
      subjectType,
      subjectCode,
      permissionKeys: [...warehouseKeys].reverse(),
    })

    assert.deepEqual(calls, [{
      name: 'permission-templates',
      options: {
        body: {
          operation: 'replace',
          subjectType,
          subjectCode,
          permissionKeys: warehouseKeys,
        },
      },
    }])
    assert.deepEqual(result[collection][subjectCode], warehouseKeys)
  }
})

test('project financial template grants use the fixed allowed and forbidden subject matrix', () => {
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
    assert.equal(
      canTemplateSubjectReceiveProjectFinancials(subjectType, subjectCode),
      false,
    )
    for (const financialKey of financialKeys) {
      assert.equal(
        templateContainsForbiddenProjectFinancialGrant(
          subjectType,
          subjectCode,
          [financialKey],
        ),
        true,
      )
    }
    assert.equal(
      templateContainsForbiddenProjectFinancialGrant(
        subjectType,
        subjectCode,
        ['module.projects.view'],
      ),
      false,
    )
  }

  for (
    const [subjectType, subjectCode] of [
      ['department', '设计部'],
      ['department', '财务部'],
      ['position', '社长'],
    ]
  ) {
    assert.equal(
      canTemplateSubjectReceiveProjectFinancials(subjectType, subjectCode),
      true,
    )
    assert.equal(
      templateContainsForbiddenProjectFinancialGrant(
        subjectType,
        subjectCode,
        financialKeys,
      ),
      false,
    )
  }
})

test('read invokes permission-templates with the exact body and validates a complete snapshot', async () => {
  const snapshot = emptySnapshot()
  snapshot.departments['工程部'] = ['module.projects.view']
  const { client, calls } = createClient({ data: snapshot, error: null })
  const service = createPermissionTemplateService(client, { configured: true })

  const result = await service.readPermissionTemplates()

  assert.deepEqual(calls, [{
    name: 'permission-templates',
    options: { body: { operation: 'read' } },
  }])
  assert.deepEqual(result, snapshot)
  assert.notEqual(result, snapshot)
  assert.notEqual(result.departments, snapshot.departments)
})

test('replace sends one exact atomic replacement body with sorted permission keys', async () => {
  const snapshot = emptySnapshot()
  snapshot.positions['工事部长'] = [
    'module.projects.update',
    'module.projects.view',
  ]
  const { client, calls } = createClient({ data: snapshot, error: null })
  const service = createPermissionTemplateService(client, { configured: true })

  const result = await service.replacePermissionTemplate({
    subjectType: 'position',
    subjectCode: '工事部长',
    permissionKeys: ['module.projects.view', 'module.projects.update'],
  })

  assert.deepEqual(calls, [{
    name: 'permission-templates',
    options: {
      body: {
        operation: 'replace',
        subjectType: 'position',
        subjectCode: '工事部长',
        permissionKeys: ['module.projects.update', 'module.projects.view'],
      },
    },
  }])
  assert.deepEqual(result, snapshot)
})

test('invalid subjects, duplicate and non-catalog permissions fail before network access', async () => {
  const invalidInputs = [
    { subjectType: 'employee', subjectCode: 'SW-001', permissionKeys: [] },
    { subjectType: 'department', subjectCode: '现场', permissionKeys: [] },
    {
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['module.projects.view', 'module.projects.view'],
    },
    { subjectType: 'position', subjectCode: '社长', permissionKeys: ['all'] },
    {
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['module.permission_templates.view'],
    },
    {
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: ['module.unknown.view'],
    },
    {
      subjectType: 'position',
      subjectCode: '社长',
      permissionKeys: [PERMISSION_CATALOG[0]],
      extra: true,
    },
  ]

  for (const input of invalidInputs) {
    const { client, calls } = createClient()
    const service = createPermissionTemplateService(client, {
      configured: true,
    })
    await assert.rejects(
      service.replacePermissionTemplate(input),
      (error) =>
        error instanceof PermissionTemplateError &&
        error.code === 'PERMISSION_TEMPLATE_INPUT_INVALID',
    )
    assert.deepEqual(calls, [])
  }
})

test('forbidden project financial replacements fail locally without Edge invocation', async () => {
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
      const { client, calls } = createClient()
      const service = createPermissionTemplateService(client, {
        configured: true,
      })

      await assert.rejects(
        service.replacePermissionTemplate({
          subjectType,
          subjectCode,
          permissionKeys: [financialKey],
        }),
        (error) =>
          error instanceof PermissionTemplateError &&
          error.code === 'PERMISSION_TEMPLATE_INPUT_INVALID',
      )
      assert.deepEqual(calls, [])
    }
  }
})

test('allowed project financial subjects still invoke the Edge replacement', async () => {
  for (
    const [subjectType, subjectCode] of [
      ['department', '设计部'],
      ['department', '财务部'],
      ['position', '社长'],
    ]
  ) {
    const { client, calls } = createClient()
    const service = createPermissionTemplateService(client, {
      configured: true,
    })

    await service.replacePermissionTemplate({
      subjectType,
      subjectCode,
      permissionKeys: [
        'sensitive.contract_amount_view',
        'sensitive.contract_amount_update',
      ],
    })

    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].options.body, {
      operation: 'replace',
      subjectType,
      subjectCode,
      permissionKeys: [
        'sensitive.contract_amount_update',
        'sensitive.contract_amount_view',
      ],
    })
  }
})

test('malformed snapshots fail closed for missing, extra, duplicate, unsorted and unknown values', async () => {
  const valid = emptySnapshot()
  const invalidSnapshots = [
    null,
    { ...valid, extra: true },
    { departments: valid.departments },
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
      positions: { ...valid.positions, 社长: ['module.unknown.view'] },
    },
    { ...valid, positions: { ...valid.positions, 员工: [] } },
  ]

  for (const data of invalidSnapshots) {
    const { client } = createClient({ data, error: null })
    const service = createPermissionTemplateService(client, {
      configured: true,
    })
    await assert.rejects(
      service.readPermissionTemplates(),
      (error) =>
        error instanceof PermissionTemplateError &&
        error.code === 'PERMISSION_TEMPLATE_RESPONSE_INVALID',
    )
  }
})

test('only allowlisted edge errors reach the browser and supplier details are discarded', async () => {
  const safeResponse = new Response(
    JSON.stringify({
      error: {
        code: 'PERSONNEL_ADMIN_REQUIRED',
        message: 'untrusted upstream copy',
      },
      debug: 'database detail',
    }),
    { status: 403, headers: { 'content-type': 'application/json' } },
  )
  const { client: safeClient } = createClient({
    data: null,
    error: { message: 'supplier detail', context: safeResponse },
  })
  const safeService = createPermissionTemplateService(safeClient, {
    configured: true,
  })

  await assert.rejects(
    safeService.readPermissionTemplates(),
    (error) =>
      error instanceof PermissionTemplateError &&
      error.code === 'PERSONNEL_ADMIN_REQUIRED' &&
      error.message === '没有人员管理权限' &&
      !error.message.includes('upstream'),
  )

  const unsafeResponse = new Response(
    JSON.stringify({
      error: { code: 'POSTGRES_INTERNAL_DETAIL', message: 'private detail' },
    }),
    { status: 500, headers: { 'content-type': 'application/json' } },
  )
  const { client: unsafeClient } = createClient({
    data: null,
    error: { message: 'supplier detail', context: unsafeResponse },
  })
  const unsafeService = createPermissionTemplateService(unsafeClient, {
    configured: true,
  })

  await assert.rejects(
    unsafeService.readPermissionTemplates(),
    (error) =>
      error instanceof PermissionTemplateError &&
      error.code === 'PERMISSION_TEMPLATES_UNAVAILABLE' &&
      !error.message.includes('private') &&
      !error.message.includes('supplier'),
  )
})

test('missing configuration and thrown client failures fail closed without persistence', async () => {
  const storageAccesses = []
  const previousStorage = globalThis.localStorage
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new Proxy({}, {
      get(_target, property) {
        storageAccesses.push(String(property))
        throw new Error('storage must not be used')
      },
    }),
  })
  try {
    const configuredOff = createPermissionTemplateService(null, {
      configured: false,
    })
    await assert.rejects(
      configuredOff.readPermissionTemplates(),
      (error) => error.code === 'CONFIGURATION_ERROR',
    )

    const service = createPermissionTemplateService({
      functions: {
        invoke: async () => {
          throw new Error('network supplier detail')
        },
      },
    }, { configured: true })
    await assert.rejects(
      service.readPermissionTemplates(),
      (error) =>
        error.code === 'PERMISSION_TEMPLATES_UNAVAILABLE' &&
        !error.message.includes('supplier'),
    )
    assert.deepEqual(storageAccesses, [])
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage
    else {Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: previousStorage,
      })}
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  BusinessPersistenceError,
  createBaseRecordService,
} from './baseRecordService.js'

const ACTIVE_SESSION = Object.freeze({
  access_token: 'authenticated-access-token',
  expires_at: 1_800_000_000,
})

function createClient({ session = ACTIVE_SESSION, results = {} } = {}) {
  const calls = []

  const resultFor = (operation) => {
    const result = results[operation]
    return typeof result === 'function'
      ? result(calls)
      : result ?? { data: null, error: null }
  }

  const query = (operation, tableName, details = {}) => {
    const filters = []
    const call = { operation, tableName, filters, ...details }
    calls.push(call)
    const builder = {
      eq(field, value) {
        filters.push({ operator: 'eq', field, value })
        return builder
      },
      neq(field, value) {
        filters.push({ operator: 'neq', field, value })
        return builder
      },
      order(field, options) {
        call.order = { field, options }
        return Promise.resolve(resultFor(operation))
      },
      maybeSingle() {
        call.maybeSingle = true
        return Promise.resolve(resultFor(operation))
      },
      select(columns) {
        call.returning = columns
        return builder
      },
      then(resolve, reject) {
        return Promise.resolve(resultFor(operation)).then(resolve, reject)
      },
    }
    return builder
  }

  const client = {
    auth: {
      async getSession() {
        calls.push({ operation: 'auth.getSession' })
        return { data: { session }, error: null }
      },
    },
    from(tableName) {
      calls.push({ operation: 'from', tableName })
      return {
        select(columns) {
          return query('select', tableName, { columns })
        },
        upsert(payload, options) {
          return query('upsert', tableName, { payload, options })
        },
        insert(payload) {
          return query('insert', tableName, { payload })
        },
        update(payload) {
          return query('update', tableName, { payload })
        },
      }
    },
  }

  return { calls, client }
}

function assertSafeError(code, status) {
  return (error) =>
    error instanceof BusinessPersistenceError &&
    error.code === code &&
    error.status === status &&
    !error.message.includes('private')
}

test('every persistence operation rejects a missing session before table or storage access', async () => {
  let storageReadCount = 0
  const storage = {
    getItem() {
      storageReadCount += 1
      return '[]'
    },
  }
  const actions = [
    (service) => service.getList('erp.projects'),
    (service) => service.getById('erp.projects', 'P001'),
    (service) => service.saveList('erp.projects', []),
    (service) => service.upsertRecord('erp.projects', { projectId: 'P001' }),
    (service) => service.create('erp.projects', { projectId: 'P001' }),
    (service) => service.update('erp.projects', 'P001', { projectName: '更新' }),
    (service) => service.softDelete('erp.projects', 'P001'),
    (service) => service.migrateLocalStorageToSupabase(['erp.projects']),
  ]

  for (const action of actions) {
    const { client, calls } = createClient({ session: null })
    const service = createBaseRecordService(client, { configured: true, storage })

    await assert.rejects(action(service), assertSafeError('AUTH_SESSION_INVALID', 401))
    assert.equal(calls.filter(({ operation }) => operation === 'auth.getSession').length, 1)
    assert.equal(calls.some(({ operation }) => operation === 'from'), false)
  }
  assert.equal(storageReadCount, 0)
})

test('invalid configuration fails closed before Auth or table access', async () => {
  const { client, calls } = createClient()
  const service = createBaseRecordService(client, { configured: false })

  await assert.rejects(
    service.getList('erp.projects'),
    assertSafeError('CONFIGURATION_ERROR', 503),
  )
  assert.deepEqual(calls, [])
})

test('expired sessions are rejected before table access', async () => {
  const { client, calls } = createClient({
    session: { access_token: 'expired-token', expires_at: 1_600_000_000 },
  })
  const service = createBaseRecordService(client, {
    configured: true,
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  })

  await assert.rejects(
    service.getList('erp.projects'),
    assertSafeError('AUTH_SESSION_INVALID', 401),
  )
  assert.equal(calls.some(({ operation }) => operation === 'from'), false)
})

test('single-record upsert ignores browser identity and omits all client audit fields', async () => {
  const browserStorageReads = []
  const previousWindow = globalThis.window
  globalThis.window = {
    localStorage: {
      getItem(key) {
        browserStorageReads.push(key)
        return JSON.stringify({ employeeId: 'forged-id', name: 'forged-name' })
      },
    },
  }

  try {
    const { client, calls } = createClient()
    const service = createBaseRecordService(client, {
      configured: true,
      now: () => new Date('2026-07-14T01:02:03.000Z'),
    })
    await service.upsertRecord('erp.projects', {
      projectId: 'P001',
      projectName: '安全写入',
      created_by_employee_id: 'payload-forgery',
      created_by_employee_name: 'payload-forgery',
      updated_by_employee_id: 'payload-forgery',
      updated_by_employee_name: 'payload-forgery',
    })

    const [{ payload: row }] = calls.filter(({ operation }) => operation === 'upsert')
    assert.deepEqual(Object.keys(row).sort(), [
      'attachments',
      'payload',
      'record_key',
      'status',
      'updated_at',
    ])
    for (const field of [
      'created_by_employee_id',
      'created_by_employee_name',
      'updated_by_employee_id',
      'updated_by_employee_name',
    ]) {
      assert.equal(Object.hasOwn(row, field), false)
      assert.equal(Object.hasOwn(row.payload, field), false)
    }
    assert.deepEqual(browserStorageReads, [])
  } finally {
    globalThis.window = previousWindow
  }
})

test('legacy employee writes and employee whole-list synchronization are denied', async () => {
  for (const action of [
    (service) => service.saveList('erp.employees', []),
    (service) => service.upsertRecord('erp.employees', { employeeId: 'E001' }),
    (service) => service.create('erp.employees', { employeeId: 'E001' }),
    (service) => service.update('erp.employees', 'E001', { name: '更改' }),
    (service) => service.softDelete('erp.employees', 'E001'),
  ]) {
    const { client, calls } = createClient()
    const service = createBaseRecordService(client, { configured: true })

    await assert.rejects(
      action(service),
      assertSafeError('LEGACY_EMPLOYEE_WRITE_DENIED', 403),
    )
    assert.equal(calls.filter(({ operation }) => operation === 'auth.getSession').length, 1)
    assert.equal(calls.some(({ operation }) => operation === 'from'), false)
  }
})

test('saveList performs one authenticated batch upsert without reads, implicit deletion, or row fallback', async () => {
  const { client, calls } = createClient()
  const service = createBaseRecordService(client, { configured: true })

  const result = await service.saveList('erp.projects', [
    { projectId: 'P001', projectName: '旧值' },
    { projectId: 'P001', projectName: '最终值' },
    { projectId: 'P002', projectName: '第二项' },
  ])

  assert.deepEqual(result, { saved: 2, failed: 0, skipped: false, errors: [] })
  assert.deepEqual(
    calls.map(({ operation }) => operation),
    ['auth.getSession', 'from', 'upsert'],
  )
  const [{ payload }] = calls.filter(({ operation }) => operation === 'upsert')
  assert.equal(payload.length, 2)
  assert.equal(payload[0].payload.projectName, '最终值')
  assert.equal(calls.some(({ operation }) => operation === 'update'), false)
})

test('a batch policy failure is sanitized and never retried row by row', async () => {
  const { client, calls } = createClient({
    results: {
      upsert: {
        data: null,
        error: { status: 403, code: '42501', message: 'private policy internals' },
      },
    },
  })
  const service = createBaseRecordService(client, { configured: true })

  await assert.rejects(
    service.saveList('erp.projects', [
      { projectId: 'P001' },
      { projectId: 'P002' },
    ]),
    assertSafeError('ACCESS_DENIED', 403),
  )
  assert.equal(calls.filter(({ operation }) => operation === 'upsert').length, 1)
})

test('create, update, and softDelete target one record without rewriting a collection', async () => {
  const createdClient = createClient()
  const createService = createBaseRecordService(createdClient.client, { configured: true })
  await createService.create('erp.projects', { projectId: 'P001', projectName: '新增' })
  assert.deepEqual(
    createdClient.calls.map(({ operation }) => operation),
    ['auth.getSession', 'from', 'insert'],
  )

  const updatedClient = createClient({
    results: {
      select: {
        data: {
          record_key: 'P001',
          payload: { projectId: 'P001', projectName: '原值', keep: true },
          attachments: [],
          status: 'active',
        },
        error: null,
      },
      update: { data: [{ record_key: 'P001' }], error: null },
    },
  })
  const updateService = createBaseRecordService(updatedClient.client, { configured: true })
  await updateService.update('erp.projects', 'P001', { projectName: '新值' })
  assert.deepEqual(
    updatedClient.calls.map(({ operation }) => operation),
    ['auth.getSession', 'from', 'select', 'from', 'update'],
  )
  const updateCall = updatedClient.calls.find(({ operation }) => operation === 'update')
  assert.deepEqual(updateCall.payload.payload, {
    projectId: 'P001',
    projectName: '新值',
    keep: true,
  })
  assert.deepEqual(updateCall.filters, [
    { operator: 'eq', field: 'record_key', value: 'P001' },
  ])
  assert.equal(updateCall.returning, 'record_key')

  const deletedClient = createClient({
    results: { update: { data: [{ record_key: 'P001' }], error: null } },
  })
  const deleteService = createBaseRecordService(deletedClient.client, { configured: true })
  await deleteService.softDelete('erp.projects', 'P001')
  assert.deepEqual(
    deletedClient.calls.map(({ operation }) => operation),
    ['auth.getSession', 'from', 'update'],
  )
  const deleteCall = deletedClient.calls.find(({ operation }) => operation === 'update')
  assert.deepEqual(Object.keys(deleteCall.payload).sort(), ['status', 'updated_at'])
  assert.equal(deleteCall.payload.status, 'deleted')
  assert.equal(deleteCall.returning, 'record_key')
})

test('update and softDelete fail closed when RLS turns the mutation into a zero-row no-op', async () => {
  const updateClient = createClient({
    results: {
      select: {
        data: {
          record_key: 'P001',
          payload: { projectId: 'P001', projectName: '可读取' },
          attachments: [],
          status: 'active',
        },
        error: null,
      },
      update: { data: [], error: null },
    },
  })
  const updateService = createBaseRecordService(updateClient.client, { configured: true })

  await assert.rejects(
    updateService.update('erp.projects', 'P001', { projectName: '不可写' }),
    assertSafeError('ACCESS_DENIED', 403),
  )

  const deleteClient = createClient({
    results: { update: { data: [], error: null } },
  })
  const deleteService = createBaseRecordService(deleteClient.client, { configured: true })

  await assert.rejects(
    deleteService.softDelete('erp.projects', 'P001'),
    assertSafeError('ACCESS_DENIED', 403),
  )
})

test('authenticated reads return cloud data and expose only stable safe authorization errors', async () => {
  const successClient = createClient({
    results: {
      select: {
        data: [
          { record_key: 'P001', payload: { projectId: 'P001' }, status: 'active' },
        ],
        error: null,
      },
    },
  })
  const successService = createBaseRecordService(successClient.client, { configured: true })
  assert.deepEqual(await successService.getList('erp.projects'), [{ projectId: 'P001' }])

  const deniedClient = createClient({
    results: {
      select: {
        data: null,
        error: { status: 401, message: 'private token supplier detail' },
      },
    },
  })
  const deniedService = createBaseRecordService(deniedClient.client, { configured: true })
  await assert.rejects(
    deniedService.getList('erp.projects'),
    assertSafeError('AUTH_SESSION_INVALID', 401),
  )
})

test('list reads reject null data and malformed row envelopes instead of reporting an empty success', async () => {
  for (const data of [
    null,
    {},
    [null],
    [{ record_key: '', payload: { projectId: 'P001' } }],
    [{ record_key: 'P001', payload: null }],
    [{ record_key: 'P001', payload: [] }],
  ]) {
    const { client } = createClient({
      results: { select: { data, error: null } },
    })
    const service = createBaseRecordService(client, { configured: true })

    await assert.rejects(
      service.getList('erp.projects'),
      assertSafeError('DATA_OPERATION_FAILED', 503),
    )
  }
})

test('single-record reads allow a missing row but reject malformed returned payloads', async () => {
  const missingClient = createClient({
    results: { select: { data: null, error: null } },
  })
  const missingService = createBaseRecordService(missingClient.client, {
    configured: true,
  })
  assert.equal(await missingService.getById('erp.projects', 'P001'), undefined)

  for (const data of [
    {},
    'malformed-row',
    { payload: null },
    { payload: [] },
  ]) {
    const { client } = createClient({
      results: { select: { data, error: null } },
    })
    const service = createBaseRecordService(client, { configured: true })

    await assert.rejects(
      service.getById('erp.projects', 'P001'),
      assertSafeError('DATA_OPERATION_FAILED', 503),
    )
  }
})

test('explicit local migration excludes employees and reports only sanitized failures', async () => {
  const storageReads = []
  const storage = {
    getItem(key) {
      storageReads.push(key)
      return JSON.stringify([{ projectId: 'P001' }])
    },
  }
  const { client, calls } = createClient({
    results: {
      upsert: {
        data: null,
        error: { status: 403, code: '42501', message: 'private RLS policy detail' },
      },
    },
  })
  const service = createBaseRecordService(client, { configured: true, storage })

  const results = await service.migrateLocalStorageToSupabase([
    'erp.employees',
    'unknown.storage',
    'erp.projects',
    'erp.laborRecords',
  ])

  assert.deepEqual(storageReads, ['erp.projects'])
  assert.equal(results.length, 1)
  assert.equal(results[0].storageKey, 'erp.projects')
  assert.equal(results[0].errorCode, 'ACCESS_DENIED')
  assert.equal(results[0].errors.some((message) => message.includes('private')), false)
  assert.equal(calls.filter(({ operation }) => operation === 'upsert').length, 1)
})

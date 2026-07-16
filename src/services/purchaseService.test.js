import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({
  root: process.cwd(),
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const purchaseModule = await vite.ssrLoadModule('/src/services/purchaseService.js')
await vite.close()
const { PurchaseServiceError, createPurchaseService } = purchaseModule

const purchase = (overrides = {}) => ({
  purchaseId: 'PO-SECURE-1',
  purchaseDate: '2026-07-16',
  itemName: '安全采购',
  totalCost: 80000,
  purchaseStatus: '正常',
  details: { supplier: '供应商' },
  ...overrides,
})

const envelope = (payload = purchase(), overrides = {}) => ({
  record_key: payload?.purchaseId || 'PO-SECURE-1',
  payload,
  status: 'active',
  updated_at: '2026-07-16T00:00:00.000Z',
  ...overrides,
})

test('purchase records use only the three secure RPCs while payments keep their sensitive adapter', async () => {
  const rpcCalls = []
  const paymentCalls = []
  const client = {
    rpc: async (name, args) => {
      rpcCalls.push([name, args])
      if (name === 'list_purchase_records_secure') return { data: [envelope()], error: null }
      if (name === 'soft_delete_purchase_record_secure') {
        return { data: 'PO-SECURE-1', error: null }
      }
      return { data: envelope(), error: null }
    },
    from() {
      throw new Error('purchase records must never use a direct table adapter')
    },
  }
  const paymentAdapter = {
    getList: async (key) => {
      paymentCalls.push(['getList', key])
      return [{ paymentId: 'PP-1' }]
    },
    upsertRecord: async (key, row) => {
      paymentCalls.push(['upsertRecord', key, row])
      return { saved: 1 }
    },
    softDelete: async (key, id) => {
      paymentCalls.push(['softDelete', key, id])
      return id
    },
  }
  const service = createPurchaseService(client, { configured: true, paymentAdapter })

  assert.equal((await service.getList())[0].purchaseId, 'PO-SECURE-1')
  await service.create(purchase())
  await service.update('PO-SECURE-1', purchase({ remark: '更新' }))
  await service.softDelete('PO-SECURE-1')
  assert.deepEqual(await service.getPaymentList(), [{ paymentId: 'PP-1' }])
  await service.upsertPayment({ paymentId: 'PP-1' })
  await service.softDeletePayment('PP-1')

  assert.deepEqual(rpcCalls, [
    ['list_purchase_records_secure', {}],
    ['upsert_purchase_record_secure', {
      p_record_key: 'PO-SECURE-1',
      p_payload: purchase(),
      p_status: 'active',
    }],
    ['upsert_purchase_record_secure', {
      p_record_key: 'PO-SECURE-1',
      p_payload: purchase({ remark: '更新' }),
      p_status: 'active',
    }],
    ['soft_delete_purchase_record_secure', { p_record_key: 'PO-SECURE-1' }],
  ])
  assert.deepEqual(paymentCalls, [
    ['getList', 'erp.purchasePaymentRecords'],
    ['upsertRecord', 'erp.purchasePaymentRecords', { paymentId: 'PP-1' }],
    ['softDelete', 'erp.purchasePaymentRecords', 'PP-1'],
  ])
})

test('secure list data is validated, detached, and deeply immutable', async () => {
  const source = envelope()
  const service = createPurchaseService({
    rpc: async () => ({ data: [source], error: null }),
  }, { configured: true })

  const records = await service.getList()
  assert.notEqual(records[0], source.payload)
  assert.notEqual(records[0].details, source.payload.details)
  assert.equal(Object.isFrozen(records), true)
  assert.equal(Object.isFrozen(records[0]), true)
  assert.equal(Object.isFrozen(records[0].details), true)
  source.payload.itemName = '被供应方篡改'
  source.payload.details.supplier = '被供应方篡改'
  assert.equal(records[0].itemName, '安全采购')
  assert.equal(records[0].details.supplier, '供应商')
})

test('malformed, accessor, and inherited supplier source/data fail closed without invoking getters', async (t) => {
  const cases = [
    ['non-array data', { data: envelope(), error: null }],
    ['inherited data', Object.assign(Object.create({ data: [envelope()] }), { error: null })],
    ['inherited row fields', { data: [Object.create(envelope())], error: null }],
    ['non-object payload', { data: [envelope(null)], error: null }],
    ['mismatched record key', {
      data: [envelope(purchase({ purchaseId: 'PO-OTHER' }), { record_key: 'PO-SECURE-1' })],
      error: null,
    }],
  ]

  let getterCalls = 0
  const accessorSource = { error: null }
  Object.defineProperty(accessorSource, 'data', {
    enumerable: true,
    get() {
      getterCalls += 1
      return [envelope()]
    },
  })
  cases.push(['accessor data', accessorSource])

  const accessorRow = envelope()
  Object.defineProperty(accessorRow, 'payload', {
    enumerable: true,
    get() {
      getterCalls += 1
      return purchase()
    },
  })
  cases.push(['accessor row field', { data: [accessorRow], error: null }])

  for (const [name, result] of cases) {
    await t.test(name, async () => {
      const service = createPurchaseService({ rpc: async () => result }, { configured: true })
      await assert.rejects(
        () => service.getList(),
        (error) => error instanceof PurchaseServiceError &&
          error.code === 'PURCHASE_RESPONSE_INVALID',
      )
    })
  }
  assert.equal(getterCalls, 0)
})

test('configuration, authentication, permission, and generic failures keep distinct safe codes', async () => {
  const unconfigured = createPurchaseService({
    rpc() { throw new Error('must not run') },
  }, { configured: false })
  await assert.rejects(
    () => unconfigured.getList(),
    (error) => error.code === 'CONFIGURATION_ERROR',
  )

  for (const [supplierError, expectedCode] of [
    [{ status: 401 }, 'AUTH_SESSION_INVALID'],
    [{ code: 'JWT_EXPIRED' }, 'AUTH_SESSION_INVALID'],
    [{ status: 403 }, 'ACCESS_DENIED'],
    [{ code: '42501' }, 'ACCESS_DENIED'],
    [{ message: 'private database detail' }, 'PURCHASE_OPERATION_FAILED'],
  ]) {
    const service = createPurchaseService({
      rpc: async () => ({ data: null, error: supplierError }),
    }, { configured: true })
    await assert.rejects(
      () => service.getList(),
      (error) => error instanceof PurchaseServiceError &&
        error.code === expectedCode &&
        !error.message.includes('private database detail'),
    )
  }
})

test('outer transport status is honored when the supplier error omits its status', async () => {
  for (const [status, expectedCode] of [
    [401, 'AUTH_SESSION_INVALID'],
    [403, 'ACCESS_DENIED'],
  ]) {
    const service = createPurchaseService({
      rpc: async () => ({ data: null, error: {}, status }),
    }, { configured: true })
    await assert.rejects(
      () => service.getList(),
      (error) => error instanceof PurchaseServiceError && error.code === expectedCode,
    )
  }
})

test('mutation input and response binding reject deleted-state bypasses and mismatched records', async () => {
  const service = createPurchaseService({
    rpc: async (name) => ({
      data: name === 'soft_delete_purchase_record_secure'
        ? 'PO-OTHER'
        : envelope(purchase({ purchaseId: 'PO-OTHER' })),
      error: null,
    }),
  }, { configured: true })

  await assert.rejects(
    () => service.create(purchase({ purchaseId: '' })),
    (error) => error.code === 'PURCHASE_INPUT_INVALID',
  )
  await assert.rejects(
    () => service.create(purchase({ cloudStatus: 'deleted' })),
    (error) => error.code === 'PURCHASE_INPUT_INVALID',
  )
  await assert.rejects(
    () => service.update('PO-SECURE-1', purchase({ purchaseId: 'PO-OTHER' })),
    (error) => error.code === 'PURCHASE_INPUT_INVALID',
  )
  await assert.rejects(
    () => service.update('PO-SECURE-1', purchase()),
    (error) => error.code === 'PURCHASE_RESPONSE_INVALID',
  )
  await assert.rejects(
    () => service.softDelete('PO-SECURE-1'),
    (error) => error.code === 'PURCHASE_RESPONSE_INVALID',
  )
})

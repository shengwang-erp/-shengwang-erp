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

test('stock-in commits purchase, stock-in, and inventory through one bound atomic RPC', async () => {
  const purchasePatch = purchase({ stockInStatus: '部分入库' })
  const stockInPayload = {
    stockInId: 'SI-SECURE-1',
    sourcePurchaseId: 'PO-SECURE-1',
    stockInQuantity: 2,
  }
  const inventoryPayload = {
    inventoryId: 'INV-SECURE-1',
    sourcePurchaseId: 'PO-OLDER-AGGREGATE',
    quantity: 2,
  }
  const supplier = {
    purchase: envelope(purchasePatch),
    stock_in: {
      record_key: stockInPayload.stockInId,
      payload: stockInPayload,
      status: 'active',
      updated_at: '2026-07-17T00:00:00.000Z',
    },
    inventory_item: {
      record_key: inventoryPayload.inventoryId,
      payload: inventoryPayload,
      status: 'active',
      updated_at: '2026-07-17T00:00:00.000Z',
    },
  }
  const calls = []
  const service = createPurchaseService({
    rpc: async (name, args) => {
      calls.push([name, args])
      return { data: supplier, error: null }
    },
  }, { configured: true })

  const result = await service.commitStockIn({
    purchaseRecordKey: 'PO-SECURE-1',
    purchasePatch,
    stockInRecordKey: 'SI-SECURE-1',
    stockInPayload,
    inventoryRecordKey: 'INV-SECURE-1',
    inventoryPayload,
  })

  assert.deepEqual(calls, [[
    'commit_purchase_stock_in_secure',
    {
      p_purchase_record_key: 'PO-SECURE-1',
      p_purchase_patch: purchasePatch,
      p_stock_in_record_key: 'SI-SECURE-1',
      p_stock_in_payload: stockInPayload,
      p_inventory_record_key: 'INV-SECURE-1',
      p_inventory_payload: inventoryPayload,
    },
  ]])
  assert.deepEqual(result, {
    purchase: purchasePatch,
    stockIn: stockInPayload,
    inventoryItem: inventoryPayload,
  })
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result.purchase), true)
  assert.equal(Object.isFrozen(result.stockIn), true)
  assert.equal(Object.isFrozen(result.inventoryItem), true)

  supplier.purchase.payload.itemName = '供应方后改'
  supplier.stock_in.payload.stockInQuantity = 999
  assert.equal(result.purchase.itemName, '安全采购')
  assert.equal(result.stockIn.stockInQuantity, 2)
})

test('stock-in commit response requires an own enumerable source purchase data property', async (t) => {
  const request = {
    purchaseRecordKey: 'PO-SECURE-1',
    purchasePatch: purchase(),
    stockInRecordKey: 'SI-SECURE-1',
    stockInPayload: {
      stockInId: 'SI-SECURE-1',
      sourcePurchaseId: 'PO-SECURE-1',
      stockInQuantity: 1,
    },
    inventoryRecordKey: 'INV-SECURE-1',
    inventoryPayload: {
      inventoryId: 'INV-SECURE-1',
      quantity: 1,
    },
  }
  const responseFor = (stockInPayload) => ({
    purchase: envelope(),
    stock_in: {
      record_key: 'SI-SECURE-1',
      payload: stockInPayload,
      status: 'active',
      updated_at: '2026-07-17T00:00:00.000Z',
    },
    inventory_item: {
      record_key: 'INV-SECURE-1',
      payload: { inventoryId: 'INV-SECURE-1', quantity: 1 },
      status: 'active',
      updated_at: '2026-07-17T00:00:00.000Z',
    },
  })
  const rejectsResponse = async (stockInPayload) => {
    const service = createPurchaseService({
      rpc: async () => ({ data: responseFor(stockInPayload), error: null }),
    }, { configured: true })
    await assert.rejects(
      () => service.commitStockIn(request),
      (error) => error instanceof PurchaseServiceError &&
        error.code === 'PURCHASE_RESPONSE_INVALID',
    )
  }

  await t.test('missing sourcePurchaseId', async () => {
    await rejectsResponse({ stockInId: 'SI-SECURE-1', stockInQuantity: 1 })
  })

  await t.test('mismatched sourcePurchaseId', async () => {
    await rejectsResponse({
      stockInId: 'SI-SECURE-1',
      sourcePurchaseId: 'PO-OTHER',
      stockInQuantity: 1,
    })
  })

  await t.test('inherited sourcePurchaseId', async () => {
    const previousDescriptor = Object.getOwnPropertyDescriptor(
      Object.prototype, 'sourcePurchaseId',
    )
    Object.defineProperty(Object.prototype, 'sourcePurchaseId', {
      configurable: true,
      enumerable: true,
      value: 'PO-SECURE-1',
      writable: true,
    })
    try {
      await rejectsResponse({ stockInId: 'SI-SECURE-1', stockInQuantity: 1 })
    } finally {
      if (previousDescriptor) {
        Object.defineProperty(Object.prototype, 'sourcePurchaseId', previousDescriptor)
      } else {
        delete Object.prototype.sourcePurchaseId
      }
    }
  })

  await t.test('accessor sourcePurchaseId', async () => {
    let getterCalls = 0
    const stockInPayload = { stockInId: 'SI-SECURE-1', stockInQuantity: 1 }
    Object.defineProperty(stockInPayload, 'sourcePurchaseId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'PO-SECURE-1'
      },
    })
    await rejectsResponse(stockInPayload)
    assert.equal(getterCalls, 0)
  })

  await t.test('non-enumerable sourcePurchaseId', async () => {
    const stockInPayload = { stockInId: 'SI-SECURE-1', stockInQuantity: 1 }
    Object.defineProperty(stockInPayload, 'sourcePurchaseId', {
      enumerable: false,
      value: 'PO-SECURE-1',
    })
    await rejectsResponse(stockInPayload)
  })
})

test('stock-in atomic RPC rejects mismatched inputs and malformed bound response envelopes', async () => {
  const stockInPayload = {
    stockInId: 'SI-SECURE-1', sourcePurchaseId: 'PO-SECURE-1', stockInQuantity: 1,
  }
  const inventoryPayload = {
    inventoryId: 'INV-SECURE-1', sourcePurchaseId: 'PO-SECURE-1', quantity: 1,
  }
  let rpcCalls = 0
  const service = createPurchaseService({
    rpc: async () => {
      rpcCalls += 1
      return {
        data: {
          purchase: envelope(),
          stock_in: {
            record_key: 'SI-WRONG', payload: stockInPayload,
            status: 'active', updated_at: '2026-07-17T00:00:00.000Z',
          },
          inventory_item: {
            record_key: inventoryPayload.inventoryId, payload: inventoryPayload,
            status: 'active', updated_at: '2026-07-17T00:00:00.000Z',
          },
        },
        error: null,
      }
    },
  }, { configured: true })

  await assert.rejects(
    () => service.commitStockIn({
      purchaseRecordKey: 'PO-SECURE-1',
      purchasePatch: purchase(),
      stockInRecordKey: 'SI-WRONG-INPUT',
      stockInPayload,
      inventoryRecordKey: 'INV-SECURE-1',
      inventoryPayload,
    }),
    (error) => error.code === 'PURCHASE_INPUT_INVALID',
  )
  assert.equal(rpcCalls, 0)

  await assert.rejects(
    () => service.commitStockIn({
      purchaseRecordKey: 'PO-SECURE-1',
      purchasePatch: purchase(),
      stockInRecordKey: 'SI-SECURE-1',
      stockInPayload,
      inventoryRecordKey: 'INV-SECURE-1',
      inventoryPayload,
    }),
    (error) => error.code === 'PURCHASE_RESPONSE_INVALID',
  )
  assert.equal(rpcCalls, 1)
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

test('secure list snapshots a dense plain outer array without invoking supplier iteration hooks', async (t) => {
  let invoked = 0
  const cases = []

  const accessorIndex = []
  Object.defineProperty(accessorIndex, '0', {
    enumerable: true,
    get() {
      invoked += 1
      return envelope()
    },
  })
  Object.defineProperty(accessorIndex, 'length', { value: 1 })
  cases.push(['accessor index', accessorIndex])

  const ownMap = [envelope()]
  Object.defineProperty(ownMap, 'map', {
    enumerable: true,
    value() {
      invoked += 1
      return []
    },
  })
  cases.push(['own map override', ownMap])

  const ownIterator = [envelope()]
  Object.defineProperty(ownIterator, Symbol.iterator, {
    value() {
      invoked += 1
      return [][Symbol.iterator]()
    },
  })
  cases.push(['own iterator override', ownIterator])

  const inheritedHooks = Object.create(Array.prototype)
  Object.defineProperty(inheritedHooks, 'map', {
    get() {
      invoked += 1
      return Array.prototype.map
    },
  })
  Object.defineProperty(inheritedHooks, Symbol.iterator, {
    get() {
      invoked += 1
      return Array.prototype[Symbol.iterator]
    },
  })
  const inheritedArray = [envelope()]
  Object.setPrototypeOf(inheritedArray, inheritedHooks)
  cases.push(['custom inherited hooks', inheritedArray])

  const sparse = new Array(1)
  cases.push(['sparse array', sparse])

  const extraKey = [envelope()]
  extraKey.extra = envelope()
  cases.push(['extra string key', extraKey])

  for (const [name, data] of cases) {
    await t.test(name, async () => {
      const service = createPurchaseService({
        rpc: async () => ({ data, error: null }),
      }, { configured: true })
      await assert.rejects(
        () => service.getList(),
        (error) => error instanceof PurchaseServiceError &&
          error.code === 'PURCHASE_RESPONSE_INVALID',
      )
    })
  }

  assert.equal(invoked, 0)
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

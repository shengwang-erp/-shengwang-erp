import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WarehouseServiceError,
  createWarehouseService,
} from './warehouseService.js'

const IDS = Object.freeze({
  site: '90000000-0000-4000-8000-000000000001',
  location: '91000000-0000-4000-8000-000000000001',
  item: '92000000-0000-4000-8000-000000000001',
  variant: '93000000-0000-4000-8000-000000000001',
  batch: '94000000-0000-4000-8000-000000000001',
  operator: '96000000-0000-4000-8000-000000000001',
  movement: '97000000-0000-4000-8000-000000000001',
})

const ITEM = Object.freeze({
  id: IDS.item,
  name: '铜管',
  category: '空调材料',
  brand: '厂家A',
  description: '冷媒铜管',
  active: true,
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
})

const VARIANT = Object.freeze({
  id: IDS.variant,
  itemId: IDS.item,
  sku: 'CU-6MM',
  model: 'R410A',
  size: '6mm',
  material: '铜',
  unit: '米',
  minimumStock: 20,
  systemQr: 'SWERP:VARIANT:CU-6MM',
  manufacturerQr: null,
  active: true,
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
})

const SITE = Object.freeze({
  id: IDS.site,
  code: 'MAIN',
  name: '本社仓',
  kind: 'normal',
  active: true,
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
})

const LOCATION = Object.freeze({
  id: IDS.location,
  warehouseId: IDS.site,
  shelfCode: 'A-01',
  shelfName: 'A区一号架',
  active: true,
  createdAt: '2026-08-08T00:00:00Z',
  updatedAt: '2026-08-08T00:00:00Z',
})

const BALANCE = Object.freeze({
  variantId: IDS.variant,
  warehouseId: IDS.site,
  locationId: IDS.location,
  quantity: 12.5,
})

const MOVEMENT = Object.freeze({
  id: IDS.movement,
  movementType: '采购入库',
  variantId: IDS.variant,
  batchId: IDS.batch,
  warehouseId: IDS.site,
  locationId: IDS.location,
  quantityDelta: 12.5,
  sourceDocumentType: 'purchase_receipt',
  sourceDocumentId: 'RECEIPT-1',
  projectId: null,
  destinationType: 'warehouse',
  destinationId: 'MAIN',
  destinationName: '本社仓',
  operatorEmployeeProfileId: IDS.operator,
  occurredAt: '2026-08-08T00:00:00Z',
  reversalOfMovementId: null,
  metadata: { note: '首次入库' },
})

function rpcClient(results = {}) {
  const calls = []
  return {
    calls,
    client: {
      async rpc(name, args = {}) {
        calls.push({ name, args })
        const result = results[name]
        if (typeof result === 'function') return result({ name, args, calls })
        return result ?? { data: [], error: null, status: 200 }
      },
    },
  }
}

function safeError(code, status, authInvalid = false) {
  return (error) =>
    error instanceof WarehouseServiceError &&
    error.code === code &&
    error.status === status &&
    error.authInvalid === authInvalid &&
    !/private|secret|supplier/iu.test(error.message)
}

test('missing configuration fails closed before any RPC or browser storage access', async () => {
  let rpcCalls = 0
  let storageReads = 0
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      storageReads += 1
      throw new Error('browser storage must not be read')
    },
  })

  try {
    const service = createWarehouseService({
      async rpc() {
        rpcCalls += 1
        return { data: [], error: null }
      },
    }, { configured: false })

    for (const operation of [
      () => service.listCatalog(),
      () => service.listLocations(),
      () => service.listBalances(),
      () => service.listMovements(),
    ]) {
      await assert.rejects(operation, safeError('WAREHOUSE_NOT_CONFIGURED', 503))
    }
    assert.equal(rpcCalls, 0)
    assert.equal(storageReads, 0)
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
    else delete globalThis.localStorage
  }
})

test('the four read methods call only their exact secure RPCs and return deep immutable copies', async () => {
  const catalog = { items: [ITEM], variants: [VARIANT] }
  const locations = { sites: [SITE], locations: [LOCATION] }
  const { client, calls } = rpcClient({
    list_warehouse_catalog_secure: { data: catalog, error: null, status: 200 },
    list_warehouse_locations_secure: { data: locations, error: null, status: 200 },
    list_warehouse_balances_secure: { data: [BALANCE], error: null, status: 200 },
    list_warehouse_movements_secure: { data: [MOVEMENT], error: null, status: 200 },
  })
  const service = createWarehouseService(client, { configured: true })

  const returned = [
    await service.listCatalog(),
    await service.listLocations(),
    await service.listBalances(),
    await service.listMovements(),
  ]

  assert.deepEqual(calls, [
    { name: 'list_warehouse_catalog_secure', args: {} },
    { name: 'list_warehouse_locations_secure', args: {} },
    { name: 'list_warehouse_balances_secure', args: { p_filters: { page: 1, pageSize: 100 } } },
    { name: 'list_warehouse_movements_secure', args: { p_filters: { page: 1, pageSize: 100 } } },
  ])
  assert.deepEqual(returned, [catalog, locations, [BALANCE], [MOVEMENT]])
  assert.notEqual(returned[0], catalog)
  assert.notEqual(returned[0].items[0], ITEM)
  assert.notEqual(returned[3][0].metadata, MOVEMENT.metadata)
  for (const value of [
    service,
    ...returned,
    returned[0].items,
    returned[0].items[0],
    returned[1].locations[0],
    returned[3][0].metadata,
  ]) assert.equal(Object.isFrozen(value), true)
  assert.throws(() => { returned[3][0].metadata.note = 'changed' }, TypeError)
  assert.equal(MOVEMENT.metadata.note, '首次入库')
})

test('balance and movement filters are normalized to exact server payloads', async () => {
  const { client, calls } = rpcClient({
    list_warehouse_balances_secure: { data: [], error: null },
    list_warehouse_movements_secure: { data: [], error: null },
  })
  const service = createWarehouseService(client, { configured: true })

  await service.listBalances({
    variantId: IDS.variant,
    warehouseId: IDS.site,
    locationId: IDS.location,
    page: 3,
    pageSize: 500,
  })
  await service.listMovements({
    variantId: IDS.variant,
    warehouseId: IDS.site,
    locationId: IDS.location,
    projectId: 'PROJECT-1',
    movementType: '项目出库',
    occurredFrom: '2026-08-01T00:00:00Z',
    occurredTo: '2026-08-31T23:59:59Z',
    page: 2,
    pageSize: 25,
  })

  assert.deepEqual(calls, [
    {
      name: 'list_warehouse_balances_secure',
      args: { p_filters: {
        variantId: IDS.variant,
        warehouseId: IDS.site,
        locationId: IDS.location,
        page: 3,
        pageSize: 500,
      } },
    },
    {
      name: 'list_warehouse_movements_secure',
      args: { p_filters: {
        variantId: IDS.variant,
        warehouseId: IDS.site,
        locationId: IDS.location,
        projectId: 'PROJECT-1',
        movementType: '项目出库',
        occurredFrom: '2026-08-01T00:00:00Z',
        occurredTo: '2026-08-31T23:59:59Z',
        page: 2,
        pageSize: 25,
      } },
    },
  ])
})

test('unknown filters, exotic objects, invalid dates and page sizes are rejected before RPC', async () => {
  const { client, calls } = rpcClient()
  const service = createWarehouseService(client, { configured: true })
  const invalidCalls = [
    () => service.listBalances({ unknown: true }),
    () => service.listBalances(Object.create({ page: 1 })),
    () => service.listBalances({ page: 0 }),
    () => service.listBalances({ pageSize: 501 }),
    () => service.listBalances({ pageSize: 1.5 }),
    () => service.listBalances({ variantId: 'not-a-uuid' }),
    () => service.listMovements({ movementType: '未知' }),
    () => service.listMovements({ occurredFrom: 'not-a-date' }),
    () => service.listMovements({ occurredFrom: '2026-09-01T00:00:00Z', occurredTo: '2026-08-01T00:00:00Z' }),
  ]
  for (const operation of invalidCalls) {
    await assert.rejects(operation, safeError('WAREHOUSE_INVALID_FILTER', 400))
  }
  assert.deepEqual(calls, [])
})

test('401 and 403 supplier failures normalize without exposing supplier details', async () => {
  const cases = [
    [{ data: null, error: { status: 401, message: 'private token detail' }, status: 401 }, 'AUTH_SESSION_INVALID', 401, true],
    [{ data: null, error: { code: 'PGRST301', message: 'secret jwt detail' } }, 'AUTH_SESSION_INVALID', 401, true],
    [{ data: null, error: { code: '42501', message: 'private policy detail' }, status: 403 }, 'ACCESS_DENIED', 403, false],
  ]
  for (const [result, code, status, authInvalid] of cases) {
    const { client } = rpcClient({ list_warehouse_catalog_secure: result })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).listCatalog(),
      safeError(code, status, authInvalid),
    )
  }

  const { client } = rpcClient({
    list_warehouse_catalog_secure: () => { throw Object.assign(new Error('supplier secret'), { status: 403 }) },
  })
  await assert.rejects(
    createWarehouseService(client, { configured: true }).listCatalog(),
    safeError('ACCESS_DENIED', 403),
  )
})

test('inherited and accessor supplier signals fail closed without invoking unsafe getters', async () => {
  let statusGetterCalls = 0
  let rpcGetterCalls = 0
  const accessorError = {}
  Object.defineProperty(accessorError, 'status', {
    enumerable: true,
    get() {
      statusGetterCalls += 1
      return 401
    },
  })
  const inheritedError = Object.create({ status: 401, code: 'PGRST301' })

  for (const error of [accessorError, inheritedError]) {
    const { client } = rpcClient({
      list_warehouse_catalog_secure: { data: null, error, status: 503 },
    })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).listCatalog(),
      safeError('WAREHOUSE_SERVICE_UNAVAILABLE', 503),
    )
  }

  const accessorClient = {}
  Object.defineProperty(accessorClient, 'rpc', {
    enumerable: true,
    get() {
      rpcGetterCalls += 1
      throw new Error('private rpc getter')
    },
  })
  await assert.rejects(
    createWarehouseService(accessorClient, { configured: true }).listCatalog(),
    safeError('WAREHOUSE_NOT_CONFIGURED', 503),
  )
  assert.equal(statusGetterCalls, 0)
  assert.equal(rpcGetterCalls, 0)
})

test('strict response validation rejects non-plain containers, accessors, extra keys and wrong field types', async () => {
  let getterCalls = 0
  const accessorItem = { ...ITEM }
  Object.defineProperty(accessorItem, 'name', {
    enumerable: true,
    get() {
      getterCalls += 1
      return 'getter value'
    },
  })
  const malformedResults = [
    null,
    [],
    Object.assign(Object.create(null), { items: [], variants: [] }),
    { items: {}, variants: [] },
    { items: [{ ...ITEM, extra: true }], variants: [] },
    { items: [{ ...ITEM, active: 1 }], variants: [] },
    { items: [accessorItem], variants: [] },
    { items: [ITEM], variants: [{ ...VARIANT, minimumStock: Number.NaN }] },
  ]
  for (const data of malformedResults) {
    const { client } = rpcClient({ list_warehouse_catalog_secure: { data, error: null } })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).listCatalog(),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }
  assert.equal(getterCalls, 0)

  const malformedMovement = { ...MOVEMENT, metadata: [] }
  const { client } = rpcClient({
    list_warehouse_movements_secure: { data: [malformedMovement], error: null },
  })
  await assert.rejects(
    createWarehouseService(client, { configured: true }).listMovements(),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
})

test('cost fields are rejected unless viewCost is explicit and accepted only as exact finite numbers', async () => {
  const costCatalog = {
    items: [ITEM],
    variants: [{ ...VARIANT, defaultPurchasePrice: 118.25 }],
  }
  const costBalances = [{ ...BALANCE, unitCost: 120.5, stockValue: 1506.25 }]
  const costMovements = [{ ...MOVEMENT, unitCost: 120.5 }]
  const results = {
    list_warehouse_catalog_secure: { data: costCatalog, error: null },
    list_warehouse_balances_secure: { data: costBalances, error: null },
    list_warehouse_movements_secure: { data: costMovements, error: null },
  }

  for (const operation of ['listCatalog', 'listBalances', 'listMovements']) {
    const { client } = rpcClient(results)
    await assert.rejects(
      createWarehouseService(client, { configured: true })[operation](),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }

  const { client } = rpcClient(results)
  const service = createWarehouseService(client, { configured: true, viewCost: true })
  assert.deepEqual(await service.listCatalog(), costCatalog)
  assert.deepEqual(await service.listBalances(), costBalances)
  assert.deepEqual(await service.listMovements(), costMovements)

  const invalidCostClient = rpcClient({
    list_warehouse_balances_secure: { data: [{ ...BALANCE, unitCost: -1, stockValue: 0 }], error: null },
  }).client
  await assert.rejects(
    createWarehouseService(invalidCostClient, { configured: true, viewCost: true }).listBalances(),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
})

test('service options are a closed plain-object contract', () => {
  const { client } = rpcClient()
  for (const options of [
    null,
    [],
    Object.create(null),
    { configured: true, fallback: 'local' },
    { configured: 'yes' },
    { configured: true, viewCost: 1 },
  ]) {
    assert.throws(
      () => createWarehouseService(client, options),
      safeError('WAREHOUSE_NOT_CONFIGURED', 503),
    )
  }
})

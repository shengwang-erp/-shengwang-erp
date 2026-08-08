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
  minorWorkOrder: '98000000-0000-4000-8000-000000000001',
  receipt: '99000000-0000-4000-8000-000000000001',
  stockOut: '9a000000-0000-4000-8000-000000000001',
  stockOutLine: '9b000000-0000-4000-8000-000000000001',
  returnRequest: '9c000000-0000-4000-8000-000000000001',
  variant2: '93000000-0000-4000-8000-000000000002',
  location2: '91000000-0000-4000-8000-000000000002',
  responseLine2: '9b000000-0000-4000-8000-000000000002',
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

const QR_RESOLUTION = Object.freeze({
  id: IDS.variant,
  itemId: IDS.item,
  itemName: '铜管',
  category: '空调材料',
  brand: '厂家A',
  sku: 'CU-6MM',
  model: 'R410A',
  size: '6mm',
  material: '铜',
  unit: '米',
  systemQr: `SWERP:VARIANT:${IDS.variant}`,
  manufacturerQr: 'Maker-CU-6MM',
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

test('metadata cloning preserves dangerous JSON keys as frozen own data without prototype mutation', async () => {
  const metadata = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"nested":{"__proto__":"kept"}}',
  )
  const { client } = rpcClient({
    list_warehouse_movements_secure: {
      data: [{ ...MOVEMENT, metadata }],
      error: null,
    },
  })

  const [movement] = await createWarehouseService(client, { configured: true }).listMovements()
  const returned = movement.metadata

  assert.equal(Object.getPrototypeOf(returned), Object.prototype)
  assert.equal(Object.getPrototypeOf(returned.nested), Object.prototype)
  for (const [object, key] of [
    [returned, '__proto__'],
    [returned, 'constructor'],
    [returned.nested, '__proto__'],
  ]) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    assert.equal(descriptor?.enumerable, true)
    assert.equal('value' in descriptor, true)
    assert.equal(typeof descriptor.get, 'undefined')
  }
  assert.deepEqual(returned.__proto__, { polluted: true })
  assert.deepEqual(returned.constructor, { prototype: { polluted: true } })
  assert.equal(returned.nested.__proto__, 'kept')
  assert.equal(Object.isFrozen(returned.__proto__), true)
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(({}).polluted, undefined)
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
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
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

test('supplier statuses use trusted primitives only and never execute coercion hooks', async () => {
  let coercionCalls = 0
  const hostileStatus = {
    valueOf() {
      coercionCalls += 1
      throw new Error('private valueOf detail')
    },
    toString() {
      coercionCalls += 1
      throw new Error('private toString detail')
    },
    [Symbol.toPrimitive]() {
      coercionCalls += 1
      throw new Error('private primitive detail')
    },
  }
  const unsupported = [hostileStatus, Symbol('401'), 401n, () => 401]
  for (const status of unsupported) {
    const { client } = rpcClient({
      list_warehouse_catalog_secure: { data: null, error: { status } },
    })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).listCatalog(),
      safeError('WAREHOUSE_SERVICE_UNAVAILABLE', 503),
    )
  }
  assert.equal(coercionCalls, 0)

  for (const status of [' 401', '0401', '+401', '401.0', '4.01e2']) {
    const { client } = rpcClient({
      list_warehouse_catalog_secure: { data: null, error: { status } },
    })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).listCatalog(),
      safeError('WAREHOUSE_SERVICE_UNAVAILABLE', 503),
    )
  }

  for (const [status, code, safeStatus, authInvalid] of [
    [401, 'AUTH_SESSION_INVALID', 401, true],
    ['401', 'AUTH_SESSION_INVALID', 401, true],
    [403, 'ACCESS_DENIED', 403, false],
    ['403', 'ACCESS_DENIED', 403, false],
  ]) {
    const { client } = rpcClient({
      list_warehouse_catalog_secure: { data: null, error: { status } },
    })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).listCatalog(),
      safeError(code, safeStatus, authInvalid),
    )
  }
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

test('cost balances derive four-decimal stock value and reject invalid zero-quantity cost semantics', async () => {
  const { client } = rpcClient({
    list_warehouse_balances_secure: {
      data: [{ ...BALANCE, quantity: 2, unitCost: 100, stockValue: 999 }],
      error: null,
    },
  })
  assert.deepEqual(
    await createWarehouseService(client, { configured: true, viewCost: true }).listBalances(),
    [{ ...BALANCE, quantity: 2, unitCost: 100, stockValue: 200 }],
  )

  const halfAwayClient = rpcClient({
    list_warehouse_balances_secure: {
      data: [{ ...BALANCE, quantity: 0.5, unitCost: 0.0001, stockValue: 0 }],
      error: null,
    },
  }).client
  assert.equal(
    (await createWarehouseService(
      halfAwayClient,
      { configured: true, viewCost: true },
    ).listBalances())[0].stockValue,
    0.0001,
  )

  const zeroClient = rpcClient({
    list_warehouse_balances_secure: {
      data: [{ ...BALANCE, quantity: 0, unitCost: 1, stockValue: 0 }],
      error: null,
    },
  }).client
  await assert.rejects(
    createWarehouseService(zeroClient, { configured: true, viewCost: true }).listBalances(),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
})

test('large four-decimal costs stay exact and scaled quantity/value contracts fail closed', async () => {
  const exactCost = 100000000000.0001
  const exactClient = rpcClient({
    list_warehouse_balances_secure: {
      data: [{ ...BALANCE, quantity: 1, unitCost: exactCost, stockValue: 1 }],
      error: null,
    },
  }).client
  assert.deepEqual(
    await createWarehouseService(exactClient, { configured: true, viewCost: true }).listBalances(),
    [{ ...BALANCE, quantity: 1, unitCost: exactCost, stockValue: exactCost }],
  )

  for (const balanceRow of [
    { ...BALANCE, quantity: 1.0001, unitCost: 1, stockValue: 1 },
    { ...BALANCE, quantity: 0, unitCost: 0, stockValue: 0.0001 },
  ]) {
    const client = rpcClient({
      list_warehouse_balances_secure: { data: [balanceRow], error: null },
    }).client
    await assert.rejects(
      createWarehouseService(client, { configured: true, viewCost: true }).listBalances(),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }
})

test('movement metadata rejects nested cost keys without permission and preserves them with permission', async () => {
  const metadata = {
    safe: 'keep',
    nested: [
      { unitCost: 1, unit_cost: 2 },
      { deeper: { stockValue: 3, stock_value: 4 } },
      { defaultPurchasePrice: 5, default_purchase_price: 6 },
    ],
  }
  const movement = { ...MOVEMENT, metadata }
  const results = {
    list_warehouse_movements_secure: { data: [movement], error: null },
  }

  await assert.rejects(
    createWarehouseService(rpcClient(results).client, { configured: true }).listMovements(),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )

  const costMovement = { ...movement, unitCost: 120.5 }
  const { client } = rpcClient({
    list_warehouse_movements_secure: { data: [costMovement], error: null },
  })
  const [returned] = await createWarehouseService(
    client,
    { configured: true, viewCost: true },
  ).listMovements()
  assert.deepEqual(returned.metadata, metadata)
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
    { configured: true, manageCatalog: 1 },
  ]) {
    assert.throws(
      () => createWarehouseService(client, options),
      safeError('WAREHOUSE_NOT_CONFIGURED', 503),
    )
  }
})

test('four catalog save methods call only bound secure RPCs and validate immutable responses', async () => {
  const savedVariant = {
    ...VARIANT,
    systemQr: `SWERP:VARIANT:${IDS.variant}`,
    defaultPurchasePrice: 118.2501,
  }
  const { client, calls } = rpcClient({
    upsert_warehouse_site_secure: { data: SITE, error: null, status: 200 },
    upsert_warehouse_location_secure: { data: LOCATION, error: null, status: 200 },
    upsert_warehouse_item_secure: { data: ITEM, error: null, status: 200 },
    upsert_warehouse_variant_secure: { data: savedVariant, error: null, status: 200 },
  })
  const service = createWarehouseService(client, { configured: true, viewCost: true })

  const results = [
    await service.saveSite({
      id: IDS.site, code: ' MAIN ', name: ' 本社仓 ', kind: 'normal', active: true,
    }),
    await service.saveLocation({
      id: IDS.location,
      warehouseId: IDS.site,
      shelfCode: ' A-01 ',
      shelfName: ' A区一号架 ',
      active: true,
    }),
    await service.saveItem({
      id: IDS.item,
      name: ' 铜管 ',
      category: ' 空调材料 ',
      brand: ' 厂家A ',
      description: ' 冷媒铜管 ',
      active: true,
    }),
    await service.saveVariant({
      id: IDS.variant,
      itemId: IDS.item,
      sku: ' CU-6MM ',
      model: ' R410A ',
      size: ' 6mm ',
      material: ' 铜 ',
      unit: ' 米 ',
      minimumStock: 20,
      defaultPurchasePrice: 118.2501,
      manufacturerQr: null,
      active: true,
    }),
  ]

  assert.deepEqual(calls, [
    ['upsert_warehouse_site_secure', IDS.site, {
      id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true,
    }],
    ['upsert_warehouse_location_secure', IDS.location, {
      id: IDS.location,
      warehouseId: IDS.site,
      shelfCode: 'A-01',
      shelfName: 'A区一号架',
      active: true,
    }],
    ['upsert_warehouse_item_secure', IDS.item, {
      id: IDS.item,
      name: '铜管',
      category: '空调材料',
      brand: '厂家A',
      description: '冷媒铜管',
      active: true,
    }],
    ['upsert_warehouse_variant_secure', IDS.variant, {
      id: IDS.variant,
      itemId: IDS.item,
      sku: 'CU-6MM',
      model: 'R410A',
      size: '6mm',
      material: '铜',
      unit: '米',
      minimumStock: 20,
      defaultPurchasePrice: 118.2501,
      manufacturerQr: null,
      active: true,
    }],
  ].map(([name, id, payload]) => ({
    name,
    args: {
      [`p_${name.match(/upsert_warehouse_(.+)_secure/u)[1]}_id`]: id,
      p_payload: payload,
    },
  })))
  assert.deepEqual(results, [SITE, LOCATION, ITEM, savedVariant])
  for (const result of results) assert.equal(Object.isFrozen(result), true)
})

test('catalog saves fail before RPC on invalid closed inputs and malformed bound responses', async () => {
  const { client, calls } = rpcClient({
    upsert_warehouse_site_secure: { data: { ...SITE, id: IDS.location }, error: null },
    upsert_warehouse_variant_secure: { data: { ...VARIANT, systemQr: 'browser-value' }, error: null },
  })
  const service = createWarehouseService(client, { configured: true })

  await assert.rejects(
    service.saveSite({ id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true, extra: 1 }),
    safeError('WAREHOUSE_CATALOG_INPUT_INVALID', 400),
  )
  await assert.rejects(
    service.saveSite({ id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true }),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
  await assert.rejects(
    service.saveVariant({
      id: IDS.variant,
      itemId: IDS.item,
      sku: 'CU-6MM',
      model: '',
      size: '',
      material: '',
      unit: '米',
      minimumStock: 0,
      defaultPurchasePrice: 0,
      manufacturerQr: null,
      active: true,
    }),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
  assert.equal(calls.length, 2)
})

test('catalog mutation database hints normalize to stable Chinese-safe service errors', async () => {
  const input = { id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: false }
  const cases = [
    ['WAREHOUSE_CATALOG_ID_MISMATCH', 400, '22023', 400],
    ['WAREHOUSE_CATALOG_CONFLICT', 409, '23505', 409],
    ['WAREHOUSE_CATALOG_RELATION_INVALID', 409, '23503', 409],
    ['WAREHOUSE_SITE_IN_USE', 409, '55000', 500],
    ['WAREHOUSE_LOCATION_HAS_STOCK', 409, '55000', 500],
    ['WAREHOUSE_ITEM_IN_USE', 409, '55000', 500],
    ['WAREHOUSE_VARIANT_HAS_STOCK', 409, '55000', 500],
    ['WAREHOUSE_VARIANT_HAS_PENDING_DOCUMENT', 409, '55000', 500],
    ['WAREHOUSE_PENDING_SCHEMA_INCOMPLETE', 503, '55000', 500],
  ]
  for (const [code, safeStatus, sqlState, transportStatus] of cases) {
    const { client } = rpcClient({
      upsert_warehouse_site_secure: {
        data: null,
        error: { code: sqlState, hint: code, message: 'private item price and description' },
        status: transportStatus,
      },
    })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).saveSite(input),
      safeError(code, safeStatus),
    )
  }
})

test('authentication status takes precedence over any catalog conflict hint', async () => {
  const { client } = rpcClient({
    upsert_warehouse_site_secure: {
      data: null,
      error: {
        status: 401,
        code: 'PGRST301',
        hint: 'WAREHOUSE_CATALOG_CONFLICT',
        message: 'private supplier detail',
      },
      status: 401,
    },
  })
  await assert.rejects(
    createWarehouseService(client, { configured: true }).saveSite({
      id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true,
    }),
    safeError('AUTH_SESSION_INVALID', 401, true),
  )
})

test('catalog hints require their exact trusted SQLSTATE and transport status pair', async () => {
  const input = { id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: false }
  for (const [code, status, hint] of [
    ['XX000', 500, 'WAREHOUSE_SITE_IN_USE'],
    ['55000', 409, 'WAREHOUSE_SITE_IN_USE'],
    ['23505', 500, 'WAREHOUSE_CATALOG_CONFLICT'],
    ['22023', 409, 'WAREHOUSE_CATALOG_INPUT_INVALID'],
  ]) {
    const { client } = rpcClient({
      upsert_warehouse_site_secure: {
        data: null,
        error: { code, hint, message: 'private supplier detail' },
        status,
      },
    })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).saveSite(input),
      safeError('WAREHOUSE_SERVICE_UNAVAILABLE', 503),
    )
  }

  const { client } = rpcClient({
    upsert_warehouse_site_secure: {
      data: null,
      error: {
        code: '55000', status: 500, hint: 'WAREHOUSE_SITE_IN_USE',
        message: 'private supplier detail',
      },
    },
  })
  await assert.rejects(
    createWarehouseService(client, { configured: true }).saveSite(input),
    safeError('WAREHOUSE_SERVICE_UNAVAILABLE', 503),
  )
})

test('catalog saves validate after await only against the frozen canonical request', async () => {
  let releaseLocation
  let releaseVariant
  const locationInput = {
    id: IDS.location,
    warehouseId: IDS.site,
    shelfCode: 'A-01',
    shelfName: 'A区一号架',
    active: true,
  }
  const variantInput = {
    id: IDS.variant,
    itemId: IDS.item,
    sku: 'CU-6MM',
    model: 'R410A',
    size: '6mm',
    material: '铜',
    unit: '米',
    minimumStock: 20,
    defaultPurchasePrice: 118.25,
    manufacturerQr: null,
    active: true,
  }
  const { client } = rpcClient({
    upsert_warehouse_location_secure: () => new Promise((resolve) => {
      releaseLocation = resolve
    }),
    upsert_warehouse_variant_secure: () => new Promise((resolve) => {
      releaseVariant = resolve
    }),
  })
  const service = createWarehouseService(client, { configured: true, viewCost: true })

  const locationPromise = service.saveLocation(locationInput)
  locationInput.warehouseId = null
  releaseLocation({ data: LOCATION, error: null, status: 200 })
  assert.deepEqual(await locationPromise, LOCATION)

  const savedVariant = {
    ...VARIANT,
    systemQr: `SWERP:VARIANT:${IDS.variant}`,
    defaultPurchasePrice: 118.25,
  }
  const variantPromise = service.saveVariant(variantInput)
  variantInput.itemId = null
  releaseVariant({ data: savedVariant, error: null, status: 200 })
  assert.deepEqual(await variantPromise, savedVariant)
})

test('manage-only service configuration accepts warehouse purchase price without other cost scopes', async () => {
  const catalog = {
    items: [ITEM],
    variants: [{ ...VARIANT, defaultPurchasePrice: 118.25 }],
  }
  const { client } = rpcClient({
    list_warehouse_catalog_secure: { data: catalog, error: null, status: 200 },
  })

  const result = await createWarehouseService(client, {
    configured: true,
    manageCatalog: true,
  }).listCatalog()

  assert.equal(result.variants[0].defaultPurchasePrice, 118.25)
})

test('catalog transport envelopes reject forged keys and malformed optional fields', async () => {
  const input = { id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true }
  for (const response of [
    { data: SITE, error: null, status: 200, forged: true },
    { data: SITE, error: null, status: 200, count: 'one' },
    { data: SITE, error: null, status: 200, statusText: 200 },
    { data: SITE, error: 'forged', status: 500 },
    { data: SITE, error: undefined, status: 200 },
  ]) {
    const { client } = rpcClient({ upsert_warehouse_site_secure: response })
    await assert.rejects(
      createWarehouseService(client, { configured: true }).saveSite(input),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }
})

test('pending workflow methods call only secure RPCs with canonical builders and return immutable exact documents', async () => {
  const minor = {
    id: IDS.minorWorkOrder,
    title: '安装空调', customerName: '未来社', workDate: '2026-08-09',
    locationText: '東京都港区', description: '', status: 'open',
    assignedProjectId: null, createdByEmployeeProfileId: IDS.operator,
    createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
  }
  const receipt = {
    id: IDS.receipt, purchaseRecordKey: 'BUY-001', status: 'pending',
    submittedByEmployeeProfileId: IDS.operator, submittedAt: '2026-08-09T00:00:00Z',
    confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
    idempotencyKey: 'receipt-1',
    lines: [{
      id: IDS.stockOutLine, receiptId: IDS.receipt, variantId: IDS.variant,
      requestedQuantity: 2, confirmedQuantity: null, warehouseId: IDS.site,
      locationId: IDS.location, unitCost: null,
    }],
  }
  const outbound = {
    id: IDS.stockOut, destinationType: 'minor_work_order', projectId: null,
    minorWorkOrderId: IDS.minorWorkOrder, destinationNameSnapshot: '未来社安装空调',
    purpose: '安装', receiver: '王师傅', requestDate: '2026-08-09', status: 'pending',
    submittedByEmployeeProfileId: IDS.operator, submittedAt: '2026-08-09T00:00:00Z',
    confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
    idempotencyKey: 'out-1',
    lines: [{
      id: IDS.stockOutLine, requestId: IDS.stockOut, variantId: IDS.variant,
      requestedQuantity: 1, confirmedQuantity: null, frozenTotalCost: null,
    }],
  }
  const returned = {
    id: IDS.returnRequest, originalStockOutId: IDS.stockOut, reason: '未使用',
    receiver: '仓库负责人', requestDate: '2026-08-10', status: 'pending',
    submittedByEmployeeProfileId: IDS.operator, submittedAt: '2026-08-10T00:00:00Z',
    confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
    idempotencyKey: 'return-1',
    lines: [{
      id: IDS.receipt, returnId: IDS.returnRequest,
      originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 1,
      confirmedQuantity: null, frozenTotalCost: null,
    }],
  }
  const assigned = { ...minor, status: 'assigned', assignedProjectId: 'P001' }
  const { client, calls } = rpcClient({
    create_minor_work_order_secure: { data: minor, error: null, status: 200 },
    assign_minor_work_order_to_project_secure: { data: assigned, error: null, status: 200 },
    submit_warehouse_receipt_secure: { data: receipt, error: null, status: 200 },
    submit_warehouse_stock_out_secure: { data: outbound, error: null, status: 200 },
    submit_warehouse_return_secure: { data: returned, error: null, status: 200 },
  })
  const service = createWarehouseService(client, { configured: true })

  const results = [
    await service.createMinorWorkOrder({
      title: ' 安装空调 ', customerName: ' 未来社 ', workDate: '2026-08-09',
      locationText: ' 東京都港区 ', description: '',
    }),
    await service.assignMinorWorkOrder({ minorWorkOrderId: IDS.minorWorkOrder, projectId: 'P001' }),
    await service.submitReceipt({
      purchaseRecordKey: 'BUY-001', idempotencyKey: 'receipt-1',
      lines: [{
        variantId: IDS.variant, requestedQuantity: 2,
        warehouseId: IDS.site, locationId: IDS.location,
      }],
    }),
    await service.submitStockOut({
      destinationType: 'minor_work_order', projectId: null,
      minorWorkOrderId: IDS.minorWorkOrder, destinationNameSnapshot: '未来社安装空调',
      purpose: '安装', receiver: '王师傅', requestDate: '2026-08-09',
      idempotencyKey: 'out-1', lines: [{ variantId: IDS.variant, requestedQuantity: 1 }],
    }),
    await service.submitReturn({
      originalStockOutId: IDS.stockOut, reason: '未使用', receiver: '仓库负责人',
      requestDate: '2026-08-10', idempotencyKey: 'return-1',
      lines: [{ originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 1 }],
    }),
  ]

  assert.deepEqual(calls, [
    { name: 'create_minor_work_order_secure', args: {
      p_payload: { title: '安装空调', customerName: '未来社', workDate: '2026-08-09', locationText: '東京都港区', description: '' },
    } },
    { name: 'assign_minor_work_order_to_project_secure', args: {
      p_minor_work_order_id: IDS.minorWorkOrder, p_project_id: 'P001',
    } },
    { name: 'submit_warehouse_receipt_secure', args: {
      p_purchase_record_key: 'BUY-001',
      p_lines: [{ variantId: IDS.variant, requestedQuantity: 2, warehouseId: IDS.site, locationId: IDS.location }],
      p_idempotency_key: 'receipt-1',
    } },
    { name: 'submit_warehouse_stock_out_secure', args: {
      p_request: {
        destinationType: 'minor_work_order', projectId: null,
        minorWorkOrderId: IDS.minorWorkOrder, destinationNameSnapshot: '未来社安装空调',
        purpose: '安装', receiver: '王师傅', requestDate: '2026-08-09',
      },
      p_lines: [{ variantId: IDS.variant, requestedQuantity: 1 }],
      p_idempotency_key: 'out-1',
    } },
    { name: 'submit_warehouse_return_secure', args: {
      p_original_stock_out_id: IDS.stockOut,
      p_request: { reason: '未使用', receiver: '仓库负责人', requestDate: '2026-08-10' },
      p_lines: [{ originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 1 }],
      p_idempotency_key: 'return-1',
    } },
  ])
  assert.deepEqual(results, [minor, assigned, receipt, outbound, returned])
  for (const result of results) {
    assert.equal(Object.isFrozen(result), true)
    if (result.lines) assert.equal(Object.isFrozen(result.lines[0]), true)
  }
})

test('pending workflow service rejects client authority and malformed server documents before exposing success', async () => {
  const { client, calls } = rpcClient({
    submit_warehouse_receipt_secure: {
      data: {
        id: IDS.receipt, purchaseRecordKey: 'BUY-001', status: 'pending',
        submittedByEmployeeProfileId: IDS.operator, submittedAt: '2026-08-09T00:00:00Z',
        confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
        idempotencyKey: 'receipt-1', lines: [], forged: true,
      },
      error: null,
      status: 200,
    },
  })
  const service = createWarehouseService(client, { configured: true })
  await assert.rejects(service.submitReceipt({
    purchaseRecordKey: 'BUY-001', idempotencyKey: 'receipt-1',
    lines: [{
      variantId: IDS.variant, requestedQuantity: 1, warehouseId: IDS.site,
      locationId: IDS.location, unitCost: 100,
    }],
  }), safeError('WAREHOUSE_WORKFLOW_INPUT_INVALID', 400))
  assert.equal(calls.length, 0)

  await assert.rejects(service.submitReceipt({
    purchaseRecordKey: 'BUY-001', idempotencyKey: 'receipt-1',
    lines: [{
      variantId: IDS.variant, requestedQuantity: 1,
      warehouseId: IDS.site, locationId: IDS.location,
    }],
  }), safeError('WAREHOUSE_INVALID_RESPONSE', 502))
  assert.equal(calls.length, 1)
})

test('pending workflow responses cannot expose costs even when warehouse cost permission exists', async () => {
  const receipt = {
    id: IDS.receipt, purchaseRecordKey: 'BUY-001', status: 'pending',
    submittedByEmployeeProfileId: IDS.operator, submittedAt: '2026-08-09T00:00:00Z',
    confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
    idempotencyKey: 'receipt-cost',
    lines: [{
      id: IDS.stockOutLine, receiptId: IDS.receipt, variantId: IDS.variant,
      requestedQuantity: 1, confirmedQuantity: null, warehouseId: IDS.site,
      locationId: IDS.location, unitCost: 100,
    }],
  }
  const input = {
    purchaseRecordKey: 'BUY-001', idempotencyKey: 'receipt-cost',
    lines: [{
      variantId: IDS.variant, requestedQuantity: 1,
      warehouseId: IDS.site, locationId: IDS.location,
    }],
  }
  const results = { submit_warehouse_receipt_secure: { data: receipt, error: null, status: 200 } }
  await assert.rejects(
    createWarehouseService(rpcClient(results).client, { configured: true }).submitReceipt(input),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
  await assert.rejects(
    createWarehouseService(
      rpcClient(results).client,
      { configured: true, viewCost: true },
    ).submitReceipt(input),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
})

test('workflow submission binds the normalized request to the exact returned document and line set', async () => {
  const input = {
    purchaseRecordKey: 'BUY-BOUND', idempotencyKey: 'receipt-bound',
    lines: [
      { variantId: IDS.variant, requestedQuantity: 1, warehouseId: IDS.site, locationId: IDS.location },
      { variantId: IDS.variant2, requestedQuantity: 2.5, warehouseId: IDS.site, locationId: IDS.location2 },
    ],
  }
  const base = {
    id: IDS.receipt, purchaseRecordKey: 'BUY-BOUND', status: 'pending',
    submittedByEmployeeProfileId: IDS.operator, submittedAt: '2026-08-09T00:00:00Z',
    confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
    idempotencyKey: 'receipt-bound',
    lines: [
      {
        id: IDS.responseLine2, receiptId: IDS.receipt, variantId: IDS.variant2,
        requestedQuantity: 2.5, confirmedQuantity: null, warehouseId: IDS.site,
        locationId: IDS.location2, unitCost: null,
      },
      {
        id: IDS.stockOutLine, receiptId: IDS.receipt, variantId: IDS.variant,
        requestedQuantity: 1, confirmedQuantity: null, warehouseId: IDS.site,
        locationId: IDS.location, unitCost: null,
      },
    ],
  }
  const serviceFor = (data) => createWarehouseService(rpcClient({
    submit_warehouse_receipt_secure: { data, error: null, status: 200 },
  }).client, { configured: true })

  assert.deepEqual((await serviceFor(base).submitReceipt(input)).lines, base.lines)
  for (const forged of [
    { ...base, purchaseRecordKey: 'BUY-OTHER' },
    { ...base, idempotencyKey: 'receipt-other' },
    { ...base, status: 'confirmed', confirmedByEmployeeProfileId: IDS.operator, confirmedAt: '2026-08-09T01:00:00Z' },
    { ...base, lines: [{ ...base.lines[0], requestedQuantity: 2.25 }, base.lines[1]] },
    { ...base, lines: [{ ...base.lines[0], variantId: IDS.variant }, base.lines[1]] },
    { ...base, lines: [{ ...base.lines[0], locationId: IDS.location }, base.lines[1]] },
    { ...base, lines: [base.lines[1], { ...base.lines[1], id: IDS.responseLine2 }] },
  ]) {
    await assert.rejects(
      serviceFor(forged).submitReceipt(input),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }
})

test('minor, stock-out and return responses reject another otherwise valid document', async () => {
  const audit = {
    status: 'pending', submittedByEmployeeProfileId: IDS.operator,
    submittedAt: '2026-08-09T00:00:00Z', confirmedByEmployeeProfileId: null,
    confirmedAt: null, rejectionReason: null,
  }
  const minorInput = {
    title: '安装空调', customerName: '未来社', workDate: '2026-08-09',
    locationText: '东京', description: '',
  }
  const minor = {
    id: IDS.minorWorkOrder, ...minorInput, status: 'open', assignedProjectId: null,
    createdByEmployeeProfileId: IDS.operator, createdAt: '2026-08-09T00:00:00Z',
    updatedAt: '2026-08-09T00:00:00Z',
  }
  await assert.rejects(
    createWarehouseService(rpcClient({
      create_minor_work_order_secure: { data: { ...minor, title: '另一张工事单' }, error: null, status: 200 },
    }).client, { configured: true }).createMinorWorkOrder(minorInput),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )
  await assert.rejects(
    createWarehouseService(rpcClient({
      assign_minor_work_order_to_project_secure: {
        data: { ...minor, status: 'assigned', assignedProjectId: 'P-OTHER' }, error: null, status: 200,
      },
    }).client, { configured: true }).assignMinorWorkOrder({
      minorWorkOrderId: IDS.minorWorkOrder, projectId: 'P001',
    }),
    safeError('WAREHOUSE_INVALID_RESPONSE', 502),
  )

  const stockInput = {
    destinationType: 'internal_use', projectId: null, minorWorkOrderId: null,
    destinationNameSnapshot: '公司内部使用', purpose: '维修', receiver: '王师傅',
    requestDate: '2026-08-09', idempotencyKey: 'out-bound',
    lines: [{ variantId: IDS.variant, requestedQuantity: 1 }],
  }
  const stock = {
    id: IDS.stockOut, destinationType: 'internal_use', projectId: null,
    minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
    receiver: '王师傅', requestDate: '2026-08-09', ...audit,
    idempotencyKey: 'out-bound', lines: [{
      id: IDS.stockOutLine, requestId: IDS.stockOut, variantId: IDS.variant,
      requestedQuantity: 1, confirmedQuantity: null, frozenTotalCost: null,
    }],
  }
  for (const forged of [
    { ...stock, destinationNameSnapshot: '另一目的地' },
    { ...stock, purpose: '另一用途' },
    { ...stock, idempotencyKey: 'out-other' },
    { ...stock, lines: [{ ...stock.lines[0], requestedQuantity: 2 }] },
  ]) {
    await assert.rejects(
      createWarehouseService(rpcClient({
        submit_warehouse_stock_out_secure: { data: forged, error: null, status: 200 },
      }).client, { configured: true }).submitStockOut(stockInput),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }

  const returnInput = {
    originalStockOutId: IDS.stockOut, reason: '未使用', receiver: '仓库负责人',
    requestDate: '2026-08-10', idempotencyKey: 'return-bound',
    lines: [{ originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 1 }],
  }
  const returned = {
    id: IDS.returnRequest, originalStockOutId: IDS.stockOut, reason: '未使用',
    receiver: '仓库负责人', requestDate: '2026-08-10', ...audit,
    idempotencyKey: 'return-bound', lines: [{
      id: IDS.receipt, returnId: IDS.returnRequest,
      originalStockOutLineId: IDS.stockOutLine, requestedQuantity: 1,
      confirmedQuantity: null, frozenTotalCost: null,
    }],
  }
  for (const forged of [
    { ...returned, originalStockOutId: IDS.receipt },
    { ...returned, idempotencyKey: 'return-other' },
    { ...returned, lines: [{ ...returned.lines[0], originalStockOutLineId: IDS.responseLine2 }] },
    { ...returned, lines: [{ ...returned.lines[0], requestedQuantity: 0.5 }] },
  ]) {
    await assert.rejects(
      createWarehouseService(rpcClient({
        submit_warehouse_return_secure: { data: forged, error: null, status: 200 },
      }).client, { configured: true }).submitReturn(returnInput),
      safeError('WAREHOUSE_INVALID_RESPONSE', 502),
    )
  }
})

test('workflow database hints map only exact trusted tuples to corrective safe errors', async () => {
  const input = {
    purchaseRecordKey: 'BUY-001', idempotencyKey: 'receipt-hint',
    lines: [{
      variantId: IDS.variant, requestedQuantity: 1,
      warehouseId: IDS.site, locationId: IDS.location,
    }],
  }
  for (const [hint, sqlState, transportStatus, safeStatus] of [
    ['WAREHOUSE_WORKFLOW_INPUT_INVALID', '22023', 400, 400],
    ['WAREHOUSE_RESOURCE_INACTIVE', '55000', 500, 409],
    ['WAREHOUSE_DESTINATION_UNAVAILABLE', '55000', 500, 409],
  ]) {
    const service = createWarehouseService(rpcClient({
      submit_warehouse_receipt_secure: {
        data: null,
        error: { code: sqlState, hint, message: 'private SQL supplier detail' },
        status: transportStatus,
      },
    }).client, { configured: true })
    await assert.rejects(
      service.submitReceipt(input),
      (error) => error instanceof WarehouseServiceError &&
        error.code === hint && error.status === safeStatus &&
        !/private|supplier|sql/iu.test(error.message),
    )
  }

  for (const [hint, code, status] of [
    ['WAREHOUSE_RESOURCE_INACTIVE', '55000', 409],
    ['WAREHOUSE_WORKFLOW_INPUT_INVALID', '22023', 500],
    ['WAREHOUSE_DESTINATION_UNAVAILABLE', '42501', 500],
  ]) {
    const service = createWarehouseService(rpcClient({
      submit_warehouse_receipt_secure: {
        data: null, error: { code, hint, message: 'private detail' }, status,
      },
    }).client, { configured: true })
    await assert.rejects(
      service.submitReceipt(input),
      safeError(code === '42501' ? 'ACCESS_DENIED' : 'WAREHOUSE_SERVICE_UNAVAILABLE', code === '42501' ? 403 : 503),
    )
  }
})

test('QR lookup calls only the bound secure RPC and returns an exact immutable cost-free result', async () => {
  const { client, calls } = rpcClient({
    resolve_warehouse_qr_secure: { data: QR_RESOLUTION, error: null, status: 200 },
  })
  const service = createWarehouseService(client, { configured: true, viewCost: true })

  const result = await service.resolveQr(' \ufeffMaker-CU-6MM　 ')

  assert.deepEqual(calls, [{
    name: 'resolve_warehouse_qr_secure',
    args: { p_code: 'Maker-CU-6MM' },
  }])
  assert.deepEqual(result, QR_RESOLUTION)
  assert.notEqual(result, QR_RESOLUTION)
  assert.equal(Object.isFrozen(result), true)
  assert.equal('defaultPurchasePrice' in result, false)
})

test('QR lookup treats unknown codes as null and rejects invalid, ambiguous, extra or cost-bearing data fail closed', async () => {
  const { client, calls } = rpcClient({
    resolve_warehouse_qr_secure: ({ args }) => {
      if (args.p_code === 'UNKNOWN') return { data: null, error: null, status: 200 }
      if (args.p_code === 'AMBIGUOUS') return {
        data: null,
        error: { code: '23505', message: 'private duplicate detail', hint: 'WAREHOUSE_QR_AMBIGUOUS' },
        status: 409,
      }
      if (args.p_code === 'COST') return {
        data: { ...QR_RESOLUTION, defaultPurchasePrice: 999 },
        error: null,
        status: 200,
      }
      return { data: { ...QR_RESOLUTION, active: true }, error: null, status: 200 }
    },
  })
  const service = createWarehouseService(client, { configured: true })

  assert.equal(await service.resolveQr('UNKNOWN'), null)
  await assert.rejects(
    () => service.resolveQr('AMBIGUOUS'),
    safeError('WAREHOUSE_QR_AMBIGUOUS', 409),
  )
  await assert.rejects(() => service.resolveQr('COST'), safeError('WAREHOUSE_INVALID_RESPONSE', 502))
  await assert.rejects(() => service.resolveQr('EXTRA'), safeError('WAREHOUSE_INVALID_RESPONSE', 502))
  const beforeInvalid = calls.length
  for (const input of ['', ' \t\n ', `Q${'X'.repeat(500)}`, null, { toString() { throw new Error('unsafe') } }]) {
    await assert.rejects(
      () => service.resolveQr(input),
      safeError('WAREHOUSE_QR_INPUT_INVALID', 400),
    )
  }
  assert.equal(calls.length, beforeInvalid)
})

test('QR input database hint requires the exact 22023 and HTTP 400 trust tuple', async () => {
  const cases = [
    [{ code: '22023', hint: 'WAREHOUSE_QR_INPUT_INVALID' }, 400, 'WAREHOUSE_QR_INPUT_INVALID', 400],
    [{ code: '22023', hint: 'WAREHOUSE_QR_INPUT_INVALID' }, 409, 'WAREHOUSE_SERVICE_UNAVAILABLE', 503],
    [{ code: '23505', hint: 'WAREHOUSE_QR_INPUT_INVALID' }, 400, 'WAREHOUSE_SERVICE_UNAVAILABLE', 503],
    [{ code: '22023', hint: 'WAREHOUSE_QR_AMBIGUOUS' }, 400, 'WAREHOUSE_SERVICE_UNAVAILABLE', 503],
  ]
  for (const [error, status, safeCode, safeStatus] of cases) {
    const { client } = rpcClient({
      resolve_warehouse_qr_secure: {
        data: null,
        error: { ...error, message: 'private supplier QR details' },
        status,
      },
    })
    await assert.rejects(
      () => createWarehouseService(client, { configured: true }).resolveQr('VALID-INPUT'),
      safeError(safeCode, safeStatus),
    )
  }
})

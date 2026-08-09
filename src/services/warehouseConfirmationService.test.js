import assert from 'node:assert/strict'
import test from 'node:test'

const IDS = Object.freeze({
  receipt: 'a1000000-0000-4000-8000-000000000001',
  receiptLine: 'a1100000-0000-4000-8000-000000000001',
  request: 'a2000000-0000-4000-8000-000000000001',
  stockOutLine: 'a2100000-0000-4000-8000-000000000001',
  variant: 'a3000000-0000-4000-8000-000000000001',
  warehouse: 'a4000000-0000-4000-8000-000000000001',
  location: 'a4100000-0000-4000-8000-000000000001',
  submitter: 'a5000000-0000-4000-8000-000000000001',
  confirmer: 'a5000000-0000-4000-8000-000000000002',
})

const receiptResult = Object.freeze({
  id: IDS.receipt,
  purchaseRecordKey: 'PO-CONFIRM-1',
  status: 'confirmed',
  submittedByEmployeeProfileId: IDS.submitter,
  submittedAt: '2026-08-09T00:00:00+00:00',
  confirmedByEmployeeProfileId: IDS.confirmer,
  confirmedAt: '2026-08-09T01:00:00+00:00',
  rejectionReason: null,
  idempotencyKey: 'receipt-submit-1',
  confirmationIdempotencyKey: 'receipt-confirm-1',
  lines: [{
    id: IDS.receiptLine,
    receiptId: IDS.receipt,
    variantId: IDS.variant,
    requestedQuantity: 2,
    confirmedQuantity: 1.5,
    warehouseId: IDS.warehouse,
    locationId: IDS.location,
    unitCost: 100,
  }],
})

const stockOutResult = Object.freeze({
  id: IDS.request,
  destinationType: 'internal_use',
  projectId: null,
  minorWorkOrderId: null,
  destinationNameSnapshot: '公司内部使用',
  purpose: '维修',
  receiver: '王师傅',
  requestDate: '2026-08-09',
  status: 'confirmed',
  submittedByEmployeeProfileId: IDS.submitter,
  submittedAt: '2026-08-09T00:00:00+00:00',
  confirmedByEmployeeProfileId: IDS.confirmer,
  confirmedAt: '2026-08-09T02:00:00+00:00',
  rejectionReason: null,
  idempotencyKey: 'stock-submit-1',
  confirmationIdempotencyKey: 'stock-confirm-1',
  lines: [{
    id: IDS.stockOutLine,
    requestId: IDS.request,
    variantId: IDS.variant,
    requestedQuantity: 3,
    confirmedQuantity: 2.5,
    warehouseId: IDS.warehouse,
    locationId: IDS.location,
    frozenTotalCost: 280,
  }],
})

function rpcClient(responses) {
  const calls = []
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args })
        const response = responses[name]
        return typeof response === 'function' ? response({ name, args }) : response
      },
    },
  }
}

async function loadService() {
  return import('./warehouseConfirmationService.js')
}

test('confirmation methods call only secure RPCs with canonical server-authoritative requests', async () => {
  const { createWarehouseConfirmationService } = await loadService()
  const { client, calls } = rpcClient({
    confirm_warehouse_receipt_secure: {
      data: receiptResult, error: null, status: 200, statusText: 'OK', count: null,
    },
    confirm_warehouse_stock_out_secure: {
      data: stockOutResult, error: null, status: 200,
    },
  })
  const service = createWarehouseConfirmationService(client, { configured: true, viewCost: true })

  const receipt = await service.confirmReceipt({
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-1',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: 1.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  })
  const stockOut = await service.confirmStockOut({
    requestId: IDS.request,
    idempotencyKey: 'stock-confirm-1',
    lines: [{
      stockOutLineId: IDS.stockOutLine,
      confirmedQuantity: 2.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  })

  assert.deepEqual(calls, [
    {
      name: 'confirm_warehouse_receipt_secure',
      args: {
        p_receipt_id: IDS.receipt,
        p_lines: [{
          receiptLineId: IDS.receiptLine,
          confirmedQuantity: 1.5,
          warehouseId: IDS.warehouse,
          locationId: IDS.location,
        }],
        p_idempotency_key: 'receipt-confirm-1',
      },
    },
    {
      name: 'confirm_warehouse_stock_out_secure',
      args: {
        p_request_id: IDS.request,
        p_lines: [{
          stockOutLineId: IDS.stockOutLine,
          confirmedQuantity: 2.5,
          warehouseId: IDS.warehouse,
          locationId: IDS.location,
        }],
        p_idempotency_key: 'stock-confirm-1',
      },
    },
  ])
  assert.deepEqual(receipt, receiptResult)
  assert.deepEqual(stockOut, stockOutResult)
  assert.equal(Object.isFrozen(receipt), true)
  assert.equal(Object.isFrozen(receipt.lines), true)
  assert.equal(Object.isFrozen(receipt.lines[0]), true)
  assert.equal(Object.isFrozen(stockOut), true)
  assert.equal(Object.isFrozen(stockOut.lines[0]), true)
})

test('confirmation input is exact and never accepts actor, time, price, sparse lines or excess precision', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const { client, calls } = rpcClient({})
  const service = createWarehouseConfirmationService(client, { configured: true, viewCost: true })
  const base = {
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-input',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: 1,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  }
  const sparse = Array(1)

  for (const input of [
    { ...base, actorId: IDS.confirmer },
    { ...base, confirmedAt: '2026-08-09T00:00:00Z' },
    { ...base, unitCost: 1 },
    { ...base, lines: sparse },
    { ...base, lines: [{ ...base.lines[0], unitCost: 1 }] },
    { ...base, lines: [{ ...base.lines[0], confirmedQuantity: 1.0001 }] },
  ]) {
    await assert.rejects(
      service.confirmReceipt(input),
      (error) => error instanceof WarehouseConfirmationServiceError &&
        error.code === 'WAREHOUSE_CONFIRMATION_INPUT_INVALID' && error.status === 400,
    )
  }
  assert.deepEqual(calls, [])
})

test('confirmation response validation rejects forged shapes, wrong line binding and invalid costs', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const input = {
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-1',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: 1.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  }
  const malformed = [
    { ...receiptResult, actorName: 'leak' },
    { ...receiptResult, status: 'pending' },
    { ...receiptResult, confirmedByEmployeeProfileId: null },
    { ...receiptResult, lines: [{ ...receiptResult.lines[0], id: IDS.request }] },
    { ...receiptResult, lines: [{ ...receiptResult.lines[0], confirmedQuantity: 1 }] },
    { ...receiptResult, lines: [{ ...receiptResult.lines[0], warehouseId: IDS.location }] },
    { ...receiptResult, lines: [{ ...receiptResult.lines[0], unitCost: -1 }] },
    { ...receiptResult, lines: [{ ...receiptResult.lines[0], unitCost: 1.00001 }] },
  ]
  for (const data of malformed) {
    const { client } = rpcClient({
      confirm_warehouse_receipt_secure: { data, error: null, status: 200 },
    })
    await assert.rejects(
      createWarehouseConfirmationService(client, { configured: true, viewCost: true }).confirmReceipt(input),
      (error) => error instanceof WarehouseConfirmationServiceError &&
        error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID' && error.status === 502,
    )
  }
})

test('confirmation contract accepts safe decimal maxima and rejects the next representable quantity or cost value', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const maximumQuantity = Number.MAX_SAFE_INTEGER / 1_000
  const maximumCost = Number.MAX_SAFE_INTEGER / 10_000
  const receiptInput = {
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-limit',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: maximumQuantity,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  }
  const boundaryReceipt = {
    ...receiptResult,
    confirmationIdempotencyKey: 'receipt-confirm-limit',
    lines: [{
      ...receiptResult.lines[0],
      requestedQuantity: maximumQuantity,
      confirmedQuantity: maximumQuantity,
      unitCost: maximumCost,
    }],
  }
  const { client } = rpcClient({
    confirm_warehouse_receipt_secure: { data: boundaryReceipt, error: null, status: 200 },
  })
  const result = await createWarehouseConfirmationService(
    client,
    { configured: true, viewCost: true },
  ).confirmReceipt(receiptInput)
  assert.equal(result.lines[0].confirmedQuantity, maximumQuantity)
  assert.equal(result.lines[0].unitCost, maximumCost)

  const { client: inputClient, calls } = rpcClient({})
  await assert.rejects(
    createWarehouseConfirmationService(inputClient, { configured: true }).confirmReceipt({
      ...receiptInput,
      lines: [{ ...receiptInput.lines[0], confirmedQuantity: 9007199254740.992 }],
    }),
    (error) => error instanceof WarehouseConfirmationServiceError &&
      error.code === 'WAREHOUSE_CONFIRMATION_INPUT_INVALID' && error.status === 400,
  )
  assert.deepEqual(calls, [])

  for (const data of [
    {
      ...boundaryReceipt,
      lines: [{ ...boundaryReceipt.lines[0], requestedQuantity: 9007199254740.992 }],
    },
    {
      ...boundaryReceipt,
      lines: [{ ...boundaryReceipt.lines[0], unitCost: 900719925474.0992 }],
    },
  ]) {
    const { client: invalidClient } = rpcClient({
      confirm_warehouse_receipt_secure: { data, error: null, status: 200 },
    })
    await assert.rejects(
      createWarehouseConfirmationService(
        invalidClient,
        { configured: true, viewCost: true },
      ).confirmReceipt(receiptInput),
      (error) => error instanceof WarehouseConfirmationServiceError &&
        error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID' && error.status === 502,
    )
  }

  const { client: stockOutClient } = rpcClient({
    confirm_warehouse_stock_out_secure: {
      data: {
        ...stockOutResult,
        lines: [{ ...stockOutResult.lines[0], frozenTotalCost: 900719925474.0992 }],
      },
      error: null,
      status: 200,
    },
  })
  await assert.rejects(
    createWarehouseConfirmationService(
      stockOutClient,
      { configured: true, viewCost: true },
    ).confirmStockOut({
      requestId: IDS.request,
      idempotencyKey: 'stock-confirm-1',
      lines: [{
        stockOutLineId: IDS.stockOutLine,
        confirmedQuantity: 2.5,
        warehouseId: IDS.warehouse,
        locationId: IDS.location,
      }],
    }),
    (error) => error instanceof WarehouseConfirmationServiceError &&
      error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID' && error.status === 502,
  )
})

test('confirmation transport rejects valid-looking data carried by a non-success HTTP status', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const input = {
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-1',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: 1.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  }

  for (const status of [302, 500]) {
    const { client } = rpcClient({
      confirm_warehouse_receipt_secure: { data: receiptResult, error: null, status },
    })
    await assert.rejects(
      createWarehouseConfirmationService(client, { configured: true, viewCost: true })
        .confirmReceipt(input),
      (error) => error instanceof WarehouseConfirmationServiceError &&
        error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID' && error.status === 502,
    )
  }
})

test('confirmation transport maps only trusted warehouse failures and hides supplier details', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const input = {
    requestId: IDS.request,
    idempotencyKey: 'stock-confirm-1',
    lines: [{
      stockOutLineId: IDS.stockOutLine,
      confirmedQuantity: 1,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  }
  const cases = [
    [{ code: '42501', message: 'private role detail' }, 403, 'ACCESS_DENIED', 403],
    [{ code: '23514', hint: 'WAREHOUSE_INSUFFICIENT_STOCK', message: 'private stock detail' }, 409, 'WAREHOUSE_INSUFFICIENT_STOCK', 409],
    [{ code: '23505', hint: 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT', message: 'private payload' }, 409, 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT', 409],
    [{ code: 'XX000', hint: 'WAREHOUSE_INSUFFICIENT_STOCK', message: 'database secret' }, 500, 'WAREHOUSE_CONFIRMATION_FAILED', 503],
  ]
  for (const [supplierError, status, expectedCode, expectedStatus] of cases) {
    const { client } = rpcClient({
      confirm_warehouse_stock_out_secure: { data: null, error: supplierError, status },
    })
    await assert.rejects(
      createWarehouseConfirmationService(client, { configured: true, viewCost: true }).confirmStockOut(input),
      (error) => error instanceof WarehouseConfirmationServiceError &&
        error.code === expectedCode && error.status === expectedStatus &&
        !error.message.includes('private') && !error.message.includes('secret'),
    )
  }
})

test('confirmation transport never coerces untrusted supplier error fields', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  let coercions = 0
  const hostileCode = {
    [Symbol.toPrimitive]() {
      coercions += 1
      return '42501'
    },
  }
  const { client } = rpcClient({
    confirm_warehouse_stock_out_secure: {
      data: null,
      error: { code: hostileCode, hint: 'WAREHOUSE_INSUFFICIENT_STOCK' },
      status: 403,
    },
  })

  await assert.rejects(
    createWarehouseConfirmationService(client, { configured: true }).confirmStockOut({
      requestId: IDS.request,
      idempotencyKey: 'stock-confirm-hostile-error',
      lines: [{
        stockOutLineId: IDS.stockOutLine,
        confirmedQuantity: 1,
        warehouseId: IDS.warehouse,
        locationId: IDS.location,
      }],
    }),
    (error) => error instanceof WarehouseConfirmationServiceError &&
      error.code === 'ACCESS_DENIED' && error.status === 403,
  )
  assert.equal(coercions, 0)
})

test('confirmation performs no optimistic browser storage write before or after the authoritative RPC', async () => {
  const { createWarehouseConfirmationService } = await loadService()
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let reads = 0
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      reads += 1
      throw new Error('localStorage must not be used')
    },
  })
  try {
    const { client } = rpcClient({
      confirm_warehouse_stock_out_secure: { data: stockOutResult, error: null, status: 200 },
    })
    await createWarehouseConfirmationService(client, { configured: true, viewCost: true }).confirmStockOut({
      requestId: IDS.request,
      idempotencyKey: 'stock-confirm-1',
      lines: [{
        stockOutLineId: IDS.stockOutLine,
        confirmedQuantity: 2.5,
        warehouseId: IDS.warehouse,
        locationId: IDS.location,
      }],
    })
    assert.equal(reads, 0)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})

test('confirmation responses redact costs unless the caller has effective cost-view enabled', async () => {
  const { createWarehouseConfirmationService } = await loadService()
  const redactedReceipt = {
    ...receiptResult,
    lines: [{ ...receiptResult.lines[0], unitCost: null }],
  }
  const redactedStockOut = {
    ...stockOutResult,
    lines: [{ ...stockOutResult.lines[0], frozenTotalCost: null }],
  }
  const { client } = rpcClient({
    confirm_warehouse_receipt_secure: { data: redactedReceipt, error: null, status: 200 },
    confirm_warehouse_stock_out_secure: { data: redactedStockOut, error: null, status: 200 },
  })
  const service = createWarehouseConfirmationService(client, { configured: true, viewCost: false })
  const receipt = await service.confirmReceipt({
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-1',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: 1.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  })
  const stockOut = await service.confirmStockOut({
    requestId: IDS.request,
    idempotencyKey: 'stock-confirm-1',
    lines: [{
      stockOutLineId: IDS.stockOutLine,
      confirmedQuantity: 2.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  })
  assert.equal(receipt.lines[0].unitCost, null)
  assert.equal(stockOut.lines[0].frozenTotalCost, null)
})

test('exact retries accept authoritative void-after-confirmation documents with immutable binding', async () => {
  const { createWarehouseConfirmationService } = await loadService()
  const voidReceipt = {
    ...receiptResult,
    status: 'void',
    rejectionReason: '已按冲销流程作废',
  }
  const voidStockOut = {
    ...stockOutResult,
    status: 'void',
    rejectionReason: '已按冲销流程作废',
  }
  const { client } = rpcClient({
    confirm_warehouse_receipt_secure: { data: voidReceipt, error: null, status: 200 },
    confirm_warehouse_stock_out_secure: { data: voidStockOut, error: null, status: 200 },
  })
  const service = createWarehouseConfirmationService(client, { configured: true, viewCost: true })
  const receipt = await service.confirmReceipt({
    receiptId: IDS.receipt,
    idempotencyKey: 'receipt-confirm-1',
    lines: [{
      receiptLineId: IDS.receiptLine,
      confirmedQuantity: 1.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  })
  const stockOut = await service.confirmStockOut({
    requestId: IDS.request,
    idempotencyKey: 'stock-confirm-1',
    lines: [{
      stockOutLineId: IDS.stockOutLine,
      confirmedQuantity: 2.5,
      warehouseId: IDS.warehouse,
      locationId: IDS.location,
    }],
  })
  assert.equal(receipt.status, 'void')
  assert.equal(stockOut.status, 'void')
})

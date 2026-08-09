import assert from 'node:assert/strict'
import test from 'node:test'

const IDS = Object.freeze({
  receipt: 'a1000000-0000-4000-8000-000000000001',
  receiptLine: 'a1100000-0000-4000-8000-000000000001',
  request: 'a2000000-0000-4000-8000-000000000001',
  stockOutLine: 'a2100000-0000-4000-8000-000000000001',
  returnRequest: 'a2200000-0000-4000-8000-000000000001',
  returnLine: 'a2300000-0000-4000-8000-000000000001',
  variant: 'a3000000-0000-4000-8000-000000000001',
  warehouse: 'a4000000-0000-4000-8000-000000000001',
  location: 'a4100000-0000-4000-8000-000000000001',
  submitter: 'a5000000-0000-4000-8000-000000000001',
  confirmer: 'a5000000-0000-4000-8000-000000000002',
})

const returnResult = Object.freeze({
  id: IDS.returnRequest,
  originalStockOutId: IDS.request,
  destinationType: 'internal_use',
  projectId: null,
  minorWorkOrderId: null,
  destinationNameSnapshot: '公司内部使用',
  reason: '未使用',
  receiver: '仓库负责人',
  requestDate: '2026-08-09',
  status: 'confirmed',
  submittedByEmployeeProfileId: IDS.submitter,
  submittedAt: '2026-08-09T00:30:00+00:00',
  confirmedByEmployeeProfileId: IDS.confirmer,
  confirmedAt: '2026-08-09T03:00:00+00:00',
  rejectionReason: null,
  idempotencyKey: 'return-submit-1',
  confirmationIdempotencyKey: 'return-confirm-1',
  lines: [{
    id: IDS.returnLine,
    returnId: IDS.returnRequest,
    originalStockOutLineId: IDS.stockOutLine,
    variantId: IDS.variant,
    requestedQuantity: 1,
    confirmedQuantity: 1,
    frozenTotalCost: 100,
  }],
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
    confirm_warehouse_return_secure: {
      data: returnResult, error: null, status: 200,
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
  const returned = await service.confirmReturn({
    returnId: IDS.returnRequest,
    idempotencyKey: 'return-confirm-1',
    lines: [{ returnLineId: IDS.returnLine, confirmedQuantity: 1 }],
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
    {
      name: 'confirm_warehouse_return_secure',
      args: {
        p_return_id: IDS.returnRequest,
        p_lines: [{ returnLineId: IDS.returnLine, confirmedQuantity: 1 }],
        p_idempotency_key: 'return-confirm-1',
      },
    },
  ])
  assert.deepEqual(receipt, receiptResult)
  assert.deepEqual(stockOut, stockOutResult)
  assert.deepEqual(returned, returnResult)
  assert.equal(Object.isFrozen(receipt), true)
  assert.equal(Object.isFrozen(receipt.lines), true)
  assert.equal(Object.isFrozen(receipt.lines[0]), true)
  assert.equal(Object.isFrozen(stockOut), true)
  assert.equal(Object.isFrozen(stockOut.lines[0]), true)
  assert.equal(Object.isFrozen(returned.lines[0]), true)
})

test('warehouse confirmer can reject pending stock-out and return documents with exact audit binding', async () => {
  const { createWarehouseConfirmationService } = await loadService()
  const stockRejected = {
    id: IDS.request, destinationType: 'internal_use', projectId: null,
    minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用',
    purpose: '维修', receiver: '王师傅', requestDate: '2026-08-09',
    status: 'rejected', submittedByEmployeeProfileId: IDS.submitter,
    submittedAt: '2026-08-09T00:00:00+00:00',
    confirmedByEmployeeProfileId: IDS.confirmer,
    confirmedAt: '2026-08-09T02:00:00+00:00', rejectionReason: '库存不足',
    idempotencyKey: 'stock-submit-1', confirmationIdempotencyKey: 'stock-reject-1',
    lines: [{
      id: IDS.stockOutLine, requestId: IDS.request, variantId: IDS.variant,
      requestedQuantity: 3, confirmedQuantity: null, frozenTotalCost: null,
    }],
  }
  const returnRejected = {
    id: IDS.returnRequest, originalStockOutId: IDS.request, reason: '未使用',
    receiver: '仓库负责人', requestDate: '2026-08-09', status: 'rejected',
    submittedByEmployeeProfileId: IDS.submitter,
    submittedAt: '2026-08-09T00:30:00+00:00',
    confirmedByEmployeeProfileId: IDS.confirmer,
    confirmedAt: '2026-08-09T03:00:00+00:00', rejectionReason: '重复退回',
    idempotencyKey: 'return-submit-1', confirmationIdempotencyKey: 'return-reject-1',
    lines: [{
      id: IDS.returnLine, returnId: IDS.returnRequest,
      originalStockOutLineId: IDS.stockOutLine,
      requestedQuantity: 1, confirmedQuantity: null, frozenTotalCost: null,
    }],
  }
  const { client, calls } = rpcClient({
    reject_warehouse_stock_out_secure: { data: stockRejected, error: null, status: 200 },
    reject_warehouse_return_secure: { data: returnRejected, error: null, status: 200 },
  })
  const service = createWarehouseConfirmationService(client, { configured: true })

  assert.deepEqual(await service.rejectStockOut({
    requestId: IDS.request, reason: '库存不足', idempotencyKey: 'stock-reject-1',
  }), stockRejected)
  assert.deepEqual(await service.rejectReturn({
    returnId: IDS.returnRequest, reason: '重复退回', idempotencyKey: 'return-reject-1',
  }), returnRejected)
  assert.deepEqual(calls, [
    {
      name: 'reject_warehouse_stock_out_secure',
      args: {
        p_request_id: IDS.request,
        p_reason: '库存不足',
        p_idempotency_key: 'stock-reject-1',
      },
    },
    {
      name: 'reject_warehouse_return_secure',
      args: {
        p_return_id: IDS.returnRequest,
        p_reason: '重复退回',
        p_idempotency_key: 'return-reject-1',
      },
    },
  ])
})

test('return confirmation never accepts client warehouse, batch, variant or cost authority', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const { client, calls } = rpcClient({})
  const service = createWarehouseConfirmationService(client, { configured: true, viewCost: true })
  const line = { returnLineId: IDS.returnLine, confirmedQuantity: 1 }
  for (const extra of [
    { warehouseId: IDS.warehouse }, { locationId: IDS.location },
    { variantId: IDS.variant }, { batchId: IDS.receipt }, { unitCost: 1 },
  ]) {
    await assert.rejects(
      service.confirmReturn({
        returnId: IDS.returnRequest,
        idempotencyKey: 'return-confirm-input',
        lines: [{ ...line, ...extra }],
      }),
      (error) => error instanceof WarehouseConfirmationServiceError
        && error.code === 'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
    )
  }
  assert.equal(calls.length, 0)
})

test('request context uses the secure read RPC and enforces cost redaction', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const context = { stockOutRequests: [], returnRequests: [], minorWorkOrders: [] }
  const { client, calls } = rpcClient({
    list_warehouse_request_context_secure: { data: context, error: null, status: 200 },
  })
  assert.deepEqual(
    await createWarehouseConfirmationService(client, { configured: true, viewCost: false })
      .listRequestContext(),
    context,
  )
  assert.deepEqual(calls, [{ name: 'list_warehouse_request_context_secure', args: {} }])
  const unsafe = { stockOutRequests: [{ frozenTotalCost: 1 }], returnRequests: [], minorWorkOrders: [] }
  const result = rpcClient({
    list_warehouse_request_context_secure: { data: unsafe, error: null, status: 200 },
  })
  await assert.rejects(
    createWarehouseConfirmationService(result.client, { configured: true, viewCost: false })
      .listRequestContext(),
    (error) => error instanceof WarehouseConfirmationServiceError
      && error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
  )
})

test('request context rejects every malformed nested row without coercion', async () => {
  const { createWarehouseConfirmationService, WarehouseConfirmationServiceError } = await loadService()
  const valid = () => ({
    stockOutRequests: [{
      id: IDS.request, destinationType: 'internal_use', projectId: null,
      minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
      receiver: '王师傅', requestDate: '2026-08-09', status: 'confirmed',
      submittedByEmployeeProfileId: IDS.submitter, submittedAt: '2026-08-09T00:00:00Z',
      confirmedByEmployeeProfileId: IDS.confirmer, confirmedAt: '2026-08-09T01:00:00Z',
      rejectionReason: null,
      lines: [{
        id: IDS.stockOutLine, requestId: IDS.request, variantId: IDS.variant,
        requestedQuantity: 2, confirmedQuantity: 1, remainingReturnable: 1,
        frozenTotalCost: null,
      }],
    }],
    returnRequests: [{
      id: IDS.returnRequest, originalStockOutId: IDS.request,
      destinationType: 'internal_use', projectId: null, minorWorkOrderId: null,
      destinationNameSnapshot: '公司内部使用', reason: '未使用', receiver: '王师傅',
      requestDate: '2026-08-09', status: 'pending',
      submittedByEmployeeProfileId: IDS.submitter, submittedAt: '2026-08-09T02:00:00Z',
      confirmedByEmployeeProfileId: null, confirmedAt: null, rejectionReason: null,
      lines: [{
        id: IDS.returnLine, returnId: IDS.returnRequest,
        originalStockOutLineId: IDS.stockOutLine, variantId: IDS.variant,
        requestedQuantity: 1, confirmedQuantity: null, frozenTotalCost: null,
      }],
    }],
    minorWorkOrders: [{
      id: 'a6000000-0000-4000-8000-000000000001', title: '小工事',
      customerName: '未来社', workDate: '2026-08-09', locationText: '东京',
      description: '', status: 'open', assignedProjectId: null, materialCost: null,
      createdByEmployeeProfileId: IDS.submitter, createdAt: '2026-08-09T00:00:00Z',
      updatedAt: '2026-08-09T00:00:00Z',
    }],
  })
  let coercions = 0
  const coercionValue = {}
  Object.defineProperty(coercionValue, Symbol.toPrimitive, {
    get() { coercions += 1; return () => '1' },
  })
  const mutations = [
    (data) => { data.stockOutRequests[0].extra = true },
    (data) => { data.stockOutRequests[0].lines[Symbol('hidden')] = true },
    (data) => { delete data.stockOutRequests[0].status },
    (data) => Object.defineProperty(data.stockOutRequests[0], 'purpose', { enumerable: true, get() { throw new Error('must not run') } }),
    (data) => { data.stockOutRequests[0][Symbol('hostile')] = true },
    (data) => Object.defineProperty(data.stockOutRequests[0], '__proto__', { enumerable: true, value: { polluted: true } }),
    (data) => { data.stockOutRequests[0].constructor = 'hostile' },
    (data) => { data.stockOutRequests[0].id = 'not-a-uuid' },
    (data) => { data.stockOutRequests[0].status = 'approved' },
    (data) => { data.stockOutRequests[0].lines[0].requestedQuantity = -1 },
    (data) => { data.stockOutRequests[0].lines[0].requestedQuantity = 0.0001 },
    (data) => { data.stockOutRequests[0].lines[0].remainingReturnable = 2 },
    (data) => { data.stockOutRequests[0].lines[0].requestId = IDS.returnRequest },
    (data) => { data.returnRequests[0].lines[0].returnId = IDS.request },
    (data) => { data.stockOutRequests[0].lines[0].frozenTotalCost = 1 },
    (data) => { data.stockOutRequests[0].destinationType = 'project' },
    (data) => { data.stockOutRequests[0].destinationType = 'minor_work_order' },
    (data) => { data.stockOutRequests[0].projectId = 'P-1' },
    (data) => {
      Object.assign(data.stockOutRequests[0], {
        status: 'pending', confirmedByEmployeeProfileId: null, confirmedAt: null,
      })
    },
    (data) => {
      Object.assign(data.stockOutRequests[0], {
        status: 'rejected', confirmedByEmployeeProfileId: IDS.confirmer,
        confirmedAt: '2026-08-09T01:00:00Z',
        rejectionReason: '库存不足',
      })
    },
    (data) => {
      data.stockOutRequests[0].lines[0].confirmedQuantity = null
      data.stockOutRequests[0].lines[0].remainingReturnable = 0
    },
    (data) => {
      data.stockOutRequests[0].status = 'void'
      data.stockOutRequests[0].lines[0].confirmedQuantity = null
    },
    (data) => { data.minorWorkOrders[0].status = 'mystery' },
    (data) => { data.minorWorkOrders[0].assignedProjectId = 'P-1' },
    (data) => { data.minorWorkOrders[0].status = 'assigned' },
    (data) => { data.minorWorkOrders[0].createdAt = 'not-a-time' },
    (data) => { data.stockOutRequests[0].lines[0].requestedQuantity = coercionValue },
  ]
  for (const mutate of mutations) {
    const data = valid()
    mutate(data)
    const { client } = rpcClient({
      list_warehouse_request_context_secure: { data, error: null, status: 200 },
    })
    await assert.rejects(
      createWarehouseConfirmationService(client, { configured: true, viewCost: false })
        .listRequestContext(),
      (error) => error instanceof WarehouseConfirmationServiceError
        && error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    )
  }
  for (const mutate of [
    (data) => { data.returnRequests = []; data.stockOutRequests = []; data.minorWorkOrders[0].materialCost = -1 },
  ]) {
    const data = valid()
    data.stockOutRequests[0].lines[0].frozenTotalCost = 1
    mutate(data)
    const { client } = rpcClient({
      list_warehouse_request_context_secure: { data, error: null, status: 200 },
    })
    await assert.rejects(
      createWarehouseConfirmationService(client, { configured: true, viewCost: true })
        .listRequestContext(),
      (error) => error instanceof WarehouseConfirmationServiceError
        && error.code === 'WAREHOUSE_CONFIRMATION_RESPONSE_INVALID',
    )
  }
  const zeroCost = valid()
  zeroCost.stockOutRequests[0].lines[0].frozenTotalCost = 0
  const zeroCostRpc = rpcClient({
    list_warehouse_request_context_secure: { data: zeroCost, error: null, status: 200 },
  })
  assert.equal(
    (await createWarehouseConfirmationService(
      zeroCostRpc.client, { configured: true, viewCost: true },
    ).listRequestContext()).stockOutRequests[0].lines[0].frozenTotalCost,
    0,
  )
  const rejected = valid()
  Object.assign(rejected.stockOutRequests[0], {
    status: 'rejected', confirmedByEmployeeProfileId: IDS.confirmer,
    confirmedAt: '2026-08-09T01:00:00Z', rejectionReason: '库存不足',
  })
  rejected.stockOutRequests[0].lines[0].confirmedQuantity = null
  rejected.stockOutRequests[0].lines[0].remainingReturnable = 0
  const rejectedRpc = rpcClient({
    list_warehouse_request_context_secure: { data: rejected, error: null, status: 200 },
  })
  assert.equal(
    (await createWarehouseConfirmationService(
      rejectedRpc.client, { configured: true, viewCost: false },
    ).listRequestContext()).stockOutRequests[0].rejectionReason,
    '库存不足',
  )
  assert.equal(coercions, 0)
  assert.equal(Object.prototype.polluted, undefined)
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

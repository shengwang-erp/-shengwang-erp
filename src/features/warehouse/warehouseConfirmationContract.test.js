import assert from 'node:assert/strict'
import test from 'node:test'

const RECEIPT = 'b1000000-0000-4000-8000-000000000001'
const RECEIPT_LINE = 'b1100000-0000-4000-8000-000000000001'
const VARIANT = 'b2000000-0000-4000-8000-000000000001'
const SITE = 'b3000000-0000-4000-8000-000000000001'
const LOCATION = 'b3100000-0000-4000-8000-000000000001'
const EMPLOYEE = 'b4000000-0000-4000-8000-000000000001'

test('receipt confirmation contract derives audit and price fields from the only secure RPC boundary', async () => {
  const { createWarehouseConfirmationService } = await import(
    '../../services/warehouseConfirmationService.js'
  )
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push({ name, args })
      return {
        data: {
          id: RECEIPT, purchaseRecordKey: 'PO-CONTRACT', status: 'confirmed',
          submittedByEmployeeProfileId: EMPLOYEE, submittedAt: '2026-08-09T00:00:00Z',
          confirmedByEmployeeProfileId: EMPLOYEE, confirmedAt: '2026-08-09T01:00:00Z',
          rejectionReason: null, idempotencyKey: 'submit-contract',
          confirmationIdempotencyKey: 'confirm-contract',
          lines: [{
            id: RECEIPT_LINE, receiptId: RECEIPT, variantId: VARIANT,
            requestedQuantity: 1, confirmedQuantity: 1,
            warehouseId: SITE, locationId: LOCATION, unitCost: null,
          }],
        },
        error: null,
        status: 200,
      }
    },
  }
  const service = createWarehouseConfirmationService(client, {
    configured: true,
    viewCost: false,
  })
  const result = await service.confirmReceipt({
    receiptId: RECEIPT,
    idempotencyKey: 'confirm-contract',
    lines: [{
      receiptLineId: RECEIPT_LINE,
      confirmedQuantity: 1,
      warehouseId: SITE,
      locationId: LOCATION,
    }],
  })

  assert.deepEqual(calls, [{
    name: 'confirm_warehouse_receipt_secure',
    args: {
      p_receipt_id: RECEIPT,
      p_lines: [{
        receiptLineId: RECEIPT_LINE,
        confirmedQuantity: 1,
        warehouseId: SITE,
        locationId: LOCATION,
      }],
      p_idempotency_key: 'confirm-contract',
    },
  }])
  assert.equal(result.confirmedByEmployeeProfileId, EMPLOYEE)
  assert.equal(result.confirmedAt, '2026-08-09T01:00:00Z')
  assert.equal(result.lines[0].unitCost, null)
  assert.deepEqual(Object.keys(calls[0].args).sort(), [
    'p_idempotency_key', 'p_lines', 'p_receipt_id',
  ])
})

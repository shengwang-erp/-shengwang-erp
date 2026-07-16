import assert from 'node:assert/strict'
import test from 'node:test'
import { getDashboardSourceData } from './dashboardService.js'

test('dashboard accepts injected safe projections without persistence reads', async () => {
  const data = await getDashboardSourceData({
    employees: [{ employeeId: 'E1' }], projects: [{ projectId: 'P1' }],
    laborRecords: [], purchaseRecords: [],
    purchasePaymentRecords: [{ paymentId: 'PP-1', purchaseId: 'PO-1' }],
    inventoryItems: [],
    vehicleUsageRecords: [], lifelongToolAssignments: [], toolResponsibilityRecords: [],
    load: async () => { throw new Error('unexpected persistence read') },
  })
  assert.deepEqual(data.projects, [{ projectId: 'P1' }])
  assert.deepEqual(data.employees, [{ employeeId: 'E1' }])
  assert.deepEqual(data.purchasePaymentRecords, [
    { paymentId: 'PP-1', purchaseId: 'PO-1' },
  ])
})

test('dashboard loads purchase payment facts from the default safe storage key', async () => {
  const requestedKeys = []
  const data = await getDashboardSourceData({
    load: async (key) => {
      requestedKeys.push(key)
      return key === 'erp.purchasePaymentRecords'
        ? [{ paymentId: 'PP-PERSISTED', purchaseId: 'PO-1' }]
        : []
    },
  })

  assert.equal(
    requestedKeys.filter((key) => key === 'erp.purchasePaymentRecords').length,
    1,
  )
  assert.deepEqual(data.purchasePaymentRecords, [
    { paymentId: 'PP-PERSISTED', purchaseId: 'PO-1' },
  ])
})

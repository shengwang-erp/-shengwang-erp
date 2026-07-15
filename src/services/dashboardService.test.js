import assert from 'node:assert/strict'
import test from 'node:test'
import { getDashboardSourceData } from './dashboardService.js'

test('dashboard accepts injected safe projections without persistence reads', async () => {
  const data = await getDashboardSourceData({
    employees: [{ employeeId: 'E1' }], projects: [{ projectId: 'P1' }],
    laborRecords: [], purchaseRecords: [], inventoryItems: [],
    vehicleUsageRecords: [], lifelongToolAssignments: [], toolResponsibilityRecords: [],
    load: async () => { throw new Error('unexpected persistence read') },
  })
  assert.deepEqual(data.projects, [{ projectId: 'P1' }])
  assert.deepEqual(data.employees, [{ employeeId: 'E1' }])
})

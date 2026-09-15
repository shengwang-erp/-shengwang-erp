import assert from 'node:assert/strict'
import test from 'node:test'

import { buildProjectRevenueSnapshot } from './contractRevenueCalculations.js'

test('project revenue snapshot summarizes configurable plans by planId without three-stage assumptions', () => {
  const project = {
    projectId: 'P4',
    contractRevenueSchemaVersion: 1,
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 100000,
    originalContractTaxInclusiveAmount: 1100000,
  }
  const plans = [1, 2, 3, 4].map((order) => ({
    planId: `p${order}`,
    projectId: 'P4',
    installmentOrder: order,
    name: `第${order}期`,
    allocationWeight: 25,
    plannedTaxInclusiveAmount: 275000,
    statusCode: 'active',
  }))
  const snapshot = buildProjectRevenueSnapshot(project, [], plans, [{
    receiptId: 'r1', projectId: 'P4', planId: 'p2', stage: 'installment', taxInclusiveAmount: 100000, statusCode: 'active',
  }])

  assert.equal(snapshot.allocationStatus, 'configured')
  assert.deepEqual(snapshot.lockedPlanIds, ['p2'])
  assert.deepEqual(snapshot.unlockedPlanIds, ['p1', 'p3', 'p4'])
  assert.equal(snapshot.lockedPlannedTaxInclusiveAmount, 275000)
  assert.equal(snapshot.unallocatedTaxInclusiveAmount, 0)
})

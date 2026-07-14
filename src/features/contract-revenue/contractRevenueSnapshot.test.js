import assert from 'node:assert/strict'
import test from 'node:test'

import * as revenueCalculations from './contractRevenueCalculations.js'
import { ContractRevenueValidationError } from './contractRevenueValidation.js'

function migratedProject(overrides = {}) {
  return {
    projectId: 'P001',
    contractRevenueSchemaVersion: 1,
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 10,
    originalContractTaxAmount: 100000,
    originalContractTaxInclusiveAmount: 1100000,
    ...overrides,
  }
}

function contractChange(overrides = {}) {
  return {
    changeId: 'change-1',
    projectId: 'P001',
    changeType: 'increase',
    taxExclusiveAmount: 200000,
    taxRate: 10,
    taxAmount: 20000,
    taxInclusiveAmount: 220000,
    statusCode: 'active',
    ...overrides,
  }
}

function paymentPlan(stage, plannedTaxInclusiveAmount, allocationWeight, overrides = {}) {
  return {
    planId: `plan-${stage}`,
    projectId: 'P001',
    stage,
    plannedTaxInclusiveAmount,
    allocationWeight,
    statusCode: 'active',
    ...overrides,
  }
}

function receipt(stage, taxInclusiveAmount, overrides = {}) {
  return {
    receiptId: `receipt-${stage}`,
    projectId: 'P001',
    stage,
    taxInclusiveAmount,
    statusCode: 'active',
    ...overrides,
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function assertValidationError(field) {
  return (error) => {
    assert.ok(error instanceof ContractRevenueValidationError)
    assert.equal(error.field, field)
    return true
  }
}

test('buildProjectRevenueSnapshot is exported as a pure calculation entry point', () => {
  assert.equal(typeof revenueCalculations.buildProjectRevenueSnapshot, 'function')
})

test('migrated projects calculate a complete snapshot from matching active revenue records', () => {
  const project = migratedProject()
  const changes = [
    contractChange(),
    contractChange({
      changeId: 'change-void',
      statusCode: 'void',
      taxExclusiveAmount: '',
      taxAmount: '',
      taxInclusiveAmount: '',
    }),
    contractChange({
      changeId: 'change-other-project',
      projectId: 'P999',
      taxExclusiveAmount: 900000,
      taxAmount: 90000,
      taxInclusiveAmount: 990000,
    }),
  ]
  const plans = [
    paymentPlan('initial', 330000, 30),
    paymentPlan('middle', 440000, 40),
    paymentPlan('final', 330000, 30),
    paymentPlan('middle', '', '', {
      planId: 'plan-void',
      statusCode: 'void',
    }),
    paymentPlan('initial', 990000, 100, {
      planId: 'plan-other-project',
      projectId: 'P999',
    }),
  ]
  const receipts = [
    receipt('initial', 100000),
    receipt('middle', '', { receiptId: 'receipt-void', statusCode: 'void' }),
    receipt('final', 900000, {
      receiptId: 'receipt-other-project',
      projectId: 'P999',
    }),
  ]
  const originals = {
    project: clone(project),
    changes: clone(changes),
    plans: clone(plans),
    receipts: clone(receipts),
  }

  const snapshot = revenueCalculations.buildProjectRevenueSnapshot(
    project,
    changes,
    plans,
    receipts,
  )

  assert.deepEqual(snapshot, {
    adjustedTaxExclusiveAmount: 1200000,
    adjustedTaxAmount: 120000,
    adjustedTaxInclusiveAmount: 1320000,
    totalReceivedTaxInclusiveAmount: 100000,
    outstandingTaxInclusiveAmount: 1220000,
    overpaidTaxInclusiveAmount: 0,
    paymentProgress: 8,
    paymentStatus: '部分收款',
    allocationStatus: 'auto_allocated',
    allocationReason: null,
    lockedStages: ['initial'],
    unlockedStages: ['middle', 'final'],
    lockedPlannedTaxInclusiveAmount: 330000,
    remainingAssignableTaxInclusiveAmount: 990000,
    unallocatedTaxInclusiveAmount: 0,
    lockedAmountExcess: 0,
    contractAmount: 1320000,
    paidAmount: 100000,
    profitAnchorTaxExclusiveAmount: 1200000,
  })
  assert.notEqual(snapshot.contractAmount, snapshot.profitAnchorTaxExclusiveAmount)
  assert.deepEqual(project, originals.project)
  assert.deepEqual(changes, originals.changes)
  assert.deepEqual(plans, originals.plans)
  assert.deepEqual(receipts, originals.receipts)
})

test('unmigrated projects preserve legacy contractAmount and paidAmount in a read-only compatibility snapshot', () => {
  const project = {
    projectId: 'P-LEGACY',
    projectName: '旧项目',
    contractAmount: '500000',
    paidAmount: '125000',
  }
  const changes = [contractChange({ taxExclusiveAmount: '', taxInclusiveAmount: '' })]
  const plans = [paymentPlan('invalid', '', '')]
  const receipts = [receipt('initial', '')]
  const originals = {
    project: clone(project),
    changes: clone(changes),
    plans: clone(plans),
    receipts: clone(receipts),
  }

  const snapshot = revenueCalculations.buildProjectRevenueSnapshot(
    project,
    changes,
    plans,
    receipts,
  )

  assert.deepEqual(snapshot, {
    adjustedTaxExclusiveAmount: 500000,
    adjustedTaxAmount: 0,
    adjustedTaxInclusiveAmount: 500000,
    totalReceivedTaxInclusiveAmount: 125000,
    outstandingTaxInclusiveAmount: 375000,
    overpaidTaxInclusiveAmount: 0,
    paymentProgress: 25,
    paymentStatus: '部分收款',
    allocationStatus: 'legacy_compatibility',
    allocationReason: 'contract_revenue_schema_not_migrated',
    lockedStages: [],
    unlockedStages: [],
    lockedPlannedTaxInclusiveAmount: 0,
    remainingAssignableTaxInclusiveAmount: 500000,
    unallocatedTaxInclusiveAmount: 500000,
    lockedAmountExcess: 0,
    contractAmount: 500000,
    paidAmount: 125000,
    profitAnchorTaxExclusiveAmount: 500000,
  })
  assert.deepEqual(project, originals.project)
  assert.deepEqual(changes, originals.changes)
  assert.deepEqual(plans, originals.plans)
  assert.deepEqual(receipts, originals.receipts)
})

test('migrated project snapshot reports overpayment and progress above 100 percent', () => {
  const snapshot = revenueCalculations.buildProjectRevenueSnapshot(
    migratedProject(),
    [],
    [
      paymentPlan('initial', 330000, 30),
      paymentPlan('middle', 440000, 40),
      paymentPlan('final', 330000, 30),
    ],
    [receipt('final', 1200000)],
  )

  assert.equal(snapshot.totalReceivedTaxInclusiveAmount, 1200000)
  assert.equal(snapshot.outstandingTaxInclusiveAmount, 0)
  assert.equal(snapshot.overpaidTaxInclusiveAmount, 100000)
  assert.equal(snapshot.paymentProgress, 109)
  assert.equal(snapshot.paymentStatus, '超额收款')
  assert.equal(snapshot.contractAmount, 1100000)
  assert.equal(snapshot.paidAmount, 1200000)
  assert.equal(snapshot.profitAnchorTaxExclusiveAmount, 1000000)
})

test('invalid legacy and migrated source amounts are rejected instead of converted to zero', () => {
  assert.throws(
    () =>
      revenueCalculations.buildProjectRevenueSnapshot({
        projectId: 'P-LEGACY',
        contractAmount: '',
        paidAmount: 0,
      }),
    assertValidationError('contractAmount'),
  )

  assert.throws(
    () =>
      revenueCalculations.buildProjectRevenueSnapshot({
        projectId: 'P-LEGACY',
        contractAmount: 500000,
        paidAmount: -1,
      }),
    assertValidationError('paidAmount'),
  )

  assert.throws(
    () =>
      revenueCalculations.buildProjectRevenueSnapshot(
        migratedProject({ originalContractTaxInclusiveAmount: '' }),
        [],
        [],
        [],
      ),
    assertValidationError('taxInclusiveAmount'),
  )

  assert.throws(
    () =>
      revenueCalculations.buildProjectRevenueSnapshot(
        migratedProject(),
        [],
        [
          paymentPlan('initial', 330000, 30),
          paymentPlan('middle', 440000, 40),
          paymentPlan('final', 330000, 30),
        ],
        [receipt('initial', '', { receiptId: 'receipt-invalid' })],
      ),
    assertValidationError('receipt-invalid.taxInclusiveAmount'),
  )
})

test('snapshot collection keeps legacy project amounts unchanged in the read model', () => {
  const projects = [
    {
      projectId: 'P-LEGACY',
      projectName: '旧项目',
      contractAmount: 500000,
      paidAmount: 125000,
      paymentProgress: 25,
      paymentStatus: '部分付款',
    },
  ]
  const originalProjects = clone(projects)

  const snapshots = revenueCalculations.buildProjectRevenueSnapshotCollection(
    projects,
    [],
    [],
    [],
  )
  const readModel = revenueCalculations.buildProjectRevenueReadModel(
    projects[0],
    snapshots.get('P-LEGACY'),
  )

  assert.equal(readModel.contractAmount, 500000)
  assert.equal(readModel.paidAmount, 125000)
  assert.equal(readModel.paymentProgress, 25)
  assert.equal(readModel.paymentStatus, '部分付款')
  assert.equal(readModel.outstandingTaxInclusiveAmount, 375000)
  assert.deepEqual(projects, originalProjects)
})

test('migrated project read model separates tax-inclusive receipts from tax-exclusive profit anchor', () => {
  const project = migratedProject({
    projectName: '迁移项目',
    contractAmount: 1,
    paidAmount: 2,
  })
  const changes = [contractChange()]
  const plans = [
    paymentPlan('initial', 396000, 30),
    paymentPlan('middle', 528000, 40),
    paymentPlan('final', 396000, 30),
  ]
  const receipts = [receipt('initial', 396000)]
  const originals = {
    project: clone(project),
    changes: clone(changes),
    plans: clone(plans),
    receipts: clone(receipts),
  }

  const snapshots = revenueCalculations.buildProjectRevenueSnapshotCollection(
    [project],
    changes,
    plans,
    receipts,
  )
  const readModel = revenueCalculations.buildProjectRevenueReadModel(
    project,
    snapshots.get('P001'),
  )

  assert.equal(readModel.contractAmount, 1320000)
  assert.equal(readModel.paidAmount, 396000)
  assert.equal(readModel.outstandingTaxInclusiveAmount, 924000)
  assert.equal(readModel.paymentProgress, 30)
  assert.equal(readModel.paymentStatus, '部分付款')
  assert.equal(readModel.revenuePaymentStatus, '部分收款')
  assert.equal(readModel.profitAnchorTaxExclusiveAmount, 1200000)
  assert.equal(revenueCalculations.getProfitAnchorTaxExclusiveAmount(readModel), 1200000)
  assert.notEqual(
    revenueCalculations.getProfitAnchorTaxExclusiveAmount(readModel),
    readModel.contractAmount,
  )
  assert.deepEqual(project, originals.project)
  assert.deepEqual(changes, originals.changes)
  assert.deepEqual(plans, originals.plans)
  assert.deepEqual(receipts, originals.receipts)
})

test('building a revenue read model never adds snapshot fields to the persisted project object', () => {
  const project = {
    projectId: 'P-LEGACY',
    projectName: '只读项目',
    contractAmount: 800000,
    paidAmount: 0,
  }
  const originalProject = clone(project)
  const snapshots = revenueCalculations.buildProjectRevenueSnapshotCollection(
    [project],
    [],
    [],
    [],
  )

  const readModel = revenueCalculations.buildProjectRevenueReadModel(
    project,
    snapshots.get(project.projectId),
  )

  assert.notEqual(readModel, project)
  assert.equal(Object.hasOwn(project, 'profitAnchorTaxExclusiveAmount'), false)
  assert.equal(Object.hasOwn(readModel, 'profitAnchorTaxExclusiveAmount'), true)
  assert.deepEqual(project, originalProject)
})

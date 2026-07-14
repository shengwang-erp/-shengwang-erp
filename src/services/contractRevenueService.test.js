import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTRACT_REVENUE_STORAGE_KEYS,
  PROJECT_REVENUE_SNAPSHOT_FIELDS,
  createContractRevenueService,
  sanitizeProjectForPersistence,
} from './contractRevenueService.js'
import { recordTableConfigs } from './recordTableConfig.js'

const FIXED_NOW = '2026-07-14T06:00:00.000Z'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function createFakeDependencies(lists = {}) {
  const calls = []
  return {
    calls,
    dependencies: {
      getList: async (storageKey) => {
        calls.push({ operation: 'getList', storageKey })
        return lists[storageKey]
      },
      upsertRecord: async (storageKey, record) => {
        calls.push({ operation: 'upsertRecord', storageKey, record })
        return { saved: 1, failed: 0, skipped: false }
      },
      now: () => FIXED_NOW,
    },
  }
}

test('contract revenue storage keys map to dedicated Supabase tables', () => {
  assert.deepEqual(CONTRACT_REVENUE_STORAGE_KEYS, {
    contractChanges: 'erp.projectContractChanges',
    paymentPlans: 'erp.projectPaymentPlans',
    projectReceipts: 'erp.projectReceipts',
  })

  assert.deepEqual(recordTableConfigs[CONTRACT_REVENUE_STORAGE_KEYS.contractChanges], {
    tableName: 'project_contract_changes',
    recordKeyField: 'changeId',
  })
  assert.deepEqual(recordTableConfigs[CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans], {
    tableName: 'project_payment_plans',
    recordKeyField: 'planId',
  })
  assert.deepEqual(recordTableConfigs[CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts], {
    tableName: 'project_receipts',
    recordKeyField: 'receiptId',
  })
})

test('load methods read each contract revenue collection and normalize missing lists to empty arrays', async () => {
  const { calls, dependencies } = createFakeDependencies({
    [CONTRACT_REVENUE_STORAGE_KEYS.contractChanges]: [{ changeId: 'change-1' }],
    [CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans]: [{ planId: 'plan-1' }],
  })
  const service = createContractRevenueService(dependencies)

  assert.deepEqual(await service.loadContractChanges(), [{ changeId: 'change-1' }])
  assert.deepEqual(await service.loadPaymentPlans(), [{ planId: 'plan-1' }])
  assert.deepEqual(await service.loadProjectReceipts(), [])
  assert.deepEqual(
    calls.map((call) => [call.operation, call.storageKey]),
    [
      ['getList', CONTRACT_REVENUE_STORAGE_KEYS.contractChanges],
      ['getList', CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans],
      ['getList', CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts],
    ],
  )
})

test('ordinary create methods always generate UUIDs and persist exactly one record with upsertRecord', async () => {
  const { calls, dependencies } = createFakeDependencies()
  const service = createContractRevenueService(dependencies)
  const createCases = [
    {
      method: 'createContractChange',
      idField: 'changeId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.contractChanges,
      input: { changeId: 'CC001', projectId: 'P001', changeType: 'increase' },
    },
    {
      method: 'createPaymentPlan',
      idField: 'planId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans,
      input: { planId: 'PP001', projectId: 'P001', stage: 'initial' },
    },
    {
      method: 'createProjectReceipt',
      idField: 'receiptId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
      input: { receiptId: 'RC001', projectId: 'P001', taxInclusiveAmount: 100000 },
    },
  ]

  for (const item of createCases) {
    const callCountBefore = calls.length
    const created = await service[item.method](item.input)
    const operation = calls.at(-1)

    assert.match(created[item.idField], UUID_PATTERN)
    assert.notEqual(created[item.idField], item.input[item.idField])
    assert.equal(created.statusCode, 'active')
    assert.equal(created.createdAt, FIXED_NOW)
    assert.equal(created.updatedAt, FIXED_NOW)
    assert.equal(calls.length, callCountBefore + 1)
    assert.equal(operation.operation, 'upsertRecord')
    assert.equal(operation.storageKey, item.storageKey)
    assert.deepEqual(operation.record, created)
  }
})

test('update methods keep the existing ID and use one upsertRecord call per record', async () => {
  const { calls, dependencies } = createFakeDependencies()
  const service = createContractRevenueService(dependencies)
  const updateCases = [
    {
      method: 'updateContractChange',
      idField: 'changeId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.contractChanges,
      record: { changeId: 'change-1', projectId: 'P001', reason: 'updated' },
    },
    {
      method: 'updatePaymentPlan',
      idField: 'planId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans,
      record: { planId: 'plan-1', projectId: 'P001', stage: 'middle' },
    },
    {
      method: 'updateProjectReceipt',
      idField: 'receiptId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
      record: { receiptId: 'receipt-1', projectId: 'P001', taxInclusiveAmount: 200000 },
    },
  ]

  for (const item of updateCases) {
    const callCountBefore = calls.length
    const updated = await service[item.method](item.record)
    const operation = calls.at(-1)

    assert.equal(updated[item.idField], item.record[item.idField])
    assert.equal(updated.statusCode, 'active')
    assert.equal(updated.updatedAt, FIXED_NOW)
    assert.equal(calls.length, callCountBefore + 1)
    assert.equal(operation.operation, 'upsertRecord')
    assert.equal(operation.storageKey, item.storageKey)
    assert.deepEqual(operation.record, updated)
  }
})

test('void methods preserve records and upsert statusCode void instead of hard deleting', async () => {
  const { calls, dependencies } = createFakeDependencies()
  const service = createContractRevenueService(dependencies)
  const voidCases = [
    {
      method: 'voidContractChange',
      idField: 'changeId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.contractChanges,
      record: { changeId: 'change-1', projectId: 'P001', taxInclusiveAmount: 110000 },
    },
    {
      method: 'voidPaymentPlan',
      idField: 'planId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans,
      record: { planId: 'plan-1', projectId: 'P001', plannedTaxInclusiveAmount: 330000 },
    },
    {
      method: 'voidProjectReceipt',
      idField: 'receiptId',
      storageKey: CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
      record: { receiptId: 'receipt-1', projectId: 'P001', taxInclusiveAmount: 100000 },
    },
  ]

  for (const item of voidCases) {
    const callCountBefore = calls.length
    const voided = await service[item.method](item.record, { voidReason: '录入错误' })
    const operation = calls.at(-1)

    assert.equal(voided[item.idField], item.record[item.idField])
    assert.equal(voided.statusCode, 'void')
    assert.equal(voided.voidReason, '录入错误')
    assert.equal(voided.voidedAt, FIXED_NOW)
    assert.equal(voided.updatedAt, FIXED_NOW)
    assert.equal(calls.length, callCountBefore + 1)
    assert.equal(operation.operation, 'upsertRecord')
    assert.equal(operation.storageKey, item.storageKey)
    assert.deepEqual(operation.record, voided)
    assert.notEqual(operation.record.statusCode, 'deleted')
  }

  assert.equal(service.softDelete, undefined)
  assert.equal(service.deleteRecord, undefined)
})

test('sanitizeProjectForPersistence removes every compatibility and revenue snapshot field without mutating input', () => {
  const project = {
    projectId: 'P001',
    projectName: '测试项目',
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxInclusiveAmount: 1100000,
    contractAmount: 1100000,
    paidAmount: 500000,
    paymentProgress: 45,
    paymentStatus: '部分收款',
    revenuePaymentStatus: '部分收款',
    adjustedTaxExclusiveAmount: 1000000,
    adjustedTaxAmount: 100000,
    adjustedTaxInclusiveAmount: 1100000,
    totalReceivedTaxInclusiveAmount: 500000,
    outstandingTaxInclusiveAmount: 600000,
    overpaidTaxInclusiveAmount: 0,
    profitAnchorTaxExclusiveAmount: 1000000,
    allocationStatus: 'manual_review_required',
    allocationReason: 'all_stages_locked',
    lockedStages: ['initial'],
    unlockedStages: ['middle', 'final'],
    lockedPlannedTaxInclusiveAmount: 330000,
    remainingAssignableTaxInclusiveAmount: 770000,
    unallocatedTaxInclusiveAmount: 100000,
    lockedAmountExcess: 0,
  }

  const sanitized = sanitizeProjectForPersistence(project)

  assert.notEqual(sanitized, project)
  assert.equal(sanitized.projectId, 'P001')
  assert.equal(sanitized.originalContractTaxExclusiveAmount, 1000000)
  assert.equal(
    PROJECT_REVENUE_SNAPSHOT_FIELDS.includes('profitAnchorTaxExclusiveAmount'),
    true,
  )
  assert.equal(PROJECT_REVENUE_SNAPSHOT_FIELDS.includes('revenuePaymentStatus'), true)
  for (const field of PROJECT_REVENUE_SNAPSHOT_FIELDS) {
    assert.equal(Object.hasOwn(sanitized, field), false, `${field} should be removed`)
    assert.equal(Object.hasOwn(project, field), true, `${field} should remain on input`)
  }
})

test('persistProject sanitizes snapshot fields before one erp.projects upsert', async () => {
  const { calls, dependencies } = createFakeDependencies()
  const service = createContractRevenueService(dependencies)
  const persisted = await service.persistProject({
    projectId: 'P001',
    projectName: '测试项目',
    originalContractTaxExclusiveAmount: 1000000,
    contractAmount: 1100000,
    paidAmount: 500000,
    paymentProgress: 45,
  })

  assert.deepEqual(persisted, {
    projectId: 'P001',
    projectName: '测试项目',
    originalContractTaxExclusiveAmount: 1000000,
  })
  assert.deepEqual(calls, [
    {
      operation: 'upsertRecord',
      storageKey: 'erp.projects',
      record: persisted,
    },
  ])
})

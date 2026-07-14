import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CONTRACT_REVENUE_SCHEMA_VERSION,
  HISTORICAL_MIGRATED_CONFIRMED,
  getLegacyOpeningReceiptId,
  persistLegacyContractRevenueMigration,
  previewLegacyContractRevenueMigration,
} from './contractRevenueMigration.js'
import { CONTRACT_REVENUE_STORAGE_KEYS } from './contractRevenueService.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function legacyProject(overrides = {}) {
  return {
    projectId: 'P001',
    projectName: '历史项目',
    contractAmount: '1000000',
    paidAmount: '200000',
    ...overrides,
  }
}

test('preview migrates legacy contract and paid amounts without mutating source data', () => {
  const projects = [
    legacyProject({
      metadata: { owner: '设计担当' },
      paymentProgress: 20,
    }),
  ]
  const originalProjects = clone(projects)

  const preview = previewLegacyContractRevenueMigration({ projects })

  assert.equal(preview.migrationProjectCount, 1)
  assert.equal(preview.openingReceiptCount, 1)
  assert.deepEqual(preview.exceptions, [])
  assert.deepEqual(
    preview.warnings.map(({ code, projectId }) => ({ code, projectId })),
    [{ code: 'needs_manual_review', projectId: 'P001' }],
  )

  const [{ project, openingReceipt }] = preview.items
  assert.deepEqual(project, {
    projectId: 'P001',
    projectName: '历史项目',
    metadata: { owner: '设计担当' },
    originalContractTaxExclusiveAmount: 1000000,
    originalContractTaxRate: 0,
    originalContractTaxAmount: 0,
    originalContractTaxInclusiveAmount: 1000000,
    contractConfirmationStatus: HISTORICAL_MIGRATED_CONFIRMED,
    needsManualReview: true,
    contractRevenueSchemaVersion: CONTRACT_REVENUE_SCHEMA_VERSION,
  })
  assert.equal(Object.hasOwn(project, 'contractAmount'), false)
  assert.equal(Object.hasOwn(project, 'paidAmount'), false)
  assert.equal(Object.hasOwn(project, 'paymentProgress'), false)

  assert.deepEqual(openingReceipt, {
    receiptId: getLegacyOpeningReceiptId('P001'),
    projectId: 'P001',
    receiptType: 'opening_balance',
    taxInclusiveAmount: 200000,
    statusCode: 'active',
    sourceCode: 'legacy_contract_migration',
  })
  assert.deepEqual(projects, originalProjects)
  assert.notEqual(project, projects[0])
})

test('zero paidAmount is valid and does not generate an opening receipt', () => {
  const preview = previewLegacyContractRevenueMigration({
    projects: [legacyProject({ paidAmount: 0 })],
  })

  assert.equal(preview.migrationProjectCount, 1)
  assert.equal(preview.openingReceiptCount, 0)
  assert.equal(preview.items[0].openingReceipt, null)
  assert.deepEqual(preview.exceptions, [])
})

test('blank, negative, fractional and non-numeric paidAmount values enter the exception list', () => {
  const invalidValues = ['', -1, '10.5', 'invalid']
  const projects = invalidValues.map((paidAmount, index) =>
    legacyProject({ projectId: `P00${index + 1}`, paidAmount }),
  )

  const preview = previewLegacyContractRevenueMigration({ projects })

  assert.equal(preview.migrationProjectCount, 0)
  assert.equal(preview.openingReceiptCount, 0)
  assert.deepEqual(
    preview.exceptions.map(({ projectId, code, field }) => ({ projectId, code, field })),
    projects.map((project) => ({
      projectId: project.projectId,
      code: 'invalid_paid_amount',
      field: 'paidAmount',
    })),
  )
})

test('projects missing projectId or containing invalid contractAmount are not migrated', () => {
  const projects = [
    legacyProject({ projectId: '' }),
    legacyProject({ projectId: 'P002', contractAmount: '' }),
    legacyProject({ projectId: 'P003', contractAmount: 0 }),
    legacyProject({ projectId: 'P004', contractAmount: -1 }),
    legacyProject({ projectId: 'P005', contractAmount: '10.5' }),
  ]

  const preview = previewLegacyContractRevenueMigration({ projects })

  assert.equal(preview.migrationProjectCount, 0)
  assert.equal(preview.openingReceiptCount, 0)
  assert.deepEqual(
    preview.exceptions.map(({ code, field }) => ({ code, field })),
    [
      { code: 'missing_project_id', field: 'projectId' },
      { code: 'invalid_contract_amount', field: 'contractAmount' },
      { code: 'invalid_contract_amount', field: 'contractAmount' },
      { code: 'invalid_contract_amount', field: 'contractAmount' },
      { code: 'invalid_contract_amount', field: 'contractAmount' },
    ],
  )
})

test('schema version 1 projects are skipped without generating duplicate data', () => {
  const preview = previewLegacyContractRevenueMigration({
    projects: [legacyProject({ contractRevenueSchemaVersion: 1 })],
  })

  assert.equal(preview.migrationProjectCount, 0)
  assert.equal(preview.openingReceiptCount, 0)
  assert.deepEqual(preview.exceptions, [])
  assert.deepEqual(
    preview.warnings.map(({ code, projectId }) => ({ code, projectId })),
    [{ code: 'already_migrated', projectId: 'P001' }],
  )
})

test('an existing deterministic opening receipt is reused during an interrupted retry', () => {
  const deterministicId = getLegacyOpeningReceiptId('P001')
  const existingReceipts = [
    {
      receiptId: deterministicId,
      projectId: 'P001',
      taxInclusiveAmount: 200000,
      statusCode: 'active',
    },
  ]
  const originalReceipts = clone(existingReceipts)

  const preview = previewLegacyContractRevenueMigration({
    projects: [legacyProject()],
    existingReceipts,
  })

  assert.equal(preview.migrationProjectCount, 1)
  assert.equal(preview.openingReceiptCount, 0)
  assert.equal(preview.items[0].openingReceipt, null)
  assert.ok(
    preview.warnings.some(
      ({ code, projectId }) =>
        code === 'opening_receipt_already_exists' && projectId === 'P001',
    ),
  )
  assert.deepEqual(existingReceipts, originalReceipts)
})

test('persistence upserts the opening receipt before saving the versioned project', async () => {
  const preview = previewLegacyContractRevenueMigration({ projects: [legacyProject()] })
  const calls = []

  const result = await persistLegacyContractRevenueMigration(preview, {
    upsertRecord: async (storageKey, record) => {
      calls.push({ storageKey, record })
      return { saved: 1, failed: 0, skipped: false }
    },
  })

  assert.equal(result.migratedProjectCount, 1)
  assert.equal(result.upsertedOpeningReceiptCount, 1)
  assert.equal(calls.length, 2)
  assert.equal(calls[0].storageKey, CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts)
  assert.equal(calls[0].record.receiptId, getLegacyOpeningReceiptId('P001'))
  assert.equal(calls[1].storageKey, 'erp.projects')
  assert.equal(calls[1].record.contractRevenueSchemaVersion, 1)
  assert.equal(Object.hasOwn(calls[1].record, 'contractAmount'), false)
  assert.equal(Object.hasOwn(calls[1].record, 'paidAmount'), false)
})

test('receipt persistence failure prevents project version from being saved', async () => {
  const project = legacyProject()
  const preview = previewLegacyContractRevenueMigration({ projects: [project] })
  const calls = []

  await assert.rejects(
    () =>
      persistLegacyContractRevenueMigration(preview, {
        upsertRecord: async (storageKey, record) => {
          calls.push({ storageKey, record })
          throw new Error('receipt write failed')
        },
      }),
    /receipt write failed/,
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].storageKey, CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts)
  assert.equal(Object.hasOwn(project, 'contractRevenueSchemaVersion'), false)
})

test('a skipped receipt upsert is not treated as success and cannot advance the project version', async () => {
  const preview = previewLegacyContractRevenueMigration({ projects: [legacyProject()] })
  const calls = []

  await assert.rejects(
    () =>
      persistLegacyContractRevenueMigration(preview, {
        upsertRecord: async (storageKey, record) => {
          calls.push({ storageKey, record })
          return { saved: 0, failed: 0, skipped: true }
        },
      }),
    /期初收款保存未成功/,
  )

  assert.equal(calls.length, 1)
  assert.equal(calls[0].storageKey, CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts)
})

test('retry after an existing deterministic receipt saves only the project migration version', async () => {
  const preview = previewLegacyContractRevenueMigration({
    projects: [legacyProject()],
    existingReceipts: [
      {
        receiptId: getLegacyOpeningReceiptId('P001'),
        projectId: 'P001',
        taxInclusiveAmount: 200000,
      },
    ],
  })
  const calls = []

  const result = await persistLegacyContractRevenueMigration(preview, {
    upsertRecord: async (storageKey, record) => {
      calls.push({ storageKey, record })
      return { saved: 1, failed: 0, skipped: false }
    },
  })

  assert.equal(result.migratedProjectCount, 1)
  assert.equal(result.upsertedOpeningReceiptCount, 0)
  assert.deepEqual(calls.map(({ storageKey }) => storageKey), ['erp.projects'])
  assert.equal(calls[0].record.contractRevenueSchemaVersion, 1)
})

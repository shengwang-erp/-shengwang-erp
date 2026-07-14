import assert from 'node:assert/strict'
import test from 'node:test'

import { getLegacyOpeningReceiptId } from './contractRevenueMigration.js'

const localMigration = await import('./contractRevenueLocalMigration.js').catch(() => ({}))

function requireExport(name) {
  assert.equal(typeof localMigration[name], 'function', `${name} must be exported`)
  return localMigration[name]
}

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial))
    this.writes = []
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  }

  setItem(key, value) {
    const serialized = String(value)
    this.writes.push({ key, value: serialized })
    this.values.set(key, serialized)
  }
}

function legacyProject(projectId, overrides = {}) {
  return {
    projectId,
    projectName: `历史项目${projectId}`,
    contractAmount: 1000000,
    paidAmount: 200000,
    ...overrides,
  }
}

function createStorage(projects, receipts = [], options = {}) {
  const projectsJson = options.projectsJson || JSON.stringify(projects)
  const receiptsJson = options.receiptsJson || JSON.stringify(receipts)
  return new MemoryStorage({
    'erp.projects': projectsJson,
    'erp.projectReceipts': receiptsJson,
  })
}

test('local read-only preview reports migratable projects, opening receipts, warnings and exceptions', () => {
  const previewLocalContractRevenueMigration = requireExport(
    'previewLocalContractRevenueMigration',
  )
  const storage = createStorage([
    legacyProject('P001'),
    legacyProject('P002', { paidAmount: 0 }),
    legacyProject('P003', { contractAmount: '' }),
  ])
  const originalProjectsJson = storage.getItem('erp.projects')
  const originalReceiptsJson = storage.getItem('erp.projectReceipts')

  const preview = previewLocalContractRevenueMigration(storage)

  assert.equal(preview.migrationProjectCount, 2)
  assert.equal(preview.openingReceiptCount, 1)
  assert.equal(preview.warnings.length, 2)
  assert.deepEqual(
    preview.exceptions.map(({ projectId, code }) => ({ projectId, code })),
    [{ projectId: 'P003', code: 'invalid_contract_amount' }],
  )
  assert.equal(storage.getItem('erp.projects'), originalProjectsJson)
  assert.equal(storage.getItem('erp.projectReceipts'), originalReceiptsJson)
  assert.deepEqual(storage.writes, [])
})

test('execution backs up exact raw project and receipt JSON before the first migration write', async () => {
  const previewLocalContractRevenueMigration = requireExport(
    'previewLocalContractRevenueMigration',
  )
  const executeLocalContractRevenueMigration = requireExport(
    'executeLocalContractRevenueMigration',
  )
  const backupStorageKey = localMigration.CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY
  assert.equal(typeof backupStorageKey, 'string')

  const projectsJson = '[\n  {"projectId":"P001","contractAmount":1000000,"paidAmount":200000}\n]'
  const receiptsJson = '[\n]'
  const storage = createStorage([], [], { projectsJson, receiptsJson })
  const preview = previewLocalContractRevenueMigration(storage)

  const result = await executeLocalContractRevenueMigration({
    storage,
    preview,
    now: () => '2026-07-14T12:00:00.000Z',
  })

  assert.equal(storage.writes[0].key, backupStorageKey)
  const backups = JSON.parse(storage.getItem(backupStorageKey))
  assert.equal(backups.length, 1)
  assert.equal(backups[0].backupFormatVersion, 1)
  assert.equal(backups[0].contractRevenueSchemaVersion, 1)
  assert.equal(backups[0].createdAt, '2026-07-14T12:00:00.000Z')
  assert.equal(backups[0].projectsJson, projectsJson)
  assert.equal(backups[0].projectReceiptsJson, receiptsJson)
  assert.equal(result.backup.createdAt, '2026-07-14T12:00:00.000Z')
  assert.equal(result.migratedProjectCount, 1)
  assert.equal(result.upsertedOpeningReceiptCount, 1)
})

test('one project failure keeps its project data unchanged and does not block later projects', async () => {
  const previewLocalContractRevenueMigration = requireExport(
    'previewLocalContractRevenueMigration',
  )
  const executeLocalContractRevenueMigration = requireExport(
    'executeLocalContractRevenueMigration',
  )
  const createLocalStorageUpsertRecord = requireExport('createLocalStorageUpsertRecord')
  const sourceProjects = [legacyProject('P001'), legacyProject('P002'), legacyProject('P003')]
  const storage = createStorage(sourceProjects)
  const preview = previewLocalContractRevenueMigration(storage)
  const localUpsert = createLocalStorageUpsertRecord(storage)
  const calls = []

  const result = await executeLocalContractRevenueMigration({
    storage,
    preview,
    now: () => '2026-07-14T12:00:00.000Z',
    upsertRecord: async (storageKey, record) => {
      calls.push({ storageKey, record })
      if (storageKey === 'erp.projects' && record.projectId === 'P002') {
        throw new Error('P002 project write failed')
      }
      return localUpsert(storageKey, record)
    },
  })

  assert.equal(result.migratedProjectCount, 2)
  assert.equal(result.failedProjectCount, 1)
  assert.deepEqual(
    result.projectResults.map(({ projectId, status }) => ({ projectId, status })),
    [
      { projectId: 'P001', status: 'migrated' },
      { projectId: 'P002', status: 'failed' },
      { projectId: 'P003', status: 'migrated' },
    ],
  )
  assert.match(result.projectResults[1].error, /P002 project write failed/)

  const persistedProjects = JSON.parse(storage.getItem('erp.projects'))
  const failedProject = persistedProjects.find(({ projectId }) => projectId === 'P002')
  assert.deepEqual(failedProject, sourceProjects[1])
  assert.equal(
    persistedProjects.find(({ projectId }) => projectId === 'P001').contractRevenueSchemaVersion,
    1,
  )
  assert.equal(
    persistedProjects.find(({ projectId }) => projectId === 'P003').contractRevenueSchemaVersion,
    1,
  )

  for (const projectId of ['P001', 'P002', 'P003']) {
    const receiptIndex = calls.findIndex(
      ({ storageKey, record }) =>
        storageKey === 'erp.projectReceipts' && record.projectId === projectId,
    )
    const projectIndex = calls.findIndex(
      ({ storageKey, record }) => storageKey === 'erp.projects' && record.projectId === projectId,
    )
    assert.ok(receiptIndex >= 0 && projectIndex > receiptIndex)
  }

  const retryPreview = previewLocalContractRevenueMigration(storage)
  assert.equal(retryPreview.migrationProjectCount, 1)
  assert.equal(retryPreview.openingReceiptCount, 0)
  const retry = await executeLocalContractRevenueMigration({
    storage,
    preview: retryPreview,
    now: () => '2026-07-14T12:05:00.000Z',
  })
  assert.equal(retry.migratedProjectCount, 1)
  assert.equal(retry.failedProjectCount, 0)
  const receipts = JSON.parse(storage.getItem('erp.projectReceipts'))
  assert.equal(
    receipts.filter(({ receiptId }) => receiptId === getLegacyOpeningReceiptId('P002')).length,
    1,
  )
})

test('repeated execution neither duplicates the deterministic opening receipt nor overwrites a migrated project', async () => {
  const previewLocalContractRevenueMigration = requireExport(
    'previewLocalContractRevenueMigration',
  )
  const executeLocalContractRevenueMigration = requireExport(
    'executeLocalContractRevenueMigration',
  )
  const storage = createStorage([legacyProject('P001')])

  const firstPreview = previewLocalContractRevenueMigration(storage)
  const first = await executeLocalContractRevenueMigration({
    storage,
    preview: firstPreview,
    now: () => '2026-07-14T12:00:00.000Z',
  })
  assert.equal(first.migratedProjectCount, 1)
  const projectAfterFirstRun = JSON.parse(storage.getItem('erp.projects'))[0]

  const secondPreview = previewLocalContractRevenueMigration(storage)
  assert.equal(secondPreview.migrationProjectCount, 0)
  assert.equal(secondPreview.openingReceiptCount, 0)
  const second = await executeLocalContractRevenueMigration({
    storage,
    preview: secondPreview,
    now: () => '2026-07-14T12:10:00.000Z',
  })

  assert.equal(second.migratedProjectCount, 0)
  assert.equal(second.failedProjectCount, 0)
  assert.deepEqual(JSON.parse(storage.getItem('erp.projects'))[0], projectAfterFirstRun)
  const receipts = JSON.parse(storage.getItem('erp.projectReceipts'))
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].receiptId, getLegacyOpeningReceiptId('P001'))
})

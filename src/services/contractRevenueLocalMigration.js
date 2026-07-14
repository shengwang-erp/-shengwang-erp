import {
  CONTRACT_REVENUE_SCHEMA_VERSION,
  persistLegacyContractRevenueMigration,
  previewLegacyContractRevenueMigration,
} from './contractRevenueMigration.js'
import { CONTRACT_REVENUE_STORAGE_KEYS } from './contractRevenueService.js'

const PROJECT_STORAGE_KEY = 'erp.projects'
const PROJECT_ID_FIELD = 'projectId'
const RECEIPT_ID_FIELD = 'receiptId'
const BACKUP_FORMAT_VERSION = 1

export const CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY =
  'erp.contractRevenueMigrationBackups'

function resolveStorage(storage) {
  const resolved = storage || globalThis.window?.localStorage
  if (
    !resolved ||
    typeof resolved.getItem !== 'function' ||
    typeof resolved.setItem !== 'function'
  ) {
    throw new Error('localStorage不可用')
  }
  return resolved
}

function parseStoredList(storage, storageKey) {
  const rawValue = storage.getItem(storageKey)
  if (rawValue === null || rawValue === '') return []

  let value
  try {
    value = JSON.parse(rawValue)
  } catch {
    throw new Error(`${storageKey}不是有效JSON，无法安全迁移`)
  }
  if (!Array.isArray(value)) {
    throw new Error(`${storageKey}必须是数组，无法安全迁移`)
  }
  return value
}

function recordIdentity(storageKey) {
  if (storageKey === PROJECT_STORAGE_KEY) return PROJECT_ID_FIELD
  if (storageKey === CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts) {
    return RECEIPT_ID_FIELD
  }
  throw new Error(`不支持的本地迁移存储键：${storageKey}`)
}

export function previewLocalContractRevenueMigration(storage) {
  const localStorage = resolveStorage(storage)
  return previewLegacyContractRevenueMigration({
    projects: parseStoredList(localStorage, PROJECT_STORAGE_KEY),
    existingReceipts: parseStoredList(
      localStorage,
      CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
    ),
  })
}

export function createLocalStorageUpsertRecord(storage) {
  const localStorage = resolveStorage(storage)

  return async (storageKey, record) => {
    const idField = recordIdentity(storageKey)
    const recordId = record?.[idField]
    if (typeof recordId !== 'string' || !recordId.trim()) {
      throw new Error(`${idField}不能为空`)
    }

    const records = parseStoredList(localStorage, storageKey)
    const nextRecords = [
      record,
      ...records.filter((item) => item?.[idField] !== recordId),
    ]
    localStorage.setItem(storageKey, JSON.stringify(nextRecords))
    return { saved: 1, failed: 0, skipped: false }
  }
}

export function backupLocalContractRevenueData(
  storage,
  now = () => new Date().toISOString(),
) {
  const localStorage = resolveStorage(storage)
  const createdAt = now()
  if (typeof createdAt !== 'string' || !createdAt.trim()) {
    throw new Error('备份时间不能为空')
  }

  const existingBackupJson = localStorage.getItem(
    CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY,
  )
  let existingBackups = []
  if (existingBackupJson) {
    try {
      existingBackups = JSON.parse(existingBackupJson)
    } catch {
      throw new Error('历史合同迁移备份记录不是有效JSON')
    }
    if (!Array.isArray(existingBackups)) {
      throw new Error('历史合同迁移备份记录必须是数组')
    }
  }

  const backup = {
    backupId: `contract-revenue-v1:${createdAt.trim()}`,
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    contractRevenueSchemaVersion: CONTRACT_REVENUE_SCHEMA_VERSION,
    createdAt: createdAt.trim(),
    projectsStorageKey: PROJECT_STORAGE_KEY,
    projectReceiptsStorageKey: CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
    projectsJson: localStorage.getItem(PROJECT_STORAGE_KEY),
    projectReceiptsJson: localStorage.getItem(
      CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
    ),
  }

  localStorage.setItem(
    CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY,
    JSON.stringify([...existingBackups, backup]),
  )
  return backup
}

export async function executeLocalContractRevenueMigration({
  storage,
  preview,
  now = () => new Date().toISOString(),
  upsertRecord,
} = {}) {
  const localStorage = resolveStorage(storage)
  const resolvedPreview = preview || previewLocalContractRevenueMigration(localStorage)
  const items = Array.isArray(resolvedPreview?.items) ? resolvedPreview.items : []
  const backup = backupLocalContractRevenueData(localStorage, now)
  const persistLocalRecord =
    upsertRecord || createLocalStorageUpsertRecord(localStorage)
  const projectResults = []
  let migratedProjectCount = 0
  let failedProjectCount = 0
  let upsertedOpeningReceiptCount = 0

  for (const item of items) {
    const projectId = item?.project?.projectId || ''
    try {
      const result = await persistLegacyContractRevenueMigration(
        { items: [item] },
        { upsertRecord: persistLocalRecord },
      )
      migratedProjectCount += result.migratedProjectCount
      upsertedOpeningReceiptCount += result.upsertedOpeningReceiptCount
      projectResults.push({
        projectId,
        status: 'migrated',
        migratedProjectCount: result.migratedProjectCount,
        upsertedOpeningReceiptCount: result.upsertedOpeningReceiptCount,
      })
    } catch (error) {
      failedProjectCount += 1
      projectResults.push({
        projectId,
        status: 'failed',
        error: error?.message || '本地迁移失败',
      })
    }
  }

  return {
    backup,
    projectResults,
    migratedProjectCount,
    failedProjectCount,
    upsertedOpeningReceiptCount,
    projects: parseStoredList(localStorage, PROJECT_STORAGE_KEY),
    receipts: parseStoredList(
      localStorage,
      CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
    ),
  }
}

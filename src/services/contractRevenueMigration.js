import { parseRequiredYen } from '../features/contract-revenue/contractRevenueValidation.js'
import {
  CONTRACT_REVENUE_STORAGE_KEYS,
  sanitizeProjectForPersistence,
} from './contractRevenueService.js'

export const CONTRACT_REVENUE_SCHEMA_VERSION = 1
export const HISTORICAL_MIGRATED_CONFIRMED = 'historical_migrated_confirmed'

const PROJECT_STORAGE_KEY = 'erp.projects'
const OPENING_RECEIPT_ID_PREFIX = 'legacy-opening-receipt-v1:'

function normalizeProjectId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function hasMigratedSchemaVersion(project) {
  const version = Number(project?.contractRevenueSchemaVersion)
  return Number.isInteger(version) && version >= CONTRACT_REVENUE_SCHEMA_VERSION
}

function migrationException({ projectId, projectIndex, code, field, error }) {
  return {
    projectId,
    projectIndex,
    code,
    field,
    message: error?.message || `${field}无效`,
  }
}

function manualReviewWarning(projectId) {
  return {
    projectId,
    code: 'needs_manual_review',
    message: '历史合同按0税率迁移，需会计人工复核',
  }
}

function assertUpsertSucceeded(result, label) {
  if (
    !result ||
    result.skipped === true ||
    Number(result.failed || 0) > 0 ||
    Number(result.saved || 0) < 1
  ) {
    throw new Error(`${label}保存未成功`)
  }
}

export function getLegacyOpeningReceiptId(projectId) {
  const normalizedProjectId = normalizeProjectId(projectId)
  if (!normalizedProjectId) throw new Error('projectId不能为空')
  return `${OPENING_RECEIPT_ID_PREFIX}${normalizedProjectId}`
}

export function previewLegacyContractRevenueMigration({
  projects = [],
  existingReceipts = [],
} = {}) {
  const items = []
  const warnings = []
  const exceptions = []
  const existingReceiptIds = new Set(
    (Array.isArray(existingReceipts) ? existingReceipts : [])
      .map((receipt) => receipt?.receiptId)
      .filter((receiptId) => typeof receiptId === 'string' && receiptId),
  )

  for (const [projectIndex, source] of (Array.isArray(projects) ? projects : []).entries()) {
    const project = source && typeof source === 'object' ? source : {}
    const projectId = normalizeProjectId(project.projectId)

    if (!projectId) {
      exceptions.push(
        migrationException({
          projectId: null,
          projectIndex,
          code: 'missing_project_id',
          field: 'projectId',
          error: new Error('projectId不能为空'),
        }),
      )
      continue
    }

    if (hasMigratedSchemaVersion(project)) {
      warnings.push({
        projectId,
        code: 'already_migrated',
        message: '项目已完成合同收入结构迁移，已跳过',
      })
      continue
    }

    let contractAmount
    try {
      contractAmount = parseRequiredYen(project.contractAmount, 'contractAmount')
    } catch (error) {
      exceptions.push(
        migrationException({
          projectId,
          projectIndex,
          code: 'invalid_contract_amount',
          field: 'contractAmount',
          error,
        }),
      )
      continue
    }

    let paidAmount
    try {
      paidAmount = parseRequiredYen(project.paidAmount, 'paidAmount', { allowZero: true })
    } catch (error) {
      exceptions.push(
        migrationException({
          projectId,
          projectIndex,
          code: 'invalid_paid_amount',
          field: 'paidAmount',
          error,
        }),
      )
      continue
    }

    const receiptId = getLegacyOpeningReceiptId(projectId)
    const openingReceiptAlreadyExists = paidAmount > 0 && existingReceiptIds.has(receiptId)
    const openingReceipt =
      paidAmount > 0 && !openingReceiptAlreadyExists
        ? {
            receiptId,
            projectId,
            receiptType: 'opening_balance',
            taxInclusiveAmount: paidAmount,
            statusCode: 'active',
            sourceCode: 'legacy_contract_migration',
          }
        : null

    if (openingReceipt) existingReceiptIds.add(receiptId)
    if (openingReceiptAlreadyExists) {
      warnings.push({
        projectId,
        code: 'opening_receipt_already_exists',
        message: '确定性期初收款已存在，本次不重复生成',
      })
    }

    const migratedProject = sanitizeProjectForPersistence({
      ...project,
      projectId,
      originalContractTaxExclusiveAmount: contractAmount,
      originalContractTaxRate: 0,
      originalContractTaxAmount: 0,
      originalContractTaxInclusiveAmount: contractAmount,
      contractConfirmationStatus: HISTORICAL_MIGRATED_CONFIRMED,
      needsManualReview: true,
      contractRevenueSchemaVersion: CONTRACT_REVENUE_SCHEMA_VERSION,
    })

    items.push({ project: migratedProject, openingReceipt })
    warnings.push(manualReviewWarning(projectId))
  }

  const openingReceiptCount = items.reduce(
    (total, item) => total + (item.openingReceipt ? 1 : 0),
    0,
  )

  return {
    items,
    migrationProjectCount: items.length,
    openingReceiptCount,
    warnings,
    exceptions,
  }
}

export async function persistLegacyContractRevenueMigration(preview, overrides = {}) {
  if (typeof overrides.migrateLegacyProjectContractSecure === 'function') {
    let migratedProjectCount = 0
    let upsertedOpeningReceiptCount = 0
    for (const item of Array.isArray(preview?.items) ? preview.items : []) {
      const result = await overrides.migrateLegacyProjectContractSecure(
        item?.project?.projectId,
        sanitizeProjectForPersistence(item?.project),
        item?.openingReceipt || null,
      )
      if (result?.error) throw result.error
      migratedProjectCount += 1
      if (item?.openingReceipt) upsertedOpeningReceiptCount += 1
    }
    return { migratedProjectCount, upsertedOpeningReceiptCount }
  }
  const upsertRecord = overrides.upsertRecord
  const items = Array.isArray(preview?.items) ? preview.items : []
  let migratedProjectCount = 0
  let upsertedOpeningReceiptCount = 0

  if (typeof upsertRecord !== 'function') {
    throw new Error('必须配置迁移安全RPC，拒绝本地或通用持久化')
  }

  for (const item of items) {
    if (item?.openingReceipt) {
      const receiptResult = await upsertRecord(
        CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
        item.openingReceipt,
      )
      assertUpsertSucceeded(receiptResult, '期初收款')
      upsertedOpeningReceiptCount += 1
    }

    const project = sanitizeProjectForPersistence({
      ...item?.project,
      contractRevenueSchemaVersion: CONTRACT_REVENUE_SCHEMA_VERSION,
    })
    const projectResult = await upsertRecord(PROJECT_STORAGE_KEY, project)
    assertUpsertSucceeded(projectResult, '项目迁移版本')
    migratedProjectCount += 1
  }

  return {
    migratedProjectCount,
    upsertedOpeningReceiptCount,
  }
}

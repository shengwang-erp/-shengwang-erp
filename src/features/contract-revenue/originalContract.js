import { sanitizeProjectForPersistence } from '../../services/contractRevenueService.js'
import { validateTaxBreakdown } from './contractRevenueValidation.js'

export const CONTRACT_REVENUE_SETUP_NOT_STARTED = 'not_started'
export const CONTRACT_REVENUE_SETUP_CONFIGURED = 'configured'
export const CONTRACT_CONFIRMATION_DRAFT = 'draft'
export const CONTRACT_CONFIRMATION_CONFIRMED = 'confirmed'
export const HISTORICAL_MIGRATED_CONFIRMED = 'historical_migrated_confirmed'

const CONTRACT_REVENUE_SCHEMA_VERSION = 1

export class OriginalContractStateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OriginalContractStateError'
    this.code = code
  }
}

function hasRevenueSchema(project) {
  const version = Number(project?.contractRevenueSchemaVersion)
  return Number.isInteger(version) && version >= CONTRACT_REVENUE_SCHEMA_VERSION
}

function requireProject(project) {
  if (!project || typeof project !== 'object') {
    throw new OriginalContractStateError('project_required', '项目不能为空')
  }
  if (typeof project.projectId !== 'string' || !project.projectId.trim()) {
    throw new OriginalContractStateError('project_required', 'projectId不能为空')
  }
}

function clearConfirmationMetadata(project) {
  const result = { ...project }
  delete result.contractConfirmedById
  delete result.contractConfirmedByName
  delete result.contractConfirmedAt
  return result
}

function originalContractTaxInput(project) {
  return {
    taxExclusiveAmount: project.originalContractTaxExclusiveAmount,
    taxRate: project.originalContractTaxRate,
    taxAmount: project.originalContractTaxAmount,
    taxInclusiveAmount: project.originalContractTaxInclusiveAmount,
  }
}

export function initializeOriginalContractProject(project) {
  requireProject(project)
  return sanitizeProjectForPersistence({
    ...project,
    contractRevenueSetupStatus: CONTRACT_REVENUE_SETUP_NOT_STARTED,
  })
}

export function getOriginalContractMode(project) {
  if (
    !hasRevenueSchema(project) &&
    project?.contractRevenueSetupStatus === CONTRACT_REVENUE_SETUP_NOT_STARTED
  ) {
    return CONTRACT_REVENUE_SETUP_NOT_STARTED
  }

  if (!hasRevenueSchema(project)) return 'legacy_readonly'

  return project?.contractConfirmationStatus === CONTRACT_CONFIRMATION_DRAFT
    ? CONTRACT_CONFIRMATION_DRAFT
    : CONTRACT_CONFIRMATION_CONFIRMED
}

export function saveOriginalContractDraft(project, input) {
  requireProject(project)
  const mode = getOriginalContractMode(project)

  if (mode === CONTRACT_CONFIRMATION_CONFIRMED) {
    throw new OriginalContractStateError(
      'original_contract_locked',
      '原始合同已确认，不能直接修改',
    )
  }
  if (mode === 'legacy_readonly') {
    throw new OriginalContractStateError(
      'legacy_migration_required',
      '需要迁移后复核',
    )
  }

  const amounts = validateTaxBreakdown(input)
  const draft = clearConfirmationMetadata({
    ...project,
    contractRevenueSchemaVersion: CONTRACT_REVENUE_SCHEMA_VERSION,
    contractRevenueSetupStatus: CONTRACT_REVENUE_SETUP_CONFIGURED,
    contractConfirmationStatus: CONTRACT_CONFIRMATION_DRAFT,
    originalContractTaxExclusiveAmount: amounts.taxExclusiveAmount,
    originalContractTaxRate: amounts.taxRate,
    originalContractTaxAmount: amounts.taxAmount,
    originalContractTaxInclusiveAmount: amounts.taxInclusiveAmount,
    needsManualReview: false,
  })

  return sanitizeProjectForPersistence(draft)
}

export function confirmOriginalContract(project, actor, confirmedAt) {
  requireProject(project)
  if (getOriginalContractMode(project) !== CONTRACT_CONFIRMATION_DRAFT) {
    throw new OriginalContractStateError(
      'original_contract_draft_required',
      '必须先保存原始合同草稿',
    )
  }

  const employeeId =
    typeof actor?.employeeId === 'string' && actor.employeeId.trim()
      ? actor.employeeId.trim()
      : ''
  const employeeName =
    typeof actor?.name === 'string' && actor.name.trim() ? actor.name.trim() : ''
  if (!employeeId || !employeeName) {
    throw new OriginalContractStateError(
      'confirmation_actor_required',
      '会计确认人不能为空',
    )
  }
  if (typeof confirmedAt !== 'string' || !confirmedAt.trim()) {
    throw new OriginalContractStateError(
      'confirmation_time_required',
      '会计确认时间不能为空',
    )
  }

  const amounts = validateTaxBreakdown(originalContractTaxInput(project))
  return sanitizeProjectForPersistence({
    ...project,
    contractRevenueSetupStatus: CONTRACT_REVENUE_SETUP_CONFIGURED,
    contractConfirmationStatus: CONTRACT_CONFIRMATION_CONFIRMED,
    originalContractTaxExclusiveAmount: amounts.taxExclusiveAmount,
    originalContractTaxRate: amounts.taxRate,
    originalContractTaxAmount: amounts.taxAmount,
    originalContractTaxInclusiveAmount: amounts.taxInclusiveAmount,
    contractConfirmedById: employeeId,
    contractConfirmedByName: employeeName,
    contractConfirmedAt: confirmedAt.trim(),
  })
}

import { sanitizeProjectForPersistence } from '../../services/contractRevenueService.js'
import {
  ContractRevenueValidationError,
  parseRequiredRate,
  parseRequiredYen,
  validateTaxBreakdown,
} from './contractRevenueValidation.js'

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

function originalContractTaxInput(project) {
  return {
    taxExclusiveAmount: project.originalContractTaxExclusiveAmount,
    taxRate: project.originalContractTaxRate,
    taxAmount: project.originalContractTaxAmount,
    taxInclusiveAmount: project.originalContractTaxInclusiveAmount,
  }
}

export function calculateOriginalContractAmounts(taxInclusiveAmount, taxRate) {
  const inclusive = parseRequiredYen(
    taxInclusiveAmount,
    'taxInclusiveAmount',
  )
  if (!Number.isSafeInteger(inclusive)) {
    throw new ContractRevenueValidationError(
      'taxInclusiveAmount',
      '含税总金额必须是安全范围内的整数日元',
    )
  }
  const rate = parseRequiredRate(taxRate, 'taxRate')
  const exclusive = Math.round(inclusive / (1 + rate / 100))
  const tax = inclusive - exclusive
  if (!Number.isSafeInteger(exclusive) || exclusive <= 0 || !Number.isSafeInteger(tax)) {
    throw new ContractRevenueValidationError(
      'taxInclusiveAmount',
      '含税总金额无法计算为有效的整数日元',
    )
  }
  return {
    taxExclusiveAmount: exclusive,
    taxRate: rate,
    taxAmount: tax,
    taxInclusiveAmount: inclusive,
  }
}

export function isOriginalContractSaved(project) {
  const schemaVersion = Number(project?.contractRevenueSchemaVersion)
  if (
    typeof project?.projectId !== 'string' ||
    !project.projectId.trim() ||
    !Number.isInteger(schemaVersion) ||
    schemaVersion < CONTRACT_REVENUE_SCHEMA_VERSION ||
    project?.contractRevenueSetupStatus !== CONTRACT_REVENUE_SETUP_CONFIGURED
  ) {
    return false
  }
  try {
    const amounts = validateTaxBreakdown(originalContractTaxInput(project))
    const areSafeIntegers = [
      amounts.taxExclusiveAmount,
      amounts.taxAmount,
      amounts.taxInclusiveAmount,
    ].every(Number.isSafeInteger)
    if (!areSafeIntegers) return false
    const calculated = calculateOriginalContractAmounts(
      amounts.taxInclusiveAmount,
      amounts.taxRate,
    )
    return Math.abs(calculated.taxExclusiveAmount - amounts.taxExclusiveAmount) <= 1 &&
      Math.abs(calculated.taxAmount - amounts.taxAmount) <= 1
  } catch {
    return false
  }
}

export function getOriginalContractRoundingWarning(project) {
  if (!isOriginalContractSaved(project)) return ''
  try {
    const calculated = calculateOriginalContractAmounts(
      project.originalContractTaxInclusiveAmount,
      project.originalContractTaxRate,
    )
    const exclusiveDifference = Math.abs(
      calculated.taxExclusiveAmount - project.originalContractTaxExclusiveAmount,
    )
    const taxDifference = Math.abs(calculated.taxAmount - project.originalContractTaxAmount)
    return exclusiveDifference === 1 && taxDifference === 1
      ? '合同原金额与当前自动计算结果相差1日元，请核对原件采用的取整规则。'
      : ''
  } catch {
    return ''
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

export function saveOriginalContract(project, input) {
  requireProject(project)
  const mode = getOriginalContractMode(project)
  if (mode === CONTRACT_CONFIRMATION_CONFIRMED) {
    throw new OriginalContractStateError(
      'original_contract_locked',
      '原始合同已锁定，不能直接修改',
    )
  }
  if (mode === 'legacy_readonly') {
    throw new OriginalContractStateError(
      'legacy_migration_required',
      '需要完成历史合同迁移',
    )
  }

  const amounts = calculateOriginalContractAmounts(
    input?.taxInclusiveAmount,
    input?.taxRate,
  )
  return sanitizeProjectForPersistence({
    ...project,
    contractRevenueSchemaVersion: CONTRACT_REVENUE_SCHEMA_VERSION,
    contractRevenueSetupStatus: CONTRACT_REVENUE_SETUP_CONFIGURED,
    contractConfirmationStatus:
      project.contractConfirmationStatus || CONTRACT_CONFIRMATION_DRAFT,
    originalContractTaxExclusiveAmount: amounts.taxExclusiveAmount,
    originalContractTaxRate: amounts.taxRate,
    originalContractTaxAmount: amounts.taxAmount,
    originalContractTaxInclusiveAmount: amounts.taxInclusiveAmount,
    needsManualReview: false,
  })
}

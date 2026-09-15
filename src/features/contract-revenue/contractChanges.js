import { calculateAdjustedContractTotals } from './contractRevenueCalculations.js'
import {
  ContractRevenueValidationError,
  parseRequiredYen,
  validateTaxBreakdown,
} from './contractRevenueValidation.js'
import { isOriginalContractSaved } from './originalContract.js'

export class ContractChangeStateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ContractChangeStateError'
    this.code = code
  }
}

function requireProjectId(project) {
  const projectId =
    typeof project?.projectId === 'string' ? project.projectId.trim() : ''
  if (!projectId) {
    throw new ContractRevenueValidationError('projectId', 'projectId不能为空')
  }
  return projectId
}

function requireSavedProject(project) {
  const projectId = requireProjectId(project)
  const schemaVersion = Number(project?.contractRevenueSchemaVersion)

  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new ContractChangeStateError('legacy_migration_required', '需要完成历史合同迁移')
  }
  if (!isOriginalContractSaved(project)) {
    throw new ContractChangeStateError(
      'original_contract_save_required',
      '请先完整保存原始合同后再新增增减项',
    )
  }

  return projectId
}

export function canCreateContractChange(project) {
  return isOriginalContractSaved(project)
}

function normalizeChangeType(value) {
  if (value !== 'increase' && value !== 'decrease') {
    throw new ContractRevenueValidationError(
      'changeType',
      'changeType必须是increase或decrease',
    )
  }
  return value
}

function normalizeRequiredText(value, field, message) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    throw new ContractRevenueValidationError(field, message)
  }
  return normalized
}

function normalizeEffectiveDate(value) {
  const effectiveDate = normalizeRequiredText(
    value,
    'effectiveDate',
    '生效日期不能为空',
  )
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new ContractRevenueValidationError(
      'effectiveDate',
      '生效日期必须是有效日期',
    )
  }

  const parsedDate = new Date(`${effectiveDate}T00:00:00.000Z`)
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== effectiveDate
  ) {
    throw new ContractRevenueValidationError(
      'effectiveDate',
      '生效日期必须是有效日期',
    )
  }
  return effectiveDate
}

function normalizeActor(actor, fieldPrefix) {
  const employeeId = normalizeRequiredText(
    actor?.employeeId,
    `${fieldPrefix}Id`,
    '当前操作人ID不能为空',
  )
  const employeeName = normalizeRequiredText(
    actor?.name,
    `${fieldPrefix}Name`,
    '当前操作人姓名不能为空',
  )
  return {
    [`${fieldPrefix}Id`]: employeeId,
    [`${fieldPrefix}Name`]: employeeName,
  }
}

function normalizePositiveTaxBreakdown(input) {
  parseRequiredYen(input?.taxAmount, 'taxAmount')
  const amounts = validateTaxBreakdown(input)
  return amounts
}

function projectChanges(changes, projectId) {
  return (Array.isArray(changes) ? changes : []).filter(
    (change) => change?.projectId === projectId,
  )
}

function isActiveChange(change) {
  return change?.statusCode !== 'void' && change?.statusCode !== 'deleted'
}

function assertPositiveAdjustedTotals(totals) {
  if (totals.adjustedTaxExclusiveAmount <= 0) {
    throw new ContractRevenueValidationError(
      'adjustedTaxExclusiveAmount',
      '调整后税抜合同金额必须大于0',
    )
  }
  if (totals.adjustedTaxInclusiveAmount <= 0) {
    throw new ContractRevenueValidationError(
      'adjustedTaxInclusiveAmount',
      '调整后税込合同金额必须大于0',
    )
  }
  if (
    totals.adjustedTaxInclusiveAmount !==
    totals.adjustedTaxExclusiveAmount + totals.adjustedTaxAmount
  ) {
    throw new ContractRevenueValidationError(
      'adjustedTaxInclusiveAmount',
      '调整后税込合同金额必须等于调整后税抜金额与税额之和',
    )
  }
}

export function prepareContractChangeInput(project, changes, input, actor) {
  const projectId = requireSavedProject(project)
  const changeType = normalizeChangeType(input?.changeType)
  const amounts = normalizePositiveTaxBreakdown(input || {})
  const candidate = {
    projectId,
    changeType,
    ...amounts,
    effectiveDate: normalizeEffectiveDate(input?.effectiveDate),
    reason: normalizeRequiredText(input?.reason, 'reason', '增减项原因不能为空'),
    ...normalizeActor(actor, 'createdBy'),
  }

  calculateAdjustedContractTotals(project, [
    ...projectChanges(changes, projectId),
    candidate,
  ])

  return candidate
}

export function prepareContractChangeVoid(
  project,
  changes,
  targetChange,
  actor,
  reason,
) {
  const projectId = requireSavedProject(project)
  const changeId = normalizeRequiredText(
    targetChange?.changeId,
    'changeId',
    'changeId不能为空',
  )
  const matchingChanges = projectChanges(changes, projectId)
  const storedChange = matchingChanges.find((change) => change?.changeId === changeId)

  if (!storedChange) {
    throw new ContractChangeStateError('change_not_found', '未找到需要作废的增减项')
  }
  if (!isActiveChange(storedChange)) {
    throw new ContractChangeStateError('change_already_void', '该增减项已经作废')
  }

  const voidReason = normalizeRequiredText(reason, 'voidReason', '作废原因不能为空')
  const actorFields = normalizeActor(actor, 'voidedBy')
  const nextChanges = matchingChanges.map((change) =>
    change.changeId === changeId ? { ...change, statusCode: 'void' } : change,
  )

  calculateAdjustedContractTotals(project, nextChanges)

  return {
    voidReason,
    ...actorFields,
  }
}

function compareChanges(left, right) {
  return (
    String(left?.effectiveDate || '').localeCompare(String(right?.effectiveDate || '')) ||
    String(left?.createdAt || '').localeCompare(String(right?.createdAt || '')) ||
    String(left?.changeId || '').localeCompare(String(right?.changeId || ''))
  )
}

export function buildContractChangeRunningBalances(project, changes = []) {
  const projectId = requireProjectId(project)
  const originalTotals = calculateAdjustedContractTotals(project, [])
  const runningTotals = { ...originalTotals }
  const orderedChanges = [...projectChanges(changes, projectId)].sort(compareChanges)

  return orderedChanges.map((change) => {
    const changeType = normalizeChangeType(change?.changeType)
    const amounts = normalizePositiveTaxBreakdown(change || {})
    const effectiveDate = normalizeEffectiveDate(change?.effectiveDate)

    if (isActiveChange(change)) {
      const direction = changeType === 'increase' ? 1 : -1
      runningTotals.adjustedTaxExclusiveAmount +=
        direction * amounts.taxExclusiveAmount
      runningTotals.adjustedTaxAmount += direction * amounts.taxAmount
      runningTotals.adjustedTaxInclusiveAmount +=
        direction * amounts.taxInclusiveAmount
      assertPositiveAdjustedTotals(runningTotals)
    }

    return {
      ...change,
      ...amounts,
      changeType,
      effectiveDate,
      runningTaxExclusiveAmount: runningTotals.adjustedTaxExclusiveAmount,
      runningTaxAmount: runningTotals.adjustedTaxAmount,
      runningTaxInclusiveAmount: runningTotals.adjustedTaxInclusiveAmount,
    }
  })
}

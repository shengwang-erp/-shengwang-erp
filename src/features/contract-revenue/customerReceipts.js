import {
  PAYMENT_STAGES,
  calculateReceiptSummary,
} from './contractRevenueCalculations.js'
import {
  ContractRevenueValidationError,
  parseRequiredYen,
} from './contractRevenueValidation.js'
import {
  CONTRACT_CONFIRMATION_CONFIRMED,
  HISTORICAL_MIGRATED_CONFIRMED,
} from './originalContract.js'

export const CUSTOMER_RECEIPT_STAGES = Object.freeze([
  ...PAYMENT_STAGES,
  'unallocated',
])

export const CUSTOMER_RECEIPT_STAGE_LABELS = Object.freeze({
  initial: '首期款',
  middle: '中期款',
  final: '尾款',
  unallocated: '未分配',
})

const CONFIRMED_STATUSES = new Set([
  CONTRACT_CONFIRMATION_CONFIRMED,
  HISTORICAL_MIGRATED_CONFIRMED,
])

export class CustomerReceiptStateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CustomerReceiptStateError'
    this.code = code
  }
}

function isActiveRecord(record) {
  return record?.statusCode !== 'void' && record?.statusCode !== 'deleted'
}

function normalizeRequiredText(value, field, message) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) {
    throw new ContractRevenueValidationError(field, message)
  }
  return normalized
}

function normalizeOptionalText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function requireProjectId(project) {
  return normalizeRequiredText(
    project?.projectId,
    'projectId',
    'projectId不能为空',
  )
}

export function canManageCustomerReceipts(project) {
  const schemaVersion = Number(project?.contractRevenueSchemaVersion)
  return (
    typeof project?.projectId === 'string' &&
    Boolean(project.projectId.trim()) &&
    Number.isInteger(schemaVersion) &&
    schemaVersion >= 1 &&
    CONFIRMED_STATUSES.has(project?.contractConfirmationStatus)
  )
}

function requireConfirmedProject(project) {
  const projectId = requireProjectId(project)
  const schemaVersion = Number(project?.contractRevenueSchemaVersion)

  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new CustomerReceiptStateError(
      'legacy_migration_required',
      '需要迁移后复核',
    )
  }
  if (!CONFIRMED_STATUSES.has(project?.contractConfirmationStatus)) {
    throw new CustomerReceiptStateError(
      'original_contract_confirmation_required',
      '原始合同完成会计确认后才能登记实际收款',
    )
  }
  return projectId
}

function normalizeReceiptStage(value) {
  if (!CUSTOMER_RECEIPT_STAGES.includes(value)) {
    throw new ContractRevenueValidationError(
      'stage',
      '收款阶段必须是首期款、中期款、尾款或未分配',
    )
  }
  return value
}

function stageForStoredReceipt(receipt) {
  return CUSTOMER_RECEIPT_STAGES.includes(receipt?.stage)
    ? receipt.stage
    : 'unallocated'
}

function normalizeReceivedDate(value) {
  const receivedDate = normalizeRequiredText(
    value,
    'receivedDate',
    '到账日期不能为空',
  )
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) {
    throw new ContractRevenueValidationError(
      'receivedDate',
      '到账日期必须是有效日期',
    )
  }

  const parsedDate = new Date(`${receivedDate}T00:00:00.000Z`)
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== receivedDate
  ) {
    throw new ContractRevenueValidationError(
      'receivedDate',
      '到账日期必须是有效日期',
    )
  }
  return receivedDate
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

function projectRecords(records, projectId) {
  return (Array.isArray(records) ? records : []).filter(
    (record) => record?.projectId === projectId,
  )
}

function findActiveStagePlan(paymentPlans, projectId, stage) {
  const matchingPlans = projectRecords(paymentPlans, projectId).filter(
    (plan) => plan?.stage === stage && isActiveRecord(plan),
  )
  if (matchingPlans.length === 0) {
    throw new CustomerReceiptStateError(
      'payment_plan_required',
      `${CUSTOMER_RECEIPT_STAGE_LABELS[stage]}尚未设置有效收款计划，请先建立计划或选择未分配`,
    )
  }
  if (matchingPlans.length > 1) {
    throw new CustomerReceiptStateError(
      'payment_plan_conflict',
      `${CUSTOMER_RECEIPT_STAGE_LABELS[stage]}存在多条有效收款计划，需要会计处理`,
    )
  }

  const planId = normalizeRequiredText(
    matchingPlans[0]?.planId,
    'planId',
    '计划ID不能为空',
  )
  return { ...matchingPlans[0], planId }
}

export function prepareCustomerReceiptInput(
  project,
  paymentPlans,
  input,
  actor,
) {
  const projectId = requireConfirmedProject(project)
  const stage = normalizeReceiptStage(input?.stage)
  const plan =
    stage === 'unallocated'
      ? null
      : findActiveStagePlan(paymentPlans, projectId, stage)

  return {
    projectId,
    planId: plan?.planId || null,
    stage,
    taxInclusiveAmount: parseRequiredYen(
      input?.taxInclusiveAmount,
      'taxInclusiveAmount',
    ),
    receivedDate: normalizeReceivedDate(input?.receivedDate),
    paymentMethod: normalizeRequiredText(
      input?.paymentMethod,
      'paymentMethod',
      '支付方式不能为空',
    ),
    bankReference: normalizeOptionalText(input?.bankReference),
    remark: normalizeOptionalText(input?.remark),
    ...normalizeActor(actor, 'createdBy'),
  }
}

export function prepareCustomerReceiptVoid(
  project,
  receipts,
  targetReceipt,
  actor,
  reason,
) {
  const projectId = requireConfirmedProject(project)
  const receiptId = normalizeRequiredText(
    targetReceipt?.receiptId,
    'receiptId',
    'receiptId不能为空',
  )
  const storedReceipt = projectRecords(receipts, projectId).find(
    (receipt) => receipt?.receiptId === receiptId,
  )

  if (!storedReceipt) {
    throw new CustomerReceiptStateError(
      'receipt_not_found',
      '未找到需要作废的实际收款流水',
    )
  }
  if (!isActiveRecord(storedReceipt)) {
    throw new CustomerReceiptStateError(
      'receipt_already_void',
      '该实际收款流水已经作废',
    )
  }

  return {
    voidReason: normalizeRequiredText(
      reason,
      'voidReason',
      '作废原因不能为空',
    ),
    ...normalizeActor(actor, 'voidedBy'),
  }
}

function normalizeStoredReceipt(receipt) {
  return {
    ...receipt,
    stage: stageForStoredReceipt(receipt),
    taxInclusiveAmount: parseRequiredYen(
      receipt?.taxInclusiveAmount,
      `${receipt?.receiptId || 'receipt'}.taxInclusiveAmount`,
    ),
  }
}

function compareReceiptRows(left, right) {
  const dateOrder = String(right?.receivedDate || '').localeCompare(
    String(left?.receivedDate || ''),
  )
  if (dateOrder !== 0) return dateOrder

  const createdOrder = String(right?.createdAt || '').localeCompare(
    String(left?.createdAt || ''),
  )
  if (createdOrder !== 0) return createdOrder

  const leftVoid = isActiveRecord(left) ? 0 : 1
  const rightVoid = isActiveRecord(right) ? 0 : 1
  if (leftVoid !== rightVoid) return leftVoid - rightVoid

  return String(left?.receiptId || '').localeCompare(String(right?.receiptId || ''))
}

function activePlansByStage(paymentPlans, projectId) {
  const result = new Map()
  for (const plan of projectRecords(paymentPlans, projectId)) {
    if (!isActiveRecord(plan) || !PAYMENT_STAGES.includes(plan?.stage)) continue
    if (!result.has(plan.stage)) result.set(plan.stage, plan)
  }
  return result
}

function plannedStageStatus(plan, receivedAmount) {
  if (!plan) return '未设置计划'
  const plannedAmount = plan.plannedTaxInclusiveAmount
  if (receivedAmount === 0) return '未到账'
  if (receivedAmount > plannedAmount) return '超额到账'
  if (receivedAmount === plannedAmount) return '已到账'
  return '部分到账'
}

export function buildCustomerReceiptViewModel({
  project,
  adjustedTaxInclusiveAmount,
  paymentPlans = [],
  receipts = [],
}) {
  const projectId = requireProjectId(project)
  const receiptRows = projectRecords(receipts, projectId)
    .map(normalizeStoredReceipt)
    .sort(compareReceiptRows)
  const activeReceipts = receiptRows.filter(isActiveRecord)
  const planMap = activePlansByStage(paymentPlans, projectId)
  const stageSummaries = PAYMENT_STAGES.map((stage) => {
    const plan = planMap.get(stage)
    const plannedTaxInclusiveAmount = plan
      ? parseRequiredYen(
          plan.plannedTaxInclusiveAmount,
          `${stage}.plannedTaxInclusiveAmount`,
          { allowZero: true },
        )
      : 0
    const stageReceipts = activeReceipts.filter(
      (receipt) => receipt.stage === stage,
    )
    const receivedTaxInclusiveAmount = stageReceipts.reduce(
      (total, receipt) => total + receipt.taxInclusiveAmount,
      0,
    )

    return {
      stage,
      label: CUSTOMER_RECEIPT_STAGE_LABELS[stage],
      planId: plan?.planId || null,
      hasPlan: Boolean(plan),
      plannedTaxInclusiveAmount,
      receivedTaxInclusiveAmount,
      remainingTaxInclusiveAmount: Math.max(
        plannedTaxInclusiveAmount - receivedTaxInclusiveAmount,
        0,
      ),
      overpaidTaxInclusiveAmount: Math.max(
        receivedTaxInclusiveAmount - plannedTaxInclusiveAmount,
        0,
      ),
      status: plannedStageStatus(
        plan
          ? { ...plan, plannedTaxInclusiveAmount }
          : null,
        receivedTaxInclusiveAmount,
      ),
      locked: stageReceipts.length > 0,
      activeReceiptCount: stageReceipts.length,
    }
  })

  const unallocatedReceipts = activeReceipts.filter(
    (receipt) => receipt.stage === 'unallocated',
  )
  const unallocatedReceivedTaxInclusiveAmount = unallocatedReceipts.reduce(
    (total, receipt) => total + receipt.taxInclusiveAmount,
    0,
  )
  stageSummaries.push({
    stage: 'unallocated',
    label: CUSTOMER_RECEIPT_STAGE_LABELS.unallocated,
    planId: null,
    hasPlan: false,
    plannedTaxInclusiveAmount: null,
    receivedTaxInclusiveAmount: unallocatedReceivedTaxInclusiveAmount,
    remainingTaxInclusiveAmount: null,
    overpaidTaxInclusiveAmount: 0,
    status:
      unallocatedReceivedTaxInclusiveAmount > 0 ? '待分配' : '无未分配收款',
    locked: false,
    activeReceiptCount: unallocatedReceipts.length,
  })

  const receiptSummary = calculateReceiptSummary(
    adjustedTaxInclusiveAmount,
    activeReceipts,
  )
  const lockedStages = stageSummaries
    .filter((summary) => summary.stage !== 'unallocated' && summary.locked)
    .map((summary) => summary.stage)

  return {
    projectId,
    adjustedTaxInclusiveAmount: parseRequiredYen(
      adjustedTaxInclusiveAmount,
      'adjustedTaxInclusiveAmount',
    ),
    ...receiptSummary,
    stageSummaries,
    receiptRows,
    lockedStages,
    unallocatedReceivedTaxInclusiveAmount,
    activeReceiptCount: activeReceipts.length,
    hasStageOverpayment: stageSummaries.some(
      (summary) => summary.overpaidTaxInclusiveAmount > 0,
    ),
    hasContractOverpayment: receiptSummary.overpaidTaxInclusiveAmount > 0,
  }
}

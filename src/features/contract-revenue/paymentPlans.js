import {
  PAYMENT_STAGES,
  reallocateUnpaidPaymentStages,
  validateManualPaymentPlanAllocation,
} from './contractRevenueCalculations.js'
import {
  ContractRevenueValidationError,
  parseRequiredRate,
  parseRequiredYen,
} from './contractRevenueValidation.js'
import {
  CONTRACT_CONFIRMATION_CONFIRMED,
  HISTORICAL_MIGRATED_CONFIRMED,
} from './originalContract.js'

export const PAYMENT_STAGE_LABELS = Object.freeze({
  initial: '首期款',
  middle: '中期款',
  final: '尾款',
})

const DEFAULT_WEIGHTS = Object.freeze({
  initial: 30,
  middle: 40,
  final: 30,
})

const CONFIRMED_STATUSES = new Set([
  CONTRACT_CONFIRMATION_CONFIRMED,
  HISTORICAL_MIGRATED_CONFIRMED,
])

export class PaymentPlanStateError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PaymentPlanStateError'
    this.code = code
  }
}

function isActiveRecord(record) {
  return record?.statusCode !== 'void' && record?.statusCode !== 'deleted'
}

function requireProjectId(project) {
  const projectId =
    typeof project?.projectId === 'string' ? project.projectId.trim() : ''
  if (!projectId) {
    throw new ContractRevenueValidationError('projectId', 'projectId不能为空')
  }
  return projectId
}

export function canManagePaymentPlans(project) {
  const schemaVersion = Number(project?.contractRevenueSchemaVersion)
  return (
    typeof project?.projectId === 'string' &&
    Boolean(project.projectId.trim()) &&
    Number.isInteger(schemaVersion) &&
    schemaVersion >= 1 &&
    CONFIRMED_STATUSES.has(project?.contractConfirmationStatus)
  )
}

function requireManageableProject(project) {
  const projectId = requireProjectId(project)
  if (!canManagePaymentPlans(project)) {
    const schemaVersion = Number(project?.contractRevenueSchemaVersion)
    const isLegacy = !Number.isInteger(schemaVersion) || schemaVersion < 1
    throw new PaymentPlanStateError(
      isLegacy ? 'legacy_migration_required' : 'original_contract_confirmation_required',
      isLegacy
        ? '需要迁移后复核'
        : '原始合同完成会计确认后才能设置收款计划',
    )
  }
  return projectId
}

function filterProjectRecords(records, projectId) {
  return (Array.isArray(records) ? records : []).filter(
    (record) => record?.projectId === projectId && isActiveRecord(record),
  )
}

function normalizeDueDate(value, stage) {
  const dueDate = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ContractRevenueValidationError(
      `${stage}.dueDate`,
      `${PAYMENT_STAGE_LABELS[stage]}约定日期必须是有效日期`,
    )
  }

  const parsedDate = new Date(`${dueDate}T00:00:00.000Z`)
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== dueDate
  ) {
    throw new ContractRevenueValidationError(
      `${stage}.dueDate`,
      `${PAYMENT_STAGE_LABELS[stage]}约定日期必须是有效日期`,
    )
  }
  return dueDate
}

function normalizeActor(actor, prefix) {
  const employeeId =
    typeof actor?.employeeId === 'string' ? actor.employeeId.trim() : ''
  const employeeName = typeof actor?.name === 'string' ? actor.name.trim() : ''
  if (!employeeId) {
    throw new ContractRevenueValidationError(
      `${prefix}Id`,
      '当前操作人ID不能为空',
    )
  }
  if (!employeeName) {
    throw new ContractRevenueValidationError(
      `${prefix}Name`,
      '当前操作人姓名不能为空',
    )
  }
  return {
    [`${prefix}Id`]: employeeId,
    [`${prefix}Name`]: employeeName,
  }
}

function assertFixedStageStructure(plans) {
  if (!Array.isArray(plans) || plans.length !== PAYMENT_STAGES.length) {
    throw new ContractRevenueValidationError(
      'paymentPlans',
      '首期、中期、尾款计划必须各有一条记录',
    )
  }

  const stages = plans.map((plan) => plan?.stage)
  if (
    new Set(stages).size !== PAYMENT_STAGES.length ||
    PAYMENT_STAGES.some((stage) => !stages.includes(stage))
  ) {
    throw new ContractRevenueValidationError(
      'paymentPlans',
      '首期、中期、尾款阶段必须固定且不能重复',
    )
  }
}

function normalizeProposedPlans(projectId, plans) {
  assertFixedStageStructure(plans)
  const normalized = plans.map((plan) => {
    const stage = plan.stage
    return {
      ...(typeof plan.planId === 'string' && plan.planId.trim()
        ? { planId: plan.planId.trim() }
        : {}),
      projectId,
      stage,
      allocationWeight: parseRequiredRate(
        plan.allocationWeight,
        `${stage}.allocationWeight`,
      ),
      plannedTaxInclusiveAmount: parseRequiredYen(
        plan.plannedTaxInclusiveAmount,
        `${stage}.plannedTaxInclusiveAmount`,
        { allowZero: true },
      ),
      dueDate: normalizeDueDate(plan.dueDate, stage),
      remark: typeof plan.remark === 'string' ? plan.remark.trim() : '',
    }
  })

  return PAYMENT_STAGES.map((stage) =>
    normalized.find((plan) => plan.stage === stage),
  )
}

function assertWeightTotal(plans) {
  const totalWeight = plans.reduce(
    (total, plan) => total + plan.allocationWeight,
    0,
  )
  if (Math.abs(totalWeight - 100) > 1e-9) {
    throw new ContractRevenueValidationError(
      'allocationWeightTotal',
      '首期、中期、尾款分配比例合计必须等于100%',
    )
  }
}

export function calculatePaymentPlanAmountPreview(
  adjustedTaxInclusiveAmount,
  plans,
) {
  assertFixedStageStructure(plans)
  const normalized = PAYMENT_STAGES.map((stage) => {
    const plan = plans.find((item) => item.stage === stage)
    return {
      stage,
      allocationWeight: parseRequiredRate(
        plan.allocationWeight,
        `${stage}.allocationWeight`,
      ),
    }
  })
  assertWeightTotal(normalized)
  const allocated = allocateByWeights(adjustedTaxInclusiveAmount, normalized)
  return Object.fromEntries(
    allocated.map((plan) => [plan.stage, plan.plannedTaxInclusiveAmount]),
  )
}

function allocateByWeights(adjustedTaxInclusiveAmount, plans) {
  const allocation = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount,
    plans: plans.map((plan) => ({
      ...plan,
      plannedTaxInclusiveAmount: 0,
      statusCode: 'active',
    })),
    receipts: [],
  })

  if (allocation.allocationStatus !== 'auto_allocated') {
    throw new PaymentPlanStateError(
      'initial_allocation_failed',
      '首次收款计划无法按比例自动分配',
    )
  }

  return allocation.plans.map((plan) => ({
    ...plan,
    plannedTaxInclusiveAmount: parseRequiredYen(
      plan.plannedTaxInclusiveAmount,
      `${plan.stage}.plannedTaxInclusiveAmount`,
      { allowZero: true },
    ),
  }))
}

function defaultEditorPlans(adjustedTaxInclusiveAmount, projectId) {
  const plans = PAYMENT_STAGES.map((stage) => ({
    projectId,
    stage,
    allocationWeight: DEFAULT_WEIGHTS[stage],
    plannedTaxInclusiveAmount: 0,
    dueDate: '',
    remark: '',
    statusCode: 'active',
  }))
  return allocateByWeights(adjustedTaxInclusiveAmount, plans).map((plan) => ({
    ...plan,
    locked: false,
  }))
}

function sortPlans(plans) {
  return PAYMENT_STAGES.map((stage) =>
    plans.find((plan) => plan?.stage === stage),
  ).filter(Boolean)
}

function hasAmountChanges(currentPlans, allocatedPlans) {
  return PAYMENT_STAGES.some((stage) => {
    const current = currentPlans.find((plan) => plan.stage === stage)
    const allocated = allocatedPlans.find((plan) => plan.stage === stage)
    return (
      current?.plannedTaxInclusiveAmount !==
      allocated?.plannedTaxInclusiveAmount
    )
  })
}

export function buildPaymentPlanEditorState({
  project,
  adjustedTaxInclusiveAmount,
  paymentPlans = [],
  receipts = [],
}) {
  const projectId = requireProjectId(project)
  const currentPlans = filterProjectRecords(paymentPlans, projectId)
  const projectReceipts = filterProjectRecords(receipts, projectId)

  if (currentPlans.length === 0) {
    return {
      mode: 'initial',
      plans: defaultEditorPlans(adjustedTaxInclusiveAmount, projectId),
      allocationStatus: 'not_configured',
      allocationReason: null,
      lockedStages: [],
      unlockedStages: [...PAYMENT_STAGES],
      needsAccountingAction: false,
      hasPendingReallocation: false,
    }
  }

  const allocation = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount,
    plans: currentPlans,
    receipts: projectReceipts,
  })
  const displayPlans =
    allocation.allocationStatus === 'auto_allocated'
      ? allocation.plans
      : currentPlans
  const lockedSet = new Set(allocation.lockedStages)

  return {
    mode:
      allocation.allocationStatus === 'manual_review_required'
        ? 'manual'
        : 'automatic',
    plans: sortPlans(displayPlans).map((plan) => ({
      ...plan,
      dueDate: plan.dueDate || '',
      remark: plan.remark || '',
      locked: lockedSet.has(plan.stage),
    })),
    allocationStatus: allocation.allocationStatus,
    allocationReason: allocation.allocationReason,
    lockedStages: allocation.lockedStages,
    unlockedStages: allocation.unlockedStages,
    needsAccountingAction:
      allocation.allocationStatus === 'manual_review_required',
    hasPendingReallocation:
      allocation.allocationStatus === 'auto_allocated' &&
      hasAmountChanges(currentPlans, allocation.plans),
    unallocatedTaxInclusiveAmount: allocation.unallocatedTaxInclusiveAmount,
    lockedAmountExcess: allocation.lockedAmountExcess,
  }
}

function assertExistingStageIdentity(currentPlans, proposedPlans) {
  for (const current of currentPlans) {
    const proposed = proposedPlans.find((plan) => plan?.planId === current.planId)
    if (!proposed) {
      throw new ContractRevenueValidationError(
        `${current.stage}.planId`,
        `${PAYMENT_STAGE_LABELS[current.stage]}计划记录不能为空`,
      )
    }
    if (proposed.stage !== current.stage) {
      throw new ContractRevenueValidationError(
        `${current.stage}.stage`,
        '收款阶段类型不能修改',
      )
    }
  }
}

function assertLockedFields(currentPlans, proposedPlans, lockedStages) {
  for (const stage of lockedStages) {
    const current = currentPlans.find((plan) => plan.stage === stage)
    const proposed = proposedPlans.find((plan) => plan.planId === current?.planId)
    const proposedAmount = parseRequiredYen(
      proposed?.plannedTaxInclusiveAmount,
      `${stage}.plannedTaxInclusiveAmount`,
      { allowZero: true },
    )
    const currentAmount = parseRequiredYen(
      current?.plannedTaxInclusiveAmount,
      `${stage}.plannedTaxInclusiveAmount`,
      { allowZero: true },
    )
    if (proposedAmount !== currentAmount) {
      throw new ContractRevenueValidationError(
        `${stage}.plannedTaxInclusiveAmount`,
        '已有实际收款的阶段金额不能修改',
      )
    }

    const proposedWeight = parseRequiredRate(
      proposed?.allocationWeight,
      `${stage}.allocationWeight`,
    )
    const currentWeight = parseRequiredRate(
      current?.allocationWeight,
      `${stage}.allocationWeight`,
    )
    if (proposedWeight !== currentWeight) {
      throw new ContractRevenueValidationError(
        `${stage}.allocationWeight`,
        '已有实际收款的阶段比例不能修改',
      )
    }
  }
}

function mergeUpdatedPlans(currentPlans, allocatedPlans, actorFields) {
  return PAYMENT_STAGES.map((stage) => {
    const current = currentPlans.find((plan) => plan.stage === stage)
    const allocated = allocatedPlans.find((plan) => plan.stage === stage)
    return {
      ...current,
      projectId: allocated.projectId,
      planId: current.planId,
      stage,
      allocationWeight: allocated.allocationWeight,
      plannedTaxInclusiveAmount: allocated.plannedTaxInclusiveAmount,
      dueDate: allocated.dueDate,
      remark: allocated.remark,
      statusCode: current.statusCode || 'active',
      ...actorFields,
    }
  })
}

export function preparePaymentPlanSave({
  project,
  adjustedTaxInclusiveAmount,
  currentPlans = [],
  proposedPlans = [],
  receipts = [],
  actor,
  mode = 'automatic',
}) {
  const projectId = requireManageableProject(project)
  const activeCurrentPlans = filterProjectRecords(currentPlans, projectId)
  const projectReceipts = filterProjectRecords(receipts, projectId)

  if (activeCurrentPlans.length === 0) {
    const normalized = normalizeProposedPlans(projectId, proposedPlans)
    assertWeightTotal(normalized)
    const allocated = allocateByWeights(adjustedTaxInclusiveAmount, normalized)
    const actorFields = normalizeActor(actor, 'createdBy')
    return allocated.map((plan) => ({
      projectId,
      stage: plan.stage,
      allocationWeight: plan.allocationWeight,
      plannedTaxInclusiveAmount: plan.plannedTaxInclusiveAmount,
      dueDate: plan.dueDate,
      remark: plan.remark,
      ...actorFields,
    }))
  }

  assertFixedStageStructure(activeCurrentPlans)
  assertExistingStageIdentity(activeCurrentPlans, proposedPlans)
  const currentAllocation = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount,
    plans: activeCurrentPlans,
    receipts: projectReceipts,
  })
  assertLockedFields(
    activeCurrentPlans,
    proposedPlans,
    currentAllocation.lockedStages,
  )

  const normalized = normalizeProposedPlans(projectId, proposedPlans)
  assertWeightTotal(normalized)
  const actorFields = normalizeActor(actor, 'updatedBy')

  if (mode === 'manual') {
    const validated = validateManualPaymentPlanAllocation({
      adjustedTaxInclusiveAmount,
      currentPlans: activeCurrentPlans,
      proposedPlans: normalized.map((plan) => ({
        ...plan,
        statusCode: 'active',
      })),
      receipts: projectReceipts,
    })
    return mergeUpdatedPlans(activeCurrentPlans, validated.plans, actorFields)
  }

  const allocation = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount,
    plans: normalized.map((plan) => ({
      ...plan,
      statusCode: 'active',
    })),
    receipts: projectReceipts,
  })
  if (allocation.allocationStatus !== 'auto_allocated') {
    throw new PaymentPlanStateError(
      'manual_allocation_required',
      '需要会计处理：请手动填写未锁定阶段金额',
    )
  }

  return mergeUpdatedPlans(activeCurrentPlans, allocation.plans, actorFields)
}

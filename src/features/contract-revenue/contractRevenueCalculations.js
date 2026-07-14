import {
  ContractRevenueValidationError,
  parseRequiredYen,
  validateTaxBreakdown,
} from './contractRevenueValidation.js'

export const PAYMENT_STAGES = ['initial', 'middle', 'final']

function isActiveRecord(record) {
  return record?.statusCode !== 'void' && record?.statusCode !== 'deleted'
}

function normalizeOriginalContract(originalContract) {
  return validateTaxBreakdown({
    taxExclusiveAmount: originalContract?.originalContractTaxExclusiveAmount,
    taxRate: originalContract?.originalContractTaxRate,
    taxAmount: originalContract?.originalContractTaxAmount,
    taxInclusiveAmount: originalContract?.originalContractTaxInclusiveAmount,
  })
}

export function calculateAdjustedContractTotals(originalContract, changes = []) {
  const original = normalizeOriginalContract(originalContract)
  let adjustedTaxExclusiveAmount = original.taxExclusiveAmount
  let adjustedTaxAmount = original.taxAmount
  let adjustedTaxInclusiveAmount = original.taxInclusiveAmount

  for (const change of Array.isArray(changes) ? changes : []) {
    if (!isActiveRecord(change)) continue

    if (change.changeType !== 'increase' && change.changeType !== 'decrease') {
      throw new ContractRevenueValidationError(
        'changeType',
        'changeType必须是increase或decrease',
      )
    }

    const normalizedChange = validateTaxBreakdown(change)
    const direction = change.changeType === 'increase' ? 1 : -1
    adjustedTaxExclusiveAmount += direction * normalizedChange.taxExclusiveAmount
    adjustedTaxAmount += direction * normalizedChange.taxAmount
    adjustedTaxInclusiveAmount += direction * normalizedChange.taxInclusiveAmount
  }

  if (adjustedTaxExclusiveAmount <= 0) {
    throw new ContractRevenueValidationError(
      'adjustedTaxExclusiveAmount',
      '调整后税抜合同金额必须大于0',
    )
  }

  if (adjustedTaxInclusiveAmount <= 0) {
    throw new ContractRevenueValidationError(
      'adjustedTaxInclusiveAmount',
      '调整后税込合同金额必须大于0',
    )
  }

  if (adjustedTaxInclusiveAmount !== adjustedTaxExclusiveAmount + adjustedTaxAmount) {
    throw new ContractRevenueValidationError(
      'adjustedTaxInclusiveAmount',
      '调整后税込合同金额必须等于调整后税抜金额与税额之和',
    )
  }

  return {
    adjustedTaxExclusiveAmount,
    adjustedTaxAmount,
    adjustedTaxInclusiveAmount,
  }
}

function normalizeActiveReceiptAmounts(receipts) {
  return (Array.isArray(receipts) ? receipts : [])
    .filter(isActiveRecord)
    .map((receipt, index) => ({
      ...receipt,
      taxInclusiveAmount: parseRequiredYen(
        receipt?.taxInclusiveAmount,
        `${receipt?.receiptId || `receipt-${index + 1}`}.taxInclusiveAmount`,
      ),
    }))
}

export function calculateReceiptSummary(adjustedTaxInclusiveAmount, receipts = []) {
  const contractTotal = parseRequiredYen(
    adjustedTaxInclusiveAmount,
    'adjustedTaxInclusiveAmount',
  )
  const totalReceivedTaxInclusiveAmount = normalizeActiveReceiptAmounts(receipts).reduce(
    (total, receipt) => total + receipt.taxInclusiveAmount,
    0,
  )
  const outstandingTaxInclusiveAmount = Math.max(
    contractTotal - totalReceivedTaxInclusiveAmount,
    0,
  )
  const overpaidTaxInclusiveAmount = Math.max(
    totalReceivedTaxInclusiveAmount - contractTotal,
    0,
  )
  const paymentProgress = Math.round(
    (totalReceivedTaxInclusiveAmount / contractTotal) * 100,
  )

  let paymentStatus = '未收款'
  if (totalReceivedTaxInclusiveAmount > contractTotal) {
    paymentStatus = '超额收款'
  } else if (totalReceivedTaxInclusiveAmount === contractTotal) {
    paymentStatus = '已收清'
  } else if (totalReceivedTaxInclusiveAmount > 0) {
    paymentStatus = '部分收款'
  }

  return {
    totalReceivedTaxInclusiveAmount,
    outstandingTaxInclusiveAmount,
    overpaidTaxInclusiveAmount,
    paymentProgress,
    paymentStatus,
  }
}

function getStageReceiptTotals(receipts) {
  const totals = Object.fromEntries(PAYMENT_STAGES.map((stage) => [stage, 0]))

  for (const receipt of normalizeActiveReceiptAmounts(receipts)) {
    if (PAYMENT_STAGES.includes(receipt.stage)) {
      totals[receipt.stage] += receipt.taxInclusiveAmount
    }
  }

  return totals
}

function normalizeActivePlans(plans) {
  const activePlans = []
  const plansByStage = new Map()
  let hasInvalidStructure = false

  for (const plan of Array.isArray(plans) ? plans : []) {
    if (!isActiveRecord(plan)) continue

    if (!PAYMENT_STAGES.includes(plan?.stage) || plansByStage.has(plan.stage)) {
      hasInvalidStructure = true
      continue
    }

    const normalizedPlan = {
      ...plan,
      plannedTaxInclusiveAmount: parseRequiredYen(
        plan?.plannedTaxInclusiveAmount,
        `${plan.stage}.plannedTaxInclusiveAmount`,
        { allowZero: true },
      ),
    }
    activePlans.push(normalizedPlan)
    plansByStage.set(plan.stage, normalizedPlan)
  }

  return {
    activePlans,
    plansByStage,
    hasInvalidStructure:
      hasInvalidStructure || PAYMENT_STAGES.some((stage) => !plansByStage.has(stage)),
  }
}

function parseAllocationWeight(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' && typeof value !== 'string') return null
  if (typeof value === 'string' && !value.trim()) return null
  if (typeof value === 'string' && !/^[+]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) {
    return null
  }

  const weight = typeof value === 'string' ? Number(value.trim()) : value
  return Number.isFinite(weight) && weight >= 0 ? weight : null
}

function buildManualAllocationResult({
  adjustedTaxInclusiveAmount,
  plans,
  activePlans,
  lockedStages,
  unlockedStages,
  lockedPlannedTaxInclusiveAmount,
  allocationReason,
}) {
  const currentPlanTotal = activePlans.reduce(
    (total, plan) => total + plan.plannedTaxInclusiveAmount,
    0,
  )

  return {
    plans,
    allocationStatus: 'manual_review_required',
    allocationReason,
    lockedStages,
    unlockedStages,
    lockedPlannedTaxInclusiveAmount,
    remainingAssignableTaxInclusiveAmount:
      adjustedTaxInclusiveAmount - lockedPlannedTaxInclusiveAmount,
    unallocatedTaxInclusiveAmount: adjustedTaxInclusiveAmount - currentPlanTotal,
    lockedAmountExcess: Math.max(
      lockedPlannedTaxInclusiveAmount - adjustedTaxInclusiveAmount,
      0,
    ),
  }
}

export function reallocateUnpaidPaymentStages({
  adjustedTaxInclusiveAmount,
  plans = [],
  receipts = [],
}) {
  const contractTotal = parseRequiredYen(
    adjustedTaxInclusiveAmount,
    'adjustedTaxInclusiveAmount',
  )
  const { activePlans, plansByStage, hasInvalidStructure } = normalizeActivePlans(plans)
  const stageReceiptTotals = getStageReceiptTotals(receipts)
  const lockedStages = PAYMENT_STAGES.filter((stage) => stageReceiptTotals[stage] > 0)
  const unlockedStages = PAYMENT_STAGES.filter(
    (stage) => stageReceiptTotals[stage] === 0 && plansByStage.has(stage),
  )
  const lockedPlannedTaxInclusiveAmount = lockedStages.reduce(
    (total, stage) => total + (plansByStage.get(stage)?.plannedTaxInclusiveAmount || 0),
    0,
  )

  const manualResult = (allocationReason) =>
    buildManualAllocationResult({
      adjustedTaxInclusiveAmount: contractTotal,
      plans,
      activePlans,
      lockedStages,
      unlockedStages,
      lockedPlannedTaxInclusiveAmount,
      allocationReason,
    })

  if (hasInvalidStructure) return manualResult('incomplete_payment_plan')
  if (lockedPlannedTaxInclusiveAmount > contractTotal) {
    return manualResult('locked_amount_exceeds_contract')
  }
  if (unlockedStages.length === 0) return manualResult('all_stages_locked')

  const remainingAssignableTaxInclusiveAmount =
    contractTotal - lockedPlannedTaxInclusiveAmount
  if (remainingAssignableTaxInclusiveAmount <= 0) {
    return manualResult('no_positive_remaining_amount')
  }

  const weightedStages = unlockedStages.map((stage) => ({
    stage,
    weight: parseAllocationWeight(plansByStage.get(stage).allocationWeight),
  }))
  const totalWeight = weightedStages.reduce(
    (total, item) => total + (item.weight ?? 0),
    0,
  )
  if (weightedStages.some((item) => item.weight === null) || totalWeight <= 0) {
    return manualResult('invalid_allocation_weights')
  }

  const nextAmounts = new Map()
  let allocatedAmount = 0
  weightedStages.forEach((item, index) => {
    const isLastStage = index === weightedStages.length - 1
    const amount = isLastStage
      ? remainingAssignableTaxInclusiveAmount - allocatedAmount
      : Math.round(
          (remainingAssignableTaxInclusiveAmount * item.weight) / totalWeight,
        )
    nextAmounts.set(item.stage, amount)
    allocatedAmount += amount
  })

  const nextPlans = plans.map((plan) =>
    isActiveRecord(plan) && nextAmounts.has(plan.stage)
      ? { ...plan, plannedTaxInclusiveAmount: nextAmounts.get(plan.stage) }
      : plan,
  )

  return {
    plans: nextPlans,
    allocationStatus: 'auto_allocated',
    allocationReason: null,
    lockedStages,
    unlockedStages,
    lockedPlannedTaxInclusiveAmount,
    remainingAssignableTaxInclusiveAmount,
    unallocatedTaxInclusiveAmount: 0,
    lockedAmountExcess: 0,
  }
}

export function validateManualPaymentPlanAllocation({
  adjustedTaxInclusiveAmount,
  currentPlans = [],
  proposedPlans = [],
  receipts = [],
}) {
  const contractTotal = parseRequiredYen(
    adjustedTaxInclusiveAmount,
    'adjustedTaxInclusiveAmount',
  )
  const current = normalizeActivePlans(currentPlans)
  const proposed = normalizeActivePlans(proposedPlans)

  if (current.hasInvalidStructure || proposed.hasInvalidStructure) {
    throw new ContractRevenueValidationError(
      'paymentPlans',
      '首期、中期、尾款计划必须各有一条有效记录',
    )
  }

  const stageReceiptTotals = getStageReceiptTotals(receipts)
  const lockedStages = PAYMENT_STAGES.filter((stage) => stageReceiptTotals[stage] > 0)

  for (const stage of lockedStages) {
    const currentAmount = current.plansByStage.get(stage).plannedTaxInclusiveAmount
    const proposedAmount = proposed.plansByStage.get(stage).plannedTaxInclusiveAmount
    if (currentAmount !== proposedAmount) {
      throw new ContractRevenueValidationError(
        `${stage}.plannedTaxInclusiveAmount`,
        '已有实际收款的阶段金额不能修改',
      )
    }
  }

  const proposedTotal = proposed.activePlans.reduce(
    (total, plan) => total + plan.plannedTaxInclusiveAmount,
    0,
  )
  if (proposedTotal !== contractTotal) {
    throw new ContractRevenueValidationError(
      'paymentPlanTotal',
      '全部阶段计划金额合计必须等于调整后税込合同金额',
    )
  }

  const normalizedAmounts = new Map(
    proposed.activePlans.map((plan) => [plan.stage, plan.plannedTaxInclusiveAmount]),
  )

  return {
    plans: proposedPlans.map((plan) =>
      isActiveRecord(plan) && normalizedAmounts.has(plan.stage)
        ? { ...plan, plannedTaxInclusiveAmount: normalizedAmounts.get(plan.stage) }
        : plan,
    ),
    lockedStages,
  }
}

function usesContractRevenueSchema(project) {
  const version = Number(project?.contractRevenueSchemaVersion)
  return Number.isInteger(version) && version >= 1
}

function requireProjectId(project) {
  const projectId = project?.projectId
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new ContractRevenueValidationError('projectId', 'projectId不能为空')
  }
  return projectId.trim()
}

function filterProjectRecords(records, projectId) {
  return (Array.isArray(records) ? records : []).filter(
    (record) => record?.projectId === projectId,
  )
}

function buildLegacyCompatibilitySnapshot(project) {
  const contractAmount = parseRequiredYen(project?.contractAmount, 'contractAmount')
  const paidAmount = parseRequiredYen(project?.paidAmount, 'paidAmount', {
    allowZero: true,
  })
  const receiptSummary = calculateReceiptSummary(
    contractAmount,
    paidAmount > 0
      ? [
          {
            receiptId: 'legacy-paidAmount-compatibility',
            taxInclusiveAmount: paidAmount,
          },
        ]
      : [],
  )

  return {
    adjustedTaxExclusiveAmount: contractAmount,
    adjustedTaxAmount: 0,
    adjustedTaxInclusiveAmount: contractAmount,
    ...receiptSummary,
    allocationStatus: 'legacy_compatibility',
    allocationReason: 'contract_revenue_schema_not_migrated',
    lockedStages: [],
    unlockedStages: [],
    lockedPlannedTaxInclusiveAmount: 0,
    remainingAssignableTaxInclusiveAmount: contractAmount,
    unallocatedTaxInclusiveAmount: contractAmount,
    lockedAmountExcess: 0,
    contractAmount,
    paidAmount,
    profitAnchorTaxExclusiveAmount: contractAmount,
  }
}

export function buildProjectRevenueSnapshot(
  project,
  changes = [],
  plans = [],
  receipts = [],
) {
  if (!usesContractRevenueSchema(project)) {
    return buildLegacyCompatibilitySnapshot(project)
  }

  const projectId = requireProjectId(project)
  const projectChanges = filterProjectRecords(changes, projectId)
  const projectPlans = filterProjectRecords(plans, projectId)
  const projectReceipts = filterProjectRecords(receipts, projectId)
  const adjustedTotals = calculateAdjustedContractTotals(project, projectChanges)
  const receiptSummary = calculateReceiptSummary(
    adjustedTotals.adjustedTaxInclusiveAmount,
    projectReceipts,
  )
  const { plans: _allocatedPlans, ...allocationSummary } = reallocateUnpaidPaymentStages({
    adjustedTaxInclusiveAmount: adjustedTotals.adjustedTaxInclusiveAmount,
    plans: projectPlans,
    receipts: projectReceipts,
  })

  return {
    ...adjustedTotals,
    ...receiptSummary,
    ...allocationSummary,
    contractAmount: adjustedTotals.adjustedTaxInclusiveAmount,
    paidAmount: receiptSummary.totalReceivedTaxInclusiveAmount,
    profitAnchorTaxExclusiveAmount: adjustedTotals.adjustedTaxExclusiveAmount,
  }
}

const COMPATIBILITY_PAYMENT_STATUS = Object.freeze({
  未收款: '未付款',
  部分收款: '部分付款',
  已收清: '已付清',
  超额收款: '超额收款',
})

export function buildProjectRevenueSnapshotCollection(
  projects = [],
  changes = [],
  plans = [],
  receipts = [],
) {
  const snapshots = new Map()

  for (const project of Array.isArray(projects) ? projects : []) {
    const projectId = requireProjectId(project)
    snapshots.set(
      projectId,
      buildProjectRevenueSnapshot(project, changes, plans, receipts),
    )
  }

  return snapshots
}

export function buildProjectRevenueReadModel(project, snapshot) {
  if (!snapshot) return { ...project }

  return {
    ...project,
    ...snapshot,
    revenuePaymentStatus: snapshot.paymentStatus,
    paymentStatus:
      COMPATIBILITY_PAYMENT_STATUS[snapshot.paymentStatus] || snapshot.paymentStatus,
  }
}

export function getProfitAnchorTaxExclusiveAmount(project) {
  const amount = Number(project?.profitAnchorTaxExclusiveAmount)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

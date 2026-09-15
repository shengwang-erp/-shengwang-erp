import {
  ContractRevenueValidationError,
  parseRequiredYen,
} from './contractRevenueValidation.js'
import { isOriginalContractSaved } from './originalContract.js'

export const PAYMENT_STAGE_LABELS = Object.freeze({
  initial: '首期款',
  middle: '中期款',
  final: '尾款',
})

const LEGACY_STAGE_ORDER = Object.freeze({ initial: 1, middle: 2, final: 3 })
const MAX_INSTALLMENTS = 24
const TOTAL_BASIS_POINTS = 10000

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

function requiredText(value, field, message, maxLength = 200) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ContractRevenueValidationError(field, message)
  if (normalized.length > maxLength) {
    throw new ContractRevenueValidationError(field, `${message.replace('不能为空', '')}不能超过${maxLength}个字符`)
  }
  return normalized
}

function requireProjectId(project) {
  return requiredText(project?.projectId, 'projectId', 'projectId不能为空')
}

export function canManagePaymentPlans(project) {
  return isOriginalContractSaved(project)
}

function requireManageableProject(project) {
  const projectId = requireProjectId(project)
  if (!canManagePaymentPlans(project)) {
    const schemaVersion = Number(project?.contractRevenueSchemaVersion)
    const legacy = !Number.isInteger(schemaVersion) || schemaVersion < 1
    throw new PaymentPlanStateError(
      legacy ? 'legacy_migration_required' : 'original_contract_save_required',
      legacy ? '需要完成历史合同迁移' : '请先完整保存原始合同后再设置收款计划',
    )
  }
  return projectId
}

function normalizeActor(actor, prefix) {
  const employeeId = requiredText(actor?.employeeId, `${prefix}Id`, '当前操作人ID不能为空')
  const employeeName = requiredText(actor?.name, `${prefix}Name`, '当前操作人姓名不能为空')
  return { [`${prefix}Id`]: employeeId, [`${prefix}Name`]: employeeName }
}

function planIdentity(plan, index = 0) {
  const planId = typeof plan?.planId === 'string' ? plan.planId.trim() : ''
  if (planId) return planId
  const stage = typeof plan?.stage === 'string' ? plan.stage.trim() : ''
  return stage || `plan-${index + 1}`
}

function legacyOrder(plan, fallbackOrder) {
  const explicit = Number(plan?.installmentOrder)
  if (Number.isInteger(explicit) && explicit >= 1) return explicit
  return LEGACY_STAGE_ORDER[plan?.stage] || fallbackOrder
}

function legacyName(plan, order) {
  const explicit = typeof plan?.name === 'string' ? plan.name.trim() : ''
  return explicit || PAYMENT_STAGE_LABELS[plan?.stage] || `第${order}期`
}

export function normalizePaymentPlans(records = [], projectId = '') {
  const filtered = (Array.isArray(records) ? records : [])
    .filter((record) => isActiveRecord(record) && (!projectId || record?.projectId === projectId))
  return filtered
    .map((plan, index) => {
      const installmentOrder = legacyOrder(plan, index + 1)
      return {
        ...plan,
        installmentOrder,
        name: legacyName(plan, installmentOrder),
        dueDate: plan?.dueDate || '',
        remark: typeof plan?.remark === 'string' ? plan.remark : '',
      }
    })
    .sort((left, right) => left.installmentOrder - right.installmentOrder)
}

function defaultCreateId() {
  return globalThis.crypto.randomUUID()
}

export function createBlankPaymentPlans(projectId, count = 3, options = {}) {
  const normalizedProjectId = requiredText(projectId, 'projectId', 'projectId不能为空')
  const normalizedCount = Number(count)
  if (!Number.isInteger(normalizedCount) || normalizedCount < 1 || normalizedCount > MAX_INSTALLMENTS) {
    throw new ContractRevenueValidationError('installmentCount', `收款计划期数必须是1至${MAX_INSTALLMENTS}期`)
  }
  const createId = options.createId || defaultCreateId
  return Array.from({ length: normalizedCount }, (_, index) => ({
    planId: requiredText(createId(), `plan-${index + 1}.planId`, '计划ID不能为空'),
    projectId: normalizedProjectId,
    installmentOrder: index + 1,
    name: `第${index + 1}期`,
    allocationWeight: '',
    plannedTaxInclusiveAmount: '',
    dueDate: '',
    remark: '',
    statusCode: 'active',
  }))
}

export function parseAllocationBasisPoints(value, field = 'allocationWeight') {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new ContractRevenueValidationError(field, '分配比例必须是0至100之间且最多两位小数')
  }
  const [integerPart, decimalPart = ''] = text.split('.')
  const points = Number(integerPart) * 100 + Number(decimalPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(points) || points < 0 || points > TOTAL_BASIS_POINTS) {
    throw new ContractRevenueValidationError(field, '分配比例必须是0至100之间且最多两位小数')
  }
  return points
}

function assertPlanArray(plans) {
  if (!Array.isArray(plans) || plans.length < 1 || plans.length > MAX_INSTALLMENTS) {
    throw new ContractRevenueValidationError('paymentPlans', `收款计划必须保留1至${MAX_INSTALLMENTS}期`)
  }
}

function normalizeDueDate(value, identity) {
  const dueDate = typeof value === 'string' ? value.trim() : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    throw new ContractRevenueValidationError(`${identity}.dueDate`, '约定日期必须是有效日期')
  }
  const parsed = new Date(`${dueDate}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== dueDate) {
    throw new ContractRevenueValidationError(`${identity}.dueDate`, '约定日期必须是有效日期')
  }
  return dueDate
}

function normalizedProposedPlans(projectId, plans, { requireAmount = true } = {}) {
  assertPlanArray(plans)
  const seenIds = new Set()
  const seenOrders = new Set()
  const normalized = plans.map((plan, index) => {
    const planId = requiredText(plan?.planId || plan?.stage, `plan-${index + 1}.planId`, '计划ID不能为空')
    const order = Number(plan?.installmentOrder ?? LEGACY_STAGE_ORDER[plan?.stage] ?? index + 1)
    if (seenIds.has(planId)) throw new ContractRevenueValidationError(`${planId}.planId`, '计划ID不能重复')
    if (!Number.isInteger(order) || order < 1 || order > plans.length || seenOrders.has(order)) {
      throw new ContractRevenueValidationError(`${planId}.installmentOrder`, '期次顺序必须从1开始连续且不能重复')
    }
    seenIds.add(planId)
    seenOrders.add(order)
    const amount = requireAmount
      ? parseRequiredYen(plan?.plannedTaxInclusiveAmount, `${planId}.plannedTaxInclusiveAmount`, { allowZero: true })
      : plan?.plannedTaxInclusiveAmount
    return {
      ...plan,
      planId,
      projectId,
      installmentOrder: order,
      name: requiredText(legacyName(plan, order), `${planId}.name`, '期次名称不能为空', 80),
      allocationWeight: parseAllocationBasisPoints(plan?.allocationWeight, `${planId}.allocationWeight`) / 100,
      plannedTaxInclusiveAmount: amount,
      dueDate: normalizeDueDate(plan?.dueDate, planId),
      remark: typeof plan?.remark === 'string' ? plan.remark.trim().slice(0, 1000) : '',
      statusCode: 'active',
    }
  }).sort((left, right) => left.installmentOrder - right.installmentOrder)
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized[index].installmentOrder !== index + 1) {
      throw new ContractRevenueValidationError('installmentOrder', '期次顺序必须从1开始连续且不能重复')
    }
  }
  return normalized
}

function basisPointTotal(plans) {
  return plans.reduce((total, plan) => total + parseAllocationBasisPoints(plan.allocationWeight, `${plan.planId}.allocationWeight`), 0)
}

function assertWeightTotal(plans) {
  if (basisPointTotal(plans) !== TOTAL_BASIS_POINTS) {
    throw new ContractRevenueValidationError('allocationWeightTotal', '所有期次分配比例合计必须等于100%')
  }
}

export function calculatePaymentPlanAmountPreview(adjustedTaxInclusiveAmount, plans) {
  const contractTotal = parseRequiredYen(adjustedTaxInclusiveAmount, 'adjustedTaxInclusiveAmount')
  assertPlanArray(plans)
  const sorted = [...plans].map((plan, index) => ({
    ...plan,
    planId: planIdentity(plan, index),
    installmentOrder: legacyOrder(plan, index + 1),
  })).sort((left, right) => left.installmentOrder - right.installmentOrder)
  assertWeightTotal(sorted)
  let allocated = 0
  return Object.fromEntries(sorted.map((plan, index) => {
    const amount = index === sorted.length - 1
      ? contractTotal - allocated
      : Math.round(contractTotal * parseAllocationBasisPoints(plan.allocationWeight, `${plan.planId}.allocationWeight`) / TOTAL_BASIS_POINTS)
    allocated += amount
    return [plan.planId, amount]
  }))
}

function activeReceiptPlanIds(receipts, plans, projectId) {
  const byLegacyStage = new Map(plans.filter((plan) => plan.stage).map((plan) => [plan.stage, plan.planId]))
  const ids = new Set()
  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (!isActiveRecord(receipt) || receipt?.projectId !== projectId) continue
    const explicit = typeof receipt?.planId === 'string' ? receipt.planId.trim() : ''
    const planId = explicit || byLegacyStage.get(receipt?.stage)
    if (planId) ids.add(planId)
  }
  return ids
}

function sumPlanAmounts(plans) {
  return plans.reduce((total, plan) => {
    const amount = Number(plan?.plannedTaxInclusiveAmount)
    return total + (Number.isSafeInteger(amount) && amount >= 0 ? amount : 0)
  }, 0)
}

export function buildPaymentPlanEditorState({ project, adjustedTaxInclusiveAmount, paymentPlans = [], receipts = [] }) {
  const projectId = requireProjectId(project)
  const plans = normalizePaymentPlans(paymentPlans, projectId)
  if (plans.length === 0) {
    return {
      mode: 'initial',
      plans: createBlankPaymentPlans(projectId),
      allocationStatus: 'not_configured',
      allocationReason: null,
      lockedPlanIds: [],
      lockedStages: [],
      needsAccountingAction: false,
      hasPendingReallocation: false,
      contractDifference: adjustedTaxInclusiveAmount,
    }
  }
  const lockedSet = activeReceiptPlanIds(receipts, plans, projectId)
  const contractDifference = Number(adjustedTaxInclusiveAmount) - sumPlanAmounts(plans)
  return {
    mode: 'existing',
    plans: plans.map((plan) => ({ ...plan, locked: lockedSet.has(plan.planId) })),
    allocationStatus: contractDifference === 0 ? 'configured' : 'contract_changed',
    allocationReason: contractDifference === 0 ? null : 'contract_amount_changed',
    lockedPlanIds: plans.filter((plan) => lockedSet.has(plan.planId)).map((plan) => plan.planId),
    lockedStages: plans.filter((plan) => lockedSet.has(plan.planId) && plan.stage).map((plan) => plan.stage),
    needsAccountingAction: contractDifference !== 0,
    hasPendingReallocation: false,
    contractDifference,
  }
}

function allocateWithLockedPlans(contractTotal, plans, currentById, lockedIds) {
  let lockedAmount = 0
  const unlocked = []
  for (const plan of plans) {
    if (lockedIds.has(plan.planId)) lockedAmount += currentById.get(plan.planId).plannedTaxInclusiveAmount
    else unlocked.push(plan)
  }
  const remaining = contractTotal - lockedAmount
  if (remaining < 0) throw new ContractRevenueValidationError('paymentPlanTotal', '已锁定期次金额超过调整后税入合同金额')
  if (unlocked.length === 0) {
    if (remaining !== 0) throw new ContractRevenueValidationError('paymentPlanTotal', '全部期次已锁定，计划金额与合同计算基数存在差额')
    return new Map([...lockedIds].map((planId) => [planId, currentById.get(planId).plannedTaxInclusiveAmount]))
  }
  const unlockedPoints = unlocked.reduce((total, plan) => total + parseAllocationBasisPoints(plan.allocationWeight, `${plan.planId}.allocationWeight`), 0)
  if (unlockedPoints <= 0) throw new ContractRevenueValidationError('allocationWeightTotal', '未收款期次必须填写有效分配比例')
  let allocated = 0
  const amounts = new Map()
  for (const plan of plans) {
    if (lockedIds.has(plan.planId)) {
      amounts.set(plan.planId, currentById.get(plan.planId).plannedTaxInclusiveAmount)
      continue
    }
    const unlockedIndex = unlocked.findIndex((item) => item.planId === plan.planId)
    const amount = unlockedIndex === unlocked.length - 1
      ? remaining - allocated
      : Math.round(remaining * parseAllocationBasisPoints(plan.allocationWeight, `${plan.planId}.allocationWeight`) / unlockedPoints)
    allocated += amount
    amounts.set(plan.planId, amount)
  }
  return amounts
}

export function preparePaymentPlanSetSave({
  project,
  adjustedTaxInclusiveAmount,
  currentPlans = [],
  proposedPlans = [],
  receipts = [],
  actor,
}) {
  const projectId = requireManageableProject(project)
  const contractTotal = parseRequiredYen(adjustedTaxInclusiveAmount, 'adjustedTaxInclusiveAmount')
  const current = normalizePaymentPlans(currentPlans, projectId)
  const proposed = normalizedProposedPlans(projectId, (Array.isArray(proposedPlans) ? proposedPlans : []).map((plan) => {
    const stored = current.find((item) => item.planId === plan?.planId)
    return stored && !plan?.installmentOrder ? { ...plan, installmentOrder: stored.installmentOrder } : plan
  }), { requireAmount: false })
  const currentById = new Map(current.map((plan) => [plan.planId, {
    ...plan,
    plannedTaxInclusiveAmount: parseRequiredYen(plan.plannedTaxInclusiveAmount, `${plan.planId}.plannedTaxInclusiveAmount`, { allowZero: true }),
  }]))
  const lockedIds = activeReceiptPlanIds(receipts, current, projectId)
  for (const planId of lockedIds) {
    const stored = currentById.get(planId)
    const next = proposed.find((plan) => plan.planId === planId)
    if (!next) throw new ContractRevenueValidationError(`${planId}.planId`, `${stored?.name || '已收款期次'}已有实际到账，不能删除`)
    if (stored.stage && next.stage && stored.stage !== next.stage) {
      throw new ContractRevenueValidationError(planId + '.stage', '已有实际到账的期次类型不能修改')
    }
    if (parseAllocationBasisPoints(next.allocationWeight) !== parseAllocationBasisPoints(stored.allocationWeight)) {
      throw new ContractRevenueValidationError(`${planId}.allocationWeight`, '已有实际到账的期次比例不能修改')
    }
    const submittedAmount = parseRequiredYen(next.plannedTaxInclusiveAmount, `${planId}.plannedTaxInclusiveAmount`, { allowZero: true })
    if (submittedAmount !== stored.plannedTaxInclusiveAmount) {
      throw new ContractRevenueValidationError(`${planId}.plannedTaxInclusiveAmount`, '已有实际到账的期次计划金额不能修改')
    }
  }
  assertWeightTotal(proposed)
  const amounts = allocateWithLockedPlans(contractTotal, proposed, currentById, lockedIds)
  const createdActor = normalizeActor(actor, 'createdBy')
  const updatedActor = normalizeActor(actor, 'updatedBy')
  const result = proposed.map((plan) => {
    const stored = currentById.get(plan.planId)
    return {
      ...(stored || {}),
      ...plan,
      plannedTaxInclusiveAmount: amounts.get(plan.planId),
      ...(stored ? updatedActor : createdActor),
    }
  })
  if (sumPlanAmounts(result) !== contractTotal) {
    throw new ContractRevenueValidationError('paymentPlanTotal', '计划金额合计必须等于调整后税入合同金额')
  }
  return result
}

// Transitional export kept for existing callers while the UI moves to one atomic set save.
export function preparePaymentPlanSave(options) {
  const inputHadIds = (options.proposedPlans || []).every((plan) => plan?.planId)
  const proposedPlans = (options.proposedPlans || []).map((plan, index) => ({
    ...plan,
    planId: plan.planId || plan.stage,
    installmentOrder: plan.installmentOrder || index + 1,
    name: plan.name || PAYMENT_STAGE_LABELS[plan.stage] || `第${index + 1}期`,
  }))
  const result = preparePaymentPlanSetSave({ ...options, proposedPlans })
  return inputHadIds ? result : result.map(({ planId: _planId, installmentOrder: _order, name: _name, ...plan }) => plan)
}

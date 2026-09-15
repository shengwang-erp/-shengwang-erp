import { calculateReceiptSummary } from './contractRevenueCalculations.js'
import { ContractRevenueValidationError, parseRequiredYen } from './contractRevenueValidation.js'
import { normalizePaymentPlans, PAYMENT_STAGE_LABELS } from './paymentPlans.js'
import { isOriginalContractSaved } from './originalContract.js'

export const CUSTOMER_RECEIPT_STAGES = Object.freeze(['initial', 'middle', 'final', 'unallocated'])
export const CUSTOMER_RECEIPT_STAGE_LABELS = Object.freeze({ ...PAYMENT_STAGE_LABELS, installment: '收款计划', unallocated: '未分配' })


export class CustomerReceiptStateError extends Error {
  constructor(code, message) { super(message); this.name = 'CustomerReceiptStateError'; this.code = code }
}

function isActiveRecord(record) { return record?.statusCode !== 'void' && record?.statusCode !== 'deleted' }

function requiredText(value, field, message) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized) throw new ContractRevenueValidationError(field, message)
  return normalized
}

function optionalText(value) { return typeof value === 'string' ? value.trim() : '' }
function requireProjectId(project) { return requiredText(project?.projectId, 'projectId', 'projectId不能为空') }

export function canManageCustomerReceipts(project) {
  return isOriginalContractSaved(project)
}

function requireSavedProject(project) {
  const projectId = requireProjectId(project)
  const schemaVersion = Number(project?.contractRevenueSchemaVersion)
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new CustomerReceiptStateError('legacy_migration_required', '需要完成历史合同迁移')
  if (!isOriginalContractSaved(project)) throw new CustomerReceiptStateError('original_contract_save_required', '请先完整保存原始合同后再登记实际收款')
  return projectId
}

function normalizeDate(value) {
  const date = requiredText(value, 'receivedDate', '到账日期不能为空')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new ContractRevenueValidationError('receivedDate', '到账日期必须是有效日期')
  }
  return date
}

function normalizeActor(actor, prefix) {
  return {
    [`${prefix}Id`]: requiredText(actor?.employeeId, `${prefix}Id`, '当前操作人ID不能为空'),
    [`${prefix}Name`]: requiredText(actor?.name, `${prefix}Name`, '当前操作人姓名不能为空'),
  }
}

function projectRecords(records, projectId) { return (Array.isArray(records) ? records : []).filter((record) => record?.projectId === projectId) }

function activePlans(paymentPlans, projectId) {
  return normalizePaymentPlans(projectRecords(paymentPlans, projectId).filter(isActiveRecord), projectId)
}

function resolveSelectedPlan(paymentPlans, projectId, input) {
  const plans = activePlans(paymentPlans, projectId)
  const requestedPlanId = typeof input?.planId === 'string' ? input.planId.trim() : ''
  if (requestedPlanId) {
    const plan = plans.find((item) => item.planId === requestedPlanId)
    if (!plan) throw new CustomerReceiptStateError('payment_plan_required', '所选收款计划不存在或已失效，请重新选择')
    return plan
  }

  const legacyStage = typeof input?.stage === 'string' ? input.stage : ''
  if (legacyStage === 'unallocated' || (!legacyStage && Object.hasOwn(input || {}, 'planId'))) return null
  if (!['initial', 'middle', 'final'].includes(legacyStage)) throw new ContractRevenueValidationError('stage', '请选择有效收款计划或未分配')
  const matches = plans.filter((plan) => plan.stage === legacyStage)
  if (matches.length === 0) throw new CustomerReceiptStateError('payment_plan_required', `${PAYMENT_STAGE_LABELS[legacyStage]}尚未设置有效收款计划，请先建立计划或选择未分配`)
  if (matches.length > 1) throw new CustomerReceiptStateError('payment_plan_conflict', `${PAYMENT_STAGE_LABELS[legacyStage]}存在多条有效收款计划，需要会计处理`)
  return matches[0]
}

export function prepareCustomerReceiptInput(project, paymentPlans, input, actor) {
  const projectId = requireSavedProject(project)
  const plan = resolveSelectedPlan(paymentPlans, projectId, input)
  const legacyStage = plan?.stage && ['initial', 'middle', 'final'].includes(plan.stage) ? plan.stage : null
  return {
    projectId,
    planId: plan?.planId || null,
    stage: plan ? (legacyStage || 'installment') : 'unallocated',
    taxInclusiveAmount: parseRequiredYen(input?.taxInclusiveAmount, 'taxInclusiveAmount'),
    receivedDate: normalizeDate(input?.receivedDate),
    paymentMethod: requiredText(input?.paymentMethod, 'paymentMethod', '支付方式不能为空'),
    bankReference: optionalText(input?.bankReference),
    remark: optionalText(input?.remark),
    ...normalizeActor(actor, 'createdBy'),
  }
}

export function prepareCustomerReceiptVoid(project, receipts, targetReceipt, actor, reason) {
  const projectId = requireSavedProject(project)
  const receiptId = requiredText(targetReceipt?.receiptId, 'receiptId', 'receiptId不能为空')
  const stored = projectRecords(receipts, projectId).find((receipt) => receipt?.receiptId === receiptId)
  if (!stored) throw new CustomerReceiptStateError('receipt_not_found', '未找到需要作废的实际收款流水')
  if (!isActiveRecord(stored)) throw new CustomerReceiptStateError('receipt_already_void', '该实际收款流水已经作废')
  return { voidReason: requiredText(reason, 'voidReason', '作废原因不能为空'), ...normalizeActor(actor, 'voidedBy') }
}

function normalizeStoredReceipt(receipt) {
  return {
    ...receipt,
    stage: ['initial', 'middle', 'final'].includes(receipt?.stage) ? receipt.stage : receipt?.planId ? 'installment' : 'unallocated',
    taxInclusiveAmount: parseRequiredYen(receipt?.taxInclusiveAmount, `${receipt?.receiptId || 'receipt'}.taxInclusiveAmount`),
  }
}

function compareRows(left, right) {
  const date = String(right?.receivedDate || '').localeCompare(String(left?.receivedDate || ''))
  if (date) return date
  const created = String(right?.createdAt || '').localeCompare(String(left?.createdAt || ''))
  if (created) return created
  const voidOrder = (isActiveRecord(left) ? 0 : 1) - (isActiveRecord(right) ? 0 : 1)
  return voidOrder || String(left?.receiptId || '').localeCompare(String(right?.receiptId || ''))
}

function linkedPlanId(receipt, plans) {
  if (receipt?.planId && plans.some((plan) => plan.planId === receipt.planId)) return receipt.planId
  if (['initial', 'middle', 'final'].includes(receipt?.stage)) return plans.find((plan) => plan.stage === receipt.stage)?.planId || null
  return null
}

function planStatus(plan, received) {
  if (!plan) return '未设置计划'
  if (received === 0) return '未到账'
  if (received > plan.plannedTaxInclusiveAmount) return '超额到账'
  if (received === plan.plannedTaxInclusiveAmount) return '已到账'
  return '部分到账'
}

export function buildCustomerReceiptViewModel({ project, adjustedTaxInclusiveAmount, paymentPlans = [], receipts = [] }) {
  const projectId = requireProjectId(project)
  const plans = activePlans(paymentPlans, projectId)
  const receiptRows = projectRecords(receipts, projectId).map(normalizeStoredReceipt).sort(compareRows)
  const activeReceipts = receiptRows.filter(isActiveRecord)
  const stageSummaries = plans.map((plan) => {
    const plannedTaxInclusiveAmount = parseRequiredYen(plan.plannedTaxInclusiveAmount, `${plan.planId}.plannedTaxInclusiveAmount`, { allowZero: true })
    const matching = activeReceipts.filter((receipt) => linkedPlanId(receipt, plans) === plan.planId)
    const receivedTaxInclusiveAmount = matching.reduce((sum, receipt) => sum + receipt.taxInclusiveAmount, 0)
    return {
      stage: plan.stage || 'installment',
      installmentOrder: plan.installmentOrder,
      label: plan.name,
      planId: plan.planId,
      hasPlan: true,
      plannedTaxInclusiveAmount,
      receivedTaxInclusiveAmount,
      remainingTaxInclusiveAmount: Math.max(plannedTaxInclusiveAmount - receivedTaxInclusiveAmount, 0),
      overpaidTaxInclusiveAmount: Math.max(receivedTaxInclusiveAmount - plannedTaxInclusiveAmount, 0),
      status: planStatus({ plannedTaxInclusiveAmount }, receivedTaxInclusiveAmount),
      locked: matching.length > 0,
      activeReceiptCount: matching.length,
    }
  })
  const unallocated = activeReceipts.filter((receipt) => !linkedPlanId(receipt, plans))
  const unallocatedReceivedTaxInclusiveAmount = unallocated.reduce((sum, receipt) => sum + receipt.taxInclusiveAmount, 0)
  stageSummaries.push({ stage: 'unallocated', label: '未分配', planId: null, hasPlan: false, plannedTaxInclusiveAmount: null, receivedTaxInclusiveAmount: unallocatedReceivedTaxInclusiveAmount, remainingTaxInclusiveAmount: null, overpaidTaxInclusiveAmount: 0, status: unallocatedReceivedTaxInclusiveAmount > 0 ? '待分配' : '无未分配收款', locked: false, activeReceiptCount: unallocated.length })
  const receiptSummary = calculateReceiptSummary(adjustedTaxInclusiveAmount, activeReceipts)
  const locked = stageSummaries.filter((summary) => summary.planId && summary.locked)
  return {
    projectId,
    adjustedTaxInclusiveAmount: parseRequiredYen(adjustedTaxInclusiveAmount, 'adjustedTaxInclusiveAmount'),
    ...receiptSummary,
    stageSummaries,
    receiptRows: receiptRows.map((receipt) => ({ ...receipt, displayPlanName: receipt.planId ? plans.find((plan) => plan.planId === receipt.planId)?.name || '历史计划' : CUSTOMER_RECEIPT_STAGE_LABELS[receipt.stage] || '未分配' })),
    lockedPlanIds: locked.map((summary) => summary.planId),
    lockedStages: locked.map((summary) => summary.stage).filter((stage) => ['initial', 'middle', 'final'].includes(stage)),
    unallocatedReceivedTaxInclusiveAmount,
    activeReceiptCount: activeReceipts.length,
    hasStageOverpayment: stageSummaries.some((summary) => summary.overpaidTaxInclusiveAmount > 0),
    hasContractOverpayment: receiptSummary.overpaidTaxInclusiveAmount > 0,
  }
}

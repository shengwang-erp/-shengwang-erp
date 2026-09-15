import { parseRequiredYen } from './contractRevenueValidation.js'

const LEGACY_STAGES = ['initial', 'middle', 'final']
function active(record) { return record?.statusCode !== 'void' && record?.statusCode !== 'deleted' }

export function summarizeConfigurablePaymentPlans(adjustedTaxInclusiveAmount, plans = [], receipts = []) {
  const activePlans = plans.filter(active).map((plan, index) => ({
    ...plan,
    planId: typeof plan?.planId === 'string' && plan.planId.trim() ? plan.planId.trim() : plan?.stage || `plan-${index + 1}`,
    plannedTaxInclusiveAmount: parseRequiredYen(plan?.plannedTaxInclusiveAmount, `${plan?.planId || plan?.stage || `plan-${index + 1}`}.plannedTaxInclusiveAmount`, { allowZero: true }),
  }))
  const byId = new Map(activePlans.map((plan) => [plan.planId, plan]))
  const byStage = new Map(activePlans.filter((plan) => LEGACY_STAGES.includes(plan?.stage)).map((plan) => [plan.stage, plan]))
  const lockedSet = new Set()
  for (const receipt of receipts.filter(active)) {
    const planId = byId.has(receipt?.planId) ? receipt.planId : byStage.get(receipt?.stage)?.planId
    if (planId) lockedSet.add(planId)
  }
  const locked = activePlans.filter((plan) => lockedSet.has(plan.planId))
  const unlocked = activePlans.filter((plan) => !lockedSet.has(plan.planId))
  const planTotal = activePlans.reduce((sum, plan) => sum + plan.plannedTaxInclusiveAmount, 0)
  const lockedTotal = locked.reduce((sum, plan) => sum + plan.plannedTaxInclusiveAmount, 0)
  const difference = adjustedTaxInclusiveAmount - planTotal
  return {
    allocationStatus: activePlans.length === 0 ? 'not_configured' : difference === 0 ? 'configured' : 'contract_changed',
    allocationReason: activePlans.length === 0 ? 'payment_plan_not_configured' : difference === 0 ? null : 'contract_amount_changed',
    lockedPlanIds: locked.map((plan) => plan.planId),
    unlockedPlanIds: unlocked.map((plan) => plan.planId),
    lockedStages: locked.map((plan) => plan.stage).filter((stage) => LEGACY_STAGES.includes(stage)),
    unlockedStages: unlocked.map((plan) => plan.stage).filter((stage) => LEGACY_STAGES.includes(stage)),
    lockedPlannedTaxInclusiveAmount: lockedTotal,
    remainingAssignableTaxInclusiveAmount: adjustedTaxInclusiveAmount - lockedTotal,
    unallocatedTaxInclusiveAmount: difference,
    lockedAmountExcess: Math.max(lockedTotal - adjustedTaxInclusiveAmount, 0),
  }
}

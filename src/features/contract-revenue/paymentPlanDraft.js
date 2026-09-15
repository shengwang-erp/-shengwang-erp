const VERSION = 1
const PREFIX = 'shengwang-erp:form-draft:v1'

function clean(value) { return typeof value === 'string' ? value.trim() : '' }
function key(accountId, projectId) {
  const account = clean(accountId)
  const project = clean(projectId)
  return account && project ? `${PREFIX}:${encodeURIComponent(account)}:project:${encodeURIComponent(project)}:payment-plan` : ''
}
function browserStorage() { try { return globalThis.sessionStorage ?? null } catch { return null } }
function copyPlans(plans) {
  return (Array.isArray(plans) ? plans : []).map((plan) => ({
    planId: clean(plan?.planId),
    projectId: clean(plan?.projectId),
    installmentOrder: Number(plan?.installmentOrder),
    name: typeof plan?.name === 'string' ? plan.name : '',
    allocationWeight: plan?.allocationWeight ?? '',
    plannedTaxInclusiveAmount: plan?.plannedTaxInclusiveAmount ?? '',
    dueDate: typeof plan?.dueDate === 'string' ? plan.dueDate : '',
    remark: typeof plan?.remark === 'string' ? plan.remark : '',
    statusCode: 'active',
  }))
}

export function createPaymentPlanDraftStore(options = {}) {
  const storage = Object.hasOwn(options, 'storage') ? options.storage : browserStorage()
  return {
    load(accountId, projectId) {
      const storageKey = key(accountId, projectId)
      if (!storageKey || !storage) return null
      try {
        const parsed = JSON.parse(storage.getItem(storageKey) || 'null')
        return parsed?.version === VERSION && Array.isArray(parsed.plans) ? copyPlans(parsed.plans) : null
      } catch { return null }
    },
    save(accountId, projectId, plans) {
      const storageKey = key(accountId, projectId)
      if (!storageKey || !storage) return
      try { storage.setItem(storageKey, JSON.stringify({ version: VERSION, plans: copyPlans(plans) })) } catch { /* best effort */ }
    },
    clear(accountId, projectId) {
      const storageKey = key(accountId, projectId)
      if (!storageKey || !storage) return
      try { storage.removeItem(storageKey) } catch { /* best effort */ }
    },
  }
}

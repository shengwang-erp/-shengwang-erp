export const CONTRACT_REVENUE_STORAGE_KEYS = Object.freeze({
  contractChanges: 'erp.projectContractChanges',
  paymentPlans: 'erp.projectPaymentPlans',
  projectReceipts: 'erp.projectReceipts',
})

import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

export const PROJECT_REVENUE_SNAPSHOT_FIELDS = Object.freeze([
  'contractAmount',
  'paidAmount',
  'paymentProgress',
  'paymentStatus',
  'revenuePaymentStatus',
  'adjustedTaxExclusiveAmount',
  'adjustedTaxAmount',
  'adjustedTaxInclusiveAmount',
  'totalReceivedTaxInclusiveAmount',
  'outstandingTaxInclusiveAmount',
  'overpaidTaxInclusiveAmount',
  'profitAnchorTaxExclusiveAmount',
  'allocationStatus',
  'allocationReason',
  'lockedStages',
  'lockedPlanIds',
  'unlockedPlanIds',
  'unlockedStages',
  'lockedPlannedTaxInclusiveAmount',
  'remainingAssignableTaxInclusiveAmount',
  'unallocatedTaxInclusiveAmount',
  'lockedAmountExcess',
])

function defaultRandomUUID() {
  return globalThis.crypto.randomUUID()
}

function requireRecordId(record, idField) {
  const value = record?.[idField]
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${idField}不能为空`)
  }
  return value
}

export function sanitizeProjectForPersistence(project = {}) {
  const sanitized = { ...project }
  for (const field of PROJECT_REVENUE_SNAPSHOT_FIELDS) {
    delete sanitized[field]
  }
  return sanitized
}

export function createContractRevenueService(overrides = {}) {
  const rpc = overrides.rpc
  const getList = overrides.getList
  const upsertRecord = overrides.upsertRecord
  const requireHook = (hook, name) => {
    if (typeof hook !== 'function') throw new Error(`${name}未配置，拒绝使用通用持久化适配器`)
    return hook
  }
  const explicitRpc = async (name, args) => {
    if (!isSupabaseConfigured || !supabase?.rpc) throw new Error('云端财务服务未配置')
    const result = await supabase.rpc(name, args)
    if (result?.error) throw result.error
    return result?.data
  }
  // These hooks are the sole authorized persistence boundary for financial rows.
  // The generic hooks remain only as a backwards-compatible test seam.
  const readContractChanges = overrides.readContractChanges || (() => getList ? getList(CONTRACT_REVENUE_STORAGE_KEYS.contractChanges) : rpc ? rpc('list_project_contract_changes_secure', {}) : explicitRpc('list_project_contract_changes_secure', {}))
  const readPaymentPlans = overrides.readPaymentPlans || (() => getList ? getList(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans) : rpc ? rpc('list_project_payment_plans_secure', {}) : explicitRpc('list_project_payment_plans_secure', {}))
  const readProjectReceipts = overrides.readProjectReceipts || (() => getList ? getList(CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts) : rpc ? rpc('list_project_receipts_secure', {}) : explicitRpc('list_project_receipts_secure', {}))
  const writeContractChange = overrides.writeContractChange || ((record) => upsertRecord ? upsertRecord(CONTRACT_REVENUE_STORAGE_KEYS.contractChanges, record) : rpc ? rpc('upsert_project_contract_change_secure', { p_payload: record }) : explicitRpc('upsert_project_contract_change_secure', { p_payload: record }))
  const writePaymentPlan = overrides.writePaymentPlan || ((record) => upsertRecord ? upsertRecord(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans, record) : rpc ? rpc('upsert_project_payment_plan_secure', { p_payload: record }) : explicitRpc('upsert_project_payment_plan_secure', { p_payload: record }))
  const writePaymentPlanSet = overrides.writePaymentPlanSet || ((projectId, plans) => rpc ? rpc("replace_project_payment_plan_secure", { p_project_id: projectId, p_plans: plans }) : explicitRpc("replace_project_payment_plan_secure", { p_project_id: projectId, p_plans: plans }))
  const writeProjectReceipt = overrides.writeProjectReceipt || ((record) => upsertRecord ? upsertRecord(CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts, record) : rpc ? rpc('upsert_project_receipt_secure', { p_payload: record }) : explicitRpc('upsert_project_receipt_secure', { p_payload: record }))
  const now = overrides.now || (() => new Date().toISOString())
  const randomUUID = overrides.randomUUID || defaultRandomUUID

  const loadRecords = async (storageKey) => {
    const records = await (storageKey === CONTRACT_REVENUE_STORAGE_KEYS.contractChanges ? readContractChanges() : storageKey === CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans ? readPaymentPlans() : readProjectReceipts())
    return Array.isArray(records) ? records : []
  }

  const createRecord = async (storageKey, idField, input) => {
    const timestamp = now()
    const record = {
      ...input,
      [idField]: randomUUID(),
      statusCode: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const writer = storageKey === CONTRACT_REVENUE_STORAGE_KEYS.contractChanges
      ? writeContractChange
      : storageKey === CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans
        ? writePaymentPlan
        : writeProjectReceipt
    await writer(record)
    return record
  }

  const updateRecord = async (storageKey, idField, input) => {
    const recordId = requireRecordId(input, idField)
    const record = {
      ...input,
      [idField]: recordId,
      statusCode: input.statusCode || 'active',
      updatedAt: now(),
    }
    const writer = storageKey === CONTRACT_REVENUE_STORAGE_KEYS.contractChanges
      ? writeContractChange
      : storageKey === CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans
        ? writePaymentPlan
        : writeProjectReceipt
    await writer(record)
    return record
  }

  const voidRecord = async (storageKey, idField, input, details = {}) => {
    const recordId = requireRecordId(input, idField)
    const timestamp = now()
    const record = {
      ...input,
      ...details,
      [idField]: recordId,
      statusCode: 'void',
      voidReason: details.voidReason || '',
      voidedAt: timestamp,
      updatedAt: timestamp,
    }
    const writer = storageKey === CONTRACT_REVENUE_STORAGE_KEYS.contractChanges
      ? writeContractChange
      : storageKey === CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans
        ? writePaymentPlan
        : writeProjectReceipt
    await writer(record)
    return record
  }

  return {
    loadContractChanges: async () => { const rows = await readContractChanges(); return Array.isArray(rows) ? rows : [] },
    loadPaymentPlans: async () => { const rows = await readPaymentPlans(); return Array.isArray(rows) ? rows : [] },
    loadProjectReceipts: async () => { const rows = await readProjectReceipts(); return Array.isArray(rows) ? rows : [] },
    savePaymentPlanSet: async (projectId, plans) => {
      requireRecordId({ projectId }, 'projectId')
      const result = await writePaymentPlanSet(projectId, plans)
      if (!Array.isArray(result)) throw new Error('收款计划保存结果无效')
      return result
    },

    createContractChange: (input) =>
      createRecord(CONTRACT_REVENUE_STORAGE_KEYS.contractChanges, 'changeId', input),
    createPaymentPlan: (input) =>
      createRecord(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans, 'planId', input),
    createProjectReceipt: (input) =>
      createRecord(CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts, 'receiptId', input),

    updateContractChange: (input) =>
      updateRecord(CONTRACT_REVENUE_STORAGE_KEYS.contractChanges, 'changeId', input),
    updatePaymentPlan: (input) =>
      updateRecord(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans, 'planId', input),
    updateProjectReceipt: (input) =>
      updateRecord(CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts, 'receiptId', input),

    voidContractChange: (input, details) =>
      voidRecord(
        CONTRACT_REVENUE_STORAGE_KEYS.contractChanges,
        'changeId',
        input,
        details,
      ),
    voidPaymentPlan: (input, details) =>
      voidRecord(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans, 'planId', input, details),
    voidProjectReceipt: (input, details) =>
      voidRecord(
        CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts,
        'receiptId',
        input,
        details,
      ),

    persistProject: async (project) => {
      const sanitized = sanitizeProjectForPersistence(project)
      requireRecordId(sanitized, 'projectId')
      const writer = requireHook(overrides.persistProject || (upsertRecord ? (payload) => upsertRecord('projects', payload) : rpc ? (payload) => rpc('update_project_secure', { p_project_id: payload.projectId, p_patch: payload }) : null), '项目安全更新')
      await writer(sanitized)
      return sanitized
    },
  }
}

export const contractRevenueService = createContractRevenueService()

export const loadContractChanges = (...args) =>
  contractRevenueService.loadContractChanges(...args)
export const loadPaymentPlans = (...args) => contractRevenueService.loadPaymentPlans(...args)
export const loadProjectReceipts = (...args) =>
  contractRevenueService.loadProjectReceipts(...args)

export const createContractChange = (...args) =>
  contractRevenueService.createContractChange(...args)
export const createPaymentPlan = (...args) => contractRevenueService.createPaymentPlan(...args)
export const savePaymentPlanSet = (...args) => contractRevenueService.savePaymentPlanSet(...args)
export const createProjectReceipt = (...args) =>
  contractRevenueService.createProjectReceipt(...args)

export const updateContractChange = (...args) =>
  contractRevenueService.updateContractChange(...args)
export const updatePaymentPlan = (...args) => contractRevenueService.updatePaymentPlan(...args)
export const updateProjectReceipt = (...args) =>
  contractRevenueService.updateProjectReceipt(...args)

export const voidContractChange = (...args) =>
  contractRevenueService.voidContractChange(...args)
export const voidPaymentPlan = (...args) => contractRevenueService.voidPaymentPlan(...args)
export const voidProjectReceipt = (...args) =>
  contractRevenueService.voidProjectReceipt(...args)

export const persistSanitizedProject = (...args) =>
  contractRevenueService.persistProject(...args)

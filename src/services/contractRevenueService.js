export const CONTRACT_REVENUE_STORAGE_KEYS = Object.freeze({
  contractChanges: 'erp.projectContractChanges',
  paymentPlans: 'erp.projectPaymentPlans',
  projectReceipts: 'erp.projectReceipts',
})

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
  'unlockedStages',
  'lockedPlannedTaxInclusiveAmount',
  'remainingAssignableTaxInclusiveAmount',
  'unallocatedTaxInclusiveAmount',
  'lockedAmountExcess',
])

async function defaultGetList(storageKey) {
  const { getList } = await import('./baseRecordService.js')
  return getList(storageKey)
}

async function defaultUpsertRecord(storageKey, record) {
  const { upsertRecord } = await import('./baseRecordService.js')
  return upsertRecord(storageKey, record)
}

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
  const getList = overrides.getList || defaultGetList
  const upsertRecord = overrides.upsertRecord || defaultUpsertRecord
  // These hooks are the sole authorized persistence boundary for financial rows.
  // The generic hooks remain only as a backwards-compatible test seam.
  const readContractChanges = overrides.readContractChanges || (( ) => getList(CONTRACT_REVENUE_STORAGE_KEYS.contractChanges))
  const readPaymentPlans = overrides.readPaymentPlans || (() => getList(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans))
  const readProjectReceipts = overrides.readProjectReceipts || (() => getList(CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts))
  const writeContractChange = overrides.writeContractChange || ((record) => upsertRecord(CONTRACT_REVENUE_STORAGE_KEYS.contractChanges, record))
  const writePaymentPlan = overrides.writePaymentPlan || ((record) => upsertRecord(CONTRACT_REVENUE_STORAGE_KEYS.paymentPlans, record))
  const writeProjectReceipt = overrides.writeProjectReceipt || ((record) => upsertRecord(CONTRACT_REVENUE_STORAGE_KEYS.projectReceipts, record))
  const now = overrides.now || (() => new Date().toISOString())
  const randomUUID = overrides.randomUUID || defaultRandomUUID

  const loadRecords = async (storageKey) => {
    const records = await getList(storageKey)
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
      await upsertRecord('erp.projects', sanitized)
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

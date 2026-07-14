import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'
import { getRecordTableConfig } from './recordTableConfig.js'

const LEGACY_EMPLOYEE_STORAGE_KEY = 'erp.employees'
const CLIENT_AUDIT_FIELDS = Object.freeze([
  'created_by_employee_id',
  'created_by_employee_name',
  'updated_by_employee_id',
  'updated_by_employee_name',
  'createdByEmployeeId',
  'createdByEmployeeName',
  'updatedByEmployeeId',
  'updatedByEmployeeName',
])

export const LEGACY_MIGRATION_ALLOWED_STORAGE_KEYS = Object.freeze([
  'erp.projects',
  'erp.projectContractChanges',
  'erp.projectPaymentPlans',
  'erp.projectReceipts',
  'erp.laborRecords',
  'erp.purchaseRecords',
  'erp.purchasePaymentRecords',
  'erp.inventoryItems',
  'erp.stockInRecords',
  'erp.stockOutRecords',
  'erp.stockReturnRecords',
  'erp.toolRecords',
  'erp.toolBorrowRecords',
  'erp.toolReturnRecords',
  'erp.lifelongToolAssignments',
  'erp.toolResponsibilityRecords',
  'erp.vehicleRecords',
  'erp.vehicleUsageRecords',
  'erp.fuelRecords',
  'erp.vehicleExpenseRecords',
  'erp.vehicleIssueRecords',
  'erp.salaryRecords',
  'erp.projectCostRecords',
  'erp.operatingExpenseRecords',
])

const SAFE_ERRORS = Object.freeze({
  ACCESS_DENIED: { message: '没有权限执行此数据操作', status: 403 },
  AUTH_SERVICE_UNAVAILABLE: { message: '认证服务暂不可用，请稍后重试', status: 503 },
  AUTH_SESSION_INVALID: { message: '登录状态无效，请重新登录', status: 401 },
  CONFIGURATION_ERROR: { message: '云端数据服务未配置，请联系管理员', status: 503 },
  DATA_OPERATION_FAILED: { message: '云端数据操作失败，请稍后重试', status: 503 },
  LEGACY_EMPLOYEE_WRITE_DENIED: {
    message: '旧员工档案为只读兼容数据，不能通过业务表写入',
    status: 403,
  },
  MIGRATION_INPUT_INVALID: { message: '本机迁移数据格式无效', status: 400 },
  MIGRATION_STORAGE_UNAVAILABLE: { message: '本机迁移数据不可用', status: 503 },
  RECORD_NOT_FOUND: { message: '要修改的数据不存在或不可访问', status: 404 },
  STORAGE_KEY_NOT_ALLOWED: { message: '不支持的数据类型', status: 400 },
})

export class BusinessPersistenceError extends Error {
  constructor(code, options = {}) {
    const safe = SAFE_ERRORS[code] ?? SAFE_ERRORS.DATA_OPERATION_FAILED
    super(safe.message)
    this.name = 'BusinessPersistenceError'
    this.code = SAFE_ERRORS[code] ? code : 'DATA_OPERATION_FAILED'
    this.status = options.status ?? safe.status
  }
}

function safeError(code) {
  return new BusinessPersistenceError(code)
}

function normalizeSupplierError(error, fallbackCode = 'DATA_OPERATION_FAILED') {
  if (error instanceof BusinessPersistenceError) return error
  const status = Number(error?.status)
  const code = typeof error?.code === 'string' ? error.code.toUpperCase() : ''
  if (status === 401 || ['PGRST301', 'JWT_EXPIRED'].includes(code)) {
    return safeError('AUTH_SESSION_INVALID')
  }
  if (status === 403 || code === '42501') return safeError('ACCESS_DENIED')
  return safeError(fallbackCode)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isValidRecordEnvelope(row) {
  return (
    isPlainObject(row) &&
    typeof row.record_key === 'string' &&
    Boolean(row.record_key.trim()) &&
    isPlainObject(row.payload)
  )
}

function getRecordKey(record, recordKeyField) {
  const value =
    record?.[recordKeyField] ||
    record?.id ||
    record?.employeeId ||
    record?.projectId ||
    record?.purchaseId ||
    record?.toolId ||
    record?.vehicleId
  if (value !== undefined && value !== null && String(value)) return String(value)
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  throw safeError('DATA_OPERATION_FAILED')
}

function sanitizeRecordPayload(record) {
  const payload = record && typeof record === 'object' && !Array.isArray(record)
    ? { ...record }
    : {}
  for (const field of CLIENT_AUDIT_FIELDS) delete payload[field]
  return payload
}

function toRow(storageKey, record, now) {
  const config = getRecordTableConfig(storageKey)
  const payload = sanitizeRecordPayload(record)
  return {
    record_key: getRecordKey(payload, config.recordKeyField),
    payload,
    attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    status: payload.cloudStatus || payload.statusCode || 'active',
    updated_at: now().toISOString(),
  }
}

function dedupeRowsByRecordKey(rows) {
  const rowsByKey = new Map()
  for (const row of rows) rowsByKey.set(row.record_key, row)
  return [...rowsByKey.values()]
}

export function createBaseRecordService(
  client,
  {
    configured = Boolean(client),
    now = () => new Date(),
    storage = globalThis.localStorage,
  } = {},
) {
  function requireConfiguration() {
    if (!configured || !client?.auth || typeof client.from !== 'function') {
      throw safeError('CONFIGURATION_ERROR')
    }
  }

  function requireStorageConfig(storageKey) {
    const config = getRecordTableConfig(storageKey)
    if (!config) throw safeError('STORAGE_KEY_NOT_ALLOWED')
    return config
  }

  async function requireAuthenticatedSession() {
    requireConfiguration()
    let result
    try {
      result = await client.auth.getSession()
    } catch (error) {
      throw normalizeSupplierError(error, 'AUTH_SERVICE_UNAVAILABLE')
    }
    if (result?.error) {
      throw normalizeSupplierError(result.error, 'AUTH_SESSION_INVALID')
    }
    const session = result?.data?.session
    const nowSeconds = Math.floor(now().getTime() / 1000)
    if (
      typeof session?.access_token !== 'string' ||
      !session.access_token ||
      !Number.isFinite(session.expires_at) ||
      session.expires_at <= nowSeconds
    ) {
      throw safeError('AUTH_SESSION_INVALID')
    }
    return session
  }

  async function prepareOperation(storageKey, { write = false } = {}) {
    requireConfiguration()
    const config = requireStorageConfig(storageKey)
    await requireAuthenticatedSession()
    if (write && storageKey === LEGACY_EMPLOYEE_STORAGE_KEY) {
      throw safeError('LEGACY_EMPLOYEE_WRITE_DENIED')
    }
    return config
  }

  async function executeQuery(operation, fallbackCode = 'DATA_OPERATION_FAILED') {
    let result
    try {
      result = await operation()
    } catch (error) {
      throw normalizeSupplierError(error, fallbackCode)
    }
    if (result?.error) throw normalizeSupplierError(result.error, fallbackCode)
    return result?.data
  }

  async function executeSingleRecordMutation(operation) {
    const rows = await executeQuery(operation)
    if (!Array.isArray(rows) || rows.length !== 1) {
      throw safeError('ACCESS_DENIED')
    }
    return rows[0]
  }

  async function getList(storageKey) {
    const config = await prepareOperation(storageKey)
    const data = await executeQuery(() =>
      client
        .from(config.tableName)
        .select('record_key,payload,status,updated_at')
        .neq('status', 'deleted')
        .order('updated_at', { ascending: false }),
    )
    if (!Array.isArray(data) || data.some((row) => !isValidRecordEnvelope(row))) {
      throw safeError('DATA_OPERATION_FAILED')
    }
    return data.map((row) => row.payload)
  }

  async function getById(storageKey, recordKey) {
    const config = await prepareOperation(storageKey)
    const data = await executeQuery(() =>
      client
        .from(config.tableName)
        .select('payload')
        .eq('record_key', String(recordKey))
        .neq('status', 'deleted')
        .maybeSingle(),
    )
    if (data === null) return undefined
    if (!isPlainObject(data) || !isPlainObject(data.payload)) {
      throw safeError('DATA_OPERATION_FAILED')
    }
    return data.payload
  }

  async function saveList(storageKey, records) {
    const config = await prepareOperation(storageKey, { write: true })
    const list = Array.isArray(records) ? records : []
    const rows = dedupeRowsByRecordKey(list.map((record) => toRow(storageKey, record, now)))
    if (rows.length === 0) {
      return { saved: 0, failed: 0, skipped: false, errors: [] }
    }
    await executeQuery(() =>
      client.from(config.tableName).upsert(rows, { onConflict: 'record_key' }),
    )
    return { saved: rows.length, failed: 0, skipped: false, errors: [] }
  }

  async function upsertRecord(storageKey, record) {
    const config = await prepareOperation(storageKey, { write: true })
    const row = toRow(storageKey, record, now)
    await executeQuery(() =>
      client.from(config.tableName).upsert(row, { onConflict: 'record_key' }),
    )
    return { saved: 1, failed: 0, skipped: false }
  }

  async function create(storageKey, record) {
    const config = await prepareOperation(storageKey, { write: true })
    const row = toRow(storageKey, record, now)
    await executeQuery(() => client.from(config.tableName).insert(row))
    return { saved: 1, failed: 0, skipped: false }
  }

  async function update(storageKey, recordKey, patch) {
    const config = await prepareOperation(storageKey, { write: true })
    const existing = await executeQuery(() =>
      client
        .from(config.tableName)
        .select('record_key,payload,attachments,status')
        .eq('record_key', String(recordKey))
        .neq('status', 'deleted')
        .maybeSingle(),
    )
    if (!existing?.payload) throw safeError('RECORD_NOT_FOUND')

    const mergedRecord = {
      ...existing.payload,
      ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}),
      [config.recordKeyField]: existing.payload[config.recordKeyField] || String(recordKey),
    }
    const row = toRow(storageKey, mergedRecord, now)
    const updatePayload = {
      payload: row.payload,
      attachments: Array.isArray(row.payload.attachments)
        ? row.payload.attachments
        : existing.attachments || [],
      status:
        row.payload.cloudStatus || row.payload.statusCode || existing.status || 'active',
      updated_at: row.updated_at,
    }
    await executeSingleRecordMutation(() =>
      client
        .from(config.tableName)
        .update(updatePayload)
        .eq('record_key', String(recordKey))
        .select('record_key'),
    )
    return { saved: 1, failed: 0, skipped: false }
  }

  async function softDelete(storageKey, recordKey) {
    const config = await prepareOperation(storageKey, { write: true })
    await executeSingleRecordMutation(() =>
      client
        .from(config.tableName)
        .update({ status: 'deleted', updated_at: now().toISOString() })
        .eq('record_key', String(recordKey))
        .select('record_key'),
    )
    return { skipped: false }
  }

  async function migrateLocalStorageToSupabase(storageKeys) {
    await requireAuthenticatedSession()
    const requestedKeys = Array.isArray(storageKeys) ? storageKeys : []
    const allowlist = new Set(LEGACY_MIGRATION_ALLOWED_STORAGE_KEYS)
    const allowedKeys = [...new Set(requestedKeys)].filter((storageKey) =>
      allowlist.has(storageKey),
    )
    if (!storage || typeof storage.getItem !== 'function') {
      throw safeError('MIGRATION_STORAGE_UNAVAILABLE')
    }

    const results = []
    for (const storageKey of allowedKeys) {
      let records
      try {
        records = JSON.parse(storage.getItem(storageKey) || '[]')
      } catch {
        records = null
      }
      if (!Array.isArray(records)) {
        const error = safeError('MIGRATION_INPUT_INVALID')
        results.push({
          storageKey,
          saved: 0,
          failed: 1,
          errorCode: error.code,
          errors: [error.message],
        })
        continue
      }

      try {
        const result = await saveList(storageKey, records)
        results.push({
          storageKey,
          saved: result.saved,
          failed: result.failed,
          errorCode: null,
          errors: [],
        })
      } catch (supplierError) {
        const error = normalizeSupplierError(supplierError)
        results.push({
          storageKey,
          saved: 0,
          failed: records.length,
          errorCode: error.code,
          errors: [error.message],
        })
        if ([401, 403].includes(error.status)) break
      }
    }
    return results
  }

  return Object.freeze({
    create,
    getById,
    getList,
    migrateLocalStorageToSupabase,
    saveList,
    softDelete,
    update,
    upsertRecord,
  })
}

const baseRecordService = createBaseRecordService(supabase, {
  configured: isSupabaseConfigured,
})

export function isCloudDatabaseReady() {
  return isSupabaseConfigured
}

export const getList = (...args) => baseRecordService.getList(...args)
export const getById = (...args) => baseRecordService.getById(...args)
export const saveList = (...args) => baseRecordService.saveList(...args)
export const upsertRecord = (...args) => baseRecordService.upsertRecord(...args)
export const create = (...args) => baseRecordService.create(...args)
export const update = (...args) => baseRecordService.update(...args)
export const softDelete = (...args) => baseRecordService.softDelete(...args)
export const migrateLocalStorageToSupabase = (...args) =>
  baseRecordService.migrateLocalStorageToSupabase(...args)

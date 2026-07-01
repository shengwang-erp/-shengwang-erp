import { isSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { getRecordTableConfig, recordTableConfigs } from './recordTableConfig'

function readCurrentUser() {
  try {
    return JSON.parse(window.localStorage.getItem('currentUser') || 'null')
  } catch {
    return null
  }
}

function getRecordKey(record, recordKeyField) {
  return (
    record?.[recordKeyField] ||
    record?.id ||
    record?.employeeId ||
    record?.projectId ||
    record?.purchaseId ||
    record?.toolId ||
    record?.vehicleId ||
    crypto.randomUUID()
  )
}

function toRow(storageKey, record, currentUser, existingKeySet = new Set()) {
  const config = getRecordTableConfig(storageKey)
  const recordKey = String(getRecordKey(record, config.recordKeyField))
  const isExisting = existingKeySet.has(recordKey)
  const now = new Date().toISOString()

  return {
    record_key: recordKey,
    payload: record,
    attachments: record?.attachments || [],
    status: record?.cloudStatus || record?.statusCode || 'active',
    updated_at: now,
    updated_by_employee_id: currentUser?.employeeId || '',
    updated_by_employee_name: currentUser?.name || '',
    ...(isExisting
      ? {}
      : {
          created_by_employee_id: currentUser?.employeeId || '',
          created_by_employee_name: currentUser?.name || '',
        }),
  }
}

function dedupeRowsByRecordKey(rows) {
  const rowMap = new Map()
  rows.forEach((row) => {
    rowMap.set(row.record_key, row)
  })
  return [...rowMap.values()]
}

async function upsertRowsWithFallback(tableName, rows) {
  if (rows.length === 0) return { saved: 0, failed: 0, errors: [] }

  const { error } = await supabase
    .from(tableName)
    .upsert(rows, { onConflict: 'record_key' })

  if (!error) return { saved: rows.length, failed: 0, errors: [] }

  let saved = 0
  let failed = 0
  const errors = []

  for (const row of rows) {
    const { error: rowError } = await supabase
      .from(tableName)
      .upsert(row, { onConflict: 'record_key' })

    if (rowError) {
      failed += 1
      errors.push(`${row.record_key}: ${rowError.message}`)
    } else {
      saved += 1
    }
  }

  return { saved, failed, errors }
}

export function isCloudDatabaseReady() {
  return isSupabaseConfigured
}

export async function getList(storageKey) {
  const config = getRecordTableConfig(storageKey)
  if (!isSupabaseConfigured || !config) return undefined

  const { data, error } = await supabase
    .from(config.tableName)
    .select('record_key,payload,status,updated_at')
    .neq('status', 'deleted')
    .order('updated_at', { ascending: false })

  if (error) throw error
  return (data || []).map((row) => row.payload).filter(Boolean)
}

export async function saveList(storageKey, records) {
  const config = getRecordTableConfig(storageKey)
  if (!isSupabaseConfigured || !config) return { saved: 0, failed: 0, skipped: true }

  const currentUser = readCurrentUser()
  const list = Array.isArray(records) ? records : []
  const { data: existingRows, error: existingError } = await supabase
    .from(config.tableName)
    .select('record_key,status')

  if (existingError) throw existingError

  const existingKeySet = new Set((existingRows || []).map((row) => row.record_key))
  const nextKeySet = new Set(list.map((record) => String(getRecordKey(record, config.recordKeyField))))
  const rows = dedupeRowsByRecordKey(
    list.map((record) => toRow(storageKey, record, currentUser, existingKeySet)),
  )

  let saved = 0
  let failed = 0
  let errors = []

  if (rows.length > 0) {
    const result = await upsertRowsWithFallback(config.tableName, rows)
    saved += result.saved
    failed += result.failed
    errors = [...errors, ...result.errors]
  }

  const missingKeys = [...existingKeySet].filter(
    (recordKey) =>
      !nextKeySet.has(recordKey) &&
      !(config.tableName === 'employees' && recordKey === 'SUPER_ADMIN'),
  )
  if (missingKeys.length > 0) {
    const { error } = await supabase
      .from(config.tableName)
      .update({
        status: 'deleted',
        updated_at: new Date().toISOString(),
        updated_by_employee_id: currentUser?.employeeId || '',
        updated_by_employee_name: currentUser?.name || '',
      })
      .in('record_key', missingKeys)

    if (error) {
      failed += missingKeys.length
      errors.push(error.message)
    }
  }

  if (saved === 0 && failed > 0) {
    throw new Error(errors.join('\n') || 'Supabase 保存失败')
  }

  return { saved, failed, skipped: false, errors }
}

export async function upsertRecord(storageKey, record) {
  const config = getRecordTableConfig(storageKey)
  if (!isSupabaseConfigured || !config) return { saved: 0, failed: 0, skipped: true }

  const { data: existingRows, error: existingError } = await supabase
    .from(config.tableName)
    .select('record_key,status')

  if (existingError) throw existingError

  const existingKeySet = new Set((existingRows || []).map((row) => row.record_key))
  const currentUser = readCurrentUser()
  const row = toRow(storageKey, record, currentUser, existingKeySet)
  const { error } = await supabase
    .from(config.tableName)
    .upsert(row, { onConflict: 'record_key' })

  if (error) throw error
  return { saved: 1, failed: 0, skipped: false }
}

export async function getById(storageKey, recordKey) {
  const config = getRecordTableConfig(storageKey)
  if (!isSupabaseConfigured || !config) return undefined

  const { data, error } = await supabase
    .from(config.tableName)
    .select('payload')
    .eq('record_key', recordKey)
    .neq('status', 'deleted')
    .maybeSingle()

  if (error) throw error
  return data?.payload
}

export async function create(storageKey, record) {
  const current = await getList(storageKey)
  return saveList(storageKey, [record, ...(current || [])])
}

export async function update(storageKey, recordKey, patch) {
  const current = await getList(storageKey)
  const next = (current || []).map((record) => {
    const config = getRecordTableConfig(storageKey)
    return String(getRecordKey(record, config.recordKeyField)) === String(recordKey)
      ? { ...record, ...patch }
      : record
  })
  return saveList(storageKey, next)
}

export async function softDelete(storageKey, recordKey) {
  const config = getRecordTableConfig(storageKey)
  if (!isSupabaseConfigured || !config) return { skipped: true }
  const currentUser = readCurrentUser()

  const { error } = await supabase
    .from(config.tableName)
    .update({
      status: 'deleted',
      updated_at: new Date().toISOString(),
      updated_by_employee_id: currentUser?.employeeId || '',
      updated_by_employee_name: currentUser?.name || '',
    })
    .eq('record_key', recordKey)

  if (error) throw error
  return { skipped: false }
}

export async function migrateLocalStorageToSupabase(storageKeys) {
  const entries = storageKeys
    .filter((storageKey) => recordTableConfigs[storageKey])
    .map((storageKey) => {
      try {
        return [storageKey, JSON.parse(window.localStorage.getItem(storageKey) || '[]')]
      } catch {
        return [storageKey, []]
      }
    })

  const results = []
  for (const [storageKey, records] of entries) {
    try {
      const result = await saveList(storageKey, records)
      results.push({
        storageKey,
        saved: result.saved || 0,
        failed: result.failed || 0,
        errors: result.errors || [],
      })
    } catch (error) {
      results.push({
        storageKey,
        saved: 0,
        failed: Array.isArray(records) ? records.length : 1,
        errors: [error.message || '保存失败，请检查网络后重试'],
      })
    }
  }

  return results
}

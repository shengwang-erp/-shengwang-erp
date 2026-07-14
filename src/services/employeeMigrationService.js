export const LEGACY_EMPLOYEE_STORAGE_KEY = 'erp.employees'

const LEGACY_HIDDEN_RECOVERY_IDS = new Set(['SUPER_ADMIN'])

const LEGACY_AUTH_FIELDS = new Set([
  'passwordHash',
  'password_hash',
  'password',
  'username',
  'loginAccount',
  'login_account',
  'loginEnabled',
  'login_enabled',
  'mustChangePassword',
  'must_change_password',
  'role',
  'accessibleModules',
  'accessible_modules',
  'canCreateModules',
  'can_create_modules',
  'canEditModules',
  'can_edit_modules',
  'canDeleteModules',
  'can_delete_modules',
  'sensitivePermissions',
  'sensitive_permissions',
  'authProvider',
  'auth_provider',
  'authUserId',
  'auth_user_id',
  'internalAuthAlias',
  'internal_auth_alias',
  'authSession',
  'auth_session',
  'session',
  'sessionToken',
  'session_token',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'lastLoginAt',
  'last_login_at',
  'currentUser',
  'current_user',
  'isHiddenSystemAccount',
  'is_hidden_system_account',
])

const EMPLOYEE_REFERENCE_FIELDS = new Set([
  'employeeId',
  'operatorId',
  'handlerEmployeeId',
  'responsibleEmployeeId',
  'currentHolderEmployeeId',
])

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue(value) {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value))
}

function payloadForRow(row) {
  return isPlainObject(row?.payload) ? row.payload : row
}

function legacyIdForRow(row) {
  const payload = payloadForRow(row)
  const value = payload?.employeeId ?? payload?.id
  return value === undefined || value === null ? '' : String(value).trim()
}

function statusForRow(row) {
  const payload = payloadForRow(row)
  return String(row?.status || payload?.cloudStatus || payload?.statusCode || 'active')
}

function hiddenRecoveryReasons(row) {
  const payload = payloadForRow(row)
  const reasons = []
  const identifiers = [row?.record_key, payload?.employeeId, payload?.id]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toUpperCase())
  if (identifiers.some((value) => LEGACY_HIDDEN_RECOVERY_IDS.has(value))) {
    reasons.push('reserved_recovery_id')
  }
  if (
    payload?.isHiddenSystemAccount === true ||
    payload?.is_hidden_system_account === true
  ) {
    reasons.push('hidden_system_account')
  }
  if (payload?.role === ['super', 'admin'].join('_')) {
    reasons.push('privileged_legacy_role')
  }
  const markerText = [payload?.name, payload?.position, payload?.source]
    .filter((value) => typeof value === 'string')
    .join(' ')
  if (/恢复|超级管理员|system\s*recovery/iu.test(markerText)) {
    reasons.push('recovery_marker')
  }
  return reasons
}

function sanitizePayload(payload) {
  const sanitized = cloneValue(isPlainObject(payload) ? payload : {})
  for (const field of LEGACY_AUTH_FIELDS) delete sanitized[field]
  return sanitized
}

function sanitizeRow(row) {
  if (!isPlainObject(row?.payload)) return sanitizePayload(row)
  const envelope = sanitizePayload(row)
  envelope.payload = sanitizePayload(row.payload)
  return envelope
}

function malformedRowReason(row) {
  if (!isPlainObject(row)) return 'row_not_plain_object'
  if (
    Object.prototype.hasOwnProperty.call(row, 'payload') &&
    !isPlainObject(row.payload)
  ) {
    return 'payload_not_plain_object'
  }
  return ''
}

function readRows(rows, storage) {
  if (rows !== undefined) {
    return {
      source: 'supplied',
      rows: Array.isArray(rows) ? rows : [],
      warnings: Array.isArray(rows)
        ? []
        : [{ code: 'LEGACY_EMPLOYEE_ROWS_INVALID', message: '旧员工档案必须是数组' }],
    }
  }

  if (!storage || typeof storage.getItem !== 'function') {
    return {
      source: 'local-storage',
      rows: [],
      warnings: [
        { code: 'LEGACY_EMPLOYEE_STORAGE_UNAVAILABLE', message: '旧员工档案不可读取' },
      ],
    }
  }

  try {
    const parsed = JSON.parse(storage.getItem(LEGACY_EMPLOYEE_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) throw new TypeError('not an array')
    return { source: 'local-storage', rows: parsed, warnings: [] }
  } catch {
    return {
      source: 'local-storage',
      rows: [],
      warnings: [
        { code: 'LEGACY_EMPLOYEE_JSON_INVALID', message: '旧员工档案 JSON 无法解析' },
      ],
    }
  }
}

function findManualReferences(referenceCollections, legacyIds) {
  if (!isPlainObject(referenceCollections)) return []
  const references = []
  for (const [storageKey, records] of Object.entries(referenceCollections)) {
    if (!Array.isArray(records)) continue
    records.forEach((record, recordIndex) => {
      if (!isPlainObject(record)) return
      for (const [field, value] of Object.entries(record)) {
        const isEmployeeReference =
          EMPLOYEE_REFERENCE_FIELDS.has(field) || /EmployeeId$/u.test(field)
        if (!isEmployeeReference || typeof value !== 'string' || !legacyIds.has(value)) {
          continue
        }
        references.push({ storageKey, recordIndex, field, legacyId: value })
      }
    })
  }
  return references
}

export function createLegacyEmployeeMigrationReport({
  rows,
  storage = globalThis.localStorage,
  referenceCollections = {},
} = {}) {
  const input = readRows(rows, storage)
  const idIndices = new Map()
  const missingIds = []
  const recordKeyMismatches = []
  const malformedRows = []
  const hiddenRecoveryRows = []
  const deletedRows = []
  const sanitizedRows = []

  input.rows.forEach((row, index) => {
    const malformedReason = malformedRowReason(row)
    if (malformedReason) {
      malformedRows.push({ index, reason: malformedReason })
      return
    }

    const legacyId = legacyIdForRow(row)
    if (!legacyId) {
      missingIds.push({ index })
    } else {
      const indices = idIndices.get(legacyId) || []
      indices.push(index)
      idIndices.set(legacyId, indices)
    }

    const recordKey = row?.record_key
    if (
      typeof recordKey === 'string' &&
      recordKey &&
      legacyId &&
      recordKey !== legacyId
    ) {
      recordKeyMismatches.push({ index, recordKey, legacyId })
    }

    const reasons = hiddenRecoveryReasons(row)
    if (reasons.length > 0) {
      hiddenRecoveryRows.push({ index, legacyId, reasons })
    } else {
      sanitizedRows.push(sanitizeRow(row))
    }

    const status = statusForRow(row)
    if (status === 'deleted') deletedRows.push({ index, legacyId, status })
  })

  const duplicateIds = [...idIndices.entries()]
    .filter(([, indices]) => indices.length > 1)
    .map(([legacyId, indices]) => ({ legacyId, indices }))
    .sort((left, right) => left.legacyId.localeCompare(right.legacyId))
  const legacyIds = [...idIndices.keys()].sort((left, right) =>
    left.localeCompare(right),
  )
  const manualReferences = findManualReferences(
    referenceCollections,
    new Set(legacyIds),
  )

  return {
    source: input.source,
    writePolicy: 'report-only',
    requiresExplicitServerAdminWrite: true,
    summary: {
      totalRows: input.rows.length,
      sanitizedRows: sanitizedRows.length,
      malformedRows: malformedRows.length,
      hiddenRecoveryRows: hiddenRecoveryRows.length,
      deletedRows: deletedRows.length,
      duplicateIds: duplicateIds.length,
      missingIds: missingIds.length,
      recordKeyMismatches: recordKeyMismatches.length,
      manualReferences: manualReferences.length,
    },
    legacyIds,
    duplicateIds,
    missingIds,
    recordKeyMismatches,
    malformedRows,
    hiddenRecoveryRows,
    deletedRows,
    manualReferences,
    sanitizedRows,
    warnings: input.warnings,
  }
}

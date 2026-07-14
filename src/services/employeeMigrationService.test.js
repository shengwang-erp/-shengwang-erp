import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LEGACY_EMPLOYEE_STORAGE_KEY,
  createLegacyEmployeeMigrationReport,
} from './employeeMigrationService.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

test('legacy employee report identifies IDs, duplicates, gaps, mismatches, hidden rows, and deletions', () => {
  const rows = [
    {
      record_key: 'E001',
      payload: {
        employeeId: 'E001',
        name: '历史员工一',
        passwordHash: 'LegacyOnlyValue9',
        username: 'legacy-login',
        loginEnabled: true,
        mustChangePassword: true,
        role: 'manager',
        accessibleModules: ['工程项目'],
        canCreateModules: ['工程项目'],
        canEditModules: ['工程项目'],
        canDeleteModules: ['工程项目'],
        sensitivePermissions: ['查看工资'],
        authProvider: 'password',
        authSession: { token: 'legacy-session' },
        accessToken: 'legacy-access',
        refreshToken: 'legacy-refresh',
        phone: '09000000000',
      },
      status: 'active',
    },
    { employeeId: 'E001', name: '重复员工号' },
    { name: '缺少员工号' },
    {
      record_key: 'RECOVERY-ROW',
      payload: {
        employeeId: 'RECOVERY-ROW',
        name: '系统恢复记录',
        isHiddenSystemAccount: true,
        role: ['super', 'admin'].join('_'),
      },
      status: 'active',
    },
    {
      record_key: 'ROW-E004',
      payload: { employeeId: 'E004', name: '已删除员工' },
      status: 'deleted',
    },
  ]
  const original = clone(rows)

  const report = createLegacyEmployeeMigrationReport({ rows })

  assert.equal(report.source, 'supplied')
  assert.deepEqual(report.legacyIds, ['E001', 'E004', 'RECOVERY-ROW'])
  assert.deepEqual(report.duplicateIds, [{ legacyId: 'E001', indices: [0, 1] }])
  assert.deepEqual(report.missingIds, [{ index: 2 }])
  assert.deepEqual(report.recordKeyMismatches, [
    { index: 4, recordKey: 'ROW-E004', legacyId: 'E004' },
  ])
  assert.deepEqual(report.hiddenRecoveryRows, [
    {
      index: 3,
      legacyId: 'RECOVERY-ROW',
      reasons: ['hidden_system_account', 'privileged_legacy_role', 'recovery_marker'],
    },
  ])
  assert.deepEqual(report.deletedRows, [
    { index: 4, legacyId: 'E004', status: 'deleted' },
  ])
  assert.deepEqual(report.summary, {
    totalRows: 5,
    sanitizedRows: 4,
    malformedRows: 0,
    hiddenRecoveryRows: 1,
    deletedRows: 1,
    duplicateIds: 1,
    missingIds: 1,
    recordKeyMismatches: 1,
    manualReferences: 0,
  })
  assert.deepEqual(rows, original)
})

test('sanitized copies remove legacy authentication and personal permission fields without mutating source', () => {
  const row = {
    employeeId: 'E001',
    name: '历史员工',
    department: '工程部',
    passwordHash: 'LegacyOnlyValue9',
    username: 'legacy-login',
    loginAccount: 'legacy-account',
    loginEnabled: true,
    mustChangePassword: true,
    role: 'manager',
    accessibleModules: ['工程项目'],
    canCreateModules: ['工程项目'],
    canEditModules: ['工程项目'],
    canDeleteModules: ['工程项目'],
    sensitivePermissions: ['查看工资'],
    authProvider: 'password',
    authUserId: 'auth-user-id',
    internalAuthAlias: 'hidden-alias',
    session: { access_token: 'session-token' },
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    lastLoginAt: '2026-01-01T00:00:00.000Z',
    isHiddenSystemAccount: false,
  }
  const original = clone(row)

  const report = createLegacyEmployeeMigrationReport({ rows: [row] })
  const [sanitized] = report.sanitizedRows

  assert.deepEqual(sanitized, {
    employeeId: 'E001',
    name: '历史员工',
    department: '工程部',
  })
  assert.deepEqual(row, original)
  assert.equal(report.writePolicy, 'report-only')
  assert.equal(report.requiresExplicitServerAdminWrite, true)
})

test('hidden recovery payloads are reported but never included in sanitized output', () => {
  const report = createLegacyEmployeeMigrationReport({
    rows: [
      { employeeId: 'E001', name: '普通历史员工' },
      {
        employeeId: 'RECOVERY-ROW',
        name: '隐藏恢复账号',
        isHiddenSystemAccount: true,
        passwordHash: 'LegacyOnlyValue9',
      },
    ],
  })

  assert.deepEqual(report.sanitizedRows, [
    { employeeId: 'E001', name: '普通历史员工' },
  ])
  assert.equal(report.hiddenRecoveryRows.length, 1)
  assert.equal(JSON.stringify(report).includes('LegacyOnlyValue9'), false)
})

test('reserved legacy recovery IDs are hidden even when names and flags were changed', () => {
  const report = createLegacyEmployeeMigrationReport({
    rows: [
      {
        record_key: 'SUPER_ADMIN',
        payload: { employeeId: 'E001', name: '已改名记录' },
      },
      { employeeId: 'SUPER_ADMIN', name: 'Legacy Root' },
      {
        record_key: 'ROW-E002',
        payload: {
          employeeId: 'E002',
          id: 'SUPER_ADMIN',
          name: '再次改名记录',
        },
      },
    ],
  })

  assert.deepEqual(report.sanitizedRows, [])
  assert.deepEqual(
    report.hiddenRecoveryRows.map(({ index, reasons }) => ({ index, reasons })),
    [
      { index: 0, reasons: ['reserved_recovery_id'] },
      { index: 1, reasons: ['reserved_recovery_id'] },
      { index: 2, reasons: ['reserved_recovery_id'] },
    ],
  )
})

test('non-plain envelope payloads are quarantined without leaking secrets', () => {
  const row = {
    record_key: 'E200',
    payload: [{ access_token: 'array-payload-secret' }],
    status: 'active',
  }
  const original = clone(row)

  const report = createLegacyEmployeeMigrationReport({ rows: [row] })

  assert.deepEqual(report.sanitizedRows, [])
  assert.deepEqual(report.malformedRows, [
    { index: 0, reason: 'payload_not_plain_object' },
  ])
  assert.equal(report.summary.malformedRows, 1)
  assert.equal(JSON.stringify(report).includes('array-payload-secret'), false)
  assert.deepEqual(row, original)
})

test('sanitized envelope and payload remove snake-case authentication fields without secret output', () => {
  const row = {
    record_key: 'E100',
    safeEnvelope: 'keep-envelope',
    auth_user_id: 'envelope-auth-secret',
    access_token: 'envelope-access-secret',
    payload: {
      employeeId: 'E100',
      name: '历史员工',
      safePayload: 'keep-payload',
      is_hidden_system_account: false,
      password_hash: 'snake-password-secret',
      auth_user_id: 'payload-auth-secret',
      auth_provider: 'legacy-password-provider',
      session_token: 'snake-session-secret',
      access_token: 'snake-access-secret',
      refresh_token: 'snake-refresh-secret',
      must_change_password: true,
    },
  }
  const original = clone(row)

  const report = createLegacyEmployeeMigrationReport({ rows: [row] })

  assert.deepEqual(report.sanitizedRows, [
    {
      record_key: 'E100',
      safeEnvelope: 'keep-envelope',
      payload: {
        employeeId: 'E100',
        name: '历史员工',
        safePayload: 'keep-payload',
      },
    },
  ])
  assert.deepEqual(row, original)
  for (const secret of [
    'envelope-auth-secret',
    'envelope-access-secret',
    'snake-password-secret',
    'payload-auth-secret',
    'legacy-password-provider',
    'snake-session-secret',
    'snake-access-secret',
    'snake-refresh-secret',
  ]) {
    assert.equal(JSON.stringify(report).includes(secret), false)
  }
})

test('business references are reported for manual mapping and are never rewritten', () => {
  const referenceCollections = {
    'erp.laborRecords': [
      {
        laborRecordId: 'L001',
        employeeId: 'E001',
        handlerEmployeeId: 'E002',
        unrelatedId: 'P001',
      },
    ],
    'erp.vehicleRecords': [
      { vehicleId: 'V001', responsibleEmployeeId: 'E001' },
    ],
  }
  const originalReferences = clone(referenceCollections)

  const report = createLegacyEmployeeMigrationReport({
    rows: [
      { employeeId: 'E001', name: '历史员工一' },
      { employeeId: 'E002', name: '历史员工二' },
    ],
    referenceCollections,
  })

  assert.deepEqual(report.manualReferences, [
    {
      storageKey: 'erp.laborRecords',
      recordIndex: 0,
      field: 'employeeId',
      legacyId: 'E001',
    },
    {
      storageKey: 'erp.laborRecords',
      recordIndex: 0,
      field: 'handlerEmployeeId',
      legacyId: 'E002',
    },
    {
      storageKey: 'erp.vehicleRecords',
      recordIndex: 0,
      field: 'responsibleEmployeeId',
      legacyId: 'E001',
    },
  ])
  assert.deepEqual(referenceCollections, originalReferences)
  assert.equal(report.summary.manualReferences, 3)
})

test('local inspection reads only erp.employees and invalid JSON produces a safe report', () => {
  const reads = []
  const validStorage = {
    getItem(key) {
      reads.push(key)
      return JSON.stringify([{ employeeId: 'E001', name: '历史员工' }])
    },
  }

  const validReport = createLegacyEmployeeMigrationReport({ storage: validStorage })
  assert.deepEqual(reads, [LEGACY_EMPLOYEE_STORAGE_KEY])
  assert.equal(validReport.source, 'local-storage')
  assert.equal(validReport.summary.totalRows, 1)

  const invalidReport = createLegacyEmployeeMigrationReport({
    storage: { getItem: () => '{private malformed payload' },
  })
  assert.equal(invalidReport.summary.totalRows, 0)
  assert.deepEqual(invalidReport.warnings, [
    { code: 'LEGACY_EMPLOYEE_JSON_INVALID', message: '旧员工档案 JSON 无法解析' },
  ])
  assert.equal(JSON.stringify(invalidReport).includes('private malformed'), false)
})

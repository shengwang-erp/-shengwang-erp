import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import test from 'node:test'

import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
  buildInternalAuthAlias,
  generateTemporaryPassword,
  isEmployeeNumber,
  isPersonnelAdministrator,
  mergePermissionKeys,
  normalizeEmployeeNumber,
} from './employeeAuthDomain.js'
import {
  canAccessModule,
  canCreate,
  canDelete,
  canEdit,
  canViewSensitive,
  getPermissionDefaults,
  isSuperAdmin,
  normalizePermissionFields,
} from '../utils/permissions.js'

test('exports the fixed department list in business order', () => {
  assert.deepEqual(DEPARTMENT_OPTIONS, [
    '总务部',
    '营业部',
    '事务部',
    '后勤部',
    '设计部',
    '工程部',
    '仓库管理部',
    '电商部',
    '采购部',
    '财务部',
  ])
})

test('exports the fixed position list in business order', () => {
  assert.deepEqual(POSITION_OPTIONS, [
    '社长',
    '总务部长',
    '营业部长',
    '部长',
    '主任',
    '主任设计师',
    '设计师',
    '仓库管理员',
    '工事部长',
    '职长',
    '大工',
    '中工',
    '小工',
    '会计主管',
    '会计',
  ])
})

test('normalizes employee numbers with trim and uppercase only', () => {
  assert.equal(normalizeEmployeeNumber(' sw-000 '), 'SW-000')
  assert.equal(normalizeEmployeeNumber('sw-001'), 'SW-001')
  assert.equal(normalizeEmployeeNumber(' sw-1 '), 'SW-1')
  assert.equal(normalizeEmployeeNumber(null), '')
})

test('accepts SW employee numbers with at least three digits and rejects invalid values', () => {
  for (const value of ['SW-000', 'SW-001', 'SW-999', 'SW-1000', ' sw-001 ']) {
    assert.equal(isEmployeeNumber(value), true, value)
  }

  for (const value of ['', 'SW-1', 'SW-01', 'SW001', 'XX-001', 'SW-ABC', null]) {
    assert.equal(isEmployeeNumber(value), false, String(value))
  }
})

test('builds the deterministic opaque internal Auth alias with HMAC-SHA256', async () => {
  const alias = await buildInternalAuthAlias(' sw-001 ', 'test-secret', webcrypto)

  assert.equal(
    alias,
    'sw-4EE6aNeHyUq9RI-dX9Heubp8UdWeBxbxjD0elz43fXQ@auth.invalid',
  )
  assert.doesNotMatch(alias, /SW-001/i)
})

test('generates a six-digit temporary password as a string', () => {
  const password = generateTemporaryPassword((size) =>
    Uint8Array.from({ length: size }, (_, index) => index),
  )

  assert.equal(password, '012345')
  assert.match(password, /^[0-9]{6}$/u)
})

test('merges department and position permission keys without duplicates', () => {
  assert.deepEqual(
    mergePermissionKeys(
      ['module.projects.view', 'module.projects.update'],
      ['module.projects.update', 'module.labor.view'],
    ),
    ['module.projects.view', 'module.projects.update', 'module.labor.view'],
  )
  assert.deepEqual(mergePermissionKeys(undefined, null), [])
})

test('allows SW-000 to administer personnel regardless of account state', () => {
  assert.equal(
    isPersonnelAdministrator({
      employeeNumber: ' sw-000 ',
      accountStatus: 'disabled',
      employmentStatus: '离职',
      position: '小工',
    }),
    true,
  )
})

test('allows only active and employed presidents to administer personnel', () => {
  assert.equal(
    isPersonnelAdministrator({
      employeeNumber: 'SW-001',
      accountStatus: 'active',
      employmentStatus: '在职',
      position: '社长',
    }),
    true,
  )
  assert.equal(
    isPersonnelAdministrator({
      employee_number: 'SW-002',
      account_status: 'active',
      employment_status: '在职',
      position: '社长',
    }),
    true,
  )

  for (const employee of [
    { accountStatus: 'disabled', employmentStatus: '在职', position: '社长' },
    { accountStatus: 'active', employmentStatus: '离职', position: '社长' },
    { accountStatus: 'active', employmentStatus: '在职', position: '部长' },
  ]) {
    assert.equal(isPersonnelAdministrator(employee), false)
  }
})

test('permission helpers translate UI labels to effective stable permission keys', () => {
  const employee = {
    effectivePermissionKeys: [
      'module.projects.view',
      'module.projects.create',
      'module.projects.update',
      'module.projects.delete',
      'sensitive.salary_view',
    ],
  }

  assert.equal(canAccessModule(employee, '工程项目'), true)
  assert.equal(canCreate(employee, '工程项目'), true)
  assert.equal(canEdit(employee, '工程项目'), true)
  assert.equal(canDelete(employee, '工程项目'), true)
  assert.equal(canViewSensitive(employee, '查看工资'), true)
  assert.equal(canAccessModule(employee, '人员管理'), false)
})

test('legacy employee-specific permission arrays no longer grant authorization', () => {
  const employee = {
    role: 'employee',
    accessibleModules: ['工程项目'],
    canCreateModules: ['工程项目'],
    canEditModules: ['工程项目'],
    canDeleteModules: ['工程项目'],
    sensitivePermissions: ['查看工资'],
  }

  assert.equal(canAccessModule(employee, '工程项目'), false)
  assert.equal(canCreate(employee, '工程项目'), false)
  assert.equal(canEdit(employee, '工程项目'), false)
  assert.equal(canDelete(employee, '工程项目'), false)
  assert.equal(canViewSensitive(employee, '查看工资'), false)
})

test('SW-000 and transitional all keys keep full UI authorization', () => {
  const systemAdministrator = { employeeNumber: ' sw-000 ' }
  const transitionalAdministrator = { effectivePermissionKeys: ['all'] }

  assert.equal(isSuperAdmin(systemAdministrator), true)
  assert.equal(canAccessModule(systemAdministrator, '系统设置'), true)
  assert.equal(canViewSensitive(systemAdministrator, '查看利润'), true)
  assert.equal(canAccessModule(transitionalAdministrator, '系统设置'), true)
  assert.equal(canViewSensitive(transitionalAdministrator, '查看利润'), true)
})

test('legacy super_admin role cannot grant authorization to a non-SW-000 employee', () => {
  const legacyRoleEmployee = {
    employeeNumber: 'SW-001',
    role: 'super_admin',
  }
  const normalizedEmployee = normalizePermissionFields(legacyRoleEmployee)

  assert.equal(isSuperAdmin(legacyRoleEmployee), false)
  assert.deepEqual(normalizedEmployee.effectivePermissionKeys, [])

  for (const employee of [legacyRoleEmployee, normalizedEmployee]) {
    assert.equal(canAccessModule(employee, '工程项目'), false)
    assert.equal(canCreate(employee, '工程项目'), false)
    assert.equal(canEdit(employee, '工程项目'), false)
    assert.equal(canDelete(employee, '工程项目'), false)
    assert.equal(canViewSensitive(employee, '查看工资'), false)
  }
})

test('permission normalization preserves effective keys and gives positions no personal defaults', () => {
  assert.deepEqual(getPermissionDefaults('社长'), {
    role: 'employee',
    accessibleModules: [],
    canCreateModules: [],
    canEditModules: [],
    canDeleteModules: [],
    sensitivePermissions: [],
    effectivePermissionKeys: [],
  })

  assert.deepEqual(
    normalizePermissionFields({
      effectivePermissionKeys: ['module.inventory.view'],
    }).effectivePermissionKeys,
    ['module.inventory.view'],
  )
})

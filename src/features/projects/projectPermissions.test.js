import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canCreateTypedProject,
  canDeleteTypedProject,
  canEditTypedProject,
  canManageMiraisyaSettlement,
  canUpdateProjectFinancials,
  canViewProjectFinancials,
  isProjectFinancialWhitelistEmployee,
} from './projectPermissions.js'

const activeEmployee = Object.freeze({
  employeeNumber: 'SW-100',
  department: '工程部',
  position: '职长',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys: [
    'module.projects.view',
    'module.projects.update',
  ],
})

test('the fixed four identities are whitelisted and ordinary project staff are not', () => {
  for (
    const identity of [
      { department: '设计部' },
      { department: '财务部' },
      { position: '社长' },
      { employeeNumber: 'SW-000' },
    ]
  ) {
    assert.equal(
      isProjectFinancialWhitelistEmployee({
        ...activeEmployee,
        ...identity,
      }),
      true,
    )
  }

  assert.equal(isProjectFinancialWhitelistEmployee(activeEmployee), false)
})

test('identity membership is pure while access helpers fail closed on account state', () => {
  const employees = [
    { ...activeEmployee, department: '设计部', employmentStatus: '离职' },
    { ...activeEmployee, department: '财务部', accountStatus: 'disabled' },
    { ...activeEmployee, position: '社长', mustChangePassword: true },
  ]

  for (const employee of employees) {
    assert.equal(isProjectFinancialWhitelistEmployee(employee), true)
    assert.equal(canViewProjectFinancials(employee), false)
    assert.equal(canUpdateProjectFinancials(employee), false)
  }
})

test('view and update require their corresponding project module permissions', () => {
  const designer = { ...activeEmployee, department: '设计部' }
  assert.equal(canViewProjectFinancials(designer), true)
  assert.equal(canUpdateProjectFinancials(designer), true)

  const viewOnly = {
    ...designer,
    effectivePermissionKeys: ['module.projects.view'],
  }
  assert.equal(canViewProjectFinancials(viewOnly), true)
  assert.equal(canUpdateProjectFinancials(viewOnly), false)

  const updateOnly = {
    ...designer,
    effectivePermissionKeys: ['module.projects.update'],
  }
  assert.equal(canViewProjectFinancials(updateOnly), false)
  assert.equal(canUpdateProjectFinancials(updateOnly), true)
})

test('typed project permissions combine approved identity and exact module grant', () => {
  for (const department of ['后勤部', '财务部', '设计部', '总务部']) {
    const editor = {
      ...activeEmployee,
      department,
      effectivePermissionKeys: [
        'module.projects.create',
        'module.projects.update',
      ],
    }
    assert.equal(canCreateTypedProject(editor), true, department)
    assert.equal(canEditTypedProject(editor), true, department)
  }

  const president = {
    ...activeEmployee,
    position: '社长',
    effectivePermissionKeys: [
      'module.projects.create',
      'module.projects.update',
      'module.projects.delete',
    ],
  }
  assert.equal(canCreateTypedProject(president), true)
  assert.equal(canEditTypedProject(president), true)
  assert.equal(canDeleteTypedProject(president), true)
  assert.equal(canManageMiraisyaSettlement(president), true)
})

test('delete and settlement stay limited to president, finance, or SW-000', () => {
  const mutationPermissions = [
    'module.projects.update',
    'module.projects.delete',
  ]
  for (const identity of [
    { department: '财务部' },
    { position: '社长' },
    { employeeNumber: 'SW-000' },
  ]) {
    const employee = {
      ...activeEmployee,
      ...identity,
      effectivePermissionKeys: mutationPermissions,
    }
    assert.equal(canDeleteTypedProject(employee), true)
    assert.equal(canManageMiraisyaSettlement(employee), true)
  }

  for (const department of ['后勤部', '设计部', '总务部', '工程部']) {
    const employee = {
      ...activeEmployee,
      department,
      effectivePermissionKeys: mutationPermissions,
    }
    assert.equal(canDeleteTypedProject(employee), false, department)
    assert.equal(canManageMiraisyaSettlement(employee), false, department)
  }
})

test('typed project helpers fail closed for missing grants or inactive accounts', () => {
  const generalAffairs = {
    ...activeEmployee,
    department: '总务部',
    effectivePermissionKeys: ['module.projects.view'],
  }
  assert.equal(canCreateTypedProject(generalAffairs), false)
  assert.equal(canEditTypedProject(generalAffairs), false)

  const inactiveFinance = {
    ...activeEmployee,
    department: '财务部',
    accountStatus: 'disabled',
    effectivePermissionKeys: [
      'module.projects.create',
      'module.projects.update',
      'module.projects.delete',
    ],
  }
  assert.equal(canCreateTypedProject(inactiveFinance), false)
  assert.equal(canEditTypedProject(inactiveFinance), false)
  assert.equal(canDeleteTypedProject(inactiveFinance), false)
  assert.equal(canManageMiraisyaSettlement(inactiveFinance), false)
})

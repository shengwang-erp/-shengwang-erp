import assert from 'node:assert/strict'
import test from 'node:test'

import {
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

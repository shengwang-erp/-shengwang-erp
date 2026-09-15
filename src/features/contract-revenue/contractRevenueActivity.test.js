import assert from 'node:assert/strict'
import test from 'node:test'

import { hasActiveContractRevenueRows } from './contractRevenueActivity.js'

test('revenue activity is isolated to the selected project', () => {
  const rows = [
    { projectId: 'P-OTHER', statusCode: 'active' },
    { projectId: 'P-CURRENT', statusCode: 'void' },
  ]

  assert.equal(hasActiveContractRevenueRows(rows, 'P-CURRENT'), false)
  assert.equal(hasActiveContractRevenueRows(rows, 'P-OTHER'), true)
})

test('active rows for the selected project block direct contract edits', () => {
  assert.equal(
    hasActiveContractRevenueRows([
      { projectId: 'P-CURRENT', statusCode: 'active' },
    ], 'P-CURRENT'),
    true,
  )
})

test('void and deleted rows do not block direct contract edits', () => {
  assert.equal(
    hasActiveContractRevenueRows([
      { projectId: 'P-CURRENT', statusCode: 'void' },
      { projectId: 'P-CURRENT', status: 'deleted' },
    ], 'P-CURRENT'),
    false,
  )
})

test('missing project identity never produces a global activity lock', () => {
  assert.equal(
    hasActiveContractRevenueRows([{ projectId: 'P-1', status: 'active' }], ''),
    false,
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  canRequestLaborAccountingBridge,
  isLaborAccountingMonth,
  normalizeBridgeSummary,
  resolveMonthlyProjectLaborTotal,
  resolveMonthlySalaryTotal,
  resolveProjectLaborTotal,
} from './laborAccountingBridge.js'

function bridgeSummary(overrides = {}) {
  return {
    salaryMonth: '2026-07',
    isAuthoritative: true,
    salaryTotal: 3200000,
    projectLaborTotal: 1260000,
    projectLaborById: { P001: 842000, P002: 418000 },
    projectLaborLifetimeTotal: 2460000,
    projectLaborLifetimeById: { P001: 1842000, P002: 618000 },
    pendingCount: 2,
    effectiveFrom: '2026-07-01',
    ...overrides,
  }
}

test('bridge permission requires an actor and all three exact effective permission keys', () => {
  const exactKeys = [
    'module.labor.view',
    'sensitive.salary_view',
    'module.project_costs.view',
  ]

  assert.equal(canRequestLaborAccountingBridge({
    actorKey: 'actor-a',
    effectivePermissionKeys: exactKeys,
  }), true)
  assert.equal(canRequestLaborAccountingBridge({
    actorKey: 'actor-a',
    effectivePermissionKeys: ['all'],
  }), true)
  assert.equal(canRequestLaborAccountingBridge({
    actorKey: '',
    effectivePermissionKeys: exactKeys,
  }), false)
  assert.equal(canRequestLaborAccountingBridge({
    actorKey: 'actor-a',
    effectivePermissionKeys: exactKeys.slice(0, 2),
    role: 'super_admin',
    employeeNumber: 'SW-000',
    department: '会计',
  }), false)
})

test('accounting month guard accepts only supported exact YYYY-MM values', () => {
  assert.equal(isLaborAccountingMonth('1900-01'), true)
  assert.equal(isLaborAccountingMonth('2026-07'), true)
  assert.equal(isLaborAccountingMonth('2100-12'), true)
  for (const value of ['1899-12', '2101-01', '2026-7', '2026-13', '', null]) {
    assert.equal(isLaborAccountingMonth(value), false)
  }
})

test('normalizer accepts only the exact safe bridge shape and returns detached maps', () => {
  const source = bridgeSummary()
  const normalized = normalizeBridgeSummary(source)

  assert.deepEqual(normalized, source)
  assert.notEqual(normalized, source)
  assert.notEqual(normalized.projectLaborById, source.projectLaborById)
  assert.notEqual(normalized.projectLaborLifetimeById, source.projectLaborLifetimeById)
  assert.equal(normalizeBridgeSummary({ ...source, unexpected: true }), null)
  assert.equal(normalizeBridgeSummary({ ...source, salaryMonth: '2026-7' }), null)
  assert.equal(normalizeBridgeSummary({ ...source, salaryMonth: '1899-12' }), null)
  assert.equal(normalizeBridgeSummary({ ...source, salaryMonth: '2101-01' }), null)
  assert.equal(normalizeBridgeSummary({ ...source, effectiveFrom: '2026-02-30' }), null)
  assert.equal(normalizeBridgeSummary({ ...source, salaryTotal: -1 }), null)
  assert.equal(normalizeBridgeSummary({ ...source, salaryTotal: -0 }), null)
  assert.equal(normalizeBridgeSummary({ ...source, projectLaborTotal: -0 }), null)
  assert.equal(normalizeBridgeSummary({ ...source, projectLaborLifetimeTotal: -0 }), null)
  assert.equal(normalizeBridgeSummary({ ...source, pendingCount: 1.5 }), null)
  assert.equal(normalizeBridgeSummary({ ...source, pendingCount: -0 }), null)
})

test('normalizer cross-checks activation state, effective month, and pre-activation pending count', () => {
  assert.equal(normalizeBridgeSummary(bridgeSummary({ effectiveFrom: null })), null)
  assert.equal(normalizeBridgeSummary(bridgeSummary({ effectiveFrom: '2026-08-01' })), null)
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: '2026-07-01',
    pendingCount: 0,
  })), null)
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: '2026-08-01',
  })), null)
  assert.deepEqual(normalizeBridgeSummary(bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: '2026-08-01',
    pendingCount: 0,
  })), bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: '2026-08-01',
    pendingCount: 0,
  }))
  assert.deepEqual(normalizeBridgeSummary(bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: null,
    pendingCount: 0,
  })), bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: null,
    pendingCount: 0,
  }))
})

test('normalizer rejects mismatched map totals, unsafe sums, accessors, and pollution keys', () => {
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborTotal: 1260001,
  })), null)
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborLifetimeTotal: 2460001,
  })), null)
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborTotal: Number.MAX_SAFE_INTEGER,
    projectLaborById: { P001: Number.MAX_SAFE_INTEGER, P002: 1 },
  })), null)

  const accessorMap = {}
  Object.defineProperty(accessorMap, 'P001', {
    enumerable: true,
    get() { return 1260000 },
  })
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborById: accessorMap,
  })), null)

  const pollutedMap = Object.create(null)
  pollutedMap.__proto__ = 1260000
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborById: pollutedMap,
  })), null)

  for (const invalidKey of [' P001', 'P001\t', '\nP001', '', 'P'.repeat(501)]) {
    assert.equal(normalizeBridgeSummary(bridgeSummary({
      projectLaborTotal: 1,
      projectLaborById: { [invalidKey]: 1 },
    })), null)
  }
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborTotal: 0,
    projectLaborById: { P001: -0 },
  })), null)
  assert.equal(normalizeBridgeSummary(bridgeSummary({
    projectLaborLifetimeTotal: 0,
    projectLaborLifetimeById: { P001: -0 },
  })), null)
})

test('authoritative same-month bridge replaces monthly salary and project labor without adding legacy', () => {
  const bridge = bridgeSummary()

  assert.equal(resolveMonthlySalaryTotal({
    month: '2026-07',
    legacyTotal: 999999,
    bridge,
  }), 3200000)
  assert.equal(resolveMonthlyProjectLaborTotal({
    month: '2026-07',
    legacyTotal: 999999,
    bridge,
  }), 1260000)
})

test('monthly resolvers preserve legacy for wrong-month, missing, invalid, or pre-activation bridges', () => {
  const preActivation = bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: '2026-08-01',
    pendingCount: 0,
  })

  for (const bridge of [
    null,
    preActivation,
    bridgeSummary({ salaryMonth: '2026-06', effectiveFrom: '2026-06-01' }),
    bridgeSummary({ projectLaborTotal: 1 }),
  ]) {
    assert.equal(resolveMonthlySalaryTotal({
      month: '2026-07',
      legacyTotal: 900000,
      bridge,
    }), 900000)
    assert.equal(resolveMonthlyProjectLaborTotal({
      month: '2026-07',
      legacyTotal: 450000,
      bridge,
    }), 450000)
  }
})

test('lifetime project resolver uses the partitioned lifetime map even before activation', () => {
  const preActivation = bridgeSummary({
    isAuthoritative: false,
    effectiveFrom: '2026-08-01',
    pendingCount: 0,
  })

  assert.equal(resolveProjectLaborTotal({
    month: '2026-07',
    projectId: 'P001',
    legacyTotal: 999999,
    bridge: preActivation,
  }), 1842000)
  assert.equal(resolveProjectLaborTotal({
    month: '2026-07',
    projectId: 'P002',
    legacyTotal: 999999,
    bridge: preActivation,
  }), 618000)
})

test('lifetime project resolver treats missing and zero map entries as authoritative zero', () => {
  const bridge = bridgeSummary({
    projectLaborLifetimeTotal: 1842000,
    projectLaborLifetimeById: { P001: 1842000, PZERO: 0 },
  })

  assert.equal(resolveProjectLaborTotal({
    month: '2026-07',
    projectId: 'PZERO',
    legacyTotal: 450000,
    bridge,
  }), 0)
  assert.equal(resolveProjectLaborTotal({
    month: '2026-07',
    projectId: 'PMISSING',
    legacyTotal: 450000,
    bridge,
  }), 0)
})

test('lifetime project resolver falls back only for absent, invalid, or wrong-month bridge data', () => {
  for (const bridge of [
    null,
    bridgeSummary({ salaryMonth: '2026-06', effectiveFrom: '2026-06-01' }),
    bridgeSummary({ projectLaborLifetimeTotal: 1 }),
  ]) {
    assert.equal(resolveProjectLaborTotal({
      month: '2026-07',
      projectId: 'P001',
      legacyTotal: 450000,
      bridge,
    }), 450000)
  }
})

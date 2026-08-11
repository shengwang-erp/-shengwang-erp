import assert from 'node:assert/strict'
import test from 'node:test'

import {
  normalizeIssueDate,
  normalizeProjectIds,
  normalizeSettlement,
  normalizeSettlementCandidate,
  normalizeSettlementMonth,
  settlementConfirmDecision,
} from './miraisyaSettlementDomain.js'

const item = Object.freeze({
  itemName: '空调安装工事费',
  description: '室外机バルコニー',
  quantity: 1,
  unit: '式',
  unitPrice: 12000,
  taxRate: 10,
  taxExclusiveAmount: 12000,
  taxAmount: 1200,
  taxInclusiveAmount: 13200,
})

const project = Object.freeze({
  projectId: 'mirai-001',
  projectName: '両国エアコン設置',
  address: '東京都墨田区両国3-8-8',
  completionDate: '2026-07-05',
  billingVersion: 3,
  costSnapshotToken: 'a'.repeat(64),
  costAmount: 5000,
  taxExclusiveAmount: 12000,
  taxAmount: 1200,
  taxInclusiveAmount: 13200,
  items: [item],
})

function settlement(overrides = {}) {
  return {
    id: '34d774ce-a63b-4b7c-b604-4b7b2a7d377a',
    invoiceNo: 'MIRAI-202607-001',
    month: '2026-07',
    issueDate: '2026-07-31',
    status: 'draft',
    version: 1,
    taxExclusiveAmount: 12000,
    taxAmount: 1200,
    taxInclusiveAmount: 13200,
    totalCostAmount: 5000,
    marginAmount: 7000,
    projects: [project],
    createdAt: '2026-07-31T01:02:03.000Z',
    createdByName: '财务担当',
    confirmedAt: null,
    confirmedByName: null,
    voidedAt: null,
    voidedByName: null,
    voidReason: null,
    ...overrides,
  }
}

test('month, issue date, and dense project id inputs fail closed', () => {
  assert.equal(normalizeSettlementMonth('2026-08'), '2026-08')
  assert.equal(normalizeIssueDate('2026-08-11'), '2026-08-11')
  assert.deepEqual(normalizeProjectIds(['mirai-2', 'mirai-1']), ['mirai-1', 'mirai-2'])

  for (const invalid of ['2026-8', '2026-13', '2026-00', '', null]) {
    assert.throws(() => normalizeSettlementMonth(invalid), TypeError)
  }
  for (const invalid of ['2026-02-30', '2026/08/11', '', null]) {
    assert.throws(() => normalizeIssueDate(invalid), TypeError)
  }
  assert.throws(() => normalizeProjectIds([]), TypeError)
  assert.throws(() => normalizeProjectIds(['mirai-1', 'mirai-1']), TypeError)
  const sparse = new Array(2)
  sparse[1] = 'mirai-1'
  assert.throws(() => normalizeProjectIds(sparse), TypeError)
})

test('candidate normalization identifies completion-month carry-forward and cost blockers', () => {
  const candidate = normalizeSettlementCandidate({
    projectId: 'mirai-001',
    projectName: '両国エアコン設置',
    address: '東京都墨田区両国3-8-8',
    completionDate: '2026-07-05',
    completionMonth: '2026-07',
    billingVersion: 3,
    taxExclusiveAmount: 12000,
    taxAmount: 1200,
    taxInclusiveAmount: 13200,
    costAmount: 5000,
    costComplete: false,
    incompleteSources: ['labor'],
  }, '2026-08')

  assert.equal(candidate.carriedForward, true)
  assert.equal(candidate.costComplete, false)
  assert.deepEqual(candidate.incompleteSources, ['labor'])
  assert.equal(Object.isFrozen(candidate), true)
  assert.equal(Object.isFrozen(candidate.incompleteSources), true)
})

test('authoritative project costs preserve four decimal accounting precision', () => {
  const candidate = normalizeSettlementCandidate({
    projectId: 'mirai-002', projectName: '精算项目', address: '',
    completionDate: '2026-08-10', completionMonth: '2026-08', billingVersion: 1,
    taxExclusiveAmount: 1000, taxAmount: 100, taxInclusiveAmount: 1100,
    costAmount: 333.3333, costComplete: true, incompleteSources: [],
  }, '2026-08')
  assert.equal(candidate.costAmount, 333.3333)
})

test('settlement snapshot enforces invoice numbering, exact totals, and deep immutability', () => {
  const value = normalizeSettlement(settlement())
  assert.equal(value.invoiceNo, 'MIRAI-202607-001')
  assert.equal(value.marginAmount, 7000)
  assert.equal(Object.isFrozen(value), true)
  assert.equal(Object.isFrozen(value.projects), true)
  assert.equal(Object.isFrozen(value.projects[0]), true)
  assert.equal(Object.isFrozen(value.projects[0].items[0]), true)

  assert.throws(() => normalizeSettlement(settlement({ invoiceNo: 'MIRAI-202608-001' })), TypeError)
  assert.throws(() => normalizeSettlement(settlement({ taxInclusiveAmount: 13201 })), TypeError)
  assert.throws(() => normalizeSettlement(settlement({ marginAmount: 6999 })), TypeError)
  assert.throws(() => normalizeSettlement(settlement({ extra: true })), TypeError)
})

test('confirmation decision blocks non-drafts and incomplete snapshots', () => {
  assert.deepEqual(settlementConfirmDecision(normalizeSettlement(settlement())), {
    allowed: true,
    reason: '',
  })
  assert.deepEqual(
    settlementConfirmDecision(normalizeSettlement(settlement({
      status: 'confirmed',
      confirmedAt: '2026-07-31T01:05:00.000Z',
      confirmedByName: '财务担当',
    }))),
    { allowed: false, reason: '只有草稿可以确认' },
  )
  assert.deepEqual(
    settlementConfirmDecision({ ...normalizeSettlement(settlement()), projects: [{ ...project, costSnapshotToken: '' }] }),
    { allowed: false, reason: '项目成本尚未完整，不能确认结算' },
  )
})

test('accessor-backed and polluted response data is rejected without invoking accessors', () => {
  let calls = 0
  const accessor = Object.defineProperty({}, 'id', {
    enumerable: true,
    get() {
      calls += 1
      return '34d774ce-a63b-4b7c-b604-4b7b2a7d377a'
    },
  })
  assert.throws(() => normalizeSettlement(accessor), TypeError)
  assert.equal(calls, 0)
  assert.throws(() => normalizeSettlementCandidate({ ...project, __proto__: { polluted: true } }, '2026-08'), TypeError)
})

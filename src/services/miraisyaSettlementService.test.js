import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MiraisyaSettlementServiceError,
  createMiraisyaSettlementService,
} from './miraisyaSettlementService.js'

const item = {
  itemName: '工事费', description: '', quantity: 1, unit: '式', unitPrice: 10000,
  taxRate: 10, taxExclusiveAmount: 10000, taxAmount: 1000, taxInclusiveAmount: 11000,
}
const project = {
  projectId: 'p1', projectName: '未来社工事', address: '東京都', completionDate: '2026-08-11',
  billingVersion: 2, costSnapshotToken: 'b'.repeat(64), costAmount: 4000,
  taxExclusiveAmount: 10000, taxAmount: 1000, taxInclusiveAmount: 11000, items: [item],
}
const snapshot = {
  id: '34d774ce-a63b-4b7c-b604-4b7b2a7d377a', invoiceNo: 'MIRAI-202608-001',
  month: '2026-08', issueDate: '2026-08-11', status: 'draft', version: 1,
  taxExclusiveAmount: 10000, taxAmount: 1000, taxInclusiveAmount: 11000,
  totalCostAmount: 4000, marginAmount: 6000, projects: [project],
  createdAt: '2026-08-11T00:00:00.000Z', createdByName: '社长',
  confirmedAt: null, confirmedByName: null, voidedAt: null, voidedByName: null,
  voidReason: null,
}
const candidate = {
  projectId: 'p1', projectName: '未来社工事', address: '東京都', completionDate: '2026-08-11',
  completionMonth: '2026-08', billingVersion: 2, taxExclusiveAmount: 10000,
  taxAmount: 1000, taxInclusiveAmount: 11000, costAmount: 4000,
  costComplete: true, incompleteSources: [],
}

function clientReturning(data) {
  const calls = []
  return {
    calls,
    async rpc(name, args) {
      calls.push([name, args])
      return { data, error: null, status: 200 }
    },
  }
}

test('service calls the exact settlement RPCs with normalized arguments', async () => {
  const client = clientReturning([candidate])
  const service = createMiraisyaSettlementService(client, { configured: true })
  const candidates = await service.listCandidates('2026-08')
  assert.equal(candidates[0].carriedForward, false)
  assert.deepEqual(client.calls[0], [
    'list_miraisya_settlement_candidates_secure', { p_month: '2026-08' },
  ])

  client.rpc = async (name, args) => {
    client.calls.push([name, args])
    return { data: snapshot, error: null, status: 200 }
  }
  await service.get(snapshot.id)
  await service.createDraft({ month: '2026-08', issueDate: '2026-08-11', projectIds: ['p2', 'p1'] })
  await service.confirm({ settlementId: snapshot.id, expectedVersion: 1 })
  await service.void({ settlementId: snapshot.id, expectedVersion: 1, reason: '金额需要修正' })

  assert.deepEqual(client.calls.slice(1), [
    ['get_miraisya_settlement_secure', { p_settlement_id: snapshot.id }],
    ['create_miraisya_settlement_draft_secure', {
      p_month: '2026-08', p_issue_date: '2026-08-11', p_project_ids: ['p1', 'p2'],
    }],
    ['confirm_miraisya_settlement_secure', { p_settlement_id: snapshot.id, p_expected_version: 1 }],
    ['void_miraisya_settlement_secure', {
      p_settlement_id: snapshot.id, p_expected_version: 1, p_reason: '金额需要修正',
    }],
  ])
})

test('list returns a deeply normalized dense array', async () => {
  const client = clientReturning([snapshot])
  const service = createMiraisyaSettlementService(client, { configured: true })
  const values = await service.list('2026-08')
  assert.equal(values[0].invoiceNo, 'MIRAI-202608-001')
  assert.equal(Object.isFrozen(values), true)
  assert.deepEqual(client.calls[0], [
    'list_miraisya_settlements_secure', { p_month: '2026-08' },
  ])
})

test('trusted remote errors are mapped without leaking server details', async () => {
  const cases = [
    [{ status: 401, code: 'PGRST301' }, 'authInvalid', true],
    [{ status: 403, code: '42501', hint: 'MIRAISYA_SETTLEMENT_ACCESS_DENIED' }, 'accessDenied', false],
    [{ status: 400, code: 'P0001', hint: 'MIRAISYA_SETTLEMENT_VERSION_CONFLICT' }, 'versionConflict', false],
    [{ status: 400, code: '22023', hint: 'MIRAISYA_SETTLEMENT_COST_INCOMPLETE' }, 'incompleteCost', false],
    [{ status: 400, code: '23505', hint: 'MIRAISYA_SETTLEMENT_PROJECT_DUPLICATE' }, 'projectAlreadySettled', false],
  ]
  for (const [remote, code, authInvalid] of cases) {
    const client = { async rpc() { return { data: null, error: { ...remote, message: 'private' }, status: remote.status } } }
    const service = createMiraisyaSettlementService(client, { configured: true })
    await assert.rejects(
      service.list('2026-08'),
      (error) => error instanceof MiraisyaSettlementServiceError &&
        error.code === code && error.authInvalid === authInvalid && !error.message.includes('private'),
    )
  }
})

test('input and malformed response data fail closed', async () => {
  const service = createMiraisyaSettlementService(clientReturning(snapshot), { configured: true })
  await assert.rejects(service.createDraft({ month: '2026-08', issueDate: 'bad', projectIds: ['p1'] }),
    (error) => error.code === 'inputInvalid')
  await assert.rejects(service.void({ settlementId: snapshot.id, expectedVersion: 1, reason: '' }),
    (error) => error.code === 'inputInvalid')

  const malformed = createMiraisyaSettlementService(clientReturning({ ...snapshot, extra: true }), { configured: true })
  await assert.rejects(malformed.get(snapshot.id), (error) => error.code === 'unavailable')
})

test('unconfigured service refuses every RPC', async () => {
  const service = createMiraisyaSettlementService(null, { configured: false })
  await assert.rejects(service.list('2026-08'), (error) => error.code === 'notConfigured')
})

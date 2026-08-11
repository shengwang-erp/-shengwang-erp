import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MiraisyaBillingServiceError,
  createMiraisyaBillingService,
} from './miraisyaBillingService.js'

const item = Object.freeze({
  itemName: '空调安装', description: '2階', quantity: 1,
  unit: '式', unitPrice: 50000, taxRate: 10,
})

function response(overrides = {}) {
  return {
    projectId: 'P101', version: 1, items: [item],
    taxExclusiveAmount: 50000, taxAmount: 5000, taxInclusiveAmount: 55000,
    updatedAt: '2026-08-11T01:02:03.000Z',
    ...overrides,
  }
}

test('get and replace call only their exact secure RPCs', async () => {
  const calls = []
  const service = createMiraisyaBillingService({ rpc: async (name, args) => {
    calls.push([name, args])
    return { data: response(), error: null, status: 200 }
  } }, { configured: true })

  const loaded = await service.get('P101')
  const saved = await service.replace({ projectId: 'P101', expectedVersion: 1, items: [item] })
  assert.deepEqual(calls, [
    ['get_miraisya_billing_secure', { p_project_id: 'P101' }],
    ['replace_miraisya_billing_secure', {
      p_project_id: 'P101', p_expected_version: 1, p_items: [item],
    }],
  ])
  assert.equal(Object.isFrozen(loaded), true)
  assert.equal(Object.isFrozen(saved.items), true)
})

test('replace validates project, version, and rows before RPC', async () => {
  let calls = 0
  const service = createMiraisyaBillingService({ rpc: async () => {
    calls += 1
    return { data: response(), error: null }
  } }, { configured: true })
  for (const request of [
    { projectId: '', expectedVersion: 1, items: [item] },
    { projectId: 'P101', expectedVersion: 0, items: [item] },
    { projectId: 'P101', expectedVersion: 1, items: [] },
    { projectId: 'P101', expectedVersion: 1, items: [{ ...item, taxRate: 8 }] },
  ]) await assert.rejects(() => service.replace(request), (error) =>
    error instanceof MiraisyaBillingServiceError && error.code === 'inputInvalid'
  )
  assert.equal(calls, 0)
})

test('response hardening rejects extra keys, wrong totals, accessors, and sparse items', async () => {
  const accessor = response()
  Object.defineProperty(accessor, 'version', { enumerable: true, get: () => 1 })
  const sparseItems = []
  sparseItems.length = 1
  for (const data of [
    response({ extra: true }),
    response({ taxInclusiveAmount: 1 }),
    accessor,
    response({ items: sparseItems }),
  ]) {
    const service = createMiraisyaBillingService({
      rpc: async () => ({ data, error: null, status: 200 }),
    }, { configured: true })
    await assert.rejects(() => service.get('P101'), (error) =>
      error instanceof MiraisyaBillingServiceError && error.code === 'unavailable'
    )
  }
})

test('only exact trusted auth and version errors are exposed', async () => {
  const versionService = createMiraisyaBillingService({ rpc: async () => ({
    data: null,
    error: { code: 'P0001', hint: 'MIRAISYA_BILLING_VERSION_CONFLICT' },
    status: 400,
  }) }, { configured: true })
  await assert.rejects(() => versionService.get('P101'), (error) =>
    error.code === 'versionConflict' && error.authInvalid === false
  )

  const authService = createMiraisyaBillingService({ rpc: async () => ({
    data: null, error: { code: 'PGRST301' }, status: 401,
  }) }, { configured: true })
  await assert.rejects(() => authService.get('P101'), (error) =>
    error.code === 'authInvalid' && error.authInvalid === true
  )
})

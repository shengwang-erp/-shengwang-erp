import assert from 'node:assert/strict'
import test from 'node:test'
import { createPaymentPlanDraftStore } from './paymentPlanDraft.js'

function storage() {
  const map = new Map()
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key), keys: () => [...map.keys()] }
}

test('payment plan drafts are isolated by account and project', () => {
  const memory = storage()
  const store = createPaymentPlanDraftStore({ storage: memory })
  store.save('account-a', 'project-a', [{ planId: 'p1', projectId: 'project-a', installmentOrder: 1, name: '订金', allocationWeight: '20' }])
  store.save('account-a', 'project-b', [{ planId: 'p2', projectId: 'project-b', installmentOrder: 1, name: '另一个项目', allocationWeight: '10' }])
  store.save('account-b', 'project-a', [{ planId: 'p3', projectId: 'project-a', installmentOrder: 1, name: '另一个账号', allocationWeight: '30' }])
  assert.equal(store.load('account-a', 'project-a')[0].name, '订金')
  assert.equal(store.load('account-a', 'project-b')[0].name, '另一个项目')
  assert.equal(store.load('account-b', 'project-a')[0].name, '另一个账号')
  assert.equal(memory.keys().length, 3)
})

test('clearing a saved plan removes only that form draft', () => {
  const memory = storage()
  const store = createPaymentPlanDraftStore({ storage: memory })
  store.save('a', 'p1', [{ planId: 'one' }])
  store.save('a', 'p2', [{ planId: 'two' }])
  store.clear('a', 'p1')
  assert.equal(store.load('a', 'p1'), null)
  assert.equal(store.load('a', 'p2')[0].planId, 'two')
})

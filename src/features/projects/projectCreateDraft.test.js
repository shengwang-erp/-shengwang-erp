import assert from 'node:assert/strict'
import test from 'node:test'

const draftModule = await import('./projectCreateDraft.js').catch(() => ({}))

test('project create drafts expose an account-scoped store', () => {
  assert.equal(typeof draftModule.createProjectCreateDraftStore, 'function')
})

function memoryStorage() {
  const entries = new Map()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    keys: () => [...entries.keys()],
  }
}

test('round trips all project form choices but drops identifiers and unknown fields', () => {
  const storage = memoryStorage()
  const store = draftModule.createProjectCreateDraftStore({ storage })
  const original = {
    projectId: 'must-not-be-restored',
    projectType: 'small',
    projectName: '千代田KOKA 5F',
    customerName: '李总',
    status: '设计中',
    workerAssignments: [{ employeeId: 'e1', employeeNumber: 'SW-022', name: '测试员工' }],
    unexpectedField: 'do-not-persist',
  }
  store.save('account-a', original)
  const loaded = store.load('account-a')
  assert.equal(loaded.projectId, '')
  assert.equal(loaded.projectType, 'small')
  assert.equal(loaded.projectName, '千代田KOKA 5F')
  assert.deepEqual(loaded.workerAssignments, original.workerAssignments)
  assert.equal(loaded.unexpectedField, undefined)
})

test('isolates drafts by account and clears only the requested account', () => {
  const storage = memoryStorage()
  const store = draftModule.createProjectCreateDraftStore({ storage })
  store.save('account-a', { projectName: '账号 A 项目' })
  store.save('account-b', { projectName: '账号 B 项目' })
  assert.equal(store.load('account-a').projectName, '账号 A 项目')
  assert.equal(store.load('account-b').projectName, '账号 B 项目')
  assert.equal(storage.keys().length, 2)
  store.clear('account-a')
  assert.equal(store.load('account-a'), null)
  assert.equal(store.load('account-b').projectName, '账号 B 项目')
})

test('missing account or unavailable storage fails closed without throwing', () => {
  const unavailableStorage = { getItem() { throw new Error('blocked') } }
  const store = draftModule.createProjectCreateDraftStore({ storage: unavailableStorage })
  assert.equal(store.load(''), null)
  assert.equal(store.load('account-a'), null)
  assert.doesNotThrow(() => store.save('account-a', { projectName: '测试' }))
  assert.doesNotThrow(() => store.clear('account-a'))
})

import assert from 'node:assert/strict'
import test from 'node:test'

const draftModule = await import('./originalContractDraft.js').catch(() => ({}))

function memoryStorage() {
  const entries = new Map()
  return {
    getItem(key) { return entries.get(key) ?? null },
    setItem(key, value) { entries.set(key, String(value)) },
    removeItem(key) { entries.delete(key) },
  }
}

const form = {
  taxInclusiveAmount: '100000',
  taxRate: '10',
  taxExclusiveAmount: '90909',
  taxAmount: '9091',
}

test('original contract drafts are isolated by account and project', () => {
  assert.equal(
    typeof draftModule.createOriginalContractDraftStore,
    'function',
  )
  const store = draftModule.createOriginalContractDraftStore({
    storage: memoryStorage(),
  })

  store.save('EMP-1', 'P-1', form)

  assert.deepEqual(store.load('EMP-1', 'P-1'), form)
  assert.equal(store.load('EMP-2', 'P-1'), null)
  assert.equal(store.load('EMP-1', 'P-2'), null)
})

test('successful save can clear only the matching contract draft', () => {
  const store = draftModule.createOriginalContractDraftStore({
    storage: memoryStorage(),
  })
  store.save('EMP-1', 'P-1', form)
  store.save('EMP-1', 'P-2', { ...form, taxInclusiveAmount: '200000' })

  store.clear('EMP-1', 'P-1')

  assert.equal(store.load('EMP-1', 'P-1'), null)
  assert.equal(store.load('EMP-1', 'P-2').taxInclusiveAmount, '200000')
})

test('blocked or malformed browser storage fails safely without losing form behavior', () => {
  const blocked = draftModule.createOriginalContractDraftStore({
    storage: {
      getItem() { throw new Error('blocked') },
      setItem() { throw new Error('blocked') },
      removeItem() { throw new Error('blocked') },
    },
  })
  assert.equal(blocked.load('EMP-1', 'P-1'), null)
  assert.doesNotThrow(() => blocked.save('EMP-1', 'P-1', form))
  assert.doesNotThrow(() => blocked.clear('EMP-1', 'P-1'))

  const storage = memoryStorage()
  storage.setItem(
    'shengwang-erp:form-draft:v1:EMP-1:project:P-1:original-contract',
    '{invalid',
  )
  const malformed = draftModule.createOriginalContractDraftStore({ storage })
  assert.equal(malformed.load('EMP-1', 'P-1'), null)
})

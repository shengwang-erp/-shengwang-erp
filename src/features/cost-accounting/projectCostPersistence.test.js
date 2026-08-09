import test from 'node:test'
import assert from 'node:assert/strict'
import { createManualProjectCostPersistence } from './projectCostPersistence.js'

const STORAGE_KEY = 'erp.projectCostRecords'

function manualCost(overrides = {}) {
  return {
    costRecordId: 'PC1',
    projectId: 'P1',
    costType: '外包费',
    amount: 1000,
    date: '2026-08-09',
    sourceType: 'manual',
    ...overrides,
  }
}

function warehouseCost() {
  return manualCost({
    costRecordId: 'WAREHOUSE-SO:11111111-1111-4111-8111-111111111111',
    sourceType: 'warehouse',
    sourceDocumentId: '11111111-1111-4111-8111-111111111111',
  })
}

test('manual project-cost persistence mutates one manual record without rewriting warehouse rows', async () => {
  const calls = []
  const persistence = createManualProjectCostPersistence({
    upsertRecord: async (...args) => calls.push(['upsert', ...args]),
    softDelete: async (...args) => calls.push(['delete', ...args]),
    storageKey: STORAGE_KEY,
  })
  const added = manualCost()
  const updated = manualCost({ amount: 1200 })

  await persistence.save(added)
  await persistence.save(updated)
  await persistence.remove(updated)

  assert.deepEqual(calls, [
    ['upsert', STORAGE_KEY, added],
    ['upsert', STORAGE_KEY, updated],
    ['delete', STORAGE_KEY, 'PC1'],
  ])
})

test('manual project-cost persistence rejects every warehouse-owned mutation before transport', async () => {
  let calls = 0
  const persistence = createManualProjectCostPersistence({
    upsertRecord: async () => { calls += 1 },
    softDelete: async () => { calls += 1 },
    storageKey: STORAGE_KEY,
  })
  const managed = warehouseCost()

  await assert.rejects(() => persistence.save(managed), /仓库自动生成/u)
  await assert.rejects(() => persistence.remove(managed), /仓库自动生成/u)
  assert.equal(calls, 0)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { ContractRevenueValidationError } from './contractRevenueValidation.js'

const runtime = await import('./contractRevenueRuntime.js').catch(() => ({}))

const projectedProject = Object.freeze({
  projectId: 'P-REFERENCE',
  projectName: '关联项目',
  status: '进行中',
  address: 'Tokyo',
})
const normalizedProjectedProject = Object.freeze({
  ...projectedProject,
  contractAmount: 0,
  paidAmount: 0,
})

test('denied revenue access skips strict calculations for projected projects', () => {
  assert.equal(typeof runtime.buildProjectRevenueSnapshotsForAccess, 'function')
  const firstSnapshots = runtime.buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: false,
    projects: [normalizedProjectedProject],
  })
  const secondSnapshots = runtime.buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: false,
    projects: [normalizedProjectedProject],
  })

  assert.ok(firstSnapshots instanceof Map)
  assert.equal(firstSnapshots.size, 0)
  assert.equal(secondSnapshots.size, 0)
  assert.notEqual(secondSnapshots, firstSnapshots)
  assert.equal(Object.hasOwn(projectedProject, 'contractAmount'), false)
  assert.equal(Object.hasOwn(projectedProject, 'paidAmount'), false)
})

test('authorized revenue access delegates valid projects to strict calculations', () => {
  const snapshots = runtime.buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: true,
    projects: [{
      projectId: 'P-FULL',
      projectName: '完整项目',
      contractAmount: 500000,
      paidAmount: 0,
    }],
  })

  assert.equal(snapshots.size, 1)
  assert.equal(snapshots.get('P-FULL').contractAmount, 500000)
})

test('authorized revenue access retains strict contract validation', () => {
  assert.throws(
    () => runtime.buildProjectRevenueSnapshotsForAccess({
      canViewRevenue: true,
      projects: [{ ...projectedProject, contractAmount: 0, paidAmount: 0 }],
    }),
    (error) => error instanceof ContractRevenueValidationError &&
      error.field === 'contractAmount',
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  acquirePersonnelProtection,
  hasProtectedPersonnelState,
  shouldBlockPersonnelExit,
} from './personnelCriticalState.js'

test('protected credential work acquires its parent lock fail-closed', () => {
  const calls = []
  assert.equal(
    acquirePersonnelProtection((active) => {
      calls.push(active)
      return true
    }),
    true,
  )
  assert.deepEqual(calls, [true])
  assert.equal(acquirePersonnelProtection(() => false), false)
  assert.equal(acquirePersonnelProtection(undefined), false)
  assert.equal(
    acquirePersonnelProtection(() => {
      throw new Error('parent unavailable')
    }),
    false,
  )
})

test('only create/reset work and unacknowledged credentials protect personnel state', () => {
  assert.equal(
    hasProtectedPersonnelState({ mutation: { operation: 'create' }, credentials: null }),
    true,
  )
  assert.equal(
    hasProtectedPersonnelState({ mutation: { operation: 'reset' }, credentials: null }),
    true,
  )
  assert.equal(
    hasProtectedPersonnelState({ mutation: null, credentials: { employeeNumber: 'SW-001' } }),
    true,
  )

  for (const operation of ['detail', 'edit', 'status']) {
    assert.equal(
      hasProtectedPersonnelState({ mutation: { operation }, credentials: null }),
      false,
    )
  }
  assert.equal(hasProtectedPersonnelState({ mutation: null, credentials: null }), false)
})

test('App blocks personnel exit only while the protected state is active', () => {
  assert.equal(
    shouldBlockPersonnelExit({ currentView: 'employees', protectedStateActive: true }),
    true,
  )
  assert.equal(
    shouldBlockPersonnelExit({ currentView: 'employees', protectedStateActive: false }),
    false,
  )
  assert.equal(
    shouldBlockPersonnelExit({ currentView: 'home', protectedStateActive: true }),
    false,
  )
})

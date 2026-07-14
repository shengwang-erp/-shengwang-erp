import assert from 'node:assert/strict'
import test from 'node:test'

import { runCoalescedSessionValidation } from './authGateSession.js'

const SESSION = Object.freeze({ access_token: 'same-access-token' })

test('simultaneous validation requests for one access token share one profile refresh', async () => {
  const inFlight = { current: null }
  let refreshCount = 0
  let releaseRefresh
  const refresh = () => {
    refreshCount += 1
    return new Promise((resolve) => {
      releaseRefresh = resolve
    })
  }

  const first = runCoalescedSessionValidation(inFlight, SESSION, refresh)
  const second = runCoalescedSessionValidation(inFlight, SESSION, refresh)

  assert.equal(refreshCount, 1)
  releaseRefresh({ employeeNumber: 'SW-001' })
  assert.deepEqual(await Promise.all([first, second]), [
    { employeeNumber: 'SW-001' },
    { employeeNumber: 'SW-001' },
  ])
})

test('a completed validation does not suppress a later auth transition for the same token', async () => {
  const inFlight = { current: null }
  let refreshCount = 0
  const refresh = async () => {
    refreshCount += 1
    return refreshCount
  }

  assert.equal(await runCoalescedSessionValidation(inFlight, SESSION, refresh), 1)
  assert.equal(await runCoalescedSessionValidation(inFlight, SESSION, refresh), 2)
})

test('different access tokens never share an in-flight validation', async () => {
  const inFlight = { current: null }
  let refreshCount = 0
  const refresh = async () => {
    refreshCount += 1
    return refreshCount
  }

  await Promise.all([
    runCoalescedSessionValidation(inFlight, { access_token: 'token-one' }, refresh),
    runCoalescedSessionValidation(inFlight, { access_token: 'token-two' }, refresh),
  ])
  assert.equal(refreshCount, 2)
})

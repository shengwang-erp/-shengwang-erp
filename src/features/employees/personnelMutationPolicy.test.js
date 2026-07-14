import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendPersonnelNotice,
  finishProfileUpdate,
  reconcileAccountStatusFailure,
  requiresSelfAuthorizationRevalidation,
  shouldRefreshAfterAccountStatusError,
} from './personnelMutationPolicy.js'

test('self authorization-relevant updates logout exactly once without refreshing first', async () => {
  const events = []
  const requiresRevalidation = requiresSelfAuthorizationRevalidation({
    targetId: 'employee-a',
    currentEmployeeId: 'employee-a',
    dirtyKeys: new Set(['name', 'department']),
  })

  await finishProfileUpdate({
    requiresRevalidation,
    onAuthInvalid: async () => events.push('logout'),
    onRefreshEmployees: async () => events.push('refresh'),
    onRefreshFailure: async () => events.push('refresh-failure'),
  })

  assert.deepEqual(events, ['logout'])
  assert.equal(
    requiresSelfAuthorizationRevalidation({
      targetId: 'employee-a',
      currentEmployeeId: 'employee-a',
      dirtyKeys: new Set(['name', 'phone']),
    }),
    false,
  )
})

test('ordinary profile updates refresh once and delegate refresh failures without logout', async () => {
  const refreshError = new Error('refresh failed')
  const events = []

  await finishProfileUpdate({
    requiresRevalidation: false,
    onAuthInvalid: async () => events.push('logout'),
    onRefreshEmployees: async () => {
      events.push('refresh')
      throw refreshError
    },
    onRefreshFailure: async (error) => events.push(error === refreshError ? 'handled' : 'wrong'),
  })

  assert.deepEqual(events, ['refresh', 'handled'])
})

test('a refresh failure appends to the unrecoverable provision-replay warning', () => {
  const replayWarning =
    '员工已创建，但一次性初始密码不能再次查看；如未安全交付，请生成新的临时密码。'
  const refreshWarning = '员工已创建，但目录刷新失败；请稍后手动刷新。'

  assert.equal(
    appendPersonnelNotice(replayWarning, refreshWarning),
    `${replayWarning} ${refreshWarning}`,
  )
  assert.equal(appendPersonnelNotice('', refreshWarning), refreshWarning)
})

test('known partial account-status failures always refetch the canonical directory', async () => {
  for (const code of [
    'ACCOUNT_SESSION_REVOKE_FAILED',
    'ACCOUNT_AUTH_SYNC_FAILED',
  ]) {
    const error = { code }
    const events = []
    await reconcileAccountStatusFailure({
      error,
      onOperationError: (caught) => events.push(caught === error ? 'error' : 'wrong'),
      onRefreshEmployees: async () => events.push('refresh'),
      onRefreshFailure: async () => events.push('refresh-failure'),
    })
    assert.deepEqual(events, ['error', 'refresh'])
    assert.equal(shouldRefreshAfterAccountStatusError(code), true)
  }
})

test('ordinary account-status failures do not trigger an unrelated directory read', async () => {
  const error = { code: 'EMPLOYEE_TARGET_INVALID' }
  const events = []
  await reconcileAccountStatusFailure({
    error,
    onOperationError: () => events.push('error'),
    onRefreshEmployees: async () => events.push('refresh'),
    onRefreshFailure: async () => events.push('refresh-failure'),
  })

  assert.deepEqual(events, ['error'])
  assert.equal(shouldRefreshAfterAccountStatusError(error.code), false)
})

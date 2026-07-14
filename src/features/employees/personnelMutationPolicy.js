const AUTHORIZATION_RELEVANT_FIELDS = new Set([
  'department',
  'position',
  'employmentStatus',
])
const PARTIAL_ACCOUNT_STATUS_ERROR_CODES = new Set([
  'ACCOUNT_SESSION_REVOKE_FAILED',
  'ACCOUNT_AUTH_SYNC_FAILED',
])

export function requiresSelfAuthorizationRevalidation({
  targetId,
  currentEmployeeId,
  dirtyKeys,
}) {
  return (
    targetId === currentEmployeeId &&
    [...dirtyKeys].some((key) => AUTHORIZATION_RELEVANT_FIELDS.has(key))
  )
}

export async function finishProfileUpdate({
  requiresRevalidation,
  onAuthInvalid,
  onRefreshEmployees,
  onRefreshFailure,
}) {
  if (requiresRevalidation) {
    await onAuthInvalid()
    return
  }
  try {
    await onRefreshEmployees()
  } catch (error) {
    await onRefreshFailure(error)
  }
}

export function appendPersonnelNotice(current, message) {
  return [current, message].filter(Boolean).join(' ')
}

export function shouldRefreshAfterAccountStatusError(code) {
  return PARTIAL_ACCOUNT_STATUS_ERROR_CODES.has(code)
}

export async function reconcileAccountStatusFailure({
  error,
  onOperationError,
  onRefreshEmployees,
  onRefreshFailure,
}) {
  await onOperationError(error)
  if (!shouldRefreshAfterAccountStatusError(error?.code)) return
  try {
    await onRefreshEmployees()
  } catch (refreshError) {
    await onRefreshFailure(refreshError)
  }
}

const TERMINAL_AUTH_ERROR_CODES = new Set([
  'ACCOUNT_DISABLED',
  'ACCOUNT_UNAVAILABLE',
  'AUTH_INVALID',
  'AUTH_SESSION_INVALID',
  'AUTH_TOKEN_INVALID',
  'EMPLOYEE_INACTIVE',
  'EMPLOYEE_NOT_LINKED',
  'PASSWORD_CHANGE_REQUIRED',
  'PASSWORD_STATE_SYNC_FAILED',
])

export function isTerminalAuthError(error) {
  return TERMINAL_AUTH_ERROR_CODES.has(error?.code)
}

export function runCoalescedSessionValidation(
  inFlightRef,
  session,
  validateSession,
) {
  const accessToken = session?.access_token ?? ''
  const current = inFlightRef.current
  if (current?.accessToken === accessToken && current.promise) {
    return current.promise
  }

  let promise
  try {
    promise = Promise.resolve(validateSession(session))
  } catch (error) {
    promise = Promise.reject(error)
  }

  const entry = { accessToken, promise }
  inFlightRef.current = entry
  const clearEntry = () => {
    if (inFlightRef.current === entry) inFlightRef.current = null
  }
  promise.then(clearEntry, clearEntry)
  return promise
}

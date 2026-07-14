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

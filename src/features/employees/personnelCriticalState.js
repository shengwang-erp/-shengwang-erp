export function acquirePersonnelProtection(onCriticalStateChange) {
  if (typeof onCriticalStateChange !== 'function') return false
  try {
    return onCriticalStateChange(true) === true
  } catch {
    return false
  }
}

export function hasProtectedPersonnelState({ mutation, credentials }) {
  return (
    mutation?.operation === 'create' ||
    mutation?.operation === 'reset' ||
    Boolean(credentials)
  )
}

export function shouldBlockPersonnelExit({
  currentView,
  protectedStateActive,
}) {
  return currentView === 'employees' && protectedStateActive === true
}

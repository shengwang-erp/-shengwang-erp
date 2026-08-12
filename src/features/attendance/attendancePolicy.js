export function resolveAttendanceExperience(policy, activeSession) {
  if (policy?.attendanceRequired === false && policy?.attendanceMode === 'exempt') {
    return { kind: 'exempt' }
  }
  if (policy?.attendanceRequired !== true) throw new TypeError('invalid attendance policy')
  if (activeSession) {
    if (activeSession.attendanceMode !== policy.attendanceMode) {
      return { kind: 'policy-conflict', session: activeSession }
    }
    return {
      kind: activeSession.attendanceMode === 'project' ? 'project-active' : 'general-active',
      session: activeSession,
    }
  }
  if (policy.attendanceMode === 'project') return { kind: 'project-clock-in' }
  if (policy.attendanceMode === 'general') return { kind: 'general-clock-in' }
  throw new TypeError('invalid attendance policy')
}

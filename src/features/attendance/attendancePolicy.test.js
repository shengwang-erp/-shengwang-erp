import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAttendanceExperience } from './attendancePolicy.js'

const projectSession = Object.freeze({
  sessionId: '71000000-0000-4000-8000-000000000001',
  attendanceMode: 'project',
})
const generalSession = Object.freeze({
  sessionId: '71000000-0000-4000-8000-000000000002',
  attendanceMode: 'general',
})

test('attendance policy resolves each literal browser experience', () => {
  const cases = [
    [
      { attendanceRequired: false, attendanceMode: 'exempt' },
      null,
      { kind: 'exempt' },
    ],
    [
      { attendanceRequired: true, attendanceMode: 'general' },
      null,
      { kind: 'general-clock-in' },
    ],
    [
      { attendanceRequired: true, attendanceMode: 'project' },
      null,
      { kind: 'project-clock-in' },
    ],
    [
      { attendanceRequired: true, attendanceMode: 'general' },
      generalSession,
      { kind: 'general-active', session: generalSession },
    ],
    [
      { attendanceRequired: true, attendanceMode: 'project' },
      projectSession,
      { kind: 'project-active', session: projectSession },
    ],
    [
      { attendanceRequired: true, attendanceMode: 'general' },
      projectSession,
      { kind: 'policy-conflict', session: projectSession },
    ],
  ]

  for (const [policy, activeSession, expected] of cases) {
    assert.deepEqual(resolveAttendanceExperience(policy, activeSession), expected)
  }
})

test('attendance policy rejects invalid required and mode combinations', () => {
  for (const policy of [
    null,
    {},
    { attendanceRequired: false, attendanceMode: 'general' },
    { attendanceRequired: true, attendanceMode: 'exempt' },
    { attendanceRequired: true, attendanceMode: 'office' },
  ]) {
    assert.throws(
      () => resolveAttendanceExperience(policy, null),
      { name: 'TypeError', message: 'invalid attendance policy' },
    )
  }
})

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ACCOUNTING_RESOLUTION_TYPES,
  ATTENDANCE_ISSUE_CODES,
  buildProjectLaborCsv,
  calculatePayrollPreview,
  classifyAttendanceDay,
  enforceAttendanceCostScope,
  suggestProjectCost,
  validateProjectAllocations,
} from './laborAccountingDomain.js'

const settings = {
  effectiveFrom: '2026-07-16',
  workWeekdays: [1, 2, 3, 4, 5, 6],
  workStartTime: '08:00',
  workEndTime: '17:00',
  breakMinutes: 60,
  standardDayMinutes: 480,
}

test('required weekdays and optional Sunday classify without inventing Sunday absence', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18', nowTokyo: '2026-07-18T08:01:00+09:00', settings,
    sessions: [], resolution: null,
  }).issueCodes, ['missing_clock_in'])
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-19', nowTokyo: '2026-07-19T12:00:00+09:00', settings,
    sessions: [], resolution: null,
  }), { scheduleRequired: false, dayStatus: 'optional_not_worked', issueCodes: [] })
})

test('salary previews use only whole and half-day units', () => {
  assert.equal(calculatePayrollPreview({ salaryType: '月薪', baseSalary: 320000,
    dailySalary: 0, hourlyWage: 0, fullDays: 20, halfDays: 2,
    overtimePay: 10000, bonus: 5000, deduction: 3000 }).netSalary, 332000)
  assert.equal(calculatePayrollPreview({ salaryType: '日薪', baseSalary: 0,
    dailySalary: 12000, hourlyWage: 0, fullDays: 20, halfDays: 1,
    overtimePay: 0, bonus: 0, deduction: 0 }).basePay, 246000)
  assert.equal(calculatePayrollPreview({ salaryType: '时薪', baseSalary: 0,
    dailySalary: 0, hourlyWage: 1500, fullDays: 2, halfDays: 1,
    overtimePay: 0, bonus: 0, deduction: 0 }).basePay, 30000)
})

test('salary previews fail closed for fractional, negative, or malformed aggregate day counts', () => {
  const input = {
    salaryType: '日薪', baseSalary: 0, dailySalary: 12000, hourlyWage: 0,
    fullDays: 1, halfDays: 1, overtimePay: 1000, bonus: 500, deduction: 200,
  }
  for (const patch of [
    { fullDays: -1 },
    { fullDays: 0.5 },
    { fullDays: Number.NaN },
    { fullDays: Number.POSITIVE_INFINITY },
    { fullDays: '1' },
    { fullDays: null },
    { halfDays: -1 },
    { halfDays: 0.5 },
    { halfDays: Number.NaN },
    { halfDays: Number.POSITIVE_INFINITY },
    { halfDays: '1' },
    { halfDays: undefined },
  ]) {
    assert.deepEqual(calculatePayrollPreview({ ...input, ...patch }), {
      attendanceUnits: 0,
      basePay: 0,
      netSalary: 0,
      valid: false,
    })
  }
})

test('project cost suggestions round yen and allocations must balance', () => {
  assert.equal(suggestProjectCost({ salaryType: '月薪', baseSalary: 320000,
    dailySalary: 0, hourlyWage: 0, attendanceUnits: 0.5 }), 6667)
  assert.deepEqual(validateProjectAllocations({ finalProjectCost: 10000,
    allocations: [{ projectId: 'P1', amount: 6000 }, { projectId: 'P2', amount: 4000 }] }),
  { valid: true, allocatedTotal: 10000, difference: 0 })
  assert.equal(validateProjectAllocations({ finalProjectCost: 10000,
    allocations: [{ projectId: 'P1', amount: 9999 }] }).valid, false)
})

test('project cost suggestions distinguish valid zero from forbidden daily units', () => {
  const input = { salaryType: '日薪', baseSalary: 0, dailySalary: 12000, hourlyWage: 0 }
  assert.equal(suggestProjectCost({ ...input, attendanceUnits: 0 }), 0)
  assert.equal(suggestProjectCost({ ...input, attendanceUnits: 0.5 }), 6000)
  assert.equal(suggestProjectCost({ ...input, attendanceUnits: 1 }), 12000)
  for (const attendanceUnits of [
    -0.5, 0.25, 1.5, null, undefined, '0.5', Number.NaN, Number.POSITIVE_INFINITY,
  ]) {
    assert.equal(suggestProjectCost({ ...input, attendanceUnits }), null)
  }
})

test('general-only attendance facts force company cost scope without changing attendance conclusions', () => {
  const draft = {
    resolutionType: 'full_day', attendanceUnits: 1, finalProjectCost: 12000,
    allocations: [{ projectId: 'P1', amount: 12000, allocationNote: '' }],
    resolutionNote: '', locationReviewStatus: 'confirmed_valid',
    locationReviewNote: '现场已核对', version: 0,
  }
  assert.deepEqual(enforceAttendanceCostScope({ sessions: [{
    attendanceMode: 'general', projectId: null, projectName: null,
  }] }, draft), {
    ...draft,
    finalProjectCost: 0,
    allocations: [],
  })
  assert.strictEqual(enforceAttendanceCostScope({ sessions: [{
    attendanceMode: 'project', projectId: 'P1', projectName: '项目一',
  }] }, draft), draft)
  assert.strictEqual(enforceAttendanceCostScope({ sessions: [
    { attendanceMode: 'general', projectId: null, projectName: null },
    { attendanceMode: 'project', projectId: 'P1', projectName: '项目一' },
  ] }, draft), draft)
})

test('allocation validation rejects malformed money without coercing it to zero', () => {
  const malformed = { valid: false, allocatedTotal: null, difference: null }
  for (const finalProjectCost of [
    undefined, null, '', ' ', '10000', Number.NaN, Number.POSITIVE_INFINITY, -1, 10000.5,
  ]) {
    assert.deepEqual(validateProjectAllocations({ finalProjectCost, allocations: [] }), malformed)
  }
  for (const amount of [
    undefined, null, '', ' ', '10000', Number.NaN, Number.POSITIVE_INFINITY, -1, 10000.5,
  ]) {
    assert.deepEqual(validateProjectAllocations({
      finalProjectCost: 10000,
      allocations: [{ projectId: 'P1', amount }],
    }), malformed)
  }
  assert.deepEqual(validateProjectAllocations({ finalProjectCost: 0, allocations: [] }), {
    valid: true,
    allocatedTotal: 0,
    difference: 0,
  })
})

test('allocation validation requires trimmed IDs and detects duplicates after trimming', () => {
  const malformed = { valid: false, allocatedTotal: null, difference: null }
  for (const projectId of [undefined, null, '', ' \t', 123]) {
    assert.deepEqual(validateProjectAllocations({
      finalProjectCost: 10000,
      allocations: [{ projectId, amount: 10000 }],
    }), malformed)
  }
  assert.deepEqual(validateProjectAllocations({
    finalProjectCost: 10000,
    allocations: [{ projectId: ' P1 ', amount: 6000 }, { projectId: 'P1', amount: 4000 }],
  }), { valid: false, allocatedTotal: 10000, difference: 0 })
  assert.deepEqual(validateProjectAllocations({
    finalProjectCost: 10000,
    allocations: [{ projectId: ' P1 ', amount: 10000 }],
  }), { valid: true, allocatedTotal: 10000, difference: 0 })
  assert.deepEqual(validateProjectAllocations({
    finalProjectCost: 0,
    allocations: null,
  }), malformed)
})

test('CSV escapes quotes and starts with an Excel-compatible BOM', () => {
  const csv = buildProjectLaborCsv([{ projectName: '东京,"改修"', workDate: '2026-07-16',
    employeeNumber: 'SW-001', employeeName: '王强', attendanceUnits: 1, amount: 12000,
    accountingStatus: 'confirmed' }])
  assert.ok(csv.startsWith('\uFEFF项目,日期,员工编号,员工姓名,确认人天,分摊金额,状态\r\n'))
  assert.match(csv, /"东京,""改修"""/u)
})

test('unconfigured and pre-activation dates fail closed without synthesized absence', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T12:00:00+09:00',
    settings: { ...settings, configured: false, effectiveFrom: null },
    sessions: [],
    resolution: null,
  }), { scheduleRequired: false, dayStatus: 'unconfigured', issueCodes: [] })
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-15',
    nowTokyo: '2026-07-18T12:00:00+09:00',
    settings,
    sessions: [],
    resolution: null,
  }), { scheduleRequired: false, dayStatus: 'before_activation', issueCodes: [] })
})

test('confirmed accounting resolution takes precedence over attendance anomalies', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T12:00:00+09:00',
    settings,
    sessions: [],
    resolution: { resolutionType: 'leave', accountingStatus: 'confirmed' },
  }), { scheduleRequired: true, dayStatus: 'leave', issueCodes: [] })
})

test('first clock-in and last clock-out drive late, early, and overtime facts', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T18:30:00+09:00',
    settings,
    sessions: [{
      openedAt: '2026-07-17T23:15:00.000Z',
      closedAt: '2026-07-18T09:30:00.000Z',
      clockInEvent: { result: 'abnormal' },
      clockOutEvent: { result: 'normal' },
    }],
    resolution: null,
  }), {
    scheduleRequired: true,
    dayStatus: 'completed',
    issueCodes: ['abnormal_location', 'late', 'overtime_pending'],
  })
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T16:30:00+09:00',
    settings,
    sessions: [{
      openedAt: '2026-07-17T23:15:00.000Z',
      closedAt: '2026-07-18T07:30:00.000Z',
    }],
    resolution: null,
  }).issueCodes, ['late', 'early'])
})

test('multiple sessions use the genuine earliest clock-in and latest clock-out', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T18:30:00+09:00',
    settings,
    sessions: [
      { openedAt: '2026-07-18T00:00:00.000Z', closedAt: '2026-07-18T03:00:00.000Z' },
      { openedAt: '2026-07-18T04:00:00.000Z', closedAt: '2026-07-18T09:10:00.000Z' },
      { openedAt: '2026-07-17T22:50:00.000Z', closedAt: '2026-07-17T23:30:00.000Z' },
    ],
    resolution: null,
  }), {
    scheduleRequired: true,
    dayStatus: 'completed',
    issueCodes: ['overtime_pending'],
  })
})

test('session timestamps fall through blank and malformed aliases to later valid facts', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T18:30:00+09:00',
    settings,
    sessions: [{
      openedAt: ' ',
      clockInAt: 'not-a-time',
      clockInEvent: { serverRecordedAt: '2026-07-17T22:45:00.000Z', result: 'normal' },
      closedAt: 'not-a-time',
      clockOutAt: '',
      clockOutEvent: { serverRecordedAt: '2026-07-18T09:15:00.000Z', result: 'normal' },
    }],
    resolution: null,
  }), {
    scheduleRequired: true,
    dayStatus: 'completed',
    issueCodes: ['overtime_pending'],
  })
})

test('open sessions report missing clock-out after shift end in stable issue order', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18',
    nowTokyo: '2026-07-18T17:01:00+09:00',
    settings,
    sessions: [{
      openedAt: '2026-07-17T23:15:00.000Z',
      closedAt: null,
      clockInEvent: { result: 'abnormal' },
      clockOutEvent: null,
    }],
    resolution: null,
  }), {
    scheduleRequired: true,
    dayStatus: 'working',
    issueCodes: ['abnormal_location', 'missing_clock_out', 'late'],
  })
})

test('CSV neutralizes formula prefixes before CRLF, integer yen, and RFC 4180 escaping', () => {
  const csv = buildProjectLaborCsv([{
    projectName: 'A\r\nB',
    workDate: '2026-07-16',
    employeeNumber: 'SW-001',
    employeeName: '="unsafe"',
    attendanceUnits: 0.5,
    amount: 10000.6,
    accountingStatus: 'confirmed',
  }])
  assert.equal(csv.includes('\n') && !csv.replaceAll('\r\n', '').includes('\n'), true)
  assert.match(csv, /"A\r\nB"/u)
  assert.match(csv, /"'=""unsafe"""/u)
  assert.doesNotMatch(csv, /,"=""unsafe""",/u)
  assert.match(csv, /,0\.5,10001,confirmed(?:\r\n)?$/u)
})

test('CSV neutralizes every spreadsheet formula prefix without changing generated numeric amount', () => {
  const csv = buildProjectLaborCsv([{
    projectName: '=project',
    workDate: '+2026-07-16',
    employeeNumber: '-SW-001',
    employeeName: '@employee',
    attendanceUnits: '\t0.5',
    amount: -100,
    accountingStatus: '\rconfirmed',
  }, {
    projectName: '\nproject',
    workDate: '2026-07-17',
    employeeNumber: 'SW-002',
    employeeName: 'safe',
    attendanceUnits: 1,
    amount: 200,
    accountingStatus: 'confirmed',
  }])
  assert.ok(csv.includes("'=project"))
  assert.ok(csv.includes("'+2026-07-16"))
  assert.ok(csv.includes("'-SW-001"))
  assert.ok(csv.includes("'@employee"))
  assert.ok(csv.includes("'\t0.5"))
  assert.ok(csv.includes('"\'\rconfirmed"'))
  assert.ok(csv.includes('"\'\nproject"'))
  assert.match(csv, /,'\t0\.5,-100,"'\rconfirmed"/u)
  assert.doesNotMatch(csv, /,'-100,/u)
})

assert.deepEqual(ACCOUNTING_RESOLUTION_TYPES,
  ['full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'])
assert.deepEqual(ATTENDANCE_ISSUE_CODES,
  ['missing_clock_in', 'late', 'early', 'missing_clock_out',
    'abnormal_location', 'overtime_pending'])

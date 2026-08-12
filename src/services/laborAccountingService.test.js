import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  LaborAccountingServiceError,
  createLaborAccountingService,
  laborAccountingService,
} from './laborAccountingService.js'

const source = await readFile(new URL('./laborAccountingService.js', import.meta.url), 'utf8').catch(() => '')

const EMPLOYEE_ID = '52000000-0000-4000-8000-000000000001'
const EMPLOYEE_ID_2 = '52000000-0000-4000-8000-000000000002'
const RESOLUTION_ID = '62000000-0000-4000-8000-000000000001'
const ALLOCATION_ID = '63000000-0000-4000-8000-000000000001'
const PAYROLL_ID = '64000000-0000-4000-8000-000000000001'
const SESSION_ID = '71000000-0000-4000-8000-000000000001'
const CLOCK_IN_ID = '72000000-0000-4000-8000-000000000001'
const CLOCK_OUT_ID = '72000000-0000-4000-8000-000000000002'
const WORK_DATE = '2026-07-18'
const MONTH = '2026-07'

const clone = (value) => structuredClone(value)

function accountingSettings({ configured = true, version } = {}) {
  const result = {
    configured,
    effectiveFrom: configured ? '2026-07-16' : null,
    workWeekdays: [1, 2, 3, 4, 5, 6],
    workStartTime: '08:00',
    workEndTime: '17:00',
    breakMinutes: 60,
    standardDayMinutes: 480,
  }
  if (version !== undefined) result.version = version
  return result
}

function attendanceEvent(eventType) {
  return {
    eventId: eventType === 'clock_in' ? CLOCK_IN_ID : CLOCK_OUT_ID,
    eventType,
    serverRecordedAt: eventType === 'clock_in'
      ? '2026-07-18T08:00:00+09:00'
      : '2026-07-18T17:00:00+09:00',
    result: 'normal',
    abnormalReason: null,
  }
}

function attendanceSession() {
  return {
    sessionId: SESSION_ID,
    attendanceMode: 'project',
    projectId: 'P001',
    projectName: '东京站现场',
    status: 'closed',
    openedAt: '2026-07-18T08:00:00+09:00',
    closedAt: '2026-07-18T17:00:00+09:00',
    clockInEvent: attendanceEvent('clock_in'),
    clockOutEvent: attendanceEvent('clock_out'),
  }
}

function compactResolution() {
  return {
    resolutionId: RESOLUTION_ID,
    resolutionType: 'full_day',
    attendanceUnits: 1,
    accountingStatus: 'confirmed',
    scheduleRequired: true,
    resolutionNote: '',
    locationReviewStatus: null,
    locationReviewNote: '',
    locationReviewedByEmployeeProfileId: null,
    locationReviewedAt: null,
    confirmedAt: '2026-07-18T17:05:00+09:00',
    version: 1,
  }
}

function dashboardEmployee({ canViewSalary = true } = {}) {
  const result = {
    employeeProfileId: EMPLOYEE_ID,
    employeeNumber: 'SW-001',
    name: '山田太郎',
    department: '工程部',
    position: '大工',
    scheduleRequired: true,
    dayStatus: 'full_day',
    issueCodes: [],
    firstClockInAt: '2026-07-18T08:00:00+09:00',
    lastClockOutAt: '2026-07-18T17:00:00+09:00',
    hasOpenSession: false,
    hasAbnormalLocation: false,
    workedMinutesReference: 480,
    sessions: [attendanceSession()],
    resolution: compactResolution(),
  }
  if (canViewSalary) {
    result.salary = {
      salaryType: '日薪',
      baseSalary: null,
      dailySalary: 12000,
      hourlyWage: null,
      salaryRemark: null,
    }
  }
  return result
}

function dailyDashboard({ canViewSalary = true } = {}) {
  return {
    workDate: WORK_DATE,
    serverNowTokyo: '2026-07-18T17:06:00.000+09:00',
    settings: accountingSettings(),
    permissions: {
      canResolve: true,
      canViewSalary,
      canUpdateSalary: canViewSalary,
      canViewProjectCosts: true,
      canUpdateProjectCosts: canViewSalary,
      canUpdateSettings: true,
    },
    summary: {
      totalEmployees: 1,
      requiredEmployees: 1,
      normalCompleted: 0,
      working: 0,
      excused: 0,
      alertCount: 0,
      abnormalLocation: 0,
      missingClockIn: 0,
      missingClockOut: 0,
      late: 0,
      early: 0,
      overtimePending: 0,
    },
    filters: {
      departments: ['工程部'],
      projects: [{ projectId: 'P001', projectName: '东京站现场' }],
      dayStatuses: ['full_day'],
      issueCodes: [
        'abnormal_location', 'missing_clock_in', 'missing_clock_out',
        'late', 'early', 'overtime_pending',
      ],
    },
    employees: [dashboardEmployee({ canViewSalary })],
  }
}

function resolutionDetail({
  canViewSalary = true,
  canViewProjectCosts = true,
  hasResolution = true,
  hasMoneyScope = true,
} = {}) {
  const permissions = {
    canResolve: true,
    canViewSalary,
    canViewProjectCosts,
    canUpdateProjectCosts: canViewSalary && canViewProjectCosts,
  }
  let salary = null
  if (canViewSalary) {
    salary = {
      salaryType: '日薪',
      baseSalary: null,
      dailySalary: 12000,
      hourlyWage: null,
      suggestedProjectCost: canViewProjectCosts ? 12000 : null,
    }
  }
  let resolution = null
  let allocations = []
  if (hasResolution) {
    resolution = compactResolution()
    if (canViewSalary) {
      Object.assign(resolution, {
        salaryTypeSnapshot: '日薪',
        baseSalarySnapshot: null,
        dailySalarySnapshot: 12000,
        hourlyWageSnapshot: null,
        suggestedProjectCost: canViewProjectCosts ? 12000 : null,
        finalProjectCost: canViewProjectCosts ? 12000 : null,
      })
    }
    const allocation = {
      allocationId: ALLOCATION_ID,
      projectId: 'P001',
      projectName: '东京站现场',
      allocationNote: '',
    }
    if (canViewSalary && canViewProjectCosts) allocation.amount = 12000
    allocations = [allocation]
  }
  return {
    employee: {
      employeeProfileId: EMPLOYEE_ID,
      employeeNumber: 'SW-001',
      employeeName: '山田太郎',
      department: '工程部',
      position: '大工',
    },
    workDate: WORK_DATE,
    scheduleRequired: true,
    facts: {
      dayStatus: 'completed',
      issueCodes: [],
      firstClockInAt: '2026-07-18T08:00:00+09:00',
      lastClockOutAt: '2026-07-18T17:00:00+09:00',
      hasOpenSession: false,
      hasAbnormalLocation: false,
      workedMinutesReference: 480,
      sessions: [attendanceSession()],
    },
    hasMoneyScope,
    permissions,
    salary,
    resolution,
    allocations,
    availableProjects: canViewProjectCosts ? [
      { projectId: 'P001', projectName: '东京站现场' },
      { projectId: 'P002', projectName: '大阪现场' },
    ] : [],
  }
}

const MONTHLY_BASE_KEYS = [
  'employeeProfileId', 'employeeNumber', 'employeeName', 'department', 'position',
  'attendanceMethod', 'locationAbnormalCount', 'locationReviewSummary',
  'fullDays', 'halfDays', 'excusedDays', 'absenceDays', 'pendingDays',
  'issueCounts', 'status', 'payrollId', 'version',
]

const MONTHLY_MONEY_KEYS = [
  'salaryType', 'baseSalarySnapshot', 'basePay', 'overtimePay', 'bonus',
  'deduction', 'netSalary', 'projectAllocatedAmount',
  'projectUnallocatedAmount', 'companyPersonnelCost', 'confirmationNote', 'confirmedAt',
]

function monthlyEmployee({ legacy = false, canViewSalary = true } = {}) {
  const result = {
    employeeProfileId: legacy ? null : EMPLOYEE_ID,
    employeeNumber: legacy ? 'LEG-001' : 'SW-001',
    employeeName: legacy ? '旧员工' : '山田太郎',
    department: legacy ? '' : '工程部',
    position: legacy ? '' : '大工',
    attendanceMethod: legacy ? 'project' : 'project',
    locationAbnormalCount: 0,
    locationReviewSummary: '',
    fullDays: legacy ? 0 : 20,
    halfDays: legacy ? 0 : 1,
    excusedDays: 0,
    absenceDays: 0,
    pendingDays: legacy ? 0 : 1,
    issueCounts: { late: 0, early: 0, abnormalLocation: 0, overtimePending: 0 },
    status: legacy ? 'confirmed' : 'incomplete',
    payrollId: null,
    version: 0,
  }
  if (legacy) result.source = 'legacy'
  if (canViewSalary) {
    Object.assign(result, {
      salaryType: legacy ? '月薪' : '日薪',
      baseSalarySnapshot: legacy ? 300000 : 12000,
      basePay: legacy ? 300000 : 246000,
      overtimePay: 0,
      bonus: 0,
      deduction: 0,
      netSalary: legacy ? 300000 : 246000,
      projectAllocatedAmount: 12000,
      projectUnallocatedAmount: 0,
      companyPersonnelCost: 0,
      confirmationNote: '',
      confirmedAt: null,
    })
  }
  return result
}

function monthlyPayroll({ canViewSalary = true } = {}) {
  const summary = {
    employeeCount: 2,
    scheduledAttendanceUnits: 22,
    confirmedAttendanceUnits: 20.5,
    pendingCount: 1,
  }
  if (canViewSalary) {
    Object.assign(summary, {
      salaryPreviewTotal: 546000,
      projectAllocatedTotal: 24000,
      projectUnallocatedTotal: 0,
    })
  }
  return {
    salaryMonth: '2026-07-01',
    permissions: { canViewSalary, canUpdateSalary: canViewSalary },
    summary,
    employees: [
      monthlyEmployee({ canViewSalary }),
      monthlyEmployee({ legacy: true, canViewSalary }),
    ],
    reconciliation: { postActivationLegacyRows: 0, globalMalformedLegacyRows: 0 },
  }
}

function employeeMonthCalendar() {
  const days = []
  for (let day = 1; day <= 31; day += 1) {
    const workDate = `2026-07-${String(day).padStart(2, '0')}`
    const eligible = day >= 16
    const isoWeekday = new Date(`${workDate}T00:00:00Z`).getUTCDay() || 7
    const scheduleRequired = eligible && isoWeekday <= 6
    days.push(eligible ? {
      workDate,
      eligible: true,
      scheduleRequired,
      dayStatus: day === 18
        ? 'full_day'
        : scheduleRequired ? 'not_started' : 'optional_not_worked',
      issueCodes: [],
      accountingStatus: day === 18 ? 'confirmed' : null,
    } : {
      workDate,
      eligible: false,
      scheduleRequired: false,
      dayStatus: 'not_eligible',
      issueCodes: [],
      accountingStatus: null,
    })
  }
  return {
    salaryMonth: '2026-07',
    employee: {
      employeeProfileId: EMPLOYEE_ID,
      employeeNumber: 'SW-001',
      employeeName: '山田太郎',
      department: '工程部',
      position: '大工',
    },
    days,
  }
}

function payrollResult({ canViewSalary = true } = {}) {
  const payroll = {
    payrollId: PAYROLL_ID,
    salaryMonth: '2026-07-01',
    fullDays: 20,
    halfDays: 1,
    absenceDays: 0,
    status: 'draft',
    attendanceMethodSnapshot: 'project',
    locationAbnormalCount: 0,
    locationReviewSummary: '',
    confirmedAt: null,
    version: 1,
  }
  if (canViewSalary) {
    Object.assign(payroll, {
      salaryTypeSnapshot: '日薪',
      baseSalarySnapshot: 12000,
      basePay: 246000,
      overtimePay: 1000,
      bonus: 2000,
      deduction: 500,
      netSalary: 248500,
      companyPersonnelCost: 0,
      confirmationNote: '',
    })
  }
  return {
    employee: {
      employeeProfileId: EMPLOYEE_ID,
      employeeNumber: 'SW-001',
      employeeName: '山田太郎',
      department: '工程部',
      position: '大工',
    },
    payroll,
  }
}

function projectDetails() {
  return [
    {
      source: 'legacy', sourceKey: 'legacy-row-1', workDate: '2026-07-01',
      projectId: 'P001', projectName: '东京站现场', employeeProfileId: null,
      employeeNumber: 'LEG-001', employeeName: '旧员工', attendanceUnits: 1,
      amount: 3000, accountingStatus: 'legacy',
    },
    {
      source: 'attendance', sourceKey: ALLOCATION_ID, workDate: '2026-07-02',
      projectId: 'P001', projectName: '东京站现场', employeeProfileId: EMPLOYEE_ID,
      employeeNumber: 'SW-001', employeeName: '山田太郎', attendanceUnits: 1,
      amount: 9000, accountingStatus: 'month_locked',
    },
    {
      source: 'attendance', sourceKey: '63000000-0000-4000-8000-000000000002',
      workDate: '2026-07-03', projectId: 'P001', projectName: '东京站现场',
      employeeProfileId: EMPLOYEE_ID_2, employeeNumber: 'SW-002', employeeName: '佐藤花子',
      attendanceUnits: 0.5, amount: 4000, accountingStatus: 'draft',
    },
    {
      source: 'attendance', sourceKey: `draft-unallocated:${RESOLUTION_ID}`,
      workDate: '2026-07-03', projectId: null, projectName: '未分摊',
      employeeProfileId: EMPLOYEE_ID_2, employeeNumber: 'SW-002', employeeName: '佐藤花子',
      attendanceUnits: 0.5, amount: 1000, accountingStatus: 'draft',
    },
  ]
}

function projectReport({ canViewSalary = true, status = 'all' } = {}) {
  const allDetails = projectDetails()
  const dailyDetails = status === 'confirmed'
    ? allDetails.filter((row) => row.accountingStatus !== 'draft')
    : status === 'pending'
      ? allDetails.filter((row) => row.accountingStatus === 'draft')
      : allDetails
  return {
    salaryMonth: '2026-07-01',
    permissions: {
      canViewSalary,
      canViewEmployeeComposition: canViewSalary,
    },
    summary: {
      monthlyConfirmedCost: 12000,
      lifetimeConfirmedCost: 12000,
      confirmedAttendanceUnits: 2,
      pendingAllocationCount: 1,
      pendingAllocationAmount: 4000,
    },
    trend: [
      { salaryMonth: '2026-02', amount: 0 },
      { salaryMonth: '2026-03', amount: 0 },
      { salaryMonth: '2026-04', amount: 0 },
      { salaryMonth: '2026-05', amount: 0 },
      { salaryMonth: '2026-06', amount: 0 },
      { salaryMonth: '2026-07', amount: 12000 },
    ],
    employeeComposition: canViewSalary ? [{
      employeeProfileId: EMPLOYEE_ID,
      employeeNumber: 'SW-001',
      employeeName: '山田太郎',
      attendanceUnits: 1,
      amount: 9000,
    }] : [],
    dailyDetails: canViewSalary ? dailyDetails : [],
    projectComparison: [{
      projectId: 'P001', projectName: '东京站现场',
      monthlyConfirmedCost: 12000, lifetimeConfirmedCost: 12000,
    }],
    reconciliation: { postActivationLegacyRows: 0, globalMalformedLegacyRows: 0 },
  }
}

function projectExport() {
  return [{
    projectName: '东京站现场',
    workDate: '2026-07-02',
    employeeNumber: 'SW-001',
    employeeName: '山田太郎',
    attendanceUnits: 1,
    amount: 9000,
    accountingStatus: 'month_locked',
    source: 'attendance',
  }]
}

function bridgeSummary() {
  return {
    salaryMonth: '2026-07-01',
    isAuthoritative: true,
    salaryTotal: 546000,
    projectLaborTotal: 12000,
    projectLaborById: { P001: 12000 },
    projectLaborLifetimeTotal: 15000,
    projectLaborLifetimeById: { P001: 12000, P002: 3000 },
    pendingCount: 1,
    effectiveFrom: '2026-07-16',
  }
}

function responseFor(name, args = {}) {
  if (name === 'get_labor_alert_count_secure') {
    return { workDate: WORK_DATE, count: 0, refreshedAt: '2026-07-18T17:06:00.000+09:00' }
  }
  if (name === 'list_daily_attendance_dashboard_secure') return dailyDashboard()
  if (name.includes('attendance_resolution')) return resolutionDetail()
  if (name === 'list_monthly_payroll_secure') return monthlyPayroll()
  if (name === 'list_employee_attendance_calendar_secure') return employeeMonthCalendar()
  if (name.includes('monthly_payroll')) return payrollResult()
  if (name === 'list_project_labor_costs_secure') {
    return projectReport({ status: args.p_status })
  }
  if (name === 'export_project_labor_costs_secure') return projectExport()
  if (name.includes('attendance_accounting_settings')) {
    return accountingSettings({ version: 1 })
  }
  if (name === 'get_attendance_accounting_bridge_secure') return bridgeSummary()
  throw new Error(`unhandled test RPC: ${name}`)
}

function serviceWithResponder(responder = responseFor) {
  const calls = []
  const service = createLaborAccountingService({
    async rpc(name, args) {
      calls.push([name, args])
      return { data: responder(name, args), error: null, status: 200, statusText: 'OK' }
    },
  }, { configured: true })
  return { service, calls }
}

const resolutionPayload = () => ({
  employeeProfileId: EMPLOYEE_ID,
  workDate: WORK_DATE,
  resolutionType: 'full_day',
  attendanceUnits: 1,
  finalProjectCost: 12000,
  allocations: [{ projectId: 'P001', amount: 12000, allocationNote: '' }],
  resolutionNote: '',
  locationReviewStatus: '',
  locationReviewNote: '',
  version: 1,
})

const payrollPayload = () => ({
  employeeProfileId: EMPLOYEE_ID,
  month: MONTH,
  overtimePay: 1000,
  bonus: 2000,
  deduction: 500,
  confirmationNote: '',
  version: 1,
})

test('all fifteen methods use exact secure RPC names and arguments', async () => {
  const { service, calls } = serviceWithResponder()
  await service.getAlertCount()
  await service.listDailyDashboard({ workDate: WORK_DATE })
  await service.getResolutionDetail({ employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE })
  await service.saveResolutionDraft(resolutionPayload())
  await service.confirmResolution(resolutionPayload())
  await service.listMonthlyPayroll({
    month: MONTH, department: ' 工程部 ', employeeProfileId: EMPLOYEE_ID, onlyPending: true,
  })
  await service.listEmployeeMonthCalendar({ employeeProfileId: EMPLOYEE_ID, month: MONTH })
  await service.saveMonthlyPayrollDraft(payrollPayload())
  await service.confirmMonthlyPayroll(payrollPayload())
  await service.reopenMonthlyPayroll({ payrollId: PAYROLL_ID, reason: '\t 修正理由 \n', version: 1 })
  await service.listProjectLaborCosts({
    month: MONTH, projectId: ' P001 ', employeeProfileId: EMPLOYEE_ID, status: 'all',
  })
  await service.exportProjectLaborCosts({
    month: MONTH, projectId: ' P001 ', employeeProfileId: EMPLOYEE_ID,
  })
  await service.getSettings()
  await service.updateSettings({
    effectiveFrom: '2026-07-16', workWeekdays: [1, 2, 3, 4, 5, 6],
    workStartTime: '08:00', workEndTime: '17:00', breakMinutes: 60,
    standardDayMinutes: 480, version: 1,
  })
  await service.getBridgeSummary({ month: MONTH })

  assert.deepEqual(calls, [
    ['get_labor_alert_count_secure', {}],
    ['list_daily_attendance_dashboard_secure', { p_work_date: WORK_DATE }],
    ['get_attendance_resolution_detail_secure', {
      p_employee_profile_id: EMPLOYEE_ID, p_work_date: WORK_DATE,
    }],
    ['save_attendance_resolution_draft_secure', {
      p_employee_profile_id: EMPLOYEE_ID, p_work_date: WORK_DATE,
      p_resolution_type: 'full_day', p_attendance_units: 1,
      p_final_project_cost: 12000,
      p_allocations: [{ projectId: 'P001', amount: 12000, allocationNote: '' }],
      p_resolution_note: '', p_location_review_status: null,
      p_location_review_note: '', p_version: 1,
    }],
    ['confirm_attendance_resolution_secure', {
      p_employee_profile_id: EMPLOYEE_ID, p_work_date: WORK_DATE,
      p_resolution_type: 'full_day', p_attendance_units: 1,
      p_final_project_cost: 12000,
      p_allocations: [{ projectId: 'P001', amount: 12000, allocationNote: '' }],
      p_resolution_note: '', p_location_review_status: null,
      p_location_review_note: '', p_version: 1,
    }],
    ['list_monthly_payroll_secure', {
      p_month: '2026-07-01', p_search: '工程部',
      p_employee_profile_id: EMPLOYEE_ID, p_only_pending: true,
    }],
    ['list_employee_attendance_calendar_secure', {
      p_employee_profile_id: EMPLOYEE_ID, p_month: '2026-07-01',
    }],
    ['save_monthly_payroll_draft_secure', {
      p_employee_profile_id: EMPLOYEE_ID, p_month: '2026-07-01',
      p_overtime_pay: 1000, p_bonus: 2000, p_deduction: 500,
      p_confirmation_note: '', p_version: 1,
    }],
    ['confirm_monthly_payroll_secure', {
      p_employee_profile_id: EMPLOYEE_ID, p_month: '2026-07-01',
      p_overtime_pay: 1000, p_bonus: 2000, p_deduction: 500,
      p_confirmation_note: '', p_version: 1,
    }],
    ['reopen_monthly_payroll_secure', {
      p_payroll_id: PAYROLL_ID, p_reason: '修正理由', p_version: 1,
    }],
    ['list_project_labor_costs_secure', {
      p_month: '2026-07-01', p_status: 'all',
      p_employee_profile_id: EMPLOYEE_ID, p_project_id: 'P001',
    }],
    ['export_project_labor_costs_secure', {
      p_month: '2026-07-01', p_project_id: 'P001',
      p_employee_profile_id: EMPLOYEE_ID,
    }],
    ['get_attendance_accounting_settings_secure', {}],
    ['update_attendance_accounting_settings_secure', {
      p_effective_from: '2026-07-16', p_work_weekdays: [1, 2, 3, 4, 5, 6],
      p_work_start_time: '08:00', p_work_end_time: '17:00',
      p_break_minutes: 60, p_standard_day_minutes: 480, p_version: 1,
    }],
    ['get_attendance_accounting_bridge_secure', { p_month: '2026-07-01' }],
  ])
})

test('input and server objects are never mutated and returned month dates normalize to YYYY-MM', async () => {
  const input = payrollPayload()
  input.confirmationNote = '\t 月次確認 \n'
  const inputBefore = clone(input)
  const serverData = payrollResult()
  const serverBefore = clone(serverData)
  const { service } = serviceWithResponder(() => serverData)
  const result = await service.saveMonthlyPayrollDraft(input)
  assert.deepEqual(input, inputBefore)
  assert.deepEqual(serverData, serverBefore)
  assert.equal(result.payroll.salaryMonth, MONTH)
  assert.notStrictEqual(result, serverData)
})

test('daily dashboard validates both salary permission variants and exact issue order', async () => {
  for (const canViewSalary of [true, false]) {
    const { service } = serviceWithResponder(() => dailyDashboard({ canViewSalary }))
    const result = await service.listDailyDashboard({ workDate: WORK_DATE })
    assert.equal(Object.hasOwn(result.employees[0], 'salary'), canViewSalary)
  }

  const nullableEvents = dailyDashboard()
  nullableEvents.employees[0].sessions[0].clockInEvent = null
  nullableEvents.employees[0].sessions[0].clockOutEvent = null
  const nullableEventService = serviceWithResponder(() => nullableEvents).service
  const nullableEventResult = await nullableEventService.listDailyDashboard({ workDate: WORK_DATE })
  assert.equal(nullableEventResult.employees[0].sessions[0].clockInEvent, null)
  assert.equal(nullableEventResult.employees[0].sessions[0].clockOutEvent, null)

  for (const mutate of [
    (row) => { row.permissions.can_view_salary = row.permissions.canViewSalary },
    (row) => { delete row.permissions.canResolve },
    (row) => { row.permissions.canUpdateSalary = false; row.permissions.canUpdateProjectCosts = true },
    (row) => { row.filters.issueCodes = [...row.filters.issueCodes].reverse() },
    (row) => { row.employees[0].issueCodes = ['late', 'abnormal_location'] },
    (row) => { row.employees[0].salary.baseSalary = 1 },
    (row) => { row.employees[0].sessions[0].clockInEvent.eventType = 'clock_out' },
  ]) {
    const malformed = dailyDashboard()
    mutate(malformed)
    const { service } = serviceWithResponder(() => malformed)
    await assert.rejects(
      () => service.listDailyDashboard({ workDate: WORK_DATE }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('daily DTOs require exact attendance modes, nullable general project identity, and review metadata', async () => {
  const general = dailyDashboard()
  Object.assign(general.employees[0].sessions[0], {
    attendanceMode: 'general', projectId: null, projectName: null,
  })
  const generalResult = await serviceWithResponder(() => general).service
    .listDailyDashboard({ workDate: WORK_DATE })
  assert.deepEqual(
    Object.fromEntries(['attendanceMode', 'projectId', 'projectName'].map((key) => [
      key, generalResult.employees[0].sessions[0][key],
    ])),
    { attendanceMode: 'general', projectId: null, projectName: null },
  )

  const reviewed = resolutionDetail()
  Object.assign(reviewed.facts, {
    issueCodes: ['abnormal_location'], hasAbnormalLocation: true,
  })
  reviewed.facts.sessions[0].clockInEvent.result = 'abnormal'
  reviewed.facts.sessions[0].clockInEvent.abnormalReason = '定位距离现场 420 米'
  Object.assign(reviewed.resolution, {
    locationReviewStatus: 'confirmed_valid',
    locationReviewNote: '已核对现场负责人',
    locationReviewedByEmployeeProfileId: EMPLOYEE_ID_2,
    locationReviewedAt: '2026-07-18T17:05:00+09:00',
  })
  const reviewedResult = await serviceWithResponder(() => reviewed).service
    .getResolutionDetail({ employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE })
  assert.equal(reviewedResult.resolution.locationReviewStatus, 'confirmed_valid')
  assert.equal(reviewedResult.resolution.locationReviewNote, '已核对现场负责人')

  for (const mutate of [
    (row) => { delete row.employees[0].sessions[0].attendanceMode },
    (row) => { row.employees[0].sessions[0].attendanceMode = 'unknown' },
    (row) => { row.employees[0].sessions[0].attendanceMode = 'general' },
    (row) => { row.employees[0].sessions[0].projectId = null },
    (row) => { row.employees[0].resolution.locationReviewStatus = 'ignored' },
    (row) => { row.employees[0].resolution.locationReviewNote = 'missing status' },
    (row) => { row.employees[0].resolution.locationReviewStatus = 'recorded_abnormal' },
  ]) {
    const malformed = dailyDashboard()
    mutate(malformed)
    await assert.rejects(
      () => serviceWithResponder(() => malformed).service
        .listDailyDashboard({ workDate: WORK_DATE }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('daily dashboard rejects non-enumerable required response fields', async () => {
  const data = dailyDashboard()
  const hiddenSummary = {}
  for (const [key, value] of Object.entries(data.summary)) {
    Object.defineProperty(hiddenSummary, key, {
      value, enumerable: false, configurable: true, writable: true,
    })
  }
  data.summary = hiddenSummary
  const { service } = serviceWithResponder(() => data)

  await assert.rejects(
    () => service.listDailyDashboard({ workDate: WORK_DATE }),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )
})

test('resolution detail accepts only explicit salary and project-money variants', async () => {
  const variants = [
    { canViewSalary: false, canViewProjectCosts: false, amount: false },
    { canViewSalary: true, canViewProjectCosts: false, amount: false },
    { canViewSalary: true, canViewProjectCosts: true, amount: true },
    { canViewSalary: false, canViewProjectCosts: true, amount: false },
  ]
  for (const variant of variants) {
    const data = resolutionDetail(variant)
    const { service } = serviceWithResponder(() => data)
    const result = await service.getResolutionDetail({
      employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
    })
    assert.equal(Object.hasOwn(result.allocations[0], 'amount'), variant.amount)
    assert.equal(result.availableProjects.length, variant.canViewProjectCosts ? 2 : 0)
  }
  const noResolution = resolutionDetail({ hasResolution: false, hasMoneyScope: false })
  const { service } = serviceWithResponder(() => noResolution)
  assert.equal((await service.getResolutionDetail({
    employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
  })).resolution, null)

  for (const malformed of [
    (() => { const row = resolutionDetail({ canViewSalary: false }); row.salary = {}; return row })(),
    (() => { const row = resolutionDetail({ canViewProjectCosts: false }); row.allocations[0].amount = 1; return row })(),
    (() => { const row = resolutionDetail(); delete row.resolution.finalProjectCost; return row })(),
    (() => { const row = resolutionDetail(); row.allocations[0].amount = 0.5; return row })(),
    (() => { const row = resolutionDetail({ canViewProjectCosts: false }); row.availableProjects = [{ projectId: 'P001', projectName: '东京站现场' }]; return row })(),
    (() => { const row = resolutionDetail(); row.availableProjects[1].projectId = 'P001'; return row })(),
    (() => { const row = resolutionDetail(); row.availableProjects[1].projectId = ' P001 '; return row })(),
    (() => { const row = resolutionDetail(); row.availableProjects[0].unexpected = true; return row })(),
    (() => { const row = resolutionDetail(); row.availableProjects = Array(2); row.availableProjects[0] = { projectId: 'P001', projectName: '东京站现场' }; return row })(),
    (() => { const row = resolutionDetail(); Object.setPrototypeOf(row.availableProjects, null); return row })(),
    (() => { const row = resolutionDetail(); Object.setPrototypeOf(row.availableProjects[0], { inherited: true }); return row })(),
    (() => {
      const row = resolutionDetail()
      Object.defineProperty(row.availableProjects[0], 'projectName', {
        enumerable: true,
        get: () => '东京站现场',
      })
      return row
    })(),
  ]) {
    const malformedService = serviceWithResponder(() => malformed).service
    await assert.rejects(
      () => malformedService.getResolutionDetail({ employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }

  const maximum = resolutionDetail()
  maximum.availableProjects = Array.from({ length: 10000 }, (_, index) => ({
    projectId: `P-${index}`,
    projectName: `项目 ${index}`,
  }))
  const maximumService = serviceWithResponder(() => maximum).service
  assert.equal((await maximumService.getResolutionDetail({
    employeeProfileId: EMPLOYEE_ID,
    workDate: WORK_DATE,
  })).availableProjects.length, 10000)

  const tooMany = resolutionDetail()
  tooMany.availableProjects = Array.from({ length: 10001 }, (_, index) => ({
    projectId: `P-${index}`,
    projectName: `项目 ${index}`,
  }))
  const tooManyService = serviceWithResponder(() => tooMany).service
  await assert.rejects(
    () => tooManyService.getResolutionDetail({
      employeeProfileId: EMPLOYEE_ID,
      workDate: WORK_DATE,
    }),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )
})

test('general resolution detail accepts zero suggested cost without project-cost permission', async () => {
  const data = resolutionDetail({ canViewSalary: true, canViewProjectCosts: false })
  Object.assign(data.facts.sessions[0], {
    attendanceMode: 'general', projectId: null, projectName: null,
  })
  data.salary.suggestedProjectCost = 0
  data.allocations = []
  data.hasMoneyScope = false
  const result = await serviceWithResponder(() => data).service.getResolutionDetail({
    employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
  })
  assert.equal(result.salary.suggestedProjectCost, 0)
  assert.deepEqual(result.availableProjects, [])

  const visible = resolutionDetail()
  Object.assign(visible.facts.sessions[0], {
    attendanceMode: 'general', projectId: null, projectName: null,
  })
  visible.salary.suggestedProjectCost = 0
  visible.resolution.suggestedProjectCost = 0
  visible.resolution.finalProjectCost = 0
  visible.allocations = []
  visible.availableProjects = []
  visible.hasMoneyScope = false
  await serviceWithResponder(() => visible).service.getResolutionDetail({
    employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
  })

  for (const mutate of [
    (row) => { row.resolution.finalProjectCost = 1 },
    (row) => { row.salary.suggestedProjectCost = 1 },
    (row) => { row.resolution.suggestedProjectCost = 1 },
    (row) => { row.hasMoneyScope = true },
    (row) => { row.availableProjects = [{ projectId: 'P001', projectName: '东京站现场' }] },
  ]) {
    const malformed = clone(visible)
    mutate(malformed)
    await assert.rejects(
      () => serviceWithResponder(() => malformed).service.getResolutionDetail({
        employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
      }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('resolution detail review metadata must match immutable abnormal-location facts', async () => {
  const abnormalWithoutReview = resolutionDetail()
  Object.assign(abnormalWithoutReview.facts, {
    issueCodes: ['abnormal_location'], hasAbnormalLocation: true,
  })
  abnormalWithoutReview.facts.sessions[0].clockInEvent.result = 'abnormal'
  abnormalWithoutReview.facts.sessions[0].clockInEvent.abnormalReason = '定位距离现场 420 米'
  await assert.rejects(
    () => serviceWithResponder(() => abnormalWithoutReview).service.getResolutionDetail({
      employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
    }),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )

  const normalWithReview = resolutionDetail()
  Object.assign(normalWithReview.resolution, {
    locationReviewStatus: 'recorded_abnormal',
    locationReviewNote: '不应出现',
    locationReviewedByEmployeeProfileId: EMPLOYEE_ID_2,
    locationReviewedAt: '2026-07-18T17:05:00+09:00',
  })
  await assert.rejects(
    () => serviceWithResponder(() => normalWithReview).service.getResolutionDetail({
      employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
    }),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )
})

test('resolution detail preserves server money scope independently of visible money and attendance units', async () => {
  const hiddenMoney = resolutionDetail({
    canViewSalary: false, canViewProjectCosts: false, hasMoneyScope: true,
  })
  hiddenMoney.allocations = []
  const hiddenService = serviceWithResponder(() => hiddenMoney).service
  const hiddenResult = await hiddenService.getResolutionDetail({
    employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
  })
  assert.equal(hiddenResult.hasMoneyScope, true)
  assert.equal(hiddenResult.salary, null)
  assert.deepEqual(hiddenResult.allocations, [])

  const positiveUnitsWithoutMoney = resolutionDetail({
    canViewSalary: false, canViewProjectCosts: false, hasMoneyScope: false,
  })
  positiveUnitsWithoutMoney.allocations = []
  const noMoneyService = serviceWithResponder(() => positiveUnitsWithoutMoney).service
  const noMoneyResult = await noMoneyService.getResolutionDetail({
    employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE,
  })
  assert.equal(noMoneyResult.resolution.attendanceUnits, 1)
  assert.equal(noMoneyResult.hasMoneyScope, false)
})

test('resolution detail requires an exact enumerable boolean money-scope field', async () => {
  const malformed = [
    (() => { const row = resolutionDetail(); delete row.hasMoneyScope; return row })(),
    (() => { const row = resolutionDetail(); row.hasMoneyScope = 'true'; return row })(),
    (() => { const row = resolutionDetail(); row.unexpected = true; return row })(),
    (() => {
      const row = resolutionDetail()
      Object.defineProperty(row, 'hasMoneyScope', { enumerable: true, get: () => true })
      return row
    })(),
    (() => {
      const row = resolutionDetail()
      Object.defineProperty(row, 'hasMoneyScope', { value: true, enumerable: false })
      return row
    })(),
  ]
  for (const data of malformed) {
    const service = serviceWithResponder(() => data).service
    await assert.rejects(
      () => service.getResolutionDetail({ employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('monthly payroll validates canonical and legacy rows with salary-redacted alternatives', async () => {
  for (const canViewSalary of [true, false]) {
    const data = monthlyPayroll({ canViewSalary })
    const { service } = serviceWithResponder(() => data)
    const result = await service.listMonthlyPayroll({
      month: MONTH, department: '', employeeProfileId: null, onlyPending: false,
    })
    assert.equal(result.salaryMonth, MONTH)
    assert.deepEqual(
      Object.keys(result.employees[0]).sort(),
      [...MONTHLY_BASE_KEYS, ...(canViewSalary ? MONTHLY_MONEY_KEYS : [])].sort(),
    )
    assert.equal(result.employees[1].source, 'legacy')
  }

  for (const malformed of [
    (() => { const row = monthlyPayroll({ canViewSalary: false }); row.summary.salaryPreviewTotal = 0; return row })(),
    (() => { const row = monthlyPayroll(); delete row.employees[0].netSalary; return row })(),
    (() => { const row = monthlyPayroll(); row.employees[1].source = 'database'; return row })(),
    (() => { const row = monthlyPayroll(); row.employees[0].status = 'draft'; return row })(),
    (() => {
      const row = monthlyPayroll()
      Object.assign(row.employees[0], {
        status: 'confirmed', payrollId: PAYROLL_ID, version: 1, confirmedAt: null,
      })
      return row
    })(),
    (() => { const row = monthlyPayroll(); row.summary.pendingCount = 0; return row })(),
    (() => { const row = monthlyPayroll(); row.summary.confirmedAttendanceUnits = 20; return row })(),
    (() => { const row = monthlyPayroll(); row.summary.scheduledAttendanceUnits = 2.5; return row })(),
    (() => { const row = monthlyPayroll(); row.summary.confirmedFullDays = 20; return row })(),
    (() => { const row = monthlyPayroll(); row.salaryMonth = '2026-08-01'; return row })(),
    (() => { const row = monthlyPayroll(); row.employees[0].attendanceMethod = 'clock'; return row })(),
    (() => { const row = monthlyPayroll(); row.employees[0].companyPersonnelCost = -1; return row })(),
    (() => { const row = monthlyPayroll(); row.employees[0].attendanceMethod = 'general'; row.employees[0].companyPersonnelCost = 0; return row })(),
    (() => { const row = monthlyPayroll({ canViewSalary: false }); row.employees[0].companyPersonnelCost = 1; return row })(),
  ]) {
    const { service } = serviceWithResponder(() => malformed)
    await assert.rejects(
      () => service.listMonthlyPayroll({ month: MONTH, department: '', employeeProfileId: null, onlyPending: false }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('monthly DTOs preserve method, position, company cost, and location review summary', async () => {
  const data = monthlyPayroll()
  Object.assign(data.employees[0], {
    attendanceMethod: 'general',
    companyPersonnelCost: 246000,
    projectAllocatedAmount: 0,
    projectUnallocatedAmount: 0,
    locationAbnormalCount: 2,
    locationReviewSummary: '确认有效 1 条；判定异常 1 条',
  })
  const result = await serviceWithResponder(() => data).service.listMonthlyPayroll({
    month: MONTH, department: '', employeeProfileId: null, onlyPending: false,
  })
  assert.deepEqual(Object.fromEntries([
    'position', 'attendanceMethod', 'companyPersonnelCost',
    'locationAbnormalCount', 'locationReviewSummary',
  ].map((key) => [key, result.employees[0][key]])), {
    position: '大工',
    attendanceMethod: 'general',
    companyPersonnelCost: 246000,
    locationAbnormalCount: 2,
    locationReviewSummary: '确认有效 1 条；判定异常 1 条',
  })
})

test('monthly location review aggregates accept legal notes and share one bounded contract', async () => {
  const noteAtTaskFiveLimit = '核'.repeat(2000)
  const oneLegalEntry = `2026-07-01 确认有效：${noteAtTaskFiveLimit}`
  const multipleLegalEntries = `${oneLegalEntry}；2026-07-02 判定异常：${noteAtTaskFiveLimit}`

  const monthly = monthlyPayroll()
  monthly.employees[0].locationReviewSummary = multipleLegalEntries
  const monthlyResult = await serviceWithResponder(() => monthly).service.listMonthlyPayroll({
    month: MONTH, department: '', employeeProfileId: null, onlyPending: false,
  })
  assert.equal(monthlyResult.employees[0].locationReviewSummary, multipleLegalEntries)

  const payroll = payrollResult()
  payroll.payroll.locationReviewSummary = oneLegalEntry
  const payrollWriteResult = await serviceWithResponder(() => payroll).service
    .saveMonthlyPayrollDraft(payrollPayload())
  assert.equal(payrollWriteResult.payroll.locationReviewSummary, oneLegalEntry)

  const aboveAggregateLimit = '异'.repeat(65537)
  for (const [response, invoke] of [
    [(() => {
      const row = monthlyPayroll()
      row.employees[0].locationReviewSummary = aboveAggregateLimit
      return row
    })(), (service) => service.listMonthlyPayroll({
      month: MONTH, department: '', employeeProfileId: null, onlyPending: false,
    })],
    [(() => {
      const row = payrollResult()
      row.payroll.locationReviewSummary = aboveAggregateLimit
      return row
    })(), (service) => service.saveMonthlyPayrollDraft(payrollPayload())],
  ]) {
    await assert.rejects(
      () => invoke(serviceWithResponder(() => response).service),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('monthly location review aggregates count supplementary characters as Unicode code points', async () => {
  const maxLegalMonthlySummary = Array.from({ length: 31 }, (_, index) => (
    `2026-07-${String(index + 1).padStart(2, '0')} 判定异常：${'🚀'.repeat(2000)}`
  )).join('；')
  assert.equal(Array.from(maxLegalMonthlySummary).length, 62526)
  assert.ok(maxLegalMonthlySummary.length > 65536)

  const monthly = monthlyPayroll()
  monthly.employees[0].locationReviewSummary = maxLegalMonthlySummary
  const monthlyResult = await serviceWithResponder(() => monthly).service.listMonthlyPayroll({
    month: MONTH, department: '', employeeProfileId: null, onlyPending: false,
  })
  assert.equal(monthlyResult.employees[0].locationReviewSummary, maxLegalMonthlySummary)

  const payroll = payrollResult()
  payroll.payroll.locationReviewSummary = maxLegalMonthlySummary
  const payrollWriteResult = await serviceWithResponder(() => payroll).service
    .saveMonthlyPayrollDraft(payrollPayload())
  assert.equal(payrollWriteResult.payroll.locationReviewSummary, maxLegalMonthlySummary)

  const oneCodePointOverLimit = '🚀'.repeat(65537)
  for (const [response, invoke] of [
    [(() => {
      const row = monthlyPayroll()
      row.employees[0].locationReviewSummary = oneCodePointOverLimit
      return row
    })(), (service) => service.listMonthlyPayroll({
      month: MONTH, department: '', employeeProfileId: null, onlyPending: false,
    })],
    [(() => {
      const row = payrollResult()
      row.payroll.locationReviewSummary = oneCodePointOverLimit
      return row
    })(), (service) => service.saveMonthlyPayrollDraft(payrollPayload())],
  ]) {
    await assert.rejects(
      () => invoke(serviceWithResponder(() => response).service),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('employee month calendar validates exact identity, month coverage, order, and safe day facts', async () => {
  const { service } = serviceWithResponder(() => employeeMonthCalendar())
  const result = await service.listEmployeeMonthCalendar({
    employeeProfileId: EMPLOYEE_ID,
    month: MONTH,
  })
  assert.equal(result.salaryMonth, MONTH)
  assert.equal(result.days.length, 31)
  assert.equal(result.days[0].dayStatus, 'not_eligible')
  assert.equal(result.days[17].accountingStatus, 'confirmed')
  assert.equal(result.days[18].scheduleRequired, false)

  const frozenIssueCalendar = employeeMonthCalendar()
  frozenIssueCalendar.days[17].issueCodes = ['late']
  const frozenIssueService = serviceWithResponder(() => frozenIssueCalendar).service
  const frozenIssueResult = await frozenIssueService.listEmployeeMonthCalendar({
    employeeProfileId: EMPLOYEE_ID,
    month: MONTH,
  })
  assert.deepEqual(frozenIssueResult.days[17].issueCodes, ['late'])

  for (const dayStatus of ['before_activation', 'unconfigured']) {
    const inactiveCalendar = employeeMonthCalendar()
    Object.assign(inactiveCalendar.days[18], {
      scheduleRequired: false,
      dayStatus,
      issueCodes: [],
      accountingStatus: null,
    })
    const inactiveService = serviceWithResponder(() => inactiveCalendar).service
    const inactiveResult = await inactiveService.listEmployeeMonthCalendar({
      employeeProfileId: EMPLOYEE_ID,
      month: MONTH,
    })
    assert.equal(inactiveResult.days[18].eligible, true)
    assert.equal(inactiveResult.days[18].dayStatus, dayStatus)
  }

  const missingClockCalendar = employeeMonthCalendar()
  Object.assign(missingClockCalendar.days[19], {
    dayStatus: 'missing_clock_in',
    issueCodes: ['missing_clock_in'],
  })
  const missingClockService = serviceWithResponder(() => missingClockCalendar).service
  const missingClockResult = await missingClockService.listEmployeeMonthCalendar({
    employeeProfileId: EMPLOYEE_ID,
    month: MONTH,
  })
  assert.equal(missingClockResult.days[19].dayStatus, 'missing_clock_in')

  const malformedRows = [
    (() => { const row = employeeMonthCalendar(); row.salaryMonth = '2026-08'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.employee.employeeProfileId = EMPLOYEE_ID_2; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days.pop(); return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[1].workDate = row.days[0].workDate; return row })(),
    (() => { const row = employeeMonthCalendar(); [row.days[0], row.days[1]] = [row.days[1], row.days[0]]; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[0].scheduleRequired = true; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[0].dayStatus = 'before_activation'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[0].issueCodes = ['late']; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[0].accountingStatus = 'draft'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].dayStatus = 'not_eligible'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].accountingStatus = 'approved'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].issueCodes = ['late', 'abnormal_location']; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].dayStatus = 'full_day'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[17].dayStatus = 'completed'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[19].dayStatus = 'before_activation'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].dayStatus = 'before_activation'; row.days[18].issueCodes = ['late']; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].dayStatus = 'unconfigured'; row.days[18].accountingStatus = 'draft'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[19].dayStatus = 'missing_clock_in'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[19].dayStatus = 'missing_clock_in'; row.days[19].issueCodes = ['missing_clock_in', 'late']; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].dayStatus = 'not_started'; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[19].issueCodes = ['late']; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].issueCodes = ['late']; return row })(),
    (() => { const row = employeeMonthCalendar(); row.days[18].unexpected = true; return row })(),
  ]
  for (const data of malformedRows) {
    const malformedService = serviceWithResponder(() => data).service
    await assert.rejects(
      () => malformedService.listEmployeeMonthCalendar({
        employeeProfileId: EMPLOYEE_ID,
        month: MONTH,
      }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('employee month calendar rejects impossible live issues without rejecting frozen resolution facts', async (t) => {
  const invalidDayFacts = [
    ['late requires a scheduled day',
      { dayStatus: 'completed', scheduleRequired: false, issueCodes: ['late'] }],
    ['early requires a scheduled day',
      { dayStatus: 'completed', scheduleRequired: false, issueCodes: ['early'] }],
    ['missing clock-in requires a scheduled day',
      { dayStatus: 'completed', scheduleRequired: false, issueCodes: ['missing_clock_in'] }],
    ['missing clock-in must be the only issue',
      { dayStatus: 'completed', scheduleRequired: true, issueCodes: ['missing_clock_in', 'late'] }],
    ['working cannot be early',
      { dayStatus: 'working', scheduleRequired: true, issueCodes: ['early'] }],
    ['completed cannot be missing clock-out',
      { dayStatus: 'completed', scheduleRequired: true, issueCodes: ['missing_clock_out'] }],
  ]
  for (const [name, invalidDayFact] of invalidDayFacts) {
    await t.test(name, async () => {
      const calendar = employeeMonthCalendar()
      Object.assign(calendar.days[19], invalidDayFact)
      const service = serviceWithResponder(() => calendar).service
      await assert.rejects(
        () => service.listEmployeeMonthCalendar({
          employeeProfileId: EMPLOYEE_ID,
          month: MONTH,
        }),
        (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
      )
    })
  }

  for (const accountingStatus of ['confirmed', 'month_locked']) {
    for (const issueCodes of [['early'], ['missing_clock_in']]) {
      const frozenCalendar = employeeMonthCalendar()
      Object.assign(frozenCalendar.days[17], {
        dayStatus: 'full_day',
        scheduleRequired: true,
        issueCodes,
        accountingStatus,
      })
      const service = serviceWithResponder(() => frozenCalendar).service
      const result = await service.listEmployeeMonthCalendar({
        employeeProfileId: EMPLOYEE_ID,
        month: MONTH,
      })
      assert.deepEqual(result.days[17].issueCodes, issueCodes)
      assert.equal(result.days[17].accountingStatus, accountingStatus)
    }

    const impossibleFrozenCalendar = employeeMonthCalendar()
    Object.assign(impossibleFrozenCalendar.days[17], {
      dayStatus: 'full_day',
      scheduleRequired: true,
      issueCodes: ['missing_clock_out'],
      accountingStatus,
    })
    const impossibleFrozenService = serviceWithResponder(
      () => impossibleFrozenCalendar,
    ).service
    await assert.rejects(
      () => impossibleFrozenService.listEmployeeMonthCalendar({
        employeeProfileId: EMPLOYEE_ID,
        month: MONTH,
      }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('payroll write DTOs validate the explicit salary visibility alternatives', async () => {
  for (const canViewSalary of [true, false]) {
    const { service } = serviceWithResponder(() => payrollResult({ canViewSalary }))
    const result = await service.saveMonthlyPayrollDraft(payrollPayload())
    assert.equal(Object.hasOwn(result.payroll, 'netSalary'), canViewSalary)
    assert.equal(result.payroll.salaryMonth, MONTH)
  }
  const malformed = payrollResult()
  malformed.payroll.netSalary = Number.MAX_SAFE_INTEGER + 1
  const { service } = serviceWithResponder(() => malformed)
  await assert.rejects(
    () => service.saveMonthlyPayrollDraft(payrollPayload()),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )

  const general = payrollResult()
  Object.assign(general.payroll, {
    attendanceMethodSnapshot: 'general',
    companyPersonnelCost: general.payroll.netSalary,
    locationAbnormalCount: 1,
    locationReviewSummary: '判定异常 1 条',
  })
  const generalResult = await serviceWithResponder(() => general).service
    .confirmMonthlyPayroll(payrollPayload())
  assert.equal(generalResult.employee.position, '大工')
  assert.equal(generalResult.payroll.attendanceMethodSnapshot, 'general')
  assert.equal(generalResult.payroll.companyPersonnelCost, 248500)

  for (const malformed of [
    (() => { const row = payrollResult(); row.payroll.attendanceMethodSnapshot = 'unknown'; return row })(),
    (() => { const row = payrollResult(); row.payroll.companyPersonnelCost = -1; return row })(),
    (() => { const row = payrollResult({ canViewSalary: false }); row.payroll.companyPersonnelCost = 1; return row })(),
  ]) {
    await assert.rejects(
      () => serviceWithResponder(() => malformed).service
        .saveMonthlyPayrollDraft(payrollPayload()),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('project reporting validates salary redaction and all confirmed/pending detail variants', async () => {
  for (const status of ['all', 'confirmed', 'pending']) {
    const data = projectReport({ status })
    const { service } = serviceWithResponder(() => data)
    const result = await service.listProjectLaborCosts({
      month: MONTH, projectId: null, employeeProfileId: null, status,
    })
    assert.ok(result.dailyDetails.every((row) =>
      status === 'all' || (status === 'pending') === (row.accountingStatus === 'draft')))
  }
  const redacted = projectReport({ canViewSalary: false })
  const redactedService = serviceWithResponder(() => redacted).service
  const redactedResult = await redactedService.listProjectLaborCosts({
    month: MONTH, projectId: null, employeeProfileId: null, status: 'all',
  })
  assert.deepEqual(redactedResult.employeeComposition, [])
  assert.deepEqual(redactedResult.dailyDetails, [])

  const blankLegacyIdentity = projectReport()
  Object.assign(blankLegacyIdentity.employeeComposition[0], {
    employeeProfileId: null, employeeNumber: '', employeeName: '',
  })
  Object.assign(blankLegacyIdentity.dailyDetails[0], {
    employeeNumber: '', employeeName: '',
  })
  const blankLegacyService = serviceWithResponder(() => blankLegacyIdentity).service
  const blankLegacyResult = await blankLegacyService.listProjectLaborCosts({
    month: MONTH, projectId: null, employeeProfileId: null, status: 'all',
  })
  assert.equal(blankLegacyResult.dailyDetails[0].employeeNumber, '')

  for (const malformed of [
    (() => { const row = projectReport({ canViewSalary: false }); row.dailyDetails = [projectDetails()[0]]; return row })(),
    (() => { const row = projectReport(); row.dailyDetails[0].source = 'raw'; return row })(),
    (() => { const row = projectReport(); row.dailyDetails[3].projectId = 'P001'; return row })(),
    (() => { const row = projectReport(); row.dailyDetails[3].sourceKey = 'not-unallocated'; return row })(),
    (() => { const row = projectReport({ status: 'pending' }); row.dailyDetails.push(projectDetails()[0]); return row })(),
  ]) {
    const { service } = serviceWithResponder(() => malformed)
    await assert.rejects(
      () => service.listProjectLaborCosts({ month: MONTH, projectId: null, employeeProfileId: null, status: 'pending' }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('project trend is bounded to the six-month lookback needed by public report months', async () => {
  const boundary = projectReport()
  boundary.salaryMonth = '1900-01-01'
  boundary.trend = ['1899-08', '1899-09', '1899-10', '1899-11', '1899-12', '1900-01']
    .map((salaryMonth) => ({ salaryMonth, amount: 0 }))
  const boundaryService = serviceWithResponder(() => boundary).service
  const result = await boundaryService.listProjectLaborCosts({
    month: '1900-01', projectId: null, employeeProfileId: null, status: 'all',
  })
  assert.deepEqual(result.trend.map((row) => row.salaryMonth), [
    '1899-08', '1899-09', '1899-10', '1899-11', '1899-12', '1900-01',
  ])

  const tooEarly = clone(boundary)
  tooEarly.trend[0].salaryMonth = '1899-07'
  const tooEarlyService = serviceWithResponder(() => tooEarly).service
  await assert.rejects(
    () => tooEarlyService.listProjectLaborCosts({
      month: '1900-01', projectId: null, employeeProfileId: null, status: 'all',
    }),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )
})

test('settings, exports, alerts, and bridge DTOs reject malformed nested values and project maps', async () => {
  const successCases = [
    ['getSettings', undefined, accountingSettings({ configured: false, version: 0 })],
    ['getSettings', undefined, accountingSettings({ version: 2 })],
    ['exportProjectLaborCosts', { month: MONTH, projectId: null, employeeProfileId: null }, projectExport()],
    ['exportProjectLaborCosts', { month: MONTH, projectId: null, employeeProfileId: null }, [{
      ...projectExport()[0], source: 'legacy', accountingStatus: 'legacy',
      employeeNumber: '', employeeName: '',
    }]],
    ['getAlertCount', undefined, { workDate: WORK_DATE, count: 0, refreshedAt: '2026-07-18T17:06:00+09:00' }],
    ['getBridgeSummary', { month: MONTH }, bridgeSummary()],
    ['getBridgeSummary', { month: MONTH }, {
      ...bridgeSummary(),
      projectLaborTotal: 0,
      projectLaborById: {},
      projectLaborLifetimeTotal: 0,
      projectLaborLifetimeById: {},
    }],
  ]
  for (const [method, input, data] of successCases) {
    const { service } = serviceWithResponder(() => data)
    const result = input === undefined ? await service[method]() : await service[method](input)
    assert.ok(result !== null)
  }

  const poisonedMap = JSON.parse('{"__proto__": 1}')
  for (const [method, input, data] of [
    ['getSettings', undefined, { ...accountingSettings({ version: 1 }), workStartTime: '08:00:00' }],
    ['exportProjectLaborCosts', { month: MONTH, projectId: null, employeeProfileId: null }, [{ ...projectExport()[0], amount: -1 }]],
    ['getAlertCount', undefined, { workDate: WORK_DATE, count: -0, refreshedAt: '2026-07-18T17:06:00+09:00' }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), projectLaborById: poisonedMap }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), projectLaborById: { P001: Number.NaN } }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), salaryMonth: '2026-08-01' }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), projectLaborTotal: 12001 }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), projectLaborLifetimeTotal: 15001 }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), projectLaborLifetimeById: { P001: 15000, P002: 1 } }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), isAuthoritative: false }],
    ['getBridgeSummary', { month: MONTH }, { ...bridgeSummary(), effectiveFrom: null }],
    ['getBridgeSummary', { month: MONTH }, {
      ...bridgeSummary(),
      effectiveFrom: '2026-08-01',
      isAuthoritative: false,
      pendingCount: 1,
    }],
    ['getBridgeSummary', { month: MONTH }, {
      ...bridgeSummary(),
      projectLaborLifetimeById: { P002: 15000 },
    }],
    ['getBridgeSummary', { month: MONTH }, {
      ...bridgeSummary(),
      projectLaborLifetimeById: { P001: 11000, P002: 4000 },
    }],
  ]) {
    const { service } = serviceWithResponder(() => data)
    await assert.rejects(
      () => input === undefined ? service[method]() : service[method](input),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('every method rejects null, missing data/error wrappers, and extra top-level DTO keys', async () => {
  const invocations = [
    ['getAlertCount'],
    ['listDailyDashboard', { workDate: WORK_DATE }],
    ['getResolutionDetail', { employeeProfileId: EMPLOYEE_ID, workDate: WORK_DATE }],
    ['saveResolutionDraft', resolutionPayload()],
    ['confirmResolution', resolutionPayload()],
    ['listMonthlyPayroll', { month: MONTH, department: '', employeeProfileId: null, onlyPending: false }],
    ['listEmployeeMonthCalendar', { employeeProfileId: EMPLOYEE_ID, month: MONTH }],
    ['saveMonthlyPayrollDraft', payrollPayload()],
    ['confirmMonthlyPayroll', payrollPayload()],
    ['reopenMonthlyPayroll', { payrollId: PAYROLL_ID, reason: '修正', version: 1 }],
    ['listProjectLaborCosts', { month: MONTH, projectId: null, employeeProfileId: null, status: 'all' }],
    ['exportProjectLaborCosts', { month: MONTH, projectId: null, employeeProfileId: null }],
    ['getSettings'],
    ['updateSettings', {
      effectiveFrom: '2026-07-16', workWeekdays: [1, 2, 3, 4, 5, 6],
      workStartTime: '08:00', workEndTime: '17:00', breakMinutes: 60,
      standardDayMinutes: 480, version: 1,
    }],
    ['getBridgeSummary', { month: MONTH }],
  ]
  for (const [method, input] of invocations) {
    for (const rpcResult of [null, {}, { data: responseFor(
      method === 'getAlertCount' ? 'get_labor_alert_count_secure' :
        method === 'getSettings' ? 'get_attendance_accounting_settings_secure' :
          'get_attendance_accounting_bridge_secure',
    ) }]) {
      const service = createLaborAccountingService({ rpc: async () => rpcResult }, { configured: true })
      await assert.rejects(
        () => input === undefined ? service[method]() : service[method](input),
        (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
      )
    }
    const valid = responseFor(
      method === 'getAlertCount' ? 'get_labor_alert_count_secure' :
        method === 'listDailyDashboard' ? 'list_daily_attendance_dashboard_secure' :
          ['getResolutionDetail', 'saveResolutionDraft', 'confirmResolution'].includes(method)
            ? 'get_attendance_resolution_detail_secure'
            : method === 'listMonthlyPayroll' ? 'list_monthly_payroll_secure'
              : method === 'listEmployeeMonthCalendar' ? 'list_employee_attendance_calendar_secure'
              : ['saveMonthlyPayrollDraft', 'confirmMonthlyPayroll', 'reopenMonthlyPayroll'].includes(method)
                ? 'save_monthly_payroll_draft_secure'
                : method === 'listProjectLaborCosts' ? 'list_project_labor_costs_secure'
                  : method === 'exportProjectLaborCosts' ? 'export_project_labor_costs_secure'
                    : ['getSettings', 'updateSettings'].includes(method)
                      ? 'get_attendance_accounting_settings_secure'
                      : 'get_attendance_accounting_bridge_secure',
      { p_status: 'all' },
    )
    const withExtra = Array.isArray(valid) ? Object.assign([...valid], { unexpected: true }) : { ...valid, unexpected: true }
    const extraService = createLaborAccountingService({
      rpc: async () => ({ data: withExtra, error: null }),
    }, { configured: true })
    await assert.rejects(
      () => input === undefined ? extraService[method]() : extraService[method](input),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
    )
  }
})

test('exact input objects reject missing, extra, inherited, accessor, and symbol keys before RPC', async () => {
  let callCount = 0
  const service = createLaborAccountingService({
    rpc: async () => { callCount += 1; return { data: dailyDashboard(), error: null } },
  }, { configured: true })
  const inherited = Object.create({ extra: true })
  inherited.workDate = WORK_DATE
  const accessor = {}
  Object.defineProperty(accessor, 'workDate', { enumerable: true, get: () => WORK_DATE })
  const symbol = { workDate: WORK_DATE }
  symbol[Symbol('extra')] = true
  for (const input of [
    {},
    { workDate: WORK_DATE, extra: true },
    inherited,
    accessor,
    symbol,
  ]) {
    await assert.rejects(
      () => service.listDailyDashboard(input),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
    )
  }
  await assert.rejects(
    () => service.listDailyDashboard({ work_date: WORK_DATE }),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
  )
  await assert.rejects(
    () => service.getAlertCount({}),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
  )
  assert.equal(callCount, 0)
})

test('dates, months, UUIDs, enums, units, yen, versions, and bounded text reject unsafe inputs', async () => {
  let callCount = 0
  const service = createLaborAccountingService({
    rpc: async () => { callCount += 1; return { data: resolutionDetail(), error: null } },
  }, { configured: true })
  const invalidCalls = [
    () => service.listDailyDashboard({ workDate: '2026-02-30' }),
    () => service.listDailyDashboard({ workDate: '1899-12-31' }),
    () => service.listDailyDashboard({ workDate: '2101-01-01' }),
    () => service.getResolutionDetail({ employeeProfileId: 'not-a-uuid', workDate: WORK_DATE }),
    () => service.listEmployeeMonthCalendar({ employeeProfileId: 'not-a-uuid', month: MONTH }),
    () => service.listEmployeeMonthCalendar({ employeeProfileId: EMPLOYEE_ID, month: '2026-13' }),
    () => service.listMonthlyPayroll({ month: '2026-13', department: '', employeeProfileId: null, onlyPending: false }),
    () => service.listMonthlyPayroll({ month: '1899-12', department: '', employeeProfileId: null, onlyPending: false }),
    () => service.listMonthlyPayroll({ month: MONTH, department: 'x'.repeat(201), employeeProfileId: null, onlyPending: false }),
    () => service.listMonthlyPayroll({ month: MONTH, department: '', employeeProfileId: null, onlyPending: 1 }),
    () => service.listProjectLaborCosts({ month: MONTH, projectId: null, employeeProfileId: null, status: 'draft' }),
    () => service.reopenMonthlyPayroll({ payrollId: PAYROLL_ID, reason: '\t\n\r\f\v ', version: 1 }),
    () => service.reopenMonthlyPayroll({ payrollId: PAYROLL_ID, reason: 'x'.repeat(2001), version: 1 }),
  ]
  for (const field of ['finalProjectCost', 'version']) {
    for (const unsafe of [-1, -0, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      invalidCalls.push(() => {
        const payload = resolutionPayload()
        payload[field] = unsafe
        return service.saveResolutionDraft(payload)
      })
    }
  }
  for (const [resolutionType, attendanceUnits] of [
    ['unknown', 1], ['full_day', 0.5], ['half_day', 1], ['rest', 1], ['absence', -0],
    ['full_day', Number.NaN], ['full_day', Number.POSITIVE_INFINITY],
  ]) {
    invalidCalls.push(() => service.saveResolutionDraft({
      ...resolutionPayload(), resolutionType, attendanceUnits,
    }))
  }
  for (const call of invalidCalls) {
    await assert.rejects(call, (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT')
  }
  assert.equal(callCount, 0)
})

test('allocation arrays are dense, exact, unique after POSIX trimming, and safely bounded', async () => {
  let callCount = 0
  const service = createLaborAccountingService({
    rpc: async () => { callCount += 1; return { data: resolutionDetail(), error: null } },
  }, { configured: true })
  const sparse = new Array(1)
  const extraArray = [{ projectId: 'P001', amount: 12000, allocationNote: '' }]
  extraArray.extra = true
  const invalidAllocations = [
    sparse,
    extraArray,
    [{ projectId: 'P001', amount: 12000 }],
    [{ projectId: 'P001', amount: 12000, allocationNote: '', extra: true }],
    [
      { projectId: 'P001', amount: 6000, allocationNote: '' },
      { projectId: '\tP001\n', amount: 6000, allocationNote: '' },
    ],
    [{ projectId: '__proto__', amount: 12000, allocationNote: '' }],
    [{ projectId: ' ', amount: 12000, allocationNote: '' }],
    [{ projectId: 'P001', amount: -0, allocationNote: '' }],
    [{ projectId: 'P001', amount: 1.5, allocationNote: '' }],
    [{ projectId: 'P001', amount: 12000, allocationNote: 'x'.repeat(2001) }],
    Array.from({ length: 101 }, (_, index) => ({
      projectId: `P${index}`, amount: 0, allocationNote: '',
    })),
  ]
  for (const allocations of invalidAllocations) {
    const payload = resolutionPayload()
    payload.allocations = allocations
    await assert.rejects(
      () => service.saveResolutionDraft(payload),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
    )
  }
  const overflow = resolutionPayload()
  overflow.finalProjectCost = Number.MAX_SAFE_INTEGER
  overflow.allocations = [
    { projectId: 'P001', amount: Number.MAX_SAFE_INTEGER, allocationNote: '' },
    { projectId: 'P002', amount: 1, allocationNote: '' },
  ]
  await assert.rejects(
    () => service.saveResolutionDraft(overflow),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
  )
  const unbalanced = resolutionPayload()
  unbalanced.allocations[0].amount = 11999
  await service.saveResolutionDraft(unbalanced)
  await assert.rejects(
    () => service.confirmResolution(unbalanced),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
  )
  assert.equal(callCount, 1)
})

test('resolution review input trims notes, sends exact RPC arguments, and rejects incomplete review pairs', async () => {
  const { service, calls } = serviceWithResponder()
  await service.confirmResolution({
    ...resolutionPayload(),
    locationReviewStatus: 'recorded_abnormal',
    locationReviewNote: '\t 已向现场负责人确认 \n',
  })
  assert.equal(calls[0][1].p_location_review_status, 'recorded_abnormal')
  assert.equal(calls[0][1].p_location_review_note, '已向现场负责人确认')

  let callCount = 0
  const rejecting = createLaborAccountingService({
    rpc: async () => { callCount += 1; return { data: resolutionDetail(), error: null } },
  }, { configured: true })
  for (const review of [
    { locationReviewStatus: 'unknown', locationReviewNote: '说明' },
    { locationReviewStatus: 'confirmed_valid', locationReviewNote: '' },
    { locationReviewStatus: 'recorded_abnormal', locationReviewNote: ' \t\n' },
    { locationReviewStatus: '', locationReviewNote: '无结论备注' },
    { locationReviewStatus: '', locationReviewNote: 'x'.repeat(2001) },
  ]) {
    await assert.rejects(
      () => rejecting.saveResolutionDraft({ ...resolutionPayload(), ...review }),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
    )
  }
  assert.equal(callCount, 0)
})

test('settings input enforces unique weekdays, minute times, schedule arithmetic, and safe integers', async () => {
  let callCount = 0
  const service = createLaborAccountingService({
    rpc: async () => { callCount += 1; return { data: accountingSettings({ version: 2 }), error: null } },
  }, { configured: true })
  const base = {
    effectiveFrom: '2026-07-16', workWeekdays: [1, 2, 3, 4, 5, 6],
    workStartTime: '08:00', workEndTime: '17:00', breakMinutes: 60,
    standardDayMinutes: 480, version: 1,
  }
  const invalid = [
    { ...base, workWeekdays: [] },
    { ...base, workWeekdays: [1, 1] },
    { ...base, workWeekdays: [0, 1] },
    { ...base, workStartTime: '8:00' },
    { ...base, workEndTime: '17:00:00' },
    { ...base, workStartTime: '17:00', workEndTime: '08:00' },
    { ...base, breakMinutes: -0 },
    { ...base, breakMinutes: 540 },
    { ...base, standardDayMinutes: 0 },
    { ...base, standardDayMinutes: 481 },
    { ...base, version: Number.NaN },
  ]
  const sparseWeekdays = new Array(2)
  sparseWeekdays[0] = 1
  invalid.push({ ...base, workWeekdays: sparseWeekdays })
  for (const payload of invalid) {
    await assert.rejects(
      () => service.updateSettings(payload),
      (error) => error.code === 'LABOR_ACCOUNTING_INVALID_INPUT',
    )
  }
  assert.equal(callCount, 0)
})

test('only the approved hints produce specific safe errors and causes stay non-enumerable', async () => {
  const safeErrors = {
    ATTENDANCE_ACCOUNTING_VERSION_CONFLICT: '记录已被其他人更新，请刷新后重试',
    ATTENDANCE_ACCOUNTING_ALLOCATION_UNBALANCED: '项目分摊金额与确认人工成本不一致',
    ATTENDANCE_ACCOUNTING_SALARY_REQUIRED: '员工工资标准未设置，请先到人员管理补充',
    ATTENDANCE_ACCOUNTING_OPEN_SESSION: '员工仍在打卡中，暂不能确认当日核算',
    ATTENDANCE_ACCOUNTING_MONTH_INCOMPLETE: '本月仍有未处理考勤，暂不能确认工资',
    ATTENDANCE_ACCOUNTING_MONTH_LOCKED: '该月份工资已经确认，请先重新打开',
    ATTENDANCE_GENERAL_PROJECT_COST_FORBIDDEN: '非项目考勤不能计入项目人工成本',
  }
  for (const [hint, message] of Object.entries(safeErrors)) {
    const cause = { hint, message: 'private SQL relation employees_secret', details: 'password=secret' }
    const service = createLaborAccountingService({
      rpc: async () => ({ data: null, error: cause, status: 400 }),
    }, { configured: true })
    await assert.rejects(() => service.getAlertCount(), (error) => {
      assert.ok(error instanceof LaborAccountingServiceError)
      assert.equal(error.code, hint)
      assert.equal(error.userMessage, message)
      assert.equal(error.message, message)
      assert.strictEqual(error.cause, cause)
      assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false)
      assert.doesNotMatch(JSON.stringify(error), /private|secret|password|SQL/iu)
      return true
    })
  }

  for (const failure of [
    { hint: 'PRIVATE_DATABASE_HINT', message: 'select * from secret_payroll', details: 'token=abc' },
    Object.assign(Object.create({ hint: 'ATTENDANCE_ACCOUNTING_MONTH_LOCKED' }), { message: 'private' }),
  ]) {
    const service = createLaborAccountingService({
      rpc: async () => ({ data: null, error: failure }),
    }, { configured: true })
    await assert.rejects(() => service.getAlertCount(), (error) =>
      error.code === 'LABOR_ACCOUNTING_SERVICE_UNAVAILABLE' &&
      error.userMessage === '人工核算服务暂不可用，请稍后重试' &&
      !error.message.includes('private') && !error.message.includes('secret'))
  }

  const thrown = new Error('private database network detail')
  const thrownService = createLaborAccountingService({ rpc: async () => { throw thrown } }, { configured: true })
  await assert.rejects(() => thrownService.getAlertCount(), (error) =>
    error.code === 'LABOR_ACCOUNTING_SERVICE_UNAVAILABLE' && error.cause === thrown &&
    !error.message.includes('private'))
})

test('own response status and thrown JWT codes preserve auth expiry without private leakage', async () => {
  const assertAuthFailure = (error, cause) => {
    assert.ok(error instanceof LaborAccountingServiceError)
    assert.equal(error.code, 'AUTH_INVALID')
    assert.equal(error.userMessage, '登录状态无效，请重新登录')
    assert.equal(error.message, '登录状态无效，请重新登录')
    assert.equal(error.authInvalid, true)
    assert.strictEqual(error.cause, cause)
    assert.equal(Object.getOwnPropertyDescriptor(error, 'cause').enumerable, false)
    assert.doesNotMatch(error.message, /PRIVATE|secret|database|details/iu)
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|secret|database|details/iu)
    return true
  }

  const statusCause = {
    code: '42501', message: 'PRIVATE_DATABASE_MESSAGE', details: 'secret token',
  }
  const statusService = createLaborAccountingService({
    rpc: async () => ({ data: null, error: statusCause, status: 401, statusText: 'Unauthorized' }),
  }, { configured: true })
  await assert.rejects(() => statusService.getAlertCount(), (error) =>
    assertAuthFailure(error, statusCause))

  for (const code of ['PGRST301', 'JWT_EXPIRED']) {
    const cause = { code, message: 'PRIVATE_DATABASE_MESSAGE', details: 'secret token' }
    const service = createLaborAccountingService({
      rpc: async () => { throw cause },
    }, { configured: true })
    await assert.rejects(() => service.getAlertCount(), (error) =>
      assertAuthFailure(error, cause))
  }
})

test('inherited and accessor auth signals stay generic without executing unsafe properties', async () => {
  const assertGenericFailure = (error) => {
    assert.ok(error instanceof LaborAccountingServiceError)
    assert.equal(error.code, 'LABOR_ACCOUNTING_SERVICE_UNAVAILABLE')
    assert.notEqual(error.authInvalid, true)
    assert.doesNotMatch(error.message, /PRIVATE|secret/iu)
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE|secret/iu)
    return true
  }
  const genericCause = { message: 'PRIVATE_DATABASE_MESSAGE', details: 'secret token' }

  const inheritedStatusResponse = Object.assign(Object.create({ status: 401 }), {
    data: null, error: genericCause,
  })
  const inheritedStatusService = createLaborAccountingService({
    rpc: async () => inheritedStatusResponse,
  }, { configured: true })
  await assert.rejects(() => inheritedStatusService.getAlertCount(), assertGenericFailure)

  let statusReads = 0
  const accessorStatusResponse = { data: null, error: genericCause }
  Object.defineProperty(accessorStatusResponse, 'status', {
    enumerable: true,
    get() { statusReads += 1; throw new Error('PRIVATE_STATUS_GETTER') },
  })
  const accessorStatusService = createLaborAccountingService({
    rpc: async () => accessorStatusResponse,
  }, { configured: true })
  await assert.rejects(() => accessorStatusService.getAlertCount(), assertGenericFailure)
  assert.equal(statusReads, 0)

  let codeReads = 0
  const accessorCodeCause = { message: 'PRIVATE_DATABASE_MESSAGE', details: 'secret token' }
  Object.defineProperty(accessorCodeCause, 'code', {
    enumerable: true,
    get() { codeReads += 1; throw new Error('PRIVATE_CODE_GETTER') },
  })
  const accessorCodeService = createLaborAccountingService({
    rpc: async () => { throw accessorCodeCause },
  }, { configured: true })
  await assert.rejects(() => accessorCodeService.getAlertCount(), assertGenericFailure)
  assert.equal(codeReads, 0)

  const inheritedCodeCause = Object.assign(Object.create({ code: 'JWT_EXPIRED' }), genericCause)
  const inheritedCodeService = createLaborAccountingService({
    rpc: async () => { throw inheritedCodeCause },
  }, { configured: true })
  await assert.rejects(() => inheritedCodeService.getAlertCount(), assertGenericFailure)
})

test('throwing RPC property access becomes a safe request failure', async () => {
  const privateCause = new Error('PRIVATE_DATABASE_DETAIL')
  privateCause.code = 'JWT_EXPIRED'
  const client = {}
  Object.defineProperty(client, 'rpc', {
    enumerable: true,
    get() { throw privateCause },
  })
  const service = createLaborAccountingService(client, { configured: true })

  await assert.rejects(() => service.getAlertCount(), (error) => {
    assert.ok(error instanceof LaborAccountingServiceError)
    assert.equal(error.code, 'LABOR_ACCOUNTING_REQUEST_FAILED')
    assert.equal(error.userMessage, '人工核算请求失败，请稍后重试')
    assert.notEqual(error.authInvalid, true)
    assert.strictEqual(error.cause, privateCause)
    assert.doesNotMatch(error.message, /PRIVATE_DATABASE_DETAIL/u)
    assert.doesNotMatch(JSON.stringify(error), /PRIVATE_DATABASE_DETAIL/u)
    return true
  })
})

test('missing clients and malformed RPC implementations fail closed without fallback', async () => {
  for (const [client, options] of [
    [null, { configured: true }],
    [{}, { configured: true }],
    [{ rpc: null }, { configured: true }],
    [{ rpc: async () => ({ data: dailyDashboard(), error: null }) }, { configured: false }],
  ]) {
    const service = createLaborAccountingService(client, options)
    await assert.rejects(
      () => service.getAlertCount(),
      (error) => error.code === 'LABOR_ACCOUNTING_NOT_CONFIGURED',
    )
  }
  const undefinedData = createLaborAccountingService({
    rpc: async () => ({ data: undefined, error: null }),
  }, { configured: true })
  await assert.rejects(
    () => undefinedData.getAlertCount(),
    (error) => error.code === 'LABOR_ACCOUNTING_INVALID_RESPONSE',
  )
})

test('service source is RPC-only, has no browser cache or logging seam, and singleton is complete', () => {
  assert.doesNotMatch(source, /\.from\s*\(|localStorage|sessionStorage|indexedDB|console\.|baseRecordService/iu)
  assert.doesNotMatch(source, /error\?*\.message|error\?*\.details/iu)
  assert.ok(Object.isFrozen(laborAccountingService))
  assert.deepEqual(Object.keys(laborAccountingService).sort(), [
    'confirmMonthlyPayroll', 'confirmResolution', 'exportProjectLaborCosts',
    'getAlertCount', 'getBridgeSummary', 'getResolutionDetail', 'getSettings',
    'listDailyDashboard', 'listEmployeeMonthCalendar', 'listMonthlyPayroll',
    'listProjectLaborCosts',
    'reopenMonthlyPayroll', 'saveMonthlyPayrollDraft', 'saveResolutionDraft',
    'updateSettings',
  ])
})

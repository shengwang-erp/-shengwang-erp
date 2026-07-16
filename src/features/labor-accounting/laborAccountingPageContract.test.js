import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

const COMPONENT_FILES = Object.freeze({
  page: 'LaborAccountingPage.jsx',
  board: 'DailyAttendanceBoard.jsx',
  table: 'AttendanceStatusTable.jsx',
  queue: 'AccountingExceptionQueue.jsx',
  dialog: 'AttendanceResolutionDialog.jsx',
  monthly: 'MonthlyPayrollTab.jsx',
  project: 'ProjectLaborCostTab.jsx',
  settings: 'AttendanceAccountingSettings.jsx',
})

const sourceEntries = await Promise.all(Object.entries(COMPONENT_FILES).map(async ([key, name]) => [
  key,
  await readFile(new URL(`./${name}`, import.meta.url), 'utf8').catch(() => ''),
]))
const sources = Object.fromEntries(sourceEntries)
const css = await readFile(new URL('./laborAccounting.css', import.meta.url), 'utf8').catch(() => '')

async function loadModules() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    const entries = await Promise.all(Object.entries(COMPONENT_FILES).map(async ([key, name]) => [
      key,
      await server.ssrLoadModule(`/src/features/labor-accounting/${name}`),
    ]))
    return { error: null, modules: Object.fromEntries(entries) }
  } catch (error) {
    return { error, modules: {} }
  } finally {
    await server.close()
  }
}

const loaded = await loadModules()

function moduleFor(name) {
  assert.ifError(loaded.error)
  assert.ok(loaded.modules[name])
  return loaded.modules[name]
}

function render(Component, props) {
  return renderToStaticMarkup(createElement(Component, props))
}

const session = Object.freeze({
  sessionId: '71000000-0000-4000-8000-000000000001',
  projectId: 'PROJECT-001',
  projectName: '东京站现场',
  status: 'closed',
  openedAt: '2026-07-18T08:10:00+09:00',
  closedAt: '2026-07-18T16:50:00+09:00',
  clockInEvent: {
    eventId: '72000000-0000-4000-8000-000000000001',
    eventType: 'clock_in',
    serverRecordedAt: '2026-07-18T08:10:00+09:00',
    result: 'abnormal',
    abnormalReason: '定位距离现场 420 米',
  },
  clockOutEvent: {
    eventId: '72000000-0000-4000-8000-000000000002',
    eventType: 'clock_out',
    serverRecordedAt: '2026-07-18T16:50:00+09:00',
    result: 'normal',
    abnormalReason: null,
  },
})

const employee = Object.freeze({
  employeeProfileId: '52000000-0000-4000-8000-000000000001',
  employeeNumber: 'SW-001',
  name: '山田太郎',
  department: '工程部',
  position: '大工',
  scheduleRequired: true,
  dayStatus: 'completed',
  issueCodes: ['abnormal_location', 'late', 'early'],
  firstClockInAt: '2026-07-18T08:10:00+09:00',
  lastClockOutAt: '2026-07-18T16:50:00+09:00',
  hasOpenSession: false,
  hasAbnormalLocation: true,
  workedMinutesReference: 460,
  sessions: [session],
  resolution: null,
  salary: {
    salaryType: '日薪',
    baseSalary: null,
    dailySalary: 12000,
    hourlyWage: null,
    salaryRemark: null,
  },
})

const missingEmployee = Object.freeze({
  ...employee,
  employeeProfileId: '52000000-0000-4000-8000-000000000002',
  employeeNumber: 'SW-002',
  name: '佐藤花子',
  department: '总务部',
  dayStatus: 'missing_clock_in',
  issueCodes: ['missing_clock_in'],
  firstClockInAt: null,
  lastClockOutAt: null,
  hasAbnormalLocation: false,
  workedMinutesReference: null,
  sessions: [],
})

const dashboard = Object.freeze({
  workDate: '2026-07-18',
  serverNowTokyo: '2026-07-18T17:06:00+09:00',
  settings: {
    configured: true,
    effectiveFrom: '2026-07-16',
    workWeekdays: [1, 2, 3, 4, 5, 6],
    workStartTime: '08:00',
    workEndTime: '17:00',
    breakMinutes: 60,
    standardDayMinutes: 480,
  },
  permissions: {
    canResolve: true,
    canViewSalary: true,
    canUpdateSalary: true,
    canViewProjectCosts: true,
    canUpdateProjectCosts: true,
    canUpdateSettings: true,
  },
  summary: {
    totalEmployees: 2,
    requiredEmployees: 2,
    normalCompleted: 0,
    working: 0,
    excused: 0,
    alertCount: 2,
    abnormalLocation: 1,
    missingClockIn: 1,
    missingClockOut: 0,
    late: 1,
    early: 1,
    overtimePending: 0,
  },
  filters: {
    departments: ['工程部', '总务部'],
    projects: [{ projectId: 'PROJECT-001', projectName: '东京站现场' }],
    dayStatuses: ['completed', 'missing_clock_in'],
    issueCodes: [
      'abnormal_location', 'missing_clock_in', 'missing_clock_out',
      'late', 'early', 'overtime_pending',
    ],
  },
  employees: [employee, missingEmployee],
})

const filters = Object.freeze({
  department: '',
  projectId: '',
  dayStatus: '',
  employeeSearch: '',
  onlyPending: false,
})

const detail = Object.freeze({
  employee: {
    employeeProfileId: employee.employeeProfileId,
    employeeNumber: employee.employeeNumber,
    employeeName: employee.name,
    department: employee.department,
    position: employee.position,
  },
  workDate: dashboard.workDate,
  scheduleRequired: true,
  hasMoneyScope: false,
  facts: {
    dayStatus: employee.dayStatus,
    issueCodes: employee.issueCodes,
    firstClockInAt: employee.firstClockInAt,
    lastClockOutAt: employee.lastClockOutAt,
    hasOpenSession: false,
    hasAbnormalLocation: true,
    workedMinutesReference: employee.workedMinutesReference,
    sessions: [session],
  },
  permissions: {
    canResolve: true,
    canViewSalary: true,
    canViewProjectCosts: true,
    canUpdateProjectCosts: true,
  },
  salary: {
    salaryType: '日薪',
    baseSalary: null,
    dailySalary: 12000,
    hourlyWage: null,
    suggestedProjectCost: 12000,
  },
  resolution: null,
  allocations: [],
})

const draft = Object.freeze({
  resolutionType: 'full_day',
  attendanceUnits: 1,
  finalProjectCost: 12000,
  allocations: [{ projectId: 'PROJECT-001', amount: 12000, allocationNote: '' }],
  resolutionNote: '',
  version: 0,
})

const monthlyEmployee = Object.freeze({
  employeeProfileId: employee.employeeProfileId,
  employeeNumber: employee.employeeNumber,
  employeeName: employee.name,
  department: employee.department,
  fullDays: 20,
  halfDays: 1,
  excusedDays: 1,
  absenceDays: 0,
  pendingDays: 0,
  issueCounts: { late: 1, early: 1, abnormalLocation: 1, overtimePending: 0 },
  status: 'ready',
  payrollId: null,
  version: 0,
  salaryType: '日薪',
  baseSalarySnapshot: 12000,
  basePay: 246000,
  overtimePay: 1000,
  bonus: 2000,
  deduction: 500,
  netSalary: 248500,
  projectAllocatedAmount: 246000,
  projectUnallocatedAmount: 0,
  confirmationNote: '七月工资',
  confirmedAt: null,
})

const legacyMonthlyEmployee = Object.freeze({
  ...monthlyEmployee,
  source: 'legacy',
  employeeProfileId: null,
  employeeNumber: 'LEG-001',
  employeeName: '历史员工',
  department: '',
  fullDays: 0,
  halfDays: 0,
  excusedDays: 0,
  status: 'confirmed',
  payrollId: null,
  version: 0,
})

const monthlyReport = Object.freeze({
  salaryMonth: '2026-07',
  permissions: { canViewSalary: true, canUpdateSalary: true },
  summary: {
    employeeCount: 2,
    scheduledAttendanceUnits: 42,
    confirmedAttendanceUnits: 41,
    pendingCount: 0,
    salaryPreviewTotal: 497000,
    projectAllocatedTotal: 492000,
    projectUnallocatedTotal: 0,
  },
  employees: [monthlyEmployee, legacyMonthlyEmployee],
  reconciliation: { postActivationLegacyRows: 1, globalMalformedLegacyRows: 0 },
})

const redactedMonthlyReport = Object.freeze({
  salaryMonth: '2026-07',
  permissions: { canViewSalary: false, canUpdateSalary: false },
  summary: {
    employeeCount: 1,
    scheduledAttendanceUnits: 21,
    confirmedAttendanceUnits: 20.5,
    pendingCount: 0,
  },
  employees: [Object.fromEntries(Object.entries(monthlyEmployee).filter(([key]) => ![
    'salaryType', 'baseSalarySnapshot', 'basePay', 'overtimePay', 'bonus',
    'deduction', 'netSalary', 'projectAllocatedAmount', 'projectUnallocatedAmount',
    'confirmationNote', 'confirmedAt',
  ].includes(key)))],
  reconciliation: { postActivationLegacyRows: 0, globalMalformedLegacyRows: 0 },
})

const employeeMonthCalendar = Object.freeze({
  salaryMonth: '2026-07',
  employee: {
    employeeProfileId: employee.employeeProfileId,
    employeeNumber: employee.employeeNumber,
    employeeName: employee.name,
    department: employee.department,
    position: employee.position,
  },
  days: [
    {
      workDate: '2026-07-01',
      eligible: false,
      scheduleRequired: false,
      dayStatus: 'not_eligible',
      issueCodes: [],
      accountingStatus: null,
    },
    {
      workDate: '2026-07-02',
      eligible: true,
      scheduleRequired: true,
      dayStatus: 'completed',
      issueCodes: ['abnormal_location', 'late'],
      accountingStatus: 'draft',
    },
  ],
})

const projectReport = Object.freeze({
  salaryMonth: '2026-07',
  permissions: { canViewSalary: true, canViewEmployeeComposition: true },
  summary: {
    monthlyConfirmedCost: 12000,
    lifetimeConfirmedCost: 74000,
    confirmedAttendanceUnits: 1,
    pendingAllocationCount: 1,
    pendingAllocationAmount: 4000,
  },
  trend: ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07']
    .map((salaryMonth, index) => ({ salaryMonth, amount: index * 2400 })),
  employeeComposition: [{
    employeeProfileId: employee.employeeProfileId,
    employeeNumber: employee.employeeNumber,
    employeeName: employee.name,
    attendanceUnits: 1,
    amount: 12000,
  }],
  dailyDetails: [{
    source: 'attendance',
    sourceKey: '63000000-0000-4000-8000-000000000001',
    workDate: '2026-07-18',
    projectId: 'PROJECT-001',
    projectName: '东京站现场',
    employeeProfileId: employee.employeeProfileId,
    employeeNumber: employee.employeeNumber,
    employeeName: employee.name,
    attendanceUnits: 1,
    amount: 12000,
    accountingStatus: 'confirmed',
  }],
  projectComparison: [{
    projectId: 'PROJECT-001',
    projectName: '东京站现场',
    monthlyConfirmedCost: 12000,
    lifetimeConfirmedCost: 74000,
  }],
  reconciliation: { postActivationLegacyRows: 1, globalMalformedLegacyRows: 0 },
})

const redactedProjectReport = Object.freeze({
  ...projectReport,
  permissions: { canViewSalary: false, canViewEmployeeComposition: false },
  employeeComposition: [],
  dailyDetails: [],
})

const accountingSettings = Object.freeze({
  configured: false,
  effectiveFrom: null,
  workWeekdays: [1, 2, 3, 4, 5, 6],
  workStartTime: '08:00',
  workEndTime: '17:00',
  breakMinutes: 60,
  standardDayMinutes: 480,
  version: 0,
})

test('all daily labor-accounting JSX modules compile through Vite SSR', () => {
  assert.ifError(loaded.error)
  for (const name of Object.keys(COMPONENT_FILES)) assert.ok(loaded.modules[name])
})

test('daily board renders approved all-employee metrics, filters, and persistent exception queue', () => {
  const { default: DailyAttendanceBoard } = moduleFor('board')
  const markup = render(DailyAttendanceBoard, {
    dashboard,
    filters,
    onFiltersChange() {},
    onDateChange() {},
    onOpenResolution() {},
  })
  assert.match(markup, /今日应出勤/u)
  assert.match(markup, /异常待处理/u)
  assert.match(markup, /所有在职员工/u)
  assert.match(markup, /未打卡/u)
  assert.match(markup, /只看待处理/u)
  assert.match(markup, /山田太郎/u)
  assert.match(markup, /佐藤花子/u)
  assert.match(markup, /定位异常/u)
})

test('resolution dialog keeps immutable facts separate from whole and half-day accounting', () => {
  const { default: AttendanceResolutionDialog } = moduleFor('dialog')
  const markup = render(AttendanceResolutionDialog, {
    detail,
    draft,
    saving: false,
    error: '',
    onChange() {},
    onSaveDraft() {},
    onConfirm() {},
    onClose() {},
  })
  assert.match(markup, /role="dialog"/u)
  assert.match(markup, /aria-modal="true"/u)
  assert.match(markup, /原始打卡事实/u)
  assert.match(markup, /整天/u)
  assert.match(markup, /半天/u)
  assert.match(markup, /项目分摊金额/u)
  assert.match(markup, /定位距离现场 420 米/u)
  assert.doesNotMatch(markup, /修改打卡时间/u)
})

test('resolution helpers derive projects and corrected draft defaults from facts and salary DTOs', () => {
  const {
    buildInitialResolutionDraft,
    deriveFactProjects,
    resolutionConfirmBlockers,
  } = moduleFor('dialog')
  assert.deepEqual(deriveFactProjects(detail), [
    { projectId: 'PROJECT-001', projectName: '东京站现场' },
  ])
  assert.deepEqual(buildInitialResolutionDraft(detail), draft)
  assert.deepEqual(resolutionConfirmBlockers(detail, draft), [])

  const multiple = {
    ...detail,
    facts: {
      ...detail.facts,
      sessions: [session, { ...session, projectId: 'PROJECT-002', projectName: '新宿改修' }],
    },
  }
  assert.deepEqual(buildInitialResolutionDraft(multiple).allocations, [
    { projectId: 'PROJECT-001', amount: 0, allocationNote: '' },
    { projectId: 'PROJECT-002', amount: 0, allocationNote: '' },
  ])

  const confirmed = {
    ...detail,
    hasMoneyScope: true,
    salary: { ...detail.salary, suggestedProjectCost: 12000 },
    resolution: {
      resolutionType: 'full_day',
      attendanceUnits: 1,
      accountingStatus: 'confirmed',
      finalProjectCost: 13500,
      resolutionNote: '现场补贴计入项目成本',
      version: 2,
    },
    allocations: [{
      allocationId: '63000000-0000-4000-8000-000000000001',
      projectId: 'PROJECT-001',
      projectName: '东京站现场',
      amount: 13500,
      allocationNote: '',
    }],
  }
  assert.equal(buildInitialResolutionDraft(confirmed).finalProjectCost, 13500)
})

test('open sessions, salary gaps, and imbalance block confirm but do not disable draft saving', () => {
  const { default: AttendanceResolutionDialog, resolutionConfirmBlockers } = moduleFor('dialog')
  const openDetail = {
    ...detail,
    facts: { ...detail.facts, hasOpenSession: true },
    salary: {
      salaryType: '未设置',
      baseSalary: null,
      dailySalary: null,
      hourlyWage: null,
      suggestedProjectCost: 0,
    },
  }
  const unbalancedDraft = {
    ...draft,
    finalProjectCost: 12000,
    allocations: [{ projectId: 'PROJECT-001', amount: 0, allocationNote: '' }],
  }
  const blockers = resolutionConfirmBlockers(openDetail, unbalancedDraft)
  assert.ok(blockers.some((reason) => reason.includes('仍在打卡')))
  assert.ok(blockers.some((reason) => reason.includes('工资标准未设置')))
  assert.ok(blockers.some((reason) => reason.includes('分摊金额合计')))

  const markup = render(AttendanceResolutionDialog, {
    detail: openDetail,
    draft: unbalancedDraft,
    saving: false,
    error: '',
    onChange() {},
    onSaveDraft() {},
    onConfirm() {},
    onClose() {},
  })
  assert.match(markup, /class="labor-save-draft"(?![^>]*disabled)/u)
  assert.match(markup, /class="labor-confirm-resolution" disabled=""/u)
})

test('zero-unit zero-cost excused conclusions can confirm without salary or money permissions', () => {
  const { resolutionConfirmBlockers } = moduleFor('dialog')
  const nonMoneyDetail = {
    ...detail,
    permissions: {
      canResolve: true,
      canViewSalary: false,
      canViewProjectCosts: false,
      canUpdateProjectCosts: false,
    },
    salary: null,
  }
  for (const resolutionType of ['rest', 'leave', 'comp_time', 'absence']) {
    assert.deepEqual(resolutionConfirmBlockers(nonMoneyDetail, {
      resolutionType,
      attendanceUnits: 0,
      finalProjectCost: 0,
      allocations: [],
      resolutionNote: '',
      version: 0,
    }), [])
  }

  const hiddenSalaryBlockers = resolutionConfirmBlockers(nonMoneyDetail, draft)
  assert.ok(hiddenSalaryBlockers.some((reason) => reason.includes('按权限隐藏')))
  assert.ok(hiddenSalaryBlockers.every((reason) => !reason.includes('工资标准未设置')))
})

test('retained dashboard is visibly marked stale after a failed refresh and clears on success', () => {
  const { DashboardLoadNotice, dailyDashboardPresentationState } = moduleFor('page')
  assert.equal(typeof DashboardLoadNotice, 'function')
  assert.equal(typeof dailyDashboardPresentationState, 'function')

  const failedState = { status: 'error', error: '服务器刷新失败' }
  assert.deepEqual(dailyDashboardPresentationState(failedState, dashboard), {
    showDashboard: true,
    stale: true,
    error: '服务器刷新失败',
  })
  const staleMarkup = render(DashboardLoadNotice, {
    loadState: failedState,
    dashboard,
    onRetry() {},
  })
  assert.match(staleMarkup, /当前数据可能已过期/u)
  assert.match(staleMarkup, /服务器刷新失败/u)
  assert.match(staleMarkup, /重新加载/u)

  assert.deepEqual(dailyDashboardPresentationState(
    { status: 'success', error: '' }, dashboard,
  ), { showDashboard: true, stale: false, error: '' })
  assert.equal(render(DashboardLoadNotice, {
    loadState: { status: 'success', error: '' },
    dashboard,
    onRetry() {},
  }), '')
})

test('revoked money permissions lock an existing monetary resolution but not a new zero-cost day', () => {
  const {
    default: AttendanceResolutionDialog,
    detailHasMoneyScope,
    resolutionConfirmBlockers,
  } = moduleFor('dialog')
  assert.equal(typeof detailHasMoneyScope, 'function')

  const permissionsRevoked = {
    ...detail,
    hasMoneyScope: true,
    permissions: {
      canResolve: true,
      canViewSalary: false,
      canViewProjectCosts: true,
      canUpdateProjectCosts: false,
    },
    salary: null,
    resolution: {
      resolutionId: '62000000-0000-4000-8000-000000000001',
      resolutionType: 'rest',
      attendanceUnits: 0,
      accountingStatus: 'confirmed',
      scheduleRequired: true,
      resolutionNote: '',
      confirmedAt: '2026-07-18T17:05:00+09:00',
      version: 1,
    },
    allocations: [],
  }
  const zeroCostRest = {
    resolutionType: 'rest',
    attendanceUnits: 0,
    finalProjectCost: 0,
    allocations: [],
    resolutionNote: '',
    version: 1,
  }
  assert.equal(detailHasMoneyScope(permissionsRevoked), true)
  assert.ok(resolutionConfirmBlockers(permissionsRevoked, zeroCostRest).some(
    (reason) => reason.includes('已有项目人工成本') && reason.includes('权限'),
  ))
  const lockedMarkup = render(AttendanceResolutionDialog, {
    detail: permissionsRevoked,
    draft: zeroCostRest,
    saving: false,
    error: '',
    onChange() {},
    onSaveDraft() {},
    onConfirm() {},
    onClose() {},
  })
  assert.match(lockedMarkup, /class="labor-save-draft" disabled=""/u)
  assert.match(lockedMarkup, /class="labor-confirm-resolution" disabled=""/u)

  const positiveUnitsButNoExistingMoney = {
    ...permissionsRevoked,
    hasMoneyScope: false,
    resolution: {
      ...permissionsRevoked.resolution,
      resolutionType: 'full_day',
      attendanceUnits: 1,
    },
  }
  assert.equal(detailHasMoneyScope(positiveUnitsButNoExistingMoney), false)
  assert.deepEqual(resolutionConfirmBlockers(positiveUnitsButNoExistingMoney, zeroCostRest), [])
})

test('labor viewers can always open immutable facts from table and exception queue', () => {
  const { default: AttendanceStatusTable, resolutionActionMeta } = moduleFor('table')
  const { default: AccountingExceptionQueue } = moduleFor('queue')
  const lockedEmployee = {
    ...employee,
    resolution: {
      resolutionId: '62000000-0000-4000-8000-000000000001',
      resolutionType: 'full_day',
      attendanceUnits: 1,
      accountingStatus: 'month_locked',
      scheduleRequired: true,
      resolutionNote: '',
      confirmedAt: '2026-07-18T17:05:00+09:00',
      version: 2,
    },
  }
  const viewOnlyDashboard = {
    ...dashboard,
    permissions: { ...dashboard.permissions, canResolve: false },
  }
  const tableMarkup = render(AttendanceStatusTable, {
    employees: [lockedEmployee],
    dashboard: viewOnlyDashboard,
    onOpenResolution() {},
  })
  assert.match(tableMarkup, />查看事实</u)
  assert.match(tableMarkup, /aria-label="查看事实 山田太郎"/u)
  assert.doesNotMatch(tableMarkup, /aria-label="查看事实 山田太郎"[^>]*disabled/u)

  const queueMarkup = render(AccountingExceptionQueue, {
    employees: [lockedEmployee],
    dashboard: viewOnlyDashboard,
    onOpenResolution() {},
  })
  assert.match(queueMarkup, /查看事实/u)
  assert.doesNotMatch(queueMarkup, /aria-label="查看 山田太郎[^>]*disabled/u)

  for (const unavailableEmployee of [
    { ...lockedEmployee, dayStatus: 'unconfigured', resolution: null },
    { ...lockedEmployee, dayStatus: 'before_activation', resolution: null },
  ]) {
    const unavailableDashboard = unavailableEmployee.dayStatus === 'unconfigured'
      ? { ...dashboard, settings: { ...dashboard.settings, configured: false } }
      : dashboard
    const action = resolutionActionMeta(unavailableEmployee, unavailableDashboard)
    assert.equal(action.openable, false)
    const unavailableMarkup = render(AttendanceStatusTable, {
      employees: [unavailableEmployee],
      dashboard: unavailableDashboard,
      onOpenResolution() {},
    })
    assert.match(
      unavailableMarkup,
      /<button[^>]*disabled=""[^>]*aria-label="尚不可查看 山田太郎"/u,
    )
  }
})

test('page request boundary forwards the exact auth-invalid error from an injected service', async () => {
  const { executeLaborPageRequest, settleLaborPageRequest } = moduleFor('page')
  assert.equal(typeof executeLaborPageRequest, 'function')
  assert.equal(typeof settleLaborPageRequest, 'function')
  const authError = Object.assign(new Error('expired'), { authInvalid: true })
  let forwarded = null
  const result = await executeLaborPageRequest({
    request: () => Promise.reject(authError),
    onAuthInvalid(error) { forwarded = error },
  })
  assert.deepEqual(result, { ok: false, error: authError })
  assert.equal(forwarded, null)
  assert.deepEqual(settleLaborPageRequest({
    result,
    current: true,
    onAuthInvalid(error) { forwarded = error },
  }), { status: 'error', error: authError })
  assert.equal(forwarded, authError)

  forwarded = null
  assert.deepEqual(settleLaborPageRequest({
    result,
    current: false,
    onAuthInvalid(error) { forwarded = error },
  }), { status: 'stale' })
  assert.equal(forwarded, null)
})

test('resolution and detail-loading modals move, trap, close, and restore focus safely', () => {
  const {
    focusLaborModal,
    handleLaborModalKeyDown,
  } = moduleFor('dialog')
  const { DetailLoadingDialog } = moduleFor('page')
  assert.equal(typeof focusLaborModal, 'function')
  assert.equal(typeof handleLaborModalKeyDown, 'function')
  assert.equal(typeof DetailLoadingDialog, 'function')

  let focused = ''
  const first = {
    disabled: false,
    focus() { focused = 'first' },
    getAttribute() { return null },
    matches() { return false },
  }
  const last = {
    disabled: false,
    focus() { focused = 'last' },
    getAttribute() { return null },
    matches() { return false },
  }
  const previous = {
    isConnected: true,
    focus() { focused = 'previous' },
  }
  const dialogNode = {
    focus() { focused = 'dialog' },
    querySelector(selector) {
      return selector === '[data-dialog-initial-focus]' ? first : null
    },
    querySelectorAll() { return [first, last] },
    contains(node) { return node === first || node === last },
  }
  const restore = focusLaborModal(dialogNode, previous)
  assert.equal(focused, 'first')
  restore()
  assert.equal(focused, 'previous')

  let prevented = 0
  let closed = 0
  handleLaborModalKeyDown({
    event: { key: 'Tab', shiftKey: false, preventDefault() { prevented += 1 } },
    dialog: dialogNode,
    activeElement: last,
    saving: false,
    onClose() { closed += 1 },
  })
  assert.equal(focused, 'first')
  assert.equal(prevented, 1)
  handleLaborModalKeyDown({
    event: { key: 'Tab', shiftKey: true, preventDefault() { prevented += 1 } },
    dialog: dialogNode,
    activeElement: first,
    saving: false,
    onClose() { closed += 1 },
  })
  assert.equal(focused, 'last')
  assert.equal(prevented, 2)
  handleLaborModalKeyDown({
    event: { key: 'Escape', preventDefault() { prevented += 1 } },
    dialog: dialogNode,
    activeElement: first,
    saving: false,
    onClose() { closed += 1 },
  })
  assert.equal(closed, 1)
  handleLaborModalKeyDown({
    event: { key: 'Escape', preventDefault() { prevented += 1 } },
    dialog: dialogNode,
    activeElement: first,
    saving: true,
    onClose() { closed += 1 },
  })
  assert.equal(closed, 1)

  const loadingMarkup = render(DetailLoadingDialog, {
    selectedEmployee: {
      employeeProfileId: employee.employeeProfileId,
      employeeName: employee.name,
      workDate: dashboard.workDate,
    },
    detailLoadState: { status: 'loading', error: '' },
    onClose() {},
  })
  assert.match(loadingMarkup, /aria-modal="true"/u)
  assert.match(loadingMarkup, /取消查看/u)
  assert.match(
    sources.page,
    /const closeResolution[\s\S]{0,220}detailGenerationRef\.current \+= 1/u,
  )
  assert.match(
    sources.page,
    /current: mountedRef\.current && generation === detailGenerationRef\.current/u,
  )
})

test('daily filters retain all active employees and issue rows without recomputing server summary', () => {
  const { filterDailyEmployees } = moduleFor('board')
  assert.equal(filterDailyEmployees(dashboard.employees, filters).length, 2)
  assert.deepEqual(
    filterDailyEmployees(dashboard.employees, { ...filters, onlyPending: true }).map((row) => row.name),
    ['山田太郎', '佐藤花子'],
  )
  assert.deepEqual(
    filterDailyEmployees(dashboard.employees, { ...filters, employeeSearch: 'SW-002' })
      .map((row) => row.name),
    ['佐藤花子'],
  )
})

test('monthly payroll, project costs, and settings render the approved accounting structure', () => {
  const { default: MonthlyPayrollTab } = moduleFor('monthly')
  const { default: ProjectLaborCostTab } = moduleFor('project')
  const { default: AttendanceAccountingSettings } = moduleFor('settings')
  const monthlyMarkup = render(MonthlyPayrollTab, {
    service: {},
    month: '2026-07',
    initialReport: monthlyReport,
    onMonthChange() {},
  })
  assert.match(monthlyMarkup, /月度工资/u)
  assert.match(monthlyMarkup, /整天/u)
  assert.match(monthlyMarkup, /半天/u)
  assert.match(monthlyMarkup, /实发工资/u)
  assert.match(monthlyMarkup, /历史人工记录/u)
  assert.match(monthlyMarkup, /历史数据核对/u)
  assert.match(monthlyMarkup, /labor-payroll-mobile-cards/u)
  const monthlySummaryMarkup = monthlyMarkup.match(
    /<section class="labor-report-summary"[^>]*>([\s\S]*?)<\/section>/u,
  )?.[1] || ''
  for (const label of [
    '应出勤人天', '已确认人天', '待处理人次', '工资预览总额', '未分摊项目成本',
  ]) assert.match(monthlySummaryMarkup, new RegExp(label, 'u'))
  for (const legacyLabel of [
    '员工人数', '确认整天', '确认半天', '缺勤', '项目已分摊',
  ]) assert.doesNotMatch(monthlySummaryMarkup, new RegExp(legacyLabel, 'u'))
  assert.match(monthlyMarkup, /员工工资明细<\/h3><small>2 名员工/u)
  assert.equal((monthlyMarkup.match(/>查看整月考勤<\/button>/gu) || []).length, 2)
  assert.equal((monthlyMarkup.match(/历史人工记录无逐日考勤/gu) || []).length, 2)
  assert.match(monthlyMarkup, /aria-label="查看山田太郎 2026-07 整月考勤"/u)
  assert.doesNotMatch(monthlyMarkup, /aria-label="查看历史员工 2026-07 整月考勤"/u)

  const projectMarkup = render(ProjectLaborCostTab, {
    service: {},
    month: '2026-07',
    initialReport: projectReport,
    onMonthChange() {},
  })
  assert.match(projectMarkup, /项目开工至今累计/u)
  assert.match(projectMarkup, /全部项目费用对比/u)
  assert.match(projectMarkup, /导出项目用工明细/u)
  assert.match(projectMarkup, /最近六个月费用趋势/u)
  assert.match(projectMarkup, /员工费用构成/u)
  assert.match(projectMarkup, /每日分摊明细/u)
  assert.match(projectMarkup, /新考勤核算/u)

  const settingsMarkup = render(AttendanceAccountingSettings, {
    service: {},
    canUpdateSettings: true,
    initialSettings: accountingSettings,
  })
  assert.match(settingsMarkup, /考勤设置/u)
  assert.match(settingsMarkup, /周一/u)
  assert.match(settingsMarkup, /周六/u)
  assert.match(settingsMarkup, /08:00/u)
  assert.match(settingsMarkup, /17:00/u)
  assert.match(settingsMarkup, /启用日期/u)
})

test('salary and employee-level project data are absent under redacted permission variants', () => {
  const { default: MonthlyPayrollTab } = moduleFor('monthly')
  const { default: ProjectLaborCostTab } = moduleFor('project')
  const monthlyMarkup = render(MonthlyPayrollTab, {
    service: {}, month: '2026-07', initialReport: redactedMonthlyReport,
  })
  assert.match(monthlyMarkup, /工资金额已按权限隐藏/u)
  assert.doesNotMatch(monthlyMarkup, /实发工资/u)
  assert.doesNotMatch(monthlyMarkup, /加班费/u)
  assert.doesNotMatch(monthlyMarkup, /奖金/u)
  assert.doesNotMatch(monthlyMarkup, /扣款/u)
  assert.doesNotMatch(monthlyMarkup, /type="number"/u)
  const redactedSummaryMarkup = monthlyMarkup.match(
    /<section class="labor-report-summary"[^>]*>([\s\S]*?)<\/section>/u,
  )?.[1] || ''
  for (const label of ['应出勤人天', '已确认人天', '待处理人次']) {
    assert.match(redactedSummaryMarkup, new RegExp(label, 'u'))
  }
  assert.doesNotMatch(redactedSummaryMarkup, /工资预览总额|未分摊项目成本/u)

  const projectMarkup = render(ProjectLaborCostTab, {
    service: {}, month: '2026-07', initialReport: redactedProjectReport,
  })
  assert.match(projectMarkup, /项目开工至今累计/u)
  assert.match(projectMarkup, /全部项目费用对比/u)
  assert.doesNotMatch(projectMarkup, /员工筛选/u)
  assert.doesNotMatch(projectMarkup, /员工费用构成/u)
  assert.doesNotMatch(projectMarkup, /每日分摊明细/u)
  assert.doesNotMatch(projectMarkup, /导出项目用工明细/u)
})

test('month calendar grid covers ordinary February, leap year, 31-day months, and Monday-first weeks', () => {
  const { buildMonthCalendarGrid } = moduleFor('monthly')
  assert.equal(typeof buildMonthCalendarGrid, 'function')
  const daysFor = (month, count) => Array.from({ length: count }, (_, index) => ({
    workDate: `${month}-${String(index + 1).padStart(2, '0')}`,
    eligible: true,
    scheduleRequired: true,
    dayStatus: 'completed',
    issueCodes: [],
    accountingStatus: 'confirmed',
  }))

  const ordinaryFebruary = buildMonthCalendarGrid('2026-02', daysFor('2026-02', 28))
  assert.equal(ordinaryFebruary.length, 35)
  assert.equal(ordinaryFebruary.findIndex((cell) => cell?.workDate === '2026-02-01'), 6)
  assert.equal(ordinaryFebruary.filter(Boolean).length, 28)

  const leapFebruary = buildMonthCalendarGrid('2024-02', daysFor('2024-02', 29))
  assert.equal(leapFebruary.length, 35)
  assert.equal(leapFebruary.findIndex((cell) => cell?.workDate === '2024-02-01'), 3)
  assert.equal(leapFebruary.filter(Boolean).length, 29)

  const august = buildMonthCalendarGrid('2026-08', daysFor('2026-08', 31))
  assert.equal(august.length, 42)
  assert.equal(august.findIndex((cell) => cell?.workDate === '2026-08-01'), 5)
  assert.equal(august.filter(Boolean).at(-1)?.workDate, '2026-08-31')
  assert.deepEqual(buildMonthCalendarGrid('2026-13', []), [])
})

test('month calendar dialog exposes daily status, accounting, issues, ineligible days, and safe states', () => {
  const {
    EmployeeMonthCalendarDialog,
    calendarDayPresentation,
  } = moduleFor('monthly')
  assert.equal(typeof EmployeeMonthCalendarDialog, 'function')
  assert.equal(typeof calendarDayPresentation, 'function')

  const eligible = calendarDayPresentation(employeeMonthCalendar.days[1])
  assert.equal(eligible.dayStatusLabel, '已完成打卡')
  assert.equal(eligible.accountingStatusLabel, '草稿')
  assert.equal(eligible.issueLabel, '迟到、定位异常')
  assert.equal(eligible.scheduleLabel, '应出勤')
  const ineligible = calendarDayPresentation(employeeMonthCalendar.days[0])
  assert.equal(ineligible.dayStatusLabel, '不适用')
  assert.equal(ineligible.accountingStatusLabel, '无需核算')

  const markup = render(EmployeeMonthCalendarDialog, {
    state: { status: 'success', ...employeeMonthCalendar, error: '' },
    onClose() {},
    onRetry() {},
    onOpenDailyDate() {},
  })
  assert.match(markup, /role="dialog"/u)
  assert.match(markup, /aria-modal="true"/u)
  assert.match(markup, /山田太郎 · 2026-07 整月考勤/u)
  assert.match(markup, /周一[\s\S]*周二[\s\S]*周三[\s\S]*周四[\s\S]*周五[\s\S]*周六[\s\S]*周日/u)
  assert.equal((markup.match(/role="row"/gu) || []).length, 6)
  assert.match(markup, /data-dialog-initial-focus="true"/u)
  assert.match(markup, /aria-label="查看 2026-07-02 考勤"/u)
  assert.match(markup, /不适用/u)
  assert.match(markup, /已完成打卡/u)
  assert.match(markup, /核算：草稿/u)
  assert.match(markup, /异常：迟到、定位异常/u)

  const loadingMarkup = render(EmployeeMonthCalendarDialog, {
    state: { status: 'loading', ...employeeMonthCalendar, days: [], error: '' },
    onClose() {}, onRetry() {}, onOpenDailyDate() {},
  })
  assert.match(loadingMarkup, /正在加载整月考勤/u)
  const errorMarkup = render(EmployeeMonthCalendarDialog, {
    state: { status: 'error', ...employeeMonthCalendar, days: [], error: '读取失败' },
    onClose() {}, onRetry() {}, onOpenDailyDate() {},
  })
  assert.match(errorMarkup, /role="alert">读取失败/u)
  assert.match(errorMarkup, /重新加载整月考勤/u)
  const emptyMarkup = render(EmployeeMonthCalendarDialog, {
    state: { status: 'success', ...employeeMonthCalendar, days: [], error: '' },
    onClose() {}, onRetry() {}, onOpenDailyDate() {},
  })
  assert.match(emptyMarkup, /没有可显示的逐日考勤记录/u)
})

test('month calendar uses one RPC with stale guards, modal focus, retry, and current-only auth forwarding', () => {
  assert.equal((sources.monthly.match(/service\.listEmployeeMonthCalendar\s*\(/gu) || []).length, 1)
  assert.match(sources.monthly, /calendarGenerationRef/u)
  assert.match(sources.monthly, /calendarPendingRef/u)
  assert.match(sources.monthly, /calendarOpenRef/u)
  assert.match(sources.monthly, /monthRef\.current === requestedMonth/u)
  assert.match(
    sources.monthly,
    /current = mountedRef\.current[\s\S]{0,260}generation === calendarGenerationRef\.current[\s\S]{0,260}contextGeneration === contextGenerationRef\.current/u,
  )
  assert.match(
    sources.monthly,
    /if \(!current\) return[\s\S]{0,160}error\?\.authInvalid === true[\s\S]{0,80}onAuthInvalid/u,
  )
  assert.match(sources.monthly, /useLaborModalFocus/u)
  assert.match(sources.monthly, /data-dialog-initial-focus/u)
  assert.match(sources.monthly, /onRetry/u)
  assert.match(sources.monthly, /onOpenDailyDate/u)
  for (const handler of ['changeMonth', 'changeDepartment', 'changeEmployee', 'changeOnlyPending']) {
    assert.match(
      sources.monthly,
      new RegExp(`const ${handler}[\\s\\S]{0,260}closeMonthCalendar\\(\\)`, 'u'),
    )
  }
})

test('month calendar day action validates the date and returns to the matching daily board', () => {
  const { openLaborDailyDate } = moduleFor('page')
  assert.equal(typeof openLaborDailyDate, 'function')
  const actions = []
  assert.equal(openLaborDailyDate({
    workDate: '2026-07-02',
    setActiveTab: (tabId) => actions.push(`tab:${tabId}`),
    focusDailyTab: () => actions.push('focus:daily'),
    changeWorkDate: (workDate) => actions.push(`date:${workDate}`),
  }), true)
  assert.deepEqual(actions, ['tab:daily', 'focus:daily', 'date:2026-07-02'])
  assert.equal(openLaborDailyDate({
    workDate: '2026-7-2',
    setActiveTab: () => actions.push('invalid-tab'),
    changeWorkDate: () => actions.push('invalid-date'),
  }), false)
  for (const invalidWorkDate of ['2026-02-30', '1899-12-31', '2101-01-01']) {
    assert.equal(openLaborDailyDate({
      workDate: invalidWorkDate,
      setActiveTab: () => actions.push('invalid-tab'),
      changeWorkDate: () => actions.push('invalid-date'),
    }), false)
  }
  assert.deepEqual(actions, ['tab:daily', 'focus:daily', 'date:2026-07-02'])
  assert.match(sources.page, /<MonthlyPayrollTab[\s\S]{0,260}onOpenDailyDate=/u)
})

test('payroll and settings payload builders enforce exact safe integers and sorted weekdays', () => {
  const {
    buildMonthlyPayrollPayload,
    buildPayrollReopenPayload,
  } = moduleFor('monthly')
  const { buildAttendanceSettingsPayload } = moduleFor('settings')
  assert.deepEqual(buildMonthlyPayrollPayload({
    employee: monthlyEmployee,
    month: '2026-07',
    draft: { overtimePay: '1000', bonus: '2000', deduction: '500', confirmationNote: ' 确认 ' },
  }), {
    employeeProfileId: employee.employeeProfileId,
    month: '2026-07',
    overtimePay: 1000,
    bonus: 2000,
    deduction: 500,
    confirmationNote: '确认',
    version: 0,
  })
  assert.equal(buildMonthlyPayrollPayload({
    employee: monthlyEmployee,
    month: '2026-07',
    draft: { overtimePay: '1.5', bonus: '0', deduction: '0', confirmationNote: '' },
  }), null)
  assert.equal(buildMonthlyPayrollPayload({
    employee: monthlyEmployee,
    month: '2026-13',
    draft: { overtimePay: '0', bonus: '0', deduction: '0', confirmationNote: '' },
  }), null)
  assert.deepEqual(buildPayrollReopenPayload({
    employee: { ...monthlyEmployee, payrollId: '61000000-0000-4000-8000-000000000001', version: 3 },
    reason: ' 更正奖金 ',
  }), {
    payrollId: '61000000-0000-4000-8000-000000000001',
    reason: '更正奖金',
    version: 3,
  })
  assert.equal(buildPayrollReopenPayload({ employee: monthlyEmployee, reason: '   ' }), null)

  assert.deepEqual(buildAttendanceSettingsPayload({
    form: {
      effectiveFrom: '2026-07-16',
      workWeekdays: [6, 1, 4, 2, 5, 3],
      workStartTime: '08:00',
      workEndTime: '17:00',
      breakMinutes: '60',
      standardDayMinutes: '480',
    },
    version: 0,
  }), {
    effectiveFrom: '2026-07-16',
    workWeekdays: [1, 2, 3, 4, 5, 6],
    workStartTime: '08:00',
    workEndTime: '17:00',
    breakMinutes: 60,
    standardDayMinutes: 480,
    version: 0,
  })
  assert.equal(buildAttendanceSettingsPayload({
    form: { ...accountingSettings, effectiveFrom: '' }, version: 0,
  }), null)
})

test('project requests keep status detail-only and CSV cleanup revokes exactly once on success or failure', () => {
  const {
    buildProjectExportRequest,
    buildProjectReportRequest,
    downloadProjectLaborCsv,
  } = moduleFor('project')
  const filters = {
    projectId: '', employeeProfileId: '', status: 'pending',
  }
  assert.deepEqual(buildProjectReportRequest({ month: '2026-07', filters }), {
    month: '2026-07', projectId: null, employeeProfileId: null, status: 'pending',
  })
  assert.deepEqual(buildProjectExportRequest({ month: '2026-07', filters }), {
    month: '2026-07', projectId: null, employeeProfileId: null,
  })

  for (const failure of ['none', 'append', 'click']) {
    const events = []
    const anchor = {
      href: '', download: '',
      click() { events.push('click'); if (failure === 'click') throw new Error('click blocked') },
      remove() { events.push('remove') },
    }
    class FakeBlob {
      constructor(parts, options) { this.parts = parts; this.options = options }
    }
    const runtime = {
      Blob: FakeBlob,
      document: {
        createElement(name) { events.push(`create:${name}`); return anchor },
        body: { appendChild(node) {
          assert.equal(node, anchor)
          events.push('append')
          if (failure === 'append') throw new Error('append blocked')
        } },
      },
      URL: {
        createObjectURL(blob) {
          assert.equal(blob.options.type, 'text/csv;charset=utf-8')
          events.push('create-url')
          return 'blob:test'
        },
        revokeObjectURL(url) { assert.equal(url, 'blob:test'); events.push('revoke') },
      },
    }
    if (failure !== 'none') {
      assert.throws(
        () => downloadProjectLaborCsv('\uFEFF项目', '2026-07', runtime),
        new RegExp(`${failure} blocked`, 'u'),
      )
    } else {
      downloadProjectLaborCsv('\uFEFF项目', '2026-07', runtime)
    }
    assert.equal(anchor.download, '项目用工费用-2026-07.csv')
    assert.equal(events.filter((event) => event === 'remove').length, 1)
    assert.equal(events.filter((event) => event === 'revoke').length, 1)
  }
})

test('tab architecture is accessible, lazy, permission-gated, and derives month without local time', () => {
  const { laborTabsForPermissions, monthFromServerWorkDate } = moduleFor('page')
  assert.deepEqual(laborTabsForPermissions({ canViewProjectCosts: false }).map((tab) => tab.id), [
    'daily', 'monthly', 'settings',
  ])
  assert.deepEqual(laborTabsForPermissions({ canViewProjectCosts: true }).map((tab) => tab.id), [
    'daily', 'monthly', 'project', 'settings',
  ])
  assert.equal(monthFromServerWorkDate('2026-07-18'), '2026-07')
  assert.equal(monthFromServerWorkDate(''), '')
  for (const name of ['monthly', 'project']) {
    assert.match(sources[name], /optionCacheRef\.current\.month !== month[\s\S]{0,520}setReport\(null\)/u)
    assert.match(sources[name], /setFilterEpoch\(\(current\) => current \+ 1\)/u)
  }
  assert.match(sources.page, /role="tablist"/u)
  assert.match(sources.page, /aria-controls=/u)
  assert.match(sources.page, /aria-labelledby=/u)
  assert.match(sources.page, /activeTab === 'monthly'[\s\S]*<MonthlyPayrollTab/u)
  assert.match(sources.page, /activeTab === 'project'[\s\S]*canViewProjectCosts[\s\S]*<ProjectLaborCostTab/u)
  assert.match(sources.page, /activeTab === 'settings'[\s\S]*<AttendanceAccountingSettings/u)
  assert.match(
    sources.page,
    /changeAccountingMonth[\s\S]{0,240}monthInitializedRef\.current = true[\s\S]{0,120}setAccountingMonth\(nextMonth\)/u,
  )
  assert.doesNotMatch(sources.page, /new Date\s*\((?!Date\.UTC)/u)
})

test('tablist keyboard navigation follows only visible tabs, wraps, focuses, and prevents default', () => {
  const { handleLaborTabKeyDown, laborTabsForPermissions } = moduleFor('page')
  const hiddenProjectTabs = laborTabsForPermissions({ canViewProjectCosts: false })
  const visibleProjectTabs = laborTabsForPermissions({ canViewProjectCosts: true })

  const run = ({ tabs, activeTabId, key }) => {
    let prevented = 0
    let selected = ''
    let focused = ''
    const handled = handleLaborTabKeyDown({
      event: { key, preventDefault() { prevented += 1 } },
      tabs,
      activeTabId,
      onSelect(tabId) { selected = tabId },
      focusTab(tabId) { focused = tabId },
    })
    return { handled, prevented, selected, focused }
  }

  assert.deepEqual(run({ tabs: hiddenProjectTabs, activeTabId: 'monthly', key: 'ArrowRight' }), {
    handled: true, prevented: 1, selected: 'settings', focused: 'settings',
  })
  assert.deepEqual(run({ tabs: hiddenProjectTabs, activeTabId: 'settings', key: 'ArrowRight' }), {
    handled: true, prevented: 1, selected: 'daily', focused: 'daily',
  })
  assert.deepEqual(run({ tabs: hiddenProjectTabs, activeTabId: 'daily', key: 'ArrowLeft' }), {
    handled: true, prevented: 1, selected: 'settings', focused: 'settings',
  })
  assert.deepEqual(run({ tabs: hiddenProjectTabs, activeTabId: 'settings', key: 'Home' }), {
    handled: true, prevented: 1, selected: 'daily', focused: 'daily',
  })
  assert.deepEqual(run({ tabs: hiddenProjectTabs, activeTabId: 'daily', key: 'End' }), {
    handled: true, prevented: 1, selected: 'settings', focused: 'settings',
  })
  assert.deepEqual(run({ tabs: visibleProjectTabs, activeTabId: 'monthly', key: 'ArrowRight' }), {
    handled: true, prevented: 1, selected: 'project', focused: 'project',
  })
  assert.deepEqual(run({ tabs: hiddenProjectTabs, activeTabId: 'monthly', key: 'Enter' }), {
    handled: false, prevented: 0, selected: '', focused: '',
  })
  assert.match(sources.page, /onKeyDown=/u)
})

test('settings are read-only without update permission and all async tabs guard stale work', () => {
  const { default: AttendanceAccountingSettings } = moduleFor('settings')
  const markup = render(AttendanceAccountingSettings, {
    service: {},
    canUpdateSettings: false,
    initialSettings: accountingSettings,
  })
  const controls = markup.match(/<(?:input|button)\b[^>]*>/gu) || []
  assert.ok(controls.length >= 10)
  assert.ok(controls.every((control) => /disabled=""/u.test(control)))
  assert.doesNotMatch(markup, /name="weekday-7"[^>]*checked/u)
  assert.match(
    sources.settings,
    /loadState\.status === 'error'[\s\S]{0,180}<button type="button" onClick=\{\(\) => void loadSettings\(\)\}/u,
  )
  for (const name of ['monthly', 'project', 'settings']) {
    assert.match(sources[name], /mountedRef/u)
    assert.match(sources[name], /GenerationRef/u)
    assert.match(sources[name], /current/u)
    assert.match(sources[name], /userMessage/u)
  }
  assert.match(sources.monthly, /writeLocked/u)
  assert.match(sources.project, /exportLocked/u)
  assert.match(sources.settings, /writeLocked/u)
})

test('every rendered form control has an accessible label and the page is SSR-safe', () => {
  const { default: LaborAccountingPage } = moduleFor('page')
  const { default: DailyAttendanceBoard } = moduleFor('board')
  const { default: AttendanceResolutionDialog } = moduleFor('dialog')
  const boardMarkup = render(DailyAttendanceBoard, {
    dashboard,
    filters,
    onFiltersChange() {},
    onDateChange() {},
    onOpenResolution() {},
  })
  const dialogMarkup = render(AttendanceResolutionDialog, {
    detail,
    draft,
    saving: false,
    error: '',
    onChange() {},
    onSaveDraft() {},
    onConfirm() {},
    onClose() {},
  })
  const pageMarkup = render(LaborAccountingPage, {
    service: {
      listDailyDashboard: async () => dashboard,
      getResolutionDetail: async () => detail,
      saveResolutionDraft: async () => detail,
      confirmResolution: async () => detail,
    },
  })
  assert.match(pageMarkup, /人工考勤与工资/u)
  for (const markup of [boardMarkup, dialogMarkup]) {
    const controlCount = (markup.match(/<(?:input|select|textarea)\b/gu) || []).length
    const labelledCount = (markup.match(/<(?:input|select|textarea)\b[^>]*(?:aria-label|aria-labelledby|id)=/gu) || []).length
    assert.equal(labelledCount, controlCount)
  }
})

test('styles are fully scoped and turn the desktop table into narrow employee cards', () => {
  assert.ok(css.length > 0)
  assert.match(css, /\.labor-accounting-page/u)
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|:root)\b/u)
  assert.match(css, /@media\s*\(max-width:\s*\d+px\)/u)
  assert.match(css, /\.labor-accounting-page[^{}]*\.labor-desktop-table[^{]*\{[^}]*display:\s*none/su)
  assert.match(css, /\.labor-accounting-page[^{}]*\.labor-mobile-cards[^{]*\{[^}]*display:\s*grid/su)
  assert.doesNotMatch(css, /\.labor-accounting-page\s*\{[^}]*overflow-x:\s*auto/su)
  assert.match(css, /\.labor-accounting-page\s+\.labor-month-calendar-dialog\s*\{/u)
  assert.match(
    css,
    /\.labor-accounting-page\s+\.labor-month-calendar-week\s*\{[^}]*grid-template-columns:\s*repeat\(7,/su,
  )
  assert.match(
    css,
    /@media\s*\(max-width:\s*620px\)[\s\S]*\.labor-accounting-page\s+\.labor-month-calendar-dialog/u,
  )
  const narrowCss = css.slice(css.lastIndexOf('@media (max-width: 620px)'))
  assert.match(
    narrowCss,
    /\.labor-accounting-page\s+\.labor-month-calendar-grid\s*\{[^}]*min-width:\s*0/su,
  )
  assert.match(
    narrowCss,
    /\.labor-accounting-page\s+\.labor-month-calendar-wrap\s*\{[^}]*overflow-x:\s*hidden/su,
  )
  assert.match(
    narrowCss,
    /\.labor-accounting-page\s+\.labor-month-calendar-week\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/su,
  )
  assert.match(
    narrowCss,
    /\.labor-accounting-page\s+\.labor-month-calendar-weekdays,[\s\S]{0,180}\.labor-month-calendar-spacer\s*\{[^}]*display:\s*none/su,
  )
  assert.doesNotMatch(narrowCss, /min-width:\s*(?:770|840)px/u)
})

test('daily feature uses secure service injection without direct tables or local storage', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.ok(source.length > 0, `${name} source must exist`)
    assert.doesNotMatch(source, /\.from\s*\(/u)
    assert.doesNotMatch(source, /localStorage/u)
    assert.doesNotMatch(source, /console\./u)
  }
})

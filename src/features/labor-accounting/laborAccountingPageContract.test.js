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
    confirmedFullDays: 20,
    confirmedHalfDays: 1,
    absenceDays: 0,
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
    confirmedFullDays: 20,
    confirmedHalfDays: 1,
    absenceDays: 0,
    pendingCount: 0,
  },
  employees: [Object.fromEntries(Object.entries(monthlyEmployee).filter(([key]) => ![
    'salaryType', 'baseSalarySnapshot', 'basePay', 'overtimePay', 'bonus',
    'deduction', 'netSalary', 'projectAllocatedAmount', 'projectUnallocatedAmount',
    'confirmationNote', 'confirmedAt',
  ].includes(key)))],
  reconciliation: { postActivationLegacyRows: 0, globalMalformedLegacyRows: 0 },
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
  assert.doesNotMatch(sources.page, /new Date\s*\(/u)
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
})

test('daily feature uses secure service injection without direct tables or local storage', () => {
  for (const [name, source] of Object.entries(sources)) {
    assert.ok(source.length > 0, `${name} source must exist`)
    assert.doesNotMatch(source, /\.from\s*\(/u)
    assert.doesNotMatch(source, /localStorage/u)
    assert.doesNotMatch(source, /console\./u)
  }
})

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
    existingResolutionHasMoneyScope,
    resolutionConfirmBlockers,
  } = moduleFor('dialog')
  assert.equal(typeof existingResolutionHasMoneyScope, 'function')

  const permissionsRevoked = {
    ...detail,
    permissions: {
      canResolve: true,
      canViewSalary: false,
      canViewProjectCosts: true,
      canUpdateProjectCosts: false,
    },
    salary: null,
    resolution: {
      resolutionId: '62000000-0000-4000-8000-000000000001',
      resolutionType: 'full_day',
      attendanceUnits: 1,
      accountingStatus: 'confirmed',
      scheduleRequired: true,
      resolutionNote: '',
      confirmedAt: '2026-07-18T17:05:00+09:00',
      version: 1,
    },
    allocations: [{
      allocationId: '63000000-0000-4000-8000-000000000001',
      projectId: 'PROJECT-001',
      projectName: '东京站现场',
      allocationNote: '',
    }],
  }
  const zeroCostRest = {
    resolutionType: 'rest',
    attendanceUnits: 0,
    finalProjectCost: 0,
    allocations: [],
    resolutionNote: '',
    version: 1,
  }
  assert.equal(existingResolutionHasMoneyScope(permissionsRevoked), true)
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

  const brandNewZeroCost = { ...permissionsRevoked, resolution: null, allocations: [] }
  assert.equal(existingResolutionHasMoneyScope(brandNewZeroCost), false)
  assert.deepEqual(resolutionConfirmBlockers(brandNewZeroCost, zeroCostRest), [])
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

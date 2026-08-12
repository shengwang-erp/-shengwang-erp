import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import ExcelJS from 'exceljs'
import { createServer } from 'vite'

import { resolveAttendanceExperience } from './attendancePolicy.js'
import { createMonthlyPayrollReport } from '../accounting-reports/monthlyPayrollReport.js'
import {
  createAccountingReportWorkbook,
  exportAccountingReportXlsx,
} from '../accounting-reports/accountingReportExport.js'
import { createAccountingReportOutputSnapshot } from '../accounting-reports/accountingReportModel.js'

const vite = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/task8-department-attendance-e2e-vite-cache',
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const [attendancePage, attendanceLocation, attendanceResolution,
  { default: AccountingReportPrintSheet }] = await Promise.all([
  vite.ssrLoadModule('/src/features/attendance/TodayAttendancePage.jsx'),
  vite.ssrLoadModule('/src/features/attendance/AttendanceLocationAction.jsx'),
  vite.ssrLoadModule('/src/features/labor-accounting/AttendanceResolutionDialog.jsx'),
  vite.ssrLoadModule('/src/features/accounting-reports/AccountingReportPrintSheet.jsx'),
])
after(() => vite.close())

const {
  TodayAttendanceView,
  createAttendanceClockController,
  createAttendanceWorkPointSaveController,
} = attendancePage
const { createAttendanceLocationSubmissionController } = attendanceLocation
const {
  buildInitialResolutionDraft,
  resolutionConfirmBlockers,
  updateLocationReviewDraft,
} = attendanceResolution

const project = Object.freeze({
  projectId: '71000000-0000-4000-8000-000000000001',
  projectName: '东京样板工程',
  address: '东京都千代田区',
  latitude: 35.681236,
  longitude: 139.767125,
  attendanceRadiusMeters: 200,
  lifecycleStatus: 'active',
  siteStatus: '施工中',
})
const insideLocation = Object.freeze({
  latitude: 35.6813, longitude: 139.7672, accuracyMeters: 12,
})
const outsideLocation = Object.freeze({
  latitude: 35.6913, longitude: 139.7772, accuracyMeters: 12,
})

function clone(value) {
  return structuredClone(value)
}

function eventFor(result) {
  return {
    result,
    distanceMeters: result === 'abnormal' ? 1_430 : 18,
    radiusMeters: 200,
    accuracyMeters: 12,
    serverRecordedAt: '2026-08-12T09:00:00+09:00',
  }
}

class AttendanceServiceFake {
  constructor(attendanceMode) {
    this.attendanceMode = attendanceMode
    this.calls = []
    this.today = {
      workDate: '2026-08-12',
      policy: {
        attendanceRequired: attendanceMode !== 'exempt',
        attendanceMode,
      },
      viewerAccess: { scope: 'own', canViewScopedRecords: false },
      activeSession: null,
      completedSessions: [],
      pendingPhotoReservations: [],
    }
  }

  confirmation(input) {
    return {
      status: 'confirmation_required',
      confirmation: {
        projectId: project.projectId,
        projectName: project.projectName,
        distanceMeters: 1_430,
        radiusMeters: 200,
        accuracyMeters: input.location.accuracyMeters,
      },
    }
  }

  async clockIn(input) {
    this.calls.push({ operation: 'clock_in', input: clone(input) })
    if (input.requestId === 'service-failure') {
      const error = new Error('temporary service failure')
      error.code = 'ATTENDANCE_SERVICE_UNAVAILABLE'
      throw error
    }
    if (input.requestId === 'outside' && input.outOfRangeConfirmed !== true) {
      return this.confirmation(input)
    }
    const abnormal = input.requestId === 'outside'
    this.today.activeSession = {
      sessionId: `session-${this.attendanceMode}`,
      attendanceMode: this.attendanceMode,
      status: 'open',
      projectId: this.attendanceMode === 'project' ? project.projectId : null,
      projectNameSnapshot: this.attendanceMode === 'project' ? project.projectName : null,
      projectAddressSnapshot: this.attendanceMode === 'project' ? project.address : null,
      projectLatitudeSnapshot: this.attendanceMode === 'project' ? project.latitude : null,
      projectLongitudeSnapshot: this.attendanceMode === 'project' ? project.longitude : null,
      attendanceRadiusMetersSnapshot: this.attendanceMode === 'project'
        ? project.attendanceRadiusMeters : null,
      openedAt: '2026-08-12T09:00:00+09:00',
      clockInEvent: eventFor(abnormal ? 'abnormal' : 'normal'),
      workPoints: [],
    }
    return { status: 'saved', session: clone(this.today.activeSession) }
  }

  async upsertWorkPoint(input) {
    this.calls.push({ operation: 'upsert_work_point', input: clone(input) })
    const workPointId = '73000000-0000-4000-8000-000000000001'
    const photo = (phase) => ({
      photoId: `photo-${phase}`, workPointId, phase, uploadStatus: 'active',
    })
    this.today.activeSession.workPoints = [{
      workPointId,
      ...clone(input),
      photos: { before: photo('before'), after: photo('after') },
    }]
    return clone(this.today.activeSession.workPoints[0])
  }

  async clockOut(input) {
    this.calls.push({ operation: 'clock_out', input: clone(input) })
    if (input.requestId === 'outside' && input.outOfRangeConfirmed !== true) {
      return this.confirmation(input)
    }
    const session = this.today.activeSession
    const abnormal = input.requestId === 'outside'
    const closed = {
      ...session,
      status: 'closed',
      closedAt: '2026-08-12T18:00:00+09:00',
      clockOutEvent: eventFor(abnormal ? 'abnormal' : 'normal'),
    }
    this.today.activeSession = null
    this.today.completedSessions = [closed]
    return { status: 'saved', session: clone(closed) }
  }
}

function clockHarness(attendanceMode) {
  const service = new AttendanceServiceFake(attendanceMode)
  let today = clone(service.today)
  const controller = createAttendanceClockController({
    service,
    getToday: () => today,
    getSelectedProject: () => attendanceMode === 'project' ? project : null,
    refreshToday: async () => {
      today = clone(service.today)
      return { status: 'success', today }
    },
  })
  return { service, controller, getToday: () => today }
}

function attendanceMarkup({ mode, today, selectedProjectId = '' }) {
  return renderToStaticMarkup(createElement(TodayAttendanceView, {
    snapshot: {
      projects: mode === 'project' ? [project] : [],
      selectedProjectId,
      today,
    },
    handlers: {},
    locationService: { getCurrentLocation: async () => insideLocation },
    createRequestId: () => 'render-request',
  }))
}

function accountingDetail({ attendanceMode, abnormal = false }) {
  return {
    permissions: {
      canResolve: true,
      canViewSalary: true,
      canViewProjectCosts: true,
      canUpdateProjectCosts: true,
    },
    facts: {
      dayStatus: 'completed',
      hasOpenSession: false,
      issueCodes: abnormal ? ['abnormal_location'] : [],
      sessions: [{
        attendanceMode,
        projectId: attendanceMode === 'project' ? project.projectId : null,
        projectName: attendanceMode === 'project' ? project.projectName : null,
      }],
    },
    salary: { salaryType: '月薪', suggestedProjectCost: 12_000 },
    resolution: {},
  }
}

function payrollEmployee(overrides = {}) {
  return {
    employeeProfileId: '75000000-0000-4000-8000-000000000001',
    employeeNumber: 'SW-001',
    employeeName: '工程员工',
    department: '工程部',
    position: '工程担当',
    attendanceMethod: 'project',
    locationAbnormalCount: 0,
    locationReviewSummary: '',
    scheduledAttendanceUnits: 22,
    fullDays: 22,
    halfDays: 0,
    excusedDays: 0,
    absenceDays: 0,
    pendingDays: 0,
    basePay: 300_000,
    overtimePay: 0,
    bonus: 0,
    deduction: 0,
    netSalary: 300_000,
    projectAllocatedAmount: 300_000,
    projectUnallocatedAmount: 0,
    companyPersonnelCost: 0,
    status: 'confirmed',
    confirmationNote: '',
    confirmedAt: '2026-08-31T12:00:00+09:00',
    version: 1,
    ...overrides,
  }
}

test('engineering, general, and exempt attendance stay in their required UI and cost scopes', async () => {
  const projectFlow = clockHarness('project')
  assert.equal((await projectFlow.controller.clockIn({
    requestId: 'inside', location: insideLocation, abnormalReason: null,
  })).status, 'submitted')
  assert.equal((await projectFlow.controller.refreshAfterClock()).status, 'succeeded')

  let drafts = {}
  const pointController = createAttendanceWorkPointSaveController({
    service: projectFlow.service,
    getToday: projectFlow.getToday,
    getDrafts: () => drafts,
    setDrafts: (value) => { drafts = value },
    refreshToday: async () => {
      const current = clone(projectFlow.service.today)
      Object.assign(projectFlow.getToday(), current)
      return { status: 'success', today: current }
    },
  })
  assert.equal((await pointController.savePoint({
    ordinal: 1,
    areaName: '玄关柜',
    workDescription: '柜体安装',
    completionNote: '检查完成',
  })).status, 'succeeded')
  const activeProjectMarkup = attendanceMarkup({
    mode: 'project',
    today: clone(projectFlow.service.today),
    selectedProjectId: project.projectId,
  })
  assert.match(activeProjectMarkup, /施工点位/u)
  assert.match(activeProjectMarkup, /玄关柜/u)
  assert.match(activeProjectMarkup, /查看开工前照片/u)
  assert.match(activeProjectMarkup, /查看完工照片/u)

  assert.equal((await projectFlow.controller.clockOut({
    requestId: 'inside-out', location: insideLocation, abnormalReason: null,
  })).status, 'submitted')
  assert.equal((await projectFlow.controller.refreshAfterClock()).status, 'succeeded')
  const projectDraft = buildInitialResolutionDraft(accountingDetail({ attendanceMode: 'project' }))
  assert.deepEqual({
    finalProjectCost: projectDraft.finalProjectCost,
    allocations: projectDraft.allocations,
  }, {
    finalProjectCost: 12_000,
    allocations: [{
      projectId: project.projectId,
      amount: 12_000,
      allocationNote: '',
    }],
  })

  const generalFlow = clockHarness('general')
  const generalStartMarkup = attendanceMarkup({ mode: 'general', today: generalFlow.getToday() })
  assert.match(generalStartMarkup, /按当前位置打卡上班/u)
  assert.doesNotMatch(generalStartMarkup, /选择打卡项目|施工点位|工作说明/u)
  assert.equal((await generalFlow.controller.clockIn({
    requestId: 'general-in', location: insideLocation, abnormalReason: null,
  })).status, 'submitted')
  assert.equal((await generalFlow.controller.refreshAfterClock()).status, 'succeeded')
  assert.equal(generalFlow.service.calls[0].input.projectId, null)
  assert.match(
    attendanceMarkup({ mode: 'general', today: generalFlow.getToday() }),
    /按当前位置打卡下班/u,
  )
  assert.equal((await generalFlow.controller.clockOut({
    requestId: 'general-out', location: outsideLocation, abnormalReason: null,
  })).status, 'submitted')
  assert.equal((await generalFlow.controller.refreshAfterClock()).status, 'succeeded')
  const generalDraft = buildInitialResolutionDraft(accountingDetail({ attendanceMode: 'general' }))
  assert.deepEqual({
    finalProjectCost: generalDraft.finalProjectCost,
    allocations: generalDraft.allocations,
  }, { finalProjectCost: 0, allocations: [] })

  const exemptToday = new AttendanceServiceFake('exempt').today
  const exemptMarkup = attendanceMarkup({ mode: 'exempt', today: exemptToday })
  assert.match(exemptMarkup, /已设置为免每日打卡/u)
  assert.doesNotMatch(exemptMarkup, /attendance-location-start|选择打卡项目|施工点位/u)
})

test('out-of-range confirmation is cancelable and review changes no pay or project cost', async () => {
  const flow = clockHarness('project')
  const first = await flow.controller.clockIn({
    requestId: 'outside', location: outsideLocation, abnormalReason: null,
  })
  assert.equal(first.status, 'confirmation_required')
  assert.equal(flow.service.today.activeSession, null)
  assert.deepEqual({
    projectName: first.confirmation.projectName,
    distanceMeters: first.confirmation.distanceMeters,
    radiusMeters: first.confirmation.radiusMeters,
  }, { projectName: project.projectName, distanceMeters: 1_430, radiusMeters: 200 })
  assert.equal(flow.controller.cancelOutOfRange().status, 'cancelled')
  assert.equal(flow.service.calls.length, 1)

  assert.equal((await flow.controller.clockIn({
    requestId: 'outside', location: outsideLocation, abnormalReason: null,
  })).status, 'confirmation_required')
  assert.equal((await flow.controller.confirmOutOfRange()).status, 'submitted')
  assert.equal((await flow.controller.refreshAfterClock()).status, 'succeeded')
  assert.equal(flow.service.calls.at(-1).input.outOfRangeConfirmed, true)

  const detail = accountingDetail({ attendanceMode: 'project', abnormal: true })
  const original = buildInitialResolutionDraft(detail)
  assert.deepEqual(resolutionConfirmBlockers(detail, original), [
    '请选择定位异常处理结果',
    '请填写定位异常处理备注',
  ])
  const reviewed = updateLocationReviewDraft(original, {
    status: 'recorded_abnormal', note: '已核实为项目外打卡，仅作工资单记录',
  })
  assert.deepEqual(resolutionConfirmBlockers(detail, reviewed), [])
  assert.equal(reviewed.attendanceUnits, original.attendanceUnits)
  assert.equal(reviewed.finalProjectCost, original.finalProjectCost)
  assert.deepEqual(reviewed.allocations, original.allocations)

  const before = payrollEmployee({
    locationAbnormalCount: 1,
    locationReviewSummary: '待会计复核',
  })
  const afterReview = {
    ...before,
    locationReviewSummary: '判定异常 1 条：仅作管理记录，不改变工资或项目成本。',
  }
  for (const field of ['netSalary', 'projectAllocatedAmount', 'companyPersonnelCost']) {
    assert.equal(afterReview[field], before[field], field)
  }
})

test('the filtered payroll cohort is identical in the print and native Excel outputs', () => {
  const visibleRows = [
    payrollEmployee({
      employeeProfileId: '75000000-0000-4000-8000-000000000002',
      employeeNumber: 'SW-020',
      employeeName: '总务员工',
      department: '总务部',
      position: '总务',
      attendanceMethod: 'general',
      projectAllocatedAmount: 0,
      companyPersonnelCost: 300_000,
    }),
    payrollEmployee({
      employeeProfileId: '75000000-0000-4000-8000-000000000003',
      employeeNumber: 'SW-001',
      employeeName: '社长',
      department: '管理部',
      position: '社长',
      attendanceMethod: 'exempt',
      projectAllocatedAmount: 0,
      companyPersonnelCost: 300_000,
    }),
  ]
  const report = createMonthlyPayrollReport({
    employees: visibleRows,
    month: '2026-08',
    department: '办公室人员',
    employeeLabel: '',
    onlyPending: false,
    preparedBy: '会计甲',
    generatedAt: '2026-09-01T00:00:00+09:00',
  })
  const output = createAccountingReportOutputSnapshot(report, '2026-09-01T00:01:00+09:00')
  const printMarkup = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: output }))
  const workbook = createAccountingReportWorkbook(ExcelJS, output)
  const detail = workbook.getWorksheet('工资明细')

  assert.equal(output.recordCount, 2)
  assert.deepEqual(output.summary.slice(1, 4).map(({ value }) => value), [
    600_000, 0, 600_000,
  ])
  assert.match(printMarkup, /总务员工/u)
  assert.match(printMarkup, /社长/u)
  assert.doesNotMatch(printMarkup, /工程员工/u)
  assert.equal(detail.actualRowCount, detail.rowCount)
  const serialized = JSON.stringify(detail.getSheetValues())
  assert.match(serialized, /总务员工/u)
  assert.match(serialized, /社长/u)
  assert.doesNotMatch(serialized, /工程员工/u)
  assert.equal(detail.pageSetup.paperSize, 9)
  assert.equal(detail.pageSetup.orientation, 'landscape')
  assert.equal(detail.pageSetup.fitToWidth, 1)
})

test('fail-closed matrix covers location, policy, stale output, permissions, repeats, and service failure', async () => {
  let submitCalls = 0
  const denied = createAttendanceLocationSubmissionController({
    attendanceMode: 'general',
    targetLocation: null,
    locationService: {
      async getCurrentLocation() {
        const error = new Error('denied')
        error.code = 'GEOLOCATION_PERMISSION_DENIED'
        throw error
      },
    },
    createRequestId: () => 'denied-request',
    onSubmit: async () => { submitCalls += 1 },
  })
  const deniedResult = await denied.begin()
  assert.equal(deniedResult.status, 'failed')
  assert.equal(deniedResult.stage, 'locate')
  assert.equal(deniedResult.error.code, 'GEOLOCATION_PERMISSION_DENIED')
  assert.equal(submitCalls, 0)
  assert.equal(denied.getState().errorCode, 'GEOLOCATION_PERMISSION_DENIED')

  assert.equal(resolveAttendanceExperience(
    { attendanceRequired: true, attendanceMode: 'general' },
    { status: 'open', attendanceMode: 'project' },
  ).kind, 'policy-conflict')

  const staleReport = createMonthlyPayrollReport({
    employees: [payrollEmployee()], month: '2026-08', department: '工程部',
  })
  assert.equal(await exportAccountingReportXlsx(staleReport, { outputGuard: () => false }), false)

  const forbidden = accountingDetail({ attendanceMode: 'project' })
  forbidden.permissions.canViewSalary = false
  forbidden.permissions.canViewProjectCosts = false
  forbidden.permissions.canUpdateProjectCosts = false
  assert.deepEqual(resolutionConfirmBlockers(forbidden, buildInitialResolutionDraft(forbidden)), [
    '工资信息已按权限隐藏，不能确认含工资或项目费用的日结',
    '当前账号没有项目费用确认权限',
  ])

  let release
  const repeatedService = new AttendanceServiceFake('general')
  repeatedService.clockIn = async (input) => new Promise((resolve) => {
    repeatedService.calls.push({ operation: 'clock_in', input: clone(input) })
    release = () => resolve({ status: 'saved', session: {} })
  })
  let repeatedToday = clone(repeatedService.today)
  const repeated = createAttendanceClockController({
    service: repeatedService,
    getToday: () => repeatedToday,
    getSelectedProject: () => null,
    refreshToday: async () => ({ status: 'success', today: repeatedToday }),
  })
  const pending = repeated.clockIn({
    requestId: 'repeat-1', location: insideLocation, abnormalReason: null,
  })
  assert.deepEqual(await repeated.clockIn({
    requestId: 'repeat-2', location: insideLocation, abnormalReason: null,
  }), { status: 'busy' })
  release()
  assert.equal((await pending).status, 'submitted')
  assert.equal(repeatedService.calls.length, 1)

  const failed = clockHarness('general')
  await assert.rejects(
    failed.controller.clockIn({
      requestId: 'service-failure', location: insideLocation, abnormalReason: null,
    }),
    (error) => error.code === 'ATTENDANCE_SERVICE_UNAVAILABLE',
  )
  assert.equal(failed.service.today.activeSession, null)
})

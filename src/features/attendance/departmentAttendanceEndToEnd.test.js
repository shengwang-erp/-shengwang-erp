import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import ExcelJS from 'exceljs'
import { createServer } from 'vite'

import { createLaborAccountingService } from '../../services/laborAccountingService.js'
import { resolveAttendanceExperience } from './attendancePolicy.js'
import { createMonthlyPayrollReport } from '../accounting-reports/monthlyPayrollReport.js'
import {
  createAccountingReportWorkbook,
  exportAccountingReportXlsx,
} from '../accounting-reports/accountingReportExport.js'
import { createAccountingReportOutputSnapshot } from '../accounting-reports/accountingReportModel.js'
import {
  findWarehouseTestElement,
  installWarehouseReactDom,
  TestEvent,
} from '../warehouse/warehouseReactDomTestUtils.js'

const [todayAttendanceRunbook, attendanceAccountingRunbook] = await Promise.all([
  readFile(new URL('../../../docs/today-attendance-operations.md', import.meta.url), 'utf8'),
  readFile(new URL('../../../docs/attendance-accounting-operations.md', import.meta.url), 'utf8'),
])

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const vite = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/task8-department-attendance-e2e-vite-cache',
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const [attendancePage, attendanceLocation, attendanceResolution,
  { default: AccountingReportPrintSheet }, { default: MonthlyPayrollTab }] = await Promise.all([
  vite.ssrLoadModule('/src/features/attendance/TodayAttendancePage.jsx'),
  vite.ssrLoadModule('/src/features/attendance/AttendanceLocationAction.jsx'),
  vite.ssrLoadModule('/src/features/labor-accounting/AttendanceResolutionDialog.jsx'),
  vite.ssrLoadModule('/src/features/accounting-reports/AccountingReportPrintSheet.jsx'),
  vite.ssrLoadModule('/src/features/labor-accounting/MonthlyPayrollTab.jsx'),
])
after(() => vite.close())

const {
  TodayAttendanceView,
  createAttendanceClockController,
  createAttendancePhotoOperationController,
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
const PROJECT_EMPLOYEE_ID = '75000000-0000-4000-8000-000000000001'
const GENERAL_EMPLOYEE_ID = '75000000-0000-4000-8000-000000000002'
const EXEMPT_EMPLOYEE_ID = '75000000-0000-4000-8000-000000000003'
const ACCOUNTANT_ID = '75000000-0000-4000-8000-000000000004'
const SESSION_IDS = Object.freeze({
  project: '76000000-0000-4000-8000-000000000001',
  general: '76000000-0000-4000-8000-000000000002',
})
const WORK_POINT_ID = '77000000-0000-4000-8000-000000000001'
const RESOLUTION_ID = '78000000-0000-4000-8000-000000000001'
const ALLOCATION_ID = '79000000-0000-4000-8000-000000000001'
const PAYROLL_IDS = Object.freeze({
  project: '80000000-0000-4000-8000-000000000001',
  general: '80000000-0000-4000-8000-000000000002',
  exempt: '80000000-0000-4000-8000-000000000003',
})

function clone(value) {
  return structuredClone(value)
}

function eventFor(eventType, result) {
  return {
    eventId: eventType === 'clock_in'
      ? '81000000-0000-4000-8000-000000000001'
      : '81000000-0000-4000-8000-000000000002',
    eventType,
    result,
    distanceMeters: result === 'not_applicable' ? null : result === 'abnormal' ? 1_430 : 18,
    radiusMeters: result === 'not_applicable' ? null : 200,
    accuracyMeters: 12,
    serverRecordedAt: eventType === 'clock_in'
      ? '2026-08-12T09:00:00+09:00'
      : '2026-08-12T18:00:00+09:00',
    abnormalReason: result === 'abnormal' ? '定位超出项目范围' : null,
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
      sessionId: SESSION_IDS[this.attendanceMode],
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
      clockInEvent: eventFor('clock_in', this.attendanceMode === 'general'
        ? 'not_applicable' : abnormal ? 'abnormal' : 'normal'),
      workPoints: [],
    }
    return { status: 'saved', session: clone(this.today.activeSession) }
  }

  async upsertWorkPoint(input) {
    this.calls.push({ operation: 'upsert_work_point', input: clone(input) })
    this.today.activeSession.workPoints = [{
      workPointId: WORK_POINT_ID,
      ...clone(input),
      photos: { before: null, after: null },
    }]
    return clone(this.today.activeSession.workPoints[0])
  }

  async reservePhoto(input) {
    this.calls.push({ operation: 'reserve_photo', input: clone(input) })
    const phaseNumber = input.phase === 'before' ? '1' : '2'
    const reservation = {
      photoId: `82000000-0000-4000-8000-00000000000${phaseNumber}`,
      workPointId: input.workPointId,
      phase: input.phase,
      bucketId: 'erp-attendance-photos',
      objectPath: `fixture/${input.workPointId}/${input.phase}`,
      originalFileName: input.originalFileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadStatus: 'pending',
      capturedAt: input.capturedAt,
      createdAt: '2026-08-12T09:10:00+09:00',
    }
    this.today.pendingPhotoReservations = [
      ...this.today.pendingPhotoReservations,
      reservation,
    ]
    return clone(reservation)
  }

  async finalizePhoto({ photoId }) {
    this.calls.push({ operation: 'finalize_photo', input: { photoId } })
    const reservation = this.today.pendingPhotoReservations
      .find((photo) => photo.photoId === photoId)
    const active = { ...reservation, uploadStatus: 'active' }
    this.today.pendingPhotoReservations = this.today.pendingPhotoReservations
      .filter((photo) => photo.photoId !== photoId)
    const point = this.today.activeSession.workPoints
      .find((candidate) => candidate.workPointId === active.workPointId)
    point.photos = { ...point.photos, [active.phase]: active }
    return clone(active)
  }

  async abandonPhoto({ photoId }) {
    this.calls.push({ operation: 'abandon_photo', input: { photoId } })
    const reservation = this.today.pendingPhotoReservations
      .find((photo) => photo.photoId === photoId)
    this.today.pendingPhotoReservations = this.today.pendingPhotoReservations
      .filter((photo) => photo.photoId !== photoId)
    return { ...clone(reservation), uploadStatus: 'cleanup_pending' }
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
      clockOutEvent: eventFor('clock_out', this.attendanceMode === 'general'
        ? 'not_applicable' : abnormal ? 'abnormal' : 'normal'),
    }
    this.today.activeSession = null
    this.today.completedSessions = [closed]
    return { status: 'saved', session: clone(closed) }
  }
}

function clockHarness(attendanceMode) {
  const service = new AttendanceServiceFake(attendanceMode)
  let today = clone(service.today)
  const refreshToday = async () => {
    today = clone(service.today)
    return { status: 'success', today }
  }
  const controller = createAttendanceClockController({
    service,
    getToday: () => today,
    getSelectedProject: () => attendanceMode === 'project' ? project : null,
    refreshToday,
  })
  return { service, controller, getToday: () => today, refreshToday }
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

const RELEASE_EMPLOYEES = Object.freeze({
  project: Object.freeze({
    employeeProfileId: PROJECT_EMPLOYEE_ID,
    employeeNumber: 'SW-021', employeeName: '工程员工',
    department: '工程部', position: '工程担当', monthlySalary: 300_000,
  }),
  general: Object.freeze({
    employeeProfileId: GENERAL_EMPLOYEE_ID,
    employeeNumber: 'SW-028', employeeName: '总务员工',
    department: '总务部', position: '总务', monthlySalary: 320_000,
  }),
  exempt: Object.freeze({
    employeeProfileId: EXEMPT_EMPLOYEE_ID,
    employeeNumber: 'SW-001', employeeName: '社长',
    department: '管理部', position: '社长', monthlySalary: 500_000,
  }),
})

function releaseSource(attendanceMode, harness = null) {
  return Object.freeze({
    attendanceMode,
    employee: RELEASE_EMPLOYEES[attendanceMode],
    today: harness ? clone(harness.getToday()) : {
      workDate: '2026-08-12',
      policy: { attendanceRequired: false, attendanceMode: 'exempt' },
      activeSession: null,
      completedSessions: [],
      pendingPhotoReservations: [],
    },
  })
}

function sourceClosedSession(source) {
  return source.today.completedSessions[0] || null
}

function sourceHasAbnormalLocation(source) {
  const session = sourceClosedSession(source)
  return [session?.clockInEvent, session?.clockOutEvent]
    .some((event) => event?.result === 'abnormal')
}

function laborSessionFromSource(source) {
  const session = sourceClosedSession(source)
  if (!session) return null
  const event = (value) => ({
    eventId: value.eventId,
    eventType: value.eventType,
    serverRecordedAt: value.serverRecordedAt,
    result: value.result,
    abnormalReason: value.abnormalReason,
    distanceMeters: value.distanceMeters,
    radiusMeters: value.radiusMeters,
  })
  return {
    sessionId: session.sessionId,
    attendanceMode: session.attendanceMode,
    projectId: session.projectId,
    projectName: session.projectNameSnapshot,
    status: session.status,
    openedAt: session.openedAt,
    closedAt: session.closedAt,
    clockInEvent: event(session.clockInEvent),
    clockOutEvent: event(session.clockOutEvent),
  }
}

function resolutionFromSource(source, reviewStatus) {
  if (!reviewStatus) return null
  const abnormal = sourceHasAbnormalLocation(source)
  return {
    resolutionId: RESOLUTION_ID,
    resolutionType: 'full_day',
    attendanceUnits: 1,
    accountingStatus: 'confirmed',
    scheduleRequired: true,
    resolutionNote: '',
    locationReviewStatus: abnormal ? reviewStatus : null,
    locationReviewNote: abnormal ? '已核对同一越界考勤事实，仅作工资单记录' : '',
    locationReviewedByEmployeeProfileId: abnormal ? ACCOUNTANT_ID : null,
    locationReviewedAt: abnormal ? '2026-08-12T18:05:00+09:00' : null,
    attendanceMethodSnapshot: source.attendanceMode,
    confirmedAt: '2026-08-12T18:05:00+09:00',
    version: 1,
    salaryTypeSnapshot: '月薪',
    baseSalarySnapshot: source.employee.monthlySalary,
    dailySalarySnapshot: null,
    hourlyWageSnapshot: null,
    suggestedProjectCost: 12_000,
    finalProjectCost: 12_000,
  }
}

function rawResolutionDetail(source, reviewStatus = '') {
  const session = laborSessionFromSource(source)
  assert.ok(session, 'a closed attendance session is required for accounting')
  const abnormal = sourceHasAbnormalLocation(source)
  const projectMode = source.attendanceMode === 'project'
  const resolution = resolutionFromSource(source, reviewStatus)
  return {
    employee: {
      employeeProfileId: source.employee.employeeProfileId,
      employeeNumber: source.employee.employeeNumber,
      employeeName: source.employee.employeeName,
      department: source.employee.department,
      position: source.employee.position,
    },
    workDate: source.today.workDate,
    scheduleRequired: true,
    facts: {
      dayStatus: 'completed',
      issueCodes: abnormal ? ['abnormal_location'] : [],
      firstClockInAt: session.openedAt,
      lastClockOutAt: session.closedAt,
      hasOpenSession: false,
      hasAbnormalLocation: abnormal,
      workedMinutesReference: 480,
      sessions: [session],
    },
    hasMoneyScope: projectMode,
    permissions: {
      canResolve: true,
      canViewSalary: true,
      canViewProjectCosts: true,
      canUpdateProjectCosts: true,
    },
    salary: {
      salaryType: '月薪',
      baseSalary: source.employee.monthlySalary,
      dailySalary: null,
      hourlyWage: null,
      suggestedProjectCost: projectMode ? 12_000 : 0,
    },
    resolution: resolution && !projectMode ? {
      ...resolution, suggestedProjectCost: 0, finalProjectCost: 0,
    } : resolution,
    allocations: resolution && projectMode ? [{
      allocationId: ALLOCATION_ID,
      projectId: project.projectId,
      projectName: project.projectName,
      amount: 12_000,
      allocationNote: '',
    }] : [],
    availableProjects: projectMode
      ? [{ projectId: project.projectId, projectName: project.projectName }]
      : [],
  }
}

function rawPayrollEmployee(source, reviewStatus = '') {
  const abnormal = sourceHasAbnormalLocation(source)
  const attendanceMethod = source.attendanceMode
  const projectMode = attendanceMethod === 'project'
  const attendanceUnits = attendanceMethod === 'exempt' ? 22 : 1
  const reviewLabel = reviewStatus === 'confirmed_valid' ? '确认有效' : '判定异常'
  return {
    employeeProfileId: source.employee.employeeProfileId,
    employeeNumber: source.employee.employeeNumber,
    employeeName: source.employee.employeeName,
    department: source.employee.department,
    position: source.employee.position,
    attendanceMethod,
    locationAbnormalCount: abnormal ? 1 : 0,
    locationReviewSummary: abnormal ? `${reviewLabel} 1 条：仅作管理记录。` : '',
    scheduledAttendanceUnits: attendanceUnits,
    fullDays: attendanceUnits,
    halfDays: 0,
    excusedDays: 0,
    absenceDays: 0,
    pendingDays: 0,
    issueCounts: {
      late: 0, early: 0, abnormalLocation: abnormal ? 1 : 0, overtimePending: 0,
    },
    status: 'confirmed',
    payrollId: PAYROLL_IDS[attendanceMethod],
    version: 1,
    salaryType: '月薪',
    baseSalarySnapshot: source.employee.monthlySalary,
    basePay: source.employee.monthlySalary,
    overtimePay: 0,
    bonus: 0,
    deduction: 0,
    netSalary: source.employee.monthlySalary,
    projectAllocatedAmount: projectMode ? 12_000 : 0,
    projectUnallocatedAmount: 0,
    companyPersonnelCost: projectMode ? 0 : source.employee.monthlySalary,
    confirmationNote: abnormal ? '定位异常仅作记录，工资正常计入' : '',
    confirmedAt: '2026-08-31T12:00:00+09:00',
  }
}

function rawMonthlyPayroll(sources, args, { canViewSalary = true, reviewStatus = '' } = {}) {
  let employees = sources.map((source) => rawPayrollEmployee(source, reviewStatus))
  if (args.p_search) employees = employees.filter((row) => row.department === args.p_search)
  if (args.p_employee_profile_id) {
    employees = employees.filter((row) => row.employeeProfileId === args.p_employee_profile_id)
  }
  if (args.p_only_pending) employees = employees.filter((row) => row.status !== 'confirmed')
  const summary = {
    employeeCount: employees.length,
    scheduledAttendanceUnits: employees.reduce(
      (total, row) => total + row.scheduledAttendanceUnits, 0,
    ),
    confirmedAttendanceUnits: employees.reduce(
      (total, row) => total + row.fullDays + row.halfDays * 0.5, 0,
    ),
    pendingCount: employees.reduce((total, row) => total + row.pendingDays, 0),
  }
  if (canViewSalary) {
    Object.assign(summary, {
      salaryPreviewTotal: employees.reduce((total, row) => total + row.netSalary, 0),
      projectAllocatedTotal: employees.reduce(
        (total, row) => total + row.projectAllocatedAmount, 0,
      ),
      projectUnallocatedTotal: employees.reduce(
        (total, row) => total + row.projectUnallocatedAmount, 0,
      ),
    })
  } else {
    employees = employees.map((row) => {
      const redacted = { ...row }
      for (const key of [
        'salaryType', 'baseSalarySnapshot', 'basePay', 'overtimePay', 'bonus', 'deduction',
        'netSalary', 'projectAllocatedAmount', 'projectUnallocatedAmount',
        'companyPersonnelCost', 'confirmationNote', 'confirmedAt',
      ]) delete redacted[key]
      return redacted
    })
  }
  return {
    salaryMonth: '2026-08-01',
    permissions: { canViewSalary, canUpdateSalary: canViewSalary },
    summary,
    employees,
    reconciliation: { postActivationLegacyRows: 0, globalMalformedLegacyRows: 0 },
  }
}

function releaseLaborBoundary(sources, options = {}) {
  const calls = []
  const client = {
    async rpc(name, args) {
      calls.push([name, clone(args)])
      let data
      if (name === 'get_attendance_resolution_detail_secure') {
        const source = sources.find(
          (candidate) => candidate.employee.employeeProfileId === args.p_employee_profile_id,
        )
        data = rawResolutionDetail(source, options.reviewStatus || '')
      } else if (name === 'list_monthly_payroll_secure') {
        data = rawMonthlyPayroll(sources, args, options)
      } else {
        throw new Error(`unexpected release-boundary RPC: ${name}`)
      }
      return { data, error: null, status: 200, statusText: 'OK' }
    },
  }
  return {
    service: createLaborAccountingService(client, { configured: true }),
    calls,
  }
}

async function completeAttendanceFlow(attendanceMode, { abnormal = false, withPhotos = false } = {}) {
  const harness = clockHarness(attendanceMode)
  const requestId = abnormal ? 'outside' : `${attendanceMode}-inside`
  const location = abnormal ? outsideLocation : insideLocation
  const first = await harness.controller.clockIn({ requestId, location, abnormalReason: null })
  if (abnormal) {
    assert.equal(first.status, 'confirmation_required')
    assert.equal((await harness.controller.confirmOutOfRange()).status, 'submitted')
  } else {
    assert.equal(first.status, 'submitted')
  }
  assert.equal((await harness.controller.refreshAfterClock()).status, 'succeeded')
  if (attendanceMode === 'project') {
    let drafts = {}
    const pointController = createAttendanceWorkPointSaveController({
      service: harness.service,
      getToday: harness.getToday,
      getDrafts: () => drafts,
      setDrafts: (value) => { drafts = value },
      refreshToday: harness.refreshToday,
    })
    assert.equal((await pointController.savePoint({
      ordinal: 1, areaName: '玄关柜', workDescription: '柜体安装', completionNote: '检查完成',
    })).status, 'succeeded')
    if (withPhotos) {
      let attempt = 0
      const photoController = createAttendancePhotoOperationController({
        service: harness.service,
        photoStorage: { async uploadReservedPhoto() {} },
        createAttemptId: () => `release-photo-${++attempt}`,
        getToday: harness.getToday,
        refreshToday: harness.refreshToday,
      })
      const file = (name) => ({
        name, type: 'image/jpeg', size: 4,
        lastModified: Date.parse('2026-08-12T09:01:00+09:00'),
      })
      assert.equal((await photoController.selectPhoto({
        workPointId: WORK_POINT_ID, phase: 'before', file: file('before.jpg'),
      })).status, 'succeeded')
      assert.equal((await photoController.selectPhoto({
        workPointId: WORK_POINT_ID, phase: 'after', file: file('after.jpg'),
      })).status, 'succeeded')
      photoController.unmount()
    }
  }
  const closeId = abnormal ? 'outside' : `${attendanceMode}-out`
  const close = await harness.controller.clockOut({
    requestId: closeId, location, abnormalReason: null,
  })
  if (abnormal) {
    assert.equal(close.status, 'confirmation_required')
    assert.equal((await harness.controller.confirmOutOfRange()).status, 'submitted')
  } else {
    assert.equal(close.status, 'submitted')
  }
  assert.equal((await harness.controller.refreshAfterClock()).status, 'succeeded')
  return { harness, source: releaseSource(attendanceMode, harness) }
}

function findElement(root, predicate) {
  return findWarehouseTestElement(root, predicate)
}

function button(root, label) {
  return findElement(root, (element) =>
    element.nodeName === 'BUTTON' && element.textContent.trim() === label)
}

test('engineering, general, and exempt attendance stay in their required UI and cost scopes', async () => {
  const { harness: projectFlow, source: projectSource } = await completeAttendanceFlow(
    'project', { withPhotos: true },
  )
  const projectSession = sourceClosedSession(projectSource)
  assert.equal(projectSession.status, 'closed')
  assert.deepEqual(Object.keys(projectSession.workPoints[0].photos).sort(), ['after', 'before'])
  assert.equal(projectSource.today.pendingPhotoReservations.length, 0)
  assert.equal(projectFlow.service.calls.filter(({ operation }) => operation === 'reserve_photo').length, 2)
  assert.equal(projectFlow.service.calls.filter(({ operation }) => operation === 'finalize_photo').length, 2)
  const projectBoundary = releaseLaborBoundary([projectSource])
  const projectDetail = await projectBoundary.service.getResolutionDetail({
    employeeProfileId: PROJECT_EMPLOYEE_ID, workDate: '2026-08-12',
  })
  assert.equal(projectDetail.facts.sessions[0].sessionId, projectSession.sessionId)
  assert.equal(projectDetail.facts.sessions[0].status, projectSession.status)
  const projectDraft = buildInitialResolutionDraft(projectDetail)
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
  const projectPayroll = await projectBoundary.service.listMonthlyPayroll({
    month: '2026-08', department: '', employeeProfileId: null, onlyPending: false,
  })
  assert.deepEqual({
    units: projectPayroll.employees[0].fullDays,
    projectCost: projectPayroll.employees[0].projectAllocatedAmount,
    companyCost: projectPayroll.employees[0].companyPersonnelCost,
  }, { units: 1, projectCost: 12_000, companyCost: 0 })

  const generalFlow = clockHarness('general')
  const generalStartMarkup = attendanceMarkup({ mode: 'general', today: generalFlow.getToday() })
  assert.match(generalStartMarkup, /按当前位置打卡上班/u)
  assert.doesNotMatch(generalStartMarkup, /选择打卡项目|施工点位|工作说明/u)
  const { harness: finishedGeneral, source: generalSource } = await completeAttendanceFlow('general')
  assert.equal(finishedGeneral.service.calls[0].input.projectId, null)
  const generalPayroll = await releaseLaborBoundary([generalSource]).service.listMonthlyPayroll({
    month: '2026-08', department: '', employeeProfileId: null, onlyPending: false,
  })
  assert.deepEqual({
    projectCost: generalPayroll.employees[0].projectAllocatedAmount,
    companyCost: generalPayroll.employees[0].companyPersonnelCost,
  }, { projectCost: 0, companyCost: 320_000 })

  const exemptSource = releaseSource('exempt')
  const exemptMarkup = attendanceMarkup({ mode: 'exempt', today: exemptSource.today })
  assert.match(exemptMarkup, /已设置为免每日打卡/u)
  assert.doesNotMatch(exemptMarkup, /attendance-location-start|选择打卡项目|施工点位/u)
  const exemptPayroll = await releaseLaborBoundary([exemptSource]).service.listMonthlyPayroll({
    month: '2026-08', department: '', employeeProfileId: null, onlyPending: false,
  })
  assert.deepEqual({
    units: exemptPayroll.employees[0].fullDays,
    netSalary: exemptPayroll.employees[0].netSalary,
    companyCost: exemptPayroll.employees[0].companyPersonnelCost,
  }, { units: 22, netSalary: 500_000, companyCost: 500_000 })
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

  const { harness: completed, source } = await completeAttendanceFlow(
    'project', { abnormal: true, withPhotos: true },
  )
  assert.equal(completed.service.calls.filter(({ input }) =>
    input?.outOfRangeConfirmed === true).length, 2)
  const detail = await releaseLaborBoundary([source]).service.getResolutionDetail({
    employeeProfileId: PROJECT_EMPLOYEE_ID, workDate: '2026-08-12',
  })
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

  const reviewOutputs = []
  for (const reviewStatus of ['confirmed_valid', 'recorded_abnormal']) {
    const boundary = releaseLaborBoundary([source], { reviewStatus })
    const [reviewDetail, payroll] = await Promise.all([
      boundary.service.getResolutionDetail({
        employeeProfileId: PROJECT_EMPLOYEE_ID, workDate: '2026-08-12',
      }),
      boundary.service.listMonthlyPayroll({
        month: '2026-08', department: '', employeeProfileId: null, onlyPending: false,
      }),
    ])
    reviewOutputs.push({ detail: reviewDetail, payroll: payroll.employees[0] })
  }
  assert.notEqual(
    reviewOutputs[0].detail.resolution.locationReviewStatus,
    reviewOutputs[1].detail.resolution.locationReviewStatus,
  )
  assert.notEqual(
    reviewOutputs[0].payroll.locationReviewSummary,
    reviewOutputs[1].payroll.locationReviewSummary,
  )
  for (const output of reviewOutputs) {
    assert.equal(output.detail.facts.sessions[0].sessionId, sourceClosedSession(source).sessionId)
    assert.equal(output.detail.resolution.attendanceUnits, 1)
    assert.equal(output.detail.resolution.finalProjectCost, 12_000)
    assert.equal(output.payroll.fullDays, 1)
    assert.equal(output.payroll.netSalary, 300_000)
    assert.equal(output.payroll.projectAllocatedAmount, 12_000)
    assert.equal(output.payroll.companyPersonnelCost, 0)
  }
})

test('the rendered payroll filter drives identical print and native Excel cohorts', async () => {
  const [{ source: projectSource }, { source: generalSource }] = await Promise.all([
    completeAttendanceFlow('project'), completeAttendanceFlow('general'),
  ])
  const boundary = releaseLaborBoundary([projectSource, generalSource, releaseSource('exempt')])
  const initialReport = await boundary.service.listMonthlyPayroll({
    month: '2026-08', department: '', employeeProfileId: null, onlyPending: false,
  })
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  let exportedOutput = null
  await act(async () => {
    root.render(createElement(MonthlyPayrollTab, {
      service: boundary.service,
      month: '2026-08',
      initialReport,
      reportPreparedBy: '会计甲',
      reportActionDependencies: {
        now: () => new Date('2026-09-01T00:01:00+09:00'),
        exportExcel: async (outputReport, { outputGuard }) => {
          assert.equal(outputGuard(), true)
          exportedOutput = outputReport
          return true
        },
      },
    }))
    await Promise.resolve()
  })
  const department = findElement(container, (element) =>
    element.getAttribute?.('aria-label') === '月度工资部门')
  assert.ok(department)
  await act(async () => {
    department.value = '总务部'
    department.dispatchEvent(new TestEvent('change'))
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(container.textContent, /总务员工/u)
  assert.match(container.textContent, /员工工资明细1 名员工/u)
  assert.deepEqual(boundary.calls.at(-1), ['list_monthly_payroll_secure', {
    p_month: '2026-08-01', p_search: '总务部', p_employee_profile_id: null,
    p_only_pending: false,
  }])
  await act(async () => {
    button(container, '导出 Excel').click()
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.ok(exportedOutput)
  assert.equal(exportedOutput.recordCount, 1)
  assert.deepEqual(
    exportedOutput.sections[1].rows.map((row) => row.employeeNumber), ['SW-028'],
  )
  assert.deepEqual(
    Object.fromEntries(exportedOutput.summary.map(({ label, value }) => [label, value])),
    { 员工人数: 1, 实发工资合计: 320_000, 项目人工成本: 0,
      公司人员成本: 320_000, 超范围记录: 0 },
  )
  await act(async () => root.unmount())
  dom.cleanup()
  const printMarkup = renderToStaticMarkup(createElement(AccountingReportPrintSheet, {
    report: exportedOutput,
  }))
  const workbook = createAccountingReportWorkbook(ExcelJS, exportedOutput)
  const detail = workbook.getWorksheet('工资明细')
  const serialized = JSON.stringify(detail.getSheetValues())
  assert.match(printMarkup, /总务员工/u)
  assert.doesNotMatch(printMarkup, /工程员工|社长/u)
  assert.match(serialized, /SW-028|总务员工/u)
  assert.doesNotMatch(serialized, /SW-021|SW-001|工程员工|社长/u)
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
  const policyFlow = clockHarness('project')
  assert.equal((await policyFlow.controller.clockIn({
    requestId: 'policy-open', location: insideLocation, abnormalReason: null,
  })).status, 'submitted')
  assert.equal((await policyFlow.controller.refreshAfterClock()).status, 'succeeded')
  const changedPolicyToday = clone(policyFlow.getToday())
  changedPolicyToday.policy = { attendanceRequired: true, attendanceMode: 'general' }
  const conflictMarkup = attendanceMarkup({ mode: 'general', today: changedPolicyToday })
  assert.match(conflictMarkup, /人员打卡设置已变化，请重新读取/u)
  assert.doesNotMatch(conflictMarkup, /按当前位置打卡下班|施工点位|工作说明/u)

  const { source: sourceForOutputs } = await completeAttendanceFlow('project')
  const staleReport = createMonthlyPayrollReport({
    employees: [rawPayrollEmployee(sourceForOutputs)], month: '2026-08', department: '工程部',
  })
  assert.equal(await exportAccountingReportXlsx(staleReport, { outputGuard: () => false }), false)

  const forbidden = rawResolutionDetail(sourceForOutputs)
  forbidden.permissions.canViewSalary = false
  forbidden.permissions.canViewProjectCosts = false
  forbidden.permissions.canUpdateProjectCosts = false
  assert.deepEqual(resolutionConfirmBlockers(forbidden, buildInitialResolutionDraft(forbidden)), [
    '该日结已有项目人工成本；当前账号缺少完整费用权限，不能修改或清空原结论',
    '工资信息已按权限隐藏，不能确认含工资或项目费用的日结',
    '当前账号没有项目费用确认权限',
  ])
  const redactedBoundary = releaseLaborBoundary(
    [sourceForOutputs, releaseSource('exempt')], { canViewSalary: false },
  )
  const redactedReport = await redactedBoundary.service.listMonthlyPayroll({
    month: '2026-08', department: '', employeeProfileId: null, onlyPending: false,
  })
  const redactedDom = installWarehouseReactDom()
  const redactedContainer = redactedDom.createContainer()
  const redactedRoot = createRoot(redactedContainer)
  let outputInvocations = 0
  await act(async () => {
    redactedRoot.render(createElement(MonthlyPayrollTab, {
      service: redactedBoundary.service,
      month: '2026-08',
      initialReport: redactedReport,
      reportActionDependencies: {
        exportExcel: async () => { outputInvocations += 1 },
        printReport: () => { outputInvocations += 1 },
      },
    }))
    await Promise.resolve()
    await Promise.resolve()
  })
  assert.match(redactedContainer.textContent, /工资金额已按权限隐藏/u)
  assert.doesNotMatch(redactedContainer.textContent, /¥|实发工资|项目成本|公司人员成本/u)
  assert.equal(button(redactedContainer, '导出 Excel'), null)
  assert.equal(button(redactedContainer, '导出 PDF'), null)
  assert.equal(button(redactedContainer, '打印'), null)
  assert.equal(findElement(redactedDom.document.body, (element) =>
    element.className?.includes('accounting-report-print-root')), null)
  assert.equal(outputInvocations, 0)
  await act(async () => redactedRoot.unmount())
  redactedDom.cleanup()

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

test('deployment runbooks split executable attendance and accounting probes at the migration boundary', () => {
  const attendanceSignatures = [
    'public.list_attendance_projects_secure()',
    'public.get_my_today_attendance_secure()',
    'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'public.clock_out_project_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'public.list_attendance_projects_v2_secure()',
    'public.get_my_today_attendance_v2_secure()',
    'public.clock_in_general_secure(uuid,double precision,double precision,numeric,timestamp with time zone)',
    'public.clock_in_project_v2_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'public.clock_out_attendance_v2_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
  ]
  const accountingSignatures = [
    'public.get_attendance_resolution_detail_secure(uuid,date)',
    'public.save_attendance_resolution_draft_secure(uuid,date,text,numeric,numeric,jsonb,text,text,text,integer)',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,text,text,integer)',
    'public.list_monthly_payroll_secure(date,text,uuid,boolean)',
    'public.save_monthly_payroll_draft_secure(uuid,date,numeric,numeric,numeric,text,integer)',
    'public.confirm_monthly_payroll_secure(uuid,date,numeric,numeric,numeric,text,integer)',
    'public.reopen_monthly_payroll_secure(uuid,text,integer)',
  ]

  for (const signature of attendanceSignatures) {
    assert.match(todayAttendanceRunbook, new RegExp(signature.replace(/[()]/gu, '\\$&'), 'u'))
  }
  for (const signature of accountingSignatures) {
    assert.match(attendanceAccountingRunbook, new RegExp(signature.replace(/[()]/gu, '\\$&'), 'u'))
  }
  for (const runbook of [todayAttendanceRunbook, attendanceAccountingRunbook]) {
    assert.match(runbook, /has_function_privilege\('authenticated',\s*procedure_oid,\s*'EXECUTE'\)/u)
    assert.match(runbook, /has_function_privilege\('anon',\s*procedure_oid,\s*'EXECUTE'\)/u)
  }
  const post120001 = todayAttendanceRunbook.slice(
    todayAttendanceRunbook.indexOf('### `202608120001` 后立即执行'),
    todayAttendanceRunbook.indexOf('### `202608120002` 后执行'),
  )
  assert.ok(post120001.length > 0)
  assert.doesNotMatch(post120001, /monthly_payroll|attendance_resolution/u)
})

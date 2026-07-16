import {
  ACCOUNTING_RESOLUTION_TYPES,
  ATTENDANCE_ISSUE_CODES,
} from '../features/labor-accounting/laborAccountingDomain.js'
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient.js'

const SAFE_ERRORS = Object.freeze({
  ATTENDANCE_ACCOUNTING_VERSION_CONFLICT: '记录已被其他人更新，请刷新后重试',
  ATTENDANCE_ACCOUNTING_ALLOCATION_UNBALANCED: '项目分摊金额与确认人工成本不一致',
  ATTENDANCE_ACCOUNTING_SALARY_REQUIRED: '员工工资标准未设置，请先到人员管理补充',
  ATTENDANCE_ACCOUNTING_OPEN_SESSION: '员工仍在打卡中，暂不能确认当日核算',
  ATTENDANCE_ACCOUNTING_MONTH_INCOMPLETE: '本月仍有未处理考勤，暂不能确认工资',
  ATTENDANCE_ACCOUNTING_MONTH_LOCKED: '该月份工资已经确认，请先重新打开',
})

const ERROR_MESSAGES = Object.freeze({
  LABOR_ACCOUNTING_INVALID_INPUT: '人工核算请求参数无效',
  LABOR_ACCOUNTING_INVALID_RESPONSE: '人工核算服务返回了无效数据',
  LABOR_ACCOUNTING_NOT_CONFIGURED: '云端人工核算服务未配置',
  LABOR_ACCOUNTING_REQUEST_FAILED: '人工核算请求失败，请稍后重试',
  LABOR_ACCOUNTING_SERVICE_UNAVAILABLE: '人工核算服务暂不可用，请稍后重试',
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/u
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u
const INSTANT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u
const POSIX_EDGE_SPACE = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/gu
const MIN_YEAR = 1900
const MAX_YEAR = 2100
const MAX_IDENTIFIER_LENGTH = 500
const MAX_NOTE_LENGTH = 2000
const MAX_SEARCH_LENGTH = 200
const MAX_TIMESTAMP_LENGTH = 64
const MAX_ALLOCATIONS = 100

const RESOLUTION_TYPE_SET = new Set(ACCOUNTING_RESOLUTION_TYPES)
const ISSUE_CODE_SET = new Set(ATTENDANCE_ISSUE_CODES)
const ISSUE_ORDER = Object.freeze([
  'abnormal_location', 'missing_clock_in', 'missing_clock_out',
  'late', 'early', 'overtime_pending',
])
const DAY_STATUS_SET = new Set([
  'unconfigured', 'before_activation', 'full_day', 'half_day', 'rest',
  'leave', 'comp_time', 'absence', 'optional_not_worked',
  'missing_clock_in', 'not_started', 'working', 'completed',
])
const DAILY_UNITS = new Set([0, 0.5, 1])
const RESOLUTION_STATUS_SET = new Set(['draft', 'confirmed', 'month_locked'])
const PAYROLL_STATUS_SET = new Set(['draft', 'reopened', 'confirmed'])
const PAYROLL_ROW_STATUS_SET = new Set([
  'confirmed', 'salary_required', 'invalid_money', 'incomplete', 'ready',
])
const SALARY_TYPE_SET = new Set(['月薪', '日薪', '时薪', '未设置'])
const PROJECT_REPORT_STATUS_SET = new Set(['all', 'confirmed', 'pending'])
const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

const SETTINGS_KEYS = Object.freeze([
  'configured', 'effectiveFrom', 'workWeekdays', 'workStartTime',
  'workEndTime', 'breakMinutes', 'standardDayMinutes',
])
const EVENT_KEYS = Object.freeze([
  'eventId', 'eventType', 'serverRecordedAt', 'result', 'abnormalReason',
])
const SESSION_KEYS = Object.freeze([
  'sessionId', 'projectId', 'projectName', 'status', 'openedAt', 'closedAt',
  'clockInEvent', 'clockOutEvent',
])
const COMPACT_RESOLUTION_KEYS = Object.freeze([
  'resolutionId', 'resolutionType', 'attendanceUnits', 'accountingStatus',
  'scheduleRequired', 'resolutionNote', 'confirmedAt', 'version',
])
const DASHBOARD_EMPLOYEE_KEYS = Object.freeze([
  'employeeProfileId', 'employeeNumber', 'name', 'department', 'position',
  'scheduleRequired', 'dayStatus', 'issueCodes', 'firstClockInAt',
  'lastClockOutAt', 'hasOpenSession', 'hasAbnormalLocation',
  'workedMinutesReference', 'sessions', 'resolution',
])
const MONTHLY_EMPLOYEE_KEYS = Object.freeze([
  'employeeProfileId', 'employeeNumber', 'employeeName', 'department',
  'fullDays', 'halfDays', 'excusedDays', 'absenceDays', 'pendingDays',
  'issueCounts', 'status', 'payrollId', 'version',
])
const MONTHLY_MONEY_KEYS = Object.freeze([
  'salaryType', 'baseSalarySnapshot', 'basePay', 'overtimePay', 'bonus',
  'deduction', 'netSalary', 'projectAllocatedAmount',
  'projectUnallocatedAmount', 'confirmationNote', 'confirmedAt',
])

export class LaborAccountingServiceError extends Error {
  constructor(code, userMessage, cause) {
    super(userMessage)
    Object.defineProperty(this, 'name', {
      value: 'LaborAccountingServiceError', enumerable: false,
      configurable: true, writable: true,
    })
    this.code = code
    this.userMessage = userMessage
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        value: cause, enumerable: false, configurable: false, writable: false,
      })
    }
  }
}

function invalidInput(cause) {
  return new LaborAccountingServiceError(
    'LABOR_ACCOUNTING_INVALID_INPUT',
    ERROR_MESSAGES.LABOR_ACCOUNTING_INVALID_INPUT,
    cause,
  )
}

function invalidResponse(cause) {
  return new LaborAccountingServiceError(
    'LABOR_ACCOUNTING_INVALID_RESPONSE',
    ERROR_MESSAGES.LABOR_ACCOUNTING_INVALID_RESPONSE,
    cause,
  )
}

function fail(factory, cause) {
  throw factory(cause)
}

function ownDataValue(value, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value')
      ? descriptor.value
      : undefined
  } catch {
    return undefined
  }
}

function objectShape(value, expectedKeys, factory = invalidResponse) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return fail(factory)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return fail(factory)
    if (Object.getOwnPropertySymbols(value).length !== 0) return fail(factory)
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== expectedKeys.length) return fail(factory)
    const expected = new Set(expectedKeys)
    for (const name of names) {
      if (!expected.has(name) || POLLUTION_KEYS.has(name)) return fail(factory)
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
        return fail(factory)
      }
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) return fail(factory)
    }
    return value
  } catch (cause) {
    if (cause instanceof LaborAccountingServiceError) throw cause
    return fail(factory, cause)
  }
}

function arrayShape(value, factory = invalidResponse, { maxLength } = {}) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return fail(factory)
    }
    if (maxLength !== undefined && value.length > maxLength) return fail(factory)
    if (Object.getOwnPropertySymbols(value).length !== 0) return fail(factory)
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== value.length + 1 || names.at(-1) !== 'length') return fail(factory)
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return fail(factory)
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) return fail(factory)
    }
    return value
  } catch (cause) {
    if (cause instanceof LaborAccountingServiceError) throw cause
    return fail(factory, cause)
  }
}

function exactArguments(args, count) {
  if (args.length !== count) throw invalidInput()
}

function trimPosix(value) {
  return value.replace(POSIX_EDGE_SPACE, '')
}

function textValue(value, {
  factory = invalidResponse,
  min = 0,
  max = MAX_NOTE_LENGTH,
  trim = false,
  nullable = false,
  forbidPollution = false,
} = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string') return fail(factory)
  const normalized = trim ? trimPosix(value) : value
  if (normalized.length < min || normalized.length > max) return fail(factory)
  if (forbidPollution && POLLUTION_KEYS.has(normalized)) return fail(factory)
  return normalized
}

function identifier(value, options = {}) {
  return textValue(value, {
    max: MAX_IDENTIFIER_LENGTH,
    min: 1,
    trim: true,
    forbidPollution: true,
    ...options,
  })
}

function uuidValue(value, { factory = invalidResponse, nullable = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return fail(factory)
  return value
}

function dateParts(value, factory) {
  if (typeof value !== 'string') return fail(factory)
  const match = DATE_PATTERN.exec(value)
  if (!match) return fail(factory)
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < MIN_YEAR || year > MAX_YEAR) return fail(factory)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
      parsed.getUTCDate() !== day) return fail(factory)
  return { year, month, day }
}

function dateValue(value, { factory = invalidResponse, nullable = false } = {}) {
  if (nullable && value === null) return null
  dateParts(value, factory)
  return value
}

function monthValue(value, { factory = invalidResponse } = {}) {
  if (typeof value !== 'string') return fail(factory)
  const match = MONTH_PATTERN.exec(value)
  if (!match) return fail(factory)
  const year = Number(match[1])
  const month = Number(match[2])
  if (year < MIN_YEAR || year > MAX_YEAR || month < 1 || month > 12) return fail(factory)
  return value
}

function dtoMonth(value) {
  if (typeof value === 'string' && MONTH_PATTERN.test(value)) return monthValue(value)
  const parts = dateParts(value, invalidResponse)
  if (parts.day !== 1) throw invalidResponse()
  return value.slice(0, 7)
}

function dtoTrendMonth(value) {
  if (typeof value !== 'string') throw invalidResponse()
  const match = MONTH_PATTERN.exec(value)
  if (!match) throw invalidResponse()
  const year = Number(match[1])
  const month = Number(match[2])
  const monthIndex = year * 12 + month - 1
  const minimumIndex = (MIN_YEAR - 1) * 12 + 7
  const maximumIndex = MAX_YEAR * 12 + 11
  if (month < 1 || month > 12 || monthIndex < minimumIndex || monthIndex > maximumIndex) {
    throw invalidResponse()
  }
  return value
}

function minuteTime(value, { factory = invalidResponse } = {}) {
  if (typeof value !== 'string') return fail(factory)
  const match = TIME_PATTERN.exec(value)
  if (!match) return fail(factory)
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return fail(factory)
  return { value, minutes: hour * 60 + minute }
}

function instantValue(value, { nullable = false } = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'string' || value.length > MAX_TIMESTAMP_LENGTH) throw invalidResponse()
  const match = INSTANT_PATTERN.exec(value)
  if (!match) throw invalidResponse()
  dateParts(`${match[1]}-${match[2]}-${match[3]}`, invalidResponse)
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 ||
      !Number.isFinite(Date.parse(value))) throw invalidResponse()
  return value
}

function booleanValue(value, factory = invalidResponse) {
  if (typeof value !== 'boolean') return fail(factory)
  return value
}

function safeInteger(value, {
  factory = invalidResponse,
  min = 0,
  nullable = false,
} = {}) {
  if (nullable && value === null) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) ||
      Object.is(value, -0) || value < min) return fail(factory)
  return value
}

function yenValue(value, options = {}) {
  return safeInteger(value, options)
}

function halfUnits(value, { factory = invalidResponse } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Object.is(value, -0) ||
      value < 0 || !Number.isSafeInteger(value * 2)) return fail(factory)
  return value
}

function dailyUnits(value, factory = invalidResponse) {
  if (typeof value !== 'number' || Object.is(value, -0) || !DAILY_UNITS.has(value)) {
    return fail(factory)
  }
  return value
}

function enumValue(value, allowed, factory = invalidResponse) {
  if (typeof value !== 'string' || !allowed.has(value)) return fail(factory)
  return value
}

function validateStringArray(value, {
  factory = invalidResponse,
  allowed,
  exact,
  max = MAX_IDENTIFIER_LENGTH,
  allowEmpty = false,
} = {}) {
  const rows = arrayShape(value, factory)
  const result = []
  const seen = new Set()
  for (const row of rows) {
    const item = textValue(row, { factory, min: allowEmpty ? 0 : 1, max })
    if ((allowed && !allowed.has(item)) || seen.has(item)) return fail(factory)
    seen.add(item)
    result.push(item)
  }
  if (exact && (result.length !== exact.length || result.some((item, index) => item !== exact[index]))) {
    return fail(factory)
  }
  return result
}

function validateIssueCodes(value) {
  const result = validateStringArray(value, { allowed: ISSUE_CODE_SET })
  let previous = -1
  for (const code of result) {
    const index = ISSUE_ORDER.indexOf(code)
    if (index <= previous) throw invalidResponse()
    previous = index
  }
  return result
}

function validateSettings(value, { includeVersion = false } = {}) {
  const keys = includeVersion ? [...SETTINGS_KEYS, 'version'] : SETTINGS_KEYS
  const row = objectShape(value, keys)
  const configured = booleanValue(row.configured)
  const effectiveFrom = configured
    ? dateValue(row.effectiveFrom)
    : row.effectiveFrom === null ? null : fail(invalidResponse)
  const weekdays = arrayShape(row.workWeekdays)
  if (weekdays.length < 1 || weekdays.length > 7) throw invalidResponse()
  const workWeekdays = []
  const seen = new Set()
  let previous = 0
  for (const weekday of weekdays) {
    const parsed = safeInteger(weekday, { min: 1 })
    if (parsed > 7 || seen.has(parsed) || parsed <= previous) throw invalidResponse()
    seen.add(parsed)
    previous = parsed
    workWeekdays.push(parsed)
  }
  const start = minuteTime(row.workStartTime)
  const end = minuteTime(row.workEndTime)
  const breakMinutes = safeInteger(row.breakMinutes)
  const standardDayMinutes = safeInteger(row.standardDayMinutes, { min: 1 })
  const shiftMinutes = end.minutes - start.minutes
  if (shiftMinutes <= 0 || breakMinutes > 1439 || breakMinutes >= shiftMinutes ||
      standardDayMinutes > 1440 || standardDayMinutes > shiftMinutes - breakMinutes) {
    throw invalidResponse()
  }
  const result = {
    configured,
    effectiveFrom,
    workWeekdays,
    workStartTime: start.value,
    workEndTime: end.value,
    breakMinutes,
    standardDayMinutes,
  }
  if (includeVersion) {
    const version = safeInteger(row.version)
    if ((configured && version < 1) || (!configured && version !== 0)) throw invalidResponse()
    result.version = version
  }
  return result
}

function validateAttendanceEvent(value, expectedType) {
  const row = objectShape(value, EVENT_KEYS)
  const eventType = enumValue(row.eventType, new Set(['clock_in', 'clock_out']))
  if (eventType !== expectedType) throw invalidResponse()
  const result = enumValue(row.result, new Set(['normal', 'abnormal']))
  const abnormalReason = row.abnormalReason === null
    ? null
    : textValue(row.abnormalReason, { min: 1, max: MAX_NOTE_LENGTH })
  if ((result === 'normal' && abnormalReason !== null) ||
      (result === 'abnormal' && abnormalReason === null)) throw invalidResponse()
  return {
    eventId: uuidValue(row.eventId),
    eventType,
    serverRecordedAt: instantValue(row.serverRecordedAt),
    result,
    abnormalReason,
  }
}

function validateSession(value) {
  const row = objectShape(value, SESSION_KEYS)
  const status = enumValue(row.status, new Set(['open', 'closed']))
  const closedAt = instantValue(row.closedAt, { nullable: true })
  const clockInEvent = row.clockInEvent === null
    ? null
    : validateAttendanceEvent(row.clockInEvent, 'clock_in')
  const clockOutEvent = row.clockOutEvent === null
    ? null
    : validateAttendanceEvent(row.clockOutEvent, 'clock_out')
  if ((status === 'open' && (closedAt !== null || clockOutEvent !== null)) ||
      (status === 'closed' && closedAt === null)) {
    throw invalidResponse()
  }
  return {
    sessionId: uuidValue(row.sessionId),
    projectId: identifier(row.projectId),
    projectName: textValue(row.projectName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    status,
    openedAt: instantValue(row.openedAt),
    closedAt,
    clockInEvent,
    clockOutEvent,
  }
}

function validateSessions(value) {
  return arrayShape(value).map(validateSession)
}

function resolutionUnits(resolutionType, attendanceUnits, factory = invalidResponse) {
  const type = enumValue(resolutionType, RESOLUTION_TYPE_SET, factory)
  const units = dailyUnits(attendanceUnits, factory)
  const valid = (type === 'full_day' && units === 1) ||
    (type === 'half_day' && units === 0.5) ||
    (!['full_day', 'half_day'].includes(type) && units === 0)
  if (!valid) return fail(factory)
  return { resolutionType: type, attendanceUnits: units }
}

function validateCompactResolution(value) {
  const row = objectShape(value, COMPACT_RESOLUTION_KEYS)
  const typeAndUnits = resolutionUnits(row.resolutionType, row.attendanceUnits)
  const accountingStatus = enumValue(row.accountingStatus, RESOLUTION_STATUS_SET)
  const confirmedAt = instantValue(row.confirmedAt, { nullable: true })
  if ((accountingStatus === 'draft' && confirmedAt !== null) ||
      (accountingStatus !== 'draft' && confirmedAt === null)) throw invalidResponse()
  return {
    resolutionId: uuidValue(row.resolutionId),
    ...typeAndUnits,
    accountingStatus,
    scheduleRequired: booleanValue(row.scheduleRequired),
    resolutionNote: textValue(row.resolutionNote, { max: MAX_NOTE_LENGTH }),
    confirmedAt,
    version: safeInteger(row.version, { min: 1 }),
  }
}

function validateSalaryRates(row, keys) {
  const salaryType = enumValue(row.salaryType, SALARY_TYPE_SET)
  const baseSalary = yenValue(row[keys.base], { nullable: true })
  const dailySalary = yenValue(row[keys.daily], { nullable: true })
  const hourlyWage = yenValue(row[keys.hourly], { nullable: true })
  const valid = salaryType === '月薪'
    ? baseSalary !== null && dailySalary === null && hourlyWage === null
    : salaryType === '日薪'
      ? baseSalary === null && dailySalary !== null && hourlyWage === null
      : salaryType === '时薪'
        ? baseSalary === null && dailySalary === null && hourlyWage !== null
        : baseSalary === null && dailySalary === null && hourlyWage === null
  if (!valid) throw invalidResponse()
  return { salaryType, baseSalary, dailySalary, hourlyWage }
}

function validateDashboardSalary(value) {
  const row = objectShape(value, [
    'salaryType', 'baseSalary', 'dailySalary', 'hourlyWage', 'salaryRemark',
  ])
  return {
    ...validateSalaryRates(row, { base: 'baseSalary', daily: 'dailySalary', hourly: 'hourlyWage' }),
    salaryRemark: textValue(row.salaryRemark, { nullable: true, max: MAX_NOTE_LENGTH }),
  }
}

function validateDashboardEmployee(value, canViewSalary) {
  const keys = canViewSalary ? [...DASHBOARD_EMPLOYEE_KEYS, 'salary'] : DASHBOARD_EMPLOYEE_KEYS
  const row = objectShape(value, keys)
  const resolution = row.resolution === null ? null : validateCompactResolution(row.resolution)
  return {
    employeeProfileId: uuidValue(row.employeeProfileId),
    employeeNumber: textValue(row.employeeNumber, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    name: textValue(row.name, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    department: textValue(row.department, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    position: textValue(row.position, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    scheduleRequired: booleanValue(row.scheduleRequired),
    dayStatus: enumValue(row.dayStatus, DAY_STATUS_SET),
    issueCodes: validateIssueCodes(row.issueCodes),
    firstClockInAt: instantValue(row.firstClockInAt, { nullable: true }),
    lastClockOutAt: instantValue(row.lastClockOutAt, { nullable: true }),
    hasOpenSession: booleanValue(row.hasOpenSession),
    hasAbnormalLocation: booleanValue(row.hasAbnormalLocation),
    workedMinutesReference: safeInteger(row.workedMinutesReference, { nullable: true }),
    sessions: validateSessions(row.sessions),
    resolution,
    ...(canViewSalary ? { salary: validateDashboardSalary(row.salary) } : {}),
  }
}

function validateDailyDashboard(value) {
  const row = objectShape(value, [
    'workDate', 'serverNowTokyo', 'settings', 'permissions', 'summary',
    'filters', 'employees',
  ])
  const permissionRow = objectShape(row.permissions, [
    'canResolve', 'canViewSalary', 'canUpdateSalary', 'canViewProjectCosts',
    'canUpdateProjectCosts', 'canUpdateSettings',
  ])
  const permissions = {
    canResolve: booleanValue(permissionRow.canResolve),
    canViewSalary: booleanValue(permissionRow.canViewSalary),
    canUpdateSalary: booleanValue(permissionRow.canUpdateSalary),
    canViewProjectCosts: booleanValue(permissionRow.canViewProjectCosts),
    canUpdateProjectCosts: booleanValue(permissionRow.canUpdateProjectCosts),
    canUpdateSettings: booleanValue(permissionRow.canUpdateSettings),
  }
  if ((permissions.canUpdateSalary && (!permissions.canResolve || !permissions.canViewSalary)) ||
      (permissions.canUpdateProjectCosts && (!permissions.canResolve ||
        !permissions.canViewSalary || !permissions.canUpdateSalary ||
        !permissions.canViewProjectCosts))) {
    throw invalidResponse()
  }
  const summaryRow = objectShape(row.summary, [
    'totalEmployees', 'requiredEmployees', 'normalCompleted', 'working',
    'excused', 'alertCount', 'abnormalLocation', 'missingClockIn',
    'missingClockOut', 'late', 'early', 'overtimePending',
  ])
  const summary = Object.fromEntries(Object.keys(summaryRow).map((key) => [key, safeInteger(summaryRow[key])]))
  const filterRow = objectShape(row.filters, [
    'departments', 'projects', 'dayStatuses', 'issueCodes',
  ])
  const projects = arrayShape(filterRow.projects).map((project) => {
    const item = objectShape(project, ['projectId', 'projectName'])
    return {
      projectId: identifier(item.projectId),
      projectName: textValue(item.projectName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    }
  })
  const employees = arrayShape(row.employees).map((employee) =>
    validateDashboardEmployee(employee, permissions.canViewSalary))
  return {
    workDate: dateValue(row.workDate),
    serverNowTokyo: instantValue(row.serverNowTokyo),
    settings: validateSettings(row.settings),
    permissions,
    summary,
    filters: {
      departments: validateStringArray(filterRow.departments),
      projects,
      dayStatuses: validateStringArray(filterRow.dayStatuses, { allowed: DAY_STATUS_SET }),
      issueCodes: validateStringArray(filterRow.issueCodes, { exact: ISSUE_ORDER }),
    },
    employees,
  }
}

function validateAlertCount(value) {
  const row = objectShape(value, ['workDate', 'count', 'refreshedAt'])
  return {
    workDate: dateValue(row.workDate),
    count: safeInteger(row.count),
    refreshedAt: instantValue(row.refreshedAt),
  }
}

function validateResolutionFacts(value) {
  const row = objectShape(value, [
    'dayStatus', 'issueCodes', 'firstClockInAt', 'lastClockOutAt',
    'hasOpenSession', 'hasAbnormalLocation', 'workedMinutesReference', 'sessions',
  ])
  return {
    dayStatus: enumValue(row.dayStatus, DAY_STATUS_SET),
    issueCodes: validateIssueCodes(row.issueCodes),
    firstClockInAt: instantValue(row.firstClockInAt, { nullable: true }),
    lastClockOutAt: instantValue(row.lastClockOutAt, { nullable: true }),
    hasOpenSession: booleanValue(row.hasOpenSession),
    hasAbnormalLocation: booleanValue(row.hasAbnormalLocation),
    workedMinutesReference: safeInteger(row.workedMinutesReference, { nullable: true }),
    sessions: validateSessions(row.sessions),
  }
}

function validateResolutionSalary(value, canViewProjectCosts) {
  const row = objectShape(value, [
    'salaryType', 'baseSalary', 'dailySalary', 'hourlyWage', 'suggestedProjectCost',
  ])
  const result = validateSalaryRates(row, {
    base: 'baseSalary', daily: 'dailySalary', hourly: 'hourlyWage',
  })
  const suggestedProjectCost = canViewProjectCosts
    ? yenValue(row.suggestedProjectCost)
    : row.suggestedProjectCost === null ? null : fail(invalidResponse)
  return { ...result, suggestedProjectCost }
}

function validateDetailedResolution(value, canViewSalary, canViewProjectCosts) {
  const moneyKeys = [
    'salaryTypeSnapshot', 'baseSalarySnapshot', 'dailySalarySnapshot',
    'hourlyWageSnapshot', 'suggestedProjectCost', 'finalProjectCost',
  ]
  const row = objectShape(value, canViewSalary
    ? [...COMPACT_RESOLUTION_KEYS, ...moneyKeys]
    : COMPACT_RESOLUTION_KEYS)
  const compact = validateCompactResolution(Object.fromEntries(
    COMPACT_RESOLUTION_KEYS.map((key) => [key, row[key]]),
  ))
  if (!canViewSalary) return compact
  const snapshot = validateSalaryRates({
    salaryType: row.salaryTypeSnapshot,
    baseSalarySnapshot: row.baseSalarySnapshot,
    dailySalarySnapshot: row.dailySalarySnapshot,
    hourlyWageSnapshot: row.hourlyWageSnapshot,
  }, {
    base: 'baseSalarySnapshot', daily: 'dailySalarySnapshot', hourly: 'hourlyWageSnapshot',
  })
  const suggestedProjectCost = canViewProjectCosts
    ? yenValue(row.suggestedProjectCost)
    : row.suggestedProjectCost === null ? null : fail(invalidResponse)
  const finalProjectCost = canViewProjectCosts
    ? yenValue(row.finalProjectCost)
    : row.finalProjectCost === null ? null : fail(invalidResponse)
  return {
    ...compact,
    salaryTypeSnapshot: snapshot.salaryType,
    baseSalarySnapshot: snapshot.baseSalary,
    dailySalarySnapshot: snapshot.dailySalary,
    hourlyWageSnapshot: snapshot.hourlyWage,
    suggestedProjectCost,
    finalProjectCost,
  }
}

function validateResolutionDetail(value) {
  const row = objectShape(value, [
    'employee', 'workDate', 'scheduleRequired', 'facts', 'permissions',
    'salary', 'resolution', 'allocations',
  ])
  const employeeRow = objectShape(row.employee, [
    'employeeProfileId', 'employeeNumber', 'employeeName', 'department', 'position',
  ])
  const permissionRow = objectShape(row.permissions, [
    'canResolve', 'canViewSalary', 'canViewProjectCosts', 'canUpdateProjectCosts',
  ])
  const permissions = {
    canResolve: booleanValue(permissionRow.canResolve),
    canViewSalary: booleanValue(permissionRow.canViewSalary),
    canViewProjectCosts: booleanValue(permissionRow.canViewProjectCosts),
    canUpdateProjectCosts: booleanValue(permissionRow.canUpdateProjectCosts),
  }
  if (permissions.canUpdateProjectCosts && (!permissions.canResolve ||
      !permissions.canViewSalary || !permissions.canViewProjectCosts)) throw invalidResponse()
  const salary = permissions.canViewSalary
    ? validateResolutionSalary(row.salary, permissions.canViewProjectCosts)
    : row.salary === null ? null : fail(invalidResponse)
  const resolution = row.resolution === null
    ? null
    : validateDetailedResolution(
      row.resolution, permissions.canViewSalary, permissions.canViewProjectCosts,
    )
  const moneyVisible = permissions.canViewSalary && permissions.canViewProjectCosts
  const allocations = arrayShape(row.allocations).map((allocation) => {
    const item = objectShape(allocation, moneyVisible
      ? ['allocationId', 'projectId', 'projectName', 'amount', 'allocationNote']
      : ['allocationId', 'projectId', 'projectName', 'allocationNote'])
    return {
      allocationId: uuidValue(item.allocationId),
      projectId: identifier(item.projectId),
      projectName: textValue(item.projectName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      ...(moneyVisible ? { amount: yenValue(item.amount) } : {}),
      allocationNote: textValue(item.allocationNote, { max: MAX_NOTE_LENGTH }),
    }
  })
  if (resolution === null && allocations.length !== 0) throw invalidResponse()
  return {
    employee: {
      employeeProfileId: uuidValue(employeeRow.employeeProfileId),
      employeeNumber: textValue(employeeRow.employeeNumber, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      employeeName: textValue(employeeRow.employeeName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      department: textValue(employeeRow.department, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      position: textValue(employeeRow.position, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    },
    workDate: dateValue(row.workDate),
    scheduleRequired: booleanValue(row.scheduleRequired),
    facts: validateResolutionFacts(row.facts),
    permissions,
    salary,
    resolution,
    allocations,
  }
}

function validateIssueCounts(value) {
  const row = objectShape(value, ['late', 'early', 'abnormalLocation', 'overtimePending'])
  return {
    late: safeInteger(row.late),
    early: safeInteger(row.early),
    abnormalLocation: safeInteger(row.abnormalLocation),
    overtimePending: safeInteger(row.overtimePending),
  }
}

function validateMonthlyEmployee(value, canViewSalary) {
  const legacy = value !== null && typeof value === 'object' && ownDataValue(value, 'source') !== undefined
  const keys = [
    ...(legacy ? ['source'] : []),
    ...MONTHLY_EMPLOYEE_KEYS,
    ...(canViewSalary ? MONTHLY_MONEY_KEYS : []),
  ]
  const row = objectShape(value, keys)
  const employeeProfileId = legacy
    ? row.employeeProfileId === null ? null : fail(invalidResponse)
    : uuidValue(row.employeeProfileId)
  const status = enumValue(row.status, PAYROLL_ROW_STATUS_SET)
  const payrollId = uuidValue(row.payrollId, { nullable: true })
  const version = safeInteger(row.version)
  if (legacy && (row.source !== 'legacy' || status !== 'confirmed' || payrollId !== null || version !== 0)) {
    throw invalidResponse()
  }
  if (!legacy && status === 'confirmed' && payrollId === null) throw invalidResponse()
  if (payrollId === null && version !== 0) throw invalidResponse()
  if (payrollId !== null && version < 1) throw invalidResponse()
  const result = {
    ...(legacy ? { source: 'legacy' } : {}),
    employeeProfileId,
    employeeNumber: textValue(row.employeeNumber, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    employeeName: textValue(row.employeeName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    department: textValue(row.department, { max: MAX_IDENTIFIER_LENGTH }),
    fullDays: safeInteger(row.fullDays),
    halfDays: safeInteger(row.halfDays),
    excusedDays: safeInteger(row.excusedDays),
    absenceDays: safeInteger(row.absenceDays),
    pendingDays: safeInteger(row.pendingDays),
    issueCounts: validateIssueCounts(row.issueCounts),
    status,
    payrollId,
    version,
  }
  if (canViewSalary) {
    const salaryType = enumValue(row.salaryType, SALARY_TYPE_SET)
    const basePay = yenValue(row.basePay, { nullable: true })
    const netSalary = yenValue(row.netSalary, { nullable: true })
    if (['invalid_money', 'salary_required'].includes(status) && netSalary !== null) {
      throw invalidResponse()
    }
    if (!['invalid_money', 'salary_required'].includes(status) && (basePay === null || netSalary === null)) {
      throw invalidResponse()
    }
    const confirmedAt = instantValue(row.confirmedAt, { nullable: true })
    if ((!legacy && status === 'confirmed' && confirmedAt === null) ||
        (status !== 'confirmed' && confirmedAt !== null)) throw invalidResponse()
    Object.assign(result, {
      salaryType,
      baseSalarySnapshot: yenValue(row.baseSalarySnapshot),
      basePay,
      overtimePay: yenValue(row.overtimePay),
      bonus: yenValue(row.bonus),
      deduction: yenValue(row.deduction),
      netSalary,
      projectAllocatedAmount: yenValue(row.projectAllocatedAmount),
      projectUnallocatedAmount: yenValue(row.projectUnallocatedAmount),
      confirmationNote: textValue(row.confirmationNote, { max: MAX_NOTE_LENGTH }),
      confirmedAt,
    })
  }
  return result
}

function validateMonthlyPayroll(value) {
  const row = objectShape(value, [
    'salaryMonth', 'permissions', 'summary', 'employees', 'reconciliation',
  ])
  const permissionRow = objectShape(row.permissions, ['canViewSalary', 'canUpdateSalary'])
  const permissions = {
    canViewSalary: booleanValue(permissionRow.canViewSalary),
    canUpdateSalary: booleanValue(permissionRow.canUpdateSalary),
  }
  if (permissions.canUpdateSalary && !permissions.canViewSalary) throw invalidResponse()
  const summaryKeys = [
    'employeeCount', 'confirmedFullDays', 'confirmedHalfDays',
    'absenceDays', 'pendingCount',
  ]
  const moneyKeys = [
    'salaryPreviewTotal', 'projectAllocatedTotal', 'projectUnallocatedTotal',
  ]
  const summaryRow = objectShape(row.summary, permissions.canViewSalary
    ? [...summaryKeys, ...moneyKeys]
    : summaryKeys)
  const summary = {
    employeeCount: safeInteger(summaryRow.employeeCount),
    confirmedFullDays: safeInteger(summaryRow.confirmedFullDays),
    confirmedHalfDays: safeInteger(summaryRow.confirmedHalfDays),
    absenceDays: safeInteger(summaryRow.absenceDays),
    pendingCount: safeInteger(summaryRow.pendingCount),
    ...(permissions.canViewSalary ? {
      salaryPreviewTotal: yenValue(summaryRow.salaryPreviewTotal),
      projectAllocatedTotal: yenValue(summaryRow.projectAllocatedTotal),
      projectUnallocatedTotal: yenValue(summaryRow.projectUnallocatedTotal),
    } : {}),
  }
  const employees = arrayShape(row.employees).map((employee) =>
    validateMonthlyEmployee(employee, permissions.canViewSalary))
  if (summary.employeeCount !== employees.length) throw invalidResponse()
  return {
    salaryMonth: dtoMonth(row.salaryMonth),
    permissions,
    summary,
    employees,
    reconciliation: validateReconciliation(row.reconciliation),
  }
}

function validatePayrollResult(value) {
  const row = objectShape(value, ['employee', 'payroll'])
  const employeeRow = objectShape(row.employee, [
    'employeeProfileId', 'employeeNumber', 'employeeName', 'department',
  ])
  const baseKeys = [
    'payrollId', 'salaryMonth', 'fullDays', 'halfDays', 'absenceDays',
    'status', 'confirmedAt', 'version',
  ]
  const moneyKeys = [
    'salaryTypeSnapshot', 'baseSalarySnapshot', 'basePay', 'overtimePay',
    'bonus', 'deduction', 'netSalary', 'confirmationNote',
  ]
  const hasMoney = ownDataValue(row.payroll, 'salaryTypeSnapshot') !== undefined
  const payrollRow = objectShape(row.payroll, hasMoney ? [...baseKeys, ...moneyKeys] : baseKeys)
  const status = enumValue(payrollRow.status, PAYROLL_STATUS_SET)
  const confirmedAt = instantValue(payrollRow.confirmedAt, { nullable: true })
  if ((status === 'confirmed' && confirmedAt === null) ||
      (status !== 'confirmed' && confirmedAt !== null)) throw invalidResponse()
  const payroll = {
    payrollId: uuidValue(payrollRow.payrollId),
    salaryMonth: dtoMonth(payrollRow.salaryMonth),
    fullDays: safeInteger(payrollRow.fullDays),
    halfDays: safeInteger(payrollRow.halfDays),
    absenceDays: safeInteger(payrollRow.absenceDays),
    status,
    confirmedAt,
    version: safeInteger(payrollRow.version, { min: 1 }),
  }
  if (hasMoney) {
    Object.assign(payroll, {
      salaryTypeSnapshot: enumValue(payrollRow.salaryTypeSnapshot, SALARY_TYPE_SET),
      baseSalarySnapshot: yenValue(payrollRow.baseSalarySnapshot),
      basePay: yenValue(payrollRow.basePay),
      overtimePay: yenValue(payrollRow.overtimePay),
      bonus: yenValue(payrollRow.bonus),
      deduction: yenValue(payrollRow.deduction),
      netSalary: yenValue(payrollRow.netSalary),
      confirmationNote: textValue(payrollRow.confirmationNote, { max: MAX_NOTE_LENGTH }),
    })
  }
  return {
    employee: {
      employeeProfileId: uuidValue(employeeRow.employeeProfileId),
      employeeNumber: textValue(employeeRow.employeeNumber, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      employeeName: textValue(employeeRow.employeeName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      department: textValue(employeeRow.department, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    },
    payroll,
  }
}

function validateReconciliation(value) {
  const row = objectShape(value, ['postActivationLegacyRows', 'globalMalformedLegacyRows'])
  return {
    postActivationLegacyRows: safeInteger(row.postActivationLegacyRows),
    globalMalformedLegacyRows: safeInteger(row.globalMalformedLegacyRows),
  }
}

function validateProjectDetail(value, statusFilter) {
  const row = objectShape(value, [
    'source', 'sourceKey', 'workDate', 'projectId', 'projectName',
    'employeeProfileId', 'employeeNumber', 'employeeName', 'attendanceUnits',
    'amount', 'accountingStatus',
  ])
  const source = enumValue(row.source, new Set(['legacy', 'attendance']))
  const accountingStatus = enumValue(
    row.accountingStatus,
    new Set(['legacy', 'confirmed', 'month_locked', 'draft']),
  )
  if ((statusFilter === 'confirmed' && accountingStatus === 'draft') ||
      (statusFilter === 'pending' && accountingStatus !== 'draft')) throw invalidResponse()
  if ((source === 'legacy' && accountingStatus !== 'legacy') ||
      (source === 'attendance' && accountingStatus === 'legacy')) throw invalidResponse()
  const unallocated = source === 'attendance' && accountingStatus === 'draft' && row.projectId === null
  let projectId
  if (unallocated) {
    projectId = null
    if (row.projectName !== '未分摊' || typeof row.sourceKey !== 'string' ||
        !row.sourceKey.startsWith('draft-unallocated:') ||
        !UUID_PATTERN.test(row.sourceKey.slice('draft-unallocated:'.length))) {
      throw invalidResponse()
    }
  } else {
    projectId = identifier(row.projectId)
  }
  const sourceKey = textValue(row.sourceKey, { min: 1, max: MAX_NOTE_LENGTH })
  if (source === 'attendance' && !unallocated && !UUID_PATTERN.test(sourceKey)) throw invalidResponse()
  const employeeProfileId = source === 'attendance'
    ? uuidValue(row.employeeProfileId)
    : uuidValue(row.employeeProfileId, { nullable: true })
  return {
    source,
    sourceKey,
    workDate: dateValue(row.workDate),
    projectId,
    projectName: textValue(row.projectName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
    employeeProfileId,
    employeeNumber: textValue(row.employeeNumber, { max: MAX_IDENTIFIER_LENGTH }),
    employeeName: textValue(row.employeeName, { max: MAX_IDENTIFIER_LENGTH }),
    attendanceUnits: dailyUnits(row.attendanceUnits),
    amount: yenValue(row.amount),
    accountingStatus,
  }
}

function validateProjectReport(value, statusFilter) {
  const row = objectShape(value, [
    'salaryMonth', 'permissions', 'summary', 'trend', 'employeeComposition',
    'dailyDetails', 'projectComparison', 'reconciliation',
  ])
  const permissionRow = objectShape(row.permissions, [
    'canViewSalary', 'canViewEmployeeComposition',
  ])
  const permissions = {
    canViewSalary: booleanValue(permissionRow.canViewSalary),
    canViewEmployeeComposition: booleanValue(permissionRow.canViewEmployeeComposition),
  }
  if (permissions.canViewSalary !== permissions.canViewEmployeeComposition) throw invalidResponse()
  const summaryRow = objectShape(row.summary, [
    'monthlyConfirmedCost', 'lifetimeConfirmedCost', 'confirmedAttendanceUnits',
    'pendingAllocationCount', 'pendingAllocationAmount',
  ])
  const trendRows = arrayShape(row.trend)
  if (trendRows.length !== 6) throw invalidResponse()
  const trend = trendRows.map((item) => {
    const trendRow = objectShape(item, ['salaryMonth', 'amount'])
    return { salaryMonth: dtoTrendMonth(trendRow.salaryMonth), amount: yenValue(trendRow.amount) }
  })
  const compositionRows = arrayShape(row.employeeComposition)
  const detailRows = arrayShape(row.dailyDetails)
  if (!permissions.canViewSalary && (compositionRows.length !== 0 || detailRows.length !== 0)) {
    throw invalidResponse()
  }
  const employeeComposition = compositionRows.map((item) => {
    const composition = objectShape(item, [
      'employeeProfileId', 'employeeNumber', 'employeeName', 'attendanceUnits', 'amount',
    ])
    return {
      employeeProfileId: uuidValue(composition.employeeProfileId, { nullable: true }),
      employeeNumber: textValue(composition.employeeNumber, { max: MAX_IDENTIFIER_LENGTH }),
      employeeName: textValue(composition.employeeName, { max: MAX_IDENTIFIER_LENGTH }),
      attendanceUnits: halfUnits(composition.attendanceUnits),
      amount: yenValue(composition.amount),
    }
  })
  const dailyDetails = detailRows.map((item) => validateProjectDetail(item, statusFilter))
  const projectComparison = arrayShape(row.projectComparison).map((item) => {
    const comparison = objectShape(item, [
      'projectId', 'projectName', 'monthlyConfirmedCost', 'lifetimeConfirmedCost',
    ])
    return {
      projectId: identifier(comparison.projectId),
      projectName: textValue(comparison.projectName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      monthlyConfirmedCost: yenValue(comparison.monthlyConfirmedCost),
      lifetimeConfirmedCost: yenValue(comparison.lifetimeConfirmedCost),
    }
  })
  return {
    salaryMonth: dtoMonth(row.salaryMonth),
    permissions,
    summary: {
      monthlyConfirmedCost: yenValue(summaryRow.monthlyConfirmedCost),
      lifetimeConfirmedCost: yenValue(summaryRow.lifetimeConfirmedCost),
      confirmedAttendanceUnits: halfUnits(summaryRow.confirmedAttendanceUnits),
      pendingAllocationCount: safeInteger(summaryRow.pendingAllocationCount),
      pendingAllocationAmount: yenValue(summaryRow.pendingAllocationAmount),
    },
    trend,
    employeeComposition,
    dailyDetails,
    projectComparison,
    reconciliation: validateReconciliation(row.reconciliation),
  }
}

function validateProjectExport(value) {
  return arrayShape(value).map((item) => {
    const row = objectShape(item, [
      'projectName', 'workDate', 'employeeNumber', 'employeeName',
      'attendanceUnits', 'amount', 'accountingStatus', 'source',
    ])
    const source = enumValue(row.source, new Set(['legacy', 'attendance']))
    const accountingStatus = enumValue(
      row.accountingStatus, new Set(['legacy', 'confirmed', 'month_locked']),
    )
    if ((source === 'legacy') !== (accountingStatus === 'legacy')) throw invalidResponse()
    return {
      projectName: textValue(row.projectName, { min: 1, max: MAX_IDENTIFIER_LENGTH }),
      workDate: dateValue(row.workDate),
      employeeNumber: textValue(row.employeeNumber, { max: MAX_IDENTIFIER_LENGTH }),
      employeeName: textValue(row.employeeName, { max: MAX_IDENTIFIER_LENGTH }),
      attendanceUnits: dailyUnits(row.attendanceUnits),
      amount: yenValue(row.amount),
      accountingStatus,
      source,
    }
  })
}

function validateProjectMap(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse()
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw invalidResponse()
    if (Object.getOwnPropertySymbols(value).length !== 0) throw invalidResponse()
    const result = {}
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || POLLUTION_KEYS.has(key) ||
          identifier(key) !== key) throw invalidResponse()
      result[key] = yenValue(descriptor.value)
    }
    for (const key in value) {
      if (!Object.hasOwn(value, key)) throw invalidResponse()
    }
    return result
  } catch (cause) {
    if (cause instanceof LaborAccountingServiceError) throw cause
    throw invalidResponse(cause)
  }
}

function validateBridgeSummary(value) {
  const row = objectShape(value, [
    'salaryMonth', 'isAuthoritative', 'salaryTotal', 'projectLaborTotal',
    'projectLaborById', 'pendingCount', 'effectiveFrom',
  ])
  return {
    salaryMonth: dtoMonth(row.salaryMonth),
    isAuthoritative: booleanValue(row.isAuthoritative),
    salaryTotal: yenValue(row.salaryTotal),
    projectLaborTotal: yenValue(row.projectLaborTotal),
    projectLaborById: validateProjectMap(row.projectLaborById),
    pendingCount: safeInteger(row.pendingCount),
    effectiveFrom: dateValue(row.effectiveFrom, { nullable: true }),
  }
}

function inputObject(value, keys) {
  return objectShape(value, keys, invalidInput)
}

function inputUuid(value, { nullable = false } = {}) {
  return uuidValue(value, { factory: invalidInput, nullable })
}

function inputDate(value) {
  return dateValue(value, { factory: invalidInput })
}

function inputMonth(value) {
  return monthValue(value, { factory: invalidInput })
}

function inputText(value, options = {}) {
  return textValue(value, { factory: invalidInput, trim: true, ...options })
}

function inputIdentifier(value, { nullable = false } = {}) {
  if (nullable && value === null) return null
  return identifier(value, { factory: invalidInput })
}

function inputInteger(value, { min = 0 } = {}) {
  return safeInteger(value, { factory: invalidInput, min })
}

function inputYen(value) {
  return yenValue(value, { factory: invalidInput })
}

function validateResolutionInput(value, { requireBalance = false } = {}) {
  const row = inputObject(value, [
    'employeeProfileId', 'workDate', 'resolutionType', 'attendanceUnits',
    'finalProjectCost', 'allocations', 'resolutionNote', 'version',
  ])
  const typeAndUnits = resolutionUnits(row.resolutionType, row.attendanceUnits, invalidInput)
  const finalProjectCost = inputYen(row.finalProjectCost)
  const allocationRows = arrayShape(row.allocations, invalidInput, { maxLength: MAX_ALLOCATIONS })
  const seen = new Set()
  let allocatedTotal = 0
  const allocations = allocationRows.map((allocation) => {
    const item = inputObject(allocation, ['projectId', 'amount', 'allocationNote'])
    const projectId = inputIdentifier(item.projectId)
    if (seen.has(projectId)) throw invalidInput()
    seen.add(projectId)
    const amount = inputYen(item.amount)
    allocatedTotal += amount
    if (!Number.isSafeInteger(allocatedTotal)) throw invalidInput()
    return {
      projectId,
      amount,
      allocationNote: inputText(item.allocationNote, { max: MAX_NOTE_LENGTH }),
    }
  })
  if (requireBalance && allocatedTotal !== finalProjectCost) throw invalidInput()
  return {
    employeeProfileId: inputUuid(row.employeeProfileId),
    workDate: inputDate(row.workDate),
    ...typeAndUnits,
    finalProjectCost,
    allocations,
    resolutionNote: inputText(row.resolutionNote, { max: MAX_NOTE_LENGTH }),
    version: inputInteger(row.version),
  }
}

function validatePayrollInput(value) {
  const row = inputObject(value, [
    'employeeProfileId', 'month', 'overtimePay', 'bonus', 'deduction',
    'confirmationNote', 'version',
  ])
  return {
    employeeProfileId: inputUuid(row.employeeProfileId),
    month: inputMonth(row.month),
    overtimePay: inputYen(row.overtimePay),
    bonus: inputYen(row.bonus),
    deduction: inputYen(row.deduction),
    confirmationNote: inputText(row.confirmationNote, { max: MAX_NOTE_LENGTH }),
    version: inputInteger(row.version),
  }
}

function validateSettingsInput(value) {
  const row = inputObject(value, [
    'effectiveFrom', 'workWeekdays', 'workStartTime', 'workEndTime',
    'breakMinutes', 'standardDayMinutes', 'version',
  ])
  const weekdayRows = arrayShape(row.workWeekdays, invalidInput)
  if (weekdayRows.length < 1 || weekdayRows.length > 7) throw invalidInput()
  const seen = new Set()
  const workWeekdays = weekdayRows.map((weekday) => {
    const parsed = inputInteger(weekday, { min: 1 })
    if (parsed > 7 || seen.has(parsed)) throw invalidInput()
    seen.add(parsed)
    return parsed
  })
  const start = minuteTime(row.workStartTime, { factory: invalidInput })
  const end = minuteTime(row.workEndTime, { factory: invalidInput })
  const breakMinutes = inputInteger(row.breakMinutes)
  const standardDayMinutes = inputInteger(row.standardDayMinutes, { min: 1 })
  const shiftMinutes = end.minutes - start.minutes
  if (shiftMinutes <= 0 || breakMinutes > 1439 || breakMinutes >= shiftMinutes ||
      standardDayMinutes > 1440 || standardDayMinutes > shiftMinutes - breakMinutes) {
    throw invalidInput()
  }
  return {
    effectiveFrom: inputDate(row.effectiveFrom),
    workWeekdays,
    workStartTime: start.value,
    workEndTime: end.value,
    breakMinutes,
    standardDayMinutes,
    version: inputInteger(row.version),
  }
}

function remoteError(cause) {
  const hint = cause !== null && (typeof cause === 'object' || typeof cause === 'function')
    ? ownDataValue(cause, 'hint')
    : undefined
  if (typeof hint === 'string' && Object.hasOwn(SAFE_ERRORS, hint)) {
    return new LaborAccountingServiceError(hint, SAFE_ERRORS[hint], cause)
  }
  return new LaborAccountingServiceError(
    'LABOR_ACCOUNTING_SERVICE_UNAVAILABLE',
    ERROR_MESSAGES.LABOR_ACCOUNTING_SERVICE_UNAVAILABLE,
    cause,
  )
}

function requestFailed(cause) {
  return new LaborAccountingServiceError(
    'LABOR_ACCOUNTING_REQUEST_FAILED',
    ERROR_MESSAGES.LABOR_ACCOUNTING_REQUEST_FAILED,
    cause,
  )
}

function responsePair(value) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalidResponse()
    const dataDescriptor = Object.getOwnPropertyDescriptor(value, 'data')
    const errorDescriptor = Object.getOwnPropertyDescriptor(value, 'error')
    if (!dataDescriptor || !Object.hasOwn(dataDescriptor, 'value') ||
        !errorDescriptor || !Object.hasOwn(errorDescriptor, 'value')) throw invalidResponse()
    return { data: dataDescriptor.value, error: errorDescriptor.value }
  } catch (cause) {
    if (cause instanceof LaborAccountingServiceError) throw cause
    throw invalidResponse(cause)
  }
}

function factoryConfiguration(client, options) {
  if (options === undefined) {
    return client === supabase ? isSupabaseConfigured : client !== null && client !== undefined
  }
  const row = objectShape(options, ['configured'], invalidInput)
  return booleanValue(row.configured, invalidInput)
}

export function createLaborAccountingService(client = supabase, options) {
  const configured = factoryConfiguration(client, options)
  const ensureClient = () => {
    if (!configured || client === null || client === undefined) {
      throw new LaborAccountingServiceError(
        'LABOR_ACCOUNTING_NOT_CONFIGURED',
        ERROR_MESSAGES.LABOR_ACCOUNTING_NOT_CONFIGURED,
      )
    }
    let rpc
    try {
      rpc = client.rpc
    } catch (cause) {
      throw requestFailed(cause)
    }
    if (typeof rpc !== 'function') {
      throw new LaborAccountingServiceError(
        'LABOR_ACCOUNTING_NOT_CONFIGURED',
        ERROR_MESSAGES.LABOR_ACCOUNTING_NOT_CONFIGURED,
      )
    }
    return rpc
  }
  const call = async (name, args = {}) => {
    const rpc = ensureClient()
    let raw
    try {
      raw = await Reflect.apply(rpc, client, [name, args])
    } catch (cause) {
      throw remoteError(cause)
    }
    const pair = responsePair(raw)
    if (pair.error !== null) throw remoteError(pair.error)
    if (pair.data === null || pair.data === undefined) throw invalidResponse()
    return pair.data
  }

  return Object.freeze({
    async getAlertCount() {
      exactArguments(arguments, 0)
      return validateAlertCount(await call('get_labor_alert_count_secure'))
    },
    async listDailyDashboard(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, ['workDate'])
      const workDate = inputDate(row.workDate)
      return validateDailyDashboard(await call(
        'list_daily_attendance_dashboard_secure', { p_work_date: workDate },
      ))
    },
    async getResolutionDetail(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, ['employeeProfileId', 'workDate'])
      return validateResolutionDetail(await call('get_attendance_resolution_detail_secure', {
        p_employee_profile_id: inputUuid(row.employeeProfileId),
        p_work_date: inputDate(row.workDate),
      }))
    },
    async saveResolutionDraft(input) {
      exactArguments(arguments, 1)
      const row = validateResolutionInput(input)
      return validateResolutionDetail(await call('save_attendance_resolution_draft_secure', {
        p_employee_profile_id: row.employeeProfileId,
        p_work_date: row.workDate,
        p_resolution_type: row.resolutionType,
        p_attendance_units: row.attendanceUnits,
        p_final_project_cost: row.finalProjectCost,
        p_allocations: row.allocations,
        p_resolution_note: row.resolutionNote,
        p_version: row.version,
      }))
    },
    async confirmResolution(input) {
      exactArguments(arguments, 1)
      const row = validateResolutionInput(input, { requireBalance: true })
      return validateResolutionDetail(await call('confirm_attendance_resolution_secure', {
        p_employee_profile_id: row.employeeProfileId,
        p_work_date: row.workDate,
        p_resolution_type: row.resolutionType,
        p_attendance_units: row.attendanceUnits,
        p_final_project_cost: row.finalProjectCost,
        p_allocations: row.allocations,
        p_resolution_note: row.resolutionNote,
        p_version: row.version,
      }))
    },
    async listMonthlyPayroll(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, [
        'month', 'department', 'employeeProfileId', 'onlyPending',
      ])
      const month = inputMonth(row.month)
      return validateMonthlyPayroll(await call('list_monthly_payroll_secure', {
        p_month: `${month}-01`,
        p_search: inputText(row.department, { max: MAX_SEARCH_LENGTH }),
        p_employee_profile_id: inputUuid(row.employeeProfileId, { nullable: true }),
        p_only_pending: booleanValue(row.onlyPending, invalidInput),
      }))
    },
    async saveMonthlyPayrollDraft(input) {
      exactArguments(arguments, 1)
      const row = validatePayrollInput(input)
      return validatePayrollResult(await call('save_monthly_payroll_draft_secure', {
        p_employee_profile_id: row.employeeProfileId,
        p_month: `${row.month}-01`,
        p_overtime_pay: row.overtimePay,
        p_bonus: row.bonus,
        p_deduction: row.deduction,
        p_confirmation_note: row.confirmationNote,
        p_version: row.version,
      }))
    },
    async confirmMonthlyPayroll(input) {
      exactArguments(arguments, 1)
      const row = validatePayrollInput(input)
      return validatePayrollResult(await call('confirm_monthly_payroll_secure', {
        p_employee_profile_id: row.employeeProfileId,
        p_month: `${row.month}-01`,
        p_overtime_pay: row.overtimePay,
        p_bonus: row.bonus,
        p_deduction: row.deduction,
        p_confirmation_note: row.confirmationNote,
        p_version: row.version,
      }))
    },
    async reopenMonthlyPayroll(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, ['payrollId', 'reason', 'version'])
      return validatePayrollResult(await call('reopen_monthly_payroll_secure', {
        p_payroll_id: inputUuid(row.payrollId),
        p_reason: inputText(row.reason, { min: 1, max: MAX_NOTE_LENGTH }),
        p_version: inputInteger(row.version),
      }))
    },
    async listProjectLaborCosts(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, ['month', 'projectId', 'employeeProfileId', 'status'])
      const month = inputMonth(row.month)
      const status = enumValue(
        inputText(row.status, { min: 1, max: 20 }), PROJECT_REPORT_STATUS_SET, invalidInput,
      )
      return validateProjectReport(await call('list_project_labor_costs_secure', {
        p_month: `${month}-01`,
        p_status: status,
        p_employee_profile_id: inputUuid(row.employeeProfileId, { nullable: true }),
        p_project_id: inputIdentifier(row.projectId, { nullable: true }),
      }), status)
    },
    async exportProjectLaborCosts(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, ['month', 'projectId', 'employeeProfileId'])
      const month = inputMonth(row.month)
      return validateProjectExport(await call('export_project_labor_costs_secure', {
        p_month: `${month}-01`,
        p_project_id: inputIdentifier(row.projectId, { nullable: true }),
        p_employee_profile_id: inputUuid(row.employeeProfileId, { nullable: true }),
      }))
    },
    async getSettings() {
      exactArguments(arguments, 0)
      return validateSettings(await call('get_attendance_accounting_settings_secure'), {
        includeVersion: true,
      })
    },
    async updateSettings(input) {
      exactArguments(arguments, 1)
      const row = validateSettingsInput(input)
      return validateSettings(await call('update_attendance_accounting_settings_secure', {
        p_effective_from: row.effectiveFrom,
        p_work_weekdays: row.workWeekdays,
        p_work_start_time: row.workStartTime,
        p_work_end_time: row.workEndTime,
        p_break_minutes: row.breakMinutes,
        p_standard_day_minutes: row.standardDayMinutes,
        p_version: row.version,
      }), { includeVersion: true })
    },
    async getBridgeSummary(input) {
      exactArguments(arguments, 1)
      const row = inputObject(input, ['month'])
      const month = inputMonth(row.month)
      return validateBridgeSummary(await call('get_attendance_accounting_bridge_secure', {
        p_month: `${month}-01`,
      }))
    },
  })
}

export const laborAccountingService = createLaborAccountingService()

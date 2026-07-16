export const ACCOUNTING_RESOLUTION_TYPES = Object.freeze([
  'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence',
])

export const ATTENDANCE_ISSUE_CODES = Object.freeze([
  'missing_clock_in', 'late', 'early', 'missing_clock_out',
  'abnormal_location', 'overtime_pending',
])

const ISSUE_ORDER = Object.freeze([
  'abnormal_location', 'missing_clock_in', 'missing_clock_out',
  'late', 'early', 'overtime_pending',
])
const FINAL_ACCOUNTING_STATUSES = new Set(['confirmed', 'month_locked'])
const RESOLUTION_TYPE_SET = new Set(ACCOUNTING_RESOLUTION_TYPES)
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u
const TIME_PATTERN = /^(\d{2}):(\d{2})$/u

const yen = (value) => Math.round(Number(value) || 0)
const units = (fullDays, halfDays) =>
  (Number(fullDays) || 0) + (Number(halfDays) || 0) * 0.5

function validIsoDate(value) {
  const match = ISO_DATE_PATTERN.exec(String(value ?? ''))
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
}

function isoWeekday(workDate) {
  const [year, month, day] = workDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() || 7
}

function shiftInstant(workDate, time) {
  const match = TIME_PATTERN.exec(String(time ?? ''))
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  const timestamp = Date.parse(`${workDate}T${time}:00+09:00`)
  return Number.isFinite(timestamp) ? timestamp : null
}

function instant(value) {
  if (typeof value !== 'string' || !value) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

function sessionStart(session) {
  return instant(
    session?.openedAt ??
    session?.clockInAt ??
    session?.clockInEvent?.serverRecordedAt,
  )
}

function sessionEnd(session) {
  return instant(
    session?.closedAt ??
    session?.clockOutAt ??
    session?.clockOutEvent?.serverRecordedAt,
  )
}

function hasAbnormalLocation(session) {
  const events = [
    session?.clockInEvent,
    session?.clockOutEvent,
    ...(Array.isArray(session?.events) ? session.events : []),
  ]
  return events.some((event) => event?.result === 'abnormal')
}

function inactiveClassification(dayStatus) {
  return { scheduleRequired: false, dayStatus, issueCodes: [] }
}

export function classifyAttendanceDay({
  workDate,
  nowTokyo,
  settings,
  sessions = [],
  resolution = null,
} = {}) {
  if (!validIsoDate(workDate) ||
      settings?.configured === false ||
      !validIsoDate(settings?.effectiveFrom)) {
    return inactiveClassification('unconfigured')
  }
  if (workDate < settings.effectiveFrom) {
    return inactiveClassification('before_activation')
  }

  const weekday = isoWeekday(workDate)
  const scheduleRequired = Array.isArray(settings.workWeekdays) &&
    settings.workWeekdays.includes(weekday)
  const resolutionType = resolution?.resolutionType
  if (FINAL_ACCOUNTING_STATUSES.has(resolution?.accountingStatus) &&
      RESOLUTION_TYPE_SET.has(resolutionType)) {
    return { scheduleRequired, dayStatus: resolutionType, issueCodes: [] }
  }

  const workSessions = Array.isArray(sessions) ? sessions : []
  const starts = workSessions.map(sessionStart).filter((value) => value !== null)
  const shiftStart = shiftInstant(workDate, settings.workStartTime)
  const shiftEnd = shiftInstant(workDate, settings.workEndTime)
  const now = instant(nowTokyo)

  if (starts.length === 0) {
    if (!scheduleRequired) return inactiveClassification('optional_not_worked')
    const missingClockIn = shiftStart !== null && now !== null && now > shiftStart
    return {
      scheduleRequired,
      dayStatus: missingClockIn ? 'missing_clock_in' : 'not_started',
      issueCodes: missingClockIn ? ['missing_clock_in'] : [],
    }
  }

  const ends = workSessions.map(sessionEnd).filter((value) => value !== null)
  const firstClockIn = Math.min(...starts)
  const lastClockOut = ends.length > 0 ? Math.max(...ends) : null
  const hasOpenSession = workSessions.some((session) =>
    sessionStart(session) !== null && sessionEnd(session) === null
  )
  const facts = new Set()

  if (workSessions.some(hasAbnormalLocation)) facts.add('abnormal_location')
  if (hasOpenSession && shiftEnd !== null && now !== null && now > shiftEnd) {
    facts.add('missing_clock_out')
  }
  if (scheduleRequired && shiftStart !== null && firstClockIn > shiftStart) {
    facts.add('late')
  }
  if (scheduleRequired && !hasOpenSession &&
      shiftEnd !== null && lastClockOut !== null && lastClockOut < shiftEnd) {
    facts.add('early')
  }

  const referenceEnd = hasOpenSession ? now : lastClockOut
  const breakMinutes = Number(settings.breakMinutes)
  const standardDayMinutes = Number(settings.standardDayMinutes)
  if (referenceEnd !== null && referenceEnd >= firstClockIn &&
      Number.isFinite(breakMinutes) && breakMinutes >= 0 &&
      Number.isFinite(standardDayMinutes) && standardDayMinutes >= 0 &&
      (referenceEnd - firstClockIn) / 60000 - breakMinutes > standardDayMinutes) {
    facts.add('overtime_pending')
  }

  return {
    scheduleRequired,
    dayStatus: hasOpenSession ? 'working' : 'completed',
    issueCodes: ISSUE_ORDER.filter((code) => facts.has(code)),
  }
}

export function calculatePayrollPreview(input) {
  const attendanceUnits = units(input.fullDays, input.halfDays)
  const basePay = input.salaryType === '月薪'
    ? yen(input.baseSalary)
    : input.salaryType === '日薪'
      ? yen(attendanceUnits * (Number(input.dailySalary) || 0))
      : input.salaryType === '时薪'
        ? yen(((Number(input.fullDays) || 0) * 8 + (Number(input.halfDays) || 0) * 4) *
          (Number(input.hourlyWage) || 0))
        : 0
  const netSalary = basePay + yen(input.overtimePay) + yen(input.bonus) - yen(input.deduction)
  return { attendanceUnits, basePay, netSalary, valid: netSalary >= 0 }
}

export function suggestProjectCost(input) {
  const fullDay = input.salaryType === '月薪'
    ? yen((Number(input.baseSalary) || 0) / 24)
    : input.salaryType === '日薪'
      ? yen(input.dailySalary)
      : input.salaryType === '时薪'
        ? yen((Number(input.hourlyWage) || 0) * 8)
        : 0
  return yen(fullDay * Number(input.attendanceUnits || 0))
}

export function validateProjectAllocations({ finalProjectCost, allocations }) {
  const duplicate = new Set(allocations.map((item) => item.projectId)).size !== allocations.length
  const invalid = allocations.some((item) =>
    !item.projectId || !Number.isInteger(Number(item.amount)) || Number(item.amount) < 0
  )
  const allocatedTotal = allocations.reduce((total, item) => total + Number(item.amount || 0), 0)
  const difference = yen(finalProjectCost) - allocatedTotal
  return { valid: !duplicate && !invalid && difference === 0, allocatedTotal, difference }
}

const PROJECT_LABOR_CSV_COLUMNS = Object.freeze([
  ['项目', 'projectName'],
  ['日期', 'workDate'],
  ['员工编号', 'employeeNumber'],
  ['员工姓名', 'employeeName'],
  ['确认人天', 'attendanceUnits'],
  ['分摊金额', 'amount'],
  ['状态', 'accountingStatus'],
])

function escapeCsv(value) {
  const text = String(value ?? '')
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function buildProjectLaborCsv(rows) {
  const header = PROJECT_LABOR_CSV_COLUMNS.map(([label]) => escapeCsv(label)).join(',')
  const body = (Array.isArray(rows) ? rows : []).map((row) =>
    PROJECT_LABOR_CSV_COLUMNS.map(([, key]) =>
      escapeCsv(key === 'amount' ? yen(row?.[key]) : row?.[key])
    ).join(',')
  )
  return `\uFEFF${[header, ...body].join('\r\n')}`
}

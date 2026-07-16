const BRIDGE_PERMISSION_KEYS = Object.freeze([
  'module.labor.view',
  'sensitive.salary_view',
  'module.project_costs.view',
])

const BRIDGE_KEYS = Object.freeze([
  'salaryMonth',
  'isAuthoritative',
  'salaryTotal',
  'projectLaborTotal',
  'projectLaborById',
  'projectLaborLifetimeTotal',
  'projectLaborLifetimeById',
  'pendingCount',
  'effectiveFrom',
])

const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u
const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/u
const POSIX_EDGE_SPACE = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/gu
const MIN_YEAR = 1900
const MAX_YEAR = 2100
const MAX_IDENTIFIER_LENGTH = 500

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyDataProperties(value, expectedKeys) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return false
  const names = Object.getOwnPropertyNames(value)
  if (names.length !== expectedKeys.length) return false
  const expected = new Set(expectedKeys)
  return names.every((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return expected.has(name) && descriptor?.enumerable === true &&
      Object.hasOwn(descriptor, 'value')
  })
}

function isSafeYen(value) {
  return Number.isSafeInteger(value) && !Object.is(value, -0) && value >= 0
}

function isBusinessMonth(value) {
  if (typeof value !== 'string' || !MONTH_PATTERN.test(value)) return false
  const year = Number(value.slice(0, 4))
  return year >= MIN_YEAR && year <= MAX_YEAR
}

export function isLaborAccountingMonth(value) {
  return isBusinessMonth(value)
}

function isIsoDate(value) {
  if (value === null) return true
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < MIN_YEAR || year > MAX_YEAR) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
}

function normalizeProjectMap(value) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return null
  const result = {}
  let total = 0

  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      POLLUTION_KEYS.has(key) ||
      key.replace(POSIX_EDGE_SPACE, '') !== key ||
      key.length === 0 ||
      key.length > MAX_IDENTIFIER_LENGTH ||
      !isSafeYen(descriptor.value) ||
      descriptor.value > Number.MAX_SAFE_INTEGER - total
    ) return null
    result[key] = descriptor.value
    total += descriptor.value
  }

  for (const key in value) {
    if (!Object.hasOwn(value, key)) return null
  }

  return { map: result, total }
}

export function canRequestLaborAccountingBridge({
  actorKey,
  effectivePermissionKeys,
} = {}) {
  if (typeof actorKey !== 'string' || actorKey.trim().length === 0) return false
  if (!Array.isArray(effectivePermissionKeys)) return false
  const permissionSet = new Set(effectivePermissionKeys.filter((key) => typeof key === 'string'))
  return permissionSet.has('all') || BRIDGE_PERMISSION_KEYS.every((key) => permissionSet.has(key))
}

export function normalizeBridgeSummary(value) {
  try {
    if (!hasOnlyDataProperties(value, BRIDGE_KEYS)) return null
    if (!isBusinessMonth(value.salaryMonth)) return null
    if (typeof value.isAuthoritative !== 'boolean') return null
    if (!isSafeYen(value.salaryTotal) || !isSafeYen(value.projectLaborTotal)) return null
    if (!isSafeYen(value.projectLaborLifetimeTotal) || !isSafeYen(value.pendingCount)) return null
    if (!isIsoDate(value.effectiveFrom)) return null
    const shouldBeAuthoritative = value.effectiveFrom !== null &&
      value.salaryMonth >= value.effectiveFrom.slice(0, 7)
    if (value.isAuthoritative !== shouldBeAuthoritative) return null
    if (!value.isAuthoritative && value.pendingCount !== 0) return null

    const monthly = normalizeProjectMap(value.projectLaborById)
    const lifetime = normalizeProjectMap(value.projectLaborLifetimeById)
    if (!monthly || !lifetime) return null
    if (monthly.total !== value.projectLaborTotal) return null
    if (lifetime.total !== value.projectLaborLifetimeTotal) return null
    if (lifetime.total < monthly.total) return null
    for (const [projectId, monthlyAmount] of Object.entries(monthly.map)) {
      if (!Object.hasOwn(lifetime.map, projectId)) return null
      if (lifetime.map[projectId] < monthlyAmount) return null
    }

    return {
      salaryMonth: value.salaryMonth,
      isAuthoritative: value.isAuthoritative,
      salaryTotal: value.salaryTotal,
      projectLaborTotal: value.projectLaborTotal,
      projectLaborById: monthly.map,
      projectLaborLifetimeTotal: value.projectLaborLifetimeTotal,
      projectLaborLifetimeById: lifetime.map,
      pendingCount: value.pendingCount,
      effectiveFrom: value.effectiveFrom,
    }
  } catch {
    return null
  }
}

function sameMonthBridge(month, bridge) {
  if (!isBusinessMonth(month)) return null
  const normalized = normalizeBridgeSummary(bridge)
  return normalized?.salaryMonth === month ? normalized : null
}

export function resolveMonthlySalaryTotal({ month, legacyTotal, bridge }) {
  const normalized = sameMonthBridge(month, bridge)
  return normalized?.isAuthoritative === true ? normalized.salaryTotal : legacyTotal
}

export function resolveMonthlyProjectLaborTotal({ month, legacyTotal, bridge }) {
  const normalized = sameMonthBridge(month, bridge)
  return normalized?.isAuthoritative === true ? normalized.projectLaborTotal : legacyTotal
}

export function resolveProjectLaborTotal({ month, projectId, legacyTotal, bridge }) {
  const normalized = sameMonthBridge(month, bridge)
  if (!normalized) return legacyTotal
  if (typeof projectId !== 'string') return 0
  return Object.hasOwn(normalized.projectLaborLifetimeById, projectId)
    ? normalized.projectLaborLifetimeById[projectId]
    : 0
}

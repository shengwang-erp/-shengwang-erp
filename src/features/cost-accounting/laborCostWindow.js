import {
  normalizeBridgeSummary,
  resolveMonthlyProjectLaborTotal,
  resolveMonthlySalaryTotal,
} from '../labor-accounting/laborAccountingBridge.js'
import { monthOfDate, normalizeMonth } from '../executive-dashboard/dashboardTime.js'

const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])

function safeYen(value) {
  const amount = Number(value)
  return Number.isSafeInteger(amount) && amount >= 0 && !Object.is(amount, -0) ? amount : 0
}

function safeOwnValue(value, key) {
  if (value === null || typeof value !== 'object') return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function sameMonthBridge(data, month) {
  const candidate = safeOwnValue(data, month)
  const normalized = normalizeBridgeSummary(candidate)
  return normalized?.salaryMonth === month ? normalized : null
}

function isHiddenEmployee(employee) {
  return safeOwnValue(employee, 'employeeId') === 'SUPER_ADMIN' ||
    safeOwnValue(employee, 'isHiddenSystemAccount') === true ||
    safeOwnValue(employee, 'name') === '超级管理员'
}

function legacySalaryTotal(month, salaryRecords, employees) {
  const rows = salaryRecords.filter((record) => safeOwnValue(record, 'salaryMonth') === month)
  if (rows.length > 0) {
    return rows.reduce((total, record) => total + safeYen(safeOwnValue(record, 'netSalary')), 0)
  }
  return employees
    .filter((employee) => !isHiddenEmployee(employee) &&
      safeOwnValue(employee, 'employmentStatus') === '在职' &&
      safeOwnValue(employee, 'salaryType') === '月薪')
    .reduce((total, employee) => total + safeYen(safeOwnValue(employee, 'baseSalary')), 0)
}

function laborProjectMap(laborRecords, month = null) {
  const totals = new Map()
  for (const record of laborRecords) {
    const workDate = safeOwnValue(record, 'workDate')
    const workMonth = monthOfDate(workDate)
    if (!workMonth || (month !== null && workMonth !== month)) continue
    const projectId = safeOwnValue(record, 'projectId')
    if (typeof projectId !== 'string' || projectId.length === 0 || POLLUTION_KEYS.has(projectId)) continue
    const amount = safeYen(safeOwnValue(record, 'laborCost'))
    const next = (totals.get(projectId) || 0) + amount
    if (Number.isSafeInteger(next)) totals.set(projectId, next)
  }
  return Object.fromEntries(totals)
}

function projectMapTotal(projectMap) {
  return Object.values(projectMap).reduce((total, amount) => total + amount, 0)
}

function inputSnapshot(input) {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError()
    }
    const prototype = Object.getPrototypeOf(input)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError()
    const snapshot = {}
    for (const key of [
      'months', 'snapshotMonth', 'bridgeState', 'salaryRecords', 'employees', 'laborRecords',
    ]) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key)
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError()
      }
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch (cause) {
    throw new TypeError('input must use required own data fields', { cause })
  }
}

function validateInput(input) {
  const snapshot = inputSnapshot(input)
  const { months, snapshotMonth, bridgeState, salaryRecords, employees, laborRecords } = snapshot
  if (!Array.isArray(months) || months.length === 0 ||
      months.some((month) => normalizeMonth(month) !== month) ||
      new Set(months).size !== months.length) throw new TypeError('months are invalid')
  if (normalizeMonth(snapshotMonth) !== snapshotMonth) throw new TypeError('snapshotMonth is invalid')
  if (bridgeState === null || typeof bridgeState !== 'object' || Array.isArray(bridgeState)) {
    throw new TypeError('bridgeState is invalid')
  }
  if (safeOwnValue(bridgeState, 'snapshotMonth') !== snapshotMonth) {
    throw new TypeError('bridgeState snapshotMonth is invalid')
  }
  if (![salaryRecords, employees, laborRecords].every(Array.isArray)) {
    throw new TypeError('legacy records must be arrays')
  }
  return snapshot
}

export function buildLaborCostWindow(input) {
  const snapshot = validateInput(input)
  const {
    months,
    snapshotMonth,
    bridgeState,
    salaryRecords,
    employees,
    laborRecords,
  } = snapshot
  const data = safeOwnValue(bridgeState, 'data')
  const incompleteMonths = safeOwnValue(bridgeState, 'windowIncompleteMonths')
  const staleMonths = safeOwnValue(bridgeState, 'windowStaleMonths')
  if (data === null || typeof data !== 'object' || !Array.isArray(incompleteMonths) ||
      !Array.isArray(staleMonths)) throw new TypeError('bridgeState is invalid')
  const staleSet = new Set(staleMonths)

  const monthly = months.map((month) => {
    const bridge = sameMonthBridge(data, month)
    if (!bridge) {
      return {
        month,
        status: 'error',
        stale: false,
        salaryTotal: null,
        projectLaborTotal: null,
        projectLaborById: null,
        source: null,
        pendingCount: null,
      }
    }

    if (bridge.isAuthoritative) {
      return {
        month,
        status: 'ready',
        stale: staleSet.has(month),
        salaryTotal: resolveMonthlySalaryTotal({ month, legacyTotal: 0, bridge }),
        projectLaborTotal: resolveMonthlyProjectLaborTotal({ month, legacyTotal: 0, bridge }),
        projectLaborById: { ...bridge.projectLaborById },
        source: 'formal',
        pendingCount: bridge.pendingCount,
      }
    }

    const legacyProjectLaborById = laborProjectMap(laborRecords, month)
    const legacyProjectLaborTotal = projectMapTotal(legacyProjectLaborById)
    return {
      month,
      status: 'ready',
      stale: staleSet.has(month),
      salaryTotal: resolveMonthlySalaryTotal({
        month,
        legacyTotal: legacySalaryTotal(month, salaryRecords, employees),
        bridge,
      }),
      projectLaborTotal: resolveMonthlyProjectLaborTotal({
        month,
        legacyTotal: legacyProjectLaborTotal,
        bridge,
      }),
      projectLaborById: legacyProjectLaborById,
      source: 'legacy',
      pendingCount: bridge.pendingCount,
    }
  })

  const snapshotBridge = sameMonthBridge(data, snapshotMonth)
  let projectLaborLifetimeById = null
  let lifetimeStatus = 'error'
  let lifetimeStale = false
  if (snapshotBridge) {
    projectLaborLifetimeById = snapshotBridge.isAuthoritative
      ? { ...snapshotBridge.projectLaborLifetimeById }
      : laborProjectMap(laborRecords)
    lifetimeStatus = 'ready'
    lifetimeStale = safeOwnValue(bridgeState, 'snapshotStale') === true
  }

  return {
    monthly,
    projectLaborLifetimeById,
    lifetimeStatus,
    lifetimeStale,
    incompleteMonths: [...incompleteMonths],
    staleMonths: [...staleMonths],
  }
}

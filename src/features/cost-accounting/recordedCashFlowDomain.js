import { monthOfDate, normalizeMonth } from '../executive-dashboard/dashboardTime.js'
import {
  PURCHASE_PAYMENT_CASH_SCHEMA,
  VEHICLE_EXPENSE_CASH_SCHEMA,
  VEHICLE_FUEL_CASH_SCHEMA,
  isLegacyInferredCashFact,
  isRecordedCashFact,
} from './cashFactProvenance.js'

const POLLUTION_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const POSIX_EDGE_SPACE = /^[\u0009-\u000d\u0020]+|[\u0009-\u000d\u0020]+$/gu
const MAX_IDENTIFIER_LENGTH = 500
const MALFORMED_ROW = Symbol('malformed-row')

const INPUT_KEYS = Object.freeze([
  'months',
  'projectId',
  'activeProjectIds',
  'receipts',
  'purchasePaymentRows',
  'fuelRecords',
  'vehicleExpenseRecords',
  'laborWindow',
  'operatingExpenses',
  'manualProjectCosts',
  'vehicleIssueRecords',
])

const LABOR_WINDOW_KEYS = Object.freeze([
  'monthly',
  'projectLaborLifetimeById',
  'lifetimeStatus',
  'lifetimeStale',
  'incompleteMonths',
  'staleMonths',
])

const COVERAGE_DEFINITIONS = Object.freeze([
  Object.freeze({
    code: 'salary_payment_missing',
    label: '工资付款日期未记录',
    note: '工资仅进入权责成本，不推测付款日期。',
  }),
  Object.freeze({
    code: 'operating_payment_missing',
    label: '经营费用付款事实未记录',
    note: '经营费用仅有发生日期，不进入已记录现金流。',
  }),
  Object.freeze({
    code: 'manual_payment_missing',
    label: '手工项目成本付款事实未记录',
    note: '手工项目成本没有付款状态，不进入已记录现金流。',
  }),
  Object.freeze({
    code: 'repair_payment_missing',
    label: '维修估算付款事实未记录',
    note: '车辆异常维修金额仅为估算，不进入已记录现金流。',
  }),
  Object.freeze({
    code: 'historical_default_ambiguity',
    label: '历史现金来源存在兼容推断',
    note: '旧记录的日期或付款方式来源无法反向确认。',
  }),
  Object.freeze({
    code: 'missing_payment_date',
    label: '付款日期或方式缺少已记录来源',
    note: '兼容默认日期或付款方式不具备现金资格。',
  }),
])

function isPlainRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function exactSnapshot(value, expectedKeys, message) {
  try {
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) {
      throw new TypeError()
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== expectedKeys.length) throw new TypeError()
    const expected = new Set(expectedKeys)
    const snapshot = {}
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)
      if (!expected.has(name) || descriptor?.enumerable !== true ||
          !Object.hasOwn(descriptor, 'value')) throw new TypeError()
      snapshot[name] = descriptor.value
    }
    return snapshot
  } catch (cause) {
    throw new TypeError(message, { cause })
  }
}

function snapshotArray(value, name) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      Object.getOwnPropertySymbols(value).length !== 0) {
    throw new TypeError(`${name} must be a plain array`)
  }
  const names = Object.getOwnPropertyNames(value)
  if (names.some((key) => key !== 'length' && !/^(?:0|[1-9]\d*)$/u.test(key))) {
    throw new TypeError(`${name} must not contain expanded properties`)
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') ||
      !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
    throw new TypeError(`${name} has an invalid length`)
  }
  const length = lengthDescriptor.value
  const entries = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    entries.push(
      descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
        ? descriptor.value
        : MALFORMED_ROW,
    )
  }
  return entries
}

function safeYen(value) {
  return typeof value === 'number' && Number.isFinite(value) &&
    Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0)
    ? value
    : null
}

function safeOwnValue(value, key) {
  if (!isPlainRecord(value)) return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function isSafeRow(value) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return false
  try {
    return Object.getOwnPropertyNames(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    })
  } catch {
    return false
  }
}

function validIdentifier(value) {
  return typeof value === 'string' && value.length > 0 &&
    value.length <= MAX_IDENTIFIER_LENGTH && value.replace(POSIX_EDGE_SPACE, '') === value &&
    !POLLUTION_KEYS.has(value)
}

function isInactive(row) {
  if (safeOwnValue(row, 'deleted') === true || safeOwnValue(row, 'isDeleted') === true) return true
  const statuses = [
    safeOwnValue(row, 'status'),
    safeOwnValue(row, 'statusCode'),
    safeOwnValue(row, 'recordStatus'),
  ]
  return statuses.some((value) => {
    if (typeof value !== 'string') return false
    const normalized = value.toLowerCase()
    return normalized === 'void' || normalized === 'deleted' || normalized === 'inactive' ||
      value === '作废' || value === '已删除'
  })
}

function anomaly(anomalies, source, recordId, code, message) {
  anomalies.push({ source, recordId, code, message })
}

function collectActiveRows(rows, { source, idFields, anomalies }) {
  const seen = new Set()
  const collected = []
  rows.forEach((row, index) => {
    const fallbackId = `row-${index + 1}`
    if (row === MALFORMED_ROW || !isSafeRow(row)) {
      anomaly(anomalies, source, fallbackId, 'malformed_row', '记录必须使用普通自有数据字段。')
      return
    }
    let recordId
    for (const field of idFields) {
      const candidate = safeOwnValue(row, field)
      if (candidate !== undefined && candidate !== null && candidate !== '') {
        recordId = candidate
        break
      }
    }
    if (recordId === undefined || recordId === null || recordId === '') {
      anomaly(anomalies, source, fallbackId, 'missing_record_id', '记录缺少稳定标识。')
      return
    }
    if (!validIdentifier(recordId)) {
      anomaly(anomalies, source, fallbackId, 'invalid_record_id', '记录标识无效。')
      return
    }
    if (seen.has(recordId)) {
      anomaly(anomalies, source, recordId, 'duplicate_record_id', '重复记录已忽略。')
      return
    }
    seen.add(recordId)
    if (isInactive(row)) {
      anomaly(anomalies, source, recordId, 'inactive_record', '作废或已删除记录已忽略。')
      return
    }
    collected.push({ row, recordId })
  })
  return collected
}

function normalizeInput(input) {
  const snapshot = exactSnapshot(input, INPUT_KEYS, 'cash-flow input must use exact own data fields')
  const months = snapshotArray(snapshot.months, 'months')
  const activeProjectIds = snapshotArray(snapshot.activeProjectIds, 'activeProjectIds')
  if (months.length === 0 || months.some((month) => normalizeMonth(month) !== month) ||
      new Set(months).size !== months.length) throw new TypeError('months are invalid')
  if (activeProjectIds.some((id) => !validIdentifier(id)) ||
      activeProjectIds.includes('all') ||
      new Set(activeProjectIds).size !== activeProjectIds.length) {
    throw new TypeError('activeProjectIds are invalid')
  }
  if (snapshot.projectId !== 'all' && !activeProjectIds.includes(snapshot.projectId)) {
    throw new TypeError('projectId is invalid')
  }
  const laborWindow = exactSnapshot(
    snapshot.laborWindow,
    LABOR_WINDOW_KEYS,
    'laborWindow must use exact own data fields',
  )
  return {
    ...snapshot,
    months,
    activeProjectIds,
    laborWindow: {
      ...laborWindow,
      monthly: snapshotArray(laborWindow.monthly, 'laborWindow.monthly'),
      incompleteMonths: snapshotArray(laborWindow.incompleteMonths, 'laborWindow.incompleteMonths'),
      staleMonths: snapshotArray(laborWindow.staleMonths, 'laborWindow.staleMonths'),
    },
    receipts: snapshotArray(snapshot.receipts, 'receipts'),
    purchasePaymentRows: snapshotArray(snapshot.purchasePaymentRows, 'purchasePaymentRows'),
    fuelRecords: snapshotArray(snapshot.fuelRecords, 'fuelRecords'),
    vehicleExpenseRecords: snapshotArray(snapshot.vehicleExpenseRecords, 'vehicleExpenseRecords'),
    operatingExpenses: snapshotArray(snapshot.operatingExpenses, 'operatingExpenses'),
    manualProjectCosts: snapshotArray(snapshot.manualProjectCosts, 'manualProjectCosts'),
    vehicleIssueRecords: snapshotArray(snapshot.vehicleIssueRecords, 'vehicleIssueRecords'),
  }
}

function projectRelation(row, activeProjects, anomalies, source, recordId) {
  const projectId = safeOwnValue(row, 'projectId')
  if (projectId === undefined || projectId === null || projectId === '') {
    anomaly(anomalies, source, recordId, 'missing_project', '记录缺少项目归属。')
    return null
  }
  if (!validIdentifier(projectId) || !activeProjects.has(projectId)) {
    anomaly(anomalies, source, recordId, 'invalid_project', '记录项目归属无效或已失效。')
    return null
  }
  return projectId
}

function validAmount(row, field, anomalies, source, recordId) {
  const amount = safeYen(safeOwnValue(row, field))
  if (amount === null) {
    anomaly(anomalies, source, recordId, 'invalid_amount', '金额必须是有限、安全、非负整数日元。')
    return null
  }
  return amount
}

function safeProjectMap(value) {
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return null
  const result = new Map()
  try {
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value') ||
          !validIdentifier(key) || safeYen(descriptor.value) === null) return null
      result.set(key, descriptor.value)
    }
    return result
  } catch {
    return null
  }
}

function provenanceSnapshot(row, schema) {
  const snapshot = {}
  for (const key of [
    schema.dateField,
    schema.dateSourceField,
    schema.dateLegacyField,
    schema.methodField,
    schema.methodSourceField,
    schema.methodLegacyField,
  ]) {
    if (key) snapshot[key] = safeOwnValue(row, key)
  }
  return snapshot
}

function vehicleProjectScope(row, normalized, activeProjects, anomalies, source, recordId) {
  if (safeOwnValue(row, 'allocateToProject') === true) {
    const projectId = projectRelation(row, activeProjects, anomalies, source, recordId)
    if (!projectId) return false
    return normalized.projectId === 'all' || normalized.projectId === projectId
  }
  if (safeOwnValue(row, 'projectId')) {
    anomaly(anomalies, source, recordId, 'ignored_project_fields', '未启用项目分摊，项目字段已忽略。')
  }
  return normalized.projectId === 'all'
}

function companyFactProjectScope(row, normalized, activeProjects, anomalies, source, recordId) {
  if (safeOwnValue(row, 'allocateToProject') === true) {
    const projectId = projectRelation(row, activeProjects, anomalies, source, recordId)
    return normalized.projectId === 'all' || projectId === normalized.projectId
  }
  if (safeOwnValue(row, 'projectId')) {
    anomaly(anomalies, source, recordId, 'ignored_project_fields', '未启用项目分摊，项目字段已忽略。')
  }
  return normalized.projectId === 'all'
}

function exactProjectScope(row, normalized, activeProjects, anomalies, source, recordId) {
  const projectId = projectRelation(row, activeProjects, anomalies, source, recordId)
  if (!projectId) return false
  return normalized.projectId === 'all' || normalized.projectId === projectId
}

function addCash(row, category, amount, anomalies, source, recordId) {
  if (category === 'income') {
    if (row.income > Number.MAX_SAFE_INTEGER - amount) {
      anomaly(anomalies, source, recordId, 'amount_overflow', '现金累计超出安全整数范围。')
      return false
    }
    row.income += amount
    return true
  }
  if (row[category] > Number.MAX_SAFE_INTEGER - amount ||
      row.totalOutflow > Number.MAX_SAFE_INTEGER - amount) {
    anomaly(anomalies, source, recordId, 'amount_overflow', '现金累计超出安全整数范围。')
    return false
  }
  row[category] += amount
  row.totalOutflow += amount
  return true
}

function coverageModel(counts) {
  return COVERAGE_DEFINITIONS.map((entry) => ({
    code: entry.code,
    label: entry.label,
    excludedCount: counts[entry.code],
    note: entry.note,
  }))
}

export function buildRecordedCashFlow(input) {
  const normalized = normalizeInput(input)
  const anomalies = []
  const monthSet = new Set(normalized.months)
  const activeProjects = new Set(normalized.activeProjectIds)
  const monthly = new Map(normalized.months.map((month) => [month, {
    month,
    income: 0,
    purchaseOutflow: 0,
    vehicleOutflow: 0,
    totalOutflow: 0,
  }]))
  const coverageCounts = Object.fromEntries(
    COVERAGE_DEFINITIONS.map(({ code }) => [code, 0]),
  )

  for (const { row, recordId } of collectActiveRows(normalized.receipts, {
    source: 'receipts', idFields: ['receiptId'], anomalies,
  })) {
    const amount = validAmount(row, 'taxInclusiveAmount', anomalies, 'receipts', recordId)
    if (amount === null) continue
    const month = monthOfDate(safeOwnValue(row, 'receivedDate'))
    if (!month) {
      anomaly(anomalies, 'receipts', recordId, 'invalid_date', '收款日期无效。')
      continue
    }
    if (!exactProjectScope(row, normalized, activeProjects, anomalies, 'receipts', recordId)) continue
    if (monthSet.has(month)) addCash(monthly.get(month), 'income', amount, anomalies, 'receipts', recordId)
  }

  const cashSources = [
    {
      rows: normalized.purchasePaymentRows,
      source: 'purchasePaymentRows',
      idFields: ['paymentId'],
      amountField: 'jpyAmount',
      dateField: 'paymentDate',
      schema: PURCHASE_PAYMENT_CASH_SCHEMA,
      category: 'purchaseOutflow',
      scope: exactProjectScope,
    },
    {
      rows: normalized.fuelRecords,
      source: 'fuelRecords',
      idFields: ['fuelRecordId'],
      amountField: 'fuelAmount',
      dateField: 'fuelDate',
      schema: VEHICLE_FUEL_CASH_SCHEMA,
      category: 'vehicleOutflow',
      scope: vehicleProjectScope,
    },
    {
      rows: normalized.vehicleExpenseRecords,
      source: 'vehicleExpenseRecords',
      idFields: ['vehicleExpenseId'],
      amountField: 'amount',
      dateField: 'expenseDate',
      schema: VEHICLE_EXPENSE_CASH_SCHEMA,
      category: 'vehicleOutflow',
      scope: vehicleProjectScope,
    },
  ]

  for (const sourceModel of cashSources) {
    for (const { row, recordId } of collectActiveRows(sourceModel.rows, {
      source: sourceModel.source,
      idFields: sourceModel.idFields,
      anomalies,
    })) {
      const amount = validAmount(
        row, sourceModel.amountField, anomalies, sourceModel.source, recordId,
      )
      if (amount === null) continue
      if (!sourceModel.scope(
        row, normalized, activeProjects, anomalies, sourceModel.source, recordId,
      )) continue
      const month = monthOfDate(safeOwnValue(row, sourceModel.dateField))
      const inWindow = monthSet.has(month)
      if (!month && safeOwnValue(row, sourceModel.dateField)) {
        anomaly(anomalies, sourceModel.source, recordId, 'invalid_date', '付款日期无效。')
      }
      const provenance = provenanceSnapshot(row, sourceModel.schema)
      if (inWindow && isLegacyInferredCashFact(provenance, sourceModel.schema)) {
        coverageCounts.historical_default_ambiguity += 1
      }
      if (inWindow && !isRecordedCashFact(provenance, sourceModel.schema)) {
        coverageCounts.missing_payment_date += 1
      }
      if (inWindow && isRecordedCashFact(provenance, sourceModel.schema)) {
        addCash(
          monthly.get(month), sourceModel.category, amount,
          anomalies, sourceModel.source, recordId,
        )
      }
    }
  }

  for (const row of normalized.laborWindow.monthly) {
    if (row === MALFORMED_ROW || !isSafeRow(row)) continue
    const month = safeOwnValue(row, 'month')
    if (!monthSet.has(month) || safeOwnValue(row, 'status') !== 'ready') continue
    if (normalized.projectId === 'all') {
      const salary = safeYen(safeOwnValue(row, 'salaryTotal'))
      if (salary !== null && salary > 0) coverageCounts.salary_payment_missing += 1
    } else {
      const map = safeProjectMap(safeOwnValue(row, 'projectLaborById'))
      if (map && (map.get(normalized.projectId) || 0) > 0) {
        coverageCounts.salary_payment_missing += 1
      }
    }
  }

  const coverageSources = [
    {
      rows: normalized.operatingExpenses,
      source: 'operatingExpenses',
      idFields: ['operatingExpenseId', 'expenseRecordId'],
      amountField: 'amount',
      dateField: 'date',
      coverageCode: 'operating_payment_missing',
      scope: companyFactProjectScope,
    },
    {
      rows: normalized.manualProjectCosts,
      source: 'manualProjectCosts',
      idFields: ['costRecordId'],
      amountField: 'amount',
      dateField: 'date',
      coverageCode: 'manual_payment_missing',
      scope: exactProjectScope,
    },
    {
      rows: normalized.vehicleIssueRecords,
      source: 'vehicleIssueRecords',
      idFields: ['issueId'],
      amountField: 'repairCost',
      dateField: 'issueDate',
      coverageCode: 'repair_payment_missing',
      scope: companyFactProjectScope,
    },
  ]
  for (const sourceModel of coverageSources) {
    for (const { row, recordId } of collectActiveRows(sourceModel.rows, {
      source: sourceModel.source,
      idFields: sourceModel.idFields,
      anomalies,
    })) {
      const amount = validAmount(
        row, sourceModel.amountField, anomalies, sourceModel.source, recordId,
      )
      if (amount === null) continue
      const month = monthOfDate(safeOwnValue(row, sourceModel.dateField))
      if (!month) {
        anomaly(anomalies, sourceModel.source, recordId, 'invalid_date', '发生日期无效。')
        continue
      }
      if (!sourceModel.scope(
        row, normalized, activeProjects, anomalies, sourceModel.source, recordId,
      )) continue
      if (amount > 0 && monthSet.has(month)) coverageCounts[sourceModel.coverageCode] += 1
    }
  }

  const series = normalized.months.map((month) => {
    const row = monthly.get(month)
    return {
      month,
      income: row.income,
      purchaseOutflow: row.purchaseOutflow,
      vehicleOutflow: row.vehicleOutflow,
      totalOutflow: row.totalOutflow,
      net: row.income - row.totalOutflow,
    }
  })

  return {
    series,
    coverage: coverageModel(coverageCounts),
    anomalies,
  }
}

import {
  applyLedgerFilters,
  buildLocalSourceFacts,
  normalizeLedgerSnapshot,
  paginateLedgerRows,
  summarizeLedgerRows,
} from './projectCostLedgerDomain.js'
import {
  fromFourDecimalUnits,
  toSignedFourDecimalUnits,
} from '../cost-accounting/fixedPointCurrency.js'
import {
  normalizeProjectCostAdjustmentRequest,
  normalizeProjectCostAllocationRequest,
  normalizeProjectCostLedgerAuditFilters,
  normalizeProjectCostLedgerListFilters,
  normalizeProjectCostLedgerReportFilters,
  normalizeProjectCostManualRequest,
  projectCostLedgerError,
  projectCostLedgerResponseNormalizers,
} from '../../services/projectCostLedgerService.js'

const DEMO_ACTOR = '本地验收会计'
const STORE_FIELDS = ['adjustments', 'allocations', 'manualEntries']
const ADJUSTMENT_EVENT_FIELDS = ['eventType', 'sourceKey', 'sequenceNo', 'amountBefore', 'adjustmentAmount', 'amountAfter', 'reason', 'actorName', 'createdAt']
const ALLOCATION_EVENT_FIELDS = ['eventType', 'sourceKey', 'sequenceNo', 'amountSnapshot', 'allocationsBefore', 'allocations', 'reason', 'actorName', 'createdAt']
const MANUAL_EVENT_FIELDS = ['requestId', 'entry', 'response']

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.getOwnPropertyNames(value)) freeze(value[key])
    Object.freeze(value)
  }
  return value
}

function copy(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return value
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertyNames(value).length !== value.length + 1) throw invalidInput()
    return value.map(copy)
  }
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length !== 0) throw invalidInput()
  const result = {}
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw invalidInput()
    result[key] = copy(descriptor.value)
  }
  return result
}

function invalidInput() {
  return projectCostLedgerError('PROJECT_COST_LEDGER_INPUT_INVALID')
}

function unavailable() {
  return projectCostLedgerError('PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE')
}

function exactStoredRecord(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.getOwnPropertyNames(value).length !== fields.length) throw unavailable()
  const result = {}
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw unavailable()
    result[field] = descriptor.value
  }
  return result
}

function denseStoredArray(value) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isExtensible(value) || Object.getOwnPropertyDescriptor(value, 'length')?.writable !== true ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      Object.getOwnPropertyNames(value).length !== value.length + 1) throw unavailable()
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value')) throw unavailable()
  }
  return value
}

function validateStoredAdjustment(candidate) {
  const event = exactStoredRecord(candidate, ADJUSTMENT_EVENT_FIELDS)
  if (event.eventType !== 'adjustment') throw unavailable()
  projectCostLedgerResponseNormalizers.listAudit({ status: 'ready', generatedAt: eventTime(), events: [auditDto(event)] })
}

function validateStoredAllocation(candidate) {
  const event = exactStoredRecord(candidate, ALLOCATION_EVENT_FIELDS)
  if (event.eventType !== 'allocation') throw unavailable()
  projectCostLedgerResponseNormalizers.listAudit({ status: 'ready', generatedAt: eventTime(), events: [auditDto(event)] })
}

function validateStoredManual(candidate) {
  const event = exactStoredRecord(candidate, MANUAL_EVENT_FIELDS)
  const request = normalizeProjectCostManualRequest({ requestId: event.requestId, entry: event.entry })
  const response = projectCostLedgerResponseNormalizers.createManual(event.response)
  if (response.sourceKey !== `manual:${request.requestId}` ||
      ['projectId', 'category', 'date', 'amount', 'description', 'operator', 'reason'].some((key) => response[key] !== request.entry[key])) throw unavailable()
}

function validateStore(eventStore) {
  try {
    const source = exactStoredRecord(eventStore, STORE_FIELDS)
    for (const event of denseStoredArray(source.adjustments)) validateStoredAdjustment(event)
    for (const event of denseStoredArray(source.allocations)) validateStoredAllocation(event)
    for (const event of denseStoredArray(source.manualEntries)) validateStoredManual(event)
    return eventStore
  } catch {
    throw unavailable()
  }
}

function eventTime() {
  return new Date().toISOString()
}

function safeSources(getSources) {
  try {
    return buildLocalSourceFacts(getSources())
  } catch {
    throw unavailable()
  }
}

function manualFacts(store) {
  return buildLocalSourceFacts({
    purchaseRows: [], warehouseCosts: [], laborRows: [], vehicleRows: [], toolRows: [], operatingExpenses: [],
    manualProjectCosts: store.manualEntries.map(({ requestId, entry }) => ({
      costRecordId: requestId, projectId: entry.projectId, projectName: '', costType: entry.category,
      date: entry.date, amount: entry.amount, description: entry.description, operator: entry.operator,
    })),
  })
}

function allFacts(getSources, store) {
  const byKey = new Map()
  for (const fact of [...safeSources(getSources), ...manualFacts(store)]) byKey.set(fact.sourceKey, fact)
  return [...byKey.values()]
}

function eventsFor(store, sourceKey) {
  return [...store.adjustments, ...store.allocations]
    .filter((event) => event.sourceKey === sourceKey)
    .sort((left, right) => left.sequenceNo - right.sequenceNo)
}

function sourceState(fact, store) {
  const events = eventsFor(store, fact.sourceKey)
  const adjustments = events.filter(({ eventType }) => eventType === 'adjustment')
  const allocationEvents = events.filter(({ eventType }) => eventType === 'allocation')
  const effectiveAmount = adjustments.length === 0 ? fact.originalAmount : adjustments.at(-1).amountAfter
  const allocation = allocationEvents.at(-1) ?? null
  return {
    fact,
    events,
    effectiveAmount,
    allocation,
    version: events.reduce((maximum, event) => Math.max(maximum, event.sequenceNo + 1), 1),
  }
}

function currentStates(getSources, store) {
  validateStore(store)
  return allFacts(getSources, store).map((fact) => sourceState(fact, store))
}

function addMoney(left, right) {
  const units = toSignedFourDecimalUnits(left) + toSignedFourDecimalUnits(right)
  if (!Number.isSafeInteger(units)) throw invalidInput()
  return fromFourDecimalUnits(units)
}

function roundedRatioUnits(valueUnits, partUnits, totalUnits) {
  const numerator = BigInt(valueUnits) * BigInt(partUnits)
  const denominator = BigInt(totalUnits)
  if (denominator === 0n) return 0n
  const negative = (numerator < 0n) !== (denominator < 0n)
  const absoluteNumerator = numerator < 0n ? -numerator : numerator
  const absoluteDenominator = denominator < 0n ? -denominator : denominator
  const rounded = (absoluteNumerator + absoluteDenominator / 2n) / absoluteDenominator
  return negative ? -rounded : rounded
}

function allocatedOriginalAmounts(originalAmount, effectiveAmount, allocations) {
  const originalUnits = toSignedFourDecimalUnits(originalAmount)
  const effectiveUnits = toSignedFourDecimalUnits(effectiveAmount)
  if (allocations.length === 1 || effectiveUnits === 0) return allocations.map((_, index) => index === allocations.length - 1 ? originalAmount : 0)
  const resultUnits = []
  let assigned = 0n
  for (let index = 0; index < allocations.length - 1; index += 1) {
    const units = roundedRatioUnits(originalUnits, toSignedFourDecimalUnits(allocations[index].amount), effectiveUnits)
    resultUnits.push(units)
    assigned += units
  }
  resultUnits.push(BigInt(originalUnits) - assigned)
  return resultUnits.map((units) => {
    if (units < BigInt(Number.MIN_SAFE_INTEGER) || units > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable()
    return fromFourDecimalUnits(Number(units))
  })
}

function auditDto(event) {
  if (event.eventType === 'adjustment') {
    return {
      eventType: 'adjustment', sourceKey: event.sourceKey, sequenceNo: event.sequenceNo,
      amountBefore: event.amountBefore, amountAfter: event.amountAfter, adjustmentAmount: event.adjustmentAmount,
      allocationsBefore: null, allocationsAfter: null, reason: event.reason,
      actorName: event.actorName, createdAt: event.createdAt,
    }
  }
  return {
    eventType: 'allocation', sourceKey: event.sourceKey, sequenceNo: event.sequenceNo,
    amountBefore: event.amountSnapshot, amountAfter: event.amountSnapshot, adjustmentAmount: 0,
    allocationsBefore: copy(event.allocationsBefore), allocationsAfter: copy(event.allocations), reason: event.reason,
    actorName: event.actorName, createdAt: event.createdAt,
  }
}

function buildRows(states) {
  const rows = []
  const incompleteSources = []
  for (const state of states) {
    if (state.allocation && state.allocation.amountSnapshot !== state.effectiveAmount) {
      incompleteSources.push(state.fact.sourceKey)
      continue
    }
    const allocations = [...(state.allocation?.allocations ?? [{ projectId: state.fact.projectId, amount: state.effectiveAmount }])]
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
    const originalAmounts = allocatedOriginalAmounts(state.fact.originalAmount, state.effectiveAmount, allocations)
    const auditEvents = state.events.map(auditDto)
    for (let index = 0; index < allocations.length; index += 1) {
      const allocation = allocations[index]
      const originalAmount = originalAmounts[index]
      const adjustmentAmount = addMoney(allocation.amount, -originalAmount)
      rows.push({
        ...state.fact,
        projectId: allocation.projectId,
        projectName: allocation.projectId === state.fact.projectId ? state.fact.projectName : '',
        originalAmount,
        adjustmentAmount,
        effectiveAmount: allocation.amount,
        adjusted: adjustmentAmount !== 0,
        version: state.version,
        allocations: [{ projectId: allocation.projectId, amount: allocation.amount }],
        auditEvents,
      })
    }
  }
  rows.sort((left, right) => right.date.localeCompare(left.date) || left.sourceKey.localeCompare(right.sourceKey) || left.projectId.localeCompare(right.projectId))
  return { rows, incompleteSources: incompleteSources.sort() }
}

function findState(states, sourceKey) {
  const state = states.find((candidate) => candidate.fact.sourceKey === sourceKey)
  if (!state) throw projectCostLedgerError('PROJECT_COST_LEDGER_SOURCE_MISSING')
  return state
}

function assertVersion(state, expectedVersion) {
  if (state.version !== expectedVersion) throw projectCostLedgerError('PROJECT_COST_LEDGER_VERSION_CONFLICT')
}

function currentAllocations(state) {
  return state.allocation?.allocations ?? [{ projectId: state.fact.projectId, amount: state.effectiveAmount }]
}

function activeFilters(normalized) {
  return Object.fromEntries(Object.entries(normalized).filter(([key, value]) => {
    if (['page', 'pageSize'].includes(key)) return false
    if (['projectId', 'category', 'sourceModule'].includes(key) && ['', 'all'].includes(value)) return false
    if (key === 'adjusted' && value === 'all') return false
    return value !== ''
  }))
}

function snapshotFromStates(states, normalized, generatedAt, { complete = false } = {}) {
  const built = buildRows(states)
  const filtered = applyLedgerFilters({ rows: built.rows }, activeFilters(normalized))
  const summary = summarizeLedgerRows(filtered)
  const page = complete ? 1 : normalized.page ?? 1
  const pageSize = complete ? 100 : normalized.pageSize ?? 20
  return normalizeLedgerSnapshot({
    status: 'ready', generatedAt, page, pageSize, totalRows: filtered.length,
    rows: complete ? filtered : paginateLedgerRows(filtered, page, pageSize),
    categoryTotals: summary.categoryTotals, totalAmount: summary.totalAmount,
    adjustmentTotal: summary.adjustmentTotal, incompleteSources: built.incompleteSources,
  })
}

function auditFromStates(states, sourceKeys, generatedAt) {
  const events = states.flatMap((state) => sourceKeys.has(state.fact.sourceKey)
    ? state.events.map(auditDto)
    : []).sort((left, right) => left.createdAt.localeCompare(right.createdAt) ||
      left.sourceKey.localeCompare(right.sourceKey) || left.sequenceNo - right.sequenceNo ||
      left.eventType.localeCompare(right.eventType))
  return projectCostLedgerResponseNormalizers.listAudit({ status: 'ready', generatedAt, events })
}

async function reportToken(ledgerSnapshot, auditSnapshot) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle || typeof globalThis.TextEncoder !== 'function') throw unavailable()
  const bytes = new TextEncoder().encode(JSON.stringify({
    rows: ledgerSnapshot.rows, incompleteSources: ledgerSnapshot.incompleteSources,
    events: auditSnapshot.events,
  }))
  const digest = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function createProjectCostLedgerDemoService({ getSources, eventStore } = {}) {
  if (typeof getSources !== 'function') throw unavailable()
  const store = validateStore(eventStore)

  return Object.freeze({
    async list(filters = {}) {
      const normalized = normalizeProjectCostLedgerListFilters(filters)
      return snapshotFromStates(currentStates(getSources, store), normalized, eventTime())
    },

    async report(filters = {}) {
      const normalized = normalizeProjectCostLedgerReportFilters(filters)
      const states = currentStates(getSources, store)
      const generatedAt = eventTime()
      const ledgerSnapshot = snapshotFromStates(states, normalized, generatedAt, { complete: true })
      if (ledgerSnapshot.totalRows > 5000) throw projectCostLedgerError('PROJECT_COST_LEDGER_REPORT_TOO_LARGE')
      const sourceKeys = new Set(ledgerSnapshot.rows.map(({ sourceKey }) => sourceKey))
      const auditSnapshot = auditFromStates(states, sourceKeys, generatedAt)
      if (auditSnapshot.events.length > 20000) throw projectCostLedgerError('PROJECT_COST_LEDGER_REPORT_TOO_LARGE')
      return projectCostLedgerResponseNormalizers.report({
        status: 'ready', generatedAt,
        snapshotToken: await reportToken(ledgerSnapshot, auditSnapshot),
        ledgerSnapshot, auditSnapshot,
      })
    },

    async listAudit(filters = {}) {
      const normalized = normalizeProjectCostLedgerAuditFilters(filters)
      const states = currentStates(getSources, store)
      const events = states.flatMap((state) => {
        if (normalized.dateFrom && state.fact.date < normalized.dateFrom) return []
        if (normalized.dateTo && state.fact.date > normalized.dateTo) return []
        if (normalized.projectId && normalized.projectId !== 'all' && !currentAllocations(state).some(({ projectId }) => projectId === normalized.projectId)) return []
        return state.events.map(auditDto)
      }).sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.sourceKey.localeCompare(right.sourceKey) || left.sequenceNo - right.sequenceNo || left.eventType.localeCompare(right.eventType))
      return projectCostLedgerResponseNormalizers.listAudit({ status: 'ready', generatedAt: eventTime(), events })
    },

    async adjust(request) {
      const value = normalizeProjectCostAdjustmentRequest(request)
      const state = findState(currentStates(getSources, store), value.sourceKey)
      assertVersion(state, value.expectedVersion)
      if (state.allocation) throw projectCostLedgerError('PROJECT_COST_LEDGER_ALLOCATION_ACTIVE')
      const amountAfter = addMoney(state.effectiveAmount, value.adjustmentAmount)
      const event = freeze({
        eventType: 'adjustment', sourceKey: value.sourceKey, sequenceNo: state.version,
        amountBefore: state.effectiveAmount, adjustmentAmount: value.adjustmentAmount,
        amountAfter, reason: value.reason, actorName: DEMO_ACTOR, createdAt: eventTime(),
      })
      store.adjustments.push(event)
      return projectCostLedgerResponseNormalizers.adjust({ sourceKey: value.sourceKey, version: state.version + 1, effectiveAmount: amountAfter })
    },

    async replaceAllocations(request) {
      const value = normalizeProjectCostAllocationRequest(request)
      const state = findState(currentStates(getSources, store), value.sourceKey)
      assertVersion(state, value.expectedVersion)
      const assigned = value.allocations.reduce((units, allocation) => units + BigInt(toSignedFourDecimalUnits(allocation.amount)), 0n)
      if (assigned !== BigInt(toSignedFourDecimalUnits(state.effectiveAmount))) throw projectCostLedgerError('PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED')
      const event = freeze({
        eventType: 'allocation', sourceKey: value.sourceKey, sequenceNo: state.version,
        amountSnapshot: state.effectiveAmount, allocationsBefore: copy(currentAllocations(state)),
        allocations: copy(value.allocations), reason: value.reason, actorName: DEMO_ACTOR, createdAt: eventTime(),
      })
      store.allocations.push(event)
      return projectCostLedgerResponseNormalizers.replaceAllocations({ sourceKey: value.sourceKey, version: state.version + 1, allocations: copy(value.allocations) })
    },

    async createManual(request) {
      validateStore(store)
      const value = normalizeProjectCostManualRequest(request)
      const existing = store.manualEntries.find(({ requestId }) => requestId === value.requestId)
      if (existing) {
        if (JSON.stringify(existing.entry) !== JSON.stringify(value.entry)) throw invalidInput()
        return projectCostLedgerResponseNormalizers.createManual(existing.response)
      }
      const response = {
        sourceKey: `manual:${value.requestId}`, projectId: value.entry.projectId,
        category: value.entry.category, date: value.entry.date, amount: value.entry.amount,
        description: value.entry.description, operator: value.entry.operator, reason: value.entry.reason,
        actorName: DEMO_ACTOR, createdAt: eventTime(),
      }
      store.manualEntries.push(freeze({ requestId: value.requestId, entry: copy(value.entry), response: copy(response) }))
      return projectCostLedgerResponseNormalizers.createManual(response)
    },
  })
}

import { buildMonthWindow, normalizeMonth } from '../features/executive-dashboard/dashboardTime.js'
import { normalizeBridgeSummary } from '../features/labor-accounting/laborAccountingBridge.js'

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000
const LOADER_ABORT = Symbol('dashboardLaborBridgeLoaderAbort')

function abortError() {
  const error = typeof DOMException === 'function'
    ? new DOMException('The operation was aborted', 'AbortError')
    : Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
  Object.defineProperty(error, LOADER_ABORT, { value: true })
  return error
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw abortError()
}

function createAbortGate(signal) {
  if (signal === undefined) return { promise: null, dispose() {} }
  let rejectAbort
  const onAbort = () => rejectAbort(abortError())
  const promise = new Promise((_resolve, reject) => {
    rejectAbort = reject
  })
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted === true) onAbort()
  return {
    promise,
    dispose() {
      signal.removeEventListener('abort', onAbort)
    },
  }
}

function currentDate(now) {
  try {
    const value = now()
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('now must return a valid Date')
    }
    return new Date(value.getTime())
  } catch (error) {
    if (error instanceof TypeError && error.message === 'now must return a valid Date') throw error
    throw new TypeError('now must return a valid Date', { cause: error })
  }
}

function cachedEntry(cache, key, month) {
  const entry = cache.get(key)
  if (entry === null || typeof entry !== 'object') return null
  const valueDescriptor = Object.getOwnPropertyDescriptor(entry, 'value')
  const updatedAtDescriptor = Object.getOwnPropertyDescriptor(entry, 'updatedAt')
  if (!valueDescriptor || !Object.hasOwn(valueDescriptor, 'value') ||
      !updatedAtDescriptor || !Object.hasOwn(updatedAtDescriptor, 'value')) return null
  const value = normalizeBridgeSummary(valueDescriptor.value)
  const updatedAt = updatedAtDescriptor.value
  if (!value || value.salaryMonth !== month ||
      !(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) {
    return null
  }
  return { value, updatedAt: new Date(updatedAt.getTime()) }
}

function copyBridge(value) {
  return normalizeBridgeSummary(value)
}

function belongsToActor(key, actorScope) {
  if (typeof key !== 'string' || key.at(-8) !== ':') return false
  const month = key.slice(-7)
  return normalizeMonth(month) === month && key.slice(0, -8) === actorScope
}

function ownDataSnapshot(value, { required, optional = [], label }) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError()
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError()
    const snapshot = {}
    for (const key of [...required, ...optional]) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor) {
        if (required.includes(key)) throw new TypeError()
        continue
      }
      if (descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
        throw new TypeError()
      }
      snapshot[key] = descriptor.value
    }
    return snapshot
  } catch (cause) {
    throw new TypeError(`${label} must use own data fields`, { cause })
  }
}

export function createDashboardLaborBridgeLoader(options = {}) {
  const optionSnapshot = ownDataSnapshot(options, {
    required: ['getBridgeSummary'],
    optional: ['cache', 'maxConcurrency', 'maxAgeMs', 'now'],
    label: 'loader options',
  })
  const getBridgeSummary = optionSnapshot.getBridgeSummary
  const cache = optionSnapshot.cache === undefined ? new Map() : optionSnapshot.cache
  const maxConcurrency = optionSnapshot.maxConcurrency === undefined
    ? 4
    : optionSnapshot.maxConcurrency
  const maxAgeMs = optionSnapshot.maxAgeMs === undefined
    ? DEFAULT_MAX_AGE_MS
    : optionSnapshot.maxAgeMs
  const now = optionSnapshot.now === undefined ? () => new Date() : optionSnapshot.now
  if (typeof getBridgeSummary !== 'function') throw new TypeError('getBridgeSummary is required')
  if (!(cache instanceof Map)) throw new TypeError('cache must be a Map')
  if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new TypeError('maxConcurrency must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) {
    throw new TypeError('maxAgeMs must be a non-negative safe integer')
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function')

  const queue = []
  const inFlight = new Map()
  const actorGenerations = new Map()
  let activeRequests = 0

  function drainQueue() {
    while (activeRequests < maxConcurrency && queue.length > 0) {
      const item = queue.shift()
      activeRequests += 1
      Promise.resolve()
        .then(item.run)
        .then(item.resolve, item.reject)
        .finally(() => {
          activeRequests -= 1
          drainQueue()
        })
    }
  }

  function schedule(run) {
    return new Promise((resolve, reject) => {
      queue.push({ run, resolve, reject })
      drainQueue()
    })
  }

  function isUsableSignal(signal) {
    if (signal === undefined) return true
    try {
      return signal !== null && typeof signal === 'object' &&
        typeof signal.aborted === 'boolean' &&
        typeof signal.addEventListener === 'function' &&
        typeof signal.removeEventListener === 'function'
    } catch {
      return false
    }
  }

  function acquireRequest({ actorScope, generation, key, month, signal }) {
    const flightKey = `${generation}\u0000${key}`
    let entry = inFlight.get(flightKey)
    const waiter = { signal }
    const removeEntry = () => {
      if (inFlight.get(flightKey) === entry) inFlight.delete(flightKey)
    }

    if (!entry) {
      entry = { waiters: new Set(), settled: false, promise: null }
      inFlight.set(flightKey, entry)
      entry.waiters.add(waiter)
      const request = schedule(async () => {
        const hasActiveWaiter = [...entry.waiters].some((item) =>
          item.signal === undefined || item.signal.aborted !== true)
        if (!hasActiveWaiter) throw abortError()
        const value = normalizeBridgeSummary(await getBridgeSummary({ month }))
        if (!value || value.salaryMonth !== month) throw new TypeError('invalid bridge summary')
        return { value, updatedAt: currentDate(now), actorScope }
      })
      entry.promise = request.then(
        (value) => {
          entry.settled = true
          if (entry.waiters.size === 0) removeEntry()
          return value
        },
        (error) => {
          entry.settled = true
          removeEntry()
          throw error
        },
      )
    } else {
      entry.waiters.add(waiter)
    }

    let released = false
    return {
      promise: entry.promise,
      release() {
        if (released) return
        released = true
        entry.waiters.delete(waiter)
        if (entry.waiters.size === 0) removeEntry()
      },
    }
  }

  async function load(input) {
    const inputSnapshot = ownDataSnapshot(input, {
      required: ['actorScope', 'endMonth', 'snapshotMonth'],
      optional: ['length', 'signal', 'refresh'],
      label: 'load input',
    })
    const {
      actorScope,
      endMonth,
      length = 12,
      snapshotMonth,
      signal,
      refresh = false,
    } = inputSnapshot
    if (typeof actorScope !== 'string' || actorScope.trim().length === 0) {
      throw new TypeError('actorScope is required')
    }
    const months = buildMonthWindow(endMonth, length)
    const normalizedSnapshotMonth = normalizeMonth(snapshotMonth)
    if (months.length === 0 || months.length !== length || !normalizedSnapshotMonth) {
      throw new TypeError('month window is invalid')
    }
    if (typeof refresh !== 'boolean') throw new TypeError('refresh must be a boolean')
    if (!isUsableSignal(signal)) throw new TypeError('signal must be an AbortSignal')

    throwIfAborted(signal)
    const requestedMonths = months.includes(normalizedSnapshotMonth)
      ? months
      : [...months, normalizedSnapshotMonth]
    const checkedAt = currentDate(now)
    const generation = actorGenerations.get(actorScope) || 0
    const handles = []
    const abortGate = createAbortGate(signal)

    try {
      const work = (async () => {
        const settled = await Promise.all(requestedMonths.map(async (month) => {
          const key = `${actorScope}:${month}`
          const cached = cachedEntry(cache, key, month)
          const age = cached
            ? checkedAt.getTime() - cached.updatedAt.getTime()
            : Number.POSITIVE_INFINITY
          if (!refresh && cached && age >= 0 && age <= maxAgeMs) {
            return { month, key, value: cached.value, updatedAt: cached.updatedAt, stale: false, fetched: false }
          }

          throwIfAborted(signal)
          const handle = acquireRequest({ actorScope, generation, key, month, signal })
          handles.push(handle)
          try {
            const fetched = await handle.promise
            throwIfAborted(signal)
            return {
              month,
              key,
              value: fetched.value,
              updatedAt: fetched.updatedAt,
              stale: false,
              fetched: true,
            }
          } catch (error) {
            if (signal?.aborted === true || error?.[LOADER_ABORT] === true) throw abortError()
            return cached
              ? { month, key, value: cached.value, updatedAt: cached.updatedAt, stale: true, fetched: false }
              : { month, key, value: null, updatedAt: null, stale: false, fetched: false }
          }
        }))

        throwIfAborted(signal)
        if ((actorGenerations.get(actorScope) || 0) !== generation) throw abortError()

        for (const entry of settled) {
          if (!entry.fetched) continue
          cache.set(entry.key, {
            value: copyBridge(entry.value),
            updatedAt: new Date(entry.updatedAt.getTime()),
          })
        }

        const byMonth = new Map(settled.map((entry) => [entry.month, entry]))
        const successful = settled.filter((entry) => entry.value !== null)
        const data = Object.fromEntries(successful.map((entry) => [entry.month, copyBridge(entry.value)]))
        const updatedAtByMonth = Object.fromEntries(successful.map((entry) => [
          entry.month,
          new Date(entry.updatedAt.getTime()),
        ]))
        const windowIncompleteMonths = months.filter((month) => byMonth.get(month)?.value === null)
        const windowStaleMonths = months.filter((month) => byMonth.get(month)?.stale === true)
        const snapshot = byMonth.get(normalizedSnapshotMonth)

        throwIfAborted(signal)
        return {
          windowStatus: windowIncompleteMonths.length ? 'error' : 'ready',
          data,
          windowIncompleteMonths,
          windowStaleMonths,
          snapshotMonth: normalizedSnapshotMonth,
          snapshotStatus: snapshot?.value ? 'ready' : 'error',
          snapshotStale: snapshot?.value ? snapshot.stale : false,
          updatedAtByMonth,
        }
      })()
      return await (abortGate.promise ? Promise.race([work, abortGate.promise]) : work)
    } finally {
      abortGate.dispose()
      for (const handle of handles) handle.release()
    }
  }

  function clear(actorScope) {
    if (typeof actorScope !== 'string' || actorScope.trim().length === 0) {
      throw new TypeError('actorScope is required')
    }
    actorGenerations.set(actorScope, (actorGenerations.get(actorScope) || 0) + 1)
    for (const key of cache.keys()) {
      if (belongsToActor(key, actorScope)) cache.delete(key)
    }
  }

  return { load, clear }
}

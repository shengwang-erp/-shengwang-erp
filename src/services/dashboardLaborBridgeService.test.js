import assert from 'node:assert/strict'
import test from 'node:test'
import { createDashboardLaborBridgeLoader } from './dashboardLaborBridgeService.js'

const validBridge = (month, overrides = {}) => ({
  salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
  projectLaborTotal: 1, projectLaborById: { P1: 1 },
  projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
  pendingCount: 0, effectiveFrom: `${month}-01`, ...overrides,
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  assert.fail('condition was not reached')
}

test('overlapping windows reuse cached month requests', async () => {
  const calls = []
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls.push(month)
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02' })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-03', length: 2, snapshotMonth: '2026-03' })
  assert.deepEqual(calls, ['2026-01', '2026-02', '2026-03'])
})

test('cache entries never cross actor scope', async () => {
  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls += 1
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  await loader.load({ actorScope: 'tenant-1:E-2', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  assert.equal(calls, 2)
})

test('an expired cached month is disclosed as stale when refresh fails', async () => {
  let nowMs = 0
  let offline = false
  const loader = createDashboardLaborBridgeLoader({
    now: () => new Date(nowMs), maxAgeMs: 1000,
    getBridgeSummary: async ({ month }) => {
      if (offline) throw new Error('offline')
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  nowMs = 2000
  offline = true
  const state = await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  assert.deepEqual(state.windowStaleMonths, ['2026-02'])
  assert.equal(state.snapshotStale, true)
  assert.equal(state.windowStatus, 'ready')
})

test('refresh retries a fresh month and reuses only its prior valid value on failure', async () => {
  let calls = 0
  let offline = false
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls += 1
      if (offline) throw new Error('offline')
      return validBridge(month)
    },
  })
  const input = {
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02',
  }

  await loader.load(input)
  offline = true
  const state = await loader.load({ ...input, refresh: true })

  assert.equal(calls, 2)
  assert.deepEqual(state.windowStaleMonths, ['2026-02'])
  assert.equal(state.snapshotStale, true)
})

test('an upstream AbortError is a request failure when the caller signal is not aborted', async () => {
  const cache = new Map([
    ['tenant-1:E-1:2026-02', {
      value: validBridge('2026-02'),
      updatedAt: new Date(),
    }],
  ])
  const loader = createDashboardLaborBridgeLoader({
    cache,
    getBridgeSummary: async () => {
      const error = new Error('upstream cancelled its own request')
      error.name = 'AbortError'
      throw error
    },
  })

  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1,
    snapshotMonth: '2026-02', refresh: true,
  })

  assert.equal(state.windowStatus, 'ready')
  assert.deepEqual(state.windowStaleMonths, ['2026-02'])
  assert.equal(state.snapshotStale, true)
})

test('clear removes only the exact actor scope even when another scope shares its prefix', async () => {
  const cache = new Map()
  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    cache,
    getBridgeSummary: async ({ month }) => {
      calls += 1
      return validBridge(month)
    },
  })
  const input = { endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' }

  await loader.load({ actorScope: 'tenant', ...input })
  await loader.load({ actorScope: 'tenant:child', ...input })
  loader.clear('tenant')
  await loader.load({ actorScope: 'tenant:child', ...input })

  assert.equal(calls, 2)
  assert.equal(cache.has('tenant:2026-02'), false)
  assert.equal(cache.has('tenant:child:2026-02'), true)
})

test('a failed uncached month is incomplete instead of zero', async () => {
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      if (month === '2026-01') throw new Error('offline')
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02',
  })
  assert.equal(state.windowStatus, 'error')
  assert.deepEqual(state.windowIncompleteMonths, ['2026-01'])
  assert.equal(Object.hasOwn(state.data, '2026-01'), false)
})

test('twelve-month window plus snapshot surfaces concurrent auth invalidation once and writes no cache', async () => {
  const cache = new Map()
  let requests = 0
  let logoutCalls = 0
  const loader = createDashboardLaborBridgeLoader({
    cache,
    getBridgeSummary: async () => {
      requests += 1
      const error = new Error('session expired')
      error.authInvalid = true
      throw error
    },
  })

  await loader.load({
    actorScope: 'tenant-1:E-1',
    endMonth: '2026-06',
    length: 12,
    snapshotMonth: '2026-07',
  }).catch((error) => {
    if (error?.authInvalid === true) logoutCalls += 1
    throw error
  }).then(
    () => assert.fail('auth invalidation must reject the whole bridge load'),
    (error) => assert.equal(error?.authInvalid, true),
  )

  assert.equal(logoutCalls, 1)
  assert.ok(requests >= 1 && requests <= 13)
  assert.equal(cache.size, 0)
})

test('a current snapshot failure never poisons a complete historical window', async () => {
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      if (month === '2026-07') throw new Error('snapshot offline')
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-07',
  })
  assert.equal(state.windowStatus, 'ready')
  assert.deepEqual(state.windowIncompleteMonths, [])
  assert.equal(state.snapshotStatus, 'error')
  assert.equal(Object.hasOwn(state.data, '2026-07'), false)
})

test('invalid payloads and invalid cached payloads fail instead of becoming stale data', async () => {
  const cache = new Map([
    ['tenant-1:E-1:2026-01', {
      value: validBridge('2026-01', { salaryTotal: -1 }),
      updatedAt: new Date(),
    }],
  ])
  const loader = createDashboardLaborBridgeLoader({
    cache,
    getBridgeSummary: async ({ month }) => month === '2026-01'
      ? validBridge(month, { salaryTotal: -1 })
      : validBridge('2026-03'),
  })

  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02',
  })

  assert.deepEqual(state.data, {})
  assert.deepEqual(state.windowIncompleteMonths, ['2026-01', '2026-02'])
  assert.deepEqual(state.windowStaleMonths, [])
  assert.equal(state.snapshotStatus, 'error')
  assert.equal(cache.size, 1)
})

test('a valid bridge cached under the wrong month is never reused or used as stale fallback', async () => {
  const cache = new Map([
    ['tenant-1:E-1:2026-02', {
      value: validBridge('2026-03'),
      updatedAt: new Date(),
    }],
  ])
  const loader = createDashboardLaborBridgeLoader({
    cache,
    getBridgeSummary: async () => { throw new Error('offline') },
  })

  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02',
  })

  assert.deepEqual(state.data, {})
  assert.deepEqual(state.windowIncompleteMonths, ['2026-02'])
  assert.deepEqual(state.windowStaleMonths, [])
  assert.equal(state.snapshotStatus, 'error')
})

test('concurrent overlapping loads share the same in-flight month request', async () => {
  const request = deferred()
  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async () => {
      calls += 1
      return request.promise
    },
  })
  const input = {
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02',
  }

  const first = loader.load(input)
  await waitFor(() => calls === 1)
  const second = loader.load(input)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1)
  request.resolve(validBridge('2026-02'))
  await Promise.all([first, second])
})

test('a settled failed month is retried while a sibling month from the first load is still pending', async () => {
  const february = deferred()
  let januaryCalls = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      if (month === '2026-01') {
        januaryCalls += 1
        if (januaryCalls === 1) throw new Error('temporary January failure')
        return validBridge(month)
      }
      return february.promise
    },
  })

  const firstLoad = loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02',
  })
  await waitFor(() => januaryCalls === 1)
  const retryState = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-01', length: 1, snapshotMonth: '2026-01',
  })
  february.resolve(validBridge('2026-02'))
  await firstLoad

  assert.equal(januaryCalls, 2)
  assert.equal(retryState.windowStatus, 'ready')
  assert.equal(retryState.data['2026-01'].salaryMonth, '2026-01')
})

test('the default queue caps requests at four across concurrent loads', async () => {
  const gate = deferred()
  let calls = 0
  let active = 0
  let maximum = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls += 1
      active += 1
      maximum = Math.max(maximum, active)
      await gate.promise
      active -= 1
      return validBridge(month)
    },
  })

  const pending = Promise.all([
    loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-03', length: 3, snapshotMonth: '2026-03' }),
    loader.load({ actorScope: 'tenant-1:E-2', endMonth: '2026-06', length: 3, snapshotMonth: '2026-06' }),
  ])
  await waitFor(() => calls >= 4)
  assert.equal(calls, 4)
  assert.equal(maximum, 4)
  gate.resolve()
  await pending
  assert.equal(calls, 6)
  assert.equal(maximum, 4)
})

test('abort rejects atomically before requests and before return', async () => {
  const cache = new Map()
  const secondRequest = deferred()
  const firstReturned = deferred()
  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    cache,
    maxConcurrency: 1,
    getBridgeSummary: async ({ month }) => {
      calls += 1
      if (month === '2026-01') {
        firstReturned.resolve()
        return validBridge(month)
      }
      await secondRequest.promise
      return validBridge(month)
    },
  })
  const input = {
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02',
  }

  const alreadyAborted = new AbortController()
  alreadyAborted.abort()
  await assert.rejects(loader.load({ ...input, signal: alreadyAborted.signal }), {
    name: 'AbortError',
  })
  assert.equal(calls, 0)

  const controller = new AbortController()
  const pending = loader.load({ ...input, signal: controller.signal })
  await firstReturned.promise
  await new Promise((resolve) => setImmediate(resolve))
  controller.abort()
  secondRequest.resolve()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cache.size, 0)
})

test('abort promptly rejects a load whose RPC never settles and removes its listener', async () => {
  const cache = new Map()
  const controller = new AbortController()
  const signal = controller.signal
  const addEventListener = signal.addEventListener.bind(signal)
  const removeEventListener = signal.removeEventListener.bind(signal)
  let added = 0
  let removed = 0
  Object.defineProperties(signal, {
    addEventListener: {
      configurable: true,
      value(...args) {
        added += 1
        return addEventListener(...args)
      },
    },
    removeEventListener: {
      configurable: true,
      value(...args) {
        removed += 1
        return removeEventListener(...args)
      },
    },
  })
  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    cache,
    maxConcurrency: 2,
    getBridgeSummary: async () => {
      calls += 1
      return calls === 1 ? new Promise(() => {}) : validBridge('2026-02')
    },
  })

  const pending = loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1,
    snapshotMonth: '2026-02', signal,
  })
  await waitFor(() => calls === 1)
  controller.abort()
  const outcome = await Promise.race([
    pending.then(
      () => ({ status: 'resolved' }),
      (error) => ({ status: 'rejected', error }),
    ),
    new Promise((resolve) => setImmediate(() => resolve({ status: 'pending' }))),
  ])

  assert.equal(outcome.status, 'rejected')
  assert.equal(outcome.error?.name, 'AbortError')
  assert.equal(added, 1)
  assert.equal(removed, 1)
  assert.equal(cache.size, 0)

  const retryOutcome = await Promise.race([
    loader.load({
      actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1,
      snapshotMonth: '2026-02',
    }).then((state) => ({ status: 'resolved', state })),
    new Promise((resolve) => setImmediate(() => resolve({ status: 'pending' }))),
  ])
  assert.equal(retryOutcome.status, 'resolved')
  assert.equal(retryOutcome.state?.windowStatus, 'ready')
  assert.equal(calls, 2)
})

test('returned values cannot mutate a fresh cache entry', async () => {
  const loader = createDashboardLaborBridgeLoader({
    now: () => new Date(100),
    getBridgeSummary: async ({ month }) => validBridge(month, {
      salaryTotal: 2,
      projectLaborLifetimeTotal: 2,
      projectLaborLifetimeById: { P1: 2 },
    }),
  })
  const input = {
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02',
  }

  const first = await loader.load(input)
  first.data['2026-02'].salaryTotal = 999
  first.data['2026-02'].projectLaborLifetimeById.P1 = 999
  first.updatedAtByMonth['2026-02'].setTime(999)
  const second = await loader.load(input)

  assert.equal(second.data['2026-02'].salaryTotal, 2)
  assert.deepEqual(second.data['2026-02'].projectLaborLifetimeById, { P1: 2 })
  assert.equal(second.updatedAtByMonth['2026-02'].getTime(), 100)
})

test('public inputs fail closed before bridge requests', async () => {
  assert.throws(() => createDashboardLaborBridgeLoader({ getBridgeSummary: null }), TypeError)
  assert.throws(() => createDashboardLaborBridgeLoader({
    getBridgeSummary: async () => validBridge('2026-01'), maxConcurrency: 0,
  }), TypeError)
  assert.throws(() => createDashboardLaborBridgeLoader({
    getBridgeSummary: async () => validBridge('2026-01'), maxAgeMs: -1,
  }), TypeError)

  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls += 1
      return validBridge(month)
    },
  })
  const valid = {
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02',
  }
  for (const input of [
    null,
    { ...valid, actorScope: '   ' },
    { ...valid, endMonth: '2026-2' },
    { ...valid, length: 0 },
    { ...valid, snapshotMonth: '2101-01' },
    { ...valid, refresh: 'yes' },
    { ...valid, signal: { aborted: false } },
  ]) {
    await assert.rejects(loader.load(input), TypeError)
  }
  assert.throws(() => loader.clear('   '), TypeError)
  assert.equal(calls, 0)
})

test('loader options and load input require own data fields without invoking accessors', async () => {
  let optionGetterCalls = 0
  const accessorOptions = {}
  Object.defineProperty(accessorOptions, 'getBridgeSummary', {
    enumerable: true,
    get() {
      optionGetterCalls += 1
      return async ({ month }) => validBridge(month)
    },
  })
  assert.throws(() => createDashboardLaborBridgeLoader(accessorOptions), TypeError)
  assert.equal(optionGetterCalls, 0)
  assert.throws(() => createDashboardLaborBridgeLoader(Object.create({
    getBridgeSummary: async ({ month }) => validBridge(month),
  })), TypeError)

  let requests = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      requests += 1
      return validBridge(month)
    },
  })
  const valid = {
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02',
  }
  const inherited = Object.create(valid)
  let inputGetterCalls = 0
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'actorScope', {
    enumerable: true,
    get() {
      inputGetterCalls += 1
      return valid.actorScope
    },
  })

  await assert.rejects(loader.load(inherited), TypeError)
  await assert.rejects(loader.load(accessor), TypeError)
  assert.equal(inputGetterCalls, 0)
  assert.equal(requests, 0)

  const nullPrototype = Object.assign(Object.create(null), {
    ...valid,
    actorScope: 'tenant-1:E-null-prototype',
  })
  const state = await loader.load(nullPrototype)
  assert.equal(state.windowStatus, 'ready')
  assert.equal(requests, 1)
})

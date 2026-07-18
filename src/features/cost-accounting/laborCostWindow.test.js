import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLaborCostWindow } from './laborCostWindow.js'

const bridge = (overrides = {}) => ({
  salaryMonth: '2026-07', isAuthoritative: true,
  salaryTotal: 300, projectLaborTotal: 200, projectLaborById: { P1: 200 },
  projectLaborLifetimeTotal: 500, projectLaborLifetimeById: { P1: 500 },
  pendingCount: 0, effectiveFrom: '2026-07-01', ...overrides,
})

test('formal months and pre-activation legacy months share one explicit window', () => {
  const model = buildLaborCostWindow({
    months: ['2026-06', '2026-07'],
    snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'ready',
      data: {
        '2026-06': bridge({
          salaryMonth: '2026-06', isAuthoritative: false,
          salaryTotal: 0, projectLaborTotal: 0, projectLaborById: {}, pendingCount: 0,
        }),
        '2026-07': bridge(),
      },
      windowIncompleteMonths: [], windowStaleMonths: ['2026-06'], snapshotMonth: '2026-07',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [{ salaryMonth: '2026-06', netSalary: 100 }],
    employees: [],
    laborRecords: [{ workDate: '2026-06-10', projectId: 'P1', laborCost: 80 }],
  })
  assert.deepEqual(model.monthly.map((row) => ({
    month: row.month, salaryTotal: row.salaryTotal,
    projectLaborTotal: row.projectLaborTotal, source: row.source, stale: row.stale,
  })), [
    { month: '2026-06', salaryTotal: 100, projectLaborTotal: 80, source: 'legacy', stale: true },
    { month: '2026-07', salaryTotal: 300, projectLaborTotal: 200, source: 'formal', stale: false },
  ])
  assert.deepEqual(model.monthly[0].projectLaborById, { P1: 80 })
  assert.deepEqual(model.projectLaborLifetimeById, { P1: 500 })
})

test('an incomplete month carries null amounts instead of fabricated zero', () => {
  const model = buildLaborCostWindow({
    months: ['2026-05'],
    snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'error', data: {}, windowIncompleteMonths: ['2026-05'],
      windowStaleMonths: [], snapshotMonth: '2026-07', snapshotStatus: 'error',
      snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [{ salaryMonth: '2026-05', netSalary: 999 }],
    employees: [],
    laborRecords: [{ workDate: '2026-05-10', projectId: 'P1', laborCost: 888 }],
  })
  assert.deepEqual(model.monthly[0], {
    month: '2026-05', status: 'error', stale: false,
    salaryTotal: null, projectLaborTotal: null, projectLaborById: null,
    source: null, pendingCount: null,
  })
  assert.equal(model.projectLaborLifetimeById, null)
  assert.equal(model.lifetimeStatus, 'error')
})

test('lifetime labor comes only from the exact snapshot outside the trend window', () => {
  const historical = bridge({
    salaryMonth: '2026-06', effectiveFrom: '2026-06-01',
    projectLaborLifetimeTotal: 999,
    projectLaborLifetimeById: { P1: 200, WRONG: 799 },
  })
  const snapshot = bridge({
    projectLaborLifetimeTotal: 700,
    projectLaborLifetimeById: { P1: 200, CURRENT: 500 },
  })
  const model = buildLaborCostWindow({
    months: ['2026-06'],
    snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-06': historical, '2026-07': snapshot },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-07',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [], employees: [], laborRecords: [],
  })

  assert.deepEqual(model.projectLaborLifetimeById, { P1: 200, CURRENT: 500 })
  assert.equal(model.lifetimeStatus, 'ready')
})

test('only a valid pre-activation bridge may unlock legacy projections', () => {
  const invalid = bridge({
    salaryMonth: '2026-06', isAuthoritative: false,
    salaryTotal: 0, projectLaborTotal: 0, projectLaborById: {},
    pendingCount: 1, effectiveFrom: '2026-07-01',
  })
  const model = buildLaborCostWindow({
    months: ['2026-06'],
    snapshotMonth: '2026-06',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-06': invalid },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-06',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [{ salaryMonth: '2026-06', netSalary: 999 }],
    employees: [],
    laborRecords: [{ workDate: '2026-06-01', projectId: 'P1', laborCost: 999 }],
  })

  assert.equal(model.monthly[0].status, 'error')
  assert.equal(model.monthly[0].salaryTotal, null)
  assert.equal(model.monthly[0].projectLaborTotal, null)
  assert.equal(model.projectLaborLifetimeById, null)
  assert.equal(model.lifetimeStatus, 'error')
})

test('a pre-activation exact snapshot aggregates all normalized legacy labor by project', () => {
  const preActivation = bridge({
    salaryMonth: '2026-06', isAuthoritative: false,
    salaryTotal: 0, projectLaborTotal: 0, projectLaborById: {},
    projectLaborLifetimeTotal: 0, projectLaborLifetimeById: {},
    pendingCount: 0, effectiveFrom: '2026-07-01',
  })
  const model = buildLaborCostWindow({
    months: ['2026-06'], snapshotMonth: '2026-06',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-06': preActivation },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-06',
      snapshotStatus: 'ready', snapshotStale: true, updatedAtByMonth: {},
    },
    salaryRecords: [], employees: [],
    laborRecords: [
      { workDate: '2025-12-01', projectId: 'P1', laborCost: 20 },
      { workDate: '2026-06-01', projectId: 'P1', laborCost: 30 },
      { workDate: '2026-06-02', projectId: 'P2', laborCost: 40 },
    ],
  })

  assert.deepEqual(model.projectLaborLifetimeById, { P1: 50, P2: 40 })
  assert.equal(model.lifetimeStale, true)
})

test('legacy labor projections reject non-calendar work dates', () => {
  const preActivation = bridge({
    salaryMonth: '2026-02', isAuthoritative: false,
    salaryTotal: 0, projectLaborTotal: 0, projectLaborById: {},
    projectLaborLifetimeTotal: 0, projectLaborLifetimeById: {},
    pendingCount: 0, effectiveFrom: '2026-07-01',
  })
  const model = buildLaborCostWindow({
    months: ['2026-02'], snapshotMonth: '2026-02',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-02': preActivation },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-02',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [], employees: [],
    laborRecords: [
      { workDate: '2026-01-31', projectId: 'P-HISTORICAL', laborCost: 40 },
      { workDate: '2026-02-28', projectId: 'P-VALID', laborCost: 60 },
      { workDate: '2026-02-31', projectId: 'P-IMPOSSIBLE', laborCost: 80 },
      { workDate: '2026-02-28junk', projectId: 'P-SUFFIX', laborCost: 90 },
    ],
  })

  assert.deepEqual({
    monthTotal: model.monthly[0].projectLaborTotal,
    monthByProject: model.monthly[0].projectLaborById,
    lifetimeByProject: model.projectLaborLifetimeById,
  }, {
    monthTotal: 60,
    monthByProject: { 'P-VALID': 60 },
    lifetimeByProject: { 'P-HISTORICAL': 40, 'P-VALID': 60 },
  })
})

test('legacy salary falls back to active monthly employees only when no month row exists', () => {
  const preActivation = bridge({
    salaryMonth: '2026-06', isAuthoritative: false,
    salaryTotal: 0, projectLaborTotal: 0, projectLaborById: {},
    projectLaborLifetimeTotal: 0, projectLaborLifetimeById: {},
    pendingCount: 0, effectiveFrom: '2026-07-01',
  })
  const base = {
    months: ['2026-06'], snapshotMonth: '2026-06',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-06': preActivation },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-06',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    employees: [
      { employeeId: 'E1', name: 'active', employmentStatus: '在职', salaryType: '月薪', baseSalary: 120 },
      { employeeId: 'E2', name: 'daily', employmentStatus: '在职', salaryType: '日薪', baseSalary: 999 },
      { employeeId: 'E3', name: 'former', employmentStatus: '退职', salaryType: '月薪', baseSalary: 999 },
      { employeeId: 'SUPER_ADMIN', name: 'hidden', employmentStatus: '在职', salaryType: '月薪', baseSalary: 999 },
    ],
    laborRecords: [],
  }

  const fallback = buildLaborCostWindow({ ...base, salaryRecords: [] })
  const persistedZero = buildLaborCostWindow({
    ...base,
    salaryRecords: [{ salaryMonth: '2026-06', netSalary: 0 }],
  })

  assert.equal(fallback.monthly[0].salaryTotal, 120)
  assert.equal(persistedZero.monthly[0].salaryTotal, 0)
})

test('projection inputs fail closed when snapshot identity or top-level collections are invalid', () => {
  const valid = {
    months: ['2026-07'], snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-07': bridge() },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-07',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [], employees: [], laborRecords: [],
  }

  for (const input of [
    null,
    { ...valid, months: ['2026-7'] },
    { ...valid, months: ['2026-07', '2026-07'] },
    { ...valid, snapshotMonth: '2101-01' },
    { ...valid, bridgeState: { ...valid.bridgeState, snapshotMonth: '2026-06' } },
    { ...valid, salaryRecords: null },
    { ...valid, employees: {} },
    { ...valid, laborRecords: 'invalid' },
  ]) {
    assert.throws(() => buildLaborCostWindow(input), TypeError)
  }
})

test('projection snapshots required own data fields without invoking or rereading input accessors', () => {
  const valid = {
    months: ['2026-07'], snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'ready', data: { '2026-07': bridge() },
      windowIncompleteMonths: [], windowStaleMonths: [], snapshotMonth: '2026-07',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [], employees: [], laborRecords: [],
  }

  assert.throws(() => buildLaborCostWindow(Object.create(valid)), TypeError)

  let accessorCalls = 0
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'months', {
    enumerable: true,
    get() {
      accessorCalls += 1
      return valid.months
    },
  })
  assert.throws(() => buildLaborCostWindow(accessor), TypeError)
  assert.equal(accessorCalls, 0)

  let ordinaryReads = 0
  const observed = new Proxy(valid, {
    get(target, key, receiver) {
      ordinaryReads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  const observedModel = buildLaborCostWindow(observed)
  assert.equal(observedModel.monthly[0].status, 'ready')
  assert.equal(ordinaryReads, 0)

  const nullPrototype = Object.assign(Object.create(null), valid)
  const nullPrototypeModel = buildLaborCostWindow(nullPrototype)
  assert.equal(nullPrototypeModel.monthly[0].status, 'ready')
})

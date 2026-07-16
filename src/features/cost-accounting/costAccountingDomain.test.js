import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCostAccountingReadModel,
  classifyManualProjectCosts,
} from './costAccountingDomain.js'

function laborWindow(overrides = {}) {
  return {
    monthly: [{
      month: '2026-07',
      status: 'ready',
      stale: false,
      salaryTotal: 300000,
      projectLaborTotal: 200000,
      projectLaborById: { P1: 200000 },
      source: 'formal',
      pendingCount: 0,
    }],
    projectLaborLifetimeById: { P1: 300000 },
    lifetimeStatus: 'ready',
    lifetimeStale: false,
    incompleteMonths: [],
    staleMonths: [],
    ...overrides,
  }
}

function julyFixture(overrides = {}) {
  return {
    months: ['2026-07'],
    selectedMonth: '2026-07',
    projectId: 'all',
    activeProjectIds: ['P1'],
    laborWindow: laborWindow(),
    purchaseRows: [{
      purchaseId: 'PO-1',
      purchaseDate: '2026-07-03',
      projectId: 'P1',
      purchaseStatus: '正常',
      totalCost: 80000,
    }],
    fuelRecords: [{
      fuelRecordId: 'F-1',
      fuelDate: '2026-07-04',
      fuelDateSource: 'recorded',
      paymentMethod: '现金',
      paymentMethodSource: 'recorded',
      fuelAmount: 5000,
      allocateToProject: true,
      projectId: 'P1',
    }],
    vehicleExpenseRecords: [{
      vehicleExpenseId: 'VE-1',
      expenseDate: '2026-07-05',
      expenseDateSource: 'recorded',
      paymentMethod: '卡',
      paymentMethodSource: 'recorded',
      amount: 7000,
      allocateToProject: true,
      projectId: 'P1',
    }],
    vehicleIssueRecords: [{
      issueId: 'VI-1',
      issueDate: '2026-07-06',
      repairCost: 9000,
      allocateToProject: true,
      projectId: 'P1',
    }],
    manualProjectCosts: [
      ['M-L', '人工费', 1000],
      ['M-M', '材料费', 2000],
      ['M-T', '工具费', 3000],
      ['M-V', '车辆费', 4000],
      ['M-O', '外包费', 20000],
      ['M-R', '运输费', 15000],
      ['M-X', '其他费用', 10000],
    ].map(([costRecordId, costType, amount]) => ({
      costRecordId,
      costType,
      amount,
      projectId: 'P1',
      date: '2026-07-07',
    })),
    operatingExpenses: [{
      operatingExpenseId: 'OE-1',
      date: '2026-07-08',
      amount: 5000,
      allocateToProject: true,
      projectId: 'P1',
    }],
    ...overrides,
  }
}

test('manual project costs have one explicit confirmed-or-pending classification', () => {
  const records = julyFixture().manualProjectCosts
  const original = structuredClone(records)

  const classified = classifyManualProjectCosts(records)

  assert.deepEqual(
    classified.confirmedRows.map((row) => row.costRecordId),
    ['M-O', 'M-R', 'M-X'],
  )
  assert.deepEqual(classified.manualLaborCosts.map((row) => row.costRecordId), ['M-L'])
  assert.deepEqual(classified.manualMaterialCosts.map((row) => row.costRecordId), ['M-M'])
  assert.deepEqual(classified.manualToolCosts.map((row) => row.costRecordId), ['M-T'])
  assert.deepEqual(classified.manualVehicleCosts.map((row) => row.costRecordId), ['M-V'])
  assert.deepEqual(records, original)
})

test('manual classification snapshots isolate caller and output mutations in both directions', () => {
  const records = [
    {
      costRecordId: 'M-CONFIRMED', costType: '外包费', amount: 10,
      projectId: 'P1', date: '2026-07-01', metadata: { source: 'caller' },
    },
    {
      costRecordId: 'M-PENDING', costType: '人工费', amount: 20,
      projectId: 'P1', date: '2026-07-01', metadata: { source: 'caller' },
    },
  ]
  const classified = classifyManualProjectCosts(records)

  classified.confirmedRows[0].amount = 999
  classified.confirmedRows[0].metadata.source = 'output'
  assert.equal(records[0].amount, 10)
  assert.equal(records[0].metadata.source, 'caller')

  records[1].amount = 888
  records[1].metadata.source = 'input'
  assert.equal(classified.manualLaborCosts[0].amount, 20)
  assert.equal(classified.manualLaborCosts[0].metadata.source, 'caller')
})

test('canonical July model counts authoritative accrual facts once and keeps estimates pending', () => {
  const model = buildCostAccountingReadModel(julyFixture())

  assert.equal(model.companyMonthlyTotal.salary, 300000)
  assert.equal(model.companyMonthlyTotal.purchase, 80000)
  assert.equal(model.companyMonthlyTotal.vehicle, 12000)
  assert.equal(model.companyMonthlyTotal.manual, 45000)
  assert.equal(model.companyMonthlyTotal.operating, 5000)
  assert.equal(model.companyMonthlyTotal.total, 442000)
  assert.equal(model.monthlyByMonth['2026-07'].total, 442000)
  assert.equal(model.selectedComposition.labor, 300000)
  assert.equal(model.pending.manualLaborCosts.length, 1)
  assert.equal(model.pending.manualMaterialCosts.length, 1)
  assert.equal(model.pending.manualToolCosts.length, 1)
  assert.equal(model.pending.manualVehicleCosts.length, 1)
  assert.equal(model.pending.vehicleRepairEstimates.length, 1)
  assert.deepEqual(model.projectLifetimeById.P1, {
    labor: 300000,
    purchase: 80000,
    vehicle: 12000,
    manual: 45000,
    operating: 5000,
    total: 442000,
  })
  assert.deepEqual(model.anomalies, [])
})

test('cost model snapshots isolate pending rows and selected-month sibling branches', () => {
  const manualProjectCosts = julyFixture().manualProjectCosts.map((row) => ({
    ...row,
    metadata: { source: 'caller' },
  }))
  const input = julyFixture({ manualProjectCosts })
  const model = buildCostAccountingReadModel(input)

  model.pending.manualLaborCosts[0].amount = 999
  model.pending.manualLaborCosts[0].metadata.source = 'output'
  assert.equal(manualProjectCosts[0].amount, 1000)
  assert.equal(manualProjectCosts[0].metadata.source, 'caller')

  manualProjectCosts[1].amount = 888
  manualProjectCosts[1].metadata.source = 'input'
  assert.equal(model.pending.manualMaterialCosts[0].amount, 2000)
  assert.equal(model.pending.manualMaterialCosts[0].metadata.source, 'caller')

  model.companyMonthlyTotal.salary = 1
  assert.equal(model.monthlyByMonth['2026-07'].salary, 300000)
  model.monthlyByMonth['2026-07'].purchase = 2
  assert.equal(model.companyMonthlyTotal.purchase, 80000)
})

test('project composition uses project labor and explicit allocations while company facts stay company-only', () => {
  const input = julyFixture({
    projectId: 'P1',
    operatingExpenses: [
      ...julyFixture().operatingExpenses,
      {
        operatingExpenseId: 'OE-COMPANY',
        date: '2026-07-09',
        amount: 6000,
        allocateToProject: false,
        projectId: 'P1',
      },
    ],
  })

  const model = buildCostAccountingReadModel(input)

  assert.equal(model.companyMonthlyTotal.salary, 300000)
  assert.equal(model.companyMonthlyTotal.operating, 11000)
  assert.equal(model.selectedComposition.labor, 200000)
  assert.equal(model.selectedComposition.operating, 5000)
  assert.equal(model.selectedComposition.total, 342000)
  assert.equal(model.projectLifetimeById.P1.operating, 5000)
  assert.equal(
    model.anomalies.some(({ source, recordId, code }) =>
      source === 'operatingExpenses' && recordId === 'OE-COMPANY' &&
      code === 'ignored_project_fields'),
    true,
  )
})

test('monthly rows use only the requested window while project lifetime uses all supplied historical facts', () => {
  const input = julyFixture({
    purchaseRows: [
      ...julyFixture().purchaseRows,
      {
        purchaseId: 'PO-HISTORICAL',
        purchaseDate: '2026-06-30',
        projectId: 'P1',
        purchaseStatus: '正常',
        totalCost: 20000,
      },
    ],
    operatingExpenses: [
      ...julyFixture().operatingExpenses,
      {
        operatingExpenseId: 'OE-HISTORICAL',
        date: '2026-05-10',
        amount: 3000,
        allocateToProject: true,
        projectId: 'P1',
      },
    ],
  })

  const model = buildCostAccountingReadModel(input)

  assert.deepEqual(Object.keys(model.monthlyByMonth), ['2026-07'])
  assert.equal(model.companyMonthlyTotal.purchase, 80000)
  assert.equal(model.companyMonthlyTotal.operating, 5000)
  assert.equal(model.projectLifetimeById.P1.purchase, 100000)
  assert.equal(model.projectLifetimeById.P1.operating, 8000)

  const sameFactsDifferentWindow = buildCostAccountingReadModel({
    ...input,
    months: ['2026-06'],
    selectedMonth: '2026-06',
    laborWindow: laborWindow({
      monthly: [{
        month: '2026-06', status: 'ready', stale: false,
        salaryTotal: 100000, projectLaborTotal: 50000,
        projectLaborById: { P1: 50000 }, source: 'formal', pendingCount: 0,
      }],
    }),
  })
  assert.deepEqual(sameFactsDifferentWindow.projectLifetimeById, model.projectLifetimeById)
})

test('an incomplete labor month remains visibly incomplete instead of fabricating zero labor', () => {
  const model = buildCostAccountingReadModel(julyFixture({
    projectId: 'P1',
    laborWindow: laborWindow({
      monthly: [{
        month: '2026-07', status: 'error', stale: false,
        salaryTotal: null, projectLaborTotal: null,
        projectLaborById: null, source: null, pendingCount: null,
      }],
      incompleteMonths: ['2026-07'],
    }),
  }))

  assert.equal(model.monthlyByMonth['2026-07'].salary, null)
  assert.equal(model.monthlyByMonth['2026-07'].total, null)
  assert.equal(model.monthlyByMonth['2026-07'].incomplete, true)
  assert.equal(model.selectedComposition.labor, null)
  assert.equal(model.selectedComposition.total, null)
  assert.equal(model.anomalies.some(({ code }) => code === 'incomplete_labor_month'), true)
})

test('an explicit incomplete marker overrides an otherwise ready labor row exactly once', () => {
  const model = buildCostAccountingReadModel(julyFixture({
    projectId: 'P1',
    laborWindow: laborWindow({
      incompleteMonths: ['2026-07', '2026-07'],
    }),
  }))

  assert.equal(model.companyMonthlyTotal.salary, null)
  assert.equal(model.companyMonthlyTotal.laborStatus, 'error')
  assert.equal(model.companyMonthlyTotal.incomplete, true)
  assert.equal(model.selectedComposition.labor, null)
  assert.equal(model.selectedComposition.total, null)
  assert.equal(
    model.anomalies.filter(({ code, recordId }) =>
      code === 'incomplete_labor_month' && recordId === '2026-07').length,
    1,
  )
})

test('unsafe, duplicate, inactive, invalid-date, malformed, and overflowing facts fail closed', () => {
  let accessorReads = 0
  const accessorRow = { purchaseId: 'PO-ACCESSOR', purchaseDate: '2026-07-11', projectId: 'P1' }
  Object.defineProperty(accessorRow, 'totalCost', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 700
    },
  })
  const inheritedRow = Object.create({
    purchaseId: 'PO-INHERITED', purchaseDate: '2026-07-11',
    projectId: 'P1', totalCost: 800,
  })
  const pollutedProject = Object.assign(Object.create(null), {
    purchaseId: 'PO-POLLUTION', purchaseDate: '2026-07-11',
    projectId: '__proto__', totalCost: 900,
  })

  const model = buildCostAccountingReadModel(julyFixture({
    laborWindow: laborWindow({
      monthly: [{
        month: '2026-07', status: 'ready', stale: false,
        salaryTotal: 0, projectLaborTotal: 0,
        projectLaborById: {}, source: 'formal', pendingCount: 0,
      }],
      projectLaborLifetimeById: {},
    }),
    purchaseRows: [
      { purchaseId: 'PO-MAX', purchaseDate: '2026-07-01', projectId: 'P1', purchaseStatus: '正常', totalCost: Number.MAX_SAFE_INTEGER },
      { purchaseId: 'PO-OVERFLOW', purchaseDate: '2026-07-02', projectId: 'P1', purchaseStatus: '正常', totalCost: 1 },
      { purchaseId: 'PO-DUP', purchaseDate: '2026-07-03', projectId: 'P1', purchaseStatus: '正常', totalCost: 0 },
      { purchaseId: 'PO-DUP', purchaseDate: '2026-07-03', projectId: 'P1', purchaseStatus: '正常', totalCost: 999 },
      { purchaseId: 'PO-VOID', purchaseDate: '2026-07-03', projectId: 'P1', purchaseStatus: '作废', totalCost: 999 },
      { purchaseId: 'PO-FRACTION', purchaseDate: '2026-07-03', projectId: 'P1', purchaseStatus: '正常', totalCost: 1.5 },
      { purchaseId: 'PO-STRING', purchaseDate: '2026-07-03', projectId: 'P1', purchaseStatus: '正常', totalCost: '2' },
      { purchaseId: 'PO-DATE', purchaseDate: '2026-02-30', projectId: 'P1', purchaseStatus: '正常', totalCost: 3 },
      accessorRow,
      inheritedRow,
      pollutedProject,
    ],
    fuelRecords: [],
    vehicleExpenseRecords: [],
    vehicleIssueRecords: [],
    manualProjectCosts: [],
    operatingExpenses: [],
  }))

  assert.equal(accessorReads, 0)
  assert.equal(model.companyMonthlyTotal.purchase, Number.MAX_SAFE_INTEGER)
  assert.equal(Number.isSafeInteger(model.companyMonthlyTotal.total), true)
  assert.equal(Object.hasOwn(model.projectLifetimeById, '__proto__'), false)
  assert.deepEqual(
    new Set(model.anomalies.map(({ code }) => code)),
    new Set([
      'amount_overflow', 'duplicate_record_id', 'inactive_record', 'invalid_amount',
      'invalid_date', 'malformed_row', 'invalid_project',
    ]),
  )
})

test('a lifetime overflow does not erase the same valid fact from its monthly aggregates', () => {
  const zeroLabor = laborWindow({
    monthly: [{
      month: '2026-07', status: 'ready', stale: false,
      salaryTotal: 0, projectLaborTotal: 0,
      projectLaborById: {}, source: 'formal', pendingCount: 0,
    }],
    projectLaborLifetimeById: {},
  })
  const model = buildCostAccountingReadModel(julyFixture({
    laborWindow: zeroLabor,
    purchaseRows: [
      {
        purchaseId: 'PO-HISTORICAL-MAX', purchaseDate: '2026-06-01',
        projectId: 'P1', purchaseStatus: '正常', totalCost: Number.MAX_SAFE_INTEGER,
      },
      {
        purchaseId: 'PO-JULY', purchaseDate: '2026-07-01',
        projectId: 'P1', purchaseStatus: '正常', totalCost: 1,
      },
    ],
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    manualProjectCosts: [], operatingExpenses: [],
  }))

  assert.equal(model.companyMonthlyTotal.purchase, 1)
  assert.equal(model.selectedComposition.purchase, 1)
  assert.equal(model.projectLifetimeById.P1.purchase, Number.MAX_SAFE_INTEGER)
  assert.equal(model.anomalies.some(({ code }) => code === 'amount_overflow'), true)
})

test('a ready labor row with a mismatched project total stays incomplete', () => {
  const model = buildCostAccountingReadModel(julyFixture({
    projectId: 'P1',
    laborWindow: laborWindow({
      monthly: [{
        month: '2026-07', status: 'ready', stale: false,
        salaryTotal: 300000, projectLaborTotal: 0,
        projectLaborById: { P1: 200000 }, source: 'formal', pendingCount: 0,
      }],
    }),
  }))

  assert.equal(model.companyMonthlyTotal.salary, null)
  assert.equal(model.selectedComposition.labor, null)
  assert.equal(model.anomalies.some(({ code }) => code === 'incomplete_labor_month'), true)
})

test('duplicate labor months are deterministic first-wins and reported once', () => {
  const first = {
    month: '2026-07', status: 'ready', stale: false,
    salaryTotal: 0, projectLaborTotal: 0,
    projectLaborById: { P1: 0 }, source: 'formal', pendingCount: 0,
  }
  const second = {
    ...first,
    salaryTotal: 300000,
    projectLaborTotal: 200000,
    projectLaborById: { P1: 200000 },
  }
  const model = buildCostAccountingReadModel(julyFixture({
    projectId: 'P1',
    laborWindow: laborWindow({ monthly: [first, second, second] }),
  }))

  assert.equal(model.companyMonthlyTotal.salary, 0)
  assert.equal(model.selectedComposition.labor, 0)
  assert.equal(
    model.anomalies.filter(({ code, recordId }) =>
      code === 'duplicate_labor_month' && recordId === '2026-07').length,
    1,
  )
})

test('reserved all is rejected from monthly and lifetime labor allocation maps', () => {
  const model = buildCostAccountingReadModel(julyFixture({
    projectId: 'P1',
    laborWindow: laborWindow({
      monthly: [{
        month: '2026-07', status: 'ready', stale: false,
        salaryTotal: 300000, projectLaborTotal: 200000,
        projectLaborById: { all: 200000 }, source: 'formal', pendingCount: 0,
      }],
      projectLaborLifetimeById: { all: 300000 },
    }),
  }))

  assert.equal(model.companyMonthlyTotal.salary, null)
  assert.equal(model.selectedComposition.labor, null)
  assert.equal(model.projectLifetimeById.P1.labor, null)
  assert.equal(model.projectLifetimeById.P1.total, null)
  assert.equal(model.anomalies.some(({ code }) => code === 'incomplete_labor_month'), true)
  assert.equal(model.anomalies.some(({ code }) => code === 'incomplete_labor_lifetime'), true)
})

test('top-level input is an exact own-data contract and never invokes accessors', () => {
  const valid = julyFixture()
  assert.throws(() => buildCostAccountingReadModel(null), TypeError)
  assert.throws(() => buildCostAccountingReadModel({ ...valid, unexpected: [] }), TypeError)
  const { months: _months, ...missing } = valid
  assert.throws(() => buildCostAccountingReadModel(missing), TypeError)
  assert.throws(() => buildCostAccountingReadModel(Object.create(valid)), TypeError)

  let accessorReads = 0
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'months', {
    enumerable: true,
    get() {
      accessorReads += 1
      return valid.months
    },
  })
  assert.throws(() => buildCostAccountingReadModel(accessor), TypeError)
  assert.equal(accessorReads, 0)

  const symbolInput = { ...valid, [Symbol('expanded')]: true }
  assert.throws(() => buildCostAccountingReadModel(symbolInput), TypeError)
  assert.throws(() => buildCostAccountingReadModel({
    ...valid,
    laborWindow: laborWindow({ incompleteMonths: ['2026-7'] }),
  }), TypeError)
  assert.throws(() => buildCostAccountingReadModel({
    ...valid,
    activeProjectIds: ['all'],
  }), TypeError)

  let arrayReads = 0
  const observedMonths = new Proxy(['2026-07'], {
    get(target, key, receiver) {
      arrayReads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  assert.equal(buildCostAccountingReadModel({ ...valid, months: observedMonths })
    .companyMonthlyTotal.total, 442000)
  assert.equal(arrayReads, 0)
})

test('invalid record identifiers are reported without invoking user coercion hooks', () => {
  let coercionCalls = 0
  const hostileId = {
    toString() {
      coercionCalls += 1
      return 'PO-HOSTILE'
    },
  }
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: [{
      purchaseId: hostileId, purchaseDate: '2026-07-01',
      projectId: 'P1', purchaseStatus: '正常', totalCost: 1,
    }],
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    manualProjectCosts: [], operatingExpenses: [],
  }))

  assert.equal(coercionCalls, 0)
  assert.equal(model.companyMonthlyTotal.purchase, 0)
  assert.equal(model.anomalies.some(({ code }) => code === 'invalid_record_id'), true)
})

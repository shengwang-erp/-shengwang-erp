import assert from 'node:assert/strict'
import test from 'node:test'

import { buildRecordedCashFlow } from './recordedCashFlowDomain.js'

function laborWindow() {
  return {
    monthly: [{
      month: '2026-07', status: 'ready', stale: false,
      salaryTotal: 300000, projectLaborTotal: 200000,
      projectLaborById: { P1: 200000 }, source: 'formal', pendingCount: 0,
    }],
    projectLaborLifetimeById: { P1: 300000 },
    lifetimeStatus: 'ready',
    lifetimeStale: false,
    incompleteMonths: [],
    staleMonths: [],
  }
}

function cashFixture(overrides = {}) {
  return {
    months: ['2026-07'],
    projectId: 'P1',
    activeProjectIds: ['P1'],
    receipts: [
      {
        receiptId: 'R-1', projectId: 'P1', statusCode: 'active',
        receivedDate: '2026-07-10', taxInclusiveAmount: 150000,
      },
      {
        receiptId: 'R-VOID', projectId: 'P1', statusCode: 'void',
        receivedDate: '2026-07-11', taxInclusiveAmount: 999999,
      },
      {
        receiptId: 'R-1', projectId: 'P1', statusCode: 'active',
        receivedDate: '2026-07-12', taxInclusiveAmount: 80000,
      },
      {
        receiptId: 'R-DATE', projectId: 'P1', statusCode: 'active',
        receivedDate: '2026-02-30', taxInclusiveAmount: 1000,
      },
      {
        receiptId: 'R-UNBOUND', projectId: '', statusCode: 'active',
        receivedDate: '2026-07-13', taxInclusiveAmount: 5000,
      },
    ],
    purchasePaymentRows: [{
      paymentId: 'PP-1',
      projectId: 'P1',
      paymentDate: '2026-07-14',
      paymentDateSource: 'recorded',
      paymentDateLegacyInferred: true,
      jpyAmount: 40000,
    }],
    fuelRecords: [{
      fuelRecordId: 'F-DEFAULTED',
      projectId: 'P1',
      allocateToProject: true,
      fuelDate: '2026-07-15',
      fuelDateSource: 'defaulted',
      paymentMethod: '现金',
      paymentMethodSource: 'defaulted',
      fuelAmount: 9000,
    }],
    vehicleExpenseRecords: [{
      vehicleExpenseId: 'VE-1',
      projectId: 'P1',
      allocateToProject: true,
      expenseDate: '2026-07-16',
      expenseDateSource: 'recorded',
      paymentMethod: '卡',
      paymentMethodSource: 'recorded',
      amount: 7000,
    }],
    laborWindow: laborWindow(),
    operatingExpenses: [{
      operatingExpenseId: 'OE-1', date: '2026-07-08', amount: 5000,
      allocateToProject: true, projectId: 'P1',
    }],
    manualProjectCosts: [{
      costRecordId: 'M-1', date: '2026-07-07', amount: 20000,
      costType: '外包费', projectId: 'P1',
    }],
    vehicleIssueRecords: [{
      issueId: 'VI-1', issueDate: '2026-07-06', repairCost: 9000,
      allocateToProject: true, projectId: 'P1',
    }],
    ...overrides,
  }
}

test('recorded project cash includes only active receipts and recorded-provenance outflows', () => {
  const model = buildRecordedCashFlow(cashFixture())

  assert.deepEqual(model.series, [{
    month: '2026-07',
    income: 150000,
    purchaseOutflow: 40000,
    vehicleOutflow: 7000,
    totalOutflow: 47000,
    net: 103000,
  }])
  assert.deepEqual(model.coverage, [
    {
      code: 'salary_payment_missing',
      label: '工资付款日期未记录',
      excludedCount: 1,
      note: '工资仅进入权责成本，不推测付款日期。',
    },
    {
      code: 'operating_payment_missing',
      label: '经营费用付款事实未记录',
      excludedCount: 1,
      note: '经营费用仅有发生日期，不进入已记录现金流。',
    },
    {
      code: 'manual_payment_missing',
      label: '手工项目成本付款事实未记录',
      excludedCount: 1,
      note: '手工项目成本没有付款状态，不进入已记录现金流。',
    },
    {
      code: 'repair_payment_missing',
      label: '维修估算付款事实未记录',
      excludedCount: 1,
      note: '车辆异常维修金额仅为估算，不进入已记录现金流。',
    },
    {
      code: 'historical_default_ambiguity',
      label: '历史现金来源存在兼容推断',
      excludedCount: 1,
      note: '旧记录的日期或付款方式来源无法反向确认。',
    },
    {
      code: 'missing_payment_date',
      label: '付款日期或方式缺少已记录来源',
      excludedCount: 1,
      note: '兼容默认日期或付款方式不具备现金资格。',
    },
  ])
  assert.deepEqual(
    model.anomalies.map(({ source, recordId, code }) => ({ source, recordId, code })),
    [
      { source: 'receipts', recordId: 'R-VOID', code: 'inactive_record' },
      { source: 'receipts', recordId: 'R-1', code: 'duplicate_record_id' },
      { source: 'receipts', recordId: 'R-DATE', code: 'invalid_date' },
      { source: 'receipts', recordId: 'R-UNBOUND', code: 'missing_project' },
    ],
  )
})

test('coverage-only labor, operating, manual, and repair facts never enter cash totals', () => {
  const input = cashFixture({
    receipts: [], purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
  })

  const model = buildRecordedCashFlow(input)

  assert.deepEqual(model.series, [{
    month: '2026-07', income: 0, purchaseOutflow: 0,
    vehicleOutflow: 0, totalOutflow: 0, net: 0,
  }])
  assert.deepEqual(
    Object.fromEntries(model.coverage.map(({ code, excludedCount }) => [code, excludedCount])),
    {
      salary_payment_missing: 1,
      operating_payment_missing: 1,
      manual_payment_missing: 1,
      repair_payment_missing: 1,
      historical_default_ambiguity: 0,
      missing_payment_date: 0,
    },
  )
})

test('salary coverage excludes a requested month explicitly marked incomplete', () => {
  const incompleteLaborWindow = {
    ...laborWindow(),
    incompleteMonths: ['2026-07', '2026-07'],
  }
  const model = buildRecordedCashFlow(cashFixture({
    receipts: [], purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
    laborWindow: incompleteLaborWindow,
    operatingExpenses: [], manualProjectCosts: [], vehicleIssueRecords: [],
  }))

  const coverage = Object.fromEntries(
    model.coverage.map(({ code, excludedCount }) => [code, excludedCount]),
  )
  assert.equal(coverage.salary_payment_missing, 0)
  assert.equal(
    model.anomalies.filter(({ code, recordId }) =>
      code === 'incomplete_labor_month' && recordId === '2026-07').length,
    1,
  )
})

test('salary coverage uses the first duplicate labor month and reports one anomaly', () => {
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
  const model = buildRecordedCashFlow(cashFixture({
    receipts: [], purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
    laborWindow: { ...laborWindow(), monthly: [first, second, second] },
    operatingExpenses: [], manualProjectCosts: [], vehicleIssueRecords: [],
  }))

  const salaryCoverage = model.coverage.find(
    ({ code }) => code === 'salary_payment_missing',
  )
  assert.equal(salaryCoverage.excludedCount, 0)
  assert.equal(
    model.anomalies.filter(({ code, recordId }) =>
      code === 'duplicate_labor_month' && recordId === '2026-07').length,
    1,
  )
})

test('salary coverage rejects reserved all in monthly and lifetime labor maps', () => {
  const model = buildRecordedCashFlow(cashFixture({
    projectId: 'all',
    receipts: [], purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
    laborWindow: {
      ...laborWindow(),
      monthly: [{
        month: '2026-07', status: 'ready', stale: false,
        salaryTotal: 300000, projectLaborTotal: 200000,
        projectLaborById: { all: 200000 }, source: 'formal', pendingCount: 0,
      }],
      projectLaborLifetimeById: { all: 300000 },
    },
    operatingExpenses: [], manualProjectCosts: [], vehicleIssueRecords: [],
  }))

  const salaryCoverage = model.coverage.find(
    ({ code }) => code === 'salary_payment_missing',
  )
  assert.equal(salaryCoverage.excludedCount, 0)
  assert.equal(model.anomalies.some(({ code }) => code === 'invalid_labor_project_map'), true)
  assert.equal(model.anomalies.some(({ code }) => code === 'invalid_labor_lifetime_map'), true)
})

test('salary coverage rejects ready labor rows with non-enum source values', () => {
  for (const source of [{ unsafe: true }, () => {}, 'other', null]) {
    const model = buildRecordedCashFlow(cashFixture({
      receipts: [], purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
      laborWindow: {
        ...laborWindow(),
        monthly: [{
          month: '2026-07', status: 'ready', stale: false,
          salaryTotal: 300000, projectLaborTotal: 200000,
          projectLaborById: { P1: 200000 }, source, pendingCount: 0,
        }],
      },
      operatingExpenses: [], manualProjectCosts: [], vehicleIssueRecords: [],
    }))

    const salaryCoverage = model.coverage.find(
      ({ code }) => code === 'salary_payment_missing',
    )
    assert.equal(salaryCoverage.excludedCount, 0)
    assert.equal(model.anomalies.some(({ code }) => code === 'invalid_labor_source'), true)
  }
})

test('project coverage and cash scope exclude company-only and other-project facts', () => {
  const projectModel = buildRecordedCashFlow(cashFixture({
    activeProjectIds: ['P1', 'P2'],
    receipts: [
      { receiptId: 'R-P1', projectId: 'P1', receivedDate: '2026-07-01', taxInclusiveAmount: 100 },
      { receiptId: 'R-P2', projectId: 'P2', receivedDate: '2026-07-01', taxInclusiveAmount: 200 },
    ],
    operatingExpenses: [
      { operatingExpenseId: 'OE-P1', date: '2026-07-02', amount: 10, allocateToProject: true, projectId: 'P1' },
      { operatingExpenseId: 'OE-P2', date: '2026-07-02', amount: 20, allocateToProject: true, projectId: 'P2' },
      { operatingExpenseId: 'OE-COMPANY', date: '2026-07-02', amount: 30, allocateToProject: false, projectId: '' },
    ],
    manualProjectCosts: [
      { costRecordId: 'M-P1', date: '2026-07-03', amount: 10, costType: '外包费', projectId: 'P1' },
      { costRecordId: 'M-P2', date: '2026-07-03', amount: 20, costType: '外包费', projectId: 'P2' },
    ],
    vehicleIssueRecords: [
      { issueId: 'VI-P1', issueDate: '2026-07-04', repairCost: 10, allocateToProject: true, projectId: 'P1' },
      { issueId: 'VI-P2', issueDate: '2026-07-04', repairCost: 20, allocateToProject: true, projectId: 'P2' },
      { issueId: 'VI-COMPANY', issueDate: '2026-07-04', repairCost: 30, allocateToProject: false, projectId: '' },
    ],
  }))

  assert.equal(projectModel.series[0].income, 100)
  const coverage = Object.fromEntries(
    projectModel.coverage.map(({ code, excludedCount }) => [code, excludedCount]),
  )
  assert.equal(coverage.salary_payment_missing, 1)
  assert.equal(coverage.operating_payment_missing, 1)
  assert.equal(coverage.manual_payment_missing, 1)
  assert.equal(coverage.repair_payment_missing, 1)
})

test('all-project coverage keeps an invalid operating allocation as one company-only fact', () => {
  const model = buildRecordedCashFlow(cashFixture({
    projectId: 'all',
    receipts: [], purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
    operatingExpenses: [{
      operatingExpenseId: 'OE-MISSING-PROJECT', date: '2026-07-02', amount: 10,
      allocateToProject: true, projectId: '',
    }],
    manualProjectCosts: [], vehicleIssueRecords: [],
  }))

  const coverage = Object.fromEntries(
    model.coverage.map(({ code, excludedCount }) => [code, excludedCount]),
  )
  assert.equal(coverage.operating_payment_missing, 1)
  assert.equal(model.anomalies.some(({ code }) => code === 'missing_project'), true)
})

test('cash rows reject unsafe money, overflow, duplicates, inactive rows, malformed rows, and invalid projects', () => {
  let accessorReads = 0
  const accessor = { receiptId: 'R-ACCESSOR', projectId: 'P1', receivedDate: '2026-07-01' }
  Object.defineProperty(accessor, 'taxInclusiveAmount', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 1
    },
  })
  const inherited = Object.create({
    receiptId: 'R-INHERITED', projectId: 'P1',
    receivedDate: '2026-07-01', taxInclusiveAmount: 1,
  })

  const model = buildRecordedCashFlow(cashFixture({
    receipts: [
      { receiptId: 'R-MAX', projectId: 'P1', receivedDate: '2026-07-01', taxInclusiveAmount: Number.MAX_SAFE_INTEGER },
      { receiptId: 'R-OVERFLOW', projectId: 'P1', receivedDate: '2026-07-02', taxInclusiveAmount: 1 },
      { receiptId: 'R-DUP', projectId: 'P1', receivedDate: '2026-07-03', taxInclusiveAmount: 0 },
      { receiptId: 'R-DUP', projectId: 'P1', receivedDate: '2026-07-03', taxInclusiveAmount: 20 },
      { receiptId: 'R-DELETED', projectId: 'P1', receivedDate: '2026-07-03', taxInclusiveAmount: 20, status: 'deleted' },
      { receiptId: 'R-NEG', projectId: 'P1', receivedDate: '2026-07-03', taxInclusiveAmount: -1 },
      { receiptId: 'R-FRACTION', projectId: 'P1', receivedDate: '2026-07-03', taxInclusiveAmount: 1.5 },
      { receiptId: 'R-STRING', projectId: 'P1', receivedDate: '2026-07-03', taxInclusiveAmount: '2' },
      { receiptId: 'R-POLLUTION', projectId: 'constructor', receivedDate: '2026-07-03', taxInclusiveAmount: 2 },
      accessor,
      inherited,
    ],
    purchasePaymentRows: [], fuelRecords: [], vehicleExpenseRecords: [],
    operatingExpenses: [], manualProjectCosts: [], vehicleIssueRecords: [],
  }))

  assert.equal(accessorReads, 0)
  assert.equal(model.series[0].income, Number.MAX_SAFE_INTEGER)
  assert.equal(Number.isSafeInteger(model.series[0].net), true)
  assert.deepEqual(
    new Set(model.anomalies.map(({ code }) => code)),
    new Set([
      'amount_overflow', 'duplicate_record_id', 'inactive_record',
      'invalid_amount', 'invalid_project', 'malformed_row',
    ]),
  )
})

test('top-level cash input is exact own data and rejects accessors without reading them', () => {
  const valid = cashFixture()
  assert.throws(() => buildRecordedCashFlow(null), TypeError)
  assert.throws(() => buildRecordedCashFlow({ ...valid, selectedMonth: '2026-07' }), TypeError)
  const { receipts: _receipts, ...missing } = valid
  assert.throws(() => buildRecordedCashFlow(missing), TypeError)
  assert.throws(() => buildRecordedCashFlow(Object.create(valid)), TypeError)

  let accessorReads = 0
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'months', {
    enumerable: true,
    get() {
      accessorReads += 1
      return valid.months
    },
  })
  assert.throws(() => buildRecordedCashFlow(accessor), TypeError)
  assert.equal(accessorReads, 0)

  assert.throws(
    () => buildRecordedCashFlow({ ...valid, [Symbol('expanded')]: true }),
    TypeError,
  )
  assert.throws(() => buildRecordedCashFlow({
    ...valid,
    laborWindow: { ...laborWindow(), incompleteMonths: ['2026-7'] },
  }), TypeError)
  assert.throws(() => buildRecordedCashFlow({
    ...valid,
    projectId: 'all',
    activeProjectIds: ['all'],
  }), TypeError)

  let arrayReads = 0
  const observedMonths = new Proxy(['2026-07'], {
    get(target, key, receiver) {
      arrayReads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  assert.equal(buildRecordedCashFlow({ ...valid, months: observedMonths }).series.length, 1)
  assert.equal(arrayReads, 0)
})

test('cash provenance and invalid identifiers are inspected without ordinary reads or coercion', () => {
  let rowReads = 0
  const observedVehicle = new Proxy({
    vehicleExpenseId: 'VE-OBSERVED', projectId: 'P1', allocateToProject: true,
    expenseDate: '2026-07-01', expenseDateSource: 'recorded',
    paymentMethod: '卡', paymentMethodSource: 'recorded', amount: 50,
  }, {
    get(target, key, receiver) {
      rowReads += 1
      return Reflect.get(target, key, receiver)
    },
  })
  let coercionCalls = 0
  const hostileId = {
    toString() {
      coercionCalls += 1
      return 'R-HOSTILE'
    },
  }
  const model = buildRecordedCashFlow(cashFixture({
    receipts: [{
      receiptId: hostileId, projectId: 'P1',
      receivedDate: '2026-07-01', taxInclusiveAmount: 10,
    }],
    purchasePaymentRows: [], fuelRecords: [],
    vehicleExpenseRecords: [observedVehicle],
    operatingExpenses: [], manualProjectCosts: [], vehicleIssueRecords: [],
  }))

  assert.equal(rowReads, 0)
  assert.equal(coercionCalls, 0)
  assert.equal(model.series[0].vehicleOutflow, 50)
  assert.equal(model.series[0].income, 0)
  assert.equal(model.anomalies.some(({ code }) => code === 'invalid_record_id'), true)
})

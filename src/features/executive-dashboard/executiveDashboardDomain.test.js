import assert from 'node:assert/strict'
import test from 'node:test'

import { buildExecutiveDashboardReadModel } from './executiveDashboardDomain.js'

const STATUSES = ['报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消']
const BLOCK_KEYS = [
  'code', 'data', 'message', 'requiredSources', 'stale', 'status', 'updatedAt',
]

function ready(data, overrides = {}) {
  return {
    status: 'ready', data, code: '', message: '', stale: false,
    updatedAt: '2026-07-17T00:00:00.000Z', ...overrides,
  }
}

function forbidden() {
  return {
    status: 'forbidden', data: null, code: 'ACCESS_DENIED',
    message: '无权读取该数据', stale: false, updatedAt: null,
  }
}

function fullAccess(overrides = {}) {
  const value = {
    page: true,
    projectSnapshot: true,
    contracts: { view: true, amounts: true },
    profit: { view: true, completeCostRequired: true },
    attendance: { view: true, identities: true },
    labor: { view: true, amounts: true },
    purchase: { accrual: true, payments: true, payable: true, anomalies: true },
    vehicle: { view: true, amounts: true },
    inventory: { view: true, amounts: true },
    tools: { view: true, amounts: true },
    costCategories: {
      labor: true, purchase: true, vehicle: true,
      manualSupplement: true, operatingExpense: true,
    },
  }
  return { ...value, ...overrides }
}

function projects() {
  return STATUSES.map((status, index) => ({
    projectId: `P${index + 1}`,
    projectName: ['Alpha', 'Beta', 'Gamma', 'Delta', 'Echo', 'Foxtrot', 'Golf'][index],
    status,
  }))
}

function revenueSnapshots() {
  return [
    {
      projectId: 'P1', adjustedTaxInclusiveAmount: 1100,
      totalReceivedTaxInclusiveAmount: 600, outstandingTaxInclusiveAmount: 500,
      overpaidTaxInclusiveAmount: 0, profitAnchorTaxExclusiveAmount: 1000,
      allocationStatus: 'auto_allocated',
    },
    {
      projectId: 'P2', adjustedTaxInclusiveAmount: 550,
      totalReceivedTaxInclusiveAmount: 625, outstandingTaxInclusiveAmount: 0,
      overpaidTaxInclusiveAmount: 75, profitAnchorTaxExclusiveAmount: 500,
      allocationStatus: 'legacy_compatibility',
    },
    {
      projectId: 'P3', adjustedTaxInclusiveAmount: 0,
      totalReceivedTaxInclusiveAmount: 0, outstandingTaxInclusiveAmount: 0,
      overpaidTaxInclusiveAmount: 0, profitAnchorTaxExclusiveAmount: 0,
      allocationStatus: 'contract_not_started',
    },
    ...['P4', 'P5', 'P6', 'P7'].map((projectId) => ({
      projectId, adjustedTaxInclusiveAmount: 110,
      totalReceivedTaxInclusiveAmount: 0, outstandingTaxInclusiveAmount: 110,
      overpaidTaxInclusiveAmount: 0, profitAnchorTaxExclusiveAmount: 100,
      allocationStatus: 'auto_allocated',
    })),
  ]
}

const MONTHS = [
  '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
  '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
]

function laborWindow(overrides = {}) {
  return {
    monthly: MONTHS.map((month) => ({
      month, status: 'ready', stale: false, source: 'formal', pendingCount: 0,
      salaryTotal: month === '2026-07' ? 90 : month === '2026-06' ? 0 : 10,
      projectLaborTotal: month === '2026-07' ? 60 : month === '2026-06' ? 0 : 10,
      projectLaborById: {
        P1: month === '2026-07' ? 60 : month === '2026-06' ? 0 : 10,
      },
    })),
    projectLaborLifetimeById: { P1: 100, P2: 50, P3: 0, P4: 0, P5: 0, P6: 0, P7: 0 },
    lifetimeStatus: 'ready',
    lifetimeStale: false,
    incompleteMonths: [],
    staleMonths: [],
    ...overrides,
  }
}

function sourceFixture(overrides = {}) {
  const values = {
    projects: ready(projects()),
    contractRevenue: ready(revenueSnapshots()),
    receipts: ready([
      {
        receiptId: 'R-JULY', projectId: 'P1', receivedDate: '2026-07-10',
        taxInclusiveAmount: 600, statusCode: 'active',
      },
      {
        receiptId: 'R-VOID', projectId: 'P1', receivedDate: '2026-07-11',
        taxInclusiveAmount: 999999, statusCode: 'void',
      },
      {
        receiptId: 'R-JUNE', projectId: 'P1', receivedDate: '2026-06-10',
        taxInclusiveAmount: 0, statusCode: 'active',
      },
    ]),
    laborWindow: ready(laborWindow()),
    purchaseAccrual: ready([
      {
        purchaseId: 'PO-JULY', projectId: 'P1', purchaseDate: '2026-07-02',
        purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: 200,
        openingPaidAmount: 50,
      },
      {
        purchaseId: 'PO-JUNE', projectId: 'P1', purchaseDate: '2026-06-02',
        purchaseSource: 'Amazon', purchaseStatus: '正常', totalCost: 30,
        openingPaidAmount: 0,
      },
    ]),
    purchasePayments: ready([
      {
        paymentId: 'PP-JULY', purchaseId: 'PO-JULY', projectId: 'P1',
        paymentDate: '2026-07-03', paymentDateSource: 'recorded', jpyAmount: 25,
      },
    ]),
    projectCosts: ready([
      {
        costRecordId: 'PC-CONFIRMED', projectId: 'P1', date: '2026-07-04',
        costType: '外包费', amount: 30,
      },
      {
        costRecordId: 'PC-PENDING', projectId: 'P1', date: '2026-07-05',
        costType: '人工费', amount: 40,
      },
    ]),
    operatingExpenses: ready([
      {
        operatingExpenseId: 'OE-1', projectId: 'P1', date: '2026-07-06',
        allocateToProject: true, amount: 20,
      },
    ]),
    vehicles: ready([{ vehicleId: 'V1', status: '使用中' }]),
    vehicleUsage: ready([
      { usageId: 'VU-JULY', vehicleId: 'V1', projectId: 'P1', usageDate: '2026-07-07', dailyMileage: 12 },
      { usageId: 'VU-JUNE', vehicleId: 'V1', projectId: 'P1', usageDate: '2026-06-07', dailyMileage: 99 },
    ]),
    fuel: ready([
      {
        fuelRecordId: 'F-JULY', projectId: 'P1', fuelDate: '2026-07-08',
        fuelDateSource: 'recorded', paymentMethod: '现金', paymentMethodSource: 'recorded',
        allocateToProject: true, fuelAmount: 10,
      },
    ]),
    vehicleExpenses: ready([
      {
        vehicleExpenseId: 'VE-JULY', projectId: 'P1', expenseDate: '2026-07-09',
        expenseDateSource: 'recorded', paymentMethod: '卡', paymentMethodSource: 'recorded',
        allocateToProject: true, amount: 5,
      },
    ]),
    vehicleIssues: ready([
      {
        issueId: 'VI-JULY', projectId: 'P1', issueDate: '2026-07-10',
        allocateToProject: true, issueStatus: '未处理', repairCost: 7,
      },
    ]),
    attendance: ready([
      {
        attendanceId: 'A-JULY', projectId: 'P1', employeeId: 'E-SECRET',
        employeeName: 'Secret Person', workDate: '2026-07-11', status: '异常',
      },
      {
        attendanceId: 'A-JUNE', projectId: 'P1', employeeId: 'E-OLD',
        employeeName: 'Old Person', workDate: '2026-06-11', status: '异常',
      },
    ]),
    inventoryItems: ready([
      { inventoryId: 'I1', projectId: 'P1', currentStatus: '库存不足', totalCost: 80 },
    ]),
    stockInRecords: ready([
      { stockInId: 'SI-JULY', projectId: 'P1', stockInDate: '2026-07-12', amount: 1 },
    ]),
    stockOutRecords: ready([
      { stockOutId: 'SO-JULY', projectId: 'P1', stockOutDate: '2026-07-13', amount: 1 },
    ]),
    stockReturnRecords: ready([
      { stockReturnId: 'SR-JUNE', projectId: 'P1', returnDate: '2026-06-13', amount: 1 },
    ]),
    toolRecords: ready([{ toolId: 'T1', currentStatus: '借出', totalCost: 70 }]),
    toolBorrowRecords: ready([
      {
        borrowRecordId: 'TB-JULY', toolId: 'T1', projectId: 'P1',
        borrowDate: '2026-07-14', borrowType: '临时借用', borrowerId: 'E-SECRET',
      },
    ]),
    toolReturnRecords: ready([]),
    lifelongToolAssignments: ready([]),
    toolResponsibilityRecords: ready([
      { responsibilityId: 'TR1', toolId: 'T1', projectId: 'P1', compensationStatus: '未赔偿', compensationAmount: 9 },
    ]),
  }
  return { ...values, ...overrides }
}

function input(overrides = {}) {
  return {
    asOfDate: '2026-07-17',
    selectedMonth: '2026-07',
    filters: {
      projectId: 'P1', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access: fullAccess(),
    sources: sourceFixture(),
    ...overrides,
  }
}

function assertBlock(block, status = 'ready') {
  assert.deepEqual(Object.keys(block).sort(), BLOCK_KEYS)
  assert.equal(block.status, status)
  assert.equal(Array.isArray(block.requiredSources), true)
}

function kpi(model, key) {
  return model.kpis.data.find((item) => item.key === key)
}

test('canonical dashboard publishes exact envelopes, tax-inclusive KPIs, tax-exclusive profit, and lifecycle truth', () => {
  const model = buildExecutiveDashboardReadModel(input())

  assert.deepEqual(Object.keys(model), [
    'meta', 'kpis', 'revenue', 'projectStatus', 'cashFlow', 'costs', 'alerts',
    'purchaseOperations', 'laborOperations', 'vehicleOperations', 'inventoryOperations',
    'toolOperations', 'projectRanking', 'projectRows', 'sourceIssues',
  ])
  assert.deepEqual(model.meta, {
    asOfDate: '2026-07-17', selectedMonth: '2026-07',
    windowStartMonth: '2025-08', windowEndMonth: '2026-07',
    projectScopeLabel: 'Alpha', monthScopeLabel: '2026-07',
  })
  for (const key of Object.keys(model).filter((key) => key !== 'meta')) assertBlock(model[key])

  assert.deepEqual(model.kpis.data.map(({ key, label }) => [key, label]), [
    ['activeProjects', '当前有效项目'],
    ['contractTaxInclusive', '当前含税合同额'],
    ['receivedTaxInclusive', '当前累计含税收款'],
    ['outstandingTaxInclusive', '当前含税未收'],
    ['estimatedProfitTaxExclusive', '当前累计税抜预计利润'],
  ])
  assert.equal(kpi(model, 'contractTaxInclusive').value, 1100)
  assert.equal(kpi(model, 'receivedTaxInclusive').value, 600)
  assert.equal(kpi(model, 'outstandingTaxInclusive').value, 500)
  assert.equal(kpi(model, 'estimatedProfitTaxExclusive').value, 605)
  assert.equal(kpi(model, 'estimatedProfitTaxExclusive').comparison, null)
  assert.equal(model.revenue.data.contractTaxInclusiveAmount, 1100)
  assert.equal(model.revenue.data.receivedTaxInclusiveAmount, 600)
  assert.equal(model.revenue.data.outstandingTaxInclusiveAmount, 500)

  const row = model.projectRows.data.items[0]
  assert.equal(row.profitAnchorTaxExclusiveAmount, 1000)
  assert.equal(row.confirmedCost, 395)
  assert.equal(row.pendingManualCost, 47)
  assert.equal(row.estimatedProfit, 605)
  assert.equal(row.margin, 60.5)

  const all = buildExecutiveDashboardReadModel(input({
    filters: { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10 },
  }))
  assert.deepEqual(all.projectStatus.data, STATUSES.map((status) => ({ status, count: 1 })))
  assert.equal(all.projectStatus.data.reduce((total, item) => total + item.count, 0), 7)
  assert.equal(JSON.stringify(all.projectStatus.data).includes('付款'), false)
  assert.equal(kpi(all, 'estimatedProfitTaxExclusive').status, 'error')
  assert.equal(kpi(all, 'estimatedProfitTaxExclusive').value, null)
  assert.match(kpi(all, 'estimatedProfitTaxExclusive').message, /合同收入确认/u)
  assert.equal(all.projectRanking.data.some((item) => item.projectId === 'P3'), false)
  assert.equal(all.projectRows.data.items.find((item) => item.projectId === 'P2').profitStatus, 'legacy_compatibility')
  assert.equal(all.projectRows.data.items.find((item) => item.projectId === 'P2').profitStatusLabel, '历史税额未拆分')
  assert.equal(all.projectRows.data.items.find((item) => item.projectId === 'P3').profitStatus, 'missing_anchor')
  assert.equal(all.projectRows.data.items.find((item) => item.projectId === 'P3').profitStatusLabel, '待完成合同收入确认')
})

test('selected month moves natural-month operations and the 12-month window but never current snapshots', () => {
  const july = buildExecutiveDashboardReadModel(input())
  const june = buildExecutiveDashboardReadModel(input({ selectedMonth: '2026-06' }))

  for (const key of ['activeProjects', 'contractTaxInclusive', 'receivedTaxInclusive', 'outstandingTaxInclusive', 'estimatedProfitTaxExclusive']) {
    assert.equal(kpi(july, key).value, kpi(june, key).value, key)
  }
  assert.deepEqual(july.projectRanking.data, june.projectRanking.data)
  assert.equal(july.purchaseOperations.data.occurrence.data.monthCost, 200)
  assert.equal(june.purchaseOperations.data.occurrence.data.monthCost, 30)
  assert.equal(july.purchaseOperations.data.payable.data.currentOutstanding, 155)
  assert.equal(june.purchaseOperations.data.payable.data.currentOutstanding, 155)
  assert.equal(july.vehicleOperations.data.usageCount, 1)
  assert.equal(june.vehicleOperations.data.usageCount, 1)
  assert.equal(july.vehicleOperations.data.mileage, 12)
  assert.equal(june.vehicleOperations.data.mileage, 99)
  assert.equal(july.inventoryOperations.data.stockInCount, 1)
  assert.equal(june.inventoryOperations.data.stockInCount, 0)
  assert.equal(july.inventoryOperations.data.returnCount, 0)
  assert.equal(june.inventoryOperations.data.returnCount, 1)
  assert.equal(july.toolOperations.data.openTemporaryBorrowCount, 1)
  assert.equal(june.toolOperations.data.openTemporaryBorrowCount, 0)
  assert.equal(july.laborOperations.data.attendance.data.abnormalCount, 1)
  assert.equal(june.laborOperations.data.attendance.data.abnormalCount, 1)
  assert.equal(july.laborOperations.data.labor.data.fee, 60)
  assert.equal(june.laborOperations.data.labor.data.fee, 0)
  assert.equal(july.cashFlow.data.series.at(-1).month, '2026-07')
  assert.equal(june.cashFlow.data.series.at(-1).month, '2026-06')
  assert.equal(july.cashFlow.data.comparison.income.percentChange, null)
  assert.equal(kpi(july, 'contractTaxInclusive').comparison, null)
  assert.equal(july.revenue.data.comparison, null)
})

test('required-source and sensitive-permission truth tables block only dependent facts', () => {
  const inventoryIndependent = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ toolRecords: forbidden() }),
  }))
  assert.equal(inventoryIndependent.toolOperations.status, 'forbidden')
  assert.equal(inventoryIndependent.inventoryOperations.status, 'ready')

  const toolsIndependent = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ inventoryItems: { status: 'error', data: null, code: 'DOWN', message: '库存失败' } }),
  }))
  assert.equal(toolsIndependent.inventoryOperations.status, 'error')
  assert.equal(toolsIndependent.toolOperations.status, 'ready')

  const failedLifetime = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ laborWindow: ready(laborWindow({
      projectLaborLifetimeById: null, lifetimeStatus: 'error',
    })) }),
  }))
  assert.equal(failedLifetime.costs.status, 'ready')
  assert.equal(failedLifetime.laborOperations.data.labor.status, 'ready')
  assert.equal(failedLifetime.projectRanking.status, 'error')
  assert.equal(failedLifetime.projectRows.status, 'error')
  assert.equal(kpi(failedLifetime, 'estimatedProfitTaxExclusive').status, 'error')

  const cases = [
    ['contracts', fullAccess({ contracts: { view: true, amounts: false } }), ['revenue'], ['contractTaxInclusive', 'receivedTaxInclusive', 'outstandingTaxInclusive', 'estimatedProfitTaxExclusive']],
    ['profit', fullAccess({ profit: { view: false, completeCostRequired: true } }), ['costs', 'projectRanking', 'projectRows'], ['estimatedProfitTaxExclusive']],
    ['salary', fullAccess({ labor: { view: true, amounts: false }, costCategories: { labor: false, purchase: true, vehicle: true, manualSupplement: true, operatingExpense: true }, profit: { view: false, completeCostRequired: true } }), ['costs', 'projectRanking', 'projectRows'], ['estimatedProfitTaxExclusive']],
    ['payment', fullAccess({ purchase: { accrual: true, payments: false, payable: false, anomalies: false } }), [], []],
  ]
  for (const [name, access, forbiddenBlocks, forbiddenKpis] of cases) {
    const model = buildExecutiveDashboardReadModel(input({ access }))
    assert.equal(kpi(model, 'activeProjects').status, 'ready', name)
    assert.equal(model.projectStatus.status, 'ready', name)
    for (const key of forbiddenBlocks) assert.equal(model[key].status, 'forbidden', `${name}:${key}`)
    for (const key of forbiddenKpis) {
      assert.equal(kpi(model, key).status, 'forbidden', `${name}:${key}`)
      assert.equal(kpi(model, key).value, null, `${name}:${key}`)
    }
    if (name === 'payment') {
      assert.equal(model.purchaseOperations.data.occurrence.status, 'ready')
      assert.deepEqual(model.purchaseOperations.data.payment, { status: 'forbidden', data: null })
      assert.deepEqual(model.purchaseOperations.data.payable, { status: 'forbidden', data: null })
      assert.deepEqual(model.purchaseOperations.data.health, { status: 'forbidden', data: null })
    }
  }
})

test('operations use exact natural source rules and alerts are redacted before output', () => {
  const access = fullAccess({
    attendance: { view: true, identities: false },
    vehicle: { view: true, amounts: false },
    tools: { view: true, amounts: false },
  })
  const model = buildExecutiveDashboardReadModel(input({ access }))

  assert.equal(model.laborOperations.data.attendance.data.statusCounts['异常'], 1)
  assert.equal(model.laborOperations.data.labor.data.pendingConfirmationCount, 0)
  assert.equal(model.purchaseOperations.data.occurrence.data.count, 1)
  assert.equal(model.purchaseOperations.data.payment.data.monthPaymentCash, 25)
  assert.equal(model.purchaseOperations.data.health.data.anomalyCount >= 0, true)
  assert.equal(model.vehicleOperations.data.fee, null)
  assert.equal(model.vehicleOperations.data.issueCount, 1)
  assert.equal(model.inventoryOperations.data.statusCounts['库存不足'], 1)
  assert.equal(model.toolOperations.data.unpaidCompensation, null)

  const sensitiveAlertTypes = new Set(['attendance_exception', 'vehicle_issue', 'tool_responsibility'])
  for (const alert of model.alerts.data.filter((item) => sensitiveAlertTypes.has(item.type))) {
    assert.deepEqual(Object.keys(alert), [
      'id', 'type', 'severity', 'title', 'reason', 'count', 'amount',
      'targetView', 'canNavigate', 'recordRef',
    ])
    assert.equal(alert.amount, null)
    assert.equal(alert.recordRef, null)
    assert.equal(alert.targetView, null)
    assert.equal(alert.canNavigate, false)
    assert.equal(JSON.stringify(alert).includes('Secret Person'), false)
    assert.equal(JSON.stringify(alert).includes('E-SECRET'), false)
  }
  assert.deepEqual(model.sourceIssues.data, [])
})

test('filters normalize safely, ranking is deterministic, rows paginate, and outputs detach and freeze', () => {
  const sources = sourceFixture()
  const model = buildExecutiveDashboardReadModel(input({
    filters: { projectId: 'not-a-project', projectStatus: '付款完成', rankingMetric: 'wat', page: 0, pageSize: 5000 },
    sources,
  }))
  assert.equal(model.meta.projectScopeLabel, '全部项目')
  assert.equal(model.projectRows.data.page, 1)
  assert.equal(model.projectRows.data.pageSize, 10)
  assert.equal(model.projectRows.data.totalItems, 7)
  assert.equal(model.projectRanking.data.every((row, index, rows) => index === 0 || rows[index - 1].profit >= row.profit), true)
  assert.equal(Object.isFrozen(model), true)
  assert.equal(Object.isFrozen(model.projectRows.data.items), true)
  assert.notEqual(model.projectRows.data.items[0], sources.projects.data[0])
  assert.throws(() => { model.projectRows.data.items[0].projectName = 'mutated' }, TypeError)
  assert.equal(sources.projects.data[0].projectName, 'Alpha')

  const page = buildExecutiveDashboardReadModel(input({
    filters: { projectId: 'all', projectStatus: 'all', rankingMetric: 'revenue', page: 2, pageSize: 2 },
  }))
  assert.deepEqual(
    { page: page.projectRows.data.page, pageSize: page.projectRows.data.pageSize, totalPages: page.projectRows.data.totalPages, count: page.projectRows.data.items.length },
    { page: 2, pageSize: 2, totalPages: 4, count: 2 },
  )
})

test('invalid, accessor, inherited, cyclic, overflow, duplicate, and pollution inputs fail closed', () => {
  let getterCalls = 0
  const accessorInput = input()
  Object.defineProperty(accessorInput.filters, 'projectId', {
    enumerable: true,
    get() { getterCalls += 1; return 'P1' },
  })
  assert.throws(() => buildExecutiveDashboardReadModel(accessorInput), TypeError)
  assert.equal(getterCalls, 0)

  const forbiddenData = {}
  Object.defineProperty(forbiddenData, 'secret', {
    enumerable: true,
    get() { getterCalls += 1; return 999 },
  })
  const redacted = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ toolRecords: { ...forbidden(), data: forbiddenData } }),
  }))
  assert.equal(redacted.toolOperations.status, 'forbidden')
  assert.equal(getterCalls, 0)

  const inherited = Object.assign(Object.create({ projectId: 'P1' }), input().filters)
  assert.throws(() => buildExecutiveDashboardReadModel(input({ filters: inherited })), TypeError)
  const cycle = sourceFixture()
  cycle.projects.data.push(cycle.projects.data)
  assert.throws(() => buildExecutiveDashboardReadModel(input({ sources: cycle })), TypeError)
  assert.throws(() => buildExecutiveDashboardReadModel({ ...input(), purchases: [] }), TypeError)

  const unsafe = sourceFixture({
    purchaseAccrual: ready([
      ...sourceFixture().purchaseAccrual.data,
      { purchaseId: '__proto__', projectId: 'P1', purchaseDate: '2026-07-01', totalCost: 99 },
      { purchaseId: 'PO-JULY', projectId: 'P1', purchaseDate: '2026-07-01', totalCost: 99 },
      { purchaseId: 'PO-OVERFLOW', projectId: 'P1', purchaseDate: '2026-07-01', totalCost: Number.MAX_SAFE_INTEGER },
    ]),
  })
  const model = buildExecutiveDashboardReadModel(input({ sources: unsafe }))
  assert.equal(Number.isSafeInteger(model.purchaseOperations.data.occurrence.data.monthCost), true)
  assert.equal(model.purchaseOperations.data.occurrence.data.monthCost >= 0, true)
  assert.equal(Object.prototype.polluted, undefined)
  assert.equal(model.purchaseOperations.data.health.data.anomalyCount > 0, true)
})

test('source truth tables isolate snapshot revenue, cash receipts, purchase occurrence, and every hidden cost category', () => {
  const receiptFailure = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      receipts: { status: 'error', data: null, code: 'RECEIPTS_DOWN', message: '收款流水失败' },
    }),
  }))
  assert.equal(receiptFailure.revenue.status, 'ready')
  assert.equal(kpi(receiptFailure, 'contractTaxInclusive').value, 1100)
  assert.equal(receiptFailure.cashFlow.status, 'error')
  assert.equal(receiptFailure.projectStatus.status, 'ready')

  const paymentFailure = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      purchasePayments: { status: 'error', data: null, code: 'PAYMENT_DOWN', message: '付款流水失败' },
    }),
  }))
  assert.equal(paymentFailure.purchaseOperations.status, 'ready')
  assert.equal(paymentFailure.purchaseOperations.data.occurrence.status, 'ready')
  assert.equal(paymentFailure.purchaseOperations.data.occurrence.data.monthCost, 200)
  assert.deepEqual(paymentFailure.purchaseOperations.data.payment, { status: 'error', data: null })
  assert.deepEqual(paymentFailure.purchaseOperations.data.payable, { status: 'error', data: null })
  assert.equal(paymentFailure.cashFlow.status, 'error')

  for (const category of Object.keys(fullAccess().costCategories)) {
    const access = fullAccess({
      profit: { view: false, completeCostRequired: true },
      costCategories: { ...fullAccess().costCategories, [category]: false },
    })
    const model = buildExecutiveDashboardReadModel(input({ access }))
    assert.equal(model.costs.status, 'forbidden', category)
    assert.equal(model.projectRanking.status, 'forbidden', category)
    assert.equal(model.projectRows.status, 'forbidden', category)
    assert.equal(kpi(model, 'estimatedProfitTaxExclusive').status, 'forbidden', category)
    assert.equal(model.revenue.status, 'ready', category)
    assert.equal(model.projectStatus.status, 'ready', category)
  }
})

test('over-receipts clamp outstanding, emit an excess issue, and never contaminate project lifecycle', () => {
  const model = buildExecutiveDashboardReadModel(input({
    filters: { projectId: 'P2', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10 },
  }))
  assert.equal(kpi(model, 'contractTaxInclusive').value, 550)
  assert.equal(kpi(model, 'receivedTaxInclusive').value, 625)
  assert.equal(kpi(model, 'outstandingTaxInclusive').value, 0)
  assert.deepEqual(model.revenue.data.issues, [{
    code: 'over_receipt', projectId: 'P2', excessTaxInclusiveAmount: 75,
  }])
  const alert = model.alerts.data.find((item) => item.type === 'over_receipt')
  assert.equal(alert.amount, 75)
  assert.equal(alert.recordRef, 'P2')
  assert.equal(model.projectStatus.data.find((item) => item.status === '设计中').count, 1)
  assert.equal(JSON.stringify(model.projectStatus.data).includes('超额收款'), false)
})

test('equal ranking metrics use project name then project id and project/status filters precede pagination', () => {
  const sources = sourceFixture({
    projects: ready([
      { projectId: 'P-Z', projectName: 'Same', status: '进行中' },
      { projectId: 'P-A', projectName: 'Same', status: '进行中' },
      { projectId: 'P-B', projectName: 'Beta', status: '暂停' },
    ]),
    contractRevenue: ready([
      ...['P-Z', 'P-A', 'P-B'].map((projectId) => ({
        projectId, adjustedTaxInclusiveAmount: 110,
        totalReceivedTaxInclusiveAmount: 0, profitAnchorTaxExclusiveAmount: 100,
        allocationStatus: 'auto_allocated',
      })),
    ]),
    laborWindow: ready(laborWindow({
      monthly: laborWindow().monthly.map((row) => ({
        ...row, projectLaborTotal: 0, projectLaborById: {},
      })),
      projectLaborLifetimeById: { 'P-Z': 0, 'P-A': 0, 'P-B': 0 },
    })),
    purchaseAccrual: ready([]), purchasePayments: ready([]), projectCosts: ready([]),
    operatingExpenses: ready([]), fuel: ready([]), vehicleExpenses: ready([]),
    vehicleIssues: ready([]), receipts: ready([]), attendance: ready([]),
    vehicleUsage: ready([]), inventoryItems: ready([]), stockInRecords: ready([]),
    stockOutRecords: ready([]), stockReturnRecords: ready([]), toolBorrowRecords: ready([]),
    toolReturnRecords: ready([]), lifelongToolAssignments: ready([]),
    toolResponsibilityRecords: ready([]),
  })
  const model = buildExecutiveDashboardReadModel(input({
    filters: { projectId: 'all', projectStatus: '进行中', rankingMetric: 'profit', page: 2, pageSize: 1 },
    sources,
  }))
  assert.deepEqual(model.projectRanking.data.map((row) => row.projectId), ['P-A', 'P-Z'])
  assert.deepEqual(model.projectRows.data.items.map((row) => row.projectId), ['P-Z'])
  assert.equal(model.projectRows.data.totalItems, 2)
  assert.equal(model.projectRows.data.totalPages, 2)
  assert.equal(model.projectStatus.data.find((item) => item.status === '暂停').count, 0)
})

test('malformed source-state and ready-data accessors fail without invocation while forbidden data is never traversed', () => {
  let calls = 0
  const inheritedState = Object.assign(Object.create({ status: 'ready' }), { status: 'ready', data: [] })
  assert.throws(() => buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ vehicles: inheritedState }),
  })), TypeError)

  const accessorState = {}
  Object.defineProperty(accessorState, 'status', {
    enumerable: true,
    get() { calls += 1; return 'ready' },
  })
  Object.defineProperty(accessorState, 'data', { enumerable: true, value: [] })
  assert.throws(() => buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ vehicles: accessorState }),
  })), TypeError)
  assert.equal(calls, 0)

  const readyData = {}
  Object.defineProperty(readyData, 'secret', {
    enumerable: true,
    get() { calls += 1; return 1 },
  })
  assert.throws(() => buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ contractRevenue: ready(readyData) }),
  })), TypeError)
  assert.equal(calls, 0)

  const forbiddenData = {}
  Object.defineProperty(forbiddenData, 'payments', {
    enumerable: true,
    get() { calls += 1; return [{ jpyAmount: 999999 }] },
  })
  const model = buildExecutiveDashboardReadModel(input({
    access: fullAccess({
      purchase: { accrual: true, payments: false, payable: false, anomalies: false },
    }),
    sources: sourceFixture({ purchasePayments: { ...forbidden(), data: forbiddenData } }),
  }))
  assert.equal(model.purchaseOperations.data.occurrence.status, 'ready')
  assert.deepEqual(model.purchaseOperations.data.payment, { status: 'forbidden', data: null })
  assert.equal(calls, 0)
})

test('page denial globally fails closed and incompatible project/status filters produce an empty ready scope', () => {
  const denied = buildExecutiveDashboardReadModel(input({
    access: fullAccess({ page: false }),
  }))
  for (const key of Object.keys(denied).filter((key) => key !== 'meta')) {
    assert.equal(denied[key].status, 'forbidden', key)
    assert.equal(denied[key].data, null, key)
  }

  const empty = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'P1', projectStatus: '设计中', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
  }))
  assert.equal(kpi(empty, 'activeProjects').value, 0)
  assert.equal(empty.costs.status, 'ready')
  assert.equal(empty.costs.data.total, 0)
  assert.equal(empty.purchaseOperations.status, 'ready')
  assert.equal(empty.purchaseOperations.data.occurrence.data.count, 0)
  assert.equal(empty.projectRanking.status, 'ready')
  assert.deepEqual(empty.projectRanking.data, [])
  assert.deepEqual(empty.projectRows.data.items, [])
})

test('alerts include current payable and unbound facts while forbidden source messages stay generic', () => {
  const model = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      projectCosts: ready([
        ...sourceFixture().projectCosts.data,
        {
          costRecordId: 'PC-UNBOUND', projectId: '', date: '2026-07-06',
          costType: '外包费', amount: 88,
        },
      ]),
      toolRecords: {
        ...forbidden(),
        message: 'E-SECRET has ¥999999 in record PRIVATE-1',
      },
    }),
  }))
  const payable = model.alerts.data.find((alert) => alert.type === 'purchase_payable')
  assert.equal(payable.amount, 155)
  assert.equal(payable.targetView, 'purchase')
  assert.equal(payable.canNavigate, true)
  assert.equal(model.alerts.data.some((alert) => alert.type === 'unbound_project_fact'), true)
  assert.equal(JSON.stringify(model.sourceIssues.data).includes('E-SECRET'), false)
  assert.equal(JSON.stringify(model.alerts.data).includes('PRIVATE-1'), false)
})

test('overflowing contributing facts block totals, profit, ranking, and financial rows instead of publishing partial values', () => {
  const model = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      projectCosts: ready([
        {
          costRecordId: 'PC-MAX', projectId: 'P1', date: '2026-07-04',
          costType: '外包费', amount: Number.MAX_SAFE_INTEGER,
        },
        {
          costRecordId: 'PC-ONE', projectId: 'P1', date: '2026-07-05',
          costType: '运输费', amount: 1,
        },
      ]),
    }),
  }))
  assert.equal(model.costs.status, 'error')
  assert.equal(model.costs.data, null)
  assert.equal(kpi(model, 'estimatedProfitTaxExclusive').status, 'error')
  assert.equal(model.projectRanking.status, 'error')
  assert.equal(model.projectRanking.data, null)
  assert.equal(model.projectRows.status, 'error')
  assert.equal(model.projectRows.data, null)
})

test('inconsistent access projections never upgrade a dependent financial gate', () => {
  const contractMismatch = buildExecutiveDashboardReadModel(input({
    access: fullAccess({ contracts: { view: false, amounts: true } }),
  }))
  assert.equal(contractMismatch.revenue.status, 'forbidden')
  assert.equal(kpi(contractMismatch, 'estimatedProfitTaxExclusive').status, 'forbidden')
  assert.equal(contractMismatch.projectRanking.status, 'forbidden')
  assert.equal(contractMismatch.cashFlow.data.series.at(-1).income, null)
  assert.equal(contractMismatch.cashFlow.data.series.at(-1).net, null)

  const laborMismatch = buildExecutiveDashboardReadModel(input({
    access: fullAccess({ labor: { view: false, amounts: true } }),
  }))
  assert.equal(laborMismatch.costs.status, 'forbidden')
  assert.equal(laborMismatch.projectRows.status, 'forbidden')

  const vehicleMismatch = buildExecutiveDashboardReadModel(input({
    access: fullAccess({ vehicle: { view: true, amounts: false } }),
  }))
  assert.equal(vehicleMismatch.costs.status, 'forbidden')
  assert.equal(vehicleMismatch.projectRanking.status, 'forbidden')

  const profitMismatch = buildExecutiveDashboardReadModel(input({
    access: fullAccess({ profit: { view: true, completeCostRequired: false } }),
  }))
  assert.equal(profitMismatch.costs.status, 'forbidden')
  assert.equal(kpi(profitMismatch, 'estimatedProfitTaxExclusive').status, 'forbidden')

  const paymentMismatch = buildExecutiveDashboardReadModel(input({
    access: fullAccess({
      purchase: { accrual: true, payments: false, payable: true, anomalies: true },
    }),
  }))
  assert.deepEqual(paymentMismatch.purchaseOperations.data.payment, { status: 'forbidden', data: null })
  assert.deepEqual(paymentMismatch.purchaseOperations.data.payable, { status: 'forbidden', data: null })
  assert.deepEqual(paymentMismatch.purchaseOperations.data.health, { status: 'forbidden', data: null })
})

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
      { responsibilityRecordId: 'TR1', toolId: 'T1', projectId: 'P1', compensationStatus: '未赔偿', compensationAmount: 9 },
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

test('purchase occurrence validates selected and immediately prior months independently', () => {
  const base = sourceFixture()
  const expectedComparison = {
    current: 200, prior: 30, change: 170, percentChange: 566.7,
  }
  const cases = [
    {
      name: 'baseline', extra: null, status: 'ready', comparison: expectedComparison,
    },
    {
      name: 'unrelated March',
      extra: {
        purchaseId: 'PO-MARCH-INVALID', projectId: 'P1', purchaseDate: '2026-03-15',
        purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
      },
      status: 'ready', comparison: expectedComparison,
    },
    {
      name: 'immediately prior June',
      extra: {
        purchaseId: 'PO-JUNE-INVALID', projectId: 'P1', purchaseDate: '2026-06-15',
        purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
      },
      status: 'ready', comparison: null,
    },
    {
      name: 'selected July',
      extra: {
        purchaseId: 'PO-JULY-INVALID', projectId: 'P1', purchaseDate: '2026-07-15',
        purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
      },
      status: 'error', comparison: null,
    },
  ]

  for (const item of cases) {
    const purchaseAccrual = item.extra
      ? ready([...base.purchaseAccrual.data, item.extra])
      : base.purchaseAccrual
    const occurrence = buildExecutiveDashboardReadModel(input({
      sources: sourceFixture({ purchaseAccrual }),
    })).purchaseOperations.data.occurrence
    assert.equal(occurrence.status, item.status, item.name)
    if (item.status === 'ready') {
      assert.equal(occurrence.data.monthCost, 200, item.name)
      assert.equal(occurrence.data.count, 1, item.name)
      assert.deepEqual(occurrence.data.comparison, item.comparison, item.name)
    } else assert.equal(occurrence.data, null, item.name)
  }
})

test('purchase cash is derived only from validated purchase-linked recorded payments without payment projectId', () => {
  const purchaseAccrual = ready([
    {
      purchaseId: 'PO-P1', projectId: 'P1', purchaseDate: '2026-07-02',
      purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: 100,
      openingPaidAmount: 0,
    },
    {
      purchaseId: 'PO-P2', projectId: 'P2', purchaseDate: '2026-07-02',
      purchaseSource: 'Amazon', purchaseStatus: '正常', totalCost: 200,
      openingPaidAmount: 0,
    },
    {
      purchaseId: 'PO-VOID', projectId: 'P1', purchaseDate: '2026-07-02',
      purchaseSource: '中国采购', purchaseStatus: '作废', totalCost: 900,
      openingPaidAmount: 0,
    },
  ])
  const purchasePayments = ready([
    {
      paymentId: 'PP-P1', purchaseId: 'PO-P1', paymentDate: '2026-07-03',
      paymentDateSource: 'recorded', jpyAmount: 10,
    },
    {
      paymentId: 'PP-P2', purchaseId: 'PO-P2', paymentDate: '2026-07-04',
      paymentDateSource: 'recorded', jpyAmount: 20,
    },
    {
      paymentId: 'PP-ORPHAN', purchaseId: 'PO-MISSING', paymentDate: '2026-07-05',
      paymentDateSource: 'recorded', jpyAmount: 999,
    },
    {
      paymentId: 'PP-P1', purchaseId: 'PO-P2', paymentDate: '2026-07-06',
      paymentDateSource: 'recorded', jpyAmount: 888,
    },
    {
      paymentId: 'PP-VOID', purchaseId: 'PO-VOID', paymentDate: '2026-07-07',
      paymentDateSource: 'recorded', jpyAmount: 777,
    },
    {
      paymentId: 'PP-DEFAULTED', purchaseId: 'PO-P1', paymentDate: '2026-07-08',
      paymentDateSource: 'defaulted', jpyAmount: 30,
    },
  ])
  const sources = sourceFixture({ purchaseAccrual, purchasePayments })

  const company = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    sources,
  }))
  assert.equal(company.purchaseOperations.data.payment.data.monthPaymentCash, 30)
  assert.equal(company.purchaseOperations.data.payable.data.currentOutstanding, 240)
  assert.equal(company.cashFlow.data.series.at(-1).purchaseOutflow, 30)

  const selectedProject = buildExecutiveDashboardReadModel(input({ sources }))
  assert.equal(selectedProject.purchaseOperations.data.payment.data.monthPaymentCash, 10)
  assert.equal(selectedProject.purchaseOperations.data.payable.data.currentOutstanding, 60)
  assert.equal(selectedProject.cashFlow.data.series.at(-1).purchaseOutflow, 10)
})

test('purchase health scopes generic payment anomalies through active purchase relations', () => {
  const base = sourceFixture()
  const sources = sourceFixture({
    purchaseAccrual: ready([
      ...base.purchaseAccrual.data,
      {
        purchaseId: 'PO-P2-HEALTH', projectId: 'P2', purchaseDate: '2026-07-02',
        purchaseSource: 'Amazon', purchaseStatus: '正常', totalCost: 50,
        openingPaidAmount: 0,
      },
      {
        purchaseId: 'PO-P2-VOID', projectId: 'P2', purchaseDate: '2026-07-02',
        purchaseSource: 'Amazon', purchaseStatus: '作废', totalCost: 500,
        openingPaidAmount: 0,
      },
    ]),
    purchasePayments: ready([
      ...base.purchasePayments.data,
      {
        paymentId: 'PP-P2-DUP', purchaseId: 'PO-P2-HEALTH',
        paymentDate: '2026-07-03', paymentDateSource: 'recorded', jpyAmount: 5,
      },
      {
        paymentId: 'PP-P2-DUP', purchaseId: 'PO-P2-HEALTH',
        paymentDate: '2026-07-04', paymentDateSource: 'recorded', jpyAmount: 7,
      },
      {
        paymentId: '', purchaseId: 'PO-P2-HEALTH',
        paymentDate: '2026-07-05', paymentDateSource: 'recorded', jpyAmount: 9,
      },
      {
        paymentId: 'PP-COMPANY-ORPHAN', purchaseId: 'PO-MISSING',
        paymentDate: '2026-07-06', paymentDateSource: 'recorded', jpyAmount: 11,
      },
      {
        paymentId: 'PP-P2-ORPHAN', purchaseId: 'PO-MISSING', projectId: 'P2',
        paymentDate: '2026-07-07', paymentDateSource: 'recorded', jpyAmount: 13,
      },
      {
        paymentId: 'PP-P2-VOID', purchaseId: 'PO-P2-VOID', projectId: 'P2',
        paymentDate: '2026-07-08', paymentDateSource: 'recorded', jpyAmount: 500,
      },
    ]),
  })
  const baseline = buildExecutiveDashboardReadModel(input())
  const selectedP1 = buildExecutiveDashboardReadModel(input({ sources }))
  assert.deepEqual(selectedP1.purchaseOperations, baseline.purchaseOperations)
  assert.deepEqual(
    selectedP1.alerts.data.filter((item) => item.type === 'purchase_anomaly'),
    baseline.alerts.data.filter((item) => item.type === 'purchase_anomaly'),
  )

  const selectedP2 = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'P2', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    sources,
  }))
  const p2Anomalies = selectedP2.purchaseOperations.data.health.data.anomalies
  assert.deepEqual(p2Anomalies.map((item) => item.code).sort(), [
    'duplicate_record', 'invalid_record', 'orphan_payment',
  ])
  assert.equal(p2Anomalies.some((item) => item.recordId === 'PP-P2-DUP'), true)
  assert.equal(p2Anomalies.some((item) => item.recordId === 'PP-P2-ORPHAN'), true)
  assert.equal(p2Anomalies.some((item) => item.recordId === 'PP-COMPANY-ORPHAN'), false)
  assert.equal(JSON.stringify(p2Anomalies).includes('PP-P2-VOID'), false)
  for (const issue of p2Anomalies) {
    assert.deepEqual(Object.keys(issue).sort(), ['code', 'recordId', 'source'])
  }
  assert.equal(selectedP2.alerts.data.some((item) => item.type === 'purchase_anomaly'), true)

  const company = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    sources,
  }))
  const companyAnomalies = company.purchaseOperations.data.health.data.anomalies
  assert.deepEqual(companyAnomalies.map((item) => item.code).sort(), [
    'duplicate_record', 'invalid_record', 'orphan_payment', 'orphan_payment',
  ])
  assert.equal(companyAnomalies.some((item) => item.recordId === 'PP-COMPANY-ORPHAN'), true)
  assert.equal(JSON.stringify(companyAnomalies).includes('PP-P2-VOID'), false)

  const p2StatusScope = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: '设计中', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    sources,
  }))
  assert.deepEqual(
    p2StatusScope.purchaseOperations.data.health.data.anomalies.map((item) => item.code).sort(),
    ['duplicate_record', 'invalid_record', 'orphan_payment'],
  )

  const mixedSources = sourceFixture({
    purchaseAccrual: ready([
      ...base.purchaseAccrual.data,
      {
        purchaseId: 'PO-P2-MIXED', projectId: 'P2', purchaseDate: '2026-07-02',
        purchaseSource: 'Amazon', purchaseStatus: '正常', totalCost: 50,
        openingPaidAmount: 0,
      },
    ]),
    purchasePayments: ready([
      ...base.purchasePayments.data,
      {
        paymentId: 'PP-CROSS-DUP', purchaseId: 'PO-JULY',
        paymentDate: '2026-07-03', paymentDateSource: 'recorded', jpyAmount: 1,
      },
      {
        paymentId: 'PP-CROSS-DUP', purchaseId: 'PO-P2-MIXED',
        paymentDate: '2026-07-04', paymentDateSource: 'recorded', jpyAmount: 2,
      },
    ]),
  })
  for (const projectId of ['P1', 'P2']) {
    const scoped = buildExecutiveDashboardReadModel(input({
      filters: {
        projectId, projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
      },
      sources: mixedSources,
    }))
    const issue = scoped.purchaseOperations.data.health.data.anomalies.find(
      (item) => item.recordId === 'PP-CROSS-DUP',
    )
    assert.deepEqual(issue, {
      source: 'purchasePayments', code: 'duplicate_record', recordId: 'PP-CROSS-DUP',
    }, projectId)
  }
})

test('cash uses only its four authorized sources and isolates unavailable purchase accrual', () => {
  const unavailableStates = [
    {
      status: 'loading', data: null, code: '', message: '采购加载中',
      stale: false, updatedAt: null,
    },
    {
      status: 'error', data: null, code: 'ACCRUAL_DOWN', message: '采购读取失败',
      stale: false, updatedAt: null,
    },
  ]
  const scopes = [
    { projectId: 'P1', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10 },
  ]

  for (const filters of scopes) {
    const baseline = buildExecutiveDashboardReadModel(input({ filters }))
    assert.deepEqual(baseline.cashFlow.requiredSources,
      ['receipts', 'purchasePayments', 'fuel', 'vehicleExpenses'])

    for (const purchaseAccrual of unavailableStates) {
      const model = buildExecutiveDashboardReadModel(input({
        filters,
        sources: sourceFixture({ purchaseAccrual }),
      }))
      const selected = model.cashFlow.data?.series.at(-1)
      assert.equal(model.cashFlow.status, 'ready', `${filters.projectId}:${purchaseAccrual.status}`)
      assert.deepEqual(model.cashFlow.requiredSources,
        ['receipts', 'purchasePayments', 'fuel', 'vehicleExpenses'])
      assert.equal(selected.income, 600)
      assert.equal(selected.vehicleOutflow, 15)
      assert.equal(selected.purchaseOutflow, null)
      assert.equal(selected.outflow, null)
      assert.equal(selected.net, null)
      assert.deepEqual(model.cashFlow.data.componentStatus, {
        income: 'ready',
        purchaseOutflow: purchaseAccrual.status,
        vehicleOutflow: 'ready',
        outflow: purchaseAccrual.status,
        net: purchaseAccrual.status,
      })
    }
  }
})

test('inactive facts across every source family are removed before amounts counts health and alerts', () => {
  const base = sourceFixture()
  const cases = [
    ['purchaseAccrual', {
      purchaseId: '', projectId: 'P1', purchaseDate: 'not-a-date',
      purchaseSource: '中国采购', purchaseStatus: '作废', totalCost: -1,
    }],
    ['purchasePayments', {
      paymentId: 'PP-INACTIVE', purchaseId: 'PO-JULY', paymentDate: '2026-07-03',
      paymentDateSource: 'recorded', jpyAmount: 900000, status: 'void',
    }],
    ['receipts', {
      receiptId: 'R-INACTIVE', projectId: 'P1', receivedDate: '2026-07-10',
      taxInclusiveAmount: 900000, receiptStatus: '取消',
    }],
    ['projectCosts', {
      costRecordId: 'PC-INACTIVE', projectId: 'P1', date: '2026-07-04',
      costType: '人工费', amount: 900000, recordStatus: 'deleted',
    }],
    ['operatingExpenses', {
      operatingExpenseId: 'OE-INACTIVE', projectId: 'P1', date: '2026-07-06',
      allocateToProject: true, amount: 900000, statusCode: 'inactive',
    }],
    ['vehicleUsage', {
      usageId: 'VU-INACTIVE', vehicleId: 'V1', projectId: 'P1',
      usageDate: '2026-07-07', dailyMileage: 900000, status: 'void',
    }],
    ['fuel', {
      fuelRecordId: 'F-INACTIVE', projectId: 'P1', fuelDate: '2026-07-08',
      fuelDateSource: 'recorded', paymentMethod: '现金', paymentMethodSource: 'recorded',
      allocateToProject: true, fuelAmount: 900000, statusCode: 'deleted',
    }],
    ['vehicleExpenses', {
      vehicleExpenseId: 'VE-INACTIVE', projectId: 'P1', expenseDate: '2026-07-09',
      expenseDateSource: 'recorded', paymentMethod: '卡', paymentMethodSource: 'recorded',
      allocateToProject: true, amount: 900000, recordStatus: 'inactive',
    }],
    ['vehicleIssues', {
      issueId: 'VI-INACTIVE', projectId: 'P1', issueDate: '2026-07-10',
      allocateToProject: true, issueStatus: '未处理', repairCost: 900000, status: 'void',
    }],
    ['attendance', {
      attendanceId: 'A-INACTIVE', projectId: 'P1', employeeId: 'E-INACTIVE',
      workDate: '2026-07-11', status: '异常', recordStatus: 'deleted',
    }],
    ['inventoryItems', {
      inventoryId: 'I-INACTIVE', projectId: 'P1', currentStatus: '库存不足',
      totalCost: 900000, statusCode: 'inactive',
    }],
    ['stockInRecords', {
      stockInId: 'SI-INACTIVE', projectId: 'P1', stockInDate: '2026-07-12',
      amount: 900000, status: 'void',
    }],
    ['stockOutRecords', {
      stockOutId: 'SO-INACTIVE', projectId: 'P1', stockOutDate: '2026-07-13',
      amount: 900000, statusCode: 'deleted',
    }],
    ['stockReturnRecords', {
      stockReturnId: 'SR-INACTIVE', projectId: 'P1', returnDate: '2026-07-13',
      amount: 900000, recordStatus: 'inactive',
    }],
    ['toolRecords', {
      toolId: 'T-INACTIVE', currentStatus: '借出', totalCost: 900000, statusCode: 'deleted',
    }],
    ['toolBorrowRecords', {
      borrowRecordId: 'TB-INACTIVE', toolId: 'T1', projectId: 'P1',
      borrowDate: '2026-07-14', borrowType: '临时借用', status: 'void',
    }],
    ['toolReturnRecords', {
      toolReturnId: 'TR-INACTIVE', borrowRecordId: 'TB-JULY', statusCode: 'deleted',
    }],
    ['lifelongToolAssignments', {
      assignmentId: 'TA-INACTIVE', toolId: 'T1', projectId: 'P1', recordStatus: 'inactive',
    }],
    ['toolResponsibilityRecords', {
      responsibilityRecordId: 'RESP-INACTIVE', toolId: 'T1', projectId: 'P1',
      compensationStatus: '未赔偿', compensationAmount: 900000, status: 'void',
    }],
  ]
  const overrides = Object.create(null)
  for (const [source, row] of cases) {
    overrides[source] = ready([...base[source].data, row])
  }

  const baseline = buildExecutiveDashboardReadModel(input({ sources: base }))
  const withInactive = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture(overrides),
  }))
  assert.deepEqual(withInactive, baseline)

  const redactedToolAccess = fullAccess({ tools: { view: true, amounts: false } })
  assert.deepEqual(
    buildExecutiveDashboardReadModel(input({
      access: redactedToolAccess,
      sources: sourceFixture(overrides),
    })),
    buildExecutiveDashboardReadModel(input({ access: redactedToolAccess, sources: base })),
  )
})

test('payments linked only to an inactive purchase are ignored without cash health or alert effects', () => {
  const base = sourceFixture()
  const sources = sourceFixture({
    purchaseAccrual: ready([
      ...base.purchaseAccrual.data,
      {
        purchaseId: 'PO-VOID-LINK', projectId: 'P1', purchaseDate: '2026-07-02',
        purchaseSource: '中国采购', purchaseStatus: '作废', totalCost: 900000,
      },
    ]),
    purchasePayments: ready([
      ...base.purchasePayments.data,
      {
        paymentId: 'PP-VOID-LINK', purchaseId: 'PO-VOID-LINK', paymentDate: '2026-07-03',
        paymentDateSource: 'recorded', jpyAmount: 900000,
      },
    ]),
  })
  assert.deepEqual(
    buildExecutiveDashboardReadModel(input({ sources })),
    buildExecutiveDashboardReadModel(input({ sources: base })),
  )
})

test('an inactive duplicate purchase ID cannot suppress the surviving active purchase payments', () => {
  const base = sourceFixture()
  const baseline = buildExecutiveDashboardReadModel(input({ sources: base }))
  const withInactiveDuplicate = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      purchaseAccrual: ready([
        ...base.purchaseAccrual.data,
        {
          purchaseId: 'PO-JULY', projectId: 'P2', purchaseDate: '2026-07-02',
          purchaseSource: 'Amazon', purchaseStatus: '作废', totalCost: 900000,
          openingPaidAmount: 0,
        },
      ]),
    }),
  }))

  assert.equal(withInactiveDuplicate.purchaseOperations.data.payment.data.monthPaymentCash, 25)
  assert.equal(withInactiveDuplicate.purchaseOperations.data.payable.data.currentOutstanding, 155)
  assert.equal(withInactiveDuplicate.cashFlow.data.series.at(-1).purchaseOutflow, 25)
  assert.deepEqual(withInactiveDuplicate, baseline)
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
  const targetByType = {
    attendance_exception: 'labor', vehicle_issue: 'vehicle', tool_responsibility: 'toolBorrow',
  }
  for (const alert of model.alerts.data.filter((item) => sensitiveAlertTypes.has(item.type))) {
    assert.deepEqual(Object.keys(alert), [
      'id', 'type', 'severity', 'title', 'reason', 'count', 'amount',
      'targetView', 'canNavigate', 'recordRef',
    ])
    assert.equal(alert.amount, null)
    assert.equal(alert.recordRef, null)
    assert.equal(alert.targetView, targetByType[alert.type])
    assert.equal(alert.canNavigate, true)
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

test('project row options publish the complete authorized set before status filtering and pagination', () => {
  const reversedProjects = [...projects()].reverse()
  const model = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: '进行中', rankingMetric: 'profit',
      page: 1, pageSize: 1,
    },
    sources: sourceFixture({ projects: ready(reversedProjects) }),
  }))

  assert.equal(model.projectRows.status, 'ready')
  assert.deepEqual(model.projectRows.data.items.map((row) => row.projectId), ['P4'])
  assert.deepEqual(model.projectRows.data.projectOptions, projects().map((project) => ({
    projectId: project.projectId,
    projectName: project.projectName,
  })))
  assert.equal(Object.isFrozen(model.projectRows.data.projectOptions), true)
  assert.equal(Object.isFrozen(model.projectRows.data.projectOptions[0]), true)
  assert.notEqual(model.projectRows.data.projectOptions[0], reversedProjects.at(-1))
  assert.deepEqual(Object.getOwnPropertyNames(model.projectRows.data.projectOptions[0]), [
    'projectId', 'projectName',
  ])
  assert.deepEqual(Object.getOwnPropertySymbols(model.projectRows.data.projectOptions[0]), [])
  for (const descriptor of Object.values(
    Object.getOwnPropertyDescriptors(model.projectRows.data.projectOptions[0]),
  )) {
    assert.equal(descriptor.enumerable, true)
    assert.equal(Object.hasOwn(descriptor, 'value'), true)
  }
  assert.throws(() => {
    model.projectRows.data.projectOptions[0].projectName = 'mutated'
  }, TypeError)
})

test('unbound purchases belong only to the company-wide portfolio', () => {
  const sources = sourceFixture({
    purchaseAccrual: ready([
      {
        purchaseId: 'PO-UNBOUND', projectId: '', purchaseDate: '2026-07-15',
        purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: 100,
      },
      {
        purchaseId: '', projectId: '', purchaseDate: '2026-07-15',
        purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: 1,
      },
    ]),
    purchasePayments: ready([]),
    projectCosts: ready([{
      costRecordId: 'PC-UNBOUND', projectId: '', date: '2026-07-15',
      costType: '外包费', amount: 88,
    }]),
  })
  const company = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit',
      page: 1, pageSize: 10,
    },
    sources,
  }))
  const ongoing = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: '进行中', rankingMetric: 'profit',
      page: 1, pageSize: 10,
    },
    sources,
  }))

  assert.equal(company.purchaseOperations.data.occurrence.data.monthCost, 100)
  assert.equal(ongoing.purchaseOperations.data.occurrence.data.monthCost, 0)
  assert.equal(ongoing.purchaseOperations.data.health.data.anomalyCount, 0)
  assert.equal(company.alerts.data.some((alert) => alert.type === 'unbound_project_fact'), true)
  assert.equal(ongoing.alerts.data.some((alert) => alert.type === 'unbound_project_fact'), false)
})

test('invalid envelopes throw while malformed source data and unsafe aggregates fail closed in envelopes', () => {
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
  const cyclicSource = buildExecutiveDashboardReadModel(input({ sources: cycle }))
  assert.equal(cyclicSource.projectStatus.status, 'error')
  assert.equal(cyclicSource.inventoryOperations.status, 'ready')
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
  assert.equal(model.purchaseOperations.status, 'ready')
  assert.deepEqual(model.purchaseOperations.data.occurrence, { status: 'error', data: null })
  assert.equal(model.purchaseOperations.data.payment.status, 'ready')
  assert.deepEqual(model.purchaseOperations.data.payable, { status: 'error', data: null })
  assert.deepEqual(model.purchaseOperations.data.health, { status: 'error', data: null })
  assert.equal(model.costs.status, 'error')
  assert.equal(Object.prototype.polluted, undefined)
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

test('malformed ready payloads become isolated source errors across every dashboard source family', () => {
  let calls = 0
  const accessorRow = () => {
    const row = {}
    Object.defineProperty(row, 'projectId', {
      enumerable: true,
      get() { calls += 1; return 'P1' },
    })
    return row
  }
  const inheritedRow = (value) => Object.assign(Object.create({ inherited: true }), value)
  const cases = [
    {
      name: 'projects', sources: { projects: ready([null]) },
      check(model) {
        assert.equal(model.kpis.status, 'error')
        assert.equal(model.projectStatus.status, 'error')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'contract revenue', sources: { contractRevenue: ready([null]) },
      check(model) {
        assert.equal(model.revenue.status, 'error')
        assert.equal(model.projectStatus.status, 'ready')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'cash receipts', sources: { receipts: ready([accessorRow()]) },
      check(model) {
        assert.equal(model.cashFlow.status, 'error')
        assert.equal(model.purchaseOperations.status, 'ready')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'labor window', sources: {
        laborWindow: ready({ ...laborWindow(), monthly: [null] }),
      },
      check(model) {
        assert.equal(model.costs.status, 'error')
        assert.equal(model.laborOperations.status, 'ready')
        assert.equal(model.laborOperations.data.attendance.status, 'ready')
        assert.equal(model.laborOperations.data.labor.status, 'error')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'purchase accrual', sources: { purchaseAccrual: ready([null]) },
      check(model) {
        assert.equal(model.purchaseOperations.status, 'error')
        assert.equal(model.cashFlow.status, 'ready')
        assert.equal(model.cashFlow.data.componentStatus.purchaseOutflow, 'error')
        assert.equal(model.cashFlow.data.series.at(-1).income, 600)
        assert.equal(model.cashFlow.data.series.at(-1).vehicleOutflow, 15)
        assert.equal(model.cashFlow.data.series.at(-1).purchaseOutflow, null)
        assert.equal(model.cashFlow.data.series.at(-1).outflow, null)
        assert.equal(model.cashFlow.data.series.at(-1).net, null)
        assert.equal(model.costs.status, 'error')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'project costs', sources: {
        projectCosts: ready([inheritedRow({
          costRecordId: 'PC-INHERITED', projectId: 'P1', date: '2026-07-01',
          costType: '外包费', amount: 1,
        })]),
      },
      check(model) {
        assert.equal(model.costs.status, 'error')
        assert.equal(model.purchaseOperations.status, 'ready')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'vehicle', sources: { vehicleUsage: ready([null]) },
      check(model) {
        assert.equal(model.vehicleOperations.status, 'error')
        assert.equal(model.costs.status, 'ready')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'attendance', sources: { attendance: ready([null]) },
      check(model) {
        assert.equal(model.laborOperations.status, 'ready')
        assert.equal(model.laborOperations.data.attendance.status, 'error')
        assert.equal(model.laborOperations.data.labor.status, 'ready')
        assert.equal(model.inventoryOperations.status, 'ready')
      },
    },
    {
      name: 'inventory', sources: { inventoryItems: ready([null]) },
      check(model) {
        assert.equal(model.inventoryOperations.status, 'error')
        assert.equal(model.toolOperations.status, 'ready')
        assert.equal(model.costs.status, 'ready')
      },
    },
    {
      name: 'tools', sources: {
        toolRecords: ready([inheritedRow({ toolId: 'T-INHERITED', currentStatus: '可用' })]),
      },
      check(model) {
        assert.equal(model.toolOperations.status, 'error')
        assert.equal(model.inventoryOperations.status, 'ready')
        assert.equal(model.costs.status, 'ready')
      },
    },
    {
      name: 'responsibility', sources: {
        toolResponsibilityRecords: ready([accessorRow()]),
      },
      check(model) {
        assert.equal(model.toolOperations.status, 'error')
        assert.equal(model.inventoryOperations.status, 'ready')
        assert.equal(model.costs.status, 'ready')
      },
    },
  ]

  for (const item of cases) {
    const model = buildExecutiveDashboardReadModel(input({
      sources: sourceFixture(item.sources),
    }))
    item.check(model)
    const issue = model.sourceIssues.data.find((row) => row.status === 'error')
    assert.ok(issue, item.name)
    assert.equal(issue.message, '数据格式无效', item.name)
  }
  assert.equal(calls, 0)

  const unauthorizedAccessor = accessorRow()
  const forbiddenModel = buildExecutiveDashboardReadModel(input({
    access: fullAccess({ inventory: { view: false, amounts: true } }),
    sources: sourceFixture({ inventoryItems: ready([unauthorizedAccessor]) }),
  }))
  assert.equal(forbiddenModel.inventoryOperations.status, 'forbidden')
  assert.equal(calls, 0)
})

test('documented incomplete labor month keeps valid selected labor available', () => {
  const window = laborWindow()
  const model = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      laborWindow: ready(laborWindow({
        monthly: window.monthly.map((row) => row.month === '2026-06'
          ? {
              month: row.month, status: 'error', stale: false,
              salaryTotal: null, projectLaborTotal: null,
              projectLaborById: null, source: null, pendingCount: null,
            }
          : row),
        incompleteMonths: ['2026-06'],
      })),
    }),
  }))

  assert.equal(model.sourceIssues.data.some((issue) => issue.source === 'laborWindow'), false)
  assert.equal(model.laborOperations.data.labor.status, 'ready')
  assert.equal(model.costs.status, 'ready')
  assert.equal(model.costs.data.monthlyByMonth['2026-06'].incomplete, true)
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
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
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

test('alert navigation and detail gates are independent and source failures never echo caller secrets', () => {
  const sources = sourceFixture({
    attendance: ready([{
      attendanceId: 'ATTENDANCE-SECRET-¥111', projectId: 'P1', employeeId: 'PERSON-SECRET',
      employeeName: 'Secret Identity', workDate: '2026-07-11', status: '异常',
    }]),
    vehicleIssues: ready([{
      issueId: 'VEHICLE-SECRET-¥777', projectId: 'P1', issueDate: '2026-07-10',
      allocateToProject: true, issueStatus: '未处理', repairCost: 777,
    }]),
    toolResponsibilityRecords: ready([{
      responsibilityRecordId: 'TOOL-SECRET-¥999', toolId: 'T1', projectId: 'P1',
      compensationStatus: '未赔偿', compensationAmount: 999,
    }]),
    inventoryItems: {
      status: 'error', data: null, code: 'PRIVATE_CODE_PERSON-SECRET_¥123456',
      message: 'PRIVATE_MESSAGE PERSON-SECRET has ¥123456 in PRIVATE-RECORD',
    },
  })
  const model = buildExecutiveDashboardReadModel(input({
    filters: {
      projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access: fullAccess({
      contracts: { view: true, amounts: true },
      attendance: { view: true, identities: false },
      vehicle: { view: true, amounts: false },
      tools: { view: true, amounts: false },
    }),
    sources,
  }))

  const attendance = model.alerts.data.find((alert) => alert.type === 'attendance_exception')
  assert.equal(attendance.canNavigate, true)
  assert.equal(attendance.targetView, 'labor')
  assert.equal(attendance.amount, null)
  assert.equal(attendance.recordRef, null)

  const vehicle = model.alerts.data.find((alert) => alert.type === 'vehicle_issue')
  assert.equal(vehicle.canNavigate, true)
  assert.equal(vehicle.targetView, 'vehicle')
  assert.equal(vehicle.amount, null)
  assert.equal(vehicle.recordRef, null)

  const tool = model.alerts.data.find((alert) => alert.type === 'tool_responsibility')
  assert.equal(tool.canNavigate, true)
  assert.equal(tool.targetView, 'toolBorrow')
  assert.equal(tool.amount, null)
  assert.equal(tool.recordRef, null)

  const contract = model.alerts.data.find((alert) => alert.type === 'over_receipt')
  assert.equal(contract.canNavigate, true)
  assert.equal(contract.targetView, 'contractRevenue')
  assert.equal(contract.amount, 75)
  assert.equal(contract.recordRef, 'P2')

  assert.equal(model.inventoryOperations.status, 'error')
  assert.equal(model.inventoryOperations.code, 'DATA_OPERATION_FAILED')
  assert.equal(model.inventoryOperations.message, '数据暂不可用')
  const sourceIssue = model.sourceIssues.data.find((issue) => issue.source === 'inventoryItems')
  assert.equal(sourceIssue.message, '数据暂不可用')
  const sourceAlert = model.alerts.data.find((alert) =>
    alert.type === 'source_issue' && alert.id === 'source:inventoryItems')
  assert.equal(sourceAlert.reason, '数据暂不可用')

  const serialized = JSON.stringify(model)
  for (const secret of [
    'ATTENDANCE-SECRET', 'PERSON-SECRET', 'Secret Identity', 'VEHICLE-SECRET',
    'TOOL-SECRET', 'PRIVATE_CODE', 'PRIVATE_MESSAGE', 'PRIVATE-RECORD', '123456',
  ]) assert.equal(serialized.includes(secret), false, secret)
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

test('invalid monetary contributors fail closed without suppressing independent dashboard blocks', () => {
  const base = sourceFixture()

  const purchaseInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      purchaseAccrual: ready([
        ...base.purchaseAccrual.data,
        {
          purchaseId: 'PO-INVALID', projectId: 'P1', purchaseDate: '2026-07-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
        },
      ]),
    }),
  }))
  assert.equal(purchaseInvalid.purchaseOperations.status, 'ready')
  assert.deepEqual(purchaseInvalid.purchaseOperations.data.occurrence,
    { status: 'error', data: null })
  assert.equal(purchaseInvalid.purchaseOperations.data.payment.status, 'ready')
  assert.deepEqual(purchaseInvalid.purchaseOperations.data.payable,
    { status: 'error', data: null })
  assert.deepEqual(purchaseInvalid.purchaseOperations.data.health,
    { status: 'error', data: null })
  assert.equal(purchaseInvalid.cashFlow.status, 'ready')
  assert.equal(purchaseInvalid.cashFlow.data.componentStatus.purchaseOutflow, 'ready')
  assert.equal(purchaseInvalid.cashFlow.data.series.at(-1).purchaseOutflow, 25)
  assert.equal(purchaseInvalid.costs.status, 'error')
  assert.equal(purchaseInvalid.projectRanking.status, 'error')
  assert.equal(purchaseInvalid.projectRows.status, 'error')
  assert.equal(kpi(purchaseInvalid, 'estimatedProfitTaxExclusive').status, 'error')
  assert.equal(purchaseInvalid.revenue.status, 'ready')
  assert.equal(purchaseInvalid.inventoryOperations.status, 'ready')

  const paymentInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      purchasePayments: ready([
        ...base.purchasePayments.data,
        {
          paymentId: 'PP-FRACTION', purchaseId: 'PO-JULY', paymentDate: '2026-07-15',
          paymentDateSource: 'recorded', jpyAmount: 0.5,
        },
      ]),
    }),
  }))
  assert.equal(paymentInvalid.purchaseOperations.status, 'ready')
  assert.equal(paymentInvalid.purchaseOperations.data.occurrence.status, 'ready')
  assert.equal(paymentInvalid.purchaseOperations.data.payment.status, 'error')
  assert.equal(paymentInvalid.purchaseOperations.data.payable.status, 'error')
  assert.equal(paymentInvalid.cashFlow.status, 'error')
  assert.equal(paymentInvalid.costs.status, 'ready')
  assert.equal(paymentInvalid.projectRanking.status, 'ready')

  const receiptInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      receipts: ready([
        ...base.receipts.data,
        {
          receiptId: 'R-NEGATIVE', projectId: 'P1', receivedDate: '2026-07-15',
          taxInclusiveAmount: -1, statusCode: 'active',
        },
      ]),
    }),
  }))
  assert.equal(receiptInvalid.cashFlow.status, 'error')
  assert.equal(receiptInvalid.revenue.status, 'ready')
  assert.equal(receiptInvalid.purchaseOperations.status, 'ready')
  assert.equal(receiptInvalid.costs.status, 'ready')

  const costInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      operatingExpenses: ready([
        ...base.operatingExpenses.data,
        {
          operatingExpenseId: 'OE-FRACTION', projectId: 'P1', date: '2026-07-15',
          allocateToProject: true, amount: 1.25,
        },
      ]),
    }),
  }))
  assert.equal(costInvalid.costs.status, 'error')
  assert.equal(costInvalid.projectRanking.status, 'error')
  assert.equal(costInvalid.projectRows.status, 'error')
  assert.equal(costInvalid.cashFlow.status, 'ready')
  assert.equal(costInvalid.purchaseOperations.status, 'ready')
  assert.equal(costInvalid.revenue.status, 'ready')

  const pendingOverflow = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      projectCosts: ready([{
        costRecordId: 'PC-PENDING-MAX', projectId: 'P1', date: '2026-07-04',
        costType: '人工费', amount: Number.MAX_SAFE_INTEGER,
      }]),
      vehicleIssues: ready([{
        issueId: 'VI-PENDING-ONE', projectId: 'P1', issueDate: '2026-07-10',
        allocateToProject: true, issueStatus: '未处理', repairCost: 1,
      }]),
    }),
  }))
  assert.equal(pendingOverflow.costs.status, 'ready')
  assert.equal(pendingOverflow.projectRanking.status, 'error')
  assert.equal(pendingOverflow.projectRows.status, 'error')
  assert.equal(kpi(pendingOverflow, 'estimatedProfitTaxExclusive').status, 'error')

  const lifetimeOverflow = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      laborWindow: ready(laborWindow({
        projectLaborLifetimeById: {
          P1: Number.MAX_SAFE_INTEGER, P2: 0, P3: 0, P4: 0, P5: 0, P6: 0, P7: 0,
        },
      })),
    }),
  }))
  assert.equal(lifetimeOverflow.costs.status, 'ready')
  assert.equal(lifetimeOverflow.projectRanking.status, 'error')
  assert.equal(lifetimeOverflow.projectRows.status, 'error')
  assert.equal(kpi(lifetimeOverflow, 'estimatedProfitTaxExclusive').status, 'error')

  const vehicleOverflow = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      fuel: ready([{
        fuelRecordId: 'F-MAX', projectId: 'P1', fuelDate: '2026-07-08',
        fuelDateSource: 'recorded', paymentMethod: '现金', paymentMethodSource: 'recorded',
        allocateToProject: true, fuelAmount: Number.MAX_SAFE_INTEGER,
      }]),
      vehicleExpenses: ready([{
        vehicleExpenseId: 'VE-ONE', projectId: 'P1', expenseDate: '2026-07-09',
        expenseDateSource: 'recorded', paymentMethod: '卡', paymentMethodSource: 'recorded',
        allocateToProject: true, amount: 1,
      }]),
    }),
  }))
  assert.equal(vehicleOverflow.vehicleOperations.status, 'error')
  assert.equal(vehicleOverflow.cashFlow.status, 'error')
  assert.equal(vehicleOverflow.costs.status, 'error')
  assert.equal(vehicleOverflow.purchaseOperations.status, 'ready')
  assert.equal(vehicleOverflow.inventoryOperations.status, 'ready')

  const laborInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      laborWindow: ready(laborWindow({
        monthly: laborWindow().monthly.map((row) => row.month === '2026-07'
          ? { ...row, salaryTotal: -1 }
          : row),
      })),
    }),
  }))
  assert.equal(laborInvalid.laborOperations.data.labor.status, 'ready')
  assert.equal(laborInvalid.costs.status, 'ready')
  assert.equal(laborInvalid.projectRanking.status, 'ready')
  assert.equal(laborInvalid.inventoryOperations.status, 'ready')

  const inventoryInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      inventoryItems: ready([{
        inventoryId: 'I-INVALID', projectId: 'P1', currentStatus: '库存不足', totalCost: 0.5,
      }]),
    }),
  }))
  assert.equal(inventoryInvalid.inventoryOperations.status, 'error')
  assert.equal(inventoryInvalid.toolOperations.status, 'ready')
  assert.equal(inventoryInvalid.costs.status, 'ready')

  const toolInvalid = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      toolResponsibilityRecords: ready([{
        responsibilityRecordId: 'TR-INVALID', toolId: 'T1', projectId: 'P1',
        compensationStatus: '未赔偿', compensationAmount: -1,
      }]),
    }),
  }))
  assert.equal(toolInvalid.toolOperations.status, 'error')
  assert.equal(toolInvalid.inventoryOperations.status, 'ready')
  assert.equal(toolInvalid.costs.status, 'ready')
})

test('selected project validation ignores invalid contributors explicitly bound to another project', () => {
  const base = sourceFixture()
  const cases = [
    {
      name: 'purchase',
      sources: {
        purchaseAccrual: ready([...base.purchaseAccrual.data, {
          purchaseId: 'PO-P2-INVALID', projectId: 'P2', purchaseDate: '2026-07-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
        }]),
      },
      blocks: ['purchaseOperations', 'costs', 'projectRanking'],
    },
    {
      name: 'payment linked through purchase',
      sources: {
        purchaseAccrual: ready([...base.purchaseAccrual.data, {
          purchaseId: 'PO-P2', projectId: 'P2', purchaseDate: '2026-07-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: 10,
        }]),
        purchasePayments: ready([...base.purchasePayments.data, {
          paymentId: 'PP-P2-INVALID', purchaseId: 'PO-P2', paymentDate: '2026-07-15',
          paymentDateSource: 'recorded', jpyAmount: 0.5,
        }]),
      },
      blocks: ['purchaseOperations', 'cashFlow', 'costs', 'projectRanking'],
    },
    {
      name: 'receipt',
      sources: { receipts: ready([...base.receipts.data, {
        receiptId: 'R-P2-INVALID', projectId: 'P2', receivedDate: '2026-07-15',
        taxInclusiveAmount: -1, statusCode: 'active',
      }]) },
      blocks: ['cashFlow', 'purchaseOperations', 'costs'],
    },
    {
      name: 'project cost',
      sources: { projectCosts: ready([...base.projectCosts.data, {
        costRecordId: 'PC-P2-INVALID', projectId: 'P2', date: '2026-07-15',
        costType: '外包费', amount: -1,
      }]) },
      blocks: ['costs', 'projectRanking', 'purchaseOperations'],
    },
    {
      name: 'fuel',
      sources: { fuel: ready([...base.fuel.data, {
        fuelRecordId: 'F-P2-INVALID', projectId: 'P2', fuelDate: '2026-07-15',
        fuelDateSource: 'recorded', paymentMethod: '现金', paymentMethodSource: 'recorded',
        allocateToProject: true, fuelAmount: -1,
      }]) },
      blocks: ['cashFlow', 'costs', 'vehicleOperations'],
    },
    {
      name: 'inventory',
      sources: { inventoryItems: ready([...base.inventoryItems.data, {
        inventoryId: 'I-P2-INVALID', projectId: 'P2', currentStatus: '库存不足', totalCost: -1,
      }]) },
      blocks: ['inventoryOperations', 'toolOperations', 'costs'],
    },
    {
      name: 'tool responsibility',
      sources: { toolResponsibilityRecords: ready([...base.toolResponsibilityRecords.data, {
        responsibilityRecordId: 'RESP-P2-INVALID', toolId: 'T1', projectId: 'P2',
        compensationStatus: '未赔偿', compensationAmount: -1,
      }]) },
      blocks: ['toolOperations', 'inventoryOperations', 'costs'],
    },
  ]

  for (const item of cases) {
    const model = buildExecutiveDashboardReadModel(input({
      sources: sourceFixture(item.sources),
    }))
    for (const block of item.blocks) assert.equal(model[block].status, 'ready', `${item.name}:${block}`)
  }

  const sameProject = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      receipts: ready([...base.receipts.data, {
        receiptId: 'R-P1-INVALID', projectId: 'P1', receivedDate: '2026-07-15',
        taxInclusiveAmount: -1, statusCode: 'active',
      }]),
      projectCosts: ready([...base.projectCosts.data, {
        costRecordId: 'PC-P1-INVALID', projectId: 'P1', date: '2026-07-15',
        costType: '外包费', amount: -1,
      }]),
    }),
  }))
  assert.equal(sameProject.cashFlow.status, 'error')
  assert.equal(sameProject.costs.status, 'error')
  assert.equal(sameProject.projectRanking.status, 'error')
})

test('window current and lifetime consumers validate only their exact date horizon', () => {
  const base = sourceFixture()
  const outsideReceipt = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ receipts: ready([...base.receipts.data, {
      receiptId: 'R-OLD-INVALID', projectId: 'P1', receivedDate: '2020-01-15',
      taxInclusiveAmount: -1, statusCode: 'active',
    }]) }),
  }))
  assert.equal(outsideReceipt.cashFlow.status, 'ready')
  assert.deepEqual(outsideReceipt.cashFlow.data.series,
    buildExecutiveDashboardReadModel(input()).cashFlow.data.series)

  const insideReceipt = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ receipts: ready([...base.receipts.data, {
      receiptId: 'R-WINDOW-INVALID', projectId: 'P1', receivedDate: '2026-01-15',
      taxInclusiveAmount: -1, statusCode: 'active',
    }]) }),
  }))
  assert.equal(insideReceipt.cashFlow.status, 'error')

  const ambiguousReceiptDate = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ receipts: ready([...base.receipts.data, {
      receiptId: 'R-DATE-INVALID', projectId: 'P1', receivedDate: 'not-a-date',
      taxInclusiveAmount: 1, statusCode: 'active',
    }]) }),
  }))
  assert.equal(ambiguousReceiptDate.cashFlow.status, 'error')

  const invalidPrimaryUsageDate = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ vehicleUsage: ready([...base.vehicleUsage.data, {
      usageId: 'VU-DATE-INVALID', vehicleId: 'V1', projectId: 'P1',
      usageDate: 'not-a-date', date: '2026-07-15', dailyMileage: 1,
    }]) }),
  }))
  assert.equal(invalidPrimaryUsageDate.vehicleOperations.status, 'error')

  const historicalCost = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ projectCosts: ready([...base.projectCosts.data, {
      costRecordId: 'PC-OLD-INVALID', projectId: 'P1', date: '2020-01-15',
      costType: '外包费', amount: -1,
    }]) }),
  }))
  assert.equal(historicalCost.costs.status, 'ready')
  assert.equal(historicalCost.projectRanking.status, 'error')
  assert.equal(historicalCost.projectRows.status, 'error')

  const historicalFuel = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ fuel: ready([...base.fuel.data, {
      fuelRecordId: 'F-OLD-INVALID', projectId: 'P1', fuelDate: '2020-01-15',
      fuelDateSource: 'recorded', paymentMethod: '现金', paymentMethodSource: 'recorded',
      allocateToProject: true, fuelAmount: -1,
    }]) }),
  }))
  assert.equal(historicalFuel.cashFlow.status, 'ready')
  assert.equal(historicalFuel.vehicleOperations.status, 'ready')
  assert.equal(historicalFuel.costs.status, 'ready')
  assert.equal(historicalFuel.projectRanking.status, 'error')

  const historicalPurchase = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ purchaseAccrual: ready([...base.purchaseAccrual.data, {
      purchaseId: 'PO-OLD-INVALID', projectId: 'P1', purchaseDate: '2020-01-15',
      purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
    }]) }),
  }))
  assert.equal(historicalPurchase.purchaseOperations.status, 'ready')
  assert.equal(historicalPurchase.purchaseOperations.data.occurrence.status, 'ready')
  assert.equal(historicalPurchase.purchaseOperations.data.occurrence.data.monthCost, 200)
  assert.equal(historicalPurchase.purchaseOperations.data.payment.status, 'ready')
  assert.deepEqual(historicalPurchase.purchaseOperations.data.payable,
    { status: 'error', data: null })
  assert.deepEqual(historicalPurchase.purchaseOperations.data.health,
    { status: 'error', data: null })
  assert.equal(historicalPurchase.costs.status, 'ready')
  assert.equal(historicalPurchase.projectRanking.status, 'error')
})

test('purchase operations separate month occurrence and payment from lifetime payable and health', () => {
  const base = sourceFixture()
  const cases = [
    {
      name: 'historical purchase',
      sources: {
        purchaseAccrual: ready([...base.purchaseAccrual.data, {
          purchaseId: 'PO-HISTORICAL-INVALID', projectId: 'P1', purchaseDate: '2020-01-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
        }]),
      },
      occurrence: 'ready',
      payment: 'ready',
    },
    {
      name: 'selected-month purchase',
      sources: {
        purchaseAccrual: ready([...base.purchaseAccrual.data, {
          purchaseId: 'PO-MONTH-INVALID', projectId: 'P1', purchaseDate: '2026-07-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
        }]),
      },
      occurrence: 'error',
      payment: 'ready',
    },
    {
      name: 'historical payment',
      sources: {
        purchasePayments: ready([...base.purchasePayments.data, {
          paymentId: 'PP-HISTORICAL-INVALID', purchaseId: 'PO-JULY',
          paymentDate: '2020-01-15', paymentDateSource: 'recorded', jpyAmount: -1,
        }]),
      },
      occurrence: 'ready',
      payment: 'ready',
    },
    {
      name: 'selected-month payment',
      sources: {
        purchasePayments: ready([...base.purchasePayments.data, {
          paymentId: 'PP-MONTH-INVALID', purchaseId: 'PO-JULY',
          paymentDate: '2026-07-15', paymentDateSource: 'recorded', jpyAmount: -1,
        }]),
      },
      occurrence: 'ready',
      payment: 'error',
    },
  ]

  for (const item of cases) {
    const model = buildExecutiveDashboardReadModel(input({
      sources: sourceFixture(item.sources),
    }))
    const purchase = model.purchaseOperations
    assert.equal(purchase.status, 'ready', item.name)
    assert.equal(purchase.data.occurrence.status, item.occurrence, `${item.name}:occurrence`)
    assert.equal(purchase.data.payment.status, item.payment, `${item.name}:payment`)
    if (item.occurrence === 'ready') {
      assert.equal(purchase.data.occurrence.data.monthCost, 200, item.name)
    } else assert.equal(purchase.data.occurrence.data, null, item.name)
    if (item.payment === 'ready') {
      assert.equal(purchase.data.payment.data.monthPaymentCash, 25, item.name)
    } else assert.equal(purchase.data.payment.data, null, item.name)
    assert.deepEqual(purchase.data.payable, { status: 'error', data: null }, item.name)
    assert.deepEqual(purchase.data.health, { status: 'error', data: null }, item.name)
  }

  const otherProject = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      purchaseAccrual: ready([
        ...base.purchaseAccrual.data,
        {
          purchaseId: 'PO-P2-MONTH-INVALID', projectId: 'P2', purchaseDate: '2026-07-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: -1,
        },
        {
          purchaseId: 'PO-P2-LINK', projectId: 'P2', purchaseDate: '2026-07-15',
          purchaseSource: '中国采购', purchaseStatus: '正常', totalCost: 10,
        },
      ]),
      purchasePayments: ready([
        ...base.purchasePayments.data,
        {
          paymentId: 'PP-P2-HISTORICAL-INVALID', purchaseId: 'PO-P2-LINK',
          paymentDate: '2020-01-15', paymentDateSource: 'recorded', jpyAmount: -1,
        },
        {
          paymentId: 'PP-P2-MONTH-INVALID', purchaseId: 'PO-P2-LINK',
          paymentDate: '2026-07-15', paymentDateSource: 'recorded', jpyAmount: -1,
        },
      ]),
    }),
  }))
  assert.deepEqual(
    otherProject.purchaseOperations,
    buildExecutiveDashboardReadModel(input()).purchaseOperations,
  )
})

test('labor validation separates selected project current window and lifetime scopes', () => {
  const monthlyFor = (projectId) => laborWindow().monthly.map((row) => row.month === '2026-07'
    ? { ...row, projectLaborById: { ...row.projectLaborById, [projectId]: -1 } }
    : row)
  const lifetimeFor = (projectId) => ({
    ...laborWindow().projectLaborLifetimeById,
    [projectId]: -1,
  })

  const otherCurrent = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ laborWindow: ready(laborWindow({ monthly: monthlyFor('P2') })) }),
  }))
  assert.equal(otherCurrent.costs.status, 'ready')
  assert.equal(otherCurrent.laborOperations.data.labor.status, 'ready')
  assert.equal(otherCurrent.projectRanking.status, 'ready')

  const selectedCurrent = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ laborWindow: ready(laborWindow({ monthly: monthlyFor('P1') })) }),
  }))
  assert.equal(selectedCurrent.costs.status, 'error')
  assert.equal(selectedCurrent.laborOperations.data.labor.status, 'error')
  assert.equal(selectedCurrent.projectRanking.status, 'ready')

  const otherLifetime = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      laborWindow: ready(laborWindow({ projectLaborLifetimeById: lifetimeFor('P2') })),
    }),
  }))
  assert.equal(otherLifetime.costs.status, 'ready')
  assert.equal(otherLifetime.projectRanking.status, 'ready')

  const selectedLifetime = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      laborWindow: ready(laborWindow({ projectLaborLifetimeById: lifetimeFor('P1') })),
    }),
  }))
  assert.equal(selectedLifetime.costs.status, 'ready')
  assert.equal(selectedLifetime.laborOperations.data.labor.status, 'ready')
  assert.equal(selectedLifetime.projectRanking.status, 'error')
})

test('source arrays require exact dense canonical indexes and reject expanded or accessor entries', () => {
  let calls = 0
  const expandedAttendance = [...sourceFixture().attendance.data]
  Object.defineProperty(expandedAttendance, '4294967295', {
    enumerable: true,
    value: { attendanceId: 'A-OUTSIDE', projectId: 'P1', workDate: '2026-07-01' },
  })
  const attendanceModel = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ attendance: ready(expandedAttendance) }),
  }))
  assert.equal(attendanceModel.laborOperations.data.attendance.status, 'error')
  assert.equal(attendanceModel.inventoryOperations.status, 'ready')

  const expandedInventory = [...sourceFixture().inventoryItems.data]
  Object.defineProperty(expandedInventory, 'helper', {
    enumerable: true,
    value() { return 'must never run' },
  })
  const inventoryModel = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ inventoryItems: ready(expandedInventory) }),
  }))
  assert.equal(inventoryModel.inventoryOperations.status, 'error')
  assert.equal(inventoryModel.toolOperations.status, 'ready')

  const sparseTools = new Array(2)
  sparseTools[0] = { toolId: 'T1', currentStatus: '可用', totalCost: 1 }
  const sparseModel = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ toolRecords: ready(sparseTools) }),
  }))
  assert.equal(sparseModel.toolOperations.status, 'error')
  assert.equal(sparseModel.inventoryOperations.status, 'ready')

  const accessorTools = [{ toolId: 'T1', currentStatus: '可用', totalCost: 1 }]
  Object.defineProperty(accessorTools, '0', {
    enumerable: true,
    get() { calls += 1; return { toolId: 'T-SECRET' } },
  })
  const accessorModel = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({ toolRecords: ready(accessorTools) }),
  }))
  assert.equal(accessorModel.toolOperations.status, 'error')
  assert.equal(accessorModel.inventoryOperations.status, 'ready')
  assert.equal(calls, 0)
})

test('attendance inventory and tool status maps use null prototypes and normalize unsafe keys', () => {
  const unsafeStatuses = ['__proto__', 'constructor', 'prototype']
  const model = buildExecutiveDashboardReadModel(input({
    sources: sourceFixture({
      attendance: ready(unsafeStatuses.map((status, index) => ({
        attendanceId: `A-STATUS-${index}`, projectId: 'P1', workDate: '2026-07-11', status,
      }))),
      inventoryItems: ready(unsafeStatuses.map((currentStatus, index) => ({
        inventoryId: `I-STATUS-${index}`, projectId: 'P1', currentStatus, totalCost: 1,
      }))),
      toolRecords: ready(unsafeStatuses.map((currentStatus, index) => ({
        toolId: `T-STATUS-${index}`, currentStatus, totalCost: 1,
      }))),
    }),
  }))

  const maps = [
    model.laborOperations.data.attendance.data.statusCounts,
    model.inventoryOperations.data.statusCounts,
    model.toolOperations.data.statusCounts,
  ]
  for (const statusCounts of maps) {
    assert.equal(Object.getPrototypeOf(statusCounts), null)
    for (const key of unsafeStatuses) assert.equal(Object.hasOwn(statusCounts, key), false)
    assert.equal(statusCounts['其他'], 3)
  }
  assert.equal(Object.prototype.polluted, undefined)
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

  const baseViewDenied = buildExecutiveDashboardReadModel(input({
    access: fullAccess({
      contracts: { view: false, amounts: true },
      attendance: { view: false, identities: true },
      vehicle: { view: false, amounts: true },
      tools: { view: false, amounts: true },
    }),
  }))
  for (const type of [
    'attendance_exception', 'vehicle_issue', 'tool_responsibility',
    'missing_profit_anchor', 'over_receipt',
  ]) {
    assert.equal(baseViewDenied.alerts.data.some((alert) => alert.type === type), false, type)
  }
})

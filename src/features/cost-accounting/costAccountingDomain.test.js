import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCostAccountingReadModel,
  classifyManualProjectCosts,
} from './costAccountingDomain.js'
import { bridgeWarehouseMaterialCosts } from './warehouseMaterialCostBridge.js'

function ledgerRow(overrides = {}) {
  const projectId = overrides.projectId || 'P1'
  const amount = overrides.effectiveAmount ?? 1
  return {
    sourceKey: overrides.sourceKey || 'manual:LEDGER-1',
    sourceModule: overrides.sourceModule || 'manual',
    sourceDocumentType: overrides.sourceDocumentType || 'manual_project_cost',
    sourceDocumentId: overrides.sourceDocumentId || 'LEDGER-1',
    projectId,
    projectName: overrides.projectName || projectId,
    category: overrides.category || '其他费用',
    date: overrides.date || '2026-07-10',
    description: overrides.description || '统一账本费用',
    originalAmount: overrides.originalAmount ?? amount,
    adjustmentAmount: overrides.adjustmentAmount ?? 0,
    effectiveAmount: amount,
    operator: overrides.operator || '会计甲',
    adjusted: overrides.adjusted ?? false,
    version: overrides.version || 1,
    allocations: overrides.allocations || [{ projectId, amount }],
    auditEvents: overrides.auditEvents || [],
  }
}

function readyLedgerSummary(rows, overrides = {}) {
  const categoryTotals = [...new Set(rows.map(({ category }) => category))].map((category) => ({
    category,
    amount: rows.filter((row) => row.category === category)
      .reduce((total, row) => Math.round((total + row.effectiveAmount) * 10000) / 10000, 0),
  }))
  return {
    status: 'ready',
    data: {
      status: 'ready', generatedAt: '2026-08-10T01:00:00.000Z', page: 1, pageSize: 100,
      totalRows: rows.length, rows, categoryTotals,
      totalAmount: rows.reduce(
        (total, row) => Math.round((total + row.effectiveAmount) * 10000) / 10000,
        0,
      ),
      adjustmentTotal: 20,
      incompleteSources: [],
      ...overrides,
    },
  }
}

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

test('warehouse-issued material replaces confirmed-receipt purchase accrual without double count', () => {
  const warehouseCosts = [{
    costRecordId: 'WAREHOUSE-SO:11111111-1111-4111-8111-111111111111',
    projectId: 'P1', costType: '材料费', amount: 460, date: '2026-07-09',
    sourceType: 'warehouse',
    sourceDocumentId: '11111111-1111-4111-8111-111111111111',
    sourceDocumentType: 'warehouse_stock_out',
    sourcePurchaseRecordKeys: ['PO-WAREHOUSE'],
    sourceStockOutIds: ['11111111-1111-4111-8111-111111111111'],
  }]
  const bridged = bridgeWarehouseMaterialCosts({
    purchaseRows: [{
      purchaseId: 'PO-WAREHOUSE', purchaseDate: '2026-07-03', projectId: 'P1',
      purchaseStatus: '正常', totalCost: 1000,
    }],
    projectCostRecords: warehouseCosts,
    trackedPurchaseRecordKeys: ['PO-WAREHOUSE'],
  })
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: bridged.purchaseRows,
    manualProjectCosts: warehouseCosts,
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    operatingExpenses: [],
  }))

  assert.equal(model.companyMonthlyTotal.purchase, 460)
  assert.equal(model.companyMonthlyTotal.manual, 0)
  assert.equal(model.projectLifetimeById.P1.purchase, 460)
  assert.equal(model.companyMonthlyTotal.total, 300460)
})

test('warehouse-issued material preserves safe four-decimal frozen cost in project profit', () => {
  const warehouseCosts = [{
    costRecordId: 'WAREHOUSE-SO:22222222-2222-4222-8222-222222222222',
    projectId: 'P1', costType: '材料费', amount: 166.6667, date: '2026-07-09',
    sourceType: 'warehouse',
    sourceDocumentId: '22222222-2222-4222-8222-222222222222',
    sourceDocumentType: 'warehouse_stock_out',
    sourcePurchaseRecordKeys: ['PO-WAREHOUSE-DECIMAL'],
    sourceStockOutIds: ['22222222-2222-4222-8222-222222222222'],
  }]
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: [],
    manualProjectCosts: warehouseCosts,
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    operatingExpenses: [],
  }))

  assert.equal(model.companyMonthlyTotal.purchase, 166.6667)
  assert.equal(model.projectLifetimeById.P1.purchase, 166.6667)
  assert.equal(
    model.anomalies.some(({ source, code }) =>
      source === 'warehouseMaterialCosts' && code === 'invalid_amount'),
    false,
  )
})

test('minor-work full return remains a zero audit fact and a formal return reverses project cost', () => {
  const minorId = '77777777-7777-4777-8777-777777777777'
  const returnId = '88888888-8888-4888-8888-888888888888'
  const stockOutId = '99999999-9999-4999-8999-999999999999'
  const costs = [{
    costRecordId: `WAREHOUSE-MWO:${minorId}`,
    projectId: 'P1', costType: '材料费', amount: 0, date: '2026-07-09',
    sourceType: 'warehouse', sourceDocumentId: minorId,
    sourceDocumentType: 'warehouse_minor_work_order', sourcePurchaseRecordKeys: [],
    sourceStockOutIds: [stockOutId],
  }, {
    costRecordId: `WAREHOUSE-SR:${returnId}`,
    projectId: 'P1', costType: '材料费', amount: -90, date: '2026-07-09',
    sourceType: 'warehouseReversal', sourceDocumentId: returnId,
    sourceDocumentType: 'warehouse_return', sourcePurchaseRecordKeys: [],
    sourceStockOutIds: [stockOutId],
  }]
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: [], manualProjectCosts: costs,
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    operatingExpenses: [],
  }))
  assert.equal(model.companyMonthlyTotal.purchase, -90)
  assert.equal(model.projectLifetimeById.P1.purchase, -90)
  assert.equal(
    model.anomalies.some(({ source, code }) =>
      source === 'warehouseMaterialCosts' && code === 'invalid_amount'),
    false,
  )
})

test('warehouse-issued four-decimal costs aggregate in fixed 1/10000 yen units', () => {
  const costs = [
    ['33333333-3333-4333-8333-333333333333', 0.1],
    ['44444444-4444-4444-8444-444444444444', 0.2],
    ['66666666-6666-4666-8666-666666666666', 1.005],
  ].map(([id, amount]) => ({
    costRecordId: `WAREHOUSE-SO:${id}`,
    projectId: 'P1', costType: '材料费', amount, date: '2026-07-09',
    sourceType: 'warehouse', sourceDocumentId: id,
    sourceDocumentType: 'warehouse_stock_out', sourcePurchaseRecordKeys: [],
    sourceStockOutIds: [id],
  }))
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: [], manualProjectCosts: costs,
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    operatingExpenses: [],
  }))

  assert.equal(model.companyMonthlyTotal.purchase, 1.305)
  assert.equal(model.companyMonthlyTotal.total, 300001.305)
  assert.equal(model.projectLifetimeById.P1.purchase, 1.305)
})

test('ready unified ledger replaces every project-bound legacy cost exactly once', () => {
  const rows = [
    ledgerRow({
      sourceKey: 'warehouse:SPLIT', sourceModule: 'warehouse',
      sourceDocumentType: 'warehouse_stock_out', sourceDocumentId: 'SPLIT',
      projectId: 'P1', category: '材料费', originalAmount: 60,
      adjustmentAmount: 12, effectiveAmount: 72, adjusted: true, version: 3,
      allocations: [{ projectId: 'P1', amount: 72 }],
    }),
    ledgerRow({
      sourceKey: 'warehouse:SPLIT', sourceModule: 'warehouse',
      sourceDocumentType: 'warehouse_stock_out', sourceDocumentId: 'SPLIT',
      projectId: 'P2', category: '材料费', originalAmount: 40,
      adjustmentAmount: 8, effectiveAmount: 48, adjusted: true, version: 3,
      allocations: [{ projectId: 'P2', amount: 48 }],
    }),
    ledgerRow({
      sourceKey: 'manual:REFUND', sourceDocumentId: 'REFUND',
      projectId: 'P1', category: '其他费用', effectiveAmount: -10,
    }),
    ledgerRow({
      sourceKey: 'labor:L1', sourceModule: 'labor',
      sourceDocumentType: 'project_labor', sourceDocumentId: 'L1',
      projectId: 'P1', category: '人工费', effectiveAmount: 30,
    }),
    ledgerRow({
      sourceKey: 'operating:O1', sourceModule: 'operating',
      sourceDocumentType: 'operating_expense', sourceDocumentId: 'O1',
      projectId: 'P1', category: '经营费用', effectiveAmount: 5,
    }),
  ]
  const model = buildCostAccountingReadModel(julyFixture({
    activeProjectIds: ['P1', 'P2'],
    laborWindow: laborWindow({ projectLaborLifetimeById: { P1: 300000, P2: 0 } }),
    projectLedgerSummary: readyLedgerSummary(rows),
    purchaseRows: [
      {
        purchaseId: 'OLD-PROJECT', purchaseDate: '2026-07-03', projectId: 'P1',
        purchaseStatus: '正常', totalCost: 999,
      },
      {
        purchaseId: 'COMPANY-PURCHASE', purchaseDate: '2026-07-03',
        purchaseStatus: '正常', totalCost: 30,
      },
    ],
    fuelRecords: [{
      fuelRecordId: 'COMPANY-FUEL', fuelDate: '2026-07-04', fuelAmount: 40,
      allocateToProject: false,
    }, {
      fuelRecordId: 'OLD-PROJECT-FUEL', fuelDate: '2026-07-04', fuelAmount: 888,
      allocateToProject: true, projectId: 'P1',
    }],
    vehicleExpenseRecords: [], vehicleIssueRecords: [],
    manualProjectCosts: [{
      costRecordId: 'OLD-MANUAL', costType: '其他费用', amount: 777,
      projectId: 'P1', date: '2026-07-07',
    }],
    operatingExpenses: [{
      operatingExpenseId: 'COMPANY-OPEX', date: '2026-07-08', amount: 50,
      allocateToProject: false,
    }, {
      operatingExpenseId: 'OLD-PROJECT-OPEX', date: '2026-07-08', amount: 666,
      allocateToProject: true, projectId: 'P1',
    }],
  }))

  assert.deepEqual(model.projectLifetimeById.P1, {
    labor: 30, purchase: 72, vehicle: 0, manual: -10, operating: 5, total: 97,
  })
  assert.deepEqual(model.projectLifetimeById.P2, {
    labor: 0, purchase: 48, vehicle: 0, manual: 0, operating: 0, total: 48,
  })
  assert.equal(model.monthlyByMonth['2026-07'].salary, 300000)
  assert.equal(model.monthlyByMonth['2026-07'].purchase, 150)
  assert.equal(model.monthlyByMonth['2026-07'].vehicle, 40)
  assert.equal(model.monthlyByMonth['2026-07'].manual, -10)
  assert.equal(model.monthlyByMonth['2026-07'].operating, 55)
  assert.equal(model.monthlyByMonth['2026-07'].total, 300235)
  assert.equal(model.projectLedger.status, 'ready')
  assert.equal(model.projectLedger.monthlyTotal, 145)
  assert.equal(model.projectLedger.lifetimeTotal, 145)
})

test('incomplete unified ledger makes project totals explicitly unavailable without hiding company-only facts', () => {
  const model = buildCostAccountingReadModel(julyFixture({
    projectLedgerSummary: { status: 'loading', data: null },
    purchaseRows: [{
      purchaseId: 'COMPANY-PURCHASE', purchaseDate: '2026-07-03',
      purchaseStatus: '正常', totalCost: 30,
    }],
    fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    manualProjectCosts: [],
    operatingExpenses: [{
      operatingExpenseId: 'COMPANY-OPEX', date: '2026-07-08', amount: 50,
      allocateToProject: false,
    }],
  }))

  assert.equal(model.projectLedger.status, 'loading')
  assert.equal(model.companyMonthlyTotal.salary, 300000)
  assert.equal(model.companyMonthlyTotal.companyOperating, 50)
  assert.equal(model.companyMonthlyTotal.purchase, null)
  assert.equal(model.companyMonthlyTotal.operating, null)
  assert.equal(model.companyMonthlyTotal.total, null)
  assert.equal(model.companyMonthlyTotal.incomplete, true)
  assert.equal(model.projectLifetimeById.P1.total, null)
  assert.equal(model.selectedComposition.total, null)
  assert.equal(model.selectedComposition.incomplete, true)
})

test('unified ledger aggregation keeps adjusted and negative rows in exact four-decimal units', () => {
  const rows = [
    ledgerRow({ sourceKey: 'manual:A', sourceDocumentId: 'A', effectiveAmount: 0.1 }),
    ledgerRow({ sourceKey: 'manual:B', sourceDocumentId: 'B', effectiveAmount: 0.2 }),
    ledgerRow({ sourceKey: 'manual:C', sourceDocumentId: 'C', effectiveAmount: -0.0001 }),
  ]
  const model = buildCostAccountingReadModel(julyFixture({
    projectLedgerSummary: readyLedgerSummary(rows, {
      totalAmount: 0.2999,
      categoryTotals: [{ category: '其他费用', amount: 0.2999 }],
    }),
    purchaseRows: [], fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
    manualProjectCosts: [], operatingExpenses: [],
  }))

  assert.equal(model.projectLedger.monthlyTotal, 0.2999)
  assert.equal(model.projectLifetimeById.P1.total, 0.2999)
  assert.equal(model.companyMonthlyTotal.manual, 0.2999)
  assert.equal(model.companyMonthlyTotal.total, 300000.2999)
})

test('a ready-labelled partial or arithmetically inconsistent ledger never publishes a stale project total', () => {
  const row = ledgerRow({ sourceKey: 'manual:ONLY', sourceDocumentId: 'ONLY', effectiveAmount: 10 })
  for (const projectLedgerSummary of [
    readyLedgerSummary([row], { totalRows: 2 }),
    readyLedgerSummary([row], { totalAmount: 999 }),
    readyLedgerSummary([row], { categoryTotals: [{ category: '其他费用', amount: 999 }] }),
    readyLedgerSummary([{ ...row, category: '未知费用' }]),
  ]) {
    const model = buildCostAccountingReadModel(julyFixture({
      projectLedgerSummary,
      purchaseRows: [], fuelRecords: [], vehicleExpenseRecords: [], vehicleIssueRecords: [],
      manualProjectCosts: [], operatingExpenses: [],
    }))
    assert.equal(model.projectLedger.status, 'incomplete')
    assert.equal(model.projectLedger.monthlyTotal, null)
    assert.equal(model.projectLifetimeById.P1.total, null)
    assert.equal(model.companyMonthlyTotal.total, null)
  }
})

test('confirmed warehouse receipt without an issue is inventory, not current project purchase cost', () => {
  const bridged = bridgeWarehouseMaterialCosts({
    purchaseRows: [{
      purchaseId: 'PO-INVENTORY', purchaseDate: '2026-07-03', projectId: 'P1',
      purchaseStatus: '正常', totalCost: 1000,
    }],
    projectCostRecords: [],
    trackedPurchaseRecordKeys: ['PO-INVENTORY'],
  })
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: bridged.purchaseRows,
    manualProjectCosts: [], fuelRecords: [], vehicleExpenseRecords: [],
    vehicleIssueRecords: [], operatingExpenses: [],
  }))
  assert.equal(model.companyMonthlyTotal.purchase, 0)
  assert.equal(model.projectLifetimeById.P1.purchase, 0)
  assert.equal(model.companyMonthlyTotal.total, 300000)
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

test('manual classification preserves sparse supported data and omits unsupported graphs', () => {
  const sparse = new Array(4)
  sparse[1] = { label: 'caller' }
  const nullPrototype = Object.assign(Object.create(null), { note: 'safe' })
  const cycle = {}
  cycle.self = cycle
  let accessorReads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'secret', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 'unsafe'
    },
  })
  const valid = {
    costRecordId: 'M-SPARSE', costType: '外包费', amount: 10,
    projectId: 'P1', date: '2026-07-01',
    metadata: { sparse, nullPrototype },
  }
  const unsupported = [
    ['M-FUNCTION', () => {}],
    ['M-SYMBOL', Symbol('unsafe')],
    ['M-DATE', new Date('2026-07-01T00:00:00.000Z')],
    ['M-MAP', new Map([['key', 'value']])],
    ['M-SET', new Set(['value'])],
    ['M-CYCLE', cycle],
    ['M-ACCESSOR', accessor],
  ].map(([costRecordId, metadata]) => ({
    costRecordId, costType: '外包费', amount: 10,
    projectId: 'P1', date: '2026-07-01', metadata,
  }))

  const classified = classifyManualProjectCosts([valid, ...unsupported])

  assert.deepEqual(classified.confirmedRows.map((row) => row.costRecordId), ['M-SPARSE'])
  const published = classified.confirmedRows[0]
  assert.equal(published.metadata.sparse.length, 4)
  assert.equal(Object.hasOwn(published.metadata.sparse, '0'), false)
  assert.equal(Object.hasOwn(published.metadata.sparse, '1'), true)
  assert.equal(Object.hasOwn(published.metadata.sparse, '2'), false)
  assert.equal(Object.hasOwn(published.metadata.sparse, '3'), false)
  assert.equal(Object.getPrototypeOf(published.metadata.nullPrototype), null)
  assert.equal(accessorReads, 0)

  published.metadata.sparse[1].label = 'output'
  assert.equal(sparse[1].label, 'caller')
  sparse[2] = { label: 'input' }
  assert.equal(Object.hasOwn(published.metadata.sparse, '2'), false)
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

test('every manual and repair pending path omits unsupported row data with stable anomalies', () => {
  const cycle = {}
  cycle.self = cycle
  const manualProjectCosts = [
    ['M-L', '人工费', () => {}],
    ['M-M', '材料费', new Date('2026-07-01T00:00:00.000Z')],
    ['M-T', '工具费', new Map()],
    ['M-V', '车辆费', cycle],
    ['M-O', '外包费', new Set()],
  ].map(([costRecordId, costType, metadata]) => ({
    costRecordId, costType, metadata, amount: 10,
    projectId: 'P1', date: '2026-07-07',
  }))
  const model = buildCostAccountingReadModel(julyFixture({
    purchaseRows: [], fuelRecords: [], vehicleExpenseRecords: [],
    manualProjectCosts,
    vehicleIssueRecords: [{
      issueId: 'VI-UNSUPPORTED', issueDate: '2026-07-06', repairCost: 10,
      allocateToProject: true, projectId: 'P1', metadata: new Date(),
    }],
    operatingExpenses: [],
  }))

  assert.equal(model.pending.manualLaborCosts.length, 0)
  assert.equal(model.pending.manualMaterialCosts.length, 0)
  assert.equal(model.pending.manualToolCosts.length, 0)
  assert.equal(model.pending.manualVehicleCosts.length, 0)
  assert.equal(model.pending.vehicleRepairEstimates.length, 0)
  assert.equal(model.companyMonthlyTotal.manual, 0)
  assert.deepEqual(
    model.anomalies
      .filter(({ code }) => code === 'unsupported_output_data')
      .map(({ recordId }) => recordId),
    ['M-L', 'M-M', 'M-T', 'M-V', 'M-O', 'VI-UNSUPPORTED'],
  )
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

test('ready labor rows reject non-enum source values without publishing them', () => {
  for (const source of [{ unsafe: true }, () => {}, 'other', null]) {
    const model = buildCostAccountingReadModel(julyFixture({
      projectId: 'P1',
      laborWindow: laborWindow({
        monthly: [{
          month: '2026-07', status: 'ready', stale: false,
          salaryTotal: 300000, projectLaborTotal: 200000,
          projectLaborById: { P1: 200000 }, source, pendingCount: 0,
        }],
      }),
    }))

    assert.equal(model.companyMonthlyTotal.salary, null)
    assert.equal(model.companyMonthlyTotal.laborSource, null)
    assert.equal(model.selectedComposition.labor, null)
    assert.equal(model.anomalies.some(({ code }) => code === 'invalid_labor_source'), true)
  }
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

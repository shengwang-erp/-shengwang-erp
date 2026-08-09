import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyLedgerFilters,
  buildAllocationAmounts,
  buildLocalSourceFacts,
  normalizeLedgerSnapshot,
  paginateLedgerRows,
  summarizeLedgerRows,
} from './projectCostLedgerDomain.js'
import { toSignedFourDecimalUnits } from '../cost-accounting/fixedPointCurrency.js'

const COMPLETE_ROW = {
  sourceKey: 'warehouse:SO-1', sourceModule: 'warehouse',
  sourceDocumentType: 'warehouse_stock_out', sourceDocumentId: 'SO-1',
  projectId: 'P1', projectName: '第一项目', category: '材料费', date: '2026-08-01',
  description: '铜管领用', originalAmount: 1000, adjustmentAmount: 200,
  effectiveAmount: 1200, operator: '王工', adjusted: true, version: 2,
  allocations: [{ projectId: 'P1', amount: 1200 }],
  auditEvents: [{ at: '2026-08-01T09:00:00.000Z', action: 'adjust', operator: '王工' }],
}

const READY_RESPONSE = {
  status: 'ready', generatedAt: '2026-08-01T12:00:00.000Z', page: 1, pageSize: 20,
  totalRows: 1, rows: [COMPLETE_ROW],
  categoryTotals: [{ category: '材料费', amount: 1200 }],
  totalAmount: 1200, adjustmentTotal: 200, incompleteSources: [],
}

const SNAPSHOT = {
  rows: [
    COMPLETE_ROW,
    {
      ...COMPLETE_ROW, sourceKey: 'purchase:PO-1', sourceModule: 'purchase',
      sourceDocumentType: 'purchase_order', sourceDocumentId: 'PO-1', category: '材料费',
      description: '铜管采购', originalAmount: 5, adjustmentAmount: 0, effectiveAmount: 5,
      operator: '', adjusted: false, version: 1, allocations: [{ projectId: 'P1', amount: 5 }], auditEvents: [],
    },
    {
      ...COMPLETE_ROW, sourceKey: 'labor:L-1', sourceModule: 'labor',
      sourceDocumentType: 'salary', sourceDocumentId: 'L-1', category: '人工费',
      description: '八月工资', originalAmount: 10, adjustmentAmount: 0, effectiveAmount: 10,
      operator: '', adjusted: false, version: 1, allocations: [{ projectId: 'P1', amount: 10 }], auditEvents: [],
    },
  ],
}

const ALL_LOCAL_SOURCE_FIXTURES = {
  purchaseRows: [{ purchaseId: 'PO-1', purchaseDate: '2026-08-01', projectId: 'P1', projectName: '第一项目', totalCost: 100 }],
  warehouseCosts: [{ costRecordId: 'SO-1', date: '2026-08-02', projectId: 'P1', projectName: '第一项目', amount: 200, costType: '材料费' }],
  laborRows: [{ laborId: 'L-1', date: '2026-08-03', projectId: 'P1', projectName: '第一项目', amount: 300 }],
  vehicleRows: [{ vehicleExpenseId: 'V-1', expenseDate: '2026-08-04', projectId: 'P1', projectName: '第一项目', amount: 400 }],
  toolRows: [{ toolId: 'T-1', date: '2026-08-05', projectId: 'P1', projectName: '第一项目', amount: 500 }],
  operatingExpenses: [{ operatingExpenseId: 'O-1', date: '2026-08-06', projectId: 'P1', projectName: '第一项目', amount: 600 }],
  manualProjectCosts: [{ costRecordId: 'M-1', date: '2026-08-07', projectId: 'P1', projectName: '第一项目', amount: 700, costType: '其他费用' }],
}

test('normalizes a complete secure ledger row and freezes nested audit data', () => {
  const snapshot = normalizeLedgerSnapshot(READY_RESPONSE)
  assert.equal(snapshot.rows[0].effectiveAmount, 1200)
  assert.equal(snapshot.rows[0].adjusted, true)
  assert.throws(() => { snapshot.rows[0].auditEvents.push({}) }, TypeError)
})

test('rejects a supplier response with missing, inherited or accessor fields', () => {
  assert.throws(() => normalizeLedgerSnapshot({ status: 'ready' }), /ledger response/i)
  assert.throws(() => normalizeLedgerSnapshot(Object.create({ status: 'ready' })), /ledger response/i)
  const response = { ...READY_RESPONSE }
  Object.defineProperty(response, 'rows', { enumerable: true, get() { return READY_RESPONSE.rows } })
  assert.throws(() => normalizeLedgerSnapshot(response), /ledger response/i)
})

test('local source facts cover every project-bound demo expense without purchase duplication', () => {
  const facts = buildLocalSourceFacts(ALL_LOCAL_SOURCE_FIXTURES)
  assert.deepEqual(facts.map((row) => row.sourceModule), [
    'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual',
  ])
  assert.deepEqual(facts.map((row) => row.sourceKey), [
    'purchase:PO-1', 'warehouse:SO-1', 'labor:L-1', 'vehicle:V-1', 'tool:T-1', 'operating:O-1', 'manual:M-1',
  ])
})

test('local source facts exclude inactive rows and warehouse-confirmed purchase duplicates', () => {
  const sources = structuredClone(ALL_LOCAL_SOURCE_FIXTURES)
  sources.purchaseRows.push(
    { purchaseId: 'PO-VOID', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10, purchaseStatus: 'void' },
    { purchaseId: 'PO-DELETED', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10, deleted: true },
    { purchaseId: 'PO-WAREHOUSE', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10 },
    { purchaseId: 'PO-INTERNAL', recordKey: 'PR-RECORD-KEY', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10 },
    { purchaseId: 'PO-ALIAS', purchaseRecordKey: 'PR-ALIAS', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10 },
    { purchaseId: 'PO-UNTRUSTED', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10 },
    { purchaseId: 'PO-MULTI-STATUS', purchaseDate: '2026-08-01', projectId: 'P1', totalCost: 10 },
  )
  sources.warehouseCosts.push(
    { costRecordId: 'SO-WAREHOUSE', date: '2026-08-02', projectId: 'P1', amount: 10, sourceType: 'warehouse', sourcePurchaseRecordKeys: ['PO-WAREHOUSE'] },
    { costRecordId: 'SO-RECORD-KEY', date: '2026-08-02', projectId: 'P1', amount: 10, sourceType: 'warehouse', sourcePurchaseRecordKeys: ['PR-RECORD-KEY'] },
    { costRecordId: 'SO-ALIAS', date: '2026-08-02', projectId: 'P1', amount: 10, sourceType: 'warehouseReversal', sourcePurchaseRecordKeys: ['PR-ALIAS'] },
    { costRecordId: 'SO-UNTRUSTED', date: '2026-08-02', projectId: 'P1', amount: 10, sourcePurchaseRecordKeys: ['PO-UNTRUSTED'] },
    { costRecordId: 'SO-MULTI-STATUS', date: '2026-08-02', projectId: 'P1', amount: 10, status: 'pending', confirmationStatus: 'confirmed', sourcePurchaseRecordKeys: ['PO-MULTI-STATUS'] },
    { costRecordId: 'SO-CANCELLED', date: '2026-08-02', projectId: 'P1', amount: 10, status: 'cancelled' },
  )
  const facts = buildLocalSourceFacts(sources)
  assert.deepEqual(facts.filter(({ sourceModule }) => sourceModule === 'purchase').map(({ sourceDocumentId }) => sourceDocumentId), ['PO-1', 'PO-UNTRUSTED'])
  assert.deepEqual(facts.filter(({ sourceModule }) => sourceModule === 'warehouse').map(({ sourceDocumentId }) => sourceDocumentId), ['SO-1', 'SO-WAREHOUSE', 'SO-RECORD-KEY', 'SO-ALIAS', 'SO-UNTRUSTED', 'SO-MULTI-STATUS'])
})

test('rejects row allocations that do not exactly equal the effective amount', () => {
  assert.throws(() => normalizeLedgerSnapshot({
    ...READY_RESPONSE,
    rows: [{ ...COMPLETE_ROW, allocations: [{ projectId: 'P1', amount: 1199.9999 }] }],
  }), /ledger row/i)
})

test('filters by project, date, category, source, adjusted state and keyword', () => {
  const rows = applyLedgerFilters(SNAPSHOT, {
    projectId: 'P1', dateFrom: '2026-08-01', dateTo: '2026-08-31',
    category: '材料费', sourceModule: 'warehouse', adjusted: 'adjusted', keyword: '铜管',
  })
  assert.deepEqual(rows.map((row) => row.sourceKey), ['warehouse:SO-1'])
})

test('paginates immutable row collections without changing the source rows', () => {
  const rows = SNAPSHOT.rows.slice()
  assert.deepEqual(paginateLedgerRows(rows).map(({ sourceKey }) => sourceKey), rows.map(({ sourceKey }) => sourceKey))
  assert.equal(rows.length, 3)
  assert.deepEqual(paginateLedgerRows(rows, 0, 2), [])
  assert.throws(() => paginateLedgerRows(rows, 1, 2), /pageSize/i)
  assert.throws(() => normalizeLedgerSnapshot({ ...READY_RESPONSE, pageSize: 10 }), /pageSize/i)
})

test('summarizes ledger rows in fixed category order using four-decimal units', () => {
  const summary = summarizeLedgerRows([
    { ...COMPLETE_ROW, category: '其他费用', originalAmount: 0.3, effectiveAmount: 0.2, adjustmentAmount: -0.1, allocations: [{ projectId: 'P1', amount: 0.2 }] },
    { ...COMPLETE_ROW, category: '材料费', originalAmount: 0, effectiveAmount: 0.1, adjustmentAmount: 0.1, allocations: [{ projectId: 'P1', amount: 0.1 }] },
    { ...COMPLETE_ROW, category: '人工费', originalAmount: 1.005, effectiveAmount: 1.005, adjustmentAmount: 0, adjusted: false, allocations: [{ projectId: 'P1', amount: 1.005 }] },
  ])
  assert.deepEqual(summary, {
    totalAmount: 1.305, adjustmentTotal: 0, rowCount: 3,
    categoryTotals: [
      { category: '人工费', amount: 1.005 },
      { category: '材料费', amount: 0.1 },
      { category: '其他费用', amount: 0.2 },
    ],
  })
})

test('percentage allocations absorb only the final fixed-point remainder', () => {
  assert.deepEqual(buildAllocationAmounts(100, [
    { projectId: 'P1', mode: 'percent', value: 33.3333 },
    { projectId: 'P2', mode: 'percent', value: 66.6667 },
  ]), [{ projectId: 'P1', amount: 33.3333 }, { projectId: 'P2', amount: 66.6667 }])
})

test('percentage allocations retain fixed-point precision at the safe-unit boundary', () => {
  const allocations = buildAllocationAmounts(900719925474.0991, [
    { projectId: 'P1', mode: 'percent', value: 33.3333 },
    { projectId: 'P2', mode: 'percent', value: 66.6667 },
  ])
  assert.deepEqual(allocations, [
    { projectId: 'P1', amount: 300239674918.0578 },
    { projectId: 'P2', amount: 600480250556.0413 },
  ])
  assert.equal(
    allocations.reduce((units, { amount }) => units + toSignedFourDecimalUnits(amount), 0),
    toSignedFourDecimalUnits(900719925474.0991),
  )
})

test('allocation inputs and source snapshots fail closed on unsafe own-data graphs', () => {
  const sparse = new Array(1)
  assert.throws(() => buildAllocationAmounts(10, sparse), TypeError)
  assert.throws(() => normalizeLedgerSnapshot({ ...READY_RESPONSE, rows: [{ ...COMPLETE_ROW, allocations: [{ projectId: 'P1', amount: 1, __proto__: { polluted: true } }] }] }), TypeError)
})

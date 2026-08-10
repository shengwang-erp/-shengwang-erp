import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import ExcelJS from 'exceljs'

import {
  createProjectCostWorkbook,
  exportProjectCostXlsx,
  loadCompleteProjectCostLedgerSnapshot,
  loadCompleteProjectCostReportSnapshot,
} from './projectCostLedgerExport.js'

const MONEY_FORMAT = '¥#,##0.0000;[Red]-¥#,##0.0000'

const ledgerSnapshot = Object.freeze({
  status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', page: 1, pageSize: 20,
  totalRows: 2, totalAmount: 120.25, adjustmentTotal: -9.75, incompleteSources: [],
  categoryTotals: Object.freeze([
    Object.freeze({ category: '材料费', amount: 100.25 }),
    Object.freeze({ category: '人工费', amount: 20 }),
  ]),
  rows: Object.freeze([
    Object.freeze({
      sourceKey: 'warehouse:OUT-1', sourceModule: 'warehouse', sourceDocumentType: 'warehouse_outflow',
      sourceDocumentId: 'OUT-1', projectId: 'P-1', projectName: '东京站项目', category: '材料费',
      date: '2026-08-09', description: '=HYPERLINK("https://evil")', originalAmount: 110,
      adjustmentAmount: -9.75, effectiveAmount: 100.25, operator: '@仓库员', adjusted: true,
      version: 2, allocations: Object.freeze([Object.freeze({ projectId: 'P-1', amount: 100.25 })]),
      auditEvents: Object.freeze([]),
    }),
    Object.freeze({
      sourceKey: 'labor:LAB-1', sourceModule: 'labor', sourceDocumentType: 'project_labor',
      sourceDocumentId: 'LAB-1', projectId: 'P-1', projectName: '东京站项目', category: '人工费',
      date: '2026-08-10', description: '+现场安装', originalAmount: 20,
      adjustmentAmount: 0, effectiveAmount: 20, operator: '施工员', adjusted: false,
      version: 1, allocations: Object.freeze([Object.freeze({ projectId: 'P-1', amount: 20 })]),
      auditEvents: Object.freeze([]),
    }),
  ]),
})

const auditSnapshot = Object.freeze({
  status: 'ready', generatedAt: '2026-08-10T03:00:01.000Z',
  events: Object.freeze([Object.freeze({
    eventType: 'adjustment', sourceKey: 'warehouse:OUT-1', sequenceNo: 1,
    amountBefore: 110, amountAfter: 100.25, adjustmentAmount: -9.75,
    allocationsBefore: null, allocationsAfter: null, reason: '-供应商折扣',
    actorName: '+会计甲', createdAt: '2026-08-10T02:00:00.000Z',
  })]),
})

const metadata = Object.freeze({
  companyName: '生旺株式会社', projectName: '东京站项目',
  filterSummary: '材料费与人工费', dateRange: '2026-08-01 至 2026-08-31',
  generatedAt: '2026-08-10T04:05:06.000Z', reportComplete: true,
})

test('project cost workbook keeps exactly three readable A4 landscape sheets', () => {
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  assert.deepEqual(workbook.worksheets.map(({ name }) => name), [
    '项目成本明细', '分类汇总', '调整记录',
  ])
  for (const sheet of workbook.worksheets) {
    assert.equal(sheet.views[0].state, 'frozen')
    assert.equal(sheet.views[0].ySplit, 6)
    assert.ok(sheet.autoFilter)
    assert.equal(sheet.pageSetup.orientation, 'landscape')
    assert.equal(sheet.pageSetup.paperSize, 9)
    assert.equal(sheet.pageSetup.fitToWidth, 1)
    assert.equal(sheet.pageSetup.printTitlesRow, '1:6')
    assert.match(sheet.pageSetup.printArea, /^A1:/u)
    assert.ok(sheet.columns.every(({ width }) => width >= 12))
    assert.match(String(sheet.getCell('A2').value), /生旺株式会社/u)
    assert.match(String(sheet.getCell('A3').value), /东京站项目/u)
    assert.match(String(sheet.getCell('A5').value), /完整/u)
  }
})

test('detail and summary sheets contain fixed-point subtotals, formulas and project total', () => {
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  const detail = workbook.getWorksheet('项目成本明细')
  const categoryRows = detail.getRows(1, detail.rowCount).filter((row) =>
    typeof row.getCell(1).value === 'string' && row.getCell(1).value.endsWith('小计'))
  assert.equal(categoryRows.length, 2)
  assert.deepEqual(categoryRows.map((row) => row.getCell(8).value.result), [100.25, 20])
  assert.ok(categoryRows.every((row) => typeof row.getCell(8).value.formula === 'string'))
  const totalRow = detail.getRows(1, detail.rowCount).find((row) => row.getCell(1).value === '项目总计')
  assert.equal(totalRow.getCell(8).value.result, 120.25)
  assert.match(totalRow.getCell(8).value.formula, /^SUM\(/u)
  for (const row of [...categoryRows, totalRow]) assert.equal(row.getCell(8).numFmt, MONEY_FORMAT)

  const summary = workbook.getWorksheet('分类汇总')
  const summaryTotal = summary.getRows(1, summary.rowCount).find((row) => row.getCell(1).value === '项目总计')
  assert.equal(summaryTotal.getCell(2).value.result, 120.25)
  assert.match(summaryTotal.getCell(2).value.formula, /^SUM\(/u)
  assert.equal(summaryTotal.getCell(2).numFmt, MONEY_FORMAT)
})

test('business and audit text is formula-safe while audit identity and reason remain visible', () => {
  const workbook = createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)
  const detail = workbook.getWorksheet('项目成本明细')
  const descriptionCell = detail.getRows(7, detail.rowCount - 6)
    .flatMap((row) => row.values.slice(1)).find((value) => String(value).includes('HYPERLINK'))
  assert.equal(descriptionCell, "'=HYPERLINK(\"https://evil\")")
  assert.ok(detail.getRows(7, detail.rowCount - 6).flatMap((row) => row.values.slice(1)).includes("'@仓库员"))

  const audit = workbook.getWorksheet('调整记录')
  const dataRow = audit.getRow(7)
  assert.equal(dataRow.getCell(9).value, "'-供应商折扣")
  assert.equal(dataRow.getCell(10).value, "'+会计甲")
  assert.equal(dataRow.getCell(11).value, '2026-08-10T02:00:00.000Z')
  for (const column of [4, 5, 6]) assert.equal(dataRow.getCell(column).numFmt, MONEY_FORMAT)
})

test('empty reports use zero formulas without self-referencing total cells', () => {
  const emptySnapshot = {
    ...ledgerSnapshot, totalRows: 0, totalAmount: 0, adjustmentTotal: 0, rows: [], categoryTotals: [],
  }
  const workbook = createProjectCostWorkbook(ExcelJS, emptySnapshot, { ...auditSnapshot, events: [] }, metadata)
  const detail = workbook.getWorksheet('项目成本明细')
  const summary = workbook.getWorksheet('分类汇总')
  assert.deepEqual(detail.getCell('H7').value, { formula: '0' })
  assert.deepEqual(summary.getCell('B7').value, { formula: '0' })
})

test('production Excel entry retains a literal dynamic ExcelJS import', async () => {
  const source = await readFile(new URL('./projectCostLedgerExport.js', import.meta.url), 'utf8')
  assert.match(source, /import\(\s*['"]exceljs['"]\s*\)/u)
  assert.doesNotMatch(source, /^\s*import\s+[^('\n]+from\s+['"]exceljs['"]/mu)
})

function reportRow(index, { version = 1 } = {}) {
  return Object.freeze({
    sourceKey: `manual:ROW-${index}`, sourceModule: 'manual', sourceDocumentType: 'manual_project_cost',
    sourceDocumentId: `ROW-${index}`, projectId: 'P-1', projectName: '东京站项目', category: '其他费用',
    date: '2026-08-10', description: `费用-${index}`, originalAmount: 1, adjustmentAmount: 0,
    effectiveAmount: 1, operator: '会计甲', adjusted: false, version,
    allocations: Object.freeze([Object.freeze({ projectId: 'P-1', amount: 1 })]), auditEvents: Object.freeze([]),
  })
}

function reportPage(page, { totalRows = 205, version = 1 } = {}) {
  const start = (page - 1) * 100
  const count = Math.max(0, Math.min(100, totalRows - start))
  return Object.freeze({
    status: 'ready', generatedAt: `2026-08-10T03:00:0${page}.000Z`, page, pageSize: 100,
    totalRows, totalAmount: totalRows, adjustmentTotal: 0,
    categoryTotals: Object.freeze([Object.freeze({ category: '其他费用', amount: totalRows })]),
    incompleteSources: Object.freeze([]),
    rows: Object.freeze(Array.from({ length: count }, (_, offset) => reportRow(start + offset + 1, { version }))),
  })
}

function auditEvent(sourceKey, { actorName = '会计甲', reason = '项目拆分' } = {}) {
  return {
    eventType: 'allocation', sourceKey, sequenceNo: 1,
    amountBefore: 1, amountAfter: 1, adjustmentAmount: 0,
    allocationsBefore: [{ projectId: 'P-1', amount: 1 }],
    allocationsAfter: [{ projectId: 'P-1', amount: 1 }],
    reason, actorName, createdAt: '2026-08-10T02:00:00.000Z',
  }
}

test('complete report loader uses one atomic server snapshot even when legacy pages could be replaced with the same totals', async () => {
  const reportCalls = []
  const service = {
    async list() { throw new Error('cross-transaction pagination must not be used') },
    async listAudit() { throw new Error('separate audit read must not be used') },
    async report(filters) {
      reportCalls.push({ ...filters })
      const complete = reportPage(1)
      return Object.freeze({
        status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', snapshotToken: 'b'.repeat(64),
        ledgerSnapshot: Object.freeze({
          ...complete, rows: Object.freeze(Array.from({ length: 205 }, (_, index) => reportRow(index + 1))),
        }),
        auditSnapshot: Object.freeze({ status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: Object.freeze([]) }),
      })
    },
  }
  const screenPage = { ...reportPage(2), pageSize: 20, rows: reportPage(2).rows.slice(0, 20) }
  const report = await loadCompleteProjectCostReportSnapshot({
    service, filters: { projectId: 'P-1', dateFrom: '2026-08-01', dateTo: '2026-08-31', category: '', sourceModule: '', adjusted: 'all', keyword: '' },
    screenSnapshot: screenPage,
    screenAuditSnapshot: { status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', events: [] },
    isCurrent: () => true,
  })
  assert.deepEqual(reportCalls, [{ projectId: 'P-1', dateFrom: '2026-08-01', dateTo: '2026-08-31' }])
  assert.equal(report.ledgerSnapshot.rows.length, 205)
  assert.equal(report.ledgerSnapshot.totalRows, 205)
  assert.equal(report.ledgerSnapshot.rows[0].sourceDocumentId, 'ROW-1')
  assert.equal(report.ledgerSnapshot.rows.at(-1).sourceDocumentId, 'ROW-205')
  assert.ok(Object.isFrozen(report.ledgerSnapshot))
  assert.ok(Object.isFrozen(report.ledgerSnapshot.rows))
})

test('accounting summary loader consumes the same atomic server report', async () => {
  const reportCalls = []
  const service = {
    async report(filters) {
      reportCalls.push({ ...filters })
      return {
        status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', snapshotToken: 'c'.repeat(64),
        ledgerSnapshot: { ...reportPage(1), rows: Array.from({ length: 205 }, (_, index) => reportRow(index + 1)) },
        auditSnapshot: { status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [] },
      }
    },
  }
  const snapshot = await loadCompleteProjectCostLedgerSnapshot({
    service,
    filters: {},
    isCurrent: () => true,
  })

  assert.deepEqual(reportCalls, [{}])
  assert.equal(snapshot.totalRows, 205)
  assert.equal(snapshot.rows.length, 205)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.rows))
})

test('atomic report loader fails closed instead of falling back to equal-count equal-total pages', async () => {
  let legacyCalls = 0
  const service = {
    async list() { legacyCalls += 1; return reportPage(1) },
    async listAudit() { legacyCalls += 1; return { status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [] } },
  }
  await assert.rejects(() => loadCompleteProjectCostReportSnapshot({
    service, filters: {}, screenSnapshot: reportPage(1),
    screenAuditSnapshot: { status: 'ready', events: [] }, isCurrent: () => true,
  }), /原子|atomic|完整报表/iu)
  assert.equal(legacyCalls, 0)
})

test('complete report loader rejects changed page totals and ledger-audit version gaps', async () => {
  const unstableService = {
    async list({ page }) { return reportPage(page, { totalRows: page === 2 ? 204 : 205 }) },
    async listAudit() { return { status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [] } },
  }
  await assert.rejects(() => loadCompleteProjectCostReportSnapshot({
    service: unstableService, filters: {}, screenSnapshot: reportPage(1),
    screenAuditSnapshot: { status: 'ready', events: [] }, isCurrent: () => true,
  }), /完整|consistent|page/iu)

  const auditGapService = {
    async report() {
      return {
        status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', snapshotToken: 'd'.repeat(64),
        ledgerSnapshot: reportPage(1, { totalRows: 1, version: 2 }),
        auditSnapshot: { status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [] },
      }
    },
  }
  await assert.rejects(() => loadCompleteProjectCostReportSnapshot({
    service: auditGapService, filters: {}, screenSnapshot: reportPage(1, { totalRows: 1, version: 2 }),
    screenAuditSnapshot: { status: 'ready', events: [] }, isCurrent: () => true,
  }), /审计|audit/iu)
})

test('complete report loader returns no partial snapshot after its generation becomes stale', async () => {
  let current = true
  let release
  const blocked = new Promise((resolve) => { release = resolve })
  const service = {
    async report() {
      await blocked
      return {
        status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', snapshotToken: 'e'.repeat(64),
        ledgerSnapshot: { ...reportPage(1), rows: Array.from({ length: 205 }, (_, index) => reportRow(index + 1)) },
        auditSnapshot: { status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [] },
      }
    },
  }
  const pending = loadCompleteProjectCostReportSnapshot({
    service, filters: {}, screenSnapshot: reportPage(2),
    screenAuditSnapshot: { status: 'ready', events: [] }, isCurrent: () => current,
  })
  current = false
  release()
  assert.equal(await pending, null)
})

test('matched report audit keeps complete in-scope history and deeply freezes away filter-out events', async () => {
  const inScopeSource = 'manual:ROW-1'
  const outsideSource = 'manual:FILTERED-OUT'
  const broadAudit = {
    status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z',
    events: [
      auditEvent(inScopeSource),
      auditEvent(outsideSource, { actorName: '外部会计', reason: '筛选外秘密原因' }),
    ],
  }
  const service = {
    async list() { return reportPage(1, { totalRows: 1, version: 2 }) },
    async listAudit() { return broadAudit },
  }
  const report = await loadCompleteProjectCostReportSnapshot({
    service, filters: { category: '其他费用', sourceModule: 'manual', adjusted: 'adjusted', keyword: 'ROW-1' },
    screenSnapshot: reportPage(1, { totalRows: 1, version: 2 }),
    screenAuditSnapshot: broadAudit, isCurrent: () => true,
  })
  assert.equal(report.auditSnapshot.generatedAt, broadAudit.generatedAt)
  assert.deepEqual(report.auditSnapshot.events.map(({ sourceKey }) => sourceKey), [inScopeSource])
  assert.equal(JSON.stringify(report.auditSnapshot).includes('筛选外秘密原因'), false)
  assert.equal(JSON.stringify(report.auditSnapshot).includes('外部会计'), false)
  assert.ok(Object.isFrozen(report.auditSnapshot))
  assert.ok(Object.isFrozen(report.auditSnapshot.events))
  assert.ok(Object.isFrozen(report.auditSnapshot.events[0]))
  assert.ok(Object.isFrozen(report.auditSnapshot.events[0].allocationsBefore))
  assert.ok(Object.isFrozen(report.auditSnapshot.events[0].allocationsBefore[0]))
  assert.equal(broadAudit.events.length, 2)

  const workbook = createProjectCostWorkbook(ExcelJS, report.ledgerSnapshot, report.auditSnapshot, metadata)
  const auditSheet = workbook.getWorksheet('调整记录')
  assert.equal(auditSheet.rowCount, 7)
  assert.equal(auditSheet.getCell('A7').value, inScopeSource)
  assert.equal(String(auditSheet.getCell('I7').value).includes('秘密'), false)
})

test('zero-row filtered report returns a frozen empty matched audit instead of broad project history', async () => {
  const outsideEvent = auditEvent('manual:FILTERED-OUT', { reason: '不应输出' })
  const service = {
    async report() {
      return {
        status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', snapshotToken: 'f'.repeat(64),
        ledgerSnapshot: { ...reportPage(1, { totalRows: 0 }), generatedAt: '2026-08-10T04:00:00.000Z' },
        auditSnapshot: { status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [] },
      }
    },
  }
  const report = await loadCompleteProjectCostReportSnapshot({
    service, filters: { keyword: '无匹配' }, screenSnapshot: reportPage(1, { totalRows: 0 }),
    screenAuditSnapshot: { status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', events: [] },
    isCurrent: () => true,
  })
  assert.deepEqual(report.auditSnapshot, {
    status: 'ready', generatedAt: '2026-08-10T04:00:00.000Z', events: [],
  })
  assert.ok(Object.isFrozen(report.auditSnapshot))
  assert.ok(Object.isFrozen(report.auditSnapshot.events))
})

test('Excel download guard prevents stale output after asynchronous workbook generation', async () => {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousCreate = Object.getOwnPropertyDescriptor(globalThis.URL, 'createObjectURL')
  const previousRevoke = Object.getOwnPropertyDescriptor(globalThis.URL, 'revokeObjectURL')
  let created = 0
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { createElement() { return { click() { throw new Error('stale click') } } } },
  })
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    configurable: true, value() { created += 1; return 'blob:stale' },
  })
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, value() {} })
  try {
    const result = await exportProjectCostXlsx(ledgerSnapshot, auditSnapshot, {
      ...metadata, outputGuard: () => false,
    })
    assert.equal(result, false)
    assert.equal(created, 0)
  } finally {
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else delete globalThis.document
    if (previousCreate) Object.defineProperty(globalThis.URL, 'createObjectURL', previousCreate)
    else delete globalThis.URL.createObjectURL
    if (previousRevoke) Object.defineProperty(globalThis.URL, 'revokeObjectURL', previousRevoke)
    else delete globalThis.URL.revokeObjectURL
  }
})

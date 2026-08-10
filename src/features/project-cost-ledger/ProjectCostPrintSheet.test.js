import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { printProjectCostReport } from './projectCostLedgerExport.js'
import { installWarehouseReactDom } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(), cacheDir: '/private/tmp/task8-project-cost-print-vite-cache',
  configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/project-cost-ledger/ProjectCostPrintSheet.jsx')
after(() => server.close())
const ProjectCostPrintSheet = loaded.default

const snapshot = Object.freeze({
  status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', totalRows: 2,
  totalAmount: 80, adjustmentTotal: -20, incompleteSources: [], categoryTotals: Object.freeze([
    Object.freeze({ category: '材料费', amount: 60 }), Object.freeze({ category: '人工费', amount: 20 }),
  ]), rows: Object.freeze([
    Object.freeze({ sourceKey: 'warehouse:1', date: '2026-08-09', category: '材料费', sourceModule: 'warehouse', sourceDocumentId: 'OUT-1', description: '铜管', originalAmount: 80, adjustmentAmount: -20, effectiveAmount: 60, projectName: '东京项目', operator: '仓库甲', adjusted: true }),
    Object.freeze({ sourceKey: 'labor:1', date: '2026-08-10', category: '人工费', sourceModule: 'labor', sourceDocumentId: 'LAB-1', description: '安装', originalAmount: 20, adjustmentAmount: 0, effectiveAmount: 20, projectName: '东京项目', operator: '施工乙', adjusted: false }),
  ]),
})
const audit = Object.freeze({ status: 'ready', events: Object.freeze([Object.freeze({
  sourceKey: 'warehouse:1', sequenceNo: 1, eventType: 'adjustment', amountBefore: 80,
  adjustmentAmount: -20, amountAfter: 60, reason: '折扣更正', actorName: '会计甲',
  createdAt: '2026-08-10T02:00:00.000Z', allocationsBefore: null, allocationsAfter: null,
})]) })
const metadata = Object.freeze({ companyName: '生旺株式会社', projectName: '东京项目', dateRange: '2026-08-01 至 2026-08-31', filterSummary: '全部费用', generatedAt: '2026-08-10T04:05:06.000Z', reportComplete: true })

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

test('print sheet groups readable main rows, subtotals and an isolated audit appendix', () => {
  const html = renderToStaticMarkup(createElement(ProjectCostPrintSheet, {
    ledgerSnapshot: snapshot, auditSnapshot: audit, metadata,
  }))
  for (const text of ['生旺株式会社', '东京项目', '2026-08-01 至 2026-08-31', '2026-08-10', '材料费小计', '人工费小计', '项目总计', '已调整', '调整记录附页', '折扣更正', '会计甲']) {
    assert.match(html, new RegExp(text, 'u'), text)
  }
  assert.match(html, /project-cost-print-main-table/u)
  assert.match(html, /project-cost-print-audit-appendix/u)
})

test('named A4 landscape CSS repeats headers and keeps body text at least ten points', async () => {
  const css = await readFile(new URL('./projectCostLedgerPrint.css', import.meta.url), 'utf8')
  assert.match(css, /@page\s+project-cost-ledger\s*\{[^}]*size:\s*A4 landscape/isu)
  assert.match(css, /page:\s*project-cost-ledger/iu)
  assert.match(css, /\.project-cost-print-sheet\s*\{[^}]*font-size:\s*(?:1[0-9]|[2-9][0-9])pt/isu)
  assert.match(css, /thead\s*\{[^}]*display:\s*table-header-group/isu)
  assert.match(css, /project-cost-print-audit-appendix[^}]*break-before:\s*page/isu)
  assert.match(css, /body\.project-cost-ledger-printing\s*>\s*:not\(\.project-cost-print-root\)\s*\{[^}]*display:\s*none/isu)
  assert.doesNotMatch(css, /visibility:\s*hidden/iu)
  assert.doesNotMatch(css, /position:\s*absolute/iu)
})

test('print sheet portals a normal-flow isolated root directly under body and removes it on unmount', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostPrintSheet, {
      ledgerSnapshot: snapshot, auditSnapshot: audit, metadata,
    })) })
    const roots = elements(dom.document.body, (element) => element.className === 'project-cost-print-root')
    assert.equal(roots.length, 1)
    assert.equal(roots[0].parentNode, dom.document.body)
    assert.notEqual(roots[0].parentNode, container)
    assert.match(roots[0].textContent, /项目总计/u)
    await act(async () => { root.unmount() })
    assert.equal(elements(dom.document.body, (element) => element.className === 'project-cost-print-root').length, 0)
  } finally {
    dom.cleanup()
  }
})

test('print scope exists only during native print and restores the body after success or failure', () => {
  for (const fails of [false, true]) {
    const body = { className: 'erp-black-gold another-class' }
    const documentRef = { body }
    const operation = () => {
      assert.match(body.className, /project-cost-ledger-printing/u)
      if (fails) throw new Error('print failed')
    }
    if (fails) assert.throws(() => printProjectCostReport(operation, documentRef), /print failed/u)
    else printProjectCostReport(operation, documentRef)
    assert.equal(body.className, 'erp-black-gold another-class')
  }
})

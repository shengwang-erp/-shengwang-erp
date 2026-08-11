import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { createAccountingReportModel } from './accountingReportModel.js'
import { installWarehouseReactDom } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(), cacheDir: '/private/tmp/task3-accounting-print-sheet-vite-cache',
  configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/accounting-reports/AccountingReportPrintSheet.jsx')
after(() => server.close())
const AccountingReportPrintSheet = loaded.default

const report = createAccountingReportModel({
  id: 'payroll-2026-07',
  title: '工资记录表',
  companyName: '生旺株式会社',
  generatedAt: '2026-08-11 09:30',
  preparedBy: '会计甲',
  orientation: 'landscape',
  fileName: '2026年7月工资记录表',
  filterLines: [{ label: '筛选条件', value: '2026年7月／全部人员' }],
  recordCount: 1,
  summary: [{ label: '应发合计', value: 123456, format: 'money' }],
  sections: [{
    id: 'payroll', title: '工资明细', sheetName: '工资明细', emptyText: '无工资记录',
    columns: [
      { key: 'name', label: '姓名', align: 'left', format: 'text' },
      { key: 'gross', label: '应发工资', align: 'right', format: 'money' },
    ],
    rows: [{ name: '山田太郎', gross: 123456 }],
  }],
  notes: ['本表仅供内部核对。'],
})

const emptyReport = createAccountingReportModel({
  id: 'empty-payroll', title: '空工资记录表', generatedAt: '2026-08-11 09:35',
  preparedBy: '会计甲', fileName: '空工资记录表', recordCount: 0,
  sections: [{
    id: 'empty-payroll', title: '工资明细', sheetName: '工资明细',
    emptyText: '调用方自定义空文案',
    columns: [{ key: 'name', label: '姓名' }], rows: [],
  }],
})

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

test('print sheet renders the frozen accounting model as a leadership-ready paper report', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report }))
  for (const text of [
    '生旺株式会社', '工资记录表', '筛选条件', '2026年7月／全部人员',
    '¥123,456', '山田太郎', '制表人', '复核人', '审批人',
  ]) assert.match(html, new RegExp(text, 'u'), text)
  assert.match(html, /accounting-report-sheet landscape/u)
  assert.match(html, /align-right/u)
})

test('money summaries are visibly classified for right alignment', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report }))
  assert.match(html, /accounting-report-summary"><h2>汇总<\/h2><table><tbody><tr><th>应发合计<\/th><td class="align-right">¥123,456<\/td>/u)
})

test('zero-row print sections always use the binding no-record wording', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report: emptyReport }))
  assert.match(html, /当前筛选条件下无记录/u)
  assert.doesNotMatch(html, /调用方自定义空文案/u)
})

test('print CSS selects named A4 pages, repeats headers, and stays independent of the ERP theme', async () => {
  const css = await readFile(new URL('./accountingReportPrint.css', import.meta.url), 'utf8')
  assert.match(css, /@page\s+accounting-report-landscape\s*\{[^}]*size:\s*A4 landscape/isu)
  assert.match(css, /@page\s+accounting-report-portrait\s*\{[^}]*size:\s*A4 portrait/isu)
  assert.match(css, /\.accounting-report-sheet\s*\{[^}]*font-size:\s*10pt/isu)
  assert.match(css, /\.accounting-report-sheet\.landscape\s*\{[^}]*page:\s*accounting-report-landscape/isu)
  assert.match(css, /\.accounting-report-sheet\.portrait\s*\{[^}]*page:\s*accounting-report-portrait/isu)
  assert.match(css, /\.accounting-report-sheet\s*>\s*section\s*>\s*h2\s*\{[^}]*font-size:\s*1[2-4]pt/isu)
  assert.match(css, /thead\s*\{[^}]*display:\s*table-header-group/isu)
  assert.match(css, /break-inside:\s*avoid/iu)
  assert.match(css, /body\.accounting-report-printing\s*>\s*:not\(\.accounting-report-print-root\)\s*\{[^}]*display:\s*none/isu)
  assert.match(css, /\.accounting-report-page-number::after\s*\{[^}]*content:\s*"第 " counter\(page\) " 页"/isu)
  assert.doesNotMatch(css, /visibility:\s*hidden|position:\s*(?:absolute|fixed)/iu)
  assert.doesNotMatch(css, /#(?:c69a45|d6a84b|b88736)/iu)
  assert.doesNotMatch(css, /background(?:-color)?:\s*#(?:000|000000|171513)/iu)
})

test('print sheet portals a normal-flow root directly under body and removes it on unmount', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(AccountingReportPrintSheet, { report })) })
    const roots = elements(dom.document.body, (element) => element.className === 'accounting-report-print-root')
    assert.equal(roots.length, 1)
    assert.equal(roots[0].parentNode, dom.document.body)
    assert.notEqual(roots[0].parentNode, container)
    assert.match(roots[0].textContent, /工资记录表/u)
    await act(async () => { root.unmount() })
    assert.equal(elements(dom.document.body, (element) => element.className === 'accounting-report-print-root').length, 0)
  } finally {
    dom.cleanup()
  }
})

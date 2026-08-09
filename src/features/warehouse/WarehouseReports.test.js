import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from './warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

async function loadReportsModule() {
  const server = await createServer({
    root: process.cwd(), configFile: false, logLevel: 'silent', appType: 'custom',
    cacheDir: '/private/tmp/codex-warehouse-reports-vite-cache',
    server: { middlewareMode: true },
  })
  try { return await server.ssrLoadModule('/src/features/warehouse/WarehouseReports.jsx') }
  finally { await server.close() }
}

const reportsModule = await loadReportsModule()
const WarehouseReports = reportsModule.default
const printCss = await readFile(new URL('./warehouseReportPrint.css', import.meta.url), 'utf8')

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function button(root, text) {
  return elements(root, (element) => element.nodeName === 'BUTTON' && element.textContent.includes(text))[0]
}

function field(root, label) {
  const wrapper = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))[0]
  return elements(wrapper, (element) => ['INPUT', 'SELECT'].includes(element.nodeName))[0]
}

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

const emptyReport = (reportType = 'current_stock', rows = []) => ({
  reportType, page: 1, pageSize: 100, export: false,
  generatedAt: '2026-08-09T01:02:03Z', rows,
})

test('report page renders only the current filtered sheet and disables Excel without export permission', () => {
  const html = renderToStaticMarkup(createElement(WarehouseReports, {
    warehouseService: { listReport: async () => assert.fail('effects do not run in SSR') },
    canExport: false,
    initialReport: emptyReport('current_stock', [{
      itemName: '铜管', model: 'R410A', size: '6mm', sku: 'CU-6', category: '材料',
      warehouseName: '本社仓', shelfCode: 'A-01', shelfName: '一号架', quantity: 8,
      unit: '米', unitCost: null, totalCost: null,
    }]),
  }))
  assert.match(html, /仓库报表/u)
  assert.match(html, /class="[^"]*warehouse-print-sheet/u)
  assert.match(html, /铜管/u)
  assert.match(html, /导出 Excel/u)
  assert.match(html, /disabled=""/u)
  assert.equal((html.match(/warehouse-print-sheet/gu) || []).length, 1)
  assert.doesNotMatch(html, /物品档案报表[\s\S]*铜管[\s\S]*低库存报表/u)
})

test('report print contract uses a named page and isolates the current print sheet', () => {
  assert.match(printCss, /@page\s+warehouse-report/u)
  assert.match(printCss, /@media\s+print/u)
  assert.match(printCss, /body\.warehouse-report-printing\s+\*[^}]*visibility:\s*hidden/su)
  assert.match(printCss, /\.warehouse-print-sheet[^}]*page:\s*warehouse-report/su)
})

test('print uses the visible filtered sheet and does not request export-sized data', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const calls = []
  let printCalls = 0
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(WarehouseReports, {
      warehouseService: {
        async listReport(reportType, filters, options = {}) {
          calls.push({ reportType, filters, options })
          return emptyReport(reportType)
        },
      },
      canExport: true,
      printReport: () => { printCalls += 1 },
    })) })
    await act(async () => {})
    await act(async () => { button(container, '打印/PDF').click() })
    assert.equal(printCalls, 1)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].options, { export: false })
    assert.equal(elements(container, (element) =>
      element.className.split(/\s+/u).includes('warehouse-print-sheet')).length, 1)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('unapplied draft filters cannot relabel or print the last successful report', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  let printCalls = 0
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(WarehouseReports, {
      warehouseService: { listReport: async (reportType) => emptyReport(reportType) },
      canExport: true,
      printReport: () => { printCalls += 1 },
    })) })
    await act(async () => {})
    await change(field(container, '关键词'), '尚未查询的铜管')
    assert.equal(button(container, '打印/PDF').disabled, true)
    assert.match(container.textContent, /筛选条件：全部数据/u)
    await act(async () => { button(container, '打印/PDF').click() })
    assert.equal(printCalls, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('Excel failure shows a safe error and cannot call or change inventory mutations', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const inventory = Object.freeze([{ variantId: 'v1', quantity: 8 }])
  const before = JSON.stringify(inventory)
  const listCalls = []
  let mutationCalls = 0
  const service = {
    async listReport(reportType, filters, options = {}) {
      listCalls.push({ reportType, filters, options })
      return options.export
        ? { ...emptyReport(reportType), pageSize: 20000, export: true }
        : emptyReport(reportType)
    },
    confirmReceipt() { mutationCalls += 1 },
    confirmStockOut() { mutationCalls += 1 },
    confirmStocktake() { mutationCalls += 1 },
  }
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(WarehouseReports, {
      warehouseService: service,
      canExport: true,
      exportReport: async () => { throw new Error('private supplier stack') },
    })) })
    await act(async () => {})
    await act(async () => { button(container, '导出 Excel').click() })
    assert.match(container.textContent, /Excel 导出失败，请稍后重试/u)
    assert.equal(listCalls.filter((call) => call.options.export === true).length, 1)
    assert.equal(mutationCalls, 0)
    assert.equal(JSON.stringify(inventory), before)
    assert.doesNotMatch(container.textContent, /private supplier stack/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('switching report type resets filters before loading the new report', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const calls = []
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(WarehouseReports, {
      warehouseService: {
        async listReport(reportType, filters) {
          calls.push({ reportType, filters: { ...filters } })
          return emptyReport(reportType)
        },
      },
      canExport: false,
    })) })
    await act(async () => {})
    await change(field(container, '关键词'), '铜管')
    await act(async () => { button(container, '查询').click() })
    await change(field(container, '报表类型'), 'items')
    await act(async () => {})
    assert.equal(field(container, '关键词').value, '')
    assert.deepEqual(calls.at(-1), {
      reportType: 'items', filters: { page: 1, pageSize: 100 },
    })
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

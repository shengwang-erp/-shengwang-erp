import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import postcss from 'postcss'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/task6-project-cost-ledger-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/project-cost-ledger/ProjectCostLedgerSection.jsx')
after(() => server.close())

const ProjectCostLedgerSection = loaded.default

const ledgerAccess = {
  view: true, readLedger: true, createManual: true, adjust: true, allocate: true,
}

function ledgerSnapshot({
  page = 1,
  pageSize = 20,
  keyword = '',
  incompleteSources = [],
} = {}) {
  const suffix = keyword || '全部'
  return {
    status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', page, pageSize,
    totalRows: 120, totalAmount: 125000, adjustmentTotal: -5000,
    categoryTotals: [
      { category: '材料费', amount: 100000 },
      { category: '人工费', amount: 25000 },
    ],
    incompleteSources,
    rows: [
      {
        sourceKey: 'warehouse:OUT-001', sourceModule: 'warehouse',
        sourceDocumentType: 'warehouse_outflow', sourceDocumentId: 'OUT-001',
        projectId: 'P-1', projectName: '东京站项目', category: '材料费', date: '2026-08-09',
        description: `铜管｜快照-${suffix}-第${page}页-${pageSize}`,
        originalAmount: 105000, adjustmentAmount: -5000, effectiveAmount: 100000,
        operator: '仓库管理员', adjusted: true, version: 2,
        allocations: [
          { projectId: 'P-1', amount: 60000 },
          { projectId: 'P-2', amount: 40000 },
        ],
        auditEvents: [{
          eventType: 'adjustment', amountBefore: 105000, amountAfter: 100000,
          adjustmentAmount: -5000, reason: '供应商折扣', actorName: '会计甲',
          createdAt: '2026-08-10T02:00:00.000Z', sequenceNo: 1,
        }],
      },
      {
        sourceKey: 'labor:LAB-001', sourceModule: 'labor',
        sourceDocumentType: 'project_labor', sourceDocumentId: 'LAB-001',
        projectId: 'P-1', projectName: '东京站项目', category: '人工费', date: '2026-08-10',
        description: '现场安装', originalAmount: 25000, adjustmentAmount: 0,
        effectiveAmount: 25000, operator: '施工员', adjusted: false, version: 1,
        allocations: [{ projectId: 'P-1', amount: 25000 }], auditEvents: [],
      },
    ],
  }
}

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function button(root, label) {
  return elements(root, (element) => element.nodeName === 'BUTTON' && element.textContent.trim() === label)[0]
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

test('SSR renders the approved roomy ledger hierarchy and finance columns', () => {
  const html = renderToStaticMarkup(createElement(ProjectCostLedgerSection, {
    access: ledgerAccess,
    projects: [{ projectId: 'P-1', projectName: '东京站项目' }],
    initialSnapshot: ledgerSnapshot(),
    onExportExcel() {}, onExportPdf() {}, onPrint() {},
  }))

  for (const label of [
    '新增调整费用', '拆分项目', '导出 Excel', '导出 PDF', '打印',
    '项目总成本', '当前筛选成本', '会计净调整', '记录数量',
    '日期', '费用类别', '来源', '业务单号', '费用说明', '原金额', '会计调整',
    '最终金额', '项目/拆分', '经办人', '调整标记', '操作', '已调整',
  ]) assert.match(html, new RegExp(label.replace('/', '\\/'), 'u'), label)

  const order = ['project-cost-ledger-actions', 'project-cost-ledger-filters', 'project-cost-ledger-summary', 'project-cost-ledger-categories', 'project-cost-ledger-table-scroll', 'project-cost-ledger-pagination']
  let last = -1
  for (const marker of order) {
    const index = html.indexOf(marker)
    assert.ok(index > last, marker)
    last = index
  }
})

test('filters keep the last successful snapshot until applied, clear cleanly, and paginate at 20/50/100', async () => {
  const calls = []
  const service = {
    async list(filters) {
      calls.push({ ...filters })
      return ledgerSnapshot(filters)
    },
  }
  let excelCount = 0
  let printCount = 0
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: ledgerAccess,
      projects: [{ projectId: 'P-1', projectName: '东京站项目' }],
      actorFingerprint: 'accountant-a',
      onExportExcel() { excelCount += 1 }, onExportPdf() {}, onPrint() { printCount += 1 },
    })) })
    assert.deepEqual(calls[0], { page: 1, pageSize: 20 })
    assert.match(container.textContent, /快照-全部-第1页-20/u)

    await change(field(container, '关键词搜索'), '铜管')
    assert.match(container.textContent, /筛选条件有改动，尚未应用/u)
    assert.match(container.textContent, /快照-全部-第1页-20/u)
    assert.doesNotMatch(container.textContent, /快照-铜管/u)
    assert.equal(button(container, '导出 Excel').disabled, true)
    assert.equal(button(container, '打印').disabled, true)
    button(container, '导出 Excel').click()
    button(container, '打印').click()
    assert.equal(excelCount, 0)
    assert.equal(printCount, 0)

    await act(async () => { button(container, '应用筛选').click() })
    assert.equal(calls.at(-1).keyword, '铜管')
    assert.match(container.textContent, /快照-铜管-第1页-20/u)
    assert.doesNotMatch(container.textContent, /筛选条件有改动，尚未应用/u)
    assert.equal(button(container, '导出 Excel').disabled, false)

    await act(async () => { button(container, '清除筛选').click() })
    assert.deepEqual(calls.at(-1), { page: 1, pageSize: 20 })
    assert.match(container.textContent, /快照-全部-第1页-20/u)

    for (const size of [50, 100, 20]) {
      await change(field(container, '每页显示'), String(size))
      assert.equal(calls.at(-1).pageSize, size)
      assert.equal(calls.at(-1).page, 1)
    }
    await act(async () => { button(container, '下一页').click() })
    assert.equal(calls.at(-1).page, 2)
    assert.match(container.textContent, /快照-全部-第2页-20/u)
    await act(async () => { button(container, '上一页').click() })
    assert.equal(calls.at(-1).page, 1)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('rows expand into source, allocation and automatic audit detail without mutating source records', async () => {
  const service = { async list(filters) { return ledgerSnapshot(filters) } }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: ledgerAccess, projects: [], actorFingerprint: 'accountant-a',
    })) })
    assert.doesNotMatch(container.textContent, /供应商折扣/u)
    await act(async () => { button(container, '展开').click() })
    assert.match(container.textContent, /warehouse:OUT-001/u)
    assert.match(container.textContent, /P-1.*[¥￥]60,000/u)
    assert.match(container.textContent, /供应商折扣/u)
    assert.match(container.textContent, /会计甲/u)
    assert.match(container.textContent, /收起/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('incomplete source stays explicit, blocks reports, and retry preserves the applied filters', async () => {
  let calls = 0
  const service = {
    async list(filters) {
      calls += 1
      return ledgerSnapshot({ ...filters, incompleteSources: calls === 1 ? ['车辆费用', '仓库出库'] : [] })
    },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: ledgerAccess, projects: [], actorFingerprint: 'accountant-a',
      onExportExcel() {}, onExportPdf() {}, onPrint() {},
    })) })
    assert.match(container.textContent, /数据不完整/u)
    assert.match(container.textContent, /车辆费用/u)
    assert.match(container.textContent, /仓库出库/u)
    assert.equal(button(container, '导出 Excel').disabled, true)
    assert.equal(button(container, '打印').disabled, true)
    await act(async () => { button(container, '重新读取').click() })
    assert.equal(calls, 2)
    assert.doesNotMatch(container.textContent, /数据不完整/u)
    assert.equal(button(container, '导出 Excel').disabled, false)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('black-gold CSS enforces the readable table dimensions without white or blue surfaces', async () => {
  const css = await readFile(new URL('./projectCostLedger.css', import.meta.url), 'utf8')
  assert.match(css, /\.project-cost-ledger-table\s*\{[^}]*min-width:\s*1380px[^}]*font-size:\s*15px/su)
  assert.match(css, /\.project-cost-ledger-table th,\s*\n?\.erp-black-gold \.project-cost-ledger-table td\s*\{[^}]*padding:\s*12px 14px[^}]*line-height:\s*1\.55/su)
  assert.match(css, /\.project-cost-ledger-amount\s*\{[^}]*text-align:\s*right[^}]*font-weight:\s*700[^}]*white-space:\s*nowrap/su)
  assert.match(css, /\.project-cost-ledger-category-start td\s*\{[^}]*border-top-width:\s*2px/su)
  assert.doesNotMatch(css, /#fff(?:fff)?\b|(?:color|background):[^;]*(?:\bwhite\b|\bblue\b)|rgb\(\s*255\s*,\s*255\s*,\s*255/iu)
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors) assert.match(selector.trim(), /^\.erp-black-gold\b/u)
  })
})

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
        originalAmount: 63000, adjustmentAmount: -3000, effectiveAmount: 60000,
        operator: '仓库管理员', adjusted: true, version: 2,
        allocations: [{ projectId: 'P-1', amount: 60000 }], auditEvents: [],
      },
      {
        sourceKey: 'warehouse:OUT-001', sourceModule: 'warehouse',
        sourceDocumentType: 'warehouse_outflow', sourceDocumentId: 'OUT-001',
        projectId: 'P-2', projectName: '', category: '材料费', date: '2026-08-09',
        description: `铜管｜快照-${suffix}-第${page}页-${pageSize}`,
        originalAmount: 42000, adjustmentAmount: -2000, effectiveAmount: 40000,
        operator: '仓库管理员', adjusted: true, version: 2,
        allocations: [{ projectId: 'P-2', amount: 40000 }], auditEvents: [],
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

function auditSnapshot({
  secondProjectId = 'P-2', reason = '跨项目分摊', actorName = '会计甲',
} = {}) {
  return {
    status: 'ready', generatedAt: '2026-08-10T03:00:01.000Z',
    events: [{
      eventType: 'allocation', sourceKey: 'warehouse:OUT-001', sequenceNo: 1,
      amountBefore: 100000, amountAfter: 100000, adjustmentAmount: 0,
      allocationsBefore: [{ projectId: 'P-1', amount: 100000 }],
      allocationsAfter: [
        { projectId: 'P-1', amount: secondProjectId === 'P-2' ? 60000 : 70000 },
        { projectId: secondProjectId, amount: secondProjectId === 'P-2' ? 40000 : 30000 },
      ],
      reason, actorName, createdAt: '2026-08-10T02:00:00.000Z',
    }],
  }
}

function reportPageSnapshot(page, pageSize = 100, totalRows = 205) {
  const start = (page - 1) * pageSize
  const count = Math.max(0, Math.min(pageSize, totalRows - start))
  return deepFreeze({
    status: 'ready', generatedAt: '2000-01-01T00:00:00.000Z', page, pageSize,
    totalRows, totalAmount: totalRows, adjustmentTotal: 0,
    categoryTotals: [{ category: '其他费用', amount: totalRows }], incompleteSources: [],
    rows: Array.from({ length: count }, (_, offset) => {
      const index = start + offset + 1
      return {
        sourceKey: `manual:REPORT-${index}`, sourceModule: 'manual',
        sourceDocumentType: 'manual_project_cost', sourceDocumentId: `REPORT-${index}`,
        projectId: 'P-1', projectName: '东京站项目', category: '其他费用', date: '2026-08-10',
        description: `报表费用-${index}`, originalAmount: 1, adjustmentAmount: 0, effectiveAmount: 1,
        operator: '会计甲', adjusted: false, version: 1,
        allocations: [{ projectId: 'P-1', amount: 1 }], auditEvents: [],
      }
    }),
  })
}

function completeReportLedgerSnapshot(totalRows = 205) {
  const first = reportPageSnapshot(1, 100, totalRows)
  const pageCount = Math.max(1, Math.ceil(totalRows / 100))
  return deepFreeze({
    ...first,
    rows: Array.from({ length: pageCount }, (_, index) =>
      reportPageSnapshot(index + 1, 100, totalRows).rows).flat(),
  })
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item)
    Object.freeze(value)
  }
  return value
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

test('ready matching snapshots expose built-in Excel, print and PDF entries', () => {
  const html = renderToStaticMarkup(createElement(ProjectCostLedgerSection, {
    access: ledgerAccess,
    projects: [{ projectId: 'P-1', projectName: '东京站项目' }],
    service: { list() {}, listAudit() {}, report() {} },
    initialSnapshot: ledgerSnapshot(),
    initialAuditSnapshot: auditSnapshot(),
  }))
  assert.match(html, /<button(?![^>]*disabled)[^>]*>导出 Excel<\/button>/u)
  assert.match(html, /<button(?![^>]*disabled)[^>]*>导出 PDF<\/button>/u)
  assert.match(html, /<button(?![^>]*disabled)[^>]*>打印<\/button>/u)
  assert.match(html, /在打印窗口选择“另存为 PDF”/u)
  assert.doesNotMatch(html, /project-cost-print-sheet/u)
})

test('print temporarily mounts the exact applied ledger and audit snapshots', async () => {
  const currentSnapshot = deepFreeze({ ...ledgerSnapshot(), totalRows: 3 })
  const currentAudit = deepFreeze(auditSnapshot())
  let received = null
  let printBodyText = ''
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      access: ledgerAccess,
      projects: [{ projectId: 'P-1', projectName: '东京站项目' }],
      initialSnapshot: currentSnapshot,
      initialAuditSnapshot: currentAudit,
      onPrint(payload) {
        received = payload
        printBodyText = dom.document.body.textContent
      },
    })) })
    await act(async () => {
      button(container, '打印').click()
      await new Promise((resolve) => setImmediate(resolve))
    })
    assert.equal(received.snapshot, currentSnapshot)
    assert.notEqual(received.auditSnapshot, currentAudit)
    assert.deepEqual(received.auditSnapshot, currentAudit)
    assert.ok(Object.isFrozen(received.auditSnapshot))
    assert.ok(Object.isFrozen(received.auditSnapshot.events))
    assert.match(printBodyText, /材料费小计/u)
    assert.match(printBodyText, /调整记录附页/u)
    assert.deepEqual(received.filters, {
      projectId: '', dateFrom: '', dateTo: '', category: '', sourceModule: '', adjusted: 'all', keyword: '',
    })
    assert.doesNotMatch(container.textContent, /调整记录附页/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('non-first screen page prints one atomic complete snapshot through an isolated body portal', async () => {
  const currentSnapshot = reportPageSnapshot(2, 20)
  const currentAudit = deepFreeze({ status: 'ready', generatedAt: '2000-01-01T00:00:01.000Z', events: [] })
  const reportCalls = []
  let received = null
  let layout = null
  const service = {
    async report(filters) {
      reportCalls.push({ ...filters })
      return deepFreeze({
        ledgerSnapshot: completeReportLedgerSnapshot(),
        auditSnapshot: {
          status: 'ready', generatedAt: '2000-01-01T00:00:00.000Z',
        events: [{ ...auditSnapshot().events[0], sourceKey: 'manual:FILTERED-OUT', reason: '打印不应泄露' }],
        },
      })
    },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: ledgerAccess, actorFingerprint: 'accountant-a',
      projects: [{ projectId: 'P-1', projectName: '东京站项目' }],
      initialSnapshot: currentSnapshot, initialAuditSnapshot: currentAudit,
      onPrint(payload) {
        received = payload
        const printRoots = elements(dom.document.body, (element) => element.className === 'project-cost-print-root')
        layout = {
          count: printRoots.length,
          directBodyChild: printRoots[0]?.parentNode === dom.document.body,
          hasFirst: printRoots[0]?.textContent.includes('报表费用-1') === true,
          hasLast: printRoots[0]?.textContent.includes('报表费用-205') === true,
          leakedAudit: printRoots[0]?.textContent.includes('打印不应泄露') === true,
        }
      },
    })) })
    await act(async () => {
      button(container, '打印').click()
      for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve))
    })
    assert.deepEqual(reportCalls, [{}])
    assert.equal(received.snapshot.rows.length, 205)
    assert.equal(received.snapshot.totalRows, 205)
    assert.equal(received.auditSnapshot.events.length, 0)
    assert.deepEqual(layout, {
      count: 1, directBodyChild: true, hasFirst: true, hasLast: true, leakedAudit: false,
    })
    assert.notEqual(received.metadata.generatedAt, currentSnapshot.generatedAt)
    assert.equal(received.metadata.ledgerGeneratedAt, '2000-01-01T00:00:00.000Z')
    assert.equal(elements(dom.document.body, (element) => element.className === 'project-cost-print-root').length, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('actor replacement cancels an in-flight atomic export before any stale callback runs', async () => {
  let releaseFirst
  const firstPage = new Promise((resolve) => { releaseFirst = resolve })
  let exportCalls = 0
  const service = {
    async report() { return firstPage },
  }
  const props = {
    service, access: ledgerAccess, projects: [], initialSnapshot: reportPageSnapshot(2, 20),
    initialAuditSnapshot: { status: 'ready', generatedAt: '2000-01-01T00:00:01.000Z', events: [] },
    onExportExcel() { exportCalls += 1 },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, { ...props, actorFingerprint: 'accountant-a' })) })
    await act(async () => {
      button(container, '导出 Excel').click()
      await Promise.resolve()
    })
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, { ...props, actorFingerprint: 'accountant-b' })) })
    releaseFirst({
      ledgerSnapshot: completeReportLedgerSnapshot(),
      auditSnapshot: { status: 'ready', generatedAt: '2000-01-01T00:00:00.000Z', events: [] },
    })
    await act(async () => {
      for (let index = 0; index < 4; index += 1) await new Promise((resolve) => setImmediate(resolve))
    })
    assert.equal(exportCalls, 0)
    assert.equal(elements(dom.document.body, (element) => element.className === 'project-cost-print-root').length, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('filters keep the last successful snapshot until applied, clear cleanly, and paginate at 20/50/100', async () => {
  const calls = []
  const service = {
    async report() {},
    async list(filters) {
      calls.push({ ...filters })
      return ledgerSnapshot(filters)
    },
    async listAudit(filters) {
      auditCalls.push({ ...filters })
      return auditSnapshot()
    },
  }
  const auditCalls = []
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
    assert.deepEqual(auditCalls[0], {})
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

test('real split rows use the latest full audit allocation without mutating frozen source records', async () => {
  const fullSnapshot = ledgerSnapshot()
  assert.equal(fullSnapshot.rows.filter(({ sourceKey }) => sourceKey === 'warehouse:OUT-001').length, 2)
  assert.equal(fullSnapshot.rows.every(({ allocations }) => allocations.length === 1), true)
  const snapshot = deepFreeze({
    ...fullSnapshot,
    rows: [fullSnapshot.rows[0], fullSnapshot.rows[2]],
  })
  const audit = deepFreeze(auditSnapshot())
  const beforeSnapshot = structuredClone(snapshot)
  const beforeAudit = structuredClone(audit)
  const service = {
    async list() { return snapshot },
    async listAudit() { return audit },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: ledgerAccess,
      projects: [
        { projectId: 'P-1', projectName: '东京站项目' },
        { projectId: 'P-2', projectName: '横滨仓库项目' },
      ],
      actorFingerprint: 'accountant-a',
    })) })
    assert.match(container.textContent, /已拆分（2个项目）/u)
    assert.doesNotMatch(container.textContent, /跨项目分摊/u)
    await act(async () => { button(container, '展开').click() })
    assert.match(container.textContent, /warehouse:OUT-001/u)
    assert.match(container.textContent, /东京站项目.*[¥￥]60,000/u)
    assert.match(container.textContent, /横滨仓库项目.*[¥￥]40,000/u)
    assert.match(container.textContent, /跨项目分摊/u)
    assert.match(container.textContent, /会计甲/u)
    assert.match(container.textContent, /收起/u)
    assert.deepEqual(snapshot, beforeSnapshot)
    assert.deepEqual(audit, beforeAudit)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('incomplete source stays explicit, blocks reports, and retry preserves the applied filters', async () => {
  let calls = 0
  const service = {
    async report() {},
    async list(filters) {
      calls += 1
      return ledgerSnapshot({ ...filters, incompleteSources: calls === 1 ? ['车辆费用', '仓库出库'] : [] })
    },
    async listAudit() { return auditSnapshot() },
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

test('audit failure never presents a complete split report and keeps export and print disabled', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service: {
        async list() { return ledgerSnapshot() },
        async listAudit() { throw new Error('audit unavailable') },
      },
      access: ledgerAccess, projects: [], actorFingerprint: 'accountant-a',
      onExportExcel() {}, onExportPdf() {}, onPrint() {},
    })) })
    assert.match(container.textContent, /审计记录读取失败/u)
    assert.match(container.textContent, /拆分状态待读取/u)
    assert.doesNotMatch(container.textContent, /已拆分（2个项目）/u)
    assert.equal(button(container, '导出 Excel').disabled, true)
    assert.equal(button(container, '打印').disabled, true)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('a late audit response from an older applied-filter request cannot refill the current split', async () => {
  const pendingAudits = []
  const service = {
    async report() {},
    async list(filters) { return ledgerSnapshot(filters) },
    listAudit(filters) {
      return new Promise((resolve) => pendingAudits.push({ filters: { ...filters }, resolve }))
    },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: ledgerAccess,
      projects: [
        { projectId: 'P-1', projectName: '东京站项目' },
        { projectId: 'P-2', projectName: '旧项目' },
        { projectId: 'P-3', projectName: '当前项目' },
      ],
      actorFingerprint: 'accountant-a',
      onExportExcel() {}, onExportPdf() {}, onPrint() {},
    })) })
    assert.equal(pendingAudits.length, 1)
    assert.equal(button(container, '导出 Excel').disabled, true)
    await change(field(container, '关键词搜索'), '铜管')
    await act(async () => { button(container, '应用筛选').click() })
    assert.equal(pendingAudits.length, 2)
    assert.deepEqual(pendingAudits[1].filters, {})
    pendingAudits[1].resolve(auditSnapshot({ secondProjectId: 'P-3', reason: '当前审计' }))
    await act(async () => {})
    assert.match(container.textContent, /已拆分（2个项目）/u)
    assert.equal(button(container, '导出 Excel').disabled, false)
    await act(async () => { button(container, '展开').click() })
    assert.match(container.textContent, /当前项目/u)
    assert.match(container.textContent, /当前审计/u)
    assert.doesNotMatch(container.textContent, /旧审计/u)
    pendingAudits[0].resolve(auditSnapshot({ secondProjectId: 'P-2', reason: '旧审计' }))
    await act(async () => {})
    assert.match(container.textContent, /当前项目/u)
    assert.match(container.textContent, /当前审计/u)
    assert.doesNotMatch(container.textContent, /旧审计/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

async function renderAuditIntegrityScenario({ snapshot, audits }) {
  let auditCall = 0
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
    service: {
      async report() {},
      async list() { return snapshot },
      async listAudit() {
        const result = audits[Math.min(auditCall, audits.length - 1)]
        auditCall += 1
        return result
      },
    },
    access: ledgerAccess,
    projects: [
      { projectId: 'P-1', projectName: '东京站项目' },
      { projectId: 'P-2', projectName: '横滨仓库项目' },
    ],
    actorFingerprint: 'accountant-integrity',
    onExportExcel() {}, onExportPdf() {}, onPrint() {},
  })) })
  return { dom, container, root, auditCalls: () => auditCall }
}

test('audit ahead fails closed and a correlated retry restores the complete split', async () => {
  const ahead = auditSnapshot()
  ahead.events[0].sequenceNo = 2
  const scenario = await renderAuditIntegrityScenario({
    snapshot: ledgerSnapshot(), audits: [ahead, auditSnapshot()],
  })
  try {
    assert.match(scenario.container.textContent, /审计版本与明细账不一致/u)
    assert.match(scenario.container.textContent, /拆分状态待读取/u)
    assert.doesNotMatch(scenario.container.textContent, /已拆分（2个项目）/u)
    assert.equal(button(scenario.container, '导出 Excel').disabled, true)
    await act(async () => { button(scenario.container, '重新读取审计').click() })
    assert.equal(scenario.auditCalls(), 2)
    assert.doesNotMatch(scenario.container.textContent, /审计版本与明细账不一致/u)
    assert.match(scenario.container.textContent, /已拆分（2个项目）/u)
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
  } finally {
    await act(async () => { scenario.root.unmount() })
    scenario.dom.cleanup()
  }
})

test('audit behind and inconsistent row versions both fail closed', async (t) => {
  await t.test('behind max sequence', async () => {
    const snapshot = ledgerSnapshot()
    snapshot.rows[0].version = 3
    snapshot.rows[1].version = 3
    const scenario = await renderAuditIntegrityScenario({ snapshot, audits: [auditSnapshot()] })
    try {
      assert.match(scenario.container.textContent, /审计版本与明细账不一致/u)
      assert.equal(button(scenario.container, '打印').disabled, true)
    } finally {
      await act(async () => { scenario.root.unmount() })
      scenario.dom.cleanup()
    }
  })

  await t.test('same source rows disagree', async () => {
    const snapshot = ledgerSnapshot()
    snapshot.rows[1].version = 3
    const scenario = await renderAuditIntegrityScenario({ snapshot, audits: [auditSnapshot()] })
    try {
      assert.match(scenario.container.textContent, /审计版本与明细账不一致/u)
      assert.equal(button(scenario.container, '导出 PDF').disabled, true)
    } finally {
      await act(async () => { scenario.root.unmount() })
      scenario.dom.cleanup()
    }
  })
})

test('duplicate or discontinuous audit sequences cannot be composed into a report', async (t) => {
  for (const [name, events] of [
    ['duplicate', [
      { ...auditSnapshot().events[0], sequenceNo: 1 },
      { ...auditSnapshot().events[0], sequenceNo: 1, reason: '重复事件' },
    ]],
    ['gap', [
      { ...auditSnapshot().events[0], sequenceNo: 1 },
      { ...auditSnapshot().events[0], sequenceNo: 3, reason: '断号事件' },
    ]],
  ]) {
    await t.test(name, async () => {
      const snapshot = ledgerSnapshot()
      snapshot.rows[0].version = name === 'duplicate' ? 3 : 4
      snapshot.rows[1].version = name === 'duplicate' ? 3 : 4
      const scenario = await renderAuditIntegrityScenario({
        snapshot, audits: [{ ...auditSnapshot(), events }],
      })
      try {
        assert.match(scenario.container.textContent, /审计版本与明细账不一致/u)
        assert.match(scenario.container.textContent, /拆分状态待读取/u)
        assert.equal(button(scenario.container, '导出 Excel').disabled, true)
      } finally {
        await act(async () => { scenario.root.unmount() })
        scenario.dom.cleanup()
      }
    })
  }
})

test('version one source with no audit event is a complete ordinary project row', async () => {
  const full = ledgerSnapshot()
  const snapshot = { ...full, rows: [full.rows[2]], totalRows: 1, totalAmount: 25000, adjustmentTotal: 0 }
  const scenario = await renderAuditIntegrityScenario({
    snapshot, audits: [{ ...auditSnapshot(), events: [] }],
  })
  try {
    assert.doesNotMatch(scenario.container.textContent, /审计版本与明细账不一致|拆分状态待读取/u)
    assert.match(scenario.container.textContent, /东京站项目/u)
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
  } finally {
    await act(async () => { scenario.root.unmount() })
    scenario.dom.cleanup()
  }
})

test('black-gold CSS enforces the readable table dimensions without white or blue surfaces', async () => {
  const css = await readFile(new URL('./projectCostLedger.css', import.meta.url), 'utf8')
  assert.match(css, /\.erp-black-gold\.project-cost-dialog-backdrop\s*\{/u)
  assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.erp-black-gold\.project-cost-dialog-backdrop\s*\{/u)
  assert.match(css, /\.project-cost-ledger-table\s*\{[^}]*min-width:\s*1380px[^}]*font-size:\s*15px/su)
  assert.match(css, /\.project-cost-ledger-table th,\s*\n?\.erp-black-gold \.project-cost-ledger-table td\s*\{[^}]*padding:\s*12px 14px[^}]*line-height:\s*1\.55/su)
  assert.match(css, /\.project-cost-ledger-amount\s*\{[^}]*text-align:\s*right[^}]*font-weight:\s*700[^}]*white-space:\s*nowrap/su)
  assert.match(css, /\.project-cost-ledger-category-start td\s*\{[^}]*border-top-width:\s*2px/su)
  assert.doesNotMatch(css, /#fff(?:fff)?\b|(?:color|background):[^;]*(?:\bwhite\b|\bblue\b)|rgb\(\s*255\s*,\s*255\s*,\s*255/iu)
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors) assert.match(selector.trim(), /^\.erp-black-gold\b/u)
  })
})

test('keyword help matches the secure SQL search scope', () => {
  const html = renderToStaticMarkup(createElement(ProjectCostLedgerSection, {
    access: ledgerAccess, initialSnapshot: ledgerSnapshot(),
  }))
  assert.match(html, /placeholder="单号、说明"/u)
  assert.doesNotMatch(html, /placeholder="[^"]*经办人/u)
})

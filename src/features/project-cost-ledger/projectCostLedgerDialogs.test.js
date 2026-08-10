import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/task7-project-cost-ledger-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const dialogs = await server.ssrLoadModule('/src/features/project-cost-ledger/ProjectCostAdjustmentDialog.jsx')
const allocationModule = await server.ssrLoadModule('/src/features/project-cost-ledger/ProjectCostAllocationDialog.jsx')
const manualModule = await server.ssrLoadModule('/src/features/project-cost-ledger/ProjectCostManualEntryDialog.jsx')
const sectionModule = await server.ssrLoadModule('/src/features/project-cost-ledger/ProjectCostLedgerSection.jsx')
after(() => server.close())

const ProjectCostAdjustmentDialog = dialogs.default
const ProjectCostAllocationDialog = allocationModule.default
const ProjectCostManualEntryDialog = manualModule.default
const ProjectCostLedgerSection = sectionModule.default
const { buildProjectCostSourceDialogModel } = sectionModule

const projects = [
  { projectId: 'P-1', projectName: '东京站项目' },
  { projectId: 'P-2', projectName: '横滨仓库项目' },
]

const ledgerRow = {
  sourceKey: 'warehouse:OUT-1', sourceModule: 'warehouse',
  sourceDocumentType: 'warehouse_outflow', sourceDocumentId: 'OUT-1',
  projectId: 'P-1', projectName: '东京站项目', category: '材料费', date: '2026-08-10',
  description: '铜管', originalAmount: 1000, adjustmentAmount: -100,
  effectiveAmount: 900, operator: '仓管', adjusted: true, version: 2,
  allocations: [{ projectId: 'P-1', amount: 900 }], auditEvents: [],
}

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function button(root, label) {
  return elements(root, (element) => element.nodeName === 'BUTTON' && element.textContent.trim() === label)[0]
}

function field(root, label, index = 0) {
  const wrappers = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))
  return elements(wrappers[index], (element) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName))[0]
}

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

async function submitForm(root) {
  const form = elements(root, (element) => element.nodeName === 'FORM')[0]
  await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

async function renderDialog(Component, props) {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  await act(async () => { root.render(createElement(Component, props)) })
  return { dom, container, root }
}

test('adjustment accepts a signed delta, requires a reason, and previews the new effective amount', async () => {
  const submissions = []
  const view = await renderDialog(ProjectCostAdjustmentDialog, {
    row: ledgerRow, allowed: true,
    async onSubmit(request) { submissions.push(request) },
    async onSuccess() { return true }, onCancel() {},
  })
  try {
    assert.match(view.container.textContent, /原始金额.*[¥￥]1,000/u)
    assert.match(view.container.textContent, /累计会计调整.*-[¥￥]100/u)
    await change(field(view.container, '本次调整金额'), '-50')
    assert.match(view.container.textContent, /调整后金额.*[¥￥]850/u)
    assert.equal(button(view.container, '保存调整').disabled, true)
    await change(field(view.container, '调整原因'), '盘点差异冲减')
    assert.equal(button(view.container, '保存调整').disabled, false)
    await submitForm(view.container)
    assert.deepEqual(submissions, [{
      sourceKey: 'warehouse:OUT-1', expectedVersion: 2,
      adjustmentAmount: -50, reason: '盘点差异冲减',
    }])
  } finally {
    await act(async () => { view.root.unmount() })
    view.dom.cleanup()
  }
})

test('allocation rejects duplicate projects and imbalance, then submits fixed amounts from percentage mode', async () => {
  const submissions = []
  const view = await renderDialog(ProjectCostAllocationDialog, {
    row: { ...ledgerRow, effectiveAmount: 1000 }, projects, allowed: true,
    allocations: [{ projectId: 'P-1', amount: 1000 }],
    async onSubmit(request) { submissions.push(request) },
    async onSuccess() { return true }, onCancel() {},
  })
  try {
    await act(async () => { button(view.container, '新增项目').click() })
    await change(field(view.container, '项目', 0), 'P-1')
    await change(field(view.container, '项目', 1), 'P-1')
    assert.match(view.container.textContent, /每个项目只能出现一次/u)
    await change(field(view.container, '项目', 1), 'P-2')
    await change(field(view.container, '分摊方式'), 'percent')
    await change(field(view.container, '比例', 0), '60')
    await change(field(view.container, '比例', 1), '30')
    await change(field(view.container, '调整原因'), '两项目共同使用')
    assert.match(view.container.textContent, /差额.*[¥￥]100/u)
    assert.equal(button(view.container, '保存拆分').disabled, true)
    await change(field(view.container, '比例', 1), '40')
    assert.match(view.container.textContent, /差额.*[¥￥]0/u)
    assert.equal(button(view.container, '保存拆分').disabled, false)
    await submitForm(view.container)
    assert.deepEqual(submissions, [{
      sourceKey: 'warehouse:OUT-1', expectedVersion: 2, reason: '两项目共同使用',
      allocations: [{ projectId: 'P-1', amount: 600 }, { projectId: 'P-2', amount: 400 }],
    }])
  } finally {
    await act(async () => { view.root.unmount() })
    view.dom.cleanup()
  }
})

test('allocation never exceeds 100 rows even when add events are batched before disabled state renders', async () => {
  const view = await renderDialog(ProjectCostAllocationDialog, {
    row: ledgerRow, projects, allowed: true, allocations: ledgerRow.allocations,
    async onSubmit() {}, async onSuccess() { return true }, onCancel() {},
  })
  try {
    const add = button(view.container, '新增项目')
    await act(async () => {
      for (let index = 0; index < 120; index += 1) add.click()
    })
    assert.equal(elements(view.container, (element) => element.className === 'project-cost-allocation-row').length, 100)
    assert.equal(button(view.container, '新增项目').disabled, true)
  } finally {
    await act(async () => { view.root.unmount() })
    view.dom.cleanup()
  }
})

test('a real 60/40 split builds one source-level dialog model and never treats the clicked share as the source total', async () => {
  const snapshot = {
    ...ledgerSnapshot({ version: 2, effectiveAmount: 100 }), totalRows: 2, adjustmentTotal: 0,
    categoryTotals: [{ category: '材料费', amount: 100 }],
    rows: [
      { ...ledgerRow, version: 2, projectId: 'P-1', projectName: '东京站项目', originalAmount: 60, adjustmentAmount: 0, effectiveAmount: 60, adjusted: false, allocations: [{ projectId: 'P-1', amount: 60 }] },
      { ...ledgerRow, version: 2, projectId: 'P-2', projectName: '横滨仓库项目', originalAmount: 40, adjustmentAmount: 0, effectiveAmount: 40, adjusted: false, allocations: [{ projectId: 'P-2', amount: 40 }] },
    ],
  }
  const audit = {
    status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z',
    events: [{
      eventType: 'allocation', sourceKey: ledgerRow.sourceKey, sequenceNo: 1,
      amountBefore: 100, amountAfter: 100, adjustmentAmount: 0,
      allocationsBefore: [{ projectId: 'P-1', amount: 100 }],
      allocationsAfter: [{ projectId: 'P-1', amount: 60 }, { projectId: 'P-2', amount: 40 }],
      reason: '共同使用', actorName: '会计甲', createdAt: '2026-08-10T02:00:00.000Z',
    }],
  }
  assert.deepEqual(buildProjectCostSourceDialogModel(snapshot, audit, ledgerRow.sourceKey), {
    sourceKey: ledgerRow.sourceKey, expectedVersion: 2, projectId: 'P-1',
    originalAmount: 100, adjustmentTotal: 0, effectiveAmount: 100,
    currentAllocations: [{ projectId: 'P-1', amount: 60 }, { projectId: 'P-2', amount: 40 }],
    allocationLocked: true,
  })

  const service = {
    async list() { return snapshot }, async listAudit() { return audit },
    async adjust() {}, async replaceAllocations() {}, async createManual() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true },
      projects, actorFingerprint: 'accountant-split',
    })) })
    await act(async () => { button(container, '调整').click() })
    assert.match(container.textContent, /当前最终金额.*[¥￥]100/u)
    await change(field(container, '本次调整金额'), '-10')
    assert.match(container.textContent, /调整后金额.*[¥￥]90/u)
    assert.match(container.textContent, /已有项目分摊历史/u)
    assert.equal(button(container, '保存调整').disabled, true)
    await act(async () => { button(container, '取消').click() })

    await act(async () => { button(container, '拆分').click() })
    assert.match(container.textContent, /当前最终金额.*[¥￥]100/u)
    assert.match(container.textContent, /已分摊.*[¥￥]100/u)
    assert.match(container.textContent, /差额.*[¥￥]0/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('manual entry keeps one request id across a failed retry and only clears it on explicit cancel or success', async () => {
  const requestIds = []
  let attempts = 0
  const view = await renderDialog(ProjectCostManualEntryDialog, {
    open: true, projects, allowed: true,
    createRequestId: () => '11111111-1111-4111-8111-111111111111',
    async onSubmit(request) {
      requestIds.push(request.requestId)
      attempts += 1
      if (attempts === 1) throw new Error('private server detail')
    },
    async onSuccess() { return true }, onCancel() {},
  })
  try {
    await change(field(view.container, '项目'), 'P-1')
    await change(field(view.container, '费用类别'), '其他费用')
    await change(field(view.container, '日期'), '2026-08-10')
    await change(field(view.container, '金额'), '-20')
    await change(field(view.container, '费用说明'), '退款冲销')
    await change(field(view.container, '经办人'), '会计甲')
    await change(field(view.container, '录入原因'), '供应商退款')
    await submitForm(view.container)
    assert.match(view.container.textContent, /项目成本服务暂时不可用/u)
    assert.doesNotMatch(view.container.textContent, /private server detail/u)
    await submitForm(view.container)
    assert.deepEqual(requestIds, [
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ])
  } finally {
    await act(async () => { view.root.unmount() })
    view.dom.cleanup()
  }
})

test('dialog submit latches synchronously and maps allocation and missing-source failures to safe actionable messages', async () => {
  const pending = deferred()
  let calls = 0
  let refreshCalls = 0
  const view = await renderDialog(ProjectCostAdjustmentDialog, {
    row: ledgerRow, allowed: true,
    async onSubmit() { calls += 1; return pending.promise },
    async onSuccess() { return true }, onCancel() {},
    async onRefresh() { refreshCalls += 1; return { ok: false, message: '请调整筛选后重试' } },
  })
  try {
    await change(field(view.container, '本次调整金额'), '-10')
    await change(field(view.container, '调整原因'), '双击保护')
    const form = elements(view.container, (element) => element.nodeName === 'FORM')[0]
    await act(async () => {
      form.dispatchEvent(new TestEvent('submit'))
      form.dispatchEvent(new TestEvent('submit'))
    })
    assert.equal(calls, 1)
    pending.reject(Object.assign(new Error('unsafe'), { code: 'PROJECT_COST_LEDGER_SOURCE_MISSING' }))
    await act(async () => {})
    assert.match(view.container.textContent, /原始费用记录已不可用，请刷新后重试/u)
    assert.doesNotMatch(view.container.textContent, /unsafe/u)
    await act(async () => { button(view.container, '刷新最新记录').click() })
    assert.equal(refreshCalls, 1)
    assert.match(view.container.textContent, /请调整筛选后重试/u)
  } finally {
    await act(async () => { view.root.unmount() })
    view.dom.cleanup()
  }

  const allocation = await renderDialog(ProjectCostAllocationDialog, {
    row: ledgerRow, projects, allowed: true, allocations: ledgerRow.allocations,
    async onSubmit() { throw Object.assign(new Error('private'), { code: 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED' }) },
    async onSuccess() { return true }, onCancel() {},
  })
  try {
    await change(field(allocation.container, '调整原因'), '重新拆分')
    await submitForm(allocation.container)
    assert.match(allocation.container.textContent, /项目分摊合计必须与当前成本一致/u)
  } finally {
    await act(async () => { allocation.root.unmount() })
    allocation.dom.cleanup()
  }
})

test('allocation and manual dialogs also allow only one mutation and one success reload on double submit', async () => {
  const allocationPending = deferred()
  let allocationCalls = 0
  let allocationReloads = 0
  const allocation = await renderDialog(ProjectCostAllocationDialog, {
    row: ledgerRow, projects, allowed: true, allocations: ledgerRow.allocations,
    async onSubmit() { allocationCalls += 1; return allocationPending.promise },
    async onSuccess() { allocationReloads += 1; return true }, onCancel() {},
  })
  try {
    await change(field(allocation.container, '调整原因'), '同步锁')
    const form = elements(allocation.container, (element) => element.nodeName === 'FORM')[0]
    await act(async () => {
      form.dispatchEvent(new TestEvent('submit'))
      form.dispatchEvent(new TestEvent('submit'))
    })
    assert.equal(allocationCalls, 1)
    allocationPending.resolve({ sourceKey: ledgerRow.sourceKey, version: 3, allocations: ledgerRow.allocations })
    await act(async () => {})
    assert.equal(allocationReloads, 1)
  } finally {
    await act(async () => { allocation.root.unmount() })
    allocation.dom.cleanup()
  }

  const manualPending = deferred()
  let manualCalls = 0
  let manualReloads = 0
  const manual = await renderDialog(ProjectCostManualEntryDialog, {
    open: true, projects, allowed: true,
    createRequestId: () => '22222222-2222-4222-8222-222222222222',
    async onSubmit() { manualCalls += 1; return manualPending.promise },
    async onSuccess() { manualReloads += 1; return true }, onCancel() {},
  })
  try {
    await change(field(manual.container, '项目'), 'P-1')
    await change(field(manual.container, '费用类别'), '其他费用')
    await change(field(manual.container, '日期'), '2026-08-10')
    await change(field(manual.container, '金额'), '20')
    await change(field(manual.container, '费用说明'), '补录')
    await change(field(manual.container, '经办人'), '会计甲')
    await change(field(manual.container, '录入原因'), '同步锁')
    const form = elements(manual.container, (element) => element.nodeName === 'FORM')[0]
    await act(async () => {
      form.dispatchEvent(new TestEvent('submit'))
      form.dispatchEvent(new TestEvent('submit'))
    })
    assert.equal(manualCalls, 1)
    manualPending.resolve({ sourceKey: 'manual:22222222-2222-4222-8222-222222222222' })
    await act(async () => {})
    assert.equal(manualReloads, 1)
  } finally {
    await act(async () => { manual.root.unmount() })
    manual.dom.cleanup()
  }
})

function ledgerSnapshot({ version = 2, effectiveAmount = 900 } = {}) {
  return {
    status: 'ready', generatedAt: `2026-08-10T03:00:0${version}.000Z`, page: 1, pageSize: 20,
    totalRows: 1, totalAmount: effectiveAmount, adjustmentTotal: effectiveAmount - 1000,
    categoryTotals: [{ category: '材料费', amount: effectiveAmount }], incompleteSources: [],
    rows: [{
      ...ledgerRow, version, effectiveAmount, adjustmentAmount: effectiveAmount - 1000,
      allocations: [{ projectId: 'P-1', amount: effectiveAmount }],
    }],
  }
}

function auditSnapshot({ version = 2, effectiveAmount = 900 } = {}) {
  const events = []
  for (let sequenceNo = 1; sequenceNo < version; sequenceNo += 1) {
    const amountBefore = sequenceNo === 1 ? 1000 : 900
    const amountAfter = sequenceNo === version - 1 ? effectiveAmount : 900
    events.push({
      eventType: 'adjustment', sourceKey: ledgerRow.sourceKey, sequenceNo,
      amountBefore, amountAfter, adjustmentAmount: amountAfter - amountBefore,
      allocationsBefore: null, allocationsAfter: null, reason: '历史调整', actorName: '会计甲',
      createdAt: `2026-08-10T02:00:0${sequenceNo}.000Z`,
    })
  }
  return { status: 'ready', generatedAt: '2026-08-10T03:00:09.000Z', events }
}

test('section keeps conflict drafts, refreshes safely, and reloads the applied snapshot plus matching audit before reopening detail', async () => {
  let version = 2
  let effectiveAmount = 900
  let conflictOnce = true
  const listCalls = []
  const auditCalls = []
  const service = {
    async list(filters) { listCalls.push({ ...filters }); return ledgerSnapshot({ version, effectiveAmount }) },
    async listAudit(filters) { auditCalls.push({ ...filters }); return auditSnapshot({ version, effectiveAmount }) },
    async adjust(request) {
      if (conflictOnce) {
        conflictOnce = false
        version = 3
        effectiveAmount = 880
        throw Object.assign(new Error('unsafe database detail'), { code: 'PROJECT_COST_LEDGER_VERSION_CONFLICT' })
      }
      assert.equal(request.expectedVersion, 3)
      version = 4
      effectiveAmount += request.adjustmentAmount
      return { sourceKey: request.sourceKey, version, effectiveAmount }
    },
    async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true },
      projects, actorFingerprint: 'accountant-a',
    })) })
    await change(field(container, '关键词搜索'), '铜管')
    await act(async () => { button(container, '应用筛选').click() })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '本次调整金额'), '-30')
    await change(field(container, '调整原因'), '复核冲减')
    await submitForm(container)
    assert.match(container.textContent, /记录已被修改，请刷新后重试/u)
    assert.doesNotMatch(container.textContent, /unsafe database detail/u)
    assert.equal(field(container, '本次调整金额').value, '-30')
    assert.equal(field(container, '调整原因').value, '复核冲减')

    await act(async () => { button(container, '刷新最新记录').click() })
    assert.equal(field(container, '本次调整金额').value, '-30')
    assert.equal(field(container, '调整原因').value, '复核冲减')
    await submitForm(container)

    assert.deepEqual(listCalls.at(-1), { keyword: '铜管', page: 1, pageSize: 20 })
    assert.deepEqual(auditCalls.at(-1), {})
    assert.match(container.textContent, /[¥￥]850/u)
    assert.match(container.textContent, /自动审计记录/u)
    assert.equal(button(container, '收起')?.textContent, '收起')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('a successful mutation stays open when the refreshed audit is still behind the refreshed ledger', async () => {
  let mutated = false
  const service = {
    async list() { return ledgerSnapshot({ version: mutated ? 3 : 2, effectiveAmount: mutated ? 870 : 900 }) },
    async listAudit() { return auditSnapshot({ version: 2, effectiveAmount: 900 }) },
    async adjust(request) {
      mutated = true
      return { sourceKey: request.sourceKey, version: 3, effectiveAmount: 870 }
    },
    async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true },
      projects, actorFingerprint: 'accountant-a',
    })) })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '本次调整金额'), '-30')
    await change(field(container, '调整原因'), '复核冲减')
    await submitForm(container)
    assert.match(container.textContent, /调整已保存，但最新项目成本读取失败/u)
    assert.match(container.textContent, /调整项目成本/u)
    assert.equal(field(container, '本次调整金额').value, '-30')
    assert.equal(field(container, '调整原因').value, '复核冲减')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('a mutation result never closes against an older but internally consistent ledger and audit pair', async () => {
  let mutated = false
  const service = {
    async list() { return ledgerSnapshot({ version: 2, effectiveAmount: 900 }) },
    async listAudit() { return auditSnapshot({ version: 2, effectiveAmount: 900 }) },
    async adjust(request) {
      mutated = true
      return { sourceKey: request.sourceKey, version: 3, effectiveAmount: 870 }
    },
    async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true },
      projects, actorFingerprint: 'accountant-old-pair',
    })) })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '本次调整金额'), '-30')
    await change(field(container, '调整原因'), '复核冲减')
    await submitForm(container)
    assert.equal(mutated, true)
    assert.match(container.textContent, /调整已保存，但最新项目成本读取失败/u)
    assert.match(container.textContent, /调整项目成本/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('manual success remains open when its source is hidden or missing from the refreshed applied snapshot', async () => {
  const service = {
    async list() { return ledgerSnapshot() }, async listAudit() { return auditSnapshot() },
    async createManual(request) {
      return {
        sourceKey: `manual:${request.requestId}`, projectId: request.entry.projectId,
        category: request.entry.category, date: request.entry.date, amount: request.entry.amount,
        description: request.entry.description, operator: request.entry.operator, reason: request.entry.reason,
        actorName: '会计甲', createdAt: '2026-08-10T03:00:00.000Z',
      }
    },
    async adjust() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true },
      projects, actorFingerprint: 'accountant-manual-missing',
    })) })
    await act(async () => { button(container, '新增调整费用').click() })
    const manualDialog = elements(container, (element) => element.getAttribute?.('role') === 'dialog')[0]
    await change(field(manualDialog, '项目'), 'P-1')
    await change(field(manualDialog, '费用类别'), '其他费用')
    await change(field(manualDialog, '日期'), '2026-08-10')
    await change(field(manualDialog, '金额'), '-20')
    await change(field(manualDialog, '费用说明'), '退款冲销')
    await change(field(manualDialog, '经办人'), '会计甲')
    await change(field(manualDialog, '录入原因'), '供应商退款')
    await submitForm(manualDialog)
    assert.match(container.textContent, /费用已保存，但最新项目成本读取失败/u)
    assert.match(container.textContent, /新增调整费用/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('allocation success reopens the refreshed source first row when the formerly selected project was removed', async () => {
  let replaced = false
  const beforeAudit = {
    status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', events: [{
      eventType: 'allocation', sourceKey: ledgerRow.sourceKey, sequenceNo: 1,
      amountBefore: 900, amountAfter: 900, adjustmentAmount: 0,
      allocationsBefore: [{ projectId: 'P-1', amount: 900 }], allocationsAfter: [{ projectId: 'P-1', amount: 900 }],
      reason: '首次归集', actorName: '会计甲', createdAt: '2026-08-10T02:00:01.000Z',
    }],
  }
  const afterRow = { ...ledgerRow, version: 3, projectId: 'P-2', projectName: '横滨仓库项目', allocations: [{ projectId: 'P-2', amount: 900 }] }
  const afterAudit = {
    status: 'ready', generatedAt: '2026-08-10T03:00:01.000Z', events: [...beforeAudit.events, {
      eventType: 'allocation', sourceKey: ledgerRow.sourceKey, sequenceNo: 2,
      amountBefore: 900, amountAfter: 900, adjustmentAmount: 0,
      allocationsBefore: [{ projectId: 'P-1', amount: 900 }], allocationsAfter: [{ projectId: 'P-2', amount: 900 }],
      reason: '转归横滨', actorName: '会计甲', createdAt: '2026-08-10T02:00:02.000Z',
    }],
  }
  const service = {
    async list() { return replaced ? { ...ledgerSnapshot(), rows: [afterRow] } : ledgerSnapshot() },
    async listAudit() { return replaced ? afterAudit : beforeAudit },
    async replaceAllocations(request) {
      replaced = true
      return { sourceKey: request.sourceKey, version: 3, allocations: [{ projectId: 'P-2', amount: 900 }] }
    },
    async adjust() {}, async createManual() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true }, projects,
      actorFingerprint: 'accountant-reallocate',
    })) })
    await act(async () => { button(container, '拆分').click() })
    await change(field(container, '项目'), 'P-2')
    await change(field(container, '调整原因'), '转归横滨')
    await submitForm(container)
    assert.doesNotMatch(container.textContent, /拆分项目成本/u)
    assert.match(container.textContent, /横滨仓库项目/u)
    assert.equal(button(container, '收起')?.textContent, '收起')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('conflict refresh keeps the draft and stale version when the applied filter no longer returns the target source', async () => {
  let hidden = false
  const empty = {
    ...ledgerSnapshot(), totalRows: 0, totalAmount: 0, adjustmentTotal: 0,
    categoryTotals: [], rows: [],
  }
  const service = {
    async list() { return hidden ? empty : ledgerSnapshot() },
    async listAudit() { return hidden ? { status: 'ready', generatedAt: '2026-08-10T03:00:00.000Z', events: [] } : auditSnapshot() },
    async adjust() {
      hidden = true
      throw Object.assign(new Error('private'), { code: 'PROJECT_COST_LEDGER_VERSION_CONFLICT' })
    },
    async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true }, projects,
      actorFingerprint: 'accountant-filter-hidden',
    })) })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '本次调整金额'), '-30')
    await change(field(container, '调整原因'), '复核冲减')
    await submitForm(container)
    await act(async () => { button(container, '刷新最新记录').click() })
    assert.match(container.textContent, /当前筛选未显示这笔费用，请调整筛选后重试/u)
    assert.equal(field(container, '本次调整金额').value, '-30')
    assert.equal(field(container, '调整原因').value, '复核冲减')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('late mutation completion after cancel or actor replacement cannot reload or close the newly opened dialog', async () => {
  const pending = deferred()
  let listCalls = 0
  const service = {
    async list() { listCalls += 1; return ledgerSnapshot() }, async listAudit() { return auditSnapshot() },
    async adjust() { return pending.promise }, async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const props = (actorFingerprint) => ({
    service, access: { readLedger: true, createManual: true, adjust: true, allocate: true }, projects, actorFingerprint,
  })
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, props('actor-old'))) })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '本次调整金额'), '-10')
    await change(field(container, '调整原因'), '旧弹窗')
    await submitForm(container)
    await act(async () => { button(container, '取消').click() })
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, props('actor-new'))) })
    await act(async () => {})
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '调整原因'), '新弹窗')
    const callsBeforeLate = listCalls
    pending.resolve({ sourceKey: ledgerRow.sourceKey, version: 3, effectiveAmount: 890 })
    await act(async () => {})
    assert.equal(listCalls, callsBeforeLate)
    assert.match(container.textContent, /调整项目成本/u)
    assert.equal(field(container, '调整原因').value, '新弹窗')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('cancelled mutation reload cannot enter loading or commit its late ledger, audit, or auth effects', async () => {
  const reloadStarted = deferred()
  const lateList = deferred()
  const lateAudit = deferred()
  let listCalls = 0
  let auditCalls = 0
  let authInvalidCalls = 0
  const service = {
    async list() {
      listCalls += 1
      if (listCalls === 1) return ledgerSnapshot()
      reloadStarted.resolve()
      return lateList.promise
    },
    async listAudit() {
      auditCalls += 1
      return auditCalls === 1 ? auditSnapshot() : lateAudit.promise
    },
    async adjust(request) { return { sourceKey: request.sourceKey, version: 3, effectiveAmount: 890 } },
    async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
      service, access: { readLedger: true, createManual: true, adjust: true, allocate: true }, projects,
      actorFingerprint: 'accountant-cancel-load', onAuthInvalid() { authInvalidCalls += 1 },
    })) })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '本次调整金额'), '-10')
    await change(field(container, '调整原因'), '旧保存')
    await submitForm(container)
    await act(async () => { await reloadStarted.promise })
    assert.doesNotMatch(container.textContent, /正在读取项目成本/u)
    await act(async () => { button(container, '取消').click() })
    await act(async () => { button(container, '调整').click() })
    await change(field(container, '调整原因'), '新弹窗')
    const staleSnapshot = ledgerSnapshot({ version: 3, effectiveAmount: 890 })
    staleSnapshot.rows[0].description = '已取消操作的迟到数据'
    lateList.resolve(staleSnapshot)
    lateAudit.reject(Object.assign(new Error('expired'), { authInvalid: true }))
    await act(async () => {})
    assert.equal(authInvalidCalls, 0)
    assert.doesNotMatch(container.textContent, /已取消操作的迟到数据/u)
    assert.match(container.textContent, /调整项目成本/u)
    assert.equal(field(container, '调整原因').value, '新弹窗')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('unmounted mutation reload drops late ledger, audit, and auth-invalid completions', async () => {
  const reloadStarted = deferred()
  const lateList = deferred()
  const lateAudit = deferred()
  let listCalls = 0
  let auditCalls = 0
  let authInvalidCalls = 0
  const service = {
    async list() {
      listCalls += 1
      if (listCalls === 1) return ledgerSnapshot()
      reloadStarted.resolve()
      return lateList.promise
    },
    async listAudit() {
      auditCalls += 1
      return auditCalls === 1 ? auditSnapshot() : lateAudit.promise
    },
    async adjust(request) { return { sourceKey: request.sourceKey, version: 3, effectiveAmount: 890 } },
    async createManual() {}, async replaceAllocations() {},
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  await act(async () => { root.render(createElement(ProjectCostLedgerSection, {
    service, access: { readLedger: true, createManual: true, adjust: true, allocate: true }, projects,
    actorFingerprint: 'accountant-unmount-load', onAuthInvalid() { authInvalidCalls += 1 },
  })) })
  await act(async () => { button(container, '调整').click() })
  await change(field(container, '本次调整金额'), '-10')
  await change(field(container, '调整原因'), '卸载隔离')
  await submitForm(container)
  await act(async () => { await reloadStarted.promise })
  await act(async () => { root.unmount() })
  lateList.resolve(ledgerSnapshot({ version: 3, effectiveAmount: 890 }))
  lateAudit.reject(Object.assign(new Error('expired'), { authInvalid: true }))
  await act(async () => {})
  assert.equal(authInvalidCalls, 0)
  assert.equal(container.textContent, '')
  dom.cleanup()
})

test('mutation controls remain disabled when the projected permission denies them', async () => {
  const readonly = await renderDialog(ProjectCostLedgerSection, {
    service: { list() {}, listAudit() {}, adjust() {}, replaceAllocations() {}, createManual() {} },
    access: { readLedger: true, createManual: false, adjust: false, allocate: false },
    projects, actorFingerprint: 'readonly', initialSnapshot: ledgerSnapshot(), initialAuditSnapshot: auditSnapshot(),
  })
  try {
    assert.equal(button(readonly.container, '新增调整费用').disabled, true)
    assert.equal(button(readonly.container, '拆分项目').disabled, true)
    assert.equal(button(readonly.container, '调整').disabled, true)
    assert.equal(button(readonly.container, '拆分').disabled, true)
  } finally {
    await act(async () => { readonly.root.unmount() })
    readonly.dom.cleanup()
  }
  const view = await renderDialog(ProjectCostAdjustmentDialog, {
    row: ledgerRow, allowed: false, onSubmit() {}, onSuccess() {}, onCancel() {},
  })
  try {
    assert.equal(button(view.container, '保存调整').disabled, true)
  } finally {
    await act(async () => { view.root.unmount() })
    view.dom.cleanup()
  }
})

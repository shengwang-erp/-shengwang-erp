import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { flushSync } from 'react-dom'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  plugins: [{
    name: 'project-cost-ledger-app-leaflet-stub',
    enforce: 'pre',
    resolveId(source) {
      return source === 'leaflet' ? '\0project-cost-ledger-app-leaflet-stub' : null
    },
    load(id) {
      if (id !== '\0project-cost-ledger-app-leaflet-stub') return null
      return 'export default { icon: () => ({}) }'
    },
  }],
  ssr: { noExternal: ['leaflet'] },
  server: { middlewareMode: true },
})

const app = await server.ssrLoadModule('/src/App.jsx')
after(() => server.close())

function deferred() {
  let resolve
  let reject
  const promise = new Promise((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function field(root, label) {
  const wrapper = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))[0]
  return elements(wrapper, (element) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName))[0]
}

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

function ledgerSnapshot(description) {
  return {
    status: 'ready', generatedAt: '2026-08-10T00:00:00.000Z', page: 1, pageSize: 20,
    totalRows: 1, totalAmount: 100, adjustmentTotal: 0,
    categoryTotals: [{ category: '材料费', amount: 100 }], incompleteSources: [],
    rows: [{
      sourceKey: `manual:${description}`, sourceModule: 'manual',
      sourceDocumentType: 'manual_project_cost', sourceDocumentId: description,
      projectId: 'P-1', projectName: '一号项目', category: '材料费', date: '2026-08-10',
      description, originalAmount: 100, adjustmentAmount: 0, effectiveAmount: 100,
      operator: '会计', adjusted: false, version: 1,
      allocations: [{ projectId: 'P-1', amount: 100 }], auditEvents: [],
    }],
  }
}

const ledgerAccess = {
  view: true, create: true, update: true, delete: false,
  readLedger: true, createManual: true, adjust: true, allocate: true,
}

test('ledger component never requests while denied and drops a stale prior-account response', async () => {
  assert.equal(typeof app.ProjectCostLedgerSection, 'function')
  assert.notEqual(
    app.createProjectCostLedgerActorFingerprint(
      { id: 'same', effectivePermissionKeys: ['module.project_costs.view'] },
      { view: true, create: false, update: false },
    ),
    app.createProjectCostLedgerActorFingerprint(
      { id: 'same', effectivePermissionKeys: ['module.project_costs.view', 'module.project_costs.update'] },
      { view: true, create: false, update: true },
    ),
  )
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const first = deferred()
  const second = deferred()
  let calls = 0
  const firstService = { list() { calls += 1; return first.promise } }
  const secondService = { list() { calls += 1; return second.promise } }
  try {
    await act(async () => { root.render(createElement(app.ProjectCostLedgerSection, {
      service: firstService, access: { ...ledgerAccess, view: false, readLedger: false },
      projects: [], actorFingerprint: 'actor-a|denied', onAuthInvalid() {},
    })) })
    assert.equal(calls, 0)
    assert.match(container.textContent, /无权读取项目成本/u)

    await act(async () => { root.render(createElement(app.ProjectCostLedgerSection, {
      service: firstService, access: ledgerAccess, projects: [],
      actorFingerprint: 'actor-a|project-cost-view', onAuthInvalid() {},
    })) })
    assert.equal(calls, 1)
    assert.match(container.textContent, /正在读取项目成本/u)

    await act(async () => { root.render(createElement(app.ProjectCostLedgerSection, {
      service: secondService, access: ledgerAccess, projects: [],
      actorFingerprint: 'actor-b|project-cost-view', onAuthInvalid() {},
    })) })
    assert.equal(calls, 2)
    second.resolve(ledgerSnapshot('新账号数据'))
    await act(async () => {})
    assert.match(container.textContent, /新账号数据/u)
    first.resolve(ledgerSnapshot('旧账号机密'))
    await act(async () => {})
    assert.doesNotMatch(container.textContent, /旧账号机密/u)
    assert.match(container.textContent, /新账号数据/u)

    const third = deferred()
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try {
      flushSync(() => { root.render(createElement(app.ProjectCostLedgerSection, {
        service: { list() { calls += 1; return third.promise } },
        access: ledgerAccess, projects: [], actorFingerprint: 'actor-c|project-cost-view',
        onAuthInvalid() {},
      })) })
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
    assert.doesNotMatch(container.textContent, /新账号数据/u)
    assert.match(container.textContent, /项目成本尚未读取|正在读取项目成本/u)
    third.resolve(ledgerSnapshot('第三账号数据'))
    await act(async () => {})
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('ledger auth invalidation logs out and a failed source remains an error', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  let logoutCalls = 0
  try {
    await act(async () => { root.render(createElement(app.ProjectCostLedgerSection, {
      service: { async list() { throw Object.assign(new Error('expired'), { authInvalid: true }) } },
      access: ledgerAccess, projects: [], actorFingerprint: 'actor-expired',
      onAuthInvalid() { logoutCalls += 1 },
    })) })
    await act(async () => {})
    assert.equal(logoutCalls, 1)
    assert.match(container.textContent, /项目成本读取失败/u)
    assert.doesNotMatch(container.textContent, /暂无项目成本|已加载 0 条/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('tool responsibility keeps legacy records company-level and persists an optional project binding', async () => {
  assert.equal(typeof app.normalizeToolResponsibilityRecord, 'function')
  assert.equal(typeof app.ToolResponsibilitySection, 'function')
  assert.deepEqual(
    (({ allocateToProject, projectId, projectName }) => ({ allocateToProject, projectId, projectName }))(
      app.normalizeToolResponsibilityRecord({ projectId: 'P-SECRET', projectName: '不应继承' }),
    ),
    { allocateToProject: false, projectId: '', projectName: '' },
  )
  assert.equal(app.toolResponsibilityGrossCost({ issueType: '丢失', toolValue: 800, repairCost: 50 }), 800)
  assert.equal(app.toolResponsibilityGrossCost({ issueType: '损坏', toolValue: 800, repairCost: 50 }), 50)

  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  let saved = []
  const assignments = [{
    assignmentId: 'A-1', toolId: 'T-1', toolName: '电钻', employeeId: 'E-1',
    employeeName: '施工员', serialNumber: 'SN-1', toolValue: 800,
    responsibilityStatus: '正常使用中',
  }]
  try {
    await act(async () => { root.render(createElement(app.ToolResponsibilitySection, {
      employees: [], assignments, setAssignments() {}, toolRecords: [], setToolRecords() {},
      projects: [{ projectId: 'P-1', projectName: '一号项目' }], records: [],
      setRecords(updater) { saved = updater(saved) }, canManageTools: true,
    })) })
    await change(field(container, '员工名下工具'), 'A-1')
    assert.match(container.textContent, /计入项目成本/u)
    const checkbox = field(container, '计入项目成本')
    await act(async () => {
      checkbox.checked = true
      checkbox.click()
    })
    await change(field(container, '工程项目'), 'P-1')
    const form = elements(container, (element) => element.nodeName === 'FORM')[0]
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })

    assert.equal(saved.length, 1)
    assert.equal(saved[0].allocateToProject, true)
    assert.equal(saved[0].projectId, 'P-1')
    assert.equal(saved[0].projectName, '一号项目')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

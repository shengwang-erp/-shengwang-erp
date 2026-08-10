import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { flushSync } from 'react-dom'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from '../warehouse/warehouseReactDomTestUtils.js'
import { canEdit } from '../../utils/permissions.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/task5-project-cost-ledger-vite-cache',
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

const activeToolManager = {
  employeeId: 'E-TOOLS', employeeNumber: 'SW-TOOLS', name: '工具管理员',
  department: '总务部', position: '社员', employmentStatus: '在职',
  accountStatus: 'active', mustChangePassword: false,
  effectivePermissionKeys: ['module.tools.view', 'module.tools.update'],
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
    assert.match(container.textContent, /第三账号数据/u)

    const callsBeforePermissionLoss = calls
    await act(async () => { flushSync(() => { root.render(createElement(app.ProjectCostLedgerSection, {
      service: secondService,
      access: { ...ledgerAccess, view: false, readLedger: false },
      projects: [], actorFingerprint: 'actor-c|denied', onAuthInvalid() {},
    })) }) })
    assert.equal(calls, callsBeforePermissionLoss)
    assert.doesNotMatch(container.textContent, /第三账号数据/u)
    assert.match(container.textContent, /无权读取项目成本/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('ledger unmount cleanup prevents a pending response from refilling exited UI', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const pending = deferred()
  let calls = 0
  await act(async () => { root.render(createElement(app.ProjectCostLedgerSection, {
    service: { list() { calls += 1; return pending.promise } },
    access: ledgerAccess, projects: [], actorFingerprint: 'actor-route-exit',
    onAuthInvalid() {},
  })) })
  assert.equal(calls, 1)
  await act(async () => { root.unmount() })
  pending.resolve(ledgerSnapshot('退出后机密'))
  await act(async () => {})
  assert.equal(container.textContent, '')
  assert.equal(calls, 1)
  dom.cleanup()
})

test('tool-only manager follows the real App project-reference loader and can save binding', async () => {
  assert.equal(typeof app.loadProjectDirectoryForAccess, 'function')
  assert.equal(typeof app.getProjectReferenceAccess, 'function')
  const access = app.getProjectReferenceAccess(activeToolManager)
  const canManageTools = canEdit(activeToolManager, '工具管理')
  const calls = []
  const projects = await app.loadProjectDirectoryForAccess({
    async listProjects() { calls.push('full'); return [] },
    async listProjectReferences() {
      calls.push('references')
      return [{ projectId: 'P-1', projectName: '一号项目', status: '进行中', address: '' }]
    },
  }, access)
  assert.deepEqual(access, { view: true, full: false })
  assert.equal(canManageTools, true)
  assert.deepEqual(calls, ['references'])

  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  let saved = []
  try {
    await act(async () => { root.render(createElement(app.ToolResponsibilitySection, {
      employees: [], assignments: [{
        assignmentId: 'A-1', toolId: 'T-1', toolName: '电钻', employeeId: 'E-1',
        employeeName: '施工员', serialNumber: 'SN-1', toolValue: 800,
        responsibilityStatus: '正常使用中',
      }],
      setAssignments() {}, toolRecords: [], setToolRecords() {}, projects, records: [],
      setRecords(updater) { saved = updater(saved) }, canManageTools,
    })) })
    await change(field(container, '员工名下工具'), 'A-1')
    const checkbox = field(container, '计入项目成本')
    await act(async () => { checkbox.checked = true; checkbox.click() })
    await change(field(container, '工程项目'), 'P-1')
    const form = elements(container, (element) => element.nodeName === 'FORM')[0]
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
    assert.equal(saved[0].projectId, 'P-1')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('project directory synchronously isolates actor and permission changes and drops late responses', async () => {
  assert.equal(typeof app.useProjectDirectoryLifecycle, 'function')
  assert.equal(typeof app.createProjectDirectoryActorFingerprint, 'function')
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const first = deferred()
  const second = deferred()
  const reference = deferred()
  const calls = []
  const service = {
    listProjects() {
      calls.push('full')
      return calls.length === 1 ? first.promise : second.promise
    },
    listProjectReferences() {
      calls.push('reference')
      return reference.promise
    },
  }
  const fullAccess = { view: true, full: true }
  const referenceAccess = { view: true, full: false }
  const actor = (id, keys) => ({
    id, employeeId: id, tenantId: 'tenant-a', effectivePermissionKeys: keys,
  })
  function Probe({ currentUser, access }) {
    const directory = app.useProjectDirectoryLifecycle({
      service, currentUser, access, onFatalError() {},
    })
    return createElement('div', null,
      createElement('span', null, directory.rawState.loading ? 'loading' : 'settled'),
      ...directory.rows.map((row) => createElement(
        'span', { key: row.projectId }, JSON.stringify(row),
      )),
    )
  }
  const actorA = actor('actor-a', ['module.projects.view'])
  const actorB = actor('actor-b', ['module.projects.view'])
  try {
    await act(async () => { root.render(createElement(Probe, {
      currentUser: actorA, access: fullAccess,
    })) })
    assert.deepEqual(calls, ['full'])
    first.resolve([{
      projectId: 'P-1', projectName: '甲项目', status: '进行中', address: '',
      contractAmount: 999,
    }])
    await act(async () => {})
    assert.match(container.textContent, /contractAmount/u)

    await act(async () => {
      flushSync(() => { root.render(createElement(Probe, {
        currentUser: actor('actor-a', [
          'module.projects.view', 'sensitive.contract_amount_view',
        ]),
        access: fullAccess,
      })) })
      assert.match(container.textContent, /loading/u)
      assert.doesNotMatch(container.textContent, /contractAmount/u)
    })
    assert.deepEqual(calls, ['full', 'full'])

    await act(async () => {
      flushSync(() => { root.render(createElement(Probe, {
        currentUser: actorB, access: fullAccess,
      })) })
      assert.match(container.textContent, /loading/u)
      assert.doesNotMatch(container.textContent, /contractAmount/u)
    })
    assert.deepEqual(calls, ['full', 'full', 'full'])

    await act(async () => {
      flushSync(() => { root.render(createElement(Probe, {
        currentUser: actor('actor-b', ['module.tools.view', 'module.tools.update']),
        access: referenceAccess,
      })) })
      assert.match(container.textContent, /loading/u)
      assert.doesNotMatch(container.textContent, /contractAmount/u)
    })
    assert.deepEqual(calls, ['full', 'full', 'full', 'reference'])

    second.resolve([{
      projectId: 'P-OLD', projectName: '旧完整项目', status: '进行中', address: '',
      contractAmount: 888,
    }])
    await act(async () => {})
    assert.doesNotMatch(container.textContent, /旧完整项目|contractAmount/u)
    reference.resolve([{
      projectId: 'P-2', projectName: '乙项目', status: '进行中', address: '',
    }])
    await act(async () => {})
    assert.match(container.textContent, /乙项目/u)
    assert.doesNotMatch(container.textContent, /contractAmount/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('project directory ignores actor A captured create update delete and refresh mutations after actor B is ready', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const actorALoad = deferred()
  const actorBLoad = deferred()
  const createCompletion = deferred()
  const updateCompletion = deferred()
  const deleteCompletion = deferred()
  const refreshCompletion = deferred()
  let loadCalls = 0
  let actorASetRows
  const service = {
    listProjects() {
      loadCalls += 1
      return loadCalls === 1 ? actorALoad.promise : actorBLoad.promise
    },
  }
  const actor = (id) => ({
    id, employeeId: id, tenantId: 'tenant-a',
    effectivePermissionKeys: ['module.projects.view'],
  })
  function Probe({ currentUser }) {
    const directory = app.useProjectDirectoryLifecycle({
      service, currentUser, access: { view: true, full: true }, onFatalError() {},
    })
    if (currentUser.id === 'actor-a') actorASetRows = directory.setRows
    return createElement('div', null,
      createElement('span', null, directory.rawState.loading ? 'loading' : 'settled'),
      createElement('span', null, `identity:${directory.rawState.identity}`),
      ...directory.rows.map((row) => createElement(
        'span', { key: row.projectId }, `${row.projectId}:${row.projectName}`,
      )),
    )
  }

  try {
    await act(async () => { root.render(createElement(Probe, { currentUser: actor('actor-a') })) })
    assert.equal(typeof actorASetRows, 'function')
    const lateMutations = [
      createCompletion.promise.then(() => actorASetRows((rows) => [
        { projectId: 'P-A-CREATE', projectName: '旧账号新增' }, ...rows,
      ])),
      updateCompletion.promise.then(() => actorASetRows((rows) => rows.map((row) => (
        row.projectId === 'P-B'
          ? { ...row, projectName: '旧账号修改' }
          : row
      )))),
      deleteCompletion.promise.then(() => actorASetRows((rows) => (
        rows.filter((row) => row.projectId !== 'P-B')
      ))),
      refreshCompletion.promise.then(() => actorASetRows([
        { projectId: 'P-A-REFRESH', projectName: '旧账号刷新' },
      ])),
    ]

    await act(async () => {
      flushSync(() => { root.render(createElement(Probe, { currentUser: actor('actor-b') })) })
    })
    actorBLoad.resolve([{ projectId: 'P-B', projectName: '新账号项目' }])
    await act(async () => {})
    assert.match(container.textContent, /settled.*actor-b.*P-B:新账号项目/u)

    createCompletion.resolve()
    updateCompletion.resolve()
    deleteCompletion.resolve()
    refreshCompletion.resolve()
    await act(async () => { await Promise.all(lateMutations) })
    actorALoad.resolve([{ projectId: 'P-A-LOAD', projectName: '旧账号响应' }])
    await act(async () => {})

    assert.match(container.textContent, /settled.*actor-b.*P-B:新账号项目/u)
    assert.doesNotMatch(
      container.textContent,
      /loading|actor-a|P-A-CREATE|旧账号修改|P-A-REFRESH|P-A-LOAD/u,
    )
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

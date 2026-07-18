import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import { getDashboardAccess } from '../../auth/businessAccess.js'
import {
  buildAuthorizedMessages,
  buildWorkbenchItems,
  countAuthorizedWorkbenchBadges,
  projectAuthorizedWorkbenchItems,
  resolveDashboardBridgeMonth,
} from './workbenchModel.js'

const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  employeeId: 'E-WORK',
  employeeNumber: 'SW-123',
  name: '工作台员工',
  department: '现场',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys,
  ...overrides,
})

const financeUser = () => activeUser([
  'module.owner_dashboard.view',
  'module.accounting.view',
  'module.purchases.view',
  'sensitive.owner_dashboard_full_view',
  'sensitive.purchase_payments_view',
], {
  employeeId: 'E-FINANCE',
  name: '财务员工',
  department: '会计',
  position: '会计',
})

async function loadPages() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await Promise.all([
      server.ssrLoadModule('/src/features/workbench/MobileWorkbenchPage.jsx'),
      server.ssrLoadModule('/src/features/workbench/MobileMessagesPage.jsx'),
      server.ssrLoadModule('/src/features/workbench/MobileProfilePage.jsx'),
      server.ssrLoadModule('/src/features/workbench/workbenchModel.js'),
    ])
  } finally {
    await server.close()
  }
}

test('workbench items use only real authorized routes and calculate badges after filtering', () => {
  let hiddenCountReads = 0
  const counts = {
    todayAttendance: 2,
    get projects() {
      hiddenCountReads += 1
      return 999
    },
    inventory: 777,
  }
  const user = activeUser()
  const items = buildWorkbenchItems({ user, counts })

  assert.deepEqual(items, [{
    view: 'todayAttendance',
    label: '今日打卡',
    iconText: '勤',
    badgeCount: 2,
  }])
  assert.equal(hiddenCountReads, 0)
  assert.equal(items.some(({ view, label }) => view === 'inventory' || label === '仓库库存'), false)
  assert.equal(countAuthorizedWorkbenchBadges(user, items), 2)
})

test('workbench projections require same-actor provenance before reading or rendering badges', () => {
  const actor = activeUser([], { employeeId: 'E-ACTOR-A', employeeNumber: 'SW-201' })
  const otherActor = activeUser([], { employeeId: 'E-ACTOR-B', employeeNumber: 'SW-202' })
  const items = buildWorkbenchItems({ user: actor, counts: { todayAttendance: 7 } })

  assert.deepEqual(projectAuthorizedWorkbenchItems(actor, items).map(({ route, badgeCount }) => ({
    view: route.view,
    label: route.label,
    badgeCount,
  })), [{ view: 'todayAttendance', label: '今日打卡', badgeCount: 7 }])
  assert.equal(countAuthorizedWorkbenchBadges(actor, items), 7)
  assert.deepEqual(projectAuthorizedWorkbenchItems(otherActor, items), [])
  assert.equal(countAuthorizedWorkbenchBadges(otherActor, items), 0)

  let forgedBadgeReads = 0
  const forged = [{
    view: 'todayAttendance',
    get badgeCount() {
      forgedBadgeReads += 1
      return 999
    },
  }]
  assert.deepEqual(projectAuthorizedWorkbenchItems(actor, forged), [])
  assert.equal(countAuthorizedWorkbenchBadges(actor, forged), 0)
  assert.equal(forgedBadgeReads, 0)

  const sameActorSnapshot = {
    ...actor,
    effectivePermissionKeys: [...actor.effectivePermissionKeys],
  }
  assert.equal(countAuthorizedWorkbenchBadges(sameActorSnapshot, items), 7)

  const mutableActor = activeUser([], {
    employeeId: 'E-MUTABLE-A',
    employeeNumber: 'SW-301',
  })
  const mutableItems = buildWorkbenchItems({
    user: mutableActor,
    counts: { todayAttendance: 11 },
  })
  mutableActor.employeeId = 'E-MUTABLE-B'
  mutableActor.employeeNumber = 'SW-302'
  assert.deepEqual(projectAuthorizedWorkbenchItems(mutableActor, mutableItems), [])
  assert.equal(countAuthorizedWorkbenchBadges(mutableActor, mutableItems), 0)

  let descriptorTrapCalls = 0
  const hostileActor = new Proxy(actor, {
    getOwnPropertyDescriptor() {
      descriptorTrapCalls += 1
      throw new Error('hostile actor descriptor')
    },
  })
  assert.doesNotThrow(() => projectAuthorizedWorkbenchItems(hostileActor, items))
  assert.deepEqual(projectAuthorizedWorkbenchItems(hostileActor, items), [])
  assert.equal(countAuthorizedWorkbenchBadges(hostileActor, items), 0)
  assert.ok(descriptorTrapCalls > 0)

  const revokedItems = Proxy.revocable([], {})
  revokedItems.revoke()
  assert.doesNotThrow(() => projectAuthorizedWorkbenchItems(actor, revokedItems.proxy))
  assert.deepEqual(projectAuthorizedWorkbenchItems(actor, revokedItems.proxy), [])
  assert.equal(countAuthorizedWorkbenchBadges(actor, revokedItems.proxy), 0)

  const projectActor = activeUser(['module.projects.view'], {
    employeeId: 'E-SAME-ACTOR',
    employeeNumber: 'SW-401',
  })
  const projectItems = buildWorkbenchItems({
    user: projectActor,
    counts: { projects: 13 },
  })
  const revokedProjectActor = {
    ...projectActor,
    effectivePermissionKeys: [],
  }
  const downgraded = projectAuthorizedWorkbenchItems(revokedProjectActor, projectItems)
  assert.deepEqual(downgraded.map(({ route }) => route.view), ['todayAttendance'])
  assert.equal(countAuthorizedWorkbenchBadges(revokedProjectActor, projectItems), 0)
})

test('one actor snapshot prevents a stateful Proxy from authorizing A and marking badges for B', () => {
  const actorA = activeUser(['module.projects.view'], {
    employeeId: 'E-PROXY-A',
    employeeNumber: 'SW-601',
  })
  const actorB = activeUser(['module.projects.view'], {
    employeeId: 'E-PROXY-B',
    employeeNumber: 'SW-602',
  })
  let descriptorBatch = 0
  let remainingDescriptors = 0
  let descriptorReads = 0
  let descriptorSource = actorA
  const statefulActor = new Proxy({}, {
    getPrototypeOf() {
      return Object.prototype
    },
    ownKeys() {
      descriptorBatch += 1
      descriptorSource = descriptorBatch === 1 ? actorA : actorB
      const keys = Reflect.ownKeys(descriptorSource)
      remainingDescriptors = keys.length
      return keys
    },
    getOwnPropertyDescriptor(_target, key) {
      descriptorReads += 1
      const source = remainingDescriptors > 0 ? descriptorSource : actorB
      const descriptor = Reflect.getOwnPropertyDescriptor(source, key)
      if (remainingDescriptors > 0) remainingDescriptors -= 1
      return descriptor
    },
  })

  const items = buildWorkbenchItems({
    user: statefulActor,
    counts: { projects: 13 },
  })

  assert.equal(countAuthorizedWorkbenchBadges(actorA, items), 13)
  assert.equal(countAuthorizedWorkbenchBadges(actorB, items), 0)
  assert.deepEqual(projectAuthorizedWorkbenchItems(actorB, items), [])
  assert.equal(descriptorBatch, 1)
  assert.equal(descriptorReads, Reflect.ownKeys(actorA).length)
})

test('dashboard alert month follows the active bridge context across route changes', () => {
  const context = {
    dashboardSelectedMonth: '2026-04',
    accountingMonth: '2026-06',
    currentMonth: '2026-07',
  }
  for (const authorizedView of ['dashboard', 'workbench', 'messages', 'profile', 'projects']) {
    assert.equal(resolveDashboardBridgeMonth({ ...context, authorizedView }), '2026-04')
  }
  assert.equal(resolveDashboardBridgeMonth({ ...context, authorizedView: 'accounting' }), '2026-06')
  assert.equal(resolveDashboardBridgeMonth({ ...context, authorizedView: 'home' }), '2026-07')
})

test('messages reject unauthorized targets before preserving counts or amounts', () => {
  const ordinaryAlerts = [{
    id: 'private', type: 'missing_profit_anchor', severity: 'danger', title: '项目秘密', reason: '内部金额',
    count: 8, amount: 900000, targetView: 'projects', canNavigate: true,
  }]
  assert.deepEqual(buildAuthorizedMessages({
    access: { user: activeUser(), dashboard: getDashboardAccess(activeUser()) },
    alerts: ordinaryAlerts,
  }), [])

  const user = financeUser()
  const messages = buildAuthorizedMessages({
    access: { user, dashboard: getDashboardAccess(user) },
    alerts: [
      {
        id: 'payable', type: 'purchase_payable', severity: 'warning', title: '采购待付款', reason: '有待付款项目',
        count: 3, amount: 1200, targetView: 'purchase', canNavigate: true,
      },
      {
        id: 'project-secret', type: 'missing_profit_anchor', severity: 'danger', title: '无权工程', reason: '不得显示',
        count: 9, amount: 999999, targetView: 'projects', canNavigate: true,
      },
    ],
  })

  assert.deepEqual(messages, [{
    id: 'payable',
    severity: 'warning',
    title: '采购待付款',
    summary: '有待付款项目',
    count: 3,
    amount: 1200,
    targetView: 'purchase',
    canNavigate: true,
  }])
  assert.equal(JSON.stringify(messages).includes('999999'), false)

  let forgedCountReads = 0
  const forgedAlert = {
    id: 'forged', type: 'purchase_payable', severity: 'warning',
    title: '伪造权限', reason: '不得显示', targetView: 'purchase', canNavigate: true,
    get count() {
      forgedCountReads += 1
      return 999
    },
    amount: 999999,
  }
  assert.deepEqual(buildAuthorizedMessages({
    access: {
      user: activeUser(),
      dashboard: { page: true, purchase: { accrual: true, payable: true } },
    },
    alerts: [forgedAlert],
  }), [])
  assert.equal(forgedCountReads, 0)

  const sourceOnly = buildAuthorizedMessages({
    access: { user, dashboard: getDashboardAccess(user) },
    alerts: [{
      id: 'source', type: 'source_issue', severity: 'info', title: '数据源状态提示',
      reason: '采购数据已过期', count: 1, amount: 8888,
      targetView: null, canNavigate: false,
    }],
  })
  assert.equal(sourceOnly[0].amount, null)

  const owner = activeUser(['all'], {
    employeeId: 'SUPER_ADMIN',
    employeeNumber: 'SW-000',
    name: '系统社长',
    department: '总务部',
    position: '社长',
  })
  let mismatchedTargetAmountReads = 0
  assert.deepEqual(buildAuthorizedMessages({
    access: { user: owner, dashboard: getDashboardAccess(owner) },
    alerts: [{
      id: 'wrong-target', type: 'purchase_payable', severity: 'warning',
      title: '采购待付款', reason: '目标被篡改', count: 1,
      get amount() {
        mismatchedTargetAmountReads += 1
        return 7777
      },
      targetView: 'settings', canNavigate: true,
    }],
  }), [])
  assert.equal(mismatchedTargetAmountReads, 0)

  let disabledNavigationAmountReads = 0
  assert.deepEqual(buildAuthorizedMessages({
    access: { user: owner, dashboard: getDashboardAccess(owner) },
    alerts: [{
      id: 'disabled-target', type: 'purchase_payable', severity: 'warning',
      title: '采购待付款', reason: '导航已禁用', count: 1,
      get amount() {
        disabledNavigationAmountReads += 1
        return 8888
      },
      targetView: 'purchase', canNavigate: false,
    }],
  }), [])
  assert.equal(disabledNavigationAmountReads, 0)
})

test('mobile workbench, messages, and profile SSR stay inside permission projections', async () => {
  const [workbenchModule, messagesModule, profileModule, runtimeWorkbenchModel] = await loadPages()
  const ordinary = activeUser()
  const finance = financeUser()
  const owner = activeUser(['all'], {
    employeeId: 'SUPER_ADMIN',
    employeeNumber: 'SW-000',
    name: '系统社长',
    department: '总务部',
    position: '社长',
  })

  const ordinaryWorkbench = renderToStaticMarkup(createElement(workbenchModule.default, {
    currentUser: ordinary,
    items: [{
      view: 'todayAttendance', label: '伪造模块', iconText: 'X', badgeCount: Number.MAX_SAFE_INTEGER,
    }],
    onNavigate() {},
  }))
  assert.match(ordinaryWorkbench, /当前没有可进入的业务模块/u)
  assert.doesNotMatch(ordinaryWorkbench, /今日打卡|>勤<|伪造模块|>X<|9007199254740991/u)

  const genuineItems = runtimeWorkbenchModel.buildWorkbenchItems({
    user: ordinary,
    counts: { todayAttendance: 5 },
  })
  const genuineWorkbench = renderToStaticMarkup(createElement(workbenchModule.default, {
    currentUser: ordinary,
    items: genuineItems,
    onNavigate() {},
  }))
  assert.match(genuineWorkbench, /今日打卡|>勤</u)
  assert.match(genuineWorkbench, /5 条待处理/u)

  const crossActorWorkbench = renderToStaticMarkup(createElement(workbenchModule.default, {
    currentUser: activeUser([], { employeeId: 'E-OTHER', employeeNumber: 'SW-321' }),
    items: genuineItems,
    onNavigate() {},
  }))
  assert.match(crossActorWorkbench, /当前没有可进入的业务模块/u)
  assert.doesNotMatch(crossActorWorkbench, /5 条待处理/u)

  const projectActor = activeUser(['module.projects.view'], {
    employeeId: 'E-SSR-SAME',
    employeeNumber: 'SW-411',
  })
  const projectItems = runtimeWorkbenchModel.buildWorkbenchItems({
    user: projectActor,
    counts: { projects: 13 },
  })
  const downgradedWorkbench = renderToStaticMarkup(createElement(workbenchModule.default, {
    currentUser: { ...projectActor, effectivePermissionKeys: [] },
    items: projectItems,
    onNavigate() {},
  }))
  assert.match(downgradedWorkbench, /今日打卡/u)
  assert.doesNotMatch(downgradedWorkbench, /工程项目|13 条待处理/u)

  const financeMessages = buildAuthorizedMessages({
    access: { user: finance, dashboard: getDashboardAccess(finance) },
    alerts: [{
      id: 'finance-alert', type: 'purchase_payable', severity: 'warning', title: '采购待付款', reason: '3 笔待处理',
      count: 3, amount: 1200, targetView: 'purchase', canNavigate: true,
    }],
  })
  const financeMarkup = renderToStaticMarkup(createElement(messagesModule.default, {
    currentUser: finance,
    messages: financeMessages,
    onNavigate() {},
  }))
  assert.match(financeMarkup, /采购待付款|¥1,200/u)

  const ownerMarkup = renderToStaticMarkup(createElement(profileModule.default, {
    currentUser: owner,
    onLogout() {},
  }))
  assert.match(ownerMarkup, /系统社长|总务部|社长|退出登录/u)
  assert.match(ownerMarkup, /老板驾驶舱|工程项目|会计成本/u)
})

test('mobile pages import centralized route or access metadata instead of local module arrays', async () => {
  const paths = [
    './MobileWorkbenchPage.jsx',
    './MobileMessagesPage.jsx',
    './MobileProfilePage.jsx',
  ]
  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8')
    assert.match(source, /(?:adminRoutes|businessAccess|workbenchModel)\.js/u, path)
    assert.doesNotMatch(source, /const\s+(?:modules|routes|menuItems)\s*=\s*\[/u, path)
  }
})

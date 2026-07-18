import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import { getDashboardAccess } from '../../auth/businessAccess.js'
import { buildAuthorizedMessages, buildWorkbenchItems } from './workbenchModel.js'

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
  const items = buildWorkbenchItems({ user: activeUser(), counts })

  assert.deepEqual(items, [{
    view: 'todayAttendance',
    label: '今日打卡',
    iconText: '勤',
    badgeCount: 2,
  }])
  assert.equal(hiddenCountReads, 0)
  assert.equal(items.some(({ view, label }) => view === 'inventory' || label === '仓库库存'), false)
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
  const [workbenchModule, messagesModule, profileModule] = await loadPages()
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
  assert.match(ordinaryWorkbench, /今日打卡/u)
  assert.match(ordinaryWorkbench, />勤</u)
  assert.doesNotMatch(ordinaryWorkbench, /伪造模块|>X<|9007199254740991/u)

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
    assert.match(source, /(?:adminRoutes|businessAccess)\.js/u, path)
    assert.doesNotMatch(source, /const\s+(?:modules|routes|menuItems)\s*=\s*\[/u, path)
  }
})

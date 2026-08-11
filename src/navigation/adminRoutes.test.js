import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ADMIN_ROUTES,
  MOBILE_PRIMARY_TABS,
  getAdminRoute,
  normalizeAdminView,
} from './adminRoutes.js'

const expectedDesktopRoutes = [
  ['home', '首页', '首', null],
  ['dashboard', '老板驾驶舱', '舱', '老板驾驶舱'],
  ['projects', '工程项目', '项', '工程项目'],
  ['employees', '人员管理', '人', '人员管理'],
  ['accounting', '会计成本', '财', '会计成本'],
  ['labor', '人工记录', '工', '人工记录'],
  ['warehouse', '仓库管理', '仓', '仓库库存'],
  ['stockOut', '我要出库', '出', '仓库库存'],
  ['stockReturn', '我要退回', '退', '仓库库存'],
  ['purchase', '采购管理', '采', '采购管理'],
  ['vehicle', '车辆管理', '车', '车辆管理'],
  ['toolBorrow', '借工具', '借', '工具管理'],
  ['todayAttendance', '今日打卡', '勤', null],
  ['settings', '系统设置', '设', '系统设置'],
].map(([view, label, iconText, moduleName], menuOrder) => ({
  view,
  label,
  iconText,
  moduleName,
  desktop: true,
  mobileTab: view === 'home',
  menuOrder,
  normalizeTo: null,
}))

const expectedChildAndMobileRoutes = [
  {
    view: 'miraisyaSettlement',
    label: '未来社月度结算',
    iconText: '结',
    moduleName: '工程项目',
    desktop: false,
    mobileTab: false,
    menuOrder: null,
    normalizeTo: null,
  },
  {
    view: 'contractRevenue',
    label: '合同收入',
    iconText: '合',
    moduleName: '工程项目',
    desktop: false,
    mobileTab: false,
    menuOrder: null,
    normalizeTo: 'projects',
  },
  {
    view: 'workbench',
    label: '工作台',
    iconText: '台',
    moduleName: null,
    desktop: false,
    mobileTab: true,
    menuOrder: 1,
    normalizeTo: null,
  },
  {
    view: 'messages',
    label: '消息',
    iconText: '讯',
    moduleName: null,
    desktop: false,
    mobileTab: true,
    menuOrder: 2,
    normalizeTo: null,
  },
  {
    view: 'profile',
    label: '我的',
    iconText: '我',
    moduleName: null,
    desktop: false,
    mobileTab: true,
    menuOrder: 3,
    normalizeTo: null,
  },
]

test('the immutable route table has the exact desktop metadata and order', () => {
  assert.deepEqual(ADMIN_ROUTES.slice(0, 14), expectedDesktopRoutes)
  assert.deepEqual(ADMIN_ROUTES.slice(14), expectedChildAndMobileRoutes)
  assert.equal(new Set(ADMIN_ROUTES.map(({ view }) => view)).size, ADMIN_ROUTES.length)

  for (const route of ADMIN_ROUTES) {
    assert.deepEqual(Object.keys(route), [
      'view',
      'label',
      'iconText',
      'moduleName',
      'desktop',
      'mobileTab',
      'menuOrder',
      'normalizeTo',
    ])
    assert.equal(Object.isFrozen(route), true)
  }
  assert.equal(Object.isFrozen(ADMIN_ROUTES), true)
  assert.throws(() => ADMIN_ROUTES.push(expectedDesktopRoutes[0]), TypeError)
})

test('mobile primary tabs are derived in the fixed Home, Workbench, Messages, Profile order', () => {
  assert.deepEqual(
    MOBILE_PRIMARY_TABS.map(({ view, label, menuOrder }) => ({ view, label, menuOrder })),
    [
      { view: 'home', label: '首页', menuOrder: 0 },
      { view: 'workbench', label: '工作台', menuOrder: 1 },
      { view: 'messages', label: '消息', menuOrder: 2 },
      { view: 'profile', label: '我的', menuOrder: 3 },
    ],
  )
  assert.equal(Object.isFrozen(MOBILE_PRIMARY_TABS), true)
})

test('route lookup and normalization return detached immutable values', () => {
  const projectRoute = getAdminRoute('projects')
  const secondProjectRoute = getAdminRoute('projects')

  assert.deepEqual(projectRoute, expectedDesktopRoutes[2])
  assert.notEqual(projectRoute, ADMIN_ROUTES[2])
  assert.notEqual(projectRoute, secondProjectRoute)
  assert.equal(Object.isFrozen(projectRoute), true)
  assert.throws(() => {
    projectRoute.label = 'changed'
  }, TypeError)

  assert.equal(normalizeAdminView('contractRevenue'), 'projects')
  assert.equal(normalizeAdminView('miraisyaSettlement'), 'miraisyaSettlement')
  assert.equal(normalizeAdminView('purchase'), 'purchase')
  assert.equal(normalizeAdminView('unknown'), 'home')
})

test('malformed and object-coerced views fail closed without invoking accessors', () => {
  let calls = 0
  const accessorView = Object.defineProperty({}, 'toString', {
    get() {
      calls += 1
      return () => 'home'
    },
  })

  for (const value of [null, undefined, '', 0, new String('home'), accessorView]) {
    assert.equal(getAdminRoute(value), null)
    assert.equal(normalizeAdminView(value), 'home')
  }
  assert.equal(calls, 0)
})

function freezeRoute(route) {
  return Object.freeze(route)
}

export const ADMIN_ROUTES = Object.freeze([
  freezeRoute({
    view: 'home',
    label: '首页',
    iconText: '首',
    moduleName: null,
    desktop: true,
    mobileTab: true,
    menuOrder: 0,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'dashboard',
    label: '老板驾驶舱',
    iconText: '舱',
    moduleName: '老板驾驶舱',
    desktop: true,
    mobileTab: false,
    menuOrder: 1,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'projects',
    label: '工程项目',
    iconText: '项',
    moduleName: '工程项目',
    desktop: true,
    mobileTab: false,
    menuOrder: 2,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'employees',
    label: '人员管理',
    iconText: '人',
    moduleName: '人员管理',
    desktop: true,
    mobileTab: false,
    menuOrder: 3,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'accounting',
    label: '会计成本',
    iconText: '财',
    moduleName: '会计成本',
    desktop: true,
    mobileTab: false,
    menuOrder: 4,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'labor',
    label: '人工记录',
    iconText: '工',
    moduleName: '人工记录',
    desktop: true,
    mobileTab: false,
    menuOrder: 5,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'stockOut',
    label: '我要出库',
    iconText: '出',
    moduleName: '仓库库存',
    desktop: true,
    mobileTab: false,
    menuOrder: 6,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'stockReturn',
    label: '我要退回',
    iconText: '退',
    moduleName: '仓库库存',
    desktop: true,
    mobileTab: false,
    menuOrder: 7,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'purchase',
    label: '采购管理',
    iconText: '采',
    moduleName: '采购管理',
    desktop: true,
    mobileTab: false,
    menuOrder: 8,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'vehicle',
    label: '车辆管理',
    iconText: '车',
    moduleName: '车辆管理',
    desktop: true,
    mobileTab: false,
    menuOrder: 9,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'toolBorrow',
    label: '借工具',
    iconText: '借',
    moduleName: '工具管理',
    desktop: true,
    mobileTab: false,
    menuOrder: 10,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'todayAttendance',
    label: '今日打卡',
    iconText: '勤',
    moduleName: null,
    desktop: true,
    mobileTab: false,
    menuOrder: 11,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'settings',
    label: '系统设置',
    iconText: '设',
    moduleName: '系统设置',
    desktop: true,
    mobileTab: false,
    menuOrder: 12,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'contractRevenue',
    label: '合同收入',
    iconText: '合',
    moduleName: '工程项目',
    desktop: false,
    mobileTab: false,
    menuOrder: null,
    normalizeTo: 'projects',
  }),
  freezeRoute({
    view: 'workbench',
    label: '工作台',
    iconText: '台',
    moduleName: null,
    desktop: false,
    mobileTab: true,
    menuOrder: 1,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'messages',
    label: '消息',
    iconText: '讯',
    moduleName: null,
    desktop: false,
    mobileTab: true,
    menuOrder: 2,
    normalizeTo: null,
  }),
  freezeRoute({
    view: 'profile',
    label: '我的',
    iconText: '我',
    moduleName: null,
    desktop: false,
    mobileTab: true,
    menuOrder: 3,
    normalizeTo: null,
  }),
])

const ROUTES_BY_VIEW = new Map(ADMIN_ROUTES.map((route) => [route.view, route]))

export const MOBILE_PRIMARY_TABS = Object.freeze(
  ADMIN_ROUTES
    .filter((route) => route.mobileTab)
    .sort((left, right) => left.menuOrder - right.menuOrder),
)

function cloneRoute(route) {
  return route ? freezeRoute({ ...route }) : null
}

export function getAdminRoute(view) {
  if (typeof view !== 'string' || view.length === 0) return null
  return cloneRoute(ROUTES_BY_VIEW.get(view))
}

export function normalizeAdminView(view) {
  const route = getAdminRoute(view)
  return route?.normalizeTo || route?.view || 'home'
}

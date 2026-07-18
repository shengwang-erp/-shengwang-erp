import { canAccessView, getVisibleAdminRoutes } from '../../auth/businessAccess.js'
import { getAdminRoute } from '../../navigation/adminRoutes.js'
import { isHiddenSystemEmployee, isSuperAdmin } from '../../utils/permissions.js'

const authorizedHomeModels = new WeakSet()

const SOURCE_BY_VIEW = Object.freeze({
  projects: 'projects',
  employees: 'employees',
  stockOut: 'stockOutRecords',
  stockReturn: 'stockReturnRecords',
  labor: 'attendance',
  purchase: 'purchaseSummary',
  vehicle: 'vehicles',
  toolBorrow: 'toolBorrowRecords',
  accounting: 'costSummary',
})

const STATIC_DISPLAY_BY_VIEW = Object.freeze({
  dashboard: '查看',
  todayAttendance: '进入',
  settings: '管理',
})

function ownValue(value, key) {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

export function buildUnavailableHomeFinancialState(states = []) {
  const candidates = Array.isArray(states) ? states : []
  if (candidates.some((state) => ownValue(state, 'status') === 'error')) {
    return Object.freeze({ status: 'error', data: null, stale: false })
  }
  if (candidates.some((state) => ownValue(state, 'status') === 'loading')) {
    return Object.freeze({ status: 'loading', data: null, stale: false })
  }
  if (candidates.some((state) =>
    ownValue(state, 'status') === 'ready' && ownValue(state, 'stale') === true)) {
    return Object.freeze({ status: 'ready', data: null, stale: true })
  }
  return Object.freeze({ status: 'forbidden', data: null, stale: false })
}

function arrayStateData(state) {
  const data = ownValue(state, 'data')
  return ownValue(state, 'status') === 'ready' && ownValue(state, 'stale') !== true &&
    Array.isArray(data) ? data : null
}

function objectStateData(state) {
  const data = ownValue(state, 'data')
  return ownValue(state, 'status') === 'ready' && ownValue(state, 'stale') !== true &&
    data !== null && typeof data === 'object' && !Array.isArray(data) ? data : null
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null
}

function formatYen(value) {
  return `¥${value.toLocaleString('ja-JP')}`
}

function canonicalAuthorizedRoutes(user, routes) {
  const candidates = Array.isArray(routes) ? routes : getVisibleAdminRoutes(user)
  const seen = new Set()
  const result = []
  for (const candidate of candidates) {
    const route = getAdminRoute(ownValue(candidate, 'view'))
    if (
      !route || !route.desktop || route.view === 'home' || seen.has(route.view) ||
      !canAccessView(user, route.view)
    ) continue
    seen.add(route.view)
    result.push(route)
  }
  return result
}

function unavailablePresentation(state) {
  if (ownValue(state, 'status') === 'ready' && ownValue(state, 'stale') === true) {
    return { status: 'ready', stale: true, displayValue: '数据过期' }
  }
  const status = ownValue(state, 'status')
  if (status === undefined || status === 'loading') {
    return { status: 'loading', stale: false, displayValue: '读取中' }
  }
  if (status === 'forbidden') return { status: 'forbidden', displayValue: '权限受限' }
  return { status: 'error', displayValue: '读取失败' }
}

function projectPresentation(state) {
  const rows = arrayStateData(state)
  if (rows === null) return unavailablePresentation(state)
  return { status: 'ready', displayValue: String(rows.length), badgeCount: rows.length, rows }
}

function employeePresentation(state) {
  const rows = arrayStateData(state)
  if (rows === null) return unavailablePresentation(state)
  const count = rows.filter((employee) =>
    employee !== null && typeof employee === 'object' &&
    !isHiddenSystemEmployee(employee) && ownValue(employee, 'employmentStatus') === '在职').length
  return { status: 'ready', displayValue: String(count), badgeCount: count, rows }
}

function recordPresentation(state) {
  const rows = arrayStateData(state)
  if (rows === null) return unavailablePresentation(state)
  return { status: 'ready', displayValue: String(rows.length), badgeCount: rows.length, rows }
}

function accountingPresentation(state, view) {
  const model = objectStateData(state)
  if (model === null) return unavailablePresentation(state)
  const value = view === 'accounting'
    ? ownValue(ownValue(model, 'companyMonthlyTotal'), 'total')
    : ownValue(ownValue(model, 'summary'), 'monthPurchaseCost')
  const amount = safeNonNegativeInteger(value)
  return amount === null
    ? { status: 'error', displayValue: '读取失败' }
    : { status: 'ready', displayValue: formatYen(amount), badgeCount: 0, amount }
}

function presentationFor(view, state) {
  if (view === 'projects') return projectPresentation(state)
  if (view === 'employees') return employeePresentation(state)
  if (view === 'accounting' || view === 'purchase') {
    return accountingPresentation(state, view)
  }
  return recordPresentation(state)
}

function freezeModel(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeModel(child)
  return Object.freeze(value)
}

export function buildAuthorizedHomeModel({ user, routes, sourceStates } = {}) {
  const authorizedRoutes = canonicalAuthorizedRoutes(user, routes)
  const modules = []
  const sourceNotices = []
  let projectRows = null
  let authorizedRecordCount = 0
  let hasReadyRecordSource = false

  for (const route of authorizedRoutes) {
    const sourceKey = SOURCE_BY_VIEW[route.view]
    if (!sourceKey) {
      modules.push({
        view: route.view,
        label: route.label,
        iconText: route.iconText,
        badgeCount: 0,
        displayValue: STATIC_DISPLAY_BY_VIEW[route.view] || '进入',
        sourceStatus: 'ready',
      })
      continue
    }

    const state = ownValue(sourceStates, sourceKey)
    const presentation = presentationFor(route.view, state)
    const badgeCount = safeNonNegativeInteger(presentation.badgeCount) || 0
    modules.push({
      view: route.view,
      label: route.label,
      iconText: route.iconText,
      badgeCount,
      displayValue: presentation.displayValue,
      sourceStatus: presentation.status,
      sourceStale: presentation.stale === true,
      numericAmount: safeNonNegativeInteger(presentation.amount),
    })

    if (presentation.status !== 'ready' || presentation.stale === true) {
      sourceNotices.push({
        view: route.view,
        label: route.label,
        status: presentation.status,
        stale: presentation.stale === true,
        message: presentation.stale === true
          ? `${route.label}数据可能已过期`
          : presentation.status === 'loading'
            ? `${route.label}数据正在读取`
            : presentation.status === 'forbidden'
              ? `${route.label}数据权限受限`
              : `${route.label}数据读取失败`,
      })
      if (presentation.stale === true) continue
      continue
    }

    if (route.view === 'projects') projectRows = presentation.rows
    if (['stockOut', 'stockReturn', 'labor', 'vehicle', 'toolBorrow'].includes(route.view)) {
      authorizedRecordCount += badgeCount
      hasReadyRecordSource = true
    }
  }

  const overview = []
  if (projectRows !== null) {
    overview.push({
      key: 'active-projects',
      label: '进行中项目',
      value: projectRows.filter((project) => ownValue(project, 'status') === '进行中').length,
    })
  }
  if (hasReadyRecordSource) {
    overview.push({ key: 'authorized-records', label: '已授权业务记录', value: authorizedRecordCount })
  }
  if (projectRows !== null) {
    overview.push({
      key: 'paused-projects',
      label: '暂停项目',
      value: projectRows.filter((project) => ownValue(project, 'status') === '暂停').length,
    })
  }

  const moduleByView = new Map(modules.map((module) => [module.view, module]))
  const moduleCount = (view) => moduleByView.get(view)?.sourceStatus === 'ready' &&
      moduleByView.get(view)?.sourceStale !== true
    ? moduleByView.get(view).badgeCount
    : 0
  const numericAmount = (view) => moduleByView.get(view)?.sourceStatus === 'ready' &&
      moduleByView.get(view)?.sourceStale !== true &&
      Number.isSafeInteger(moduleByView.get(view)?.numericAmount)
    ? moduleByView.get(view).numericAmount
    : null
  const summary = {
    activeProjects: projectRows === null ? 0 : projectRows
      .filter((project) => ownValue(project, 'status') === '进行中').length,
    activeEmployees: moduleCount('employees'),
    totalRecords: authorizedRecordCount,
    pausedProjects: projectRows === null ? 0 : projectRows
      .filter((project) => ownValue(project, 'status') === '暂停').length,
    monthlyPurchaseTotal: numericAmount('purchase'),
    monthlyCostTotal: numericAmount('accounting'),
    moduleCounts: {
      projects: moduleCount('projects'),
      employees: moduleCount('employees'),
      stockOut: moduleCount('stockOut'),
      stockReturn: moduleCount('stockReturn'),
      labor: moduleCount('labor'),
      vehicle: moduleCount('vehicle'),
      toolBorrow: moduleCount('toolBorrow'),
    },
  }

  const model = freezeModel({
    viewer: {
      name: ownValue(user, 'name') || '',
      department: ownValue(user, 'department') || '',
      position: ownValue(user, 'position') || '',
      isSuperAdmin: isSuperAdmin(user),
    },
    overview,
    modules,
    sourceNotices,
    summary,
  })
  authorizedHomeModels.add(model)
  return model
}

export function getAuthorizedHomeSummary(model) {
  return model !== null && typeof model === 'object' && authorizedHomeModels.has(model)
    ? model.summary
    : null
}

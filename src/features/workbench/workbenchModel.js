import {
  canAccessView,
  getDashboardAccess,
  getVisibleAdminRoutes,
} from '../../auth/businessAccess.js'
import { getAdminRoute } from '../../navigation/adminRoutes.js'

const authorizedMessageCollections = new WeakSet()

function ownValue(value, key) {
  if (value === null || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function safeBadgeCount(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

export function buildWorkbenchItems({ user, counts = {} } = {}) {
  const visibleRoutes = getVisibleAdminRoutes(user)
  return Object.freeze(visibleRoutes
    .filter((route) => route.view !== 'home')
    .map((route) => Object.freeze({
      view: route.view,
      label: route.label,
      iconText: route.iconText,
      badgeCount: safeBadgeCount(ownValue(counts, route.view)),
    })))
}

function messageRows(alerts) {
  if (Array.isArray(alerts)) return alerts
  if (
    ownValue(alerts, 'status') === 'ready' &&
    ownValue(alerts, 'stale') !== true &&
    Array.isArray(ownValue(alerts, 'data'))
  ) return ownValue(alerts, 'data')
  return []
}

function safeMessageString(value, fallback = '') {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim().slice(0, 240)
    : fallback
}

const MESSAGE_SEVERITIES = new Set(['info', 'warning', 'danger', 'error'])

function alertGate(type, dashboard) {
  if (type === 'attendance_exception') {
    return {
      visible: ownValue(ownValue(dashboard, 'attendance'), 'view') === true,
      amount: false,
      targetView: 'labor',
    }
  }
  if (type === 'labor_pending') {
    const labor = ownValue(dashboard, 'labor')
    return {
      visible: ownValue(labor, 'view') === true,
      amount: ownValue(labor, 'amounts') === true,
      targetView: 'labor',
    }
  }
  if (type === 'purchase_payable' || type === 'purchase_anomaly') {
    const purchase = ownValue(dashboard, 'purchase')
    return {
      visible: ownValue(purchase, 'accrual') === true,
      amount: type === 'purchase_payable' && ownValue(purchase, 'payable') === true,
      targetView: 'purchase',
    }
  }
  if (type === 'unbound_project_fact' || type === 'pending_manual_cost') {
    const visible = ownValue(ownValue(dashboard, 'costCategories'), 'manualSupplement') === true
    return {
      visible,
      amount: type === 'pending_manual_cost' && visible,
      targetView: 'accounting',
    }
  }
  if (type === 'vehicle_issue') {
    const vehicle = ownValue(dashboard, 'vehicle')
    return {
      visible: ownValue(vehicle, 'view') === true,
      amount: ownValue(vehicle, 'amounts') === true,
      targetView: 'vehicle',
    }
  }
  if (type === 'tool_responsibility') {
    const tools = ownValue(dashboard, 'tools')
    return {
      visible: ownValue(tools, 'view') === true,
      amount: ownValue(tools, 'amounts') === true,
      targetView: 'toolBorrow',
    }
  }
  if (type === 'missing_profit_anchor' || type === 'over_receipt') {
    const contracts = ownValue(dashboard, 'contracts')
    return {
      visible: ownValue(contracts, 'view') === true,
      amount: type === 'over_receipt' && ownValue(contracts, 'amounts') === true,
      targetView: 'contractRevenue',
    }
  }
  return { visible: type === 'source_issue', amount: false, targetView: null }
}

export function buildAuthorizedMessages({ access, alerts } = {}) {
  const user = ownValue(access, 'user')
  const dashboard = getDashboardAccess(user)
  if (ownValue(dashboard, 'page') !== true || !canAccessView(user, 'messages')) {
    return Object.freeze([])
  }

  const messages = []
  for (const alert of messageRows(alerts)) {
    if (alert === null || typeof alert !== 'object' || Array.isArray(alert)) continue
    const type = ownValue(alert, 'type')
    const gate = alertGate(type, dashboard)
    if (!gate.visible) continue

    const rawTarget = ownValue(alert, 'targetView')
    const rawCanNavigate = ownValue(alert, 'canNavigate')
    let targetView = null
    let canNavigate = false
    if (type === 'source_issue') {
      if (rawTarget !== null || rawCanNavigate !== false) continue
    } else {
      if (typeof rawTarget !== 'string' || rawTarget.length === 0 || rawCanNavigate !== true) {
        continue
      }
      const route = getAdminRoute(rawTarget)
      if (
        !route ||
        route.view !== gate.targetView ||
        !canAccessView(user, route.view)
      ) continue
      targetView = route.view
      canNavigate = true
    }

    const id = safeMessageString(ownValue(alert, 'id'))
    const title = safeMessageString(ownValue(alert, 'title'))
    const summary = safeMessageString(
      ownValue(alert, 'summary'),
      safeMessageString(ownValue(alert, 'reason')),
    )
    if (!id || !title || !summary) continue

    const rawCount = ownValue(alert, 'count')
    const rawSeverity = ownValue(alert, 'severity')
    const rawAmount = gate.amount && canNavigate ? ownValue(alert, 'amount') : null
    messages.push(Object.freeze({
      id,
      severity: MESSAGE_SEVERITIES.has(rawSeverity) ? rawSeverity : 'info',
      title,
      summary,
      count: Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : 1,
      amount: Number.isSafeInteger(rawAmount) && rawAmount >= 0 ? rawAmount : null,
      targetView,
      canNavigate,
    }))
  }
  const projection = Object.freeze(messages)
  authorizedMessageCollections.add(projection)
  return projection
}

export function countAuthorizedMessageBadges(messages) {
  if (!Array.isArray(messages) || !authorizedMessageCollections.has(messages)) return 0
  return messages.reduce((total, message) => {
    const count = ownValue(message, 'count')
    return total + (Number.isSafeInteger(count) && count > 0 ? count : 0)
  }, 0)
}

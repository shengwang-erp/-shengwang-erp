import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import { ADMIN_ROUTES } from '../../navigation/adminRoutes.js'

async function read(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  if (start < 0) return ''
  const end = source.indexOf(endMarker, start + startMarker.length)
  return end < 0 ? '' : source.slice(start, end)
}

function extractBraceBlock(source, marker) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return ''
  const start = source.indexOf('{', markerIndex + marker.length)
  if (start < 0) return ''
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(markerIndex, index + 1)
  }
  return ''
}

async function loadRuntimeModules() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    plugins: [{
      name: 'labor-app-leaflet-ssr-stub',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0labor-app-leaflet-ssr-stub' : null
      },
      load(id) {
        return id === '\0labor-app-leaflet-ssr-stub'
          ? 'export default { icon: () => ({}) }'
          : null
      },
      transform(code, id) {
        if (!id.endsWith('/src/App.jsx')) return null
        return code
          .replace('function markLaborBridgeRetry(', 'export function markLaborBridgeRetry(')
          .replace(
            'function shouldRefreshLaborBridgeRequest(',
            'export function shouldRefreshLaborBridgeRequest(',
          )
          .replace(
            'function consumeLaborBridgeRetry(',
            'export function consumeLaborBridgeRetry(',
          )
      },
    }],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true },
  })
  try {
    const [hook, shell, app] = await Promise.all([
      server.ssrLoadModule('/src/features/labor-accounting/useLaborAlertCount.js')
        .then((module) => ({ module, error: null }))
        .catch((error) => ({ module: null, error })),
      server.ssrLoadModule('/src/DesktopAdminShell.jsx')
        .then((module) => ({ module, error: null }))
        .catch((error) => ({ module: null, error })),
      server.ssrLoadModule('/src/App.jsx')
        .then((module) => ({ module, error: null }))
        .catch((error) => ({ module: null, error })),
    ])
    return { hook, shell, app }
  } finally {
    await server.close()
  }
}

const [appSource, shellSource, hookSource] = await Promise.all([
  read('../../App.jsx'),
  read('../../DesktopAdminShell.jsx'),
  read('./useLaborAlertCount.js'),
])
const authenticatedApp = sliceBetween(appSource, 'function AuthenticatedApp', '\nfunction HomePage')
const runtime = await loadRuntimeModules()

test('labor alert eligibility uses only actor identity and exact effective permission keys', () => {
  assert.ifError(runtime.hook.error)
  const { canRequestLaborAlertCount, hasLaborViewPermission } = runtime.hook.module

  assert.equal(hasLaborViewPermission(['module.labor.view']), true)
  assert.equal(hasLaborViewPermission(['all']), true)
  assert.equal(hasLaborViewPermission(['module.labor.update']), false)
  assert.equal(hasLaborViewPermission(['人工记录']), false)
  assert.equal(hasLaborViewPermission(undefined), false)

  assert.equal(canRequestLaborAlertCount({
    actorKey: 'user-a',
    effectivePermissionKeys: ['module.labor.view'],
  }), true)
  assert.equal(canRequestLaborAlertCount({
    actorKey: '',
    effectivePermissionKeys: ['module.labor.view'],
  }), false)
  assert.equal(canRequestLaborAlertCount({
    actorKey: 'user-a',
    effectivePermissionKeys: [],
    role: 'super_admin',
    employeeNumber: 'SW-000',
  }), false)
})

test('labor alert raw state distinguishes initial, ready, and stale failure snapshots', () => {
  assert.ifError(runtime.hook.error)
  const { applyLaborAlertRefreshResult, createLaborAlertState } = runtime.hook.module

  const initial = createLaborAlertState()
  assert.deepEqual(initial, {
    count: 0,
    stale: false,
    loading: true,
    error: '',
    code: '',
    source: 'labor-alert-service',
    updatedAt: null,
  })
  const successful = applyLaborAlertRefreshResult(initial, {
    ok: true,
    count: 3,
    updatedAt: '2026-07-17T01:02:03.000Z',
  })
  assert.deepEqual(successful, {
    count: 3,
    stale: false,
    loading: false,
    error: '',
    code: '',
    source: 'labor-alert-service',
    updatedAt: '2026-07-17T01:02:03.000Z',
  })
  assert.deepEqual(
    applyLaborAlertRefreshResult(successful, {
      ok: false,
      code: 'DATA_OPERATION_FAILED',
      message: '正式考勤提醒读取失败',
    }),
    {
      count: 3,
      stale: true,
      loading: false,
      error: '正式考勤提醒读取失败',
      code: 'DATA_OPERATION_FAILED',
      source: 'labor-alert-service',
      updatedAt: '2026-07-17T01:02:03.000Z',
    },
  )
  assert.deepEqual(
    applyLaborAlertRefreshResult(successful, {
      ok: true,
      count: 1,
      updatedAt: '2026-07-17T02:03:04.000Z',
    }),
    {
      count: 1,
      stale: false,
      loading: false,
      error: '',
      code: '',
      source: 'labor-alert-service',
      updatedAt: '2026-07-17T02:03:04.000Z',
    },
  )
})

test('alert hook owns immediate, focus, five-minute, cleanup, and latest-generation lifecycle', () => {
  assert.match(hookSource, /laborAccountingService/u)
  assert.match(hookSource, /service\.getAlertCount\(\)/u)
  assert.match(hookSource, /LABOR_ALERT_POLL_INTERVAL_MS\s*=\s*300000/u)
  assert.match(hookSource, /void refresh\(\)/u)
  assert.match(hookSource, /addEventListener\('focus',\s*handleFocus\)/u)
  assert.match(hookSource, /setIntervalFn\([\s\S]*?LABOR_ALERT_POLL_INTERVAL_MS/u)
  assert.match(hookSource, /removeEventListener\('focus',\s*handleFocus\)/u)
  assert.match(hookSource, /clearIntervalFn\(timerId\)/u)
  assert.match(hookSource, /generationRef\.current\s*\+=\s*1/u)
  assert.match(hookSource, /generation\s*!==\s*generationRef\.current/u)
  assert.match(hookSource, /actorKey/u)
  assert.match(hookSource, /permissionFingerprint/u)
  assert.match(hookSource, /error\?\.authInvalid\s*===\s*true/u)
  assert.doesNotMatch(hookSource, /localStorage|\.from\(|console\.|employeeNumber|SW-000|\brole\b|position|department/u)
})

test('App wires one server-identity alert hook and routes labor to the accounting page', () => {
  assert.match(
    appSource,
    /import LaborAccountingPage from '.\/features\/labor-accounting\/LaborAccountingPage\.jsx'/u,
  )
  assert.match(
    appSource,
    /import useLaborAlertCount from '.\/features\/labor-accounting\/useLaborAlertCount\.js'/u,
  )
  assert.equal((authenticatedApp.match(/useLaborAlertCount\(/gu) || []).length, 1)
  assert.match(
    authenticatedApp,
    /useLaborAlertCount\(\{[\s\S]*?actorKey:\s*activeActorId[\s\S]*?effectivePermissionKeys:\s*activePermissionKeys[\s\S]*?onAuthInvalid:\s*onLogout[\s\S]*?\}\)/u,
  )
  assert.match(authenticatedApp, /laborAlertCount=\{laborAlertCount\}/u)
  assert.match(authenticatedApp, /laborAlertStale=\{laborAlertStale\}/u)
  assert.doesNotMatch(authenticatedApp, /laborAlert:\s*projectLaborSource/u)
  assert.match(
    authenticatedApp,
    /attendance:\s*projectPersistentSource\(laborRawState,[\s\S]*?readAllowed:\s*dashboardAccess\.attendance\.view/u,
  )

  const route = extractBraceBlock(authenticatedApp, "if (authorizedView === 'labor')")
  assert.match(route, /<LaborAccountingPage/u)
  assert.doesNotMatch(route, /<LaborPage/u)
  assert.match(route, /currentUser=\{currentUser\}/u)
  assert.match(route, /onBack=\{\(\) => handlePersonnelAwareNavigate\('home'\)\}/u)
  assert.match(route, /onAuthInvalid=\{onLogout\}/u)
  assert.match(route, /onAlertCountChange=\{refreshLaborAlertCount\}/u)
  assert.doesNotMatch(route, /handlePersonnelAwareLogout/u)
})

test('desktop shell renders an accessible badge only for positive labor alerts', () => {
  assert.ifError(runtime.shell.error)
  const currentUser = {
    id: 'user-a',
    employeeId: 'E-LABOR',
    employeeNumber: 'SW-123',
    name: '会计测试员',
    department: '会计',
    position: '会计',
    employmentStatus: '在职',
    accountStatus: 'active',
    mustChangePassword: false,
    effectivePermissionKeys: ['all'],
  }
  const renderShell = (props) => renderToStaticMarkup(createElement(
    runtime.shell.module.default,
    {
      currentView: 'home',
      currentUser,
      onNavigate() {},
      onLogout() {},
      ...props,
    },
    createElement('div', null, 'page'),
  ))

  const positiveMarkup = renderShell({ laborAlertCount: 3 })
  const positiveMenu = sliceBetween(positiveMarkup, '<nav', '</nav>')
  assert.match(positiveMenu, /aria-label="人工记录，3 条待处理"/u)
  assert.equal((positiveMenu.match(/data-labor-alert-badge/gu) || []).length, 1)
  assert.match(positiveMenu, /data-labor-alert-badge[^>]*>3<\/em>/u)

  const zeroMenu = sliceBetween(renderShell({ laborAlertCount: 0 }), '<nav', '</nav>')
  assert.doesNotMatch(zeroMenu, /data-labor-alert-badge|条待处理/u)
  assert.match(zeroMenu, />人工记录<\/strong>/u)

  const staleMenu = sliceBetween(
    renderShell({ laborAlertCount: 3, laborAlertStale: true }), '<nav', '</nav>',
  )
  assert.match(staleMenu, /aria-label="人工记录，3 条待处理，数据可能已过期"/u)
  assert.match(staleMenu, /title="人工记录：3 条待处理（数据可能已过期）"/u)
})

test('shell integration keeps the fourteen-route menu contract and avoids CSS mutation', () => {
  assert.equal(ADMIN_ROUTES.filter(({ desktop }) => desktop).length, 14)
  assert.match(shellSource, /getVisibleAdminRoutes\(currentUser\)/u)
  assert.doesNotMatch(shellSource, /desktopMenuItems/u)
  assert.match(shellSource, /laborAlertCount\s*=\s*0/u)
  assert.match(shellSource, /laborAlertStale\s*=\s*false/u)
  assert.match(shellSource, /item\.view\s*===\s*'labor'/u)
  assert.match(shellSource, /<strong>[\s\S]*?<em[\s\S]*?data-labor-alert-badge/u)
  assert.doesNotMatch(shellSource, /import\s+['"].*styles\.css/u)
})

test('App loads one twelve-month labor window plus the actual current cumulative snapshot', () => {
  assert.match(
    appSource,
    /import \{ laborAccountingService \} from '.\/services\/laborAccountingService\.js'/u,
  )
  assert.match(
    appSource,
    /import \{ createDashboardLaborBridgeLoader \} from '.\/services\/dashboardLaborBridgeService\.js'/u,
  )
  assert.match(
    appSource,
    /import \{[\s\S]*?canRequestLaborAccountingBridge[\s\S]*?normalizeBridgeSummary[\s\S]*?\} from '.\/features\/labor-accounting\/laborAccountingBridge\.js'/u,
  )
  assert.match(
    appSource,
    /import \{ buildLaborCostWindow \} from '.\/features\/cost-accounting\/laborCostWindow\.js'/u,
  )
  assert.match(
    authenticatedApp,
    /const \[accountingMonth, setAccountingMonth\] = useState\(currentMonthValue\(\)\)/u,
  )
  assert.match(
    authenticatedApp,
    /bridgeTargetActive\s*=\s*\['home', 'accounting', 'dashboard', 'projects'\]\.includes\(authorizedView\)/u,
  )
  assert.match(
    authenticatedApp,
    /bridgeRequestedMonth\s*=\s*authorizedView === 'accounting'[\s\S]*?accountingMonth[\s\S]*?authorizedView === 'dashboard'[\s\S]*?dashboardQuery\.selectedMonth[\s\S]*?currentMonthValue\(\)/u,
  )
  assert.match(
    authenticatedApp,
    /canRequestLaborAccountingBridge\(\{[\s\S]*?actorKey:\s*activeActorId[\s\S]*?effectivePermissionKeys:\s*activePermissionKeys[\s\S]*?\}\)/u,
  )
  assert.match(
    authenticatedApp,
    /laborBridgeLoaderRef\.current\.load\(\{[\s\S]*?actorScope:\s*bridgeActorScope[\s\S]*?endMonth:\s*bridgeRequestedMonth[\s\S]*?length:\s*12[\s\S]*?snapshotMonth:\s*bridgeSnapshotMonth[\s\S]*?signal:\s*abortController\.signal/u,
  )
  assert.equal(
    (authenticatedApp.match(/laborBridgeLoaderRef\.current\.load\(/gu) || []).length,
    1,
  )

  const bridgeEligibilitySource = sliceBetween(
    authenticatedApp,
    'const bridgeTargetActive',
    'const bridgeRequestedMonth',
  )
  assert.doesNotMatch(
    bridgeEligibilitySource,
    /role|employeeNumber|SW-000|department|position|isSuperAdmin/u,
  )
  assert.match(authenticatedApp, /const bridgeSnapshotMonth = currentMonthValue\(\)/u)
  assert.match(authenticatedApp, /buildLaborCostWindow\(\{/u)
  assert.match(authenticatedApp, /snapshotMonth:\s*bridgeSnapshotMonth/u)
})

test('bridge request lifecycle fences actor, sorted permissions, view, window, snapshot, and generation', () => {
  assert.match(authenticatedApp, /bridgeRequestGenerationRef\s*=\s*useRef\(0\)/u)
  assert.match(authenticatedApp, /bridgeRequestIdentityRef\s*=\s*useRef/u)
  assert.match(authenticatedApp, /bridgeRequestIdentityRef\.current\s*=\s*bridgeRequestIdentity/u)
  assert.match(authenticatedApp, /generation\s*!==\s*bridgeRequestGenerationRef\.current/u)
  assert.match(authenticatedApp, /bridgeRequestIdentityRef\.current\s*!==\s*requestIdentity/u)
  assert.match(authenticatedApp, /active\s*===\s*false/u)
  assert.match(authenticatedApp, /result\.snapshotMonth\s*!==\s*bridgeSnapshotMonth/u)
  assert.match(authenticatedApp, /result\.windowStatus/u)
  assert.match(authenticatedApp, /identity:\s*requestIdentity/u)
  assert.match(
    authenticatedApp,
    /laborBridgeState\.identity === bridgeRequestIdentity &&[\s\S]*?laborBridgeState\.endMonth === bridgeRequestedMonth/u,
  )
  assert.match(authenticatedApp, /setBridgeRetryToken\(\(value\) => value \+ 1\)/u)
  assert.match(authenticatedApp, /const abortController = new AbortController\(\)/u)
  assert.match(authenticatedApp, /abortController\.abort\(\)/u)
  assert.match(authenticatedApp, /bridgeActorScope/u)
  assert.match(authenticatedApp, /previousBridgeActorScopeRef/u)
  assert.match(
    authenticatedApp,
    /previousActorScope[\s\S]*?previousActorScope !== bridgeActorScope[\s\S]*?laborBridgeLoaderRef\.current\.clear\(previousActorScope\)/u,
  )
  const scope = sliceBetween(authenticatedApp, 'const bridgeActorScope', '\n  const bridgeRequestIdentity')
  assert.match(scope, /activeActorId/u)
  assert.match(scope, /bridgePermissionFingerprint/u)
  assert.doesNotMatch(scope, /currentUser\.name|employeeName|viewerName/u)
})

test('manual bridge refresh targets one identity and survives Strict Effects until current settlement', () => {
  assert.ifError(runtime.app.error)
  const {
    markLaborBridgeRetry,
    shouldRefreshLaborBridgeRequest,
    consumeLaborBridgeRetry,
  } = runtime.app.module
  const targetRef = { current: '' }
  const julyIdentity = 'tenant-1:E-1:2026-07'
  const augustIdentity = 'tenant-1:E-1:2026-08'

  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, julyIdentity), false)
  markLaborBridgeRetry(targetRef, julyIdentity)
  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, julyIdentity), true)
  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, julyIdentity), true)

  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, augustIdentity), false)
  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, julyIdentity), false)

  markLaborBridgeRetry(targetRef, augustIdentity)
  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, augustIdentity), true)
  consumeLaborBridgeRetry(targetRef, augustIdentity)
  assert.equal(shouldRefreshLaborBridgeRequest(targetRef, augustIdentity), false)
})

test('forbidden labor, salary, or project-cost access cannot invoke the loader', () => {
  const bridgeEffect = sliceBetween(
    authenticatedApp,
    '  useEffect(() => {\n    const generation = bridgeRequestGenerationRef.current + 1',
    '\n  }, [\n    bridgeEligible,',
  )
  const deniedIndex = bridgeEffect.indexOf('if (!bridgeTargetActive || !bridgeEligible)')
  const loadIndex = bridgeEffect.indexOf('laborBridgeLoaderRef.current.load(')

  assert.ok(deniedIndex >= 0, 'expected denied branch')
  assert.ok(loadIndex > deniedIndex, 'loader must follow the denied early return')
  assert.match(bridgeEffect, /if \(!bridgeTargetActive \|\| !bridgeEligible\) \{[\s\S]*?return \(\) => \{[\s\S]*?\}[\s\S]*?\}/u)
  assert.doesNotMatch(
    bridgeEffect.slice(deniedIndex, loadIndex),
    /\.load\(|getBridgeSummary\(/u,
  )
  assert.match(
    authenticatedApp,
    /canRequestLaborAccountingBridge\(\{[\s\S]*?effectivePermissionKeys:\s*activePermissionKeys/u,
  )
})

test('actor or effective-permission changes abort work and clear only the previous actor cache', () => {
  const scopeEffect = sliceBetween(
    authenticatedApp,
    '  useEffect(() => {\n    const previousActorScope = previousBridgeActorScopeRef.current',
    '\n  }, [bridgeActorScope])',
  )
  assert.match(scopeEffect, /if \(previousActorScope && previousActorScope !== bridgeActorScope\)/u)
  assert.match(scopeEffect, /laborBridgeLoaderRef\.current\.clear\(previousActorScope\)/u)
  assert.match(scopeEffect, /previousBridgeActorScopeRef\.current = bridgeActorScope/u)
  assert.doesNotMatch(scopeEffect, /\.clear\(bridgeActorScope\)/u)

  const requestIdentity = sliceBetween(
    authenticatedApp,
    '  const bridgeRequestIdentity = ',
    '\n  const bridgeRequestIdentityRef',
  )
  assert.match(requestIdentity, /bridgeActorScope/u)
  assert.match(requestIdentity, /bridgeRequestedMonth/u)
  assert.match(requestIdentity, /bridgeSnapshotMonth/u)
  assert.doesNotMatch(requestIdentity, /currentUser\.name|employeeName|viewerName/u)
})

test('accounting month is controlled by AuthenticatedApp and the shared labor source stays visible and retryable', () => {
  const accountingPage = sliceBetween(appSource, 'function AccountingCostPage', '\nfunction SalaryRecordsSection')
  const monthlySummary = sliceBetween(appSource, 'function MonthlySummarySection', '\nfunction AccountingRecordList')

  assert.match(authenticatedApp, /monthFilter=\{accountingMonth\}/u)
  assert.match(authenticatedApp, /onMonthFilterChange=\{handleAccountingMonthChange\}/u)
  assert.match(
    authenticatedApp,
    /handleAccountingMonthChange[\s\S]*?if \(!isLaborAccountingMonth\(nextMonth\)\) return[\s\S]*?setAccountingMonth\(nextMonth\)/u,
  )
  assert.match(accountingPage, /monthFilter/u)
  assert.match(accountingPage, /onMonthFilterChange/u)
  assert.match(
    accountingPage,
    /<MonthlySummarySection[\s\S]*?monthFilter=\{monthFilter\}[\s\S]*?onMonthFilterChange=\{onMonthFilterChange\}/u,
  )
  assert.doesNotMatch(monthlySummary, /useState\(currentMonthValue\(\)\)/u)
  assert.match(
    monthlySummary,
    /<Field label="统计月份" type="month" value=\{monthFilter\} onChange=\{onMonthFilterChange\}/u,
  )

  assert.match(appSource, /正式核算正在加载/u)
  assert.match(appSource, /正式核算暂不可用/u)
  assert.match(appSource, /上次正式核算数据/u)
  assert.match(appSource, /尚未启用正式核算，当前为历史估算/u)
  assert.match(appSource, /待确认/u)
  assert.match(appSource, /onRetry/u)
})

test('bridge errors use alert semantics and auth invalidation callback failures stay isolated', () => {
  const notice = sliceBetween(appSource, 'function LaborBridgeStatusNotice', '\nexport function resolveAuthorizedView')
  const notifier = sliceBetween(appSource, 'function notifyBridgeAuthInvalid', '\nfunction LaborBridgeStatusNotice')
  const loaderFactory = sliceBetween(
    authenticatedApp,
    'laborBridgeLoaderRef.current = createDashboardLaborBridgeLoader({',
    '\n  const previousBridgeActorScopeRef',
  )
  const bridgeEffect = sliceBetween(
    authenticatedApp,
    '  useEffect(() => {\n    const generation = bridgeRequestGenerationRef.current + 1',
    '\n  }, [\n    bridgeEligible,',
  )

  assert.match(notice, /role=\{state\.error \? 'alert' : 'status'\}/u)
  assert.match(notice, /aria-live=\{state\.error \? 'assertive' : 'polite'\}/u)
  assert.match(notifier, /try \{/u)
  assert.match(notifier, /const result = callback\(error\)/u)
  assert.match(notifier, /void result\.catch\(\(\) => \{\}\)/u)
  assert.match(notifier, /catch \{/u)
  assert.doesNotMatch(loaderFactory, /notifyBridgeAuthInvalid/u)
  assert.equal((bridgeEffect.match(/notifyBridgeAuthInvalid\(onLogout, error\)/gu) || []).length, 1)
  assert.ok(
    bridgeEffect.indexOf("if (error?.name === 'AbortError') return") <
      bridgeEffect.indexOf('notifyBridgeAuthInvalid(onLogout, error)'),
  )
  assert.doesNotMatch(authenticatedApp, /if \(error\?\.authInvalid === true\) onLogout\(\)/u)
})

test('App consumes retry refresh only after the current identity settles', () => {
  const bridgeEffect = sliceBetween(
    authenticatedApp,
    '  useEffect(() => {\n    const generation = bridgeRequestGenerationRef.current + 1',
    '\n  }, [\n    bridgeEligible,',
  )
  const currentGuardIndex = bridgeEffect.indexOf('if (!isCurrentRequest()) return')
  const consumeIndex = bridgeEffect.indexOf(
    'consumeLaborBridgeRetry(bridgeRetryTargetIdentityRef, requestIdentity)',
  )

  assert.match(
    authenticatedApp,
    /markLaborBridgeRetry\(bridgeRetryTargetIdentityRef, bridgeRequestIdentityRef\.current\)[\s\S]*?setBridgeRetryToken/u,
  )
  assert.match(
    bridgeEffect,
    /const refreshBridgeRequest = shouldRefreshLaborBridgeRequest\([\s\S]*?bridgeRetryTargetIdentityRef,[\s\S]*?requestIdentity,[\s\S]*?\)/u,
  )
  assert.match(bridgeEffect, /refresh:\s*refreshBridgeRequest/u)
  assert.ok(currentGuardIndex >= 0)
  assert.ok(consumeIndex > currentGuardIndex)
  assert.doesNotMatch(bridgeEffect, /refresh:\s*bridgeRetryToken\s*>\s*0/u)
  assert.doesNotMatch(
    bridgeEffect.slice(bridgeEffect.lastIndexOf('return () => {')),
    /consumeLaborBridgeRetry/u,
  )
})

test('monthly accounting and dashboard consume the projected labor window without legacy cost helpers', () => {
  const monthlySummary = sliceBetween(appSource, 'function MonthlySummarySection', '\nfunction AccountingRecordList')
  const dashboard = sliceBetween(appSource, 'function DashboardPage({', '\nfunction PageShell')
  assert.match(monthlySummary, /sourceStates\?\.laborWindow/u)
  assert.match(monthlySummary, /buildCostAccountingReadModel\(\{/u)
  assert.match(dashboard, /buildExecutiveDashboardReadModel\(\{/u)
  assert.doesNotMatch(appSource, /\bgetProjectLaborCost\b|\bgetProjectCostTotal\b/u)
})

test('legacy dashboard drilldown keeps historical facts but never presents legacy money as formal', () => {
  const movement = sliceBetween(
    appSource,
    'function LaborMovementSection',
    '\nfunction LaborMovementCard',
  )
  const movementCard = sliceBetween(
    appSource,
    'function LaborMovementCard',
    '\nfunction buildEmployeeMonthlyLaborStats',
  )

  assert.match(movement, /历史出工明细/u)
  assert.match(movement, /金额请以人工记录中的正式核算看板为准/u)
  assert.match(movement, /历史出工冲突（非考勤提醒）/u)
  assert.match(movement, /正式考勤异常请到“人工记录”看板处理/u)
  for (const ambiguousCopy of [
    '>异常记录数量<',
    'title="异常明细"',
    '>时间冲突记录数量<',
  ]) assert.doesNotMatch(movement, new RegExp(ambiguousCopy, 'u'))
  assert.doesNotMatch(movement, /formatYen\([^\n]*(?:laborCost|totalLaborCost)/u)
  assert.doesNotMatch(movementCard, /formatYen\([^\n]*laborCost/u)
  assert.doesNotMatch(movementCard, /时间冲突，请确认|工时异常，请确认/u)
  assert.match(movementCard, /非考勤提醒/u)
})

test('owner dashboard delegates authorized labor alerts through the standard dashboard model', () => {
  const dashboard = sliceBetween(appSource, 'function DashboardPage({', '\nfunction PageShell')
  assert.doesNotMatch(authenticatedApp, /<DashboardPage[\s\S]*?laborAlertCount=\{laborAlertCount\}/u)
  assert.match(dashboard, /buildExecutiveDashboardReadModel\(\{/u)
  assert.match(authenticatedApp, /attendance:\s*projectPersistentSource\(laborRawState/u)
  assert.match(authenticatedApp, /onNavigate=\{handleDashboardNavigate\}/u)
})

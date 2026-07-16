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
    server: { middlewareMode: true },
  })
  try {
    const [hook, shell] = await Promise.all([
      server.ssrLoadModule('/src/features/labor-accounting/useLaborAlertCount.js')
        .then((module) => ({ module, error: null }))
        .catch((error) => ({ module: null, error })),
      server.ssrLoadModule('/src/DesktopAdminShell.jsx')
        .then((module) => ({ module, error: null }))
        .catch((error) => ({ module: null, error })),
    ])
    return { hook, shell }
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
  assert.match(
    authenticatedApp,
    /laborAlert:\s*projectLaborSource\(\{[\s\S]*?loading:\s*laborAlertLoading[\s\S]*?error:\s*laborAlertError[\s\S]*?code:\s*laborAlertCode[\s\S]*?source:\s*laborAlertSource[\s\S]*?updatedAt:\s*laborAlertUpdatedAt[\s\S]*?\},\s*\{[\s\S]*?readAllowed:\s*laborAlertAllowed[\s\S]*?data:\s*laborAlertCount[\s\S]*?stale:\s*laborAlertStale/u,
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

test('shell integration keeps the thirteen-route menu contract and avoids CSS mutation', () => {
  assert.equal(ADMIN_ROUTES.filter(({ desktop }) => desktop).length, 13)
  assert.match(shellSource, /getVisibleAdminRoutes\(currentUser\)/u)
  assert.doesNotMatch(shellSource, /desktopMenuItems/u)
  assert.match(shellSource, /laborAlertCount\s*=\s*0/u)
  assert.match(shellSource, /laborAlertStale\s*=\s*false/u)
  assert.match(shellSource, /item\.view\s*===\s*'labor'/u)
  assert.match(shellSource, /<strong>[\s\S]*?<em[\s\S]*?data-labor-alert-badge/u)
  assert.doesNotMatch(shellSource, /import\s+['"].*styles\.css/u)
})

test('App loads the formal accounting bridge only for exact identity, permissions, views, and month', () => {
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
    authenticatedApp,
    /const \[accountingMonth, setAccountingMonth\] = useState\(currentMonthValue\(\)\)/u,
  )
  assert.match(
    authenticatedApp,
    /bridgeTargetActive\s*=\s*\['accounting', 'dashboard', 'projects'\]\.includes\(authorizedView\)/u,
  )
  assert.match(
    authenticatedApp,
    /bridgeRequestedMonth\s*=\s*authorizedView === 'accounting'[\s\S]*?accountingMonth[\s\S]*?currentMonthValue\(\)/u,
  )
  assert.match(
    authenticatedApp,
    /canRequestLaborAccountingBridge\(\{[\s\S]*?actorKey:\s*activeActorId[\s\S]*?effectivePermissionKeys:\s*activePermissionKeys[\s\S]*?\}\)/u,
  )
  assert.match(
    authenticatedApp,
    /laborBridgeLoaderRef\.current\.load\(\{[\s\S]*?actorScope:\s*bridgeActorScope[\s\S]*?endMonth:\s*bridgeRequestedMonth[\s\S]*?length:\s*1[\s\S]*?snapshotMonth:\s*bridgeRequestedMonth[\s\S]*?signal:\s*abortController\.signal/u,
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
})

test('bridge request lifecycle fences actor, permission, view, month, and generation', () => {
  assert.match(authenticatedApp, /bridgeRequestGenerationRef\s*=\s*useRef\(0\)/u)
  assert.match(authenticatedApp, /bridgeRequestIdentityRef\s*=\s*useRef/u)
  assert.match(authenticatedApp, /bridgeRequestIdentityRef\.current\s*=\s*bridgeRequestIdentity/u)
  assert.match(authenticatedApp, /generation\s*!==\s*bridgeRequestGenerationRef\.current/u)
  assert.match(authenticatedApp, /bridgeRequestIdentityRef\.current\s*!==\s*requestIdentity/u)
  assert.match(authenticatedApp, /active\s*===\s*false/u)
  assert.match(authenticatedApp, /normalizeBridgeSummary\(value\)/u)
  assert.match(authenticatedApp, /normalized\?\.salaryMonth\s*!==\s*bridgeRequestedMonth/u)
  assert.match(
    authenticatedApp,
    /notifyBridgeAuthInvalid\(onLogout, error\)/u,
  )
  assert.match(
    authenticatedApp,
    /current\.identity === requestIdentity &&[\s\S]*?current\.month === bridgeRequestedMonth &&[\s\S]*?current\.bridge/u,
  )
  assert.match(authenticatedApp, /identity:\s*requestIdentity/u)
  assert.match(
    authenticatedApp,
    /laborBridgeState\.identity === bridgeRequestIdentity &&[\s\S]*?laborBridgeState\.month === bridgeRequestedMonth/u,
  )
  assert.match(authenticatedApp, /stale:\s*Boolean\(sameMonthBridge\)/u)
  assert.match(authenticatedApp, /setBridgeRetryToken\(\(value\) => value \+ 1\)/u)
  assert.match(authenticatedApp, /const abortController = new AbortController\(\)/u)
  assert.match(authenticatedApp, /abortController\.abort\(\)/u)
  assert.match(authenticatedApp, /bridgeActorScope/u)
  assert.match(authenticatedApp, /previousBridgeActorScopeRef/u)
  assert.match(
    authenticatedApp,
    /previousActorScope[\s\S]*?previousActorScope !== bridgeActorScope[\s\S]*?laborBridgeLoaderRef\.current\.clear\(previousActorScope\)/u,
  )
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
  assert.match(requestIdentity, /activeActorId/u)
  assert.match(requestIdentity, /bridgePermissionFingerprint/u)
  assert.match(requestIdentity, /bridgeActorScope/u)
})

test('accounting month is controlled by AuthenticatedApp and bridge status is visible and retryable', () => {
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

  assert.match(appSource, /正式核算正在加载，当前为历史估算/u)
  assert.match(appSource, /正式核算暂不可用，当前为历史估算/u)
  assert.match(appSource, /上次正式核算数据/u)
  assert.match(appSource, /尚未启用正式核算，当前为历史估算/u)
  assert.match(appSource, /待确认/u)
  assert.match(appSource, /onRetry/u)
})

test('bridge errors use alert semantics and auth invalidation callback failures stay isolated', () => {
  const notice = sliceBetween(appSource, 'function LaborBridgeStatusNotice', '\nexport function resolveAuthorizedView')
  const notifier = sliceBetween(appSource, 'function notifyBridgeAuthInvalid', '\nfunction LaborBridgeStatusNotice')

  assert.match(notice, /role=\{state\.error \? 'alert' : 'status'\}/u)
  assert.match(notice, /aria-live=\{state\.error \? 'assertive' : 'polite'\}/u)
  assert.match(notifier, /try \{/u)
  assert.match(notifier, /const result = callback\(error\)/u)
  assert.match(notifier, /void result\.catch\(\(\) => \{\}\)/u)
  assert.match(notifier, /catch \{/u)
  assert.match(authenticatedApp, /notifyBridgeAuthInvalid\(onLogout, error\)/u)
  assert.doesNotMatch(authenticatedApp, /if \(error\?\.authInvalid === true\) onLogout\(\)/u)
})

test('monthly accounting and dashboard replace legacy totals without double counting', () => {
  const allocationHelper = sliceBetween(
    appSource,
    'function getLaborAllocationInfo',
    '\nfunction getProjectLaborCost',
  )
  const monthlySummary = sliceBetween(appSource, 'function MonthlySummarySection', '\nfunction AccountingRecordList')
  const dashboard = sliceBetween(appSource, 'function DashboardPage', '\nfunction PageShell')

  assert.match(allocationHelper, /resolveMonthlySalaryTotal\(\{/u)
  assert.match(allocationHelper, /resolveMonthlyProjectLaborTotal\(\{/u)
  assert.match(allocationHelper, /month,/u)
  assert.match(allocationHelper, /bridge,/u)
  assert.doesNotMatch(allocationHelper, /legacySalaryTotal\s*\+|legacyAllocatedLaborCostTotal\s*\+/u)
  assert.match(monthlySummary, /getLaborAllocationInfo\([\s\S]*?monthFilter,[\s\S]*?laborBridge/u)
  assert.match(dashboard, /getLaborAllocationInfo\([\s\S]*?currentMonthValue\(\),[\s\S]*?laborBridge/u)
  assert.match(dashboard, /本月项目人工分摊/u)
  assert.match(dashboard, /laborAllocationInfo\.allocatedLaborCostTotal/u)
})

test('all dashboard cost and gross-profit amounts choose lifetime bridge labor exactly once', () => {
  const projectLaborHelper = sliceBetween(
    appSource,
    'function getProjectLaborCost',
    '\nfunction getProjectCostTotal',
  )
  const projectCostHelper = sliceBetween(
    appSource,
    'function getProjectCostTotal',
    '\nfunction getProjectPurchaseTotal',
  )
  const grossProfitHelper = sliceBetween(
    appSource,
    'function getGrossProfitInfo',
    '\nfunction normalizeVehicleRecord',
  )
  const dashboard = sliceBetween(appSource, 'function DashboardPage', '\nfunction PageShell')

  assert.match(projectLaborHelper, /resolveProjectLaborTotal\(\{/u)
  assert.match(projectLaborHelper, /legacyTotal:\s*legacyLaborCostTotal/u)
  assert.match(projectCostHelper, /getProjectLaborCost\([\s\S]*?bridge[\s\S]*?month/u)
  assert.match(grossProfitHelper, /getProjectCostTotal\([\s\S]*?bridge[\s\S]*?month/u)
  assert.match(dashboard, /getProjectLaborCost\([\s\S]*?laborBridge[\s\S]*?currentMonthValue\(\)/u)
  assert.match(dashboard, /getGrossProfitInfo\([\s\S]*?laborBridge[\s\S]*?currentMonthValue\(\)/u)
  assert.match(dashboard, /getProjectCostTotal\([\s\S]*?laborBridge[\s\S]*?currentMonthValue\(\)/u)
  assert.doesNotMatch(dashboard, /\+\s*(?:laborBridge|bridge\.)/u)
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

test('owner dashboard consumes the standard alert source instead of a bare count', () => {
  const dashboard = sliceBetween(appSource, 'function DashboardPage', '\nfunction PageShell')

  assert.doesNotMatch(authenticatedApp, /<DashboardPage[\s\S]*?laborAlertCount=\{laborAlertCount\}/u)
  assert.match(dashboard, /projectDashboardLaborAlertSource\(sourceStates, access\.labor\?\.view\)/u)
  assert.match(
    dashboard,
    /laborAlertState\.status\s*===\s*'ready'[\s\S]*?laborAlertState\.data/u,
  )
  assert.match(dashboard, /laborAlertStatusText\(laborAlertState\.status\)/u)
  assert.doesNotMatch(dashboard, /getLaborExceptions\(normalizedLaborRecords\)\.length/u)
})

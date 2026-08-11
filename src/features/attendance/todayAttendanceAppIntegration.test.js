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

function extractObjectContaining(source, marker) {
  const markerIndex = source.indexOf(marker)
  if (markerIndex < 0) return ''
  const start = source.lastIndexOf('{', markerIndex)
  if (start < 0) return ''
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') depth -= 1
    if (depth === 0) return source.slice(start, index + 1)
  }
  return ''
}

function extractOpeningTag(source, componentName) {
  const start = source.indexOf(`<${componentName}`)
  if (start < 0) return ''
  const end = source.indexOf('/>', start)
  return end < 0 ? '' : source.slice(start, end + 2)
}

function propertyValues(source, propertyName) {
  return [...source.matchAll(new RegExp(`\\b${propertyName}:\\s*'([^']+)'`, 'gu'))]
    .map((match) => match[1])
}

const [appSource, shellSource, authSource, dashboardDomainSource, homeModelSource] = await Promise.all([
  read('../../App.jsx'),
  read('../../DesktopAdminShell.jsx'),
  read('../../auth/AuthGate.jsx'),
  read('../executive-dashboard/executiveDashboardDomain.js'),
  read('../workbench/authorizedHomeModel.js'),
])

const authenticatedApp = sliceBetween(
  appSource,
  'function AuthenticatedApp',
  '\nfunction HomePage',
)
const homePage = sliceBetween(appSource, 'function HomePage', '\nfunction SystemSettingsPage')

async function loadDesktopShell() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/DesktopAdminShell.jsx')
  } finally {
    await server.close()
  }
}

const desktopShellModule = await loadDesktopShell()

test('today attendance remains in the centralized desktop routes and Home cards', () => {
  const menuViews = ADMIN_ROUTES.filter(({ desktop }) => desktop).map(({ view }) => view)

  assert.equal(menuViews.length, 14)
  assert.deepEqual(menuViews.filter((view) => view === 'todayAttendance'), ['todayAttendance'])
  assert.equal(menuViews.includes('toolReturn'), false)
  assert.equal(menuViews.indexOf('todayAttendance'), menuViews.indexOf('toolBorrow') + 1)

  const menuEntry = ADMIN_ROUTES.find(({ view }) => view === 'todayAttendance')
  assert.deepEqual(
    { label: menuEntry.label, iconText: menuEntry.iconText, moduleName: menuEntry.moduleName },
    { label: '今日打卡', iconText: '勤', moduleName: null },
  )

  assert.match(homeModelSource, /getVisibleAdminRoutes/u)
  assert.match(homeModelSource, /getAdminRoute/u)
  assert.match(homeModelSource, /todayAttendance:\s*'进入'/u)
  assert.match(homePage, /model\.modules\.map/u)
  assert.doesNotMatch(homePage, /const\s+modules\s*=\s*\[/u)
})

test('zero-module employees see Home and Today Attendance without another desktop module', () => {
  const currentUser = {
    employeeId: 'E-ZERO',
    employeeNumber: 'SW-123',
    name: '零权限员工',
    department: '现场',
    position: '小工',
    employmentStatus: '在职',
    accountStatus: 'active',
    mustChangePassword: false,
    effectivePermissionKeys: [],
  }
  const markup = renderToStaticMarkup(createElement(
    desktopShellModule.default,
    {
      currentView: 'home',
      currentUser,
      onNavigate() {},
      onLogout() {},
    },
    createElement('div', null, 'page'),
  ))
  const menuMarkup = sliceBetween(markup, '<nav', '</nav>')
  assert.equal((menuMarkup.match(/<button/gu) || []).length, 2)
  assert.match(menuMarkup, />首页</u)
  assert.match(menuMarkup, />今日打卡</u)
  assert.doesNotMatch(menuMarkup, /工程项目|借工具|系统设置/u)

  assert.match(shellSource, /getVisibleAdminRoutes\(currentUser\)/u)
  assert.match(authenticatedApp, /buildAuthorizedHomeModel\(\{/u)
  assert.match(authenticatedApp, /routes:\s*getVisibleAdminRoutes\(currentUser\)/u)
})

test('valid zero-module profiles authenticate with every dead permission-gate state removed', () => {
  const validation = sliceBetween(
    authSource,
    'const performSessionValidation',
    '\n\n  const validateSession',
  )
  assert.match(
    validation,
    /status:\s*currentUser\.mustChangePassword\s*\?\s*'password-change'\s*:\s*'authenticated'/u,
  )
  for (const deadSymbol of [
    'hasBusinessPermissions',
    'NoPermissionsPage',
    'no-permissions',
    'openOptionalPasswordChange',
    'closeOptionalPasswordChange',
  ]) assert.equal(authSource.includes(deadSymbol), false, deadSymbol)
  assert.match(authSource, /gate\.status !== 'authenticated'/u)
  assert.match(authSource, /children\(\{\s*currentUser:\s*gate\.currentUser,\s*onLogout:\s*moveToLogin\s*\}\)/u)
})

test('legacy project startup clears stale data before any unauthorized list call', () => {
  const lifecycle = sliceBetween(
    appSource,
    'export function useProjectDirectoryLifecycle',
    '\nexport function AuthenticatedApp',
  )
  assert.match(lifecycle, /createProjectDirectoryActorFingerprint\(currentUser, access\)/u)
  assert.match(lifecycle, /if \(!access\?\.view\)[\s\S]*?rows: \[\]/u)
  assert.match(
    lifecycle,
    /rows: \[\][\s\S]*?loadProjectDirectoryForAccess\(service, access\)/u,
  )
  assert.match(lifecycle, /requestSequenceRef\.current !== sequence/u)
  assert.match(lifecycle, /activeIdentityRef\.current !== requestIdentity/u)
  assert.match(
    authenticatedApp,
    /useProjectDirectoryLifecycle\(\{[\s\S]*?service: projectService,[\s\S]*?currentUser,[\s\S]*?access: projectReferenceAccess/u,
  )
})

test('one attendance route passes only identity, auth invalidation, and Home navigation', () => {
  assert.match(
    appSource,
    /import TodayAttendancePage from '\.\/features\/attendance\/TodayAttendancePage\.jsx'/u,
  )
  const attendanceRoute = extractBraceBlock(
    authenticatedApp,
    "if (authorizedView === 'todayAttendance')",
  )
  const openingTag = extractOpeningTag(attendanceRoute, 'TodayAttendancePage')
  const propNames = [...openingTag.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*=/gu)]
    .map((match) => match[1])
    .sort()

  assert.deepEqual(propNames, ['currentUser', 'onAuthInvalid', 'onBack'])
  assert.match(openingTag, /currentUser=\{currentUser\}/u)
  assert.match(openingTag, /onAuthInvalid=\{onLogout\}/u)
  assert.match(openingTag, /onBack=\{\(\) => handlePersonnelAwareNavigate\('home'\)\}/u)
  assert.doesNotMatch(openingTag, /\bprojects\s*=/u)
  assert.equal(
    (authenticatedApp.match(/return renderInDesktopShell\(/gu) || []).length,
    20,
  )
})

test('mobile shell routes use projected Home, workbench, message, and profile models', () => {
  for (const [view, component] of [
    ['workbench', 'MobileWorkbenchPage'],
    ['messages', 'MobileMessagesPage'],
    ['profile', 'MobileProfilePage'],
  ]) {
    const route = extractBraceBlock(authenticatedApp, `if (authorizedView === '${view}')`)
    assert.match(route, new RegExp(`<${component}\\b`, 'u'))
    assert.match(route, /return renderInDesktopShell\(/u)
  }

  const homeOpeningTag = extractOpeningTag(authenticatedApp, 'HomePage')
  assert.match(homeOpeningTag, /model=\{homeModel\}/u)
  assert.doesNotMatch(
    homeOpeningTag,
    /\b(?:projects|employees|purchaseRecords|projectCostRecords|inventoryItems)\s*=/u,
  )
  assert.match(authenticatedApp, /const authorizedMessages = buildAuthorizedMessages\(/u)
  assert.match(authenticatedApp, /const workbenchItems = buildWorkbenchItems\(/u)
  assert.match(authenticatedApp, /const bridgeRequestedMonth = [\s\S]*?resolveDashboardBridgeMonth\(/u)
  assert.match(
    authenticatedApp,
    /const dashboardAlertState = [\s\S]*?buildExecutiveDashboardReadModel\(\{[\s\S]*?selectedMonth:\s*bridgeRequestedMonth/u,
  )
  assert.match(
    authenticatedApp,
    /const bridgeTargetActive = \['home', 'accounting', 'dashboard', 'projects'\]\.includes\(authorizedView\)\s*\|\|\s*dashboardAccess\.page/u,
  )
})

test('toolBorrow owns return workflows while the dashboard consumes the standard return source', () => {
  const storageKeys = sliceBetween(
    appSource,
    'const STORAGE_KEYS = {',
    '\n}\n\nconst MIGRATABLE_STORAGE_KEYS',
  )
  const toolBusinessConfigs = sliceBetween(
    appSource,
    '  toolBorrow: {',
    '\n}\n\nfunction todayValue',
  )
  const recordMappings = sliceBetween(
    authenticatedApp,
    'const recordGroups = {',
    '\n\n  const projects = useMemo',
  )
  const toolRoute = extractBraceBlock(authenticatedApp, "if (authorizedView === 'toolBorrow')")
  const toolManagement = sliceBetween(
    appSource,
    'function ToolManagementPage',
    '\nfunction ToolArchiveSection',
  )
  const returnsBranch = sliceBetween(
    toolManagement,
    "{section === 'returns' && (",
    "\n      {section === 'lifelong' && (",
  )
  const dashboardSources = sliceBetween(
    authenticatedApp,
    'const dashboardSourceStates = {',
    '\n  const handleDashboardNavigate',
  )
  const dashboard = sliceBetween(appSource, 'function DashboardPage', '\nfunction PageShell')

  assert.match(storageKeys, /toolReturnRecords:\s*'erp\.toolReturnRecords'/u)
  assert.match(toolBusinessConfigs, /toolReturn:\s*\{/u)
  assert.match(recordMappings, /toolReturn:\s*toolReturnRecords/u)
  assert.match(recordMappings, /toolReturn:\s*setToolReturnRecords/u)

  assert.match(toolRoute, /^if \(authorizedView === 'toolBorrow'\)/u)
  assert.doesNotMatch(toolRoute.split('{', 1)[0], /toolReturn/u)
  assert.doesNotMatch(authenticatedApp, /\bauthorizedView\s*===\s*'toolReturn'/u)
  assert.match(toolRoute, /initialSection="borrow"/u)
  for (const prop of [
    'toolBorrowRecords',
    'setToolBorrowRecords',
    'toolReturnRecords',
    'setToolReturnRecords',
  ]) assert.match(toolRoute, new RegExp(`\\b${prop}=`, 'u'))

  assert.match(toolManagement, /\{ id:\s*'returns',\s*title:\s*'归还工具' \}/u)
  assert.match(returnsBranch, /<ToolReturnSection/u)
  assert.match(returnsBranch, /borrowRecords=\{toolBorrowRecords\}/u)
  assert.match(returnsBranch, /records=\{toolReturnRecords\}/u)
  assert.match(returnsBranch, /setRecords=\{setToolReturnRecords\}/u)

  assert.match(
    dashboardSources,
    /toolReturnRecords:\s*projectPersistentSource\(toolReturnRawState,[\s\S]*?data:\s*toolReturnRecords/u,
  )
  assert.match(dashboard, /buildExecutiveDashboardReadModel\(\{[\s\S]*?sources,/u)
  assert.match(dashboard, /<ExecutiveDashboardPage[\s\S]*?model=\{model\}/u)
  assert.match(dashboardDomainSource, /'toolReturnRecords'/u)
  assert.match(dashboardDomainSource, /states\.toolReturnRecords\.data/u)
})

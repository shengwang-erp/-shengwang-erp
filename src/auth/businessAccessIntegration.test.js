import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createServer } from 'vite'

async function readSource(relativePath) {
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

const appSource = await readSource('../App.jsx')
const authenticatedApp = sliceBetween(
  appSource,
  'function AuthenticatedApp',
  '\nfunction HomePage',
)
const homePage = sliceBetween(appSource, 'function HomePage', '\nfunction SystemSettingsPage')

async function loadBusinessAccess() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/auth/businessAccess.js')
  } finally {
    await server.close()
  }
}

const businessAccess = await loadBusinessAccess()

const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  employeeId: 'E-ROUTE',
  employeeNumber: 'SW-123',
  name: '路由测试员工',
  department: '现场',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys,
  ...overrides,
})

test('central access resolves unauthorized direct and stale routes to Home', () => {
  const zeroModuleUser = activeUser()
  const resolveView = (user, currentView) =>
    businessAccess.canAccessView(user, currentView) ? currentView : 'home'

  assert.equal(resolveView(zeroModuleUser, 'dashboard'), 'home')
  assert.equal(resolveView(zeroModuleUser, 'todayAttendance'), 'todayAttendance')

  const ordinaryProjectUser = activeUser(['module.projects.view'])
  assert.equal(resolveView(ordinaryProjectUser, 'projects'), 'projects')
  assert.equal(resolveView(ordinaryProjectUser, 'contractRevenue'), 'home')

  const financeProjectUser = activeUser(['module.projects.view'], { department: '财务部' })
  assert.equal(resolveView(financeProjectUser, 'contractRevenue'), 'contractRevenue')
})

test('AuthenticatedApp uses one authorized view for navigation, bridges, and every route branch', () => {
  assert.match(
    appSource,
    /import\s+\{\s*canAccessView\s*\}\s+from\s+'\.\/auth\/businessAccess\.js'/u,
  )
  assert.match(
    authenticatedApp,
    /const authorizedView = canAccessView\(currentUser, currentView\)\s*\? currentView\s*:\s*'home'/u,
  )
  assert.match(
    authenticatedApp,
    /useEffect\(\(\) => \{\s*if \(authorizedView !== currentView\) setCurrentView\(authorizedView\)\s*\}, \[authorizedView, currentView\]\)/u,
  )
  assert.match(
    authenticatedApp,
    /const bridgeTargetActive = \['accounting', 'dashboard', 'projects'\]\.includes\(authorizedView\)/u,
  )
  assert.match(authenticatedApp, /const bridgeRequestedMonth = authorizedView === 'accounting'/u)

  const navigation = extractBraceBlock(
    authenticatedApp,
    'const handlePersonnelAwareNavigate = useCallback',
  )
  const permissionGuard = navigation.indexOf('if (!canAccessView(currentUser, nextView)) return false')
  const personnelGuard = navigation.indexOf('shouldBlockPersonnelExit')
  const stateChange = navigation.indexOf('setCurrentView(nextView)')
  assert.ok(permissionGuard >= 0)
  assert.ok(personnelGuard > permissionGuard)
  assert.ok(stateChange > personnelGuard)
  assert.match(navigation, /if \(exitBlockedNow && nextView !== authorizedView\) return false/u)
  assert.match(navigation, /setCurrentView\(nextView\)\s*return true/u)
  assert.match(authenticatedApp, /\[authorizedView, currentUser\],?\s*\)/u)

  for (const view of [
    'contractRevenue',
    'projects',
    'todayAttendance',
    'employees',
    'dashboard',
    'purchase',
    'labor',
    'vehicle',
    'toolBorrow',
    'accounting',
    'settings',
  ]) {
    assert.match(authenticatedApp, new RegExp(`if \\(authorizedView === '${view}'\\)`, 'u'))
  }
  assert.doesNotMatch(authenticatedApp, /if \(currentView === '(?:contractRevenue|projects|todayAttendance|employees|dashboard|purchase|labor|vehicle|toolBorrow|accounting|settings)'\)/u)
  assert.match(authenticatedApp, /currentView=\{authorizedView\}/u)
  assert.match(authenticatedApp, /if \(businessConfigs\[authorizedView\]\)/u)
  assert.match(authenticatedApp, /records=\{recordGroups\[authorizedView\]\}/u)
  assert.match(authenticatedApp, /setRecords=\{recordSetters\[authorizedView\]\}/u)
  assert.match(authenticatedApp, /onOpenView=\{handlePersonnelAwareNavigate\}/u)
  assert.match(homePage, /module\.view\s*\?\s*canAccessView\(currentUser, module\.view\)/u)
})

test('contract revenue preserves view permission and uses the dedicated update permission', () => {
  assert.match(
    appSource,
    /import\s+\{[\s\S]*?canUpdateProjectFinancials,[\s\S]*?canViewProjectFinancials[\s\S]*?\}\s+from\s+'\.\/features\/projects\/projectPermissions\.js'/u,
  )
  assert.match(authenticatedApp, /const canViewFinancials = canViewProjectFinancials\(currentUser\)/u)

  const contractRevenueRoute = extractBraceBlock(
    authenticatedApp,
    "if (authorizedView === 'contractRevenue')",
  )
  assert.match(contractRevenueRoute, /canViewFinancials=\{canViewFinancials\}/u)
  assert.match(
    contractRevenueRoute,
    /canUpdateFinancials=\{canUpdateProjectFinancials\(currentUser\)\}/u,
  )
  assert.doesNotMatch(contractRevenueRoute, /canEdit\(currentUser,\s*['"]projects['"]\)/u)
})

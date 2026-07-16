import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

async function readSource(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8').catch(() => '')
}

const [shellSource, appSource, cssSource] = await Promise.all([
  readSource('./DesktopAdminShell.jsx'),
  readSource('./App.jsx'),
  readSource('./styles.css'),
])

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
  const end = source.indexOf('}', markerIndex)
  return end < 0 ? '' : source.slice(start, end + 1)
}

const desktopMenu = sliceBetween(
  shellSource,
  'const desktopMenuItems = [',
  '\n]\n\nfunction getDesktopActiveView',
)
const authenticatedApp = sliceBetween(
  appSource,
  'function AuthenticatedApp',
  '\nfunction HomePage',
)

test('desktop shell exposes every real first-level route without approval or report placeholders', () => {
  const expectedMenuEntries = [
    ['home', '首页'],
    ['dashboard', '老板驾驶舱'],
    ['projects', '工程项目'],
    ['employees', '人员管理'],
    ['accounting', '会计成本'],
    ['labor', '人工记录'],
    ['stockOut', '我要出库'],
    ['stockReturn', '我要退回'],
    ['purchase', '采购管理'],
    ['vehicle', '车辆管理'],
    ['toolBorrow', '借工具'],
    ['todayAttendance', '今日打卡'],
    ['settings', '系统设置'],
  ]

  for (const [view, label] of expectedMenuEntries) {
    const menuEntry = extractObjectContaining(desktopMenu, `view: '${view}'`)
    assert.match(
      menuEntry,
      new RegExp(`view:\\s*['\"]${view}['\"][\\s\\S]*?label:\\s*['\"]${label}['\"]`),
    )
  }

  const attendanceEntry = extractObjectContaining(desktopMenu, "view: 'todayAttendance'")
  assert.match(attendanceEntry, /code:\s*'勤'/u)
  assert.match(attendanceEntry, /alwaysAvailable:\s*true/u)
  assert.doesNotMatch(desktopMenu, /view:\s*'toolReturn'/u)
  assert.equal((desktopMenu.match(/\bview:/gu) || []).length, 13)
  assert.doesNotMatch(desktopMenu, /审批中心|报表中心/)
  assert.match(
    desktopMenu,
    /view:\s*'stockOut'[\s\S]*?permissionName:\s*'仓库库存'/,
  )
  assert.match(
    desktopMenu,
    /view:\s*'stockReturn'[\s\S]*?permissionName:\s*'仓库库存'/,
  )
  assert.doesNotMatch(shellSource, /currentUser\.(?:position|department)\s*===/)
  const visibility = sliceBetween(
    shellSource,
    'const visibleMenuItems = desktopMenuItems.filter',
    '\n  const activeMenuItem',
  )
  assert.match(
    visibility,
    /item\.view === 'home'[\s\S]*?item\.alwaysAvailable === true[\s\S]*?isSuperAdmin\(currentUser\)[\s\S]*?canAccessModule\(currentUser, item\.permissionName\)/,
  )
  assert.match(
    appSource,
    /title:\s*'我要出库'[\s\S]*?permissionName:\s*'仓库库存'/,
  )
  assert.match(
    appSource,
    /title:\s*'我要退回'[\s\S]*?permissionName:\s*'仓库库存'/,
  )
})

test('authenticated views share the desktop shell while login stays outside it', () => {
  assert.match(appSource, /import DesktopAdminShell from '\.\/DesktopAdminShell'/)
  assert.match(appSource, /const renderInDesktopShell\s*=\s*\(page\)\s*=>/)
  assert.equal((authenticatedApp.match(/return renderInDesktopShell\(/g) || []).length, 13)
  assert.match(appSource, /<AuthGate>[\s\S]*?<AuthenticatedApp/)
  assert.doesNotMatch(appSource, /if \(!currentUser\)[\s\S]*?<LoginPage/)

  const toolRoute = extractBraceBlock(authenticatedApp, "if (currentView === 'toolBorrow')")
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
  assert.match(toolRoute, /initialSection="borrow"/u)
  assert.match(toolRoute, /toolReturnRecords=\{toolReturnRecords\}/u)
  assert.match(toolRoute, /setToolReturnRecords=\{setToolReturnRecords\}/u)
  assert.match(returnsBranch, /<ToolReturnSection/u)
  assert.match(returnsBranch, /records=\{toolReturnRecords\}/u)
  assert.match(returnsBranch, /setRecords=\{setToolReturnRecords\}/u)
})

test('desktop frame is fixed and gold-highlighted only above the mobile breakpoint', () => {
  assert.match(
    cssSource,
    /\.desktop-admin-layout,\s*\.desktop-admin-workspace,\s*\.desktop-admin-content\s*\{\s*display:\s*contents/,
  )
  assert.match(
    cssSource,
    /@media\s*\(min-width:\s*901px\)[\s\S]*?\.desktop-admin-sidebar\s*\{[^}]*position:\s*fixed[^}]*\}[\s\S]*?\.desktop-admin-topbar\s*\{[^}]*position:\s*fixed[^}]*\}/,
  )
  assert.match(
    cssSource,
    /\.desktop-admin-menu-item\.active\s*\{[^}]*color:\s*#f3d18b[^}]*background:[^}]*#3a2a16/,
  )
})

test('desktop shell reserves an accessible labor-only alert badge contract', () => {
  assert.match(
    shellSource,
    /laborAlertCount\s*=\s*0[\s\S]*?laborAlertStale\s*=\s*false/u,
  )
  assert.match(shellSource, /item\.view\s*===\s*'labor'/u)
  assert.match(shellSource, /aria-label=\{[^}]*人工记录[^}]*待处理/u)
  assert.match(shellSource, /data-labor-alert-badge/u)
  assert.match(shellSource, /<strong>[\s\S]*?<em[\s\S]*?data-labor-alert-badge/u)
  assert.doesNotMatch(shellSource, /styles\.css['"]/u)
})

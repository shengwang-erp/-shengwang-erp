import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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

const authenticatedApp = sliceBetween(
  appSource,
  'function AuthenticatedApp',
  '\nfunction HomePage',
)

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

test('desktop shell renders only centrally authorized routes and falls back to Home metadata', () => {
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
      currentView: 'dashboard',
      currentUser,
      onNavigate() {},
      onLogout() {},
    },
    createElement('div', null, 'Home content'),
  ))
  const menuMarkup = sliceBetween(markup, '<nav', '</nav>')
  const titleMarkup = sliceBetween(markup, 'desktop-admin-topbar-title', '</div>')

  assert.equal((menuMarkup.match(/<button/gu) || []).length, 2)
  assert.match(menuMarkup, />首页</u)
  assert.match(menuMarkup, />今日打卡</u)
  assert.doesNotMatch(menuMarkup, /老板驾驶舱|工程项目|系统设置/u)
  assert.match(titleMarkup, /<strong>首页<\/strong>/u)
  assert.doesNotMatch(titleMarkup, /老板驾驶舱/u)

  assert.match(
    shellSource,
    /import\s+\{\s*getVisibleAdminRoutes\s*\}\s+from\s+'\.\/auth\/businessAccess\.js'/u,
  )
  assert.match(shellSource, /const visibleMenuItems = getVisibleAdminRoutes\(currentUser\)/u)
  assert.doesNotMatch(shellSource, /desktopMenuItems|canAccessModule|isSuperAdmin/u)
})

test('authenticated views share the desktop shell while login stays outside it', () => {
  assert.match(appSource, /import DesktopAdminShell from '\.\/DesktopAdminShell'/)
  assert.match(appSource, /const renderInDesktopShell\s*=\s*\(page\)\s*=>/)
  assert.equal((authenticatedApp.match(/return renderInDesktopShell\(/g) || []).length, 13)
  assert.match(appSource, /<AuthGate>[\s\S]*?<AuthenticatedApp/)
  assert.doesNotMatch(appSource, /if \(!currentUser\)[\s\S]*?<LoginPage/)

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

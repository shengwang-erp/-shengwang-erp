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
    ['toolReturn', '还工具'],
    ['settings', '系统设置'],
  ]

  for (const [view, label] of expectedMenuEntries) {
    assert.match(
      shellSource,
      new RegExp(`view:\\s*['\"]${view}['\"][\\s\\S]*?label:\\s*['\"]${label}['\"]`),
    )
  }

  assert.doesNotMatch(shellSource, /审批中心|报表中心/)
  assert.match(
    shellSource,
    /isSuperAdmin\(currentUser\)[\s\S]*?currentUser\.position\s*===\s*'会计'[\s\S]*?currentUser\.department\s*===\s*'会计'/,
  )
})

test('authenticated views share the desktop shell while login stays outside it', () => {
  assert.match(appSource, /import DesktopAdminShell from '\.\/DesktopAdminShell'/)
  assert.match(appSource, /const renderInDesktopShell\s*=\s*\(page\)\s*=>/)
  assert.equal((appSource.match(/return renderInDesktopShell\(/g) || []).length, 12)
  assert.match(appSource, /if \(!currentUser\)[\s\S]*?return \(\s*<LoginPage/)
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

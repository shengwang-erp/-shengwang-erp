import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  employeeId: 'E-MOBILE',
  employeeNumber: 'SW-123',
  name: '移动员工',
  department: '现场',
  position: '小工',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys,
  ...overrides,
})

async function loadComponent() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/navigation/MobileBottomNavigation.jsx')
  } finally {
    await server.close()
  }
}

test('mobile navigation renders the exact four centralized tabs and current page state', async () => {
  const { default: MobileBottomNavigation } = await loadComponent()
  const html = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'messages',
    currentUser: activeUser(),
    workbenchItems: [],
    messages: [],
    onNavigate() {},
  }))

  assert.match(html, /<nav[^>]*class="mobile-bottom-navigation"[^>]*aria-label="移动主导航"/u)
  assert.equal((html.match(/<button/gu) || []).length, 4)
  assert.deepEqual(
    [...html.matchAll(/<span class="mobile-bottom-label">([^<]+)<\/span>/gu)]
      .map((match) => match[1]),
    ['首页', '工作台', '消息', '我的'],
  )
  assert.match(html, /aria-current="page"[^>]*>[\s\S]*?消息/u)
  assert.equal((html.match(/aria-current="page"/gu) || []).length, 1)
})

test('a business route maps mobile current state to Workbench', async () => {
  const { default: MobileBottomNavigation } = await loadComponent()
  const html = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'todayAttendance',
    currentUser: activeUser(),
    workbenchItems: [],
    messages: [],
    onNavigate() {},
  }))
  const currentButton = html.match(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?<\/button>/u)?.[0] || ''
  assert.match(currentButton, /工作台/u)
  assert.equal((html.match(/aria-current="page"/gu) || []).length, 1)
})

test('an unknown route fails to Home while a canonical child stays in Workbench', async () => {
  const { default: MobileBottomNavigation } = await loadComponent()
  const user = activeUser(['module.projects.view'], {
    department: '财务部',
    position: '会计',
  })
  for (const [currentView, expected] of [
    ['unknown-view', '首页'],
    ['contractRevenue', '工作台'],
  ]) {
    const html = renderToStaticMarkup(createElement(MobileBottomNavigation, {
      currentView,
      currentUser: user,
      workbenchItems: [],
      messages: [],
      onNavigate() {},
    }))
    const currentButton = html.match(/<button[^>]*aria-current="page"[^>]*>[\s\S]*?<\/button>/u)?.[0] || ''
    assert.match(currentButton, new RegExp(expected, 'u'))
    assert.equal((html.match(/aria-current="page"/gu) || []).length, 1)
  }
})

test('mobile badge totals are recalculated only from routes the current user can access', async () => {
  const { default: MobileBottomNavigation } = await loadComponent()
  const html = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'home',
    currentUser: activeUser(),
    workbenchItems: [
      { view: 'projects', label: '工程项目', iconText: '项', badgeCount: 91 },
      { view: 'todayAttendance', label: '今日打卡', iconText: '勤', badgeCount: 2 },
    ],
    messages: [{
      id: 'private-project',
      severity: 'warning',
      title: '隐私项目异常',
      summary: '不得计入消息徽标',
      count: 88,
      amount: 900000,
      targetView: 'projects',
      canNavigate: true,
    }],
    onNavigate() {},
  }))

  assert.match(html, /aria-label="工作台，2 条待处理"/u)
  assert.doesNotMatch(html, />91<|>88<|179 条待处理/u)
  assert.doesNotMatch(html, /aria-label="消息，/u)
})

test('mobile navigation consumes centralized route and access metadata', async () => {
  const source = await readFile(new URL('./MobileBottomNavigation.jsx', import.meta.url), 'utf8')
  assert.match(source, /from ['"]\.\/adminRoutes\.js['"]/u)
  assert.match(source, /from ['"]\.\.\/auth\/businessAccess\.js['"]/u)
  assert.doesNotMatch(source, /\[['"]home['"],\s*['"]workbench['"],\s*['"]messages['"],\s*['"]profile['"]\]/u)
})

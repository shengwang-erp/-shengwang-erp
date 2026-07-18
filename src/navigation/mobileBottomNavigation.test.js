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
    const [component, workbenchModel] = await Promise.all([
      server.ssrLoadModule('/src/navigation/MobileBottomNavigation.jsx'),
      server.ssrLoadModule('/src/features/workbench/workbenchModel.js'),
    ])
    return { component, workbenchModel }
  } finally {
    await server.close()
  }
}

test('mobile navigation renders the exact four centralized tabs and current page state', async () => {
  const { component: { default: MobileBottomNavigation } } = await loadComponent()
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
  const { component: { default: MobileBottomNavigation } } = await loadComponent()
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
  const { component: { default: MobileBottomNavigation } } = await loadComponent()
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

test('mobile badge totals require a same-actor workbench projection', async () => {
  const {
    component: { default: MobileBottomNavigation },
    workbenchModel: { buildWorkbenchItems },
  } = await loadComponent()
  const user = activeUser()
  const workbenchItems = buildWorkbenchItems({
    user,
    counts: { todayAttendance: 2 },
  })
  const html = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'home',
    currentUser: user,
    workbenchItems,
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

  const forgedHtml = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'home',
    currentUser: user,
    workbenchItems: [{ view: 'todayAttendance', badgeCount: 99 }],
    messages: [],
    onNavigate() {},
  }))
  assert.doesNotMatch(forgedHtml, /aria-label="工作台，|mobile-bottom-badge/u)

  const crossActorHtml = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'home',
    currentUser: activeUser([], { employeeId: 'E-OTHER', employeeNumber: 'SW-404' }),
    workbenchItems,
    messages: [],
    onNavigate() {},
  }))
  assert.doesNotMatch(crossActorHtml, /aria-label="工作台，|mobile-bottom-badge/u)

  const projectActor = activeUser(['module.projects.view'], {
    employeeId: 'E-SAME-ACTOR',
    employeeNumber: 'SW-501',
  })
  const projectItems = buildWorkbenchItems({
    user: projectActor,
    counts: { projects: 23 },
  })
  const downgradedHtml = renderToStaticMarkup(createElement(MobileBottomNavigation, {
    currentView: 'home',
    currentUser: { ...projectActor, effectivePermissionKeys: [] },
    workbenchItems: projectItems,
    messages: [],
    onNavigate() {},
  }))
  assert.doesNotMatch(downgradedHtml, /aria-label="工作台，|>23<|mobile-bottom-badge/u)
})

test('mobile navigation consumes centralized route and access metadata', async () => {
  const source = await readFile(new URL('./MobileBottomNavigation.jsx', import.meta.url), 'utf8')
  assert.match(source, /from ['"]\.\/adminRoutes\.js['"]/u)
  assert.match(source, /from ['"]\.\.\/auth\/businessAccess\.js['"]/u)
  assert.doesNotMatch(source, /\[['"]home['"],\s*['"]workbench['"],\s*['"]messages['"],\s*['"]profile['"]\]/u)
})

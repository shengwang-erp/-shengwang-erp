import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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

test('labor alert state replaces on success and preserves the last count on failure', () => {
  assert.ifError(runtime.hook.error)
  const { applyLaborAlertRefreshResult, createLaborAlertState } = runtime.hook.module

  const initial = createLaborAlertState()
  assert.deepEqual(initial, { count: 0, stale: false })
  const successful = applyLaborAlertRefreshResult(initial, { ok: true, count: 3 })
  assert.deepEqual(successful, { count: 3, stale: false })
  assert.deepEqual(
    applyLaborAlertRefreshResult(successful, { ok: false }),
    { count: 3, stale: true },
  )
  assert.deepEqual(
    applyLaborAlertRefreshResult({ count: 8, stale: true }, { ok: true, count: 1 }),
    { count: 1, stale: false },
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
    /useLaborAlertCount\(\{[\s\S]*?actorKey:\s*currentUser\.id[\s\S]*?effectivePermissionKeys:\s*currentUser\.effectivePermissionKeys[\s\S]*?onAuthInvalid:\s*onLogout[\s\S]*?\}\)/u,
  )
  assert.match(authenticatedApp, /laborAlertCount=\{laborAlertCount\}/u)
  assert.match(authenticatedApp, /laborAlertStale=\{laborAlertStale\}/u)

  const route = extractBraceBlock(authenticatedApp, "if (currentView === 'labor')")
  assert.match(route, /<LaborAccountingPage/u)
  assert.doesNotMatch(route, /<LaborPage/u)
  assert.match(route, /currentUser=\{currentUser\}/u)
  assert.match(route, /onBack=\{\(\) => setCurrentView\('home'\)\}/u)
  assert.match(route, /onAuthInvalid=\{onLogout\}/u)
  assert.match(route, /onAlertCountChange=\{refreshLaborAlertCount\}/u)
  assert.doesNotMatch(route, /handlePersonnelAwareLogout/u)
})

test('desktop shell renders an accessible badge only for positive labor alerts', () => {
  assert.ifError(runtime.shell.error)
  const currentUser = {
    id: 'user-a',
    employeeNumber: 'SW-123',
    name: '会计测试员',
    department: '会计',
    position: '会计',
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
  const menuSource = sliceBetween(
    shellSource,
    'const desktopMenuItems = [',
    '\n]\n\nfunction getDesktopActiveView',
  )
  assert.equal((menuSource.match(/\bview:/gu) || []).length, 13)
  assert.match(shellSource, /laborAlertCount\s*=\s*0/u)
  assert.match(shellSource, /laborAlertStale\s*=\s*false/u)
  assert.match(shellSource, /item\.view\s*===\s*'labor'/u)
  assert.match(shellSource, /<strong>[\s\S]*?<em[\s\S]*?data-labor-alert-badge/u)
  assert.doesNotMatch(shellSource, /import\s+['"].*styles\.css/u)
})

import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import test, { after, afterEach } from 'node:test'
import { createServer } from 'vite'

import {
  findWarehouseTestElement,
  installWarehouseReactDom,
} from '../features/warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/business-runtime-boundary-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const boundaryModule = await server.ssrLoadModule('/src/auth/BusinessRuntimeBoundary.jsx')
const BusinessRuntimeBoundary = boundaryModule.default
after(() => server.close())

let activeView = null
afterEach(async () => {
  if (!activeView) return
  await act(async () => activeView.root.unmount())
  activeView.dom.cleanup()
  activeView = null
})

function BrokenView() {
  throw new TypeError('BrokenView render failed')
}

function UrlBrokenView() {
  throw new TypeError('Invoice request failed at https://erp.example.test/orders/42?access_token=private-token')
}

function ThrownValueView({ value }) {
  throw value
}

function findElement(root, predicate) {
  return findWarehouseTestElement(root, predicate)
}

function button(root, label) {
  return findElement(root, (node) =>
    node.nodeName === 'BUTTON' && node.textContent.trim() === label)
}

async function click(root, label) {
  await act(async () => button(root, label).click())
}

async function renderBoundary(children, props = {}) {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const previousConsoleError = console.error
  console.error = () => {}
  try {
    await act(async () => root.render(createElement(BusinessRuntimeBoundary, {
      onLogout() {},
      buildId: 'test-build',
      now: () => '2026-08-11T08:00:00.000Z',
      runtime: () => ({ platform: 'Other', browser: 'Web Browser' }),
      ...props,
    }, children)))
  } finally {
    console.error = previousConsoleError
  }
  activeView = { dom, container, root }
  return activeView
}

test('renders healthy business children without adding account text', async () => {
  const view = await renderBoundary(createElement('p', null, 'healthy'))
  assert.equal(view.container.textContent, 'healthy')
})

test('render failure shows bounded diagnostics instead of an empty ERP root', async () => {
  const view = await renderBoundary(createElement(BrokenView), {
    buildId: 'abcdef123456',
    now: () => '2026-08-11T08:00:00.000Z',
    runtime: () => ({ platform: 'iOS', browser: 'Safari Web App' }),
  })
  assert.match(view.container.textContent, /系统页面发生错误/u)
  assert.match(view.container.textContent, /UI_RUNTIME_ERROR-abcdef123456/u)
  const field = findElement(view.container, (node) => node.nodeName === 'TEXTAREA')
  assert.match(field.value, /BrokenView/u)
  assert.match(field.value, /"message": "fingerprint:[0-9a-f]{8}"/u)
  assert.doesNotMatch(field.value, /BrokenView render failed/u)
  assert.doesNotMatch(field.value, /测试姓名|SW-008|秘密工程/u)
})

for (const [label, value] of [
  ['null', null],
  ['undefined', undefined],
  ['false', false],
  ['zero', 0],
]) {
  test(`a ${label} thrown value renders the complete recovery fallback`, async () => {
    const view = await renderBoundary(createElement(ThrownValueView, { value }))

    assert.match(view.container.textContent, /系统页面发生错误/u)
    assert.ok(button(view.container, '复制诊断信息'))
    assert.ok(button(view.container, '重新加载'))
    assert.ok(button(view.container, '退出登录'))
    const field = findElement(view.container, (node) => node.nodeName === 'TEXTAREA')
    assert.match(field.value, /UI_RUNTIME_ERROR/u)
  })
}

test('throwing error name and message accessors cannot collapse the recovery fallback', async () => {
  let getterCalls = 0
  const thrown = {}
  Object.defineProperties(thrown, {
    name: { get() { getterCalls += 1; throw new Error('name getter ran') } },
    message: { get() { getterCalls += 1; throw new Error('message getter ran') } },
  })
  const view = await renderBoundary(createElement(ThrownValueView, { value: thrown }))

  assert.equal(getterCalls, 0)
  assert.match(view.container.textContent, /系统页面发生错误/u)
  assert.ok(button(view.container, '复制诊断信息'))
  assert.ok(button(view.container, '重新加载'))
  assert.ok(button(view.container, '退出登录'))
})

test('copy, reload and logout use only injected recovery adapters', async () => {
  const copied = []
  let reloads = 0
  let logouts = 0
  const view = await renderBoundary(createElement(BrokenView), {
    copyText: async (text) => copied.push(text),
    onReload: () => { reloads += 1 },
    onLogout: async () => { logouts += 1 },
  })
  await click(view.container, '复制诊断信息')
  await click(view.container, '重新加载')
  await click(view.container, '退出登录')
  assert.equal(copied.length, 1)
  assert.match(copied[0], /UI_RUNTIME_ERROR/u)
  assert.equal(reloads, 1)
  assert.equal(logouts, 1)
})

test('removes URL-bearing diagnostics from the fallback textarea and clipboard', async () => {
  const copied = []
  const view = await renderBoundary(createElement(UrlBrokenView), {
    copyText: async (text) => copied.push(text),
  })
  const field = findElement(view.container, (node) => node.nodeName === 'TEXTAREA')
  await click(view.container, '复制诊断信息')

  assert.doesNotMatch(field.value, /erp\.example\.test|private-token|file:\/\//u)
  assert.equal(copied.length, 1)
  assert.doesNotMatch(copied[0], /erp\.example\.test|private-token|file:\/\//u)
  assert.match(copied[0], /"message": "fingerprint:[0-9a-f]{8}"/u)
})

test('only the concise error summary is exposed as an assertive alert', async () => {
  const view = await renderBoundary(createElement(BrokenView), {
    copyText: async () => {},
  })
  const alert = findElement(view.container, (node) => node.getAttribute?.('role') === 'alert')
  const field = findElement(view.container, (node) => node.nodeName === 'TEXTAREA')

  assert.ok(alert)
  assert.match(alert.textContent, /系统页面发生错误/u)
  assert.match(alert.textContent, /业务界面已安全停止/u)
  assert.match(alert.textContent, /UI_RUNTIME_ERROR/u)
  assert.equal(alert.contains(field), false)
  for (const label of ['复制诊断信息', '重新加载', '退出登录']) {
    assert.equal(alert.contains(button(view.container, label)), false)
  }

  await click(view.container, '复制诊断信息')
  const status = findElement(view.container, (node) => node.getAttribute?.('role') === 'status')
  assert.ok(status)
  assert.equal(alert.contains(status), false)
})

test('clipboard rejection keeps selectable read-only diagnostics visible', async () => {
  const view = await renderBoundary(createElement(BrokenView), {
    copyText: async () => { throw new Error('clipboard unavailable') },
  })
  await click(view.container, '复制诊断信息')
  assert.match(view.container.textContent, /复制失败，请长按下面的诊断信息/u)
  const field = findElement(view.container, (node) => node.nodeName === 'TEXTAREA')
  assert.equal(field.readOnly, true)
  assert.match(field.value, /UI_RUNTIME_ERROR/u)
})

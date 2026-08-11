import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import test, { after } from 'node:test'
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
  cacheDir: '/private/tmp/authenticated-business-runtime-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const runtimeModule = await server.ssrLoadModule('/src/auth/AuthenticatedBusinessRuntime.jsx')
const AuthenticatedBusinessRuntime = runtimeModule.default
after(() => server.close())

function BrokenView() {
  throw new TypeError('Authenticated business render failed')
}

function findElement(root, predicate) {
  return findWarehouseTestElement(root, predicate)
}

function button(root, label) {
  return findElement(root, (node) =>
    node.nodeName === 'BUTTON' && node.textContent.trim() === label)
}

test('a new authenticated actor gets a clean business runtime after the previous actor crashes', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  let logouts = 0
  const sensitiveProfile = {
    name: '测试姓名', employeeNumber: 'SW-008', accessToken: 'secret-token',
  }
  const previousConsoleError = console.error
  console.error = () => {}
  try {
    await act(async () => root.render(createElement(AuthenticatedBusinessRuntime, {
      actorId: 'actor-a',
      buildId: 'abcdef123456',
      onLogout: async () => { logouts += 1 },
      profileData: sensitiveProfile,
    }, createElement(BrokenView, { profileData: sensitiveProfile }))))
    assert.match(container.textContent, /系统页面发生错误/u)
    const diagnostic = findElement(container, (node) => node.nodeName === 'TEXTAREA')
    assert.match(diagnostic.value, /UI_RUNTIME_ERROR-abcdef123456/u)
    assert.doesNotMatch(diagnostic.value, /测试姓名|SW-008|secret-token/u)
    await act(async () => button(container, '退出登录').click())
    assert.equal(logouts, 1)

    await act(async () => root.render(createElement(AuthenticatedBusinessRuntime, {
      actorId: 'actor-b',
      buildId: 'abcdef123456',
      onLogout: async () => { logouts += 1 },
    }, createElement('p', null, 'new actor healthy'))))
    assert.equal(container.textContent, 'new actor healthy')
  } finally {
    console.error = previousConsoleError
    await act(async () => root.unmount())
    dom.cleanup()
  }
})

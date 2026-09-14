import assert from 'node:assert/strict'
import React, { act, createElement, useEffect, useState } from 'react'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import {
  findWarehouseTestElement,
  installWarehouseReactDom,
} from '../features/warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()
globalThis.React = React

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/auth-gate-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
})
const authGateModule = await server.ssrLoadModule('/src/auth/AuthGate.jsx')
const AuthGate = authGateModule.default
after(() => server.close())

const AUTH_USER_ID = 'auth-user-a'
const SESSION = {
  access_token: 'access-token-a',
  user: { id: AUTH_USER_ID },
}
const PROFILE = {
  id: 'employee-profile-a',
  employeeNumber: 'SW-008',
  name: '测试员工',
  mustChangePassword: false,
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function findElement(root, predicate) {
  return findWarehouseTestElement(root, predicate)
}

function button(root, label) {
  return findElement(root, (node) =>
    node.nodeName === 'BUTTON' && node.textContent.trim() === label)
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

test('same-account auth refresh keeps the mounted form and its local state', async () => {
  const dom = installWarehouseReactDom()
  window.setTimeout = globalThis.setTimeout
  window.clearTimeout = globalThis.clearTimeout
  const container = dom.createContainer()
  const root = createRoot(container)
  const refresh = deferred()
  let authListener = null
  let validationCount = 0
  let formMounts = 0

  const authService = {
    getSession: async () => SESSION,
    getCurrentEmployee: async () => {
      validationCount += 1
      return validationCount === 1 ? PROFILE : refresh.promise
    },
    onAuthStateChange: (listener) => {
      authListener = listener
      return { unsubscribe() {} }
    },
    logout: async () => {},
  }

  function StatefulForm() {
    const [projectName, setProjectName] = useState('未填写')
    useEffect(() => {
      formMounts += 1
    }, [])
    return createElement(
      'section',
      null,
      createElement('p', null, projectName),
      createElement('button', {
        type: 'button',
        onClick: () => setProjectName('千代田KOKA 5F'),
      }, '填写项目'),
    )
  }

  try {
    await act(async () => root.render(createElement(AuthGate, {
      configured: true,
      authService,
    }, () => createElement(StatefulForm))))
    await flush()
    assert.equal(formMounts, 1)

    await act(async () => button(container, '填写项目').click())
    assert.match(container.textContent, /千代田KOKA 5F/u)

    await act(async () => authListener('SIGNED_IN', SESSION))
    await flush()

    assert.doesNotMatch(container.textContent, /正在确认登录状态/u)
    assert.match(container.textContent, /千代田KOKA 5F/u)

    await act(async () => refresh.resolve(PROFILE))
    assert.equal(formMounts, 1)
    assert.match(container.textContent, /千代田KOKA 5F/u)
  } finally {
    await act(async () => root.unmount())
    dom.cleanup()
  }
})

test('a different authenticated account immediately unmounts the previous runtime', async () => {
  const dom = installWarehouseReactDom()
  window.setTimeout = globalThis.setTimeout
  window.clearTimeout = globalThis.clearTimeout
  const container = dom.createContainer()
  const root = createRoot(container)
  const differentAccountValidation = deferred()
  let authListener = null
  let validationCount = 0

  const authService = {
    getSession: async () => SESSION,
    getCurrentEmployee: async () => {
      validationCount += 1
      return validationCount === 1 ? PROFILE : differentAccountValidation.promise
    },
    onAuthStateChange: (listener) => {
      authListener = listener
      return { unsubscribe() {} }
    },
    logout: async () => {},
  }

  try {
    await act(async () => root.render(createElement(AuthGate, {
      configured: true,
      authService,
    }, () => createElement('p', null, '账号 A 的业务页面'))))
    await flush()
    assert.match(container.textContent, /账号 A 的业务页面/u)

    await act(async () => authListener('SIGNED_IN', {
      access_token: 'access-token-b',
      user: { id: 'auth-user-b' },
    }))
    await flush()

    assert.doesNotMatch(container.textContent, /账号 A 的业务页面/u)
    assert.match(container.textContent, /正在确认登录状态/u)
  } finally {
    differentAccountValidation.resolve({ ...PROFILE, id: 'employee-profile-b' })
    await act(async () => root.unmount())
    dom.cleanup()
  }
})

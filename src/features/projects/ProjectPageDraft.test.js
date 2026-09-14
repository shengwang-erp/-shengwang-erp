import assert from 'node:assert/strict'
import React, { act, createElement } from 'react'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import {
  TestEvent,
  findWarehouseTestElement,
  installWarehouseReactDom,
} from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()
globalThis.React = React

const server = await createServer({
  root: process.cwd(),
  cacheDir: '/private/tmp/project-page-draft-vite-cache',
  configFile: false,
  logLevel: 'silent',
  appType: 'custom',
  server: { middlewareMode: true },
  plugins: [{
    name: 'project-location-picker-test-stub',
    enforce: 'pre',
    resolveId(source) {
      return source === './ProjectLocationPicker.jsx'
        ? '\0project-location-picker-test-stub'
        : null
    },
    load(id) {
      return id === '\0project-location-picker-test-stub'
        ? 'export default function ProjectLocationPicker() { return null }'
        : null
    },
  }],
})
const projectPageModule = await server.ssrLoadModule('/src/features/projects/ProjectPage.jsx')
const ProjectPage = projectPageModule.default
after(() => server.close())

function memoryStorage() {
  const entries = new Map()
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: (key) => entries.delete(key),
    size: () => entries.size,
  }
}

const currentUser = {
  id: 'profile-account-a',
  employeeNumber: 'SW-000',
  name: '系统管理员',
  department: '总务部',
  position: '社长',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
}

function pageProps(overrides = {}) {
  return {
    projects: [],
    projectRevenueSnapshots: {},
    currentUser,
    employeeDirectory: [],
    directoryState: { loading: false, error: '' },
    onRetryDirectory: async () => {},
    onCreateProject: async () => {},
    onUpdateProject: async () => {},
    onDeleteProject: async () => {},
    onOpenContractRevenue() {},
    onOpenMiraisyaProject() {},
    onOpenMiraisyaSettlement() {},
    onBack() {},
    ...overrides,
  }
}

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function button(root, label) {
  return findWarehouseTestElement(root, (element) =>
    element.nodeName === 'BUTTON' && element.textContent.trim() === label)
}

function field(root, label) {
  const wrapper = findWarehouseTestElement(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))
  assert.ok(wrapper, `field ${label}`)
  return elements(wrapper, (element) =>
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName))[0]
}

async function change(control, value) {
  await act(async () => {
    control.value = value
    control.dispatchEvent(new TestEvent('input'))
    control.dispatchEvent(new TestEvent('change'))
  })
}

async function mount(storage, overrides = {}) {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    writable: true,
    value: storage,
  })
  const dom = installWarehouseReactDom()
  window.setTimeout = globalThis.setTimeout
  window.clearTimeout = globalThis.clearTimeout
  window.confirm = () => true
  const container = dom.createContainer()
  const root = createRoot(container)
  await act(async () => root.render(createElement(ProjectPage, pageProps(overrides))))
  return { dom, container, root }
}

test('new-project draft survives remount and failed save, then clears after success', async () => {
  const storage = memoryStorage()
  let mounted = await mount(storage)
  await act(async () => button(mounted.container, '新增小项目').click())
  await change(field(mounted.container, '项目名称'), '千代田KOKA 5F')
  assert.equal(storage.size(), 1)

  await act(async () => mounted.root.unmount())
  mounted.dom.cleanup()
  mounted = await mount(storage, {
    onCreateProject: async () => { throw new Error('network unavailable') },
  })
  assert.equal(field(mounted.container, '项目名称').value, '千代田KOKA 5F')

  const failedForm = findWarehouseTestElement(mounted.container, (element) =>
    element.nodeName === 'FORM' && element.className.includes('lightweight-project-form'))
  await act(async () => failedForm.dispatchEvent(new TestEvent('submit')))
  assert.match(mounted.container.textContent, /项目保存失败/u)
  assert.equal(field(mounted.container, '项目名称').value, '千代田KOKA 5F')
  assert.equal(storage.size(), 1)

  await act(async () => mounted.root.render(createElement(ProjectPage, pageProps())))
  const successfulForm = findWarehouseTestElement(mounted.container, (element) =>
    element.nodeName === 'FORM' && element.className.includes('lightweight-project-form'))
  await act(async () => successfulForm.dispatchEvent(new TestEvent('submit')))
  assert.equal(storage.size(), 0)
  assert.equal(button(mounted.container, '保存项目'), null)

  await act(async () => mounted.root.unmount())
  mounted.dom.cleanup()
  delete globalThis.sessionStorage
})

test('cancel requires confirmation before discarding a new-project draft', async () => {
  const storage = memoryStorage()
  const mounted = await mount(storage)
  await act(async () => button(mounted.container, '新增主项目').click())
  await change(field(mounted.container, '项目名称'), '不能误删的草稿')

  window.confirm = () => false
  await act(async () => button(mounted.container, '取消').click())
  assert.equal(field(mounted.container, '项目名称').value, '不能误删的草稿')
  assert.equal(storage.size(), 1)

  window.confirm = () => true
  await act(async () => button(mounted.container, '取消').click())
  assert.equal(storage.size(), 0)
  assert.equal(button(mounted.container, '保存项目'), null)

  await act(async () => mounted.root.unmount())
  mounted.dom.cleanup()
  delete globalThis.sessionStorage
})

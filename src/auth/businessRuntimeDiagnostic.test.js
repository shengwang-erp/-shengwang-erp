import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBusinessRuntimeDiagnostic,
  formatBusinessRuntimeDiagnostic,
} from './businessRuntimeDiagnostic.js'

const prohibitedTextPattern = /[测试姓名]|秘密工程|plain-secret|plain-token|erp\.example\.test|cdn\.example\.test|\.\.\/projects|\/Users\/yu\/Documents/u

test('builds a frozen allowlisted runtime diagnostic with a stable versioned code', () => {
  const diagnostic = buildBusinessRuntimeDiagnostic({
    error: Object.assign(new TypeError('render failed'), { secret: 'do-not-read' }),
    componentStack: '\n    at BrokenHome (/src/BrokenHome.jsx:8:3)',
    buildId: '6143a6f12345-extra',
    occurredAt: '2026-08-11T08:00:00.000Z',
    runtime: { platform: 'iOS', browser: 'Safari Web App', userAgent: 'forbidden' },
  })

  assert.deepEqual(Object.keys(diagnostic), [
    'category', 'code', 'buildId', 'occurredAt', 'errorName', 'message',
    'componentStack', 'runtime',
  ])
  assert.equal(diagnostic.category, 'UI_RUNTIME_ERROR')
  assert.equal(diagnostic.buildId, '6143a6f12345')
  assert.equal(diagnostic.code, 'UI_RUNTIME_ERROR-6143a6f12345')
  assert.equal(diagnostic.errorName, 'TypeError')
  assert.match(diagnostic.message, /^fingerprint:[0-9a-f]{8}$/u)
  assert.equal(diagnostic.componentStack, 'BrokenHome')
  assert.deepEqual(diagnostic.runtime, { platform: 'iOS', browser: 'Safari Web App' })
  assert.equal(Object.isFrozen(diagnostic), true)
  assert.equal(Object.isFrozen(diagnostic.runtime), true)
  assert.doesNotMatch(formatBusinessRuntimeDiagnostic(diagnostic), /render failed|do-not-read|userAgent/u)
})

test('fingerprints raw messages and projects only safe React component names', () => {
  const rawMessage = '测试姓名 秘密工程 password=plain-secret access_token=plain-token ../projects/42?name=测试 https://erp.example.test/orders/42?access_token=plain-token /Users/yu/Documents/秘密工程/data.json'
  const rawStack = `
    arbitrary 测试姓名 password=plain-secret
    at InvoicePage (../projects/42?access_token=plain-token)
    at ProjectPanel (https://cdn.example.test/ProjectPanel.jsx:18:7)
    at SecretPanel (/Users/yu/Documents/秘密工程/SecretPanel.jsx:9:2)`
  const first = buildBusinessRuntimeDiagnostic({
    error: new Error(rawMessage),
    componentStack: rawStack,
  })
  const same = buildBusinessRuntimeDiagnostic({
    error: new Error(rawMessage),
    componentStack: rawStack,
  })
  const different = buildBusinessRuntimeDiagnostic({
    error: new Error(`${rawMessage}!`),
    componentStack: rawStack,
  })
  const text = formatBusinessRuntimeDiagnostic(first)

  assert.match(first.message, /^fingerprint:[0-9a-f]{8}$/u)
  assert.equal(first.message, same.message)
  assert.notEqual(first.message, different.message)
  assert.equal(first.componentStack, 'InvoicePage\nProjectPanel\nSecretPanel')
  assert.doesNotMatch(text, prohibitedTextPattern)
  assert.doesNotMatch(first.componentStack, /[:?\/\\]/u)
})

test('maps error names and runtime fields to closed enums', () => {
  const hostile = buildBusinessRuntimeDiagnostic({
    error: { name: 'CustomSW-008测试姓名', message: 'failure' },
    runtime: {
      platform: 'iOS SW-008 测试姓名 https://erp.example.test',
      browser: 'Bearer plain-token',
    },
  })
  const allowed = buildBusinessRuntimeDiagnostic({
    error: { name: 'RangeError', message: 'failure' },
    runtime: { platform: 'iOS', browser: 'Firefox iOS' },
  })
  const text = formatBusinessRuntimeDiagnostic(hostile)

  assert.equal(hostile.errorName, 'Error')
  assert.deepEqual(hostile.runtime, { platform: 'Other', browser: 'Web Browser' })
  assert.equal(allowed.errorName, 'RangeError')
  assert.deepEqual(allowed.runtime, { platform: 'iOS', browser: 'Firefox iOS' })
  assert.doesNotMatch(text, /SW-008|测试姓名|erp\.example\.test|plain-token/u)
})

test('never invokes untrusted accessors and survives throwing proxy traps', () => {
  let getterCalls = 0
  const throwingAccessors = {}
  Object.defineProperties(throwingAccessors, {
    name: { get() { getterCalls += 1; throw new Error('name getter ran') } },
    message: { get() { getterCalls += 1; throw new Error('message getter ran') } },
  })
  const runtimeAccessors = {}
  Object.defineProperties(runtimeAccessors, {
    platform: { get() { getterCalls += 1; throw new Error('platform getter ran') } },
    browser: { get() { getterCalls += 1; throw new Error('browser getter ran') } },
  })
  const proxy = new Proxy({}, {
    get() { throw new Error('get trap ran') },
    getOwnPropertyDescriptor() { throw new Error('descriptor trap ran') },
  })

  const accessorDiagnostic = buildBusinessRuntimeDiagnostic({
    error: throwingAccessors,
    runtime: runtimeAccessors,
  })
  let proxyDiagnostic
  let proxyText
  assert.doesNotThrow(() => { proxyDiagnostic = buildBusinessRuntimeDiagnostic(proxy) })
  assert.doesNotThrow(() => { proxyText = formatBusinessRuntimeDiagnostic(proxy) })

  assert.equal(getterCalls, 0)
  assert.equal(accessorDiagnostic.errorName, 'Error')
  assert.match(accessorDiagnostic.message, /^fingerprint:[0-9a-f]{8}$/u)
  assert.deepEqual(accessorDiagnostic.runtime, { platform: 'Other', browser: 'Web Browser' })
  assert.equal(proxyDiagnostic.errorName, 'Error')
  assert.match(proxyText, /UI_RUNTIME_ERROR/u)
})

test('formatter projects only approved diagnostic fields from untrusted input', () => {
  const text = formatBusinessRuntimeDiagnostic({
    buildId: 'abcdef123456',
    errorName: 'Error',
    message: '测试姓名 secret message',
    componentStack: '\n    at Home (/src/Home.jsx:1:1)',
    runtime: { platform: 'iOS', browser: 'Safari Web App' },
    currentUser: { name: '测试姓名', employeeNumber: 'SW-008', accessToken: 'secret-token' },
    project: { projectName: '秘密工程' },
  })

  assert.deepEqual(Object.keys(JSON.parse(text)), [
    'category', 'code', 'buildId', 'occurredAt', 'errorName', 'message',
    'componentStack', 'runtime',
  ])
  assert.doesNotMatch(text, /测试姓名|SW-008|secret-token|秘密工程|secret message/u)
})

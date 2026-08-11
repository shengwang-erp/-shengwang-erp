import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildBusinessRuntimeDiagnostic,
  formatBusinessRuntimeDiagnostic,
} from './businessRuntimeDiagnostic.js'

test('builds a frozen bounded runtime diagnostic with a stable versioned code', () => {
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
  assert.equal(diagnostic.message, 'render failed')
  assert.deepEqual(diagnostic.runtime, { platform: 'iOS', browser: 'Safari Web App' })
  assert.equal(Object.isFrozen(diagnostic), true)
  assert.equal(Object.isFrozen(diagnostic.runtime), true)
  assert.doesNotMatch(formatBusinessRuntimeDiagnostic(diagnostic), /do-not-read|userAgent/u)
})

test('bounds text and redacts credential-shaped values', () => {
  const diagnostic = buildBusinessRuntimeDiagnostic({
    error: new Error('SW-008 Bearer abc.def.ghi person@example.com ' + 'x'.repeat(800)),
    componentStack: 'at View ' + 'y'.repeat(5000),
    buildId: '',
    occurredAt: 'invalid',
    runtime: { platform: 'unknown', browser: 'unknown' },
  })
  const text = formatBusinessRuntimeDiagnostic(diagnostic)

  assert.doesNotMatch(text, /SW-008|abc\.def\.ghi|person@example\.com/u)
  assert.match(text, /\[REDACTED_EMPLOYEE\]|\[REDACTED_TOKEN\]|\[REDACTED_EMAIL\]/u)
  assert.equal(diagnostic.buildId, 'unversioned')
  assert.ok(diagnostic.message.length <= 320)
  assert.ok(diagnostic.componentStack.length <= 2400)
})

test('redacts credentials before applying field bounds', () => {
  const diagnostic = buildBusinessRuntimeDiagnostic({
    error: {
      name: 'n'.repeat(67) + 'person@example.com',
      message: 'm'.repeat(307) + 'person@example.com',
    },
    componentStack: 's'.repeat(2387) + 'person@example.com',
  })
  const text = formatBusinessRuntimeDiagnostic(diagnostic)

  assert.doesNotMatch(diagnostic.errorName, /person@exampl/u)
  assert.doesNotMatch(diagnostic.message, /person@exampl/u)
  assert.doesNotMatch(diagnostic.componentStack, /person@exampl/u)
  assert.doesNotMatch(text, /person@exampl/u)
})

test('redacts URLs from error messages and component source stacks before formatting', () => {
  const messageUrl = 'https://erp.example.test/orders/42?access_token=private-token'
  const sourceUrl = 'https://cdn.example.test/assets/InvoicePage.jsx:18:7'
  const diagnostic = buildBusinessRuntimeDiagnostic({
    error: new Error(`Invoice view failed at ${messageUrl}`),
    componentStack: `\n    at InvoicePage (${sourceUrl})`,
  })
  const text = formatBusinessRuntimeDiagnostic(diagnostic)

  assert.doesNotMatch(text, /erp\.example\.test|cdn\.example\.test|private-token/u)
  assert.match(text, /\[REDACTED_URL\]/u)
})

test('formatter projects only approved diagnostic fields from untrusted input', () => {
  const text = formatBusinessRuntimeDiagnostic({
    buildId: 'abcdef123456',
    errorName: 'Error',
    message: 'safe message',
    componentStack: 'at Home',
    runtime: { platform: 'iOS', browser: 'Safari Web App' },
    currentUser: { name: '测试姓名', employeeNumber: 'SW-008', accessToken: 'secret-token' },
    project: { projectName: '秘密工程' },
  })

  assert.deepEqual(Object.keys(JSON.parse(text)), [
    'category', 'code', 'buildId', 'occurredAt', 'errorName', 'message',
    'componentStack', 'runtime',
  ])
  assert.doesNotMatch(text, /测试姓名|SW-008|secret-token|秘密工程/u)
})

test('does not serialize unrelated user or business objects', () => {
  const diagnostic = buildBusinessRuntimeDiagnostic({
    error: new Error('render failed'),
    componentStack: 'at Home',
    buildId: 'abcdef123456',
    occurredAt: '2026-08-11T08:00:00.000Z',
    runtime: { platform: 'iOS', browser: 'Safari Web App' },
    currentUser: { name: '测试姓名', employeeNumber: 'SW-008', accessToken: 'secret-token' },
    project: { projectName: '秘密工程' },
  })
  const text = formatBusinessRuntimeDiagnostic(diagnostic)
  assert.doesNotMatch(text, /测试姓名|SW-008|secret-token|秘密工程/u)
})

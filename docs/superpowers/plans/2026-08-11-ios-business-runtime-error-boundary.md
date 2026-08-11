# iOS Business Runtime Error Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the post-login ERP grid-only failure with a safe diagnostic page that can identify the real iPhone/SW-008 runtime error without exposing account or business data.

**Architecture:** Add a pure diagnostic projector and a React class error boundary under `AuthGate` but around `AuthenticatedApp`. The boundary receives only recovery callbacks, is keyed by the authenticated profile UUID so errors cannot cross accounts, and formats bounded non-sensitive diagnostics locally without adding remote logging or database state.

**Tech Stack:** React 19, Vite 6, Node test runner, existing lightweight React DOM test utilities, CSS, Vercel CLI.

## Global Constraints

- Do not change permissions, authentication decisions, employee records, Supabase schema, or business data.
- Do not add dependencies, remote error logging, analytics, or database tables.
- Diagnostics must not inspect or serialize props, React state, URLs, storage, sessions, tokens, employee profiles, or business records.
- The error boundary catches React render, constructor, and lifecycle failures; it does not claim to catch event-handler or detached asynchronous failures.
- The fallback must provide `复制诊断信息`, `重新加载`, and `退出登录` recovery paths on iPhone-sized screens.
- The deployment build ID must be passed through `VITE_ERP_BUILD_ID` and must equal the deployed commit's 12-character Git SHA.
- Follow TDD: observe each target test fail before implementing the code that makes it pass.

---

## File Map

- Create `src/auth/businessRuntimeDiagnostic.js`: build and format a bounded, non-sensitive diagnostic record.
- Create `src/auth/businessRuntimeDiagnostic.test.js`: pure diagnostic projection and redaction tests.
- Create `src/auth/BusinessRuntimeBoundary.jsx`: React error boundary and fallback recovery UI.
- Create `src/auth/BusinessRuntimeBoundary.test.js`: real React crash, copy, reload, logout, fallback, and remount tests.
- Modify `src/App.jsx`: mount the boundary inside `AuthGate` and key it by authenticated profile UUID.
- Modify `src/auth/frontendAuthContract.test.js`: enforce the authentication/error-boundary placement and data-minimizing interface.
- Modify `src/styles.css`: mobile-safe diagnostic panel, read-only details, and recovery actions.

### Task 1: Safe Runtime Diagnostic Projector

**Files:**
- Create: `src/auth/businessRuntimeDiagnostic.js`
- Create: `src/auth/businessRuntimeDiagnostic.test.js`

**Interfaces:**
- Consumes: `{ error, componentStack, buildId, occurredAt, runtime }`, where every field is optional and caller-supplied values are untrusted.
- Produces: `buildBusinessRuntimeDiagnostic(input) -> frozen diagnostic object` and `formatBusinessRuntimeDiagnostic(diagnostic) -> string`.
- Diagnostic object keys are exactly `category`, `code`, `buildId`, `occurredAt`, `errorName`, `message`, `componentStack`, and `runtime`.

- [ ] **Step 1: Write the failing pure tests**

Create `src/auth/businessRuntimeDiagnostic.test.js` with the following imports and test cases:

```js
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
```

- [ ] **Step 2: Run the tests and confirm RED**

Run:

```bash
node --test src/auth/businessRuntimeDiagnostic.test.js
```

Expected: FAIL because `businessRuntimeDiagnostic.js` does not exist.

- [ ] **Step 3: Implement the minimal pure projector**

Create `src/auth/businessRuntimeDiagnostic.js` with these rules and concrete exports:

```js
const MESSAGE_LIMIT = 320
const STACK_LIMIT = 2400
const BUILD_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/u

function bounded(value, limit, fallback = '') {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit)
    : fallback
}

function redact(value) {
  return value
    .replace(/\bSW-\d{3,}\b/giu, '[REDACTED_EMPLOYEE]')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [REDACTED_TOKEN]')
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[REDACTED_TOKEN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
}

function safeBuildId(value) {
  const candidate = bounded(value, 64)
  if (!BUILD_ID_PATTERN.test(candidate)) return 'unversioned'
  return candidate.slice(0, 12)
}

function safeOccurredAt(value) {
  if (typeof value !== 'string') return 'unknown'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : 'unknown'
}

export function buildBusinessRuntimeDiagnostic(input = {}) {
  const buildId = safeBuildId(input.buildId)
  const errorName = redact(bounded(input.error?.name, 80, 'Error'))
  const message = redact(bounded(input.error?.message, MESSAGE_LIMIT, 'Unknown render failure'))
  const componentStack = redact(bounded(input.componentStack, STACK_LIMIT, 'Unavailable'))
  const platform = bounded(input.runtime?.platform, 40, 'Unknown')
  const browser = bounded(input.runtime?.browser, 40, 'Unknown')
  return Object.freeze({
    category: 'UI_RUNTIME_ERROR',
    code: `UI_RUNTIME_ERROR-${buildId}`,
    buildId,
    occurredAt: safeOccurredAt(input.occurredAt),
    errorName,
    message,
    componentStack,
    runtime: Object.freeze({ platform, browser }),
  })
}

export function formatBusinessRuntimeDiagnostic(diagnostic) {
  return JSON.stringify(diagnostic, null, 2)
}
```

- [ ] **Step 4: Run the target tests and confirm GREEN**

Run:

```bash
node --test src/auth/businessRuntimeDiagnostic.test.js
```

Expected: all diagnostic tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/auth/businessRuntimeDiagnostic.js src/auth/businessRuntimeDiagnostic.test.js
git commit -m "feat: add safe business runtime diagnostics"
```

### Task 2: React Business Runtime Boundary and Recovery UI

**Files:**
- Create: `src/auth/BusinessRuntimeBoundary.jsx`
- Create: `src/auth/BusinessRuntimeBoundary.test.js`
- Modify: `src/styles.css:2349-2592`

**Interfaces:**
- Consumes props `{ children, onLogout, onReload, copyText, buildId, now, runtime }`.
- `onLogout() -> void | Promise<void>` clears the session through `AuthGate`.
- `onReload() -> void` defaults to `window.location.reload()`.
- `copyText(text) -> Promise<void>` defaults to `navigator.clipboard.writeText(text)` when available and rejects otherwise.
- Produces either untouched children or a branded fallback with safe diagnostics and three recovery controls.

- [ ] **Step 1: Write the failing React boundary tests**

Create `src/auth/BusinessRuntimeBoundary.test.js` with this test harness before the test cases:

```js
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
```

Append these exact test cases:

```js
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
  assert.doesNotMatch(field.value, /测试姓名|SW-008|秘密工程/u)
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
```

Silence only React's expected test error output with a scoped `console.error` replacement restored in `finally`; never suppress application errors globally.

- [ ] **Step 2: Run the boundary tests and confirm RED**

Run:

```bash
node --test src/auth/BusinessRuntimeBoundary.test.js
```

Expected: FAIL because `BusinessRuntimeBoundary.jsx` does not exist.

- [ ] **Step 3: Implement the class error boundary**

Create `src/auth/BusinessRuntimeBoundary.jsx` with this complete component structure. Keep the imports and public interface exact; minor formatting changes are allowed, but no user or business object may be added to the diagnostic input:

```js
import { Component } from 'react'

import {
  buildBusinessRuntimeDiagnostic,
  formatBusinessRuntimeDiagnostic,
} from './businessRuntimeDiagnostic.js'

const defaultReload = () => window.location.reload()
const defaultNow = () => new Date().toISOString()
const defaultCopy = (text) => {
  if (!globalThis.navigator?.clipboard?.writeText) {
    return Promise.reject(new Error('clipboard unavailable'))
  }
  return globalThis.navigator.clipboard.writeText(text)
}

export function detectBusinessRuntime() {
  const userAgent = typeof globalThis.navigator?.userAgent === 'string'
    ? globalThis.navigator.userAgent
    : ''
  const isIOS = /iPhone|iPad|iPod/iu.test(userAgent)
  const browser = /CriOS/iu.test(userAgent)
    ? 'Chrome iOS'
    : /FxiOS/iu.test(userAgent)
      ? 'Firefox iOS'
      : isIOS ? 'Safari Web App' : 'Web Browser'
  return { platform: isIOS ? 'iOS' : 'Other', browser }
}

export default class BusinessRuntimeBoundary extends Component {
  state = { error: null, diagnostic: null, copyStatus: '' }

  static getDerivedStateFromError(error) {
    return { error, diagnostic: null, copyStatus: '' }
  }

  componentDidCatch(error, info) {
    this.setState({
      diagnostic: this.createDiagnostic(error, info?.componentStack),
    })
  }

  createDiagnostic(error, componentStack = '') {
    const now = this.props.now || defaultNow
    const runtime = this.props.runtime || detectBusinessRuntime
    return buildBusinessRuntimeDiagnostic({
      error,
      componentStack,
      buildId: this.props.buildId,
      occurredAt: now(),
      runtime: runtime(),
    })
  }

  copy = async () => {
    const copyText = this.props.copyText || defaultCopy
    try {
      await copyText(formatBusinessRuntimeDiagnostic(this.currentDiagnostic()))
      this.setState({ copyStatus: '诊断信息已复制' })
    } catch {
      this.setState({ copyStatus: '复制失败，请长按下面的诊断信息手动复制。' })
    }
  }

  reload = () => (this.props.onReload || defaultReload)()

  logout = async () => {
    try {
      await this.props.onLogout?.()
    } catch {
      this.setState({ copyStatus: '退出失败，请关闭页面后重试。' })
    }
  }

  currentDiagnostic() {
    return this.state.diagnostic || this.createDiagnostic(this.state.error)
  }

  render() {
    if (!this.state.error) return this.props.children
    const diagnostic = this.currentDiagnostic()
    const diagnosticText = formatBusinessRuntimeDiagnostic(diagnostic)
    return (
      <main className="auth-shell business-runtime-error-shell">
        <section className="auth-panel auth-status-panel" role="alert">
          <img className="auth-brand-mark" src="/sw-erp-logo.jpg" alt="生旺株式会社标志" />
          <p>生旺株式会社 · ERP 数据中心</p>
          <h1>系统页面发生错误</h1>
          <span>业务界面已安全停止。请复制诊断信息后重新加载，或退出登录。</span>
          <strong className="business-runtime-error-code">{diagnostic.code}</strong>
          <textarea
            className="business-runtime-diagnostic"
            aria-label="诊断信息"
            readOnly
            value={diagnosticText}
          />
          {this.state.copyStatus && <span role="status">{this.state.copyStatus}</span>}
          <div className="auth-account-actions business-runtime-actions">
            <button className="auth-primary-button" type="button" onClick={this.copy}>复制诊断信息</button>
            <button className="auth-secondary-button" type="button" onClick={this.reload}>重新加载</button>
            <button className="auth-secondary-button" type="button" onClick={this.logout}>退出登录</button>
          </div>
        </section>
      </main>
    )
  }
}
```

The component must not accept `currentUser`, `employee`, `session`, or arbitrary metadata props, and must pass only `{ error, componentStack, buildId, occurredAt, runtime }` into `buildBusinessRuntimeDiagnostic`.

- [ ] **Step 4: Add mobile-safe fallback styles**

Append focused rules next to the existing auth styles in `src/styles.css`:

```css
.business-runtime-error-code {
  margin-top: 12px;
  color: #f0c874;
  overflow-wrap: anywhere;
}

.business-runtime-diagnostic {
  width: 100%;
  min-height: 180px;
  margin-top: 12px;
  padding: 12px;
  resize: vertical;
  color: #e8dcc2;
  background: rgba(4, 4, 3, 0.72);
  border: 1px solid rgba(210, 168, 81, 0.28);
  border-radius: 8px;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
}

.business-runtime-actions {
  grid-template-columns: 1fr;
}
```

- [ ] **Step 5: Run target tests and confirm GREEN**

Run:

```bash
node --test src/auth/businessRuntimeDiagnostic.test.js src/auth/BusinessRuntimeBoundary.test.js
```

Expected: all diagnostic and boundary tests PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/auth/BusinessRuntimeBoundary.jsx src/auth/BusinessRuntimeBoundary.test.js src/styles.css
git commit -m "feat: show safe fallback for business UI crashes"
```

### Task 3: Authenticated Application Wiring and Account Isolation

**Files:**
- Modify: `src/App.jsx:9783-9797`
- Modify: `src/auth/frontendAuthContract.test.js:1-110`

**Interfaces:**
- Consumes: `AuthGate` render values `currentUser`, `onLogout`, and `onRefreshCurrentUser`.
- Produces: `BusinessRuntimeBoundary key={currentUser.id}` wrapping exactly one `AuthenticatedApp` instance.
- Build version source: `import.meta.env.VITE_ERP_BUILD_ID || 'unversioned'` passed as `buildId`.

- [ ] **Step 1: Extend the auth contract test and confirm RED**

Update `src/auth/frontendAuthContract.test.js` to load `BusinessRuntimeBoundary.jsx` and assert:

```js
test('authenticated business UI is isolated by a profile-keyed runtime boundary', () => {
  assert.match(appSource, /import BusinessRuntimeBoundary from '\.\/auth\/BusinessRuntimeBoundary'/u)
  assert.match(
    appSource,
    /<BusinessRuntimeBoundary[\s\S]*?key=\{currentUser\.id\}[\s\S]*?onLogout=\{onLogout\}[\s\S]*?<AuthenticatedApp/u,
  )
  assert.match(appSource, /buildId=\{import\.meta\.env\.VITE_ERP_BUILD_ID \|\| 'unversioned'\}/u)
  assert.doesNotMatch(boundarySource, /currentUser|employeeNumber|accessToken|localStorage|sessionStorage/u)
})
```

Run:

```bash
node --test src/auth/frontendAuthContract.test.js
```

Expected: FAIL because the boundary is not imported or mounted.

- [ ] **Step 2: Wire the boundary inside `AuthGate`**

Modify the bottom of `src/App.jsx` to:

```jsx
function App() {
  return (
    <AuthGate>
      {({ currentUser, onLogout, onRefreshCurrentUser }) => (
        <BusinessRuntimeBoundary
          key={currentUser.id}
          onLogout={onLogout}
          buildId={import.meta.env.VITE_ERP_BUILD_ID || 'unversioned'}
        >
          <AuthenticatedApp
            currentUser={currentUser}
            onLogout={onLogout}
            onRefreshCurrentUser={onRefreshCurrentUser}
          />
        </BusinessRuntimeBoundary>
      )}
    </AuthGate>
  )
}
```

Add only the corresponding import near the existing `AuthGate` import. Do not move the boundary above `AuthGate` and do not pass `currentUser` into the boundary.

- [ ] **Step 3: Add and run the cross-account remount test**

In `BusinessRuntimeBoundary.test.js`, render the boundary with `key="actor-a"` and a throwing child, then rerender it with `key="actor-b"` and a healthy child. Assert the old diagnostic disappears and the healthy text is present:

```js
await act(async () => root.render(createElement(BusinessRuntimeBoundary, {
  key: 'actor-a', onLogout() {},
}, createElement(BrokenView))))
assert.match(container.textContent, /系统页面发生错误/u)
await act(async () => root.render(createElement(BusinessRuntimeBoundary, {
  key: 'actor-b', onLogout() {},
}, createElement('p', null, 'new actor healthy'))))
assert.equal(container.textContent, 'new actor healthy')
```

- [ ] **Step 4: Run integration targets and confirm GREEN**

Run:

```bash
node --test \
  src/auth/businessRuntimeDiagnostic.test.js \
  src/auth/BusinessRuntimeBoundary.test.js \
  src/auth/frontendAuthContract.test.js \
  src/features/attendance/todayAttendanceAppIntegration.test.js \
  src/desktopAdminShell.test.js
```

Expected: all tests PASS and existing AuthGate/Desktop shell contracts remain intact.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/App.jsx src/auth/BusinessRuntimeBoundary.test.js src/auth/frontendAuthContract.test.js
git commit -m "feat: isolate authenticated business runtime failures"
```

### Task 4: Full Verification and Production Diagnostic Deployment

**Files:**
- Verify only; no database or migration files are created or changed.

**Interfaces:**
- Consumes: the three implementation commits from Tasks 1–3.
- Produces: a verified production deployment whose build ID equals the 12-character deployed Git SHA.

- [ ] **Step 1: Confirm repository scope**

Run:

```bash
git status --short
git diff --check HEAD~3..HEAD
git log -4 --oneline
```

Expected: no uncommitted files, no whitespace errors, and only the approved diagnostic implementation commits after the design/plan commits.

- [ ] **Step 2: Run the full automated suite**

Run:

```bash
npm test
```

Expected: exit 0 with every test passing.

- [ ] **Step 3: Build with the exact commit identifier**

Run:

```bash
ERP_BUILD_ID="$(git rev-parse --short=12 HEAD)"
VITE_ERP_BUILD_ID="$ERP_BUILD_ID" npm run build
```

Expected: Vite production build exits 0 and the generated bundle contains `UI_RUNTIME_ERROR-` plus the exact `$ERP_BUILD_ID` value.

Verify without printing secrets:

```bash
rg -l "UI_RUNTIME_ERROR-${ERP_BUILD_ID}" dist/assets
```

Expected: exactly one generated JavaScript asset path is printed.

- [ ] **Step 4: Deploy the same build identifier to the existing Vercel project**

Run:

```bash
vercel --prod --yes --build-env VITE_ERP_BUILD_ID="$ERP_BUILD_ID"
```

Expected: deployment status `Ready` and production alias `https://shengwang-erp.vercel.app` points to the new deployment.

- [ ] **Step 5: Verify production availability and deployment metadata**

Run:

```bash
curl -I https://shengwang-erp.vercel.app
vercel inspect https://shengwang-erp.vercel.app
```

Expected: HTTP 200, Vercel status `Ready`, and no database migration step.

- [ ] **Step 6: Obtain the root-cause evidence**

Ask the user to force-close the iPhone home-screen ERP, reopen it, log in as SW-008, and send a screenshot or copied diagnostic JSON. Confirm the displayed code contains the deployed 12-character Git SHA before interpreting the error. Do not propose the root-cause fix until the diagnostic message and component stack identify the failing component.

---

## Completion Criteria

- A React business render failure produces a branded diagnostic page, not a grid-only screen.
- Diagnostic output contains the deployed build ID and bounded error/component information.
- Tests prove unrelated user and business objects are not serialized.
- Copy failure still leaves selectable read-only diagnostics.
- Reload and logout each remain usable on mobile.
- Switching authenticated profile UUID remounts a clean boundary.
- Full tests and production build pass.
- Production deploy is `Ready`, returns HTTP 200, and requires no Supabase migration.

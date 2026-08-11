# 保存成功后的认证刷新与误退出修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 权限模板或项目保存成功后保持有效登录；临时认证读取错误进入可重试状态，只有真实认证失效才注销。

**Architecture:** `AuthGate` 作为唯一会话处置边界，通过纯函数区分终止性与可重试错误，并向业务层暴露 `onRefreshCurrentUser`。人员管理只请求刷新当前账号，不再把权限模板保存回调连接到 `onLogout`；项目保存代码保持不变并自动受统一认证边界保护。

**Tech Stack:** React 19、Vite 6、Supabase JS、Node.js `node:test`

## Global Constraints

- 所有有权维护权限模板的账号使用同一刷新逻辑，不为 `SW-000` 增加特例。
- 验证不确定时不渲染 ERP 业务页面，但保留 Supabase session 并提供重新验证。
- 只有终止性认证错误或无 access token 才进入登录页。
- 不修改数据库、权限模板 RPC 或项目写入 RPC。
- 生产域名保持 `https://shengwang-erp.vercel.app`。

---

### Task 1: 认证失败分类与可重试验证状态

**Files:**
- Modify: `src/auth/authGateSession.js`
- Modify: `src/auth/authGateSession.test.js`
- Modify: `src/auth/AuthGate.jsx`
- Modify: `src/auth/frontendAuthContract.test.js`

**Interfaces:**
- Produces: `isTerminalAuthError(error): boolean`
- Produces: AuthGate render prop `onRefreshCurrentUser(): Promise<CurrentUser>`
- Produces: `validation-error` 状态，包含 `重新验证` 与 `退出登录` 操作

- [ ] **Step 1: 写终止性与可重试错误的失败测试**

在 `src/auth/authGateSession.test.js` 增加真实纯函数测试：

```js
test('only terminal authentication errors require session invalidation', () => {
  for (const code of ['AUTH_INVALID', 'AUTH_SESSION_INVALID', 'AUTH_TOKEN_INVALID',
    'ACCOUNT_DISABLED', 'ACCOUNT_UNAVAILABLE', 'EMPLOYEE_INACTIVE',
    'EMPLOYEE_NOT_LINKED', 'PASSWORD_STATE_SYNC_FAILED']) {
    assert.equal(isTerminalAuthError({ code }), true)
  }
  assert.equal(isTerminalAuthError({ code: 'AUTH_SERVICE_UNAVAILABLE' }), false)
  assert.equal(isTerminalAuthError(new Error('network unavailable')), false)
})
```

在 `src/auth/frontendAuthContract.test.js` 增加源码契约断言：可重试错误不得无条件调用 `moveToLogin`，必须渲染“认证服务暂不可用”“重新验证”“退出登录”，并向 children 暴露 `onRefreshCurrentUser`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/auth/authGateSession.test.js src/auth/frontendAuthContract.test.js`

Expected: FAIL，原因是 `isTerminalAuthError`、`validation-error` 或 `onRefreshCurrentUser` 尚不存在。

- [ ] **Step 3: 实现最小认证边界修改**

在 `authGateSession.js` 集中终止性代码并导出：

```js
const TERMINAL_AUTH_ERROR_CODES = new Set([
  'ACCOUNT_DISABLED', 'ACCOUNT_UNAVAILABLE', 'AUTH_INVALID',
  'AUTH_SESSION_INVALID', 'AUTH_TOKEN_INVALID', 'EMPLOYEE_INACTIVE',
  'EMPLOYEE_NOT_LINKED', 'PASSWORD_STATE_SYNC_FAILED',
])

export function isTerminalAuthError(error) {
  return TERMINAL_AUTH_ERROR_CODES.has(error?.code)
}
```

在 `AuthGate.jsx`：

- 删除本地重复的终止性集合并导入 `isTerminalAuthError`。
- `performSessionValidation` 捕获终止性错误时调用 `moveToLogin`；其他错误设置 `{ status: 'validation-error', currentUser: null }`，不调用 `logout`。
- 增加 `onRefreshCurrentUser`：读取 session、运行现有合并验证、成功返回最新账号，失败时让认证边界保持已决定的状态并抛出安全错误。
- 增加重新验证处理函数；读取 session 的临时失败同样进入 `validation-error`。
- 在 `validation-error` 状态渲染 fail-closed 状态页和两个按钮。
- children render prop 改为 `{ currentUser, onLogout: moveToLogin, onRefreshCurrentUser }`。

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Run: `node --test src/auth/authGateSession.test.js src/auth/frontendAuthContract.test.js`

Expected: PASS。

- [ ] **Step 5: 提交 Task 1**

```bash
git add src/auth/authGateSession.js src/auth/authGateSession.test.js src/auth/AuthGate.jsx src/auth/frontendAuthContract.test.js
git commit -m "fix: preserve sessions on retryable auth validation"
```

---

### Task 2: 权限保存后刷新当前账号而非注销

**Files:**
- Modify: `src/features/employees/permissionTemplateEditorState.js`
- Modify: `src/features/employees/permissionTemplateEditorState.test.js`
- Modify: `src/features/employees/personnelPageContract.test.js`
- Modify: `src/App.jsx`
- Modify: `src/auth/frontendAuthContract.test.js`

**Interfaces:**
- Consumes: `onRefreshCurrentUser(): Promise<CurrentUser>` from Task 1
- Produces: `onPermissionTemplatesChanged={onRefreshCurrentUser}`
- Preserves: `onAuthInvalid={onLogout}` 仅用于权限服务直接返回终止性错误

- [ ] **Step 1: 写权限刷新失败不注销的失败测试**

在 `permissionTemplateEditorState.test.js` 增加：

```js
test('retryable account refresh failure never delegates logout', async () => {
  let invalidations = 0
  const refreshed = await refreshAuthorizationAfterTemplateSave({
    snapshot: { departments: {}, positions: {} },
    onTemplatesChanged: async () => { throw new Error('temporary failure') },
    onAuthInvalid: async () => { invalidations += 1 },
  })
  assert.equal(refreshed, false)
  assert.equal(invalidations, 0)
})
```

更新 `personnelPageContract.test.js` 与 `frontendAuthContract.test.js`：

```js
assert.match(appSource, /onPermissionTemplatesChanged=\{onRefreshCurrentUser\}/)
assert.doesNotMatch(appSource, /onPermissionTemplatesChanged=\{onLogout\}/)
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/features/employees/permissionTemplateEditorState.test.js src/features/employees/personnelPageContract.test.js src/auth/frontendAuthContract.test.js`

Expected: FAIL，现有回调失败会调用 `onAuthInvalid`，且 App 仍连接 `onLogout`。

- [ ] **Step 3: 实现最小权限刷新连接**

修改 `refreshAuthorizationAfterTemplateSave`：存在刷新回调时只返回刷新成功或失败，不因普通刷新失败调用 `onAuthInvalid`；只有缺少刷新回调时才沿用 fail-closed invalidation。

修改 `App.jsx`：

```jsx
export function AuthenticatedApp({ currentUser, onLogout, onRefreshCurrentUser })
```

人员管理连接：

```jsx
onPermissionTemplatesChanged={onRefreshCurrentUser}
```

入口连接：

```jsx
{({ currentUser, onLogout, onRefreshCurrentUser }) => (
  <AuthenticatedApp
    currentUser={currentUser}
    onLogout={onLogout}
    onRefreshCurrentUser={onRefreshCurrentUser}
  />
)}
```

- [ ] **Step 4: 运行定向测试并确认 GREEN**

Run: `node --test src/features/employees/permissionTemplateEditorState.test.js src/features/employees/personnelPageContract.test.js src/auth/frontendAuthContract.test.js`

Expected: PASS。

- [ ] **Step 5: 提交 Task 2**

```bash
git add src/features/employees/permissionTemplateEditorState.js src/features/employees/permissionTemplateEditorState.test.js src/features/employees/personnelPageContract.test.js src/App.jsx src/auth/frontendAuthContract.test.js
git commit -m "fix: refresh permissions without signing out"
```

---

### Task 3: 完整验证与正式部署

**Files:**
- Verify only: complete repository

**Interfaces:**
- Consumes: Task 1 and Task 2 committed behavior
- Produces: verified production deployment

- [ ] **Step 1: 运行认证与项目回归集合**

Run: `node --test src/auth/*.test.js src/features/employees/*.test.js src/features/projects/*.test.js`

Expected: PASS，0 failures。

- [ ] **Step 2: 运行完整测试**

Run: `npm test`

Expected: 0 failures。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: Vite build exit 0。

- [ ] **Step 4: 检查提交树与敏感文件**

Run: `git status --short --branch`

Expected: 工作区无未提交源码；`.env.local`、`.vercel/`、`supabase/.temp/` 均被忽略。

- [ ] **Step 5: 部署 Vercel 正式环境**

Run: `vercel --prod --yes`

Expected: `readyState: READY`，alias 为 `https://shengwang-erp.vercel.app`。

- [ ] **Step 6: 验证正式网址**

Run: `curl -I https://shengwang-erp.vercel.app`

Expected: HTTP 200。

- [ ] **Step 7: 记录最终版本**

Run: `git rev-parse HEAD`

Expected: 输出包含 Task 1 与 Task 2 的最终 Git 版本；本任务不执行数据库迁移。

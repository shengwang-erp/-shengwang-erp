# 保存成功后的认证刷新与误退出修复设计

## 背景与根因

线上存在两种“数据已经保存，但随后返回登录页”的表现：

1. 人员管理中的部门或职位权限模板保存成功后退出。根因是 `App` 把 `PermissionTemplateEditor` 的权限刷新回调直接连接到 `onLogout`，因此正常保存会主动注销。
2. 设计部等普通账号新增项目成功后偶发退出。项目保存路径本身没有注销调用；风险来自 `AuthGate` 的会话重新验证：当前实现把 `getCurrentEmployee()` 的所有异常都视为登录失效并调用 `logout()`，包括短暂网络或认证服务不可用。

这两种表现不共享同一条直接调用链，但都源于“刷新/验证失败与真正认证失效没有被正确区分”。

## 目标

- 所有有权维护权限模板的账号保存后自动刷新当前账号资料与有效权限，并继续保持登录。
- 项目保存或其他业务操作触发会话重新验证时，短暂服务错误不得注销有效会话。
- 只有令牌无效、账号停用、员工未关联、必须修改密码等终止性认证错误才能注销。
- 验证不确定时继续保持业务界面关闭，避免使用陈旧权限；用户可以重新验证或主动退出。
- 保持数据库、权限模板写入 RPC 和项目写入 RPC 不变。

## 方案选择

采用认证层统一刷新方案：由 `AuthGate` 暴露一个受控的“刷新当前账号”回调，业务页面只请求刷新，不直接操作会话。

未采用以下方案：

- 只为 `SW-000` 跳过注销：无法覆盖普通社长及其他有权账号。
- 保存后刷新整个浏览器页面：体验较差，且仍无法区分临时服务故障与认证失效。
- 在验证失败时继续显示旧业务页面：可能继续使用过期权限，不符合安全边界。

## 组件与数据流

### AuthGate

`AuthGate` 的已认证 render prop 增加 `onRefreshCurrentUser`：

1. 从认证服务读取当前 session。
2. 使用现有的合并验证机制调用 `getCurrentEmployee()`。
3. 成功时用最新 profile 替换 `gate.currentUser`，返回最新账号。
4. 终止性认证错误时进入登录页并执行本地注销。
5. 非终止性错误时进入新的“认证暂不可用”状态，清除业务界面的账号投影但保留 Supabase session，不调用注销。

“认证暂不可用”页面提供：

- `重新验证`：重新读取 session 与当前账号。
- `退出登录`：用户主动结束会话。

该状态保持 fail-closed：在重新验证成功前不渲染 ERP 业务页面。

### App 与人员管理

`AuthenticatedApp` 接收 `onRefreshCurrentUser`，并将其作为 `onPermissionTemplatesChanged` 传给 `PersonnelPage`。不再把这个属性连接到 `onLogout`。

权限模板保存流程保持原子写入顺序：

1. 保存一个部门或职位模板。
2. 调用 `onPermissionTemplatesChanged(snapshot)` 请求认证层刷新当前账号。
3. 刷新成功后更新编辑器快照并显示保存成功。
4. 刷新发生非终止性错误时，由 `AuthGate` 显示重新验证页面且保留 session。
5. 权限服务直接返回终止性认证错误时，沿用 `onAuthInvalid` 注销路径。

`refreshAuthorizationAfterTemplateSave` 不再因为刷新回调抛出普通服务错误而额外调用 `onAuthInvalid`；终止性错误的判断与会话处置只由认证边界负责。

### 项目保存

项目创建、修改和删除逻辑不增加任何注销或刷新调用。项目写入成功后继续更新当前列表。若 Supabase 在此期间发出会话更新事件，统一由改造后的 `AuthGate` 处理：成功刷新、终止性错误注销、非终止性错误进入重新验证页面。

## 错误分类

终止性认证错误沿用并集中使用现有代码集合：

- `ACCOUNT_DISABLED`
- `ACCOUNT_UNAVAILABLE`
- `AUTH_INVALID`
- `AUTH_SESSION_INVALID`
- `AUTH_TOKEN_INVALID`
- `EMPLOYEE_INACTIVE`
- `EMPLOYEE_NOT_LINKED`
- `PASSWORD_STATE_SYNC_FAILED`
- 需要修改临时密码的等价终止状态

网络失败、服务 5xx、配置之外的临时 RPC 失败和无法分类的读取异常不注销 session，而进入重新验证状态。无 access token 的 session 仍直接返回登录页。

## 测试设计

按测试驱动顺序增加回归覆盖：

1. 权限模板保存成功时调用账号刷新回调，不调用注销回调。
2. `App` 将 `onRefreshCurrentUser` 连接到 `onPermissionTemplatesChanged`，并禁止重新出现 `onPermissionTemplatesChanged={onLogout}`。
3. 任意已认证账号刷新成功后保持 authenticated，并使用最新权限 profile。
4. 会话验证发生非终止性错误时不调用 `authService.logout()`，显示重新验证状态。
5. 重新验证成功后恢复 ERP 页面。
6. 终止性认证错误仍调用注销并显示登录页。
7. 项目创建成功路径不调用注销；会话事件产生的临时验证错误遵循同一认证边界。
8. 运行相关定向测试、完整 `npm test` 与生产 `npm run build`。

## 部署与验证

- 本修复不包含数据库迁移。
- 提交代码后部署到现有 Vercel 项目 `shengwang-erp`。
- 线上验证权限模板保存、普通账号项目创建、重新验证页、真正失效会话四条路径。
- 正式域名仍为 `https://shengwang-erp.vercel.app`。

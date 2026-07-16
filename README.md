# 生旺 ERP 数据中心

生旺 ERP 是 React + Vite 前端、Supabase Auth、PostgreSQL RLS 与 Edge Functions
组成的公司内部管理系统。浏览器只使用 Supabase publishable key；人员身份、账号状态、
部门/职位权限模板和审计身份均以服务端为准。

## 当前业务模块

- 工程项目与合同收入
- 人员管理
- 人工考勤看板、月度工资与项目用工费用
- 采购、仓库与材料出入库
- 工具与车辆管理
- 会计成本与老板驾驶舱

## 认证与数据安全边界

- 登录只接受员工编号和密码，不使用姓名、手机号或邮箱，也不提供自助注册。
- Supabase Auth 是唯一浏览器会话来源；浏览器不保存 `currentUser` 身份对象，不读取旧员工
  记录中的角色、权限或登录字段。
- 每次云端读写先确认有效且未过期的 Auth session，随后由数据库 RLS 重新检查当前员工、
  账号状态及有效权限。
- 配置缺失、会话无效、账号停用、RLS 拒绝或网络失败时采用失败关闭（fail-closed）：
  清除/隔离对应本机缓存并停止业务页面，不回退展示旧数据，也不重放整表写入。
- `created_by_employee_*` 与 `updated_by_employee_*` 等审计身份由数据库产生，浏览器不会提交。
- 旧 `erp.employees` 只是不可信、只读的历史编号兼容数据，不能用于认证、权限或规范员工
  目录，也不能通过通用业务持久化服务写入。

## 本地运行与验证

```bash
npm install
npm run dev
```

```bash
npm test
npm run build
```

人工考勤核算的数据库迁移、启用日期、权限矩阵、历史核对、浏览器验收和回滚边界见
[人工考勤、工资与项目用工费用运维手册](docs/attendance-accounting-operations.md)。生产发布前必须
完成其中的 Node、构建、数据库 reset、聚焦 pgTAP、全量 pgTAP 和账号权限矩阵验收。

## 环境变量分离

浏览器构建只允许以下变量：

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_SUPABASE_ANON_KEY
```

`VITE_SUPABASE_ANON_KEY` 仅作为旧部署迁移兼容项；新部署优先使用
`VITE_SUPABASE_PUBLISHABLE_KEY`。

以下变量仅属于 Edge Functions、一次性引导脚本或服务端 secret manager，绝不能添加
`VITE_` 前缀或进入浏览器源码/构建产物：

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
AUTH_ID_DERIVATION_SECRET
LOGIN_RATE_LIMIT_SECRET
CORS_ALLOWED_ORIGINS
SW000_BOOTSTRAP_PASSWORD
```

所有密钥值只在部署平台的 secret manager 中设置。本仓库、SQL、文档、终端命令和工单
都不得保存或传递实际密码值。

## 安全部署顺序

必须按以下顺序发布，不能先部署依赖新身份模型的前端：

1. **数据库迁移**：按文件顺序应用 `supabase/migrations/`，执行 SQL 安全测试并确认严格
   RLS、权限目录和员工账号生命周期函数已生效。
2. **Edge Functions**：在服务端配置 publishable/secret key 集合、Auth 标识派生密钥、
   登录限流密钥、CORS allowlist 及一次性 SW-000 引导密码，然后部署 Auth、人员管理和
   provisioning functions。不要把任何服务端密钥放进 Vercel 浏览器环境。
3. **一次性 SW-000 bootstrap**：在受控运维环境运行
   `node scripts/bootstrap-sw000.mjs`。脚本只发送服务端 API key；密码由 Edge secret
   读取，不出现在请求体、命令或日志。验证 SW-000 Auth 关联和隐藏资料完全一致。
4. **关闭引导入口**：成功后立即移除一次性引导密码密钥与 bootstrap endpoint，并确认
   无法再次从公网执行引导。
5. **部署新版前端**：最后配置 `VITE_SUPABASE_URL` 与 publishable key，构建并部署 Vite
   前端，然后执行真实登录、强制改密、停用账号、权限拒绝和退出/刷新验收。

## 旧数据迁移与人工映射

系统设置中的 localStorage 迁移是显式管理员操作，不会自动运行。它只接受固定业务键，
排除 `erp.employees`，每次写入都需要 Auth session 与 RLS 授权；遇到认证或策略拒绝后
立即停止，错误信息不会包含 Supabase 内部详情。

`src/services/employeeMigrationService.js` 只生成旧员工检查/清洗报告：

- 报告重复或缺失旧 ID、record key/payload ID 不一致、隐藏恢复记录、删除状态；
- 删除旧密码、登录账号、角色、个人权限数组、Auth provider/session 等字段的副本；
- 排除隐藏恢复账号的 payload；
- 列出历史业务记录中需要手工映射的员工引用，但不自动改写引用；
- 不创建 Auth 用户、不分配员工编号、不上传密码，也不写 normalized employee profiles。

如需迁移清洗后的资料，必须由管理员确认报告后，通过服务端人员管理/迁移边界逐条执行。
在确认旧 ID 与新员工编号的手工映射前，不得批量改写历史工程、人工、工资、工具或车辆记录。

## 云端持久化约束

- 通用 `saveList` 仅临时服务于非员工旧业务页面，始终要求有效 session；空列表不会推断
  或软删除 RLS 查询未返回的行。
- 新建、修改和软删除操作只针对明确的一条记录。删除意图必须调用显式 `softDelete`。
- 单次批量 upsert 失败后不会逐行重试，避免放大被拒绝的操作或泄露策略细节。
- localStorage 仅能保存已成功从云端读取或成功写入后的业务缓存；认证、权限或网络错误时
  该缓存不构成可用的数据源。

## Vercel 前端部署

1. 在 Vercel 导入 GitHub 仓库，Framework Preset 选择 Vite。
2. Build Command 使用 `npm run build`，Output Directory 使用 `dist`。
3. 只配置浏览器变量列表中的 URL 与 publishable key。
4. 确认生产构建不含服务端环境变量名，再部署。

企业微信可在后续作为入口或身份联动能力，但任何企业微信 secret 同样只能由服务端处理。

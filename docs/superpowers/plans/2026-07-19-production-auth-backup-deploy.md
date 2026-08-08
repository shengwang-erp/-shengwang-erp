# Supabase 生产认证与实名管理员部署 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task with review checkpoints.

**Goal:** 在不删除或覆盖现有 Supabase 数据、不改变现有 `SW-000` 身份或口令的前提下，部署员工认证能力，创建实名管理员“于培安”，并用真实云端会话完成双账号与首次改密验收。

**Architecture:** 先冻结代码和云端资产指纹，再创建平台备份与可独立恢复的逻辑备份；所有迁移先在隔离恢复环境按生产顺序演练两次。生产发布只执行已审计的前向迁移与明确列出的 Edge Functions。`SW-000` 是不可接管的恢复身份；实名社长通过 `employee-provision` 创建、使用一次性临时密码、首次登录强制改密，并且不得修改、删除或变更 `SW-000`。

**Tech Stack:** Vite/React、Supabase Postgres/Auth/Edge Functions/Storage、Supabase CLI、Node.js、Vercel。

## Global Constraints

- 生产写入门槛：迁移审计、备份、恢复验证、重复迁移演练、身份不变性验证必须全部通过。
- 禁止 `supabase db reset --linked`、`DROP`、`TRUNCATE`、无范围 `DELETE`、会改写既有业务事实的回填，以及任何无法从备份恢复的操作。
- 不部署未跟踪的 `supabase/migrations/202607150002_project_documents.sql` 或其测试。
- 不修改、覆盖、暂存或丢弃工作区已有改动；特别保护 `src/styles.css` 与 `employee-bootstrap-admin` 的已有改动。
- 不在命令参数、文档、Git、构建产物、终端输出或验收截图中暴露访问令牌、数据库密码、service-role key、SW-000 密码或实名管理员临时密码。
- `SW-000` 若已存在：记录不可逆哈希/稳定标识，不更新 Auth 密码、不替换 Auth user、不重建 profile；若不存在：只允许一次性安全初始化。
- 重复部署必须是幂等的；第二次执行不得重新生成或覆盖任一现有密码。
- 实名管理员默认为“于培安｜总务部｜社长”，必须是独立员工编号与 Auth user，`must_change_password=true`。
- 每一步失败立即停止；不得用跳过校验、重置数据库或删除冲突数据的方式继续。

### Task 1: 冻结发布输入与只读预检

**Files:**
- Create: `.superpowers/deployments/2026-07-19-production-auth/manifest.md`
- Read: `supabase/migrations/*.sql`
- Read: `supabase/config.toml`
- Read: `supabase/functions/*`

- [ ] **Step 1: 记录 Git HEAD、分支、受保护脏文件及每个待部署文件 SHA-256。**

Run: `git status --short`, `git ls-files 'supabase/migrations/*.sql'`, and `shasum -a 256` over the explicit deployment set.

Expected: manifest excludes the untracked project-documents migration and records the protected dirty files without modifying them.

- [ ] **Step 2: 扫描迁移中的破坏性语句与覆盖式回填。**

Run: `rg -n -i '\b(drop|truncate|delete from|alter table .* drop|update .* set|insert .* on conflict .* do update)\b' supabase/migrations` followed by manual transaction/guard review.

Expected: every match is classified. Any operation that can delete or overwrite existing production facts blocks deployment until rewritten and re-reviewed.

- [ ] **Step 3: 只读盘点云端 schema、表/行数、Auth、Storage、Functions 和最近平台备份。**

Run only authenticated read-only CLI/API queries; redact all credentials and personal fields.

Expected: inventory contains project ref, schema/table counts, function existence, bucket/object counts, backup/PITR state, and no data mutation.

### Task 2: 取得可恢复备份

**Files:**
- Create outside Git worktree: `/Users/yu/Documents/kaobeierp/secure-backups/2026-07-19-<timestamp>/`
- Update: `.superpowers/deployments/2026-07-19-production-auth/manifest.md`

- [ ] **Step 1: 建立权限为 `0700` 的备份目录并确认它不在 Git 工作树内。**

Expected: backup artifacts cannot be staged by the application repository.

- [ ] **Step 2: 记录 Supabase 托管备份/PITR 的最新可恢复点。**

Expected: manifest records backup ID/time/status. If the plan has no hosted backup, local logical backup is mandatory and deployment remains blocked until verified.

- [ ] **Step 3: 分别导出 roles、schema 与 data；覆盖 `public`、认证元数据及 Storage 元数据。**

Run authenticated `supabase db dump`/`pg_dump` using prompt/secret-manager supplied credentials; never put a password in argv.

Expected: non-empty dumps with success exit codes; no secret printed.

- [ ] **Step 4: 备份 Storage 对象字节或确认对象数为零。**

Expected: inventory count equals backed-up object count. Database dump alone is not accepted as Storage byte backup.

- [ ] **Step 5: 生成 SHA-256、文件大小和受限清单。**

Run: `shasum -a 256 <backup artifacts>`.

Expected: every artifact has checksum and non-zero size; manifest records only paths/checksums/counts, never row contents.

### Task 3: 隔离恢复与重复迁移演练

**Files:**
- Update: `.superpowers/deployments/2026-07-19-production-auth/manifest.md`

- [ ] **Step 1: 将备份恢复到一次性本地 Supabase/Postgres 环境。**

Expected: restore completes without errors; pre-migration table counts and stable-key digests match source inventory.

- [ ] **Step 2: 依文件名顺序只应用追踪的八个迁移。**

Expected: all migrations commit; protected untracked migration is absent.

- [ ] **Step 3: 对比业务表行数、稳定键与事实字段摘要。**

Expected: no existing row disappears and no existing business fact changes. Additive defaults/new security metadata are separately identified.

- [ ] **Step 4: 在同一隔离库再次执行完整迁移集合。**

Expected: second run either no-ops safely or reports already-applied migrations; no row count, stable key, Auth user ID, password metadata or SW-000 profile changes.

- [ ] **Step 5: 演练备份恢复。**

Expected: a fresh disposable database restored from backup matches the pre-deployment count/digest manifest.

### Task 4: 验证 SW-000 与实名管理员安全不变量

**Files:**
- Read: `supabase/migrations/202607140001_employee_auth.sql`
- Read: `supabase/migrations/202607140003_employee_account_lifecycle.sql`
- Read: `supabase/functions/employee-bootstrap-admin/handler.js`
- Read: `supabase/functions/employee-provision/handler.js`
- Read: `supabase/functions/employee-admin/handler.js`

- [ ] **Step 1: 证明 bootstrap 对已存在 SW-000 完全幂等。**

Expected: existing Auth user ID/profile/password metadata remain unchanged; endpoint never returns or rotates the password.

- [ ] **Step 2: 证明所有管理员/RPC 路径都拒绝修改、禁用、离职、删除、改号或接管 SW-000。**

Expected: database constraint/RPC and Edge handler both fail closed, including实名社长调用。

- [ ] **Step 3: 证明新建实名管理员强制首次改密。**

Expected: provisioned profile has `must_change_password=true`; ordinary application data remains inaccessible until successful password change refreshes the session.

- [ ] **Step 4: 记录生产前身份快照。**

Expected: if SW-000 exists, manifest records only stable IDs/status/permission digest and password metadata fingerprint—not credentials. If absent, records safe-initialization decision.

### Task 5: 生产数据库与 Edge Functions 发布

**Files:**
- Deploy: tracked `supabase/migrations/*.sql` excluding `202607150002_project_documents.sql`
- Deploy: explicit employee Auth/permission/attendance/purchase Edge Functions only

- [ ] **Step 1: 再次确认维护窗口、备份校验和、恢复演练和生产身份快照。**

Expected: all gates marked PASS; otherwise stop without production write.

- [ ] **Step 2: 链接已确认的 project ref，并执行 migration dry-run/diff。**

Expected: target project is `maafjofyetjvnjxtoxrb`; planned SQL exactly matches approved set and contains no protected untracked migration.

- [ ] **Step 3: 执行前向迁移并立即采集迁移后计数/摘要。**

Expected: migration succeeds; existing counts do not decrease; stable fact digests and SW-000 identity/password fingerprint are unchanged.

- [ ] **Step 4: 配置服务端 Secrets 并部署明确函数集合。**

Expected: secrets exist only in Supabase secret manager; public function CORS/verify_jwt settings match `supabase/config.toml`; health probes pass.

### Task 6: 初始化/保留 SW-000 并创建于培安

**Files:**
- Run: `scripts/bootstrap-sw000.mjs`
- Update: `.superpowers/deployments/2026-07-19-production-auth/manifest.md`

- [ ] **Step 1: 若 SW-000 已存在，跳过创建并验证未改变；若不存在，执行一次性 bootstrap。**

Expected: first safe initialization returns created once; repeated call returns already exists and never changes password or user ID.

- [ ] **Step 2: 立即删除一次性 bootstrap 密码 secret 并关闭 bootstrap 入口。**

Expected: public bootstrap call is unavailable after initialization; SW-000 login remains valid.

- [ ] **Step 3: 以 SW-000 会话调用 `employee-provision` 创建“于培安｜总务部｜社长”。**

Expected: unique non-SW-000 employee number, separate Auth user, active status, president role, initial password returned only once, `must_change_password=true`.

- [ ] **Step 4: 保存实名员工编号；将临时密码通过一次性安全通道交付，不写日志。**

Expected: repeated request ID returns the same employee record but never regenerates/reveals/replaces the password.

### Task 7: 双账号、首次改密与越权验收

**Files:**
- Update: `.superpowers/deployments/2026-07-19-production-auth/manifest.md`

- [ ] **Step 1: 用 SW-000 在真实云端前端登录并读取当前 profile。**

Expected: login succeeds; stable Auth user ID/profile/password fingerprint equals deployment前快照。

- [ ] **Step 2: 用于培安临时密码登录。**

Expected: login succeeds but UI/API只允许进入强制改密流程。

- [ ] **Step 3: 修改为用户掌握的新密码并验证旧临时密码失效、新密码可登录。**

Expected: `must_change_password=false`; session refresh succeeds;临时密码登录失败。

- [ ] **Step 4: 以于培安会话尝试修改、禁用、离职、删除和接管 SW-000。**

Expected: each request is denied; SW-000 identity, status, role, Auth user and password fingerprint remain unchanged.

- [ ] **Step 5: 再次分别登录两个账号。**

Expected: both logins succeed; audit records contain actor/target/result but no password/token.

### Task 8: 前端部署与最终回归

**Files:**
- Deploy: verified production build only after backend acceptance

- [ ] **Step 1: 使用生产 URL/publishable key 且 `VITE_LOCAL_DEMO_MODE=false` 构建。**

Run: `npm test`, focused security tests, and `npm run build` with secret-safe environment injection.

Expected: required suites and build pass; dist contains no server-only secret names or demo credentials.

- [ ] **Step 2: 部署 Vercel 并访问生产域名完成 smoke test。**

Expected: login invokes deployed Edge Functions rather than local demo code; dashboard, personnel, accounting, purchase and attendance routes load according to permissions.

- [ ] **Step 3: 记录最终证据与回滚点。**

Expected: manifest includes deployment IDs, migration list, backup path/checksums, pre/post counts, dual-login results, forced-change result and SW-000 denial matrix—without secrets.

- [ ] **Step 4: 只有全部新鲜验证通过后宣布完成。**

Expected: no unresolved blocker and no unsupported success claim.

# 今日打卡运维与验收指南

本文面向发布负责人、数据库管理员和事故值班人员。所有坐标、异常原因、照片和员工/项目关联均属于受保护的员工与项目记录。

> 安全边界：本文的验证命令只能用于一次性本地隔离环境。不得把本仓库链接到共享或生产 Supabase 项目，不得执行 `db push`，不得在本文流程中部署 Edge Function、配置 scheduler、应用迁移到共享数据库，或使用真实员工数据。

## 1. 依赖与发布顺序

逻辑依赖必须按以下顺序完成并独立验收：

1. 员工认证与 `employee_profiles` 身份链路。
2. 已提交并稳定的工程项目核心迁移 `001`。
3. 如果发布包含项目文档功能，只能使用已经定稿、评审和提交的项目文档 `002`。
4. 今日打卡迁移 `003`：`202607150003_today_attendance.sql`。
5. 数据库、Storage 和浏览器验收全部通过后，才可另开受控发布流程处理 `attendance-photo-cleanup`。

绝不能为了让 `003` 先上线而跳过仍在变化的较小迁移编号。当前工作区未跟踪的 `202607150002_project_documents.sql` 是未完成原型，不得应用、复制到隔离迁移目录或作为 `003` 的发布前提。若 `002` 尚未定稿，应先停止发布并重新整理迁移序列。

发布前应确认隔离目录只包含这些已提交前提：`202607140001`–`202607140004`、`202607150001` 和 attendance `202607150003`。任何额外或未提交 SQL 都会使本指南的数据库证据失效。

### 部门打卡模式 v2 的安全发布顺序

生产发布必须按以下顺序逐项记录负责人、时间和结果；任一步失败立即停止，不能跳过数据库
验证直接发布前端：

1. 确认当前 Supabase 可恢复备份，并记录备份标识、时间和现有 migration versions。
2. 应用 `202608120001_department_attendance_modes.sql`，验证 v1 与 v2 attendance RPC
   均存在且可由各自授权角色执行。
3. 应用 `202608120002_attendance_location_review_and_company_payroll.sql`，执行本文和
   [考勤核算运维手册](./attendance-accounting-operations.md)中的只读会计/工资探针。
4. 部署已经通过完整测试的 Vercel production build 到
   `https://shengwang-erp.vercel.app/`。
5. 依次用一个工程账号、一个通用打卡账号、一个免打卡账号、一个会计账号和一个无工资
   权限账号执行 smoke test；不得使用同一高权限账号代替五种权限边界。
6. 验证 Vercel main production alias 指向本次已验证部署，并继续保留 v1 RPC 作为数据库先行、
   前端可回退期间的兼容边界。

该顺序是兼容性边界：数据库迁移先为历史场次回填 `project` 模式并同时保留 v1/v2，前端随后
切换到 v2。`202608120002` 必须在 `202608120001` 之后，Vercel 必须在两者及只读探针之后。
不得在同一发布中删除或收回 v1 RPC；只有单独评审的后续清理迁移才能结束过渡期。

## 2. 私有照片桶设置

照片桶的固定契约如下：

| 设置 | 固定值 |
| --- | --- |
| bucket | `erp-attendance-photos` |
| public | `false`，必须为私有桶 |
| 单文件上限 | 20 MiB（`20971520` bytes） |
| MIME 类型 | `image/jpeg`、`image/png`、`image/webp`、`image/heic`、`image/heif` |
| 应用读取契约 | 仅服务器确认的 `active` 照片，通过 300 秒 signed URL；有效期由应用固定，不是 bucket 开关 |
| 浏览器 INSERT | 仅服务器预约的本人规范路径 |
| 浏览器 UPDATE/DELETE | 始终禁止 |

客户端不得生成 public URL、覆盖对象、猜测对象路径或直接删除照片。元数据和对象状态必须通过专用 RPC 推进；signed URL 不得持久化到浏览器存储。

## 3. 必做验证命令

### Node 与构建

从 attendance 实现工作树根目录执行：

```bash
node --test src/features/attendance/attendanceDomain.test.js src/features/attendance/attendancePhotoDomain.test.js src/features/attendance/attendanceLocationService.test.js src/features/attendance/attendanceLocationAttempt.test.js src/features/attendance/attendancePhotoUploadState.test.js src/services/attendanceService.test.js src/services/attendancePhotoStorage.test.js src/services/attendanceSchema.test.js src/features/attendance/todayAttendancePageContract.test.js src/features/attendance/todayAttendanceAppIntegration.test.js src/features/attendance/departmentAttendanceEndToEnd.test.js src/auth/frontendAuthContract.test.js src/desktopAdminShell.test.js supabase/functions/attendance-photo-cleanup/handler.test.js
npm test
npm run build
git diff --check
```

发布候选的干净检出必须全绿。共享脏工作树中的既有失败要单独归因并记录，不能把它们算作 attendance 成功，也不能为了得到绿色结果而改动范围外文件。

### 一次性本地数据库与 Storage

只复用 `/private/tmp/kaobeierp-task7-db`，项目名固定为 `shengwang-attendance-task7`，API/DB 端口固定为 `58321`/`58322`。启动前确认该目录不含未完成的 `202607150002_project_documents.sql`。

```bash
npx supabase start --workdir /private/tmp/kaobeierp-task7-db
npx supabase db reset --local --workdir /private/tmp/kaobeierp-task7-db
npx supabase test db supabase/tests/today_attendance.sql --local --workdir /private/tmp/kaobeierp-task7-db
npx supabase test db --local --workdir /private/tmp/kaobeierp-task7-db
```

真实 HTTP/Storage/并发验证器只能使用该本地栈。只用下面的完整命令读取该 workdir 的本地值：

```bash
npx supabase status --workdir /private/tmp/kaobeierp-task7-db -o env
```

把该命令返回的 anon/service-role 值仅注入当前临时 shell；不得写入仓库、日志或工单。验证器要求以下边界：

```text
ATTENDANCE_DISPOSABLE_CONFIRM=shengwang-attendance-task7
SUPABASE_URL=http://127.0.0.1:58321
ATTENDANCE_DB_HOST=127.0.0.1
ATTENDANCE_DB_PORT=58322
ATTENDANCE_DB_CONTAINER=supabase_db_shengwang-attendance-task7
ATTENDANCE_DOCKER_CONTEXT=<解析为本机 unix socket 的 Docker context>
SUPABASE_ANON_KEY=<仅本地栈 anon key>
SUPABASE_SERVICE_ROLE_KEY=<仅本地栈 service-role key>
ATTENDANCE_CLEANUP_SECRET=<仅本地且独立的 scheduler secret>
```

清除所有环境中的 `DOCKER_*` 和 `BUILDKIT_HOST` 后，再执行：

```bash
node supabase/tests/today_attendance_storage_http.mjs
npx supabase db reset --local --workdir /private/tmp/kaobeierp-task7-db
npx supabase test db --local --workdir /private/tmp/kaobeierp-task7-db
npx supabase stop --workdir /private/tmp/kaobeierp-task7-db --no-backup
```

验证器会创建一次性 Auth、员工、项目、考勤、Storage 和清理数据，并执行真实双连接 clock-in 竞争；因此绝不能把它指向共享或生产地址。安全门、pgTAP、HTTP 布尔矩阵、最终重置和无备份停止任一项失败，都必须记为未验证。

## 4. 角色与读取矩阵

所有角色都必须先满足：员工为 `在职`、账号为 `active`、无需强制改密且未删除。模块权限不是进入今日打卡的前提；有效的零模块员工仍可进入。

`202608120001` 起，服务器还会按 `employee_profiles.attendance_required` 与规范部门决定打卡模式：
免打卡员工为 `exempt`；需打卡的工程部员工为 `project`；其他需打卡员工为 `general`。项目模式
保留项目快照、半径、点位和照片；公司通用模式不携带项目身份，事件固定为 `not_applicable`，
距离和半径为空，且不能创建点位或照片。客户端部门名称、缓存或请求参数都不能覆盖该策略。

每个满足该身份门槛的员工都可列出全部考勤合格项目，并可对任一合格项目打卡；项目担当关系只扩大读取范围，不限制打卡项目，也不赋予代写权限。合格项目必须同时满足 active 数据 envelope、业务状态为 `待开工`/`进行中`、已确认且仍匹配的非空地址快照、有效经纬度和正数半径。

| 角色 | 本人今日/本人历史 | 他人场次与 active 照片 | 写入权限 | 记录页 scope |
| --- | --- | --- | --- | --- |
| 场次 owner | 可读；项目作废后仍保留本人记录读取 | 不可读无关员工 | 仅本人 open 场次可打卡、保存点位和处理照片 | `own`，除非同时命中更高角色 |
| 当前现场担当 | 可读本人 | 仅可读自己当前负责且项目 envelope 为 `active` 的项目记录 | 仍只能修改本人场次，不能代替员工写入 | `assigned_projects`，`canViewScopedRecords=true` |
| `社长` | 可读 | 可读全部考勤记录和 active 照片，独立于项目担当关系 | 仍不能修改他人的场次 | `all` |
| `SW-000` | 可读 | 与 `社长` 相同的独立全局读取分支 | 仍不能修改他人的场次 | `all` |
| 无关 active 员工 | 可读本人 | 不可读外部记录、照片或筛选身份 | 仅本人 open 场次 | `own` |
| inactive/disabled/离职/强制改密员工 | 拒绝 | 拒绝，Storage 授权返回 false | 拒绝 | 无 scope，RPC 失败关闭 |

前任现场担当不会保留项目级读取。记录管理标签只能由服务器返回的 `viewerAccess.canViewScopedRecords=true` 决定，客户端职位、员工编号或模块权限不能扩大范围。

## 5. service-role 安全监控

以下查询只能由受控的 service-role/数据库运维通道执行。输出只有状态、年龄桶和计数；不得添加 `object_path`、员工姓名、员工编号、项目名、坐标、异常原因或文件名。

```sql
select
  upload_status,
  case
    when updated_at < statement_timestamp() - interval '7 days' then '7d_plus'
    when updated_at < statement_timestamp() - interval '24 hours' then '24h_to_7d'
    when updated_at < statement_timestamp() - interval '1 hour' then '1h_to_24h'
    else 'under_1h'
  end as age_bucket,
  count(*)::bigint as photo_count
from public.project_attendance_photos
where upload_status in ('pending', 'superseded', 'cleanup_pending')
group by upload_status, age_bucket
order by upload_status, age_bucket;
```

清理积压的最小健康摘要：

```sql
select
  count(*) filter (
    where upload_status = 'pending'
      and updated_at < statement_timestamp() - interval '24 hours'
  )::bigint as stale_pending,
  count(*) filter (
    where upload_status = 'superseded'
      and updated_at < statement_timestamp() - interval '24 hours'
  )::bigint as stale_superseded,
  count(*) filter (
    where upload_status = 'cleanup_pending'
      and updated_at < statement_timestamp() - interval '24 hours'
  )::bigint as stale_cleanup_pending
from public.project_attendance_photos;
```

监控系统只保存聚合值和时间，不保存查询行、对象路径或个人数据。`active` 照片不属于清理候选。清理 claim 会刷新 `updated_at`；因此监控和重试年龄只能使用 `updated_at`，不能改用 `created_at` 或 `captured_at`。

## 6. 事故处理

1. 先由数据库管理员执行下面的事务，撤销 `authenticated` 的 mutation EXECUTE。最后一个 revoke 同时关闭 Storage INSERT policy 使用的预约路径验证，因此已有 `pending` 预约也不能继续上传。临时移除页面入口只能作为辅助措施，不能阻止已经打开页面的客户端，不能单独视为停止写入。

```sql
begin;
revoke execute on function public.clock_in_project_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, text
) from authenticated;
revoke execute on function public.clock_out_project_secure(
  uuid, uuid, double precision, double precision, numeric, timestamptz, text
) from authenticated;
revoke execute on function public.upsert_attendance_work_point_secure(
  uuid, smallint, text, text, text
) from authenticated;
revoke execute on function public.reserve_attendance_photo_secure(
  uuid, text, text, text, bigint, text, timestamptz
) from authenticated;
revoke execute on function public.finalize_attendance_photo_secure(uuid)
  from authenticated;
revoke execute on function public.abandon_attendance_photo_secure(uuid)
  from authenticated;
revoke execute on function public.can_current_employee_upload_attendance_photo(text, text)
  from authenticated;
commit;
```

2. 不得 UPDATE/DELETE 已存在的考勤事件、场次、点位或照片元数据来“修正”事故；事件是不可变审计记录。
3. 保留数据库与 Storage 原状，记录聚合计数、错误码和发生时间。不要把坐标、原因、对象路径、照片或员工/项目姓名复制到日志和支持工单。
4. 在一次性本地环境复现并修复；重新通过完整 pgTAP、HTTP/Storage、真实并发、Node、构建和浏览器矩阵。
5. 仅在变更评审通过、授权矩阵无回归且事故负责人批准后，按 `003` 原有的 `authenticated` grants 精确恢复；不得授予 `PUBLIC` 或 `anon`：

```sql
begin;
grant execute on function public.clock_in_project_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, text
) to authenticated;
grant execute on function public.clock_out_project_secure(
  uuid, uuid, double precision, double precision, numeric, timestamptz, text
) to authenticated;
grant execute on function public.upsert_attendance_work_point_secure(
  uuid, smallint, text, text, text
) to authenticated;
grant execute on function public.reserve_attendance_photo_secure(
  uuid, text, text, text, bigint, text, timestamptz
) to authenticated;
grant execute on function public.finalize_attendance_photo_secure(uuid)
  to authenticated;
grant execute on function public.abandon_attendance_photo_secure(uuid)
  to authenticated;
grant execute on function public.can_current_employee_upload_attendance_photo(text, text)
  to authenticated;
commit;
```

不要通过直接授予表权限、放宽 Storage policy、删除失败行或重写历史事件来绕过事故。

## 7. 隐私与支持边界

- GPS 坐标、精度、距离、异常原因、工作点文字和照片均为员工/项目记录。
- 日志和监控只记录安全错误码、阶段、计数与时间；不记录请求 payload、signed URL、对象路径、员工/项目身份或照片元数据。
- 支持工单不得粘贴数据库行、截图中的员工信息、照片、坐标或异常原因。需要复现时，使用一次性虚构账号、项目和图片。
- 300 秒 signed URL 仍是敏感凭证；不得复制、持久化或转发。
- service-role key、scheduler secret、JWT 和本地测试密钥不得进入版本控制、聊天记录或 CI 输出。

## 8. 照片清理操作

`attendance-photo-cleanup` 不是浏览器功能，浏览器、普通 authenticated 用户和 anon 均不能 claim 或 complete 清理。

清理发布必须另开受控任务，并同时满足：

1. 先在上述一次性本地环境通过真实对象删除和元数据完成验证。
2. Edge gateway 保持 JWT 验证；`Authorization` 使用有效 gateway JWT。
3. `x-attendance-cleanup-secret` 使用独立、非空、无首尾空白的 `ATTENDANCE_CLEANUP_SECRET`，不得把它当作 Bearer JWT。
4. admin client 仅从受控 service-role secret 创建，响应和日志不得暴露候选对象路径或 provider 错误。
5. scheduler 在本实现计划之外单独配置、审批和轮换；本任务不部署函数、不创建 scheduler。
6. claim 只处理超过 24 小时的 `pending`、`superseded`、`cleanup_pending`，上限为 1–500；`active` 永不进入候选。
7. HTTP 200 不代表全部成功；必须分别检查 `{ claimed, deleted, failed }`，且 `cleanup_pending` 不等于对象已删除。
8. Storage 删除失败或返回不可验证结果时，不 complete 元数据；`cleanup_pending` 必须保留。claim 已刷新其 `updated_at`，所以失败项要再等待严格超过 24 小时才可重试。

不得新增浏览器清理路径，也不得由客户端提供 bucket、对象路径或 photo ID 候选。

## 9. 首发边界与验收清单

原始今日打卡首发不改写异常事实。部门模式扩展只增加结构化会计复核和工资单管理记录：
“确认有效”和“判定异常”都不得自动扣薪、改变出勤人天或改变项目成本；它不是处分流程，也不
允许会计改写坐标、事件、场次或照片事实。

发布证据还必须逐项确认：

- 一级菜单只有“借工具”和取代旧“还工具”位置的“今日打卡”；归还流程仍在“借工具”内部。
- 有效 active 零模块员工可进入今日打卡。
- 同一天可按项目顺序创建多个场次，但任一时刻最多一个 open 场次。
- 每次上下班打卡都重新请求 GPS；项目模式范围外或精度不足时先显示一次确认，可取消重新定位，
  也可选择“仍然打卡”并由服务器记录越界确认。通用模式只验证有效当前位置，不做项目半径判断。
- 最多七个点位、每点开工前/完工照片成对；至少一个完整点位即可下班打卡，其他点位可以不完整。
- 页面和数据中不出现“资料未完整”标签。
- 照片私有、不可覆盖，读取 URL 只存活 300 秒。
- 关闭场次只读；经理记录页只由服务器 scope 开启。
- 桌面 1440×1000 与移动 390×844 下均检查工程项目选择、点位/照片、通用一键定位、免打卡说明、
  上下班越界确认的取消与继续、会计复核必填、项目/公司成本、Excel 下载和打印/PDF 预览；同时
  检查控制台错误、dialog 裁切、隐藏的主操作、移动横向溢出、键盘焦点和至少 44px 的触控目标。

任何缺少匹配账号、浏览器定位权限、Docker、本地凭证或真实隔离栈的路径，都必须明确标记“未验证”，不能用静态契约替代实测结论。

# 人工考勤、工资与项目用工费用运维手册

本手册用于部署和验收 `202607160001_attendance_accounting.sql`、部门打卡策略和审计复核扩展。生产环境操作应在维护窗口内由数据库管理员和会计负责人共同执行；本文不授权直接修改生产数据。

## 部署前准备

1. 确认 `202607150003_today_attendance.sql` 已成功应用，并确认“今日打卡”可正常读取云端场次。
2. 使用 Supabase 平台备份或组织批准的 PostgreSQL 备份流程创建可恢复备份，记录备份时间、数据库版本和负责人。
3. 保存迁移前基数，且不要导出员工工资明细到不受控终端：

```sql
select 'labor_records' as source, count(*) as row_count
from public.labor_records
union all
select 'salary_records', count(*)
from public.salary_records;
```

4. 记录迁移前有效记录数，供迁移后核对：

```sql
select 'labor_records' as source, count(*) as active_count
from public.labor_records
where status <> 'deleted'
union all
select 'salary_records', count(*)
from public.salary_records
where status <> 'deleted';
```

迁移不会删除或重写 `labor_records`、`salary_records`、打卡场次、打卡事件或照片。若备份或基数无法确认，应停止发布。

## 迁移顺序

按文件名顺序应用 `supabase/migrations/`，其中本功能的直接依赖顺序为：

1. `202607150003_today_attendance.sql`
2. `202607160001_attendance_accounting.sql`
3. `202608120001_department_attendance_modes.sql`
4. `202608120002_attendance_location_review_and_company_payroll.sql`

迁移后确认五张核算表均启用 RLS，浏览器角色没有表级写权限，只能调用显式授权的 security-definer RPC。`docs/supabase-schema.sql` 是审查参考，不代替有序迁移。

## 权限矩阵

权限必须通过系统设置中的部门/职位模板授予，不能依赖前端角色名称或浏览器本地数据。

| 能力 | 必需的有效权限 |
| --- | --- |
| 打开人工考勤页面、查看脱敏考勤 | `module.labor.view` |
| 查看个人工资与日工资金额 | `module.labor.view` + `sensitive.salary_view` |
| 保存或确认零金额日结 | `module.labor.view` + `module.labor.update` |
| 保存或确认含项目金额的日结 | `module.labor.view` + `module.labor.update` + `module.project_costs.view` + `module.project_costs.update` + `sensitive.salary_view` + `sensitive.salary_update` |
| 查看项目用工费用 | `module.labor.view` + `module.project_costs.view` |
| 导出含员工维度的项目人工 CSV | 上一行权限 + `sensitive.salary_view` |
| 保存、确认或重开月工资 | `module.labor.view` + `module.labor.update` + `sensitive.salary_view` + `sensitive.salary_update` |
| 修改考勤设置 | `module.labor.view` + `module.settings.update` |
| 向会计成本、老板驾驶舱和项目核算提供正式桥接金额 | `module.labor.view` + `sensitive.salary_view` + `module.project_costs.view`，三项缺一不可 |

`SW-000` 使用数据库固定全权限规则。会计主管/会计模板应按实际职责授予上表权限；只负责查看考勤的人员不应获得工资或项目金额权限。授权后用管理员页面重新读取模板并以不同账号实测，不能仅检查前端菜单。

## 启用日期

迁移完成后，由具有 `module.settings.update` 的负责人在“人工考勤与工资 → 考勤设置”首次保存：

- 启用日期：经会计确认的分界日；
- 工作日：星期一至星期六，即数据库 weekday `1,2,3,4,5,6`；
- 星期日：非应出勤日，但员工仍可正常打卡，已有场次可进入会计核对；
- 默认班次：08:00–17:00；
- 休息：60 分钟；
- 标准工时：480 分钟。

星期一至星期六只有超过 08:00 仍无打卡时才产生缺卡提醒。提前确认休息、请假或调休后不再作为缺卡异常。启用日期以前只读旧人工/工资记录；启用日期及以后，只有已确认的新日结、项目分摊和月工资进入正式合计。

首次确认日结或月工资后，系统禁止普通设置操作修改启用日期。确需更改分界，必须另写经审计的数据迁移，先完成影响分析和备份，不能直接更新设置表。

## 部门模式、定位复核与公司工资

服务器按事实和员工策略决定核算模式，浏览器不能指定模式。已有日期优先读取该日打卡场次：存在项目场次即为 `project`，否则存在通用场次即为 `general`；没有历史场次时才按规范员工档案派生。这样，员工以后调离工程部不会改写历史项目日结。

- 项目打卡出现越界事实时，确认日结必须选择“确认有效”或“判定异常”，并填写去除首尾空白后 `1..2000` 字的复核说明；复核人和时间由服务器写入。正常定位日不得带复核字段。
- 两种复核结论都只形成审计信息，不改变日结类型、出勤人天或最终项目人工成本。“判定异常”只是工资备注，不代表处分或扣薪。
- `general` 使用已确认日结计算工资，但项目分摊与项目成本始终为零；净工资进入公司人员成本，不进入项目成本。
- `exempt` 不生成打卡事件、场次或日结。符合在职区间和工作日设置的日期按整天参与现有月薪公式，净工资进入公司人员成本。
- 月工资确认后冻结 `project / general / exempt` 模式、公司人员成本和定位复核汇总。职位只取当前规范员工档案用于显示，不参与已确认金额计算。

## 历史数据核对

迁移后再次执行部署前的两组计数，结果不得减少。然后在“月度工资”和“项目用工费用”标签查看“历史数据核对”：

- `postActivationLegacyRows` 必须逐条确认；它表示启用日期后仍存在的旧人工或旧工资记录，这些记录只进入核对清单，不重复计入正式合计。
- `globalMalformedLegacyRows` 必须清查原始 JSON 格式；不得通过猜测员工或金额来自动修复。
- 启用日期以前的旧 `labor_records` 继续作为历史项目人工来源；启用日期及以后只读取已确认 `attendance_project_allocations`。
- 启用月份以前的旧 `salary_records` 继续作为历史工资来源；启用月份及以后只读取已确认 `attendance_monthly_payrolls`。
- 桥接汇总必须满足本月项目 map 合计等于本月项目总额、全生命周期 map 合计等于全生命周期总额，且本月金额不能超过对应全生命周期金额。

任何差异都应保留原记录、记录负责人和处理结论；不要覆盖、软删除或复制打卡事实来“修平”金额。

## 自动验证

在已提交、待发布且无未提交/未跟踪文件的检出中创建一次性 workdir。下面使用 `git archive`
只复制当前发布提交追踪的配置、迁移和测试，避免把开发者本机草稿带入验收。目标目录若已存在会
立即停止，不能复用旧迁移或测试快照。测试栈只启动 PostgreSQL，并使用独立项目 ID 和端口：

```bash
set -euo pipefail
test -z "$(git status --porcelain --untracked-files=all)"
test ! -e /private/tmp/kaobeierp-attendance-accounting-db
mkdir -p /private/tmp/kaobeierp-attendance-accounting-db
git archive HEAD supabase/config.toml supabase/migrations supabase/tests | tar -x -C /private/tmp/kaobeierp-attendance-accounting-db
perl -0pi -e '$a = s/^project_id = "[^"]+"$/project_id = "kaobeierp-attendance-accounting-db"/m; $b = s/^port = 54322$/port = 59322/m; $c = s/^shadow_port = 54320$/shadow_port = 59320/m; END { exit(($a == 1 && $b == 1 && $c == 1) ? 0 : 1) }' /private/tmp/kaobeierp-attendance-accounting-db/supabase/config.toml
npx supabase start --exclude analytics,edge-runtime,functions,imgproxy,inbucket,kong,meta,realtime,rest,storage,studio,vector --workdir /private/tmp/kaobeierp-attendance-accounting-db
```

确认启动输出属于 `kaobeierp-attendance-accounting-db`，再运行以下验证命令：

```bash
npm test
npm run build
npx supabase db reset --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db supabase/tests/attendance_accounting.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db supabase/tests/attendance_accounting.sql supabase/tests/attendance_location_review_and_company_payroll.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
```

任一命令非零退出时停止发布。不得用跳过测试、放宽 RLS 或给 `authenticated` 增加表权限的方式绕过失败。
验证记录保存后，用
`npx supabase stop --no-backup --workdir /private/tmp/kaobeierp-attendance-accounting-db`
停止并移除该一次性测试栈；不要对共享或生产项目执行此命令。

## 验收清单

在与目标版本一致的本地或测试环境，以桌面宽度和窄屏手机宽度分别检查：

- [ ] `SW-000` 能查看和操作完整页面，审计身份来自当前服务端账号。
- [ ] 会计账号按权限矩阵查看工资、日结、项目分摊和月工资。
- [ ] 只有 `module.labor.view`、没有 `sensitive.salary_view` 的查看者看不到个人工资、日工资和含员工维度的 CSV。
- [ ] 普通员工不能打开会计看板，但“今日打卡”仍可上下班打卡并查看已授权照片。
- [ ] 停用员工不能调用考勤核算 RPC，也不继续显示旧账号的工资数据。
- [ ] 星期六的所有符合资格在职员工都出现在看板；超过上班时间未打卡者进入持续异常队列和菜单角标。
- [ ] 星期日无场次时显示可选，不标红；星期日有场次时可核对打卡事实。
- [ ] 休息、请假、调休确认后移除缺卡提醒。
- [ ] 多项目分摊总额不等于当日最终项目人工成本时不能确认；完全相等时才可确认。
- [ ] 越界定位没有结构化结论或有效说明时不能确认；正常定位日的复核字段保持空值。
- [ ] 项目员工调部门后，已有项目场次的历史日期仍按项目模式核算。
- [ ] 通用打卡工资只进入公司人员成本，项目分摊和项目成本都为零。
- [ ] 免打卡员工无需生成日记录即可按完整排班和既有月薪公式确认工资。
- [ ] 月工资显示整天、半天、应出勤人天、已确认人天和待处理天数；有未处理日结时不能确认月份。
- [ ] 已确认月份锁定对应日结；重开操作要求原因并留下审计。
- [ ] 项目标签能查询选定月份和整个项目累计用工费用，并下载 UTF-8、金额可读且防公式注入的 CSV。
- [ ] 两个会计同时编辑旧版本时出现版本冲突，不覆盖较新的日结、工资或设置。
- [ ] 会计成本、老板驾驶舱和项目金额使用正式桥接值替换旧估算，不把两者相加。

将测试输出、浏览器账号矩阵、日期、截图和核对结论附到发布记录。涉及真实工资的截图必须按公司敏感信息规则保存。

## 回滚边界

若前端发布失败，可以回退前端版本并暂停新的会计确认；已经创建的规范化日结、项目分摊、月工资和审计记录继续保留。旧前端不得被视为正式金额来源，直到桥接前端恢复。

不得通过以下方式回滚：

- 删除或改写 `project_attendance_sessions`、`project_attendance_events`、照片或其他打卡事实；
- 删除 `attendance_accounting_audit_log`；
- 删除已确认日结、项目分摊或月工资以恢复旧合计；
- 关闭 RLS、授予浏览器直接表访问，或把工资数据退回 localStorage；
- 在已有确认记录后直接改写启用日期。
- 将已确认月工资的模式或公司人员成本按员工当前部门重新计算，或用职位字段重算金额。
- 为免打卡员工补造打卡、场次或日结，或把公司人员成本转入项目分摊。

若数据库迁移本身必须撤回，应停止前端流量，保存新数据备份和受影响 ID 清单，再由数据库管理员制定前向修复或从部署前完整备份恢复。恢复前必须评估维护窗口内新增打卡和审计数据，禁止只删除新表而遗失事实链。

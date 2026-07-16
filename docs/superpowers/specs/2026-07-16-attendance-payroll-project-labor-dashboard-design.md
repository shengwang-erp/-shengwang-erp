# 人工考勤、月度工资与项目用工费用看板设计

**日期：** 2026-07-16  
**目标工作树：** `/Users/yu/Documents/kaobeierp/employee-auth-worktree`  
**状态：** 用户已确认 A 方案“每日运营看板优先”及项目费用页面结构，等待书面设计复核后实施

## 1. 目标

把现有“人工记录”页面改造成会计使用的人工考勤与成本中心，完成以下闭环：

1. 每天展示所有在职员工的打卡状态，而不要求会计先选择项目和员工。
2. 识别未打卡、迟到、早退、未下班、定位异常和异常原因等情况，并在 ERP 内持续提醒会计处理。
3. 会计按整天、半天、休息、请假、调休或缺勤确认每日结果，打卡事实本身不可被会计改写。
4. 按月汇总每位员工的确认出勤、工资预览、加班待确认、奖金和扣款，方便会计核算工资。
5. 按项目查询指定月份的用工费用和项目开工至今累计用工费用，并下钻到员工与每日分摊明细。
6. 同一员工一天涉及多个项目时，由会计手工填写各项目分摊金额，确认前不计入正式项目成本。

本功能建立在已有“今日打卡”云端事实数据之上，不把定位时间、坐标或异常原因复制成可随意修改的人工记录。

## 2. 已确认的业务规则

### 2.1 工作日与标准班次

- 周一至周六为默认工作日，所有在职员工默认应出勤。
- 周日不是默认应出勤日；员工不打卡不会产生缺卡异常，但员工仍可正常打卡，实际记录可以由会计确认并计入工资与项目成本。
- 默认上班时间为 08:00，下班时间为 17:00，中间扣除 60 分钟休息，标准工作日为 8 小时。
- 上述时间、休息时长和默认工作日可由有权限的人员在“考勤设置”中修改；所有判定使用服务器的 `Asia/Tokyo` 时间。
- 工作日超过上班时间仍无有效上班记录时标记“未打卡”；08:00 后上班标记“迟到”；17:00 前下班标记“早退”；超过标准工时标记“加班待确认”。
- 休息、请假和调休可以提前或事后由会计登记；确认后不再作为未打卡异常。

### 2.2 每日确认与提醒

- 打卡记录先形成事实，工资和项目成本不会因员工完成下班打卡而自动入账。
- 会计确认或调整后，结果才进入工资及项目人工成本统计。
- 提醒方式只在 ERP 内提供，不发送企业微信或邮件。
- “人工记录”一级菜单显示红色待处理数量；页面内同时提供红色角标、汇总数字和异常队列。
- 异常在会计处理前持续存在，不因为刷新、换设备或跨日自动消失。
- 会计只能将当天核算为 `1 天`、`0.5 天` 或 `0 天`，不按实际小时拆分工资和项目费用。
- 原始上下班时间、定位结果、项目场次和异常原因保持只读；会计处理只新增核算结论、备注和分摊，不覆盖打卡事实。

### 2.3 工资口径

- 月薪员工：月度工资以人员档案中的月薪为基本工资；确认出勤天数用于核对和项目成本分摊，缺勤扣款、奖金和加班费由会计确认，不自动改变月薪。
- 日薪员工：基本工资预览为 `确认人天 × 日薪`。
- 时薪员工：由于本期只按整天或半天结算，整天按 `时薪 × 8`、半天按 `时薪 × 4` 计算，不读取实际打卡分钟数作为工资乘数。
- 月薪员工的项目日成本建议值沿用现有口径：`月薪 ÷ 24`；半天为该值的一半。
- 日薪员工的项目日成本建议值为日薪；时薪员工为 `时薪 × 8`；半天均为整天的一半。
- 所有金额以日元整数保存；建议值先计算整天金额并四舍五入到 1 日元，半天再按整天金额除以 2 并四舍五入。
- 加班、奖金和扣款始终由会计填写并确认；打卡超时只产生“加班待确认”，不自动产生金额。
- 员工工资标准缺失时可以查看考勤，但不能完成该员工的工资确认或项目费用确认，页面必须提示先去人员管理补齐工资标准。

### 2.4 多项目与项目费用

- 单一项目工作日可以用建议日成本快速填入，仍需会计确认。
- 同一员工同一天存在多个项目场次时，显示全部原始项目和打卡时段，由会计手工填写每个项目的分摊金额。
- 每日项目分摊合计必须等于该日最终确认的项目人工成本；不相等时不能确认。
- `0 天`、休息、请假、调休和缺勤的默认项目人工成本为 0。
- 只有已确认的分摊进入正式项目用工费用；草稿和异常待处理金额单独显示。
- 项目页面提供指定月份费用、项目开工至今累计费用、确认人天、员工构成、每日明细和全部项目横向对比。
- 项目费用明细支持导出为带 UTF-8 BOM 的 CSV，确保可直接用 Excel 打开；导出内容遵守当前用户权限。

## 3. 页面信息架构

保留现有 `labor` 路由和 `module.labor.*` 权限代码，一级菜单中文仍为“人工记录”，避免破坏既有权限模板。页面标题改为“人工考勤与工资”，包含四个标签页。

### 3.1 今日看板（默认）

页面顶部提供日期前后切换、状态、项目、部门和员工搜索。日期默认服务器东京当天。

汇总卡显示：

- 今日应出勤；
- 正常完成；
- 正在工作；
- 休息/请假/调休；
- 异常待处理。

主体左侧是全员状态表，至少包含员工、今日项目、上班时间、下班时间、工时参考、状态和核算状态。右侧是异常队列，优先显示未打卡、定位异常、未下班、迟到、早退和加班待确认。

点击员工行或异常项打开 `AttendanceResolutionDialog`：

- 上半部分只读显示全部打卡场次、项目、上下班时间、定位结果和员工填写的异常原因；
- 下半部分允许选择整天、半天、休息、请假、调休或缺勤；
- 有项目成本时显示工资标准快照、建议成本和项目分摊输入；
- 多项目必须逐项目填写金额；
- 保存草稿不会计入正式统计，确认后才计入。

桌面端使用“状态表 + 右侧异常队列”；窄屏下异常队列移到表格上方，全员表改为可展开的员工卡片，避免横向滚动。

### 3.2 月度工资

默认展示当前月份，支持切换月份、部门、员工和“只看待确认”。汇总显示应出勤人天、已确认人天、待处理人次、工资预览总额和未分摊项目成本。

员工表至少包含：

- 员工与工资类型；
- 整天、半天、休息/请假/调休、缺勤；
- 迟到、早退、定位异常和加班待确认次数；
- 基本工资预览、加班费、奖金、扣款和实发工资；
- 项目已分摊金额与未分摊金额；
- 月度状态：未完成、可确认、已确认。

点击员工可查看整月日历明细并回到具体日期处理。月度确认前必须满足：该员工当月所有应处理工作日已有核算结论、工资标准有效、项目成本分摊平衡、加班待确认已处理。月度确认后生成不可变工资快照；授权人员可以“重新打开”，但必须填写原因并保留审计记录。

### 3.3 项目用工费用

筛选条件包括月份、项目、员工和确认状态。选择项目后显示：

- 指定月份已确认用工费用；
- 项目开工至今累计用工费用；
- 本月确认人天；
- 待确认分摊数量和金额；
- 最近月份费用趋势；
- 本月员工费用构成；
- 每日分摊明细；
- 全部项目的本月费用与累计费用对比。

正式合计只读取已确认项目分摊。旧 `labor_records` 作为历史人工成本继续显示，并标记“历史人工记录”；新考勤分摊不会自动覆盖或删除旧数据。

### 3.4 考勤设置

设置页提供启用日期、默认工作日、上班时间、下班时间、休息分钟数和标准日小时数。默认值为周一至周六、08:00–17:00、休息 60 分钟、标准 8 小时。

启用日期之前不根据员工名单反推“未打卡”，避免系统上线时为历史日期制造虚假异常。设置变更只影响尚未确认的日期；已经确认的日结和月结继续使用各自保存的规则快照。

## 4. 组件与代码边界

把新功能放入 `src/features/labor-accounting/`，不继续扩大已有大型 `App.jsx`。

- `LaborAccountingPage.jsx`：标签页、筛选状态和顶层加载边界。
- `DailyAttendanceBoard.jsx`：当天汇总、全员状态与日期导航。
- `AttendanceStatusTable.jsx`：全员桌面表格和移动员工卡片。
- `AccountingExceptionQueue.jsx`：待处理异常列表。
- `AttendanceResolutionDialog.jsx`：只读打卡事实、日结结论与项目分摊。
- `MonthlyPayrollTab.jsx`：月度工资表、员工月历和月度确认。
- `ProjectLaborCostTab.jsx`：项目本月/累计统计、趋势、员工构成与导出。
- `AttendanceAccountingSettings.jsx`：工作日与标准班次设置。
- `laborAccountingDomain.js`：无副作用的状态判定、整天/半天计算、工资预览和分摊校验。
- `laborAccountingService.js`：严格校验安全 RPC 返回值，把数据库错误转换为安全中文提示。
- `laborAccounting.css`：仅作用于 `.labor-accounting-page`，保持现有黑金导航与白色内容区视觉体系。

`App.jsx` 只负责传入当前员工和退出登录回调，不再把浏览器本地 `employees`、`laborRecords` 或工资字段作为新看板的可信数据源。

## 5. 数据模型

新增规范化表，不把核算状态和审计信息埋进通用 JSONB。

### 5.1 `attendance_accounting_settings`

单行有效设置，保存：

```text
settings_key text primary key check (settings_key = 'default')
effective_from date not null
work_weekdays smallint[] not null default {1,2,3,4,5,6}
work_start_time time not null default 08:00
work_end_time time not null default 17:00
break_minutes integer not null default 60
standard_day_minutes integer not null default 480
updated_by_employee_profile_id uuid not null
created_at timestamptz not null
updated_at timestamptz not null
```

星期使用 ISO 编号，周一为 1、周日为 7。数据库限制时间顺序、分钟范围和星期值。

### 5.2 `attendance_day_resolutions`

每位员工每天最多一行核算结论：

```text
resolution_id uuid primary key
employee_profile_id uuid not null
work_date date not null
schedule_required boolean not null
resolution_type text not null check in
  ('full_day','half_day','rest','leave','comp_time','absence')
attendance_units numeric(2,1) not null check in (0,0.5,1)
accounting_status text check in ('draft','confirmed','month_locked')
salary_type_snapshot text not null
base_salary_snapshot numeric
daily_salary_snapshot numeric
hourly_wage_snapshot numeric
suggested_project_cost numeric not null
final_project_cost numeric not null
resolution_note text not null default ''
confirmed_by_employee_profile_id uuid
confirmed_at timestamptz
version integer not null default 1
created_at timestamptz not null
updated_at timestamptz not null
unique(employee_profile_id, work_date)
```

工资快照由服务器从规范员工档案读取，客户端不能提交或覆盖。`full_day` 对应 1，`half_day` 对应 0.5，其余类型对应 0。`month_locked` 后普通日结接口不能修改。

### 5.3 `attendance_project_allocations`

```text
allocation_id uuid primary key
resolution_id uuid not null
project_id text not null
project_name_snapshot text not null
amount numeric not null check (amount >= 0)
allocation_note text not null default ''
created_at timestamptz not null
updated_at timestamptz not null
unique(resolution_id, project_id)
```

确认日结时，数据库在同一事务中锁定日结与分摊行，并验证分摊总额等于 `final_project_cost`。项目名称使用确认时快照，项目 ID 保持稳定关联。

### 5.4 `attendance_monthly_payrolls`

每位员工每月最多一行工资快照：

```text
payroll_id uuid primary key
employee_profile_id uuid not null
salary_month date not null
salary_type_snapshot text not null
base_salary_snapshot numeric not null
full_days numeric not null
half_days numeric not null
absence_days numeric not null
base_pay numeric not null
overtime_pay numeric not null default 0
bonus numeric not null default 0
deduction numeric not null default 0
net_salary numeric not null
status text check in ('draft','confirmed','reopened')
confirmation_note text not null default ''
confirmed_by_employee_profile_id uuid
confirmed_at timestamptz
version integer not null default 1
created_at timestamptz not null
updated_at timestamptz not null
unique(employee_profile_id, salary_month)
```

`salary_month` 固定为月份第一天。确认工资时锁定该员工当月日结；重新打开需要原因，并写审计日志。`net_salary` 由服务器按 `base_pay + overtime_pay + bonus - deduction` 计算并限制不小于 0，客户端不能直接提交最终值。

### 5.5 `attendance_accounting_audit_log`

仅追加保存日结确认、修改、月结确认、重新打开和设置变更。至少包含对象类型、对象 ID、操作类型、操作人、操作时间、变更前后 JSON 快照和原因。浏览器没有直接写入、修改或删除权限。

## 6. 服务端接口与数据流

新增安全 RPC：

- `get_labor_alert_count_secure()`：返回当前用户可见的今日待处理数量，供一级菜单角标使用。
- `list_daily_attendance_dashboard_secure(p_work_date)`：返回日期规则、全员最小资料、打卡场次摘要、核算状态、异常分类和筛选选项。
- `get_attendance_resolution_detail_secure(p_employee_profile_id, p_work_date)`：返回单日完整打卡事实、工资标准快照建议和现有分摊草稿。
- `save_attendance_resolution_draft_secure(...)`：保存日结与分摊草稿，不计入正式统计。
- `confirm_attendance_resolution_secure(...)`：校验整天/半天、工资标准、分摊平衡和并发版本后原子确认。
- `list_monthly_payroll_secure(p_month, ...)`：返回月度员工汇总与异常计数。
- `save_monthly_payroll_draft_secure(...)`：保存加班费、奖金、扣款和备注草稿。
- `confirm_monthly_payroll_secure(...)`：确认员工月度工资并锁定相关日结。
- `reopen_monthly_payroll_secure(...)`：授权用户填写原因后重新打开，并追加审计。
- `list_project_labor_costs_secure(p_month, p_project_id, ...)`：返回本月、累计、趋势、员工构成、每日明细和全部项目对比。
- `export_project_labor_costs_secure(...)`：返回当前权限范围的扁平导出数据，由前端生成 CSV。
- `get_attendance_accounting_settings_secure()` / `update_attendance_accounting_settings_secure(...)`：读取和修改考勤设置。

每日状态在读取时由服务器结合以下信息计算，不依赖后台定时任务：

1. 东京当前服务器时间；
2. 当日是否为默认工作日；
3. 员工在职区间；
4. 休息、请假、调休或已确认日结；
5. 当天全部 `project_attendance_sessions` 与不可变上下班事件；
6. 标准上下班时间及异常定位结果。

一级菜单角标在登录后、窗口重新获得焦点、日结确认后和每五分钟刷新一次。请求失败时保留上次成功数字并显示数据可能过期，不把失败解释为“0 个异常”。

## 7. 权限与安全

- 查看今日全员状态、异常类型和不含金额的项目人天需要 `module.labor.view`。
- 处理日结、休息、请假、调休和缺勤需要 `module.labor.update`。
- 查看员工工资标准、工资预览和工资金额需要 `sensitive.salary_view`。
- 查看项目级用工费用合计需要 `module.project_costs.view`；查看员工级费用构成还需要 `sensitive.salary_view`。
- 修改或确认项目分摊金额需要同时具备 `module.labor.update`、`module.project_costs.update` 与 `sensitive.salary_update`。
- 修改加班费、奖金、扣款或确认月度工资需要同时具备 `module.labor.update` 与 `sensitive.salary_update`。
- 修改考勤设置需要 `module.settings.update`。
- 社长和 `SW-000` 继续按现有规则拥有完整范围；普通员工的“今日打卡”本人页面不因此扩大权限。
- 所有权限由数据库根据 `auth.uid()` 对应的当前规范员工和有效权限重新计算，不能信任客户端传入的角色、员工 ID、工资标准、确认人或服务器时间。
- 新增核算表关闭浏览器直接 INSERT/UPDATE/DELETE；写入只允许安全 RPC。读取也通过裁剪字段的 RPC，避免无工资查看权限的用户获得金额。
- 所有确认接口使用行锁和 `version` 乐观并发校验；过期页面提交返回冲突，要求刷新，不覆盖他人刚完成的处理。
- 打卡事实表仍保持原有不可变性；本功能不会提供改卡、删除定位或篡改服务器打卡时间的接口。

## 8. 历史数据与兼容

- 现有 `labor_records` 不删除、不重写，作为新功能启用日期之前的历史人工成本继续参与项目费用展示。
- 新核算功能启用日期之前不创建“未打卡”异常，也不自动生成日结。
- 新的已确认 `attendance_project_allocations` 是启用日期之后项目用工费用的正式来源。
- 项目费用按启用日期分区聚合：启用日期之前读取旧 `labor_records`，启用日期及之后只读取新分摊。启用日期及之后仍存在的旧人工记录不进入正式合计，而是显示在数据核对清单中。
- 新分摊不会复制写入 `labor_records`，从源头避免同一金额被重复统计。
- 历史人工记录显示来源标签；新考勤核算显示日结与审计入口。
- 现有工资记录保留。工资统计同样按启用月份分区：启用月份之前读取旧工资记录，启用月份及之后以已确认的 `attendance_monthly_payrolls` 为正式来源；同月份遗留的旧工资记录只进入数据核对清单，不计入合计。
- 会计成本和老板驾驶舱同步使用上述分区规则，不能把同一员工同一月份的旧工资记录与新工资快照重复相加。

## 9. 错误处理

- 考勤或核算服务不可用时显示明确错误和重试按钮，不回退到浏览器本地缓存作为可信数据。
- 工资标准缺失、项目已删除、分摊不平、仍有开放打卡场次、月度仍有待处理日结或月份已锁定时，服务端拒绝确认并返回安全中文提示。
- 同一员工当天多个项目、跨日未下班和定位异常均保留原始事实并进入异常队列；页面不自行猜测分摊。
- 周日无打卡返回“非应出勤日”，不是异常；周日有打卡则进入正常会计确认流程。
- 员工离职后历史日结、工资快照和项目分摊仍可读取；离职日期之后不再生成应出勤异常。
- CSV 导出失败不影响页面数据，允许单独重试。

## 10. 测试与验收

### 10.1 领域单元测试

- 周一至周六、周日、启用日期和员工在职区间的应出勤判定；
- 未打卡、迟到、早退、未下班、正常、定位异常和加班待确认的组合；
- 整天、半天和 0 天的工资建议与项目成本建议；
- 月薪、日薪和时薪的月度工资预览规则；
- 单项目与多项目分摊平衡、负数、精度和舍入；
- 已确认、月锁定和重新打开状态转换。

### 10.2 服务与组件测试

- RPC 严格返回结构校验和安全错误映射；
- 今日看板加载、筛选、异常队列、草稿、确认和并发冲突；
- 月度工资待处理阻断、确认、重新打开和金额更新；
- 项目指定月份、累计、员工下钻、全部项目对比和 CSV 导出；
- 无工资查看权限时不渲染且不接收工资金额字段；
- 桌面状态表与窄屏员工卡片均无横向溢出。

### 10.3 SQL 安全测试

- 匿名、停用、离职和强制改密账号全部拒绝；
- `module.labor.view/update`、`module.project_costs.view/update`、`sensitive.salary_view/update` 和 `module.settings.update` 的允许与拒绝矩阵；
- 浏览器角色不能直接写核算表或审计日志；
- 伪造员工、工资标准、确认人、服务器时间和项目名称被忽略或拒绝；
- 双击确认、两个会计并发处理和过期版本不会生成重复分摊或覆盖；
- 月锁定后日结不能修改，重新打开必须有原因并写审计。

### 10.4 集成与回归

- 现有“今日打卡”本人流程、照片、定位和现场担当查看不受影响；
- 现有历史 `labor_records`、工资记录、会计成本和老板驾驶舱数据不丢失；
- 旧人工成本与新项目分摊合并后不重复计数；
- `npm test`、`npm run build` 和本地浏览器桌面/移动验收通过。

## 11. 不在本期范围

- 企业微信、邮件或短信推送；
- 按实际分钟自动计算工资或按小时自动拆分项目成本；
- 会计修改员工原始打卡时间、坐标、照片或异常原因；
- 自动猜测多个项目之间的分摊比例；
- 日本法定节假日在线日历同步；节假日可通过休息日结或后续日历功能处理；
- 银行转账、工资单发送和税费计算。

# Supabase 数据库字段说明

新环境和已有环境都以 [`supabase/migrations/`](../supabase/migrations/) 中按文件名排序的
迁移为唯一规范路径，并按目录内实际文件名排序执行，不可跳过或交换顺序。本功能的直接链为
`202607140001`、`202607140002`、`202607140003`、`202607140004`、`202607150001`、
`202607150003`、`202607160001`、`202607160002`、`202608080001`–`005`、
`202608090001`、`202608100002`、`202608100003`；目录中存在的其他功能迁移同样按文件名插入正确顺序。
[supabase-schema.sql](./supabase-schema.sql) 包含 `202607140001` 历史基础快照和
`202607160001` 考勤核算审查快照以及截至 `202608100002` 的账本接口摘要；它没有复制
`202608100003_project_cost_accounting_summary.sql` 的可执行定义，也不包含中间迁移的完整依赖，
不能作为最终 bootstrap，更不能在已执行有序迁移的数据库上再次运行。当前数据库状态和新环境
安装始终以迁移目录中包含 `202608100003` 的完整有序链为准，审查快照不能替代该链。

`202607160001` 的逐字审查区域由 `ATTENDANCE ACCOUNTING REFERENCE SNAPSHOT` 与
`END ATTENDANCE ACCOUNTING REFERENCE SNAPSHOT` 明确限定。后续项目成本账本和项目引用摘要位于
该结束标记之后；验证程序只在明确边界内与考勤迁移逐字比较，防止不同功能的审查摘要互相污染。

统一项目成本明细账的权限、来源识别、追加式审计、项目拆分、冲突恢复和报表操作见
[project-cost-ledger-operations.md](./project-cost-ledger-operations.md)。会计调整只写入独立事件表，
不会修改采购、仓库、人工、车辆、工具或经营费用的原始业务记录。`202608100003` 起，会计月度/
项目汇总只消费独立的服务端原子聚合 DTO；客户端严格核对总额、月度、项目、类别及
项目×月×类别四位小数汇总，并要求 `incompleteSources` 为空后才发布 `ready`。它不再读取完整
明细报表或跨页重算，也不会在任何不完整状态回退成零、旧缓存或旧项目来源。公司工资、采购付款
现金流和未绑定项目的公司经营费用继续保持各自独立口径。

业务模块暂时继续使用“每模块一张表 + `payload jsonb` + 公共审计字段”的兼容结构，
但员工身份的可信来源已经改为规范化的 `employee_profiles`。旧 `employees.payload`
仅为待审计迁移数据，浏览器角色没有访问权限。

## 基础主数据

### employee_profiles 规范化员工主表

认证与授权关键字段：

- `id uuid primary key`
- `employee_number text not null unique`：正式员工从 `SW-001` 开始；`SW-000` 由服务端引导且不消费序列
- `legacy_employee_id text unique`：历史编号映射，不自动重写业务 JSON
- `auth_user_id uuid unique references auth.users(id) on delete set null`
- `name text not null`
- `department text not null`
- `position text not null`
- `employment_status text not null`：`在职 / 离职 / 休假 / 停工`
- `account_status text not null`：`active / disabled`
- `must_change_password boolean not null`
- `is_hidden_system_account boolean not null`
- `deleted_at timestamptz`
- `created_by_auth_user_id / updated_by_auth_user_id`

表中继续保留性别、出生日期、国籍、入离职日期、联系电话、紧急联系人、住址、签证、
护照、在留卡、工资标准、企业微信映射及备注等档案字段。密码和内部 Auth 别名不进入
任何业务表。

部门只允许：总务部、营业部、事务部、后勤部、设计部、工程部、仓库管理部、电商部、
采购部、财务部。

职位只允许：社长、总务部长、营业部长、部长、主任、主任设计师、设计师、仓库管理员、
工事部长、职长、大工、中工、小工、会计主管、会计。

员工编号至少三位并可自然扩展到 `SW-1000`。编号由
`reserve_employee_number(request_id)` 在数据库内幂等预留；相同 UUID 返回相同编号。
序列允许因外部 Auth 补偿而出现间隔，编号一旦建立不可修改或复用。

### 员工认证安全表

- `employee_provisioning_requests`：编号预留、Auth 创建、完成及补偿状态；不保存密码或请求原文
- `permission_grants`：部门/职位模板的权限并集，没有员工个人授权
- `auth_login_attempts`：登录限速所需的编号和来源摘要，不保存密码
- `employee_security_audit`：员工创建、停启、调岗、重置和模板修改审计

`permission_grants` 只接受封闭的 62 个模板权限：13 个现有模块各自的
`module.<code>.<view|create|update|delete>`，以及 10 个既有 `sensitive.<code>`。
模板不能写入 `all`、未知模块或 `permission_templates`。`SW-000` 的全权限和社长的
员工/权限模板管理能力由服务端固定规则提供；社长不会因此获得其他业务模块权限。

### projects 工程项目

`projects` 延续通用记录信封：`record_key` 是服务端分配的 `Pxxx`，`payload jsonb` 保存业务
字段，信封 `status` 用于软删除。浏览器不能直接 SELECT/INSERT/UPDATE/DELETE 此表，统一使用：

- `list_projects_secure()`
- `list_project_references_secure()`
- `create_project_secure(project)`
- `update_project_secure(project_id, patch)`
- `soft_delete_project_secure(project_id)`
- `migrate_legacy_project_contract_secure(project_id, expected, opening_receipt)`

跨模块只需要绑定项目时调用 `list_project_references_secure()`，不会借用完整工程模块权限。
它仅返回服务端权威的 `projectId`、`projectName`、`status`、`address` 四个字符串字段，绝不返回
客户、合同金额、备注、坐标或其他工程详情。有效员工只有满足既有关系读取链之一才能调用：完整
工程查看、采购查看、会计页加项目成本查看、会计页加经营费用查看、车辆查看，或工具查看加工具
修改。老板驾驶舱沿用原有两条成本卡片关系链：驾驶舱查看与“查看老板驾驶舱全部数据”敏感权
必须同时存在，再分别叠加项目成本查看或经营费用查看；缺少其中任一项都不能取得项目引用，且
不会因此放宽驾驶舱或敏感数据门槛。工具只读人员不能取得项目引用。该 RPC 是空 `search_path`
的 `SECURITY DEFINER`，先撤销
所有角色权限，再仅向 `authenticated` 与 `service_role` 授予执行权。

可变基础 payload 只允许 `projectName`、`customerName`、`address`、经纬度、打卡半径、
定位确认时间与地址快照、七种项目状态、设计/现场担当各三项快照、起止日期和备注。
`projectId` 由数据库写入。`待开工`、`进行中` 必须具有当前地址的有效确认；地址比较执行
NFKC、trim 和空白折叠。担当只接受当前在职、启用且属于准确部门的规范员工 ID，编号与
姓名由数据库覆盖；ID 未变时保留历史快照，避免员工改名或离职破坏旧项目显示。

合同金额、收款和派生快照共 31 个键属于金融投影边界。普通调用者的 list/create/update
响应全部删除这些键；普通基础更新仍以 `current_payload || patch` 合并，因而不会擦除库存中
已有的金融或历史键。金融源字段写入还必须同时满足固定身份白名单与
`module.projects.update`。确认人 ID/姓名来自当前规范员工，确认时间来自数据库时钟，客户端
提交值不能伪造。

## 业务记录

### labor_records 人工记录

- `labor_record_id text`
- `batch_id text`
- `work_date date`
- `work_location_type text`
- `project_id text`
- `project_name text`
- `employee_id text`
- `employee_name text`
- `department text`
- `position text`
- `level text`
- `work_type text`
- `start_time time`
- `end_time time`
- `work_hours numeric`
- `daily_salary numeric`
- `hourly_wage numeric`
- `labor_cost numeric`
- `job_content text`
- `operator_id text`
- `operator_name text`
- `remark text`

### attendance_accounting 人工考勤核算

`202607160001_attendance_accounting.sql` 在不可变“今日打卡”事实之上增加五张规范表：

- `attendance_accounting_settings`：启用日期、星期一至星期六、08:00–17:00、60 分钟休息和 480 分钟标准工时；
- `attendance_day_resolutions`：会计对整天、半天、休息、请假、调休或缺勤的版本化日结；
- `attendance_project_allocations`：按日、按项目保存整数日元分摊，合计必须等于当日最终项目人工成本；
- `attendance_monthly_payrolls`：月工资草稿、确认和重开，并在确认时锁定对应日结；
- `attendance_accounting_audit_log`：设置、日结和月工资变更的服务端身份与前后快照。

所有基表启用 RLS，`anon` 和 `authenticated` 没有直接表访问。浏览器只调用显式授权的
security-definer RPC；服务不可用、响应形状不合法、会话切换或权限不足时失败关闭，不从
localStorage、旧页面缓存或角色名称恢复工资和项目金额。

权限按能力组合：`module.labor.view` 只读取脱敏考勤；工资金额还要求
`sensitive.salary_view`；日结更新要求 `module.labor.update`；含金额的项目分摊还要求
`module.project_costs.view/update` 与 `sensitive.salary_update`；月工资确认要求
`module.labor.update`、`sensitive.salary_view/update`。向会计成本、老板驾驶舱和工程项目提供
正式金额的桥接 RPC 必须同时具备 `module.labor.view`、`sensitive.salary_view` 和
`module.project_costs.view`，缺一项都不请求。

启用日期以前保留旧 `labor_records`/`salary_records` 作为历史来源；启用日期及以后项目
人工只统计已确认分摊，启用月份及以后工资只统计已确认月工资。启用后的旧记录进入核对清单，
不与新金额叠加。星期一至星期六默认应出勤，超过上班时间仍未打卡才提醒；星期日无场次时为
可选且不标红，但仍允许正常打卡和会计核对。

项目费用页支持按月和整个项目累计查询。CSV 由受控 RPC 返回明细，前端输出 UTF-8 BOM、
稳定列顺序并中和公式起始字符；含员工维度的导出要求工资查看权限。部署、启用、历史核对和
回滚步骤见 [人工考勤核算运维手册](./attendance-accounting-operations.md)。

### purchase_records 采购记录

- `purchase_id text`
- `purchase_date date`
- `purchase_source text`
- `supplier_name text`
- `platform text`
- `purchase_type text`
- `item_name text`
- `specification text`
- `quantity numeric`
- `unit text`
- `unit_price numeric`
- `currency text`
- `exchange_rate numeric`
- `original_amount numeric`
- `jpy_amount numeric`
- `shipping_fee numeric`
- `customs_fee numeric`
- `other_fee numeric`
- `total_cost numeric`
- `purchase_purpose text`
- `project_id text`
- `project_name text`
- `payment_status text`
- `paid_amount numeric`
- `unpaid_amount numeric`
- `invoice_status text`
- `arrival_status text`
- `stock_in_status text`
- `purchase_status text`
- `employee_id text`
- `employee_name text`
- `remark text`

### purchase_payment_records 采购付款

- `payment_id text`
- `purchase_id text`
- `payment_date date`
- `payment_amount numeric`
- `currency text`
- `exchange_rate numeric`
- `jpy_amount numeric`
- `payment_method text`
- `employee_id text`
- `employee_name text`
- `remark text`

### inventory_items 仓库库存

- `inventory_id text`
- `item_name text`
- `specification text`
- `category text`
- `quantity numeric`
- `unit text`
- `warehouse_location text`
- `source_type text`
- `source_purchase_id text`
- `average_cost numeric`
- `total_cost numeric`

### stock_in_records 入库记录

- `stock_in_id text`
- `source_type text`
- `source_purchase_id text`
- `item_name text`
- `specification text`
- `stock_in_quantity numeric`
- `unit text`
- `stock_in_date date`
- `warehouse_location text`
- `project_id text`
- `project_name text`
- `employee_id text`
- `employee_name text`
- `remark text`

### stock_out_records / stock_return_records 出库与退回

- `record_id text`
- `project_id text`
- `project_name text`
- `material_name text`
- `quantity numeric`
- `unit text`
- `date date`
- `employee_id text`
- `employee_name text`
- `remark text`

## 工具管理

### tool_records 工具档案

- `tool_id text`
- `tool_name text`
- `specification text`
- `brand text`
- `serial_number text`
- `category text`
- `purchase_price numeric`
- `quantity numeric`
- `current_status text`
- `current_holder_employee_id text`
- `current_holder_employee_name text`
- `holder_type text`
- `storage_location text`
- `remark text`

### tool_borrow_records 临时借用

- `borrow_record_id text`
- `borrow_type text`
- `tool_id text`
- `tool_name text`
- `specification text`
- `brand text`
- `serial_number text`
- `employee_id text`
- `employee_name text`
- `quantity numeric`
- `date date`
- `expected_return_date date`
- `tool_value numeric`
- `project_id text`
- `project_name text`
- `remark text`

### tool_return_records 归还工具

- `return_record_id text`
- `borrow_record_id text`
- `tool_id text`
- `tool_name text`
- `quantity numeric`
- `date date`
- `employee_id text`
- `employee_name text`
- `remark text`

### lifelong_tool_assignments 工具终身领用

- `assignment_id text`
- `tool_id text`
- `tool_name text`
- `specification text`
- `brand text`
- `serial_number text`
- `employee_id text`
- `employee_name text`
- `department text`
- `position text`
- `assign_date date`
- `tool_value numeric`
- `responsibility_status text`
- `compensation_rule text`
- `void_reason text`
- `remark text`

### tool_responsibility_records 工具责任记录

- `responsibility_record_id text`
- `assignment_id text`
- `tool_id text`
- `tool_name text`
- `employee_id text`
- `employee_name text`
- `record_date date`
- `issue_type text`
- `issue_description text`
- `tool_value numeric`
- `repair_cost numeric`
- `compensation_amount numeric`
- `compensation_status text`
- `deduct_from_salary boolean`
- `salary_deduction_month text`
- `handler_employee_id text`
- `handler_employee_name text`
- `remark text`

## 车辆管理

### vehicle_records 车辆档案

- `vehicle_id text`
- `plate_number text`
- `vehicle_name text`
- `vehicle_type text`
- `brand text`
- `model text`
- `status text`
- `current_mileage numeric`
- `inspection_expire_date date`
- `insurance_expire_date date`
- `responsible_employee_id text`
- `responsible_employee_name text`
- `remark text`

### vehicle_usage_records 用车记录

- `usage_record_id text`
- `usage_date date`
- `vehicle_id text`
- `plate_number text`
- `vehicle_name text`
- `employee_id text`
- `employee_name text`
- `project_id text`
- `project_name text`
- `usage_purpose text`
- `start_location text`
- `end_location text`
- `start_time time`
- `end_time time`
- `start_mileage numeric`
- `end_mileage numeric`
- `daily_mileage numeric`
- `remark text`

### fuel_records 加油记录

- `fuel_record_id text`
- `fuel_date date`
- `vehicle_id text`
- `plate_number text`
- `vehicle_name text`
- `employee_id text`
- `employee_name text`
- `fuel_station text`
- `fuel_type text`
- `fuel_liters numeric`
- `fuel_amount numeric`
- `mileage_at_fuel numeric`
- `payment_method text`
- `allocate_to_project boolean`
- `project_id text`
- `project_name text`
- `remark text`

### vehicle_expense_records 车辆费用

- `vehicle_expense_id text`
- `expense_date date`
- `vehicle_id text`
- `plate_number text`
- `vehicle_name text`
- `expense_type text`
- `amount numeric`
- `payment_method text`
- `employee_id text`
- `employee_name text`
- `allocate_to_project boolean`
- `project_id text`
- `project_name text`
- `remark text`

### vehicle_issue_records 车辆异常

- `issue_id text`
- `issue_date date`
- `vehicle_id text`
- `plate_number text`
- `vehicle_name text`
- `employee_id text`
- `employee_name text`
- `issue_location text`
- `issue_description text`
- `severity text`
- `issue_status text`
- `resolution text`
- `repair_cost numeric`
- `resolved_date date`
- `allocate_to_project boolean`
- `project_id text`
- `project_name text`
- `remark text`

## 会计成本

### salary_records 工资记录

- `salary_record_id text`
- `employee_id text`
- `employee_name text`
- `salary_month text`
- `base_salary numeric`
- `work_days numeric`
- `overtime_pay numeric`
- `bonus numeric`
- `deduction numeric`
- `net_salary numeric`
- `remark text`

### project_cost_records 项目成本

- `cost_record_id text`
- `project_id text`
- `project_name text`
- `employee_id text`
- `employee_name text`
- `cost_type text`
- `amount numeric`
- `date date`
- `operator text`
- `remark text`

### operating_expense_records 经营费用

- `expense_record_id text`
- `expense_type text`
- `amount numeric`
- `date date`
- `operator text`
- `employee_id text`
- `employee_name text`
- `allocate_to_project boolean`
- `project_id text`
- `project_name text`
- `remark text`

### 统一项目成本明细账（迁移 `202608090001`）

账本不复制或改写各业务模块的原始记录。私有稳定函数
`private.private_project_cost_source_facts()` 将直采、仓库项目出库及冲回、已确认/已锁月人工
分摊、项目车辆燃油/费用/维修、项目工具责任、项目经营费用、旧手工项目成本和新手工账本
统一为固定类型列：来源键、来源模块、单据类型与 ID、项目、类别、成本日期、摘要、
`numeric(18,4)` 原始金额和经办人。

来源键使用固定前缀：`purchase:`、`warehouse:`、`labor:`、`vehicle-fuel:`、
`vehicle-expense:`、`vehicle-issue:`、`tool-responsibility:`、`operating:`、
`legacy-manual:`、`manual:`。新手工表保存的 `source_key` 本身就是完整的
`manual:<uuid>` 稳定键，来源 helper 不再二次拼接前缀。外层删除/作废和业务取消记录不进入
事实集；日期或金额无效的 JSON 记录不会被错误转换为零金额。输出文本按 ECMAScript
`String.prototype.trim()` 的空白集合统一去除首尾字符。无效的项目名称、摘要和经办人等可空
展示字段安全回退为空串且保留金额事实；来源身份、项目 ID 或类别等必填文本无效时不输出不安全
明细行，而以安全来源标识进入 `incompleteSources`，防止成本静默消失。污染保留字和超过字段
上限的内容同样按必填/可空语义处理。采购项目 ID、工具责任类型/项目 ID、旧成本来源类型/项目
ID 即使在供应商 JSON 中类型或格式错误，只要日期与金额仍构成成本候选，也会进入同一不完整来源
通道，不会在来源 union 前被静默过滤。采购来源先按项目成本候选判定：`purchasePurpose` 为
`项目使用`、显式非空项目 ID，或显式提供但类型异常的项目 ID 才进入来源 union。仓库备货、
公司自用等合法非项目采购在项目 ID 缺失或为空时完全排除，不进入明细、汇总或
`incompleteSources`；项目使用缺少项目 ID，以及保留字、超长或类型错误的显式项目 ID 仍进入
`incompleteSources`。
采购付款、到货和发票状态不影响项目直采确认；
车辆维修不等待处理完成。工具丢失按工具原值计入项目毛成本，其他责任类型按维修费计入，
员工赔偿是独立回收事实，不冲减项目毛费用。

`202608100002` 为所有来源增加统一项目资格边界：显式项目绑定只有在 `projects` 记录当前为
`active` 且未取消时才进入正常明细；已删除、已作废或不存在的绑定只进入安全的
`incompleteSources`。工具责任费用还必须把 `allocateToProject` 明确设为 JSON `true`，缺失或
`false` 代表公司费用，不进入项目账本，也不作为不完整项目来源。

仓库生成的 `project_cost_records.payload.sourcePurchaseRecordKeys` 是防重复权威集合，但只有
通过完整仓库事实验证的记录才能贡献权威采购键。验证覆盖正式 `WAREHOUSE-SO/MWO/SR`
（及整单冲销 `WAREHOUSE-WR`）身份与来源类型、`costRecordId`、单据 UUID、有效项目/日期/
金额、`sourceStockOutIds`，以及成员全部为非空唯一字符串的
`sourcePurchaseRecordKeys`；畸形候选不会压掉合法直采。已由仓库冻结批次成本归集的采购不会再
走直采分支。合法 `WAREHOUSE-MWO` 允许金额为零，以便全额退回后仍贡献防重复权威采购键；
零金额只在仓库事实输出层过滤，因此既不生成零值账本行，也不会让对应直采重新计费。人工仅使用
`attendance_day_resolutions.accounting_status in ('confirmed', 'month_locked')` 的已平衡
`attendance_project_allocations`。

账本拥有三张规范化追加表：

| 表 | 用途与关键字段 |
| --- | --- |
| `project_cost_manual_entries` | 不可变完整 `manual:<uuid>` `source_key`、项目/类别/日期、带符号 `original_amount numeric(18,4)`、摘要、经办人、必填原因与服务端创建人/时间 |
| `project_cost_adjustment_events` | `source_key + sequence_no` 唯一，调整前/调整额/调整后、原因、服务端操作人/时间 |
| `project_cost_allocation_events` | `source_key + sequence_no` 唯一，金额快照、项目分摊 JSON、原因、服务端操作人/时间 |

三表全部启用并强制 RLS；`public`、`anon`、`authenticated` 和 `service_role` 均没有直接表
权限，UPDATE、DELETE、TRUNCATE 还会被追加性触发器拒绝。客户端不能直接伪造调整或分摊。

读取只调用
`list_project_cost_ledger_secure(p_filters jsonb default '{}'::jsonb)`。RPC 要求有效员工和
`module.project_costs.view`，不要求采购、仓库、车辆、工具或经营费用模块权限；它接受的字段
仅为 `projectId`、`dateFrom`、`dateTo`、`category`、`sourceModule`、`adjusted`、`keyword`、
`page`、`pageSize`；分页数字必须在转换前等于自身截断值，页尺寸只能为 20、50、100，
`1.5`/`20.1` 等小数会失败关闭。RPC 应用每个来源最新的调整和分摊，按最终
项目分摊逐行输出，在分页前计算总行数、类别汇总、总金额和调整总额，并按日期倒序、来源键、
分摊项目排序。`totalAmount`、`adjustmentTotal` 和每个类别小计都限制在 Task 1 四位小数
安全单位范围 `±900719925474.0991`，越界统一以 `22003` 失败，绝不返回前端无法安全解析的
`ready` DTO。返回对象字段与前端 `normalizeLedgerSnapshot()` 完全一致；只有来源身份、类别
和分摊都完整时 `incompleteSources` 才为空。公有 RPC 和私有来源 helper 都是固定空 `search_path` 的
`SECURITY DEFINER`，私有 helper 对客户端角色无执行权。

迁移 `202608100003_project_cost_accounting_summary.sql` 另外新增
`summarize_project_cost_ledger_secure('{}')`，供会计成本中心读取全生命周期汇总。它沿用相同的
有效员工、`module.project_costs.view`、来源资格、最新调整、最新分摊和不完整来源规则，并在单个
数据库语句快照内直接聚合最终分摊行。返回值只有 `status`、`generatedAt`、`totalAmount`、
`monthlyTotals`、`projectTotals`、`categoryTotals`、`projectMonthCategoryTotals` 和
`incompleteSources`；没有账本 `rows`、业务说明、经办人、单据详情或审计事件。各维度和总计都经
Task 1 四位小数安全单位校验，客户端还会交叉核对各维度与最细聚合格。该会计 RPC 不受原始事实
行数或打印报表 5000/20000 上限约束；它返回预聚合结果，不把超量原始行传给浏览器。

`list_project_cost_ledger_secure` 仍只负责分页明细，`export_project_cost_report_secure` 仍只负责
文档快照。后者的 5000 行账本和 20000 条审计事件上限保持不变，不能因会计聚合 RPC 可用而绕过。

账本写入只允许通过四个固定空 `search_path` 的 `SECURITY DEFINER` RPC：

- `create_project_cost_adjustment_secure(sourceKey, expectedVersion, adjustmentAmount, reason)`：要求
  `module.project_costs.update`，只追加正负四位小数调整。它先做版本快检，再以来源键取得非阻塞
  事务级 advisory lock，并在锁内重新读取版本；锁忙或旧版本统一返回
  SQLSTATE `P0001`，且 SQL `HINT` 为 `PROJECT_COST_LEDGER_VERSION_CONFLICT`，不会留下部分事件，
  原始来源记录永远不改。
- `replace_project_cost_allocations_secure(sourceKey, expectedVersion, reason, allocations)`：要求
  `module.project_costs.update`。它使用与调整完全相同的锁前版本快检、来源 try-lock 与锁内重读
  协议；取得来源锁后按项目键稳定排序，以 `FOR SHARE` 锁定并重新验证全部目标项目。项目必须
  在用且不重复，金额为带符号四位小数，分摊合计必须与当前有效金额完全相等；每次保存一份
  新的不可变分摊快照。
- `create_manual_project_cost_secure(requestId, entry)`：要求 `module.project_costs.create`。客户端
  只提交项目、类别、日期、金额、摘要、经办人与原因；项目名称、创建人和创建时间均由服务端
  生成。完整 UUID 是幂等键；服务端先锁定并查询请求键，只比较规范化后的七个客户端字段，
  因此项目之后改名或停用仍返回首次创建快照且保持单行。只有新请求才以 `FOR SHARE` 锁定并
  重验在用项目；不同内容复用 UUID 仍失败。
- `list_project_cost_audit_secure(filters)`：要求 `module.project_costs.view`，按项目与日期读取调整和
  分摊历史，逐条返回变更前后金额、调整额、分摊前后快照、原因、服务端操作人和时间。审计与
  账本的 `projectId` 过滤都把 `project_cost_safe_text` 的规范化结果赋回，前后空格行为一致。

客户端不得根据 SQL message 解析业务状态。公开账本 RPC 的语义失败保留 SQLSTATE，同时通过
SQL `HINT` 返回固定安全码：`PROJECT_COST_LEDGER_INPUT_INVALID`、
`PROJECT_COST_LEDGER_SOURCE_MISSING`、`PROJECT_COST_LEDGER_VERSION_CONFLICT`、
`PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED`、`PROJECT_COST_LEDGER_ALLOCATION_ACTIVE` 或
`PROJECT_COST_LEDGER_REPORT_TOO_LARGE`。所有公开账本 RPC 的无效员工或权限不足分支保留
SQLSTATE `42501`，并统一返回 `PROJECT_COST_LEDGER_ACCESS_DENIED` `HINT`，客户端无需解析可能变化
的权限 message。手工请求 UUID 内容冲突的 message 仍为
`PROJECT_COST_LEDGER_REQUEST_CONFLICT`，但 `HINT` 明确映射为既有的
`PROJECT_COST_LEDGER_INPUT_INVALID`。

打印、PDF 与 Excel 只调用一次 `export_project_cost_report_secure()`。该稳定 RPC 在同一数据库
语句快照中取得完整账本与匹配审计，服务端固定每页 100 行、账本最多 5000 行、审计最多
20000 条，并返回基于有序完整内容的 64 位十六进制 SHA-256 `snapshotToken`。客户端分页参数
会被拒绝；超限使用 `PROJECT_COST_LEDGER_REPORT_TOO_LARGE`，不得改用跨页拼接或旧缓存。

财务部默认具备项目成本查看、创建和调整权限。所有金额保持 `numeric(18,4)`，审计身份和时间
不能由浏览器传入；账本三张表仍禁止浏览器和 `service_role` 直接写入。

## 权限与安全

`anon` 没有业务表权限。除 `projects` 外的直接 RLS 业务表，每个 authenticated 请求同时验证：

1. JWT 的 `auth.uid()` 已关联 `employee_profiles`；
2. `employment_status = '在职'`；
3. `account_status = 'active'`；
4. `must_change_password = false`；
5. 账号未软删除；
6. 部门与职位权限并集包含本表对应动作。

业务表与权限模块映射：

| 表 | 模块代码 |
| --- | --- |
| 合同变更、付款计划、收款 | `projects` |
| `labor_records` | `labor` |
| 采购及采购付款 | `purchases` |
| 库存及出入退库 | `inventory` |
| 工具档案、借还、终身领用、责任记录 | `tools` |
| 车辆、用车、燃油、费用、异常 | `vehicles` |
| `salary_records` | `salaries` |
| `project_cost_records` | `project_costs` |
| `operating_expense_records` | `operating_expenses` |

`projects` 不在这组直接策略中：它有零条 policy，authenticated 没有任何表权限，只能走前述
RPC。其余 23 张直接 RLS 业务表合计 69 条 SELECT/INSERT/UPDATE policy。

项目金融可见性不读取可编辑的 `sensitive.contract_amount_view/update`。数据库固定允许当前
有效的设计部、财务部、社长或 `SW-000` 查看金融字段；同时仍要求项目模块的 view/update
动作权限。合同变更、付款计划和收款三表使用同一固定身份判断：SELECT 要求
`module.projects.view`，INSERT/UPDATE 要求 `module.projects.update`。这三表显式只向
authenticated 授予 SELECT/INSERT/UPDATE，不授予 DELETE；迁移只删除它们的状态权限触发器，
保留 `set_*_updated_at` 触发器。

其他含敏感金额的 JSONB 表继续使用模板敏感权限：采购记录及采购付款要求
`sensitive.purchase_payments_view/update`；人工记录及工资记录要求
`sensitive.salary_view/update`。因此只有模块权限不能读取或改写这些完整记录。

直接 RLS 表插入只允许 `status = 'active'`。除上述三张合同收入表外，普通更新要求 `update`
权限，涉及 `deleted/void` 的信封状态更新仍由既有触发器重新检查 `delete` 权限。
authenticated 角色没有业务表物理 DELETE；项目软删除只能调用
`soft_delete_project_secure(text)`。
迁移不信任任何历史 policy 名称，而是从 `pg_policies` 枚举并删除目标表的全部旧策略，
随后只创建 SELECT/INSERT/UPDATE 三个白名单策略。它也先撤销 PUBLIC、anon、authenticated
的全部历史表权限，再仅向 authenticated 授予 SELECT/INSERT/UPDATE，因此 TRUNCATE 等绕过
RLS 的旧权限不会残留。

迁移 `202607150001` 会删除设计部/财务部/社长以外主体上持久化的合同金额敏感授权，并只写
一条 `project_financial_template_grants.cleaned` 审计，`safe_details` 仅含
`deletedCount`。模板替换函数在删除旧模板前执行同一固定白名单 guard，不能重新引入越权
授权。该审计不记录被删明细，因此部署前必须单独备份 `permission_grants`。

员工安全表不向 anon/authenticated 授予直接表写权限。浏览器使用以下裁剪 RPC：

- `current_employee_profile()`：当前账号安全字段和实时 `effectivePermissionKeys`
- `employee_directory()`：不含 `SW-000` 的员工编号、姓名、部门、职位和状态
- `employee_profile_detail(id)`：先检查人员查看权限，再分别按证件与工资敏感权限添加字段

这些 RPC 均不返回 `auth_user_id`、密码、内部 Auth 别名或 service-role 数据。
`reserve_employee_number(uuid)` 仅允许 `service_role` 执行。所有 SECURITY DEFINER
函数固定 `search_path`，临时/触发器 helper 的默认执行权限已经撤销。

`SW-000` 不在 SQL 中 seed，也没有 Git 管理的默认密码。它由后续服务端引导流程通过
部署 secret 创建，并由数据库约束保持隐藏、在职、启用、无需首次改密及不可删除。

## 部署、验证与回滚

部署顺序：先备份 `permission_grants`、`projects` 和三张合同收入表，再在一个事务中执行
`202607150001_project_core_security.sql`；验证 forbidden grant 清理与唯一安全审计后，发布只
调用项目 RPC 的客户端。旧版直接读写 `projects` 的浏览器会立即失败，因此数据库与客户端
必须协调发布。

静态与数据库验证：

```bash
node --test src/services/projectCoreSecuritySchema.test.js
npm test
supabase test db supabase/tests/project_core_security.sql
supabase test db
```

没有 Supabase CLI 时，可用本地专用 Supabase PostgreSQL 容器中的 `psql` 执行同一 pgTAP
文件。升级验证必须先在仅有 `202607140001`–`004` 的测试库插入一条 forbidden grant，再以
单事务应用 `005`；并发编号验证必须使用两个独立、均 COMMIT 的连接，不能用一个顺序
pgTAP session 代替。

本迁移没有安全的自动 down migration：回退旧策略会重新开放已禁止的直接项目访问，而清理
审计也无法重建每条已删授权。需要回滚时，应停止浏览器流量，协调回退客户端，并从部署前
备份恢复完整数据库或经审计恢复所需授权；不要只恢复旧 project policies 或状态触发器。
# Project documents

Migration `202607150002_project_documents.sql` adds immutable logical/versioned
document metadata, a private `erp-project-documents` Storage bucket, and
security-definer RPCs for safe browser projections. Base tables remain closed
to `anon` and `authenticated`; document rows and event history cannot be
deleted or have identity metadata rewritten.

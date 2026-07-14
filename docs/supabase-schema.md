# Supabase 数据库字段说明

新环境可执行 [supabase-schema.sql](./supabase-schema.sql)；已有环境使用
[`202607140001_employee_auth.sql`](../supabase/migrations/202607140001_employee_auth.sql)
增量迁移。两者创建相同的员工认证、权限和业务 RLS 对象。

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

- `project_id text`
- `project_name text`
- `customer_name text`
- `address text`
- `status text`
- `manager text`
- `start_date date`
- `end_date date`
- `contract_amount numeric`
- `paid_amount numeric`
- `remark text`

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

## 权限与安全

所有业务表均启用严格 RLS，`anon` 没有业务表权限。每个 authenticated 请求同时验证：

1. JWT 的 `auth.uid()` 已关联 `employee_profiles`；
2. `employment_status = '在职'`；
3. `account_status = 'active'`；
4. `must_change_password = false`；
5. 账号未软删除；
6. 部门与职位权限并集包含本表对应动作。

业务表与权限模块映射：

| 表 | 模块代码 |
| --- | --- |
| `projects`、合同变更、付款计划、收款 | `projects` |
| `labor_records` | `labor` |
| 采购及采购付款 | `purchases` |
| 库存及出入退库 | `inventory` |
| 工具档案、借还、终身领用、责任记录 | `tools` |
| 车辆、用车、燃油、费用、异常 | `vehicles` |
| `salary_records` | `salaries` |
| `project_cost_records` | `project_costs` |
| `operating_expense_records` | `operating_expenses` |

含敏感金额的 JSONB 表还必须同时通过敏感权限：工程、合同增减、付款计划和客户收款要求
`sensitive.contract_amount_view/update`；采购付款要求
`sensitive.purchase_payments_view/update`；工资记录要求
`sensitive.salary_view/update`。因此只有模块权限不能读取或改写这些完整记录。

插入只允许 `status = 'active'`。普通更新要求 `update` 权限；任何涉及
`deleted/void` 的状态更新由触发器重新检查 `delete` 权限，防止编辑权限等同删除权限。
authenticated 角色没有业务表物理 `DELETE` 权限；删除和作废必须保留记录并通过受控状态更新完成。

员工安全表不向 anon/authenticated 授予直接表写权限。浏览器使用以下裁剪 RPC：

- `current_employee_profile()`：当前账号安全字段和实时 `effectivePermissionKeys`
- `employee_directory()`：不含 `SW-000` 的员工编号、姓名、部门、职位和状态
- `employee_profile_detail(id)`：先检查人员查看权限，再分别按证件与工资敏感权限添加字段

这些 RPC 均不返回 `auth_user_id`、密码、内部 Auth 别名或 service-role 数据。
`reserve_employee_number(uuid)` 仅允许 `service_role` 执行。所有 SECURITY DEFINER
函数固定 `search_path`，临时/触发器 helper 的默认执行权限已经撤销。

`SW-000` 不在 SQL 中 seed，也没有 Git 管理的默认密码。它由后续服务端引导流程通过
部署 secret 创建，并由数据库约束保持隐藏、在职、启用、无需首次改密及不可删除。

部署严格 RLS 会立即阻止旧 anon 客户端；数据库迁移、Edge Functions 和新 Auth 前端
必须协调发布。独立合同收入迁移只建表并保持无策略的 fail-closed 状态，严格策略始终由
员工认证迁移统一创建。

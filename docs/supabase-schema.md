# Supabase 数据库字段说明

可执行建表脚本请使用 [supabase-schema.sql](./supabase-schema.sql)。

当前原型云端版已经接入 Supabase。`supabase-schema.sql` 采用“每个业务模块一张表 + payload JSONB + 公共审计字段”的结构，方便先让现有 React 页面快速保存到云端。本文件保留为后续把 JSONB 拆成完整关系型字段时的字段设计参考。

后续正式关系型表建议每张表都保留：

- `id uuid primary key default gen_random_uuid()`
- `company_id uuid`
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()`
- `created_by uuid`
- `updated_by uuid`

业务编号字段如 `project_id`、`employee_id`、`purchase_id` 可继续保留为展示用编号。

## 基础主数据

### employees 人员管理

- `employee_id text`
- `name text`
- `gender text`
- `birth_date date`
- `nationality text`
- `employment_status text`
- `hire_date date`
- `resign_date date`
- `department text`
- `position text`
- `level text`
- `phone text`
- `emergency_contact_name text`
- `emergency_contact_phone text`
- `current_address text`
- `visa_agency text`
- `visa_type text`
- `visa_expire_date date`
- `passport_number text`
- `residence_card_number text`
- `base_salary numeric`
- `daily_salary numeric`
- `hourly_wage numeric`
- `salary_remark text`
- `role text`
- `accessible_modules text[]`
- `can_create_modules text[]`
- `can_edit_modules text[]`
- `can_delete_modules text[]`
- `sensitive_permissions text[]`
- `login_account text`
- `password_hash text`
- `wecom_user_id text`
- `wecom_department_id text`
- `wecom_department_name text`
- `auth_provider text`
- `remark text`

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

## 权限与安全建议

第一阶段可以前端判断权限。接 Supabase 后建议启用 Row Level Security：

- `super_admin` 可读写公司全部数据。
- 普通员工只读自己被授权的模块和本人相关数据。
- 敏感数据如工资、合同、利润、采购付款要单独校验权限。
- 账号密码登录阶段密码只保存 hash，不保存明文。
- 企业微信 `secret` 不能放前端，必须由后端换取 userId。

-- 生旺 ERP 云端数据库原型表结构
-- 在 Supabase SQL Editor 中执行本文件。
-- 当前阶段每个业务模块一张表，业务字段放在 payload jsonb 中，公共审计字段单独保存。
-- 正式上线前应改为 Supabase Auth + 严格 RLS + 后端权限校验。

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.create_erp_record_table(target_table text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create table if not exists public.%I (
      id uuid primary key default gen_random_uuid(),
      record_key text not null unique,
      payload jsonb not null default ''{}''::jsonb,
      attachments jsonb not null default ''[]''::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by_employee_id text not null default '''',
      created_by_employee_name text not null default '''',
      updated_by_employee_id text not null default '''',
      updated_by_employee_name text not null default '''',
      status text not null default ''active'' check (status in (''active'', ''deleted'', ''void''))
    )',
    target_table
  );

  execute format('alter table public.%I enable row level security', target_table);

  execute format('drop policy if exists "%s prototype select" on public.%I', target_table, target_table);
  execute format('drop policy if exists "%s prototype insert" on public.%I', target_table, target_table);
  execute format('drop policy if exists "%s prototype update" on public.%I', target_table, target_table);

  execute format(
    'create policy "%s prototype select" on public.%I for select using (true)',
    target_table,
    target_table
  );
  execute format(
    'create policy "%s prototype insert" on public.%I for insert with check (true)',
    target_table,
    target_table
  );
  execute format(
    'create policy "%s prototype update" on public.%I for update using (true) with check (true)',
    target_table,
    target_table
  );

  execute format('drop trigger if exists set_%s_updated_at on public.%I', target_table, target_table);
  execute format(
    'create trigger set_%s_updated_at before update on public.%I
     for each row execute function public.set_updated_at()',
    target_table,
    target_table
  );
end;
$$;

select public.create_erp_record_table('employees');
select public.create_erp_record_table('projects');
select public.create_erp_record_table('project_contract_changes');
select public.create_erp_record_table('project_payment_plans');
select public.create_erp_record_table('project_receipts');
select public.create_erp_record_table('labor_records');
select public.create_erp_record_table('purchase_records');
select public.create_erp_record_table('purchase_payment_records');
select public.create_erp_record_table('inventory_items');
select public.create_erp_record_table('stock_in_records');
select public.create_erp_record_table('stock_out_records');
select public.create_erp_record_table('stock_return_records');
select public.create_erp_record_table('tool_records');
select public.create_erp_record_table('tool_borrow_records');
select public.create_erp_record_table('tool_return_records');
select public.create_erp_record_table('lifelong_tool_assignments');
select public.create_erp_record_table('tool_responsibility_records');
select public.create_erp_record_table('vehicle_records');
select public.create_erp_record_table('vehicle_usage_records');
select public.create_erp_record_table('fuel_records');
select public.create_erp_record_table('vehicle_expense_records');
select public.create_erp_record_table('vehicle_issue_records');
select public.create_erp_record_table('salary_records');
select public.create_erp_record_table('project_cost_records');
select public.create_erp_record_table('operating_expense_records');

drop function public.create_erp_record_table(text);

-- 可选：首次初始化隐藏恢复账号。前端启动时也会自动确保它存在。
insert into public.employees (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values (
  'SUPER_ADMIN',
  '{
    "employeeId": "SUPER_ADMIN",
    "name": "超级管理员",
    "username": "超级管理员",
    "passwordHash": "320086",
    "department": "管理",
    "position": "超级管理员",
    "employmentStatus": "在职",
    "role": "super_admin",
    "loginEnabled": true,
    "mustChangePassword": false,
    "accessibleModules": ["all"],
    "canCreateModules": ["all"],
    "canEditModules": ["all"],
    "canDeleteModules": ["all"],
    "sensitivePermissions": ["all"],
    "isHiddenSystemAccount": true,
    "source": "系统恢复账号"
  }'::jsonb,
  'active',
  'SYSTEM',
  'SYSTEM',
  'SYSTEM',
  'SYSTEM'
) on conflict (record_key) do update set
  payload = excluded.payload,
  status = 'active',
  updated_at = now();

-- Shengwang ERP employee authentication, authorization, and strict business RLS.
-- Additive migration: legacy JSONB tables and records are preserved, but the legacy
-- employees table is quarantined from browser roles.

create extension if not exists pgcrypto;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- A fresh local `supabase db reset` has no legacy baseline migration yet. Ensure the
-- existing record-table contract is present without replacing or deleting live data.
create or replace function public.create_erp_record_table(target_table text)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  existing_policy text;
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
  for existing_policy in
    select policies.policyname
    from pg_catalog.pg_policies as policies
    where policies.schemaname = 'public'
      and policies.tablename = target_table
  loop
    execute format('drop policy if exists %I on public.%I', existing_policy, target_table);
  end loop;

  execute format('drop trigger if exists %I on public.%I', 'set_' || target_table || '_updated_at', target_table);
  execute format(
    'create trigger %I before update on public.%I
     for each row execute function public.set_updated_at()',
    'set_' || target_table || '_updated_at',
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

create sequence public.employee_number_sequence
  as bigint
  start with 1
  increment by 1
  minvalue 1
  no maxvalue
  no cycle;

create table public.employee_profiles (
  id uuid primary key default gen_random_uuid(),
  employee_number text not null unique,
  legacy_employee_id text unique,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (btrim(name) <> ''),
  gender text,
  birth_date date,
  nationality text,
  employment_status text not null default '在职'
    check (employment_status in ('在职', '离职', '休假', '停工')),
  hire_date date,
  resign_date date,
  department text not null
    check (department in (
      '总务部', '营业部', '事务部', '后勤部', '设计部',
      '工程部', '仓库管理部', '电商部', '采购部', '财务部'
    )),
  position text not null
    check (position in (
      '社长', '总务部长', '营业部长', '部长', '主任',
      '主任设计师', '设计师', '仓库管理员', '工事部长', '职长',
      '大工', '中工', '小工', '会计主管', '会计'
    )),
  level text,
  phone text,
  emergency_contact_name text,
  emergency_contact_phone text,
  current_address text,
  visa_agency text,
  visa_type text,
  visa_expire_date date,
  passport_number text,
  residence_card_number text,
  base_salary numeric,
  daily_salary numeric,
  hourly_wage numeric,
  salary_remark text,
  wecom_user_id text unique,
  wecom_department_id text,
  wecom_department_name text,
  account_status text not null default 'active'
    check (account_status in ('active', 'disabled')),
  must_change_password boolean not null default true,
  is_hidden_system_account boolean not null default false,
  remark text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  updated_by_auth_user_id uuid references auth.users(id) on delete set null,
  constraint employee_profiles_number_format check (employee_number ~ '^SW-[0-9]{3,}$'),
  constraint employee_profiles_hidden_system_account check (
    (not is_hidden_system_account or employee_number = 'SW-000')
    and (
      employee_number <> 'SW-000'
      or (
        is_hidden_system_account
        and employment_status = '在职'
        and account_status = 'active'
        and must_change_password = false
        and deleted_at is null
      )
    )
  )
);

create table public.employee_provisioning_requests (
  request_id uuid primary key,
  employee_number text not null unique,
  status text not null default 'reserved'
    check (status in (
      'reserved', 'auth_created', 'completed',
      'compensation_pending', 'compensated', 'failed'
    )),
  auth_user_id uuid references auth.users(id) on delete set null,
  safe_error_code text,
  reserved_at timestamptz not null default now(),
  auth_created_at timestamptz,
  completed_at timestamptz,
  compensated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_provisioning_number_format check (
    employee_number ~ '^SW-[0-9]{3,}$' and employee_number <> 'SW-000'
  )
);

create table public.permission_grants (
  subject_type text not null check (subject_type in ('department', 'position')),
  subject_code text not null,
  permission_key text not null
    check (permission_key in (
      'module.owner_dashboard.view',
      'module.owner_dashboard.create',
      'module.owner_dashboard.update',
      'module.owner_dashboard.delete',
      'module.projects.view',
      'module.projects.create',
      'module.projects.update',
      'module.projects.delete',
      'module.employees.view',
      'module.employees.create',
      'module.employees.update',
      'module.employees.delete',
      'module.labor.view',
      'module.labor.create',
      'module.labor.update',
      'module.labor.delete',
      'module.purchases.view',
      'module.purchases.create',
      'module.purchases.update',
      'module.purchases.delete',
      'module.inventory.view',
      'module.inventory.create',
      'module.inventory.update',
      'module.inventory.delete',
      'module.tools.view',
      'module.tools.create',
      'module.tools.update',
      'module.tools.delete',
      'module.vehicles.view',
      'module.vehicles.create',
      'module.vehicles.update',
      'module.vehicles.delete',
      'module.accounting.view',
      'module.accounting.create',
      'module.accounting.update',
      'module.accounting.delete',
      'module.salaries.view',
      'module.salaries.create',
      'module.salaries.update',
      'module.salaries.delete',
      'module.project_costs.view',
      'module.project_costs.create',
      'module.project_costs.update',
      'module.project_costs.delete',
      'module.operating_expenses.view',
      'module.operating_expenses.create',
      'module.operating_expenses.update',
      'module.operating_expenses.delete',
      'module.settings.view',
      'module.settings.create',
      'module.settings.update',
      'module.settings.delete',
      'sensitive.salary_view',
      'sensitive.salary_update',
      'sensitive.contract_amount_view',
      'sensitive.contract_amount_update',
      'sensitive.profit_view',
      'sensitive.purchase_payments_view',
      'sensitive.purchase_payments_update',
      'sensitive.employee_identity_view',
      'sensitive.employee_identity_update',
      'sensitive.owner_dashboard_full_view'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_auth_user_id uuid references auth.users(id) on delete set null,
  updated_by_auth_user_id uuid references auth.users(id) on delete set null,
  primary key (subject_type, subject_code, permission_key),
  constraint permission_grants_fixed_subject check (
    (
      subject_type = 'department'
      and subject_code in (
        '总务部', '营业部', '事务部', '后勤部', '设计部',
        '工程部', '仓库管理部', '电商部', '采购部', '财务部'
      )
    )
    or (
      subject_type = 'position'
      and subject_code in (
        '社长', '总务部长', '营业部长', '部长', '主任',
        '主任设计师', '设计师', '仓库管理员', '工事部长', '职长',
        '大工', '中工', '小工', '会计主管', '会计'
      )
    )
  )
);

create table public.auth_login_attempts (
  id bigint generated always as identity primary key,
  employee_number text not null,
  source_fingerprint text not null,
  succeeded boolean not null default false,
  failure_code text,
  attempted_at timestamptz not null default now(),
  locked_until timestamptz,
  constraint auth_login_attempts_number_format check (employee_number ~ '^SW-[0-9]{3,}$'),
  constraint auth_login_attempts_source_fingerprint check (btrim(source_fingerprint) <> '')
);

create table public.employee_security_audit (
  id uuid primary key default gen_random_uuid(),
  actor_auth_user_id uuid references auth.users(id) on delete set null,
  target_employee_profile_id uuid references public.employee_profiles(id) on delete set null,
  action text not null check (btrim(action) <> ''),
  safe_details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index employee_profiles_auth_state_idx
  on public.employee_profiles (auth_user_id, account_status, employment_status)
  where deleted_at is null;
create index employee_profiles_directory_idx
  on public.employee_profiles (is_hidden_system_account, employment_status, name)
  where deleted_at is null;
create index employee_provisioning_status_idx
  on public.employee_provisioning_requests (status, updated_at);
create index permission_grants_subject_idx
  on public.permission_grants (subject_type, subject_code);
create index auth_login_attempts_rate_limit_idx
  on public.auth_login_attempts (employee_number, source_fingerprint, attempted_at desc);
create index employee_security_audit_target_idx
  on public.employee_security_audit (target_employee_profile_id, created_at desc);

create trigger set_employee_profiles_updated_at
before update on public.employee_profiles
for each row execute function public.set_updated_at();

create trigger set_employee_provisioning_requests_updated_at
before update on public.employee_provisioning_requests
for each row execute function public.set_updated_at();

create trigger set_permission_grants_updated_at
before update on public.permission_grants
for each row execute function public.set_updated_at();

create or replace function public.protect_employee_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.employee_number is distinct from new.employee_number then
    raise exception using
      errcode = '23514',
      message = 'employee_number cannot be changed';
  end if;
  return new;
end;
$$;

create trigger protect_employee_number
before update of employee_number on public.employee_profiles
for each row execute function public.protect_employee_number();

create or replace function public.protect_hidden_system_employee()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.employee_number <> 'SW-000' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'SW-000 cannot be deleted';
  end if;

  if new.is_hidden_system_account is distinct from true
    or new.employment_status is distinct from '在职'
    or new.account_status is distinct from 'active'
    or new.must_change_password is distinct from false
    or new.deleted_at is not null
  then
    raise exception using
      errcode = '23514',
      message = 'SW-000 security state cannot be changed';
  end if;

  return new;
end;
$$;

create trigger protect_hidden_system_employee
before update or delete on public.employee_profiles
for each row execute function public.protect_hidden_system_employee();

create or replace function public.reserve_employee_number(p_request_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  reserved_number text;
  sequence_value bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_request_id is null then
    raise exception using errcode = '22004', message = 'request id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select request.employee_number
    into reserved_number
    from public.employee_provisioning_requests as request
    where request_id = p_request_id;

  if reserved_number is not null then
    return reserved_number;
  end if;

  sequence_value := nextval('public.employee_number_sequence'::regclass);
  reserved_number := 'SW-' || lpad(
    sequence_value::text,
    greatest(3, length(sequence_value::text)),
    '0'
  );

  insert into public.employee_provisioning_requests (
    request_id,
    employee_number,
    status
  ) values (
    p_request_id,
    reserved_number,
    'reserved'
  );

  return reserved_number;
end;
$$;

create or replace function private.employee_effective_permission_keys(p_employee_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  employee public.employee_profiles%rowtype;
  permission_keys text[];
begin
  select profile.*
    into employee
    from public.employee_profiles as profile
    where profile.id = p_employee_id
      and profile.deleted_at is null;

  if not found
    or employee.auth_user_id is null
    or employee.employment_status <> '在职'
    or employee.account_status <> 'active'
    or employee.must_change_password <> false
  then
    return array[]::text[];
  end if;

  if employee.employee_number = 'SW-000' then
    return array['all']::text[];
  end if;

  select coalesce(
      array_agg(granted.permission_key order by granted.permission_key),
      array[]::text[]
    )
    into permission_keys
    from (
      select grant_row.permission_key
      from public.permission_grants as grant_row
      where (
        grant_row.subject_type = 'department'
        and grant_row.subject_code = employee.department
      ) or (
        grant_row.subject_type = 'position'
        and grant_row.subject_code = employee.position
      )
      union
      select fixed_permission.permission_key
      from unnest(array[
        'module.employees.view',
        'module.employees.create',
        'module.employees.update',
        'module.employees.delete',
        'module.permission_templates.view',
        'module.permission_templates.update'
      ]::text[]) as fixed_permission(permission_key)
      where employee.position = '社长'
    ) as granted;

  return permission_keys;
end;
$$;

create or replace function public.is_current_employee_active()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null
  );
$$;

create or replace function public.has_current_permission(p_permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  employee_id uuid;
  permission_keys text[];
begin
  if p_permission_key is null
    or p_permission_key !~ '^(module\.[a-z0-9_]+\.(view|create|update|delete)|sensitive\.[a-z0-9_]+)$'
    or not public.is_current_employee_active()
  then
    return false;
  end if;

  select employee.id
    into employee_id
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null;

  permission_keys := private.employee_effective_permission_keys(employee_id);
  return permission_keys @> array['all']::text[]
    or permission_keys @> array[p_permission_key]::text[];
end;
$$;

create or replace function public.current_employee_profile()
returns table (
  "id" uuid,
  "employeeNumber" text,
  "name" text,
  "department" text,
  "position" text,
  "employmentStatus" text,
  "accountStatus" text,
  "mustChangePassword" boolean,
  "isHiddenSystemAccount" boolean,
  "effectivePermissionKeys" text[]
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  return query
  select
    employee.id,
    employee.employee_number,
    employee.name,
    employee.department,
    employee.position,
    employee.employment_status,
    employee.account_status,
    employee.must_change_password,
    employee.is_hidden_system_account,
    private.employee_effective_permission_keys(employee.id)
  from public.employee_profiles as employee
  where employee.auth_user_id = auth.uid()
    and employee.deleted_at is null;
end;
$$;

create or replace function public.employee_directory()
returns table (
  "id" uuid,
  "employeeNumber" text,
  "name" text,
  "department" text,
  "position" text,
  "employmentStatus" text,
  "accountStatus" text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_current_employee_active() then
    return;
  end if;

  return query
  select
    employee.id,
    employee.employee_number,
    employee.name,
    employee.department,
    employee.position,
    employee.employment_status,
    employee.account_status
  from public.employee_profiles as employee
  where employee.deleted_at is null
    and employee.is_hidden_system_account = false
    and employee.employee_number <> 'SW-000'
  order by employee.employee_number;
end;
$$;

create or replace function public.employee_profile_detail(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
  current_employee_id uuid;
  result jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using errcode = '42501', message = 'active employee required';
  end if;

  select current_employee.id
    into current_employee_id
    from public.employee_profiles as current_employee
    where current_employee.auth_user_id = auth.uid()
      and current_employee.deleted_at is null;

  if current_employee_id is distinct from p_employee_id
    and not public.has_current_permission('module.employees.view')
  then
    raise exception using errcode = '42501', message = 'employee view permission required';
  end if;

  select profile.*
    into employee
    from public.employee_profiles as profile
    where profile.id = p_employee_id
      and profile.deleted_at is null;

  if not found or employee.is_hidden_system_account then
    return null;
  end if;

  result := jsonb_build_object(
    'id', employee.id,
    'employeeNumber', employee.employee_number,
    'legacyEmployeeId', employee.legacy_employee_id,
    'name', employee.name,
    'department', employee.department,
    'position', employee.position,
    'employmentStatus', employee.employment_status,
    'accountStatus', employee.account_status,
    'mustChangePassword', employee.must_change_password,
    'hireDate', employee.hire_date,
    'resignDate', employee.resign_date,
    'level', employee.level,
    'phone', employee.phone,
    'remark', employee.remark,
    'createdAt', employee.created_at,
    'updatedAt', employee.updated_at
  );

  if public.has_current_permission('sensitive.employee_identity_view') then
    result := result || jsonb_build_object(
      'gender', employee.gender,
      'birthDate', employee.birth_date,
      'nationality', employee.nationality,
      'emergencyContactName', employee.emergency_contact_name,
      'emergencyContactPhone', employee.emergency_contact_phone,
      'currentAddress', employee.current_address,
      'visaAgency', employee.visa_agency,
      'visaType', employee.visa_type,
      'visaExpireDate', employee.visa_expire_date,
      'passportNumber', employee.passport_number,
      'residenceCardNumber', employee.residence_card_number
    );
  end if;

  if public.has_current_permission('sensitive.salary_view') then
    result := result || jsonb_build_object(
      'baseSalary', employee.base_salary,
      'dailySalary', employee.daily_salary,
      'hourlyWage', employee.hourly_wage,
      'salaryRemark', employee.salary_remark
    );
  end if;

  return result;
end;
$$;

-- Direct browser writes are never trusted to distinguish an edit from a soft delete.
-- This trigger makes status=deleted/void transitions require the delete permission.
create or replace function public.enforce_business_status_permission()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  required_action text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if not public.is_current_employee_active() then
    raise exception using errcode = '42501', message = 'active employee required';
  end if;

  if old.status in ('deleted', 'void') or new.status in ('deleted', 'void') then
    required_action := 'delete';
  else
    required_action := 'update';
  end if;

  if not public.has_current_permission(format('module.%s.%s', tg_argv[0], required_action)) then
    raise exception using errcode = '42501', message = required_action || ' permission required';
  end if;
  return new;
end;
$$;

alter table public.employee_profiles enable row level security;
alter table public.employee_provisioning_requests enable row level security;
alter table public.permission_grants enable row level security;
alter table public.auth_login_attempts enable row level security;
alter table public.employee_security_audit enable row level security;

revoke all on table public.employee_profiles from public, anon, authenticated;
revoke all on table public.employee_provisioning_requests from public, anon, authenticated;
revoke all on table public.permission_grants from public, anon, authenticated;
revoke all on table public.auth_login_attempts from public, anon, authenticated;
revoke all on table public.employee_security_audit from public, anon, authenticated;
revoke all on sequence public.employee_number_sequence from public, anon, authenticated;

grant all on table public.employee_profiles to service_role;
grant all on table public.employee_provisioning_requests to service_role;
grant all on table public.permission_grants to service_role;
grant all on table public.auth_login_attempts to service_role;
grant all on table public.employee_security_audit to service_role;
grant all on sequence public.employee_number_sequence to service_role;

revoke all on function public.reserve_employee_number(uuid) from public, anon, authenticated;
grant execute on function public.reserve_employee_number(uuid) to service_role;

revoke all on function private.employee_effective_permission_keys(uuid) from public, anon, authenticated;
revoke all on function public.is_current_employee_active() from public, anon;
revoke all on function public.has_current_permission(text) from public, anon;
revoke all on function public.current_employee_profile() from public, anon;
revoke all on function public.employee_directory() from public, anon;
revoke all on function public.employee_profile_detail(uuid) from public, anon;

grant execute on function public.is_current_employee_active() to authenticated, service_role;
grant execute on function public.has_current_permission(text) to authenticated, service_role;
grant execute on function public.current_employee_profile() to authenticated, service_role;
grant execute on function public.employee_directory() to authenticated, service_role;
grant execute on function public.employee_profile_detail(uuid) to authenticated, service_role;

-- The legacy employee JSONB table is retained for later audited migration only.
alter table public.employees enable row level security;
-- create_erp_record_table catalog-dropped every pre-existing policy, including
-- policies whose names were never known to this migration.
revoke all on table public.employees from public, anon, authenticated;
grant all on table public.employees to service_role;

do $$
declare
  business_table text;
  module_code text;
  sensitive_code text;
  sensitive_view_check text;
  sensitive_update_check text;
begin
  for business_table, module_code, sensitive_code in
    select
      mapping.table_name,
      mapping.permission_module,
      mapping.sensitive_permission
    from (values
      ('projects', 'projects', 'contract_amount'),
      ('project_contract_changes', 'projects', 'contract_amount'),
      ('project_payment_plans', 'projects', 'contract_amount'),
      ('project_receipts', 'projects', 'contract_amount'),
      ('labor_records', 'labor', 'salary'),
      ('purchase_records', 'purchases', 'purchase_payments'),
      ('purchase_payment_records', 'purchases', 'purchase_payments'),
      ('inventory_items', 'inventory', null),
      ('stock_in_records', 'inventory', null),
      ('stock_out_records', 'inventory', null),
      ('stock_return_records', 'inventory', null),
      ('tool_records', 'tools', null),
      ('tool_borrow_records', 'tools', null),
      ('tool_return_records', 'tools', null),
      ('lifelong_tool_assignments', 'tools', null),
      ('tool_responsibility_records', 'tools', null),
      ('vehicle_records', 'vehicles', null),
      ('vehicle_usage_records', 'vehicles', null),
      ('fuel_records', 'vehicles', null),
      ('vehicle_expense_records', 'vehicles', null),
      ('vehicle_issue_records', 'vehicles', null),
      ('salary_records', 'salaries', 'salary'),
      ('project_cost_records', 'project_costs', null),
      ('operating_expense_records', 'operating_expenses', null)
    ) as mapping(table_name, permission_module, sensitive_permission)
  loop
    sensitive_view_check := case
      when sensitive_code is null then 'true'
      else format(
        'public.has_current_permission(%L)',
        format('sensitive.%s_view', sensitive_code)
      )
    end;
    sensitive_update_check := case
      when sensitive_code is null then 'true'
      else format(
        'public.has_current_permission(%L)',
        format('sensitive.%s_update', sensitive_code)
      )
    end;

    execute format('alter table public.%I enable row level security', business_table);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated',
      business_table
    );
    execute format(
      'grant select, insert, update on table public.%I to authenticated',
      business_table
    );
    execute format('grant all on table public.%I to service_role', business_table);

    execute format(
      'create policy %I on public.%I for select to authenticated
       using (
         public.is_current_employee_active()
         and public.has_current_permission(%L)
         and %s
       )',
      business_table || ' authenticated select',
      business_table,
      format('module.%s.view', module_code),
      sensitive_view_check
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated
       with check (
         public.is_current_employee_active()
         and public.has_current_permission(%L)
         and %s
         and status = ''active''
       )',
      business_table || ' authenticated insert',
      business_table,
      format('module.%s.create', module_code),
      sensitive_update_check
    );
    execute format(
      'create policy %I on public.%I for update to authenticated
       using (
         public.is_current_employee_active()
         and (
           public.has_current_permission(%L)
           or public.has_current_permission(%L)
         )
         and %s
       )
       with check (
         public.is_current_employee_active()
         and (
           public.has_current_permission(%L)
           or public.has_current_permission(%L)
         )
         and %s
       )',
      business_table || ' authenticated update',
      business_table,
      format('module.%s.update', module_code),
      format('module.%s.delete', module_code),
      sensitive_update_check,
      format('module.%s.update', module_code),
      format('module.%s.delete', module_code),
      sensitive_update_check
    );

    execute format(
      'drop trigger if exists %I on public.%I',
      'enforce_' || business_table || '_status_permission',
      business_table
    );
    execute format(
      'create trigger %I before update on public.%I
       for each row execute function public.enforce_business_status_permission(%L)',
      'enforce_' || business_table || '_status_permission',
      business_table,
      module_code
    );
  end loop;
end;
$$;

revoke all on function public.enforce_business_status_permission() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.protect_employee_number() from public, anon, authenticated;
revoke all on function public.protect_hidden_system_employee() from public, anon, authenticated;
drop function public.create_erp_record_table(text);

-- REVIEW REFERENCE ONLY: historical base snapshot plus the attendance-accounting
-- migration copied at the end of this file. Intermediate migration dependencies
-- are intentionally absent, so this is not a final bootstrap. Fresh installs and
-- upgrades must apply the ordered files in supabase/migrations/ instead.
-- Shengwang ERP employee authentication, authorization, and strict business RLS.
-- Legacy JSONB tables and records are preserved, but the legacy employees table
-- is quarantined from browser roles.

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

-- ATTENDANCE ACCOUNTING REFERENCE SNAPSHOT
-- The canonical deployment path remains the ordered files in supabase/migrations/.
-- The block below mirrors 202607160001_attendance_accounting.sql so reviewers can
-- inspect the production-equivalent accounting schema alongside the base reference.
-- Normalized, RPC-only attendance accounting state. Attendance sessions and events
-- remain immutable facts; accounting decisions and snapshots live only here.

begin;

create table public.attendance_accounting_settings (
  settings_key text primary key default 'default',
  effective_from date not null,
  work_weekdays smallint[] not null
    default array[1, 2, 3, 4, 5, 6]::smallint[],
  work_start_time time without time zone not null default '08:00'::time,
  work_end_time time without time zone not null default '17:00'::time,
  break_minutes integer not null default 60,
  standard_day_minutes integer not null default 480,
  version integer not null default 1,
  updated_by_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_accounting_settings_key_check check (
    settings_key = 'default'
  ),
  constraint attendance_accounting_settings_effective_from_finite_check check (
    isfinite(effective_from)
  ),
  constraint attendance_accounting_settings_weekdays_check check (
    cardinality(work_weekdays) between 1 and 7
    and work_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    and array_position(work_weekdays, null::smallint) is null
    and cardinality(array_positions(work_weekdays, 1::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 2::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 3::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 4::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 5::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 6::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 7::smallint)) <= 1
  ),
  constraint attendance_accounting_settings_time_order_check check (
    work_start_time < work_end_time
  ),
  constraint attendance_accounting_settings_break_minutes_check check (
    break_minutes between 0 and 1439
    and break_minutes < extract(
      epoch from (work_end_time - work_start_time)
    ) / 60
  ),
  constraint attendance_accounting_settings_standard_minutes_check check (
    standard_day_minutes between 1 and 1440
    and standard_day_minutes <= (
      extract(epoch from (work_end_time - work_start_time)) / 60
      - break_minutes
    )
  ),
  constraint attendance_accounting_settings_version_check check (
    version >= 1
  ),
  constraint attendance_accounting_settings_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_accounting_settings_updated_at_finite_check check (
    isfinite(updated_at)
  ),
  constraint attendance_accounting_settings_timestamps_check check (
    updated_at >= created_at
  )
);

create table public.attendance_day_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  work_date date not null,
  schedule_required boolean not null,
  resolution_type text not null,
  attendance_units numeric(2, 1) not null,
  accounting_status text not null default 'draft',
  salary_type_snapshot text not null,
  base_salary_snapshot numeric,
  daily_salary_snapshot numeric,
  hourly_wage_snapshot numeric,
  suggested_project_cost numeric not null,
  final_project_cost numeric not null,
  issue_codes_snapshot text[] not null default array[]::text[],
  worked_minutes_reference_snapshot integer,
  resolution_note text not null default '',
  confirmed_by_employee_profile_id uuid
    references public.employee_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_day_resolutions_employee_day_unique
    unique (employee_profile_id, work_date),
  constraint attendance_day_resolutions_work_date_finite_check check (
    isfinite(work_date)
  ),
  constraint attendance_day_resolutions_type_check check (
    resolution_type in (
      'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'
    )
  ),
  constraint attendance_day_resolutions_units_check check (
    attendance_units in (0, 0.5, 1)
  ),
  constraint attendance_day_resolutions_type_units_check check (
    (resolution_type = 'full_day' and attendance_units = 1)
    or (resolution_type = 'half_day' and attendance_units = 0.5)
    or (
      resolution_type in ('rest', 'leave', 'comp_time', 'absence')
      and attendance_units = 0
    )
  ),
  constraint attendance_day_resolutions_status_check check (
    accounting_status in ('draft', 'confirmed', 'month_locked')
  ),
  constraint attendance_day_resolutions_salary_type_check check (
    salary_type_snapshot in ('月薪', '日薪', '时薪', '未设置')
  ),
  constraint attendance_day_resolutions_base_salary_yen_check check (
    base_salary_snapshot is null
    or (
      base_salary_snapshot not in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      and base_salary_snapshot >= 0
      and base_salary_snapshot = trunc(base_salary_snapshot)
    )
  ),
  constraint attendance_day_resolutions_daily_salary_yen_check check (
    daily_salary_snapshot is null
    or (
      daily_salary_snapshot not in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      and daily_salary_snapshot >= 0
      and daily_salary_snapshot = trunc(daily_salary_snapshot)
    )
  ),
  constraint attendance_day_resolutions_hourly_wage_yen_check check (
    hourly_wage_snapshot is null
    or (
      hourly_wage_snapshot not in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      and hourly_wage_snapshot >= 0
      and hourly_wage_snapshot = trunc(hourly_wage_snapshot)
    )
  ),
  constraint attendance_day_resolutions_suggested_cost_yen_check check (
    suggested_project_cost not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and suggested_project_cost >= 0
    and suggested_project_cost = trunc(suggested_project_cost)
  ),
  constraint attendance_day_resolutions_final_cost_yen_check check (
    final_project_cost not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and final_project_cost >= 0
    and final_project_cost = trunc(final_project_cost)
  ),
  constraint attendance_day_resolutions_issue_codes_snapshot_check check (
    issue_codes_snapshot <@ array[
      'abnormal_location', 'missing_clock_in', 'missing_clock_out',
      'late', 'early', 'overtime_pending'
    ]::text[]
    and array_position(issue_codes_snapshot, null::text) is null
    and cardinality(issue_codes_snapshot) <= 6
    and cardinality(array_positions(
      issue_codes_snapshot, 'abnormal_location'
    )) <= 1
    and cardinality(array_positions(
      issue_codes_snapshot, 'missing_clock_in'
    )) <= 1
    and cardinality(array_positions(
      issue_codes_snapshot, 'missing_clock_out'
    )) <= 1
    and cardinality(array_positions(issue_codes_snapshot, 'late')) <= 1
    and cardinality(array_positions(issue_codes_snapshot, 'early')) <= 1
    and cardinality(array_positions(
      issue_codes_snapshot, 'overtime_pending'
    )) <= 1
  ),
  constraint attendance_day_resolutions_worked_minutes_snapshot_check check (
    worked_minutes_reference_snapshot is null
    or worked_minutes_reference_snapshot >= 0
  ),
  constraint attendance_day_resolutions_note_check check (
    resolution_note = btrim(resolution_note)
    and char_length(resolution_note) <= 2000
  ),
  constraint attendance_day_resolutions_confirmation_check check (
    (accounting_status = 'draft'
      and confirmed_by_employee_profile_id is null
      and confirmed_at is null)
    or (accounting_status in ('confirmed', 'month_locked')
      and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null)
  ),
  constraint attendance_day_resolutions_version_check check (version >= 1),
  constraint attendance_day_resolutions_confirmed_at_finite_check check (
    confirmed_at is null or isfinite(confirmed_at)
  ),
  constraint attendance_day_resolutions_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_day_resolutions_updated_at_finite_check check (
    isfinite(updated_at)
  ),
  constraint attendance_day_resolutions_timestamps_check check (
    updated_at >= created_at
    and (
      confirmed_at is null
      or confirmed_at between created_at and updated_at
    )
  )
);

create index attendance_day_resolutions_work_date_idx
  on public.attendance_day_resolutions(
    work_date, accounting_status, employee_profile_id
  );

create table public.attendance_project_allocations (
  allocation_id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null
    references public.attendance_day_resolutions(resolution_id)
    on delete restrict,
  project_id text not null
    references public.projects(record_key) on delete restrict,
  project_name_snapshot text not null,
  amount numeric not null,
  allocation_note text not null default '',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_project_allocations_resolution_project_unique
    unique (resolution_id, project_id),
  constraint attendance_project_allocations_project_name_check check (
    project_name_snapshot = btrim(project_name_snapshot)
    and char_length(project_name_snapshot) between 1 and 500
  ),
  constraint attendance_project_allocations_amount_yen_check check (
    amount not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and amount >= 0
    and amount = trunc(amount)
  ),
  constraint attendance_project_allocations_note_check check (
    allocation_note = btrim(allocation_note)
    and char_length(allocation_note) <= 2000
  ),
  constraint attendance_project_allocations_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_project_allocations_updated_at_finite_check check (
    isfinite(updated_at)
  ),
  constraint attendance_project_allocations_timestamps_check check (
    updated_at >= created_at
  )
);

create index attendance_project_allocations_project_idx
  on public.attendance_project_allocations(project_id, resolution_id);

create table public.attendance_monthly_payrolls (
  payroll_id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  salary_month date not null,
  salary_type_snapshot text not null,
  base_salary_snapshot numeric not null,
  full_days numeric not null,
  half_days numeric not null,
  absence_days numeric not null,
  scheduled_attendance_units integer not null default 0,
  base_pay numeric not null,
  overtime_pay numeric not null default 0,
  bonus numeric not null default 0,
  deduction numeric not null default 0,
  net_salary numeric not null,
  status text not null default 'draft',
  confirmation_note text not null default '',
  confirmed_by_employee_profile_id uuid
    references public.employee_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_monthly_payrolls_employee_month_unique
    unique (employee_profile_id, salary_month),
  constraint attendance_monthly_payrolls_salary_month_finite_check check (
    isfinite(salary_month)
  ),
  constraint attendance_monthly_payrolls_month_start_check check (
    salary_month = date_trunc('month', salary_month)::date
  ),
  constraint attendance_monthly_payrolls_salary_type_check check (
    salary_type_snapshot in ('月薪', '日薪', '时薪', '未设置')
  ),
  constraint attendance_monthly_payrolls_base_salary_yen_check check (
    base_salary_snapshot not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and base_salary_snapshot >= 0
    and base_salary_snapshot = trunc(base_salary_snapshot)
  ),
  constraint attendance_monthly_payrolls_full_days_check check (
    full_days not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and full_days >= 0
    and full_days = trunc(full_days)
  ),
  constraint attendance_monthly_payrolls_half_days_check check (
    half_days not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and half_days >= 0
    and half_days = trunc(half_days)
  ),
  constraint attendance_monthly_payrolls_absence_days_check check (
    absence_days not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and absence_days >= 0
    and absence_days = trunc(absence_days)
  ),
  constraint attendance_monthly_payrolls_scheduled_units_check check (
    scheduled_attendance_units between 0 and 31
  ),
  constraint attendance_monthly_payrolls_base_pay_yen_check check (
    base_pay not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and base_pay >= 0
    and base_pay = trunc(base_pay)
  ),
  constraint attendance_monthly_payrolls_overtime_pay_yen_check check (
    overtime_pay not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and overtime_pay >= 0
    and overtime_pay = trunc(overtime_pay)
  ),
  constraint attendance_monthly_payrolls_bonus_yen_check check (
    bonus not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and bonus >= 0
    and bonus = trunc(bonus)
  ),
  constraint attendance_monthly_payrolls_deduction_yen_check check (
    deduction not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and deduction >= 0
    and deduction = trunc(deduction)
  ),
  constraint attendance_monthly_payrolls_net_salary_yen_check check (
    net_salary not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and net_salary >= 0
    and net_salary = trunc(net_salary)
    and net_salary = base_pay + overtime_pay + bonus - deduction
  ),
  constraint attendance_monthly_payrolls_status_check check (
    status in ('draft', 'confirmed', 'reopened')
  ),
  constraint attendance_monthly_payrolls_note_check check (
    confirmation_note = btrim(confirmation_note)
    and char_length(confirmation_note) <= 2000
  ),
  constraint attendance_monthly_payrolls_confirmation_check check (
    (
      status = 'confirmed'
      and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null
    )
    or (
      status in ('draft', 'reopened')
      and confirmed_by_employee_profile_id is null
      and confirmed_at is null
    )
  ),
  constraint attendance_monthly_payrolls_version_check check (version >= 1),
  constraint attendance_monthly_payrolls_confirmed_at_finite_check check (
    confirmed_at is null or isfinite(confirmed_at)
  ),
  constraint attendance_monthly_payrolls_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_monthly_payrolls_updated_at_finite_check check (
    isfinite(updated_at)
  ),
  constraint attendance_monthly_payrolls_timestamps_check check (
    updated_at >= created_at
    and (
      confirmed_at is null
      or confirmed_at between created_at and updated_at
    )
  )
);

create index attendance_monthly_payrolls_month_status_idx
  on public.attendance_monthly_payrolls(
    salary_month, status, employee_profile_id
  );

create table public.attendance_accounting_audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  object_type text not null,
  object_id text not null,
  action_type text not null,
  actor_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  occurred_at timestamptz not null default statement_timestamp(),
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text not null default '',
  constraint attendance_accounting_audit_object_type_check check (
    object_type = btrim(object_type)
    and char_length(object_type) between 1 and 100
  ),
  constraint attendance_accounting_audit_object_id_check check (
    object_id = btrim(object_id)
    and char_length(object_id) between 1 and 200
  ),
  constraint attendance_accounting_audit_action_type_check check (
    action_type = btrim(action_type)
    and char_length(action_type) between 1 and 100
  ),
  constraint attendance_accounting_audit_snapshots_check check (
    (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object')
    and (after_snapshot is null or jsonb_typeof(after_snapshot) = 'object')
    and (before_snapshot is not null or after_snapshot is not null)
  ),
  constraint attendance_accounting_audit_reason_check check (
    reason = btrim(reason) and char_length(reason) <= 2000
  ),
  constraint attendance_accounting_audit_occurred_at_finite_check check (
    isfinite(occurred_at)
  )
);

create index attendance_accounting_audit_object_idx
  on public.attendance_accounting_audit_log(
    object_type, object_id, occurred_at desc, audit_id
  );
create index attendance_accounting_audit_actor_idx
  on public.attendance_accounting_audit_log(
    actor_employee_profile_id, occurred_at desc, audit_id
  );

create or replace function private.set_attendance_accounting_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function private.set_attendance_accounting_updated_at()
  from public, anon, authenticated, service_role;

create trigger set_attendance_accounting_settings_updated_at
before update on public.attendance_accounting_settings
for each row execute function private.set_attendance_accounting_updated_at();

create trigger set_attendance_day_resolutions_updated_at
before update on public.attendance_day_resolutions
for each row execute function private.set_attendance_accounting_updated_at();

create trigger set_attendance_project_allocations_updated_at
before update on public.attendance_project_allocations
for each row execute function private.set_attendance_accounting_updated_at();

create trigger set_attendance_monthly_payrolls_updated_at
before update on public.attendance_monthly_payrolls
for each row execute function private.set_attendance_accounting_updated_at();

create or replace function private.reject_attendance_accounting_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'attendance accounting audit rows are immutable';
end;
$$;

revoke all on function private.reject_attendance_accounting_audit_mutation()
  from public, anon, authenticated, service_role;

create trigger reject_attendance_accounting_audit_mutation
before update or delete on public.attendance_accounting_audit_log
for each row
execute function private.reject_attendance_accounting_audit_mutation();

create or replace function private.current_attendance_accountant()
returns public.employee_profiles
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and employee.must_change_password = false
    and employee.deleted_at is null;
  if not found or not public.has_current_permission('module.labor.view') then
    raise exception using errcode = '42501', message = 'labor accountant required';
  end if;
  return actor;
end;
$$;

revoke all on function private.current_attendance_accountant()
  from public, anon, authenticated, service_role;

create or replace function private.attendance_accounting_settings_json()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'configured', true,
        'effectiveFrom', settings.effective_from,
        'workWeekdays', (
          select jsonb_agg(weekday order by weekday)
          from unnest(settings.work_weekdays) weekday
        ),
        'workStartTime', to_char(settings.work_start_time, 'HH24:MI'),
        'workEndTime', to_char(settings.work_end_time, 'HH24:MI'),
        'breakMinutes', settings.break_minutes,
        'standardDayMinutes', settings.standard_day_minutes
      )
      from public.attendance_accounting_settings settings
      where settings.settings_key = 'default'
    ),
    jsonb_build_object(
      'configured', false,
      'effectiveFrom', null,
      'workWeekdays', jsonb_build_array(1, 2, 3, 4, 5, 6),
      'workStartTime', '08:00',
      'workEndTime', '17:00',
      'breakMinutes', 60,
      'standardDayMinutes', 480
    )
  );
$$;

revoke all on function private.attendance_accounting_settings_json()
  from public, anon, authenticated, service_role;

create or replace function private.attendance_fact_issue_codes(
  p_employee_profile_id uuid,
  p_work_date date,
  p_now_tokyo timestamp without time zone
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  settings public.attendance_accounting_settings%rowtype;
  schedule_required boolean;
  shift_start timestamp without time zone;
  shift_end timestamp without time zone;
  first_clock_in timestamp without time zone;
  last_clock_out timestamp without time zone;
  reference_end timestamp without time zone;
  has_open_session boolean;
  has_abnormal_location boolean;
  issue_codes text[] := array[]::text[];
begin
  if p_employee_profile_id is null
    or p_work_date is null
    or not isfinite(p_work_date)
    or p_now_tokyo is null
    or not isfinite(p_now_tokyo)
  then
    raise exception using
      errcode = '22023',
      message = 'valid attendance classification inputs required';
  end if;

  select setting.*
    into settings
    from public.attendance_accounting_settings setting
    where setting.settings_key = 'default';

  if not found or p_work_date < settings.effective_from then
    return issue_codes;
  end if;

  schedule_required :=
    extract(isodow from p_work_date)::smallint = any(settings.work_weekdays);
  shift_start := p_work_date + settings.work_start_time;
  shift_end := p_work_date + settings.work_end_time;

  select
    min(coalesce(
      clock_in.server_recorded_at,
      attendance_session.opened_at
    ) at time zone 'Asia/Tokyo'),
    max(coalesce(
      clock_out.server_recorded_at,
      attendance_session.closed_at
    ) at time zone 'Asia/Tokyo'),
    coalesce(bool_or(attendance_session.status = 'open'), false),
    coalesce(bool_or(
      clock_in.result = 'abnormal' or clock_out.result = 'abnormal'
    ), false)
    into
      first_clock_in,
      last_clock_out,
      has_open_session,
      has_abnormal_location
    from public.project_attendance_sessions attendance_session
    left join public.project_attendance_events clock_in
      on clock_in.session_id = attendance_session.session_id
      and clock_in.event_type = 'clock_in'
    left join public.project_attendance_events clock_out
      on clock_out.session_id = attendance_session.session_id
      and clock_out.event_type = 'clock_out'
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date;

  if first_clock_in is null then
    if schedule_required and p_now_tokyo > shift_start then
      issue_codes := array_append(issue_codes, 'missing_clock_in');
    end if;
    return issue_codes;
  end if;

  if has_abnormal_location then
    issue_codes := array_append(issue_codes, 'abnormal_location');
  end if;
  if has_open_session and p_now_tokyo > shift_end then
    issue_codes := array_append(issue_codes, 'missing_clock_out');
  end if;
  if schedule_required and first_clock_in > shift_start then
    issue_codes := array_append(issue_codes, 'late');
  end if;
  if schedule_required
    and not has_open_session
    and last_clock_out is not null
    and last_clock_out < shift_end
  then
    issue_codes := array_append(issue_codes, 'early');
  end if;

  reference_end := case
    when has_open_session then p_now_tokyo
    else last_clock_out
  end;
  if reference_end is not null
    and reference_end >= first_clock_in
    and extract(epoch from (reference_end - first_clock_in)) / 60
      - settings.break_minutes > settings.standard_day_minutes
  then
    issue_codes := array_append(issue_codes, 'overtime_pending');
  end if;

  return issue_codes;
end;
$$;

revoke all on function private.attendance_fact_issue_codes(
  uuid, date, timestamp without time zone
) from public, anon, authenticated, service_role;

create or replace function private.attendance_issue_codes(
  p_employee_profile_id uuid,
  p_work_date date,
  p_now_tokyo timestamp without time zone
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date = p_work_date
      and resolution.accounting_status in ('confirmed', 'month_locked')
  ) then
    return array[]::text[];
  end if;
  return private.attendance_fact_issue_codes(
    p_employee_profile_id, p_work_date, p_now_tokyo
  );
end;
$$;

revoke all on function private.attendance_issue_codes(
  uuid, date, timestamp without time zone
) from public, anon, authenticated, service_role;

create or replace function private.attendance_dashboard_employee_json(
  p_employee_profile_id uuid,
  p_work_date date,
  p_can_view_salary boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
  settings public.attendance_accounting_settings%rowtype;
  configured boolean := false;
  schedule_required boolean := false;
  now_tokyo timestamp without time zone :=
    statement_timestamp() at time zone 'Asia/Tokyo';
  issue_codes text[];
  first_clock_in timestamptz;
  last_clock_out timestamptz;
  reference_end timestamptz;
  has_open_session boolean;
  has_abnormal_location boolean;
  worked_minutes_reference integer;
  sessions jsonb;
  resolution jsonb;
  resolution_type text;
  accounting_status text;
  resolution_schedule_required boolean;
  resolution_worked_minutes_reference integer;
  day_status text;
  salary jsonb;
  result jsonb;
begin
  if p_employee_profile_id is null
    or p_work_date is null
    or not isfinite(p_work_date)
  then
    raise exception using errcode = '22023', message = 'valid dashboard employee required';
  end if;

  select profile.*
    into employee
    from public.employee_profiles profile
    where profile.id = p_employee_profile_id
      and not profile.is_hidden_system_account
      and profile.employee_number <> 'SW-000'
      and (
        profile.deleted_at is null
        or exists (
          select 1
          from public.attendance_day_resolutions historical_resolution
          where historical_resolution.employee_profile_id = profile.id
            and historical_resolution.work_date = p_work_date
            and historical_resolution.accounting_status in (
              'confirmed', 'month_locked'
            )
        )
      );
  if not found then
    return null;
  end if;

  select setting.*
    into settings
    from public.attendance_accounting_settings setting
    where setting.settings_key = 'default';
  configured := found;
  if configured and p_work_date >= settings.effective_from then
    schedule_required :=
      extract(isodow from p_work_date)::smallint = any(settings.work_weekdays);
  end if;

  issue_codes := private.attendance_issue_codes(
    p_employee_profile_id,
    p_work_date,
    now_tokyo
  );

  select
    min(coalesce(
      clock_in.server_recorded_at,
      attendance_session.opened_at
    )),
    max(coalesce(
      clock_out.server_recorded_at,
      attendance_session.closed_at
    )),
    coalesce(bool_or(attendance_session.status = 'open'), false),
    coalesce(bool_or(
      clock_in.result = 'abnormal' or clock_out.result = 'abnormal'
    ), false)
    into
      first_clock_in,
      last_clock_out,
      has_open_session,
      has_abnormal_location
    from public.project_attendance_sessions attendance_session
    left join public.project_attendance_events clock_in
      on clock_in.session_id = attendance_session.session_id
      and clock_in.event_type = 'clock_in'
    left join public.project_attendance_events clock_out
      on clock_out.session_id = attendance_session.session_id
      and clock_out.event_type = 'clock_out'
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sessionId', attendance_session.session_id,
          'projectId', attendance_session.project_id,
          'projectName', attendance_session.project_name_snapshot,
          'status', attendance_session.status,
          'openedAt', attendance_session.opened_at,
          'closedAt', attendance_session.closed_at,
          'clockInEvent', case
            when clock_in.event_id is null then null
            else jsonb_build_object(
              'eventId', clock_in.event_id,
              'eventType', clock_in.event_type,
              'serverRecordedAt', clock_in.server_recorded_at,
              'result', clock_in.result,
              'abnormalReason', clock_in.abnormal_reason
            )
          end,
          'clockOutEvent', case
            when clock_out.event_id is null then null
            else jsonb_build_object(
              'eventId', clock_out.event_id,
              'eventType', clock_out.event_type,
              'serverRecordedAt', clock_out.server_recorded_at,
              'result', clock_out.result,
              'abnormalReason', clock_out.abnormal_reason
            )
          end
        )
        order by coalesce(
          clock_in.server_recorded_at,
          attendance_session.opened_at
        ), attendance_session.session_id
      ),
      '[]'::jsonb
    )
    into sessions
    from public.project_attendance_sessions attendance_session
    left join public.project_attendance_events clock_in
      on clock_in.session_id = attendance_session.session_id
      and clock_in.event_type = 'clock_in'
    left join public.project_attendance_events clock_out
      on clock_out.session_id = attendance_session.session_id
      and clock_out.event_type = 'clock_out'
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date;

  select
    jsonb_build_object(
      'resolutionId', day_resolution.resolution_id,
      'resolutionType', day_resolution.resolution_type,
      'attendanceUnits', day_resolution.attendance_units,
      'accountingStatus', day_resolution.accounting_status,
      'scheduleRequired', day_resolution.schedule_required,
      'resolutionNote', day_resolution.resolution_note,
      'confirmedAt', day_resolution.confirmed_at,
      'version', day_resolution.version
    ),
    day_resolution.resolution_type,
    day_resolution.accounting_status,
    day_resolution.schedule_required,
    day_resolution.worked_minutes_reference_snapshot
    into resolution, resolution_type, accounting_status,
      resolution_schedule_required, resolution_worked_minutes_reference
    from public.attendance_day_resolutions day_resolution
    where day_resolution.employee_profile_id = p_employee_profile_id
      and day_resolution.work_date = p_work_date;

  if accounting_status in ('confirmed', 'month_locked') then
    schedule_required := resolution_schedule_required;
  end if;

  if first_clock_in is not null then
    reference_end := case
      when has_open_session then statement_timestamp()
      else last_clock_out
    end;
    if reference_end is not null and reference_end >= first_clock_in then
      worked_minutes_reference := greatest(
        0,
        floor(
          extract(epoch from (reference_end - first_clock_in)) / 60
          - case when configured then settings.break_minutes else 60 end
        )::integer
      );
    end if;
  end if;
  if accounting_status in ('confirmed', 'month_locked') then
    worked_minutes_reference := resolution_worked_minutes_reference;
  end if;

  if not configured then
    day_status := 'unconfigured';
  elsif p_work_date < settings.effective_from then
    day_status := 'before_activation';
  elsif accounting_status in ('confirmed', 'month_locked')
    and resolution_type in (
      'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'
    )
  then
    day_status := resolution_type;
  elsif first_clock_in is null and not schedule_required then
    day_status := 'optional_not_worked';
  elsif first_clock_in is null
    and issue_codes @> array['missing_clock_in']::text[]
  then
    day_status := 'missing_clock_in';
  elsif first_clock_in is null then
    day_status := 'not_started';
  elsif has_open_session then
    day_status := 'working';
  else
    day_status := 'completed';
  end if;

  result := jsonb_build_object(
    'employeeProfileId', employee.id,
    'employeeNumber', employee.employee_number,
    'name', employee.name,
    'department', employee.department,
    'position', employee.position,
    'scheduleRequired', schedule_required,
    'dayStatus', day_status,
    'issueCodes', issue_codes,
    'firstClockInAt', first_clock_in,
    'lastClockOutAt', last_clock_out,
    'hasOpenSession', has_open_session,
    'hasAbnormalLocation', has_abnormal_location,
    'workedMinutesReference', worked_minutes_reference,
    'sessions', sessions,
    'resolution', resolution
  );

  if coalesce(p_can_view_salary, false) then
    salary := private.attendance_salary_json(employee.id, 0);
    result := result || jsonb_build_object(
      'salary', jsonb_build_object(
        'salaryType', salary->>'salaryType',
        'baseSalary', salary->'baseSalary',
        'dailySalary', salary->'dailySalary',
        'hourlyWage', salary->'hourlyWage',
        'salaryRemark', employee.salary_remark
      )
    );
  end if;

  return result;
end;
$$;

revoke all on function private.attendance_dashboard_employee_json(
  uuid, date, boolean
) from public, anon, authenticated, service_role;

create or replace function public.list_daily_attendance_dashboard_secure(
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  now_tokyo timestamp without time zone;
  can_resolve boolean;
  can_view_salary boolean;
  can_update_salary boolean;
  can_view_project_costs boolean;
  can_update_project_costs boolean;
  can_update_settings boolean;
  settings jsonb;
  permissions jsonb;
  employees jsonb;
  summary jsonb;
  filters jsonb;
begin
  actor := private.current_attendance_accountant();

  if p_work_date is null or not isfinite(p_work_date) then
    raise exception using errcode = '22023', message = 'valid work date required';
  end if;
  if not private.attendance_valid_business_date(p_work_date) then
    raise exception using
      errcode = '22023',
      message = 'work date must be between 1900-01-01 and 2100-12-31';
  end if;

  now_tokyo := statement_timestamp() at time zone 'Asia/Tokyo';
  can_resolve := public.has_current_permission('module.labor.update');
  can_view_salary := public.has_current_permission('sensitive.salary_view');
  can_update_salary := can_resolve
    and can_view_salary
    and public.has_current_permission('sensitive.salary_update');
  can_view_project_costs :=
    public.has_current_permission('module.project_costs.view');
  can_update_project_costs := can_resolve
    and can_view_salary
    and can_view_project_costs
    and public.has_current_permission('module.project_costs.update')
    and public.has_current_permission('sensitive.salary_update');
  can_update_settings :=
    public.has_current_permission('module.settings.update');

  settings := private.attendance_accounting_settings_json();
  permissions := jsonb_build_object(
    'canResolve', can_resolve,
    'canViewSalary', can_view_salary,
    'canUpdateSalary', can_update_salary,
    'canViewProjectCosts', can_view_project_costs,
    'canUpdateProjectCosts', can_update_project_costs,
    'canUpdateSettings', can_update_settings
  );

  select coalesce(
      jsonb_agg(
        private.attendance_dashboard_employee_json(
          employee.id,
          p_work_date,
          can_view_salary
        )
        order by employee.employee_number, employee.id
      ),
      '[]'::jsonb
    )
    into employees
    from public.employee_profiles employee
    where not employee.is_hidden_system_account
      and employee.employee_number <> 'SW-000'
      and (
        exists (
          select 1
          from public.attendance_day_resolutions historical_resolution
          where historical_resolution.employee_profile_id = employee.id
            and historical_resolution.work_date = p_work_date
            and historical_resolution.accounting_status in (
              'confirmed', 'month_locked'
            )
        )
        or (
          employee.deleted_at is null
          and (
            (
              employee.employment_status in ('在职', '休假', '停工')
              and (
                employee.hire_date is null
                or isfinite(employee.hire_date)
              )
              and (
                employee.resign_date is null
                or isfinite(employee.resign_date)
              )
            )
            or (
              employee.employment_status = '离职'
              and employee.hire_date is not null
              and isfinite(employee.hire_date)
              and employee.resign_date is not null
              and isfinite(employee.resign_date)
            )
          )
          and (
            employee.hire_date is null
            or employee.resign_date is null
            or employee.hire_date <= employee.resign_date
          )
          and (employee.hire_date is null or employee.hire_date <= p_work_date)
          and (employee.resign_date is null or employee.resign_date >= p_work_date)
        )
      );

  select jsonb_build_object(
      'totalEmployees', count(*),
      'requiredEmployees', count(*) filter (
        where (employee->>'scheduleRequired')::boolean
      ),
      'normalCompleted', count(*) filter (
        where employee->>'dayStatus' = 'completed'
          and jsonb_array_length(employee->'issueCodes') = 0
      ),
      'working', count(*) filter (
        where employee->>'dayStatus' = 'working'
      ),
      'excused', count(*) filter (
        where employee->>'dayStatus' in ('rest', 'leave', 'comp_time')
      ),
      'alertCount', count(*) filter (
        where jsonb_array_length(employee->'issueCodes') > 0
      ),
      'abnormalLocation', count(*) filter (
        where employee->'issueCodes' ? 'abnormal_location'
      ),
      'missingClockIn', count(*) filter (
        where employee->'issueCodes' ? 'missing_clock_in'
      ),
      'missingClockOut', count(*) filter (
        where employee->'issueCodes' ? 'missing_clock_out'
      ),
      'late', count(*) filter (
        where employee->'issueCodes' ? 'late'
      ),
      'early', count(*) filter (
        where employee->'issueCodes' ? 'early'
      ),
      'overtimePending', count(*) filter (
        where employee->'issueCodes' ? 'overtime_pending'
      )
    )
    into summary
    from jsonb_array_elements(employees) employee;

  filters := jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(option.department order by option.department)
      from (
        select distinct employee->>'department' department
        from jsonb_array_elements(employees) employee
      ) option
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'projectId', option.project_id,
          'projectName', option.project_name
        )
        order by option.project_name, option.project_id
      )
      from (
        select
          session->>'projectId' project_id,
          min(session->>'projectName') project_name
        from jsonb_array_elements(employees) employee
        cross join lateral jsonb_array_elements(employee->'sessions') session
        group by session->>'projectId'
      ) option
    ), '[]'::jsonb),
    'dayStatuses', coalesce((
      select jsonb_agg(option.day_status order by option.day_status)
      from (
        select distinct employee->>'dayStatus' day_status
        from jsonb_array_elements(employees) employee
      ) option
    ), '[]'::jsonb),
    'issueCodes', jsonb_build_array(
      'abnormal_location',
      'missing_clock_in',
      'missing_clock_out',
      'late',
      'early',
      'overtime_pending'
    )
  );

  return jsonb_build_object(
    'workDate', p_work_date,
    'serverNowTokyo',
      to_char(now_tokyo, 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+09:00',
    'settings', settings,
    'permissions', permissions,
    'summary', summary,
    'filters', filters,
    'employees', employees
  );
end;
$$;

revoke all on function public.list_daily_attendance_dashboard_secure(date)
  from public, anon, authenticated, service_role;
grant execute on function public.list_daily_attendance_dashboard_secure(date)
  to authenticated, service_role;

create or replace function public.get_labor_alert_count_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  dashboard jsonb;
begin
  dashboard := public.list_daily_attendance_dashboard_secure(
    (statement_timestamp() at time zone 'Asia/Tokyo')::date
  );
  return jsonb_build_object(
    'workDate', dashboard->'workDate',
    'count', (dashboard#>>'{summary,alertCount}')::integer,
    'refreshedAt', dashboard->'serverNowTokyo'
  );
end;
$$;

revoke all on function public.get_labor_alert_count_secure()
  from public, anon, authenticated, service_role;
grant execute on function public.get_labor_alert_count_secure()
  to authenticated, service_role;

-- Closed Task 4 domain helpers. Public callers never supply identity, salary,
-- project names, confirmation time, or other authoritative snapshots.

create or replace function private.attendance_valid_yen(p_value numeric)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    p_value not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and p_value between 0 and 9007199254740991
    and p_value = trunc(p_value),
    false
  );
$$;

revoke all on function private.attendance_valid_yen(numeric)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_trim_text(p_value text)
returns text
language sql
immutable
security definer
set search_path = pg_catalog, public
as $$
  select regexp_replace(
    p_value, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  );
$$;

revoke all on function private.attendance_trim_text(text)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_valid_business_date(p_value date)
returns boolean
language sql
immutable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    isfinite(p_value)
      and p_value between date '1900-01-01' and date '2100-12-31',
    false
  );
$$;

revoke all on function private.attendance_valid_business_date(date)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_today_tokyo()
returns date
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select (statement_timestamp() at time zone 'Asia/Tokyo')::date;
$$;

revoke all on function private.attendance_today_tokyo()
  from public, anon, authenticated, service_role;

create or replace function private.attendance_require_safe_aggregate(
  p_value numeric
)
returns numeric
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_value is null
      or p_value in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      or p_value < 0
      or p_value > 9007199254740991 then
    raise exception using
      errcode = '22003',
      message = 'attendance accounting aggregate exceeds safe integer range',
      hint = 'ATTENDANCE_ACCOUNTING_AGGREGATE_OVERFLOW';
  end if;
  return p_value;
end;
$$;

revoke all on function private.attendance_require_safe_aggregate(numeric)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_parse_iso_date(p_value text)
returns date
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  parsed date;
begin
  if p_value is null or p_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    return null;
  end if;
  begin
    parsed := p_value::date;
  exception
    when invalid_datetime_format or datetime_field_overflow then
      return null;
  end;
  if not isfinite(parsed) or to_char(parsed, 'YYYY-MM-DD') <> p_value then
    return null;
  end if;
  return parsed;
end;
$$;

revoke all on function private.attendance_parse_iso_date(text)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_legacy_yen(
  p_payload jsonb,
  p_key text
)
returns numeric
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  raw_value text;
  parsed numeric;
begin
  if jsonb_typeof(p_payload) <> 'object'
      or p_key is null
      or not (p_payload ? p_key)
      or jsonb_typeof(p_payload->p_key) not in ('number', 'string') then
    return null;
  end if;
  raw_value := btrim(p_payload->>p_key);
  if char_length(raw_value) > 16 or raw_value !~ '^[0-9]+$' then
    return null;
  end if;
  begin
    parsed := raw_value::numeric;
  exception when others then
    return null;
  end;
  if not private.attendance_valid_yen(parsed) then
    return null;
  end if;
  return parsed;
end;
$$;

revoke all on function private.attendance_legacy_yen(jsonb, text)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_legacy_salary_amount(
  p_payload jsonb
)
returns numeric
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  base_amount numeric;
  overtime_amount numeric;
  bonus_amount numeric;
  deduction_amount numeric;
  result_amount numeric;
begin
  if jsonb_typeof(p_payload) <> 'object'
      or not (p_payload ?& array[
        'baseSalary', 'overtimePay', 'bonus', 'deduction'
      ]) then
    return null;
  end if;
  base_amount := private.attendance_legacy_yen(p_payload, 'baseSalary');
  overtime_amount := private.attendance_legacy_yen(p_payload, 'overtimePay');
  bonus_amount := private.attendance_legacy_yen(p_payload, 'bonus');
  deduction_amount := private.attendance_legacy_yen(p_payload, 'deduction');
  if base_amount is null or overtime_amount is null
      or bonus_amount is null or deduction_amount is null then
    return null;
  end if;
  result_amount := base_amount + overtime_amount + bonus_amount - deduction_amount;
  if not private.attendance_valid_yen(result_amount) then
    return null;
  end if;
  return result_amount;
end;
$$;

revoke all on function private.attendance_legacy_salary_amount(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_legacy_salary_json(
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  salary_month text;
  employee_number text;
  employee_name text;
  base_amount numeric;
  overtime_amount numeric;
  bonus_amount numeric;
  deduction_amount numeric;
  net_amount numeric;
begin
  if jsonb_typeof(p_payload) <> 'object'
      or jsonb_typeof(p_payload->'salaryMonth') <> 'string'
      or jsonb_typeof(p_payload->'employeeId') <> 'string'
      or jsonb_typeof(p_payload->'employeeName') <> 'string' then
    return null;
  end if;
  salary_month := private.attendance_trim_text(p_payload->>'salaryMonth');
  employee_number := private.attendance_trim_text(p_payload->>'employeeId');
  employee_name := private.attendance_trim_text(p_payload->>'employeeName');
  if salary_month !~ '^[0-9]{4}-[0-9]{2}$'
      or private.attendance_parse_iso_date(salary_month || '-01') is null
      or not private.attendance_valid_business_date(
        private.attendance_parse_iso_date(salary_month || '-01')
      )
      or employee_number = '' or char_length(employee_number) > 500
      or employee_name = '' or char_length(employee_name) > 500 then
    return null;
  end if;
  base_amount := private.attendance_legacy_yen(p_payload, 'baseSalary');
  overtime_amount := private.attendance_legacy_yen(p_payload, 'overtimePay');
  bonus_amount := private.attendance_legacy_yen(p_payload, 'bonus');
  deduction_amount := private.attendance_legacy_yen(p_payload, 'deduction');
  net_amount := private.attendance_legacy_salary_amount(p_payload);
  if base_amount is null or overtime_amount is null or bonus_amount is null
      or deduction_amount is null or net_amount is null then
    return null;
  end if;
  return jsonb_build_object(
    'salaryMonth', salary_month,
    'employeeNumber', employee_number,
    'employeeName', employee_name,
    'baseSalary', base_amount,
    'overtimePay', overtime_amount,
    'bonus', bonus_amount,
    'deduction', deduction_amount,
    'netSalary', net_amount
  );
end;
$$;

revoke all on function private.attendance_legacy_salary_json(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_legacy_labor_json(
  p_payload jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path = pg_catalog, public
as $$
declare
  raw_date text;
  work_day date;
  project_key text;
  project_label text;
  employee_key text;
  employee_label text;
  labor_amount numeric;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return null;
  end if;
  raw_date := nullif(
    private.attendance_trim_text(p_payload->>'workDate'), ''
  );
  if raw_date is null then
    raw_date := nullif(
      private.attendance_trim_text(p_payload->>'date'), ''
    );
  end if;
  work_day := private.attendance_parse_iso_date(raw_date);
  labor_amount := private.attendance_legacy_yen(p_payload, 'laborCost');
  if jsonb_typeof(p_payload->'projectId') <> 'string' then
    return null;
  end if;
  project_key := private.attendance_trim_text(p_payload->>'projectId');
  if project_key = '' or char_length(project_key) > 500
      or work_day is null
      or not private.attendance_valid_business_date(work_day)
      or labor_amount is null then
    return null;
  end if;
  project_label := case
    when jsonb_typeof(p_payload->'projectName') = 'string'
      then nullif(
        private.attendance_trim_text(p_payload->>'projectName'), ''
      )
    else null
  end;
  project_label := coalesce(project_label, project_key);
  employee_key := case
    when jsonb_typeof(p_payload->'employeeId') = 'string'
      then coalesce(nullif(
        private.attendance_trim_text(p_payload->>'employeeId'), ''
      ), '')
    else ''
  end;
  employee_label := case
    when jsonb_typeof(p_payload->'employeeName') = 'string'
      then coalesce(nullif(
        private.attendance_trim_text(p_payload->>'employeeName'), ''
      ), '')
    when jsonb_typeof(p_payload->'workerName') = 'string'
      then coalesce(nullif(
        private.attendance_trim_text(p_payload->>'workerName'), ''
      ), '')
    else ''
  end;
  if char_length(project_label) > 500
      or char_length(employee_key) > 500
      or char_length(employee_label) > 500 then
    return null;
  end if;
  return jsonb_build_object(
    'workDate', work_day,
    'projectId', project_key,
    'projectName', project_label,
    'employeeId', employee_key,
    'employeeName', employee_label,
    'amount', labor_amount
  );
end;
$$;

revoke all on function private.attendance_legacy_labor_json(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_employee_is_eligible(
  p_employee_profile_id uuid,
  p_work_date date
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(exists (
    select 1
    from public.employee_profiles employee
    join public.attendance_accounting_settings settings
      on settings.settings_key = 'default'
    where employee.id = p_employee_profile_id
      and private.attendance_valid_business_date(p_work_date)
      and p_work_date >= settings.effective_from
      and employee.deleted_at is null
      and not employee.is_hidden_system_account
      and employee.employee_number <> 'SW-000'
      and (
        (
          employee.employment_status in ('在职', '休假', '停工')
          and (employee.hire_date is null or isfinite(employee.hire_date))
          and (employee.resign_date is null or isfinite(employee.resign_date))
        )
        or (
          employee.employment_status = '离职'
          and employee.hire_date is not null and isfinite(employee.hire_date)
          and employee.resign_date is not null and isfinite(employee.resign_date)
        )
      )
      and (
        employee.hire_date is null or employee.resign_date is null
        or employee.hire_date <= employee.resign_date
      )
      and (employee.hire_date is null or employee.hire_date <= p_work_date)
      and (employee.resign_date is null or employee.resign_date >= p_work_date)
  ), false);
$$;

revoke all on function private.attendance_employee_is_eligible(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_schedule_required(p_work_date date)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    extract(isodow from p_work_date)::smallint = any(settings.work_weekdays),
    false
  )
  from public.attendance_accounting_settings settings
  where settings.settings_key = 'default';
$$;

revoke all on function private.attendance_schedule_required(date)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_salary_json(
  p_employee_profile_id uuid,
  p_attendance_units numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
  salary_type text := '未设置';
  valid_salary boolean := false;
  full_day_cost numeric := 0;
  suggested_cost numeric := 0;
  populated integer;
begin
  select profile.* into employee
  from public.employee_profiles profile
  where profile.id = p_employee_profile_id;
  if not found then
    return jsonb_build_object(
      'salaryType', '未设置', 'valid', false,
      'baseSalary', null, 'dailySalary', null, 'hourlyWage', null,
      'suggestedProjectCost', 0
    );
  end if;

  populated := (employee.base_salary is not null)::integer
    + (employee.daily_salary is not null)::integer
    + (employee.hourly_wage is not null)::integer;
  if populated = 1 and employee.base_salary is not null
      and private.attendance_valid_yen(employee.base_salary) then
    salary_type := '月薪';
    valid_salary := true;
    full_day_cost := round(employee.base_salary / 24);
  elsif populated = 1 and employee.daily_salary is not null
      and private.attendance_valid_yen(employee.daily_salary) then
    salary_type := '日薪';
    valid_salary := true;
    full_day_cost := round(employee.daily_salary);
  elsif populated = 1 and employee.hourly_wage is not null
      and private.attendance_valid_yen(employee.hourly_wage)
      and private.attendance_valid_yen(employee.hourly_wage * 8) then
    salary_type := '时薪';
    valid_salary := true;
    full_day_cost := round(employee.hourly_wage * 8);
  end if;

  if p_attendance_units = 1 then
    suggested_cost := full_day_cost;
  elsif p_attendance_units = 0.5 then
    suggested_cost := round(full_day_cost / 2);
  elsif p_attendance_units = 0 then
    suggested_cost := 0;
  else
    valid_salary := false;
    suggested_cost := 0;
  end if;
  if not private.attendance_valid_yen(suggested_cost) then
    valid_salary := false;
    suggested_cost := 0;
  end if;

  return jsonb_build_object(
    'salaryType', salary_type,
    'valid', valid_salary,
    'baseSalary', case when salary_type = '月薪' then employee.base_salary else null end,
    'dailySalary', case when salary_type = '日薪' then employee.daily_salary else null end,
    'hourlyWage', case when salary_type = '时薪' then employee.hourly_wage else null end,
    'suggestedProjectCost', suggested_cost
  );
end;
$$;

revoke all on function private.attendance_salary_json(uuid, numeric)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_resolution_snapshot(
  p_resolution_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'resolutionId', resolution.resolution_id,
    'employeeProfileId', resolution.employee_profile_id,
    'workDate', resolution.work_date,
    'scheduleRequired', resolution.schedule_required,
    'resolutionType', resolution.resolution_type,
    'attendanceUnits', resolution.attendance_units,
    'accountingStatus', resolution.accounting_status,
    'salaryTypeSnapshot', resolution.salary_type_snapshot,
    'baseSalarySnapshot', resolution.base_salary_snapshot,
    'dailySalarySnapshot', resolution.daily_salary_snapshot,
    'hourlyWageSnapshot', resolution.hourly_wage_snapshot,
    'suggestedProjectCost', resolution.suggested_project_cost,
    'finalProjectCost', resolution.final_project_cost,
    'issueCodesSnapshot', to_jsonb(resolution.issue_codes_snapshot),
    'workedMinutesReferenceSnapshot',
      resolution.worked_minutes_reference_snapshot,
    'resolutionNote', resolution.resolution_note,
    'confirmedByEmployeeProfileId', resolution.confirmed_by_employee_profile_id,
    'confirmedAt', resolution.confirmed_at,
    'version', resolution.version,
    'allocations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectId', allocation.project_id,
        'projectName', allocation.project_name_snapshot,
        'amount', allocation.amount,
        'allocationNote', allocation.allocation_note
      ) order by allocation.project_id)
      from public.attendance_project_allocations allocation
      where allocation.resolution_id = resolution.resolution_id
    ), '[]'::jsonb)
  )
  from public.attendance_day_resolutions resolution
  where resolution.resolution_id = p_resolution_id;
$$;

revoke all on function private.attendance_resolution_snapshot(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_payroll_snapshot(p_payroll_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'payrollId', payroll.payroll_id,
    'employeeProfileId', payroll.employee_profile_id,
    'salaryMonth', payroll.salary_month,
    'salaryTypeSnapshot', payroll.salary_type_snapshot,
    'baseSalarySnapshot', payroll.base_salary_snapshot,
    'fullDays', payroll.full_days,
    'halfDays', payroll.half_days,
    'absenceDays', payroll.absence_days,
    'scheduledAttendanceUnits', payroll.scheduled_attendance_units,
    'basePay', payroll.base_pay,
    'overtimePay', payroll.overtime_pay,
    'bonus', payroll.bonus,
    'deduction', payroll.deduction,
    'netSalary', payroll.net_salary,
    'status', payroll.status,
    'confirmationNote', payroll.confirmation_note,
    'confirmedByEmployeeProfileId', payroll.confirmed_by_employee_profile_id,
    'confirmedAt', payroll.confirmed_at,
    'version', payroll.version
  )
  from public.attendance_monthly_payrolls payroll
  where payroll.payroll_id = p_payroll_id;
$$;

revoke all on function private.attendance_payroll_snapshot(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_resolution_result(
  p_employee_profile_id uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
  day_resolution public.attendance_day_resolutions%rowtype;
  dashboard_employee jsonb;
  salary jsonb;
  resolution_result jsonb;
  allocations_result jsonb;
  available_projects_result jsonb := '[]'::jsonb;
  can_view_salary boolean;
  can_view_project_costs boolean;
  can_view_project_money boolean;
begin
  select profile.* into strict employee
  from public.employee_profiles profile
  where profile.id = p_employee_profile_id;
  select resolution.* into day_resolution
  from public.attendance_day_resolutions resolution
  where resolution.employee_profile_id = p_employee_profile_id
    and resolution.work_date = p_work_date;

  can_view_salary := public.has_current_permission('sensitive.salary_view');
  can_view_project_costs :=
    public.has_current_permission('module.project_costs.view');
  can_view_project_money := can_view_salary and can_view_project_costs;
  dashboard_employee := private.attendance_dashboard_employee_json(
    p_employee_profile_id, p_work_date, false
  );
  salary := private.attendance_salary_json(
    p_employee_profile_id,
    coalesce(day_resolution.attendance_units, 1)
  );
  if can_view_salary then
    salary := salary - 'valid' || jsonb_build_object(
      'suggestedProjectCost', case
        when can_view_project_costs then salary->'suggestedProjectCost'
        else 'null'::jsonb
      end
    );
  else
    salary := null;
  end if;

  if day_resolution.resolution_id is null then
    resolution_result := null;
    allocations_result := '[]'::jsonb;
  else
    resolution_result := jsonb_build_object(
      'resolutionId', day_resolution.resolution_id,
      'resolutionType', day_resolution.resolution_type,
      'attendanceUnits', day_resolution.attendance_units,
      'accountingStatus', day_resolution.accounting_status,
      'scheduleRequired', day_resolution.schedule_required,
      'resolutionNote', day_resolution.resolution_note,
      'confirmedAt', day_resolution.confirmed_at,
      'version', day_resolution.version
    );
    if can_view_salary then
      resolution_result := resolution_result || jsonb_build_object(
        'salaryTypeSnapshot', day_resolution.salary_type_snapshot,
        'baseSalarySnapshot', day_resolution.base_salary_snapshot,
        'dailySalarySnapshot', day_resolution.daily_salary_snapshot,
        'hourlyWageSnapshot', day_resolution.hourly_wage_snapshot,
        'suggestedProjectCost', case
          when can_view_project_costs then day_resolution.suggested_project_cost
          else null
        end,
        'finalProjectCost', case
          when can_view_project_costs then day_resolution.final_project_cost
          else null
        end
      );
    end if;
    select coalesce(jsonb_agg(
        case
          when can_view_project_money then jsonb_build_object(
            'allocationId', allocation.allocation_id,
            'projectId', allocation.project_id,
            'projectName', allocation.project_name_snapshot,
            'amount', allocation.amount,
            'allocationNote', allocation.allocation_note
          )
          else jsonb_build_object(
            'allocationId', allocation.allocation_id,
            'projectId', allocation.project_id,
            'projectName', allocation.project_name_snapshot,
            'allocationNote', allocation.allocation_note
          )
        end
        order by allocation.project_id
      ), '[]'::jsonb)
      into allocations_result
      from public.attendance_project_allocations allocation
      where allocation.resolution_id = day_resolution.resolution_id;
  end if;

  if can_view_project_costs then
    select coalesce(jsonb_agg(jsonb_build_object(
        'projectId', project.record_key,
        'projectName', project.project_name
      ) order by project.project_name, project.record_key), '[]'::jsonb)
      into available_projects_result
      from (
        select record.record_key, btrim(record.payload->>'projectName') project_name
        from public.projects record
        where record.status = 'active'
          and record.record_key = btrim(record.record_key, E' \t\n\r\f\013')
          and char_length(record.record_key) between 1 and 500
          and record.record_key not in ('__proto__', 'constructor', 'prototype')
          and jsonb_typeof(record.payload->'projectName') = 'string'
          and nullif(btrim(record.payload->>'projectName'), '') is not null
          and char_length(btrim(record.payload->>'projectName')) <= 500
        order by btrim(record.payload->>'projectName'), record.record_key
        limit 10000
      ) project;
  end if;

  return jsonb_build_object(
    'employee', jsonb_build_object(
      'employeeProfileId', employee.id,
      'employeeNumber', employee.employee_number,
      'employeeName', employee.name,
      'department', employee.department,
      'position', employee.position
    ),
    'workDate', p_work_date,
    'scheduleRequired', case
      when day_resolution.accounting_status in ('confirmed', 'month_locked')
        then day_resolution.schedule_required
      else private.attendance_schedule_required(p_work_date)
    end,
    'facts', jsonb_build_object(
      'dayStatus', dashboard_employee->'dayStatus',
      'issueCodes', dashboard_employee->'issueCodes',
      'firstClockInAt', dashboard_employee->'firstClockInAt',
      'lastClockOutAt', dashboard_employee->'lastClockOutAt',
      'hasOpenSession', dashboard_employee->'hasOpenSession',
      'hasAbnormalLocation', dashboard_employee->'hasAbnormalLocation',
      'workedMinutesReference', dashboard_employee->'workedMinutesReference',
      'sessions', dashboard_employee->'sessions'
    ),
    'hasMoneyScope',
      coalesce(day_resolution.final_project_cost, 0) <> 0
      or exists (
        select 1 from public.attendance_project_allocations allocation
        where allocation.resolution_id = day_resolution.resolution_id
      ),
    'permissions', jsonb_build_object(
      'canResolve', public.has_current_permission('module.labor.update'),
      'canViewSalary', can_view_salary,
      'canViewProjectCosts', can_view_project_costs,
      'canUpdateProjectCosts',
        public.has_current_permission('module.labor.update')
        and can_view_salary
        and can_view_project_costs
        and public.has_current_permission('module.project_costs.update')
        and public.has_current_permission('sensitive.salary_update')
    ),
    'salary', salary,
    'resolution', resolution_result,
    'allocations', allocations_result,
    'availableProjects', available_projects_result
  );
end;
$$;

revoke all on function private.attendance_resolution_result(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function public.get_attendance_resolution_detail_secure(
  p_employee_profile_id uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_accountant();
  if p_work_date is null or not isfinite(p_work_date) then
    raise exception using errcode = '22023', message = 'valid work date required';
  end if;
  if not private.attendance_valid_business_date(p_work_date) then
    raise exception using
      errcode = '22023',
      message = 'work date must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_employee_profile_id is null or (
      not private.attendance_employee_is_eligible(
        p_employee_profile_id, p_work_date
      )
      and not exists (
        select 1
        from public.attendance_day_resolutions historical_resolution
        where historical_resolution.employee_profile_id = p_employee_profile_id
          and historical_resolution.work_date = p_work_date
          and historical_resolution.accounting_status in (
            'confirmed', 'month_locked'
          )
      )
    ) then
    raise exception using
      errcode = '22023',
      message = 'eligible employee and activated date required';
  end if;
  return private.attendance_resolution_result(
    p_employee_profile_id, p_work_date
  );
end;
$$;

revoke all on function public.get_attendance_resolution_detail_secure(uuid, date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_attendance_resolution_detail_secure(uuid, date)
  to authenticated, service_role;

create or replace function private.attendance_write_resolution(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_version integer,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  employee public.employee_profiles%rowtype;
  month_payroll public.attendance_monthly_payrolls%rowtype;
  existing_resolution public.attendance_day_resolutions%rowtype;
  saved_resolution public.attendance_day_resolutions%rowtype;
  allocation_item jsonb;
  normalized_allocations jsonb := '[]'::jsonb;
  enriched_allocations jsonb := '[]'::jsonb;
  existing_allocations jsonb := '[]'::jsonb;
  normalized_item jsonb;
  project_row public.projects%rowtype;
  project_id text;
  project_name text;
  allocation_note text;
  allocation_amount numeric;
  seen_projects text[] := array[]::text[];
  salary jsonb;
  before_snapshot jsonb;
  after_snapshot jsonb;
  computed_schedule_required boolean;
  computed_issue_codes text[];
  computed_worked_minutes_reference integer;
  normalized_note text;
  allocated_total numeric := 0;
  money_in_scope boolean;
  input_key_count integer;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('module.labor.update') then
    raise exception using
      errcode = '42501',
      message = 'attendance resolution update permission required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('attendance_accounting_settings', 0)
  );
  if p_work_date is null or not isfinite(p_work_date) then
    raise exception using errcode = '22023', message = 'valid work date required';
  end if;
  if not private.attendance_valid_business_date(p_work_date) then
    raise exception using
      errcode = '22023',
      message = 'work date must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_employee_profile_id is null then
    raise exception using errcode = '22023', message = 'eligible employee and activated date required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_employee_profile_id::text, 1)
  );
  if p_resolution_type is null or p_resolution_type not in (
      'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'
    ) or p_attendance_units is null
      or not (
        (p_resolution_type = 'full_day' and p_attendance_units = 1)
        or (p_resolution_type = 'half_day' and p_attendance_units = 0.5)
        or (p_resolution_type in ('rest', 'leave', 'comp_time', 'absence')
          and p_attendance_units = 0)
      ) then
    raise exception using
      errcode = '22023',
      message = 'resolution type and attendance units do not match';
  end if;
  if p_confirm
      and p_work_date > private.attendance_today_tokyo()
      and p_resolution_type not in ('rest', 'leave', 'comp_time') then
    raise exception using
      errcode = '22023',
      message = 'future attendance may only be excused in advance';
  end if;
  if not private.attendance_valid_yen(p_final_project_cost) then
    raise exception using
      errcode = '22023', message = 'valid integer yen project cost required';
  end if;
  if p_resolution_note is null
      or char_length(btrim(p_resolution_note)) > 2000 then
    raise exception using errcode = '22023', message = 'valid resolution note required';
  end if;
  normalized_note := btrim(p_resolution_note);
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array'
      or jsonb_array_length(p_allocations) > 100 then
    raise exception using errcode = '22023', message = 'invalid project allocations';
  end if;

  -- A guaranteed parent lock serializes both existing-row and first-insert paths.
  select profile.* into employee
  from public.employee_profiles profile
  where profile.id = p_employee_profile_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'eligible employee and activated date required';
  end if;

  select payroll.* into month_payroll
  from public.attendance_monthly_payrolls payroll
  where payroll.employee_profile_id = p_employee_profile_id
    and payroll.salary_month = date_trunc('month', p_work_date)::date
  for update;

  select resolution.* into existing_resolution
  from public.attendance_day_resolutions resolution
  where resolution.employee_profile_id = p_employee_profile_id
    and resolution.work_date = p_work_date
  for update;
  if existing_resolution.resolution_id is not null then
    perform 1
    from public.attendance_project_allocations allocation
    where allocation.resolution_id = existing_resolution.resolution_id
    order by allocation.project_id
    for update;
  end if;

  for allocation_item in
    select item
    from jsonb_array_elements(p_allocations) item
  loop
    if jsonb_typeof(allocation_item) <> 'object'
        or not (allocation_item ?& array[
          'projectId', 'amount', 'allocationNote'
        ]) then
      raise exception using errcode = '22023', message = 'invalid project allocations';
    end if;
    select count(*) into input_key_count
    from jsonb_object_keys(allocation_item);
    if input_key_count <> 3
        or jsonb_typeof(allocation_item->'projectId') <> 'string'
        or jsonb_typeof(allocation_item->'amount') <> 'number'
        or jsonb_typeof(allocation_item->'allocationNote') <> 'string' then
      raise exception using errcode = '22023', message = 'invalid project allocations';
    end if;
    project_id := btrim(allocation_item->>'projectId');
    allocation_note := btrim(allocation_item->>'allocationNote');
    begin
      allocation_amount := (allocation_item->>'amount')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'invalid project allocations';
    end;
    if project_id = '' or char_length(project_id) > 500
        or char_length(allocation_note) > 2000
        or not private.attendance_valid_yen(allocation_amount) then
      raise exception using errcode = '22023', message = 'invalid project allocations';
    end if;
    if project_id = any(seen_projects) then
      raise exception using errcode = '22023', message = 'duplicate project allocation';
    end if;
    seen_projects := array_append(seen_projects, project_id);
    allocated_total := allocated_total + allocation_amount;
    if not private.attendance_valid_yen(allocated_total) then
      raise exception using errcode = '22023', message = 'invalid project allocations';
    end if;
    normalized_allocations := normalized_allocations || jsonb_build_array(
      jsonb_build_object(
        'projectId', project_id,
        'amount', allocation_amount,
        'allocationNote', allocation_note
      )
    );
  end loop;
  select coalesce(jsonb_agg(item order by item->>'projectId'), '[]'::jsonb)
    into normalized_allocations
    from jsonb_array_elements(normalized_allocations) item;

  money_in_scope := p_final_project_cost <> 0
    or jsonb_array_length(normalized_allocations) > 0
    or coalesce(existing_resolution.final_project_cost, 0) <> 0
    or exists (
      select 1 from public.attendance_project_allocations allocation
      where allocation.resolution_id = existing_resolution.resolution_id
    );
  if money_in_scope and not (
      public.has_current_permission('module.project_costs.view')
      and public.has_current_permission('module.project_costs.update')
      and public.has_current_permission('sensitive.salary_view')
      and public.has_current_permission('sensitive.salary_update')
    ) then
    raise exception using
      errcode = '42501', message = 'project labor cost update permissions required';
  end if;

  if existing_resolution.resolution_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
        'projectId', allocation.project_id,
        'amount', allocation.amount,
        'allocationNote', allocation.allocation_note
      ) order by allocation.project_id), '[]'::jsonb)
      into existing_allocations
      from public.attendance_project_allocations allocation
      where allocation.resolution_id = existing_resolution.resolution_id;
    if p_confirm
        and existing_resolution.accounting_status in ('confirmed', 'month_locked')
        and existing_resolution.resolution_type = p_resolution_type
        and existing_resolution.attendance_units = p_attendance_units
        and existing_resolution.final_project_cost = p_final_project_cost
        and existing_resolution.resolution_note = normalized_note
        and existing_allocations = normalized_allocations then
      return private.attendance_resolution_result(
        p_employee_profile_id, p_work_date
      );
    end if;
  end if;

  if not private.attendance_employee_is_eligible(
      p_employee_profile_id, p_work_date
    ) then
    raise exception using errcode = '22023', message = 'eligible employee and activated date required';
  end if;
  if month_payroll.status = 'confirmed' then
    raise exception using
      errcode = '55000',
      message = 'monthly payroll locks this attendance resolution',
      hint = 'ATTENDANCE_ACCOUNTING_MONTH_LOCKED';
  end if;
  if existing_resolution.accounting_status = 'month_locked' then
    raise exception using
      errcode = '55000',
      message = 'monthly payroll locks this attendance resolution',
      hint = 'ATTENDANCE_ACCOUNTING_MONTH_LOCKED';
  end if;

  if existing_resolution.resolution_id is not null then
    if p_version is null or p_version <> existing_resolution.version then
      raise exception using
        errcode = '40001',
        message = 'attendance accounting version conflict',
        hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
    end if;
    before_snapshot := private.attendance_resolution_snapshot(
      existing_resolution.resolution_id
    );
  elsif p_version is null or p_version <> 0 then
    raise exception using
      errcode = '40001',
      message = 'attendance accounting version conflict',
      hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
  end if;

  -- Project locks are acquired in canonical ID order after the employee/day lock.
  for normalized_item in
    select item
    from jsonb_array_elements(normalized_allocations) item
    order by item->>'projectId'
  loop
    project_id := normalized_item->>'projectId';
    select project.* into project_row
    from public.projects project
    where project.record_key = project_id
    for share;
    if not found or project_row.status <> 'active'
        or jsonb_typeof(project_row.payload->'projectName') <> 'string'
        or nullif(btrim(project_row.payload->>'projectName'), '') is null
        or char_length(btrim(project_row.payload->>'projectName')) > 500 then
      raise exception using errcode = '22023', message = 'active project required';
    end if;
    project_name := btrim(project_row.payload->>'projectName');
    enriched_allocations := enriched_allocations || jsonb_build_array(
      normalized_item || jsonb_build_object('projectName', project_name)
    );
  end loop;

  salary := private.attendance_salary_json(
    p_employee_profile_id, p_attendance_units
  );
  if p_confirm
      and (
        p_attendance_units > 0
        or p_final_project_cost > 0
        or jsonb_array_length(normalized_allocations) > 0
      )
      and not (salary->>'valid')::boolean then
    raise exception using
      errcode = '55000',
      message = 'employee salary standard is required',
      hint = 'ATTENDANCE_ACCOUNTING_SALARY_REQUIRED';
  end if;
  if p_confirm and exists (
      select 1
      from public.project_attendance_sessions attendance_session
      where attendance_session.employee_profile_id = p_employee_profile_id
        and attendance_session.work_date = p_work_date
        and (
          attendance_session.status = 'open'
          or attendance_session.closed_at is null
        )
    ) then
    raise exception using
      errcode = '55000',
      message = 'attendance session is still open',
      hint = 'ATTENDANCE_ACCOUNTING_OPEN_SESSION';
  end if;
  if p_confirm and allocated_total <> p_final_project_cost then
    raise exception using
      errcode = '22023',
      message = 'project allocations do not balance',
      hint = 'ATTENDANCE_ACCOUNTING_ALLOCATION_UNBALANCED';
  end if;
  if p_confirm
      and existing_resolution.accounting_status in ('confirmed', 'month_locked') then
    computed_schedule_required := existing_resolution.schedule_required;
    computed_issue_codes := existing_resolution.issue_codes_snapshot;
    computed_worked_minutes_reference :=
      existing_resolution.worked_minutes_reference_snapshot;
  else
    computed_schedule_required := private.attendance_schedule_required(p_work_date);
    computed_issue_codes := private.attendance_fact_issue_codes(
      p_employee_profile_id,
      p_work_date,
      statement_timestamp() at time zone 'Asia/Tokyo'
    );
    computed_worked_minutes_reference := (
      private.attendance_dashboard_employee_json(
        p_employee_profile_id, p_work_date, false
      )->>'workedMinutesReference'
    )::integer;
  end if;

  if existing_resolution.resolution_id is null then
    insert into public.attendance_day_resolutions (
      employee_profile_id, work_date, schedule_required,
      resolution_type, attendance_units, accounting_status,
      salary_type_snapshot, base_salary_snapshot, daily_salary_snapshot,
      hourly_wage_snapshot, suggested_project_cost, final_project_cost,
      issue_codes_snapshot, worked_minutes_reference_snapshot, resolution_note,
      confirmed_by_employee_profile_id, confirmed_at, version
    ) values (
      p_employee_profile_id, p_work_date, computed_schedule_required,
      p_resolution_type, p_attendance_units,
      case when p_confirm then 'confirmed' else 'draft' end,
      salary->>'salaryType',
      (salary->>'baseSalary')::numeric,
      (salary->>'dailySalary')::numeric,
      (salary->>'hourlyWage')::numeric,
      (salary->>'suggestedProjectCost')::numeric,
      p_final_project_cost, computed_issue_codes,
      computed_worked_minutes_reference, normalized_note,
      case when p_confirm then actor.id else null end,
      case when p_confirm then statement_timestamp() else null end,
      1
    ) returning * into saved_resolution;
  else
    update public.attendance_day_resolutions resolution
    set schedule_required = computed_schedule_required,
        resolution_type = p_resolution_type,
        attendance_units = p_attendance_units,
        accounting_status = case when p_confirm then 'confirmed' else 'draft' end,
        salary_type_snapshot = salary->>'salaryType',
        base_salary_snapshot = (salary->>'baseSalary')::numeric,
        daily_salary_snapshot = (salary->>'dailySalary')::numeric,
        hourly_wage_snapshot = (salary->>'hourlyWage')::numeric,
        suggested_project_cost = (salary->>'suggestedProjectCost')::numeric,
        final_project_cost = p_final_project_cost,
        issue_codes_snapshot = computed_issue_codes,
        worked_minutes_reference_snapshot = computed_worked_minutes_reference,
        resolution_note = normalized_note,
        confirmed_by_employee_profile_id = case when p_confirm then actor.id else null end,
        confirmed_at = case when p_confirm then statement_timestamp() else null end,
        version = resolution.version + 1
    where resolution.resolution_id = existing_resolution.resolution_id
    returning resolution.* into saved_resolution;
  end if;

  delete from public.attendance_project_allocations allocation
  where allocation.resolution_id = saved_resolution.resolution_id;
  for normalized_item in
    select item
    from jsonb_array_elements(enriched_allocations) item
    order by item->>'projectId'
  loop
    insert into public.attendance_project_allocations (
      resolution_id, project_id, project_name_snapshot, amount, allocation_note
    ) values (
      saved_resolution.resolution_id,
      normalized_item->>'projectId',
      normalized_item->>'projectName',
      (normalized_item->>'amount')::numeric,
      normalized_item->>'allocationNote'
    );
  end loop;

  after_snapshot := private.attendance_resolution_snapshot(
    saved_resolution.resolution_id
  );
  insert into public.attendance_accounting_audit_log (
    object_type, object_id, action_type, actor_employee_profile_id,
    before_snapshot, after_snapshot, reason
  ) values (
    'attendance_resolution', saved_resolution.resolution_id::text,
    case when p_confirm then 'resolution_confirmed' else 'resolution_draft_saved' end,
    actor.id, before_snapshot, after_snapshot, normalized_note
  );

  return public.get_attendance_resolution_detail_secure(
    p_employee_profile_id, p_work_date
  );
end;
$$;

revoke all on function private.attendance_write_resolution(
  uuid, date, text, numeric, numeric, jsonb, text, integer, boolean
) from public, anon, authenticated, service_role;

create or replace function public.save_attendance_resolution_draft_secure(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_accountant();
  return private.attendance_write_resolution(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, p_version, false
  );
end;
$$;

revoke all on function public.save_attendance_resolution_draft_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_resolution_draft_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) to authenticated, service_role;

create or replace function public.confirm_attendance_resolution_secure(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_accountant();
  return private.attendance_write_resolution(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, p_version, true
  );
end;
$$;

revoke all on function public.confirm_attendance_resolution_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_attendance_resolution_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) to authenticated, service_role;

create or replace function private.attendance_month_counts(
  p_employee_profile_id uuid,
  p_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  full_days numeric := 0;
  half_days numeric := 0;
  absence_days numeric := 0;
  excused_days numeric := 0;
  scheduled_attendance_units integer := 0;
  confirmed_attendance_units numeric := 0;
  pending_days integer := 0;
  allocated_amount numeric := 0;
  final_cost numeric := 0;
  unallocated_amount numeric := 0;
  confirmed_payroll_scheduled_units integer;
begin
  select
    count(*) filter (where resolution.resolution_type = 'full_day'),
    count(*) filter (where resolution.resolution_type = 'half_day'),
    count(*) filter (where resolution.resolution_type = 'absence'),
    count(*) filter (
      where resolution.resolution_type in ('rest', 'leave', 'comp_time')
    ),
    coalesce(sum(resolution.attendance_units), 0)
    into full_days, half_days, absence_days, excused_days,
      confirmed_attendance_units
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date >= p_month
      and resolution.work_date < (p_month + interval '1 month')::date
      and resolution.accounting_status in ('confirmed', 'month_locked');

  select payroll.scheduled_attendance_units
    into confirmed_payroll_scheduled_units
    from public.attendance_monthly_payrolls payroll
    where payroll.employee_profile_id = p_employee_profile_id
      and payroll.salary_month = p_month
      and payroll.status = 'confirmed';
  if found then
    scheduled_attendance_units := confirmed_payroll_scheduled_units;
  else
    select count(*)::integer
      into scheduled_attendance_units
      from generate_series(
        p_month::timestamp,
        (p_month + interval '1 month - 1 day')::timestamp,
        interval '1 day'
      ) generated(day_value)
      where case
        when exists (
          select 1
          from public.attendance_day_resolutions resolution
          where resolution.employee_profile_id = p_employee_profile_id
            and resolution.work_date = generated.day_value::date
            and resolution.accounting_status in ('confirmed', 'month_locked')
        ) then coalesce((
          select resolution.schedule_required
          from public.attendance_day_resolutions resolution
          where resolution.employee_profile_id = p_employee_profile_id
            and resolution.work_date = generated.day_value::date
            and resolution.accounting_status in ('confirmed', 'month_locked')
        ), false)
        else private.attendance_employee_is_eligible(
            p_employee_profile_id, generated.day_value::date
          ) and private.attendance_schedule_required(generated.day_value::date)
      end;
  end if;

  select
      coalesce(sum(resolution.final_project_cost), 0),
      coalesce(sum(allocation_totals.amount), 0),
      coalesce(sum(greatest(
        resolution.final_project_cost - allocation_totals.amount, 0
      )), 0)
    into final_cost, allocated_amount, unallocated_amount
    from public.attendance_day_resolutions resolution
    cross join lateral (
      select coalesce(sum(allocation.amount), 0) amount
      from public.attendance_project_allocations allocation
      where allocation.resolution_id = resolution.resolution_id
    ) allocation_totals
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date >= p_month
      and resolution.work_date < (p_month + interval '1 month')::date
      and resolution.accounting_status in ('draft', 'confirmed', 'month_locked');

  if exists (
    select 1
    from public.attendance_monthly_payrolls payroll
    where payroll.employee_profile_id = p_employee_profile_id
      and payroll.salary_month = p_month
      and payroll.status = 'confirmed'
  ) then
    pending_days := 0;
  else
    select count(*)::integer into pending_days
    from generate_series(
        p_month::timestamp,
        (p_month + interval '1 month - 1 day')::timestamp,
        interval '1 day'
      ) generated(day_value)
    where private.attendance_employee_is_eligible(
        p_employee_profile_id, generated.day_value::date
      )
      and (
        private.attendance_schedule_required(generated.day_value::date)
        or exists (
          select 1
          from public.project_attendance_sessions attendance_session
          where attendance_session.employee_profile_id = p_employee_profile_id
            and attendance_session.work_date = generated.day_value::date
        )
        or exists (
          select 1
          from public.attendance_day_resolutions draft_resolution
          where draft_resolution.employee_profile_id = p_employee_profile_id
            and draft_resolution.work_date = generated.day_value::date
            and draft_resolution.accounting_status = 'draft'
        )
      )
      and not exists (
        select 1
        from public.attendance_day_resolutions resolution
        where resolution.employee_profile_id = p_employee_profile_id
          and resolution.work_date = generated.day_value::date
          and resolution.accounting_status in ('confirmed', 'month_locked')
      );
  end if;

  final_cost := private.attendance_require_safe_aggregate(final_cost);
  allocated_amount := private.attendance_require_safe_aggregate(
    allocated_amount
  );
  unallocated_amount := private.attendance_require_safe_aggregate(
    unallocated_amount
  );

  return jsonb_build_object(
    'fullDays', full_days,
    'halfDays', half_days,
    'absenceDays', absence_days,
    'excusedDays', excused_days,
    'scheduledAttendanceUnits', scheduled_attendance_units,
    'confirmedAttendanceUnits', confirmed_attendance_units,
    'pendingDays', pending_days,
    'projectAllocatedAmount', allocated_amount,
    'projectFinalCost', final_cost,
    'projectUnallocatedAmount', unallocated_amount
  );
end;
$$;

revoke all on function private.attendance_month_counts(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_payroll_preview(
  p_employee_profile_id uuid,
  p_month date,
  p_overtime_pay numeric,
  p_bonus numeric,
  p_deduction numeric
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  counts jsonb;
  salary jsonb;
  salary_type text;
  rate_snapshot numeric;
  base_pay numeric;
  net_salary numeric;
  full_days numeric;
  half_days numeric;
begin
  counts := private.attendance_month_counts(p_employee_profile_id, p_month);
  salary := private.attendance_salary_json(p_employee_profile_id, 1);
  salary_type := salary->>'salaryType';
  full_days := (counts->>'fullDays')::numeric;
  half_days := (counts->>'halfDays')::numeric;
  if salary_type = '月薪' then
    rate_snapshot := (salary->>'baseSalary')::numeric;
    base_pay := rate_snapshot;
  elsif salary_type = '日薪' then
    rate_snapshot := (salary->>'dailySalary')::numeric;
    base_pay := round((full_days + half_days * 0.5) * rate_snapshot);
  elsif salary_type = '时薪' then
    rate_snapshot := (salary->>'hourlyWage')::numeric;
    base_pay := round((full_days * 8 + half_days * 4) * rate_snapshot);
  else
    rate_snapshot := 0;
    base_pay := 0;
  end if;
  net_salary := base_pay + p_overtime_pay + p_bonus - p_deduction;
  return counts || jsonb_build_object(
    'salaryType', salary_type,
    'salaryValid', (salary->>'valid')::boolean,
    'baseSalarySnapshot', rate_snapshot,
    'basePay', base_pay,
    'overtimePay', p_overtime_pay,
    'bonus', p_bonus,
    'deduction', p_deduction,
    'netSalary', net_salary,
    'validMoney', private.attendance_valid_yen(base_pay)
      and private.attendance_valid_yen(net_salary)
  );
end;
$$;

revoke all on function private.attendance_payroll_preview(
  uuid, date, numeric, numeric, numeric
) from public, anon, authenticated, service_role;

create or replace function private.attendance_payroll_result(p_payroll_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'employee', jsonb_build_object(
      'employeeProfileId', employee.id,
      'employeeNumber', employee.employee_number,
      'employeeName', employee.name,
      'department', employee.department
    ),
    'payroll', jsonb_build_object(
      'payrollId', payroll.payroll_id,
      'salaryMonth', payroll.salary_month,
      'fullDays', payroll.full_days,
      'halfDays', payroll.half_days,
      'absenceDays', payroll.absence_days,
      'status', payroll.status,
      'confirmedAt', payroll.confirmed_at,
      'version', payroll.version
    ) || case
      when public.has_current_permission('sensitive.salary_view') then
        jsonb_build_object(
          'salaryTypeSnapshot', payroll.salary_type_snapshot,
          'baseSalarySnapshot', payroll.base_salary_snapshot,
          'basePay', payroll.base_pay,
          'overtimePay', payroll.overtime_pay,
          'bonus', payroll.bonus,
          'deduction', payroll.deduction,
          'netSalary', payroll.net_salary,
          'confirmationNote', payroll.confirmation_note
        )
      else '{}'::jsonb
    end
  )
  from public.attendance_monthly_payrolls payroll
  join public.employee_profiles employee
    on employee.id = payroll.employee_profile_id
  where payroll.payroll_id = p_payroll_id;
$$;

revoke all on function private.attendance_payroll_result(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.attendance_write_monthly_payroll(
  p_employee_profile_id uuid,
  p_month date,
  p_overtime_pay numeric,
  p_bonus numeric,
  p_deduction numeric,
  p_confirmation_note text,
  p_version integer,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  employee public.employee_profiles%rowtype;
  existing_payroll public.attendance_monthly_payrolls%rowtype;
  saved_payroll public.attendance_monthly_payrolls%rowtype;
  preview jsonb;
  before_snapshot jsonb;
  after_snapshot jsonb;
  normalized_note text;
  month_end date;
  is_exact_confirmation boolean := false;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('module.labor.update')
      or not public.has_current_permission('sensitive.salary_view')
      or not public.has_current_permission('sensitive.salary_update') then
    raise exception using
      errcode = '42501', message = 'monthly payroll update permissions required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('attendance_accounting_settings', 0)
  );
  if p_month is null or not isfinite(p_month) then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if not private.attendance_valid_business_date(p_month) then
    raise exception using
      errcode = '22023',
      message = 'salary month must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if p_employee_profile_id is null then
    raise exception using
      errcode = '22023',
      message = 'eligible employee and activated month required';
  end if;
  if not private.attendance_valid_yen(p_overtime_pay)
      or not private.attendance_valid_yen(p_bonus)
      or not private.attendance_valid_yen(p_deduction) then
    raise exception using
      errcode = '22023', message = 'valid integer yen payroll adjustments required';
  end if;
  if p_confirmation_note is null
      or char_length(btrim(p_confirmation_note)) > 2000 then
    raise exception using errcode = '22023', message = 'valid payroll note required';
  end if;
  normalized_note := btrim(p_confirmation_note);
  month_end := (p_month + interval '1 month - 1 day')::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_employee_profile_id::text, 1)
  );

  select profile.* into employee
  from public.employee_profiles profile
  where profile.id = p_employee_profile_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'eligible employee and activated month required';
  end if;

  select payroll.* into existing_payroll
  from public.attendance_monthly_payrolls payroll
  where payroll.employee_profile_id = p_employee_profile_id
    and payroll.salary_month = p_month
  for update;
  is_exact_confirmation := existing_payroll.payroll_id is not null
      and p_confirm
      and existing_payroll.status = 'confirmed'
      and existing_payroll.overtime_pay = p_overtime_pay
      and existing_payroll.bonus = p_bonus
      and existing_payroll.deduction = p_deduction
      and existing_payroll.confirmation_note = normalized_note;

  if is_exact_confirmation then
    return private.attendance_payroll_result(existing_payroll.payroll_id);
  end if;

  if employee.deleted_at is not null
      or employee.is_hidden_system_account
      or employee.employee_number = 'SW-000'
      or not exists (
        select 1
        from generate_series(
          p_month::timestamp, month_end::timestamp, interval '1 day'
        ) generated(day_value)
        where private.attendance_employee_is_eligible(
          p_employee_profile_id, generated.day_value::date
        )
      ) then
    raise exception using errcode = '22023', message = 'eligible employee and activated month required';
  end if;

  if existing_payroll.payroll_id is not null then
    if p_version is null or p_version <> existing_payroll.version then
      raise exception using
        errcode = '40001',
        message = 'attendance accounting version conflict',
        hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
    end if;
    if existing_payroll.status = 'confirmed' then
      raise exception using
        errcode = '55000',
        message = 'monthly payroll is already confirmed',
        hint = 'ATTENDANCE_ACCOUNTING_MONTH_LOCKED';
    end if;
    before_snapshot := private.attendance_payroll_snapshot(
      existing_payroll.payroll_id
    );
  elsif p_version is null or p_version <> 0 then
    raise exception using
      errcode = '40001',
      message = 'attendance accounting version conflict',
      hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
  end if;

  perform 1
  from public.attendance_day_resolutions resolution
  where resolution.employee_profile_id = p_employee_profile_id
    and resolution.work_date >= p_month
    and resolution.work_date < (p_month + interval '1 month')::date
  order by resolution.work_date, resolution.resolution_id
  for update;

  perform 1
  from public.project_attendance_sessions attendance_session
  where attendance_session.employee_profile_id = p_employee_profile_id
    and attendance_session.work_date >= p_month
    and attendance_session.work_date < (p_month + interval '1 month')::date
    and private.attendance_employee_is_eligible(
      p_employee_profile_id, attendance_session.work_date
    )
  order by attendance_session.work_date,
    attendance_session.opened_at,
    attendance_session.session_id
  for share;

  if p_confirm and exists (
    select 1
    from public.project_attendance_sessions attendance_session
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date >= p_month
      and attendance_session.work_date
        < (p_month + interval '1 month')::date
      and private.attendance_employee_is_eligible(
        p_employee_profile_id, attendance_session.work_date
      )
      and (
        attendance_session.status = 'open'
        or attendance_session.closed_at is null
      )
  ) then
    raise exception using
      errcode = '55000',
      message = 'attendance session is still open',
      hint = 'ATTENDANCE_ACCOUNTING_OPEN_SESSION';
  end if;

  preview := private.attendance_payroll_preview(
    p_employee_profile_id, p_month, p_overtime_pay, p_bonus, p_deduction
  );
  if p_confirm and not (preview->>'salaryValid')::boolean then
    raise exception using
      errcode = '55000',
      message = 'employee salary standard is required',
      hint = 'ATTENDANCE_ACCOUNTING_SALARY_REQUIRED';
  end if;
  if not (preview->>'validMoney')::boolean then
    raise exception using errcode = '22023', message = 'valid net salary required';
  end if;
  if p_confirm and (preview->>'pendingDays')::integer > 0 then
    raise exception using
      errcode = '55000',
      message = 'monthly payroll has unresolved attendance',
      hint = 'ATTENDANCE_ACCOUNTING_MONTH_INCOMPLETE';
  end if;

  if existing_payroll.payroll_id is null then
    insert into public.attendance_monthly_payrolls (
      employee_profile_id, salary_month, salary_type_snapshot,
      base_salary_snapshot, full_days, half_days, absence_days,
      scheduled_attendance_units,
      base_pay, overtime_pay, bonus, deduction, net_salary,
      status, confirmation_note, confirmed_by_employee_profile_id,
      confirmed_at, version
    ) values (
      p_employee_profile_id, p_month, preview->>'salaryType',
      (preview->>'baseSalarySnapshot')::numeric,
      (preview->>'fullDays')::numeric,
      (preview->>'halfDays')::numeric,
      (preview->>'absenceDays')::numeric,
      (preview->>'scheduledAttendanceUnits')::integer,
      (preview->>'basePay')::numeric,
      p_overtime_pay, p_bonus, p_deduction,
      (preview->>'netSalary')::numeric,
      case when p_confirm then 'confirmed' else 'draft' end,
      normalized_note,
      case when p_confirm then actor.id else null end,
      case when p_confirm then statement_timestamp() else null end,
      1
    ) returning * into saved_payroll;
  else
    update public.attendance_monthly_payrolls payroll
    set salary_type_snapshot = preview->>'salaryType',
        base_salary_snapshot = (preview->>'baseSalarySnapshot')::numeric,
        full_days = (preview->>'fullDays')::numeric,
        half_days = (preview->>'halfDays')::numeric,
        absence_days = (preview->>'absenceDays')::numeric,
        scheduled_attendance_units =
          (preview->>'scheduledAttendanceUnits')::integer,
        base_pay = (preview->>'basePay')::numeric,
        overtime_pay = p_overtime_pay,
        bonus = p_bonus,
        deduction = p_deduction,
        net_salary = (preview->>'netSalary')::numeric,
        status = case
          when p_confirm then 'confirmed'
          when payroll.status = 'reopened' then 'reopened'
          else 'draft'
        end,
        confirmation_note = normalized_note,
        confirmed_by_employee_profile_id = case when p_confirm then actor.id else null end,
        confirmed_at = case when p_confirm then statement_timestamp() else null end,
        version = payroll.version + 1
    where payroll.payroll_id = existing_payroll.payroll_id
    returning payroll.* into saved_payroll;
  end if;

  if p_confirm then
    update public.attendance_day_resolutions resolution
    set accounting_status = 'month_locked',
        version = resolution.version + 1
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date >= p_month
      and resolution.work_date < (p_month + interval '1 month')::date
      and resolution.accounting_status = 'confirmed';
  end if;
  after_snapshot := private.attendance_payroll_snapshot(saved_payroll.payroll_id);
  insert into public.attendance_accounting_audit_log (
    object_type, object_id, action_type, actor_employee_profile_id,
    before_snapshot, after_snapshot, reason
  ) values (
    'monthly_payroll', saved_payroll.payroll_id::text,
    case when p_confirm then 'payroll_confirmed' else 'payroll_draft_saved' end,
    actor.id, before_snapshot, after_snapshot, normalized_note
  );
  return private.attendance_payroll_result(saved_payroll.payroll_id);
end;
$$;

revoke all on function private.attendance_write_monthly_payroll(
  uuid, date, numeric, numeric, numeric, text, integer, boolean
) from public, anon, authenticated, service_role;

create or replace function public.save_monthly_payroll_draft_secure(
  p_employee_profile_id uuid,
  p_month date,
  p_overtime_pay numeric,
  p_bonus numeric,
  p_deduction numeric,
  p_confirmation_note text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_accountant();
  return private.attendance_write_monthly_payroll(
    p_employee_profile_id, p_month, p_overtime_pay, p_bonus,
    p_deduction, p_confirmation_note, p_version, false
  );
end;
$$;

revoke all on function public.save_monthly_payroll_draft_secure(
  uuid, date, numeric, numeric, numeric, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.save_monthly_payroll_draft_secure(
  uuid, date, numeric, numeric, numeric, text, integer
) to authenticated, service_role;

create or replace function public.confirm_monthly_payroll_secure(
  p_employee_profile_id uuid,
  p_month date,
  p_overtime_pay numeric,
  p_bonus numeric,
  p_deduction numeric,
  p_confirmation_note text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_accountant();
  return private.attendance_write_monthly_payroll(
    p_employee_profile_id, p_month, p_overtime_pay, p_bonus,
    p_deduction, p_confirmation_note, p_version, true
  );
end;
$$;

revoke all on function public.confirm_monthly_payroll_secure(
  uuid, date, numeric, numeric, numeric, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.confirm_monthly_payroll_secure(
  uuid, date, numeric, numeric, numeric, text, integer
) to authenticated, service_role;

create or replace function public.reopen_monthly_payroll_secure(
  p_payroll_id uuid,
  p_reason text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  target_employee_id uuid;
  payroll public.attendance_monthly_payrolls%rowtype;
  before_snapshot jsonb;
  after_snapshot jsonb;
  normalized_reason text;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('module.labor.update')
      or not public.has_current_permission('sensitive.salary_view')
      or not public.has_current_permission('sensitive.salary_update') then
    raise exception using
      errcode = '42501', message = 'monthly payroll update permissions required';
  end if;
  normalized_reason := private.attendance_trim_text(p_reason);
  if normalized_reason is null or normalized_reason = ''
      or char_length(normalized_reason) > 2000 then
    raise exception using
      errcode = '22023', message = 'non-empty payroll reopen reason required';
  end if;
  select existing.employee_profile_id into target_employee_id
  from public.attendance_monthly_payrolls existing
  where existing.payroll_id = p_payroll_id;
  if target_employee_id is null then
    raise exception using errcode = '22023', message = 'monthly payroll required';
  end if;
  perform 1 from public.employee_profiles employee
  where employee.id = target_employee_id
  for update;
  select existing.* into strict payroll
  from public.attendance_monthly_payrolls existing
  where existing.payroll_id = p_payroll_id
  for update;
  if p_version is null or p_version <> payroll.version then
    raise exception using
      errcode = '40001',
      message = 'attendance accounting version conflict',
      hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
  end if;
  if payroll.status <> 'confirmed' then
    raise exception using errcode = '55000', message = 'confirmed monthly payroll required';
  end if;
  if not exists (
    select 1
    from generate_series(
      payroll.salary_month::timestamp,
      (payroll.salary_month + interval '1 month - 1 day')::timestamp,
      interval '1 day'
    ) generated(day_value)
    where private.attendance_employee_is_eligible(
      target_employee_id, generated.day_value::date
    )
  ) then
    raise exception using
      errcode = '55000',
      message = 'monthly payroll cannot be reopened for an ineligible employee';
  end if;
  perform 1
  from public.attendance_day_resolutions resolution
  where resolution.employee_profile_id = target_employee_id
    and resolution.work_date >= payroll.salary_month
    and resolution.work_date < (payroll.salary_month + interval '1 month')::date
  order by resolution.work_date, resolution.resolution_id
  for update;
  before_snapshot := private.attendance_payroll_snapshot(payroll.payroll_id);
  update public.attendance_monthly_payrolls existing
  set status = 'reopened',
      confirmed_by_employee_profile_id = null,
      confirmed_at = null,
      version = existing.version + 1
  where existing.payroll_id = payroll.payroll_id
  returning existing.* into payroll;
  update public.attendance_day_resolutions resolution
  set accounting_status = 'confirmed',
      version = resolution.version + 1
  where resolution.employee_profile_id = target_employee_id
    and resolution.work_date >= payroll.salary_month
    and resolution.work_date < (payroll.salary_month + interval '1 month')::date
    and resolution.accounting_status = 'month_locked';
  after_snapshot := private.attendance_payroll_snapshot(payroll.payroll_id);
  insert into public.attendance_accounting_audit_log (
    object_type, object_id, action_type, actor_employee_profile_id,
    before_snapshot, after_snapshot, reason
  ) values (
    'monthly_payroll', payroll.payroll_id::text, 'payroll_reopened', actor.id,
    before_snapshot, after_snapshot, normalized_reason
  );
  return private.attendance_payroll_result(payroll.payroll_id);
end;
$$;

revoke all on function public.reopen_monthly_payroll_secure(uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.reopen_monthly_payroll_secure(uuid, text, integer)
  to authenticated, service_role;

create or replace function public.list_monthly_payroll_secure(
  p_month date,
  p_search text,
  p_employee_profile_id uuid,
  p_only_pending boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  employee_record record;
  payroll public.attendance_monthly_payrolls%rowtype;
  counts jsonb;
  salary jsonb;
  preview jsonb;
  issue_counts jsonb;
  row_result jsonb;
  employees_result jsonb := '[]'::jsonb;
  normalized_search text;
  can_view_salary boolean;
  row_status text;
  row_base_pay numeric;
  row_net_salary numeric;
  row_overtime numeric;
  row_bonus numeric;
  row_deduction numeric;
  row_full_days numeric;
  row_half_days numeric;
  row_absence_days numeric;
  row_pending_days integer;
  total_scheduled_attendance_units numeric := 0;
  total_confirmed_attendance_units numeric := 0;
  total_pending integer := 0;
  total_salary numeric := 0;
  total_allocated numeric := 0;
  total_unallocated numeric := 0;
  post_legacy integer := 0;
  malformed_legacy integer := 0;
  effective_from date;
  legacy_record record;
  legacy_salary jsonb;
begin
  actor := private.current_attendance_accountant();
  if p_month is null or not isfinite(p_month) then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if not private.attendance_valid_business_date(p_month) then
    raise exception using
      errcode = '22023',
      message = 'salary month must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if p_only_pending is null then
    raise exception using errcode = '22023', message = 'pending filter required';
  end if;
  normalized_search := btrim(coalesce(p_search, ''));
  if char_length(normalized_search) > 200 then
    raise exception using errcode = '22023', message = 'valid payroll search required';
  end if;
  can_view_salary := public.has_current_permission('sensitive.salary_view');
  select settings.effective_from into effective_from
  from public.attendance_accounting_settings settings
  where settings.settings_key = 'default';

  -- This is deliberately a global quarantine count: malformed rows may not
  -- contain a usable month and therefore cannot be scoped to this report.
  select count(*)::integer into malformed_legacy
  from public.salary_records record
  where record.status = 'active'
    and private.attendance_legacy_salary_json(record.payload) is null;

  if effective_from is null
      or p_month < date_trunc('month', effective_from)::date then
    if p_employee_profile_id is null and not p_only_pending then
      for legacy_record in
        select record.record_key, parsed.value
        from public.salary_records record
        cross join lateral (
          select private.attendance_legacy_salary_json(record.payload) value
        ) parsed
        where record.status = 'active'
          and parsed.value is not null
          and parsed.value->>'salaryMonth' = to_char(p_month, 'YYYY-MM')
          and (
            normalized_search = ''
            or parsed.value->>'employeeNumber'
              ilike '%' || normalized_search || '%'
            or parsed.value->>'employeeName'
              ilike '%' || normalized_search || '%'
          )
        order by parsed.value->>'employeeNumber', record.record_key
      loop
        legacy_salary := legacy_record.value;
        row_result := jsonb_build_object(
          'source', 'legacy',
          'employeeProfileId', null,
          'employeeNumber', legacy_salary->>'employeeNumber',
          'employeeName', legacy_salary->>'employeeName',
          'department', '',
          'fullDays', 0,
          'halfDays', 0,
          'excusedDays', 0,
          'absenceDays', 0,
          'pendingDays', 0,
          'issueCounts', jsonb_build_object(
            'late', 0, 'early', 0,
            'abnormalLocation', 0, 'overtimePending', 0
          ),
          'status', 'confirmed',
          'payrollId', null,
          'version', 0
        );
        if can_view_salary then
          row_result := row_result || jsonb_build_object(
            'salaryType', '月薪',
            'baseSalarySnapshot',
              (legacy_salary->>'baseSalary')::numeric,
            'basePay', (legacy_salary->>'baseSalary')::numeric,
            'overtimePay', (legacy_salary->>'overtimePay')::numeric,
            'bonus', (legacy_salary->>'bonus')::numeric,
            'deduction', (legacy_salary->>'deduction')::numeric,
            'netSalary', (legacy_salary->>'netSalary')::numeric,
            'projectAllocatedAmount', 0,
            'projectUnallocatedAmount', 0,
            'confirmationNote', '',
            'confirmedAt', null
          );
          total_salary := total_salary
            + (legacy_salary->>'netSalary')::numeric;
        end if;
        employees_result := employees_result || jsonb_build_array(row_result);
      end loop;
    end if;
    if can_view_salary then
      total_salary := private.attendance_require_safe_aggregate(total_salary);
    end if;
    row_result := jsonb_build_object(
      'employeeCount', jsonb_array_length(employees_result),
      'scheduledAttendanceUnits', 0,
      'confirmedAttendanceUnits', 0,
      'pendingCount', 0
    );
    if can_view_salary then
      row_result := row_result || jsonb_build_object(
        'salaryPreviewTotal', total_salary,
        'projectAllocatedTotal', 0,
        'projectUnallocatedTotal', 0
      );
    end if;
    return jsonb_build_object(
      'salaryMonth', to_char(p_month, 'YYYY-MM'),
      'permissions', jsonb_build_object(
        'canViewSalary', can_view_salary,
        'canUpdateSalary', false
      ),
      'summary', row_result,
      'employees', employees_result,
      'reconciliation', jsonb_build_object(
        'postActivationLegacyRows', 0,
        'globalMalformedLegacyRows', malformed_legacy
      )
    );
  end if;

  for employee_record in
    select employee.*
    from public.employee_profiles employee
    where not employee.is_hidden_system_account
      and employee.employee_number <> 'SW-000'
      and (p_employee_profile_id is null or employee.id = p_employee_profile_id)
      and (
        normalized_search = ''
        or employee.employee_number ilike '%' || normalized_search || '%'
        or employee.name ilike '%' || normalized_search || '%'
        or employee.department ilike '%' || normalized_search || '%'
      )
      and (
        exists (
          select 1
          from public.attendance_monthly_payrolls existing
          where existing.employee_profile_id = employee.id
            and existing.salary_month = p_month
        )
        or exists (
          select 1
          from public.attendance_day_resolutions historical_resolution
          where historical_resolution.employee_profile_id = employee.id
            and historical_resolution.work_date >= p_month
            and historical_resolution.work_date
              < (p_month + interval '1 month')::date
            and historical_resolution.accounting_status in (
              'confirmed', 'month_locked'
            )
        )
        or (
          employee.deleted_at is null
          and exists (
            select 1
            from generate_series(
              p_month::timestamp,
              (p_month + interval '1 month - 1 day')::timestamp,
              interval '1 day'
            ) generated(day_value)
            where private.attendance_employee_is_eligible(
              employee.id, generated.day_value::date
            )
          )
        )
      )
    order by employee.employee_number, employee.id
  loop
    payroll := null;
    select existing.* into payroll
    from public.attendance_monthly_payrolls existing
    where existing.employee_profile_id = employee_record.id
      and existing.salary_month = p_month;
    counts := private.attendance_month_counts(employee_record.id, p_month);
    if payroll.status = 'confirmed' then
      row_full_days := payroll.full_days;
      row_half_days := payroll.half_days;
      row_absence_days := payroll.absence_days;
      row_pending_days := 0;
    else
      row_full_days := (counts->>'fullDays')::numeric;
      row_half_days := (counts->>'halfDays')::numeric;
      row_absence_days := (counts->>'absenceDays')::numeric;
      row_pending_days := (counts->>'pendingDays')::integer;
    end if;
    salary := private.attendance_salary_json(employee_record.id, 1);
    row_overtime := coalesce(payroll.overtime_pay, 0);
    row_bonus := coalesce(payroll.bonus, 0);
    row_deduction := coalesce(payroll.deduction, 0);
    preview := private.attendance_payroll_preview(
      employee_record.id, p_month, row_overtime, row_bonus, row_deduction
    );
    if payroll.status = 'confirmed' then
      row_status := 'confirmed';
      row_base_pay := payroll.base_pay;
      row_net_salary := payroll.net_salary;
    elsif not (preview->>'salaryValid')::boolean then
      row_status := 'salary_required';
      row_base_pay := (preview->>'basePay')::numeric;
      row_net_salary := (preview->>'netSalary')::numeric;
    elsif not (preview->>'validMoney')::boolean then
      row_status := 'invalid_money';
      row_base_pay := (preview->>'basePay')::numeric;
      row_net_salary := (preview->>'netSalary')::numeric;
    elsif (counts->>'pendingDays')::integer > 0 then
      row_status := 'incomplete';
      row_base_pay := (preview->>'basePay')::numeric;
      row_net_salary := (preview->>'netSalary')::numeric;
    else
      row_status := 'ready';
      row_base_pay := (preview->>'basePay')::numeric;
      row_net_salary := (preview->>'netSalary')::numeric;
    end if;
    if p_only_pending and row_status = 'confirmed' then
      continue;
    end if;

    select jsonb_build_object(
        'late', count(*) filter (where issue_codes @> array['late']::text[]),
        'early', count(*) filter (where issue_codes @> array['early']::text[]),
        'abnormalLocation', count(*) filter (
          where issue_codes @> array['abnormal_location']::text[]
        ),
        'overtimePending', count(*) filter (
          where issue_codes @> array['overtime_pending']::text[]
        )
      ) into issue_counts
      from (
        select case
          when resolution.accounting_status in ('confirmed', 'month_locked')
            then resolution.issue_codes_snapshot
          else private.attendance_issue_codes(
            employee_record.id,
            generated.day_value::date,
            statement_timestamp() at time zone 'Asia/Tokyo'
          )
        end issue_codes
        from generate_series(
          p_month::timestamp,
          (p_month + interval '1 month - 1 day')::timestamp,
          interval '1 day'
        ) generated(day_value)
        left join public.attendance_day_resolutions resolution
          on resolution.employee_profile_id = employee_record.id
          and resolution.work_date = generated.day_value::date
        where resolution.accounting_status in ('confirmed', 'month_locked')
          or private.attendance_employee_is_eligible(
            employee_record.id, generated.day_value::date
          )
      ) issue_rows;

    row_result := jsonb_build_object(
      'employeeProfileId', employee_record.id,
      'employeeNumber', employee_record.employee_number,
      'employeeName', employee_record.name,
      'department', employee_record.department,
      'fullDays', row_full_days,
      'halfDays', row_half_days,
      'excusedDays', (counts->>'excusedDays')::numeric,
      'absenceDays', row_absence_days,
      'pendingDays', row_pending_days,
      'issueCounts', issue_counts,
      'status', row_status,
      'payrollId', payroll.payroll_id,
      'version', coalesce(payroll.version, 0)
    );
    if can_view_salary then
      row_result := row_result || jsonb_build_object(
        'salaryType', case
          when payroll.status = 'confirmed' then payroll.salary_type_snapshot
          else salary->>'salaryType'
        end,
        'baseSalarySnapshot', case
          when payroll.status = 'confirmed' then payroll.base_salary_snapshot
          else (preview->>'baseSalarySnapshot')::numeric
        end,
        'basePay', case
          when private.attendance_valid_yen(row_base_pay) then row_base_pay
          else null
        end,
        'overtimePay', row_overtime,
        'bonus', row_bonus,
        'deduction', row_deduction,
        'netSalary', case
          when row_status in ('invalid_money', 'salary_required') then null
          else row_net_salary
        end,
        'projectAllocatedAmount',
          (counts->>'projectAllocatedAmount')::numeric,
        'projectUnallocatedAmount',
          (counts->>'projectUnallocatedAmount')::numeric,
        'confirmationNote', coalesce(payroll.confirmation_note, ''),
        'confirmedAt', payroll.confirmed_at
      );
      if row_status not in ('invalid_money', 'salary_required') then
        total_salary := total_salary + row_net_salary;
      end if;
      total_allocated := total_allocated
        + (counts->>'projectAllocatedAmount')::numeric;
      total_unallocated := total_unallocated
        + (counts->>'projectUnallocatedAmount')::numeric;
    end if;
    total_scheduled_attendance_units := total_scheduled_attendance_units
      + (counts->>'scheduledAttendanceUnits')::numeric;
    total_confirmed_attendance_units := total_confirmed_attendance_units
      + (counts->>'confirmedAttendanceUnits')::numeric;
    total_pending := total_pending + row_pending_days;
    employees_result := employees_result || jsonb_build_array(row_result);
  end loop;

  if effective_from is not null
      and p_month >= date_trunc('month', effective_from)::date then
    select count(*)::integer into post_legacy
    from public.salary_records record
    cross join lateral (
      select private.attendance_legacy_salary_json(record.payload) value
    ) parsed
    left join public.employee_profiles employee
      on employee.legacy_employee_id = parsed.value->>'employeeNumber'
    where record.status = 'active'
      and parsed.value is not null
      and parsed.value->>'salaryMonth' = to_char(p_month, 'YYYY-MM')
      and (
        p_employee_profile_id is null
        or employee.id = p_employee_profile_id
      )
      and (
        normalized_search = ''
        or parsed.value->>'employeeNumber'
          ilike '%' || normalized_search || '%'
        or parsed.value->>'employeeName'
          ilike '%' || normalized_search || '%'
      );
  end if;

  if can_view_salary then
    total_salary := private.attendance_require_safe_aggregate(total_salary);
    total_allocated := private.attendance_require_safe_aggregate(
      total_allocated
    );
    total_unallocated := private.attendance_require_safe_aggregate(
      total_unallocated
    );
  end if;

  row_result := jsonb_build_object(
    'employeeCount', jsonb_array_length(employees_result),
    'scheduledAttendanceUnits', private.attendance_require_safe_aggregate(
      total_scheduled_attendance_units
    ),
    'confirmedAttendanceUnits', private.attendance_require_safe_aggregate(
      total_confirmed_attendance_units
    ),
    'pendingCount', total_pending
  );
  if can_view_salary then
    row_result := row_result || jsonb_build_object(
      'salaryPreviewTotal', total_salary,
      'projectAllocatedTotal', total_allocated,
      'projectUnallocatedTotal', total_unallocated
    );
  end if;
  return jsonb_build_object(
    'salaryMonth', to_char(p_month, 'YYYY-MM'),
    'permissions', jsonb_build_object(
      'canViewSalary', can_view_salary,
      'canUpdateSalary',
        can_view_salary
        and public.has_current_permission('module.labor.update')
        and public.has_current_permission('sensitive.salary_update')
    ),
    'summary', row_result,
    'employees', employees_result,
    'reconciliation', jsonb_build_object(
      'postActivationLegacyRows', post_legacy,
      'globalMalformedLegacyRows', malformed_legacy
    )
  );
end;
$$;

revoke all on function public.list_monthly_payroll_secure(
  date, text, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.list_monthly_payroll_secure(
  date, text, uuid, boolean
) to authenticated, service_role;

create or replace function public.list_employee_attendance_calendar_secure(
  p_employee_profile_id uuid,
  p_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  employee public.employee_profiles%rowtype;
  day_resolution public.attendance_day_resolutions%rowtype;
  generated record;
  eligible boolean;
  dashboard_employee jsonb;
  days_result jsonb := '[]'::jsonb;
begin
  actor := private.current_attendance_accountant();
  if p_employee_profile_id is null then
    raise exception using
      errcode = '22023', message = 'valid employee and salary month required';
  end if;
  if p_month is null or not isfinite(p_month) then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if not private.attendance_valid_business_date(p_month) then
    raise exception using
      errcode = '22023',
      message = 'salary month must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;

  select profile.*
    into employee
    from public.employee_profiles profile
    where profile.id = p_employee_profile_id
      and not profile.is_hidden_system_account
      and profile.employee_number <> 'SW-000';
  if not found then
    raise exception using errcode = '22023', message = 'employee not found';
  end if;

  for generated in
    select day_value::date work_date
    from generate_series(
      p_month::timestamp,
      (p_month + interval '1 month - 1 day')::timestamp,
      interval '1 day'
    ) day_value
    order by day_value
  loop
    day_resolution := null;
    select resolution.*
      into day_resolution
      from public.attendance_day_resolutions resolution
      where resolution.employee_profile_id = employee.id
        and resolution.work_date = generated.work_date;
    if day_resolution.accounting_status in ('confirmed', 'month_locked') then
      days_result := days_result || jsonb_build_array(jsonb_build_object(
        'workDate', generated.work_date,
        'eligible', true,
        'scheduleRequired', day_resolution.schedule_required,
        'dayStatus', day_resolution.resolution_type,
        'issueCodes', to_jsonb(day_resolution.issue_codes_snapshot),
        'accountingStatus', day_resolution.accounting_status
      ));
      continue;
    end if;
    eligible := private.attendance_employee_is_eligible(
      employee.id, generated.work_date
    );
    if not eligible then
      days_result := days_result || jsonb_build_array(jsonb_build_object(
        'workDate', generated.work_date,
        'eligible', false,
        'scheduleRequired', false,
        'dayStatus', 'not_eligible',
        'issueCodes', jsonb_build_array(),
        'accountingStatus', null
      ));
    else
      dashboard_employee := private.attendance_dashboard_employee_json(
        employee.id, generated.work_date, false
      );
      if dashboard_employee is null then
        raise exception using
          errcode = '22000', message = 'attendance calendar employee unavailable';
      end if;
      days_result := days_result || jsonb_build_array(jsonb_build_object(
        'workDate', generated.work_date,
        'eligible', true,
        'scheduleRequired',
          (dashboard_employee->>'scheduleRequired')::boolean,
        'dayStatus', dashboard_employee->>'dayStatus',
        'issueCodes', dashboard_employee->'issueCodes',
        'accountingStatus',
          dashboard_employee#>>'{resolution,accountingStatus}'
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'salaryMonth', to_char(p_month, 'YYYY-MM'),
    'employee', jsonb_build_object(
      'employeeProfileId', employee.id,
      'employeeNumber', employee.employee_number,
      'employeeName', employee.name,
      'department', employee.department,
      'position', employee.position
    ),
    'days', days_result
  );
end;
$$;

revoke all on function public.list_employee_attendance_calendar_secure(
  uuid, date
) from public, anon, authenticated, service_role;
grant execute on function public.list_employee_attendance_calendar_secure(
  uuid, date
) to authenticated, service_role;

create or replace function public.get_attendance_accounting_settings_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  settings_version integer;
begin
  actor := private.current_attendance_accountant();
  select settings.version into settings_version
  from public.attendance_accounting_settings settings
  where settings.settings_key = 'default';
  return private.attendance_accounting_settings_json()
    || jsonb_build_object('version', coalesce(settings_version, 0));
end;
$$;

revoke all on function public.get_attendance_accounting_settings_secure()
  from public, anon, authenticated, service_role;
grant execute on function public.get_attendance_accounting_settings_secure()
  to authenticated, service_role;

create or replace function public.update_attendance_accounting_settings_secure(
  p_effective_from date,
  p_work_weekdays smallint[],
  p_work_start_time time without time zone,
  p_work_end_time time without time zone,
  p_break_minutes integer,
  p_standard_day_minutes integer,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  existing public.attendance_accounting_settings%rowtype;
  saved public.attendance_accounting_settings%rowtype;
  sorted_weekdays smallint[];
  unique_count integer;
  before_snapshot jsonb;
  after_snapshot jsonb;
  shift_minutes numeric;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('module.settings.update') then
    raise exception using
      errcode = '42501', message = 'attendance settings update permission required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('attendance_accounting_settings', 0)
  );
  if p_effective_from is null or not isfinite(p_effective_from) then
    raise exception using errcode = '22023', message = 'valid effective date required';
  end if;
  if not private.attendance_valid_business_date(p_effective_from) then
    raise exception using
      errcode = '22023',
      message = 'effective date must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_work_weekdays is null or cardinality(p_work_weekdays) not between 1 and 7
      or array_position(p_work_weekdays, null::smallint) is not null
      or not (p_work_weekdays <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception using errcode = '22023', message = 'valid unique work weekdays required';
  end if;
  select count(distinct weekday), array_agg(weekday order by weekday)
    into unique_count, sorted_weekdays
    from unnest(p_work_weekdays) weekday;
  if unique_count <> cardinality(p_work_weekdays) then
    raise exception using errcode = '22023', message = 'valid unique work weekdays required';
  end if;
  if p_work_start_time is null or p_work_end_time is null
      or extract(second from p_work_start_time) <> 0
      or extract(second from p_work_end_time) <> 0
      or p_work_start_time >= p_work_end_time
      or p_break_minutes is null or p_standard_day_minutes is null then
    raise exception using errcode = '22023', message = 'valid attendance schedule required';
  end if;
  shift_minutes := extract(epoch from (p_work_end_time - p_work_start_time)) / 60;
  if p_break_minutes < 0 or p_break_minutes >= shift_minutes
      or p_break_minutes > 1439
      or p_standard_day_minutes < 1 or p_standard_day_minutes > 1440
      or p_standard_day_minutes > shift_minutes - p_break_minutes then
    raise exception using errcode = '22023', message = 'valid attendance schedule required';
  end if;

  select settings.* into existing
  from public.attendance_accounting_settings settings
  where settings.settings_key = 'default'
  for update;
  if existing.settings_key is null then
    if p_version is null or p_version <> 0 then
      raise exception using
        errcode = '40001',
        message = 'attendance accounting version conflict',
        hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
    end if;
  else
    if p_version is null or p_version <> existing.version then
      raise exception using
        errcode = '40001',
        message = 'attendance accounting version conflict',
        hint = 'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT';
    end if;
    if p_effective_from <> existing.effective_from
        and (
          exists (
            select 1
            from public.attendance_day_resolutions resolution
            where resolution.accounting_status in ('confirmed', 'month_locked')
          )
          or exists (
            select 1
            from public.attendance_monthly_payrolls payroll
            where payroll.status = 'confirmed'
          )
          or exists (
            select 1
            from public.attendance_accounting_audit_log audit
            where (
              audit.object_type = 'attendance_resolution'
              and audit.action_type = 'resolution_confirmed'
            ) or (
              audit.object_type = 'monthly_payroll'
              and audit.action_type = 'payroll_confirmed'
            )
          )
        ) then
      raise exception using
        errcode = '55000',
        message = 'effective_from cannot change after confirmed attendance; use an explicit database migration';
    end if;
    before_snapshot := jsonb_build_object(
      'effectiveFrom', existing.effective_from,
      'workWeekdays', to_jsonb(existing.work_weekdays),
      'workStartTime', to_char(existing.work_start_time, 'HH24:MI'),
      'workEndTime', to_char(existing.work_end_time, 'HH24:MI'),
      'breakMinutes', existing.break_minutes,
      'standardDayMinutes', existing.standard_day_minutes,
      'version', existing.version
    );
  end if;

  if existing.settings_key is null then
    insert into public.attendance_accounting_settings (
      settings_key, effective_from, work_weekdays,
      work_start_time, work_end_time, break_minutes,
      standard_day_minutes, version, updated_by_employee_profile_id
    ) values (
      'default', p_effective_from, sorted_weekdays,
      p_work_start_time, p_work_end_time, p_break_minutes,
      p_standard_day_minutes, 1, actor.id
    ) returning * into saved;
  else
    update public.attendance_accounting_settings settings
    set effective_from = p_effective_from,
        work_weekdays = sorted_weekdays,
        work_start_time = p_work_start_time,
        work_end_time = p_work_end_time,
        break_minutes = p_break_minutes,
        standard_day_minutes = p_standard_day_minutes,
        version = settings.version + 1,
        updated_by_employee_profile_id = actor.id
    where settings.settings_key = 'default'
    returning settings.* into saved;
  end if;
  after_snapshot := jsonb_build_object(
    'effectiveFrom', saved.effective_from,
    'workWeekdays', to_jsonb(saved.work_weekdays),
    'workStartTime', to_char(saved.work_start_time, 'HH24:MI'),
    'workEndTime', to_char(saved.work_end_time, 'HH24:MI'),
    'breakMinutes', saved.break_minutes,
    'standardDayMinutes', saved.standard_day_minutes,
    'version', saved.version
  );
  insert into public.attendance_accounting_audit_log (
    object_type, object_id, action_type, actor_employee_profile_id,
    before_snapshot, after_snapshot, reason
  ) values (
    'settings', 'default',
    case when before_snapshot is null then 'settings_created' else 'settings_updated' end,
    actor.id, before_snapshot, after_snapshot, ''
  );
  return public.get_attendance_accounting_settings_secure();
end;
$$;

revoke all on function public.update_attendance_accounting_settings_secure(
  date, smallint[], time without time zone, time without time zone,
  integer, integer, integer
) from public, anon, authenticated, service_role;
grant execute on function public.update_attendance_accounting_settings_secure(
  date, smallint[], time without time zone, time without time zone,
  integer, integer, integer
) to authenticated, service_role;

create or replace function private.attendance_official_project_rows()
returns table (
  source_key text,
  work_unit_key text,
  source text,
  work_date date,
  project_id text,
  project_name text,
  employee_profile_id uuid,
  employee_number text,
  employee_name text,
  attendance_units numeric,
  amount numeric,
  accounting_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with configured as (
    select settings.effective_from
    from public.attendance_accounting_settings settings
    where settings.settings_key = 'default'
  ), legacy as (
    select
      record.record_key source_key,
      case
        when employee.id is not null then
          'legacy-day:canonical:' || employee.id::text || ':'
            || (parsed.value->>'workDate')
        when nullif(btrim(parsed.value->>'employeeId'), '') is not null then
          'legacy-day:employee:' || btrim(parsed.value->>'employeeId') || ':'
            || (parsed.value->>'workDate')
        else 'legacy:' || record.record_key
      end work_unit_key,
      'legacy'::text source,
      (parsed.value->>'workDate')::date work_date,
      parsed.value->>'projectId' project_id,
      parsed.value->>'projectName' project_name,
      employee.id employee_profile_id,
      coalesce(employee.employee_number, parsed.value->>'employeeId') employee_number,
      coalesce(nullif(parsed.value->>'employeeName', ''), employee.name, '') employee_name,
      case
        when record.payload->>'workType' = '半天' then 0.5::numeric
        when record.payload->>'workType' in ('休息', '请假', '调休') then 0::numeric
        else 1::numeric
      end attendance_units,
      (parsed.value->>'amount')::numeric amount,
      'legacy'::text accounting_status
    from public.labor_records record
    cross join lateral (
      select private.attendance_legacy_labor_json(record.payload) value
    ) parsed
    left join public.employee_profiles employee
      on employee.legacy_employee_id = parsed.value->>'employeeId'
    left join configured on true
    where record.status = 'active'
      and parsed.value is not null
      and (
        configured.effective_from is null
        or (parsed.value->>'workDate')::date < configured.effective_from
      )
  ), normalized as (
    select
      allocation.allocation_id::text source_key,
      'resolution:' || resolution.resolution_id::text work_unit_key,
      'attendance'::text source,
      resolution.work_date,
      allocation.project_id,
      allocation.project_name_snapshot project_name,
      employee.id employee_profile_id,
      employee.employee_number,
      employee.name employee_name,
      resolution.attendance_units,
      private.attendance_require_safe_aggregate(allocation.amount) amount,
      resolution.accounting_status
    from public.attendance_project_allocations allocation
    join public.attendance_day_resolutions resolution
      on resolution.resolution_id = allocation.resolution_id
    join public.employee_profiles employee
      on employee.id = resolution.employee_profile_id
    join configured
      on resolution.work_date >= configured.effective_from
    where resolution.accounting_status in ('confirmed', 'month_locked')
  )
  select * from legacy
  union all
  select * from normalized;
$$;

revoke all on function private.attendance_official_project_rows()
  from public, anon, authenticated, service_role;

create or replace function public.list_project_labor_costs_secure(
  p_month date,
  p_status text,
  p_employee_profile_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  normalized_status text;
  normalized_project_id text;
  can_view_salary boolean;
  month_end date;
  effective_from date;
  monthly_total numeric := 0;
  lifetime_total numeric := 0;
  confirmed_units numeric := 0;
  pending_count integer := 0;
  pending_amount numeric := 0;
  post_legacy integer := 0;
  malformed_legacy integer := 0;
  trend_result jsonb;
  composition_result jsonb := '[]'::jsonb;
  details_result jsonb := '[]'::jsonb;
  comparison_result jsonb;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501', message = 'project labor cost view permission required';
  end if;
  can_view_salary := public.has_current_permission('sensitive.salary_view');
  if p_employee_profile_id is not null and not can_view_salary then
    raise exception using
      errcode = '42501',
      message = 'salary view permission required for employee project filter';
  end if;
  if p_month is null or not isfinite(p_month) then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if not private.attendance_valid_business_date(p_month) then
    raise exception using
      errcode = '22023',
      message = 'salary month must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  normalized_status := btrim(coalesce(p_status, ''));
  if normalized_status = '' then
    normalized_status := 'all';
  end if;
  if normalized_status not in ('all', 'confirmed', 'pending') then
    raise exception using
      errcode = '22023', message = 'valid project labor status required';
  end if;
  normalized_project_id := nullif(btrim(coalesce(p_project_id, '')), '');
  if normalized_project_id is not null
      and char_length(normalized_project_id) > 500 then
    raise exception using errcode = '22023', message = 'valid project filter required';
  end if;
  month_end := (p_month + interval '1 month - 1 day')::date;
  select settings.effective_from into effective_from
  from public.attendance_accounting_settings settings
  where settings.settings_key = 'default';

  select
    private.attendance_require_safe_aggregate(coalesce(sum(row.amount) filter (
      where row.work_date >= p_month and row.work_date <= month_end
    ), 0)),
    private.attendance_require_safe_aggregate(coalesce(
      sum(row.amount), 0
    ))
    into monthly_total, lifetime_total
    from private.attendance_official_project_rows() row
    where (normalized_project_id is null or row.project_id = normalized_project_id)
      and (p_employee_profile_id is null
        or row.employee_profile_id = p_employee_profile_id);

  select trim_scale(private.attendance_require_safe_aggregate(
      coalesce(sum(unit.attendance_units), 0)
    )) into confirmed_units
  from (
    select row.work_unit_key, max(row.attendance_units) attendance_units
    from private.attendance_official_project_rows() row
    where row.work_date >= p_month and row.work_date <= month_end
      and (normalized_project_id is null or row.project_id = normalized_project_id)
      and (p_employee_profile_id is null
        or row.employee_profile_id = p_employee_profile_id)
    group by row.work_unit_key
  ) unit;

  select count(*)::integer,
      private.attendance_require_safe_aggregate(coalesce(sum(
        case
          when normalized_project_id is null then greatest(
            resolution.final_project_cost, allocation_totals.total_amount
          )
          else allocation_totals.filtered_amount
        end
      ), 0))
    into pending_count, pending_amount
    from public.attendance_day_resolutions resolution
    join public.employee_profiles employee
      on employee.id = resolution.employee_profile_id
    cross join lateral (
      select
        private.attendance_require_safe_aggregate(
          coalesce(sum(allocation.amount), 0)
        ) total_amount,
        private.attendance_require_safe_aggregate(coalesce(sum(
          allocation.amount
        ) filter (
          where allocation.project_id = normalized_project_id
        ), 0)) filtered_amount,
        count(*) filter (
          where allocation.project_id = normalized_project_id
        ) filtered_count
      from public.attendance_project_allocations allocation
      where allocation.resolution_id = resolution.resolution_id
    ) allocation_totals
    where resolution.accounting_status = 'draft'
      and resolution.work_date >= p_month
      and resolution.work_date <= month_end
      and (effective_from is null or resolution.work_date >= effective_from)
      and (
        (
          normalized_project_id is null
          and (
            resolution.final_project_cost > 0
            or allocation_totals.total_amount > 0
          )
        )
        or (
          normalized_project_id is not null
          and allocation_totals.filtered_count > 0
        )
      )
      and (p_employee_profile_id is null or employee.id = p_employee_profile_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'salaryMonth', to_char(month_series.month_value, 'YYYY-MM'),
      'amount', coalesce(month_series.amount, 0)
    ) order by month_series.month_value), '[]'::jsonb)
    into trend_result
    from (
      select generated.month_value::date month_value,
        (
          select private.attendance_require_safe_aggregate(
            coalesce(sum(row.amount), 0)
          )
          from private.attendance_official_project_rows() row
          where row.work_date >= generated.month_value::date
            and row.work_date < (generated.month_value + interval '1 month')::date
            and (normalized_project_id is null or row.project_id = normalized_project_id)
            and (p_employee_profile_id is null
              or row.employee_profile_id = p_employee_profile_id)
        ) amount
      from generate_series(
        (p_month - interval '5 months')::timestamp,
        p_month::timestamp,
        interval '1 month'
      ) generated(month_value)
    ) month_series;

  if can_view_salary then
    select coalesce(jsonb_agg(jsonb_build_object(
        'employeeProfileId', composition.employee_profile_id,
        'employeeNumber', composition.employee_number,
        'employeeName', composition.employee_name,
        'attendanceUnits', composition.attendance_units,
        'amount', composition.amount
      ) order by composition.employee_number, composition.identity_key), '[]'::jsonb)
      into composition_result
      from (
        with filtered as (
          select row.*,
            case
              when row.employee_profile_id is not null
                then 'canonical:' || row.employee_profile_id::text
              when nullif(btrim(coalesce(row.employee_number, '')), '')
                  is not null
                then 'legacy:' || btrim(row.employee_number)
              else 'legacy-source:' || row.work_unit_key
            end identity_key
          from private.attendance_official_project_rows() row
          where row.work_date >= p_month and row.work_date <= month_end
            and (normalized_project_id is null
              or row.project_id = normalized_project_id)
            and (p_employee_profile_id is null
              or row.employee_profile_id = p_employee_profile_id)
        ), amounts as (
          select filtered.identity_key,
            max(filtered.employee_profile_id::text)::uuid
              employee_profile_id,
            min(filtered.employee_number) employee_number,
            min(filtered.employee_name) employee_name,
            private.attendance_require_safe_aggregate(
              sum(filtered.amount)
            ) amount
          from filtered
          group by filtered.identity_key
        ), work_units as (
          select filtered.identity_key, filtered.work_unit_key,
            max(filtered.attendance_units) attendance_units
          from filtered
          group by filtered.identity_key, filtered.work_unit_key
        ), units as (
          select work_units.identity_key,
            trim_scale(private.attendance_require_safe_aggregate(
              sum(work_units.attendance_units)
            )) attendance_units
          from work_units
          group by work_units.identity_key
        )
        select amounts.identity_key, amounts.employee_profile_id,
          amounts.employee_number, amounts.employee_name,
          units.attendance_units, amounts.amount
        from amounts
        join units using (identity_key)
      ) composition;
    with confirmed_details as (
      select row.source_key, row.source, row.work_date,
        row.project_id, row.project_name, row.employee_profile_id,
        row.employee_number, row.employee_name, row.attendance_units,
        row.amount, row.accounting_status
      from private.attendance_official_project_rows() row
      where normalized_status in ('all', 'confirmed')
        and row.work_date >= p_month and row.work_date <= month_end
        and (normalized_project_id is null
          or row.project_id = normalized_project_id)
        and (p_employee_profile_id is null
          or row.employee_profile_id = p_employee_profile_id)
    ), pending_allocated as (
      select allocation.allocation_id::text source_key,
        'attendance'::text source,
        resolution.work_date,
        allocation.project_id,
        allocation.project_name_snapshot project_name,
        employee.id employee_profile_id,
        employee.employee_number,
        employee.name employee_name,
        resolution.attendance_units,
        private.attendance_require_safe_aggregate(allocation.amount) amount,
        'draft'::text accounting_status
      from public.attendance_project_allocations allocation
      join public.attendance_day_resolutions resolution
        on resolution.resolution_id = allocation.resolution_id
      join public.employee_profiles employee
        on employee.id = resolution.employee_profile_id
      where normalized_status in ('all', 'pending')
        and resolution.accounting_status = 'draft'
        and resolution.work_date >= p_month
        and resolution.work_date <= month_end
        and (effective_from is null
          or resolution.work_date >= effective_from)
        and (normalized_project_id is null
          or allocation.project_id = normalized_project_id)
        and (p_employee_profile_id is null
          or employee.id = p_employee_profile_id)
    ), pending_unallocated as (
      select 'draft-unallocated:' || resolution.resolution_id::text
          source_key,
        'attendance'::text source,
        resolution.work_date,
        null::text project_id,
        '未分摊'::text project_name,
        employee.id employee_profile_id,
        employee.employee_number,
        employee.name employee_name,
        resolution.attendance_units,
        private.attendance_require_safe_aggregate(
          resolution.final_project_cost - allocated.amount
        ) amount,
        'draft'::text accounting_status
      from public.attendance_day_resolutions resolution
      join public.employee_profiles employee
        on employee.id = resolution.employee_profile_id
      cross join lateral (
        select private.attendance_require_safe_aggregate(
          coalesce(sum(allocation.amount), 0)
        ) amount
        from public.attendance_project_allocations allocation
        where allocation.resolution_id = resolution.resolution_id
      ) allocated
      where normalized_status in ('all', 'pending')
        and normalized_project_id is null
        and resolution.accounting_status = 'draft'
        and resolution.work_date >= p_month
        and resolution.work_date <= month_end
        and (effective_from is null
          or resolution.work_date >= effective_from)
        and (p_employee_profile_id is null
          or employee.id = p_employee_profile_id)
        and resolution.final_project_cost > allocated.amount
    ), detail_rows as (
      select * from confirmed_details
      union all
      select * from pending_allocated
      union all
      select * from pending_unallocated
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'source', row.source,
        'sourceKey', row.source_key,
        'workDate', row.work_date,
        'projectId', row.project_id,
        'projectName', row.project_name,
        'employeeProfileId', row.employee_profile_id,
        'employeeNumber', row.employee_number,
        'employeeName', row.employee_name,
        'attendanceUnits', row.attendance_units,
        'amount', row.amount,
        'accountingStatus', row.accounting_status
      ) order by row.work_date, row.project_id nulls last,
        row.employee_number, row.source, row.source_key), '[]'::jsonb)
      into details_result
      from detail_rows row;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'projectId', comparison.project_id,
      'projectName', comparison.project_name,
      'monthlyConfirmedCost', comparison.monthly_amount,
      'lifetimeConfirmedCost', comparison.lifetime_amount
    ) order by comparison.project_name, comparison.project_id), '[]'::jsonb)
    into comparison_result
    from (
      select row.project_id,
        min(row.project_name) project_name,
        private.attendance_require_safe_aggregate(coalesce(
          sum(row.amount) filter (
            where row.work_date >= p_month and row.work_date <= month_end
          ), 0
        )) monthly_amount,
        private.attendance_require_safe_aggregate(coalesce(
          sum(row.amount), 0
        )) lifetime_amount
      from private.attendance_official_project_rows() row
      where (p_employee_profile_id is null
          or row.employee_profile_id = p_employee_profile_id)
      group by row.project_id
    ) comparison;

  if effective_from is not null then
    select count(*)::integer into post_legacy
    from public.labor_records record
    cross join lateral (
      select private.attendance_legacy_labor_json(record.payload) value
    ) parsed
    left join public.employee_profiles employee
      on employee.legacy_employee_id = parsed.value->>'employeeId'
    where record.status = 'active'
      and parsed.value is not null
      and (parsed.value->>'workDate')::date >= effective_from
      and (parsed.value->>'workDate')::date >= p_month
      and (parsed.value->>'workDate')::date <= month_end
      and (
        normalized_project_id is null
        or parsed.value->>'projectId' = normalized_project_id
      )
      and (
        p_employee_profile_id is null
        or employee.id = p_employee_profile_id
      );
  end if;
  -- Global quarantine count: malformed rows may not expose a usable date.
  select count(*)::integer into malformed_legacy
  from public.labor_records record
  where record.status = 'active'
    and private.attendance_legacy_labor_json(record.payload) is null;

  return jsonb_build_object(
    'salaryMonth', to_char(p_month, 'YYYY-MM'),
    'permissions', jsonb_build_object(
      'canViewSalary', can_view_salary,
      'canViewEmployeeComposition', can_view_salary
    ),
    'summary', jsonb_build_object(
      'monthlyConfirmedCost', monthly_total,
      'lifetimeConfirmedCost', lifetime_total,
      'confirmedAttendanceUnits', confirmed_units,
      'pendingAllocationCount', pending_count,
      'pendingAllocationAmount', pending_amount
    ),
    'trend', trend_result,
    'employeeComposition', composition_result,
    'dailyDetails', details_result,
    'projectComparison', comparison_result,
    'reconciliation', jsonb_build_object(
      'postActivationLegacyRows', post_legacy,
      'globalMalformedLegacyRows', malformed_legacy
    )
  );
end;
$$;

revoke all on function public.list_project_labor_costs_secure(
  date, text, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.list_project_labor_costs_secure(
  date, text, uuid, text
) to authenticated, service_role;

create or replace function public.export_project_labor_costs_secure(
  p_month date,
  p_project_id text,
  p_employee_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  normalized_project_id text;
  month_end date;
  result jsonb;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501', message = 'project labor cost view permission required';
  end if;
  if not public.has_current_permission('sensitive.salary_view') then
    raise exception using
      errcode = '42501',
      message = 'salary view permission required for employee project export';
  end if;
  if p_month is null or not isfinite(p_month) then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if not private.attendance_valid_business_date(p_month) then
    raise exception using
      errcode = '22023',
      message = 'salary month must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  normalized_project_id := nullif(btrim(coalesce(p_project_id, '')), '');
  if normalized_project_id is not null
      and char_length(normalized_project_id) > 500 then
    raise exception using errcode = '22023', message = 'valid project filter required';
  end if;
  month_end := (p_month + interval '1 month - 1 day')::date;
  select coalesce(jsonb_agg(jsonb_build_object(
      'projectName', btrim(row.project_name),
      'workDate', row.work_date,
      'employeeNumber', btrim(coalesce(row.employee_number, '')),
      'employeeName', btrim(coalesce(row.employee_name, '')),
      'attendanceUnits', row.attendance_units,
      'amount', row.amount,
      'accountingStatus', row.accounting_status,
      'source', row.source
    ) order by row.work_date, row.project_id, row.employee_number, row.source_key), '[]'::jsonb)
    into result
    from private.attendance_official_project_rows() row
    where row.work_date >= p_month and row.work_date <= month_end
      and (normalized_project_id is null or row.project_id = normalized_project_id)
      and (p_employee_profile_id is null
        or row.employee_profile_id = p_employee_profile_id);
  return result;
end;
$$;

revoke all on function public.export_project_labor_costs_secure(
  date, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.export_project_labor_costs_secure(
  date, text, uuid
) to authenticated, service_role;

create or replace function public.get_attendance_accounting_bridge_secure(
  p_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  effective_from date;
  is_authoritative boolean := false;
  salary_total numeric := 0;
  project_labor_total numeric := 0;
  project_labor_by_id jsonb := '{}'::jsonb;
  project_labor_lifetime_total numeric := 0;
  project_labor_lifetime_by_id jsonb := '{}'::jsonb;
  pending_count integer := 0;
  month_end date;
begin
  actor := private.current_attendance_accountant();
  if not public.has_current_permission('sensitive.salary_view')
      or not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501',
      message = 'salary and project cost view permissions required';
  end if;
  if p_month is null or not isfinite(p_month) then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  if not private.attendance_valid_business_date(p_month) then
    raise exception using
      errcode = '22023',
      message = 'salary month must be between 1900-01-01 and 2100-12-31';
  end if;
  if p_month <> date_trunc('month', p_month)::date then
    raise exception using
      errcode = '22023', message = 'salary month must be a finite month-first date';
  end if;
  month_end := (p_month + interval '1 month - 1 day')::date;
  select settings.effective_from into effective_from
  from public.attendance_accounting_settings settings
  where settings.settings_key = 'default';
  is_authoritative := effective_from is not null
    and p_month >= date_trunc('month', effective_from)::date;

  if is_authoritative then
    select private.attendance_require_safe_aggregate(
        coalesce(sum(payroll.net_salary), 0)
      )
      into salary_total
      from public.attendance_monthly_payrolls payroll
      where payroll.salary_month = p_month
        and payroll.status = 'confirmed';
  else
    select private.attendance_require_safe_aggregate(coalesce(sum(
        (parsed.value->>'netSalary')::numeric
      ), 0))
      into salary_total
      from public.salary_records record
      cross join lateral (
        select private.attendance_legacy_salary_json(record.payload) value
      ) parsed
      where record.status = 'active'
        and parsed.value is not null
        and parsed.value->>'salaryMonth' = to_char(p_month, 'YYYY-MM');
  end if;

  select private.attendance_require_safe_aggregate(
        coalesce(sum(project.amount), 0)
      ),
      coalesce(jsonb_object_agg(
        project.project_id, project.amount order by project.project_id
      ), '{}'::jsonb)
    into project_labor_total, project_labor_by_id
    from (
      select row.project_id,
        private.attendance_require_safe_aggregate(sum(row.amount)) amount
      from private.attendance_official_project_rows() row
      where row.work_date >= p_month and row.work_date <= month_end
      group by row.project_id
    ) project;

  select private.attendance_require_safe_aggregate(
        coalesce(sum(project.amount), 0)
      ),
      coalesce(jsonb_object_agg(
        project.project_id, project.amount order by project.project_id
      ), '{}'::jsonb)
    into project_labor_lifetime_total, project_labor_lifetime_by_id
    from (
      select row.project_id,
        private.attendance_require_safe_aggregate(sum(row.amount)) amount
      from private.attendance_official_project_rows() row
      group by row.project_id
    ) project;

  if is_authoritative then
    select coalesce(sum(
        (private.attendance_month_counts(employee.id, p_month)
          ->>'pendingDays')::integer
      ), 0)::integer
      into pending_count
      from public.employee_profiles employee
      where employee.deleted_at is null
        and not employee.is_hidden_system_account
        and employee.employee_number <> 'SW-000'
        and exists (
          select 1
          from generate_series(
            p_month::timestamp, month_end::timestamp, interval '1 day'
          ) generated(day_value)
          where private.attendance_employee_is_eligible(
            employee.id, generated.day_value::date
          )
        );
  end if;

  return jsonb_build_object(
    'salaryMonth', to_char(p_month, 'YYYY-MM'),
    'isAuthoritative', is_authoritative,
    'salaryTotal', salary_total,
    'projectLaborTotal', project_labor_total,
    'projectLaborById', project_labor_by_id,
    'projectLaborLifetimeTotal', project_labor_lifetime_total,
    'projectLaborLifetimeById', project_labor_lifetime_by_id,
    'pendingCount', pending_count,
    'effectiveFrom', effective_from
  );
end;
$$;

revoke all on function public.get_attendance_accounting_bridge_secure(date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_attendance_accounting_bridge_secure(date)
  to authenticated, service_role;

alter table public.attendance_accounting_settings enable row level security;
alter table public.attendance_accounting_settings force row level security;
alter table public.attendance_day_resolutions enable row level security;
alter table public.attendance_day_resolutions force row level security;
alter table public.attendance_project_allocations enable row level security;
alter table public.attendance_project_allocations force row level security;
alter table public.attendance_monthly_payrolls enable row level security;
alter table public.attendance_monthly_payrolls force row level security;
alter table public.attendance_accounting_audit_log enable row level security;
alter table public.attendance_accounting_audit_log force row level security;

revoke all on table
  public.attendance_accounting_settings,
  public.attendance_day_resolutions,
  public.attendance_project_allocations,
  public.attendance_monthly_payrolls,
  public.attendance_accounting_audit_log
from public, anon, authenticated, service_role;

grant select on table
  public.attendance_accounting_settings,
  public.attendance_day_resolutions,
  public.attendance_project_allocations,
  public.attendance_monthly_payrolls,
  public.attendance_accounting_audit_log
to service_role;

commit;

-- ---------------------------------------------------------------------------
-- Review snapshot: 202608090001_project_cost_ledger.sql
-- ---------------------------------------------------------------------------
-- The executable, transaction-wrapped definition is maintained in
-- supabase/migrations/202608090001_project_cost_ledger.sql. Its public schema
-- contract is recorded here so this review snapshot stays searchable without
-- pretending to be the ordered migration bootstrap:
--
--   public.project_cost_manual_entries
--     id uuid primary key; immutable full manual:<uuid> source_key;
--     project/category/date;
--     signed original_amount numeric(18,4); description/operator/creator and
--     a server timestamp.
--
--   public.project_cost_adjustment_events
--     source_key + sequence_no unique; amount_before, adjustment_amount and
--     amount_after numeric(18,4); reason; server actor and timestamp.
--
--   public.project_cost_allocation_events
--     source_key + sequence_no unique; amount_snapshot numeric(18,4);
--     allocations jsonb; reason; server actor and timestamp.
--
-- All three tables enable and force RLS, expose no direct browser/service-role
-- table privileges, reject UPDATE/DELETE/TRUNCATE, and are reachable only via
-- closed SECURITY DEFINER functions. The private stable typed union is:
--
--   private.private_project_cost_source_facts()
--     -> (source_key, source_module, source_document_type,
--         source_document_id, project_id, project_name, category, cost_date,
--         description, original_amount numeric(18,4), operator)
--
-- The authenticated/service-role read boundary is:
--
--   public.list_project_cost_ledger_secure(p_filters jsonb default '{}')
--     -> jsonb
--
-- It requires an active employee plus module.project_costs.view, validates the
-- closed filter set, applies the latest adjustment/allocation, emits one row
-- per final project allocation, summarizes before pagination, and returns the
-- exact normalizeLedgerSnapshot() JSON shape. Both the public RPC and private
-- source helper are SECURITY DEFINER with an empty fixed search_path.
--
-- The source union normalizes text with the ECMAScript trim character set.
-- Invalid optional display text falls back to empty without losing the amount;
-- invalid required identity/category text is excluded from rows and surfaced by
-- a safe incompleteSources key. Warehouse purchase de-duplication is derived
-- only from the same strictly validated WAREHOUSE-SO/MWO/SR/WR facts (identity,
-- type, costRecordId, UUID provenance arrays, project/date/amount).
-- A valid zero-value MWO still contributes authoritative purchase keys, while
-- warehouse row emission filters the zero amount.
-- Summary and category totals fail with SQLSTATE 22003 outside
-- +/-900719925474.0991, and
-- pagination numbers must be mathematically integral before integer conversion.

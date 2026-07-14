begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(68);

create temporary table task2_business_tables (
  table_name text primary key
) on commit drop;

insert into task2_business_tables (table_name) values
  ('project_contract_changes'),
  ('project_payment_plans'),
  ('project_receipts'),
  ('labor_records'),
  ('purchase_records'),
  ('purchase_payment_records'),
  ('inventory_items'),
  ('stock_in_records'),
  ('stock_out_records'),
  ('stock_return_records'),
  ('tool_records'),
  ('tool_borrow_records'),
  ('tool_return_records'),
  ('lifelong_tool_assignments'),
  ('tool_responsibility_records'),
  ('vehicle_records'),
  ('vehicle_usage_records'),
  ('fuel_records'),
  ('vehicle_expense_records'),
  ('vehicle_issue_records'),
  ('salary_records'),
  ('project_cost_records'),
  ('operating_expense_records');

select has_table('public', 'employee_profiles', 'employee_profiles exists');
select has_table('public', 'employee_provisioning_requests', 'provisioning requests exist');
select has_table('public', 'permission_grants', 'permission grants exist');
select has_table('public', 'auth_login_attempts', 'login attempts exist');
select has_table('public', 'employee_security_audit', 'security audit exists');
select has_sequence('public', 'employee_number_sequence', 'employee sequence exists');

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'employees'
  ),
  0::bigint,
  'legacy employees retains no policies, including unknown policy names'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    join task2_business_tables as business
      on business.table_name = policy.tablename
    where policy.schemaname = 'public'
  ),
  69::bigint,
  'direct-RLS business tables retain exactly 69 whitelisted policies'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'projects'
  ),
  0::bigint,
  'projects retains zero policies because access is RPC-only'
);
select ok(
  (
    select count(*) = 23 and bool_and(policy_count = 3)
    from (
      select business.table_name, count(policy.policyname) as policy_count
      from task2_business_tables as business
      left join pg_catalog.pg_policies as policy
        on policy.schemaname = 'public'
        and policy.tablename = business.table_name
      group by business.table_name
    ) as policy_counts
  ),
  'every mapped business table has exactly three policies'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    join task2_business_tables as business
      on business.table_name = policy.tablename
    where policy.schemaname = 'public'
      and policy.cmd = 'SELECT'
  ),
  23::bigint,
  'every direct-RLS business table has one SELECT policy'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    join task2_business_tables as business
      on business.table_name = policy.tablename
    where policy.schemaname = 'public'
      and policy.cmd = 'INSERT'
  ),
  23::bigint,
  'every direct-RLS business table has one INSERT policy'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    join task2_business_tables as business
      on business.table_name = policy.tablename
    where policy.schemaname = 'public'
      and policy.cmd = 'UPDATE'
  ),
  23::bigint,
  'every direct-RLS business table has one UPDATE policy'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    join task2_business_tables as business
      on business.table_name = policy.tablename
    where policy.schemaname = 'public'
      and policy.cmd not in ('SELECT', 'INSERT', 'UPDATE')
  ),
  0::bigint,
  'business policy commands are exactly SELECT, INSERT, and UPDATE'
);
select is(
  (
    select count(*)
    from pg_catalog.pg_policies as policy
    join task2_business_tables as business
      on business.table_name = policy.tablename
    where policy.schemaname = 'public'
      and policy.policyname not in (
        policy.tablename || ' authenticated select',
        policy.tablename || ' authenticated insert',
        policy.tablename || ' authenticated update'
      )
  ),
  0::bigint,
  'business tables retain no unknown policy names'
);
select ok(
  (
    select bool_and(
      not has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE')
    )
    from task2_business_tables
  ),
  'authenticated has no physical DELETE privilege on any business table'
);
select ok(
  (
    select bool_and(
      not has_table_privilege('authenticated', format('public.%I', table_name), 'TRUNCATE')
    )
    from task2_business_tables
  ),
  'authenticated has no TRUNCATE privilege on any business table'
);

alter sequence public.employee_number_sequence restart with 1;
truncate table public.employee_provisioning_requests;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select is(
  public.reserve_employee_number('10000000-0000-0000-0000-000000000001'::uuid),
  'SW-001'::text,
  'SW-001 is the first normal employee number'
);
select is(
  public.reserve_employee_number('10000000-0000-0000-0000-000000000001'::uuid),
  'SW-001'::text,
  'the same request id returns the same employee number'
);
select is(
  public.reserve_employee_number('10000000-0000-0000-0000-000000000002'::uuid),
  'SW-002'::text,
  'a second request receives the next number'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.reserve_employee_number('10000000-0000-0000-0000-000000000003'::uuid)$$,
  '42501',
  'permission denied for function reserve_employee_number',
  'authenticated cannot reserve employee numbers'
);

reset role;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'employee-1@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'president@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'disabled@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'must-change@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'sw000@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'former@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

set local role service_role;

insert into public.employee_profiles (
  id,
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account,
  passport_number,
  base_salary
) values
  ('30000000-0000-0000-0000-000000000001', 'SW-001', '20000000-0000-0000-0000-000000000001', '权限员工', '工程部', '设计师', '在职', 'active', false, false, 'P-SECRET', 420000),
  ('30000000-0000-0000-0000-000000000002', 'SW-002', '20000000-0000-0000-0000-000000000002', '社长员工', '总务部', '社长', '在职', 'active', false, false, null, null),
  ('30000000-0000-0000-0000-000000000003', 'SW-003', '20000000-0000-0000-0000-000000000003', '停用员工', '工程部', '设计师', '在职', 'disabled', false, false, null, null),
  ('30000000-0000-0000-0000-000000000004', 'SW-004', '20000000-0000-0000-0000-000000000004', '待改密员工', '工程部', '设计师', '在职', 'active', true, false, null, null),
  ('30000000-0000-0000-0000-000000000005', 'SW-000', '20000000-0000-0000-0000-000000000005', '隐藏管理员', '总务部', '社长', '在职', 'active', false, true, null, null),
  ('30000000-0000-0000-0000-000000000006', 'SW-005', '20000000-0000-0000-0000-000000000006', '离职员工', '工程部', '设计师', '离职', 'active', false, false, null, null);

select throws_ok(
  $$delete from public.employee_profiles where employee_number = 'SW-000'$$,
  '23514',
  'SW-000 cannot be deleted',
  'SW-000 cannot be deleted'
);
select throws_ok(
  $$update public.employee_profiles
    set is_hidden_system_account = false
    where employee_number = 'SW-000'$$,
  '23514',
  'SW-000 security state cannot be changed',
  'SW-000 hidden state cannot be changed'
);
select throws_ok(
  $$update public.employee_profiles
    set account_status = 'disabled'
    where employee_number = 'SW-000'$$,
  '23514',
  'SW-000 security state cannot be changed',
  'SW-000 active state cannot be changed'
);
select throws_ok(
  $$update public.employee_profiles
    set deleted_at = now()
    where employee_number = 'SW-000'$$,
  '23514',
  'SW-000 security state cannot be changed',
  'SW-000 cannot be soft-deleted'
);
select throws_ok(
  $$update public.employee_profiles
    set employment_status = '离职'
    where employee_number = 'SW-000'$$,
  '23514',
  'SW-000 security state cannot be changed',
  'SW-000 employment state cannot be changed'
);

select throws_like(
  $$insert into public.employee_profiles (employee_number, name, department, position)
    values ('SW-900', '非法部门', '现场', '设计师')$$,
  '%violates check constraint%',
  'department values are fixed'
);
select throws_like(
  $$insert into public.employee_profiles (employee_number, name, department, position)
    values ('SW-901', '非法职位', '工程部', '操作员')$$,
  '%violates check constraint%',
  'position values are fixed'
);
select throws_ok(
  $$update public.employee_profiles set employee_number = 'SW-099'
    where employee_number = 'SW-001'$$,
  '23514',
  'employee_number cannot be changed',
  'employee number is immutable'
);

insert into public.permission_grants (subject_type, subject_code, permission_key) values
  ('department', '工程部', 'module.projects.view'),
  ('position', '设计师', 'module.projects.update'),
  ('department', '工程部', 'module.salaries.view'),
  ('department', '工程部', 'module.labor.view'),
  ('department', '工程部', 'module.labor.update'),
  ('department', '工程部', 'module.purchases.view'),
  ('department', '工程部', 'module.purchases.update');

select throws_like(
  $$insert into public.permission_grants (subject_type, subject_code, permission_key)
    values ('department', '工程部', 'module.unknown.view')$$,
  '%violates check constraint%',
  'an unknown permission key is rejected'
);
select throws_like(
  $$insert into public.permission_grants (subject_type, subject_code, permission_key)
    values ('department', '工程部', 'all')$$,
  '%violates check constraint%',
  'the all permission key is rejected from templates'
);

insert into public.projects (record_key, payload, status)
values ('PROJECT-RLS-1', '{"projectId":"PROJECT-RLS-1"}'::jsonb, 'active');
insert into public.salary_records (record_key, payload, status)
values ('SALARY-RLS-1', '{"employeeNumber":"SW-001","amount":420000}'::jsonb, 'active');
insert into public.labor_records (record_key, payload, status)
values ('LABOR-RLS-1', '{"employeeNumber":"SW-001","laborCost":420000}'::jsonb, 'active');
insert into public.purchase_records (record_key, payload, status)
values ('PURCHASE-RLS-1', '{"purchaseId":"PURCHASE-RLS-1","paidAmount":120000}'::jsonb, 'active');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);

select ok(
  public.has_current_permission('module.projects.view'),
  'permission union includes the department grant'
);
select ok(
  public.has_current_permission('module.projects.update'),
  'permission union includes the position grant'
);
select ok(
  (
    select "effectivePermissionKeys" @> array[
      'module.projects.view',
      'module.projects.update'
    ]::text[]
    from public.current_employee_profile()
  ),
  'current profile returns the effective permission union'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select ok(
  public.has_current_permission('module.employees.update'),
  'an active president receives fixed employee management'
);
select ok(
  public.has_current_permission('module.permission_templates.update'),
  'an active president receives fixed permission template management'
);
select ok(
  not public.has_current_permission('module.projects.view'),
  'a president receives no unrelated business permission automatically'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000005', true);
select ok(
  public.has_current_permission('module.projects.delete'),
  'SW-000 bypasses permission templates'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*) from public.employee_directory() where "employeeNumber" = 'SW-000'),
  0::bigint,
  'SW-000 is hidden from the employee directory'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select ok(not public.is_current_employee_active(), 'a disabled employee is inactive');
select ok(
  not public.has_current_permission('module.projects.view'),
  'a disabled employee has no effective permission'
);
select is(
  (select count(*) from public.employee_directory()),
  0::bigint,
  'a disabled employee cannot read the employee directory'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000004', true);
select ok(
  not public.is_current_employee_active(),
  'must change password blocks business access'
);

select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000006', true);
select ok(not public.is_current_employee_active(), 'a former employee is inactive');
select ok(
  not public.has_current_permission('module.projects.view'),
  'a former employee has no effective permission'
);
select throws_like(
  $$select * from public.projects$$,
  '%permission denied for table projects%',
  'a former employee cannot bypass RPC-only project access'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $$select * from public.employee_directory()$$,
  '%permission denied for function employee_directory%',
  'anon cannot call the employee directory'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select throws_like(
  $$select * from public.employees$$,
  '%permission denied for table employees%',
  'authenticated users cannot query the legacy employees table'
);

select ok(
  not (
    select to_jsonb(current_profile) ?| array[
      'authUserId', 'auth_user_id', 'passportNumber', 'baseSalary', 'wecomUserId'
    ]
    from public.current_employee_profile() as current_profile
  ),
  'current profile exposes only safe current-user fields'
);
select ok(
  not public.employee_profile_detail('30000000-0000-0000-0000-000000000001')
    ?| array['passportNumber', 'baseSalary'],
  'employee detail omits identity and salary without sensitive grants'
);
select throws_like(
  $$select * from public.projects where record_key = 'PROJECT-RLS-1'$$,
  '%permission denied for table projects%',
  'module access alone never enables direct project reads'
);
select is(
  (select count(*) from public.salary_records where record_key = 'SALARY-RLS-1'),
  0::bigint,
  'module access alone cannot read salary records'
);
select is(
  (select count(*) from public.labor_records where record_key = 'LABOR-RLS-1'),
  0::bigint,
  'module access alone cannot read labor pay records'
);
select is(
  (select count(*) from public.purchase_records where record_key = 'PURCHASE-RLS-1'),
  0::bigint,
  'module access alone cannot read purchase payment records'
);
select results_eq(
  $$with changed as (
      update public.labor_records
      set payload = payload || '{"reviewed":true}'::jsonb
      where record_key = 'LABOR-RLS-1'
      returning 1
    )
    select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'module update alone cannot change labor pay records'
);
select results_eq(
  $$with changed as (
      update public.purchase_records
      set payload = payload || '{"reviewed":true}'::jsonb
      where record_key = 'PURCHASE-RLS-1'
      returning 1
    )
    select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'module update alone cannot change purchase payment records'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.permission_grants (subject_type, subject_code, permission_key) values
  ('department', '工程部', 'sensitive.employee_identity_view'),
  ('department', '工程部', 'sensitive.salary_view'),
  ('department', '工程部', 'sensitive.salary_update'),
  ('department', '工程部', 'sensitive.purchase_payments_view'),
  ('department', '工程部', 'sensitive.purchase_payments_update'),
  ('department', '工程部', 'sensitive.contract_amount_view'),
  ('department', '工程部', 'sensitive.contract_amount_update');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select ok(
  public.employee_profile_detail('30000000-0000-0000-0000-000000000001')
    ?& array['passportNumber', 'baseSalary'],
  'authorized detail conditionally includes sensitive fields'
);
select is(
  (select count(*) from public.salary_records where record_key = 'SALARY-RLS-1'),
  1::bigint,
  'salary view requires both module and sensitive permission'
);
select is(
  (select count(*) from public.labor_records where record_key = 'LABOR-RLS-1'),
  1::bigint,
  'labor pay view requires both module and sensitive permission'
);
select is(
  (select count(*) from public.purchase_records where record_key = 'PURCHASE-RLS-1'),
  1::bigint,
  'purchase payment view requires both module and sensitive permission'
);
select results_eq(
  $$with changed as (
      update public.labor_records
      set payload = payload || '{"reviewed":true}'::jsonb
      where record_key = 'LABOR-RLS-1'
      returning 1
    )
    select count(*)::bigint from changed$$,
  $$values (1::bigint)$$,
  'labor pay update requires both module and sensitive permission'
);
select results_eq(
  $$with changed as (
      update public.purchase_records
      set payload = payload || '{"reviewed":true}'::jsonb
      where record_key = 'PURCHASE-RLS-1'
      returning 1
    )
    select count(*)::bigint from changed$$,
  $$values (1::bigint)$$,
  'purchase payment update requires both module and sensitive permission'
);

select throws_like(
  $$select * from public.projects where record_key = 'PROJECT-RLS-1'$$,
  '%permission denied for table projects%',
  'sensitive template grants do not restore direct project reads'
);
select throws_like(
  $$update public.projects set status = 'deleted' where record_key = 'PROJECT-RLS-1'$$,
  '%permission denied for table projects%',
  'module update permission does not restore direct project writes'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.permission_grants (subject_type, subject_code, permission_key)
values ('department', '工程部', 'module.projects.delete');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select throws_like(
  $$update public.projects set status = 'deleted' where record_key = 'PROJECT-RLS-1'$$,
  '%permission denied for table projects%',
  'delete permission still requires the project soft-delete RPC'
);
select throws_like(
  $$delete from public.projects where record_key = 'PROJECT-RLS-1'$$,
  '%permission denied for table projects%',
  'authenticated users cannot hard-delete business records'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $$select * from public.projects$$,
  '%permission denied for table projects%',
  'anon cannot read business tables'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select throws_like(
  $$select * from public.projects$$,
  '%permission denied for table projects%',
  'a disabled employee cannot bypass RPC-only project access'
);

select * from finish();
rollback;

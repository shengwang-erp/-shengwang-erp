begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(40);

select has_table('public', 'employee_profiles', 'employee_profiles exists');
select has_table('public', 'employee_provisioning_requests', 'provisioning requests exist');
select has_table('public', 'permission_grants', 'permission grants exist');
select has_table('public', 'auth_login_attempts', 'login attempts exist');
select has_table('public', 'employee_security_audit', 'security audit exists');
select has_sequence('public', 'employee_number_sequence', 'employee sequence exists');

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
  ('00000000-0000-0000-0000-000000000000', '20000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'sw000@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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
  ('30000000-0000-0000-0000-000000000005', 'SW-000', '20000000-0000-0000-0000-000000000005', '隐藏管理员', '总务部', '社长', '在职', 'active', false, true, null, null);

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
  ('department', '工程部', 'module.salaries.view');

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
select is(
  (select count(*) from public.projects where record_key = 'PROJECT-RLS-1'),
  0::bigint,
  'module access alone cannot read contract amount records'
);
select is(
  (select count(*) from public.salary_records where record_key = 'SALARY-RLS-1'),
  0::bigint,
  'module access alone cannot read salary records'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into public.permission_grants (subject_type, subject_code, permission_key) values
  ('department', '工程部', 'sensitive.employee_identity_view'),
  ('department', '工程部', 'sensitive.salary_view'),
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
  (select count(*) from public.projects where record_key = 'PROJECT-RLS-1'),
  1::bigint,
  'an active employee with view permission can read a mapped business table'
);
select throws_ok(
  $$update public.projects set status = 'deleted' where record_key = 'PROJECT-RLS-1'$$,
  '42501',
  'delete permission required',
  'update permission cannot perform a soft delete'
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
select lives_ok(
  $$update public.projects set status = 'deleted' where record_key = 'PROJECT-RLS-1'$$,
  'delete permission allows a soft delete'
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
select is(
  (select count(*) from public.projects),
  0::bigint,
  'a disabled employee is denied by business-table RLS'
);

select * from finish();
rollback;

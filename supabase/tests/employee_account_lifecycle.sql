begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(60);

select has_table(
  'public',
  'employee_password_reset_requests',
  'password reset fencing has dedicated server-only state'
);

select has_column(
  'public',
  'employee_provisioning_requests',
  'owner_token',
  'provisioning requests store an ephemeral owner token'
);
select has_column(
  'public',
  'employee_provisioning_requests',
  'owner_expires_at',
  'provisioning ownership has a bounded lease'
);
select has_column(
  'public',
  'employee_provisioning_requests',
  'auth_user_id_snapshot',
  'Auth ownership survives FK cleanup'
);
select has_column(
  'public',
  'employee_provisioning_requests',
  'employee_profile_id',
  'completed provisioning links the stable profile'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.claim_employee_provisioning(uuid,uuid)',
    'EXECUTE'
  ),
  'service_role can claim provisioning'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_employee_provisioning(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot claim provisioning'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_employee_provisioning(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'service_role can atomically complete provisioning'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_employee_provisioning(uuid,uuid,uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot complete provisioning'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_employee_profile_admin(uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'service_role can administer employee profiles'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_employee_profile_admin(uuid,jsonb,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot call the administration RPC'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.claim_employee_provisioning(
      '51000000-0000-4000-8000-000000000001'::uuid,
      '52000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  'service_role required',
  'claim also guards its execution context'
);

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
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task5-actor@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task5-created@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'task5-cleanup@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'task5-adopted@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'task5-admin-target@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'task5-sw000@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'task5-non-admin@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'task5-president-no-sensitive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'task5-null-adoption@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'task5-other-adoption@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '53000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'task5-revoke-failure@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles (
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account
) values
  ('SW-9001', '53000000-0000-4000-8000-000000000001', '授权社长', '总务部', '社长', '在职', 'active', false, false),
  ('SW-9002', '53000000-0000-4000-8000-000000000007', '普通员工', '工程部', '设计师', '在职', 'active', false, false),
  ('SW-9003', '53000000-0000-4000-8000-000000000008', '无敏感权限社长', '营业部', '社长', '在职', 'active', false, false);

insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
) values
  ('department', '总务部', 'sensitive.employee_identity_update'),
  ('department', '总务部', 'sensitive.salary_update');

create temporary table task5_json_results (
  scenario text primary key,
  value jsonb not null
) on commit drop;
create temporary table task5_boolean_results (
  scenario text primary key,
  value boolean not null
) on commit drop;
grant all on table task5_json_results, task5_boolean_results to service_role;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select public.reserve_employee_number(
  '51000000-0000-4000-8000-000000000001'::uuid
);
insert into task5_json_results values (
  'initial claim',
  public.claim_employee_provisioning(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task5_json_results values (
  'concurrent claim',
  public.claim_employee_provisioning(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000002'::uuid
  )
);
insert into task5_boolean_results values (
  'renew current owner',
  public.renew_employee_provisioning_owner(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000001'::uuid,
    'reserved',
    null
  )
);
insert into task5_boolean_results values (
  'reject stale owner renewal',
  public.renew_employee_provisioning_owner(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000002'::uuid,
    'reserved',
    null
  )
);
insert into task5_boolean_results values (
  'record auth',
  public.record_employee_provisioning_auth(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000001'::uuid,
    '53000000-0000-4000-8000-000000000002'::uuid
  )
);
insert into task5_json_results values (
  'complete',
  public.complete_employee_provisioning(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000001'::uuid,
    '53000000-0000-4000-8000-000000000002'::uuid,
    '{"name":"新员工","department":"工程部","position":"小工","passportNumber":"PRIVATE","baseSalary":250000}'::jsonb,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task5_json_results values (
  'completed replay',
  public.claim_employee_provisioning(
    '51000000-0000-4000-8000-000000000001'::uuid,
    '52000000-0000-4000-8000-000000000003'::uuid
  )
);

reset role;

select ok(
  (select (value->>'employeeNumber') ~ '^SW-[0-9]{3,}$'
     and value->>'employeeNumber' <> 'SW-000'
   from task5_json_results where scenario = 'initial claim'),
  'the reserved number is a normal SW employee number'
);
select ok(
  (select (value->>'ownerAcquired')::boolean and value->>'status' = 'reserved'
   from task5_json_results where scenario = 'initial claim'),
  'the first caller owns the reserved request'
);
select ok(
  not (select (value->>'ownerAcquired')::boolean
       from task5_json_results where scenario = 'concurrent claim'),
  'a concurrent owner cannot perform Auth work'
);
select ok(
  (select value from task5_boolean_results where scenario = 'renew current owner'),
  'the current owner renews its lease immediately before an Auth side effect'
);
select ok(
  not (select value from task5_boolean_results where scenario = 'reject stale owner renewal'),
  'a stale owner cannot renew before an Auth side effect'
);
select ok(
  (select value from task5_boolean_results where scenario = 'record auth'),
  'the exact owner records the created Auth id'
);
select is(
  (select value->>'employeeNumber' from task5_json_results where scenario = 'complete'),
  (select employee_number from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000001'),
  'atomic completion returns the reserved employee number'
);
select is(
  (select account_status from public.employee_profiles
   where auth_user_id = '53000000-0000-4000-8000-000000000002'),
  'active'::text,
  'provisioning sets active account state server-side'
);
select ok(
  (select must_change_password from public.employee_profiles
   where auth_user_id = '53000000-0000-4000-8000-000000000002'),
  'provisioning requires a temporary-password change'
);
select ok(
  not (select is_hidden_system_account from public.employee_profiles
       where auth_user_id = '53000000-0000-4000-8000-000000000002'),
  'provisioning cannot create a hidden account'
);
select is(
  (select status from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000001'),
  'completed'::text,
  'the request is completed only with the profile'
);
select ok(
  exists (
    select 1 from public.employee_security_audit
    where actor_auth_user_id = '53000000-0000-4000-8000-000000000001'
      and action = 'employee.provisioned'
  ),
  'provisioning writes a server-attributed audit event'
);
select ok(
  (select value->>'status' = 'completed'
     and not (value->>'ownerAcquired')::boolean
     and value ? 'employee'
   from task5_json_results where scenario = 'completed replay'),
  'a completed replay returns the stable employee without ownership'
);
select ok(
  (select owner_token is null and owner_expires_at is null
   from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000001'),
  'completion clears the provisioning lease'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'employee_provisioning_requests',
        'employee_password_reset_requests'
      )
      and column_name ~* 'password'
  ),
  'provisioning and reset fencing state contain no password column'
);

set local role service_role;
select public.reserve_employee_number(
  '51000000-0000-4000-8000-000000000002'::uuid
);
select public.claim_employee_provisioning(
  '51000000-0000-4000-8000-000000000002'::uuid,
  '52000000-0000-4000-8000-000000000010'::uuid
);
select public.record_employee_provisioning_auth(
  '51000000-0000-4000-8000-000000000002'::uuid,
  '52000000-0000-4000-8000-000000000010'::uuid,
  '53000000-0000-4000-8000-000000000003'::uuid
);
reset role;
update public.employee_provisioning_requests
  set owner_expires_at = now() - interval '1 second'
  where request_id = '51000000-0000-4000-8000-000000000002';
set local role service_role;
insert into task5_json_results values (
  'auth-created retry',
  public.claim_employee_provisioning(
    '51000000-0000-4000-8000-000000000002'::uuid,
    '52000000-0000-4000-8000-000000000011'::uuid
  )
);
insert into task5_json_results values (
  'prepare cleanup',
  public.prepare_employee_provisioning_compensation(
    '51000000-0000-4000-8000-000000000002'::uuid,
    '52000000-0000-4000-8000-000000000011'::uuid,
    '53000000-0000-4000-8000-000000000003'::uuid,
    'PROFILE_INSERT_FAILED'
  )
);
insert into task5_boolean_results values (
  'cleanup before delete',
  public.complete_employee_provisioning_compensation(
    '51000000-0000-4000-8000-000000000002'::uuid,
    '52000000-0000-4000-8000-000000000011'::uuid,
    '53000000-0000-4000-8000-000000000003'::uuid
  )
);
reset role;

select ok(
  (select (value->>'ownerAcquired')::boolean
     and value->>'status' = 'auth_created'
     and value->>'authUserId' = '53000000-0000-4000-8000-000000000003'
   from task5_json_results where scenario = 'auth-created retry'),
  'an expired auth_created lease is safely resumable'
);
select ok(
  (select (value->>'cleanupAllowed')::boolean
   from task5_json_results where scenario = 'prepare cleanup'),
  'the exact owner can prepare compensation when no profile adopted Auth'
);
select is(
  (select status from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000002'),
  'compensation_pending'::text,
  'compensation is persisted before Auth deletion'
);
select ok(
  not (select value from task5_boolean_results where scenario = 'cleanup before delete'),
  'compensation cannot complete while the Auth user still exists'
);

delete from auth.users where id = '53000000-0000-4000-8000-000000000003';
set local role service_role;
insert into task5_boolean_results values (
  'cleanup after delete',
  public.complete_employee_provisioning_compensation(
    '51000000-0000-4000-8000-000000000002'::uuid,
    '52000000-0000-4000-8000-000000000011'::uuid,
    '53000000-0000-4000-8000-000000000003'::uuid
  )
);
reset role;
select ok(
  (select value from task5_boolean_results where scenario = 'cleanup after delete'),
  'compensation completes after Auth deletion'
);
select is(
  (select status from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000002'),
  'compensated'::text,
  'the cleaned request remains recoverable for a later retry'
);

set local role service_role;
select public.reserve_employee_number(
  '51000000-0000-4000-8000-000000000003'::uuid
);
select public.claim_employee_provisioning(
  '51000000-0000-4000-8000-000000000003'::uuid,
  '52000000-0000-4000-8000-000000000020'::uuid
);
select public.record_employee_provisioning_auth(
  '51000000-0000-4000-8000-000000000003'::uuid,
  '52000000-0000-4000-8000-000000000020'::uuid,
  '53000000-0000-4000-8000-000000000004'::uuid
);
reset role;
insert into public.employee_profiles (
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account
)
select
  request.employee_number,
  '53000000-0000-4000-8000-000000000004'::uuid,
  '并发接管员工',
  '设计部',
  '设计师',
  '在职',
  'active',
  true,
  false
from public.employee_provisioning_requests as request
where request.request_id = '51000000-0000-4000-8000-000000000003';
set local role service_role;
insert into task5_json_results values (
  'adoption race',
  public.prepare_employee_provisioning_compensation(
    '51000000-0000-4000-8000-000000000003'::uuid,
    '52000000-0000-4000-8000-000000000020'::uuid,
    '53000000-0000-4000-8000-000000000004'::uuid,
    'PROFILE_INSERT_FAILED'
  )
);
reset role;

select ok(
  (select not (value->>'cleanupAllowed')::boolean and value ? 'employee'
   from task5_json_results where scenario = 'adoption race'),
  'compensation detects an adopted profile and forbids Auth deletion'
);
select is(
  (select status from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000003'),
  'completed'::text,
  'an adopted profile repairs the request to completed'
);

set local role service_role;
select public.reserve_employee_number(
  '51000000-0000-4000-8000-000000000004'::uuid
);
select public.claim_employee_provisioning(
  '51000000-0000-4000-8000-000000000004'::uuid,
  '52000000-0000-4000-8000-000000000030'::uuid
);
select public.record_employee_provisioning_auth(
  '51000000-0000-4000-8000-000000000004'::uuid,
  '52000000-0000-4000-8000-000000000030'::uuid,
  '53000000-0000-4000-8000-000000000009'::uuid
);
reset role;
insert into public.employee_profiles (
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account
)
select
  request.employee_number,
  null,
  '未绑定并发资料',
  '工程部',
  '小工',
  '在职',
  'active',
  true,
  false
from public.employee_provisioning_requests as request
where request.request_id = '51000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.complete_employee_provisioning(
      '51000000-0000-4000-8000-000000000004'::uuid,
      '52000000-0000-4000-8000-000000000030'::uuid,
      '53000000-0000-4000-8000-000000000009'::uuid,
      '{"name":"不可采用","department":"工程部","position":"小工"}'::jsonb,
      '53000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '23505',
  'employee profile ownership conflict',
  'completion rejects a reserved-number profile whose Auth link is NULL'
);
select is(
  (select status from public.employee_provisioning_requests
   where request_id = '51000000-0000-4000-8000-000000000004'),
  'auth_created'::text,
  'a rejected NULL-link adoption never marks provisioning completed'
);

set local role service_role;
select public.reserve_employee_number(
  '51000000-0000-4000-8000-000000000005'::uuid
);
select public.claim_employee_provisioning(
  '51000000-0000-4000-8000-000000000005'::uuid,
  '52000000-0000-4000-8000-000000000040'::uuid
);
select public.record_employee_provisioning_auth(
  '51000000-0000-4000-8000-000000000005'::uuid,
  '52000000-0000-4000-8000-000000000040'::uuid,
  '53000000-0000-4000-8000-000000000010'::uuid
);
reset role;
insert into public.employee_profiles (
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account
) values (
  'SW-9988',
  '53000000-0000-4000-8000-000000000010',
  '其他员工采用账号',
  '设计部',
  '设计师',
  '在职',
  'active',
  true,
  false
);
set local role service_role;
insert into task5_json_results values (
  'different profile adopted auth',
  public.prepare_employee_provisioning_compensation(
    '51000000-0000-4000-8000-000000000005'::uuid,
    '52000000-0000-4000-8000-000000000040'::uuid,
    '53000000-0000-4000-8000-000000000010'::uuid,
    'PROFILE_INSERT_FAILED'
  )
);
reset role;
select ok(
  not (select (value->>'cleanupAllowed')::boolean
       from task5_json_results where scenario = 'different profile adopted auth'),
  'pre-delete proof rejects Auth already linked to a different employee profile'
);

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
  is_hidden_system_account
) values
  ('54000000-0000-4000-8000-000000000001', 'SW-9900', '53000000-0000-4000-8000-000000000005', '管理目标', '工程部', '小工', '在职', 'active', false, false),
  ('54000000-0000-4000-8000-000000000002', 'SW-000', '53000000-0000-4000-8000-000000000006', '隐藏管理员', '总务部', '社长', '在职', 'active', false, true),
  ('54000000-0000-4000-8000-000000000003', 'SW-9901', '53000000-0000-4000-8000-000000000011', '撤销失败目标', '工程部', '小工', '在职', 'active', false, false);
set local role service_role;
insert into task5_json_results values (
  'admin target',
  public.get_employee_admin_target('54000000-0000-4000-8000-000000000001'::uuid)
);
insert into task5_json_results values (
  'profile update',
  public.update_employee_profile_admin(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '{"department":"设计部","position":"设计师"}'::jsonb,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;

select is(
  (select value->>'authUserId' from task5_json_results where scenario = 'admin target'),
  '53000000-0000-4000-8000-000000000005'::text,
  'the internal target lookup returns only the exact linked Auth id'
);
select ok(
  (select value->>'department' = '设计部' and value->>'position' = '设计师'
   from task5_json_results where scenario = 'profile update')
  and (select employee_number = 'SW-9900'
       from public.employee_profiles
       where id = '54000000-0000-4000-8000-000000000001'),
  'profile update changes fixed department and position without changing the number'
);

select throws_ok(
  $$select public.update_employee_profile_admin(
      '54000000-0000-4000-8000-000000000001'::uuid,
      '{"employeeNumber":"SW-9999"}'::jsonb,
      '53000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'unsupported employee patch field',
  'the administration RPC rejects employee-number mutation'
);

insert into auth.sessions (id, user_id, created_at, updated_at) values (
  '55000000-0000-4000-8000-000000000003',
  '53000000-0000-4000-8000-000000000011',
  now(),
  now()
);
create function private.task5_force_session_revoke_failure()
returns trigger
language plpgsql
as $$
begin
  if old.user_id = '53000000-0000-4000-8000-000000000011'::uuid then
    raise exception 'forced revoke failure';
  end if;
  return old;
end;
$$;
create trigger task5_force_session_revoke_failure
before delete on auth.sessions
for each row execute function private.task5_force_session_revoke_failure();
set local role service_role;
insert into task5_json_results values (
  'disable revoke failure',
  public.disable_employee_account_admin(
    '54000000-0000-4000-8000-000000000003'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;
drop trigger task5_force_session_revoke_failure on auth.sessions;
drop function private.task5_force_session_revoke_failure();
select ok(
  not (select (value->>'sessionsRevoked')::boolean
       from task5_json_results where scenario = 'disable revoke failure'),
  'session-revoke failure is returned as a safe false result'
);
select is(
  (select account_status from public.employee_profiles
   where id = '54000000-0000-4000-8000-000000000003'),
  'disabled'::text,
  'session-revoke failure preserves the safer disabled database state'
);

insert into auth.sessions (id, user_id, created_at, updated_at) values (
  '55000000-0000-4000-8000-000000000001',
  '53000000-0000-4000-8000-000000000005',
  now(),
  now()
);
insert into auth.refresh_tokens (token, user_id, session_id, created_at, updated_at) values
  ('task5-linked-refresh-token', '53000000-0000-4000-8000-000000000005', '55000000-0000-4000-8000-000000000001', now(), now()),
  ('task5-legacy-refresh-token', '53000000-0000-4000-8000-000000000005', null, now(), now());
set local role service_role;
insert into task5_json_results values (
  'disabled',
  public.disable_employee_account_admin(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;
select is(
  (select value->'employee'->>'accountStatus'
   from task5_json_results where scenario = 'disabled'),
  'disabled'::text,
  'disable transitions the database profile before the Edge Auth ban'
);
select ok(
  (select (value->>'sessionsRevoked')::boolean
   from task5_json_results where scenario = 'disabled'),
  'disable confirms server-side Auth session revocation before Edge returns success'
);
select ok(
  not exists (
    select 1 from auth.sessions
    where user_id = '53000000-0000-4000-8000-000000000005'
  ) and not exists (
    select 1 from auth.refresh_tokens
    where token = 'task5-linked-refresh-token'
  ),
  'deleting the Auth session cascades its linked refresh token'
);
select ok(
  not exists (
    select 1 from auth.refresh_tokens
    where token = 'task5-legacy-refresh-token'
      and session_id is null
  ),
  'disable explicitly revokes a legacy refresh token without a session link'
);

select throws_ok(
  $$select public.activate_employee_account_admin(
      '54000000-0000-4000-8000-000000000001'::uuid,
      '53000000-0000-4000-8000-000000000099'::uuid,
      '53000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'employee target unavailable',
  'activation requires the exact Auth link'
);
set local role service_role;
insert into task5_json_results values (
  'activated',
  public.activate_employee_account_admin(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '53000000-0000-4000-8000-000000000005'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task5_json_results values (
  'password reset claim',
  public.claim_employee_password_reset(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '56000000-0000-4000-8000-000000000001'::uuid,
    '57000000-0000-4000-8000-000000000001'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task5_json_results values (
  'password reset concurrent',
  public.claim_employee_password_reset(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '56000000-0000-4000-8000-000000000002'::uuid,
    '57000000-0000-4000-8000-000000000002'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;
update public.employee_password_reset_requests
  set owner_expires_at = now() - interval '1 second'
  where employee_profile_id = '54000000-0000-4000-8000-000000000001';
set local role service_role;
insert into task5_json_results values (
  'password reset takeover',
  public.claim_employee_password_reset(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '56000000-0000-4000-8000-000000000003'::uuid,
    '57000000-0000-4000-8000-000000000003'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task5_boolean_results values (
  'password reset renew',
  public.renew_employee_password_reset_owner(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '56000000-0000-4000-8000-000000000001'::uuid,
    '57000000-0000-4000-8000-000000000003'::uuid,
    '53000000-0000-4000-8000-000000000005'::uuid
  )
);
insert into task5_json_results values (
  'temporary password',
  public.complete_employee_password_reset(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '56000000-0000-4000-8000-000000000001'::uuid,
    '57000000-0000-4000-8000-000000000003'::uuid,
    '53000000-0000-4000-8000-000000000005'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task5_json_results values (
  'password reset cooldown',
  public.claim_employee_password_reset(
    '54000000-0000-4000-8000-000000000001'::uuid,
    '56000000-0000-4000-8000-000000000004'::uuid,
    '57000000-0000-4000-8000-000000000004'::uuid,
    '53000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;
select is(
  (select value->>'accountStatus' from task5_json_results where scenario = 'activated'),
  'active'::text,
  'activation updates the exact profile after Auth is unbanned'
);
select ok(
  (select (value->>'mustChangePassword')::boolean
   from task5_json_results where scenario = 'temporary password'),
  'password reset marks only the linked active profile temporary'
);
select ok(
  (select (value->>'ownerAcquired')::boolean
          and value->>'requestId' = '56000000-0000-4000-8000-000000000001'
   from task5_json_results where scenario = 'password reset claim'),
  'the first reset request owns the target-scoped fence'
);
select ok(
  not (select (value->>'ownerAcquired')::boolean
       from task5_json_results where scenario = 'password reset concurrent'),
  'a concurrent reset cannot reach the Auth password side effect'
);
select ok(
  (select (value->>'ownerAcquired')::boolean
          and value->>'requestId' = '56000000-0000-4000-8000-000000000001'
   from task5_json_results where scenario = 'password reset takeover'),
  'an expired reset lease is recovered with the same deterministic request id'
);
select ok(
  (select value from task5_boolean_results where scenario = 'password reset renew'),
  'the reset owner renews immediately before the bounded Auth write'
);
select ok(
  not (select (value->>'ownerAcquired')::boolean
       from task5_json_results where scenario = 'password reset cooldown')
  and (select value->>'status' = 'cooldown'
       from task5_json_results where scenario = 'password reset cooldown'),
  'completion cooldown prevents a new generation while an old worker could survive'
);
select is(
  (select count(*) from public.employee_security_audit
   where target_employee_profile_id = '54000000-0000-4000-8000-000000000001'
     and action in (
       'employee.profile_updated',
       'employee.account_disabled',
       'employee.account_activated',
       'employee.temporary_password_reset'
     )),
  4::bigint,
  'all administration transitions write server-attributed audit events'
);

select throws_ok(
  $$select public.get_employee_admin_target(
      '54000000-0000-4000-8000-000000000002'::uuid
    )$$,
  '22023',
  'employee target unavailable',
  'SW-000 is never a normal administration target'
);
select throws_ok(
  $$select public.disable_employee_account_admin(
      '54000000-0000-4000-8000-000000000002'::uuid,
      '53000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'employee target unavailable',
  'SW-000 cannot be disabled through employee administration'
);
select throws_ok(
  $$select public.update_employee_profile_admin(
      '54000000-0000-4000-8000-000000000001'::uuid,
      '{"name":"伪造操作者"}'::jsonb,
      '53000000-0000-4000-8000-000000000007'::uuid
    )$$,
  '42501',
  'personnel administrator required',
  'a service-role caller cannot spoof a non-admin audit actor'
);
select throws_ok(
  $$select public.update_employee_profile_admin(
      '54000000-0000-4000-8000-000000000001'::uuid,
      '{"passportNumber":"PRIVATE"}'::jsonb,
      '53000000-0000-4000-8000-000000000008'::uuid
    )$$,
  '42501',
  'sensitive employee permission required',
  'a president without the identity template grant cannot mutate identity data'
);
reset role;

select * from finish();
rollback;

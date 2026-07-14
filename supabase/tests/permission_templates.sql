begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(35);

select has_function(
  'public',
  'read_permission_templates_admin',
  array['uuid'],
  'permission templates expose a server-only complete read'
);
select has_function(
  'public',
  'replace_permission_template_admin',
  array['text', 'text', 'text[]', 'uuid'],
  'permission templates expose one atomic replacement operation'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.read_permission_templates_admin(uuid)',
    'EXECUTE'
  ),
  'service_role can read templates'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.read_permission_templates_admin(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot call the service-role read RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.read_permission_templates_admin(uuid)',
    'EXECUTE'
  ),
  'anon cannot call the service-role read RPC'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.replace_permission_template_admin(text,text,text[],uuid)',
    'EXECUTE'
  ),
  'service_role can atomically replace templates'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.replace_permission_template_admin(text,text,text[],uuid)',
    'EXECUTE'
  ),
  'authenticated cannot call the replacement RPC'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.replace_permission_template_admin(text,text,text[],uuid)',
    'EXECUTE'
  ),
  'anon cannot call the replacement RPC'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select public.read_permission_templates_admin(
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  'service_role required',
  'read independently checks the execution role'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'department',
      '工程部',
      array[]::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '42501',
  'service_role required',
  'replace independently checks the execution role'
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
  ('00000000-0000-0000-0000-000000000000', '78000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task8-president@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task8-worker@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'task8-disabled-president@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'task8-temporary-president@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '78000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'task8-sw000@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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
  ('79000000-0000-4000-8000-000000000001', 'SW-9801', '78000000-0000-4000-8000-000000000001', '权限社长', '总务部', '社长', '在职', 'active', false, false),
  ('79000000-0000-4000-8000-000000000002', 'SW-9802', '78000000-0000-4000-8000-000000000002', '权限员工', '工程部', '设计师', '在职', 'active', false, false),
  ('79000000-0000-4000-8000-000000000003', 'SW-9803', '78000000-0000-4000-8000-000000000003', '停用社长', '总务部', '社长', '在职', 'disabled', false, false),
  ('79000000-0000-4000-8000-000000000004', 'SW-9804', '78000000-0000-4000-8000-000000000004', '临时社长', '总务部', '社长', '在职', 'active', true, false),
  ('79000000-0000-4000-8000-000000000005', 'SW-000', '78000000-0000-4000-8000-000000000005', '超级管理员', '总务部', '社长', '在职', 'active', false, true);

create temporary table task8_snapshots (
  scenario text primary key,
  value jsonb not null
) on commit drop;
grant all on table task8_snapshots to service_role;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
insert into task8_snapshots values (
  'initial',
  public.read_permission_templates_admin(
    '78000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;

select is(
  (select count(*)::integer
   from task8_snapshots,
     lateral jsonb_object_keys(value->'departments')
   where scenario = 'initial'),
  10,
  'read includes all ten fixed departments'
);
select is(
  (select count(*)::integer
   from task8_snapshots,
     lateral jsonb_object_keys(value->'positions')
   where scenario = 'initial'),
  15,
  'read includes all fifteen fixed positions'
);
select ok(
  (select value->'departments'->'工程部' = '[]'::jsonb
       and value->'positions'->'设计师' = '[]'::jsonb
   from task8_snapshots where scenario = 'initial'),
  'unconfigured fixed templates are returned as empty arrays'
);

set local role service_role;
reset role;
select throws_ok(
  $$select public.read_permission_templates_admin(
      '78000000-0000-4000-8000-000000000002'::uuid
    )$$,
  '42501',
  'personnel administrator required',
  'a non-president cannot read permission templates'
);
select throws_ok(
  $$select public.read_permission_templates_admin(
      '78000000-0000-4000-8000-000000000003'::uuid
    )$$,
  '42501',
  'personnel administrator required',
  'a disabled president cannot read permission templates'
);
select throws_ok(
  $$select public.read_permission_templates_admin(
      '78000000-0000-4000-8000-000000000004'::uuid
    )$$,
  '42501',
  'personnel administrator required',
  'a president with a temporary password cannot read permission templates'
);
select throws_ok(
  $$select public.read_permission_templates_admin(
      '78000000-0000-4000-8000-000000000099'::uuid
    )$$,
  '42501',
  'personnel administrator required',
  'an unknown actor Auth id cannot read permission templates'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'employee',
      'SW-9802',
      array[]::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'employee-specific permission subjects are rejected'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'department',
      '现场',
      array[]::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'unknown departments are rejected'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'position',
      '社长',
      array['all']::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'the all sentinel cannot be stored in a template'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'position',
      '社长',
      array['module.permission_templates.update']::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'fixed template-administration permissions cannot be self-granted'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'position',
      '社长',
      array['module.unknown.view']::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'unknown permission keys are rejected'
);
select throws_ok(
  $$select public.replace_permission_template_admin(
      'position',
      '社长',
      array['module.projects.view', 'module.projects.view']::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'duplicate permission key',
  'duplicate permission keys are rejected instead of normalized'
);

set local role service_role;
insert into task8_snapshots values (
  'department replacement',
  public.replace_permission_template_admin(
    'department',
    '工程部',
    array[
      'sensitive.salary_view',
      'module.projects.view',
      'module.projects.update'
    ]::text[],
    '78000000-0000-4000-8000-000000000001'::uuid
  )
);
insert into task8_snapshots values (
  'position replacement',
  public.replace_permission_template_admin(
    'position',
    '设计师',
    array['module.tools.view']::text[],
    '78000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;

select is(
  (select value->'departments'->'工程部' from task8_snapshots where scenario = 'department replacement'),
  '["module.projects.update", "module.projects.view", "sensitive.salary_view"]'::jsonb,
  'replacement returns a sorted complete snapshot'
);
select is(
  (select array_agg(permission_key order by permission_key)
   from public.permission_grants
   where subject_type = 'department' and subject_code = '工程部'),
  array[
    'module.projects.update',
    'module.projects.view',
    'sensitive.salary_view'
  ]::text[],
  'one department replacement persists exactly its submitted set'
);
select is(
  (select array_agg(permission_key order by permission_key)
   from public.permission_grants
   where subject_type = 'position' and subject_code = '设计师'),
  array['module.tools.view']::text[],
  'position templates use the same closed replacement path'
);
select ok(
  (select value->'departments'->'财务部' = '[]'::jsonb
       and (select count(*) from jsonb_object_keys(value->'departments')) = 10
       and (select count(*) from jsonb_object_keys(value->'positions')) = 15
   from task8_snapshots where scenario = 'position replacement'),
  'replacement preserves every unrelated fixed template in the snapshot'
);
select is(
  (select count(*) from public.employee_security_audit
   where action = 'permission_template.replaced'),
  2::bigint,
  'each successful replacement writes one audit event'
);
select ok(
  not exists (
    select 1
    from public.employee_security_audit
    where action = 'permission_template.replaced'
      and (
        actor_auth_user_id <> '78000000-0000-4000-8000-000000000001'::uuid
        or safe_details - array['subjectType', 'subjectCode', 'permissionCount'] <> '{}'::jsonb
        or safe_details::text like '%module.%'
      )
  ),
  'replacement audit contains only the verified actor and safe template metadata'
);
select is(
  private.employee_effective_permission_keys(
    '79000000-0000-4000-8000-000000000002'::uuid
  ),
  array[
    'module.projects.update',
    'module.projects.view',
    'module.tools.view',
    'sensitive.salary_view'
  ]::text[],
  'the next permission lookup uses the department and position union'
);

select throws_ok(
  $$select public.replace_permission_template_admin(
      'department',
      '工程部',
      array['module.projects.delete', 'module.not_in_catalog.view']::text[],
      '78000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'a failed replacement aborts before changing the stored set'
);
select is(
  (select array_agg(permission_key order by permission_key)
   from public.permission_grants
   where subject_type = 'department' and subject_code = '工程部'),
  array[
    'module.projects.update',
    'module.projects.view',
    'sensitive.salary_view'
  ]::text[],
  'a rejected replacement leaves the previous template intact'
);

set local role service_role;
insert into task8_snapshots values (
  'position cleared',
  public.replace_permission_template_admin(
    'position',
    '设计师',
    array[]::text[],
    '78000000-0000-4000-8000-000000000001'::uuid
  )
);
reset role;
select ok(
  (select value->'positions'->'设计师' = '[]'::jsonb
   from task8_snapshots where scenario = 'position cleared')
  and not exists (
    select 1 from public.permission_grants
    where subject_type = 'position' and subject_code = '设计师'
  ),
  'an empty atomic replacement clears exactly one template'
);
select is(
  (select count(*) from public.employee_security_audit
   where action = 'permission_template.replaced'),
  3::bigint,
  'clearing a template is audited in the same transaction'
);

set local role service_role;
insert into task8_snapshots values (
  'sw000 read',
  public.read_permission_templates_admin(
    '78000000-0000-4000-8000-000000000005'::uuid
  )
);
reset role;
select ok(
  (select (select count(*) from jsonb_object_keys(value->'departments')) = 10
       and (select count(*) from jsonb_object_keys(value->'positions')) = 15
   from task8_snapshots where scenario = 'sw000 read'),
  'the active hidden SW-000 account can read the complete templates'
);

select * from finish();
rollback;

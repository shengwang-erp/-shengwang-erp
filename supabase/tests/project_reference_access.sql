begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

select has_function(
  'public', 'list_project_references_secure', array[]::text[],
  'minimal project reference RPC exists'
);
select function_privs_are(
  'public', 'list_project_references_secure', array[]::text[],
  'authenticated', array['EXECUTE'],
  'authenticated can execute the reference RPC only'
);
select function_privs_are(
  'public', 'list_project_references_secure', array[]::text[],
  'service_role', array['EXECUTE'],
  'service role can execute the reference RPC only'
);
select ok(
  not pg_catalog.has_function_privilege(
    'anon', 'public.list_project_references_secure()'::regprocedure, 'EXECUTE'
  ),
  'anonymous role cannot execute the reference RPC'
);
select ok(
  (select procedure.prosecdef
     and procedure.provolatile = 's'
     and procedure.proconfig = array['search_path=""']::text[]
   from pg_catalog.pg_proc as procedure
   where procedure.oid = 'public.list_project_references_secure()'::regprocedure),
  'reference RPC is stable security definer with an empty search path'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'reference-tool-manager@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'reference-tool-viewer@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'reference-cost-viewer@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'reference-cost-accountant@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'reference-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'reference-dashboard-project@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'reference-dashboard-no-sensitive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'reference-dashboard-operating@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'reference-dashboard-no-page@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa100000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'reference-dashboard-no-cost@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('aa200000-0000-4000-8000-000000000001', 'SW-9801', 'aa100000-0000-4000-8000-000000000001', '工具责任管理员', '后勤部', '总务部长', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000002', 'SW-9802', 'aa100000-0000-4000-8000-000000000002', '工具只读人员', '后勤部', '主任', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000003', 'SW-9803', 'aa100000-0000-4000-8000-000000000003', '成本缺页人员', '设计部', '设计师', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000004', 'SW-9804', 'aa100000-0000-4000-8000-000000000004', '项目成本会计', '设计部', '会计', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000005', 'SW-9805', 'aa100000-0000-4000-8000-000000000005', '离职工具管理员', '后勤部', '总务部长', '离职', 'disabled', false),
  ('aa200000-0000-4000-8000-000000000006', 'SW-9806', 'aa100000-0000-4000-8000-000000000006', '驾驶舱项目成本', '事务部', '部长', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000007', 'SW-9807', 'aa100000-0000-4000-8000-000000000007', '驾驶舱缺敏感权', '事务部', '小工', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000008', 'SW-9808', 'aa100000-0000-4000-8000-000000000008', '驾驶舱经营费用', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000009', 'SW-9809', 'aa100000-0000-4000-8000-000000000009', '驾驶舱缺页面权', '电商部', '仓库管理员', '在职', 'active', false),
  ('aa200000-0000-4000-8000-000000000010', 'SW-9810', 'aa100000-0000-4000-8000-000000000010', '驾驶舱缺成本权', '营业部', '部长', '在职', 'active', false);

insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('department', '后勤部', 'module.tools.view'),
  ('position', '总务部长', 'module.tools.update'),
  ('department', '设计部', 'module.project_costs.view'),
  ('position', '会计', 'module.accounting.view'),
  ('department', '事务部', 'module.owner_dashboard.view'),
  ('department', '事务部', 'module.project_costs.view'),
  ('position', '部长', 'sensitive.owner_dashboard_full_view'),
  ('department', '仓库管理部', 'module.owner_dashboard.view'),
  ('department', '仓库管理部', 'module.operating_expenses.view'),
  ('position', '仓库管理员', 'sensitive.owner_dashboard_full_view'),
  ('department', '电商部', 'module.operating_expenses.view'),
  ('department', '营业部', 'module.owner_dashboard.view')
on conflict do nothing;

insert into public.projects(record_key, payload, status) values (
  'REFERENCE-P-1',
  '{
    "projectId":"FORGED-ID","projectName":"最小引用项目","status":"进行中",
    "address":"东京都","customerName":"秘密客户","contractAmount":999999,
    "remark":"秘密备注","latitude":35.0,"longitude":139.0
  }'::jsonb,
  'active'
);

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select reference
   from public.list_project_references_secure() as reference
   where reference->>'projectId' = 'REFERENCE-P-1'),
  '{"projectId":"REFERENCE-P-1","projectName":"最小引用项目","status":"进行中","address":"东京都"}'::jsonb,
  'tool responsibility manager receives only the four-field authoritative reference DTO'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_references_secure()$$,
  '42501', 'project reference permission required',
  'tool view without tool update cannot read project references'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_references_secure()$$,
  '42501', 'project reference permission required',
  'project-cost view without accounting page cannot read project references'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000004', true);
set local role authenticated;
select lives_ok(
  $$select public.list_project_references_secure()$$,
  'accounting and project-cost view together can read project references'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000005', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_references_secure()$$,
  '42501', 'active employee required',
  'inactive tool manager cannot read project references'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000006', true);
set local role authenticated;
select lives_ok(
  $$select public.list_project_references_secure()$$,
  'owner dashboard full-data project-cost chain can read project references'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000007', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_references_secure()$$,
  '42501', 'project reference permission required',
  'owner dashboard project-cost chain without sensitive full view is rejected'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000008', true);
set local role authenticated;
select lives_ok(
  $$select public.list_project_references_secure()$$,
  'owner dashboard full-data operating-expense chain can read project references'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000009', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_references_secure()$$,
  '42501', 'project reference permission required',
  'owner dashboard operating-expense chain without dashboard page is rejected'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa100000-0000-4000-8000-000000000010', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_references_secure()$$,
  '42501', 'project reference permission required',
  'owner dashboard full-data chain without a relation cost module is rejected'
);
reset role;

select * from finish();
rollback;

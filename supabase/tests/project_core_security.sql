begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select no_plan();

-- Interface contract. These assertions intentionally fail before migration 005.
select has_function(
  'public', 'can_current_employee_view_project_financials', array[]::text[],
  'fixed project-financial predicate exists'
);
select has_function(
  'private', 'project_financial_payload_keys', array[]::text[],
  'the exhaustive financial projection key helper exists'
);
select has_function(
  'private', 'next_project_record_key', array[]::text[],
  'the transaction-safe project key allocator exists'
);
select has_function(
  'private', 'validate_project_payload', array['jsonb'],
  'the shared project payload validator exists'
);
select has_function(
  'public', 'list_projects_secure', array[]::text[],
  'the secure project list RPC exists'
);
select has_function(
  'public', 'create_project_secure', array['jsonb'],
  'the secure project create RPC exists'
);
select has_function(
  'public', 'update_project_secure', array['text', 'jsonb'],
  'the secure project update RPC exists'
);
select has_function(
  'public', 'soft_delete_project_secure', array['text'],
  'the secure project soft-delete RPC exists'
);
select has_function(
  'public', 'migrate_legacy_project_contract_secure',
  array['text', 'jsonb', 'jsonb'],
  'the transactional legacy contract migration RPC exists'
);

create or replace function pg_temp.task5_project_input(
  p_name text,
  p_status text,
  p_design_assignee_id text
)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'projectName', p_name,
    'customerName', '测试客户',
    'address', '',
    'latitude', null,
    'longitude', null,
    'attendanceRadiusMeters', 300,
    'locationConfirmedAt', '',
    'locationAddressSnapshot', '',
    'status', p_status,
    'designAssigneeEmployeeId', p_design_assignee_id,
    'designAssigneeEmployeeNumber', case when p_design_assignee_id = '' then '' else 'SW-SPOOF' end,
    'designAssigneeName', case when p_design_assignee_id = '' then '' else '伪造设计担当' end,
    'siteAssigneeEmployeeId', '',
    'siteAssigneeEmployeeNumber', '',
    'siteAssigneeName', '',
    'startDate', '2026-07-15',
    'endDate', '',
    'remark', ''
  );
$$;

grant execute on function pg_temp.task5_project_input(text, text, text)
  to authenticated, service_role;

create temporary table task5_identities (
  identity_name text primary key,
  auth_user_id uuid not null,
  employee_profile_id uuid not null
) on commit drop;
grant select on table task5_identities to authenticated, service_role;

create temporary table task5_results (
  result_name text primary key,
  result_payload jsonb not null
) on commit drop;
grant select, insert, update, delete on table task5_results
  to authenticated, service_role;

create temporary table task5_financial_keys (
  key text primary key
) on commit drop;
grant select on table task5_financial_keys to authenticated, service_role;

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
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task5-ordinary@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task5-design@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'task5-finance@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'task5-president@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'task5-disabled@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'task5-former@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '51000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'task5-must-change@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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
  ('52000000-0000-4000-8000-000000000001', 'SW-5101', '51000000-0000-4000-8000-000000000001', '普通工程员工', '工程部', '设计师', '在职', 'active', false, false),
  ('52000000-0000-4000-8000-000000000002', 'SW-5102', '51000000-0000-4000-8000-000000000002', '设计白名单员工', '设计部', '设计师', '在职', 'active', false, false),
  ('52000000-0000-4000-8000-000000000003', 'SW-5103', '51000000-0000-4000-8000-000000000003', '财务白名单员工', '财务部', '会计', '在职', 'active', false, false),
  ('52000000-0000-4000-8000-000000000004', 'SW-5104', '51000000-0000-4000-8000-000000000004', '社长白名单员工', '总务部', '社长', '在职', 'active', false, false),
  ('52000000-0000-4000-8000-000000000006', 'SW-5106', '51000000-0000-4000-8000-000000000006', '停用员工', '工程部', '设计师', '在职', 'disabled', false, false),
  ('52000000-0000-4000-8000-000000000007', 'SW-5107', '51000000-0000-4000-8000-000000000007', '离职员工', '工程部', '设计师', '离职', 'active', false, false),
  ('52000000-0000-4000-8000-000000000008', 'SW-5108', '51000000-0000-4000-8000-000000000008', '待改密员工', '工程部', '设计师', '在职', 'active', true, false),
  ('52000000-0000-4000-8000-000000000009', 'SW-5109', null, '现场担当正本', '工程部', '职长', '在职', 'active', false, false),
  ('52000000-0000-4000-8000-000000000010', 'SW-5110', null, '设计担当正本', '设计部', '设计师', '在职', 'active', false, false);

do $$
begin
  if not exists (
    select 1 from public.employee_profiles where employee_number = 'SW-000'
  ) then
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      '51000000-0000-4000-8000-000000000005',
      'authenticated', 'authenticated', 'task5-sw000@auth.invalid', '', now(),
      '{}'::jsonb, '{}'::jsonb, now(), now()
    );
    insert into public.employee_profiles (
      id, employee_number, auth_user_id, name, department, position,
      employment_status, account_status, must_change_password,
      is_hidden_system_account
    ) values (
      '52000000-0000-4000-8000-000000000005',
      'SW-000', '51000000-0000-4000-8000-000000000005',
      '测试隐藏管理员', '总务部', '社长', '在职', 'active', false, true
    );
  end if;
end;
$$;

insert into task5_identities (identity_name, auth_user_id, employee_profile_id)
select fixture.identity_name, fixture.auth_user_id, fixture.employee_profile_id
from (values
  ('ordinary', '51000000-0000-4000-8000-000000000001'::uuid, '52000000-0000-4000-8000-000000000001'::uuid),
  ('design', '51000000-0000-4000-8000-000000000002'::uuid, '52000000-0000-4000-8000-000000000002'::uuid),
  ('finance', '51000000-0000-4000-8000-000000000003'::uuid, '52000000-0000-4000-8000-000000000003'::uuid),
  ('president', '51000000-0000-4000-8000-000000000004'::uuid, '52000000-0000-4000-8000-000000000004'::uuid),
  ('disabled', '51000000-0000-4000-8000-000000000006'::uuid, '52000000-0000-4000-8000-000000000006'::uuid),
  ('former', '51000000-0000-4000-8000-000000000007'::uuid, '52000000-0000-4000-8000-000000000007'::uuid),
  ('must-change', '51000000-0000-4000-8000-000000000008'::uuid, '52000000-0000-4000-8000-000000000008'::uuid)
) as fixture(identity_name, auth_user_id, employee_profile_id)
union all
select 'sw000', profile.auth_user_id, profile.id
from public.employee_profiles as profile
where profile.employee_number = 'SW-000';

insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
)
select grant_row.subject_type, grant_row.subject_code, grant_row.permission_key
from (values
  ('department', '工程部', 'module.projects.view'),
  ('department', '工程部', 'module.projects.create'),
  ('department', '工程部', 'module.projects.update'),
  ('department', '工程部', 'module.projects.delete'),
  ('department', '设计部', 'module.projects.view'),
  ('department', '设计部', 'module.projects.create'),
  ('department', '设计部', 'module.projects.update'),
  ('department', '设计部', 'module.projects.delete'),
  ('department', '财务部', 'module.projects.view'),
  ('department', '财务部', 'module.projects.create'),
  ('department', '财务部', 'module.projects.update'),
  ('department', '财务部', 'module.projects.delete'),
  ('position', '社长', 'module.projects.view'),
  ('position', '社长', 'module.projects.create'),
  ('position', '社长', 'module.projects.update'),
  ('position', '社长', 'module.projects.delete')
) as grant_row(subject_type, subject_code, permission_key)
on conflict do nothing;

insert into public.projects (record_key, payload, status) values
  (
    'T5-CORE-001',
    pg_temp.task5_project_input('核心安全项目', '报价中', '52000000-0000-4000-8000-000000000010')
      || jsonb_build_object(
        'projectId', 'T5-CORE-001',
        'designAssigneeEmployeeNumber', 'SW-5110',
        'designAssigneeName', '设计担当正本',
        'contractAmount', 1000000,
        'paidAmount', 100000,
        'paymentProgress', 10,
        'paymentStatus', 'partial',
        'revenuePaymentStatus', 'partial',
        'contractRevenueSchemaVersion', 1,
        'contractRevenueSetupStatus', 'configured',
        'contractConfirmationStatus', 'draft',
        'originalContractTaxExclusiveAmount', 900000,
        'originalContractTaxRate', 10,
        'originalContractTaxAmount', 90000,
        'originalContractTaxInclusiveAmount', 990000,
        'contractConfirmedById', 'historical-actor',
        'contractConfirmedByName', '历史确认人',
        'contractConfirmedAt', '2025-01-01T00:00:00Z',
        'needsManualReview', false,
        'adjustedTaxExclusiveAmount', 900000,
        'adjustedTaxAmount', 90000,
        'adjustedTaxInclusiveAmount', 990000,
        'totalReceivedTaxInclusiveAmount', 100000,
        'outstandingTaxInclusiveAmount', 890000,
        'overpaidTaxInclusiveAmount', 0,
        'profitAnchorTaxExclusiveAmount', 900000,
        'allocationStatus', 'allocated',
        'allocationReason', '',
        'lockedStages', '[]'::jsonb,
        'unlockedStages', '[]'::jsonb,
        'lockedPlannedTaxInclusiveAmount', 0,
        'remainingAssignableTaxInclusiveAmount', 990000,
        'unallocatedTaxInclusiveAmount', 0,
        'lockedAmountExcess', 0
      ),
    'active'
  ),
  (
    'T5-LOCATION-001',
    pg_temp.task5_project_input('未定位项目', '报价中', '')
      || jsonb_build_object('projectId', 'T5-LOCATION-001'),
    'active'
  ),
  (
    'T5-CONFIRM-001',
    pg_temp.task5_project_input('待确认合同项目', '报价中', '')
      || jsonb_build_object(
        'projectId', 'T5-CONFIRM-001',
        'contractRevenueSchemaVersion', 1,
        'contractRevenueSetupStatus', 'configured',
        'contractConfirmationStatus', 'draft',
        'originalContractTaxExclusiveAmount', 1000000,
        'originalContractTaxRate', 10,
        'originalContractTaxAmount', 100000,
        'originalContractTaxInclusiveAmount', 1100000,
        'needsManualReview', false
      ),
    'active'
  ),
  (
    'T5-DELETE-001',
    pg_temp.task5_project_input('待删除项目', '报价中', '')
      || jsonb_build_object('projectId', 'T5-DELETE-001'),
    'active'
  ),
  (
    'T5-LEGACY-001',
    pg_temp.task5_project_input('历史有收款项目', '已完工', '')
      || jsonb_build_object(
        'projectId', 'T5-LEGACY-001',
        'contractAmount', 800000,
        'paidAmount', 120000,
        'paymentProgress', 15,
        'paymentStatus', 'partial'
      ),
    'active'
  ),
  (
    'T5-LEGACY-ZERO',
    pg_temp.task5_project_input('历史零收款项目', '已完工', '')
      || jsonb_build_object(
        'projectId', 'T5-LEGACY-ZERO',
        'contractAmount', 500000,
        'paidAmount', 0,
        'paymentProgress', 0,
        'paymentStatus', 'unpaid'
      ),
    'active'
  ),
  (
    'T5-LEGACY-MISMATCH',
    pg_temp.task5_project_input('历史冲突项目', '已完工', '')
      || jsonb_build_object(
        'projectId', 'T5-LEGACY-MISMATCH',
        'contractAmount', 700000,
        'paidAmount', 70000,
        'paymentProgress', 10,
        'paymentStatus', 'partial'
      ),
    'active'
  );

insert into public.project_contract_changes (record_key, payload, status)
values (
  'T5-CHANGE-001',
  '{"changeId":"T5-CHANGE-001","projectId":"T5-CORE-001","taxInclusiveAmount":10000}'::jsonb,
  'active'
);
insert into public.project_payment_plans (record_key, payload, status)
values (
  'T5-PLAN-001',
  '{"planId":"T5-PLAN-001","projectId":"T5-CORE-001","plannedTaxInclusiveAmount":10000}'::jsonb,
  'active'
);
insert into public.project_receipts (record_key, payload, status)
values (
  'T5-RECEIPT-001',
  '{"receiptId":"T5-RECEIPT-001","projectId":"T5-CORE-001","taxInclusiveAmount":10000,"sourceCode":"manual"}'::jsonb,
  'active'
);

-- Case 9 (upgrade half): the migration leaves no forbidden persisted grant and
-- writes one deliberately sparse cleanup audit. The seeded non-empty deletion is
-- proven separately by the required two-phase upgrade check.
select is(
  (
    select count(*)
    from public.permission_grants as grant_row
    where grant_row.permission_key in (
      'sensitive.contract_amount_view',
      'sensitive.contract_amount_update'
    )
      and not (
        (grant_row.subject_type = 'department' and grant_row.subject_code in ('设计部', '财务部'))
        or (grant_row.subject_type = 'position' and grant_row.subject_code = '社长')
      )
  ),
  0::bigint,
  '9. migration cleanup leaves no persisted forbidden project-financial grant'
);
select is(
  (
    select count(*)
    from public.employee_security_audit
    where action = 'project_financial_template_grants.cleaned'
      and safe_details ? 'deletedCount'
      and safe_details - 'deletedCount' = '{}'::jsonb
      and jsonb_typeof(safe_details->'deletedCount') = 'number'
  ),
  1::bigint,
  '9. migration writes exactly one cleanup audit containing deletedCount only'
);

-- Snapshot the exact server key set while running as the migration owner. Browser
-- roles cannot call the private helper directly later in this test.
insert into task5_financial_keys (key)
select unnest(private.project_financial_payload_keys());

select is(
  (select count(*) from task5_financial_keys),
  31::bigint,
  'the financial projection helper returns exactly 31 keys'
);

-- Case 15: function/table ACLs are closed, project policies are gone, and the
-- revenue tables keep exactly their fixed RLS surface and update triggers.
select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'projects'
  ),
  0::bigint,
  '15. projects has zero direct-access policies'
);
select ok(
  (
    select count(*) = 3
      and sum(policy_count) = 9
      and bool_and(policy_count = 3)
    from (
      select revenue.table_name, count(policy.policyname) as policy_count
      from (values
        ('project_contract_changes'),
        ('project_payment_plans'),
        ('project_receipts')
      ) as revenue(table_name)
      left join pg_catalog.pg_policies as policy
        on policy.schemaname = 'public'
        and policy.tablename = revenue.table_name
      group by revenue.table_name
    ) as counts
  ),
  '15. each revenue table has exactly SELECT, INSERT, and UPDATE policies'
);
select ok(
  not has_table_privilege('authenticated', 'public.projects', 'SELECT')
    and not has_table_privilege('authenticated', 'public.projects', 'INSERT')
    and not has_table_privilege('authenticated', 'public.projects', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.projects', 'DELETE'),
  '15. authenticated has no direct project table privilege'
);
select ok(
  (
    select bool_and(
      has_table_privilege('authenticated', format('public.%I', revenue.table_name), 'SELECT')
      and has_table_privilege('authenticated', format('public.%I', revenue.table_name), 'INSERT')
      and has_table_privilege('authenticated', format('public.%I', revenue.table_name), 'UPDATE')
      and not has_table_privilege('authenticated', format('public.%I', revenue.table_name), 'DELETE')
    )
    from (values
      ('project_contract_changes'),
      ('project_payment_plans'),
      ('project_receipts')
    ) as revenue(table_name)
  ),
  '15. revenue browser ACLs are exactly SELECT, INSERT, and UPDATE'
);
select ok(
  (
    select bool_and(
      exists (
        select 1
        from pg_catalog.pg_trigger as trigger_row
        where trigger_row.tgrelid = format('public.%I', revenue.table_name)::regclass
          and trigger_row.tgname = 'set_' || revenue.table_name || '_updated_at'
          and not trigger_row.tgisinternal
      )
      and not exists (
        select 1
        from pg_catalog.pg_trigger as trigger_row
        where trigger_row.tgrelid = format('public.%I', revenue.table_name)::regclass
          and trigger_row.tgname = 'enforce_' || revenue.table_name || '_status_permission'
          and not trigger_row.tgisinternal
      )
    )
    from (values
      ('project_contract_changes'),
      ('project_payment_plans'),
      ('project_receipts')
    ) as revenue(table_name)
  ),
  '15. revenue update triggers remain while only status-permission triggers are removed'
);
select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'private'
      and routine_name in (
        'project_financial_payload_keys',
        'next_project_record_key',
        'validate_project_payload'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  0::bigint,
  '15. no browser or service role can execute a private project helper'
);
select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name in (
        'can_current_employee_view_project_financials',
        'list_projects_secure',
        'create_project_secure',
        'update_project_secure',
        'soft_delete_project_secure',
        'migrate_legacy_project_contract_secure'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  12::bigint,
  '15. six public project functions grant EXECUTE only to authenticated and service_role'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $$select public.can_current_employee_view_project_financials()$$,
  '%permission denied for function can_current_employee_view_project_financials%',
  '15. anon cannot execute the fixed financial predicate'
);
select throws_like(
  $$select private.project_financial_payload_keys()$$,
  '%permission denied%',
  '15. anon cannot execute a private helper'
);
reset role;

-- Case 9 (future half): even if a privileged database writer reintroduces a
-- forbidden row, the editable template RPC cannot preserve or recreate it.
insert into public.permission_grants (subject_type, subject_code, permission_key)
values
  ('department', '工程部', 'sensitive.contract_amount_view'),
  ('department', '工程部', 'sensitive.contract_amount_update')
on conflict do nothing;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
select throws_ok(
  $$select public.replace_permission_template_admin(
      'department',
      '工程部',
      array[
        'module.projects.view',
        'sensitive.contract_amount_view'
      ]::text[],
      '51000000-0000-4000-8000-000000000004'::uuid
    )$$,
  '22023',
  'fixed project financial whitelist violation',
  '9. a future forbidden template replacement fails before mutation'
);
reset role;
select is(
  (
    select count(*)
    from public.permission_grants
    where subject_type = 'department'
      and subject_code = '工程部'
      and permission_key in (
        'sensitive.contract_amount_view',
        'sensitive.contract_amount_update'
      )
  ),
  2::bigint,
  '9. the rejected replacement leaves the pre-call template unchanged'
);

-- Case 1: ordinary engineering employees receive no financial key at all.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'ordinary'),
  true
);
select ok(
  (
    select count(*) = 31 and bool_and(not listed.payload ? financial.key)
    from public.list_projects_secure() as listed(payload)
    cross join task5_financial_keys as financial
    where listed.payload->>'projectId' = 'T5-CORE-001'
  ),
  '1. ordinary project list projection removes every financial key'
);

-- Case 2: each fixed identity branch sees the amount source fields.
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'design'),
  true
);
select ok(
  (
    select listed.payload ? 'originalContractTaxInclusiveAmount'
    from public.list_projects_secure() as listed(payload)
    where listed.payload->>'projectId' = 'T5-CORE-001'
  ),
  '2. 设计部 sees project financial source fields'
);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'finance'),
  true
);
select ok(
  (
    select listed.payload ? 'originalContractTaxInclusiveAmount'
    from public.list_projects_secure() as listed(payload)
    where listed.payload->>'projectId' = 'T5-CORE-001'
  ),
  '2. 财务部 sees project financial source fields'
);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'president'),
  true
);
select ok(
  (
    select listed.payload ? 'originalContractTaxInclusiveAmount'
    from public.list_projects_secure() as listed(payload)
    where listed.payload->>'projectId' = 'T5-CORE-001'
  ),
  '2. 社长 sees project financial source fields'
);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'sw000'),
  true
);
select ok(
  (
    select listed.payload ? 'originalContractTaxInclusiveAmount'
    from public.list_projects_secure() as listed(payload)
    where listed.payload->>'projectId' = 'T5-CORE-001'
  ),
  '2. SW-000 sees project financial source fields'
);

-- Case 3: projects is RPC-only regardless of ordinary module grants.
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'ordinary'),
  true
);
select throws_like(
  $$select * from public.projects$$,
  '%permission denied for table projects%',
  '3. authenticated direct project SELECT is denied'
);
select throws_like(
  $$insert into public.projects (record_key, payload)
    values ('T5-DIRECT-INSERT', '{"projectId":"T5-DIRECT-INSERT"}'::jsonb)$$,
  '%permission denied for table projects%',
  '3. authenticated direct project INSERT is denied'
);
select throws_like(
  $$update public.projects set payload = payload || '{"remark":"forbidden"}'::jsonb
    where record_key = 'T5-CORE-001'$$,
  '%permission denied for table projects%',
  '3. authenticated direct project UPDATE is denied'
);

-- Case 4: editable sensitive grants have no effect on the fixed revenue boundary.
select is(
  (select count(*) from public.project_contract_changes),
  0::bigint,
  '4. ordinary engineering cannot read contract changes despite sensitive grants'
);
select is(
  (select count(*) from public.project_payment_plans),
  0::bigint,
  '4. ordinary engineering cannot read payment plans despite sensitive grants'
);
select is(
  (select count(*) from public.project_receipts),
  0::bigint,
  '4. ordinary engineering cannot read receipts despite sensitive grants'
);
select results_eq(
  $$with changed as (
      update public.project_contract_changes
      set payload = payload || '{"forbidden":true}'::jsonb
      where record_key = 'T5-CHANGE-001'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  '4. ordinary engineering cannot update contract changes'
);
select results_eq(
  $$with changed as (
      update public.project_payment_plans
      set payload = payload || '{"forbidden":true}'::jsonb
      where record_key = 'T5-PLAN-001'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  '4. ordinary engineering cannot update payment plans'
);
select results_eq(
  $$with changed as (
      update public.project_receipts
      set payload = payload || '{"forbidden":true}'::jsonb
      where record_key = 'T5-RECEIPT-001'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  '4. ordinary engineering cannot update receipts'
);
select throws_like(
  $$insert into public.project_receipts (record_key, payload, status)
    values (
      'T5-FORBIDDEN-RECEIPT',
      '{"receiptId":"T5-FORBIDDEN-RECEIPT","projectId":"T5-CORE-001"}'::jsonb,
      'active'
    )$$,
  '%violates row-level security policy%',
  '4. ordinary engineering cannot insert a receipt'
);

reset role;
delete from public.permission_grants
where subject_type = 'department'
  and subject_code = '设计部'
  and permission_key = 'module.projects.update';

-- Case 5: fixed-whitelist membership permits reading but never substitutes for
-- the independent module.projects.update requirement.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'design'),
  true
);
select is(
  (
    select
      (select count(*) from public.project_contract_changes)
      + (select count(*) from public.project_payment_plans)
      + (select count(*) from public.project_receipts)
  ),
  3::bigint,
  '5. 设计部 can read all three revenue tables'
);
select results_eq(
  $$with changed as (
      update public.project_receipts
      set payload = payload || '{"forbidden":true}'::jsonb
      where record_key = 'T5-RECEIPT-001'
      returning 1
    ) select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  '5. 设计部 cannot update revenue rows without module.projects.update'
);
select throws_like(
  $$insert into public.project_contract_changes (record_key, payload, status)
    values (
      'T5-DESIGN-FORBIDDEN-CHANGE',
      '{"changeId":"T5-DESIGN-FORBIDDEN-CHANGE","projectId":"T5-CORE-001"}'::jsonb,
      'active'
    )$$,
  '%violates row-level security policy%',
  '5. 设计部 cannot insert revenue rows without module.projects.update'
);
reset role;
insert into public.permission_grants (subject_type, subject_code, permission_key)
values ('department', '设计部', 'module.projects.update')
on conflict do nothing;

-- Capture the exact financial subset before any permitted base update.
insert into task5_results (result_name, result_payload)
select
  'core-financial-before',
  jsonb_object_agg(financial.key, project.payload->financial.key)
from public.projects as project
cross join task5_financial_keys as financial
where project.record_key = 'T5-CORE-001';

-- Cases 6, 12, and 17: an ordinary updater cannot write any financial source,
-- while a base-only merge preserves every existing financial and historical key
-- and projects the response through the same non-financial view as list/create.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'ordinary'),
  true
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-CORE-001',
      '{"contractAmount":2000000}'::jsonb
    )$$,
  '42501',
  'project financial write permission required',
  '6. a non-whitelist updater cannot change a legacy financial key'
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-LOCATION-001',
      '{"contractRevenueSetupStatus":"configured"}'::jsonb
    )$$,
  '42501',
  'project financial write permission required',
  '6. a non-whitelist updater cannot add a financial source key'
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-LOCATION-001',
      '{"paidAmount":0}'::jsonb
    )$$,
  '42501',
  'project financial write permission required',
  '6. a non-whitelist updater cannot restore a removed legacy financial key'
);
insert into task5_results (result_name, result_payload)
values (
  'ordinary-base-update',
  public.update_project_secure(
    'T5-CORE-001',
    '{"remark":"普通员工基础更新"}'::jsonb
  )
);
select ok(
  (
    select count(*) = 31 and bool_and(not result.result_payload ? financial.key)
    from task5_results as result
    cross join task5_financial_keys as financial
    where result.result_name = 'ordinary-base-update'
  ),
  '17. a non-whitelist update response omits every financial key'
);
reset role;
select is(
  (
    select jsonb_object_agg(financial.key, project.payload->financial.key)
    from public.projects as project
    cross join task5_results as snapshot
    cross join task5_financial_keys as financial
    where project.record_key = 'T5-CORE-001'
      and snapshot.result_name = 'core-financial-before'
  ),
  (
    select result_payload
    from task5_results
    where result_name = 'core-financial-before'
  ),
  '12. a base-only update preserves all 31 pre-existing financial keys and values'
);
select is(
  (
    select payload->>'remark'
    from public.projects
    where record_key = 'T5-CORE-001'
  ),
  '普通员工基础更新'::text,
  '12. the same update merges the requested base field'
);

-- Case 7: lifecycle states that require a site location fail closed on create
-- and update unless coordinates were confirmed for the current normalized address.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'ordinary'),
  true
);
select throws_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('待开工但未定位', '待开工', '')
    )$$,
  '22023',
  'project location confirmation required',
  '7. 待开工 create requires confirmed current-address coordinates'
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-LOCATION-001',
      '{"status":"进行中"}'::jsonb
    )$$,
  '22023',
  'project location confirmation required',
  '7. 进行中 update requires confirmed current-address coordinates'
);

-- Cases 8 and 17: assignee snapshots are canonicalized by employee ID, and the
-- create response still applies the ordinary financial projection.
insert into task5_results (result_name, result_payload)
values (
  'assignee-create',
  public.create_project_secure(
    pg_temp.task5_project_input(
      '担当正本化项目',
      '报价中',
      '52000000-0000-4000-8000-000000000010'
    )
  )
);
select ok(
  (
    select result_payload @> jsonb_build_object(
      'designAssigneeEmployeeId', '52000000-0000-4000-8000-000000000010',
      'designAssigneeEmployeeNumber', 'SW-5110',
      'designAssigneeName', '设计担当正本'
    )
    from task5_results
    where result_name = 'assignee-create'
  ),
  '8. create overwrites spoofed assignee number and name from the canonical profile'
);
select ok(
  (
    select count(*) = 31 and bool_and(not result.result_payload ? financial.key)
    from task5_results as result
    cross join task5_financial_keys as financial
    where result.result_name = 'assignee-create'
  ),
  '17. a non-whitelist create response omits every financial key'
);
select throws_ok(
  $$select public.update_project_secure(
      (select result_payload->>'projectId'
       from task5_results where result_name = 'assignee-create'),
      jsonb_build_object(
        'siteAssigneeEmployeeId', '52000000-0000-4000-8000-000000000010',
        'siteAssigneeEmployeeNumber', 'SW-SPOOF',
        'siteAssigneeName', '伪造现场担当'
      )
    )$$,
  '22023',
  'project assignee unavailable',
  '8. an assignee ID from the wrong department is rejected'
);
reset role;

select ok(
  (
    select project.payload->>'contractRevenueSetupStatus' = 'not_started'
      and project.payload->>'designAssigneeEmployeeNumber' = 'SW-5110'
      and project.payload->>'designAssigneeName' = '设计担当正本'
    from public.projects as project
    cross join task5_results as result
    where result.result_name = 'assignee-create'
      and project.record_key = result.result_payload->>'projectId'
  ),
  '17. create stores its server-owned setup status and canonical assignee snapshots'
);

update public.employee_profiles
set name = '改名后的设计担当', employment_status = '离职'
where id = '52000000-0000-4000-8000-000000000010';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'ordinary'),
  true
);
insert into task5_results (result_name, result_payload)
values (
  'assignee-snapshot-only',
  public.update_project_secure(
    (select result_payload->>'projectId'
     from task5_results where result_name = 'assignee-create'),
    '{
      "designAssigneeEmployeeNumber":"SW-SPOOF-ONLY",
      "designAssigneeName":"伪造快照"
    }'::jsonb
  )
);
select ok(
  (
    select result_payload @> jsonb_build_object(
      'designAssigneeEmployeeId', '52000000-0000-4000-8000-000000000010',
      'designAssigneeEmployeeNumber', 'SW-5110',
      'designAssigneeName', '设计担当正本'
    )
    from task5_results
    where result_name = 'assignee-snapshot-only'
  ),
  '8. snapshot-only edits cannot spoof a stored assignee'
);
insert into task5_results (result_name, result_payload)
values (
  'assignee-unchanged-id',
  public.update_project_secure(
    (select result_payload->>'projectId'
     from task5_results where result_name = 'assignee-create'),
    jsonb_build_object(
      'designAssigneeEmployeeId', '52000000-0000-4000-8000-000000000010',
      'designAssigneeEmployeeNumber', 'SW-SPOOF-UNCHANGED',
      'designAssigneeName', '改名后的伪造快照'
    )
  )
);
select ok(
  (
    select result_payload @> jsonb_build_object(
      'designAssigneeEmployeeId', '52000000-0000-4000-8000-000000000010',
      'designAssigneeEmployeeNumber', 'SW-5110',
      'designAssigneeName', '设计担当正本'
    )
    from task5_results
    where result_name = 'assignee-unchanged-id'
  ),
  '8. an unchanged ID preserves the historical snapshot after rename and retirement'
);

-- Case 11: the same advisory-lock allocator also produces distinct sequential IDs
-- in pgTAP; committed two-connection concurrency is verified outside this session.
insert into task5_results (result_name, result_payload)
values
  (
    'sequential-create-1',
    public.create_project_secure(
      pg_temp.task5_project_input('连续创建一', '报价中', '')
    )
  ),
  (
    'sequential-create-2',
    public.create_project_secure(
      pg_temp.task5_project_input('连续创建二', '报价中', '')
    )
  );
select ok(
  (
    select first.result_payload->>'projectId'
      <> second.result_payload->>'projectId'
      and first.result_payload->>'projectId' ~ '^P[0-9]{3,}$'
      and second.result_payload->>'projectId' ~ '^P[0-9]{3,}$'
    from task5_results as first
    cross join task5_results as second
    where first.result_name = 'sequential-create-1'
      and second.result_name = 'sequential-create-2'
  ),
  '11. sequential creates receive distinct server-generated Pxxx IDs'
);

-- Case 13: soft delete locks the active envelope, returns text, and performs no
-- physical delete.
select is(
  public.soft_delete_project_secure('T5-DELETE-001'),
  'T5-DELETE-001'::text,
  '13. soft delete returns the deleted project ID as text'
);
reset role;
select is(
  (select status from public.projects where record_key = 'T5-DELETE-001'),
  'deleted'::text,
  '13. soft delete retains the envelope with deleted status'
);

-- Case 10: anonymous, disabled, former, and must-change-password identities all
-- fail before project data is returned.
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $$select * from public.list_projects_secure()$$,
  '%permission denied for function list_projects_secure%',
  '10. anonymous cannot execute the project list RPC'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'disabled'),
  true
);
select throws_ok(
  $$select * from public.list_projects_secure()$$,
  '42501',
  'project view permission required',
  '10. a disabled employee cannot list projects'
);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'former'),
  true
);
select throws_ok(
  $$select * from public.list_projects_secure()$$,
  '42501',
  'project view permission required',
  '10. a former employee cannot list projects'
);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'must-change'),
  true
);
select throws_ok(
  $$select * from public.list_projects_secure()$$,
  '42501',
  'project view permission required',
  '10. a must-change-password employee cannot list projects'
);

-- Case 20: object shape, name, lifecycle, scalar types, coordinate ranges, and
-- positive radius are all validated server-side. NFKC-equivalent addresses pass.
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'ordinary'),
  true
);
select throws_ok(
  $$select public.create_project_secure('[]'::jsonb)$$,
  '22023',
  'project payload must be an object',
  '20. project payload must be a JSON object'
);
select throws_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('   ', '报价中', '')
    )$$,
  '22023',
  'project name is required',
  '20. projectName must be a nonblank string'
);
select throws_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('非法状态', '未知状态', '')
    )$$,
  '22023',
  'invalid project status',
  '20. project status must be one of the exact seven lifecycle values'
);
select throws_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('错误类型', '报价中', '')
        || '{"customerName":42}'::jsonb
    )$$,
  '22023',
  'invalid project field type',
  '20. textual base fields reject non-string JSON values'
);
select throws_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('错误纬度', '报价中', '')
        || '{"latitude":91,"longitude":0}'::jsonb
    )$$,
  '22023',
  'invalid project coordinates',
  '20. coordinates must be numeric or null and remain in range'
);
select throws_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('错误范围', '报价中', '')
        || '{"attendanceRadiusMeters":0}'::jsonb
    )$$,
  '22023',
  'project attendance radius must be positive',
  '20. attendance radius must be a positive number'
);
select lives_ok(
  $$select public.create_project_secure(
      pg_temp.task5_project_input('NFKC定位项目', '待开工', '')
        || jsonb_build_object(
          'address', '　東京都' || chr(9) || '江東区　',
          'latitude', 0,
          'longitude', 0,
          'locationConfirmedAt', '2026-07-15T01:02:03Z',
          'locationAddressSnapshot', '東京都 江東区'
        )
    )$$,
  '20. NFKC, trim, and collapsed-whitespace address equivalence is accepted'
);

reset role;
insert into task5_results (result_name, result_payload)
values ('confirmation-before', jsonb_build_object('at', clock_timestamp()));

-- Cases 16 and 19: derived read-model keys are never writable; confirmation
-- metadata is accepted only with a real transition and is always server-owned.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'finance'),
  true
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-CONFIRM-001',
      '{"adjustedTaxInclusiveAmount":999999999}'::jsonb
    )$$,
  '22023',
  'unsupported project field',
  '16. even a whitelist updater cannot submit a derived read-model key'
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-CONFIRM-001',
      '{
        "contractConfirmedById":"spoof-only",
        "contractConfirmedByName":"伪造确认人",
        "contractConfirmedAt":"2000-01-01T00:00:00Z"
      }'::jsonb
    )$$,
  '22023',
  'confirmation transition required',
  '19. actor/time keys are rejected outside a confirmation transition'
);
insert into task5_results (result_name, result_payload)
values (
  'confirmed-transition',
  public.update_project_secure(
    'T5-CONFIRM-001',
    '{
      "contractConfirmationStatus":"confirmed",
      "contractConfirmedById":"spoof-transition",
      "contractConfirmedByName":"伪造确认人",
      "contractConfirmedAt":"2000-01-01T00:00:00Z"
    }'::jsonb
  )
);
select ok(
  (
    select result_payload->>'contractConfirmedById'
        = '52000000-0000-4000-8000-000000000003'
      and result_payload->>'contractConfirmedByName' = '财务白名单员工'
      and (result_payload->>'contractConfirmedAt')::timestamptz
        >= (select (result_payload->>'at')::timestamptz
            from task5_results where result_name = 'confirmation-before')
    from task5_results
    where result_name = 'confirmed-transition'
  ),
  '16. a confirmation transition stores canonical actor identity and server time'
);
select throws_ok(
  $$select public.update_project_secure(
      'T5-CONFIRM-001',
      '{"contractConfirmedByName":"二次伪造"}'::jsonb
    )$$,
  '22023',
  'confirmation transition required',
  '19. actor metadata cannot be patched after the contract is confirmed'
);

-- Case 14: positive-paid migration is one atomic, idempotent operation with a
-- deterministic receipt whose conflict is verified before project advancement.
insert into task5_results (result_name, result_payload)
values (
  'legacy-positive',
  public.migrate_legacy_project_contract_secure(
    'T5-LEGACY-001',
    '{"contractAmount":800000,"paidAmount":120000}'::jsonb,
    '{
      "receiptId":"legacy-opening-receipt-v1:T5-LEGACY-001",
      "projectId":"T5-LEGACY-001",
      "receiptType":"opening_balance",
      "taxInclusiveAmount":120000,
      "statusCode":"active",
      "sourceCode":"legacy_contract_migration"
    }'::jsonb
  )
);
select ok(
  (
    select not result_payload ?| array[
        'contractAmount', 'paidAmount', 'paymentProgress', 'paymentStatus'
      ]
      and result_payload @> '{
        "contractRevenueSchemaVersion":1,
        "originalContractTaxExclusiveAmount":800000,
        "originalContractTaxRate":0,
        "originalContractTaxAmount":0,
        "originalContractTaxInclusiveAmount":800000,
        "contractConfirmationStatus":"historical_migrated_confirmed",
        "needsManualReview":true
      }'::jsonb
    from task5_results
    where result_name = 'legacy-positive'
  ),
  '14. positive-paid migration removes legacy keys and writes exact schema fields'
);
reset role;
select is(
  (
    select count(*)
    from public.project_receipts
    where record_key = 'legacy-opening-receipt-v1:T5-LEGACY-001'
      and status = 'active'
      and payload @> '{
        "receiptId":"legacy-opening-receipt-v1:T5-LEGACY-001",
        "projectId":"T5-LEGACY-001",
        "receiptType":"opening_balance",
        "taxInclusiveAmount":120000,
        "statusCode":"active",
        "sourceCode":"legacy_contract_migration"
      }'::jsonb
  ),
  1::bigint,
  '14. positive paid amount creates exactly one deterministic opening receipt'
);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'finance'),
  true
);
select is(
  public.migrate_legacy_project_contract_secure(
    'T5-LEGACY-001',
    '{"contractAmount":800000,"paidAmount":120000}'::jsonb,
    '{
      "receiptId":"legacy-opening-receipt-v1:T5-LEGACY-001",
      "projectId":"T5-LEGACY-001",
      "receiptType":"opening_balance",
      "taxInclusiveAmount":120000,
      "statusCode":"active",
      "sourceCode":"legacy_contract_migration"
    }'::jsonb
  ),
  (select result_payload from task5_results where result_name = 'legacy-positive'),
  '14. identical migration replay returns the already-migrated project'
);
reset role;
select is(
  (
    select count(*)
    from public.project_receipts
    where record_key = 'legacy-opening-receipt-v1:T5-LEGACY-001'
  ),
  1::bigint,
  '14. identical migration replay never duplicates the opening receipt'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'finance'),
  true
);
select throws_ok(
  $$select public.migrate_legacy_project_contract_secure(
      'T5-LEGACY-MISMATCH',
      '{"contractAmount":700000,"paidAmount":70001}'::jsonb,
      '{
        "receiptId":"legacy-opening-receipt-v1:T5-LEGACY-MISMATCH",
        "projectId":"T5-LEGACY-MISMATCH",
        "receiptType":"opening_balance",
        "taxInclusiveAmount":70001,
        "statusCode":"active",
        "sourceCode":"legacy_contract_migration"
      }'::jsonb
    )$$,
  '40001',
  'legacy project contract changed',
  '14. stale expected legacy amounts abort with serialization failure'
);
reset role;
select ok(
  not exists (
    select 1 from public.project_receipts
    where record_key = 'legacy-opening-receipt-v1:T5-LEGACY-MISMATCH'
  )
  and not (
    select payload ? 'contractRevenueSchemaVersion'
    from public.projects where record_key = 'T5-LEGACY-MISMATCH'
  ),
  '14. mismatch commits neither receipt nor project migration'
);

-- Case 18: zero-paid migration requires SQL NULL, creates no receipt, still
-- advances the project, and replays idempotently.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config(
  'request.jwt.claim.sub',
  (select auth_user_id::text from task5_identities where identity_name = 'finance'),
  true
);
insert into task5_results (result_name, result_payload)
values (
  'legacy-zero',
  public.migrate_legacy_project_contract_secure(
    'T5-LEGACY-ZERO',
    '{"contractAmount":500000,"paidAmount":0}'::jsonb,
    null::jsonb
  )
);
select ok(
  (
    select not result_payload ?| array[
        'contractAmount', 'paidAmount', 'paymentProgress', 'paymentStatus'
      ]
      and result_payload @> '{
        "contractRevenueSchemaVersion":1,
        "originalContractTaxInclusiveAmount":500000,
        "contractConfirmationStatus":"historical_migrated_confirmed",
        "needsManualReview":true
      }'::jsonb
    from task5_results
    where result_name = 'legacy-zero'
  ),
  '18. zero-paid migration advances the project without legacy fields'
);
select is(
  public.migrate_legacy_project_contract_secure(
    'T5-LEGACY-ZERO',
    '{"contractAmount":500000,"paidAmount":0}'::jsonb,
    null::jsonb
  ),
  (select result_payload from task5_results where result_name = 'legacy-zero'),
  '18. zero-paid migration replays idempotently'
);
reset role;
select is(
  (
    select count(*)
    from public.project_receipts
    where record_key = 'legacy-opening-receipt-v1:T5-LEGACY-ZERO'
  ),
  0::bigint,
  '18. zero-paid migration creates no opening receipt'
);

select * from finish();
rollback;

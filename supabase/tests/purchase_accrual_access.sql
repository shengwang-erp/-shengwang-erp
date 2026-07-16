begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select no_plan();

select has_function(
  'private',
  'purchase_payment_payload_keys',
  array[]::text[],
  'purchase payment projection key helper exists'
);
select has_function(
  'private',
  'purchase_client_audit_payload_keys',
  array[]::text[],
  'purchase client audit rejection key helper exists'
);
select has_function(
  'public',
  'list_purchase_records_secure',
  array[]::text[],
  'secure purchase list RPC exists'
);
select has_function(
  'public',
  'upsert_purchase_record_secure',
  array['text', 'jsonb', 'text'],
  'secure purchase upsert RPC exists'
);
select has_function(
  'public',
  'soft_delete_purchase_record_secure',
  array['text'],
  'secure purchase soft-delete RPC exists'
);

create temporary table task7_helper_results (
  helper_name text primary key,
  payload_keys text[] not null
) on commit drop;

select lives_ok(
  $$insert into pg_temp.task7_helper_results (helper_name, payload_keys)
    values ('payment', private.purchase_payment_payload_keys())$$,
  'purchase payment projection helper can be evaluated'
);
select is(
  (
    select payload_keys
    from task7_helper_results
    where helper_name = 'payment'
  ),
  array[
    'openingPaidAmount',
    'paidAmount',
    'unpaidAmount',
    'paymentStatus'
  ]::text[],
  'purchase payment projection helper returns exactly the four payment keys'
);

select lives_ok(
  $$insert into pg_temp.task7_helper_results (helper_name, payload_keys)
    values ('audit', private.purchase_client_audit_payload_keys())$$,
  'purchase client audit rejection helper can be evaluated'
);
select is(
  (
    select payload_keys
    from task7_helper_results
    where helper_name = 'audit'
  ),
  array[
    'created_by_employee_id',
    'created_by_employee_name',
    'updated_by_employee_id',
    'updated_by_employee_name',
    'createdByEmployeeId',
    'createdByEmployeeName',
    'updatedByEmployeeId',
    'updatedByEmployeeName'
  ]::text[],
  'purchase client audit rejection helper returns exactly the eight audit keys'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'list_purchase_records_secure',
        'upsert_purchase_record_secure',
        'soft_delete_purchase_record_secure'
      )
      and procedure.prosecdef
      and procedure.proconfig =
        array['search_path=pg_catalog, public, private']::text[]
  ),
  3::bigint,
  'all purchase RPCs are security definer functions with a pinned search path'
);

select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name in (
        'list_purchase_records_secure',
        'upsert_purchase_record_secure',
        'soft_delete_purchase_record_secure'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  6::bigint,
  'purchase RPC execution is granted only to authenticated and service_role'
);

select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'private'
      and routine_name in (
        'purchase_payment_payload_keys',
        'purchase_client_audit_payload_keys'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'private purchase helpers expose no execution grant to browser or service roles'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_records'
  ),
  3::bigint,
  'purchase_records retains its three existing direct-table RLS policies'
);
select results_eq(
  $$select policyname, cmd
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_records'
    order by policyname$$,
  $$values
    ('purchase_records authenticated insert'::name, 'INSERT'::text),
    ('purchase_records authenticated select'::name, 'SELECT'::text),
    ('purchase_records authenticated update'::name, 'UPDATE'::text)$$,
  'purchase_records policy names and commands are unchanged'
);
select ok(
  has_table_privilege('authenticated', 'public.purchase_records', 'SELECT')
    and has_table_privilege('authenticated', 'public.purchase_records', 'INSERT')
    and has_table_privilege('authenticated', 'public.purchase_records', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.purchase_records', 'DELETE')
    and not has_table_privilege('authenticated', 'public.purchase_records', 'TRUNCATE'),
  'purchase_records direct table privileges remain SELECT, INSERT, and UPDATE only'
);

create temporary table task7_list_results (
  scenario text not null,
  record_key text not null,
  payload jsonb not null,
  status text not null,
  updated_at timestamptz not null
) on commit drop;
grant select, insert, update, delete on table task7_list_results
  to authenticated, service_role;

create temporary table task7_mutation_results (
  scenario text primary key,
  result jsonb not null
) on commit drop;
grant select, insert, update, delete on table task7_mutation_results
  to authenticated, service_role;

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
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task7-purchase-accrual@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task7-purchase-sensitive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'task7-purchase-none@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'task7-purchase-disabled@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'task7-purchase-create-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'task7-purchase-update-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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
  ('72000000-0000-4000-8000-000000000001', 'SW-7201', '71000000-0000-4000-8000-000000000001', '采购权责测试员工', '采购部', '部长', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000002', 'SW-7202', '71000000-0000-4000-8000-000000000002', '采购付款测试员工', '财务部', '会计', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000003', 'SW-7203', '71000000-0000-4000-8000-000000000003', '无采购权限员工', '电商部', '主任', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000004', 'SW-7204', '71000000-0000-4000-8000-000000000004', '停用采购员工', '仓库管理部', '仓库管理员', '在职', 'disabled', false, false),
  ('72000000-0000-4000-8000-000000000005', 'SW-7205', '71000000-0000-4000-8000-000000000005', '仅新建采购员工', '后勤部', '大工', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000006', 'SW-7206', '71000000-0000-4000-8000-000000000006', '仅更新采购员工', '事务部', '中工', '在职', 'active', false, false);

delete from public.permission_grants
where subject_type = 'department'
  and subject_code in ('采购部', '财务部', '电商部', '仓库管理部', '后勤部', '事务部')
  and (
    permission_key like 'module.purchases.%'
    or permission_key like 'sensitive.purchase_payments_%'
  );

insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
) values
  ('department', '采购部', 'module.purchases.view'),
  ('department', '采购部', 'module.purchases.create'),
  ('department', '采购部', 'module.purchases.update'),
  ('department', '采购部', 'module.purchases.delete'),
  ('department', '财务部', 'module.purchases.view'),
  ('department', '财务部', 'module.purchases.create'),
  ('department', '财务部', 'module.purchases.update'),
  ('department', '财务部', 'module.purchases.delete'),
  ('department', '财务部', 'sensitive.purchase_payments_view'),
  ('department', '财务部', 'sensitive.purchase_payments_update'),
  ('department', '仓库管理部', 'module.purchases.view'),
  ('department', '后勤部', 'module.purchases.create'),
  ('department', '事务部', 'module.purchases.update');

insert into public.purchase_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'PO-TASK7-001',
    '{
      "purchaseId":"PO-TASK7-001",
      "purchaseDate":"2026-07-16",
      "itemName":"迁移前采购",
      "totalCost":80000,
      "purchaseStatus":"正常",
      "openingPaidAmount":10000,
      "paidAmount":20000,
      "unpaidAmount":60000,
      "paymentStatus":"部分付款"
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-DELETED',
    '{
      "purchaseId":"PO-TASK7-DELETED",
      "itemName":"已删除采购",
      "totalCost":1000,
      "paidAmount":500
    }'::jsonb,
    'deleted',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$insert into pg_temp.task7_list_results (
      scenario, record_key, payload, status, updated_at
    )
    select
      'accrual-list', listed.record_key, listed.payload, listed.status, listed.updated_at
    from public.list_purchase_records_secure() as listed$$,
  'an active purchase viewer can call the secure list RPC'
);
select is(
  (select count(*) from task7_list_results where scenario = 'accrual-list'),
  1::bigint,
  'the secure list excludes deleted records'
);
select ok(
  (
    select payload @> '{
        "purchaseId":"PO-TASK7-001",
        "itemName":"迁移前采购",
        "totalCost":80000
      }'::jsonb
      and not payload ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and status = 'active'
      and updated_at is not null
    from task7_list_results
    where scenario = 'accrual-list'
      and record_key = 'PO-TASK7-001'
  ),
  'module-only purchase view returns accrual fields in the standard envelope without payment fields'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.list_purchase_records_secure()$$,
  '42501',
  'purchase view permission required',
  'an active employee without the purchase module receives 42501'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_purchase_records_secure()$$,
  '42501',
  'purchase view permission required',
  'an inactive purchase-module employee receives 42501'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-NON-OBJECT',
      '[]'::jsonb,
      'active'
    )$$,
  '22023',
  'purchase payload must be a JSON object',
  'purchase upsert rejects a non-object JSON payload'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      '   ',
      '{}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a blank record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      ' PO-TASK7-001 ',
      '{"purchaseId":" PO-TASK7-001 "}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a record key that differs from its trimmed form'
);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'accrual-update',
      public.upsert_purchase_record_secure(
        'PO-TASK7-001',
        '{
          "purchaseId":"PO-TASK7-001",
          "itemName":"权责字段更新",
          "paidAmount":79999,
          "unpaidAmount":1,
          "paymentStatus":"已付清"
        }'::jsonb,
        'active'
      )
    )$$,
  'a module-only updater can update purchase accrual fields'
);
select ok(
  (
    select result->'payload'->>'itemName' = '权责字段更新'
      and not (result->'payload') ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and result->>'record_key' = 'PO-TASK7-001'
      and result->>'status' = 'active'
      and result ? 'updated_at'
    from task7_mutation_results
    where scenario = 'accrual-update'
  ),
  'a module-only upsert response is bound to the record and remains payment-redacted'
);

select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001","createdByEmployeeName":"伪造审计"}'::jsonb,
      'active'
    )$$,
  '22023',
  'client audit fields are not accepted',
  'purchase upsert rejects client-supplied audit identity fields'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001"}'::jsonb,
      'deleted'
    )$$,
  '22023',
  'purchase status must be active',
  'purchase upsert cannot request deleted status'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001"}'::jsonb,
      'void'
    )$$,
  '22023',
  'purchase status must be active',
  'purchase upsert cannot request void status'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-OTHER"}'::jsonb,
      'active'
    )$$,
  '22023',
  'purchase record key mismatch',
  'purchase upsert rejects a payload key mismatch'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-DELETED',
      '{"purchaseId":"PO-TASK7-DELETED","itemName":"禁止恢复"}'::jsonb,
      'active'
    )$$,
  'P0002',
  'purchase record not found',
  'purchase upsert cannot resurrect a deleted row'
);

reset role;
select is(
  (select payload->>'itemName' from public.purchase_records where record_key = 'PO-TASK7-001'),
  '权责字段更新'::text,
  'module-only update stores the requested accrual change'
);
select is(
  (
    select jsonb_build_object(
      'openingPaidAmount', payload->'openingPaidAmount',
      'paidAmount', payload->'paidAmount',
      'unpaidAmount', payload->'unpaidAmount',
      'paymentStatus', payload->'paymentStatus'
    )
    from public.purchase_records
    where record_key = 'PO-TASK7-001'
  ),
  '{
    "openingPaidAmount":10000,
    "paidAmount":20000,
    "unpaidAmount":60000,
    "paymentStatus":"部分付款"
  }'::jsonb,
  'module-only update preserves every server-side payment field'
);
select is(
  (
    select updated_by_employee_id || ':' || updated_by_employee_name
    from public.purchase_records
    where record_key = 'PO-TASK7-001'
  ),
  '72000000-0000-4000-8000-000000000001:采购权责测试员工'::text,
  'purchase update audit identity comes from auth.uid()'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001","itemName":"越权覆盖"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase update permission required',
  'create-only permission cannot overwrite an existing purchase'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UPDATE-ONLY',
      '{"purchaseId":"PO-TASK7-UPDATE-ONLY","itemName":"越权新建"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase create permission required',
  'update-only permission cannot create a missing purchase'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'sensitive-update',
      public.upsert_purchase_record_secure(
        'PO-TASK7-001',
        '{
          "purchaseId":"PO-TASK7-001",
          "openingPaidAmount":11000,
          "paidAmount":30000,
          "unpaidAmount":50000,
          "paymentStatus":"部分付款"
        }'::jsonb,
        'active'
      )
    )$$,
  'a payment-sensitive updater can update purchase payment fields'
);
select ok(
  (
    select (result->'payload') @> '{
        "openingPaidAmount":11000,
        "paidAmount":30000,
        "unpaidAmount":50000,
        "paymentStatus":"部分付款"
      }'::jsonb
    from task7_mutation_results
    where scenario = 'sensitive-update'
  ),
  'a payment-sensitive updater receives the updated payment fields'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'accrual-create',
      public.upsert_purchase_record_secure(
        'PO-TASK7-CREATED',
        '{
          "purchaseId":"PO-TASK7-CREATED",
          "purchaseDate":"2026-07-17",
          "itemName":"新建权责采购",
          "totalCost":5000,
          "openingPaidAmount":1000,
          "paidAmount":1000,
          "unpaidAmount":4000,
          "paymentStatus":"部分付款"
        }'::jsonb,
        'active'
      )
    )$$,
  'a module-only creator can create an accrual purchase while payment input is stripped'
);
select ok(
  (
    select result->'payload' @> '{
        "purchaseId":"PO-TASK7-CREATED",
        "itemName":"新建权责采购",
        "totalCost":5000
      }'::jsonb
      and not (result->'payload') ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
    from task7_mutation_results
    where scenario = 'accrual-create'
  ),
  'module-only create response contains accrual fields and no payment fields'
);

reset role;
select ok(
  (
    select payload @> '{
        "purchaseId":"PO-TASK7-CREATED",
        "itemName":"新建权责采购",
        "totalCost":5000
      }'::jsonb
      and not payload ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and created_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and created_by_employee_name = '采购权责测试员工'
      and updated_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and updated_by_employee_name = '采购权责测试员工'
      and status = 'active'
    from public.purchase_records
    where record_key = 'PO-TASK7-CREATED'
  ),
  'module-only create strips payment fields and writes server-derived audit identity'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'soft-delete',
      to_jsonb(public.soft_delete_purchase_record_secure('PO-TASK7-CREATED'))
    )$$,
  'an authorized purchase deleter can use the soft-delete RPC'
);
select is(
  (select result from task7_mutation_results where scenario = 'soft-delete'),
  '"PO-TASK7-CREATED"'::jsonb,
  'soft-delete returns the exact deleted record key'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-CREATED')$$,
  'P0002',
  'purchase record not found',
  'a soft-deleted purchase cannot be deleted again'
);

reset role;
select ok(
  (
    select status = 'deleted'
      and updated_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and updated_by_employee_name = '采购权责测试员工'
    from public.purchase_records
    where record_key = 'PO-TASK7-CREATED'
  ),
  'soft-delete changes only server-controlled state and audit identity'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.purchase_records),
  0::bigint,
  'module-only purchase access still cannot read the direct sensitive table'
);
select results_eq(
  $$with changed as (
      update public.purchase_records
      set payload = payload || '{"directBypass":true}'::jsonb
      where record_key = 'PO-TASK7-001'
      returning 1
    )
    select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'module-only purchase access still cannot update the direct sensitive table'
);
select throws_like(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-DIRECT',
      '{"purchaseId":"PO-TASK7-DIRECT"}'::jsonb,
      'active'
    )$$,
  '%violates row-level security policy%',
  'module-only purchase access still cannot insert through direct table RLS'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $$select * from public.list_purchase_records_secure()$$,
  '%permission denied for function list_purchase_records_secure%',
  'anon cannot execute the purchase list RPC'
);
select throws_like(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-ANON',
      '{"purchaseId":"PO-TASK7-ANON"}'::jsonb,
      'active'
    )$$,
  '%permission denied for function upsert_purchase_record_secure%',
  'anon cannot execute the purchase upsert RPC'
);
select throws_like(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-001')$$,
  '%permission denied for function soft_delete_purchase_record_secure%',
  'anon cannot execute the purchase soft-delete RPC'
);

reset role;
select * from finish();
rollback;

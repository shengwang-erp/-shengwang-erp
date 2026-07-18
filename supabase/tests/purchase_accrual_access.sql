begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
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
  'private',
  'purchase_payload_has_unsafe_keys',
  array['jsonb'],
  'recursive unsafe purchase payload key helper exists'
);
select has_function(
  'private',
  'lock_purchase_record_key',
  array['text'],
  'purchase record advisory lock helper exists'
);
select has_function(
  'private',
  'guard_purchase_records_direct_write',
  array[]::text[],
  'purchase direct-write trigger guard exists'
);
select has_function(
  'private',
  'guard_purchase_link_fact_write',
  array[]::text[],
  'purchase linked-fact write guard exists'
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
select has_function(
  'public',
  'commit_purchase_stock_in_secure',
  array['text', 'jsonb', 'text', 'jsonb', 'text', 'jsonb'],
  'transactional purchase stock-in RPC exists with the approved signature'
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
        'soft_delete_purchase_record_secure',
        'commit_purchase_stock_in_secure'
      )
      and procedure.prosecdef
      and procedure.proconfig =
        array['search_path=pg_catalog, public, private']::text[]
  ),
  4::bigint,
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
        'soft_delete_purchase_record_secure',
        'commit_purchase_stock_in_secure'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  8::bigint,
  'purchase RPC execution is granted only to authenticated and service_role'
);

select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'private'
      and routine_name in (
        'purchase_payment_payload_keys',
        'purchase_client_audit_payload_keys',
        'purchase_payload_has_unsafe_keys',
        'lock_purchase_record_key',
        'guard_purchase_records_direct_write',
        'guard_purchase_link_fact_write'
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
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_records_direct_write'
      and not procedure.prosecdef
      and procedure.proconfig = array['search_path=pg_catalog']::text[]
  ),
  1::bigint,
  'purchase direct-write guard is SECURITY INVOKER with a pinned pg_catalog path'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname = 'purchase_records'
      and trigger.tgname = 'block_purchase_records_direct_write'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 31
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_records_direct_write'
  ),
  1::bigint,
  'purchase_records has one enabled row-level BEFORE INSERT/UPDATE/DELETE guard'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_link_fact_write'
      and procedure.prosecdef
      and procedure.proconfig =
        array['search_path=pg_catalog, public, private']::text[]
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%private.lock_purchase_record_key%'
  ),
  1::bigint,
  'linked-fact guard is pinned, privileged, and uses the shared purchase lock'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname in ('purchase_payment_records', 'stock_in_records')
      and trigger.tgname = 'guard_active_purchase_link'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 31
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_link_fact_write'
  ),
  2::bigint,
  'payment and stock-in writes share enabled row-level purchase-link guards'
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
select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'policyname', policyname,
        'cmd', cmd,
        'qual', qual,
        'with_check', with_check
      )
      order by policyname
    )
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_records'
  ),
  '[
    {
      "policyname":"purchase_records authenticated insert",
      "cmd":"INSERT",
      "qual":null,
      "with_check":"(is_current_employee_active() AND has_current_permission(''module.purchases.create''::text) AND has_current_permission(''sensitive.purchase_payments_update''::text) AND (status = ''active''::text))"
    },
    {
      "policyname":"purchase_records authenticated select",
      "cmd":"SELECT",
      "qual":"(is_current_employee_active() AND has_current_permission(''module.purchases.view''::text) AND has_current_permission(''sensitive.purchase_payments_view''::text))",
      "with_check":null
    },
    {
      "policyname":"purchase_records authenticated update",
      "cmd":"UPDATE",
      "qual":"(is_current_employee_active() AND (has_current_permission(''module.purchases.update''::text) OR has_current_permission(''module.purchases.delete''::text)) AND has_current_permission(''sensitive.purchase_payments_update''::text))",
      "with_check":"(is_current_employee_active() AND (has_current_permission(''module.purchases.update''::text) OR has_current_permission(''module.purchases.delete''::text)) AND has_current_permission(''sensitive.purchase_payments_update''::text))"
    }
  ]'::jsonb,
  'purchase_records policy names, commands, qual, and with_check are exactly unchanged'
);
select ok(
  has_table_privilege('authenticated', 'public.purchase_records', 'SELECT')
    and has_table_privilege('authenticated', 'public.purchase_records', 'INSERT')
    and has_table_privilege('authenticated', 'public.purchase_records', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.purchase_records', 'DELETE')
    and not has_table_privilege('authenticated', 'public.purchase_records', 'TRUNCATE'),
  'purchase_records direct table privileges remain SELECT, INSERT, and UPDATE only'
);

create or replace function pg_temp.purchase_same_key_lock_serializes()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  lock_was_blocked boolean := false;
  released_lock_key bigint;
  poll_attempt integer;
  connection_names text[];
begin
  if to_regprocedure('private.lock_purchase_record_key(text)') is null then
    return false;
  end if;

  perform extensions.dblink_connect(
    'task7_purchase_lock_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_purchase_lock_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_exec('task7_purchase_lock_a', 'begin');
  perform extensions.dblink_exec(
    'task7_purchase_lock_a',
    'do $remote$ begin perform private.lock_purchase_record_key(''PO-TASK7-CONCURRENCY''); end $remote$'
  );

  if extensions.dblink_send_query(
    'task7_purchase_lock_b',
    'select private.lock_purchase_record_key(''PO-TASK7-CONCURRENCY'') as lock_key'
  ) <> 1 then
    raise exception 'could not dispatch competing purchase lock query';
  end if;

  perform pg_sleep(0.1);
  lock_was_blocked :=
    extensions.dblink_is_busy('task7_purchase_lock_b') = 1;
  perform extensions.dblink_exec('task7_purchase_lock_a', 'commit');

  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_purchase_lock_b') = 0;
    perform pg_sleep(0.01);
  end loop;

  select result.lock_key
    into released_lock_key
    from extensions.dblink_get_result('task7_purchase_lock_b')
      as result(lock_key bigint);

  perform extensions.dblink_disconnect('task7_purchase_lock_a');
  perform extensions.dblink_disconnect('task7_purchase_lock_b');

  return lock_was_blocked
    and released_lock_key = hashtextextended(
      'public.purchase_records:PO-TASK7-CONCURRENCY',
      0
    );
exception when others then
  raise notice 'purchase concurrency probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_purchase_lock_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec('task7_purchase_lock_a', 'rollback');
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_purchase_lock_a');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_purchase_lock_b' = any(connection_names) then
    perform extensions.dblink_disconnect('task7_purchase_lock_b');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_same_key_lock_serializes(),
  'two real database sessions serialize on the same purchase advisory key'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and (
        (
          procedure.proname in (
            'upsert_purchase_record_secure',
            'soft_delete_purchase_record_secure'
          )
          and pg_catalog.pg_get_functiondef(procedure.oid)
            like '%private.lock_purchase_record_key(p_record_key)%'
        )
        or (
          procedure.proname = 'commit_purchase_stock_in_secure'
          and pg_catalog.pg_get_functiondef(procedure.oid)
            like '%private.lock_purchase_record_key(p_purchase_record_key)%'
        )
      )
  ),
  3::bigint,
  'every purchase mutation RPC uses the shared same-key lock helper'
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
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'task7-purchase-update-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'task7-purchase-delete-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

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
  ('72000000-0000-4000-8000-000000000006', 'SW-7206', '71000000-0000-4000-8000-000000000006', '仅更新采购员工', '事务部', '中工', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000007', 'SW-7207', '71000000-0000-4000-8000-000000000007', '仅删除采购员工', '设计部', '职长', '在职', 'active', false, false);

delete from public.permission_grants
where subject_type = 'department'
  and subject_code in ('采购部', '财务部', '电商部', '仓库管理部', '后勤部', '事务部', '设计部')
  and (
    permission_key like 'module.purchases.%'
    or permission_key like 'module.inventory.%'
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
  ('department', '采购部', 'module.inventory.create'),
  ('department', '采购部', 'module.inventory.update'),
  ('department', '财务部', 'module.purchases.view'),
  ('department', '财务部', 'module.purchases.create'),
  ('department', '财务部', 'module.purchases.update'),
  ('department', '财务部', 'module.purchases.delete'),
  ('department', '财务部', 'sensitive.purchase_payments_view'),
  ('department', '财务部', 'sensitive.purchase_payments_update'),
  ('department', '仓库管理部', 'module.purchases.view'),
  ('department', '后勤部', 'module.purchases.create'),
  ('department', '事务部', 'module.purchases.update'),
  ('department', '设计部', 'module.purchases.delete');

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
  ),
  (
    'PO-TASK7-STOCK',
    '{
      "purchaseId":"PO-TASK7-STOCK",
      "itemName":"库存测试铜管",
      "specification":"20米",
      "quantity":10,
      "unit":"卷",
      "totalCost":10000,
      "stockInStatus":"未入库",
      "paidAmount":4000,
      "unpaidAmount":6000,
      "paymentStatus":"部分付款"
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-GUARD-UPDATE',
    '{"purchaseId":"PO-TASK7-GUARD-UPDATE","itemName":"直接更新守卫"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-GUARD-DELETE',
    '{"purchaseId":"PO-TASK7-GUARD-DELETE","itemName":"直接删除守卫"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-PAYMENT-LINKED',
    '{"purchaseId":"PO-TASK7-PAYMENT-LINKED","itemName":"已有付款事实"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-STOCK-LINKED',
    '{"purchaseId":"PO-TASK7-STOCK-LINKED","itemName":"已有入库事实"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-DELETE-ONLY',
    '{"purchaseId":"PO-TASK7-DELETE-ONLY","itemName":"仅删除权限目标"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );

insert into public.purchase_payment_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values (
  'PP-TASK7-PURCHASE-LINK',
  '{"paymentId":"PP-TASK7-PURCHASE-LINK","purchaseId":"PO-TASK7-PAYMENT-LINKED","jpyAmount":1000}'::jsonb,
  'active',
  'seed-creator',
  '种子创建人',
  'seed-updater',
  '种子更新人'
);

insert into public.stock_in_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'SI-TASK7-DELETED',
    '{
      "stockInId":"SI-TASK7-DELETED",
      "sourcePurchaseId":"PO-TASK7-STOCK",
      "stockInQuantity":1
    }'::jsonb,
    'deleted',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-PURCHASE-LINK',
    '{
      "stockInId":"SI-TASK7-PURCHASE-LINK",
      "sourcePurchaseId":"PO-TASK7-STOCK-LINKED",
      "stockInQuantity":1
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );

insert into public.inventory_items (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values (
  'INV-TASK7-DELETED',
  '{"inventoryId":"INV-TASK7-DELETED","itemName":"已删除库存"}'::jsonb,
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
  7::bigint,
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
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7;SELECT-pg_sleep',
      '{"purchaseId":"PO-TASK7;SELECT-pg_sleep"}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a semicolon injection-shaped record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-''-DROP',
      '{"purchaseId":"PO-TASK7-''-DROP"}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a quote injection-shaped record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7/../../AUTH',
      '{"purchaseId":"PO-TASK7/../../AUTH"}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a path traversal-shaped record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UNSAFE-PROTO',
      '{
        "purchaseId":"PO-TASK7-UNSAFE-PROTO",
        "__proto__":{"polluted":true}
      }'::jsonb,
      'active'
    )$$,
  '22023',
  'unsafe purchase payload key',
  'purchase upsert rejects a top-level __proto__ key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UNSAFE-CONSTRUCTOR',
      '{
        "purchaseId":"PO-TASK7-UNSAFE-CONSTRUCTOR",
        "nested":{"constructor":{"polluted":true}}
      }'::jsonb,
      'active'
    )$$,
  '22023',
  'unsafe purchase payload key',
  'purchase upsert rejects a nested constructor key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UNSAFE-PROTOTYPE',
      '{
        "purchaseId":"PO-TASK7-UNSAFE-PROTOTYPE",
        "nested":[{"prototype":{"polluted":true}}]
      }'::jsonb,
      'active'
    )$$,
  '22023',
  'unsafe purchase payload key',
  'purchase upsert rejects a prototype key nested through an array'
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
  '23503',
  'purchase record cannot be deleted',
  'a payment-blind deleter gets no linked-fact oracle for a soft-deleted purchase'
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
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'an active payment blocks a payment-blind deleter with a generic rejection'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'an active stock-in blocks a payment-blind deleter with the same generic rejection'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'a payment-sensitive deleter receives the linked-fact advisory'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'the payment-sensitive linked-fact advisory still does not identify the child table'
);

reset role;
select is(
  (
    select count(*)
    from public.purchase_records
    where record_key in ('PO-TASK7-PAYMENT-LINKED', 'PO-TASK7-STOCK-LINKED')
      and status = 'active'
  ),
  2::bigint,
  'linked purchase rows remain active after rejected deletes'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000007', true);
select ok(
  public.has_current_permission('module.purchases.delete')
    and not public.has_current_permission('module.purchases.view')
    and not public.has_current_permission('module.purchases.create')
    and not public.has_current_permission('module.purchases.update')
    and not public.has_current_permission('sensitive.purchase_payments_view')
    and not public.has_current_permission('sensitive.purchase_payments_update'),
  'the delete-only actor has no purchase read/write or payment-sensitive permission'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'a delete-only actor cannot distinguish a payment-linked purchase'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'a delete-only actor cannot distinguish a stock-linked purchase'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-MISSING')$$,
  '23503',
  'purchase record cannot be deleted',
  'a delete-only actor receives the same rejection for an unavailable purchase'
);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'delete-only',
      to_jsonb(public.soft_delete_purchase_record_secure('PO-TASK7-DELETE-ONLY'))
    )$$,
  'a delete-only actor can delete an unlinked purchase'
);

reset role;
select ok(
  (
    select status = 'deleted'
      and updated_by_employee_id = '72000000-0000-4000-8000-000000000007'
      and updated_by_employee_name = '仅删除采购员工'
    from public.purchase_records
    where record_key = 'PO-TASK7-DELETE-ONLY'
  ),
  'delete-only purchase deletion records the server-derived actor'
);

select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      'PP-TASK7-AFTER-DELETE',
      '{"paymentId":"PP-TASK7-AFTER-DELETE","purchaseId":"PO-TASK7-DELETE-ONLY"}'::jsonb,
      'active',
      'seed-creator',
      '种子创建人',
      'seed-updater',
      '种子更新人'
    )$$,
  '23503',
  'active purchase record required',
  'a payment write ordered after purchase deletion cannot create an orphan'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      'SI-TASK7-AFTER-DELETE',
      '{"stockInId":"SI-TASK7-AFTER-DELETE","sourcePurchaseId":"PO-TASK7-DELETE-ONLY"}'::jsonb,
      'active',
      'seed-creator',
      '种子创建人',
      'seed-updater',
      '种子更新人'
    )$$,
  '23503',
  'active purchase record required',
  'a stock-in write ordered after purchase deletion cannot create an orphan'
);
select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key, payload, status
    ) values (
      'PP-TASK7-WHITESPACE-LINK',
      '{"paymentId":"PP-TASK7-WHITESPACE-LINK","purchaseId":" PO-TASK7-PAYMENT-LINKED "}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active payment rejects a whitespace-normalized purchase link'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key, payload, status
    ) values (
      'SI-TASK7-WHITESPACE-LINK',
      '{"stockInId":"SI-TASK7-WHITESPACE-LINK","sourcePurchaseId":" PO-TASK7-STOCK-LINKED "}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active stock-in rejects a whitespace-normalized purchase link'
);
select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key, payload, status
    ) values (
      'PP-TASK7-MISSING-LINK',
      '{"paymentId":"PP-TASK7-MISSING-LINK"}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active payment cannot omit its purchase link'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key, payload, status
    ) values (
      'SI-TASK7-BLANK-LINK',
      '{"stockInId":"SI-TASK7-BLANK-LINK","sourcePurchaseId":""}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active stock-in cannot use a blank purchase link'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '[]'::jsonb,
      'SI-TASK7-OBJECT-PURCHASE',
      '{"stockInId":"SI-TASK7-OBJECT-PURCHASE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-OBJECT-PURCHASE',
      '{"inventoryId":"INV-TASK7-OBJECT-PURCHASE"}'::jsonb
    )$$,
  '22023',
  'purchase payload must be a JSON object',
  'stock-in commit requires an object purchase patch'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-OBJECT-STOCK',
      '[]'::jsonb,
      'INV-TASK7-OBJECT-STOCK',
      '{"inventoryId":"INV-TASK7-OBJECT-STOCK"}'::jsonb
    )$$,
  '22023',
  'stock-in payload must be a JSON object',
  'stock-in commit requires an object stock-in payload'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-OBJECT-INVENTORY',
      '{"stockInId":"SI-TASK7-OBJECT-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-OBJECT-INVENTORY',
      '[]'::jsonb
    )$$,
  '22023',
  'inventory payload must be a JSON object',
  'stock-in commit requires an object inventory payload'
);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-OTHER"}'::jsonb,
      'SI-TASK7-MISMATCH-PURCHASE',
      '{"stockInId":"SI-TASK7-MISMATCH-PURCHASE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-MISMATCH-PURCHASE',
      '{"inventoryId":"INV-TASK7-MISMATCH-PURCHASE"}'::jsonb
    )$$,
  '22023',
  'purchase record key mismatch',
  'stock-in commit binds the purchase patch ID to its record key'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-MISMATCH-STOCK',
      '{"stockInId":"SI-TASK7-OTHER","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-MISMATCH-STOCK',
      '{"inventoryId":"INV-TASK7-MISMATCH-STOCK"}'::jsonb
    )$$,
  '22023',
  'stock-in record key mismatch',
  'stock-in commit binds the stock-in payload ID to its record key'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-MISMATCH-INVENTORY',
      '{"stockInId":"SI-TASK7-MISMATCH-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-MISMATCH-INVENTORY',
      '{"inventoryId":"INV-TASK7-OTHER"}'::jsonb
    )$$,
  '22023',
  'inventory record key mismatch',
  'stock-in commit binds the inventory payload ID to its record key'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-MISMATCH-SOURCE',
      '{"stockInId":"SI-TASK7-MISMATCH-SOURCE","sourcePurchaseId":"PO-TASK7-OTHER"}'::jsonb,
      'INV-TASK7-MISMATCH-SOURCE',
      '{"inventoryId":"INV-TASK7-MISMATCH-SOURCE"}'::jsonb
    )$$,
  '22023',
  'stock-in purchase key mismatch',
  'stock-in commit binds the stock-in source to the purchase key'
);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","__proto__":{"polluted":true}}'::jsonb,
      'SI-TASK7-UNSAFE-PURCHASE',
      '{"stockInId":"SI-TASK7-UNSAFE-PURCHASE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-UNSAFE-PURCHASE',
      '{"inventoryId":"INV-TASK7-UNSAFE-PURCHASE"}'::jsonb
    )$$,
  '22023',
  'unsafe purchase payload key',
  'stock-in commit rejects unsafe purchase patch keys'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-UNSAFE-STOCK',
      '{
        "stockInId":"SI-TASK7-UNSAFE-STOCK",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "nested":{"constructor":{"polluted":true}}
      }'::jsonb,
      'INV-TASK7-UNSAFE-STOCK',
      '{"inventoryId":"INV-TASK7-UNSAFE-STOCK"}'::jsonb
    )$$,
  '22023',
  'unsafe purchase payload key',
  'stock-in commit rejects unsafe stock-in payload keys recursively'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-UNSAFE-INVENTORY',
      '{"stockInId":"SI-TASK7-UNSAFE-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-UNSAFE-INVENTORY',
      '{
        "inventoryId":"INV-TASK7-UNSAFE-INVENTORY",
        "nested":[{"prototype":{"polluted":true}}]
      }'::jsonb
    )$$,
  '22023',
  'unsafe purchase payload key',
  'stock-in commit rejects unsafe inventory payload keys recursively'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-AUDIT-STOCK',
      '{
        "stockInId":"SI-TASK7-AUDIT-STOCK",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "updated_by_employee_id":"forged"
      }'::jsonb,
      'INV-TASK7-AUDIT-STOCK',
      '{"inventoryId":"INV-TASK7-AUDIT-STOCK"}'::jsonb
    )$$,
  '22023',
  'client audit fields are not accepted',
  'stock-in commit rejects audit identity in the stock-in payload'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-AUDIT-INVENTORY',
      '{"stockInId":"SI-TASK7-AUDIT-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-AUDIT-INVENTORY',
      '{
        "inventoryId":"INV-TASK7-AUDIT-INVENTORY",
        "createdByEmployeeName":"forged"
      }'::jsonb
    )$$,
  '22023',
  'client audit fields are not accepted',
  'stock-in commit rejects audit identity in the inventory payload'
);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-DELETED',
      '{"stockInId":"SI-TASK7-DELETED","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-DELETED-STOCK',
      '{"inventoryId":"INV-TASK7-DELETED-STOCK"}'::jsonb
    )$$,
  'P0002',
  'stock-in record not found',
  'stock-in commit cannot resurrect a deleted stock-in row'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-DELETED-INVENTORY',
      '{"stockInId":"SI-TASK7-DELETED-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-DELETED',
      '{"inventoryId":"INV-TASK7-DELETED"}'::jsonb
    )$$,
  'P0002',
  'inventory record not found',
  'stock-in commit cannot resurrect a deleted inventory row'
);

select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'stock-in-create',
      public.commit_purchase_stock_in_secure(
        'PO-TASK7-STOCK',
        '{
          "purchaseId":"PO-TASK7-STOCK",
          "stockInStatus":"部分入库",
          "paidAmount":999999
        }'::jsonb,
        'SI-TASK7-001',
        '{
          "stockInId":"SI-TASK7-001",
          "sourcePurchaseId":"PO-TASK7-STOCK",
          "stockInQuantity":2,
          "warehouseLocation":"A区"
        }'::jsonb,
        'INV-TASK7-001',
        '{
          "inventoryId":"INV-TASK7-001",
          "itemName":"库存测试铜管",
          "quantity":2,
          "averageCost":1000,
          "totalCost":2000
        }'::jsonb
      )
    )$$,
  'stock-in commit atomically inserts stock-in and inventory rows and patches purchase accrual state'
);
select ok(
  (
    select result->'purchase'->>'record_key' = 'PO-TASK7-STOCK'
      and result->'purchase'->'payload'->>'stockInStatus' = '部分入库'
      and not (result->'purchase'->'payload') ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and result->'stock_in'->>'record_key' = 'SI-TASK7-001'
      and result->'stock_in'->'payload'->>'sourcePurchaseId' = 'PO-TASK7-STOCK'
      and result->'inventory_item'->>'record_key' = 'INV-TASK7-001'
      and result->'inventory_item'->'payload'->>'inventoryId' = 'INV-TASK7-001'
    from task7_mutation_results
    where scenario = 'stock-in-create'
  ),
  'stock-in commit returns the approved three envelopes with purchase payment redaction'
);

reset role;
select ok(
  (
    select purchase.payload->>'stockInStatus' = '部分入库'
      and purchase.payload->>'paidAmount' = '4000'
      and purchase.updated_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and stock_in.payload->>'stockInId' = 'SI-TASK7-001'
      and stock_in.status = 'active'
      and stock_in.created_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and inventory.payload->>'inventoryId' = 'INV-TASK7-001'
      and inventory.status = 'active'
      and inventory.created_by_employee_id = '72000000-0000-4000-8000-000000000001'
    from public.purchase_records as purchase
    cross join public.stock_in_records as stock_in
    cross join public.inventory_items as inventory
    where purchase.record_key = 'PO-TASK7-STOCK'
      and stock_in.record_key = 'SI-TASK7-001'
      and inventory.record_key = 'INV-TASK7-001'
  ),
  'stock-in commit persists all three rows with server audit and preserves payment data'
);

select ok(
  (
    select stock_in.payload ? 'stockInId'
      and jsonb_typeof(stock_in.payload->'stockInId') = 'string'
      and stock_in.payload->>'stockInId' = stock_in.record_key
      and stock_in.payload ? 'sourcePurchaseId'
      and jsonb_typeof(stock_in.payload->'sourcePurchaseId') = 'string'
      and stock_in.payload->>'sourcePurchaseId' = 'PO-TASK7-STOCK'
    from public.stock_in_records as stock_in
    where stock_in.record_key = 'SI-TASK7-001'
  ),
  'the existing stock-in fixture has own string IDs bound to purchase A'
);

-- Seed deliberately corrupt legacy rows without exercising the new-write guard;
-- the following RPC assertions prove those rows still fail closed.
set local session_replication_role = replica;
insert into public.stock_in_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'SI-TASK7-BINDING-NO-ID',
    '{"sourcePurchaseId":"PO-TASK7-STOCK","stockInQuantity":1}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-BINDING-WRONG-ID',
    '{
      "stockInId":"SI-TASK7-BINDING-OTHER",
      "sourcePurchaseId":"PO-TASK7-STOCK",
      "stockInQuantity":1
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-BINDING-NO-SOURCE',
    '{"stockInId":"SI-TASK7-BINDING-NO-SOURCE","stockInQuantity":1}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );
set local session_replication_role = origin;

create temporary table task7_stock_binding_snapshot (
  state jsonb not null
) on commit drop;

insert into task7_stock_binding_snapshot (state)
select jsonb_build_object(
  'purchase_a', to_jsonb(purchase_a),
  'purchase_b', to_jsonb(purchase_b),
  'stock_in', to_jsonb(stock_in),
  'inventory_item', to_jsonb(inventory_item)
)
from public.purchase_records as purchase_a
cross join public.purchase_records as purchase_b
cross join public.stock_in_records as stock_in
cross join public.inventory_items as inventory_item
where purchase_a.record_key = 'PO-TASK7-STOCK'
  and purchase_b.record_key = 'PO-TASK7-001'
  and stock_in.record_key = 'SI-TASK7-001'
  and inventory_item.record_key = 'INV-TASK7-001';

create or replace function pg_temp.block_task7_stock_binding_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'stock-in binding validation reached a mutation';
end;
$function$;

create trigger task7_block_stock_binding_purchase_mutation
before insert or update or delete on public.purchase_records
for each row execute function pg_temp.block_task7_stock_binding_mutation();
create trigger task7_block_stock_binding_stock_in_mutation
before insert or update or delete on public.stock_in_records
for each row execute function pg_temp.block_task7_stock_binding_mutation();
create trigger task7_block_stock_binding_inventory_mutation
before insert or update or delete on public.inventory_items
for each row execute function pg_temp.block_task7_stock_binding_mutation();

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"missing persisted stock ID"}'::jsonb,
      'SI-TASK7-BINDING-NO-ID',
      '{
        "stockInId":"SI-TASK7-BINDING-NO-ID",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":2
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":2}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in commit rejects an existing row with a missing persisted stockInId before mutation'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"wrong persisted stock ID"}'::jsonb,
      'SI-TASK7-BINDING-WRONG-ID',
      '{
        "stockInId":"SI-TASK7-BINDING-WRONG-ID",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":2
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":2}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in commit rejects an existing row with a different persisted stockInId before mutation'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"missing persisted purchase ID"}'::jsonb,
      'SI-TASK7-BINDING-NO-SOURCE',
      '{
        "stockInId":"SI-TASK7-BINDING-NO-SOURCE",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":2
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":2}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in commit rejects an existing row with a missing persisted sourcePurchaseId before mutation'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001","stockInStatus":"cross-purchase reuse"}'::jsonb,
      'SI-TASK7-001',
      '{
        "stockInId":"SI-TASK7-001",
        "sourcePurchaseId":"PO-TASK7-001",
        "stockInQuantity":99
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":99}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in key bound to purchase A cannot be reused in a commit for purchase B'
);

reset role;
select is(
  (
    select jsonb_build_object(
      'purchase_a', to_jsonb(purchase_a),
      'purchase_b', to_jsonb(purchase_b),
      'stock_in', to_jsonb(stock_in),
      'inventory_item', to_jsonb(inventory_item)
    )
    from public.purchase_records as purchase_a
    cross join public.purchase_records as purchase_b
    cross join public.stock_in_records as stock_in
    cross join public.inventory_items as inventory_item
    where purchase_a.record_key = 'PO-TASK7-STOCK'
      and purchase_b.record_key = 'PO-TASK7-001'
      and stock_in.record_key = 'SI-TASK7-001'
      and inventory_item.record_key = 'INV-TASK7-001'
  ),
  (select state from task7_stock_binding_snapshot),
  'rejected cross-purchase reuse leaves both purchases, stock-in, and inventory rows exactly unchanged'
);

drop trigger task7_block_stock_binding_purchase_mutation
  on public.purchase_records;
drop trigger task7_block_stock_binding_stock_in_mutation
  on public.stock_in_records;
drop trigger task7_block_stock_binding_inventory_mutation
  on public.inventory_items;

delete from public.permission_grants
where subject_type = 'department'
  and subject_code = '采购部'
  and permission_key = 'module.inventory.update';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"禁止保存"}'::jsonb,
      'SI-TASK7-001',
      '{
        "stockInId":"SI-TASK7-001",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":3
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":3}'::jsonb
    )$$,
  '42501',
  'inventory update permission required',
  'stock-in commit cannot update existing inventory rows without inventory update permission'
);

reset role;
insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
) values (
  'department',
  '采购部',
  'module.inventory.update'
);
select is(
  (
    select payload->>'stockInStatus'
    from public.purchase_records
    where record_key = 'PO-TASK7-STOCK'
  ),
  '部分入库'::text,
  'a denied inventory update rolls back the purchase patch'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'stock-in-update',
      public.commit_purchase_stock_in_secure(
        'PO-TASK7-STOCK',
        '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"已入库"}'::jsonb,
        'SI-TASK7-001',
        '{
          "stockInId":"SI-TASK7-001",
          "sourcePurchaseId":"PO-TASK7-STOCK",
          "stockInQuantity":10
        }'::jsonb,
        'INV-TASK7-001',
        '{"inventoryId":"INV-TASK7-001","quantity":10,"totalCost":10000}'::jsonb
      )
    )$$,
  'stock-in commit updates all three existing active rows with update permissions'
);

reset role;
select ok(
  (select payload->>'stockInStatus' = '已入库'
    from public.purchase_records where record_key = 'PO-TASK7-STOCK')
    and (select count(*) = 1 and max((payload->>'stockInQuantity')::numeric) = 10
      from public.stock_in_records where record_key = 'SI-TASK7-001')
    and (select count(*) = 1 and max((payload->>'quantity')::numeric) = 10
      from public.inventory_items where record_key = 'INV-TASK7-001'),
  'stock-in upsert updates in place without duplicating stock or inventory rows'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"禁止保存"}'::jsonb,
      'SI-TASK7-NO-CREATE',
      '{"stockInId":"SI-TASK7-NO-CREATE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-NO-CREATE',
      '{"inventoryId":"INV-TASK7-NO-CREATE"}'::jsonb
    )$$,
  '42501',
  'inventory create permission required',
  'stock-in commit cannot insert either inventory row without inventory create permission'
);

reset role;
select ok(
  (select payload->>'stockInStatus' = '已入库'
    from public.purchase_records where record_key = 'PO-TASK7-STOCK')
    and not exists (
      select 1 from public.stock_in_records where record_key = 'SI-TASK7-NO-CREATE'
    )
    and not exists (
      select 1 from public.inventory_items where record_key = 'INV-TASK7-NO-CREATE'
    ),
  'a denied inventory create leaves all three durable rows unchanged'
);

create or replace function pg_temp.force_task7_inventory_failure()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.record_key = 'INV-TASK7-FORCED-FAILURE' then
    raise exception using
      errcode = 'P0001',
      message = 'forced inventory failure';
  end if;
  return new;
end;
$function$;
create trigger task7_force_inventory_failure
before insert on public.inventory_items
for each row execute function pg_temp.force_task7_inventory_failure();

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"不应提交"}'::jsonb,
      'SI-TASK7-FORCED-FAILURE',
      '{"stockInId":"SI-TASK7-FORCED-FAILURE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-FORCED-FAILURE',
      '{"inventoryId":"INV-TASK7-FORCED-FAILURE"}'::jsonb
    )$$,
  'P0001',
  'forced inventory failure',
  'a late inventory failure aborts the transactional stock-in RPC'
);

reset role;
select ok(
  (select payload->>'stockInStatus' = '已入库'
    from public.purchase_records where record_key = 'PO-TASK7-STOCK')
    and not exists (
      select 1 from public.stock_in_records where record_key = 'SI-TASK7-FORCED-FAILURE'
    )
    and not exists (
      select 1 from public.inventory_items where record_key = 'INV-TASK7-FORCED-FAILURE'
    ),
  'a late inventory failure rolls back the earlier purchase and stock-in writes'
);
drop trigger task7_force_inventory_failure on public.inventory_items;

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
select throws_ok(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-DIRECT',
      '{"purchaseId":"PO-TASK7-DIRECT"}'::jsonb,
      'active'
    )$$,
  '42501',
  'direct purchase record writes are not allowed',
  'module-only purchase access cannot insert around the direct-write guard'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-SENSITIVE-DIRECT',
      '{"purchaseId":"PO-TASK7-SENSITIVE-DIRECT"}'::jsonb,
      'active'
    )$$,
  '42501',
  'direct purchase record writes are not allowed',
  'even a payment-sensitive creator cannot directly insert a purchase row'
);
select throws_ok(
  $$update public.purchase_records
    set payload = payload || '{"directSensitiveBypass":true}'::jsonb
    where record_key = 'PO-TASK7-GUARD-UPDATE'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'even a payment-sensitive updater cannot directly update a purchase row'
);
select throws_ok(
  $$update public.purchase_records
    set status = 'deleted'
    where record_key = 'PO-TASK7-GUARD-DELETE'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'even a payment-sensitive deleter cannot directly soft-delete a purchase row'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$update public.purchase_records
    set status = 'deleted'
    where record_key = 'PO-TASK7-GUARD-DELETE'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'forging the JWT role GUC cannot bypass the current_user purchase guard'
);

reset role;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select lives_ok(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-SERVICE-DIRECT',
      '{"purchaseId":"PO-TASK7-SERVICE-DIRECT"}'::jsonb,
      'active'
    )$$,
  'the actual service_role may directly insert a purchase row'
);
select lives_ok(
  $$update public.purchase_records
    set payload = payload || '{"serviceUpdated":true}'::jsonb
    where record_key = 'PO-TASK7-SERVICE-DIRECT'$$,
  'the actual service_role may directly update a purchase row'
);
select lives_ok(
  $$delete from public.purchase_records
    where record_key = 'PO-TASK7-SERVICE-DIRECT'$$,
  'the actual service_role may directly delete a purchase row'
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
select throws_like(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-ANON',
      '{"stockInId":"SI-TASK7-ANON","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-ANON',
      '{"inventoryId":"INV-TASK7-ANON"}'::jsonb
    )$$,
  '%permission denied for function commit_purchase_stock_in_secure%',
  'anon cannot execute the transactional purchase stock-in RPC'
);

reset role;
select * from finish();
rollback;

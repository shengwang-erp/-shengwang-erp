begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

create or replace function pg_temp.task1_error_hint(p_statement text)
returns text
language plpgsql
as $$
declare
  captured_hint text;
  captured_message text;
  captured_state text;
begin
  begin
    execute p_statement;
    raise exception using errcode = 'P0001', message = 'task1 expected-error sentinel';
  exception when others then
    get stacked diagnostics
      captured_hint = PG_EXCEPTION_HINT,
      captured_message = MESSAGE_TEXT,
      captured_state = RETURNED_SQLSTATE;
    if captured_state = 'P0001' and captured_message = 'task1 expected-error sentinel' then
      return null;
    end if;
    return captured_hint;
  end;
end;
$$;

create or replace function pg_temp.task1_deferred_error(p_statement text)
returns text
language plpgsql
as $$
declare captured text;
begin
  execute p_statement;
  set constraints all immediate;
  set constraints all deferred;
  return null;
exception when others then
  get stacked diagnostics captured = RETURNED_SQLSTATE;
  set constraints all deferred;
  return captured;
end;
$$;

create or replace function pg_temp.task2_terminal_retry_violation(
  p_purchase_record_key text,
  p_idempotency_key text,
  p_expected_id uuid,
  p_expected_status text
)
returns text
language plpgsql
as $$
declare payload jsonb;
begin
  payload := public.submit_warehouse_receipt_secure(
    p_purchase_record_key,
    '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
    p_idempotency_key
  );
  if payload->>'id' is distinct from p_expected_id::text
    or payload->>'status' is distinct from p_expected_status
  then
    return 'terminal retry identity or status mismatch';
  end if;
  if exists (
    select 1 from jsonb_array_elements(payload->'lines') entry
    where not (entry ? 'unitCost')
      or entry->'unitCost' is distinct from 'null'::jsonb
  ) then
    return 'terminal retry exposed unit cost';
  end if;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

select has_table('public', 'warehouse_receipts', 'pending receipts table exists');
select has_table('public', 'warehouse_receipt_lines', 'pending receipt lines table exists');
select has_table('public', 'warehouse_stock_out_requests', 'pending stock-out table exists');
select has_table('public', 'warehouse_stock_out_lines', 'pending stock-out lines table exists');
select has_table('public', 'warehouse_return_requests', 'pending return table exists');
select has_table('public', 'warehouse_return_lines', 'pending return lines table exists');
select has_table('public', 'warehouse_minor_work_orders', 'minor work order table exists');

select has_function('public', 'create_minor_work_order_secure', array['jsonb']);
select has_function('public', 'assign_minor_work_order_to_project_secure', array['uuid', 'text']);
select has_function('public', 'submit_warehouse_receipt_secure', array['text', 'jsonb', 'text']);
select has_function('public', 'submit_warehouse_stock_out_secure', array['jsonb', 'jsonb', 'text']);
select has_function('public', 'submit_warehouse_return_secure', array['uuid', 'jsonb', 'jsonb', 'text']);
select has_function('public', 'list_purchase_warehouse_arrivals_secure', array[]::text[]);

select is(
  (
    with rpc(signature) as (
      values
        (to_regprocedure('public.create_minor_work_order_secure(jsonb)')),
        (to_regprocedure('public.assign_minor_work_order_to_project_secure(uuid,text)')),
        (to_regprocedure('public.submit_warehouse_receipt_secure(text,jsonb,text)')),
        (to_regprocedure('public.submit_warehouse_stock_out_secure(jsonb,jsonb,text)')),
        (to_regprocedure('public.submit_warehouse_return_secure(uuid,jsonb,jsonb,text)'))
        ,(to_regprocedure('public.list_purchase_warehouse_arrivals_secure()'))
    )
    select count(*)::integer
    from rpc
    left join pg_proc procedure on procedure.oid = rpc.signature
    where rpc.signature is null
       or not procedure.prosecdef
       or procedure.provolatile <> 'v'
       or procedure.proconfig is null
       or not procedure.proconfig @> array['search_path=pg_catalog, public, private']
       or not has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
       or has_function_privilege('anon', rpc.signature, 'EXECUTE')
       or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
  ),
  0,
  'workflow RPCs are volatile fixed-path SECURITY DEFINER and authenticated-only'
);

select is(
  (
    select count(*)
    from pg_class relation
    cross join lateral aclexplode(
      coalesce(relation.relacl, acldefault('r', relation.relowner))
    ) privilege
    where relation.oid in (
      'public.warehouse_receipts'::regclass,
      'public.warehouse_receipt_lines'::regclass,
      'public.warehouse_stock_out_requests'::regclass,
      'public.warehouse_stock_out_lines'::regclass,
      'public.warehouse_return_requests'::regclass,
      'public.warehouse_return_lines'::regclass,
      'public.warehouse_minor_work_orders'::regclass
    )
      and privilege.grantee in (
        0, 'anon'::regrole::oid, 'authenticated'::regrole::oid,
        'service_role'::regrole::oid
      )
  ),
  0::bigint,
  'pending workflow tables expose no direct browser or service-role privileges'
);

select has_function(
  'private', 'reject_warehouse_workflow_delete', array[]::text[],
  'workflow deletion guard function exists'
);
select is(
  (
    select count(*)
    from pg_trigger trigger
    join pg_class relation on relation.oid = trigger.tgrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'warehouse_minor_work_orders',
        'warehouse_receipts', 'warehouse_receipt_lines',
        'warehouse_stock_out_requests', 'warehouse_stock_out_lines',
        'warehouse_return_requests', 'warehouse_return_lines'
      )
      and not trigger.tgisinternal
      and trigger.tgfoid = to_regprocedure('private.reject_warehouse_workflow_delete()')
      and (trigger.tgtype & 2) = 2
      and (trigger.tgtype & 8) = 8
  ),
  7::bigint,
  'all seven workflow relations reject DELETE before it can remove data'
);
select is(
  (
    select count(*)
    from pg_proc procedure
    where procedure.oid = to_regprocedure('private.reject_warehouse_workflow_delete()')
      and procedure.proconfig @> array['search_path=pg_catalog']
  ),
  1::bigint,
  'workflow deletion guard has a fixed pg_catalog-only search path'
);
select is(
  (
    select count(*)
    from pg_proc procedure
    where procedure.oid = to_regprocedure('private.reject_warehouse_workflow_delete()')
      and not exists (
        select 1
        from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
        where privilege.grantee in (
          0, 'anon'::regrole::oid, 'authenticated'::regrole::oid,
          'service_role'::regrole::oid
        )
          and privilege.privilege_type = 'EXECUTE'
      )
  ),
  1::bigint,
  'workflow deletion guard exposes no direct execute privilege'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd0500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'workflow-submit@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'workflow-denied@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'workflow-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'workflow-no-view@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'workflow-no-create@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'workflow-no-submit@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('d0600000-0000-4000-8000-000000000001', 'SW-9871', 'd0500000-0000-4000-8000-000000000001', '仓库申请人', '采购部', '部长', '在职', 'active', false),
  ('d0600000-0000-4000-8000-000000000002', 'SW-9872', 'd0500000-0000-4000-8000-000000000002', '无权员工', '工程部', '大工', '在职', 'active', false),
  ('d0600000-0000-4000-8000-000000000003', 'SW-9873', 'd0500000-0000-4000-8000-000000000003', '停用员工', '采购部', '部长', '在职', 'disabled', false),
  ('d0600000-0000-4000-8000-000000000004', 'SW-9874', 'd0500000-0000-4000-8000-000000000004', '缺采购查看', '营业部', '主任', '在职', 'active', false),
  ('d0600000-0000-4000-8000-000000000005', 'SW-9875', 'd0500000-0000-4000-8000-000000000005', '缺采购新增', '事务部', '主任', '在职', 'active', false),
  ('d0600000-0000-4000-8000-000000000006', 'SW-9876', 'd0500000-0000-4000-8000-000000000006', '缺到货提交', '后勤部', '主任', '在职', 'active', false);

insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('department', '采购部', 'warehouse.receipt.submit'),
  ('department', '采购部', 'warehouse.stock_flow.request'),
  ('department', '采购部', 'module.purchases.view'),
  ('department', '采购部', 'module.purchases.create'),
  ('department', '采购部', 'module.purchases.update'),
  ('department', '采购部', 'module.purchases.delete'),
  ('department', '营业部', 'module.purchases.create'),
  ('department', '营业部', 'warehouse.receipt.submit'),
  ('department', '事务部', 'module.purchases.view'),
  ('department', '事务部', 'warehouse.receipt.submit'),
  ('department', '后勤部', 'module.purchases.view'),
  ('department', '后勤部', 'module.purchases.create');

insert into public.warehouse_sites(id, code, name, kind, active) values
  ('d0000000-0000-4000-8000-000000000001', 'WF-MAIN', '流程测试仓', 'normal', true);
insert into public.warehouse_locations(id, warehouse_id, shelf_code, shelf_name, active) values
  ('d0100000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'A-01', 'A区一号架', true),
  ('d0100000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'A-02', '停用货架', false);
insert into public.warehouse_items(id, name, category, brand, description, active) values
  ('d0200000-0000-4000-8000-000000000001', '空调铜管', '空调材料', '', '', true);
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, active
) values
  ('d0300000-0000-4000-8000-000000000001', 'd0200000-0000-4000-8000-000000000001', 'WF-CU-01', 'R410A', '6mm', '铜', '米', 0, 100, 'SWERP:VARIANT:d0300000-0000-4000-8000-000000000001', true),
  ('d0300000-0000-4000-8000-000000000002', 'd0200000-0000-4000-8000-000000000001', 'WF-CU-02', 'R410A', '9mm', '铜', '米', 0, 120, 'SWERP:VARIANT:d0300000-0000-4000-8000-000000000002', false),
  ('d0300000-0000-4000-8000-000000000003', 'd0200000-0000-4000-8000-000000000001', 'WF-CU-03', 'R410A', '12mm', '铜', '米', 0, 130, 'SWERP:VARIANT:d0300000-0000-4000-8000-000000000003', true);

insert into public.purchase_records(record_key, payload, status) values
  ('PO-WF-001', '{"purchaseId":"PO-WF-001","itemName":"空调铜管","quantity":6,"unit":"米","totalCost":1000}'::jsonb, 'active');
insert into public.projects(record_key, payload, status) values
  ('P-WF-001', '{"projectId":"P-WF-001","projectName":"正式项目"}'::jsonb, 'active');

create temporary table workflow_baseline as
select
  (select count(*) from public.projects) as projects,
  (select count(*) from public.warehouse_batches) as batches,
  (select count(*) from public.warehouse_batch_locations) as balances,
  (select count(*) from public.warehouse_inventory_movements) as movements,
  (select count(*) from public.project_cost_records) as project_costs;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.create_minor_work_order_secure('{"title":"安装空调","customerName":"未来社","workDate":"2026-08-09","locationText":"东京","description":""}')$$,
  '42501', 'warehouse permission required',
  'active employee without stock-flow permission cannot create a minor order'
);
select throws_ok(
  $$select public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":"d0000000-0000-4000-8000-000000000001","locationId":"d0100000-0000-4000-8000-000000000001"}]',
    'receipt-denied'
  )$$,
  '42501', 'warehouse permission required',
  'employee without receipt permission cannot submit a receipt'
);
reset role;

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
    'receipt-no-purchase-view'
  )$$,
  '42501', 'purchase arrival submission permission required',
  'receipt submission independently requires purchase view'
);
select throws_ok(
  $$select public.list_purchase_warehouse_arrivals_secure()$$,
  '42501', 'purchase arrival view permission required',
  'arrival context independently requires purchase view'
);
reset role;

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000005', true);
set local role authenticated;
select throws_ok(
  $$select public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
    'receipt-no-purchase-create'
  )$$,
  '42501', 'purchase arrival submission permission required',
  'receipt submission independently requires purchase create'
);
select lives_ok(
  $$select public.list_purchase_warehouse_arrivals_secure()$$,
  'arrival context requires purchase view and receipt submit but not purchase create'
);
reset role;

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000006', true);
set local role authenticated;
select throws_ok(
  $$select public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
    'receipt-no-warehouse-submit'
  )$$,
  '42501', 'warehouse permission required',
  'receipt submission independently requires warehouse receipt submit'
);
select throws_ok(
  $$select public.list_purchase_warehouse_arrivals_secure()$$,
  '42501', 'warehouse permission required',
  'arrival context independently requires warehouse receipt submit'
);
reset role;

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.create_minor_work_order_secure('{"title":"安装空调","customerName":"未来社","workDate":"2026-08-09","locationText":"东京","description":""}')$$,
  '42501', 'active employee required',
  'inactive account cannot create a minor order even when its position can request'
);
reset role;

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000001', true);
set local role authenticated;

create temporary table saved_minor as
select public.create_minor_work_order_secure(
  '{"title":"安装一台空调","customerName":"未来社","workDate":"2026-08-09","locationText":"東京都港区","description":"小工事，不建主项目"}'
) as payload;
select is((select payload->>'status' from saved_minor), 'open', 'minor work order starts open');
select is((select payload->>'assignedProjectId' from saved_minor), null, 'minor work order is not a fake project');

create temporary table saved_receipt as
select public.submit_warehouse_receipt_secure(
  'PO-WF-001',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":2.125,"warehouseId":null,"locationId":null},{"variantId":"d0300000-0000-4000-8000-000000000003","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  'receipt-wf-001'
) as payload;
select is((select payload->>'status' from saved_receipt), 'pending', 'receipt submission stays pending');
select is((select payload#>>'{lines,0,unitCost}' from saved_receipt), null, 'receipt submission accepts no browser price');
select is((select payload#>>'{lines,0,confirmedQuantity}' from saved_receipt), null, 'receipt submission has no confirmed quantity');
select is((select payload#>>'{lines,0,warehouseId}' from saved_receipt), null, 'purchase submitter does not choose the final warehouse');
select is((select payload#>>'{lines,0,locationId}' from saved_receipt), null, 'purchase submitter does not choose the final shelf');
reset role;
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipts set idempotency_key=%L, submission_payload=%L::jsonb where id=%L',
    'tampered-receipt-key', '{"tampered":true}', (select payload->>'id' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt idempotency key and original submission payload are immutable'
);
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipts set purchase_record_key=%L where id=%L',
    'PO-WF-TAMPERED', (select payload->>'id' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt purchase record key is immutable'
);
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipts set submitted_by_employee_profile_id=%L where id=%L',
    'd0200000-0000-4000-8000-000000000002', (select payload->>'id' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt submitter is immutable'
);
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipts set submitted_at=submitted_at + interval %L where id=%L',
    '1 minute', (select payload->>'id' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt submission timestamp is immutable'
);
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipt_lines set requested_quantity=9 where id=%L',
    (select payload#>>'{lines,0,id}' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt line requested quantity is immutable'
);
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipt_lines set receipt_id=%L where id=%L',
    'd7100000-0000-4000-8000-000000000099', (select payload#>>'{lines,0,id}' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt line parent is immutable'
);
select is(
  pg_temp.task1_error_hint(format(
    'update public.warehouse_receipt_lines set variant_id=%L where id=%L',
    'd0300000-0000-4000-8000-000000000002', (select payload#>>'{lines,0,id}' from saved_receipt)
  )),
  'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE',
  'receipt line variant is immutable'
);
set local role authenticated;

select is(
  public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000003","requestedQuantity":1,"warehouseId":null,"locationId":null},{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":2.125,"warehouseId":null,"locationId":null}]',
    'receipt-wf-001'
  )->>'id',
  (select payload->>'id' from saved_receipt),
  'an exact arrival retry returns the original receipt instead of adding pending quantity'
);
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_receipt_secure(
      'PO-WF-001',
      '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
      'receipt-wf-001'
    )
  $statement$),
  'WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT',
  'the same arrival idempotency key cannot be reused for different content'
);
reset role;
insert into public.purchase_records(record_key, payload, status) values
  ('PO-WF-RETRY-CONFIRMED', '{"purchaseId":"PO-WF-RETRY-CONFIRMED","itemName":"空调铜管","quantity":1,"unit":"米"}', 'active'),
  ('PO-WF-RETRY-REJECTED', '{"purchaseId":"PO-WF-RETRY-REJECTED","itemName":"空调铜管","quantity":1,"unit":"米"}', 'active'),
  ('PO-WF-RETRY-VOID-BEFORE', '{"purchaseId":"PO-WF-RETRY-VOID-BEFORE","itemName":"空调铜管","quantity":1,"unit":"米"}', 'active'),
  ('PO-WF-RETRY-VOID-AFTER', '{"purchaseId":"PO-WF-RETRY-VOID-AFTER","itemName":"空调铜管","quantity":1,"unit":"米"}', 'active');
set local role authenticated;
create temporary table retry_confirmed as
select public.submit_warehouse_receipt_secure(
  'PO-WF-RETRY-CONFIRMED',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  'receipt-retry-confirmed'
) as payload;
create temporary table retry_rejected as
select public.submit_warehouse_receipt_secure(
  'PO-WF-RETRY-REJECTED',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  'receipt-retry-rejected'
) as payload;
create temporary table retry_void_before as
select public.submit_warehouse_receipt_secure(
  'PO-WF-RETRY-VOID-BEFORE',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  'receipt-retry-void-before'
) as payload;
create temporary table retry_void_after as
select public.submit_warehouse_receipt_secure(
  'PO-WF-RETRY-VOID-AFTER',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  'receipt-retry-void-after'
) as payload;
reset role;
update public.warehouse_receipt_lines
set confirmed_quantity = 1,
    warehouse_id = 'd0000000-0000-4000-8000-000000000001',
    location_id = 'd0100000-0000-4000-8000-000000000001',
    unit_cost = 100
where receipt_id = (select (payload->>'id')::uuid from retry_confirmed);
update public.warehouse_receipts
set status = 'confirmed',
    confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
    confirmed_at = statement_timestamp()
where id = (select (payload->>'id')::uuid from retry_confirmed);
update public.warehouse_receipts
set status = 'rejected',
    confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
    confirmed_at = statement_timestamp(),
    rejection_reason = '数量不符'
where id = (select (payload->>'id')::uuid from retry_rejected);
update public.warehouse_receipts
set status = 'void',
    confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
    confirmed_at = statement_timestamp(),
    rejection_reason = '确认前撤销'
where id = (select (payload->>'id')::uuid from retry_void_before);
update public.warehouse_receipt_lines
set confirmed_quantity = 1,
    warehouse_id = 'd0000000-0000-4000-8000-000000000001',
    location_id = 'd0100000-0000-4000-8000-000000000001',
    unit_cost = 120
where receipt_id = (select (payload->>'id')::uuid from retry_void_after);
update public.warehouse_receipts
set status = 'void',
    confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
    confirmed_at = statement_timestamp(),
    rejection_reason = '确认后冲销'
where id = (select (payload->>'id')::uuid from retry_void_after);
set local role authenticated;
select is(
  pg_temp.task2_terminal_retry_violation(
    'PO-WF-RETRY-CONFIRMED', 'receipt-retry-confirmed',
    (select (payload->>'id')::uuid from retry_confirmed), 'confirmed'
  ),
  null,
  'an exact confirmed receipt retry returns the same cost-redacted terminal document'
);
select is(
  pg_temp.task2_terminal_retry_violation(
    'PO-WF-RETRY-REJECTED', 'receipt-retry-rejected',
    (select (payload->>'id')::uuid from retry_rejected), 'rejected'
  ),
  null,
  'an exact rejected receipt retry returns the same cost-redacted terminal document'
);
select is(
  pg_temp.task2_terminal_retry_violation(
    'PO-WF-RETRY-VOID-BEFORE', 'receipt-retry-void-before',
    (select (payload->>'id')::uuid from retry_void_before), 'void'
  ),
  null,
  'an exact void-before-confirmation retry returns the same cost-redacted terminal document'
);
select is(
  pg_temp.task2_terminal_retry_violation(
    'PO-WF-RETRY-VOID-AFTER', 'receipt-retry-void-after',
    (select (payload->>'id')::uuid from retry_void_after), 'void'
  ),
  null,
  'an exact void-after-confirmation retry returns the same cost-redacted terminal document'
);
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_receipt_secure(
      'PO-WF-RETRY-CONFIRMED',
      '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":0.5,"warehouseId":null,"locationId":null}]',
      'receipt-retry-confirmed'
    )
  $statement$),
  'WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT',
  'a terminal receipt idempotency key still rejects a conflicting canonical payload'
);
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_receipt_secure(
      'PO-WF-001',
      '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":3,"warehouseId":null,"locationId":null}]',
      'receipt-over-purchase-remainder'
    )
  $statement$),
  'WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED',
  'server rejects arrival quantity above the authoritative purchase remainder'
);
reset role;
insert into public.warehouse_receipts(
  id, purchase_record_key, status, submitted_by_employee_profile_id,
  confirmed_by_employee_profile_id, confirmed_at, idempotency_key
) values (
  'd7100000-0000-4000-8000-000000000001', 'PO-WF-001', 'confirmed',
  'd0600000-0000-4000-8000-000000000001',
  'd0600000-0000-4000-8000-000000000001', statement_timestamp(),
  'receipt-partial-confirmed'
);
insert into public.warehouse_receipt_lines(
  receipt_id, variant_id, requested_quantity, confirmed_quantity,
  warehouse_id, location_id, unit_cost
) values (
  'd7100000-0000-4000-8000-000000000001',
  'd0300000-0000-4000-8000-000000000001', 2, 1.5,
  'd0000000-0000-4000-8000-000000000001',
  'd0100000-0000-4000-8000-000000000001', 100
);
insert into public.warehouse_receipts(
  id, purchase_record_key, submitted_by_employee_profile_id, idempotency_key
) values (
  'd7100000-0000-4000-8000-000000000002', 'PO-WF-001',
  'd0600000-0000-4000-8000-000000000001', 'receipt-unlocated-confirmation'
);
insert into public.warehouse_receipt_lines(
  receipt_id, variant_id, requested_quantity, warehouse_id, location_id
) values (
  'd7100000-0000-4000-8000-000000000002',
  'd0300000-0000-4000-8000-000000000001', 0.25, null, null
);
select is(
  pg_temp.task1_deferred_error($statement$
    with confirmed_line as (
      update public.warehouse_receipt_lines
      set confirmed_quantity = requested_quantity, unit_cost = 100
      where receipt_id = 'd7100000-0000-4000-8000-000000000002'
      returning 1
    )
    update public.warehouse_receipts
    set status = 'confirmed',
        confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
        confirmed_at = statement_timestamp()
    where id = 'd7100000-0000-4000-8000-000000000002'
      and exists (select 1 from confirmed_line)
  $statement$),
  '23514',
  'confirmed receipt lines cannot remain without an authoritative warehouse and shelf'
);
update public.warehouse_receipts
set status = 'rejected', rejection_reason = '无有效仓位',
    confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
    confirmed_at = statement_timestamp()
where id = 'd7100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok(
  $$select public.upsert_purchase_record_secure(
    'PO-WF-001',
    '{"purchaseId":"PO-WF-001","itemName":"空调铜管","quantity":4,"unit":"米","totalCost":1000}',
    'active'
  )$$,
  '23514', 'purchase quantity is below warehouse receipts',
  'purchase quantity cannot be reduced below pending plus confirmed warehouse quantity'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
    'PO-WF-001',
    '{"purchaseId":"PO-WF-001","itemName":"空调铜管","quantity":0,"unit":"米","totalCost":1000}',
    'active'
  )$$,
  '23514', 'purchase quantity is invalid for warehouse receipts',
  'a warehouse-linked purchase must retain a positive authoritative quantity'
);
select lives_ok(
  $$select public.upsert_purchase_record_secure(
    'PO-WF-001',
    '{"purchaseId":"PO-WF-001","itemName":"空调铜管","supplierName":"更新供应商","quantity":6,"unit":"米","totalCost":1000}',
    'active'
  )$$,
  'unrelated purchase edits remain allowed when authoritative quantity covers receipts'
);
select is(
  (select (entry->>'orderedQuantity')::numeric
   from jsonb_array_elements(public.list_purchase_warehouse_arrivals_secure()->'purchases') entry
   where entry->>'purchaseRecordKey' = 'PO-WF-001'),
  6::numeric,
  'arrival context reads ordered quantity from the authoritative purchase row'
);
select is(
  (select (entry->>'pendingQuantity')::numeric
   from jsonb_array_elements(public.list_purchase_warehouse_arrivals_secure()->'purchases') entry
   where entry->>'purchaseRecordKey' = 'PO-WF-001'),
  3.125::numeric,
  'arrival context totals pending receipt lines without local stock-in records'
);
select is(
  (select (entry->>'confirmedQuantity')::numeric
   from jsonb_array_elements(public.list_purchase_warehouse_arrivals_secure()->'purchases') entry
   where entry->>'purchaseRecordKey' = 'PO-WF-001'),
  1.5::numeric,
  'arrival context separates a partial confirmation from pending requested quantity'
);
select is(
  (select (entry->>'remainingQuantity')::numeric
   from jsonb_array_elements(public.list_purchase_warehouse_arrivals_secure()->'purchases') entry
   where entry->>'purchaseRecordKey' = 'PO-WF-001'),
  1.375::numeric,
  'arrival context exposes the server-authoritative remainder'
);
select is(
  (select count(*)::integer
   from jsonb_array_elements(public.list_purchase_warehouse_arrivals_secure()->'variants') entry
   where entry->>'id' = 'd0300000-0000-4000-8000-000000000001'
     and not (entry ? 'defaultPurchasePrice')),
  1,
  'purchase arrival selector exposes an active variant without warehouse price'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-WF-001')$$,
  '23503', 'purchase record has warehouse receipts',
  'a purchase with any warehouse receipt cannot be deleted'
);

create temporary table saved_out as
select public.submit_warehouse_stock_out_secure(
  jsonb_build_object(
    'destinationType', 'minor_work_order', 'projectId', null,
    'minorWorkOrderId', (select payload->>'id' from saved_minor),
    'destinationNameSnapshot', '未来社・安装一台空调',
    'purpose', '安装使用', 'receiver', '王师傅', 'requestDate', '2026-08-09'
  ),
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1},{"variantId":"d0300000-0000-4000-8000-000000000003","requestedQuantity":1}]',
  'out-wf-001'
) as payload;
select is((select payload->>'status' from saved_out), 'pending', 'minor-work outbound submission stays pending');
select is((select payload->>'projectId' from saved_out), null, 'minor-work outbound does not create or reference a fake project');

reset role;
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_receipt_lines where id=%L',
    (select payload#>>'{lines,0,id}' from saved_receipt)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'a pending multi-line receipt cannot lose one physical line'
);
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_receipt_lines where receipt_id=%L',
    (select payload->>'id' from saved_receipt)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'a delete-all-lines then header transaction is rejected at its first DELETE'
);
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_receipts where id=%L',
    (select payload->>'id' from saved_receipt)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'receipt headers cannot be physically deleted'
);
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_minor_work_orders where id=%L',
    (select payload->>'id' from saved_minor)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'minor work orders preserve their audit record instead of deleting'
);
select is(
  (select count(*) from public.projects),
  (select projects from workflow_baseline),
  'small air-conditioner job creates no fake project row'
);
select is((select count(*) from public.warehouse_batches), (select batches from workflow_baseline), 'submission creates no stock batch');
select is((select count(*) from public.warehouse_batch_locations), (select balances from workflow_baseline), 'submission changes no balance');
select is((select count(*) from public.warehouse_inventory_movements), (select movements from workflow_baseline), 'submission appends no inventory movement');
select is((select count(*) from public.project_cost_records), (select project_costs from workflow_baseline), 'submission posts no project cost');

select throws_ok(
  $$update public.warehouse_stock_out_requests
      set destination_name_snapshot = '被篡改'
      where id = (select (payload->>'id')::uuid from saved_out)$$,
  '55000', 'submitted warehouse destination is immutable',
  'destination snapshot cannot be changed after submission'
);

set local role authenticated;
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000002","requestedQuantity":1,"warehouseId":"d0000000-0000-4000-8000-000000000001","locationId":"d0100000-0000-4000-8000-000000000001"}]',
    'receipt-inactive-variant'
  )
  $statement$),
  'WAREHOUSE_RESOURCE_INACTIVE',
  'receipt submission fails closed after locking an inactive variant'
);
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_receipt_secure(
    'PO-WF-001',
    '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":"d0000000-0000-4000-8000-000000000001","locationId":"d0100000-0000-4000-8000-000000000002"}]',
    'receipt-inactive-location'
  )
  $statement$),
  'WAREHOUSE_RESOURCE_INACTIVE',
  'receipt submission fails closed after locking an inactive location'
);
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_receipt_secure(
      'PO-WF-001', '[]'::jsonb, 'bad input'
    )
  $statement$),
  'WAREHOUSE_WORKFLOW_INPUT_INVALID',
  'invalid workflow input returns the stable corrective hint'
);
select is(
  pg_temp.task1_error_hint($statement$
    select public.submit_warehouse_stock_out_secure(
      '{"destinationType":"minor_work_order","projectId":null,"minorWorkOrderId":"d8000000-0000-4000-8000-000000000099","destinationNameSnapshot":"已失效工事","purpose":"安装","receiver":"王师傅","requestDate":"2026-08-09"}',
      '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1}]',
      'expired-destination'
    )
  $statement$),
  'WAREHOUSE_DESTINATION_UNAVAILABLE',
  'expired destination returns a distinct stable corrective hint'
);

reset role;

select is(
  private.warehouse_variant_has_pending_documents('d0300000-0000-4000-8000-000000000001'),
  true,
  'real pending receipt and stock-out tables block variant deactivation'
);
select is(
  pg_temp.task1_deferred_error(format(
    'update public.warehouse_receipt_lines set confirmed_quantity=1, unit_cost=0 where receipt_id=%L',
    (select payload->>'id' from saved_receipt)
  )),
  '23514',
  'pending receipt lines cannot carry confirmed quantity or cost'
);
select is(
  pg_temp.task1_deferred_error(format(
    'update public.warehouse_stock_out_lines set confirmed_quantity=1, frozen_total_cost=0 where request_id=%L',
    (select payload->>'id' from saved_out)
  )),
  '23514',
  'pending stock-out lines cannot carry confirmed quantity or frozen cost'
);
update public.warehouse_receipt_lines
  set confirmed_quantity = requested_quantity, unit_cost = 0,
      warehouse_id = 'd0000000-0000-4000-8000-000000000001',
      location_id = 'd0100000-0000-4000-8000-000000000001'
  where receipt_id = (select (payload->>'id')::uuid from saved_receipt);
update public.warehouse_receipts
  set status = 'confirmed',
      confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
      confirmed_at = statement_timestamp()
  where id = (select (payload->>'id')::uuid from saved_receipt);
update public.warehouse_stock_out_lines
  set confirmed_quantity = requested_quantity, frozen_total_cost = 0
  where request_id = (select (payload->>'id')::uuid from saved_out);
update public.warehouse_stock_out_requests
  set status = 'confirmed',
      confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
      confirmed_at = statement_timestamp()
  where id = (select (payload->>'id')::uuid from saved_out);
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_stock_out_lines where id=%L',
    (select payload#>>'{lines,0,id}' from saved_out)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'a confirmed multi-line stock-out cannot lose one physical line'
);
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_stock_out_requests where id=%L',
    (select payload->>'id' from saved_out)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'stock-out headers cannot be physically deleted'
);
select is(
  pg_temp.task1_deferred_error(format(
    'update public.warehouse_receipt_lines set unit_cost=null where receipt_id=%L',
    (select payload->>'id' from saved_receipt)
  )),
  '23514',
  'confirmed receipt lines require both confirmed quantity and cost'
);
select is(
  private.warehouse_variant_has_pending_documents('d0300000-0000-4000-8000-000000000001'),
  false,
  'confirmed real pending documents no longer block variant deactivation'
);
update public.warehouse_receipts
  set status = 'void', rejection_reason = '确认后作废测试'
  where id = (select (payload->>'id')::uuid from saved_receipt);
set constraints all immediate;
select pass('void after confirmation preserves a complete confirmed line tuple');
set constraints all deferred;

set local role authenticated;
create temporary table saved_return as
select public.submit_warehouse_return_secure(
  (select (payload->>'id')::uuid from saved_out),
  '{"reason":"未使用","receiver":"仓库负责人","requestDate":"2026-08-10"}',
  (
    select jsonb_agg(jsonb_build_object(
      'originalStockOutLineId', line->>'id', 'requestedQuantity', 1
    ) order by line->>'id')
    from jsonb_array_elements((select payload->'lines' from saved_out)) line
  ),
  'return-wf-001'
) as payload;
select is((select payload->>'status' from saved_return), 'pending', 'return submission stays pending');
reset role;
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_return_lines where id=%L',
    (select payload#>>'{lines,0,id}' from saved_return)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'return lines cannot be physically deleted'
);
select is(
  pg_temp.task1_error_hint(format(
    'delete from public.warehouse_return_requests where id=%L',
    (select payload->>'id' from saved_return)
  )),
  'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN',
  'return headers cannot be physically deleted'
);
select has_column(
  'public', 'warehouse_return_lines', 'original_stock_out_id',
  'return line stores the original stock-out header identity for composite integrity'
);
select is(
  (
    select line.original_stock_out_id
    from public.warehouse_return_lines line
    where line.id = (select (payload#>>'{lines,0,id}')::uuid from saved_return)
  ),
  (select (payload->>'originalStockOutId')::uuid from saved_return),
  'secure return submission binds every line to its header original stock-out'
);
select is(
  private.warehouse_variant_has_pending_documents('d0300000-0000-4000-8000-000000000001'),
  true,
  'a real pending return blocks its original stock-out variant'
);
select is(
  pg_temp.task1_deferred_error(format(
    'update public.warehouse_return_lines set confirmed_quantity=1, frozen_total_cost=0 where return_id=%L',
    (select payload->>'id' from saved_return)
  )),
  '23514',
  'pending return lines cannot carry confirmed quantity or frozen cost'
);
update public.warehouse_return_requests
  set status = 'rejected', rejection_reason = '仓库拒绝测试',
      confirmed_by_employee_profile_id = 'd0600000-0000-4000-8000-000000000001',
      confirmed_at = statement_timestamp()
  where id = (select (payload->>'id')::uuid from saved_return);
select is(
  pg_temp.task1_deferred_error(format(
    'update public.warehouse_return_lines set confirmed_quantity=1, frozen_total_cost=0 where return_id=%L',
    (select payload->>'id' from saved_return)
  )),
  '23514',
  'rejected return lines remain unconfirmed and uncosted'
);
select is(
  private.warehouse_variant_has_pending_documents('d0300000-0000-4000-8000-000000000001'),
  false,
  'a rejected real return no longer blocks the variant'
);
update public.warehouse_return_requests
  set status = 'void', rejection_reason = '确认前作废测试'
  where id = (select (payload->>'id')::uuid from saved_return);
set constraints all immediate;
select pass('void before confirmation preserves a wholly unconfirmed line tuple');
set constraints all deferred;

select throws_ok(
  $$insert into public.warehouse_receipts(
      purchase_record_key, status, submitted_by_employee_profile_id, idempotency_key
    ) values ('PO-WF-001', 'unknown', 'd0600000-0000-4000-8000-000000000001', 'bad-status')$$,
  '23514', null,
  'workflow statuses use a closed database check'
);
select throws_ok(
  $$insert into public.warehouse_receipt_lines(
      receipt_id, variant_id, requested_quantity, warehouse_id, location_id
    ) values (
      (select (payload->>'id')::uuid from saved_receipt),
      'd0300000-0000-4000-8000-000000000001', 0,
      'd0000000-0000-4000-8000-000000000001',
      'd0100000-0000-4000-8000-000000000001'
    )$$,
  '23514', null,
  'pending line quantities must be positive'
);

select throws_ok(
  $$update public.warehouse_receipts
      set confirmed_at = null
      where id = (select (payload->>'id')::uuid from saved_receipt)$$,
  '23514', null,
  'terminal headers require a consistent audit tuple rather than a missing confirmation time'
);

insert into public.warehouse_stock_out_requests(
  id, destination_type, destination_name_snapshot, purpose, receiver, request_date,
  status, submitted_by_employee_profile_id, confirmed_by_employee_profile_id,
  confirmed_at, idempotency_key
) values (
  'd8200000-0000-4000-8000-000000000001', 'internal_use', '另一个出库',
  '完整性测试', '测试员', '2026-08-09', 'confirmed',
  'd0600000-0000-4000-8000-000000000001',
  'd0600000-0000-4000-8000-000000000001', statement_timestamp(), 'other-stock-out'
);
insert into public.warehouse_stock_out_lines(
  id, request_id, variant_id, requested_quantity, confirmed_quantity, frozen_total_cost
) values (
  'd8300000-0000-4000-8000-000000000001',
  'd8200000-0000-4000-8000-000000000001',
  'd0300000-0000-4000-8000-000000000001', 1, 1, 0
);
select throws_ok(
  $$insert into public.warehouse_return_lines(
      return_id, original_stock_out_id, original_stock_out_line_id, requested_quantity
    ) values (
      (select (payload->>'id')::uuid from saved_return),
      'd8200000-0000-4000-8000-000000000001',
      'd8300000-0000-4000-8000-000000000001', 1
    )$$,
  '23503', null,
  'return line cannot reference a stock-out line from another header'
);

-- Task 3: confirmations are server-authoritative, atomic and FIFO costed.
select has_function(
  'public', 'confirm_warehouse_receipt_secure', array['uuid', 'jsonb', 'text'],
  'receipt confirmation RPC exists'
);
select has_function(
  'public', 'confirm_warehouse_stock_out_secure', array['uuid', 'jsonb', 'text'],
  'stock-out confirmation RPC exists'
);
select is(
  (
    with rpc(signature) as (
      values
        (to_regprocedure('public.confirm_warehouse_receipt_secure(uuid,jsonb,text)')),
        (to_regprocedure('public.confirm_warehouse_stock_out_secure(uuid,jsonb,text)'))
    )
    select count(*)::integer
    from rpc
    left join pg_proc procedure on procedure.oid = rpc.signature
    where rpc.signature is null
       or not procedure.prosecdef
       or procedure.provolatile <> 'v'
       or procedure.proconfig is null
       or not procedure.proconfig @> array['search_path=pg_catalog, public, private']
       or not has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
       or has_function_privilege('anon', rpc.signature, 'EXECUTE')
       or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
  ),
  0,
  'confirmation RPCs are volatile fixed-path SECURITY DEFINER and authenticated-only'
);
select col_is_null(
  'public', 'warehouse_receipts', 'confirmation_idempotency_key',
  'receipt confirmation idempotency is absent until confirmation'
);
select col_is_null(
  'public', 'warehouse_stock_out_requests', 'confirmation_idempotency_key',
  'stock-out confirmation idempotency is absent until confirmation'
);
select fk_ok(
  'public', 'warehouse_batches', array['receipt_line_id', 'variant_id'],
  'public', 'warehouse_receipt_lines', array['id', 'variant_id'],
  'a receipt batch must reference a real receipt line with the same variant'
);
select is(
  (
    select count(*)
    from pg_index index_row
    where index_row.indrelid = 'public.warehouse_batches'::regclass
      and index_row.indisunique
      and index_row.indpred is not null
      and pg_get_indexdef(index_row.indexrelid) ~ '\(receipt_line_id\)'
  ),
  1::bigint,
  'one confirmed receipt line can create at most one batch'
);
select is(
  private.warehouse_confirmation_quantity(
    '{"confirmedQuantity":9007199254740.990}'::jsonb,
    'confirmedQuantity'
  ),
  9007199254740.990::numeric,
  'confirmation quantity accepts the exact browser-safe three-decimal maximum'
);
select throws_ok(
  $$select private.warehouse_confirmation_quantity(
    '{"confirmedQuantity":9007199254740.991}'::jsonb,
    'confirmedQuantity'
  )$$,
  '22023', 'warehouse confirmation input invalid',
  'confirmation quantity rejects the first value above the browser-safe maximum'
);
select is(
  private.warehouse_purchase_unit_cost(
    '{"quantity":1,"totalCost":900719925474.0991}'::jsonb
  ),
  900719925474.0991::numeric,
  'purchase unit cost accepts the exact browser-safe four-decimal maximum'
);
select throws_ok(
  $$select private.warehouse_purchase_unit_cost(
    '{"quantity":1,"totalCost":900719925474.0992}'::jsonb
  )$$,
  '22023', 'purchase cost invalid for warehouse receipt',
  'purchase unit cost rejects the first value above the browser-safe maximum'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'e1500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'workflow-confirmer@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'workflow-inactive-confirmer@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1500000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'workflow-confirm-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('e1600000-0000-4000-8000-000000000001', 'SW-9881', 'e1500000-0000-4000-8000-000000000001', '仓库负责人', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('e1600000-0000-4000-8000-000000000002', 'SW-9882', 'e1500000-0000-4000-8000-000000000002', '停用仓库负责人', '仓库管理部', '仓库管理员', '在职', 'disabled', false),
  ('e1600000-0000-4000-8000-000000000003', 'SW-9883', 'e1500000-0000-4000-8000-000000000003', '仅确认无价格', '工程部', '主任', '在职', 'active', false);
insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('position', '仓库管理员', 'warehouse.receipt.confirm'),
  ('position', '仓库管理员', 'warehouse.stock_flow.confirm'),
  ('position', '仓库管理员', 'warehouse.cost.view'),
  ('position', '主任', 'warehouse.receipt.confirm'),
  ('position', '主任', 'warehouse.stock_flow.confirm')
on conflict do nothing;

insert into public.warehouse_sites(id, code, name, kind, active) values
  ('e1000000-0000-4000-8000-000000000001', 'T3-SECOND', 'Task3第二仓', 'normal', true);
insert into public.warehouse_locations(id, warehouse_id, shelf_code, shelf_name, active) values
  ('e1100000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'T3-A', 'Task3主仓货架', true),
  ('e1100000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001', 'T3-B', 'Task3第二仓货架', true);
insert into public.warehouse_items(id, name, category, brand, description, active) values
  ('e1200000-0000-4000-8000-000000000001', 'Task3安全数值边界物品', '', '', '', true);
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, active
) values (
  'e1300000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001', 'T3-SAFE-BOUNDARY', '', '', '', '个',
  0, 0, 'SWERP:VARIANT:e1300000-0000-4000-8000-000000000001', true
);
insert into public.warehouse_batches(
  id, variant_id, received_at, unit_cost, original_quantity
) values
  ('e1400000-0000-4000-8000-000000000001',
   'e1300000-0000-4000-8000-000000000001',
   '2026-08-09T00:00:00Z', 1, 1),
  ('e1400000-0000-4000-8000-000000000002',
   'e1300000-0000-4000-8000-000000000001',
   '2026-08-09T01:00:00Z', 900719925474.0991, 1);
insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
  ('e1400000-0000-4000-8000-000000000001',
   'e1100000-0000-4000-8000-000000000002', 1),
  ('e1400000-0000-4000-8000-000000000002',
   'e1100000-0000-4000-8000-000000000002', 1);
insert into public.purchase_records(record_key, payload, status) values
  ('PO-T3-100', '{"purchaseId":"PO-T3-100","itemName":"空调铜管","quantity":2,"unit":"米","totalCost":200}', 'active'),
  ('PO-T3-130', '{"purchaseId":"PO-T3-130","itemName":"空调铜管","quantity":3,"unit":"米","totalCost":390}', 'active'),
  ('PO-T3-ROUND', '{"purchaseId":"PO-T3-ROUND","itemName":"空调铜管","quantity":6,"unit":"米","totalCost":1000}', 'active'),
  ('PO-T3-BAD-COST', '{"purchaseId":"PO-T3-BAD-COST","itemName":"空调铜管","quantity":1,"unit":"米","totalCost":-1}', 'active'),
  ('PO-T3-UNSAFE-COST', '{"purchaseId":"PO-T3-UNSAFE-COST","itemName":"边界物品","quantity":1,"unit":"个","totalCost":900719925474.0992}', 'active'),
  ('PO-T3-OVERSIZE-Q', '{"purchaseId":"PO-T3-OVERSIZE-Q","itemName":"边界物品","quantity":1,"unit":"个","totalCost":1}', 'active');
insert into public.warehouse_receipts(
  id, purchase_record_key, submitted_by_employee_profile_id, idempotency_key,
  submission_payload
) values (
  'e1700000-0000-4000-8000-000000000001', 'PO-T3-OVERSIZE-Q',
  'e1600000-0000-4000-8000-000000000001', 't3-submit-oversize-requested', '{}'
);
insert into public.warehouse_receipt_lines(
  id, receipt_id, variant_id, requested_quantity
) values (
  'e1710000-0000-4000-8000-000000000001',
  'e1700000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001', 9007199254740.991
);
insert into public.warehouse_stock_out_requests(
  id, destination_type, destination_name_snapshot, purpose, receiver, request_date,
  submitted_by_employee_profile_id, idempotency_key
) values (
  'e1800000-0000-4000-8000-000000000001', 'internal_use', '公司内部使用',
  '历史超量测试', '王师傅', '2026-08-09',
  'e1600000-0000-4000-8000-000000000001', 't3-submit-stock-oversize-requested'
);
insert into public.warehouse_stock_out_lines(
  id, request_id, variant_id, requested_quantity
) values (
  'e1810000-0000-4000-8000-000000000001',
  'e1800000-0000-4000-8000-000000000001',
  'e1300000-0000-4000-8000-000000000001', 9007199254740.991
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table task3_receipt_100 as
select public.submit_warehouse_receipt_secure(
  'PO-T3-100',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":2,"warehouseId":null,"locationId":null}]',
  't3-submit-receipt-100'
) as payload;
create temporary table task3_receipt_130 as
select public.submit_warehouse_receipt_secure(
  'PO-T3-130',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":3,"warehouseId":null,"locationId":null}]',
  't3-submit-receipt-130'
) as payload;
create temporary table task3_receipt_round as
select public.submit_warehouse_receipt_secure(
  'PO-T3-ROUND',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  't3-submit-receipt-round'
) as payload;
create temporary table task3_receipt_bad_cost as
select public.submit_warehouse_receipt_secure(
  'PO-T3-BAD-COST',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  't3-submit-receipt-bad-cost'
) as payload;
create temporary table task3_receipt_unsafe_cost as
select public.submit_warehouse_receipt_secure(
  'PO-T3-UNSAFE-COST',
  '[{"variantId":"e1300000-0000-4000-8000-000000000001","requestedQuantity":1,"warehouseId":null,"locationId":null}]',
  't3-submit-receipt-unsafe-cost'
) as payload;
select is(
  (select count(*) from public.warehouse_batches
   where receipt_line_id = (select (payload#>>'{lines,0,id}')::uuid from task3_receipt_100)),
  0::bigint,
  'pending purchase arrival creates no inventory batch before warehouse confirmation'
);
select is(
  (select count(*) from public.warehouse_inventory_movements
   where source_document_id = (select payload->>'id' from task3_receipt_100)),
  0::bigint,
  'pending purchase arrival creates no inventory movement before warehouse confirmation'
);
select throws_ok(
  format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
      'confirmedQuantity', 2,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-receipt-requester'
  ),
  '42501', 'warehouse permission required',
  'receipt requester cannot confirm without the independent confirm permission'
);
reset role;

select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
      'confirmedQuantity', 2,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-receipt-inactive'
  ),
  '42501', 'active employee required',
  'inactive warehouse manager cannot confirm a receipt'
);
reset role;

select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_bad_cost),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_bad_cost),
      'confirmedQuantity', 1,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-receipt-bad-cost'
  )),
  'WAREHOUSE_PURCHASE_COST_INVALID',
  'receipt confirmation rejects a negative purchase total cost without posting stock'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_unsafe_cost),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_unsafe_cost),
      'confirmedQuantity', 1,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000002'
    )),
    't3-confirm-receipt-unsafe-cost'
  )),
  'WAREHOUSE_PURCHASE_COST_INVALID',
  'receipt confirmation rejects a unit cost above the browser-safe maximum'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    'e1700000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', 'e1710000-0000-4000-8000-000000000001',
      'confirmedQuantity', 1,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000002'
    )),
    't3-confirm-receipt-oversize-requested'
  )),
  'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
  'confirmation rejects a preexisting pending requested quantity above the browser-safe maximum'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    'e1800000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', 'e1810000-0000-4000-8000-000000000001',
      'confirmedQuantity', 1,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000002'
    )),
    't3-confirm-stock-oversize-requested'
  )),
  'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
  'stock-out confirmation rejects a preexisting requested quantity above the browser-safe maximum'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
      'confirmedQuantity', 2,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001',
      'unitCost', 1
    )),
    't3-confirm-receipt-forged-cost'
  )),
  'WAREHOUSE_CONFIRMATION_INPUT_INVALID',
  'browser cannot supply receipt unit cost to confirmation'
);

create temporary table task3_confirmed_100 as
select public.confirm_warehouse_receipt_secure(
  (select (payload->>'id')::uuid from task3_receipt_100),
  jsonb_build_array(jsonb_build_object(
    'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
    'confirmedQuantity', 2,
    'warehouseId', 'd0000000-0000-4000-8000-000000000001',
    'locationId', 'e1100000-0000-4000-8000-000000000001'
  )),
  't3-confirm-receipt-100'
) as payload;
create temporary table task3_confirmed_130 as
select public.confirm_warehouse_receipt_secure(
  (select (payload->>'id')::uuid from task3_receipt_130),
  jsonb_build_array(jsonb_build_object(
    'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_130),
    'confirmedQuantity', 3,
    'warehouseId', 'd0000000-0000-4000-8000-000000000001',
    'locationId', 'e1100000-0000-4000-8000-000000000001'
  )),
  't3-confirm-receipt-130'
) as payload;
reset role;
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000003', true);
set local role authenticated;
create temporary table task3_confirmed_round as
select public.confirm_warehouse_receipt_secure(
  (select (payload->>'id')::uuid from task3_receipt_round),
  jsonb_build_array(jsonb_build_object(
    'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_round),
    'confirmedQuantity', 1,
    'warehouseId', 'e1000000-0000-4000-8000-000000000001',
    'locationId', 'e1100000-0000-4000-8000-000000000002'
  )),
  't3-confirm-receipt-round'
) as payload;
reset role;
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is((select payload->>'status' from task3_confirmed_100), 'confirmed', 'warehouse receipt confirmation is terminal');
select is((select (payload#>>'{lines,0,unitCost}')::numeric from task3_confirmed_100), 100.0000::numeric, 'first receipt freezes purchase unit cost at 100');
select is((select (payload#>>'{lines,0,unitCost}')::numeric from task3_confirmed_130), 130.0000::numeric, 'second receipt freezes purchase unit cost at 130');
select is((select payload#>>'{lines,0,unitCost}' from task3_confirmed_round), null, 'confirm-only employee receives a cost-redacted receipt response');
reset role;
select is(
  (select unit_cost from public.warehouse_receipt_lines
   where id = (select (payload#>>'{lines,0,id}')::uuid from task3_confirmed_round)),
  166.6667::numeric,
  'purchase total divided by ordered quantity rounds to numeric(18,4) in authoritative storage'
);
select is(
  (select count(*) from public.warehouse_batches
   where receipt_line_id = (select (payload#>>'{lines,0,id}')::uuid from task3_confirmed_100)),
  1::bigint,
  'confirmed receipt line creates exactly one immutable cost batch'
);
select is(
  (select quantity from public.warehouse_batch_locations balance
   join public.warehouse_batches batch on batch.id = balance.batch_id
   where batch.receipt_line_id = (select (payload#>>'{lines,0,id}')::uuid from task3_confirmed_100)),
  2.000::numeric,
  'receipt confirmation posts the authoritative quantity to the selected shelf'
);
select is(
  (select count(*) from public.warehouse_inventory_movements movement
   where movement.source_document_type = 'warehouse_receipt'
     and movement.source_document_id = (select payload->>'id' from task3_confirmed_100)
     and movement.quantity_delta = 2 and movement.unit_cost = 100),
  1::bigint,
  'receipt confirmation appends one server-attributed stock-in movement'
);
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.confirm_warehouse_receipt_secure(
    (select (payload->>'id')::uuid from task3_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
      'confirmedQuantity', 2,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-receipt-100'
  )->>'id',
  (select payload->>'id' from task3_confirmed_100),
  'exact receipt confirmation retry returns the authoritative original document'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
      'confirmedQuantity', 1,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-receipt-100'
  )),
  'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT',
  'same receipt confirmation key with different canonical content conflicts'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_100),
      'confirmedQuantity', 2,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-receipt-second-key'
  )),
  'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED',
  'a confirmed receipt cannot post a second time under another key'
);
reset role;

select throws_ok(
  format(
    'insert into public.warehouse_batches(variant_id,receipt_line_id,received_at,unit_cost,original_quantity) values (%L,%L,statement_timestamp(),100,1)',
    'd0300000-0000-4000-8000-000000000001',
    (select payload#>>'{lines,0,id}' from task3_receipt_100)
  ),
  '23505', null,
  'database uniqueness prevents a second batch for one receipt line'
);
select throws_ok(
  format(
    'insert into public.warehouse_batches(variant_id,receipt_line_id,received_at,unit_cost,original_quantity) values (%L,%L,statement_timestamp(),100,1)',
    'd0300000-0000-4000-8000-000000000003',
    (select payload#>>'{lines,0,id}' from task3_receipt_bad_cost)
  ),
  '23503', null,
  'database FK prevents a receipt batch from using a different line variant'
);

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table task3_stock_out as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"FIFO验证","receiver":"王师傅","requestDate":"2026-08-09"}',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":4}]',
  't3-submit-stock-out'
) as payload;
select throws_ok(
  format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
      'confirmedQuantity', 4,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-requester'
  ),
  '42501', 'warehouse permission required',
  'stock requester cannot confirm without independent stock-flow confirm permission'
);
reset role;

select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
      'confirmedQuantity', 4,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-location-mismatch'
  )),
  'WAREHOUSE_LOCATION_MISMATCH',
  'stock-out rejects a shelf paired with the wrong warehouse'
);
create temporary table task3_confirmed_stock_out as
select public.confirm_warehouse_stock_out_secure(
  (select (payload->>'id')::uuid from task3_stock_out),
  jsonb_build_array(jsonb_build_object(
    'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
    'confirmedQuantity', 4,
    'warehouseId', 'd0000000-0000-4000-8000-000000000001',
    'locationId', 'e1100000-0000-4000-8000-000000000001'
  )),
  't3-confirm-stock-out'
) as payload;
select is((select payload->>'status' from task3_confirmed_stock_out), 'confirmed', 'FIFO stock-out confirmation is terminal');
select is((select (payload#>>'{lines,0,frozenTotalCost}')::numeric from task3_confirmed_stock_out), 460.0000::numeric, 'FIFO issue spans ¥100 and ¥130 batches and freezes total ¥460');
select is((select payload#>>'{lines,0,warehouseId}' from task3_confirmed_stock_out), 'd0000000-0000-4000-8000-000000000001', 'stock-out confirmation response binds the authoritative source warehouse');
select is((select payload#>>'{lines,0,locationId}' from task3_confirmed_stock_out), 'e1100000-0000-4000-8000-000000000001', 'stock-out confirmation response binds the authoritative source shelf');
select is((select payload->>'confirmationIdempotencyKey' from task3_confirmed_stock_out), 't3-confirm-stock-out', 'stock-out response binds the confirmation idempotency key');
reset role;
select is(
  (select count(*) from public.warehouse_inventory_movements movement
   where movement.source_document_type = 'warehouse_stock_out'
     and movement.source_document_id = (select payload->>'id' from task3_confirmed_stock_out)),
  2::bigint,
  'FIFO spanning issue writes one immutable movement per consumed batch'
);
select is(
  (select coalesce(sum(-movement.quantity_delta * movement.unit_cost), 0)
   from public.warehouse_inventory_movements movement
   where movement.source_document_type = 'warehouse_stock_out'
     and movement.source_document_id = (select payload->>'id' from task3_confirmed_stock_out)),
  460.0000::numeric,
  'FIFO movement quantities and frozen batch prices reconcile to the line total'
);
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.confirm_warehouse_stock_out_secure(
    (select (payload->>'id')::uuid from task3_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
      'confirmedQuantity', 4,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-out'
  )->>'id',
  (select payload->>'id' from task3_confirmed_stock_out),
  'exact stock-out confirmation retry returns the original frozen result'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
      'confirmedQuantity', 3,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-out'
  )),
  'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT',
  'same stock-out confirmation key with different payload conflicts'
);
reset role;

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table task3_cost_redacted_stock_out as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"脱敏验证","receiver":"王师傅","requestDate":"2026-08-09"}',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1}]',
  't3-submit-stock-redacted'
) as payload;
reset role;
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000003', true);
set local role authenticated;
create temporary table task3_confirmed_redacted_stock_out as
select public.confirm_warehouse_stock_out_secure(
  (select (payload->>'id')::uuid from task3_cost_redacted_stock_out),
  jsonb_build_array(jsonb_build_object(
    'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_cost_redacted_stock_out),
    'confirmedQuantity', 1,
    'warehouseId', 'e1000000-0000-4000-8000-000000000001',
    'locationId', 'e1100000-0000-4000-8000-000000000002'
  )),
  't3-confirm-stock-redacted'
) as payload;
select is(
  (select payload#>>'{lines,0,frozenTotalCost}' from task3_confirmed_redacted_stock_out),
  null,
  'confirm-only employee receives a cost-redacted stock-out response'
);
reset role;
select is(
  (select frozen_total_cost from public.warehouse_stock_out_lines
   where id = (select (payload#>>'{lines,0,id}')::uuid from task3_confirmed_redacted_stock_out)),
  166.6667::numeric,
  'cost redaction does not remove the authoritative frozen stock-out cost'
);

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000001', true);
set local role service_role;
update public.purchase_records
set payload = jsonb_set(payload, '{totalCost}', '9999'::jsonb)
where record_key in ('PO-T3-100', 'PO-T3-130');
update public.warehouse_variants set default_purchase_price = 999
where id = 'd0300000-0000-4000-8000-000000000001';
reset role;
select is(
  (select frozen_total_cost from public.warehouse_stock_out_lines
   where id = (select (payload#>>'{lines,0,id}')::uuid from task3_confirmed_stock_out)),
  460.0000::numeric,
  'later purchase and catalog price edits do not change historical FIFO cost'
);
select is(
  (select sum(-quantity_delta * unit_cost) from public.warehouse_inventory_movements
   where source_document_type = 'warehouse_stock_out'
     and source_document_id = (select payload->>'id' from task3_confirmed_stock_out)),
  460.0000::numeric,
  'immutable historical movement cost remains frozen after price edits'
);

select set_config('request.jwt.claim.sub', 'd0500000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table task3_unsafe_total_stock_out as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"安全金额上限验证","receiver":"王师傅","requestDate":"2026-08-09"}',
  '[{"variantId":"e1300000-0000-4000-8000-000000000001","requestedQuantity":2}]',
  't3-submit-stock-unsafe-total'
) as payload;
create temporary table task3_short_stock_out as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"不足验证","receiver":"王师傅","requestDate":"2026-08-09"}',
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":2}]',
  't3-submit-stock-short'
) as payload;
reset role;
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_unsafe_total_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_unsafe_total_stock_out),
      'confirmedQuantity', 2,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000002'
    )),
    't3-confirm-stock-unsafe-total'
  )),
  'WAREHOUSE_PURCHASE_COST_INVALID',
  'FIFO confirmation rejects a frozen total above the browser-safe maximum'
);
reset role;
select is(
  (select status from public.warehouse_stock_out_requests
   where id = (select (payload->>'id')::uuid from task3_unsafe_total_stock_out)),
  'pending',
  'unsafe frozen-total rejection leaves the stock-out request pending'
);
select results_eq(
  $$select batch_id, quantity
    from public.warehouse_batch_locations
    where batch_id in (
      'e1400000-0000-4000-8000-000000000001',
      'e1400000-0000-4000-8000-000000000002'
    ) and location_id = 'e1100000-0000-4000-8000-000000000002'
    order by batch_id$$,
  $$values
    ('e1400000-0000-4000-8000-000000000001'::uuid, 1.000::numeric),
    ('e1400000-0000-4000-8000-000000000002'::uuid, 1.000::numeric)$$,
  'second-batch cost overflow rolls back the first FIFO balance write too'
);
select is(
  (select count(*) from public.warehouse_inventory_movements
   where source_document_id = (select payload->>'id' from task3_unsafe_total_stock_out)),
  0::bigint,
  'unsafe frozen-total rejection appends no movement'
);
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_short_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_short_stock_out),
      'confirmedQuantity', 2,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-short'
  )),
  'WAREHOUSE_INSUFFICIENT_STOCK',
  'insufficient selected-location stock rolls back the whole confirmation'
);
reset role;
select is(
  (select status from public.warehouse_stock_out_requests
   where id = (select (payload->>'id')::uuid from task3_short_stock_out)),
  'pending',
  'failed insufficient-stock confirmation leaves request pending'
);
select is(
  (select count(*) from public.warehouse_inventory_movements
   where source_document_id = (select payload->>'id' from task3_short_stock_out)),
  0::bigint,
  'failed insufficient-stock confirmation leaves no partial movement'
);
select is(
  (select confirmation_idempotency_key from public.warehouse_receipts
   where id = (select (payload->>'id')::uuid from retry_void_before)),
  null,
  'void-before-confirmation receipt carries no confirmation identity'
);
select is(
  pg_temp.task1_deferred_error(format(
    'update public.warehouse_receipts set confirmation_idempotency_key=%L, confirmation_payload=%L::jsonb where id=%L',
    'forged-pending-confirmation', '{"receiptId":"d7100000-0000-4000-8000-000000000002","lines":[]}',
    'd7100000-0000-4000-8000-000000000002'
  )),
  '23514',
  'pending receipt cannot carry a forged confirmation identity'
);
update public.warehouse_receipts
set status = 'void', rejection_reason = '确认后冲销前的历史保留测试'
where id = (select (payload->>'id')::uuid from task3_confirmed_round);
select is(
  (select confirmation_idempotency_key from public.warehouse_receipts
   where id = (select (payload->>'id')::uuid from task3_confirmed_round)),
  't3-confirm-receipt-round',
  'void-after-confirmation retains its immutable confirmation identity for reversal history'
);
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  public.confirm_warehouse_receipt_secure(
    (select (payload->>'id')::uuid from task3_receipt_round),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_round),
      'confirmedQuantity', 1,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000002'
    )),
    't3-confirm-receipt-round'
  )->>'status',
  'void',
  'exact receipt confirmation retry returns the current authoritative void document'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_receipt_round),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from task3_receipt_round),
      'confirmedQuantity', 0.5,
      'warehouseId', 'e1000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000002'
    )),
    't3-confirm-receipt-round'
  )),
  'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT',
  'void receipt retains same-key different-payload conflict protection'
);
reset role;

update public.warehouse_stock_out_requests
set status = 'void', rejection_reason = '确认后冲销前的历史保留测试'
where id = (select (payload->>'id')::uuid from task3_confirmed_stock_out);
select set_config('request.jwt.claim.sub', 'e1500000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.confirm_warehouse_stock_out_secure(
    (select (payload->>'id')::uuid from task3_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
      'confirmedQuantity', 4,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-out'
  )->>'status',
  'void',
  'exact stock-out confirmation retry returns the current authoritative void document'
);
select is(
  pg_temp.task1_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from task3_stock_out),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId', (select payload#>>'{lines,0,id}' from task3_stock_out),
      'confirmedQuantity', 4,
      'warehouseId', 'd0000000-0000-4000-8000-000000000001',
      'locationId', 'e1100000-0000-4000-8000-000000000001'
    )),
    't3-confirm-stock-out-new-key'
  )),
  'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED',
  'void stock-out cannot be reconfirmed under a new key'
);
reset role;

select * from finish();
rollback;

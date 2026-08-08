begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

create or replace function pg_temp.task1_error_hint(p_statement text)
returns text
language plpgsql
as $$
declare captured text;
begin
  execute p_statement;
  return null;
exception when others then
  get stacked diagnostics captured = PG_EXCEPTION_HINT;
  return captured;
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

select is(
  (
    with rpc(signature) as (
      values
        (to_regprocedure('public.create_minor_work_order_secure(jsonb)')),
        (to_regprocedure('public.assign_minor_work_order_to_project_secure(uuid,text)')),
        (to_regprocedure('public.submit_warehouse_receipt_secure(text,jsonb,text)')),
        (to_regprocedure('public.submit_warehouse_stock_out_secure(jsonb,jsonb,text)')),
        (to_regprocedure('public.submit_warehouse_return_secure(uuid,jsonb,jsonb,text)'))
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

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'd0500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'workflow-submit@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'workflow-denied@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-8000-000000000000', 'd0500000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'workflow-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('d0600000-0000-4000-8000-000000000001', 'SW-9871', 'd0500000-0000-4000-8000-000000000001', '仓库申请人', '采购部', '部长', '在职', 'active', false),
  ('d0600000-0000-4000-8000-000000000002', 'SW-9872', 'd0500000-0000-4000-8000-000000000002', '无权员工', '工程部', '大工', '在职', 'active', false),
  ('d0600000-0000-4000-8000-000000000003', 'SW-9873', 'd0500000-0000-4000-8000-000000000003', '停用员工', '采购部', '部长', '在职', 'disabled', false);

insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('department', '采购部', 'warehouse.receipt.submit'),
  ('department', '采购部', 'warehouse.stock_flow.request');

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
  ('d0300000-0000-4000-8000-000000000002', 'd0200000-0000-4000-8000-000000000001', 'WF-CU-02', 'R410A', '9mm', '铜', '米', 0, 120, 'SWERP:VARIANT:d0300000-0000-4000-8000-000000000002', false);

insert into public.purchase_records(record_key, payload, status) values
  ('PO-WF-001', '{"purchaseId":"PO-WF-001","itemName":"空调铜管","totalCost":1000}'::jsonb, 'active');
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
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":2.125,"warehouseId":"d0000000-0000-4000-8000-000000000001","locationId":"d0100000-0000-4000-8000-000000000001"}]',
  'receipt-wf-001'
) as payload;
select is((select payload->>'status' from saved_receipt), 'pending', 'receipt submission stays pending');
select is((select payload#>>'{lines,0,unitCost}' from saved_receipt), null, 'receipt submission accepts no browser price');
select is((select payload#>>'{lines,0,confirmedQuantity}' from saved_receipt), null, 'receipt submission has no confirmed quantity');

create temporary table saved_out as
select public.submit_warehouse_stock_out_secure(
  jsonb_build_object(
    'destinationType', 'minor_work_order', 'projectId', null,
    'minorWorkOrderId', (select payload->>'id' from saved_minor),
    'destinationNameSnapshot', '未来社・安装一台空调',
    'purpose', '安装使用', 'receiver', '王师傅', 'requestDate', '2026-08-09'
  ),
  '[{"variantId":"d0300000-0000-4000-8000-000000000001","requestedQuantity":1}]',
  'out-wf-001'
) as payload;
select is((select payload->>'status' from saved_out), 'pending', 'minor-work outbound submission stays pending');
select is((select payload->>'projectId' from saved_out), null, 'minor-work outbound does not create or reference a fake project');

reset role;
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
  set confirmed_quantity = requested_quantity, unit_cost = 0
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
  jsonb_build_array(jsonb_build_object(
    'originalStockOutLineId', (select payload#>>'{lines,0,id}' from saved_out),
    'requestedQuantity', 1
  )),
  'return-wf-001'
) as payload;
select is((select payload->>'status' from saved_return), 'pending', 'return submission stays pending');
reset role;
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

select * from finish();
rollback;

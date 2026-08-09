begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

create or replace function pg_temp.operation_error_hint(p_statement text)
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

select ok(to_regclass('public.warehouse_transfers') is not null, 'warehouse transfers table exists behind RPC-only access');
select ok(to_regclass('public.warehouse_transfer_lines') is not null, 'warehouse transfer lines table exists behind RPC-only access');
select ok(to_regclass('public.warehouse_stocktakes') is not null, 'warehouse stocktakes table exists behind RPC-only access');
select ok(to_regclass('public.warehouse_stocktake_lines') is not null, 'warehouse stocktake lines table exists behind RPC-only access');
select ok(to_regclass('public.warehouse_operation_reversals') is not null, 'warehouse operation reversals table exists behind RPC-only access');
select has_function('public', 'confirm_warehouse_transfer_secure', array[
  'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'uuid', 'numeric', 'text', 'text'
]);
select has_function('public', 'confirm_warehouse_stocktake_secure', array[
  'uuid', 'uuid', 'text', 'jsonb', 'text'
]);
select has_function('public', 'reverse_warehouse_operation_secure', array[
  'text', 'uuid', 'text', 'text'
]);
select ok(
  strpos(pg_get_functiondef('public.confirm_warehouse_transfer_secure(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure),
    'least(p_source_location_id,p_destination_location_id)')
  < strpos(pg_get_functiondef('public.confirm_warehouse_transfer_secure(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure),
    'greatest(p_source_location_id,p_destination_location_id)'),
  'transfer locks both locations in canonical UUID order'
);
select ok(
  pg_get_functiondef('public.confirm_warehouse_stocktake_secure(uuid,uuid,text,jsonb,text)'::regprocedure)
    like '%select distinct (value->>''locationId'')::uuid from jsonb_array_elements(p_lines) order by 1%'
  and pg_get_functiondef('public.confirm_warehouse_stocktake_secure(uuid,uuid,text,jsonb,text)'::regprocedure)
    like '%order by balance.batch_id,balance.location_id%for update of balance%',
  'stocktake locks supplied locations and balance rows in canonical order'
);
select ok(
  pg_get_functiondef('public.reverse_warehouse_operation_secure(text,uuid,text,text)'::regprocedure)
    like '%select distinct location_id%order by location_id%'
  and pg_get_functiondef('public.reverse_warehouse_operation_secure(text,uuid,text,text)'::regprocedure)
    like '%order by balance.batch_id, balance.location_id%for update%',
  'reversal locks source locations and balances in canonical order'
);
select ok(
  pg_get_functiondef('public.confirm_warehouse_transfer_secure(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text)'::regprocedure)
    like '%jsonb_array_length(allocations)>10000%WAREHOUSE_OPERATION_TOO_COMPLEX%'
  and pg_get_functiondef('public.confirm_warehouse_stocktake_secure(uuid,uuid,text,jsonb,text)'::regprocedure)
    like '%row_count>20000%WAREHOUSE_OPERATION_TOO_COMPLEX%'
  and pg_get_functiondef('public.reverse_warehouse_operation_secure(text,uuid,text,text)'::regprocedure)
    like '%original_count > 20000%WAREHOUSE_OPERATION_TOO_COMPLEX%',
  'database and client share a bounded 20000-movement operation response contract'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'c0100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'operations-full@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'operations-peer@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'operations-stocktake@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('c0200000-0000-4000-8000-000000000001', 'SW-9861', 'c0100000-0000-4000-8000-000000000001', '操作负责人', '采购部', '部长', '在职', 'active', false),
  ('c0200000-0000-4000-8000-000000000002', 'SW-9862', 'c0100000-0000-4000-8000-000000000002', '其他调拨人', '营业部', '主任', '在职', 'active', false),
  ('c0200000-0000-4000-8000-000000000003', 'SW-9863', 'c0100000-0000-4000-8000-000000000003', '无成本盘点人', '事务部', '主任', '在职', 'active', false);

insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('department', '采购部', 'warehouse.receipt.confirm'),
  ('department', '采购部', 'warehouse.transfer.manage'),
  ('department', '采购部', 'warehouse.stocktake.confirm'),
  ('department', '采购部', 'warehouse.cost.view'),
  ('department', '采购部', 'warehouse.stock_flow.request'),
  ('department', '采购部', 'warehouse.stock_flow.confirm'),
  ('department', '营业部', 'warehouse.transfer.manage'),
  ('department', '事务部', 'warehouse.stocktake.confirm');

insert into public.warehouse_sites(id, code, name, kind, active) values
  ('c1000000-0000-4000-8000-000000000001', 'OP-A', '操作测试A仓', 'normal', true),
  ('c1000000-0000-4000-8000-000000000002', 'OP-B', '操作测试B仓', 'normal', true);
insert into public.warehouse_locations(id, warehouse_id, shelf_code, shelf_name, active) values
  ('c1100000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'A-01', 'A仓一号架', true),
  ('c1100000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001', 'A-02', 'A仓二号架', true),
  ('c1100000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000002', 'B-01', 'B仓一号架', true);
insert into public.warehouse_items(id, name, category, brand, description, active) values
  ('c1200000-0000-4000-8000-000000000001', '操作测试材料', '测试', '', '', true);
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, active
) values
  ('c1300000-0000-4000-8000-000000000001', 'c1200000-0000-4000-8000-000000000001', 'OP-V1', '', '', '', '个', 0, 100, 'SWERP:VARIANT:c1300000-0000-4000-8000-000000000001', true),
  ('c1300000-0000-4000-8000-000000000002', 'c1200000-0000-4000-8000-000000000001', 'OP-V2', '', '', '', '个', 0, 0, 'SWERP:VARIANT:c1300000-0000-4000-8000-000000000002', true),
  ('c1300000-0000-4000-8000-000000000003', 'c1200000-0000-4000-8000-000000000001', 'OP-V3', '', '', '', '个', 0, 0, 'SWERP:VARIANT:c1300000-0000-4000-8000-000000000003', true);
insert into public.warehouse_batches(
  id, variant_id, receipt_line_id, received_at, unit_cost, original_quantity
) values (
  'c1400000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001', null, now() - interval '1 day', 100, 10
),(
  'c1400000-0000-4000-8000-000000000002',
  'c1300000-0000-4000-8000-000000000003', null, now() - interval '3 days', 10, 2
),(
  'c1400000-0000-4000-8000-000000000003',
  'c1300000-0000-4000-8000-000000000003', null, now() - interval '2 days', 20, 3
),(
  'c1400000-0000-4000-8000-000000000004',
  'c1300000-0000-4000-8000-000000000002', null, now() - interval '4 days', 30, 2
);
insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
  ('c1400000-0000-4000-8000-000000000001', 'c1100000-0000-4000-8000-000000000001', 10),
  ('c1400000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000001', 2),
  ('c1400000-0000-4000-8000-000000000003', 'c1100000-0000-4000-8000-000000000001', 3),
  ('c1400000-0000-4000-8000-000000000004', 'c1100000-0000-4000-8000-000000000001', 2);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000001', true);
set local role authenticated;

create temporary table operation_transfer_result as
select public.confirm_warehouse_transfer_secure(
  'c2000000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000002',
  3, '调拨测试', 'operation-transfer-1'
) as payload;
reset role;

select is((select payload->>'status' from operation_transfer_result), 'confirmed', 'transfer confirms');
select is((select jsonb_array_length(payload->'movementIds') from operation_transfer_result), 2, 'transfer returns one distinct movement pair');
select is((select sum(quantity) from public.warehouse_batch_locations where batch_id = 'c1400000-0000-4000-8000-000000000001'), 10.000::numeric, 'transfer conserves company quantity');
select is((select quantity from public.warehouse_batch_locations where batch_id = 'c1400000-0000-4000-8000-000000000001' and location_id = 'c1100000-0000-4000-8000-000000000001'), 7.000::numeric, 'transfer subtracts source');
select is((select quantity from public.warehouse_batch_locations where batch_id = 'c1400000-0000-4000-8000-000000000001' and location_id = 'c1100000-0000-4000-8000-000000000002'), 3.000::numeric, 'transfer adds same batch at destination');
select is((select count(*) from public.warehouse_inventory_movements where source_document_type = 'warehouse_transfer' and source_document_id = 'c2000000-0000-4000-8000-000000000001'), 2::bigint, 'transfer appends two immutable movements');

set local role authenticated;
create temporary table operation_multibatch_transfer_result as
select public.confirm_warehouse_transfer_secure(
  'c2000000-0000-4000-8000-000000000002',
  'c1300000-0000-4000-8000-000000000003',
  'c1000000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000003',
  4, '同仓跨价格批次移架', 'operation-transfer-multibatch'
) as payload;
reset role;
select is((select jsonb_array_length(payload->'movementIds') from operation_multibatch_transfer_result), 4, 'multi-batch transfer returns one movement pair per source price batch');
select is((select payload->>'totalCost' from operation_multibatch_transfer_result), '60.0000', 'multi-batch transfer freezes the FIFO per-batch total');
select is((select count(distinct unit_cost) from public.warehouse_transfer_lines where transfer_id='c2000000-0000-4000-8000-000000000002'), 2::bigint, 'same-warehouse shelf transfer preserves both original batch prices');
select is((select sum(quantity) from public.warehouse_batch_locations where batch_id in('c1400000-0000-4000-8000-000000000002','c1400000-0000-4000-8000-000000000003')), 5.000::numeric, 'multi-batch shelf transfer conserves total company quantity');

set local role authenticated;
select public.confirm_warehouse_transfer_secure(
  'c2000000-0000-4000-8000-000000000003',
  'c1300000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000002',
  'c1100000-0000-4000-8000-000000000002',
  2, '独立冲销夹具', 'operation-transfer-reversal-fixture'
);
reset role;

set local role authenticated;
select is(
  public.confirm_warehouse_transfer_secure(
    'c2000000-0000-4000-8000-000000000001',
    'c1300000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000002',
    3, '调拨测试', 'operation-transfer-1'
  ),
  (select payload from operation_transfer_result),
  'exact transfer retry returns the same authoritative snapshot'
);

reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_transfer_secure(
    'c2000000-0000-4000-8000-000000000001',
    'c1300000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    'c1100000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002',
    'c1100000-0000-4000-8000-000000000002',
    3, '调拨测试', 'operation-transfer-1'
  )$sql$),
  'WAREHOUSE_OPERATION_ACTOR_CONFLICT',
  'exact transfer retry is actor-bound'
);

reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001',
    '2026-08',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000001","variantId":"c1300000-0000-4000-8000-000000000002","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":1,"differenceType":"gain","reason":"首次盘盈审批","approvedUnitCost":0}]',
    'operation-stocktake-no-cost'
  )$sql$),
  'WAREHOUSE_STOCKTAKE_COST_PERMISSION_REQUIRED',
  'zero-stock gain with approved cost requires independent cost permission'
);

reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table operation_stocktake_result as
select public.confirm_warehouse_stocktake_secure(
  'c3000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  '2026-08',
  '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000001","variantId":"c1300000-0000-4000-8000-000000000002","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":1,"differenceType":"gain","reason":"首次盘盈审批","approvedUnitCost":0}]',
  'operation-stocktake-1'
) as payload;
reset role;
select is((select payload#>>'{lines,0,totalCost}' from operation_stocktake_result), '0.0000', 'zero price stocktake remains authoritative zero');
select is((select payload#>>'{lines,0,quantityDelta}' from operation_stocktake_result), '1.000', 'stocktake freezes exact delta');
select is((select jsonb_array_length(payload#>'{lines,0,movementIds}') from operation_stocktake_result), 1, 'stocktake appends exactly one fact per line');

set local role authenticated;
select is(
  public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','2026-08',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000001","variantId":"c1300000-0000-4000-8000-000000000002","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":1,"differenceType":"gain","reason":"首次盘盈审批","approvedUnitCost":0}]',
    'operation-stocktake-1'
  ),
  (select payload from operation_stocktake_result),
  'exact stocktake retry returns the same authoritative snapshot'
);
select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','2026-08',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000001","variantId":"c1300000-0000-4000-8000-000000000002","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":2,"differenceType":"gain","reason":"修改后的盘盈","approvedUnitCost":0}]',
    'operation-stocktake-1'
  )$sql$),
  'WAREHOUSE_OPERATION_IDEMPOTENCY_CONFLICT',
  'stocktake retry rejects a changed payload'
);
reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','2026-08',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000001","variantId":"c1300000-0000-4000-8000-000000000002","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":1,"differenceType":"gain","reason":"首次盘盈审批","approvedUnitCost":0}]',
    'operation-stocktake-1'
  )$sql$),
  'WAREHOUSE_OPERATION_ACTOR_CONFLICT',
  'exact stocktake retry is bound to the original actor'
);
reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000001',
    '2026-09',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000002","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":8,"differenceType":"gain","reason":"伪造盘盈","approvedUnitCost":999}]',
    'operation-stocktake-forged-cost'
  )$sql$),
  'WAREHOUSE_STOCKTAKE_APPROVED_COST_INVALID',
  'existing stock rejects a client approved unit cost'
);

select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000001',
    '2026-09',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000003","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":6,"differenceType":"gain","reason":"伪造差异类型","approvedUnitCost":null}]',
    'operation-stocktake-forged-type'
  )$sql$),
  'WAREHOUSE_STOCKTAKE_DIFFERENCE_MISMATCH',
  'stocktake validates difference type after authoritative lock'
);

select is(
  pg_temp.operation_error_hint($sql$select public.confirm_warehouse_stocktake_secure(
    'c3000000-0000-4000-8000-000000000004',
    'c1000000-0000-4000-8000-000000000001',
    '2026-08',
    '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000004","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000001","countedQuantity":7,"differenceType":"no_change","reason":"","approvedUnitCost":null}]',
    'operation-stocktake-duplicate-month'
  )$sql$),
  'WAREHOUSE_STOCKTAKE_MONTH_CONFLICT',
  'only one active confirmed monthly stocktake exists per warehouse'
);

create temporary table operation_multibatch_stocktake_result as
select public.confirm_warehouse_stocktake_secure(
  'c3000000-0000-4000-8000-000000000005',
  'c1000000-0000-4000-8000-000000000001',
  '2027-01',
  '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000005","variantId":"c1300000-0000-4000-8000-000000000003","locationId":"c1100000-0000-4000-8000-000000000003","countedQuantity":1,"differenceType":"loss","reason":"跨批次盘亏","approvedUnitCost":null}]',
  'operation-stocktake-multibatch'
) as payload;
reset role;
select is((select jsonb_array_length(payload#>'{lines,0,movementIds}') from operation_multibatch_stocktake_result), 2, 'multi-batch stocktake loss records one movement per consumed price batch');
select is((select payload#>>'{lines,0,totalCost}' from operation_multibatch_stocktake_result), '40.0000', 'multi-batch stocktake freezes the exact sum of per-batch costs');

set local role authenticated;
create temporary table operation_damaged_stocktake_result as
select public.confirm_warehouse_stocktake_secure(
  'c3000000-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000002','2026-09',
  '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000006","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000002","countedQuantity":2,"differenceType":"loss","reason":"盘亏一件","approvedUnitCost":null}]',
  'operation-stocktake-loss'
) as payload;
reset role;
select is((select movement_type from public.warehouse_inventory_movements where source_document_type='warehouse_stocktake' and source_document_id='c3000000-0000-4000-8000-000000000006'), '盘亏', 'loss creates the closed movement type');
select is((select payload#>>'{lines,0,quantityDelta}' from operation_damaged_stocktake_result), '-1.000', 'loss freezes a negative delta');

set local role authenticated;
select public.confirm_warehouse_stocktake_secure(
  'c3000000-0000-4000-8000-000000000007','c1000000-0000-4000-8000-000000000002','2026-10',
  '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000007","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000002","countedQuantity":1,"differenceType":"damaged","reason":"确认损坏","approvedUnitCost":null}]',
  'operation-stocktake-damaged'
);
reset role;
select is((select movement_type from public.warehouse_inventory_movements where source_document_type='warehouse_stocktake' and source_document_id='c3000000-0000-4000-8000-000000000007'), '损坏', 'damaged creates the closed movement type');

set local role authenticated;
select public.confirm_warehouse_stocktake_secure(
  'c3000000-0000-4000-8000-000000000008','c1000000-0000-4000-8000-000000000002','2026-11',
  '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000008","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000002","countedQuantity":0,"differenceType":"scrapped","reason":"确认报废","approvedUnitCost":null}]',
  'operation-stocktake-scrapped'
);
reset role;
select is((select movement_type from public.warehouse_inventory_movements where source_document_type='warehouse_stocktake' and source_document_id='c3000000-0000-4000-8000-000000000008'), '报废', 'scrapped creates the closed movement type');

set local role authenticated;
select public.confirm_warehouse_stocktake_secure(
  'c3000000-0000-4000-8000-000000000009','c1000000-0000-4000-8000-000000000002','2026-12',
  '[{"stocktakeLineId":"c3100000-0000-4000-8000-000000000009","variantId":"c1300000-0000-4000-8000-000000000001","locationId":"c1100000-0000-4000-8000-000000000002","countedQuantity":0,"differenceType":"no_change","reason":"","approvedUnitCost":null}]',
  'operation-stocktake-no-change'
);
reset role;
select is((select movement_type from public.warehouse_inventory_movements where source_document_type='warehouse_stocktake' and source_document_id='c3000000-0000-4000-8000-000000000009'), '盘点无差异', 'no-change still appends an auditable zero-delta fact');

set local role authenticated;
create temporary table operation_reversal_result as
select public.reverse_warehouse_operation_secure(
  'warehouse_transfer', 'c2000000-0000-4000-8000-000000000003',
  '调拨整单录入错误', 'operation-reversal-1'
) as payload;
reset role;
select is((select status from public.warehouse_transfers where id = 'c2000000-0000-4000-8000-000000000003'), 'void', 'reversal voids but retains original transfer');
select is((select count(*) from public.warehouse_inventory_movements where source_document_type = 'warehouse_reversal' and reversal_of_movement_id is not null), 2::bigint, 'transfer reversal appends a complete opposite pair');
select is((select quantity from public.warehouse_batch_locations where batch_id = 'c1400000-0000-4000-8000-000000000004' and location_id = 'c1100000-0000-4000-8000-000000000001'), 2.000::numeric, 'transfer reversal restores source quantity');
select is((select quantity from public.warehouse_batch_locations where batch_id = 'c1400000-0000-4000-8000-000000000004' and location_id = 'c1100000-0000-4000-8000-000000000002'), 0.000::numeric, 'transfer reversal removes destination quantity');
set local role authenticated;
select is(
  public.reverse_warehouse_operation_secure(
    'warehouse_transfer', 'c2000000-0000-4000-8000-000000000003',
    '调拨整单录入错误', 'operation-reversal-1'
  ),
  (select payload from operation_reversal_result),
  'exact reversal retry returns the original immutable result'
);
select is(
  pg_temp.operation_error_hint($sql$select public.reverse_warehouse_operation_secure(
    'warehouse_transfer', 'c2000000-0000-4000-8000-000000000003',
    '修改冲销理由', 'operation-reversal-1'
  )$sql$),
  'WAREHOUSE_OPERATION_IDEMPOTENCY_CONFLICT',
  'same reversal key rejects a changed payload'
);
select is(
  pg_temp.operation_error_hint($sql$select public.reverse_warehouse_operation_secure(
    'warehouse_transfer', 'c2000000-0000-4000-8000-000000000003',
    '调拨整单录入错误', 'operation-reversal-changed-key'
  )$sql$),
  'WAREHOUSE_OPERATION_IDEMPOTENCY_CONFLICT',
  'same source document rejects a changed reversal key'
);

reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.reverse_warehouse_operation_secure(
    'warehouse_transfer', 'c2000000-0000-4000-8000-000000000003',
    '调拨整单录入错误', 'operation-reversal-1'
  )$sql$),
  'WAREHOUSE_OPERATION_ACTOR_CONFLICT',
  'exact reversal retry is bound to the original actor'
);

reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000001', true);
update public.warehouse_batch_locations
set quantity=0
where batch_id='c1400000-0000-4000-8000-000000000002'
  and location_id='c1100000-0000-4000-8000-000000000003';
set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.reverse_warehouse_operation_secure(
    'warehouse_transfer', 'c2000000-0000-4000-8000-000000000002',
    '下游已消耗，不应允许冲销', 'operation-reversal-insufficient'
  )$sql$),
  'WAREHOUSE_REVERSAL_INSUFFICIENT_STOCK',
  'reversal rejects a positive original flow after destination stock was consumed'
);
reset role;
select is((select status from public.warehouse_transfers where id='c2000000-0000-4000-8000-000000000002'), 'confirmed', 'failed reversal leaves the source parent confirmed');
select is((select count(*) from public.warehouse_operation_reversals where source_document_id='c2000000-0000-4000-8000-000000000002'), 0::bigint, 'failed reversal appends no reversal record');
select is((select count(*) from public.warehouse_inventory_movements where source_document_type='warehouse_reversal' and metadata->>'sourceDocumentId'='c2000000-0000-4000-8000-000000000002'), 0::bigint, 'failed reversal appends no partial inverse movement');

-- Reversal coverage for every stock-changing document type.  These fixtures
-- deliberately freeze historical costs before reversal so later catalog or
-- purchase-price edits cannot rewrite an already-confirmed project result.
insert into public.purchase_records(record_key, payload, status) values (
  'PO-REV-RECEIPT',
  '{"purchaseId":"PO-REV-RECEIPT","itemName":"冲销收货材料","quantity":1,"unit":"个","totalCost":55}',
  'active'
);
insert into public.projects(record_key, payload, status) values
  ('P-REV-ARCHIVE', '{"projectId":"P-REV-ARCHIVE","projectName":"已归档冲销项目"}', 'deleted'),
  ('P-REV-RETURN', '{"projectId":"P-REV-RETURN","projectName":"退回冲销项目"}', 'active');

insert into public.warehouse_receipts(
  id, purchase_record_key, submitted_by_employee_profile_id,
  idempotency_key, submission_payload
) values (
  'c4000000-0000-4000-8000-000000000001', 'PO-REV-RECEIPT',
  'c0200000-0000-4000-8000-000000000001', 'reversal-receipt-submit', '{}'
);
insert into public.warehouse_receipt_lines(
  id, receipt_id, variant_id, requested_quantity
) values (
  'c4100000-0000-4000-8000-000000000001',
  'c4000000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001', 1
);
update public.warehouse_receipt_lines
set confirmed_quantity=1,
    warehouse_id='c1000000-0000-4000-8000-000000000001',
    location_id='c1100000-0000-4000-8000-000000000001', unit_cost=55
where id='c4100000-0000-4000-8000-000000000001';
update public.warehouse_receipts
set status='confirmed',
    confirmed_by_employee_profile_id='c0200000-0000-4000-8000-000000000001',
    confirmed_at=statement_timestamp(),
    confirmation_idempotency_key='reversal-receipt-confirm',
    confirmation_payload='{}'
where id='c4000000-0000-4000-8000-000000000001';
insert into public.warehouse_batches(
  id, variant_id, receipt_line_id, received_at, unit_cost, original_quantity
) values (
  'c4200000-0000-4000-8000-000000000001',
  'c1300000-0000-4000-8000-000000000001',
  'c4100000-0000-4000-8000-000000000001', statement_timestamp(), 55, 1
);
insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values (
  'c4200000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001', 1
);
insert into public.warehouse_inventory_movements(
  id, movement_type, variant_id, batch_id, warehouse_id, location_id,
  quantity_delta, unit_cost, source_document_type, source_document_id,
  idempotency_key, operator_employee_profile_id, occurred_at, metadata
) values (
  'c4300000-0000-4000-8000-000000000001', '采购入库',
  'c1300000-0000-4000-8000-000000000001',
  'c4200000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001', 1, 55,
  'warehouse_receipt', 'c4000000-0000-4000-8000-000000000001',
  'reversal-receipt-movement',
  'c0200000-0000-4000-8000-000000000001', statement_timestamp(),
  '{"receiptLineId":"c4100000-0000-4000-8000-000000000001"}'
);

insert into public.warehouse_batches(
  id, variant_id, received_at, unit_cost, original_quantity
) values
  ('c4200000-0000-4000-8000-000000000002', 'c1300000-0000-4000-8000-000000000001', statement_timestamp(), 40, 5),
  ('c4200000-0000-4000-8000-000000000003', 'c1300000-0000-4000-8000-000000000001', statement_timestamp(), 40, 5);
insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
  ('c4200000-0000-4000-8000-000000000002', 'c1100000-0000-4000-8000-000000000001', 3),
  ('c4200000-0000-4000-8000-000000000003', 'c1100000-0000-4000-8000-000000000001', 4);

insert into public.warehouse_stock_out_requests(
  id, destination_type, project_id, destination_name_snapshot, purpose,
  receiver, request_date, submitted_by_employee_profile_id,
  idempotency_key, submission_payload
) values
  ('c4400000-0000-4000-8000-000000000001', 'project', 'P-REV-ARCHIVE',
   '已归档冲销项目', '历史成本冲销', '仓库负责人', '2026-08-09',
   'c0200000-0000-4000-8000-000000000001', 'reversal-out-archive-submit', '{}'),
  ('c4400000-0000-4000-8000-000000000002', 'project', 'P-REV-RETURN',
   '退回冲销项目', '退回冲销验证', '仓库负责人', '2026-08-09',
   'c0200000-0000-4000-8000-000000000001', 'reversal-out-return-submit', '{}');
insert into public.warehouse_stock_out_lines(
  id, request_id, variant_id, requested_quantity
) values
  ('c4500000-0000-4000-8000-000000000001', 'c4400000-0000-4000-8000-000000000001', 'c1300000-0000-4000-8000-000000000001', 2),
  ('c4500000-0000-4000-8000-000000000002', 'c4400000-0000-4000-8000-000000000002', 'c1300000-0000-4000-8000-000000000001', 2);
update public.warehouse_stock_out_lines
set confirmed_quantity=2, frozen_total_cost=80
where id in('c4500000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000002');
update public.warehouse_stock_out_requests
set status='confirmed',
    confirmed_by_employee_profile_id='c0200000-0000-4000-8000-000000000001',
    confirmed_at=statement_timestamp(),
    confirmation_idempotency_key='reversal-out-confirm-'||id::text,
    confirmation_payload='{}'
where id in('c4400000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000002');
insert into public.warehouse_inventory_movements(
  id, movement_type, variant_id, batch_id, warehouse_id, location_id,
  quantity_delta, unit_cost, source_document_type, source_document_id,
  idempotency_key, project_id, destination_type, destination_id,
  destination_name, operator_employee_profile_id, occurred_at, metadata
) values
  ('c4300000-0000-4000-8000-000000000002', '项目出库', 'c1300000-0000-4000-8000-000000000001',
   'c4200000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
   'c1100000-0000-4000-8000-000000000001', -2, 40, 'warehouse_stock_out',
   'c4400000-0000-4000-8000-000000000001', 'reversal-out-archive-movement',
   'P-REV-ARCHIVE', 'project', 'P-REV-ARCHIVE', '已归档冲销项目',
   'c0200000-0000-4000-8000-000000000001', statement_timestamp(),
   '{"stockOutLineId":"c4500000-0000-4000-8000-000000000001"}'),
  ('c4300000-0000-4000-8000-000000000003', '项目出库', 'c1300000-0000-4000-8000-000000000001',
   'c4200000-0000-4000-8000-000000000003', 'c1000000-0000-4000-8000-000000000001',
   'c1100000-0000-4000-8000-000000000001', -2, 40, 'warehouse_stock_out',
   'c4400000-0000-4000-8000-000000000002', 'reversal-out-return-movement',
   'P-REV-RETURN', 'project', 'P-REV-RETURN', '退回冲销项目',
   'c0200000-0000-4000-8000-000000000001', statement_timestamp(),
   '{"stockOutLineId":"c4500000-0000-4000-8000-000000000002"}');
insert into public.project_cost_records(record_key, payload, status) values
  ('WAREHOUSE-SO:c4400000-0000-4000-8000-000000000001',
   '{"costRecordId":"WAREHOUSE-SO:c4400000-0000-4000-8000-000000000001","projectId":"P-REV-ARCHIVE","amount":80,"sourceType":"warehouse","sourceDocumentId":"c4400000-0000-4000-8000-000000000001","sourceDocumentType":"warehouse_stock_out"}', 'active'),
  ('WAREHOUSE-SO:c4400000-0000-4000-8000-000000000002',
   '{"costRecordId":"WAREHOUSE-SO:c4400000-0000-4000-8000-000000000002","projectId":"P-REV-RETURN","amount":80,"sourceType":"warehouse","sourceDocumentId":"c4400000-0000-4000-8000-000000000002","sourceDocumentType":"warehouse_stock_out"}', 'active');

insert into public.warehouse_return_requests(
  id, original_stock_out_id, reason, receiver, request_date,
  submitted_by_employee_profile_id, idempotency_key, submission_payload
) values (
  'c4600000-0000-4000-8000-000000000001',
  'c4400000-0000-4000-8000-000000000002', '原退回单冲销验证',
  '仓库负责人', '2026-08-09', 'c0200000-0000-4000-8000-000000000001',
  'reversal-return-submit', '{}'
);
insert into public.warehouse_return_lines(
  id, return_id, original_stock_out_id, original_stock_out_line_id,
  requested_quantity
) values (
  'c4700000-0000-4000-8000-000000000001',
  'c4600000-0000-4000-8000-000000000001',
  'c4400000-0000-4000-8000-000000000002',
  'c4500000-0000-4000-8000-000000000002', 1
);
update public.warehouse_return_lines
set confirmed_quantity=1, frozen_total_cost=40
where id='c4700000-0000-4000-8000-000000000001';
update public.warehouse_return_requests
set status='confirmed',
    confirmed_by_employee_profile_id='c0200000-0000-4000-8000-000000000001',
    confirmed_at=statement_timestamp(),
    confirmation_idempotency_key='reversal-return-confirm',
    confirmation_payload='{}'
where id='c4600000-0000-4000-8000-000000000001';
insert into public.warehouse_inventory_movements(
  id, movement_type, variant_id, batch_id, warehouse_id, location_id,
  quantity_delta, unit_cost, source_document_type, source_document_id,
  idempotency_key, project_id, destination_type, destination_id,
  destination_name, operator_employee_profile_id, occurred_at, metadata
) values (
  'c4300000-0000-4000-8000-000000000004', '项目退回',
  'c1300000-0000-4000-8000-000000000001',
  'c4200000-0000-4000-8000-000000000003',
  'c1000000-0000-4000-8000-000000000001',
  'c1100000-0000-4000-8000-000000000001', 1, 40,
  'warehouse_return', 'c4600000-0000-4000-8000-000000000001',
  'reversal-return-movement', 'P-REV-RETURN', 'project', 'P-REV-RETURN',
  '退回冲销项目', 'c0200000-0000-4000-8000-000000000001', statement_timestamp(),
  '{"returnLineId":"c4700000-0000-4000-8000-000000000001","stockOutLineId":"c4500000-0000-4000-8000-000000000002","originalMovementId":"c4300000-0000-4000-8000-000000000003"}'
);
insert into public.project_cost_records(record_key, payload, status) values (
  'WAREHOUSE-SR:c4600000-0000-4000-8000-000000000001',
  '{"costRecordId":"WAREHOUSE-SR:c4600000-0000-4000-8000-000000000001","projectId":"P-REV-RETURN","amount":-40,"sourceType":"warehouseReversal","sourceDocumentId":"c4600000-0000-4000-8000-000000000001","sourceDocumentType":"warehouse_return"}',
  'active'
);

set local role authenticated;
select public.reverse_warehouse_operation_secure(
  'warehouse_receipt', 'c4000000-0000-4000-8000-000000000001',
  '采购收货整单录错', 'operation-reversal-receipt'
);
reset role;
select is((select status from public.warehouse_receipts where id='c4000000-0000-4000-8000-000000000001'), 'void', 'receipt reversal retains and voids the source receipt');
select is((select quantity from public.warehouse_batch_locations where batch_id='c4200000-0000-4000-8000-000000000001' and location_id='c1100000-0000-4000-8000-000000000001'), 0.000::numeric, 'receipt reversal removes exactly the received quantity');
select is((select cost_adjustment from public.warehouse_operation_reversals where source_document_id='c4000000-0000-4000-8000-000000000001'), 0.0000::numeric, 'receipt reversal creates no project cost adjustment');

set local role authenticated;
select public.reverse_warehouse_operation_secure(
  'warehouse_stock_out', 'c4400000-0000-4000-8000-000000000001',
  '已归档项目出库整单录错', 'operation-reversal-out-archive'
);
reset role;
select is((select status from public.warehouse_stock_out_requests where id='c4400000-0000-4000-8000-000000000001'), 'void', 'archived-project stock-out reversal voids but retains the source');
select is((select quantity from public.warehouse_batch_locations where batch_id='c4200000-0000-4000-8000-000000000002' and location_id='c1100000-0000-4000-8000-000000000001'), 5.000::numeric, 'stock-out reversal restores the exact historical batch quantity');
select is((select (payload->>'amount')::numeric from public.project_cost_records where record_key like 'WAREHOUSE-WR:%' and payload->>'reversedSourceDocumentId'='c4400000-0000-4000-8000-000000000001'), -80.0000::numeric, 'archived-project reversal posts the exact negative frozen cost');
select is((select sum((payload->>'amount')::numeric) from public.project_cost_records where payload->>'projectId'='P-REV-ARCHIVE'), 0.0000::numeric, 'archived project material cost nets to zero without reopening the project');
select is(
  pg_temp.operation_error_hint($sql$update public.warehouse_stock_out_lines set frozen_total_cost=999 where id='c4500000-0000-4000-8000-000000000001'$sql$),
  'WAREHOUSE_OPERATION_IMMUTABLE',
  'void source lines remain immutable after reversal'
);

set local role authenticated;
select public.reverse_warehouse_operation_secure(
  'warehouse_return', 'c4600000-0000-4000-8000-000000000001',
  '退回单整单录错', 'operation-reversal-return'
);
create temporary table operation_return_context_after_void as
select public.list_warehouse_request_context_secure() as payload;
reset role;
select is((select status from public.warehouse_return_requests where id='c4600000-0000-4000-8000-000000000001'), 'void', 'return reversal voids but retains the original return');
select is((select quantity from public.warehouse_batch_locations where batch_id='c4200000-0000-4000-8000-000000000003' and location_id='c1100000-0000-4000-8000-000000000001'), 3.000::numeric, 'return reversal removes the previously returned quantity');
select is((select (payload->>'amount')::numeric from public.project_cost_records where record_key like 'WAREHOUSE-WR:%' and payload->>'reversedSourceDocumentId'='c4600000-0000-4000-8000-000000000001'), 40.0000::numeric, 'return reversal restores the exact original positive project cost');
select is((select sum((payload->>'amount')::numeric) from public.project_cost_records where payload->>'projectId'='P-REV-RETURN'), 80.0000::numeric, 'void return is excluded from the formal project net material cost');
select is(
  (select (request_line->>'remainingReturnable')::numeric
   from operation_return_context_after_void,
     jsonb_array_elements(payload->'stockOutRequests') request,
     jsonb_array_elements(request->'lines') request_line
   where request->>'id'='c4400000-0000-4000-8000-000000000002'),
  2.000::numeric,
  'void return no longer consumes the remaining returnable quantity'
);

insert into public.warehouse_return_requests(
  id, original_stock_out_id, reason, receiver, request_date,
  submitted_by_employee_profile_id, idempotency_key, submission_payload
) values (
  'c4600000-0000-4000-8000-000000000002',
  'c4400000-0000-4000-8000-000000000002', '冲销后重新退回',
  '仓库负责人', '2026-08-09', 'c0200000-0000-4000-8000-000000000001',
  'reversal-return-replacement-submit', '{}'
);
insert into public.warehouse_return_lines(
  id, return_id, original_stock_out_id, original_stock_out_line_id,
  requested_quantity
) values (
  'c4700000-0000-4000-8000-000000000002',
  'c4600000-0000-4000-8000-000000000002',
  'c4400000-0000-4000-8000-000000000002',
  'c4500000-0000-4000-8000-000000000002', 2
);
set local role authenticated;
select public.confirm_warehouse_return_secure(
  'c4600000-0000-4000-8000-000000000002',
  '[{"returnLineId":"c4700000-0000-4000-8000-000000000002","confirmedQuantity":2}]',
  'reversal-return-replacement-confirm'
);
select is(
  pg_temp.operation_error_hint($sql$select public.reverse_warehouse_operation_secure(
    'warehouse_stock_out', 'c4400000-0000-4000-8000-000000000002',
    '存在有效退回时禁止先冲销出库', 'operation-reversal-out-blocked'
  )$sql$),
  'WAREHOUSE_ACTIVE_RETURN_EXISTS',
  'stock-out reversal requires active confirmed returns to be reversed first'
);
reset role;
select is((select status from public.warehouse_stock_out_requests where id='c4400000-0000-4000-8000-000000000002'), 'confirmed', 'blocked stock-out reversal leaves the original confirmed');
select is((select quantity from public.warehouse_batch_locations where batch_id='c4200000-0000-4000-8000-000000000003' and location_id='c1100000-0000-4000-8000-000000000001'), 5.000::numeric, 'replacement return uses the entire authoritative remaining quantity');

set local role authenticated;
select public.reverse_warehouse_operation_secure(
  'warehouse_stocktake', 'c3000000-0000-4000-8000-000000000001',
  '盘盈数量整单录错', 'operation-reversal-stocktake-gain'
);
select public.reverse_warehouse_operation_secure(
  'warehouse_stocktake', 'c3000000-0000-4000-8000-000000000009',
  '无差异盘点备注录错', 'operation-reversal-stocktake-no-change'
);
reset role;
select is((select status from public.warehouse_stocktakes where id='c3000000-0000-4000-8000-000000000001'), 'void', 'stocktake gain reversal voids but retains the monthly stocktake');
select is((select count(*) from public.warehouse_inventory_movements where source_document_type='warehouse_reversal' and reversal_of_movement_id in(select id from public.warehouse_inventory_movements where source_document_type='warehouse_stocktake' and source_document_id='c3000000-0000-4000-8000-000000000009') and quantity_delta=0), 1::bigint, 'no-change stocktake reversal still appends an auditable zero inverse fact');

select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.reverse_warehouse_operation_secure(
    'warehouse_receipt', 'c4000000-0000-4000-8000-000000000001',
    '无权冲销收货', 'operation-reversal-receipt-peer'
  )$$,
  '42501', 'warehouse permission required',
  'reversal requires the matching document confirmation permission'
);
reset role;
select set_config('request.jwt.claim.sub', 'c0100000-0000-4000-8000-000000000001', true);
select is(
  pg_temp.operation_error_hint($sql$update public.warehouse_operation_reversals set reason='篡改理由' where source_document_id='c4000000-0000-4000-8000-000000000001'$sql$),
  'WAREHOUSE_OPERATION_IMMUTABLE',
  'reversal audit records remain immutable'
);

set local role authenticated;
select is(
  pg_temp.operation_error_hint($sql$select public.reverse_warehouse_operation_secure(
    'warehouse_reversal', 'c2000000-0000-4000-8000-000000000001',
    '再次冲销', 'operation-reversal-of-reversal'
  )$sql$),
  'WAREHOUSE_REVERSAL_SOURCE_INVALID',
  'reversal-of-reversal is rejected'
);

reset role;
select * from finish();
rollback;

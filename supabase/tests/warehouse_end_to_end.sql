begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

create or replace function pg_temp.e2e_error_hint(p_statement text)
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

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'aa500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'warehouse-e2e-manager@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'warehouse-e2e-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'aa500000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'warehouse-e2e-first-login@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('aa600000-0000-4000-8000-000000000001', 'SW-9851', 'aa500000-0000-4000-8000-000000000001', '本地验收仓库负责人', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('aa600000-0000-4000-8000-000000000002', 'SW-9852', 'aa500000-0000-4000-8000-000000000002', '停用仓库负责人', '仓库管理部', '仓库管理员', '在职', 'disabled', false),
  ('aa600000-0000-4000-8000-000000000003', 'SW-9853', 'aa500000-0000-4000-8000-000000000003', '首次登录仓库负责人', '仓库管理部', '仓库管理员', '在职', 'active', true);

insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('position', '仓库管理员', 'module.inventory.view'),
  ('position', '仓库管理员', 'warehouse.catalog.manage'),
  ('position', '仓库管理员', 'warehouse.receipt.submit'),
  ('position', '仓库管理员', 'warehouse.receipt.confirm'),
  ('position', '仓库管理员', 'warehouse.stock_flow.request'),
  ('position', '仓库管理员', 'warehouse.stock_flow.confirm'),
  ('position', '仓库管理员', 'warehouse.transfer.manage'),
  ('position', '仓库管理员', 'warehouse.stocktake.confirm'),
  ('position', '仓库管理员', 'warehouse.cost.view'),
  ('position', '仓库管理员', 'warehouse.report.export'),
  ('position', '仓库管理员', 'module.purchases.view'),
  ('position', '仓库管理员', 'module.purchases.create'),
  ('position', '仓库管理员', 'module.purchases.update')
on conflict do nothing;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'aa500000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  public.upsert_warehouse_site_secure(
    'aa000000-0000-4000-8000-000000000001',
    '{"id":"aa000000-0000-4000-8000-000000000001","code":"E2E-MAIN","name":"本地验收主仓","kind":"normal","active":true}'
  )->>'name',
  '本地验收主仓',
  'catalog creates the main warehouse through the secure RPC'
);
select is(
  public.upsert_warehouse_site_secure(
    'aa000000-0000-4000-8000-000000000002',
    '{"id":"aa000000-0000-4000-8000-000000000002","code":"E2E-BRANCH","name":"本地验收分仓","kind":"normal","active":true}'
  )->>'name',
  '本地验收分仓',
  'catalog creates a second warehouse through the secure RPC'
);
select is(
  public.upsert_warehouse_location_secure(
    'aa100000-0000-4000-8000-000000000001',
    '{"id":"aa100000-0000-4000-8000-000000000001","warehouseId":"aa000000-0000-4000-8000-000000000001","shelfCode":"A-01","shelfName":"主仓一号架","active":true}'
  )->>'shelfCode',
  'A-01',
  'catalog creates the main shelf through the secure RPC'
);
select is(
  public.upsert_warehouse_location_secure(
    'aa100000-0000-4000-8000-000000000002',
    '{"id":"aa100000-0000-4000-8000-000000000002","warehouseId":"aa000000-0000-4000-8000-000000000002","shelfCode":"B-01","shelfName":"分仓一号架","active":true}'
  )->>'shelfCode',
  'B-01',
  'catalog creates the branch shelf through the secure RPC'
);
select is(
  public.upsert_warehouse_item_secure(
    'aa200000-0000-4000-8000-000000000001',
    '{"id":"aa200000-0000-4000-8000-000000000001","name":"空调铜管","category":"空调材料","brand":"本地验收","description":"两批价格先进先出测试","active":true}'
  )->>'name',
  '空调铜管',
  'catalog creates a detailed item archive through the secure RPC'
);
select is(
  public.upsert_warehouse_variant_secure(
    'aa300000-0000-4000-8000-000000000001',
    '{"id":"aa300000-0000-4000-8000-000000000001","itemId":"aa200000-0000-4000-8000-000000000001","sku":"E2E-CU-6","model":"R410A","size":"6mm","material":"铜","unit":"米","minimumStock":10,"defaultPurchasePrice":100,"manufacturerQr":"MFG-E2E-CU-6","active":true}'
  )->>'sku',
  'E2E-CU-6',
  'catalog creates one model and size with manufacturer QR support'
);

select is(
  pg_temp.e2e_error_hint($sql$select public.upsert_warehouse_variant_secure(
    'aa300000-0000-4000-8000-000000000002',
    '{"id":"aa300000-0000-4000-8000-000000000002","itemId":"aa200000-0000-4000-8000-000000000001","sku":"E2E-CU-DUP","model":"R32","size":"9mm","material":"铜","unit":"米","minimumStock":0,"defaultPurchasePrice":110,"manufacturerQr":"MFG-E2E-CU-6","active":true}'
  )$sql$),
  'WAREHOUSE_CATALOG_CONFLICT',
  'duplicate manufacturer QR is rejected without creating another model'
);
reset role;

select set_config('request.jwt.claim.sub', 'aa500000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.list_warehouse_catalog_secure()$$,
  '42501', 'active employee required',
  'inactive warehouse manager is denied despite position grants'
);
reset role;
select set_config('request.jwt.claim.sub', 'aa500000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.list_warehouse_catalog_secure()$$,
  '42501', 'active employee required',
  'first-login employee is denied until the temporary password is changed'
);
reset role;

insert into public.purchase_records(record_key, payload, status) values
  ('PO-E2E-100', '{"purchaseId":"PO-E2E-100","itemName":"空调铜管","quantity":10,"unit":"米","totalCost":1000}', 'active'),
  ('PO-E2E-130', '{"purchaseId":"PO-E2E-130","itemName":"空调铜管","quantity":10,"unit":"米","totalCost":1300}', 'active');
insert into public.projects(record_key, payload, status) values
  ('E2E-PROJECT', '{"projectId":"E2E-PROJECT","projectName":"本地验收正式项目"}', 'active');

select set_config('request.jwt.claim.sub', 'aa500000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table e2e_receipt_100 as
select public.submit_warehouse_receipt_secure(
  'PO-E2E-100',
  '[{"variantId":"aa300000-0000-4000-8000-000000000001","requestedQuantity":10,"warehouseId":null,"locationId":null}]',
  'e2e-submit-receipt-100'
) as payload;
create temporary table e2e_receipt_130 as
select public.submit_warehouse_receipt_secure(
  'PO-E2E-130',
  '[{"variantId":"aa300000-0000-4000-8000-000000000001","requestedQuantity":10,"warehouseId":null,"locationId":null}]',
  'e2e-submit-receipt-130'
) as payload;
select is((select payload->>'status' from e2e_receipt_100), 'pending', 'purchase arrival stays pending before warehouse confirmation');
select is(
  pg_temp.e2e_error_hint(format(
    'select public.confirm_warehouse_receipt_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from e2e_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from e2e_receipt_100),
      'confirmedQuantity', 10,
      'warehouseId', 'aa000000-0000-4000-8000-000000000001',
      'locationId', 'aa100000-0000-4000-8000-000000000002'
    )),
    'e2e-confirm-receipt-cross-warehouse'
  )),
  'WAREHOUSE_LOCATION_MISMATCH',
  'receipt confirmation rejects a shelf from another warehouse'
);
create temporary table e2e_confirmed_100 as
select public.confirm_warehouse_receipt_secure(
  (select (payload->>'id')::uuid from e2e_receipt_100),
  jsonb_build_array(jsonb_build_object(
    'receiptLineId', (select payload#>>'{lines,0,id}' from e2e_receipt_100),
    'confirmedQuantity', 10,
    'warehouseId', 'aa000000-0000-4000-8000-000000000001',
    'locationId', 'aa100000-0000-4000-8000-000000000001'
  )),
  'e2e-confirm-receipt-100'
) as payload;
select pg_sleep(0.01);
create temporary table e2e_confirmed_130 as
select public.confirm_warehouse_receipt_secure(
  (select (payload->>'id')::uuid from e2e_receipt_130),
  jsonb_build_array(jsonb_build_object(
    'receiptLineId', (select payload#>>'{lines,0,id}' from e2e_receipt_130),
    'confirmedQuantity', 10,
    'warehouseId', 'aa000000-0000-4000-8000-000000000001',
    'locationId', 'aa100000-0000-4000-8000-000000000001'
  )),
  'e2e-confirm-receipt-130'
) as payload;
select is((select (payload#>>'{lines,0,unitCost}')::numeric from e2e_confirmed_100), 100.0000::numeric, 'first purchase receipt freezes the old unit price');
select is((select (payload#>>'{lines,0,unitCost}')::numeric from e2e_confirmed_130), 130.0000::numeric, 'second purchase receipt freezes the increased unit price');
select is(
  public.confirm_warehouse_receipt_secure(
    (select (payload->>'id')::uuid from e2e_receipt_100),
    jsonb_build_array(jsonb_build_object(
      'receiptLineId', (select payload#>>'{lines,0,id}' from e2e_receipt_100),
      'confirmedQuantity', 10,
      'warehouseId', 'aa000000-0000-4000-8000-000000000001',
      'locationId', 'aa100000-0000-4000-8000-000000000001'
    )),
    'e2e-confirm-receipt-100'
  ),
  (select payload from e2e_confirmed_100),
  'exact receipt retry returns the same document without double stock'
);
select is((select sum(quantity) from public.warehouse_batch_locations where location_id='aa100000-0000-4000-8000-000000000001'), 20.000::numeric, 'two purchase batches create twenty units of stock');

create temporary table e2e_formal_issue as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"project","projectId":"E2E-PROJECT","minorWorkOrderId":null,"destinationNameSnapshot":"本地验收正式项目","purpose":"空调安装","receiver":"验收负责人","requestDate":"2026-08-09"}',
  '[{"variantId":"aa300000-0000-4000-8000-000000000001","requestedQuantity":12}]',
  'e2e-submit-formal-issue'
) as payload;
create temporary table e2e_confirmed_formal_issue as
select public.confirm_warehouse_stock_out_secure(
  (select (payload->>'id')::uuid from e2e_formal_issue),
  jsonb_build_array(jsonb_build_object(
    'stockOutLineId', (select payload#>>'{lines,0,id}' from e2e_formal_issue),
    'confirmedQuantity', 12,
    'warehouseId', 'aa000000-0000-4000-8000-000000000001',
    'locationId', 'aa100000-0000-4000-8000-000000000001'
  )),
  'e2e-confirm-formal-issue'
) as payload;
select is((select (payload#>>'{lines,0,frozenTotalCost}')::numeric from e2e_confirmed_formal_issue), 1260.0000::numeric, 'formal project issue uses FIFO across old and new price batches');
reset role;
select is(
  (select (payload->>'amount')::numeric from public.project_cost_records where record_key='WAREHOUSE-SO:'||(select payload->>'id' from e2e_confirmed_formal_issue)),
  1260.0000::numeric,
  'formal issue posts the frozen FIFO amount to project cost'
);
set local role authenticated;

create temporary table e2e_return as
select public.submit_warehouse_return_secure(
  (select (payload->>'id')::uuid from e2e_confirmed_formal_issue),
  '{"reason":"项目剩余材料退回","receiver":"仓库负责人","requestDate":"2026-08-09"}',
  jsonb_build_array(jsonb_build_object(
    'originalStockOutLineId', (select payload#>>'{lines,0,id}' from e2e_confirmed_formal_issue),
    'requestedQuantity', 2
  )),
  'e2e-submit-partial-return'
) as payload;
create temporary table e2e_confirmed_return as
select public.confirm_warehouse_return_secure(
  (select (payload->>'id')::uuid from e2e_return),
  jsonb_build_array(jsonb_build_object(
    'returnLineId', (select payload#>>'{lines,0,id}' from e2e_return),
    'confirmedQuantity', 2
  )),
  'e2e-confirm-partial-return'
) as payload;
select is((select (payload#>>'{lines,0,frozenTotalCost}')::numeric from e2e_confirmed_return), 200.0000::numeric, 'partial return preserves the original issued batch cost');
reset role;
select is(
  (select (payload->>'amount')::numeric from public.project_cost_records where record_key='WAREHOUSE-SR:'||(select payload->>'id' from e2e_confirmed_return)),
  -200.0000::numeric,
  'partial return reduces project material cost without repricing history'
);
set local role authenticated;

create temporary table e2e_minor as
select public.create_minor_work_order_secure(
  '{"title":"安装一台空调","customerName":"未来社","workDate":"2026-08-09","locationText":"东京都内","description":"不进入主项目的小工程"}'
) as payload;
create temporary table e2e_minor_issue as
select public.submit_warehouse_stock_out_secure(
  jsonb_build_object(
    'destinationType','minor_work_order','projectId',null,
    'minorWorkOrderId',(select payload->>'id' from e2e_minor),
    'destinationNameSnapshot','未来社・安装一台空调','purpose','零星工程领料',
    'receiver','施工负责人','requestDate','2026-08-09'
  ),
  '[{"variantId":"aa300000-0000-4000-8000-000000000001","requestedQuantity":1}]',
  'e2e-submit-minor-issue'
) as payload;
select public.confirm_warehouse_stock_out_secure(
  (select (payload->>'id')::uuid from e2e_minor_issue),
  jsonb_build_array(jsonb_build_object(
    'stockOutLineId',(select payload#>>'{lines,0,id}' from e2e_minor_issue),
    'confirmedQuantity',1,'warehouseId','aa000000-0000-4000-8000-000000000001',
    'locationId','aa100000-0000-4000-8000-000000000001'
  )),
  'e2e-confirm-minor-issue'
);
select is((select payload->>'status' from e2e_minor), 'open', 'minor work stays separate from the main project while materials can be issued');

create temporary table e2e_internal_issue as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"内部维修","receiver":"总务负责人","requestDate":"2026-08-09"}',
  '[{"variantId":"aa300000-0000-4000-8000-000000000001","requestedQuantity":1}]',
  'e2e-submit-internal-issue'
) as payload;
select public.confirm_warehouse_stock_out_secure(
  (select (payload->>'id')::uuid from e2e_internal_issue),
  jsonb_build_array(jsonb_build_object(
    'stockOutLineId',(select payload#>>'{lines,0,id}' from e2e_internal_issue),
    'confirmedQuantity',1,'warehouseId','aa000000-0000-4000-8000-000000000001',
    'locationId','aa100000-0000-4000-8000-000000000001'
  )),
  'e2e-confirm-internal-issue'
);
reset role;
select is((select count(*) from public.project_cost_records where payload->>'sourceDocumentId'=(select payload->>'id' from e2e_internal_issue)), 0::bigint, 'internal use never creates a fake project cost');
set local role authenticated;

create temporary table e2e_insufficient_issue as
select public.submit_warehouse_stock_out_secure(
  '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"库存不足拦截","receiver":"验收负责人","requestDate":"2026-08-09"}',
  '[{"variantId":"aa300000-0000-4000-8000-000000000001","requestedQuantity":999}]',
  'e2e-submit-insufficient-issue'
) as payload;
select is(
  pg_temp.e2e_error_hint(format(
    'select public.confirm_warehouse_stock_out_secure(%L,%L::jsonb,%L)',
    (select payload->>'id' from e2e_insufficient_issue),
    jsonb_build_array(jsonb_build_object(
      'stockOutLineId',(select payload#>>'{lines,0,id}' from e2e_insufficient_issue),
      'confirmedQuantity',999,'warehouseId','aa000000-0000-4000-8000-000000000001',
      'locationId','aa100000-0000-4000-8000-000000000001'
    )),
    'e2e-confirm-insufficient-issue'
  )),
  'WAREHOUSE_INSUFFICIENT_STOCK',
  'insufficient stock fails atomically and leaves the request pending'
);

create temporary table e2e_transfer as
select public.confirm_warehouse_transfer_secure(
  'aa800000-0000-4000-8000-000000000001',
  'aa300000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000001',
  'aa100000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000002',
  'aa100000-0000-4000-8000-000000000002',
  3,'分仓备货','e2e-confirm-transfer'
) as payload;
select is((select (payload->>'totalCost')::numeric from e2e_transfer), 390.0000::numeric, 'transfer preserves the remaining batch price');
select is((select sum(quantity) from public.warehouse_batch_locations), 8.000::numeric, 'transfer conserves company stock after all three issue types');

create temporary table e2e_stocktake as
select public.confirm_warehouse_stocktake_secure(
  'aa900000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000001',
  '2026-08',
  '[{"stocktakeLineId":"aa910000-0000-4000-8000-000000000001","variantId":"aa300000-0000-4000-8000-000000000001","locationId":"aa100000-0000-4000-8000-000000000001","countedQuantity":4,"differenceType":"loss","reason":"月末实盘少一米","approvedUnitCost":null}]',
  'e2e-confirm-stocktake'
) as payload;
select is((select payload#>>'{lines,0,quantityDelta}' from e2e_stocktake), '-1.000', 'monthly stocktake records the physical loss clearly');
select is((select sum(quantity) from public.warehouse_batch_locations), 7.000::numeric, 'monthly stocktake changes authoritative company stock once');

select is(jsonb_array_length(public.list_warehouse_report_secure('items','{"page":1,"pageSize":100}',false)->'rows'), 1, 'item report contains the detailed variant archive');
select is(jsonb_array_length(public.list_warehouse_report_secure('receipts','{"status":"confirmed","page":1,"pageSize":100}',false)->'rows'), 2, 'receipt report contains both historical purchase prices');
select is(jsonb_array_length(public.list_warehouse_report_secure('issues','{"status":"confirmed","page":1,"pageSize":100}',false)->'rows'), 3, 'issue report separates project, minor-work, and internal-use issues');
select is(jsonb_array_length(public.list_warehouse_report_secure('returns','{"status":"confirmed","page":1,"pageSize":100}',false)->'rows'), 1, 'return report contains the partial project return');
select is(jsonb_array_length(public.list_warehouse_report_secure('transfers','{"status":"confirmed","page":1,"pageSize":100}',false)->'rows'), 1, 'transfer report contains the cross-warehouse movement');
select is(jsonb_array_length(public.list_warehouse_report_secure('stocktakes','{"month":"2026-08","page":1,"pageSize":100}',false)->'rows'), 1, 'stocktake report contains the monthly count');
select is(jsonb_array_length(public.list_warehouse_report_secure('current_stock','{"page":1,"pageSize":100}',false)->'rows'), 2, 'current-stock report shows both warehouse shelves');
select is(jsonb_array_length(public.list_warehouse_report_secure('low_stock','{"page":1,"pageSize":100}',false)->'rows'), 1, 'low-stock report identifies the configured shortage');
select ok(jsonb_array_length(public.list_warehouse_report_secure('movements','{"page":1,"pageSize":100}',false)->'rows') > 0, 'movement ledger contains immutable receipt, issue, return, transfer, and stocktake facts');
select is(public.list_warehouse_report_secure('current_stock','{"page":1,"pageSize":20000}',true)->>'export', 'true', 'authorized warehouse report export reads the same authoritative ledger');

create temporary table e2e_reversal as
select public.reverse_warehouse_operation_secure(
  'warehouse_stocktake','aa900000-0000-4000-8000-000000000001',
  '盘点录入错误，整单冲销','e2e-reverse-stocktake'
) as payload;
select is((select payload->>'status' from e2e_reversal), 'confirmed', 'whole-document reversal confirms without deleting the original');
reset role;
select is((select status from public.warehouse_stocktakes where id='aa900000-0000-4000-8000-000000000001'), 'void', 'reversal marks the original monthly stocktake void');
select is((select sum(quantity) from public.warehouse_batch_locations), 8.000::numeric, 'stocktake reversal restores the exact prior company stock');
set local role authenticated;
select is(
  public.reverse_warehouse_operation_secure(
    'warehouse_stocktake','aa900000-0000-4000-8000-000000000001',
    '盘点录入错误，整单冲销','e2e-reverse-stocktake'
  ),
  (select payload from e2e_reversal),
  'exact reversal retry returns the same result without a second stock change'
);
reset role;

select is((select count(*) from public.warehouse_receipts where purchase_record_key like 'PO-E2E-%'), 2::bigint, 'scenario retains both immutable receipt documents until transaction rollback');
select is((select count(*) from public.warehouse_operation_reversals where source_document_id='aa900000-0000-4000-8000-000000000001'), 1::bigint, 'scenario creates one immutable reversal document');

select * from finish();
rollback;

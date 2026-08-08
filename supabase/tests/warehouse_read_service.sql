begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

select has_function('public', 'list_warehouse_catalog_secure', array[]::text[]);
select has_function('public', 'list_warehouse_locations_secure', array[]::text[]);
select has_function('public', 'list_warehouse_balances_secure', array['jsonb']);
select has_function('public', 'list_warehouse_movements_secure', array['jsonb']);

select is(
  (
    with rpc(signature) as (
      values
        (to_regprocedure('public.list_warehouse_catalog_secure()')),
        (to_regprocedure('public.list_warehouse_locations_secure()')),
        (to_regprocedure('public.list_warehouse_balances_secure(jsonb)')),
        (to_regprocedure('public.list_warehouse_movements_secure(jsonb)'))
    )
    select count(*)::integer
    from rpc
    left join pg_proc procedure on procedure.oid = rpc.signature
    where rpc.signature is null
       or not procedure.prosecdef
       or procedure.provolatile <> 's'
       or procedure.proconfig is null
       or not procedure.proconfig @> array['search_path=pg_catalog, public, private']
       or not has_function_privilege('authenticated', rpc.signature, 'EXECUTE')
       or has_function_privilege('anon', rpc.signature, 'EXECUTE')
       or has_function_privilege('service_role', rpc.signature, 'EXECUTE')
       or exists (
         select 1
         from aclexplode(coalesce(
           procedure.proacl,
           acldefault('f', procedure.proowner)
         )) privilege
         where privilege.privilege_type = 'EXECUTE'
           and (
             privilege.grantee = 0
             or privilege.grantee not in (
               procedure.proowner,
               'authenticated'::regrole::oid
             )
             or (
               privilege.grantee = 'authenticated'::regrole::oid
               and privilege.is_grantable
             )
           )
       )
  ),
  0,
  'read RPCs are stable SECURITY DEFINER functions with fixed search_path and authenticated-only execute'
);

insert into public.warehouse_sites(id, code, name, kind) values
  ('a0000000-0000-4000-8000-000000000002', 'SECOND', '第二仓', 'normal'),
  ('a0000000-0000-4000-8000-000000000001', 'MAIN', '本社仓', 'normal');
insert into public.warehouse_locations(id, warehouse_id, shelf_code, shelf_name) values
  ('a1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000002', 'A-01', '第二仓一号架'),
  ('a1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', 'B-01', 'B区一号架'),
  ('a1000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'A-01', 'A区一号架');
insert into public.warehouse_items(id, name, category, brand) values
  ('a2000000-0000-4000-8000-000000000002', '保温棉', '空调材料', '厂家B'),
  ('a2000000-0000-4000-8000-000000000001', '铜管', '空调材料', '厂家A');
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr
) values
  ('a3000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000002',
   'INS-20MM', 'STANDARD', '20mm', '橡塑', '根', 5, 25.5000,
   'SWERP:VARIANT:INS-20MM'),
  ('a3000000-0000-4000-8000-000000000001', 'a2000000-0000-4000-8000-000000000001',
   'CU-6MM', 'R410A', '6mm', '铜', '米', 20, 118.2500,
   'SWERP:VARIANT:CU-6MM');
insert into public.warehouse_batches(
  id, variant_id, received_at, unit_cost, original_quantity
) values
  ('a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', '2026-08-07T00:00:00Z', 120.0000, 5),
  ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', '2026-08-06T00:00:00Z', 100.0000, 10),
  ('a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002', '2026-08-08T00:00:00Z', 25.5000, 6);
insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
  ('a4000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 5),
  ('a4000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 10),
  ('a4000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000003', 6);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'warehouse-read-no-cost@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'warehouse-read-cost@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'warehouse-read-denied@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a5000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'warehouse-read-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('a6000000-0000-4000-8000-000000000001', 'SW-9701', 'a5000000-0000-4000-8000-000000000001', '无成本读者', '仓库管理部', '部长', '在职', 'active', false),
  ('a6000000-0000-4000-8000-000000000002', 'SW-9702', 'a5000000-0000-4000-8000-000000000002', '成本读者', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('a6000000-0000-4000-8000-000000000003', 'SW-9703', 'a5000000-0000-4000-8000-000000000003', '无权限读者', '工程部', '大工', '在职', 'active', false),
  ('a6000000-0000-4000-8000-000000000004', 'SW-9704', 'a5000000-0000-4000-8000-000000000004', '停用读者', '仓库管理部', '仓库管理员', '在职', 'disabled', false);
insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('department', '仓库管理部', 'module.inventory.view'),
  ('position', '仓库管理员', 'warehouse.cost.view');

insert into public.warehouse_inventory_movements(
  id, movement_type, variant_id, batch_id, warehouse_id, location_id,
  quantity_delta, unit_cost, source_document_type, source_document_id,
  idempotency_key, destination_type, destination_id, destination_name,
  operator_employee_profile_id, occurred_at, metadata
) values
  ('a7000000-0000-4000-8000-000000000001', '采购入库',
   'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001',
   10, 100, 'purchase_receipt', 'RECEIPT-1', 'TASK5-IDEMPOTENCY-1',
   'warehouse', 'MAIN', '本社仓', 'a6000000-0000-4000-8000-000000000002',
   '2026-08-06T00:00:00Z', '{"sequence":1}'::jsonb),
  ('a7000000-0000-4000-8000-000000000002', '项目出库',
   'a3000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002',
   'a0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002',
   -2, 120, 'stock_out', 'OUT-1', 'TASK5-IDEMPOTENCY-2',
   'small_job', 'SMALL-1', '空调小工事', 'a6000000-0000-4000-8000-000000000002',
   '2026-08-07T00:00:00Z', '{"sequence":2}'::jsonb);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.list_warehouse_catalog_secure()$$,
  '42501', 'warehouse permission required',
  'catalog read requires the exact inventory view permission'
);
reset role;

select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000004', true);
set local role authenticated;
select throws_ok(
  $$select public.list_warehouse_locations_secure()$$,
  '42501', 'active employee required',
  'inactive employees fail closed before warehouse reads'
);
reset role;

select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  jsonb_array_length(public.list_warehouse_catalog_secure()->'items'),
  2,
  'catalog returns all items for an authorized reader'
);
select is(
  public.list_warehouse_catalog_secure()->'variants'->0->>'sku',
  'CU-6MM',
  'catalog variants use deterministic SKU ordering'
);
select ok(
  public.list_warehouse_catalog_secure()::text !~ 'defaultPurchasePrice|unitCost|stockValue',
  'catalog does not serialize any cost key without exact cost permission'
);
select is(
  public.list_warehouse_locations_secure()->'sites'->0->>'code',
  'MAIN',
  'warehouse sites use deterministic code ordering'
);
select is(
  public.list_warehouse_locations_secure()->'locations'->0->>'shelfCode',
  'A-01',
  'warehouse locations use deterministic warehouse and shelf ordering'
);
select is(
  jsonb_array_length(public.list_warehouse_balances_secure()),
  3,
  'balance list defaults to a validated first page'
);
select is(
  public.list_warehouse_balances_secure()->0->>'variantId',
  'a3000000-0000-4000-8000-000000000001',
  'balances use deterministic variant, warehouse and location ordering'
);
select ok(
  public.list_warehouse_balances_secure()::text !~ 'unitCost|stockValue',
  'balances do not serialize cost keys without exact cost permission'
);
select is(
  jsonb_array_length(public.list_warehouse_balances_secure(
    jsonb_build_object('warehouseId', 'a0000000-0000-4000-8000-000000000002')
  )),
  1,
  'balance warehouse filter is applied before pagination'
);
select is(
  jsonb_array_length(public.list_warehouse_balances_secure(
    jsonb_build_object('page', 2, 'pageSize', 2)
  )),
  1,
  'balance pagination uses a maximum-bounded deterministic page'
);
select is(
  public.list_warehouse_movements_secure()->0->>'id',
  'a7000000-0000-4000-8000-000000000002',
  'movements use occurred-at descending stable ordering'
);
select ok(
  public.list_warehouse_movements_secure()::text !~ 'unitCost|stockValue',
  'movements do not serialize cost keys without exact cost permission'
);
select is(
  jsonb_array_length(public.list_warehouse_movements_secure(
    jsonb_build_object('movementType', '采购入库')
  )),
  1,
  'movement type filter returns only matching rows'
);
select is(
  jsonb_array_length(public.list_warehouse_movements_secure(
    jsonb_build_object(
      'occurredFrom', '2026-08-06T12:00:00Z',
      'occurredTo', '2026-08-08T00:00:00Z'
    )
  )),
  1,
  'movement timestamp range is validated and applied'
);
reset role;

select set_config('request.jwt.claim.sub', 'a5000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (public.list_warehouse_catalog_secure()->'variants'->0->>'defaultPurchasePrice')::numeric,
  118.2500,
  'catalog purchase price appears only for exact cost permission'
);
select is(
  (public.list_warehouse_balances_secure(
    jsonb_build_object(
      'variantId', 'a3000000-0000-4000-8000-000000000001',
      'locationId', 'a1000000-0000-4000-8000-000000000001'
    )
  )->0->>'unitCost')::numeric,
  100.0000,
  'balance weighted unit cost appears for exact cost permission'
);
select is(
  (public.list_warehouse_balances_secure(
    jsonb_build_object(
      'variantId', 'a3000000-0000-4000-8000-000000000001',
      'locationId', 'a1000000-0000-4000-8000-000000000001'
    )
  )->0->>'stockValue')::numeric,
  1000.0000,
  'balance stock value appears for exact cost permission'
);
select is(
  (public.list_warehouse_movements_secure()->0->>'unitCost')::numeric,
  120.0000,
  'movement historical unit cost appears for exact cost permission'
);

select lives_ok(
  $$select public.list_warehouse_balances_secure('{"pageSize":500}'::jsonb)$$,
  'balance page size 500 is accepted'
);
select lives_ok(
  $$select public.list_warehouse_movements_secure('{"pageSize":500}'::jsonb)$$,
  'movement page size 500 is accepted'
);
select throws_ok(
  $$select public.list_warehouse_balances_secure('{"unknown":true}'::jsonb)$$,
  '22023', 'invalid warehouse balance filters',
  'balance RPC rejects unknown filters server-side'
);
select throws_ok(
  $$select public.list_warehouse_balances_secure('[]'::jsonb)$$,
  '22023', 'invalid warehouse balance filters',
  'balance RPC rejects non-object filters server-side'
);
select throws_ok(
  $$select public.list_warehouse_balances_secure('{"pageSize":501}'::jsonb)$$,
  '22023', 'invalid warehouse balance filters',
  'balance RPC rejects page sizes above 500'
);
select throws_ok(
  $$select public.list_warehouse_balances_secure('{"page":0}'::jsonb)$$,
  '22023', 'invalid warehouse balance filters',
  'balance RPC rejects page zero'
);
select throws_ok(
  $$select public.list_warehouse_balances_secure('{"variantId":"not-a-uuid"}'::jsonb)$$,
  '22023', 'invalid warehouse balance filters',
  'balance RPC validates identifiers before querying'
);
select throws_ok(
  $$select public.list_warehouse_movements_secure('{"unknown":true}'::jsonb)$$,
  '22023', 'invalid warehouse movement filters',
  'movement RPC rejects unknown filters server-side'
);
select throws_ok(
  $$select public.list_warehouse_movements_secure('{"pageSize":501}'::jsonb)$$,
  '22023', 'invalid warehouse movement filters',
  'movement RPC rejects page sizes above 500'
);
select throws_ok(
  $$select public.list_warehouse_movements_secure('{"movementType":"未知"}'::jsonb)$$,
  '22023', 'invalid warehouse movement filters',
  'movement RPC rejects unknown movement types before querying'
);
select throws_ok(
  $$select public.list_warehouse_movements_secure('{"occurredFrom":"not-a-date"}'::jsonb)$$,
  '22023', 'invalid warehouse movement filters',
  'movement RPC rejects malformed timestamps before querying'
);
select throws_ok(
  $$select public.list_warehouse_movements_secure(
    '{"occurredFrom":"2026-09-01T00:00:00Z","occurredTo":"2026-08-01T00:00:00Z"}'::jsonb
  )$$,
  '22023', 'invalid warehouse movement filters',
  'movement RPC rejects reversed timestamp ranges before querying'
);
reset role;

select * from finish();
rollback;

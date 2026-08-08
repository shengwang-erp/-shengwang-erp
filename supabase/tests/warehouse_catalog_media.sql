begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

select has_table('public', 'warehouse_catalog_audit', 'catalog audit table exists');
select has_function('public', 'upsert_warehouse_site_secure', array['uuid', 'jsonb']);
select has_function('public', 'upsert_warehouse_location_secure', array['uuid', 'jsonb']);
select has_function('public', 'upsert_warehouse_item_secure', array['uuid', 'jsonb']);
select has_function('public', 'upsert_warehouse_variant_secure', array['uuid', 'jsonb']);
select has_function('private', 'warehouse_variant_has_pending_documents', array['uuid']);

select is(
  (
    with rpc(signature) as (
      values
        (to_regprocedure('public.upsert_warehouse_site_secure(uuid,jsonb)')),
        (to_regprocedure('public.upsert_warehouse_location_secure(uuid,jsonb)')),
        (to_regprocedure('public.upsert_warehouse_item_secure(uuid,jsonb)')),
        (to_regprocedure('public.upsert_warehouse_variant_secure(uuid,jsonb)'))
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
       or exists (
         select 1
         from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
         where privilege.privilege_type = 'EXECUTE'
           and (
             privilege.grantee = 0
             or privilege.grantee not in (procedure.proowner, 'authenticated'::regrole::oid)
             or (privilege.grantee = 'authenticated'::regrole::oid and privilege.is_grantable)
           )
       )
  ),
  0,
  'catalog mutation RPCs are volatile fixed-path SECURITY DEFINER and authenticated-only'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'warehouse_catalog_audit'
  ),
  array[
    'id', 'entity_type', 'entity_id', 'parent_id', 'action',
    'actor_employee_profile_id', 'before_active', 'after_active', 'created_at'
  ]::text[],
  'catalog audit stores only normalized identifiers, status and server time'
);
select ok(
  not has_table_privilege('authenticated', 'public.warehouse_catalog_audit', 'SELECT')
  and not has_table_privilege('authenticated', 'public.warehouse_catalog_audit', 'INSERT')
  and not has_table_privilege('anon', 'public.warehouse_catalog_audit', 'SELECT'),
  'browser roles cannot read or write catalog audit rows'
);

create or replace function pg_temp.task2_error_hint(p_statement text)
returns text
language plpgsql
as $$
declare
  captured_hint text;
begin
  execute p_statement;
  return null;
exception when others then
  get stacked diagnostics captured_hint = PG_EXCEPTION_HINT;
  return captured_hint;
end;
$$;

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'catalog-manager@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'catalog-denied@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b5000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'catalog-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('b6000000-0000-4000-8000-000000000001', 'SW-9801', 'b5000000-0000-4000-8000-000000000001', '仓库资料管理员', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('b6000000-0000-4000-8000-000000000002', 'SW-9802', 'b5000000-0000-4000-8000-000000000002', '仓库无权员工', '工程部', '大工', '在职', 'active', false),
  ('b6000000-0000-4000-8000-000000000003', 'SW-9803', 'b5000000-0000-4000-8000-000000000003', '仓库停用员工', '仓库管理部', '仓库管理员', '在职', 'disabled', false);
insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('position', '仓库管理员', 'warehouse.catalog.manage'),
  ('position', '仓库管理员', 'warehouse.cost.view');

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000001',
    '{"id":"b0000000-0000-4000-8000-000000000001","code":"DENIED","name":"无权限仓","kind":"normal","active":true}'
  )$$,
  '42501', 'warehouse permission required',
  'requester without catalog permission cannot mutate catalog'
);
reset role;

select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000001',
    '{"id":"b0000000-0000-4000-8000-000000000001","code":"INACTIVE","name":"停用员工仓","kind":"normal","active":true}'
  )$$,
  '42501', 'active employee required',
  'inactive employee cannot mutate catalog'
);
reset role;

select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000010',
    '{"id":"b0000000-0000-4000-8000-000000000010","code":"SECOND","name":"第二仓","kind":"normal","active":true}'
  )->>'id',
  'b0000000-0000-4000-8000-000000000010',
  'a second site is created for successful update and deactivation paths'
);
select is(
  public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000010',
    '{"id":"b0000000-0000-4000-8000-000000000010","code":"SECOND","name":"第二仓更新","kind":"normal","active":true}'
  )->>'name',
  '第二仓更新',
  'site update persists canonical fields'
);
select is(
  public.upsert_warehouse_location_secure(
    'b1000000-0000-4000-8000-000000000010',
    '{"id":"b1000000-0000-4000-8000-000000000010","warehouseId":"b0000000-0000-4000-8000-000000000010","shelfCode":"B-01","shelfName":"B区一号架","active":true}'
  )->>'shelfName',
  'B区一号架',
  'a second location is created'
);
select is(
  public.upsert_warehouse_location_secure(
    'b1000000-0000-4000-8000-000000000010',
    '{"id":"b1000000-0000-4000-8000-000000000010","warehouseId":"b0000000-0000-4000-8000-000000000010","shelfCode":"B-01","shelfName":"B区主货架","active":true}'
  )->>'shelfName',
  'B区主货架',
  'location update persists canonical fields'
);
select is(
  (public.upsert_warehouse_location_secure(
    'b1000000-0000-4000-8000-000000000010',
    '{"id":"b1000000-0000-4000-8000-000000000010","warehouseId":"b0000000-0000-4000-8000-000000000010","shelfCode":"B-01","shelfName":"B区主货架","active":false}'
  )->>'active')::boolean,
  false,
  'empty location can be deactivated'
);
select is(
  (public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000010',
    '{"id":"b0000000-0000-4000-8000-000000000010","code":"SECOND","name":"第二仓更新","kind":"normal","active":false}'
  )->>'active')::boolean,
  false,
  'site can be deactivated after every child location is inactive and empty'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_location_secure(
      'b1000000-0000-4000-8000-000000000011',
      '{"id":"b1000000-0000-4000-8000-000000000011","warehouseId":"b0000000-0000-4000-8000-000000000010","shelfCode":"B-02","shelfName":"停用仓货架","active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_RELATION_INVALID',
  'active locations cannot be created under an inactive site'
);

select is(
  public.upsert_warehouse_item_secure(
    'b2000000-0000-4000-8000-000000000010',
    '{"id":"b2000000-0000-4000-8000-000000000010","name":"保温棉","category":"空调材料","brand":"厂家B","description":"","active":true}'
  )->>'name',
  '保温棉',
  'a second item is created'
);
select is(
  public.upsert_warehouse_item_secure(
    'b2000000-0000-4000-8000-000000000010',
    '{"id":"b2000000-0000-4000-8000-000000000010","name":"保温棉","category":"空调材料","brand":"厂家B","description":"20mm橡塑","active":true}'
  )->>'description',
  '20mm橡塑',
  'item update persists canonical fields'
);
select is(
  public.upsert_warehouse_variant_secure(
    'b3000000-0000-4000-8000-000000000010',
    '{"id":"b3000000-0000-4000-8000-000000000010","itemId":"b2000000-0000-4000-8000-000000000010","sku":"INS-20MM","model":"STANDARD","size":"20mm","material":"橡塑","unit":"根","minimumStock":5,"defaultPurchasePrice":25.5,"manufacturerQr":null,"active":true}'
  )->>'sku',
  'INS-20MM',
  'a second variant is created'
);
select is(
  (public.upsert_warehouse_variant_secure(
    'b3000000-0000-4000-8000-000000000010',
    '{"id":"b3000000-0000-4000-8000-000000000010","itemId":"b2000000-0000-4000-8000-000000000010","sku":"INS-20MM","model":"STANDARD","size":"20mm","material":"橡塑","unit":"根","minimumStock":6,"defaultPurchasePrice":26.75,"manufacturerQr":null,"active":true}'
  )->>'defaultPurchasePrice')::numeric,
  26.75,
  'variant update persists exact price without changing historical batches'
);
select is(
  (public.upsert_warehouse_variant_secure(
    'b3000000-0000-4000-8000-000000000010',
    '{"id":"b3000000-0000-4000-8000-000000000010","itemId":"b2000000-0000-4000-8000-000000000010","sku":"INS-20MM","model":"STANDARD","size":"20mm","material":"橡塑","unit":"根","minimumStock":6,"defaultPurchasePrice":26.75,"manufacturerQr":null,"active":false}'
  )->>'active')::boolean,
  false,
  'stock-free variant with no pending documents can be deactivated'
);
select is(
  (public.upsert_warehouse_item_secure(
    'b2000000-0000-4000-8000-000000000010',
    '{"id":"b2000000-0000-4000-8000-000000000010","name":"保温棉","category":"空调材料","brand":"厂家B","description":"20mm橡塑","active":false}'
  )->>'active')::boolean,
  false,
  'item can be deactivated after every child variant is inactive and stock-free'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000011',
      '{"id":"b3000000-0000-4000-8000-000000000011","itemId":"b2000000-0000-4000-8000-000000000010","sku":"INS-25MM","model":"","size":"25mm","material":"橡塑","unit":"根","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":null,"active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_RELATION_INVALID',
  'active variants cannot be created under an inactive item'
);

select is(
  public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', 'b0000000-0000-4000-8000-000000000001',
      'code', E'\u2003MAIN\u00a0',
      'name', E'\u3000本社倉\u2009',
      'kind', 'normal',
      'active', true
    )
  )->>'code',
  'MAIN',
  'site mutation Unicode-trims canonical input in Postgres'
);
select is(
  public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000001',
    '{"id":"b0000000-0000-4000-8000-000000000001","code":"MAIN","name":"本社倉","kind":"normal","active":true}'
  )->>'id',
  'b0000000-0000-4000-8000-000000000001',
  'exact retry returns the same site identity'
);
reset role;
select is(
  (select count(*) from public.warehouse_catalog_audit
   where entity_type = 'site' and entity_id = 'b0000000-0000-4000-8000-000000000001'),
  1::bigint,
  'exact site retry is idempotent and does not duplicate audit'
);
set local role authenticated;
select is(
  public.upsert_warehouse_site_secure(
    'b0000000-0000-4000-8000-000000000001',
    '{"id":"b0000000-0000-4000-8000-000000000001","code":"MAIN","name":"本社仓","kind":"normal","active":true}'
  )->>'name',
  '本社仓',
  'site update returns the authoritative updated row'
);

select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_site_secure(
      'b0000000-0000-4000-8000-000000000001',
      '{"id":"b0000000-0000-4000-8000-000000000099","code":"MISMATCH","name":"错号仓","kind":"normal","active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_ID_MISMATCH',
  'site path rejects RPC/payload id mismatch with a stable code'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_site_secure(
      'b0000000-0000-4000-8000-000000000002',
      '{"id":"b0000000-0000-4000-8000-000000000002","code":"EXTRA","name":"多字段仓","kind":"normal","active":true,"description":"forbidden"}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'site payload rejects every extra JSON field'
);

select is(
  public.upsert_warehouse_location_secure(
    'b1000000-0000-4000-8000-000000000001',
    '{"id":"b1000000-0000-4000-8000-000000000001","warehouseId":"b0000000-0000-4000-8000-000000000001","shelfCode":" A-01 ","shelfName":" A区一号架 ","active":true}'
  )->>'shelfCode',
  'A-01',
  'location create returns canonical shelf data'
);
select is(
  public.upsert_warehouse_item_secure(
    'b2000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', 'b2000000-0000-4000-8000-000000000001',
      'name', E' Cafe\u0301铜管 ',
      'category', ' 空调材料 ',
      'brand', ' 厂家A ',
      'description', ' 冷媒铜管 ',
      'active', true
    )
  )->>'name',
  'Café铜管',
  'item create NFC-normalizes and trims text'
);
select is(
  public.upsert_warehouse_variant_secure(
    'b3000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'id', 'b3000000-0000-4000-8000-000000000001',
      'itemId', 'b2000000-0000-4000-8000-000000000001',
      'sku', ' CU-6MM ',
      'model', ' R410A ',
      'size', ' 6mm ',
      'material', ' 铜 ',
      'unit', ' 米 ',
      'minimumStock', 20.125,
      'defaultPurchasePrice', 118.2501,
      'manufacturerQr', E'\u2002Maker-Cafe\u0301-01\u00a0',
      'active', true
    )
  )->>'systemQr',
  'SWERP:VARIANT:b3000000-0000-4000-8000-000000000001',
  'variant system QR is generated only from its database-bound UUID'
);
select is(
  public.upsert_warehouse_variant_secure(
    'b3000000-0000-4000-8000-000000000001',
    '{"id":"b3000000-0000-4000-8000-000000000001","itemId":"b2000000-0000-4000-8000-000000000001","sku":"CU-6MM","model":"R410A","size":"6mm","material":"铜","unit":"米","minimumStock":20.125,"defaultPurchasePrice":118.2501,"manufacturerQr":"Maker-Café-01","active":true}'
  )->>'manufacturerQr',
  'Maker-Café-01',
  'variant exact canonical retry preserves manufacturer QR'
);
reset role;
select is(
  (select count(*) from public.warehouse_catalog_audit
   where entity_type = 'variant' and entity_id = 'b3000000-0000-4000-8000-000000000001'),
  1::bigint,
  'exact variant retry does not duplicate audit'
);
set local role authenticated;

select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000002',
      '{"id":"b3000000-0000-4000-8000-000000000002","itemId":"b2000000-0000-4000-8000-000000000001","sku":"CU-6MM","model":"","size":"","material":"","unit":"米","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":null,"active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_CONFLICT',
  'duplicate SKU returns a stable catalog conflict'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000003',
      '{"id":"b3000000-0000-4000-8000-000000000003","itemId":"b2000000-0000-4000-8000-000000000001","sku":"CU-8MM","model":"","size":"","material":"","unit":"米","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":" maker-café-01 ","active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_CONFLICT',
  'manufacturer QR is Unicode-edge-trimmed and case-insensitively unique'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000004',
      '{"id":"b3000000-0000-4000-8000-000000000004","itemId":"b2000000-0000-4000-8000-000000000001","sku":"CU-10MM","model":"","size":"","material":"","unit":"米","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":"　sWeRp:VaRiAnT:factory　","active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'manufacturer QR cannot use the reserved system prefix after canonicalization'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000005',
      '{"id":"b3000000-0000-4000-8000-000000000005","itemId":"b2000000-0000-4000-8000-000000000001","sku":"CU-12MM","model":"","size":"","material":"","unit":"米","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":null,"systemQr":"browser-forbidden","active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'browser-supplied system QR is rejected as an extra field'
);

select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000006',
      '{"id":"b3000000-0000-4000-8000-000000000006","itemId":"b2000000-0000-4000-8000-000000000001","sku":"BAD-QTY","model":"","size":"","material":"","unit":"米","minimumStock":1.0001,"defaultPurchasePrice":0,"manufacturerQr":null,"active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'quantity precision beyond three decimals is rejected'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000007',
      '{"id":"b3000000-0000-4000-8000-000000000007","itemId":"b2000000-0000-4000-8000-000000000001","sku":"BAD-PRICE","model":"","size":"","material":"","unit":"米","minimumStock":0,"defaultPurchasePrice":1.00001,"manufacturerQr":null,"active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'price precision beyond four decimals is rejected'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000008',
      '{"id":"b3000000-0000-4000-8000-000000000008","itemId":"b2000000-0000-4000-8000-000000000001","sku":"BAD-NEGATIVE","model":"","size":"","material":"","unit":"米","minimumStock":-1,"defaultPurchasePrice":-1,"manufacturerQr":null,"active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'negative quantity and price are rejected'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000009',
      '{"id":"b3000000-0000-4000-8000-000000000009","itemId":"b2000000-0000-4000-8000-000000000001","sku":"BAD-UNSAFE","model":"","size":"","material":"","unit":"米","minimumStock":9007199254740.992,"defaultPurchasePrice":0,"manufacturerQr":null,"active":true}'
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'database quantity maximum matches the browser safe-unit boundary'
);

reset role;
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  false,
  'pending-document guard safely passes before Phase 3 tables exist'
);
set local role authenticated;

select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_site_secure(
      'b0000000-0000-4000-8000-000000000001',
      '{"id":"b0000000-0000-4000-8000-000000000001","code":"MAIN","name":"本社仓","kind":"normal","active":false}'
    )
  $statement$),
  'WAREHOUSE_SITE_IN_USE',
  'site deactivation cannot orphan an active child location'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_item_secure(
      'b2000000-0000-4000-8000-000000000001',
      '{"id":"b2000000-0000-4000-8000-000000000001","name":"Café铜管","category":"空调材料","brand":"厂家A","description":"冷媒铜管","active":false}'
    )
  $statement$),
  'WAREHOUSE_ITEM_IN_USE',
  'item deactivation cannot orphan an active child variant'
);

reset role;

insert into public.warehouse_batches(
  id, variant_id, received_at, unit_cost, original_quantity
) values (
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001', now(), 118.2501, 1
);
insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
  ('b4000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 1);

set local role authenticated;
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_location_secure(
      'b1000000-0000-4000-8000-000000000001',
      '{"id":"b1000000-0000-4000-8000-000000000001","warehouseId":"b0000000-0000-4000-8000-000000000001","shelfCode":"A-01","shelfName":"A区一号架","active":false}'
    )
  $statement$),
  'WAREHOUSE_LOCATION_HAS_STOCK',
  'location deactivation cannot hide positive stock'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_variant_secure(
      'b3000000-0000-4000-8000-000000000001',
      '{"id":"b3000000-0000-4000-8000-000000000001","itemId":"b2000000-0000-4000-8000-000000000001","sku":"CU-6MM","model":"R410A","size":"6mm","material":"铜","unit":"米","minimumStock":20.125,"defaultPurchasePrice":118.2501,"manufacturerQr":"Maker-Café-01","active":false}'
    )
  $statement$),
  'WAREHOUSE_VARIANT_HAS_STOCK',
  'variant deactivation cannot hide positive stock'
);
reset role;

select is(
  (select count(*) from public.warehouse_catalog_audit
   where actor_employee_profile_id <> 'b6000000-0000-4000-8000-000000000001'),
  0::bigint,
  'every catalog audit identity is resolved from the server actor'
);
select ok(
  not exists (
    select 1
    from public.warehouse_catalog_audit
    where entity_type not in ('site', 'location', 'item', 'variant')
       or action not in ('created', 'updated', 'deactivated', 'reactivated')
  ),
  'audit rows contain only fixed entity and action identifiers'
);

select * from finish();
rollback;

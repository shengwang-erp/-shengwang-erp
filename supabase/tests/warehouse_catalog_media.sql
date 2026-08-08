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
select is(
  (
    select count(*)
    from pg_class object
    cross join lateral aclexplode(
      coalesce(object.relacl, acldefault(
        case when object.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
        object.relowner
      ))
    ) privilege
    where object.oid in (
      'public.warehouse_catalog_audit'::regclass,
      'public.warehouse_catalog_audit_id_seq'::regclass
    )
      and privilege.grantee in (
        0,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid,
        'service_role'::regrole::oid
      )
  ),
  0::bigint,
  'catalog audit table and sequence have no browser, public, or service-role ACL entries'
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

create or replace function pg_temp.task2_catalog_text_error_hint(p_value text)
returns text
language plpgsql
as $$
declare
  captured_hint text;
begin
  perform private.warehouse_catalog_text(
    jsonb_build_object('value', p_value), 'value', 100, true
  );
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
    'b0000000-0000-4000-8000-000000000020',
    jsonb_build_object(
      'id', 'b0000000-0000-4000-8000-000000000020',
      'code', E'\t\n\ufeff\u200b\u200c\u200d\u2060EDGE\t\n\ufeff\u200b\u200c\u200d\u2060',
      'name', E'\u2060边界仓\u200b',
      'kind', 'normal',
      'active', true
    )
  )->>'code',
  'EDGE',
  'site mutation strips the complete agreed invisible set only at text edges'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.upsert_warehouse_site_secure(
      'b0000000-0000-4000-8000-000000000021',
      jsonb_build_object(
        'id', 'b0000000-0000-4000-8000-000000000021',
        'code', E'\t\n\ufeff\u200b\u200c\u200d\u2060',
        'name', '不可创建', 'kind', 'normal', 'active', true
      )
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'an invisible-only required catalog value is rejected after canonicalization'
);
reset role;
select is(
  (
    select array_agg(
      pg_temp.task2_catalog_text_error_hint(value) order by ordinal
    )
    from unnest(array[
      E'Maker\ufeff-QR', E'Maker\u200b-QR', E'Maker\u200c-QR',
      E'Maker\u200d-QR', E'Maker\u2060-QR'
    ]) with ordinality candidate(value, ordinal)
  ),
  array_fill('WAREHOUSE_CATALOG_INPUT_INVALID'::text, array[5]),
  'FEFF, U+200B, U+200C, U+200D and U+2060 are rejected inside catalog text'
);
set local role authenticated;
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
      'b3000000-0000-4000-8000-000000000014',
      jsonb_build_object(
        'id', 'b3000000-0000-4000-8000-000000000014',
        'itemId', 'b2000000-0000-4000-8000-000000000001',
        'sku', 'CU-14MM', 'model', '', 'size', '', 'material', '', 'unit', '米',
        'minimumStock', 0, 'defaultPurchasePrice', 0,
        'manufacturerQr', E'\u200bSWERP:VARIANT:forged\u2060', 'active', true
      )
    )
  $statement$),
  'WAREHOUSE_CATALOG_INPUT_INVALID',
  'invisible edge characters cannot bypass the reserved manufacturer QR prefix'
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

create table public.warehouse_receipts(id uuid primary key, status text not null);
select is(
  pg_temp.task2_error_hint($statement$
    select private.warehouse_variant_has_pending_documents(
      'b3000000-0000-4000-8000-000000000001'
    )
  $statement$),
  'WAREHOUSE_PENDING_SCHEMA_INCOMPLETE',
  'a receipt document table without its line table fails closed'
);
drop table public.warehouse_receipts;

create table public.warehouse_stock_out_requests(id uuid primary key, status text not null);
select is(
  pg_temp.task2_error_hint($statement$
    select private.warehouse_variant_has_pending_documents(
      'b3000000-0000-4000-8000-000000000001'
    )
  $statement$),
  'WAREHOUSE_PENDING_SCHEMA_INCOMPLETE',
  'a stock-out document table without its line table fails closed'
);
drop table public.warehouse_stock_out_requests;

create table public.warehouse_return_requests(id uuid primary key, status text not null);
select is(
  pg_temp.task2_error_hint($statement$
    select private.warehouse_variant_has_pending_documents(
      'b3000000-0000-4000-8000-000000000001'
    )
  $statement$),
  'WAREHOUSE_PENDING_SCHEMA_INCOMPLETE',
  'a return document table without its dependent line tables fails closed'
);
drop table public.warehouse_return_requests;

create table public.warehouse_receipts(id uuid primary key, status text not null);
create table public.warehouse_receipt_lines(
  id uuid primary key, receipt_id uuid not null, variant_id uuid not null
);
create table public.warehouse_stock_out_requests(id uuid primary key, status text not null);
create table public.warehouse_stock_out_lines(
  id uuid primary key, request_id uuid not null, variant_id uuid not null
);
create table public.warehouse_return_requests(id uuid primary key, status text not null);
create table public.warehouse_return_lines(
  id uuid primary key, return_id uuid not null, original_stock_out_line_id uuid not null
);

insert into public.warehouse_receipts(id, status)
values ('ba000000-0000-4000-8000-000000000001', 'pending');
insert into public.warehouse_receipt_lines(id, receipt_id, variant_id)
values (
  'ba100000-0000-4000-8000-000000000001',
  'ba000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001'
);
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  true,
  'a pending receipt blocks variant deactivation when all six tables exist'
);
update public.warehouse_receipts set status = 'confirmed';
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  false,
  'a confirmed receipt no longer blocks variant deactivation'
);

insert into public.warehouse_stock_out_requests(id, status)
values ('ba200000-0000-4000-8000-000000000001', 'pending');
insert into public.warehouse_stock_out_lines(id, request_id, variant_id)
values (
  'ba300000-0000-4000-8000-000000000001',
  'ba200000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001'
);
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  true,
  'a pending stock-out request blocks variant deactivation'
);
update public.warehouse_stock_out_requests set status = 'rejected';
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  false,
  'a rejected stock-out request no longer blocks variant deactivation'
);

insert into public.warehouse_return_requests(id, status)
values ('ba400000-0000-4000-8000-000000000001', 'pending');
insert into public.warehouse_return_lines(id, return_id, original_stock_out_line_id)
values (
  'ba500000-0000-4000-8000-000000000001',
  'ba400000-0000-4000-8000-000000000001',
  'ba300000-0000-4000-8000-000000000001'
);
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  true,
  'a pending return blocks the original stock-out variant deactivation'
);
update public.warehouse_return_requests set status = 'void';
select is(
  private.warehouse_variant_has_pending_documents('b3000000-0000-4000-8000-000000000001'),
  false,
  'a void return no longer blocks variant deactivation'
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

select throws_ok(
  $$update public.warehouse_catalog_audit set after_active = not after_active$$,
  '42501', 'warehouse catalog audit is immutable',
  'even the table owner cannot update catalog audit rows through DML'
);
select throws_ok(
  $$delete from public.warehouse_catalog_audit$$,
  '42501', 'warehouse catalog audit is immutable',
  'even the table owner cannot delete catalog audit rows through DML'
);

grant select, update, delete on public.warehouse_catalog_audit to service_role;
set local role service_role;
select throws_ok(
  $$update public.warehouse_catalog_audit set after_active = not after_active$$,
  '42501', 'warehouse catalog audit is immutable',
  'service role cannot update catalog audit rows even with temporary table privileges'
);
select throws_ok(
  $$delete from public.warehouse_catalog_audit$$,
  '42501', 'warehouse catalog audit is immutable',
  'service role cannot delete catalog audit rows even with temporary table privileges'
);
reset role;
revoke select, update, delete on public.warehouse_catalog_audit from service_role;

select is(
  (
    select count(*)
    from pg_class object
    cross join lateral aclexplode(
      coalesce(object.relacl, acldefault(
        case when object.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
        object.relowner
      ))
    ) privilege
    where object.oid in (
      'public.warehouse_catalog_audit'::regclass,
      'public.warehouse_catalog_audit_id_seq'::regclass
    )
      and privilege.grantee in (
        0,
        'anon'::regrole::oid,
        'authenticated'::regrole::oid,
        'service_role'::regrole::oid
      )
  ),
  0::bigint,
  'catalog audit ACL remains exactly closed after service-role trigger proofs'
);

-- Phase 2 Task 3: private, ordered warehouse variant photos.
select has_table('public', 'warehouse_variant_photos', 'variant photo metadata table exists');
select has_table('public', 'warehouse_photo_audit', 'identifier-only photo audit table exists');
select has_function('public', 'register_warehouse_variant_photo_secure', array['uuid', 'text', 'text', 'bigint']);
select has_function('public', 'list_warehouse_variant_photos_secure', array['uuid']);
select has_function('public', 'reorder_warehouse_variant_photos_secure', array['uuid', 'uuid[]']);
select has_function('public', 'delete_warehouse_variant_photo_secure', array['uuid', 'uuid', 'text']);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'warehouse_variant_photos'
  ),
  array[
    'id', 'variant_id', 'object_path', 'sort_order', 'mime_type', 'byte_size',
    'created_by_employee_profile_id', 'created_at'
  ]::text[],
  'photo metadata has only the required normalized fields'
);
select is(
  (
    select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'warehouse_photo_audit'
  ),
  array[
    'id', 'action', 'photo_id', 'variant_id',
    'actor_employee_profile_id', 'created_at'
  ]::text[],
  'photo audit excludes paths, URLs, MIME metadata, bytes and image payloads'
);
select is(
  (select public from storage.buckets where id = 'warehouse-item-photos'),
  false,
  'warehouse item photo bucket is private'
);
select is(
  (select file_size_limit from storage.buckets where id = 'warehouse-item-photos'),
  2097151::bigint,
  'Storage rejects files that are not strictly below 2 MiB'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'warehouse-item-photos'),
  array['image/jpeg', 'image/png', 'image/webp']::text[],
  'Storage accepts only the three warehouse photo MIME types'
);

select is(
  (
    with expected(signature, volatility) as (
      values
        (to_regprocedure('public.register_warehouse_variant_photo_secure(uuid,text,text,bigint)'), 'v'::"char"),
        (to_regprocedure('public.list_warehouse_variant_photos_secure(uuid)'), 's'::"char"),
        (to_regprocedure('public.reorder_warehouse_variant_photos_secure(uuid,uuid[])'), 'v'::"char"),
        (to_regprocedure('public.delete_warehouse_variant_photo_secure(uuid,uuid,text)'), 'v'::"char")
    )
    select count(*)::integer
    from expected
    left join pg_proc procedure on procedure.oid = expected.signature
    where expected.signature is null
       or not procedure.prosecdef
       or procedure.provolatile <> expected.volatility
       or procedure.proconfig is null
       or not procedure.proconfig @> array['search_path=pg_catalog, public, private, storage']
       or not has_function_privilege('authenticated', expected.signature, 'EXECUTE')
       or has_function_privilege('anon', expected.signature, 'EXECUTE')
       or has_function_privilege('service_role', expected.signature, 'EXECUTE')
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
  'photo RPCs are exact-path SECURITY DEFINER and authenticated-only'
);

select is(
  (
    select count(*)::integer
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname in (
        'warehouse_item_photos_insert',
        'warehouse_item_photos_select',
        'warehouse_item_photos_orphan_cleanup_select',
        'warehouse_item_photos_delete',
        'warehouse_item_photos_update_deny'
      )
  ),
  5,
  'Storage has explicit insert, read, method-scoped cleanup, delete and update-deny policies'
);
select is(
  (
    select count(*)::integer
    from pg_policies policy
    where policy.schemaname = 'storage'
      and policy.tablename = 'objects'
      and policy.policyname like 'warehouse_item_photos_%'
      and policy.roles <> array['authenticated']::name[]
  ),
  0,
  'every warehouse photo Storage policy targets authenticated only'
);
select ok(
  (
    select
      position('owner_id' in expression) > 0
      and position('uid()' in expression) > 0
      and position('NOT (EXISTS' in expression) > 0
      and regexp_count(expression, 'EXISTS') = 2
    from (
      select pg_get_expr(policy.polqual, policy.polrelid) as expression
      from pg_policy policy
      where policy.polname = 'warehouse_item_photos_delete'
        and policy.polrelid = 'storage.objects'::regclass
    ) delete_policy
  ),
  'delete policy separates registered catalog deletion from owner-only unregistered compensation'
);
select ok(
  (
    select
      position('request.method' in expression) > 0
      and position('DELETE' in expression) > 0
      and position('owner_id' in expression) > 0
      and position('uid()' in expression) > 0
      and position('NOT (EXISTS' in expression) > 0
    from (
      select pg_get_expr(policy.polqual, policy.polrelid) as expression
      from pg_policy policy
      where policy.polname = 'warehouse_item_photos_orphan_cleanup_select'
        and policy.polrelid = 'storage.objects'::regclass
    ) cleanup_policy
  ),
  'orphan cleanup SELECT visibility is owner-only, unregistered, and DELETE-method scoped'
);

insert into public.permission_grants(subject_type, subject_code, permission_key)
values
  ('position', '仓库管理员', 'module.inventory.view'),
  ('position', '大工', 'module.inventory.view');

insert into storage.objects(id, bucket_id, name, owner_id, metadata)
values
  (
    'b7000000-0000-4000-8000-000000000001', 'warehouse-item-photos',
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000001.jpg',
    'b5000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":100}'::jsonb
  ),
  (
    'b7000000-0000-4000-8000-000000000002', 'warehouse-item-photos',
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000002.png',
    'b5000000-0000-4000-8000-000000000002',
    '{"mimetype":"image/png","size":101}'::jsonb
  );

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.register_warehouse_variant_photo_secure(
    'b3000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000002.png',
    'image/png', 101
  )$$,
  '42501', 'warehouse permission required',
  'inventory viewer without catalog permission cannot register photo metadata'
);
reset role;

select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.list_warehouse_variant_photos_secure(
    'b3000000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'active employee required',
  'inactive employee cannot list or sign warehouse photos'
);
reset role;

select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.register_warehouse_variant_photo_secure(
    'b3000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000001.jpg',
    'image/jpeg', 100
  )->>'objectPath',
  'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000001.jpg',
  'catalog manager registers one owned object under the exact variant prefix'
);
select is(
  (
    select jsonb_array_length(
      public.list_warehouse_variant_photos_secure(
        'b3000000-0000-4000-8000-000000000001'
      )
    )
  ),
  1,
  'an inventory viewer RPC lists registered metadata in order'
);

select is(
  pg_temp.task2_error_hint($statement$
    select public.register_warehouse_variant_photo_secure(
      'b3000000-0000-4000-8000-000000000010',
      'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000002.png',
      'image/png', 101
    )
  $statement$),
  'WAREHOUSE_PHOTO_PATH_INVALID',
  'metadata registration rejects a cross-variant object path'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.register_warehouse_variant_photo_secure(
      'b3000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000002.png',
      'image/jpeg', 101
    )
  $statement$),
  'WAREHOUSE_PHOTO_OBJECT_INVALID',
  'metadata registration rejects a MIME or extension mismatch'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.register_warehouse_variant_photo_secure(
      'b3000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000002.png',
      'image/png', 101
    )
  $statement$),
  'WAREHOUSE_PHOTO_OBJECT_NOT_OWNED',
  'a manager cannot register an object owned by another authenticated user'
);

reset role;
update storage.objects
set owner_id = 'b5000000-0000-4000-8000-000000000001'
where id = 'b7000000-0000-4000-8000-000000000002';
set local role authenticated;
select is(
  public.register_warehouse_variant_photo_secure(
    'b3000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000002.png',
    'image/png', 101
  )->>'sortOrder',
  '1',
  'a second photo receives the next stable order'
);
select is(
  (
    select jsonb_agg(entry->>'id' order by (entry->>'sortOrder')::integer)
    from jsonb_array_elements(public.reorder_warehouse_variant_photos_secure(
      'b3000000-0000-4000-8000-000000000001',
      array[
        (select id from public.warehouse_variant_photos where object_path like '%.png'),
        (select id from public.warehouse_variant_photos where object_path like '%.jpg')
      ]
    )) entry
  ),
  (
    select jsonb_agg(id::text order by object_path desc)
    from public.warehouse_variant_photos
    where variant_id = 'b3000000-0000-4000-8000-000000000001'
  ),
  'reorder atomically accepts the complete exact variant-owned permutation'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.reorder_warehouse_variant_photos_secure(
      'b3000000-0000-4000-8000-000000000001',
      array[(select id from public.warehouse_variant_photos limit 1)]
    )
  $statement$),
  'WAREHOUSE_PHOTO_ORDER_INVALID',
  'reorder rejects an incomplete photo-id list'
);
reset role;

insert into storage.objects(id, bucket_id, name, owner_id, metadata)
select
  gen_random_uuid(),
  'warehouse-item-photos',
  format(
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-%s.webp',
    lpad(sequence::text, 12, '0')
  ),
  'b5000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/webp","size":102}'::jsonb
from generate_series(3, 9) sequence;

set local role authenticated;
select lives_ok(
  $$select public.register_warehouse_variant_photo_secure(
    'b3000000-0000-4000-8000-000000000001',
    format(
      'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-%s.webp',
      lpad(sequence::text, 12, '0')
    ),
    'image/webp', 102
  ) from generate_series(3, 8) sequence$$,
  'up to eight photos can be registered for one variant'
);
select is(
  pg_temp.task2_error_hint($statement$
    select public.register_warehouse_variant_photo_secure(
      'b3000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000009.webp',
      'image/webp', 102
    )
  $statement$),
  'WAREHOUSE_PHOTO_LIMIT_REACHED',
  'the trusted database rejects a ninth photo'
);
reset role;

select is(
  (select count(*) from public.warehouse_variant_photos
   where variant_id = 'b3000000-0000-4000-8000-000000000001'),
  8::bigint,
  'failed ninth registration leaves exactly eight metadata rows'
);
select is(
  (select count(*) from public.warehouse_variant_photos
   where created_by_employee_profile_id <> 'b6000000-0000-4000-8000-000000000001'),
  0::bigint,
  'photo creator identity is always resolved from the server actor'
);
select is(
  (select count(*) from public.warehouse_photo_audit
   where actor_employee_profile_id <> 'b6000000-0000-4000-8000-000000000001'),
  0::bigint,
  'photo audit actor identity is always server-resolved'
);

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
select is(
  (select count(*) from storage.objects where bucket_id = 'warehouse-item-photos'),
  0::bigint,
  'anonymous users cannot read photo objects or obtain signed access'
);
reset role;

select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is(
  (select count(*) from storage.objects where bucket_id = 'warehouse-item-photos'),
  8::bigint,
  'active inventory viewer can read only registered photo objects'
);
select throws_ok(
  $$delete from storage.objects where bucket_id = 'warehouse-item-photos'$$,
  '42501', null,
  'inventory viewer cannot delete photo objects'
);
reset role;

select set_config('request.jwt.claim.sub', 'b5000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.delete_warehouse_variant_photo_secure(
    'b3000000-0000-4000-8000-000000000001',
    (
      select id from public.warehouse_variant_photos
      where object_path = 'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000008.webp'
    ),
    'b3000000-0000-4000-8000-000000000001/b8000000-0000-4000-8000-000000000008.webp'
  ),
  true,
  'catalog manager deletes exact matching metadata after Storage authorization'
);
reset role;

select is(
  (select count(*) from public.warehouse_photo_audit
   where action not in ('registered', 'reordered', 'deleted')),
  0::bigint,
  'photo audit contains only fixed action identifiers'
);
select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('warehouse_variant_photos', 'warehouse_photo_audit')
      and column_name ~ '(url|base64|blob|data|payload)'
  ),
  0::bigint,
  'photo metadata and audit contain no URL, base64, blob, data or payload columns'
);

select * from finish();
rollback;

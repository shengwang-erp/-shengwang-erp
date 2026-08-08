begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;
select no_plan();

select has_function('public', 'resolve_warehouse_qr_secure', array['text']);

select is(
  (
    select count(*)::integer
    from pg_proc procedure
    where procedure.oid = to_regprocedure('public.resolve_warehouse_qr_secure(text)')
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=pg_catalog, public, private']
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner))) privilege
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
  1,
  'QR resolver is stable fixed-path SECURITY DEFINER with authenticated-only exact ACL'
);

select ok(
  position(
    'private.assert_warehouse_permission(''module.inventory.view'')'
    in pg_get_functiondef('public.resolve_warehouse_qr_secure(text)'::regprocedure)
  ) > 0
  and position(
    'actor_id'
    in pg_get_functiondef('public.resolve_warehouse_qr_secure(text)'::regprocedure)
  ) > 0,
  'QR resolver derives the active actor server-side and requires exact inventory view permission'
);

create or replace function pg_temp.qr_error_hint(p_statement text)
returns text
language plpgsql
as $$
declare captured_hint text;
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
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'qr-viewer@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'qr-denied@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c5000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'qr-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('c6000000-0000-4000-8000-000000000001', 'SW-9901', 'c5000000-0000-4000-8000-000000000001', '扫码查看员', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('c6000000-0000-4000-8000-000000000002', 'SW-9902', 'c5000000-0000-4000-8000-000000000002', '扫码无权员', '工程部', '大工', '在职', 'active', false),
  ('c6000000-0000-4000-8000-000000000003', 'SW-9903', 'c5000000-0000-4000-8000-000000000003', '扫码停用员', '仓库管理部', '仓库管理员', '在职', 'disabled', false);

insert into public.permission_grants(subject_type, subject_code, permission_key)
values ('position', '仓库管理员', 'module.inventory.view');

insert into public.warehouse_items(id, name, category, brand, description, active)
values (
  'c2000000-0000-4000-8000-000000000001',
  '铜管', '空调材料', '厂家A', '冷媒铜管', true
);

insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, manufacturer_qr, active
) values
  (
    'c3000000-0000-4000-8000-000000000001',
    'c2000000-0000-4000-8000-000000000001',
    'QR-CU-6MM', 'R410A', '6mm', '铜', '米', 20, 9999,
    'SWERP:VARIANT:c3000000-0000-4000-8000-000000000001',
    'Maker-Café-QR-01', true
  ),
  (
    'c3000000-0000-4000-8000-000000000002',
    'c2000000-0000-4000-8000-000000000001',
    'QR-CU-INACTIVE', '', '', '', '米', 0, 8888,
    'SWERP:VARIANT:c3000000-0000-4000-8000-000000000002',
    'Maker-Inactive-QR', false
  );

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select is(
  public.resolve_warehouse_qr_secure(
    '　swerp:variant:C3000000-0000-4000-8000-000000000001　'
  )->>'id',
  'c3000000-0000-4000-8000-000000000001',
  'system QR resolves case-insensitively after Unicode-edge normalization'
);

select is(
  public.resolve_warehouse_qr_secure(E'\u2002maker-cafe\u0301-qr-01\u00a0')->>'id',
  'c3000000-0000-4000-8000-000000000001',
  'manufacturer QR resolves case-insensitively after NFC normalization'
);

select is(
  (
    select array_agg(key order by key)
    from jsonb_object_keys(public.resolve_warehouse_qr_secure('Maker-Café-QR-01')) key
  ),
  array[
    'brand', 'category', 'id', 'itemId', 'itemName', 'manufacturerQr',
    'material', 'model', 'size', 'sku', 'systemQr', 'unit'
  ]::text[],
  'QR result has an exact cost-free browser contract'
);

select is(
  public.resolve_warehouse_qr_secure('UNKNOWN-QR'),
  null::jsonb,
  'unknown QR is a normal null result'
);

select is(
  public.resolve_warehouse_qr_secure(
    'SWERP:VARIANT:c3000000-0000-4000-8000-000000000002'
  ),
  null::jsonb,
  'inactive variants never resolve by system QR'
);

select is(
  public.resolve_warehouse_qr_secure('Maker-Inactive-QR'),
  null::jsonb,
  'inactive variants never resolve by manufacturer QR'
);

select is(
  pg_temp.qr_error_hint($statement$
    select public.resolve_warehouse_qr_secure(E' \t\n ')
  $statement$),
  'WAREHOUSE_QR_INPUT_INVALID',
  'blank QR input fails with a stable safe hint'
);
reset role;

select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.resolve_warehouse_qr_secure('Maker-Café-QR-01')$$,
  '42501', 'warehouse permission required',
  'active employee without inventory view permission cannot resolve QR'
);
reset role;

select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.resolve_warehouse_qr_secure('Maker-Café-QR-01')$$,
  '42501', 'active employee required',
  'inactive employee cannot resolve QR'
);
reset role;

drop index public.warehouse_variants_manufacturer_qr_ci_unique;
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, manufacturer_qr, active
) values (
  'c3000000-0000-4000-8000-000000000003',
  'c2000000-0000-4000-8000-000000000001',
  'QR-CU-DUPLICATE', '', '', '', '米', 0, 7777,
  'SWERP:VARIANT:c3000000-0000-4000-8000-000000000003',
  'maker-café-qr-01', true
);

select set_config('request.jwt.claim.sub', 'c5000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  pg_temp.qr_error_hint($statement$
    select public.resolve_warehouse_qr_secure('Maker-Café-QR-01')
  $statement$),
  'WAREHOUSE_QR_AMBIGUOUS',
  'duplicate active QR corruption fails closed instead of selecting an arbitrary variant'
);
reset role;

select * from finish();
rollback;

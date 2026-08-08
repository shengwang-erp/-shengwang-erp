create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

do $$
declare target record; proof record; connection_string text;
begin
  if to_regclass('private.warehouse_task1_test_target') is null then
    raise exception 'explicit isolated warehouse workflow target required';
  end if;
  select * into target from private.warehouse_task1_test_target;
  if not found
    or (select count(*) from private.warehouse_task1_test_target) <> 1
    or target.project_id !~ '^warehouse-phase3-task1-[a-z0-9-]+$'
    or target.test_workdir !~ '^/private/tmp/warehouse-phase3-task1-[A-Za-z0-9._-]+$'
    or target.db_port not between 1024 and 65535 or target.db_port = 54322
    or target.api_port not between 1024 and 65535 or target.api_port = 54321
    or target.marker_nonce is null
    or target.created_at < clock_timestamp() - interval '5 minutes'
    or target.created_at > clock_timestamp()
    or not exists (
      select 1 from supabase_migrations.schema_migrations where version = '202608080004'
    )
  then
    raise exception 'explicit isolated warehouse workflow target required';
  end if;
  connection_string := format(
    'host=host.docker.internal port=%s dbname=postgres user=postgres password=postgres application_name=%s',
    target.db_port, target.project_id || '-' || target.marker_nonce::text
  );
  perform extensions.dblink_connect('wf_proof', connection_string);
  select * into proof from extensions.dblink(
    'wf_proof',
    'select project_id,test_workdir,db_port,api_port,marker_nonce,
            created_at > clock_timestamp() - interval ''5 minutes'',
            exists(select 1 from supabase_migrations.schema_migrations where version=''202608080004'')
       from private.warehouse_task1_test_target'
  ) as remote_proof(
    project_id text, test_workdir text, db_port integer, api_port integer,
    marker_nonce uuid, fresh boolean, migrated boolean
  );
  perform extensions.dblink_disconnect('wf_proof');
  if not found
    or proof.project_id is distinct from target.project_id
    or proof.test_workdir is distinct from target.test_workdir
    or proof.db_port is distinct from target.db_port
    or proof.api_port is distinct from target.api_port
    or proof.marker_nonce is distinct from target.marker_nonce
    or proof.fresh is distinct from true or proof.migrated is distinct from true
  then
    raise exception 'remote warehouse workflow marker mismatch before fixtures';
  end if;
exception when others then
  begin perform extensions.dblink_disconnect('wf_proof'); exception when others then null; end;
  raise;
end;
$$;

set search_path = public, auth, extensions;
select plan(12);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'de500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'workflow-race@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values (
  'de600000-0000-4000-8000-000000000001', 'SW-9861',
  'de500000-0000-4000-8000-000000000001', '仓库流程并发测试员',
  '仓库管理部', '仓库管理员', '在职', 'active', false
);
insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('position', '仓库管理员', 'warehouse.catalog.manage'),
  ('position', '仓库管理员', 'warehouse.receipt.submit'),
  ('position', '仓库管理员', 'warehouse.stock_flow.request'),
  ('position', '仓库管理员', 'module.purchases.view'),
  ('position', '仓库管理员', 'module.purchases.create')
on conflict do nothing;
insert into public.warehouse_sites(id, code, name, kind, active) values
  ('de000000-0000-4000-8000-000000000001', 'WF-RACE', '流程并发仓', 'normal', true);
insert into public.warehouse_locations(id, warehouse_id, shelf_code, shelf_name, active) values
  ('de100000-0000-4000-8000-000000000001', 'de000000-0000-4000-8000-000000000001', 'R-01', '并发货架一', true),
  ('de100000-0000-4000-8000-000000000002', 'de000000-0000-4000-8000-000000000001', 'R-02', '并发货架二', true);
insert into public.warehouse_items(id, name, category, brand, description, active) values
  ('de200000-0000-4000-8000-000000000001', '并发铜管', '', '', '', true);
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, active
) values
  ('de300000-0000-4000-8000-000000000001', 'de200000-0000-4000-8000-000000000001', 'WF-RACE-1', '', '', '', '米', 0, 100, 'SWERP:VARIANT:de300000-0000-4000-8000-000000000001', true),
  ('de300000-0000-4000-8000-000000000002', 'de200000-0000-4000-8000-000000000001', 'WF-RACE-2', '', '', '', '米', 0, 100, 'SWERP:VARIANT:de300000-0000-4000-8000-000000000002', true);
insert into public.purchase_records(record_key, payload, status)
values ('PO-WF-RACE', '{"purchaseId":"PO-WF-RACE","itemName":"并发铜管","quantity":2}', 'active');

create or replace function public.task1_pause_stock_out(p_marker bigint)
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  perform public.submit_warehouse_stock_out_secure(
    '{"destinationType":"internal_use","projectId":null,"minorWorkOrderId":null,"destinationNameSnapshot":"公司内部使用","purpose":"并发验证","receiver":"测试员","requestDate":"2026-08-09"}',
    '[{"variantId":"de300000-0000-4000-8000-000000000001","requestedQuantity":1}]',
    'wf-race-out-1'
  );
  perform pg_advisory_lock(p_marker);
  perform pg_advisory_unlock(p_marker);
  return 'submitted';
end;
$$;

create or replace function public.task1_variant_deactivation_error()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare captured text;
begin
  perform public.upsert_warehouse_variant_secure(
    'de300000-0000-4000-8000-000000000001',
    '{"id":"de300000-0000-4000-8000-000000000001","itemId":"de200000-0000-4000-8000-000000000001","sku":"WF-RACE-1","model":"","size":"","material":"","unit":"米","minimumStock":0,"defaultPurchasePrice":100,"manufacturerQr":null,"active":false}'
  );
  return null;
exception when others then
  get stacked diagnostics captured = PG_EXCEPTION_HINT;
  return coalesce(captured, sqlerrm);
end;
$$;

create or replace function public.task1_pause_location_deactivation(p_marker bigint)
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
begin
  perform public.upsert_warehouse_location_secure(
    'de100000-0000-4000-8000-000000000002',
    '{"id":"de100000-0000-4000-8000-000000000002","warehouseId":"de000000-0000-4000-8000-000000000001","shelfCode":"R-02","shelfName":"并发货架二","active":false}'
  );
  perform pg_advisory_lock(p_marker);
  perform pg_advisory_unlock(p_marker);
  return 'deactivated';
end;
$$;

create or replace function public.task1_receipt_submission_error()
returns text
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare captured text;
begin
  perform public.submit_warehouse_receipt_secure(
    'PO-WF-RACE',
    '[{"variantId":"de300000-0000-4000-8000-000000000002","requestedQuantity":1,"warehouseId":"de000000-0000-4000-8000-000000000001","locationId":"de100000-0000-4000-8000-000000000002"}]',
    'wf-race-receipt-1'
  );
  return null;
exception when others then
  get stacked diagnostics captured = PG_EXCEPTION_HINT;
  return coalesce(captured, sqlerrm);
end;
$$;

select lives_ok(
  $$select extensions.dblink_connect(
    'wf_submit',
    (select format(
      'host=host.docker.internal port=%s dbname=postgres user=postgres password=postgres application_name=%s',
      db_port, project_id || '-' || marker_nonce::text
    ) from private.warehouse_task1_test_target)
  )$$,
  'first independent workflow connection opens'
);
select lives_ok(
  $$select extensions.dblink_connect(
    'wf_catalog',
    (select format(
      'host=host.docker.internal port=%s dbname=postgres user=postgres password=postgres application_name=%s',
      db_port, project_id || '-' || marker_nonce::text
    ) from private.warehouse_task1_test_target)
  )$$,
  'second independent catalog connection opens'
);

select pg_advisory_lock(90108001);
select extensions.dblink_exec('wf_submit', 'begin');
select extensions.dblink_exec('wf_submit', 'set request.jwt.claim.role = ''authenticated''');
select extensions.dblink_exec('wf_submit', 'set request.jwt.claim.sub = ''de500000-0000-4000-8000-000000000001''');
select extensions.dblink_exec('wf_submit', 'set role authenticated');
select extensions.dblink_exec('wf_catalog', 'begin');
select extensions.dblink_exec('wf_catalog', 'set request.jwt.claim.role = ''authenticated''');
select extensions.dblink_exec('wf_catalog', 'set request.jwt.claim.sub = ''de500000-0000-4000-8000-000000000001''');
select extensions.dblink_exec('wf_catalog', 'set role authenticated');
select extensions.dblink_send_query('wf_submit', 'select public.task1_pause_stock_out(90108001)');
select pg_sleep(0.2);
select extensions.dblink_send_query('wf_catalog', 'select public.task1_variant_deactivation_error()');
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('wf_submit'), 1, 'submission is paused while holding the variant resource lock');
select is(extensions.dblink_is_busy('wf_catalog'), 1, 'concurrent variant deactivation waits for submission');
select pg_advisory_unlock(90108001);
select is(
  (select result from extensions.dblink_get_result('wf_submit') as response(result text)),
  'submitted',
  'pending stock-out finishes before the waiting catalog mutation'
);
select extensions.dblink_exec('wf_submit', 'commit');
select is(
  (select result from extensions.dblink_get_result('wf_catalog') as response(result text)),
  'WAREHOUSE_VARIANT_HAS_PENDING_DOCUMENT',
  'waiting variant deactivation rechecks and is refused after pending submission commits'
);
select extensions.dblink_exec('wf_catalog', 'rollback');

select pg_advisory_lock(90108002);
select extensions.dblink_exec('wf_catalog', 'begin');
select extensions.dblink_exec('wf_catalog', 'set request.jwt.claim.role = ''authenticated''');
select extensions.dblink_exec('wf_catalog', 'set request.jwt.claim.sub = ''de500000-0000-4000-8000-000000000001''');
select extensions.dblink_exec('wf_catalog', 'set role authenticated');
select extensions.dblink_exec('wf_submit', 'begin');
select extensions.dblink_exec('wf_submit', 'set request.jwt.claim.role = ''authenticated''');
select extensions.dblink_exec('wf_submit', 'set request.jwt.claim.sub = ''de500000-0000-4000-8000-000000000001''');
select extensions.dblink_exec('wf_submit', 'set role authenticated');
select extensions.dblink_send_query('wf_catalog', 'select public.task1_pause_location_deactivation(90108002)');
select pg_sleep(0.2);
select extensions.dblink_send_query('wf_submit', 'select public.task1_receipt_submission_error()');
select pg_sleep(0.2);
select is(extensions.dblink_is_busy('wf_catalog'), 1, 'catalog transaction is paused after deactivating the location');
select is(extensions.dblink_is_busy('wf_submit'), 1, 'receipt submission waits for the location resource lock');
select pg_advisory_unlock(90108002);
select is(
  (select result from extensions.dblink_get_result('wf_catalog') as response(result text)),
  'deactivated',
  'location deactivation completes first'
);
select extensions.dblink_exec('wf_catalog', 'commit');
select is(
  (select result from extensions.dblink_get_result('wf_submit') as response(result text)),
  'WAREHOUSE_RESOURCE_INACTIVE',
  'waiting receipt rechecks the location and fails closed without a pending write'
);
select extensions.dblink_exec('wf_submit', 'rollback');
select is(
  (select count(*) from public.warehouse_receipts where idempotency_key = 'wf-race-receipt-1'),
  0::bigint,
  'failed post-lock receipt submission leaves no document'
);
select ok(
  not (select active from public.warehouse_locations where id = 'de100000-0000-4000-8000-000000000002'),
  'the first committed location deactivation remains authoritative'
);

select extensions.dblink_disconnect('wf_submit');
select extensions.dblink_disconnect('wf_catalog');
select * from finish();

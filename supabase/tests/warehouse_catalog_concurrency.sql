create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, auth, extensions;

select plan(4);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'bc500000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'catalog-race@auth.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values (
  'bc600000-0000-4000-8000-000000000001', 'SW-9891',
  'bc500000-0000-4000-8000-000000000001', '仓库并发测试员',
  '仓库管理部', '大工', '在职', 'active', false
);
insert into public.permission_grants(subject_type, subject_code, permission_key)
values ('department', '仓库管理部', 'warehouse.catalog.manage');

insert into public.warehouse_sites(id, code, name, kind, active)
values (
  'bc000000-0000-4000-8000-000000000001',
  'RACE-SITE', '并发测试仓', 'normal', true
);
insert into public.warehouse_items(id, name, category, brand, description, active)
values (
  'bc200000-0000-4000-8000-000000000001',
  '并发测试物品', '', '', '', true
);

create or replace function public.task2_pause_site_deactivation(
  p_site_id uuid,
  p_payload jsonb,
  p_marker bigint
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  result := public.upsert_warehouse_site_secure(p_site_id, p_payload);
  perform pg_advisory_lock(p_marker);
  perform pg_sleep(0.5);
  perform pg_advisory_unlock(p_marker);
  return result;
end;
$$;

create or replace function public.task2_pause_item_deactivation(
  p_item_id uuid,
  p_payload jsonb,
  p_marker bigint
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  result := public.upsert_warehouse_item_secure(p_item_id, p_payload);
  perform pg_advisory_lock(p_marker);
  perform pg_sleep(0.5);
  perform pg_advisory_unlock(p_marker);
  return result;
end;
$$;

revoke all on function public.task2_pause_site_deactivation(uuid, jsonb, bigint)
  from public, anon, service_role;
revoke all on function public.task2_pause_item_deactivation(uuid, jsonb, bigint)
  from public, anon, service_role;
grant execute on function public.task2_pause_site_deactivation(uuid, jsonb, bigint)
  to authenticated;
grant execute on function public.task2_pause_item_deactivation(uuid, jsonb, bigint)
  to authenticated;

create or replace function pg_temp.task2_wait_for_marker(p_marker bigint)
returns boolean
language plpgsql
as $$
begin
  for attempt in 1..200 loop
    if pg_try_advisory_lock(p_marker) then
      perform pg_advisory_unlock(p_marker);
      perform pg_sleep(0.01);
    else
      return true;
    end if;
  end loop;
  return false;
end;
$$;

create or replace function pg_temp.task2_begin_remote(p_connection text)
returns void
language plpgsql
as $$
begin
  perform extensions.dblink_exec(p_connection, 'begin');
  perform extensions.dblink_exec(
    p_connection,
    'set local request.jwt.claim.role = ''authenticated'''
  );
  perform extensions.dblink_exec(
    p_connection,
    'set local request.jwt.claim.sub = ''bc500000-0000-4000-8000-000000000001'''
  );
  perform extensions.dblink_exec(p_connection, 'set local role authenticated');
end;
$$;

create or replace function pg_temp.task2_drain_json(
  p_connection text,
  p_fail_on_error boolean
)
returns integer
language plpgsql
as $$
declare
  result_count integer;
begin
  select count(*)::integer into result_count
  from extensions.dblink_get_result(p_connection, p_fail_on_error) result(value jsonb);
  return result_count;
end;
$$;

create or replace function pg_temp.task2_finish_parent(p_connection text)
returns void
language plpgsql
as $$
begin
  perform pg_temp.task2_drain_json(p_connection, true);
  perform extensions.dblink_exec(p_connection, 'commit');
end;
$$;

create or replace function pg_temp.task2_finish_child(p_connection text)
returns void
language plpgsql
as $$
declare
  result_count integer;
begin
  result_count := pg_temp.task2_drain_json(p_connection, false);
  if result_count = 1 then
    perform extensions.dblink_exec(p_connection, 'commit');
  else
    perform extensions.dblink_exec(p_connection, 'rollback');
  end if;
end;
$$;

create or replace function pg_temp.task2_connection_string()
returns text
language plpgsql
as $$
declare
  external_port integer := coalesce(
    nullif(current_setting('warehouse.test_external_port', true), ''),
    '54322'
  )::integer;
begin
  if external_port < 1024 or external_port > 65535 then
    raise exception 'warehouse test database port is invalid';
  end if;
  return format(
    'host=host.docker.internal port=%s dbname=postgres user=postgres password=postgres',
    external_port
  );
end;
$$;

select extensions.dblink_connect(
  'task2_parent',
  pg_temp.task2_connection_string()
);
select extensions.dblink_connect(
  'task2_child',
  pg_temp.task2_connection_string()
);

-- Active location creation racing with site deactivation.
select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task2_pause_site_deactivation(
      'bc000000-0000-4000-8000-000000000001',
      '{"id":"bc000000-0000-4000-8000-000000000001","code":"RACE-SITE","name":"并发测试仓","kind":"normal","active":false}',
      %s
    )$query$,
    hashtextextended('task2-site-create-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task2-site-create-marker', 0)
  ) then
    raise exception 'site-create race did not synchronize';
  end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  $query$select public.upsert_warehouse_location_secure(
    'bc100000-0000-4000-8000-000000000001',
    '{"id":"bc100000-0000-4000-8000-000000000001","warehouseId":"bc000000-0000-4000-8000-000000000001","shelfCode":"CREATE","shelfName":"创建竞争货架","active":true}'
  )$query$
);
select pg_temp.task2_finish_parent('task2_parent');
select pg_temp.task2_finish_child('task2_child');
select ok(
  not (select active from public.warehouse_sites
       where id = 'bc000000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.warehouse_locations
    where warehouse_id = 'bc000000-0000-4000-8000-000000000001' and active
  ),
  'location create cannot commit active under a concurrently deactivated site'
);
delete from public.warehouse_locations
where warehouse_id = 'bc000000-0000-4000-8000-000000000001';
update public.warehouse_sites set active = true
where id = 'bc000000-0000-4000-8000-000000000001';

-- Inactive location reactivation racing with site deactivation.
insert into public.warehouse_locations(
  id, warehouse_id, shelf_code, shelf_name, active
) values (
  'bc100000-0000-4000-8000-000000000002',
  'bc000000-0000-4000-8000-000000000001',
  'REACTIVATE', '重新启用竞争货架', false
);
select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task2_pause_site_deactivation(
      'bc000000-0000-4000-8000-000000000001',
      '{"id":"bc000000-0000-4000-8000-000000000001","code":"RACE-SITE","name":"并发测试仓","kind":"normal","active":false}',
      %s
    )$query$,
    hashtextextended('task2-site-reactivate-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task2-site-reactivate-marker', 0)
  ) then
    raise exception 'site-reactivate race did not synchronize';
  end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  $query$select public.upsert_warehouse_location_secure(
    'bc100000-0000-4000-8000-000000000002',
    '{"id":"bc100000-0000-4000-8000-000000000002","warehouseId":"bc000000-0000-4000-8000-000000000001","shelfCode":"REACTIVATE","shelfName":"重新启用竞争货架","active":true}'
  )$query$
);
select pg_temp.task2_finish_parent('task2_parent');
select pg_temp.task2_finish_child('task2_child');
select ok(
  not (select active from public.warehouse_sites
       where id = 'bc000000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.warehouse_locations
    where warehouse_id = 'bc000000-0000-4000-8000-000000000001' and active
  ),
  'location reactivation cannot commit under a concurrently deactivated site'
);
update public.warehouse_locations set active = false
where id = 'bc100000-0000-4000-8000-000000000002';
update public.warehouse_sites set active = true
where id = 'bc000000-0000-4000-8000-000000000001';

-- Active variant creation racing with item deactivation.
select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task2_pause_item_deactivation(
      'bc200000-0000-4000-8000-000000000001',
      '{"id":"bc200000-0000-4000-8000-000000000001","name":"并发测试物品","category":"","brand":"","description":"","active":false}',
      %s
    )$query$,
    hashtextextended('task2-variant-create-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task2-variant-create-marker', 0)
  ) then
    raise exception 'variant-create race did not synchronize';
  end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  $query$select public.upsert_warehouse_variant_secure(
    'bc300000-0000-4000-8000-000000000001',
    '{"id":"bc300000-0000-4000-8000-000000000001","itemId":"bc200000-0000-4000-8000-000000000001","sku":"RACE-CREATE","model":"","size":"","material":"","unit":"个","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":null,"active":true}'
  )$query$
);
select pg_temp.task2_finish_parent('task2_parent');
select pg_temp.task2_finish_child('task2_child');
select ok(
  not (select active from public.warehouse_items
       where id = 'bc200000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.warehouse_variants
    where item_id = 'bc200000-0000-4000-8000-000000000001' and active
  ),
  'variant create cannot commit active under a concurrently deactivated item'
);
delete from public.warehouse_variants
where item_id = 'bc200000-0000-4000-8000-000000000001';
update public.warehouse_items set active = true
where id = 'bc200000-0000-4000-8000-000000000001';

-- Inactive variant reactivation racing with item deactivation.
insert into public.warehouse_variants(
  id, item_id, sku, model, size, material, unit, minimum_stock,
  default_purchase_price, system_qr, manufacturer_qr, active
) values (
  'bc300000-0000-4000-8000-000000000002',
  'bc200000-0000-4000-8000-000000000001', 'RACE-REACTIVATE',
  '', '', '', '个', 0, 0,
  'SWERP:VARIANT:bc300000-0000-4000-8000-000000000002', null, false
);
select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task2_pause_item_deactivation(
      'bc200000-0000-4000-8000-000000000001',
      '{"id":"bc200000-0000-4000-8000-000000000001","name":"并发测试物品","category":"","brand":"","description":"","active":false}',
      %s
    )$query$,
    hashtextextended('task2-variant-reactivate-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task2-variant-reactivate-marker', 0)
  ) then
    raise exception 'variant-reactivate race did not synchronize';
  end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  $query$select public.upsert_warehouse_variant_secure(
    'bc300000-0000-4000-8000-000000000002',
    '{"id":"bc300000-0000-4000-8000-000000000002","itemId":"bc200000-0000-4000-8000-000000000001","sku":"RACE-REACTIVATE","model":"","size":"","material":"","unit":"个","minimumStock":0,"defaultPurchasePrice":0,"manufacturerQr":null,"active":true}'
  )$query$
);
select pg_temp.task2_finish_parent('task2_parent');
select pg_temp.task2_finish_child('task2_child');
select ok(
  not (select active from public.warehouse_items
       where id = 'bc200000-0000-4000-8000-000000000001')
  and not exists (
    select 1 from public.warehouse_variants
    where item_id = 'bc200000-0000-4000-8000-000000000001' and active
  ),
  'variant reactivation cannot commit under a concurrently deactivated item'
);

select * from finish();

select extensions.dblink_disconnect('task2_parent');
select extensions.dblink_disconnect('task2_child');

alter table public.warehouse_catalog_audit
  disable trigger reject_warehouse_catalog_audit_mutation;
delete from public.warehouse_catalog_audit
where actor_employee_profile_id = 'bc600000-0000-4000-8000-000000000001';
alter table public.warehouse_catalog_audit
  enable trigger reject_warehouse_catalog_audit_mutation;

delete from public.warehouse_variants
where item_id = 'bc200000-0000-4000-8000-000000000001';
delete from public.warehouse_locations
where warehouse_id = 'bc000000-0000-4000-8000-000000000001';
delete from public.warehouse_items
where id = 'bc200000-0000-4000-8000-000000000001';
delete from public.warehouse_sites
where id = 'bc000000-0000-4000-8000-000000000001';

drop function public.task2_pause_site_deactivation(uuid, jsonb, bigint);
drop function public.task2_pause_item_deactivation(uuid, jsonb, bigint);
delete from public.permission_grants
where subject_type = 'department'
  and subject_code = '仓库管理部'
  and permission_key = 'warehouse.catalog.manage';
delete from public.employee_profiles
where id = 'bc600000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'bc500000-0000-4000-8000-000000000001';

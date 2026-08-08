do $$
declare
  target record;
  proof record;
  connection_name text;
  connection_string text;
begin
  if to_regclass('private.warehouse_task3_test_target') is null
  then
    raise exception 'explicit isolated warehouse Task 3 target required';
  end if;
  select * into target from private.warehouse_task3_test_target;
  if not found
    or (select count(*) from private.warehouse_task3_test_target) <> 1
    or target.db_port not between 1024 and 65535
    or target.db_port = 54322
    or target.api_port not between 1024 and 65535
    or target.api_port = 54321
    or target.project_id !~ '^warehouse-task3-[a-z0-9-]+$'
    or target.test_workdir !~ '^/private/tmp/warehouse-task3-[A-Za-z0-9._-]+$'
    or target.marker_nonce is null
    or target.created_at < clock_timestamp() - interval '5 minutes'
    or target.created_at > clock_timestamp()
  then
    raise exception 'explicit isolated warehouse Task 3 target required';
  end if;
  if to_regprocedure(
      'public.register_warehouse_variant_photo_secure(uuid,text,text,bigint)'
    ) is null
    or not exists (
      select 1 from storage.buckets
      where id = 'warehouse-item-photos' and public = false
    )
    or not exists (
      select 1 from supabase_migrations.schema_migrations
      where version = '202608080003'
    )
  then
    raise exception 'warehouse Task 3 migration marker missing on isolated target';
  end if;
  connection_string := format(
    'host=host.docker.internal port=%s dbname=postgres user=postgres password=postgres application_name=%s',
    target.db_port,
    target.project_id || '-' || target.marker_nonce::text
  );
  foreach connection_name in array array['task2_parent', 'task2_child'] loop
    perform extensions.dblink_connect(connection_name, connection_string);
    perform extensions.dblink_exec(connection_name, 'begin read only');
    select * into proof
    from extensions.dblink(
      connection_name,
      $remote$
        select marker.project_id, marker.test_workdir, marker.db_port,
               marker.api_port, marker.marker_nonce,
               marker.created_at > clock_timestamp() - interval '5 minutes',
               exists(
                 select 1 from supabase_migrations.schema_migrations
                 where version = '202608080003'
               ),
               exists(
                 select 1 from storage.buckets
                 where id = 'warehouse-item-photos' and public = false
               )
        from private.warehouse_task3_test_target marker
      $remote$
    ) as remote_proof(
      project_id text, test_workdir text, db_port integer, api_port integer,
      marker_nonce uuid, fresh boolean, migrated boolean, private_bucket boolean
    );
    if not found
      or proof.project_id is distinct from target.project_id
      or proof.test_workdir is distinct from target.test_workdir
      or proof.db_port is distinct from target.db_port
      or proof.api_port is distinct from target.api_port
      or proof.marker_nonce is distinct from target.marker_nonce
      or proof.fresh is distinct from true
      or proof.migrated is distinct from true
      or proof.private_bucket is distinct from true
    then
      raise exception 'remote warehouse Task 3 marker mismatch before fixtures';
    end if;
    perform extensions.dblink_exec(connection_name, 'rollback');
  end loop;
exception when others then
  begin perform extensions.dblink_disconnect('task2_parent'); exception when others then null; end;
  begin perform extensions.dblink_disconnect('task2_child'); exception when others then null; end;
  raise;
end;
$$;

set search_path = public, auth, extensions;
select plan(7);

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

create or replace function public.task3_pause_photo_registration(
  p_variant_id uuid,
  p_object_path text,
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
  result := public.register_warehouse_variant_photo_secure(
    p_variant_id, p_object_path, 'image/jpeg', 100
  );
  perform pg_advisory_lock(p_marker);
  perform pg_sleep(0.5);
  perform pg_advisory_unlock(p_marker);
  return result;
end;
$$;

create or replace function public.task3_pause_photo_delete_begin(
  p_variant_id uuid,
  p_photo_id uuid,
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
  result := public.begin_warehouse_variant_photo_delete_secure(
    p_variant_id, p_photo_id
  );
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
revoke all on function public.task3_pause_photo_registration(uuid, text, bigint)
  from public, anon, service_role;
grant execute on function public.task3_pause_photo_registration(uuid, text, bigint)
  to authenticated;
revoke all on function public.task3_pause_photo_delete_begin(uuid, uuid, bigint)
  from public, anon, service_role;
grant execute on function public.task3_pause_photo_delete_begin(uuid, uuid, bigint)
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

create or replace function pg_temp.task3_finish_limit_child(p_connection text)
returns text
language plpgsql
as $$
declare
  result_count integer;
  error_message text;
begin
  result_count := pg_temp.task2_drain_json(p_connection, false);
  error_message := extensions.dblink_error_message(p_connection);
  if result_count = 1 then
    perform extensions.dblink_exec(p_connection, 'commit');
  else
    perform extensions.dblink_exec(p_connection, 'rollback');
  end if;
  return error_message;
end;
$$;

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

-- Two photo registrations racing for the eighth and ninth slots.
update public.warehouse_items set active = true
where id = 'bc200000-0000-4000-8000-000000000001';
update public.warehouse_variants set active = true
where id = 'bc300000-0000-4000-8000-000000000002';
insert into storage.objects(id, bucket_id, name, owner_id, metadata)
select
  gen_random_uuid(),
  'warehouse-item-photos',
  format(
    'bc300000-0000-4000-8000-000000000002/bd800000-0000-4000-8000-%s.jpg',
    lpad(sequence::text, 12, '0')
  ),
  'bc500000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":100}'::jsonb
from generate_series(1, 9) sequence;
insert into public.warehouse_variant_photos(
  variant_id, object_path, sort_order, mime_type, byte_size,
  created_by_employee_profile_id
)
select
  'bc300000-0000-4000-8000-000000000002',
  format(
    'bc300000-0000-4000-8000-000000000002/bd800000-0000-4000-8000-%s.jpg',
    lpad(sequence::text, 12, '0')
  ),
  sequence - 1,
  'image/jpeg',
  100,
  'bc600000-0000-4000-8000-000000000001'
from generate_series(1, 7) sequence;

select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task3_pause_photo_registration(
      'bc300000-0000-4000-8000-000000000002',
      'bc300000-0000-4000-8000-000000000002/bd800000-0000-4000-8000-000000000008.jpg',
      %s
    )$query$,
    hashtextextended('task3-photo-limit-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task3-photo-limit-marker', 0)
  ) then
    raise exception 'photo limit race did not synchronize';
  end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  $query$select public.register_warehouse_variant_photo_secure(
    'bc300000-0000-4000-8000-000000000002',
    'bc300000-0000-4000-8000-000000000002/bd800000-0000-4000-8000-000000000009.jpg',
    'image/jpeg', 100
  )$query$
);
select pg_temp.task2_finish_parent('task2_parent');
select set_config(
  'warehouse.photo_limit_child_error',
  pg_temp.task3_finish_limit_child('task2_child'),
  false
);
select ok(
  current_setting('warehouse.photo_limit_child_error')
    like '%warehouse photo limit reached%'
  and (
    select count(*) = 8
      and count(*) filter (
        where object_path like '%000000000008.jpg'
           or object_path like '%000000000009.jpg'
      ) = 1
    from public.warehouse_variant_photos
    where variant_id = 'bc300000-0000-4000-8000-000000000002'
  ),
  'concurrent eighth and ninth registrations commit exactly one photo'
);

-- A pending delete linearizes before a concurrent reorder.
select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task3_pause_photo_delete_begin(
      'bc300000-0000-4000-8000-000000000002',
      %L::uuid,
      %s
    )$query$,
    (select id from public.warehouse_variant_photos
     where object_path like '%000000000001.jpg'),
    hashtextextended('task3-photo-delete-reorder-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task3-photo-delete-reorder-marker', 0)
  ) then raise exception 'photo delete/reorder race did not synchronize'; end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  format(
    $query$select public.reorder_warehouse_variant_photos_secure(
      'bc300000-0000-4000-8000-000000000002', %L::uuid[]
    )$query$,
    (select array_agg(id order by sort_order)
     from public.warehouse_variant_photos
     where variant_id = 'bc300000-0000-4000-8000-000000000002')
  )
);
select pg_temp.task2_finish_parent('task2_parent');
select set_config(
  'warehouse.photo_delete_reorder_error',
  pg_temp.task3_finish_limit_child('task2_child'), false
);
select ok(
  current_setting('warehouse.photo_delete_reorder_error')
    like '%warehouse photo delete pending%'
  and (select count(*) = 1 from public.warehouse_photo_delete_outbox
       where variant_id = 'bc300000-0000-4000-8000-000000000002'),
  'delete begin commits before a concurrent reorder can mutate photo order'
);
select set_config(
  'warehouse.photo_delete_race_id',
  (select id::text from public.warehouse_variant_photos
   where object_path like '%000000000001.jpg'), false
);
set request.jwt.claim.role = 'authenticated';
set request.jwt.claim.sub = 'bc500000-0000-4000-8000-000000000001';
set role authenticated;
select public.cancel_warehouse_photo_delete_secure(
  (begun.ticket->>'deletionId')::uuid,
  (begun.ticket->>'variantId')::uuid,
  (begun.ticket->>'photoId')::uuid
)
from (
  select public.begin_warehouse_variant_photo_delete_secure(
    'bc300000-0000-4000-8000-000000000002',
    current_setting('warehouse.photo_delete_race_id')::uuid
  ) as ticket
) begun;
reset role;

-- A pending delete also linearizes before a concurrent registration.
select pg_temp.task2_begin_remote('task2_parent');
select pg_temp.task2_begin_remote('task2_child');
select extensions.dblink_send_query(
  'task2_parent',
  format(
    $query$select public.task3_pause_photo_delete_begin(
      'bc300000-0000-4000-8000-000000000002',
      %L::uuid,
      %s
    )$query$,
    (select id from public.warehouse_variant_photos
     where object_path like '%000000000001.jpg'),
    hashtextextended('task3-photo-delete-register-marker', 0)
  )
);
do $$
begin
  if not pg_temp.task2_wait_for_marker(
    hashtextextended('task3-photo-delete-register-marker', 0)
  ) then raise exception 'photo delete/register race did not synchronize'; end if;
end;
$$;
select extensions.dblink_send_query(
  'task2_child',
  format(
    $query$select public.register_warehouse_variant_photo_secure(
      'bc300000-0000-4000-8000-000000000002', %L,
      'image/jpeg', 100
    )$query$,
    (select name from storage.objects object
     where bucket_id = 'warehouse-item-photos'
       and name like 'bc300000-0000-4000-8000-000000000002/%'
       and not exists (
         select 1 from public.warehouse_variant_photos photo
         where photo.object_path = object.name
       ) limit 1)
  )
);
select pg_temp.task2_finish_parent('task2_parent');
select set_config(
  'warehouse.photo_delete_register_error',
  pg_temp.task3_finish_limit_child('task2_child'), false
);
select ok(
  current_setting('warehouse.photo_delete_register_error')
    like '%warehouse photo delete pending%'
  and (select count(*) = 1 from public.warehouse_photo_delete_outbox
       where variant_id = 'bc300000-0000-4000-8000-000000000002'),
  'delete begin commits before a concurrent registration can consume a slot'
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

alter table public.warehouse_photo_audit
  disable trigger reject_warehouse_photo_audit_mutation;
delete from public.warehouse_photo_audit
where actor_employee_profile_id = 'bc600000-0000-4000-8000-000000000001';
alter table public.warehouse_photo_audit
  enable trigger reject_warehouse_photo_audit_mutation;
alter table private.warehouse_photo_delete_receipts
  disable trigger reject_warehouse_photo_delete_receipt_mutation;
delete from private.warehouse_photo_delete_receipts
where requested_by_employee_profile_id = 'bc600000-0000-4000-8000-000000000001';
alter table private.warehouse_photo_delete_receipts
  enable trigger reject_warehouse_photo_delete_receipt_mutation;
delete from public.warehouse_photo_delete_outbox
where requested_by_employee_profile_id = 'bc600000-0000-4000-8000-000000000001';
delete from public.warehouse_variant_photos
where variant_id = 'bc300000-0000-4000-8000-000000000002';
set session_replication_role = replica;
delete from storage.objects
where bucket_id = 'warehouse-item-photos'
  and name like 'bc300000-0000-4000-8000-000000000002/%';
set session_replication_role = origin;

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
drop function public.task3_pause_photo_registration(uuid, text, bigint);
drop function public.task3_pause_photo_delete_begin(uuid, uuid, bigint);
delete from public.permission_grants
where subject_type = 'department'
  and subject_code = '仓库管理部'
  and permission_key = 'warehouse.catalog.manage';
delete from public.employee_profiles
where id = 'bc600000-0000-4000-8000-000000000001';
delete from auth.users
where id = 'bc500000-0000-4000-8000-000000000001';

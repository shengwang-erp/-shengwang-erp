-- Authorized warehouse catalog mutations and normalized identifier-only audit.
-- Media storage is added by the next task; this migration exposes no browser table writes.

begin;

create table public.warehouse_catalog_audit (
  id bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  parent_id uuid,
  action text not null,
  actor_employee_profile_id uuid not null,
  before_active boolean,
  after_active boolean not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint warehouse_catalog_audit_entity_type_check
    check (entity_type in ('site', 'location', 'item', 'variant')),
  constraint warehouse_catalog_audit_action_check
    check (action in ('created', 'updated', 'deactivated', 'reactivated')),
  constraint warehouse_catalog_audit_actor_fk
    foreign key (actor_employee_profile_id)
      references public.employee_profiles(id) on delete restrict
);

create index warehouse_catalog_audit_entity_time_idx
  on public.warehouse_catalog_audit(entity_type, entity_id, created_at desc, id);
create index warehouse_catalog_audit_actor_time_idx
  on public.warehouse_catalog_audit(actor_employee_profile_id, created_at desc, id);

alter table public.warehouse_catalog_audit enable row level security;
revoke all on table public.warehouse_catalog_audit
  from public, anon, authenticated, service_role;
revoke all on sequence public.warehouse_catalog_audit_id_seq
  from public, anon, authenticated, service_role;

create or replace function private.reject_warehouse_catalog_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501', message = 'warehouse catalog audit is immutable';
end;
$$;

revoke all on function private.reject_warehouse_catalog_audit_mutation()
  from public, anon, authenticated, service_role;

create trigger reject_warehouse_catalog_audit_mutation
before update or delete on public.warehouse_catalog_audit
for each row execute function private.reject_warehouse_catalog_audit_mutation();

create unique index warehouse_variants_sku_ci_unique
  on public.warehouse_variants(lower(sku));

create or replace function private.normalize_warehouse_catalog_text(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select normalize(
    btrim(
      p_value,
      chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
      || chr(133) || chr(160) || chr(5760)
      || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
      || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201)
      || chr(8202) || chr(8203) || chr(8204) || chr(8205)
      || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(8288)
      || chr(12288) || chr(65279)
    ),
    NFC
  )
$$;

create or replace function private.warehouse_catalog_has_invisible(p_value text)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select strpos(p_value, chr(65279)) > 0
    or strpos(p_value, chr(8203)) > 0
    or strpos(p_value, chr(8204)) > 0
    or strpos(p_value, chr(8205)) > 0
    or strpos(p_value, chr(8288)) > 0
$$;

create or replace function private.warehouse_catalog_payload_keys_exact(
  p_payload jsonb,
  p_fields text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_typeof(p_payload) = 'object'
    and (select array_agg(key order by key) from jsonb_object_keys(p_payload) key)
      = (select array_agg(field order by field) from unnest(p_fields) field)
$$;

create or replace function private.warehouse_catalog_uuid(
  p_payload jsonb,
  p_field text
)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  result uuid;
begin
  if jsonb_typeof(p_payload->p_field) is distinct from 'string' then
    raise exception using
      errcode = '22023',
      message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  begin
    result := (p_payload->>p_field)::uuid;
  exception when invalid_text_representation then
    raise exception using
      errcode = '22023',
      message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end;
  return result;
end;
$$;

create or replace function private.warehouse_catalog_text(
  p_payload jsonb,
  p_field text,
  p_maximum integer,
  p_required boolean
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, private
as $$
declare
  result text;
begin
  if jsonb_typeof(p_payload->p_field) is distinct from 'string' then
    raise exception using
      errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  result := private.normalize_warehouse_catalog_text(p_payload->>p_field);
  if (p_required and result = '')
    or char_length(result) > p_maximum
    or private.warehouse_catalog_has_invisible(result)
  then
    raise exception using
      errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  return result;
end;
$$;

create or replace function private.warehouse_catalog_active(
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_payload->'active') is distinct from 'boolean' then
    raise exception using
      errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  return (p_payload->>'active')::boolean;
end;
$$;

create or replace function private.warehouse_catalog_numeric(
  p_payload jsonb,
  p_field text,
  p_scale integer,
  p_maximum numeric
)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  result numeric;
begin
  if jsonb_typeof(p_payload->p_field) is distinct from 'number' then
    raise exception using
      errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  begin
    result := (p_payload->>p_field)::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end;
  if result < 0
    or result > p_maximum
    or result <> trunc(result, p_scale)
    or result = 'NaN'::numeric
    or result = 'Infinity'::numeric
    or result = '-Infinity'::numeric
  then
    raise exception using
      errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  return result;
end;
$$;

create or replace function private.lock_warehouse_site_resource(p_site_id uuid)
returns void
language sql
volatile
strict
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended('warehouse-site-resource:' || p_site_id::text, 0)
  )
$$;

create or replace function private.lock_warehouse_location_resource(p_location_id uuid)
returns void
language sql
volatile
strict
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended('warehouse-location-resource:' || p_location_id::text, 0)
  )
$$;

create or replace function private.lock_warehouse_item_resource(p_item_id uuid)
returns void
language sql
volatile
strict
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended('warehouse-item-resource:' || p_item_id::text, 0)
  )
$$;

create or replace function private.lock_warehouse_variant_resource(p_variant_id uuid)
returns void
language sql
volatile
strict
set search_path = pg_catalog
as $$
  select pg_advisory_xact_lock(
    hashtextextended('warehouse-variant-resource:' || p_variant_id::text, 0)
  )
$$;

create or replace function private.write_warehouse_catalog_audit(
  p_entity_type text,
  p_entity_id uuid,
  p_parent_id uuid,
  p_action text,
  p_actor_employee_profile_id uuid,
  p_before_active boolean,
  p_after_active boolean
)
returns void
language sql
volatile
set search_path = pg_catalog, public
as $$
  insert into public.warehouse_catalog_audit(
    entity_type, entity_id, parent_id, action, actor_employee_profile_id,
    before_active, after_active
  ) values (
    p_entity_type, p_entity_id, p_parent_id, p_action,
    p_actor_employee_profile_id, p_before_active, p_after_active
  )
$$;

create or replace function private.warehouse_site_json(p_site_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', site.id,
    'code', site.code,
    'name', site.name,
    'kind', site.kind,
    'active', site.active,
    'createdAt', site.created_at,
    'updatedAt', site.updated_at
  )
  from public.warehouse_sites site
  where site.id = p_site_id
$$;

create or replace function private.warehouse_location_json(p_location_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', location.id,
    'warehouseId', location.warehouse_id,
    'shelfCode', location.shelf_code,
    'shelfName', location.shelf_name,
    'active', location.active,
    'createdAt', location.created_at,
    'updatedAt', location.updated_at
  )
  from public.warehouse_locations location
  where location.id = p_location_id
$$;

create or replace function private.warehouse_item_json(p_item_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', item.id,
    'name', item.name,
    'category', item.category,
    'brand', item.brand,
    'description', item.description,
    'active', item.active,
    'createdAt', item.created_at,
    'updatedAt', item.updated_at
  )
  from public.warehouse_items item
  where item.id = p_item_id
$$;

create or replace function private.warehouse_variant_json(
  p_variant_id uuid,
  p_view_cost boolean
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', variant.id,
    'itemId', variant.item_id,
    'sku', variant.sku,
    'model', variant.model,
    'size', variant.size,
    'material', variant.material,
    'unit', variant.unit,
    'minimumStock', variant.minimum_stock,
    'systemQr', variant.system_qr,
    'manufacturerQr', variant.manufacturer_qr,
    'active', variant.active,
    'createdAt', variant.created_at,
    'updatedAt', variant.updated_at
  ) || case when p_view_cost then jsonb_build_object(
    'defaultPurchasePrice', variant.default_purchase_price
  ) else '{}'::jsonb end
  from public.warehouse_variants variant
  where variant.id = p_variant_id
$$;

create or replace function private.warehouse_variant_has_pending_documents(
  p_variant_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  found_pending boolean;
  receipt_table regclass := to_regclass('public.warehouse_receipts');
  receipt_line_table regclass := to_regclass('public.warehouse_receipt_lines');
  stock_out_table regclass := to_regclass('public.warehouse_stock_out_requests');
  stock_out_line_table regclass := to_regclass('public.warehouse_stock_out_lines');
  return_table regclass := to_regclass('public.warehouse_return_requests');
  return_line_table regclass := to_regclass('public.warehouse_return_lines');
begin
  if num_nonnulls(
    receipt_table, receipt_line_table,
    stock_out_table, stock_out_line_table,
    return_table, return_line_table
  ) = 0 then
    return false;
  end if;

  if num_nonnulls(
    receipt_table, receipt_line_table,
    stock_out_table, stock_out_line_table,
    return_table, return_line_table
  ) <> 6 then
    raise exception using
      errcode = '55000',
      message = 'warehouse pending document schema incomplete',
      hint = 'WAREHOUSE_PENDING_SCHEMA_INCOMPLETE';
  end if;

  if p_variant_id is null then return false; end if;

  execute format(
    'select exists (
      select 1 from %s document
      join %s line on line.receipt_id = document.id
      where document.status = ''pending'' and line.variant_id = $1
    )', receipt_table, receipt_line_table
  ) into found_pending using p_variant_id;
  if found_pending then return true; end if;

  execute format(
    'select exists (
      select 1 from %s document
      join %s line on line.request_id = document.id
      where document.status = ''pending'' and line.variant_id = $1
    )', stock_out_table, stock_out_line_table
  ) into found_pending using p_variant_id;
  if found_pending then return true; end if;

  execute format(
    'select exists (
      select 1 from %s document
      join %s return_line on return_line.return_id = document.id
      join %s stock_line on stock_line.id = return_line.original_stock_out_line_id
      where document.status = ''pending'' and stock_line.variant_id = $1
    )', return_table, return_line_table, stock_out_line_table
  ) into found_pending using p_variant_id;
  if found_pending then return true; end if;

  return false;
end;
$$;

revoke all on function private.normalize_warehouse_catalog_text(text)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_catalog_has_invisible(text)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_catalog_payload_keys_exact(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_catalog_uuid(jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_catalog_text(jsonb, text, integer, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_catalog_active(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_catalog_numeric(jsonb, text, integer, numeric)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_warehouse_site_resource(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_warehouse_location_resource(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_warehouse_item_resource(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_warehouse_variant_resource(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.write_warehouse_catalog_audit(text, uuid, uuid, text, uuid, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_site_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_location_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_item_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_variant_json(uuid, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_variant_has_pending_documents(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.upsert_warehouse_site_secure(
  p_site_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  payload_id uuid;
  code_value text;
  name_value text;
  kind_value text;
  active_value boolean;
  existing public.warehouse_sites%rowtype;
  action_value text;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');

  if not private.warehouse_catalog_payload_keys_exact(
    p_payload, array['id', 'code', 'name', 'kind', 'active']
  ) then
    raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  payload_id := private.warehouse_catalog_uuid(p_payload, 'id');
  if p_site_id is null or payload_id <> p_site_id then
    raise exception using errcode = '22023', message = 'warehouse catalog id mismatch',
      hint = 'WAREHOUSE_CATALOG_ID_MISMATCH';
  end if;
  code_value := private.warehouse_catalog_text(p_payload, 'code', 100, true);
  name_value := private.warehouse_catalog_text(p_payload, 'name', 200, true);
  kind_value := private.warehouse_catalog_text(p_payload, 'kind', 30, true);
  active_value := private.warehouse_catalog_active(p_payload);
  if kind_value not in ('normal', 'project_site', 'shared_tool') then
    raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;

  perform private.lock_warehouse_site_resource(p_site_id);
  perform pg_advisory_xact_lock(hashtextextended('warehouse-site-code:' || lower(code_value), 0));
  if exists (
    select 1 from public.warehouse_sites site
    where lower(site.code) = lower(code_value) and site.id <> p_site_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse catalog conflict',
      hint = 'WAREHOUSE_CATALOG_CONFLICT';
  end if;
  select site.* into existing
  from public.warehouse_sites site where site.id = p_site_id for update;

  if found then
    if existing.active and not active_value and (
      exists (
        select 1 from public.warehouse_locations location
        where location.warehouse_id = p_site_id and location.active
      ) or exists (
        select 1
        from public.warehouse_batch_locations balance
        join public.warehouse_locations location on location.id = balance.location_id
        where location.warehouse_id = p_site_id and balance.quantity > 0
      )
    ) then
      raise exception using errcode = '55000', message = 'warehouse site in use',
        hint = 'WAREHOUSE_SITE_IN_USE';
    end if;
    if row(existing.code, existing.name, existing.kind, existing.active)
      is not distinct from row(code_value, name_value, kind_value, active_value)
    then
      return private.warehouse_site_json(p_site_id);
    end if;
    action_value := case
      when existing.active and not active_value then 'deactivated'
      when not existing.active and active_value then 'reactivated'
      else 'updated'
    end;
    update public.warehouse_sites set
      code = code_value, name = name_value, kind = kind_value, active = active_value
    where id = p_site_id;
    perform private.write_warehouse_catalog_audit(
      'site', p_site_id, null, action_value, actor_id, existing.active, active_value
    );
  else
    insert into public.warehouse_sites(id, code, name, kind, active)
    values (p_site_id, code_value, name_value, kind_value, active_value);
    perform private.write_warehouse_catalog_audit(
      'site', p_site_id, null, 'created', actor_id, null, active_value
    );
  end if;
  return private.warehouse_site_json(p_site_id);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'warehouse catalog conflict',
    hint = 'WAREHOUSE_CATALOG_CONFLICT';
end;
$$;

create or replace function public.upsert_warehouse_location_secure(
  p_location_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  payload_id uuid;
  warehouse_id_value uuid;
  shelf_code_value text;
  shelf_name_value text;
  active_value boolean;
  existing public.warehouse_locations%rowtype;
  action_value text;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if not private.warehouse_catalog_payload_keys_exact(
    p_payload, array['id', 'warehouseId', 'shelfCode', 'shelfName', 'active']
  ) then
    raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  payload_id := private.warehouse_catalog_uuid(p_payload, 'id');
  if p_location_id is null or payload_id <> p_location_id then
    raise exception using errcode = '22023', message = 'warehouse catalog id mismatch',
      hint = 'WAREHOUSE_CATALOG_ID_MISMATCH';
  end if;
  warehouse_id_value := private.warehouse_catalog_uuid(p_payload, 'warehouseId');
  shelf_code_value := private.warehouse_catalog_text(p_payload, 'shelfCode', 100, true);
  shelf_name_value := private.warehouse_catalog_text(p_payload, 'shelfName', 200, true);
  active_value := private.warehouse_catalog_active(p_payload);

  perform private.lock_warehouse_site_resource(warehouse_id_value);
  perform private.lock_warehouse_location_resource(p_location_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-location-code:' || warehouse_id_value::text || ':' || lower(shelf_code_value), 0
  ));
  if not exists (
    select 1 from public.warehouse_sites site
    where site.id = warehouse_id_value and (site.active or not active_value)
  ) then
    raise exception using errcode = '23503', message = 'warehouse catalog relation invalid',
      hint = 'WAREHOUSE_CATALOG_RELATION_INVALID';
  end if;
  if exists (
    select 1 from public.warehouse_locations location
    where location.warehouse_id = warehouse_id_value
      and lower(location.shelf_code) = lower(shelf_code_value)
      and location.id <> p_location_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse catalog conflict',
      hint = 'WAREHOUSE_CATALOG_CONFLICT';
  end if;
  select location.* into existing
  from public.warehouse_locations location where location.id = p_location_id for update;
  if found then
    if existing.warehouse_id <> warehouse_id_value then
      raise exception using errcode = '23503', message = 'warehouse catalog relation invalid',
        hint = 'WAREHOUSE_CATALOG_RELATION_INVALID';
    end if;
    if existing.active and not active_value and exists (
      select 1 from public.warehouse_batch_locations balance
      where balance.location_id = p_location_id and balance.quantity > 0
    ) then
      raise exception using errcode = '55000', message = 'warehouse location has stock',
        hint = 'WAREHOUSE_LOCATION_HAS_STOCK';
    end if;
    if row(existing.shelf_code, existing.shelf_name, existing.active)
      is not distinct from row(shelf_code_value, shelf_name_value, active_value)
    then
      return private.warehouse_location_json(p_location_id);
    end if;
    action_value := case
      when existing.active and not active_value then 'deactivated'
      when not existing.active and active_value then 'reactivated'
      else 'updated'
    end;
    update public.warehouse_locations set
      shelf_code = shelf_code_value, shelf_name = shelf_name_value, active = active_value
    where id = p_location_id;
    perform private.write_warehouse_catalog_audit(
      'location', p_location_id, warehouse_id_value, action_value,
      actor_id, existing.active, active_value
    );
  else
    insert into public.warehouse_locations(
      id, warehouse_id, shelf_code, shelf_name, active
    ) values (
      p_location_id, warehouse_id_value, shelf_code_value, shelf_name_value, active_value
    );
    perform private.write_warehouse_catalog_audit(
      'location', p_location_id, warehouse_id_value, 'created',
      actor_id, null, active_value
    );
  end if;
  return private.warehouse_location_json(p_location_id);
exception when unique_violation then
  raise exception using errcode = '23505', message = 'warehouse catalog conflict',
    hint = 'WAREHOUSE_CATALOG_CONFLICT';
end;
$$;

create or replace function public.upsert_warehouse_item_secure(
  p_item_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  payload_id uuid;
  name_value text;
  category_value text;
  brand_value text;
  description_value text;
  active_value boolean;
  existing public.warehouse_items%rowtype;
  action_value text;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if not private.warehouse_catalog_payload_keys_exact(
    p_payload, array['id', 'name', 'category', 'brand', 'description', 'active']
  ) then
    raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  payload_id := private.warehouse_catalog_uuid(p_payload, 'id');
  if p_item_id is null or payload_id <> p_item_id then
    raise exception using errcode = '22023', message = 'warehouse catalog id mismatch',
      hint = 'WAREHOUSE_CATALOG_ID_MISMATCH';
  end if;
  name_value := private.warehouse_catalog_text(p_payload, 'name', 300, true);
  category_value := private.warehouse_catalog_text(p_payload, 'category', 200, false);
  brand_value := private.warehouse_catalog_text(p_payload, 'brand', 200, false);
  description_value := private.warehouse_catalog_text(p_payload, 'description', 2000, false);
  active_value := private.warehouse_catalog_active(p_payload);

  perform private.lock_warehouse_item_resource(p_item_id);
  select item.* into existing
  from public.warehouse_items item where item.id = p_item_id for update;
  if found then
    if existing.active and not active_value and (
      exists (
        select 1 from public.warehouse_variants variant
        where variant.item_id = p_item_id and variant.active
      ) or exists (
        select 1
        from public.warehouse_batch_locations balance
        join public.warehouse_batches batch on batch.id = balance.batch_id
        join public.warehouse_variants variant on variant.id = batch.variant_id
        where variant.item_id = p_item_id and balance.quantity > 0
      )
    ) then
      raise exception using errcode = '55000', message = 'warehouse item in use',
        hint = 'WAREHOUSE_ITEM_IN_USE';
    end if;
    if row(existing.name, existing.category, existing.brand, existing.description, existing.active)
      is not distinct from row(
        name_value, category_value, brand_value, description_value, active_value
      )
    then
      return private.warehouse_item_json(p_item_id);
    end if;
    action_value := case
      when existing.active and not active_value then 'deactivated'
      when not existing.active and active_value then 'reactivated'
      else 'updated'
    end;
    update public.warehouse_items set
      name = name_value, category = category_value, brand = brand_value,
      description = description_value, active = active_value
    where id = p_item_id;
    perform private.write_warehouse_catalog_audit(
      'item', p_item_id, null, action_value, actor_id, existing.active, active_value
    );
  else
    insert into public.warehouse_items(id, name, category, brand, description, active)
    values (
      p_item_id, name_value, category_value, brand_value, description_value, active_value
    );
    perform private.write_warehouse_catalog_audit(
      'item', p_item_id, null, 'created', actor_id, null, active_value
    );
  end if;
  return private.warehouse_item_json(p_item_id);
end;
$$;

create or replace function public.upsert_warehouse_variant_secure(
  p_variant_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  payload_id uuid;
  item_id_value uuid;
  sku_value text;
  model_value text;
  size_value text;
  material_value text;
  unit_value text;
  minimum_stock_value numeric(18,3);
  default_price_value numeric(18,4);
  manufacturer_qr_value text;
  active_value boolean;
  existing public.warehouse_variants%rowtype;
  action_value text;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if not private.warehouse_catalog_payload_keys_exact(
    p_payload,
    array[
      'id', 'itemId', 'sku', 'model', 'size', 'material', 'unit',
      'minimumStock', 'defaultPurchasePrice', 'manufacturerQr', 'active'
    ]
  ) then
    raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  payload_id := private.warehouse_catalog_uuid(p_payload, 'id');
  if p_variant_id is null or payload_id <> p_variant_id then
    raise exception using errcode = '22023', message = 'warehouse catalog id mismatch',
      hint = 'WAREHOUSE_CATALOG_ID_MISMATCH';
  end if;
  item_id_value := private.warehouse_catalog_uuid(p_payload, 'itemId');
  sku_value := private.warehouse_catalog_text(p_payload, 'sku', 100, true);
  model_value := private.warehouse_catalog_text(p_payload, 'model', 300, false);
  size_value := private.warehouse_catalog_text(p_payload, 'size', 300, false);
  material_value := private.warehouse_catalog_text(p_payload, 'material', 300, false);
  unit_value := private.warehouse_catalog_text(p_payload, 'unit', 50, true);
  minimum_stock_value := private.warehouse_catalog_numeric(
    p_payload, 'minimumStock', 3, 9007199254740.991
  );
  default_price_value := private.warehouse_catalog_numeric(
    p_payload, 'defaultPurchasePrice', 4, 900719925474.0991
  );
  if p_payload->'manufacturerQr' = 'null'::jsonb then
    manufacturer_qr_value := null;
  elsif jsonb_typeof(p_payload->'manufacturerQr') = 'string' then
    manufacturer_qr_value := private.normalize_warehouse_catalog_text(
      p_payload->>'manufacturerQr'
    );
    if manufacturer_qr_value = '' then manufacturer_qr_value := null; end if;
    if manufacturer_qr_value is not null and (
      char_length(manufacturer_qr_value) > 500
      or private.warehouse_catalog_has_invisible(manufacturer_qr_value)
      or lower(manufacturer_qr_value) like 'swerp:variant:%'
    ) then
      raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
        hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
    end if;
  else
    raise exception using errcode = '22023', message = 'warehouse catalog input invalid',
      hint = 'WAREHOUSE_CATALOG_INPUT_INVALID';
  end if;
  active_value := private.warehouse_catalog_active(p_payload);

  perform private.lock_warehouse_item_resource(item_id_value);
  perform private.lock_warehouse_variant_resource(p_variant_id);
  perform pg_advisory_xact_lock(hashtextextended('warehouse-variant-sku:' || lower(sku_value), 0));
  if manufacturer_qr_value is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      'warehouse-variant-manufacturer-qr:' || lower(manufacturer_qr_value), 0
    ));
  end if;
  if not exists (
    select 1 from public.warehouse_items item
    where item.id = item_id_value and (item.active or not active_value)
  ) then
    raise exception using errcode = '23503', message = 'warehouse catalog relation invalid',
      hint = 'WAREHOUSE_CATALOG_RELATION_INVALID';
  end if;
  if exists (
    select 1 from public.warehouse_variants variant
    where lower(variant.sku) = lower(sku_value) and variant.id <> p_variant_id
  ) or (
    manufacturer_qr_value is not null and exists (
      select 1 from public.warehouse_variants variant
      where lower(variant.manufacturer_qr) = lower(manufacturer_qr_value)
        and variant.id <> p_variant_id
    )
  ) then
    raise exception using errcode = '23505', message = 'warehouse catalog conflict',
      hint = 'WAREHOUSE_CATALOG_CONFLICT';
  end if;
  select variant.* into existing
  from public.warehouse_variants variant where variant.id = p_variant_id for update;
  if found then
    if existing.item_id <> item_id_value then
      raise exception using errcode = '23503', message = 'warehouse catalog relation invalid',
        hint = 'WAREHOUSE_CATALOG_RELATION_INVALID';
    end if;
    if existing.active and not active_value then
      if exists (
        select 1
        from public.warehouse_batch_locations balance
        join public.warehouse_batches batch on batch.id = balance.batch_id
        where batch.variant_id = p_variant_id and balance.quantity > 0
      ) then
        raise exception using errcode = '55000', message = 'warehouse variant has stock',
          hint = 'WAREHOUSE_VARIANT_HAS_STOCK';
      end if;
      if private.warehouse_variant_has_pending_documents(p_variant_id) then
        raise exception using errcode = '55000',
          message = 'warehouse variant has pending document',
          hint = 'WAREHOUSE_VARIANT_HAS_PENDING_DOCUMENT';
      end if;
    end if;
    if row(
      existing.sku, existing.model, existing.size, existing.material, existing.unit,
      existing.minimum_stock, existing.default_purchase_price,
      existing.manufacturer_qr, existing.active
    ) is not distinct from row(
      sku_value, model_value, size_value, material_value, unit_value,
      minimum_stock_value, default_price_value, manufacturer_qr_value, active_value
    ) then
      return private.warehouse_variant_json(
        p_variant_id, public.has_current_permission('warehouse.cost.view')
      );
    end if;
    action_value := case
      when existing.active and not active_value then 'deactivated'
      when not existing.active and active_value then 'reactivated'
      else 'updated'
    end;
    update public.warehouse_variants set
      sku = sku_value, model = model_value, size = size_value,
      material = material_value, unit = unit_value,
      minimum_stock = minimum_stock_value,
      default_purchase_price = default_price_value,
      system_qr = 'SWERP:VARIANT:' || p_variant_id::text,
      manufacturer_qr = manufacturer_qr_value,
      active = active_value
    where id = p_variant_id;
    perform private.write_warehouse_catalog_audit(
      'variant', p_variant_id, item_id_value, action_value,
      actor_id, existing.active, active_value
    );
  else
    insert into public.warehouse_variants(
      id, item_id, sku, model, size, material, unit, minimum_stock,
      default_purchase_price, system_qr, manufacturer_qr, active
    ) values (
      p_variant_id, item_id_value, sku_value, model_value, size_value,
      material_value, unit_value, minimum_stock_value, default_price_value,
      'SWERP:VARIANT:' || p_variant_id::text, manufacturer_qr_value, active_value
    );
    perform private.write_warehouse_catalog_audit(
      'variant', p_variant_id, item_id_value, 'created', actor_id, null, active_value
    );
  end if;
  return private.warehouse_variant_json(
    p_variant_id, public.has_current_permission('warehouse.cost.view')
  );
exception when unique_violation then
  raise exception using errcode = '23505', message = 'warehouse catalog conflict',
    hint = 'WAREHOUSE_CATALOG_CONFLICT';
end;
$$;

revoke all on function public.upsert_warehouse_site_secure(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_warehouse_location_secure(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_warehouse_item_secure(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_warehouse_variant_secure(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_warehouse_site_secure(uuid, jsonb)
  to authenticated;
grant execute on function public.upsert_warehouse_location_secure(uuid, jsonb)
  to authenticated;
grant execute on function public.upsert_warehouse_item_secure(uuid, jsonb)
  to authenticated;
grant execute on function public.upsert_warehouse_variant_secure(uuid, jsonb)
  to authenticated;

-- Private ordered photos for warehouse variants.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'warehouse-item-photos',
  'warehouse-item-photos',
  false,
  2097151,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
);

create table public.warehouse_variant_photos (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null,
  object_path text not null,
  sort_order smallint not null,
  mime_type text not null,
  byte_size bigint not null,
  created_by_employee_profile_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint warehouse_variant_photos_variant_fk foreign key (variant_id)
    references public.warehouse_variants(id) on delete restrict,
  constraint warehouse_variant_photos_creator_fk
    foreign key (created_by_employee_profile_id)
      references public.employee_profiles(id) on delete restrict,
  constraint warehouse_variant_photos_path_check check (
    object_path ~ (
      '^' || variant_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  ),
  constraint warehouse_variant_photos_mime_check check (
    mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  constraint warehouse_variant_photos_mime_path_check check (
    (mime_type = 'image/jpeg' and right(object_path, 4) = '.jpg')
    or (mime_type = 'image/png' and right(object_path, 4) = '.png')
    or (mime_type = 'image/webp' and right(object_path, 5) = '.webp')
  ),
  constraint warehouse_variant_photos_byte_size_check check (
    byte_size between 1 and 2097151
  ),
  constraint warehouse_variant_photos_sort_order_check check (
    sort_order between 0 and 7
  ),
  constraint warehouse_variant_photos_variant_path_unique
    unique (variant_id, object_path),
  constraint warehouse_variant_photos_variant_sort_unique
    unique (variant_id, sort_order) deferrable initially immediate
);

create index warehouse_variant_photos_variant_created_idx
  on public.warehouse_variant_photos(variant_id, created_at, id);

create table public.warehouse_photo_audit (
  id bigint generated always as identity primary key,
  action text not null,
  photo_id uuid not null,
  variant_id uuid not null,
  actor_employee_profile_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint warehouse_photo_audit_action_check
    check (action in (
      'registered', 'reordered', 'delete_pending', 'delete_taken_over',
      'delete_cancelled', 'deleted'
    )),
  constraint warehouse_photo_audit_actor_fk
    foreign key (actor_employee_profile_id)
      references public.employee_profiles(id) on delete restrict
);

create index warehouse_photo_audit_variant_time_idx
  on public.warehouse_photo_audit(variant_id, created_at desc, id);
create index warehouse_photo_audit_actor_time_idx
  on public.warehouse_photo_audit(actor_employee_profile_id, created_at desc, id);

create table public.warehouse_photo_delete_outbox (
  deletion_id uuid primary key default gen_random_uuid(),
  kind text not null,
  photo_id uuid,
  variant_id uuid not null,
  object_path text not null unique,
  original_requested_by_employee_profile_id uuid not null,
  requested_by_employee_profile_id uuid not null,
  assigned_at timestamptz not null default statement_timestamp(),
  created_at timestamptz not null default statement_timestamp(),
  constraint warehouse_photo_delete_outbox_kind_check
    check (kind in ('registered', 'orphan')),
  constraint warehouse_photo_delete_outbox_kind_photo_check
    check ((kind = 'registered' and photo_id is not null) or (kind = 'orphan' and photo_id is null)),
  constraint warehouse_photo_delete_outbox_variant_fk foreign key (variant_id)
    references public.warehouse_variants(id) on delete restrict,
  constraint warehouse_photo_delete_outbox_original_requester_fk
    foreign key (original_requested_by_employee_profile_id)
      references public.employee_profiles(id) on delete restrict,
  constraint warehouse_photo_delete_outbox_requester_fk
    foreign key (requested_by_employee_profile_id)
      references public.employee_profiles(id) on delete restrict
);

create unique index warehouse_photo_delete_outbox_registered_photo_idx
  on public.warehouse_photo_delete_outbox(photo_id)
  where photo_id is not null;
create index warehouse_photo_delete_outbox_variant_created_idx
  on public.warehouse_photo_delete_outbox(variant_id, created_at, deletion_id);
create index warehouse_photo_delete_outbox_assignment_idx
  on public.warehouse_photo_delete_outbox(assigned_at, deletion_id);

create table private.warehouse_photo_delete_receipts (
  deletion_id uuid primary key,
  kind text not null check (kind in ('registered', 'orphan')),
  photo_id uuid,
  variant_id uuid not null,
  object_path text not null,
  requested_by_employee_profile_id uuid not null,
  outcome text not null check (outcome in ('cancelled', 'finalized')),
  created_at timestamptz not null default statement_timestamp(),
  check ((kind = 'registered' and photo_id is not null) or (kind = 'orphan' and photo_id is null))
);

create table private.warehouse_photo_delete_takeover_receipts (
  old_deletion_id uuid primary key,
  new_deletion_id uuid not null unique,
  original_requested_by_employee_profile_id uuid not null,
  previous_requested_by_employee_profile_id uuid not null,
  new_requested_by_employee_profile_id uuid not null,
  reason text not null check (reason in ('requester_unavailable', 'lease_expired')),
  created_at timestamptz not null default statement_timestamp()
);

create or replace function private.reject_warehouse_photo_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501', message = 'warehouse photo audit is immutable';
end;
$$;

create or replace function private.reject_warehouse_photo_delete_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501',
    message = 'warehouse photo delete receipt is immutable';
end;
$$;

create or replace function private.reject_warehouse_photo_delete_takeover_receipt_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '42501',
    message = 'warehouse photo delete takeover receipt is immutable';
end;
$$;

create trigger reject_warehouse_photo_audit_mutation
before update or delete on public.warehouse_photo_audit
for each row execute function private.reject_warehouse_photo_audit_mutation();

create trigger reject_warehouse_photo_delete_receipt_mutation
before update or delete on private.warehouse_photo_delete_receipts
for each row execute function private.reject_warehouse_photo_delete_receipt_mutation();

create trigger reject_warehouse_photo_delete_takeover_receipt_mutation
before update or delete on private.warehouse_photo_delete_takeover_receipts
for each row execute function private.reject_warehouse_photo_delete_takeover_receipt_mutation();

create or replace function private.warehouse_variant_photo_json(
  p_photo_id uuid
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', photo.id,
    'variantId', photo.variant_id,
    'objectPath', photo.object_path,
    'sortOrder', photo.sort_order,
    'mimeType', photo.mime_type,
    'byteSize', photo.byte_size,
    'createdAt', photo.created_at
  )
  from public.warehouse_variant_photos photo
  where photo.id = p_photo_id
$$;

create or replace function private.warehouse_variant_photo_list_json(
  p_variant_id uuid
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(
    private.warehouse_variant_photo_json(photo.id)
    order by photo.sort_order, photo.id
  ), '[]'::jsonb)
  from public.warehouse_variant_photos photo
  where photo.variant_id = p_variant_id
$$;

create or replace function private.enforce_warehouse_variant_photo_invariants()
returns trigger
language plpgsql
set search_path = pg_catalog, public, storage
as $$
declare
  object_metadata jsonb;
begin
  if tg_op = 'UPDATE' then
    if row(
      new.id, new.variant_id, new.object_path, new.mime_type, new.byte_size,
      new.created_by_employee_profile_id, new.created_at
    ) is distinct from row(
      old.id, old.variant_id, old.object_path, old.mime_type, old.byte_size,
      old.created_by_employee_profile_id, old.created_at
    ) then
      raise exception using
        errcode = '42501',
        message = 'warehouse photo metadata immutable';
    end if;
    return new;
  end if;

  perform 1
  from public.warehouse_variants variant
  where variant.id = new.variant_id
  for update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;

  select object.metadata into object_metadata
  from storage.objects object
  where object.bucket_id = 'warehouse-item-photos'
    and object.name = new.object_path;
  if not found
    or object_metadata->>'mimetype' is distinct from new.mime_type
    or coalesce(object_metadata->>'size', '') !~ '^[0-9]+$'
    or (object_metadata->>'size')::bigint is distinct from new.byte_size
  then
    raise exception using
      errcode = '22023',
      message = 'warehouse photo object invalid',
      hint = 'WAREHOUSE_PHOTO_OBJECT_INVALID';
  end if;

  if (
    select count(*)
    from public.warehouse_variant_photos photo
    where photo.variant_id = new.variant_id
  ) >= 8 then
    raise exception using
      errcode = '55000',
      message = 'warehouse photo limit reached',
      hint = 'WAREHOUSE_PHOTO_LIMIT_REACHED';
  end if;
  return new;
end;
$$;

create trigger enforce_warehouse_variant_photo_invariants
before insert or update on public.warehouse_variant_photos
for each row execute function private.enforce_warehouse_variant_photo_invariants();

revoke all on function private.reject_warehouse_photo_audit_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_warehouse_photo_delete_receipt_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_warehouse_photo_delete_takeover_receipt_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_variant_photo_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.warehouse_variant_photo_list_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_warehouse_variant_photo_invariants()
  from public, anon, authenticated, service_role;

alter table public.warehouse_variant_photos enable row level security;
alter table public.warehouse_photo_audit enable row level security;
alter table public.warehouse_photo_delete_outbox enable row level security;

create policy "warehouse_variant_photos inventory read"
on public.warehouse_variant_photos for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);

revoke all on table public.warehouse_variant_photos
  from public, anon, authenticated;
grant select on table public.warehouse_variant_photos to authenticated;
grant all on table public.warehouse_variant_photos to service_role;
revoke all on table public.warehouse_photo_audit
  from public, anon, authenticated, service_role;
revoke all on sequence public.warehouse_photo_audit_id_seq
  from public, anon, authenticated, service_role;
revoke all on table public.warehouse_photo_delete_outbox
  from public, anon, authenticated, service_role;
revoke all on table private.warehouse_photo_delete_receipts
  from public, anon, authenticated, service_role;
revoke all on table private.warehouse_photo_delete_takeover_receipts
  from public, anon, authenticated, service_role;

create or replace function public.register_warehouse_variant_photo_secure(
  p_variant_id uuid,
  p_object_path text,
  p_mime_type text,
  p_byte_size bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
  existing public.warehouse_variant_photos%rowtype;
  created_id uuid;
  next_order smallint;
  object_owner text;
  object_metadata jsonb;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');

  if p_variant_id is null
    or p_object_path is null
    or p_object_path !~ (
      '^' || p_variant_id::text ||
      '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
    )
  then
    raise exception using
      errcode = '22023', message = 'warehouse photo path invalid',
      hint = 'WAREHOUSE_PHOTO_PATH_INVALID';
  end if;
  if p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_byte_size not between 1 and 2097151
    or (p_mime_type = 'image/jpeg' and right(p_object_path, 4) <> '.jpg')
    or (p_mime_type = 'image/png' and right(p_object_path, 4) <> '.png')
    or (p_mime_type = 'image/webp' and right(p_object_path, 5) <> '.webp')
  then
    raise exception using
      errcode = '22023', message = 'warehouse photo object invalid',
      hint = 'WAREHOUSE_PHOTO_OBJECT_INVALID';
  end if;

  perform 1
  from public.warehouse_variants variant
  where variant.id = p_variant_id and variant.active
  for update;
  if not found then
    raise exception using
      errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;

  if exists (
    select 1 from public.warehouse_photo_delete_outbox pending
    where pending.variant_id = p_variant_id
      and (pending.kind = 'registered' or pending.object_path = p_object_path)
  ) then
    raise exception using
      errcode = '55000', message = 'warehouse photo delete pending',
      hint = 'WAREHOUSE_PHOTO_DELETE_PENDING';
  end if;

  select photo.* into existing
  from public.warehouse_variant_photos photo
  where photo.variant_id = p_variant_id
    and photo.object_path = p_object_path;
  if found then
    if existing.mime_type <> p_mime_type or existing.byte_size <> p_byte_size then
      raise exception using
        errcode = '22023', message = 'warehouse photo object invalid',
        hint = 'WAREHOUSE_PHOTO_OBJECT_INVALID';
    end if;
    return private.warehouse_variant_photo_json(existing.id);
  end if;

  select object.owner_id, object.metadata
    into object_owner, object_metadata
  from storage.objects object
  where object.bucket_id = 'warehouse-item-photos'
    and object.name = p_object_path;
  if not found
    or object_metadata->>'mimetype' is distinct from p_mime_type
    or coalesce(object_metadata->>'size', '') !~ '^[0-9]+$'
    or (object_metadata->>'size')::bigint is distinct from p_byte_size
  then
    raise exception using
      errcode = '22023', message = 'warehouse photo object invalid',
      hint = 'WAREHOUSE_PHOTO_OBJECT_INVALID';
  end if;
  if object_owner is distinct from auth.uid()::text then
    raise exception using
      errcode = '42501', message = 'warehouse photo object not owned',
      hint = 'WAREHOUSE_PHOTO_OBJECT_NOT_OWNED';
  end if;

  select coalesce(max(photo.sort_order) + 1, 0)::smallint into next_order
  from public.warehouse_variant_photos photo
  where photo.variant_id = p_variant_id;
  if next_order >= 8 then
    raise exception using
      errcode = '55000', message = 'warehouse photo limit reached',
      hint = 'WAREHOUSE_PHOTO_LIMIT_REACHED';
  end if;

  insert into public.warehouse_variant_photos(
    variant_id, object_path, sort_order, mime_type, byte_size,
    created_by_employee_profile_id
  ) values (
    p_variant_id, p_object_path, next_order, p_mime_type, p_byte_size, actor_id
  ) returning id into created_id;
  insert into public.warehouse_photo_audit(
    action, photo_id, variant_id, actor_employee_profile_id
  ) values ('registered', created_id, p_variant_id, actor_id);
  return private.warehouse_variant_photo_json(created_id);
end;
$$;

create or replace function public.list_warehouse_variant_photos_secure(
  p_variant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, storage
as $$
begin
  perform 1 from private.assert_warehouse_permission('module.inventory.view');
  if p_variant_id is null or not exists (
    select 1 from public.warehouse_variants variant where variant.id = p_variant_id
  ) then
    raise exception using
      errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;
  return private.warehouse_variant_photo_list_json(p_variant_id);
end;
$$;

create or replace function public.reorder_warehouse_variant_photos_secure(
  p_variant_id uuid,
  p_photo_ids uuid[]
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if p_variant_id is null
    or p_photo_ids is null
    or cardinality(p_photo_ids) not between 1 and 8
    or cardinality(p_photo_ids) <> (
      select count(distinct id) from unnest(p_photo_ids) id
    )
  then
    raise exception using
      errcode = '22023', message = 'warehouse photo order invalid',
      hint = 'WAREHOUSE_PHOTO_ORDER_INVALID';
  end if;
  perform 1
  from public.warehouse_variants variant
  where variant.id = p_variant_id
  for update;
  if not found
    or cardinality(p_photo_ids) <> (
      select count(*)
      from public.warehouse_variant_photos photo
      where photo.variant_id = p_variant_id
    )
    or exists (
      select 1
      from unnest(p_photo_ids) id
      where not exists (
        select 1 from public.warehouse_variant_photos photo
        where photo.variant_id = p_variant_id and photo.id = id
      )
    )
  then
    raise exception using
      errcode = '22023', message = 'warehouse photo order invalid',
      hint = 'WAREHOUSE_PHOTO_ORDER_INVALID';
  end if;

  if exists (
    select 1 from public.warehouse_photo_delete_outbox pending
    where pending.variant_id = p_variant_id and pending.kind = 'registered'
  ) then
    raise exception using
      errcode = '55000', message = 'warehouse photo delete pending',
      hint = 'WAREHOUSE_PHOTO_DELETE_PENDING';
  end if;

  set constraints warehouse_variant_photos_variant_sort_unique deferred;
  update public.warehouse_variant_photos photo
  set sort_order = ordered.ordinality - 1
  from unnest(p_photo_ids) with ordinality ordered(id, ordinality)
  where photo.variant_id = p_variant_id and photo.id = ordered.id;
  insert into public.warehouse_photo_audit(
    action, photo_id, variant_id, actor_employee_profile_id
  )
  select 'reordered', id, p_variant_id, actor_id
  from unnest(p_photo_ids) id;
  return private.warehouse_variant_photo_list_json(p_variant_id);
end;
$$;

create or replace function public.begin_warehouse_variant_photo_delete_secure(
  p_variant_id uuid,
  p_photo_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
  target public.warehouse_variant_photos%rowtype;
  pending public.warehouse_photo_delete_outbox%rowtype;
  storage_deleted boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if p_variant_id is null or p_photo_id is null then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;

  perform 1 from public.warehouse_variants variant
  where variant.id = p_variant_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;
  select photo.* into target from public.warehouse_variant_photos photo
  where photo.id = p_photo_id for update;
  if not found or target.variant_id <> p_variant_id then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;
  perform 1 from storage.objects object
  where object.bucket_id = 'warehouse-item-photos' and object.name = target.object_path
  for update;
  storage_deleted := not found;

  select outbox.* into pending from public.warehouse_photo_delete_outbox outbox
  where outbox.photo_id = p_photo_id or outbox.object_path = target.object_path
  for update;
  if found then
    if pending.requested_by_employee_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'warehouse photo delete owned',
        hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
    end if;
    if pending.kind <> 'registered'
      or pending.variant_id <> p_variant_id
      or pending.photo_id is distinct from p_photo_id
      or pending.object_path <> target.object_path
    then
      raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
        hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
    end if;
  else
    insert into public.warehouse_photo_delete_outbox(
      kind, photo_id, variant_id, object_path,
      original_requested_by_employee_profile_id, requested_by_employee_profile_id
    ) values (
      'registered', p_photo_id, p_variant_id, target.object_path, actor_id, actor_id
    )
    returning * into pending;
    insert into public.warehouse_photo_audit(
      action, photo_id, variant_id, actor_employee_profile_id
    ) values ('delete_pending', p_photo_id, p_variant_id, actor_id);
  end if;

  return jsonb_build_object(
    'deletionId', pending.deletion_id, 'kind', pending.kind,
    'photoId', pending.photo_id, 'variantId', pending.variant_id,
    'objectPath', pending.object_path, 'storageDeleted', storage_deleted
  );
end;
$$;

create or replace function public.begin_warehouse_photo_orphan_delete_secure(
  p_variant_id uuid,
  p_object_path text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
  object_owner text;
  pending public.warehouse_photo_delete_outbox%rowtype;
  storage_deleted boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if p_variant_id is null or p_object_path is null or p_object_path !~ (
    '^' || p_variant_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
  ) then
    raise exception using errcode = '22023', message = 'warehouse photo path invalid',
      hint = 'WAREHOUSE_PHOTO_PATH_INVALID';
  end if;

  perform 1 from public.warehouse_variants variant
  where variant.id = p_variant_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;
  perform 1 from public.warehouse_variant_photos photo
  where photo.object_path = p_object_path for update;
  if found then
    raise exception using errcode = '22023', message = 'warehouse photo orphan invalid',
      hint = 'WAREHOUSE_PHOTO_ORPHAN_INVALID';
  end if;
  select object.owner_id into object_owner from storage.objects object
  where object.bucket_id = 'warehouse-item-photos' and object.name = p_object_path
  for update;
  storage_deleted := not found;

  select outbox.* into pending from public.warehouse_photo_delete_outbox outbox
  where outbox.object_path = p_object_path for update;
  if found then
    if pending.requested_by_employee_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'warehouse photo delete owned',
        hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
    end if;
    if pending.kind <> 'orphan' or pending.variant_id <> p_variant_id or pending.photo_id is not null then
      raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
        hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
    end if;
  else
    if storage_deleted then
      raise exception using errcode = '22023', message = 'warehouse photo object invalid',
        hint = 'WAREHOUSE_PHOTO_OBJECT_INVALID';
    end if;
    if object_owner is distinct from auth.uid()::text then
      raise exception using errcode = '42501', message = 'warehouse photo object not owned',
        hint = 'WAREHOUSE_PHOTO_OBJECT_NOT_OWNED';
    end if;
    insert into public.warehouse_photo_delete_outbox(
      kind, photo_id, variant_id, object_path,
      original_requested_by_employee_profile_id, requested_by_employee_profile_id
    ) values ('orphan', null, p_variant_id, p_object_path, actor_id, actor_id)
    returning * into pending;
  end if;

  return jsonb_build_object(
    'deletionId', pending.deletion_id, 'kind', pending.kind,
    'photoId', pending.photo_id, 'variantId', pending.variant_id,
    'objectPath', pending.object_path, 'storageDeleted', storage_deleted
  );
end;
$$;

create or replace function private.warehouse_employee_has_catalog_manage(
  p_employee_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select coalesce(
    'all' = any(private.employee_effective_permission_keys(p_employee_profile_id))
    or 'warehouse.catalog.manage' = any(
      private.employee_effective_permission_keys(p_employee_profile_id)
    ),
    false
  )
$$;

revoke all on function private.warehouse_employee_has_catalog_manage(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.list_warehouse_photo_delete_candidates_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');

  return (
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'deletionId', pending.deletion_id,
        'kind', pending.kind,
        'createdAt', pending.assigned_at,
        'originalRequesterLabel', original_requester.name
      ) order by pending.assigned_at, pending.deletion_id
    ), '[]'::jsonb)
    from public.warehouse_photo_delete_outbox pending
    join public.employee_profiles original_requester
      on original_requester.id = pending.original_requested_by_employee_profile_id
    where pending.requested_by_employee_profile_id = actor_id
      or (
        pending.requested_by_employee_profile_id <> actor_id
        and (
          not private.warehouse_employee_has_catalog_manage(
            pending.requested_by_employee_profile_id
          )
          or pending.assigned_at <= statement_timestamp() - interval '30 minutes'
        )
      )
  );
end;
$$;

create or replace function public.claim_warehouse_photo_delete_secure(
  p_deletion_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
  preview public.warehouse_photo_delete_outbox%rowtype;
  pending public.warehouse_photo_delete_outbox%rowtype;
  receipt private.warehouse_photo_delete_receipts%rowtype;
  previous_requester_id uuid;
  new_deletion_id uuid;
  takeover_reason text;
  storage_deleted boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if p_deletion_id is null then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;

  select outbox.* into preview
  from public.warehouse_photo_delete_outbox outbox
  where outbox.deletion_id = p_deletion_id;
  if not found then
    select completed.* into receipt
    from private.warehouse_photo_delete_receipts completed
    where completed.deletion_id = p_deletion_id;
    if not found then
      raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
        hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
    end if;
    if receipt.requested_by_employee_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'warehouse photo delete owned',
        hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
    end if;
    if receipt.outcome <> 'finalized' then
      raise exception using errcode = '55000', message = 'warehouse photo delete already cancelled',
        hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
    end if;
    return jsonb_build_object(
      'deletionId', receipt.deletion_id, 'kind', receipt.kind,
      'photoId', receipt.photo_id, 'variantId', receipt.variant_id,
      'objectPath', receipt.object_path, 'storageDeleted', true
    );
  end if;

  perform 1 from public.warehouse_variants variant
  where variant.id = preview.variant_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;
  if preview.photo_id is not null then
    perform 1 from public.warehouse_variant_photos photo
    where photo.id = preview.photo_id for update;
  end if;
  perform 1 from storage.objects object
  where object.bucket_id = 'warehouse-item-photos'
    and object.name = preview.object_path
  for update;
  storage_deleted := not found;

  select outbox.* into pending
  from public.warehouse_photo_delete_outbox outbox
  where outbox.deletion_id = p_deletion_id
  for update;
  if not found
    or pending.variant_id <> preview.variant_id
    or pending.photo_id is distinct from preview.photo_id
    or pending.object_path <> preview.object_path
  then
    raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
      hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
  end if;

  if pending.requested_by_employee_profile_id = actor_id then
    return jsonb_build_object(
      'deletionId', pending.deletion_id, 'kind', pending.kind,
      'photoId', pending.photo_id, 'variantId', pending.variant_id,
      'objectPath', pending.object_path, 'storageDeleted', storage_deleted
    );
  end if;

  if not private.warehouse_employee_has_catalog_manage(
    pending.requested_by_employee_profile_id
  ) then
    takeover_reason := 'requester_unavailable';
  elsif pending.assigned_at <= statement_timestamp() - interval '30 minutes' then
    takeover_reason := 'lease_expired';
  else
    raise exception using errcode = '42501', message = 'warehouse photo delete owned',
      hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
  end if;

  previous_requester_id := pending.requested_by_employee_profile_id;
  new_deletion_id := gen_random_uuid();
  insert into private.warehouse_photo_delete_takeover_receipts(
    old_deletion_id, new_deletion_id,
    original_requested_by_employee_profile_id,
    previous_requested_by_employee_profile_id,
    new_requested_by_employee_profile_id, reason
  ) values (
    pending.deletion_id, new_deletion_id,
    pending.original_requested_by_employee_profile_id,
    previous_requester_id, actor_id, takeover_reason
  );
  update public.warehouse_photo_delete_outbox outbox
  set deletion_id = new_deletion_id,
      requested_by_employee_profile_id = actor_id,
      assigned_at = statement_timestamp()
  where outbox.deletion_id = p_deletion_id
  returning outbox.* into pending;
  if pending.photo_id is not null then
    insert into public.warehouse_photo_audit(
      action, photo_id, variant_id, actor_employee_profile_id
    ) values ('delete_taken_over', pending.photo_id, pending.variant_id, actor_id);
  end if;

  return jsonb_build_object(
    'deletionId', pending.deletion_id, 'kind', pending.kind,
    'photoId', pending.photo_id, 'variantId', pending.variant_id,
    'objectPath', pending.object_path, 'storageDeleted', storage_deleted
  );
end;
$$;

create or replace function public.cancel_warehouse_photo_delete_secure(
  p_deletion_id uuid,
  p_variant_id uuid,
  p_photo_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
  pending public.warehouse_photo_delete_outbox%rowtype;
  receipt private.warehouse_photo_delete_receipts%rowtype;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if p_deletion_id is null or p_variant_id is null then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;
  perform 1 from public.warehouse_variants variant
  where variant.id = p_variant_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;
  if p_photo_id is not null then
    perform 1 from public.warehouse_variant_photos photo
    where photo.id = p_photo_id for update;
  end if;

  select outbox.* into pending from public.warehouse_photo_delete_outbox outbox
  where outbox.deletion_id = p_deletion_id;
  if not found then
    select completed.* into receipt from private.warehouse_photo_delete_receipts completed
    where completed.deletion_id = p_deletion_id;
    if not found then
      raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
        hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
    end if;
    if receipt.requested_by_employee_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'warehouse photo delete owned',
        hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
    end if;
    if receipt.variant_id <> p_variant_id or receipt.photo_id is distinct from p_photo_id then
      raise exception using errcode = '22023', message = 'warehouse photo input invalid',
        hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
    end if;
    if receipt.outcome = 'cancelled' then return true; end if;
    raise exception using errcode = '55000', message = 'warehouse photo delete already finalized',
      hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
  end if;
  if pending.requested_by_employee_profile_id <> actor_id then
    raise exception using errcode = '42501', message = 'warehouse photo delete owned',
      hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
  end if;
  if pending.variant_id <> p_variant_id or pending.photo_id is distinct from p_photo_id then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;

  perform 1 from storage.objects object
  where object.bucket_id = 'warehouse-item-photos' and object.name = pending.object_path
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse photo storage absent',
      hint = 'WAREHOUSE_PHOTO_STORAGE_ABSENT';
  end if;
  select outbox.* into pending from public.warehouse_photo_delete_outbox outbox
  where outbox.deletion_id = p_deletion_id for update;
  if not found or pending.requested_by_employee_profile_id <> actor_id
    or pending.variant_id <> p_variant_id or pending.photo_id is distinct from p_photo_id
  then
    raise exception using errcode = '55000', message = 'warehouse photo delete state changed',
      hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
  end if;

  insert into private.warehouse_photo_delete_receipts(
    deletion_id, kind, photo_id, variant_id, object_path,
    requested_by_employee_profile_id, outcome
  ) values (
    pending.deletion_id, pending.kind, pending.photo_id, pending.variant_id,
    pending.object_path, actor_id, 'cancelled'
  );
  delete from public.warehouse_photo_delete_outbox where deletion_id = p_deletion_id;
  if pending.photo_id is not null then
    insert into public.warehouse_photo_audit(
      action, photo_id, variant_id, actor_employee_profile_id
    ) values ('delete_cancelled', pending.photo_id, pending.variant_id, actor_id);
  end if;
  return true;
end;
$$;

create or replace function public.finalize_warehouse_photo_delete_secure(
  p_deletion_id uuid,
  p_variant_id uuid,
  p_photo_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor_id uuid;
  pending public.warehouse_photo_delete_outbox%rowtype;
  receipt private.warehouse_photo_delete_receipts%rowtype;
  target public.warehouse_variant_photos%rowtype;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.catalog.manage');
  if p_deletion_id is null or p_variant_id is null then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;
  perform 1 from public.warehouse_variants variant
  where variant.id = p_variant_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'warehouse photo variant invalid',
      hint = 'WAREHOUSE_PHOTO_VARIANT_INVALID';
  end if;
  if p_photo_id is not null then
    select photo.* into target from public.warehouse_variant_photos photo
    where photo.id = p_photo_id for update;
  end if;

  select outbox.* into pending from public.warehouse_photo_delete_outbox outbox
  where outbox.deletion_id = p_deletion_id;
  if not found then
    select completed.* into receipt from private.warehouse_photo_delete_receipts completed
    where completed.deletion_id = p_deletion_id;
    if not found then
      raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
        hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
    end if;
    if receipt.requested_by_employee_profile_id <> actor_id then
      raise exception using errcode = '42501', message = 'warehouse photo delete owned',
        hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
    end if;
    if receipt.variant_id <> p_variant_id or receipt.photo_id is distinct from p_photo_id then
      raise exception using errcode = '22023', message = 'warehouse photo input invalid',
        hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
    end if;
    if receipt.outcome = 'finalized' then return true; end if;
    raise exception using errcode = '55000', message = 'warehouse photo delete already cancelled',
      hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
  end if;
  if pending.requested_by_employee_profile_id <> actor_id then
    raise exception using errcode = '42501', message = 'warehouse photo delete owned',
      hint = 'WAREHOUSE_PHOTO_DELETE_OWNED';
  end if;
  if pending.variant_id <> p_variant_id or pending.photo_id is distinct from p_photo_id then
    raise exception using errcode = '22023', message = 'warehouse photo input invalid',
      hint = 'WAREHOUSE_PHOTO_INPUT_INVALID';
  end if;
  if pending.photo_id is not null and (
    target.id is null or target.variant_id <> p_variant_id or target.object_path <> pending.object_path
  ) then
    raise exception using errcode = '22023', message = 'warehouse photo delete state invalid',
      hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
  end if;

  perform 1 from storage.objects object
  where object.bucket_id = 'warehouse-item-photos' and object.name = pending.object_path
  for update;
  if found then
    raise exception using errcode = '55000', message = 'warehouse photo storage present',
      hint = 'WAREHOUSE_PHOTO_STORAGE_PRESENT';
  end if;
  select outbox.* into pending from public.warehouse_photo_delete_outbox outbox
  where outbox.deletion_id = p_deletion_id for update;
  if not found or pending.requested_by_employee_profile_id <> actor_id
    or pending.variant_id <> p_variant_id or pending.photo_id is distinct from p_photo_id
  then
    raise exception using errcode = '55000', message = 'warehouse photo delete state changed',
      hint = 'WAREHOUSE_PHOTO_DELETE_STATE_INVALID';
  end if;

  insert into private.warehouse_photo_delete_receipts(
    deletion_id, kind, photo_id, variant_id, object_path,
    requested_by_employee_profile_id, outcome
  ) values (
    pending.deletion_id, pending.kind, pending.photo_id, pending.variant_id,
    pending.object_path, actor_id, 'finalized'
  );
  if pending.photo_id is not null then
    delete from public.warehouse_variant_photos where id = pending.photo_id;
    set constraints warehouse_variant_photos_variant_sort_unique deferred;
    with ordered as (
      select photo.id,
        row_number() over (order by photo.sort_order, photo.id) - 1 as next_order
      from public.warehouse_variant_photos photo
      where photo.variant_id = p_variant_id
    )
    update public.warehouse_variant_photos photo
    set sort_order = ordered.next_order
    from ordered where photo.id = ordered.id;
    insert into public.warehouse_photo_audit(
      action, photo_id, variant_id, actor_employee_profile_id
    ) values ('deleted', pending.photo_id, pending.variant_id, actor_id);
  end if;
  delete from public.warehouse_photo_delete_outbox where deletion_id = p_deletion_id;
  return true;
end;
$$;

revoke all on function public.register_warehouse_variant_photo_secure(uuid, text, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.list_warehouse_variant_photos_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reorder_warehouse_variant_photos_secure(uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.begin_warehouse_variant_photo_delete_secure(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.begin_warehouse_photo_orphan_delete_secure(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.cancel_warehouse_photo_delete_secure(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_warehouse_photo_delete_secure(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_warehouse_photo_delete_candidates_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_warehouse_photo_delete_secure(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.register_warehouse_variant_photo_secure(uuid, text, text, bigint)
  to authenticated;
grant execute on function public.list_warehouse_variant_photos_secure(uuid)
  to authenticated;
grant execute on function public.reorder_warehouse_variant_photos_secure(uuid, uuid[])
  to authenticated;
grant execute on function public.begin_warehouse_variant_photo_delete_secure(uuid, uuid)
  to authenticated;
grant execute on function public.begin_warehouse_photo_orphan_delete_secure(uuid, text)
  to authenticated;
grant execute on function public.cancel_warehouse_photo_delete_secure(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.finalize_warehouse_photo_delete_secure(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.list_warehouse_photo_delete_candidates_secure()
  to authenticated;
grant execute on function public.claim_warehouse_photo_delete_secure(uuid)
  to authenticated;

create or replace function public.can_current_employee_delete_warehouse_photo_object(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, storage
as $$
  select p_object_path is not null
    and public.is_current_employee_active()
    and public.has_current_permission('warehouse.catalog.manage')
    and exists (
      select 1
      from public.warehouse_photo_delete_outbox outbox
      join public.employee_profiles profile
        on profile.id = outbox.requested_by_employee_profile_id
      where outbox.object_path = p_object_path
        and profile.auth_user_id = auth.uid()
    )
$$;

create or replace function public.is_warehouse_photo_object_delete_pending(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, storage
as $$
  select p_object_path is not null and exists (
    select 1 from public.warehouse_photo_delete_outbox outbox
    where outbox.object_path = p_object_path
  )
    and public.is_current_employee_active()
    and public.has_current_permission('warehouse.catalog.manage')
$$;

create or replace function public.is_active_warehouse_photo_variant_prefix(
  p_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private, storage
as $$
  select p_object_path is not null
    and public.is_current_employee_active()
    and public.has_current_permission('warehouse.catalog.manage')
    and exists (
    select 1 from public.warehouse_variants variant
    where variant.id::text = split_part(p_object_path, '/', 1)
      and variant.active
  )
$$;

revoke all on function public.can_current_employee_delete_warehouse_photo_object(text)
  from public, anon, authenticated, service_role;
revoke all on function public.is_warehouse_photo_object_delete_pending(text)
  from public, anon, authenticated, service_role;
revoke all on function public.is_active_warehouse_photo_variant_prefix(text)
  from public, anon, authenticated, service_role;
grant execute on function public.can_current_employee_delete_warehouse_photo_object(text)
  to authenticated;
grant execute on function public.is_warehouse_photo_object_delete_pending(text)
  to authenticated;
grant execute on function public.is_active_warehouse_photo_variant_prefix(text)
  to authenticated;

drop policy if exists warehouse_item_photos_insert on storage.objects;
drop policy if exists warehouse_item_photos_select on storage.objects;
drop policy if exists warehouse_item_photos_orphan_cleanup_select on storage.objects;
drop policy if exists warehouse_item_photos_pending_delete_select on storage.objects;
drop policy if exists warehouse_item_photos_delete on storage.objects;
drop policy if exists warehouse_item_photos_update_deny on storage.objects;

create policy warehouse_item_photos_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'warehouse-item-photos'
  and owner_id = auth.uid()::text
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$'
  and public.is_current_employee_active()
  and public.has_current_permission('warehouse.catalog.manage')
  and not public.is_warehouse_photo_object_delete_pending(name)
  and public.is_active_warehouse_photo_variant_prefix(name)
);

create policy warehouse_item_photos_select
on storage.objects for select to authenticated
using (
  bucket_id = 'warehouse-item-photos'
  and public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
  and exists (
    select 1 from public.warehouse_variant_photos photo
    where photo.object_path = name
  )
);

create policy warehouse_item_photos_pending_delete_select
on storage.objects for select to authenticated
using (
  bucket_id = 'warehouse-item-photos'
  and current_setting('request.method', true) = 'DELETE'
  and public.can_current_employee_delete_warehouse_photo_object(name)
);

create policy warehouse_item_photos_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'warehouse-item-photos'
  and public.can_current_employee_delete_warehouse_photo_object(name)
);

create policy warehouse_item_photos_update_deny
on storage.objects as restrictive for update to authenticated
using (false)
with check (false);

commit;

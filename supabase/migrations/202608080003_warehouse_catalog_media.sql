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
      || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287)
      || chr(12288) || chr(65279)
    ),
    NFC
  )
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
  if (p_required and result = '') or char_length(result) > p_maximum then
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
set search_path = pg_catalog, public, private
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
  if p_variant_id is null then
    return false;
  end if;

  if receipt_table is not null and receipt_line_table is not null
  then
    execute format(
      'select exists (
        select 1 from %s document
        join %s line on line.receipt_id = document.id
        where document.status = ''pending'' and line.variant_id = $1
      )', receipt_table, receipt_line_table
    ) into found_pending using p_variant_id;
    if found_pending then return true; end if;
  end if;

  if stock_out_table is not null and stock_out_line_table is not null
  then
    execute format(
      'select exists (
        select 1 from %s document
        join %s line on line.request_id = document.id
        where document.status = ''pending'' and line.variant_id = $1
      )', stock_out_table, stock_out_line_table
    ) into found_pending using p_variant_id;
    if found_pending then return true; end if;
  end if;

  if return_table is not null
    and return_line_table is not null
    and stock_out_line_table is not null
  then
    execute format(
      'select exists (
        select 1 from %s document
        join %s return_line on return_line.return_id = document.id
        join %s stock_line on stock_line.id = return_line.original_stock_out_line_id
        where document.status = ''pending'' and stock_line.variant_id = $1
      )', return_table, return_line_table, stock_out_line_table
    ) into found_pending using p_variant_id;
    if found_pending then return true; end if;
  end if;

  return false;
end;
$$;

revoke all on function private.normalize_warehouse_catalog_text(text)
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

  perform pg_advisory_xact_lock(hashtextextended('warehouse-site-id:' || p_site_id::text, 0));
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

  perform pg_advisory_xact_lock(hashtextextended('warehouse-location-id:' || p_location_id::text, 0));
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

  perform pg_advisory_xact_lock(hashtextextended('warehouse-item-id:' || p_item_id::text, 0));
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

  perform pg_advisory_xact_lock(hashtextextended('warehouse-variant-id:' || p_variant_id::text, 0));
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

commit;

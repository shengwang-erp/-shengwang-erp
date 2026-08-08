-- Normalized warehouse catalog, FIFO batch balances, and immutable inventory ledger.
-- This migration is additive, seeds no warehouse data, and exposes no write RPCs.

begin;

create table public.warehouse_sites (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  kind text not null,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint warehouse_sites_code_check check (
    code = regexp_replace(code, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(code) between 1 and 100
  ),
  constraint warehouse_sites_name_check check (
    name = regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(name) between 1 and 200
  ),
  constraint warehouse_sites_kind_check check (
    kind in ('normal', 'project_site', 'shared_tool')
  ),
  constraint warehouse_sites_code_unique unique (code)
);

create table public.warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null,
  shelf_code text not null,
  shelf_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint warehouse_locations_shelf_code_check check (
    shelf_code = regexp_replace(
      shelf_code, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(shelf_code) between 1 and 100
  ),
  constraint warehouse_locations_shelf_name_check check (
    shelf_name = regexp_replace(
      shelf_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(shelf_name) between 1 and 200
  ),
  constraint warehouse_locations_warehouse_fk foreign key (warehouse_id)
    references public.warehouse_sites(id) on delete restrict,
  constraint warehouse_locations_warehouse_shelf_unique
    unique (warehouse_id, shelf_code),
  constraint warehouse_locations_id_warehouse_unique
    unique (id, warehouse_id)
);

create table public.warehouse_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  brand text not null default '',
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint warehouse_items_name_check check (
    name = regexp_replace(name, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(name) between 1 and 300
  ),
  constraint warehouse_items_category_check check (
    category = regexp_replace(category, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(category) <= 200
  ),
  constraint warehouse_items_brand_check check (
    brand = regexp_replace(brand, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(brand) <= 200
  ),
  constraint warehouse_items_description_check check (
    description = regexp_replace(
      description, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(description) <= 2000
  )
);

create table public.warehouse_variants (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null,
  sku text not null,
  model text not null default '',
  size text not null default '',
  material text not null default '',
  unit text not null,
  minimum_stock numeric(18,3) not null default 0,
  default_purchase_price numeric(18,4) not null default 0,
  system_qr text not null,
  manufacturer_qr text,
  active boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint warehouse_variants_sku_check check (
    sku = regexp_replace(sku, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(sku) between 1 and 100
  ),
  constraint warehouse_variants_model_check check (
    model = regexp_replace(model, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(model) <= 300
  ),
  constraint warehouse_variants_size_check check (
    size = regexp_replace(size, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(size) <= 300
  ),
  constraint warehouse_variants_material_check check (
    material = regexp_replace(material, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(material) <= 300
  ),
  constraint warehouse_variants_unit_check check (
    unit = regexp_replace(unit, '^[[:space:]]+|[[:space:]]+$', '', 'g')
    and char_length(unit) between 1 and 50
  ),
  constraint warehouse_variants_minimum_stock_check check (
    minimum_stock >= 0
    and minimum_stock <> 'NaN'::numeric
    and minimum_stock <> 'Infinity'::numeric
    and minimum_stock <> '-Infinity'::numeric
  ),
  constraint warehouse_variants_default_price_check check (
    default_purchase_price >= 0
    and default_purchase_price <> 'NaN'::numeric
    and default_purchase_price <> 'Infinity'::numeric
    and default_purchase_price <> '-Infinity'::numeric
  ),
  constraint warehouse_variants_system_qr_check check (
    system_qr = regexp_replace(
      system_qr, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(system_qr) between 15 and 500
    and lower(system_qr) like 'swerp:variant:%'
    and substring(
      system_qr from char_length('SWERP:VARIANT:') + 1
    ) ~ '[^[:space:]]'
  ),
  constraint warehouse_variants_manufacturer_qr_check check (
    manufacturer_qr is null
    or (
      manufacturer_qr = regexp_replace(
        manufacturer_qr, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(manufacturer_qr) between 1 and 500
      and lower(manufacturer_qr) not like 'swerp:variant:%'
    )
  ),
  constraint warehouse_variants_item_fk foreign key (item_id)
    references public.warehouse_items(id) on delete restrict,
  constraint warehouse_variants_sku_unique unique (sku),
  constraint warehouse_variants_system_qr_unique unique (system_qr)
);

create unique index warehouse_variants_manufacturer_qr_ci_unique
  on public.warehouse_variants(lower(manufacturer_qr))
  where manufacturer_qr is not null;
create index warehouse_variants_item_active_idx
  on public.warehouse_variants(item_id, active, sku, id);

create table public.warehouse_batches (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null,
  receipt_line_id uuid,
  received_at timestamptz not null,
  unit_cost numeric(18,4) not null,
  original_quantity numeric(18,3) not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint warehouse_batches_unit_cost_check check (
    unit_cost >= 0
    and unit_cost <> 'NaN'::numeric
    and unit_cost <> 'Infinity'::numeric
    and unit_cost <> '-Infinity'::numeric
  ),
  constraint warehouse_batches_original_quantity_check check (
    original_quantity > 0
    and original_quantity <> 'NaN'::numeric
    and original_quantity <> 'Infinity'::numeric
    and original_quantity <> '-Infinity'::numeric
  ),
  constraint warehouse_batches_variant_fk foreign key (variant_id)
    references public.warehouse_variants(id) on delete restrict,
  constraint warehouse_batches_id_variant_unique unique (id, variant_id)
);

create index warehouse_batches_variant_received_idx
  on public.warehouse_batches(variant_id, received_at, id);
create index warehouse_batches_receipt_line_idx
  on public.warehouse_batches(receipt_line_id)
  where receipt_line_id is not null;

create table public.warehouse_batch_locations (
  batch_id uuid not null,
  location_id uuid not null,
  quantity numeric(18,3) not null default 0,
  updated_at timestamptz not null default statement_timestamp(),
  constraint warehouse_batch_locations_quantity_check check (
    quantity >= 0
    and quantity <> 'NaN'::numeric
    and quantity <> 'Infinity'::numeric
    and quantity <> '-Infinity'::numeric
  ),
  constraint warehouse_batch_locations_batch_fk foreign key (batch_id)
    references public.warehouse_batches(id) on delete restrict,
  constraint warehouse_batch_locations_location_fk foreign key (location_id)
    references public.warehouse_locations(id) on delete restrict,
  constraint warehouse_batch_locations_pkey primary key (batch_id, location_id)
);

create index warehouse_batch_locations_location_idx
  on public.warehouse_batch_locations(location_id, batch_id);

create table public.warehouse_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  movement_type text not null,
  variant_id uuid not null,
  batch_id uuid,
  warehouse_id uuid not null,
  location_id uuid not null,
  quantity_delta numeric(18,3) not null,
  unit_cost numeric(18,4) not null,
  source_document_type text not null,
  source_document_id text not null,
  idempotency_key text not null,
  project_id text,
  destination_type text,
  destination_id text,
  destination_name text,
  operator_employee_profile_id uuid not null,
  occurred_at timestamptz not null,
  reversal_of_movement_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  constraint warehouse_movements_type_check check (
    movement_type in (
      '采购入库', '项目出库', '项目退回', '调拨出库', '调拨入库',
      '盘盈', '盘亏', '盘点无差异', '损坏', '报废', '冲销'
    )
  ),
  constraint warehouse_movements_variant_fk foreign key (variant_id)
    references public.warehouse_variants(id) on delete restrict,
  constraint warehouse_movements_warehouse_fk foreign key (warehouse_id)
    references public.warehouse_sites(id) on delete restrict,
  constraint warehouse_movements_batch_variant_fk foreign key (batch_id, variant_id)
    references public.warehouse_batches(id, variant_id) on delete restrict,
  constraint warehouse_movements_location_warehouse_fk foreign key (location_id, warehouse_id)
    references public.warehouse_locations(id, warehouse_id) on delete restrict,
  constraint warehouse_movements_project_fk foreign key (project_id)
    references public.projects(record_key) on delete restrict,
  constraint warehouse_movements_operator_fk foreign key (operator_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_movements_quantity_check check (
    quantity_delta <> 'NaN'::numeric
    and quantity_delta <> 'Infinity'::numeric
    and quantity_delta <> '-Infinity'::numeric
  ),
  constraint warehouse_movements_unit_cost_check check (
    unit_cost >= 0
    and unit_cost <> 'NaN'::numeric
    and unit_cost <> 'Infinity'::numeric
    and unit_cost <> '-Infinity'::numeric
  ),
  constraint warehouse_movements_source_type_check check (
    source_document_type = regexp_replace(
      source_document_type, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(source_document_type) between 1 and 100
  ),
  constraint warehouse_movements_source_id_check check (
    source_document_id = regexp_replace(
      source_document_id, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(source_document_id) between 1 and 300
  ),
  constraint warehouse_movements_idempotency_check check (
    idempotency_key = regexp_replace(
      idempotency_key, '^[[:space:]]+|[[:space:]]+$', '', 'g'
    )
    and char_length(idempotency_key) between 1 and 300
  ),
  constraint warehouse_movements_destination_type_check check (
    destination_type is null
    or (
      destination_type = regexp_replace(
        destination_type, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(destination_type) between 1 and 100
    )
  ),
  constraint warehouse_movements_destination_id_check check (
    destination_id is null
    or (
      destination_id = regexp_replace(
        destination_id, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(destination_id) between 1 and 300
    )
  ),
  constraint warehouse_movements_destination_name_check check (
    destination_name is null
    or (
      destination_name = regexp_replace(
        destination_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(destination_name) between 1 and 300
    )
  ),
  constraint warehouse_movements_metadata_check check (
    jsonb_typeof(metadata) = 'object'
  ),
  constraint warehouse_movements_reversal_self_check check (
    reversal_of_movement_id is null or reversal_of_movement_id <> id
  ),
  constraint warehouse_movements_reversal_shape_check check (
    (movement_type = '冲销' and reversal_of_movement_id is not null)
    or (movement_type <> '冲销' and reversal_of_movement_id is null)
  ),
  constraint warehouse_movements_reversal_fk foreign key (reversal_of_movement_id)
    references public.warehouse_inventory_movements(id) on delete restrict
);

create unique index warehouse_movements_idempotency_unique
  on public.warehouse_inventory_movements(idempotency_key);
create unique index warehouse_movements_reversal_unique
  on public.warehouse_inventory_movements(reversal_of_movement_id)
  where reversal_of_movement_id is not null;
create index warehouse_movements_variant_location_time_idx
  on public.warehouse_inventory_movements(
    variant_id, location_id, occurred_at desc, id
  );
create index warehouse_movements_warehouse_time_idx
  on public.warehouse_inventory_movements(warehouse_id, occurred_at desc, id);
create index warehouse_movements_batch_time_idx
  on public.warehouse_inventory_movements(batch_id, occurred_at desc, id)
  where batch_id is not null;
create index warehouse_movements_source_document_idx
  on public.warehouse_inventory_movements(
    source_document_type, source_document_id, occurred_at desc, id
  );
create index warehouse_movements_project_time_idx
  on public.warehouse_inventory_movements(project_id, occurred_at desc, id)
  where project_id is not null;

create trigger set_warehouse_sites_updated_at
before update on public.warehouse_sites
for each row execute function public.set_updated_at();
create trigger set_warehouse_locations_updated_at
before update on public.warehouse_locations
for each row execute function public.set_updated_at();
create trigger set_warehouse_items_updated_at
before update on public.warehouse_items
for each row execute function public.set_updated_at();
create trigger set_warehouse_variants_updated_at
before update on public.warehouse_variants
for each row execute function public.set_updated_at();
create trigger set_warehouse_batch_locations_updated_at
before update on public.warehouse_batch_locations
for each row execute function public.set_updated_at();

create or replace function private.reject_warehouse_movement_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'warehouse inventory movements are immutable';
end;
$$;

revoke all on function private.reject_warehouse_movement_mutation()
  from public, anon, authenticated, service_role;

create trigger reject_warehouse_movement_mutation
before update or delete on public.warehouse_inventory_movements
for each row execute function private.reject_warehouse_movement_mutation();

create or replace function private.assert_warehouse_permission(p_permission_key text)
returns table(employee_profile_id uuid, employee_name text)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  employee public.employee_profiles%rowtype;
begin
  select profile.*
    into employee
    from public.employee_profiles as profile
    where profile.auth_user_id = auth.uid()
      and profile.deleted_at is null;

  if not found
    or employee.employment_status <> '在职'
    or employee.account_status <> 'active'
    or employee.must_change_password <> false
  then
    raise exception using errcode = '42501', message = 'active employee required';
  end if;

  if p_permission_key is null
    or p_permission_key <> btrim(p_permission_key)
    or p_permission_key = ''
    or not public.has_current_permission(p_permission_key)
  then
    raise exception using errcode = '42501', message = 'warehouse permission required';
  end if;

  return query select employee.id, employee.name;
end;
$$;

revoke all on function private.assert_warehouse_permission(text)
  from public, anon, authenticated, service_role;

alter table public.warehouse_sites enable row level security;
alter table public.warehouse_locations enable row level security;
alter table public.warehouse_items enable row level security;
alter table public.warehouse_variants enable row level security;
alter table public.warehouse_batches enable row level security;
alter table public.warehouse_batch_locations enable row level security;
alter table public.warehouse_inventory_movements enable row level security;

create policy "warehouse_sites inventory read"
on public.warehouse_sites for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);
create policy "warehouse_locations inventory read"
on public.warehouse_locations for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);
create policy "warehouse_items inventory read"
on public.warehouse_items for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);
create policy "warehouse_variants inventory read"
on public.warehouse_variants for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);
create policy "warehouse_batches inventory read"
on public.warehouse_batches for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);
create policy "warehouse_batch_locations inventory read"
on public.warehouse_batch_locations for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);
create policy "warehouse_movements inventory read"
on public.warehouse_inventory_movements for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.inventory.view')
);

revoke all on table public.warehouse_sites from public, anon, authenticated;
revoke all on table public.warehouse_locations from public, anon, authenticated;
revoke all on table public.warehouse_items from public, anon, authenticated;
revoke all on table public.warehouse_variants from public, anon, authenticated;
revoke all on table public.warehouse_batches from public, anon, authenticated;
revoke all on table public.warehouse_batch_locations from public, anon, authenticated;
revoke all on table public.warehouse_inventory_movements from public, anon, authenticated;

grant select on table public.warehouse_sites to authenticated;
grant select on table public.warehouse_locations to authenticated;
grant select on table public.warehouse_items to authenticated;
grant select (
  id, item_id, sku, model, size, material, unit, minimum_stock,
  system_qr, manufacturer_qr, active, created_at, updated_at
) on table public.warehouse_variants to authenticated;
grant select (
  id, variant_id, receipt_line_id, received_at, original_quantity, created_at
) on table public.warehouse_batches to authenticated;
grant select on table public.warehouse_batch_locations to authenticated;
grant select (
  id, movement_type, variant_id, batch_id, warehouse_id, location_id,
  quantity_delta, source_document_type, source_document_id, idempotency_key,
  project_id, destination_type, destination_id, destination_name,
  operator_employee_profile_id, occurred_at, reversal_of_movement_id, metadata
) on table public.warehouse_inventory_movements to authenticated;

grant all on table public.warehouse_sites to service_role;
grant all on table public.warehouse_locations to service_role;
grant all on table public.warehouse_items to service_role;
grant all on table public.warehouse_variants to service_role;
grant all on table public.warehouse_batches to service_role;
grant all on table public.warehouse_batch_locations to service_role;
revoke all on table public.warehouse_inventory_movements from service_role;
grant select, insert on table public.warehouse_inventory_movements to service_role;

create or replace function public.list_warehouse_catalog_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_view_cost boolean;
begin
  perform 1
  from private.assert_warehouse_permission('module.inventory.view');

  v_view_cost := public.has_current_permission('warehouse.cost.view');

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', item.id,
          'name', item.name,
          'category', item.category,
          'brand', item.brand,
          'description', item.description,
          'active', item.active,
          'createdAt', item.created_at,
          'updatedAt', item.updated_at
        )
        order by lower(item.name), item.name, item.id
      )
      from public.warehouse_items as item
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(
        jsonb_build_object(
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
        ) || case
          when v_view_cost then jsonb_build_object(
            'defaultPurchasePrice', variant.default_purchase_price
          )
          else '{}'::jsonb
        end
        order by variant.sku, variant.id
      )
      from public.warehouse_variants as variant
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_warehouse_locations_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform 1
  from private.assert_warehouse_permission('module.inventory.view');

  return jsonb_build_object(
    'sites', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', site.id,
          'code', site.code,
          'name', site.name,
          'kind', site.kind,
          'active', site.active,
          'createdAt', site.created_at,
          'updatedAt', site.updated_at
        )
        order by site.code, site.id
      )
      from public.warehouse_sites as site
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', location.id,
          'warehouseId', location.warehouse_id,
          'shelfCode', location.shelf_code,
          'shelfName', location.shelf_name,
          'active', location.active,
          'createdAt', location.created_at,
          'updatedAt', location.updated_at
        )
        order by site.code, site.id, location.shelf_code, location.id
      )
      from public.warehouse_locations as location
      join public.warehouse_sites as site on site.id = location.warehouse_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_warehouse_balances_secure(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_variant_id uuid;
  v_warehouse_id uuid;
  v_location_id uuid;
  v_page integer := 1;
  v_page_size integer := 100;
  v_offset bigint;
  v_view_cost boolean;
begin
  perform 1
  from private.assert_warehouse_permission('module.inventory.view');

  begin
    if p_filters is null
      or jsonb_typeof(p_filters) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(p_filters) as filter_key(key)
        where filter_key.key not in (
          'variantId', 'warehouseId', 'locationId', 'page', 'pageSize'
        )
      )
    then
      raise exception using errcode = '22023';
    end if;

    if p_filters ? 'variantId' then
      if jsonb_typeof(p_filters->'variantId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_variant_id := (p_filters->>'variantId')::uuid;
    end if;
    if p_filters ? 'warehouseId' then
      if jsonb_typeof(p_filters->'warehouseId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_warehouse_id := (p_filters->>'warehouseId')::uuid;
    end if;
    if p_filters ? 'locationId' then
      if jsonb_typeof(p_filters->'locationId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_location_id := (p_filters->>'locationId')::uuid;
    end if;
    if p_filters ? 'page' then
      if jsonb_typeof(p_filters->'page') <> 'number'
        or (p_filters->>'page')::numeric <> trunc((p_filters->>'page')::numeric)
      then
        raise exception using errcode = '22023';
      end if;
      v_page := (p_filters->>'page')::integer;
    end if;
    if p_filters ? 'pageSize' then
      if jsonb_typeof(p_filters->'pageSize') <> 'number'
        or (p_filters->>'pageSize')::numeric <> trunc((p_filters->>'pageSize')::numeric)
      then
        raise exception using errcode = '22023';
      end if;
      v_page_size := (p_filters->>'pageSize')::integer;
    end if;
    if v_page < 1 or v_page_size < 1 or v_page_size > 500 then
      raise exception using errcode = '22023';
    end if;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'invalid warehouse balance filters';
  end;

  v_offset := (v_page::bigint - 1) * v_page_size::bigint;
  v_view_cost := public.has_current_permission('warehouse.cost.view');

  return coalesce((
    with balance_rows as (
      select
        variant.id as variant_id,
        variant.sku,
        site.id as warehouse_id,
        site.code as warehouse_code,
        location.id as location_id,
        location.shelf_code,
        sum(balance.quantity)::numeric(18,3) as quantity,
        case when sum(balance.quantity) > 0 then
          (sum(balance.quantity * batch.unit_cost) / sum(balance.quantity))::numeric(18,4)
        else 0::numeric(18,4)
        end as unit_cost,
        sum(balance.quantity * batch.unit_cost)::numeric(18,4) as stock_value
      from public.warehouse_batch_locations as balance
      join public.warehouse_batches as batch on batch.id = balance.batch_id
      join public.warehouse_variants as variant on variant.id = batch.variant_id
      join public.warehouse_locations as location on location.id = balance.location_id
      join public.warehouse_sites as site on site.id = location.warehouse_id
      where (v_variant_id is null or variant.id = v_variant_id)
        and (v_warehouse_id is null or site.id = v_warehouse_id)
        and (v_location_id is null or location.id = v_location_id)
      group by
        variant.id, variant.sku, site.id, site.code,
        location.id, location.shelf_code
    ), paged as (
      select *
      from balance_rows
      order by
        sku, variant_id, warehouse_code, warehouse_id, shelf_code, location_id
      limit v_page_size offset v_offset
    )
    select jsonb_agg(
      jsonb_build_object(
        'variantId', row.variant_id,
        'warehouseId', row.warehouse_id,
        'locationId', row.location_id,
        'quantity', row.quantity
      ) || case
        when v_view_cost then jsonb_build_object(
          'unitCost', row.unit_cost,
          'stockValue', row.stock_value
        )
        else '{}'::jsonb
      end
      order by
        row.sku, row.variant_id, row.warehouse_code,
        row.warehouse_id, row.shelf_code, row.location_id
    )
    from paged as row
  ), '[]'::jsonb);
end;
$$;

create or replace function public.list_warehouse_movements_secure(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_variant_id uuid;
  v_warehouse_id uuid;
  v_location_id uuid;
  v_project_id text;
  v_movement_type text;
  v_occurred_from timestamptz;
  v_occurred_to timestamptz;
  v_page integer := 1;
  v_page_size integer := 100;
  v_offset bigint;
  v_view_cost boolean;
begin
  perform 1
  from private.assert_warehouse_permission('module.inventory.view');

  begin
    if p_filters is null
      or jsonb_typeof(p_filters) <> 'object'
      or exists (
        select 1
        from jsonb_object_keys(p_filters) as filter_key(key)
        where filter_key.key not in (
          'variantId', 'warehouseId', 'locationId', 'projectId',
          'movementType', 'occurredFrom', 'occurredTo', 'page', 'pageSize'
        )
      )
    then
      raise exception using errcode = '22023';
    end if;

    if p_filters ? 'variantId' then
      if jsonb_typeof(p_filters->'variantId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_variant_id := (p_filters->>'variantId')::uuid;
    end if;
    if p_filters ? 'warehouseId' then
      if jsonb_typeof(p_filters->'warehouseId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_warehouse_id := (p_filters->>'warehouseId')::uuid;
    end if;
    if p_filters ? 'locationId' then
      if jsonb_typeof(p_filters->'locationId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_location_id := (p_filters->>'locationId')::uuid;
    end if;
    if p_filters ? 'projectId' then
      if jsonb_typeof(p_filters->'projectId') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_project_id := p_filters->>'projectId';
      if v_project_id = ''
        or v_project_id <> btrim(v_project_id)
        or char_length(v_project_id) > 300
      then
        raise exception using errcode = '22023';
      end if;
    end if;
    if p_filters ? 'movementType' then
      if jsonb_typeof(p_filters->'movementType') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_movement_type := p_filters->>'movementType';
      if v_movement_type not in (
        '采购入库', '项目出库', '项目退回', '调拨出库', '调拨入库',
        '盘盈', '盘亏', '盘点无差异', '损坏', '报废', '冲销'
      ) then
        raise exception using errcode = '22023';
      end if;
    end if;
    if p_filters ? 'occurredFrom' then
      if jsonb_typeof(p_filters->'occurredFrom') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_occurred_from := (p_filters->>'occurredFrom')::timestamptz;
      if not isfinite(v_occurred_from) then
        raise exception using errcode = '22023';
      end if;
    end if;
    if p_filters ? 'occurredTo' then
      if jsonb_typeof(p_filters->'occurredTo') <> 'string' then
        raise exception using errcode = '22023';
      end if;
      v_occurred_to := (p_filters->>'occurredTo')::timestamptz;
      if not isfinite(v_occurred_to) then
        raise exception using errcode = '22023';
      end if;
    end if;
    if p_filters ? 'page' then
      if jsonb_typeof(p_filters->'page') <> 'number'
        or (p_filters->>'page')::numeric <> trunc((p_filters->>'page')::numeric)
      then
        raise exception using errcode = '22023';
      end if;
      v_page := (p_filters->>'page')::integer;
    end if;
    if p_filters ? 'pageSize' then
      if jsonb_typeof(p_filters->'pageSize') <> 'number'
        or (p_filters->>'pageSize')::numeric <> trunc((p_filters->>'pageSize')::numeric)
      then
        raise exception using errcode = '22023';
      end if;
      v_page_size := (p_filters->>'pageSize')::integer;
    end if;
    if v_page < 1
      or v_page_size < 1
      or v_page_size > 500
      or (
        v_occurred_from is not null
        and v_occurred_to is not null
        and v_occurred_from > v_occurred_to
      )
    then
      raise exception using errcode = '22023';
    end if;
  exception when others then
    raise exception using
      errcode = '22023',
      message = 'invalid warehouse movement filters';
  end;

  v_offset := (v_page::bigint - 1) * v_page_size::bigint;
  v_view_cost := public.has_current_permission('warehouse.cost.view');

  return coalesce((
    with paged as (
      select movement.*
      from public.warehouse_inventory_movements as movement
      where (v_variant_id is null or movement.variant_id = v_variant_id)
        and (v_warehouse_id is null or movement.warehouse_id = v_warehouse_id)
        and (v_location_id is null or movement.location_id = v_location_id)
        and (v_project_id is null or movement.project_id = v_project_id)
        and (v_movement_type is null or movement.movement_type = v_movement_type)
        and (v_occurred_from is null or movement.occurred_at >= v_occurred_from)
        and (v_occurred_to is null or movement.occurred_at <= v_occurred_to)
      order by movement.occurred_at desc, movement.id desc
      limit v_page_size offset v_offset
    )
    select jsonb_agg(
      jsonb_build_object(
        'id', movement.id,
        'movementType', movement.movement_type,
        'variantId', movement.variant_id,
        'batchId', movement.batch_id,
        'warehouseId', movement.warehouse_id,
        'locationId', movement.location_id,
        'quantityDelta', movement.quantity_delta,
        'sourceDocumentType', movement.source_document_type,
        'sourceDocumentId', movement.source_document_id,
        'projectId', movement.project_id,
        'destinationType', movement.destination_type,
        'destinationId', movement.destination_id,
        'destinationName', movement.destination_name,
        'operatorEmployeeProfileId', movement.operator_employee_profile_id,
        'occurredAt', movement.occurred_at,
        'reversalOfMovementId', movement.reversal_of_movement_id,
        'metadata', movement.metadata
      ) || case
        when v_view_cost then jsonb_build_object('unitCost', movement.unit_cost)
        else '{}'::jsonb
      end
      order by movement.occurred_at desc, movement.id desc
    )
    from paged as movement
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_warehouse_catalog_secure()
  from public, anon, service_role;
revoke all on function public.list_warehouse_locations_secure()
  from public, anon, service_role;
revoke all on function public.list_warehouse_balances_secure(jsonb)
  from public, anon, service_role;
revoke all on function public.list_warehouse_movements_secure(jsonb)
  from public, anon, service_role;

grant execute on function public.list_warehouse_catalog_secure()
  to authenticated;
grant execute on function public.list_warehouse_locations_secure()
  to authenticated;
grant execute on function public.list_warehouse_balances_secure(jsonb)
  to authenticated;
grant execute on function public.list_warehouse_movements_secure(jsonb)
  to authenticated;

commit;

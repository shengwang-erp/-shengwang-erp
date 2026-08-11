-- Future-company external billing lines. Internal project costs remain in the
-- authoritative project-cost ledger and are never copied into these tables.

create table public.miraisya_billing_headers (
  project_id text primary key
    references public.projects(record_key) on update cascade on delete restrict,
  version bigint not null default 1 check (version >= 1),
  updated_by_employee_id text not null,
  updated_by_employee_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.miraisya_billing_items (
  id uuid primary key default gen_random_uuid(),
  project_id text not null
    references public.miraisya_billing_headers(project_id)
    on update cascade on delete cascade,
  sort_order integer not null check (sort_order >= 1 and sort_order <= 500),
  item_name text not null check (btrim(item_name) <> '' and length(item_name) <= 200),
  description text not null default '' check (length(description) <= 1000),
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null check (btrim(unit) <> '' and length(unit) <= 50),
  unit_price bigint not null check (unit_price >= 0 and unit_price <= 9007199254740991),
  tax_rate smallint not null check (tax_rate in (0, 10)),
  created_at timestamptz not null default clock_timestamp(),
  unique (project_id, sort_order)
);

alter table public.miraisya_billing_headers enable row level security;
alter table public.miraisya_billing_items enable row level security;
revoke all on table public.miraisya_billing_headers from public, anon, authenticated;
revoke all on table public.miraisya_billing_items from public, anon, authenticated;
grant all on table public.miraisya_billing_headers to service_role;
grant all on table public.miraisya_billing_items to service_role;

create or replace function private.assert_miraisya_project(
  p_project_id text,
  p_lock boolean default false
)
returns public.projects
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  project public.projects%rowtype;
begin
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception using errcode = '22023', message = 'project id is required';
  end if;
  if p_lock then
    select row_value.*
      into project
      from public.projects as row_value
      where row_value.record_key = p_project_id
        and row_value.status = 'active'
      for update;
  else
    select row_value.*
      into project
      from public.projects as row_value
      where row_value.record_key = p_project_id
        and row_value.status = 'active';
  end if;
  if not found or coalesce(project.payload->>'projectType', 'standard') <> 'miraisya' then
    raise exception using errcode = '22023', message = 'Miraisya project required';
  end if;
  return project;
end;
$$;

create or replace function private.miraisya_billing_snapshot(p_project_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with header as (
    select billing.version, billing.updated_at
    from public.miraisya_billing_headers as billing
    where billing.project_id = p_project_id
  ), lines as (
    select
      item.sort_order,
      item.item_name,
      item.description,
      item.quantity,
      item.unit,
      item.unit_price,
      item.tax_rate,
      pg_catalog.round(item.quantity * item.unit_price)::bigint as line_amount
    from public.miraisya_billing_items as item
    where item.project_id = p_project_id
    order by item.sort_order
  ), totals as (
    select
      coalesce(sum(line.line_amount), 0)::bigint as tax_exclusive_amount,
      coalesce(sum(case when line.tax_rate = 10
        then pg_catalog.round(line.line_amount * 0.1)::bigint else 0 end), 0)::bigint
        as tax_amount
    from lines as line
  )
  select jsonb_build_object(
    'projectId', p_project_id,
    'version', coalesce((select header.version from header), 1),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'itemName', line.item_name,
        'description', line.description,
        'quantity', line.quantity,
        'unit', line.unit,
        'unitPrice', line.unit_price,
        'taxRate', line.tax_rate
      ) order by line.sort_order)
      from lines as line
    ), '[]'::jsonb),
    'taxExclusiveAmount', totals.tax_exclusive_amount,
    'taxAmount', totals.tax_amount,
    'taxInclusiveAmount', totals.tax_exclusive_amount + totals.tax_amount,
    'updatedAt', coalesce(
      (select header.updated_at from header),
      (select project.updated_at from public.projects as project
        where project.record_key = p_project_id)
    )
  )
  from totals;
$$;

create or replace function public.get_miraisya_billing_secure(p_project_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.view')
  then
    raise exception using
      errcode = '42501', message = 'billing access denied',
      hint = 'MIRAISYA_BILLING_ACCESS_DENIED';
  end if;
  perform private.assert_miraisya_project(p_project_id, false);
  return private.miraisya_billing_snapshot(p_project_id);
end;
$$;

create or replace function public.replace_miraisya_billing_secure(
  p_project_id text,
  p_expected_version bigint,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  current_version bigint;
  item jsonb;
  item_index integer := 0;
begin
  if not private.current_employee_can_mutate_typed_project('update') then
    raise exception using
      errcode = '42501', message = 'billing access denied',
      hint = 'MIRAISYA_BILLING_ACCESS_DENIED';
  end if;
  if p_expected_version is null or p_expected_version < 1
    or jsonb_typeof(p_items) is distinct from 'array'
    or jsonb_array_length(p_items) < 1
    or jsonb_array_length(p_items) > 500
  then
    raise exception using errcode = '22023', message = 'invalid billing request';
  end if;

  perform private.assert_miraisya_project(p_project_id, true);
  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false;

  for item in select entry.value from jsonb_array_elements(p_items) as entry(value)
  loop
    item_index := item_index + 1;
    if jsonb_typeof(item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(item)) <> 6
      or exists (
        select 1 from jsonb_object_keys(item) as key_name
        where key_name not in (
          'itemName', 'description', 'quantity', 'unit', 'unitPrice', 'taxRate'
        )
      )
      or jsonb_typeof(item->'itemName') is distinct from 'string'
      or btrim(item->>'itemName') = ''
      or length(item->>'itemName') > 200
      or jsonb_typeof(item->'description') is distinct from 'string'
      or length(item->>'description') > 1000
      or jsonb_typeof(item->'quantity') is distinct from 'number'
      or (item->>'quantity')::numeric <= 0
      or (item->>'quantity')::numeric > 9999999999.9999
      or (item->>'quantity')::numeric <> round((item->>'quantity')::numeric, 4)
      or jsonb_typeof(item->'unit') is distinct from 'string'
      or btrim(item->>'unit') = ''
      or length(item->>'unit') > 50
      or jsonb_typeof(item->'unitPrice') is distinct from 'number'
      or (item->>'unitPrice')::numeric < 0
      or (item->>'unitPrice')::numeric > 9007199254740991
      or (item->>'unitPrice')::numeric <> trunc((item->>'unitPrice')::numeric)
      or jsonb_typeof(item->'taxRate') is distinct from 'number'
      or (item->>'taxRate')::numeric not in (0, 10)
    then
      raise exception using errcode = '22023', message = 'invalid billing item';
    end if;
  end loop;

  insert into public.miraisya_billing_headers (
    project_id, version, updated_by_employee_id, updated_by_employee_name
  ) values (
    p_project_id, 1, actor.id::text, actor.name
  ) on conflict (project_id) do nothing;

  select header.version
    into current_version
    from public.miraisya_billing_headers as header
    where header.project_id = p_project_id
    for update;
  if current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'billing version conflict',
      hint = 'MIRAISYA_BILLING_VERSION_CONFLICT';
  end if;

  delete from public.miraisya_billing_items as existing
    where existing.project_id = p_project_id;
  insert into public.miraisya_billing_items (
    project_id, sort_order, item_name, description,
    quantity, unit, unit_price, tax_rate
  )
  select
    p_project_id,
    entry.ordinality::integer,
    btrim(entry.value->>'itemName'),
    btrim(entry.value->>'description'),
    (entry.value->>'quantity')::numeric,
    btrim(entry.value->>'unit'),
    (entry.value->>'unitPrice')::bigint,
    (entry.value->>'taxRate')::smallint
  from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality);

  update public.miraisya_billing_headers as header
    set version = header.version + 1,
        updated_by_employee_id = actor.id::text,
        updated_by_employee_name = actor.name,
        updated_at = clock_timestamp()
    where header.project_id = p_project_id;

  return private.miraisya_billing_snapshot(p_project_id);
end;
$$;

revoke all on function private.assert_miraisya_project(text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.miraisya_billing_snapshot(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_miraisya_billing_secure(text)
  from public, anon, authenticated, service_role;
revoke all on function public.replace_miraisya_billing_secure(text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.get_miraisya_billing_secure(text)
  to authenticated, service_role;
grant execute on function public.replace_miraisya_billing_secure(text, bigint, jsonb)
  to authenticated, service_role;

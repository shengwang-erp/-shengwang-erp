-- Immutable monthly settlement snapshots for 株式会社未来舎サポート.
-- Draft/confirm/void are the only mutation paths; voiding releases projects
-- for a replacement settlement without deleting the original audit snapshot.

create table public.miraisya_monthly_settlements (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique
    check (invoice_no ~ '^MIRAI-[0-9]{6}-[0-9]{3}$'),
  settlement_month text not null
    check (settlement_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  issue_date date not null,
  sequence_no integer not null check (sequence_no between 1 and 999),
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'voided')),
  version bigint not null default 1 check (version >= 1),
  tax_exclusive_amount bigint not null default 0 check (tax_exclusive_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  tax_inclusive_amount bigint not null default 0 check (tax_inclusive_amount >= 0),
  total_cost_amount numeric(20,4) not null default 0,
  margin_amount numeric(20,4) not null default 0,
  created_by_employee_id uuid not null references public.employee_profiles(id),
  created_by_employee_name text not null,
  created_at timestamptz not null default clock_timestamp(),
  confirmed_by_employee_id uuid references public.employee_profiles(id),
  confirmed_by_employee_name text,
  confirmed_at timestamptz,
  voided_by_employee_id uuid references public.employee_profiles(id),
  voided_by_employee_name text,
  voided_at timestamptz,
  void_reason text,
  unique (settlement_month, sequence_no),
  check (tax_exclusive_amount + tax_amount = tax_inclusive_amount),
  check (margin_amount = tax_exclusive_amount - total_cost_amount),
  check (
    (status = 'draft' and confirmed_at is null and voided_at is null)
    or (status = 'confirmed' and confirmed_at is not null and voided_at is null)
    or (status = 'voided' and voided_at is not null and void_reason is not null)
  )
);

create table public.miraisya_monthly_settlement_projects (
  settlement_id uuid not null
    references public.miraisya_monthly_settlements(id) on delete restrict,
  project_id text not null references public.projects(record_key) on delete restrict,
  status text not null check (status in ('draft', 'confirmed', 'voided')),
  sort_order integer not null check (sort_order between 1 and 500),
  project_name text not null,
  address text not null default '',
  completion_date date not null,
  billing_version bigint not null check (billing_version >= 1),
  billing_snapshot jsonb not null,
  cost_snapshot_token text not null check (cost_snapshot_token ~ '^[0-9a-f]{64}$'),
  cost_amount numeric(20,4) not null,
  cost_snapshot jsonb not null,
  tax_exclusive_amount bigint not null check (tax_exclusive_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  tax_inclusive_amount bigint not null check (tax_inclusive_amount >= 0),
  primary key (settlement_id, project_id),
  unique (settlement_id, sort_order),
  check (tax_exclusive_amount + tax_amount = tax_inclusive_amount)
);

create unique index miraisya_monthly_settlement_active_project_unique
  on public.miraisya_monthly_settlement_projects(project_id)
  where status in ('draft', 'confirmed');

create table public.miraisya_monthly_settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null,
  project_id text not null,
  sort_order integer not null check (sort_order between 1 and 500),
  item_name text not null,
  description text not null default '',
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  unit_price bigint not null check (unit_price >= 0),
  tax_rate smallint not null check (tax_rate in (0, 10)),
  tax_exclusive_amount bigint not null check (tax_exclusive_amount >= 0),
  tax_amount bigint not null check (tax_amount >= 0),
  tax_inclusive_amount bigint not null check (tax_inclusive_amount >= 0),
  foreign key (settlement_id, project_id)
    references public.miraisya_monthly_settlement_projects(settlement_id, project_id)
    on delete restrict,
  unique (settlement_id, project_id, sort_order),
  check (tax_exclusive_amount + tax_amount = tax_inclusive_amount)
);

alter table public.miraisya_monthly_settlements enable row level security;
alter table public.miraisya_monthly_settlement_projects enable row level security;
alter table public.miraisya_monthly_settlement_items enable row level security;
revoke all on table public.miraisya_monthly_settlements from public, anon, authenticated;
revoke all on table public.miraisya_monthly_settlement_projects from public, anon, authenticated;
revoke all on table public.miraisya_monthly_settlement_items from public, anon, authenticated;
grant all on table public.miraisya_monthly_settlements to service_role;
grant all on table public.miraisya_monthly_settlement_projects to service_role;
grant all on table public.miraisya_monthly_settlement_items to service_role;

create or replace function private.miraisya_settlement_actor()
returns public.employee_profiles
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  select employee.* into actor
  from public.employee_profiles as employee
  where employee.auth_user_id = auth.uid()
    and employee.deleted_at is null
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and employee.must_change_password = false;
  if not found then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;
  return actor;
end;
$$;

create or replace function private.miraisya_settlement_snapshot(p_settlement_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', settlement.id,
    'invoiceNo', settlement.invoice_no,
    'month', settlement.settlement_month,
    'issueDate', settlement.issue_date,
    'status', settlement.status,
    'version', settlement.version,
    'taxExclusiveAmount', settlement.tax_exclusive_amount,
    'taxAmount', settlement.tax_amount,
    'taxInclusiveAmount', settlement.tax_inclusive_amount,
    'totalCostAmount', settlement.total_cost_amount,
    'marginAmount', settlement.margin_amount,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectId', project.project_id,
        'projectName', project.project_name,
        'address', project.address,
        'completionDate', project.completion_date,
        'billingVersion', project.billing_version,
        'costSnapshotToken', project.cost_snapshot_token,
        'costAmount', project.cost_amount,
        'taxExclusiveAmount', project.tax_exclusive_amount,
        'taxAmount', project.tax_amount,
        'taxInclusiveAmount', project.tax_inclusive_amount,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'itemName', item.item_name,
            'description', item.description,
            'quantity', item.quantity,
            'unit', item.unit,
            'unitPrice', item.unit_price,
            'taxRate', item.tax_rate,
            'taxExclusiveAmount', item.tax_exclusive_amount,
            'taxAmount', item.tax_amount,
            'taxInclusiveAmount', item.tax_inclusive_amount
          ) order by item.sort_order)
          from public.miraisya_monthly_settlement_items as item
          where item.settlement_id = project.settlement_id
            and item.project_id = project.project_id
        ), '[]'::jsonb)
      ) order by project.sort_order)
      from public.miraisya_monthly_settlement_projects as project
      where project.settlement_id = settlement.id
    ), '[]'::jsonb),
    'createdAt', settlement.created_at,
    'createdByName', settlement.created_by_employee_name,
    'confirmedAt', settlement.confirmed_at,
    'confirmedByName', settlement.confirmed_by_employee_name,
    'voidedAt', settlement.voided_at,
    'voidedByName', settlement.voided_by_employee_name,
    'voidReason', settlement.void_reason
  )
  from public.miraisya_monthly_settlements as settlement
  where settlement.id = p_settlement_id;
$$;

create or replace function private.validate_miraisya_settlement_month(p_month text)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_month is null or p_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'invalid settlement month';
  end if;
end;
$$;

create or replace function public.list_miraisya_settlement_candidates_secure(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  perform private.validate_miraisya_settlement_month(p_month);
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.view')
  then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'projectId', candidate.project_id,
    'projectName', candidate.project_name,
    'address', candidate.address,
    'completionDate', candidate.completion_date,
    'completionMonth', to_char(candidate.completion_date, 'YYYY-MM'),
    'billingVersion', (candidate.billing->>'version')::bigint,
    'taxExclusiveAmount', (candidate.billing->>'taxExclusiveAmount')::bigint,
    'taxAmount', (candidate.billing->>'taxAmount')::bigint,
    'taxInclusiveAmount', (candidate.billing->>'taxInclusiveAmount')::bigint,
    'costAmount', (candidate.cost_report#>>'{ledgerSnapshot,totalAmount}')::numeric,
    'costComplete', jsonb_array_length(coalesce(
      candidate.cost_report#>'{ledgerSnapshot,incompleteSources}', '[]'::jsonb
    )) = 0,
    'incompleteSources', coalesce(
      candidate.cost_report#>'{ledgerSnapshot,incompleteSources}', '[]'::jsonb
    )
  ) order by candidate.completion_date, candidate.project_id), '[]'::jsonb)
  into result
  from (
    select
      project.record_key as project_id,
      project.payload->>'projectName' as project_name,
      coalesce(project.payload->>'address', '') as address,
      coalesce(nullif(project.payload->>'endDate', ''), project.payload->>'startDate')::date
        as completion_date,
      private.miraisya_billing_snapshot(project.record_key) as billing,
      public.export_project_cost_report_secure(
        jsonb_build_object('projectId', project.record_key)
      ) as cost_report
    from public.projects as project
    where project.status = 'active'
      and project.payload->>'projectType' = 'miraisya'
      and project.payload->>'status' = '已完工'
      and coalesce(nullif(project.payload->>'endDate', ''), project.payload->>'startDate')
        ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and to_char(
        coalesce(nullif(project.payload->>'endDate', ''), project.payload->>'startDate')::date,
        'YYYY-MM'
      ) <= p_month
      and not exists (
        select 1
        from public.miraisya_monthly_settlement_projects as active_project
        where active_project.project_id = project.record_key
          and active_project.status in ('draft', 'confirmed')
      )
  ) as candidate;
  return result;
end;
$$;

create or replace function public.list_miraisya_settlements_secure(p_month text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  perform private.validate_miraisya_settlement_month(p_month);
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.view')
  then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;
  select coalesce(jsonb_agg(
    private.miraisya_settlement_snapshot(settlement.id)
    order by settlement.sequence_no desc
  ), '[]'::jsonb)
  into result
  from public.miraisya_monthly_settlements as settlement
  where settlement.settlement_month = p_month;
  return result;
end;
$$;

create or replace function public.get_miraisya_settlement_secure(p_settlement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  result jsonb;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.view')
  then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;
  result := private.miraisya_settlement_snapshot(p_settlement_id);
  if result is null then
    raise exception using errcode = 'P0002', message = 'settlement not found';
  end if;
  return result;
end;
$$;

create or replace function public.create_miraisya_settlement_draft_secure(
  p_month text,
  p_issue_date date,
  p_project_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  settlement_id uuid;
  next_sequence integer;
  project_id text;
  project_row public.projects%rowtype;
  completion_date date;
  billing jsonb;
  cost_report jsonb;
  project_order integer := 0;
  item jsonb;
  item_order integer;
  line_exclusive bigint;
  line_tax bigint;
  total_exclusive bigint := 0;
  total_tax bigint := 0;
  total_cost numeric(20,4) := 0;
begin
  perform private.validate_miraisya_settlement_month(p_month);
  if not private.current_employee_can_mutate_typed_project('settlement') then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;
  if p_issue_date is null or p_project_ids is null or cardinality(p_project_ids) < 1
    or cardinality(p_project_ids) > 500
    or exists (
      select 1 from unnest(p_project_ids) as supplied(value)
      where supplied.value is null or btrim(supplied.value) = ''
    )
    or (select count(*) from unnest(p_project_ids))
      <> (select count(distinct value) from unnest(p_project_ids) as supplied(value))
  then
    raise exception using errcode = '22023', message = 'invalid settlement request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('MIRAI:' || p_month, 0));
  actor := private.miraisya_settlement_actor();
  select coalesce(max(existing.sequence_no), 0) + 1 into next_sequence
  from public.miraisya_monthly_settlements as existing
  where existing.settlement_month = p_month;
  if next_sequence > 999 then
    raise exception using errcode = '54000', message = 'settlement sequence exhausted';
  end if;

  insert into public.miraisya_monthly_settlements (
    invoice_no, settlement_month, issue_date, sequence_no,
    created_by_employee_id, created_by_employee_name
  ) values (
    'MIRAI-' || replace(p_month, '-', '') || '-' || lpad(next_sequence::text, 3, '0'),
    p_month, p_issue_date, next_sequence, actor.id, actor.name
  ) returning id into settlement_id;

  for project_id in select value from unnest(p_project_ids) as supplied(value) order by value
  loop
    project_order := project_order + 1;
    if exists (
      select 1 from public.miraisya_monthly_settlement_projects as active_project
      where active_project.project_id = project_id
        and active_project.status in ('draft', 'confirmed')
    ) then
      raise exception using
        errcode = '23505', message = 'project already settled',
        hint = 'MIRAISYA_SETTLEMENT_PROJECT_DUPLICATE';
    end if;

    project_row := private.assert_miraisya_project(project_id, true);
    if project_row.payload->>'status' <> '已完工'
      or coalesce(nullif(project_row.payload->>'endDate', ''), project_row.payload->>'startDate')
        !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then
      raise exception using errcode = '22023', message = 'completed Miraisya project required';
    end if;
    completion_date := coalesce(
      nullif(project_row.payload->>'endDate', ''), project_row.payload->>'startDate'
    )::date;
    if to_char(completion_date, 'YYYY-MM') > p_month then
      raise exception using errcode = '22023', message = 'project completion month is after settlement month';
    end if;

    billing := private.miraisya_billing_snapshot(project_id);
    if jsonb_array_length(coalesce(billing->'items', '[]'::jsonb)) = 0 then
      raise exception using errcode = '22023', message = 'billing items required';
    end if;
    cost_report := public.export_project_cost_report_secure(jsonb_build_object('projectId', project_id));
    if cost_report->>'status' <> 'ready'
      or jsonb_array_length(coalesce(
        cost_report#>'{ledgerSnapshot,incompleteSources}', '[]'::jsonb
      )) <> 0
    then
      raise exception using
        errcode = '22023', message = 'project cost incomplete',
        hint = 'MIRAISYA_SETTLEMENT_COST_INCOMPLETE';
    end if;

    insert into public.miraisya_monthly_settlement_projects (
      settlement_id, project_id, status, sort_order, project_name, address,
      completion_date, billing_version, billing_snapshot, cost_snapshot_token,
      cost_amount, cost_snapshot, tax_exclusive_amount, tax_amount,
      tax_inclusive_amount
    ) values (
      settlement_id, project_id, 'draft', project_order,
      project_row.payload->>'projectName', coalesce(project_row.payload->>'address', ''),
      completion_date, (billing->>'version')::bigint, billing,
      cost_report->>'snapshotToken',
      (cost_report#>>'{ledgerSnapshot,totalAmount}')::numeric,
      cost_report,
      (billing->>'taxExclusiveAmount')::bigint,
      (billing->>'taxAmount')::bigint,
      (billing->>'taxInclusiveAmount')::bigint
    );

    item_order := 0;
    for item in select value from jsonb_array_elements(billing->'items') as line(value)
    loop
      item_order := item_order + 1;
      line_exclusive := round((item->>'quantity')::numeric * (item->>'unitPrice')::bigint)::bigint;
      line_tax := case when (item->>'taxRate')::smallint = 10
        then round(line_exclusive * 0.1)::bigint else 0 end;
      insert into public.miraisya_monthly_settlement_items (
        settlement_id, project_id, sort_order, item_name, description, quantity,
        unit, unit_price, tax_rate, tax_exclusive_amount, tax_amount,
        tax_inclusive_amount
      ) values (
        settlement_id, project_id, item_order, item->>'itemName',
        item->>'description', (item->>'quantity')::numeric, item->>'unit',
        (item->>'unitPrice')::bigint, (item->>'taxRate')::smallint,
        line_exclusive, line_tax, line_exclusive + line_tax
      );
    end loop;

    total_exclusive := total_exclusive + (billing->>'taxExclusiveAmount')::bigint;
    total_tax := total_tax + (billing->>'taxAmount')::bigint;
    total_cost := total_cost + (cost_report#>>'{ledgerSnapshot,totalAmount}')::numeric;
  end loop;

  update public.miraisya_monthly_settlements as settlement
  set tax_exclusive_amount = total_exclusive,
      tax_amount = total_tax,
      tax_inclusive_amount = total_exclusive + total_tax,
      total_cost_amount = total_cost,
      margin_amount = total_exclusive - total_cost
  where settlement.id = settlement_id;
  return private.miraisya_settlement_snapshot(settlement_id);
end;
$$;

create or replace function public.confirm_miraisya_settlement_secure(
  p_settlement_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  settlement public.miraisya_monthly_settlements%rowtype;
begin
  if not private.current_employee_can_mutate_typed_project('settlement') then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;
  actor := private.miraisya_settlement_actor();
  select row_value.* into settlement
  from public.miraisya_monthly_settlements as row_value
  where row_value.id = p_settlement_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'settlement not found'; end if;
  if settlement.version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'settlement version conflict',
      hint = 'MIRAISYA_SETTLEMENT_VERSION_CONFLICT';
  end if;
  if settlement.status <> 'draft' then
    raise exception using errcode = '22023', message = 'draft settlement required';
  end if;
  if exists (
    select 1 from public.miraisya_monthly_settlement_projects as project
    where project.settlement_id = settlement.id
      and (project.cost_snapshot_token = '' or project.cost_snapshot is null)
  ) then
    raise exception using
      errcode = '22023', message = 'project cost incomplete',
      hint = 'MIRAISYA_SETTLEMENT_COST_INCOMPLETE';
  end if;
  update public.miraisya_monthly_settlements
  set status = 'confirmed', version = version + 1,
      confirmed_by_employee_id = actor.id,
      confirmed_by_employee_name = actor.name,
      confirmed_at = clock_timestamp()
  where id = settlement.id;
  update public.miraisya_monthly_settlement_projects
  set status = 'confirmed'
  where settlement_id = settlement.id;
  return private.miraisya_settlement_snapshot(settlement.id);
end;
$$;

create or replace function public.void_miraisya_settlement_secure(
  p_settlement_id uuid,
  p_expected_version bigint,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  settlement public.miraisya_monthly_settlements%rowtype;
begin
  if not private.current_employee_can_mutate_typed_project('settlement') then
    raise exception using
      errcode = '42501', message = 'settlement access denied',
      hint = 'MIRAISYA_SETTLEMENT_ACCESS_DENIED';
  end if;
  if p_reason is null or btrim(p_reason) = '' or length(btrim(p_reason)) > 1000 then
    raise exception using errcode = '22023', message = 'void reason required';
  end if;
  actor := private.miraisya_settlement_actor();
  select row_value.* into settlement
  from public.miraisya_monthly_settlements as row_value
  where row_value.id = p_settlement_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'settlement not found'; end if;
  if settlement.version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'settlement version conflict',
      hint = 'MIRAISYA_SETTLEMENT_VERSION_CONFLICT';
  end if;
  if settlement.status not in ('draft', 'confirmed') then
    raise exception using errcode = '22023', message = 'active settlement required';
  end if;
  update public.miraisya_monthly_settlements
  set status = 'voided', version = version + 1,
      voided_by_employee_id = actor.id,
      voided_by_employee_name = actor.name,
      voided_at = clock_timestamp(),
      void_reason = btrim(p_reason)
  where id = settlement.id;
  update public.miraisya_monthly_settlement_projects
  set status = 'voided'
  where settlement_id = settlement.id;
  return private.miraisya_settlement_snapshot(settlement.id);
end;
$$;

revoke all on function private.miraisya_settlement_actor()
  from public, anon, authenticated, service_role;
revoke all on function private.miraisya_settlement_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.validate_miraisya_settlement_month(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_miraisya_settlement_candidates_secure(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_miraisya_settlements_secure(text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_miraisya_settlement_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_miraisya_settlement_draft_secure(text, date, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_miraisya_settlement_secure(uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.void_miraisya_settlement_secure(uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_miraisya_settlement_candidates_secure(text)
  to authenticated, service_role;
grant execute on function public.list_miraisya_settlements_secure(text)
  to authenticated, service_role;
grant execute on function public.get_miraisya_settlement_secure(uuid)
  to authenticated, service_role;
grant execute on function public.create_miraisya_settlement_draft_secure(text, date, text[])
  to authenticated, service_role;
grant execute on function public.confirm_miraisya_settlement_secure(uuid, bigint)
  to authenticated, service_role;
grant execute on function public.void_miraisya_settlement_secure(uuid, bigint, text)
  to authenticated, service_role;

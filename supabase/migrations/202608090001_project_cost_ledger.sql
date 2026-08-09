-- Unified project-cost facts, append-only correction/allocation events, and a
-- permission-scoped read model. Source tables remain owned by their modules;
-- this migration only reads their validated business facts.

begin;

create table public.project_cost_manual_entries (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  project_id text not null references public.projects(record_key) on delete restrict,
  project_name text not null,
  category text not null,
  cost_date date not null,
  original_amount numeric(18,4) not null,
  description text not null default '',
  operator text not null default '',
  created_by_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  created_by_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint project_cost_manual_entries_source_key_check check (
    source_key = btrim(source_key)
    and char_length(source_key) between 1 and 500
    and source_key not in ('__proto__', 'constructor', 'prototype')
  ),
  constraint project_cost_manual_entries_project_name_check check (
    project_name = btrim(project_name) and char_length(project_name) <= 500
  ),
  constraint project_cost_manual_entries_category_check check (
    category = btrim(category) and char_length(category) between 1 and 100
  ),
  constraint project_cost_manual_entries_date_check check (
    cost_date between date '1900-01-01' and date '2100-01-01'
  ),
  constraint project_cost_manual_entries_amount_check check (
    original_amount <> 0
    and abs(original_amount) <= 900719925474.0991
    and original_amount not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
  ),
  constraint project_cost_manual_entries_text_check check (
    description = btrim(description) and char_length(description) <= 2000
    and operator = btrim(operator) and char_length(operator) <= 500
    and created_by_name = btrim(created_by_name)
    and char_length(created_by_name) between 1 and 500
  )
);

create table public.project_cost_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  sequence_no bigint not null,
  amount_before numeric(18,4) not null,
  adjustment_amount numeric(18,4) not null,
  amount_after numeric(18,4) not null,
  reason text not null,
  actor_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  actor_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (source_key, sequence_no),
  constraint project_cost_adjustment_events_source_key_check check (
    source_key = btrim(source_key)
    and char_length(source_key) between 1 and 600
    and source_key not in ('__proto__', 'constructor', 'prototype')
  ),
  constraint project_cost_adjustment_events_sequence_check check (sequence_no > 0),
  constraint project_cost_adjustment_events_amount_check check (
    abs(amount_before) <= 900719925474.0991
    and abs(adjustment_amount) <= 900719925474.0991
    and abs(amount_after) <= 900719925474.0991
    and amount_before not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and adjustment_amount not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and amount_after not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and amount_after = amount_before + adjustment_amount
  ),
  constraint project_cost_adjustment_events_text_check check (
    reason = btrim(reason) and char_length(reason) between 1 and 2000
    and actor_name = btrim(actor_name) and char_length(actor_name) between 1 and 500
  )
);

create table public.project_cost_allocation_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  sequence_no bigint not null,
  amount_snapshot numeric(18,4) not null,
  allocations jsonb not null,
  reason text not null,
  actor_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  actor_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (source_key, sequence_no),
  constraint project_cost_allocation_events_source_key_check check (
    source_key = btrim(source_key)
    and char_length(source_key) between 1 and 600
    and source_key not in ('__proto__', 'constructor', 'prototype')
  ),
  constraint project_cost_allocation_events_sequence_check check (sequence_no > 0),
  constraint project_cost_allocation_events_amount_check check (
    abs(amount_snapshot) <= 900719925474.0991
    and amount_snapshot not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
  ),
  constraint project_cost_allocation_events_allocations_check check (
    jsonb_typeof(allocations) = 'array'
    and jsonb_array_length(allocations) between 1 and 100
  ),
  constraint project_cost_allocation_events_text_check check (
    reason = btrim(reason) and char_length(reason) between 1 and 2000
    and actor_name = btrim(actor_name) and char_length(actor_name) between 1 and 500
  )
);

create index project_cost_manual_entries_date_idx
  on public.project_cost_manual_entries(cost_date desc, source_key);
create index project_cost_adjustment_events_latest_idx
  on public.project_cost_adjustment_events(source_key, sequence_no desc);
create index project_cost_allocation_events_latest_idx
  on public.project_cost_allocation_events(source_key, sequence_no desc);

alter table public.project_cost_manual_entries enable row level security;
alter table public.project_cost_manual_entries force row level security;
alter table public.project_cost_adjustment_events enable row level security;
alter table public.project_cost_adjustment_events force row level security;
alter table public.project_cost_allocation_events enable row level security;
alter table public.project_cost_allocation_events force row level security;

revoke all on table
  public.project_cost_manual_entries,
  public.project_cost_adjustment_events,
  public.project_cost_allocation_events
from public, anon, authenticated, service_role;
revoke truncate on table
  public.project_cost_manual_entries,
  public.project_cost_adjustment_events,
  public.project_cost_allocation_events
from public, anon, authenticated, service_role;

create or replace function private.reject_project_cost_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'project cost ledger facts are append-only';
end;
$$;

create trigger reject_project_cost_manual_entry_mutation
before update or delete on public.project_cost_manual_entries
for each row execute function private.reject_project_cost_ledger_mutation();
create trigger reject_project_cost_manual_entry_truncate
before truncate on public.project_cost_manual_entries
for each statement execute function private.reject_project_cost_ledger_mutation();
create trigger reject_project_cost_adjustment_mutation
before update or delete on public.project_cost_adjustment_events
for each row execute function private.reject_project_cost_ledger_mutation();
create trigger reject_project_cost_adjustment_truncate
before truncate on public.project_cost_adjustment_events
for each statement execute function private.reject_project_cost_ledger_mutation();
create trigger reject_project_cost_allocation_mutation
before update or delete on public.project_cost_allocation_events
for each row execute function private.reject_project_cost_ledger_mutation();
create trigger reject_project_cost_allocation_truncate
before truncate on public.project_cost_allocation_events
for each statement execute function private.reject_project_cost_ledger_mutation();

create or replace function private.project_cost_safe_amount(p_value jsonb)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  parsed numeric;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'number' then
    return null;
  end if;
  parsed := (p_value #>> '{}')::numeric;
  if parsed in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    or pg_catalog.abs(parsed) > 900719925474.0991
    or pg_catalog.round(parsed, 4) <> parsed
  then
    return null;
  end if;
  return parsed;
exception when others then
  return null;
end;
$$;

create or replace function private.project_cost_safe_date(p_value jsonb)
returns date
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  supplied text;
  parsed date;
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'string' then
    return null;
  end if;
  supplied := p_value #>> '{}';
  if supplied !~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
    return null;
  end if;
  parsed := supplied::date;
  if pg_catalog.to_char(parsed, 'YYYY-MM-DD') <> supplied
    or parsed < date '1900-01-01'
    or parsed > date '2100-01-01'
  then
    return null;
  end if;
  return parsed;
exception when others then
  return null;
end;
$$;

create or replace function private.project_cost_payload_cancelled(p_payload jsonb)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from pg_catalog.unnest(array[
      p_payload->>'status',
      p_payload->>'recordStatus',
      p_payload->>'businessStatus',
      p_payload->>'purchaseStatus'
    ]::text[]) supplied(status_value)
    where pg_catalog.lower(pg_catalog.btrim(supplied.status_value)) in (
      'deleted', 'void', 'inactive', 'cancelled', 'canceled',
      '已删除', '作废', '取消', '已取消'
    )
  );
$$;

create or replace function private.private_project_cost_source_facts()
returns table (
  source_key text,
  source_module text,
  source_document_type text,
  source_document_id text,
  project_id text,
  project_name text,
  category text,
  cost_date date,
  description text,
  original_amount numeric(18,4),
  operator text
)
language sql
stable
security definer
set search_path = ''
as $$
  with authoritative_warehouse_purchase_keys as (
    select distinct linked_key.value #>> '{}' purchase_record_key
    from public.project_cost_records warehouse_cost
    cross join lateral pg_catalog.jsonb_array_elements(case
      when pg_catalog.jsonb_typeof(
        warehouse_cost.payload->'sourcePurchaseRecordKeys'
      ) = 'array'
        then warehouse_cost.payload->'sourcePurchaseRecordKeys'
      else '[]'::jsonb
    end) linked_key(value)
    cross join lateral (
      select private.project_cost_safe_amount(
        warehouse_cost.payload->'amount'
      ) amount_value
    ) parsed
    where warehouse_cost.status not in ('deleted', 'void')
      and warehouse_cost.payload->>'sourceType' in (
        'warehouse', 'warehouseReversal'
      )
      and pg_catalog.jsonb_typeof(
        warehouse_cost.payload->'sourcePurchaseRecordKeys'
      ) = 'array'
      and pg_catalog.jsonb_typeof(linked_key.value) = 'string'
      and linked_key.value #>> '{}' = pg_catalog.btrim(linked_key.value #>> '{}')
      and linked_key.value #>> '{}' <> ''
      and parsed.amount_value is not null
      and parsed.amount_value <> 0
      and not private.project_cost_payload_cancelled(warehouse_cost.payload)
  ), purchase_facts as (
    select
      'purchase:' || purchase.record_key,
      'purchase'::text,
      'purchase_order'::text,
      purchase.record_key,
      purchase.payload->>'projectId',
      coalesce(purchase.payload->>'projectName', ''),
      '材料费'::text,
      parsed.cost_date,
      coalesce(
        purchase.payload->>'itemName', purchase.payload->>'remark', ''
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(purchase.payload->>'employeeName', '')
    from public.purchase_records purchase
    cross join lateral (
      select
        private.project_cost_safe_amount(purchase.payload->'totalCost') amount_value,
        private.project_cost_safe_date(purchase.payload->'purchaseDate') cost_date
    ) parsed
    where purchase.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(purchase.payload)
      and pg_catalog.jsonb_typeof(purchase.payload->'projectId') = 'string'
      and purchase.payload->>'projectId' = pg_catalog.btrim(purchase.payload->>'projectId')
      and pg_catalog.char_length(purchase.payload->>'projectId') between 1 and 500
      and purchase.payload->>'projectId' not in (
        '__proto__', 'constructor', 'prototype'
      )
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value > 0
      and not exists (
        select 1
        from authoritative_warehouse_purchase_keys tracked
        where tracked.purchase_record_key = purchase.record_key
      )
  ), warehouse_facts as (
    select
      'warehouse:' || cost.record_key,
      'warehouse'::text,
      coalesce(
        nullif(cost.payload->>'sourceDocumentType', ''),
        'warehouse_stock_out'
      ),
      coalesce(
        nullif(cost.payload->>'sourceDocumentId', ''),
        cost.record_key
      ),
      cost.payload->>'projectId',
      coalesce(cost.payload->>'projectName', ''),
      '材料费'::text,
      parsed.cost_date,
      coalesce(cost.payload->>'remark', ''),
      parsed.amount_value::numeric(18,4),
      coalesce(cost.payload->>'operator', '')
    from public.project_cost_records cost
    cross join lateral (
      select
        private.project_cost_safe_amount(cost.payload->'amount') amount_value,
        private.project_cost_safe_date(cost.payload->'date') cost_date
    ) parsed
    where cost.status not in ('deleted', 'void')
      and cost.payload->>'sourceType' in ('warehouse', 'warehouseReversal')
      and pg_catalog.jsonb_typeof(
        cost.payload->'sourcePurchaseRecordKeys'
      ) = 'array'
      and not private.project_cost_payload_cancelled(cost.payload)
      and pg_catalog.jsonb_typeof(cost.payload->'projectId') = 'string'
      and cost.payload->>'projectId' = pg_catalog.btrim(cost.payload->>'projectId')
      and pg_catalog.char_length(cost.payload->>'projectId') between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value <> 0
  ), labor_facts as (
    select
      'labor:' || allocation.allocation_id::text,
      'labor'::text,
      'labor_cost'::text,
      resolution.resolution_id::text,
      allocation.project_id,
      allocation.project_name_snapshot,
      '人工费'::text,
      resolution.work_date,
      employee.name || case
        when allocation.allocation_note = '' then ''
        else '：' || allocation.allocation_note
      end,
      allocation.amount::numeric(18,4),
      coalesce(confirmer.name, '')
    from public.attendance_project_allocations allocation
    join public.attendance_day_resolutions resolution
      on resolution.resolution_id = allocation.resolution_id
    join public.employee_profiles employee
      on employee.id = resolution.employee_profile_id
    left join public.employee_profiles confirmer
      on confirmer.id = resolution.confirmed_by_employee_profile_id
    where resolution.accounting_status in ('confirmed', 'month_locked')
      and allocation.amount > 0
      and allocation.amount <= 900719925474.0991
  ), fuel_facts as (
    select
      'vehicle-fuel:' || fuel.record_key,
      'vehicle'::text,
      'vehicle_fuel'::text,
      fuel.record_key,
      fuel.payload->>'projectId',
      coalesce(fuel.payload->>'projectName', ''),
      '车辆费'::text,
      parsed.cost_date,
      coalesce(
        fuel.payload->>'remark', fuel.payload->>'vehicleName', '项目加油'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(fuel.payload->>'employeeName', '')
    from public.fuel_records fuel
    cross join lateral (
      select
        private.project_cost_safe_amount(fuel.payload->'fuelAmount') amount_value,
        private.project_cost_safe_date(fuel.payload->'fuelDate') cost_date
    ) parsed
    where fuel.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(fuel.payload)
      and fuel.payload->'allocateToProject' = 'true'::jsonb
      and pg_catalog.jsonb_typeof(fuel.payload->'projectId') = 'string'
      and fuel.payload->>'projectId' = pg_catalog.btrim(fuel.payload->>'projectId')
      and pg_catalog.char_length(fuel.payload->>'projectId') between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value > 0
  ), vehicle_expense_facts as (
    select
      'vehicle-expense:' || expense.record_key,
      'vehicle'::text,
      'vehicle_expense'::text,
      expense.record_key,
      expense.payload->>'projectId',
      coalesce(expense.payload->>'projectName', ''),
      '车辆费'::text,
      parsed.cost_date,
      coalesce(
        expense.payload->>'remark', expense.payload->>'expenseType', '车辆费用'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(expense.payload->>'employeeName', '')
    from public.vehicle_expense_records expense
    cross join lateral (
      select
        private.project_cost_safe_amount(expense.payload->'amount') amount_value,
        private.project_cost_safe_date(expense.payload->'expenseDate') cost_date
    ) parsed
    where expense.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(expense.payload)
      and expense.payload->'allocateToProject' = 'true'::jsonb
      and pg_catalog.jsonb_typeof(expense.payload->'projectId') = 'string'
      and expense.payload->>'projectId' = pg_catalog.btrim(expense.payload->>'projectId')
      and pg_catalog.char_length(expense.payload->>'projectId') between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value > 0
  ), vehicle_issue_facts as (
    select
      'vehicle-issue:' || issue.record_key,
      'vehicle'::text,
      'vehicle_repair'::text,
      issue.record_key,
      issue.payload->>'projectId',
      coalesce(issue.payload->>'projectName', ''),
      '车辆费'::text,
      parsed.cost_date,
      coalesce(
        issue.payload->>'issueDescription', issue.payload->>'remark', '车辆维修'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(issue.payload->>'employeeName', '')
    from public.vehicle_issue_records issue
    cross join lateral (
      select
        private.project_cost_safe_amount(issue.payload->'repairCost') amount_value,
        private.project_cost_safe_date(issue.payload->'issueDate') cost_date
    ) parsed
    where issue.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(issue.payload)
      and issue.payload->'allocateToProject' = 'true'::jsonb
      and pg_catalog.jsonb_typeof(issue.payload->'projectId') = 'string'
      and issue.payload->>'projectId' = pg_catalog.btrim(issue.payload->>'projectId')
      and pg_catalog.char_length(issue.payload->>'projectId') between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value > 0
  ), tool_facts as (
    select
      'tool-responsibility:' || responsibility.record_key,
      'tool'::text,
      'tool_responsibility'::text,
      responsibility.record_key,
      responsibility.payload->>'projectId',
      coalesce(responsibility.payload->>'projectName', ''),
      '工具费'::text,
      parsed.cost_date,
      coalesce(
        responsibility.payload->>'issueDescription',
        responsibility.payload->>'toolName', '工具责任费用'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(responsibility.payload->>'handlerEmployeeName', '')
    from public.tool_responsibility_records responsibility
    cross join lateral (
      select
        private.project_cost_safe_amount(case
          when responsibility.payload->>'issueType' = '丢失'
            then responsibility.payload->'toolValue'
          else responsibility.payload->'repairCost'
        end) amount_value,
        private.project_cost_safe_date(
          responsibility.payload->'recordDate'
        ) cost_date
    ) parsed
    where responsibility.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(responsibility.payload)
      and pg_catalog.jsonb_typeof(responsibility.payload->'projectId') = 'string'
      and responsibility.payload->>'projectId'
        = pg_catalog.btrim(responsibility.payload->>'projectId')
      and pg_catalog.char_length(
        responsibility.payload->>'projectId'
      ) between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value > 0
  ), operating_facts as (
    select
      'operating:' || expense.record_key,
      'operating'::text,
      'operating_expense'::text,
      expense.record_key,
      expense.payload->>'projectId',
      coalesce(expense.payload->>'projectName', ''),
      '经营费用'::text,
      parsed.cost_date,
      coalesce(
        expense.payload->>'remark', expense.payload->>'expenseType', '经营费用'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(
        expense.payload->>'operator', expense.payload->>'employeeName', ''
      )
    from public.operating_expense_records expense
    cross join lateral (
      select
        private.project_cost_safe_amount(expense.payload->'amount') amount_value,
        private.project_cost_safe_date(expense.payload->'date') cost_date
    ) parsed
    where expense.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(expense.payload)
      and expense.payload->'allocateToProject' = 'true'::jsonb
      and pg_catalog.jsonb_typeof(expense.payload->'projectId') = 'string'
      and expense.payload->>'projectId' = pg_catalog.btrim(expense.payload->>'projectId')
      and pg_catalog.char_length(expense.payload->>'projectId') between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value > 0
  ), legacy_manual_facts as (
    select
      'legacy-manual:' || cost.record_key,
      'manual'::text,
      'manual_project_cost'::text,
      cost.record_key,
      cost.payload->>'projectId',
      coalesce(cost.payload->>'projectName', ''),
      coalesce(
        nullif(cost.payload->>'costType', ''), '其他费用'
      ),
      parsed.cost_date,
      coalesce(cost.payload->>'remark', ''),
      parsed.amount_value::numeric(18,4),
      coalesce(cost.payload->>'operator', '')
    from public.project_cost_records cost
    cross join lateral (
      select
        private.project_cost_safe_amount(cost.payload->'amount') amount_value,
        private.project_cost_safe_date(cost.payload->'date') cost_date
    ) parsed
    where cost.status not in ('deleted', 'void')
      and coalesce(cost.payload->>'sourceType', '') not in (
        'warehouse', 'warehouseReversal'
      )
      and not private.project_cost_payload_cancelled(cost.payload)
      and pg_catalog.jsonb_typeof(cost.payload->'projectId') = 'string'
      and cost.payload->>'projectId' = pg_catalog.btrim(cost.payload->>'projectId')
      and pg_catalog.char_length(cost.payload->>'projectId') between 1 and 500
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value <> 0
  ), manual_facts as (
    select
      'manual:' || manual.source_key,
      'manual'::text,
      'manual_project_cost'::text,
      manual.source_key,
      manual.project_id,
      manual.project_name,
      manual.category,
      manual.cost_date,
      manual.description,
      manual.original_amount,
      manual.operator
    from public.project_cost_manual_entries manual
  )
  select * from purchase_facts
  union all select * from warehouse_facts
  union all select * from labor_facts
  union all select * from fuel_facts
  union all select * from vehicle_expense_facts
  union all select * from vehicle_issue_facts
  union all select * from tool_facts
  union all select * from operating_facts
  union all select * from legacy_manual_facts
  union all select * from manual_facts;
$$;

create or replace function public.list_project_cost_ledger_secure(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  allowed_keys constant text[] := array[
    'projectId', 'dateFrom', 'dateTo', 'category', 'sourceModule',
    'adjusted', 'keyword', 'page', 'pageSize'
  ]::text[];
  filter_project_id text;
  filter_date_from date;
  filter_date_to date;
  filter_category text;
  filter_source_module text;
  filter_adjusted text;
  filter_keyword text;
  requested_page integer := 1;
  requested_page_size integer := 20;
  response jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using errcode = '42501', message = 'active employee required';
  end if;
  if not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger view permission required';
  end if;

  if p_filters is null
    or pg_catalog.jsonb_typeof(p_filters) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_filters) supplied(key)
      where supplied.key <> all(allowed_keys)
    )
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters';
  end if;

  begin
    if p_filters ? 'page' then
      if pg_catalog.jsonb_typeof(p_filters->'page') <> 'number' then
        raise data_exception;
      end if;
      requested_page := (p_filters->>'page')::integer;
    end if;
    if p_filters ? 'pageSize' then
      if pg_catalog.jsonb_typeof(p_filters->'pageSize') <> 'number' then
        raise data_exception;
      end if;
      requested_page_size := (p_filters->>'pageSize')::integer;
    end if;
  exception when others then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters';
  end;
  if requested_page not between 1 and 1000000
    or requested_page_size not in (20, 50, 100)
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters';
  end if;

  if p_filters ? 'projectId' then
    if pg_catalog.jsonb_typeof(p_filters->'projectId') <> 'string' then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
    filter_project_id := p_filters->>'projectId';
    if filter_project_id in ('', 'all') then filter_project_id := null; end if;
    if filter_project_id is not null and (
      filter_project_id <> pg_catalog.btrim(filter_project_id)
      or pg_catalog.char_length(filter_project_id) > 500
      or filter_project_id in ('__proto__', 'constructor', 'prototype')
    ) then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
  end if;

  if p_filters ? 'category' then
    if pg_catalog.jsonb_typeof(p_filters->'category') <> 'string' then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
    filter_category := p_filters->>'category';
    if filter_category in ('', 'all') then filter_category := null; end if;
    if filter_category is not null and (
      filter_category <> pg_catalog.btrim(filter_category)
      or pg_catalog.char_length(filter_category) > 100
    ) then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
  end if;

  if p_filters ? 'sourceModule' then
    if pg_catalog.jsonb_typeof(p_filters->'sourceModule') <> 'string' then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
    filter_source_module := p_filters->>'sourceModule';
    if filter_source_module in ('', 'all') then filter_source_module := null; end if;
    if filter_source_module is not null and filter_source_module not in (
      'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual'
    ) then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
  end if;

  if p_filters ? 'adjusted' then
    if pg_catalog.jsonb_typeof(p_filters->'adjusted') <> 'string'
      or p_filters->>'adjusted' not in ('all', 'adjusted', 'unadjusted')
    then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
    filter_adjusted := p_filters->>'adjusted';
    if filter_adjusted = 'all' then filter_adjusted := null; end if;
  end if;

  if p_filters ? 'keyword' then
    if pg_catalog.jsonb_typeof(p_filters->'keyword') <> 'string' then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
    filter_keyword := p_filters->>'keyword';
    if filter_keyword = '' then filter_keyword := null; end if;
    if filter_keyword is not null and (
      filter_keyword <> pg_catalog.btrim(filter_keyword)
      or pg_catalog.char_length(filter_keyword) > 200
    ) then
      raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
    end if;
  end if;

  if p_filters ? 'dateFrom' then
    if (p_filters->>'dateFrom') = '' then
      filter_date_from := null;
    else
      filter_date_from := private.project_cost_safe_date(p_filters->'dateFrom');
      if filter_date_from is null then
        raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
      end if;
    end if;
  end if;
  if p_filters ? 'dateTo' then
    if (p_filters->>'dateTo') = '' then
      filter_date_to := null;
    else
      filter_date_to := private.project_cost_safe_date(p_filters->'dateTo');
      if filter_date_to is null then
        raise exception using errcode = '22023', message = 'invalid project cost ledger filters';
      end if;
    end if;
  end if;
  if filter_date_from is not null and filter_date_to is not null
    and filter_date_from > filter_date_to
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters';
  end if;

  with facts as materialized (
    select * from private.private_project_cost_source_facts()
  ), latest_adjustment as (
    select distinct on (event.source_key)
      event.source_key, event.sequence_no, event.amount_after
    from public.project_cost_adjustment_events event
    order by event.source_key, event.sequence_no desc
  ), latest_allocation as (
    select distinct on (event.source_key)
      event.source_key, event.sequence_no, event.amount_snapshot,
      event.allocations
    from public.project_cost_allocation_events event
    order by event.source_key, event.sequence_no desc
  ), effective as (
    select
      fact.*,
      coalesce(adjustment.amount_after, fact.original_amount)::numeric(18,4)
        effective_amount,
      (coalesce(adjustment.amount_after, fact.original_amount)
        - fact.original_amount)::numeric(18,4) source_adjustment_amount,
      greatest(
        coalesce(adjustment.sequence_no, 0),
        coalesce(allocation.sequence_no, 0)
      ) + 1 version,
      allocation.sequence_no allocation_sequence_no,
      allocation.amount_snapshot,
      allocation.allocations,
      coalesce((
        select pg_catalog.jsonb_agg(event_value order by event_sequence, event_type)
        from (
          select adjustment_event.sequence_no event_sequence,
            'adjustment'::text event_type,
            pg_catalog.jsonb_build_object(
              'type', 'adjustment',
              'sequenceNo', adjustment_event.sequence_no,
              'amountBefore', adjustment_event.amount_before,
              'adjustmentAmount', adjustment_event.adjustment_amount,
              'amountAfter', adjustment_event.amount_after,
              'reason', adjustment_event.reason,
              'actorName', adjustment_event.actor_name,
              'createdAt', adjustment_event.created_at
            ) event_value
          from public.project_cost_adjustment_events adjustment_event
          where adjustment_event.source_key = fact.source_key
          union all
          select allocation_event.sequence_no, 'allocation'::text,
            pg_catalog.jsonb_build_object(
              'type', 'allocation',
              'sequenceNo', allocation_event.sequence_no,
              'amountSnapshot', allocation_event.amount_snapshot,
              'allocations', allocation_event.allocations,
              'reason', allocation_event.reason,
              'actorName', allocation_event.actor_name,
              'createdAt', allocation_event.created_at
            )
          from public.project_cost_allocation_events allocation_event
          where allocation_event.source_key = fact.source_key
        ) audit(event_sequence, event_type, event_value)
      ), '[]'::jsonb) audit_events
    from facts fact
    left join latest_adjustment adjustment using (source_key)
    left join latest_allocation allocation using (source_key)
  ), supplied_allocation_items as (
    select
      source.source_key,
      item.ordinality,
      item.value,
      case
        when pg_catalog.jsonb_typeof(item.value) = 'object'
          and (select count(*) from pg_catalog.jsonb_object_keys(item.value)) = 2
          and item.value ? 'projectId'
          and item.value ? 'amount'
          and pg_catalog.jsonb_typeof(item.value->'projectId') = 'string'
          and item.value->>'projectId' = pg_catalog.btrim(item.value->>'projectId')
          and pg_catalog.char_length(item.value->>'projectId') between 1 and 500
          and item.value->>'projectId' not in (
            '__proto__', 'constructor', 'prototype'
          )
          and private.project_cost_safe_amount(item.value->'amount') is not null
        then item.value->>'projectId'
        else null
      end allocation_project_id,
      private.project_cost_safe_amount(item.value->'amount') allocation_amount
    from effective source
    cross join lateral pg_catalog.jsonb_array_elements(
      source.allocations
    ) with ordinality item(value, ordinality)
    where source.allocation_sequence_no is not null
      and pg_catalog.jsonb_typeof(source.allocations) = 'array'
  ), allocation_validity as (
    select source.source_key,
      source.allocation_sequence_no is null or (
        source.amount_snapshot = source.effective_amount
        and pg_catalog.jsonb_typeof(source.allocations) = 'array'
        and pg_catalog.jsonb_array_length(source.allocations) between 1 and 100
        and pg_catalog.count(item.ordinality)
          = pg_catalog.jsonb_array_length(source.allocations)
        and pg_catalog.count(item.allocation_project_id)
          = pg_catalog.jsonb_array_length(source.allocations)
        and pg_catalog.count(distinct item.allocation_project_id)
          = pg_catalog.jsonb_array_length(source.allocations)
        and coalesce(pg_catalog.sum(item.allocation_amount), 0)
          = source.effective_amount
      ) valid
    from effective source
    left join supplied_allocation_items item using (source_key)
    group by source.source_key, source.allocation_sequence_no,
      source.amount_snapshot, source.effective_amount, source.allocations
  ), final_allocations as (
    select source.source_key, source.project_id allocation_project_id,
      source.effective_amount allocation_amount
    from effective source
    join allocation_validity validity using (source_key)
    where source.allocation_sequence_no is null and validity.valid
    union all
    select item.source_key, item.allocation_project_id, item.allocation_amount
    from supplied_allocation_items item
    join allocation_validity validity using (source_key)
    where validity.valid
  ), ranked as (
    select source.*, allocation.allocation_project_id,
      allocation.allocation_amount,
      pg_catalog.row_number() over (
        partition by source.source_key
        order by allocation.allocation_project_id
      ) allocation_rank,
      pg_catalog.count(*) over (
        partition by source.source_key
      ) allocation_count
    from effective source
    join allocation_validity validity using (source_key)
    join final_allocations allocation using (source_key)
    where validity.valid
  ), tentative as (
    select ranked.*,
      case
        when allocation_rank < allocation_count and effective_amount <> 0
          then pg_catalog.round(
            original_amount * allocation_amount / effective_amount, 4
          )
        when allocation_rank < allocation_count then 0::numeric
        else null::numeric
      end tentative_original_amount
    from ranked
  ), allocated as (
    select tentative.*,
      case
        when allocation_rank = allocation_count then
          original_amount - coalesce(pg_catalog.sum(
            tentative_original_amount
          ) over (partition by source_key), 0)
        else tentative_original_amount
      end allocated_original_amount
    from tentative
  ), output_rows as (
    select
      source_key, source_module,
      pg_catalog.btrim(source_document_type) source_document_type,
      pg_catalog.btrim(source_document_id) source_document_id,
      allocation_project_id project_id,
      pg_catalog.btrim(case
        when allocation_project_id = allocated.project_id
          then allocated.project_name
        when pg_catalog.jsonb_typeof(project.payload->'projectName') = 'string'
          then coalesce(project.payload->>'projectName', '')
        else ''
      end) project_name,
      pg_catalog.btrim(category) category,
      cost_date,
      pg_catalog.btrim(description) description,
      allocated_original_amount::numeric(18,4) original_amount,
      (allocation_amount - allocated_original_amount)::numeric(18,4)
        adjustment_amount,
      allocation_amount::numeric(18,4) effective_amount,
      pg_catalog.btrim(operator) operator,
      (allocation_amount - allocated_original_amount) <> 0 adjusted,
      version,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'projectId', allocation_project_id,
        'amount', allocation_amount::numeric(18,4)
      )) allocations,
      audit_events,
      allocation_project_id allocation_sort_id
    from allocated
    left join public.projects project
      on project.record_key = allocated.allocation_project_id
  ), filtered as materialized (
    select * from output_rows row_value
    where (filter_project_id is null or row_value.project_id = filter_project_id)
      and (filter_date_from is null or row_value.cost_date >= filter_date_from)
      and (filter_date_to is null or row_value.cost_date <= filter_date_to)
      and (filter_category is null or row_value.category = filter_category)
      and (filter_source_module is null
        or row_value.source_module = filter_source_module)
      and (filter_adjusted is null
        or (filter_adjusted = 'adjusted' and row_value.adjusted)
        or (filter_adjusted = 'unadjusted' and not row_value.adjusted))
      and (filter_keyword is null or pg_catalog.strpos(
        pg_catalog.lower(
          row_value.description || ' ' || row_value.source_document_id
        ),
        pg_catalog.lower(filter_keyword)
      ) > 0)
  ), summary as (
    select pg_catalog.count(*)::integer total_rows,
      coalesce(pg_catalog.sum(effective_amount), 0)::numeric(18,4)
        total_amount,
      coalesce(pg_catalog.sum(adjustment_amount), 0)::numeric(18,4)
        adjustment_total
    from filtered
  ), category_totals as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'category', grouped.category,
        'amount', grouped.amount
      ) order by grouped.category_order, grouped.category
    ), '[]'::jsonb) value
    from (
      select category, pg_catalog.sum(effective_amount)::numeric(18,4) amount,
        case category
          when '人工费' then 1 when '材料费' then 2 when '车辆费' then 3
          when '工具费' then 4 when '外包费' then 5 when '运输费' then 6
          when '经营费用' then 7 when '其他费用' then 8 else 9
        end category_order
      from filtered
      group by category
    ) grouped
  ), page_rows as (
    select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'sourceKey', page.source_key,
        'sourceModule', page.source_module,
        'sourceDocumentType', page.source_document_type,
        'sourceDocumentId', page.source_document_id,
        'projectId', page.project_id,
        'projectName', page.project_name,
        'category', page.category,
        'date', pg_catalog.to_char(page.cost_date, 'YYYY-MM-DD'),
        'description', page.description,
        'originalAmount', page.original_amount,
        'adjustmentAmount', page.adjustment_amount,
        'effectiveAmount', page.effective_amount,
        'operator', page.operator,
        'adjusted', page.adjusted,
        'version', page.version,
        'allocations', page.allocations,
        'auditEvents', page.audit_events
      ) order by page.cost_date desc, page.source_key, page.allocation_sort_id
    ), '[]'::jsonb) value
    from (
      select *
      from filtered
      order by cost_date desc, source_key, allocation_sort_id
      limit requested_page_size
      offset ((requested_page - 1)::bigint * requested_page_size)
    ) page
  ), incomplete as (
    select coalesce(pg_catalog.jsonb_agg(
      validity.source_key order by validity.source_key
    ), '[]'::jsonb) value
    from allocation_validity validity
    where not validity.valid
  )
  select pg_catalog.jsonb_build_object(
      'status', 'ready',
      'generatedAt', pg_catalog.statement_timestamp(),
      'page', requested_page,
      'pageSize', requested_page_size,
      'totalRows', summary.total_rows,
      'rows', page_rows.value,
      'categoryTotals', category_totals.value,
      'totalAmount', summary.total_amount,
      'adjustmentTotal', summary.adjustment_total,
      'incompleteSources', incomplete.value
    )
    into response
    from summary
    cross join category_totals
    cross join page_rows
    cross join incomplete;

  return response;
end;
$$;

revoke all on function private.reject_project_cost_ledger_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_safe_amount(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_safe_date(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_payload_cancelled(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.private_project_cost_source_facts()
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_cost_ledger_secure(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_cost_ledger_secure(jsonb)
  to authenticated, service_role;

commit;

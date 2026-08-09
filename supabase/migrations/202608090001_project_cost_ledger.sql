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
  reason text not null default '历史直接录入',
  created_by_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  created_by_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint project_cost_manual_entries_source_key_check check (
    source_key = btrim(source_key)
    and source_key ~ '^manual:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
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
    and reason = btrim(reason) and char_length(reason) between 1 and 2000
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

create or replace function private.project_cost_checked_summary(p_value numeric)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
as $$
begin
  if p_value is null
    or p_value in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    or pg_catalog.abs(p_value) > 900719925474.0991
    or pg_catalog.round(p_value, 4) <> p_value
  then
    raise exception using
      errcode = '22003',
      message = 'project cost ledger summary exceeds Task 1 safe units';
  end if;
  return p_value::numeric(18,4);
end;
$$;

create or replace function private.project_cost_safe_text(
  p_value jsonb,
  p_allow_empty boolean,
  p_max_length integer
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  parsed text;
  trim_characters constant text := E' \t\n\r\f'
    || pg_catalog.chr(11)
    || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if pg_catalog.jsonb_typeof(p_value) is distinct from 'string'
    or p_allow_empty is null
    or p_max_length not between 1 and 2000
  then
    return null;
  end if;
  parsed := pg_catalog.btrim(p_value #>> '{}', trim_characters);
  if (not p_allow_empty and parsed = '')
    or pg_catalog.char_length(parsed) > p_max_length
    or parsed in ('__proto__', 'constructor', 'prototype')
  then
    return null;
  end if;
  return parsed;
end;
$$;

create or replace function private.project_cost_text_fields_valid(
  p_payload jsonb,
  p_fields text[]
)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select p_payload is not null
    and pg_catalog.jsonb_typeof(p_payload) = 'object'
    and not exists (
      select 1
      from pg_catalog.unnest(p_fields) supplied(field_name)
      where p_payload ? supplied.field_name
        and pg_catalog.jsonb_typeof(p_payload->supplied.field_name) <> 'string'
    );
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
  with warehouse_fact_candidates as (
    select cost.record_key, cost.payload,
      private.project_cost_safe_amount(cost.payload->'amount') amount_value,
      private.project_cost_safe_date(cost.payload->'date') cost_date
    from public.project_cost_records cost
    where cost.status = 'active'
      and not private.project_cost_payload_cancelled(cost.payload)
  ), validated_warehouse_facts as materialized (
    select candidate.record_key, candidate.payload,
      candidate.amount_value, candidate.cost_date
    from warehouse_fact_candidates candidate
    where candidate.record_key ~ '^WAREHOUSE-(SO|MWO|SR|WR):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and pg_catalog.jsonb_typeof(candidate.payload->'costRecordId') = 'string'
      and candidate.payload->>'costRecordId' = candidate.record_key
      and pg_catalog.jsonb_typeof(candidate.payload->'projectId') = 'string'
      and candidate.payload->>'projectId'
        = pg_catalog.btrim(candidate.payload->>'projectId')
      and pg_catalog.char_length(candidate.payload->>'projectId') between 1 and 500
      and candidate.payload->>'projectId' not in (
        '__proto__', 'constructor', 'prototype'
      )
      and exists (
        select 1 from public.projects project
        where project.record_key = candidate.payload->>'projectId'
      )
      and candidate.payload->>'costType' = '材料费'
      and candidate.cost_date is not null
      and candidate.amount_value is not null
      and pg_catalog.jsonb_typeof(
        candidate.payload->'sourcePurchaseRecordKeys'
      ) = 'array'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          candidate.payload->'sourcePurchaseRecordKeys'
        ) purchase_key(value)
        where pg_catalog.jsonb_typeof(purchase_key.value) <> 'string'
          or purchase_key.value #>> '{}' <> pg_catalog.btrim(purchase_key.value #>> '{}')
          or pg_catalog.char_length(purchase_key.value #>> '{}') not between 1 and 500
          or purchase_key.value #>> '{}' in (
            '__proto__', 'constructor', 'prototype'
          )
      )
      and (
        select pg_catalog.count(distinct purchase_key.value #>> '{}')
        from pg_catalog.jsonb_array_elements(
          candidate.payload->'sourcePurchaseRecordKeys'
        ) purchase_key(value)
      ) = pg_catalog.jsonb_array_length(
        candidate.payload->'sourcePurchaseRecordKeys'
      )
      and pg_catalog.jsonb_typeof(candidate.payload->'sourceStockOutIds') = 'array'
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(
          candidate.payload->'sourceStockOutIds'
        ) stock_out_id(value)
        where pg_catalog.jsonb_typeof(stock_out_id.value) <> 'string'
          or stock_out_id.value #>> '{}' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      and (
        select pg_catalog.count(distinct stock_out_id.value #>> '{}')
        from pg_catalog.jsonb_array_elements(
          candidate.payload->'sourceStockOutIds'
        ) stock_out_id(value)
      ) = pg_catalog.jsonb_array_length(candidate.payload->'sourceStockOutIds')
      and (
        (
          candidate.record_key like 'WAREHOUSE-SO:%'
          and candidate.payload->>'sourceType' = 'warehouse'
          and candidate.payload->>'sourceDocumentType' = 'warehouse_stock_out'
          and candidate.amount_value > 0
          and candidate.payload->>'sourceDocumentId'
            = pg_catalog.split_part(candidate.record_key, ':', 2)
          and candidate.payload->'sourceStockOutIds'
            = pg_catalog.jsonb_build_array(candidate.payload->>'sourceDocumentId')
        ) or (
          candidate.record_key like 'WAREHOUSE-MWO:%'
          and candidate.payload->>'sourceType' = 'warehouse'
          and candidate.payload->>'sourceDocumentType' = 'warehouse_minor_work_order'
          and candidate.amount_value >= 0
          and candidate.payload->>'sourceDocumentId'
            = pg_catalog.split_part(candidate.record_key, ':', 2)
          and pg_catalog.jsonb_array_length(
            candidate.payload->'sourceStockOutIds'
          ) > 0
        ) or (
          candidate.record_key like 'WAREHOUSE-SR:%'
          and candidate.payload->>'sourceType' = 'warehouseReversal'
          and candidate.payload->>'sourceDocumentType' = 'warehouse_return'
          and candidate.amount_value < 0
          and candidate.payload->>'sourceDocumentId'
            = pg_catalog.split_part(candidate.record_key, ':', 2)
          and pg_catalog.jsonb_array_length(
            candidate.payload->'sourceStockOutIds'
          ) = 1
        ) or (
          candidate.record_key like 'WAREHOUSE-WR:%'
          and candidate.payload->>'sourceType' = 'warehouseReversal'
          and candidate.payload->>'sourceDocumentType'
            = 'warehouse_operation_reversal'
          and candidate.payload->>'sourceDocumentId'
            = pg_catalog.split_part(candidate.record_key, ':', 2)
          and candidate.amount_value <> 0
          and candidate.payload->'sourcePurchaseRecordKeys' = '[]'::jsonb
          and pg_catalog.jsonb_array_length(
            candidate.payload->'sourceStockOutIds'
          ) between 0 and 1
        )
      )
  ), authoritative_warehouse_purchase_keys as (
    select distinct linked_key.value #>> '{}' purchase_record_key
    from validated_warehouse_facts warehouse_cost
    cross join lateral pg_catalog.jsonb_array_elements(
      warehouse_cost.payload->'sourcePurchaseRecordKeys'
    ) linked_key(value)
  ), purchase_facts as (
    select
      'purchase:' || purchase.record_key,
      'purchase'::text,
      'purchase_order'::text,
      purchase.record_key,
      case
        when pg_catalog.jsonb_typeof(purchase.payload->'projectId') = 'string'
          then purchase.payload->>'projectId'
        else null
      end,
      coalesce(private.project_cost_safe_text(
        purchase.payload->'projectName', true, 500
      ), ''),
      '材料费'::text,
      parsed.cost_date,
      coalesce(
        private.project_cost_safe_text(
          purchase.payload->'itemName', true, 2000
        ),
        private.project_cost_safe_text(
          purchase.payload->'remark', true, 2000
        ),
        ''
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        purchase.payload->'employeeName', true, 500
      ), '')
    from public.purchase_records purchase
    cross join lateral (
      select
        private.project_cost_safe_amount(purchase.payload->'totalCost') amount_value,
        private.project_cost_safe_date(purchase.payload->'purchaseDate') cost_date
    ) parsed
    where purchase.status not in ('deleted', 'void')
      and not private.project_cost_payload_cancelled(purchase.payload)
      and (
        purchase.payload->>'purchasePurpose' = '项目使用'
        or pg_catalog.jsonb_typeof(
          purchase.payload->'projectId'
        ) not in ('null', 'string')
        or (
          pg_catalog.jsonb_typeof(
            purchase.payload->'projectId'
          ) = 'string'
          and purchase.payload->>'projectId' <> ''
        )
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
      coalesce(private.project_cost_safe_text(
        cost.payload->'projectName', true, 500
      ), ''),
      '材料费'::text,
      parsed.cost_date,
      coalesce(private.project_cost_safe_text(
        cost.payload->'remark', true, 2000
      ), ''),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        cost.payload->'operator', true, 500
      ), '')
    from validated_warehouse_facts cost
    cross join lateral (
      select cost.amount_value, cost.cost_date
    ) parsed
    where cost.amount_value <> 0
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
      coalesce(private.project_cost_safe_text(
        fuel.payload->'projectName', true, 500
      ), ''),
      '车辆费'::text,
      parsed.cost_date,
      coalesce(
        private.project_cost_safe_text(fuel.payload->'remark', true, 2000),
        private.project_cost_safe_text(
          fuel.payload->'vehicleName', true, 2000
        ),
        '项目加油'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        fuel.payload->'employeeName', true, 500
      ), '')
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
      coalesce(private.project_cost_safe_text(
        expense.payload->'projectName', true, 500
      ), ''),
      '车辆费'::text,
      parsed.cost_date,
      coalesce(
        private.project_cost_safe_text(
          expense.payload->'remark', true, 2000
        ),
        private.project_cost_safe_text(
          expense.payload->'expenseType', true, 2000
        ),
        '车辆费用'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        expense.payload->'employeeName', true, 500
      ), '')
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
      coalesce(private.project_cost_safe_text(
        issue.payload->'projectName', true, 500
      ), ''),
      '车辆费'::text,
      parsed.cost_date,
      coalesce(
        private.project_cost_safe_text(
          issue.payload->'issueDescription', true, 2000
        ),
        private.project_cost_safe_text(issue.payload->'remark', true, 2000),
        '车辆维修'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        issue.payload->'employeeName', true, 500
      ), '')
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
      case
        when responsibility.payload ? 'issueType'
          and pg_catalog.jsonb_typeof(
            responsibility.payload->'issueType'
          ) <> 'string'
          then null
        else 'tool_responsibility'::text
      end,
      responsibility.record_key,
      case
        when pg_catalog.jsonb_typeof(
          responsibility.payload->'projectId'
        ) = 'string'
          then responsibility.payload->>'projectId'
        else null
      end,
      coalesce(private.project_cost_safe_text(
        responsibility.payload->'projectName', true, 500
      ), ''),
      '工具费'::text,
      parsed.cost_date,
      coalesce(
        private.project_cost_safe_text(
          responsibility.payload->'issueDescription', true, 2000
        ),
        private.project_cost_safe_text(
          responsibility.payload->'toolName', true, 2000
        ),
        '工具责任费用'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        responsibility.payload->'handlerEmployeeName', true, 500
      ), '')
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
      coalesce(private.project_cost_safe_text(
        expense.payload->'projectName', true, 500
      ), ''),
      '经营费用'::text,
      parsed.cost_date,
      coalesce(
        private.project_cost_safe_text(
          expense.payload->'remark', true, 2000
        ),
        private.project_cost_safe_text(
          expense.payload->'expenseType', true, 2000
        ),
        '经营费用'
      ),
      parsed.amount_value::numeric(18,4),
      coalesce(
        private.project_cost_safe_text(
          expense.payload->'operator', true, 500
        ),
        private.project_cost_safe_text(
          expense.payload->'employeeName', true, 500
        ),
        ''
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
      case
        when cost.payload ? 'sourceType'
          and pg_catalog.jsonb_typeof(cost.payload->'sourceType') <> 'string'
          then null
        else 'manual_project_cost'::text
      end,
      cost.record_key,
      case
        when pg_catalog.jsonb_typeof(cost.payload->'projectId') = 'string'
          then cost.payload->>'projectId'
        else null
      end,
      coalesce(private.project_cost_safe_text(
        cost.payload->'projectName', true, 500
      ), ''),
      case
        when not cost.payload ? 'costType'
          or cost.payload->'costType' = 'null'::jsonb
          then '其他费用'
        when pg_catalog.jsonb_typeof(cost.payload->'costType') = 'string'
          then coalesce(nullif(cost.payload->>'costType', ''), '其他费用')
        else null
      end,
      parsed.cost_date,
      coalesce(private.project_cost_safe_text(
        cost.payload->'remark', true, 2000
      ), ''),
      parsed.amount_value::numeric(18,4),
      coalesce(private.project_cost_safe_text(
        cost.payload->'operator', true, 500
      ), '')
    from public.project_cost_records cost
    cross join lateral (
      select
        private.project_cost_safe_amount(cost.payload->'amount') amount_value,
        private.project_cost_safe_date(cost.payload->'date') cost_date
    ) parsed
    where cost.status not in ('deleted', 'void')
      and (
        not cost.payload ? 'sourceType'
        or pg_catalog.jsonb_typeof(cost.payload->'sourceType') <> 'string'
        or cost.payload->>'sourceType' not in (
          'warehouse', 'warehouseReversal'
        )
      )
      and not private.project_cost_payload_cancelled(cost.payload)
      and parsed.cost_date is not null
      and parsed.amount_value is not null
      and parsed.amount_value <> 0
  ), manual_facts as (
    select
      manual.source_key,
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
  ), raw_facts(
    source_key, source_module, source_document_type, source_document_id,
    project_id, project_name, category, cost_date, description,
    original_amount, operator
  ) as (
    select * from purchase_facts
    union all select * from warehouse_facts
    union all select * from labor_facts
    union all select * from fuel_facts
    union all select * from vehicle_expense_facts
    union all select * from vehicle_issue_facts
    union all select * from tool_facts
    union all select * from operating_facts
    union all select * from legacy_manual_facts
    union all select * from manual_facts
  )
  select coalesce(
      normalized.source_key,
      'invalid:' || coalesce(normalized.source_module, 'source') || ':'
        || pg_catalog.md5(pg_catalog.to_jsonb(raw)::text)
    ),
    normalized.source_module,
    normalized.source_document_type, normalized.source_document_id,
    normalized.project_id, coalesce(normalized.project_name, ''),
    normalized.category, raw.cost_date, coalesce(normalized.description, ''),
    raw.original_amount, coalesce(normalized.operator, '')
  from raw_facts raw
  cross join lateral (
    select
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.source_key), false, 600
      ) source_key,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.source_module), false, 100
      ) source_module,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.source_document_type), false, 100
      ) source_document_type,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.source_document_id), false, 600
      ) source_document_id,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.project_id), false, 500
      ) project_id,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.project_name), true, 500
      ) project_name,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.category), false, 100
      ) category,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.description), true, 2000
      ) description,
      private.project_cost_safe_text(
        pg_catalog.to_jsonb(raw.operator), true, 500
      ) operator
  ) normalized;
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
  requested_page_value numeric := 1;
  requested_page_size_value numeric := 20;
  response jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger view permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  if p_filters is null
    or pg_catalog.jsonb_typeof(p_filters) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_filters) supplied(key)
      where supplied.key <> all(allowed_keys)
    )
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  begin
    if p_filters ? 'page' then
      if pg_catalog.jsonb_typeof(p_filters->'page') <> 'number' then
        raise data_exception;
      end if;
      requested_page_value := (p_filters->>'page')::numeric;
      if requested_page_value <> pg_catalog.trunc(requested_page_value)
        or requested_page_value not between 1 and 1000000
      then
        raise data_exception;
      end if;
      requested_page := requested_page_value::integer;
    end if;
    if p_filters ? 'pageSize' then
      if pg_catalog.jsonb_typeof(p_filters->'pageSize') <> 'number' then
        raise data_exception;
      end if;
      requested_page_size_value := (p_filters->>'pageSize')::numeric;
      if requested_page_size_value
          <> pg_catalog.trunc(requested_page_size_value)
        or requested_page_size_value not in (20, 50, 100)
      then
        raise data_exception;
      end if;
      requested_page_size := requested_page_size_value::integer;
    end if;
  exception when others then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end;
  if requested_page not between 1 and 1000000
    or requested_page_size not in (20, 50, 100)
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  if p_filters ? 'projectId' then
    if pg_catalog.jsonb_typeof(p_filters->'projectId') <> 'string' then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    filter_project_id := private.project_cost_safe_text(
      p_filters->'projectId', true, 500
    );
    if filter_project_id is null then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    if filter_project_id in ('', 'all') then filter_project_id := null; end if;
  end if;

  if p_filters ? 'category' then
    if pg_catalog.jsonb_typeof(p_filters->'category') <> 'string' then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    filter_category := p_filters->>'category';
    if filter_category in ('', 'all') then filter_category := null; end if;
    if filter_category is not null and (
      filter_category <> pg_catalog.btrim(filter_category)
      or pg_catalog.char_length(filter_category) > 100
    ) then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
  end if;

  if p_filters ? 'sourceModule' then
    if pg_catalog.jsonb_typeof(p_filters->'sourceModule') <> 'string' then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    filter_source_module := p_filters->>'sourceModule';
    if filter_source_module in ('', 'all') then filter_source_module := null; end if;
    if filter_source_module is not null and filter_source_module not in (
      'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual'
    ) then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
  end if;

  if p_filters ? 'adjusted' then
    if pg_catalog.jsonb_typeof(p_filters->'adjusted') <> 'string'
      or p_filters->>'adjusted' not in ('all', 'adjusted', 'unadjusted')
    then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    filter_adjusted := p_filters->>'adjusted';
    if filter_adjusted = 'all' then filter_adjusted := null; end if;
  end if;

  if p_filters ? 'keyword' then
    if pg_catalog.jsonb_typeof(p_filters->'keyword') <> 'string' then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    filter_keyword := p_filters->>'keyword';
    if filter_keyword = '' then filter_keyword := null; end if;
    if filter_keyword is not null and (
      filter_keyword <> pg_catalog.btrim(filter_keyword)
      or pg_catalog.char_length(filter_keyword) > 200
    ) then
      raise exception using
        errcode = '22023', message = 'invalid project cost ledger filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
  end if;

  if p_filters ? 'dateFrom' then
    if (p_filters->>'dateFrom') = '' then
      filter_date_from := null;
    else
      filter_date_from := private.project_cost_safe_date(p_filters->'dateFrom');
      if filter_date_from is null then
        raise exception using
          errcode = '22023', message = 'invalid project cost ledger filters',
          hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
      end if;
    end if;
  end if;
  if p_filters ? 'dateTo' then
    if (p_filters->>'dateTo') = '' then
      filter_date_to := null;
    else
      filter_date_to := private.project_cost_safe_date(p_filters->'dateTo');
      if filter_date_to is null then
        raise exception using
          errcode = '22023', message = 'invalid project cost ledger filters',
          hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
      end if;
    end if;
  end if;
  if filter_date_from is not null and filter_date_to is not null
    and filter_date_from > filter_date_to
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost ledger filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
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
      source.source_module is not null
        and source.source_document_type is not null
        and source.source_document_id is not null
        and source.project_id is not null
        and source.category is not null
        and (
          source.allocation_sequence_no is null or (
            source.amount_snapshot = source.effective_amount
            and pg_catalog.jsonb_typeof(source.allocations) = 'array'
            and pg_catalog.jsonb_array_length(source.allocations)
              between 1 and 100
            and pg_catalog.count(item.ordinality)
              = pg_catalog.jsonb_array_length(source.allocations)
            and pg_catalog.count(item.allocation_project_id)
              = pg_catalog.jsonb_array_length(source.allocations)
            and pg_catalog.count(distinct item.allocation_project_id)
              = pg_catalog.jsonb_array_length(source.allocations)
            and coalesce(pg_catalog.sum(item.allocation_amount), 0)
              = source.effective_amount
          )
        ) valid
    from effective source
    left join supplied_allocation_items item using (source_key)
    group by source.source_key, source.allocation_sequence_no,
      source.amount_snapshot, source.effective_amount, source.allocations,
      source.source_module, source.source_document_type,
      source.source_document_id, source.project_id, source.category
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
        else coalesce(
          private.project_cost_safe_text(
            project.payload->'projectName', true, 500
          ),
          ''
        )
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
      private.project_cost_checked_summary(
        coalesce(pg_catalog.sum(effective_amount), 0)
      )
        total_amount,
      private.project_cost_checked_summary(
        coalesce(pg_catalog.sum(adjustment_amount), 0)
      )
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
      select category,
        private.project_cost_checked_summary(
          pg_catalog.sum(effective_amount)
        ) amount,
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

create or replace function private.project_cost_source_state(p_source_key text)
returns table (
  source_key text,
  project_id text,
  cost_date date,
  original_amount numeric(18,4),
  effective_amount numeric(18,4),
  current_version bigint,
  allocations jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    fact.source_key,
    fact.project_id,
    fact.cost_date,
    fact.original_amount,
    coalesce(adjustment.amount_after, fact.original_amount)::numeric(18,4),
    greatest(
      coalesce(adjustment.sequence_no, 0),
      coalesce(allocation.sequence_no, 0)
    ) + 1,
    coalesce(
      allocation.allocations,
      pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'projectId', fact.project_id,
        'amount', coalesce(
          adjustment.amount_after, fact.original_amount
        )::numeric(18,4)
      ))
    )
  from private.private_project_cost_source_facts() fact
  left join lateral (
    select event.sequence_no, event.amount_after
    from public.project_cost_adjustment_events event
    where event.source_key = fact.source_key
    order by event.sequence_no desc
    limit 1
  ) adjustment on true
  left join lateral (
    select event.sequence_no, event.allocations
    from public.project_cost_allocation_events event
    where event.source_key = fact.source_key
    order by event.sequence_no desc
    limit 1
  ) allocation on true
  where fact.source_key = p_source_key;
$$;

create or replace function public.create_project_cost_adjustment_secure(
  p_source_key text,
  p_expected_version bigint,
  p_adjustment_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor public.employee_profiles%rowtype;
  source_state record;
  normalized_source_key text;
  normalized_reason text;
  amount_after numeric;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.update') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger update permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  normalized_source_key := private.project_cost_safe_text(
    pg_catalog.to_jsonb(p_source_key), false, 600
  );
  normalized_reason := private.project_cost_safe_text(
    pg_catalog.to_jsonb(p_reason), false, 2000
  );
  if normalized_source_key is null
    or normalized_reason is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_adjustment_amount is null
    or p_adjustment_amount in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    or p_adjustment_amount = 0
    or pg_catalog.abs(p_adjustment_amount) > 900719925474.0991
    or pg_catalog.round(p_adjustment_amount, 4) <> p_adjustment_amount
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and not employee.must_change_password
    and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  select * into source_state
  from private.project_cost_source_state(normalized_source_key);
  if not found or source_state.project_id is null then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_SOURCE_MISSING',
      hint = 'PROJECT_COST_LEDGER_SOURCE_MISSING';
  end if;
  if source_state.current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_source_key, 0)
  ) then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;
  select * into source_state
  from private.project_cost_source_state(normalized_source_key);
  if not found or source_state.project_id is null then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_SOURCE_MISSING',
      hint = 'PROJECT_COST_LEDGER_SOURCE_MISSING';
  end if;
  if source_state.current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;

  amount_after := source_state.effective_amount + p_adjustment_amount;
  if amount_after in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    or pg_catalog.abs(amount_after) > 900719925474.0991
    or pg_catalog.round(amount_after, 4) <> amount_after
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  insert into public.project_cost_adjustment_events(
    source_key, sequence_no, amount_before, adjustment_amount, amount_after,
    reason, actor_employee_profile_id, actor_name, created_at
  ) values (
    normalized_source_key, source_state.current_version,
    source_state.effective_amount, p_adjustment_amount::numeric(18,4),
    amount_after::numeric(18,4), normalized_reason, actor.id, actor.name,
    pg_catalog.statement_timestamp()
  );

  return pg_catalog.jsonb_build_object(
    'sourceKey', normalized_source_key,
    'version', source_state.current_version + 1,
    'effectiveAmount', amount_after::numeric(18,4)
  );
end;
$$;

create or replace function public.replace_project_cost_allocations_secure(
  p_source_key text,
  p_expected_version bigint,
  p_reason text,
  p_allocations jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor public.employee_profiles%rowtype;
  source_state record;
  normalized_source_key text;
  normalized_reason text;
  normalized_allocations jsonb;
  allocation_total numeric;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.update') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger update permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  normalized_source_key := private.project_cost_safe_text(
    pg_catalog.to_jsonb(p_source_key), false, 600
  );
  normalized_reason := private.project_cost_safe_text(
    pg_catalog.to_jsonb(p_reason), false, 2000
  );
  if normalized_source_key is null
    or normalized_reason is null
    or p_expected_version is null
    or p_expected_version < 1
    or pg_catalog.jsonb_typeof(p_allocations) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_allocations) not between 1 and 100
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_allocations) item(value)
      where pg_catalog.jsonb_typeof(item.value) is distinct from 'object'
        or (select pg_catalog.count(*)
            from pg_catalog.jsonb_object_keys(item.value)) <> 2
        or not item.value ? 'projectId'
        or not item.value ? 'amount'
        or private.project_cost_safe_text(
          item.value->'projectId', false, 500
        ) is null
        or private.project_cost_safe_amount(item.value->'amount') is null
        or private.project_cost_safe_amount(item.value->'amount') = 0
    )
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  if (select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(p_allocations)) <>
    (select pg_catalog.count(distinct private.project_cost_safe_text(
        item.value->'projectId', false, 500
      ))
     from pg_catalog.jsonb_array_elements(p_allocations) item(value))
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'projectId', private.project_cost_safe_text(
        item.value->'projectId', false, 500
      ),
      'amount', private.project_cost_safe_amount(item.value->'amount')::numeric(18,4)
    ) order by item.ordinality),
    pg_catalog.sum(private.project_cost_safe_amount(item.value->'amount'))
    into normalized_allocations, allocation_total
  from pg_catalog.jsonb_array_elements(p_allocations)
    with ordinality item(value, ordinality);

  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and not employee.must_change_password
    and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  select * into source_state
  from private.project_cost_source_state(normalized_source_key);
  if not found or source_state.project_id is null then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_SOURCE_MISSING',
      hint = 'PROJECT_COST_LEDGER_SOURCE_MISSING';
  end if;
  if source_state.current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_source_key, 0)
  ) then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;
  select * into source_state
  from private.project_cost_source_state(normalized_source_key);
  if not found or source_state.project_id is null then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_SOURCE_MISSING',
      hint = 'PROJECT_COST_LEDGER_SOURCE_MISSING';
  end if;
  if source_state.current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;
  if allocation_total <> source_state.effective_amount then
    raise exception using
      errcode = '22023',
      message = 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED',
      hint = 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED';
  end if;

  perform project.record_key
  from public.projects project
  where project.record_key in (
    select item.value->>'projectId'
    from pg_catalog.jsonb_array_elements(normalized_allocations) item(value)
  )
  order by project.record_key
  for share;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(normalized_allocations) item(value)
    where not exists (
      select 1
      from public.projects project
      where project.record_key = item.value->>'projectId'
        and project.status = 'active'
        and not private.project_cost_payload_cancelled(project.payload)
    )
  ) then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  insert into public.project_cost_allocation_events(
    source_key, sequence_no, amount_snapshot, allocations, reason,
    actor_employee_profile_id, actor_name, created_at
  ) values (
    normalized_source_key, source_state.current_version,
    source_state.effective_amount, normalized_allocations, normalized_reason,
    actor.id, actor.name, pg_catalog.statement_timestamp()
  );

  return pg_catalog.jsonb_build_object(
    'sourceKey', normalized_source_key,
    'version', source_state.current_version + 1,
    'allocations', normalized_allocations
  );
end;
$$;

create or replace function public.create_manual_project_cost_secure(
  p_request_id uuid,
  p_entry jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor public.employee_profiles%rowtype;
  existing public.project_cost_manual_entries%rowtype;
  project_row public.projects%rowtype;
  source_key_value text;
  project_id_value text;
  project_name_value text;
  category_value text;
  cost_date_value date;
  amount_value numeric;
  description_value text;
  operator_value text;
  reason_value text;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.create') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger create permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  if p_request_id is null
    or pg_catalog.jsonb_typeof(p_entry) is distinct from 'object'
    or (select pg_catalog.count(*)
        from pg_catalog.jsonb_object_keys(p_entry)) <> 7
    or not p_entry ?& array[
      'projectId', 'category', 'date', 'amount', 'description', 'operator', 'reason'
    ]::text[]
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  project_id_value := private.project_cost_safe_text(
    p_entry->'projectId', false, 500
  );
  category_value := private.project_cost_safe_text(
    p_entry->'category', false, 100
  );
  cost_date_value := private.project_cost_safe_date(p_entry->'date');
  amount_value := private.project_cost_safe_amount(p_entry->'amount');
  description_value := private.project_cost_safe_text(
    p_entry->'description', false, 2000
  );
  operator_value := private.project_cost_safe_text(
    p_entry->'operator', false, 500
  );
  reason_value := private.project_cost_safe_text(
    p_entry->'reason', false, 2000
  );
  if project_id_value is null
    or category_value is null
    or cost_date_value is null
    or amount_value is null
    or amount_value = 0
    or description_value is null
    or operator_value is null
    or reason_value is null
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and not employee.must_change_password
    and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  source_key_value := 'manual:' || p_request_id::text;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(source_key_value, 0)
  );
  select entry.* into existing
  from public.project_cost_manual_entries entry
  where entry.source_key = source_key_value;
  if found then
    if existing.project_id <> project_id_value
      or existing.category <> category_value
      or existing.cost_date <> cost_date_value
      or existing.original_amount <> amount_value
      or existing.description <> description_value
      or existing.operator <> operator_value
      or existing.reason <> reason_value
    then
      raise exception using
        errcode = '22023', message = 'PROJECT_COST_LEDGER_REQUEST_CONFLICT',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    return pg_catalog.jsonb_build_object(
      'sourceKey', existing.source_key,
      'projectId', existing.project_id,
      'category', existing.category,
      'date', pg_catalog.to_char(existing.cost_date, 'YYYY-MM-DD'),
      'amount', existing.original_amount,
      'description', existing.description,
      'operator', existing.operator,
      'reason', existing.reason,
      'actorName', existing.created_by_name,
      'createdAt', existing.created_at
    );
  end if;

  select project.* into project_row
  from public.projects project
  where project.record_key = project_id_value
  order by project.record_key
  for share;
  if not found
    or project_row.status <> 'active'
    or private.project_cost_payload_cancelled(project_row.payload)
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;
  project_name_value := coalesce(private.project_cost_safe_text(
    project_row.payload->'projectName', true, 500
  ), '');

  insert into public.project_cost_manual_entries(
    source_key, project_id, project_name, category, cost_date,
    original_amount, description, operator, reason,
    created_by_employee_profile_id, created_by_name, created_at
  ) values (
    source_key_value, project_id_value, project_name_value, category_value,
    cost_date_value, amount_value::numeric(18,4), description_value,
    operator_value, reason_value, actor.id, actor.name,
    pg_catalog.statement_timestamp()
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'sourceKey', existing.source_key,
    'projectId', existing.project_id,
    'category', existing.category,
    'date', pg_catalog.to_char(existing.cost_date, 'YYYY-MM-DD'),
    'amount', existing.original_amount,
    'description', existing.description,
    'operator', existing.operator,
    'reason', existing.reason,
    'actorName', existing.created_by_name,
    'createdAt', existing.created_at
  );
end;
$$;

create or replace function public.list_project_cost_audit_secure(
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
    'projectId', 'dateFrom', 'dateTo'
  ]::text[];
  filter_project_id text;
  filter_date_from date;
  filter_date_to date;
  response jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.view') then
    raise exception using
      errcode = '42501', message = 'project cost ledger view permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if p_filters is null
    or pg_catalog.jsonb_typeof(p_filters) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_filters) supplied(key)
      where supplied.key <> all(allowed_keys)
    )
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost audit filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  if p_filters ? 'projectId' then
    if pg_catalog.jsonb_typeof(p_filters->'projectId') <> 'string' then
      raise exception using
        errcode = '22023', message = 'invalid project cost audit filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    filter_project_id := private.project_cost_safe_text(
      p_filters->'projectId', true, 500
    );
    if filter_project_id is null then
      raise exception using
        errcode = '22023', message = 'invalid project cost audit filters',
        hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
    end if;
    if filter_project_id in ('', 'all') then filter_project_id := null; end if;
  end if;
  if p_filters ? 'dateFrom' then
    if pg_catalog.jsonb_typeof(p_filters->'dateFrom') = 'string'
      and p_filters->>'dateFrom' = ''
    then
      filter_date_from := null;
    else
      filter_date_from := private.project_cost_safe_date(p_filters->'dateFrom');
      if filter_date_from is null then
        raise exception using
          errcode = '22023', message = 'invalid project cost audit filters',
          hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
      end if;
    end if;
  end if;
  if p_filters ? 'dateTo' then
    if pg_catalog.jsonb_typeof(p_filters->'dateTo') = 'string'
      and p_filters->>'dateTo' = ''
    then
      filter_date_to := null;
    else
      filter_date_to := private.project_cost_safe_date(p_filters->'dateTo');
      if filter_date_to is null then
        raise exception using
          errcode = '22023', message = 'invalid project cost audit filters',
          hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
      end if;
    end if;
  end if;
  if filter_date_from is not null and filter_date_to is not null
    and filter_date_from > filter_date_to
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost audit filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  with facts as materialized (
    select * from private.private_project_cost_source_facts()
  ), current_allocations as (
    select fact.source_key, fact.project_id,
      coalesce(allocation.allocations, pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'projectId', fact.project_id,
          'amount', coalesce(adjustment.amount_after, fact.original_amount)
        )
      )) allocations
    from facts fact
    left join lateral (
      select event.amount_after
      from public.project_cost_adjustment_events event
      where event.source_key = fact.source_key
      order by event.sequence_no desc limit 1
    ) adjustment on true
    left join lateral (
      select event.allocations
      from public.project_cost_allocation_events event
      where event.source_key = fact.source_key
      order by event.sequence_no desc limit 1
    ) allocation on true
  ), audit_events as (
    select
      'adjustment'::text event_type,
      adjustment.source_key,
      adjustment.sequence_no,
      adjustment.amount_before,
      adjustment.amount_after,
      adjustment.adjustment_amount,
      null::jsonb allocations_before,
      null::jsonb allocations_after,
      adjustment.reason,
      adjustment.actor_name,
      adjustment.created_at,
      fact.cost_date
    from public.project_cost_adjustment_events adjustment
    join facts fact using (source_key)
    union all
    select
      'allocation'::text,
      allocation.source_key,
      allocation.sequence_no,
      allocation.amount_snapshot,
      allocation.amount_snapshot,
      0::numeric,
      coalesce((
        select previous.allocations
        from public.project_cost_allocation_events previous
        where previous.source_key = allocation.source_key
          and previous.sequence_no < allocation.sequence_no
        order by previous.sequence_no desc limit 1
      ), pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'projectId', fact.project_id,
        'amount', allocation.amount_snapshot
      ))),
      allocation.allocations,
      allocation.reason,
      allocation.actor_name,
      allocation.created_at,
      fact.cost_date
    from public.project_cost_allocation_events allocation
    join facts fact using (source_key)
  ), filtered as (
    select event.*
    from audit_events event
    join current_allocations current using (source_key)
    where (filter_date_from is null or event.cost_date >= filter_date_from)
      and (filter_date_to is null or event.cost_date <= filter_date_to)
      and (filter_project_id is null or exists (
        select 1
        from pg_catalog.jsonb_array_elements(current.allocations) item(value)
        where item.value->>'projectId' = filter_project_id
      ))
  )
  select pg_catalog.jsonb_build_object(
    'status', 'ready',
    'generatedAt', pg_catalog.statement_timestamp(),
    'events', coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'eventType', event.event_type,
        'sourceKey', event.source_key,
        'sequenceNo', event.sequence_no,
        'amountBefore', event.amount_before,
        'amountAfter', event.amount_after,
        'adjustmentAmount', event.adjustment_amount,
        'allocationsBefore', event.allocations_before,
        'allocationsAfter', event.allocations_after,
        'reason', event.reason,
        'actorName', event.actor_name,
        'createdAt', event.created_at
      ) order by event.created_at, event.source_key,
        event.sequence_no, event.event_type
    ), '[]'::jsonb)
  ) into response
  from filtered event;

  return response;
end;
$$;

revoke all on function private.reject_project_cost_ledger_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_safe_amount(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_safe_date(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_checked_summary(numeric)
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_safe_text(jsonb, boolean, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_text_fields_valid(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_payload_cancelled(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.private_project_cost_source_facts()
  from public, anon, authenticated, service_role;
revoke all on function private.project_cost_source_state(text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_cost_ledger_secure(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_project_cost_adjustment_secure(
  text, bigint, numeric, text
) from public, anon, authenticated, service_role;
revoke all on function public.replace_project_cost_allocations_secure(
  text, bigint, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_manual_project_cost_secure(uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.list_project_cost_audit_secure(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_cost_ledger_secure(jsonb)
  to authenticated, service_role;
grant execute on function public.create_project_cost_adjustment_secure(
  text, bigint, numeric, text
) to authenticated, service_role;
grant execute on function public.replace_project_cost_allocations_secure(
  text, bigint, text, jsonb
) to authenticated, service_role;
grant execute on function public.create_manual_project_cost_secure(uuid, jsonb)
  to authenticated, service_role;
grant execute on function public.list_project_cost_audit_secure(jsonb)
  to authenticated, service_role;

commit;

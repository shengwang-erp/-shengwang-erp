-- Pending warehouse documents and lightweight jobs. Submission is deliberately
-- stock-neutral; confirmation and costing are added by later Phase 3 tasks.

begin;

create table public.warehouse_minor_work_orders (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  customer_name text not null,
  work_date date not null,
  location_text text not null,
  description text not null default '',
  status text not null default 'open',
  assigned_project_id text,
  created_by_employee_profile_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint warehouse_minor_work_title_check check (
    title = btrim(title) and char_length(title) between 1 and 300
  ),
  constraint warehouse_minor_work_customer_check check (
    customer_name = btrim(customer_name) and char_length(customer_name) between 1 and 300
  ),
  constraint warehouse_minor_work_location_check check (
    location_text = btrim(location_text) and char_length(location_text) between 1 and 500
  ),
  constraint warehouse_minor_work_description_check check (
    description = btrim(description) and char_length(description) <= 2000
  ),
  constraint warehouse_minor_work_status_check check (
    status in ('open', 'assigned', 'closed', 'void')
  ),
  constraint warehouse_minor_work_assignment_check check (
    (status = 'assigned' and assigned_project_id is not null)
    or (status <> 'assigned')
  ),
  constraint warehouse_minor_work_project_fk foreign key (assigned_project_id)
    references public.projects(record_key) on delete restrict,
  constraint warehouse_minor_work_creator_fk foreign key (created_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict
);

create table public.warehouse_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_record_key text not null,
  status text not null default 'pending',
  submitted_by_employee_profile_id uuid not null,
  submitted_at timestamptz not null default statement_timestamp(),
  confirmed_by_employee_profile_id uuid,
  confirmed_at timestamptz,
  rejection_reason text,
  idempotency_key text not null,
  constraint warehouse_receipts_status_check check (
    status in ('pending', 'confirmed', 'rejected', 'void')
  ),
  constraint warehouse_receipts_idempotency_check check (
    idempotency_key = btrim(idempotency_key)
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  constraint warehouse_receipts_rejection_check check (
    rejection_reason is null
    or (rejection_reason = btrim(rejection_reason) and char_length(rejection_reason) between 1 and 1000)
  ),
  constraint warehouse_receipts_purchase_fk foreign key (purchase_record_key)
    references public.purchase_records(record_key) on delete restrict,
  constraint warehouse_receipts_submitter_fk foreign key (submitted_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_receipts_confirmer_fk foreign key (confirmed_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_receipts_idempotency_unique unique (idempotency_key)
);

create table public.warehouse_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  variant_id uuid not null,
  requested_quantity numeric(18,3) not null,
  confirmed_quantity numeric(18,3),
  warehouse_id uuid not null,
  location_id uuid not null,
  unit_cost numeric(18,4),
  constraint warehouse_receipt_lines_quantity_check check (
    requested_quantity > 0
    and requested_quantity not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and (confirmed_quantity is null or (
      confirmed_quantity > 0 and confirmed_quantity <= requested_quantity
      and confirmed_quantity not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ))
  ),
  constraint warehouse_receipt_lines_cost_check check (
    unit_cost is null or (
      unit_cost >= 0 and unit_cost not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )
  ),
  constraint warehouse_receipt_lines_receipt_fk foreign key (receipt_id)
    references public.warehouse_receipts(id) on delete restrict,
  constraint warehouse_receipt_lines_variant_fk foreign key (variant_id)
    references public.warehouse_variants(id) on delete restrict,
  constraint warehouse_receipt_lines_location_warehouse_fk foreign key (location_id, warehouse_id)
    references public.warehouse_locations(id, warehouse_id) on delete restrict,
  constraint warehouse_receipt_lines_resource_unique unique (receipt_id, variant_id, location_id)
);

create table public.warehouse_stock_out_requests (
  id uuid primary key default gen_random_uuid(),
  destination_type text not null,
  project_id text,
  minor_work_order_id uuid,
  destination_name_snapshot text not null,
  purpose text not null,
  receiver text not null,
  request_date date not null,
  status text not null default 'pending',
  submitted_by_employee_profile_id uuid not null,
  submitted_at timestamptz not null default statement_timestamp(),
  confirmed_by_employee_profile_id uuid,
  confirmed_at timestamptz,
  rejection_reason text,
  idempotency_key text not null,
  constraint warehouse_stock_out_status_check check (
    status in ('pending', 'confirmed', 'rejected', 'void')
  ),
  constraint warehouse_stock_out_destination_type_check check (
    destination_type in ('project', 'minor_work_order', 'internal_use')
  ),
  constraint warehouse_stock_out_destination_exact_check check (
    (destination_type = 'project' and project_id is not null and minor_work_order_id is null)
    or (destination_type = 'minor_work_order' and project_id is null and minor_work_order_id is not null)
    or (destination_type = 'internal_use' and project_id is null and minor_work_order_id is null)
  ),
  constraint warehouse_stock_out_snapshot_check check (
    destination_name_snapshot = btrim(destination_name_snapshot)
    and char_length(destination_name_snapshot) between 1 and 500
    and purpose = btrim(purpose) and char_length(purpose) between 1 and 1000
    and receiver = btrim(receiver) and char_length(receiver) between 1 and 300
  ),
  constraint warehouse_stock_out_idempotency_check check (
    idempotency_key = btrim(idempotency_key)
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  constraint warehouse_stock_out_rejection_check check (
    rejection_reason is null
    or (rejection_reason = btrim(rejection_reason) and char_length(rejection_reason) between 1 and 1000)
  ),
  constraint warehouse_stock_out_project_fk foreign key (project_id)
    references public.projects(record_key) on delete restrict,
  constraint warehouse_stock_out_minor_fk foreign key (minor_work_order_id)
    references public.warehouse_minor_work_orders(id) on delete restrict,
  constraint warehouse_stock_out_submitter_fk foreign key (submitted_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_stock_out_confirmer_fk foreign key (confirmed_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_stock_out_idempotency_unique unique (idempotency_key)
);

create table public.warehouse_stock_out_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  variant_id uuid not null,
  requested_quantity numeric(18,3) not null,
  confirmed_quantity numeric(18,3),
  frozen_total_cost numeric(18,4),
  constraint warehouse_stock_out_lines_quantity_check check (
    requested_quantity > 0
    and requested_quantity not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and (confirmed_quantity is null or (
      confirmed_quantity > 0 and confirmed_quantity <= requested_quantity
      and confirmed_quantity not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ))
  ),
  constraint warehouse_stock_out_lines_cost_check check (
    frozen_total_cost is null or (
      frozen_total_cost >= 0
      and frozen_total_cost not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )
  ),
  constraint warehouse_stock_out_lines_request_fk foreign key (request_id)
    references public.warehouse_stock_out_requests(id) on delete restrict,
  constraint warehouse_stock_out_lines_variant_fk foreign key (variant_id)
    references public.warehouse_variants(id) on delete restrict,
  constraint warehouse_stock_out_lines_variant_unique unique (request_id, variant_id)
);

create table public.warehouse_return_requests (
  id uuid primary key default gen_random_uuid(),
  original_stock_out_id uuid not null,
  reason text not null,
  receiver text not null,
  request_date date not null,
  status text not null default 'pending',
  submitted_by_employee_profile_id uuid not null,
  submitted_at timestamptz not null default statement_timestamp(),
  confirmed_by_employee_profile_id uuid,
  confirmed_at timestamptz,
  rejection_reason text,
  idempotency_key text not null,
  constraint warehouse_return_status_check check (
    status in ('pending', 'confirmed', 'rejected', 'void')
  ),
  constraint warehouse_return_text_check check (
    reason = btrim(reason) and char_length(reason) between 1 and 1000
    and receiver = btrim(receiver) and char_length(receiver) between 1 and 300
  ),
  constraint warehouse_return_idempotency_check check (
    idempotency_key = btrim(idempotency_key)
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  ),
  constraint warehouse_return_rejection_check check (
    rejection_reason is null
    or (rejection_reason = btrim(rejection_reason) and char_length(rejection_reason) between 1 and 1000)
  ),
  constraint warehouse_return_original_fk foreign key (original_stock_out_id)
    references public.warehouse_stock_out_requests(id) on delete restrict,
  constraint warehouse_return_submitter_fk foreign key (submitted_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_return_confirmer_fk foreign key (confirmed_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_return_idempotency_unique unique (idempotency_key)
);

create table public.warehouse_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null,
  original_stock_out_line_id uuid not null,
  requested_quantity numeric(18,3) not null,
  confirmed_quantity numeric(18,3),
  frozen_total_cost numeric(18,4),
  constraint warehouse_return_lines_quantity_check check (
    requested_quantity > 0
    and requested_quantity not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    and (confirmed_quantity is null or (
      confirmed_quantity > 0 and confirmed_quantity <= requested_quantity
      and confirmed_quantity not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    ))
  ),
  constraint warehouse_return_lines_cost_check check (
    frozen_total_cost is null or (
      frozen_total_cost >= 0
      and frozen_total_cost not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    )
  ),
  constraint warehouse_return_lines_return_fk foreign key (return_id)
    references public.warehouse_return_requests(id) on delete restrict,
  constraint warehouse_return_lines_stock_out_fk foreign key (original_stock_out_line_id)
    references public.warehouse_stock_out_lines(id) on delete restrict,
  constraint warehouse_return_lines_original_unique unique (return_id, original_stock_out_line_id)
);

create index warehouse_receipts_purchase_status_idx
  on public.warehouse_receipts(purchase_record_key, status, submitted_at, id);
create index warehouse_receipt_lines_variant_idx
  on public.warehouse_receipt_lines(variant_id, receipt_id);
create index warehouse_stock_out_requests_project_status_idx
  on public.warehouse_stock_out_requests(project_id, status, request_date, id)
  where project_id is not null;
create index warehouse_stock_out_requests_minor_status_idx
  on public.warehouse_stock_out_requests(minor_work_order_id, status, request_date, id)
  where minor_work_order_id is not null;
create index warehouse_stock_out_lines_variant_idx
  on public.warehouse_stock_out_lines(variant_id, request_id);
create index warehouse_return_requests_original_status_idx
  on public.warehouse_return_requests(original_stock_out_id, status, request_date, id);
create index warehouse_return_lines_original_idx
  on public.warehouse_return_lines(original_stock_out_line_id, return_id);

create trigger set_warehouse_minor_work_orders_updated_at
before update on public.warehouse_minor_work_orders
for each row execute function public.set_updated_at();

alter table public.warehouse_minor_work_orders enable row level security;
alter table public.warehouse_receipts enable row level security;
alter table public.warehouse_receipt_lines enable row level security;
alter table public.warehouse_stock_out_requests enable row level security;
alter table public.warehouse_stock_out_lines enable row level security;
alter table public.warehouse_return_requests enable row level security;
alter table public.warehouse_return_lines enable row level security;

revoke all on table
  public.warehouse_minor_work_orders,
  public.warehouse_receipts,
  public.warehouse_receipt_lines,
  public.warehouse_stock_out_requests,
  public.warehouse_stock_out_lines,
  public.warehouse_return_requests,
  public.warehouse_return_lines
from public, anon, authenticated, service_role;

create or replace function private.warehouse_workflow_text(
  p_value jsonb,
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
  if jsonb_typeof(p_value->p_field) is distinct from 'string' then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  result := private.normalize_warehouse_catalog_text(p_value->>p_field);
  if (p_required and result = '')
    or char_length(result) > p_maximum
    or private.warehouse_catalog_has_invisible(result)
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  return result;
end;
$$;

create or replace function private.warehouse_workflow_uuid(p_value jsonb, p_field text)
returns uuid
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare result uuid;
begin
  if jsonb_typeof(p_value->p_field) is distinct from 'string' then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  begin result := (p_value->>p_field)::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end;
  return result;
end;
$$;

create or replace function private.warehouse_workflow_quantity(p_value jsonb)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare result numeric;
begin
  if jsonb_typeof(p_value->'requestedQuantity') is distinct from 'number' then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  begin result := (p_value->>'requestedQuantity')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end;
  if result <= 0 or result > 999999999999999.999 or result <> trunc(result, 3)
    or result in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  return result;
end;
$$;

create or replace function private.warehouse_workflow_date(p_value jsonb, p_field text)
returns date
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare raw text; result date;
begin
  if jsonb_typeof(p_value->p_field) is distinct from 'string' then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  raw := p_value->>p_field;
  if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  begin result := raw::date;
  exception when datetime_field_overflow then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end;
  if to_char(result, 'YYYY-MM-DD') <> raw then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  return result;
end;
$$;

create or replace function private.warehouse_workflow_idempotency(p_value text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if p_value is null or p_value <> btrim(p_value)
    or p_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  return p_value;
end;
$$;

create or replace function private.warehouse_workflow_lines(p_lines jsonb)
returns void
language plpgsql
immutable
set search_path = pg_catalog
as $$
begin
  if jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 100
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
end;
$$;

create or replace function private.reject_warehouse_destination_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.destination_type is distinct from old.destination_type
    or new.project_id is distinct from old.project_id
    or new.minor_work_order_id is distinct from old.minor_work_order_id
    or new.destination_name_snapshot is distinct from old.destination_name_snapshot
    or new.purpose is distinct from old.purpose
    or new.receiver is distinct from old.receiver
    or new.request_date is distinct from old.request_date
  then
    raise exception using errcode = '55000', message = 'submitted warehouse destination is immutable';
  end if;
  return new;
end;
$$;

create trigger reject_warehouse_destination_mutation
before update on public.warehouse_stock_out_requests
for each row execute function private.reject_warehouse_destination_mutation();

create or replace function private.warehouse_minor_work_order_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', job.id, 'title', job.title, 'customerName', job.customer_name,
    'workDate', job.work_date, 'locationText', job.location_text,
    'description', job.description, 'status', job.status,
    'assignedProjectId', job.assigned_project_id,
    'createdByEmployeeProfileId', job.created_by_employee_profile_id,
    'createdAt', job.created_at, 'updatedAt', job.updated_at
  )
  from public.warehouse_minor_work_orders job where job.id = p_id
$$;

create or replace function private.warehouse_receipt_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', receipt.id, 'purchaseRecordKey', receipt.purchase_record_key,
    'status', receipt.status,
    'submittedByEmployeeProfileId', receipt.submitted_by_employee_profile_id,
    'submittedAt', receipt.submitted_at,
    'confirmedByEmployeeProfileId', receipt.confirmed_by_employee_profile_id,
    'confirmedAt', receipt.confirmed_at, 'rejectionReason', receipt.rejection_reason,
    'idempotencyKey', receipt.idempotency_key,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'receiptId', line.receipt_id, 'variantId', line.variant_id,
        'requestedQuantity', line.requested_quantity,
        'confirmedQuantity', line.confirmed_quantity,
        'warehouseId', line.warehouse_id, 'locationId', line.location_id,
        'unitCost', line.unit_cost
      ) order by line.id)
      from public.warehouse_receipt_lines line where line.receipt_id = receipt.id
    ), '[]'::jsonb)
  ) from public.warehouse_receipts receipt where receipt.id = p_id
$$;

create or replace function private.warehouse_stock_out_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', request.id, 'destinationType', request.destination_type,
    'projectId', request.project_id, 'minorWorkOrderId', request.minor_work_order_id,
    'destinationNameSnapshot', request.destination_name_snapshot,
    'purpose', request.purpose, 'receiver', request.receiver,
    'requestDate', request.request_date, 'status', request.status,
    'submittedByEmployeeProfileId', request.submitted_by_employee_profile_id,
    'submittedAt', request.submitted_at,
    'confirmedByEmployeeProfileId', request.confirmed_by_employee_profile_id,
    'confirmedAt', request.confirmed_at, 'rejectionReason', request.rejection_reason,
    'idempotencyKey', request.idempotency_key,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'requestId', line.request_id, 'variantId', line.variant_id,
        'requestedQuantity', line.requested_quantity,
        'confirmedQuantity', line.confirmed_quantity,
        'frozenTotalCost', line.frozen_total_cost
      ) order by line.id)
      from public.warehouse_stock_out_lines line where line.request_id = request.id
    ), '[]'::jsonb)
  ) from public.warehouse_stock_out_requests request where request.id = p_id
$$;

create or replace function private.warehouse_return_json(p_id uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', request.id, 'originalStockOutId', request.original_stock_out_id,
    'reason', request.reason, 'receiver', request.receiver,
    'requestDate', request.request_date, 'status', request.status,
    'submittedByEmployeeProfileId', request.submitted_by_employee_profile_id,
    'submittedAt', request.submitted_at,
    'confirmedByEmployeeProfileId', request.confirmed_by_employee_profile_id,
    'confirmedAt', request.confirmed_at, 'rejectionReason', request.rejection_reason,
    'idempotencyKey', request.idempotency_key,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'returnId', line.return_id,
        'originalStockOutLineId', line.original_stock_out_line_id,
        'requestedQuantity', line.requested_quantity,
        'confirmedQuantity', line.confirmed_quantity,
        'frozenTotalCost', line.frozen_total_cost
      ) order by line.id)
      from public.warehouse_return_lines line where line.return_id = request.id
    ), '[]'::jsonb)
  ) from public.warehouse_return_requests request where request.id = p_id
$$;

create or replace function public.create_minor_work_order_secure(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare actor_id uuid; saved_id uuid;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.request');
  if not private.warehouse_catalog_payload_keys_exact(
    p_payload, array['title','customerName','workDate','locationText','description']
  ) then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  insert into public.warehouse_minor_work_orders(
    title, customer_name, work_date, location_text, description,
    created_by_employee_profile_id
  ) values (
    private.warehouse_workflow_text(p_payload, 'title', 300, true),
    private.warehouse_workflow_text(p_payload, 'customerName', 300, true),
    private.warehouse_workflow_date(p_payload, 'workDate'),
    private.warehouse_workflow_text(p_payload, 'locationText', 500, true),
    private.warehouse_workflow_text(p_payload, 'description', 2000, false),
    actor_id
  ) returning id into saved_id;
  return private.warehouse_minor_work_order_json(saved_id);
end;
$$;

create or replace function public.assign_minor_work_order_to_project_secure(
  p_minor_work_order_id uuid,
  p_project_id text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare saved_id uuid;
begin
  perform 1 from private.assert_warehouse_permission('warehouse.stock_flow.request');
  if p_minor_work_order_id is null or p_project_id is null
    or p_project_id <> btrim(p_project_id)
    or p_project_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    or not exists (
      select 1 from public.projects project
      where project.record_key = p_project_id and project.status = 'active'
    )
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  update public.warehouse_minor_work_orders job
    set assigned_project_id = p_project_id, status = 'assigned'
    where job.id = p_minor_work_order_id
      and job.status in ('open', 'assigned')
      and (job.assigned_project_id is null or job.assigned_project_id = p_project_id)
    returning id into saved_id;
  if not found then
    raise exception using errcode = '55000', message = 'minor work order unavailable';
  end if;
  return private.warehouse_minor_work_order_json(saved_id);
end;
$$;

create or replace function public.submit_warehouse_receipt_secure(
  p_purchase_record_key text,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare actor_id uuid; saved_id uuid; line jsonb; resource_id uuid;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.receipt.submit');
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  if p_purchase_record_key is null or p_purchase_record_key <> btrim(p_purchase_record_key)
    or p_purchase_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    or not exists (
      select 1 from public.purchase_records purchase
      where purchase.record_key = p_purchase_record_key and purchase.status = 'active'
    )
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      line, array['variantId','requestedQuantity','warehouseId','locationId']
    ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;
    perform private.warehouse_workflow_uuid(line, 'variantId');
    perform private.warehouse_workflow_uuid(line, 'warehouseId');
    perform private.warehouse_workflow_uuid(line, 'locationId');
    perform private.warehouse_workflow_quantity(line);
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(*) from (
      select distinct value->>'variantId', value->>'locationId'
      from jsonb_array_elements(p_lines)
    ) distinct_lines
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;

  for resource_id in
    select distinct private.warehouse_workflow_uuid(value, 'locationId')
    from jsonb_array_elements(p_lines) order by 1
  loop perform private.lock_warehouse_location_resource(resource_id); end loop;
  for resource_id in
    select distinct private.warehouse_workflow_uuid(value, 'variantId')
    from jsonb_array_elements(p_lines) order by 1
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;

  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_locations location
      on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
     and location.warehouse_id = private.warehouse_workflow_uuid(entry.value, 'warehouseId')
    left join public.warehouse_sites site on site.id = location.warehouse_id
    left join public.warehouse_variants variant
      on variant.id = private.warehouse_workflow_uuid(entry.value, 'variantId')
    left join public.warehouse_items item on item.id = variant.item_id
    where location.id is null or not location.active or site.id is null or not site.active
       or variant.id is null or not variant.active or item.id is null or not item.active
  ) then raise exception using errcode = '55000', message = 'active warehouse resources required'; end if;

  insert into public.warehouse_receipts(
    purchase_record_key, submitted_by_employee_profile_id, idempotency_key
  ) values (p_purchase_record_key, actor_id, p_idempotency_key)
  returning id into saved_id;
  insert into public.warehouse_receipt_lines(
    receipt_id, variant_id, requested_quantity, warehouse_id, location_id
  ) select
    saved_id,
    private.warehouse_workflow_uuid(value, 'variantId'),
    private.warehouse_workflow_quantity(value),
    private.warehouse_workflow_uuid(value, 'warehouseId'),
    private.warehouse_workflow_uuid(value, 'locationId')
  from jsonb_array_elements(p_lines);
  return private.warehouse_receipt_json(saved_id);
end;
$$;

create or replace function public.submit_warehouse_stock_out_secure(
  p_request jsonb,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid; saved_id uuid; line jsonb; resource_id uuid;
  destination_type_value text; project_id_value text; minor_id_value uuid;
  snapshot_value text; derived_snapshot text;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.request');
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  if not private.warehouse_catalog_payload_keys_exact(
    p_request,
    array['destinationType','projectId','minorWorkOrderId','destinationNameSnapshot','purpose','receiver','requestDate']
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;
  destination_type_value := private.warehouse_workflow_text(p_request, 'destinationType', 30, true);
  snapshot_value := private.warehouse_workflow_text(p_request, 'destinationNameSnapshot', 500, true);
  if p_request->'projectId' <> 'null'::jsonb then
    project_id_value := private.warehouse_workflow_text(p_request, 'projectId', 200, true);
  end if;
  if p_request->'minorWorkOrderId' <> 'null'::jsonb then
    minor_id_value := private.warehouse_workflow_uuid(p_request, 'minorWorkOrderId');
  end if;
  if destination_type_value = 'project' and project_id_value is not null and minor_id_value is null then
    select private.normalize_warehouse_catalog_text(project.payload->>'projectName')
      into derived_snapshot from public.projects project
      where project.record_key = project_id_value and project.status = 'active';
  elsif destination_type_value = 'minor_work_order' and project_id_value is null and minor_id_value is not null then
    select job.customer_name || '・' || job.title into derived_snapshot
      from public.warehouse_minor_work_orders job
      where job.id = minor_id_value and job.status in ('open', 'assigned');
  elsif destination_type_value = 'internal_use' and project_id_value is null and minor_id_value is null then
    derived_snapshot := snapshot_value;
  else
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  if derived_snapshot is null or snapshot_value <> derived_snapshot then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid';
  end if;
  perform private.warehouse_workflow_text(p_request, 'purpose', 1000, true);
  perform private.warehouse_workflow_text(p_request, 'receiver', 300, true);
  perform private.warehouse_workflow_date(p_request, 'requestDate');
  for line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(line, array['variantId','requestedQuantity'])
    then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;
    perform private.warehouse_workflow_uuid(line, 'variantId');
    perform private.warehouse_workflow_quantity(line);
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'variantId') from jsonb_array_elements(p_lines)
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;

  for resource_id in
    select distinct private.warehouse_workflow_uuid(value, 'variantId')
    from jsonb_array_elements(p_lines) order by 1
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;
  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_variants variant
      on variant.id = private.warehouse_workflow_uuid(entry.value, 'variantId')
    left join public.warehouse_items item on item.id = variant.item_id
    where variant.id is null or not variant.active or item.id is null or not item.active
  ) then raise exception using errcode = '55000', message = 'active warehouse resources required'; end if;

  insert into public.warehouse_stock_out_requests(
    destination_type, project_id, minor_work_order_id, destination_name_snapshot,
    purpose, receiver, request_date, submitted_by_employee_profile_id, idempotency_key
  ) values (
    destination_type_value, project_id_value, minor_id_value, snapshot_value,
    private.warehouse_workflow_text(p_request, 'purpose', 1000, true),
    private.warehouse_workflow_text(p_request, 'receiver', 300, true),
    private.warehouse_workflow_date(p_request, 'requestDate'), actor_id, p_idempotency_key
  ) returning id into saved_id;
  insert into public.warehouse_stock_out_lines(
    request_id, variant_id, requested_quantity
  ) select saved_id, private.warehouse_workflow_uuid(value, 'variantId'),
    private.warehouse_workflow_quantity(value)
    from jsonb_array_elements(p_lines);
  return private.warehouse_stock_out_json(saved_id);
end;
$$;

create or replace function public.submit_warehouse_return_secure(
  p_original_stock_out_id uuid,
  p_request jsonb,
  p_lines jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare actor_id uuid; saved_id uuid; line jsonb; resource_id uuid;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.request');
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  if p_original_stock_out_id is null or not exists (
    select 1 from public.warehouse_stock_out_requests request
    where request.id = p_original_stock_out_id and request.status = 'confirmed'
  ) or not private.warehouse_catalog_payload_keys_exact(
    p_request, array['reason','receiver','requestDate']
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;
  perform private.warehouse_workflow_text(p_request, 'reason', 1000, true);
  perform private.warehouse_workflow_text(p_request, 'receiver', 300, true);
  perform private.warehouse_workflow_date(p_request, 'requestDate');
  for line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      line, array['originalStockOutLineId','requestedQuantity']
    ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;
    perform private.warehouse_workflow_uuid(line, 'originalStockOutLineId');
    perform private.warehouse_workflow_quantity(line);
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'originalStockOutLineId') from jsonb_array_elements(p_lines)
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'originalStockOutLineId')
     and line.request_id = p_original_stock_out_id
    where line.id is null
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid'; end if;

  for resource_id in
    select distinct stock_line.variant_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines stock_line
      on stock_line.id = private.warehouse_workflow_uuid(entry.value, 'originalStockOutLineId')
    order by 1
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;
  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines stock_line
      on stock_line.id = private.warehouse_workflow_uuid(entry.value, 'originalStockOutLineId')
    left join public.warehouse_variants variant on variant.id = stock_line.variant_id
    left join public.warehouse_items item on item.id = variant.item_id
    where variant.id is null or not variant.active or item.id is null or not item.active
  ) then raise exception using errcode = '55000', message = 'active warehouse resources required'; end if;

  insert into public.warehouse_return_requests(
    original_stock_out_id, reason, receiver, request_date,
    submitted_by_employee_profile_id, idempotency_key
  ) values (
    p_original_stock_out_id,
    private.warehouse_workflow_text(p_request, 'reason', 1000, true),
    private.warehouse_workflow_text(p_request, 'receiver', 300, true),
    private.warehouse_workflow_date(p_request, 'requestDate'), actor_id, p_idempotency_key
  ) returning id into saved_id;
  insert into public.warehouse_return_lines(
    return_id, original_stock_out_line_id, requested_quantity
  ) select saved_id,
    private.warehouse_workflow_uuid(value, 'originalStockOutLineId'),
    private.warehouse_workflow_quantity(value)
    from jsonb_array_elements(p_lines);
  return private.warehouse_return_json(saved_id);
end;
$$;

revoke all on function private.warehouse_workflow_text(jsonb,text,integer,boolean) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_uuid(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_quantity(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_date(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_idempotency(text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_lines(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.reject_warehouse_destination_mutation() from public, anon, authenticated, service_role;
revoke all on function private.warehouse_minor_work_order_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_receipt_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_stock_out_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_return_json(uuid) from public, anon, authenticated, service_role;

revoke all on function public.create_minor_work_order_secure(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.assign_minor_work_order_to_project_secure(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_warehouse_receipt_secure(text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_warehouse_stock_out_secure(jsonb,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_warehouse_return_secure(uuid,jsonb,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.create_minor_work_order_secure(jsonb) to authenticated;
grant execute on function public.assign_minor_work_order_to_project_secure(uuid,text) to authenticated;
grant execute on function public.submit_warehouse_receipt_secure(text,jsonb,text) to authenticated;
grant execute on function public.submit_warehouse_stock_out_secure(jsonb,jsonb,text) to authenticated;
grant execute on function public.submit_warehouse_return_secure(uuid,jsonb,jsonb,text) to authenticated;

commit;

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
  confirmation_idempotency_key text,
  confirmation_payload jsonb,
  submission_payload jsonb not null default '{}'::jsonb,
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
  constraint warehouse_receipts_state_consistency_check check (
    (status = 'pending' and confirmed_by_employee_profile_id is null
      and confirmed_at is null and rejection_reason is null)
    or (status = 'confirmed' and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null and rejection_reason is null)
    or (status in ('rejected', 'void') and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null and rejection_reason is not null)
  ),
  constraint warehouse_receipts_purchase_fk foreign key (purchase_record_key)
    references public.purchase_records(record_key) on delete restrict,
  constraint warehouse_receipts_submitter_fk foreign key (submitted_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_receipts_confirmer_fk foreign key (confirmed_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_receipts_idempotency_unique unique (idempotency_key)
  ,constraint warehouse_receipts_submission_payload_check check (
    jsonb_typeof(submission_payload) = 'object'
  ),
  constraint warehouse_receipts_confirmation_pair_check check (
    (confirmation_idempotency_key is null) = (confirmation_payload is null)
    and (confirmation_idempotency_key is null or status in ('confirmed', 'void'))
    and (
      confirmation_idempotency_key is null
      or (
        confirmation_idempotency_key = btrim(confirmation_idempotency_key)
        and confirmation_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
        and jsonb_typeof(confirmation_payload) = 'object'
      )
    )
  )
);

create table public.warehouse_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null,
  variant_id uuid not null,
  requested_quantity numeric(18,3) not null,
  confirmed_quantity numeric(18,3),
  warehouse_id uuid,
  location_id uuid,
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
  constraint warehouse_receipt_lines_location_pair_check check (
    (warehouse_id is null) = (location_id is null)
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
  submission_payload jsonb not null,
  confirmation_idempotency_key text,
  confirmation_payload jsonb,
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
  constraint warehouse_stock_out_submission_payload_check check (
    jsonb_typeof(submission_payload) = 'object'
  ),
  constraint warehouse_stock_out_rejection_check check (
    rejection_reason is null
    or (rejection_reason = btrim(rejection_reason) and char_length(rejection_reason) between 1 and 1000)
  ),
  constraint warehouse_stock_out_state_consistency_check check (
    (status = 'pending' and confirmed_by_employee_profile_id is null
      and confirmed_at is null and rejection_reason is null)
    or (status = 'confirmed' and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null and rejection_reason is null)
    or (status in ('rejected', 'void') and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null and rejection_reason is not null)
  ),
  constraint warehouse_stock_out_project_fk foreign key (project_id)
    references public.projects(record_key) on delete restrict,
  constraint warehouse_stock_out_minor_fk foreign key (minor_work_order_id)
    references public.warehouse_minor_work_orders(id) on delete restrict,
  constraint warehouse_stock_out_submitter_fk foreign key (submitted_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_stock_out_confirmer_fk foreign key (confirmed_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_stock_out_idempotency_unique unique (idempotency_key),
  constraint warehouse_stock_out_confirmation_pair_check check (
    (confirmation_idempotency_key is null) = (confirmation_payload is null)
    and (confirmation_idempotency_key is null or status in ('confirmed', 'rejected', 'void'))
    and (
      confirmation_idempotency_key is null
      or (
        confirmation_idempotency_key = btrim(confirmation_idempotency_key)
        and confirmation_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
        and jsonb_typeof(confirmation_payload) = 'object'
      )
    )
  )
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
  constraint warehouse_stock_out_lines_variant_unique unique (request_id, variant_id),
  constraint warehouse_stock_out_lines_id_request_unique unique (id, request_id)
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
  submission_payload jsonb not null,
  confirmation_idempotency_key text,
  confirmation_payload jsonb,
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
  constraint warehouse_return_submission_payload_check check (
    jsonb_typeof(submission_payload) = 'object'
  ),
  constraint warehouse_return_rejection_check check (
    rejection_reason is null
    or (rejection_reason = btrim(rejection_reason) and char_length(rejection_reason) between 1 and 1000)
  ),
  constraint warehouse_return_state_consistency_check check (
    (status = 'pending' and confirmed_by_employee_profile_id is null
      and confirmed_at is null and rejection_reason is null)
    or (status = 'confirmed' and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null and rejection_reason is null)
    or (status in ('rejected', 'void') and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null and rejection_reason is not null)
  ),
  constraint warehouse_return_original_fk foreign key (original_stock_out_id)
    references public.warehouse_stock_out_requests(id) on delete restrict,
  constraint warehouse_return_submitter_fk foreign key (submitted_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_return_confirmer_fk foreign key (confirmed_by_employee_profile_id)
    references public.employee_profiles(id) on delete restrict,
  constraint warehouse_return_idempotency_unique unique (idempotency_key),
  constraint warehouse_return_id_original_unique unique (id, original_stock_out_id),
  constraint warehouse_return_confirmation_pair_check check (
    (confirmation_idempotency_key is null) = (confirmation_payload is null)
    and (confirmation_idempotency_key is null or status in ('confirmed', 'rejected', 'void'))
    and (
      confirmation_idempotency_key is null
      or (
        confirmation_idempotency_key = btrim(confirmation_idempotency_key)
        and confirmation_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
        and jsonb_typeof(confirmation_payload) = 'object'
      )
    )
  )
);

alter table public.warehouse_receipt_lines
  add constraint warehouse_receipt_lines_id_variant_unique unique (id, variant_id);
alter table public.warehouse_batches
  add constraint warehouse_batches_receipt_line_variant_fk
  foreign key (receipt_line_id, variant_id)
  references public.warehouse_receipt_lines(id, variant_id) on delete restrict;
create unique index warehouse_batches_receipt_line_unique
  on public.warehouse_batches(receipt_line_id)
  where receipt_line_id is not null;
create unique index warehouse_receipts_confirmation_idempotency_unique
  on public.warehouse_receipts(confirmation_idempotency_key)
  where confirmation_idempotency_key is not null;
create unique index warehouse_stock_out_confirmation_idempotency_unique
  on public.warehouse_stock_out_requests(confirmation_idempotency_key)
  where confirmation_idempotency_key is not null;
create unique index warehouse_return_confirmation_idempotency_unique
  on public.warehouse_return_requests(confirmation_idempotency_key)
  where confirmation_idempotency_key is not null;

create table public.warehouse_return_lines (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null,
  original_stock_out_id uuid not null,
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
  constraint warehouse_return_lines_return_original_fk
    foreign key (return_id, original_stock_out_id)
    references public.warehouse_return_requests(id, original_stock_out_id) on delete restrict,
  constraint warehouse_return_lines_stock_out_original_fk
    foreign key (original_stock_out_line_id, original_stock_out_id)
    references public.warehouse_stock_out_lines(id, request_id) on delete restrict,
  constraint warehouse_return_lines_original_unique unique (return_id, original_stock_out_line_id)
);

create or replace function private.guard_warehouse_project_cost_write()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  relation_owner name;
  old_managed boolean := false;
  new_managed boolean := false;
begin
  select role.rolname into relation_owner
  from pg_catalog.pg_class relation
  join pg_catalog.pg_roles role on role.oid = relation.relowner
  where relation.oid = tg_relid;
  if current_user = relation_owner then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op <> 'INSERT' then
    old_managed := left(old.record_key, 10) = 'WAREHOUSE-'
      or left(coalesce(old.payload->>'costRecordId', ''), 10) = 'WAREHOUSE-'
      or old.payload->>'sourceType' in ('warehouse', 'warehouseReversal');
  end if;
  if tg_op <> 'DELETE' then
    new_managed := left(new.record_key, 10) = 'WAREHOUSE-'
      or left(coalesce(new.payload->>'costRecordId', ''), 10) = 'WAREHOUSE-'
      or new.payload->>'sourceType' in ('warehouse', 'warehouseReversal');
  end if;
  if tg_op = 'INSERT' and new_managed then
    raise exception using errcode = '42501',
      message = 'warehouse project cost namespace reserved',
      hint = 'WAREHOUSE_PROJECT_COST_NAMESPACE_RESERVED';
  elsif old_managed or new_managed then
    raise exception using errcode = '55000',
      message = 'warehouse project cost immutable',
      hint = 'WAREHOUSE_PROJECT_COST_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger guard_warehouse_project_cost_write
before insert or update or delete on public.project_cost_records
for each row execute function private.guard_warehouse_project_cost_write();

create or replace function private.enforce_project_cost_write_permission()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  relation_owner name;
  required_action text;
begin
  select role.rolname into relation_owner
  from pg_catalog.pg_class relation
  join pg_catalog.pg_roles role on role.oid = relation.relowner
  where relation.oid = tg_relid;
  if current_user = relation_owner or auth.role() = 'service_role' then return new; end if;
  if not public.is_current_employee_active() then
    raise exception using errcode = '42501', message = 'active employee required';
  end if;
  required_action := case
    when old.status in ('deleted', 'void') or new.status in ('deleted', 'void')
      then 'delete'
    else 'update'
  end;
  if not public.has_current_permission('module.project_costs.' || required_action) then
    raise exception using errcode = '42501', message = required_action || ' permission required';
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_project_cost_records_status_permission
on public.project_cost_records;
create trigger enforce_project_cost_records_status_permission
before update on public.project_cost_records
for each row execute function private.enforce_project_cost_write_permission();

revoke truncate on table public.project_cost_records
from public, anon, authenticated, service_role;

create or replace function private.reject_warehouse_workflow_delete()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'warehouse workflow delete forbidden',
    hint = 'WAREHOUSE_WORKFLOW_DELETE_FORBIDDEN';
  return null;
end;
$$;

create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_minor_work_orders
for each statement execute function private.reject_warehouse_workflow_delete();
create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_receipts
for each statement execute function private.reject_warehouse_workflow_delete();
create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_receipt_lines
for each statement execute function private.reject_warehouse_workflow_delete();
create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_stock_out_requests
for each statement execute function private.reject_warehouse_workflow_delete();
create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_stock_out_lines
for each statement execute function private.reject_warehouse_workflow_delete();
create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_return_requests
for each statement execute function private.reject_warehouse_workflow_delete();
create trigger reject_warehouse_workflow_delete
before delete on public.warehouse_return_lines
for each statement execute function private.reject_warehouse_workflow_delete();

create or replace function private.guard_purchase_warehouse_receipt_delete()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  committed_quantity numeric(18,3);
  next_quantity numeric(18,3);
begin
  if old.status = 'active' and new.status = 'deleted' and exists (
    select 1 from public.warehouse_receipts receipt
    where receipt.purchase_record_key = old.record_key
  ) then
    raise exception using errcode = '23503',
      message = 'purchase record has warehouse receipts',
      hint = 'PURCHASE_HAS_WAREHOUSE_RECEIPTS';
  end if;
  if new.status = 'active' and exists (
    select 1 from public.warehouse_receipts receipt
    where receipt.purchase_record_key = old.record_key
  ) then
    if jsonb_typeof(new.payload->'quantity') <> 'number'
      or (new.payload->>'quantity') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$'
      or (new.payload->>'quantity')::numeric <= 0
    then
      raise exception using errcode = '23514',
        message = 'purchase quantity is invalid for warehouse receipts',
        hint = 'PURCHASE_QUANTITY_BELOW_WAREHOUSE_RECEIPTS';
    end if;
    next_quantity := (new.payload->>'quantity')::numeric(18,3);
    select coalesce(sum(case
      when receipt.status = 'pending' then receipt_line.requested_quantity
      when receipt.status = 'confirmed' then receipt_line.confirmed_quantity
      else 0
    end), 0)
    into committed_quantity
    from public.warehouse_receipts receipt
    join public.warehouse_receipt_lines receipt_line on receipt_line.receipt_id = receipt.id
    where receipt.purchase_record_key = old.record_key;
    if next_quantity < committed_quantity then
      raise exception using errcode = '23514',
        message = 'purchase quantity is below warehouse receipts',
        hint = 'PURCHASE_QUANTITY_BELOW_WAREHOUSE_RECEIPTS';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_purchase_warehouse_receipt_delete
before update on public.purchase_records
for each row execute function private.guard_purchase_warehouse_receipt_delete();

create or replace function private.guard_warehouse_receipt_identity_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if tg_table_name = 'warehouse_receipts' then
    if row(
      old.purchase_record_key, old.submitted_by_employee_profile_id, old.submitted_at,
      old.idempotency_key, old.submission_payload
    ) is distinct from row(
      new.purchase_record_key, new.submitted_by_employee_profile_id, new.submitted_at,
      new.idempotency_key, new.submission_payload
    ) then
      raise exception using errcode = '55000',
        message = 'warehouse receipt identity is immutable',
        hint = 'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE';
    end if;
  elsif row(old.receipt_id, old.variant_id, old.requested_quantity)
    is distinct from row(new.receipt_id, new.variant_id, new.requested_quantity)
  then
    raise exception using errcode = '55000',
      message = 'warehouse receipt line identity is immutable',
      hint = 'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger guard_warehouse_receipt_identity_update
before update on public.warehouse_receipts
for each row execute function private.guard_warehouse_receipt_identity_update();
create trigger guard_warehouse_receipt_line_identity_update
before update on public.warehouse_receipt_lines
for each row execute function private.guard_warehouse_receipt_identity_update();

create or replace function private.guard_warehouse_confirmation_identity_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if row(
    old.submitted_by_employee_profile_id, old.submitted_at,
    old.idempotency_key, old.submission_payload
  ) is distinct from row(
    new.submitted_by_employee_profile_id, new.submitted_at,
    new.idempotency_key, new.submission_payload
  ) then
    if tg_table_name = 'warehouse_receipts' then
      raise exception using errcode = '55000',
        message = 'warehouse receipt identity is immutable',
        hint = 'WAREHOUSE_RECEIPT_IDENTITY_IMMUTABLE';
    end if;
    raise exception using errcode = '55000',
      message = 'warehouse submission identity is immutable';
  end if;
  if old.confirmation_idempotency_key is not null and row(
    old.confirmation_idempotency_key, old.confirmation_payload
  ) is distinct from row(
    new.confirmation_idempotency_key, new.confirmation_payload
  ) then
    raise exception using errcode = '55000',
      message = 'warehouse confirmation identity is immutable',
      hint = 'WAREHOUSE_CONFIRMATION_IDENTITY_IMMUTABLE';
  end if;
  if new.confirmation_idempotency_key is not null
    and new.status not in ('confirmed', 'rejected', 'void')
  then
    raise exception using errcode = '23514',
      message = 'warehouse confirmation identity requires confirmed state';
  end if;
  return new;
end;
$$;

create trigger guard_warehouse_receipt_confirmation_identity_update
before update on public.warehouse_receipts
for each row execute function private.guard_warehouse_confirmation_identity_update();
create trigger guard_warehouse_stock_out_confirmation_identity_update
before update on public.warehouse_stock_out_requests
for each row execute function private.guard_warehouse_confirmation_identity_update();
create trigger guard_warehouse_return_confirmation_identity_update
before update on public.warehouse_return_requests
for each row execute function private.guard_warehouse_confirmation_identity_update();

create or replace function private.assert_warehouse_receipt_document_state(p_receipt_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  document_status text;
  line_count bigint;
  incomplete_count bigint;
  complete_count bigint;
begin
  select status into document_status
  from public.warehouse_receipts where id = p_receipt_id;
  if not found then return; end if;

  select count(*),
    count(*) filter (where confirmed_quantity is null or unit_cost is null),
    count(*) filter (where confirmed_quantity is not null and unit_cost is not null)
  into line_count, incomplete_count, complete_count
  from public.warehouse_receipt_lines where receipt_id = p_receipt_id;

  if line_count = 0
    or (document_status = 'confirmed' and incomplete_count <> 0)
    or (document_status in ('pending', 'rejected') and complete_count <> 0)
    or (document_status in ('pending', 'rejected') and incomplete_count <> line_count)
    or (document_status = 'void' and incomplete_count <> 0 and complete_count <> 0)
    or exists (
      select 1 from public.warehouse_receipt_lines
      where receipt_id = p_receipt_id
        and ((confirmed_quantity is null) <> (unit_cost is null))
    )
    or exists (
      select 1 from public.warehouse_receipt_lines
      where receipt_id = p_receipt_id
        and ((warehouse_id is null) <> (location_id is null))
    )
    or (
      document_status in ('confirmed', 'void')
      and complete_count > 0
      and exists (
        select 1 from public.warehouse_receipt_lines
        where receipt_id = p_receipt_id
          and (warehouse_id is null or location_id is null)
      )
    )
  then
    raise exception using errcode = '23514', message = 'warehouse receipt state inconsistent';
  end if;
end;
$$;

create or replace function private.assert_warehouse_stock_out_document_state(p_request_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  document_status text;
  line_count bigint;
  incomplete_count bigint;
  complete_count bigint;
begin
  select status into document_status
  from public.warehouse_stock_out_requests where id = p_request_id;
  if not found then return; end if;

  select count(*),
    count(*) filter (where confirmed_quantity is null or frozen_total_cost is null),
    count(*) filter (where confirmed_quantity is not null and frozen_total_cost is not null)
  into line_count, incomplete_count, complete_count
  from public.warehouse_stock_out_lines where request_id = p_request_id;

  if line_count = 0
    or (document_status = 'confirmed' and incomplete_count <> 0)
    or (document_status in ('pending', 'rejected') and complete_count <> 0)
    or (document_status in ('pending', 'rejected') and incomplete_count <> line_count)
    or (document_status = 'void' and incomplete_count <> 0 and complete_count <> 0)
    or exists (
      select 1 from public.warehouse_stock_out_lines
      where request_id = p_request_id
        and ((confirmed_quantity is null) <> (frozen_total_cost is null))
    )
  then
    raise exception using errcode = '23514', message = 'warehouse stock-out state inconsistent';
  end if;
end;
$$;

create or replace function private.assert_warehouse_return_document_state(p_return_id uuid)
returns void
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  document_status text;
  line_count bigint;
  incomplete_count bigint;
  complete_count bigint;
begin
  select status into document_status
  from public.warehouse_return_requests where id = p_return_id;
  if not found then return; end if;

  select count(*),
    count(*) filter (where confirmed_quantity is null or frozen_total_cost is null),
    count(*) filter (where confirmed_quantity is not null and frozen_total_cost is not null)
  into line_count, incomplete_count, complete_count
  from public.warehouse_return_lines where return_id = p_return_id;

  if line_count = 0
    or (document_status = 'confirmed' and incomplete_count <> 0)
    or (document_status in ('pending', 'rejected') and complete_count <> 0)
    or (document_status in ('pending', 'rejected') and incomplete_count <> line_count)
    or (document_status = 'void' and incomplete_count <> 0 and complete_count <> 0)
    or exists (
      select 1 from public.warehouse_return_lines
      where return_id = p_return_id
        and ((confirmed_quantity is null) <> (frozen_total_cost is null))
    )
  then
    raise exception using errcode = '23514', message = 'warehouse return state inconsistent';
  end if;
end;
$$;

create or replace function private.check_warehouse_receipt_document_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if tg_table_name = 'warehouse_receipts' then
    perform private.assert_warehouse_receipt_document_state(coalesce(new.id, old.id));
  else
    if tg_op <> 'INSERT' then
      perform private.assert_warehouse_receipt_document_state(old.receipt_id);
    end if;
    if tg_op <> 'DELETE' and (tg_op <> 'UPDATE' or new.receipt_id is distinct from old.receipt_id) then
      perform private.assert_warehouse_receipt_document_state(new.receipt_id);
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.check_warehouse_stock_out_document_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if tg_table_name = 'warehouse_stock_out_requests' then
    perform private.assert_warehouse_stock_out_document_state(coalesce(new.id, old.id));
  else
    if tg_op <> 'INSERT' then
      perform private.assert_warehouse_stock_out_document_state(old.request_id);
    end if;
    if tg_op <> 'DELETE' and (tg_op <> 'UPDATE' or new.request_id is distinct from old.request_id) then
      perform private.assert_warehouse_stock_out_document_state(new.request_id);
    end if;
  end if;
  return null;
end;
$$;

create or replace function private.check_warehouse_return_document_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, private
as $$
begin
  if tg_table_name = 'warehouse_return_requests' then
    perform private.assert_warehouse_return_document_state(coalesce(new.id, old.id));
  else
    if tg_op <> 'INSERT' then
      perform private.assert_warehouse_return_document_state(old.return_id);
    end if;
    if tg_op <> 'DELETE' and (tg_op <> 'UPDATE' or new.return_id is distinct from old.return_id) then
      perform private.assert_warehouse_return_document_state(new.return_id);
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger warehouse_receipts_document_state
after insert or update or delete on public.warehouse_receipts
deferrable initially deferred for each row
execute function private.check_warehouse_receipt_document_state();
create constraint trigger warehouse_receipt_lines_document_state
after insert or update or delete on public.warehouse_receipt_lines
deferrable initially deferred for each row
execute function private.check_warehouse_receipt_document_state();
create constraint trigger warehouse_stock_out_requests_document_state
after insert or update or delete on public.warehouse_stock_out_requests
deferrable initially deferred for each row
execute function private.check_warehouse_stock_out_document_state();
create constraint trigger warehouse_stock_out_lines_document_state
after insert or update or delete on public.warehouse_stock_out_lines
deferrable initially deferred for each row
execute function private.check_warehouse_stock_out_document_state();
create constraint trigger warehouse_return_requests_document_state
after insert or update or delete on public.warehouse_return_requests
deferrable initially deferred for each row
execute function private.check_warehouse_return_document_state();
create constraint trigger warehouse_return_lines_document_state
after insert or update or delete on public.warehouse_return_lines
deferrable initially deferred for each row
execute function private.check_warehouse_return_document_state();

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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  result := private.normalize_warehouse_catalog_text(p_value->>p_field);
  if (p_required and result = '')
    or char_length(result) > p_maximum
    or private.warehouse_catalog_has_invisible(result)
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  begin result := (p_value->>p_field)::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  begin result := (p_value->>'requestedQuantity')::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end;
  if result <= 0 or result > 9007199254740.990 or result <> trunc(result, 3)
    or result in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  raw := p_value->>p_field;
  if raw !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  begin result := raw::date;
  exception when datetime_field_overflow then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end;
  if to_char(result, 'YYYY-MM-DD') <> raw then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid',
      hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
    'materialCost', case when public.has_current_permission('warehouse.cost.view') then (
      select
        coalesce((
          select sum(line.frozen_total_cost)
          from public.warehouse_stock_out_requests request
          join public.warehouse_stock_out_lines line on line.request_id = request.id
          where request.minor_work_order_id = job.id
            and request.destination_type = 'minor_work_order'
            and request.status = 'confirmed'
        ), 0) - coalesce((
          select sum(return_line.frozen_total_cost)
          from public.warehouse_return_requests return_request
          join public.warehouse_return_lines return_line
            on return_line.return_id = return_request.id
          join public.warehouse_stock_out_requests original_request
            on original_request.id = return_request.original_stock_out_id
          where original_request.minor_work_order_id = job.id
            and original_request.destination_type = 'minor_work_order'
            and return_request.status in ('confirmed', 'void')
        ), 0)
    ) else null end,
    'createdByEmployeeProfileId', job.created_by_employee_profile_id,
    'createdAt', job.created_at, 'updatedAt', job.updated_at
  )
  from public.warehouse_minor_work_orders job where job.id = p_id
$$;

create or replace function private.upsert_warehouse_project_cost(
  p_record_key text,
  p_project_id text,
  p_amount numeric,
  p_actor_id uuid,
  p_occurred_at timestamptz,
  p_cost_date date,
  p_source_document_id uuid,
  p_source_document_type text,
  p_source_purchase_record_keys jsonb,
  p_source_stock_out_ids jsonb,
  p_allow_inactive_project boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  project public.projects%rowtype;
  existing public.project_cost_records%rowtype;
  next_payload jsonb;
begin
  if p_record_key is null or p_record_key <> btrim(p_record_key)
    or p_record_key !~ '^WAREHOUSE-(SO|MWO):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_project_id is null or p_actor_id is null or p_occurred_at is null
    or p_cost_date is null
    or p_source_document_id is null
    or p_allow_inactive_project is null
    or p_source_document_type not in ('warehouse_stock_out', 'warehouse_minor_work_order')
    or p_amount is null
    or (p_source_document_type = 'warehouse_stock_out' and p_amount <= 0)
    or (p_source_document_type = 'warehouse_minor_work_order' and p_amount < 0)
    or p_amount > 900719925474.0991
    or p_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    or jsonb_typeof(p_source_purchase_record_keys) is distinct from 'array'
    or jsonb_typeof(p_source_stock_out_ids) is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'warehouse project cost invalid',
      hint = 'WAREHOUSE_PROJECT_COST_INVALID';
  end if;
  select * into actor from public.employee_profiles where id = p_actor_id;
  select * into project from public.projects
  where record_key = p_project_id
    and (status = 'active' or p_allow_inactive_project);
  if actor.id is null or project.id is null then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  next_payload := jsonb_build_object(
    'costRecordId', p_record_key,
    'projectId', p_project_id,
    'projectName', coalesce(project.payload->>'projectName', p_project_id),
    'employeeId', actor.employee_number,
    'employeeName', actor.name,
    'costType', '材料费',
    'amount', round(p_amount, 4),
    'date', p_cost_date,
    'operator', actor.name,
    'remark', '仓库出库自动归集',
    'sourceType', 'warehouse',
    'sourceDocumentId', p_source_document_id,
    'sourceDocumentType', p_source_document_type,
    'sourcePurchaseRecordKeys', p_source_purchase_record_keys,
    'sourceStockOutIds', p_source_stock_out_ids,
    'createdAt', p_occurred_at,
    'updatedAt', p_occurred_at,
    'updatedByEmployeeId', actor.employee_number,
    'updatedByEmployeeName', actor.name
  );
  select * into existing from public.project_cost_records
  where record_key = p_record_key for update;
  if found then
    if existing.status <> 'active'
      or existing.payload->>'sourceType' <> 'warehouse'
      or existing.payload->>'costRecordId' <> p_record_key
      or existing.payload->>'projectId' <> p_project_id
      or existing.payload->>'sourceDocumentId' <> p_source_document_id::text
      or existing.payload->>'sourceDocumentType' <> p_source_document_type
      or (
        p_source_document_type = 'warehouse_stock_out'
        and existing.payload is distinct from next_payload
      )
    then
      raise exception using errcode = '23505', message = 'warehouse project cost conflict',
        hint = 'WAREHOUSE_PROJECT_COST_CONFLICT';
    end if;
    if p_source_document_type = 'warehouse_minor_work_order'
      and (existing.payload->>'amount')::numeric = p_amount
      and existing.payload->'sourcePurchaseRecordKeys' = p_source_purchase_record_keys
      and existing.payload->'sourceStockOutIds' = p_source_stock_out_ids
    then
      return;
    end if;
    if p_source_document_type = 'warehouse_minor_work_order'
      and existing.payload is distinct from next_payload
    then
      next_payload := jsonb_set(
        next_payload, '{createdAt}', existing.payload->'createdAt', true
      );
      update public.project_cost_records
      set payload = next_payload,
          updated_at = p_occurred_at,
          updated_by_employee_id = actor.employee_number,
          updated_by_employee_name = actor.name
      where record_key = p_record_key;
    end if;
    return;
  end if;
  insert into public.project_cost_records(
    record_key, payload, status,
    created_at, updated_at,
    created_by_employee_id, created_by_employee_name,
    updated_by_employee_id, updated_by_employee_name
  ) values (
    p_record_key, next_payload, 'active',
    p_occurred_at, p_occurred_at,
    actor.employee_number, actor.name,
    actor.employee_number, actor.name
  );
end;
$$;

create or replace function private.post_minor_work_order_cost(
  p_minor_work_order_id uuid,
  p_actor_id uuid,
  p_occurred_at timestamptz,
  p_allow_inactive_project boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  job public.warehouse_minor_work_orders%rowtype;
  gross_stock_out_cost numeric;
  confirmed_return_cost numeric;
  total_cost numeric;
  purchase_keys jsonb;
  stock_out_ids jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-minor-work-cost:' || p_minor_work_order_id::text, 0
  ));
  select * into job from public.warehouse_minor_work_orders
  where id = p_minor_work_order_id for update;
  if not found or job.assigned_project_id is null then return; end if;
  select coalesce(sum(line.frozen_total_cost), 0),
    coalesce(jsonb_agg(distinct request.id order by request.id), '[]'::jsonb)
  into gross_stock_out_cost, stock_out_ids
  from public.warehouse_stock_out_requests request
  join public.warehouse_stock_out_lines line on line.request_id = request.id
  where request.minor_work_order_id = p_minor_work_order_id
    and request.destination_type = 'minor_work_order'
    and request.status = 'confirmed';
  select coalesce(sum(return_line.frozen_total_cost), 0)
  into confirmed_return_cost
  from public.warehouse_return_requests return_request
  join public.warehouse_return_lines return_line
    on return_line.return_id = return_request.id
  join public.warehouse_stock_out_requests original_request
    on original_request.id = return_request.original_stock_out_id
  where original_request.minor_work_order_id = p_minor_work_order_id
    and original_request.destination_type = 'minor_work_order'
    and return_request.status in ('confirmed', 'void');
  total_cost := gross_stock_out_cost - confirmed_return_cost;
  if total_cost < 0 then
    raise exception using errcode = '23514', message = 'warehouse minor-work net cost invalid',
      hint = 'WAREHOUSE_RETURN_QUANTITY_EXCEEDED';
  end if;
  if total_cost = 0 and not exists (
    select 1 from public.project_cost_records
    where record_key = 'WAREHOUSE-MWO:' || p_minor_work_order_id::text
  ) then return; end if;
  select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into purchase_keys
  from (
    select distinct receipt.purchase_record_key as key
    from public.warehouse_stock_out_requests request
    join public.warehouse_inventory_movements movement
      on movement.source_document_type = 'warehouse_stock_out'
     and movement.source_document_id = request.id::text
    join public.warehouse_batches batch on batch.id = movement.batch_id
    join public.warehouse_receipt_lines receipt_line on receipt_line.id = batch.receipt_line_id
    join public.warehouse_receipts receipt on receipt.id = receipt_line.receipt_id
    where request.minor_work_order_id = p_minor_work_order_id
      and request.status = 'confirmed'
  ) provenance;
  perform private.upsert_warehouse_project_cost(
    'WAREHOUSE-MWO:' || p_minor_work_order_id::text,
    job.assigned_project_id, total_cost, p_actor_id, p_occurred_at, job.work_date,
    p_minor_work_order_id, 'warehouse_minor_work_order', purchase_keys, stock_out_ids,
    p_allow_inactive_project
  );
end;
$$;

create or replace function private.insert_warehouse_return_project_cost(
  p_return_id uuid,
  p_project_id text,
  p_amount numeric,
  p_actor_id uuid,
  p_occurred_at timestamptz,
  p_original_stock_out_id uuid,
  p_purchase_keys jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  project public.projects%rowtype;
  v_record_key text := 'WAREHOUSE-SR:' || p_return_id::text;
  next_payload jsonb;
  existing_payload jsonb;
begin
  if p_return_id is null or p_project_id is null or p_actor_id is null
    or p_occurred_at is null or p_original_stock_out_id is null
    or p_amount is null or p_amount >= 0 or p_amount < -900719925474.0991
    or p_amount in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    or jsonb_typeof(p_purchase_keys) is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'warehouse return project cost invalid',
      hint = 'WAREHOUSE_PROJECT_COST_INVALID';
  end if;
  select * into actor from public.employee_profiles where id = p_actor_id;
  select * into project from public.projects
  where record_key = p_project_id;
  if actor.id is null or project.id is null then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  next_payload := jsonb_build_object(
    'costRecordId', v_record_key,
    'projectId', p_project_id,
    'projectName', coalesce(project.payload->>'projectName', p_project_id),
    'employeeId', actor.employee_number,
    'employeeName', actor.name,
    'costType', '材料费',
    'amount', round(p_amount, 4),
    'date', (p_occurred_at at time zone 'Asia/Tokyo')::date,
    'operator', actor.name,
    'remark', '仓库退回按原批次成本冲回',
    'sourceType', 'warehouseReversal',
    'sourceDocumentId', p_return_id,
    'sourceDocumentType', 'warehouse_return',
    'sourcePurchaseRecordKeys', p_purchase_keys,
    'sourceStockOutIds', jsonb_build_array(p_original_stock_out_id),
    'createdAt', p_occurred_at,
    'updatedAt', p_occurred_at,
    'updatedByEmployeeId', actor.employee_number,
    'updatedByEmployeeName', actor.name
  );
  select payload into existing_payload from public.project_cost_records
  where project_cost_records.record_key = v_record_key for update;
  if found then
    if existing_payload is distinct from next_payload then
      raise exception using errcode = '23505', message = 'warehouse project cost conflict',
        hint = 'WAREHOUSE_PROJECT_COST_CONFLICT';
    end if;
    return;
  end if;
  insert into public.project_cost_records(
    record_key, payload, status, created_at, updated_at,
    created_by_employee_id, created_by_employee_name,
    updated_by_employee_id, updated_by_employee_name
  ) values (
    v_record_key, next_payload, 'active', p_occurred_at, p_occurred_at,
    actor.employee_number, actor.name, actor.employee_number, actor.name
  );
end;
$$;

create or replace function public.list_warehouse_material_cost_context_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.purchases.view')
    or not public.has_current_permission('module.project_costs.view')
  then
    raise exception using errcode = '42501',
      message = 'warehouse material cost context permission required';
  end if;
  return jsonb_build_object(
    'trackedPurchaseRecordKeys', coalesce((
      select jsonb_agg(receipt.purchase_record_key order by receipt.purchase_record_key)
      from (
        select distinct header.purchase_record_key
        from public.warehouse_receipts header
        join public.warehouse_receipt_lines line on line.receipt_id = header.id
        join public.warehouse_batches batch on batch.receipt_line_id = line.id
        where header.confirmed_at is not null
          and header.confirmation_idempotency_key is not null
          and header.status in ('confirmed', 'void')
      ) receipt
    ), '[]'::jsonb)
  );
end;
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

create or replace function private.warehouse_receipt_submission_json(p_id uuid)
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
        'unitCost', null
      ) order by line.id)
      from public.warehouse_receipt_lines line where line.receipt_id = receipt.id
    ), '[]'::jsonb)
  ) from public.warehouse_receipts receipt where receipt.id = p_id
$$;

create or replace function private.warehouse_stock_out_json(p_id uuid, p_view_cost boolean)
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
        'frozenTotalCost', case when p_view_cost then line.frozen_total_cost else null end
      ) order by line.id)
      from public.warehouse_stock_out_lines line where line.request_id = request.id
    ), '[]'::jsonb)
  ) from public.warehouse_stock_out_requests request where request.id = p_id
$$;

create or replace function private.warehouse_return_json(p_id uuid, p_view_cost boolean)
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
        'frozenTotalCost', case when p_view_cost then line.frozen_total_cost else null end
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
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
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
declare saved_id uuid; actor_id uuid;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.request');
  if p_minor_work_order_id is null or p_project_id is null
    or p_project_id <> btrim(p_project_id)
    or p_project_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-minor-work-cost:' || p_minor_work_order_id::text, 0
  ));
  perform 1 from public.warehouse_minor_work_orders job
  where job.id = p_minor_work_order_id for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  if not exists (
    select 1 from public.projects project
    where project.record_key = p_project_id and project.status = 'active'
  ) then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  update public.warehouse_minor_work_orders job
    set assigned_project_id = p_project_id, status = 'assigned'
    where job.id = p_minor_work_order_id
      and job.status in ('open', 'assigned')
      and (job.assigned_project_id is null or job.assigned_project_id = p_project_id)
    returning id into saved_id;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  perform private.post_minor_work_order_cost(
    p_minor_work_order_id, actor_id, clock_timestamp(), false
  );
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
declare
  actor_id uuid; saved_id uuid; line jsonb; resource_id uuid;
  existing_receipt public.warehouse_receipts%rowtype;
  purchase_row public.purchase_records%rowtype;
  canonical_payload jsonb;
  ordered_quantity numeric(18,3);
  committed_quantity numeric(18,3);
  requested_total numeric(18,3);
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.receipt.submit');
  if not public.has_current_permission('module.purchases.view')
    or not public.has_current_permission('module.purchases.create')
  then
    raise exception using errcode = '42501',
      message = 'purchase arrival submission permission required';
  end if;
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  if p_purchase_record_key is null or p_purchase_record_key <> btrim(p_purchase_record_key)
    or p_purchase_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  for line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      line, array['variantId','requestedQuantity','warehouseId','locationId']
    ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;
    perform private.warehouse_workflow_uuid(line, 'variantId');
    if (line->'warehouseId') = 'null'::jsonb and (line->'locationId') = 'null'::jsonb then
      null;
    elsif jsonb_typeof(line->'warehouseId') = 'string'
      and jsonb_typeof(line->'locationId') = 'string'
    then
      perform private.warehouse_workflow_uuid(line, 'warehouseId');
      perform private.warehouse_workflow_uuid(line, 'locationId');
    else
      raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
    end if;
    perform private.warehouse_workflow_quantity(line);
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(*) from (
      select distinct value->>'variantId', value->>'locationId'
      from jsonb_array_elements(p_lines)
    ) distinct_lines
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;

  select jsonb_build_object(
    'purchaseRecordKey', p_purchase_record_key,
    'lines', jsonb_agg(jsonb_build_object(
      'variantId', value->>'variantId',
      'requestedQuantity', private.warehouse_workflow_quantity(value),
      'warehouseId', value->'warehouseId',
      'locationId', value->'locationId'
    ) order by value->>'variantId', value->>'warehouseId', value->>'locationId',
      private.warehouse_workflow_quantity(value))
  ) into canonical_payload
  from jsonb_array_elements(p_lines);

  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-receipt-idempotency:' || p_idempotency_key, 0
  ));
  select receipt.* into existing_receipt
  from public.warehouse_receipts receipt
  where receipt.idempotency_key = p_idempotency_key;
  if found then
    if existing_receipt.submitted_by_employee_profile_id = actor_id
      and existing_receipt.purchase_record_key = p_purchase_record_key
      and existing_receipt.submission_payload = canonical_payload
    then
      return private.warehouse_receipt_submission_json(existing_receipt.id);
    end if;
    raise exception using errcode = '23505', message = 'warehouse workflow idempotency conflict',
      hint = 'WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT';
  end if;

  select purchase.* into purchase_row
  from public.purchase_records purchase
  where purchase.record_key = p_purchase_record_key
  for update;
  if not found or purchase_row.status <> 'active'
    or jsonb_typeof(purchase_row.payload->'quantity') <> 'number'
    or (purchase_row.payload->>'quantity') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$'
  then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  ordered_quantity := (purchase_row.payload->>'quantity')::numeric(18,3);
  if ordered_quantity <= 0 then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  perform private.lock_purchase_record_key(p_purchase_record_key);

  select coalesce(sum(case
    when receipt.status = 'pending' then receipt_line.requested_quantity
    when receipt.status = 'confirmed' then receipt_line.confirmed_quantity
    else 0
  end), 0)
  into committed_quantity
  from public.warehouse_receipts receipt
  join public.warehouse_receipt_lines receipt_line on receipt_line.receipt_id = receipt.id
  where receipt.purchase_record_key = p_purchase_record_key;
  select sum(private.warehouse_workflow_quantity(value)) into requested_total
  from jsonb_array_elements(p_lines);
  if requested_total > ordered_quantity - committed_quantity then
    raise exception using errcode = '23514', message = 'purchase arrival exceeds remainder',
      hint = 'WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED';
  end if;

  for resource_id in
    select distinct (value->>'locationId')::uuid
    from jsonb_array_elements(p_lines)
    where jsonb_typeof(value->'locationId') = 'string'
    order by 1
  loop perform private.lock_warehouse_location_resource(resource_id); end loop;
  for resource_id in
    select distinct private.warehouse_workflow_uuid(value, 'variantId')
    from jsonb_array_elements(p_lines) order by 1
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;

  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_locations location
      on jsonb_typeof(entry.value->'locationId') = 'string'
     and location.id = (entry.value->>'locationId')::uuid
     and location.warehouse_id = (entry.value->>'warehouseId')::uuid
    left join public.warehouse_sites site on site.id = location.warehouse_id
    left join public.warehouse_variants variant
      on variant.id = private.warehouse_workflow_uuid(entry.value, 'variantId')
    left join public.warehouse_items item on item.id = variant.item_id
    where (
      jsonb_typeof(entry.value->'locationId') = 'string'
      and (location.id is null or not location.active or site.id is null or not site.active)
    ) or variant.id is null or not variant.active or item.id is null or not item.active
  ) then raise exception using errcode = '55000', message = 'active warehouse resources required',
    hint = 'WAREHOUSE_RESOURCE_INACTIVE'; end if;

  insert into public.warehouse_receipts(
    purchase_record_key, submitted_by_employee_profile_id, idempotency_key,
    submission_payload
  ) values (p_purchase_record_key, actor_id, p_idempotency_key, canonical_payload)
  returning id into saved_id;
  insert into public.warehouse_receipt_lines(
    receipt_id, variant_id, requested_quantity, warehouse_id, location_id
  ) select
    saved_id,
    private.warehouse_workflow_uuid(value, 'variantId'),
    private.warehouse_workflow_quantity(value),
    case when jsonb_typeof(value->'warehouseId') = 'string'
      then (value->>'warehouseId')::uuid else null end,
    case when jsonb_typeof(value->'locationId') = 'string'
      then (value->>'locationId')::uuid else null end
  from jsonb_array_elements(p_lines);
  return private.warehouse_receipt_submission_json(saved_id);
end;
$$;

create or replace function public.list_purchase_warehouse_arrivals_secure()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform 1 from private.assert_warehouse_permission('warehouse.receipt.submit');
  if not public.has_current_permission('module.purchases.view') then
    raise exception using errcode = '42501', message = 'purchase arrival view permission required';
  end if;
  return jsonb_build_object(
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', variant.id, 'itemId', item.id, 'itemName', item.name,
        'sku', variant.sku, 'model', variant.model, 'size', variant.size,
        'material', variant.material, 'unit', variant.unit
      ) order by lower(item.name), variant.sku, variant.id)
      from public.warehouse_variants variant
      join public.warehouse_items item on item.id = variant.item_id
      where variant.active and item.active
    ), '[]'::jsonb),
    'purchases', coalesce((
      with receipt_totals as (
        select receipt.purchase_record_key,
          coalesce(sum(receipt_line.requested_quantity)
            filter (where receipt.status = 'pending'), 0) as pending_quantity,
          coalesce(sum(receipt_line.confirmed_quantity)
            filter (where receipt.status = 'confirmed'), 0) as confirmed_quantity,
          true as has_receipt
        from public.warehouse_receipts receipt
        join public.warehouse_receipt_lines receipt_line on receipt_line.receipt_id = receipt.id
        group by receipt.purchase_record_key
      )
      select jsonb_agg(jsonb_build_object(
        'purchaseRecordKey', purchase.record_key,
        'orderedQuantity', (purchase.payload->>'quantity')::numeric(18,3),
        'pendingQuantity', coalesce(total.pending_quantity, 0),
        'confirmedQuantity', coalesce(total.confirmed_quantity, 0),
        'remainingQuantity', greatest(
          (purchase.payload->>'quantity')::numeric(18,3)
            - coalesce(total.pending_quantity, 0)
            - coalesce(total.confirmed_quantity, 0),
          0
        ),
        'hasReceipt', coalesce(total.has_receipt, false)
      ) order by purchase.record_key)
      from public.purchase_records purchase
      left join receipt_totals total on total.purchase_record_key = purchase.record_key
      where purchase.status = 'active'
        and jsonb_typeof(purchase.payload->'quantity') = 'number'
        and (purchase.payload->>'quantity') ~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$'
        and (purchase.payload->>'quantity')::numeric > 0
    ), '[]'::jsonb)
  );
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
  existing_request public.warehouse_stock_out_requests%rowtype;
  canonical_payload jsonb;
  view_cost boolean;
  destination_type_value text; project_id_value text; minor_id_value uuid;
  snapshot_value text; derived_snapshot text;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.request');
  view_cost := public.has_current_permission('warehouse.cost.view');
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  if not private.warehouse_catalog_payload_keys_exact(
    p_request,
    array['destinationType','projectId','minorWorkOrderId','destinationNameSnapshot','purpose','receiver','requestDate']
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;
  destination_type_value := private.warehouse_workflow_text(p_request, 'destinationType', 30, true);
  snapshot_value := private.warehouse_workflow_text(p_request, 'destinationNameSnapshot', 500, true);
  if p_request->'projectId' <> 'null'::jsonb then
    project_id_value := private.warehouse_workflow_text(p_request, 'projectId', 200, true);
  end if;
  if p_request->'minorWorkOrderId' <> 'null'::jsonb then
    minor_id_value := private.warehouse_workflow_uuid(p_request, 'minorWorkOrderId');
  end if;
  if not (
    (destination_type_value = 'project' and project_id_value is not null and minor_id_value is null)
    or (destination_type_value = 'minor_work_order' and project_id_value is null and minor_id_value is not null)
    or (destination_type_value = 'internal_use' and project_id_value is null and minor_id_value is null)
  ) then
    raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID';
  end if;
  perform private.warehouse_workflow_text(p_request, 'purpose', 1000, true);
  perform private.warehouse_workflow_text(p_request, 'receiver', 300, true);
  perform private.warehouse_workflow_date(p_request, 'requestDate');
  for line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(line, array['variantId','requestedQuantity'])
    then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;
    perform private.warehouse_workflow_uuid(line, 'variantId');
    perform private.warehouse_workflow_quantity(line);
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'variantId') from jsonb_array_elements(p_lines)
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;

  select jsonb_build_object(
    'request', jsonb_build_object(
      'destinationType', destination_type_value,
      'projectId', project_id_value,
      'minorWorkOrderId', minor_id_value,
      'destinationNameSnapshot', snapshot_value,
      'purpose', private.warehouse_workflow_text(p_request, 'purpose', 1000, true),
      'receiver', private.warehouse_workflow_text(p_request, 'receiver', 300, true),
      'requestDate', private.warehouse_workflow_date(p_request, 'requestDate')
    ),
    'lines', jsonb_agg(jsonb_build_object(
      'variantId', private.warehouse_workflow_uuid(value, 'variantId'),
      'requestedQuantity', private.warehouse_workflow_quantity(value)
    ) order by value->>'variantId')
  ) into canonical_payload
  from jsonb_array_elements(p_lines);
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-stock-out-submit-idempotency:' || p_idempotency_key, 0
  ));
  select request.* into existing_request
  from public.warehouse_stock_out_requests request
  where request.idempotency_key = p_idempotency_key;
  if found then
    if existing_request.submitted_by_employee_profile_id = actor_id
      and existing_request.submission_payload = canonical_payload
    then
      return private.warehouse_stock_out_json(existing_request.id, view_cost);
    end if;
    raise exception using errcode = '23505', message = 'warehouse workflow idempotency conflict',
      hint = 'WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT';
  end if;

  if destination_type_value = 'project' then
    select private.normalize_warehouse_catalog_text(project.payload->>'projectName')
      into derived_snapshot from public.projects project
      where project.record_key = project_id_value and project.status = 'active';
  elsif destination_type_value = 'minor_work_order' then
    select job.customer_name || '・' || job.title into derived_snapshot
      from public.warehouse_minor_work_orders job
      where job.id = minor_id_value and job.status in ('open', 'assigned');
  else
    derived_snapshot := snapshot_value;
  end if;
  if derived_snapshot is null or snapshot_value <> derived_snapshot then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;

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
  ) then raise exception using errcode = '55000', message = 'active warehouse resources required',
    hint = 'WAREHOUSE_RESOURCE_INACTIVE'; end if;

  insert into public.warehouse_stock_out_requests(
    destination_type, project_id, minor_work_order_id, destination_name_snapshot,
    purpose, receiver, request_date, submitted_by_employee_profile_id, idempotency_key,
    submission_payload
  ) values (
    destination_type_value, project_id_value, minor_id_value, snapshot_value,
    private.warehouse_workflow_text(p_request, 'purpose', 1000, true),
    private.warehouse_workflow_text(p_request, 'receiver', 300, true),
    private.warehouse_workflow_date(p_request, 'requestDate'), actor_id, p_idempotency_key,
    canonical_payload
  ) returning id into saved_id;
  insert into public.warehouse_stock_out_lines(
    request_id, variant_id, requested_quantity
  ) select saved_id, private.warehouse_workflow_uuid(value, 'variantId'),
    private.warehouse_workflow_quantity(value)
    from jsonb_array_elements(p_lines);
  return private.warehouse_stock_out_json(saved_id, view_cost);
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
declare
  actor_id uuid; saved_id uuid; line jsonb; resource_id uuid;
  existing_return public.warehouse_return_requests%rowtype;
  canonical_payload jsonb;
  view_cost boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.request');
  view_cost := public.has_current_permission('warehouse.cost.view');
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  if p_original_stock_out_id is null or not private.warehouse_catalog_payload_keys_exact(
    p_request, array['reason','receiver','requestDate']
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;
  perform private.warehouse_workflow_text(p_request, 'reason', 1000, true);
  perform private.warehouse_workflow_text(p_request, 'receiver', 300, true);
  perform private.warehouse_workflow_date(p_request, 'requestDate');
  for line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      line, array['originalStockOutLineId','requestedQuantity']
    ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;
    perform private.warehouse_workflow_uuid(line, 'originalStockOutLineId');
    perform private.warehouse_workflow_quantity(line);
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'originalStockOutLineId') from jsonb_array_elements(p_lines)
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;

  select jsonb_build_object(
    'originalStockOutId', p_original_stock_out_id,
    'request', jsonb_build_object(
      'reason', private.warehouse_workflow_text(p_request, 'reason', 1000, true),
      'receiver', private.warehouse_workflow_text(p_request, 'receiver', 300, true),
      'requestDate', private.warehouse_workflow_date(p_request, 'requestDate')
    ),
    'lines', jsonb_agg(jsonb_build_object(
      'originalStockOutLineId', private.warehouse_workflow_uuid(value, 'originalStockOutLineId'),
      'requestedQuantity', private.warehouse_workflow_quantity(value)
    ) order by value->>'originalStockOutLineId')
  ) into canonical_payload
  from jsonb_array_elements(p_lines);
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-return-submit-idempotency:' || p_idempotency_key, 0
  ));
  select request.* into existing_return
  from public.warehouse_return_requests request
  where request.idempotency_key = p_idempotency_key;
  if found then
    if existing_return.submitted_by_employee_profile_id = actor_id
      and existing_return.submission_payload = canonical_payload
    then
      return private.warehouse_return_json(existing_return.id, view_cost);
    end if;
    raise exception using errcode = '23505', message = 'warehouse workflow idempotency conflict',
      hint = 'WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT';
  end if;

  if not exists (
    select 1 from public.warehouse_stock_out_requests request
    where request.id = p_original_stock_out_id and request.status = 'confirmed'
  ) then
    raise exception using errcode = '55000', message = 'warehouse destination unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'originalStockOutLineId')
     and line.request_id = p_original_stock_out_id
    where line.id is null
  ) then raise exception using errcode = '22023', message = 'warehouse workflow input invalid', hint = 'WAREHOUSE_WORKFLOW_INPUT_INVALID'; end if;

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
  ) then raise exception using errcode = '55000', message = 'active warehouse resources required',
    hint = 'WAREHOUSE_RESOURCE_INACTIVE'; end if;

  insert into public.warehouse_return_requests(
    original_stock_out_id, reason, receiver, request_date,
    submitted_by_employee_profile_id, idempotency_key, submission_payload
  ) values (
    p_original_stock_out_id,
    private.warehouse_workflow_text(p_request, 'reason', 1000, true),
    private.warehouse_workflow_text(p_request, 'receiver', 300, true),
    private.warehouse_workflow_date(p_request, 'requestDate'), actor_id, p_idempotency_key,
    canonical_payload
  ) returning id into saved_id;
  insert into public.warehouse_return_lines(
    return_id, original_stock_out_id, original_stock_out_line_id, requested_quantity
  ) select saved_id,
    p_original_stock_out_id,
    private.warehouse_workflow_uuid(value, 'originalStockOutLineId'),
    private.warehouse_workflow_quantity(value)
    from jsonb_array_elements(p_lines);
  return private.warehouse_return_json(saved_id, view_cost);
end;
$$;

create or replace function private.warehouse_confirmation_quantity(
  p_value jsonb,
  p_field text
)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare result numeric;
begin
  if jsonb_typeof(p_value->p_field) is distinct from 'number' then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  begin
    result := (p_value->>p_field)::numeric;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end;
  if result <= 0 or result > 9007199254740.990 or result <> trunc(result, 3)
    or result in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
  then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  return result::numeric(18,3);
end;
$$;

create or replace function private.warehouse_purchase_unit_cost(p_payload jsonb)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  ordered_quantity numeric;
  total_cost numeric;
  unit_cost numeric;
begin
  if jsonb_typeof(p_payload->'quantity') is distinct from 'number'
    or jsonb_typeof(p_payload->'totalCost') is distinct from 'number'
    or (p_payload->>'quantity') !~ '^(0|[1-9][0-9]*)(\.[0-9]{1,3})?$'
    or (p_payload->>'totalCost') !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
  then
    raise exception using errcode = '22023', message = 'purchase cost invalid for warehouse receipt',
      hint = 'WAREHOUSE_PURCHASE_COST_INVALID';
  end if;
  begin
    ordered_quantity := (p_payload->>'quantity')::numeric;
    total_cost := (p_payload->>'totalCost')::numeric;
    if ordered_quantity <= 0 or ordered_quantity > 999999999999999.999
      or total_cost < 0
      or ordered_quantity in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
      or total_cost in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)
    then
      raise numeric_value_out_of_range;
    end if;
    unit_cost := round(total_cost / ordered_quantity, 4);
    if unit_cost > 900719925474.0991 then raise numeric_value_out_of_range; end if;
    return unit_cost::numeric(18,4);
  exception when invalid_text_representation or numeric_value_out_of_range or division_by_zero then
    raise exception using errcode = '22023', message = 'purchase cost invalid for warehouse receipt',
      hint = 'WAREHOUSE_PURCHASE_COST_INVALID';
  end;
end;
$$;

create or replace function private.warehouse_receipt_confirmation_json(
  p_id uuid,
  p_view_cost boolean
)
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
    'confirmationIdempotencyKey', receipt.confirmation_idempotency_key,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'receiptId', line.receipt_id, 'variantId', line.variant_id,
        'requestedQuantity', line.requested_quantity,
        'confirmedQuantity', line.confirmed_quantity,
        'warehouseId', line.warehouse_id, 'locationId', line.location_id,
        'unitCost', case when p_view_cost then line.unit_cost else null end
      ) order by line.id)
      from public.warehouse_receipt_lines line where line.receipt_id = receipt.id
    ), '[]'::jsonb)
  ) from public.warehouse_receipts receipt where receipt.id = p_id
$$;

create or replace function private.warehouse_stock_out_confirmation_json(
  p_id uuid,
  p_view_cost boolean
)
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
    'confirmationIdempotencyKey', request.confirmation_idempotency_key,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'requestId', line.request_id, 'variantId', line.variant_id,
        'requestedQuantity', line.requested_quantity,
        'confirmedQuantity', line.confirmed_quantity,
        'warehouseId', confirmation.value->>'warehouseId',
        'locationId', confirmation.value->>'locationId',
        'frozenTotalCost', case when p_view_cost then line.frozen_total_cost else null end
      ) order by line.id)
      from public.warehouse_stock_out_lines line
      join lateral jsonb_array_elements(request.confirmation_payload->'lines') confirmation(value)
        on confirmation.value->>'stockOutLineId' = line.id::text
      where line.request_id = request.id
    ), '[]'::jsonb)
  ) from public.warehouse_stock_out_requests request where request.id = p_id
$$;

create or replace function private.warehouse_return_confirmation_json(
  p_id uuid,
  p_view_cost boolean
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', request.id,
    'originalStockOutId', request.original_stock_out_id,
    'destinationType', original.destination_type,
    'projectId', original.project_id,
    'minorWorkOrderId', original.minor_work_order_id,
    'destinationNameSnapshot', original.destination_name_snapshot,
    'reason', request.reason, 'receiver', request.receiver,
    'requestDate', request.request_date, 'status', request.status,
    'submittedByEmployeeProfileId', request.submitted_by_employee_profile_id,
    'submittedAt', request.submitted_at,
    'confirmedByEmployeeProfileId', request.confirmed_by_employee_profile_id,
    'confirmedAt', request.confirmed_at, 'rejectionReason', request.rejection_reason,
    'idempotencyKey', request.idempotency_key,
    'confirmationIdempotencyKey', request.confirmation_idempotency_key,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', line.id, 'returnId', line.return_id,
        'originalStockOutLineId', line.original_stock_out_line_id,
        'variantId', original_line.variant_id,
        'requestedQuantity', line.requested_quantity,
        'confirmedQuantity', line.confirmed_quantity,
        'frozenTotalCost', case when p_view_cost then line.frozen_total_cost else null end
      ) order by line.id)
      from public.warehouse_return_lines line
      join public.warehouse_stock_out_lines original_line
        on original_line.id = line.original_stock_out_line_id
      where line.return_id = request.id
    ), '[]'::jsonb)
  )
  from public.warehouse_return_requests request
  join public.warehouse_stock_out_requests original
    on original.id = request.original_stock_out_id
  where request.id = p_id
$$;

create or replace function public.confirm_warehouse_receipt_secure(
  p_receipt_id uuid,
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
  actor_id uuid;
  receipt_row public.warehouse_receipts%rowtype;
  purchase_row public.purchase_records%rowtype;
  supplied_line jsonb;
  canonical_payload jsonb;
  resource_id uuid;
  locked_row record;
  receipt_line public.warehouse_receipt_lines%rowtype;
  batch_id uuid;
  ordered_quantity numeric(18,3);
  other_committed numeric(18,3);
  confirmed_total numeric(18,3);
  authoritative_unit_cost numeric(18,4);
  confirmed_at_value timestamptz;
  view_cost boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.receipt.confirm');
  view_cost := public.has_current_permission('warehouse.cost.view');
  if p_receipt_id is null then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  for supplied_line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      supplied_line,
      array['receiptLineId','confirmedQuantity','warehouseId','locationId']
    ) then
      raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
        hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
    end if;
    perform private.warehouse_workflow_uuid(supplied_line, 'receiptLineId');
    perform private.warehouse_confirmation_quantity(supplied_line, 'confirmedQuantity');
    perform private.warehouse_workflow_uuid(supplied_line, 'warehouseId');
    perform private.warehouse_workflow_uuid(supplied_line, 'locationId');
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'receiptLineId') from jsonb_array_elements(p_lines)
  ) then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  canonical_payload := jsonb_build_object(
    'receiptId', p_receipt_id,
    'lines', (
      select jsonb_agg(jsonb_build_object(
        'receiptLineId', private.warehouse_workflow_uuid(value, 'receiptLineId'),
        'confirmedQuantity', private.warehouse_confirmation_quantity(value, 'confirmedQuantity'),
        'warehouseId', private.warehouse_workflow_uuid(value, 'warehouseId'),
        'locationId', private.warehouse_workflow_uuid(value, 'locationId')
      ) order by value->>'receiptLineId')
      from jsonb_array_elements(p_lines)
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-receipt-confirm-document:' || p_receipt_id::text, 0
  ));
  select receipt.* into receipt_row
  from public.warehouse_receipts receipt
  where receipt.id = p_receipt_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse receipt unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-receipt-confirm-key:' || p_idempotency_key, 0
  ));
  if receipt_row.status in ('confirmed', 'void')
    and receipt_row.confirmation_idempotency_key is not null
  then
    if receipt_row.confirmation_idempotency_key = p_idempotency_key
      and receipt_row.confirmation_payload = canonical_payload
    then
      return private.warehouse_receipt_confirmation_json(p_receipt_id, view_cost);
    elsif receipt_row.confirmation_idempotency_key = p_idempotency_key then
      raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
        hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
    end if;
    raise exception using errcode = '55000', message = 'warehouse document already confirmed',
      hint = 'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED';
  elsif receipt_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'warehouse receipt unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  if exists (
    select 1 from public.warehouse_receipts other
    where other.confirmation_idempotency_key = p_idempotency_key
      and other.id <> p_receipt_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(*) from public.warehouse_receipt_lines line
    where line.receipt_id = p_receipt_id
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_receipt_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'receiptLineId')
     and line.receipt_id = p_receipt_id
    where line.id is null
       or line.requested_quantity > 9007199254740.990
       or private.warehouse_confirmation_quantity(entry.value, 'confirmedQuantity')
          > line.requested_quantity
  ) then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;

  select purchase.* into purchase_row
  from public.purchase_records purchase
  where purchase.record_key = receipt_row.purchase_record_key
  for update;
  if not found or purchase_row.status <> 'active' then
    raise exception using errcode = '22023', message = 'purchase cost invalid for warehouse receipt',
      hint = 'WAREHOUSE_PURCHASE_COST_INVALID';
  end if;
  perform private.lock_purchase_record_key(receipt_row.purchase_record_key);
  authoritative_unit_cost := private.warehouse_purchase_unit_cost(purchase_row.payload);
  ordered_quantity := (purchase_row.payload->>'quantity')::numeric(18,3);
  select coalesce(sum(case
    when receipt.status = 'pending' then line.requested_quantity
    when receipt.status = 'confirmed' then line.confirmed_quantity
    else 0
  end), 0)::numeric(18,3)
  into other_committed
  from public.warehouse_receipts receipt
  join public.warehouse_receipt_lines line on line.receipt_id = receipt.id
  where receipt.purchase_record_key = receipt_row.purchase_record_key
    and receipt.id <> p_receipt_id;
  select sum(private.warehouse_confirmation_quantity(value, 'confirmedQuantity'))::numeric(18,3)
  into confirmed_total from jsonb_array_elements(p_lines);
  if confirmed_total > ordered_quantity - other_committed then
    raise exception using errcode = '23514', message = 'purchase confirmation exceeds remainder',
      hint = 'WAREHOUSE_PURCHASE_REMAINDER_EXCEEDED';
  end if;

  for resource_id in
    select distinct private.warehouse_workflow_uuid(value, 'locationId')
    from jsonb_array_elements(p_lines) order by 1
  loop perform private.lock_warehouse_location_resource(resource_id); end loop;
  for resource_id in
    select distinct line.variant_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_receipt_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'receiptLineId')
    order by 1
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;

  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    join public.warehouse_receipt_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'receiptLineId')
    left join public.warehouse_locations location
      on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
     and location.warehouse_id = private.warehouse_workflow_uuid(entry.value, 'warehouseId')
    left join public.warehouse_sites site on site.id = location.warehouse_id
    left join public.warehouse_variants variant on variant.id = line.variant_id
    left join public.warehouse_items item on item.id = variant.item_id
    where location.id is null or not location.active
       or site.id is null or not site.active
       or variant.id is null or not variant.active
       or item.id is null or not item.active
  ) then
    if exists (
      select 1 from jsonb_array_elements(p_lines) entry
      join public.warehouse_locations location
        on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
      where location.warehouse_id <>
        private.warehouse_workflow_uuid(entry.value, 'warehouseId')
    ) then
      raise exception using errcode = '23503', message = 'warehouse location mismatch',
        hint = 'WAREHOUSE_LOCATION_MISMATCH';
    end if;
    raise exception using errcode = '55000', message = 'active warehouse resources required',
      hint = 'WAREHOUSE_RESOURCE_INACTIVE';
  end if;
  for locked_row in
    select location.id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_locations location
      on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
    order by location.id for key share of location
  loop null; end loop;
  for locked_row in
    select variant.id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_receipt_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'receiptLineId')
    join public.warehouse_variants variant on variant.id = line.variant_id
    order by variant.id for key share of variant
  loop null; end loop;

  confirmed_at_value := clock_timestamp();
  update public.warehouse_receipt_lines line
  set confirmed_quantity = private.warehouse_confirmation_quantity(entry.value, 'confirmedQuantity'),
      warehouse_id = private.warehouse_workflow_uuid(entry.value, 'warehouseId'),
      location_id = private.warehouse_workflow_uuid(entry.value, 'locationId'),
      unit_cost = authoritative_unit_cost
  from jsonb_array_elements(p_lines) entry
  where line.id = private.warehouse_workflow_uuid(entry.value, 'receiptLineId')
    and line.receipt_id = p_receipt_id;

  for receipt_line in
    select line.* from public.warehouse_receipt_lines line
    where line.receipt_id = p_receipt_id order by line.id
  loop
    insert into public.warehouse_batches(
      variant_id, receipt_line_id, received_at, unit_cost, original_quantity
    ) values (
      receipt_line.variant_id, receipt_line.id, confirmed_at_value,
      receipt_line.unit_cost, receipt_line.confirmed_quantity
    ) returning id into batch_id;
    insert into public.warehouse_batch_locations(batch_id, location_id, quantity)
    values (batch_id, receipt_line.location_id, receipt_line.confirmed_quantity);
    insert into public.warehouse_inventory_movements(
      movement_type, variant_id, batch_id, warehouse_id, location_id,
      quantity_delta, unit_cost, source_document_type, source_document_id,
      idempotency_key, operator_employee_profile_id, occurred_at, metadata
    ) values (
      '采购入库', receipt_line.variant_id, batch_id, receipt_line.warehouse_id,
      receipt_line.location_id, receipt_line.confirmed_quantity, receipt_line.unit_cost,
      'warehouse_receipt', p_receipt_id::text,
      'receipt-confirm:' || p_receipt_id::text || ':' || receipt_line.id::text,
      actor_id, confirmed_at_value,
      jsonb_build_object(
        'receiptLineId', receipt_line.id,
        'purchaseRecordKey', receipt_row.purchase_record_key
      )
    );
  end loop;
  update public.warehouse_receipts
  set status = 'confirmed', confirmed_by_employee_profile_id = actor_id,
      confirmed_at = confirmed_at_value,
      confirmation_idempotency_key = p_idempotency_key,
      confirmation_payload = canonical_payload
  where id = p_receipt_id;
  return private.warehouse_receipt_confirmation_json(p_receipt_id, view_cost);
exception when unique_violation then
  if exists (
    select 1 from public.warehouse_receipts receipt
    where receipt.confirmation_idempotency_key = p_idempotency_key
      and receipt.id <> p_receipt_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  raise;
end;
$$;

create or replace function public.confirm_warehouse_stock_out_secure(
  p_request_id uuid,
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
  actor_id uuid;
  request_row public.warehouse_stock_out_requests%rowtype;
  supplied_line jsonb;
  canonical_payload jsonb;
  resource_id uuid;
  locked_row record;
  requested_line record;
  allocation record;
  remaining_quantity numeric(18,3);
  consumed_quantity numeric(18,3);
  total_cost numeric;
  confirmed_at_value timestamptz;
  view_cost boolean;
  project_total numeric;
  purchase_keys jsonb;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.confirm');
  view_cost := public.has_current_permission('warehouse.cost.view');
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  for supplied_line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      supplied_line,
      array['stockOutLineId','confirmedQuantity','warehouseId','locationId']
    ) then
      raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
        hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
    end if;
    perform private.warehouse_workflow_uuid(supplied_line, 'stockOutLineId');
    perform private.warehouse_confirmation_quantity(supplied_line, 'confirmedQuantity');
    perform private.warehouse_workflow_uuid(supplied_line, 'warehouseId');
    perform private.warehouse_workflow_uuid(supplied_line, 'locationId');
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'stockOutLineId') from jsonb_array_elements(p_lines)
  ) then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  canonical_payload := jsonb_build_object(
    'requestId', p_request_id,
    'lines', (
      select jsonb_agg(jsonb_build_object(
        'stockOutLineId', private.warehouse_workflow_uuid(value, 'stockOutLineId'),
        'confirmedQuantity', private.warehouse_confirmation_quantity(value, 'confirmedQuantity'),
        'warehouseId', private.warehouse_workflow_uuid(value, 'warehouseId'),
        'locationId', private.warehouse_workflow_uuid(value, 'locationId')
      ) order by value->>'stockOutLineId')
      from jsonb_array_elements(p_lines)
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-stock-out-confirm-document:' || p_request_id::text, 0
  ));
  select request.* into request_row
  from public.warehouse_stock_out_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse stock-out unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-stock-out-confirm-key:' || p_idempotency_key, 0
  ));
  if request_row.status in ('confirmed', 'void')
    and request_row.confirmation_idempotency_key is not null
  then
    if request_row.confirmation_idempotency_key = p_idempotency_key
      and request_row.confirmation_payload = canonical_payload
    then
      return private.warehouse_stock_out_confirmation_json(p_request_id, view_cost);
    elsif request_row.confirmation_idempotency_key = p_idempotency_key then
      raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
        hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
    end if;
    raise exception using errcode = '55000', message = 'warehouse document already confirmed',
      hint = 'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED';
  elsif request_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'warehouse stock-out unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  if exists (
    select 1 from public.warehouse_stock_out_requests other
    where other.confirmation_idempotency_key = p_idempotency_key
      and other.id <> p_request_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(*) from public.warehouse_stock_out_lines line
    where line.request_id = p_request_id
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'stockOutLineId')
     and line.request_id = p_request_id
    where line.id is null
       or line.requested_quantity > 9007199254740.990
       or private.warehouse_confirmation_quantity(entry.value, 'confirmedQuantity')
          > line.requested_quantity
  ) then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;

  for resource_id in
    select distinct private.warehouse_workflow_uuid(value, 'locationId')
    from jsonb_array_elements(p_lines) order by 1
  loop perform private.lock_warehouse_location_resource(resource_id); end loop;
  for resource_id in
    select distinct line.variant_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'stockOutLineId')
    order by 1
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;

  if request_row.destination_type = 'minor_work_order' then
    perform pg_advisory_xact_lock(hashtextextended(
      'warehouse-minor-work-cost:' || request_row.minor_work_order_id::text, 0
    ));
    perform 1 from public.warehouse_minor_work_orders job
    where job.id = request_row.minor_work_order_id for update;
    if not found then
      raise exception using errcode = '55000', message = 'warehouse destination unavailable',
        hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'stockOutLineId')
    left join public.warehouse_locations location
      on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
     and location.warehouse_id = private.warehouse_workflow_uuid(entry.value, 'warehouseId')
    left join public.warehouse_sites site on site.id = location.warehouse_id
    left join public.warehouse_variants variant on variant.id = line.variant_id
    left join public.warehouse_items item on item.id = variant.item_id
    where location.id is null or not location.active
       or site.id is null or not site.active
       or variant.id is null or not variant.active
       or item.id is null or not item.active
  ) then
    if exists (
      select 1 from jsonb_array_elements(p_lines) entry
      join public.warehouse_locations location
        on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
      where location.warehouse_id <>
        private.warehouse_workflow_uuid(entry.value, 'warehouseId')
    ) then
      raise exception using errcode = '23503', message = 'warehouse location mismatch',
        hint = 'WAREHOUSE_LOCATION_MISMATCH';
    end if;
    raise exception using errcode = '55000', message = 'active warehouse resources required',
      hint = 'WAREHOUSE_RESOURCE_INACTIVE';
  end if;
  for locked_row in
    select location.id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_locations location
      on location.id = private.warehouse_workflow_uuid(entry.value, 'locationId')
    order by location.id for key share of location
  loop null; end loop;
  for locked_row in
    select variant.id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'stockOutLineId')
    join public.warehouse_variants variant on variant.id = line.variant_id
    order by variant.id for key share of variant
  loop null; end loop;

  for locked_row in
    select balance.batch_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'stockOutLineId')
    join public.warehouse_batches batch on batch.variant_id = line.variant_id
    join public.warehouse_batch_locations balance
      on balance.batch_id = batch.id
     and balance.location_id = private.warehouse_workflow_uuid(entry.value, 'locationId')
    where balance.quantity > 0
    order by batch.received_at, batch.id
    for update of balance
  loop null; end loop;

  confirmed_at_value := clock_timestamp();
  for requested_line in
    select line.id, line.variant_id, entry.value as payload
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_stock_out_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'stockOutLineId')
     and line.request_id = p_request_id
    order by line.id
  loop
    remaining_quantity := private.warehouse_confirmation_quantity(
      requested_line.payload, 'confirmedQuantity'
    );
    total_cost := 0;
    for allocation in
      select batch.id as batch_id, batch.unit_cost, balance.quantity
      from public.warehouse_batches batch
      join public.warehouse_batch_locations balance on balance.batch_id = batch.id
      where batch.variant_id = requested_line.variant_id
        and balance.location_id = private.warehouse_workflow_uuid(
          requested_line.payload, 'locationId'
        )
        and balance.quantity > 0
      order by batch.received_at, batch.id
    loop
      exit when remaining_quantity = 0;
      consumed_quantity := least(remaining_quantity, allocation.quantity)::numeric(18,3);
      if allocation.unit_cost > 900719925474.0991
        or total_cost + consumed_quantity * allocation.unit_cost > 900719925474.0991
      then
        raise exception using errcode = '22023',
          message = 'purchase cost invalid for warehouse receipt',
          hint = 'WAREHOUSE_PURCHASE_COST_INVALID';
      end if;
      update public.warehouse_batch_locations
      set quantity = quantity - consumed_quantity
      where batch_id = allocation.batch_id
        and location_id = private.warehouse_workflow_uuid(
          requested_line.payload, 'locationId'
        );
      insert into public.warehouse_inventory_movements(
        movement_type, variant_id, batch_id, warehouse_id, location_id,
        quantity_delta, unit_cost, source_document_type, source_document_id,
        idempotency_key, project_id, destination_type, destination_id,
        destination_name, operator_employee_profile_id, occurred_at, metadata
      ) values (
        '项目出库', requested_line.variant_id, allocation.batch_id,
        private.warehouse_workflow_uuid(requested_line.payload, 'warehouseId'),
        private.warehouse_workflow_uuid(requested_line.payload, 'locationId'),
        -consumed_quantity, allocation.unit_cost,
        'warehouse_stock_out', p_request_id::text,
        'stock-out-confirm:' || p_request_id::text || ':' ||
          requested_line.id::text || ':' || allocation.batch_id::text,
        request_row.project_id, request_row.destination_type,
        case
          when request_row.destination_type = 'project' then request_row.project_id
          when request_row.destination_type = 'minor_work_order'
            then request_row.minor_work_order_id::text
          else null
        end,
        request_row.destination_name_snapshot, actor_id, confirmed_at_value,
        jsonb_build_object('stockOutLineId', requested_line.id)
      );
      total_cost := total_cost + consumed_quantity * allocation.unit_cost;
      remaining_quantity := remaining_quantity - consumed_quantity;
    end loop;
    if remaining_quantity > 0 then
      raise exception using errcode = '23514', message = 'warehouse stock insufficient',
        hint = 'WAREHOUSE_INSUFFICIENT_STOCK';
    end if;
    update public.warehouse_stock_out_lines
    set confirmed_quantity = private.warehouse_confirmation_quantity(
          requested_line.payload, 'confirmedQuantity'
        ),
        frozen_total_cost = round(total_cost, 4)::numeric(18,4)
    where id = requested_line.id and request_id = p_request_id;
  end loop;
  update public.warehouse_stock_out_requests
  set status = 'confirmed', confirmed_by_employee_profile_id = actor_id,
      confirmed_at = confirmed_at_value,
      confirmation_idempotency_key = p_idempotency_key,
      confirmation_payload = canonical_payload
  where id = p_request_id;
  if request_row.destination_type = 'project' then
    select sum(line.frozen_total_cost) into project_total
    from public.warehouse_stock_out_lines line where line.request_id = p_request_id;
    if project_total > 0 then
      select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into purchase_keys
      from (
        select distinct receipt.purchase_record_key as key
        from public.warehouse_inventory_movements movement
        join public.warehouse_batches batch on batch.id = movement.batch_id
        join public.warehouse_receipt_lines receipt_line on receipt_line.id = batch.receipt_line_id
        join public.warehouse_receipts receipt on receipt.id = receipt_line.receipt_id
        where movement.source_document_type = 'warehouse_stock_out'
          and movement.source_document_id = p_request_id::text
      ) provenance;
      perform private.upsert_warehouse_project_cost(
        'WAREHOUSE-SO:' || p_request_id::text,
        request_row.project_id, project_total, actor_id, confirmed_at_value,
        (confirmed_at_value at time zone 'Asia/Tokyo')::date,
        p_request_id, 'warehouse_stock_out', purchase_keys,
        jsonb_build_array(p_request_id), false
      );
    end if;
  elsif request_row.destination_type = 'minor_work_order' then
    perform private.post_minor_work_order_cost(
      request_row.minor_work_order_id, actor_id, confirmed_at_value, false
    );
  end if;
  return private.warehouse_stock_out_confirmation_json(p_request_id, view_cost);
exception when unique_violation then
  if exists (
    select 1 from public.warehouse_stock_out_requests request
    where request.confirmation_idempotency_key = p_idempotency_key
      and request.id <> p_request_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  raise;
end;
$$;

create or replace function public.confirm_warehouse_return_secure(
  p_return_id uuid,
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
  actor_id uuid;
  return_row public.warehouse_return_requests%rowtype;
  original_row public.warehouse_stock_out_requests%rowtype;
  supplied_line jsonb;
  canonical_payload jsonb;
  line_row record;
  movement_row record;
  v_requested_quantity numeric(18,3);
  movement_available numeric(18,3);
  returned_quantity numeric(18,3);
  allocated_quantity numeric(18,3);
  remaining_quantity numeric(18,3);
  total_cost numeric;
  line_frozen_total numeric(18,4);
  return_total numeric := 0;
  confirmed_at_value timestamptz;
  view_cost boolean;
  cost_project_id text;
  purchase_keys jsonb;
  resource_id uuid;
  locked_row record;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.confirm');
  view_cost := public.has_current_permission('warehouse.cost.view');
  if p_return_id is null then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  perform private.warehouse_workflow_lines(p_lines);
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  for supplied_line in select value from jsonb_array_elements(p_lines) loop
    if not private.warehouse_catalog_payload_keys_exact(
      supplied_line, array['returnLineId','confirmedQuantity']
    ) then
      raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
        hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
    end if;
    perform private.warehouse_workflow_uuid(supplied_line, 'returnLineId');
    perform private.warehouse_confirmation_quantity(supplied_line, 'confirmedQuantity');
  end loop;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(distinct value->>'returnLineId') from jsonb_array_elements(p_lines)
  ) then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  canonical_payload := jsonb_build_object(
    'returnId', p_return_id,
    'lines', (
      select jsonb_agg(jsonb_build_object(
        'returnLineId', private.warehouse_workflow_uuid(value, 'returnLineId'),
        'confirmedQuantity', private.warehouse_confirmation_quantity(value, 'confirmedQuantity')
      ) order by value->>'returnLineId')
      from jsonb_array_elements(p_lines)
    )
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-return-confirm-document:' || p_return_id::text, 0
  ));
  select * into return_row from public.warehouse_return_requests
  where id = p_return_id for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse return unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-return-confirm-key:' || p_idempotency_key, 0
  ));
  if return_row.status in ('confirmed', 'void')
    and return_row.confirmation_idempotency_key is not null
  then
    if return_row.confirmation_idempotency_key = p_idempotency_key
      and return_row.confirmation_payload = canonical_payload
    then
      return private.warehouse_return_confirmation_json(p_return_id, view_cost);
    elsif return_row.confirmation_idempotency_key = p_idempotency_key then
      raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
        hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
    end if;
    raise exception using errcode = '55000', message = 'warehouse document already confirmed',
      hint = 'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED';
  elsif return_row.status <> 'pending' then
    raise exception using errcode = '55000', message = 'warehouse return unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  if exists (
    select 1 from public.warehouse_return_requests other
    where other.confirmation_idempotency_key = p_idempotency_key
      and other.id <> p_return_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;

  select * into original_row from public.warehouse_stock_out_requests
  where id = return_row.original_stock_out_id for update;
  if not found or original_row.status <> 'confirmed' then
    raise exception using errcode = '55000', message = 'warehouse original stock-out unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  if (select count(*) from jsonb_array_elements(p_lines)) <> (
    select count(*) from public.warehouse_return_lines line where line.return_id = p_return_id
  ) or exists (
    select 1 from jsonb_array_elements(p_lines) entry
    left join public.warehouse_return_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'returnLineId')
     and line.return_id = p_return_id
    left join public.warehouse_stock_out_lines original_line
      on original_line.id = line.original_stock_out_line_id
     and original_line.request_id = return_row.original_stock_out_id
    where line.id is null or original_line.id is null
       or private.warehouse_confirmation_quantity(entry.value, 'confirmedQuantity')
          > line.requested_quantity
  ) then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;

  for resource_id in
    select distinct movement.location_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_return_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'returnLineId')
     and line.return_id = p_return_id
    join public.warehouse_inventory_movements movement
      on movement.source_document_type = 'warehouse_stock_out'
     and movement.source_document_id = return_row.original_stock_out_id::text
     and movement.metadata->>'stockOutLineId' = line.original_stock_out_line_id::text
    order by movement.location_id
  loop perform private.lock_warehouse_location_resource(resource_id); end loop;
  for resource_id in
    select distinct original_line.variant_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_return_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'returnLineId')
     and line.return_id = p_return_id
    join public.warehouse_stock_out_lines original_line
      on original_line.id = line.original_stock_out_line_id
    order by original_line.variant_id
  loop perform private.lock_warehouse_variant_resource(resource_id); end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_return_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'returnLineId')
     and line.return_id = p_return_id
    join public.warehouse_stock_out_lines original_line
      on original_line.id = line.original_stock_out_line_id
    join public.warehouse_variants variant on variant.id = original_line.variant_id
    join public.warehouse_items item on item.id = variant.item_id
    join public.warehouse_inventory_movements movement
      on movement.source_document_type = 'warehouse_stock_out'
     and movement.source_document_id = return_row.original_stock_out_id::text
     and movement.metadata->>'stockOutLineId' = line.original_stock_out_line_id::text
    join public.warehouse_locations location on location.id = movement.location_id
    join public.warehouse_sites site on site.id = location.warehouse_id
    where not location.active or not site.active or not variant.active or not item.active
  ) then
    raise exception using errcode = '55000', message = 'active warehouse resources required',
      hint = 'WAREHOUSE_RESOURCE_INACTIVE';
  end if;
  for locked_row in
    select balance.batch_id, balance.location_id
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_return_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'returnLineId')
     and line.return_id = p_return_id
    join public.warehouse_inventory_movements movement
      on movement.source_document_type = 'warehouse_stock_out'
     and movement.source_document_id = return_row.original_stock_out_id::text
     and movement.metadata->>'stockOutLineId' = line.original_stock_out_line_id::text
    join public.warehouse_batch_locations balance
      on balance.batch_id = movement.batch_id
     and balance.location_id = movement.location_id
    order by balance.batch_id, balance.location_id
    for update of balance
  loop null; end loop;

  confirmed_at_value := clock_timestamp();
  for line_row in
    select line.id, line.original_stock_out_line_id, original_line.variant_id,
      entry.value as payload
    from jsonb_array_elements(p_lines) entry
    join public.warehouse_return_lines line
      on line.id = private.warehouse_workflow_uuid(entry.value, 'returnLineId')
     and line.return_id = p_return_id
    join public.warehouse_stock_out_lines original_line
      on original_line.id = line.original_stock_out_line_id
    order by line.id
  loop
    v_requested_quantity := private.warehouse_confirmation_quantity(
      line_row.payload, 'confirmedQuantity'
    );
    select coalesce(sum(confirmed_line.confirmed_quantity), 0)
    into returned_quantity
    from public.warehouse_return_lines confirmed_line
    join public.warehouse_return_requests confirmed_request
      on confirmed_request.id = confirmed_line.return_id
    where confirmed_line.original_stock_out_line_id = line_row.original_stock_out_line_id
      and confirmed_request.status in ('confirmed', 'void')
      and confirmed_line.return_id <> p_return_id;
    if v_requested_quantity > (
      select original_line.confirmed_quantity - returned_quantity
      from public.warehouse_stock_out_lines original_line
      where original_line.id = line_row.original_stock_out_line_id
    ) then
      raise exception using errcode = '23514', message = 'warehouse return quantity exceeded',
        hint = 'WAREHOUSE_RETURN_QUANTITY_EXCEEDED';
    end if;

    remaining_quantity := v_requested_quantity;
    total_cost := 0;
    for movement_row in
      select movement.*,
        greatest(0, -movement.quantity_delta - coalesce((
          select sum(return_movement.quantity_delta)
          from public.warehouse_inventory_movements return_movement
          where return_movement.source_document_type = 'warehouse_return'
            and return_movement.metadata->>'originalMovementId' = movement.id::text
        ), 0))::numeric(18,3) as available_quantity
      from public.warehouse_inventory_movements movement
      join public.warehouse_batches original_batch on original_batch.id = movement.batch_id
      where movement.source_document_type = 'warehouse_stock_out'
        and movement.source_document_id = return_row.original_stock_out_id::text
        and movement.metadata->>'stockOutLineId' = line_row.original_stock_out_line_id::text
        and movement.quantity_delta < 0
      order by original_batch.received_at, original_batch.id, movement.id
    loop
      exit when remaining_quantity = 0;
      movement_available := movement_row.available_quantity;
      if movement_available <= 0 then continue; end if;
      allocated_quantity := least(remaining_quantity, movement_available)::numeric(18,3);
      update public.warehouse_batch_locations
      set quantity = quantity + allocated_quantity
      where batch_id = movement_row.batch_id and location_id = movement_row.location_id;
      if not found then
        raise exception using errcode = '55000', message = 'warehouse original location unavailable',
          hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
      end if;
      insert into public.warehouse_inventory_movements(
        movement_type, variant_id, batch_id, warehouse_id, location_id,
        quantity_delta, unit_cost, source_document_type, source_document_id,
        idempotency_key, project_id, destination_type, destination_id,
        destination_name, operator_employee_profile_id, occurred_at, metadata
      ) values (
        '项目退回', movement_row.variant_id, movement_row.batch_id,
        movement_row.warehouse_id, movement_row.location_id,
        allocated_quantity, movement_row.unit_cost,
        'warehouse_return', p_return_id::text,
        'return-confirm:' || p_return_id::text || ':' || line_row.id::text || ':' || movement_row.id::text,
        movement_row.project_id, movement_row.destination_type,
        movement_row.destination_id, movement_row.destination_name,
        actor_id, confirmed_at_value,
        jsonb_build_object(
          'returnLineId', line_row.id,
          'stockOutLineId', line_row.original_stock_out_line_id,
          'originalMovementId', movement_row.id
        )
      );
      total_cost := total_cost + allocated_quantity * movement_row.unit_cost;
      remaining_quantity := remaining_quantity - allocated_quantity;
    end loop;
    if remaining_quantity > 0 then
      raise exception using errcode = '23514', message = 'warehouse return quantity exceeded',
        hint = 'WAREHOUSE_RETURN_QUANTITY_EXCEEDED';
    end if;
    update public.warehouse_return_lines
    set confirmed_quantity = v_requested_quantity,
        frozen_total_cost = round(total_cost, 4)::numeric(18,4)
    where id = line_row.id and return_id = p_return_id
    returning frozen_total_cost into line_frozen_total;
    return_total := return_total + line_frozen_total;
  end loop;

  update public.warehouse_return_requests
  set status = 'confirmed', confirmed_by_employee_profile_id = actor_id,
      confirmed_at = confirmed_at_value,
      confirmation_idempotency_key = p_idempotency_key,
      confirmation_payload = canonical_payload
  where id = p_return_id;

  if original_row.destination_type = 'project' and return_total > 0 then
    cost_project_id := original_row.project_id;
    select coalesce(jsonb_agg(key order by key), '[]'::jsonb) into purchase_keys
    from (
      select distinct receipt.purchase_record_key as key
      from public.warehouse_inventory_movements movement
      join public.warehouse_batches batch on batch.id = movement.batch_id
      join public.warehouse_receipt_lines receipt_line on receipt_line.id = batch.receipt_line_id
      join public.warehouse_receipts receipt on receipt.id = receipt_line.receipt_id
      where movement.source_document_type = 'warehouse_return'
        and movement.source_document_id = p_return_id::text
    ) provenance;
    perform private.insert_warehouse_return_project_cost(
      p_return_id, cost_project_id, -round(return_total, 4), actor_id,
      confirmed_at_value, return_row.original_stock_out_id, purchase_keys
    );
  elsif original_row.destination_type = 'minor_work_order' then
    perform private.post_minor_work_order_cost(
      original_row.minor_work_order_id, actor_id, confirmed_at_value, true
    );
  end if;
  return private.warehouse_return_confirmation_json(p_return_id, view_cost);
exception when unique_violation then
  if exists (
    select 1 from public.warehouse_return_requests request
    where request.confirmation_idempotency_key = p_idempotency_key
      and request.id <> p_return_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  raise;
end;
$$;

create or replace function public.reject_warehouse_stock_out_secure(
  p_request_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  request_row public.warehouse_stock_out_requests%rowtype;
  normalized_reason text;
  canonical_payload jsonb;
  rejected_at_value timestamptz;
  view_cost boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.confirm');
  view_cost := public.has_current_permission('warehouse.cost.view');
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  normalized_reason := private.warehouse_workflow_text(
    jsonb_build_object('reason', p_reason), 'reason', 1000, true
  );
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  canonical_payload := jsonb_build_object(
    'requestId', p_request_id, 'outcome', 'rejected', 'reason', normalized_reason
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-stock-out-confirm-document:' || p_request_id::text, 0
  ));
  select request.* into request_row
  from public.warehouse_stock_out_requests request
  where request.id = p_request_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse stock-out unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-stock-out-confirm-key:' || p_idempotency_key, 0
  ));
  if request_row.status = 'rejected'
    and request_row.confirmation_idempotency_key = p_idempotency_key
    and request_row.confirmation_payload = canonical_payload
  then
    return private.warehouse_stock_out_json(p_request_id, view_cost)
      || jsonb_build_object('confirmationIdempotencyKey', p_idempotency_key);
  elsif request_row.status <> 'pending' then
    if request_row.confirmation_idempotency_key = p_idempotency_key then
      raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
        hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
    end if;
    raise exception using errcode = '55000', message = 'warehouse document already confirmed',
      hint = 'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED';
  end if;
  if exists (
    select 1 from public.warehouse_stock_out_requests other
    where other.confirmation_idempotency_key = p_idempotency_key
      and other.id <> p_request_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  rejected_at_value := clock_timestamp();
  update public.warehouse_stock_out_requests
  set status = 'rejected', confirmed_by_employee_profile_id = actor_id,
      confirmed_at = rejected_at_value, rejection_reason = normalized_reason,
      confirmation_idempotency_key = p_idempotency_key,
      confirmation_payload = canonical_payload
  where id = p_request_id;
  return private.warehouse_stock_out_json(p_request_id, view_cost)
    || jsonb_build_object('confirmationIdempotencyKey', p_idempotency_key);
end;
$$;

create or replace function public.reject_warehouse_return_secure(
  p_return_id uuid,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  return_row public.warehouse_return_requests%rowtype;
  normalized_reason text;
  canonical_payload jsonb;
  rejected_at_value timestamptz;
  view_cost boolean;
begin
  select employee_profile_id into actor_id
  from private.assert_warehouse_permission('warehouse.stock_flow.confirm');
  view_cost := public.has_current_permission('warehouse.cost.view');
  if p_return_id is null then
    raise exception using errcode = '22023', message = 'warehouse confirmation input invalid',
      hint = 'WAREHOUSE_CONFIRMATION_INPUT_INVALID';
  end if;
  normalized_reason := private.warehouse_workflow_text(
    jsonb_build_object('reason', p_reason), 'reason', 1000, true
  );
  perform private.warehouse_workflow_idempotency(p_idempotency_key);
  canonical_payload := jsonb_build_object(
    'returnId', p_return_id, 'outcome', 'rejected', 'reason', normalized_reason
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-return-confirm-document:' || p_return_id::text, 0
  ));
  select request.* into return_row
  from public.warehouse_return_requests request
  where request.id = p_return_id
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'warehouse return unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-return-confirm-key:' || p_idempotency_key, 0
  ));
  if return_row.status = 'rejected'
    and return_row.confirmation_idempotency_key = p_idempotency_key
    and return_row.confirmation_payload = canonical_payload
  then
    return private.warehouse_return_json(p_return_id, view_cost)
      || jsonb_build_object('confirmationIdempotencyKey', p_idempotency_key);
  elsif return_row.status <> 'pending' then
    if return_row.confirmation_idempotency_key = p_idempotency_key then
      raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
        hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
    end if;
    raise exception using errcode = '55000', message = 'warehouse document already confirmed',
      hint = 'WAREHOUSE_DOCUMENT_ALREADY_CONFIRMED';
  end if;
  if exists (
    select 1 from public.warehouse_return_requests other
    where other.confirmation_idempotency_key = p_idempotency_key
      and other.id <> p_return_id
  ) then
    raise exception using errcode = '23505', message = 'warehouse confirmation idempotency conflict',
      hint = 'WAREHOUSE_CONFIRMATION_IDEMPOTENCY_CONFLICT';
  end if;
  rejected_at_value := clock_timestamp();
  update public.warehouse_return_requests
  set status = 'rejected', confirmed_by_employee_profile_id = actor_id,
      confirmed_at = rejected_at_value, rejection_reason = normalized_reason,
      confirmation_idempotency_key = p_idempotency_key,
      confirmation_payload = canonical_payload
  where id = p_return_id;
  return private.warehouse_return_json(p_return_id, view_cost)
    || jsonb_build_object('confirmationIdempotencyKey', p_idempotency_key);
end;
$$;

create or replace function public.list_warehouse_request_context_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_id uuid;
  can_request boolean;
  can_confirm boolean;
  view_cost boolean;
begin
  can_confirm := public.has_current_permission('warehouse.stock_flow.confirm');
  can_request := public.has_current_permission('warehouse.stock_flow.request');
  if can_confirm then
    select employee_profile_id into actor_id
    from private.assert_warehouse_permission('warehouse.stock_flow.confirm');
  elsif can_request then
    select employee_profile_id into actor_id
    from private.assert_warehouse_permission('warehouse.stock_flow.request');
  else
    perform private.assert_warehouse_permission('warehouse.stock_flow.request');
  end if;
  view_cost := public.has_current_permission('warehouse.cost.view');
  return jsonb_build_object(
    'stockOutRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'destinationType', request.destination_type,
        'projectId', request.project_id,
        'minorWorkOrderId', request.minor_work_order_id,
        'destinationNameSnapshot', request.destination_name_snapshot,
        'purpose', request.purpose,
        'receiver', request.receiver,
        'requestDate', request.request_date,
        'status', request.status,
        'submittedByEmployeeProfileId', request.submitted_by_employee_profile_id,
        'submittedAt', request.submitted_at,
        'confirmedByEmployeeProfileId', request.confirmed_by_employee_profile_id,
        'confirmedAt', request.confirmed_at,
        'rejectionReason', request.rejection_reason,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', line.id,
            'requestId', line.request_id,
            'variantId', line.variant_id,
            'requestedQuantity', line.requested_quantity,
            'confirmedQuantity', line.confirmed_quantity,
            'remainingReturnable', case when request.status = 'confirmed' then greatest(
              0, line.confirmed_quantity - coalesce((
                select sum(return_line.confirmed_quantity)
                from public.warehouse_return_lines return_line
                join public.warehouse_return_requests return_request
                  on return_request.id = return_line.return_id
                where return_line.original_stock_out_line_id = line.id
                  and return_request.status in ('confirmed', 'void')
              ), 0)
            ) else 0 end,
            'frozenTotalCost', case when view_cost then line.frozen_total_cost else null end
          ) order by line.id)
          from public.warehouse_stock_out_lines line where line.request_id = request.id
        ), '[]'::jsonb)
      ) order by (request.status = 'pending') desc, request.submitted_at desc, request.id)
      from (
        select candidate.*
        from public.warehouse_stock_out_requests candidate
        where can_confirm or candidate.submitted_by_employee_profile_id = actor_id
        order by (candidate.status = 'pending') desc,
          candidate.submitted_at desc, candidate.id
        limit 1000
      ) request
    ), '[]'::jsonb),
    'returnRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', request.id,
        'originalStockOutId', request.original_stock_out_id,
        'destinationType', original.destination_type,
        'projectId', original.project_id,
        'minorWorkOrderId', original.minor_work_order_id,
        'destinationNameSnapshot', original.destination_name_snapshot,
        'reason', request.reason,
        'receiver', request.receiver,
        'requestDate', request.request_date,
        'status', request.status,
        'submittedByEmployeeProfileId', request.submitted_by_employee_profile_id,
        'submittedAt', request.submitted_at,
        'confirmedByEmployeeProfileId', request.confirmed_by_employee_profile_id,
        'confirmedAt', request.confirmed_at,
        'rejectionReason', request.rejection_reason,
        'lines', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', line.id,
            'returnId', line.return_id,
            'originalStockOutLineId', line.original_stock_out_line_id,
            'variantId', original_line.variant_id,
            'requestedQuantity', line.requested_quantity,
            'confirmedQuantity', line.confirmed_quantity,
            'frozenTotalCost', case when view_cost then line.frozen_total_cost else null end
          ) order by line.id)
          from public.warehouse_return_lines line
          join public.warehouse_stock_out_lines original_line
            on original_line.id = line.original_stock_out_line_id
          where line.return_id = request.id
        ), '[]'::jsonb)
      ) order by (request.status = 'pending') desc, request.submitted_at desc, request.id)
      from (
        select candidate.*
        from public.warehouse_return_requests candidate
        where can_confirm or candidate.submitted_by_employee_profile_id = actor_id
        order by (candidate.status = 'pending') desc,
          candidate.submitted_at desc, candidate.id
        limit 1000
      ) request
      join public.warehouse_stock_out_requests original
        on original.id = request.original_stock_out_id
    ), '[]'::jsonb),
    'minorWorkOrders', coalesce((
      select jsonb_agg(private.warehouse_minor_work_order_json(job.id)
        order by job.work_date desc, job.id)
      from (
        select candidate.id, candidate.work_date
        from public.warehouse_minor_work_orders candidate
        where can_request and candidate.status in ('open', 'assigned')
        order by candidate.work_date desc, candidate.id
        limit 1000
      ) job
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.warehouse_workflow_text(jsonb,text,integer,boolean) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_uuid(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_quantity(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_date(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_idempotency(text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_workflow_lines(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.guard_warehouse_project_cost_write() from public, anon, authenticated, service_role;
revoke all on function private.enforce_project_cost_write_permission() from public, anon, authenticated, service_role;
revoke all on function private.upsert_warehouse_project_cost(text,text,numeric,uuid,timestamptz,date,uuid,text,jsonb,jsonb,boolean) from public, anon, authenticated, service_role;
revoke all on function private.post_minor_work_order_cost(uuid,uuid,timestamptz,boolean) from public, anon, authenticated, service_role;
revoke all on function private.insert_warehouse_return_project_cost(uuid,text,numeric,uuid,timestamptz,uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.reject_warehouse_workflow_delete() from public, anon, authenticated, service_role;
revoke all on function private.guard_purchase_warehouse_receipt_delete() from public, anon, authenticated, service_role;
revoke all on function private.guard_warehouse_receipt_identity_update() from public, anon, authenticated, service_role;
revoke all on function private.guard_warehouse_confirmation_identity_update() from public, anon, authenticated, service_role;
revoke all on function private.assert_warehouse_receipt_document_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.assert_warehouse_stock_out_document_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.assert_warehouse_return_document_state(uuid) from public, anon, authenticated, service_role;
revoke all on function private.check_warehouse_receipt_document_state() from public, anon, authenticated, service_role;
revoke all on function private.check_warehouse_stock_out_document_state() from public, anon, authenticated, service_role;
revoke all on function private.check_warehouse_return_document_state() from public, anon, authenticated, service_role;
revoke all on function private.reject_warehouse_destination_mutation() from public, anon, authenticated, service_role;
revoke all on function private.warehouse_minor_work_order_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_receipt_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_receipt_submission_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_stock_out_json(uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_return_json(uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_confirmation_quantity(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_purchase_unit_cost(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_receipt_confirmation_json(uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_stock_out_confirmation_json(uuid,boolean) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_return_confirmation_json(uuid,boolean) from public, anon, authenticated, service_role;

revoke all on function public.create_minor_work_order_secure(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.assign_minor_work_order_to_project_secure(uuid,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_warehouse_receipt_secure(text,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_warehouse_stock_out_secure(jsonb,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.submit_warehouse_return_secure(uuid,jsonb,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.list_purchase_warehouse_arrivals_secure() from public, anon, authenticated, service_role;
revoke all on function public.confirm_warehouse_receipt_secure(uuid,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.confirm_warehouse_stock_out_secure(uuid,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.confirm_warehouse_return_secure(uuid,jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.reject_warehouse_stock_out_secure(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.reject_warehouse_return_secure(uuid,text,text) from public, anon, authenticated, service_role;
revoke all on function public.list_warehouse_request_context_secure() from public, anon, authenticated, service_role;
revoke all on function public.list_warehouse_material_cost_context_secure() from public, anon, authenticated, service_role;
grant execute on function public.create_minor_work_order_secure(jsonb) to authenticated;
grant execute on function public.assign_minor_work_order_to_project_secure(uuid,text) to authenticated;
grant execute on function public.submit_warehouse_receipt_secure(text,jsonb,text) to authenticated;
grant execute on function public.submit_warehouse_stock_out_secure(jsonb,jsonb,text) to authenticated;
grant execute on function public.submit_warehouse_return_secure(uuid,jsonb,jsonb,text) to authenticated;
grant execute on function public.list_purchase_warehouse_arrivals_secure() to authenticated;
grant execute on function public.confirm_warehouse_receipt_secure(uuid,jsonb,text) to authenticated;
grant execute on function public.confirm_warehouse_stock_out_secure(uuid,jsonb,text) to authenticated;
grant execute on function public.confirm_warehouse_return_secure(uuid,jsonb,text) to authenticated;
grant execute on function public.reject_warehouse_stock_out_secure(uuid,text,text) to authenticated;
grant execute on function public.reject_warehouse_return_secure(uuid,text,text) to authenticated;
grant execute on function public.list_warehouse_request_context_secure() to authenticated;
grant execute on function public.list_warehouse_material_cost_context_secure() to authenticated;

commit;

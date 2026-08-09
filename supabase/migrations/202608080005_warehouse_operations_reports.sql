-- Atomic warehouse transfer, monthly stocktake, and whole-operation reversal.
-- All actor, time, inventory, and cost facts are derived inside SECURITY DEFINER RPCs.

begin;

create table public.warehouse_transfers (
  id uuid primary key,
  variant_id uuid not null references public.warehouse_variants(id) on delete restrict,
  source_warehouse_id uuid not null references public.warehouse_sites(id) on delete restrict,
  source_location_id uuid not null,
  destination_warehouse_id uuid not null references public.warehouse_sites(id) on delete restrict,
  destination_location_id uuid not null,
  requested_quantity numeric(18,3) not null,
  reason text not null,
  status text not null,
  submission_payload jsonb not null,
  submitted_by_employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  submitted_at timestamptz not null,
  confirmation_idempotency_key text unique,
  confirmed_by_employee_profile_id uuid references public.employee_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  total_cost numeric(18,4),
  rejection_reason text,
  reversal_id uuid,
  reversal_reason text,
  reversed_by_employee_profile_id uuid references public.employee_profiles(id) on delete restrict,
  reversed_at timestamptz,
  constraint warehouse_transfers_source_location_fk foreign key(source_location_id, source_warehouse_id)
    references public.warehouse_locations(id, warehouse_id) on delete restrict,
  constraint warehouse_transfers_destination_location_fk foreign key(destination_location_id, destination_warehouse_id)
    references public.warehouse_locations(id, warehouse_id) on delete restrict,
  constraint warehouse_transfers_status_check check(status in ('pending','confirmed','rejected','void')),
  constraint warehouse_transfers_quantity_check check(requested_quantity > 0 and requested_quantity <= 9007199254740.991 and requested_quantity = round(requested_quantity,3) and requested_quantity not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  constraint warehouse_transfers_total_check check(total_cost is null or (total_cost >= 0 and total_cost <= 900719925474.0991 and total_cost = round(total_cost,4) and total_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))),
  constraint warehouse_transfers_location_check check(source_location_id <> destination_location_id),
  constraint warehouse_transfers_reason_check check(reason = btrim(reason) and char_length(reason) between 1 and 1000),
  constraint warehouse_transfers_payload_check check(jsonb_typeof(submission_payload) = 'object'),
  constraint warehouse_transfers_outcome_check check(
    (status = 'pending' and confirmation_idempotency_key is null and confirmed_by_employee_profile_id is null and confirmed_at is null and total_cost is null and rejection_reason is null and reversal_id is null and reversal_reason is null and reversed_by_employee_profile_id is null and reversed_at is null)
    or (status = 'rejected' and confirmation_idempotency_key is null and confirmed_by_employee_profile_id is null and confirmed_at is null and total_cost is null and rejection_reason is not null and reversal_id is null and reversal_reason is null and reversed_by_employee_profile_id is null and reversed_at is null)
    or (status = 'confirmed' and confirmation_idempotency_key is not null and confirmed_by_employee_profile_id is not null and confirmed_at is not null and total_cost is not null and rejection_reason is null and reversal_id is null and reversal_reason is null and reversed_by_employee_profile_id is null and reversed_at is null)
    or (status = 'void' and confirmation_idempotency_key is not null and confirmed_by_employee_profile_id is not null and confirmed_at is not null and total_cost is not null and rejection_reason is null and reversal_id is not null and reversal_reason is not null and reversed_by_employee_profile_id is not null and reversed_at is not null)
  ),
  unique(id, variant_id)
);

create table public.warehouse_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.warehouse_transfers(id) on delete restrict,
  variant_id uuid not null,
  batch_id uuid not null,
  source_location_id uuid not null references public.warehouse_locations(id) on delete restrict,
  destination_location_id uuid not null references public.warehouse_locations(id) on delete restrict,
  quantity numeric(18,3) not null,
  unit_cost numeric(18,4) not null,
  total_cost numeric(18,4) not null,
  outbound_movement_id uuid not null unique references public.warehouse_inventory_movements(id) on delete restrict,
  inbound_movement_id uuid not null unique references public.warehouse_inventory_movements(id) on delete restrict,
  constraint warehouse_transfer_lines_parent_fk foreign key(transfer_id, variant_id)
    references public.warehouse_transfers(id, variant_id) on delete restrict,
  constraint warehouse_transfer_lines_batch_fk foreign key(batch_id, variant_id)
    references public.warehouse_batches(id, variant_id) on delete restrict,
  constraint warehouse_transfer_lines_quantity_check check(quantity > 0 and quantity <= 9007199254740.991 and quantity = round(quantity,3) and quantity not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  constraint warehouse_transfer_lines_cost_check check(unit_cost >= 0 and unit_cost <= 900719925474.0991 and unit_cost = round(unit_cost,4) and unit_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and total_cost = round(quantity * unit_cost,4) and total_cost <= 900719925474.0991 and total_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  unique(transfer_id,batch_id)
);

create table public.warehouse_stocktakes (
  id uuid primary key,
  warehouse_id uuid not null references public.warehouse_sites(id) on delete restrict,
  stocktake_month text not null,
  status text not null,
  submission_payload jsonb not null,
  submitted_by_employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  submitted_at timestamptz not null,
  confirmation_idempotency_key text unique,
  confirmed_by_employee_profile_id uuid references public.employee_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  rejection_reason text,
  reversal_id uuid,
  reversal_reason text,
  reversed_by_employee_profile_id uuid references public.employee_profiles(id) on delete restrict,
  reversed_at timestamptz,
  constraint warehouse_stocktakes_month_check check(stocktake_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint warehouse_stocktakes_status_check check(status in ('pending','confirmed','rejected','void')),
  constraint warehouse_stocktakes_payload_check check(jsonb_typeof(submission_payload) = 'object'),
  constraint warehouse_stocktakes_outcome_check check(
    (status = 'pending' and confirmation_idempotency_key is null and confirmed_by_employee_profile_id is null and confirmed_at is null and rejection_reason is null and reversal_id is null and reversal_reason is null and reversed_by_employee_profile_id is null and reversed_at is null)
    or (status = 'rejected' and confirmation_idempotency_key is null and confirmed_by_employee_profile_id is null and confirmed_at is null and rejection_reason is not null and reversal_id is null and reversal_reason is null and reversed_by_employee_profile_id is null and reversed_at is null)
    or (status = 'confirmed' and confirmation_idempotency_key is not null and confirmed_by_employee_profile_id is not null and confirmed_at is not null and rejection_reason is null and reversal_id is null and reversal_reason is null and reversed_by_employee_profile_id is null and reversed_at is null)
    or (status = 'void' and confirmation_idempotency_key is not null and confirmed_by_employee_profile_id is not null and confirmed_at is not null and rejection_reason is null and reversal_id is not null and reversal_reason is not null and reversed_by_employee_profile_id is not null and reversed_at is not null)
  ),
  unique(id, warehouse_id)
);
create unique index warehouse_stocktakes_active_month_unique
  on public.warehouse_stocktakes(warehouse_id, stocktake_month) where status = 'confirmed';

create table public.warehouse_stocktake_lines (
  id uuid primary key,
  stocktake_id uuid not null,
  warehouse_id uuid not null,
  variant_id uuid not null references public.warehouse_variants(id) on delete restrict,
  location_id uuid not null,
  book_quantity numeric(18,3) not null,
  counted_quantity numeric(18,3) not null,
  quantity_delta numeric(18,3) not null,
  difference_type text not null,
  reason text not null,
  approved_unit_cost numeric(18,4),
  frozen_unit_cost numeric(18,4) not null,
  frozen_total_cost numeric(18,4) not null,
  movement_ids uuid[] not null,
  constraint warehouse_stocktake_lines_parent_fk foreign key(stocktake_id, warehouse_id)
    references public.warehouse_stocktakes(id, warehouse_id) on delete restrict,
  constraint warehouse_stocktake_lines_location_fk foreign key(location_id, warehouse_id)
    references public.warehouse_locations(id, warehouse_id) on delete restrict,
  constraint warehouse_stocktake_lines_quantity_check check(book_quantity >= 0 and counted_quantity >= 0 and book_quantity <= 9007199254740.991 and counted_quantity <= 9007199254740.991 and quantity_delta = counted_quantity - book_quantity and book_quantity not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and counted_quantity not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)),
  constraint warehouse_stocktake_lines_type_check check(difference_type in ('gain','loss','damaged','scrapped','no_change')),
  constraint warehouse_stocktake_lines_cost_check check((approved_unit_cost is null or (approved_unit_cost >= 0 and approved_unit_cost <= 900719925474.0991 and approved_unit_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric))) and frozen_unit_cost >= 0 and frozen_unit_cost <= 900719925474.0991 and frozen_unit_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and frozen_total_cost >= 0 and frozen_total_cost <= 900719925474.0991 and frozen_total_cost not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and cardinality(movement_ids) between 1 and 20000),
  constraint warehouse_stocktake_lines_difference_check check(
    (quantity_delta > 0 and difference_type = 'gain' and reason <> '' and ((book_quantity = 0 and approved_unit_cost is not null and approved_unit_cost = frozen_unit_cost) or (book_quantity > 0 and approved_unit_cost is null)))
    or (quantity_delta = 0 and difference_type = 'no_change' and reason = '')
    or (quantity_delta < 0 and difference_type in ('loss','damaged','scrapped') and reason <> '' and approved_unit_cost is null)
  ),
  unique(stocktake_id, variant_id, location_id)
);

create table public.warehouse_operation_reversals (
  id uuid primary key default gen_random_uuid(),
  source_document_type text not null,
  source_document_id uuid not null,
  reason text not null,
  status text not null default 'confirmed',
  submission_payload jsonb not null,
  idempotency_key text not null unique,
  reversed_by_employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  reversed_at timestamptz not null,
  movement_ids uuid[] not null,
  cost_adjustment numeric(18,4) not null default 0,
  constraint warehouse_operation_reversals_source_check check(source_document_type in ('warehouse_receipt','warehouse_stock_out','warehouse_return','warehouse_transfer','warehouse_stocktake')),
  constraint warehouse_operation_reversals_status_check check(status = 'confirmed'),
  constraint warehouse_operation_reversals_reason_check check(reason = btrim(reason) and char_length(reason) between 1 and 1000),
  constraint warehouse_operation_reversals_payload_check check(jsonb_typeof(submission_payload) = 'object'),
  constraint warehouse_operation_reversals_movements_check check(cardinality(movement_ids) between 1 and 20000),
  unique(source_document_type, source_document_id)
);

alter table public.warehouse_transfers add constraint warehouse_transfers_reversal_fk
  foreign key(reversal_id) references public.warehouse_operation_reversals(id) on delete restrict;
alter table public.warehouse_stocktakes add constraint warehouse_stocktakes_reversal_fk
  foreign key(reversal_id) references public.warehouse_operation_reversals(id) on delete restrict;

alter table public.warehouse_transfers enable row level security;
alter table public.warehouse_transfer_lines enable row level security;
alter table public.warehouse_stocktakes enable row level security;
alter table public.warehouse_stocktake_lines enable row level security;
alter table public.warehouse_operation_reversals enable row level security;
revoke all on public.warehouse_transfers, public.warehouse_transfer_lines, public.warehouse_stocktakes, public.warehouse_stocktake_lines, public.warehouse_operation_reversals from public, anon, authenticated, service_role;

create or replace function private.warehouse_operation_reject_mutation()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  raise exception using errcode='55000', message='warehouse operation snapshot immutable', hint='WAREHOUSE_OPERATION_IMMUTABLE';
end;
$$;

create or replace function private.warehouse_stocktake_json(p_id uuid,p_view_cost boolean)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',header.id,'warehouseId',header.warehouse_id,'stocktakeMonth',header.stocktake_month,
    'status',header.status,'confirmedByEmployeeProfileId',header.confirmed_by_employee_profile_id,
    'confirmedAt',header.confirmed_at,'idempotencyKey',header.confirmation_idempotency_key,
    'reversalId',header.reversal_id,'reversalReason',header.reversal_reason,
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'id',line.id,'variantId',line.variant_id,'locationId',line.location_id,
      'bookQuantity',line.book_quantity,'countedQuantity',line.counted_quantity,
      'quantityDelta',line.quantity_delta,'differenceType',line.difference_type,'reason',line.reason,
      'totalCost',case when p_view_cost then line.frozen_total_cost else null end,
      'movementIds',to_jsonb(line.movement_ids)
    ) order by line.id) from public.warehouse_stocktake_lines line where line.stocktake_id=header.id),'[]'::jsonb)
  ) from public.warehouse_stocktakes header where header.id=p_id
$$;
revoke all on function private.warehouse_stocktake_json(uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.confirm_warehouse_stocktake_secure(
  p_stocktake_id uuid,p_warehouse_id uuid,p_stocktake_month text,p_lines jsonb,p_idempotency_key text
)
returns jsonb language plpgsql volatile security definer set search_path=pg_catalog,public,private as $$
declare
  actor record; occurred timestamptz; payload jsonb; existing public.warehouse_stocktakes%rowtype;
  entry jsonb; line_id uuid; variant_id_value uuid; location_id_value uuid; counted numeric; approved numeric;
  difference text; line_reason text; book numeric; delta numeric; warehouse_quantity numeric; warehouse_value numeric;
  unit_cost_value numeric; total_value numeric; remaining numeric; take_quantity numeric; movement_type_value text;
  batch_row record; batch_id_value uuid; movement_id_value uuid; movement_ids_value uuid[]; row_count integer;
begin
  select * into actor from private.assert_warehouse_permission('warehouse.stocktake.confirm');
  p_idempotency_key:=private.warehouse_operation_key(p_idempotency_key);
  if p_stocktake_id is null or p_warehouse_id is null or p_stocktake_month is null
    or p_stocktake_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or jsonb_typeof(p_lines)<>'array'
    or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100
  then raise exception using errcode='22023',message='warehouse stocktake input invalid',hint='WAREHOUSE_OPERATION_INPUT_INVALID'; end if;
  select count(*) into row_count from (select value->>'stocktakeLineId' from jsonb_array_elements(p_lines) group by 1) grouped;
  if row_count<>jsonb_array_length(p_lines) then raise exception using errcode='22023',message='warehouse stocktake duplicate line',hint='WAREHOUSE_OPERATION_INPUT_INVALID'; end if;
  payload:=jsonb_build_object('stocktakeId',p_stocktake_id,'warehouseId',p_warehouse_id,'stocktakeMonth',p_stocktake_month,'lines',p_lines,'idempotencyKey',p_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended('warehouse-operation:warehouse_stocktake:'||p_stocktake_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('warehouse-operation-key:'||p_idempotency_key,0));
  select * into existing from public.warehouse_stocktakes where id=p_stocktake_id or confirmation_idempotency_key=p_idempotency_key
    order by (id=p_stocktake_id) desc limit 1 for update;
  if found then
    if existing.submitted_by_employee_profile_id<>actor.employee_profile_id then raise exception using errcode='23505',message='warehouse operation actor conflict',hint='WAREHOUSE_OPERATION_ACTOR_CONFLICT'; end if;
    if existing.id<>p_stocktake_id or existing.confirmation_idempotency_key<>p_idempotency_key or existing.submission_payload<>payload
      then raise exception using errcode='23505',message='warehouse operation idempotency conflict',hint='WAREHOUSE_OPERATION_IDEMPOTENCY_CONFLICT'; end if;
    return private.warehouse_stocktake_json(existing.id,public.has_current_permission('warehouse.cost.view'));
  end if;
  perform pg_advisory_xact_lock(hashtextextended('warehouse-stocktake-month:'||p_warehouse_id::text||':'||p_stocktake_month,0));
  if exists(select 1 from public.warehouse_stocktakes where warehouse_id=p_warehouse_id and stocktake_month=p_stocktake_month and status='confirmed')
    then raise exception using errcode='23505',message='warehouse stocktake month conflict',hint='WAREHOUSE_STOCKTAKE_MONTH_CONFLICT'; end if;
  if not exists(select 1 from public.warehouse_sites where id=p_warehouse_id and active)
    then raise exception using errcode='55000',message='warehouse stocktake resource inactive',hint='WAREHOUSE_RESOURCE_INACTIVE'; end if;
  for location_id_value in select distinct (value->>'locationId')::uuid from jsonb_array_elements(p_lines) order by 1
    loop perform private.lock_warehouse_location_resource(location_id_value); end loop;
  for variant_id_value in select distinct (value->>'variantId')::uuid from jsonb_array_elements(p_lines) order by 1
    loop perform private.lock_warehouse_variant_resource(variant_id_value); end loop;
  perform 1
  from public.warehouse_batch_locations balance
  join public.warehouse_batches batch on batch.id=balance.batch_id
  where exists(
    select 1 from jsonb_array_elements(p_lines) supplied
    where (supplied.value->>'variantId')::uuid=batch.variant_id
      and (supplied.value->>'locationId')::uuid=balance.location_id
  )
  order by balance.batch_id,balance.location_id
  for update of balance;
  occurred:=clock_timestamp();
  insert into public.warehouse_stocktakes(id,warehouse_id,stocktake_month,status,submission_payload,submitted_by_employee_profile_id,submitted_at,
    confirmation_idempotency_key,confirmed_by_employee_profile_id,confirmed_at)
    values(p_stocktake_id,p_warehouse_id,p_stocktake_month,'confirmed',payload,actor.employee_profile_id,occurred,p_idempotency_key,actor.employee_profile_id,occurred);
  for entry in select value from jsonb_array_elements(p_lines) order by value->>'stocktakeLineId' loop
    if jsonb_typeof(entry)<>'object' or (select count(*) from jsonb_object_keys(entry))<>7
      or not (entry ?& array['stocktakeLineId','variantId','locationId','countedQuantity','differenceType','reason','approvedUnitCost'])
    then raise exception using errcode='22023',message='warehouse stocktake line invalid',hint='WAREHOUSE_OPERATION_INPUT_INVALID'; end if;
    line_id:=(entry->>'stocktakeLineId')::uuid; variant_id_value:=(entry->>'variantId')::uuid; location_id_value:=(entry->>'locationId')::uuid;
    counted:=(entry->>'countedQuantity')::numeric; difference:=entry->>'differenceType'; line_reason:=entry->>'reason';
    approved:=case when entry->'approvedUnitCost'='null'::jsonb then null else (entry->>'approvedUnitCost')::numeric end;
    if counted<0 or counted>9007199254740.991 or counted<>round(counted,3) or counted in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or difference not in('gain','loss','damaged','scrapped','no_change') or line_reason is null or line_reason<>btrim(line_reason) or char_length(line_reason)>1000
      or (approved is not null and (approved<0 or approved>900719925474.0991 or approved<>round(approved,4) or approved in('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)))
    then raise exception using errcode='22023',message='warehouse stocktake line invalid',hint='WAREHOUSE_OPERATION_INPUT_INVALID'; end if;
    if not exists(select 1 from public.warehouse_locations where id=location_id_value and warehouse_id=p_warehouse_id and active)
      or not exists(select 1 from public.warehouse_variants variant join public.warehouse_items item on item.id=variant.item_id where variant.id=variant_id_value and variant.active and item.active)
    then raise exception using errcode='55000',message='warehouse stocktake resource inactive',hint='WAREHOUSE_RESOURCE_INACTIVE'; end if;
    perform 1 from public.warehouse_batch_locations balance join public.warehouse_batches batch on batch.id=balance.batch_id
      where batch.variant_id=variant_id_value and balance.location_id=location_id_value order by balance.batch_id,balance.location_id for update of balance;
    select coalesce(sum(balance.quantity),0),coalesce(sum(balance.quantity*batch.unit_cost),0)
      into book,total_value from public.warehouse_batch_locations balance join public.warehouse_batches batch on batch.id=balance.batch_id
      where batch.variant_id=variant_id_value and balance.location_id=location_id_value;
    select coalesce(sum(balance.quantity),0),coalesce(sum(balance.quantity*batch.unit_cost),0)
      into warehouse_quantity,warehouse_value from public.warehouse_batch_locations balance join public.warehouse_batches batch on batch.id=balance.batch_id
      join public.warehouse_locations location on location.id=balance.location_id
      where batch.variant_id=variant_id_value and location.warehouse_id=p_warehouse_id;
    delta:=counted-book;
    if (delta>0 and difference<>'gain') or (delta=0 and difference<>'no_change') or (delta<0 and difference not in('loss','damaged','scrapped'))
      or (delta<>0 and line_reason='') or (delta=0 and line_reason<>'')
    then raise exception using errcode='23514',message='warehouse stocktake difference mismatch',hint='WAREHOUSE_STOCKTAKE_DIFFERENCE_MISMATCH'; end if;
    if approved is not null and not(delta>0 and book=0) then raise exception using errcode='23514',message='warehouse stocktake approved cost invalid',hint='WAREHOUSE_STOCKTAKE_APPROVED_COST_INVALID'; end if;
    if delta>0 and book=0 then
      if approved is null then raise exception using errcode='22023',message='warehouse stocktake approved cost required',hint='WAREHOUSE_STOCKTAKE_APPROVED_COST_INVALID'; end if;
      if not public.has_current_permission('warehouse.cost.view') then raise exception using errcode='42501',message='warehouse stocktake cost permission required',hint='WAREHOUSE_STOCKTAKE_COST_PERMISSION_REQUIRED'; end if;
      unit_cost_value:=approved;
    elsif warehouse_quantity>0 then unit_cost_value:=round(warehouse_value/warehouse_quantity,4);
    else unit_cost_value:=0; end if;
    movement_ids_value:=array[]::uuid[]; total_value:=0;
    if delta>0 then
      batch_id_value:=private.warehouse_deterministic_uuid('stocktake-gain-batch:'||p_stocktake_id::text||':'||line_id::text);
      insert into public.warehouse_batches(id,variant_id,received_at,unit_cost,original_quantity)
        values(batch_id_value,variant_id_value,occurred,unit_cost_value,delta);
      insert into public.warehouse_batch_locations(batch_id,location_id,quantity) values(batch_id_value,location_id_value,delta);
      movement_id_value:=private.warehouse_deterministic_uuid('stocktake-movement:'||p_stocktake_id::text||':'||line_id::text||':'||batch_id_value::text);
      insert into public.warehouse_inventory_movements(id,movement_type,variant_id,batch_id,warehouse_id,location_id,quantity_delta,unit_cost,source_document_type,source_document_id,idempotency_key,operator_employee_profile_id,occurred_at,metadata)
        values(movement_id_value,'盘盈',variant_id_value,batch_id_value,p_warehouse_id,location_id_value,delta,unit_cost_value,'warehouse_stocktake',p_stocktake_id::text,'stocktake:'||p_stocktake_id::text||':'||line_id::text,actor.employee_profile_id,occurred,jsonb_build_object('differenceType',difference,'reason',line_reason));
      movement_ids_value:=array[movement_id_value]; total_value:=round(delta*unit_cost_value,4);
    elsif delta<0 then
      remaining:=-delta; movement_type_value:=case difference when 'loss' then '盘亏' when 'damaged' then '损坏' else '报废' end;
      for batch_row in select batch.id,batch.unit_cost,balance.quantity from public.warehouse_batches batch join public.warehouse_batch_locations balance on balance.batch_id=batch.id
        where batch.variant_id=variant_id_value and balance.location_id=location_id_value and balance.quantity>0 order by batch.received_at,batch.id loop
        exit when remaining=0; take_quantity:=least(remaining,batch_row.quantity);
        movement_id_value:=private.warehouse_deterministic_uuid('stocktake-movement:'||p_stocktake_id::text||':'||line_id::text||':'||batch_row.id::text);
        update public.warehouse_batch_locations set quantity=quantity-take_quantity,updated_at=occurred where batch_id=batch_row.id and location_id=location_id_value;
        insert into public.warehouse_inventory_movements(id,movement_type,variant_id,batch_id,warehouse_id,location_id,quantity_delta,unit_cost,source_document_type,source_document_id,idempotency_key,operator_employee_profile_id,occurred_at,metadata)
          values(movement_id_value,movement_type_value,variant_id_value,batch_row.id,p_warehouse_id,location_id_value,-take_quantity,batch_row.unit_cost,'warehouse_stocktake',p_stocktake_id::text,'stocktake:'||p_stocktake_id::text||':'||line_id::text||':'||batch_row.id::text,actor.employee_profile_id,occurred,jsonb_build_object('differenceType',difference,'reason',line_reason));
        movement_ids_value:=array_append(movement_ids_value,movement_id_value); total_value:=total_value+round(take_quantity*batch_row.unit_cost,4); remaining:=remaining-take_quantity;
      end loop;
      if remaining<>0 then raise exception using errcode='23514',message='warehouse stocktake stock insufficient',hint='WAREHOUSE_INSUFFICIENT_STOCK'; end if;
      unit_cost_value:=case when -delta=0 then 0 else round(total_value/(-delta),4) end;
    else
      movement_id_value:=private.warehouse_deterministic_uuid('stocktake-movement:'||p_stocktake_id::text||':'||line_id::text||':no-change');
      insert into public.warehouse_inventory_movements(id,movement_type,variant_id,batch_id,warehouse_id,location_id,quantity_delta,unit_cost,source_document_type,source_document_id,idempotency_key,operator_employee_profile_id,occurred_at,metadata)
        values(movement_id_value,'盘点无差异',variant_id_value,null,p_warehouse_id,location_id_value,0,unit_cost_value,'warehouse_stocktake',p_stocktake_id::text,'stocktake:'||p_stocktake_id::text||':'||line_id::text,actor.employee_profile_id,occurred,jsonb_build_object('differenceType',difference));
      movement_ids_value:=array[movement_id_value]; total_value:=0;
    end if;
    if cardinality(movement_ids_value)>20000 then
      raise exception using errcode='54000',message='warehouse operation too complex',hint='WAREHOUSE_OPERATION_TOO_COMPLEX';
    end if;
    insert into public.warehouse_stocktake_lines(id,stocktake_id,warehouse_id,variant_id,location_id,book_quantity,counted_quantity,quantity_delta,difference_type,reason,approved_unit_cost,frozen_unit_cost,frozen_total_cost,movement_ids)
      values(line_id,p_stocktake_id,p_warehouse_id,variant_id_value,location_id_value,book,counted,delta,difference,line_reason,approved,unit_cost_value,total_value,movement_ids_value);
  end loop;
  select count(*) into row_count
  from public.warehouse_inventory_movements
  where source_document_type='warehouse_stocktake'
    and source_document_id=p_stocktake_id::text;
  if row_count>20000 then
    raise exception using errcode='54000',message='warehouse operation too complex',hint='WAREHOUSE_OPERATION_TOO_COMPLEX';
  end if;
  return private.warehouse_stocktake_json(p_stocktake_id,public.has_current_permission('warehouse.cost.view'));
end;
$$;
revoke all on function public.confirm_warehouse_stocktake_secure(uuid,uuid,text,jsonb,text) from public,anon,service_role;
grant execute on function public.confirm_warehouse_stocktake_secure(uuid,uuid,text,jsonb,text) to authenticated;

create trigger warehouse_transfer_lines_immutable before update or delete on public.warehouse_transfer_lines for each row execute function private.warehouse_operation_reject_mutation();
create trigger warehouse_stocktake_lines_immutable before update or delete on public.warehouse_stocktake_lines for each row execute function private.warehouse_operation_reject_mutation();
create trigger warehouse_operation_reversals_immutable before update or delete on public.warehouse_operation_reversals for each row execute function private.warehouse_operation_reject_mutation();

create or replace function private.guard_warehouse_operation_parent_update()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if old.status = 'confirmed' and new.status = 'void'
    and (to_jsonb(new) - array['status','reversal_id','reversal_reason','reversed_by_employee_profile_id','reversed_at'])
      = (to_jsonb(old) - array['status','reversal_id','reversal_reason','reversed_by_employee_profile_id','reversed_at'])
    and new.reversal_id is not null and new.reversal_reason is not null
    and new.reversed_by_employee_profile_id is not null and new.reversed_at is not null
  then return new; end if;
  raise exception using errcode='55000', message='warehouse operation parent immutable', hint='WAREHOUSE_OPERATION_IMMUTABLE';
end;
$$;

create trigger warehouse_transfers_parent_immutable before update or delete on public.warehouse_transfers for each row execute function private.guard_warehouse_operation_parent_update();
create trigger warehouse_stocktakes_parent_immutable before update or delete on public.warehouse_stocktakes for each row execute function private.guard_warehouse_operation_parent_update();

-- Legacy confirmed workflow documents may only transition to void as one whole
-- document.  Every previously confirmed identity, quantity, cost, actor, and
-- timestamp remains immutable; the reversal reason is stored in the existing
-- audited rejection_reason field required by their void-state constraints.
create or replace function private.guard_confirmed_warehouse_operation_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  parent_status text;
begin
  if tg_table_name in (
    'warehouse_receipts',
    'warehouse_stock_out_requests',
    'warehouse_return_requests'
  ) then
    if old.status = 'confirmed'
      and new.status = 'void'
      and new.rejection_reason is not null
      and (to_jsonb(new) - array['status', 'rejection_reason'])
        = (to_jsonb(old) - array['status', 'rejection_reason'])
    then
      return new;
    end if;
    if old.status in ('confirmed', 'void') then
      raise exception using
        errcode = '55000',
        message = 'confirmed warehouse operation immutable',
        hint = 'WAREHOUSE_OPERATION_IMMUTABLE';
    end if;
    return new;
  end if;

  if tg_table_name = 'warehouse_receipt_lines' then
    select status into parent_status
    from public.warehouse_receipts
    where id = old.receipt_id;
  elsif tg_table_name = 'warehouse_stock_out_lines' then
    select status into parent_status
    from public.warehouse_stock_out_requests
    where id = old.request_id;
  else
    select status into parent_status
    from public.warehouse_return_requests
    where id = old.return_id;
  end if;

  if parent_status in ('confirmed', 'void') then
    raise exception using
      errcode = '55000',
      message = 'confirmed warehouse operation line immutable',
      hint = 'WAREHOUSE_OPERATION_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger guard_confirmed_warehouse_receipt
before update on public.warehouse_receipts
for each row execute function private.guard_confirmed_warehouse_operation_mutation();
create trigger guard_confirmed_warehouse_stock_out
before update on public.warehouse_stock_out_requests
for each row execute function private.guard_confirmed_warehouse_operation_mutation();
create trigger guard_confirmed_warehouse_return
before update on public.warehouse_return_requests
for each row execute function private.guard_confirmed_warehouse_operation_mutation();
create trigger guard_confirmed_warehouse_receipt_line
before update on public.warehouse_receipt_lines
for each row execute function private.guard_confirmed_warehouse_operation_mutation();
create trigger guard_confirmed_warehouse_stock_out_line
before update on public.warehouse_stock_out_lines
for each row execute function private.guard_confirmed_warehouse_operation_mutation();
create trigger guard_confirmed_warehouse_return_line
before update on public.warehouse_return_lines
for each row execute function private.guard_confirmed_warehouse_operation_mutation();

revoke all on function private.guard_confirmed_warehouse_operation_mutation()
from public, anon, authenticated, service_role;

create or replace function private.warehouse_operation_text(p_value text, p_max integer)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_value is null or p_value <> btrim(p_value) or p_value = '' or char_length(p_value) > p_max then
    raise exception using errcode='22023', message='warehouse operation input invalid', hint='WAREHOUSE_OPERATION_INPUT_INVALID';
  end if;
  return p_value;
end;
$$;

create or replace function private.warehouse_operation_key(p_value text)
returns text language plpgsql immutable set search_path=pg_catalog as $$
begin
  if p_value is null or p_value <> btrim(p_value) or p_value !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$' then
    raise exception using errcode='22023', message='warehouse operation idempotency invalid', hint='WAREHOUSE_OPERATION_INPUT_INVALID';
  end if;
  return p_value;
end;
$$;

create or replace function private.warehouse_deterministic_uuid(p_value text)
returns uuid language sql immutable strict set search_path=pg_catalog as $$
  select (substr(md5(p_value),1,8)||'-'||substr(md5(p_value),9,4)||'-4'||substr(md5(p_value),14,3)||'-8'||substr(md5(p_value),18,3)||'-'||substr(md5(p_value),21,12))::uuid
$$;

revoke all on function private.warehouse_operation_reject_mutation() from public, anon, authenticated, service_role;
revoke all on function private.guard_warehouse_operation_parent_update() from public, anon, authenticated, service_role;
revoke all on function private.warehouse_operation_text(text,integer) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_operation_key(text) from public, anon, authenticated, service_role;
revoke all on function private.warehouse_deterministic_uuid(text) from public, anon, authenticated, service_role;

create or replace function private.warehouse_transfer_json(p_id uuid, p_view_cost boolean)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id', header.id, 'status', header.status, 'variantId', header.variant_id,
    'sourceWarehouseId', header.source_warehouse_id, 'sourceLocationId', header.source_location_id,
    'destinationWarehouseId', header.destination_warehouse_id, 'destinationLocationId', header.destination_location_id,
    'quantity', header.requested_quantity,
    'totalCost', case when p_view_cost then header.total_cost else null end,
    'confirmedByEmployeeProfileId', header.confirmed_by_employee_profile_id,
    'confirmedAt', header.confirmed_at, 'idempotencyKey', header.confirmation_idempotency_key,
    'movementIds', (
      select jsonb_agg(entry.movement_id order by batch.received_at,line.batch_id,entry.ordinality)
      from public.warehouse_transfer_lines line
      join public.warehouse_batches batch on batch.id=line.batch_id
      cross join lateral unnest(array[line.outbound_movement_id,line.inbound_movement_id]) with ordinality entry(movement_id,ordinality)
      where line.transfer_id=header.id
    ),
    'reversalId', header.reversal_id, 'reversalReason', header.reversal_reason
  )
  from public.warehouse_transfers header
  where header.id=p_id
$$;
revoke all on function private.warehouse_transfer_json(uuid,boolean) from public,anon,authenticated,service_role;

create or replace function public.confirm_warehouse_transfer_secure(
  p_transfer_id uuid, p_variant_id uuid,
  p_source_warehouse_id uuid, p_source_location_id uuid,
  p_destination_warehouse_id uuid, p_destination_location_id uuid,
  p_quantity numeric, p_reason text, p_idempotency_key text
)
returns jsonb language plpgsql volatile security definer
set search_path=pg_catalog,public,private as $$
declare
  actor record; occurred timestamptz; payload jsonb;
  existing public.warehouse_transfers%rowtype; row_data record;
  remaining numeric; take_quantity numeric; total numeric:=0; allocations jsonb:='[]'::jsonb;
  allocation jsonb; batch_id_value uuid; batch_cost numeric; out_id uuid; in_id uuid;
begin
  select * into actor from private.assert_warehouse_permission('warehouse.transfer.manage');
  p_reason:=private.warehouse_operation_text(p_reason,1000); p_idempotency_key:=private.warehouse_operation_key(p_idempotency_key);
  if p_transfer_id is null or p_variant_id is null or p_source_warehouse_id is null or p_source_location_id is null
    or p_destination_warehouse_id is null or p_destination_location_id is null or p_source_location_id=p_destination_location_id
    or p_quantity is null or p_quantity<=0 or p_quantity>9007199254740.991 or p_quantity<>round(p_quantity,3)
    or p_quantity in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  then raise exception using errcode='22023',message='warehouse transfer input invalid',hint='WAREHOUSE_OPERATION_INPUT_INVALID'; end if;
  payload:=jsonb_build_object('transferId',p_transfer_id,'variantId',p_variant_id,'sourceWarehouseId',p_source_warehouse_id,
    'sourceLocationId',p_source_location_id,'destinationWarehouseId',p_destination_warehouse_id,'destinationLocationId',p_destination_location_id,
    'quantity',p_quantity,'reason',p_reason,'idempotencyKey',p_idempotency_key);
  perform pg_advisory_xact_lock(hashtextextended('warehouse-operation:warehouse_transfer:'||p_transfer_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('warehouse-operation-key:'||p_idempotency_key,0));
  select * into existing from public.warehouse_transfers where id=p_transfer_id or confirmation_idempotency_key=p_idempotency_key
    order by (id=p_transfer_id) desc limit 1 for update;
  if found then
    if existing.submitted_by_employee_profile_id<>actor.employee_profile_id then raise exception using errcode='23505',message='warehouse operation actor conflict',hint='WAREHOUSE_OPERATION_ACTOR_CONFLICT'; end if;
    if existing.id<>p_transfer_id or existing.confirmation_idempotency_key<>p_idempotency_key or existing.submission_payload<>payload
      then raise exception using errcode='23505',message='warehouse operation idempotency conflict',hint='WAREHOUSE_OPERATION_IDEMPOTENCY_CONFLICT'; end if;
    return private.warehouse_transfer_json(existing.id,public.has_current_permission('warehouse.cost.view'));
  end if;
  if not exists(select 1 from public.warehouse_variants variant join public.warehouse_items item on item.id=variant.item_id where variant.id=p_variant_id and variant.active and item.active)
    or not exists(select 1 from public.warehouse_sites where id=p_source_warehouse_id and active)
    or not exists(select 1 from public.warehouse_sites where id=p_destination_warehouse_id and active)
    or not exists(select 1 from public.warehouse_locations where id=p_source_location_id and warehouse_id=p_source_warehouse_id and active)
    or not exists(select 1 from public.warehouse_locations where id=p_destination_location_id and warehouse_id=p_destination_warehouse_id and active)
  then raise exception using errcode='55000',message='warehouse transfer resource inactive',hint='WAREHOUSE_RESOURCE_INACTIVE'; end if;
  perform private.lock_warehouse_location_resource(least(p_source_location_id,p_destination_location_id));
  perform private.lock_warehouse_location_resource(greatest(p_source_location_id,p_destination_location_id));
  perform private.lock_warehouse_variant_resource(p_variant_id);
  insert into public.warehouse_batch_locations(batch_id,location_id,quantity)
    select balance.batch_id,p_destination_location_id,0
    from public.warehouse_batch_locations balance join public.warehouse_batches batch on batch.id=balance.batch_id
    where batch.variant_id=p_variant_id and balance.location_id=p_source_location_id and balance.quantity>0
    on conflict do nothing;
  perform 1 from public.warehouse_batch_locations balance join public.warehouse_batches batch on batch.id=balance.batch_id
    where batch.variant_id=p_variant_id and balance.location_id in(p_source_location_id,p_destination_location_id)
    order by balance.batch_id,balance.location_id for update of balance;
  remaining:=p_quantity;
  for row_data in
    select batch.id as batch_id,batch.unit_cost,balance.quantity
    from public.warehouse_batches batch join public.warehouse_batch_locations balance on balance.batch_id=batch.id
    where batch.variant_id=p_variant_id and balance.location_id=p_source_location_id and balance.quantity>0
    order by batch.received_at,batch.id
  loop
    exit when remaining=0; take_quantity:=least(remaining,row_data.quantity);
    allocations:=allocations||jsonb_build_array(jsonb_build_object('batchId',row_data.batch_id,'quantity',take_quantity,'unitCost',row_data.unit_cost));
    total:=total+round(take_quantity*row_data.unit_cost,4); remaining:=remaining-take_quantity;
  end loop;
  if remaining<>0 then raise exception using errcode='23514',message='warehouse transfer stock insufficient',hint='WAREHOUSE_INSUFFICIENT_STOCK'; end if;
  if jsonb_array_length(allocations)>10000 then
    raise exception using errcode='54000',message='warehouse operation too complex',hint='WAREHOUSE_OPERATION_TOO_COMPLEX';
  end if;
  if total>900719925474.0991 then raise exception using errcode='22003',message='warehouse transfer cost overflow',hint='WAREHOUSE_OPERATION_INPUT_INVALID'; end if;
  occurred:=clock_timestamp();
  insert into public.warehouse_transfers(id,variant_id,source_warehouse_id,source_location_id,destination_warehouse_id,destination_location_id,
    requested_quantity,reason,status,submission_payload,submitted_by_employee_profile_id,submitted_at,confirmation_idempotency_key,
    confirmed_by_employee_profile_id,confirmed_at,total_cost)
  values(p_transfer_id,p_variant_id,p_source_warehouse_id,p_source_location_id,p_destination_warehouse_id,p_destination_location_id,
    p_quantity,p_reason,'confirmed',payload,actor.employee_profile_id,occurred,p_idempotency_key,actor.employee_profile_id,occurred,total);
  for allocation in select value from jsonb_array_elements(allocations) loop
    batch_id_value:=(allocation->>'batchId')::uuid; take_quantity:=(allocation->>'quantity')::numeric; batch_cost:=(allocation->>'unitCost')::numeric;
    out_id:=private.warehouse_deterministic_uuid('transfer-out:'||p_transfer_id::text||':'||batch_id_value::text);
    in_id:=private.warehouse_deterministic_uuid('transfer-in:'||p_transfer_id::text||':'||batch_id_value::text);
    update public.warehouse_batch_locations set quantity=quantity-take_quantity,updated_at=occurred where batch_id=batch_id_value and location_id=p_source_location_id;
    update public.warehouse_batch_locations set quantity=quantity+take_quantity,updated_at=occurred where batch_id=batch_id_value and location_id=p_destination_location_id;
    insert into public.warehouse_inventory_movements(id,movement_type,variant_id,batch_id,warehouse_id,location_id,quantity_delta,unit_cost,
      source_document_type,source_document_id,idempotency_key,operator_employee_profile_id,occurred_at,metadata) values
      (out_id,'调拨出库',p_variant_id,batch_id_value,p_source_warehouse_id,p_source_location_id,-take_quantity,batch_cost,'warehouse_transfer',p_transfer_id::text,'transfer-out:'||p_transfer_id::text||':'||batch_id_value::text,actor.employee_profile_id,occurred,jsonb_build_object('reason',p_reason)),
      (in_id,'调拨入库',p_variant_id,batch_id_value,p_destination_warehouse_id,p_destination_location_id,take_quantity,batch_cost,'warehouse_transfer',p_transfer_id::text,'transfer-in:'||p_transfer_id::text||':'||batch_id_value::text,actor.employee_profile_id,occurred,jsonb_build_object('reason',p_reason));
    insert into public.warehouse_transfer_lines(transfer_id,variant_id,batch_id,source_location_id,destination_location_id,quantity,unit_cost,total_cost,outbound_movement_id,inbound_movement_id)
      values(p_transfer_id,p_variant_id,batch_id_value,p_source_location_id,p_destination_location_id,take_quantity,batch_cost,round(take_quantity*batch_cost,4),out_id,in_id);
  end loop;
  return private.warehouse_transfer_json(p_transfer_id,public.has_current_permission('warehouse.cost.view'));
end;
$$;

create or replace function private.warehouse_operation_reversal_json(p_id uuid,p_view_cost boolean)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',reversal.id,'sourceDocumentType',reversal.source_document_type,
    'sourceDocumentId',reversal.source_document_id,'status',reversal.status,
    'reason',reversal.reason,'reversedByEmployeeProfileId',reversal.reversed_by_employee_profile_id,
    'reversedAt',reversal.reversed_at,'idempotencyKey',reversal.idempotency_key,
    'movementIds',to_jsonb(reversal.movement_ids),
    'costAdjustment',case when p_view_cost then reversal.cost_adjustment else null end
  ) from public.warehouse_operation_reversals reversal where reversal.id=p_id
$$;

create or replace function private.insert_warehouse_reversal_project_cost(
  p_reversal_id uuid,p_project_id text,p_amount numeric,p_actor_id uuid,
  p_occurred_at timestamptz,p_source_document_type text,p_source_document_id uuid
)
returns void language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare actor public.employee_profiles%rowtype; project public.projects%rowtype;
  record_key_value text; payload_value jsonb; existing_payload jsonb;
begin
  if p_amount=0 then return; end if;
  if p_reversal_id is null or p_project_id is null or p_actor_id is null or p_occurred_at is null
    or p_source_document_type not in('warehouse_stock_out','warehouse_return')
    or p_source_document_id is null or p_amount is null or abs(p_amount)>900719925474.0991
    or p_amount in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
  then raise exception using errcode='22023',message='warehouse reversal cost invalid',hint='WAREHOUSE_PROJECT_COST_INVALID'; end if;
  select * into actor from public.employee_profiles where id=p_actor_id;
  select * into project from public.projects where record_key=p_project_id;
  if actor.id is null or project.id is null then
    raise exception using errcode='55000',message='warehouse reversal project unavailable',hint='WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;
  record_key_value:='WAREHOUSE-WR:'||p_reversal_id::text;
  payload_value:=jsonb_build_object(
    'costRecordId',record_key_value,'projectId',p_project_id,
    'projectName',coalesce(project.payload->>'projectName',p_project_id),
    'employeeId',actor.employee_number,'employeeName',actor.name,'costType','材料费',
    'amount',round(p_amount,4),'date',(p_occurred_at at time zone 'Asia/Tokyo')::date,
    'operator',actor.name,'remark','仓库整单冲销按原冻结成本反向归集',
    'sourceType','warehouseReversal','sourceDocumentId',p_reversal_id,
    'sourceDocumentType','warehouse_operation_reversal',
    'reversedSourceDocumentType',p_source_document_type,
    'reversedSourceDocumentId',p_source_document_id,
    'sourcePurchaseRecordKeys','[]'::jsonb,
    'sourceStockOutIds',case when p_source_document_type='warehouse_stock_out' then jsonb_build_array(p_source_document_id) else '[]'::jsonb end,
    'createdAt',p_occurred_at,'updatedAt',p_occurred_at,
    'updatedByEmployeeId',actor.employee_number,'updatedByEmployeeName',actor.name
  );
  select payload into existing_payload from public.project_cost_records where record_key=record_key_value for update;
  if found then
    if existing_payload is distinct from payload_value then
      raise exception using errcode='23505',message='warehouse reversal project cost conflict',hint='WAREHOUSE_PROJECT_COST_CONFLICT';
    end if;
    return;
  end if;
  insert into public.project_cost_records(record_key,payload,status,created_at,updated_at,
    created_by_employee_id,created_by_employee_name,updated_by_employee_id,updated_by_employee_name)
  values(record_key_value,payload_value,'active',p_occurred_at,p_occurred_at,
    actor.employee_number,actor.name,actor.employee_number,actor.name);
end;
$$;

revoke all on function private.warehouse_operation_reversal_json(uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function private.insert_warehouse_reversal_project_cost(uuid,text,numeric,uuid,timestamptz,text,uuid) from public,anon,authenticated,service_role;

-- Compatibility overrides: a void return is no longer active inventory or cost.
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
            and return_request.status = 'confirmed'
        ), 0)
    ) else null end,
    'createdByEmployeeProfileId', job.created_by_employee_profile_id,
    'createdAt', job.created_at, 'updatedAt', job.updated_at
  )
  from public.warehouse_minor_work_orders job where job.id = p_id
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
    and return_request.status = 'confirmed';
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
      and confirmed_request.status = 'confirmed'
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
          join public.warehouse_return_requests active_return
            on active_return.id::text = return_movement.source_document_id
           and active_return.status = 'confirmed'
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
                  and return_request.status = 'confirmed'
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

revoke all on function private.warehouse_minor_work_order_json(uuid) from public, anon, authenticated, service_role;
revoke all on function private.post_minor_work_order_cost(uuid,uuid,timestamptz,boolean) from public, anon, authenticated, service_role;
revoke all on function public.confirm_warehouse_return_secure(uuid,jsonb,text) from public, anon, service_role;
grant execute on function public.confirm_warehouse_return_secure(uuid,jsonb,text) to authenticated;
revoke all on function public.list_warehouse_request_context_secure() from public, anon, service_role;
grant execute on function public.list_warehouse_request_context_secure() to authenticated;

create or replace function public.reverse_warehouse_operation_secure(
  p_source_document_type text,
  p_source_document_id uuid,
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
  actor record;
  existing public.warehouse_operation_reversals%rowtype;
  payload_value jsonb;
  reversal_id_value uuid;
  occurred timestamptz;
  source_status text;
  original_count integer;
  reversed_count integer;
  movement_row public.warehouse_inventory_movements%rowtype;
  aggregate_row record;
  movement_id_value uuid;
  movement_ids_value uuid[] := '{}'::uuid[];
  current_quantity numeric;
  cost_adjustment_value numeric := 0;
  project_id_value text;
  minor_work_order_id_value uuid;
begin
  if p_source_document_type = 'warehouse_receipt' then
    select * into actor
    from private.assert_warehouse_permission('warehouse.receipt.confirm');
  elsif p_source_document_type in ('warehouse_stock_out', 'warehouse_return') then
    select * into actor
    from private.assert_warehouse_permission('warehouse.stock_flow.confirm');
  elsif p_source_document_type = 'warehouse_transfer' then
    select * into actor
    from private.assert_warehouse_permission('warehouse.transfer.manage');
  elsif p_source_document_type = 'warehouse_stocktake' then
    select * into actor
    from private.assert_warehouse_permission('warehouse.stocktake.confirm');
  else
    raise exception using
      errcode = '22023',
      message = 'warehouse reversal source invalid',
      hint = 'WAREHOUSE_REVERSAL_SOURCE_INVALID';
  end if;

  p_reason := private.warehouse_operation_text(p_reason, 1000);
  p_idempotency_key := private.warehouse_operation_key(p_idempotency_key);
  if p_source_document_id is null then
    raise exception using
      errcode = '22023',
      message = 'warehouse reversal input invalid',
      hint = 'WAREHOUSE_OPERATION_INPUT_INVALID';
  end if;

  payload_value := jsonb_build_object(
    'sourceDocumentType', p_source_document_type,
    'sourceDocumentId', p_source_document_id,
    'reason', p_reason,
    'idempotencyKey', p_idempotency_key
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-operation:' || p_source_document_type || ':' || p_source_document_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'warehouse-operation-key:' || p_idempotency_key,
    0
  ));

  select * into existing
  from public.warehouse_operation_reversals
  where (
    source_document_type = p_source_document_type
    and source_document_id = p_source_document_id
  ) or idempotency_key = p_idempotency_key
  order by (
    source_document_type = p_source_document_type
    and source_document_id = p_source_document_id
  ) desc
  limit 1
  for update;

  if found then
    if existing.reversed_by_employee_profile_id <> actor.employee_profile_id then
      raise exception using
        errcode = '23505',
        message = 'warehouse operation actor conflict',
        hint = 'WAREHOUSE_OPERATION_ACTOR_CONFLICT';
    end if;
    if existing.source_document_type <> p_source_document_type
      or existing.source_document_id <> p_source_document_id
      or existing.idempotency_key <> p_idempotency_key
      or existing.submission_payload <> payload_value
    then
      raise exception using
        errcode = '23505',
        message = 'warehouse operation idempotency conflict',
        hint = 'WAREHOUSE_OPERATION_IDEMPOTENCY_CONFLICT';
    end if;
    return private.warehouse_operation_reversal_json(
      existing.id,
      public.has_current_permission('warehouse.cost.view')
    );
  end if;

  if p_source_document_type = 'warehouse_receipt' then
    select status into source_status
    from public.warehouse_receipts
    where id = p_source_document_id
    for update;
  elsif p_source_document_type = 'warehouse_stock_out' then
    select status, project_id, minor_work_order_id
    into source_status, project_id_value, minor_work_order_id_value
    from public.warehouse_stock_out_requests
    where id = p_source_document_id
    for update;
    if exists (
      select 1
      from public.warehouse_return_requests
      where original_stock_out_id = p_source_document_id
        and status = 'confirmed'
    ) then
      raise exception using
        errcode = '55000',
        message = 'confirmed return must be reversed first',
        hint = 'WAREHOUSE_ACTIVE_RETURN_EXISTS';
    end if;
    if exists (
      select 1
      from public.warehouse_stock_out_lines
      where request_id = p_source_document_id
        and frozen_total_cost is null
    ) then
      raise exception using
        errcode = '55000',
        message = 'warehouse source cost unavailable',
        hint = 'WAREHOUSE_OPERATION_IMMUTABLE';
    end if;
    select -coalesce(sum(frozen_total_cost), 0)
    into cost_adjustment_value
    from public.warehouse_stock_out_lines
    where request_id = p_source_document_id;
  elsif p_source_document_type = 'warehouse_return' then
    select returned.status, stockout.project_id, stockout.minor_work_order_id
    into source_status, project_id_value, minor_work_order_id_value
    from public.warehouse_return_requests returned
    join public.warehouse_stock_out_requests stockout
      on stockout.id = returned.original_stock_out_id
    where returned.id = p_source_document_id
    for update of returned;
    if exists (
      select 1
      from public.warehouse_return_lines
      where return_id = p_source_document_id
        and frozen_total_cost is null
    ) then
      raise exception using
        errcode = '55000',
        message = 'warehouse source cost unavailable',
        hint = 'WAREHOUSE_OPERATION_IMMUTABLE';
    end if;
    select coalesce(sum(frozen_total_cost), 0)
    into cost_adjustment_value
    from public.warehouse_return_lines
    where return_id = p_source_document_id;
  elsif p_source_document_type = 'warehouse_transfer' then
    select status into source_status
    from public.warehouse_transfers
    where id = p_source_document_id
    for update;
  else
    select status into source_status
    from public.warehouse_stocktakes
    where id = p_source_document_id
    for update;
  end if;

  if source_status is distinct from 'confirmed' then
    raise exception using
      errcode = '55000',
      message = 'warehouse source operation unavailable',
      hint = 'WAREHOUSE_DESTINATION_UNAVAILABLE';
  end if;

  select count(*), count(reversed.id)
  into original_count, reversed_count
  from public.warehouse_inventory_movements original
  left join public.warehouse_inventory_movements reversed
    on reversed.reversal_of_movement_id = original.id
  where original.source_document_type = p_source_document_type
    and original.source_document_id = p_source_document_id::text;

  if original_count = 0 or reversed_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'warehouse source movements unavailable',
      hint = 'WAREHOUSE_OPERATION_ALREADY_REVERSED';
  end if;
  if original_count > 20000 then
    raise exception using
      errcode = '54000',
      message = 'warehouse operation too complex',
      hint = 'WAREHOUSE_OPERATION_TOO_COMPLEX';
  end if;

  for aggregate_row in
    select distinct location_id
    from public.warehouse_inventory_movements
    where source_document_type = p_source_document_type
      and source_document_id = p_source_document_id::text
    order by location_id
  loop
    perform private.lock_warehouse_location_resource(aggregate_row.location_id);
  end loop;

  for aggregate_row in
    select distinct variant_id
    from public.warehouse_inventory_movements
    where source_document_type = p_source_document_type
      and source_document_id = p_source_document_id::text
    order by variant_id
  loop
    perform private.lock_warehouse_variant_resource(aggregate_row.variant_id);
  end loop;

  perform 1
  from public.warehouse_batch_locations balance
  where (balance.batch_id, balance.location_id) in (
    select batch_id, location_id
    from public.warehouse_inventory_movements
    where source_document_type = p_source_document_type
      and source_document_id = p_source_document_id::text
      and batch_id is not null
  )
  order by balance.batch_id, balance.location_id
  for update;

  for aggregate_row in
    select batch_id, location_id, sum(-quantity_delta) as inverse_quantity
    from public.warehouse_inventory_movements
    where source_document_type = p_source_document_type
      and source_document_id = p_source_document_id::text
      and batch_id is not null
    group by batch_id, location_id
    order by batch_id, location_id
  loop
    select quantity into current_quantity
    from public.warehouse_batch_locations
    where batch_id = aggregate_row.batch_id
      and location_id = aggregate_row.location_id;
    if current_quantity is null
      or current_quantity + aggregate_row.inverse_quantity < 0
    then
      raise exception using
        errcode = '23514',
        message = 'warehouse reversal stock insufficient',
        hint = 'WAREHOUSE_REVERSAL_INSUFFICIENT_STOCK';
    end if;
  end loop;

  occurred := clock_timestamp();
  reversal_id_value := private.warehouse_deterministic_uuid(
    'warehouse-reversal:' || p_source_document_type || ':' || p_source_document_id::text
  );

  for aggregate_row in
    select batch_id, location_id, sum(-quantity_delta) as inverse_quantity
    from public.warehouse_inventory_movements
    where source_document_type = p_source_document_type
      and source_document_id = p_source_document_id::text
      and batch_id is not null
    group by batch_id, location_id
    order by batch_id, location_id
  loop
    update public.warehouse_batch_locations
    set quantity = quantity + aggregate_row.inverse_quantity,
        updated_at = occurred
    where batch_id = aggregate_row.batch_id
      and location_id = aggregate_row.location_id;
  end loop;

  for movement_row in
    select *
    from public.warehouse_inventory_movements
    where source_document_type = p_source_document_type
      and source_document_id = p_source_document_id::text
    order by id
  loop
    movement_id_value := private.warehouse_deterministic_uuid(
      'warehouse-reversal-movement:' || reversal_id_value::text || ':' || movement_row.id::text
    );
    insert into public.warehouse_inventory_movements(
      id, movement_type, variant_id, batch_id, warehouse_id, location_id,
      quantity_delta, unit_cost, source_document_type, source_document_id,
      idempotency_key, project_id, destination_type, destination_id,
      destination_name, operator_employee_profile_id, occurred_at,
      reversal_of_movement_id, metadata
    ) values (
      movement_id_value, '冲销', movement_row.variant_id, movement_row.batch_id,
      movement_row.warehouse_id, movement_row.location_id,
      -movement_row.quantity_delta, movement_row.unit_cost,
      'warehouse_reversal', reversal_id_value::text,
      'warehouse-reversal:' || reversal_id_value::text || ':' || movement_row.id::text,
      movement_row.project_id, movement_row.destination_type,
      movement_row.destination_id, movement_row.destination_name,
      actor.employee_profile_id, occurred, movement_row.id,
      jsonb_build_object(
        'reason', p_reason,
        'sourceDocumentType', p_source_document_type,
        'sourceDocumentId', p_source_document_id
      )
    );
    movement_ids_value := array_append(movement_ids_value, movement_id_value);
  end loop;

  insert into public.warehouse_operation_reversals(
    id, source_document_type, source_document_id, reason, submission_payload,
    idempotency_key, reversed_by_employee_profile_id, reversed_at,
    movement_ids, cost_adjustment
  ) values (
    reversal_id_value, p_source_document_type, p_source_document_id, p_reason,
    payload_value, p_idempotency_key, actor.employee_profile_id, occurred,
    movement_ids_value, cost_adjustment_value
  );

  if p_source_document_type = 'warehouse_receipt' then
    update public.warehouse_receipts
    set status = 'void', rejection_reason = p_reason
    where id = p_source_document_id;
  elsif p_source_document_type = 'warehouse_stock_out' then
    update public.warehouse_stock_out_requests
    set status = 'void', rejection_reason = p_reason
    where id = p_source_document_id;
  elsif p_source_document_type = 'warehouse_return' then
    update public.warehouse_return_requests
    set status = 'void', rejection_reason = p_reason
    where id = p_source_document_id;
  elsif p_source_document_type = 'warehouse_transfer' then
    update public.warehouse_transfers
    set status = 'void', reversal_id = reversal_id_value,
        reversal_reason = p_reason,
        reversed_by_employee_profile_id = actor.employee_profile_id,
        reversed_at = occurred
    where id = p_source_document_id;
  else
    update public.warehouse_stocktakes
    set status = 'void', reversal_id = reversal_id_value,
        reversal_reason = p_reason,
        reversed_by_employee_profile_id = actor.employee_profile_id,
        reversed_at = occurred
    where id = p_source_document_id;
  end if;

  if project_id_value is not null and cost_adjustment_value <> 0 then
    perform private.insert_warehouse_reversal_project_cost(
      reversal_id_value, project_id_value, cost_adjustment_value,
      actor.employee_profile_id, occurred,
      p_source_document_type, p_source_document_id
    );
  elsif minor_work_order_id_value is not null then
    perform private.post_minor_work_order_cost(
      minor_work_order_id_value,
      actor.employee_profile_id,
      occurred,
      true
    );
  end if;

  return private.warehouse_operation_reversal_json(
    reversal_id_value,
    public.has_current_permission('warehouse.cost.view')
  );
end;
$$;

revoke all on function public.reverse_warehouse_operation_secure(text,uuid,text,text)
from public, anon, service_role;
grant execute on function public.reverse_warehouse_operation_secure(text,uuid,text,text)
to authenticated;

revoke all on function public.confirm_warehouse_transfer_secure(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text) from public,anon,service_role;
grant execute on function public.confirm_warehouse_transfer_secure(uuid,uuid,uuid,uuid,uuid,uuid,numeric,text,text) to authenticated;

-- Server-filtered warehouse reports.  Browser callers never receive a broad
-- table snapshot and cannot request export-sized payloads without the separate
-- report permission.  Cost keys stay present but null when cost access is absent.
create or replace function public.list_warehouse_report_secure(
  p_report_type text,
  p_filters jsonb default '{}'::jsonb,
  p_export boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  view_cost boolean;
  page_value integer;
  page_size_value integer;
  maximum_page_size integer;
  warehouse_filter uuid;
  location_filter uuid;
  variant_filter uuid;
  date_from_filter date;
  date_to_filter date;
  month_filter text;
  category_filter text;
  keyword_filter text;
  project_filter text;
  destination_filter text;
  status_filter text;
  rows_value jsonb;
begin
  perform private.assert_warehouse_permission('module.inventory.view');
  if p_export is null then
    raise exception using errcode='22023', message='warehouse report input invalid', hint='WAREHOUSE_REPORT_FILTER_INVALID';
  end if;
  if p_export and not public.has_current_permission('warehouse.report.export') then
    raise exception using errcode='42501', message='warehouse export permission required';
  end if;
  if p_report_type is null or p_report_type not in (
    'items','current_stock','receipts','issues','returns',
    'transfers','stocktakes','low_stock','movements'
  ) or jsonb_typeof(p_filters) is distinct from 'object'
    or exists (
      select 1 from jsonb_object_keys(p_filters) key
      where key not in (
        'dateFrom','dateTo','month','warehouseId','locationId','category',
        'variantId','projectId','destinationType','status','keyword','page','pageSize'
      )
    )
  then
    raise exception using errcode='22023', message='warehouse report input invalid', hint='WAREHOUSE_REPORT_FILTER_INVALID';
  end if;

  maximum_page_size := case when p_export then 20000 else 500 end;
  if coalesce(p_filters->>'page','1') !~ '^[1-9][0-9]{0,8}$'
    or coalesce(p_filters->>'pageSize',case when p_export then '20000' else '100' end) !~ '^[1-9][0-9]{0,4}$'
  then
    raise exception using errcode='22023', message='warehouse report page invalid', hint='WAREHOUSE_REPORT_FILTER_INVALID';
  end if;
  page_value := (coalesce(p_filters->>'page','1'))::integer;
  page_size_value := (coalesce(p_filters->>'pageSize',case when p_export then '20000' else '100' end))::integer;
  if page_size_value > maximum_page_size then
    raise exception using errcode='22023', message='warehouse report page invalid', hint='WAREHOUSE_REPORT_FILTER_INVALID';
  end if;

  begin
    warehouse_filter := nullif(p_filters->>'warehouseId','')::uuid;
    location_filter := nullif(p_filters->>'locationId','')::uuid;
    variant_filter := nullif(p_filters->>'variantId','')::uuid;
    date_from_filter := nullif(p_filters->>'dateFrom','')::date;
    date_to_filter := nullif(p_filters->>'dateTo','')::date;
  exception when others then
    raise exception using errcode='22023', message='warehouse report filter invalid', hint='WAREHOUSE_REPORT_FILTER_INVALID';
  end;
  month_filter := nullif(p_filters->>'month','');
  category_filter := nullif(p_filters->>'category','');
  keyword_filter := nullif(p_filters->>'keyword','');
  project_filter := nullif(p_filters->>'projectId','');
  destination_filter := nullif(p_filters->>'destinationType','');
  status_filter := nullif(p_filters->>'status','');
  if (month_filter is not null and month_filter !~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
    or (date_from_filter is not null and date_from_filter::text <> p_filters->>'dateFrom')
    or (date_to_filter is not null and date_to_filter::text <> p_filters->>'dateTo')
    or (date_from_filter is not null and date_to_filter is not null and date_from_filter > date_to_filter)
    or (category_filter is not null and (category_filter <> btrim(category_filter) or char_length(category_filter)>200))
    or (keyword_filter is not null and (keyword_filter <> btrim(keyword_filter) or char_length(keyword_filter)>200))
    or (project_filter is not null and (project_filter <> btrim(project_filter) or char_length(project_filter)>200))
    or (destination_filter is not null and destination_filter not in ('project','minor_work_order','internal_use'))
    or (status_filter is not null and status_filter not in ('active','inactive','pending','confirmed','rejected','void'))
  then
    raise exception using errcode='22023', message='warehouse report filter invalid', hint='WAREHOUSE_REPORT_FILTER_INVALID';
  end if;

  view_cost := public.has_current_permission('warehouse.cost.view');
  with candidates as (
    select 'items'::text report_type,
      jsonb_build_object(
        'itemId',item.id,'variantId',variant.id,'itemName',item.name,
        'category',item.category,'brand',item.brand,'model',variant.model,
        'size',variant.size,'material',variant.material,'sku',variant.sku,
        'unit',variant.unit,'minimumStock',variant.minimum_stock,
        'itemStatus',case when item.active then 'active' else 'inactive' end,
        'variantStatus',case when variant.active then 'active' else 'inactive' end,
        'unitCost',case when view_cost then variant.default_purchase_price else null end,
        'totalCost',null
      ) row_value,
      variant.id variant_id, array[]::uuid[] warehouse_ids, array[]::uuid[] location_ids,
      item.category category, null::text project_id, null::text destination_type,
      case when variant.active then 'active' else 'inactive' end status,
      null::date operation_date, null::text operation_month,
      lower(concat_ws(' ',item.name,item.category,item.brand,variant.sku,variant.model,variant.size,variant.material)) search_text,
      variant.updated_at sort_at, variant.id::text sort_id
    from public.warehouse_variants variant
    join public.warehouse_items item on item.id=variant.item_id
    where p_report_type='items'

    union all
    select 'current_stock',
      jsonb_build_object(
        'variantId',variant.id,'itemName',item.name,'category',item.category,
        'model',variant.model,'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'warehouseId',site.id,'warehouseName',site.name,'locationId',location.id,
        'shelfCode',location.shelf_code,'shelfName',location.shelf_name,
        'quantity',sum(balance.quantity),
        'unitCost',case when view_cost and sum(balance.quantity)>0 then round(sum(balance.quantity*batch.unit_cost)/sum(balance.quantity),4) when view_cost then 0 else null end,
        'totalCost',case when view_cost then round(sum(balance.quantity*batch.unit_cost),4) else null end
      ),
      variant.id,array[site.id],array[location.id],item.category,null,null,null,null,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,site.name,location.shelf_code,location.shelf_name)),
      max(balance.updated_at),variant.id::text||':'||location.id::text
    from public.warehouse_batch_locations balance
    join public.warehouse_batches batch on batch.id=balance.batch_id
    join public.warehouse_variants variant on variant.id=batch.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    join public.warehouse_locations location on location.id=balance.location_id
    join public.warehouse_sites site on site.id=location.warehouse_id
    where p_report_type='current_stock'
    group by variant.id,item.name,item.category,variant.model,variant.size,variant.sku,variant.unit,
      site.id,site.name,location.id,location.shelf_code,location.shelf_name

    union all
    select 'receipts',
      jsonb_build_object(
        'receiptId',receipt.id,'receiptLineId',line.id,
        'purchaseRecordKey',receipt.purchase_record_key,
        'date',coalesce(receipt.confirmed_at,receipt.submitted_at),
        'variantId',variant.id,'itemName',item.name,'category',item.category,
        'model',variant.model,'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'warehouseId',site.id,'warehouseName',site.name,'locationId',location.id,
        'shelfCode',location.shelf_code,'shelfName',location.shelf_name,
        'quantity',coalesce(line.confirmed_quantity,line.requested_quantity),
        'status',receipt.status,'operator',coalesce(confirmer.name,submitter.name),
        'reason',coalesce(receipt.rejection_reason,''),
        'unitCost',case when view_cost then line.unit_cost else null end,
        'totalCost',case when view_cost and line.unit_cost is not null then round(coalesce(line.confirmed_quantity,line.requested_quantity)*line.unit_cost,4) else null end
      ),
      variant.id,case when site.id is null then array[]::uuid[] else array[site.id] end,
      case when location.id is null then array[]::uuid[] else array[location.id] end,
      item.category,null,null,receipt.status,(coalesce(receipt.confirmed_at,receipt.submitted_at) at time zone 'Asia/Tokyo')::date,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,receipt.purchase_record_key,site.name,location.shelf_code)),
      coalesce(receipt.confirmed_at,receipt.submitted_at),receipt.id::text||':'||line.id::text
    from public.warehouse_receipts receipt
    join public.warehouse_receipt_lines line on line.receipt_id=receipt.id
    join public.warehouse_variants variant on variant.id=line.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    left join public.warehouse_locations location on location.id=line.location_id
    left join public.warehouse_sites site on site.id=line.warehouse_id
    join public.employee_profiles submitter on submitter.id=receipt.submitted_by_employee_profile_id
    left join public.employee_profiles confirmer on confirmer.id=receipt.confirmed_by_employee_profile_id
    where p_report_type='receipts'

    union all
    select 'issues',
      jsonb_build_object(
        'issueId',request.id,'date',request.request_date,'variantId',variant.id,
        'itemName',item.name,'category',item.category,'model',variant.model,
        'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'warehouseId',movement_data.warehouse_id,'warehouseName',movement_data.warehouse_name,
        'locationId',movement_data.location_id,'shelfCode',movement_data.shelf_code,'shelfName',movement_data.shelf_name,
        'quantity',coalesce(line.confirmed_quantity,line.requested_quantity),
        'projectId',request.project_id,'destinationType',request.destination_type,
        'destinationName',request.destination_name_snapshot,'receiver',request.receiver,
        'status',request.status,'operator',coalesce(confirmer.name,submitter.name),'reason',coalesce(request.rejection_reason,request.purpose),
        'unitCost',case when view_cost and line.confirmed_quantity>0 then round(line.frozen_total_cost/line.confirmed_quantity,4) else null end,
        'totalCost',case when view_cost then line.frozen_total_cost else null end
      ),
      variant.id,coalesce(movement_data.warehouse_ids,array[]::uuid[]),coalesce(movement_data.location_ids,array[]::uuid[]),
      item.category,request.project_id,request.destination_type,request.status,request.request_date,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,request.destination_name_snapshot,request.receiver,request.purpose)),
      coalesce(request.confirmed_at,request.submitted_at),request.id::text||':'||line.id::text
    from public.warehouse_stock_out_requests request
    join public.warehouse_stock_out_lines line on line.request_id=request.id
    join public.warehouse_variants variant on variant.id=line.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    join public.employee_profiles submitter on submitter.id=request.submitted_by_employee_profile_id
    left join public.employee_profiles confirmer on confirmer.id=request.confirmed_by_employee_profile_id
    left join lateral (
      select array_agg(distinct movement.warehouse_id) warehouse_ids,
        array_agg(distinct movement.location_id) location_ids,
        min(movement.warehouse_id::text)::uuid warehouse_id,min(site.name) warehouse_name,
        min(movement.location_id::text)::uuid location_id,min(location.shelf_code) shelf_code,min(location.shelf_name) shelf_name
      from public.warehouse_inventory_movements movement
      join public.warehouse_sites site on site.id=movement.warehouse_id
      join public.warehouse_locations location on location.id=movement.location_id
      where movement.source_document_type='warehouse_stock_out'
        and movement.source_document_id=request.id::text
        and movement.metadata->>'stockOutLineId'=line.id::text
    ) movement_data on true
    where p_report_type='issues'

    union all
    select 'returns',
      jsonb_build_object(
        'returnId',returned.id,'originalIssueId',returned.original_stock_out_id,
        'date',returned.request_date,'variantId',variant.id,'itemName',item.name,
        'category',item.category,'model',variant.model,'size',variant.size,
        'sku',variant.sku,'unit',variant.unit,'warehouseId',movement_data.warehouse_id,
        'warehouseName',movement_data.warehouse_name,'locationId',movement_data.location_id,
        'shelfCode',movement_data.shelf_code,'shelfName',movement_data.shelf_name,
        'quantity',coalesce(line.confirmed_quantity,line.requested_quantity),
        'projectId',original.project_id,'destinationType',original.destination_type,
        'destinationName',original.destination_name_snapshot,'receiver',returned.receiver,
        'status',returned.status,'operator',coalesce(confirmer.name,submitter.name),
        'reason',coalesce(returned.rejection_reason,returned.reason),
        'unitCost',case when view_cost and line.confirmed_quantity>0 then round(line.frozen_total_cost/line.confirmed_quantity,4) else null end,
        'totalCost',case when view_cost then line.frozen_total_cost else null end
      ),
      variant.id,coalesce(movement_data.warehouse_ids,array[]::uuid[]),coalesce(movement_data.location_ids,array[]::uuid[]),
      item.category,original.project_id,original.destination_type,returned.status,returned.request_date,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,original.destination_name_snapshot,returned.receiver,returned.reason)),
      coalesce(returned.confirmed_at,returned.submitted_at),returned.id::text||':'||line.id::text
    from public.warehouse_return_requests returned
    join public.warehouse_return_lines line on line.return_id=returned.id
    join public.warehouse_stock_out_requests original on original.id=returned.original_stock_out_id
    join public.warehouse_stock_out_lines original_line on original_line.id=line.original_stock_out_line_id
    join public.warehouse_variants variant on variant.id=original_line.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    join public.employee_profiles submitter on submitter.id=returned.submitted_by_employee_profile_id
    left join public.employee_profiles confirmer on confirmer.id=returned.confirmed_by_employee_profile_id
    left join lateral (
      select array_agg(distinct movement.warehouse_id) warehouse_ids,
        array_agg(distinct movement.location_id) location_ids,
        min(movement.warehouse_id::text)::uuid warehouse_id,min(site.name) warehouse_name,
        min(movement.location_id::text)::uuid location_id,min(location.shelf_code) shelf_code,min(location.shelf_name) shelf_name
      from public.warehouse_inventory_movements movement
      join public.warehouse_sites site on site.id=movement.warehouse_id
      join public.warehouse_locations location on location.id=movement.location_id
      where movement.source_document_type='warehouse_return'
        and movement.source_document_id=returned.id::text
        and movement.metadata->>'returnLineId'=line.id::text
    ) movement_data on true
    where p_report_type='returns'

    union all
    select 'transfers',
      jsonb_build_object(
        'transferId',transfer.id,'date',transfer.confirmed_at,'variantId',variant.id,
        'itemName',item.name,'category',item.category,'model',variant.model,
        'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'sourceWarehouseId',source_site.id,'sourceWarehouseName',source_site.name,
        'sourceLocationId',source_location.id,'sourceShelfCode',source_location.shelf_code,'sourceShelfName',source_location.shelf_name,
        'destinationWarehouseId',destination_site.id,'destinationWarehouseName',destination_site.name,
        'destinationLocationId',destination_location.id,'destinationShelfCode',destination_location.shelf_code,'destinationShelfName',destination_location.shelf_name,
        'quantity',transfer.requested_quantity,'status',transfer.status,'operator',operator.name,'reason',transfer.reason,
        'unitCost',case when view_cost and transfer.requested_quantity>0 then round(transfer.total_cost/transfer.requested_quantity,4) else null end,
        'totalCost',case when view_cost then transfer.total_cost else null end
      ),
      variant.id,array[transfer.source_warehouse_id,transfer.destination_warehouse_id],array[transfer.source_location_id,transfer.destination_location_id],
      item.category,null,null,transfer.status,(transfer.confirmed_at at time zone 'Asia/Tokyo')::date,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,source_site.name,destination_site.name,source_location.shelf_code,destination_location.shelf_code,transfer.reason)),
      transfer.confirmed_at,transfer.id::text
    from public.warehouse_transfers transfer
    join public.warehouse_variants variant on variant.id=transfer.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    join public.warehouse_sites source_site on source_site.id=transfer.source_warehouse_id
    join public.warehouse_sites destination_site on destination_site.id=transfer.destination_warehouse_id
    join public.warehouse_locations source_location on source_location.id=transfer.source_location_id
    join public.warehouse_locations destination_location on destination_location.id=transfer.destination_location_id
    join public.employee_profiles operator on operator.id=transfer.confirmed_by_employee_profile_id
    where p_report_type='transfers'

    union all
    select 'stocktakes',
      jsonb_build_object(
        'stocktakeId',stocktake.id,'date',stocktake.confirmed_at,'month',stocktake.stocktake_month,
        'variantId',variant.id,'itemName',item.name,'category',item.category,
        'model',variant.model,'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'warehouseId',site.id,'warehouseName',site.name,'locationId',location.id,
        'shelfCode',location.shelf_code,'shelfName',location.shelf_name,
        'bookQuantity',line.book_quantity,'countedQuantity',line.counted_quantity,
        'quantityDelta',line.quantity_delta,'differenceType',line.difference_type,
        'status',stocktake.status,'operator',operator.name,'reason',line.reason,
        'unitCost',case when view_cost then line.frozen_unit_cost else null end,
        'totalCost',case when view_cost then line.frozen_total_cost else null end
      ),
      variant.id,array[stocktake.warehouse_id],array[line.location_id],item.category,null,null,stocktake.status,
      (stocktake.confirmed_at at time zone 'Asia/Tokyo')::date,stocktake.stocktake_month,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,site.name,location.shelf_code,line.reason)),
      stocktake.confirmed_at,stocktake.id::text||':'||line.id::text
    from public.warehouse_stocktakes stocktake
    join public.warehouse_stocktake_lines line on line.stocktake_id=stocktake.id
    join public.warehouse_variants variant on variant.id=line.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    join public.warehouse_sites site on site.id=stocktake.warehouse_id
    join public.warehouse_locations location on location.id=line.location_id
    join public.employee_profiles operator on operator.id=stocktake.confirmed_by_employee_profile_id
    where p_report_type='stocktakes'

    union all
    select 'low_stock',
      jsonb_build_object(
        'variantId',variant.id,'itemName',item.name,'category',item.category,
        'model',variant.model,'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'quantity',coalesce(sum(balance.quantity),0),'minimumStock',variant.minimum_stock,
        'shortageQuantity',greatest(variant.minimum_stock-coalesce(sum(balance.quantity),0),0),
        'unitCost',case when view_cost and coalesce(sum(balance.quantity),0)>0 then round(sum(balance.quantity*batch.unit_cost)/sum(balance.quantity),4) when view_cost then 0 else null end,
        'totalCost',case when view_cost then round(coalesce(sum(balance.quantity*batch.unit_cost),0),4) else null end
      ),
      variant.id,array[]::uuid[],array[]::uuid[],item.category,null,null,null,null,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size)),
      variant.updated_at,variant.id::text
    from public.warehouse_variants variant
    join public.warehouse_items item on item.id=variant.item_id
    left join public.warehouse_batches batch on batch.variant_id=variant.id
    left join public.warehouse_batch_locations balance on balance.batch_id=batch.id
    where p_report_type='low_stock' and variant.active and item.active
    group by variant.id,item.name,item.category,variant.model,variant.size,variant.sku,variant.unit,variant.minimum_stock
    having coalesce(sum(balance.quantity),0)<variant.minimum_stock

    union all
    select 'movements',
      jsonb_build_object(
        'movementId',movement.id,'date',movement.occurred_at,'movementType',movement.movement_type,
        'sourceDocumentType',movement.source_document_type,'sourceDocumentId',movement.source_document_id,
        'variantId',variant.id,'itemName',item.name,'category',item.category,
        'model',variant.model,'size',variant.size,'sku',variant.sku,'unit',variant.unit,
        'warehouseId',site.id,'warehouseName',site.name,'locationId',location.id,
        'shelfCode',location.shelf_code,'shelfName',location.shelf_name,
        'quantityDelta',movement.quantity_delta,'projectId',movement.project_id,
        'destinationType',movement.destination_type,'destinationName',movement.destination_name,
        'operator',operator.name,'reason',coalesce(movement.metadata->>'reason',''),
        'unitCost',case when view_cost then movement.unit_cost else null end,
        'totalCost',case when view_cost then round(movement.quantity_delta*movement.unit_cost,4) else null end
      ),
      variant.id,array[movement.warehouse_id],array[movement.location_id],item.category,movement.project_id,movement.destination_type,null,
      (movement.occurred_at at time zone 'Asia/Tokyo')::date,null,
      lower(concat_ws(' ',item.name,item.category,variant.sku,variant.model,variant.size,site.name,location.shelf_code,movement.movement_type,movement.source_document_id,movement.destination_name)),
      movement.occurred_at,movement.id::text
    from public.warehouse_inventory_movements movement
    join public.warehouse_variants variant on variant.id=movement.variant_id
    join public.warehouse_items item on item.id=variant.item_id
    join public.warehouse_sites site on site.id=movement.warehouse_id
    join public.warehouse_locations location on location.id=movement.location_id
    join public.employee_profiles operator on operator.id=movement.operator_employee_profile_id
    where p_report_type='movements'
  ), filtered as (
    select row_value,sort_at,sort_id
    from candidates
    where report_type=p_report_type
      and (variant_filter is null or variant_id=variant_filter)
      and (warehouse_filter is null or warehouse_filter=any(warehouse_ids))
      and (location_filter is null or location_filter=any(location_ids))
      and (category_filter is null or category=category_filter)
      and (project_filter is null or project_id=project_filter)
      and (destination_filter is null or destination_type=destination_filter)
      and (status_filter is null or status=status_filter)
      and (date_from_filter is null or operation_date>=date_from_filter)
      and (date_to_filter is null or operation_date<=date_to_filter)
      and (month_filter is null or operation_month=month_filter)
      and (keyword_filter is null or search_text like '%'||lower(keyword_filter)||'%')
    order by sort_at desc nulls last,sort_id
    limit page_size_value offset (page_value::bigint-1)*page_size_value::bigint
  )
  select coalesce(jsonb_agg(row_value order by sort_at desc nulls last,sort_id),'[]'::jsonb)
  into rows_value from filtered;

  return jsonb_build_object(
    'reportType',p_report_type,'page',page_value,'pageSize',page_size_value,
    'export',p_export,'generatedAt',statement_timestamp(),'rows',rows_value
  );
end;
$$;

revoke all on function public.list_warehouse_report_secure(text,jsonb,boolean)
from public,anon,service_role;
grant execute on function public.list_warehouse_report_secure(text,jsonb,boolean)
to authenticated;

commit;

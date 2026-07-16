-- RPC-only purchase accrual access. The existing purchase_records grants and RLS
-- remain unchanged so payment-sensitive direct table access stays fail-closed.

create or replace function private.purchase_payment_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'openingPaidAmount',
    'paidAmount',
    'unpaidAmount',
    'paymentStatus'
  ]::text[];
$$;

create or replace function private.purchase_client_audit_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'created_by_employee_id',
    'created_by_employee_name',
    'updated_by_employee_id',
    'updated_by_employee_name',
    'createdByEmployeeId',
    'createdByEmployeeName',
    'updatedByEmployeeId',
    'updatedByEmployeeName'
  ]::text[];
$$;

revoke all on function private.purchase_payment_payload_keys()
  from public, anon, authenticated, service_role;
revoke all on function private.purchase_client_audit_payload_keys()
  from public, anon, authenticated, service_role;

create or replace function public.list_purchase_records_secure()
returns table (
  record_key text,
  payload jsonb,
  status text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  can_view_payments boolean;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.purchases.view')
  then
    raise exception using
      errcode = '42501',
      message = 'purchase view permission required';
  end if;

  can_view_payments := public.has_current_permission(
    'sensitive.purchase_payments_view'
  );

  return query
  select
    purchase.record_key,
    case
      when can_view_payments then purchase.payload
      else purchase.payload - private.purchase_payment_payload_keys()
    end,
    purchase.status,
    purchase.updated_at
  from public.purchase_records as purchase
  where purchase.status = 'active'
  order by purchase.updated_at desc, purchase.record_key;
end;
$$;

create or replace function public.upsert_purchase_record_secure(
  p_record_key text,
  p_payload jsonb,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  existing_purchase public.purchase_records%rowtype;
  saved_purchase public.purchase_records%rowtype;
  existing_found boolean;
  can_update_payments boolean;
  can_view_payments boolean;
  effective_payload jsonb;
  next_payload jsonb;
  response_payload jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  if p_record_key is null
    or p_record_key = ''
    or p_record_key <> btrim(p_record_key)
    or char_length(p_record_key) > 200
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase record key required';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'purchase payload must be a JSON object';
  end if;

  if p_status is distinct from 'active' then
    raise exception using
      errcode = '22023',
      message = 'purchase status must be active';
  end if;

  if p_payload ?| private.purchase_client_audit_payload_keys() then
    raise exception using
      errcode = '22023',
      message = 'client audit fields are not accepted';
  end if;

  if p_payload ? 'purchaseId'
    and (
      jsonb_typeof(p_payload->'purchaseId') is distinct from 'string'
      or p_payload->>'purchaseId' is distinct from p_record_key
    )
  then
    raise exception using
      errcode = '22023',
      message = 'purchase record key mismatch';
  end if;

  -- Serialize both first-insert and existing-row paths for this logical key.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.purchase_records:' || p_record_key, 0)
  );

  select purchase.*
    into existing_purchase
    from public.purchase_records as purchase
    where purchase.record_key = p_record_key
    for update;
  existing_found := found;

  if existing_found then
    if not public.has_current_permission('module.purchases.update') then
      raise exception using
        errcode = '42501',
        message = 'purchase update permission required';
    end if;
    if existing_purchase.status <> 'active' then
      raise exception using
        errcode = 'P0002',
        message = 'purchase record not found';
    end if;
  elsif not public.has_current_permission('module.purchases.create') then
    raise exception using
      errcode = '42501',
      message = 'purchase create permission required';
  end if;

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  can_update_payments := public.has_current_permission(
    'sensitive.purchase_payments_update'
  );
  can_view_payments := public.has_current_permission(
    'sensitive.purchase_payments_view'
  );

  effective_payload := p_payload;
  if not can_update_payments then
    effective_payload := effective_payload
      - private.purchase_payment_payload_keys();
  end if;
  effective_payload := effective_payload || jsonb_build_object(
    'purchaseId', p_record_key
  );

  if existing_found then
    next_payload := existing_purchase.payload || effective_payload;
    next_payload := next_payload || jsonb_build_object(
      'purchaseId', p_record_key
    );

    update public.purchase_records as purchase
      set payload = next_payload,
          updated_by_employee_id = actor.id::text,
          updated_by_employee_name = actor.name
      where purchase.record_key = p_record_key
      returning purchase.* into saved_purchase;
  else
    next_payload := effective_payload;

    insert into public.purchase_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      p_record_key,
      next_payload,
      'active',
      actor.id::text,
      actor.name,
      actor.id::text,
      actor.name
    )
    returning * into saved_purchase;
  end if;

  response_payload := case
    when can_view_payments then saved_purchase.payload
    else saved_purchase.payload - private.purchase_payment_payload_keys()
  end;

  return jsonb_build_object(
    'record_key', saved_purchase.record_key,
    'payload', response_payload,
    'status', saved_purchase.status,
    'updated_at', saved_purchase.updated_at
  );
end;
$$;

create or replace function public.soft_delete_purchase_record_secure(
  p_record_key text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  deleted_record_key text;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.purchases.delete')
  then
    raise exception using
      errcode = '42501',
      message = 'purchase delete permission required';
  end if;

  if p_record_key is null
    or p_record_key = ''
    or p_record_key <> btrim(p_record_key)
    or char_length(p_record_key) > 200
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase record key required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.purchase_records:' || p_record_key, 0)
  );

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  update public.purchase_records as purchase
    set status = 'deleted',
        updated_by_employee_id = actor.id::text,
        updated_by_employee_name = actor.name
    where purchase.record_key = p_record_key
      and purchase.status = 'active'
    returning purchase.record_key into deleted_record_key;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'purchase record not found';
  end if;

  return deleted_record_key;
end;
$$;

-- Close PostgreSQL's default PUBLIC EXECUTE before granting only the intended
-- authenticated browser and trusted server roles.
revoke all on function public.list_purchase_records_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_purchase_record_secure(text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.soft_delete_purchase_record_secure(text)
  from public, anon, authenticated, service_role;

grant execute on function public.list_purchase_records_secure()
  to authenticated, service_role;
grant execute on function public.upsert_purchase_record_secure(text, jsonb, text)
  to authenticated, service_role;
grant execute on function public.soft_delete_purchase_record_secure(text)
  to authenticated, service_role;

-- Keep employee_profiles private: revenue writers obtain audit identity through
-- the existing security-definer current_employee_profile() projection.

create or replace function public.upsert_project_contract_change_secure(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  record_key_value text;
  actor_id text;
  actor_name text;
  saved_payload jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'contract change payload must be an object';
  end if;
  record_key_value := btrim(coalesce(p_payload->>'changeId', ''));
  if record_key_value = '' then
    raise exception using errcode = '22023', message = 'changeId is required';
  end if;

  select profile.id::text, profile.name
    into actor_id, actor_name
    from public.current_employee_profile() as profile;

  insert into public.project_contract_changes (
    record_key, payload, created_by_employee_id, created_by_employee_name,
    updated_by_employee_id, updated_by_employee_name, status
  ) values (
    record_key_value, p_payload, coalesce(actor_id, ''), coalesce(actor_name, ''),
    coalesce(actor_id, ''), coalesce(actor_name, ''), 'active'
  )
  on conflict (record_key) do update
    set payload = excluded.payload,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_by_employee_name = excluded.updated_by_employee_name
  returning payload into saved_payload;

  return saved_payload;
end;
$$;

create or replace function public.upsert_project_payment_plan_secure(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  record_key_value text;
  actor_id text;
  actor_name text;
  saved_payload jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'payment plan payload must be an object';
  end if;
  record_key_value := btrim(coalesce(p_payload->>'planId', ''));
  if record_key_value = '' then
    raise exception using errcode = '22023', message = 'planId is required';
  end if;

  select profile.id::text, profile.name
    into actor_id, actor_name
    from public.current_employee_profile() as profile;

  insert into public.project_payment_plans (
    record_key, payload, created_by_employee_id, created_by_employee_name,
    updated_by_employee_id, updated_by_employee_name, status
  ) values (
    record_key_value, p_payload, coalesce(actor_id, ''), coalesce(actor_name, ''),
    coalesce(actor_id, ''), coalesce(actor_name, ''), 'active'
  )
  on conflict (record_key) do update
    set payload = excluded.payload,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_by_employee_name = excluded.updated_by_employee_name
  returning payload into saved_payload;

  return saved_payload;
end;
$$;

create or replace function public.upsert_project_receipt_secure(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  record_key_value text;
  actor_id text;
  actor_name text;
  saved_payload jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'project receipt payload must be an object';
  end if;
  record_key_value := btrim(coalesce(p_payload->>'receiptId', ''));
  if record_key_value = '' then
    raise exception using errcode = '22023', message = 'receiptId is required';
  end if;

  select profile.id::text, profile.name
    into actor_id, actor_name
    from public.current_employee_profile() as profile;

  insert into public.project_receipts (
    record_key, payload, created_by_employee_id, created_by_employee_name,
    updated_by_employee_id, updated_by_employee_name, status
  ) values (
    record_key_value, p_payload, coalesce(actor_id, ''), coalesce(actor_name, ''),
    coalesce(actor_id, ''), coalesce(actor_name, ''), 'active'
  )
  on conflict (record_key) do update
    set payload = excluded.payload,
        updated_by_employee_id = excluded.updated_by_employee_id,
        updated_by_employee_name = excluded.updated_by_employee_name
  returning payload into saved_payload;

  return saved_payload;
end;
$$;

notify pgrst, 'reload schema';

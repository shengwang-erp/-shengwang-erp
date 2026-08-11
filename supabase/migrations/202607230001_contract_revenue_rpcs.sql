-- Browser-facing, RLS-preserving RPCs for project contract revenue records.
-- The underlying tables and their authorization policies were introduced by
-- 202607150001_project_core_security.sql.

create or replace function public.list_project_contract_changes_secure()
returns setof jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select record.payload
  from public.project_contract_changes as record
  where record.status <> 'deleted'
  order by record.updated_at, record.record_key;
$$;

create or replace function public.list_project_payment_plans_secure()
returns setof jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select record.payload
  from public.project_payment_plans as record
  where record.status <> 'deleted'
  order by record.updated_at, record.record_key;
$$;

create or replace function public.list_project_receipts_secure()
returns setof jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select record.payload
  from public.project_receipts as record
  where record.status <> 'deleted'
  order by record.updated_at, record.record_key;
$$;

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

  select employee.id::text, employee.name
    into actor_id, actor_name
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid();

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

  select employee.id::text, employee.name
    into actor_id, actor_name
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid();

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

  select employee.id::text, employee.name
    into actor_id, actor_name
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid();

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

revoke all on function public.list_project_contract_changes_secure() from public, anon, authenticated, service_role;
revoke all on function public.list_project_payment_plans_secure() from public, anon, authenticated, service_role;
revoke all on function public.list_project_receipts_secure() from public, anon, authenticated, service_role;
revoke all on function public.upsert_project_contract_change_secure(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.upsert_project_payment_plan_secure(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.upsert_project_receipt_secure(jsonb) from public, anon, authenticated, service_role;

grant execute on function public.list_project_contract_changes_secure() to authenticated, service_role;
grant execute on function public.list_project_payment_plans_secure() to authenticated, service_role;
grant execute on function public.list_project_receipts_secure() to authenticated, service_role;
grant execute on function public.upsert_project_contract_change_secure(jsonb) to authenticated, service_role;
grant execute on function public.upsert_project_payment_plan_secure(jsonb) to authenticated, service_role;
grant execute on function public.upsert_project_receipt_secure(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';

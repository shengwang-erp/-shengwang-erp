-- Remove accounting confirmation as a business gate without deleting historical fields.
-- A formal original contract is usable only after a complete, internally consistent
-- payload has been persisted to public.projects.

create or replace function private.project_has_valid_saved_contract(p_payload jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  schema_version numeric;
  tax_exclusive_amount numeric;
  tax_rate numeric;
  tax_amount numeric;
  tax_inclusive_amount numeric;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or coalesce(p_payload->>'contractRevenueSetupStatus', '') <> 'configured'
    or coalesce(p_payload->>'contractRevenueSchemaVersion', '') !~ '^\d+$'
    or coalesce(p_payload->>'originalContractTaxExclusiveAmount', '') !~ '^\d+$'
    or coalesce(p_payload->>'originalContractTaxRate', '') !~ '^\d+(\.\d+)?$'
    or coalesce(p_payload->>'originalContractTaxAmount', '') !~ '^\d+$'
    or coalesce(p_payload->>'originalContractTaxInclusiveAmount', '') !~ '^\d+$'
  then
    return false;
  end if;

  schema_version := (p_payload->>'contractRevenueSchemaVersion')::numeric;
  tax_exclusive_amount := (p_payload->>'originalContractTaxExclusiveAmount')::numeric;
  tax_rate := (p_payload->>'originalContractTaxRate')::numeric;
  tax_amount := (p_payload->>'originalContractTaxAmount')::numeric;
  tax_inclusive_amount := (p_payload->>'originalContractTaxInclusiveAmount')::numeric;

  return schema_version = trunc(schema_version)
    and schema_version >= 1
    and tax_exclusive_amount = trunc(tax_exclusive_amount)
    and tax_exclusive_amount > 0
    and tax_exclusive_amount <= 9007199254740991
    and tax_rate >= 0
    and tax_rate <= 100
    and tax_amount = trunc(tax_amount)
    and tax_amount >= 0
    and tax_amount <= 9007199254740991
    and tax_inclusive_amount = trunc(tax_inclusive_amount)
    and tax_inclusive_amount > 0
    and tax_inclusive_amount <= 9007199254740991
    and tax_inclusive_amount = tax_exclusive_amount + tax_amount
    and abs(tax_exclusive_amount - round(tax_inclusive_amount / (1 + tax_rate / 100))) <= 1
    and abs(tax_amount - (tax_inclusive_amount - round(tax_inclusive_amount / (1 + tax_rate / 100)))) <= 1;
exception
  when numeric_value_out_of_range or invalid_text_representation then
    return false;
end;
$$;

revoke all on function private.project_has_valid_saved_contract(jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.replace_project_payment_plan_secure(
  p_project_id text,
  p_plans jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  actor_id text;
  actor_name text;
  project_payload jsonb;
  plan_row record;
  submitted_plan jsonb;
  current_plan jsonb;
  plan_id text;
  plan_name text;
  due_date_text text;
  weight_text text;
  amount_text text;
  plan_count integer;
  plan_order integer;
  weight numeric(7,2);
  amount bigint;
  weight_total numeric(9,2) := 0;
  amount_total numeric := 0;
  contract_total numeric := 0;
  locked_ids text[] := array[]::text[];
  submitted_ids text[] := array[]::text[];
  submitted_orders integer[] := array[]::integer[];
  saved_payload jsonb;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.update')
    or not public.can_current_employee_view_project_financials()
  then
    raise exception using errcode = '42501', message = 'project financial update permission required';
  end if;
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception using errcode = '22023', message = 'project id is required';
  end if;
  if jsonb_typeof(p_plans) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'payment plans must be an array';
  end if;
  plan_count := jsonb_array_length(p_plans);
  if plan_count < 1 or plan_count > 24 then
    raise exception using errcode = '22023', message = 'payment plans must contain 1 to 24 installments';
  end if;

  select profile.id::text, profile.name into actor_id, actor_name from public.employee_profiles as profile where profile.auth_user_id = auth.uid();
  if actor_id is null then
    raise exception using errcode = '42501', message = 'active employee profile required';
  end if;
  select project.payload into project_payload
    from public.projects as project
    where project.record_key = p_project_id
    for update;
  if project_payload is null then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  if not private.project_has_valid_saved_contract(project_payload) then
    raise exception using errcode = '22023', message = 'complete saved original contract required';
  end if;
  contract_total := (project_payload->>'originalContractTaxInclusiveAmount')::numeric;
  for plan_row in
    select change.payload
      from public.project_contract_changes as change
      where change.status <> 'deleted'
        and change.payload->>'projectId' = p_project_id
        and coalesce(change.payload->>'statusCode', 'active') not in ('void', 'deleted')
      for update
  loop
    if coalesce(plan_row.payload->>'taxInclusiveAmount', '') !~ '^\d+$'
      or coalesce(plan_row.payload->>'changeType', '') not in ('increase', 'decrease')
    then
      raise exception using errcode = '22023', message = 'invalid active contract change';
    end if;
    contract_total := contract_total + case when plan_row.payload->>'changeType' = 'increase' then 1 else -1 end * (plan_row.payload->>'taxInclusiveAmount')::numeric;
  end loop;
  if contract_total <= 0 or contract_total <> trunc(contract_total) then
    raise exception using errcode = '22023', message = 'adjusted contract amount must be a positive integer yen value';
  end if;

  perform 1 from public.project_payment_plans as plan
    where plan.payload->>'projectId' = p_project_id for update;
  perform 1 from public.project_receipts as receipt
    where receipt.payload->>'projectId' = p_project_id for update;

  select coalesce(array_agg(distinct receipt.payload->>'planId'), array[]::text[])
    into locked_ids
    from public.project_receipts as receipt
    where receipt.status <> 'deleted'
      and receipt.payload->>'projectId' = p_project_id
      and coalesce(receipt.payload->>'statusCode', 'active') not in ('void', 'deleted')
      and coalesce(receipt.payload->>'planId', '') <> '';

  for submitted_plan in select value from jsonb_array_elements(p_plans)
  loop
    if jsonb_typeof(submitted_plan) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'each payment plan must be an object';
    end if;
    plan_id := btrim(coalesce(submitted_plan->>'planId', ''));
    plan_name := btrim(coalesce(submitted_plan->>'name', ''));
    due_date_text := btrim(coalesce(submitted_plan->>'dueDate', ''));
    weight_text := btrim(coalesce(submitted_plan->>'allocationWeight', ''));
    amount_text := btrim(coalesce(submitted_plan->>'plannedTaxInclusiveAmount', ''));
    if plan_id = '' or plan_id = any(submitted_ids) then
      raise exception using errcode = '22023', message = 'planId is required and must be unique';
    end if;
    if coalesce(submitted_plan->>'projectId', '') <> p_project_id then
      raise exception using errcode = '22023', message = 'payment plan projectId mismatch';
    end if;
    if plan_name = '' or length(plan_name) > 80 then
      raise exception using errcode = '22023', message = 'payment plan name is required and must not exceed 80 characters';
    end if;
    if coalesce(submitted_plan->>'installmentOrder', '') !~ '^\d+$' then
      raise exception using errcode = '22023', message = 'installmentOrder must be an integer';
    end if;
    plan_order := (submitted_plan->>'installmentOrder')::integer;
    if plan_order < 1 or plan_order > plan_count or plan_order = any(submitted_orders) then
      raise exception using errcode = '22023', message = 'installmentOrder must be continuous and unique';
    end if;
    if weight_text !~ '^\d+(\.\d{1,2})?$' then
      raise exception using errcode = '22023', message = 'allocationWeight must have at most two decimal places';
    end if;
    weight := weight_text::numeric;
    if weight < 0 or weight > 100 then
      raise exception using errcode = '22023', message = 'allocationWeight must be between 0 and 100';
    end if;
    if amount_text !~ '^\d+$' then
      raise exception using errcode = '22023', message = 'plannedTaxInclusiveAmount must be a non-negative integer yen value';
    end if;
    amount := amount_text::bigint;
    if due_date_text !~ '^\d{4}-\d{2}-\d{2}$'
      or to_char(to_date(due_date_text, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> due_date_text
    then
      raise exception using errcode = '22023', message = 'dueDate must be a valid date';
    end if;
    if exists (
      select 1 from public.project_payment_plans as existing_plan
      where existing_plan.record_key = plan_id
        and coalesce(existing_plan.payload->>'projectId', '') <> p_project_id
    ) then
      raise exception using errcode = '23514', message = 'payment plan belongs to another project';
    end if;
    submitted_ids := array_append(submitted_ids, plan_id);
    submitted_orders := array_append(submitted_orders, plan_order);
    weight_total := weight_total + weight;
    amount_total := amount_total + amount;
  end loop;
  if weight_total <> 100 then
    raise exception using errcode = '22023', message = 'payment plan allocation weights must total 100 percent';
  end if;
  if amount_total <> contract_total then
    raise exception using errcode = '22023', message = 'payment plan amounts must equal adjusted contract amount';
  end if;
  if (select count(distinct value) from unnest(submitted_orders) as value) <> plan_count
    or (select min(value) from unnest(submitted_orders) as value) <> 1
    or (select max(value) from unnest(submitted_orders) as value) <> plan_count
  then
    raise exception using errcode = '22023', message = 'installmentOrder must be continuous from 1';
  end if;

  foreach plan_id in array locked_ids
  loop
    select plan.payload into current_plan
      from public.project_payment_plans as plan
      where plan.record_key = plan_id
        and plan.status <> 'deleted'
        and plan.payload->>'projectId' = p_project_id;
    if current_plan is null then
      raise exception using errcode = '23503', message = 'receipt links to a missing payment plan';
    end if;
    select value into submitted_plan from jsonb_array_elements(p_plans) where value->>'planId' = plan_id;
    if submitted_plan is null then
      raise exception using errcode = '23503', message = 'received payment plan cannot be deleted';
    end if;
    if (submitted_plan->>'allocationWeight')::numeric <> (current_plan->>'allocationWeight')::numeric
      or (submitted_plan->>'plannedTaxInclusiveAmount')::bigint <> (current_plan->>'plannedTaxInclusiveAmount')::bigint
    then
      raise exception using errcode = '23514', message = 'received payment plan amount and allocation weight are locked';
    end if;
  end loop;

  update public.project_payment_plans as plan
    set status = 'deleted',
        payload = plan.payload || jsonb_build_object('statusCode', 'deleted', 'updatedById', actor_id, 'updatedByName', actor_name, 'updatedAt', clock_timestamp()),
        updated_by_employee_id = actor_id,
        updated_by_employee_name = actor_name
    where plan.status <> 'deleted'
      and plan.payload->>'projectId' = p_project_id
      and not (plan.record_key = any(submitted_ids));

  for submitted_plan in select value from jsonb_array_elements(p_plans) order by (value->>'installmentOrder')::integer
  loop
    plan_id := submitted_plan->>'planId';
    select plan.payload into current_plan from public.project_payment_plans as plan where plan.record_key = plan_id;
    saved_payload := submitted_plan || jsonb_build_object(
      'statusCode', 'active',
      'updatedById', actor_id,
      'updatedByName', actor_name,
      'updatedAt', clock_timestamp()
    );
    if current_plan is null then
      saved_payload := saved_payload || jsonb_build_object('createdById', actor_id, 'createdByName', actor_name, 'createdAt', clock_timestamp());
    else
      saved_payload := saved_payload || jsonb_build_object(
        'createdById', coalesce(current_plan->>'createdById', actor_id),
        'createdByName', coalesce(current_plan->>'createdByName', actor_name),
        'createdAt', coalesce(current_plan->>'createdAt', clock_timestamp()::text)
      );
    end if;
    insert into public.project_payment_plans (
      record_key, payload, created_by_employee_id, created_by_employee_name,
      updated_by_employee_id, updated_by_employee_name, status
    ) values (
      plan_id, saved_payload, actor_id, actor_name,
      actor_id, actor_name, 'active'
    )
    on conflict (record_key) do update set
      payload = excluded.payload,
      updated_by_employee_id = excluded.updated_by_employee_id,
      updated_by_employee_name = excluded.updated_by_employee_name,
      status = 'active'
    where coalesce(public.project_payment_plans.payload->>'projectId', '') = p_project_id;
    if not found then
      raise exception using errcode = '23514', message = 'payment plan belongs to another project';
    end if;
  end loop;

  return (
    select coalesce(jsonb_agg(plan.payload order by (plan.payload->>'installmentOrder')::integer), '[]'::jsonb)
      from public.project_payment_plans as plan
      where plan.status = 'active'
        and plan.payload->>'projectId' = p_project_id
        and coalesce(plan.payload->>'statusCode', 'active') = 'active'
  );
end;
$$;

revoke all on function public.replace_project_payment_plan_secure(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.replace_project_payment_plan_secure(text, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';

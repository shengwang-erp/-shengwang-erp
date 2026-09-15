-- Serialize contract saves with all downstream revenue writes through the
-- owning project row. This closes the race between saving a contract and
-- creating the first change, payment plan, or receipt.

create or replace function private.lock_revenue_project_row()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  project_id_value text;
  previous_project_id text;
  project_payload jsonb;
begin
  project_id_value := btrim(coalesce(new.payload->>'projectId', ''));
  if project_id_value = '' then
    raise exception using
      errcode = '22023',
      message = 'revenue record projectId is required';
  end if;

  if tg_op = 'UPDATE' then
    previous_project_id := btrim(coalesce(old.payload->>'projectId', ''));
    if previous_project_id <> ''
      and previous_project_id is distinct from project_id_value
    then
      raise exception using
        errcode = '23514',
        message = 'revenue record project cannot be changed';
    end if;
  end if;

  select project.payload
    into project_payload
    from public.projects as project
    where project.record_key = project_id_value
      and project.status = 'active'
    for update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'revenue record project not found';
  end if;

  if coalesce(new.status, 'active') <> 'deleted'
    and coalesce(new.payload->>'statusCode', 'active') not in ('void', 'deleted')
    and not private.project_has_valid_saved_contract(project_payload)
  then
    raise exception using
      errcode = '23514',
      message = 'complete saved original contract required';
  end if;


  return new;
end;
$$;

revoke all on function private.lock_revenue_project_row()
  from public, anon, authenticated, service_role;

drop trigger if exists project_contract_changes_lock_project
  on public.project_contract_changes;
create trigger project_contract_changes_lock_project
before insert or update on public.project_contract_changes
for each row execute function private.lock_revenue_project_row();

drop trigger if exists project_payment_plans_lock_project
  on public.project_payment_plans;
create trigger project_payment_plans_lock_project
before insert or update on public.project_payment_plans
for each row execute function private.lock_revenue_project_row();

drop trigger if exists project_receipts_lock_project
  on public.project_receipts;
create trigger project_receipts_lock_project
before insert or update on public.project_receipts
for each row execute function private.lock_revenue_project_row();

-- The historical migration used to insert its opening receipt before updating
-- the original contract. Now that every active receipt correctly blocks a first
-- contract save, update the contract first and insert the receipt second. Both
-- operations remain atomic inside this RPC.
create or replace function public.migrate_legacy_project_contract_secure(
  p_project_id text,
  p_expected_legacy_contract jsonb,
  p_opening_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  current_payload jsonb;
  next_payload jsonb;
  expected_contract_amount numeric;
  expected_paid_amount numeric;
  deterministic_receipt_id text;
  unknown_key text;
  receipt_row public.project_receipts%rowtype;
  already_migrated boolean;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.update')
    or not public.can_current_employee_view_project_financials()
  then
    raise exception using
      errcode = '42501',
      message = 'project financial write permission required';
  end if;

  select project.payload
    into current_payload
    from public.projects as project
    where project.record_key = p_project_id
      and project.status = 'active'
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if jsonb_typeof(p_expected_legacy_contract) is distinct from 'object'
    or not (p_expected_legacy_contract ?& array['contractAmount', 'paidAmount'])
    or (
      select count(*) from jsonb_object_keys(p_expected_legacy_contract)
    ) <> 2
    or jsonb_typeof(p_expected_legacy_contract->'contractAmount') is distinct from 'number'
    or jsonb_typeof(p_expected_legacy_contract->'paidAmount') is distinct from 'number'
  then
    raise exception using errcode = '22023', message = 'invalid legacy contract expectation';
  end if;
  expected_contract_amount := (p_expected_legacy_contract->>'contractAmount')::numeric;
  expected_paid_amount := (p_expected_legacy_contract->>'paidAmount')::numeric;
  if expected_contract_amount <= 0
    or expected_paid_amount < 0
    or expected_contract_amount <> trunc(expected_contract_amount)
    or expected_paid_amount <> trunc(expected_paid_amount)
  then
    raise exception using errcode = '22023', message = 'invalid legacy contract expectation';
  end if;

  deterministic_receipt_id := 'legacy-opening-receipt-v1:' || p_project_id;
  if expected_paid_amount = 0 then
    if p_opening_receipt is not null then
      raise exception using
        errcode = '22023',
        message = 'zero paid migration requires null opening receipt';
    end if;
  else
    if jsonb_typeof(p_opening_receipt) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'invalid opening receipt';
    end if;
    select submitted.key
      into unknown_key
      from jsonb_object_keys(p_opening_receipt) as submitted(key)
      where submitted.key <> all (array[
        'receiptId', 'projectId', 'receiptType', 'taxInclusiveAmount',
        'statusCode', 'sourceCode'
      ]::text[])
      limit 1;
    if unknown_key is not null
      or p_opening_receipt->>'receiptId' is distinct from deterministic_receipt_id
      or p_opening_receipt->>'projectId' is distinct from p_project_id
      or p_opening_receipt->>'receiptType' is distinct from 'opening_balance'
      or jsonb_typeof(p_opening_receipt->'taxInclusiveAmount') is distinct from 'number'
      or (p_opening_receipt->>'taxInclusiveAmount')::numeric <> expected_paid_amount
      or p_opening_receipt->>'statusCode' is distinct from 'active'
      or p_opening_receipt->>'sourceCode' is distinct from 'legacy_contract_migration'
    then
      raise exception using errcode = '22023', message = 'invalid opening receipt';
    end if;
  end if;

  already_migrated :=
    jsonb_typeof(current_payload->'contractRevenueSchemaVersion') = 'number'
    and (current_payload->>'contractRevenueSchemaVersion')::numeric >= 1;

  if already_migrated then
    if current_payload->'originalContractTaxExclusiveAmount'
        is distinct from to_jsonb(expected_contract_amount)
      or current_payload->'originalContractTaxRate' is distinct from '0'::jsonb
      or current_payload->'originalContractTaxAmount' is distinct from '0'::jsonb
      or current_payload->'originalContractTaxInclusiveAmount'
        is distinct from to_jsonb(expected_contract_amount)
    then
      raise exception using errcode = '40001', message = 'legacy project contract changed';
    end if;
  else
    if current_payload->'contractAmount'
        is distinct from p_expected_legacy_contract->'contractAmount'
      or current_payload->'paidAmount'
        is distinct from p_expected_legacy_contract->'paidAmount'
    then
      raise exception using errcode = '40001', message = 'legacy project contract changed';
    end if;

    select employee.*
      into actor
      from public.employee_profiles as employee
      where employee.auth_user_id = auth.uid()
        and employee.deleted_at is null
        and employee.employment_status = '在职'
        and employee.account_status = 'active'
        and employee.must_change_password = false;

    next_payload := current_payload
      - array['contractAmount', 'paidAmount', 'paymentProgress', 'paymentStatus']::text[]
      || jsonb_build_object(
        'contractRevenueSchemaVersion', 1,
        'originalContractTaxExclusiveAmount', expected_contract_amount,
        'originalContractTaxRate', 0,
        'originalContractTaxAmount', 0,
        'originalContractTaxInclusiveAmount', expected_contract_amount,
        'contractConfirmationStatus', 'historical_migrated_confirmed',
        'needsManualReview', true
      );

    update public.projects
      set payload = next_payload,
          updated_by_employee_id = actor.id::text,
          updated_by_employee_name = actor.name
      where record_key = p_project_id;
    current_payload := next_payload;

    if expected_paid_amount > 0 then
      insert into public.project_receipts (
        record_key,
        payload,
        status,
        created_by_employee_id,
        created_by_employee_name,
        updated_by_employee_id,
        updated_by_employee_name
      ) values (
        deterministic_receipt_id,
        p_opening_receipt,
        'active',
        actor.id::text,
        actor.name,
        actor.id::text,
        actor.name
      )
      on conflict (record_key) do nothing;
    end if;
  end if;

  if expected_paid_amount = 0 then
    if exists (
      select 1
      from public.project_receipts as receipt
      where receipt.record_key = deterministic_receipt_id
    ) then
      raise exception using errcode = '40001', message = 'opening receipt conflict';
    end if;
  else
    select receipt.*
      into receipt_row
      from public.project_receipts as receipt
      where receipt.record_key = deterministic_receipt_id;
    if not found
      or receipt_row.status <> 'active'
      or receipt_row.payload->>'receiptId' is distinct from deterministic_receipt_id
      or receipt_row.payload->>'projectId' is distinct from p_project_id
      or jsonb_typeof(receipt_row.payload->'taxInclusiveAmount') is distinct from 'number'
      or (receipt_row.payload->>'taxInclusiveAmount')::numeric <> expected_paid_amount
      or receipt_row.payload->>'statusCode' is distinct from 'active'
      or receipt_row.payload->>'sourceCode'
        is distinct from 'legacy_contract_migration'
      or receipt_row.payload->>'receiptType' is distinct from 'opening_balance'
    then
      raise exception using errcode = '40001', message = 'opening receipt conflict';
    end if;
  end if;

  return current_payload;
end;
$$;

revoke all on function public.migrate_legacy_project_contract_secure(text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.migrate_legacy_project_contract_secure(text, jsonb, jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';

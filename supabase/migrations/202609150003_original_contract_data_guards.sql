-- Preserve the original contract once downstream revenue activity exists.
-- This trigger protects the table boundary as well as the normal secure RPC path.

create or replace function private.enforce_saved_original_contract_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
declare
  field_name text;
  contract_changed boolean := false;
begin
  foreach field_name in array array[
    'contractRevenueSchemaVersion',
    'contractRevenueSetupStatus',
    'originalContractTaxExclusiveAmount',
    'originalContractTaxRate',
    'originalContractTaxAmount',
    'originalContractTaxInclusiveAmount'
  ]::text[] loop
    if old.payload->field_name is distinct from new.payload->field_name then
      contract_changed := true;
      exit;
    end if;
  end loop;

  if not contract_changed then
    return new;
  end if;

  if old.payload->>'contractRevenueSetupStatus' = 'configured'
    and new.payload->>'contractRevenueSetupStatus' is distinct from 'configured'
  then
    raise exception using
      errcode = '23514',
      message = 'saved original contract cannot be cleared';
  end if;

  if new.payload->>'contractRevenueSetupStatus' = 'configured'
    and not private.project_has_valid_saved_contract(new.payload)
  then
    raise exception using
      errcode = '23514',
      message = 'complete valid original contract required';
  end if;

  if (
      exists (
        select 1
          from public.project_contract_changes as change
          where change.status <> 'deleted'
            and change.payload->>'projectId' = old.record_key
            and coalesce(change.payload->>'statusCode', 'active') not in ('void', 'deleted')
      )
      or exists (
        select 1
          from public.project_payment_plans as plan
          where plan.status <> 'deleted'
            and plan.payload->>'projectId' = old.record_key
            and coalesce(plan.payload->>'statusCode', 'active') not in ('void', 'deleted')
      )
      or exists (
        select 1
          from public.project_receipts as receipt
          where receipt.status <> 'deleted'
            and receipt.payload->>'projectId' = old.record_key
            and coalesce(receipt.payload->>'statusCode', 'active') not in ('void', 'deleted')
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'original contract with revenue activity cannot be changed directly';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_saved_original_contract_guard()
  from public, anon, authenticated, service_role;

drop trigger if exists projects_saved_original_contract_guard on public.projects;
create trigger projects_saved_original_contract_guard
before update of payload on public.projects
for each row execute function private.enforce_saved_original_contract_guard();

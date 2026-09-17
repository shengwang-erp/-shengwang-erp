-- Allow high-frequency manual project costs to omit descriptive text while
-- retaining server-authored actor identity and timestamps.

begin;

alter table public.project_cost_manual_entries
  drop constraint project_cost_manual_entries_text_check;

alter table public.project_cost_manual_entries
  add constraint project_cost_manual_entries_text_check check (
    description = btrim(description) and char_length(description) <= 2000
    and operator = btrim(operator) and char_length(operator) <= 500
    and reason = btrim(reason) and char_length(reason) <= 2000
    and created_by_name = btrim(created_by_name)
    and char_length(created_by_name) between 1 and 500
  );

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
    p_entry->'description', true, 2000
  );
  operator_value := private.project_cost_safe_text(
    p_entry->'operator', true, 500
  );
  reason_value := private.project_cost_safe_text(
    p_entry->'reason', true, 2000
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

revoke all on function public.create_manual_project_cost_secure(uuid, jsonb)
  from public, anon;
grant execute on function public.create_manual_project_cost_secure(uuid, jsonb)
  to authenticated, service_role;

commit;

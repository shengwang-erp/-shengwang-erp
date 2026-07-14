-- RPC-only project access, fixed financial authorization, and transactional
-- legacy contract migration. Ordered migrations are the canonical schema path.

create or replace function public.can_current_employee_view_project_financials()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and (
        employee.department in ('设计部', '财务部')
        or employee.position = '社长'
        or employee.employee_number = 'SW-000'
      )
  );
$$;

create or replace function private.project_financial_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'contractAmount','paidAmount','paymentProgress','paymentStatus',
    'revenuePaymentStatus','contractRevenueSchemaVersion',
    'contractRevenueSetupStatus','contractConfirmationStatus',
    'originalContractTaxExclusiveAmount','originalContractTaxRate',
    'originalContractTaxAmount','originalContractTaxInclusiveAmount',
    'contractConfirmedById','contractConfirmedByName','contractConfirmedAt',
    'needsManualReview','adjustedTaxExclusiveAmount','adjustedTaxAmount',
    'adjustedTaxInclusiveAmount','totalReceivedTaxInclusiveAmount',
    'outstandingTaxInclusiveAmount','overpaidTaxInclusiveAmount',
    'profitAnchorTaxExclusiveAmount','allocationStatus','allocationReason',
    'lockedStages','unlockedStages','lockedPlannedTaxInclusiveAmount',
    'remainingAssignableTaxInclusiveAmount','unallocatedTaxInclusiveAmount',
    'lockedAmountExcess'
  ]::text[];
$$;

create or replace function private.next_project_record_key()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  next_number bigint;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.projects.record_key', 0)
  );
  select coalesce(max(
      (pg_catalog.regexp_match(project.record_key, '^P([0-9]+)$'))[1]::bigint
    ), 0) + 1
    into next_number
    from public.projects as project
    where project.record_key ~ '^P[0-9]+$';
  return 'P' || pg_catalog.lpad(next_number::text, 3, '0');
end;
$$;

create or replace function private.validate_project_payload(p_payload jsonb)
returns void
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  text_field text;
  coordinate_field text;
  normalized_address text;
  normalized_snapshot text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'project payload must be an object';
  end if;

  if jsonb_typeof(p_payload->'projectName') is distinct from 'string'
    or btrim(normalize(p_payload->>'projectName', NFKC)) = ''
  then
    raise exception using errcode = '22023', message = 'project name is required';
  end if;

  if jsonb_typeof(p_payload->'status') is distinct from 'string'
    or p_payload->>'status' not in (
      '报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消'
    )
  then
    raise exception using errcode = '22023', message = 'invalid project status';
  end if;

  foreach text_field in array array[
    'customerName', 'address', 'locationConfirmedAt',
    'locationAddressSnapshot', 'designAssigneeEmployeeId',
    'designAssigneeEmployeeNumber', 'designAssigneeName',
    'siteAssigneeEmployeeId', 'siteAssigneeEmployeeNumber',
    'siteAssigneeName', 'startDate', 'endDate', 'remark'
  ]::text[] loop
    if p_payload ? text_field
      and jsonb_typeof(p_payload->text_field) is distinct from 'string'
    then
      raise exception using
        errcode = '22023',
        message = 'invalid project field type';
    end if;
  end loop;

  foreach coordinate_field in array array['latitude', 'longitude']::text[] loop
    if p_payload ? coordinate_field
      and p_payload->coordinate_field <> 'null'::jsonb
      and jsonb_typeof(p_payload->coordinate_field) is distinct from 'number'
    then
      raise exception using
        errcode = '22023',
        message = 'invalid project coordinates';
    end if;
  end loop;

  if (p_payload ? 'latitude')
    and p_payload->'latitude' <> 'null'::jsonb
    and (p_payload->>'latitude')::numeric not between -90 and 90
  then
    raise exception using
      errcode = '22023',
      message = 'invalid project coordinates';
  end if;
  if (p_payload ? 'longitude')
    and p_payload->'longitude' <> 'null'::jsonb
    and (p_payload->>'longitude')::numeric not between -180 and 180
  then
    raise exception using
      errcode = '22023',
      message = 'invalid project coordinates';
  end if;

  if jsonb_typeof(p_payload->'attendanceRadiusMeters') is distinct from 'number'
    or (p_payload->>'attendanceRadiusMeters')::numeric <= 0
  then
    raise exception using
      errcode = '22023',
      message = 'project attendance radius must be positive';
  end if;

  if p_payload->>'status' in ('待开工', '进行中') then
    normalized_address := regexp_replace(
      btrim(normalize(p_payload->>'address', NFKC)),
      '[[:space:]]+',
      ' ',
      'g'
    );
    normalized_snapshot := regexp_replace(
      btrim(normalize(p_payload->>'locationAddressSnapshot', NFKC)),
      '[[:space:]]+',
      ' ',
      'g'
    );
    if coalesce(normalized_address, '') = ''
      or p_payload->'latitude' is null
      or p_payload->'latitude' = 'null'::jsonb
      or p_payload->'longitude' is null
      or p_payload->'longitude' = 'null'::jsonb
      or jsonb_typeof(p_payload->'locationConfirmedAt') is distinct from 'string'
      or btrim(p_payload->>'locationConfirmedAt') = ''
      or normalized_snapshot is distinct from normalized_address
    then
      raise exception using
        errcode = '22023',
        message = 'project location confirmation required';
    end if;
  end if;
end;
$$;

revoke all on function private.project_financial_payload_keys() from public, anon, authenticated, service_role;
revoke all on function private.next_project_record_key() from public, anon, authenticated, service_role;
revoke all on function private.validate_project_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.can_current_employee_view_project_financials() from public, anon, authenticated, service_role;
grant execute on function public.can_current_employee_view_project_financials() to authenticated, service_role;

create or replace function public.list_projects_secure()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.view')
  then
    raise exception using
      errcode = '42501',
      message = 'project view permission required';
  end if;

  return query
  select case
    when public.can_current_employee_view_project_financials()
      then project.payload
    else project.payload - private.project_financial_payload_keys()
  end
  from public.projects as project
  where project.status <> 'deleted'
  order by project.updated_at desc, project.record_key;
end;
$$;

create or replace function public.create_project_secure(p_project jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  selected_employee public.employee_profiles%rowtype;
  unknown_key text;
  submitted_id_text text;
  submitted_id uuid;
  next_record_key text;
  next_payload jsonb;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.create')
  then
    raise exception using
      errcode = '42501',
      message = 'project create permission required';
  end if;
  if jsonb_typeof(p_project) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'project payload must be an object';
  end if;

  select submitted.key
    into unknown_key
    from jsonb_object_keys(p_project) as submitted(key)
    where submitted.key <> all (array[
      'projectName', 'customerName', 'address', 'latitude', 'longitude',
      'attendanceRadiusMeters', 'locationConfirmedAt',
      'locationAddressSnapshot', 'status', 'designAssigneeEmployeeId',
      'designAssigneeEmployeeNumber', 'designAssigneeName',
      'siteAssigneeEmployeeId', 'siteAssigneeEmployeeNumber',
      'siteAssigneeName', 'startDate', 'endDate', 'remark'
    ]::text[])
    limit 1;
  if unknown_key is not null then
    raise exception using errcode = '22023', message = 'unsupported project field';
  end if;

  perform private.validate_project_payload(p_project);
  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false;

  next_payload := p_project;

  submitted_id_text := coalesce(p_project->>'designAssigneeEmployeeId', '');
  if submitted_id_text = '' then
    next_payload := next_payload || jsonb_build_object(
      'designAssigneeEmployeeId', '',
      'designAssigneeEmployeeNumber', '',
      'designAssigneeName', ''
    );
  else
    begin
      submitted_id := submitted_id_text::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'project assignee unavailable';
    end;
    select employee.*
      into selected_employee
      from public.employee_profiles as employee
      where employee.id = submitted_id
        and employee.deleted_at is null
        and employee.employment_status = '在职'
        and employee.account_status = 'active'
        and employee.department = '设计部';
    if not found then
      raise exception using errcode = '22023', message = 'project assignee unavailable';
    end if;
    next_payload := next_payload || jsonb_build_object(
      'designAssigneeEmployeeId', selected_employee.id::text,
      'designAssigneeEmployeeNumber', selected_employee.employee_number,
      'designAssigneeName', selected_employee.name
    );
  end if;

  submitted_id_text := coalesce(p_project->>'siteAssigneeEmployeeId', '');
  if submitted_id_text = '' then
    next_payload := next_payload || jsonb_build_object(
      'siteAssigneeEmployeeId', '',
      'siteAssigneeEmployeeNumber', '',
      'siteAssigneeName', ''
    );
  else
    begin
      submitted_id := submitted_id_text::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'project assignee unavailable';
    end;
    select employee.*
      into selected_employee
      from public.employee_profiles as employee
      where employee.id = submitted_id
        and employee.deleted_at is null
        and employee.employment_status = '在职'
        and employee.account_status = 'active'
        and employee.department = '工程部';
    if not found then
      raise exception using errcode = '22023', message = 'project assignee unavailable';
    end if;
    next_payload := next_payload || jsonb_build_object(
      'siteAssigneeEmployeeId', selected_employee.id::text,
      'siteAssigneeEmployeeNumber', selected_employee.employee_number,
      'siteAssigneeName', selected_employee.name
    );
  end if;

  next_record_key := private.next_project_record_key();
  next_payload := next_payload || jsonb_build_object(
    'projectId', next_record_key,
    'contractRevenueSetupStatus', 'not_started'
  );
  perform private.validate_project_payload(next_payload);

  insert into public.projects (
    record_key,
    payload,
    status,
    created_by_employee_id,
    created_by_employee_name,
    updated_by_employee_id,
    updated_by_employee_name
  ) values (
    next_record_key,
    next_payload,
    'active',
    actor.id::text,
    actor.name,
    actor.id::text,
    actor.name
  );

  return case
    when public.can_current_employee_view_project_financials()
      then next_payload
    else next_payload - private.project_financial_payload_keys()
  end;
end;
$$;

create or replace function public.update_project_secure(
  p_project_id text,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  selected_employee public.employee_profiles%rowtype;
  current_payload jsonb;
  effective_patch jsonb;
  next_payload jsonb;
  unknown_key text;
  text_field text;
  amount_field text;
  submitted_id_text text;
  current_id_text text;
  submitted_id uuid;
  target_confirmation_status text;
  confirmation_transition boolean := false;
  confirmation_metadata_requested boolean;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.update')
  then
    raise exception using
      errcode = '42501',
      message = 'project update permission required';
  end if;
  if p_project_id is null or btrim(p_project_id) = '' then
    raise exception using errcode = '22023', message = 'project id is required';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'project payload must be an object';
  end if;

  -- Check the exhaustive financial set before the narrower writable allowlist:
  -- non-whitelist callers may not add, change, or restore any projected key.
  if not public.can_current_employee_view_project_financials()
    and p_patch ?| private.project_financial_payload_keys()
  then
    raise exception using
      errcode = '42501',
      message = 'project financial write permission required';
  end if;

  select submitted.key
    into unknown_key
    from jsonb_object_keys(p_patch) as submitted(key)
    where submitted.key <> all (array[
      'projectName', 'customerName', 'address', 'latitude', 'longitude',
      'attendanceRadiusMeters', 'locationConfirmedAt',
      'locationAddressSnapshot', 'status', 'designAssigneeEmployeeId',
      'designAssigneeEmployeeNumber', 'designAssigneeName',
      'siteAssigneeEmployeeId', 'siteAssigneeEmployeeNumber',
      'siteAssigneeName', 'startDate', 'endDate', 'remark',
      'contractRevenueSchemaVersion', 'contractRevenueSetupStatus',
      'contractConfirmationStatus', 'originalContractTaxExclusiveAmount',
      'originalContractTaxRate', 'originalContractTaxAmount',
      'originalContractTaxInclusiveAmount', 'needsManualReview',
      'contractConfirmedById', 'contractConfirmedByName',
      'contractConfirmedAt'
    ]::text[])
    limit 1;
  if unknown_key is not null or p_patch ? 'projectId' then
    raise exception using errcode = '22023', message = 'unsupported project field';
  end if;

  foreach text_field in array array[
    'projectName', 'customerName', 'address', 'locationConfirmedAt',
    'locationAddressSnapshot', 'status', 'designAssigneeEmployeeId',
    'designAssigneeEmployeeNumber', 'designAssigneeName',
    'siteAssigneeEmployeeId', 'siteAssigneeEmployeeNumber',
    'siteAssigneeName', 'startDate', 'endDate', 'remark'
  ]::text[] loop
    if p_patch ? text_field
      and jsonb_typeof(p_patch->text_field) is distinct from 'string'
    then
      raise exception using errcode = '22023', message = 'invalid project field type';
    end if;
  end loop;
  foreach text_field in array array['latitude', 'longitude']::text[] loop
    if p_patch ? text_field
      and p_patch->text_field <> 'null'::jsonb
      and jsonb_typeof(p_patch->text_field) is distinct from 'number'
    then
      raise exception using errcode = '22023', message = 'invalid project coordinates';
    end if;
  end loop;
  if p_patch ? 'attendanceRadiusMeters'
    and jsonb_typeof(p_patch->'attendanceRadiusMeters') is distinct from 'number'
  then
    raise exception using
      errcode = '22023',
      message = 'project attendance radius must be positive';
  end if;

  foreach amount_field in array array[
    'originalContractTaxExclusiveAmount', 'originalContractTaxRate',
    'originalContractTaxAmount', 'originalContractTaxInclusiveAmount'
  ]::text[] loop
    if p_patch ? amount_field
      and (
        jsonb_typeof(p_patch->amount_field) is distinct from 'number'
        or (p_patch->>amount_field)::numeric < 0
      )
    then
      raise exception using errcode = '22023', message = 'invalid project financial field';
    end if;
  end loop;
  if p_patch ? 'originalContractTaxRate'
    and (p_patch->>'originalContractTaxRate')::numeric > 100
  then
    raise exception using errcode = '22023', message = 'invalid project financial field';
  end if;
  if p_patch ? 'contractRevenueSchemaVersion'
    and (
      jsonb_typeof(p_patch->'contractRevenueSchemaVersion') is distinct from 'number'
      or (p_patch->>'contractRevenueSchemaVersion')::numeric < 1
      or (p_patch->>'contractRevenueSchemaVersion')::numeric
        <> trunc((p_patch->>'contractRevenueSchemaVersion')::numeric)
    )
  then
    raise exception using errcode = '22023', message = 'invalid project financial field';
  end if;
  if p_patch ? 'contractRevenueSetupStatus'
    and (
      jsonb_typeof(p_patch->'contractRevenueSetupStatus') is distinct from 'string'
      or p_patch->>'contractRevenueSetupStatus' not in ('not_started', 'configured')
    )
  then
    raise exception using errcode = '22023', message = 'invalid project financial field';
  end if;
  if p_patch ? 'contractConfirmationStatus'
    and (
      jsonb_typeof(p_patch->'contractConfirmationStatus') is distinct from 'string'
      or p_patch->>'contractConfirmationStatus' not in (
        'draft', 'confirmed', 'historical_migrated_confirmed'
      )
    )
  then
    raise exception using errcode = '22023', message = 'invalid project financial field';
  end if;
  if p_patch ? 'needsManualReview'
    and jsonb_typeof(p_patch->'needsManualReview') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'invalid project financial field';
  end if;
  foreach text_field in array array[
    'contractConfirmedById', 'contractConfirmedByName', 'contractConfirmedAt'
  ]::text[] loop
    if p_patch ? text_field
      and jsonb_typeof(p_patch->text_field) is distinct from 'string'
    then
      raise exception using errcode = '22023', message = 'invalid project financial field';
    end if;
  end loop;

  select project.payload
    into current_payload
    from public.projects as project
    where project.record_key = p_project_id
      and project.status = 'active'
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false;

  effective_patch := p_patch;

  if p_patch ? 'designAssigneeEmployeeId' then
    submitted_id_text := p_patch->>'designAssigneeEmployeeId';
    current_id_text := coalesce(current_payload->>'designAssigneeEmployeeId', '');
    if submitted_id_text = current_id_text then
      effective_patch := effective_patch || jsonb_build_object(
        'designAssigneeEmployeeId', current_id_text,
        'designAssigneeEmployeeNumber', coalesce(current_payload->>'designAssigneeEmployeeNumber', ''),
        'designAssigneeName', coalesce(current_payload->>'designAssigneeName', '')
      );
    elsif submitted_id_text = '' then
      effective_patch := effective_patch || jsonb_build_object(
        'designAssigneeEmployeeId', '',
        'designAssigneeEmployeeNumber', '',
        'designAssigneeName', ''
      );
    else
      begin
        submitted_id := submitted_id_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'project assignee unavailable';
      end;
      select employee.*
        into selected_employee
        from public.employee_profiles as employee
        where employee.id = submitted_id
          and employee.deleted_at is null
          and employee.employment_status = '在职'
          and employee.account_status = 'active'
          and employee.department = '设计部';
      if not found then
        raise exception using errcode = '22023', message = 'project assignee unavailable';
      end if;
      effective_patch := effective_patch || jsonb_build_object(
        'designAssigneeEmployeeId', selected_employee.id::text,
        'designAssigneeEmployeeNumber', selected_employee.employee_number,
        'designAssigneeName', selected_employee.name
      );
    end if;
  else
    effective_patch := effective_patch - array[
      'designAssigneeEmployeeNumber', 'designAssigneeName'
    ]::text[];
  end if;

  if p_patch ? 'siteAssigneeEmployeeId' then
    submitted_id_text := p_patch->>'siteAssigneeEmployeeId';
    current_id_text := coalesce(current_payload->>'siteAssigneeEmployeeId', '');
    if submitted_id_text = current_id_text then
      effective_patch := effective_patch || jsonb_build_object(
        'siteAssigneeEmployeeId', current_id_text,
        'siteAssigneeEmployeeNumber', coalesce(current_payload->>'siteAssigneeEmployeeNumber', ''),
        'siteAssigneeName', coalesce(current_payload->>'siteAssigneeName', '')
      );
    elsif submitted_id_text = '' then
      effective_patch := effective_patch || jsonb_build_object(
        'siteAssigneeEmployeeId', '',
        'siteAssigneeEmployeeNumber', '',
        'siteAssigneeName', ''
      );
    else
      begin
        submitted_id := submitted_id_text::uuid;
      exception when invalid_text_representation then
        raise exception using errcode = '22023', message = 'project assignee unavailable';
      end;
      select employee.*
        into selected_employee
        from public.employee_profiles as employee
        where employee.id = submitted_id
          and employee.deleted_at is null
          and employee.employment_status = '在职'
          and employee.account_status = 'active'
          and employee.department = '工程部';
      if not found then
        raise exception using errcode = '22023', message = 'project assignee unavailable';
      end if;
      effective_patch := effective_patch || jsonb_build_object(
        'siteAssigneeEmployeeId', selected_employee.id::text,
        'siteAssigneeEmployeeNumber', selected_employee.employee_number,
        'siteAssigneeName', selected_employee.name
      );
    end if;
  else
    effective_patch := effective_patch - array[
      'siteAssigneeEmployeeNumber', 'siteAssigneeName'
    ]::text[];
  end if;

  confirmation_metadata_requested := p_patch ?| array[
    'contractConfirmedById', 'contractConfirmedByName', 'contractConfirmedAt'
  ]::text[];
  target_confirmation_status := case
    when p_patch ? 'contractConfirmationStatus'
      then p_patch->>'contractConfirmationStatus'
    else current_payload->>'contractConfirmationStatus'
  end;
  confirmation_transition :=
    p_patch ? 'contractConfirmationStatus'
    and target_confirmation_status = 'confirmed'
    and (
      current_payload->>'contractConfirmationStatus' = 'draft'
      or (
        current_payload->>'contractConfirmationStatus' = 'historical_migrated_confirmed'
        and current_payload->'needsManualReview' = 'true'::jsonb
      )
    );

  if confirmation_metadata_requested and not confirmation_transition then
    raise exception using errcode = '22023', message = 'confirmation transition required';
  end if;
  if p_patch ? 'contractConfirmationStatus' then
    if target_confirmation_status = 'confirmed' and not confirmation_transition then
      raise exception using errcode = '22023', message = 'confirmation transition required';
    end if;
    if target_confirmation_status = 'historical_migrated_confirmed'
      or (
        current_payload->>'contractConfirmationStatus' in (
          'confirmed', 'historical_migrated_confirmed'
        )
        and target_confirmation_status <> 'confirmed'
      )
    then
      raise exception using errcode = '22023', message = 'confirmation transition required';
    end if;
  end if;

  if confirmation_transition then
    effective_patch := effective_patch || jsonb_build_object(
      'contractConfirmedById', actor.id::text,
      'contractConfirmedByName', actor.name,
      'contractConfirmedAt', clock_timestamp()
    );
  elsif p_patch ? 'contractConfirmationStatus'
    and target_confirmation_status = 'draft'
  then
    effective_patch := effective_patch - array[
      'contractConfirmedById', 'contractConfirmedByName', 'contractConfirmedAt'
    ]::text[];
  end if;

  p_patch := effective_patch;
  next_payload := current_payload || p_patch;
  perform private.validate_project_payload(next_payload);

  update public.projects
    set payload = next_payload,
        updated_by_employee_id = actor.id::text,
        updated_by_employee_name = actor.name
    where record_key = p_project_id;

  return case
    when public.can_current_employee_view_project_financials()
      then next_payload
    else next_payload - private.project_financial_payload_keys()
  end;
end;
$$;

-- Projects are reachable only through the guarded RPCs.
alter table public.projects enable row level security;
do $$
declare
  policy_name text;
begin
  for policy_name in
    select policy.policyname
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = 'projects'
  loop
    execute format('drop policy if exists %I on public.projects', policy_name);
  end loop;
end;
$$;
revoke all on table public.projects from public, anon, authenticated;
grant all on table public.projects to service_role;

-- Revenue records remain direct RLS tables, but editable sensitive grants no
-- longer participate in their authorization decision.
alter table public.project_contract_changes enable row level security;
alter table public.project_payment_plans enable row level security;
alter table public.project_receipts enable row level security;

do $$
declare
  revenue_table text;
  policy_name text;
begin
  foreach revenue_table in array array[
    'project_contract_changes',
    'project_payment_plans',
    'project_receipts'
  ]::text[] loop
    for policy_name in
      select policy.policyname
      from pg_catalog.pg_policies as policy
      where policy.schemaname = 'public'
        and policy.tablename = revenue_table
    loop
      execute format(
        'drop policy if exists %I on public.%I',
        policy_name,
        revenue_table
      );
    end loop;
  end loop;
end;
$$;

drop trigger if exists enforce_project_contract_changes_status_permission
  on public.project_contract_changes;
drop trigger if exists enforce_project_payment_plans_status_permission
  on public.project_payment_plans;
drop trigger if exists enforce_project_receipts_status_permission
  on public.project_receipts;

revoke all on table public.project_contract_changes from public, anon, authenticated;
grant select, insert, update on table public.project_contract_changes to authenticated;
grant all on table public.project_contract_changes to service_role;
revoke all on table public.project_payment_plans from public, anon, authenticated;
grant select, insert, update on table public.project_payment_plans to authenticated;
grant all on table public.project_payment_plans to service_role;
revoke all on table public.project_receipts from public, anon, authenticated;
grant select, insert, update on table public.project_receipts to authenticated;
grant all on table public.project_receipts to service_role;

create policy "project_contract_changes authenticated select"
on public.project_contract_changes
for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.view')
  and public.can_current_employee_view_project_financials()
);
create policy "project_contract_changes authenticated insert"
on public.project_contract_changes
for insert to authenticated
with check (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
  and status = 'active'
);
create policy "project_contract_changes authenticated update"
on public.project_contract_changes
for update to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
)
with check (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
  and status = 'active'
);

create policy "project_payment_plans authenticated select"
on public.project_payment_plans
for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.view')
  and public.can_current_employee_view_project_financials()
);
create policy "project_payment_plans authenticated insert"
on public.project_payment_plans
for insert to authenticated
with check (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
  and status = 'active'
);
create policy "project_payment_plans authenticated update"
on public.project_payment_plans
for update to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
)
with check (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
  and status = 'active'
);

create policy "project_receipts authenticated select"
on public.project_receipts
for select to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.view')
  and public.can_current_employee_view_project_financials()
);
create policy "project_receipts authenticated insert"
on public.project_receipts
for insert to authenticated
with check (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
  and status = 'active'
);
create policy "project_receipts authenticated update"
on public.project_receipts
for update to authenticated
using (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
)
with check (
  public.is_current_employee_active()
  and public.has_current_permission('module.projects.update')
  and public.can_current_employee_view_project_financials()
  and status = 'active'
);

-- Remove forbidden persisted grants once and record only a safe aggregate.
do $$
declare
  deleted_count bigint := 0;
begin
  delete from public.permission_grants as grant_row
  where grant_row.permission_key in (
      'sensitive.contract_amount_view',
      'sensitive.contract_amount_update'
    )
    and not (
      (
        grant_row.subject_type = 'department'
        and grant_row.subject_code in ('设计部', '财务部')
      )
      or (
        grant_row.subject_type = 'position'
        and grant_row.subject_code = '社长'
      )
    );
  get diagnostics deleted_count = row_count;

  insert into public.employee_security_audit (
    actor_auth_user_id,
    action,
    safe_details
  ) values (
    null,
    'project_financial_template_grants.cleaned',
    jsonb_build_object('deletedCount', deleted_count)
  );
end;
$$;

-- Preserve the existing server-only template replacement behavior while adding
-- the fixed financial-subject guard before any lock, delete, insert, or audit.
create or replace function public.replace_permission_template_admin(
  p_subject_type text,
  p_subject_code text,
  p_permission_keys text[],
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  department_codes constant text[] := array[
    '总务部', '营业部', '事务部', '后勤部', '设计部',
    '工程部', '仓库管理部', '电商部', '采购部', '财务部'
  ]::text[];
  position_codes constant text[] := array[
    '社长', '总务部长', '营业部长', '部长', '主任',
    '主任设计师', '设计师', '仓库管理员', '工事部长', '职长',
    '大工', '中工', '小工', '会计主管', '会计'
  ]::text[];
  allowed_permissions constant text[] := array[
    'module.owner_dashboard.view',
    'module.owner_dashboard.create',
    'module.owner_dashboard.update',
    'module.owner_dashboard.delete',
    'module.projects.view',
    'module.projects.create',
    'module.projects.update',
    'module.projects.delete',
    'module.employees.view',
    'module.employees.create',
    'module.employees.update',
    'module.employees.delete',
    'module.labor.view',
    'module.labor.create',
    'module.labor.update',
    'module.labor.delete',
    'module.purchases.view',
    'module.purchases.create',
    'module.purchases.update',
    'module.purchases.delete',
    'module.inventory.view',
    'module.inventory.create',
    'module.inventory.update',
    'module.inventory.delete',
    'module.tools.view',
    'module.tools.create',
    'module.tools.update',
    'module.tools.delete',
    'module.vehicles.view',
    'module.vehicles.create',
    'module.vehicles.update',
    'module.vehicles.delete',
    'module.accounting.view',
    'module.accounting.create',
    'module.accounting.update',
    'module.accounting.delete',
    'module.salaries.view',
    'module.salaries.create',
    'module.salaries.update',
    'module.salaries.delete',
    'module.project_costs.view',
    'module.project_costs.create',
    'module.project_costs.update',
    'module.project_costs.delete',
    'module.operating_expenses.view',
    'module.operating_expenses.create',
    'module.operating_expenses.update',
    'module.operating_expenses.delete',
    'module.settings.view',
    'module.settings.create',
    'module.settings.update',
    'module.settings.delete',
    'sensitive.salary_view',
    'sensitive.salary_update',
    'sensitive.contract_amount_view',
    'sensitive.contract_amount_update',
    'sensitive.profit_view',
    'sensitive.purchase_payments_view',
    'sensitive.purchase_payments_update',
    'sensitive.employee_identity_view',
    'sensitive.employee_identity_update',
    'sensitive.owner_dashboard_full_view'
  ]::text[];
  distinct_permission_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    '{}'::jsonb
  );

  if p_subject_type not in ('department', 'position')
    or p_subject_code is null
    or (
      p_subject_type = 'department'
      and not (p_subject_code = any(department_codes))
    )
    or (
      p_subject_type = 'position'
      and not (p_subject_code = any(position_codes))
    )
    or p_permission_keys is null
    or coalesce(array_ndims(p_permission_keys), 1) <> 1
    or cardinality(p_permission_keys) > cardinality(allowed_permissions)
    or exists (
      select 1
      from unnest(p_permission_keys) as supplied(permission_key)
      where supplied.permission_key is null
        or not (supplied.permission_key = any(allowed_permissions))
    )
  then
    raise exception using errcode = '22023', message = 'invalid permission template';
  end if;

  select count(distinct permission_key)
    into distinct_permission_count
    from unnest(p_permission_keys) as supplied(permission_key);
  if cardinality(p_permission_keys) <> distinct_permission_count then
    raise exception using errcode = '22023', message = 'duplicate permission key';
  end if;

  if p_permission_keys && array[
    'sensitive.contract_amount_view',
    'sensitive.contract_amount_update'
  ]::text[]
  and not (
    (p_subject_type = 'department' and p_subject_code in ('设计部', '财务部'))
    or (p_subject_type = 'position' and p_subject_code = '社长')
  ) then
    raise exception using errcode = '22023',
      message = 'fixed project financial whitelist violation';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_subject_type || ':' || p_subject_code, 0)
  );

  delete from public.permission_grants as existing
    where existing.subject_type = p_subject_type
      and existing.subject_code = p_subject_code;

  insert into public.permission_grants (
    subject_type,
    subject_code,
    permission_key,
    created_by_auth_user_id,
    updated_by_auth_user_id
  )
  select
    p_subject_type,
    p_subject_code,
    supplied.permission_key,
    p_actor_auth_user_id,
    p_actor_auth_user_id
  from unnest(p_permission_keys) as supplied(permission_key)
  order by supplied.permission_key;

  insert into public.employee_security_audit (
    actor_auth_user_id,
    action,
    safe_details
  ) values (
    p_actor_auth_user_id,
    'permission_template.replaced',
    jsonb_build_object(
      'subjectType', p_subject_type,
      'subjectCode', p_subject_code,
      'permissionCount', cardinality(p_permission_keys)
    )
  );

  return private.permission_template_snapshot();
end;
$$;

revoke all on function public.replace_permission_template_admin(text, text, text[], uuid) from public, anon, authenticated, service_role;
grant execute on function public.replace_permission_template_admin(text, text, text[], uuid) to service_role;

create or replace function public.soft_delete_project_secure(p_project_id text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.delete')
  then
    raise exception using
      errcode = '42501',
      message = 'project delete permission required';
  end if;

  perform 1
    from public.projects as project
    where project.record_key = p_project_id
      and project.status = 'active'
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false;

  update public.projects
    set status = 'deleted',
        updated_by_employee_id = actor.id::text,
        updated_by_employee_name = actor.name
    where record_key = p_project_id;
  return p_project_id;
end;
$$;

-- Close PostgreSQL's default PUBLIC EXECUTE before granting only the intended
-- browser and service roles.
revoke all on function public.list_projects_secure() from public, anon, authenticated, service_role;
revoke all on function public.create_project_secure(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.update_project_secure(text, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.soft_delete_project_secure(text) from public, anon, authenticated, service_role;
grant execute on function public.list_projects_secure() to authenticated, service_role;
grant execute on function public.create_project_secure(jsonb) to authenticated, service_role;
grant execute on function public.update_project_secure(text, jsonb) to authenticated, service_role;
grant execute on function public.soft_delete_project_secure(text) to authenticated, service_role;

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

revoke all on function public.migrate_legacy_project_contract_secure(text, jsonb, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.migrate_legacy_project_contract_secure(text, jsonb, jsonb) to authenticated, service_role;

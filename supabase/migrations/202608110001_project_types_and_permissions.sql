-- Typed project payloads and department/position mutation guards.
-- Existing project behavior is retained behind private legacy entry points;
-- the public RPC names are replaced with strict wrappers in this transaction.

alter function private.validate_project_payload(jsonb)
  rename to validate_project_payload_before_typed_projects;
alter function public.create_project_secure(jsonb)
  rename to create_project_secure_before_typed_projects;
alter function public.update_project_secure(text, jsonb)
  rename to update_project_secure_before_typed_projects;
alter function public.soft_delete_project_secure(text)
  rename to soft_delete_project_secure_before_typed_projects;

revoke all on function private.validate_project_payload_before_typed_projects(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_project_secure_before_typed_projects(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.update_project_secure_before_typed_projects(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.soft_delete_project_secure_before_typed_projects(text)
  from public, anon, authenticated, service_role;

create or replace function private.current_employee_can_mutate_typed_project(
  p_action text
)
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
        (
          p_action in ('create', 'update')
          and (
            employee.department in ('后勤部', '财务部', '设计部', '总务部')
            or employee.position = '社长'
            or employee.employee_number = 'SW-000'
          )
        )
        or (
          p_action in ('delete', 'settlement')
          and (
            employee.department = '财务部'
            or employee.position = '社长'
            or employee.employee_number = 'SW-000'
          )
        )
      )
      and public.has_current_permission(
        case p_action
          when 'create' then 'module.projects.create'
          when 'update' then 'module.projects.update'
          when 'delete' then 'module.projects.delete'
          when 'settlement' then 'module.projects.update'
          else ''
        end
      )
  );
$$;

create or replace function private.typed_project_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'projectType', 'durationType', 'workerAssignments',
    'expectedAmount', 'lightweightSettlementStatus'
  ]::text[];
$$;

create or replace function private.validate_project_payload(p_payload jsonb)
returns void
language plpgsql
stable
set search_path = pg_catalog, private
as $$
declare
  project_type text;
  assignment jsonb;
begin
  perform private.validate_project_payload_before_typed_projects(p_payload);

  if p_payload ? 'projectType'
    and jsonb_typeof(p_payload->'projectType') is distinct from 'string'
  then
    raise exception using errcode = '22023', message = 'invalid project type';
  end if;
  project_type := coalesce(p_payload->>'projectType', 'standard');
  if project_type not in ('standard', 'small', 'miraisya') then
    raise exception using errcode = '22023', message = 'invalid project type';
  end if;

  if p_payload ? 'durationType'
    and jsonb_typeof(p_payload->'durationType') is distinct from 'string'
  then
    raise exception using errcode = '22023', message = 'invalid project duration';
  end if;
  if project_type = 'standard'
    and coalesce(p_payload->>'durationType', '') <> ''
  then
    raise exception using errcode = '22023', message = 'invalid project duration';
  end if;
  if project_type in ('small', 'miraisya')
    and coalesce(p_payload->>'durationType', '') not in ('half_day', 'full_day')
  then
    raise exception using errcode = '22023', message = 'invalid project duration';
  end if;

  if p_payload ? 'workerAssignments' then
    if jsonb_typeof(p_payload->'workerAssignments') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'invalid project workers';
    end if;
    for assignment in
      select item.value
      from jsonb_array_elements(p_payload->'workerAssignments') as item(value)
    loop
      if jsonb_typeof(assignment) is distinct from 'object'
        or (
          select array_agg(field.key order by field.key)
          from jsonb_object_keys(assignment) as field(key)
        ) is distinct from array['employeeId', 'employeeNumber', 'name']::text[]
        or jsonb_typeof(assignment->'employeeId') is distinct from 'string'
        or jsonb_typeof(assignment->'employeeNumber') is distinct from 'string'
        or jsonb_typeof(assignment->'name') is distinct from 'string'
        or btrim(assignment->>'employeeId') = ''
        or btrim(assignment->>'employeeNumber') = ''
        or btrim(assignment->>'name') = ''
      then
        raise exception using errcode = '22023', message = 'invalid project workers';
      end if;
    end loop;
  end if;

  if p_payload ? 'expectedAmount'
    and (
      jsonb_typeof(p_payload->'expectedAmount') is distinct from 'number'
      or (p_payload->>'expectedAmount')::numeric < 0
      or (p_payload->>'expectedAmount')::numeric > 9007199254740991
      or (p_payload->>'expectedAmount')::numeric
        <> trunc((p_payload->>'expectedAmount')::numeric)
    )
  then
    raise exception using errcode = '22023', message = 'invalid expected amount';
  end if;
  if project_type <> 'small'
    and coalesce((p_payload->>'expectedAmount')::numeric, 0) <> 0
  then
    raise exception using errcode = '22023', message = 'invalid expected amount';
  end if;

  if p_payload ? 'lightweightSettlementStatus'
    and jsonb_typeof(p_payload->'lightweightSettlementStatus') is distinct from 'string'
  then
    raise exception using errcode = '22023', message = 'invalid settlement status';
  end if;
  if project_type = 'standard'
    and coalesce(p_payload->>'lightweightSettlementStatus', '') <> ''
  then
    raise exception using errcode = '22023', message = 'invalid settlement status';
  end if;
  if project_type in ('small', 'miraisya')
    and coalesce(p_payload->>'lightweightSettlementStatus', '')
      not in ('unsettled', 'settled')
  then
    raise exception using errcode = '22023', message = 'invalid settlement status';
  end if;

  if project_type = 'miraisya'
    and p_payload->>'customerName' is distinct from '株式会社未来舎サポート'
  then
    raise exception using errcode = '22023', message = 'invalid Miraisya customer';
  end if;
end;
$$;

create or replace function public.create_project_secure(p_project jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  unknown_key text;
  project_type text;
  normalized_payload jsonb;
  legacy_payload jsonb;
  created_payload jsonb;
  created_project_id text;
begin
  if not private.current_employee_can_mutate_typed_project('create') then
    raise exception using errcode = '42501', message = 'project create permission required';
  end if;
  if jsonb_typeof(p_project) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'project payload must be an object';
  end if;

  select submitted.key
    into unknown_key
    from jsonb_object_keys(p_project) as submitted(key)
    where submitted.key <> all (array[
      'projectType', 'projectName', 'customerName', 'address', 'latitude',
      'longitude', 'attendanceRadiusMeters', 'locationConfirmedAt',
      'locationAddressSnapshot', 'status', 'designAssigneeEmployeeId',
      'designAssigneeEmployeeNumber', 'designAssigneeName',
      'siteAssigneeEmployeeId', 'siteAssigneeEmployeeNumber',
      'siteAssigneeName', 'durationType', 'workerAssignments',
      'expectedAmount', 'lightweightSettlementStatus',
      'startDate', 'endDate', 'remark'
    ]::text[])
    limit 1;
  if unknown_key is not null then
    raise exception using errcode = '22023', message = 'unsupported project field';
  end if;

  perform private.validate_project_payload(p_project);
  project_type := coalesce(p_project->>'projectType', 'standard');
  normalized_payload := p_project || jsonb_build_object(
    'projectType', project_type,
    'durationType', case
      when p_project ? 'durationType' then p_project->'durationType'
      when project_type in ('small', 'miraisya') then to_jsonb('full_day'::text)
      else to_jsonb(''::text)
    end,
    'workerAssignments', case
      when p_project ? 'workerAssignments' then p_project->'workerAssignments'
      else '[]'::jsonb
    end,
    'expectedAmount', case
      when p_project ? 'expectedAmount' then p_project->'expectedAmount'
      else '0'::jsonb
    end,
    'lightweightSettlementStatus', case
      when p_project ? 'lightweightSettlementStatus'
        then p_project->'lightweightSettlementStatus'
      when project_type in ('small', 'miraisya') then to_jsonb('unsettled'::text)
      else to_jsonb(''::text)
    end
  );
  if project_type = 'miraisya' then
    normalized_payload := normalized_payload || jsonb_build_object(
      'customerName', '株式会社未来舎サポート'
    );
  end if;
  perform private.validate_project_payload(normalized_payload);

  legacy_payload := normalized_payload - private.typed_project_payload_keys();
  created_payload := public.create_project_secure_before_typed_projects(legacy_payload);
  created_project_id := created_payload->>'projectId';

  update public.projects as project
    set payload = project.payload || jsonb_build_object(
      'projectType', normalized_payload->'projectType',
      'durationType', normalized_payload->'durationType',
      'workerAssignments', normalized_payload->'workerAssignments',
      'expectedAmount', normalized_payload->'expectedAmount',
      'lightweightSettlementStatus', normalized_payload->'lightweightSettlementStatus'
    )
    where project.record_key = created_project_id
    returning project.payload into created_payload;

  return case
    when public.can_current_employee_view_project_financials()
      then created_payload
    else created_payload - private.project_financial_payload_keys()
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
  unknown_key text;
  project_type text;
  legacy_patch jsonb;
  ignored_legacy_result jsonb;
  next_payload jsonb;
begin
  if not private.current_employee_can_mutate_typed_project('update') then
    raise exception using errcode = '42501', message = 'project update permission required';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'project payload must be an object';
  end if;

  select submitted.key
    into unknown_key
    from jsonb_object_keys(p_patch) as submitted(key)
    where submitted.key <> all (array[
      'projectType', 'projectName', 'customerName', 'address', 'latitude',
      'longitude', 'attendanceRadiusMeters', 'locationConfirmedAt',
      'locationAddressSnapshot', 'status', 'designAssigneeEmployeeId',
      'designAssigneeEmployeeNumber', 'designAssigneeName',
      'siteAssigneeEmployeeId', 'siteAssigneeEmployeeNumber',
      'siteAssigneeName', 'durationType', 'workerAssignments',
      'expectedAmount', 'lightweightSettlementStatus',
      'startDate', 'endDate', 'remark',
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

  legacy_patch := p_patch - private.typed_project_payload_keys();
  ignored_legacy_result := public.update_project_secure_before_typed_projects(
    p_project_id,
    legacy_patch
  );

  select project.payload
    into next_payload
    from public.projects as project
    where project.record_key = p_project_id
      and project.status = 'active'
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;

  if p_patch ? 'projectType' then
    next_payload := next_payload || jsonb_build_object('projectType', p_patch->'projectType');
  end if;
  if p_patch ? 'durationType' then
    next_payload := next_payload || jsonb_build_object('durationType', p_patch->'durationType');
  end if;
  if p_patch ? 'workerAssignments' then
    next_payload := next_payload || jsonb_build_object('workerAssignments', p_patch->'workerAssignments');
  end if;
  if p_patch ? 'expectedAmount' then
    next_payload := next_payload || jsonb_build_object('expectedAmount', p_patch->'expectedAmount');
  end if;
  if p_patch ? 'lightweightSettlementStatus' then
    next_payload := next_payload || jsonb_build_object(
      'lightweightSettlementStatus', p_patch->'lightweightSettlementStatus'
    );
  end if;

  perform private.validate_project_payload(next_payload);
  project_type := coalesce(next_payload->>'projectType', 'standard');
  next_payload := next_payload || jsonb_build_object(
    'projectType', project_type,
    'durationType', coalesce(
      next_payload->'durationType',
      case when project_type in ('small', 'miraisya')
        then to_jsonb('full_day'::text) else to_jsonb(''::text) end
    ),
    'workerAssignments', coalesce(next_payload->'workerAssignments', '[]'::jsonb),
    'expectedAmount', coalesce(next_payload->'expectedAmount', '0'::jsonb),
    'lightweightSettlementStatus', coalesce(
      next_payload->'lightweightSettlementStatus',
      case when project_type in ('small', 'miraisya')
        then to_jsonb('unsettled'::text) else to_jsonb(''::text) end
    )
  );
  perform private.validate_project_payload(next_payload);

  update public.projects as project
    set payload = next_payload
    where project.record_key = p_project_id;

  return case
    when public.can_current_employee_view_project_financials()
      then next_payload
    else next_payload - private.project_financial_payload_keys()
  end;
end;
$$;

create or replace function public.soft_delete_project_secure(p_project_id text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not private.current_employee_can_mutate_typed_project('delete') then
    raise exception using errcode = '42501', message = 'project delete permission required';
  end if;
  return public.soft_delete_project_secure_before_typed_projects(p_project_id);
end;
$$;

revoke all on function private.current_employee_can_mutate_typed_project(text)
  from public, anon, authenticated, service_role;
revoke all on function private.typed_project_payload_keys()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_project_payload(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_project_secure(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.update_project_secure(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.soft_delete_project_secure(text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_project_secure(jsonb)
  to authenticated, service_role;
grant execute on function public.update_project_secure(text, jsonb)
  to authenticated, service_role;
grant execute on function public.soft_delete_project_secure(text)
  to authenticated, service_role;

-- Server-only department/position permission-template reads and atomic replacement.

create or replace function private.permission_template_snapshot()
returns jsonb
language plpgsql
stable
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
  current_subject_code text;
  granted_permissions jsonb;
  departments jsonb := '{}'::jsonb;
  positions jsonb := '{}'::jsonb;
begin
  foreach current_subject_code in array department_codes loop
    select coalesce(
        jsonb_agg(grant_row.permission_key order by grant_row.permission_key),
        '[]'::jsonb
      )
      into granted_permissions
      from public.permission_grants as grant_row
      where grant_row.subject_type = 'department'
        and grant_row.subject_code = current_subject_code;
    departments := departments || jsonb_build_object(
      current_subject_code,
      granted_permissions
    );
  end loop;

  foreach current_subject_code in array position_codes loop
    select coalesce(
        jsonb_agg(grant_row.permission_key order by grant_row.permission_key),
        '[]'::jsonb
      )
      into granted_permissions
      from public.permission_grants as grant_row
      where grant_row.subject_type = 'position'
        and grant_row.subject_code = current_subject_code;
    positions := positions || jsonb_build_object(
      current_subject_code,
      granted_permissions
    );
  end loop;

  return jsonb_build_object(
    'departments', departments,
    'positions', positions
  );
end;
$$;

create or replace function public.read_permission_templates_admin(
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    '{}'::jsonb
  );
  return private.permission_template_snapshot();
end;
$$;

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

revoke all on function private.permission_template_snapshot()
  from public, anon, authenticated, service_role;

revoke all on function public.read_permission_templates_admin(uuid)
  from public, anon, authenticated;
grant execute on function public.read_permission_templates_admin(uuid)
  to service_role;

revoke all on function public.replace_permission_template_admin(text, text, text[], uuid)
  from public, anon, authenticated;
grant execute on function public.replace_permission_template_admin(text, text, text[], uuid)
  to service_role;

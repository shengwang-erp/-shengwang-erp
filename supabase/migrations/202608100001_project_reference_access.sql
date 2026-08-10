-- Minimal project references for cross-module relationship selectors.

begin;

create or replace function public.list_project_references_secure()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  if not (
    public.has_current_permission('module.projects.view')
    or public.has_current_permission('module.purchases.view')
    or (
      public.has_current_permission('module.accounting.view')
      and public.has_current_permission('module.project_costs.view')
    )
    or (
      public.has_current_permission('module.accounting.view')
      and public.has_current_permission('module.operating_expenses.view')
    )
    or (
      public.has_current_permission('module.owner_dashboard.view')
      and public.has_current_permission('sensitive.owner_dashboard_full_view')
      and public.has_current_permission('module.project_costs.view')
    )
    or (
      public.has_current_permission('module.owner_dashboard.view')
      and public.has_current_permission('sensitive.owner_dashboard_full_view')
      and public.has_current_permission('module.operating_expenses.view')
    )
    or public.has_current_permission('module.vehicles.view')
    or (
      public.has_current_permission('module.tools.view')
      and public.has_current_permission('module.tools.update')
    )
  ) then
    raise exception using
      errcode = '42501',
      message = 'project reference permission required';
  end if;

  return query
  select pg_catalog.jsonb_build_object(
    'projectId', project.record_key,
    'projectName', project.payload->>'projectName',
    'status', case
      when pg_catalog.jsonb_typeof(project.payload->'status') = 'string'
        then project.payload->>'status'
      else ''
    end,
    'address', case
      when pg_catalog.jsonb_typeof(project.payload->'address') = 'string'
        then project.payload->>'address'
      else ''
    end
  )
  from public.projects as project
  where project.status <> 'deleted'
    and pg_catalog.jsonb_typeof(project.payload) = 'object'
    and pg_catalog.jsonb_typeof(project.payload->'projectName') = 'string'
    and pg_catalog.btrim(project.payload->>'projectName') <> ''
  order by project.updated_at desc, project.record_key;
end;
$$;

revoke all on function public.list_project_references_secure()
  from public, anon, authenticated, service_role;
grant execute on function public.list_project_references_secure()
  to authenticated, service_role;

commit;

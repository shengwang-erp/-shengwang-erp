begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(32);

create temporary table task3_old_permission_keys (
  permission_key text primary key
) on commit drop;

insert into task3_old_permission_keys (permission_key)
values
  ('module.owner_dashboard.view'),
  ('module.owner_dashboard.create'),
  ('module.owner_dashboard.update'),
  ('module.owner_dashboard.delete'),
  ('module.projects.view'),
  ('module.projects.create'),
  ('module.projects.update'),
  ('module.projects.delete'),
  ('module.employees.view'),
  ('module.employees.create'),
  ('module.employees.update'),
  ('module.employees.delete'),
  ('module.labor.view'),
  ('module.labor.create'),
  ('module.labor.update'),
  ('module.labor.delete'),
  ('module.purchases.view'),
  ('module.purchases.create'),
  ('module.purchases.update'),
  ('module.purchases.delete'),
  ('module.inventory.view'),
  ('module.inventory.create'),
  ('module.inventory.update'),
  ('module.inventory.delete'),
  ('module.tools.view'),
  ('module.tools.create'),
  ('module.tools.update'),
  ('module.tools.delete'),
  ('module.vehicles.view'),
  ('module.vehicles.create'),
  ('module.vehicles.update'),
  ('module.vehicles.delete'),
  ('module.accounting.view'),
  ('module.accounting.create'),
  ('module.accounting.update'),
  ('module.accounting.delete'),
  ('module.salaries.view'),
  ('module.salaries.create'),
  ('module.salaries.update'),
  ('module.salaries.delete'),
  ('module.project_costs.view'),
  ('module.project_costs.create'),
  ('module.project_costs.update'),
  ('module.project_costs.delete'),
  ('module.operating_expenses.view'),
  ('module.operating_expenses.create'),
  ('module.operating_expenses.update'),
  ('module.operating_expenses.delete'),
  ('module.settings.view'),
  ('module.settings.create'),
  ('module.settings.update'),
  ('module.settings.delete'),
  ('sensitive.salary_view'),
  ('sensitive.salary_update'),
  ('sensitive.contract_amount_view'),
  ('sensitive.contract_amount_update'),
  ('sensitive.profit_view'),
  ('sensitive.purchase_payments_view'),
  ('sensitive.purchase_payments_update'),
  ('sensitive.employee_identity_view'),
  ('sensitive.employee_identity_update'),
  ('sensitive.owner_dashboard_full_view');

create temporary table task3_warehouse_permission_keys (
  permission_key text primary key
) on commit drop;

insert into task3_warehouse_permission_keys (permission_key)
values
  ('warehouse.catalog.manage'),
  ('warehouse.receipt.submit'),
  ('warehouse.receipt.confirm'),
  ('warehouse.stock_flow.request'),
  ('warehouse.stock_flow.confirm'),
  ('warehouse.transfer.manage'),
  ('warehouse.stocktake.confirm'),
  ('warehouse.cost.view'),
  ('warehouse.report.export');
grant select on table task3_warehouse_permission_keys to service_role;

select is(
  (select count(*) from public.permission_grants
   where permission_key like 'warehouse.%'),
  0::bigint,
  'the migration seeds no warehouse permission grants'
);

insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
)
select 'position', '社长', permission_key
from task3_old_permission_keys;

select is(
  (select count(*) from public.permission_grants
   where subject_type = 'position' and subject_code = '社长'),
  62::bigint,
  'the complete old permission allow-list remains accepted'
);

delete from public.permission_grants
where subject_type = 'position' and subject_code = '社长';

select throws_ok(
  $$insert into public.permission_grants (
      subject_type, subject_code, permission_key
    ) values (
      'department', '仓库管理部', 'warehouse.unknown.confirm'
    )$$,
  '23514',
  null,
  'the table constraint rejects unknown warehouse permission keys'
);

select lives_ok(
  $$insert into public.permission_grants (
      subject_type, subject_code, permission_key
    )
    select 'department', '仓库管理部', permission_key
    from task3_warehouse_permission_keys$$,
  'the table constraint accepts all nine stable warehouse permission keys'
);

select is(
  (select count(*) from public.permission_grants
   where subject_type = 'department'
     and subject_code = '仓库管理部'
     and permission_key like 'warehouse.%'),
  9::bigint,
  'all nine stable warehouse keys persist without normalization'
);

delete from public.permission_grants
where subject_type = 'department' and subject_code = '仓库管理部';

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'warehouse-permission-admin@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'warehouse-requester@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'warehouse-disabled@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'warehouse-former@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'warehouse-password-change@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '83000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'warehouse-sw000@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles (
  id,
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account
) values
  ('84000000-0000-4000-8000-000000000001', 'SW-8301', '83000000-0000-4000-8000-000000000001', '仓库权限社长', '总务部', '社长', '在职', 'active', false, false),
  ('84000000-0000-4000-8000-000000000002', 'SW-8302', '83000000-0000-4000-8000-000000000002', '仓库请求员工', '工程部', '主任', '在职', 'active', false, false),
  ('84000000-0000-4000-8000-000000000003', 'SW-8303', '83000000-0000-4000-8000-000000000003', '停用仓库社长', '总务部', '社长', '在职', 'disabled', false, false),
  ('84000000-0000-4000-8000-000000000004', 'SW-8304', '83000000-0000-4000-8000-000000000004', '离职仓库员工', '工程部', '主任', '离职', 'active', false, false),
  ('84000000-0000-4000-8000-000000000005', 'SW-8305', '83000000-0000-4000-8000-000000000005', '待改密仓库员工', '工程部', '主任', '在职', 'active', true, false),
  ('84000000-0000-4000-8000-000000000006', 'SW-000', '83000000-0000-4000-8000-000000000006', '超级管理员', '总务部', '社长', '在职', 'active', false, true);

create temporary table task3_snapshots (
  scenario text primary key,
  value jsonb not null
) on commit drop;
grant all on table task3_snapshots to service_role;

select set_config('request.jwt.claim.role', 'service_role', true);

select throws_ok(
  $$select public.replace_permission_template_admin(
      'department',
      '仓库管理部',
      array['warehouse.unknown.confirm']::text[],
      '83000000-0000-4000-8000-000000000001'::uuid
    )$$,
  '22023',
  'invalid permission template',
  'the atomic template replacement rejects unknown warehouse keys'
);

set local role service_role;
select lives_ok(
  $$insert into task3_snapshots values (
      'warehouse department',
      public.replace_permission_template_admin(
        'department',
        '仓库管理部',
        array(select permission_key from task3_warehouse_permission_keys),
        '83000000-0000-4000-8000-000000000001'::uuid
      )
    )$$,
  'department templates accept all warehouse action keys atomically'
);
select lives_ok(
  $$insert into task3_snapshots values (
      'warehouse position',
      public.replace_permission_template_admin(
        'position',
        '仓库管理员',
        array(select permission_key from task3_warehouse_permission_keys),
        '83000000-0000-4000-8000-000000000001'::uuid
      )
    )$$,
  'position templates accept all warehouse action keys atomically'
);
select lives_ok(
  $$insert into task3_snapshots values (
      'requester only',
      public.replace_permission_template_admin(
        'position',
        '主任',
        array[
          'module.inventory.view',
          'warehouse.stock_flow.request'
        ]::text[],
        '83000000-0000-4000-8000-000000000001'::uuid
      )
    )$$,
  'requester-only templates accept the old module gate plus request action'
);
reset role;

select is(
  (select value->'departments'->'仓库管理部'
   from task3_snapshots where scenario = 'warehouse department'),
  (select jsonb_agg(permission_key order by permission_key)
   from task3_warehouse_permission_keys),
  'department templates round-trip every warehouse action key'
);

select is(
  (select array_agg(permission_key order by permission_key)
   from public.permission_grants
   where subject_type = 'department' and subject_code = '仓库管理部'),
  (select array_agg(permission_key order by permission_key)
   from task3_warehouse_permission_keys),
  'department replacement persists exactly the warehouse action set'
);

select is(
  (select value->'positions'->'仓库管理员'
   from task3_snapshots where scenario = 'warehouse position'),
  (select jsonb_agg(permission_key order by permission_key)
   from task3_warehouse_permission_keys),
  'position templates round-trip every warehouse action key'
);

select is(
  (select array_agg(permission_key order by permission_key)
   from public.permission_grants
   where subject_type = 'position' and subject_code = '仓库管理员'),
  (select array_agg(permission_key order by permission_key)
   from task3_warehouse_permission_keys),
  'position replacement persists exactly the warehouse action set'
);

select is(
  (select array_agg(permission_key order by permission_key)
   from public.permission_grants
   where subject_type = 'position' and subject_code = '主任'),
  array[
    'module.inventory.view',
    'warehouse.stock_flow.request'
  ]::text[],
  'a requester-only template stores no confirmation permission'
);

select is(
  private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000002'::uuid
  ),
  array[
    'module.inventory.view',
    'warehouse.stock_flow.request'
  ]::text[],
  'active requester effective permissions use the department-position union'
);

select ok(
  private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000001'::uuid
  ) @> array['warehouse.catalog.manage']::text[],
  'active president receives exact warehouse catalog management from the central resolver'
);
select ok(
  private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000001'::uuid
  ) @> array['warehouse.cost.view']::text[],
  'effective catalog management automatically includes exact warehouse cost view'
);
select ok(
  not private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000001'::uuid
  ) && array['module.accounting.view', 'module.project_costs.view']::text[],
  'warehouse catalog management does not imply accounting or project cost modules'
);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000001', true);
select ok(
  public.has_current_permission('warehouse.catalog.manage'),
  'active president passes the exact current warehouse management permission check'
);
select ok(
  public.has_current_permission('warehouse.cost.view'),
  'active catalog manager passes the implied warehouse cost permission check'
);

select set_config(
  'request.jwt.claim.sub',
  '83000000-0000-4000-8000-000000000002',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);
select ok(
  public.has_current_permission('warehouse.stock_flow.request'),
  'a requester-only active employee can request stock flow'
);
select ok(
  not public.has_current_permission('warehouse.stock_flow.confirm'),
  'a requester-only active employee cannot confirm stock flow'
);

select is(
  private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000003'::uuid
  ),
  array[]::text[],
  'a disabled employee has no effective warehouse access'
);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000003', true);
select ok(
  not public.has_current_permission('warehouse.stock_flow.request'),
  'a disabled employee fails closed at the current permission check'
);
select ok(
  not public.has_current_permission('warehouse.catalog.manage'),
  'a disabled president receives no default warehouse management permission'
);
select ok(
  not public.has_current_permission('warehouse.cost.view'),
  'a disabled catalog manager receives no implied warehouse cost permission'
);

select is(
  private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000004'::uuid
  ),
  array[]::text[],
  'a former employee has no effective warehouse access'
);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000004', true);
select ok(
  not public.has_current_permission('warehouse.stock_flow.request'),
  'a former employee fails closed at the current permission check'
);

select is(
  private.employee_effective_permission_keys(
    '84000000-0000-4000-8000-000000000005'::uuid
  ),
  array[]::text[],
  'a first-login password-change employee has no effective warehouse access'
);
select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000005', true);
select ok(
  not public.has_current_permission('warehouse.stock_flow.request'),
  'a first-login password-change employee fails closed at the current permission check'
);

select set_config('request.jwt.claim.sub', '83000000-0000-4000-8000-000000000006', true);
select ok(
  (select bool_and(public.has_current_permission(permission_key))
   from task3_warehouse_permission_keys),
  'the active protected SW-000 identity keeps its current all-permission semantics'
);
select ok(
  not public.has_current_permission('warehouse.unknown.confirm'),
  'SW-000 does not turn unknown warehouse keys into a new permission surface'
);

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select plan(69);

select has_table(
  'public'::name, 'attendance_accounting_settings'::name
);
select has_table(
  'public'::name, 'attendance_day_resolutions'::name
);
select has_table(
  'public'::name, 'attendance_project_allocations'::name
);
select has_table(
  'public'::name, 'attendance_monthly_payrolls'::name
);
select has_table(
  'public'::name, 'attendance_accounting_audit_log'::name
);

select has_function(
  'private', 'current_attendance_accountant', array[]::text[],
  'attendance accountant identity helper exists'
);

select ok(
  not has_table_privilege(
    'authenticated', 'public.attendance_day_resolutions', 'INSERT'
  ),
  'authenticated cannot insert resolutions directly'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.attendance_project_allocations', 'UPDATE'
  ),
  'authenticated cannot update allocations directly'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.attendance_monthly_payrolls', 'DELETE'
  ),
  'authenticated cannot delete payroll directly'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.attendance_accounting_audit_log', 'INSERT'
  ),
  'authenticated cannot forge audit rows'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname in (
        'attendance_accounting_settings',
        'attendance_day_resolutions',
        'attendance_project_allocations',
        'attendance_monthly_payrolls',
        'attendance_accounting_audit_log'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  5::bigint,
  'all accounting tables enable and force RLS'
);

select ok(
  not exists (
    select 1
    from (values
      ('attendance_accounting_settings'),
      ('attendance_day_resolutions'),
      ('attendance_project_allocations'),
      ('attendance_monthly_payrolls'),
      ('attendance_accounting_audit_log')
    ) accounting_table(table_name)
    cross join (values ('anon'), ('authenticated')) browser_role(role_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) table_privilege(privilege_name)
    where has_table_privilege(
      browser_role.role_name,
      format('public.%I', accounting_table.table_name),
      table_privilege.privilege_name
    )
  ),
  'browser roles have no direct accounting-table privileges'
);

select ok(
  not exists (
    select 1
    from (values
      ('attendance_accounting_settings'),
      ('attendance_day_resolutions'),
      ('attendance_project_allocations'),
      ('attendance_monthly_payrolls'),
      ('attendance_accounting_audit_log')
    ) accounting_table(table_name)
    where not has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'SELECT'
      )
      or has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'INSERT'
      )
      or has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'UPDATE'
      )
      or has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'DELETE'
      )
      or has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'TRUNCATE'
      )
      or has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'REFERENCES'
      )
      or has_table_privilege(
        'service_role', format('public.%I', accounting_table.table_name), 'TRIGGER'
      )
  ),
  'service_role receives direct SELECT and no table mutation privileges'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace schema on schema.oid = procedure.pronamespace
    where schema.nspname = 'private'
      and procedure.proname = 'current_attendance_accountant'
      and procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=pg_catalog, public']::text[]
      and not has_function_privilege(
        'anon', procedure.oid, 'EXECUTE'
      )
      and not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      and not has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
      and not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
  ),
  'accountant helper is a closed stable SECURITY DEFINER with a safe search_path'
);

select is(
  (select count(*) from public.attendance_accounting_settings),
  0::bigint,
  'migration does not forge an updater to seed settings'
);

select ok(
  (
    select count(*) = 8 and bool_and(constraint_definition.confdeltype = 'r')
    from pg_catalog.pg_constraint constraint_definition
    join pg_catalog.pg_class relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace schema
      on schema.oid = relation.relnamespace
    where constraint_definition.contype = 'f'
      and schema.nspname = 'public'
      and relation.relname in (
        'attendance_accounting_settings',
        'attendance_day_resolutions',
        'attendance_project_allocations',
        'attendance_monthly_payrolls',
        'attendance_accounting_audit_log'
      )
  ),
  'all eight normalized foreign keys restrict deletion'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger trigger_definition
    join pg_catalog.pg_class relation on relation.oid = trigger_definition.tgrelid
    join pg_catalog.pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = 'attendance_accounting_audit_log'
      and not trigger_definition.tgisinternal
      and trigger_definition.tgenabled = 'O'
      and trigger_definition.tgtype & 1 = 1
      and trigger_definition.tgtype & 2 = 2
      and trigger_definition.tgtype & 8 = 8
      and trigger_definition.tgtype & 16 = 16
  ),
  'audit rows have an enabled before-row update/delete rejection trigger'
);

select ok(
  (
    select count(*) = 4
    from pg_catalog.pg_constraint constraint_definition
    join pg_catalog.pg_class relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace schema
      on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and constraint_definition.contype in ('p', 'u')
      and (
        (relation.relname = 'attendance_accounting_settings'
          and constraint_definition.contype = 'p')
        or (relation.relname = 'attendance_day_resolutions'
          and pg_get_constraintdef(constraint_definition.oid)
            = 'UNIQUE (employee_profile_id, work_date)')
        or (relation.relname = 'attendance_project_allocations'
          and pg_get_constraintdef(constraint_definition.oid)
            = 'UNIQUE (resolution_id, project_id)')
        or (relation.relname = 'attendance_monthly_payrolls'
          and pg_get_constraintdef(constraint_definition.oid)
            = 'UNIQUE (employee_profile_id, salary_month)')
      )
  ),
  'settings and day, allocation, and month identities are unique'
);

insert into public.employee_profiles (
  id,
  employee_number,
  name,
  department,
  position
) values (
  '67000000-0000-4000-8000-000000000001',
  'SW-6701',
  '核算时间戳测试',
  '财务部',
  '会计'
);

insert into public.attendance_accounting_settings (
  effective_from,
  updated_by_employee_profile_id
) values (
  '2026-07-16',
  '67000000-0000-4000-8000-000000000001'
);

insert into public.attendance_accounting_audit_log (
  audit_id,
  object_type,
  object_id,
  action_type,
  actor_employee_profile_id,
  after_snapshot
) values (
  '6b000000-0000-4000-8000-000000000001',
  'settings',
  'default',
  'settings_updated',
  '67000000-0000-4000-8000-000000000001',
  '{}'::jsonb
);

select throws_ok(
  $$
    update public.attendance_accounting_audit_log
    set reason = 'forged'
    where audit_id = '6b000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'attendance accounting audit rows are immutable',
  'audit rows reject updates'
);

select throws_ok(
  $$
    delete from public.attendance_accounting_audit_log
    where audit_id = '6b000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  'attendance accounting audit rows are immutable',
  'audit rows reject deletes'
);

select lives_ok(
  $$
    update public.attendance_accounting_settings
    set break_minutes = 30
    where settings_key = 'default'
  $$,
  'same-transaction updates retain valid statement timestamps'
);

insert into public.projects (record_key)
values ('P-ACCOUNTING-FINITE-TEST');

insert into public.attendance_day_resolutions (
  resolution_id,
  employee_profile_id,
  work_date,
  schedule_required,
  resolution_type,
  attendance_units,
  salary_type_snapshot,
  daily_salary_snapshot,
  suggested_project_cost,
  final_project_cost
) values (
  '68000000-0000-4000-8000-000000000001',
  '67000000-0000-4000-8000-000000000001',
  '2026-07-16',
  true,
  'full_day',
  1,
  '日薪',
  10000,
  10000,
  10000
);

select lives_ok(
  $$
    update public.attendance_day_resolutions
    set accounting_status = 'confirmed',
        confirmed_by_employee_profile_id =
          '67000000-0000-4000-8000-000000000001',
        confirmed_at = statement_timestamp()
    where resolution_id = '68000000-0000-4000-8000-000000000001'
  $$,
  'day confirmation is compatible with the statement-time update trigger'
);

insert into public.attendance_monthly_payrolls (
  payroll_id,
  employee_profile_id,
  salary_month,
  salary_type_snapshot,
  base_salary_snapshot,
  full_days,
  half_days,
  absence_days,
  base_pay,
  net_salary
) values (
  '6a000000-0000-4000-8000-000000000002',
  '67000000-0000-4000-8000-000000000001',
  '2026-07-01',
  '月薪',
  0,
  0,
  0,
  0,
  0,
  0
);

select lives_ok(
  $$
    update public.attendance_monthly_payrolls
    set status = 'confirmed',
        confirmed_by_employee_profile_id =
          '67000000-0000-4000-8000-000000000001',
        confirmed_at = statement_timestamp()
    where payroll_id = '6a000000-0000-4000-8000-000000000002'
  $$,
  'monthly confirmation is compatible with the statement-time update trigger'
);

select lives_ok(
  $$
    update public.attendance_monthly_payrolls
    set status = 'reopened',
        confirmed_by_employee_profile_id = null,
        confirmed_at = null
    where payroll_id = '6a000000-0000-4000-8000-000000000002'
  $$,
  'reopened payroll accepts the required cleared confirmation metadata'
);

create or replace function pg_temp.task2_numeric_constraint_rejects(
  p_table_name text,
  p_constraint_name text,
  p_column_name text,
  p_special_value numeric
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  constraint_expression text;
  rejected boolean;
begin
  select pg_get_expr(
      constraint_definition.conbin,
      constraint_definition.conrelid
    )
    into constraint_expression
    from pg_catalog.pg_constraint constraint_definition
    join pg_catalog.pg_class relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace schema
      on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = p_table_name
      and constraint_definition.conname = p_constraint_name
      and constraint_definition.contype = 'c';

  if constraint_expression is null then
    return false;
  end if;

  if p_column_name = 'net_salary' then
    execute format(
      'select not coalesce((%s), true)
       from (select
         $1::numeric as net_salary,
         $1::numeric as base_pay,
         0::numeric as overtime_pay,
         0::numeric as bonus,
         0::numeric as deduction
       ) candidate',
      constraint_expression
    )
      using p_special_value
      into rejected;
  else
    execute format(
      'select not coalesce((%s), true)
       from (select $1::numeric as %I) candidate',
      constraint_expression,
      p_column_name
    )
      using p_special_value
      into rejected;
  end if;

  return rejected;
end;
$$;

select is(
  (
    select count(*)
    from (values
      ('attendance_day_resolutions',
        'attendance_day_resolutions_units_check', 'attendance_units'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_base_salary_yen_check',
        'base_salary_snapshot'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_daily_salary_yen_check',
        'daily_salary_snapshot'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_hourly_wage_yen_check',
        'hourly_wage_snapshot'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_suggested_cost_yen_check',
        'suggested_project_cost'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_final_cost_yen_check',
        'final_project_cost'),
      ('attendance_project_allocations',
        'attendance_project_allocations_amount_yen_check', 'amount'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_base_salary_yen_check',
        'base_salary_snapshot'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_full_days_check', 'full_days'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_half_days_check', 'half_days'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_absence_days_check', 'absence_days'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_base_pay_yen_check', 'base_pay'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_overtime_pay_yen_check', 'overtime_pay'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_bonus_yen_check', 'bonus'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_deduction_yen_check', 'deduction'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_net_salary_yen_check', 'net_salary')
    ) numeric_field(table_name, constraint_name, column_name)
    cross join (values
      ('NaN'::numeric),
      ('Infinity'::numeric),
      ('-Infinity'::numeric)
    ) special_value(value)
    where not pg_temp.task2_numeric_constraint_rejects(
      numeric_field.table_name,
      numeric_field.constraint_name,
      numeric_field.column_name,
      special_value.value
    )
  ),
  0::bigint,
  'every numeric column independently rejects NaN and both infinities'
);

create or replace function pg_temp.task2_temporal_constraint_rejects(
  p_table_name text,
  p_constraint_name text,
  p_column_name text,
  p_data_type text,
  p_special_value text
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public
as $$
declare
  constraint_expression text;
  rejected boolean;
begin
  select pg_get_expr(
      constraint_definition.conbin,
      constraint_definition.conrelid
    )
    into constraint_expression
    from pg_catalog.pg_constraint constraint_definition
    join pg_catalog.pg_class relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace schema
      on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = p_table_name
      and constraint_definition.conname = p_constraint_name
      and constraint_definition.contype = 'c';

  if constraint_expression is null then
    return false;
  end if;

  if p_data_type = 'date' then
    execute format(
      'select not coalesce((%s), true)
       from (select $1::date as %I) candidate',
      constraint_expression,
      p_column_name
    )
      using p_special_value
      into rejected;
  elsif p_data_type = 'timestamptz' then
    execute format(
      'select not coalesce((%s), true)
       from (select $1::timestamptz as %I) candidate',
      constraint_expression,
      p_column_name
    )
      using p_special_value
      into rejected;
  else
    raise exception using errcode = '22023', message = 'unknown temporal type';
  end if;

  return rejected;
end;
$$;

select is(
  (
    select count(*)
    from (values
      ('attendance_accounting_settings',
        'attendance_accounting_settings_effective_from_finite_check',
        'effective_from', 'date'),
      ('attendance_accounting_settings',
        'attendance_accounting_settings_created_at_finite_check',
        'created_at', 'timestamptz'),
      ('attendance_accounting_settings',
        'attendance_accounting_settings_updated_at_finite_check',
        'updated_at', 'timestamptz'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_work_date_finite_check',
        'work_date', 'date'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_confirmed_at_finite_check',
        'confirmed_at', 'timestamptz'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_created_at_finite_check',
        'created_at', 'timestamptz'),
      ('attendance_day_resolutions',
        'attendance_day_resolutions_updated_at_finite_check',
        'updated_at', 'timestamptz'),
      ('attendance_project_allocations',
        'attendance_project_allocations_created_at_finite_check',
        'created_at', 'timestamptz'),
      ('attendance_project_allocations',
        'attendance_project_allocations_updated_at_finite_check',
        'updated_at', 'timestamptz'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_salary_month_finite_check',
        'salary_month', 'date'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_confirmed_at_finite_check',
        'confirmed_at', 'timestamptz'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_created_at_finite_check',
        'created_at', 'timestamptz'),
      ('attendance_monthly_payrolls',
        'attendance_monthly_payrolls_updated_at_finite_check',
        'updated_at', 'timestamptz'),
      ('attendance_accounting_audit_log',
        'attendance_accounting_audit_occurred_at_finite_check',
        'occurred_at', 'timestamptz')
    ) temporal_field(
      table_name, constraint_name, column_name, data_type
    )
    cross join (values ('infinity'), ('-infinity')) special_value(value)
    where not pg_temp.task2_temporal_constraint_rejects(
      temporal_field.table_name,
      temporal_field.constraint_name,
      temporal_field.column_name,
      temporal_field.data_type,
      special_value.value
    )
  ),
  0::bigint,
  'every business date and accounting timestamp rejects both infinities'
);

create or replace function pg_temp.task2_confirmation_case_rejected(
  p_case text
)
returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  payroll_status text;
  payroll_actor uuid;
  payroll_confirmed_at timestamptz;
begin
  begin
    if p_case = 'day_confirmed_after_updated' then
      insert into public.attendance_day_resolutions (
        resolution_id,
        employee_profile_id,
        work_date,
        schedule_required,
        resolution_type,
        attendance_units,
        accounting_status,
        salary_type_snapshot,
        daily_salary_snapshot,
        suggested_project_cost,
        final_project_cost,
        confirmed_by_employee_profile_id,
        confirmed_at,
        created_at,
        updated_at
      ) values (
        '68000000-0000-4000-8000-000000000002',
        '67000000-0000-4000-8000-000000000001',
        '2026-07-17',
        true,
        'full_day',
        1,
        'confirmed',
        '日薪',
        10000,
        10000,
        10000,
        '67000000-0000-4000-8000-000000000001',
        '2026-07-19 00:00:00+00',
        '2026-07-16 00:00:00+00',
        '2026-07-18 00:00:00+00'
      );
    else
      if p_case = 'payroll_confirmed_after_updated' then
        payroll_status := 'confirmed';
        payroll_actor := '67000000-0000-4000-8000-000000000001';
        payroll_confirmed_at := '2026-07-19 00:00:00+00';
      else
        payroll_status := split_part(p_case, '_', 2);
        payroll_actor := case
          when p_case like '%_actor_only' or p_case like '%_both'
            then '67000000-0000-4000-8000-000000000001'::uuid
          else null
        end;
        payroll_confirmed_at := case
          when p_case like '%_time_only' or p_case like '%_both'
            then '2026-07-17 00:00:00+00'::timestamptz
          else null
        end;
      end if;

      insert into public.attendance_monthly_payrolls (
        payroll_id,
        employee_profile_id,
        salary_month,
        salary_type_snapshot,
        base_salary_snapshot,
        full_days,
        half_days,
        absence_days,
        base_pay,
        net_salary,
        status,
        confirmed_by_employee_profile_id,
        confirmed_at,
        created_at,
        updated_at
      ) values (
        '6a000000-0000-4000-8000-000000000001',
        '67000000-0000-4000-8000-000000000001',
        '2026-08-01',
        '月薪',
        0,
        0,
        0,
        0,
        0,
        0,
        payroll_status,
        payroll_actor,
        payroll_confirmed_at,
        '2026-07-16 00:00:00+00',
        '2026-07-18 00:00:00+00'
      );
    end if;

    raise exception using
      errcode = 'P9001',
      message = 'invalid confirmation state unexpectedly accepted';
  exception
    when check_violation then
      return true;
    when sqlstate 'P9001' then
      return false;
  end;
end;
$$;

select is(
  (
    select count(*)
    from unnest(array[
      'payroll_confirmed_none',
      'payroll_confirmed_actor_only',
      'payroll_confirmed_time_only',
      'payroll_draft_actor_only',
      'payroll_draft_time_only',
      'payroll_draft_both',
      'payroll_reopened_actor_only',
      'payroll_reopened_time_only',
      'payroll_reopened_both',
      'day_confirmed_after_updated',
      'payroll_confirmed_after_updated'
    ]::text[]) test_case(case_name)
    where not pg_temp.task2_confirmation_case_rejected(test_case.case_name)
  ),
  0::bigint,
  'confirmation metadata and timestamp ordering fail closed'
);

select has_function(
  'private', 'attendance_accounting_settings_json', array[]::text[],
  'closed settings projection helper exists'
);
select has_function(
  'private', 'attendance_issue_codes',
  array['uuid', 'date', 'timestamp without time zone']::text[],
  'closed deterministic attendance classifier exists'
);
select has_function(
  'private', 'attendance_dashboard_employee_json',
  array['uuid', 'date', 'boolean']::text[],
  'closed employee dashboard projection helper exists'
);
select has_function(
  'public', 'list_daily_attendance_dashboard_secure', array['date']::text[],
  'daily dashboard RPC has the exact date-only signature'
);
select has_function(
  'public', 'get_labor_alert_count_secure', array[]::text[],
  'labor alert count RPC has no client-controlled inputs'
);

select ok(
  (
    select count(*) = 2
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 's')
      and bool_and(
        procedure.proconfig = array['search_path=pg_catalog, public']::text[]
      )
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(
        has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      )
      and bool_and(
        has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      )
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) privilege
        where privilege.privilege_type = 'EXECUTE'
          and (
            privilege.grantee = 0
            or privilege.is_grantable
            or privilege.grantee not in (
              procedure.proowner,
              (select role.oid from pg_catalog.pg_roles role
                where role.rolname = 'authenticated'),
              (select role.oid from pg_catalog.pg_roles role
                where role.rolname = 'service_role')
            )
          )
      ))
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace schema on schema.oid = procedure.pronamespace
    where schema.nspname = 'public'
      and (
        (
          procedure.proname = 'list_daily_attendance_dashboard_secure'
          and pg_get_function_identity_arguments(procedure.oid) = 'p_work_date date'
          and pg_get_function_result(procedure.oid) = 'jsonb'
        )
        or (
          procedure.proname = 'get_labor_alert_count_secure'
          and pg_get_function_identity_arguments(procedure.oid) = ''
          and pg_get_function_result(procedure.oid) = 'jsonb'
        )
      )
  ),
  'public dashboard RPCs are stable SECURITY DEFINER functions with exact ACLs'
);

select ok(
  (
    select count(*) = 3
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.provolatile = 's')
      and bool_and(
        procedure.proconfig = array['search_path=pg_catalog, public']::text[]
      )
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ))
      and bool_and(not has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ))
      and bool_and(not exists (
        select 1
        from aclexplode(coalesce(
          procedure.proacl, acldefault('f', procedure.proowner)
        )) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ))
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace schema on schema.oid = procedure.pronamespace
    where schema.nspname = 'private'
      and procedure.proname in (
        'attendance_accounting_settings_json',
        'attendance_issue_codes',
        'attendance_dashboard_employee_json'
      )
  ),
  'all dashboard helpers are closed stable SECURITY DEFINER functions'
);

delete from public.attendance_accounting_settings;
update public.employee_profiles
set hire_date = '2026-07-15'
where id = '67000000-0000-4000-8000-000000000001';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '6c000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'dashboard-full@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '6c000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'dashboard-limited@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '6c000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'dashboard-viewer@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

delete from public.permission_grants
where (subject_type = 'department' and subject_code in (
    '财务部', '事务部', '后勤部'
  ))
  or (subject_type = 'position' and subject_code in (
    '会计主管', '会计', '主任'
  ));

insert into public.permission_grants (
  subject_type, subject_code, permission_key
) values
  ('position', '会计主管', 'module.labor.view'),
  ('position', '会计主管', 'module.labor.update'),
  ('position', '会计主管', 'sensitive.salary_view'),
  ('position', '会计主管', 'sensitive.salary_update'),
  ('position', '会计主管', 'module.project_costs.view'),
  ('position', '会计主管', 'module.project_costs.update'),
  ('position', '会计', 'module.labor.view');

insert into public.employee_profiles (
  id, employee_number, auth_user_id, name, department, position,
  employment_status, hire_date, resign_date, account_status,
  must_change_password, is_hidden_system_account,
  base_salary, daily_salary, hourly_wage, salary_remark
) values
  (
    '6d000000-0000-4000-8000-000000000001', 'SW-6801',
    '6c000000-0000-4000-8000-000000000001', '全权限核算员', '财务部', '会计主管',
    '在职', '2026-07-15', null, 'active', false, false,
    null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000002', 'SW-6802',
    '6c000000-0000-4000-8000-000000000002', '无工资查看核算员', '事务部', '会计',
    '在职', '2026-07-15', null, 'active', false, false,
    null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000003', 'SW-6803',
    '6c000000-0000-4000-8000-000000000003', '无人工权限查看者', '后勤部', '主任',
    '在职', '2026-07-15', null, 'active', false, false,
    null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000004', 'SW-6804', null,
    '缺上班卡员工', '工程部', '小工', '在职', '2026-01-01', null,
    'active', true, false, 320000, null, null, '最高机密'
  ),
  (
    '6d000000-0000-4000-8000-000000000005', 'SW-6805', null,
    '多场次异常员工', '工程部', '大工', '在职', '2026-01-01', null,
    'active', true, false, null, 12000, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000006', 'SW-6806', null,
    '开放场次员工', '工程部', '中工', '在职', '2026-01-01', null,
    'active', true, false, null, null, 1500, null
  ),
  (
    '6d000000-0000-4000-8000-000000000007', 'SW-6807', null,
    '确认休息员工', '工程部', '小工', '在职', '2026-01-01', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000008', 'SW-6808', null,
    '确认请假员工', '工程部', '小工', '在职', '2026-01-01', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000009', 'SW-6809', null,
    '确认调休员工', '工程部', '小工', '在职', '2026-01-01', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000010', 'SW-6810', null,
    '离职边界员工', '工程部', '小工', '离职', '2026-01-01', '2026-07-11',
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000011', 'SW-6811', null,
    '尚未入职员工', '工程部', '小工', '在职', '2026-07-12', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000012', 'SW-6812', null,
    '此前已离职员工', '工程部', '小工', '离职', '2026-01-01', '2026-07-10',
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000013', 'SW-6813', null,
    '正常完成员工', '工程部', '小工', '在职', '2026-01-01', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000014', 'SW-6814', null,
    '早退员工', '工程部', '小工', '在职', '2026-01-01', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000015', 'SW-6815', null,
    '休假状态员工', '工程部', '小工', '休假', '2026-01-01', null,
    'active', true, false, null, null, null, null
  ),
  (
    '6d000000-0000-4000-8000-000000000016', 'SW-6816', null,
    '停工状态员工', '工程部', '小工', '停工', '2026-01-01', null,
    'active', true, false, null, null, null, null
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  public.list_daily_attendance_dashboard_secure('2026-07-11'::date)->'settings',
  jsonb_build_object(
    'configured', false,
    'effectiveFrom', null,
    'workWeekdays', jsonb_build_array(1, 2, 3, 4, 5, 6),
    'workStartTime', '08:00',
    'workEndTime', '17:00',
    'breakMinutes', 60,
    'standardDayMinutes', 480
  ),
  'unconfigured settings return the exact approved preview'
);
select is(
  (
    public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
      #>> '{summary,missingClockIn}'
  )::integer,
  0,
  'unconfigured settings synthesize zero missing-clock alerts'
);
reset role;

insert into public.attendance_accounting_settings (
  effective_from,
  updated_by_employee_profile_id
) values (
  '2026-07-01',
  '6d000000-0000-4000-8000-000000000001'
);

insert into public.attendance_day_resolutions (
  resolution_id, employee_profile_id, work_date, schedule_required,
  resolution_type, attendance_units, accounting_status,
  salary_type_snapshot, base_salary_snapshot,
  suggested_project_cost, final_project_cost,
  confirmed_by_employee_profile_id, confirmed_at, created_at, updated_at
) values
  (
    '6e000000-0000-4000-8000-000000000001',
    '6d000000-0000-4000-8000-000000000004', '2026-07-11', true,
    'absence', 0, 'draft', '月薪', 320000, 13333, 13333,
    null, null, '2026-07-11 12:00:00+00', '2026-07-11 12:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000002',
    '6d000000-0000-4000-8000-000000000007', '2026-07-11', true,
    'rest', 0, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 12:00:00+00', '2026-07-11 12:00:00+00',
    '2026-07-11 12:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000003',
    '6d000000-0000-4000-8000-000000000008', '2026-07-11', true,
    'leave', 0, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 12:00:00+00', '2026-07-11 12:00:00+00',
    '2026-07-11 12:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000004',
    '6d000000-0000-4000-8000-000000000009', '2026-07-11', true,
    'comp_time', 0, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 12:00:00+00', '2026-07-11 12:00:00+00',
    '2026-07-11 12:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000005',
    '6d000000-0000-4000-8000-000000000010', '2026-07-11', true,
    'rest', 0, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 12:00:00+00', '2026-07-11 12:00:00+00',
    '2026-07-11 12:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000006',
    '6d000000-0000-4000-8000-000000000016', '2026-07-11', true,
    'rest', 0, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 12:00:00+00', '2026-07-11 12:00:00+00',
    '2026-07-11 12:00:00+00'
  );

insert into public.project_attendance_sessions (
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at, closed_at
) values
  (
    '6f000000-0000-4000-8000-000000000001',
    '6d000000-0000-4000-8000-000000000005', 'SW-6805', '多场次异常员工',
    'P-ACCOUNTING-FINITE-TEST', '测试现场', '東京都', 35.68, 139.76, 300,
    '2026-07-11', 'closed', '2026-07-11 08:15:00+09', '2026-07-11 10:00:00+09'
  ),
  (
    '6f000000-0000-4000-8000-000000000002',
    '6d000000-0000-4000-8000-000000000005', 'SW-6805', '多场次异常员工',
    'P-ACCOUNTING-FINITE-TEST', '测试现场改称', '東京都', 35.68, 139.76, 300,
    '2026-07-11', 'closed', '2026-07-11 11:00:00+09', '2026-07-11 18:30:00+09'
  ),
  (
    '6f000000-0000-4000-8000-000000000003',
    '6d000000-0000-4000-8000-000000000006', 'SW-6806', '开放场次员工',
    'P-ACCOUNTING-FINITE-TEST', '测试现场', '東京都', 35.68, 139.76, 300,
    '2026-07-11', 'open', '2026-07-11 08:15:00+09', null
  ),
  (
    '6f000000-0000-4000-8000-000000000004',
    '6d000000-0000-4000-8000-000000000013', 'SW-6813', '正常完成员工',
    'P-ACCOUNTING-FINITE-TEST', '测试现场', '東京都', 35.68, 139.76, 300,
    '2026-07-11', 'closed', '2026-07-11 08:00:00+09', '2026-07-11 17:00:00+09'
  ),
  (
    '6f000000-0000-4000-8000-000000000005',
    '6d000000-0000-4000-8000-000000000014', 'SW-6814', '早退员工',
    'P-ACCOUNTING-FINITE-TEST', '测试现场', '東京都', 35.68, 139.76, 300,
    '2026-07-11', 'closed', '2026-07-11 06:00:00+09', '2026-07-11 16:30:00+09'
  );

insert into public.project_attendance_events (
  event_id, session_id, event_type, request_id, server_recorded_at,
  latitude, longitude, accuracy_meters, distance_meters, radius_meters,
  result, abnormal_reason
) values
  (
    '71000000-0000-4000-8000-000000000001',
    '6f000000-0000-4000-8000-000000000001', 'clock_in',
    '72000000-0000-4000-8000-000000000001', '2026-07-11 08:15:00+09',
    35.68, 139.76, 10, 350, 300, 'abnormal', '定位范围外'
  ),
  (
    '71000000-0000-4000-8000-000000000002',
    '6f000000-0000-4000-8000-000000000001', 'clock_out',
    '72000000-0000-4000-8000-000000000002', '2026-07-11 10:00:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  ),
  (
    '71000000-0000-4000-8000-000000000003',
    '6f000000-0000-4000-8000-000000000002', 'clock_in',
    '72000000-0000-4000-8000-000000000003', '2026-07-11 11:00:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  ),
  (
    '71000000-0000-4000-8000-000000000004',
    '6f000000-0000-4000-8000-000000000002', 'clock_out',
    '72000000-0000-4000-8000-000000000004', '2026-07-11 18:30:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  ),
  (
    '71000000-0000-4000-8000-000000000005',
    '6f000000-0000-4000-8000-000000000003', 'clock_in',
    '72000000-0000-4000-8000-000000000005', '2026-07-11 08:15:00+09',
    35.68, 139.76, 10, 350, 300, 'abnormal', '定位范围外'
  ),
  (
    '71000000-0000-4000-8000-000000000006',
    '6f000000-0000-4000-8000-000000000004', 'clock_in',
    '72000000-0000-4000-8000-000000000006', '2026-07-11 08:00:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  ),
  (
    '71000000-0000-4000-8000-000000000007',
    '6f000000-0000-4000-8000-000000000004', 'clock_out',
    '72000000-0000-4000-8000-000000000007', '2026-07-11 17:00:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  ),
  (
    '71000000-0000-4000-8000-000000000008',
    '6f000000-0000-4000-8000-000000000005', 'clock_in',
    '72000000-0000-4000-8000-000000000008', '2026-07-11 06:00:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  ),
  (
    '71000000-0000-4000-8000-000000000009',
    '6f000000-0000-4000-8000-000000000005', 'clock_out',
    '72000000-0000-4000-8000-000000000009', '2026-07-11 16:30:00+09',
    35.68, 139.76, 10, 10, 300, 'normal', null
  );

select is(
  private.attendance_issue_codes(
    '6d000000-0000-4000-8000-000000000004',
    '2026-07-11',
    '2026-07-11 08:01:00'
  ),
  array['missing_clock_in']::text[],
  'elapsed Saturday is deterministically classified as missing clock-in'
);
select is(
  private.attendance_issue_codes(
    '6d000000-0000-4000-8000-000000000004',
    '2026-07-12',
    '2026-07-12 12:00:00'
  ),
  array[]::text[],
  'Sunday without attendance remains optional'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  (
    public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
      #>> '{summary,missingClockIn}'
  )::integer,
  2,
  'past Saturday has exactly two unresolved missing clock-in employees'
);
select is(
  (
    public.list_daily_attendance_dashboard_secure('2026-07-12'::date)
      #>> '{summary,missingClockIn}'
  )::integer,
  0,
  'Sunday absence is optional'
);
select is(
  (
    public.list_daily_attendance_dashboard_secure('2099-07-18'::date)
      #>> '{summary,missingClockIn}'
  )::integer,
  0,
  'a future Saturday never becomes a missing-clock alert'
);
select is(
  (
    public.list_daily_attendance_dashboard_secure('2026-06-27'::date)
      #>> '{summary,missingClockIn}'
  )::integer,
  0,
  'pre-activation dates synthesize no missing-clock alerts'
);

select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' in (
      '6d000000-0000-4000-8000-000000000007',
      '6d000000-0000-4000-8000-000000000008',
      '6d000000-0000-4000-8000-000000000009'
    )
      and employee->'issueCodes' = '[]'::jsonb
      and employee->>'dayStatus' in ('rest', 'leave', 'comp_time')
  ),
  3::bigint,
  'confirmed rest, leave, and comp-time suppress generated missing alerts'
);

select ok(
  (
    select
      count(*) = 2
      and bool_and(
        case employee->>'employeeProfileId'
          when '6d000000-0000-4000-8000-000000000015' then
            employee->>'dayStatus' = 'missing_clock_in'
            and employee->'issueCodes' = '["missing_clock_in"]'::jsonb
          when '6d000000-0000-4000-8000-000000000016' then
            employee->>'dayStatus' = 'rest'
            and employee->'issueCodes' = '[]'::jsonb
          else false
        end
      )
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' in (
      '6d000000-0000-4000-8000-000000000015',
      '6d000000-0000-4000-8000-000000000016'
    )
  ),
  '休假 and 停工 remain visible while only a daily resolution suppresses alerts'
);

select is(
  (
    select employee->'issueCodes'
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000005'
  ),
  '["abnormal_location","late","overtime_pending"]'::jsonb,
  'abnormal, late, and overtime facts use the approved issue priority'
);

select ok(
  (
    select
      (employee->>'firstClockInAt')::timestamptz =
        '2026-07-11 08:15:00+09'::timestamptz
      and (employee->>'lastClockOutAt')::timestamptz =
        '2026-07-11 18:30:00+09'::timestamptz
      and (employee->>'hasOpenSession')::boolean = false
      and (employee->>'hasAbnormalLocation')::boolean
      and jsonb_array_length(employee->'sessions') = 2
      and employee->'sessions'->0->'clockInEvent'->>'result' = 'abnormal'
      and employee->'sessions'->0->'clockInEvent'->>'abnormalReason' =
        '定位范围外'
      and (employee->'sessions')::text !~
        '(latitude|longitude|bucketId|objectPath|deviceRecordedAt)'
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000005'
  ),
  'earliest, latest, and abnormal event summaries come from trimmed immutable facts'
);

select is(
  (
    select jsonb_build_object(
      'hasOpenSession', employee->'hasOpenSession',
      'issueCodes', employee->'issueCodes'
    )
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000006'
  ),
  '{"hasOpenSession":true,"issueCodes":["abnormal_location","missing_clock_out","late","overtime_pending"]}'::jsonb,
  'open abnormal sessions report missing clock-out in stable priority order'
);

select is(
  (
    select employee->'issueCodes'
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000014'
  ),
  '["early","overtime_pending"]'::jsonb,
  'early precedes overtime pending when both facts apply'
);

select is(
  (
    select jsonb_build_object(
      'dayStatus', employee->'dayStatus',
      'issueCodes', employee->'issueCodes'
    )
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000013'
  ),
  '{"dayStatus":"completed","issueCodes":[]}'::jsonb,
  'normal completed sessions remain issue-free'
);

reset role;

insert into public.attendance_day_resolutions (
  resolution_id, employee_profile_id, work_date, schedule_required,
  resolution_type, attendance_units, accounting_status,
  salary_type_snapshot, base_salary_snapshot,
  suggested_project_cost, final_project_cost,
  confirmed_by_employee_profile_id, confirmed_at, created_at, updated_at
) values
  (
    '6e000000-0000-4000-8000-000000000007',
    '6d000000-0000-4000-8000-000000000005', '2026-07-11', true,
    'full_day', 1, 'confirmed', '日薪', 12000, 12000, 12000,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 13:00:00+00', '2026-07-11 13:00:00+00',
    '2026-07-11 13:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000008',
    '6d000000-0000-4000-8000-000000000014', '2026-07-11', true,
    'half_day', 0.5, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 13:00:00+00', '2026-07-11 13:00:00+00',
    '2026-07-11 13:00:00+00'
  ),
  (
    '6e000000-0000-4000-8000-000000000009',
    '6d000000-0000-4000-8000-000000000013', '2026-07-11', true,
    'absence', 0, 'confirmed', '未设置', null, 0, 0,
    '6d000000-0000-4000-8000-000000000001',
    '2026-07-11 13:00:00+00', '2026-07-11 13:00:00+00',
    '2026-07-11 13:00:00+00'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select ok(
  (
    with resolved as (
      select employee
      from jsonb_array_elements(
        public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
          ->'employees'
      ) employee
      where employee->>'employeeProfileId' in (
        '6d000000-0000-4000-8000-000000000005',
        '6d000000-0000-4000-8000-000000000013',
        '6d000000-0000-4000-8000-000000000014'
      )
    )
    select
      count(*) = 3
      and bool_and(employee->'issueCodes' = '[]'::jsonb)
      and bool_and(
        case employee->>'employeeProfileId'
          when '6d000000-0000-4000-8000-000000000005' then
            employee->>'dayStatus' = 'full_day'
          when '6d000000-0000-4000-8000-000000000013' then
            employee->>'dayStatus' = 'absence'
          when '6d000000-0000-4000-8000-000000000014' then
            employee->>'dayStatus' = 'half_day'
          else false
        end
      )
      and bool_and(jsonb_array_length(employee->'sessions') > 0)
      and bool_or(
        employee->>'employeeProfileId' =
          '6d000000-0000-4000-8000-000000000005'
        and (employee->>'hasAbnormalLocation')::boolean
        and jsonb_array_length(employee->'sessions') = 2
        and employee->>'firstClockInAt' is not null
        and employee->>'lastClockOutAt' is not null
      )
    from resolved
  ),
  'confirmed resolutions replace issues and status while preserving raw facts'
);

select ok(
  (
    with dashboard as (
      select public.list_daily_attendance_dashboard_secure(
        '2026-07-11'::date
      ) result
    ), employees as (
      select employee->>'employeeProfileId' employee_id
      from dashboard
      cross join lateral jsonb_array_elements(result->'employees') employee
    )
    select
      (select count(*) from employees) = 11
      and (select count(distinct employee_id) from employees) = 11
      and exists (
        select 1 from employees
        where employee_id = '6d000000-0000-4000-8000-000000000010'
      )
      and not exists (
        select 1 from employees
        where employee_id in (
          '6d000000-0000-4000-8000-000000000011',
          '6d000000-0000-4000-8000-000000000012'
        )
      )
  ),
  'employment interval is inclusive and every employee appears at most once'
);

select is(
  (
    select array_agg(key order by key)
    from jsonb_object_keys(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
    ) key
  ),
  array[
    'employees', 'filters', 'permissions', 'serverNowTokyo',
    'settings', 'summary', 'workDate'
  ]::text[],
  'daily dashboard has the exact stable top-level DTO keys'
);

select is(
  (
    select array_agg(key order by key)
    from jsonb_object_keys(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'summary'
    ) key
  ),
  array[
    'abnormalLocation', 'alertCount', 'early', 'excused', 'late',
    'missingClockIn', 'missingClockOut', 'normalCompleted',
    'overtimePending', 'requiredEmployees', 'totalEmployees', 'working'
  ]::text[],
  'dashboard summary has stable counters'
);

select is(
  (
    select array_agg(key order by key)
    from jsonb_object_keys(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'filters'
    ) key
  ),
  array['dayStatuses', 'departments', 'issueCodes', 'projects']::text[],
  'dashboard filters have stable option groups'
);

select ok(
  (
    select
      jsonb_array_length(projects) = 1
      and projects->0->>'projectId' = 'P-ACCOUNTING-FINITE-TEST'
    from (
      select public.list_daily_attendance_dashboard_secure(
        '2026-07-11'::date
      ) #> '{filters,projects}' projects
    ) dashboard
  ),
  'project filters deduplicate renamed snapshots by stable project ID'
);

select is(
  (
    select array_agg(key order by key)
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    cross join lateral jsonb_object_keys(employee) key
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000004'
  ),
  array[
    'dayStatus', 'department', 'employeeNumber', 'employeeProfileId',
    'firstClockInAt', 'hasAbnormalLocation', 'hasOpenSession', 'issueCodes',
    'lastClockOutAt', 'name', 'position', 'resolution', 'salary',
    'scheduleRequired', 'sessions', 'workedMinutesReference'
  ]::text[],
  'salary-authorized employee rows have an exact narrow DTO shape'
);

select is(
  public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
    ->'permissions',
  '{
    "canResolve": true,
    "canViewSalary": true,
    "canUpdateSalary": true,
    "canViewProjectCosts": true,
    "canUpdateProjectCosts": true,
    "canUpdateSettings": false
  }'::jsonb,
  'permission booleans are computed from the approved existing keys'
);

select is(
  (
    select employee->'salary'
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' =
      '6d000000-0000-4000-8000-000000000004'
  ),
  '{
    "salaryType": "月薪",
    "baseSalary": 320000,
    "dailySalary": null,
    "hourlyWage": null,
    "salaryRemark": "最高机密"
  }'::jsonb,
  'salary-authorized dashboard returns only the canonical salary projection'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select is(
  public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
    ->'permissions',
  '{
    "canResolve": false,
    "canViewSalary": false,
    "canUpdateSalary": false,
    "canViewProjectCosts": false,
    "canUpdateProjectCosts": false,
    "canUpdateSettings": false
  }'::jsonb,
  'a labor-only viewer receives no invented capabilities'
);

select ok(
  (
    with dashboard as (
      select public.list_daily_attendance_dashboard_secure(
        '2026-07-11'::date
      ) result
    )
    select
      not exists (
        select 1
        from dashboard
        cross join lateral jsonb_array_elements(result->'employees') employee
        where employee ? 'salary'
      )
      and result::text !~
        '(baseSalary|dailySalary|hourlyWage|salaryRemark|salaryTypeSnapshot|baseSalarySnapshot|dailySalarySnapshot|hourlyWageSnapshot|suggestedProjectCost|finalProjectCost|最高机密|320000|13333)'
    from dashboard
  ),
  'salary-less callers receive no wage, salary, or employee-cost values anywhere'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000003', true
);
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure('2026-07-11'::date)$$,
  '42501', 'labor accountant required',
  'viewer without labor permission is denied'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure(null::date)$$,
  '22023', 'valid work date required',
  'null dashboard dates are rejected after actor authorization'
);
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure('not-a-date'::date)$$,
  '22007', null,
  'invalid textual dashboard dates fail closed at the typed boundary'
);
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure('infinity'::date)$$,
  '22023', 'valid work date required',
  'positive-infinite dashboard dates are rejected'
);
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure('-infinity'::date)$$,
  '22023', 'valid work date required',
  'negative-infinite dashboard dates are rejected'
);

select ok(
  (
    with dashboard as (
      select public.list_daily_attendance_dashboard_secure(
        (statement_timestamp() at time zone 'Asia/Tokyo')::date
      ) result
    ), alert as (
      select public.get_labor_alert_count_secure() result
    )
    select
      (select array_agg(key order by key)
        from jsonb_object_keys(alert.result) key) =
        array['count', 'refreshedAt', 'workDate']::text[]
      and alert.result->>'workDate' = dashboard.result->>'workDate'
      and (alert.result->>'count')::integer =
        (dashboard.result#>>'{summary,alertCount}')::integer
      and (alert.result->>'refreshedAt')::timestamptz =
        (dashboard.result->>'serverNowTokyo')::timestamptz
    from dashboard, alert
  ),
  'alert count reuses today dashboard classification and has a stable DTO'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000003', true
);
select throws_ok(
  $$select public.get_labor_alert_count_secure()$$,
  '42501', 'labor accountant required',
  'alert count propagates authorization failures instead of returning zero'
);
reset role;

set local role anon;
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure('2026-07-11'::date)$$,
  '42501', null,
  'anonymous cannot execute the daily dashboard RPC'
);
select throws_ok(
  $$select public.get_labor_alert_count_secure()$$,
  '42501', null,
  'anonymous cannot execute the alert count RPC'
);
reset role;

select * from finish();
rollback;

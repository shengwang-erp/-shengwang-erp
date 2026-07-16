begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select plan(217);

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
    'full_day', 1, 'month_locked', '日薪', 12000, 12000, 12000,
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
            and employee #>> '{resolution,accountingStatus}' = 'month_locked'
          when '6d000000-0000-4000-8000-000000000013' then
            employee->>'dayStatus' = 'absence'
            and employee #>> '{resolution,accountingStatus}' = 'confirmed'
          when '6d000000-0000-4000-8000-000000000014' then
            employee->>'dayStatus' = 'half_day'
            and employee #>> '{resolution,accountingStatus}' = 'confirmed'
          else false
        end
      )
      and bool_and(jsonb_array_length(employee->'sessions') > 0)
      and bool_or(
        employee->>'employeeProfileId' =
          '6d000000-0000-4000-8000-000000000005'
        and (employee->>'hasAbnormalLocation')::boolean
        and jsonb_array_length(employee->'sessions') = 2
        and (employee->>'firstClockInAt')::timestamptz =
          '2026-07-11 08:15:00+09'::timestamptz
        and (employee->>'lastClockOutAt')::timestamptz =
          '2026-07-11 18:30:00+09'::timestamptz
        and employee #>> '{sessions,0,clockInEvent,result}' = 'abnormal'
        and employee #>> '{sessions,0,clockInEvent,abnormalReason}' =
          '定位范围外'
      )
    from resolved
  ),
  'confirmed and month-locked resolutions take precedence while preserving raw facts'
);

reset role;

insert into public.employee_profiles (
  id, employee_number, name, department, position,
  employment_status, hire_date, resign_date, account_status,
  must_change_password, is_hidden_system_account
) values
  (
    '6d000000-0000-4000-8000-000000000017', 'SW-6817',
    '离职缺入职日', '工程部', '小工', '离职', null, '2026-12-31',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000018', 'SW-6818',
    '离职缺离职日', '工程部', '小工', '离职', '2026-01-01', null,
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000019', 'SW-6819',
    '离职负无穷入职日', '工程部', '小工', '离职', '-infinity', '2026-12-31',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000020', 'SW-6820',
    '离职正无穷离职日', '工程部', '小工', '离职', '2026-01-01', 'infinity',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000021', 'SW-6821',
    '离职正无穷入职日', '工程部', '小工', '离职', 'infinity', '2026-12-31',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000022', 'SW-6822',
    '离职负无穷离职日', '工程部', '小工', '离职', '2026-01-01', '-infinity',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000023', 'SW-6823',
    '离职区间倒置', '工程部', '小工', '离职', '2026-07-12', '2026-07-10',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000024', 'SW-6824',
    '在职负无穷入职日', '工程部', '小工', '在职', '-infinity', null,
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000025', 'SW-6825',
    '休假正无穷入职日', '工程部', '小工', '休假', 'infinity', null,
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000026', 'SW-6826',
    '停工正无穷离职日', '工程部', '小工', '停工', null, 'infinity',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000027', 'SW-6827',
    '在职负无穷离职日', '工程部', '小工', '在职', null, '-infinity',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000028', 'SW-6828',
    '休假区间倒置', '工程部', '小工', '休假', '2026-07-12', '2026-07-10',
    'active', true, false
  ),
  (
    '6d000000-0000-4000-8000-000000000029', 'SW-6829',
    '停工开放入职边界', '工程部', '小工', '停工', null, '2026-12-31',
    'active', true, false
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  (
    select count(*)
    from jsonb_array_elements(
      public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
        ->'employees'
    ) employee
    where employee->>'employeeProfileId' in (
      '6d000000-0000-4000-8000-000000000017',
      '6d000000-0000-4000-8000-000000000018',
      '6d000000-0000-4000-8000-000000000019',
      '6d000000-0000-4000-8000-000000000020',
      '6d000000-0000-4000-8000-000000000021',
      '6d000000-0000-4000-8000-000000000022',
      '6d000000-0000-4000-8000-000000000023',
      '6d000000-0000-4000-8000-000000000024',
      '6d000000-0000-4000-8000-000000000025',
      '6d000000-0000-4000-8000-000000000026',
      '6d000000-0000-4000-8000-000000000027',
      '6d000000-0000-4000-8000-000000000028'
    )
  ),
  0::bigint,
  'former missing-bound and all non-finite or reversed intervals fail closed'
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
      (select count(*) from employees) = 12
      and (select count(distinct employee_id) from employees) = 12
      and exists (
        select 1 from employees
        where employee_id = '6d000000-0000-4000-8000-000000000010'
      )
      and exists (
        select 1 from employees
        where employee_id = '6d000000-0000-4000-8000-000000000029'
      )
      and not exists (
        select 1 from employees
        where employee_id in (
          '6d000000-0000-4000-8000-000000000011',
          '6d000000-0000-4000-8000-000000000012'
        )
      )
  ),
  'finite employment intervals are inclusive and current open bounds remain compatible'
);

reset role;
delete from public.employee_profiles
where id in (
  '6d000000-0000-4000-8000-000000000017',
  '6d000000-0000-4000-8000-000000000018',
  '6d000000-0000-4000-8000-000000000019',
  '6d000000-0000-4000-8000-000000000020',
  '6d000000-0000-4000-8000-000000000021',
  '6d000000-0000-4000-8000-000000000022',
  '6d000000-0000-4000-8000-000000000023',
  '6d000000-0000-4000-8000-000000000024',
  '6d000000-0000-4000-8000-000000000025',
  '6d000000-0000-4000-8000-000000000026',
  '6d000000-0000-4000-8000-000000000027',
  '6d000000-0000-4000-8000-000000000028',
  '6d000000-0000-4000-8000-000000000029'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
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

reset role;
update public.employee_profiles
set daily_salary = 12000
where id = '6d000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
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
    "salaryType": "未设置",
    "baseSalary": null,
    "dailySalary": null,
    "hourlyWage": null,
    "salaryRemark": "最高机密"
  }'::jsonb,
  'dashboard salary projection uses the canonical exactly-one-field oracle'
);
reset role;
update public.employee_profiles
set daily_salary = null
where id = '6d000000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
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

reset role;
insert into public.permission_grants (
  subject_type, subject_code, permission_key
) values
  ('position', '会计', 'sensitive.salary_view'),
  ('position', '会计', 'sensitive.salary_update'),
  ('position', '会计', 'module.project_costs.view'),
  ('position', '会计', 'module.project_costs.update'),
  ('position', '会计', 'module.settings.update');
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select is(
  public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
    ->'permissions',
  '{
    "canResolve": false,
    "canViewSalary": true,
    "canUpdateSalary": false,
    "canViewProjectCosts": true,
    "canUpdateProjectCosts": false,
    "canUpdateSettings": true
  }'::jsonb,
  'missing labor update independently closes both composite update permissions'
);

reset role;
insert into public.permission_grants (
  subject_type, subject_code, permission_key
) values ('position', '会计', 'module.labor.update');
delete from public.permission_grants
where subject_type = 'position'
  and subject_code = '会计'
  and permission_key = 'module.project_costs.update';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select is(
  public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
    ->'permissions',
  '{
    "canResolve": true,
    "canViewSalary": true,
    "canUpdateSalary": true,
    "canViewProjectCosts": true,
    "canUpdateProjectCosts": false,
    "canUpdateSettings": true
  }'::jsonb,
  'missing project-cost update closes only its composite update permission'
);

reset role;
insert into public.permission_grants (
  subject_type, subject_code, permission_key
) values ('position', '会计', 'module.project_costs.update');
delete from public.permission_grants
where subject_type = 'position'
  and subject_code = '会计'
  and permission_key = 'sensitive.salary_update';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select is(
  public.list_daily_attendance_dashboard_secure('2026-07-11'::date)
    ->'permissions',
  '{
    "canResolve": true,
    "canViewSalary": true,
    "canUpdateSalary": false,
    "canViewProjectCosts": true,
    "canUpdateProjectCosts": false,
    "canUpdateSettings": true
  }'::jsonb,
  'missing salary update independently closes both composite update permissions'
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

-- Task 4: authoritative resolution, payroll, project-cost, settings, and bridge workflows.

select has_column(
  'public', 'attendance_accounting_settings', 'version',
  'settings carry an optimistic concurrency version'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace schema on schema.oid = procedure.pronamespace
    where schema.nspname = 'public'
      and (procedure.proname, pg_catalog.oidvectortypes(procedure.proargtypes)) in (
        values
          ('get_attendance_resolution_detail_secure', 'uuid, date'),
          ('save_attendance_resolution_draft_secure', 'uuid, date, text, numeric, numeric, jsonb, text, integer'),
          ('confirm_attendance_resolution_secure', 'uuid, date, text, numeric, numeric, jsonb, text, integer'),
          ('list_monthly_payroll_secure', 'date, text, uuid, boolean'),
          ('save_monthly_payroll_draft_secure', 'uuid, date, numeric, numeric, numeric, text, integer'),
          ('confirm_monthly_payroll_secure', 'uuid, date, numeric, numeric, numeric, text, integer'),
          ('reopen_monthly_payroll_secure', 'uuid, text, integer'),
          ('list_project_labor_costs_secure', 'date, text, uuid, text'),
          ('export_project_labor_costs_secure', 'date, text, uuid'),
          ('get_attendance_accounting_settings_secure', ''),
          ('update_attendance_accounting_settings_secure', 'date, smallint[], time without time zone, time without time zone, integer, integer, integer'),
          ('get_attendance_accounting_bridge_secure', 'date')
      )
  ),
  12::bigint,
  'all twelve Task 4 public RPCs have the exact approved input signatures'
);

select is(
  (
    select procedure.proargnames[2]
    from pg_catalog.pg_proc procedure
    where procedure.oid =
      'public.list_project_labor_costs_secure(date,text,uuid,text)'::regprocedure
  ),
  'p_status',
  'project labor report exposes status rather than free-text search as its second named argument'
);

select ok(
  (
    select count(*) = 12
      and bool_and(procedure.prosecdef)
      and bool_and(pg_get_function_result(procedure.oid) = 'jsonb')
      and bool_and(
        procedure.proconfig = array['search_path=pg_catalog, public']::text[]
      )
      and bool_and(not has_function_privilege('anon', procedure.oid, 'EXECUTE'))
      and bool_and(has_function_privilege('authenticated', procedure.oid, 'EXECUTE'))
      and bool_and(has_function_privilege('service_role', procedure.oid, 'EXECUTE'))
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
      and procedure.proname in (
        'get_attendance_resolution_detail_secure',
        'save_attendance_resolution_draft_secure',
        'confirm_attendance_resolution_secure',
        'list_monthly_payroll_secure',
        'save_monthly_payroll_draft_secure',
        'confirm_monthly_payroll_secure',
        'reopen_monthly_payroll_secure',
        'list_project_labor_costs_secure',
        'export_project_labor_costs_secure',
        'get_attendance_accounting_settings_secure',
        'update_attendance_accounting_settings_secure',
        'get_attendance_accounting_bridge_secure'
      )
  ),
  'Task 4 RPCs are exact jsonb SECURITY DEFINER surfaces with closed ACLs'
);

select ok(
  (
    select count(*) = 12
      and bool_and(
        case
          when procedure.proname in (
            'save_attendance_resolution_draft_secure',
            'confirm_attendance_resolution_secure',
            'save_monthly_payroll_draft_secure',
            'confirm_monthly_payroll_secure',
            'reopen_monthly_payroll_secure',
            'update_attendance_accounting_settings_secure'
          ) then procedure.provolatile = 'v'
          else procedure.provolatile = 's'
        end
      )
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace schema on schema.oid = procedure.pronamespace
    where schema.nspname = 'public'
      and procedure.proname in (
        'get_attendance_resolution_detail_secure',
        'save_attendance_resolution_draft_secure',
        'confirm_attendance_resolution_secure',
        'list_monthly_payroll_secure',
        'save_monthly_payroll_draft_secure',
        'confirm_monthly_payroll_secure',
        'reopen_monthly_payroll_secure',
        'list_project_labor_costs_secure',
        'export_project_labor_costs_secure',
        'get_attendance_accounting_settings_secure',
        'update_attendance_accounting_settings_secure',
        'get_attendance_accounting_bridge_secure'
      )
  ),
  'read RPCs are stable and write RPCs remain volatile'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint constraint_definition
    join pg_catalog.pg_class relation
      on relation.oid = constraint_definition.conrelid
    join pg_catalog.pg_namespace schema
      on schema.oid = relation.relnamespace
    where schema.nspname = 'public'
      and relation.relname = 'attendance_accounting_settings'
      and constraint_definition.contype = 'c'
      and pg_get_expr(
        constraint_definition.conbin, constraint_definition.conrelid
      ) ~ 'version >= 1'
  ),
  'settings versions cannot be zero or negative once persisted'
);

select ok(
  position(
    'pg_advisory_xact_lock_shared' in pg_get_functiondef(
      'private.attendance_write_resolution(uuid,date,text,numeric,numeric,jsonb,text,integer,boolean)'::regprocedure
    )
  ) > 0
  and position(
    'attendance_accounting_settings' in pg_get_functiondef(
      'private.attendance_write_resolution(uuid,date,text,numeric,numeric,jsonb,text,integer,boolean)'::regprocedure
    )
  ) > 0
  and position(
    'pg_advisory_xact_lock_shared' in pg_get_functiondef(
      'private.attendance_write_monthly_payroll(uuid,date,numeric,numeric,numeric,text,integer,boolean)'::regprocedure
    )
  ) > 0
  and position(
    'pg_advisory_xact_lock' in pg_get_functiondef(
      'public.update_attendance_accounting_settings_secure(date,smallint[],time without time zone,time without time zone,integer,integer,integer)'::regprocedure
    )
  ) > 0,
  'settings, day, and payroll writes share the canonical settings lock boundary'
);

select ok(
  (
    select count(*) = 21
      and bool_and(procedure.prosecdef)
      and bool_and(procedure.proconfig @> array['search_path=pg_catalog, public'])
      and bool_and(not has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      ))
      and bool_and(not has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      ))
      and bool_and(pg_get_functiondef(procedure.oid) !~* '\m(EXECUTE|format)\M')
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace schema on schema.oid = procedure.pronamespace
    where schema.nspname = 'private'
      and procedure.proname in (
        'attendance_valid_yen',
        'attendance_trim_text',
        'attendance_valid_business_date',
        'attendance_require_safe_aggregate',
        'attendance_parse_iso_date',
        'attendance_legacy_yen',
        'attendance_legacy_salary_amount',
        'attendance_legacy_salary_json',
        'attendance_legacy_labor_json',
        'attendance_employee_is_eligible',
        'attendance_schedule_required',
        'attendance_salary_json',
        'attendance_resolution_result',
        'attendance_resolution_snapshot',
        'attendance_payroll_snapshot',
        'attendance_write_resolution',
        'attendance_month_counts',
        'attendance_payroll_preview',
        'attendance_payroll_result',
        'attendance_write_monthly_payroll',
        'attendance_official_project_rows'
      )
  ),
  'Task 4 private helpers are owner-only pinned SECURITY DEFINER code without dynamic SQL'
);

set local datestyle = 'SQL, DMY';
select is(
  private.attendance_parse_iso_date('2026-06-30'),
  date '2026-06-30',
  'strict ISO legacy date parsing is independent of the caller DateStyle'
);
set local datestyle = 'ISO, MDY';

select is(
  private.attendance_legacy_yen(
    jsonb_build_object('amount', repeat('0', 1000) || '1'), 'amount'
  ),
  null::numeric,
  'legacy yen parsing rejects oversized numeric text before casting'
);

select ok(
  private.attendance_legacy_labor_json(
    '{"workDate":"1899-12-31","projectId":"P-OLD","projectName":"域外","employeeId":"E-OLD","employeeName":"域外员工","laborCost":1}'::jsonb
  ) is null
  and private.attendance_legacy_labor_json(
    '{"workDate":"2101-01-01","projectId":"P-FUTURE","projectName":"域外","employeeId":"E-FUTURE","employeeName":"域外员工","laborCost":1}'::jsonb
  ) is null
  and private.attendance_legacy_salary_json(
    '{"salaryMonth":"1899-12","employeeId":"E-OLD","employeeName":"域外员工","baseSalary":1,"overtimePay":0,"bonus":0,"deduction":0}'::jsonb
  ) is null
  and private.attendance_legacy_salary_json(
    '{"salaryMonth":"2101-01","employeeId":"E-FUTURE","employeeName":"域外员工","baseSalary":1,"overtimePay":0,"bonus":0,"deduction":0}'::jsonb
  ) is null,
  'strict legacy parsers quarantine dates outside the supported business domain'
);

select ok(
  private.attendance_legacy_labor_json(jsonb_build_object(
    'workDate', '2026-06-30', 'projectId', 'P-OLD',
    'projectName', repeat('界', 501), 'employeeId', 'E-OLD',
    'employeeName', '旧员工', 'laborCost', 1
  )) is null
  and private.attendance_legacy_labor_json(jsonb_build_object(
    'workDate', '2026-06-30', 'projectId', 'P-OLD',
    'projectName', '旧项目', 'employeeId', repeat('E', 501),
    'employeeName', '旧员工', 'laborCost', 1
  )) is null
  and private.attendance_legacy_labor_json(jsonb_build_object(
    'workDate', '2026-06-30', 'projectId', 'P-OLD',
    'projectName', '旧项目', 'employeeId', 'E-OLD',
    'employeeName', repeat('人', 501), 'laborCost', 1
  )) is null,
  'strict legacy labor parsing bounds labels and employee identity strings'
);

select ok(
  private.attendance_legacy_salary_json(jsonb_build_object(
    'salaryMonth', '2026-06', 'employeeId', E'\t\n',
    'employeeName', '旧员工', 'baseSalary', 1,
    'overtimePay', 0, 'bonus', 0, 'deduction', 0
  )) is null
  and private.attendance_legacy_salary_json(jsonb_build_object(
    'salaryMonth', '2026-06', 'employeeId', 'E-OLD',
    'employeeName', E'\t\n', 'baseSalary', 1,
    'overtimePay', 0, 'bonus', 0, 'deduction', 0
  )) is null
  and private.attendance_legacy_labor_json(jsonb_build_object(
    'workDate', '2026-06-30', 'projectId', E'\t\n',
    'projectName', '旧项目', 'employeeId', 'E-OLD',
    'employeeName', '旧员工', 'laborCost', 1
  )) is null,
  'strict legacy parsers reject identifiers containing only non-space whitespace'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '74000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'task4-viewer@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '74000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'task4-no-project-update@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '74000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'task4-project-viewer@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '74000000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'task4-update-no-view@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '74000000-0000-4000-8000-000000000005',
    'authenticated', 'authenticated', 'task4-labor-only@auth.invalid', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.employee_profiles (
  id, employee_number, auth_user_id, name, department, position,
  employment_status, hire_date, account_status, must_change_password,
  is_hidden_system_account
) values
  (
    '74100000-0000-4000-8000-000000000001', 'SW-7411',
    '74000000-0000-4000-8000-000000000001', '工资只读查看者', '设计部', '设计师',
    '在职', '2026-01-01', 'active', false, false
  ),
  (
    '74100000-0000-4000-8000-000000000002', 'SW-7412',
    '74000000-0000-4000-8000-000000000002', '缺项目更新核算员', '设计部', '主任设计师',
    '在职', '2026-01-01', 'active', false, false
  ),
  (
    '74100000-0000-4000-8000-000000000003', 'SW-7413',
    '74000000-0000-4000-8000-000000000003', '项目合计查看者', '工程部', '部长',
    '在职', '2026-01-01', 'active', false, false
  ),
  (
    '74100000-0000-4000-8000-000000000004', 'SW-7414',
    '74000000-0000-4000-8000-000000000004', '工资可更新不可查看', '仓库管理部', '仓库管理员',
    '在职', '2026-01-01', 'active', false, false
  ),
  (
    '74100000-0000-4000-8000-000000000005', 'SW-7415',
    '74000000-0000-4000-8000-000000000005', '纯考勤核算员', '工程部', '小工',
    '在职', '2026-01-01', 'active', false, false
  );

insert into public.permission_grants (
  subject_type, subject_code, permission_key
) values
  ('position', '设计师', 'module.labor.view'),
  ('position', '设计师', 'sensitive.salary_view'),
  ('position', '主任设计师', 'module.labor.view'),
  ('position', '主任设计师', 'module.labor.update'),
  ('position', '主任设计师', 'sensitive.salary_view'),
  ('position', '主任设计师', 'sensitive.salary_update'),
  ('position', '主任设计师', 'module.project_costs.view'),
  ('position', '部长', 'module.labor.view'),
  ('position', '部长', 'module.project_costs.view'),
  ('position', '仓库管理员', 'module.labor.view'),
  ('position', '仓库管理员', 'module.labor.update'),
  ('position', '仓库管理员', 'module.project_costs.update'),
  ('position', '仓库管理员', 'sensitive.salary_update'),
  ('position', '小工', 'module.labor.view'),
  ('position', '小工', 'module.labor.update'),
  ('position', '会计主管', 'module.settings.update')
on conflict do nothing;

insert into public.employee_profiles (
  id, employee_number, name, department, position, employment_status,
  hire_date, resign_date, account_status, must_change_password,
  is_hidden_system_account, base_salary, daily_salary, hourly_wage
) values
  (
    '75000000-0000-4000-8000-000000000001', 'SW-7501', '日薪工作流员工',
    '工程部', '大工', '在职', '2026-08-03', '2026-08-03',
    'active', true, false, null, 12001, null
  ),
  (
    '75000000-0000-4000-8000-000000000002', 'SW-7502', '月薪公式员工',
    '工程部', '大工', '在职', '2026-08-03', '2026-08-03',
    'active', true, false, 320000, null, null
  ),
  (
    '75000000-0000-4000-8000-000000000003', 'SW-7503', '时薪公式员工',
    '工程部', '大工', '在职', '2026-08-03', '2026-08-03',
    'active', true, false, null, null, 1500
  ),
  (
    '75000000-0000-4000-8000-000000000004', 'SW-7504', '缺工资员工',
    '工程部', '大工', '在职', '2026-08-03', '2026-08-03',
    'active', true, false, null, 12000, null
  ),
  (
    '75000000-0000-4000-8000-000000000005', 'SW-7505', '未完成月结员工',
    '工程部', '大工', '在职', '2026-08-03', '2026-08-04',
    'active', true, false, null, 10000, null
  ),
  (
    '75000000-0000-4000-8000-000000000006', 'SW-7506', '零金额休息员工',
    '工程部', '大工', '在职', '2026-08-04', '2026-08-04',
    'active', true, false, null, null, null
  ),
  (
    '75000000-0000-4000-8000-000000000007', 'SW-7507', '缺工资无场次员工',
    '工程部', '大工', '在职', '2026-08-05', '2026-08-05',
    'active', true, false, null, null, null
  ),
  (
    '75000000-0000-4000-8000-000000000008', 'SW-7508', '启用边界月薪员工',
    '工程部', '大工', '在职', '2026-07-16', '2026-07-16',
    'active', true, false, 30000, null, null
  ),
  (
    '75000000-0000-4000-8000-000000000009', 'SW-7509', '草稿项目员工',
    '工程部', '大工', '在职', '2026-07-17', '2026-07-17',
    'active', true, false, null, 4000, null
  ),
  (
    '75000000-0000-4000-8000-000000000010', 'SW-7510', '周日实际出勤员工',
    '工程部', '大工', '在职', '2026-08-09', '2026-08-09',
    'active', true, false, null, 10000, null
  ),
  (
    '75000000-0000-4000-8000-000000000011', 'SW-7511', '周日草稿员工',
    '工程部', '大工', '在职', '2026-08-16', '2026-08-16',
    'active', true, false, null, 10000, null
  ),
  (
    '75000000-0000-4000-8000-000000000012', 'SW-7512', '更新不可查看工资员工',
    '工程部', '大工', '在职', '2026-08-17', '2026-08-17',
    'active', true, false, null, 10000, null
  );

insert into public.projects (record_key, payload, status) values
  ('P-T4-A', '{"projectId":"P-T4-A","projectName":"  项目甲  "}'::jsonb, 'active'),
  ('P-T4-B', '{"projectId":"P-T4-B","projectName":"项目乙"}'::jsonb, 'active'),
  ('P-T4-DELETED', '{"projectId":"P-T4-DELETED","projectName":"已删除"}'::jsonb, 'deleted');

insert into public.project_attendance_sessions (
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at
) values (
  '75100000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000004', 'SW-7504', '缺工资员工',
  'P-T4-A', '项目甲', '東京都', 35.68, 139.76, 300,
  '2026-08-03', 'open', '2026-08-03 08:00:00+09'
);

insert into public.project_attendance_sessions (
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at, closed_at
) values (
  '75100000-0000-4000-8000-000000000002',
  '75000000-0000-4000-8000-000000000010', 'SW-7510', '周日实际出勤员工',
  'P-T4-A', '项目甲', '東京都', 35.68, 139.76, 300,
  '2026-08-09', 'closed',
  '2026-08-09 08:00:00+09', '2026-08-09 17:00:00+09'
);

create temporary table task4_event_guard as
select
  count(*)::bigint row_count,
  md5(coalesce(jsonb_agg(to_jsonb(event) order by event.event_id)::text, '[]')) bytes
from public.project_attendance_events event;

delete from public.attendance_accounting_settings;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  public.get_attendance_accounting_settings_secure(),
  '{
    "configured": false,
    "effectiveFrom": null,
    "workWeekdays": [1,2,3,4,5,6],
    "workStartTime": "08:00",
    "workEndTime": "17:00",
    "breakMinutes": 60,
    "standardDayMinutes": 480,
    "version": 0
  }'::jsonb,
  'public settings read returns the exact unconfigured preview and create version'
);

select is(
  public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[6, 1, 3, 2, 5, 4]::smallint[],
    '08:00', '17:00', 60, 480, 0
  ),
  '{
    "configured": true,
    "effectiveFrom": "2026-07-16",
    "workWeekdays": [1,2,3,4,5,6],
    "workStartTime": "08:00",
    "workEndTime": "17:00",
    "breakMinutes": 60,
    "standardDayMinutes": 480,
    "version": 1
  }'::jsonb,
  'first authorized settings save inserts sorted defaults with version one'
);

reset role;
select is(
  (
    select updated_by_employee_profile_id
    from public.attendance_accounting_settings
    where settings_key = 'default'
  ),
  '6d000000-0000-4000-8000-000000000001'::uuid,
  'settings updater is derived from the authenticated canonical actor'
);

create or replace function pg_temp.task4_settings_time_precision_probe(
  p_work_start_time time without time zone,
  p_work_end_time time without time zone
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caught_message text;
begin
  begin
    perform public.update_attendance_accounting_settings_secure(
      '2026-07-16', array[1,2,3,4,5,6]::smallint[],
      p_work_start_time, p_work_end_time, 60, 480, 1
    );
    raise exception using errcode = 'PT410', message = 'ACCEPTED';
  exception when sqlstate 'PT410' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_settings_time_precision_probe('07:59:59', '17:00'),
  '22023:valid attendance schedule required',
  'settings reject nonzero whole seconds that the minute DTO cannot round-trip'
);
select is(
  pg_temp.task4_settings_time_precision_probe('08:00', '17:00:00.1'),
  '22023:valid attendance schedule required',
  'settings reject fractional seconds that the minute DTO cannot round-trip'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000002', true
);
select throws_ok(
  $$select public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[1,2,3,4,5,6]::smallint[],
    '08:00', '17:00', 60, 480, 1
  )$$,
  '42501', 'attendance settings update permission required',
  'labor accountants without settings update cannot change settings'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.update_attendance_accounting_settings_secure(
    '2026-07-15', array[1,2,3,4,5,6]::smallint[],
    '08:00', '17:00', 60, 480, 1
  )$$,
  '55000',
  'effective_from cannot change after confirmed attendance; use an explicit database migration',
  'effective date cannot move after the first confirmed resolution'
);

reset role;
create or replace function pg_temp.task4_payroll_only_settings_guard()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caught_message text;
begin
  begin
    delete from public.attendance_project_allocations;
    delete from public.attendance_day_resolutions;
    delete from public.attendance_monthly_payrolls;
    insert into public.attendance_monthly_payrolls (
      employee_profile_id, salary_month, salary_type_snapshot,
      base_salary_snapshot, full_days, half_days, absence_days,
      base_pay, overtime_pay, bonus, deduction, net_salary,
      status, confirmation_note, confirmed_by_employee_profile_id,
      confirmed_at, version
    ) values (
      '6d000000-0000-4000-8000-000000000001', '2026-07-01', '月薪',
      0, 0, 0, 0, 0, 0, 0, 0, 0,
      'confirmed', '', '6d000000-0000-4000-8000-000000000001',
      statement_timestamp(), 1
    );
    begin
      perform public.update_attendance_accounting_settings_secure(
        '2026-07-15', array[1,2,3,4,5,6]::smallint[],
        '08:00', '17:00', 60, 480, 1
      );
      raise exception using errcode = 'PT401', message = 'NO_ERROR';
    exception when sqlstate '55000' then
      get stacked diagnostics caught_message = message_text;
      raise exception using
        errcode = 'PT401', message = '55000:' || caught_message;
    end;
  exception when sqlstate 'PT401' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

select is(
  pg_temp.task4_payroll_only_settings_guard(),
  '55000:effective_from cannot change after confirmed attendance; use an explicit database migration',
  'confirmed payroll alone freezes the activation boundary'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select throws_ok(
  $$select public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[1,1,2]::smallint[],
    '08:00', '17:00', 60, 480, 1
  )$$,
  '22023', 'valid unique work weekdays required',
  'settings reject duplicate weekdays instead of silently deduplicating them'
);

select throws_ok(
  $$select public.update_attendance_accounting_settings_secure(
    '2101-01-01', array[1,2,3,4,5,6]::smallint[],
    '08:00', '17:00', 60, 480, 1
  )$$,
  '22023', 'effective date must be between 1900-01-01 and 2100-12-31',
  'settings reject unsupported finite effective dates before date arithmetic'
);

select is(
  public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[6,5,4,3,2,1]::smallint[],
    '07:30', '17:30', 60, 480, 1
  )->>'version',
  '2',
  'settings update locks, sorts, and increments its version'
);

select throws_ok(
  $$select public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[1,2,3,4,5,6]::smallint[],
    '08:00', '17:00', 60, 480, 1
  )$$,
  '40001', 'attendance accounting version conflict',
  'stale settings versions are rejected'
);

create or replace function pg_temp.task4_stale_settings_hint()
returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  caught_hint text;
begin
  perform public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[1,2,3,4,5,6]::smallint[],
    '08:00', '17:00', 60, 480, 1
  );
  return null;
exception when others then
  get stacked diagnostics caught_hint = pg_exception_hint;
  return caught_hint;
end;
$$;

select is(
  pg_temp.task4_stale_settings_hint(),
  'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT',
  'stale writes expose the stable version-conflict hint'
);

select ok(
  (
    with detail as (
      select public.get_attendance_resolution_detail_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-03'
      ) result
    )
    select
      (select array_agg(key order by key) from jsonb_object_keys(result) key)
        = array[
          'allocations', 'employee', 'facts', 'hasMoneyScope', 'permissions',
          'resolution', 'salary', 'scheduleRequired', 'workDate'
        ]::text[]
      and result#>>'{employee,employeeName}' = '日薪工作流员工'
      and result#>>'{salary,salaryType}' = '日薪'
      and (result#>>'{salary,suggestedProjectCost}')::numeric = 12001
      and result->'hasMoneyScope' = 'false'::jsonb
      and result->'resolution' = 'null'::jsonb
      and result->'allocations' = '[]'::jsonb
    from detail
  ),
  'resolution detail has stable keys and server-derived salary suggestion'
);

select throws_ok(
  $$select public.get_attendance_resolution_detail_secure(
    '75000000-0000-4000-8000-000000000001', 'infinity'::date
  )$$,
  '22023', 'valid work date required',
  'resolution detail rejects non-finite dates'
);

select throws_ok(
  $$select public.get_attendance_resolution_detail_secure(
    '75000000-0000-4000-8000-000000000001', '2101-01-01'
  )$$,
  '22023', 'work date must be between 1900-01-01 and 2100-12-31',
  'day RPCs reject unsupported finite business dates'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000006', '2026-08-04',
    'rest', 0, 0, '[]'::jsonb, '', 0
  )$$,
  '42501', 'attendance resolution update permission required',
  'salary viewers cannot update attendance resolution state'
);

select ok(
  (
    with detail as (
      select public.get_attendance_resolution_detail_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-03'
      ) result
    )
    select (result#>>'{salary,dailySalary}')::numeric = 12001
      and result#>'{salary,suggestedProjectCost}' = 'null'::jsonb
      and result::text !~ '(finalProjectCost|"amount")'
    from detail
  ),
  'salary view without project-cost view does not leak project money'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select is(
  public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000006', '2026-08-04',
    'rest', 0, 0, '[]'::jsonb, '  休息  ', 0
  )#>>'{resolution,accountingStatus}',
  'draft',
  'labor-only accountants may save a trimmed zero-cost nonmoney resolution'
);

reset role;
update public.attendance_day_resolutions
set final_project_cost = 777
where employee_profile_id = '75000000-0000-4000-8000-000000000006'
  and work_date = '2026-08-04';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000005', true
);
select ok(
  (
    with detail as (
      select public.get_attendance_resolution_detail_secure(
        '75000000-0000-4000-8000-000000000006', '2026-08-04'
      ) result
    )
    select result->'hasMoneyScope' = 'true'::jsonb
      and (result#>>'{resolution,attendanceUnits}')::numeric = 0
      and result#>>'{permissions,canViewSalary}' = 'false'
      and result#>>'{permissions,canViewProjectCosts}' = 'false'
      and result->'salary' = 'null'::jsonb
      and result->'allocations' = '[]'::jsonb
      and result::text !~ '("finalProjectCost"|"amount"|777)'
    from detail
  ),
  'stored nonzero final cost sets money scope without leaking amounts to a labor-only viewer'
);

reset role;
update public.attendance_day_resolutions
set resolution_type = 'full_day', attendance_units = 1,
  final_project_cost = 0
where employee_profile_id = '75000000-0000-4000-8000-000000000006'
  and work_date = '2026-08-04';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000005', true
);
select is(
  public.get_attendance_resolution_detail_secure(
    '75000000-0000-4000-8000-000000000006', '2026-08-04'
  )->>'hasMoneyScope',
  'false',
  'positive attendance units alone do not create stored money scope'
);

reset role;
insert into public.attendance_project_allocations (
  resolution_id, project_id, project_name_snapshot, amount, allocation_note
) select
  resolution.resolution_id, 'P-T4-A', '项目甲', 321, ''
from public.attendance_day_resolutions resolution
where resolution.employee_profile_id =
    '75000000-0000-4000-8000-000000000006'
  and resolution.work_date = '2026-08-04';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000005', true
);
select ok(
  (
    with detail as (
      select public.get_attendance_resolution_detail_secure(
        '75000000-0000-4000-8000-000000000006', '2026-08-04'
      ) result
    )
    select result->'hasMoneyScope' = 'true'::jsonb
      and result#>>'{allocations,0,projectId}' = 'P-T4-A'
      and not ((result#>'{allocations,0}') ? 'amount')
      and result->'salary' = 'null'::jsonb
      and result::text !~ '("finalProjectCost"|321)'
    from detail
  ),
  'an existing allocation sets money scope while its amount remains redacted'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":12001,"allocationNote":""}]'::jsonb,
    '', 0
  )$$,
  '42501', 'project labor cost update permissions required',
  'missing salary-update independently blocks project money changes'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000002', true
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":12001,"allocationNote":""}]'::jsonb,
    '', 0
  )$$,
  '42501', 'project labor cost update permissions required',
  'missing project-cost update independently blocks project money changes'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 0.5, 0, '[]'::jsonb, '', 0
  )$$,
  '22023', 'resolution type and attendance units do not match',
  'resolution types map only to their canonical whole or half-day units'
);

select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 'NaN'::numeric, '[]'::jsonb, '', 0
  )$$,
  '22023', 'valid integer yen project cost required',
  'resolution money rejects NaN'
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 9007199254740992, '[]'::jsonb, '', 0
  )$$,
  '22023', 'valid integer yen project cost required',
  'resolution money rejects values above the safe integer range'
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":6000,"allocationNote":"","extra":1}]'::jsonb,
    '', 0
  )$$,
  '22023', 'invalid project allocations',
  'allocation objects reject missing or extra shape instead of passing JSON through'
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":" P-T4-A ","amount":6000,"allocationNote":""},
      {"projectId":"P-T4-A","amount":6001,"allocationNote":""}]'::jsonb,
    '', 0
  )$$,
  '22023', 'duplicate project allocation',
  'allocation project IDs are trimmed before duplicate detection'
);
select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-DELETED","amount":12001,"allocationNote":""}]'::jsonb,
    '', 0
  )$$,
  '22023', 'active project required',
  'deleted projects cannot be accepted into an allocation snapshot'
);

select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":12001,"allocationNote":""}]'::jsonb,
    '', 1
  )$$,
  '40001', 'attendance accounting version conflict',
  'absent day rows accept only create sentinel zero, never stored version one'
);

-- A deliberately broken implementation may accept the stale create above.  Keep
-- the rest of this contract independent so RED reports every finding at once.
reset role;
delete from public.attendance_project_allocations
where resolution_id in (
  select resolution_id
  from public.attendance_day_resolutions
  where employee_profile_id = '75000000-0000-4000-8000-000000000001'
    and work_date = '2026-08-03'
);
delete from public.attendance_day_resolutions
where employee_profile_id = '75000000-0000-4000-8000-000000000001'
  and work_date = '2026-08-03';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":5000,"allocationNote":" 草稿 "}]'::jsonb,
    ' 日结草稿 ', 0
  )#>>'{resolution,version}',
  '1',
  'unbalanced project allocations may be saved transactionally as a draft'
);

select ok(
  (
    with saved as (
      select public.save_attendance_resolution_draft_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-03',
        'full_day', 1, 12001,
        '[{"projectId":"P-T4-B","amount":6001,"allocationNote":"乙"},
          {"projectId":"P-T4-A","amount":6000,"allocationNote":"甲"}]'::jsonb,
        '日结草稿二', 1
      ) result
    )
    select result#>>'{resolution,version}' = '2'
      and result#>>'{allocations,0,projectId}' = 'P-T4-A'
      and result#>>'{allocations,0,projectName}' = '项目甲'
      and result#>>'{allocations,1,projectId}' = 'P-T4-B'
      and jsonb_array_length(result->'allocations') = 2
    from saved
  ),
  'draft replacement uses stable project order and server-owned trimmed names'
);

select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":6000,"allocationNote":""}]'::jsonb,
    '日结草稿二', 2
  )$$,
  '22023', 'project allocations do not balance',
  'unbalanced allocation is rejected'
);

select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000004', '2026-08-03',
    'full_day', 1, 0, '[]'::jsonb, '', 0
  )$$,
  '55000', 'attendance session is still open',
  'open attendance sessions block day confirmation'
);
select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000007', '2026-08-05',
    'full_day', 1, 0, '[]'::jsonb, '', 0
  )$$,
  '55000', 'employee salary standard is required',
  'whole-day project and payroll confirmation requires one canonical salary field'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000005', true
);
select is(
  public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000007', '2026-08-05',
    'rest', 0, 0, '[]'::jsonb, '', 0
  )#>>'{resolution,accountingStatus}',
  'draft',
  'exact labor-view and labor-update permissions can save zero-cost nonmoney days'
);
select is(
  public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000007', '2026-08-05',
    'rest', 0, 0, '[]'::jsonb, '', 1
  )#>>'{resolution,accountingStatus}',
  'confirmed',
  'exact labor-view and labor-update permissions can confirm zero-cost nonmoney days'
);

reset role;
create or replace function pg_temp.task4_missing_salary_day_draft_probe()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result_text text;
  caught_message text;
begin
  begin
    result_text := public.save_attendance_resolution_draft_secure(
      '75000000-0000-4000-8000-000000000007', '2026-08-05',
      'full_day', 1, 0, '[]'::jsonb, '', 2
    )#>>'{resolution,accountingStatus}';
    raise exception using errcode = 'PT408', message = result_text;
  exception when sqlstate 'PT408' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create or replace function pg_temp.task4_zero_unit_cost_salary_guard()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caught_message text;
begin
  begin
    perform public.confirm_attendance_resolution_secure(
      '75000000-0000-4000-8000-000000000007', '2026-08-05',
      'rest', 0, 100,
      '[{"projectId":"P-T4-A","amount":100,"allocationNote":""}]'::jsonb,
      '', 2
    );
    raise exception using errcode = 'PT407', message = 'SUCCESS';
  exception when sqlstate 'PT407' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create or replace function pg_temp.task4_missing_salary_month_draft_probe()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  result_text text;
  caught_message text;
begin
  begin
    result := public.save_monthly_payroll_draft_secure(
      '75000000-0000-4000-8000-000000000007', '2026-08-01',
      0, 0, 0, '', 0
    );
    result_text := (result#>>'{payroll,status}') || ':'
      || (result#>>'{payroll,salaryTypeSnapshot}');
    raise exception using errcode = 'PT409', message = result_text;
  exception when sqlstate 'PT409' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_missing_salary_day_draft_probe(),
  'draft',
  'missing salary permits a nonofficial zero-money attendance draft'
);
select is(
  pg_temp.task4_zero_unit_cost_salary_guard(),
  '55000:employee salary standard is required',
  'zero-unit project money still requires a canonical salary standard'
);
select is(
  pg_temp.task4_missing_salary_month_draft_probe(),
  'draft:未设置',
  'missing salary permits a nonofficial zero-value monthly draft'
);
select throws_ok(
  $$select public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000007', '2026-08-01',
    0, 0, 0, '', 0
  )$$,
  '55000', 'employee salary standard is required',
  'missing salary blocks monthly payroll confirmation'
);
select is(
  public.list_monthly_payroll_secure(
    '2026-08-01', '', '75000000-0000-4000-8000-000000000007', false
  )#>>'{employees,0,status}',
  'salary_required',
  'monthly readiness exposes the salary blocker instead of advertising ready'
);

select ok(
  (
    with confirmed as (
      select public.confirm_attendance_resolution_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-03',
        'full_day', 1, 12001,
        '[{"projectId":"P-T4-B","amount":6001,"allocationNote":"乙"},
          {"projectId":"P-T4-A","amount":6000,"allocationNote":"甲"}]'::jsonb,
        '日结确认', 2
      ) result
    )
    select result#>>'{resolution,accountingStatus}' = 'confirmed'
      and result#>>'{resolution,salaryTypeSnapshot}' = '日薪'
      and (result#>>'{resolution,dailySalarySnapshot}')::numeric = 12001
      and (result#>>'{resolution,suggestedProjectCost}')::numeric = 12001
      and (result#>>'{resolution,finalProjectCost}')::numeric = 12001
      and result#>>'{resolution,version}' = '3'
    from confirmed
  ),
  'day confirmation derives immutable salary facts and final integer yen server-side'
);

select is(
  public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":6000,"allocationNote":"甲"},
      {"projectId":"P-T4-B","amount":6001,"allocationNote":"乙"}]'::jsonb,
    '日结确认', 2
  )#>>'{resolution,version}',
  '3',
  'an exact repeated day confirmation is idempotent before stale-version rejection'
);

reset role;
create or replace function pg_temp.task4_day_hr_drift_replay_probe(
  p_exact boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  target_resolution_id uuid;
  before_version integer;
  after_version integer;
  before_audit bigint;
  after_audit bigint;
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set hire_date = '2026-09-01', resign_date = null
    where id = '75000000-0000-4000-8000-000000000001';
    select resolution.resolution_id, resolution.version
      into target_resolution_id, before_version
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and resolution.work_date = '2026-08-03';
    select count(*) into before_audit
    from public.attendance_accounting_audit_log audit
    where audit.object_type = 'attendance_resolution'
      and audit.object_id = target_resolution_id::text;
    begin
      result := public.confirm_attendance_resolution_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-03',
        'full_day', 1, 12001,
        '[{"projectId":"P-T4-A","amount":6000,"allocationNote":"甲"},
          {"projectId":"P-T4-B","amount":6001,"allocationNote":"乙"}]'::jsonb,
        case when p_exact then '日结确认' else '不同请求' end,
        2
      );
      select resolution.version into after_version
      from public.attendance_day_resolutions resolution
      where resolution.resolution_id = target_resolution_id;
      select count(*) into after_audit
      from public.attendance_accounting_audit_log audit
      where audit.object_type = 'attendance_resolution'
        and audit.object_id = target_resolution_id::text;
      result_text := coalesce(
        result#>>'{resolution,accountingStatus}', 'MISSING'
      ) || ':' || coalesce(result#>>'{resolution,version}', 'MISSING') || ':'
        || case
          when before_version = after_version and before_audit = after_audit
            then 'stable'
          else 'mutated'
        end;
    exception when others then
      result_text := sqlstate || ':' || sqlerrm;
    end;
    raise exception using errcode = 'PT415', message = result_text;
  exception when sqlstate 'PT415' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_day_hr_drift_replay_probe(true),
  'confirmed:3:stable',
  'an exact confirmed day retry survives HR interval drift without audit or version mutation'
);
select is(
  pg_temp.task4_day_hr_drift_replay_probe(false),
  '22023:eligible employee and activated date required',
  'a different day retry remains subject to current HR eligibility checks'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000004', true
);
select ok(
  public.list_daily_attendance_dashboard_secure('2026-08-03')
      #>>'{permissions,canUpdateProjectCosts}' = 'false'
    and public.get_attendance_resolution_detail_secure(
      '75000000-0000-4000-8000-000000000001', '2026-08-03'
    )#>>'{permissions,canUpdateProjectCosts}' = 'false',
  'project-cost update without both cost and salary view is not advertised'
);
select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":6000,"allocationNote":"甲"},
      {"projectId":"P-T4-B","amount":6001,"allocationNote":"乙"}]'::jsonb,
    '日结确认', 2
  )$$,
  '42501', 'project labor cost update permissions required',
  'project-cost update without view cannot probe an exact confirmed amount'
);
select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12000,
    '[{"projectId":"P-T4-A","amount":12000,"allocationNote":"猜测"}]'::jsonb,
    '日结确认', 2
  )$$,
  '42501', 'project labor cost update permissions required',
  'project-cost update without view cannot probe a different stale amount'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":12001,"allocationNote":"不同"}]'::jsonb,
    '不同请求', 2
  )$$,
  '40001', 'attendance accounting version conflict',
  'a different stale day-confirmation request cannot overwrite confirmed facts'
);

reset role;
select is(
  (
    select count(*)
    from public.attendance_accounting_audit_log audit
    join public.attendance_day_resolutions resolution
      on audit.object_id = resolution.resolution_id::text
    where resolution.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and resolution.work_date = '2026-08-03'
      and audit.action_type = 'resolution_confirmed'
  ),
  1::bigint,
  'double confirmation appends exactly one confirmation audit row'
);
select ok(
  (
    select actor_employee_profile_id =
        '6d000000-0000-4000-8000-000000000001'::uuid
      and before_snapshot is not null
      and after_snapshot->>'accountingStatus' = 'confirmed'
      and reason = '日结确认'
    from public.attendance_accounting_audit_log audit
    join public.attendance_day_resolutions resolution
      on audit.object_id = resolution.resolution_id::text
    where resolution.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and resolution.work_date = '2026-08-03'
      and audit.action_type = 'resolution_confirmed'
  ),
  'day confirmation audit derives actor and records explicit before/after content'
);
select ok(
  (
    select guard.row_count = current.row_count and guard.bytes = current.bytes
    from task4_event_guard guard
    cross join lateral (
      select count(*)::bigint row_count,
        md5(coalesce(jsonb_agg(to_jsonb(event) order by event.event_id)::text, '[]')) bytes
      from public.project_attendance_events event
    ) current
  ),
  'resolution workflows leave immutable attendance-event bytes and counts unchanged'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000002', '2026-08-03',
    'half_day', 0.5, 0, '[]'::jsonb, '', 0
  )#>>'{resolution,suggestedProjectCost}',
  '6667',
  'monthly half-day suggestion rounds the full day first and then the half day'
);
select is(
  public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000003', '2026-08-03',
    'half_day', 0.5, 0, '[]'::jsonb, '', 0
  )#>>'{resolution,suggestedProjectCost}',
  '6000',
  'hourly half-day suggestion uses exactly four standard hours'
);

select throws_ok(
  $$select public.list_monthly_payroll_secure(
    '2026-08-02', '', null, false
  )$$,
  '22023', 'salary month must be a finite month-first date',
  'monthly payroll lists reject non-month-first dates'
);

select throws_ok(
  $$select public.list_monthly_payroll_secure(
    '2101-01-01', '', null, false
  )$$,
  '22023', 'salary month must be between 1900-01-01 and 2100-12-31',
  'monthly RPCs reject unsupported finite dates before interval arithmetic'
);

select throws_ok(
  $$select public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000012', '2026-08-01',
    321, 0, 0, '', 1
  )$$,
  '40001', 'attendance accounting version conflict',
  'absent payroll rows accept only create sentinel zero, never stored version one'
);

-- Preserve downstream independence when the RED implementation wrongly accepts
-- the stale create sentinel.
reset role;
delete from public.attendance_monthly_payrolls
where employee_profile_id = '75000000-0000-4000-8000-000000000012'
  and salary_month = '2026-08-01';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000011', '2026-08-16',
    'full_day', 1, 0, '[]'::jsonb, '', 0
  )#>>'{resolution,accountingStatus}',
  'draft',
  'an optional-day manual draft remains unresolved for monthly confirmation'
);

select throws_ok(
  $$select public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000010', '2026-08-01',
    0, 0, 0, '', 0
  )$$,
  '55000', 'monthly payroll has unresolved attendance',
  'actual attendance on a non-required day blocks monthly confirmation'
);

select throws_ok(
  $$select public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000011', '2026-08-01',
    0, 0, 0, '', 0
  )$$,
  '55000', 'monthly payroll has unresolved attendance',
  'a draft resolution on a non-required day blocks monthly confirmation'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000004', true
);
select is(
  public.list_monthly_payroll_secure(
    '2026-08-01', '', null, false
  )#>>'{permissions,canUpdateSalary}',
  'false',
  'salary update without salary view does not advertise payroll mutation'
);

create or replace function pg_temp.task4_payroll_oracle_probe(
  p_confirm boolean,
  p_deduction numeric
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caught_message text;
begin
  begin
    if p_confirm then
      perform public.confirm_monthly_payroll_secure(
        '75000000-0000-4000-8000-000000000002', '2026-08-01',
        0, 0, p_deduction, '工资探测', 0
      );
    else
      perform public.save_monthly_payroll_draft_secure(
        '75000000-0000-4000-8000-000000000002', '2026-08-01',
        0, 0, p_deduction, '工资探测', 0
      );
    end if;
    raise exception using errcode = 'PT403', message = 'SUCCESS';
  exception when sqlstate 'PT403' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

select is(
  pg_temp.task4_payroll_oracle_probe(false, 319999),
  '42501:monthly payroll update permissions required',
  'salary update without salary view cannot save a below-base deduction probe'
);
select is(
  pg_temp.task4_payroll_oracle_probe(true, 320001),
  '42501:monthly payroll update permissions required',
  'salary update without salary view cannot confirm an above-base deduction probe'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000002', true
);
select throws_ok(
  $$select public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-01',
    0, 0, 0, '', 0
  )$$,
  '42501', 'monthly payroll update permissions required',
  'labor update without salary update cannot edit payroll money'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-01',
    0, 0, 0, '', 0
  )$$,
  '42501', 'monthly payroll update permissions required',
  'salary viewers without labor update cannot edit payroll money'
);
select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000003', true
);
select ok(
  public.list_monthly_payroll_secure(
    '2026-08-01', '', null, false
  )::text !~ '(salaryType|basePay|netSalary|overtimePay|bonus|deduction|12001|320000)',
  'monthly readers without salary view receive no salary values or compensation type'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-01',
    'Infinity'::numeric, 0, 0, '', 0
  )$$,
  '22023', 'valid integer yen payroll adjustments required',
  'payroll adjustments reject numeric infinity'
);
select throws_ok(
  $$select public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000005', '2026-08-01',
    0, 0, 0, '', 0
  )$$,
  '55000', 'monthly payroll has unresolved attendance',
  'month confirmation requires resolved workdays'
);

select is(
  public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-01',
    100, 200, 50, ' 工资草稿 ', 0
  )#>>'{payroll,netSalary}',
  '12251',
  'daily payroll derives attendance counts, rounded base pay, and net salary server-side'
);
select is(
  public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000002', '2026-08-01',
    0, 0, 0, '', 0
  )#>>'{payroll,basePay}',
  '320000',
  'monthly payroll base is fixed regardless of half-day count'
);
select is(
  public.save_monthly_payroll_draft_secure(
    '75000000-0000-4000-8000-000000000003', '2026-08-01',
    0, 0, 0, '', 0
  )#>>'{payroll,basePay}',
  '6000',
  'hourly payroll derives half days using four hours and never actual minutes'
);

reset role;
create or replace function pg_temp.task4_invalid_money_preview_guard()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report jsonb;
  invalid_row jsonb;
  unsafe_row jsonb;
  valid_total numeric;
  result_text text;
  caught_message text;
begin
  begin
    perform public.save_monthly_payroll_draft_secure(
      '75000000-0000-4000-8000-000000000002', '2026-08-01',
      0, 0, 20000, '待修正扣款', 1
    );
    update public.employee_profiles
    set base_salary = 100
    where id = '75000000-0000-4000-8000-000000000002';
    update public.employee_profiles
    set daily_salary = 9007199254740991
    where id = '75000000-0000-4000-8000-000000000005';
    insert into public.attendance_day_resolutions (
      employee_profile_id, work_date, schedule_required,
      resolution_type, attendance_units, accounting_status,
      salary_type_snapshot, base_salary_snapshot, daily_salary_snapshot,
      hourly_wage_snapshot, suggested_project_cost, final_project_cost,
      resolution_note, confirmed_by_employee_profile_id, confirmed_at, version
    ) values
      (
        '75000000-0000-4000-8000-000000000005', '2026-08-03', true,
        'full_day', 1, 'confirmed', '日薪', null, 9007199254740991,
        null, 9007199254740991, 0, '',
        '6d000000-0000-4000-8000-000000000001', statement_timestamp(), 1
      ),
      (
        '75000000-0000-4000-8000-000000000005', '2026-08-04', true,
        'full_day', 1, 'confirmed', '日薪', null, 9007199254740991,
        null, 9007199254740991, 0, '',
        '6d000000-0000-4000-8000-000000000001', statement_timestamp(), 1
      );
    report := public.list_monthly_payroll_secure(
      '2026-08-01', '', null, false
    );
    select item into invalid_row
    from jsonb_array_elements(report->'employees') item
    where item->>'employeeProfileId' =
      '75000000-0000-4000-8000-000000000002';
    select item into unsafe_row
    from jsonb_array_elements(report->'employees') item
    where item->>'employeeProfileId' =
      '75000000-0000-4000-8000-000000000005';
    select coalesce(sum((item->>'netSalary')::numeric), 0)
      into valid_total
    from jsonb_array_elements(report->'employees') item
    where item->>'status' not in ('invalid_money', 'salary_required')
      and jsonb_typeof(item->'netSalary') = 'number';
    if invalid_row->>'status' = 'invalid_money'
        and invalid_row->'netSalary' = 'null'::jsonb
        and unsafe_row->>'status' = 'invalid_money'
        and unsafe_row->'basePay' = 'null'::jsonb
        and unsafe_row->'netSalary' = 'null'::jsonb
        and (report#>>'{summary,salaryPreviewTotal}')::numeric = valid_total then
      result_text := 'OK';
    else
      result_text := jsonb_build_object(
        'status', invalid_row->'status',
        'netSalary', invalid_row->'netSalary',
        'unsafeStatus', unsafe_row->'status',
        'unsafeBasePay', unsafe_row->'basePay',
        'unsafeNetSalary', unsafe_row->'netSalary',
        'summaryTotal', report#>'{summary,salaryPreviewTotal}',
        'validTotal', valid_total
      )::text;
    end if;
    raise exception using errcode = 'PT404', message = result_text;
  exception when sqlstate 'PT404' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_invalid_money_preview_guard(),
  'OK',
  'invalid payroll money and unsafe base pay are unavailable and excluded from totals'
);

reset role;
insert into public.project_attendance_sessions (
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at
) values (
  '75100000-0000-4000-8000-000000000003',
  '75000000-0000-4000-8000-000000000002', 'SW-7502', '月薪公式员工',
  'P-T4-A', '项目甲', '東京都', 35.68, 139.76, 300,
  '2026-08-03', 'open', '2026-08-03 18:00:00+09'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select throws_ok(
  $$select public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000002', '2026-08-01',
    0, 0, 0, '', 1
  )$$,
  '55000', 'attendance session is still open',
  'a post-resolution open session blocks monthly confirmation'
);

select ok(
  (
    with confirmed as (
      select public.confirm_monthly_payroll_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-01',
        100, 200, 50, '工资确认', 1
      ) result
    )
    select result#>>'{payroll,status}' = 'confirmed'
      and result#>>'{payroll,version}' = '2'
      and result#>>'{payroll,fullDays}' = '1'
      and result#>>'{payroll,halfDays}' = '0'
    from confirmed
  ),
  'monthly confirmation atomically stores derived snapshot counts and status'
);

select is(
  public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-01',
    100, 200, 50, '工资确认', 1
  )#>>'{payroll,version}',
  '2',
  'an exact repeated monthly confirmation is idempotent before version checking'
);

reset role;
create or replace function pg_temp.task4_month_hr_drift_replay_probe(
  p_exact boolean
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  target_payroll_id uuid;
  before_version integer;
  after_version integer;
  before_audit bigint;
  after_audit bigint;
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set hire_date = '2026-09-01', resign_date = null
    where id = '75000000-0000-4000-8000-000000000001';
    select payroll.payroll_id, payroll.version
      into target_payroll_id, before_version
    from public.attendance_monthly_payrolls payroll
    where payroll.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and payroll.salary_month = '2026-08-01';
    select count(*) into before_audit
    from public.attendance_accounting_audit_log audit
    where audit.object_type = 'monthly_payroll'
      and audit.object_id = target_payroll_id::text;
    begin
      result := public.confirm_monthly_payroll_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-01',
        100, case when p_exact then 200 else 201 end, 50,
        '工资确认', 1
      );
      select payroll.version into after_version
      from public.attendance_monthly_payrolls payroll
      where payroll.payroll_id = target_payroll_id;
      select count(*) into after_audit
      from public.attendance_accounting_audit_log audit
      where audit.object_type = 'monthly_payroll'
        and audit.object_id = target_payroll_id::text;
      result_text := coalesce(result#>>'{payroll,status}', 'MISSING') || ':'
        || coalesce(result#>>'{payroll,version}', 'MISSING') || ':'
        || case
          when before_version = after_version and before_audit = after_audit
            then 'stable'
          else 'mutated'
        end;
    exception when others then
      result_text := sqlstate || ':' || sqlerrm;
    end;
    raise exception using errcode = 'PT416', message = result_text;
  exception when sqlstate 'PT416' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

create or replace function pg_temp.task4_month_locked_day_replay_probe()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  target_resolution_id uuid;
  before_version integer;
  after_version integer;
  before_audit bigint;
  after_audit bigint;
  result_text text;
  caught_message text;
begin
  begin
    select resolution.resolution_id, resolution.version
      into target_resolution_id, before_version
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and resolution.work_date = '2026-08-03';
    select count(*) into before_audit
    from public.attendance_accounting_audit_log audit
    where audit.object_type = 'attendance_resolution'
      and audit.object_id = target_resolution_id::text;
    begin
      result := public.confirm_attendance_resolution_secure(
        '75000000-0000-4000-8000-000000000001', '2026-08-03',
        'full_day', 1, 12001,
        '[{"projectId":"P-T4-A","amount":6000,"allocationNote":"甲"},
          {"projectId":"P-T4-B","amount":6001,"allocationNote":"乙"}]'::jsonb,
        '日结确认', 2
      );
      select resolution.version into after_version
      from public.attendance_day_resolutions resolution
      where resolution.resolution_id = target_resolution_id;
      select count(*) into after_audit
      from public.attendance_accounting_audit_log audit
      where audit.object_type = 'attendance_resolution'
        and audit.object_id = target_resolution_id::text;
      result_text := coalesce(
        result#>>'{resolution,accountingStatus}', 'MISSING'
      ) || ':' || coalesce(result#>>'{resolution,version}', 'MISSING') || ':'
        || case
          when before_version = after_version and before_audit = after_audit
            then 'stable'
          else 'mutated'
        end;
    exception when others then
      result_text := sqlstate || ':' || sqlerrm;
    end;
    raise exception using errcode = 'PT417', message = result_text;
  exception when sqlstate 'PT417' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_month_hr_drift_replay_probe(true),
  'confirmed:2:stable',
  'an exact monthly confirmation retry survives HR drift without audit or version mutation'
);
select is(
  pg_temp.task4_month_hr_drift_replay_probe(false),
  '22023:eligible employee and activated month required',
  'a different monthly retry remains subject to current HR eligibility checks'
);
select is(
  pg_temp.task4_month_locked_day_replay_probe(),
  'month_locked:4:stable',
  'an exact day retry survives confirmed payroll month-lock without audit or version mutation'
);

reset role;
insert into public.project_attendance_sessions (
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at
) values (
  '75100000-0000-4000-8000-000000000004',
  '75000000-0000-4000-8000-000000000001', 'SW-7501', '日薪工作流员工',
  'P-T4-B', '项目乙', '東京都', 35.68, 139.76, 300,
  '2026-08-03', 'open', '2026-08-03 20:00:00+09'
);
create or replace function pg_temp.task4_exact_month_replay_after_late_session()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-01',
    100, 200, 50, '工资确认', 1
  )#>>'{payroll,version}';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_exact_month_replay_after_late_session(),
  '2',
  'an exact monthly confirmation replay ignores sessions opened after commit'
);
reset role;
delete from public.project_attendance_sessions
where session_id = '75100000-0000-4000-8000-000000000004';
create or replace function pg_temp.task4_absent_day_write_probe()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set resign_date = '2026-08-09'
    where id = '75000000-0000-4000-8000-000000000001';
    result_text := public.save_attendance_resolution_draft_secure(
      '75000000-0000-4000-8000-000000000001', '2026-08-09',
      'rest', 0, 0, '[]'::jsonb, '', 0
    )#>>'{resolution,accountingStatus}';
    raise exception using errcode = 'PT405', message = result_text;
  exception when sqlstate 'PT405' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create or replace function pg_temp.task4_confirmed_month_report_guard()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report jsonb;
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set resign_date = '2026-08-09'
    where id = '75000000-0000-4000-8000-000000000001';
    update public.attendance_accounting_settings
    set work_weekdays = array[1,2,3,4,5,6,7]::smallint[]
    where settings_key = 'default';
    report := public.list_monthly_payroll_secure(
      '2026-08-01', '', '75000000-0000-4000-8000-000000000001', false
    );
    result_text := (report#>>'{employees,0,status}') || ':'
      || (report#>>'{employees,0,fullDays}') || ':'
      || (report#>>'{employees,0,pendingDays}');
    raise exception using errcode = 'PT406', message = result_text;
  exception when sqlstate 'PT406' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create or replace function pg_temp.task4_confirmed_month_bridge_guard()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  bridge jsonb;
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set hire_date = '2026-09-01', resign_date = null
    where id <> '75000000-0000-4000-8000-000000000001';
    update public.employee_profiles
    set resign_date = '2026-08-09'
    where id = '75000000-0000-4000-8000-000000000001';
    update public.attendance_accounting_settings
    set work_weekdays = array[1,2,3,4,5,6,7]::smallint[]
    where settings_key = 'default';
    bridge := public.get_attendance_accounting_bridge_secure('2026-08-01');
    result_text := bridge->>'pendingCount';
    raise exception using errcode = 'PT411', message = result_text;
  exception when sqlstate 'PT411' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select is(
  pg_temp.task4_absent_day_write_probe(),
  '55000:monthly payroll locks this attendance resolution',
  'confirmed payroll locks an absent optional day against later insertion'
);
select is(
  pg_temp.task4_confirmed_month_report_guard(),
  'confirmed:1:0',
  'confirmed payroll reports retain snapshotted counts after schedule changes'
);
select is(
  pg_temp.task4_confirmed_month_bridge_guard(),
  '0',
  'confirmed payroll suppresses calendar-drift pending days in the shared bridge'
);

select throws_ok(
  $$select public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000001', '2026-08-03',
    'full_day', 1, 12001,
    '[{"projectId":"P-T4-A","amount":12001,"allocationNote":""}]'::jsonb,
    '', 4
  )$$,
  '55000', 'monthly payroll locks this attendance resolution',
  'month-locked day rows cannot be edited by ordinary day RPCs'
);

reset role;
select is(
  (
    select count(*)
    from public.attendance_accounting_audit_log audit
    join public.attendance_monthly_payrolls payroll
      on audit.object_id = payroll.payroll_id::text
    where payroll.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and payroll.salary_month = '2026-08-01'
      and audit.action_type = 'payroll_confirmed'
  ),
  1::bigint,
  'double monthly confirmation writes exactly one confirmation audit row'
);

create temporary table task4_snapshot_guard as
select
  (select jsonb_build_object(
    'salaryType', salary_type_snapshot,
    'dailySalary', daily_salary_snapshot,
    'suggested', suggested_project_cost,
    'final', final_project_cost
  ) from public.attendance_day_resolutions
    where employee_profile_id = '75000000-0000-4000-8000-000000000001'
      and work_date = '2026-08-03') day_snapshot,
  (select jsonb_build_object(
    'salaryType', salary_type_snapshot,
    'baseSalary', base_salary_snapshot,
    'basePay', base_pay,
    'netSalary', net_salary,
    'fullDays', full_days,
    'halfDays', half_days
  ) from public.attendance_monthly_payrolls
    where employee_profile_id = '75000000-0000-4000-8000-000000000001'
      and salary_month = '2026-08-01') payroll_snapshot;

update public.employee_profiles
set daily_salary = 99999
where id = '75000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  public.update_attendance_accounting_settings_secure(
    '2026-07-16', array[1,2,3,4,5,6]::smallint[],
    '08:00', '17:00', 60, 480, 2
  )->>'version',
  '3',
  'non-effective settings fields remain editable after confirmations'
);

reset role;
select ok(
  (
    select guard.day_snapshot = current.day_snapshot
      and guard.payroll_snapshot = current.payroll_snapshot
    from task4_snapshot_guard guard
    cross join lateral (
      select
        (select jsonb_build_object(
          'salaryType', salary_type_snapshot,
          'dailySalary', daily_salary_snapshot,
          'suggested', suggested_project_cost,
          'final', final_project_cost
        ) from public.attendance_day_resolutions
          where employee_profile_id = '75000000-0000-4000-8000-000000000001'
            and work_date = '2026-08-03') day_snapshot,
        (select jsonb_build_object(
          'salaryType', salary_type_snapshot,
          'baseSalary', base_salary_snapshot,
          'basePay', base_pay,
          'netSalary', net_salary,
          'fullDays', full_days,
          'halfDays', half_days
        ) from public.attendance_monthly_payrolls
          where employee_profile_id = '75000000-0000-4000-8000-000000000001'
            and salary_month = '2026-08-01') payroll_snapshot
    ) current
  ),
  'salary and settings changes never rewrite confirmed day or payroll snapshots'
);

select set_config(
  'test.task4_payroll_id',
  (select payroll_id::text
   from public.attendance_monthly_payrolls
   where employee_profile_id = '75000000-0000-4000-8000-000000000001'
     and salary_month = '2026-08-01'),
  true
);

create or replace function pg_temp.task4_historical_payroll_report_probe()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  report jsonb;
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set hire_date = '2026-09-01', resign_date = null
    where id = '75000000-0000-4000-8000-000000000001';
    report := public.list_monthly_payroll_secure(
      '2026-08-01', '', '75000000-0000-4000-8000-000000000001', false
    );
    result_text := coalesce(report#>>'{employees,0,status}', 'MISSING') || ':'
      || coalesce(report#>>'{employees,0,netSalary}', 'MISSING');
    raise exception using errcode = 'PT412', message = result_text;
  exception when sqlstate 'PT412' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  when others then
    return sqlstate || ':' || sqlerrm;
  end;
end;
$$;

create or replace function pg_temp.task4_historical_payroll_reopen_probe()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result_text text;
  caught_message text;
begin
  begin
    update public.employee_profiles
    set hire_date = '2026-09-01', resign_date = null
    where id = '75000000-0000-4000-8000-000000000001';
    begin
      perform public.reopen_monthly_payroll_secure(
        current_setting('test.task4_payroll_id')::uuid,
        '历史工资修正', 2
      );
      result_text := 'ACCEPTED';
    exception when others then
      result_text := sqlstate || ':' || sqlerrm;
    end;
    raise exception using errcode = 'PT413', message = result_text;
  exception when sqlstate 'PT413' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

create or replace function pg_temp.task4_payroll_reopen_reason_probe(
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result_text text;
  caught_message text;
begin
  begin
    begin
      perform public.reopen_monthly_payroll_secure(
        current_setting('test.task4_payroll_id')::uuid,
        p_reason, 2
      );
      result_text := 'ACCEPTED';
    exception when others then
      result_text := sqlstate || ':' || sqlerrm;
    end;
    raise exception using errcode = 'PT414', message = result_text;
  exception when sqlstate 'PT414' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000004', true
);
select throws_ok(
  $$select public.reopen_monthly_payroll_secure(
    current_setting('test.task4_payroll_id')::uuid,
    '无权重开', 0
  )$$,
  '42501', 'monthly payroll update permissions required',
  'salary update without salary view cannot probe payroll through reopen'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_historical_payroll_report_probe(),
  'confirmed:12251',
  'confirmed payroll snapshots remain readable after HR eligibility changes'
);
select is(
  pg_temp.task4_historical_payroll_reopen_probe(),
  '55000:monthly payroll cannot be reopened for an ineligible employee',
  'historical payroll cannot reopen when current eligibility prevents reconfirmation'
);
select throws_ok(
  $$select public.reopen_monthly_payroll_secure(
    current_setting('test.task4_payroll_id')::uuid,
    '   ', 2
  )$$,
  '22023', 'non-empty payroll reopen reason required',
  'payroll reopen requires a trimmed nonempty reason'
);
select is(
  pg_temp.task4_payroll_reopen_reason_probe(E'\t\n'),
  '22023:non-empty payroll reopen reason required',
  'payroll reopen rejects reasons containing only non-space whitespace'
);
select throws_ok(
  $$select public.reopen_monthly_payroll_secure(
    current_setting('test.task4_payroll_id')::uuid,
    '修正', 1
  )$$,
  '40001', 'attendance accounting version conflict',
  'payroll reopen rejects a stale version'
);

select ok(
  (
    with reopened as (
      select public.reopen_monthly_payroll_secure(
        current_setting('test.task4_payroll_id')::uuid,
        ' 工资修正 ', 2
      ) result
    )
    select result#>>'{payroll,status}' = 'reopened'
      and result#>>'{payroll,confirmedAt}' is null
      and result#>>'{payroll,version}' = '3'
    from reopened
  ),
  'reopen clears current confirmation metadata and unlocks day rows atomically'
);

reset role;
select ok(
  (
    select count(*) = 1
    from public.attendance_accounting_audit_log audit
    join public.attendance_monthly_payrolls payroll
      on audit.object_id = payroll.payroll_id::text
    where payroll.employee_profile_id =
        '75000000-0000-4000-8000-000000000001'
      and audit.action_type = 'payroll_reopened'
      and audit.reason = '工资修正'
  ) and (
    select accounting_status = 'confirmed'
    from public.attendance_day_resolutions
    where employee_profile_id = '75000000-0000-4000-8000-000000000001'
      and work_date = '2026-08-03'
  ),
  'successful reopen appends one trimmed-reason audit row and unlocks days'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_absent_day_write_probe(),
  'draft',
  'reopening payroll allows a newly eligible optional day to be drafted'
);
reset role;

create or replace function pg_temp.task4_confirmation_history_settings_guard()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caught_message text;
begin
  begin
    update public.attendance_day_resolutions
    set accounting_status = 'draft',
        confirmed_by_employee_profile_id = null,
        confirmed_at = null;
    update public.attendance_monthly_payrolls
    set status = 'reopened',
        confirmed_by_employee_profile_id = null,
        confirmed_at = null;
    begin
      perform public.update_attendance_accounting_settings_secure(
        '2026-07-15', array[1,2,3,4,5,6]::smallint[],
        '08:00', '17:00', 60, 480, 3
      );
      raise exception using errcode = 'PT402', message = 'NO_ERROR';
    exception when sqlstate '55000' then
      get stacked diagnostics caught_message = message_text;
      raise exception using
        errcode = 'PT402', message = '55000:' || caught_message;
    end;
  exception when sqlstate 'PT402' then
    get stacked diagnostics caught_message = message_text;
    return caught_message;
  end;
end;
$$;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_confirmation_history_settings_guard(),
  '55000:effective_from cannot change after confirmed attendance; use an explicit database migration',
  'confirmation history irreversibly freezes the activation boundary'
);
reset role;

-- Legacy fixtures deliberately include boundary, malformed, and post-activation rows.
insert into public.labor_records (record_key, payload, status) values
  ('T4-LABOR-JUNE', '{"workDate":"2026-06-30","projectId":"P-T4-A","projectName":"六月甲","employeeId":" E-OLD ","employeeName":" 旧员工 ","laborCost":500}'::jsonb, 'active'),
  ('T4-LABOR-COMP-A', '{"workDate":"2026-05-10","projectId":"P-T4-COMP","projectName":"构成项目","employeeId":" E-COMP-A ","employeeName":" 历史甲 ","laborCost":100}'::jsonb, 'active'),
  ('T4-LABOR-COMP-B', '{"workDate":"2026-05-10","projectId":"P-T4-COMP","projectName":"构成项目","employeeId":" E-COMP-B ","employeeName":" 历史乙 ","laborCost":200}'::jsonb, 'active'),
  ('T4-LABOR-PRE-A', '{"workDate":"2026-07-15","projectId":"P-T4-A","projectName":" 旧项目甲 ","employeeId":" E-OLD ","employeeName":" 旧员工 ","laborCost":1000}'::jsonb, 'active'),
  ('T4-LABOR-PRE-B', '{"workDate":"2026-07-15","projectId":"P-T4-B","projectName":"旧项目乙","employeeId":"E-OLD","employeeName":"旧员工","laborCost":2000}'::jsonb, 'active'),
  ('T4-LABOR-POST', '{"workDate":"2026-07-16","projectId":"P-T4-A","projectName":"不应计入","employeeId":"E-OLD","employeeName":"旧员工","laborCost":9999}'::jsonb, 'active'),
  ('T4-LABOR-BAD-DATE', '{"workDate":"2026-02-30","projectId":"P-T4-A","projectName":"坏日期","employeeId":"E-OLD","employeeName":"旧员工","laborCost":7777}'::jsonb, 'active'),
  ('T4-LABOR-BAD-MONEY', '{"workDate":"2026-07-15","projectId":"P-T4-A","projectName":"坏金额","employeeId":"E-OLD","employeeName":"旧员工","laborCost":"Infinity"}'::jsonb, 'active'),
  ('T4-LABOR-DELETED', '{"workDate":"2026-07-15","projectId":"P-T4-A","projectName":"删除","employeeId":"E-OLD","employeeName":"旧员工","laborCost":8888}'::jsonb, 'deleted');

insert into public.salary_records (record_key, payload, status) values
  ('T4-SALARY-JUNE', '{"salaryMonth":"2026-06","employeeId":"E-OLD","employeeName":"旧员工","baseSalary":10000,"overtimePay":500,"bonus":100,"deduction":100,"netSalary":999999}'::jsonb, 'active'),
  ('T4-SALARY-POST', '{"salaryMonth":"2026-07","employeeId":"E-OLD","employeeName":"旧员工","baseSalary":99999,"overtimePay":0,"bonus":0,"deduction":0,"netSalary":99999}'::jsonb, 'active'),
  ('T4-SALARY-NO-IDENTITY', '{"salaryMonth":"2026-06","employeeId":" ","employeeName":"无身份工资","baseSalary":1234,"overtimePay":0,"bonus":0,"deduction":0}'::jsonb, 'active'),
  ('T4-SALARY-BAD', '{"salaryMonth":"2026-06","employeeId":"E-BAD","employeeName":"坏工资","baseSalary":"NaN","overtimePay":0,"bonus":0,"deduction":0,"netSalary":77777}'::jsonb, 'active');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select ok(
  (
    with report as (
      select public.list_monthly_payroll_secure(
        '2026-06-01', '', null, false
      ) result
    )
    select result#>>'{summary,employeeCount}' = '1'
      and result#>>'{summary,salaryPreviewTotal}' = '10500'
      and result#>>'{permissions,canUpdateSalary}' = 'false'
      and result#>>'{employees,0,source}' = 'legacy'
      and result#>>'{employees,0,employeeProfileId}' is null
      and result#>>'{employees,0,employeeNumber}' = 'E-OLD'
      and result#>>'{employees,0,employeeName}' = '旧员工'
      and result#>>'{employees,0,netSalary}' = '10500'
      and result#>>'{reconciliation,globalMalformedLegacyRows}' = '2'
    from report
  ),
  'pre-activation monthly reports project strict legacy salary rows without canonical invention'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-05-01', '', null, 'P-T4-COMP'
      ) result
    )
    select result#>>'{summary,monthlyConfirmedCost}' = '300'
      and jsonb_array_length(result->'employeeComposition') = 2
      and result#>>'{employeeComposition,0,employeeNumber}' = 'E-COMP-A'
      and result#>>'{employeeComposition,0,amount}' = '100'
      and result#>>'{employeeComposition,1,employeeNumber}' = 'E-COMP-B'
      and result#>>'{employeeComposition,1,amount}' = '200'
    from report
  ),
  'unmapped legacy employees remain distinct in employee composition'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-08-01', '', '75000000-0000-4000-8000-000000000001', null
      ) result
    )
    select result#>>'{summary,monthlyConfirmedCost}' = '12001'
      and result#>>'{summary,confirmedAttendanceUnits}' = '1'
      and result#>>'{employeeComposition,0,attendanceUnits}' = '1'
    from report
  ),
  'cross-project summaries count one resolution unit once while summing all allocation money'
);

select is(
  public.confirm_attendance_resolution_secure(
    '75000000-0000-4000-8000-000000000008', '2026-07-16',
    'full_day', 1, 3000,
    '[{"projectId":"P-T4-A","amount":3000,"allocationNote":"边界"}]'::jsonb,
    '', 0
  )#>>'{resolution,accountingStatus}',
  'confirmed',
  'activation-date normalized project allocation confirms successfully'
);
reset role;
insert into public.project_attendance_sessions (
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at
) values (
  '75100000-0000-4000-8000-000000000005',
  '75000000-0000-4000-8000-000000000008', 'SW-7508', '启用边界月薪员工',
  'P-T4-A', '项目甲', '東京都', 35.68, 139.76, 300,
  '2026-07-15', 'open', '2026-07-15 08:00:00+09'
);
create or replace function pg_temp.task4_activation_month_confirm()
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000008', '2026-07-01',
    0, 0, 0, '', 0
  )#>>'{payroll,netSalary}';
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select is(
  pg_temp.task4_activation_month_confirm(),
  '30000',
  'pre-activation open sessions do not block activation-month payroll'
);
reset role;
delete from public.project_attendance_sessions
where session_id = '75100000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
do $$
begin
  perform public.confirm_monthly_payroll_secure(
    '75000000-0000-4000-8000-000000000008', '2026-07-01',
    0, 0, 0, '', 0
  );
end;
$$;
select is(
  public.save_attendance_resolution_draft_secure(
    '75000000-0000-4000-8000-000000000009', '2026-07-17',
    'full_day', 1, 5000,
    '[{"projectId":"P-T4-A","amount":4000,"allocationNote":"草稿"}]'::jsonb,
    '', 0
  )#>>'{resolution,accountingStatus}',
  'draft',
  'partially allocated draft remains nonofficial until confirmation'
);

select ok(
  public.list_project_labor_costs_secure(
    '2026-07-01', null, null, null
  ) = public.list_project_labor_costs_secure(
    '2026-07-01', '', null, null
  )
  and public.list_project_labor_costs_secure(
    '2026-07-01', '', null, null
  ) = public.list_project_labor_costs_secure(
    '2026-07-01', 'all', null, null
  ),
  'null and blank project detail status normalize exactly to all'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'confirmed', null, null
      ) result
    )
    select jsonb_array_length(result->'dailyDetails') = 3
      and result#>>'{dailyDetails,0,source}' = 'legacy'
      and result#>>'{dailyDetails,0,accountingStatus}' = 'legacy'
      and result#>>'{dailyDetails,0,projectId}' = 'P-T4-A'
      and result#>>'{dailyDetails,1,source}' = 'legacy'
      and result#>>'{dailyDetails,1,projectId}' = 'P-T4-B'
      and result#>>'{dailyDetails,2,source}' = 'attendance'
      and result#>>'{dailyDetails,2,accountingStatus}' = 'month_locked'
      and result#>>'{dailyDetails,2,amount}' = '3000'
    from report
  ),
  'confirmed project details include valid legacy and finalized normalized rows with preserved source labels'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'pending', null, null
      ) result
    )
    select jsonb_array_length(result->'dailyDetails') = 2
      and (
        select array_agg(key order by key)
        from jsonb_object_keys(result#>'{dailyDetails,0}') key
      ) = array[
        'accountingStatus', 'amount', 'attendanceUnits', 'employeeName',
        'employeeNumber', 'employeeProfileId', 'projectId', 'projectName',
        'source', 'sourceKey', 'workDate'
      ]::text[]
      and result#>>'{dailyDetails,0,source}' = 'attendance'
      and result#>>'{dailyDetails,0,accountingStatus}' = 'draft'
      and result#>>'{dailyDetails,0,projectId}' = 'P-T4-A'
      and result#>>'{dailyDetails,0,employeeProfileId}' =
        '75000000-0000-4000-8000-000000000009'
      and result#>>'{dailyDetails,0,amount}' = '4000'
      and result#>>'{dailyDetails,1,source}' = 'attendance'
      and result#>>'{dailyDetails,1,accountingStatus}' = 'draft'
      and result#>'{dailyDetails,1,projectId}' = 'null'::jsonb
      and result#>>'{dailyDetails,1,projectName}' = '未分摊'
      and result#>>'{dailyDetails,1,amount}' = '1000'
      and result#>>'{dailyDetails,1,sourceKey}'
        like 'draft-unallocated:%'
    from report
  ),
  'pending project details expose allocated drafts and one stable unallocated remainder row'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'pending', null, 'P-T4-A'
      ) result
    )
    select jsonb_array_length(result->'dailyDetails') = 1
      and result#>>'{dailyDetails,0,projectId}' = 'P-T4-A'
      and result#>>'{dailyDetails,0,amount}' = '4000'
      and result::text !~ '未分摊|draft-unallocated:'
    from report
  ),
  'project-filtered pending details omit the unattributed draft remainder'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'all', null, null
      ) result
    )
    select jsonb_array_length(result->'dailyDetails') = 5
      and result#>>'{dailyDetails,0,accountingStatus}' = 'legacy'
      and result#>>'{dailyDetails,1,accountingStatus}' = 'legacy'
      and result#>>'{dailyDetails,2,accountingStatus}' = 'month_locked'
      and result#>>'{dailyDetails,3,accountingStatus}' = 'draft'
      and result#>>'{dailyDetails,3,projectId}' = 'P-T4-A'
      and result#>>'{dailyDetails,4,accountingStatus}' = 'draft'
      and result#>'{dailyDetails,4,projectId}' = 'null'::jsonb
    from report
  ),
  'all project details deterministically combine confirmed and pending membership'
);

select ok(
  (
    with baseline as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', null, null, null
      ) result
    ), reports as (
      select status.value,
        public.list_project_labor_costs_secure(
          '2026-07-01', status.value, null, null
        ) result
      from unnest(array['all', 'confirmed', 'pending']) status(value)
    )
    select bool_and(reports.result->'summary' = baseline.result->'summary'
      and reports.result->'trend' = baseline.result->'trend'
      and reports.result->'employeeComposition' =
        baseline.result->'employeeComposition'
      and reports.result->'projectComparison' =
        baseline.result->'projectComparison'
      and reports.result->'reconciliation' =
        baseline.result->'reconciliation')
    from reports cross join baseline
  ),
  'detail status never changes authoritative metrics or reconciliation counts'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'all', null, null
      ) result
    )
    select result#>>'{summary,monthlyConfirmedCost}' = '6000'
      and result#>>'{summary,confirmedAttendanceUnits}' = '2'
      and result#>>'{summary,pendingAllocationCount}' = '1'
      and result#>>'{summary,pendingAllocationAmount}' = '4000'
      and result#>>'{trend,5,amount}' = '6000'
      and (result->'employeeComposition')::text
        !~ 'SW-7509|草稿项目员工'
      and (
        select sum((item->>'monthlyConfirmedCost')::numeric)
        from jsonb_array_elements(result->'projectComparison') item
      ) = 6000
    from report
  ),
  'draft detail rows never enter official totals, trend, composition, or comparison metrics'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000003', true
);
select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', '', null, 'P-T4-A'
      ) result
    )
    select result#>>'{summary,monthlyConfirmedCost}' = '4000'
      and result->'employeeComposition' = '[]'::jsonb
      and result->'dailyDetails' = '[]'::jsonb
      and public.list_project_labor_costs_secure(
        '2026-07-01', 'confirmed', null, 'P-T4-A'
      )->'dailyDetails' = '[]'::jsonb
      and public.list_project_labor_costs_secure(
        '2026-07-01', 'pending', null, 'P-T4-A'
      )->'dailyDetails' = '[]'::jsonb
      and result::text !~ '(SW-7508|启用边界月薪员工|3000|9999)'
    from report
  ),
  'project-cost viewers see aggregate totals but no employee-level salary composition'
);
select throws_ok(
  $$select public.list_project_labor_costs_secure(
    '2026-07-01', '', '75000000-0000-4000-8000-000000000008', null
  )$$,
  '42501', 'salary view permission required for employee project filter',
  'project viewers without salary view cannot recover employee costs by UUID filter'
);
select throws_ok(
  $$select public.list_project_labor_costs_secure(
    '2026-07-01', 'SW-7508', null, null
  )$$,
  '22023', 'valid project labor status required',
  'project report rejects former free-text search values instead of treating status as search'
);
select throws_ok(
  $$select public.export_project_labor_costs_secure(
    '2026-07-01', 'P-T4-A', null
  )$$,
  '42501', 'salary view permission required for employee project export',
  'employee-level project export additionally requires salary view'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.list_project_labor_costs_secure(
    '2026-07-01', '', null, null
  )$$,
  '42501', 'project labor cost view permission required',
  'salary view without project-cost view cannot read project totals'
);

select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'all', null, null
      ) result
    )
    select
      (select array_agg(key order by key) from jsonb_object_keys(result) key)
        = array[
          'dailyDetails', 'employeeComposition', 'permissions',
          'projectComparison', 'reconciliation', 'salaryMonth',
          'summary', 'trend'
        ]::text[]
      and result#>>'{summary,monthlyConfirmedCost}' = '6000'
      and result#>>'{summary,confirmedAttendanceUnits}' = '2'
      and result#>>'{summary,pendingAllocationCount}' = '1'
      and result#>>'{summary,pendingAllocationAmount}' = '4000'
      and result#>>'{reconciliation,postActivationLegacyRows}' = '1'
      and result#>>'{reconciliation,globalMalformedLegacyRows}' = '2'
      and result::text !~ '9999|7777|8888'
    from report
  ),
  'project report has stable keys, no draft leakage, and reconciliation-only legacy rows'
);

select ok(
  public.list_project_labor_costs_secure(
    '2026-07-01', '', null, 'P-T4-A'
  )#>>'{reconciliation,postActivationLegacyRows}' = '1'
  and public.list_project_labor_costs_secure(
    '2026-07-01', 'confirmed', null, 'P-T4-A'
  )#>>'{reconciliation,postActivationLegacyRows}' = '1'
  and public.list_project_labor_costs_secure(
    '2026-07-01', 'pending', null, 'P-T4-A'
  )#>>'{reconciliation,postActivationLegacyRows}' = '1'
  and public.list_project_labor_costs_secure(
    '2026-07-01', '', null, 'P-T4-B'
  )#>>'{reconciliation,postActivationLegacyRows}' = '0'
  and public.list_project_labor_costs_secure(
    '2026-07-01', '', '75000000-0000-4000-8000-000000000008', 'P-T4-A'
  )#>>'{reconciliation,postActivationLegacyRows}' = '0'
  and public.list_project_labor_costs_secure(
    '2026-07-01', 'pending',
    '75000000-0000-4000-8000-000000000008', 'P-T4-A'
  )#>>'{reconciliation,postActivationLegacyRows}' = '0',
  'project reconciliation follows project and employee report filters'
);

select ok(
  public.list_monthly_payroll_secure(
    '2026-07-01', 'E-OLD', null, false
  )#>>'{reconciliation,postActivationLegacyRows}' = '1'
  and public.list_monthly_payroll_secure(
    '2026-07-01', 'SW-7508', null, false
  )#>>'{reconciliation,postActivationLegacyRows}' = '0'
  and public.list_monthly_payroll_secure(
    '2026-07-01', '', '75000000-0000-4000-8000-000000000008', false
  )#>>'{reconciliation,postActivationLegacyRows}' = '0',
  'payroll reconciliation follows search and employee report filters'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', 'all', null, 'P-T4-COMP'
      ) result
    )
    select result#>>'{summary,monthlyConfirmedCost}' = '0'
      and result#>>'{summary,lifetimeConfirmedCost}' = '300'
      and exists (
        select 1
        from jsonb_array_elements(result->'projectComparison') item
        where item->>'projectId' = 'P-T4-COMP'
          and item->>'monthlyConfirmedCost' = '0'
          and item->>'lifetimeConfirmedCost' = '300'
      )
    from report
  ),
  'project comparison retains lifetime-only projects through the selected month without search semantics'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000003', true
);
select ok(
  public.list_monthly_payroll_secure(
    '2026-06-01', '', null, false
  )::text !~ 'salaryType',
  'pre-activation payroll rows hide compensation type without salary view'
);
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);

select ok(
  (
    with exported as (
      select public.export_project_labor_costs_secure(
        '2026-07-01', 'P-T4-A', null
      ) result
    )
    select jsonb_array_length(result) = 2
      and result#>>'{0,source}' = 'legacy'
      and result#>>'{0,projectName}' = '旧项目甲'
      and result#>>'{0,employeeName}' = '旧员工'
      and result#>>'{1,source}' = 'attendance'
      and result#>>'{1,projectName}' = '项目甲'
      and result#>>'{1,amount}' = '3000'
      and result::text !~ '不应计入|草稿|Infinity'
    from exported
  ),
  'project export is trimmed, deterministic, permission-scoped, and confirmed-only'
);

select ok(
  (
    with report as (
      select public.list_project_labor_costs_secure(
        '2026-07-01', '', '75000000-0000-4000-8000-000000000008', 'P-T4-A'
      ) result
    )
    select result#>>'{summary,monthlyConfirmedCost}' = '3000'
      and jsonb_array_length(result->'dailyDetails') = 1
    from report
  ),
  'project report applies stable employee and project filters to normalized details'
);

select ok(
  (
    with bridge as (
      select public.get_attendance_accounting_bridge_secure('2026-06-01') result
    )
    select
      (select array_agg(key order by key) from jsonb_object_keys(result) key)
        = array[
          'effectiveFrom', 'isAuthoritative', 'pendingCount',
          'projectLaborById', 'projectLaborTotal', 'salaryMonth', 'salaryTotal'
        ]::text[]
      and result->>'salaryMonth' = '2026-06'
      and (result->>'isAuthoritative')::boolean = false
      and (result->>'salaryTotal')::numeric = 10500
      and (result->>'projectLaborTotal')::numeric = 500
      and (result#>>'{projectLaborById,P-T4-A}')::numeric = 500
    from bridge
  ),
  'pre-activation bridge uses only valid legacy rows and recomputes legacy net salary'
);

select ok(
  (
    with bridge as (
      select public.get_attendance_accounting_bridge_secure('2026-07-01') result
    )
    select (result->>'isAuthoritative')::boolean
      and (result->>'salaryTotal')::numeric = 30000
      and (result->>'projectLaborTotal')::numeric = 6000
      and (result#>>'{projectLaborById,P-T4-A}')::numeric = 4000
      and (result#>>'{projectLaborById,P-T4-B}')::numeric = 2000
      and (result->>'pendingCount')::integer >= 1
      and result::text !~ '9999|99999|7777|8888'
    from bridge
  ),
  'activation bridge partitions salary by month and labor by exact date without double count'
);

reset role;
insert into public.salary_records (record_key, payload, status) values
  ('T4-SALARY-OVERFLOW-A', '{"salaryMonth":"2026-05","employeeId":"E-MAX-A","employeeName":"大额甲","baseSalary":9007199254740991,"overtimePay":0,"bonus":0,"deduction":0}'::jsonb, 'active'),
  ('T4-SALARY-OVERFLOW-B', '{"salaryMonth":"2026-05","employeeId":"E-MAX-B","employeeName":"大额乙","baseSalary":9007199254740991,"overtimePay":0,"bonus":0,"deduction":0}'::jsonb, 'active');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.get_attendance_accounting_bridge_secure('2026-05-01')$$,
  '22003', 'attendance accounting aggregate exceeds safe integer range',
  'legacy salary aggregates fail closed before JSON number precision is lost'
);

create or replace function pg_temp.task4_aggregate_overflow_hint()
returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  caught_hint text;
begin
  perform public.get_attendance_accounting_bridge_secure('2026-05-01');
  return null;
exception when others then
  get stacked diagnostics caught_hint = pg_exception_hint;
  return caught_hint;
end;
$$;

select is(
  pg_temp.task4_aggregate_overflow_hint(),
  'ATTENDANCE_ACCOUNTING_AGGREGATE_OVERFLOW',
  'aggregate overflow exposes the stable safe error hint'
);

reset role;
insert into public.labor_records (record_key, payload, status) values
  ('T4-LABOR-OVERFLOW-A', '{"workDate":"2026-05-20","projectId":"P-T4-MAX-A","projectName":"大额项目甲","employeeId":"E-MAX-A","employeeName":"大额甲","laborCost":9007199254740991}'::jsonb, 'active'),
  ('T4-LABOR-OVERFLOW-B', '{"workDate":"2026-05-20","projectId":"P-T4-MAX-B","projectName":"大额项目乙","employeeId":"E-MAX-B","employeeName":"大额乙","laborCost":9007199254740991}'::jsonb, 'active');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '6c000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.list_project_labor_costs_secure(
    '2026-05-01', '', null, null
  )$$,
  '22003', 'attendance accounting aggregate exceeds safe integer range',
  'project report aggregates fail closed before JSON number precision is lost'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000003', true
);
select throws_ok(
  $$select public.get_attendance_accounting_bridge_secure('2026-07-01')$$,
  '42501', 'salary and project cost view permissions required',
  'bridge denies project viewers missing salary view'
);

select set_config(
  'request.jwt.claim.sub', '74000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.get_attendance_accounting_bridge_secure('2026-07-01')$$,
  '42501', 'salary and project cost view permissions required',
  'bridge denies salary viewers missing project-cost view'
);

reset role;

select * from finish();
rollback;

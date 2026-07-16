begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select plan(27);

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

select * from finish();
rollback;

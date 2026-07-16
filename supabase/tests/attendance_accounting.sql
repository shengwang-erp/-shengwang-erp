begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select plan(22);

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

create or replace function pg_temp.task2_special_numeric_rejected(
  p_case text
)
returns boolean
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  special_value numeric := case
    when p_case like '%_nan' then 'NaN'::numeric
    else 'Infinity'::numeric
  end;
begin
  begin
    case
      when p_case like 'day_%' then
        insert into public.attendance_day_resolutions (
          resolution_id,
          employee_profile_id,
          work_date,
          schedule_required,
          resolution_type,
          attendance_units,
          salary_type_snapshot,
          base_salary_snapshot,
          daily_salary_snapshot,
          hourly_wage_snapshot,
          suggested_project_cost,
          final_project_cost
        ) values (
          '68000000-0000-4000-8000-000000000002',
          '67000000-0000-4000-8000-000000000001',
          '2026-07-17',
          true,
          'full_day',
          1,
          '月薪',
          special_value,
          special_value,
          special_value,
          special_value,
          special_value
        );
      when p_case like 'allocation_%' then
        insert into public.attendance_project_allocations (
          allocation_id,
          resolution_id,
          project_id,
          project_name_snapshot,
          amount
        ) values (
          '69000000-0000-4000-8000-000000000001',
          '68000000-0000-4000-8000-000000000001',
          'P-ACCOUNTING-FINITE-TEST',
          '特殊数值约束测试',
          special_value
        );
      when p_case like 'payroll_core_%' then
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
          '6a000000-0000-4000-8000-000000000001',
          '67000000-0000-4000-8000-000000000001',
          '2026-07-01',
          '月薪',
          special_value,
          special_value,
          special_value,
          special_value,
          special_value,
          special_value
        );
      when p_case = 'payroll_adjustments_nan' then
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
          overtime_pay,
          bonus,
          deduction,
          net_salary
        ) values (
          '6a000000-0000-4000-8000-000000000001',
          '67000000-0000-4000-8000-000000000001',
          '2026-07-01',
          '月薪',
          0,
          0,
          0,
          0,
          0,
          special_value,
          special_value,
          special_value,
          special_value
        );
      when p_case in (
        'payroll_overtime_infinity', 'payroll_bonus_infinity'
      ) then
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
          overtime_pay,
          bonus,
          deduction,
          net_salary
        ) values (
          '6a000000-0000-4000-8000-000000000001',
          '67000000-0000-4000-8000-000000000001',
          '2026-07-01',
          '月薪',
          0,
          0,
          0,
          0,
          0,
          case when p_case = 'payroll_overtime_infinity'
            then special_value else 0 end,
          case when p_case = 'payroll_bonus_infinity'
            then special_value else 0 end,
          0,
          special_value
        );
      when p_case = 'payroll_deduction_infinity' then
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
          overtime_pay,
          bonus,
          deduction,
          net_salary
        ) values (
          '6a000000-0000-4000-8000-000000000001',
          '67000000-0000-4000-8000-000000000001',
          '2026-07-01',
          '月薪',
          0,
          0,
          0,
          0,
          special_value,
          0,
          0,
          special_value,
          'NaN'::numeric
        );
      else
        raise exception using errcode = '22023', message = 'unknown test case';
    end case;

    raise exception using
      errcode = 'P9001',
      message = 'special numeric unexpectedly accepted';
  exception
    when check_violation or numeric_value_out_of_range then
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
      'day_nan',
      'day_infinity',
      'allocation_nan',
      'allocation_infinity',
      'payroll_core_nan',
      'payroll_core_infinity',
      'payroll_adjustments_nan',
      'payroll_overtime_infinity',
      'payroll_bonus_infinity',
      'payroll_deduction_infinity'
    ]::text[]) test_case(case_name)
    where not pg_temp.task2_special_numeric_rejected(test_case.case_name)
  ),
  0::bigint,
  'all accounting numerics reject NaN and infinity'
);

select * from finish();
rollback;

-- Normalized, RPC-only attendance accounting state. Attendance sessions and events
-- remain immutable facts; accounting decisions and snapshots live only here.

begin;

create table public.attendance_accounting_settings (
  settings_key text primary key default 'default',
  effective_from date not null,
  work_weekdays smallint[] not null
    default array[1, 2, 3, 4, 5, 6]::smallint[],
  work_start_time time without time zone not null default '08:00'::time,
  work_end_time time without time zone not null default '17:00'::time,
  break_minutes integer not null default 60,
  standard_day_minutes integer not null default 480,
  updated_by_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_accounting_settings_key_check check (
    settings_key = 'default'
  ),
  constraint attendance_accounting_settings_weekdays_check check (
    cardinality(work_weekdays) between 1 and 7
    and work_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
    and array_position(work_weekdays, null::smallint) is null
    and cardinality(array_positions(work_weekdays, 1::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 2::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 3::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 4::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 5::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 6::smallint)) <= 1
    and cardinality(array_positions(work_weekdays, 7::smallint)) <= 1
  ),
  constraint attendance_accounting_settings_time_order_check check (
    work_start_time < work_end_time
  ),
  constraint attendance_accounting_settings_break_minutes_check check (
    break_minutes between 0 and 1439
    and break_minutes < extract(
      epoch from (work_end_time - work_start_time)
    ) / 60
  ),
  constraint attendance_accounting_settings_standard_minutes_check check (
    standard_day_minutes between 1 and 1440
    and standard_day_minutes <= (
      extract(epoch from (work_end_time - work_start_time)) / 60
      - break_minutes
    )
  ),
  constraint attendance_accounting_settings_timestamps_check check (
    updated_at >= created_at
  )
);

create table public.attendance_day_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  work_date date not null,
  schedule_required boolean not null,
  resolution_type text not null,
  attendance_units numeric(2, 1) not null,
  accounting_status text not null default 'draft',
  salary_type_snapshot text not null,
  base_salary_snapshot numeric,
  daily_salary_snapshot numeric,
  hourly_wage_snapshot numeric,
  suggested_project_cost numeric not null,
  final_project_cost numeric not null,
  resolution_note text not null default '',
  confirmed_by_employee_profile_id uuid
    references public.employee_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_day_resolutions_employee_day_unique
    unique (employee_profile_id, work_date),
  constraint attendance_day_resolutions_type_check check (
    resolution_type in (
      'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'
    )
  ),
  constraint attendance_day_resolutions_units_check check (
    attendance_units in (0, 0.5, 1)
  ),
  constraint attendance_day_resolutions_type_units_check check (
    (resolution_type = 'full_day' and attendance_units = 1)
    or (resolution_type = 'half_day' and attendance_units = 0.5)
    or (
      resolution_type in ('rest', 'leave', 'comp_time', 'absence')
      and attendance_units = 0
    )
  ),
  constraint attendance_day_resolutions_status_check check (
    accounting_status in ('draft', 'confirmed', 'month_locked')
  ),
  constraint attendance_day_resolutions_salary_type_check check (
    salary_type_snapshot in ('月薪', '日薪', '时薪', '未设置')
  ),
  constraint attendance_day_resolutions_base_salary_yen_check check (
    base_salary_snapshot is null
    or (
      base_salary_snapshot not in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      and base_salary_snapshot >= 0
      and base_salary_snapshot = trunc(base_salary_snapshot)
    )
  ),
  constraint attendance_day_resolutions_daily_salary_yen_check check (
    daily_salary_snapshot is null
    or (
      daily_salary_snapshot not in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      and daily_salary_snapshot >= 0
      and daily_salary_snapshot = trunc(daily_salary_snapshot)
    )
  ),
  constraint attendance_day_resolutions_hourly_wage_yen_check check (
    hourly_wage_snapshot is null
    or (
      hourly_wage_snapshot not in (
        'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
      )
      and hourly_wage_snapshot >= 0
      and hourly_wage_snapshot = trunc(hourly_wage_snapshot)
    )
  ),
  constraint attendance_day_resolutions_suggested_cost_yen_check check (
    suggested_project_cost not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and suggested_project_cost >= 0
    and suggested_project_cost = trunc(suggested_project_cost)
  ),
  constraint attendance_day_resolutions_final_cost_yen_check check (
    final_project_cost not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and final_project_cost >= 0
    and final_project_cost = trunc(final_project_cost)
  ),
  constraint attendance_day_resolutions_note_check check (
    resolution_note = btrim(resolution_note)
    and char_length(resolution_note) <= 2000
  ),
  constraint attendance_day_resolutions_confirmation_check check (
    (accounting_status = 'draft'
      and confirmed_by_employee_profile_id is null
      and confirmed_at is null)
    or (accounting_status in ('confirmed', 'month_locked')
      and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null)
  ),
  constraint attendance_day_resolutions_version_check check (version >= 1),
  constraint attendance_day_resolutions_timestamps_check check (
    updated_at >= created_at
    and (confirmed_at is null or confirmed_at >= created_at)
  )
);

create index attendance_day_resolutions_work_date_idx
  on public.attendance_day_resolutions(
    work_date, accounting_status, employee_profile_id
  );

create table public.attendance_project_allocations (
  allocation_id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null
    references public.attendance_day_resolutions(resolution_id)
    on delete restrict,
  project_id text not null
    references public.projects(record_key) on delete restrict,
  project_name_snapshot text not null,
  amount numeric not null,
  allocation_note text not null default '',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_project_allocations_resolution_project_unique
    unique (resolution_id, project_id),
  constraint attendance_project_allocations_project_name_check check (
    project_name_snapshot = btrim(project_name_snapshot)
    and char_length(project_name_snapshot) between 1 and 500
  ),
  constraint attendance_project_allocations_amount_yen_check check (
    amount not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and amount >= 0
    and amount = trunc(amount)
  ),
  constraint attendance_project_allocations_note_check check (
    allocation_note = btrim(allocation_note)
    and char_length(allocation_note) <= 2000
  ),
  constraint attendance_project_allocations_timestamps_check check (
    updated_at >= created_at
  )
);

create index attendance_project_allocations_project_idx
  on public.attendance_project_allocations(project_id, resolution_id);

create table public.attendance_monthly_payrolls (
  payroll_id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  salary_month date not null,
  salary_type_snapshot text not null,
  base_salary_snapshot numeric not null,
  full_days numeric not null,
  half_days numeric not null,
  absence_days numeric not null,
  base_pay numeric not null,
  overtime_pay numeric not null default 0,
  bonus numeric not null default 0,
  deduction numeric not null default 0,
  net_salary numeric not null,
  status text not null default 'draft',
  confirmation_note text not null default '',
  confirmed_by_employee_profile_id uuid
    references public.employee_profiles(id) on delete restrict,
  confirmed_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_monthly_payrolls_employee_month_unique
    unique (employee_profile_id, salary_month),
  constraint attendance_monthly_payrolls_month_start_check check (
    salary_month = date_trunc('month', salary_month)::date
  ),
  constraint attendance_monthly_payrolls_salary_type_check check (
    salary_type_snapshot in ('月薪', '日薪', '时薪', '未设置')
  ),
  constraint attendance_monthly_payrolls_base_salary_yen_check check (
    base_salary_snapshot not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and base_salary_snapshot >= 0
    and base_salary_snapshot = trunc(base_salary_snapshot)
  ),
  constraint attendance_monthly_payrolls_full_days_check check (
    full_days not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and full_days >= 0
    and full_days = trunc(full_days)
  ),
  constraint attendance_monthly_payrolls_half_days_check check (
    half_days not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and half_days >= 0
    and half_days = trunc(half_days)
  ),
  constraint attendance_monthly_payrolls_absence_days_check check (
    absence_days not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and absence_days >= 0
    and absence_days = trunc(absence_days)
  ),
  constraint attendance_monthly_payrolls_base_pay_yen_check check (
    base_pay not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and base_pay >= 0
    and base_pay = trunc(base_pay)
  ),
  constraint attendance_monthly_payrolls_overtime_pay_yen_check check (
    overtime_pay not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and overtime_pay >= 0
    and overtime_pay = trunc(overtime_pay)
  ),
  constraint attendance_monthly_payrolls_bonus_yen_check check (
    bonus not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and bonus >= 0
    and bonus = trunc(bonus)
  ),
  constraint attendance_monthly_payrolls_deduction_yen_check check (
    deduction not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and deduction >= 0
    and deduction = trunc(deduction)
  ),
  constraint attendance_monthly_payrolls_net_salary_yen_check check (
    net_salary not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and net_salary >= 0
    and net_salary = trunc(net_salary)
    and net_salary = base_pay + overtime_pay + bonus - deduction
  ),
  constraint attendance_monthly_payrolls_status_check check (
    status in ('draft', 'confirmed', 'reopened')
  ),
  constraint attendance_monthly_payrolls_note_check check (
    confirmation_note = btrim(confirmation_note)
    and char_length(confirmation_note) <= 2000
  ),
  constraint attendance_monthly_payrolls_confirmation_check check (
    status <> 'confirmed'
    or (
      confirmed_by_employee_profile_id is not null
      and confirmed_at is not null
    )
  ),
  constraint attendance_monthly_payrolls_version_check check (version >= 1),
  constraint attendance_monthly_payrolls_timestamps_check check (
    updated_at >= created_at
    and (confirmed_at is null or confirmed_at >= created_at)
  )
);

create index attendance_monthly_payrolls_month_status_idx
  on public.attendance_monthly_payrolls(
    salary_month, status, employee_profile_id
  );

create table public.attendance_accounting_audit_log (
  audit_id uuid primary key default gen_random_uuid(),
  object_type text not null,
  object_id text not null,
  action_type text not null,
  actor_employee_profile_id uuid not null
    references public.employee_profiles(id) on delete restrict,
  occurred_at timestamptz not null default statement_timestamp(),
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text not null default '',
  constraint attendance_accounting_audit_object_type_check check (
    object_type = btrim(object_type)
    and char_length(object_type) between 1 and 100
  ),
  constraint attendance_accounting_audit_object_id_check check (
    object_id = btrim(object_id)
    and char_length(object_id) between 1 and 200
  ),
  constraint attendance_accounting_audit_action_type_check check (
    action_type = btrim(action_type)
    and char_length(action_type) between 1 and 100
  ),
  constraint attendance_accounting_audit_snapshots_check check (
    (before_snapshot is null or jsonb_typeof(before_snapshot) = 'object')
    and (after_snapshot is null or jsonb_typeof(after_snapshot) = 'object')
    and (before_snapshot is not null or after_snapshot is not null)
  ),
  constraint attendance_accounting_audit_reason_check check (
    reason = btrim(reason) and char_length(reason) <= 2000
  )
);

create index attendance_accounting_audit_object_idx
  on public.attendance_accounting_audit_log(
    object_type, object_id, occurred_at desc, audit_id
  );
create index attendance_accounting_audit_actor_idx
  on public.attendance_accounting_audit_log(
    actor_employee_profile_id, occurred_at desc, audit_id
  );

create or replace function private.set_attendance_accounting_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = statement_timestamp();
  return new;
end;
$$;

revoke all on function private.set_attendance_accounting_updated_at()
  from public, anon, authenticated, service_role;

create trigger set_attendance_accounting_settings_updated_at
before update on public.attendance_accounting_settings
for each row execute function private.set_attendance_accounting_updated_at();

create trigger set_attendance_day_resolutions_updated_at
before update on public.attendance_day_resolutions
for each row execute function private.set_attendance_accounting_updated_at();

create trigger set_attendance_project_allocations_updated_at
before update on public.attendance_project_allocations
for each row execute function private.set_attendance_accounting_updated_at();

create trigger set_attendance_monthly_payrolls_updated_at
before update on public.attendance_monthly_payrolls
for each row execute function private.set_attendance_accounting_updated_at();

create or replace function private.reject_attendance_accounting_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'attendance accounting audit rows are immutable';
end;
$$;

revoke all on function private.reject_attendance_accounting_audit_mutation()
  from public, anon, authenticated, service_role;

create trigger reject_attendance_accounting_audit_mutation
before update or delete on public.attendance_accounting_audit_log
for each row
execute function private.reject_attendance_accounting_audit_mutation();

create or replace function private.current_attendance_accountant()
returns public.employee_profiles
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and employee.must_change_password = false
    and employee.deleted_at is null;
  if not found or not public.has_current_permission('module.labor.view') then
    raise exception using errcode = '42501', message = 'labor accountant required';
  end if;
  return actor;
end;
$$;

revoke all on function private.current_attendance_accountant()
  from public, anon, authenticated, service_role;

alter table public.attendance_accounting_settings enable row level security;
alter table public.attendance_accounting_settings force row level security;
alter table public.attendance_day_resolutions enable row level security;
alter table public.attendance_day_resolutions force row level security;
alter table public.attendance_project_allocations enable row level security;
alter table public.attendance_project_allocations force row level security;
alter table public.attendance_monthly_payrolls enable row level security;
alter table public.attendance_monthly_payrolls force row level security;
alter table public.attendance_accounting_audit_log enable row level security;
alter table public.attendance_accounting_audit_log force row level security;

revoke all on table
  public.attendance_accounting_settings,
  public.attendance_day_resolutions,
  public.attendance_project_allocations,
  public.attendance_monthly_payrolls,
  public.attendance_accounting_audit_log
from public, anon, authenticated, service_role;

grant select on table
  public.attendance_accounting_settings,
  public.attendance_day_resolutions,
  public.attendance_project_allocations,
  public.attendance_monthly_payrolls,
  public.attendance_accounting_audit_log
to service_role;

commit;

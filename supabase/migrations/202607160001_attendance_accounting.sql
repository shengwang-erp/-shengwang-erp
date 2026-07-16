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
  constraint attendance_accounting_settings_effective_from_finite_check check (
    isfinite(effective_from)
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
  constraint attendance_accounting_settings_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_accounting_settings_updated_at_finite_check check (
    isfinite(updated_at)
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
  constraint attendance_day_resolutions_work_date_finite_check check (
    isfinite(work_date)
  ),
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
  constraint attendance_day_resolutions_confirmed_at_finite_check check (
    confirmed_at is null or isfinite(confirmed_at)
  ),
  constraint attendance_day_resolutions_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_day_resolutions_updated_at_finite_check check (
    isfinite(updated_at)
  ),
  constraint attendance_day_resolutions_timestamps_check check (
    updated_at >= created_at
    and (
      confirmed_at is null
      or confirmed_at between created_at and updated_at
    )
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
  constraint attendance_project_allocations_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_project_allocations_updated_at_finite_check check (
    isfinite(updated_at)
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
  constraint attendance_monthly_payrolls_salary_month_finite_check check (
    isfinite(salary_month)
  ),
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
    (
      status = 'confirmed'
      and confirmed_by_employee_profile_id is not null
      and confirmed_at is not null
    )
    or (
      status in ('draft', 'reopened')
      and confirmed_by_employee_profile_id is null
      and confirmed_at is null
    )
  ),
  constraint attendance_monthly_payrolls_version_check check (version >= 1),
  constraint attendance_monthly_payrolls_confirmed_at_finite_check check (
    confirmed_at is null or isfinite(confirmed_at)
  ),
  constraint attendance_monthly_payrolls_created_at_finite_check check (
    isfinite(created_at)
  ),
  constraint attendance_monthly_payrolls_updated_at_finite_check check (
    isfinite(updated_at)
  ),
  constraint attendance_monthly_payrolls_timestamps_check check (
    updated_at >= created_at
    and (
      confirmed_at is null
      or confirmed_at between created_at and updated_at
    )
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
  ),
  constraint attendance_accounting_audit_occurred_at_finite_check check (
    isfinite(occurred_at)
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

create or replace function private.attendance_accounting_settings_json()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'configured', true,
        'effectiveFrom', settings.effective_from,
        'workWeekdays', (
          select jsonb_agg(weekday order by weekday)
          from unnest(settings.work_weekdays) weekday
        ),
        'workStartTime', to_char(settings.work_start_time, 'HH24:MI'),
        'workEndTime', to_char(settings.work_end_time, 'HH24:MI'),
        'breakMinutes', settings.break_minutes,
        'standardDayMinutes', settings.standard_day_minutes
      )
      from public.attendance_accounting_settings settings
      where settings.settings_key = 'default'
    ),
    jsonb_build_object(
      'configured', false,
      'effectiveFrom', null,
      'workWeekdays', jsonb_build_array(1, 2, 3, 4, 5, 6),
      'workStartTime', '08:00',
      'workEndTime', '17:00',
      'breakMinutes', 60,
      'standardDayMinutes', 480
    )
  );
$$;

revoke all on function private.attendance_accounting_settings_json()
  from public, anon, authenticated, service_role;

create or replace function private.attendance_issue_codes(
  p_employee_profile_id uuid,
  p_work_date date,
  p_now_tokyo timestamp without time zone
)
returns text[]
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  settings public.attendance_accounting_settings%rowtype;
  schedule_required boolean;
  shift_start timestamp without time zone;
  shift_end timestamp without time zone;
  first_clock_in timestamp without time zone;
  last_clock_out timestamp without time zone;
  reference_end timestamp without time zone;
  has_open_session boolean;
  has_abnormal_location boolean;
  issue_codes text[] := array[]::text[];
begin
  if p_employee_profile_id is null
    or p_work_date is null
    or not isfinite(p_work_date)
    or p_now_tokyo is null
    or not isfinite(p_now_tokyo)
  then
    raise exception using
      errcode = '22023',
      message = 'valid attendance classification inputs required';
  end if;

  select setting.*
    into settings
    from public.attendance_accounting_settings setting
    where setting.settings_key = 'default';

  if not found or p_work_date < settings.effective_from then
    return issue_codes;
  end if;

  if exists (
    select 1
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date = p_work_date
      and resolution.accounting_status in ('confirmed', 'month_locked')
      and resolution.resolution_type in (
        'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'
      )
  ) then
    return issue_codes;
  end if;

  schedule_required :=
    extract(isodow from p_work_date)::smallint = any(settings.work_weekdays);
  shift_start := p_work_date + settings.work_start_time;
  shift_end := p_work_date + settings.work_end_time;

  select
    min(coalesce(
      clock_in.server_recorded_at,
      attendance_session.opened_at
    ) at time zone 'Asia/Tokyo'),
    max(coalesce(
      clock_out.server_recorded_at,
      attendance_session.closed_at
    ) at time zone 'Asia/Tokyo'),
    coalesce(bool_or(attendance_session.status = 'open'), false),
    coalesce(bool_or(
      clock_in.result = 'abnormal' or clock_out.result = 'abnormal'
    ), false)
    into
      first_clock_in,
      last_clock_out,
      has_open_session,
      has_abnormal_location
    from public.project_attendance_sessions attendance_session
    left join public.project_attendance_events clock_in
      on clock_in.session_id = attendance_session.session_id
      and clock_in.event_type = 'clock_in'
    left join public.project_attendance_events clock_out
      on clock_out.session_id = attendance_session.session_id
      and clock_out.event_type = 'clock_out'
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date;

  if first_clock_in is null then
    if schedule_required and p_now_tokyo > shift_start then
      issue_codes := array_append(issue_codes, 'missing_clock_in');
    end if;
    return issue_codes;
  end if;

  if has_abnormal_location then
    issue_codes := array_append(issue_codes, 'abnormal_location');
  end if;
  if has_open_session and p_now_tokyo > shift_end then
    issue_codes := array_append(issue_codes, 'missing_clock_out');
  end if;
  if schedule_required and first_clock_in > shift_start then
    issue_codes := array_append(issue_codes, 'late');
  end if;
  if schedule_required
    and not has_open_session
    and last_clock_out is not null
    and last_clock_out < shift_end
  then
    issue_codes := array_append(issue_codes, 'early');
  end if;

  reference_end := case
    when has_open_session then p_now_tokyo
    else last_clock_out
  end;
  if reference_end is not null
    and reference_end >= first_clock_in
    and extract(epoch from (reference_end - first_clock_in)) / 60
      - settings.break_minutes > settings.standard_day_minutes
  then
    issue_codes := array_append(issue_codes, 'overtime_pending');
  end if;

  return issue_codes;
end;
$$;

revoke all on function private.attendance_issue_codes(
  uuid, date, timestamp without time zone
) from public, anon, authenticated, service_role;

create or replace function private.attendance_dashboard_employee_json(
  p_employee_profile_id uuid,
  p_work_date date,
  p_can_view_salary boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
  settings public.attendance_accounting_settings%rowtype;
  configured boolean := false;
  schedule_required boolean := false;
  now_tokyo timestamp without time zone :=
    statement_timestamp() at time zone 'Asia/Tokyo';
  issue_codes text[];
  first_clock_in timestamptz;
  last_clock_out timestamptz;
  reference_end timestamptz;
  has_open_session boolean;
  has_abnormal_location boolean;
  worked_minutes_reference integer;
  sessions jsonb;
  resolution jsonb;
  resolution_type text;
  accounting_status text;
  day_status text;
  salary_type text;
  result jsonb;
begin
  if p_employee_profile_id is null
    or p_work_date is null
    or not isfinite(p_work_date)
  then
    raise exception using errcode = '22023', message = 'valid dashboard employee required';
  end if;

  select profile.*
    into employee
    from public.employee_profiles profile
    where profile.id = p_employee_profile_id
      and profile.deleted_at is null
      and not profile.is_hidden_system_account
      and profile.employee_number <> 'SW-000';
  if not found then
    return null;
  end if;

  select setting.*
    into settings
    from public.attendance_accounting_settings setting
    where setting.settings_key = 'default';
  configured := found;
  if configured and p_work_date >= settings.effective_from then
    schedule_required :=
      extract(isodow from p_work_date)::smallint = any(settings.work_weekdays);
  end if;

  issue_codes := private.attendance_issue_codes(
    p_employee_profile_id,
    p_work_date,
    now_tokyo
  );

  select
    min(coalesce(
      clock_in.server_recorded_at,
      attendance_session.opened_at
    )),
    max(coalesce(
      clock_out.server_recorded_at,
      attendance_session.closed_at
    )),
    coalesce(bool_or(attendance_session.status = 'open'), false),
    coalesce(bool_or(
      clock_in.result = 'abnormal' or clock_out.result = 'abnormal'
    ), false)
    into
      first_clock_in,
      last_clock_out,
      has_open_session,
      has_abnormal_location
    from public.project_attendance_sessions attendance_session
    left join public.project_attendance_events clock_in
      on clock_in.session_id = attendance_session.session_id
      and clock_in.event_type = 'clock_in'
    left join public.project_attendance_events clock_out
      on clock_out.session_id = attendance_session.session_id
      and clock_out.event_type = 'clock_out'
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date;

  select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'sessionId', attendance_session.session_id,
          'projectId', attendance_session.project_id,
          'projectName', attendance_session.project_name_snapshot,
          'status', attendance_session.status,
          'openedAt', attendance_session.opened_at,
          'closedAt', attendance_session.closed_at,
          'clockInEvent', case
            when clock_in.event_id is null then null
            else jsonb_build_object(
              'eventId', clock_in.event_id,
              'eventType', clock_in.event_type,
              'serverRecordedAt', clock_in.server_recorded_at,
              'result', clock_in.result,
              'abnormalReason', clock_in.abnormal_reason
            )
          end,
          'clockOutEvent', case
            when clock_out.event_id is null then null
            else jsonb_build_object(
              'eventId', clock_out.event_id,
              'eventType', clock_out.event_type,
              'serverRecordedAt', clock_out.server_recorded_at,
              'result', clock_out.result,
              'abnormalReason', clock_out.abnormal_reason
            )
          end
        )
        order by coalesce(
          clock_in.server_recorded_at,
          attendance_session.opened_at
        ), attendance_session.session_id
      ),
      '[]'::jsonb
    )
    into sessions
    from public.project_attendance_sessions attendance_session
    left join public.project_attendance_events clock_in
      on clock_in.session_id = attendance_session.session_id
      and clock_in.event_type = 'clock_in'
    left join public.project_attendance_events clock_out
      on clock_out.session_id = attendance_session.session_id
      and clock_out.event_type = 'clock_out'
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date;

  select
    jsonb_build_object(
      'resolutionId', day_resolution.resolution_id,
      'resolutionType', day_resolution.resolution_type,
      'attendanceUnits', day_resolution.attendance_units,
      'accountingStatus', day_resolution.accounting_status,
      'scheduleRequired', day_resolution.schedule_required,
      'resolutionNote', day_resolution.resolution_note,
      'confirmedAt', day_resolution.confirmed_at,
      'version', day_resolution.version
    ),
    day_resolution.resolution_type,
    day_resolution.accounting_status
    into resolution, resolution_type, accounting_status
    from public.attendance_day_resolutions day_resolution
    where day_resolution.employee_profile_id = p_employee_profile_id
      and day_resolution.work_date = p_work_date;

  if first_clock_in is not null then
    reference_end := case
      when has_open_session then statement_timestamp()
      else last_clock_out
    end;
    if reference_end is not null and reference_end >= first_clock_in then
      worked_minutes_reference := greatest(
        0,
        floor(
          extract(epoch from (reference_end - first_clock_in)) / 60
          - case when configured then settings.break_minutes else 60 end
        )::integer
      );
    end if;
  end if;

  if not configured then
    day_status := 'unconfigured';
  elsif p_work_date < settings.effective_from then
    day_status := 'before_activation';
  elsif accounting_status in ('confirmed', 'month_locked')
    and resolution_type in (
      'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'
    )
  then
    day_status := resolution_type;
  elsif first_clock_in is null and not schedule_required then
    day_status := 'optional_not_worked';
  elsif first_clock_in is null
    and issue_codes @> array['missing_clock_in']::text[]
  then
    day_status := 'missing_clock_in';
  elsif first_clock_in is null then
    day_status := 'not_started';
  elsif has_open_session then
    day_status := 'working';
  else
    day_status := 'completed';
  end if;

  result := jsonb_build_object(
    'employeeProfileId', employee.id,
    'employeeNumber', employee.employee_number,
    'name', employee.name,
    'department', employee.department,
    'position', employee.position,
    'scheduleRequired', schedule_required,
    'dayStatus', day_status,
    'issueCodes', issue_codes,
    'firstClockInAt', first_clock_in,
    'lastClockOutAt', last_clock_out,
    'hasOpenSession', has_open_session,
    'hasAbnormalLocation', has_abnormal_location,
    'workedMinutesReference', worked_minutes_reference,
    'sessions', sessions,
    'resolution', resolution
  );

  if coalesce(p_can_view_salary, false) then
    salary_type := case
      when employee.base_salary is not null then '月薪'
      when employee.daily_salary is not null then '日薪'
      when employee.hourly_wage is not null then '时薪'
      else '未设置'
    end;
    result := result || jsonb_build_object(
      'salary', jsonb_build_object(
        'salaryType', salary_type,
        'baseSalary', employee.base_salary,
        'dailySalary', employee.daily_salary,
        'hourlyWage', employee.hourly_wage,
        'salaryRemark', employee.salary_remark
      )
    );
  end if;

  return result;
end;
$$;

revoke all on function private.attendance_dashboard_employee_json(
  uuid, date, boolean
) from public, anon, authenticated, service_role;

create or replace function public.list_daily_attendance_dashboard_secure(
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
  now_tokyo timestamp without time zone;
  can_resolve boolean;
  can_view_salary boolean;
  can_update_salary boolean;
  can_view_project_costs boolean;
  can_update_project_costs boolean;
  can_update_settings boolean;
  settings jsonb;
  permissions jsonb;
  employees jsonb;
  summary jsonb;
  filters jsonb;
begin
  actor := private.current_attendance_accountant();

  if p_work_date is null or not isfinite(p_work_date) then
    raise exception using errcode = '22023', message = 'valid work date required';
  end if;

  now_tokyo := statement_timestamp() at time zone 'Asia/Tokyo';
  can_resolve := public.has_current_permission('module.labor.update');
  can_view_salary := public.has_current_permission('sensitive.salary_view');
  can_update_salary := can_resolve
    and public.has_current_permission('sensitive.salary_update');
  can_view_project_costs :=
    public.has_current_permission('module.project_costs.view');
  can_update_project_costs := can_resolve
    and public.has_current_permission('module.project_costs.update')
    and public.has_current_permission('sensitive.salary_update');
  can_update_settings :=
    public.has_current_permission('module.settings.update');

  settings := private.attendance_accounting_settings_json();
  permissions := jsonb_build_object(
    'canResolve', can_resolve,
    'canViewSalary', can_view_salary,
    'canUpdateSalary', can_update_salary,
    'canViewProjectCosts', can_view_project_costs,
    'canUpdateProjectCosts', can_update_project_costs,
    'canUpdateSettings', can_update_settings
  );

  select coalesce(
      jsonb_agg(
        private.attendance_dashboard_employee_json(
          employee.id,
          p_work_date,
          can_view_salary
        )
        order by employee.employee_number, employee.id
      ),
      '[]'::jsonb
    )
    into employees
    from public.employee_profiles employee
    where employee.deleted_at is null
      and not employee.is_hidden_system_account
      and employee.employee_number <> 'SW-000'
      and (employee.hire_date is null or employee.hire_date <= p_work_date)
      and (employee.resign_date is null or employee.resign_date >= p_work_date)
      and (
        employee.employment_status <> '离职'
        or employee.resign_date is not null
      );

  select jsonb_build_object(
      'totalEmployees', count(*),
      'requiredEmployees', count(*) filter (
        where (employee->>'scheduleRequired')::boolean
      ),
      'normalCompleted', count(*) filter (
        where employee->>'dayStatus' = 'completed'
          and jsonb_array_length(employee->'issueCodes') = 0
      ),
      'working', count(*) filter (
        where employee->>'dayStatus' = 'working'
      ),
      'excused', count(*) filter (
        where employee->>'dayStatus' in ('rest', 'leave', 'comp_time')
      ),
      'alertCount', count(*) filter (
        where jsonb_array_length(employee->'issueCodes') > 0
      ),
      'abnormalLocation', count(*) filter (
        where employee->'issueCodes' ? 'abnormal_location'
      ),
      'missingClockIn', count(*) filter (
        where employee->'issueCodes' ? 'missing_clock_in'
      ),
      'missingClockOut', count(*) filter (
        where employee->'issueCodes' ? 'missing_clock_out'
      ),
      'late', count(*) filter (
        where employee->'issueCodes' ? 'late'
      ),
      'early', count(*) filter (
        where employee->'issueCodes' ? 'early'
      ),
      'overtimePending', count(*) filter (
        where employee->'issueCodes' ? 'overtime_pending'
      )
    )
    into summary
    from jsonb_array_elements(employees) employee;

  filters := jsonb_build_object(
    'departments', coalesce((
      select jsonb_agg(option.department order by option.department)
      from (
        select distinct employee->>'department' department
        from jsonb_array_elements(employees) employee
      ) option
    ), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'projectId', option.project_id,
          'projectName', option.project_name
        )
        order by option.project_name, option.project_id
      )
      from (
        select
          session->>'projectId' project_id,
          min(session->>'projectName') project_name
        from jsonb_array_elements(employees) employee
        cross join lateral jsonb_array_elements(employee->'sessions') session
        group by session->>'projectId'
      ) option
    ), '[]'::jsonb),
    'dayStatuses', coalesce((
      select jsonb_agg(option.day_status order by option.day_status)
      from (
        select distinct employee->>'dayStatus' day_status
        from jsonb_array_elements(employees) employee
      ) option
    ), '[]'::jsonb),
    'issueCodes', jsonb_build_array(
      'abnormal_location',
      'missing_clock_in',
      'missing_clock_out',
      'late',
      'early',
      'overtime_pending'
    )
  );

  return jsonb_build_object(
    'workDate', p_work_date,
    'serverNowTokyo',
      to_char(now_tokyo, 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+09:00',
    'settings', settings,
    'permissions', permissions,
    'summary', summary,
    'filters', filters,
    'employees', employees
  );
end;
$$;

revoke all on function public.list_daily_attendance_dashboard_secure(date)
  from public, anon, authenticated, service_role;
grant execute on function public.list_daily_attendance_dashboard_secure(date)
  to authenticated, service_role;

create or replace function public.get_labor_alert_count_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  dashboard jsonb;
begin
  dashboard := public.list_daily_attendance_dashboard_secure(
    (statement_timestamp() at time zone 'Asia/Tokyo')::date
  );
  return jsonb_build_object(
    'workDate', dashboard->'workDate',
    'count', (dashboard#>>'{summary,alertCount}')::integer,
    'refreshedAt', dashboard->'serverNowTokyo'
  );
end;
$$;

revoke all on function public.get_labor_alert_count_secure()
  from public, anon, authenticated, service_role;
grant execute on function public.get_labor_alert_count_secure()
  to authenticated, service_role;

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

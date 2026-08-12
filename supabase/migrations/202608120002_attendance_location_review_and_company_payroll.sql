-- Audited location review and company-personnel payroll semantics. Existing
-- attendance/accounting RPCs remain callable while reviewed overloads roll out.

begin;

alter table public.attendance_day_resolutions
  add column location_review_status text,
  add column location_review_note text not null default '',
  add column location_reviewed_by_employee_profile_id uuid
    references public.employee_profiles(id) on delete restrict,
  add column location_reviewed_at timestamptz,
  add constraint attendance_day_resolutions_location_review_status_check check (
    location_review_status is null
    or location_review_status in ('confirmed_valid', 'recorded_abnormal')
  ),
  add constraint attendance_day_resolutions_location_review_note_check check (
    location_review_note = btrim(location_review_note)
    and char_length(location_review_note) <= 2000
  ),
  add constraint attendance_day_resolutions_location_review_shape_check check (
    (
      location_review_status is null
      and location_review_note = ''
      and location_reviewed_by_employee_profile_id is null
      and location_reviewed_at is null
    )
    or (
      location_review_status in ('confirmed_valid', 'recorded_abnormal')
      and char_length(location_review_note) between 1 and 2000
      and (
        (accounting_status = 'draft'
          and location_reviewed_by_employee_profile_id is null
          and location_reviewed_at is null)
        or (accounting_status in ('confirmed', 'month_locked')
          and location_reviewed_by_employee_profile_id is not null
          and location_reviewed_at is not null)
      )
    )
  ),
  add constraint attendance_day_resolutions_location_reviewed_at_finite_check
    check (location_reviewed_at is null or isfinite(location_reviewed_at));

alter table public.attendance_monthly_payrolls
  add column attendance_method_snapshot text not null default 'project',
  add column company_personnel_cost numeric not null default 0,
  add column location_abnormal_count integer not null default 0,
  add column location_review_summary text not null default '',
  add constraint attendance_monthly_payrolls_method_snapshot_check check (
    attendance_method_snapshot in ('project', 'general', 'exempt')
  ),
  add constraint attendance_monthly_payrolls_company_cost_yen_check check (
    company_personnel_cost not in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    and company_personnel_cost >= 0
    and company_personnel_cost = trunc(company_personnel_cost)
    and (
      (attendance_method_snapshot = 'project' and company_personnel_cost = 0)
      or (attendance_method_snapshot in ('general', 'exempt')
        and company_personnel_cost = net_salary)
    )
  ),
  add constraint attendance_monthly_payrolls_location_abnormal_count_check
    check (location_abnormal_count >= 0),
  add constraint attendance_monthly_payrolls_location_review_summary_check
    check (location_review_summary = btrim(location_review_summary));

create or replace function private.attendance_fact_mode(
  p_employee_profile_id uuid,
  p_work_date date
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
begin
  if exists (
    select 1 from public.project_attendance_sessions attendance_session
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date
      and attendance_session.attendance_mode = 'project'
  ) then
    return 'project';
  end if;
  if exists (
    select 1 from public.project_attendance_sessions attendance_session
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date
      and attendance_session.attendance_mode = 'general'
  ) then
    return 'general';
  end if;
  select profile.* into employee
  from public.employee_profiles profile
  where profile.id = p_employee_profile_id;
  if not found then
    return null;
  end if;
  return private.attendance_policy_mode(
    employee.attendance_required, employee.department
  );
end;
$$;

create or replace function private.attendance_month_method(
  p_employee_profile_id uuid,
  p_month date
)
returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_method text;
  employee public.employee_profiles%rowtype;
begin
  select payroll.attendance_method_snapshot into saved_method
  from public.attendance_monthly_payrolls payroll
  where payroll.employee_profile_id = p_employee_profile_id
    and payroll.salary_month = p_month
    and payroll.status = 'confirmed';
  if found then
    return saved_method;
  end if;
  if exists (
    select 1 from public.project_attendance_sessions attendance_session
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date >= p_month
      and attendance_session.work_date < (p_month + interval '1 month')::date
      and attendance_session.attendance_mode = 'project'
  ) then
    return 'project';
  end if;
  if exists (
    select 1 from public.project_attendance_sessions attendance_session
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date >= p_month
      and attendance_session.work_date < (p_month + interval '1 month')::date
      and attendance_session.attendance_mode = 'general'
  ) then
    return 'general';
  end if;
  select profile.* into employee
  from public.employee_profiles profile
  where profile.id = p_employee_profile_id;
  if not found then
    return 'project';
  end if;
  return private.attendance_policy_mode(
    employee.attendance_required, employee.department
  );
end;
$$;

create or replace function private.attendance_location_review_metrics(
  p_employee_profile_id uuid,
  p_month date
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'count', count(*) filter (
      where resolution.issue_codes_snapshot
        @> array['abnormal_location']::text[]
    ),
    'summary', coalesce(string_agg(
      case resolution.location_review_status
        when 'confirmed_valid' then to_char(resolution.work_date, 'YYYY-MM-DD')
          || ' 确认有效：' || resolution.location_review_note
        when 'recorded_abnormal' then to_char(resolution.work_date, 'YYYY-MM-DD')
          || ' 判定异常：' || resolution.location_review_note
        else to_char(resolution.work_date, 'YYYY-MM-DD')
          || ' 历史定位异常：未结构化复核'
      end,
      '；' order by resolution.work_date, resolution.resolution_id
    ) filter (
      where resolution.issue_codes_snapshot
        @> array['abnormal_location']::text[]
    ), '')
  )
  from public.attendance_day_resolutions resolution
  where resolution.employee_profile_id = p_employee_profile_id
    and resolution.work_date >= p_month
    and resolution.work_date < (p_month + interval '1 month')::date
    and resolution.accounting_status in ('confirmed', 'month_locked');
$$;

revoke all on function private.attendance_fact_mode(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_month_method(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_location_review_metrics(uuid, date)
  from public, anon, authenticated, service_role;

alter function private.attendance_dashboard_employee_json(uuid, date, boolean)
  rename to attendance_dashboard_employee_json_v1;

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
  result jsonb;
  session_item jsonb;
  sessions_result jsonb := '[]'::jsonb;
  session_mode text;
  resolution_row public.attendance_day_resolutions%rowtype;
begin
  result := private.attendance_dashboard_employee_json_v1(
    p_employee_profile_id, p_work_date, p_can_view_salary
  );
  if result is null then
    return null;
  end if;
  for session_item in
    select item from jsonb_array_elements(result->'sessions') item
  loop
    select attendance_session.attendance_mode into session_mode
    from public.project_attendance_sessions attendance_session
    where attendance_session.session_id = (session_item->>'sessionId')::uuid;
    sessions_result := sessions_result || jsonb_build_array(
      session_item || jsonb_build_object(
        'attendanceMode', coalesce(session_mode, 'project')
      )
    );
  end loop;
  result := jsonb_set(result, '{sessions}', sessions_result);
  if result->'resolution' <> 'null'::jsonb then
    select resolution.* into resolution_row
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date = p_work_date;
    result := jsonb_set(result, '{resolution}',
      result->'resolution' || jsonb_build_object(
        'locationReviewStatus', resolution_row.location_review_status,
        'locationReviewNote', resolution_row.location_review_note,
        'locationReviewedByEmployeeProfileId',
          resolution_row.location_reviewed_by_employee_profile_id,
        'locationReviewedAt', resolution_row.location_reviewed_at
      ));
  end if;
  return result;
end;
$$;

revoke all on function private.attendance_dashboard_employee_json(
  uuid, date, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.attendance_dashboard_employee_json_v1(
  uuid, date, boolean
) from public, anon, authenticated, service_role;

alter function private.attendance_resolution_result(uuid, date)
  rename to attendance_resolution_result_v1;

create or replace function private.attendance_resolution_result(
  p_employee_profile_id uuid,
  p_work_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  resolution_row public.attendance_day_resolutions%rowtype;
  fact_mode text;
begin
  result := private.attendance_resolution_result_v1(
    p_employee_profile_id, p_work_date
  );
  fact_mode := private.attendance_fact_mode(p_employee_profile_id, p_work_date);
  if result->'resolution' <> 'null'::jsonb then
    select resolution.* into resolution_row
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id = p_employee_profile_id
      and resolution.work_date = p_work_date;
    result := jsonb_set(result, '{resolution}',
      result->'resolution' || jsonb_build_object(
        'locationReviewStatus', resolution_row.location_review_status,
        'locationReviewNote', resolution_row.location_review_note,
        'locationReviewedByEmployeeProfileId',
          resolution_row.location_reviewed_by_employee_profile_id,
        'locationReviewedAt', resolution_row.location_reviewed_at
      ));
  end if;
  if fact_mode in ('general', 'exempt') then
    if result->'salary' <> 'null'::jsonb then
      result := jsonb_set(
        result, '{salary,suggestedProjectCost}', to_jsonb(0::numeric)
      );
    end if;
    result := jsonb_set(result, '{availableProjects}', '[]'::jsonb);
  end if;
  return result;
end;
$$;

revoke all on function private.attendance_resolution_result(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_resolution_result_v1(uuid, date)
  from public, anon, authenticated, service_role;

alter function private.attendance_resolution_snapshot(uuid)
  rename to attendance_resolution_snapshot_v1;

create or replace function private.attendance_resolution_snapshot(
  p_resolution_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.attendance_resolution_snapshot_v1(p_resolution_id)
    || jsonb_build_object(
      'locationReviewStatus', resolution.location_review_status,
      'locationReviewNote', resolution.location_review_note,
      'locationReviewedByEmployeeProfileId',
        resolution.location_reviewed_by_employee_profile_id,
      'locationReviewedAt', resolution.location_reviewed_at
    )
  from public.attendance_day_resolutions resolution
  where resolution.resolution_id = p_resolution_id;
$$;

revoke all on function private.attendance_resolution_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_resolution_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.set_attendance_location_review()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  review_is_explicit boolean := coalesce(
    current_setting('app.attendance_location_review_explicit', true), ''
  ) = 'true';
begin
  if not review_is_explicit then
    if private.attendance_fact_mode(
        new.employee_profile_id, new.work_date
      ) = 'general' then
      new.suggested_project_cost := 0;
    end if;
    return new;
  end if;
  new.location_review_status := nullif(
    current_setting('app.attendance_location_review_status', true), ''
  );
  new.location_review_note := btrim(coalesce(
    current_setting('app.attendance_location_review_note', true), ''
  ));
  if private.attendance_fact_mode(
      new.employee_profile_id, new.work_date
    ) = 'general' then
    new.suggested_project_cost := 0;
  end if;
  if new.location_review_status is null
      or new.accounting_status = 'draft' then
    new.location_reviewed_by_employee_profile_id := null;
    new.location_reviewed_at := null;
  else
    new.location_reviewed_by_employee_profile_id :=
      new.confirmed_by_employee_profile_id;
    new.location_reviewed_at := new.confirmed_at;
  end if;
  return new;
end;
$$;

create trigger set_attendance_location_review
before insert or update on public.attendance_day_resolutions
for each row execute function private.set_attendance_location_review();

revoke all on function private.set_attendance_location_review()
  from public, anon, authenticated, service_role;

alter function private.attendance_write_resolution(
  uuid, date, text, numeric, numeric, jsonb, text, integer, boolean
) rename to attendance_write_resolution_v1;

create or replace function private.attendance_write_resolution_with_review(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_location_review_status text,
  p_location_review_note text,
  p_version integer,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  fact_mode text;
  has_abnormal_location boolean;
  normalized_review_note text;
  existing_resolution public.attendance_day_resolutions%rowtype;
  result jsonb;
begin
  if p_location_review_note is null
      or char_length(btrim(p_location_review_note)) > 2000 then
    raise exception using
      errcode = '22023', message = 'valid location review note required';
  end if;
  normalized_review_note := btrim(p_location_review_note);
  if p_location_review_status is not null
      and p_location_review_status not in (
        'confirmed_valid', 'recorded_abnormal'
      ) then
    raise exception using
      errcode = '22023', message = 'valid location review status required';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception using errcode = '22023', message = 'invalid project allocations';
  end if;

  fact_mode := private.attendance_fact_mode(p_employee_profile_id, p_work_date);
  if fact_mode = 'general' and (
    p_final_project_cost <> 0 or jsonb_array_length(p_allocations) <> 0
  ) then
    raise exception using
      errcode = '22023',
      message = 'general attendance cannot create project labor cost',
      hint = 'ATTENDANCE_GENERAL_PROJECT_COST_FORBIDDEN';
  end if;
  if fact_mode = 'exempt' then
    raise exception using
      errcode = '55000',
      message = 'exempt attendance does not create daily resolutions',
      hint = 'ATTENDANCE_EXEMPT_DAILY_RESOLUTION_FORBIDDEN';
  end if;

  has_abnormal_location := exists (
    select 1
    from public.project_attendance_sessions attendance_session
    join public.project_attendance_events event
      on event.session_id = attendance_session.session_id
    where attendance_session.employee_profile_id = p_employee_profile_id
      and attendance_session.work_date = p_work_date
      and event.result = 'abnormal'
  );
  if has_abnormal_location then
    if p_confirm and (
      p_location_review_status is null
      or char_length(normalized_review_note) not between 1 and 2000
    ) then
      raise exception using
        errcode = '55000',
        message = 'location review is required for out-of-range attendance',
        hint = 'ATTENDANCE_LOCATION_REVIEW_REQUIRED';
    end if;
    if not p_confirm and p_location_review_status is not null
        and char_length(normalized_review_note) not between 1 and 2000 then
      raise exception using
        errcode = '22023', message = 'valid location review note required';
    end if;
  elsif p_location_review_status is not null or normalized_review_note <> '' then
    raise exception using
      errcode = '22023',
      message = 'location review is not allowed without out-of-range attendance';
  end if;

  select resolution.* into existing_resolution
  from public.attendance_day_resolutions resolution
  where resolution.employee_profile_id = p_employee_profile_id
    and resolution.work_date = p_work_date;
  if p_confirm and existing_resolution.accounting_status in (
      'confirmed', 'month_locked'
    ) and (
      existing_resolution.location_review_status
        is distinct from p_location_review_status
      or existing_resolution.location_review_note
        is distinct from normalized_review_note
    ) then
    raise exception using
      errcode = '55000',
      message = 'confirmed attendance location review is immutable';
  end if;

  perform set_config('app.attendance_location_review_explicit', 'true', true);
  perform set_config('app.attendance_location_review_status',
    coalesce(p_location_review_status, ''), true);
  perform set_config('app.attendance_location_review_note',
    normalized_review_note, true);
  result := private.attendance_write_resolution_v1(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, case when fact_mode = 'general' then 0
      else p_final_project_cost end,
    case when fact_mode = 'general' then '[]'::jsonb else p_allocations end,
    p_resolution_note, p_version, p_confirm
  );
  perform set_config('app.attendance_location_review_explicit', '', true);
  perform set_config('app.attendance_location_review_status', '', true);
  perform set_config('app.attendance_location_review_note', '', true);
  return result;
exception when others then
  perform set_config('app.attendance_location_review_explicit', '', true);
  perform set_config('app.attendance_location_review_status', '', true);
  perform set_config('app.attendance_location_review_note', '', true);
  raise;
end;
$$;

create or replace function private.attendance_write_resolution(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_version integer,
  p_confirm boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(
    pg_catalog.hashtextextended('attendance_accounting_settings', 0)
  );
  return private.attendance_write_resolution_with_review(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, null, '', p_version, p_confirm
  );
end;
$$;

-- Keep the legacy public signatures and grants, but route them through the
-- guarded compatibility helper so an abnormal fact cannot bypass review.
create or replace function public.save_attendance_resolution_draft_secure(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_version integer
)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  select private.attendance_write_resolution(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, p_version, false
  );
$$;

create or replace function public.confirm_attendance_resolution_secure(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_version integer
)
returns jsonb
language sql
volatile
security definer
set search_path = pg_catalog, public
as $$
  select private.attendance_write_resolution(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, p_version, true
  );
$$;

revoke all on function private.attendance_write_resolution_with_review(
  uuid, date, text, numeric, numeric, jsonb, text, text, text,
  integer, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.attendance_write_resolution(
  uuid, date, text, numeric, numeric, jsonb, text, integer, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.attendance_write_resolution_v1(
  uuid, date, text, numeric, numeric, jsonb, text, integer, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.save_attendance_resolution_draft_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.confirm_attendance_resolution_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_resolution_draft_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) to authenticated, service_role;
grant execute on function public.confirm_attendance_resolution_secure(
  uuid, date, text, numeric, numeric, jsonb, text, integer
) to authenticated, service_role;

create function public.save_attendance_resolution_draft_secure(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_location_review_status text,
  p_location_review_note text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform private.current_attendance_accountant();
  return private.attendance_write_resolution_with_review(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, p_location_review_status, p_location_review_note,
    p_version, false
  );
end;
$$;

create function public.confirm_attendance_resolution_secure(
  p_employee_profile_id uuid,
  p_work_date date,
  p_resolution_type text,
  p_attendance_units numeric,
  p_final_project_cost numeric,
  p_allocations jsonb,
  p_resolution_note text,
  p_location_review_status text,
  p_location_review_note text,
  p_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  perform private.current_attendance_accountant();
  return private.attendance_write_resolution_with_review(
    p_employee_profile_id, p_work_date, p_resolution_type,
    p_attendance_units, p_final_project_cost, p_allocations,
    p_resolution_note, p_location_review_status, p_location_review_note,
    p_version, true
  );
end;
$$;

revoke all on function public.save_attendance_resolution_draft_secure(
  uuid, date, text, numeric, numeric, jsonb, text, text, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.confirm_attendance_resolution_secure(
  uuid, date, text, numeric, numeric, jsonb, text, text, text, integer
) from public, anon, authenticated, service_role;
grant execute on function public.save_attendance_resolution_draft_secure(
  uuid, date, text, numeric, numeric, jsonb, text, text, text, integer
) to authenticated, service_role;
grant execute on function public.confirm_attendance_resolution_secure(
  uuid, date, text, numeric, numeric, jsonb, text, text, text, integer
) to authenticated, service_role;

alter function private.attendance_month_counts(uuid, date)
  rename to attendance_month_counts_v1;

create or replace function private.attendance_month_counts(
  p_employee_profile_id uuid,
  p_month date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  attendance_method text;
  counts jsonb;
  payroll public.attendance_monthly_payrolls%rowtype;
  scheduled_attendance_units integer := 0;
  full_days numeric := 0;
  half_days numeric := 0;
  absence_days numeric := 0;
begin
  attendance_method := private.attendance_month_method(
    p_employee_profile_id, p_month
  );
  if attendance_method = 'exempt' then
    select saved.* into payroll
    from public.attendance_monthly_payrolls saved
    where saved.employee_profile_id = p_employee_profile_id
      and saved.salary_month = p_month
      and saved.status = 'confirmed';
    if found then
      scheduled_attendance_units := payroll.scheduled_attendance_units;
      full_days := payroll.full_days;
      half_days := payroll.half_days;
      absence_days := payroll.absence_days;
    else
      select count(*)::integer into scheduled_attendance_units
      from generate_series(
        p_month::timestamp,
        (p_month + interval '1 month - 1 day')::timestamp,
        interval '1 day'
      ) generated(day_value)
      where private.attendance_employee_is_eligible(
          p_employee_profile_id, generated.day_value::date
        )
        and private.attendance_schedule_required(generated.day_value::date);
      full_days := scheduled_attendance_units;
    end if;
    return jsonb_build_object(
      'fullDays', full_days,
      'halfDays', half_days,
      'absenceDays', absence_days,
      'excusedDays', 0,
      'scheduledAttendanceUnits', scheduled_attendance_units,
      'confirmedAttendanceUnits', full_days + half_days * 0.5,
      'pendingDays', 0,
      'projectAllocatedAmount', 0,
      'projectFinalCost', 0,
      'projectUnallocatedAmount', 0
    );
  end if;
  counts := private.attendance_month_counts_v1(
    p_employee_profile_id, p_month
  );
  if attendance_method = 'general' then
    counts := counts || jsonb_build_object(
      'projectAllocatedAmount', 0,
      'projectFinalCost', 0,
      'projectUnallocatedAmount', 0
    );
  end if;
  return counts;
end;
$$;

revoke all on function private.attendance_month_counts(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_month_counts_v1(uuid, date)
  from public, anon, authenticated, service_role;

create or replace function private.set_attendance_payroll_company_snapshot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attendance_method text;
  review_metrics jsonb;
begin
  if tg_op = 'UPDATE' and old.status = 'confirmed'
      and new.status = 'reopened' then
    return new;
  end if;
  attendance_method := private.attendance_month_method(
    new.employee_profile_id, new.salary_month
  );
  review_metrics := private.attendance_location_review_metrics(
    new.employee_profile_id, new.salary_month
  );
  new.attendance_method_snapshot := attendance_method;
  new.company_personnel_cost := case
    when attendance_method in ('general', 'exempt') then new.net_salary
    else 0
  end;
  new.location_abnormal_count := (review_metrics->>'count')::integer;
  new.location_review_summary := review_metrics->>'summary';
  return new;
end;
$$;

create trigger set_attendance_payroll_company_snapshot
before insert or update on public.attendance_monthly_payrolls
for each row execute function private.set_attendance_payroll_company_snapshot();

revoke all on function private.set_attendance_payroll_company_snapshot()
  from public, anon, authenticated, service_role;

alter function private.attendance_payroll_snapshot(uuid)
  rename to attendance_payroll_snapshot_v1;

create or replace function private.attendance_payroll_snapshot(
  p_payroll_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select private.attendance_payroll_snapshot_v1(p_payroll_id)
    || jsonb_build_object(
      'attendanceMethodSnapshot', payroll.attendance_method_snapshot,
      'companyPersonnelCost', payroll.company_personnel_cost,
      'locationAbnormalCount', payroll.location_abnormal_count,
      'locationReviewSummary', payroll.location_review_summary
    )
  from public.attendance_monthly_payrolls payroll
  where payroll.payroll_id = p_payroll_id;
$$;

revoke all on function private.attendance_payroll_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_payroll_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

alter function private.attendance_payroll_result(uuid)
  rename to attendance_payroll_result_v1;

create or replace function private.attendance_payroll_result(
  p_payroll_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  payroll public.attendance_monthly_payrolls%rowtype;
  employee_position text;
begin
  result := private.attendance_payroll_result_v1(p_payroll_id);
  select saved.* into payroll
  from public.attendance_monthly_payrolls saved
  where saved.payroll_id = p_payroll_id;
  select employee.position into employee_position
  from public.employee_profiles employee
  where employee.id = payroll.employee_profile_id;
  result := jsonb_set(result, '{employee}',
    result->'employee' || jsonb_build_object('position', employee_position));
  result := jsonb_set(result, '{payroll}',
    result->'payroll' || jsonb_build_object(
      'attendanceMethodSnapshot', payroll.attendance_method_snapshot,
      'locationAbnormalCount', payroll.location_abnormal_count,
      'locationReviewSummary', payroll.location_review_summary
    ) || case
      when public.has_current_permission('sensitive.salary_view') then
        jsonb_build_object('companyPersonnelCost', payroll.company_personnel_cost)
      else '{}'::jsonb
    end);
  return result;
end;
$$;

revoke all on function private.attendance_payroll_result(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_payroll_result_v1(uuid)
  from public, anon, authenticated, service_role;

alter function public.list_monthly_payroll_secure(date, text, uuid, boolean)
  rename to attendance_list_monthly_payroll_v1;
alter function public.attendance_list_monthly_payroll_v1(
  date, text, uuid, boolean
) set schema private;

revoke all on function private.attendance_list_monthly_payroll_v1(
  date, text, uuid, boolean
) from public, anon, authenticated, service_role;

create or replace function public.list_monthly_payroll_secure(
  p_month date,
  p_search text,
  p_employee_profile_id uuid,
  p_only_pending boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
  employee_item jsonb;
  employees_result jsonb := '[]'::jsonb;
  employee_id uuid;
  employee_position text;
  payroll public.attendance_monthly_payrolls%rowtype;
  attendance_method text;
  review_metrics jsonb;
  abnormal_count integer;
  review_summary text;
  company_cost numeric := 0;
  can_view_salary boolean;
begin
  result := private.attendance_list_monthly_payroll_v1(
    p_month, p_search, p_employee_profile_id, p_only_pending
  );
  can_view_salary := coalesce(
    (result#>>'{permissions,canViewSalary}')::boolean, false
  );
  for employee_item in
    select item from jsonb_array_elements(result->'employees') item
  loop
    employee_id := nullif(employee_item->>'employeeProfileId', '')::uuid;
    if employee_id is null then
      employee_item := employee_item || jsonb_build_object(
        'position', '',
        'attendanceMethod', 'project',
        'locationAbnormalCount', 0,
        'locationReviewSummary', ''
      );
      if can_view_salary then
        employee_item := employee_item || jsonb_build_object(
          'companyPersonnelCost', 0
        );
      end if;
    else
      select employee.position into employee_position
      from public.employee_profiles employee
      where employee.id = employee_id;
      payroll := null;
      select saved.* into payroll
      from public.attendance_monthly_payrolls saved
      where saved.employee_profile_id = employee_id
        and saved.salary_month = p_month;
      if payroll.status = 'confirmed' then
        attendance_method := payroll.attendance_method_snapshot;
        abnormal_count := payroll.location_abnormal_count;
        review_summary := payroll.location_review_summary;
        company_cost := payroll.company_personnel_cost;
      else
        attendance_method := private.attendance_month_method(employee_id, p_month);
        review_metrics := private.attendance_location_review_metrics(
          employee_id, p_month
        );
        abnormal_count := (review_metrics->>'count')::integer;
        review_summary := review_metrics->>'summary';
        company_cost := case
          when attendance_method in ('general', 'exempt')
            then coalesce((employee_item->>'netSalary')::numeric, 0)
          else 0
        end;
      end if;
      employee_item := employee_item || jsonb_build_object(
        'position', employee_position,
        'attendanceMethod', attendance_method,
        'locationAbnormalCount', abnormal_count,
        'locationReviewSummary', review_summary
      );
      if can_view_salary then
        employee_item := employee_item || jsonb_build_object(
          'companyPersonnelCost', company_cost,
          'projectAllocatedAmount', case
            when attendance_method in ('general', 'exempt') then 0
            else (employee_item->>'projectAllocatedAmount')::numeric
          end,
          'projectUnallocatedAmount', case
            when attendance_method in ('general', 'exempt') then 0
            else (employee_item->>'projectUnallocatedAmount')::numeric
          end
        );
      end if;
    end if;
    employees_result := employees_result || jsonb_build_array(employee_item);
  end loop;
  result := jsonb_set(result, '{employees}', employees_result);
  return result;
end;
$$;

revoke all on function public.list_monthly_payroll_secure(
  date, text, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.list_monthly_payroll_secure(
  date, text, uuid, boolean
) to authenticated, service_role;

commit;

-- Additive attendance-policy rollout. V1 RPCs intentionally remain in place while
-- clients move to server-authoritative project/general attendance v2 contracts.

begin;

alter table public.employee_profiles
  add column attendance_required boolean not null default true,
  add column attendance_policy_updated_at timestamptz,
  add column attendance_policy_updated_by uuid
    references public.employee_profiles(id) on delete restrict;

alter table public.project_attendance_sessions
  add column attendance_mode text not null default 'project';

alter table public.project_attendance_sessions
  alter column project_id drop not null,
  alter column project_name_snapshot drop not null,
  alter column project_address_snapshot drop not null,
  alter column project_latitude_snapshot drop not null,
  alter column project_longitude_snapshot drop not null,
  alter column attendance_radius_meters_snapshot drop not null;

alter table public.project_attendance_sessions
  drop constraint attendance_session_project_name_check,
  drop constraint attendance_session_project_address_check,
  drop constraint attendance_session_latitude_check,
  drop constraint attendance_session_longitude_check,
  drop constraint attendance_session_radius_check,
  add constraint attendance_session_mode_check
    check (attendance_mode in ('project', 'general')),
  add constraint attendance_session_mode_payload_check check (
    (attendance_mode = 'project' and project_id is not null
      and project_name_snapshot is not null
      and project_address_snapshot is not null
      and project_latitude_snapshot is not null
      and project_longitude_snapshot is not null
      and attendance_radius_meters_snapshot is not null)
    or
    (attendance_mode = 'general' and project_id is null
      and project_name_snapshot is null
      and project_address_snapshot is null
      and project_latitude_snapshot is null
      and project_longitude_snapshot is null
      and attendance_radius_meters_snapshot is null)
  ),
  add constraint attendance_session_project_value_check check (
    attendance_mode = 'general'
    or (
      btrim(project_name_snapshot) <> ''
      and btrim(project_address_snapshot) <> ''
      and project_latitude_snapshot between -90 and 90
      and project_longitude_snapshot between -180 and 180
      and attendance_radius_meters_snapshot > 0
    )
  );

alter table public.project_attendance_events
  add column out_of_range_confirmed_at timestamptz,
  alter column distance_meters drop not null,
  alter column radius_meters drop not null;

alter table public.project_attendance_events
  drop constraint attendance_event_distance_check,
  drop constraint attendance_event_radius_check,
  drop constraint attendance_event_result_check,
  drop constraint attendance_event_reason_check,
  add constraint attendance_event_mode_payload_check check (
    (
      result = 'not_applicable'
      and distance_meters is null
      and radius_meters is null
      and abnormal_reason is null
      and out_of_range_confirmed_at is null
    )
    or (
      result = 'normal'
      and distance_meters is not null
      and distance_meters >= 0
      and radius_meters is not null
      and radius_meters > 0
      and abnormal_reason is null
      and out_of_range_confirmed_at is null
    )
    or (
      result = 'abnormal'
      and distance_meters is not null
      and distance_meters >= 0
      and radius_meters is not null
      and radius_meters > 0
      and abnormal_reason is not null
      and abnormal_reason = regexp_replace(
        abnormal_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(abnormal_reason) between 1 and 500
    )
  );

create or replace function private.attendance_policy_mode(
  p_attendance_required boolean,
  p_department text
) returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when not p_attendance_required then 'exempt'
    when p_department = '工程部' then 'project'
    else 'general'
  end;
$$;

create or replace function private.attendance_event_v2_json(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'eventId', event.event_id,
    'requestId', event.request_id,
    'eventType', event.event_type,
    'serverRecordedAt', event.server_recorded_at,
    'deviceRecordedAt', event.device_recorded_at,
    'latitude', event.latitude,
    'longitude', event.longitude,
    'accuracyMeters', event.accuracy_meters,
    'distanceMeters', event.distance_meters,
    'radiusMeters', event.radius_meters,
    'result', event.result,
    'abnormalReason', event.abnormal_reason,
    'outOfRangeConfirmedAt', event.out_of_range_confirmed_at
  )
  from public.project_attendance_events event
  where event.event_id = p_event_id;
$$;

create or replace function private.attendance_session_v2_json(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'sessionId', session.session_id,
    'attendanceMode', session.attendance_mode,
    'employeeProfileId', session.employee_profile_id,
    'employeeNumberSnapshot', session.employee_number_snapshot,
    'employeeNameSnapshot', session.employee_name_snapshot,
    'projectId', session.project_id,
    'projectNameSnapshot', session.project_name_snapshot,
    'projectAddressSnapshot', session.project_address_snapshot,
    'projectLatitudeSnapshot', session.project_latitude_snapshot,
    'projectLongitudeSnapshot', session.project_longitude_snapshot,
    'attendanceRadiusMetersSnapshot', session.attendance_radius_meters_snapshot,
    'workDate', session.work_date,
    'status', session.status,
    'openedAt', session.opened_at,
    'closedAt', session.closed_at,
    'clockInEvent', (
      select private.attendance_event_v2_json(event.event_id)
      from public.project_attendance_events event
      where event.session_id = session.session_id
        and event.event_type = 'clock_in'
      order by event.event_type, event.event_id
      limit 1
    ),
    'clockOutEvent', (
      select private.attendance_event_v2_json(event.event_id)
      from public.project_attendance_events event
      where event.session_id = session.session_id
        and event.event_type = 'clock_out'
      order by event.event_type, event.event_id
      limit 1
    ),
    'workPoints', case
      when session.attendance_mode = 'general' then '[]'::jsonb
      else coalesce((
        select jsonb_agg(
          private.attendance_work_point_json(point.work_point_id)
          order by point.ordinal
        )
        from public.project_attendance_work_points point
        where point.session_id = session.session_id
      ), '[]'::jsonb)
    end
  )
  from public.project_attendance_sessions session
  where session.session_id = p_session_id;
$$;

create or replace function private.enforce_attendance_event_session_mode()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  session_mode text;
begin
  select session.attendance_mode
    into session_mode
    from public.project_attendance_sessions session
    where session.session_id = new.session_id;

  if found and (
    (session_mode = 'general' and new.result <> 'not_applicable')
    or (session_mode = 'project' and new.result = 'not_applicable')
  ) then
    raise exception using
      errcode = '23514',
      message = 'attendance event does not match session mode';
  end if;

  return new;
end;
$$;

create trigger enforce_attendance_event_session_mode
before insert on public.project_attendance_events
for each row execute function private.enforce_attendance_event_session_mode();

create or replace function private.enforce_project_attendance_work_point()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  session_mode text;
begin
  select session.attendance_mode
    into session_mode
    from public.project_attendance_sessions session
    where session.session_id = new.session_id;

  if session_mode = 'general' then
    raise exception using
      errcode = '55000',
      message = 'project attendance session required',
      hint = 'ATTENDANCE_PROJECT_SESSION_REQUIRED';
  end if;

  return new;
end;
$$;

create trigger enforce_project_attendance_work_point
before insert or update on public.project_attendance_work_points
for each row execute function private.enforce_project_attendance_work_point();

create or replace function private.enforce_project_attendance_photo()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  session_mode text;
begin
  select session.attendance_mode
    into session_mode
    from public.project_attendance_work_points point
    join public.project_attendance_sessions session
      on session.session_id = point.session_id
    where point.work_point_id = new.work_point_id;

  if session_mode = 'general' then
    raise exception using
      errcode = '55000',
      message = 'project attendance session required',
      hint = 'ATTENDANCE_PROJECT_SESSION_REQUIRED';
  end if;

  return new;
end;
$$;

create trigger enforce_project_attendance_photo
before insert or update on public.project_attendance_photos
for each row execute function private.enforce_project_attendance_photo();

create or replace function public.list_attendance_projects_v2_secure()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_employee();

  if private.attendance_policy_mode(
    actor.attendance_required, actor.department
  ) <> 'project' then
    return;
  end if;

  return query
  select jsonb_build_object(
    'projectId', project.record_key,
    'projectName', project.payload->>'projectName',
    'status', project.payload->>'status',
    'address', project.payload->>'address',
    'latitude', (project.payload->>'latitude')::double precision,
    'longitude', (project.payload->>'longitude')::double precision,
    'attendanceRadiusMeters', (project.payload->>'attendanceRadiusMeters')::numeric,
    'locationConfirmedAt', project.payload->>'locationConfirmedAt',
    'locationAddressSnapshot', project.payload->>'locationAddressSnapshot'
  )
  from public.projects project
  where private.is_attendance_project_eligible(project.status, project.payload)
  order by project.payload->>'projectName', project.record_key;
end;
$$;

create or replace function public.get_my_today_attendance_v2_secure()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  server_recorded_at timestamptz;
  server_work_date date;
  viewer_scope text;
  policy_mode text;
begin
  actor := private.current_attendance_employee();
  server_recorded_at := statement_timestamp();
  server_work_date := timezone('Asia/Tokyo', server_recorded_at)::date;
  viewer_scope := private.current_attendance_viewer_scope(actor.id);
  policy_mode := private.attendance_policy_mode(
    actor.attendance_required, actor.department
  );

  return jsonb_build_object(
    'workDate', server_work_date,
    'policy', jsonb_build_object(
      'attendanceRequired', actor.attendance_required,
      'attendanceMode', policy_mode
    ),
    'viewerAccess', jsonb_build_object(
      'scope', viewer_scope,
      'canViewScopedRecords', viewer_scope in ('assigned_projects', 'all')
    ),
    'activeSession', (
      select private.attendance_session_v2_json(session.session_id)
      from public.project_attendance_sessions session
      where session.employee_profile_id = actor.id
        and session.status = 'open'
      order by session.opened_at desc, session.session_id
      limit 1
    ),
    'completedSessions', coalesce((
      select jsonb_agg(
        private.attendance_session_v2_json(session.session_id)
        order by session.opened_at desc, session.session_id
      )
      from public.project_attendance_sessions session
      where session.employee_profile_id = actor.id
        and session.status = 'closed'
        and session.work_date = server_work_date
    ), '[]'::jsonb),
    'pendingPhotoReservations', coalesce((
      select jsonb_agg(
        private.attendance_photo_json(photo.photo_id)
        order by photo.created_at, photo.photo_id
      )
      from public.project_attendance_sessions session
      join public.project_attendance_work_points work_point
        on work_point.session_id = session.session_id
      join public.project_attendance_photos photo
        on photo.work_point_id = work_point.work_point_id
      where session.employee_profile_id = actor.id
        and session.status = 'open'
        and session.attendance_mode = 'project'
        and photo.upload_status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.clock_in_general_secure(
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  existing_event_id uuid;
  existing_session_id uuid;
  existing_event_type text;
  existing_employee_profile_id uuid;
  existing_attendance_mode text;
  new_session_id uuid;
  new_event_id uuid;
  server_recorded_at timestamptz;
  server_work_date date;
begin
  actor := private.current_attendance_employee();

  if private.attendance_policy_mode(
    actor.attendance_required, actor.department
  ) <> 'general' then
    raise exception using
      errcode = '42501',
      message = 'general attendance policy required';
  end if;

  if p_request_id is null
    or p_latitude is null
    or p_latitude not between -90 and 90
    or p_latitude::text in ('NaN', 'Infinity', '-Infinity')
    or p_longitude is null
    or p_longitude not between -180 and 180
    or p_longitude::text in ('NaN', 'Infinity', '-Infinity')
    or p_accuracy_meters is null
    or p_accuracy_meters <= 0
    or p_accuracy_meters::text in ('NaN', 'Infinity', '-Infinity')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid general attendance clock-in request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select
    event.event_id,
    event.session_id,
    event.event_type,
    session.employee_profile_id,
    session.attendance_mode
  into
    existing_event_id,
    existing_session_id,
    existing_event_type,
    existing_employee_profile_id,
    existing_attendance_mode
  from public.project_attendance_events event
  join public.project_attendance_sessions session
    on session.session_id = event.session_id
  where event.request_id = p_request_id;

  if found then
    if existing_employee_profile_id = actor.id
      and existing_event_type = 'clock_in'
      and existing_attendance_mode = 'general'
    then
      return jsonb_build_object(
        'status', 'saved',
        'session', private.attendance_session_v2_json(existing_session_id),
        'event', private.attendance_event_v2_json(existing_event_id)
      );
    end if;

    raise exception using
      errcode = '22023',
      message = 'attendance request identifier conflict',
      hint = 'ATTENDANCE_REQUEST_CONFLICT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor.id::text, 1));

  if exists (
    select 1
    from public.project_attendance_sessions session
    where session.employee_profile_id = actor.id
      and session.status = 'open'
  ) then
    raise exception using
      errcode = '55000',
      message = 'attendance employee already has an open session',
      hint = 'ATTENDANCE_OPEN_SESSION_EXISTS';
  end if;

  server_recorded_at := statement_timestamp();
  server_work_date := timezone('Asia/Tokyo', server_recorded_at)::date;

  insert into public.project_attendance_sessions(
    employee_profile_id,
    employee_number_snapshot,
    employee_name_snapshot,
    attendance_mode,
    project_id,
    project_name_snapshot,
    project_address_snapshot,
    project_latitude_snapshot,
    project_longitude_snapshot,
    attendance_radius_meters_snapshot,
    work_date,
    status,
    opened_at
  ) values (
    actor.id,
    actor.employee_number,
    actor.name,
    'general',
    null, null, null, null, null, null,
    server_work_date,
    'open',
    server_recorded_at
  )
  returning session_id into new_session_id;

  insert into public.project_attendance_events(
    session_id,
    event_type,
    request_id,
    server_recorded_at,
    device_recorded_at,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters,
    radius_meters,
    result,
    abnormal_reason,
    out_of_range_confirmed_at
  ) values (
    new_session_id,
    'clock_in',
    p_request_id,
    server_recorded_at,
    p_device_recorded_at,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    null,
    null,
    'not_applicable',
    null,
    null
  )
  returning event_id into new_event_id;

  return jsonb_build_object(
    'status', 'saved',
    'session', private.attendance_session_v2_json(new_session_id),
    'event', private.attendance_event_v2_json(new_event_id)
  );
end;
$$;

create or replace function public.clock_in_project_v2_secure(
  p_project_id text,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null,
  p_out_of_range_confirmed boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  project public.projects%rowtype;
  existing_event_id uuid;
  existing_session_id uuid;
  existing_event_type text;
  existing_employee_profile_id uuid;
  existing_project_id text;
  existing_attendance_mode text;
  new_session_id uuid;
  new_event_id uuid;
  server_recorded_at timestamptz;
  server_work_date date;
  project_latitude double precision;
  project_longitude double precision;
  project_radius numeric;
  distance_meters double precision;
  event_result text;
  abnormal_reason text;
  confirmed_at timestamptz;
begin
  actor := private.current_attendance_employee();

  if private.attendance_policy_mode(
    actor.attendance_required, actor.department
  ) <> 'project' then
    raise exception using
      errcode = '42501',
      message = 'project attendance policy required';
  end if;

  if p_project_id is null
    or p_project_id <> btrim(p_project_id)
    or p_project_id = ''
    or p_request_id is null
    or p_latitude is null
    or p_latitude not between -90 and 90
    or p_latitude::text in ('NaN', 'Infinity', '-Infinity')
    or p_longitude is null
    or p_longitude not between -180 and 180
    or p_longitude::text in ('NaN', 'Infinity', '-Infinity')
    or p_accuracy_meters is null
    or p_accuracy_meters <= 0
    or p_accuracy_meters::text in ('NaN', 'Infinity', '-Infinity')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance clock-in request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select
    event.event_id,
    event.session_id,
    event.event_type,
    session.employee_profile_id,
    session.project_id,
    session.attendance_mode
  into
    existing_event_id,
    existing_session_id,
    existing_event_type,
    existing_employee_profile_id,
    existing_project_id,
    existing_attendance_mode
  from public.project_attendance_events event
  join public.project_attendance_sessions session
    on session.session_id = event.session_id
  where event.request_id = p_request_id;

  if found then
    if existing_employee_profile_id = actor.id
      and existing_event_type = 'clock_in'
      and existing_project_id = p_project_id
      and existing_attendance_mode = 'project'
    then
      return jsonb_build_object(
        'status', 'saved',
        'session', private.attendance_session_v2_json(existing_session_id),
        'event', private.attendance_event_v2_json(existing_event_id)
      );
    end if;

    raise exception using
      errcode = '22023',
      message = 'attendance request identifier conflict',
      hint = 'ATTENDANCE_REQUEST_CONFLICT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor.id::text, 1));

  if exists (
    select 1
    from public.project_attendance_sessions session
    where session.employee_profile_id = actor.id
      and session.status = 'open'
  ) then
    raise exception using
      errcode = '55000',
      message = 'attendance employee already has an open session',
      hint = 'ATTENDANCE_OPEN_SESSION_EXISTS';
  end if;

  select candidate.*
    into project
    from public.projects candidate
    where candidate.record_key = p_project_id
    for update;

  if not found
    or not private.is_attendance_project_eligible(project.status, project.payload)
  then
    raise exception using
      errcode = '22023',
      message = 'attendance project is not eligible';
  end if;

  project_latitude := (project.payload->>'latitude')::double precision;
  project_longitude := (project.payload->>'longitude')::double precision;
  project_radius := (project.payload->>'attendanceRadiusMeters')::numeric;
  server_recorded_at := statement_timestamp();
  server_work_date := timezone('Asia/Tokyo', server_recorded_at)::date;
  distance_meters := private.attendance_distance_meters(
    project_latitude, project_longitude, p_latitude, p_longitude
  );

  if distance_meters::numeric + p_accuracy_meters <= project_radius then
    event_result := 'normal';
    abnormal_reason := null;
    confirmed_at := null;
  elsif not coalesce(p_out_of_range_confirmed, false) then
    return jsonb_build_object(
      'status', 'confirmation_required',
      'confirmation', jsonb_build_object(
        'projectId', project.record_key,
        'projectName', project.payload->>'projectName',
        'distanceMeters', distance_meters,
        'radiusMeters', project_radius,
        'accuracyMeters', p_accuracy_meters
      )
    );
  else
    event_result := 'abnormal';
    abnormal_reason := 'outside attendance radius confirmed';
    confirmed_at := server_recorded_at;
  end if;

  insert into public.project_attendance_sessions(
    employee_profile_id,
    employee_number_snapshot,
    employee_name_snapshot,
    attendance_mode,
    project_id,
    project_name_snapshot,
    project_address_snapshot,
    project_latitude_snapshot,
    project_longitude_snapshot,
    attendance_radius_meters_snapshot,
    work_date,
    status,
    opened_at
  ) values (
    actor.id,
    actor.employee_number,
    actor.name,
    'project',
    project.record_key,
    project.payload->>'projectName',
    project.payload->>'address',
    project_latitude,
    project_longitude,
    project_radius,
    server_work_date,
    'open',
    server_recorded_at
  )
  returning session_id into new_session_id;

  insert into public.project_attendance_events(
    session_id,
    event_type,
    request_id,
    server_recorded_at,
    device_recorded_at,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters,
    radius_meters,
    result,
    abnormal_reason,
    out_of_range_confirmed_at
  ) values (
    new_session_id,
    'clock_in',
    p_request_id,
    server_recorded_at,
    p_device_recorded_at,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    distance_meters,
    project_radius,
    event_result,
    abnormal_reason,
    confirmed_at
  )
  returning event_id into new_event_id;

  return jsonb_build_object(
    'status', 'saved',
    'session', private.attendance_session_v2_json(new_session_id),
    'event', private.attendance_event_v2_json(new_event_id)
  );
end;
$$;

create or replace function public.clock_out_attendance_v2_secure(
  p_session_id uuid,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null,
  p_out_of_range_confirmed boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  policy_mode text;
  session_row public.project_attendance_sessions%rowtype;
  existing_event_id uuid;
  existing_session_id uuid;
  existing_event_type text;
  existing_employee_profile_id uuid;
  new_event_id uuid;
  server_recorded_at timestamptz;
  distance_meters double precision;
  event_result text;
  abnormal_reason text;
  confirmed_at timestamptz;
  has_complete_point boolean;
begin
  actor := private.current_attendance_employee();
  policy_mode := private.attendance_policy_mode(
    actor.attendance_required, actor.department
  );

  if policy_mode = 'exempt' then
    raise exception using
      errcode = '42501',
      message = 'attendance-required employee required';
  end if;

  if p_session_id is null
    or p_request_id is null
    or p_latitude is null
    or p_latitude not between -90 and 90
    or p_latitude::text in ('NaN', 'Infinity', '-Infinity')
    or p_longitude is null
    or p_longitude not between -180 and 180
    or p_longitude::text in ('NaN', 'Infinity', '-Infinity')
    or p_accuracy_meters is null
    or p_accuracy_meters <= 0
    or p_accuracy_meters::text in ('NaN', 'Infinity', '-Infinity')
  then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance clock-out request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select
    event.event_id,
    event.session_id,
    event.event_type,
    session.employee_profile_id
  into
    existing_event_id,
    existing_session_id,
    existing_event_type,
    existing_employee_profile_id
  from public.project_attendance_events event
  join public.project_attendance_sessions session
    on session.session_id = event.session_id
  where event.request_id = p_request_id;

  if found then
    if existing_employee_profile_id = actor.id
      and existing_event_type = 'clock_out'
      and existing_session_id = p_session_id
    then
      return jsonb_build_object(
        'status', 'saved',
        'session', private.attendance_session_v2_json(existing_session_id),
        'event', private.attendance_event_v2_json(existing_event_id)
      );
    end if;

    raise exception using
      errcode = '22023',
      message = 'attendance request identifier conflict',
      hint = 'ATTENDANCE_REQUEST_CONFLICT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(actor.id::text, 1));

  select session.*
    into session_row
    from public.project_attendance_sessions session
    where session.session_id = p_session_id
    for update;

  if not found or session_row.employee_profile_id <> actor.id then
    raise exception using
      errcode = '42501',
      message = 'attendance session owner required';
  end if;

  if session_row.attendance_mode <> policy_mode then
    raise exception using
      errcode = '42501',
      message = 'attendance session does not match current policy';
  end if;

  if session_row.status <> 'open' then
    raise exception using
      errcode = '55000',
      message = 'attendance session closed',
      hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;

  server_recorded_at := statement_timestamp();

  if session_row.attendance_mode = 'general' then
    distance_meters := null;
    event_result := 'not_applicable';
    abnormal_reason := null;
    confirmed_at := null;
  else
    select exists (
      select 1
      from public.project_attendance_work_points point
      where point.session_id = session_row.session_id
        and btrim(point.area_name) <> ''
        and btrim(point.work_description) <> ''
        and exists (
          select 1
          from public.project_attendance_photos photo
          where photo.work_point_id = point.work_point_id
            and photo.phase = 'before'
            and photo.upload_status = 'active'
        )
        and exists (
          select 1
          from public.project_attendance_photos photo
          where photo.work_point_id = point.work_point_id
            and photo.phase = 'after'
            and photo.upload_status = 'active'
        )
    ) into has_complete_point;

    if not has_complete_point then
      raise exception using
        errcode = '55000',
        message = 'complete attendance work point required',
        hint = 'ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED';
    end if;

    distance_meters := private.attendance_distance_meters(
      session_row.project_latitude_snapshot,
      session_row.project_longitude_snapshot,
      p_latitude,
      p_longitude
    );

    if distance_meters::numeric + p_accuracy_meters
      <= session_row.attendance_radius_meters_snapshot
    then
      event_result := 'normal';
      abnormal_reason := null;
      confirmed_at := null;
    elsif not coalesce(p_out_of_range_confirmed, false) then
      return jsonb_build_object(
        'status', 'confirmation_required',
        'confirmation', jsonb_build_object(
          'projectId', session_row.project_id,
          'projectName', session_row.project_name_snapshot,
          'distanceMeters', distance_meters,
          'radiusMeters', session_row.attendance_radius_meters_snapshot,
          'accuracyMeters', p_accuracy_meters
        )
      );
    else
      event_result := 'abnormal';
      abnormal_reason := 'outside attendance radius confirmed';
      confirmed_at := server_recorded_at;
    end if;
  end if;

  insert into public.project_attendance_events(
    session_id,
    event_type,
    request_id,
    server_recorded_at,
    device_recorded_at,
    latitude,
    longitude,
    accuracy_meters,
    distance_meters,
    radius_meters,
    result,
    abnormal_reason,
    out_of_range_confirmed_at
  ) values (
    session_row.session_id,
    'clock_out',
    p_request_id,
    server_recorded_at,
    p_device_recorded_at,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    distance_meters,
    case
      when session_row.attendance_mode = 'project'
        then session_row.attendance_radius_meters_snapshot
      else null
    end,
    event_result,
    abnormal_reason,
    confirmed_at
  )
  returning event_id into new_event_id;

  update public.project_attendance_sessions
  set status = 'closed',
      closed_at = server_recorded_at
  where session_id = session_row.session_id;

  return jsonb_build_object(
    'status', 'saved',
    'session', private.attendance_session_v2_json(session_row.session_id),
    'event', private.attendance_event_v2_json(new_event_id)
  );
end;
$$;

create or replace function private.employee_safe_summary(
  p_employee public.employee_profiles
)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'id', p_employee.id,
    'employeeNumber', p_employee.employee_number,
    'name', p_employee.name,
    'department', p_employee.department,
    'position', p_employee.position,
    'employmentStatus', p_employee.employment_status,
    'accountStatus', p_employee.account_status,
    'attendanceRequired', p_employee.attendance_required,
    'mustChangePassword', p_employee.must_change_password
  );
$$;

drop function public.employee_directory();
create function public.employee_directory()
returns table (
  "id" uuid,
  "employeeNumber" text,
  "name" text,
  "department" text,
  "position" text,
  "employmentStatus" text,
  "accountStatus" text,
  "attendanceRequired" boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.is_current_employee_active() then
    return;
  end if;

  return query
  select
    employee.id,
    employee.employee_number,
    employee.name,
    employee.department,
    employee.position,
    employee.employment_status,
    employee.account_status,
    employee.attendance_required
  from public.employee_profiles as employee
  where employee.deleted_at is null
    and employee.is_hidden_system_account = false
    and employee.employee_number <> 'SW-000'
  order by employee.employee_number;
end;
$$;

revoke all on function public.employee_directory()
  from public, anon;
grant execute on function public.employee_directory()
  to authenticated, service_role;

create or replace function public.employee_profile_detail(p_employee_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  employee public.employee_profiles%rowtype;
  current_employee_id uuid;
  result jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using errcode = '42501', message = 'active employee required';
  end if;

  select current_employee.id
    into current_employee_id
    from public.employee_profiles as current_employee
    where current_employee.auth_user_id = auth.uid()
      and current_employee.deleted_at is null;

  if current_employee_id is distinct from p_employee_id
    and not public.has_current_permission('module.employees.view')
  then
    raise exception using errcode = '42501', message = 'employee view permission required';
  end if;

  select profile.*
    into employee
    from public.employee_profiles as profile
    where profile.id = p_employee_id
      and profile.deleted_at is null;

  if not found or employee.is_hidden_system_account then
    return null;
  end if;

  result := jsonb_build_object(
    'id', employee.id,
    'employeeNumber', employee.employee_number,
    'legacyEmployeeId', employee.legacy_employee_id,
    'name', employee.name,
    'department', employee.department,
    'position', employee.position,
    'employmentStatus', employee.employment_status,
    'accountStatus', employee.account_status,
    'attendanceRequired', employee.attendance_required,
    'mustChangePassword', employee.must_change_password,
    'hireDate', employee.hire_date,
    'resignDate', employee.resign_date,
    'level', employee.level,
    'phone', employee.phone,
    'remark', employee.remark,
    'createdAt', employee.created_at,
    'updatedAt', employee.updated_at
  );

  if public.has_current_permission('sensitive.employee_identity_view') then
    result := result || jsonb_build_object(
      'gender', employee.gender,
      'birthDate', employee.birth_date,
      'nationality', employee.nationality,
      'emergencyContactName', employee.emergency_contact_name,
      'emergencyContactPhone', employee.emergency_contact_phone,
      'currentAddress', employee.current_address,
      'visaAgency', employee.visa_agency,
      'visaType', employee.visa_type,
      'visaExpireDate', employee.visa_expire_date,
      'passportNumber', employee.passport_number,
      'residenceCardNumber', employee.residence_card_number
    );
  end if;

  if public.has_current_permission('sensitive.salary_view') then
    result := result || jsonb_build_object(
      'baseSalary', employee.base_salary,
      'dailySalary', employee.daily_salary,
      'hourlyWage', employee.hourly_wage,
      'salaryRemark', employee.salary_remark
    );
  end if;

  return result;
end;
$$;

create or replace function public.update_employee_profile_admin(
  p_employee_id uuid,
  p_patch jsonb,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  profile_row public.employee_profiles%rowtype;
  actor_profile public.employee_profiles%rowtype;
  unknown_key text;
  changed_fields jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_id is null
    or p_actor_auth_user_id is null
    or jsonb_typeof(p_patch) is distinct from 'object'
    or p_patch = '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'invalid employee patch';
  end if;
  if p_patch ? 'attendanceRequired'
    and jsonb_typeof(p_patch->'attendanceRequired') is distinct from 'boolean'
  then
    raise exception using errcode = '22023', message = 'invalid employee patch';
  end if;

  select key
    into unknown_key
    from jsonb_object_keys(p_patch) as submitted(key)
    where submitted.key <> all (array[
      'name', 'gender', 'birthDate', 'nationality', 'employmentStatus',
      'attendanceRequired', 'hireDate', 'resignDate', 'department', 'position',
      'level', 'phone', 'emergencyContactName', 'emergencyContactPhone',
      'currentAddress', 'visaAgency', 'visaType', 'visaExpireDate',
      'passportNumber', 'residenceCardNumber', 'baseSalary', 'dailySalary',
      'hourlyWage', 'salaryRemark', 'wecomUserId', 'wecomDepartmentId',
      'wecomDepartmentName', 'remark'
    ]::text[])
    limit 1;
  if unknown_key is not null then
    raise exception using errcode = '22023', message = 'unsupported employee patch field';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    p_patch
  );

  select actor.*
    into actor_profile
    from public.employee_profiles as actor
    where actor.auth_user_id = p_actor_auth_user_id
      and actor.deleted_at is null
      and actor.account_status = 'active'
      and actor.employment_status = '在职'
      and actor.must_change_password = false;
  if not found then
    raise exception using errcode = '42501', message = 'personnel administrator required';
  end if;

  select profile.*
    into profile_row
    from public.employee_profiles as profile
    where profile.id = p_employee_id
      and profile.deleted_at is null
      and profile.is_hidden_system_account = false
      and profile.employee_number <> 'SW-000'
    for update;
  if not found then
    raise exception using errcode = '22023', message = 'employee target unavailable';
  end if;

  update public.employee_profiles as profile
    set name = case when p_patch ? 'name' then btrim(p_patch->>'name') else profile.name end,
        gender = case when p_patch ? 'gender' then p_patch->>'gender' else profile.gender end,
        birth_date = case when p_patch ? 'birthDate' then nullif(p_patch->>'birthDate', '')::date else profile.birth_date end,
        nationality = case when p_patch ? 'nationality' then p_patch->>'nationality' else profile.nationality end,
        employment_status = case when p_patch ? 'employmentStatus' then p_patch->>'employmentStatus' else profile.employment_status end,
        attendance_required = case when p_patch ? 'attendanceRequired' then (p_patch->>'attendanceRequired')::boolean else profile.attendance_required end,
        attendance_policy_updated_at = case when p_patch ? 'attendanceRequired' then statement_timestamp() else profile.attendance_policy_updated_at end,
        attendance_policy_updated_by = case when p_patch ? 'attendanceRequired' then actor_profile.id else profile.attendance_policy_updated_by end,
        hire_date = case when p_patch ? 'hireDate' then nullif(p_patch->>'hireDate', '')::date else profile.hire_date end,
        resign_date = case when p_patch ? 'resignDate' then nullif(p_patch->>'resignDate', '')::date else profile.resign_date end,
        department = case when p_patch ? 'department' then p_patch->>'department' else profile.department end,
        position = case when p_patch ? 'position' then p_patch->>'position' else profile.position end,
        level = case when p_patch ? 'level' then p_patch->>'level' else profile.level end,
        phone = case when p_patch ? 'phone' then p_patch->>'phone' else profile.phone end,
        emergency_contact_name = case when p_patch ? 'emergencyContactName' then p_patch->>'emergencyContactName' else profile.emergency_contact_name end,
        emergency_contact_phone = case when p_patch ? 'emergencyContactPhone' then p_patch->>'emergencyContactPhone' else profile.emergency_contact_phone end,
        current_address = case when p_patch ? 'currentAddress' then p_patch->>'currentAddress' else profile.current_address end,
        visa_agency = case when p_patch ? 'visaAgency' then p_patch->>'visaAgency' else profile.visa_agency end,
        visa_type = case when p_patch ? 'visaType' then p_patch->>'visaType' else profile.visa_type end,
        visa_expire_date = case when p_patch ? 'visaExpireDate' then nullif(p_patch->>'visaExpireDate', '')::date else profile.visa_expire_date end,
        passport_number = case when p_patch ? 'passportNumber' then p_patch->>'passportNumber' else profile.passport_number end,
        residence_card_number = case when p_patch ? 'residenceCardNumber' then p_patch->>'residenceCardNumber' else profile.residence_card_number end,
        base_salary = case when p_patch ? 'baseSalary' then nullif(p_patch->>'baseSalary', '')::numeric else profile.base_salary end,
        daily_salary = case when p_patch ? 'dailySalary' then nullif(p_patch->>'dailySalary', '')::numeric else profile.daily_salary end,
        hourly_wage = case when p_patch ? 'hourlyWage' then nullif(p_patch->>'hourlyWage', '')::numeric else profile.hourly_wage end,
        salary_remark = case when p_patch ? 'salaryRemark' then p_patch->>'salaryRemark' else profile.salary_remark end,
        wecom_user_id = case when p_patch ? 'wecomUserId' then p_patch->>'wecomUserId' else profile.wecom_user_id end,
        wecom_department_id = case when p_patch ? 'wecomDepartmentId' then p_patch->>'wecomDepartmentId' else profile.wecom_department_id end,
        wecom_department_name = case when p_patch ? 'wecomDepartmentName' then p_patch->>'wecomDepartmentName' else profile.wecom_department_name end,
        remark = case when p_patch ? 'remark' then p_patch->>'remark' else profile.remark end,
        updated_by_auth_user_id = p_actor_auth_user_id
    where profile.id = p_employee_id
    returning * into profile_row;

  select coalesce(jsonb_agg(field.key order by field.key), '[]'::jsonb)
    into changed_fields
    from jsonb_object_keys(p_patch) as field(key);
  insert into public.employee_security_audit (
    actor_auth_user_id,
    target_employee_profile_id,
    action,
    safe_details
  ) values (
    p_actor_auth_user_id,
    profile_row.id,
    'employee.profile_updated',
    jsonb_build_object('fields', changed_fields)
  );
  return private.employee_safe_summary(profile_row);
end;
$$;

revoke all on function private.attendance_policy_mode(boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_event_v2_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_session_v2_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_attendance_event_session_mode()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_project_attendance_work_point()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_project_attendance_photo()
  from public, anon, authenticated, service_role;

revoke all on function public.list_attendance_projects_v2_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_today_attendance_v2_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.clock_in_general_secure(
  uuid, double precision, double precision, numeric, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.clock_in_project_v2_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.clock_out_attendance_v2_secure(
  uuid, uuid, double precision, double precision, numeric, timestamptz, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.update_employee_profile_admin(uuid, jsonb, uuid)
  from public, anon, authenticated;

grant execute on function public.list_attendance_projects_v2_secure()
  to authenticated, service_role;
grant execute on function public.get_my_today_attendance_v2_secure()
  to authenticated, service_role;
grant execute on function public.clock_in_general_secure(
  uuid, double precision, double precision, numeric, timestamptz
) to authenticated, service_role;
grant execute on function public.clock_in_project_v2_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, boolean
) to authenticated, service_role;
grant execute on function public.clock_out_attendance_v2_secure(
  uuid, uuid, double precision, double precision, numeric, timestamptz, boolean
) to authenticated, service_role;
grant execute on function public.update_employee_profile_admin(uuid, jsonb, uuid)
  to service_role;

commit;

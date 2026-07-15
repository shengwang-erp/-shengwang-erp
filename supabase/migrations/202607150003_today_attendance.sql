-- Normalized, RPC-only attendance foundation. Browser callers provide only device
-- facts; identity, project snapshots, dates, distances, and results are derived here.

begin;

create table public.project_attendance_sessions (
  session_id uuid primary key default gen_random_uuid(),
  employee_profile_id uuid not null references public.employee_profiles(id) on delete restrict,
  employee_number_snapshot text not null,
  employee_name_snapshot text not null,
  project_id text not null references public.projects(record_key) on delete restrict,
  project_name_snapshot text not null,
  project_address_snapshot text not null,
  project_latitude_snapshot double precision not null,
  project_longitude_snapshot double precision not null,
  attendance_radius_meters_snapshot numeric not null,
  work_date date not null,
  status text not null default 'open',
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_session_employee_number_check check (btrim(employee_number_snapshot) <> ''),
  constraint attendance_session_employee_name_check check (btrim(employee_name_snapshot) <> ''),
  constraint attendance_session_project_name_check check (btrim(project_name_snapshot) <> ''),
  constraint attendance_session_project_address_check check (btrim(project_address_snapshot) <> ''),
  constraint attendance_session_latitude_check check (project_latitude_snapshot between -90 and 90),
  constraint attendance_session_longitude_check check (project_longitude_snapshot between -180 and 180),
  constraint attendance_session_radius_check check (attendance_radius_meters_snapshot > 0),
  constraint attendance_session_status_check check (status in ('open', 'closed')),
  constraint attendance_session_closed_check check (
    (status = 'open' and closed_at is null) or
    (status = 'closed' and closed_at is not null and closed_at >= opened_at)
  )
);

create unique index project_attendance_one_open_session_idx
  on public.project_attendance_sessions(employee_profile_id) where status = 'open';
create index project_attendance_employee_day_idx
  on public.project_attendance_sessions(employee_profile_id, work_date, opened_at desc, session_id);
create index project_attendance_project_day_idx
  on public.project_attendance_sessions(project_id, work_date, opened_at desc, session_id);
create index project_attendance_day_cursor_idx
  on public.project_attendance_sessions(work_date, opened_at desc, session_id);

create table public.project_attendance_events (
  event_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.project_attendance_sessions(session_id) on delete restrict,
  event_type text not null,
  request_id uuid not null unique,
  server_recorded_at timestamptz not null,
  device_recorded_at timestamptz,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_meters numeric not null,
  distance_meters numeric not null,
  radius_meters numeric not null,
  result text not null,
  abnormal_reason text,
  created_at timestamptz not null default statement_timestamp(),
  constraint attendance_event_session_type_unique unique(session_id, event_type),
  constraint attendance_event_type_check check (event_type in ('clock_in', 'clock_out')),
  constraint attendance_event_latitude_check check (latitude between -90 and 90),
  constraint attendance_event_longitude_check check (longitude between -180 and 180),
  constraint attendance_event_accuracy_check check (accuracy_meters > 0),
  constraint attendance_event_distance_check check (distance_meters >= 0),
  constraint attendance_event_radius_check check (radius_meters > 0),
  constraint attendance_event_result_check check (result in ('normal', 'abnormal')),
  constraint attendance_event_reason_check check (
    (result = 'normal' and abnormal_reason is null) or
    (result = 'abnormal'
      and abnormal_reason is not null
      and abnormal_reason = regexp_replace(
        abnormal_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'
      )
      and char_length(abnormal_reason) between 1 and 500)
  )
);

create table public.project_attendance_work_points (
  work_point_id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.project_attendance_sessions(session_id) on delete restrict,
  ordinal smallint not null,
  area_name text not null default '',
  work_description text not null default '',
  completion_note text not null default '',
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_work_point_session_ordinal_unique unique(session_id, ordinal),
  constraint attendance_work_point_ordinal_check check (ordinal between 1 and 7),
  constraint attendance_work_point_area_check check (area_name = btrim(area_name) and char_length(area_name) <= 100),
  constraint attendance_work_point_description_check check (work_description = btrim(work_description) and char_length(work_description) <= 1000),
  constraint attendance_work_point_completion_check check (completion_note = btrim(completion_note) and char_length(completion_note) <= 1000)
);

create table public.project_attendance_photos (
  photo_id uuid primary key default gen_random_uuid(),
  work_point_id uuid not null references public.project_attendance_work_points(work_point_id) on delete restrict,
  phase text not null,
  bucket_id text not null,
  object_path text not null unique,
  original_file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  checksum_sha256 text,
  upload_status text not null default 'pending',
  captured_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint attendance_photo_phase_check check (phase in ('before', 'after')),
  constraint attendance_photo_bucket_check check (bucket_id = 'erp-attendance-photos'),
  constraint attendance_photo_path_check check (btrim(object_path) <> ''),
  constraint attendance_photo_name_check check (
    original_file_name = btrim(original_file_name) and char_length(original_file_name) between 1 and 255
    and original_file_name !~ '[[:cntrl:]]'
  ),
  constraint attendance_photo_type_check check (content_type in (
    'image/jpeg','image/png','image/webp','image/heic','image/heif'
  )),
  constraint attendance_photo_size_check check (size_bytes between 1 and 20971520),
  constraint attendance_photo_checksum_check check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint attendance_photo_status_check check (upload_status in ('pending','active','superseded','cleanup_pending'))
);

create unique index project_attendance_photo_active_phase_idx
  on public.project_attendance_photos(work_point_id, phase) where upload_status = 'active';
create unique index project_attendance_photo_pending_phase_idx
  on public.project_attendance_photos(work_point_id, phase) where upload_status = 'pending';
create index project_attendance_photo_cleanup_idx
  on public.project_attendance_photos(upload_status, updated_at)
  where upload_status in ('pending','superseded','cleanup_pending');

create trigger set_project_attendance_sessions_updated_at
before update on public.project_attendance_sessions
for each row execute function public.set_updated_at();
create trigger set_project_attendance_work_points_updated_at
before update on public.project_attendance_work_points
for each row execute function public.set_updated_at();
create trigger set_project_attendance_photos_updated_at
before update on public.project_attendance_photos
for each row execute function public.set_updated_at();

create or replace function private.reject_attendance_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'attendance events are immutable';
end;
$$;

revoke all on function private.reject_attendance_event_mutation()
  from public, anon, authenticated, service_role;

create trigger reject_attendance_event_mutation
before update or delete on public.project_attendance_events
for each row execute function private.reject_attendance_event_mutation();

alter table public.project_attendance_sessions enable row level security;
alter table public.project_attendance_events enable row level security;
alter table public.project_attendance_work_points enable row level security;
alter table public.project_attendance_photos enable row level security;

revoke all on table public.project_attendance_sessions from public, anon, authenticated;
revoke all on table public.project_attendance_events from public, anon, authenticated;
revoke all on table public.project_attendance_work_points from public, anon, authenticated;
revoke all on table public.project_attendance_photos from public, anon, authenticated;
grant all on table public.project_attendance_sessions to service_role;
grant all on table public.project_attendance_events to service_role;
grant all on table public.project_attendance_work_points to service_role;
grant all on table public.project_attendance_photos to service_role;

create or replace function private.current_attendance_employee()
returns public.employee_profiles
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  select employee.*
    into actor
    from public.employee_profiles employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'active attendance employee required';
  end if;

  return actor;
end;
$$;

create or replace function private.is_attendance_project_eligible(
  p_record_status text,
  p_payload jsonb
) returns boolean
language plpgsql
stable
set search_path = pg_catalog
as $$
declare
  project_latitude double precision;
  project_longitude double precision;
  project_radius numeric;
  normalized_project_name text;
  normalized_confirmation text;
  normalized_address text;
  normalized_snapshot text;
begin
  if p_record_status is distinct from 'active'
    or jsonb_typeof(p_payload) is distinct from 'object'
    or jsonb_typeof(p_payload->'projectName') is distinct from 'string'
    or jsonb_typeof(p_payload->'status') is distinct from 'string'
    or p_payload->>'status' not in ('待开工', '进行中')
    or jsonb_typeof(p_payload->'address') is distinct from 'string'
    or jsonb_typeof(p_payload->'locationConfirmedAt') is distinct from 'string'
    or jsonb_typeof(p_payload->'locationAddressSnapshot') is distinct from 'string'
    or jsonb_typeof(p_payload->'latitude') is distinct from 'number'
    or jsonb_typeof(p_payload->'longitude') is distinct from 'number'
    or jsonb_typeof(p_payload->'attendanceRadiusMeters') is distinct from 'number'
  then
    return false;
  end if;

  begin
    project_latitude := (p_payload->>'latitude')::double precision;
    project_longitude := (p_payload->>'longitude')::double precision;
    project_radius := (p_payload->>'attendanceRadiusMeters')::numeric;
  exception when others then
    return false;
  end;

  if project_latitude not between -90 and 90
    or project_longitude not between -180 and 180
    or project_latitude::text in ('NaN', 'Infinity', '-Infinity')
    or project_longitude::text in ('NaN', 'Infinity', '-Infinity')
    or project_radius <= 0
    or project_radius::text in ('NaN', 'Infinity', '-Infinity')
  then
    return false;
  end if;

  normalized_project_name := btrim(regexp_replace(
    btrim(normalize(p_payload->>'projectName', NFKC)),
    '[[:space:]]+', ' ', 'g'
  ));
  normalized_confirmation := btrim(regexp_replace(
    btrim(normalize(p_payload->>'locationConfirmedAt', NFKC)),
    '[[:space:]]+', ' ', 'g'
  ));
  normalized_address := regexp_replace(
    btrim(normalize(p_payload->>'address', NFKC)),
    '[[:space:]]+', ' ', 'g'
  );
  normalized_snapshot := regexp_replace(
    btrim(normalize(p_payload->>'locationAddressSnapshot', NFKC)),
    '[[:space:]]+', ' ', 'g'
  );

  return normalized_project_name <> ''
    and normalized_confirmation <> ''
    and btrim(normalized_address) <> ''
    and btrim(normalized_snapshot) <> ''
    and normalized_address = normalized_snapshot;
exception when others then
  return false;
end;
$$;

create or replace function private.attendance_distance_meters(
  p_latitude_a double precision, p_longitude_a double precision,
  p_latitude_b double precision, p_longitude_b double precision
) returns double precision
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select 2 * 6371000 * asin(sqrt(least(1::double precision, greatest(0::double precision,
    power(sin(radians(p_latitude_b - p_latitude_a) / 2), 2) +
    cos(radians(p_latitude_a)) * cos(radians(p_latitude_b)) *
    power(sin(radians(p_longitude_b - p_longitude_a) / 2), 2)
  ))));
$$;

create or replace function private.current_attendance_viewer_scope(
  p_employee_profile_id uuid
) returns text
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  select employee.*
    into actor
    from public.employee_profiles employee
    where employee.id = p_employee_profile_id
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'active attendance employee required';
  end if;

  if actor.position = '社长' or actor.employee_number = 'SW-000' then
    return 'all';
  end if;

  if exists (
    select 1
    from public.projects project
    where project.status <> 'deleted'
      and jsonb_typeof(project.payload) = 'object'
      and project.payload->>'siteAssigneeEmployeeId' = actor.id::text
  ) then
    return 'assigned_projects';
  end if;

  return 'own';
end;
$$;

create or replace function private.attendance_event_json(p_event_id uuid)
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
    'abnormalReason', event.abnormal_reason
  )
  from public.project_attendance_events event
  where event.event_id = p_event_id;
$$;

create or replace function private.attendance_photo_json(p_photo_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'photoId', photo.photo_id,
    'workPointId', photo.work_point_id,
    'phase', photo.phase,
    'bucketId', photo.bucket_id,
    'objectPath', photo.object_path,
    'originalFileName', photo.original_file_name,
    'contentType', photo.content_type,
    'sizeBytes', photo.size_bytes,
    'uploadStatus', photo.upload_status,
    'capturedAt', photo.captured_at,
    'createdAt', photo.created_at
  )
  from public.project_attendance_photos photo
  where photo.photo_id = p_photo_id;
$$;

create or replace function private.attendance_work_point_json(p_work_point_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'workPointId', point.work_point_id,
    'sessionId', point.session_id,
    'ordinal', point.ordinal,
    'areaName', point.area_name,
    'workDescription', point.work_description,
    'completionNote', point.completion_note,
    'createdAt', point.created_at,
    'updatedAt', point.updated_at,
    'photos', jsonb_build_object(
      'before', (
        select private.attendance_photo_json(photo.photo_id)
        from public.project_attendance_photos photo
        where photo.work_point_id = point.work_point_id
          and photo.phase = 'before'
          and photo.upload_status = 'active'
        order by photo.photo_id
        limit 1
      ),
      'after', (
        select private.attendance_photo_json(photo.photo_id)
        from public.project_attendance_photos photo
        where photo.work_point_id = point.work_point_id
          and photo.phase = 'after'
          and photo.upload_status = 'active'
        order by photo.photo_id
        limit 1
      )
    )
  )
  from public.project_attendance_work_points point
  where point.work_point_id = p_work_point_id;
$$;

create or replace function private.attendance_session_json(p_session_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select jsonb_build_object(
    'sessionId', session.session_id,
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
      select private.attendance_event_json(event.event_id)
      from public.project_attendance_events event
      where event.session_id = session.session_id
        and event.event_type = 'clock_in'
      order by event.event_type, event.event_id
      limit 1
    ),
    'clockOutEvent', (
      select private.attendance_event_json(event.event_id)
      from public.project_attendance_events event
      where event.session_id = session.session_id
        and event.event_type = 'clock_out'
      order by event.event_type, event.event_id
      limit 1
    ),
    'workPoints', coalesce((
      select jsonb_agg(
        private.attendance_work_point_json(point.work_point_id)
        order by point.ordinal
      )
      from public.project_attendance_work_points point
      where point.session_id = session.session_id
    ), '[]'::jsonb)
  )
  from public.project_attendance_sessions session
  where session.session_id = p_session_id;
$$;

create or replace function public.list_attendance_projects_secure()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  perform private.current_attendance_employee();

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

create or replace function public.get_my_today_attendance_secure()
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
begin
  actor := private.current_attendance_employee();
  server_recorded_at := statement_timestamp();
  server_work_date := timezone('Asia/Tokyo', server_recorded_at)::date;
  viewer_scope := private.current_attendance_viewer_scope(actor.id);

  return jsonb_build_object(
    'workDate', server_work_date,
    'viewerAccess', jsonb_build_object(
      'scope', viewer_scope,
      'canViewScopedRecords', viewer_scope in ('assigned_projects', 'all')
    ),
    'activeSession', (
      select private.attendance_session_json(session.session_id)
      from public.project_attendance_sessions session
      where session.employee_profile_id = actor.id
        and session.status = 'open'
      order by session.opened_at desc, session.session_id
      limit 1
    ),
    'completedSessions', coalesce((
      select jsonb_agg(
        private.attendance_session_json(session.session_id)
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
        and photo.upload_status = 'pending'
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.clock_in_project_secure(
  p_project_id text,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null,
  p_abnormal_reason text default null
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
  new_session_id uuid;
  new_event_id uuid;
  server_recorded_at timestamptz;
  server_work_date date;
  project_latitude double precision;
  project_longitude double precision;
  project_radius numeric;
  distance_meters double precision;
  event_result text;
  normalized_reason text;
begin
  actor := private.current_attendance_employee();

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

  normalized_reason := nullif(regexp_replace(
    p_abnormal_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  ), '');
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance abnormal reason';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select
    event.event_id,
    event.session_id,
    event.event_type,
    session.employee_profile_id,
    session.project_id
  into
    existing_event_id,
    existing_session_id,
    existing_event_type,
    existing_employee_profile_id,
    existing_project_id
  from public.project_attendance_events event
  join public.project_attendance_sessions session
    on session.session_id = event.session_id
  where event.request_id = p_request_id;

  if found then
    if existing_employee_profile_id = actor.id
      and existing_event_type = 'clock_in'
      and existing_project_id = p_project_id
    then
      return jsonb_build_object(
        'session', private.attendance_session_json(existing_session_id),
        'event', private.attendance_event_json(existing_event_id)
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
    normalized_reason := null;
  else
    if normalized_reason is null then
      raise exception using
        errcode = '22023',
        message = 'attendance abnormal reason required',
        hint = 'ATTENDANCE_ABNORMAL_REASON_REQUIRED';
    end if;
    event_result := 'abnormal';
  end if;

  insert into public.project_attendance_sessions(
    employee_profile_id,
    employee_number_snapshot,
    employee_name_snapshot,
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
    abnormal_reason
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
    normalized_reason
  )
  returning event_id into new_event_id;

  return jsonb_build_object(
    'session', private.attendance_session_json(new_session_id),
    'event', private.attendance_event_json(new_event_id)
  );
end;
$$;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'erp-attendance-photos',
  'erp-attendance-photos',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.upsert_attendance_work_point_secure(
  p_session_id uuid,
  p_ordinal smallint,
  p_area_name text,
  p_work_description text,
  p_completion_note text default ''
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  session_row public.project_attendance_sessions%rowtype;
  point_id uuid;
  area_value text := btrim(coalesce(p_area_name, ''));
  description_value text := btrim(coalesce(p_work_description, ''));
  completion_value text := btrim(coalesce(p_completion_note, ''));
begin
  actor := private.current_attendance_employee();

  if p_ordinal is null
    or p_ordinal not between 1 and 7
    or char_length(area_value) > 100
    or char_length(description_value) > 1000
    or char_length(completion_value) > 1000
  then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance work point';
  end if;

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

  if session_row.status <> 'open' then
    raise exception using
      errcode = '55000',
      message = 'attendance session closed',
      hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;

  insert into public.project_attendance_work_points(
    session_id,
    ordinal,
    area_name,
    work_description,
    completion_note
  ) values (
    p_session_id,
    p_ordinal,
    area_value,
    description_value,
    completion_value
  )
  on conflict (session_id, ordinal) do update set
    area_name = excluded.area_name,
    work_description = excluded.work_description,
    completion_note = excluded.completion_note
  returning work_point_id into point_id;

  return private.attendance_work_point_json(point_id);
end;
$$;

create or replace function public.reserve_attendance_photo_secure(
  p_work_point_id uuid,
  p_phase text,
  p_original_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_checksum_sha256 text default null,
  p_captured_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  parent_session_id uuid;
  session_row public.project_attendance_sessions%rowtype;
  point_row public.project_attendance_work_points%rowtype;
  photo_id_value uuid := gen_random_uuid();
  object_path_value text;
begin
  actor := private.current_attendance_employee();

  if p_work_point_id is null
    or p_phase is null
    or p_phase not in ('before', 'after')
    or p_original_file_name is null
    or p_original_file_name <> btrim(p_original_file_name)
    or char_length(p_original_file_name) not between 1 and 255
    or p_original_file_name ~ '[[:cntrl:]]'
    or p_content_type is null
    or p_content_type not in (
      'image/jpeg','image/png','image/webp','image/heic','image/heif'
    )
    or p_size_bytes is null
    or p_size_bytes not between 1 and 20971520
    or (
      p_checksum_sha256 is not null
      and p_checksum_sha256 !~ '^[0-9a-f]{64}$'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance photo reservation';
  end if;

  select point.session_id
    into parent_session_id
    from public.project_attendance_work_points point
    where point.work_point_id = p_work_point_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance work point owner required';
  end if;

  select session.*
    into session_row
    from public.project_attendance_sessions session
    where session.session_id = parent_session_id
    for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance work point owner required';
  end if;

  select point.*
    into point_row
    from public.project_attendance_work_points point
    where point.work_point_id = p_work_point_id
      and point.session_id = session_row.session_id
    for update;

  if not found or session_row.employee_profile_id <> actor.id then
    raise exception using
      errcode = '42501',
      message = 'attendance work point owner required';
  end if;

  if session_row.status <> 'open' then
    raise exception using
      errcode = '55000',
      message = 'attendance session closed',
      hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;

  if p_phase = 'after' and not exists (
    select 1
    from public.project_attendance_photos photo
    where photo.work_point_id = point_row.work_point_id
      and photo.phase = 'before'
      and photo.upload_status = 'active'
  ) then
    raise exception using
      errcode = '55000',
      message = 'active before photo required',
      hint = 'ATTENDANCE_BEFORE_PHOTO_REQUIRED';
  end if;

  if exists (
    select 1
    from public.project_attendance_photos photo
    where photo.work_point_id = point_row.work_point_id
      and photo.phase = p_phase
      and photo.upload_status = 'pending'
  ) then
    raise exception using
      errcode = '55000',
      message = 'attendance photo reservation already pending',
      hint = 'ATTENDANCE_PHOTO_PENDING';
  end if;

  object_path_value := actor.id::text || '/' || session_row.session_id::text || '/' ||
    point_row.work_point_id::text || '/' || photo_id_value::text || '/' || p_phase;

  insert into public.project_attendance_photos(
    photo_id,
    work_point_id,
    phase,
    bucket_id,
    object_path,
    original_file_name,
    content_type,
    size_bytes,
    checksum_sha256,
    upload_status,
    captured_at
  ) values (
    photo_id_value,
    point_row.work_point_id,
    p_phase,
    'erp-attendance-photos',
    object_path_value,
    p_original_file_name,
    p_content_type,
    p_size_bytes,
    p_checksum_sha256,
    'pending',
    p_captured_at
  );

  return private.attendance_photo_json(photo_id_value);
end;
$$;

create or replace function public.finalize_attendance_photo_secure(p_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, storage
as $$
declare
  actor public.employee_profiles%rowtype;
  parent_work_point_id uuid;
  parent_session_id uuid;
  session_row public.project_attendance_sessions%rowtype;
  point_row public.project_attendance_work_points%rowtype;
  photo_row public.project_attendance_photos%rowtype;
  pending_photo_found boolean;
  storage_metadata jsonb;
  storage_size bigint;
  storage_content_type text;
  old_active_photo_id uuid;
begin
  actor := private.current_attendance_employee();

  if p_photo_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance photo identifier';
  end if;

  select photo.work_point_id, point.session_id
    into parent_work_point_id, parent_session_id
    from public.project_attendance_photos photo
    join public.project_attendance_work_points point
      on point.work_point_id = photo.work_point_id
    where photo.photo_id = p_photo_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  select session.*
    into session_row
    from public.project_attendance_sessions session
    where session.session_id = parent_session_id
    for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  select point.*
    into point_row
    from public.project_attendance_work_points point
    where point.work_point_id = parent_work_point_id
      and point.session_id = session_row.session_id
    for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  select photo.*
    into photo_row
    from public.project_attendance_photos photo
    where photo.photo_id = p_photo_id
      and photo.work_point_id = point_row.work_point_id
      and photo.upload_status = 'pending'
    for update;
  pending_photo_found := found;

  if session_row.employee_profile_id <> actor.id then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  if session_row.status <> 'open' then
    raise exception using
      errcode = '55000',
      message = 'attendance session closed',
      hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;

  if not pending_photo_found then
    raise exception using
      errcode = '55000',
      message = 'attendance photo is not pending',
      hint = 'ATTENDANCE_PHOTO_NOT_PENDING';
  end if;

  select object.metadata
    into storage_metadata
    from storage.objects object
    where object.bucket_id = photo_row.bucket_id
      and object.name = photo_row.object_path;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'attendance photo object is unavailable',
      hint = 'ATTENDANCE_PHOTO_OBJECT_UNAVAILABLE';
  end if;

  begin
    storage_size := (storage_metadata->>'size')::bigint;
  exception when others then
    raise exception using
      errcode = '55000',
      message = 'attendance photo object metadata mismatch',
      hint = 'ATTENDANCE_PHOTO_METADATA_MISMATCH';
  end;
  storage_content_type := coalesce(
    storage_metadata->>'mimetype',
    storage_metadata->>'contentType'
  );

  if storage_size is distinct from photo_row.size_bytes
    or storage_content_type is distinct from photo_row.content_type
  then
    raise exception using
      errcode = '55000',
      message = 'attendance photo object metadata mismatch',
      hint = 'ATTENDANCE_PHOTO_METADATA_MISMATCH';
  end if;

  select photo.photo_id
    into old_active_photo_id
    from public.project_attendance_photos photo
    where photo.work_point_id = photo_row.work_point_id
      and photo.phase = photo_row.phase
      and photo.upload_status = 'active'
      and photo.photo_id <> photo_row.photo_id
    for update;

  if old_active_photo_id is not null then
    update public.project_attendance_photos
    set upload_status = 'superseded'
    where photo_id = old_active_photo_id;
  end if;

  update public.project_attendance_photos
  set upload_status = 'active'
  where photo_id = photo_row.photo_id;

  return private.attendance_photo_json(photo_row.photo_id);
end;
$$;

create or replace function public.abandon_attendance_photo_secure(p_photo_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  parent_work_point_id uuid;
  parent_session_id uuid;
  session_row public.project_attendance_sessions%rowtype;
  point_row public.project_attendance_work_points%rowtype;
  photo_row public.project_attendance_photos%rowtype;
  pending_photo_found boolean;
begin
  actor := private.current_attendance_employee();

  if p_photo_id is null then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance photo identifier';
  end if;

  select photo.work_point_id, point.session_id
    into parent_work_point_id, parent_session_id
    from public.project_attendance_photos photo
    join public.project_attendance_work_points point
      on point.work_point_id = photo.work_point_id
    where photo.photo_id = p_photo_id;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  select session.*
    into session_row
    from public.project_attendance_sessions session
    where session.session_id = parent_session_id
    for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  select point.*
    into point_row
    from public.project_attendance_work_points point
    where point.work_point_id = parent_work_point_id
      and point.session_id = session_row.session_id
    for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  select photo.*
    into photo_row
    from public.project_attendance_photos photo
    where photo.photo_id = p_photo_id
      and photo.work_point_id = point_row.work_point_id
      and photo.upload_status = 'pending'
    for update;
  pending_photo_found := found;

  if session_row.employee_profile_id <> actor.id then
    raise exception using
      errcode = '42501',
      message = 'attendance photo owner required';
  end if;

  if session_row.status <> 'open' then
    raise exception using
      errcode = '55000',
      message = 'attendance session closed',
      hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;

  if not pending_photo_found then
    raise exception using
      errcode = '55000',
      message = 'attendance photo is not pending',
      hint = 'ATTENDANCE_PHOTO_NOT_PENDING';
  end if;

  update public.project_attendance_photos
  set upload_status = 'cleanup_pending'
  where photo_id = photo_row.photo_id;

  return private.attendance_photo_json(photo_row.photo_id);
end;
$$;

create or replace function public.clock_out_project_secure(
  p_session_id uuid,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz default null,
  p_abnormal_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  session_row public.project_attendance_sessions%rowtype;
  existing_event_id uuid;
  existing_session_id uuid;
  existing_event_type text;
  existing_employee_profile_id uuid;
  new_event_id uuid;
  server_recorded_at timestamptz;
  distance_meters double precision;
  event_result text;
  normalized_reason text;
  has_complete_point boolean;
begin
  actor := private.current_attendance_employee();

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

  normalized_reason := nullif(regexp_replace(
    p_abnormal_reason, '^[[:space:]]+|[[:space:]]+$', '', 'g'
  ), '');
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception using
      errcode = '22023',
      message = 'invalid attendance abnormal reason';
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
        'session', private.attendance_session_json(existing_session_id),
        'event', private.attendance_event_json(existing_event_id)
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

  if session_row.status <> 'open' then
    raise exception using
      errcode = '55000',
      message = 'attendance session closed',
      hint = 'ATTENDANCE_SESSION_CLOSED';
  end if;

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
    normalized_reason := null;
  else
    if normalized_reason is null then
      raise exception using
        errcode = '22023',
        message = 'attendance abnormal reason required',
        hint = 'ATTENDANCE_ABNORMAL_REASON_REQUIRED';
    end if;
    event_result := 'abnormal';
  end if;

  server_recorded_at := statement_timestamp();

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
    abnormal_reason
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
    session_row.attendance_radius_meters_snapshot,
    event_result,
    normalized_reason
  )
  returning event_id into new_event_id;

  update public.project_attendance_sessions
  set status = 'closed',
      closed_at = server_recorded_at
  where session_id = session_row.session_id;

  return jsonb_build_object(
    'session', private.attendance_session_json(session_row.session_id),
    'event', private.attendance_event_json(new_event_id)
  );
end;
$$;

create or replace function public.can_current_employee_view_attendance_session(
  p_session_id uuid
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  actor := private.current_attendance_employee();

  return exists (
    select 1
    from public.project_attendance_sessions session
    left join public.projects project
      on project.record_key = session.project_id
    where session.session_id = p_session_id
      and (
        session.employee_profile_id = actor.id
        or actor.position = '社长'
        or actor.employee_number = 'SW-000'
        or (
          project.status <> 'deleted'
          and jsonb_typeof(project.payload) = 'object'
          and project.payload->>'siteAssigneeEmployeeId' = actor.id::text
        )
      )
  );
exception when others then
  return false;
end;
$$;

create or replace function public.can_current_employee_upload_attendance_photo(
  p_bucket_id text,
  p_object_path text
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
begin
  if p_bucket_id is distinct from 'erp-attendance-photos'
    or p_object_path is null
    or p_object_path = ''
  then
    return false;
  end if;

  actor := private.current_attendance_employee();

  return exists (
    select 1
    from public.project_attendance_photos photo
    join public.project_attendance_work_points point
      on point.work_point_id = photo.work_point_id
    join public.project_attendance_sessions session
      on session.session_id = point.session_id
    where photo.bucket_id = p_bucket_id
      and photo.object_path = p_object_path
      and photo.upload_status = 'pending'
      and session.status = 'open'
      and session.employee_profile_id = actor.id
  );
exception when others then
  return false;
end;
$$;

create or replace function public.can_current_employee_view_attendance_photo(
  p_bucket_id text,
  p_object_path text
) returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_bucket_id is distinct from 'erp-attendance-photos'
    or p_object_path is null
    or p_object_path = ''
  then
    return false;
  end if;

  return exists (
    select 1
    from public.project_attendance_photos photo
    join public.project_attendance_work_points point
      on point.work_point_id = photo.work_point_id
    where photo.bucket_id = p_bucket_id
      and photo.object_path = p_object_path
      and photo.upload_status = 'active'
      and public.can_current_employee_view_attendance_session(point.session_id)
  );
exception when others then
  return false;
end;
$$;

drop policy if exists attendance_photos_insert on storage.objects;
drop policy if exists attendance_photos_insert_guard on storage.objects;
drop policy if exists attendance_photos_select on storage.objects;
drop policy if exists attendance_photos_select_guard on storage.objects;
drop policy if exists attendance_photos_update_deny on storage.objects;
drop policy if exists attendance_photos_delete_deny on storage.objects;

create policy attendance_photos_insert on storage.objects
  for insert to authenticated
  with check (public.can_current_employee_upload_attendance_photo(bucket_id, name));
create policy attendance_photos_insert_guard on storage.objects as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'erp-attendance-photos'
    or public.can_current_employee_upload_attendance_photo(bucket_id, name)
  );
create policy attendance_photos_select on storage.objects
  for select to authenticated
  using (public.can_current_employee_view_attendance_photo(bucket_id, name));
create policy attendance_photos_select_guard on storage.objects as restrictive
  for select to authenticated
  using (
    bucket_id <> 'erp-attendance-photos'
    or public.can_current_employee_view_attendance_photo(bucket_id, name)
  );
create policy attendance_photos_update_deny on storage.objects as restrictive
  for update to authenticated
  using (bucket_id <> 'erp-attendance-photos')
  with check (bucket_id <> 'erp-attendance-photos');
create policy attendance_photos_delete_deny on storage.objects as restrictive
  for delete to authenticated
  using (bucket_id <> 'erp-attendance-photos');

revoke all on function private.current_attendance_employee()
  from public, anon, authenticated, service_role;
revoke all on function private.is_attendance_project_eligible(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_distance_meters(double precision, double precision, double precision, double precision)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_event_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_photo_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_work_point_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.attendance_session_json(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.current_attendance_viewer_scope(uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.list_attendance_projects_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_today_attendance_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.clock_in_project_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.upsert_attendance_work_point_secure(
  uuid, smallint, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.reserve_attendance_photo_secure(
  uuid, text, text, text, bigint, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_attendance_photo_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.abandon_attendance_photo_secure(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.clock_out_project_secure(
  uuid, uuid, double precision, double precision, numeric, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.can_current_employee_view_attendance_session(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.can_current_employee_upload_attendance_photo(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.can_current_employee_view_attendance_photo(text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.list_attendance_projects_secure()
  to authenticated, service_role;
grant execute on function public.get_my_today_attendance_secure()
  to authenticated, service_role;
grant execute on function public.clock_in_project_secure(
  text, uuid, double precision, double precision, numeric, timestamptz, text
) to authenticated, service_role;
grant execute on function public.upsert_attendance_work_point_secure(
  uuid, smallint, text, text, text
) to authenticated, service_role;
grant execute on function public.reserve_attendance_photo_secure(
  uuid, text, text, text, bigint, text, timestamptz
) to authenticated, service_role;
grant execute on function public.finalize_attendance_photo_secure(uuid)
  to authenticated, service_role;
grant execute on function public.abandon_attendance_photo_secure(uuid)
  to authenticated, service_role;
grant execute on function public.clock_out_project_secure(
  uuid, uuid, double precision, double precision, numeric, timestamptz, text
) to authenticated, service_role;
grant execute on function public.can_current_employee_view_attendance_session(uuid)
  to authenticated, service_role;
grant execute on function public.can_current_employee_upload_attendance_photo(text, text)
  to authenticated, service_role;
grant execute on function public.can_current_employee_view_attendance_photo(text, text)
  to authenticated, service_role;

commit;

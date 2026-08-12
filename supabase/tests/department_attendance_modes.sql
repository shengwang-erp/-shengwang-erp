begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, storage, extensions;
select no_plan();

select has_column(
  'public', 'employee_profiles', 'attendance_required',
  'employee attendance policy has a required flag'
);
select has_column(
  'public', 'project_attendance_sessions', 'attendance_mode',
  'attendance session stores its server-authoritative mode'
);
select has_function('public', 'list_attendance_projects_v2_secure', array[]::text[]);
select has_function('public', 'get_my_today_attendance_v2_secure', array[]::text[]);
select has_function('public', 'clock_in_general_secure', array[
  'uuid','double precision','double precision','numeric','timestamp with time zone'
]);
select has_function('public', 'clock_in_project_v2_secure', array[
  'text','uuid','double precision','double precision','numeric',
  'timestamp with time zone','boolean'
]);
select has_function('public', 'clock_out_attendance_v2_secure', array[
  'uuid','uuid','double precision','double precision','numeric',
  'timestamp with time zone','boolean'
]);

select ok(
  has_function_privilege(
    'authenticated', 'public.list_attendance_projects_v2_secure()', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.list_attendance_projects_v2_secure()', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.list_attendance_projects_v2_secure()', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated', 'public.get_my_today_attendance_v2_secure()', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.get_my_today_attendance_v2_secure()', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.get_my_today_attendance_v2_secure()', 'EXECUTE'
  ),
  'v2 read RPCs are executable only by authenticated and service_role'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.clock_in_project_v2_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.clock_in_project_v2_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.clock_in_project_v2_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'EXECUTE'
  ),
  'v2 project clock is executable only by authenticated and service_role'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.clock_in_general_secure(uuid,double precision,double precision,numeric,timestamp with time zone)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.clock_in_general_secure(uuid,double precision,double precision,numeric,timestamp with time zone)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.clock_in_general_secure(uuid,double precision,double precision,numeric,timestamp with time zone)',
    'EXECUTE'
  ),
  'general clock is executable only by authenticated and service_role'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.clock_out_attendance_v2_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.clock_out_attendance_v2_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.clock_out_attendance_v2_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,boolean)',
    'EXECUTE'
  ),
  'v2 clock-out is executable only by authenticated and service_role'
);

select ok(
  has_function_privilege('authenticated', 'public.list_attendance_projects_secure()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_my_today_attendance_secure()', 'EXECUTE')
  and has_function_privilege(
    'authenticated',
    'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.clock_out_project_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'EXECUTE'
  ),
  'all v1 attendance RPC signatures remain executable during rollout'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000001','authenticated','authenticated','department-attendance-engineering@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000002','authenticated','authenticated','department-attendance-general@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000003','authenticated','authenticated','department-attendance-exempt@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000004','authenticated','authenticated','department-attendance-admin@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000005','authenticated','authenticated','department-attendance-non-admin@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000006','authenticated','authenticated','department-attendance-policy-target@auth.invalid','',now(),'{}','{}',now(),now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password,
  is_hidden_system_account, attendance_required
) values
  ('82000000-0000-4000-8000-000000000001','SW-8201','81000000-0000-4000-8000-000000000001','工程打卡员工','工程部','小工','在职','active',false,false,true),
  ('82000000-0000-4000-8000-000000000002','SW-8202','81000000-0000-4000-8000-000000000002','公司打卡员工','总务部','总务部长','在职','active',false,false,true),
  ('82000000-0000-4000-8000-000000000003','SW-8203','81000000-0000-4000-8000-000000000003','免打卡员工','工程部','小工','在职','active',false,false,false),
  ('82000000-0000-4000-8000-000000000004','SW-8244','81000000-0000-4000-8000-000000000004','人员管理员','总务部','社长','在职','active',false,false,true),
  ('82000000-0000-4000-8000-000000000005','SW-8205','81000000-0000-4000-8000-000000000005','非管理员','工程部','小工','在职','active',false,false,true),
  ('82000000-0000-4000-8000-000000000006','SW-8206','81000000-0000-4000-8000-000000000006','政策目标','总务部','总务部长','在职','active',false,false,true);

select ok(
  (select employee_number <> 'SW-000'
     and is_hidden_system_account = false
     and position = '社长'
     and account_status = 'active'
     and employment_status = '在职'
     and must_change_password = false
   from public.employee_profiles
   where id = '82000000-0000-4000-8000-000000000004'),
  'attendance policy update is exercised through an ordinary personnel administrator'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select is(
  public.update_employee_profile_admin(
    '82000000-0000-4000-8000-000000000006'::uuid,
    '{"attendanceRequired":false}'::jsonb,
    '81000000-0000-4000-8000-000000000004'::uuid
  )->>'attendanceRequired',
  'false',
  'personnel administrator can disable a target daily-attendance requirement'
);
reset role;

select ok(
  (select attendance_required is false
     and attendance_policy_updated_at is not null
     and attendance_policy_updated_by = '82000000-0000-4000-8000-000000000004'::uuid
   from public.employee_profiles
   where id = '82000000-0000-4000-8000-000000000006'),
  'administrator policy update records the exact target policy and actor profile'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000004', true);
select is(
  (select "attendanceRequired"
   from public.employee_directory()
   where "id" = '82000000-0000-4000-8000-000000000006'::uuid),
  false,
  'employee directory exposes the current attendance policy for personnel cards'
);
select is(
  (public.employee_profile_detail(
    '82000000-0000-4000-8000-000000000006'::uuid
  )->>'attendanceRequired')::boolean,
  false,
  'employee detail exposes the exact attendance policy for the administrator form'
);
reset role;

select ok(
  exists (
    select 1
    from public.employee_security_audit audit
    where audit.actor_auth_user_id = '81000000-0000-4000-8000-000000000004'::uuid
      and audit.target_employee_profile_id = '82000000-0000-4000-8000-000000000006'::uuid
      and audit.action = 'employee.profile_updated'
      and audit.safe_details->'fields' @> '["attendanceRequired"]'::jsonb
  ),
  'attendance policy update audit lists attendanceRequired'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select public.update_employee_profile_admin(
    '82000000-0000-4000-8000-000000000006'::uuid,
    '{"attendanceRequired":true}'::jsonb,
    '81000000-0000-4000-8000-000000000005'::uuid
  ) $$,
  '42501',
  'personnel administrator required',
  'non-administrator cannot change another employee attendance policy'
);
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$ select public.update_employee_profile_admin(
    '82000000-0000-4000-8000-000000000006'::uuid,
    '{"attendanceRequired":"false"}'::jsonb,
    '81000000-0000-4000-8000-000000000004'::uuid
  ) $$,
  '22023',
  'invalid employee patch',
  'administrator RPC rejects string coercion for attendanceRequired'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$ update public.employee_profiles
     set attendance_required = true
     where id = '82000000-0000-4000-8000-000000000006'::uuid $$,
  '42501',
  null,
  'employee cannot update their own attendance policy directly'
);
reset role;

set local role service_role;
insert into public.projects(record_key, payload, status) values (
  'DEPT-ATT-ELIGIBLE',
  jsonb_build_object(
    'projectId', 'DEPT-ATT-ELIGIBLE',
    'projectName', '东京站现场',
    'status', '进行中',
    'address', '東京都 千代田区 1-1',
    'latitude', 35.681236,
    'longitude', 139.767125,
    'attendanceRadiusMeters', 300,
    'locationConfirmedAt', '2026-08-12T00:00:00Z',
    'locationAddressSnapshot', '東京都 千代田区 1-1'
  ),
  'active'
);
reset role;

insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at, closed_at
) values (
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001', 'SW-8201', '工程打卡员工',
  'DEPT-ATT-ELIGIBLE', '东京站现场', '東京都 千代田区 1-1',
  35.681236, 139.767125, 300, current_date - 1, 'closed',
  statement_timestamp() - interval '1 day', statement_timestamp() - interval '23 hours'
);

select is(
  (select attendance_mode from public.project_attendance_sessions
   where session_id = '83000000-0000-4000-8000-000000000001'),
  'project',
  'existing project-only row shape backfills to project mode'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select is(
  public.get_my_today_attendance_v2_secure()#>>'{policy,attendanceMode}',
  'project',
  'engineering actor receives server-authoritative project policy'
);
select is(
  (public.get_my_today_attendance_v2_secure()#>>'{policy,attendanceRequired}')::boolean,
  true,
  'engineering actor receives required policy flag'
);
select results_eq(
  $$ select project->>'projectId' from public.list_attendance_projects_v2_secure() project $$,
  $$ values ('DEPT-ATT-ELIGIBLE'::text) $$,
  'engineering actor can list eligible attendance projects through v2'
);
select throws_ok(
  $$ select public.clock_in_general_secure(
    '84000000-0000-4000-8000-000000000001', 35.681236, 139.767125, 10, null
  ) $$,
  '42501', null, 'engineering actor cannot use general attendance'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select is(
  public.get_my_today_attendance_v2_secure()#>>'{policy,attendanceMode}',
  'general',
  'non-engineering actor receives server-authoritative general policy'
);
select is(
  (select count(*)::integer from public.list_attendance_projects_v2_secure()),
  0,
  'general actor receives no project clock choices'
);
select throws_ok(
  $$ select public.clock_in_project_v2_secure(
    'DEPT-ATT-ELIGIBLE', '84000000-0000-4000-8000-000000000002',
    35.681236, 139.767125, 10, null, false
  ) $$,
  '42501', null, 'non-engineering actor cannot use project attendance'
);

create temporary table department_attendance_results(
  result_name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on department_attendance_results to authenticated;

insert into department_attendance_results values (
  'general_clock_in',
  public.clock_in_general_secure(
    '84000000-0000-4000-8000-000000000003', 35.680000, 139.760000, 12,
    '2026-08-12T01:00:00Z'
  )
);
select is(
  (select payload->>'status' from department_attendance_results where result_name = 'general_clock_in'),
  'saved',
  'general clock-in saves immediately'
);
select ok(
  (select payload->'session'->>'attendanceMode' = 'general'
      and payload->'session'->'projectId' = 'null'::jsonb
      and payload->'session'->'projectNameSnapshot' = 'null'::jsonb
      and payload->'session'->'workPoints' = '[]'::jsonb
      and payload->'event'->>'result' = 'not_applicable'
      and payload->'event'->'distanceMeters' = 'null'::jsonb
      and payload->'event'->'radiusMeters' = 'null'::jsonb
   from department_attendance_results where result_name = 'general_clock_in'),
  'general response has no project cost identity or radius result'
);
reset role;

select is(
  (select count(*)::integer
   from public.project_attendance_events event
   join public.project_attendance_sessions session on session.session_id = event.session_id
   where session.employee_profile_id = '82000000-0000-4000-8000-000000000002'
     and session.attendance_mode = 'general'
     and event.result = 'not_applicable'
     and event.distance_meters is null
     and event.radius_meters is null),
  1,
  'general event stores not_applicable with null distance and radius'
);

select throws_ok(
  $$ insert into public.project_attendance_work_points(
    session_id, ordinal, area_name, work_description, completion_note
  ) select
    (payload#>>'{session,sessionId}')::uuid, 1, '不应保存', '不应保存', ''
  from department_attendance_results where result_name = 'general_clock_in' $$,
  '55000', null, 'general session rejects work-point mutation'
);

alter table public.project_attendance_work_points
  disable trigger enforce_project_attendance_work_point;
insert into public.project_attendance_work_points(
  work_point_id, session_id, ordinal, area_name, work_description, completion_note
) select
  '85000000-0000-4000-8000-000000000099',
  (payload#>>'{session,sessionId}')::uuid,
  1, '隔离夹具', '隔离夹具', ''
from department_attendance_results where result_name = 'general_clock_in';
alter table public.project_attendance_work_points
  enable trigger enforce_project_attendance_work_point;

select throws_ok(
  $$ insert into public.project_attendance_photos(
    photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
    content_type, size_bytes, upload_status
  ) values (
    '86000000-0000-4000-8000-000000000099',
    '85000000-0000-4000-8000-000000000099', 'before', 'erp-attendance-photos',
    'general/session/photo/before', 'general.jpg', 'image/jpeg', 1, 'pending'
  ) $$,
  '55000', null, 'general session rejects photo metadata mutation'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
insert into department_attendance_results values (
  'general_clock_out',
  public.clock_out_attendance_v2_secure(
    (select (payload#>>'{session,sessionId}')::uuid
     from department_attendance_results where result_name = 'general_clock_in'),
    '84000000-0000-4000-8000-000000000004', 35.680000, 139.760000, 12,
    '2026-08-12T09:00:00Z', false
  )
);
select ok(
  (select payload->>'status' = 'saved'
      and payload->'event'->>'result' = 'not_applicable'
      and payload->'session'->>'status' = 'closed'
   from department_attendance_results where result_name = 'general_clock_out'),
  'general clock-out closes without project confirmation or work points'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000003', true);
select is(
  public.get_my_today_attendance_v2_secure()#>>'{policy,attendanceMode}',
  'exempt',
  'exempt actor receives server-authoritative exempt policy'
);
select throws_ok(
  $$ select public.clock_in_project_v2_secure(
    'DEPT-ATT-ELIGIBLE', '84000000-0000-4000-8000-000000000005',
    35.681236, 139.767125, 10, null, false
  ) $$,
  '42501', null, 'exempt actor cannot use project attendance'
);
select throws_ok(
  $$ select public.clock_in_general_secure(
    '84000000-0000-4000-8000-000000000006', 35.681236, 139.767125, 10, null
  ) $$,
  '42501', null, 'exempt actor cannot use general attendance'
);

select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into department_attendance_results values (
  'project_confirmation',
  public.clock_in_project_v2_secure(
    'DEPT-ATT-ELIGIBLE', '84000000-0000-4000-8000-000000000007',
    35.685500, 139.767125, 12, '2026-08-12T01:30:00Z', false
  )
);
select ok(
  (select payload->>'status' = 'confirmation_required'
      and (select count(*) from jsonb_object_keys(payload)) = 2
      and (select count(*) from jsonb_object_keys(payload->'confirmation')) = 5
      and payload#>>'{confirmation,projectId}' = 'DEPT-ATT-ELIGIBLE'
      and payload#>>'{confirmation,projectName}' = '东京站现场'
      and (payload#>>'{confirmation,distanceMeters}')::numeric > 300
      and (payload#>>'{confirmation,radiusMeters}')::numeric = 300
      and (payload#>>'{confirmation,accuracyMeters}')::numeric = 12
   from department_attendance_results where result_name = 'project_confirmation'),
  'out-of-range project first call returns the exact confirmation union branch'
);
reset role;

select is(
  (select count(*)::integer from public.project_attendance_sessions
   where employee_profile_id = '82000000-0000-4000-8000-000000000001'
     and status = 'open'),
  0,
  'unconfirmed project clock-in writes no session'
);
select is(
  (select count(*)::integer from public.project_attendance_events
   where request_id = '84000000-0000-4000-8000-000000000007'),
  0,
  'unconfirmed project clock-in writes no event'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into department_attendance_results values
  (
    'project_saved',
    public.clock_in_project_v2_secure(
      'DEPT-ATT-ELIGIBLE', '84000000-0000-4000-8000-000000000007',
      35.685500, 139.767125, 12, '2026-08-12T01:30:00Z', true
    )
  ),
  (
    'project_retry',
    public.clock_in_project_v2_secure(
      'DEPT-ATT-ELIGIBLE', '84000000-0000-4000-8000-000000000007',
      35.685500, 139.767125, 12, '2026-08-12T01:30:00Z', true
    )
  );
select ok(
  (select payload->>'status' = 'saved'
      and (select count(*) from jsonb_object_keys(payload)) = 3
      and payload#>>'{session,attendanceMode}' = 'project'
      and payload#>>'{event,result}' = 'abnormal'
      and payload#>>'{event,outOfRangeConfirmedAt}' is not null
   from department_attendance_results where result_name = 'project_saved'),
  'confirmed project retry writes the exact saved union branch and abnormal evidence'
);
select is(
  (select payload#>>'{event,eventId}' from department_attendance_results where result_name = 'project_saved'),
  (select payload#>>'{event,eventId}' from department_attendance_results where result_name = 'project_retry'),
  'repeated confirmed project retry returns the same event'
);
reset role;

select is(
  (select count(*)::integer from public.project_attendance_events
   where request_id = '84000000-0000-4000-8000-000000000007'
     and result = 'abnormal'
     and out_of_range_confirmed_at is not null),
  1,
  'confirmed project retry writes exactly one abnormal event'
);

insert into public.project_attendance_work_points(
  work_point_id, session_id, ordinal, area_name, work_description, completion_note
) select
  '85000000-0000-4000-8000-000000000001',
  (payload#>>'{session,sessionId}')::uuid,
  1, '施工区域', '施工内容', ''
from department_attendance_results where result_name = 'project_saved';

insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
) values
  ('86000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000001','before','erp-attendance-photos','department/project/before','before.jpg','image/jpeg',1,'active'),
  ('86000000-0000-4000-8000-000000000002','85000000-0000-4000-8000-000000000001','after','erp-attendance-photos','department/project/after','after.jpg','image/jpeg',1,'active');

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into department_attendance_results values (
  'clock_out_confirmation',
  public.clock_out_attendance_v2_secure(
    (select (payload#>>'{session,sessionId}')::uuid
     from department_attendance_results where result_name = 'project_saved'),
    '84000000-0000-4000-8000-000000000008',
    35.685500, 139.767125, 12, '2026-08-12T09:30:00Z', false
  )
);
select is(
  (select payload->>'status' from department_attendance_results where result_name = 'clock_out_confirmation'),
  'confirmation_required',
  'out-of-range clock-out uses the same confirmation flow'
);
reset role;

select is(
  (select count(*)::integer from public.project_attendance_events
   where request_id = '84000000-0000-4000-8000-000000000008'),
  0,
  'unconfirmed clock-out writes no event'
);
select is(
  (select status from public.project_attendance_sessions
   where session_id = (
     select (payload#>>'{session,sessionId}')::uuid
     from department_attendance_results where result_name = 'project_saved'
   )),
  'open',
  'unconfirmed clock-out leaves the session open'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
insert into department_attendance_results values
  (
    'clock_out_saved',
    public.clock_out_attendance_v2_secure(
      (select (payload#>>'{session,sessionId}')::uuid
       from department_attendance_results where result_name = 'project_saved'),
      '84000000-0000-4000-8000-000000000008',
      35.685500, 139.767125, 12, '2026-08-12T09:30:00Z', true
    )
  ),
  (
    'clock_out_retry',
    public.clock_out_attendance_v2_secure(
      (select (payload#>>'{session,sessionId}')::uuid
       from department_attendance_results where result_name = 'project_saved'),
      '84000000-0000-4000-8000-000000000008',
      35.685500, 139.767125, 12, '2026-08-12T09:30:00Z', true
    )
  );
select ok(
  (select payload->>'status' = 'saved'
      and payload#>>'{session,status}' = 'closed'
      and payload#>>'{event,result}' = 'abnormal'
      and payload#>>'{event,outOfRangeConfirmedAt}' is not null
   from department_attendance_results where result_name = 'clock_out_saved'),
  'confirmed clock-out saves one abnormal event and closes the session'
);
select is(
  (select payload#>>'{event,eventId}' from department_attendance_results where result_name = 'clock_out_saved'),
  (select payload#>>'{event,eventId}' from department_attendance_results where result_name = 'clock_out_retry'),
  'repeated confirmed clock-out returns the same event'
);
reset role;

select lives_ok(
  $$ select * from public.list_attendance_projects_secure() $$,
  'v1 project-list RPC remains callable after v2 rollout'
);

select * from finish();
rollback;

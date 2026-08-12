begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

create or replace function pg_temp.wait_for_attendance_race_lock(
  p_application_name text
)
returns boolean
language plpgsql
as $$
begin
  for attempt in 1..500 loop
    if exists (
      select 1 from pg_catalog.pg_stat_activity activity
      where activity.application_name = p_application_name
        and activity.wait_event_type = 'Lock'
    ) then
      return true;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  return false;
end;
$$;

create temporary table attendance_race_results(
  scenario text primary key,
  payload jsonb,
  error_message text
);

select extensions.dblink_connect(
  'race_setup',
  format(
    'dbname=%I user=postgres password=postgres application_name=race_setup',
    current_database()
  )
);
select extensions.dblink_exec('race_setup', $setup$
  insert into auth.users(
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000',
     '91f00000-0000-4000-8000-000000000001', 'authenticated',
     'authenticated', 'race-project@auth.invalid', '', now(), '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     '91f00000-0000-4000-8000-000000000002', 'authenticated',
     'authenticated', 'race-general@auth.invalid', '', now(), '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     '91f00000-0000-4000-8000-000000000003', 'authenticated',
     'authenticated', 'race-clockout@auth.invalid', '', now(), '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     '91f00000-0000-4000-8000-000000000004', 'authenticated',
     'authenticated', 'race-admin@auth.invalid', '', now(), '{}', '{}', now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     '91f00000-0000-4000-8000-000000000005', 'authenticated',
     'authenticated', 'race-non-admin@auth.invalid', '', now(), '{}', '{}', now(), now());

  insert into public.employee_profiles(
    id, employee_number, auth_user_id, name, department, position,
    employment_status, account_status, must_change_password,
    is_hidden_system_account, attendance_required
  ) values
    ('92f00000-0000-4000-8000-000000000001', 'SW-9291',
     '91f00000-0000-4000-8000-000000000001', '并发工程员工', '工程部', '大工',
     '在职', 'active', false, false, true),
    ('92f00000-0000-4000-8000-000000000002', 'SW-9292',
     '91f00000-0000-4000-8000-000000000002', '并发公司员工', '总务部', '总务部长',
     '在职', 'active', false, false, true),
    ('92f00000-0000-4000-8000-000000000003', 'SW-9293',
     '91f00000-0000-4000-8000-000000000003', '并发下班员工', '总务部', '总务部长',
     '在职', 'active', false, false, true),
    ('92f00000-0000-4000-8000-000000000004', 'SW-9294',
     '91f00000-0000-4000-8000-000000000004', '并发人员管理员', '总务部', '社长',
     '在职', 'active', false, false, true),
    ('92f00000-0000-4000-8000-000000000005', 'SW-9295',
     '91f00000-0000-4000-8000-000000000005', '并发非管理员', '工程部', '大工',
     '在职', 'active', false, false, true);

  insert into public.projects(record_key, payload, status) values (
    'RACE-ATT-PROJECT', jsonb_build_object(
      'projectId', 'RACE-ATT-PROJECT', 'projectName', '并发测试现场',
      'status', '进行中', 'address', '東京都 千代田区 1-1',
      'latitude', 35.681236, 'longitude', 139.767125,
      'attendanceRadiusMeters', 300,
      'locationConfirmedAt', '2026-08-13T00:00:00Z',
      'locationAddressSnapshot', '東京都 千代田区 1-1'
    ), 'active'
  );
$setup$);
select extensions.dblink_exec('race_setup', 'set role authenticated');
select * from extensions.dblink(
  'race_setup',
  $$ select set_config(
    'request.jwt.claim.sub',
    '91f00000-0000-4000-8000-000000000003', false
  ) $$
) as configured(value text);
select * from extensions.dblink(
  'race_setup',
  $$ select public.clock_in_general_secure(
    '93f00000-0000-4000-8000-000000000001'::uuid,
    35.681236, 139.767125, 10, null
  ) $$
) as opened(payload jsonb);
select extensions.dblink_exec('race_setup', 'reset role');
select extensions.dblink_disconnect('race_setup');

-- Writer wins: both project and general clock-in must wait, re-read history,
-- and fail closed without writing a stale attendance fact.
select extensions.dblink_connect(
  'race_writer',
  format(
    'dbname=%I user=postgres password=postgres application_name=race_writer',
    current_database()
  )
);
select extensions.dblink_connect(
  'race_clock',
  format(
    'dbname=%I user=postgres password=postgres application_name=race_clock',
    current_database()
  )
);
select extensions.dblink_exec('race_writer', 'set role service_role');
select * from extensions.dblink(
  'race_writer',
  $$ select set_config('request.jwt.claim.role', 'service_role', false) $$
) as configured(value text);
select extensions.dblink_exec('race_writer', 'begin');
select * from extensions.dblink(
  'race_writer',
  $$ select public.update_employee_profile_admin(
    '92f00000-0000-4000-8000-000000000001'::uuid,
    '{"attendanceRequired":false}'::jsonb,
    '91f00000-0000-4000-8000-000000000004'::uuid
  ) $$
) as updated(payload jsonb);
select extensions.dblink_exec('race_clock', 'set role authenticated');
select * from extensions.dblink(
  'race_clock',
  $$ select set_config(
    'request.jwt.claim.sub',
    '91f00000-0000-4000-8000-000000000001', false
  ) $$
) as configured(value text);
select is(
  extensions.dblink_send_query(
    'race_clock',
    $$ select public.clock_in_project_v2_secure(
      'RACE-ATT-PROJECT', '93f00000-0000-4000-8000-000000000002'::uuid,
      35.681236, 139.767125, 10, null, false
    ) $$
  ), 1,
  'project clock-in starts while its policy update is uncommitted'
);
select ok(
  pg_temp.wait_for_attendance_race_lock('race_clock'),
  'project clock-in waits on the employee policy writer'
);
select extensions.dblink_exec('race_writer', 'commit');
do $$
declare remote_error text;
begin
  perform 1 from extensions.dblink_get_result('race_clock', false) response(result jsonb);
  remote_error := extensions.dblink_error_message('race_clock');
  perform 1 from extensions.dblink_get_result('race_clock', false) response(result jsonb);
  insert into attendance_race_results values ('project_clock', null, remote_error);
end;
$$;
select ok(
  (select error_message like '%project attendance policy required%'
   from attendance_race_results where scenario = 'project_clock'),
  'project clock-in re-reads the committed exempt policy and fails closed'
);
select is(
  (select count(*)::integer from public.project_attendance_events
   where request_id = '93f00000-0000-4000-8000-000000000002'::uuid),
  0,
  'failed project clock-in writes no stale event'
);

select extensions.dblink_exec('race_writer', 'begin');
select * from extensions.dblink(
  'race_writer',
  $$ select public.update_employee_profile_admin(
    '92f00000-0000-4000-8000-000000000002'::uuid,
    '{"attendanceRequired":false}'::jsonb,
    '91f00000-0000-4000-8000-000000000004'::uuid
  ) $$
) as updated(payload jsonb);
select * from extensions.dblink(
  'race_clock',
  $$ select set_config(
    'request.jwt.claim.sub',
    '91f00000-0000-4000-8000-000000000002', false
  ) $$
) as configured(value text);
select is(
  extensions.dblink_send_query(
    'race_clock',
    $$ select public.clock_in_general_secure(
      '93f00000-0000-4000-8000-000000000003'::uuid,
      35.681236, 139.767125, 10, null
    ) $$
  ), 1,
  'general clock-in starts while its policy update is uncommitted'
);
select ok(
  pg_temp.wait_for_attendance_race_lock('race_clock'),
  'general clock-in waits on the employee policy writer'
);
select extensions.dblink_exec('race_writer', 'commit');
do $$
declare remote_error text;
begin
  perform 1 from extensions.dblink_get_result('race_clock', false) response(result jsonb);
  remote_error := extensions.dblink_error_message('race_clock');
  perform 1 from extensions.dblink_get_result('race_clock', false) response(result jsonb);
  insert into attendance_race_results values ('general_clock', null, remote_error);
end;
$$;
select ok(
  (select error_message like '%general attendance policy required%'
   from attendance_race_results where scenario = 'general_clock'),
  'general clock-in re-reads the committed exempt policy and fails closed'
);
select is(
  (select count(*)::integer from public.project_attendance_events
   where request_id = '93f00000-0000-4000-8000-000000000003'::uuid),
  0,
  'failed general clock-in writes no stale event'
);
select extensions.dblink_exec('race_clock', 'reset role');
select extensions.dblink_disconnect('race_clock');

-- Clock-out wins: hold its session row after it has acquired the employee
-- advisory lock. The writer must wait, then apply the new policy only after the
-- active session is safely closed.
select extensions.dblink_connect(
  'race_session_blocker',
  format(
    'dbname=%I user=postgres password=postgres application_name=race_session_blocker',
    current_database()
  )
);
select extensions.dblink_connect(
  'race_clockout',
  format(
    'dbname=%I user=postgres password=postgres application_name=race_clockout',
    current_database()
  )
);
select extensions.dblink_exec('race_session_blocker', 'begin');
select * from extensions.dblink(
  'race_session_blocker',
  $$ select session_id from public.project_attendance_sessions
     where employee_profile_id =
       '92f00000-0000-4000-8000-000000000003'::uuid
       and status = 'open'
     for update $$
) as held(session_id uuid);
select extensions.dblink_exec('race_clockout', 'set role authenticated');
select * from extensions.dblink(
  'race_clockout',
  $$ select set_config(
    'request.jwt.claim.sub',
    '91f00000-0000-4000-8000-000000000003', false
  ) $$
) as configured(value text);
select is(
  extensions.dblink_send_query(
    'race_clockout',
    $$ select public.clock_out_attendance_v2_secure(
      (public.get_my_today_attendance_v2_secure()
        #>>'{activeSession,sessionId}')::uuid,
      '93f00000-0000-4000-8000-000000000004'::uuid,
      35.681236, 139.767125, 10, null, false
    ) $$
  ), 1,
  'active general clock-out starts behind a held session row'
);
select pg_catalog.pg_sleep(0.05);
select is(
  extensions.dblink_is_busy('race_clockout'), 1,
  'clock-out remains blocked behind the active session row'
);
select is(
  extensions.dblink_send_query(
    'race_writer',
    $$ select public.update_employee_profile_admin(
      '92f00000-0000-4000-8000-000000000003'::uuid,
      '{"attendanceRequired":false}'::jsonb,
      '91f00000-0000-4000-8000-000000000004'::uuid
    ) $$
  ), 1,
  'policy writer starts while clock-out owns the employee lock'
);
select ok(
  pg_temp.wait_for_attendance_race_lock('race_writer'),
  'policy writer waits behind the active clock-out lock order'
);
select extensions.dblink_exec('race_session_blocker', 'commit');
do $$
declare result_payload jsonb;
begin
  select response.result into result_payload
  from extensions.dblink_get_result('race_clockout', false) response(result jsonb);
  insert into attendance_race_results values (
    'clockout', result_payload,
    extensions.dblink_error_message('race_clockout')
  );
  perform 1 from extensions.dblink_get_result(
    'race_clockout', false
  ) response(result jsonb);
end;
$$;
do $$
declare result_payload jsonb;
begin
  select response.result into result_payload
  from extensions.dblink_get_result('race_writer', false) response(result jsonb);
  insert into attendance_race_results values (
    'writer_after_clockout', result_payload,
    extensions.dblink_error_message('race_writer')
  );
  perform 1 from extensions.dblink_get_result(
    'race_writer', false
  ) response(result jsonb);
end;
$$;
select ok(
  (select payload#>>'{event,result}' = 'not_applicable'
      and payload#>>'{session,status}' = 'closed'
   from attendance_race_results where scenario = 'clockout'),
  'serialized active clock-out closes with its unchanged general policy'
);
select ok(
  (select payload->>'attendanceRequired' = 'false'
      and error_message = 'OK'
   from attendance_race_results where scenario = 'writer_after_clockout'),
  'waiting writer applies the exempt policy after clock-out commits'
);
select is(
  private.attendance_policy_mode_at(
    '92f00000-0000-4000-8000-000000000003'::uuid,
    timezone('Asia/Tokyo', statement_timestamp())::date
  ),
  'exempt',
  'clock-out race leaves the latest effective policy and no stale open session'
);
select extensions.dblink_exec('race_clockout', 'reset role');
select extensions.dblink_disconnect('race_clockout');
select extensions.dblink_disconnect('race_session_blocker');

-- Authorization must fail before waiting on the employee lock.
select extensions.dblink_connect(
  'race_unauthorized',
  format(
    'dbname=%I user=postgres password=postgres application_name=race_unauthorized',
    current_database()
  )
);
select extensions.dblink_exec('race_writer', 'begin');
select * from extensions.dblink(
  'race_writer',
  format(
    'select pg_catalog.pg_try_advisory_xact_lock(%s)',
    pg_catalog.hashtextextended(
      '92f00000-0000-4000-8000-000000000001', 1
    )
  )
) as held(acquired boolean);
select extensions.dblink_exec('race_unauthorized', 'set role service_role');
select * from extensions.dblink(
  'race_unauthorized',
  $$ select set_config('request.jwt.claim.role', 'service_role', false) $$
) as configured(value text);
select is(
  extensions.dblink_send_query(
    'race_unauthorized',
    $$ select public.update_employee_profile_admin(
      '92f00000-0000-4000-8000-000000000001'::uuid,
      '{"attendanceRequired":true}'::jsonb,
      '91f00000-0000-4000-8000-000000000005'::uuid
    ) $$
  ), 1,
  'unauthorized policy update starts while the employee lock is held'
);
do $$
declare remote_error text;
begin
  for attempt in 1..50 loop
    exit when extensions.dblink_is_busy('race_unauthorized') = 0;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('race_unauthorized') <> 0 then
    perform extensions.dblink_cancel_query('race_unauthorized');
    remote_error := 'LOCK_WAIT_TIMEOUT';
  else
    perform 1 from extensions.dblink_get_result(
      'race_unauthorized', false
    ) response(result jsonb);
    remote_error := extensions.dblink_error_message('race_unauthorized');
    perform 1 from extensions.dblink_get_result(
      'race_unauthorized', false
    ) response(result jsonb);
  end if;
  insert into attendance_race_results values (
    'unauthorized', null, remote_error
  );
end;
$$;
select ok(
  (select error_message like '%personnel administrator required%'
   from attendance_race_results where scenario = 'unauthorized'),
  'unauthorized policy writer fails before waiting on employee locks'
);
select extensions.dblink_exec('race_writer', 'rollback');
select extensions.dblink_exec('race_unauthorized', 'reset role', false);
select extensions.dblink_disconnect('race_unauthorized');
select extensions.dblink_exec('race_writer', 'reset role');
select extensions.dblink_disconnect('race_writer');

select * from finish();
rollback;

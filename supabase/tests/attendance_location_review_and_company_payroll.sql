begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

create or replace function pg_temp.wait_for_task5_lock(
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

create temporary table task5_race_results(
  scenario text primary key,
  payload jsonb,
  error_message text
);

select extensions.dblink_connect(
  'task5_setup',
  format(
    'dbname=%I user=postgres password=postgres application_name=task5_setup',
    current_database()
  )
);
select extensions.dblink_exec('task5_setup', $setup$
  set session_replication_role = replica;
  delete from public.employee_attendance_policy_history
  where employee_profile_id in (
    '86f00000-0000-4000-8000-000000000001'::uuid,
    '86f00000-0000-4000-8000-000000000002'::uuid,
    '86f00000-0000-4000-8000-000000000003'::uuid,
    '86f00000-0000-4000-8000-000000000004'::uuid
  );
  set session_replication_role = origin;
  delete from public.attendance_project_allocations
  where resolution_id in (
    select resolution_id from public.attendance_day_resolutions
    where employee_profile_id =
      '86f00000-0000-4000-8000-000000000003'::uuid
  );
  delete from public.attendance_day_resolutions
  where employee_profile_id =
    '86f00000-0000-4000-8000-000000000003'::uuid;
  delete from public.attendance_monthly_payrolls
  where employee_profile_id =
    '86f00000-0000-4000-8000-000000000003'::uuid;
  delete from public.attendance_accounting_settings
  where updated_by_employee_profile_id =
    '86f00000-0000-4000-8000-000000000001'::uuid;
  delete from public.employee_security_audit
  where target_employee_profile_id in (
    '86f00000-0000-4000-8000-000000000001'::uuid,
    '86f00000-0000-4000-8000-000000000002'::uuid,
    '86f00000-0000-4000-8000-000000000003'::uuid,
    '86f00000-0000-4000-8000-000000000004'::uuid
  );
  delete from public.employee_profiles
  where id in (
    '86f00000-0000-4000-8000-000000000001'::uuid,
    '86f00000-0000-4000-8000-000000000002'::uuid,
    '86f00000-0000-4000-8000-000000000003'::uuid,
    '86f00000-0000-4000-8000-000000000004'::uuid
  );
  delete from auth.users
  where id in (
    '85f00000-0000-4000-8000-000000000001'::uuid,
    '85f00000-0000-4000-8000-000000000002'::uuid,
    '85f00000-0000-4000-8000-000000000003'::uuid
  );
  delete from public.permission_grants
  where subject_type = 'position'
    and subject_code in ('主任设计师', '设计师')
    and permission_key in ('module.labor.view', 'module.labor.update')
    and created_at = timestamptz '2099-12-31 00:00:00+00';

  insert into auth.users(
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000',
     '85f00000-0000-4000-8000-000000000001', 'authenticated',
     'authenticated', 'task5-race-accountant@auth.invalid', '', now(),
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     '85f00000-0000-4000-8000-000000000002', 'authenticated',
     'authenticated', 'task5-race-viewer@auth.invalid', '', now(),
     '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000',
     '85f00000-0000-4000-8000-000000000003', 'authenticated',
     'authenticated', 'task5-race-admin@auth.invalid', '', now(),
     '{}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.employee_profiles(
    id, employee_number, auth_user_id, name, department, position,
    employment_status, hire_date, account_status, must_change_password,
    is_hidden_system_account, attendance_required, daily_salary
  ) values
    ('86f00000-0000-4000-8000-000000000001', 'SW-8691',
     '85f00000-0000-4000-8000-000000000001', '并发会计', '财务部',
     '主任设计师', '在职', '2026-01-01', 'active', false, false, true,
     null),
    ('86f00000-0000-4000-8000-000000000002', 'SW-8692',
     '85f00000-0000-4000-8000-000000000002', '只读会计', '财务部',
     '设计师', '在职', '2026-01-01', 'active', false, false, true,
     null),
    ('86f00000-0000-4000-8000-000000000003', 'SW-8693', null,
     '无场次政策员工', '总务部', '大工', '在职', '2026-01-01',
     'active', true, false, true, 10000),
    ('86f00000-0000-4000-8000-000000000004', 'SW-8694',
     '85f00000-0000-4000-8000-000000000003', '并发人员管理员', '总务部',
     '社长', '在职', '2026-01-01', 'active', false, false, true, null);
  insert into public.permission_grants(
    subject_type, subject_code, permission_key,
    created_at, updated_at, created_by_auth_user_id, updated_by_auth_user_id
  ) values
    ('position', '主任设计师', 'module.labor.view',
     '2099-12-31 00:00:00+00', '2099-12-31 00:00:00+00',
     '85f00000-0000-4000-8000-000000000001',
     '85f00000-0000-4000-8000-000000000001'),
    ('position', '主任设计师', 'module.labor.update',
     '2099-12-31 00:00:00+00', '2099-12-31 00:00:00+00',
     '85f00000-0000-4000-8000-000000000001',
     '85f00000-0000-4000-8000-000000000001'),
    ('position', '设计师', 'module.labor.view',
     '2099-12-31 00:00:00+00', '2099-12-31 00:00:00+00',
     '85f00000-0000-4000-8000-000000000002',
     '85f00000-0000-4000-8000-000000000002')
  on conflict do nothing;
  insert into public.attendance_accounting_settings(
    effective_from, work_weekdays, updated_by_employee_profile_id
  ) values (
    '2026-08-01', array[1,2,3,4,5]::smallint[],
    '86f00000-0000-4000-8000-000000000001'
  );
$setup$);
select extensions.dblink_disconnect('task5_setup');

select extensions.dblink_connect(
  'task5_policy_updater',
  format(
    'dbname=%I user=postgres password=postgres application_name=task5_policy_updater',
    current_database()
  )
);
select extensions.dblink_connect(
  'task5_policy_confirmer',
  format(
    'dbname=%I user=postgres password=postgres application_name=task5_policy_confirmer',
    current_database()
  )
);
select extensions.dblink_exec('task5_policy_updater', 'begin');
select extensions.dblink_exec('task5_policy_updater', 'set role service_role');
select * from extensions.dblink(
  'task5_policy_updater',
  $$ select set_config('request.jwt.claim.role', 'service_role', false) $$
) as configured(value text);
select * from extensions.dblink(
  'task5_policy_updater',
  $$ select public.update_employee_profile_admin(
    '86f00000-0000-4000-8000-000000000003'::uuid,
    '{"attendanceRequired":false}'::jsonb,
    '85f00000-0000-4000-8000-000000000003'::uuid
  ) $$
) as updated(payload jsonb);
select extensions.dblink_exec('task5_policy_confirmer', 'set role authenticated');
select * from extensions.dblink(
  'task5_policy_confirmer',
  $$ select set_config(
       'request.jwt.claim.sub',
       '85f00000-0000-4000-8000-000000000001', false
     ) $$
) as configured(value text);
select extensions.dblink_exec('task5_policy_confirmer', 'begin');
select is(
  extensions.dblink_send_query(
    'task5_policy_confirmer',
    $remote$
      select public.confirm_attendance_resolution_secure(
        '86f00000-0000-4000-8000-000000000003'::uuid,
        timezone('Asia/Tokyo', statement_timestamp())::date,
        'full_day', 1, 0, '[]'::jsonb,
        '', null, '', 0
      )
    $remote$
  ),
  1,
  'policy-sensitive confirmation starts in an independent session'
);
select ok(
  pg_temp.wait_for_task5_lock('task5_policy_confirmer'),
  'sessionless confirmation waits for an uncommitted attendance policy update'
);
select extensions.dblink_exec('task5_policy_updater', 'commit');
do $$
declare
  result_payload jsonb;
  remote_error text;
begin
  for attempt in 1..500 loop
    exit when extensions.dblink_is_busy('task5_policy_confirmer') = 0;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task5_policy_confirmer') <> 0 then
    perform extensions.dblink_cancel_query('task5_policy_confirmer');
    raise exception 'Task5 policy confirmer did not finish after policy commit';
  end if;
  select response.result into result_payload
  from extensions.dblink_get_result(
    'task5_policy_confirmer', false
  ) response(result jsonb);
  remote_error := extensions.dblink_error_message('task5_policy_confirmer');
  perform 1
  from extensions.dblink_get_result(
    'task5_policy_confirmer', false
  ) response(result jsonb);
  insert into task5_race_results values (
    'policy_commit', result_payload, remote_error
  );
end;
$$;
select extensions.dblink_exec(
  'task5_policy_confirmer', 'rollback', false
);
select ok(
  (select payload is null
      and error_message like '%exempt attendance does not create daily resolutions%'
   from task5_race_results where scenario = 'policy_commit'),
  'confirmation re-reads committed attendance policy and rejects exempt daily facts'
);
select extensions.dblink_exec('task5_policy_confirmer', 'reset role');
select extensions.dblink_disconnect('task5_policy_confirmer');
select extensions.dblink_exec('task5_policy_updater', 'reset role');
select extensions.dblink_disconnect('task5_policy_updater');

select extensions.dblink_connect(
  'task5_unauthorized_holder',
  format(
    'dbname=%I user=postgres password=postgres application_name=task5_unauthorized_holder',
    current_database()
  )
);
select extensions.dblink_connect(
  'task5_unauthorized_caller',
  format(
    'dbname=%I user=postgres password=postgres application_name=task5_unauthorized_caller',
    current_database()
  )
);
select extensions.dblink_exec('task5_unauthorized_holder', 'begin');
select * from extensions.dblink(
  'task5_unauthorized_holder',
  format(
    'select pg_catalog.pg_try_advisory_xact_lock(%s)',
    pg_catalog.hashtextextended(
      '86f00000-0000-4000-8000-000000000003', 1
    )
  )
) as held(acquired boolean);
select extensions.dblink_exec('task5_unauthorized_caller', 'set role authenticated');
select * from extensions.dblink(
  'task5_unauthorized_caller',
  $$ select set_config(
       'request.jwt.claim.sub',
       '85f00000-0000-4000-8000-000000000002', false
     ) $$
) as configured(value text);
select is(
  extensions.dblink_send_query(
    'task5_unauthorized_caller',
    $remote$
      select public.confirm_attendance_resolution_secure(
        '86f00000-0000-4000-8000-000000000003'::uuid,
        timezone('Asia/Tokyo', statement_timestamp())::date,
        'full_day', 1, 0, '[]'::jsonb,
        '', null, '', 0
      )
    $remote$
  ), 1,
  'view-only confirmation begins while the employee advisory lock is held'
);
do $$
declare
  result_payload jsonb;
  remote_error text;
begin
  for attempt in 1..50 loop
    exit when extensions.dblink_is_busy('task5_unauthorized_caller') = 0;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task5_unauthorized_caller') <> 0 then
    perform extensions.dblink_cancel_query('task5_unauthorized_caller');
  else
    select response.result into result_payload
    from extensions.dblink_get_result(
      'task5_unauthorized_caller', false
    ) response(result jsonb);
    remote_error := extensions.dblink_error_message('task5_unauthorized_caller');
    perform 1 from extensions.dblink_get_result(
      'task5_unauthorized_caller', false
    ) response(result jsonb);
  end if;
  insert into task5_race_results values (
    'unauthorized', result_payload,
    case when extensions.dblink_is_busy('task5_unauthorized_caller') <> 0
      then 'LOCK_WAIT_TIMEOUT' else remote_error end
  );
end;
$$;
select ok(
  (select error_message like '%attendance resolution update permission required%'
   from task5_race_results where scenario = 'unauthorized'),
  'view-only confirmation is rejected before waiting on attendance locks'
);
select extensions.dblink_exec('task5_unauthorized_holder', 'rollback');
select extensions.dblink_exec('task5_unauthorized_caller', 'reset role', false);
select extensions.dblink_disconnect('task5_unauthorized_caller');
select extensions.dblink_disconnect('task5_unauthorized_holder');

select extensions.dblink_connect(
  'task5_cleanup',
  format(
    'dbname=%I user=postgres password=postgres application_name=task5_cleanup',
    current_database()
  )
);
select extensions.dblink_exec('task5_cleanup', $cleanup$
  delete from public.attendance_project_allocations
  where resolution_id in (
    select resolution_id from public.attendance_day_resolutions
    where employee_profile_id =
      '86f00000-0000-4000-8000-000000000003'::uuid
  );
  delete from public.attendance_day_resolutions
  where employee_profile_id =
    '86f00000-0000-4000-8000-000000000003'::uuid;
  delete from public.attendance_monthly_payrolls
  where employee_profile_id =
    '86f00000-0000-4000-8000-000000000003'::uuid;
  delete from public.attendance_accounting_settings
  where updated_by_employee_profile_id =
    '86f00000-0000-4000-8000-000000000001'::uuid;
  update public.employee_profiles
  set deleted_at = statement_timestamp(), account_status = 'disabled'
  where id in (
    '86f00000-0000-4000-8000-000000000001'::uuid,
    '86f00000-0000-4000-8000-000000000002'::uuid,
    '86f00000-0000-4000-8000-000000000003'::uuid,
    '86f00000-0000-4000-8000-000000000004'::uuid
  );
  delete from public.permission_grants
  where subject_type = 'position'
    and subject_code in ('主任设计师', '设计师')
    and permission_key in ('module.labor.view', 'module.labor.update')
    and created_at = timestamptz '2099-12-31 00:00:00+00';
$cleanup$);
select extensions.dblink_disconnect('task5_cleanup');

select col_type_is(
  'public', 'attendance_day_resolutions', 'location_review_status', 'text',
  'daily resolution stores the structured review status'
);
select col_type_is(
  'public', 'attendance_day_resolutions', 'location_review_note', 'text',
  'daily resolution stores the structured review note'
);
select col_type_is(
  'public', 'attendance_day_resolutions',
  'location_reviewed_by_employee_profile_id', 'uuid',
  'daily resolution stores the canonical reviewer profile'
);
select col_type_is(
  'public', 'attendance_day_resolutions', 'location_reviewed_at',
  'timestamp with time zone', 'daily resolution stores the review timestamp'
);
select col_type_is(
  'public', 'attendance_monthly_payrolls', 'attendance_method_snapshot', 'text',
  'monthly payroll snapshots the server attendance method'
);
select col_type_is(
  'public', 'attendance_monthly_payrolls', 'company_personnel_cost', 'numeric',
  'monthly payroll stores company personnel cost'
);
select col_type_is(
  'public', 'attendance_monthly_payrolls', 'location_abnormal_count', 'integer',
  'monthly payroll snapshots location abnormal count'
);
select col_type_is(
  'public', 'attendance_monthly_payrolls', 'location_review_summary', 'text',
  'monthly payroll snapshots location review summary'
);

select has_function('public', 'confirm_attendance_resolution_secure', array[
  'uuid', 'date', 'text', 'numeric', 'numeric', 'jsonb', 'text',
  'text', 'text', 'integer'
]);
select has_function('public', 'save_attendance_resolution_draft_secure', array[
  'uuid', 'date', 'text', 'numeric', 'numeric', 'jsonb', 'text',
  'text', 'text', 'integer'
]);
select ok(
  has_function_privilege(
    'authenticated',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,text,text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,text,text,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,text,text,integer)',
    'EXECUTE'
  ),
  'review confirmation RPC remains closed to anon and executable by trusted roles'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,integer)',
    'EXECUTE'
  ),
  'legacy confirmation RPC keeps its closed trusted-role ACL'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '85000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'task5-accountant@auth.invalid', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.permission_grants(
  subject_type, subject_code, permission_key
) values
  ('position', '会计主管', 'module.labor.view'),
  ('position', '会计主管', 'module.labor.update'),
  ('position', '会计主管', 'sensitive.salary_view'),
  ('position', '会计主管', 'sensitive.salary_update'),
  ('position', '会计主管', 'module.project_costs.view'),
  ('position', '会计主管', 'module.project_costs.update')
on conflict do nothing;

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, hire_date, resign_date, account_status,
  must_change_password, is_hidden_system_account, attendance_required,
  base_salary, daily_salary, hourly_wage
) values
  (
    '86000000-0000-4000-8000-000000000001', 'SW-8601',
    '85000000-0000-4000-8000-000000000001', 'Task5核算员', '财务部',
    '会计主管', '在职', '2026-01-01', null, 'active', false, false, true,
    null, null, null
  ),
  (
    '86000000-0000-4000-8000-000000000002', 'SW-8602', null,
    '历史项目员工', '工程部', '小工', '离职', '2026-08-03', '2026-08-05',
    'active', true, false, true, null, 10000, null
  ),
  (
    '86000000-0000-4000-8000-000000000003', 'SW-8603', null,
    '公司考勤员工', '总务部', '总务部长', '离职', '2026-08-04', '2026-08-04',
    'active', true, false, true, null, 12000, null
  ),
  (
    '86000000-0000-4000-8000-000000000004', 'SW-8604', null,
    '免打卡员工', '后勤部', '会计', '在职', '2026-01-01', null,
    'active', true, false, false, 320000, null, null
  );

insert into public.attendance_accounting_settings(
  effective_from, work_weekdays, updated_by_employee_profile_id
) values (
  '2026-08-01', array[1,2,3,4,5]::smallint[],
  '86000000-0000-4000-8000-000000000001'
);

insert into public.projects(record_key, payload, status) values (
  'P-TASK5',
  '{"projectId":"P-TASK5","projectName":"Task5项目"}'::jsonb,
  'active'
);

insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot,
  employee_name_snapshot, attendance_mode, project_id, project_name_snapshot,
  project_address_snapshot, project_latitude_snapshot,
  project_longitude_snapshot, attendance_radius_meters_snapshot,
  work_date, status, opened_at, closed_at
) values
  (
    '87000000-0000-4000-8000-000000000001',
    '86000000-0000-4000-8000-000000000002', 'SW-8602', '历史项目员工',
    'project', 'P-TASK5', 'Task5项目', '项目地址', 35.0, 139.0, 100,
    '2026-08-03', 'closed', '2026-08-03 08:00+09', '2026-08-03 17:00+09'
  ),
  (
    '87000000-0000-4000-8000-000000000002',
    '86000000-0000-4000-8000-000000000002', 'SW-8602', '历史项目员工',
    'project', 'P-TASK5', 'Task5项目', '项目地址', 35.0, 139.0, 100,
    '2026-08-04', 'closed', '2026-08-04 08:00+09', '2026-08-04 17:00+09'
  ),
  (
    '87000000-0000-4000-8000-000000000003',
    '86000000-0000-4000-8000-000000000002', 'SW-8602', '历史项目员工',
    'project', 'P-TASK5', 'Task5项目', '项目地址', 35.0, 139.0, 100,
    '2026-08-05', 'closed', '2026-08-05 08:00+09', '2026-08-05 17:00+09'
  ),
  (
    '87000000-0000-4000-8000-000000000004',
    '86000000-0000-4000-8000-000000000003', 'SW-8603', '公司考勤员工',
    'general', null, null, null, null, null, null,
    '2026-08-04', 'closed', '2026-08-04 08:00+09', '2026-08-04 17:00+09'
  );

insert into public.project_attendance_events(
  event_id, session_id, event_type, request_id, server_recorded_at,
  latitude, longitude, accuracy_meters, distance_meters, radius_meters,
  result, abnormal_reason, out_of_range_confirmed_at
) values
  (
    '88000000-0000-4000-8000-000000000001',
    '87000000-0000-4000-8000-000000000001', 'clock_in',
    '89000000-0000-4000-8000-000000000001', '2026-08-03 08:00+09',
    35.01, 139.01, 5, 1500, 100, 'abnormal',
    'outside attendance radius confirmed', '2026-08-03 08:00+09'
  ),
  (
    '88000000-0000-4000-8000-000000000002',
    '87000000-0000-4000-8000-000000000002', 'clock_in',
    '89000000-0000-4000-8000-000000000002', '2026-08-04 08:00+09',
    35.01, 139.01, 5, 1500, 100, 'abnormal',
    'outside attendance radius confirmed', '2026-08-04 08:00+09'
  ),
  (
    '88000000-0000-4000-8000-000000000003',
    '87000000-0000-4000-8000-000000000003', 'clock_in',
    '89000000-0000-4000-8000-000000000003', '2026-08-05 08:00+09',
    35.0, 139.0, 5, 0, 100, 'normal', null, null
  ),
  (
    '88000000-0000-4000-8000-000000000004',
    '87000000-0000-4000-8000-000000000004', 'clock_in',
    '89000000-0000-4000-8000-000000000004', '2026-08-04 08:00+09',
    35.5, 139.5, 5, null, null, 'not_applicable', null, null
  );

-- The current department is deliberately changed after project facts exist.
update public.employee_profiles
set department = '总务部'
where id = '86000000-0000-4000-8000-000000000002';

select set_config(
  'request.jwt.claim.sub', '85000000-0000-4000-8000-000000000001', true
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-03'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', null, '', 0
  ) $$,
  '55000', 'location review is required for out-of-range attendance',
  'out-of-range attendance cannot be confirmed without structured review'
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-03'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', 0
  ) $$,
  '55000', 'location review is required for out-of-range attendance',
  'legacy confirmation cannot bypass required structured location review'
);

select ok(
  coalesce(current_setting(
    'app.attendance_location_review_explicit', true
  ), '') = ''
  and coalesce(current_setting(
    'app.attendance_location_review_status', true
  ), '') = ''
  and coalesce(current_setting(
    'app.attendance_location_review_note', true
  ), '') = '',
  'failed review confirmation clears transaction-local review context'
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-03'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', 'confirmed_valid', repeat('x', 2001), 0
  ) $$,
  '22023', 'valid location review note required',
  'location review note is limited to 2000 trimmed characters'
);

select lives_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-03'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', 'confirmed_valid', '现场证明定位有效', 0
  ) $$,
  'historical project facts remain project mode after the current department changes'
);

select lives_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-04'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', 'recorded_abnormal', '保留定位异常记录，不作处分', 0
  ) $$,
  'recorded abnormal review confirms without changing the attendance conclusion'
);

select ok(
  (
    select count(*) = 2
      and min(attendance_units) = 1
      and max(attendance_units) = 1
      and min(final_project_cost) = 10000
      and max(final_project_cost) = 10000
      and count(distinct location_review_status) = 2
    from public.attendance_day_resolutions
    where employee_profile_id = '86000000-0000-4000-8000-000000000002'
      and work_date in ('2026-08-03', '2026-08-04')
  ),
  'both review outcomes preserve identical attendance units and project cost'
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-05'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', 'confirmed_valid', '正常日不应复核', 0
  ) $$,
  '22023', 'location review is not allowed without out-of-range attendance',
  'location-normal days reject review metadata'
);

select lives_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000002'::uuid, '2026-08-05'::date,
    'full_day', 1, 10000,
    '[{"projectId":"P-TASK5","amount":10000,"allocationNote":""}]'::jsonb,
    '', null, '', 0
  ) $$,
  'location-normal project day confirms with empty review fields'
);

select ok(
  (
    select location_review_status is null
      and location_review_note = ''
      and location_reviewed_by_employee_profile_id is null
      and location_reviewed_at is null
    from public.attendance_day_resolutions
    where employee_profile_id = '86000000-0000-4000-8000-000000000002'
      and work_date = '2026-08-05'
  ),
  'normal project day persists no review metadata'
);

select throws_ok(
  $$ update public.attendance_day_resolutions
     set issue_codes_snapshot = array['abnormal_location']::text[]
     where employee_profile_id =
       '86000000-0000-4000-8000-000000000002'::uuid
       and work_date = '2026-08-05'::date $$,
  '55000', 'confirmed attendance resolution snapshot is immutable',
  'direct writes cannot rewrite a confirmed daily fact'
);

select throws_ok(
  $$ update public.attendance_day_resolutions
     set attendance_method_snapshot = 'general'
     where employee_profile_id =
       '86000000-0000-4000-8000-000000000002'::uuid
       and work_date = '2026-08-05'::date $$,
  '55000', 'confirmed attendance resolution snapshot is immutable',
  'confirmed daily attendance method is frozen against later policy changes'
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000003'::uuid, '2026-08-04'::date,
    'full_day', 1, 12000,
    '[{"projectId":"P-TASK5","amount":12000,"allocationNote":""}]'::jsonb,
    '', null, '', 0
  ) $$,
  '22023', 'general attendance cannot create project labor cost',
  'general attendance rejects project cost and allocations from the client'
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000003'::uuid, '2026-08-04'::date,
    'full_day', 1, null, '[]'::jsonb, '', 0
  ) $$,
  '22023', 'general attendance cannot create project labor cost',
  'legacy general confirmation rejects a null project cost explicitly'
);

select throws_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000003'::uuid, '2026-08-04'::date,
    'full_day', 1, null, '[]'::jsonb, '', null, '', 0
  ) $$,
  '22023', 'general attendance cannot create project labor cost',
  'reviewed general confirmation rejects a null project cost explicitly'
);

select lives_ok(
  $$ select public.confirm_attendance_resolution_secure(
    '86000000-0000-4000-8000-000000000003'::uuid, '2026-08-04'::date,
    'full_day', 1, 0, '[]'::jsonb, '', null, '', 0
  ) $$,
  'general attendance confirms only as company personnel attendance'
);

select ok(
  (
    select resolution.final_project_cost = 0
      and resolution.suggested_project_cost = 0
      and not exists (
        select 1 from public.attendance_project_allocations allocation
        where allocation.resolution_id = resolution.resolution_id
      )
    from public.attendance_day_resolutions resolution
    where resolution.employee_profile_id =
      '86000000-0000-4000-8000-000000000003'
      and resolution.work_date = '2026-08-04'
  ),
  'general daily confirmation stores zero project cost and no allocation row'
);

select lives_ok(
  $$ select public.confirm_monthly_payroll_secure(
    '86000000-0000-4000-8000-000000000003'::uuid,
    '2026-08-01'::date, 0, 0, 0, '', 0
  ) $$,
  'general monthly payroll confirms from its confirmed daily attendance'
);

select ok(
  (
    select attendance_method_snapshot = 'general'
      and company_personnel_cost = net_salary
      and company_personnel_cost = 12000
    from public.attendance_monthly_payrolls
    where employee_profile_id = '86000000-0000-4000-8000-000000000003'
      and salary_month = '2026-08-01'
  ),
  'general payroll snapshots its method and full net salary as company cost'
);

select throws_ok(
  $$ update public.attendance_monthly_payrolls
     set company_personnel_cost = 0
     where employee_profile_id =
       '86000000-0000-4000-8000-000000000003'::uuid
       and salary_month = '2026-08-01'::date $$,
  '55000', 'confirmed monthly payroll snapshot is immutable',
  'confirmed monthly policy and cost snapshots cannot be rewritten directly'
);

select lives_ok(
  $$ select public.confirm_monthly_payroll_secure(
    '86000000-0000-4000-8000-000000000004'::uuid,
    '2026-08-01'::date, 0, 0, 0, '', 0
  ) $$,
  'exempt monthly payroll confirms without daily attendance resolution'
);

select ok(
  (
    select attendance_method_snapshot = 'exempt'
      and base_pay = 320000
      and net_salary = 320000
      and company_personnel_cost = 320000
    from public.attendance_monthly_payrolls
    where employee_profile_id = '86000000-0000-4000-8000-000000000004'
      and salary_month = '2026-08-01'
  ),
  'exempt monthly salary uses the configured full monthly amount as company cost'
);

select is(
  (
    select count(*)
    from public.attendance_day_resolutions
    where employee_profile_id = '86000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'exempt payroll creates no synthetic daily resolutions'
);
select is(
  (
    select count(*)
    from public.project_attendance_sessions
    where employee_profile_id = '86000000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'exempt payroll creates no synthetic clock sessions or events'
);

select ok(
  (
    select audit.after_snapshot->>'locationReviewStatus' = 'recorded_abnormal'
      and audit.after_snapshot->>'locationReviewNote' =
        '保留定位异常记录，不作处分'
    from public.attendance_accounting_audit_log audit
    join public.attendance_day_resolutions resolution
      on audit.object_id = resolution.resolution_id::text
    where resolution.employee_profile_id =
      '86000000-0000-4000-8000-000000000002'
      and resolution.work_date = '2026-08-04'
      and audit.action_type = 'resolution_confirmed'
  ),
  'daily immutable audit snapshot contains the structured location review'
);

select ok(
  (
    select audit.after_snapshot->>'attendanceMethodSnapshot' = 'exempt'
      and (audit.after_snapshot->>'companyPersonnelCost')::numeric = 320000
    from public.attendance_accounting_audit_log audit
    join public.attendance_monthly_payrolls payroll
      on audit.object_id = payroll.payroll_id::text
    where payroll.employee_profile_id =
      '86000000-0000-4000-8000-000000000004'
      and audit.action_type = 'payroll_confirmed'
  ),
  'monthly immutable audit snapshot contains attendance method and company cost'
);

select ok(
  (
    with report as (
      select public.list_monthly_payroll_secure(
        '2026-08-01'::date, '',
        '86000000-0000-4000-8000-000000000004'::uuid, false
      ) result
    )
    select result#>>'{employees,0,position}' = '会计'
      and result#>>'{employees,0,attendanceMethod}' = 'exempt'
      and (result#>>'{employees,0,scheduledAttendanceUnits}')::integer = (
        select payroll.scheduled_attendance_units
        from public.attendance_monthly_payrolls payroll
        where payroll.employee_profile_id =
          '86000000-0000-4000-8000-000000000004'
          and payroll.salary_month = '2026-08-01'
      )
      and (result#>>'{employees,0,companyPersonnelCost}')::numeric = 320000
      and (result#>>'{employees,0,projectAllocatedAmount}')::numeric = 0
      and (result#>>'{employees,0,projectUnallocatedAmount}')::numeric = 0
    from report
  ),
  'monthly DTO carries display-only position and snapshot-owned exempt company cost'
);

select ok(
  (
    with report as (
      select public.list_monthly_payroll_secure(
        '2026-08-01'::date, '',
        '86000000-0000-4000-8000-000000000002'::uuid, false
      ) result
    )
    select (result#>>'{employees,0,locationAbnormalCount}')::integer = 2
      and result#>>'{employees,0,locationReviewSummary}' like '%确认有效%'
      and result#>>'{employees,0,locationReviewSummary}' like '%判定异常%'
      and result#>>'{employees,0,locationReviewSummary}' like
        '%保留定位异常记录，不作处分%'
    from report
  ),
  'monthly DTO labels verified locations and carries recorded-abnormal remarks'
);

-- Mid-month policy history must be aggregated by effective work date. These
-- profiles deliberately leave employee_profiles on their original policy so
-- a current-policy implementation cannot accidentally pass this matrix.
insert into public.employee_profiles(
  id, employee_number, name, department, position, employment_status,
  hire_date, resign_date, account_status, must_change_password,
  is_hidden_system_account, attendance_required, base_salary
) values
  (
    '86000000-0000-4000-8000-000000000005', 'SW-8605',
    '月中公司转免打卡', '总务部', '总务部长', '离职', '2026-08-03', '2026-08-14',
    'active', true, false, true, 100003
  ),
  (
    '86000000-0000-4000-8000-000000000006', 'SW-8606',
    '月中项目转免打卡', '工程部', '小工', '离职', '2026-08-03', '2026-08-14',
    'active', true, false, true, 100001
  ),
  (
    '86000000-0000-4000-8000-000000000007', 'SW-8607',
    '月中免打卡转公司', '总务部', '总务部长', '离职', '2026-08-03', '2026-08-14',
    'active', true, false, false, 100005
  );

insert into public.employee_attendance_policy_history(
  employee_profile_id, effective_from, attendance_required,
  department_snapshot, attendance_mode, source,
  changed_by_employee_profile_id
) values
  (
    '86000000-0000-4000-8000-000000000005', '2026-08-10', false,
    '总务部', 'exempt', 'admin_update',
    '86000000-0000-4000-8000-000000000001'
  ),
  (
    '86000000-0000-4000-8000-000000000006', '2026-08-10', false,
    '工程部', 'exempt', 'admin_update',
    '86000000-0000-4000-8000-000000000001'
  ),
  (
    '86000000-0000-4000-8000-000000000007', '2026-08-10', true,
    '总务部', 'general', 'admin_update',
    '86000000-0000-4000-8000-000000000001'
  );

insert into public.attendance_day_resolutions(
  employee_profile_id, work_date, schedule_required, resolution_type,
  attendance_units, accounting_status, salary_type_snapshot,
  base_salary_snapshot, suggested_project_cost, final_project_cost,
  confirmed_by_employee_profile_id, confirmed_at
)
select employee_id, work_date, true,
  case when employee_id = '86000000-0000-4000-8000-000000000006'::uuid
      and work_date = '2026-08-07'::date
    then 'half_day' else 'full_day' end,
  case when employee_id = '86000000-0000-4000-8000-000000000006'::uuid
      and work_date = '2026-08-07'::date
    then 0.5 else 1 end,
  'confirmed', '月薪',
  case employee_id
    when '86000000-0000-4000-8000-000000000005'::uuid then 100003
    when '86000000-0000-4000-8000-000000000006'::uuid then 100001
    else 100005
  end,
  case when employee_id = '86000000-0000-4000-8000-000000000006'::uuid
    then case when work_date = '2026-08-07'::date then 5000 else 10000 end
    else 0 end,
  case when employee_id = '86000000-0000-4000-8000-000000000006'::uuid
    then case when work_date = '2026-08-07'::date then 5000 else 10000 end
  else 0 end,
  '86000000-0000-4000-8000-000000000001',
  statement_timestamp()
from (
  select '86000000-0000-4000-8000-000000000005'::uuid employee_id,
    day_value::date work_date
  from generate_series('2026-08-03'::date, '2026-08-07'::date, '1 day') day_value
  union all
  select '86000000-0000-4000-8000-000000000006'::uuid,
    day_value::date
  from generate_series('2026-08-03'::date, '2026-08-07'::date, '1 day') day_value
  union all
  select '86000000-0000-4000-8000-000000000007'::uuid,
    day_value::date
  from generate_series('2026-08-10'::date, '2026-08-14'::date, '1 day') day_value
) required_days;

insert into public.attendance_project_allocations(
  resolution_id, project_id, project_name_snapshot, amount,
  allocation_note
)
select resolution.resolution_id, 'P-TASK5', 'Task5项目',
  resolution.final_project_cost, ''
from public.attendance_day_resolutions resolution
where resolution.employee_profile_id =
    '86000000-0000-4000-8000-000000000006'::uuid
  and resolution.work_date between '2026-08-03' and '2026-08-07';

select is(
  private.attendance_month_method(
    '86000000-0000-4000-8000-000000000005', '2026-08-01'
  ),
  'mixed',
  'general to exempt within one month is represented as mixed'
);
select is(
  private.attendance_month_method(
    '86000000-0000-4000-8000-000000000006', '2026-08-01'
  ),
  'mixed',
  'project to exempt within one month is represented as mixed'
);
select is(
  private.attendance_month_method(
    '86000000-0000-4000-8000-000000000007', '2026-08-01'
  ),
  'mixed',
  'exempt to required company attendance within one month is mixed'
);

select ok(
  (
    select (counts->>'scheduledAttendanceUnits')::integer = 10
      and (counts->>'fullDays')::numeric = 9
      and (counts->>'halfDays')::numeric = 1
      and (counts->>'confirmedAttendanceUnits')::numeric = 9.5
      and (counts->>'pendingDays')::integer = 0
      and (counts->>'projectFinalCost')::numeric = 45000
      and (counts->>'projectAllocatedAmount')::numeric = 45000
      and (counts->>'projectUnallocatedAmount')::numeric = 0
    from private.attendance_month_counts(
      '86000000-0000-4000-8000-000000000006', '2026-08-01'
    ) counts
  ),
  'mixed project/exempt counts aggregate frozen required days and automatic exempt days'
);

select ok(
  (
    select (counts->>'scheduledAttendanceUnits')::integer = 10
      and (counts->>'fullDays')::numeric = 10
      and (counts->>'pendingDays')::integer = 0
      and (counts->>'projectFinalCost')::numeric = 0
    from private.attendance_month_counts(
      '86000000-0000-4000-8000-000000000005', '2026-08-01'
    ) counts
  ) and (
    select (counts->>'scheduledAttendanceUnits')::integer = 10
      and (counts->>'fullDays')::numeric = 10
      and (counts->>'pendingDays')::integer = 0
      and (counts->>'projectFinalCost')::numeric = 0
    from private.attendance_month_counts(
      '86000000-0000-4000-8000-000000000007', '2026-08-01'
    ) counts
  ),
  'general/exempt transitions remain complete without synthetic exempt-day facts'
);

select lives_ok(
  $$ select public.confirm_monthly_payroll_secure(
    employee_id, '2026-08-01'::date, 0, 0, 0, '', 0
  )
  from unnest(array[
    '86000000-0000-4000-8000-000000000005'::uuid,
    '86000000-0000-4000-8000-000000000006'::uuid,
    '86000000-0000-4000-8000-000000000007'::uuid
  ]) employee_id $$,
  'all complete mixed-policy months can be confirmed'
);

select ok(
  (
    select attendance_method_snapshot = 'mixed'
      and net_salary = 100001
      and company_personnel_cost = 52632
      and company_personnel_cost = round(net_salary * 5::numeric / 9.5)
    from public.attendance_monthly_payrolls
    where employee_profile_id = '86000000-0000-4000-8000-000000000006'
      and salary_month = '2026-08-01'
  ),
  'mixed project/company payroll rounds company cost to exact integer yen by pay units'
);

select ok(
  (
    select count(*) = 5
      and sum(allocation.amount) = 45000
    from public.attendance_project_allocations allocation
    join public.attendance_day_resolutions resolution
      on resolution.resolution_id = allocation.resolution_id
    where resolution.employee_profile_id =
      '86000000-0000-4000-8000-000000000006'
      and resolution.attendance_method_snapshot = 'project'
  ) and not exists (
    select 1 from public.attendance_project_allocations allocation
    join public.attendance_day_resolutions resolution
      on resolution.resolution_id = allocation.resolution_id
    where resolution.employee_profile_id in (
      '86000000-0000-4000-8000-000000000005',
      '86000000-0000-4000-8000-000000000007'
    )
  ),
  'only frozen project days contribute project allocation cost'
);

select ok(
  (
    select bool_and(attendance_method_snapshot = 'mixed')
      and min(company_personnel_cost) = min(net_salary)
      and max(company_personnel_cost) = max(net_salary)
    from public.attendance_monthly_payrolls
    where employee_profile_id in (
      '86000000-0000-4000-8000-000000000005',
      '86000000-0000-4000-8000-000000000007'
    )
      and salary_month = '2026-08-01'
  ),
  'mixed months containing only company/exempt days keep full net salary in company cost'
);

select is(
  (
    select count(*) from public.attendance_day_resolutions
    where employee_profile_id in (
      '86000000-0000-4000-8000-000000000005',
      '86000000-0000-4000-8000-000000000006'
    ) and work_date >= '2026-08-10'
  ),
  0::bigint,
  'exempt scheduled days never create synthetic daily resolutions'
);

insert into public.employee_attendance_policy_history(
  employee_profile_id, effective_from, attendance_required,
  department_snapshot, attendance_mode, source,
  changed_by_employee_profile_id
) values (
  '86000000-0000-4000-8000-000000000006', '2026-08-04', true,
  '总务部', 'general', 'admin_update',
  '86000000-0000-4000-8000-000000000001'
);

select ok(
  private.attendance_fact_mode(
    '86000000-0000-4000-8000-000000000006', '2026-08-04'
  ) = 'project'
  and (
    select attendance_method_snapshot = 'mixed'
      and company_personnel_cost = 52632
    from public.attendance_monthly_payrolls
    where employee_profile_id = '86000000-0000-4000-8000-000000000006'
      and salary_month = '2026-08-01'
  ),
  'month-locked daily and monthly snapshots stay unchanged after back-effective policy history'
);

select * from finish();
rollback;

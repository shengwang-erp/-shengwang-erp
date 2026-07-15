begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, storage, extensions;
select no_plan();

select has_table('public'::name, 'project_attendance_sessions'::name);
select has_table('public'::name, 'project_attendance_events'::name);
select has_table('public'::name, 'project_attendance_work_points'::name);
select has_table('public'::name, 'project_attendance_photos'::name);
select has_function('public', 'list_attendance_projects_secure', array[]::text[]);
select has_function('public', 'get_my_today_attendance_secure', array[]::text[]);
select has_function(
  'public', 'clock_in_project_secure',
  array['text','uuid','double precision','double precision','numeric','timestamp with time zone','text']
);
select has_function(
  'public', 'upsert_attendance_work_point_secure',
  array['uuid','smallint','text','text','text']
);
select has_function(
  'public', 'reserve_attendance_photo_secure',
  array['uuid','text','text','text','bigint','text','timestamp with time zone']
);
select has_function('public', 'finalize_attendance_photo_secure', array['uuid']);
select has_function('public', 'abandon_attendance_photo_secure', array['uuid']);
select has_function(
  'public', 'clock_out_project_secure',
  array['uuid','uuid','double precision','double precision','numeric','timestamp with time zone','text']
);
select has_function('public', 'can_current_employee_view_attendance_session', array['uuid']);
select has_function(
  'public', 'can_current_employee_upload_attendance_photo', array['text','text']
);
select has_function(
  'public', 'can_current_employee_view_attendance_photo', array['text','text']
);

select is(
  (
    with rpc(signature) as (
      values
        (to_regprocedure('public.upsert_attendance_work_point_secure(uuid,smallint,text,text,text)')),
        (to_regprocedure('public.reserve_attendance_photo_secure(uuid,text,text,text,bigint,text,timestamp with time zone)')),
        (to_regprocedure('public.finalize_attendance_photo_secure(uuid)')),
        (to_regprocedure('public.abandon_attendance_photo_secure(uuid)')),
        (to_regprocedure('public.clock_out_project_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,text)'))
    )
    select count(*)::integer
    from rpc
    where signature is null
       or not has_function_privilege('authenticated', signature, 'EXECUTE')
       or not has_function_privilege('service_role', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or exists (
         select 1
         from pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) privilege
         where procedure.oid = signature
           and privilege.privilege_type = 'EXECUTE'
           and (
             privilege.grantee = 0
             or privilege.grantee not in (
               procedure.proowner,
               'authenticated'::regrole::oid,
               'service_role'::regrole::oid
             )
             or (
               privilege.grantee in (
                 'authenticated'::regrole::oid,
                 'service_role'::regrole::oid
               )
               and privilege.is_grantable
             )
           )
       )
  ),
  0,
  'Task 6 RPCs are executable only by authenticated and service_role'
);

select is(
  (
    with predicate(signature) as (
      values
        (to_regprocedure('public.can_current_employee_view_attendance_session(uuid)')),
        (to_regprocedure('public.can_current_employee_upload_attendance_photo(text,text)')),
        (to_regprocedure('public.can_current_employee_view_attendance_photo(text,text)'))
    )
    select count(*)::integer
    from predicate
    left join pg_proc procedure on procedure.oid = predicate.signature
    where signature is null
       or procedure.provolatile <> 's'
       or not procedure.prosecdef
       or procedure.proconfig is null
       or not has_function_privilege('authenticated', signature, 'EXECUTE')
       or not has_function_privilege('service_role', signature, 'EXECUTE')
       or has_function_privilege('anon', signature, 'EXECUTE')
       or exists (
         select 1
         from pg_proc acl_procedure
         cross join lateral aclexplode(coalesce(
           acl_procedure.proacl, acldefault('f', acl_procedure.proowner)
         )) privilege
         where acl_procedure.oid = signature
           and privilege.privilege_type = 'EXECUTE'
           and (
             privilege.grantee = 0
             or privilege.grantee not in (
               acl_procedure.proowner,
               'authenticated'::regrole::oid,
               'service_role'::regrole::oid
             )
             or (
               privilege.grantee in (
                 'authenticated'::regrole::oid,
                 'service_role'::regrole::oid
               )
               and privilege.is_grantable
             )
           )
       )
  ),
  0,
  'Storage predicates are stable security definers with closed EXECUTE grants'
);

select is(
  (
    with expected(signature, default_count, expected_search_path, volatility) as (
      values
        (
          to_regprocedure('private.current_attendance_viewer_scope(uuid)'),
          0, array['search_path=pg_catalog, public']::text[], 's'::"char"
        ),
        (
          to_regprocedure('private.attendance_photo_json(uuid)'),
          0, array['search_path=pg_catalog, public']::text[], 's'::"char"
        ),
        (
          to_regprocedure('private.attendance_work_point_json(uuid)'),
          0, array['search_path=pg_catalog, public, private']::text[], 's'::"char"
        ),
        (
          to_regprocedure('public.upsert_attendance_work_point_secure(uuid,smallint,text,text,text)'),
          1, array['search_path=pg_catalog, public, private']::text[], 'v'::"char"
        ),
        (
          to_regprocedure('public.reserve_attendance_photo_secure(uuid,text,text,text,bigint,text,timestamp with time zone)'),
          2, array['search_path=pg_catalog, public, private']::text[], 'v'::"char"
        ),
        (
          to_regprocedure('public.finalize_attendance_photo_secure(uuid)'),
          0, array['search_path=pg_catalog, public, private, storage']::text[], 'v'::"char"
        ),
        (
          to_regprocedure('public.abandon_attendance_photo_secure(uuid)'),
          0, array['search_path=pg_catalog, public, private']::text[], 'v'::"char"
        ),
        (
          to_regprocedure('public.clock_out_project_secure(uuid,uuid,double precision,double precision,numeric,timestamp with time zone,text)'),
          2, array['search_path=pg_catalog, public, private']::text[], 'v'::"char"
        ),
        (
          to_regprocedure('public.can_current_employee_view_attendance_session(uuid)'),
          0, array['search_path=pg_catalog, public, private']::text[], 's'::"char"
        ),
        (
          to_regprocedure('public.can_current_employee_upload_attendance_photo(text,text)'),
          0, array['search_path=pg_catalog, public, private']::text[], 's'::"char"
        ),
        (
          to_regprocedure('public.can_current_employee_view_attendance_photo(text,text)'),
          0, array['search_path=pg_catalog, public']::text[], 's'::"char"
        )
    )
    select count(*)::integer
    from expected contract
    left join pg_proc procedure on procedure.oid = contract.signature
    where contract.signature is null
       or not procedure.prosecdef
       or procedure.pronargdefaults <> contract.default_count
       or procedure.proconfig is distinct from contract.expected_search_path
       or procedure.provolatile <> contract.volatility
  ),
  0,
  'Task 6 functions have exact SECURITY DEFINER search paths and default counts'
);

select ok(
  exists (
    select 1
    from storage.buckets bucket
    where bucket.id = 'erp-attendance-photos'
      and bucket.name = 'erp-attendance-photos'
      and bucket.public = false
      and bucket.file_size_limit = 20971520
      and bucket.allowed_mime_types = array[
        'image/jpeg','image/png','image/webp','image/heic','image/heif'
      ]::text[]
  ),
  'attendance photo bucket is private with exact size and MIME limits'
);

select is(
  (
    select count(*)::integer
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace schema on schema.oid = relation.relnamespace
    where schema.nspname = 'storage'
      and relation.relname = 'objects'
      and policy.polname in (
        'attendance_photos_insert', 'attendance_photos_insert_guard',
        'attendance_photos_select', 'attendance_photos_select_guard',
        'attendance_photos_update_deny', 'attendance_photos_delete_deny'
      )
      and case policy.polname
        when 'attendance_photos_insert' then policy.polpermissive and policy.polcmd = 'a'
        when 'attendance_photos_insert_guard' then not policy.polpermissive and policy.polcmd = 'a'
        when 'attendance_photos_select' then policy.polpermissive and policy.polcmd = 'r'
        when 'attendance_photos_select_guard' then not policy.polpermissive and policy.polcmd = 'r'
        when 'attendance_photos_update_deny' then not policy.polpermissive and policy.polcmd = 'w'
        when 'attendance_photos_delete_deny' then not policy.polpermissive and policy.polcmd = 'd'
        else false
      end
  ),
  6,
  'attendance bucket has the exact permissive and restrictive policy modes'
);

select is(
  (
    select count(*)::integer
    from pg_policy policy
    where policy.polrelid = 'storage.objects'::regclass
      and policy.polroles = array['authenticated'::regrole::oid]
      and case policy.polname
        when 'attendance_photos_insert' then
          policy.polqual is null
          and pg_get_expr(policy.polwithcheck, policy.polrelid) =
            'can_current_employee_upload_attendance_photo(bucket_id, name)'
        when 'attendance_photos_insert_guard' then
          policy.polqual is null
          and pg_get_expr(policy.polwithcheck, policy.polrelid) =
            $$((bucket_id <> 'erp-attendance-photos'::text) OR can_current_employee_upload_attendance_photo(bucket_id, name))$$
        when 'attendance_photos_select' then
          policy.polwithcheck is null
          and pg_get_expr(policy.polqual, policy.polrelid) =
            'can_current_employee_view_attendance_photo(bucket_id, name)'
        when 'attendance_photos_select_guard' then
          policy.polwithcheck is null
          and pg_get_expr(policy.polqual, policy.polrelid) =
            $$((bucket_id <> 'erp-attendance-photos'::text) OR can_current_employee_view_attendance_photo(bucket_id, name))$$
        when 'attendance_photos_update_deny' then
          pg_get_expr(policy.polqual, policy.polrelid) =
            $$(bucket_id <> 'erp-attendance-photos'::text)$$
          and pg_get_expr(policy.polwithcheck, policy.polrelid) =
            $$(bucket_id <> 'erp-attendance-photos'::text)$$
        when 'attendance_photos_delete_deny' then
          policy.polwithcheck is null
          and pg_get_expr(policy.polqual, policy.polrelid) =
            $$(bucket_id <> 'erp-attendance-photos'::text)$$
        else false
      end
  ),
  6,
  'attendance Storage policies bind authenticated to the exact bucket predicates'
);

select is(
  (
    with helper(signature) as (
      values
        (to_regprocedure('private.attendance_photo_json(uuid)')),
        (to_regprocedure('private.attendance_work_point_json(uuid)'))
    )
    select count(*)::integer
    from helper
    where signature is null
       or has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
       or has_function_privilege('service_role', signature, 'EXECUTE')
       or exists (
         select 1
         from pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) privilege
         where procedure.oid = signature
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
  ),
  0,
  'Task 6 private DTO helpers deny browser and service roles'
);

select ok(
  has_function_privilege(
    'authenticated', 'public.list_attendance_projects_secure()', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.list_attendance_projects_secure()', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.list_attendance_projects_secure()', 'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = 'public.list_attendance_projects_secure()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = 'public.list_attendance_projects_secure()'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and (
        privilege.grantee not in (
          procedure.proowner,
          'authenticated'::regrole::oid,
          'service_role'::regrole::oid
        )
        or (
          privilege.grantee in (
            'authenticated'::regrole::oid,
            'service_role'::regrole::oid
          )
          and privilege.is_grantable
        )
      )
  ),
  'attendance project-list RPC is executable only by authenticated and service_role'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.get_my_today_attendance_secure()', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'public.get_my_today_attendance_secure()', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.get_my_today_attendance_secure()', 'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = 'public.get_my_today_attendance_secure()'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = 'public.get_my_today_attendance_secure()'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and (
        privilege.grantee not in (
          procedure.proowner,
          'authenticated'::regrole::oid,
          'service_role'::regrole::oid
        )
        or (
          privilege.grantee in (
            'authenticated'::regrole::oid,
            'service_role'::regrole::oid
          )
          and privilege.is_grantable
        )
      )
  ),
  'today-attendance RPC is executable only by authenticated and service_role'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = 'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc procedure
    cross join lateral aclexplode(coalesce(
      procedure.proacl, acldefault('f', procedure.proowner)
    )) privilege
    where procedure.oid = 'public.clock_in_project_secure(text,uuid,double precision,double precision,numeric,timestamp with time zone,text)'::regprocedure
      and privilege.privilege_type = 'EXECUTE'
      and (
        privilege.grantee not in (
          procedure.proowner,
          'authenticated'::regrole::oid,
          'service_role'::regrole::oid
        )
        or (
          privilege.grantee in (
            'authenticated'::regrole::oid,
            'service_role'::regrole::oid
          )
          and privilege.is_grantable
        )
      )
  ),
  'clock-in RPC is executable only by authenticated and service_role'
);

select is(
  (
    with helper(signature) as (
      values
        ('private.current_attendance_employee()'::regprocedure),
        ('private.is_attendance_project_eligible(text,jsonb)'::regprocedure),
        ('private.attendance_distance_meters(double precision,double precision,double precision,double precision)'::regprocedure),
        ('private.reject_attendance_event_mutation()'::regprocedure),
        ('private.attendance_event_json(uuid)'::regprocedure),
        ('private.attendance_session_json(uuid)'::regprocedure),
        ('private.current_attendance_viewer_scope(uuid)'::regprocedure)
    )
    select count(*)::integer
    from helper
    where has_function_privilege('anon', signature, 'EXECUTE')
       or has_function_privilege('authenticated', signature, 'EXECUTE')
       or has_function_privilege('service_role', signature, 'EXECUTE')
       or exists (
         select 1
         from pg_proc procedure
         cross join lateral aclexplode(coalesce(
           procedure.proacl, acldefault('f', procedure.proowner)
         )) privilege
         where procedure.oid = helper.signature
           and privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
       )
  ),
  0,
  'all seven attendance helpers deny PUBLIC, anon, authenticated, and service_role'
);

select ok(
  (
    with attendance_table(table_name) as (
      values
        ('project_attendance_sessions'),
        ('project_attendance_events'),
        ('project_attendance_work_points'),
        ('project_attendance_photos')
    ), table_privilege(privilege_name) as (
      values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
             ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    )
    select bool_and(
      not has_table_privilege(
        'anon', format('public.%I', table_name), privilege_name
      )
      and not has_table_privilege(
        'authenticated', format('public.%I', table_name), privilege_name
      )
      and has_table_privilege(
        'service_role', format('public.%I', table_name), privilege_name
      )
    )
    from attendance_table
    cross join table_privilege
  )
  and not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    cross join lateral aclexplode(coalesce(
      relation.relacl, acldefault('r', relation.relowner)
    )) privilege
    where namespace.nspname = 'public'
      and relation.relname in (
        'project_attendance_sessions', 'project_attendance_events',
        'project_attendance_work_points', 'project_attendance_photos'
      )
      and privilege.grantee = 0
  ),
  'attendance tables deny PUBLIC, anon, and authenticated while service_role has all table privileges'
);
select is(
  (
    select count(*)::integer
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'project_attendance_sessions', 'project_attendance_events',
        'project_attendance_work_points', 'project_attendance_photos'
      )
      and relation.relkind = 'r'
      and relation.relrowsecurity
  ),
  4,
  'row-level security is enabled on all four attendance tables'
);
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and tablename in (
     'project_attendance_sessions', 'project_attendance_events',
     'project_attendance_work_points', 'project_attendance_photos'
   )),
  0,
  'attendance tables expose zero row-level security policies'
);
select ok(
  exists (
    select 1
    from pg_trigger trigger
    where trigger.tgrelid = 'public.project_attendance_events'::regclass
      and trigger.tgname = 'reject_attendance_event_mutation'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgfoid = 'private.reject_attendance_event_mutation()'::regprocedure
      and trigger.tgtype = 27
      and trigger.tgattr::text = ''
      and trigger.tgqual is null
  ),
  'immutable attendance-event trigger is enabled before row updates and deletes'
);

select ok(
  exists (
    select 1
    from pg_index index_definition
    where index_definition.indexrelid = 'public.project_attendance_one_open_session_idx'::regclass
      and index_definition.indrelid = 'public.project_attendance_sessions'::regclass
      and index_definition.indisunique
      and index_definition.indnkeyatts = 1
      and pg_get_indexdef(index_definition.indexrelid, 1, false) = 'employee_profile_id'
      and pg_get_expr(index_definition.indpred, index_definition.indrelid) = $$(status = 'open'::text)$$
  ),
  'one-open-session index is unique on employee with an open-status predicate'
);
select ok(
  exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.project_attendance_events'::regclass
      and constraint_definition.conname = 'project_attendance_events_request_id_key'
      and constraint_definition.contype = 'u'
      and pg_get_constraintdef(constraint_definition.oid) = 'UNIQUE (request_id)'
  ),
  'attendance request UUID has a catalog-backed uniqueness constraint'
);
select ok(
  exists (
    select 1
    from pg_constraint constraint_definition
    where constraint_definition.conrelid = 'public.project_attendance_events'::regclass
      and constraint_definition.conname = 'attendance_event_session_type_unique'
      and constraint_definition.contype = 'u'
      and pg_get_constraintdef(constraint_definition.oid) = 'UNIQUE (session_id, event_type)'
  ),
  'attendance session and event type have a catalog-backed uniqueness constraint'
);
select ok(
  exists (
    select 1
    from pg_index index_definition
    where index_definition.indexrelid = 'public.project_attendance_photo_active_phase_idx'::regclass
      and index_definition.indrelid = 'public.project_attendance_photos'::regclass
      and index_definition.indisunique
      and index_definition.indnkeyatts = 2
      and pg_get_indexdef(index_definition.indexrelid, 1, false) = 'work_point_id'
      and pg_get_indexdef(index_definition.indexrelid, 2, false) = 'phase'
      and pg_get_expr(index_definition.indpred, index_definition.indrelid) = $$(upload_status = 'active'::text)$$
  ),
  'active photo phase index is unique on work point and phase with the active predicate'
);
select ok(
  exists (
    select 1
    from pg_index index_definition
    where index_definition.indexrelid = 'public.project_attendance_photo_pending_phase_idx'::regclass
      and index_definition.indrelid = 'public.project_attendance_photos'::regclass
      and index_definition.indisunique
      and index_definition.indnkeyatts = 2
      and pg_get_indexdef(index_definition.indexrelid, 1, false) = 'work_point_id'
      and pg_get_indexdef(index_definition.indexrelid, 2, false) = 'phase'
      and pg_get_expr(index_definition.indpred, index_definition.indrelid) = $$(upload_status = 'pending'::text)$$
  ),
  'pending photo phase index is unique on work point and phase with the pending predicate'
);
select is(
  round(private.attendance_distance_meters(0, 0, 0, 1))::bigint,
  111195::bigint,
  'Haversine distance is nonzero and known for one degree at the equator'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000001','authenticated','authenticated','attendance-ordinary@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000002','authenticated','authenticated','attendance-disabled@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000003','authenticated','authenticated','attendance-former@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000004','authenticated','authenticated','attendance-password@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000005','authenticated','authenticated','attendance-other@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000006','authenticated','authenticated','attendance-assignee@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000007','authenticated','authenticated','attendance-former-assignee@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000008','authenticated','authenticated','attendance-president@auth.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','61000000-0000-4000-8000-000000000009','authenticated','authenticated','attendance-sw000@auth.invalid','',now(),'{}','{}',now(),now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password, is_hidden_system_account
) values
  ('62000000-0000-4000-8000-000000000001','SW-6101','61000000-0000-4000-8000-000000000001','零模块普通员工','工程部','小工','在职','active',false,false),
  ('62000000-0000-4000-8000-000000000002','SW-6102','61000000-0000-4000-8000-000000000002','停用员工','工程部','小工','在职','disabled',false,false),
  ('62000000-0000-4000-8000-000000000003','SW-6103','61000000-0000-4000-8000-000000000003','离职员工','工程部','小工','离职','active',false,false),
  ('62000000-0000-4000-8000-000000000004','SW-6104','61000000-0000-4000-8000-000000000004','待改密员工','工程部','小工','在职','active',true,false),
  ('62000000-0000-4000-8000-000000000005','SW-6105','61000000-0000-4000-8000-000000000005','无关员工','工程部','小工','在职','active',false,false),
  ('62000000-0000-4000-8000-000000000006','SW-6106','61000000-0000-4000-8000-000000000006','当前现场担当','工程部','职长','在职','active',false,false),
  ('62000000-0000-4000-8000-000000000007','SW-6107','61000000-0000-4000-8000-000000000007','原现场担当','工程部','职长','在职','active',false,false),
  ('62000000-0000-4000-8000-000000000008','SW-6108','61000000-0000-4000-8000-000000000008','考勤测试社长','总务部','社长','在职','active',false,false),
  ('62000000-0000-4000-8000-000000000009','SW-000','61000000-0000-4000-8000-000000000009','隐藏系统管理员','总务部','总务部长','在职','active',false,true);

delete from public.permission_grants
where (subject_type = 'department' and subject_code = '工程部')
   or (subject_type = 'position' and subject_code = '小工');

create or replace function pg_temp.attendance_project_payload(
  p_id text, p_name text, p_status text, p_radius numeric,
  p_confirmed text, p_snapshot text
) returns jsonb language sql immutable set search_path = pg_catalog as $$
  select jsonb_build_object(
    'projectId', p_id, 'projectName', p_name, 'status', p_status,
    'address', '東京都 千代田区 1-1', 'latitude', 35.681236,
    'longitude', 139.767125, 'attendanceRadiusMeters', p_radius,
    'locationConfirmedAt', p_confirmed,
    'locationAddressSnapshot', p_snapshot,
    'siteAssigneeEmployeeId', ''
  );
$$;

grant execute on function pg_temp.attendance_project_payload(text,text,text,numeric,text,text)
  to service_role;

set local role service_role;
insert into public.projects(record_key, payload, status) values
  ('ATT-ELIGIBLE', pg_temp.attendance_project_payload('ATT-ELIGIBLE','合法现场','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1') || jsonb_build_object('siteAssigneeEmployeeId','62000000-0000-4000-8000-000000000006'), 'active'),
  ('ATT-ELIGIBLE-OTHER', pg_temp.attendance_project_payload('ATT-ELIGIBLE-OTHER','另一个合法现场','待开工',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-UNCONFIRMED', pg_temp.attendance_project_payload('ATT-UNCONFIRMED','未确认现场','进行中',300,'','東京都 千代田区 1-1'), 'active'),
  ('ATT-WRONG-STATUS', pg_temp.attendance_project_payload('ATT-WRONG-STATUS','报价现场','报价中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-BAD-RADIUS', pg_temp.attendance_project_payload('ATT-BAD-RADIUS','错误半径','进行中',0,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-DELETED', pg_temp.attendance_project_payload('ATT-DELETED','已删除现场','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1') || jsonb_build_object('siteAssigneeEmployeeId','62000000-0000-4000-8000-000000000007'), 'deleted'),
  ('ATT-NONOBJECT', '[]'::jsonb, 'active'),
  ('ATT-OVERFLOW', pg_temp.attendance_project_payload('ATT-OVERFLOW','溢出坐标','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1') || jsonb_build_object('latitude','1e1000'::numeric), 'active'),
  ('ATT-MISMATCH', pg_temp.attendance_project_payload('ATT-MISMATCH','地址不一致','进行中',300,'2026-07-15T00:00:00Z','大阪府 大阪市 1-1'), 'active'),
  ('ATT-WHITESPACE-NAME', pg_temp.attendance_project_payload('ATT-WHITESPACE-NAME',E'\t\n','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'active'),
  ('ATT-WHITESPACE-CONFIRM', pg_temp.attendance_project_payload('ATT-WHITESPACE-CONFIRM','空白确认','进行中',300,E'\t\n','東京都 千代田区 1-1'), 'active'),
  ('ATT-WHITESPACE-ADDRESS', pg_temp.attendance_project_payload('ATT-WHITESPACE-ADDRESS','空白地址','进行中',300,'2026-07-15T00:00:00Z',E'\t\n') || jsonb_build_object('address',E'\t\n'), 'active'),
  ('ATT-VOID', pg_temp.attendance_project_payload('ATT-VOID','作废记录现场','进行中',300,'2026-07-15T00:00:00Z','東京都 千代田区 1-1'), 'void');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is(public.has_current_permission('module.projects.view'), false, 'ordinary fixture has zero project view permission');
select results_eq(
  $$ select project->>'projectId' from public.list_attendance_projects_secure() project order by 1 $$,
  $$ values ('ATT-ELIGIBLE'::text), ('ATT-ELIGIBLE-OTHER'::text) $$,
  'attendance list ignores project-module permission but hides every ineligible project'
);
reset role;

set local role anon;
select throws_ok(
  $$ select * from public.list_attendance_projects_secure() $$,
  '42501', null, 'anonymous attendance project list is denied'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select throws_ok($$ select * from public.list_attendance_projects_secure() $$, '42501', null, 'disabled employee is denied');
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000003', true);
select throws_ok($$ select * from public.list_attendance_projects_secure() $$, '42501', null, 'former employee is denied');
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000004', true);
select throws_ok($$ select * from public.list_attendance_projects_secure() $$, '42501', null, 'must-change-password employee is denied');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'own',
  'ordinary employee receives own viewer scope'
);
select is(
  (public.get_my_today_attendance_secure()#>>'{viewerAccess,canViewScopedRecords}')::boolean,
  false,
  'own viewer scope cannot view scoped records'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000006', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'assigned_projects',
  'current site assignee receives assigned-project viewer scope'
);
select is(
  (public.get_my_today_attendance_secure()#>>'{viewerAccess,canViewScopedRecords}')::boolean,
  true,
  'assigned-project viewer scope can view scoped records'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000007', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'own',
  'former site assignee does not retain assigned-project viewer scope'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000008', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'all',
  'president receives all viewer scope'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000009', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'all',
  'SW-000 receives all viewer scope'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select private.current_attendance_employee() $$,
  '42501', null, 'authenticated cannot call the private identity helper'
);
reset role;

select table_privs_are('public','project_attendance_sessions','authenticated',array[]::text[]);
select table_privs_are('public','project_attendance_events','authenticated',array[]::text[]);
select table_privs_are('public','project_attendance_work_points','authenticated',array[]::text[]);
select table_privs_are('public','project_attendance_photos','authenticated',array[]::text[]);
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename like 'project_attendance_%'),
  0,
  'business tables have no browser policies'
);

create temporary table attendance_clock_results(
  result_name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on attendance_clock_results to authenticated;

create temporary table attendance_today_results(
  result_name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on attendance_today_results to authenticated;

create or replace function pg_temp.attendance_clock_hint(
  p_project_id text,
  p_request_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters numeric,
  p_device_recorded_at timestamptz,
  p_abnormal_reason text
) returns text
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  error_hint text;
begin
  perform public.clock_in_project_secure(
    p_project_id, p_request_id, p_latitude, p_longitude,
    p_accuracy_meters, p_device_recorded_at, p_abnormal_reason
  );
  return null;
exception when others then
  get stacked diagnostics error_hint = pg_exception_hint;
  return error_hint;
end;
$$;
grant execute on function pg_temp.attendance_clock_hint(
  text,uuid,double precision,double precision,numeric,timestamptz,text
) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-UNCONFIRMED','63100000-0000-4000-8000-000000000001',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a project without location confirmation'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-WRONG-STATUS','63100000-0000-4000-8000-000000000002',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects an ineligible project status'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-BAD-RADIUS','63100000-0000-4000-8000-000000000003',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a nonpositive project radius'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-DELETED','63100000-0000-4000-8000-000000000004',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a deleted project envelope'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-NONOBJECT','63100000-0000-4000-8000-000000000005',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a non-object project payload'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-OVERFLOW','63100000-0000-4000-8000-000000000006',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects an overflow project coordinate without leaking a cast error'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-MISMATCH','63100000-0000-4000-8000-000000000007',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects mismatched normalized address snapshots'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-WHITESPACE-NAME','63100000-0000-4000-8000-000000000008',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a control-whitespace-only project name'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-WHITESPACE-CONFIRM','63100000-0000-4000-8000-000000000009',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a control-whitespace-only confirmation value'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-WHITESPACE-ADDRESS','63100000-0000-4000-8000-000000000010',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects matching control-whitespace-only addresses'
);
select throws_ok(
  $$ select public.clock_in_project_secure('ATT-VOID','63100000-0000-4000-8000-000000000011',35.681236,139.767125,10,null,null) $$,
  '22023',null,'clock-in rejects a valid payload in a void project envelope'
);
reset role;
select is(
  (select count(*)::integer from public.project_attendance_sessions
   where employee_profile_id = '62000000-0000-4000-8000-000000000007'),
  0,
  'ineligible project attempts leave no attendance session'
);
select is(
  (select count(*)::integer
   from public.project_attendance_events event
   join public.project_attendance_sessions session on session.session_id = event.session_id
   where session.employee_profile_id = '62000000-0000-4000-8000-000000000007'),
  0,
  'ineligible project attempts leave no attendance event'
);

insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at, closed_at
) values
  (
    '66000000-0000-4000-8000-000000000003',
    '62000000-0000-4000-8000-000000000001','SW-6101','零模块普通员工',
    'ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',
    35.681236,139.767125,300,
    timezone('Asia/Tokyo',statement_timestamp())::date - 3,
    'closed',statement_timestamp() - interval '72 hours',statement_timestamp() - interval '71 hours'
  ),
  (
    '66000000-0000-4000-8000-000000000004',
    '62000000-0000-4000-8000-000000000002','SW-6102','停用员工',
    'ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',
    35.681236,139.767125,300,
    timezone('Asia/Tokyo',statement_timestamp())::date - 3,
    'closed',statement_timestamp() - interval '72 hours',statement_timestamp() - interval '71 hours'
  ),
  (
    '66000000-0000-4000-8000-000000000005',
    '62000000-0000-4000-8000-000000000003','SW-6103','离职员工',
    'ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',
    35.681236,139.767125,300,
    timezone('Asia/Tokyo',statement_timestamp())::date - 3,
    'closed',statement_timestamp() - interval '72 hours',statement_timestamp() - interval '71 hours'
  );

insert into public.project_attendance_events(
  session_id, event_type, request_id, server_recorded_at,
  latitude, longitude, accuracy_meters, distance_meters, radius_meters,
  result, abnormal_reason
) values (
  '66000000-0000-4000-8000-000000000003','clock_out',
  '63200000-0000-4000-8000-000000000001',statement_timestamp() - interval '71 hours',
  35.681236,139.767125,10,0,300,'normal',null
);

select throws_ok(
  $$ insert into public.project_attendance_events(
       session_id, event_type, request_id, server_recorded_at,
       latitude, longitude, accuracy_meters, distance_meters, radius_meters,
       result, abnormal_reason
     ) values (
       '66000000-0000-4000-8000-000000000004','clock_in',
       '63200000-0000-4000-8000-000000000002',statement_timestamp(),
       35.681236,139.767125,301,301,300,'abnormal',null
     ) $$,
  '23514', null, 'event constraint rejects an abnormal event with a null reason'
);
select throws_ok(
  $$ insert into public.project_attendance_events(
       session_id, event_type, request_id, server_recorded_at,
       latitude, longitude, accuracy_meters, distance_meters, radius_meters,
       result, abnormal_reason
     ) values (
       '66000000-0000-4000-8000-000000000005','clock_in',
       '63200000-0000-4000-8000-000000000003',statement_timestamp(),
       35.681236,139.767125,301,301,300,'abnormal',E'\t入口封闭\n'
     ) $$,
  '23514', null, 'event constraint rejects a noncanonical control-whitespace-padded reason'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_clock_results values (
  'boundary_first',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE', '63000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 300, '2026-01-01T00:00:00Z', E'\tignored normal reason\n'
  )
);
insert into attendance_clock_results values (
  'boundary_retry',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE', '63000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 300, '2026-01-01T00:00:00Z', E'\tignored normal reason\n'
  )
);
select is(
  (select payload#>>'{event,result}' from attendance_clock_results where result_name = 'boundary_first'),
  'normal',
  'distance zero plus accuracy exactly radius is normal'
);
select is(
  (select payload#>>'{event,abnormalReason}' from attendance_clock_results where result_name = 'boundary_first'),
  null,
  'normal clock-in forces the abnormal reason to null'
);
select is(
  (select payload#>>'{event,eventId}' from attendance_clock_results where result_name = 'boundary_first'),
  (select payload#>>'{event,eventId}' from attendance_clock_results where result_name = 'boundary_retry'),
  'same request returns the same immutable event'
);
select ok(
  (select (select count(*) from jsonb_object_keys(payload->'event')) = 12
     and (payload->'event') ?& array[
       'eventId','requestId','eventType','serverRecordedAt','deviceRecordedAt',
       'latitude','longitude','accuracyMeters','distanceMeters','radiusMeters',
       'result','abnormalReason'
     ]::text[]
   from attendance_clock_results where result_name = 'boundary_first'),
  'clock-in event DTO contains exactly the trusted event keys'
);
select ok(
  (select (select count(*) from jsonb_object_keys(payload->'session')) = 17
     and (payload->'session') ?& array[
       'sessionId','employeeProfileId','employeeNumberSnapshot','employeeNameSnapshot',
       'projectId','projectNameSnapshot','projectAddressSnapshot',
       'projectLatitudeSnapshot','projectLongitudeSnapshot','attendanceRadiusMetersSnapshot',
       'workDate','status','openedAt','closedAt','clockInEvent','clockOutEvent','workPoints'
     ]::text[]
   from attendance_clock_results where result_name = 'boundary_first'),
  'clock-in session DTO contains exactly the canonical session keys'
);
select is(
  (select (payload#>>'{session,workDate}')::date from attendance_clock_results where result_name = 'boundary_first'),
  (select timezone('Asia/Tokyo', (payload#>>'{event,serverRecordedAt}')::timestamptz)::date
   from attendance_clock_results where result_name = 'boundary_first'),
  'work date comes from server time in Tokyo'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE-OTHER','63000000-0000-4000-8000-000000000001',
    35.681236,139.767125,10,null,null
  ) $$,
  '22023',null,'same-employee request reuse against another project conflicts'
);
select is(
  pg_temp.attendance_clock_hint(
    'ATT-ELIGIBLE-OTHER','63000000-0000-4000-8000-000000000001',
    35.681236,139.767125,10,null,null
  ),
  'ATTENDANCE_REQUEST_CONFLICT',
  'same-employee cross-project request reuse has a stable safe hint'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63200000-0000-4000-8000-000000000001',
    35.681236,139.767125,10,null,null
  ) $$,
  '22023',null,'same-employee clock-out request reuse is rejected by clock-in'
);
select is(
  pg_temp.attendance_clock_hint(
    'ATT-ELIGIBLE','63200000-0000-4000-8000-000000000001',
    35.681236,139.767125,10,null,null
  ),
  'ATTENDANCE_REQUEST_CONFLICT',
  'clock-out request reuse through clock-in has a stable safe hint'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000002',
    35.681236,139.767125,10,null,null
  ) $$,
  '55000',null,'a different request cannot create a second open session'
);
select is(
  pg_temp.attendance_clock_hint(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000002',
    35.681236,139.767125,10,null,null
  ),
  'ATTENDANCE_OPEN_SESSION_EXISTS',
  'second-open rejection has a stable safe hint'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000003',
    91,139.767125,10,null,null
  ) $$,
  '22023',null,'invalid latitude is rejected before writing'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE',null,
    35.681236,139.767125,10,null,null
  ) $$,
  '22023',null,'null request UUID is rejected before locking or writing'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000004',
    35.681236,139.767125,300.001,null,null
  ) $$,
  '22023',null,'0.001 beyond the radius requires an abnormal reason'
);
insert into attendance_clock_results values (
  'abnormal_other',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000004',
    35.681236,139.767125,300.001,null,' 入口封闭 '
  )
);
select is(
  (select payload#>>'{event,result}' from attendance_clock_results where result_name = 'abnormal_other'),
  'abnormal','over-radius event is explicitly abnormal'
);
select is(
  (select payload#>>'{event,abnormalReason}' from attendance_clock_results where result_name = 'abnormal_other'),
  '入口封闭','abnormal reason is trimmed'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000001',
    35.681236,139.767125,1,null,null
  ) $$,
  '22023',null,'cross-employee request reuse conflicts'
);
select is(
  pg_temp.attendance_clock_hint(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000001',
    35.681236,139.767125,1,null,null
  ),
  'ATTENDANCE_REQUEST_CONFLICT',
  'cross-employee request reuse has a stable safe hint'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000005',
    35.681236,139.767125,300.001,null,E'\t\n\r '
  ) $$,
  '22023',null,'control-whitespace-only abnormal reason is rejected'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000008', true);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000006',
    35.681236,139.767125,300.001,null,repeat('界',501)
  ) $$,
  '22023',null,'an abnormal reason of 501 Unicode code points is rejected'
);
insert into attendance_clock_results values (
  'abnormal_500_code_points',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000007',
    35.681236,139.767125,300.001,null,repeat('界',500)
  )
);
select is(
  (select char_length(payload#>>'{event,abnormalReason}')::integer
   from attendance_clock_results where result_name = 'abnormal_500_code_points'),
  500,
  'an abnormal reason of exactly 500 Unicode code points is stored intact'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000009', true);
insert into attendance_clock_results values (
  'abnormal_control_padding',
  public.clock_in_project_secure(
    'ATT-ELIGIBLE','63000000-0000-4000-8000-000000000008',
    35.681236,139.767125,300.001,null,E'\t\n 入口\t封闭 \r\n'
  )
);
select is(
  (select payload#>>'{event,abnormalReason}'
   from attendance_clock_results where result_name = 'abnormal_control_padding'),
  E'入口\t封闭',
  'abnormal reason removes control-whitespace padding while preserving internal content'
);
reset role;

select is(
  (select count(*)::integer from public.project_attendance_sessions
   where employee_profile_id = '62000000-0000-4000-8000-000000000001'
     and status = 'open'),
  1,
  'idempotent retry creates one open session'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
update public.projects set payload = payload || jsonb_build_object(
  'latitude', 34.0, 'longitude', 135.0, 'attendanceRadiusMeters', 50
) where record_key = 'ATT-ELIGIBLE';
reset role;
select is(
  (select project_latitude_snapshot from public.project_attendance_sessions
   where employee_profile_id = '62000000-0000-4000-8000-000000000001' and status = 'open'),
  35.681236::double precision,
  'project edits never mutate the session latitude snapshot'
);
select throws_ok(
  $$ update public.project_attendance_events set latitude = 0
     where request_id = '63000000-0000-4000-8000-000000000001' $$,
  '42501',null,'attendance event update is rejected'
);
select throws_ok(
  $$ delete from public.project_attendance_events
     where request_id = '63000000-0000-4000-8000-000000000001' $$,
  '42501',null,'attendance event delete is rejected'
);
set local role service_role;
update public.projects set payload = payload || jsonb_build_object(
  'latitude', 35.681236, 'longitude', 139.767125, 'attendanceRadiusMeters', 300
) where record_key = 'ATT-ELIGIBLE';
reset role;

create or replace function pg_temp.attendance_session_id(p_result_name text)
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select (payload#>>'{session,sessionId}')::uuid
  from attendance_clock_results
  where result_name = p_result_name;
$$;
grant execute on function pg_temp.attendance_session_id(text) to authenticated;

create or replace function pg_temp.attendance_work_point_id(
  p_session_id uuid,
  p_ordinal integer
) returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select point.work_point_id
  from public.project_attendance_work_points point
  where point.session_id = p_session_id and point.ordinal = p_ordinal;
$$;
create or replace function pg_temp.attendance_work_point_area(
  p_session_id uuid,
  p_ordinal integer
) returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select point.area_name
  from public.project_attendance_work_points point
  where point.session_id = p_session_id and point.ordinal = p_ordinal;
$$;
create or replace function pg_temp.attendance_work_point_count(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from public.project_attendance_work_points point
  where point.session_id = p_session_id;
$$;
create or replace function pg_temp.attendance_photo_status(p_photo_id uuid)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select photo.upload_status
  from public.project_attendance_photos photo
  where photo.photo_id = p_photo_id;
$$;
create or replace function pg_temp.attendance_photo_phase_status_count(
  p_session_id uuid,
  p_phase text,
  p_upload_status text
) returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select count(*)::integer
  from public.project_attendance_photos photo
  join public.project_attendance_work_points point
    on point.work_point_id = photo.work_point_id
  where point.session_id = p_session_id
    and photo.phase = p_phase
    and photo.upload_status = p_upload_status;
$$;
grant execute on function pg_temp.attendance_work_point_id(uuid,integer) to authenticated;
grant execute on function pg_temp.attendance_work_point_area(uuid,integer) to authenticated;
grant execute on function pg_temp.attendance_work_point_count(uuid) to authenticated;
grant execute on function pg_temp.attendance_photo_status(uuid) to authenticated;
grant execute on function pg_temp.attendance_photo_phase_status_count(uuid,text,text) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 1::smallint, ' 北侧墙面 ', ' 下地施工 ', ''
  ) $$,
  'owner can create the first point in an open session'
);
select is(
  pg_temp.attendance_work_point_area(
    pg_temp.attendance_session_id('boundary_first'), 1
  ),
  '北侧墙面',
  'point text is trimmed by the server'
);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 8::smallint, '第八点', '不可创建', ''
  ) $$,
  '22023', null, 'ordinal eight is rejected'
);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 2::smallint, repeat('区', 101), '施工', ''
  ) $$,
  '22023', null, '101-character area is rejected'
);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 2::smallint, '区域', repeat('工', 1001), ''
  ) $$,
  '22023', null, '1001-character description is rejected'
);
select ok(
  (select (select count(*) from jsonb_object_keys(
      public.upsert_attendance_work_point_secure(
        pg_temp.attendance_session_id('boundary_first'), 1::smallint,
        '北侧墙面', '下地施工', ''
      )
    )) = 9),
  'work-point upsert returns the exact DTO key count'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    pg_temp.attendance_session_id('boundary_first'), 2::smallint, '区域', '施工', ''
  ) $$,
  '42501', null, 'another employee cannot mutate the point'
);
reset role;

insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at, closed_at
) values (
  '71000000-0000-4000-8000-000000000099',
  '62000000-0000-4000-8000-000000000001',
  'SW-6101', '零模块普通员工', 'ATT-ELIGIBLE', '合法现场', '東京都 千代田区 1-1',
  35.681236, 139.767125, 300, '2026-07-14', 'closed',
  '2026-07-14T08:00:00Z', '2026-07-14T17:00:00Z'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.upsert_attendance_work_point_secure(
    '71000000-0000-4000-8000-000000000099', 1::smallint, '区域', '施工', ''
  ) $$,
  '55000', null, 'closed session is immutable'
);
reset role;

update public.project_attendance_sessions
set status = 'closed', closed_at = statement_timestamp()
where employee_profile_id = '62000000-0000-4000-8000-000000000005'
  and status = 'open';

insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at
) values (
  '71000000-0000-4000-8000-000000000098',
  '62000000-0000-4000-8000-000000000005',
  'SW-6105', '无关员工', 'ATT-ELIGIBLE', '合法现场', '東京都 千代田区 1-1',
  35.681236, 139.767125, 300, '2026-07-15', 'open', '2026-07-15T08:00:00Z'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select lives_ok(
  $$ select public.upsert_attendance_work_point_secure(
    '71000000-0000-4000-8000-000000000098', ordinal::smallint,
    '点位' || ordinal, '施工' || ordinal, ''
  ) from generate_series(1, 7) ordinal $$,
  'ordinals one through seven coexist'
);
select is(
  pg_temp.attendance_work_point_count('71000000-0000-4000-8000-000000000098'),
  7,
  'one session contains seven rows'
);
select lives_ok(
  $$ select public.upsert_attendance_work_point_secure(
    '71000000-0000-4000-8000-000000000098', 1::smallint, '更新点位', '更新施工', ''
  ) $$,
  'saving the same ordinal updates its row'
);
select is(
  pg_temp.attendance_work_point_count('71000000-0000-4000-8000-000000000098'),
  7,
  'upsert never creates an eighth row'
);
reset role;

create temporary table attendance_photo_results(
  result_name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on attendance_photo_results to authenticated, service_role;

insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
)
select
  '74000000-0000-4000-8000-000000000089', point.work_point_id, 'before',
  'erp-attendance-photos',
  '62000000-0000-4000-8000-000000000005/' || session.session_id::text || '/' ||
    point.work_point_id::text || '/74000000-0000-4000-8000-000000000089/after',
  'malformed-pending.jpg', 'image/jpeg', 1, 'pending'
from public.project_attendance_work_points point
join public.project_attendance_sessions session on session.session_id = point.session_id
where point.session_id = '71000000-0000-4000-8000-000000000098'
  and point.ordinal = 2;
insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
)
select
  '74000000-0000-4000-8000-000000000090', point.work_point_id, 'after',
  'erp-attendance-photos',
  '62000000-0000-4000-8000-000000000001/' || session.session_id::text || '/' ||
    point.work_point_id::text || '/74000000-0000-4000-8000-000000000090/after',
  'malformed-active.jpg', 'image/jpeg', 1, 'active'
from public.project_attendance_work_points point
join public.project_attendance_sessions session on session.session_id = point.session_id
where point.session_id = '71000000-0000-4000-8000-000000000098'
  and point.ordinal = 3;
insert into attendance_photo_results values
  (
    'malformed_pending_path',
    jsonb_build_object(
      'objectPath', (select object_path from public.project_attendance_photos
                     where photo_id = '74000000-0000-4000-8000-000000000089')
    )
  ),
  (
    'malformed_active_path',
    jsonb_build_object(
      'objectPath', (select object_path from public.project_attendance_photos
                     where photo_id = '74000000-0000-4000-8000-000000000090')
    )
  );
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results
     where result_name = 'malformed_pending_path')
  ),
  false,
  'upload predicate rejects a persisted pending row with a mismatched path segment'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results
     where result_name = 'malformed_active_path')
  ),
  false,
  'view predicate rejects a persisted active row with a mismatched path segment'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'after', 'after.jpg', 'image/jpeg', 1, null, null
  ) $$,
  '55000', null, 'after cannot be reserved before an active before photo'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'empty.jpg', 'image/jpeg', 0, null, null
  ) $$,
  '22023', null, 'zero-byte photo is rejected'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'too-large.jpg', 'image/jpeg', 20971521, null, null
  ) $$,
  '22023', null, '20 MiB plus one byte is rejected'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'bad.jpg', 'image/jpg', 1, null, null
  ) $$,
  '22023', null, 'noncanonical image MIME is rejected'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'during', 'bad.jpg', 'image/jpeg', 1, null, null
  ) $$,
  '22023', null, 'noncanonical photo phase is rejected'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', E'bad\nname.jpg', 'image/jpeg', 1, null, null
  ) $$,
  '22023', null, 'control characters in original filename are rejected'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'bad.jpg', 'image/jpeg', 1, repeat('a', 65), null
  ) $$,
  '22023', null, '65-character checksum is rejected'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'bad.jpg', 'image/jpeg', 1, repeat('A', 64), null
  ) $$,
  '22023', null, 'uppercase checksum is rejected'
);

select lives_ok(
  $$ with reservation as (
       select public.reserve_attendance_photo_secure(
         pg_temp.attendance_work_point_id(
           pg_temp.attendance_session_id('boundary_first'), 1
         ),
         'before', 'mime.jpg', 'image/jpeg', 1, null, null
       ) payload
     )
     select public.abandon_attendance_photo_secure((payload->>'photoId')::uuid)
     from reservation $$,
  'image/jpeg is accepted exactly'
);
select lives_ok(
  $$ with reservation as (
       select public.reserve_attendance_photo_secure(
         pg_temp.attendance_work_point_id(
           pg_temp.attendance_session_id('boundary_first'), 1
         ),
         'before', 'mime.png', 'image/png', 1, null, null
       ) payload
     )
     select public.abandon_attendance_photo_secure((payload->>'photoId')::uuid)
     from reservation $$,
  'image/png is accepted exactly'
);
select lives_ok(
  $$ with reservation as (
       select public.reserve_attendance_photo_secure(
         pg_temp.attendance_work_point_id(
           pg_temp.attendance_session_id('boundary_first'), 1
         ),
         'before', 'mime.webp', 'image/webp', 1, null, null
       ) payload
     )
     select public.abandon_attendance_photo_secure((payload->>'photoId')::uuid)
     from reservation $$,
  'image/webp is accepted exactly'
);
select lives_ok(
  $$ with reservation as (
       select public.reserve_attendance_photo_secure(
         pg_temp.attendance_work_point_id(
           pg_temp.attendance_session_id('boundary_first'), 1
         ),
         'before', 'mime.heic', 'image/heic', 1, null, null
       ) payload
     )
     select public.abandon_attendance_photo_secure((payload->>'photoId')::uuid)
     from reservation $$,
  'image/heic is accepted exactly'
);
select lives_ok(
  $$ with reservation as (
       select public.reserve_attendance_photo_secure(
         pg_temp.attendance_work_point_id(
           pg_temp.attendance_session_id('boundary_first'), 1
         ),
         'before', 'mime.heif', 'image/heif', 1, null, null
       ) payload
     )
     select public.abandon_attendance_photo_secure((payload->>'photoId')::uuid)
     from reservation $$,
  'image/heif is accepted exactly'
);

insert into attendance_photo_results values (
  'before_pending',
  public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', '原始.jpg', 'image/jpeg', 1, repeat('a', 64), '2026-07-15T08:00:00Z'
  )
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'duplicate.jpg', 'image/jpeg', 1, null, null
  ) $$,
  '55000', null, 'an existing pending phase reservation is rejected'
);
select is(
  (select payload->>'bucketId' from attendance_photo_results where result_name = 'before_pending'),
  'erp-attendance-photos',
  'reservation uses the private attendance bucket'
);
select matches(
  (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/before$',
  'reservation path contains only server UUID segments and phase'
);
select is(
  split_part(
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
    '/', 1
  ),
  '62000000-0000-4000-8000-000000000001',
  'reservation path actor segment is the authoritative employee profile ID'
);
select is(
  split_part(
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
    '/', 2
  ),
  pg_temp.attendance_session_id('boundary_first')::text,
  'reservation path session segment is authoritative'
);
select is(
  split_part(
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
    '/', 3
  ),
  pg_temp.attendance_work_point_id(
    pg_temp.attendance_session_id('boundary_first'), 1
  )::text,
  'reservation path work-point segment is authoritative'
);
select is(
  split_part(
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
    '/', 4
  ),
  (select payload->>'photoId' from attendance_photo_results where result_name = 'before_pending'),
  'reservation path photo segment is the server-returned photo ID'
);
select is(
  split_part(
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending'),
    '/', 5
  ),
  (select payload->>'phase' from attendance_photo_results where result_name = 'before_pending'),
  'reservation path phase segment is authoritative'
);
select ok(
  (select payload->>'objectPath' not like '%原始%'
     and payload->>'objectPath' not like '%零模块普通员工%'
     and payload->>'objectPath' not like '%合法现场%'
   from attendance_photo_results where result_name = 'before_pending'),
  'reservation path excludes original filename and human names'
);
select ok(
  (select (select count(*) from jsonb_object_keys(payload)) = 11
     and payload ?& array[
       'photoId','workPointId','phase','bucketId','objectPath','originalFileName',
       'contentType','sizeBytes','uploadStatus','capturedAt','createdAt'
     ]::text[]
   from attendance_photo_results where result_name = 'before_pending'),
  'reservation returns the exact photo DTO'
);
select is(
  public.get_my_today_attendance_secure()#>>'{pendingPhotoReservations,0,photoId}',
  (select payload->>'photoId' from attendance_photo_results where result_name = 'before_pending'),
  'page reload recovers the owner pending reservation for retry or abandon'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending')
  ),
  true,
  'owner can upload the exact pending object'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos', 'guessed/path'
  ),
  false,
  'guessed path is denied'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'another-bucket',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending')
  ),
  false,
  'wrong bucket is denied'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending')
  ),
  false,
  'pending photo is never viewable'
);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'finalize fails while the Storage object is absent'
);
reset role;

set local role service_role;
insert into storage.buckets(id, name, public)
values ('task6-wrong-bucket', 'task6-wrong-bucket', false);
insert into storage.objects(bucket_id, name, metadata)
select
  'task6-wrong-bucket', payload->>'objectPath',
  jsonb_build_object('size', 1, 'mimetype', 'image/jpeg')
from attendance_photo_results
where result_name = 'before_pending';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'finalize rejects a same-path object in the wrong bucket'
);
select is(
  pg_temp.attendance_photo_status(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ),
  'pending',
  'wrong-bucket finalize leaves the reservation pending'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_pending')
  ),
  false,
  'another employee cannot upload the pending object'
);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'other.jpg', 'image/jpeg', 1, null, null
  ) $$,
  '42501', null, 'another employee cannot reserve a photo on the point'
);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '42501', null, 'another employee cannot finalize the pending object'
);
select throws_ok(
  $$ select public.abandon_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '42501', null, 'another employee cannot abandon the pending object'
);
reset role;

set local role service_role;
insert into storage.objects(bucket_id, name, metadata)
select
  payload->>'bucketId', payload->>'objectPath',
  jsonb_build_object('size', 2, 'mimetype', 'image/jpeg')
from attendance_photo_results
where result_name = 'before_pending';
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'finalize rejects mismatched Storage size metadata'
);
select is(
  pg_temp.attendance_photo_status(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ),
  'pending',
  'failed finalize leaves the reservation pending'
);
reset role;

update storage.objects
set metadata = '{}'::jsonb
where bucket_id = 'erp-attendance-photos'
  and name = (select payload->>'objectPath'
              from attendance_photo_results where result_name = 'before_pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'finalize rejects missing Storage metadata'
);
select is(
  pg_temp.attendance_photo_status(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ),
  'pending',
  'missing metadata leaves the reservation pending'
);
reset role;

update storage.objects
set metadata = jsonb_build_object('size', 'not-a-number', 'mimetype', 'image/jpeg')
where bucket_id = 'erp-attendance-photos'
  and name = (select payload->>'objectPath'
              from attendance_photo_results where result_name = 'before_pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'finalize rejects non-numeric Storage size metadata'
);
select is(
  pg_temp.attendance_photo_status(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ),
  'pending',
  'invalid metadata leaves the reservation pending'
);
reset role;

update storage.objects
set metadata = jsonb_build_object('size', 1, 'mimetype', 'image/png')
where bucket_id = 'erp-attendance-photos'
  and name = (select payload->>'objectPath'
              from attendance_photo_results where result_name = 'before_pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'finalize rejects mismatched Storage MIME metadata'
);
reset role;

update storage.objects
set metadata = jsonb_build_object('size', 1, 'mimetype', 'image/jpeg')
where bucket_id = 'erp-attendance-photos'
  and name = (select payload->>'objectPath'
              from attendance_photo_results where result_name = 'before_pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_photo_results values (
  'before_active',
  public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  )
);
select is(
  (select payload->>'uploadStatus' from attendance_photo_results where result_name = 'before_active'),
  'active',
  'finalize makes the uploaded before photo active'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_active')
  ),
  false,
  'active photo path is no longer upload-authorized'
);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_pending')
  ) $$,
  '55000', null, 'an active photo cannot be finalized twice'
);
select lives_ok(
  $$ insert into attendance_photo_results values (
       'after_pending',
       public.reserve_attendance_photo_secure(
         pg_temp.attendance_work_point_id(
           pg_temp.attendance_session_id('boundary_first'), 1
         ),
         'after', 'after.jpg', 'image/jpeg', 20971520, null, null
       )
     ) $$,
  'after reservation accepts the exact 20 MiB boundary after before is active'
);
reset role;

set local role service_role;
insert into storage.objects(bucket_id, name, metadata)
select
  payload->>'bucketId', payload->>'objectPath',
  jsonb_build_object('size', 20971520, 'contentType', 'image/jpeg')
from attendance_photo_results
where result_name = 'after_pending';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_photo_results values (
  'after_active',
  public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'after_pending')
  )
);
insert into attendance_photo_results values (
  'before_replacement_pending',
  public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'before', 'replacement.jpg', 'image/jpeg', 1, null, null
  )
);
reset role;

set local role service_role;
insert into storage.objects(bucket_id, name, metadata)
select
  payload->>'bucketId', payload->>'objectPath',
  jsonb_build_object('size', 1, 'mimetype', 'image/jpeg')
from attendance_photo_results
where result_name = 'before_replacement_pending';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_photo_results values (
  'before_replacement_active',
  public.finalize_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'before_replacement_pending')
  )
);
select is(
  pg_temp.attendance_photo_phase_status_count(
    pg_temp.attendance_session_id('boundary_first'), 'before', 'active'
  ),
  1,
  'replacement leaves one active before photo'
);
select is(
  pg_temp.attendance_photo_phase_status_count(
    pg_temp.attendance_session_id('boundary_first'), 'before', 'superseded'
  ),
  1,
  'replacement supersedes the prior active before photo'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_active')
  ),
  false,
  'superseded photo is never viewable'
);
insert into attendance_photo_results values (
  'after_abandon_pending',
  public.reserve_attendance_photo_secure(
    pg_temp.attendance_work_point_id(
      pg_temp.attendance_session_id('boundary_first'), 1
    ),
    'after', 'abandon.jpg', 'image/jpeg', 1, null, null
  )
);
reset role;

set local role service_role;
insert into storage.objects(bucket_id, name, metadata)
select
  payload->>'bucketId', payload->>'objectPath',
  jsonb_build_object('size', 1, 'mimetype', 'image/jpeg')
from attendance_photo_results
where result_name = 'after_abandon_pending';
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is(
  public.abandon_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'after_abandon_pending')
  )->>'uploadStatus',
  'cleanup_pending',
  'abandon records cleanup state'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'after_abandon_pending')
  ),
  false,
  'cleanup-pending photo is never viewable'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'after_abandon_pending')
  ),
  false,
  'cleanup-pending photo path is no longer upload-authorized'
);
select throws_ok(
  $$ select public.abandon_attendance_photo_secure(
    (select (payload->>'photoId')::uuid
     from attendance_photo_results where result_name = 'after_abandon_pending')
  ) $$,
  '55000', null, 'cleanup-pending photo cannot be abandoned twice'
);
reset role;
select is(
  (select count(*)::integer
   from storage.objects
   where bucket_id = 'erp-attendance-photos'
     and name = (select payload->>'objectPath'
                 from attendance_photo_results where result_name = 'after_abandon_pending')),
  1,
  'abandon never deletes the Storage object in SQL'
);

insert into public.project_attendance_work_points(
  work_point_id, session_id, ordinal, area_name, work_description, completion_note
) values (
  '73000000-0000-4000-8000-000000000099',
  '71000000-0000-4000-8000-000000000099',
  1, '关闭点位', '关闭施工', ''
);
insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
) values (
  '74000000-0000-4000-8000-000000000099',
  '73000000-0000-4000-8000-000000000099',
  'before', 'erp-attendance-photos', 'closed/session99/before',
  'before.jpg', 'image/jpeg', 1, 'pending'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$ select public.reserve_attendance_photo_secure(
    '73000000-0000-4000-8000-000000000099',
    'after', 'after.jpg', 'image/jpeg', 1, null, null
  ) $$,
  '55000', null, 'closed session rejects photo reservation'
);
select throws_ok(
  $$ select public.finalize_attendance_photo_secure(
    '74000000-0000-4000-8000-000000000099'
  ) $$,
  '55000', null, 'closed session rejects photo finalize'
);
select throws_ok(
  $$ select public.abandon_attendance_photo_secure(
    '74000000-0000-4000-8000-000000000099'
  ) $$,
  '55000', null, 'closed session rejects photo abandon'
);
select is(
  public.can_current_employee_upload_attendance_photo(
    'erp-attendance-photos', 'closed/session99/before'
  ),
  false,
  'closed session cannot authorize upload'
);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  true,
  'session owner can view the session'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'session owner can view an active photo'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  false,
  'unrelated employee cannot view an active photo'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000006', true);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'current site assignee can view an active project photo'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000007', true);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  false,
  'former site assignee cannot view an active project photo'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000008', true);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'president can view an active photo'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000009', true);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath' from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'SW-000 can view an active photo'
);
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000002', true);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  false,
  'inactive employee receives a false Storage authorization result'
);
reset role;

insert into public.project_attendance_work_points(
  work_point_id, session_id, ordinal, area_name, work_description, completion_note
) values
  (
    '64000000-0000-4000-8000-000000000001',
    (select (payload#>>'{session,sessionId}')::uuid from attendance_clock_results where result_name = 'boundary_first'),
    7, '恢复点位', '恢复施工', ''
  ),
  (
    '64000000-0000-4000-8000-000000000002',
    (select (payload#>>'{session,sessionId}')::uuid from attendance_clock_results where result_name = 'abnormal_other'),
    1, '入口', '封闭确认', ''
  );

insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path,
  original_file_name, content_type, size_bytes, upload_status
) values
  ('65000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','before','erp-attendance-photos','attendance/ordinary/before-pending','before.jpg','image/jpeg',100,'pending'),
  ('65000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001','after','erp-attendance-photos','attendance/ordinary/after-active','after.jpg','image/jpeg',100,'active'),
  ('65000000-0000-4000-8000-000000000003','64000000-0000-4000-8000-000000000002','before','erp-attendance-photos','attendance/other/before-pending','other.jpg','image/jpeg',100,'pending');

insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at, closed_at
) values
  ('66000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','SW-6101','零模块普通员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',35.681236,139.767125,300,timezone('Asia/Tokyo',statement_timestamp())::date,'closed',statement_timestamp() - interval '2 hours',statement_timestamp() - interval '1 hour'),
  ('66000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000001','SW-6101','零模块普通员工','ATT-ELIGIBLE','合法现场','東京都 千代田区 1-1',35.681236,139.767125,300,timezone('Asia/Tokyo',statement_timestamp())::date - 1,'closed',statement_timestamp() - interval '26 hours',statement_timestamp() - interval '25 hours');

update public.project_attendance_sessions
set work_date = timezone('Asia/Tokyo',statement_timestamp())::date - 2
where employee_profile_id = '62000000-0000-4000-8000-000000000001'
  and status = 'open';

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_today_results values (
  'ordinary_recovery', public.get_my_today_attendance_secure()
);
select is(
  (select payload#>>'{activeSession,sessionId}' from attendance_today_results where result_name = 'ordinary_recovery'),
  (select payload#>>'{session,sessionId}' from attendance_clock_results where result_name = 'boundary_first'),
  'today recovery returns an open session even when its work date is older'
);
select is(
  (select jsonb_array_length(payload->'completedSessions') from attendance_today_results where result_name = 'ordinary_recovery'),
  1,
  'today recovery returns only completed sessions from the Tokyo server date'
);
select is(
  (select jsonb_array_length(payload->'pendingPhotoReservations') from attendance_today_results where result_name = 'ordinary_recovery'),
  1,
  'today recovery returns only the actor pending photos under the open session'
);
select is(
  (select payload#>>'{pendingPhotoReservations,0,photoId}' from attendance_today_results where result_name = 'ordinary_recovery'),
  '65000000-0000-4000-8000-000000000001',
  'pending photo recovery never leaks another employee reservation'
);
select ok(
  (select (select count(*) from jsonb_object_keys(payload#>'{pendingPhotoReservations,0}')) = 11
     and (payload#>'{pendingPhotoReservations,0}') ?& array[
       'photoId','workPointId','phase','bucketId','objectPath','originalFileName',
       'contentType','sizeBytes','uploadStatus','capturedAt','createdAt'
     ]::text[]
   from attendance_today_results where result_name = 'ordinary_recovery'),
  'pending reservation uses the exact photo DTO'
);
select is(
  (select payload#>'{activeSession,workPoints,1,photos,before}' from attendance_today_results where result_name = 'ordinary_recovery'),
  'null'::jsonb,
  'record-manager work-point projection excludes pending photos'
);
select is(
  (select payload#>>'{activeSession,workPoints,1,photos,after,uploadStatus}' from attendance_today_results where result_name = 'ordinary_recovery'),
  'active',
  'record-manager work-point projection includes the active phase photo'
);
reset role;

update public.project_attendance_sessions
set work_date = timezone('Asia/Tokyo', statement_timestamp())::date
where session_id = pg_temp.attendance_session_id('boundary_first');

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000010',
  'authenticated', 'authenticated', 'attendance-incomplete@auth.invalid', '', now(),
  '{}', '{}', now(), now()
);
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password, is_hidden_system_account
) values (
  '62000000-0000-4000-8000-000000000010', 'SW-6110',
  '61000000-0000-4000-8000-000000000010', '不完整点位员工', '工程部', '小工',
  '在职', 'active', false, false
);
insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at
) values (
  '71000000-0000-4000-8000-000000000096',
  '62000000-0000-4000-8000-000000000010',
  'SW-6110', '不完整点位员工', 'ATT-ELIGIBLE-OTHER', '另一个合法现场',
  '東京都 千代田区 1-1', 35.681236, 139.767125, 300,
  '2026-07-15', 'open', '2026-07-15T08:00:00Z'
);
insert into public.project_attendance_work_points(
  work_point_id, session_id, ordinal, area_name, work_description, completion_note
) values
  (
    '73000000-0000-4000-8000-000000000081',
    '71000000-0000-4000-8000-000000000096', 1, '', '区域为空但施工完整', ''
  ),
  (
    '73000000-0000-4000-8000-000000000082',
    '71000000-0000-4000-8000-000000000096', 2, '说明为空区域', '', ''
  ),
  (
    '73000000-0000-4000-8000-000000000083',
    '71000000-0000-4000-8000-000000000096', 3, '前照待定区域', '施工完整', ''
  ),
  (
    '73000000-0000-4000-8000-000000000084',
    '71000000-0000-4000-8000-000000000096', 4, '后照待定区域', '施工完整', ''
  );
insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
) values
  ('74000000-0000-4000-8000-000000000081','73000000-0000-4000-8000-000000000081','before','erp-attendance-photos','fixture/incomplete/blank-area/before','before.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000082','73000000-0000-4000-8000-000000000081','after','erp-attendance-photos','fixture/incomplete/blank-area/after','after.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000083','73000000-0000-4000-8000-000000000082','before','erp-attendance-photos','fixture/incomplete/blank-description/before','before.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000084','73000000-0000-4000-8000-000000000082','after','erp-attendance-photos','fixture/incomplete/blank-description/after','after.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000085','73000000-0000-4000-8000-000000000083','before','erp-attendance-photos','fixture/incomplete/pending-before/before','before.jpg','image/jpeg',1,'pending'),
  ('74000000-0000-4000-8000-000000000086','73000000-0000-4000-8000-000000000083','after','erp-attendance-photos','fixture/incomplete/pending-before/after','after.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000087','73000000-0000-4000-8000-000000000084','before','erp-attendance-photos','fixture/incomplete/pending-after/before','before.jpg','image/jpeg',1,'active'),
  ('74000000-0000-4000-8000-000000000088','73000000-0000-4000-8000-000000000084','after','erp-attendance-photos','fixture/incomplete/pending-after/after','after.jpg','image/jpeg',1,'pending');
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000010', true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000096',
    '75000000-0000-4000-8000-000000000006',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '55000', null,
  'no point is complete when each independently misses one required clause'
);
reset role;

insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
) values
  (
    '74000000-0000-4000-8000-000000000091',
    (select work_point_id from public.project_attendance_work_points
     where session_id = '71000000-0000-4000-8000-000000000098' and ordinal = 1),
    'before', 'erp-attendance-photos', 'pending/session98/before',
    'before.jpg', 'image/jpeg', 1, 'pending'
  ),
  (
    '74000000-0000-4000-8000-000000000092',
    (select work_point_id from public.project_attendance_work_points
     where session_id = '71000000-0000-4000-8000-000000000098' and ordinal = 1),
    'after', 'erp-attendance-photos', 'pending/session98/after',
    'after.jpg', 'image/jpeg', 1, 'pending'
  );
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000098',
    '75000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '55000', null, 'pending photos do not satisfy the complete-point requirement'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select public.upsert_attendance_work_point_secure(
  pg_temp.attendance_session_id('boundary_first'), 2::smallint, '未完成区域', '', ''
);
reset role;

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
update public.projects set payload = payload || jsonb_build_object(
  'latitude', 34.0, 'longitude', 135.0, 'attendanceRadiusMeters', 50
) where record_key = 'ATT-ELIGIBLE';
reset role;

create temporary table attendance_clock_out_results(
  result_name text primary key,
  payload jsonb not null
) on commit drop;
grant select, insert on attendance_clock_out_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_clock_out_results values (
  'first',
  public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000002',
    35.681236, 139.767125, 300, '2026-07-15T08:30:00Z', null
  )
);
insert into attendance_clock_out_results values (
  'retry',
  public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000002',
    35.681236, 139.767125, 300, null, null
  )
);
select is(
  (select payload#>>'{session,status}'
   from attendance_clock_out_results where result_name = 'first'),
  'closed',
  'one complete point closes the session despite incomplete point two'
);
select is(
  (select payload#>>'{event,result}'
   from attendance_clock_out_results where result_name = 'first'),
  'normal',
  'clock-out uses the original session snapshot and equality boundary'
);
select is(
  (select (payload#>>'{event,latitude}')::double precision
   from attendance_clock_out_results where result_name = 'first'),
  35.681236::double precision,
  'clock-out event stores the exact submitted latitude'
);
select is(
  (select (payload#>>'{event,longitude}')::double precision
   from attendance_clock_out_results where result_name = 'first'),
  139.767125::double precision,
  'clock-out event stores the exact submitted longitude'
);
select is(
  (select (payload#>>'{event,accuracyMeters}')::numeric
   from attendance_clock_out_results where result_name = 'first'),
  300::numeric,
  'clock-out event stores the exact submitted accuracy'
);
select is(
  (select (payload#>>'{event,deviceRecordedAt}')::timestamptz
   from attendance_clock_out_results where result_name = 'first'),
  '2026-07-15T08:30:00Z'::timestamptz,
  'clock-out event stores the exact submitted device timestamp'
);
select is(
  (select payload#>>'{event,eventId}'
   from attendance_clock_out_results where result_name = 'first'),
  (select payload#>>'{event,eventId}'
   from attendance_clock_out_results where result_name = 'retry'),
  'clock-out request retry returns the same event'
);
select is(
  (select payload#>>'{session,closedAt}'
   from attendance_clock_out_results where result_name = 'first'),
  (select payload#>>'{event,serverRecordedAt}'
   from attendance_clock_out_results where result_name = 'first'),
  'session closes at the immutable clock-out server timestamp'
);
select throws_ok(
  $$ select public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '63000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '22023', null,
  'a clock-in request cannot be mistaken for a clock-out retry on the same session'
);
select throws_ok(
  $$ select public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000003',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '55000', null, 'a closed session cannot receive a different second clock-out event'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    pg_temp.attendance_session_id('boundary_first'),
    '75000000-0000-4000-8000-000000000002',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '22023', null,
  'another employee cannot replay a successful clock-out request or receive its DTO'
);
reset role;

insert into public.projects(record_key, payload, status) values (
  'ATT-SECOND',
  pg_temp.attendance_project_payload(
    'ATT-SECOND', '第二现场', '进行中', 300,
    '2026-07-15T00:00:00Z', '東京都 千代田区 1-1'
  ),
  'active'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
insert into attendance_clock_results values (
  'second_project',
  public.clock_in_project_secure(
    'ATT-SECOND', '75000000-0000-4000-8000-000000000005',
    35.681236, 139.767125, 1, null, null
  )
);
select is(
  (select payload#>>'{session,projectId}'
   from attendance_clock_results where result_name = 'second_project'),
  'ATT-SECOND',
  'employee can open a different project after closing the first'
);
select is(
  (select payload#>>'{session,workDate}'
   from attendance_clock_results where result_name = 'second_project'),
  (select payload#>>'{session,workDate}'
   from attendance_clock_results where result_name = 'boundary_first'),
  'sequential projects share the same Tokyo work date'
);
select throws_ok(
  $$ select public.clock_in_project_secure(
    'ATT-SECOND', '63000000-0000-4000-8000-000000000001',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '22023', null, 'a clock-in request cannot be reused for another project'
);
select throws_ok(
  $$ select public.clock_out_project_secure(
    (select (payload#>>'{session,sessionId}')::uuid
     from attendance_clock_results where result_name = 'second_project'),
    '75000000-0000-4000-8000-000000000002',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '22023', null, 'a clock-out request cannot be reused for another session'
);
reset role;

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '61000000-0000-4000-8000-000000000012',
  'authenticated', 'authenticated', 'attendance-abnormal@auth.invalid', '', now(),
  '{}', '{}', now(), now()
);
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password, is_hidden_system_account
) values (
  '62000000-0000-4000-8000-000000000012', 'SW-6112',
  '61000000-0000-4000-8000-000000000012', '异常下班员工', '工程部', '小工',
  '在职', 'active', false, false
);
insert into public.project_attendance_sessions(
  session_id, employee_profile_id, employee_number_snapshot, employee_name_snapshot,
  project_id, project_name_snapshot, project_address_snapshot,
  project_latitude_snapshot, project_longitude_snapshot,
  attendance_radius_meters_snapshot, work_date, status, opened_at
) values (
  '71000000-0000-4000-8000-000000000097',
  '62000000-0000-4000-8000-000000000012',
  'SW-6112', '异常下班员工', 'ATT-ELIGIBLE', '合法现场', '東京都 千代田区 1-1',
  35.681236, 139.767125, 300, '2026-07-15', 'open', '2026-07-15T08:00:00Z'
);
insert into public.project_attendance_work_points(
  work_point_id, session_id, ordinal, area_name, work_description, completion_note
) values (
  '73000000-0000-4000-8000-000000000097',
  '71000000-0000-4000-8000-000000000097',
  1, '完整点位', '完成施工', ''
);
insert into public.project_attendance_photos(
  photo_id, work_point_id, phase, bucket_id, object_path, original_file_name,
  content_type, size_bytes, upload_status
) values
  (
    '74000000-0000-4000-8000-000000000097',
    '73000000-0000-4000-8000-000000000097',
    'before', 'erp-attendance-photos', 'fixture/session97/before',
    'before.jpg', 'image/jpeg', 1, 'active'
  ),
  (
    '74000000-0000-4000-8000-000000000098',
    '73000000-0000-4000-8000-000000000097',
    'after', 'erp-attendance-photos', 'fixture/session97/after',
    'after.jpg', 'image/jpeg', 1, 'active'
  );
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000097',
    '75000000-0000-4000-8000-000000000007',
    35.681236, 139.767125, 1, null, null
  ) $$,
  '42501', null,
  'another employee cannot clock out a complete open session with a fresh request'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000012', true);
select throws_ok(
  $$ select public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000097',
    '75000000-0000-4000-8000-000000000004',
    35.681236, 139.767125, 300.001, null, null
  ) $$,
  '22023', null, 'out-of-range clock-out requires an abnormal reason'
);
select is(
  public.clock_out_project_secure(
    '71000000-0000-4000-8000-000000000097',
    '75000000-0000-4000-8000-000000000004',
    35.681236, 139.767125, 300.001, null, E'\t 临时封路 \n'
  )#>>'{event,abnormalReason}',
  '临时封路',
  'out-of-range clock-out stores a trimmed reason'
);
reset role;

update public.projects
set status = 'void'
where record_key = 'ATT-ELIGIBLE';

set local role authenticated;
select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000006', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'own',
  'voiding the assigned project removes current-assignee scoped access'
);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  false,
  'current assignee cannot view a session through a void project envelope'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  false,
  'current assignee cannot view an active photo through a void project envelope'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000007', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'own',
  'former assignee remains limited to own scope after project void'
);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  false,
  'former assignee cannot view a session through a void project envelope'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  false,
  'former assignee cannot view an active photo through a void project envelope'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000001', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'own',
  'session owner keeps the distinct own-scope branch after project void'
);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  true,
  'session owner retains session access after project void'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'session owner retains active-photo access after project void'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000008', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'all',
  'active president keeps the distinct all-scope branch after project void'
);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  true,
  'active president retains session access after project void'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'active president retains active-photo access after project void'
);

select set_config('request.jwt.claim.sub', '61000000-0000-4000-8000-000000000009', true);
select is(
  public.get_my_today_attendance_secure()#>>'{viewerAccess,scope}',
  'all',
  'SW-000 keeps the distinct all-scope branch after project void'
);
select is(
  public.can_current_employee_view_attendance_session(
    pg_temp.attendance_session_id('boundary_first')
  ),
  true,
  'SW-000 retains session access after project void'
);
select is(
  public.can_current_employee_view_attendance_photo(
    'erp-attendance-photos',
    (select payload->>'objectPath'
     from attendance_photo_results where result_name = 'before_replacement_active')
  ),
  true,
  'SW-000 retains active-photo access after project void'
);
reset role;

select * from finish();
rollback;

begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = pg_temp, public, auth, extensions;

select no_plan();

create or replace function pg_temp.session_waits_on_lock(
  p_blocked_pid integer,
  p_blocker_pid integer,
  p_require_advisory boolean default false
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $function$
begin
  perform pg_catalog.pg_stat_clear_snapshot();
  return coalesce(
    (
      select activity.wait_event_type = 'Lock'
        and p_blocker_pid = any(pg_catalog.pg_blocking_pids(p_blocked_pid))
        and (
          not p_require_advisory
          or activity.wait_event = 'advisory'
        )
      from pg_catalog.pg_stat_activity as activity
      where activity.pid = p_blocked_pid
    ),
    false
  );
end;
$function$;

create or replace function pg_temp.session_holds_purchase_key(
  p_pid integer,
  p_record_key text
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $function$
declare
  lock_key bigint;
begin
  lock_key := pg_catalog.hashtextextended(
    'public.purchase_records:' || p_record_key,
    0
  );
  perform pg_catalog.pg_stat_clear_snapshot();
  return exists (
    select 1
    from pg_catalog.pg_locks as held_lock
    where held_lock.pid = p_pid
      and held_lock.locktype = 'advisory'
      and held_lock.granted
      and held_lock.objsubid = 1
      and held_lock.classid::bigint = (
        (lock_key >> 32) & 4294967295::bigint
      )
      and held_lock.objid::bigint = (
        lock_key & 4294967295::bigint
      )
  );
end;
$function$;

select has_function(
  'private',
  'purchase_payment_payload_keys',
  array[]::text[],
  'purchase payment projection key helper exists'
);
select has_function(
  'private',
  'purchase_client_audit_payload_keys',
  array[]::text[],
  'purchase client audit rejection key helper exists'
);
select has_function(
  'private',
  'purchase_payload_has_unsafe_keys',
  array['jsonb'],
  'recursive unsafe purchase payload key helper exists'
);
select has_function(
  'private',
  'lock_purchase_record_key',
  array['text'],
  'purchase record advisory lock helper exists'
);
select has_function(
  'private',
  'require_purchase_read_committed',
  array[]::text[],
  'purchase mutation isolation guard exists'
);
select has_function(
  'private',
  'guard_purchase_records_direct_write',
  array[]::text[],
  'purchase direct-write trigger guard exists'
);
select has_function(
  'private',
  'guard_purchase_parent_write',
  array[]::text[],
  'purchase parent integrity trigger guard exists'
);
select has_function(
  'private',
  'guard_purchase_parent_truncate',
  array[]::text[],
  'purchase parent TRUNCATE guard exists'
);
select has_function(
  'private',
  'guard_purchase_link_fact_write',
  array[]::text[],
  'purchase linked-fact write guard exists'
);
select has_function(
  'public',
  'list_purchase_records_secure',
  array[]::text[],
  'secure purchase list RPC exists'
);
select has_function(
  'public',
  'upsert_purchase_record_secure',
  array['text', 'jsonb', 'text'],
  'secure purchase upsert RPC exists'
);
select has_function(
  'public',
  'soft_delete_purchase_record_secure',
  array['text'],
  'secure purchase soft-delete RPC exists'
);
select has_function(
  'public',
  'commit_purchase_stock_in_secure',
  array['text', 'jsonb', 'text', 'jsonb', 'text', 'jsonb'],
  'transactional purchase stock-in RPC exists with the approved signature'
);

create temporary table task7_helper_results (
  helper_name text primary key,
  payload_keys text[] not null
) on commit drop;

select lives_ok(
  $$insert into pg_temp.task7_helper_results (helper_name, payload_keys)
    values ('payment', private.purchase_payment_payload_keys())$$,
  'purchase payment projection helper can be evaluated'
);
select is(
  (
    select payload_keys
    from task7_helper_results
    where helper_name = 'payment'
  ),
  array[
    'openingPaidAmount',
    'paidAmount',
    'unpaidAmount',
    'paymentStatus'
  ]::text[],
  'purchase payment projection helper returns exactly the four payment keys'
);

select lives_ok(
  $$insert into pg_temp.task7_helper_results (helper_name, payload_keys)
    values ('audit', private.purchase_client_audit_payload_keys())$$,
  'purchase client audit rejection helper can be evaluated'
);
select is(
  (
    select payload_keys
    from task7_helper_results
    where helper_name = 'audit'
  ),
  array[
    'created_by_employee_id',
    'created_by_employee_name',
    'updated_by_employee_id',
    'updated_by_employee_name',
    'createdByEmployeeId',
    'createdByEmployeeName',
    'updatedByEmployeeId',
    'updatedByEmployeeName'
  ]::text[],
  'purchase client audit rejection helper returns exactly the eight audit keys'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'list_purchase_records_secure',
        'upsert_purchase_record_secure',
        'soft_delete_purchase_record_secure',
        'commit_purchase_stock_in_secure'
      )
      and procedure.prosecdef
      and procedure.proconfig =
        array['search_path=pg_catalog, public, private']::text[]
  ),
  4::bigint,
  'all purchase RPCs are security definer functions with a pinned search path'
);

select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'public'
      and routine_name in (
        'list_purchase_records_secure',
        'upsert_purchase_record_secure',
        'soft_delete_purchase_record_secure',
        'commit_purchase_stock_in_secure'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  8::bigint,
  'purchase RPC execution is granted only to authenticated and service_role'
);

select is(
  (
    select count(*)
    from information_schema.routine_privileges
    where specific_schema = 'private'
      and routine_name in (
        'purchase_payment_payload_keys',
        'purchase_client_audit_payload_keys',
        'purchase_payload_has_unsafe_keys',
        'require_purchase_read_committed',
        'lock_purchase_record_key',
        'guard_purchase_records_direct_write',
        'guard_purchase_parent_write',
        'guard_purchase_parent_truncate',
        'guard_purchase_link_fact_write'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
      and privilege_type = 'EXECUTE'
  ),
  0::bigint,
  'private purchase helpers expose no execution grant to browser or service roles'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_records_direct_write'
      and not procedure.prosecdef
      and procedure.proconfig = array['search_path=pg_catalog']::text[]
  ),
  1::bigint,
  'purchase direct-write guard is SECURITY INVOKER with a pinned pg_catalog path'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'require_purchase_read_committed'
      and not procedure.prosecdef
      and procedure.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%transaction_isolation%read committed%'
  ),
  1::bigint,
  'the purchase isolation guard rejects snapshot-isolated mutations'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'lock_purchase_record_key'
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%private.require_purchase_read_committed%'
  ),
  1::bigint,
  'the per-purchase lock helper always applies the isolation guard before locking'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_parent_write'
      and procedure.prosecdef
      and procedure.proconfig =
        array['search_path=pg_catalog, public, private']::text[]
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%private.lock_purchase_record_key%'
  ),
  1::bigint,
  'parent integrity guard is pinned, privileged, and uses the shared purchase lock'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname = 'purchase_records'
      and trigger.tgname = 'block_purchase_records_direct_write'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 31
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_records_direct_write'
  ),
  1::bigint,
  'purchase_records has one enabled row-level BEFORE INSERT/UPDATE/DELETE guard'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname = 'purchase_records'
      and trigger.tgname = 'guard_purchase_parent_links'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 27
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_parent_write'
  ),
  1::bigint,
  'purchase parent integrity runs only after UPDATE/DELETE has locked a tuple'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname = 'purchase_records'
      and trigger.tgname = 'block_purchase_parent_truncate'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 34
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_parent_truncate'
  ),
  1::bigint,
  'purchase_records unconditionally blocks statement-level TRUNCATE'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_link_fact_write'
      and procedure.prosecdef
      and procedure.proconfig =
        array['search_path=pg_catalog, public, private']::text[]
      and pg_catalog.pg_get_functiondef(procedure.oid)
        like '%private.lock_purchase_record_key%'
  ),
  1::bigint,
  'linked-fact guard is pinned, privileged, and uses the shared purchase lock'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname in ('purchase_payment_records', 'stock_in_records')
      and trigger.tgname = 'guard_active_purchase_link'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 27
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_link_fact_write'
  ),
  2::bigint,
  'payment and stock-in UPDATE/DELETE guards run after tuple locking'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_trigger as trigger
    join pg_catalog.pg_class as relation
      on relation.oid = trigger.tgrelid
    join pg_catalog.pg_namespace as relation_namespace
      on relation_namespace.oid = relation.relnamespace
    join pg_catalog.pg_proc as procedure
      on procedure.oid = trigger.tgfoid
    join pg_catalog.pg_namespace as procedure_namespace
      on procedure_namespace.oid = procedure.pronamespace
    where relation_namespace.nspname = 'public'
      and relation.relname in ('purchase_payment_records', 'stock_in_records')
      and trigger.tgname = 'guard_active_purchase_link_insert'
      and not trigger.tgisinternal
      and trigger.tgenabled = 'O'
      and trigger.tgtype = 7
      and procedure_namespace.nspname = 'private'
      and procedure.proname = 'guard_purchase_link_fact_write'
  ),
  2::bigint,
  'payment and stock-in INSERT validation runs before creating a child tuple'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_records'
  ),
  3::bigint,
  'purchase_records retains its three existing direct-table RLS policies'
);
select is(
  (
    select jsonb_agg(
      jsonb_build_object(
        'policyname', policyname,
        'cmd', cmd,
        'qual', qual,
        'with_check', with_check
      )
      order by policyname
    )
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_records'
  ),
  '[
    {
      "policyname":"purchase_records authenticated insert",
      "cmd":"INSERT",
      "qual":null,
      "with_check":"(is_current_employee_active() AND has_current_permission(''module.purchases.create''::text) AND has_current_permission(''sensitive.purchase_payments_update''::text) AND (status = ''active''::text))"
    },
    {
      "policyname":"purchase_records authenticated select",
      "cmd":"SELECT",
      "qual":"(is_current_employee_active() AND has_current_permission(''module.purchases.view''::text) AND has_current_permission(''sensitive.purchase_payments_view''::text))",
      "with_check":null
    },
    {
      "policyname":"purchase_records authenticated update",
      "cmd":"UPDATE",
      "qual":"(is_current_employee_active() AND (has_current_permission(''module.purchases.update''::text) OR has_current_permission(''module.purchases.delete''::text)) AND has_current_permission(''sensitive.purchase_payments_update''::text))",
      "with_check":"(is_current_employee_active() AND (has_current_permission(''module.purchases.update''::text) OR has_current_permission(''module.purchases.delete''::text)) AND has_current_permission(''sensitive.purchase_payments_update''::text))"
    }
  ]'::jsonb,
  'purchase_records policy names, commands, qual, and with_check are exactly unchanged'
);
select ok(
  has_table_privilege('authenticated', 'public.purchase_records', 'SELECT')
    and has_table_privilege('authenticated', 'public.purchase_records', 'INSERT')
    and has_table_privilege('authenticated', 'public.purchase_records', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.purchase_records', 'DELETE')
    and not has_table_privilege('authenticated', 'public.purchase_records', 'TRUNCATE'),
  'purchase_records direct table privileges remain SELECT, INSERT, and UPDATE only'
);
select ok(
  has_table_privilege('service_role', 'public.purchase_records', 'SELECT')
    and has_table_privilege('service_role', 'public.purchase_records', 'INSERT')
    and has_table_privilege('service_role', 'public.purchase_records', 'UPDATE')
    and has_table_privilege('service_role', 'public.purchase_records', 'DELETE')
    and not has_table_privilege(
      'service_role',
      'public.purchase_records',
      'TRUNCATE'
    ),
  'service_role retains supported row writes but cannot bypass integrity via TRUNCATE'
);

create or replace function pg_temp.purchase_same_key_lock_serializes()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  lock_was_blocked boolean := false;
  released_lock_key bigint;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  if to_regprocedure('private.lock_purchase_record_key(text)') is null then
    return false;
  end if;

  perform extensions.dblink_connect(
    'task7_purchase_lock_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_purchase_lock_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_purchase_lock_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_purchase_lock_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec('task7_purchase_lock_a', 'begin');
  perform extensions.dblink_exec(
    'task7_purchase_lock_a',
    'do $remote$ begin perform private.lock_purchase_record_key(''PO-TASK7-CONCURRENCY''); end $remote$'
  );

  if extensions.dblink_send_query(
    'task7_purchase_lock_b',
    'select private.lock_purchase_record_key(''PO-TASK7-CONCURRENCY'') as lock_key'
  ) <> 1 then
    raise exception 'could not dispatch competing purchase lock query';
  end if;

  for poll_attempt in 1..100 loop
    lock_was_blocked := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      true
    );
    exit when lock_was_blocked;
    perform pg_sleep(0.01);
  end loop;
  perform extensions.dblink_exec('task7_purchase_lock_a', 'commit');

  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_purchase_lock_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_purchase_lock_b') = 1 then
    perform extensions.dblink_cancel_query('task7_purchase_lock_b');
    raise exception 'competing purchase lock query did not finish';
  end if;

  select result.lock_key
    into released_lock_key
    from extensions.dblink_get_result('task7_purchase_lock_b')
      as result(lock_key bigint);

  perform extensions.dblink_disconnect('task7_purchase_lock_a');
  perform extensions.dblink_disconnect('task7_purchase_lock_b');

  return lock_was_blocked
    and released_lock_key = hashtextextended(
      'public.purchase_records:PO-TASK7-CONCURRENCY',
      0
    );
exception when others then
  raise notice 'purchase concurrency probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_purchase_lock_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec('task7_purchase_lock_a', 'rollback');
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_purchase_lock_a');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_purchase_lock_b' = any(connection_names) then
    perform extensions.dblink_disconnect('task7_purchase_lock_b');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_same_key_lock_serializes(),
  'two real database sessions serialize on the same purchase advisory key'
);

create or replace function pg_temp.purchase_parent_delete_blocks_child_insert()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  child_was_blocked boolean := false;
  child_error text := '';
  parent_count bigint := -1;
  child_count bigint := -1;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_parent_first_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_parent_first_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_parent_first_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_parent_first_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec('task7_parent_first_a', 'set role service_role');
  perform extensions.dblink_exec('task7_parent_first_b', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_parent_first_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-PARENT-FIRST',
        '{"purchaseId":"PO-TASK7-PARENT-FIRST"}'::jsonb,
        'active'
      )
    $remote$
  );

  perform extensions.dblink_exec('task7_parent_first_a', 'begin');
  perform extensions.dblink_exec(
    'task7_parent_first_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-PARENT-FIRST'
    $remote$
  );

  if extensions.dblink_send_query(
    'task7_parent_first_b',
    $remote$
      insert into public.purchase_payment_records (
        record_key,
        payload,
        status
      ) values (
        'PP-TASK7-PARENT-FIRST',
        '{"paymentId":"PP-TASK7-PARENT-FIRST","purchaseId":"PO-TASK7-PARENT-FIRST"}'::jsonb,
        'active'
      )
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch child insert after parent delete';
  end if;

  for poll_attempt in 1..100 loop
    child_was_blocked := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      false
    );
    exit when child_was_blocked;
    perform pg_sleep(0.01);
  end loop;
  perform extensions.dblink_exec('task7_parent_first_a', 'commit');

  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_parent_first_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_parent_first_b') = 1 then
    perform extensions.dblink_cancel_query('task7_parent_first_b');
    raise exception 'parent-first child insert did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_parent_first_b', false)
      as result(record_key text);
  child_error := extensions.dblink_error_message('task7_parent_first_b');

  select result.row_count
    into parent_count
    from extensions.dblink(
      'task7_parent_first_a',
      $remote$
        select count(*)::bigint
        from public.purchase_records
        where record_key = 'PO-TASK7-PARENT-FIRST'
      $remote$
    ) as result(row_count bigint);
  select result.row_count
    into child_count
    from extensions.dblink(
      'task7_parent_first_a',
      $remote$
        select count(*)::bigint
        from public.purchase_payment_records
        where record_key = 'PP-TASK7-PARENT-FIRST'
      $remote$
    ) as result(row_count bigint);

  perform extensions.dblink_exec(
    'task7_parent_first_a',
    $remote$
      delete from public.purchase_payment_records
      where record_key = 'PP-TASK7-PARENT-FIRST'
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_parent_first_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-PARENT-FIRST'
    $remote$
  );
  perform extensions.dblink_disconnect('task7_parent_first_a');
  perform extensions.dblink_disconnect('task7_parent_first_b');

  return child_was_blocked
    and child_error like '%active purchase record required%'
    and parent_count = 0
    and child_count = 0;
exception when others then
  raise notice 'parent-first purchase race probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_parent_first_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_parent_first_b') = 1 then
        perform extensions.dblink_cancel_query('task7_parent_first_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_parent_first_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_parent_first_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_parent_first_b', false)
            as result(record_key text);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_parent_first_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_parent_first_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec('task7_parent_first_a', 'rollback', false);
      perform extensions.dblink_exec(
        'task7_parent_first_a',
        'delete from public.purchase_payment_records where record_key = ''PP-TASK7-PARENT-FIRST''',
        false
      );
      perform extensions.dblink_exec(
        'task7_parent_first_a',
        'delete from public.purchase_records where record_key = ''PO-TASK7-PARENT-FIRST''',
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_parent_first_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_parent_delete_blocks_child_insert(),
  'a real service-role parent delete serializes before and rejects a late child insert'
);

create or replace function pg_temp.purchase_child_insert_blocks_parent_delete()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  parent_was_blocked boolean := false;
  parent_error text := '';
  parent_count bigint := -1;
  child_count bigint := -1;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_child_first_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_child_first_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_child_first_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_child_first_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec('task7_child_first_a', 'set role service_role');
  perform extensions.dblink_exec('task7_child_first_b', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_child_first_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-CHILD-FIRST',
        '{"purchaseId":"PO-TASK7-CHILD-FIRST"}'::jsonb,
        'active'
      )
    $remote$
  );

  perform extensions.dblink_exec('task7_child_first_a', 'begin');
  perform extensions.dblink_exec(
    'task7_child_first_a',
    $remote$
      insert into public.stock_in_records (record_key, payload, status)
      values (
        'SI-TASK7-CHILD-FIRST',
        '{"stockInId":"SI-TASK7-CHILD-FIRST","sourcePurchaseId":"PO-TASK7-CHILD-FIRST"}'::jsonb,
        'active'
      )
    $remote$
  );

  if extensions.dblink_send_query(
    'task7_child_first_b',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-CHILD-FIRST'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch parent delete after child insert';
  end if;

  for poll_attempt in 1..100 loop
    parent_was_blocked := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      false
    );
    exit when parent_was_blocked;
    perform pg_sleep(0.01);
  end loop;
  perform extensions.dblink_exec('task7_child_first_a', 'commit');

  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_child_first_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_child_first_b') = 1 then
    perform extensions.dblink_cancel_query('task7_child_first_b');
    raise exception 'child-first parent delete did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_child_first_b', false)
      as result(record_key text);
  parent_error := extensions.dblink_error_message('task7_child_first_b');

  select result.row_count
    into parent_count
    from extensions.dblink(
      'task7_child_first_a',
      $remote$
        select count(*)::bigint
        from public.purchase_records
        where record_key = 'PO-TASK7-CHILD-FIRST'
      $remote$
    ) as result(row_count bigint);
  select result.row_count
    into child_count
    from extensions.dblink(
      'task7_child_first_a',
      $remote$
        select count(*)::bigint
        from public.stock_in_records
        where record_key = 'SI-TASK7-CHILD-FIRST'
      $remote$
    ) as result(row_count bigint);

  perform extensions.dblink_exec(
    'task7_child_first_a',
    $remote$
      delete from public.stock_in_records
      where record_key = 'SI-TASK7-CHILD-FIRST'
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_child_first_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-CHILD-FIRST'
    $remote$
  );
  perform extensions.dblink_disconnect('task7_child_first_a');
  perform extensions.dblink_disconnect('task7_child_first_b');

  return parent_was_blocked
    and parent_error like '%purchase record has linked facts%'
    and parent_count = 1
    and child_count = 1;
exception when others then
  raise notice 'child-first purchase race probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_child_first_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_child_first_b') = 1 then
        perform extensions.dblink_cancel_query('task7_child_first_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_child_first_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_child_first_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_child_first_b', false)
            as result(record_key text);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_child_first_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_child_first_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec('task7_child_first_a', 'rollback', false);
      perform extensions.dblink_exec(
        'task7_child_first_a',
        'delete from public.stock_in_records where record_key = ''SI-TASK7-CHILD-FIRST''',
        false
      );
      perform extensions.dblink_exec(
        'task7_child_first_a',
        'delete from public.purchase_records where record_key = ''PO-TASK7-CHILD-FIRST''',
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_child_first_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_child_insert_blocks_parent_delete(),
  'a real child insert serializes before and rejects a service-role parent delete'
);

create or replace function pg_temp.purchase_child_insert_blocks_parent_disable()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  parent_was_blocked boolean := false;
  parent_error text := '';
  parent_active_count bigint := -1;
  child_count bigint := -1;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_child_disable_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_child_disable_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_child_disable_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_child_disable_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec('task7_child_disable_a', 'set role service_role');
  perform extensions.dblink_exec('task7_child_disable_b', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_child_disable_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_child_disable_b',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_child_disable_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-CHILD-DISABLE',
        '{"purchaseId":"PO-TASK7-CHILD-DISABLE"}'::jsonb,
        'active'
      )
    $remote$
  );

  perform extensions.dblink_exec('task7_child_disable_a', 'begin');
  perform extensions.dblink_exec(
    'task7_child_disable_a',
    $remote$
      insert into public.stock_in_records (record_key, payload, status)
      values (
        'SI-TASK7-CHILD-DISABLE',
        '{"stockInId":"SI-TASK7-CHILD-DISABLE","sourcePurchaseId":"PO-TASK7-CHILD-DISABLE"}'::jsonb,
        'active'
      )
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_child_disable_b',
    $remote$
      update public.purchase_records
      set status = 'deleted'
      where record_key = 'PO-TASK7-CHILD-DISABLE'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch parent status downgrade';
  end if;
  for poll_attempt in 1..100 loop
    parent_was_blocked := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      false
    );
    exit when parent_was_blocked;
    perform pg_sleep(0.01);
  end loop;
  perform extensions.dblink_exec('task7_child_disable_a', 'commit');

  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_child_disable_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_child_disable_b') = 1 then
    perform extensions.dblink_cancel_query('task7_child_disable_b');
    raise exception 'parent status downgrade did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_child_disable_b', false)
      as result(record_key text);
  parent_error := extensions.dblink_error_message('task7_child_disable_b');

  select result.parent_count, result.child_count
    into parent_active_count, child_count
    from extensions.dblink(
      'task7_child_disable_a',
      $remote$
        select
          (
            select count(*)::bigint
            from public.purchase_records
            where record_key = 'PO-TASK7-CHILD-DISABLE'
              and status = 'active'
          ),
          (
            select count(*)::bigint
            from public.stock_in_records
            where record_key = 'SI-TASK7-CHILD-DISABLE'
              and status = 'active'
          )
      $remote$
    ) as result(parent_count bigint, child_count bigint);
  perform extensions.dblink_exec(
    'task7_child_disable_a',
    $remote$
      delete from public.stock_in_records
      where record_key = 'SI-TASK7-CHILD-DISABLE';
      delete from public.purchase_records
      where record_key = 'PO-TASK7-CHILD-DISABLE'
    $remote$
  );
  perform extensions.dblink_disconnect('task7_child_disable_b');
  perform extensions.dblink_disconnect('task7_child_disable_a');

  return parent_was_blocked
    and parent_error like '%purchase record has linked facts%'
    and parent_active_count = 1
    and child_count = 1;
exception when others then
  raise notice 'child-insert/parent-disable probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_child_disable_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_child_disable_b') = 1 then
        perform extensions.dblink_cancel_query('task7_child_disable_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_child_disable_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_child_disable_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_child_disable_b', false)
            as result(record_key text);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_child_disable_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_child_disable_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec(
        'task7_child_disable_a',
        'rollback',
        false
      );
      perform extensions.dblink_exec(
        'task7_child_disable_a',
        $remote$
          delete from public.stock_in_records
          where record_key = 'SI-TASK7-CHILD-DISABLE';
          delete from public.purchase_records
          where record_key = 'PO-TASK7-CHILD-DISABLE'
        $remote$,
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_child_disable_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_child_insert_blocks_parent_disable(),
  'a child INSERT blocks and rejects a concurrent parent status downgrade'
);

create or replace function pg_temp.purchase_rebind_serializes_new_key()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  child_was_blocked boolean := false;
  child_error text := '';
  old_parent_count bigint := -1;
  new_parent_count bigint := -1;
  child_count bigint := -1;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_rebind_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_rebind_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_rebind_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_rebind_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec('task7_rebind_a', 'set role service_role');
  perform extensions.dblink_exec('task7_rebind_b', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_rebind_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_rebind_b',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_rebind_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-REBIND-OLD',
        '{"purchaseId":"PO-TASK7-REBIND-OLD"}'::jsonb,
        'active'
      )
    $remote$
  );
  perform extensions.dblink_exec('task7_rebind_a', 'begin');
  perform extensions.dblink_exec(
    'task7_rebind_a',
    $remote$
      update public.purchase_records
      set record_key = 'PO-TASK7-REBIND-NEW',
          payload = '{"purchaseId":"PO-TASK7-REBIND-NEW"}'::jsonb
      where record_key = 'PO-TASK7-REBIND-OLD'
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_rebind_b',
    $remote$
      insert into public.stock_in_records (record_key, payload, status)
      values (
        'SI-TASK7-REBIND-NEW',
        '{"stockInId":"SI-TASK7-REBIND-NEW","sourcePurchaseId":"PO-TASK7-REBIND-NEW"}'::jsonb,
        'active'
      )
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch new-key child insert';
  end if;
  for poll_attempt in 1..100 loop
    child_was_blocked := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      false
    );
    exit when child_was_blocked;
    perform pg_sleep(0.01);
  end loop;
  perform extensions.dblink_exec('task7_rebind_a', 'commit');
  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_rebind_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_rebind_b') = 1 then
    perform extensions.dblink_cancel_query('task7_rebind_b');
    raise exception 'new-key child insert did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_rebind_b', false)
      as result(record_key text);
  child_error := extensions.dblink_error_message('task7_rebind_b');

  select result.old_count, result.new_count, result.child_count
    into old_parent_count, new_parent_count, child_count
    from extensions.dblink(
      'task7_rebind_a',
      $remote$
        select
          (select count(*)::bigint from public.purchase_records
            where record_key = 'PO-TASK7-REBIND-OLD'),
          (select count(*)::bigint from public.purchase_records
            where record_key = 'PO-TASK7-REBIND-NEW'),
          (select count(*)::bigint from public.stock_in_records
            where record_key = 'SI-TASK7-REBIND-NEW')
      $remote$
    ) as result(old_count bigint, new_count bigint, child_count bigint);

  perform extensions.dblink_exec(
    'task7_rebind_a',
    'delete from public.stock_in_records where record_key = ''SI-TASK7-REBIND-NEW'''
  );
  perform extensions.dblink_exec(
    'task7_rebind_a',
    'delete from public.purchase_records where record_key = ''PO-TASK7-REBIND-NEW'''
  );
  perform extensions.dblink_disconnect('task7_rebind_b');
  perform extensions.dblink_disconnect('task7_rebind_a');
  return child_was_blocked
    and child_error = 'OK'
    and old_parent_count = 0
    and new_parent_count = 1
    and child_count = 1;
exception when others then
  raise notice 'purchase rebind probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_rebind_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_rebind_b') = 1 then
        perform extensions.dblink_cancel_query('task7_rebind_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_rebind_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_rebind_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_rebind_b', false)
            as result(record_key text);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_rebind_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_rebind_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec('task7_rebind_a', 'rollback', false);
      perform extensions.dblink_exec(
        'task7_rebind_a',
        'delete from public.stock_in_records where record_key = ''SI-TASK7-REBIND-NEW''',
        false
      );
      perform extensions.dblink_exec(
        'task7_rebind_a',
        'delete from public.purchase_records where record_key in (''PO-TASK7-REBIND-OLD'', ''PO-TASK7-REBIND-NEW'')',
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_rebind_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_rebind_serializes_new_key(),
  'an unlinked parent rebind serializes the new key before child validation'
);

create or replace function pg_temp.purchase_parent_on_conflict_is_tuple_first()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  b_waited_for_a boolean := false;
  b_held_target_key boolean := true;
  a_error text := '';
  b_error text := '';
  a_result_key text := '';
  b_result_key text := '';
  final_count bigint := -1;
  final_winner text := '';
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_parent_upsert_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_parent_upsert_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_parent_upsert_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_parent_upsert_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec('task7_parent_upsert_a', 'set role service_role');
  perform extensions.dblink_exec('task7_parent_upsert_b', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_parent_upsert_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_parent_upsert_b',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_parent_upsert_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-UPSERT-RACE',
        '{"purchaseId":"PO-TASK7-UPSERT-RACE","winner":"seed"}'::jsonb,
        'active'
      )
    $remote$
  );

  perform extensions.dblink_exec('task7_parent_upsert_a', 'begin');
  perform extensions.dblink_exec(
    'task7_parent_upsert_a',
    $remote$
      do $lock$
      begin
        perform 1
        from public.purchase_records
        where record_key = 'PO-TASK7-UPSERT-RACE'
        for update;
      end
      $lock$
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_parent_upsert_b',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-UPSERT-RACE',
        '{"purchaseId":"PO-TASK7-UPSERT-RACE","winner":"B"}'::jsonb,
        'active'
      )
      on conflict (record_key) do update
      set payload = excluded.payload,
          status = excluded.status
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch parent upsert';
  end if;
  for poll_attempt in 1..100 loop
    b_waited_for_a := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      false
    );
    exit when b_waited_for_a;
    perform pg_sleep(0.01);
  end loop;
  b_held_target_key := pg_temp.session_holds_purchase_key(
    b_pid,
    'PO-TASK7-UPSERT-RACE'
  );

  if extensions.dblink_send_query(
    'task7_parent_upsert_a',
    $remote$
      update public.purchase_records
      set payload = payload || '{"winner":"A"}'::jsonb
      where record_key = 'PO-TASK7-UPSERT-RACE'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch tuple-holder parent update';
  end if;
  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_parent_upsert_a') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_parent_upsert_a') = 1 then
    perform extensions.dblink_cancel_query('task7_parent_upsert_a');
    raise exception 'tuple-holder parent update did not finish';
  end if;
  select result.record_key
    into a_result_key
    from extensions.dblink_get_result('task7_parent_upsert_a', false)
      as result(record_key text);
  a_error := extensions.dblink_error_message('task7_parent_upsert_a');
  if a_error = 'OK' then
    perform extensions.dblink_exec('task7_parent_upsert_a', 'commit');
  else
    perform extensions.dblink_exec('task7_parent_upsert_a', 'rollback');
  end if;

  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_parent_upsert_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_parent_upsert_b') = 1 then
    perform extensions.dblink_cancel_query('task7_parent_upsert_b');
    raise exception 'parent upsert did not finish';
  end if;
  select result.record_key
    into b_result_key
    from extensions.dblink_get_result('task7_parent_upsert_b', false)
      as result(record_key text);
  b_error := extensions.dblink_error_message('task7_parent_upsert_b');

  select result.row_count, result.winner
    into final_count, final_winner
    from extensions.dblink(
      'task7_parent_upsert_a',
      $remote$
        select count(*)::bigint, max(payload->>'winner')
        from public.purchase_records
        where record_key = 'PO-TASK7-UPSERT-RACE'
      $remote$
    ) as result(row_count bigint, winner text);
  perform extensions.dblink_exec(
    'task7_parent_upsert_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-UPSERT-RACE'
    $remote$
  );
  perform extensions.dblink_disconnect('task7_parent_upsert_b');
  perform extensions.dblink_disconnect('task7_parent_upsert_a');

  return b_waited_for_a
    and not b_held_target_key
    and a_error = 'OK'
    and b_error = 'OK'
    and a_result_key = 'PO-TASK7-UPSERT-RACE'
    and b_result_key = 'PO-TASK7-UPSERT-RACE'
    and final_count = 1
    and final_winner = 'B';
exception when others then
  raise notice 'parent ON CONFLICT lock-order probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_parent_upsert_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_parent_upsert_b') = 1 then
        perform extensions.dblink_cancel_query('task7_parent_upsert_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_parent_upsert_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_parent_upsert_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_parent_upsert_b', false)
            as result(record_key text);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_parent_upsert_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_parent_upsert_a' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_parent_upsert_a') = 1 then
        perform extensions.dblink_cancel_query('task7_parent_upsert_a');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_parent_upsert_a') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_parent_upsert_a') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_parent_upsert_a', false)
            as result(record_key text);
      end if;
      perform extensions.dblink_exec('task7_parent_upsert_a', 'rollback', false);
      perform extensions.dblink_exec(
        'task7_parent_upsert_a',
        'delete from public.purchase_records where record_key = ''PO-TASK7-UPSERT-RACE''',
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_parent_upsert_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_parent_on_conflict_is_tuple_first(),
  'parent ON CONFLICT waits for the tuple without holding the purchase key'
);

create or replace function pg_temp.purchase_child_on_conflict_is_tuple_first()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  b_waited_for_a boolean := false;
  b_held_target_key boolean := true;
  a_error text := '';
  b_error text := '';
  a_result_key text := '';
  b_result_key text := '';
  final_count bigint := -1;
  target_link_count bigint := -1;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_child_upsert_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_child_upsert_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_child_upsert_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_child_upsert_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec(
    'task7_child_upsert_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values
        (
          'PO-TASK7-CHILD-REBIND-A',
          '{"purchaseId":"PO-TASK7-CHILD-REBIND-A"}'::jsonb,
          'active'
        ),
        (
          'PO-TASK7-CHILD-REBIND-B',
          '{"purchaseId":"PO-TASK7-CHILD-REBIND-B"}'::jsonb,
          'active'
        );
      insert into public.purchase_payment_records (
        record_key,
        payload,
        status
      ) values
        (
          'PP-TASK7-UPSERT-REBIND',
          '{"paymentId":"PP-TASK7-UPSERT-REBIND","purchaseId":"PO-TASK7-CHILD-REBIND-A","winner":"seed"}'::jsonb,
          'active'
        ),
        (
          'PP-TASK7-UPDATE-REBIND',
          '{"paymentId":"PP-TASK7-UPDATE-REBIND","purchaseId":"PO-TASK7-CHILD-REBIND-A","winner":"seed"}'::jsonb,
          'active'
        )
    $remote$
  );

  perform extensions.dblink_exec('task7_child_upsert_a', 'begin');
  perform extensions.dblink_exec(
    'task7_child_upsert_a',
    $remote$
      do $purchase_key$
      begin
        perform private.lock_purchase_record_key(
          'PO-TASK7-CHILD-REBIND-A'
        );
      end
      $purchase_key$
    $remote$
  );
  perform extensions.dblink_exec('task7_child_upsert_a', 'set role service_role');
  perform extensions.dblink_exec('task7_child_upsert_b', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_child_upsert_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_child_upsert_b',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_child_upsert_a',
    'set statement_timeout = ''5s'''
  );
  perform extensions.dblink_exec(
    'task7_child_upsert_b',
    'set statement_timeout = ''5s'''
  );
  if extensions.dblink_send_query(
    'task7_child_upsert_b',
    $remote$
      insert into public.purchase_payment_records (
        record_key,
        payload,
        status
      ) values (
        'PP-TASK7-UPSERT-REBIND',
        '{"paymentId":"PP-TASK7-UPSERT-REBIND","purchaseId":"PO-TASK7-CHILD-REBIND-B","winner":"B"}'::jsonb,
        'active'
      )
      on conflict (record_key) do update
      set payload = excluded.payload,
          status = excluded.status
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch child upsert';
  end if;
  for poll_attempt in 1..100 loop
    b_waited_for_a := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      true
    );
    exit when b_waited_for_a;
    perform pg_sleep(0.01);
  end loop;
  b_held_target_key := pg_temp.session_holds_purchase_key(
    b_pid,
    'PO-TASK7-CHILD-REBIND-B'
  );

  if extensions.dblink_send_query(
    'task7_child_upsert_a',
    $remote$
      update public.purchase_payment_records
      set payload = jsonb_set(
            payload || '{"winner":"A"}'::jsonb,
            '{purchaseId}',
            '"PO-TASK7-CHILD-REBIND-B"'::jsonb
          )
      where record_key = 'PP-TASK7-UPDATE-REBIND'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch tuple-holder child update';
  end if;
  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_child_upsert_a') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_child_upsert_a') = 1 then
    perform extensions.dblink_cancel_query('task7_child_upsert_a');
    raise exception 'tuple-holder child update did not finish';
  end if;
  select result.record_key
    into a_result_key
    from extensions.dblink_get_result('task7_child_upsert_a', false)
      as result(record_key text);
  a_error := extensions.dblink_error_message('task7_child_upsert_a');
  if a_error = 'OK' then
    perform extensions.dblink_exec('task7_child_upsert_a', 'commit');
  else
    perform extensions.dblink_exec('task7_child_upsert_a', 'rollback');
  end if;

  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_child_upsert_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_child_upsert_b') = 1 then
    perform extensions.dblink_cancel_query('task7_child_upsert_b');
    raise exception 'child upsert did not finish';
  end if;
  select result.record_key
    into b_result_key
    from extensions.dblink_get_result('task7_child_upsert_b', false)
      as result(record_key text);
  b_error := extensions.dblink_error_message('task7_child_upsert_b');

  select result.row_count, result.target_link_count
    into final_count, target_link_count
    from extensions.dblink(
      'task7_child_upsert_a',
      $remote$
        select
          count(*)::bigint,
          count(*) filter (
            where payload->>'purchaseId' = 'PO-TASK7-CHILD-REBIND-B'
          )::bigint
        from public.purchase_payment_records
        where record_key in (
          'PP-TASK7-UPSERT-REBIND',
          'PP-TASK7-UPDATE-REBIND'
        )
      $remote$
    ) as result(row_count bigint, target_link_count bigint);
  perform extensions.dblink_exec('task7_child_upsert_a', 'reset role');
  perform extensions.dblink_exec(
    'task7_child_upsert_a',
    $remote$
      delete from public.purchase_payment_records
      where record_key in (
        'PP-TASK7-UPSERT-REBIND',
        'PP-TASK7-UPDATE-REBIND'
      );
      delete from public.purchase_records
      where record_key in (
        'PO-TASK7-CHILD-REBIND-A',
        'PO-TASK7-CHILD-REBIND-B'
      )
    $remote$
  );
  perform extensions.dblink_disconnect('task7_child_upsert_b');
  perform extensions.dblink_disconnect('task7_child_upsert_a');

  return b_waited_for_a
    and not b_held_target_key
    and a_error = 'OK'
    and b_error = 'OK'
    and a_result_key = 'PP-TASK7-UPDATE-REBIND'
    and b_result_key = 'PP-TASK7-UPSERT-REBIND'
    and final_count = 2
    and target_link_count = 2;
exception when others then
  raise notice 'child ON CONFLICT lock-order probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_child_upsert_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_child_upsert_b') = 1 then
        perform extensions.dblink_cancel_query('task7_child_upsert_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_child_upsert_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_child_upsert_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_child_upsert_b', false)
            as result(record_key text);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_child_upsert_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_child_upsert_a' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_child_upsert_a') = 1 then
        perform extensions.dblink_cancel_query('task7_child_upsert_a');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_child_upsert_a') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_child_upsert_a') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_child_upsert_a', false)
            as result(record_key text);
      end if;
      perform extensions.dblink_exec('task7_child_upsert_a', 'rollback', false);
      perform extensions.dblink_exec('task7_child_upsert_a', 'reset role', false);
      perform extensions.dblink_exec(
        'task7_child_upsert_a',
        $remote$
          delete from public.purchase_payment_records
          where record_key in (
            'PP-TASK7-UPSERT-REBIND',
            'PP-TASK7-UPDATE-REBIND'
          );
          delete from public.purchase_records
          where record_key in (
            'PO-TASK7-CHILD-REBIND-A',
            'PO-TASK7-CHILD-REBIND-B'
          )
        $remote$,
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_child_upsert_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_child_on_conflict_is_tuple_first(),
  'child ON CONFLICT rebind defers parent keys to the sorted UPDATE path'
);

create or replace function pg_temp.purchase_rebind_conflict_is_tuple_first()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  a_waited_for_b boolean := false;
  a_error text := '';
  b_error text := '';
  source_count bigint := -1;
  target_count bigint := -1;
  target_updated boolean := false;
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_rebind_conflict_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_rebind_conflict_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_rebind_conflict_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_rebind_conflict_b',
      'select pg_backend_pid()'
    ) as result(pid integer);
  perform extensions.dblink_exec(
    'task7_rebind_conflict_a',
    'set role service_role'
  );
  perform extensions.dblink_exec(
    'task7_rebind_conflict_b',
    'set role service_role'
  );
  perform extensions.dblink_exec(
    'task7_rebind_conflict_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_rebind_conflict_b',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec(
    'task7_rebind_conflict_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values
        (
          'PO-TASK7-REBIND-CONFLICT-A',
          '{"purchaseId":"PO-TASK7-REBIND-CONFLICT-A"}'::jsonb,
          'active'
        ),
        (
          'PO-TASK7-REBIND-CONFLICT-B',
          '{"purchaseId":"PO-TASK7-REBIND-CONFLICT-B"}'::jsonb,
          'active'
        )
    $remote$
  );

  perform extensions.dblink_exec('task7_rebind_conflict_a', 'begin');
  perform extensions.dblink_exec('task7_rebind_conflict_b', 'begin');
  perform extensions.dblink_exec(
    'task7_rebind_conflict_a',
    $remote$
      do $lock$
      begin
        perform 1
        from public.purchase_records
        where record_key = 'PO-TASK7-REBIND-CONFLICT-A'
        for update;
      end
      $lock$
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_rebind_conflict_b',
    $remote$
      do $lock$
      begin
        perform 1
        from public.purchase_records
        where record_key = 'PO-TASK7-REBIND-CONFLICT-B'
        for update;
      end
      $lock$
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_rebind_conflict_a',
    $remote$
      update public.purchase_records
      set record_key = 'PO-TASK7-REBIND-CONFLICT-B',
          payload = '{"purchaseId":"PO-TASK7-REBIND-CONFLICT-B","rebound":true}'::jsonb
      where record_key = 'PO-TASK7-REBIND-CONFLICT-A'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch conflicting parent rebind';
  end if;
  for poll_attempt in 1..100 loop
    a_waited_for_b := pg_temp.session_waits_on_lock(
      a_pid,
      b_pid,
      false
    );
    exit when a_waited_for_b;
    perform pg_sleep(0.01);
  end loop;

  if extensions.dblink_send_query(
    'task7_rebind_conflict_b',
    $remote$
      update public.purchase_records
      set payload = payload || '{"targetUpdated":true}'::jsonb
      where record_key = 'PO-TASK7-REBIND-CONFLICT-B'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch target parent update';
  end if;
  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_rebind_conflict_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_rebind_conflict_b') = 1 then
    perform extensions.dblink_cancel_query('task7_rebind_conflict_b');
    raise exception 'target parent update did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_rebind_conflict_b', false)
      as result(record_key text);
  b_error := extensions.dblink_error_message('task7_rebind_conflict_b');
  if b_error = 'OK' then
    perform extensions.dblink_exec('task7_rebind_conflict_b', 'commit');
  else
    perform extensions.dblink_exec('task7_rebind_conflict_b', 'rollback');
  end if;

  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_rebind_conflict_a') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_rebind_conflict_a') = 1 then
    perform extensions.dblink_cancel_query('task7_rebind_conflict_a');
    raise exception 'conflicting parent rebind did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_rebind_conflict_a', false)
      as result(record_key text);
  a_error := extensions.dblink_error_message('task7_rebind_conflict_a');
  if a_error = 'OK' then
    perform extensions.dblink_exec('task7_rebind_conflict_a', 'commit');
  else
    perform extensions.dblink_exec('task7_rebind_conflict_a', 'rollback');
  end if;

  select result.source_count, result.target_count, result.target_updated
    into source_count, target_count, target_updated
    from extensions.dblink(
      'task7_rebind_conflict_a',
      $remote$
        select
          count(*) filter (
            where record_key = 'PO-TASK7-REBIND-CONFLICT-A'
          )::bigint,
          count(*) filter (
            where record_key = 'PO-TASK7-REBIND-CONFLICT-B'
          )::bigint,
          coalesce(
            bool_and((payload->>'targetUpdated')::boolean) filter (
              where record_key = 'PO-TASK7-REBIND-CONFLICT-B'
            ),
            false
          )
        from public.purchase_records
        where record_key in (
          'PO-TASK7-REBIND-CONFLICT-A',
          'PO-TASK7-REBIND-CONFLICT-B'
        )
      $remote$
    ) as result(
      source_count bigint,
      target_count bigint,
      target_updated boolean
    );
  perform extensions.dblink_exec(
    'task7_rebind_conflict_a',
    $remote$
      delete from public.purchase_records
      where record_key in (
        'PO-TASK7-REBIND-CONFLICT-A',
        'PO-TASK7-REBIND-CONFLICT-B'
      )
    $remote$
  );
  perform extensions.dblink_disconnect('task7_rebind_conflict_b');
  perform extensions.dblink_disconnect('task7_rebind_conflict_a');

  return a_waited_for_b
    and b_error = 'OK'
    and a_error like '%duplicate key value violates unique constraint%'
    and a_error not like '%deadlock detected%'
    and source_count = 1
    and target_count = 1
    and target_updated;
exception when others then
  raise notice 'conflicting rebind lock-order probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_rebind_conflict_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_rebind_conflict_b') = 1 then
        perform extensions.dblink_cancel_query('task7_rebind_conflict_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_rebind_conflict_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_rebind_conflict_b') = 0 then
        perform result.record_key
          from extensions.dblink_get_result(
            'task7_rebind_conflict_b',
            false
          ) as result(record_key text);
      end if;
      perform extensions.dblink_exec(
        'task7_rebind_conflict_b',
        'rollback',
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_rebind_conflict_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_rebind_conflict_a' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_rebind_conflict_a') = 1 then
        perform extensions.dblink_cancel_query('task7_rebind_conflict_a');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_rebind_conflict_a') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_rebind_conflict_a') = 0 then
        perform result.record_key
          from extensions.dblink_get_result(
            'task7_rebind_conflict_a',
            false
          ) as result(record_key text);
      end if;
      perform extensions.dblink_exec(
        'task7_rebind_conflict_a',
        'rollback',
        false
      );
      perform extensions.dblink_exec(
        'task7_rebind_conflict_a',
        $remote$
          delete from public.purchase_records
          where record_key in (
            'PO-TASK7-REBIND-CONFLICT-A',
            'PO-TASK7-REBIND-CONFLICT-B'
          )
        $remote$,
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_rebind_conflict_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_rebind_conflict_is_tuple_first(),
  'conflicting parent rebind waits on the target tuple before purchase keys'
);

create or replace function pg_temp.purchase_stock_upsert_avoids_commit_cycle()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  commit_waited_for_update boolean := false;
  commit_held_purchase_key boolean := true;
  update_error text := '';
  commit_error text := '';
  update_result_key text := '';
  commit_result jsonb;
  final_count bigint := -1;
  final_winner text := '';
  a_pid integer;
  b_pid integer;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_stock_commit_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_stock_commit_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  select result.pid
    into a_pid
    from extensions.dblink(
      'task7_stock_commit_a',
      'select pg_backend_pid()'
    ) as result(pid integer);
  select result.pid
    into b_pid
    from extensions.dblink(
      'task7_stock_commit_b',
      'select pg_backend_pid()'
    ) as result(pid integer);

  perform extensions.dblink_exec(
    'task7_stock_commit_a',
    $remote$
      insert into auth.users (
        instance_id,
        id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at
      ) values (
        '00000000-0000-0000-0000-000000000000',
        '73000000-0000-4000-8000-000000000001',
        'authenticated',
        'authenticated',
        'task7-stock-commit-race@auth.invalid',
        '',
        now(),
        '{}'::jsonb,
        '{}'::jsonb,
        now(),
        now()
      );
      insert into public.employee_profiles (
        id,
        employee_number,
        auth_user_id,
        name,
        department,
        position,
        employment_status,
        account_status,
        must_change_password,
        is_hidden_system_account
      ) values (
        '73000000-0000-4000-8000-000000000002',
        'SW-7301',
        '73000000-0000-4000-8000-000000000001',
        '采购并发测试员工',
        '工程部',
        '部长',
        '在职',
        'active',
        false,
        false
      );
      insert into public.permission_grants (
        subject_type,
        subject_code,
        permission_key
      ) values
        ('department', '工程部', 'module.purchases.update'),
        ('department', '工程部', 'module.inventory.create'),
        ('department', '工程部', 'module.inventory.update');
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-COMMIT-RACE',
        '{"purchaseId":"PO-TASK7-COMMIT-RACE","winner":"seed"}'::jsonb,
        'active'
      );
      insert into public.stock_in_records (record_key, payload, status)
      values (
        'SI-TASK7-COMMIT-RACE',
        '{"stockInId":"SI-TASK7-COMMIT-RACE","sourcePurchaseId":"PO-TASK7-COMMIT-RACE","winner":"seed"}'::jsonb,
        'active'
      );
      insert into public.inventory_items (record_key, payload, status)
      values (
        'INV-TASK7-COMMIT-RACE',
        '{"inventoryId":"INV-TASK7-COMMIT-RACE","winner":"seed"}'::jsonb,
        'active'
      )
    $remote$
  );
  perform extensions.dblink_exec('task7_stock_commit_a', 'set role service_role');
  perform extensions.dblink_exec(
    'task7_stock_commit_a',
    'set "request.jwt.claim.role" = ''service_role'''
  );
  perform extensions.dblink_exec('task7_stock_commit_b', 'set role authenticated');
  perform extensions.dblink_exec(
    'task7_stock_commit_b',
    'set "request.jwt.claim.role" = ''authenticated'''
  );
  perform extensions.dblink_exec(
    'task7_stock_commit_b',
    'set "request.jwt.claim.sub" = ''73000000-0000-4000-8000-000000000001'''
  );

  perform extensions.dblink_exec('task7_stock_commit_a', 'begin');
  perform extensions.dblink_exec(
    'task7_stock_commit_a',
    $remote$
      do $lock$
      begin
        perform 1
        from public.stock_in_records
        where record_key = 'SI-TASK7-COMMIT-RACE'
        for update;
      end
      $lock$
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_stock_commit_b',
    $remote$
      select public.commit_purchase_stock_in_secure(
        'PO-TASK7-COMMIT-RACE',
        '{"purchaseId":"PO-TASK7-COMMIT-RACE","winner":"B"}'::jsonb,
        'SI-TASK7-COMMIT-RACE',
        '{"stockInId":"SI-TASK7-COMMIT-RACE","sourcePurchaseId":"PO-TASK7-COMMIT-RACE","winner":"B"}'::jsonb,
        'INV-TASK7-COMMIT-RACE',
        '{"inventoryId":"INV-TASK7-COMMIT-RACE","winner":"B"}'::jsonb
      ) as result
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch transactional stock-in commit';
  end if;
  for poll_attempt in 1..100 loop
    commit_waited_for_update := pg_temp.session_waits_on_lock(
      b_pid,
      a_pid,
      false
    );
    exit when commit_waited_for_update;
    perform pg_sleep(0.01);
  end loop;
  commit_held_purchase_key := pg_temp.session_holds_purchase_key(
    b_pid,
    'PO-TASK7-COMMIT-RACE'
  );

  if extensions.dblink_send_query(
    'task7_stock_commit_a',
    $remote$
      insert into public.stock_in_records (record_key, payload, status)
      values (
        'SI-TASK7-COMMIT-RACE',
        '{"stockInId":"SI-TASK7-COMMIT-RACE","sourcePurchaseId":"PO-TASK7-COMMIT-RACE","winner":"A"}'::jsonb,
        'active'
      )
      on conflict (record_key) do update
      set payload = excluded.payload,
          status = excluded.status
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch direct stock-in upsert';
  end if;
  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_stock_commit_a') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_stock_commit_a') = 1 then
    perform extensions.dblink_cancel_query('task7_stock_commit_a');
    raise exception 'direct stock-in upsert did not finish';
  end if;
  select result.record_key
    into update_result_key
    from extensions.dblink_get_result('task7_stock_commit_a', false)
      as result(record_key text);
  update_error := extensions.dblink_error_message('task7_stock_commit_a');
  if update_error = 'OK' then
    perform extensions.dblink_exec('task7_stock_commit_a', 'commit');
  else
    perform extensions.dblink_exec('task7_stock_commit_a', 'rollback');
  end if;

  for poll_attempt in 1..300 loop
    exit when extensions.dblink_is_busy('task7_stock_commit_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_stock_commit_b') = 1 then
    perform extensions.dblink_cancel_query('task7_stock_commit_b');
    raise exception 'transactional stock-in commit did not finish';
  end if;
  select result.result
    into commit_result
    from extensions.dblink_get_result('task7_stock_commit_b', false)
      as result(result jsonb);
  commit_error := extensions.dblink_error_message('task7_stock_commit_b');

  perform extensions.dblink_exec('task7_stock_commit_a', 'reset role');
  select result.row_count, result.winner
    into final_count, final_winner
    from extensions.dblink(
      'task7_stock_commit_a',
      $remote$
        select count(*)::bigint, max(payload->>'winner')
        from public.stock_in_records
        where record_key = 'SI-TASK7-COMMIT-RACE'
      $remote$
    ) as result(row_count bigint, winner text);
  perform extensions.dblink_exec(
    'task7_stock_commit_a',
    $remote$
      delete from public.stock_in_records
      where record_key = 'SI-TASK7-COMMIT-RACE';
      delete from public.inventory_items
      where record_key = 'INV-TASK7-COMMIT-RACE';
      delete from public.purchase_records
      where record_key = 'PO-TASK7-COMMIT-RACE';
      delete from public.permission_grants
      where subject_type = 'department'
        and subject_code = '工程部'
        and permission_key in (
          'module.purchases.update',
          'module.inventory.create',
          'module.inventory.update'
        );
      delete from public.employee_profiles
      where id = '73000000-0000-4000-8000-000000000002';
      delete from auth.users
      where id = '73000000-0000-4000-8000-000000000001'
    $remote$
  );
  perform extensions.dblink_disconnect('task7_stock_commit_b');
  perform extensions.dblink_disconnect('task7_stock_commit_a');

  return commit_waited_for_update
    and not commit_held_purchase_key
    and update_error = 'OK'
    and commit_error = 'OK'
    and update_result_key = 'SI-TASK7-COMMIT-RACE'
    and commit_result->'stock_in'->>'record_key' = 'SI-TASK7-COMMIT-RACE'
    and final_count = 1
    and final_winner = 'B';
exception when others then
  raise notice 'stock upsert/commit lock-order probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_stock_commit_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_stock_commit_b') = 1 then
        perform extensions.dblink_cancel_query('task7_stock_commit_b');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_stock_commit_b') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_stock_commit_b') = 0 then
        perform result.result
          from extensions.dblink_get_result('task7_stock_commit_b', false)
            as result(result jsonb);
      end if;
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_stock_commit_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_stock_commit_a' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_stock_commit_a') = 1 then
        perform extensions.dblink_cancel_query('task7_stock_commit_a');
      end if;
      for poll_attempt in 1..100 loop
        exit when extensions.dblink_is_busy('task7_stock_commit_a') = 0;
        perform pg_sleep(0.01);
      end loop;
      if extensions.dblink_is_busy('task7_stock_commit_a') = 0 then
        perform result.record_key
          from extensions.dblink_get_result('task7_stock_commit_a', false)
            as result(record_key text);
      end if;
      perform extensions.dblink_exec('task7_stock_commit_a', 'rollback', false);
      perform extensions.dblink_exec('task7_stock_commit_a', 'reset role', false);
      perform extensions.dblink_exec(
        'task7_stock_commit_a',
        $remote$
          delete from public.stock_in_records
          where record_key = 'SI-TASK7-COMMIT-RACE';
          delete from public.inventory_items
          where record_key = 'INV-TASK7-COMMIT-RACE';
          delete from public.purchase_records
          where record_key = 'PO-TASK7-COMMIT-RACE';
          delete from public.permission_grants
          where subject_type = 'department'
            and subject_code = '工程部'
            and permission_key in (
              'module.purchases.update',
              'module.inventory.create',
              'module.inventory.update'
            );
          delete from public.employee_profiles
          where id = '73000000-0000-4000-8000-000000000002';
          delete from auth.users
          where id = '73000000-0000-4000-8000-000000000001'
        $remote$,
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_stock_commit_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_stock_upsert_avoids_commit_cycle(),
  'stock ON CONFLICT and transactional commit preserve child-to-key ordering'
);

create or replace function pg_temp.purchase_snapshot_races_fail_closed()
returns boolean
language plpgsql
set search_path = pg_catalog, extensions
as $function$
declare
  parent_first_error text := '';
  child_first_error text := '';
  parent_first_parent_count bigint := -1;
  parent_first_child_count bigint := -1;
  child_first_parent_count bigint := -1;
  child_first_child_count bigint := -1;
  snapshot_count bigint;
  poll_attempt integer;
  connection_names text[];
begin
  perform extensions.dblink_connect(
    'task7_snapshot_a',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_connect(
    'task7_snapshot_b',
    format(
      'host=db port=5432 dbname=%L user=postgres password=postgres',
      current_database()
    )
  );
  perform extensions.dblink_exec('task7_snapshot_a', 'set role service_role');
  perform extensions.dblink_exec('task7_snapshot_b', 'set role service_role');

  -- A parent delete commits after B fixed an older parent-visible snapshot.
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-SNAPSHOT-PARENT-FIRST',
        '{"purchaseId":"PO-TASK7-SNAPSHOT-PARENT-FIRST"}'::jsonb,
        'active'
      )
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_snapshot_b',
    'begin isolation level repeatable read'
  );
  select result.row_count
    into snapshot_count
    from extensions.dblink(
      'task7_snapshot_b',
      $remote$
        select count(*)::bigint
        from public.purchase_records
        where record_key = 'PO-TASK7-SNAPSHOT-PARENT-FIRST'
      $remote$
    ) as result(row_count bigint);
  if snapshot_count <> 1 then
    raise exception 'could not establish parent-visible repeatable-read snapshot';
  end if;

  perform extensions.dblink_exec('task7_snapshot_a', 'begin');
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-SNAPSHOT-PARENT-FIRST'
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_snapshot_b',
    $remote$
      insert into public.purchase_payment_records (
        record_key,
        payload,
        status
      ) values (
        'PP-TASK7-SNAPSHOT-PARENT-FIRST',
        '{"paymentId":"PP-TASK7-SNAPSHOT-PARENT-FIRST","purchaseId":"PO-TASK7-SNAPSHOT-PARENT-FIRST"}'::jsonb,
        'active'
      )
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch snapshot child insert';
  end if;
  perform pg_sleep(0.1);
  perform extensions.dblink_exec('task7_snapshot_a', 'commit');
  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_snapshot_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_snapshot_b') = 1 then
    perform extensions.dblink_cancel_query('task7_snapshot_b');
    raise exception 'snapshot child insert did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_snapshot_b', false)
      as result(record_key text);
  parent_first_error := extensions.dblink_error_message('task7_snapshot_b');
  if parent_first_error = 'OK' then
    perform extensions.dblink_exec('task7_snapshot_b', 'commit');
  else
    perform extensions.dblink_exec('task7_snapshot_b', 'rollback');
  end if;

  select result.row_count
    into parent_first_parent_count
    from extensions.dblink(
      'task7_snapshot_a',
      $remote$
        select count(*)::bigint
        from public.purchase_records
        where record_key = 'PO-TASK7-SNAPSHOT-PARENT-FIRST'
      $remote$
    ) as result(row_count bigint);
  select result.row_count
    into parent_first_child_count
    from extensions.dblink(
      'task7_snapshot_a',
      $remote$
        select count(*)::bigint
        from public.purchase_payment_records
        where record_key = 'PP-TASK7-SNAPSHOT-PARENT-FIRST'
      $remote$
    ) as result(row_count bigint);
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      delete from public.purchase_payment_records
      where record_key = 'PP-TASK7-SNAPSHOT-PARENT-FIRST'
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-SNAPSHOT-PARENT-FIRST'
    $remote$
  );

  -- A child insert commits after B fixed an older child-absent snapshot.
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      insert into public.purchase_records (record_key, payload, status)
      values (
        'PO-TASK7-SNAPSHOT-CHILD-FIRST',
        '{"purchaseId":"PO-TASK7-SNAPSHOT-CHILD-FIRST"}'::jsonb,
        'active'
      )
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_snapshot_b',
    'begin isolation level repeatable read'
  );
  select result.row_count
    into snapshot_count
    from extensions.dblink(
      'task7_snapshot_b',
      $remote$
        select count(*)::bigint
        from public.stock_in_records
        where record_key = 'SI-TASK7-SNAPSHOT-CHILD-FIRST'
      $remote$
    ) as result(row_count bigint);
  if snapshot_count <> 0 then
    raise exception 'could not establish child-absent repeatable-read snapshot';
  end if;

  perform extensions.dblink_exec('task7_snapshot_a', 'begin');
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      insert into public.stock_in_records (record_key, payload, status)
      values (
        'SI-TASK7-SNAPSHOT-CHILD-FIRST',
        '{"stockInId":"SI-TASK7-SNAPSHOT-CHILD-FIRST","sourcePurchaseId":"PO-TASK7-SNAPSHOT-CHILD-FIRST"}'::jsonb,
        'active'
      )
    $remote$
  );
  if extensions.dblink_send_query(
    'task7_snapshot_b',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-SNAPSHOT-CHILD-FIRST'
      returning record_key
    $remote$
  ) <> 1 then
    raise exception 'could not dispatch snapshot parent delete';
  end if;
  perform pg_sleep(0.1);
  perform extensions.dblink_exec('task7_snapshot_a', 'commit');
  for poll_attempt in 1..100 loop
    exit when extensions.dblink_is_busy('task7_snapshot_b') = 0;
    perform pg_sleep(0.01);
  end loop;
  if extensions.dblink_is_busy('task7_snapshot_b') = 1 then
    perform extensions.dblink_cancel_query('task7_snapshot_b');
    raise exception 'snapshot parent delete did not finish';
  end if;
  perform result.record_key
    from extensions.dblink_get_result('task7_snapshot_b', false)
      as result(record_key text);
  child_first_error := extensions.dblink_error_message('task7_snapshot_b');
  if child_first_error = 'OK' then
    perform extensions.dblink_exec('task7_snapshot_b', 'commit');
  else
    perform extensions.dblink_exec('task7_snapshot_b', 'rollback');
  end if;

  select result.row_count
    into child_first_parent_count
    from extensions.dblink(
      'task7_snapshot_a',
      $remote$
        select count(*)::bigint
        from public.purchase_records
        where record_key = 'PO-TASK7-SNAPSHOT-CHILD-FIRST'
      $remote$
    ) as result(row_count bigint);
  select result.row_count
    into child_first_child_count
    from extensions.dblink(
      'task7_snapshot_a',
      $remote$
        select count(*)::bigint
        from public.stock_in_records
        where record_key = 'SI-TASK7-SNAPSHOT-CHILD-FIRST'
      $remote$
    ) as result(row_count bigint);
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      delete from public.stock_in_records
      where record_key = 'SI-TASK7-SNAPSHOT-CHILD-FIRST'
    $remote$
  );
  perform extensions.dblink_exec(
    'task7_snapshot_a',
    $remote$
      delete from public.purchase_records
      where record_key = 'PO-TASK7-SNAPSHOT-CHILD-FIRST'
    $remote$
  );
  perform extensions.dblink_disconnect('task7_snapshot_b');
  perform extensions.dblink_disconnect('task7_snapshot_a');

  return parent_first_error like
      '%purchase mutations require read committed isolation%'
    and child_first_error like
      '%purchase mutations require read committed isolation%'
    and parent_first_parent_count = 0
    and parent_first_child_count = 0
    and child_first_parent_count = 1
    and child_first_child_count = 1;
exception when others then
  raise notice 'snapshot purchase race probe failed: %', sqlerrm;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_snapshot_b' = any(connection_names) then
    begin
      if extensions.dblink_is_busy('task7_snapshot_b') = 1 then
        perform extensions.dblink_cancel_query('task7_snapshot_b');
      end if;
      perform extensions.dblink_exec('task7_snapshot_b', 'rollback', false);
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_snapshot_b');
  end if;
  connection_names := coalesce(
    extensions.dblink_get_connections(),
    array[]::text[]
  );
  if 'task7_snapshot_a' = any(connection_names) then
    begin
      perform extensions.dblink_exec('task7_snapshot_a', 'rollback', false);
      perform extensions.dblink_exec(
        'task7_snapshot_a',
        $remote$
          delete from public.purchase_payment_records
          where record_key = 'PP-TASK7-SNAPSHOT-PARENT-FIRST'
        $remote$,
        false
      );
      perform extensions.dblink_exec(
        'task7_snapshot_a',
        $remote$
          delete from public.stock_in_records
          where record_key = 'SI-TASK7-SNAPSHOT-CHILD-FIRST'
        $remote$,
        false
      );
      perform extensions.dblink_exec(
        'task7_snapshot_a',
        $remote$
          delete from public.purchase_records
          where record_key in (
            'PO-TASK7-SNAPSHOT-PARENT-FIRST',
            'PO-TASK7-SNAPSHOT-CHILD-FIRST'
          )
        $remote$,
        false
      );
    exception when others then
      null;
    end;
    perform extensions.dblink_disconnect('task7_snapshot_a');
  end if;
  return false;
end;
$function$;

select ok(
  pg_temp.purchase_snapshot_races_fail_closed(),
  'repeatable-read parent/child races fail closed without committing an orphan'
);

select is(
  coalesce(cardinality(extensions.dblink_get_connections()), 0),
  0,
  'all purchase race probes close every dblink connection'
);
select is(
  (
    select count(*)
    from (
      select record_key
      from public.purchase_records
      where record_key like 'PO-TASK7-%-FIRST'
         or record_key like 'PO-TASK7-SNAPSHOT-%'
         or record_key like 'PO-TASK7-REBIND-%'
         or record_key like 'PO-TASK7-%UPSERT-RACE'
         or record_key = 'PO-TASK7-COMMIT-RACE'
         or record_key = 'PO-TASK7-CHILD-DISABLE'
      union all
      select record_key
      from public.purchase_payment_records
      where record_key in (
        'PP-TASK7-PARENT-FIRST',
        'PP-TASK7-SNAPSHOT-PARENT-FIRST',
        'PP-TASK7-UPSERT-RACE'
      )
      union all
      select record_key
      from public.stock_in_records
      where record_key in (
        'SI-TASK7-CHILD-FIRST',
        'SI-TASK7-SNAPSHOT-CHILD-FIRST',
        'SI-TASK7-REBIND-NEW',
        'SI-TASK7-COMMIT-RACE',
        'SI-TASK7-CHILD-DISABLE'
      )
      union all
      select record_key
      from public.inventory_items
      where record_key = 'INV-TASK7-COMMIT-RACE'
      union all
      select id::text
      from public.employee_profiles
      where id = '73000000-0000-4000-8000-000000000002'
      union all
      select id::text
      from auth.users
      where id = '73000000-0000-4000-8000-000000000001'
      union all
      select subject_code
      from public.permission_grants
      where subject_type = 'department'
        and subject_code = '工程部'
        and permission_key in (
          'module.purchases.update',
          'module.inventory.create',
          'module.inventory.update'
        )
    ) as race_fixture
  ),
  0::bigint,
  'all remotely committed purchase race fixtures are removed'
);

select is(
  (
    with definitions as (
      select
        procedure.proname,
        pg_catalog.pg_get_functiondef(procedure.oid) as definition
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
      where namespace.nspname = 'public'
        and procedure.proname in (
          'upsert_purchase_record_secure',
          'soft_delete_purchase_record_secure',
          'commit_purchase_stock_in_secure'
        )
    ), positions as (
      select
        proname,
        strpos(definition, 'private.require_purchase_read_committed()')
          as require_pos,
        strpos(definition, 'for update') as tuple_pos,
        strpos(definition, 'select purchase.*') as purchase_pos,
        strpos(definition, 'select stock_in.*') as stock_in_pos,
        strpos(definition, 'select inventory.*') as inventory_pos,
        case
          when proname = 'commit_purchase_stock_in_secure' then strpos(
            definition,
            'private.lock_purchase_record_key(p_purchase_record_key)'
          )
          else strpos(
            definition,
            'private.lock_purchase_record_key(p_record_key)'
          )
        end as key_lock_pos
      from definitions
    )
    select count(*)
    from positions
    where require_pos > 0
      and key_lock_pos > 0
      and (
        (
          proname in (
            'upsert_purchase_record_secure',
            'soft_delete_purchase_record_secure'
          )
          and tuple_pos > require_pos
          and key_lock_pos > tuple_pos
        )
        or (
          proname = 'commit_purchase_stock_in_secure'
          and purchase_pos > require_pos
          and stock_in_pos > purchase_pos
          and inventory_pos > stock_in_pos
          and key_lock_pos > inventory_pos
        )
      )
  ),
  3::bigint,
  'every purchase mutation RPC locks existing tuples before the shared key'
);

create temporary table task7_list_results (
  scenario text not null,
  record_key text not null,
  payload jsonb not null,
  status text not null,
  updated_at timestamptz not null
) on commit drop;
grant select, insert, update, delete on table task7_list_results
  to authenticated, service_role;

create temporary table task7_mutation_results (
  scenario text primary key,
  result jsonb not null
) on commit drop;
grant select, insert, update, delete on table task7_mutation_results
  to authenticated, service_role;

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'task7-purchase-accrual@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'task7-purchase-sensitive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'task7-purchase-none@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'task7-purchase-disabled@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'task7-purchase-create-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'task7-purchase-update-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'task7-purchase-delete-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'task7-inventory-view-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'task7-inventory-edit-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'task7-payment-view-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'task7-both-facts-view@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '71000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'task7-payment-edit-only@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles (
  id,
  employee_number,
  auth_user_id,
  name,
  department,
  position,
  employment_status,
  account_status,
  must_change_password,
  is_hidden_system_account
) values
  ('72000000-0000-4000-8000-000000000001', 'SW-7201', '71000000-0000-4000-8000-000000000001', '采购权责测试员工', '采购部', '部长', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000002', 'SW-7202', '71000000-0000-4000-8000-000000000002', '采购付款测试员工', '财务部', '会计', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000003', 'SW-7203', '71000000-0000-4000-8000-000000000003', '无采购权限员工', '电商部', '主任', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000004', 'SW-7204', '71000000-0000-4000-8000-000000000004', '停用采购员工', '仓库管理部', '仓库管理员', '在职', 'disabled', false, false),
  ('72000000-0000-4000-8000-000000000005', 'SW-7205', '71000000-0000-4000-8000-000000000005', '仅新建采购员工', '后勤部', '大工', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000006', 'SW-7206', '71000000-0000-4000-8000-000000000006', '仅更新采购员工', '事务部', '中工', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000007', 'SW-7207', '71000000-0000-4000-8000-000000000007', '仅删除采购员工', '设计部', '职长', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000008', 'SW-7208', '71000000-0000-4000-8000-000000000008', '库存只读测试员工', '总务部', '主任设计师', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000009', 'SW-7209', '71000000-0000-4000-8000-000000000009', '库存编辑测试员工', '总务部', '设计师', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000010', 'SW-7210', '71000000-0000-4000-8000-000000000010', '付款只读测试员工', '总务部', '工事部长', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000011', 'SW-7211', '71000000-0000-4000-8000-000000000011', '双事实查看测试员工', '总务部', '会计主管', '在职', 'active', false, false),
  ('72000000-0000-4000-8000-000000000012', 'SW-7212', '71000000-0000-4000-8000-000000000012', '付款编辑测试员工', '总务部', '社长', '在职', 'active', false, false);

delete from public.permission_grants
where (
    (
      subject_type = 'department'
      and subject_code in (
        '采购部', '财务部', '电商部', '仓库管理部', '后勤部', '事务部',
        '设计部', '总务部'
      )
    )
    or (
      subject_type = 'position'
      and subject_code in (
        '小工', '主任设计师', '设计师', '工事部长', '会计主管', '社长'
      )
    )
  )
  and (
    permission_key like 'module.purchases.%'
    or permission_key like 'module.inventory.%'
    or permission_key like 'sensitive.purchase_payments_%'
  );

insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
) values
  ('department', '采购部', 'module.purchases.view'),
  ('department', '采购部', 'module.purchases.create'),
  ('department', '采购部', 'module.purchases.update'),
  ('department', '采购部', 'module.purchases.delete'),
  ('department', '采购部', 'module.inventory.view'),
  ('department', '采购部', 'module.inventory.create'),
  ('department', '采购部', 'module.inventory.update'),
  ('department', '财务部', 'module.purchases.view'),
  ('department', '财务部', 'module.purchases.create'),
  ('department', '财务部', 'module.purchases.update'),
  ('department', '财务部', 'module.purchases.delete'),
  ('department', '财务部', 'sensitive.purchase_payments_view'),
  ('department', '财务部', 'sensitive.purchase_payments_update'),
  ('department', '仓库管理部', 'module.purchases.view'),
  ('department', '后勤部', 'module.purchases.create'),
  ('department', '事务部', 'module.purchases.update'),
  ('department', '设计部', 'module.purchases.delete'),
  ('position', '主任设计师', 'module.purchases.view'),
  ('position', '主任设计师', 'module.purchases.delete'),
  ('position', '主任设计师', 'module.inventory.view'),
  ('position', '设计师', 'module.purchases.view'),
  ('position', '设计师', 'module.purchases.delete'),
  ('position', '设计师', 'module.inventory.create'),
  ('position', '设计师', 'module.inventory.update'),
  ('position', '工事部长', 'module.purchases.view'),
  ('position', '工事部长', 'module.purchases.delete'),
  ('position', '工事部长', 'sensitive.purchase_payments_view'),
  ('position', '会计主管', 'module.purchases.view'),
  ('position', '会计主管', 'module.purchases.delete'),
  ('position', '会计主管', 'module.inventory.view'),
  ('position', '会计主管', 'sensitive.purchase_payments_view'),
  ('position', '社长', 'module.purchases.view'),
  ('position', '社长', 'module.purchases.delete'),
  ('position', '社长', 'sensitive.purchase_payments_update');

insert into public.purchase_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'PO-TASK7-001',
    '{
      "purchaseId":"PO-TASK7-001",
      "purchaseDate":"2026-07-16",
      "itemName":"迁移前采购",
      "totalCost":80000,
      "purchaseStatus":"正常",
      "openingPaidAmount":10000,
      "paidAmount":20000,
      "unpaidAmount":60000,
      "paymentStatus":"部分付款"
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-DELETED',
    '{
      "purchaseId":"PO-TASK7-DELETED",
      "itemName":"已删除采购",
      "totalCost":1000,
      "paidAmount":500
    }'::jsonb,
    'deleted',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-STOCK',
    '{
      "purchaseId":"PO-TASK7-STOCK",
      "itemName":"库存测试铜管",
      "specification":"20米",
      "quantity":10,
      "unit":"卷",
      "totalCost":10000,
      "stockInStatus":"未入库",
      "paidAmount":4000,
      "unpaidAmount":6000,
      "paymentStatus":"部分付款"
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-GUARD-UPDATE',
    '{"purchaseId":"PO-TASK7-GUARD-UPDATE","itemName":"直接更新守卫"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-GUARD-DELETE',
    '{"purchaseId":"PO-TASK7-GUARD-DELETE","itemName":"直接删除守卫"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-PAYMENT-LINKED',
    '{"purchaseId":"PO-TASK7-PAYMENT-LINKED","itemName":"已有付款事实"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-STOCK-LINKED',
    '{"purchaseId":"PO-TASK7-STOCK-LINKED","itemName":"已有入库事实"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-DELETE-ONLY',
    '{"purchaseId":"PO-TASK7-DELETE-ONLY","itemName":"仅删除权限目标"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PO-TASK7-BOTH-LINKED',
    '{"purchaseId":"PO-TASK7-BOTH-LINKED","itemName":"付款入库双事实"}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );

insert into public.purchase_payment_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'PP-TASK7-PURCHASE-LINK',
    '{"paymentId":"PP-TASK7-PURCHASE-LINK","purchaseId":"PO-TASK7-PAYMENT-LINKED","jpyAmount":1000}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'PP-TASK7-BOTH-LINK',
    '{"paymentId":"PP-TASK7-BOTH-LINK","purchaseId":"PO-TASK7-BOTH-LINKED","jpyAmount":2000}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );

insert into public.stock_in_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'SI-TASK7-DELETED',
    '{
      "stockInId":"SI-TASK7-DELETED",
      "sourcePurchaseId":"PO-TASK7-STOCK",
      "stockInQuantity":1
    }'::jsonb,
    'deleted',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-PURCHASE-LINK',
    '{
      "stockInId":"SI-TASK7-PURCHASE-LINK",
      "sourcePurchaseId":"PO-TASK7-STOCK-LINKED",
      "stockInQuantity":1
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-BOTH-LINK',
    '{
      "stockInId":"SI-TASK7-BOTH-LINK",
      "sourcePurchaseId":"PO-TASK7-BOTH-LINKED",
      "stockInQuantity":2
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );

insert into public.inventory_items (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values (
  'INV-TASK7-DELETED',
  '{"inventoryId":"INV-TASK7-DELETED","itemName":"已删除库存"}'::jsonb,
  'deleted',
  'seed-creator',
  '种子创建人',
  'seed-updater',
  '种子更新人'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$insert into pg_temp.task7_list_results (
      scenario, record_key, payload, status, updated_at
    )
    select
      'accrual-list', listed.record_key, listed.payload, listed.status, listed.updated_at
    from public.list_purchase_records_secure() as listed$$,
  'an active purchase viewer can call the secure list RPC'
);
select is(
  (select count(*) from task7_list_results where scenario = 'accrual-list'),
  8::bigint,
  'the secure list excludes deleted records'
);
select ok(
  (
    select payload @> '{
        "purchaseId":"PO-TASK7-001",
        "itemName":"迁移前采购",
        "totalCost":80000
      }'::jsonb
      and not payload ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and status = 'active'
      and updated_at is not null
    from task7_list_results
    where scenario = 'accrual-list'
      and record_key = 'PO-TASK7-001'
  ),
  'module-only purchase view returns accrual fields in the standard envelope without payment fields'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from public.list_purchase_records_secure()$$,
  '42501',
  'purchase view permission required',
  'an active employee without the purchase module receives 42501'
);
select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key, payload, status
    ) values (
      'PP-TASK7-NO-PERM-ACTIVE',
      '{"paymentId":"PP-TASK7-NO-PERM-ACTIVE","purchaseId":"PO-TASK7-PAYMENT-LINKED"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase fact insert permission required',
  'an unauthorized payment insert is rejected before an active parent lookup'
);
select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key, payload, status
    ) values (
      'PP-TASK7-NO-PERM-MISSING',
      '{"paymentId":"PP-TASK7-NO-PERM-MISSING","purchaseId":"PO-TASK7-NO-SUCH-PARENT"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase fact insert permission required',
  'an unauthorized payment insert gets the same rejection for a missing parent'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key, payload, status
    ) values (
      'SI-TASK7-NO-PERM-ACTIVE',
      '{"stockInId":"SI-TASK7-NO-PERM-ACTIVE","sourcePurchaseId":"PO-TASK7-STOCK-LINKED"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase fact insert permission required',
  'an unauthorized stock-in insert is rejected before an active parent lookup'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key, payload, status
    ) values (
      'SI-TASK7-NO-PERM-MISSING',
      '{"stockInId":"SI-TASK7-NO-PERM-MISSING","sourcePurchaseId":"PO-TASK7-NO-SUCH-PARENT"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase fact insert permission required',
  'an unauthorized stock-in insert gets the same rejection for a missing parent'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_purchase_records_secure()$$,
  '42501',
  'purchase view permission required',
  'an inactive purchase-module employee receives 42501'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-NON-OBJECT',
      '[]'::jsonb,
      'active'
    )$$,
  '22023',
  'purchase payload must be a JSON object',
  'purchase upsert rejects a non-object JSON payload'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      '   ',
      '{}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a blank record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      ' PO-TASK7-001 ',
      '{"purchaseId":" PO-TASK7-001 "}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a record key that differs from its trimmed form'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7;SELECT-pg_sleep',
      '{"purchaseId":"PO-TASK7;SELECT-pg_sleep"}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a semicolon injection-shaped record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-''-DROP',
      '{"purchaseId":"PO-TASK7-''-DROP"}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a quote injection-shaped record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7/../../AUTH',
      '{"purchaseId":"PO-TASK7/../../AUTH"}'::jsonb,
      'active'
    )$$,
  '22023',
  'valid purchase record key required',
  'purchase upsert rejects a path traversal-shaped record key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UNSAFE-PROTO',
      '{
        "purchaseId":"PO-TASK7-UNSAFE-PROTO",
        "__proto__":{"polluted":true}
      }'::jsonb,
      'active'
    )$$,
  '22023',
  'unsafe purchase payload key',
  'purchase upsert rejects a top-level __proto__ key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UNSAFE-CONSTRUCTOR',
      '{
        "purchaseId":"PO-TASK7-UNSAFE-CONSTRUCTOR",
        "nested":{"constructor":{"polluted":true}}
      }'::jsonb,
      'active'
    )$$,
  '22023',
  'unsafe purchase payload key',
  'purchase upsert rejects a nested constructor key'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UNSAFE-PROTOTYPE',
      '{
        "purchaseId":"PO-TASK7-UNSAFE-PROTOTYPE",
        "nested":[{"prototype":{"polluted":true}}]
      }'::jsonb,
      'active'
    )$$,
  '22023',
  'unsafe purchase payload key',
  'purchase upsert rejects a prototype key nested through an array'
);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'accrual-update',
      public.upsert_purchase_record_secure(
        'PO-TASK7-001',
        '{
          "purchaseId":"PO-TASK7-001",
          "itemName":"权责字段更新",
          "paidAmount":79999,
          "unpaidAmount":1,
          "paymentStatus":"已付清"
        }'::jsonb,
        'active'
      )
    )$$,
  'a module-only updater can update purchase accrual fields'
);
select ok(
  (
    select result->'payload'->>'itemName' = '权责字段更新'
      and not (result->'payload') ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and result->>'record_key' = 'PO-TASK7-001'
      and result->>'status' = 'active'
      and result ? 'updated_at'
    from task7_mutation_results
    where scenario = 'accrual-update'
  ),
  'a module-only upsert response is bound to the record and remains payment-redacted'
);

select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001","createdByEmployeeName":"伪造审计"}'::jsonb,
      'active'
    )$$,
  '22023',
  'client audit fields are not accepted',
  'purchase upsert rejects client-supplied audit identity fields'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001"}'::jsonb,
      'deleted'
    )$$,
  '22023',
  'purchase status must be active',
  'purchase upsert cannot request deleted status'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001"}'::jsonb,
      'void'
    )$$,
  '22023',
  'purchase status must be active',
  'purchase upsert cannot request void status'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-OTHER"}'::jsonb,
      'active'
    )$$,
  '22023',
  'purchase record key mismatch',
  'purchase upsert rejects a payload key mismatch'
);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-DELETED',
      '{"purchaseId":"PO-TASK7-DELETED","itemName":"禁止恢复"}'::jsonb,
      'active'
    )$$,
  'P0002',
  'purchase record not found',
  'purchase upsert cannot resurrect a deleted row'
);

reset role;
select is(
  (select payload->>'itemName' from public.purchase_records where record_key = 'PO-TASK7-001'),
  '权责字段更新'::text,
  'module-only update stores the requested accrual change'
);
select is(
  (
    select jsonb_build_object(
      'openingPaidAmount', payload->'openingPaidAmount',
      'paidAmount', payload->'paidAmount',
      'unpaidAmount', payload->'unpaidAmount',
      'paymentStatus', payload->'paymentStatus'
    )
    from public.purchase_records
    where record_key = 'PO-TASK7-001'
  ),
  '{
    "openingPaidAmount":10000,
    "paidAmount":20000,
    "unpaidAmount":60000,
    "paymentStatus":"部分付款"
  }'::jsonb,
  'module-only update preserves every server-side payment field'
);
select is(
  (
    select updated_by_employee_id || ':' || updated_by_employee_name
    from public.purchase_records
    where record_key = 'PO-TASK7-001'
  ),
  '72000000-0000-4000-8000-000000000001:采购权责测试员工'::text,
  'purchase update audit identity comes from auth.uid()'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001","itemName":"越权覆盖"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase update permission required',
  'create-only permission cannot overwrite an existing purchase'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-UPDATE-ONLY',
      '{"purchaseId":"PO-TASK7-UPDATE-ONLY","itemName":"越权新建"}'::jsonb,
      'active'
    )$$,
  '42501',
  'purchase create permission required',
  'update-only permission cannot create a missing purchase'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'sensitive-update',
      public.upsert_purchase_record_secure(
        'PO-TASK7-001',
        '{
          "purchaseId":"PO-TASK7-001",
          "openingPaidAmount":11000,
          "paidAmount":30000,
          "unpaidAmount":50000,
          "paymentStatus":"部分付款"
        }'::jsonb,
        'active'
      )
    )$$,
  'a payment-sensitive updater can update purchase payment fields'
);
select ok(
  (
    select (result->'payload') @> '{
        "openingPaidAmount":11000,
        "paidAmount":30000,
        "unpaidAmount":50000,
        "paymentStatus":"部分付款"
      }'::jsonb
    from task7_mutation_results
    where scenario = 'sensitive-update'
  ),
  'a payment-sensitive updater receives the updated payment fields'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'accrual-create',
      public.upsert_purchase_record_secure(
        'PO-TASK7-CREATED',
        '{
          "purchaseId":"PO-TASK7-CREATED",
          "purchaseDate":"2026-07-17",
          "itemName":"新建权责采购",
          "totalCost":5000,
          "openingPaidAmount":1000,
          "paidAmount":1000,
          "unpaidAmount":4000,
          "paymentStatus":"部分付款"
        }'::jsonb,
        'active'
      )
    )$$,
  'a module-only creator can create an accrual purchase while payment input is stripped'
);
select ok(
  (
    select result->'payload' @> '{
        "purchaseId":"PO-TASK7-CREATED",
        "itemName":"新建权责采购",
        "totalCost":5000
      }'::jsonb
      and not (result->'payload') ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
    from task7_mutation_results
    where scenario = 'accrual-create'
  ),
  'module-only create response contains accrual fields and no payment fields'
);

reset role;
select ok(
  (
    select payload @> '{
        "purchaseId":"PO-TASK7-CREATED",
        "itemName":"新建权责采购",
        "totalCost":5000
      }'::jsonb
      and not payload ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and created_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and created_by_employee_name = '采购权责测试员工'
      and updated_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and updated_by_employee_name = '采购权责测试员工'
      and status = 'active'
    from public.purchase_records
    where record_key = 'PO-TASK7-CREATED'
  ),
  'module-only create strips payment fields and writes server-derived audit identity'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'soft-delete',
      to_jsonb(public.soft_delete_purchase_record_secure('PO-TASK7-CREATED'))
    )$$,
  'an authorized purchase deleter can use the soft-delete RPC'
);
select is(
  (select result from task7_mutation_results where scenario = 'soft-delete'),
  '"PO-TASK7-CREATED"'::jsonb,
  'soft-delete returns the exact deleted record key'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-CREATED')$$,
  '23503',
  'purchase record cannot be deleted',
  'a payment-blind deleter gets no linked-fact oracle for a soft-deleted purchase'
);

reset role;
select ok(
  (
    select status = 'deleted'
      and updated_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and updated_by_employee_name = '采购权责测试员工'
    from public.purchase_records
    where record_key = 'PO-TASK7-CREATED'
  ),
  'soft-delete changes only server-controlled state and audit identity'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'an active payment blocks a payment-blind deleter with a generic rejection'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'a purchase and inventory viewer receives the stock-in linked-fact advisory'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'a payment-sensitive deleter receives the linked-fact advisory'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'a finance actor without inventory view cannot infer a stock-in-only dependency'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000008', true);
select ok(
  public.has_current_permission('module.inventory.view')
    and not public.has_current_permission('module.inventory.create')
    and not public.has_current_permission('module.inventory.update')
    and not public.has_current_permission('sensitive.purchase_payments_view'),
  'the inventory-view actor has no inventory edit or payment-view permission'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'inventory view alone authorizes a stock-in-only linked advisory'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'inventory view alone does not authorize a payment linked advisory'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-BOTH-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'inventory view alone cannot reveal a parent with both fact types'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-MISSING')$$,
  '23503',
  'purchase record cannot be deleted',
  'inventory view without payment view gets a generic missing-parent rejection'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000009', true);
select ok(
  not public.has_current_permission('module.inventory.view')
    and public.has_current_permission('module.inventory.create')
    and public.has_current_permission('module.inventory.update'),
  'inventory edit permission does not imply inventory view'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'inventory edit without view cannot reveal a stock-in dependency'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000010', true);
select ok(
  public.has_current_permission('sensitive.purchase_payments_view')
    and not public.has_current_permission('sensitive.purchase_payments_update')
    and not public.has_current_permission('module.inventory.view'),
  'the payment-view actor has no payment edit or inventory-view permission'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'payment view alone authorizes a payment-only linked advisory'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-BOTH-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'payment view alone cannot reveal a parent with both fact types'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-MISSING')$$,
  'P0002',
  'purchase record not found',
  'payment view with purchase view receives the missing-parent result'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000012', true);
select ok(
  not public.has_current_permission('sensitive.purchase_payments_view')
    and public.has_current_permission('sensitive.purchase_payments_update'),
  'payment edit permission does not imply payment view'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'payment edit without view cannot reveal a payment dependency'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000011', true);
select ok(
  public.has_current_permission('module.inventory.view')
    and public.has_current_permission('sensitive.purchase_payments_view')
    and not public.has_current_permission('module.inventory.update')
    and not public.has_current_permission('sensitive.purchase_payments_update'),
  'the dual-view actor has both view permissions and no edit permission'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-BOTH-LINKED')$$,
  '23503',
  'purchase record has linked facts',
  'both view permissions authorize a dual-fact linked advisory'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-MISSING')$$,
  'P0002',
  'purchase record not found',
  'both linked-fact view permissions preserve the missing-parent result'
);

reset role;
select is(
  (
    select count(*)
    from public.purchase_records
    where record_key in ('PO-TASK7-PAYMENT-LINKED', 'PO-TASK7-STOCK-LINKED')
      and status = 'active'
  ),
  2::bigint,
  'linked purchase rows remain active after rejected deletes'
);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_ok(
  $statement$do $attempt$
    begin
      update public.purchase_records
      set record_key = 'PO-TASK7-PAYMENT-REBOUND'
      where record_key = 'PO-TASK7-PAYMENT-LINKED';
      raise exception using
        errcode = 'P0001',
        message = 'unsafe purchase rebind was accepted';
    end
  $attempt$
  $statement$,
  '23503',
  'purchase record has linked facts',
  'service_role cannot rebind a purchase parent with an active payment'
);
select throws_ok(
  $statement$do $attempt$
    begin
      update public.purchase_records
      set record_key = 'PO-TASK7-STOCK-REBOUND'
      where record_key = 'PO-TASK7-STOCK-LINKED';
      raise exception using
        errcode = 'P0001',
        message = 'unsafe purchase rebind was accepted';
    end
  $attempt$
  $statement$,
  '23503',
  'purchase record has linked facts',
  'service_role cannot rebind a purchase parent with an active stock-in'
);
select throws_ok(
  $$update public.purchase_records
    set status = 'deleted'
    where record_key = 'PO-TASK7-PAYMENT-LINKED'$$,
  '23503',
  'purchase record has linked facts',
  'service_role cannot deactivate a purchase parent with active linked facts'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000007', true);
select ok(
  public.has_current_permission('module.purchases.delete')
    and not public.has_current_permission('module.purchases.view')
    and not public.has_current_permission('module.purchases.create')
    and not public.has_current_permission('module.purchases.update')
    and not public.has_current_permission('sensitive.purchase_payments_view')
    and not public.has_current_permission('sensitive.purchase_payments_update'),
  'the delete-only actor has no purchase read/write or payment-sensitive permission'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-PAYMENT-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'a delete-only actor cannot distinguish a payment-linked purchase'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-STOCK-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'a delete-only actor cannot distinguish a stock-linked purchase'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-BOTH-LINKED')$$,
  '23503',
  'purchase record cannot be deleted',
  'an actor without either view permission cannot distinguish dual linked facts'
);
select throws_ok(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-MISSING')$$,
  '23503',
  'purchase record cannot be deleted',
  'a delete-only actor receives the same rejection for an unavailable purchase'
);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'delete-only',
      to_jsonb(public.soft_delete_purchase_record_secure('PO-TASK7-DELETE-ONLY'))
    )$$,
  'a delete-only actor can delete an unlinked purchase'
);

reset role;
select ok(
  (
    select status = 'deleted'
      and updated_by_employee_id = '72000000-0000-4000-8000-000000000007'
      and updated_by_employee_name = '仅删除采购员工'
    from public.purchase_records
    where record_key = 'PO-TASK7-DELETE-ONLY'
  ),
  'delete-only purchase deletion records the server-derived actor'
);

select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      'PP-TASK7-AFTER-DELETE',
      '{"paymentId":"PP-TASK7-AFTER-DELETE","purchaseId":"PO-TASK7-DELETE-ONLY"}'::jsonb,
      'active',
      'seed-creator',
      '种子创建人',
      'seed-updater',
      '种子更新人'
    )$$,
  '23503',
  'active purchase record required',
  'a payment write ordered after purchase deletion cannot create an orphan'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      'SI-TASK7-AFTER-DELETE',
      '{"stockInId":"SI-TASK7-AFTER-DELETE","sourcePurchaseId":"PO-TASK7-DELETE-ONLY"}'::jsonb,
      'active',
      'seed-creator',
      '种子创建人',
      'seed-updater',
      '种子更新人'
    )$$,
  '23503',
  'active purchase record required',
  'a stock-in write ordered after purchase deletion cannot create an orphan'
);
select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key, payload, status
    ) values (
      'PP-TASK7-WHITESPACE-LINK',
      '{"paymentId":"PP-TASK7-WHITESPACE-LINK","purchaseId":" PO-TASK7-PAYMENT-LINKED "}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active payment rejects a whitespace-normalized purchase link'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key, payload, status
    ) values (
      'SI-TASK7-WHITESPACE-LINK',
      '{"stockInId":"SI-TASK7-WHITESPACE-LINK","sourcePurchaseId":" PO-TASK7-STOCK-LINKED "}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active stock-in rejects a whitespace-normalized purchase link'
);
select throws_ok(
  $$insert into public.purchase_payment_records (
      record_key, payload, status
    ) values (
      'PP-TASK7-MISSING-LINK',
      '{"paymentId":"PP-TASK7-MISSING-LINK"}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active payment cannot omit its purchase link'
);
select throws_ok(
  $$insert into public.stock_in_records (
      record_key, payload, status
    ) values (
      'SI-TASK7-BLANK-LINK',
      '{"stockInId":"SI-TASK7-BLANK-LINK","sourcePurchaseId":""}'::jsonb,
      'active'
    )$$,
  '23503',
  'active purchase record required',
  'an active stock-in cannot use a blank purchase link'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '[]'::jsonb,
      'SI-TASK7-OBJECT-PURCHASE',
      '{"stockInId":"SI-TASK7-OBJECT-PURCHASE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-OBJECT-PURCHASE',
      '{"inventoryId":"INV-TASK7-OBJECT-PURCHASE"}'::jsonb
    )$$,
  '22023',
  'purchase payload must be a JSON object',
  'stock-in commit requires an object purchase patch'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-OBJECT-STOCK',
      '[]'::jsonb,
      'INV-TASK7-OBJECT-STOCK',
      '{"inventoryId":"INV-TASK7-OBJECT-STOCK"}'::jsonb
    )$$,
  '22023',
  'stock-in payload must be a JSON object',
  'stock-in commit requires an object stock-in payload'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-OBJECT-INVENTORY',
      '{"stockInId":"SI-TASK7-OBJECT-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-OBJECT-INVENTORY',
      '[]'::jsonb
    )$$,
  '22023',
  'inventory payload must be a JSON object',
  'stock-in commit requires an object inventory payload'
);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-OTHER"}'::jsonb,
      'SI-TASK7-MISMATCH-PURCHASE',
      '{"stockInId":"SI-TASK7-MISMATCH-PURCHASE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-MISMATCH-PURCHASE',
      '{"inventoryId":"INV-TASK7-MISMATCH-PURCHASE"}'::jsonb
    )$$,
  '22023',
  'purchase record key mismatch',
  'stock-in commit binds the purchase patch ID to its record key'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-MISMATCH-STOCK',
      '{"stockInId":"SI-TASK7-OTHER","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-MISMATCH-STOCK',
      '{"inventoryId":"INV-TASK7-MISMATCH-STOCK"}'::jsonb
    )$$,
  '22023',
  'stock-in record key mismatch',
  'stock-in commit binds the stock-in payload ID to its record key'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-MISMATCH-INVENTORY',
      '{"stockInId":"SI-TASK7-MISMATCH-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-MISMATCH-INVENTORY',
      '{"inventoryId":"INV-TASK7-OTHER"}'::jsonb
    )$$,
  '22023',
  'inventory record key mismatch',
  'stock-in commit binds the inventory payload ID to its record key'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-MISMATCH-SOURCE',
      '{"stockInId":"SI-TASK7-MISMATCH-SOURCE","sourcePurchaseId":"PO-TASK7-OTHER"}'::jsonb,
      'INV-TASK7-MISMATCH-SOURCE',
      '{"inventoryId":"INV-TASK7-MISMATCH-SOURCE"}'::jsonb
    )$$,
  '22023',
  'stock-in purchase key mismatch',
  'stock-in commit binds the stock-in source to the purchase key'
);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","__proto__":{"polluted":true}}'::jsonb,
      'SI-TASK7-UNSAFE-PURCHASE',
      '{"stockInId":"SI-TASK7-UNSAFE-PURCHASE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-UNSAFE-PURCHASE',
      '{"inventoryId":"INV-TASK7-UNSAFE-PURCHASE"}'::jsonb
    )$$,
  '22023',
  'unsafe purchase payload key',
  'stock-in commit rejects unsafe purchase patch keys'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-UNSAFE-STOCK',
      '{
        "stockInId":"SI-TASK7-UNSAFE-STOCK",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "nested":{"constructor":{"polluted":true}}
      }'::jsonb,
      'INV-TASK7-UNSAFE-STOCK',
      '{"inventoryId":"INV-TASK7-UNSAFE-STOCK"}'::jsonb
    )$$,
  '22023',
  'unsafe purchase payload key',
  'stock-in commit rejects unsafe stock-in payload keys recursively'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-UNSAFE-INVENTORY',
      '{"stockInId":"SI-TASK7-UNSAFE-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-UNSAFE-INVENTORY',
      '{
        "inventoryId":"INV-TASK7-UNSAFE-INVENTORY",
        "nested":[{"prototype":{"polluted":true}}]
      }'::jsonb
    )$$,
  '22023',
  'unsafe purchase payload key',
  'stock-in commit rejects unsafe inventory payload keys recursively'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-AUDIT-STOCK',
      '{
        "stockInId":"SI-TASK7-AUDIT-STOCK",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "updated_by_employee_id":"forged"
      }'::jsonb,
      'INV-TASK7-AUDIT-STOCK',
      '{"inventoryId":"INV-TASK7-AUDIT-STOCK"}'::jsonb
    )$$,
  '22023',
  'client audit fields are not accepted',
  'stock-in commit rejects audit identity in the stock-in payload'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-AUDIT-INVENTORY',
      '{"stockInId":"SI-TASK7-AUDIT-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-AUDIT-INVENTORY',
      '{
        "inventoryId":"INV-TASK7-AUDIT-INVENTORY",
        "createdByEmployeeName":"forged"
      }'::jsonb
    )$$,
  '22023',
  'client audit fields are not accepted',
  'stock-in commit rejects audit identity in the inventory payload'
);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-DELETED',
      '{"stockInId":"SI-TASK7-DELETED","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-DELETED-STOCK',
      '{"inventoryId":"INV-TASK7-DELETED-STOCK"}'::jsonb
    )$$,
  'P0002',
  'stock-in record not found',
  'stock-in commit cannot resurrect a deleted stock-in row'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-DELETED-INVENTORY',
      '{"stockInId":"SI-TASK7-DELETED-INVENTORY","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-DELETED',
      '{"inventoryId":"INV-TASK7-DELETED"}'::jsonb
    )$$,
  'P0002',
  'inventory record not found',
  'stock-in commit cannot resurrect a deleted inventory row'
);

select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'stock-in-create',
      public.commit_purchase_stock_in_secure(
        'PO-TASK7-STOCK',
        '{
          "purchaseId":"PO-TASK7-STOCK",
          "stockInStatus":"部分入库",
          "paidAmount":999999
        }'::jsonb,
        'SI-TASK7-001',
        '{
          "stockInId":"SI-TASK7-001",
          "sourcePurchaseId":"PO-TASK7-STOCK",
          "stockInQuantity":2,
          "warehouseLocation":"A区"
        }'::jsonb,
        'INV-TASK7-001',
        '{
          "inventoryId":"INV-TASK7-001",
          "itemName":"库存测试铜管",
          "quantity":2,
          "averageCost":1000,
          "totalCost":2000
        }'::jsonb
      )
    )$$,
  'stock-in commit atomically inserts stock-in and inventory rows and patches purchase accrual state'
);
select ok(
  (
    select result->'purchase'->>'record_key' = 'PO-TASK7-STOCK'
      and result->'purchase'->'payload'->>'stockInStatus' = '部分入库'
      and not (result->'purchase'->'payload') ?| array[
        'openingPaidAmount', 'paidAmount', 'unpaidAmount', 'paymentStatus'
      ]::text[]
      and result->'stock_in'->>'record_key' = 'SI-TASK7-001'
      and result->'stock_in'->'payload'->>'sourcePurchaseId' = 'PO-TASK7-STOCK'
      and result->'inventory_item'->>'record_key' = 'INV-TASK7-001'
      and result->'inventory_item'->'payload'->>'inventoryId' = 'INV-TASK7-001'
    from task7_mutation_results
    where scenario = 'stock-in-create'
  ),
  'stock-in commit returns the approved three envelopes with purchase payment redaction'
);

reset role;
select ok(
  (
    select purchase.payload->>'stockInStatus' = '部分入库'
      and purchase.payload->>'paidAmount' = '4000'
      and purchase.updated_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and stock_in.payload->>'stockInId' = 'SI-TASK7-001'
      and stock_in.status = 'active'
      and stock_in.created_by_employee_id = '72000000-0000-4000-8000-000000000001'
      and inventory.payload->>'inventoryId' = 'INV-TASK7-001'
      and inventory.status = 'active'
      and inventory.created_by_employee_id = '72000000-0000-4000-8000-000000000001'
    from public.purchase_records as purchase
    cross join public.stock_in_records as stock_in
    cross join public.inventory_items as inventory
    where purchase.record_key = 'PO-TASK7-STOCK'
      and stock_in.record_key = 'SI-TASK7-001'
      and inventory.record_key = 'INV-TASK7-001'
  ),
  'stock-in commit persists all three rows with server audit and preserves payment data'
);

select ok(
  (
    select stock_in.payload ? 'stockInId'
      and jsonb_typeof(stock_in.payload->'stockInId') = 'string'
      and stock_in.payload->>'stockInId' = stock_in.record_key
      and stock_in.payload ? 'sourcePurchaseId'
      and jsonb_typeof(stock_in.payload->'sourcePurchaseId') = 'string'
      and stock_in.payload->>'sourcePurchaseId' = 'PO-TASK7-STOCK'
    from public.stock_in_records as stock_in
    where stock_in.record_key = 'SI-TASK7-001'
  ),
  'the existing stock-in fixture has own string IDs bound to purchase A'
);

-- Seed deliberately corrupt legacy rows without exercising the new-write guard;
-- the following RPC assertions prove those rows still fail closed.
set local session_replication_role = replica;
insert into public.stock_in_records (
  record_key,
  payload,
  status,
  created_by_employee_id,
  created_by_employee_name,
  updated_by_employee_id,
  updated_by_employee_name
) values
  (
    'SI-TASK7-BINDING-NO-ID',
    '{"sourcePurchaseId":"PO-TASK7-STOCK","stockInQuantity":1}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-BINDING-WRONG-ID',
    '{
      "stockInId":"SI-TASK7-BINDING-OTHER",
      "sourcePurchaseId":"PO-TASK7-STOCK",
      "stockInQuantity":1
    }'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  ),
  (
    'SI-TASK7-BINDING-NO-SOURCE',
    '{"stockInId":"SI-TASK7-BINDING-NO-SOURCE","stockInQuantity":1}'::jsonb,
    'active',
    'seed-creator',
    '种子创建人',
    'seed-updater',
    '种子更新人'
  );
set local session_replication_role = origin;

create temporary table task7_stock_binding_snapshot (
  state jsonb not null
) on commit drop;

insert into task7_stock_binding_snapshot (state)
select jsonb_build_object(
  'purchase_a', to_jsonb(purchase_a),
  'purchase_b', to_jsonb(purchase_b),
  'stock_in', to_jsonb(stock_in),
  'inventory_item', to_jsonb(inventory_item)
)
from public.purchase_records as purchase_a
cross join public.purchase_records as purchase_b
cross join public.stock_in_records as stock_in
cross join public.inventory_items as inventory_item
where purchase_a.record_key = 'PO-TASK7-STOCK'
  and purchase_b.record_key = 'PO-TASK7-001'
  and stock_in.record_key = 'SI-TASK7-001'
  and inventory_item.record_key = 'INV-TASK7-001';

create or replace function pg_temp.block_task7_stock_binding_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'stock-in binding validation reached a mutation';
end;
$function$;

create trigger task7_block_stock_binding_purchase_mutation
before insert or update or delete on public.purchase_records
for each row execute function pg_temp.block_task7_stock_binding_mutation();
create trigger task7_block_stock_binding_stock_in_mutation
before insert or update or delete on public.stock_in_records
for each row execute function pg_temp.block_task7_stock_binding_mutation();
create trigger task7_block_stock_binding_inventory_mutation
before insert or update or delete on public.inventory_items
for each row execute function pg_temp.block_task7_stock_binding_mutation();

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"missing persisted stock ID"}'::jsonb,
      'SI-TASK7-BINDING-NO-ID',
      '{
        "stockInId":"SI-TASK7-BINDING-NO-ID",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":2
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":2}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in commit rejects an existing row with a missing persisted stockInId before mutation'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"wrong persisted stock ID"}'::jsonb,
      'SI-TASK7-BINDING-WRONG-ID',
      '{
        "stockInId":"SI-TASK7-BINDING-WRONG-ID",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":2
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":2}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in commit rejects an existing row with a different persisted stockInId before mutation'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"missing persisted purchase ID"}'::jsonb,
      'SI-TASK7-BINDING-NO-SOURCE',
      '{
        "stockInId":"SI-TASK7-BINDING-NO-SOURCE",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":2
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":2}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in commit rejects an existing row with a missing persisted sourcePurchaseId before mutation'
);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-001',
      '{"purchaseId":"PO-TASK7-001","stockInStatus":"cross-purchase reuse"}'::jsonb,
      'SI-TASK7-001',
      '{
        "stockInId":"SI-TASK7-001",
        "sourcePurchaseId":"PO-TASK7-001",
        "stockInQuantity":99
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":99}'::jsonb
    )$$,
  '22023',
  'stock-in record binding mismatch',
  'stock-in key bound to purchase A cannot be reused in a commit for purchase B'
);

reset role;
select is(
  (
    select jsonb_build_object(
      'purchase_a', to_jsonb(purchase_a),
      'purchase_b', to_jsonb(purchase_b),
      'stock_in', to_jsonb(stock_in),
      'inventory_item', to_jsonb(inventory_item)
    )
    from public.purchase_records as purchase_a
    cross join public.purchase_records as purchase_b
    cross join public.stock_in_records as stock_in
    cross join public.inventory_items as inventory_item
    where purchase_a.record_key = 'PO-TASK7-STOCK'
      and purchase_b.record_key = 'PO-TASK7-001'
      and stock_in.record_key = 'SI-TASK7-001'
      and inventory_item.record_key = 'INV-TASK7-001'
  ),
  (select state from task7_stock_binding_snapshot),
  'rejected cross-purchase reuse leaves both purchases, stock-in, and inventory rows exactly unchanged'
);

drop trigger task7_block_stock_binding_purchase_mutation
  on public.purchase_records;
drop trigger task7_block_stock_binding_stock_in_mutation
  on public.stock_in_records;
drop trigger task7_block_stock_binding_inventory_mutation
  on public.inventory_items;

delete from public.permission_grants
where subject_type = 'department'
  and subject_code = '采购部'
  and permission_key = 'module.inventory.update';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"禁止保存"}'::jsonb,
      'SI-TASK7-001',
      '{
        "stockInId":"SI-TASK7-001",
        "sourcePurchaseId":"PO-TASK7-STOCK",
        "stockInQuantity":3
      }'::jsonb,
      'INV-TASK7-001',
      '{"inventoryId":"INV-TASK7-001","quantity":3}'::jsonb
    )$$,
  '42501',
  'inventory update permission required',
  'stock-in commit cannot update existing inventory rows without inventory update permission'
);

reset role;
insert into public.permission_grants (
  subject_type,
  subject_code,
  permission_key
) values (
  'department',
  '采购部',
  'module.inventory.update'
);
select is(
  (
    select payload->>'stockInStatus'
    from public.purchase_records
    where record_key = 'PO-TASK7-STOCK'
  ),
  '部分入库'::text,
  'a denied inventory update rolls back the purchase patch'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select lives_ok(
  $$insert into pg_temp.task7_mutation_results (scenario, result)
    values (
      'stock-in-update',
      public.commit_purchase_stock_in_secure(
        'PO-TASK7-STOCK',
        '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"已入库"}'::jsonb,
        'SI-TASK7-001',
        '{
          "stockInId":"SI-TASK7-001",
          "sourcePurchaseId":"PO-TASK7-STOCK",
          "stockInQuantity":10
        }'::jsonb,
        'INV-TASK7-001',
        '{"inventoryId":"INV-TASK7-001","quantity":10,"totalCost":10000}'::jsonb
      )
    )$$,
  'stock-in commit updates all three existing active rows with update permissions'
);

reset role;
select ok(
  (select payload->>'stockInStatus' = '已入库'
    from public.purchase_records where record_key = 'PO-TASK7-STOCK')
    and (select count(*) = 1 and max((payload->>'stockInQuantity')::numeric) = 10
      from public.stock_in_records where record_key = 'SI-TASK7-001')
    and (select count(*) = 1 and max((payload->>'quantity')::numeric) = 10
      from public.inventory_items where record_key = 'INV-TASK7-001'),
  'stock-in upsert updates in place without duplicating stock or inventory rows'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"禁止保存"}'::jsonb,
      'SI-TASK7-NO-CREATE',
      '{"stockInId":"SI-TASK7-NO-CREATE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-NO-CREATE',
      '{"inventoryId":"INV-TASK7-NO-CREATE"}'::jsonb
    )$$,
  '42501',
  'inventory create permission required',
  'stock-in commit cannot insert either inventory row without inventory create permission'
);

reset role;
select ok(
  (select payload->>'stockInStatus' = '已入库'
    from public.purchase_records where record_key = 'PO-TASK7-STOCK')
    and not exists (
      select 1 from public.stock_in_records where record_key = 'SI-TASK7-NO-CREATE'
    )
    and not exists (
      select 1 from public.inventory_items where record_key = 'INV-TASK7-NO-CREATE'
    ),
  'a denied inventory create leaves all three durable rows unchanged'
);

create or replace function pg_temp.force_task7_inventory_failure()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if new.record_key = 'INV-TASK7-FORCED-FAILURE' then
    raise exception using
      errcode = 'P0001',
      message = 'forced inventory failure';
  end if;
  return new;
end;
$function$;
create trigger task7_force_inventory_failure
before insert on public.inventory_items
for each row execute function pg_temp.force_task7_inventory_failure();

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK","stockInStatus":"不应提交"}'::jsonb,
      'SI-TASK7-FORCED-FAILURE',
      '{"stockInId":"SI-TASK7-FORCED-FAILURE","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-FORCED-FAILURE',
      '{"inventoryId":"INV-TASK7-FORCED-FAILURE"}'::jsonb
    )$$,
  'P0001',
  'forced inventory failure',
  'a late inventory failure aborts the transactional stock-in RPC'
);

reset role;
select ok(
  (select payload->>'stockInStatus' = '已入库'
    from public.purchase_records where record_key = 'PO-TASK7-STOCK')
    and not exists (
      select 1 from public.stock_in_records where record_key = 'SI-TASK7-FORCED-FAILURE'
    )
    and not exists (
      select 1 from public.inventory_items where record_key = 'INV-TASK7-FORCED-FAILURE'
    ),
  'a late inventory failure rolls back the earlier purchase and stock-in writes'
);
drop trigger task7_force_inventory_failure on public.inventory_items;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select is(
  (select count(*) from public.purchase_records),
  0::bigint,
  'module-only purchase access still cannot read the direct sensitive table'
);
select results_eq(
  $$with changed as (
      update public.purchase_records
      set payload = payload || '{"directBypass":true}'::jsonb
      where record_key = 'PO-TASK7-001'
      returning 1
    )
    select count(*)::bigint from changed$$,
  $$values (0::bigint)$$,
  'module-only purchase access still cannot update the direct sensitive table'
);
select throws_ok(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-DIRECT',
      '{"purchaseId":"PO-TASK7-DIRECT"}'::jsonb,
      'active'
    )$$,
  '42501',
  'direct purchase record writes are not allowed',
  'module-only purchase access cannot insert around the direct-write guard'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select throws_ok(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-SENSITIVE-DIRECT',
      '{"purchaseId":"PO-TASK7-SENSITIVE-DIRECT"}'::jsonb,
      'active'
    )$$,
  '42501',
  'direct purchase record writes are not allowed',
  'even a payment-sensitive creator cannot directly insert a purchase row'
);
select throws_ok(
  $$update public.purchase_records
    set payload = payload || '{"directSensitiveBypass":true}'::jsonb
    where record_key = 'PO-TASK7-GUARD-UPDATE'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'even a payment-sensitive updater cannot directly update a purchase row'
);
select throws_ok(
  $$update public.purchase_records
    set status = 'deleted'
    where record_key = 'PO-TASK7-GUARD-DELETE'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'even a payment-sensitive deleter cannot directly soft-delete a purchase row'
);
select throws_ok(
  $$update public.purchase_records
    set status = 'deleted'
    where record_key = 'PO-TASK7-PAYMENT-LINKED'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'the invoker guard rejects direct DML before linked-fact details are evaluated'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$update public.purchase_records
    set status = 'deleted'
    where record_key = 'PO-TASK7-GUARD-DELETE'$$,
  '42501',
  'direct purchase record writes are not allowed',
  'forging the JWT role GUC cannot bypass the current_user purchase guard'
);

reset role;
select throws_ok(
  $statement$do $attempt$
    begin
      truncate table public.purchase_records;
      raise exception using
        errcode = 'P0001',
        message = 'unsafe purchase truncate was accepted';
    end
  $attempt$
  $statement$,
  '42501',
  'purchase record truncation is not allowed',
  'the relation owner cannot accidentally bypass child integrity with TRUNCATE'
);
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $statement$do $attempt$
    begin
      truncate table public.purchase_records;
      raise exception using
        errcode = 'P0001',
        message = 'unsafe service-role truncate was accepted';
    end
  $attempt$
  $statement$,
  '%permission denied for table purchase_records%',
  'service_role has no TRUNCATE privilege on purchase parents'
);
select lives_ok(
  $$insert into public.purchase_records (record_key, payload, status)
    values (
      'PO-TASK7-SERVICE-DIRECT',
      '{"purchaseId":"PO-TASK7-SERVICE-DIRECT"}'::jsonb,
      'active'
    )$$,
  'the actual service_role may directly insert a purchase row'
);
select is(
  (
    select count(*)
    from public.purchase_records
    where record_key = 'PO-TASK7-SERVICE-DIRECT'
      and payload->>'purchaseId' = 'PO-TASK7-SERVICE-DIRECT'
  ),
  1::bigint,
  'the direct service-role insert writes exactly one bound parent row'
);
select lives_ok(
  $$update public.purchase_records
    set record_key = 'PO-TASK7-SERVICE-REBOUND',
        payload = jsonb_set(
          payload,
          '{purchaseId}',
          '"PO-TASK7-SERVICE-REBOUND"'::jsonb
        )
    where record_key = 'PO-TASK7-SERVICE-DIRECT'$$,
  'the actual service_role may rebind an unlinked purchase row'
);
select is(
  (
    select jsonb_build_object(
      'oldCount', count(*) filter (
        where record_key = 'PO-TASK7-SERVICE-DIRECT'
      ),
      'newCount', count(*) filter (
        where record_key = 'PO-TASK7-SERVICE-REBOUND'
      ),
      'newPurchaseId', max(payload->>'purchaseId') filter (
        where record_key = 'PO-TASK7-SERVICE-REBOUND'
      )
    )
    from public.purchase_records
    where record_key in (
      'PO-TASK7-SERVICE-DIRECT',
      'PO-TASK7-SERVICE-REBOUND'
    )
  ),
  '{
    "oldCount":0,
    "newCount":1,
    "newPurchaseId":"PO-TASK7-SERVICE-REBOUND"
  }'::jsonb,
  'the service-role rebind removes the old key and binds exactly one new row'
);
select lives_ok(
  $$update public.purchase_records
    set payload = payload || '{"serviceUpdated":true}'::jsonb
    where record_key = 'PO-TASK7-SERVICE-REBOUND'$$,
  'the actual service_role may directly update an unlinked purchase row'
);
select is(
  (
    select count(*)
    from public.purchase_records
    where record_key = 'PO-TASK7-SERVICE-REBOUND'
      and payload->>'purchaseId' = 'PO-TASK7-SERVICE-REBOUND'
      and payload->>'serviceUpdated' = 'true'
  ),
  1::bigint,
  'the service-role payload update changes exactly the rebound parent row'
);
select lives_ok(
  $$delete from public.purchase_records
    where record_key = 'PO-TASK7-SERVICE-REBOUND'$$,
  'the actual service_role may directly delete a purchase row'
);
select is(
  (
    select count(*)
    from public.purchase_records
    where record_key in (
      'PO-TASK7-SERVICE-DIRECT',
      'PO-TASK7-SERVICE-REBOUND'
    )
  ),
  0::bigint,
  'the service-role delete leaves neither the old nor rebound parent key'
);

reset role;
set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select throws_like(
  $$select * from public.list_purchase_records_secure()$$,
  '%permission denied for function list_purchase_records_secure%',
  'anon cannot execute the purchase list RPC'
);
select throws_like(
  $$select public.upsert_purchase_record_secure(
      'PO-TASK7-ANON',
      '{"purchaseId":"PO-TASK7-ANON"}'::jsonb,
      'active'
    )$$,
  '%permission denied for function upsert_purchase_record_secure%',
  'anon cannot execute the purchase upsert RPC'
);
select throws_like(
  $$select public.soft_delete_purchase_record_secure('PO-TASK7-001')$$,
  '%permission denied for function soft_delete_purchase_record_secure%',
  'anon cannot execute the purchase soft-delete RPC'
);
select throws_like(
  $$select public.commit_purchase_stock_in_secure(
      'PO-TASK7-STOCK',
      '{"purchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'SI-TASK7-ANON',
      '{"stockInId":"SI-TASK7-ANON","sourcePurchaseId":"PO-TASK7-STOCK"}'::jsonb,
      'INV-TASK7-ANON',
      '{"inventoryId":"INV-TASK7-ANON"}'::jsonb
    )$$,
  '%permission denied for function commit_purchase_stock_in_secure%',
  'anon cannot execute the transactional purchase stock-in RPC'
);

reset role;
select * from finish();
rollback;

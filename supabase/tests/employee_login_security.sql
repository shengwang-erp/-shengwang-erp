begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(34);

create temporary table task4_rate_results (
  scenario text not null,
  sequence_number integer not null,
  allowed boolean not null,
  attempt_id bigint,
  failure_count integer not null,
  locked boolean not null,
  locked_until timestamptz
) on commit drop;

create temporary table task4_boolean_results (
  scenario text primary key,
  result boolean not null
) on commit drop;

grant all on table task4_rate_results, task4_boolean_results to service_role;

select ok(
  has_function_privilege(
    'service_role',
    'public.begin_employee_login_attempt(text,text)',
    'EXECUTE'
  ),
  'service_role can reserve a login attempt'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.begin_employee_login_attempt(text,text)',
    'EXECUTE'
  ),
  'authenticated cannot reserve a login attempt'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.complete_employee_password_change(uuid)',
    'EXECUTE'
  ),
  'service_role can complete the password-change flag'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_employee_password_change(uuid)',
    'EXECUTE'
  ),
  'authenticated cannot complete the password-change flag'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.begin_employee_login_attempt('SW-900', repeat('x', 43))$$,
  '42501',
  'service_role required',
  'the login RPC also guards its execution context'
);
select throws_ok(
  $$select public.complete_employee_password_change(
      '41000000-0000-0000-0000-000000000001'::uuid
    )$$,
  '42501',
  'service_role required',
  'the password-state RPC also guards its execution context'
);

select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

do $pending_window$
declare
  step integer;
  reservation record;
begin
  for step in 1..5 loop
    select *
      into reservation
      from public.begin_employee_login_attempt('SW-901', repeat('a', 43));
    insert into task4_rate_results values (
      'pending',
      step,
      reservation.allowed,
      reservation.attempt_id,
      reservation.failure_count,
      reservation.locked,
      reservation.locked_until
    );
  end loop;

  select *
    into reservation
    from public.begin_employee_login_attempt('SW-901', repeat('a', 43));
  insert into task4_rate_results values (
    'pending',
    6,
    reservation.allowed,
    reservation.attempt_id,
    reservation.failure_count,
    reservation.locked,
    reservation.locked_until
  );
end;
$pending_window$;

reset role;

select is(
  (select count(*) from task4_rate_results where scenario = 'pending' and sequence_number <= 5 and allowed),
  5::bigint,
  'the first five pending reservations are allowed'
);
select ok(
  (select locked and locked_until > now() from task4_rate_results where scenario = 'pending' and sequence_number = 5),
  'the fifth pending reservation installs a provisional lock'
);
select ok(
  not (select allowed from task4_rate_results where scenario = 'pending' and sequence_number = 6),
  'a sixth concurrent reservation is rejected before Auth'
);
select is(
  (select attempt_id from task4_rate_results where scenario = 'pending' and sequence_number = 6),
  null::bigint,
  'the rejected sixth reservation creates no attempt id'
);
select is(
  (
    select count(*)
    from public.auth_login_attempts
    where employee_number = 'SW-901'
      and source_fingerprint = repeat('a', 43)
  ),
  5::bigint,
  'only five rows exist for the six concurrent reservation calls'
);

set local role service_role;
insert into task4_boolean_results (scenario, result)
select
  'cancel fifth pending',
  public.cancel_employee_login_attempt(
    pending.attempt_id,
    'SW-901',
    repeat('a', 43)
  )
from task4_rate_results as pending
where pending.scenario = 'pending'
  and pending.sequence_number = 5;

insert into task4_rate_results
select 'after cancel', 1, reservation.*
from public.begin_employee_login_attempt('SW-901', repeat('a', 43)) as reservation;

insert into task4_boolean_results (scenario, result)
select
  'cancel replacement pending',
  public.cancel_employee_login_attempt(
    replacement.attempt_id,
    'SW-901',
    repeat('a', 43)
  )
from task4_rate_results as replacement
where replacement.scenario = 'after cancel';
reset role;

select ok(
  (select result from task4_boolean_results where scenario = 'cancel fifth pending'),
  'cancelling a pending reservation reports success'
);
select ok(
  (select allowed from task4_rate_results where scenario = 'after cancel'),
  'cancelling the provisional fifth reservation releases the key'
);
select ok(
  (select result from task4_boolean_results where scenario = 'cancel replacement pending'),
  'the replacement pending reservation can also be cancelled'
);

set local role service_role;
do $five_failures$
declare
  step integer;
  reservation record;
  failure record;
begin
  for step in 1..5 loop
    select *
      into reservation
      from public.begin_employee_login_attempt('SW-902', repeat('b', 43));
    select *
      into failure
      from public.finalize_employee_login_failure(
        reservation.attempt_id,
        'SW-902',
        repeat('b', 43),
        'INVALID_CREDENTIALS'
      );
    insert into task4_rate_results values (
      'settled failure',
      step,
      reservation.allowed,
      reservation.attempt_id,
      failure.failure_count,
      failure.locked,
      failure.locked_until
    );
  end loop;

  select *
    into reservation
    from public.begin_employee_login_attempt('SW-902', repeat('b', 43));
  insert into task4_rate_results values (
    'settled failure',
    6,
    reservation.allowed,
    reservation.attempt_id,
    reservation.failure_count,
    reservation.locked,
    reservation.locked_until
  );
end;
$five_failures$;
reset role;

select is(
  (select count(*) from task4_rate_results where scenario = 'settled failure' and sequence_number <= 4 and not locked),
  4::bigint,
  'the first four settled failures do not report a lock'
);
select ok(
  (select locked from task4_rate_results where scenario = 'settled failure' and sequence_number = 5),
  'the fifth settled failure reports a lock'
);
select is(
  (select failure_count from task4_rate_results where scenario = 'settled failure' and sequence_number = 5),
  5,
  'the fifth settled failure reports an exact count of five'
);
select ok(
  not (select allowed from task4_rate_results where scenario = 'settled failure' and sequence_number = 6),
  'a request during the settled-failure lock is rejected'
);
select ok(
  (select locked_until > now() from task4_rate_results where scenario = 'settled failure' and sequence_number = 6),
  'the settled-failure lock has a future expiry'
);

set local role service_role;
update public.auth_login_attempts
  set attempted_at = now() - interval '16 minutes',
      locked_until = now() - interval '1 second'
  where employee_number = 'SW-902'
    and source_fingerprint = repeat('b', 43);
insert into task4_rate_results
select 'after expiry', 1, reservation.*
from public.begin_employee_login_attempt('SW-902', repeat('b', 43)) as reservation;
insert into task4_boolean_results (scenario, result)
select
  'cancel after expiry',
  public.cancel_employee_login_attempt(
    after_expiry.attempt_id,
    'SW-902',
    repeat('b', 43)
  )
from task4_rate_results as after_expiry
where after_expiry.scenario = 'after expiry';
reset role;

select ok(
  (select allowed from task4_rate_results where scenario = 'after expiry'),
  'an expired lock permits a new reservation'
);
select ok(
  (select result from task4_boolean_results where scenario = 'cancel after expiry'),
  'the post-expiry reservation can be cancelled'
);

set local role service_role;
do $success_reset$
declare
  step integer;
  reservation record;
  failure record;
begin
  for step in 1..4 loop
    select *
      into reservation
      from public.begin_employee_login_attempt('SW-903', repeat('c', 43));
    select *
      into failure
      from public.finalize_employee_login_failure(
        reservation.attempt_id,
        'SW-903',
        repeat('c', 43),
        'INVALID_CREDENTIALS'
      );
    insert into task4_rate_results values (
      'before success',
      step,
      reservation.allowed,
      reservation.attempt_id,
      failure.failure_count,
      failure.locked,
      failure.locked_until
    );
  end loop;

  select *
    into reservation
    from public.begin_employee_login_attempt('SW-903', repeat('c', 43));
  insert into task4_rate_results values (
    'success reservation',
    5,
    reservation.allowed,
    reservation.attempt_id,
    reservation.failure_count,
    reservation.locked,
    reservation.locked_until
  );
end;
$success_reset$;

insert into task4_boolean_results (scenario, result)
select
  'complete success',
  public.complete_employee_login_success(
    success.attempt_id,
    'SW-903',
    repeat('c', 43)
  )
from task4_rate_results as success
where success.scenario = 'success reservation';

insert into task4_rate_results
select 'after success', 1, reservation.*
from public.begin_employee_login_attempt('SW-903', repeat('c', 43)) as reservation;

insert into task4_boolean_results (scenario, result)
select
  'cancel after success',
  public.cancel_employee_login_attempt(
    after_success.attempt_id,
    'SW-903',
    repeat('c', 43)
  )
from task4_rate_results as after_success
where after_success.scenario = 'after success';
reset role;

select is(
  (select count(*) from task4_rate_results where scenario = 'before success' and not locked),
  4::bigint,
  'four failures remain unlocked before a success'
);
select ok(
  (select locked from task4_rate_results where scenario = 'success reservation'),
  'the fifth reservation is provisionally locked before success settles'
);
select ok(
  (select result from task4_boolean_results where scenario = 'complete success'),
  'the successful reservation settles exactly once'
);
select is(
  (
    select count(*)
    from public.auth_login_attempts
    where employee_number = 'SW-903'
      and source_fingerprint = repeat('c', 43)
      and locked_until is not null
  ),
  0::bigint,
  'success clears lock timestamps for the current key'
);
select ok(
  (select allowed from task4_rate_results where scenario = 'after success'),
  'success permits the next reservation'
);
select is(
  (select failure_count from task4_rate_results where scenario = 'after success'),
  1,
  'the next reservation starts a fresh logical failure window'
);
select ok(
  (select result from task4_boolean_results where scenario = 'cancel after success'),
  'the fresh post-success reservation can be cancelled'
);

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
  (
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'task4-a@auth.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '41000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'task4-b@auth.invalid',
    '',
    now(),
    '{}'::jsonb,
    '{}'::jsonb,
    now(),
    now()
  );

insert into public.employee_profiles (
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
  (
    'SW-951',
    '41000000-0000-0000-0000-000000000001',
    '密码测试甲',
    '工程部',
    '设计师',
    '在职',
    'active',
    true,
    false
  ),
  (
    'SW-952',
    '41000000-0000-0000-0000-000000000002',
    '密码测试乙',
    '工程部',
    '设计师',
    '在职',
    'active',
    true,
    false
  );

set local role service_role;
insert into task4_boolean_results (scenario, result) values
  (
    'complete password flag',
    public.complete_employee_password_change(
      '41000000-0000-0000-0000-000000000001'::uuid
    )
  ),
  (
    'missing password flag',
    public.complete_employee_password_change(
      '41000000-0000-0000-0000-000000000099'::uuid
    )
  );
reset role;

select ok(
  (select result from task4_boolean_results where scenario = 'complete password flag'),
  'password completion reports success for the exact active Auth id'
);
select ok(
  not (
    select must_change_password
    from public.employee_profiles
    where auth_user_id = '41000000-0000-0000-0000-000000000001'
  ),
  'password completion clears the exact caller profile flag'
);
select ok(
  (
    select must_change_password
    from public.employee_profiles
    where auth_user_id = '41000000-0000-0000-0000-000000000002'
  ),
  'password completion leaves every other profile flag unchanged'
);
select ok(
  not (select result from task4_boolean_results where scenario = 'missing password flag'),
  'password completion returns false for an unknown Auth id'
);

insert into public.auth_login_attempts (
  employee_number,
  source_fingerprint,
  succeeded,
  failure_code,
  attempted_at
) values
  ('SW-904', repeat('d', 43), false, 'INVALID_CREDENTIALS', now() - interval '31 days'),
  ('SW-904', repeat('d', 43), false, 'INVALID_CREDENTIALS', now());

set local role service_role;
insert into task4_boolean_results (scenario, result)
select
  'purged one row',
  public.purge_expired_employee_login_attempts(now() - interval '30 days') = 1;
reset role;

select ok(
  (select result from task4_boolean_results where scenario = 'purged one row'),
  'the retention RPC purges only rows older than its boundary'
);
select is(
  (
    select count(*)
    from public.auth_login_attempts
    where employee_number = 'SW-904'
      and source_fingerprint = repeat('d', 43)
  ),
  1::bigint,
  'the retention RPC preserves recent login attempts'
);

select * from finish();
rollback;

-- Atomic employee-login throttling and caller-scoped password-state completion.
-- This migration is additive: login history remains available for retention and
-- incident review, while successful attempts form a logical reset boundary.

create index if not exists auth_login_attempts_retention_idx
  on public.auth_login_attempts (attempted_at);

create or replace function public.begin_employee_login_attempt(
  p_employee_number text,
  p_source_fingerprint text
)
returns table (
  allowed boolean,
  attempt_id bigint,
  failure_count integer,
  locked boolean,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_time timestamptz := clock_timestamp();
  latest_success_at timestamptz;
  active_lock_until timestamptz;
  current_failure_count integer := 0;
  reserved_attempt_id bigint;
  provisional_lock_until timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_number is null
    or p_employee_number !~ '^SW-[0-9]{3,}$'
    or length(p_employee_number) > 32
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception using errcode = '22023', message = 'invalid login-attempt key';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_employee_number || chr(31) || p_source_fingerprint, 0)
  );

  select max(attempt.locked_until)
    into active_lock_until
    from public.auth_login_attempts as attempt
    where attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.locked_until > event_time;

  select max(attempt.attempted_at)
    into latest_success_at
    from public.auth_login_attempts as attempt
    where attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = true;

  select count(*)::integer
    into current_failure_count
    from public.auth_login_attempts as attempt
    where attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = false
      and attempt.failure_code is not null
      and attempt.attempted_at > event_time - interval '15 minutes'
      and (
        latest_success_at is null
        or attempt.attempted_at > latest_success_at
      );

  if active_lock_until is not null then
    return query
    select false, null::bigint, current_failure_count, true, active_lock_until;
    return;
  end if;

  -- This also repairs recent pre-migration rows that reached the threshold but
  -- did not yet carry a lock timestamp.
  if current_failure_count >= 5 then
    active_lock_until := event_time + interval '15 minutes';
    update public.auth_login_attempts as attempt
      set locked_until = active_lock_until
      where attempt.id = (
        select recent_attempt.id
        from public.auth_login_attempts as recent_attempt
        where recent_attempt.employee_number = p_employee_number
          and recent_attempt.source_fingerprint = p_source_fingerprint
          and recent_attempt.succeeded = false
          and recent_attempt.failure_code is not null
          and recent_attempt.attempted_at > event_time - interval '15 minutes'
          and (
            latest_success_at is null
            or recent_attempt.attempted_at > latest_success_at
          )
        order by recent_attempt.attempted_at desc, recent_attempt.id desc
        limit 1
      );
    return query
    select false, null::bigint, current_failure_count, true, active_lock_until;
    return;
  end if;

  if current_failure_count + 1 >= 5 then
    provisional_lock_until := event_time + interval '15 minutes';
  end if;

  insert into public.auth_login_attempts (
    employee_number,
    source_fingerprint,
    succeeded,
    failure_code,
    attempted_at,
    locked_until
  ) values (
    p_employee_number,
    p_source_fingerprint,
    false,
    'PENDING',
    event_time,
    provisional_lock_until
  )
  returning id into reserved_attempt_id;

  current_failure_count := current_failure_count + 1;
  return query
  select
    true,
    reserved_attempt_id,
    current_failure_count,
    provisional_lock_until is not null,
    provisional_lock_until;
end;
$$;

create or replace function public.finalize_employee_login_failure(
  p_attempt_id bigint,
  p_employee_number text,
  p_source_fingerprint text,
  p_failure_code text
)
returns table (
  locked boolean,
  failure_count integer,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_time timestamptz := clock_timestamp();
  latest_success_at timestamptz;
  current_failure_count integer := 0;
  active_lock_until timestamptz;
  finalized_attempt_id bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_attempt_id is null
    or p_employee_number is null
    or p_employee_number !~ '^SW-[0-9]{3,}$'
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[A-Za-z0-9_-]{43}$'
    or p_failure_code not in ('INVALID_CREDENTIALS', 'ACCOUNT_UNAVAILABLE')
  then
    raise exception using errcode = '22023', message = 'invalid login failure';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_employee_number || chr(31) || p_source_fingerprint, 0)
  );

  update public.auth_login_attempts as attempt
    set failure_code = p_failure_code,
        attempted_at = event_time,
        locked_until = null
    where attempt.id = p_attempt_id
      and attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = false
      and attempt.failure_code = 'PENDING'
    returning attempt.id into finalized_attempt_id;

  if finalized_attempt_id is null then
    raise exception using errcode = '22023', message = 'login attempt is not pending';
  end if;

  select max(attempt.attempted_at)
    into latest_success_at
    from public.auth_login_attempts as attempt
    where attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = true;

  -- Pending reservations prevent a sixth concurrent Auth call, but only settled
  -- failures contribute to the user-facing five-failure lock response.
  select count(*)::integer
    into current_failure_count
    from public.auth_login_attempts as attempt
    where attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = false
      and attempt.failure_code is not null
      and attempt.failure_code <> 'PENDING'
      and attempt.attempted_at > event_time - interval '15 minutes'
      and (
        latest_success_at is null
        or attempt.attempted_at > latest_success_at
      );

  if current_failure_count >= 5 then
    active_lock_until := event_time + interval '15 minutes';
    update public.auth_login_attempts as attempt
      set locked_until = active_lock_until
      where attempt.id = p_attempt_id;
  end if;

  return query
  select
    active_lock_until is not null,
    current_failure_count,
    active_lock_until;
end;
$$;

create or replace function public.complete_employee_login_success(
  p_attempt_id bigint,
  p_employee_number text,
  p_source_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  event_time timestamptz := clock_timestamp();
  completed_attempt_id bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_attempt_id is null
    or p_employee_number is null
    or p_employee_number !~ '^SW-[0-9]{3,}$'
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception using errcode = '22023', message = 'invalid login success';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_employee_number || chr(31) || p_source_fingerprint, 0)
  );

  update public.auth_login_attempts as attempt
    set succeeded = true,
        failure_code = null,
        attempted_at = event_time,
        locked_until = null
    where attempt.id = p_attempt_id
      and attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = false
      and attempt.failure_code = 'PENDING'
    returning attempt.id into completed_attempt_id;

  if completed_attempt_id is null then
    raise exception using errcode = '22023', message = 'login attempt is not pending';
  end if;

  update public.auth_login_attempts as attempt
    set locked_until = null
    where attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = false
      and attempt.locked_until is not null;

  return true;
end;
$$;

create or replace function public.cancel_employee_login_attempt(
  p_attempt_id bigint,
  p_employee_number text,
  p_source_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cancelled_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_attempt_id is null
    or p_employee_number is null
    or p_employee_number !~ '^SW-[0-9]{3,}$'
    or p_source_fingerprint is null
    or p_source_fingerprint !~ '^[A-Za-z0-9_-]{43}$'
  then
    raise exception using errcode = '22023', message = 'invalid login cancellation';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_employee_number || chr(31) || p_source_fingerprint, 0)
  );

  delete from public.auth_login_attempts as attempt
    where attempt.id = p_attempt_id
      and attempt.employee_number = p_employee_number
      and attempt.source_fingerprint = p_source_fingerprint
      and attempt.succeeded = false
      and attempt.failure_code = 'PENDING';
  get diagnostics cancelled_count = row_count;

  return cancelled_count = 1;
end;
$$;

create or replace function public.purge_expired_employee_login_attempts(
  p_before timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count bigint := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_before is null or p_before > clock_timestamp() then
    raise exception using errcode = '22023', message = 'invalid retention boundary';
  end if;

  delete from public.auth_login_attempts as attempt
    where attempt.attempted_at < p_before;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function public.complete_employee_password_change(
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_auth_user_id is null then
    raise exception using errcode = '22004', message = 'auth user id is required';
  end if;

  update public.employee_profiles as employee
    set must_change_password = false
    where employee.auth_user_id = p_auth_user_id
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.deleted_at is null;

  return found;
end;
$$;

revoke all on function public.begin_employee_login_attempt(text, text) from public, anon, authenticated;
revoke all on function public.finalize_employee_login_failure(bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_employee_login_success(bigint, text, text) from public, anon, authenticated;
revoke all on function public.cancel_employee_login_attempt(bigint, text, text) from public, anon, authenticated;
revoke all on function public.purge_expired_employee_login_attempts(timestamptz) from public, anon, authenticated;
revoke all on function public.complete_employee_password_change(uuid) from public, anon, authenticated;

grant execute on function public.begin_employee_login_attempt(text, text) to service_role;
grant execute on function public.finalize_employee_login_failure(bigint, text, text, text) to service_role;
grant execute on function public.complete_employee_login_success(bigint, text, text) to service_role;
grant execute on function public.cancel_employee_login_attempt(bigint, text, text) to service_role;
grant execute on function public.purge_expired_employee_login_attempts(timestamptz) to service_role;
grant execute on function public.complete_employee_password_change(uuid) to service_role;

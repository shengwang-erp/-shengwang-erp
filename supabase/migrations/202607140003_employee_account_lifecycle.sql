-- Server-only employee provisioning and account administration state transitions.

alter table public.employee_provisioning_requests
  add column if not exists owner_token uuid,
  add column if not exists owner_expires_at timestamptz,
  add column if not exists auth_user_id_snapshot uuid,
  add column if not exists employee_profile_id uuid
    references public.employee_profiles(id) on delete set null;

create index if not exists employee_provisioning_owner_idx
  on public.employee_provisioning_requests (owner_expires_at)
  where owner_token is not null;

create table if not exists public.employee_password_reset_requests (
  employee_profile_id uuid primary key
    references public.employee_profiles(id) on delete cascade,
  reset_request_id uuid not null unique,
  auth_user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'completed')),
  owner_token uuid,
  owner_expires_at timestamptz,
  actor_auth_user_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.employee_password_reset_requests enable row level security;

create index if not exists employee_password_reset_owner_idx
  on public.employee_password_reset_requests (owner_expires_at)
  where owner_token is not null;

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
    'mustChangePassword', p_employee.must_change_password
  );
$$;

create or replace function private.assert_employee_profile_write_authorized(
  p_actor_auth_user_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor_row public.employee_profiles%rowtype;
  effective_permissions text[];
  identity_write_requested boolean;
  salary_write_requested boolean;
begin
  if p_actor_auth_user_id is null
    or jsonb_typeof(p_payload) is distinct from 'object'
  then
    raise exception using errcode = '42501', message = 'personnel administrator required';
  end if;

  select profile.*
    into actor_row
    from public.employee_profiles as profile
    where profile.auth_user_id = p_actor_auth_user_id
      and profile.deleted_at is null
      and profile.account_status = 'active'
      and profile.employment_status = '在职'
      and profile.must_change_password = false;
  if not found then
    raise exception using errcode = '42501', message = 'personnel administrator required';
  end if;

  if actor_row.employee_number = 'SW-000' then
    return;
  end if;
  if actor_row.position <> '社长' then
    raise exception using errcode = '42501', message = 'personnel administrator required';
  end if;

  identity_write_requested := p_payload ?| array[
    'gender', 'birthDate', 'nationality', 'emergencyContactName',
    'emergencyContactPhone', 'currentAddress', 'visaAgency', 'visaType',
    'visaExpireDate', 'passportNumber', 'residenceCardNumber'
  ];
  salary_write_requested := p_payload ?| array[
    'baseSalary', 'dailySalary', 'hourlyWage', 'salaryRemark'
  ];
  if not identity_write_requested and not salary_write_requested then
    return;
  end if;

  effective_permissions := private.employee_effective_permission_keys(actor_row.id);
  if not (effective_permissions @> array['all']::text[])
    and (
      (
        identity_write_requested
        and not (
          effective_permissions
          @> array['sensitive.employee_identity_update']::text[]
        )
      )
      or (
        salary_write_requested
        and not (
          effective_permissions
          @> array['sensitive.salary_update']::text[]
        )
      )
    )
  then
    raise exception using errcode = '42501', message = 'sensitive employee permission required';
  end if;
end;
$$;

create or replace function public.claim_employee_provisioning(
  p_request_id uuid,
  p_owner_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  request_row public.employee_provisioning_requests%rowtype;
  profile_row public.employee_profiles%rowtype;
  recorded_auth_user_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_request_id is null or p_owner_token is null then
    raise exception using errcode = '22023', message = 'invalid provisioning claim';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select request.*
    into request_row
    from public.employee_provisioning_requests as request
    where request.request_id = p_request_id
    for update;
  if not found then
    raise exception using errcode = '22023', message = 'provisioning request not reserved';
  end if;

  recorded_auth_user_id := coalesce(
    request_row.auth_user_id_snapshot,
    request_row.auth_user_id
  );
  select profile.*
    into profile_row
    from public.employee_profiles as profile
    where profile.employee_number = request_row.employee_number
      and profile.deleted_at is null;

  if found then
    if (
      request_row.status = 'completed'
      and request_row.employee_profile_id = profile_row.id
    ) or (
      recorded_auth_user_id is not null
      and profile_row.auth_user_id = recorded_auth_user_id
    ) then
      update public.employee_provisioning_requests
        set status = 'completed',
            employee_profile_id = profile_row.id,
            auth_user_id = profile_row.auth_user_id,
            auth_user_id_snapshot = profile_row.auth_user_id,
            completed_at = coalesce(completed_at, clock_timestamp()),
            safe_error_code = null,
            owner_token = null,
            owner_expires_at = null
        where request_id = p_request_id;
      return jsonb_build_object(
        'ownerAcquired', false,
        'status', 'completed',
        'employeeNumber', request_row.employee_number,
        'authUserId', profile_row.auth_user_id,
        'employee', private.employee_safe_summary(profile_row)
      );
    end if;

    return jsonb_build_object(
      'ownerAcquired', false,
      'status', 'state_conflict',
      'employeeNumber', request_row.employee_number
    );
  end if;

  if request_row.status = 'completed' then
    return jsonb_build_object(
      'ownerAcquired', false,
      'status', 'state_conflict',
      'employeeNumber', request_row.employee_number
    );
  end if;

  if request_row.owner_token is not null
    and request_row.owner_token <> p_owner_token
    and request_row.owner_expires_at > clock_timestamp()
  then
    return jsonb_build_object(
      'ownerAcquired', false,
      'status', request_row.status,
      'employeeNumber', request_row.employee_number,
      'authUserId', recorded_auth_user_id
    );
  end if;

  if request_row.status in ('compensated', 'failed') then
    request_row.status := 'reserved';
    request_row.auth_user_id := null;
    request_row.auth_user_id_snapshot := null;
    request_row.auth_created_at := null;
    request_row.compensated_at := null;
    request_row.safe_error_code := null;
  end if;

  update public.employee_provisioning_requests
    set status = request_row.status,
        auth_user_id = request_row.auth_user_id,
        auth_user_id_snapshot = request_row.auth_user_id_snapshot,
        auth_created_at = request_row.auth_created_at,
        compensated_at = request_row.compensated_at,
        safe_error_code = request_row.safe_error_code,
        owner_token = p_owner_token,
        owner_expires_at = clock_timestamp() + interval '5 minutes'
    where request_id = p_request_id
    returning * into request_row;

  return jsonb_build_object(
    'ownerAcquired', true,
    'status', request_row.status,
    'employeeNumber', request_row.employee_number,
    'authUserId', coalesce(request_row.auth_user_id_snapshot, request_row.auth_user_id)
  );
end;
$$;

create or replace function public.renew_employee_provisioning_owner(
  p_request_id uuid,
  p_owner_token uuid,
  p_expected_status text,
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
  if p_request_id is null
    or p_owner_token is null
    or p_expected_status not in ('reserved', 'auth_created', 'compensation_pending')
  then
    raise exception using errcode = '22023', message = 'invalid provisioning renewal';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  update public.employee_provisioning_requests as request
    set owner_expires_at = clock_timestamp() + interval '5 minutes'
    where request.request_id = p_request_id
      and request.owner_token = p_owner_token
      and request.owner_expires_at > clock_timestamp()
      and request.status = p_expected_status
      and (
        (
          p_expected_status = 'reserved'
          and p_auth_user_id is null
          and request.auth_user_id_snapshot is null
        )
        or (
          p_expected_status in ('auth_created', 'compensation_pending')
          and request.auth_user_id_snapshot = p_auth_user_id
        )
      );
  return found;
end;
$$;

create or replace function public.record_employee_provisioning_auth(
  p_request_id uuid,
  p_owner_token uuid,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.employee_provisioning_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_request_id is null or p_owner_token is null or p_auth_user_id is null then
    raise exception using errcode = '22023', message = 'invalid Auth ownership record';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select request.*
    into request_row
    from public.employee_provisioning_requests as request
    where request.request_id = p_request_id
    for update;
  if not found
    or request_row.owner_token is distinct from p_owner_token
    or request_row.owner_expires_at <= clock_timestamp()
    or request_row.status not in ('reserved', 'auth_created')
    or (
      request_row.auth_user_id_snapshot is not null
      and request_row.auth_user_id_snapshot <> p_auth_user_id
    )
    or exists (
      select 1
      from public.employee_profiles as profile
      where profile.auth_user_id = p_auth_user_id
        and profile.employee_number <> request_row.employee_number
    )
  then
    return false;
  end if;

  update public.employee_provisioning_requests
    set status = 'auth_created',
        auth_user_id = p_auth_user_id,
        auth_user_id_snapshot = p_auth_user_id,
        auth_created_at = coalesce(auth_created_at, clock_timestamp()),
        safe_error_code = null,
        owner_expires_at = clock_timestamp() + interval '5 minutes'
    where request_id = p_request_id;
  return true;
end;
$$;

create or replace function public.complete_employee_provisioning(
  p_request_id uuid,
  p_owner_token uuid,
  p_auth_user_id uuid,
  p_profile jsonb,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  request_row public.employee_provisioning_requests%rowtype;
  profile_row public.employee_profiles%rowtype;
  unknown_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_request_id is null
    or p_owner_token is null
    or p_auth_user_id is null
    or p_actor_auth_user_id is null
    or jsonb_typeof(p_profile) is distinct from 'object'
    or not (p_profile ?& array['name', 'department', 'position'])
  then
    raise exception using errcode = '22023', message = 'invalid employee profile';
  end if;

  select key
    into unknown_key
    from jsonb_object_keys(p_profile) as submitted(key)
    where submitted.key <> all (array[
      'name', 'gender', 'birthDate', 'nationality', 'employmentStatus',
      'hireDate', 'resignDate', 'department', 'position', 'level', 'phone',
      'emergencyContactName', 'emergencyContactPhone', 'currentAddress',
      'visaAgency', 'visaType', 'visaExpireDate', 'passportNumber',
      'residenceCardNumber', 'baseSalary', 'dailySalary', 'hourlyWage',
      'salaryRemark', 'wecomUserId', 'wecomDepartmentId',
      'wecomDepartmentName', 'remark'
    ]::text[])
    limit 1;
  if unknown_key is not null then
    raise exception using errcode = '22023', message = 'unsupported employee profile field';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    p_profile
  );

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select request.*
    into request_row
    from public.employee_provisioning_requests as request
    where request.request_id = p_request_id
    for update;
  if not found
    or request_row.owner_token is distinct from p_owner_token
    or request_row.owner_expires_at <= clock_timestamp()
    or request_row.status <> 'auth_created'
    or request_row.auth_user_id_snapshot is distinct from p_auth_user_id
  then
    raise exception using errcode = '22023', message = 'provisioning ownership conflict';
  end if;

  if exists (
    select 1
    from public.employee_profiles as linked_profile
    where linked_profile.auth_user_id = p_auth_user_id
      and linked_profile.employee_number <> request_row.employee_number
  ) then
    raise exception using errcode = '23505', message = 'employee profile ownership conflict';
  end if;

  select profile.*
    into profile_row
    from public.employee_profiles as profile
    where profile.employee_number = request_row.employee_number
    for update;
  if found then
    if profile_row.auth_user_id is distinct from p_auth_user_id
      or profile_row.is_hidden_system_account
      or profile_row.deleted_at is not null
      or profile_row.account_status <> 'active'
      or profile_row.must_change_password is distinct from true
    then
      raise exception using errcode = '23505', message = 'employee profile ownership conflict';
    end if;
  else
    insert into public.employee_profiles (
      employee_number,
      auth_user_id,
      name,
      gender,
      birth_date,
      nationality,
      employment_status,
      hire_date,
      resign_date,
      department,
      position,
      level,
      phone,
      emergency_contact_name,
      emergency_contact_phone,
      current_address,
      visa_agency,
      visa_type,
      visa_expire_date,
      passport_number,
      residence_card_number,
      base_salary,
      daily_salary,
      hourly_wage,
      salary_remark,
      wecom_user_id,
      wecom_department_id,
      wecom_department_name,
      remark,
      account_status,
      must_change_password,
      is_hidden_system_account,
      created_by_auth_user_id,
      updated_by_auth_user_id
    ) values (
      request_row.employee_number,
      p_auth_user_id,
      btrim(p_profile->>'name'),
      p_profile->>'gender',
      nullif(p_profile->>'birthDate', '')::date,
      p_profile->>'nationality',
      coalesce(p_profile->>'employmentStatus', '在职'),
      nullif(p_profile->>'hireDate', '')::date,
      nullif(p_profile->>'resignDate', '')::date,
      p_profile->>'department',
      p_profile->>'position',
      p_profile->>'level',
      p_profile->>'phone',
      p_profile->>'emergencyContactName',
      p_profile->>'emergencyContactPhone',
      p_profile->>'currentAddress',
      p_profile->>'visaAgency',
      p_profile->>'visaType',
      nullif(p_profile->>'visaExpireDate', '')::date,
      p_profile->>'passportNumber',
      p_profile->>'residenceCardNumber',
      nullif(p_profile->>'baseSalary', '')::numeric,
      nullif(p_profile->>'dailySalary', '')::numeric,
      nullif(p_profile->>'hourlyWage', '')::numeric,
      p_profile->>'salaryRemark',
      p_profile->>'wecomUserId',
      p_profile->>'wecomDepartmentId',
      p_profile->>'wecomDepartmentName',
      p_profile->>'remark',
      'active',
      true,
      false,
      p_actor_auth_user_id,
      p_actor_auth_user_id
    )
    returning * into profile_row;
  end if;

  update public.employee_provisioning_requests
    set status = 'completed',
        employee_profile_id = profile_row.id,
        auth_user_id = p_auth_user_id,
        auth_user_id_snapshot = p_auth_user_id,
        completed_at = coalesce(completed_at, clock_timestamp()),
        safe_error_code = null,
        owner_token = null,
        owner_expires_at = null
    where request_id = p_request_id;

  insert into public.employee_security_audit (
    actor_auth_user_id,
    target_employee_profile_id,
    action,
    safe_details
  ) values (
    p_actor_auth_user_id,
    profile_row.id,
    'employee.provisioned',
    jsonb_build_object('employeeNumber', profile_row.employee_number)
  );

  return private.employee_safe_summary(profile_row);
end;
$$;

create or replace function public.prepare_employee_provisioning_compensation(
  p_request_id uuid,
  p_owner_token uuid,
  p_auth_user_id uuid,
  p_safe_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  request_row public.employee_provisioning_requests%rowtype;
  profile_row public.employee_profiles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_request_id is null
    or p_owner_token is null
    or p_auth_user_id is null
    or p_safe_error_code is null
    or p_safe_error_code !~ '^[A-Z0-9_]{1,64}$'
  then
    raise exception using errcode = '22023', message = 'invalid compensation request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select request.*
    into request_row
    from public.employee_provisioning_requests as request
    where request.request_id = p_request_id
    for update;
  if not found
    or request_row.owner_token is distinct from p_owner_token
    or request_row.owner_expires_at <= clock_timestamp()
    or request_row.auth_user_id_snapshot is distinct from p_auth_user_id
  then
    return jsonb_build_object('cleanupAllowed', false);
  end if;

  perform 1
    from public.employee_profiles as profile
    where profile.employee_number = request_row.employee_number
       or profile.auth_user_id = p_auth_user_id
    for update;

  if exists (
    select 1
    from public.employee_profiles as linked_profile
    where linked_profile.auth_user_id = p_auth_user_id
      and linked_profile.employee_number <> request_row.employee_number
  ) then
    return jsonb_build_object('cleanupAllowed', false);
  end if;

  select profile.*
    into profile_row
    from public.employee_profiles as profile
    where profile.employee_number = request_row.employee_number
    for update;
  if found then
    if profile_row.auth_user_id is not distinct from p_auth_user_id
      and not profile_row.is_hidden_system_account
      and profile_row.deleted_at is null
      and profile_row.account_status = 'active'
      and profile_row.must_change_password is true
    then
      update public.employee_provisioning_requests
        set status = 'completed',
            employee_profile_id = profile_row.id,
            auth_user_id = p_auth_user_id,
            completed_at = coalesce(completed_at, clock_timestamp()),
            safe_error_code = null,
            owner_token = null,
            owner_expires_at = null
        where request_id = p_request_id;
      return jsonb_build_object(
        'cleanupAllowed', false,
        'employee', private.employee_safe_summary(profile_row)
      );
    end if;
    return jsonb_build_object('cleanupAllowed', false);
  end if;

  if request_row.status not in ('auth_created', 'compensation_pending') then
    return jsonb_build_object('cleanupAllowed', false);
  end if;

  update public.employee_provisioning_requests
    set status = 'compensation_pending',
        safe_error_code = p_safe_error_code,
        owner_expires_at = clock_timestamp() + interval '5 minutes'
    where request_id = p_request_id;
  return jsonb_build_object('cleanupAllowed', true);
end;
$$;

create or replace function public.complete_employee_provisioning_compensation(
  p_request_id uuid,
  p_owner_token uuid,
  p_auth_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.employee_provisioning_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_request_id is null or p_owner_token is null or p_auth_user_id is null then
    raise exception using errcode = '22023', message = 'invalid compensation completion';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select request.*
    into request_row
    from public.employee_provisioning_requests as request
    where request.request_id = p_request_id
    for update;
  if not found
    or request_row.owner_token is distinct from p_owner_token
    or request_row.status <> 'compensation_pending'
    or request_row.auth_user_id_snapshot is distinct from p_auth_user_id
    or exists (select 1 from auth.users as auth_user where auth_user.id = p_auth_user_id)
    or exists (
      select 1
      from public.employee_profiles as profile
      where profile.employee_number = request_row.employee_number
         or profile.auth_user_id = p_auth_user_id
    )
  then
    return false;
  end if;

  update public.employee_provisioning_requests
    set status = 'compensated',
        auth_user_id = null,
        compensated_at = clock_timestamp(),
        owner_token = null,
        owner_expires_at = null
    where request_id = p_request_id;
  return true;
end;
$$;

create or replace function public.get_employee_admin_target(
  p_employee_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  profile_row public.employee_profiles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_id is null then
    raise exception using errcode = '22023', message = 'invalid employee target';
  end if;

  select profile.*
    into profile_row
    from public.employee_profiles as profile
    where profile.id = p_employee_id
      and profile.deleted_at is null
      and profile.auth_user_id is not null
      and profile.is_hidden_system_account = false
      and profile.employee_number <> 'SW-000';
  if not found then
    raise exception using errcode = '22023', message = 'employee target unavailable';
  end if;

  return jsonb_build_object(
    'employee', private.employee_safe_summary(profile_row),
    'authUserId', profile_row.auth_user_id
  );
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

  select key
    into unknown_key
    from jsonb_object_keys(p_patch) as submitted(key)
    where submitted.key <> all (array[
      'name', 'gender', 'birthDate', 'nationality', 'employmentStatus',
      'hireDate', 'resignDate', 'department', 'position', 'level', 'phone',
      'emergencyContactName', 'emergencyContactPhone', 'currentAddress',
      'visaAgency', 'visaType', 'visaExpireDate', 'passportNumber',
      'residenceCardNumber', 'baseSalary', 'dailySalary', 'hourlyWage',
      'salaryRemark', 'wecomUserId', 'wecomDepartmentId',
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

create or replace function public.disable_employee_account_admin(
  p_employee_id uuid,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
as $$
declare
  profile_row public.employee_profiles%rowtype;
  revoked_session_count bigint := 0;
  revoked_legacy_token_count bigint := 0;
  sessions_revoked boolean := true;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_id is null or p_actor_auth_user_id is null then
    raise exception using errcode = '22023', message = 'invalid account target';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    '{}'::jsonb
  );

  update public.employee_profiles as profile
    set account_status = 'disabled',
        updated_by_auth_user_id = p_actor_auth_user_id
    where profile.id = p_employee_id
      and profile.deleted_at is null
      and profile.auth_user_id is not null
      and profile.is_hidden_system_account = false
      and profile.employee_number <> 'SW-000'
    returning * into profile_row;
  if not found then
    raise exception using errcode = '22023', message = 'employee target unavailable';
  end if;

  begin
    delete from auth.sessions as session
      where session.user_id = profile_row.auth_user_id;
    get diagnostics revoked_session_count = row_count;

    -- Legacy GoTrue rows can predate session linkage and therefore do not cascade.
    delete from auth.refresh_tokens as refresh_token
      where refresh_token.user_id = profile_row.auth_user_id::text
        and refresh_token.session_id is null;
    get diagnostics revoked_legacy_token_count = row_count;
  exception when others then
    sessions_revoked := false;
    revoked_session_count := 0;
    revoked_legacy_token_count := 0;
  end;

  insert into public.employee_security_audit (
    actor_auth_user_id,
    target_employee_profile_id,
    action,
    safe_details
  ) values (
    p_actor_auth_user_id,
    profile_row.id,
    'employee.account_disabled',
    jsonb_build_object(
      'revokedSessionCount', revoked_session_count,
      'revokedLegacyTokenCount', revoked_legacy_token_count,
      'sessionsRevoked', sessions_revoked
    )
  );
  return jsonb_build_object(
    'employee', private.employee_safe_summary(profile_row),
    'authUserId', profile_row.auth_user_id,
    'sessionsRevoked', sessions_revoked
  );
end;
$$;

create or replace function public.activate_employee_account_admin(
  p_employee_id uuid,
  p_auth_user_id uuid,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  profile_row public.employee_profiles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_id is null or p_auth_user_id is null or p_actor_auth_user_id is null then
    raise exception using errcode = '22023', message = 'invalid account activation';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    '{}'::jsonb
  );

  update public.employee_profiles as profile
    set account_status = 'active',
        updated_by_auth_user_id = p_actor_auth_user_id
    where profile.id = p_employee_id
      and profile.auth_user_id = p_auth_user_id
      and profile.deleted_at is null
      and profile.is_hidden_system_account = false
      and profile.employee_number <> 'SW-000'
    returning * into profile_row;
  if not found then
    raise exception using errcode = '22023', message = 'employee target unavailable';
  end if;

  insert into public.employee_security_audit (
    actor_auth_user_id,
    target_employee_profile_id,
    action,
    safe_details
  ) values (
    p_actor_auth_user_id,
    profile_row.id,
    'employee.account_activated',
    '{}'::jsonb
  );
  return private.employee_safe_summary(profile_row);
end;
$$;

create or replace function public.claim_employee_password_reset(
  p_employee_id uuid,
  p_proposed_request_id uuid,
  p_owner_token uuid,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  profile_row public.employee_profiles%rowtype;
  reset_row public.employee_password_reset_requests%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_id is null
    or p_proposed_request_id is null
    or p_owner_token is null
    or p_actor_auth_user_id is null
  then
    raise exception using errcode = '22023', message = 'invalid password reset claim';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    '{}'::jsonb
  );
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 1));

  select profile.*
    into profile_row
    from public.employee_profiles as profile
    where profile.id = p_employee_id
      and profile.auth_user_id is not null
      and profile.deleted_at is null
      and profile.account_status = 'active'
      and profile.employment_status = '在职'
      and profile.is_hidden_system_account = false
      and profile.employee_number <> 'SW-000'
    for update;
  if not found then
    raise exception using errcode = '22023', message = 'employee target unavailable';
  end if;

  select reset.*
    into reset_row
    from public.employee_password_reset_requests as reset
    where reset.employee_profile_id = p_employee_id
    for update;

  if found and reset_row.auth_user_id is distinct from profile_row.auth_user_id then
    raise exception using errcode = '22023', message = 'password reset target conflict';
  end if;

  if found and reset_row.status = 'pending' then
    if reset_row.owner_token is not null
      and reset_row.owner_token <> p_owner_token
      and reset_row.owner_expires_at > clock_timestamp()
    then
      return jsonb_build_object(
        'ownerAcquired', false,
        'status', 'pending',
        'requestId', reset_row.reset_request_id,
        'employee', private.employee_safe_summary(profile_row)
      );
    end if;

    update public.employee_password_reset_requests
      set owner_token = p_owner_token,
          owner_expires_at = clock_timestamp() + interval '5 minutes',
          actor_auth_user_id = p_actor_auth_user_id,
          updated_at = clock_timestamp()
      where employee_profile_id = p_employee_id
      returning * into reset_row;
  elsif found
    and reset_row.status = 'completed'
    and reset_row.completed_at + interval '5 minutes' > clock_timestamp()
  then
    return jsonb_build_object(
      'ownerAcquired', false,
      'status', 'cooldown',
      'requestId', reset_row.reset_request_id,
      'employee', private.employee_safe_summary(profile_row)
    );
  else
    insert into public.employee_password_reset_requests (
      employee_profile_id,
      reset_request_id,
      auth_user_id,
      status,
      owner_token,
      owner_expires_at,
      actor_auth_user_id,
      completed_at,
      created_at,
      updated_at
    ) values (
      p_employee_id,
      p_proposed_request_id,
      profile_row.auth_user_id,
      'pending',
      p_owner_token,
      clock_timestamp() + interval '5 minutes',
      p_actor_auth_user_id,
      null,
      clock_timestamp(),
      clock_timestamp()
    )
    on conflict (employee_profile_id) do update
      set reset_request_id = excluded.reset_request_id,
          auth_user_id = excluded.auth_user_id,
          status = 'pending',
          owner_token = excluded.owner_token,
          owner_expires_at = excluded.owner_expires_at,
          actor_auth_user_id = excluded.actor_auth_user_id,
          completed_at = null,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at
    returning * into reset_row;
  end if;

  return jsonb_build_object(
    'ownerAcquired', true,
    'status', 'pending',
    'requestId', reset_row.reset_request_id,
    'authUserId', reset_row.auth_user_id,
    'employee', private.employee_safe_summary(profile_row)
  );
end;
$$;

create or replace function public.renew_employee_password_reset_owner(
  p_employee_id uuid,
  p_request_id uuid,
  p_owner_token uuid,
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
  if p_employee_id is null
    or p_request_id is null
    or p_owner_token is null
    or p_auth_user_id is null
  then
    raise exception using errcode = '22023', message = 'invalid password reset renewal';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 1));
  update public.employee_password_reset_requests as reset
    set owner_expires_at = clock_timestamp() + interval '5 minutes',
        updated_at = clock_timestamp()
    where reset.employee_profile_id = p_employee_id
      and reset.reset_request_id = p_request_id
      and reset.auth_user_id = p_auth_user_id
      and reset.status = 'pending'
      and reset.owner_token = p_owner_token
      and reset.owner_expires_at > clock_timestamp();
  return found;
end;
$$;

create or replace function public.complete_employee_password_reset(
  p_employee_id uuid,
  p_request_id uuid,
  p_owner_token uuid,
  p_auth_user_id uuid,
  p_actor_auth_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  profile_row public.employee_profiles%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'service_role required';
  end if;
  if p_employee_id is null
    or p_request_id is null
    or p_owner_token is null
    or p_auth_user_id is null
    or p_actor_auth_user_id is null
  then
    raise exception using errcode = '22023', message = 'invalid password reset completion';
  end if;

  perform private.assert_employee_profile_write_authorized(
    p_actor_auth_user_id,
    '{}'::jsonb
  );
  perform pg_advisory_xact_lock(hashtextextended(p_employee_id::text, 1));
  perform 1
    from public.employee_password_reset_requests as reset
    where reset.employee_profile_id = p_employee_id
      and reset.reset_request_id = p_request_id
      and reset.auth_user_id = p_auth_user_id
      and reset.status = 'pending'
      and reset.owner_token = p_owner_token
      and reset.owner_expires_at > clock_timestamp()
    for update;
  if not found then
    raise exception using errcode = '22023', message = 'password reset ownership conflict';
  end if;

  update public.employee_profiles as profile
    set must_change_password = true,
        updated_by_auth_user_id = p_actor_auth_user_id
    where profile.id = p_employee_id
      and profile.auth_user_id = p_auth_user_id
      and profile.deleted_at is null
      and profile.account_status = 'active'
      and profile.employment_status = '在职'
      and profile.is_hidden_system_account = false
      and profile.employee_number <> 'SW-000'
    returning * into profile_row;
  if not found then
    raise exception using errcode = '22023', message = 'employee target unavailable';
  end if;

  update public.employee_password_reset_requests
    set status = 'completed',
        owner_token = null,
        owner_expires_at = null,
        completed_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where employee_profile_id = p_employee_id;

  insert into public.employee_security_audit (
    actor_auth_user_id,
    target_employee_profile_id,
    action,
    safe_details
  ) values (
    p_actor_auth_user_id,
    profile_row.id,
    'employee.temporary_password_reset',
    jsonb_build_object('requestId', p_request_id)
  );
  return private.employee_safe_summary(profile_row);
end;
$$;

drop function if exists public.mark_employee_temporary_password(uuid, uuid, uuid);

revoke all on function private.employee_safe_summary(public.employee_profiles) from public, anon, authenticated;
revoke all on function private.assert_employee_profile_write_authorized(uuid, jsonb) from public, anon, authenticated, service_role;

revoke all on function public.claim_employee_provisioning(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_employee_provisioning(uuid, uuid) to service_role;

revoke all on function public.renew_employee_provisioning_owner(uuid, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.renew_employee_provisioning_owner(uuid, uuid, text, uuid) to service_role;

revoke all on function public.record_employee_provisioning_auth(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_employee_provisioning_auth(uuid, uuid, uuid) to service_role;

revoke all on function public.complete_employee_provisioning(uuid, uuid, uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.complete_employee_provisioning(uuid, uuid, uuid, jsonb, uuid) to service_role;

revoke all on function public.prepare_employee_provisioning_compensation(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.prepare_employee_provisioning_compensation(uuid, uuid, uuid, text) to service_role;

revoke all on function public.complete_employee_provisioning_compensation(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_employee_provisioning_compensation(uuid, uuid, uuid) to service_role;

revoke all on function public.get_employee_admin_target(uuid) from public, anon, authenticated;
grant execute on function public.get_employee_admin_target(uuid) to service_role;

revoke all on function public.update_employee_profile_admin(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.update_employee_profile_admin(uuid, jsonb, uuid) to service_role;

revoke all on function public.disable_employee_account_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disable_employee_account_admin(uuid, uuid) to service_role;

revoke all on function public.activate_employee_account_admin(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_employee_account_admin(uuid, uuid, uuid) to service_role;

revoke all on function public.claim_employee_password_reset(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_employee_password_reset(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.renew_employee_password_reset_owner(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.renew_employee_password_reset_owner(uuid, uuid, uuid, uuid) to service_role;

revoke all on function public.complete_employee_password_reset(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_employee_password_reset(uuid, uuid, uuid, uuid, uuid) to service_role;

revoke all on table public.employee_password_reset_requests from public, anon, authenticated;

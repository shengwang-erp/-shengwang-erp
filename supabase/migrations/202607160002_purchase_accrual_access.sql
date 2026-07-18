-- RPC-only purchase accrual access. Authenticated/browser row grants and RLS
-- remain unchanged; service_role TRUNCATE is revoked so parent integrity cannot
-- be bypassed while payment-sensitive direct table access stays fail-closed.

create or replace function private.purchase_payment_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'openingPaidAmount',
    'paidAmount',
    'unpaidAmount',
    'paymentStatus'
  ]::text[];
$$;

create or replace function private.purchase_client_audit_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'created_by_employee_id',
    'created_by_employee_name',
    'updated_by_employee_id',
    'updated_by_employee_name',
    'createdByEmployeeId',
    'createdByEmployeeName',
    'updatedByEmployeeId',
    'updatedByEmployeeName'
  ]::text[];
$$;

create or replace function private.purchase_payload_has_unsafe_keys(
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  payload_key text;
  payload_value jsonb;
begin
  if p_payload is null then
    return false;
  end if;

  if jsonb_typeof(p_payload) = 'object' then
    for payload_key, payload_value in
      select entry.key, entry.value
      from pg_catalog.jsonb_each(p_payload) as entry(key, value)
    loop
      if payload_key in ('__proto__', 'constructor', 'prototype')
        or private.purchase_payload_has_unsafe_keys(payload_value)
      then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_payload) = 'array' then
    for payload_value in
      select element.value
      from pg_catalog.jsonb_array_elements(p_payload) as element(value)
    loop
      if private.purchase_payload_has_unsafe_keys(payload_value) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

create or replace function private.require_purchase_read_committed()
returns void
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = '25001',
      message = 'purchase mutations require read committed isolation';
  end if;
end;
$$;

create or replace function private.lock_purchase_record_key(
  p_record_key text
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = pg_catalog
as $$
declare
  lock_key bigint;
begin
  perform private.require_purchase_read_committed();
  lock_key := pg_catalog.hashtextextended(
    'public.purchase_records:' || p_record_key,
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(lock_key);
  return lock_key;
end;
$$;

create or replace function private.guard_purchase_parent_truncate()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using
    errcode = '42501',
    message = 'purchase record truncation is not allowed';
end;
$$;

create or replace function private.guard_purchase_records_direct_write()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  relation_owner name;
begin
  select pg_catalog.pg_get_userbyid(relation.relowner)
    into relation_owner
    from pg_catalog.pg_class as relation
    where relation.oid = tg_relid;

  if current_user = relation_owner or current_user = 'service_role' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  raise exception using
    errcode = '42501',
    message = 'direct purchase record writes are not allowed';
end;
$$;

create or replace function private.guard_purchase_parent_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  old_record_key text;
  new_record_key text;
  has_linked_facts boolean;
begin
  perform private.require_purchase_read_committed();

  if tg_op <> 'INSERT' then
    old_record_key := old.record_key;
  end if;
  if tg_op <> 'DELETE' then
    new_record_key := new.record_key;
  end if;

  -- INSERT has not resolved a possible ON CONFLICT tuple yet. It has no
  -- linked-fact state to protect, so defer all key locking to BEFORE UPDATE
  -- if PostgreSQL converts the insert into an update.
  if tg_op = 'INSERT' then
    return new;
  end if;

  -- A key-changing UPDATE can encounter an existing target only after BEFORE
  -- triggers. Lock that target tuple first so its ordinary updater never waits
  -- on a logical key held by this rebind while the rebind waits on its tuple.
  if old_record_key is distinct from new_record_key then
    perform 1
    from public.purchase_records as target_purchase
    where target_purchase.record_key = new_record_key
    for update;
  end if;

  if old_record_key is not null
    and new_record_key is not null
    and old_record_key <> new_record_key
  then
    if old_record_key < new_record_key then
      perform private.lock_purchase_record_key(old_record_key);
      perform private.lock_purchase_record_key(new_record_key);
    else
      perform private.lock_purchase_record_key(new_record_key);
      perform private.lock_purchase_record_key(old_record_key);
    end if;
  else
    perform private.lock_purchase_record_key(
      coalesce(new_record_key, old_record_key)
    );
  end if;

  if tg_op = 'DELETE'
    or (
      tg_op = 'UPDATE'
      and (
        old.record_key is distinct from new.record_key
        or (
          old.status = 'active'
          and new.status is distinct from 'active'
        )
      )
    )
  then
    select exists (
        select 1
          from public.purchase_payment_records as payment
          where payment.status = 'active'
            and btrim(payment.payload->>'purchaseId') = old_record_key
      ) or exists (
        select 1
          from public.stock_in_records as stock_in
          where stock_in.status = 'active'
            and btrim(stock_in.payload->>'sourcePurchaseId') = old_record_key
      )
      into has_linked_facts;
    if has_linked_facts then
      raise exception using
        errcode = '23503',
        message = 'purchase record has linked facts';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function private.authorize_purchase_link_fact_insert()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  relation_owner name;
  insert_is_authorized boolean := false;
begin
  if tg_table_schema <> 'public'
    or tg_table_name not in (
      'purchase_payment_records',
      'stock_in_records'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase fact table required';
  end if;

  select pg_catalog.pg_get_userbyid(relation.relowner)
    into relation_owner
    from pg_catalog.pg_class as relation
    where relation.oid = tg_relid;

  if current_user = relation_owner or current_user = 'service_role' then
    return new;
  end if;

  if current_user = 'authenticated'
    and new.status = 'active'
    and public.is_current_employee_active()
  then
    if tg_table_name = 'purchase_payment_records' then
      insert_is_authorized :=
        public.has_current_permission('module.purchases.create')
        and public.has_current_permission(
          'sensitive.purchase_payments_update'
        );
    else
      insert_is_authorized := public.has_current_permission(
        'module.inventory.create'
      );
    end if;
  end if;

  if not insert_is_authorized then
    raise exception using
      errcode = '42501',
      message = 'purchase fact insert permission required';
  end if;

  return new;
end;
$$;

create or replace function private.guard_purchase_link_fact_write()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  link_field text := tg_argv[0];
  old_link_key text;
  new_link_key text;
  new_raw_link text;
  parent_is_active boolean;
  target_fact_found boolean := false;
begin
  perform private.require_purchase_read_committed();

  if link_field not in ('purchaseId', 'sourcePurchaseId') then
    raise exception using
      errcode = '22023',
      message = 'valid purchase link field required';
  end if;
  if tg_table_schema <> 'public'
    or tg_table_name not in (
      'purchase_payment_records',
      'stock_in_records'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase fact table required';
  end if;

  if tg_op <> 'INSERT'
    and old.status = 'active'
    and jsonb_typeof(old.payload->link_field) = 'string'
  then
    old_link_key := nullif(btrim(old.payload->>link_field), '');
  end if;
  if tg_op <> 'DELETE' and new.status = 'active' then
    new_raw_link := new.payload->>link_field;
    if jsonb_typeof(new.payload->link_field) is distinct from 'string'
      or new_raw_link is null
      or new_raw_link = ''
      or new_raw_link <> btrim(new_raw_link)
      or char_length(new_raw_link) > 200
      or new_raw_link !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
    then
      raise exception using
        errcode = '23503',
        message = 'active purchase record required';
    end if;
    new_link_key := new_raw_link;
  end if;

  -- INSERT pre-locks a possible ON CONFLICT tuple; UPDATE already owns its
  -- source tuple and pre-locks a possible rebind target. Either way, no later
  -- uniqueness check can wait on a tuple after a purchase-key lock is held.
  if tg_op = 'INSERT'
    or (
      tg_op = 'UPDATE'
      and old.record_key is distinct from new.record_key
    )
  then
    if tg_table_name = 'purchase_payment_records' then
      perform 1
      from public.purchase_payment_records as target_payment
      where target_payment.record_key = new.record_key
      for update;
      target_fact_found := found;
    else
      perform 1
      from public.stock_in_records as target_stock_in
      where target_stock_in.record_key = new.record_key
      for update;
      target_fact_found := found;
    end if;
  end if;

  -- A conflicting INSERT already owns the target child tuple. It must not
  -- acquire either parent key here: PostgreSQL will next execute the UPDATE
  -- trigger, which has both old and new links and takes their complete sorted
  -- key set. DO NOTHING and duplicate-error paths do not mutate the child.
  if tg_op = 'INSERT' and target_fact_found then
    return new;
  end if;

  -- A genuinely new INSERT has no child tuple and may lock its parent first.
  if tg_op = 'INSERT'
    and new_link_key is not null
  then
    select true
      into parent_is_active
      from public.purchase_records as purchase
      where purchase.record_key = new_link_key
        and purchase.status = 'active'
      for share;
    parent_is_active := found;
  end if;

  -- A found INSERT parent is protected by FOR SHARE and needs no logical key.
  -- Missing-parent INSERTs and all UPDATE/DELETE paths use the shared key and
  -- then evaluate a fresh READ COMMITTED snapshot.
  if tg_op <> 'INSERT'
    or (
      new_link_key is not null
      and not parent_is_active
    )
  then
    if old_link_key is not null
      and new_link_key is not null
      and old_link_key <> new_link_key
    then
      if old_link_key < new_link_key then
        perform private.lock_purchase_record_key(old_link_key);
        perform private.lock_purchase_record_key(new_link_key);
      else
        perform private.lock_purchase_record_key(new_link_key);
        perform private.lock_purchase_record_key(old_link_key);
      end if;
    elsif coalesce(new_link_key, old_link_key) is not null then
      perform private.lock_purchase_record_key(
        coalesce(new_link_key, old_link_key)
      );
    end if;
  end if;

  if new_link_key is not null then
    if tg_op = 'INSERT'
      and not target_fact_found
      and not parent_is_active
    then
      -- A parent rebind may have made the new key invisible before the key
      -- lock was acquired. This fresh check intentionally takes no tuple lock:
      -- the key already serializes any later parent mutation, avoiding a
      -- key -> parent tuple inversion against parent tuple -> key updates.
      select exists (
        select 1
        from public.purchase_records as purchase
        where purchase.record_key = new_link_key
          and purchase.status = 'active'
      ) into parent_is_active;
    elsif tg_op <> 'INSERT' then
      select exists (
        select 1
        from public.purchase_records as purchase
        where purchase.record_key = new_link_key
          and purchase.status = 'active'
      ) into parent_is_active;
    end if;
  end if;
  if new_link_key is not null then
    if not parent_is_active then
      raise exception using
        errcode = '23503',
        message = 'active purchase record required';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.purchase_payment_payload_keys()
  from public, anon, authenticated, service_role;
revoke all on function private.purchase_client_audit_payload_keys()
  from public, anon, authenticated, service_role;
revoke all on function private.purchase_payload_has_unsafe_keys(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.require_purchase_read_committed()
  from public, anon, authenticated, service_role;
revoke all on function private.lock_purchase_record_key(text)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_purchase_parent_truncate()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_purchase_records_direct_write()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_purchase_parent_write()
  from public, anon, authenticated, service_role;
revoke all on function private.authorize_purchase_link_fact_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_purchase_link_fact_write()
  from public, anon, authenticated, service_role;

drop trigger if exists block_purchase_records_direct_write
  on public.purchase_records;
create trigger block_purchase_records_direct_write
before insert or update or delete on public.purchase_records
for each row execute function private.guard_purchase_records_direct_write();

drop trigger if exists block_purchase_parent_truncate
  on public.purchase_records;
create trigger block_purchase_parent_truncate
before truncate on public.purchase_records
for each statement execute function private.guard_purchase_parent_truncate();

drop trigger if exists guard_purchase_parent_links
  on public.purchase_records;
create trigger guard_purchase_parent_links
before update or delete on public.purchase_records
for each row execute function private.guard_purchase_parent_write();

drop trigger if exists guard_active_purchase_link
  on public.purchase_payment_records;
create trigger guard_active_purchase_link
before update or delete on public.purchase_payment_records
for each row execute function private.guard_purchase_link_fact_write('purchaseId');
drop trigger if exists guard_active_purchase_link_insert
  on public.purchase_payment_records;
drop trigger if exists authorize_purchase_link_fact_insert
  on public.purchase_payment_records;
create trigger authorize_purchase_link_fact_insert
before insert on public.purchase_payment_records
for each row execute function private.authorize_purchase_link_fact_insert();
create trigger guard_active_purchase_link_insert
before insert on public.purchase_payment_records
for each row execute function private.guard_purchase_link_fact_write('purchaseId');

drop trigger if exists guard_active_purchase_link
  on public.stock_in_records;
create trigger guard_active_purchase_link
before update or delete on public.stock_in_records
for each row execute function private.guard_purchase_link_fact_write('sourcePurchaseId');
drop trigger if exists guard_active_purchase_link_insert
  on public.stock_in_records;
drop trigger if exists authorize_purchase_link_fact_insert
  on public.stock_in_records;
create trigger authorize_purchase_link_fact_insert
before insert on public.stock_in_records
for each row execute function private.authorize_purchase_link_fact_insert();
create trigger guard_active_purchase_link_insert
before insert on public.stock_in_records
for each row execute function private.guard_purchase_link_fact_write('sourcePurchaseId');

revoke truncate on table public.purchase_records from service_role;

create or replace function public.list_purchase_records_secure()
returns table (
  record_key text,
  payload jsonb,
  status text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  can_view_payments boolean;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.purchases.view')
  then
    raise exception using
      errcode = '42501',
      message = 'purchase view permission required';
  end if;

  can_view_payments := public.has_current_permission(
    'sensitive.purchase_payments_view'
  );

  return query
  select
    purchase.record_key,
    case
      when can_view_payments then purchase.payload
      else purchase.payload - private.purchase_payment_payload_keys()
    end,
    purchase.status,
    purchase.updated_at
  from public.purchase_records as purchase
  where purchase.status = 'active'
  order by purchase.updated_at desc, purchase.record_key;
end;
$$;

create or replace function public.upsert_purchase_record_secure(
  p_record_key text,
  p_payload jsonb,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  existing_purchase public.purchase_records%rowtype;
  saved_purchase public.purchase_records%rowtype;
  existing_found boolean;
  can_update_payments boolean;
  can_view_payments boolean;
  effective_payload jsonb;
  next_payload jsonb;
  response_payload jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  if p_record_key is null
    or p_record_key = ''
    or p_record_key <> btrim(p_record_key)
    or char_length(p_record_key) > 200
    or p_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase record key required';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'purchase payload must be a JSON object';
  end if;

  if p_status is distinct from 'active' then
    raise exception using
      errcode = '22023',
      message = 'purchase status must be active';
  end if;

  if private.purchase_payload_has_unsafe_keys(p_payload) then
    raise exception using
      errcode = '22023',
      message = 'unsafe purchase payload key';
  end if;

  if p_payload ?| private.purchase_client_audit_payload_keys() then
    raise exception using
      errcode = '22023',
      message = 'client audit fields are not accepted';
  end if;

  if p_payload ? 'purchaseId'
    and (
      jsonb_typeof(p_payload->'purchaseId') is distinct from 'string'
      or p_payload->>'purchaseId' is distinct from p_record_key
    )
  then
    raise exception using
      errcode = '22023',
      message = 'purchase record key mismatch';
  end if;

  perform private.require_purchase_read_committed();
  select purchase.*
    into existing_purchase
    from public.purchase_records as purchase
    where purchase.record_key = p_record_key
    for update;
  existing_found := found;

  -- Existing-row paths use tuple -> logical key, matching direct row DML.
  -- Missing-row paths take the key and recheck before deciding to insert.
  perform private.lock_purchase_record_key(p_record_key);
  if not existing_found then
    select purchase.*
      into existing_purchase
      from public.purchase_records as purchase
      where purchase.record_key = p_record_key
      for update;
    existing_found := found;
  end if;

  if existing_found then
    if not public.has_current_permission('module.purchases.update') then
      raise exception using
        errcode = '42501',
        message = 'purchase update permission required';
    end if;
    if existing_purchase.status <> 'active' then
      raise exception using
        errcode = 'P0002',
        message = 'purchase record not found';
    end if;
  elsif not public.has_current_permission('module.purchases.create') then
    raise exception using
      errcode = '42501',
      message = 'purchase create permission required';
  end if;

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  can_update_payments := public.has_current_permission(
    'sensitive.purchase_payments_update'
  );
  can_view_payments := public.has_current_permission(
    'sensitive.purchase_payments_view'
  );

  effective_payload := p_payload;
  if not can_update_payments then
    effective_payload := effective_payload
      - private.purchase_payment_payload_keys();
  end if;
  effective_payload := effective_payload || jsonb_build_object(
    'purchaseId', p_record_key
  );

  if existing_found then
    next_payload := existing_purchase.payload || effective_payload;
    next_payload := next_payload || jsonb_build_object(
      'purchaseId', p_record_key
    );

    update public.purchase_records as purchase
      set payload = next_payload,
          updated_by_employee_id = actor.id::text,
          updated_by_employee_name = actor.name
      where purchase.record_key = p_record_key
      returning purchase.* into saved_purchase;
  else
    next_payload := effective_payload;

    insert into public.purchase_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      p_record_key,
      next_payload,
      'active',
      actor.id::text,
      actor.name,
      actor.id::text,
      actor.name
    )
    returning * into saved_purchase;
  end if;

  response_payload := case
    when can_view_payments then saved_purchase.payload
    else saved_purchase.payload - private.purchase_payment_payload_keys()
  end;

  return jsonb_build_object(
    'record_key', saved_purchase.record_key,
    'payload', response_payload,
    'status', saved_purchase.status,
    'updated_at', saved_purchase.updated_at
  );
end;
$$;

create or replace function public.soft_delete_purchase_record_secure(
  p_record_key text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  can_view_purchase boolean;
  can_view_payments boolean;
  can_view_stock_ins boolean;
  can_view_missing_purchase boolean;
  can_view_linked_facts boolean;
  deleted_record_key text;
  existing_purchase public.purchase_records%rowtype;
  has_linked_payments boolean;
  has_linked_stock_ins boolean;
  has_linked_facts boolean;
  purchase_found boolean;
  purchase_is_active boolean;
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.purchases.delete')
  then
    raise exception using
      errcode = '42501',
      message = 'purchase delete permission required';
  end if;

  if p_record_key is null
    or p_record_key = ''
    or p_record_key <> btrim(p_record_key)
    or char_length(p_record_key) > 200
    or p_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase record key required';
  end if;

  perform private.require_purchase_read_committed();

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  can_view_purchase :=
    public.has_current_permission('module.purchases.view');
  can_view_payments :=
    public.has_current_permission('sensitive.purchase_payments_view');
  can_view_stock_ins :=
    public.has_current_permission('module.inventory.view');
  can_view_missing_purchase := can_view_purchase and can_view_payments;
  select purchase.*
    into existing_purchase
    from public.purchase_records as purchase
    where purchase.record_key = p_record_key
    for update;
  purchase_found := found;
  purchase_is_active := purchase_found
    and existing_purchase.status = 'active';

  perform private.lock_purchase_record_key(p_record_key);
  if not purchase_found then
    select purchase.*
      into existing_purchase
      from public.purchase_records as purchase
      where purchase.record_key = p_record_key
      for update;
    purchase_found := found;
    purchase_is_active := purchase_found
      and existing_purchase.status = 'active';
  end if;
  if not purchase_is_active then
    if can_view_missing_purchase then
      raise exception using
        errcode = 'P0002',
        message = 'purchase record not found';
    end if;
    raise exception using
      errcode = '23503',
      message = 'purchase record cannot be deleted';
  end if;

  select exists (
      select 1
        from public.purchase_payment_records as payment
        where payment.status = 'active'
          and btrim(payment.payload->>'purchaseId') = p_record_key
    ), exists (
      select 1
        from public.stock_in_records as stock_in
        where stock_in.status = 'active'
          and btrim(stock_in.payload->>'sourcePurchaseId') = p_record_key
    ) into has_linked_payments, has_linked_stock_ins;
  has_linked_facts := has_linked_payments or has_linked_stock_ins;
  can_view_linked_facts := can_view_purchase
    and (not has_linked_payments or can_view_payments)
    and (not has_linked_stock_ins or can_view_stock_ins);
  if has_linked_facts then
    if can_view_linked_facts then
      raise exception using
        errcode = '23503',
        message = 'purchase record has linked facts';
    end if;
    raise exception using
      errcode = '23503',
      message = 'purchase record cannot be deleted';
  end if;

  update public.purchase_records as purchase
    set status = 'deleted',
        updated_by_employee_id = actor.id::text,
        updated_by_employee_name = actor.name
    where purchase.record_key = p_record_key
      and purchase.status = 'active'
    returning purchase.record_key into deleted_record_key;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'purchase record not found';
  end if;

  return deleted_record_key;
end;
$$;

create or replace function public.commit_purchase_stock_in_secure(
  p_purchase_record_key text,
  p_purchase_patch jsonb,
  p_stock_in_record_key text,
  p_stock_in_payload jsonb,
  p_inventory_record_key text,
  p_inventory_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  existing_purchase public.purchase_records%rowtype;
  existing_stock_in public.stock_in_records%rowtype;
  existing_inventory public.inventory_items%rowtype;
  saved_stock_in public.stock_in_records%rowtype;
  saved_inventory public.inventory_items%rowtype;
  purchase_found boolean;
  stock_in_found boolean;
  inventory_found boolean;
  effective_stock_in_payload jsonb;
  effective_inventory_payload jsonb;
  purchase_result jsonb;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  if p_purchase_record_key is null
    or p_purchase_record_key = ''
    or p_purchase_record_key <> btrim(p_purchase_record_key)
    or char_length(p_purchase_record_key) > 200
    or p_purchase_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using
      errcode = '22023',
      message = 'valid purchase record key required';
  end if;
  if p_stock_in_record_key is null
    or p_stock_in_record_key = ''
    or p_stock_in_record_key <> btrim(p_stock_in_record_key)
    or char_length(p_stock_in_record_key) > 200
    or p_stock_in_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using
      errcode = '22023',
      message = 'valid stock-in record key required';
  end if;
  if p_inventory_record_key is null
    or p_inventory_record_key = ''
    or p_inventory_record_key <> btrim(p_inventory_record_key)
    or char_length(p_inventory_record_key) > 200
    or p_inventory_record_key !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$'
  then
    raise exception using
      errcode = '22023',
      message = 'valid inventory record key required';
  end if;

  if jsonb_typeof(p_purchase_patch) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'purchase payload must be a JSON object';
  end if;
  if jsonb_typeof(p_stock_in_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'stock-in payload must be a JSON object';
  end if;
  if jsonb_typeof(p_inventory_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'inventory payload must be a JSON object';
  end if;

  if jsonb_typeof(p_purchase_patch->'purchaseId') is distinct from 'string'
    or p_purchase_patch->>'purchaseId' is distinct from p_purchase_record_key
  then
    raise exception using
      errcode = '22023',
      message = 'purchase record key mismatch';
  end if;
  if jsonb_typeof(p_stock_in_payload->'stockInId') is distinct from 'string'
    or p_stock_in_payload->>'stockInId' is distinct from p_stock_in_record_key
  then
    raise exception using
      errcode = '22023',
      message = 'stock-in record key mismatch';
  end if;
  if jsonb_typeof(p_inventory_payload->'inventoryId') is distinct from 'string'
    or p_inventory_payload->>'inventoryId' is distinct from p_inventory_record_key
  then
    raise exception using
      errcode = '22023',
      message = 'inventory record key mismatch';
  end if;
  if jsonb_typeof(p_stock_in_payload->'sourcePurchaseId')
      is distinct from 'string'
    or p_stock_in_payload->>'sourcePurchaseId'
      is distinct from p_purchase_record_key
  then
    raise exception using
      errcode = '22023',
      message = 'stock-in purchase key mismatch';
  end if;

  if private.purchase_payload_has_unsafe_keys(p_purchase_patch)
    or private.purchase_payload_has_unsafe_keys(p_stock_in_payload)
    or private.purchase_payload_has_unsafe_keys(p_inventory_payload)
  then
    raise exception using
      errcode = '22023',
      message = 'unsafe purchase payload key';
  end if;
  if p_purchase_patch ?| private.purchase_client_audit_payload_keys()
    or p_stock_in_payload ?| private.purchase_client_audit_payload_keys()
    or p_inventory_payload ?| private.purchase_client_audit_payload_keys()
  then
    raise exception using
      errcode = '22023',
      message = 'client audit fields are not accepted';
  end if;

  perform private.require_purchase_read_committed();

  -- Existing-row paths lock tuples in a stable parent -> stock-in -> inventory
  -- order before taking logical-key locks. Missing rows are rechecked after the
  -- logical-key locks so concurrent inserts are observed under READ COMMITTED.
  select purchase.*
    into existing_purchase
    from public.purchase_records as purchase
    where purchase.record_key = p_purchase_record_key
    for update;
  purchase_found := found;

  select stock_in.*
    into existing_stock_in
    from public.stock_in_records as stock_in
    where stock_in.record_key = p_stock_in_record_key
    for update;
  stock_in_found := found;

  select inventory.*
    into existing_inventory
    from public.inventory_items as inventory
    where inventory.record_key = p_inventory_record_key
    for update;
  inventory_found := found;

  perform private.lock_purchase_record_key(p_purchase_record_key);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public.stock_in_records:' || p_stock_in_record_key,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'public.inventory_items:' || p_inventory_record_key,
      0
    )
  );

  if not purchase_found then
    select purchase.*
      into existing_purchase
      from public.purchase_records as purchase
      where purchase.record_key = p_purchase_record_key
      for update;
    purchase_found := found;
  end if;
  if not stock_in_found then
    select stock_in.*
      into existing_stock_in
      from public.stock_in_records as stock_in
      where stock_in.record_key = p_stock_in_record_key
      for update;
    stock_in_found := found;
  end if;
  if not inventory_found then
    select inventory.*
      into existing_inventory
      from public.inventory_items as inventory
      where inventory.record_key = p_inventory_record_key
      for update;
    inventory_found := found;
  end if;

  if not purchase_found or existing_purchase.status <> 'active' then
    raise exception using
      errcode = 'P0002',
      message = 'purchase record not found';
  end if;
  if not public.has_current_permission('module.purchases.update') then
    raise exception using
      errcode = '42501',
      message = 'purchase update permission required';
  end if;

  if stock_in_found and existing_stock_in.status <> 'active' then
    raise exception using
      errcode = 'P0002',
      message = 'stock-in record not found';
  end if;
  if stock_in_found and (
    not (existing_stock_in.payload ? 'stockInId')
    or jsonb_typeof(existing_stock_in.payload->'stockInId')
      is distinct from 'string'
    or existing_stock_in.payload->>'stockInId'
      is distinct from p_stock_in_record_key
    or not (existing_stock_in.payload ? 'sourcePurchaseId')
    or jsonb_typeof(existing_stock_in.payload->'sourcePurchaseId')
      is distinct from 'string'
    or existing_stock_in.payload->>'sourcePurchaseId'
      is distinct from p_purchase_record_key
  ) then
    raise exception using
      errcode = '22023',
      message = 'stock-in record binding mismatch';
  end if;

  if inventory_found and existing_inventory.status <> 'active' then
    raise exception using
      errcode = 'P0002',
      message = 'inventory record not found';
  end if;

  if (not stock_in_found or not inventory_found)
    and not public.has_current_permission('module.inventory.create')
  then
    raise exception using
      errcode = '42501',
      message = 'inventory create permission required';
  end if;
  if (stock_in_found or inventory_found)
    and not public.has_current_permission('module.inventory.update')
  then
    raise exception using
      errcode = '42501',
      message = 'inventory update permission required';
  end if;

  select employee.*
    into actor
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501',
      message = 'active employee required';
  end if;

  purchase_result := public.upsert_purchase_record_secure(
    p_purchase_record_key,
    p_purchase_patch,
    'active'
  );

  effective_stock_in_payload := p_stock_in_payload || jsonb_build_object(
    'stockInId', p_stock_in_record_key,
    'sourcePurchaseId', p_purchase_record_key
  );
  if stock_in_found then
    update public.stock_in_records as stock_in
      set payload = existing_stock_in.payload || effective_stock_in_payload,
          updated_by_employee_id = actor.id::text,
          updated_by_employee_name = actor.name
      where stock_in.record_key = p_stock_in_record_key
      returning stock_in.* into saved_stock_in;
  else
    insert into public.stock_in_records (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      p_stock_in_record_key,
      effective_stock_in_payload,
      'active',
      actor.id::text,
      actor.name,
      actor.id::text,
      actor.name
    )
    returning * into saved_stock_in;
  end if;

  effective_inventory_payload := p_inventory_payload || jsonb_build_object(
    'inventoryId', p_inventory_record_key
  );
  if inventory_found then
    update public.inventory_items as inventory
      set payload = existing_inventory.payload || effective_inventory_payload,
          updated_by_employee_id = actor.id::text,
          updated_by_employee_name = actor.name
      where inventory.record_key = p_inventory_record_key
      returning inventory.* into saved_inventory;
  else
    insert into public.inventory_items (
      record_key,
      payload,
      status,
      created_by_employee_id,
      created_by_employee_name,
      updated_by_employee_id,
      updated_by_employee_name
    ) values (
      p_inventory_record_key,
      effective_inventory_payload,
      'active',
      actor.id::text,
      actor.name,
      actor.id::text,
      actor.name
    )
    returning * into saved_inventory;
  end if;

  return jsonb_build_object(
    'purchase', purchase_result,
    'stock_in', jsonb_build_object(
      'record_key', saved_stock_in.record_key,
      'payload', saved_stock_in.payload,
      'status', saved_stock_in.status,
      'updated_at', saved_stock_in.updated_at
    ),
    'inventory_item', jsonb_build_object(
      'record_key', saved_inventory.record_key,
      'payload', saved_inventory.payload,
      'status', saved_inventory.status,
      'updated_at', saved_inventory.updated_at
    )
  );
end;
$$;

-- Close PostgreSQL's default PUBLIC EXECUTE before granting only the intended
-- authenticated browser and trusted server roles.
revoke all on function public.list_purchase_records_secure()
  from public, anon, authenticated, service_role;
revoke all on function public.upsert_purchase_record_secure(text, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.soft_delete_purchase_record_secure(text)
  from public, anon, authenticated, service_role;
revoke all on function public.commit_purchase_stock_in_secure(
  text,
  jsonb,
  text,
  jsonb,
  text,
  jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.list_purchase_records_secure()
  to authenticated, service_role;
grant execute on function public.upsert_purchase_record_secure(text, jsonb, text)
  to authenticated, service_role;
grant execute on function public.soft_delete_purchase_record_secure(text)
  to authenticated, service_role;
grant execute on function public.commit_purchase_stock_in_secure(
  text,
  jsonb,
  text,
  jsonb,
  text,
  jsonb
) to authenticated, service_role;

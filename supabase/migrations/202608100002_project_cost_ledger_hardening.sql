-- Harden project-cost source eligibility and make printable reports atomic.

alter function private.private_project_cost_source_facts()
  rename to private_project_cost_source_facts_unvalidated;

revoke all on function private.private_project_cost_source_facts_unvalidated()
  from public, anon, authenticated, service_role;

create function private.private_project_cost_source_facts()
returns table (
  source_key text,
  source_module text,
  source_document_type text,
  source_document_id text,
  project_id text,
  project_name text,
  category text,
  cost_date date,
  description text,
  original_amount numeric(18,4),
  operator text
)
language sql
stable
security definer
set search_path = ''
as $$
  with eligible_projects as materialized (
    select
      project.record_key project_id,
      coalesce(
        private.project_cost_safe_text(
          project.payload->'projectName', true, 500
        ),
        ''
      ) project_name
    from public.projects project
    where project.status = 'active'
      and pg_catalog.jsonb_typeof(project.payload) = 'object'
      and not private.project_cost_payload_cancelled(project.payload)
  ), legacy_facts as materialized (
    select * from private.private_project_cost_source_facts_unvalidated()
  ), missing_warehouse_facts as (
    select
      'warehouse:' || cost.record_key source_key,
      'warehouse'::text source_module,
      coalesce(
        nullif(cost.payload->>'sourceDocumentType', ''),
        'warehouse_stock_out'
      ) source_document_type,
      coalesce(
        nullif(cost.payload->>'sourceDocumentId', ''),
        cost.record_key
      ) source_document_id,
      cost.payload->>'projectId' project_id,
      coalesce(private.project_cost_safe_text(
        cost.payload->'projectName', true, 500
      ), '') project_name,
      '材料费'::text category,
      private.project_cost_safe_date(cost.payload->'date') cost_date,
      coalesce(private.project_cost_safe_text(
        cost.payload->'remark', true, 2000
      ), '') description,
      private.project_cost_safe_amount(cost.payload->'amount')::numeric(18,4)
        original_amount,
      coalesce(private.project_cost_safe_text(
        cost.payload->'operator', true, 500
      ), '') operator
    from public.project_cost_records cost
    where cost.status = 'active'
      and not private.project_cost_payload_cancelled(cost.payload)
      and cost.record_key ~ '^WAREHOUSE-(SO|MWO|SR|WR):[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and pg_catalog.jsonb_typeof(cost.payload->'costRecordId') = 'string'
      and cost.payload->>'costRecordId' = cost.record_key
      and pg_catalog.jsonb_typeof(cost.payload->'projectId') = 'string'
      and cost.payload->>'projectId' = pg_catalog.btrim(cost.payload->>'projectId')
      and pg_catalog.char_length(cost.payload->>'projectId') between 1 and 500
      and cost.payload->>'projectId' not in (
        '__proto__', 'constructor', 'prototype'
      )
      and not exists (
        select 1 from eligible_projects project
        where project.project_id = cost.payload->>'projectId'
      )
      and cost.payload->>'costType' = '材料费'
      and private.project_cost_safe_date(cost.payload->'date') is not null
      and private.project_cost_safe_amount(cost.payload->'amount') is not null
      and private.project_cost_safe_amount(cost.payload->'amount') <> 0
      and pg_catalog.jsonb_typeof(
        cost.payload->'sourcePurchaseRecordKeys'
      ) = 'array'
      and pg_catalog.jsonb_typeof(cost.payload->'sourceStockOutIds') = 'array'
      and (
        (
          cost.record_key like 'WAREHOUSE-SO:%'
          and cost.payload->>'sourceType' = 'warehouse'
          and cost.payload->>'sourceDocumentType' = 'warehouse_stock_out'
          and private.project_cost_safe_amount(cost.payload->'amount') > 0
          and cost.payload->>'sourceDocumentId'
            = pg_catalog.split_part(cost.record_key, ':', 2)
          and cost.payload->'sourceStockOutIds'
            = pg_catalog.jsonb_build_array(cost.payload->>'sourceDocumentId')
        ) or (
          cost.record_key like 'WAREHOUSE-MWO:%'
          and cost.payload->>'sourceType' = 'warehouse'
          and cost.payload->>'sourceDocumentType'
            = 'warehouse_minor_work_order'
          and private.project_cost_safe_amount(cost.payload->'amount') > 0
          and cost.payload->>'sourceDocumentId'
            = pg_catalog.split_part(cost.record_key, ':', 2)
          and pg_catalog.jsonb_array_length(
            cost.payload->'sourceStockOutIds'
          ) > 0
        ) or (
          cost.record_key like 'WAREHOUSE-SR:%'
          and cost.payload->>'sourceType' = 'warehouseReversal'
          and cost.payload->>'sourceDocumentType' = 'warehouse_return'
          and private.project_cost_safe_amount(cost.payload->'amount') < 0
          and cost.payload->>'sourceDocumentId'
            = pg_catalog.split_part(cost.record_key, ':', 2)
          and pg_catalog.jsonb_array_length(
            cost.payload->'sourceStockOutIds'
          ) = 1
        ) or (
          cost.record_key like 'WAREHOUSE-WR:%'
          and cost.payload->>'sourceType' = 'warehouseReversal'
          and cost.payload->>'sourceDocumentType'
            = 'warehouse_operation_reversal'
          and cost.payload->>'sourceDocumentId'
            = pg_catalog.split_part(cost.record_key, ':', 2)
          and cost.payload->'sourcePurchaseRecordKeys' = '[]'::jsonb
          and pg_catalog.jsonb_array_length(
            cost.payload->'sourceStockOutIds'
          ) between 0 and 1
        )
      )
      and not exists (
        select 1 from legacy_facts fact
        where fact.source_key = 'warehouse:' || cost.record_key
      )
  ), all_facts as (
    select * from legacy_facts
    union all
    select * from missing_warehouse_facts
  )
  select
    fact.source_key,
    fact.source_module,
    fact.source_document_type,
    fact.source_document_id,
    case when project.project_id is null then null else fact.project_id end,
    case when project.project_id is null then '' else fact.project_name end,
    fact.category,
    fact.cost_date,
    fact.description,
    fact.original_amount,
    fact.operator
  from all_facts fact
  left join eligible_projects project on project.project_id = fact.project_id
  where fact.source_module <> 'tool'
    or exists (
      select 1
      from public.tool_responsibility_records responsibility
      where responsibility.record_key = fact.source_document_id
        and responsibility.status not in ('deleted', 'void')
        and not private.project_cost_payload_cancelled(responsibility.payload)
        and responsibility.payload->'allocateToProject' = 'true'::jsonb
    );
$$;

revoke all on function private.private_project_cost_source_facts()
  from public, anon, authenticated, service_role;

create or replace function public.create_project_cost_adjustment_secure(
  p_source_key text,
  p_expected_version bigint,
  p_adjustment_amount numeric,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor public.employee_profiles%rowtype;
  source_state record;
  normalized_source_key text;
  normalized_reason text;
  amount_after numeric;
begin
  if not public.is_current_employee_active() then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;
  if not public.has_current_permission('module.project_costs.update') then
    raise exception using
      errcode = '42501',
      message = 'project cost ledger update permission required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  normalized_source_key := private.project_cost_safe_text(
    pg_catalog.to_jsonb(p_source_key), false, 600
  );
  normalized_reason := private.project_cost_safe_text(
    pg_catalog.to_jsonb(p_reason), false, 2000
  );
  if normalized_source_key is null
    or normalized_reason is null
    or p_expected_version is null
    or p_expected_version < 1
    or p_adjustment_amount is null
    or p_adjustment_amount in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    or p_adjustment_amount = 0
    or pg_catalog.abs(p_adjustment_amount) > 900719925474.0991
    or pg_catalog.round(p_adjustment_amount, 4) <> p_adjustment_amount
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and not employee.must_change_password
    and employee.deleted_at is null;
  if not found then
    raise exception using
      errcode = '42501', message = 'active employee required',
      hint = 'PROJECT_COST_LEDGER_ACCESS_DENIED';
  end if;

  select * into source_state
  from private.project_cost_source_state(normalized_source_key);
  if not found or source_state.project_id is null then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_SOURCE_MISSING',
      hint = 'PROJECT_COST_LEDGER_SOURCE_MISSING';
  end if;
  if source_state.current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;

  if not pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(normalized_source_key, 0)
  ) then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;

  select * into source_state
  from private.project_cost_source_state(normalized_source_key);
  if not found or source_state.project_id is null then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_SOURCE_MISSING',
      hint = 'PROJECT_COST_LEDGER_SOURCE_MISSING';
  end if;
  if source_state.current_version <> p_expected_version then
    raise exception using
      errcode = 'P0001', message = 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
      hint = 'PROJECT_COST_LEDGER_VERSION_CONFLICT';
  end if;
  if exists (
    select 1 from public.project_cost_allocation_events allocation
    where allocation.source_key = normalized_source_key
  ) then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_ALLOCATION_ACTIVE',
      hint = 'PROJECT_COST_LEDGER_ALLOCATION_ACTIVE';
  end if;

  amount_after := source_state.effective_amount + p_adjustment_amount;
  if amount_after in (
      'NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric
    )
    or pg_catalog.abs(amount_after) > 900719925474.0991
    or pg_catalog.round(amount_after, 4) <> amount_after
  then
    raise exception using
      errcode = '22023', message = 'PROJECT_COST_LEDGER_INPUT_INVALID',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  insert into public.project_cost_adjustment_events(
    source_key, sequence_no, amount_before, adjustment_amount, amount_after,
    reason, actor_employee_profile_id, actor_name, created_at
  ) values (
    normalized_source_key, source_state.current_version,
    source_state.effective_amount, p_adjustment_amount::numeric(18,4),
    amount_after::numeric(18,4), normalized_reason, actor.id, actor.name,
    pg_catalog.statement_timestamp()
  );

  return pg_catalog.jsonb_build_object(
    'sourceKey', normalized_source_key,
    'version', source_state.current_version + 1,
    'effectiveAmount', amount_after::numeric(18,4)
  );
end;
$$;

create function public.export_project_cost_report_secure(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  allowed_keys constant text[] := array[
    'projectId', 'dateFrom', 'dateTo', 'category', 'sourceModule',
    'adjusted', 'keyword'
  ]::text[];
  generated_at timestamptz := pg_catalog.statement_timestamp();
  ledger_filters jsonb;
  audit_filters jsonb;
  ledger_page jsonb;
  ledger_snapshot jsonb;
  audit_snapshot jsonb;
  audit_events jsonb;
  all_rows jsonb := '[]'::jsonb;
  total_rows integer;
  total_pages integer;
  page_number integer;
  snapshot_token text;
begin
  if p_filters is null
    or pg_catalog.jsonb_typeof(p_filters) <> 'object'
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_filters) supplied(key)
      where supplied.key <> all(allowed_keys)
    )
  then
    raise exception using
      errcode = '22023', message = 'invalid project cost report filters',
      hint = 'PROJECT_COST_LEDGER_INPUT_INVALID';
  end if;

  ledger_filters := p_filters || '{"page":1,"pageSize":100}'::jsonb;
  ledger_page := public.list_project_cost_ledger_secure(ledger_filters);
  total_rows := (ledger_page->>'totalRows')::integer;
  if total_rows > 5000 then
    raise exception using
      errcode = '54000', message = 'PROJECT_COST_LEDGER_REPORT_TOO_LARGE',
      hint = 'PROJECT_COST_LEDGER_REPORT_TOO_LARGE';
  end if;

  all_rows := coalesce(ledger_page->'rows', '[]'::jsonb);
  total_pages := case
    when total_rows = 0 then 1
    else pg_catalog.ceil(total_rows::numeric / 100)::integer
  end;
  if total_pages > 1 then
    for page_number in 2..total_pages loop
      ledger_page := public.list_project_cost_ledger_secure(
        p_filters || pg_catalog.jsonb_build_object(
          'page', page_number, 'pageSize', 100
        )
      );
      if (ledger_page->>'totalRows')::integer <> total_rows then
        raise exception using
          errcode = '40001', message = 'project cost report snapshot changed';
      end if;
      all_rows := all_rows || coalesce(ledger_page->'rows', '[]'::jsonb);
    end loop;
  end if;
  if pg_catalog.jsonb_array_length(all_rows) <> total_rows then
    raise exception using
      errcode = '40001', message = 'project cost report snapshot incomplete';
  end if;

  ledger_page := public.list_project_cost_ledger_secure(ledger_filters);
  if (ledger_page->>'totalRows')::integer <> total_rows then
    raise exception using
      errcode = '40001', message = 'project cost report snapshot changed';
  end if;
  ledger_snapshot := ledger_page || pg_catalog.jsonb_build_object(
    'generatedAt', generated_at,
    'page', 1,
    'pageSize', 100,
    'rows', all_rows
  );

  audit_filters := p_filters - array[
    'category', 'sourceModule', 'adjusted', 'keyword'
  ]::text[];
  audit_snapshot := public.list_project_cost_audit_secure(audit_filters);
  select coalesce(pg_catalog.jsonb_agg(event.value order by event.ordinality),
    '[]'::jsonb)
  into audit_events
  from pg_catalog.jsonb_array_elements(
    coalesce(audit_snapshot->'events', '[]'::jsonb)
  ) with ordinality event(value, ordinality)
  where exists (
    select 1
    from pg_catalog.jsonb_array_elements(all_rows) row_value(value)
    where row_value.value->>'sourceKey' = event.value->>'sourceKey'
  );
  if pg_catalog.jsonb_array_length(audit_events) > 20000 then
    raise exception using
      errcode = '54000', message = 'PROJECT_COST_LEDGER_REPORT_TOO_LARGE',
      hint = 'PROJECT_COST_LEDGER_REPORT_TOO_LARGE';
  end if;
  audit_snapshot := audit_snapshot || pg_catalog.jsonb_build_object(
    'generatedAt', generated_at,
    'events', audit_events
  );

  snapshot_token := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_object(
        'ledgerSnapshot', ledger_snapshot - 'generatedAt',
        'auditSnapshot', audit_snapshot - 'generatedAt'
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  return pg_catalog.jsonb_build_object(
    'status', 'ready',
    'generatedAt', generated_at,
    'snapshotToken', snapshot_token,
    'ledgerSnapshot', ledger_snapshot,
    'auditSnapshot', audit_snapshot
  );
end;
$$;

revoke all on function public.create_project_cost_adjustment_secure(
  text, bigint, numeric, text
) from public, anon, authenticated, service_role;
grant execute on function public.create_project_cost_adjustment_secure(
  text, bigint, numeric, text
) to authenticated, service_role;

revoke all on function public.export_project_cost_report_secure(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.export_project_cost_report_secure(jsonb)
  to authenticated, service_role;

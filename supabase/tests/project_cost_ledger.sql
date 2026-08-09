begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

select has_table('public'::name, 'project_cost_manual_entries'::name);
select has_table('public'::name, 'project_cost_adjustment_events'::name);
select has_table('public'::name, 'project_cost_allocation_events'::name);
select has_function('private', 'private_project_cost_source_facts', array[]::text[]);
select has_function('public', 'list_project_cost_ledger_secure', array['jsonb']);
select function_privs_are(
  'public', 'list_project_cost_ledger_secure', array['jsonb'],
  'authenticated', array['EXECUTE']
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=""']::text[]
      and has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
    from pg_catalog.pg_proc procedure
    where procedure.oid = to_regprocedure(
      'public.list_project_cost_ledger_secure(jsonb)'
    )
  ),
  'ledger RPC is stable SECURITY DEFINER with an empty path and closed grants'
);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and procedure.proconfig = array['search_path=""']::text[]
      and not has_function_privilege('anon', procedure.oid, 'EXECUTE')
      and not has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and not has_function_privilege('service_role', procedure.oid, 'EXECUTE')
      and not exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
    from pg_catalog.pg_proc procedure
    where procedure.oid = to_regprocedure(
      'private.private_project_cost_source_facts()'
    )
  ),
  'typed source helper is a closed stable SECURITY DEFINER with an empty path'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'project_cost_manual_entries',
        'project_cost_adjustment_events',
        'project_cost_allocation_events'
      )
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  ),
  3::bigint,
  'all ledger-owned tables enable and force RLS'
);

select ok(
  not exists (
    select 1
    from (values
      ('project_cost_manual_entries'),
      ('project_cost_adjustment_events'),
      ('project_cost_allocation_events')
    ) ledger_table(table_name)
    cross join (values
      ('public'), ('anon'), ('authenticated'), ('service_role')
    ) exposed_role(role_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
      ('REFERENCES'), ('TRIGGER')
    ) exposed_privilege(privilege_name)
    where has_table_privilege(
      exposed_role.role_name,
      format('public.%I', ledger_table.table_name),
      exposed_privilege.privilege_name
    )
  ),
  'ledger tables expose no direct client or service-role privileges'
);

insert into auth.users(
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'a9100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'ledger-view@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a9100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'ledger-denied@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a9100000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'ledger-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password
) values
  ('a9200000-0000-4000-8000-000000000001', 'SW-9701', 'a9100000-0000-4000-8000-000000000001', '成本会计', '财务部', '会计', '在职', 'active', false),
  ('a9200000-0000-4000-8000-000000000002', 'SW-9702', 'a9100000-0000-4000-8000-000000000002', '普通员工', '工程部', '小工', '在职', 'active', false),
  ('a9200000-0000-4000-8000-000000000003', 'SW-9703', 'a9100000-0000-4000-8000-000000000003', '停用会计', '设计部', '设计师', '离职', 'disabled', false);

insert into public.permission_grants(
  subject_type, subject_code, permission_key
) values
  ('department', '财务部', 'module.project_costs.view'),
  ('department', '设计部', 'module.project_costs.view')
on conflict do nothing;

insert into public.projects(record_key, payload, status) values
  ('LEDGER-P-A', '{"projectId":"LEDGER-P-A","projectName":"甲项目"}', 'active'),
  ('LEDGER-P-B', '{"projectId":"LEDGER-P-B","projectName":"乙项目"}', 'active');

insert into public.purchase_records(record_key, payload, status) values
  ('LEDGER-PO-DIRECT', '{
    "purchaseId":"LEDGER-PO-DIRECT","purchaseDate":"2026-08-01",
    "itemName":" 直采材料 ","totalCost":100.25,"projectId":"LEDGER-P-A",
    "projectName":" 甲项目 ","purchasePurpose":"工程直用",
    "purchaseStatus":"正常","paymentStatus":"未付款",
    "arrivalStatus":"未到货","invoiceStatus":"未取得","employeeName":"采购员"
  }', 'active'),
  ('LEDGER-PO-WAREHOUSE', '{
    "purchaseId":"LEDGER-PO-WAREHOUSE","purchaseDate":"2026-08-01",
    "itemName":"入库材料","totalCost":200,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchasePurpose":"工程直用","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD', '{
    "purchaseId":"LEDGER-PO-BAD","purchaseDate":"2026-08-01",
    "itemName":"损坏供应数据","totalCost":"not-a-number",
    "projectId":"LEDGER-P-A","projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-CANCELLED', '{
    "purchaseId":"LEDGER-PO-CANCELLED","purchaseDate":"2026-08-01",
    "itemName":"已取消采购","totalCost":999,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"已取消"
  }', 'active'),
  ('LEDGER-PO-DELETED', '{
    "purchaseId":"LEDGER-PO-DELETED","purchaseDate":"2026-08-01",
    "itemName":"已删除采购","totalCost":999,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'deleted');

insert into public.project_cost_records(record_key, payload, status) values
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":200,"date":"2026-08-02","operator":"仓管员",
    "remark":"项目出库","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000001",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-WAREHOUSE"]
  }', 'active'),
  ('WAREHOUSE-WR:a9300000-0000-4000-8000-000000000002', '{
    "costRecordId":"WAREHOUSE-WR:a9300000-0000-4000-8000-000000000002",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":-20,"date":"2026-08-03","operator":"仓管员",
    "remark":"仓库冲销","sourceType":"warehouseReversal",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000002",
    "sourceDocumentType":"warehouse_operation_reversal",
    "sourcePurchaseRecordKeys":[]
  }', 'active'),
  ('LEDGER-LEGACY-MANUAL', '{
    "costRecordId":"LEDGER-LEGACY-MANUAL","projectId":"LEDGER-P-A",
    "projectName":"甲项目","costType":"其他费用","amount":90,
    "date":"2026-08-09","operator":"旧经办人","remark":"旧手工项目成本"
  }', 'active'),
  ('LEDGER-LEGACY-CANCELLED', '{
    "costRecordId":"LEDGER-LEGACY-CANCELLED","projectId":"LEDGER-P-A",
    "projectName":"甲项目","costType":"其他费用","amount":999,
    "date":"2026-08-09","operator":"旧经办人","remark":"已取消",
    "businessStatus":"cancelled"
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000099', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000099",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":123,"date":"2026-08-03","operator":"仓管员",
    "remark":"损坏的仓库来源 JSON","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000099",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":{"bad":true}
  }', 'active');

insert into public.attendance_accounting_settings(
  settings_key, effective_from, updated_by_employee_profile_id
) values ('default', '2026-01-01', 'a9200000-0000-4000-8000-000000000001');

insert into public.attendance_day_resolutions(
  resolution_id, employee_profile_id, work_date, schedule_required,
  resolution_type, attendance_units, accounting_status, salary_type_snapshot,
  base_salary_snapshot, daily_salary_snapshot, hourly_wage_snapshot,
  suggested_project_cost, final_project_cost, resolution_note,
  confirmed_by_employee_profile_id, confirmed_at
) values
  ('a9400000-0000-4000-8000-000000000001', 'a9200000-0000-4000-8000-000000000002', '2026-08-04', true,
   'full_day', 1, 'confirmed', '日薪', 0, 300, 0, 300, 300, '已确认',
   'a9200000-0000-4000-8000-000000000001', statement_timestamp()),
  ('a9400000-0000-4000-8000-000000000002', 'a9200000-0000-4000-8000-000000000002', '2026-08-05', true,
   'full_day', 1, 'draft', '日薪', 0, 999, 0, 999, 999, '草稿不计入', null, null);

insert into public.attendance_project_allocations(
  allocation_id, resolution_id, project_id, project_name_snapshot, amount,
  allocation_note
) values
  ('a9500000-0000-4000-8000-000000000001', 'a9400000-0000-4000-8000-000000000001', 'LEDGER-P-A', '甲项目', 300, '正式分摊'),
  ('a9500000-0000-4000-8000-000000000002', 'a9400000-0000-4000-8000-000000000002', 'LEDGER-P-A', '甲项目', 999, '草稿分摊');

insert into public.fuel_records(record_key, payload, status) values
  ('LEDGER-FUEL', '{
    "fuelRecordId":"LEDGER-FUEL","fuelDate":"2026-08-05","fuelAmount":40,
    "allocateToProject":true,"projectId":"LEDGER-P-A","projectName":"甲项目",
    "vehicleName":"一号车","employeeName":"驾驶员","remark":"项目加油"
  }', 'active');

insert into public.vehicle_expense_records(record_key, payload, status) values
  ('LEDGER-VE', '{
    "vehicleExpenseId":"LEDGER-VE","expenseDate":"2026-08-06","amount":50,
    "expenseType":"高速费","allocateToProject":true,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","employeeName":"驾驶员","remark":"项目高速"
  }', 'active');

insert into public.vehicle_issue_records(record_key, payload, status) values
  ('LEDGER-VI', '{
    "issueId":"LEDGER-VI","issueDate":"2026-08-07","repairCost":60,
    "issueStatus":"未处理","resolvedDate":"","allocateToProject":true,
    "projectId":"LEDGER-P-A","projectName":"甲项目",
    "employeeName":"发现人","issueDescription":"轮胎损坏"
  }', 'active');

insert into public.tool_responsibility_records(record_key, payload, status) values
  ('LEDGER-TOOL', '{
    "responsibilityRecordId":"LEDGER-TOOL","recordDate":"2026-08-08",
    "issueType":"丢失","toolValue":70,"repairCost":12,
    "compensationAmount":70,"compensationStatus":"已赔偿",
    "projectId":"LEDGER-P-A","projectName":"甲项目",
    "toolName":"电钻","handlerEmployeeName":"工具管理员"
  }', 'active');

insert into public.operating_expense_records(record_key, payload, status) values
  ('LEDGER-OE', '{
    "expenseRecordId":"LEDGER-OE","date":"2026-08-08","amount":80,
    "expenseType":"临时办公室","allocateToProject":true,
    "projectId":"LEDGER-P-A","projectName":"甲项目",
    "operator":"行政员","remark":"项目经营费用"
  }', 'active');

insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values (
  'MANUAL-LEDGER-1', 'LEDGER-P-A', '甲项目', '其他费用', '2026-08-10', 100,
  '新账本手工成本', '成本会计',
  'a9200000-0000-4000-8000-000000000001', '成本会计'
);

insert into public.project_cost_adjustment_events(
  source_key, sequence_no, amount_before, adjustment_amount, amount_after,
  reason, actor_employee_profile_id, actor_name
) values (
  'purchase:LEDGER-PO-DIRECT', 1, 100.25, 9.75, 110,
  '补记运费', 'a9200000-0000-4000-8000-000000000001', '成本会计'
);

insert into public.project_cost_allocation_events(
  source_key, sequence_no, amount_snapshot, allocations, reason,
  actor_employee_profile_id, actor_name
) values (
  'purchase:LEDGER-PO-DIRECT', 1, 110,
  '[{"projectId":"LEDGER-P-A","amount":60},{"projectId":"LEDGER-P-B","amount":50}]',
  '跨项目分摊', 'a9200000-0000-4000-8000-000000000001', '成本会计'
);

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;

select isnt_empty($$select 1 from public.list_project_cost_ledger_secure('{}')$$);

create temporary table ledger_snapshot as
select public.list_project_cost_ledger_secure('{}') as payload;

reset role;

select is(
  (select payload->>'status' from ledger_snapshot),
  'ready',
  'view-only accountant reads the unified ledger without source-module grants'
);
select is(
  (select array_agg(key order by key) from ledger_snapshot,
    lateral jsonb_object_keys(payload) key),
  array[
    'adjustmentTotal', 'categoryTotals', 'generatedAt', 'incompleteSources',
    'page', 'pageSize', 'rows', 'status', 'totalAmount', 'totalRows'
  ]::text[],
  'RPC response has the exact normalizeLedgerSnapshot field set'
);
select is(
  (select array_agg(key order by key)
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value,
   lateral jsonb_object_keys(row_value) key
   where row_value->>'sourceKey' = 'manual:MANUAL-LEDGER-1'),
  array[
    'adjusted', 'adjustmentAmount', 'allocations', 'auditEvents', 'category',
    'date', 'description', 'effectiveAmount', 'operator', 'originalAmount',
    'projectId', 'projectName', 'sourceDocumentId', 'sourceDocumentType',
    'sourceKey', 'sourceModule', 'version'
  ]::text[],
  'each row has the exact normalizeLedgerSnapshot row field set'
);
select is((select (payload->>'page')::integer from ledger_snapshot), 1, 'default page is one');
select is((select (payload->>'pageSize')::integer from ledger_snapshot), 20, 'default page size is twenty');
select is((select (payload->>'totalRows')::integer from ledger_snapshot), 12, 'one row is emitted per final project allocation');
select is((select jsonb_array_length(payload->'rows') from ledger_snapshot), 12, 'all fixture rows fit on the first page');
select is((select (payload->>'totalAmount')::numeric from ledger_snapshot), 1080::numeric, 'all source families and the current adjustment sum exactly once');
select is((select (payload->>'adjustmentTotal')::numeric from ledger_snapshot), 9.75::numeric, 'adjustment total reports current delta from source facts');
select is((select payload->'incompleteSources' from ledger_snapshot), '[]'::jsonb, 'complete source union reports no incomplete sources');
select is(
  (select count(*) from ledger_snapshot,
    lateral jsonb_array_elements(payload->'rows') row_value
    where row_value->>'sourceKey' = 'purchase:LEDGER-PO-WAREHOUSE'),
  0::bigint,
  'warehouse-tracked direct purchase is excluded'
);
select is(
  (select count(*) from ledger_snapshot,
    lateral jsonb_array_elements(payload->'rows') row_value
    where row_value->>'sourceKey' like 'purchase:LEDGER-PO-%'),
  2::bigint,
  'only valid direct purchase survives and its two final allocations are emitted'
);
select is(
  (select count(*) from ledger_snapshot,
    lateral jsonb_array_elements(payload->'rows') row_value
    where row_value->>'sourceKey' in (
      'purchase:LEDGER-PO-BAD', 'purchase:LEDGER-PO-CANCELLED',
      'purchase:LEDGER-PO-DELETED', 'legacy-manual:LEDGER-LEGACY-CANCELLED',
      'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000099'
    )),
  0::bigint,
  'malformed, cancelled, and deleted supplier rows never become zero-valued facts'
);
select is(
  (select count(*) from ledger_snapshot,
    lateral jsonb_array_elements(payload->'rows') row_value
    where row_value->>'sourceKey' = 'labor:a9500000-0000-4000-8000-000000000002'),
  0::bigint,
  'draft labor allocation is not a ledger fact'
);
select is(
  (select (row_value->>'effectiveAmount')::numeric
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' = 'vehicle-issue:LEDGER-VI'),
  60::numeric,
  'unresolved vehicle repair is recognized immediately'
);
select is(
  (select (row_value->>'effectiveAmount')::numeric
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' = 'tool-responsibility:LEDGER-TOOL'),
  70::numeric,
  'lost tool records gross tool value without netting compensation'
);
select is(
  (select coalesce(sum((total->>'amount')::numeric), 0)
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'categoryTotals') total
   where total->>'category' = '材料费'),
  290::numeric,
  'material category total respects warehouse anti-double-counting'
);
select ok(
  (select bool_and(
      jsonb_array_length(row_value->'allocations') = 1
      and (row_value->>'effectiveAmount')::numeric
        = ((row_value->'allocations'->0)->>'amount')::numeric
    )
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value),
  'each final allocation row is internally balanced for the strict JS contract'
);
select ok(
  (select bool_and(
      row_value->>'projectName' = btrim(row_value->>'projectName')
      and row_value->>'description' = btrim(row_value->>'description')
      and row_value->>'operator' = btrim(row_value->>'operator')
    )
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value),
  'supplier text is normalized for the strict JS text contract'
);

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000002', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{}')$$,
  '42501', 'project cost ledger view permission required',
  'active employee without project-cost view is rejected'
);
reset role;

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{}')$$,
  '42501', 'active employee required',
  'inactive employee is rejected before permission evaluation'
);
reset role;

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"pageSize":25}')$$,
  '22023', 'invalid project cost ledger filters',
  'page size is restricted to 20, 50, or 100'
);
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"unknown":true}')$$,
  '22023', 'invalid project cost ledger filters',
  'unknown filter keys fail closed'
);
select throws_ok(
  $$select public.list_project_cost_ledger_secure(jsonb_build_object('keyword', repeat('x', 201)))$$,
  '22023', 'invalid project cost ledger filters',
  'keyword length is bounded'
);
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"dateFrom":"2100-01-02"}')$$,
  '22023', 'invalid project cost ledger filters',
  'date filters are bounded'
);
select throws_ok(
  $$insert into public.project_cost_adjustment_events(
      source_key, sequence_no, amount_before, adjustment_amount, amount_after,
      reason, actor_employee_profile_id, actor_name
    ) values (
      'purchase:FORGED', 1, 1, 1, 2, 'forged',
      'a9200000-0000-4000-8000-000000000001', 'forged'
    )$$,
  '42501', 'permission denied for table project_cost_adjustment_events',
  'authenticated users cannot forge adjustment events directly'
);

create temporary table filtered_snapshot as
select public.list_project_cost_ledger_secure('{
  "projectId":"LEDGER-P-B","dateFrom":"2026-08-01","dateTo":"2026-08-10",
  "category":"材料费","sourceModule":"purchase","adjusted":"adjusted",
  "keyword":"直采","page":1,"pageSize":50
}') as payload;
reset role;

select is((select (payload->>'totalRows')::integer from filtered_snapshot), 1, 'all documented filters compose before pagination');
select is((select (payload->>'totalAmount')::numeric from filtered_snapshot), 50::numeric, 'filtered summary is calculated before pagination');
select is((select jsonb_array_length(payload->'rows') from filtered_snapshot), 1, 'filtered page contains only the matching allocation');

select * from finish();
rollback;

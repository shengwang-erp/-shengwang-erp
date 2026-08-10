begin;

\if :{?project_cost_dblink}
\else
\set project_cost_dblink 'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
\endif

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

create function pg_temp.project_cost_error_hint(command text)
returns text
language plpgsql
as $$
declare
  captured_hint text;
begin
  execute command;
  return null;
exception when others then
  get stacked diagnostics captured_hint = pg_exception_hint;
  return captured_hint;
end;
$$;

create function pg_temp.project_cost_try_json(command text)
returns jsonb
language plpgsql
as $$
declare
  result jsonb;
  captured_hint text;
begin
  execute command into result;
  return result;
exception when others then
  get stacked diagnostics captured_hint = pg_exception_hint;
  return pg_catalog.jsonb_build_object(
    'error', sqlerrm,
    'hint', captured_hint
  );
end;
$$;

select has_table('public'::name, 'project_cost_manual_entries'::name);
select has_table('public'::name, 'project_cost_adjustment_events'::name);
select has_table('public'::name, 'project_cost_allocation_events'::name);
select has_function('private', 'private_project_cost_source_facts', array[]::text[]);
select has_function('public', 'list_project_cost_ledger_secure', array['jsonb']);
select has_function(
  'public', 'create_project_cost_adjustment_secure',
  array['text', 'bigint', 'numeric', 'text']
);
select has_function(
  'public', 'replace_project_cost_allocations_secure',
  array['text', 'bigint', 'text', 'jsonb']
);
select has_function(
  'public', 'create_manual_project_cost_secure', array['uuid', 'jsonb']
);
select has_function(
  'public', 'list_project_cost_audit_secure', array['jsonb']
);
select has_function(
  'public', 'export_project_cost_report_secure', array['jsonb']
);
select function_privs_are(
  'public', 'export_project_cost_report_secure', array['jsonb'],
  'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'list_project_cost_ledger_secure', array['jsonb'],
  'authenticated', array['EXECUTE']
);

select ok(
  not exists (
    select 1
    from (values
      ('create_project_cost_adjustment_secure(text,bigint,numeric,text)'::text, 'v'::text),
      ('replace_project_cost_allocations_secure(text,bigint,text,jsonb)', 'v'),
      ('create_manual_project_cost_secure(uuid,jsonb)', 'v'),
      ('list_project_cost_audit_secure(jsonb)', 's'),
      ('export_project_cost_report_secure(jsonb)', 's')
    ) expected(signature, volatility)
    left join lateral (
      select procedure.*
      from pg_catalog.pg_proc procedure
      where procedure.oid = pg_catalog.to_regprocedure(
        'public.' || expected.signature
      )
    ) procedure on true
    where procedure.oid is null
      or not procedure.prosecdef
      or procedure.provolatile::text <> expected.volatility
      or procedure.proconfig <> array['search_path=""']::text[]
      or not pg_catalog.has_function_privilege(
        'authenticated', procedure.oid, 'EXECUTE'
      )
      or not pg_catalog.has_function_privilege(
        'service_role', procedure.oid, 'EXECUTE'
      )
      or pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
      or exists (
        select 1
        from pg_catalog.aclexplode(coalesce(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      )
  ),
  'all mutation and audit RPCs have fixed security-definer boundaries'
);
select alike(
  pg_catalog.pg_get_functiondef(
    'public.create_project_cost_adjustment_secure(text,bigint,numeric,text)'::regprocedure
  ),
  '%pg_try_advisory_xact_lock%',
  'adjustment mutation rejects a busy source lock without blocking'
);
select alike(
  pg_catalog.pg_get_functiondef(
    'public.replace_project_cost_allocations_secure(text,bigint,text,jsonb)'::regprocedure
  ),
  '%pg_try_advisory_xact_lock%',
  'allocation mutation rejects a busy source lock without blocking'
);
select alike(
  pg_catalog.pg_get_functiondef(
    'public.replace_project_cost_allocations_secure(text,bigint,text,jsonb)'::regprocedure
  ),
  '%for share%',
  'allocation mutation locks active target projects after the source lock'
);
select alike(
  pg_catalog.pg_get_functiondef(
    'public.create_manual_project_cost_secure(uuid,jsonb)'::regprocedure
  ),
  '%for share%',
  'new manual entries lock and revalidate their target project'
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
  ('department', '财务部', 'module.project_costs.create'),
  ('department', '财务部', 'module.project_costs.update'),
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
  ('LEDGER-PO-MWO', '{
    "purchaseId":"LEDGER-PO-MWO","purchaseDate":"2026-08-01",
    "itemName":"小工单材料","totalCost":40,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchasePurpose":"工程直用","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-MWO-ZERO', '{
    "purchaseId":"LEDGER-PO-MWO-ZERO","purchaseDate":"2026-08-01",
    "itemName":"全额退回小工单材料","totalCost":60,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchasePurpose":"工程直用","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-MIXED-KEYS', '{
    "purchaseId":"LEDGER-PO-MIXED-KEYS","purchaseDate":"2026-08-01",
    "itemName":"混合键直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-DUP-KEYS', '{
    "purchaseId":"LEDGER-PO-DUP-KEYS","purchaseDate":"2026-08-01",
    "itemName":"重复键直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD-WH-DATE', '{
    "purchaseId":"LEDGER-PO-BAD-WH-DATE","purchaseDate":"2026-08-01",
    "itemName":"坏仓库日期直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD-WH-PROJECT', '{
    "purchaseId":"LEDGER-PO-BAD-WH-PROJECT","purchaseDate":"2026-08-01",
    "itemName":"坏仓库项目直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD-WH-COST-ID', '{
    "purchaseId":"LEDGER-PO-BAD-WH-COST-ID","purchaseDate":"2026-08-01",
    "itemName":"坏成本身份直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD-WH-STOCK-IDS', '{
    "purchaseId":"LEDGER-PO-BAD-WH-STOCK-IDS","purchaseDate":"2026-08-01",
    "itemName":"坏出库身份直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD-WH-DOC-ID', '{
    "purchaseId":"LEDGER-PO-BAD-WH-DOC-ID","purchaseDate":"2026-08-01",
    "itemName":"坏文档身份直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
  }', 'active'),
  ('LEDGER-PO-BAD-WH-TYPE', '{
    "purchaseId":"LEDGER-PO-BAD-WH-TYPE","purchaseDate":"2026-08-01",
    "itemName":"坏文档类型直采","totalCost":1,"projectId":"LEDGER-P-A",
    "projectName":"甲项目","purchaseStatus":"正常"
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
    "sourcePurchaseRecordKeys":["LEDGER-PO-WAREHOUSE"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000001"]
  }', 'active'),
  ('WAREHOUSE-MWO:a9300000-0000-4000-8000-000000000003', '{
    "costRecordId":"WAREHOUSE-MWO:a9300000-0000-4000-8000-000000000003",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":40,"date":"2026-08-02","operator":"仓管员",
    "remark":"小工单领料","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000003",
    "sourceDocumentType":"warehouse_minor_work_order",
    "sourcePurchaseRecordKeys":["LEDGER-PO-MWO"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000013"]
  }', 'active'),
  ('WAREHOUSE-MWO:a9300000-0000-4000-8000-000000000005', '{
    "costRecordId":"WAREHOUSE-MWO:a9300000-0000-4000-8000-000000000005",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":0,"date":"2026-08-02","operator":"仓管员",
    "remark":"小工单领料全额退回","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000005",
    "sourceDocumentType":"warehouse_minor_work_order",
    "sourcePurchaseRecordKeys":["LEDGER-PO-MWO-ZERO"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000015"]
  }', 'active'),
  ('WAREHOUSE-SR:a9300000-0000-4000-8000-000000000004', '{
    "costRecordId":"WAREHOUSE-SR:a9300000-0000-4000-8000-000000000004",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":-30,"date":"2026-08-03","operator":"仓管员",
    "remark":"项目退回","sourceType":"warehouseReversal",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000004",
    "sourceDocumentType":"warehouse_return",
    "sourcePurchaseRecordKeys":["LEDGER-PO-WAREHOUSE"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000001"]
  }', 'active'),
  ('WAREHOUSE-WR:a9300000-0000-4000-8000-000000000002', '{
    "costRecordId":"WAREHOUSE-WR:a9300000-0000-4000-8000-000000000002",
    "projectId":"LEDGER-P-A","projectName":"甲项目","costType":"材料费",
    "amount":-20,"date":"2026-08-03","operator":"仓管员",
    "remark":"仓库冲销","sourceType":"warehouseReversal",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000002",
    "sourceDocumentType":"warehouse_operation_reversal",
    "sourcePurchaseRecordKeys":[],"sourceStockOutIds":[]
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
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000101', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000101",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000101",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-MIXED-KEYS",17],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000101"]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000102', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000102",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000102",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-DUP-KEYS","LEDGER-PO-DUP-KEYS"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000102"]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000103', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000103",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-13-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000103",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-BAD-WH-DATE"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000103"]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000104', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000104",
    "projectId":"   ","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000104",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-BAD-WH-PROJECT"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000104"]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000105', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000999",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000105",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-BAD-WH-COST-ID"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000105"]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000106', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000106",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000106",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-BAD-WH-STOCK-IDS"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000106",17]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000107', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000107",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000777",
    "sourceDocumentType":"warehouse_stock_out",
    "sourcePurchaseRecordKeys":["LEDGER-PO-BAD-WH-DOC-ID"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000107"]
  }', 'active'),
  ('WAREHOUSE-SO:a9300000-0000-4000-8000-000000000108', '{
    "costRecordId":"WAREHOUSE-SO:a9300000-0000-4000-8000-000000000108",
    "projectId":"LEDGER-P-A","projectName":"甲项目","amount":1,
    "date":"2026-08-03","sourceType":"warehouse",
    "sourceDocumentId":"a9300000-0000-4000-8000-000000000108",
    "sourceDocumentType":"warehouse_return",
    "sourcePurchaseRecordKeys":["LEDGER-PO-BAD-WH-TYPE"],
    "sourceStockOutIds":["a9300000-0000-4000-8000-000000000108"]
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
    "allocateToProject":true,
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
  'manual:a9600000-0000-4000-8000-000000000001',
  'LEDGER-P-A', '甲项目', '其他费用', '2026-08-10', 100,
  '新账本手工成本', '成本会计',
  'a9200000-0000-4000-8000-000000000001', '成本会计'
);

select throws_ok(
  $$insert into public.project_cost_manual_entries(
      source_key, project_id, project_name, category, cost_date, original_amount,
      description, operator, created_by_employee_profile_id, created_by_name
    ) values (
      'a9600000-0000-4000-8000-000000000099',
      'LEDGER-P-A', '甲项目', '其他费用', '2026-08-10', 1,
      '无前缀手工成本', '成本会计',
      'a9200000-0000-4000-8000-000000000001', '成本会计'
    )$$,
  '23514',
  'new row for relation "project_cost_manual_entries" violates check constraint "project_cost_manual_entries_source_key_check"',
  'manual source keys must persist the complete manual UUID namespace'
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
select public.list_project_cost_ledger_secure('{"pageSize":50}') as payload;

create temporary table default_ledger_snapshot as
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
   where row_value->>'sourceKey' = 'manual:a9600000-0000-4000-8000-000000000001'),
  array[
    'adjusted', 'adjustmentAmount', 'allocations', 'auditEvents', 'category',
    'date', 'description', 'effectiveAmount', 'operator', 'originalAmount',
    'projectId', 'projectName', 'sourceDocumentId', 'sourceDocumentType',
    'sourceKey', 'sourceModule', 'version'
  ]::text[],
  'each row has the exact normalizeLedgerSnapshot row field set'
);
select is((select (payload->>'page')::integer from ledger_snapshot), 1, 'default page is one');
select is((select (payload->>'pageSize')::integer from default_ledger_snapshot), 20, 'default page size is twenty');
select is((select (payload->>'totalRows')::integer from ledger_snapshot), 22, 'one row is emitted per final project allocation');
select is((select jsonb_array_length(payload->'rows') from ledger_snapshot), 22, 'all fixture rows fit on the requested page');
select is((select (payload->>'totalAmount')::numeric from ledger_snapshot), 1098::numeric, 'all source families and the current adjustment sum exactly once');
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
    where row_value->>'sourceKey' in (
      'purchase:LEDGER-PO-MWO-ZERO',
      'warehouse:WAREHOUSE-MWO:a9300000-0000-4000-8000-000000000005'
    )),
  0::bigint,
  'zero-value MWO de-duplicates its purchase without emitting a zero ledger row'
);
select is(
  (select count(*) from ledger_snapshot,
    lateral jsonb_array_elements(payload->'rows') row_value
    where row_value->>'sourceKey' like 'purchase:LEDGER-PO-%'),
  10::bigint,
  'valid direct purchases survive and the adjusted purchase emits two allocations'
);
select is(
  (select array_agg(row_value->>'sourceKey' order by row_value->>'sourceKey')
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' in (
     'purchase:LEDGER-PO-MIXED-KEYS', 'purchase:LEDGER-PO-DUP-KEYS',
     'purchase:LEDGER-PO-BAD-WH-DATE', 'purchase:LEDGER-PO-BAD-WH-PROJECT',
     'purchase:LEDGER-PO-BAD-WH-COST-ID', 'purchase:LEDGER-PO-BAD-WH-STOCK-IDS',
     'purchase:LEDGER-PO-BAD-WH-DOC-ID', 'purchase:LEDGER-PO-BAD-WH-TYPE'
   )),
  array[
    'purchase:LEDGER-PO-BAD-WH-COST-ID', 'purchase:LEDGER-PO-BAD-WH-DATE',
    'purchase:LEDGER-PO-BAD-WH-DOC-ID', 'purchase:LEDGER-PO-BAD-WH-PROJECT',
    'purchase:LEDGER-PO-BAD-WH-STOCK-IDS', 'purchase:LEDGER-PO-BAD-WH-TYPE',
    'purchase:LEDGER-PO-DUP-KEYS', 'purchase:LEDGER-PO-MIXED-KEYS'
  ]::text[],
  'invalid warehouse candidates cannot suppress otherwise valid direct purchases'
);
select is(
  (select array_agg(row_value->>'sourceDocumentType' order by row_value->>'sourceDocumentType')
   from ledger_snapshot,
   lateral jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' in (
     'warehouse:WAREHOUSE-MWO:a9300000-0000-4000-8000-000000000003',
     'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
     'warehouse:WAREHOUSE-SR:a9300000-0000-4000-8000-000000000004'
   )),
  array['warehouse_minor_work_order', 'warehouse_return', 'warehouse_stock_out']::text[],
  'formal SO, MWO, and SR warehouse costs are included with their exact types'
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
  308::numeric,
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
select is(
  pg_temp.project_cost_error_hint(
    $$select public.list_project_cost_ledger_secure('{}')$$
  ),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'ledger read exposes a safe access-denied hint to an unprivileged employee'
);
select is(
  pg_temp.project_cost_error_hint(
    $$select public.list_project_cost_audit_secure('{}')$$
  ),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'audit read exposes a safe access-denied hint to an unprivileged employee'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_project_cost_adjustment_secure(
    'warehouse:missing', 1, 1.0000, '权限测试'
  )$$),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'adjustment exposes a safe access-denied hint to an unprivileged employee'
);
select is(
  pg_temp.project_cost_error_hint($$select public.replace_project_cost_allocations_secure(
    'warehouse:missing', 1, '权限测试',
    '[{"projectId":"LEDGER-P-A","amount":1.0000}]'
  )$$),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'allocation exposes a safe access-denied hint to an unprivileged employee'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000090', '{}'
  )$$),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'manual creation exposes a safe access-denied hint to an unprivileged employee'
);
reset role;

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000003', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{}')$$,
  '42501', 'active employee required',
  'inactive employee is rejected before permission evaluation'
);
select is(
  pg_temp.project_cost_error_hint(
    $$select public.list_project_cost_ledger_secure('{}')$$
  ),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'ledger read exposes a safe access-denied hint to an inactive employee'
);
select is(
  pg_temp.project_cost_error_hint(
    $$select public.list_project_cost_audit_secure('{}')$$
  ),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'audit read exposes a safe access-denied hint to an inactive employee'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_project_cost_adjustment_secure(
    'warehouse:missing', 1, 1.0000, '权限测试'
  )$$),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'adjustment exposes a safe access-denied hint to an inactive employee'
);
select is(
  pg_temp.project_cost_error_hint($$select public.replace_project_cost_allocations_secure(
    'warehouse:missing', 1, '权限测试',
    '[{"projectId":"LEDGER-P-A","amount":1.0000}]'
  )$$),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'allocation exposes a safe access-denied hint to an inactive employee'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000091', '{}'
  )$$),
  'PROJECT_COST_LEDGER_ACCESS_DENIED',
  'manual creation exposes a safe access-denied hint to an inactive employee'
);
reset role;

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select lives_ok(
  $$select public.list_project_cost_ledger_secure('{"page":1.0,"pageSize":20.0}')$$,
  'mathematically integral JSON numbers are accepted for pagination'
);
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"page":1.5}')$$,
  '22023', 'invalid project cost ledger filters',
  'fractional page numbers fail closed before integer conversion'
);
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"pageSize":20.1}')$$,
  '22023', 'invalid project cost ledger filters',
  'fractional page sizes fail closed before integer conversion'
);
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

insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values
  ('manual:a9600000-0000-4000-8000-000000000010', 'LEDGER-P-A', '甲项目',
   'SAFE-POSITIVE', '2099-01-01', 900719925474.0991, '正边界', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000011', 'LEDGER-P-A', '甲项目',
   'SAFE-NEGATIVE', '2099-01-01', -900719925474.0991, '负边界', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000012', 'LEDGER-P-A', '甲项目',
   'SAFE-CANCEL', '2099-01-01', 900719925474.0991, '抵消正数', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000013', 'LEDGER-P-A', '甲项目',
   'SAFE-CANCEL', '2099-01-01', -900719925474.0991, '抵消负数', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (public.list_project_cost_ledger_secure('{"category":"SAFE-POSITIVE"}')->>'totalAmount')::numeric,
  900719925474.0991::numeric,
  'totalAmount accepts the positive Task 1 safe-unit boundary'
);
select is(
  (public.list_project_cost_ledger_secure('{"category":"SAFE-NEGATIVE"}')->>'totalAmount')::numeric,
  -900719925474.0991::numeric,
  'totalAmount accepts the negative Task 1 safe-unit boundary'
);
select is(
  (public.list_project_cost_ledger_secure('{"category":"SAFE-CANCEL"}')->>'totalAmount')::numeric,
  0::numeric,
  'opposite safe-boundary values cancel before aggregate validation'
);
select is(
  (select (category_total->>'amount')::numeric
   from pg_catalog.jsonb_array_elements(
     public.list_project_cost_ledger_secure('{"category":"SAFE-POSITIVE"}')
       ->'categoryTotals'
   ) category_total),
  900719925474.0991::numeric,
  'category totals accept the Task 1 safe-unit boundary'
);
reset role;

insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values
  ('manual:a9600000-0000-4000-8000-000000000020', 'LEDGER-P-A', '甲项目',
   'TOTAL-OVERFLOW', '2099-01-01', 900719925474.0991, '总额边界', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000021', 'LEDGER-P-A', '甲项目',
   'TOTAL-OVERFLOW', '2099-01-01', 0.0001, '总额越界单位', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"category":"TOTAL-OVERFLOW"}')$$,
  '22003', 'project cost ledger summary exceeds Task 1 safe units',
  'totalAmount overflow by one fixed-point unit fails in a controlled way'
);
reset role;

insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values
  ('manual:a9600000-0000-4000-8000-000000000030', 'LEDGER-P-A', '甲项目',
   'CATEGORY-OVERFLOW', '2099-01-02', 900719925474.0991, '分类边界', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000031', 'LEDGER-P-A', '甲项目',
   'CATEGORY-OVERFLOW', '2099-01-02', 0.0001, '分类越界单位', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000032', 'LEDGER-P-A', '甲项目',
   'CATEGORY-OFFSET', '2099-01-02', -0.0001, '总额抵消单位', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"dateFrom":"2099-01-02","dateTo":"2099-01-02"}')$$,
  '22003', 'project cost ledger summary exceeds Task 1 safe units',
  'a category overflow fails even when the grand total remains safe'
);
reset role;

insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values
  ('manual:a9600000-0000-4000-8000-000000000040', 'LEDGER-P-A', '甲项目',
   'ADJUSTMENT-BOUNDARY', '2099-01-03', -450359962737.0494, '调整边界一', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000041', 'LEDGER-P-A', '甲项目',
   'ADJUSTMENT-BOUNDARY', '2099-01-03', -450359962737.0495, '调整边界二', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
insert into public.project_cost_adjustment_events(
  source_key, sequence_no, amount_before, adjustment_amount, amount_after,
  reason, actor_employee_profile_id, actor_name
) values
  ('manual:a9600000-0000-4000-8000-000000000040', 1,
   -450359962737.0494, 450359962737.0495, 0.0001, '调整边界一',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000041', 1,
   -450359962737.0495, 450359962737.0496, 0.0001, '调整边界二',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (public.list_project_cost_ledger_secure('{"category":"ADJUSTMENT-BOUNDARY"}')->>'adjustmentTotal')::numeric,
  900719925474.0991::numeric,
  'adjustmentTotal accepts the Task 1 safe-unit boundary'
);
reset role;

insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values
  ('manual:a9600000-0000-4000-8000-000000000050', 'LEDGER-P-A', '甲项目',
   'ADJUSTMENT-OVERFLOW', '2099-01-04', -450359962737.0495, '调整越界一', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000051', 'LEDGER-P-A', '甲项目',
   'ADJUSTMENT-OVERFLOW', '2099-01-04', -450359962737.0495, '调整越界二', '成本会计',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
insert into public.project_cost_adjustment_events(
  source_key, sequence_no, amount_before, adjustment_amount, amount_after,
  reason, actor_employee_profile_id, actor_name
) values
  ('manual:a9600000-0000-4000-8000-000000000050', 1,
   -450359962737.0495, 450359962737.0496, 0.0001, '调整越界一',
   'a9200000-0000-4000-8000-000000000001', '成本会计'),
  ('manual:a9600000-0000-4000-8000-000000000051', 1,
   -450359962737.0495, 450359962737.0496, 0.0001, '调整越界二',
   'a9200000-0000-4000-8000-000000000001', '成本会计');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.list_project_cost_ledger_secure('{"category":"ADJUSTMENT-OVERFLOW"}')$$,
  '22003', 'project cost ledger summary exceeds Task 1 safe units',
  'adjustmentTotal overflow by one fixed-point unit fails in a controlled way'
);
reset role;

insert into public.purchase_records(record_key, payload, status) values
  ('LEDGER-PO-TEXT-DESCRIPTION', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-DESCRIPTION', 'purchaseDate', '2099-02-01',
    'itemName', '__proto__', 'totalCost', 11, 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-TEXT-PROJECT', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-PROJECT', 'purchaseDate', '2099-02-01',
    'itemName', '污染项目名', 'totalCost', 12, 'projectId', 'LEDGER-P-A',
    'projectName', 'constructor', 'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-TEXT-OPERATOR', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-OPERATOR', 'purchaseDate', '2099-02-01',
    'itemName', '污染经办人', 'totalCost', 13, 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'employeeName', 'prototype',
    'purchaseStatus', '正常'
  ), 'active'),
  ('constructor', pg_catalog.jsonb_build_object(
    'purchaseId', 'constructor', 'purchaseDate', '2099-02-01',
    'itemName', '污染单据号', 'totalCost', 14, 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'purchaseStatus', '正常'
  ), 'active'),
  ('   ', pg_catalog.jsonb_build_object(
    'purchaseId', '   ', 'purchaseDate', '2099-02-01',
    'itemName', '空白单据号', 'totalCost', 15, 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-TEXT-LONG-DESCRIPTION', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-LONG-DESCRIPTION',
    'purchaseDate', '2099-02-01', 'itemName', pg_catalog.repeat('描', 2001),
    'totalCost', 16, 'projectId', 'LEDGER-P-A', 'projectName', '甲项目',
    'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-TEXT-LONG-PROJECT', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-LONG-PROJECT',
    'purchaseDate', '2099-02-01', 'itemName', '超长项目名',
    'totalCost', 17, 'projectId', 'LEDGER-P-A',
    'projectName', pg_catalog.repeat('项', 501), 'purchaseStatus', '正常'
  ), 'active'),
  (pg_catalog.repeat('R', 601), pg_catalog.jsonb_build_object(
    'purchaseId', pg_catalog.repeat('R', 601), 'purchaseDate', '2099-02-01',
    'itemName', '超长单据号', 'totalCost', 18, 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-TEXT-WRONG-TYPE', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-WRONG-TYPE', 'purchaseDate', '2099-02-01',
    'itemName', 19, 'totalCost', 19, 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-TEXT-OPTIONAL-WHITESPACE', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-TEXT-OPTIONAL-WHITESPACE',
    'purchaseDate', '2099-02-01', 'itemName', '   ', 'totalCost', 2,
    'projectId', 'LEDGER-P-A', 'projectName', '   ', 'employeeName', '   ',
    'purchaseStatus', '正常'
  ), 'active');

insert into public.project_cost_records(record_key, payload, status) values (
  'LEDGER-TEXT-CATEGORY', pg_catalog.jsonb_build_object(
    'costRecordId', 'LEDGER-TEXT-CATEGORY', 'projectId', 'LEDGER-P-A',
    'projectName', '甲项目', 'costType', 'constructor', 'amount', 20,
    'date', '2099-02-01', 'remark', '污染分类', 'operator', '成本会计'
  ), 'active'
);

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table text_contract_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-02-01","dateTo":"2099-02-01","pageSize":100}'
) payload;
reset role;

select is(
  (select (payload->>'totalRows')::integer from text_contract_snapshot),
  7,
  'invalid optional display text never removes an otherwise valid cost fact'
);
select is(
  (select (payload->>'totalAmount')::numeric from text_contract_snapshot),
  90::numeric,
  'invalid optional display text preserves every supplier amount'
);
select is(
  (select array_agg(row_value->>'sourceKey' order by row_value->>'sourceKey')
   from text_contract_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value),
  array[
    'purchase:LEDGER-PO-TEXT-DESCRIPTION',
    'purchase:LEDGER-PO-TEXT-LONG-DESCRIPTION',
    'purchase:LEDGER-PO-TEXT-LONG-PROJECT',
    'purchase:LEDGER-PO-TEXT-OPERATOR',
    'purchase:LEDGER-PO-TEXT-OPTIONAL-WHITESPACE',
    'purchase:LEDGER-PO-TEXT-PROJECT',
    'purchase:LEDGER-PO-TEXT-WRONG-TYPE'
  ]::text[],
  'all facts with only malformed optional text remain visible'
);
select ok(
  (select pg_catalog.count(*) = 7
      and pg_catalog.bool_and(
        (row_value->>'sourceKey' not in (
          'purchase:LEDGER-PO-TEXT-DESCRIPTION',
          'purchase:LEDGER-PO-TEXT-LONG-DESCRIPTION',
          'purchase:LEDGER-PO-TEXT-WRONG-TYPE',
          'purchase:LEDGER-PO-TEXT-OPTIONAL-WHITESPACE'
        ) or row_value->>'description' = '')
        and (row_value->>'sourceKey' not in (
          'purchase:LEDGER-PO-TEXT-LONG-PROJECT',
          'purchase:LEDGER-PO-TEXT-PROJECT',
          'purchase:LEDGER-PO-TEXT-OPTIONAL-WHITESPACE'
        ) or row_value->>'projectName' = '')
        and (row_value->>'sourceKey' not in (
          'purchase:LEDGER-PO-TEXT-OPERATOR',
          'purchase:LEDGER-PO-TEXT-OPTIONAL-WHITESPACE'
        ) or row_value->>'operator' = '')
      )
   from text_contract_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value),
  'invalid optional text safely falls back without changing fact cardinality'
);
select is(
  (select pg_catalog.jsonb_array_length(payload->'incompleteSources')
   from text_contract_snapshot),
  4,
  'every fact with invalid required identity or category is marked incomplete'
);
select ok(
  (select payload->'incompleteSources' @> '[
      "purchase:constructor",
      "purchase:",
      "legacy-manual:LEDGER-TEXT-CATEGORY"
    ]'::jsonb
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(payload->'incompleteSources') item(value)
      where item.value #>> '{}' like 'invalid:purchase:%'
    )
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(payload->'incompleteSources') item(value)
      cross join lateral (
        select item.value #>> '{}' text_value,
          E' \t\n\r\f' || pg_catalog.chr(11)
            || U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
            trim_characters
      ) parsed
      where pg_catalog.jsonb_typeof(item.value) <> 'string'
        or parsed.text_value = ''
        or parsed.text_value <> pg_catalog.btrim(
          parsed.text_value, parsed.trim_characters
        )
        or parsed.text_value in ('__proto__', 'constructor', 'prototype')
    )
   from text_contract_snapshot),
  'incomplete source identities remain safe for the Task 1 normalizer'
);

insert into public.purchase_records(record_key, payload, status) values
  ('LEDGER-PO-ECMA-TRIM', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-ECMA-TRIM', 'purchaseDate', '2099-02-03',
    'itemName', E'\t\r\n' || U&'\00A0\3000' || 'ECMA文本'
      || U&'\3000\00A0' || E'\n\r\t',
    'totalCost', 3, 'projectId', 'LEDGER-P-A',
    'projectName', E'\t' || U&'\00A0\3000' || '甲项目'
      || U&'\3000\00A0' || E'\r\n',
    'employeeName', E'\r\n' || U&'\00A0\3000' || '经办人'
      || U&'\3000\00A0' || E'\t',
    'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-PO-ECMA-EMPTY', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-PO-ECMA-EMPTY', 'purchaseDate', '2099-02-03',
    'itemName', E'\t\r\n' || U&'\00A0\3000', 'totalCost', 4,
    'projectId', 'LEDGER-P-A',
    'projectName', U&'\3000\00A0' || E'\r\n\t',
    'employeeName', E'\t\n' || U&'\00A0\3000',
    'purchaseStatus', '正常'
  ), 'active');

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table ecma_trim_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-02-03","dateTo":"2099-02-03","pageSize":20}'
) payload;
reset role;

select ok(
  (select row_value->>'projectName' = '甲项目'
      and row_value->>'description' = 'ECMA文本'
      and row_value->>'operator' = '经办人'
   from ecma_trim_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' = 'purchase:LEDGER-PO-ECMA-TRIM'),
  'RPC text uses ECMAScript-compatible trim for Task 1 normalizer input'
);
select ok(
  (select row_value->>'projectName' = ''
      and row_value->>'description' = ''
      and row_value->>'operator' = ''
   from ecma_trim_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' = 'purchase:LEDGER-PO-ECMA-EMPTY'),
  'ECMAScript-only whitespace normalizes to Task 1 empty strings'
);

insert into public.project_cost_records(record_key, payload, status) values (
  'LEDGER-LEGACY-CATEGORY-DEFAULT', pg_catalog.jsonb_build_object(
    'costRecordId', 'LEDGER-LEGACY-CATEGORY-DEFAULT',
    'projectId', 'LEDGER-P-A', 'projectName', '甲项目',
    'amount', 5, 'date', '2099-02-04', 'remark', '缺省类别旧成本'
  ), 'active'
);
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select ok(
  (select row_value->>'category' = '其他费用'
      and (row_value->>'effectiveAmount')::numeric = 5
   from (select public.list_project_cost_ledger_secure(
     '{"dateFrom":"2099-02-04","dateTo":"2099-02-04","pageSize":20}'
   ) response) snapshot
   cross join lateral pg_catalog.jsonb_array_elements(
     snapshot.response->'rows'
   ) row_value),
  'missing legacy cost type retains the established other-expense default'
);
reset role;

insert into public.purchase_records(record_key, payload, status) values (
  'LEDGER-ROUND3-PO-PROJECT', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-ROUND3-PO-PROJECT',
    'purchaseDate', '2099-02-05', 'itemName', '项目ID类型错误采购',
    'totalCost', 101, 'projectId', 17, 'projectName', '甲项目',
    'purchaseStatus', '正常'
  ), 'active'
);
insert into public.tool_responsibility_records(record_key, payload, status) values
  ('LEDGER-ROUND3-TOOL-TYPE', pg_catalog.jsonb_build_object(
    'responsibilityRecordId', 'LEDGER-ROUND3-TOOL-TYPE',
    'recordDate', '2099-02-05', 'issueType', 17, 'repairCost', 102,
    'allocateToProject', true, 'projectId', 'LEDGER-P-A', 'projectName', '甲项目'
  ), 'active'),
  ('LEDGER-ROUND3-TOOL-PROJECT', pg_catalog.jsonb_build_object(
    'responsibilityRecordId', 'LEDGER-ROUND3-TOOL-PROJECT',
    'recordDate', '2099-02-05', 'issueType', '损坏', 'repairCost', 103,
    'allocateToProject', true, 'projectId', 17, 'projectName', '甲项目'
  ), 'active');
insert into public.project_cost_records(record_key, payload, status) values
  ('LEDGER-ROUND3-LEGACY-SOURCE', pg_catalog.jsonb_build_object(
    'costRecordId', 'LEDGER-ROUND3-LEGACY-SOURCE',
    'date', '2099-02-05', 'amount', 104, 'costType', '其他费用',
    'sourceType', 17, 'projectId', 'LEDGER-P-A', 'projectName', '甲项目'
  ), 'active'),
  ('LEDGER-ROUND3-LEGACY-PROJECT', pg_catalog.jsonb_build_object(
    'costRecordId', 'LEDGER-ROUND3-LEGACY-PROJECT',
    'date', '2099-02-05', 'amount', 105, 'costType', '其他费用',
    'projectId', 17, 'projectName', '甲项目'
  ), 'active');

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table round3_malformed_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-02-05","dateTo":"2099-02-05","pageSize":20}'
) payload;
reset role;

select ok(
  (select (payload->>'totalRows')::integer = 0
      and (payload->>'totalAmount')::numeric = 0
      and payload->'rows' = '[]'::jsonb
   from round3_malformed_snapshot),
  'malformed required supplier fields never enter rows or summary totals'
);
select ok(
  (select payload->'incompleteSources'
      @> '["purchase:LEDGER-ROUND3-PO-PROJECT"]'::jsonb
   from round3_malformed_snapshot),
  'purchase with malformed projectId is marked incomplete'
);
select ok(
  (select payload->'incompleteSources'
      @> '["tool-responsibility:LEDGER-ROUND3-TOOL-TYPE"]'::jsonb
   from round3_malformed_snapshot),
  'tool cost with wrong-type issueType is marked incomplete'
);
select ok(
  (select payload->'incompleteSources'
      @> '["tool-responsibility:LEDGER-ROUND3-TOOL-PROJECT"]'::jsonb
   from round3_malformed_snapshot),
  'tool cost with malformed projectId is marked incomplete'
);
select ok(
  (select payload->'incompleteSources'
      @> '["legacy-manual:LEDGER-ROUND3-LEGACY-SOURCE"]'::jsonb
   from round3_malformed_snapshot),
  'legacy cost with wrong-type sourceType is marked incomplete'
);
select ok(
  (select payload->'incompleteSources'
      @> '["legacy-manual:LEDGER-ROUND3-LEGACY-PROJECT"]'::jsonb
   from round3_malformed_snapshot),
  'legacy cost with malformed projectId is marked incomplete'
);

insert into public.purchase_records(record_key, payload, status) values
  ('LEDGER-ROUND4-PO-WAREHOUSE', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-ROUND4-PO-WAREHOUSE',
    'purchaseDate', '2099-02-06', 'itemName', '正常仓库备货',
    'totalCost', 201, 'purchasePurpose', '仓库备货', 'projectId', '',
    'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-ROUND4-PO-COMPANY', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-ROUND4-PO-COMPANY',
    'purchaseDate', '2099-02-06', 'itemName', '正常公司自用',
    'totalCost', 202, 'purchasePurpose', '公司自用',
    'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-ROUND4-PO-MALFORMED', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-ROUND4-PO-MALFORMED',
    'purchaseDate', '2099-02-06', 'itemName', '保留字项目采购',
    'totalCost', 203, 'purchasePurpose', '仓库备货',
    'projectId', 'constructor', 'purchaseStatus', '正常'
  ), 'active'),
  ('LEDGER-ROUND4-PO-PROJECT-MISSING', pg_catalog.jsonb_build_object(
    'purchaseId', 'LEDGER-ROUND4-PO-PROJECT-MISSING',
    'purchaseDate', '2099-02-06', 'itemName', '项目使用缺项目',
    'totalCost', 204, 'purchasePurpose', '项目使用',
    'purchaseStatus', '正常'
  ), 'active');

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table round4_purchase_scope_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-02-06","dateTo":"2099-02-06","pageSize":20}'
) payload;
reset role;

select ok(
  (select (payload->>'totalRows')::integer = 0
      and (payload->>'totalAmount')::numeric = 0
      and payload->'rows' = '[]'::jsonb
   from round4_purchase_scope_snapshot),
  'non-project and incomplete purchases never enter rows or summaries'
);
select ok(
  (select payload->'incompleteSources' @> '[
    "purchase:LEDGER-ROUND4-PO-MALFORMED",
    "purchase:LEDGER-ROUND4-PO-PROJECT-MISSING"
  ]'::jsonb
   from round4_purchase_scope_snapshot),
  'only malformed or explicitly project-bound purchases are incomplete'
);
select ok(
  (select not payload->'incompleteSources' ?| array[
      'purchase:LEDGER-ROUND4-PO-WAREHOUSE',
      'purchase:LEDGER-ROUND4-PO-COMPANY'
    ]
   from round4_purchase_scope_snapshot),
  'legitimate non-project purchases remain outside the project ledger response'
);

insert into public.tool_responsibility_records(record_key, payload, status) values
  ('LEDGER-TOOL-COMPANY-MISSING', pg_catalog.jsonb_build_object(
    'responsibilityRecordId', 'LEDGER-TOOL-COMPANY-MISSING',
    'recordDate', '2099-03-01', 'issueType', '损坏', 'repairCost', 41,
    'projectId', 'LEDGER-P-A', 'projectName', '甲项目'
  ), 'active'),
  ('LEDGER-TOOL-COMPANY-FALSE', pg_catalog.jsonb_build_object(
    'responsibilityRecordId', 'LEDGER-TOOL-COMPANY-FALSE',
    'recordDate', '2099-03-01', 'issueType', '损坏', 'repairCost', 42,
    'allocateToProject', false, 'projectId', 'LEDGER-P-A', 'projectName', '甲项目'
  ), 'active');
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table tool_company_scope_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-03-01","dateTo":"2099-03-01","pageSize":20}'
) payload;
reset role;
select ok(
  (select (payload->>'totalRows')::integer = 0
      and payload->'rows' = '[]'::jsonb
      and not payload->'incompleteSources' ?| array[
        'tool-responsibility:LEDGER-TOOL-COMPANY-MISSING',
        'tool-responsibility:LEDGER-TOOL-COMPANY-FALSE'
      ]
   from tool_company_scope_snapshot),
  'tool responsibility costs require allocateToProject exactly true'
);

insert into public.projects(record_key, payload, status) values (
  'LEDGER-P-INELIGIBLE',
  '{"projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目","status":"进行中"}',
  'active'
);
insert into public.purchase_records(record_key, payload, status) values (
  'LEDGER-INACTIVE-PO', '{
    "purchaseId":"LEDGER-INACTIVE-PO","purchaseDate":"2099-03-02",
    "itemName":"失效项目采购","totalCost":11,"projectId":"LEDGER-P-INELIGIBLE",
    "projectName":"失效项目","purchasePurpose":"项目使用","purchaseStatus":"正常"
  }', 'active'
);
insert into public.project_cost_records(record_key, payload, status) values
  ('WAREHOUSE-SO:a9800000-0000-4000-8000-000000000001', '{
    "costRecordId":"WAREHOUSE-SO:a9800000-0000-4000-8000-000000000001",
    "projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目","costType":"材料费",
    "amount":12,"date":"2099-03-02","operator":"仓管","remark":"失效项目出库",
    "sourceType":"warehouse","sourceDocumentId":"a9800000-0000-4000-8000-000000000001",
    "sourceDocumentType":"warehouse_stock_out","sourcePurchaseRecordKeys":[],
    "sourceStockOutIds":["a9800000-0000-4000-8000-000000000001"]
  }', 'active'),
  ('LEDGER-INACTIVE-LEGACY', '{
    "costRecordId":"LEDGER-INACTIVE-LEGACY","projectId":"LEDGER-P-INELIGIBLE",
    "projectName":"失效项目","costType":"其他费用","amount":19,
    "date":"2099-03-02","operator":"旧经办","remark":"失效项目旧成本"
  }', 'active');
insert into public.attendance_day_resolutions(
  resolution_id, employee_profile_id, work_date, schedule_required,
  resolution_type, attendance_units, accounting_status, salary_type_snapshot,
  base_salary_snapshot, daily_salary_snapshot, hourly_wage_snapshot,
  suggested_project_cost, final_project_cost, resolution_note,
  confirmed_by_employee_profile_id, confirmed_at
) values (
  'a9810000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000002', '2099-03-02', true,
  'full_day', 1, 'confirmed', '日薪', 0, 13, 0, 13, 13, '失效项目人工',
  'a9200000-0000-4000-8000-000000000001', statement_timestamp()
);
insert into public.attendance_project_allocations(
  allocation_id, resolution_id, project_id, project_name_snapshot, amount,
  allocation_note
) values (
  'a9820000-0000-4000-8000-000000000001',
  'a9810000-0000-4000-8000-000000000001',
  'LEDGER-P-INELIGIBLE', '失效项目', 13, '失效项目人工'
);
insert into public.fuel_records(record_key, payload, status) values (
  'LEDGER-INACTIVE-FUEL', '{
    "fuelRecordId":"LEDGER-INACTIVE-FUEL","fuelDate":"2099-03-02","fuelAmount":14,
    "allocateToProject":true,"projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目"
  }', 'active'
);
insert into public.vehicle_expense_records(record_key, payload, status) values (
  'LEDGER-INACTIVE-VE', '{
    "vehicleExpenseId":"LEDGER-INACTIVE-VE","expenseDate":"2099-03-02","amount":15,
    "allocateToProject":true,"projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目"
  }', 'active'
);
insert into public.vehicle_issue_records(record_key, payload, status) values (
  'LEDGER-INACTIVE-VI', '{
    "issueId":"LEDGER-INACTIVE-VI","issueDate":"2099-03-02","repairCost":16,
    "allocateToProject":true,"projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目"
  }', 'active'
);
insert into public.tool_responsibility_records(record_key, payload, status) values (
  'LEDGER-INACTIVE-TOOL', '{
    "responsibilityRecordId":"LEDGER-INACTIVE-TOOL","recordDate":"2099-03-02",
    "issueType":"损坏","repairCost":17,"allocateToProject":true,
    "projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目"
  }', 'active'
);
insert into public.operating_expense_records(record_key, payload, status) values (
  'LEDGER-INACTIVE-OE', '{
    "expenseRecordId":"LEDGER-INACTIVE-OE","date":"2099-03-02","amount":18,
    "allocateToProject":true,"projectId":"LEDGER-P-INELIGIBLE","projectName":"失效项目"
  }', 'active'
);
insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values (
  'manual:a9830000-0000-4000-8000-000000000001',
  'LEDGER-P-INELIGIBLE', '失效项目', '其他费用', '2099-03-02', 20,
  '失效项目手工成本', '会计',
  'a9200000-0000-4000-8000-000000000001', '成本会计'
);
set local session_replication_role = replica;
update public.projects set status = 'deleted'
where record_key = 'LEDGER-P-INELIGIBLE';
set local session_replication_role = origin;
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table inactive_project_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-03-02","dateTo":"2099-03-02","pageSize":100}'
) payload;
reset role;
select ok(
  (select (payload->>'totalRows')::integer = 0 and payload->'rows' = '[]'::jsonb
   from inactive_project_snapshot),
  'no source bound to a deleted project enters ledger rows or totals'
);
select ok(
  (select payload->'incompleteSources' @> '[
    "purchase:LEDGER-INACTIVE-PO",
    "warehouse:WAREHOUSE-SO:a9800000-0000-4000-8000-000000000001",
    "labor:a9820000-0000-4000-8000-000000000001",
    "vehicle-fuel:LEDGER-INACTIVE-FUEL",
    "vehicle-expense:LEDGER-INACTIVE-VE",
    "vehicle-issue:LEDGER-INACTIVE-VI",
    "tool-responsibility:LEDGER-INACTIVE-TOOL",
    "operating:LEDGER-INACTIVE-OE",
    "legacy-manual:LEDGER-INACTIVE-LEGACY",
    "manual:a9830000-0000-4000-8000-000000000001"
  ]'::jsonb from inactive_project_snapshot),
  'every source family marks an explicit deleted-project binding incomplete'
);

insert into public.purchase_records(record_key, payload, status) values (
  'LEDGER-MISSING-PO', '{
    "purchaseId":"LEDGER-MISSING-PO","purchaseDate":"2099-03-03",
    "itemName":"不存在项目采购","totalCost":21,"projectId":"LEDGER-P-NEVER",
    "projectName":"不存在项目","purchasePurpose":"项目使用","purchaseStatus":"正常"
  }', 'active'
);
insert into public.project_cost_records(record_key, payload, status) values
  ('WAREHOUSE-SO:a9840000-0000-4000-8000-000000000001', '{
    "costRecordId":"WAREHOUSE-SO:a9840000-0000-4000-8000-000000000001",
    "projectId":"LEDGER-P-NEVER","projectName":"不存在项目","costType":"材料费",
    "amount":22,"date":"2099-03-03","sourceType":"warehouse",
    "sourceDocumentId":"a9840000-0000-4000-8000-000000000001",
    "sourceDocumentType":"warehouse_stock_out","sourcePurchaseRecordKeys":[],
    "sourceStockOutIds":["a9840000-0000-4000-8000-000000000001"]
  }', 'active'),
  ('LEDGER-MISSING-LEGACY', '{
    "costRecordId":"LEDGER-MISSING-LEGACY","projectId":"LEDGER-P-NEVER",
    "projectName":"不存在项目","costType":"其他费用","amount":27,"date":"2099-03-03"
  }', 'active');
insert into public.fuel_records(record_key, payload, status) values (
  'LEDGER-MISSING-FUEL', '{"fuelRecordId":"LEDGER-MISSING-FUEL","fuelDate":"2099-03-03","fuelAmount":23,"allocateToProject":true,"projectId":"LEDGER-P-NEVER"}', 'active'
);
insert into public.vehicle_expense_records(record_key, payload, status) values (
  'LEDGER-MISSING-VE', '{"vehicleExpenseId":"LEDGER-MISSING-VE","expenseDate":"2099-03-03","amount":24,"allocateToProject":true,"projectId":"LEDGER-P-NEVER"}', 'active'
);
insert into public.vehicle_issue_records(record_key, payload, status) values (
  'LEDGER-MISSING-VI', '{"issueId":"LEDGER-MISSING-VI","issueDate":"2099-03-03","repairCost":25,"allocateToProject":true,"projectId":"LEDGER-P-NEVER"}', 'active'
);
insert into public.tool_responsibility_records(record_key, payload, status) values (
  'LEDGER-MISSING-TOOL', '{"responsibilityRecordId":"LEDGER-MISSING-TOOL","recordDate":"2099-03-03","issueType":"损坏","repairCost":26,"allocateToProject":true,"projectId":"LEDGER-P-NEVER"}', 'active'
);
insert into public.operating_expense_records(record_key, payload, status) values (
  'LEDGER-MISSING-OE', '{"expenseRecordId":"LEDGER-MISSING-OE","date":"2099-03-03","amount":28,"allocateToProject":true,"projectId":"LEDGER-P-NEVER"}', 'active'
);
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table missing_project_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2099-03-03","dateTo":"2099-03-03","pageSize":100}'
) payload;
reset role;
select ok(
  (select (payload->>'totalRows')::integer = 0 and payload->'incompleteSources' @> '[
    "purchase:LEDGER-MISSING-PO",
    "warehouse:WAREHOUSE-SO:a9840000-0000-4000-8000-000000000001",
    "vehicle-fuel:LEDGER-MISSING-FUEL",
    "vehicle-expense:LEDGER-MISSING-VE",
    "vehicle-issue:LEDGER-MISSING-VI",
    "tool-responsibility:LEDGER-MISSING-TOOL",
    "operating:LEDGER-MISSING-OE",
    "legacy-manual:LEDGER-MISSING-LEGACY"
  ]'::jsonb from missing_project_snapshot),
  'all JSON source families mark nonexistent explicit project bindings incomplete'
);

insert into public.projects(record_key, payload, status) values (
  'LEDGER-P-TEXT-BAD',
  '{"projectId":"LEDGER-P-TEXT-BAD","projectName":"constructor"}',
  'active'
);
insert into public.project_cost_manual_entries(
  source_key, project_id, project_name, category, cost_date, original_amount,
  description, operator, created_by_employee_profile_id, created_by_name
) values (
  'manual:a9600000-0000-4000-8000-000000000060',
  'LEDGER-P-A', '甲项目', 'ALLOCATION-TEXT', '2099-02-02', 1,
  '分摊项目文本检查', '成本会计',
  'a9200000-0000-4000-8000-000000000001', '成本会计'
);
insert into public.project_cost_allocation_events(
  source_key, sequence_no, amount_snapshot, allocations, reason,
  actor_employee_profile_id, actor_name
) values (
  'manual:a9600000-0000-4000-8000-000000000060', 1, 1,
  '[{"projectId":"LEDGER-P-TEXT-BAD","amount":1}]',
  '分摊到文本异常项目',
  'a9200000-0000-4000-8000-000000000001', '成本会计'
);
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  (select row_value->>'projectName'
   from pg_catalog.jsonb_array_elements(
     public.list_project_cost_ledger_secure(
       '{"category":"ALLOCATION-TEXT","pageSize":20}'
     )->'rows'
   ) row_value),
  '',
  'allocation project-name metadata also honors the Task 1 text contract'
);
reset role;

-- Task 3 mutation contract. These checks intentionally exercise the public
-- SECURITY DEFINER boundary rather than inserting event rows directly.
select dblink_connect(
  'task3_busy_source',
  :'project_cost_dblink'
);
select dblink_exec('task3_busy_source', 'begin');
select is(
  (select acquired
   from dblink(
     'task3_busy_source',
     pg_catalog.format(
       'select pg_catalog.pg_try_advisory_xact_lock(%s)',
       pg_catalog.hashtextextended(
         'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001', 0
       )
     )
   ) as held(acquired boolean)),
  true,
  'a separate database session holds the source transaction lock'
);
select set_config(
  'request.jwt.claim.sub',
  'a9100000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select throws_ok(
  $$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    1, 1.0000, '锁忙重试'
  )$$,
  'P0001', 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
  'a busy source lock fails immediately with the documented version conflict'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    1, 1.0000, '锁忙安全提示'
  )$$),
  'PROJECT_COST_LEDGER_VERSION_CONFLICT',
  'busy adjustment errors publish the documented safe hint'
);
\if :{?skip_allocation_busy}
\else
set local statement_timeout = '500ms';
select throws_ok(
  $$select public.replace_project_cost_allocations_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    1, '锁忙分摊重试',
    '[{"projectId":"LEDGER-P-A","amount":200.0000}]'
  )$$,
  'P0001', 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
  'a busy allocation source lock fails immediately with the same conflict'
);
set local statement_timeout = 0;
\endif
reset role;
\if :{?skip_allocation_busy}
\else
select is(
  (select pg_catalog.count(*)
   from public.project_cost_adjustment_events
   where source_key =
     'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001'),
  0::bigint,
  'a busy source lock leaves no partial adjustment event'
);
select is(
  (select pg_catalog.count(*)
   from public.project_cost_allocation_events
   where source_key =
     'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001'),
  0::bigint,
  'a busy source lock leaves no partial allocation event'
);
\endif
select dblink_exec('task3_busy_source', 'rollback');
select dblink_disconnect('task3_busy_source');

select set_config(
  'request.jwt.claim.sub',
  'a9100000-0000-4000-8000-000000000001', true
);
set local role authenticated;
select lives_ok(
  $$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    1, 50.0000, '发票差额调整'
  )$$,
  'positive accounting adjustment is accepted at the current ledger version'
);
select lives_ok(
  $$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    2, -25.0000, '复核后冲减'
  )$$,
  'negative accounting adjustment is appended without changing the source fact'
);
select throws_ok(
  $$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    2, 1.0000, '过期页面提交'
  )$$,
  'P0001', 'PROJECT_COST_LEDGER_VERSION_CONFLICT',
  'stale adjustment versions fail with the documented conflict and no write'
);
select throws_ok(
  $$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    3, 1.0000, '   '
  )$$,
  '22023', 'PROJECT_COST_LEDGER_INPUT_INVALID',
  'blank adjustment reasons fail closed'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    3, 1.0000, '   '
  )$$),
  'PROJECT_COST_LEDGER_INPUT_INVALID',
  'adjustment input failures publish the documented safe hint'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_project_cost_adjustment_secure(
    'warehouse:missing', 1, 1.0000, '不存在来源'
  )$$),
  'PROJECT_COST_LEDGER_SOURCE_MISSING',
  'missing-source failures publish the documented safe hint'
);
select lives_ok(
  $$select public.replace_project_cost_allocations_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    3, '按工程比例拆分',
    '[
      {"projectId":"LEDGER-P-A","amount":75.0000},
      {"projectId":"LEDGER-P-B","amount":150.0000}
    ]'
  )$$,
  'two-project split accepts percentage-derived fixed four-decimal amounts'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_project_cost_adjustment_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    4, 1.0000, '分摊后错误调整'
  )$$),
  'PROJECT_COST_LEDGER_ALLOCATION_ACTIVE',
  'server rejects a new adjustment after allocation history exists'
);
reset role;
select is(
  (select pg_catalog.count(*) from public.project_cost_adjustment_events
   where source_key = 'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001'),
  2::bigint,
  'allocation-active rejection leaves adjustment history unchanged'
);
set local role authenticated;
select throws_ok(
  $$select public.replace_project_cost_allocations_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    4, '不平衡拆分',
    '[
      {"projectId":"LEDGER-P-A","amount":75.0000},
      {"projectId":"LEDGER-P-B","amount":149.9999}
    ]'
  )$$,
  '22023', 'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED',
  'allocation snapshots must exactly equal the current effective amount'
);
select is(
  pg_temp.project_cost_error_hint($$select public.replace_project_cost_allocations_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    4, '不平衡安全提示',
    '[
      {"projectId":"LEDGER-P-A","amount":75.0000},
      {"projectId":"LEDGER-P-B","amount":149.9999}
    ]'
  )$$),
  'PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED',
  'unbalanced allocation errors publish the documented safe hint'
);
select throws_ok(
  $$select public.replace_project_cost_allocations_secure(
    'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001',
    4, '无效项目拆分',
    '[{"projectId":"LEDGER-P-MISSING","amount":225.0000}]'
  )$$,
  '22023', 'PROJECT_COST_LEDGER_INPUT_INVALID',
  'only active projects can be new allocation targets'
);
select lives_ok(
  $$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000001',
    '{
      "projectId":"LEDGER-P-B","category":"其他费用",
      "date":"2026-08-08","amount":-12.3456,
      "description":"供应商折扣冲回","operator":"成本会计",
      "reason":"补录已确认折扣"
    }'
  )$$,
  'signed negative manual project cost is accepted with all required fields'
);
select lives_ok(
  $$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000001',
    '{
      "projectId":"LEDGER-P-B","category":"其他费用",
      "date":"2026-08-08","amount":-12.3456,
      "description":"供应商折扣冲回","operator":"成本会计",
      "reason":"补录已确认折扣"
    }'
  )$$,
  'an identical manual request id replay is idempotent'
);
select throws_ok(
  $$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000001',
    '{
      "projectId":"LEDGER-P-B","category":"其他费用",
      "date":"2026-08-08","amount":-12.3455,
      "description":"供应商折扣冲回","operator":"成本会计",
      "reason":"补录已确认折扣"
    }'
  )$$,
  '22023', 'PROJECT_COST_LEDGER_REQUEST_CONFLICT',
  'a reused manual request id with different content is rejected'
);
select is(
  pg_temp.project_cost_error_hint($$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000001',
    '{
      "projectId":"LEDGER-P-B","category":"其他费用",
      "date":"2026-08-08","amount":-12.3455,
      "description":"供应商折扣冲回","operator":"成本会计",
      "reason":"补录已确认折扣"
    }'
  )$$),
  'PROJECT_COST_LEDGER_INPUT_INVALID',
  'manual request conflicts map to the documented input-invalid hint'
);
select throws_ok(
  $$select public.create_manual_project_cost_secure(
    'a9700000-0000-4000-8000-000000000002',
    '{
      "projectId":"LEDGER-P-B","category":"其他费用",
      "date":"2026-08-08","amount":1,
      "description":"含多余字段","operator":"成本会计",
      "reason":"输入验证","actorName":"伪造会计"
    }'
  )$$,
  '22023', 'PROJECT_COST_LEDGER_INPUT_INVALID',
  'manual entry rejects unknown fields and client-authored audit identity'
);

create temporary table task3_ledger_snapshot as
select public.list_project_cost_ledger_secure(
  '{"dateFrom":"2026-08-01","dateTo":"2026-08-08","pageSize":100}'
) payload;
create temporary table task3_audit_snapshot as
select public.list_project_cost_audit_secure(
  '{"projectId":"LEDGER-P-B","dateFrom":"2026-08-02","dateTo":"2026-08-02"}'
) payload;
create temporary table task3_audit_spaced_snapshot as
select public.list_project_cost_audit_secure(
  '{"projectId":"  LEDGER-P-B  ","dateFrom":"2026-08-02","dateTo":"2026-08-02"}'
) payload;
create temporary table task3_ledger_project_exact as
select public.list_project_cost_ledger_secure(
  '{"projectId":"LEDGER-P-B","pageSize":100}'
) payload;
create temporary table task3_ledger_project_spaced as
select pg_temp.project_cost_try_json($$select public.list_project_cost_ledger_secure(
  '{"projectId":"  LEDGER-P-B  ","pageSize":100}'
)$$) payload;
select is(
  pg_temp.project_cost_error_hint($$select public.list_project_cost_audit_secure(
    '{"projectId":17}'
  )$$),
  'PROJECT_COST_LEDGER_INPUT_INVALID',
  'audit filter failures publish the documented safe hint'
);
reset role;

select ok(
  (select pg_catalog.sum((row_value->>'originalAmount')::numeric) = 200.0000
      and pg_catalog.sum((row_value->>'adjustmentAmount')::numeric) = 25.0000
      and pg_catalog.sum((row_value->>'effectiveAmount')::numeric) = 225.0000
      and pg_catalog.count(*) = 2
      and pg_catalog.bool_and((row_value->>'version')::bigint = 4)
   from task3_ledger_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value
   where row_value->>'sourceKey' =
     'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001'),
  'source amount stays immutable while the latest adjustment and split are immediate'
);
select is(
  (select pg_catalog.count(*)
   from public.project_cost_adjustment_events
   where source_key =
     'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001'),
  2::bigint,
  'the stale adjustment leaves no partial audit event'
);
select is(
  (select pg_catalog.count(*)
   from public.project_cost_manual_entries
   where source_key = 'manual:a9700000-0000-4000-8000-000000000001'),
  1::bigint,
  'manual request replay creates exactly one immutable source fact'
);
select ok(
  (select entry.original_amount = -12.3456
      and entry.project_name = '乙项目'
      and entry.created_by_name = '成本会计'
      and entry.reason = '补录已确认折扣'
   from public.project_cost_manual_entries entry
   where entry.source_key = 'manual:a9700000-0000-4000-8000-000000000001'),
  'manual creation derives project and actor snapshots while retaining the reason'
);
select ok(
  (select payload->>'status' = 'ready'
      and pg_catalog.jsonb_array_length(payload->'events') = 3
      and not exists (
        select 1
        from pg_catalog.jsonb_array_elements(payload->'events') event_value
        where event_value->>'sourceKey' <>
          'warehouse:WAREHOUSE-SO:a9300000-0000-4000-8000-000000000001'
          or event_value->>'actorName' <> '成本会计'
          or event_value->>'createdAt' is null
          or event_value <> pg_catalog.jsonb_build_object(
            'eventType', event_value->'eventType',
            'sourceKey', event_value->'sourceKey',
            'sequenceNo', event_value->'sequenceNo',
            'amountBefore', event_value->'amountBefore',
            'amountAfter', event_value->'amountAfter',
            'adjustmentAmount', event_value->'adjustmentAmount',
            'allocationsBefore', event_value->'allocationsBefore',
            'allocationsAfter', event_value->'allocationsAfter',
            'reason', event_value->'reason',
            'actorName', event_value->'actorName',
            'createdAt', event_value->'createdAt'
          )
      )
   from task3_audit_snapshot),
  'audit read uses matching project/date filters and exact server-authored fields'
);
select is(
  (select payload->'events' from task3_audit_spaced_snapshot),
  (select payload->'events' from task3_audit_snapshot),
  'audit project filtering normalizes surrounding whitespace like the ledger'
);
select is(
  (select payload->'rows' from task3_ledger_project_spaced),
  (select payload->'rows' from task3_ledger_project_exact),
  'ledger and audit project filters share safe-text whitespace normalization'
);

insert into public.projects(record_key, payload, status) values (
  'LEDGER-P-MANUAL-REPLAY',
  '{"projectId":"LEDGER-P-MANUAL-REPLAY","projectName":"幂等原项目"}',
  'active'
);
select set_config(
  'request.jwt.claim.sub',
  'a9100000-0000-4000-8000-000000000001', true
);
set local role authenticated;
create temporary table task3_manual_replay_before as
select public.create_manual_project_cost_secure(
  'a9700000-0000-4000-8000-000000000003',
  '{
    "projectId":"LEDGER-P-MANUAL-REPLAY","category":"其他费用",
    "date":"2099-12-29","amount":8.0000,
    "description":"幂等项目快照","operator":"成本会计",
    "reason":"首次记账"
  }'
) payload;
reset role;
set local session_replication_role = replica;
update public.projects
set payload = '{
      "projectId":"LEDGER-P-MANUAL-REPLAY",
      "projectName":"已改名且停用"
    }'::jsonb,
    status = 'void'
where record_key = 'LEDGER-P-MANUAL-REPLAY';
set local session_replication_role = origin;
set local role authenticated;
create temporary table task3_manual_replay_after as
select pg_temp.project_cost_try_json($$select public.create_manual_project_cost_secure(
  'a9700000-0000-4000-8000-000000000003',
  '{
    "projectId":"LEDGER-P-MANUAL-REPLAY","category":"其他费用",
    "date":"2099-12-29","amount":8.0000,
    "description":"幂等项目快照","operator":"成本会计",
    "reason":"首次记账"
  }'
)$$) payload;
reset role;
select is(
  (select payload from task3_manual_replay_after),
  (select payload from task3_manual_replay_before),
  'manual replay returns the original snapshot after project rename and deactivation'
);

select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table atomic_report_before as
select public.export_project_cost_report_secure(
  '{"projectId":"LEDGER-P-A","dateFrom":"2026-08-01","dateTo":"2026-08-10"}'
) payload;
reset role;
select ok(
  (select payload->>'status' = 'ready'
      and payload->>'snapshotToken' ~ '^[0-9a-f]{64}$'
      and payload->'ledgerSnapshot'->>'generatedAt' = payload->>'generatedAt'
      and payload->'auditSnapshot'->>'generatedAt' = payload->>'generatedAt'
      and pg_catalog.jsonb_array_length(payload->'ledgerSnapshot'->'rows')
        = (payload->'ledgerSnapshot'->>'totalRows')::integer
   from atomic_report_before),
  'atomic report returns one complete signed ledger and matching audit snapshot'
);
select ok(
  (select not exists (
    select 1
    from pg_catalog.jsonb_array_elements(payload->'auditSnapshot'->'events') event
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(payload->'ledgerSnapshot'->'rows') row_value
      where row_value->>'sourceKey' = event->>'sourceKey'
    )
  ) from atomic_report_before),
  'atomic report audit cannot include filtered-out source details'
);
set local session_replication_role = replica;
update public.purchase_records
set payload = pg_catalog.jsonb_set(payload, '{itemName}', '"同额替换后的材料"')
where record_key = 'LEDGER-PO-DIRECT';
set local session_replication_role = origin;
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
create temporary table atomic_report_after as
select public.export_project_cost_report_secure(
  '{"projectId":"LEDGER-P-A","dateFrom":"2026-08-01","dateTo":"2026-08-10"}'
) payload;
reset role;
select isnt(
  (select payload->>'snapshotToken' from atomic_report_after),
  (select payload->>'snapshotToken' from atomic_report_before),
  'ordered report signature changes for a same-count same-total source revision'
);
select set_config('request.jwt.claim.sub', 'a9100000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok(
  $$select public.export_project_cost_report_secure('{"page":2}')$$,
  '22023', 'invalid project cost report filters',
  'atomic report rejects client-controlled pagination'
);
reset role;
select ok(
  (select pg_catalog.count(*) = 1
      and pg_catalog.min(project_name) = '幂等原项目'
   from public.project_cost_manual_entries
   where source_key = 'manual:a9700000-0000-4000-8000-000000000003'),
  'manual replay remains one immutable row with the original project snapshot'
);

select throws_ok(
  $$update public.project_cost_adjustment_events
      set reason = '篡改' where sequence_no = 1$$,
  '55000', 'project cost ledger facts are append-only',
  'even the table owner cannot update an adjustment event'
);
select throws_ok(
  $$delete from public.project_cost_allocation_events where sequence_no = 3$$,
  '55000', 'project cost ledger facts are append-only',
  'even the table owner cannot delete an allocation event'
);
select throws_ok(
  $$truncate table public.project_cost_manual_entries$$,
  '55000', 'project cost ledger facts are append-only',
  'even the table owner cannot truncate manual source facts'
);

select * from finish();
rollback;

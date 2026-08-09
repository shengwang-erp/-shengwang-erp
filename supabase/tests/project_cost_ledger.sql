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
  ('LEDGER-PO-MWO', '{
    "purchaseId":"LEDGER-PO-MWO","purchaseDate":"2026-08-01",
    "itemName":"小工单材料","totalCost":40,"projectId":"LEDGER-P-A",
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
  1,
  'malformed supplier text is isolated before a ready DTO is returned'
);
select is(
  (select array_agg(row_value->>'sourceKey')
   from text_contract_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value),
  array['purchase:LEDGER-PO-TEXT-OPTIONAL-WHITESPACE']::text[],
  'only the valid optional-whitespace supplier fact remains'
);
select ok(
  (select pg_catalog.count(*) = 1
      and pg_catalog.bool_and(row_value->>'projectName' = ''
        and row_value->>'description' = ''
        and row_value->>'operator' = '')
   from text_contract_snapshot,
   lateral pg_catalog.jsonb_array_elements(payload->'rows') row_value),
  'optional pure-whitespace fields normalize to Task 1 empty strings'
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

select * from finish();
rollback;

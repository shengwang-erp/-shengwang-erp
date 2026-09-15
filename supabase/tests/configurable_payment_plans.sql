begin;
create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select plan(20);

select has_function('public', 'replace_project_payment_plan_secure', array['text', 'jsonb'], 'atomic payment-plan RPC exists');
select function_privs_are('public', 'replace_project_payment_plan_secure', array['text', 'jsonb'], 'authenticated', array['EXECUTE'], 'authenticated can use only the atomic plan RPC');
select ok(to_regprocedure('public.upsert_project_payment_plan_secure(jsonb)') is null or not has_function_privilege('authenticated', 'public.upsert_project_payment_plan_secure(jsonb)', 'EXECUTE'), 'legacy one-row plan writer is closed to browsers');
select table_privs_are('public', 'project_payment_plans', 'authenticated', array['SELECT'], 'browser cannot bypass atomic payment-plan RPC');
select table_privs_are('public', 'project_receipts', 'authenticated', array['SELECT'], 'browser cannot bypass receipt relationship checks');

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'payment-plan-test@invalid.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.employee_profiles (id, employee_number, auth_user_id, name, department, position, employment_status, account_status, must_change_password, is_hidden_system_account)
values ('95000000-0000-4000-8000-000000000002', 'SW-9501', '95000000-0000-4000-8000-000000000001', '收款计划测试会计', '财务部', '会计', '在职', 'active', false, false);
insert into public.permission_grants (subject_type, subject_code, permission_key)
values ('department', '财务部', 'module.projects.view'), ('department', '财务部', 'module.projects.update')
on conflict do nothing;

insert into public.projects (record_key, payload, status)
values ('PAYMENT-PLAN-TEST', jsonb_build_object(
  'projectId', 'PAYMENT-PLAN-TEST', 'projectName', '收款计划测试',
  'contractRevenueSchemaVersion', 1, 'contractRevenueSetupStatus', 'configured',
  'contractConfirmationStatus', 'draft',
  'originalContractTaxExclusiveAmount', 909092,
  'originalContractTaxRate', 10,
  'originalContractTaxAmount', 90909,
  'originalContractTaxInclusiveAmount', 1000001
), 'active'), ('PAYMENT-PLAN-INCOMPLETE', jsonb_build_object(
  'projectId', 'PAYMENT-PLAN-INCOMPLETE', 'projectName', '不完整合同测试',
  'contractRevenueSchemaVersion', 1, 'contractRevenueSetupStatus', 'configured',
  'contractConfirmationStatus', 'confirmed',
  'originalContractTaxExclusiveAmount', 900000,
  'originalContractTaxRate', 10,
  'originalContractTaxAmount', 100000,
  'originalContractTaxInclusiveAmount', 1000000
), 'active'), ('OTHER-PROJECT', jsonb_build_object('projectId','OTHER-PROJECT','projectName','其他项目','contractRevenueSchemaVersion',1,'contractRevenueSetupStatus','configured','contractConfirmationStatus','draft','originalContractTaxExclusiveAmount',1,'originalContractTaxRate',0,'originalContractTaxAmount',0,'originalContractTaxInclusiveAmount',1), 'active'), ('PENDING-WITH-RECEIPT', jsonb_build_object('projectId','PENDING-WITH-RECEIPT','projectName','已有到账但未保存合同','contractRevenueSetupStatus','not_started'), 'active');
select ok(private.project_has_valid_saved_contract((select payload from public.projects where record_key = 'PAYMENT-PLAN-TEST')), 'complete saved draft-status contract is formally usable');

alter table public.project_receipts disable trigger project_receipts_lock_project;
insert into public.project_receipts (record_key, payload, status)
values ('pending-receipt', jsonb_build_object('receiptId','pending-receipt','projectId','PENDING-WITH-RECEIPT','taxInclusiveAmount',1,'statusCode','active'), 'active');
alter table public.project_receipts enable trigger project_receipts_lock_project;

insert into public.project_payment_plans (record_key, payload, status)
values ('plan-other-project', jsonb_build_object('planId','plan-other-project','projectId','OTHER-PROJECT','installmentOrder',1,'name','其他项目一期','allocationWeight',100,'plannedTaxInclusiveAmount',1,'dueDate','2026-10-01','statusCode','active'), 'active');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.update_project_secure('PENDING-WITH-RECEIPT', '{"contractRevenueSchemaVersion":1,"contractRevenueSetupStatus":"configured","contractConfirmationStatus":"draft","originalContractTaxExclusiveAmount":909,"originalContractTaxRate":10,"originalContractTaxAmount":91,"originalContractTaxInclusiveAmount":1000,"needsManualReview":false}'::jsonb)$$,
  '23514',
  'original contract with revenue activity cannot be changed directly',
  'first contract save is rejected when downstream revenue activity already exists'
);

select throws_ok(
  $$select public.replace_project_payment_plan_secure('PAYMENT-PLAN-INCOMPLETE', '[{"planId":"bad-contract","projectId":"PAYMENT-PLAN-INCOMPLETE","installmentOrder":1,"name":"一期","allocationWeight":100,"plannedTaxInclusiveAmount":1000000,"dueDate":"2026-10-01"}]'::jsonb)$$,
  '22023',
  'complete saved original contract required',
  'inconsistent persisted contract cannot establish a payment plan'
);

select throws_ok(
  $$select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', '[{"planId":"plan-other-project","projectId":"PAYMENT-PLAN-TEST","installmentOrder":1,"name":"一期","allocationWeight":100,"plannedTaxInclusiveAmount":1000001,"dueDate":"2026-10-01"}]'::jsonb)$$,
  '23514', 'payment plan belongs to another project',
  'a payment plan id cannot be moved from another project'
);

create temporary table saved_result(payload jsonb) on commit drop;
grant select, insert on saved_result to authenticated;
insert into saved_result select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', jsonb_build_array(
  jsonb_build_object('planId','plan-1','projectId','PAYMENT-PLAN-TEST','installmentOrder',1,'name','订金','allocationWeight',25,'plannedTaxInclusiveAmount',250000,'dueDate','2026-10-01','remark',''),
  jsonb_build_object('planId','plan-2','projectId','PAYMENT-PLAN-TEST','installmentOrder',2,'name','进场款','allocationWeight',25,'plannedTaxInclusiveAmount',250000,'dueDate','2026-11-01','remark',''),
  jsonb_build_object('planId','plan-3','projectId','PAYMENT-PLAN-TEST','installmentOrder',3,'name','材料款','allocationWeight',25,'plannedTaxInclusiveAmount',250000,'dueDate','2026-12-01','remark',''),
  jsonb_build_object('planId','plan-4','projectId','PAYMENT-PLAN-TEST','installmentOrder',4,'name','验收款','allocationWeight',25,'plannedTaxInclusiveAmount',250001,'dueDate','2027-01-01','remark','')
));
select is(jsonb_array_length(payload), 4, 'four installments save atomically') from saved_result;
select is((payload->3->>'plannedTaxInclusiveAmount')::bigint, 250001::bigint, 'final installment carries integer-yen remainder') from saved_result;

select throws_ok(
  $$select public.update_project_secure('PAYMENT-PLAN-TEST', '{"originalContractTaxExclusiveAmount":181818,"originalContractTaxRate":10,"originalContractTaxAmount":18182,"originalContractTaxInclusiveAmount":200000}'::jsonb)$$,
  '23514', 'original contract with revenue activity cannot be changed directly',
  'saved original contract cannot be changed directly after a payment plan exists'
);

select public.upsert_project_receipt_secure(jsonb_build_object('receiptId','receipt-locked','projectId','PAYMENT-PLAN-TEST','planId','plan-2','stage','installment','taxInclusiveAmount',100000,'statusCode','active'));

select throws_ok(
  $$select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', jsonb_build_array(
    jsonb_build_object('planId','plan-1','projectId','PAYMENT-PLAN-TEST','installmentOrder',1,'name','订金','allocationWeight',30,'plannedTaxInclusiveAmount',300000,'dueDate','2026-10-01','remark',''),
    jsonb_build_object('planId','plan-2','projectId','PAYMENT-PLAN-TEST','installmentOrder',2,'name','进场款','allocationWeight',20,'plannedTaxInclusiveAmount',200000,'dueDate','2026-11-01','remark',''),
    jsonb_build_object('planId','plan-3','projectId','PAYMENT-PLAN-TEST','installmentOrder',3,'name','材料款','allocationWeight',25,'plannedTaxInclusiveAmount',250000,'dueDate','2026-12-01','remark',''),
    jsonb_build_object('planId','plan-4','projectId','PAYMENT-PLAN-TEST','installmentOrder',4,'name','验收款','allocationWeight',25,'plannedTaxInclusiveAmount',250001,'dueDate','2027-01-01','remark','')
  ))$$,
  '23514', 'received payment plan amount and allocation weight are locked',
  'received installment ratio and amount cannot change'
);

select throws_ok(
  $$select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', jsonb_build_array(
    jsonb_build_object('planId','plan-1','projectId','PAYMENT-PLAN-TEST','installmentOrder',1,'name','订金','allocationWeight',30,'plannedTaxInclusiveAmount',300000,'dueDate','2026-10-01','remark',''),
    jsonb_build_object('planId','plan-3','projectId','PAYMENT-PLAN-TEST','installmentOrder',2,'name','材料款','allocationWeight',35,'plannedTaxInclusiveAmount',350000,'dueDate','2026-12-01','remark',''),
    jsonb_build_object('planId','plan-4','projectId','PAYMENT-PLAN-TEST','installmentOrder',3,'name','验收款','allocationWeight',35,'plannedTaxInclusiveAmount',350001,'dueDate','2027-01-01','remark','')
  ))$$,
  '23503', 'received payment plan cannot be deleted',
  'received installment cannot be deleted'
);

delete from saved_result;
insert into saved_result select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', jsonb_build_array(
  jsonb_build_object('planId','plan-1','projectId','PAYMENT-PLAN-TEST','installmentOrder',1,'name','订金','allocationWeight',15,'plannedTaxInclusiveAmount',150000,'dueDate','2026-10-01','remark',''),
  jsonb_build_object('planId','plan-2','projectId','PAYMENT-PLAN-TEST','installmentOrder',2,'name','进场款','allocationWeight',25,'plannedTaxInclusiveAmount',250000,'dueDate','2026-11-01','remark',''),
  jsonb_build_object('planId','plan-3','projectId','PAYMENT-PLAN-TEST','installmentOrder',3,'name','材料一','allocationWeight',15,'plannedTaxInclusiveAmount',150000,'dueDate','2026-12-01','remark',''),
  jsonb_build_object('planId','plan-4','projectId','PAYMENT-PLAN-TEST','installmentOrder',4,'name','材料二','allocationWeight',15,'plannedTaxInclusiveAmount',150000,'dueDate','2027-01-01','remark',''),
  jsonb_build_object('planId','plan-5','projectId','PAYMENT-PLAN-TEST','installmentOrder',5,'name','验收','allocationWeight',15,'plannedTaxInclusiveAmount',150000,'dueDate','2027-02-01','remark',''),
  jsonb_build_object('planId','plan-6','projectId','PAYMENT-PLAN-TEST','installmentOrder',6,'name','尾款','allocationWeight',15,'plannedTaxInclusiveAmount',150001,'dueDate','2027-03-01','remark','')
));
select is(jsonb_array_length(payload), 6, 'six installments save atomically') from saved_result;
select is(payload->1->>'planId', 'plan-2', 'received planId remains stable') from saved_result;
select is(payload->1->>'plannedTaxInclusiveAmount', '250000', 'received amount remains unchanged') from saved_result;
select is((select payload->>'planId' from public.project_receipts where record_key='receipt-locked'), 'plan-2', 'receipt association remains unchanged');

select throws_ok(
  $$select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', '[{"planId":"bad","projectId":"PAYMENT-PLAN-TEST","installmentOrder":1,"name":"错误","allocationWeight":99,"plannedTaxInclusiveAmount":1000001,"dueDate":"2026-10-01"}]'::jsonb)$$,
  '22023', 'payment plan allocation weights must total 100 percent', 'invalid ratio total is rejected'
);
select throws_ok(
  $$select public.replace_project_payment_plan_secure('PAYMENT-PLAN-TEST', '[{"planId":"bad","projectId":"PAYMENT-PLAN-TEST","installmentOrder":1,"name":"错误","allocationWeight":100,"plannedTaxInclusiveAmount":1000000,"dueDate":"2026-10-01"}]'::jsonb)$$,
  '22023', 'payment plan amounts must equal adjusted contract amount', 'invalid amount total is rejected'
);

reset role;
select * from finish();
rollback;

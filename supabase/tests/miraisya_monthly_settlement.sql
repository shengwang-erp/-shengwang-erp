begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

select has_table('public'::name, 'miraisya_monthly_settlements'::name);
select has_table('public'::name, 'miraisya_monthly_settlement_projects'::name);
select has_table('public'::name, 'miraisya_monthly_settlement_items'::name);

select has_function(
  'public', 'list_miraisya_settlement_candidates_secure', array['text']
);
select has_function('public', 'list_miraisya_settlements_secure', array['text']);
select has_function('public', 'get_miraisya_settlement_secure', array['uuid']);
select has_function(
  'public', 'create_miraisya_settlement_draft_secure', array['text', 'date', 'text[]']
);
select has_function(
  'public', 'confirm_miraisya_settlement_secure', array['uuid', 'bigint']
);
select has_function(
  'public', 'void_miraisya_settlement_secure', array['uuid', 'bigint', 'text']
);

select function_privs_are(
  'public', 'create_miraisya_settlement_draft_secure',
  array['text', 'date', 'text[]'], 'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'confirm_miraisya_settlement_secure',
  array['uuid', 'bigint'], 'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'void_miraisya_settlement_secure',
  array['uuid', 'bigint', 'text'], 'authenticated', array['EXECUTE']
);

select table_privs_are(
  'public', 'miraisya_monthly_settlements', 'authenticated', array[]::text[]
);
select table_privs_are(
  'public', 'miraisya_monthly_settlement_projects', 'authenticated', array[]::text[]
);
select table_privs_are(
  'public', 'miraisya_monthly_settlement_items', 'authenticated', array[]::text[]
);
select col_is_fk('public', 'miraisya_monthly_settlement_projects', 'settlement_id');
select col_is_fk('public', 'miraisya_monthly_settlement_projects', 'project_id');
select col_is_fk('public', 'miraisya_monthly_settlement_items', 'settlement_id');
select col_type_is(
  'public', 'miraisya_monthly_settlement_items', 'quantity', 'numeric(14,4)'
);

select * from finish();
rollback;

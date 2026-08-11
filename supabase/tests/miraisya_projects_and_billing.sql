begin;

create extension if not exists pgtap with schema extensions;
set local search_path = pg_temp, public, auth, extensions;
select no_plan();

select has_table('public'::name, 'miraisya_billing_headers'::name);
select has_table('public'::name, 'miraisya_billing_items'::name);
select has_function('public', 'get_miraisya_billing_secure', array['text']);
select has_function(
  'public', 'replace_miraisya_billing_secure',
  array['text', 'bigint', 'jsonb']
);
select function_privs_are(
  'public', 'get_miraisya_billing_secure', array['text'],
  'authenticated', array['EXECUTE']
);
select function_privs_are(
  'public', 'replace_miraisya_billing_secure', array['text', 'bigint', 'jsonb'],
  'authenticated', array['EXECUTE']
);
select table_privs_are(
  'public', 'miraisya_billing_headers', 'authenticated', array[]::text[]
);
select table_privs_are(
  'public', 'miraisya_billing_items', 'authenticated', array[]::text[]
);
select col_is_fk('public', 'miraisya_billing_headers', 'project_id');
select col_is_fk('public', 'miraisya_billing_items', 'project_id');
select col_type_is('public', 'miraisya_billing_items', 'quantity', 'numeric(14,4)');

select * from finish();
rollback;

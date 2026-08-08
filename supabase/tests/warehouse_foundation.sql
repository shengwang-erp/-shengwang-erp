begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, extensions;

select plan(138);

select has_table('public', 'warehouse_sites', 'warehouse sites table exists');
select has_table('public', 'warehouse_locations', 'warehouse locations table exists');
select has_table('public', 'warehouse_items', 'warehouse items table exists');
select has_table('public', 'warehouse_variants', 'warehouse variants table exists');
select has_table('public', 'warehouse_batches', 'warehouse batches table exists');
select has_table('public', 'warehouse_batch_locations', 'warehouse balances table exists');
select has_table('public', 'warehouse_inventory_movements', 'warehouse movement ledger exists');

create temporary table task4_expected_constraints (
  table_name text not null,
  constraint_name text not null,
  constraint_type "char" not null,
  primary key (table_name, constraint_name)
) on commit drop;

insert into task4_expected_constraints(table_name, constraint_name, constraint_type) values
  ('warehouse_sites', 'warehouse_sites_code_check', 'c'),
  ('warehouse_sites', 'warehouse_sites_name_check', 'c'),
  ('warehouse_sites', 'warehouse_sites_kind_check', 'c'),
  ('warehouse_sites', 'warehouse_sites_code_unique', 'u'),
  ('warehouse_locations', 'warehouse_locations_shelf_code_check', 'c'),
  ('warehouse_locations', 'warehouse_locations_shelf_name_check', 'c'),
  ('warehouse_locations', 'warehouse_locations_warehouse_shelf_unique', 'u'),
  ('warehouse_locations', 'warehouse_locations_id_warehouse_unique', 'u'),
  ('warehouse_locations', 'warehouse_locations_warehouse_fk', 'f'),
  ('warehouse_items', 'warehouse_items_name_check', 'c'),
  ('warehouse_items', 'warehouse_items_category_check', 'c'),
  ('warehouse_items', 'warehouse_items_brand_check', 'c'),
  ('warehouse_items', 'warehouse_items_description_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_sku_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_model_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_size_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_material_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_unit_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_minimum_stock_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_default_price_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_system_qr_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_manufacturer_qr_check', 'c'),
  ('warehouse_variants', 'warehouse_variants_sku_unique', 'u'),
  ('warehouse_variants', 'warehouse_variants_system_qr_unique', 'u'),
  ('warehouse_variants', 'warehouse_variants_item_fk', 'f'),
  ('warehouse_batches', 'warehouse_batches_unit_cost_check', 'c'),
  ('warehouse_batches', 'warehouse_batches_original_quantity_check', 'c'),
  ('warehouse_batches', 'warehouse_batches_id_variant_unique', 'u'),
  ('warehouse_batches', 'warehouse_batches_variant_fk', 'f'),
  ('warehouse_batch_locations', 'warehouse_batch_locations_quantity_check', 'c'),
  ('warehouse_batch_locations', 'warehouse_batch_locations_batch_fk', 'f'),
  ('warehouse_batch_locations', 'warehouse_batch_locations_location_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_type_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_quantity_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_unit_cost_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_source_type_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_source_id_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_idempotency_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_destination_type_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_destination_id_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_destination_name_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_metadata_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_reversal_self_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_reversal_shape_check', 'c'),
  ('warehouse_inventory_movements', 'warehouse_movements_variant_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_warehouse_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_batch_variant_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_location_warehouse_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_project_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_operator_fk', 'f'),
  ('warehouse_inventory_movements', 'warehouse_movements_reversal_fk', 'f');

select is(
  (select array_agg(
      constraint_row.table_name || ':' || constraint_row.constraint_name || ':' || constraint_row.constraint_type
      order by constraint_row.table_name collate "C", constraint_row.constraint_name collate "C"
    )
   from (
     select relation.relname::text as table_name,
            constraint_record.conname::text as constraint_name,
            constraint_record.contype::text as constraint_type
     from pg_catalog.pg_constraint as constraint_record
     join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
     join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relname like 'warehouse_%'
       and constraint_record.contype in ('c', 'u', 'f')
   ) as constraint_row),
  (select array_agg(
      expected.table_name || ':' || expected.constraint_name || ':' || expected.constraint_type::text
      order by expected.table_name collate "C", expected.constraint_name collate "C"
    )
   from task4_expected_constraints as expected),
  'the complete named warehouse check, unique, and foreign-key inventory is exact'
);
select is(
  (select array_agg(indexname::text order by indexname)
   from pg_catalog.pg_indexes
   where schemaname = 'public'
     and indexname in (
       'warehouse_variants_manufacturer_qr_ci_unique',
       'warehouse_movements_idempotency_unique',
       'warehouse_movements_reversal_unique'
     )),
  array[
    'warehouse_movements_idempotency_unique',
    'warehouse_movements_reversal_unique',
    'warehouse_variants_manufacturer_qr_ci_unique'
  ]::text[],
  'the three expression or partial unique indexes are present by name'
);

select is((select count(*) from public.warehouse_sites), 0::bigint, 'sites start empty');
select is((select count(*) from public.warehouse_locations), 0::bigint, 'locations start empty');
select is((select count(*) from public.warehouse_items), 0::bigint, 'items start empty');
select is((select count(*) from public.warehouse_variants), 0::bigint, 'variants start empty');
select is((select count(*) from public.warehouse_batches), 0::bigint, 'batches start empty');
select is((select count(*) from public.warehouse_batch_locations), 0::bigint, 'balances start empty');
select is((select count(*) from public.warehouse_inventory_movements), 0::bigint, 'movements start empty');

select col_type_is('public', 'warehouse_batch_locations', 'quantity', 'numeric(18,3)', 'balance quantity has exact precision');
select col_type_is('public', 'warehouse_batches', 'original_quantity', 'numeric(18,3)', 'batch quantity has exact precision');
select col_type_is('public', 'warehouse_batches', 'unit_cost', 'numeric(18,4)', 'batch cost has exact precision');
select col_type_is('public', 'warehouse_inventory_movements', 'quantity_delta', 'numeric(18,3)', 'movement quantity has exact precision');
select col_type_is('public', 'warehouse_inventory_movements', 'unit_cost', 'numeric(18,4)', 'movement cost has exact precision');

select lives_ok(
  $$insert into public.warehouse_sites(id, code, name, kind) values
    ('90000000-0000-4000-8000-000000000001', 'MAIN', '本社仓', 'normal'),
    ('90000000-0000-4000-8000-000000000002', 'SITE-1', '项目现场仓', 'project_site'),
    ('90000000-0000-4000-8000-000000000003', 'TOOLS', '共享工具仓', 'shared_tool')$$,
  'all three warehouse kinds are accepted'
);
select throws_ok(
  $$insert into public.warehouse_sites(code, name, kind) values ('BAD', '坏仓', 'other')$$,
  '23514', null, 'unknown warehouse kind is rejected'
);
select throws_ok(
  $$insert into public.warehouse_sites(code, name, kind) values (' MAIN ', '重名仓', 'normal')$$,
  '23514', null, 'padded site codes are rejected'
);
select throws_ok(
  $$insert into public.warehouse_sites(code, name, kind) values ('MAIN', '重名仓', 'normal')$$,
  '23505', null, 'site codes are unique'
);
select throws_ok(
  $$insert into public.warehouse_sites(code, name, kind) values ('PADDED', ' 坏仓名', 'normal')$$,
  '23514', null, 'padded site names are rejected'
);
select throws_ok(
  $$insert into public.warehouse_sites(code, name, kind) values (E'\tTAB-CODE', '制表符仓', 'normal')$$,
  '23514', null, 'site codes reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_sites(code, name, kind) values ('NEWLINE-NAME', E'换行仓\n', 'normal')$$,
  '23514', null, 'site names reject POSIX whitespace at the edge'
);

select lives_ok(
  $$insert into public.warehouse_locations(id, warehouse_id, shelf_code, shelf_name) values
    ('91000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'A-01', 'A区一号架'),
    ('91000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'SITE', '现场存放区')$$,
  'trimmed locations are accepted'
);
select throws_ok(
  $$insert into public.warehouse_locations(warehouse_id, shelf_code, shelf_name) values
    ('90000000-0000-4000-8000-000000000001', ' A-02', '坏货架')$$,
  '23514', null, 'padded shelf codes are rejected'
);
select throws_ok(
  $$insert into public.warehouse_locations(warehouse_id, shelf_code, shelf_name) values
    ('90000000-0000-4000-8000-000000000001', 'A-01', '重复货架')$$,
  '23505', null, 'shelf codes are unique inside a warehouse'
);
select throws_ok(
  $$insert into public.warehouse_locations(warehouse_id, shelf_code, shelf_name) values
    ('99999999-0000-4000-8000-000000000001', 'X', '不存在仓库')$$,
  '23503', null, 'locations require an existing warehouse'
);
select throws_ok(
  $$insert into public.warehouse_locations(warehouse_id, shelf_code, shelf_name) values
    ('90000000-0000-4000-8000-000000000001', 'A-03', ' ')$$,
  '23514', null, 'blank shelf names are rejected'
);
select throws_ok(
  $$insert into public.warehouse_locations(warehouse_id, shelf_code, shelf_name) values
    ('90000000-0000-4000-8000-000000000001', E'\tA-04', '制表符货架')$$,
  '23514', null, 'shelf codes reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_locations(warehouse_id, shelf_code, shelf_name) values
    ('90000000-0000-4000-8000-000000000001', 'A-05', E'换行货架\n')$$,
  '23514', null, 'shelf names reject POSIX whitespace at the edge'
);

select lives_ok(
  $$insert into public.warehouse_items(id, name, category, brand, description) values
    ('92000000-0000-4000-8000-000000000001', '冷媒管', '空调材料', '厂家甲', '铜管')$$,
  'trimmed item records are accepted'
);
select throws_ok(
  $$insert into public.warehouse_items(name) values (' ')$$,
  '23514', null, 'blank item names are rejected'
);
select throws_ok(
  $$insert into public.warehouse_items(name, brand) values ('测试', ' 厂家')$$,
  '23514', null, 'padded optional item text is rejected'
);
select throws_ok(
  $$insert into public.warehouse_items(name) values (E'\t')$$,
  '23514', null, 'item names reject POSIX-whitespace-only values'
);
select throws_ok(
  $$insert into public.warehouse_items(name, category) values ('类别测试', E'类别\n')$$,
  '23514', null, 'item categories reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_items(name, brand) values ('品牌测试', E'\t厂家')$$,
  '23514', null, 'item brands reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_items(name, description) values ('说明测试', E'说明\n')$$,
  '23514', null, 'item descriptions reject POSIX whitespace at the edge'
);

select lives_ok(
  $$insert into public.warehouse_variants(
      id, item_id, sku, model, size, material, unit, minimum_stock,
      default_purchase_price, system_qr, manufacturer_qr
    ) values (
      '93000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000001',
      'SW-000001', 'M-1', '10m', '铜', '卷', 1.000, 120.5000,
      'SWERP:VARIANT:93000000-0000-4000-8000-000000000001', 'maker-qr-1'
    )$$,
  'a valid warehouse variant is accepted'
);
select lives_ok(
  $$insert into public.warehouse_variants(
      id, item_id, sku, unit, minimum_stock, default_purchase_price, system_qr
    ) values (
      '93000000-0000-4000-8000-000000000002',
      '92000000-0000-4000-8000-000000000001',
      'SW-000002', '个', 0, 0,
      'SWERP:VARIANT:93000000-0000-4000-8000-000000000002'
    )$$,
  'a second valid variant supports relationship constraint tests'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('99999999-0000-4000-8000-000000000001', 'SW-X', '个', 'SWERP:VARIANT:X')$$,
  '23503', null, 'variants require an existing item'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000001', '个', 'SWERP:VARIANT:X2')$$,
  '23505', null, 'variant SKUs are unique'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-DUP-QR', '个', 'SWERP:VARIANT:93000000-0000-4000-8000-000000000001')$$,
  '23505', null, 'system QR values are unique'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, manufacturer_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000003', '个', 'SWERP:VARIANT:X3', 'MAKER-QR-1')$$,
  '23505', null, 'manufacturer QR values are unique without case sensitivity'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, manufacturer_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000004', '个', 'SWERP:VARIANT:X4', 'swerp:variant:factory')$$,
  '23514', null, 'manufacturer QR cannot use the system reserved prefix'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, manufacturer_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000005', '个', 'factory-only', 'factory-5')$$,
  '23514', null, 'system QR must retain the reserved prefix'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, manufacturer_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000006', '个', 'SWERP:VARIANT:X6', '')$$,
  '23514', null, 'manufacturer QR is null or nonblank'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, minimum_stock) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000007', '个', 'SWERP:VARIANT:X7', -1)$$,
  '23514', null, 'minimum stock cannot be negative'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, minimum_stock) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000008', '个', 'SWERP:VARIANT:X8', 'NaN')$$,
  '23514', null, 'minimum stock must be finite'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, default_purchase_price) values
    ('92000000-0000-4000-8000-000000000001', 'SW-000009', '个', 'SWERP:VARIANT:X9', 'NaN')$$,
  '23514', null, 'default purchase price must be finite'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', ' PADDED-SKU', '个', 'SWERP:VARIANT:PADDED-SKU')$$,
  '23514', null, 'padded variant SKUs are rejected'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-PADDED-UNIT', ' 个', 'SWERP:VARIANT:PADDED-UNIT')$$,
  '23514', null, 'padded units are rejected'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, default_purchase_price) values
    ('92000000-0000-4000-8000-000000000001', 'SW-NEG-PRICE', '个', 'SWERP:VARIANT:NEG-PRICE', -0.0001)$$,
  '23514', null, 'default purchase price cannot be negative'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', E'\tSW-TAB-SKU', '个', 'SWERP:VARIANT:TAB-SKU')$$,
  '23514', null, 'variant SKUs reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, model, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-TAB-MODEL', E'\t型号', '个', 'SWERP:VARIANT:TAB-MODEL')$$,
  '23514', null, 'variant models reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, size, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-NL-SIZE', E'尺寸\n', '个', 'SWERP:VARIANT:NL-SIZE')$$,
  '23514', null, 'variant sizes reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, material, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-TAB-MATERIAL', E'\t铜', '个', 'SWERP:VARIANT:TAB-MATERIAL')$$,
  '23514', null, 'variant materials reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-NL-UNIT', E'个\n', 'SWERP:VARIANT:NL-UNIT')$$,
  '23514', null, 'variant units reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-EMPTY-SYSTEM-QR', '个', E'SWERP:VARIANT:\t')$$,
  '23514', null, 'system QR requires a meaningful non-whitespace suffix'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, manufacturer_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-TAB-MANUFACTURER-QR', '个',
     'SWERP:VARIANT:TAB-MANUFACTURER-QR', E'\t')$$,
  '23514', null, 'manufacturer QR rejects POSIX-whitespace-only values'
);
select throws_ok(
  $$insert into public.warehouse_variants(item_id, sku, unit, system_qr, manufacturer_qr) values
    ('92000000-0000-4000-8000-000000000001', 'SW-NL-MANUFACTURER-QR', '个',
     'SWERP:VARIANT:NL-MANUFACTURER-QR', E'maker-qr-newline\n')$$,
  '23514', null, 'manufacturer QR rejects POSIX whitespace at the edge'
);

select lives_ok(
  $$insert into public.warehouse_batches(
      id, variant_id, receipt_line_id, received_at, unit_cost, original_quantity
    ) values (
      '94000000-0000-4000-8000-000000000001',
      '93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000011',
      '2026-08-08T00:00:00Z', 120.5000, 10.000
    )$$,
  'a valid FIFO batch is accepted'
);
select throws_ok(
  $$insert into public.warehouse_batches(variant_id, received_at, unit_cost, original_quantity) values
    ('93000000-0000-4000-8000-000000000001', now(), -0.0001, 1)$$,
  '23514', null, 'batch unit cost cannot be negative'
);
select throws_ok(
  $$insert into public.warehouse_batches(variant_id, received_at, unit_cost, original_quantity) values
    ('93000000-0000-4000-8000-000000000001', now(), 1, 0)$$,
  '23514', null, 'batch original quantity must be positive'
);
select throws_ok(
  $$insert into public.warehouse_batches(variant_id, received_at, unit_cost, original_quantity) values
    ('93000000-0000-4000-8000-000000000001', now(), 'NaN', 1)$$,
  '23514', null, 'batch unit cost must be finite'
);
select throws_ok(
  $$insert into public.warehouse_batches(variant_id, received_at, unit_cost, original_quantity) values
    ('99999999-0000-4000-8000-000000000001', now(), 1, 1)$$,
  '23503', null, 'batches require an existing variant'
);
select throws_ok(
  $$insert into public.warehouse_batches(variant_id, received_at, unit_cost, original_quantity) values
    ('93000000-0000-4000-8000-000000000001', now(), 1, 'NaN')$$,
  '23514', null, 'batch original quantity must be finite'
);

select lives_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 10.000)$$,
  'a valid batch balance is accepted'
);
select throws_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', -1)$$,
  '23514', null, 'batch location quantity cannot be negative'
);
select throws_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'NaN')$$,
  '23514', null, 'batch location quantity must be finite'
);
select throws_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 1)$$,
  '23505', null, 'batch and location form a composite primary key'
);
select throws_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('99999999-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 1)$$,
  '23503', null, 'batch balances require an existing batch'
);
select throws_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('94000000-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001', 1)$$,
  '23503', null, 'batch balances require an existing location'
);

insert into public.projects(record_key, payload) values (
  'TASK4-PROJECT',
  '{"projectName":"仓库测试项目","status":"进行中","attendanceRadiusMeters":100,"address":"测试地址","latitude":35,"longitude":139,"locationConfirmedAt":"2026-08-08T00:00:00Z","locationAddressSnapshot":"测试地址"}'::jsonb
);
insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'warehouse-reader@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'warehouse-no-access@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'warehouse-inactive@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'warehouse-password@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'warehouse-former@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'warehouse-deleted@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '95000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'warehouse-sw000@auth.invalid', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.employee_profiles(id, employee_number, auth_user_id, name, department, position, employment_status, account_status, must_change_password)
values
  ('96000000-0000-4000-8000-000000000001', 'SW-9601', '95000000-0000-4000-8000-000000000001', '仓库读者', '仓库管理部', '仓库管理员', '在职', 'active', false),
  ('96000000-0000-4000-8000-000000000002', 'SW-9602', '95000000-0000-4000-8000-000000000002', '无权限员工', '工程部', '大工', '在职', 'active', false),
  ('96000000-0000-4000-8000-000000000003', 'SW-9603', '95000000-0000-4000-8000-000000000003', '停用员工', '仓库管理部', '仓库管理员', '在职', 'disabled', false),
  ('96000000-0000-4000-8000-000000000004', 'SW-9604', '95000000-0000-4000-8000-000000000004', '待改密员工', '仓库管理部', '仓库管理员', '在职', 'active', true),
  ('96000000-0000-4000-8000-000000000005', 'SW-9605', '95000000-0000-4000-8000-000000000005', '离职员工', '仓库管理部', '仓库管理员', '离职', 'active', false),
  ('96000000-0000-4000-8000-000000000006', 'SW-9606', '95000000-0000-4000-8000-000000000006', '已删除员工', '仓库管理部', '仓库管理员', '在职', 'active', false);
insert into public.employee_profiles(
  id, employee_number, auth_user_id, name, department, position,
  employment_status, account_status, must_change_password,
  is_hidden_system_account
) values (
  '96000000-0000-4000-8000-000000000007', 'SW-000',
  '95000000-0000-4000-8000-000000000007', '系统恢复管理员',
  '总务部', '社长', '在职', 'active', false, true
);
update public.employee_profiles
set deleted_at = '2026-08-08T00:00:00Z'
where id = '96000000-0000-4000-8000-000000000006';
insert into public.permission_grants(subject_type, subject_code, permission_key) values
  ('department', '仓库管理部', 'module.inventory.view'),
  ('department', '仓库管理部', 'warehouse.cost.view');

select lives_ok(
  $$insert into public.warehouse_inventory_movements(
      id, movement_type, variant_id, batch_id, warehouse_id, location_id,
      quantity_delta, unit_cost, source_document_type, source_document_id,
      idempotency_key, project_id, destination_type, destination_id,
      destination_name, operator_employee_profile_id, occurred_at, metadata
    ) values (
      '97000000-0000-4000-8000-000000000001', '采购入库',
      '93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      10.000, 120.5000, 'stockIn', 'RECEIPT-1', 'IDEMPOTENCY-1',
      'TASK4-PROJECT', 'warehouse', 'MAIN', '本社仓',
      '96000000-0000-4000-8000-000000000001', '2026-08-08T00:00:00Z', '{}'::jsonb
    )$$,
  'a valid immutable movement is accepted'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta, unit_cost,
      source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('未知', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stockIn', 'BAD-1', 'BAD-1', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'unknown movement types are rejected'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta, unit_cost,
      source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘点无差异', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      'NaN', 1, 'stocktake', 'BAD-2', 'BAD-2', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement quantity must be finite'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta, unit_cost,
      source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, -1, 'stocktake', 'BAD-3', 'BAD-3', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement unit cost cannot be negative'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta, unit_cost,
      source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at, metadata
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-4', 'BAD-4', '96000000-0000-4000-8000-000000000001', now(), '[]')$$,
  '23514', null, 'movement metadata must be an object'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta, unit_cost,
      source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-5', 'IDEMPOTENCY-1', '96000000-0000-4000-8000-000000000001', now())$$,
  '23505', null, 'movement idempotency keys are unique'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      id, movement_type, variant_id, warehouse_id, location_id, quantity_delta, unit_cost,
      source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at, reversal_of_movement_id
    ) values ('97000000-0000-4000-8000-000000000099', '冲销',
      '93000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001', -1, 1, 'reversal', 'BAD-6', 'BAD-6',
      '96000000-0000-4000-8000-000000000001', now(), '97000000-0000-4000-8000-000000000099')$$,
  '23514', null, 'a movement cannot reverse itself'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, batch_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('项目出库', '93000000-0000-4000-8000-000000000002',
      '94000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001', -1, 1, 'stockOut', 'BAD-7', 'BAD-7',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movement batch and variant must match'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002',
      1, 1, 'stocktake', 'BAD-8', 'BAD-8', '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movement location and warehouse must match'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      project_id, operator_employee_profile_id, occurred_at
    ) values ('项目出库', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      -1, 1, 'stockOut', 'BAD-9', 'BAD-9', 'MISSING-PROJECT',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movement project references an existing project record key'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-10', 'BAD-10', '99999999-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movement operator references an existing employee profile'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, ' stocktake', 'BAD-11', 'BAD-11', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'padded movement source types are rejected'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-12', ' BAD-12', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'padded movement idempotency keys are rejected'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 'NaN', 'stocktake', 'BAD-13', 'BAD-13', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement unit cost must be finite'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '99999999-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-14', 'BAD-14', '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movements require an existing variant'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '99999999-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-15', 'BAD-15', '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movements require an existing warehouse'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '99999999-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-16', 'BAD-16', '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'movements require an existing location'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', E'BAD-17\n', 'BAD-17', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement source ids reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, E'\tstocktake', 'BAD-17B', 'BAD-17B', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement source types reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-17C', E'BAD-17C\n', '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement idempotency keys reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      destination_type, operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-18', 'BAD-18', E'\twarehouse',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement destination types reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      destination_id, operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-19', 'BAD-19', E'MAIN\n',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement destination ids reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      destination_name, operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-20', 'BAD-20', E'\t本社仓',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'movement destination names reject POSIX whitespace at the edge'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      reversal_of_movement_id, operator_employee_profile_id, occurred_at
    ) values ('盘盈', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      1, 1, 'stocktake', 'BAD-21', 'BAD-21', '97000000-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'non-reversal movements cannot reference a reversal target'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      operator_employee_profile_id, occurred_at
    ) values ('冲销', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      -1, 1, 'reversal', 'BAD-22', 'BAD-22',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23514', null, 'reversal movements require an original movement reference'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      movement_type, variant_id, warehouse_id, location_id, quantity_delta,
      unit_cost, source_document_type, source_document_id, idempotency_key,
      reversal_of_movement_id, operator_employee_profile_id, occurred_at
    ) values ('冲销', '93000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001',
      -1, 1, 'reversal', 'BAD-23', 'BAD-23', '99999999-0000-4000-8000-000000000001',
      '96000000-0000-4000-8000-000000000001', now())$$,
  '23503', null, 'reversal movements require an existing original movement'
);
select lives_ok(
  $$insert into public.warehouse_inventory_movements(
      id, movement_type, variant_id, batch_id, warehouse_id, location_id,
      quantity_delta, unit_cost, source_document_type, source_document_id,
      idempotency_key, operator_employee_profile_id, occurred_at,
      reversal_of_movement_id, metadata
    ) values (
      '97000000-0000-4000-8000-000000000002', '冲销',
      '93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      -10.000, 120.5000, 'reversal', 'REVERSAL-1', 'REVERSAL-IDEMPOTENCY-1',
      '96000000-0000-4000-8000-000000000001', '2026-08-08T01:00:00Z',
      '97000000-0000-4000-8000-000000000001', '{}'::jsonb
    )$$,
  'the first append-only reversal of a movement is accepted'
);
select throws_ok(
  $$insert into public.warehouse_inventory_movements(
      id, movement_type, variant_id, batch_id, warehouse_id, location_id,
      quantity_delta, unit_cost, source_document_type, source_document_id,
      idempotency_key, operator_employee_profile_id, occurred_at,
      reversal_of_movement_id, metadata
    ) values (
      '97000000-0000-4000-8000-000000000003', '冲销',
      '93000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000001',
      -10.000, 120.5000, 'reversal', 'REVERSAL-2', 'REVERSAL-IDEMPOTENCY-2',
      '96000000-0000-4000-8000-000000000001', '2026-08-08T02:00:00Z',
      '97000000-0000-4000-8000-000000000001', '{}'::jsonb
    )$$,
  '23505', null, 'an original movement can be reversed only once'
);

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is((select count(*) from public.warehouse_sites), 3::bigint, 'active inventory readers can read sites');
select is((select count(*) from public.warehouse_variants), 2::bigint, 'active inventory readers can read non-cost variant columns');
select throws_ok(
  $$select default_purchase_price from public.warehouse_variants limit 1$$,
  '42501', null, 'cost permission does not bypass the cost-aware RPC boundary'
);
select throws_ok(
  $$select unit_cost from public.warehouse_batches limit 1$$,
  '42501', null, 'batch costs require a future cost-aware RPC'
);
select throws_ok(
  $$select unit_cost from public.warehouse_inventory_movements limit 1$$,
  '42501', null, 'movement costs require a future cost-aware RPC'
);
select throws_ok(
  $$insert into public.warehouse_batches(variant_id, received_at, unit_cost, original_quantity)
    values ('93000000-0000-4000-8000-000000000001', now(), 1, 1)$$,
  '42501', null, 'authenticated users cannot write batches directly'
);
select throws_ok(
  $$update public.warehouse_batch_locations set quantity = 9$$,
  '42501', null, 'authenticated users cannot update balances directly'
);
select throws_ok(
  $$delete from public.warehouse_inventory_movements$$,
  '42501', null, 'authenticated users cannot delete movements directly'
);
reset role;

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select is((select count(*) from public.warehouse_sites), 0::bigint, 'active users without inventory view see no warehouse rows');
select is(
  (select count(*) from public.warehouse_locations)
  + (select count(*) from public.warehouse_items)
  + (select count(*) from public.warehouse_variants)
  + (select count(*) from public.warehouse_batches)
  + (select count(*) from public.warehouse_batch_locations)
  + (select count(*) from public.warehouse_inventory_movements),
  0::bigint,
  'users without inventory view see no rows in every warehouse relation'
);
reset role;

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select is((select count(*) from public.warehouse_sites), 0::bigint, 'inactive users see no warehouse rows');
reset role;

select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  (select employee_profile_id::text || ':' || employee_name
   from private.assert_warehouse_permission('warehouse.cost.view')),
  '96000000-0000-4000-8000-000000000001:仓库读者',
  'permission assertion returns an immutable audit identity snapshot'
);
select throws_ok(
  $$select * from private.assert_warehouse_permission('warehouse.receipt.confirm')$$,
  '42501', 'warehouse permission required', 'permission assertion checks the exact key'
);
select throws_ok(
  $$select * from private.assert_warehouse_permission('')$$,
  '42501', 'warehouse permission required', 'permission assertion rejects a blank key'
);
select throws_ok(
  $$select * from private.assert_warehouse_permission(' warehouse.cost.view')$$,
  '42501', 'warehouse permission required', 'permission assertion rejects a padded key'
);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000099', true);
select throws_ok(
  $$select * from private.assert_warehouse_permission('warehouse.cost.view')$$,
  '42501', 'active employee required', 'permission assertion rejects a missing profile'
);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000003', true);
select throws_ok(
  $$select * from private.assert_warehouse_permission('warehouse.cost.view')$$,
  '42501', 'active employee required', 'permission assertion fails closed for inactive accounts'
);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from private.assert_warehouse_permission('warehouse.cost.view')$$,
  '42501', 'active employee required', 'permission assertion fails closed during required password change'
);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000005', true);
select throws_ok(
  $$select * from private.assert_warehouse_permission('warehouse.cost.view')$$,
  '42501', 'active employee required', 'permission assertion fails closed for former employees'
);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000006', true);
select throws_ok(
  $$select * from private.assert_warehouse_permission('warehouse.cost.view')$$,
  '42501', 'active employee required', 'permission assertion fails closed for deleted profiles'
);
select set_config('request.jwt.claim.sub', '95000000-0000-4000-8000-000000000007', true);
select is(
  (select employee_profile_id::text || ':' || employee_name
   from private.assert_warehouse_permission('warehouse.receipt.confirm')),
  '96000000-0000-4000-8000-000000000007:系统恢复管理员',
  'active SW-000 receives exact warehouse permission assertion audit identity'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select throws_ok(
  $$update public.warehouse_inventory_movements set destination_name = '篡改' where id = '97000000-0000-4000-8000-000000000001'$$,
  '42501', 'warehouse inventory movements are immutable', 'table owner cannot bypass the movement update trigger'
);
select throws_ok(
  $$delete from public.warehouse_inventory_movements where id = '97000000-0000-4000-8000-000000000001'$$,
  '42501', 'warehouse inventory movements are immutable', 'table owner cannot bypass the movement delete trigger'
);

select is(
  (select count(*)
   from unnest(array[
     'public.warehouse_batches',
     'public.warehouse_batch_locations',
     'public.warehouse_inventory_movements'
   ]::text[]) as protected(table_name)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']::text[]) as operation(privilege_name)
   where has_table_privilege('authenticated', protected.table_name, operation.privilege_name)),
  0::bigint,
  'authenticated has no direct batch, balance, or movement write privilege'
);
select is(
  (select count(*)
   from unnest(array[
     'public.warehouse_batches',
     'public.warehouse_batch_locations',
     'public.warehouse_inventory_movements'
   ]::text[]) as protected(table_name)
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE']::text[]) as operation(privilege_name)
   where has_table_privilege('anon', protected.table_name, operation.privilege_name)),
  0::bigint,
  'anonymous has no direct batch, balance, or movement write privilege'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.warehouse_inventory_movements',
    'TRUNCATE'
  ),
  'service role cannot truncate the immutable movement ledger'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.warehouse_inventory_movements',
    'UPDATE'
  ),
  'service role cannot update the immutable movement ledger'
);
select ok(
  not has_table_privilege(
    'service_role',
    'public.warehouse_inventory_movements',
    'DELETE'
  ),
  'service role cannot delete the immutable movement ledger'
);

set local role anon;
select throws_ok(
  $$insert into public.warehouse_batch_locations(batch_id, location_id, quantity) values
    ('94000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 1)$$,
  '42501', null, 'anonymous users cannot write balances directly'
);
reset role;

select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'warehouse_movements_variant_location_time_idx'),
  'movement variant/location/time index exists'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'warehouse_movements_source_document_idx'),
  'movement source-document index exists'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'warehouse_movements_project_time_idx'),
  'movement project/time index exists'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'warehouse_movements_idempotency_unique'),
  'movement idempotency index exists'
);

select * from finish();
rollback;

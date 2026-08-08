import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL(
  '../../supabase/migrations/202608080002_warehouse_foundation.sql',
  import.meta.url,
), 'utf8').catch(() => '')

const expectedTables = [
  'warehouse_sites',
  'warehouse_locations',
  'warehouse_items',
  'warehouse_variants',
  'warehouse_batches',
  'warehouse_batch_locations',
  'warehouse_inventory_movements',
]

test('warehouse migration creates the normalized foundation with explicit numeric precision', () => {
  for (const table of expectedTables) {
    assert.match(
      migration,
      new RegExp(`create table public\\.${table}\\b`, 'i'),
      `missing normalized table ${table}`,
    )
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
      `missing RLS on ${table}`,
    )
  }

  assert.match(migration, /quantity_delta\s+numeric\(18,\s*3\)/i)
  assert.match(migration, /original_quantity\s+numeric\(18,\s*3\)/i)
  assert.match(migration, /quantity\s+numeric\(18,\s*3\)/i)
  assert.match(migration, /unit_cost\s+numeric\(18,\s*4\)/i)
  assert.match(migration, /default_purchase_price\s+numeric\(18,\s*4\)/i)
})

test('warehouse identifiers, QR values and ledger relationships are database constrained', () => {
  for (const name of [
    'warehouse_sites_code_unique',
    'warehouse_locations_warehouse_shelf_unique',
    'warehouse_variants_sku_unique',
    'warehouse_variants_system_qr_unique',
    'warehouse_variants_manufacturer_qr_ci_unique',
    'warehouse_movements_idempotency_unique',
    'warehouse_movements_reversal_unique',
  ]) {
    assert.match(migration, new RegExp(name, 'i'), `missing constraint/index ${name}`)
  }

  assert.match(migration, /SWERP:VARIANT:/i)
  assert.match(migration, /references public\.employee_profiles\(id\) on delete restrict/i)
  assert.match(migration, /references public\.projects\(record_key\) on delete restrict/i)
  assert.match(migration, /references public\.warehouse_inventory_movements\(id\) on delete restrict/i)
})

test('warehouse browser access is read-only and cost columns are not directly selectable', () => {
  assert.match(
    migration,
    /create policy "warehouse_sites inventory read"[\s\S]*public\.has_current_permission\('module\.inventory\.view'\)/i,
  )
  assert.match(
    migration,
    /grant select \([^)]+\) on table public\.warehouse_variants to authenticated/i,
  )
  assert.doesNotMatch(
    migration,
    /grant select\s+on table public\.warehouse_(variants|batches|inventory_movements) to authenticated/i,
  )
  for (const table of [
    'warehouse_batches',
    'warehouse_batch_locations',
    'warehouse_inventory_movements',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'),
      `missing direct-write closure for ${table}`,
    )
  }
})

test('warehouse permission assertion is fail-closed and movement rows are immutable', () => {
  assert.match(
    migration,
    /create or replace function private\.assert_warehouse_permission\(p_permission_key text\)/i,
  )
  assert.match(migration, /auth_user_id\s*=\s*auth\.uid\(\)/i)
  assert.match(migration, /employment_status\s*<>\s*'在职'/i)
  assert.match(migration, /account_status\s*<>\s*'active'/i)
  assert.match(migration, /must_change_password\s*<>\s*false/i)
  assert.match(migration, /public\.has_current_permission\(p_permission_key\)/i)
  assert.match(
    migration,
    /create trigger reject_warehouse_movement_mutation\s+before update or delete\s+on public\.warehouse_inventory_movements/i,
  )
  assert.match(migration, /warehouse inventory movements are immutable/i)
})

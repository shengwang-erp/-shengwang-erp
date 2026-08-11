import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const billingSql = await readFile(new URL(
  '../../supabase/migrations/202608110002_miraisya_billing.sql',
  import.meta.url,
), 'utf8').catch(() => '')
const settlementSql = await readFile(new URL(
  '../../supabase/migrations/202608110003_miraisya_monthly_settlement.sql',
  import.meta.url,
), 'utf8').catch(() => '')

test('Miraisya billing tables are RPC-only and preserve fixed numeric rules', () => {
  for (const table of ['miraisya_billing_headers', 'miraisya_billing_items']) {
    assert.match(billingSql, new RegExp(`create table public\\.${table}`, 'i'))
    assert.match(billingSql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'))
  }
  assert.match(billingSql, /numeric\(14,4\)/i)
  assert.match(billingSql, /tax_rate[^;]*in \(0, 10\)/i)
  assert.match(billingSql, /get_miraisya_billing_secure/)
  assert.match(billingSql, /replace_miraisya_billing_secure/)
  assert.match(billingSql, /MIRAISYA_BILLING_VERSION_CONFLICT/)
  assert.match(billingSql, /for update/i)
  assert.match(billingSql, /jsonb_array_elements\(p_items\)/i)
})

test('billing RPCs verify project type and approved editor permissions', () => {
  assert.match(billingSql, /projectType/)
  assert.match(billingSql, /miraisya/)
  assert.match(billingSql, /current_employee_can_mutate_typed_project\('update'\)/)
  assert.doesNotMatch(billingSql, /grant\s+(select|insert|update|delete).*authenticated/i)
})

test('monthly settlement tables are immutable RPC-only snapshots', () => {
  for (const table of [
    'miraisya_monthly_settlements',
    'miraisya_monthly_settlement_projects',
    'miraisya_monthly_settlement_items',
  ]) {
    assert.match(settlementSql, new RegExp(`create table public\\.${table}`, 'i'))
    assert.match(settlementSql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'))
  }
  assert.match(settlementSql, /MIRAI:[^']*2026-08|MIRAI:\s*'\s*\|\|\s*p_month/i)
  assert.match(settlementSql, /MIRAI-[^']*YYYYMM|MIRAI-/i)
  assert.match(settlementSql, /create unique index[^;]*where status in \('draft', 'confirmed'\)/i)
  assert.match(settlementSql, /export_project_cost_report_secure/i)
  assert.match(settlementSql, /cost_snapshot_token/i)
  assert.match(settlementSql, /billing_version/i)
})

test('settlement RPC mutations require president or finance settlement permissions', () => {
  assert.match(settlementSql, /current_employee_can_mutate_typed_project\('settlement'\)/)
  assert.match(settlementSql, /create_miraisya_settlement_draft_secure/)
  assert.match(settlementSql, /confirm_miraisya_settlement_secure/)
  assert.match(settlementSql, /void_miraisya_settlement_secure/)
  assert.match(settlementSql, /MIRAISYA_SETTLEMENT_VERSION_CONFLICT/)
  assert.match(settlementSql, /MIRAISYA_SETTLEMENT_COST_INCOMPLETE/)
  assert.match(settlementSql, /MIRAISYA_SETTLEMENT_PROJECT_DUPLICATE/)
  assert.match(settlementSql, /void_reason/i)
  assert.doesNotMatch(settlementSql, /delete\s+from\s+public\.miraisya_monthly_settlement/i)
})

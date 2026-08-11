import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const billingSql = await readFile(new URL(
  '../../supabase/migrations/202608110002_miraisya_billing.sql',
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

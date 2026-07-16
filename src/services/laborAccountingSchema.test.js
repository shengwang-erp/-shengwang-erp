import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL('../../supabase/migrations/202607160001_attendance_accounting.sql', import.meta.url), 'utf8').catch(() => '')

test('accounting migration defines normalized tables and secure boundaries', () => {
  for (const table of ['attendance_accounting_settings', 'attendance_day_resolutions',
    'attendance_project_allocations', 'attendance_monthly_payrolls',
    'attendance_accounting_audit_log']) {
    assert.match(migration, new RegExp(`create table public\\.${table}`))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(migration, /unique\s*\(employee_profile_id,\s*work_date\)/u)
  assert.match(migration, /attendance_units[^;]+0\.5/u)
  assert.match(migration, /settings_key[^;]+default/u)
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete).*authenticated/iu)
})

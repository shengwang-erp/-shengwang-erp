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

test('daily dashboard RPCs keep time, identity, salary, and execution authority server-owned', () => {
  for (const signature of [
    String.raw`private\.attendance_accounting_settings_json\(\)`,
    String.raw`private\.attendance_issue_codes\(\s*p_employee_profile_id\s+uuid,\s*p_work_date\s+date,\s*p_now_tokyo\s+timestamp\s+without\s+time\s+zone\s*\)`,
    String.raw`private\.attendance_dashboard_employee_json\(\s*p_employee_profile_id\s+uuid,\s*p_work_date\s+date,\s*p_can_view_salary\s+boolean\s*\)`,
    String.raw`public\.list_daily_attendance_dashboard_secure\(\s*p_work_date\s+date\s*\)`,
    String.raw`public\.get_labor_alert_count_secure\(\s*\)`,
  ]) {
    assert.match(migration, new RegExp(`create or replace function\\s+${signature}`, 'iu'))
  }

  for (const rpc of [
    String.raw`public\.list_daily_attendance_dashboard_secure\(date\)`,
    String.raw`public\.get_labor_alert_count_secure\(\)`,
  ]) {
    assert.match(migration, new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${rpc}\\s+from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`,
      'iu',
    ))
    assert.match(migration, new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+${rpc}\\s+to\\s+authenticated,\\s*service_role`,
      'iu',
    ))
  }

  const publicRpcDefinitions = migration.match(
    /create or replace function public\.(?:list_daily_attendance_dashboard_secure|get_labor_alert_count_secure)[\s\S]*?\$\$;/giu,
  ) ?? []
  assert.equal(publicRpcDefinitions.length, 2)
  for (const definition of publicRpcDefinitions) {
    assert.match(definition, /security definer/iu)
    assert.match(definition, /stable/iu)
    assert.match(definition, /set search_path\s*=\s*pg_catalog,\s*public/iu)
    assert.match(definition, /private\.current_attendance_accountant\(\)|public\.list_daily_attendance_dashboard_secure\(/iu)
    assert.doesNotMatch(definition, /p_(?:now|actor|salary|wage|cost)/iu)
  }

  assert.match(migration, /statement_timestamp\(\)\s+at\s+time\s+zone\s+'Asia\/Tokyo'/iu)
  assert.doesNotMatch(
    migration,
    /create or replace function\s+public\.list_daily_attendance_dashboard_secure\([^)]*(?:timestamp|employee_profile|salary|wage|cost)/iu,
  )
  assert.doesNotMatch(
    migration,
    /jsonb_build_object\([^;]*(?:to_jsonb\(employee\)|employee\.\*|profile\.\*)/iu,
  )
})

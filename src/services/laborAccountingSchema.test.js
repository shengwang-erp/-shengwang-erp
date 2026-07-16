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

test('workflow, report, settings, and bridge RPCs expose only the approved secure surface', () => {
  const signatures = [
    String.raw`public\.get_attendance_resolution_detail_secure\(\s*p_employee_profile_id\s+uuid,\s*p_work_date\s+date\s*\)`,
    String.raw`public\.save_attendance_resolution_draft_secure\(\s*p_employee_profile_id\s+uuid,\s*p_work_date\s+date,\s*p_resolution_type\s+text,\s*p_attendance_units\s+numeric,\s*p_final_project_cost\s+numeric,\s*p_allocations\s+jsonb,\s*p_resolution_note\s+text,\s*p_version\s+integer\s*\)`,
    String.raw`public\.confirm_attendance_resolution_secure\(\s*p_employee_profile_id\s+uuid,\s*p_work_date\s+date,\s*p_resolution_type\s+text,\s*p_attendance_units\s+numeric,\s*p_final_project_cost\s+numeric,\s*p_allocations\s+jsonb,\s*p_resolution_note\s+text,\s*p_version\s+integer\s*\)`,
    String.raw`public\.list_monthly_payroll_secure\(\s*p_month\s+date,\s*p_search\s+text,\s*p_employee_profile_id\s+uuid,\s*p_only_pending\s+boolean\s*\)`,
    String.raw`public\.list_employee_attendance_calendar_secure\(\s*p_employee_profile_id\s+uuid,\s*p_month\s+date\s*\)`,
    String.raw`public\.save_monthly_payroll_draft_secure\(\s*p_employee_profile_id\s+uuid,\s*p_month\s+date,\s*p_overtime_pay\s+numeric,\s*p_bonus\s+numeric,\s*p_deduction\s+numeric,\s*p_confirmation_note\s+text,\s*p_version\s+integer\s*\)`,
    String.raw`public\.confirm_monthly_payroll_secure\(\s*p_employee_profile_id\s+uuid,\s*p_month\s+date,\s*p_overtime_pay\s+numeric,\s*p_bonus\s+numeric,\s*p_deduction\s+numeric,\s*p_confirmation_note\s+text,\s*p_version\s+integer\s*\)`,
    String.raw`public\.reopen_monthly_payroll_secure\(\s*p_payroll_id\s+uuid,\s*p_reason\s+text,\s*p_version\s+integer\s*\)`,
    String.raw`public\.list_project_labor_costs_secure\(\s*p_month\s+date,\s*p_status\s+text,\s*p_employee_profile_id\s+uuid,\s*p_project_id\s+text\s*\)`,
    String.raw`public\.export_project_labor_costs_secure\(\s*p_month\s+date,\s*p_project_id\s+text,\s*p_employee_profile_id\s+uuid\s*\)`,
    String.raw`public\.get_attendance_accounting_settings_secure\(\s*\)`,
    String.raw`public\.update_attendance_accounting_settings_secure\(\s*p_effective_from\s+date,\s*p_work_weekdays\s+smallint\[\],\s*p_work_start_time\s+time(?:\s+without\s+time\s+zone)?,\s*p_work_end_time\s+time(?:\s+without\s+time\s+zone)?,\s*p_break_minutes\s+integer,\s*p_standard_day_minutes\s+integer,\s*p_version\s+integer\s*\)`,
    String.raw`public\.get_attendance_accounting_bridge_secure\(\s*p_month\s+date\s*\)`,
  ]

  for (const signature of signatures) {
    assert.match(migration, new RegExp(`create or replace function\\s+${signature}`, 'iu'))
  }

  const identitySignatures = [
    'public.get_attendance_resolution_detail_secure(uuid, date)',
    'public.save_attendance_resolution_draft_secure(uuid, date, text, numeric, numeric, jsonb, text, integer)',
    'public.confirm_attendance_resolution_secure(uuid, date, text, numeric, numeric, jsonb, text, integer)',
    'public.list_monthly_payroll_secure(date, text, uuid, boolean)',
    'public.list_employee_attendance_calendar_secure(uuid, date)',
    'public.save_monthly_payroll_draft_secure(uuid, date, numeric, numeric, numeric, text, integer)',
    'public.confirm_monthly_payroll_secure(uuid, date, numeric, numeric, numeric, text, integer)',
    'public.reopen_monthly_payroll_secure(uuid, text, integer)',
    'public.list_project_labor_costs_secure(date, text, uuid, text)',
    'public.export_project_labor_costs_secure(date, text, uuid)',
    'public.get_attendance_accounting_settings_secure()',
    'public.update_attendance_accounting_settings_secure(date, smallint[], time without time zone, time without time zone, integer, integer, integer)',
    'public.get_attendance_accounting_bridge_secure(date)',
  ]
  const normalizedMigration = migration
    .replaceAll(/\s+/gu, ' ')
    .replaceAll(/\s*([(),])\s*/gu, '$1')
  for (const rpc of identitySignatures) {
    const normalizedRpc = rpc
      .replaceAll(/\s+/gu, ' ')
      .replaceAll(/\s*([(),])\s*/gu, '$1')
    const escaped = normalizedRpc.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    assert.match(normalizedMigration, new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+${escaped}\\s*from\\s+public,anon,authenticated,service_role`,
      'iu',
    ))
    assert.match(normalizedMigration, new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+${escaped}\\s*to\\s+authenticated,service_role`,
      'iu',
    ))
  }

  const definitions = migration.match(
    /create or replace function public\.(?:get_attendance_resolution_detail_secure|save_attendance_resolution_draft_secure|confirm_attendance_resolution_secure|list_monthly_payroll_secure|list_employee_attendance_calendar_secure|save_monthly_payroll_draft_secure|confirm_monthly_payroll_secure|reopen_monthly_payroll_secure|list_project_labor_costs_secure|export_project_labor_costs_secure|get_attendance_accounting_settings_secure|update_attendance_accounting_settings_secure|get_attendance_accounting_bridge_secure)[\s\S]*?\$\$;/giu,
  ) ?? []
  assert.equal(definitions.length, 13)
  for (const definition of definitions) {
    assert.match(definition, /security definer/iu)
    assert.match(definition, /set search_path\s*=\s*pg_catalog,\s*public/iu)
    assert.match(definition, /private\.current_attendance_accountant\(\)/iu)
    assert.doesNotMatch(definition, /execute\s+format|\bexecute\s+/iu)
    assert.doesNotMatch(definition, /p_(?:actor|salary_type|base_salary|daily_salary|hourly_wage|confirmed_by|server_time)/iu)
  }

  const projectLaborDefinition = definitions.find((definition) =>
    /function public\.list_project_labor_costs_secure/iu.test(definition))
  assert.ok(projectLaborDefinition)
  assert.match(projectLaborDefinition, /p_status\s+text/iu)
  assert.doesNotMatch(projectLaborDefinition, /p_search|normalized_search/iu)

  const privateHelperNames = [
    'attendance_valid_yen',
    'attendance_valid_business_date',
    'attendance_require_safe_aggregate',
    'attendance_parse_iso_date',
    'attendance_legacy_yen',
    'attendance_legacy_salary_amount',
    'attendance_legacy_salary_json',
    'attendance_legacy_labor_json',
    'attendance_employee_is_eligible',
    'attendance_schedule_required',
    'attendance_salary_json',
    'attendance_resolution_snapshot',
    'attendance_payroll_snapshot',
    'attendance_write_resolution',
    'attendance_month_counts',
    'attendance_payroll_preview',
    'attendance_payroll_result',
    'attendance_write_monthly_payroll',
    'attendance_official_project_rows',
  ]
  for (const helperName of privateHelperNames) {
    const helperDefinition = migration.match(new RegExp(
      `create or replace function private\\.${helperName}\\b[\\s\\S]*?\\$\\$;`,
      'iu',
    ))?.[0]
    assert.ok(helperDefinition, `missing private helper ${helperName}`)
    assert.match(helperDefinition, /security definer/iu)
    assert.match(helperDefinition, /set search_path\s*=\s*pg_catalog,\s*public/iu)
    assert.doesNotMatch(helperDefinition, /execute\s+format|\bexecute\s+/iu)
    assert.match(migration, new RegExp(
      `revoke\\s+all\\s+on\\s+function\\s+private\\.${helperName}\\([^;]*?\\)\\s+from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`,
      'iu',
    ))
    assert.doesNotMatch(migration, new RegExp(
      `grant\\s+execute\\s+on\\s+function\\s+private\\.${helperName}\\b`,
      'iu',
    ))
  }

  assert.match(migration, /hint\s*=\s*'ATTENDANCE_ACCOUNTING_VERSION_CONFLICT'/iu)
  const calendarDefinition = definitions.find((definition) =>
    /function public\.list_employee_attendance_calendar_secure/iu.test(definition))
  assert.ok(calendarDefinition)
  assert.match(calendarDefinition, /private\.attendance_dashboard_employee_json\([^,]+,[^,]+,\s*false\s*\)/iu)
  assert.doesNotMatch(
    calendarDefinition,
    /baseSalary|netSalary|dailySalary|hourlyWage|suggestedProjectCost|finalProjectCost|sessions|firstClockInAt|lastClockOutAt|workedMinutes/iu,
  )
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(?:project_attendance_sessions|project_attendance_events)|update\s+public\.(?:project_attendance_sessions|project_attendance_events)|delete\s+from\s+public\.(?:project_attendance_sessions|project_attendance_events)/iu)
})

test('monthly payroll summary exposes attendance-unit metrics instead of legacy day labels', () => {
  const definition = migration.match(
    /create or replace function public\.list_monthly_payroll_secure[\s\S]*?\$\$;/iu,
  )?.[0] ?? ''
  assert.match(definition, /'scheduledAttendanceUnits'/u)
  assert.match(definition, /'confirmedAttendanceUnits'/u)
  assert.doesNotMatch(
    definition,
    /'employeeCount'[\s\S]{0,300}'confirmedFullDays'[\s\S]{0,150}'confirmedHalfDays'/u,
  )
  const countsDefinition = migration.match(
    /create or replace function private\.attendance_month_counts[\s\S]*?\$\$;/iu,
  )?.[0] ?? ''
  assert.match(countsDefinition, /'scheduledAttendanceUnits'/u)
  assert.match(countsDefinition, /'confirmedAttendanceUnits'/u)
})

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL('../../supabase/migrations/202608120002_attendance_location_review_and_company_payroll.sql', import.meta.url),
  'utf8',
).catch(() => '')

test('daily resolutions store a structured reviewed location outcome', () => {
  for (const column of [
    'location_review_status text',
    "location_review_note text not null default ''",
    'location_reviewed_by_employee_profile_id uuid',
    'location_reviewed_at timestamptz',
  ]) {
    assert.match(migration, new RegExp(`add column ${column}`, 'iu'))
  }
  assert.match(migration, /location_review_status[\s\S]+confirmed_valid[\s\S]+recorded_abnormal/iu)
  assert.match(migration, /char_length\(location_review_note\)[\s\S]+between 1 and 2000/iu)
  assert.match(migration, /ATTENDANCE_LOCATION_REVIEW_REQUIRED/iu)
  assert.match(migration, /p_location_review_status text[\s\S]+p_location_review_note text/iu)
  assert.match(
    migration,
    /attendance_day_resolutions_location_review_shape_check[\s\S]+issue_codes_snapshot[\s\S]+abnormal_location/iu,
  )
  assert.doesNotMatch(migration, /历史定位异常：未结构化复核/iu)
})

test('server-owned fact mode forbids project money for general attendance', () => {
  assert.match(migration, /attendance_fact_mode\([\s\S]+project_attendance_sessions/iu)
  assert.match(migration, /attendance_mode = 'project'[\s\S]+attendance_mode = 'general'/iu)
  assert.match(migration, /fact_mode = 'general'[\s\S]+p_final_project_cost is null[\s\S]+p_final_project_cost <> 0[\s\S]+jsonb_array_length\(p_allocations\) <> 0/iu)
  assert.match(migration, /general attendance cannot create project labor cost/iu)
  assert.match(migration, /ATTENDANCE_GENERAL_PROJECT_COST_FORBIDDEN/iu)
  assert.match(
    migration,
    /attendance_write_resolution_with_review[\s\S]+pg_advisory_xact_lock_shared[\s\S]+hashtextextended\('attendance_accounting_settings', 0\)[\s\S]+pg_advisory_xact_lock[\s\S]+hashtextextended\(p_employee_profile_id::text, 1\)[\s\S]+attendance_fact_mode/iu,
  )
  assert.match(
    migration,
    /require_attendance_resolution_update[\s\S]+attendance resolution update permission required/iu,
  )
  assert.match(
    migration,
    /attendance_write_resolution_with_review[\s\S]+perform private\.require_attendance_resolution_update\(\)[\s\S]+pg_advisory_xact_lock_shared[\s\S]+for update[\s\S]+attendance_fact_mode/iu,
  )
  assert.match(
    migration,
    /create or replace function private\.attendance_write_resolution\([\s\S]+perform private\.require_attendance_resolution_update\(\)[\s\S]+pg_advisory_xact_lock_shared[\s\S]+return private\.attendance_write_resolution_with_review/iu,
  )
})

test('monthly payroll snapshots company cost and exact attendance method', () => {
  for (const column of [
    "attendance_method_snapshot text not null default 'project'",
    'company_personnel_cost numeric not null default 0',
    'location_abnormal_count integer not null default 0',
    "location_review_summary text not null default ''",
  ]) {
    assert.match(migration, new RegExp(`add column ${column}`, 'iu'))
  }
  assert.match(migration, /attendance_method_snapshot[\s\S]+project[\s\S]+general[\s\S]+exempt[\s\S]+mixed/iu)
  assert.match(
    migration,
    /attendance_month_counts[\s\S]+attendance_fact_mode[\s\S]+attendance_mode = 'exempt'[\s\S]+schedule_required[\s\S]+attendance_method_snapshot = 'project'/iu,
  )
  assert.match(
    migration,
    /attendance_company_personnel_cost[\s\S]+attendance_month_pay_units[\s\S]+round\(p_net_salary \* company_units \/ \(project_units \+ company_units\)\)/iu,
  )
  assert.match(migration, /company_personnel_cost[\s\S]+net_salary/iu)
  assert.match(migration, /'position'[\s\S]+employee\.position/iu)
  assert.match(
    migration,
    /attendance_fact_mode[\s\S]+project_attendance_sessions[\s\S]+attendance_mode = 'project'[\s\S]+attendance_mode = 'general'[\s\S]+attendance_policy_mode_at/iu,
  )
  assert.match(
    migration,
    /attendance_historical_month_method[\s\S]+attendance_fact_mode[\s\S]+generate_series[\s\S]+method_count > 1[\s\S]+mixed/iu,
  )
  assert.match(
    migration,
    /with historical_payroll as \([\s\S]+status = 'confirmed'[\s\S]+update public\.attendance_monthly_payrolls/iu,
  )
  assert.match(migration, /historical_payroll\.attendance_method[\s\S]+company_personnel_cost/iu)
})

test('audit snapshots carry review and company-payroll fields', () => {
  assert.match(migration, /attendance_resolution_snapshot[\s\S]+'locationReviewStatus'[\s\S]+'locationReviewedAt'/iu)
  assert.match(migration, /attendance_payroll_snapshot[\s\S]+'attendanceMethodSnapshot'[\s\S]+'companyPersonnelCost'[\s\S]+'locationReviewSummary'/iu)
  assert.match(migration, /recorded_abnormal[\s\S]+判定异常/iu)
  assert.match(migration, /confirmed_valid[\s\S]+确认有效/iu)
})

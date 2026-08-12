import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL('../../supabase/migrations/202608120001_department_attendance_modes.sql', import.meta.url),
  'utf8',
).catch(() => '')

test('department attendance migration is versioned and keeps v1 RPCs during rollout', () => {
  assert.match(migration, /add column attendance_required boolean not null default true/iu)
  assert.match(migration, /attendance_mode[^;]+project[^;]+general/isu)
  assert.match(migration, /create or replace function public\.get_my_today_attendance_v2_secure/iu)
  assert.match(migration, /create or replace function public\.clock_in_general_secure/iu)
  assert.doesNotMatch(migration, /drop function[^;]+get_my_today_attendance_secure/iu)
  assert.doesNotMatch(migration, /drop function[^;]+clock_in_project_secure/iu)
})

test('general attendance is structurally unable to carry project cost identity', () => {
  assert.match(migration, /attendance_session_mode_payload_check/iu)
  assert.match(migration, /attendance_mode = 'general'[\s\S]+project_id is null/iu)
  assert.match(migration, /result = 'not_applicable'[\s\S]+distance_meters is null/iu)
})

test('effective policy history and every clock writer share the employee lock boundary', () => {
  assert.match(migration, /create table public\.employee_attendance_policy_history/iu)
  assert.match(migration, /policy_version bigint generated always as identity/iu)
  assert.match(migration, /effective_from date not null/iu)
  assert.match(migration, /attendance policy history is append-only/iu)
  assert.match(migration, /attendance_policy_mode_at[\s\S]+effective_from <= p_work_date[\s\S]+policy_version desc/iu)
  for (const functionName of [
    'clock_in_general_secure',
    'clock_in_project_v2_secure',
    'clock_out_attendance_v2_secure',
  ]) {
    assert.match(
      migration,
      new RegExp(`${functionName}[\\s\\S]+hashtextextended\\(actor\\.id::text, 1\\)[\\s\\S]+for update[\\s\\S]+attendance_policy_mode_at`, 'iu'),
    )
  }
})

test('v1 remains project-only and fails closed for other effective policies', () => {
  assert.match(migration, /V1 remains a project-only compatibility boundary/iu)
  assert.match(migration, /get_my_today_attendance_secure[\s\S]+attendance_mode = 'project'/iu)
  assert.match(migration, /list_attendance_records_secure[\s\S]+item->>'projectId' is not null/iu)
  assert.match(migration, /clock_in_project_secure[\s\S]+attendance_policy_mode_at[\s\S]+project attendance policy required/iu)
  assert.match(migration, /clock_out_project_secure[\s\S]+attendance_policy_mode_at[\s\S]+project attendance policy required/iu)
})

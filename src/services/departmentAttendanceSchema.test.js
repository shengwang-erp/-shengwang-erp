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

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(
  new URL('../../supabase/migrations/202607150003_today_attendance.sql', import.meta.url),
  'utf8',
).catch(() => '')

const tables = [
  'project_attendance_sessions',
  'project_attendance_events',
  'project_attendance_work_points',
  'project_attendance_photos',
]

test('attendance schema is normalized, constrained and RPC-only', () => {
  for (const table of tables) {
    assert.match(sql, new RegExp(`create table public\\.${table}`, 'i'))
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
    assert.match(sql, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'))
  }
  assert.match(sql, /project_attendance_one_open_session_idx/i)
  assert.match(sql, /project_attendance_photo_active_phase_idx/i)
  assert.match(sql, /project_attendance_photo_pending_phase_idx/i)
  assert.match(sql, /create trigger reject_attendance_event_mutation/i)
  assert.doesNotMatch(sql, /create policy[^;]+on public\.project_attendance_/is)
})

test('attendance migration closes helpers and grants only secure entry points', () => {
  for (const helper of [
    'current_attendance_employee', 'is_attendance_project_eligible',
    'attendance_distance_meters', 'attendance_session_json',
  ]) assert.match(sql, new RegExp(`revoke all on function private\\.${helper}`, 'i'))
  for (const rpc of [
    'list_attendance_projects_secure',
    'get_my_today_attendance_secure',
    'clock_in_project_secure',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}`, 'i'))
    assert.match(sql, new RegExp(`grant execute on function public\\.${rpc}[^;]+to authenticated, service_role`, 'i'))
  }
  assert.doesNotMatch(sql, /module\.projects|module\.labor|labor_records|baseRecordService/i)
})

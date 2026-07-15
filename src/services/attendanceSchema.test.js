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

const migrationFunction = (qualifiedName) => sql.match(
  new RegExp(`create or replace function ${qualifiedName}\\b[\\s\\S]*?\\n\\$\\$;`, 'i'),
)?.[0] ?? ''

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

test('attendance eligibility requires an exactly active record envelope', () => {
  assert.match(sql, /p_record_status\s+is\s+distinct\s+from\s+'active'/i)
})

test('attendance viewer assignments require an exactly active project envelope', () => {
  for (const qualifiedName of [
    'private\\.current_attendance_viewer_scope',
    'public\\.can_current_employee_view_attendance_session',
  ]) {
    const functionSql = migrationFunction(qualifiedName)
    assert.match(functionSql, /project\.status\s*=\s*'active'/i)
    assert.doesNotMatch(functionSql, /project\.status\s*<>\s*'deleted'/i)
  }
})

test('attendance abnormal reasons share the POSIX-whitespace canonical rule', () => {
  assert.match(
    sql,
    /normalized_reason\s*:=\s*nullif\(\s*regexp_replace\(\s*p_abnormal_reason\s*,\s*'\^\[\[:space:\]\]\+\|\[\[:space:\]\]\+\$'\s*,\s*''\s*,\s*'g'\s*\)\s*,\s*''\s*\)/i,
  )
  assert.match(
    sql,
    /result\s*=\s*'abnormal'\s+and\s+abnormal_reason\s+is\s+not\s+null\s+and\s+abnormal_reason\s*=\s*regexp_replace\(\s*abnormal_reason\s*,\s*'\^\[\[:space:\]\]\+\|\[\[:space:\]\]\+\$'\s*,\s*''\s*,\s*'g'\s*\)/i,
  )
})

test('attendance photo RPCs and Storage rules are bucket-scoped', () => {
  for (const rpc of [
    'upsert_attendance_work_point_secure',
    'reserve_attendance_photo_secure',
    'finalize_attendance_photo_secure',
    'abandon_attendance_photo_secure',
    'clock_out_project_secure',
  ]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${rpc}`, 'i'))
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${rpc}[^;]+to authenticated, service_role`, 'i'),
    )
  }

  for (const predicate of [
    'can_current_employee_view_attendance_session',
    'can_current_employee_upload_attendance_photo',
    'can_current_employee_view_attendance_photo',
  ]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${predicate}`, 'i'))
    assert.match(sql, new RegExp(`revoke all on function public\\.${predicate}`, 'i'))
  }

  assert.match(sql, /insert into storage\.buckets/i)
  assert.match(sql, /'erp-attendance-photos'/)
  assert.match(sql, /20971520/)
  assert.match(sql, /attendance_photos_insert_guard/i)
  assert.match(sql, /attendance_photos_select_guard/i)
  assert.match(sql, /attendance_photos_update_deny/i)
  assert.match(sql, /attendance_photos_delete_deny/i)
  assert.doesNotMatch(sql, /delete from pg_policies|drop policy if exists (?!attendance_photos_)/i)
})

test('attendance Storage predicates revalidate the canonical owner path', () => {
  for (const qualifiedName of [
    'public\\.can_current_employee_upload_attendance_photo',
    'public\\.can_current_employee_view_attendance_photo',
  ]) {
    const functionSql = migrationFunction(qualifiedName)
    assert.match(functionSql, /session\.employee_profile_id::text/)
    assert.match(functionSql, /session\.session_id::text/)
    assert.match(functionSql, /point\.work_point_id::text/)
    assert.match(functionSql, /photo\.photo_id::text/)
    assert.match(functionSql, /photo\.phase/)
  }
})

test('clock-out requires one complete point and uses the session location snapshot', () => {
  assert.match(
    sql,
    /create or replace function public\.clock_out_project_secure\(\s*p_session_id uuid,\s*p_request_id uuid,\s*p_latitude double precision,\s*p_longitude double precision,\s*p_accuracy_meters numeric,\s*p_device_recorded_at timestamptz default null,\s*p_abnormal_reason text default null\s*\)/i,
  )
  assert.match(sql, /select exists\s*\([\s\S]+photo\.phase = 'before'[\s\S]+photo\.phase = 'after'[\s\S]+\) into has_complete_point/i)
  assert.match(sql, /session_row\.project_latitude_snapshot[\s\S]+session_row\.project_longitude_snapshot/i)
  assert.match(sql, /ATTENDANCE_COMPLETE_WORK_POINT_REQUIRED/)
  assert.doesNotMatch(sql, /count\([^)]*project_attendance_work_points[^;]+has_complete_point/is)
})

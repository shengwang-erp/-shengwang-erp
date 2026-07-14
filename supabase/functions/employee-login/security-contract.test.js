import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const MIGRATION_URL = new URL(
  '../../migrations/202607140002_employee_login_security.sql',
  import.meta.url,
)
const CONFIG_URL = new URL('../../config.toml', import.meta.url)
const ENV_URL = new URL('../../../.env.example', import.meta.url)
const LOGIN_INDEX_URL = new URL('./index.ts', import.meta.url)
const CHANGE_INDEX_URL = new URL('../employee-change-password/index.ts', import.meta.url)
const BOOTSTRAP_INDEX_URL = new URL('../employee-bootstrap-admin/index.ts', import.meta.url)

function readOptional(url) {
  try {
    return readFileSync(url, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

function functionConfigSection(source, functionName) {
  const escapedName = functionName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return source.match(
    new RegExp(`\\[functions\\.${escapedName}\\]([\\s\\S]*?)(?=\\n\\[|$)`, 'i'),
  )?.[1] ?? ''
}

test('atomic login reservation RPCs close the concurrent fifth-attempt window', () => {
  const sql = readOptional(MIGRATION_URL)

  for (
    const signature of [
      'begin_employee_login_attempt\\(text, text\\)',
      'finalize_employee_login_failure\\(bigint, text, text, text\\)',
      'complete_employee_login_success\\(bigint, text, text\\)',
      'cancel_employee_login_attempt\\(bigint, text, text\\)',
    ]
  ) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${signature} from public, anon, authenticated`,
        'i',
      ),
    )
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${signature} to service_role`, 'i'),
    )
  }

  const beginFunction = sql.match(
    /create or replace function public\.begin_employee_login_attempt[\s\S]*?\$\$;/i,
  )?.[0] ?? ''
  assert.match(beginFunction, /security definer/i)
  assert.match(beginFunction, /set search_path = pg_catalog, public/i)
  assert.match(beginFunction, /pg_advisory_xact_lock/i)
  assert.match(beginFunction, /interval '15 minutes'/i)
  assert.match(beginFunction, /failure_code[\s\S]*'PENDING'/i)
  assert.match(beginFunction, /failure_count[\s\S]*>= 5/i)
  assert.match(beginFunction, /locked_until[\s\S]*interval '15 minutes'/i)
  assert.match(beginFunction, /insert into public\.auth_login_attempts/i)
  assert.match(beginFunction, /select\s+true,\s+reserved_attempt_id/i)

  const finalizeFunction = sql.match(
    /create or replace function public\.finalize_employee_login_failure[\s\S]*?\$\$;/i,
  )?.[0] ?? ''
  assert.match(finalizeFunction, /pg_advisory_xact_lock/i)
  assert.match(finalizeFunction, /id = p_attempt_id/i)
  assert.match(finalizeFunction, /failure_code = 'PENDING'/i)
  assert.match(finalizeFunction, /attempted_at = event_time/i)
  assert.match(finalizeFunction, /failure_code = p_failure_code/i)

  const successFunction = sql.match(
    /create or replace function public\.complete_employee_login_success[\s\S]*?\$\$;/i,
  )?.[0] ?? ''
  assert.match(successFunction, /pg_advisory_xact_lock/i)
  assert.match(successFunction, /succeeded = true/i)
  assert.match(successFunction, /attempted_at = event_time/i)
  assert.match(successFunction, /failure_code = 'PENDING'[\s\S]*locked_until = null/i)

  const cancelFunction = sql.match(
    /create or replace function public\.cancel_employee_login_attempt[\s\S]*?\$\$;/i,
  )?.[0] ?? ''
  assert.match(cancelFunction, /pg_advisory_xact_lock/i)
  assert.match(cancelFunction, /delete from public\.auth_login_attempts/i)
  assert.match(cancelFunction, /id = p_attempt_id/i)
  assert.match(cancelFunction, /failure_code = 'PENDING'/i)
})

test('password completion is service-role-only and targets one verified Auth id', () => {
  const sql = readOptional(MIGRATION_URL)
  const functionSql = sql.match(
    /create or replace function public\.complete_employee_password_change[\s\S]*?\$\$;/i,
  )?.[0] ?? ''

  assert.match(functionSql, /p_auth_user_id uuid/i)
  assert.match(functionSql, /security definer/i)
  assert.match(functionSql, /set search_path = pg_catalog, public/i)
  assert.match(functionSql, /auth\.role\(\) is distinct from 'service_role'/i)
  assert.match(functionSql, /auth_user_id = p_auth_user_id/i)
  assert.match(functionSql, /employment_status = '在职'/i)
  assert.match(functionSql, /account_status = 'active'/i)
  assert.match(functionSql, /deleted_at is null/i)
  assert.match(functionSql, /must_change_password = false/i)
  assert.match(
    sql,
    /revoke all on function public\.complete_employee_password_change\(uuid\) from public, anon, authenticated/i,
  )
  assert.match(
    sql,
    /grant execute on function public\.complete_employee_password_change\(uuid\) to service_role/i,
  )
  assert.doesNotMatch(
    sql,
    /grant execute on function public\.complete_employee_password_change\(uuid\) to authenticated/i,
  )
})

test('login-attempt retention has an index and a service-role-only purge operation', () => {
  const sql = readOptional(MIGRATION_URL)

  assert.match(
    sql,
    /create index if not exists auth_login_attempts_retention_idx[\s\S]*attempted_at/i,
  )
  assert.match(sql, /create or replace function public\.purge_expired_employee_login_attempts/i)
  assert.match(sql, /delete from public\.auth_login_attempts[\s\S]*attempted_at < p_before/i)
  assert.match(
    sql,
    /grant execute on function public\.purge_expired_employee_login_attempts\(timestamptz\) to service_role/i,
  )
})

test('thin Deno indexes use shared CORS and the correct handler boundary', () => {
  const contracts = [
    [readOptional(LOGIN_INDEX_URL), /createEmployeeLoginHandler/],
    [readOptional(CHANGE_INDEX_URL), /createEmployeeChangePasswordHandler/],
    [readOptional(BOOTSTRAP_INDEX_URL), /createEmployeeBootstrapAdminHandler/],
  ]

  for (const [source, handlerPattern] of contracts) {
    assert.match(source, /Deno\.serve/)
    assert.match(source, /withCors/)
    assert.match(source, handlerPattern)
    assert.doesNotMatch(source, /console\.|SUPABASE_SERVICE_ROLE_KEY|SW000_BOOTSTRAP_PASSWORD/)
  }
})

test('only login and secret-key bootstrap disable gateway JWT verification', () => {
  const config = readOptional(CONFIG_URL)

  assert.match(functionConfigSection(config, 'employee-login'), /verify_jwt\s*=\s*false/i)
  assert.match(functionConfigSection(config, 'employee-change-password'), /verify_jwt\s*=\s*true/i)
  assert.match(functionConfigSection(config, 'employee-bootstrap-admin'), /verify_jwt\s*=\s*false/i)
  assert.doesNotMatch(config, /\[functions\]\s*[\s\S]*?verify_jwt\s*=\s*false/i)
})

test('environment example lists browser and server variables with blank values only', () => {
  const source = readOptional(ENV_URL)
  const requiredNames = [
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_URL',
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEYS',
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AUTH_ID_DERIVATION_SECRET',
    'LOGIN_RATE_LIMIT_SECRET',
    'CORS_ALLOWED_ORIGINS',
    'SW000_BOOTSTRAP_PASSWORD',
  ]

  for (const name of requiredNames) {
    assert.match(source, new RegExp(`^${name}=$`, 'm'))
  }
  for (const line of source.split(/\r?\n/u)) {
    if (!line || line.startsWith('#')) continue
    assert.match(line, /^[A-Z0-9_]+=$/u)
  }
  assert.doesNotMatch(source, /^VITE_.*(?:SECRET|SERVICE_ROLE|BOOTSTRAP|DERIVATION|RATE_LIMIT)/im)
})

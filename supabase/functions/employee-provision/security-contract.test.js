import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../migrations/202607140003_employee_account_lifecycle.sql',
  import.meta.url,
)
const configUrl = new URL('../../config.toml', import.meta.url)

test('lifecycle migration exposes only guarded service-role RPCs', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const rpcNames = [
    'claim_employee_provisioning',
    'renew_employee_provisioning_owner',
    'record_employee_provisioning_auth',
    'complete_employee_provisioning',
    'prepare_employee_provisioning_compensation',
    'complete_employee_provisioning_compensation',
    'get_employee_admin_target',
    'update_employee_profile_admin',
    'disable_employee_account_admin',
    'activate_employee_account_admin',
    'claim_employee_password_reset',
    'renew_employee_password_reset_owner',
    'complete_employee_password_reset',
  ]

  for (const name of rpcNames) {
    assert.match(
      sql,
      new RegExp(`create or replace function public\\.${name}\\(`, 'i'),
    )
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${name}\\(`, 'i'),
    )
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${name}\\([^;]+service_role`,
        'is',
      ),
    )
  }
  assert.ok((sql.match(/security definer/gi) || []).length >= rpcNames.length)
  assert.ok(
    (sql.match(
      /set search_path = pg_catalog, public(?:, private)?(?:, auth)?/gi,
    ) || []).length >=
      rpcNames.length,
  )
  assert.ok(
    (sql.match(/auth\.role\(\) is distinct from 'service_role'/gi) || [])
      .length >= rpcNames.length,
  )
  assert.doesNotMatch(sql, /grant execute[^;]+\b(?:anon|authenticated)\b/is)
  assert.doesNotMatch(
    sql,
    /\btruncate\b|delete\s+from\s+public\.employee_profiles/iu,
  )
})

test('provisioning state stores ownership and Auth identity but no plaintext credential', async () => {
  const sql = await readFile(migrationUrl, 'utf8')

  assert.match(sql, /add column if not exists owner_token uuid/i)
  assert.match(sql, /add column if not exists owner_expires_at timestamptz/i)
  assert.match(sql, /add column if not exists auth_user_id_snapshot uuid/i)
  assert.match(sql, /add column if not exists employee_profile_id uuid/i)
  assert.match(sql, /pg_advisory_xact_lock/i)
  assert.match(sql, /compensation_pending/i)
  assert.match(
    sql,
    /create table if not exists public\.employee_password_reset_requests/i,
  )
  assert.doesNotMatch(
    sql,
    /(?:initial_password|temporary_password|plaintext_password|password)\s+(?:text|varchar)/i,
  )
})

test('both lifecycle functions retain gateway JWT verification', async () => {
  const config = await readFile(configUrl, 'utf8')

  assert.match(
    config,
    /\[functions\.employee-provision\]\s*verify_jwt\s*=\s*true/i,
  )
  assert.match(config, /\[functions\.employee-admin\]\s*verify_jwt\s*=\s*true/i)
})

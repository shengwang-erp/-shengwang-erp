import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const MIGRATION_URL = new URL(
  '../../migrations/202607140004_permission_templates.sql',
  import.meta.url,
)
const CONFIG_URL = new URL('../../config.toml', import.meta.url)
const INDEX_URL = new URL('./index.ts', import.meta.url)

function readOptional(url) {
  try {
    return readFileSync(url, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

test('permission template RPCs are service-role-only security definers with fresh actor checks', () => {
  const sql = readOptional(MIGRATION_URL)
  for (
    const [name, declaration, signature] of [
      [
        'read_permission_templates_admin',
        '\\(\\s*p_actor_auth_user_id uuid\\s*\\)',
        'read_permission_templates_admin\\(uuid\\)',
      ],
      [
        'replace_permission_template_admin',
        '\\(\\s*p_subject_type text,\\s*p_subject_code text,\\s*p_permission_keys text\\[\\],\\s*p_actor_auth_user_id uuid\\s*\\)',
        'replace_permission_template_admin\\(text, text, text\\[\\], uuid\\)',
      ],
    ]
  ) {
    assert.match(
      sql,
      new RegExp(
        `create or replace function public\\.${name}${declaration}`,
        'i',
      ),
    )
    assert.match(
      sql,
      new RegExp(
        `revoke all on function public\\.${signature}\\s+from public, anon, authenticated`,
        'i',
      ),
    )
    assert.match(
      sql,
      new RegExp(
        `grant execute on function public\\.${signature}\\s+to service_role`,
        'i',
      ),
    )
  }
  assert.ok((sql.match(/security definer/gi) ?? []).length >= 2)
  assert.ok(
    (sql.match(/set search_path = pg_catalog, public, private/gi) ?? [])
      .length >= 2,
  )
  assert.ok(
    (sql.match(/auth\.role\(\) is distinct from 'service_role'/gi) ?? [])
      .length >= 2,
  )
  assert.ok(
    (sql.match(/assert_employee_profile_write_authorized/gi) ?? []).length >= 2,
  )
  assert.doesNotMatch(sql, /grant execute[^;]+\b(?:anon|authenticated)\b/is)
})

test('replace validates fixed subjects and closed permissions, then atomically audits one replacement', () => {
  const sql = readOptional(MIGRATION_URL)
  const replaceFunction = sql.match(
    /create or replace function public\.replace_permission_template_admin[\s\S]*?\$\$;/i,
  )?.[0] ?? ''

  for (const subject of ['总务部', '财务部', '社长', '会计']) {
    assert.match(replaceFunction, new RegExp(subject, 'u'))
  }
  for (
    const permission of [
      'module.owner_dashboard.view',
      'module.settings.delete',
      'sensitive.salary_view',
      'sensitive.owner_dashboard_full_view',
    ]
  ) {
    assert.match(
      replaceFunction,
      new RegExp(permission.replaceAll('.', '\\.'), 'u'),
    )
  }
  assert.match(replaceFunction, /cardinality\(p_permission_keys\)/i)
  assert.match(replaceFunction, /count\(distinct permission_key\)/i)
  assert.match(replaceFunction, /delete from public\.permission_grants/i)
  assert.match(replaceFunction, /insert into public\.permission_grants/i)
  assert.match(replaceFunction, /insert into public\.employee_security_audit/i)
  assert.match(replaceFunction, /permission_template\.replaced/i)
  assert.doesNotMatch(
    replaceFunction,
    /module\.permission_templates\.(?:view|update)|'all'/i,
  )
  assert.doesNotMatch(replaceFunction, /\bcommit\b|\brollback\b/i)
})

test('read builds an exact complete snapshot from fixed departments and positions', () => {
  const sql = readOptional(MIGRATION_URL)

  assert.match(sql, /jsonb_build_object\(\s*'departments'/i)
  assert.match(sql, /'positions'/i)
  assert.match(sql, /jsonb_agg\([^)]*order by[^)]*permission_key/i)
  assert.match(sql, /coalesce\([^;]*'\[\]'::jsonb/is)
  assert.doesNotMatch(sql, /subject_type\s*=\s*'employee'/i)
})

test('thin Edge index uses shared CORS and gateway JWT verification stays enabled', () => {
  const index = readOptional(INDEX_URL)
  const config = readOptional(CONFIG_URL)

  assert.match(index, /Deno\.serve/)
  assert.match(index, /withCors/)
  assert.match(index, /createPermissionTemplatesHandler/)
  assert.doesNotMatch(index, /console\.|SUPABASE_SERVICE_ROLE_KEY/)
  assert.match(
    config,
    /\[functions\.permission-templates\]\s*verify_jwt\s*=\s*true/i,
  )
})

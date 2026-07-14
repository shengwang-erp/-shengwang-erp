import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { DEPARTMENT_OPTIONS, POSITION_OPTIONS } from '../auth/employeeAuthDomain.js'

const MIGRATION_URL = new URL(
  '../../supabase/migrations/202607140001_employee_auth.sql',
  import.meta.url,
)
const BOOTSTRAP_URL = new URL('../../docs/supabase-schema.sql', import.meta.url)
const LEGACY_CONTRACT_MIGRATION_URL = new URL(
  '../../docs/migrations/2026-07-14-contract-revenue-chain.sql',
  import.meta.url,
)
const DATABASE_TEST_URL = new URL('../../supabase/tests/employee_auth.sql', import.meta.url)
const CONFIG_URL = new URL('../../supabase/config.toml', import.meta.url)

const SECURITY_TABLES = [
  'employee_profiles',
  'employee_provisioning_requests',
  'permission_grants',
  'auth_login_attempts',
  'employee_security_audit',
]

const TEMPLATE_MODULE_CODES = [
  'owner_dashboard',
  'projects',
  'employees',
  'labor',
  'purchases',
  'inventory',
  'tools',
  'vehicles',
  'accounting',
  'salaries',
  'project_costs',
  'operating_expenses',
  'settings',
]

const TEMPLATE_SENSITIVE_CODES = [
  'salary_view',
  'salary_update',
  'contract_amount_view',
  'contract_amount_update',
  'profit_view',
  'purchase_payments_view',
  'purchase_payments_update',
  'employee_identity_view',
  'employee_identity_update',
  'owner_dashboard_full_view',
]

const BUSINESS_TABLE_PERMISSIONS = {
  projects: 'projects',
  project_contract_changes: 'projects',
  project_payment_plans: 'projects',
  project_receipts: 'projects',
  labor_records: 'labor',
  purchase_records: 'purchases',
  purchase_payment_records: 'purchases',
  inventory_items: 'inventory',
  stock_in_records: 'inventory',
  stock_out_records: 'inventory',
  stock_return_records: 'inventory',
  tool_records: 'tools',
  tool_borrow_records: 'tools',
  tool_return_records: 'tools',
  lifelong_tool_assignments: 'tools',
  tool_responsibility_records: 'tools',
  vehicle_records: 'vehicles',
  vehicle_usage_records: 'vehicles',
  fuel_records: 'vehicles',
  vehicle_expense_records: 'vehicles',
  vehicle_issue_records: 'vehicles',
  salary_records: 'salaries',
  project_cost_records: 'project_costs',
  operating_expense_records: 'operating_expenses',
}

function readOptional(url) {
  try {
    return readFileSync(url, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function migrationSql() {
  return readOptional(MIGRATION_URL)
}

test('employee auth migration creates every normalized security table with RLS', () => {
  const sql = migrationSql()

  for (const tableName of SECURITY_TABLES) {
    assert.match(sql, new RegExp(`create table public\\.${tableName}\\b`, 'i'))
    assert.match(
      sql,
      new RegExp(`alter table public\\.${tableName} enable row level security`, 'i'),
    )
  }
})

test('employee numbers are idempotently reserved from SW-001 by service role only', () => {
  const sql = migrationSql()

  assert.match(
    sql,
    /create sequence public\.employee_number_sequence[\s\S]*start with 1[\s\S]*increment by 1/i,
  )
  assert.match(
    sql,
    /create or replace function public\.reserve_employee_number\(p_request_id uuid\)/i,
  )
  assert.match(sql, /pg_advisory_xact_lock/i)
  assert.match(sql, /nextval\('public\.employee_number_sequence'/i)
  assert.match(sql, /greatest\(3,\s*length\(/i)
  assert.match(sql, /where request_id = p_request_id/i)
  assert.match(
    sql,
    /revoke all on function public\.reserve_employee_number\(uuid\) from public, anon, authenticated/i,
  )
  assert.match(
    sql,
    /grant execute on function public\.reserve_employee_number\(uuid\) to service_role/i,
  )
  assert.doesNotMatch(sql, /nextval\([^\n]+SW-000/i)
})

test('employee number is immutable and fixed department and position values match the domain', () => {
  const sql = migrationSql()

  assert.match(sql, /before update of employee_number on public\.employee_profiles/i)
  assert.match(sql, /old\.employee_number is distinct from new\.employee_number/i)
  assert.match(sql, /employee_number cannot be changed/i)

  for (const option of [...DEPARTMENT_OPTIONS, ...POSITION_OPTIONS]) {
    assert.match(sql, new RegExp(`'${escapeRegExp(option)}'`))
  }
  assert.doesNotMatch(sql, /'现场'|'仓库'|'超级管理员'/)
})

test('business access requires active employed changed-password accounts', () => {
  const sql = migrationSql()

  assert.match(
    sql,
    /create or replace function public\.is_current_employee_active\(\)[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/i,
  )
  assert.match(sql, /employment_status = '在职'/)
  assert.match(sql, /account_status = 'active'/)
  assert.match(sql, /must_change_password = false/)
  assert.match(sql, /auth_user_id = auth\.uid\(\)/)
  assert.match(sql, /deleted_at is null/)
})

test('permission grants use stable keys and union department plus position templates', () => {
  const sql = migrationSql()

  assert.match(sql, /permission_key text not null[\s\S]*'module\.projects\.view'/i)
  assert.match(sql, /'sensitive\.employee_identity_view'/i)
  assert.match(sql, /subject_type = 'department'[\s\S]*subject_code = employee\.department/i)
  assert.match(sql, /subject_type = 'position'[\s\S]*subject_code = employee\.position/i)
  assert.match(sql, /employee_number = 'SW-000'[\s\S]*array\['all'\]/i)
  assert.match(sql, /position = '社长'/)
  for (const fixedPermission of [
    'module.employees.view',
    'module.employees.create',
    'module.employees.update',
    'module.employees.delete',
    'module.permission_templates.view',
    'module.permission_templates.update',
  ]) {
    assert.match(sql, new RegExp(`'${escapeRegExp(fixedPermission)}'`))
  }
  assert.doesNotMatch(sql, /position = '社长'[\s\S]{0,300}module\.projects\./i)
})

test('permission templates accept only the closed 62-key catalog', () => {
  const sql = migrationSql()
  const catalogConstraint = sql.match(
    /create table public\.permission_grants \([\s\S]*?permission_key text not null([\s\S]*?)created_at timestamptz/i,
  )?.[1] ?? ''

  for (const moduleCode of TEMPLATE_MODULE_CODES) {
    for (const action of ['view', 'create', 'update', 'delete']) {
      assert.match(
        catalogConstraint,
        new RegExp(`'module\\.${moduleCode}\\.${action}'`),
      )
    }
  }
  for (const sensitiveCode of TEMPLATE_SENSITIVE_CODES) {
    assert.match(catalogConstraint, new RegExp(`'sensitive\\.${sensitiveCode}'`))
  }
  assert.match(catalogConstraint, /check \(permission_key in \(/i)
  assert.doesNotMatch(catalogConstraint, /module\.permission_templates|'all'/)
})

test('every business table maps to strict authenticated action policies', () => {
  const sql = migrationSql()

  for (const [tableName, moduleCode] of Object.entries(BUSINESS_TABLE_PERMISSIONS)) {
    assert.match(
      sql,
      new RegExp(`\\('${tableName}',\\s*'${moduleCode}',`, 'i'),
      `${tableName} must map to module.${moduleCode}`,
    )
  }

  for (const action of ['view', 'create', 'update', 'delete']) {
    assert.match(sql, new RegExp(`module\\.%s\\.${action}`))
  }
  assert.match(sql, /to authenticated/i)
  assert.match(sql, /public\.is_current_employee_active\(\)/i)
  assert.match(sql, /public\.has_current_permission\(/i)
  assert.match(
    sql,
    /revoke all on table public\.%I from public, anon, authenticated/i,
  )
  assert.match(sql, /grant all on table public\.%I to service_role/i)
  assert.match(sql, /for insert to authenticated[\s\S]{0,260}status = ''active''/i)
})

test('soft delete and void transitions require delete instead of update permission', () => {
  const sql = migrationSql()

  assert.match(
    sql,
    /create or replace function public\.enforce_business_status_permission\(\)/i,
  )
  assert.match(sql, /old\.status[\s\S]*new\.status[\s\S]*\('deleted',\s*'void'\)/i)
  assert.match(sql, /module\.%s\.delete/i)
  assert.match(sql, /module\.%s\.update/i)
  assert.match(sql, /before update on public\.%I/i)
})

test('sensitive business records require their sensitive permission in addition to module access', () => {
  const sql = migrationSql()

  for (const [tableName, permissionCode] of [
    ['projects', 'contract_amount'],
    ['project_contract_changes', 'contract_amount'],
    ['project_payment_plans', 'contract_amount'],
    ['project_receipts', 'contract_amount'],
    ['labor_records', 'salary'],
    ['purchase_records', 'purchase_payments'],
    ['purchase_payment_records', 'purchase_payments'],
    ['salary_records', 'salary'],
  ]) {
    assert.match(
      sql,
      new RegExp(`\\('${tableName}',\\s*'[^']+',\\s*'${permissionCode}'\\)`, 'i'),
      `${tableName} must map to sensitive.${permissionCode}_view/update`,
    )
  }
  assert.match(sql, /sensitive\.%s_view/i)
  assert.match(sql, /sensitive\.%s_update/i)
})

test('browser roles cannot hard-delete business records', () => {
  const sql = migrationSql()

  assert.match(
    sql,
    /revoke all on table public\.%I from public, anon, authenticated/i,
  )
  assert.doesNotMatch(sql, /grant select, insert, update, delete on table public\.%I to authenticated/i)
  assert.doesNotMatch(sql, /create policy %I on public\.%I for delete to authenticated/i)
})

test('policy replacement enumerates the catalog so unknown permissive policies cannot survive', () => {
  const migration = migrationSql()
  const standaloneMigration = readOptional(LEGACY_CONTRACT_MIGRATION_URL)
  const catalogCleanupPattern =
    /for existing_policy in[\s\S]*from pg_catalog\.pg_policies[\s\S]*schemaname = 'public'[\s\S]*tablename = target_table[\s\S]*drop policy if exists %I on public\.%I/i

  assert.match(migration, catalogCleanupPattern)
  assert.match(standaloneMigration, catalogCleanupPattern)
  assert.match(
    standaloneMigration,
    /revoke all on table public\.%I from public, anon, authenticated/i,
  )
  assert.match(migration, /select public\.create_erp_record_table\('employees'\)/i)
  for (const tableName of Object.keys(BUSINESS_TABLE_PERMISSIONS)) {
    assert.match(
      migration,
      new RegExp(`select public\\.create_erp_record_table\\('${tableName}'\\)`, 'i'),
    )
  }
  assert.doesNotMatch(migration, /drop policy if exists[^\n]*prototype/i)
  assert.doesNotMatch(standaloneMigration, /drop policy if exists[^\n]*prototype/i)
})

test('legacy employees and normalized security tables deny browser table access', () => {
  const sql = migrationSql()

  assert.match(
    sql,
    /revoke all on table public\.employees from public, anon, authenticated/i,
  )
  for (const tableName of SECURITY_TABLES) {
    assert.match(
      sql,
      new RegExp(
        `revoke all on table public\\.${tableName} from public, anon, authenticated`,
        'i',
      ),
    )
  }
})

test('temporary and trigger helpers do not retain default browser execution', () => {
  const sql = migrationSql()

  assert.match(sql, /drop function public\.create_erp_record_table\(text\)/i)
  for (const signature of [
    'set_updated_at\\(\\)',
    'protect_employee_number\\(\\)',
    'protect_hidden_system_employee\\(\\)',
    'enforce_business_status_permission\\(\\)',
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated`, 'i'),
    )
  }
})

test('current profile and directory RPCs expose safe fields only', () => {
  const sql = migrationSql()
  const profileSignature = sql.match(
    /create or replace function public\.current_employee_profile\(\)([\s\S]*?)language plpgsql/i,
  )?.[1] ?? ''

  assert.match(profileSignature, /"effectivePermissionKeys" text\[\]/)
  assert.doesNotMatch(
    profileSignature,
    /auth_user_id|passport|residence_card|base_salary|daily_salary|hourly_wage|wecom/i,
  )
  assert.match(sql, /create or replace function public\.employee_directory\(\)/i)
  assert.match(sql, /is_hidden_system_account = false/i)
  assert.match(sql, /create or replace function public\.employee_profile_detail\(p_employee_id uuid\)/i)
  assert.match(sql, /sensitive\.employee_identity_view/i)
  assert.match(sql, /sensitive\.salary_view/i)
})

test('bootstrap and legacy SQL never recreate open prototype policies or plaintext admin seed', () => {
  const sqlFiles = [
    migrationSql(),
    readOptional(BOOTSTRAP_URL),
    readOptional(LEGACY_CONTRACT_MIGRATION_URL),
  ]

  for (const sql of sqlFiles) {
    assert.doesNotMatch(sql, /create policy[\s\S]{0,240}using\s*\(true\)/i)
    assert.doesNotMatch(sql, /create policy[\s\S]{0,240}with check\s*\(true\)/i)
    assert.doesNotMatch(sql, /320086|passwordHash|SUPER_ADMIN/i)
  }

  const bootstrap = sqlFiles[1]
  assert.match(bootstrap, /create table public\.employee_profiles/i)
  assert.match(bootstrap, /create or replace function public\.has_current_permission\(p_permission_key text\)/i)
})

test('Supabase config and executable pgTAP contract cover the security behavior', () => {
  const config = readOptional(CONFIG_URL)
  const sqlTest = readOptional(DATABASE_TEST_URL)

  assert.match(config, /project_id\s*=\s*"shengwang-erp"/)
  assert.match(sqlTest, /select plan\(/i)
  for (const behavior of [
    'SW-001',
    'immutable',
    'department',
    'position',
    'permission union',
    'SW-000',
    'anon',
    'disabled',
    'must change password',
    'unknown policy names',
    'policy commands are exactly',
    'SW-000 cannot be deleted',
    'SW-000 hidden state cannot be changed',
    'SW-000 active state cannot be changed',
  ]) {
    assert.match(sqlTest, new RegExp(escapeRegExp(behavior), 'i'))
  }
})

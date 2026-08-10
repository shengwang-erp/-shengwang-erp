import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL(
  '../../supabase/migrations/202608100001_project_reference_access.sql',
  import.meta.url,
), 'utf8').catch(() => '')

test('project reference RPC exposes only a minimal relation DTO with closed grants', () => {
  assert.match(sql, /create or replace function public\.list_project_references_secure\(\)/i)
  assert.match(sql, /security definer[\s\S]*set search_path\s*=\s*''/i)
  for (const key of ['projectId', 'projectName', 'status', 'address']) {
    assert.match(sql, new RegExp(`'${key}'`, 'i'))
  }
  for (const forbidden of ['contractAmount', 'customerName', 'remark', 'latitude', 'longitude']) {
    assert.doesNotMatch(sql, new RegExp(`'${forbidden}'`, 'i'))
  }
  assert.match(
    sql,
    /revoke all on function public\.list_project_references_secure\(\)\s+from public, anon, authenticated, service_role/i,
  )
  assert.match(
    sql,
    /grant execute on function public\.list_project_references_secure\(\)\s+to authenticated, service_role/i,
  )
})

test('project reference RPC requires active employee and exact relation permission chains', () => {
  assert.match(sql, /public\.is_current_employee_active\(\)/i)
  for (const key of [
    'module.projects.view', 'module.purchases.view', 'module.accounting.view',
    'module.project_costs.view', 'module.operating_expenses.view', 'module.vehicles.view',
    'module.tools.view', 'module.tools.update',
  ]) assert.match(sql, new RegExp(`'${key.replaceAll('.', '\\.')}'`, 'i'), key)
  assert.match(
    sql,
    /has_current_permission\('module\.tools\.view'\)[\s\S]{0,180}and[\s\S]{0,80}has_current_permission\('module\.tools\.update'\)/i,
  )
})

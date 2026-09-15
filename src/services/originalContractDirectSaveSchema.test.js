import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrls = [
  '../../supabase/migrations/202609150002_original_contract_direct_save.sql',
  '../../supabase/migrations/202609150003_original_contract_data_guards.sql',
  '../../supabase/migrations/202609150004_revenue_project_write_lock.sql',
].map((path) => new URL(path, import.meta.url))
const migration = (
  await Promise.all(
    migrationUrls.map((url) => readFile(url, 'utf8').catch(() => '')),
  )
).join('\n')

test('database payment-plan gate requires a complete saved contract rather than accounting confirmation', () => {
  assert.match(migration, /private\.project_has_valid_saved_contract\(p_payload jsonb\)/u)
  assert.match(migration, /contractRevenueSetupStatus[\s\S]*configured/u)
  for (const field of [
    'originalContractTaxExclusiveAmount',
    'originalContractTaxRate',
    'originalContractTaxAmount',
    'originalContractTaxInclusiveAmount',
  ]) {
    assert.match(migration, new RegExp(field))
  }
  assert.match(
    migration,
    /tax_inclusive_amount\s*=\s*tax_exclusive_amount\s*\+\s*tax_amount/u,
  )
  assert.match(
    migration,
    /abs\(tax_exclusive_amount\s*-\s*round\(tax_inclusive_amount\s*\/\s*\(1\s*\+\s*tax_rate\s*\/\s*100\)\)\)\s*<=\s*1/u,
  )
  assert.match(migration, /9007199254740991/u)
  assert.match(migration, /original contract with revenue activity cannot be changed directly/u)
  assert.match(migration, /saved original contract cannot be cleared/u)
  const planRpc = migration.match(
    /create or replace function public\.replace_project_payment_plan_secure[\s\S]*?\$\$;/u,
  )?.[0] || ''
  assert.match(planRpc, /private\.project_has_valid_saved_contract\(project_payload\)/u)
  assert.doesNotMatch(planRpc, /contractConfirmationStatus|confirmed original contract required/u)
})

test('replacement RPC preserves permission, atomicity, and received-plan protections', () => {
  assert.match(
    migration,
    /replace_project_payment_plan_secure\(\s*p_project_id text,\s*p_plans jsonb\s*\)/u,
  )
  assert.match(migration, /module\.projects\.update/u)
  assert.match(migration, /can_current_employee_view_project_financials/u)
  assert.match(migration, /for update/u)
  assert.match(migration, /received payment plan cannot be deleted/u)
  assert.match(migration, /received payment plan amount and allocation weight are locked/u)
  assert.match(migration, /payment plan amounts must equal adjusted contract amount/u)
  assert.match(migration, /payment plan belongs to another project/u)
  assert.match(migration, /where coalesce\(public\.project_payment_plans\.payload->>'projectId', ''\) = p_project_id/u)
  assert.match(migration, /if not found then[\s\S]*payment plan belongs to another project/u)
})

test('all revenue writes lock the owning project and cannot move between projects', () => {
  assert.match(migration, /private\.lock_revenue_project_row\(\)/u)
  const lockTrigger = migration.match(
    /create or replace function private\.lock_revenue_project_row[\s\S]*?\$\$;/u,
  )?.[0] || ''
  assert.match(
    migration,
    /from public\.projects as project[\s\S]*for update/u,
  )
  assert.match(migration, /revenue record project cannot be changed/u)
  assert.match(lockTrigger, /not private\.project_has_valid_saved_contract\(project_payload\)/u)
  for (const triggerName of [
    'project_contract_changes_lock_project',
    'project_payment_plans_lock_project',
    'project_receipts_lock_project',
  ]) {
    assert.match(migration, new RegExp(triggerName))
  }
})

test('first contract save is blocked by existing activity while historical migration stays atomic', () => {
  const guard = migration.match(
    /create or replace function private\.enforce_saved_original_contract_guard[\s\S]*?\$\$;/u,
  )?.[0] || ''
  assert.match(guard, /if \(\s*exists \(/u)
  assert.doesNotMatch(
    guard,
    /if old\.payload->>'contractRevenueSetupStatus' = 'configured'\s+and \(/u,
  )

  const legacyMigration = migration.match(
    /create or replace function public\.migrate_legacy_project_contract_secure[\s\S]*?\$\$;/u,
  )?.[0] || ''
  const contractUpdatePosition = legacyMigration.indexOf('update public.projects')
  const openingReceiptPosition = legacyMigration.indexOf('insert into public.project_receipts')
  assert.ok(contractUpdatePosition >= 0)
  assert.ok(openingReceiptPosition > contractUpdatePosition)
})

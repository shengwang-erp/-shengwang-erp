import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL(
  '../../supabase/migrations/202607150001_project_core_security.sql',
  import.meta.url,
), 'utf8').catch(() => '')

test('project access is RPC-only and financial authorization is fixed', () => {
  assert.match(sql, /can_current_employee_view_project_financials/)
  assert.match(sql, /list_projects_secure/)
  assert.match(sql, /create_project_secure/)
  assert.match(sql, /update_project_secure/)
  assert.match(sql, /soft_delete_project_secure/)
  assert.match(sql, /migrate_legacy_project_contract_secure/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(
    sql,
    /returns text[\s\S]*soft_delete_project_secure|soft_delete_project_secure[\s\S]*returns text/,
  )
  assert.match(
    sql,
    /revoke all on table public\.projects from public, anon, authenticated/i,
  )
  assert.doesNotMatch(
    sql,
    /has_current_permission\('sensitive\.contract_amount_(view|update)'\)/i,
  )
  assert.match(sql, /department in \('设计部', '财务部'\)/)
  assert.match(sql, /position = '社长'/)
  assert.match(sql, /employee_number = 'SW-000'/)
  assert.match(
    sql,
    /revoke all on function private\.project_financial_payload_keys\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  )
  assert.match(
    sql,
    /revoke all on function private\.next_project_record_key\(\)[\s\S]*from public, anon, authenticated, service_role/i,
  )
  assert.match(
    sql,
    /revoke all on function private\.validate_project_payload\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/i,
  )
  assert.match(
    sql,
    /revoke all on function public\.can_current_employee_view_project_financials\(\) from public, anon/i,
  )
  assert.match(
    sql,
    /grant execute on function public\.can_current_employee_view_project_financials\(\) to authenticated, service_role/i,
  )
})

test('the financial projection key set is exhaustive and update preserves payloads', () => {
  const requiredFinancialKeys = [
    'contractAmount', 'paidAmount', 'paymentProgress', 'paymentStatus',
    'revenuePaymentStatus', 'contractRevenueSchemaVersion',
    'contractRevenueSetupStatus', 'contractConfirmationStatus',
    'originalContractTaxExclusiveAmount', 'originalContractTaxRate',
    'originalContractTaxAmount', 'originalContractTaxInclusiveAmount',
    'contractConfirmedById', 'contractConfirmedByName', 'contractConfirmedAt',
    'needsManualReview', 'adjustedTaxExclusiveAmount', 'adjustedTaxAmount',
    'adjustedTaxInclusiveAmount', 'totalReceivedTaxInclusiveAmount',
    'outstandingTaxInclusiveAmount', 'overpaidTaxInclusiveAmount',
    'profitAnchorTaxExclusiveAmount', 'allocationStatus', 'allocationReason',
    'lockedStages', 'unlockedStages', 'lockedPlannedTaxInclusiveAmount',
    'remainingAssignableTaxInclusiveAmount', 'unallocatedTaxInclusiveAmount',
    'lockedAmountExcess',
  ]

  for (const key of requiredFinancialKeys) {
    assert.match(sql, new RegExp(`'${key}'`), `missing financial key ${key}`)
  }
  assert.match(sql, /current_payload\s*\|\|\s*p_patch/i)
  assert.match(sql, /for update/i)
  assert.match(sql, /normalize\([^)]*,\s*NFKC\)/i)
  assert.match(sql, /locationAddressSnapshot/)
})

test('revenue ACLs, template guard, cleanup, and function grants are closed', () => {
  for (const table of [
    'project_contract_changes',
    'project_payment_plans',
    'project_receipts',
  ]) {
    assert.match(
      sql,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, 'i'),
    )
    assert.match(
      sql,
      new RegExp(`grant select, insert, update on table public\\.${table} to authenticated`, 'i'),
    )
    assert.match(
      sql,
      new RegExp(`grant all on table public\\.${table} to service_role`, 'i'),
    )
  }
  assert.match(sql, /fixed project financial whitelist violation/)
  assert.match(sql, /project_financial_template_grants\.cleaned/)
  assert.match(sql, /jsonb_build_object\('deletedCount'/)
  assert.doesNotMatch(sql, /grant delete on table public\.project_/i)

  const publicFunctions = [
    'list_projects_secure\\(\\)',
    'create_project_secure\\(jsonb\\)',
    'update_project_secure\\(text, jsonb\\)',
    'soft_delete_project_secure\\(text\\)',
    'migrate_legacy_project_contract_secure\\(text, jsonb, jsonb\\)',
  ]
  for (const signature of publicFunctions) {
    assert.match(
      sql,
      new RegExp(`revoke all on function public\\.${signature} from public, anon, authenticated, service_role`, 'i'),
    )
    assert.match(
      sql,
      new RegExp(`grant execute on function public\\.${signature} to authenticated, service_role`, 'i'),
    )
  }
})

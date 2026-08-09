import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../../supabase/migrations/202608080004_warehouse_workflows.sql',
  import.meta.url,
)

test('return confirmation locks resources, rechecks active rows and locks balances before writes', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const start = sql.indexOf('create or replace function public.confirm_warehouse_return_secure(')
  const end = sql.indexOf('\nrevoke all on function', start)
  assert.ok(start >= 0 && end > start)
  const body = sql.slice(start, end)
  const locationLock = body.indexOf('perform private.lock_warehouse_location_resource(resource_id)')
  const variantLock = body.indexOf('perform private.lock_warehouse_variant_resource(resource_id)')
  const activeRecheck = body.indexOf('not location.active')
  const balanceLock = body.indexOf('for update of balance')
  const firstBalanceWrite = body.indexOf('update public.warehouse_batch_locations')
  const firstMovementWrite = body.indexOf('insert into public.warehouse_inventory_movements')

  assert.ok(locationLock >= 0, 'location resources must use the shared advisory lock')
  assert.ok(variantLock > locationLock, 'variant resources lock after location UUIDs')
  assert.ok(activeRecheck > variantLock, 'active resources are re-read after advisory locks')
  assert.ok(balanceLock > activeRecheck, 'batch-location rows lock after active recheck')
  assert.ok(firstBalanceWrite > balanceLock, 'no balance write occurs before all locks')
  assert.ok(firstMovementWrite > balanceLock, 'no movement write occurs before all locks')
})

test('stock-out confirmation uses the same location then variant lock order as returns', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const start = sql.indexOf('create or replace function public.confirm_warehouse_stock_out_secure(')
  const end = sql.indexOf('\ncreate or replace function public.confirm_warehouse_return_secure(', start)
  assert.ok(start >= 0 && end > start)
  const body = sql.slice(start, end)
  const locationLock = body.indexOf('perform private.lock_warehouse_location_resource(resource_id)')
  const variantLock = body.indexOf('perform private.lock_warehouse_variant_resource(resource_id)')
  const minorLock = body.indexOf("perform pg_advisory_xact_lock(hashtextextended('warehouse-minor-work-cost:'")

  assert.ok(locationLock >= 0, 'stock-out locks location resources first')
  assert.ok(variantLock > locationLock, 'stock-out locks variants after locations')
  assert.ok(minorLock < 0 || minorLock > variantLock, 'minor-work cost lock follows inventory locks')
})

test('minor-work assignment posts net material cost without a second return reversal', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const postStart = sql.indexOf('create or replace function private.post_minor_work_order_cost(')
  const postEnd = sql.indexOf('\n$$;', postStart)
  const postBody = sql.slice(postStart, postEnd)
  assert.match(postBody, /warehouse_return_requests/iu)
  assert.match(postBody, /confirmed_return_cost/iu)
  assert.match(postBody, /total_cost\s*:=\s*gross_stock_out_cost\s*-\s*confirmed_return_cost/iu)

  const confirmStart = sql.indexOf('create or replace function public.confirm_warehouse_return_secure(')
  const confirmEnd = sql.indexOf('\nrevoke all on function', confirmStart)
  const confirmBody = sql.slice(confirmStart, confirmEnd)
  assert.match(confirmBody, /perform private\.post_minor_work_order_cost/iu)
  assert.match(confirmBody, /original_row\.destination_type = 'project'/iu)
})

test('minor-work response material cost is the confirmed stock-out total net of returns', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const start = sql.indexOf('create or replace function private.warehouse_minor_work_order_json(')
  const end = sql.indexOf('\n$$;', start)
  assert.ok(start >= 0 && end > start)
  const body = sql.slice(start, end)
  assert.match(body, /warehouse_stock_out_requests/iu)
  assert.match(body, /warehouse_return_requests/iu)
  assert.match(body, /return_line\.frozen_total_cost/iu)
  assert.match(body, /return_request\.status in \('confirmed', 'void'\)/iu)
})

test('all workflow submission idempotency retries bind canonical payloads to the original actor', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  for (const [functionName, actorExpression] of [
    ['submit_warehouse_receipt_secure', 'existing_receipt.submitted_by_employee_profile_id = actor_id'],
    ['submit_warehouse_stock_out_secure', 'existing_request.submitted_by_employee_profile_id = actor_id'],
    ['submit_warehouse_return_secure', 'existing_return.submitted_by_employee_profile_id = actor_id'],
  ]) {
    const start = sql.indexOf(`create or replace function public.${functionName}(`)
    const end = sql.indexOf('\n$$;', start)
    assert.ok(start >= 0 && end > start, `${functionName} must exist`)
    const body = sql.slice(start, end)
    assert.ok(body.includes(actorExpression), `${functionName} must bind retries to the submitter`)
    assert.match(body, /submission_payload\s*=\s*canonical_payload/iu)
    assert.match(body, /WAREHOUSE_WORKFLOW_IDEMPOTENCY_CONFLICT/iu)
  }
})

test('formal return reversal sums the stored rounded line totals', async () => {
  const sql = await readFile(migrationUrl, 'utf8')
  const start = sql.indexOf('create or replace function public.confirm_warehouse_return_secure(')
  const end = sql.indexOf('\nrevoke all on function', start)
  const body = sql.slice(start, end)
  assert.match(body, /returning frozen_total_cost into line_frozen_total/iu)
  assert.match(body, /return_total\s*:=\s*return_total\s*\+\s*line_frozen_total/iu)
  assert.doesNotMatch(body, /return_total\s*:=\s*return_total\s*\+\s*total_cost/iu)
})

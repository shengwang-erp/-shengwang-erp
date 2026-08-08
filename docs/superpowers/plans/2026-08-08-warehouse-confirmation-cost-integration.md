# Warehouse Confirmation and Cost Integration Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development before each production change. Never reuse the source branch's old confirmation persistence.

**Goal:** Connect second-version purchases, outbound/return requests, FIFO stock confirmation, frozen costs, formal-project material costs, and lightweight minor work orders through atomic server transactions.

**Architecture:** Submission RPCs create pending documents only. Confirmation RPCs lock the relevant request, batches, and location balances, enforce current permissions, and atomically write document status, balances, immutable movements, and cost postings. The browser refreshes authoritative snapshots after success and shows no optimistic inventory success.

**Tech Stack:** Supabase Postgres transactions/RPC, React, second-version `purchaseService`, warehouse pure domain tests, pgTAP.

---

### Task 1: Define pending documents and minor work orders

**Files:**
- Create: `supabase/migrations/202608080004_warehouse_workflows.sql`
- Create: `supabase/tests/warehouse_workflows.sql`
- Create: `src/features/warehouse/warehouseRequests.js`
- Create: `src/features/warehouse/warehouseRequests.test.js`
- Modify: `src/services/warehouseService.js`
- Modify: `src/services/warehouseService.test.js`

- [ ] Add tables:
  - `warehouse_receipts(id, purchase_record_key, status, submitted_by_employee_profile_id, submitted_at, confirmed_by_employee_profile_id, confirmed_at, rejection_reason, idempotency_key)`.
  - `warehouse_receipt_lines(id, receipt_id, variant_id, requested_quantity, confirmed_quantity, warehouse_id, location_id, unit_cost)`.
  - `warehouse_stock_out_requests(id, destination_type, project_id, minor_work_order_id, destination_name_snapshot, purpose, receiver, request_date, status, submitted_by_employee_profile_id, submitted_at, confirmed_by_employee_profile_id, confirmed_at, rejection_reason, idempotency_key)`.
  - `warehouse_stock_out_lines(id, request_id, variant_id, requested_quantity, confirmed_quantity, frozen_total_cost)`.
  - `warehouse_return_requests(id, original_stock_out_id, reason, receiver, request_date, status, submitted_by_employee_profile_id, submitted_at, confirmed_by_employee_profile_id, confirmed_at, rejection_reason, idempotency_key)`.
  - `warehouse_return_lines(id, return_id, original_stock_out_line_id, requested_quantity, confirmed_quantity, frozen_total_cost)`.
  - `warehouse_minor_work_orders(id, title, customer_name, work_date, location_text, description, status, assigned_project_id, created_by_employee_profile_id, created_at, updated_at)`.
- [ ] Enforce statuses `pending|confirmed|rejected|void`, exactly one destination reference for project/minor/internal, positive quantities, unique idempotency keys, and immutable destination snapshots after submission.
- [ ] After all six pending-document tables exist, add an integration proof for `private.warehouse_variant_has_pending_documents(uuid)`: pending `warehouse_receipts`/`warehouse_receipt_lines`, `warehouse_stock_out_requests`/`warehouse_stock_out_lines`, and `warehouse_return_requests`/`warehouse_return_lines` (joined through the original stock-out line) each block variant deactivation; confirmed/rejected/void rows do not. This proof must exercise the real tables and preserve the fixed-name `to_regclass` sequencing guard—no user-controlled SQL identifiers.
- [ ] Add `create_minor_work_order_secure`, `assign_minor_work_order_to_project_secure`, `submit_warehouse_receipt_secure`, `submit_warehouse_stock_out_secure`, and `submit_warehouse_return_secure`.
- [ ] Submission permission rules: receipt requires `warehouse.receipt.submit`; outbound/return requires `warehouse.stock_flow.request`; creating a minor order requires stock-flow request plus active account. Submission never changes batches, balances, movements, or project cost.
- [ ] Adapt request builders to accept `destinationType: project|minor_work_order|internal_use`; require a project only for `project`, a minor work order only for `minor_work_order`, and a purpose/name for internal use.
- [ ] Test a small air-conditioner job without a main project: create minor work order, submit outbound, and assert no fake project row is created.
- [ ] Run Node and pgTAP workflow submission tests.
- [ ] Commit with message `feat: add pending warehouse workflow documents`.

### Task 2: Replace direct purchase stock-in with warehouse arrival submission

**Files:**
- Modify: `src/services/purchaseService.js`
- Modify: `src/services/purchaseService.test.js`
- Modify: `src/auth/businessAccess.js`
- Modify: `src/auth/businessAccess.test.js`
- Modify: `src/App.jsx` only in the existing purchase stock-in section and prop wiring
- Create: `src/features/warehouse/purchaseWarehouseBridge.js`
- Create: `src/features/warehouse/purchaseWarehouseBridge.test.js`

- [ ] Write an integration failure proving the current `commitStockIn()` path writes inventory immediately and therefore violates the pending-confirmation rule.
- [ ] Replace the purchase-page action with `submitWarehouseArrival({ purchaseRecordKey, variantId, requestedQuantity, idempotencyKey })`; rename the button to `提交到货，等待仓库确认` and show pending/partial/confirmed quantities from warehouse receipt lines.
- [ ] Keep purchase record creation, payment, accrual, and supplier data on the current second-version services. Do not copy source purchase UI/service and do not count purchase payment as stock.
- [ ] Deprecate `purchaseService.commitStockIn` from application use; retain the old RPC/table untouched during the local compatibility phase, but add a source contract that fails if `App.jsx` calls it after the bridge is installed.
- [ ] Map purchase authorization to `module.purchases.view/create` plus `warehouse.receipt.submit`; warehouse confirmation remains separately gated by `warehouse.receipt.confirm`.
- [ ] Test partial arrival, repeated click with same idempotency key, quantity exceeding the purchase remainder, purchase deletion warning when a receipt exists, and network failure without local success.
- [ ] Run focused purchase/bridge/access tests and the existing `supabase/tests/purchase_accrual_access.sql` regression.
- [ ] Commit with message `refactor: route purchase arrivals through warehouse confirmation`.

### Task 3: Implement atomic receipt confirmation and FIFO stock-out

**Files:**
- Extend: `supabase/migrations/202608080004_warehouse_workflows.sql`
- Extend: `supabase/tests/warehouse_workflows.sql`
- Create: `src/services/warehouseConfirmationService.js`
- Create: `src/services/warehouseConfirmationService.test.js`
- Create: `src/features/warehouse/warehouseConfirmationContract.test.js`

- [ ] Add `confirm_warehouse_receipt_secure(p_receipt_id, p_lines, p_idempotency_key)` requiring `warehouse.receipt.confirm`. Lock receipt and variant/location rows, validate purchase remainder, create one batch per confirmed line at the purchase-unit-cost snapshot, update batch location balance, append stock-in movements, and mark receipt confirmed in one transaction.
- [ ] Add `confirm_warehouse_stock_out_secure(p_request_id, p_lines, p_idempotency_key)` requiring `warehouse.stock_flow.confirm`. Lock request and candidate batch locations in `received_at,id` order; allocate FIFO; fail the whole transaction if available quantity is short; append one movement per consumed batch; store the sum in `frozen_total_cost`; mark confirmed.
- [ ] The server derives operator profile/id/time and authoritative purchase price; reject browser-supplied audit identities or prices.
- [ ] Return the existing authoritative result for an exact retry with the same idempotency key; reject the same key with different payload. Add advisory locks by document and variant/location to prevent double confirmation.
- [ ] Add a strict confirmation service with `confirmReceipt`, `confirmStockOut`, and later `confirmReturn`; validate exact response objects and never use `baseRecordService`, localStorage, or optimistic balance changes.
- [ ] Test two batches at ¥100 and ¥130, an outbound quantity spanning both, frozen total, later catalog-price edit, concurrent insufficient stock, cross-location variant mismatch, inactive user, requester trying to confirm, and exact retry.
- [ ] Run focused Node tests and pgTAP workflow tests.
- [ ] Commit with message `feat: add atomic receipt and FIFO issue confirmation`.

### Task 4: Post formal-project material cost and minor-work cost safely

**Files:**
- Extend: `supabase/migrations/202608080004_warehouse_workflows.sql`
- Extend: `supabase/tests/warehouse_workflows.sql`
- Modify: `src/features/warehouse/warehouseAccounting.js`
- Modify: `src/features/warehouse/warehouseAccounting.test.js`
- Create: `src/features/cost-accounting/warehouseMaterialCostBridge.js`
- Create: `src/features/cost-accounting/warehouseMaterialCostBridge.test.js`
- Modify only read aggregation points in `src/App.jsx` and `src/features/cost-accounting/` identified by tests.

- [ ] In formal-project stock-out confirmation, insert exactly one active `project_cost_records` envelope keyed `WAREHOUSE-SO:<request-id>` with `sourceType: 'warehouse'`, `sourceDocumentId`, `projectId`, `costType: '材料费'`, frozen positive amount, and server operator/time.
- [ ] Block generic project-cost update/delete for records whose `payload.sourceType` is `warehouse` or `warehouseReversal`; correction must use warehouse return/reversal RPC.
- [ ] For minor work orders, expose material cost as the sum of confirmed outbound frozen totals. When `assign_minor_work_order_to_project_secure` assigns a project, insert the same deterministic project-cost envelope once; repeated assignment to the same project is idempotent and reassignment requires an explicit reversal first.
- [ ] Internal-use stock-out never creates a project-cost record; it remains visible in warehouse/company-consumption reports.
- [ ] Update profitability aggregation so purchase accrual and warehouse-issued material cost cannot both count the same warehouse-tracked purchase. Preserve all current labor, vehicle, receipt, and contract calculations.
- [ ] Test exact cost amount, duplicate confirmation, price edit, minor-order assignment, internal use, manual edit denial, and owner-dashboard cost completeness.
- [ ] Run accounting bridge, cost-accounting, executive-dashboard, purchase-accounting, and pgTAP workflow tests.
- [ ] Commit with message `feat: connect frozen warehouse costs to projects`.

### Task 5: Confirm returns at original cost and upgrade request UI

**Files:**
- Extend: `supabase/migrations/202608080004_warehouse_workflows.sql`
- Extend: `supabase/tests/warehouse_workflows.sql`
- Create/adapt: `src/features/warehouse/WarehouseRequestPage.jsx`
- Create/adapt: `src/features/warehouse/WarehouseRequestPage.test.js`
- Modify: `src/navigation/adminRoutes.js` only if route labels/contracts require it
- Modify: `src/App.jsx` only to replace generic stock-out/return page rendering with lazy warehouse request pages
- Extend: `src/services/warehouseConfirmationService.js`

- [ ] Add `confirm_warehouse_return_secure` requiring `warehouse.stock_flow.confirm`. Validate the original confirmed stock-out and remaining returnable quantity; restore batch/location quantities using original movement batch ids and costs; append return movements; create a negative project cost keyed `WAREHOUSE-SR:<return-id>` for formal projects.
- [ ] Preserve original destination and cost snapshots. Reject return against a pending/void stock-out, excess quantity, wrong variant, or previously fully returned line.
- [ ] Upgrade `我要出库` to search/scan variants and show photo, item, model, size, material, unit, available locations, available quantity, requested quantity, destination type, project/minor job/internal use, receiver, and purpose. Hide cost from users without `warehouse.cost.view`.
- [ ] Upgrade `我要退回` to select a returnable original issue and show remaining quantity and original destination. Submission remains pending until warehouse confirmation.
- [ ] Add page tests for keyboard/mobile operation, permission-hidden cost, unavailable-stock warning, pending status, retry, and no generic free-text material form.
- [ ] Run focused request/confirmation tests, `npm test`, `npm run build`, and workflow pgTAP.
- [ ] Commit with message `feat: add confirmed returns and detailed warehouse requests`.

## Phase 3 completion gate

- [ ] The complete two-price FIFO and partial-return scenario passes in pgTAP.
- [ ] Purchase arrival never changes inventory before warehouse confirmation.
- [ ] Requester and confirmer permissions are independently enforced in browser and Postgres.
- [ ] Formal project, minor work, and internal-use destinations all work without fake projects.
- [ ] Historical cost is unchanged after catalog or later purchase price changes.
- [ ] Existing purchase/accounting/dashboard/auth tests plus `npm test` and `npm run build` pass.

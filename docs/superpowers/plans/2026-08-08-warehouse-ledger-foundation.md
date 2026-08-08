# Warehouse Ledger Foundation Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Before each task, use superpowers:test-driven-development. Do not start Phase 2 until every Phase 1 gate passes.

**Goal:** Establish a clean second-version warehouse boundary, stable permissions, pure domain rules, normalized foundational tables, and a read-only warehouse service without changing online data.

**Architecture:** Production writes go only through new warehouse RPCs backed by current Supabase Auth and `employee_profiles`. Pure source-branch domain functions are copied only after dependency classification and are used as calculation/validation code and test oracles; they do not perform production persistence.

**Tech Stack:** JavaScript ES modules, Node test runner, Supabase Postgres 15, pgTAP.

---

### Task 1: Enforce the forward-port boundary

**Files:**
- Create: `docs/warehouse-forward-port-manifest.json`
- Create: `src/features/warehouse/warehouseForwardPortBoundary.test.js`
- Read-only reference: `/Users/yu/Documents/亚马逊请求书/.worktrees/warehouse-management/src/features/warehouse/`

- [ ] Write a failing test that loads the manifest and asserts every imported source path begins with `src/features/warehouse/`, every destination is warehouse-owned, and forbidden tokens are absent: `authSession`, `sessionOperationFence`, `cloudPersistenceCoordinator`, `baseRecordService`, `localStorage`, and source `App.jsx`.
- [ ] Add a manifest with four arrays: `pureCopy`, `adapt`, `rewrite`, and `forbidden`. Put `warehouseDate.js`, `warehouseQr.js`, `warehouseCatalog.js`, `warehouseDomain.js`, `warehousePage.js`, and `warehouseAccounting.js` in `pureCopy`; place React components, CSS, media, export, and operations in `adapt`; place permissions and confirmation service in `rewrite`; list all source shared files in `forbidden`.
- [ ] Run `node --test src/features/warehouse/warehouseForwardPortBoundary.test.js` and confirm green.
- [ ] Commit with message `test: lock warehouse forward-port boundary`.

### Task 2: Port pure warehouse rules without old runtime dependencies

**Files:**
- Create: `src/features/warehouse/warehouseDate.js`
- Create: `src/features/warehouse/warehouseQr.js`
- Create: `src/features/warehouse/warehouseCatalog.js`
- Create: `src/features/warehouse/warehouseDomain.js`
- Create: `src/features/warehouse/warehousePage.js`
- Create: `src/features/warehouse/warehouseAccounting.js`
- Create/adapt tests: `src/features/warehouse/warehouseDate.test.js`, `warehouseQr.test.js`, `warehouseCatalog.test.js`, `warehouseDomain.test.js`, `warehousePage.test.js`, `warehouseAccounting.test.js`

- [ ] Copy the six whitelisted pure modules from the read-only source, preserving behavior but removing any import that is not relative to `src/features/warehouse/`.
- [ ] Port focused tests for finite/nonnegative quantities, FIFO across two prices, historical cost snapshot, partial return at original cost, transfer conservation, stocktake differences, deterministic reversal ids, SKU/QR normalization, and Tokyo dates.
- [ ] Add a contract test asserting no pure module imports React, Supabase, storage, `App.jsx`, or a service under `src/services/`.
- [ ] Run `node --test src/features/warehouse/warehouseDate.test.js src/features/warehouse/warehouseQr.test.js src/features/warehouse/warehouseCatalog.test.js src/features/warehouse/warehouseDomain.test.js src/features/warehouse/warehousePage.test.js src/features/warehouse/warehouseAccounting.test.js`.
- [ ] Commit with message `feat: port isolated warehouse domain rules`.

### Task 3: Add second-version warehouse action permissions

**Files:**
- Modify: `src/auth/permissionCatalog.js`
- Modify: `src/utils/permissions.js`
- Modify: `src/auth/businessAccess.js`
- Modify: `src/features/employees/permissionTemplateContract.test.js`
- Modify: `src/services/permissionTemplateService.test.js`
- Create: `src/auth/warehousePermissions.test.js`
- Create: `supabase/migrations/202608080001_warehouse_permission_catalog.sql`
- Create: `supabase/tests/warehouse_permission_catalog.sql`

- [ ] Write failing tests for the nine stable action keys from the roadmap, department/position template round-trip, `SW-000`, active-account fail-closed behavior, and separation between request and confirm permissions.
- [ ] Add `WAREHOUSE_PERMISSION_CATALOG` to `permissionCatalog.js`, append its keys to `PERMISSION_CATALOG`, and expose label/key records to the personnel permission editor.
- [ ] Add `hasEffectivePermissionKey(employee, key)` and `getWarehouseAccess(user)`; return frozen booleans named `page`, `manageCatalog`, `submitReceipt`, `confirmReceipt`, `requestStockFlow`, `confirmStockFlow`, `transfer`, `stocktake`, `viewCost`, and `exportReports`.
- [ ] In migration `202608080001`, replace the `permission_grants_permission_key_check` constraint with the complete old list plus nine warehouse keys, and replace `replace_permission_template_admin` with the same complete allow-list. Do not alter employee or project rows.
- [ ] Seed no grants automatically. The administrator can later grant all warehouse keys to `仓库管理部` through the existing template UI.
- [ ] Add pgTAP cases proving unknown keys are rejected, warehouse keys persist, inactive users have no effective access, and requester-only users cannot confirm.
- [ ] Run `node --test src/auth/warehousePermissions.test.js src/features/employees/permissionTemplateContract.test.js src/services/permissionTemplateService.test.js`.
- [ ] Run `npx supabase db reset && npx supabase test db supabase/tests/warehouse_permission_catalog.sql`.
- [ ] Commit with message `feat: add warehouse permission contracts`.

### Task 4: Create the normalized warehouse foundation and immutable ledger

**Files:**
- Create: `supabase/migrations/202608080002_warehouse_foundation.sql`
- Create: `supabase/tests/warehouse_foundation.sql`
- Create: `src/services/warehouseSchema.test.js`

- [ ] Write schema-contract and pgTAP failures first for these tables and keys:
  - `warehouse_sites(id, code, name, kind, active, created_at, updated_at)` with `kind in ('normal','project_site','shared_tool')` and unique `code`.
  - `warehouse_locations(id, warehouse_id, shelf_code, shelf_name, active, created_at, updated_at)` with unique `(warehouse_id, shelf_code)`.
  - `warehouse_items(id, name, category, brand, description, active, created_at, updated_at)`.
  - `warehouse_variants(id, item_id, sku, model, size, material, unit, minimum_stock, default_purchase_price, system_qr, manufacturer_qr, active, created_at, updated_at)` with unique SKU, unique system QR, case-insensitive unique nonblank manufacturer QR, and reserved-prefix protection.
  - `warehouse_batches(id, variant_id, receipt_line_id, received_at, unit_cost, original_quantity, created_at)`.
  - `warehouse_batch_locations(batch_id, location_id, quantity, updated_at)` with nonnegative quantity and composite primary key.
  - `warehouse_inventory_movements(id, movement_type, variant_id, batch_id, warehouse_id, location_id, quantity_delta, unit_cost, source_document_type, source_document_id, idempotency_key, project_id, destination_type, destination_id, destination_name, operator_employee_profile_id, occurred_at, reversal_of_movement_id, metadata)`.
- [ ] Add foreign keys, finite numeric checks, trimmed-text checks, and indexes for variant/location/time, source document, project, and idempotency key. Use `numeric(18,3)` quantities and `numeric(18,4)` costs.
- [ ] Enable RLS and grant warehouse reads only to active users with `module.inventory.view`; cost columns are returned only through cost-aware RPCs that require `warehouse.cost.view`.
- [ ] Revoke direct insert/update/delete on batches, batch locations, and movements from `authenticated` and `anon`.
- [ ] Add a trigger that rejects updates/deletes on `warehouse_inventory_movements`, including service-role updates; reversal is the only correction mechanism.
- [ ] Add `private.assert_warehouse_permission(text)` that resolves `auth.uid()` through current `employee_profiles`, checks active/employment/password state, checks the exact current permission key, and returns the profile id/name for audit snapshots.
- [ ] Add pgTAP cases for every constraint, direct-write denial, inactive account denial, movement immutability, and empty-table creation while existing employee/project counts remain unchanged.
- [ ] Run `node --test src/services/warehouseSchema.test.js`.
- [ ] Run `npx supabase db reset && npx supabase test db supabase/tests/warehouse_foundation.sql`.
- [ ] Commit with message `feat: add secure warehouse ledger foundation`.

### Task 5: Add a fail-closed read service

**Files:**
- Create: `src/services/warehouseService.js`
- Create: `src/services/warehouseService.test.js`
- Create: `src/features/warehouse/warehouseSnapshot.js`
- Create: `src/features/warehouse/warehouseSnapshot.test.js`

- [ ] Write tests for strict plain-object/array validation, configuration failure, 401/403 normalization, rejection of malformed server rows, no localStorage fallback, and immutable returned snapshots.
- [ ] Implement a `createWarehouseService(client, options)` with read methods `listCatalog()`, `listLocations()`, `listBalances(filters)`, and `listMovements(filters)`. Each method calls one named secure RPC and validates exact response fields.
- [ ] Implement `buildWarehouseSnapshot({ items, variants, locations, balances })` for overview and low-stock calculations; keep unit cost absent unless the caller has `viewCost`.
- [ ] Add list RPCs in `202608080002_warehouse_foundation.sql`: `list_warehouse_catalog_secure`, `list_warehouse_locations_secure`, `list_warehouse_balances_secure`, and `list_warehouse_movements_secure`. Enforce maximum page size 500 and validated filters.
- [ ] Run `node --test src/services/warehouseService.test.js src/features/warehouse/warehouseSnapshot.test.js`.
- [ ] Run `npm test` and `npm run build`.
- [ ] Commit with message `feat: expose warehouse read service`.

## Phase 1 completion gate

- [ ] `git diff d5953c5 -- src/auth src/services src/features/warehouse supabase` contains no first-version auth/session/persistence imports.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] `npx supabase db reset` passes against the isolated local project.
- [ ] `npx supabase test db supabase/tests/warehouse_permission_catalog.sql supabase/tests/warehouse_foundation.sql` passes.
- [ ] `git status --short` contains only intentional committed changes.


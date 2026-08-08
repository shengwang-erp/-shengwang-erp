# Warehouse Operations, Reports, UI, and Local Acceptance Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Use superpowers:test-driven-development for each task and superpowers:verification-before-completion before any completion claim.

**Goal:** Complete transfer, monthly stocktake, reversal, reports/exports, second-version navigation and visual integration, then prove the entire migration locally without online deployment.

**Architecture:** Transfer, stocktake, and reversal are atomic ledger operations. Reports read server-filtered authoritative views. The warehouse route is lazy-loaded inside the existing second-version `DesktopAdminShell`; shared-tool location is inventory metadata only and does not replace existing borrow/return workflows.

**Tech Stack:** Supabase RPC/pgTAP, React 19, ExcelJS, browser print/PDF, Vite/Node tests.

---

### Task 1: Add atomic transfer, monthly stocktake, and reversal

**Files:**
- Create: `supabase/migrations/202608080005_warehouse_operations_reports.sql`
- Create: `supabase/tests/warehouse_operations_reports.sql`
- Create/adapt: `src/features/warehouse/warehouseOperations.js`
- Create/adapt: `src/features/warehouse/warehouseOperations.test.js`
- Extend: `src/services/warehouseConfirmationService.js`
- Extend: `src/services/warehouseConfirmationService.test.js`

- [ ] Add tables `warehouse_transfers`, `warehouse_transfer_lines`, `warehouse_stocktakes`, and `warehouse_stocktake_lines` with pending/confirmed/rejected/void states, immutable confirmed snapshots, and unique `(warehouse_id, stocktake_month)` for active confirmed monthly counts.
- [ ] Add `confirm_warehouse_transfer_secure`: require `warehouse.transfer.manage`, lock source/destination batch locations in canonical order, subtract/add the same batch quantity in one transaction, append paired out/in movements, and preserve unit cost and company total.
- [ ] Add `confirm_warehouse_stocktake_secure`: require `warehouse.stocktake.confirm`, capture book quantity under lock, accept nonnegative counted quantity, require reason/type for differences, and append gain/loss/damaged/scrapped/no-change movement facts. A zero-stock gain must include an approved authoritative unit cost and `warehouse.cost.view`.
- [ ] Add `reverse_warehouse_operation_secure`: require the permission corresponding to the original operation, reject reversal-of-reversal, append deterministic opposite movement(s), restore/reverse project cost where applicable, and mark source document void without deleting it.
- [ ] Adapt only pure validation/orchestration from source `warehouseOperations.js`; remove `sessionOperationFence`, old persistence, client-supplied operator, and client-side authoritative mutations.
- [ ] Test transfer conservation, deadlock-safe lock ordering, duplicate monthly count, all difference types, exact retry, partial reversal rejection, cost reversal, and immutable originals.
- [ ] Run operation Node tests and pgTAP.
- [ ] Commit with message `feat: add warehouse transfer stocktake and reversal`.

### Task 2: Build secure reports, print/PDF, and Excel export

**Files:**
- Extend: `supabase/migrations/202608080005_warehouse_operations_reports.sql`
- Extend: `supabase/tests/warehouse_operations_reports.sql`
- Create/adapt: `src/features/warehouse/warehouseExport.js`
- Create/adapt: `src/features/warehouse/warehouseExport.test.js`
- Create/adapt: `src/features/warehouse/WarehouseReports.jsx`
- Create: `src/features/warehouse/WarehouseReports.test.js`
- Modify: `src/features/warehouse/warehouseLazyLoading.test.js`
- Modify if the executable boundary needs a new reachability mode: `scripts/verify-warehouse-lazy-dependencies.mjs`
- Extend: `src/services/warehouseService.js`
- Extend: `src/features/warehouse/warehouse.css`

- [ ] Add server-filtered report RPCs for items, current stock, receipts, issues, returns, transfers, stocktakes, low stock, and movement ledger. Validate date/month, warehouse, location, category, variant, project/destination, status, and page-size filters.
- [ ] Redact unit/total cost unless `warehouse.cost.view`; require `warehouse.report.export` for export-sized responses. Ordinary page reads remain bounded to 500 rows; exports cap at 20,000 rows.
- [ ] Adapt export builders to pure row mapping. Dynamically import ExcelJS only when exporting; create frozen header rows, explicit columns, correct numeric cells, filter summary, report title, generated timestamp, and company name.
- [ ] Upgrade the executable lazy-loading contract from dependency-only evidence: prove the real production `src/features/warehouse/warehouseExport.js` contains a literal `import('exceljs')`, and prove that export module is reachable through the production `WarehouseReports.jsx` import graph. Fixture-only evidence is insufficient after this task.
- [ ] Print only the currently filtered report. Use `.warehouse-print-sheet` and named `@page warehouse-report`; browser print provides paper/PDF output.
- [ ] Test every report filter, redaction, maximum rows, hostile formula-leading text escaped in Excel, disabled export button without permission, print isolation, and export failure not changing inventory.
- [ ] Run report/export tests, `node --test src/features/warehouse/warehouseLazyLoading.test.js`, pgTAP, and `npm run build`.
- [ ] Commit with message `feat: add secure printable warehouse reports`.

### Task 3: Integrate the warehouse page into the second-version shell

**Files:**
- Create/adapt: `src/features/warehouse/WarehouseOverview.jsx`
- Create/adapt: `src/features/warehouse/WarehouseOperations.jsx`
- Create/adapt: `src/features/warehouse/WarehouseManagementPage.jsx`
- Create: `src/features/warehouse/WarehouseManagementPage.test.js`
- Modify: `src/features/warehouse/warehouseLazyLoading.test.js`
- Modify if the executable boundary needs a page-root reachability mode: `scripts/verify-warehouse-lazy-dependencies.mjs`
- Modify: `src/navigation/adminRoutes.js`
- Modify: `src/navigation/adminRoutes.test.js`
- Modify: `src/auth/businessAccess.js`
- Modify: `src/auth/businessAccessIntegration.test.js`
- Modify: `src/App.jsx` only for lazy import, authoritative warehouse state loader, route render, and existing request route props
- Modify: `src/DesktopAdminShell.jsx` only if an existing extension point cannot render the new route
- Modify: `src/index.css` only if a second-version shared variable is missing; warehouse selectors stay in `warehouse.css`
- Modify: workbench/home model tests under `src/features/workbench/`

- [ ] Add desktop route `{ view: 'warehouse', label: '仓库管理', iconText: '仓', moduleName: '仓库库存' }` immediately before `我要出库`; adjust later menu orders without changing route ids or meanings.
- [ ] Add a home business card using the existing black/gold card model and low-stock/total-SKU summary; hide route and card without `module.inventory.view`.
- [ ] Lazy-load `WarehouseManagementPage`, scanner, catalog editor, reports, and request pages. Preserve the existing login bundle and `DesktopAdminShell`.
- [ ] Upgrade the executable lazy-loading contract again: prove the production `WarehouseReports.jsx` → `warehouseExport.js` → literal `import('exceljs')` chain is reachable from the real `WarehouseManagementPage`/warehouse page root wired by this task. Keep the existing real ZXing and QRCode callsite/reachability assertions green.
- [ ] Compose tabs: overview, catalog, operations, monthly stocktake, and reports. Show only actions allowed by `getWarehouseAccess`; refresh server snapshots after each successful mutation.
- [ ] Mark shared-tool locations clearly but keep existing `借工具` route/service untouched. Add a regression test proving no tool-borrow record is created by warehouse location edits.
- [ ] Add a visible local-only banner when `VITE_WAREHOUSE_MIGRATION_PREVIEW=true`: `第二版 + 仓库移植测试`. The flag must not alter permissions or data behavior.
- [ ] Run route, shell, workbench, access, page, visual, tool, and `node --test src/features/warehouse/warehouseLazyLoading.test.js` tests.
- [ ] Commit with message `feat: integrate warehouse into second-version shell`.

### Task 4: Run the complete isolated local business scenario

**Files:**
- Create: `supabase/tests/warehouse_end_to_end.sql`
- Create: `scripts/verify-warehouse-forward-port.mjs`
- Create: `docs/superpowers/handoffs/2026-08-08-warehouse-local-acceptance.md`

- [ ] Build a pgTAP scenario that creates only disposable local Auth/profile/project fixtures, then executes catalog → two-price receipts → FIFO project issue → partial return → transfer → monthly stocktake → reports → reversal. Roll back or reset at the end.
- [ ] Include minor-work and internal-use issues, inactive and first-login users, duplicate QR, insufficient stock, concurrent same-request confirmation, cross-warehouse mismatch, and exact idempotent retry.
- [ ] Write `verify-warehouse-forward-port.mjs` to fail if the diff contains forbidden files/imports/tokens, if source shared files were copied byte-for-byte, if warehouse code imports old auth/persistence, or if `App.jsx` calls `commitStockIn`.
- [ ] Run `npx supabase db reset` and all pgTAP files, including every pre-existing second-version test.
- [ ] Run `node scripts/verify-warehouse-forward-port.mjs`, `npm test`, and `npm run build`.
- [ ] Record exact command results, test counts, build result, dependency audit result, and known nonblocking limitations in the local-acceptance handoff.
- [ ] Commit with message `test: verify warehouse forward-port end to end`.

### Task 5: Start the dedicated local preview and conduct user acceptance

**Files:**
- Create: `.env.warehouse-preview.example`
- Update: `docs/superpowers/handoffs/2026-08-08-warehouse-local-acceptance.md`
- Copy final handoff and all five plan documents to `/Users/yu/Desktop/Codex任务说明档案/2026-08-06_仓库管理安全移植/`

- [ ] Configure only local Supabase URLs/keys and `VITE_WAREHOUSE_MIGRATION_PREVIEW=true`; do not use online service-role keys or online database URLs.
- [ ] Start with `npm run dev -- --host 127.0.0.1 --port 5174` from `/Users/yu/Documents/kaobeierp/warehouse-forward-port`.
- [ ] Manually verify black/gold desktop and mobile layouts, scanner cleanup, photos, labels, detailed outbound/return, confirmation queues, monthly stocktake, report printing, and Excel download.
- [ ] Ask the user to verify the final local scenario. Record accepted items and any requested local fixes in the handoff.
- [ ] Do not create a deployment commit, push a release branch, run `vercel`, link the project, or execute remote Supabase migration commands.
- [ ] Only after explicit user approval, create a separate online-release plan covering backups, migration dry run, deployment, smoke tests, rollback, and monitoring.

## Final completion gate

- [ ] `npm test` passes with all second-version and warehouse tests.
- [ ] `npm run build` passes.
- [ ] All local pgTAP and storage HTTP tests pass after a clean database reset.
- [ ] Pollution verifier reports zero forbidden imports/files and no source `App.jsx`/auth/persistence migration.
- [ ] Existing employee and project data contracts are unchanged; warehouse starts empty outside disposable local fixtures.
- [ ] User has approved the local preview.
- [ ] No online deployment, migration, or data write occurred.

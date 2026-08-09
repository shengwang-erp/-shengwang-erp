# Phase 4 Task 3 — Second-Version Warehouse Shell Integration

Date: 2026-08-09 (Asia/Tokyo)

## Scope

- Added `仓库管理` immediately before `我要出库` in the existing second-version desktop route table and preserved all existing route identities.
- Added the black/gold warehouse Home card with authorized total-SKU and low-stock summaries.
- Added one lazy warehouse management root with five task tabs: inventory overview, item catalog, operations, monthly stocktake, and reports/printing.
- Connected the page only to the secure catalog, confirmation, media, and report services already forward-ported into the second version.
- Added purchase-arrival confirmation with an explicit real shelf selection for every receipt line; stock changes only after warehouse confirmation and retain the purchase batch cost.
- Added transfer, whole-document reversal, and monthly stocktake forms with server refresh after successful mutation.
- Kept shared-tool warehouse locations as location metadata only; the existing `借工具` route and mutation service remain separate.
- Added the local-only `第二版 + 仓库移植测试` banner behind the exact development flag value `true`.

## Permission and data boundaries

- The route, Home card, and page require `module.inventory.view`.
- Catalog editing, purchase receipt confirmation, stock-flow request/confirmation, transfer, stocktake, cost viewing, and report export remain independent exact grants.
- Accounts without receipt-confirm permission do not request pending purchase receipt rows.
- Cost remains redacted without warehouse cost access.
- Every successful page mutation reloads authoritative catalog, location, balance, request, and permitted pending-receipt snapshots.
- Network retries reuse the exact same idempotency key, document id, and stocktake line ids while the payload is unchanged; editing the payload creates a new operation identity.

## Lazy-loading proof

- `WarehouseManagementPage` is lazy-loaded from the second-version `App.jsx`.
- Catalog, operations, reports, request pages, camera scanner, QR label generator, and ExcelJS remain outside the ordinary login/Home path.
- The executable dependency checker proves the real management-page graph reaches the scanner/label modules and the `WarehouseReports.jsx` → `warehouseExport.js` → literal `import('exceljs')` chain.

## Verification

- Focused warehouse page, route, Home-model, service, and lazy-loading tests: PASS.
- Full `npm test`: 1,483/1,483 PASS.
- `npm run build`: PASS (491 modules transformed).
- Isolated local `warehouse_operations_reports.sql` pgTAP: 89/89 PASS after a clean local database reset.
- `git diff --check`: PASS.

## Safety confirmation

- No first-version file or archived repository was modified.
- No old warehouse persistence or tool-borrow mutation was imported.
- No online Supabase command, Vercel deployment, GitHub push, or remote data write was performed.
- Existing employee and project data contracts were not changed.

## Known nonblocking note

The production build still emits the repository's pre-existing large-chunk advisory. Warehouse scanner and Excel dependencies are nevertheless emitted as separate lazy chunks. Complete isolated business-scenario verification is the next planned task.

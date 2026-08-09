# Phase 4 Task 2 — Secure Warehouse Reports, Print, and Excel

Date: 2026-08-09 (Asia/Tokyo)

## Scope

- Added nine server-filtered warehouse reports: item catalog, current stock, receipts, issues, returns, transfers, stocktakes, low stock, and movement ledger.
- Kept ordinary reads at 500 rows maximum and export reads at 20,000 rows maximum.
- Required `module.inventory.view` for report reads and the independent `warehouse.report.export` permission for export-sized reads.
- Redacted unit and total cost in SQL unless `warehouse.cost.view` is effective.
- Added a closed browser service contract that validates every filter, envelope, report row, cost field, page number, and export flag.
- Added black/gold responsive report UI, current-result-only printing/PDF, and lazy Excel export.
- Added formula-leading text escaping, frozen Excel headers, numeric cells, report metadata, and filter summaries.
- Extended the executable lazy-dependency checker to prove `WarehouseReports.jsx` reaches the real `warehouseExport.js` literal `import('exceljs')` callsite.

## Safety properties

- Reports read authoritative server data; the browser does not rebuild or mutate inventory.
- Export failure cannot call receipt, issue, transfer, stocktake, return, or reversal mutations.
- Draft filters cannot relabel an older successful result. Printing is disabled until the current filters have been successfully queried.
- The global print-isolation rule exists only while `window.print()` runs and the body class is restored in `finally`, so later printing from another ERP page is unaffected.
- Null report types, impossible dates, oversized pages, unknown fields, unauthorized exports, and malformed supplier responses fail closed.
- No online Supabase migration, Vercel deployment, push, or remote write was performed.

## Verification

- Clean isolated local Supabase migration replay: PASS.
- `supabase test db supabase/tests/warehouse_operations_reports.sql`: 88/88 PASS.
- Real SQL-to-service bridge review: all nine report response shapes accepted by the strict client validator (low-stock fixture had an empty row set; the other eight supplied real rows); transaction rolled back.
- Focused report/service/export/lazy tests: PASS.
- `npm test`: 1,474/1,474 PASS.
- `npm run build`: PASS (428 modules transformed).
- `git diff --check`: PASS.

## Review corrections

Independent review initially found two Important print issues:

1. Draft filters could label the previous result during printing.
2. A persistent global print rule could blank unrelated pages after leaving reports.

Both were corrected with applied-filter snapshots, disabled dirty/loading print state, and a transient `warehouse-report-printing` body scope. Regression tests cover both cases.

## Known nonblocking note

The production build continues to report the pre-existing large-chunk advisory. The warehouse report Excel dependency remains behind a literal dynamic import and will become reachable from the lazy warehouse page root during Phase 4 Task 3 integration.

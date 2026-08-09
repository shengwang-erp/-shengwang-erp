# Phase 3 Task 5 implementation report

Date: 2026-08-09 (Asia/Tokyo)
Branch: `codex/warehouse-forward-port`
Baseline: `93b143a`
Status: IMPLEMENTED — VERIFIED — FRESH REVIEW 0 CRITICAL / 0 IMPORTANT

## Scope completed

- Added authoritative return confirmation at original FIFO movement batch/location/cost with deterministic resource and balance locking, exact retry identity, excess-return atomic rollback, and immutable confirmation provenance.
- Formal-project returns create one protected negative `WAREHOUSE-SR:<return-id>` project-cost record. Minor-work returns update the single `WAREHOUSE-MWO:<minor-work-id>` net aggregate, including an auditable active zero after a full return, and never create a second SR path.
- Added the secure request-context RPC. A caller with request or confirm permission may enter; request-only sees only their own documents, confirm-only sees all relevant pending work, and neither permission is rejected. Cost is redacted unless `warehouse.cost.view` is effective.
- Context DTOs include confirmation time/operator and rejection reason. Nested browser validation is exact and fail closed for unknown/missing/accessor/symbol/prototype-mutating fields, malformed identifiers/status/date/decimal/cost, broken parent-line binding, invalid destination tuples, invalid status/line tuples, and invalid minor-work assignment/cost tuples.
- Replaced only the second-version generic `我要出库` / `我要退回` rendering with a lazy warehouse page inside `DesktopAdminShell`. No first-version or browser-storage module was imported.
- Detailed outbound supports item/model/size/material/unit/photo/QR, exact available quantity by warehouse/shelf, project/minor-work/internal-use destination, and inline minor-work creation only after that destination is selected.
- Detailed return selects an original confirmed issue, preserves original destination and remaining quantity, and loads the selected return variant photo even when it is not the first catalog variant.
- Request-only users retain pending/confirmed/rejected/void history; confirmed time and rejection reason remain visible. Confirm-only users see pending confirmation controls but no request form.
- Submission and confirmation idempotency keys survive network retry and rotate only after an authoritative RPC success. Quantity totals/comparisons use fixed thousandth units, so `0.1 + 0.2` displays and compares as `0.3`.
- Exact retries are actor-bound, accept terminal confirmed/rejected/void responses, and redact frozen cost whenever the caller lacks `warehouse.cost.view`.
- Warehouse confirmers may explicitly reject outbound and return requests with a required reason; rejection is auditable, exactly idempotent, and never mutates inventory.
- Zero-price formal-project outbound/return transactions remain valid inventory movements but do not create misleading zero-value `WAREHOUSE-SO` or `WAREHOUSE-SR` cost records.
- Cost accounting accepts signed warehouse reversal facts and the protected zero minor-work aggregate. Minor-work material cost is the confirmed gross outbound cost minus confirmed/void returns.
- Returns against an original confirmed issue continue to work after the destination project is archived, without reopening or otherwise mutating that project.
- The project selector safely adopts the first eligible project when projects load asynchronously and preserves a still-valid user selection.
- Request context is deterministically capped at 1,000 records while retaining pending work ahead of history; minor-work context is independently capped at 1,000.

## Verification

- Focused final service/page selection: **67/67 PASS**; final request-page suite: **14/14 PASS**.
- First full parallel Node run exposed one intermittent QR scanner test failure (**1408/1409**); that scanner file passed independently (**38/38**), and the full serial diagnostic run completed successfully.
- Fresh required default-parallel rerun: **1446/1446 PASS**, exit 0. The acceptance result therefore does not rely on reducing concurrency.
- Fresh isolated migration reset: PASS through `202608080004_warehouse_workflows.sql`.
- Latest warehouse workflow pgTAP: **241/241 PASS**, including zero-price flows, rejection, deterministic 1,000-row context, and archived-project return scenarios.
- Production build: PASS, 427 modules transformed.
- Lazy warehouse request chunk: 26.13 kB, gzip 8.90 kB.
- `git diff --check`: PASS.
- Existing Vite warning remains for a pre-existing main chunk above 500 kB; the new request page is independently lazy split.
- No commit, push, Vercel deploy, online Supabase mutation, or package installation was performed.

## First review findings and fixes

- The first review identified gaps around zero-price stock movement/cost posting, terminal retry actor binding and redaction, and exact return-cost rounding. Those paths now use server-authoritative frozen values, preserve zero-price inventory movements without misleading zero cost rows, and return permission-redacted terminal retry DTOs.
- Rejection was previously incomplete. Secure stock-out and return rejection RPCs, required reasons, audit provenance, exact retry behavior, UI controls, and no-inventory-mutation tests are now present.
- Request context/history was unbounded and could displace pending work. The context is now deterministic, pending-first, and capped at 1,000; minor-work context has its own 1,000-row cap.
- Archived projects initially blocked valid returns. Return-only accounting now permits reversing the original confirmed formal-project and minor-work issue after project archival, verified with a disposable project fixture.
- Lock ordering, concurrency fixtures, async project selection, second-variant return photo selection, and fail-closed nested DTO/symbol handling were tightened and regression-tested.
- Every first-review item was re-evaluated by a fresh reviewer against the final tree; none remained Critical or Important.

## Isolation and cleanup

- Dedicated project: `codex-warehouse-task5`.
- Workdir: `/private/tmp/codex-warehouse-task5-project`.
- API/database/shadow ports: 60321 / 60322 / 60320.
- The earlier empty database named `codex_warehouse_task5` was independently proven to contain zero rows across all 25 public tables, then dropped after the user's explicit authorization. A follow-up `pg_database` check returned zero matches. The user's online database and files were not touched.
- `supabase stop --no-backup` completed for the dedicated local project after final verification.
- Filtered Docker container, volume, and network listings for `codex-warehouse-task5` are empty.
- `/private/tmp/codex-warehouse-task5-project` was deleted and a follow-up filesystem check confirms it no longer exists.
- Final zero-residual proof: the temporary project directory is absent, dedicated container/volume/network queries return no rows, and `pg_database` returns `0` for `codex_warehouse_task5`.

## Review gate

- Fresh independent review against `93b143a`: COMPLETE.
- Critical: **0**.
- Important: **0**.
- Actionable findings: none.
- Reviewer independently reran focused tests **69/69**, full tests **1446/1446**, warehouse pgTAP **241/241**, production build, and `git diff --check 93b143a`; all passed.

## Files changed

- `supabase/migrations/202608080004_warehouse_workflows.sql`
- `supabase/tests/warehouse_workflows.sql`
- `supabase/tests/warehouse_workflow_concurrency.sql`
- `src/services/warehouseConfirmationService.js`
- `src/services/warehouseConfirmationService.test.js`
- `src/services/warehouseService.js`
- `src/services/warehouseService.test.js`
- `src/features/warehouse/WarehouseRequestPage.jsx`
- `src/features/warehouse/WarehouseRequestPage.test.js`
- `src/features/warehouse/warehouseReturnSqlContract.test.js`
- `src/features/warehouse/warehouseRequestAppIntegration.test.js`
- `src/features/warehouse/warehouse.css`
- `src/features/warehouse/warehouseVisualContract.test.js`
- `src/auth/businessAccess.js`
- `src/auth/businessAccess.test.js`
- `src/auth/presidentPermissionMatrix.test.js`
- `src/App.jsx`
- `src/desktopAdminShell.test.js`
- `src/features/attendance/todayAttendanceAppIntegration.test.js`
- `src/features/cost-accounting/warehouseMaterialCostBridge.js`
- `src/features/cost-accounting/warehouseMaterialCostBridge.test.js`
- `src/features/cost-accounting/costAccountingDomain.js`
- `src/features/cost-accounting/costAccountingDomain.test.js`

# Task 06 — Transfer, Monthly Stocktake, and Whole-Operation Reversal

## Scope and safety boundary

- Implemented only in `/Users/yu/Documents/kaobeierp/warehouse-forward-port` on branch `codex/warehouse-forward-port`.
- Used only the isolated local Supabase project `codex-warehouse-phase4-task1`.
- No online Supabase write, Vercel deployment, Git push, or archived first-version change was performed.

## Implemented contracts

- Atomic multi-batch FIFO transfer between warehouses or shelves, preserving the original batch price and company total quantity.
- Monthly stocktake with gain, loss, damaged, scrapped, and no-change facts; zero-stock gain cost requires the independent cost-view permission and accepts an authoritative zero price.
- Whole-operation reversal for receipt, stock-out, return, transfer, and stocktake.
- Reversal appends opposite immutable movement facts, never deletes history, binds exact retry to actor and idempotency key, and rejects reversal-of-reversal.
- Formal-project stock-out/return reversals post an independent frozen-cost adjustment, including after project archival.
- Confirmed legacy receipt, stock-out, and return headers may only move to `void` through whole-operation reversal; confirmed/void lines remain immutable.
- Voided returns no longer consume remaining-returnable quantity or minor-work cost totals.
- Active confirmed returns must be reversed before their original stock-out can be reversed.

## Verification results

- Focused operation/service Node tests: **22 passed, 0 failed**.
- Operation pgTAP after a clean local database reset: **74 passed, 0 failed**.
- Full second-version Node suite: **1454 passed, 0 failed**.
- Production build: **passed** (`vite build`, 428 modules transformed).
- Migration replay from zero: **passed** through `202608080005_warehouse_operations_reports.sql`.
- `git diff --check`: **passed**.

The first full Node run was executed concurrently with a production build and one pre-existing Vite-backed purchase test could not write its temporary config file. The same test passed alone (22/22), and the full suite then passed sequentially; this was an execution-environment conflict, not a product regression.

Independent review found one Important response-boundary mismatch: the database could commit more than 500 movement facts while the client rejected the successful result. The database and client now share a 20,000-movement ceiling; transfer, stocktake, and reversal reject over-limit work inside the same database transaction before any visible commit, and the client accepts valid multi-batch responses within that ceiling.

## Not yet included

- Report/print/Excel work belongs to Phase 4 Task 2.
- Second-version shell navigation and visual integration belong to Phase 4 Task 3.
- Complete local business-scenario acceptance and the user-facing preview remain pending.
- No online deployment is authorized at this stage.

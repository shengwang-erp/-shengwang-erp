# Warehouse Forward-Port Local Acceptance

## Scope and safety boundary

- Acceptance target: `/Users/yu/Documents/kaobeierp/warehouse-forward-port`
- Branch: `codex/warehouse-forward-port`
- Exact deployed second-version baseline: commit `9774158`
- Isolated local Supabase workdir: `/private/tmp/codex-warehouse-phase4-task1`
- Local API/database ports: `61321` / `61322`
- No production deployment, remote Supabase migration, remote data write, Vercel command, or release push was performed.
- The archived first version and the dirty original second-version checkout were not modified.

## Business scenario proved

`supabase/tests/warehouse_end_to_end.sql` creates disposable local fixtures and proves the complete path:

1. secure warehouse/item/model-size catalog creation, manufacturer QR and system QR;
2. two purchase receipts at unit costs 100 and 130, confirmed only by the warehouse responsible person;
3. FIFO project issue with frozen historical cost 1,260;
4. partial return with cost 200 and matching negative project-cost adjustment;
5. minor-work and internal-use issue paths;
6. cross-warehouse shelf rejection, duplicate QR rejection, inactive/first-login denial, insufficient-stock rejection, and exact retry;
7. transfer with cost conservation, monthly stocktake, nine server-filtered reports/export reads, and whole-document reversal.

The scenario uses a transaction and rolls back its disposable data.

## Exact local verification results

| Gate | Result |
| --- | --- |
| Clean migration replay | `npx supabase db reset --workdir /private/tmp/codex-warehouse-phase4-task1` — PASS through migration `202608080005` |
| All ordinary pgTAP files | 17 files, 1,812 / 1,812 assertions PASS |
| End-to-end scenario (included above) | 42 / 42 PASS |
| Catalog/photo concurrency | `warehouse_catalog_concurrency.sql` — 11 / 11 PASS |
| Workflow/inventory concurrency | `warehouse_workflow_concurrency.sql` — 32 / 32 PASS |
| Forward-port pollution verifier | baseline `9774158`; 289 changed paths; 0 forbidden paths/imports/tokens; 0 byte-copied shared/adapted files — PASS |
| Verifier unit tests | 2 / 2 PASS |
| Full Node suite | Task 4: 1,485 / 1,485 PASS; Task 5 after the live-client fixes: `npm test` — 1,488 / 1,488 PASS |
| Production build | `npm run build` — 491 modules transformed, PASS |
| Patch whitespace | `git diff --check` — PASS |
| Task 5 forward-port verifier | baseline `9774158`; 291 changed paths; 0 forbidden paths/imports/tokens; 0 byte-copied shared/adapted files — PASS |

The concurrency drivers were made deterministic: they now drain every asynchronous libpq result before commit/rollback and wait for the intended advisory-lock synchronization point instead of relying only on fixed sleeps. No warehouse runtime rule was weakened for those fixes.

## Forward-port isolation result

`scripts/verify-warehouse-forward-port.mjs` fails closed if the migration diff contains archived/legacy modules, deployment or environment files, forbidden old auth/persistence imports, warehouse `localStorage`, direct `App.jsx` stock-in mutation, or byte-for-byte copies of shared/adapted source modules. The final local run reported zero violations.

## Task 5 local preview findings

- The dedicated preview is running from the exact second-version worktree at `http://127.0.0.1:5174/`, using only the isolated local Supabase target on ports `61321` / `61322` and `VITE_WAREHOUSE_MIGRATION_PREVIEW=true`.
- A disposable local SW-000 recovery account authenticated successfully. The page showed the second-version black/gold Home, the `仓库管理` card immediately before `我要出库`, and the local-only banner `第二版 + 仓库移植测试` inside the warehouse route.
- Current Supabase JS adds a boolean `success` metadata field to RPC envelopes. The three strict warehouse adapters initially rejected the otherwise-valid live responses. Test-first compatibility fixes now accept only a boolean `success`, reject `success: false` when no supplier error exists, and keep all unknown/accessor/forged fields fail-closed.
- Live authenticated local calls now pass for catalog, low-stock report, locations, balances, request context, catalog writes, and photo metadata listing. The photo success path used one temporary item/model pair with fixed test IDs; both rows were deleted immediately afterward and verified absent, so the local warehouse returned to empty.
- Browser inspection opened all five tabs without console warnings or errors: `库存总览`, `物品档案`, `出入库作业`, `月度盘点`, and `报表打印`. Verified surfaces include model/size/SKU/price/QR fields, normal/project/shared-tool warehouses and shelf zones, warehouse-confirmed stock change copy, transfer, whole-document reversal, monthly stocktake, nine report types, print/PDF, and Excel controls.
- Desktop black/gold integration is manually visible. Responsive CSS and mobile navigation contracts pass in the Node suite; final hands-on mobile-width acceptance remains for the user because the attached in-app tab cannot change its viewport.

## Known nonblocking limitations and pending acceptance

- Vite reports an advisory large-chunk warning for the existing main bundle and lazily loaded ExcelJS export bundle. The build succeeds; ExcelJS remains behind the warehouse report export path.
- A live `npm audit` was not performed because it would send local dependency metadata to the external npm audit endpoint, which is outside this local-only acceptance authority. The local test/build gates are unaffected.
- The real Storage HTTP upload/delete failure-injection harness, camera QR scan, printed label output, file download contents, and non-empty outbound/return/stocktake examples still require hands-on Task 5 acceptance. Their unit, pgTAP, concurrency, and launcher contracts pass; the empty local warehouse does not manufacture business records merely to make those screens non-empty.
- No claim of user acceptance or online-release readiness is made by this document. The dedicated local-only preview remains open for user inspection.

## Required next step

Keep the dedicated local preview open for user inspection. The user must verify the visible desktop/mobile experience and hands-on photo, QR/label, outbound/return, stocktake, print, and Excel flows before explicit acceptance. Online migration and deployment remain a separate later plan.

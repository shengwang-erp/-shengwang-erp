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
| Full Node suite | `npm test` — 1,485 / 1,485 PASS |
| Production build | `npm run build` — 491 modules transformed, PASS |
| Patch whitespace | `git diff --check` — PASS |

The concurrency drivers were made deterministic: they now drain every asynchronous libpq result before commit/rollback and wait for the intended advisory-lock synchronization point instead of relying only on fixed sleeps. No warehouse runtime rule was weakened for those fixes.

## Forward-port isolation result

`scripts/verify-warehouse-forward-port.mjs` fails closed if the migration diff contains archived/legacy modules, deployment or environment files, forbidden old auth/persistence imports, warehouse `localStorage`, direct `App.jsx` stock-in mutation, or byte-for-byte copies of shared/adapted source modules. The final local run reported zero violations.

## Known nonblocking limitations and pending acceptance

- Vite reports an advisory large-chunk warning for the existing main bundle and lazily loaded ExcelJS export bundle. The build succeeds; ExcelJS remains behind the warehouse report export path.
- A live `npm audit` was not performed because it would send local dependency metadata to the external npm audit endpoint, which is outside this local-only acceptance authority. The local test/build gates are unaffected.
- The real Storage HTTP photo harness and manual browser acceptance belong to Task 5 and must run against a dedicated clean local target before the final completion gate. Its launcher/unit contracts already pass in the 1,485-test Node suite.
- No claim of user acceptance or online-release readiness is made by this document. The next step is a local-only preview with `VITE_WAREHOUSE_MIGRATION_PREVIEW=true`.

## Required next step

Start the dedicated local preview only, verify black/gold desktop/mobile layouts, photo upload/delete, QR scan/labels, detailed outbound/return confirmation, monthly stocktake, printing and Excel download, then obtain explicit user approval. Online migration and deployment remain a separate later plan.

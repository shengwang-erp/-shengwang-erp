# Unified Project Cost Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one secure project-cost ledger that shows every ERP expense bound to a project, preserves immutable source records, applies immediate audited accounting adjustments and project splits, and produces readable print/PDF/Excel reports.

**Architecture:** A database-owned ledger function converts all project-bound business records into stable immutable source facts, excludes cancelled/deleted rows and warehouse-tracked direct purchases, then applies append-only adjustment and allocation events. A strict client service validates the secure RPC responses. The accounting UI consumes one ledger snapshot for table, summaries, print/PDF and Excel so every output agrees.

**Tech Stack:** React 19, Vite 6, Supabase PostgreSQL/RPC/RLS, Node test runner, pgTAP, ExcelJS 4.4, CSS named-page printing.

## Global Constraints

- Do not modify purchase, warehouse, labor, vehicle, tool or operating-expense source amounts from the accounting page.
- Project-bound active records count immediately; payment, arrival and invoice status do not delay cost recognition.
- Cancelled, voided and soft-deleted source records do not count.
- Accounting changes are effective immediately and append a permanent server-authored audit event.
- Positive and negative manual entries are supported; negative zero, non-finite values and values beyond four decimal yen places are rejected.
- Allocation rows must sum exactly to the current effective amount after safe fixed-point conversion.
- The existing warehouse purchase-tracking rule remains authoritative: a purchase represented by confirmed warehouse batches is not also counted as a direct purchase.
- Screen table body font is at least `15px`, row cell padding at least `12px 14px`, and print table body font is at least `10pt`.
- Default page size is `20`; allowed page sizes are exactly `20`, `50`, and `100`.
- Browser print and “Save as PDF” share one A4-landscape print sheet; Excel contains exactly `项目成本明细`, `分类汇总`, and `调整记录` sheets.
- Use existing dependencies only. ExcelJS must remain a literal dynamic import.
- Do not deploy or write to a shared/production Supabase project during implementation or verification. Database tests use an isolated local Supabase project only.
- Preserve the unrelated existing working-tree changes in `src/App.jsx`, `src/features/warehouse/purchaseWarehouseBridge.js`, and `src/features/warehouse/purchaseWarehouseBridge.test.js`; stage only the files belonging to each task.

---

### Task 1: Pure ledger domain and fixed-point rules

**Files:**
- Create: `src/features/project-cost-ledger/projectCostLedgerDomain.js`
- Create: `src/features/project-cost-ledger/projectCostLedgerDomain.test.js`
- Reuse: `src/features/cost-accounting/fixedPointCurrency.js`

**Interfaces:**
- Produces: `normalizeLedgerSnapshot(response)`, `buildLocalSourceFacts(input)`, `applyLedgerFilters(snapshot, filters)`, `paginateLedgerRows(rows, page, pageSize)`, `summarizeLedgerRows(rows)`, `buildAllocationAmounts(effectiveAmount, drafts)`.
- Produces immutable row shape: `{ sourceKey, sourceModule, sourceDocumentType, sourceDocumentId, projectId, projectName, category, date, description, originalAmount, adjustmentAmount, effectiveAmount, operator, adjusted, version, allocations, auditEvents }`.
- Consumes only plain own-data objects and safe arrays; accessors, inherited fields, symbols, sparse arrays and prototype-pollution keys fail closed.

- [ ] **Step 1: Write failing normalization and source-contract tests**

```js
test('normalizes a complete secure ledger row and freezes nested audit data', () => {
  const snapshot = normalizeLedgerSnapshot(READY_RESPONSE)
  assert.equal(snapshot.rows[0].effectiveAmount, 1200)
  assert.equal(snapshot.rows[0].adjusted, true)
  assert.throws(() => { snapshot.rows[0].auditEvents.push({}) }, TypeError)
})

test('rejects a supplier response with missing, inherited or accessor fields', () => {
  assert.throws(() => normalizeLedgerSnapshot({ status: 'ready' }), /ledger response/i)
  assert.throws(() => normalizeLedgerSnapshot(Object.create({ status: 'ready' })), /ledger response/i)
})

test('local source facts cover every project-bound demo expense without purchase duplication', () => {
  const facts = buildLocalSourceFacts(ALL_LOCAL_SOURCE_FIXTURES)
  assert.deepEqual(facts.map((row) => row.sourceModule), [
    'purchase', 'warehouse', 'labor', 'vehicle', 'tool', 'operating', 'manual',
  ])
})
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `node --test src/features/project-cost-ledger/projectCostLedgerDomain.test.js`  
Expected: FAIL because `projectCostLedgerDomain.js` and its exports do not exist.

- [ ] **Step 3: Implement strict snapshot normalization**

```js
export function normalizeLedgerSnapshot(response) {
  const source = exactObject(response, LEDGER_RESPONSE_FIELDS, 'project cost ledger response invalid')
  if (source.status !== 'ready') throw new TypeError('project cost ledger response invalid')
  const rows = exactArray(source.rows).map(normalizeLedgerRow)
  const categoryTotals = exactArray(source.categoryTotals).map(normalizeCategoryTotal)
  return deepFreeze({
    status: 'ready', generatedAt: instant(source.generatedAt),
    page: safeInteger(source.page, 1), pageSize: allowedPageSize(source.pageSize),
    totalRows: safeInteger(source.totalRows, 0), rows, categoryTotals,
    totalAmount: signedMoney(source.totalAmount),
    adjustmentTotal: signedMoney(source.adjustmentTotal),
    incompleteSources: exactArray(source.incompleteSources).map(sourceName),
  })
}
```

- [ ] **Step 4: Add failing filter, pagination, summary and allocation tests**

```js
test('filters by project, date, category, source, adjusted state and keyword', () => {
  const rows = applyLedgerFilters(SNAPSHOT, {
    projectId: 'P1', dateFrom: '2026-08-01', dateTo: '2026-08-31',
    category: '材料费', sourceModule: 'warehouse', adjusted: 'adjusted', keyword: '铜管',
  })
  assert.deepEqual(rows.map((row) => row.sourceKey), ['warehouse:SO-1'])
})

test('percentage allocations absorb only the final fixed-point remainder', () => {
  assert.deepEqual(buildAllocationAmounts(100, [
    { projectId: 'P1', mode: 'percent', value: 33.3333 },
    { projectId: 'P2', mode: 'percent', value: 66.6667 },
  ]), [{ projectId: 'P1', amount: 33.3333 }, { projectId: 'P2', amount: 66.6667 }])
})
```

- [ ] **Step 5: Implement the pure read-model helpers**

Use `toSignedFourDecimalUnits()` and `fromFourDecimalUnits()` for every addition, subtraction and allocation comparison. `summarizeLedgerRows()` returns `{ totalAmount, adjustmentTotal, rowCount, categoryTotals }` sorted by the fixed category order `人工费, 材料费, 车辆费, 工具费, 外包费, 运输费, 经营费用, 其他费用`.

- [ ] **Step 6: Run Task 1 tests and commit**

Run: `node --test src/features/project-cost-ledger/projectCostLedgerDomain.test.js`  
Expected: PASS.  
Commit: `git commit -m "feat: add project cost ledger domain"`

---

### Task 2: Database ledger schema and secure read model

**Files:**
- Create: `supabase/migrations/202608090001_project_cost_ledger.sql`
- Create: `supabase/tests/project_cost_ledger.sql`
- Modify: `docs/supabase-schema.sql`
- Modify: `docs/supabase-schema.md`

**Interfaces:**
- Produces tables `project_cost_manual_entries`, `project_cost_adjustment_events`, and `project_cost_allocation_events`.
- Produces private helper `private_project_cost_source_facts()` with stable typed columns.
- Produces authenticated RPC `list_project_cost_ledger_secure(p_filters jsonb default '{}'::jsonb)` returning the exact response consumed by `normalizeLedgerSnapshot()`.
- Reuses `public.is_current_employee_active()`, `public.has_current_permission(text)`, warehouse source keys in `project_cost_records`, and the labor-accounting confirmed project allocation rules.

- [ ] **Step 1: Write failing pgTAP schema, privilege and source-union tests**

The test must insert one record for every source family and prove these exact outcomes:

```sql
select has_table('public', 'project_cost_adjustment_events');
select has_function('public', 'list_project_cost_ledger_secure', array['jsonb']);
select function_privs_are(
  'public', 'list_project_cost_ledger_secure', array['jsonb'],
  'authenticated', array['EXECUTE']
);
select isnt_empty($$select 1 from public.list_project_cost_ledger_secure('{}')$$);
```

Fixtures cover direct purchase, warehouse project issue, warehouse reversal, confirmed labor allocation, project fuel, vehicle expense, vehicle repair, project tool responsibility expense, operating expense and legacy manual project cost.

- [ ] **Step 2: Run the SQL test in an isolated local Supabase project and verify RED**

Run these commands from the repository root; `LEDGER_DB_WORKDIR` is task-specific and never points at a linked project:

```bash
LEDGER_DB_WORKDIR="$(mktemp -d /private/tmp/kaobeierp-project-cost-ledger.XXXXXX)"
rsync -a supabase/ "$LEDGER_DB_WORKDIR/supabase/"
npx supabase start --exclude analytics,edge-runtime,functions,imgproxy,inbucket,kong,meta,realtime,rest,storage,studio,vector --workdir "$LEDGER_DB_WORKDIR"
npx supabase db reset --local --workdir "$LEDGER_DB_WORKDIR"
npx supabase test db "$LEDGER_DB_WORKDIR/supabase/tests/project_cost_ledger.sql" --local --workdir "$LEDGER_DB_WORKDIR"
```

Expected: FAIL because the three tables and secure RPC are absent. Do not point the CLI at a shared project.

- [ ] **Step 3: Create append-only typed tables**

```sql
create table public.project_cost_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  sequence_no bigint not null,
  amount_before numeric(18,4) not null,
  adjustment_amount numeric(18,4) not null,
  amount_after numeric(18,4) not null,
  reason text not null,
  actor_employee_profile_id uuid not null references public.employee_profiles(id),
  actor_name text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (source_key, sequence_no)
);
```

Create `project_cost_allocation_events` with `source_key`, `sequence_no`, `amount_snapshot numeric(18,4)`, `allocations jsonb`, `reason`, server actor and timestamp. Create `project_cost_manual_entries` with immutable `source_key`, project, category, date, signed original amount, description, operator, creator and server timestamp. Enable RLS, deny direct authenticated table mutation, revoke `TRUNCATE`, and allow access only through the secure functions.

- [ ] **Step 4: Implement the private source-fact union**

Return these columns from each branch: `source_key`, `source_module`, `source_document_type`, `source_document_id`, `project_id`, `project_name`, `category`, `cost_date`, `description`, `original_amount`, `operator`.

Use stable prefixes: `purchase:`, `warehouse:`, `labor:`, `vehicle-fuel:`, `vehicle-expense:`, `vehicle-issue:`, `tool-responsibility:`, `operating:`, `legacy-manual:`, `manual:`. Filter `status <> 'deleted'`, business cancellation states, missing project ids and invalid amounts. Exclude a direct purchase when its record key is present in the authoritative warehouse `sourcePurchaseRecordKeys` set. Vehicle issue repair cost and other bound records count immediately regardless of payment, arrival, invoice or resolution status. For a project-bound tool responsibility record, the gross project cost is `toolValue` when `issueType = '丢失'`; otherwise it is `repairCost`. Employee compensation remains a separate recovery fact and does not silently reduce the gross project expense.

- [ ] **Step 5: Implement secure filtered reads**

`list_project_cost_ledger_secure()` must:

1. require an active employee and `module.project_costs.view`;
2. accept only `projectId`, `dateFrom`, `dateTo`, `category`, `sourceModule`, `adjusted`, `keyword`, `page`, `pageSize`;
3. require page size in `20, 50, 100` and bounded keyword/date values;
4. apply the latest adjustment and allocation event per source key;
5. emit one row per final project allocation;
6. return page rows, total count, category totals, total amount, adjustment total, generated time and an empty `incompleteSources` only when all source queries completed;
7. order by date descending, then source key and allocation project id.

All public ledger functions are `SECURITY DEFINER` with an empty fixed `search_path`; revoke execution from `public` and `anon`, and grant only the documented authenticated/service-role access. Private source helpers are not executable by client roles.

- [ ] **Step 6: Add security, cancellation, recognition and anti-double-count tests**

Assert that an accountant with only `module.project_costs.view` can read all ledger sources without purchase/warehouse/vehicle/tool module permissions; inactive and unauthorized users fail with `42501`; cancelled/deleted rows disappear; unpaid/unarrived/uninvoiced project purchases still count; warehouse-tracked purchases appear only through the warehouse cost; invalid supplier JSON never becomes a zero-valued row.

- [ ] **Step 7: Run Task 2 SQL tests and commit**

Refresh the isolated fixture with `rsync -a supabase/ "$LEDGER_DB_WORKDIR/supabase/"`, then run `npx supabase db reset --local --workdir "$LEDGER_DB_WORKDIR"` and `npx supabase test db "$LEDGER_DB_WORKDIR/supabase/tests/project_cost_ledger.sql" --local --workdir "$LEDGER_DB_WORKDIR"`.  
Expected: all assertions PASS.  
Commit: `git commit -m "feat: add secure project cost ledger read model"`

---

### Task 3: Secure adjustments, allocations and manual entries

**Files:**
- Modify: `supabase/migrations/202608090001_project_cost_ledger.sql`
- Modify: `supabase/tests/project_cost_ledger.sql`
- Create: `supabase/tests/project_cost_ledger_concurrency.mjs`
- Modify: `docs/supabase-schema.sql`
- Modify: `docs/supabase-schema.md`

**Interfaces:**
- Produces `create_project_cost_adjustment_secure(p_source_key text, p_expected_version bigint, p_adjustment_amount numeric, p_reason text)`.
- Produces `replace_project_cost_allocations_secure(p_source_key text, p_expected_version bigint, p_reason text, p_allocations jsonb)`.
- Produces `create_manual_project_cost_secure(p_request_id uuid, p_entry jsonb)`.
- Produces `list_project_cost_audit_secure(p_filters jsonb default '{}'::jsonb)` for print and Excel audit sheets.

- [ ] **Step 1: Write failing mutation tests**

```sql
select lives_ok($$select public.create_project_cost_adjustment_secure(
  'warehouse:WAREHOUSE-SO-1', 0, 250.0000, '发票差额调整'
)$$);
select is(
  (public.list_project_cost_ledger_secure('{"projectId":"P1"}'::jsonb)->>'totalAmount')::numeric,
  1250.0000::numeric
);
```

Also test a negative adjustment, a negative manual entry, two-project amount split, percentage-derived fixed amounts, stale version conflict, empty reason, invalid project, unbalanced allocation, direct table update/delete/truncate and a second manual call with the same request id.

- [ ] **Step 2: Run the SQL test and verify RED**

Refresh and reset the same isolated workdir, then run `npx supabase test db "$LEDGER_DB_WORKDIR/supabase/tests/project_cost_ledger.sql" --local --workdir "$LEDGER_DB_WORKDIR"`.  
Expected: FAIL because the four RPCs do not exist.

- [ ] **Step 3: Implement adjustment mutation with server audit**

Lock the source key using a transaction-scoped advisory lock, recompute the source fact and latest effective amount inside the database, compare `p_expected_version`, validate a nonblank reason up to 2000 characters, calculate four-decimal `amount_after`, and insert one event using the current employee profile and `statement_timestamp()`. Never trust client-supplied original amount, actor or time.

- [ ] **Step 4: Implement allocation replacement**

Validate a plain JSON array of at most 100 unique active project ids. Convert every amount to numeric `(18,4)` and require the sum to equal the current effective amount exactly. Store the complete allocation snapshot as a new event; do not update or delete the previous event.

- [ ] **Step 5: Implement idempotent manual entry creation**

Require `module.project_costs.create`, exact fields `projectId, category, date, amount, description, operator, reason`, valid active project and signed four-decimal amount. Derive `source_key = 'manual:' || p_request_id`, return the existing exact entry for a replay, and reject a reused id with different content.

- [ ] **Step 6: Implement immutable audit reads**

`list_project_cost_audit_secure()` returns adjustment and allocation events in server order with `eventType`, `sourceKey`, `sequenceNo`, `amountBefore`, `amountAfter`, `adjustmentAmount`, `allocationsBefore`, `allocationsAfter`, `reason`, `actorName`, and `createdAt`. It requires project-cost view permission and applies the same project/date filters as the printable ledger snapshot.

- [ ] **Step 7: Verify SQL mutation and concurrency behavior, then commit**

Implement `project_cost_ledger_concurrency.mjs` to read only the isolated local API URL and anon key printed by `npx supabase status --output env --workdir "$LEDGER_DB_WORKDIR"`, sign in two fixture accountant sessions, release two `create_project_cost_adjustment_secure` calls behind one promise barrier, and assert exactly one succeeds while the other receives `PROJECT_COST_LEDGER_VERSION_CONFLICT`. Run:

```bash
npx supabase test db "$LEDGER_DB_WORKDIR/supabase/tests/project_cost_ledger.sql" --local --workdir "$LEDGER_DB_WORKDIR"
node supabase/tests/project_cost_ledger_concurrency.mjs --workdir "$LEDGER_DB_WORKDIR"
```

Expected: all pgTAP assertions PASS and no partial audit rows remain.  
Commit: `git commit -m "feat: add audited project cost adjustments"`

---

### Task 4: Strict project-cost ledger client service

**Files:**
- Create: `src/services/projectCostLedgerService.js`
- Create: `src/services/projectCostLedgerService.test.js`
- Create: `src/features/project-cost-ledger/projectCostLedgerDemoService.js`
- Create: `src/features/project-cost-ledger/projectCostLedgerDemoService.test.js`

**Interfaces:**
- Produces `createProjectCostLedgerService(client, { configured })` with methods `list(filters)`, `listAudit(filters)`, `adjust(request)`, `replaceAllocations(request)`, and `createManual(request)`.
- Produces `createProjectCostLedgerDemoService({ getSources, eventStore })` with the same five methods for the explicit development-only local acceptance path. The module never reads an environment flag; `App.jsx` alone decides whether to construct it.
- All methods normalize via Task 1 and expose `ProjectCostLedgerServiceError` with safe user messages and `authInvalid` for expired sessions.

- [ ] **Step 1: Write failing exact-RPC and hostile-response tests**

```js
test('list sends only normalized filters to the secure ledger RPC', async () => {
  const service = createProjectCostLedgerService(client, { configured: true })
  await service.list({ projectId: 'P1', page: 1, pageSize: 20 })
  assert.deepEqual(calls, [['list_project_cost_ledger_secure', {
    p_filters: { projectId: 'P1', page: 1, pageSize: 20 },
  }]])
})
```

Test unknown input keys, oversized text, invalid dates, sparse allocation arrays, inherited values, response accessors, raw SQL messages, auth errors and the documented version conflict.

The demo-service tests use `buildLocalSourceFacts()` and prove immediate adjustments, allocations and signed manual entries without network calls. They also prove warehouse-tracked purchases are excluded and source fixture objects are never mutated.

- [ ] **Step 2: Run service tests and verify RED**

Run: `node --test src/services/projectCostLedgerService.test.js`  
Expected: FAIL because the service module is absent.

- [ ] **Step 3: Implement strict request/response adapters**

Map only documented SQL hints to safe codes: `PROJECT_COST_LEDGER_INPUT_INVALID`, `PROJECT_COST_LEDGER_ACCESS_DENIED`, `PROJECT_COST_LEDGER_VERSION_CONFLICT`, `PROJECT_COST_LEDGER_ALLOCATION_UNBALANCED`, `PROJECT_COST_LEDGER_SOURCE_MISSING`, `AUTH_SESSION_INVALID`, and `PROJECT_COST_LEDGER_SERVICE_UNAVAILABLE`. Do not expose supplier messages, payloads or SQL details.

- [ ] **Step 4: Implement the development-only demo adapter**

Keep append-only adjustment, allocation and manual events in the injected `eventStore`, generate the same immutable snapshot shape as the secure RPC, and reject stale versions exactly like the production service. This adapter exists only so the user’s explicit local demo can be accepted before deployment; production selection remains the secure RPC.

- [ ] **Step 5: Run service tests and commit**

Run: `node --test src/services/projectCostLedgerService.test.js src/features/project-cost-ledger/projectCostLedgerDemoService.test.js src/features/project-cost-ledger/projectCostLedgerDomain.test.js`  
Expected: PASS.  
Commit: `git commit -m "feat: add project cost ledger service"`

---

### Task 5: App integration and project-bound tool expenses

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/auth/businessAccess.js`
- Modify: `src/auth/businessAccess.test.js`
- Modify: `src/auth/businessAccessIntegration.test.js`
- Create: `src/features/project-cost-ledger/projectCostLedgerAppIntegration.test.js`

**Interfaces:**
- Creates one configured `projectCostLedgerService` singleton and loads it only while the authorized accounting/project-cost section is active.
- Selects `createProjectCostLedgerDemoService()` only inside the existing exact `localDemoMode` branch so the current `127.0.0.1` acceptance environment remains functional without cloud writes.
- Passes `{ service, access, projects }` into `ProjectCostLedgerSection`.
- Extends tool responsibility normalization and form payloads with `allocateToProject`, `projectId`, and `projectName` so repair cost can become a project-bound expense.

- [ ] **Step 1: Write failing access and app-wiring tests**

Assert that project-cost view permission enables ledger reads without purchase, warehouse, vehicle or tool permissions; project-cost create/update controls manual and adjustment operations; denied users never instantiate a ledger request; auth invalidation logs out; stale responses from a prior account cannot populate the next account.

- [ ] **Step 2: Run focused integration tests and verify RED**

Run: `node --test src/auth/businessAccess.test.js src/features/project-cost-ledger/projectCostLedgerAppIntegration.test.js`  
Expected: FAIL because the service and page wiring are absent.

- [ ] **Step 3: Integrate the ledger lifecycle**

Use an actor-and-permission fingerprint plus a monotonically increasing request sequence. Clear rows on account change, permission loss or route exit. Represent states as `idle | loading | ready | error | forbidden`; never replace a failed source with an empty successful result.

- [ ] **Step 4: Add project binding to tool responsibility expenses**

When the responsibility record has a positive gross cost (`toolValue` for `丢失`, otherwise `repairCost`), show an optional “计入项目成本” checkbox and project selector. Persist only the project id/name chosen by the user. Existing records without those fields remain company-level and do not appear in the ledger.

- [ ] **Step 5: Run focused tests and commit**

Run: `node --test src/auth/businessAccess.test.js src/auth/businessAccessIntegration.test.js src/features/project-cost-ledger/projectCostLedgerAppIntegration.test.js`  
Expected: PASS.  
Commit: `git commit -m "feat: connect accounting to the project cost ledger"`

---

### Task 6: Readable ledger table, filters, summaries and pagination

**Files:**
- Create: `src/features/project-cost-ledger/ProjectCostLedgerSection.jsx`
- Create: `src/features/project-cost-ledger/ProjectCostLedgerSection.test.js`
- Create: `src/features/project-cost-ledger/projectCostLedger.css`
- Modify: `src/App.jsx` to replace the legacy `ProjectCostSection` rendering path while retaining legacy record data as a source.

**Interfaces:**
- `ProjectCostLedgerSection({ service, access, projects, initialSnapshot })`.
- Uses Task 1 filters and Task 4 service responses.
- Emits no direct source-record mutation.

- [ ] **Step 1: Write failing SSR and interaction tests**

Test the following visible contract:

```js
assert.match(html, /项目总成本/u)
assert.match(html, /会计净调整/u)
assert.match(html, /原金额/u)
assert.match(html, /最终金额/u)
assert.match(html, /已调整/u)
```

Interaction tests cover applying and clearing filters, dirty filters not relabeling the last successful snapshot, page sizes `20/50/100`, next/previous page, expanded audit details, incomplete-source alert, retry, and disabled export/print while the current filters are unapplied.

- [ ] **Step 2: Run component tests and verify RED**

Run: `node --test src/features/project-cost-ledger/ProjectCostLedgerSection.test.js`  
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the page shell**

Render, in order: action bar, filter panel, four headline summary cards, category subtotal cards, responsive table and pagination. Table columns are `日期, 费用类别, 来源, 业务单号, 费用说明, 原金额, 会计调整, 最终金额, 项目/拆分, 经办人, 调整标记, 操作`. Amounts are right-aligned and bold. Rows expand to show source detail, allocations and audit timeline.

- [ ] **Step 4: Implement the readable visual contract**

```css
.project-cost-ledger-table { min-width: 1380px; font-size: 15px; }
.project-cost-ledger-table th,
.project-cost-ledger-table td { padding: 12px 14px; line-height: 1.55; }
.project-cost-ledger-amount { text-align: right; font-weight: 700; white-space: nowrap; }
.project-cost-ledger-category-start td { border-top-width: 2px; }
```

Use horizontal scrolling on narrow screens, never shrink body text below `15px`, and keep action buttons outside the horizontal table scroller.

- [ ] **Step 5: Run component and theme regression tests, then commit**

Run: `node --test src/features/project-cost-ledger/ProjectCostLedgerSection.test.js src/blackGoldTheme.test.js src/semanticThemeSurfaces.test.js`  
Expected: PASS with no white or blue legacy surface.  
Commit: `git commit -m "feat: add readable project cost ledger table"`

---

### Task 7: Adjustment, split and manual-entry dialogs

**Files:**
- Create: `src/features/project-cost-ledger/ProjectCostAdjustmentDialog.jsx`
- Create: `src/features/project-cost-ledger/ProjectCostAllocationDialog.jsx`
- Create: `src/features/project-cost-ledger/ProjectCostManualEntryDialog.jsx`
- Create: `src/features/project-cost-ledger/projectCostLedgerDialogs.test.js`
- Modify: `src/features/project-cost-ledger/ProjectCostLedgerSection.jsx`
- Modify: `src/features/project-cost-ledger/projectCostLedger.css`

**Interfaces:**
- Adjustment submits `{ sourceKey, expectedVersion, adjustmentAmount, reason }`.
- Allocation submits `{ sourceKey, expectedVersion, reason, allocations: [{ projectId, amount }] }`.
- Manual entry submits `{ requestId, projectId, category, date, amount, description, operator, reason }`.

- [ ] **Step 1: Write failing dialog behavior tests**

Cover signed amount entry, required reasons, computed before/after preview, percentage and amount split modes, duplicate-project rejection, allocation balance message, request-id stability across retries, permission-disabled buttons, server conflict recovery and refreshed effective row after success.

- [ ] **Step 2: Run dialog tests and verify RED**

Run: `node --test src/features/project-cost-ledger/projectCostLedgerDialogs.test.js`  
Expected: FAIL because the dialog components are absent.

- [ ] **Step 3: Implement amount adjustment and manual entry dialogs**

Show current original, accumulated adjustment and effective amount. Treat the entered adjustment as a signed delta. Generate the manual request UUID once when the dialog opens and retain it until a successful response or explicit cancel.

- [ ] **Step 4: Implement allocation dialog**

Allow rows to switch between percentage and amount display, but submit fixed amounts from `buildAllocationAmounts()`. Show live allocated total and remaining difference in large readable text; disable save until the difference is exactly zero and every project is unique.

- [ ] **Step 5: Refresh safely after mutations and commit**

After success, reload the currently applied filter snapshot and reopen the expanded row. On version conflict, retain the user’s reason and draft values, display the safe conflict message, and offer a refresh button.  
Run: `node --test src/features/project-cost-ledger/projectCostLedgerDialogs.test.js src/features/project-cost-ledger/ProjectCostLedgerSection.test.js`  
Expected: PASS.  
Commit: `git commit -m "feat: add project cost accounting adjustments"`

---

### Task 8: Excel, print and PDF output

**Files:**
- Create: `src/features/project-cost-ledger/projectCostLedgerExport.js`
- Create: `src/features/project-cost-ledger/projectCostLedgerExport.test.js`
- Create: `src/features/project-cost-ledger/ProjectCostPrintSheet.jsx`
- Create: `src/features/project-cost-ledger/ProjectCostPrintSheet.test.js`
- Create: `src/features/project-cost-ledger/projectCostLedgerPrint.css`
- Modify: `src/features/project-cost-ledger/ProjectCostLedgerSection.jsx`

**Interfaces:**
- Produces `createProjectCostWorkbook(ExcelJS, ledgerSnapshot, auditSnapshot, metadata)`.
- Produces `exportProjectCostXlsx(ledgerSnapshot, auditSnapshot, metadata)` with literal `import('exceljs')`.
- Produces `printProjectCostReport(printOperation = globalThis.print, documentRef = globalThis.document)`.
- `ProjectCostPrintSheet` receives the same immutable applied snapshot shown on screen plus its matching audit snapshot.

- [ ] **Step 1: Write failing Excel workbook tests**

Create an in-memory workbook and assert exactly three sheets, frozen header rows, autofilters, currency number formats, category subtotal formulas/values, project total, audit actor/time/reason fields, safe escaping of text beginning with `= + - @`, page orientation landscape and readable column widths.

- [ ] **Step 2: Run export tests and verify RED**

Run: `node --test src/features/project-cost-ledger/projectCostLedgerExport.test.js`  
Expected: FAIL because the export module is absent.

- [ ] **Step 3: Implement the three-sheet workbook and download**

Use sheet names exactly `项目成本明细`, `分类汇总`, `调整记录`. Title rows contain company, project/filter summary, generated time and report completeness. Freeze the business header row, repeat it when printing, format money as `¥#,##0.0000;[Red]-¥#,##0.0000`, and set an A4-landscape fit-to-width print area.

- [ ] **Step 4: Write failing print/PDF contract tests**

Assert one named `@page project-cost-ledger`, main table grouped by category with subtotals, a project grand total, `已调整` marks, a separate audit appendix, repeated table headers, company/project/date/generated-time header and body font of at least `10pt`. Verify the body print class exists only during `print()` and is restored on success and failure.

- [ ] **Step 5: Implement print sheet and PDF entry**

The “打印” and “导出 PDF” buttons both open the browser’s native print dialog with the isolated A4 landscape sheet; the PDF button includes helper text `在打印窗口选择“另存为 PDF”`. Do not add a PDF runtime dependency. Disable both actions while filters are dirty, data is incomplete or the matching audit snapshot is not ready.

- [ ] **Step 6: Run export/print tests and commit**

Run: `node --test src/features/project-cost-ledger/projectCostLedgerExport.test.js src/features/project-cost-ledger/ProjectCostPrintSheet.test.js src/features/project-cost-ledger/ProjectCostLedgerSection.test.js`  
Expected: PASS.  
Commit: `git commit -m "feat: export and print project cost ledger"`

---

### Task 9: Accounting summaries, regression verification and operations notes

**Files:**
- Modify: `src/features/cost-accounting/costAccountingDomain.js`
- Modify: `src/features/cost-accounting/costAccountingDomain.test.js`
- Modify: `src/features/cost-accounting/costAccountingAppIntegration.test.js`
- Create: `docs/project-cost-ledger-operations.md`
- Modify: `docs/supabase-schema.md`

**Interfaces:**
- Adds `projectLedgerSummary` as the authoritative project-cost composition for accounting project/month totals when its state is `ready`.
- Keeps company salary and non-project operating summaries separate.
- Never falls back to a zero or stale legacy sum when the ledger state is incomplete.

- [ ] **Step 1: Write failing accounting-summary replacement tests**

Prove that adjusted, split and negative manual rows change the project monthly/lifetime totals exactly once; the old direct purchase plus warehouse amount cannot be added again; incomplete ledger state produces an explicit incomplete result rather than zero; screen summary, print summary and Excel summary share identical fixed-point totals.

- [ ] **Step 2: Run focused accounting tests and verify RED**

Run: `node --test src/features/cost-accounting/costAccountingDomain.test.js src/features/cost-accounting/costAccountingAppIntegration.test.js`  
Expected: FAIL because the ledger summary input is not consumed.

- [ ] **Step 3: Wire the authoritative ledger summary**

Replace only the project-cost composition path. Do not add the new ledger total to the legacy source totals. Preserve existing salary, purchase-payment cash flow and company operating-expense behavior.

- [ ] **Step 4: Write operations and recovery instructions**

Document permissions, source recognition, adjustment audit semantics, allocation rules, print/PDF workflow, Excel sheets, version-conflict recovery, incomplete-source behavior and the exact isolated-local verification commands. State explicitly that source business records are unchanged by accounting adjustments.

- [ ] **Step 5: Run focused feature regression**

Run all project-cost-ledger, cost-accounting, warehouse-accounting, purchase-accounting, labor-accounting, vehicle/tool App integration, permission and theme tests.  
Expected: all focused tests PASS with zero failures.

- [ ] **Step 6: Run full verification**

Run:

```bash
npm test
npm run build
npm run verify:local-demo-security
git diff --check
```

Expected: all tests PASS, Vite build succeeds, local-demo security verification succeeds, and `git diff --check` prints no errors. The existing Vite large-chunk warning is non-blocking unless this feature adds a new eager import.

- [ ] **Step 7: Browser acceptance**

Using the local development server, verify: enter 会计成本中心 → 项目成本; apply project/date/category/source/adjusted filters; inspect 20/50/100 pagination; add positive and negative manual rows; adjust one automatic warehouse row; split one row across two projects; expand audit; export Excel; open print and PDF paths; confirm no white/blue legacy surfaces and text is not small or crowded.

- [ ] **Step 8: Commit final integration**

Stage only the files listed in this plan and verify the three pre-existing unrelated modified files remain preserved if they were not intentionally included in a task.  
Commit: `git commit -m "feat: complete unified project cost accounting"`

# Purchase Accounting Data Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show procurement orders and real payment cash flow in the accounting cost center and make the owner dashboard consume the same non-duplicating purchase accounting model.

**Architecture:** Add one pure purchase-accounting read model over the existing purchase and payment records. The accounting UI, monthly summary, project rollups, and dashboard all consume that model; purchase order cost remains accrual cost while payment ledger amounts remain cash-flow facts.

**Tech Stack:** React 19, Vite 6, Node test runner, existing Supabase JSONB record tables and RLS.

## Global Constraints

- Do not copy purchase rows into `project_cost_records` or `operating_expense_records`.
- Count each active purchase order once by `purchaseDate`; count each unique payment once by `paymentDate`.
- Do not add payment cash flow to project cost or company total cost after the purchase order cost is included.
- Preserve all unrelated modified and untracked files in the worktree.
- Keep the accounting purchase view read-only; corrections remain in Procurement Management.
- No new dependencies and no CSS edits in the already-modified `src/styles.css`.

---

### Task 1: Purchase accounting domain model

**Files:**
- Create: `src/features/purchase-accounting/purchaseAccountingDomain.js`
- Create: `src/features/purchase-accounting/purchaseAccountingDomain.test.js`

**Interfaces:**
- Consumes: `{ purchaseRecords, paymentRecords, month, projectId?, source? }`.
- Produces: `buildPurchaseAccountingReadModel(input)`, `filterPurchaseAccountingRows(rows, filters)`, `recalculatePurchasePaymentCache(purchase, payments)`, and `canApplyPurchasePayment(purchase, payments, amount)`.

- [ ] **Step 1: Write failing cross-month and no-double-count tests**

```js
test('separates July purchase cost from August payment cash flow', () => {
  const july = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase({ purchaseDate: '2026-07-10', totalCost: 10000 })],
    paymentRecords: [payment({ paymentDate: '2026-08-02', jpyAmount: 6000 })],
    month: '2026-07',
  })
  const august = buildPurchaseAccountingReadModel({
    purchaseRecords: [purchase({ purchaseDate: '2026-07-10', totalCost: 10000 })],
    paymentRecords: [payment({ paymentDate: '2026-08-02', jpyAmount: 6000 })],
    month: '2026-08',
  })
  assert.equal(july.summary.monthPurchaseCost, 10000)
  assert.equal(july.summary.monthPaymentCash, 0)
  assert.equal(august.summary.monthPurchaseCost, 0)
  assert.equal(august.summary.monthPaymentCash, 6000)
  assert.equal(august.summary.currentOutstanding, 4000)
})
```

- [ ] **Step 2: Run the domain test and verify RED**

Run: `node --test src/features/purchase-accounting/purchaseAccountingDomain.test.js`

Expected: FAIL because `purchaseAccountingDomain.js` does not exist.

- [ ] **Step 3: Implement the minimal read model**

```js
export function buildPurchaseAccountingReadModel({
  purchaseRecords = [], paymentRecords = [], month = '', projectId = '', source = '',
} = {}) {
  // Normalize finite integer amounts, deduplicate IDs, join payments to active
  // purchases, derive opening/ledger paid amounts, outstanding balances,
  // monthly purchase cost, monthly payment cash, and anomaly records.
}
```

- [ ] **Step 4: Add and pass edge-case tests**

Cover void purchases, orphan/duplicate payments, overpayment, legacy opening payment, invalid amounts, project/source filters, payment-cache recalculation, and overpayment prevention.

Run: `node --test src/features/purchase-accounting/purchaseAccountingDomain.test.js`

Expected: all domain tests PASS.

- [ ] **Step 5: Commit the domain model**

```bash
git add src/features/purchase-accounting/purchaseAccountingDomain.js src/features/purchase-accounting/purchaseAccountingDomain.test.js
git commit -m "feat: add purchase accounting read model"
```

### Task 2: Read-only procurement reconciliation in accounting

**Files:**
- Create: `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- Create: `src/features/purchase-accounting/purchaseAccountingSection.test.js`
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `projects`, `purchaseRecords`, `purchasePaymentRecords`, `monthFilter`, and `onMonthFilterChange`.
- Produces: a read-only `PurchaseAccountingSection` with summary cards, filters, warnings, and purchase detail table.

- [ ] **Step 1: Write failing component and App contract tests**

```js
test('renders order cost, payment cash, current payable, and source notice', () => {
  const html = renderToStaticMarkup(
    <PurchaseAccountingSection
      projects={projects}
      purchaseRecords={purchases}
      purchasePaymentRecords={payments}
      monthFilter="2026-08"
      onMonthFilterChange={() => {}}
    />,
  )
  assert.match(html, /本月采购确认成本/)
  assert.match(html, /本月采购付款/)
  assert.match(html, /当前采购应付余额/)
  assert.match(html, /数据来源：采购管理/)
})
```

The App contract must require a `purchaseAccounting` tab and forwarding of `purchasePaymentRecords` to both `AccountingCostPage` and `MonthlySummarySection`.

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/features/purchase-accounting/purchaseAccountingSection.test.js`

Expected: FAIL because the component and wiring do not exist.

- [ ] **Step 3: Implement the component with existing style classes**

Use `accounting-entry`, `filter-panel`, `field`, `stats-grid`, `stat-card`, `payment-table-wrap`, `payment-table`, `empty-state`, and `cost-note`. Do not modify `src/styles.css`.

- [ ] **Step 4: Wire the accounting page and monthly summary**

Add `purchasePaymentRecords` to the accounting route and component props. Replace monthly cached `paidAmount` calculations with the shared model. Keep `totalCost` in company total cost and display payment cash separately.

- [ ] **Step 5: Run and commit**

Run: `node --test src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js`

Expected: PASS.

```bash
git add src/App.jsx src/features/purchase-accounting/PurchaseAccountingSection.jsx src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js
git commit -m "feat: show procurement reconciliation in accounting"
```

### Task 3: Owner-dashboard and data-loader linkage

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/services/dashboardService.js`
- Modify: `src/services/dashboardService.test.js`
- Modify: `src/features/purchase-accounting/purchaseAccountingSection.test.js`

**Interfaces:**
- Consumes: the Task 1 read model and `purchasePaymentRecords` supplied by `AuthenticatedApp`.
- Produces: shared dashboard purchase statistics and project rows using derived paid/outstanding values.

- [ ] **Step 1: Write failing loader and dashboard wiring tests**

```js
test('dashboard safe source projection includes purchase payment facts', async () => {
  const result = await getDashboardSourceData({
    employees: [], projects: [], laborRecords: [], purchaseRecords: [],
    purchasePaymentRecords: [{ paymentId: 'PP-1' }], inventoryItems: [],
    vehicleUsageRecords: [], lifelongToolAssignments: [], toolResponsibilityRecords: [],
  })
  assert.deepEqual(result.purchasePaymentRecords, [{ paymentId: 'PP-1' }])
})
```

App integration must assert that `DashboardPage` receives `purchasePaymentRecords`, builds one shared model, and uses its rows for project paid/unpaid figures.

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/services/dashboardService.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js`

Expected: FAIL because payment facts are not loaded or wired.

- [ ] **Step 3: Implement shared dashboard linkage**

Add current-month payment cash, current payable, and anomaly count cards. Use the shared row `totalCost`, `paidAmount`, and `unpaidAmount` in project detail and profit calculations without adding payments to cost.

- [ ] **Step 4: Run and commit**

Run: `node --test src/services/dashboardService.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js`

Expected: PASS.

```bash
git add src/App.jsx src/services/dashboardService.js src/services/dashboardService.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js
git commit -m "feat: link procurement payments to owner dashboard"
```

### Task 4: Keep purchase payment cache consistent

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/features/purchase-accounting/purchaseAccountingDomain.test.js`
- Modify: `src/features/purchase-accounting/purchaseAccountingSection.test.js`

**Interfaces:**
- Consumes: `recalculatePurchasePaymentCache` and `canApplyPurchasePayment` from Task 1.
- Produces: stable `openingPaidAmount`, prevented overpayment, and cache recalculation after payment add/delete.

- [ ] **Step 1: Add failing integration contracts**

Assert that purchase normalization preserves `openingPaidAmount`, payment submit calls the overpayment guard, and payment deletion recalculates the linked purchase with remaining payments.

- [ ] **Step 2: Run and verify RED**

Run: `node --test src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js`

Expected: FAIL on missing App integration.

- [ ] **Step 3: Implement cache consistency**

Set `openingPaidAmount` on new purchases, calculate the next payment list before updating a purchase, reject `jpyAmount > unpaidAmount`, and update the purchase after deleting a payment.

- [ ] **Step 4: Run and commit**

Run: `node --test src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js`

Expected: PASS.

```bash
git add src/App.jsx src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js
git commit -m "fix: reconcile procurement payment balances"
```

### Task 5: Full verification and local browser acceptance

**Files:**
- Modify only if a failing verification test exposes a feature regression.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: tested build and a visible local accounting page ready for user testing.

- [ ] **Step 1: Run focused Node tests**

Run:

```bash
node --test \
  src/features/purchase-accounting/purchaseAccountingDomain.test.js \
  src/features/purchase-accounting/purchaseAccountingSection.test.js \
  src/services/dashboardService.test.js \
  src/features/labor-accounting/laborAccountingAppIntegration.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run feature-adjacent tests and build**

Run: `node --test src/services/baseRecordService.test.js src/services/employeeAuthSchema.test.js`

Run: `npm run build`

Expected: all selected tests PASS and Vite build exits 0; the existing large-chunk warning is non-blocking.

- [ ] **Step 3: Seed local cross-month acceptance data**

Create one July project purchase, one July opening payment, one August payment, one unpaid order, and one orphan test payment in the isolated local Supabase stack. Do not write remote data.

- [ ] **Step 4: Verify in the in-app browser**

Verify:

- Accounting Cost Center has “采购对账”.
- July shows purchase cost while August shows the August payment cash.
- Current payable is identical in accounting and owner dashboard.
- Project cost includes the purchase once and does not add the payment again.
- The orphan payment warning is visible.

- [ ] **Step 5: Final diff review and commit any test-only adjustments**

Run: `git diff --check` and `git status --short`.

Confirm unrelated pre-existing modified/untracked files remain untouched.

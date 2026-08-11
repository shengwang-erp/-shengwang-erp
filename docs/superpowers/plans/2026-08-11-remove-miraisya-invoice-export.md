# Remove Miraisya Invoice Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the ERP-generated Miraisya Excel request form while preserving all monthly settlement, freeze, unfreeze, cost, tax, and margin functionality.

**Architecture:** Remove the browser download boundary from `AuthenticatedApp` and `MiraisyaSettlementPage`, then delete the isolated exporter, its tests, and its public workbook template. Keep the settlement domain, service, SQL migration, route, permissions, page, and accounting summaries unchanged.

**Tech Stack:** React 19, Vite 6, Node test runner, Git, Supabase settlement RPCs (unchanged)

## Global Constraints

- Preserve the future-company project and monthly settlement workflow.
- Preserve frozen settlement data and database/RPC behavior.
- Do not delete or modify the user's original Desktop workbook.
- Delete the ERP public workbook template so bank details are no longer statically downloadable.
- Do not remove `exceljs` from dependencies because this plan does not prove it is unused by the rest of the ERP.
- Preserve the untracked `supabase/.temp/` directory.

---

### Task 1: Replace Download Assertions With Removal Assertions

**Files:**
- Modify: `src/features/miraisya/MiraisyaSettlementPage.test.js`
- Test: `src/features/miraisya/MiraisyaSettlementPage.test.js`

**Interfaces:**
- Consumes: source text for `MiraisyaSettlementPage.jsx` and `App.jsx`.
- Produces: regression assertions that reject `onDownload`, `downloadMiraisyaInvoice`, and “请求书下载”.

- [ ] **Step 1: Write the failing removal assertions**

Replace download-positive assertions with:

```js
assert.doesNotMatch(source, /onDownload|请求书下载/u)
assert.doesNotMatch(appSource, /downloadMiraisyaInvoice|handleMiraisyaInvoiceDownload/u)
```

Keep the positive assertions for `service.listCandidates`, `service.list`, `service.createDraft`, `service.confirm`, `service.void`, freeze, unfreeze, and history.

- [ ] **Step 2: Run the test and verify it fails against the current implementation**

Run:

```bash
node --test src/features/miraisya/MiraisyaSettlementPage.test.js
```

Expected: FAIL because the page and App still contain the automatic request-form download path.

### Task 2: Remove the Automatic Request-Form Boundary and Artifacts

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/features/miraisya/MiraisyaSettlementPage.jsx`
- Delete: `src/features/miraisya/miraisyaInvoiceExport.js`
- Delete: `src/features/miraisya/miraisyaInvoiceExport.test.js`
- Delete: `public/templates/miraisya-invoice-template.xlsx`
- Test: `src/features/miraisya/MiraisyaSettlementPage.test.js`

**Interfaces:**
- Consumes: `miraisyaSettlementService` for list, draft, confirm, get, and void operations.
- Produces: `MiraisyaSettlementPage({ currentUser, service, onBack, onAuthInvalid })` with no download callback.

- [ ] **Step 1: Remove App wiring**

Delete the exporter import, `handleMiraisyaInvoiceDownload`, and the `onDownload` prop:

```jsx
<MiraisyaSettlementPage
  currentUser={currentUser}
  service={miraisyaSettlementService}
  onBack={() => handlePersonnelAwareNavigate('projects')}
  onAuthInvalid={onLogout}
/>
```

- [ ] **Step 2: Remove page download behavior**

Change the component signature to:

```js
export default function MiraisyaSettlementPage({
  currentUser,
  service,
  onBack,
  onAuthInvalid,
})
```

Delete the `download` async function and the “请求书下载” button. Do not alter draft, confirmation, void, history, or summary code.

- [ ] **Step 3: Delete isolated exporter artifacts**

Delete only these exact files:

```text
src/features/miraisya/miraisyaInvoiceExport.js
src/features/miraisya/miraisyaInvoiceExport.test.js
public/templates/miraisya-invoice-template.xlsx
```

- [ ] **Step 4: Run focused tests and verify they pass**

Run:

```bash
node --test src/features/miraisya/MiraisyaSettlementPage.test.js src/features/miraisya/miraisyaSettlementDomain.test.js src/services/miraisyaSettlementService.test.js
```

Expected: all focused tests pass and no test imports the deleted exporter.

### Task 3: Verify the ERP and Commit the Removal

**Files:**
- Verify: `src/App.jsx`
- Verify: `src/features/miraisya/MiraisyaSettlementPage.jsx`
- Verify absence: `public/templates/miraisya-invoice-template.xlsx`

**Interfaces:**
- Consumes: the complete ERP test and production build commands.
- Produces: a committed removal with monthly settlement still operational.

- [ ] **Step 1: Scan for stale automatic-request references**

Run:

```bash
rg -n "downloadMiraisyaInvoice|handleMiraisyaInvoiceDownload|onDownload|请求书下载|miraisya-invoice-template|miraisyaInvoiceExport" src public -g '!**/*.test.js'
```

Expected: no production-code matches; the page test retains only negative regression assertions for these names.

- [ ] **Step 2: Run the full automated test suite**

Run:

```bash
npm test
```

Expected: 1,688 tests pass with zero failures after the three exporter tests are removed.

- [ ] **Step 3: Run the production build and diff validation**

Run:

```bash
npm run build
git diff --check
```

Expected: Vite production build exits successfully and `git diff --check` prints nothing.

- [ ] **Step 4: Commit only the intended removal**

Run:

```bash
git add src/App.jsx src/features/miraisya/MiraisyaSettlementPage.jsx src/features/miraisya/MiraisyaSettlementPage.test.js src/features/miraisya/miraisyaInvoiceExport.js src/features/miraisya/miraisyaInvoiceExport.test.js public/templates/miraisya-invoice-template.xlsx docs/superpowers/plans/2026-08-11-remove-miraisya-invoice-export.md
git commit -m "refactor: remove Miraisya invoice export"
```

Expected: the exact exporter source, test, and public template are recorded as deleted; `supabase/.temp/` remains untracked and untouched.

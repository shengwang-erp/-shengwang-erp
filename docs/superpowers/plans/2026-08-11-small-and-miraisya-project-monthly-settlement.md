# Small and Miraisya Project Monthly Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add type-separated lightweight projects, Miraisya billing and cost/profit views, frozen monthly settlements, and editable Excel invoices matching the supplied template.

**Architecture:** Keep all project types in the existing protected `projects` payload and project ID namespace so purchase, warehouse, attendance, vehicle, and accounting continue to bind by `projectId`. Add focused Miraisya billing and settlement tables behind security-definer RPCs, use the existing authoritative project-cost report for cost snapshots, and generate editable `.xlsx` files in the browser from the supplied template with a lazy ExcelJS import.

**Tech Stack:** React 19, Vite 6, native `node:test`, Supabase PostgreSQL/RLS/security-definer RPCs, ExcelJS 4.4, OfficeCLI workbook QA, Vercel.

## Global Constraints

- Execute in a new isolated worktree created from commit `70c04ce`; never stage the existing dirty files in `/Users/yu/Documents/kaobeierp/warehouse-forward-port`.
- Project types are exactly `standard`, `small`, and `miraisya`; historical missing values normalize to `standard`.
- The Miraisya customer is exactly `株式会社未来舎サポート`.
- Create/edit requires an active president or `后勤部`, `财务部`, `设计部`, `总务部` employee plus the existing module permission.
- Delete and settlement mutations require the president or `财务部` plus the existing module permission.
- Billing tax rates are exactly `0` or `10`, defaulting to `10`.
- Completion month is the default settlement month; authorized users may carry unconfirmed work forward.
- Confirmed snapshots are immutable; voiding preserves all original data and audit fields.
- Invoice date is the draft-generation day and numbering is `MIRAI-YYYYMM-NNN`.
- ExcelJS remains behind a literal dynamic `import('exceljs')`.
- The editable workbook must preserve the supplied template's header, company/bank data, fonts, borders, merges, and print layout.
- Production deployment is gated on all unit, SQL, build, workbook, and browser checks.
- Release version is `1.1.0`; no dependency may be added.

---

### Task 1: Add Typed Project Domain Fields

**Files:**
- Modify: `src/features/projects/projectDomain.js`
- Test: `src/features/projects/projectDomain.test.js`

**Interfaces:**
- Produces `PROJECT_TYPES`, `LIGHTWEIGHT_DURATION_OPTIONS`, `MIRAISYA_CUSTOMER_NAME`.
- Produces `isLightweightProject(project)` and `isMiraisyaProject(project)`.
- Extends `createEmptyProject(today, { projectType })`, `normalizeProject`, `validateProjectForSave`, and `buildProjectPayload`.

- [ ] **Step 1: Write failing compatibility and Miraisya-default tests**

```js
test('historical projects remain standard and Miraisya fields are fixed', () => {
  assert.equal(normalizeProject({ projectName: '历史项目' }).projectType, 'standard')
  const value = createEmptyProject(() => '2026-08-11', { projectType: 'miraisya' })
  assert.equal(value.customerName, '株式会社未来舎サポート')
  assert.equal(value.durationType, 'full_day')
  assert.deepEqual(value.workerAssignments, [])
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test src/features/projects/projectDomain.test.js`

Expected: FAIL because typed project fields do not exist.

- [ ] **Step 3: Implement the exact constants and normalization**

```js
export const PROJECT_TYPES = Object.freeze({
  STANDARD: 'standard', SMALL: 'small', MIRAISYA: 'miraisya',
})
export const LIGHTWEIGHT_DURATION_OPTIONS = Object.freeze(['half_day', 'full_day'])
export const MIRAISYA_CUSTOMER_NAME = '株式会社未来舎サポート'
```

Add `projectType`, `durationType`, `workerAssignments`, `expectedAmount`, and `lightweightSettlementStatus`. Worker assignments are dense arrays of exact `{ employeeId, employeeNumber, name }` string records. `expectedAmount` is a non-negative safe integer for `small`, always `0` for `miraisya`, and Miraisya customer is always canonical.

- [ ] **Step 4: Run project domain and integration tests**

Run: `node --test src/features/projects/projectDomain.test.js src/features/projects/projectAppIntegration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/projects/projectDomain.js
git add src/features/projects/projectDomain.test.js
git commit -m "feat: add lightweight project types"
```

---

### Task 2: Enforce Typed Project Permissions in Client and PostgreSQL

**Files:**
- Modify: `src/features/projects/projectPermissions.js`
- Test: `src/features/projects/projectPermissions.test.js`
- Create: `supabase/migrations/202608110001_project_types_and_permissions.sql`
- Modify: `src/services/projectCoreSecuritySchema.test.js`

**Interfaces:**
- Produces `canCreateTypedProject`, `canEditTypedProject`, `canDeleteTypedProject`, and `canManageMiraisyaSettlement`.
- Extends project RPC payload allowlists with Task 1 fields without changing `projectId` behavior.

- [ ] **Step 1: Write failing permission matrix tests**

```js
test('typed project permissions combine department and module grants', () => {
  const editor = { employmentStatus: '在职', accountStatus: 'active', mustChangePassword: false,
    department: '总务部', effectivePermissionKeys: ['module.projects.create', 'module.projects.update'] }
  assert.equal(canCreateTypedProject(editor), true)
  assert.equal(canEditTypedProject(editor), true)
  assert.equal(canDeleteTypedProject(editor), false)
})
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test src/features/projects/projectPermissions.test.js src/services/projectCoreSecuritySchema.test.js`

Expected: FAIL because helpers and migration are absent.

- [ ] **Step 3: Implement client permission helpers**

```js
const PROJECT_EDITOR_DEPARTMENTS = new Set(['后勤部', '财务部', '设计部', '总务部'])

export function canCreateTypedProject(employee) {
  return isActive(employee) && (employee.position === '社长' ||
    PROJECT_EDITOR_DEPARTMENTS.has(employee.department) || employee.employeeNumber === 'SW-000') &&
    canCreate(employee, '工程项目')
}
```

Use the same whitelist plus `canEdit` for editing. Use only president, finance, or `SW-000` plus `canDelete` for deletion. Settlement management uses president, finance, or `SW-000` plus project update permission.

- [ ] **Step 4: Add server-side project payload and permission guards**

The migration must redefine the private project validator and project create/update/delete RPCs. It adds exact fields `projectType`, `durationType`, `workerAssignments`, `expectedAmount`, `lightweightSettlementStatus`; rejects unknown keys; validates type values; forces the canonical Miraisya customer; preserves existing financial allowlists; and requires the same department/position rules server-side.

```sql
if project_type not in ('standard', 'small', 'miraisya') then
  raise exception using errcode = '22023', message = 'invalid project type';
end if;
if project_type = 'miraisya'
  and p_payload->>'customerName' is distinct from '株式会社未来舎サポート'
then
  raise exception using errcode = '22023', message = 'invalid Miraisya customer';
end if;
```

- [ ] **Step 5: Run permission, service, and schema tests**

Run: `node --test src/features/projects/projectPermissions.test.js src/services/projectService.test.js src/services/projectCoreSecuritySchema.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/projects/projectPermissions.js
git add src/features/projects/projectPermissions.test.js
git add supabase/migrations/202608110001_project_types_and_permissions.sql
git add src/services/projectCoreSecuritySchema.test.js
git commit -m "feat: secure typed project mutations"
```

---

### Task 3: Build Type-Separated Lists and Lightweight Forms

**Files:**
- Create: `src/features/projects/LightweightProjectForm.jsx`
- Test: `src/features/projects/LightweightProjectForm.test.js`
- Modify: `src/features/projects/ProjectPage.jsx`
- Test: `src/features/projects/projectPageContract.test.js`
- Test: `src/features/projects/projectAppIntegration.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- `LightweightProjectForm({ projectType, value, employees, disabled, onChange, onSubmit, onCancel })`.
- `ProjectPage` adds `onOpenMiraisyaProject(projectId)` and `onOpenMiraisyaSettlement()` callbacks.

- [ ] **Step 1: Write failing UI tests for three create actions and three lists**

Assert `新增主项目`, `新增小项目`, `新增未来社项目`, `主项目`, `小项目`, and `未来社项目` are present for authorized users, and that future customer is read-only.

- [ ] **Step 2: Run focused UI tests and confirm failure**

Run: `node --test src/features/projects/LightweightProjectForm.test.js src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement the focused lightweight form**

Render project name, fixed/editable customer, address with existing location picker, construction date, half/full day, leader, worker snapshots, expected amount for `small` only, status, note, and attachment entry. Use semantic labels and keep Miraisya totals derived from billing.

- [ ] **Step 4: Split `ProjectPage` by normalized type**

Use `useMemo` to create three display arrays while leaving the original `projects` prop unchanged for other modules. Add Miraisya “收费与成本” and authorized “未来社月度结算” actions.

- [ ] **Step 5: Run all project tests**

Run: `node --test src/features/projects/*.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/projects/LightweightProjectForm.jsx
git add src/features/projects/LightweightProjectForm.test.js
git add src/features/projects/ProjectPage.jsx
git add src/features/projects/projectPageContract.test.js
git add src/features/projects/projectAppIntegration.test.js
git add src/styles.css
git commit -m "feat: add lightweight project lists and forms"
```

---

### Task 4: Implement Miraisya Billing Domain, Service, and RPCs

**Files:**
- Create: `src/features/miraisya/miraisyaBillingDomain.js`
- Test: `src/features/miraisya/miraisyaBillingDomain.test.js`
- Create: `src/services/miraisyaBillingService.js`
- Test: `src/services/miraisyaBillingService.test.js`
- Create: `supabase/migrations/202608110002_miraisya_billing.sql`
- Create: `supabase/tests/miraisya_projects_and_billing.sql`
- Create: `src/services/miraisyaSchema.test.js`

**Interfaces:**
- `createEmptyBillingItem`, `normalizeBillingItem`, `summarizeBillingItems`.
- Service `get(projectId)` and `replace({ projectId, expectedVersion, items })`.
- RPCs `get_miraisya_billing_secure` and `replace_miraisya_billing_secure`.

- [ ] **Step 1: Write failing arithmetic and hardening tests**

```js
test('ten and zero percent lines calculate independently', () => {
  const totals = summarizeBillingItems([
    { itemName: '工事费', description: '', quantity: 1, unit: '式', unitPrice: 12000, taxRate: 10 },
    { itemName: '本体', description: '', quantity: 1, unit: '台', unitPrice: 120000, taxRate: 0 },
  ])
  assert.deepEqual(totals, { taxExclusiveAmount: 132000, taxAmount: 1200,
    taxInclusiveAmount: 133200 })
})
```

Test negative/unsafe numbers, rates other than 0/10, sparse arrays, accessors, extra response keys, trusted errors, and version conflicts.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test src/features/miraisya/miraisyaBillingDomain.test.js src/services/miraisyaBillingService.test.js src/services/miraisyaSchema.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement safe billing arithmetic and strict RPC adapter**

```js
export function calculateBillingAmounts(quantity, unitPrice, taxRate) {
  if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPrice) ||
      unitPrice < 0 || ![0, 10].includes(taxRate)) throw new TypeError('收费明细无效')
  const taxExclusiveAmount = Math.round(quantity * unitPrice)
  const taxAmount = taxRate === 0 ? 0 : Math.round(taxExclusiveAmount * 0.1)
  return Object.freeze({ taxExclusiveAmount, taxAmount,
    taxInclusiveAmount: taxExclusiveAmount + taxAmount })
}
```

- [ ] **Step 4: Add billing tables and guarded replace RPC**

Create RPC-only RLS tables `miraisya_billing_headers` and `miraisya_billing_items`. Items store sort order, item name, description, quantity `numeric(14,4)`, unit, integer yen price, and 0/10 rate. The replace RPC locks the header, checks expected version, validates an exact dense JSON array, rejects non-Miraisya projects/non-editors, replaces rows atomically, increments version, and returns authoritative totals.

- [ ] **Step 5: Run JS and local SQL tests**

Run: `node --test src/features/miraisya/miraisyaBillingDomain.test.js src/services/miraisyaBillingService.test.js src/services/miraisyaSchema.test.js`

Run when local Supabase is ready: `supabase test db supabase/tests/miraisya_projects_and_billing.sql`

Expected: PASS with direct table access denied.

- [ ] **Step 6: Commit**

```bash
git add src/features/miraisya/miraisyaBillingDomain.js
git add src/features/miraisya/miraisyaBillingDomain.test.js
git add src/services/miraisyaBillingService.js
git add src/services/miraisyaBillingService.test.js
git add supabase/migrations/202608110002_miraisya_billing.sql
git add supabase/tests/miraisya_projects_and_billing.sql
git add src/services/miraisyaSchema.test.js
git commit -m "feat: persist secure Miraisya billing"
```

---

### Task 5: Build the Miraisya Billing, Cost, and Margin Panel

**Files:**
- Create: `src/features/miraisya/MiraisyaProjectPanel.jsx`
- Test: `src/features/miraisya/MiraisyaProjectPanel.test.js`
- Create: `src/features/miraisya/miraisya.css`
- Modify: `src/features/projects/ProjectPage.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- `MiraisyaProjectPanel({ project, billingService, costLedgerService, onClose })`.
- Loads billing and `costLedgerService.report({ projectId })` independently.

- [ ] **Step 1: Write failing panel tests**

Cover billing editing, 0% selection, version reload, cost loading/error/incomplete states, category totals, tax-exclusive revenue, total cost, and margin. Assert cost rows never become invoice items.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test src/features/miraisya/MiraisyaProjectPanel.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement independent billing and cost loading**

Use `Promise.allSettled` with an unmount guard. Billing errors keep cost readable and cost errors keep billing editable. Margin is `taxExclusiveAmount - authoritativeReportTotal` only when the report is complete.

- [ ] **Step 4: Wire stable services through App and ProjectPage**

Do not filter `projects` passed to purchase, warehouse, attendance, vehicle, or accounting modules.

- [ ] **Step 5: Run panel/project/accounting regression tests**

Run: `node --test src/features/miraisya/MiraisyaProjectPanel.test.js src/features/projects/*.test.js src/features/cost-accounting/costAccountingAppIntegration.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/miraisya/MiraisyaProjectPanel.jsx
git add src/features/miraisya/MiraisyaProjectPanel.test.js
git add src/features/miraisya/miraisya.css
git add src/features/projects/ProjectPage.jsx
git add src/App.jsx
git commit -m "feat: show Miraisya billing costs and margin"
```

---

### Task 6: Implement Settlement Domain, Service, and Immutable SQL Snapshots

**Files:**
- Create: `src/features/miraisya/miraisyaSettlementDomain.js`
- Test: `src/features/miraisya/miraisyaSettlementDomain.test.js`
- Create: `src/services/miraisyaSettlementService.js`
- Test: `src/services/miraisyaSettlementService.test.js`
- Create: `supabase/migrations/202608110003_miraisya_monthly_settlement.sql`
- Create: `supabase/tests/miraisya_monthly_settlement.sql`
- Modify: `src/services/miraisyaSchema.test.js`

**Interfaces:**
- Domain normalizes month, candidates, settlement snapshot, totals, and confirm decision.
- Service methods: `listCandidates`, `list`, `get`, `createDraft`, `confirm`, `void`.
- SQL tables: `miraisya_monthly_settlements`, `miraisya_monthly_settlement_projects`, `miraisya_monthly_settlement_items`.

- [ ] **Step 1: Write failing domain, service, and schema tests**

Test month syntax, carry-forward, exact invoice format, deep freeze, incomplete-cost confirmation block, response hardening, duplicate project prevention, expected version, and trusted errors.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test src/features/miraisya/miraisyaSettlementDomain.test.js src/services/miraisyaSettlementService.test.js src/services/miraisyaSchema.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement domain and strict service**

```js
createDraft: (request) => rpc('create_miraisya_settlement_draft_secure', {
  p_month: normalizeSettlementMonth(request.month),
  p_issue_date: normalizeIssueDate(request.issueDate),
  p_project_ids: normalizeProjectIds(request.projectIds),
}, normalizeSettlement)
```

- [ ] **Step 4: Add snapshot tables and transactional RPCs**

The main table stores invoice number, month, issue date, `draft|confirmed|voided`, version, totals, and audit fields. Project/item tables store immutable JSON/project fields and exact per-line amounts. A partial unique index allows only one active settlement per project.

Draft creation takes an advisory transaction lock using the concrete key format `MIRAI:2026-08`, allocates the next sequence, locks selected projects in sorted order, validates type/completion/billing, calls `export_project_cost_report_secure({projectId})`, rejects incomplete cost reports, writes snapshots, and returns the draft. Confirmation validates but does not recompute. Voiding records reason/actor/time and releases active project links without deleting snapshots.

- [ ] **Step 5: Run JS and local SQL tests**

Run: `node --test src/features/miraisya/miraisyaSettlementDomain.test.js src/services/miraisyaSettlementService.test.js src/services/miraisyaSchema.test.js`

Run when local Supabase is ready: `supabase test db supabase/tests/miraisya_monthly_settlement.sql`

Expected: PASS, including concurrent numbering and direct-table denial.

- [ ] **Step 6: Commit**

```bash
git add src/features/miraisya/miraisyaSettlementDomain.js
git add src/features/miraisya/miraisyaSettlementDomain.test.js
git add src/services/miraisyaSettlementService.js
git add src/services/miraisyaSettlementService.test.js
git add supabase/migrations/202608110003_miraisya_monthly_settlement.sql
git add supabase/tests/miraisya_monthly_settlement.sql
git add src/services/miraisyaSchema.test.js
git commit -m "feat: persist frozen Miraisya settlements"
```

---

### Task 7: Build the Monthly Settlement Page and Protected Route

**Files:**
- Create: `src/features/miraisya/MiraisyaSettlementPage.jsx`
- Test: `src/features/miraisya/MiraisyaSettlementPage.test.js`
- Modify: `src/features/miraisya/miraisya.css`
- Modify: `src/navigation/adminRoutes.js`
- Test: `src/navigation/adminRoutes.test.js`
- Modify: `src/features/projects/ProjectPage.jsx`
- Modify: `src/App.jsx`

**Interfaces:**
- `MiraisyaSettlementPage({ currentUser, service, onDownload, onBack, onAuthInvalid })`.
- Protected child route `miraisyaSettlement` uses the `工程项目` module.

- [ ] **Step 1: Write failing route and workflow tests**

Cover month selection, candidate checkboxes, carry-forward, totals, draft, confirm blocking/success, void reason, history, download, and president/finance-only mutations.

- [ ] **Step 2: Run tests and confirm failure**

Run: `node --test src/features/miraisya/MiraisyaSettlementPage.test.js src/navigation/adminRoutes.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement server-authoritative page transitions**

Every async action has disabled/error state. Reload candidate/history after confirm or void. Do not optimistically mark mutations successful.

- [ ] **Step 4: Wire route and services in App**

Back returns to `projects`; unauthorized direct navigation normalizes safely.

- [ ] **Step 5: Run focused and navigation tests**

Run: `node --test src/features/miraisya/MiraisyaSettlementPage.test.js src/navigation/*.test.js src/features/projects/*.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/miraisya/MiraisyaSettlementPage.jsx
git add src/features/miraisya/MiraisyaSettlementPage.test.js
git add src/features/miraisya/miraisya.css
git add src/navigation/adminRoutes.js
git add src/navigation/adminRoutes.test.js
git add src/features/projects/ProjectPage.jsx
git add src/App.jsx
git commit -m "feat: add Miraisya monthly settlement workflow"
```

---

### Task 8: Generate Editable Excel Invoices from the Supplied Template

**Files:**
- Add: `public/templates/miraisya-invoice-template.xlsx`
- Create: `src/features/miraisya/miraisyaInvoiceExport.js`
- Test: `src/features/miraisya/miraisyaInvoiceExport.test.js`
- Modify: `src/features/miraisya/MiraisyaSettlementPage.jsx`

**Interfaces:**
- `buildMiraisyaInvoiceWorkbook(ExcelJS, templateBytes, settlement)`.
- `downloadMiraisyaInvoice(settlement, runtime)` with lazy ExcelJS/template fetch.

- [ ] **Step 1: Copy and hash-check the exact workbook**

Copy `/Users/yu/Desktop/工作/未来社工事/❤️株式会社未来舎サポート請求書(001)_副本.xlsx` to `public/templates/miraisya-invoice-template.xlsx`. Require identical SHA-256 hashes before exporter edits.

- [ ] **Step 2: Write failing exporter tests**

Build a six-project fixture with mixed 0%/10% lines. Assert `H2` date, `G3/H3` invoice number, `A7` customer, company/bank values, top merges/images, formula totals, additional project rows/page breaks, no sheet protection, and a literal dynamic ExcelJS import.

- [ ] **Step 3: Run test and confirm failure**

Run: `node --test src/features/miraisya/miraisyaInvoiceExport.test.js`

Expected: FAIL.

- [ ] **Step 4: Implement template-driven body rebuilding**

```js
export async function buildMiraisyaInvoiceWorkbook(ExcelJS, templateBytes, settlement) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(templateBytes)
  const sheet = workbook.getWorksheet('Sheet2')
  if (!sheet) throw new TypeError('请求书模板无效')
  const styles = captureTemplateStyles(sheet)
  rebuildInvoiceBody(sheet, styles, settlement.projects)
  sheet.getCell('H2').value = formatJapaneseIssueDate(settlement.issueDate)
  sheet.getCell('G3').value = '請求書番号：'
  sheet.getCell('H3').value = settlement.invoiceNo
  applyInvoiceTotals(sheet)
  return workbook
}
```

Capture row heights, cell styles, borders, formats, and merge patterns before replacing rows 19-72. Use formulas for line/subtotal/tax/grand totals. Add blocks/page breaks beyond five projects and leave workbook cells editable.

- [ ] **Step 5: Implement lazy download with a stale-version guard**

Use `Promise.all([import('exceljs'), fetch('/templates/miraisya-invoice-template.xlsx')])`, write a buffer, confirm the settlement version did not change, and download `株式会社未来舎サポート_YYYY年MM月_請求書_MIRAI-YYYYMM-NNN.xlsx`.

- [ ] **Step 6: Run workbook tests and OfficeCLI QA**

Run: `node --test src/features/miraisya/miraisyaInvoiceExport.test.js`

Generate `/private/tmp/miraisya-invoice-qa.xlsx`, then run:

```bash
officecli view /private/tmp/miraisya-invoice-qa.xlsx issues
officecli validate /private/tmp/miraisya-invoice-qa.xlsx
officecli view /private/tmp/miraisya-invoice-qa.xlsx html
```

Require zero formula errors, no `###`, no truncated headers, and matching visual structure.

- [ ] **Step 7: Commit**

```bash
git add public/templates/miraisya-invoice-template.xlsx
git add src/features/miraisya/miraisyaInvoiceExport.js
git add src/features/miraisya/miraisyaInvoiceExport.test.js
git add src/features/miraisya/MiraisyaSettlementPage.jsx
git commit -m "feat: export editable Miraisya invoices"
```

---

### Task 9: Verify Cross-Module Behavior and Release Version 1.1.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify only direct regression files if a failing test proves they are needed.

**Interfaces:**
- Package version becomes `1.1.0`; dependency sets remain identical.

- [ ] **Step 1: Bump version without a Git tag**

Run: `npm version 1.1.0 --no-git-tag-version`

Verify only version fields change.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: all tests PASS.

- [ ] **Step 3: Run security and production build verification**

Run: `npm run verify:local-demo-security`

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Run SQL regression suites**

Run the two new SQL suites plus `project_cost_ledger.sql` and `warehouse_end_to_end.sql` against the project-scoped local Supabase stack.

- [ ] **Step 5: Perform local browser acceptance**

Verify authorized creation of all types, correct lists, selection from purchase/warehouse/attendance/vehicle/accounting, mixed billing tax, authoritative cost/margin, monthly draft/confirm/download/void, and the complete permission matrix.

- [ ] **Step 6: Commit release metadata**

```bash
git add package.json
git add package-lock.json
git commit -m "chore: release ERP 1.1.0"
```

---

### Task 10: Deploy Additive Migrations and Verified Vercel Build

**Files:**
- Create after successful rollout: `docs/superpowers/handoffs/2026-08-11-miraisya-projects-release.md`

**Interfaces:**
- Production Supabase receives migrations `202608110001` through `202608110003` in order.
- Vercel production alias stays `https://shengwang-erp.vercel.app`.

- [ ] **Step 1: Record production preflight state**

Record Git commit, Vercel deployment ID, Supabase migration list, and project row count. Confirm migrations are additive and contain no drop operations.

- [ ] **Step 2: Apply the three production migrations**

Verify the remote migration list and RPC-only table security after applying.

- [ ] **Step 3: Run production read-only RPC smoke tests**

Read project list, empty/real Miraisya candidates, and settlement history with an authorized session; create no production test settlement.

- [ ] **Step 4: Deploy verified commit**

Run: `vercel --prod --yes`

Verify build logs show `shengwang-erp-h5@1.1.0`, Vite succeeds, and the alias points to the new Ready deployment.

- [ ] **Step 5: Run production browser smoke tests**

Verify login, project tabs, authorized create actions, Miraisya settlement page, template fetch, cost read, and no console errors/regressions in warehouse/accounting.

- [ ] **Step 6: Record and commit release evidence**

The handoff records commit, migration versions, deployment ID, verification results, and rollback target.

---

## Final Acceptance Checklist

- [ ] Original dirty worktree remains untouched.
- [ ] Every task uses a failing-test/pass cycle and focused commit.
- [ ] New tables are RPC-only and permission tests pass.
- [ ] All modules can select all three project types by existing `projectId`.
- [ ] Confirmed settlements remain immutable and auditable.
- [ ] Excel output matches the template, supports more than five projects, has zero formula errors, and remains editable.
- [ ] Version is `1.1.0` with no new dependencies.
- [ ] Full tests, SQL tests, build, workbook QA, local acceptance, migration checks, Vercel deploy, and production smoke tests pass.

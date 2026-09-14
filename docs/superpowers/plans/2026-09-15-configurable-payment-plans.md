# Configurable Payment Plans Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed three-stage project payment plan with an atomic, backward-compatible, configurable installment plan.

**Architecture:** Keep the existing JSONB record tables and stable plan IDs, add compatibility normalization in the domain layer, and add one database transaction RPC that validates and replaces the full active plan set. Make actual receipts resolve and lock plans by `planId`, and add account/project-scoped session drafts in the UI.

**Tech Stack:** React 19, JavaScript, Node test runner, Supabase/PostgreSQL PL/pgSQL, Vite.

**Spec:** `docs/superpowers/specs/2026-09-15-configurable-payment-plans-design.md`

## Global Constraints

- Existing linked installments keep their `planId`, allocation, amount, dates, notes, and receipt relationships.
- New plans default to three blank percentages; no 30/40/30 default and no automatic averaging.
- Payment plan count never limits receipt count.
- No production test records, table resets, destructive data cleanup, or unrelated refactors.
- Production database migration is blocked until backup and restore verification succeed.

---

### Task 1: Configurable plan domain and rounding

**Files:**
- Modify: `src/features/contract-revenue/paymentPlans.test.js`
- Modify: `src/features/contract-revenue/paymentPlans.js`
- Modify: `src/features/contract-revenue/contractRevenueCalculations.test.js`
- Modify: `src/features/contract-revenue/contractRevenueCalculations.js`

**Interfaces:**
- Produces: `normalizePaymentPlans`, `createBlankPaymentPlans`, `calculatePaymentPlanAmountPreview`, `preparePaymentPlanSetSave`, and plan-ID based allocation summaries.

- [ ] Add failing tests for legacy three-stage normalization, blank three-period creation, four/six-period rounding, exact two-decimal percentage validation, locked-plan preservation, unlocked deletion, and contract-change difference behavior.
- [ ] Run the focused tests and confirm failures are caused by fixed-stage behavior.
- [ ] Implement plan-order/name compatibility, basis-point arithmetic, plan-ID receipt totals, and strict save preparation.
- [ ] Run the focused tests and confirm all pass.

### Task 2: Atomic service boundary and receipt association

**Files:**
- Modify: `src/services/contractRevenueService.test.js`
- Modify: `src/services/contractRevenueService.js`
- Modify: `src/features/contract-revenue/customerReceipts.test.js`
- Modify: `src/features/contract-revenue/customerReceipts.js`
- Modify: `src/features/contract-revenue/CustomerReceiptsSection.jsx`
- Modify: `src/App.jsx`
- Modify: `src/features/contract-revenue/ContractRevenuePage.jsx`

**Interfaces:**
- Produces: `savePaymentPlanSet(projectId, plans)` calling `replace_project_payment_plan_secure` once; receipt form values use `planId` while retaining legacy stage snapshots.

- [ ] Add failing tests proving one atomic RPC call, unlimited receipts per plan, stable labels by plan ID, and no stage-count restriction.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement the atomic service method, App state replacement, and plan-ID receipt selection/read models.
- [ ] Run the focused tests and confirm all pass.

### Task 3: Draft-preserving configurable UI

**Files:**
- Create: `src/features/contract-revenue/paymentPlanDraft.js`
- Create: `src/features/contract-revenue/paymentPlanDraft.test.js`
- Modify: `src/features/contract-revenue/PaymentPlanSection.jsx`
- Modify: `src/features/contract-revenue/paymentPlanPage.test.js`
- Create: `src/features/contract-revenue/PaymentPlanSection.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Produces: `createPaymentPlanDraftStore({ storage })` keyed by account/project/form and a responsive list-form component.

- [ ] Add failing tests for account/project isolation, remount preservation, failure retention, success clearing, confirmed discard, presets, average allocation, locked deletion, and no horizontal overflow.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement the draft store and configurable list UI with explicit destructive-action confirmations.
- [ ] Run focused tests and confirm all pass.

### Task 4: Database transaction and security tests

**Files:**
- Create: `supabase/migrations/202609150001_configurable_payment_plans.sql`
- Create: `supabase/tests/configurable_payment_plans.sql`
- Modify: `src/services/contractRevenueService.test.js`

**Interfaces:**
- Produces: `public.replace_project_payment_plan_secure(text, jsonb) returns jsonb`; hardened receipt upsert validation; authenticated access to the set RPC only.

- [ ] Add failing SQL and service contract tests for permissions, exact totals, atomic rollback, stable IDs, locked mutation/deletion refusal, unlocked deletion, and receipt-plan integrity.
- [ ] Run available local checks and confirm expected failures.
- [ ] Implement the migration with row locks, server-side amount calculation, bounded JSON validation, audit preservation, and grants.
- [ ] Run SQL tests against an isolated local database when Docker is available and run service tests.

### Task 5: Backup, recovery proof, deployment, and production verification

**Files:**
- Create outside Git: `/Users/yu/Documents/kaobeierp/backups/configurable-payment-plans-<timestamp>/`
- Create: `docs/configurable-payment-plans-operations.md`

**Interfaces:**
- Consumes: completed migration and release build.
- Produces: timestamped data/schema backup, rollback SQL, verified release, and production audit evidence.

- [ ] Export affected production rows, project/contract adjustment inputs, RPC definitions, grants, policies, and migration status without changing production data.
- [ ] Generate recovery SQL and verify it inside a rollback transaction or isolated local database; stop database deployment if this cannot be proved.
- [ ] Run focused tests, full test suite, and production build with an exact 12-character `VITE_ERP_BUILD_ID`.
- [ ] Commit source and migration changes, push the migration, deploy the production build, and verify the public alias serves the new build.
- [ ] Query production read-only to verify the new RPC signature, three unchanged stable plan IDs, one intact receipt association, no dangling links, and no unintended row-count changes.


# Original Contract Direct Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace accounting confirmation with one validated database save while simplifying inclusive-first contract amount entry.

**Architecture:** Keep the existing project JSON fields and secure update RPC. Add one shared frontend predicate for persisted contract validity, one scoped session draft store, and one SQL predicate used by the atomic payment-plan RPC; preserve all historical confirmation metadata and downstream records.

**Tech Stack:** React 19, Node test runner, Supabase PostgreSQL migrations, Vite.

**Spec:** `docs/superpowers/specs/2026-09-15-original-contract-save-design.md`

## Global Constraints

- Do not deploy or mutate production data in this round.
- Preserve historical confirmation fields, payment plans, contract changes, and receipts.
- Use the existing secure project update RPC and existing financial permissions.
- Use integer yen rounding with the final tax amount as the exact remainder.

---

### Task 1: Contract calculation and persisted-validity domain

**Files:**
- Modify: `src/features/contract-revenue/originalContract.js`
- Modify: `src/features/contract-revenue/contractRevenueValidation.js`
- Test: `src/features/contract-revenue/originalContract.test.js`

**Interfaces:**
- Produces: `calculateOriginalContractAmounts(taxInclusiveAmount, taxRate)` and `isOriginalContractSaved(project)`.
- Produces: `saveOriginalContract(project, input)` returning a complete configured project without changing historical confirmation metadata.

- [ ] Write failing tests for inclusive-first calculation, zero tax, invalid input, exact remainder, saved validity, incomplete draft rejection, and legacy status compatibility.
- [ ] Run `node --test src/features/contract-revenue/originalContract.test.js` and verify the new tests fail because the APIs do not exist.
- [ ] Implement the minimum domain and validation changes.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Account-and-project scoped contract draft

**Files:**
- Create: `src/features/contract-revenue/originalContractDraft.js`
- Create: `src/features/contract-revenue/originalContractDraft.test.js`

**Interfaces:**
- Produces: `createOriginalContractDraftStore({ storage? })` with `load(accountId, projectId)`, `save(accountId, projectId, form)`, and `clear(accountId, projectId)`.

- [ ] Write failing tests proving project/account isolation, defensive parsing, and clear-on-success behavior.
- [ ] Run `node --test src/features/contract-revenue/originalContractDraft.test.js` and verify the module/API failure.
- [ ] Implement the minimum session-storage store using the existing form draft key convention.
- [ ] Re-run the focused test and verify it passes.

### Task 3: Original contract form and reliable database save

**Files:**
- Modify: `src/features/contract-revenue/OriginalContractSection.jsx`
- Modify: `src/features/contract-revenue/ContractRevenuePage.jsx`
- Modify: `src/App.jsx`
- Modify: `src/features/contract-revenue/contractRevenuePage.test.js`
- Modify: `src/auth/businessAccessIntegration.test.js`

**Interfaces:**
- Consumes: calculation, persisted-validity, and draft-store APIs from Tasks 1 and 2.
- Changes: `onProjectChange(nextProject)` becomes an awaited persistence callback that resolves to the database-returned project.

- [ ] Write failing page and integration tests for input order, read-only derived values, removed confirmation controls, edit permission, database save, failure retention, and refresh-compatible state.
- [ ] Run the focused page and integration tests and verify expected failures.
- [ ] Implement the inclusive-first form, scoped draft recovery, permission gate, and awaited project RPC update.
- [ ] Re-run the focused tests and verify they pass.

### Task 4: Replace confirmation dependencies with saved-contract validity

**Files:**
- Modify: `src/features/contract-revenue/paymentPlans.js`
- Modify: `src/features/contract-revenue/contractChanges.js`
- Modify: `src/features/contract-revenue/customerReceipts.js`
- Modify: corresponding section copy and tests under `src/features/contract-revenue/`

**Interfaces:**
- Consumes: `isOriginalContractSaved(project)`.
- Preserves: all plan IDs, receipt links, existing locked-installment behavior, and contract-change calculations.

- [ ] Update failing domain and page tests so complete persisted contracts in all legacy statuses are accepted and incomplete projects are rejected.
- [ ] Run the focused contract-revenue tests and verify expected failures.
- [ ] Replace confirmation-status gates and user-facing confirmation copy with saved-contract validity gates.
- [ ] Re-run focused tests and verify they pass.

### Task 5: Database validity gate and compatibility migration

**Files:**
- Create: `supabase/migrations/202609150002_original_contract_direct_save.sql`
- Modify: `supabase/tests/configurable_payment_plans.sql`
- Modify or create: a migration contract test under `src/services/`

**Interfaces:**
- Produces: private SQL predicate `private.project_has_valid_saved_contract(jsonb)`.
- Replaces: `public.replace_project_payment_plan_secure(text, jsonb)` with the same signature and all existing atomic/locking behavior, changing only its original-contract prerequisite.

- [ ] Write failing static and SQL assertions for complete saved contracts, incomplete rejection, old status compatibility, and unchanged financial permission checks.
- [ ] Run the focused migration contract test and verify it fails without the migration.
- [ ] Add the private predicate and recreate the atomic payment-plan RPC with the new prerequisite.
- [ ] Re-run focused migration tests and verify they pass.

### Task 6: Final regression and build verification

**Files:**
- Review all changed files only.

**Interfaces:**
- Verifies the complete feature without deploying it.

- [ ] Run all contract-revenue and project service tests.
- [ ] Run `npm test`; record unrelated baseline failures separately.
- [ ] Run `npm run build` and verify exit code 0.
- [ ] Review `git diff --check`, the requirement checklist, and ensure no secrets or production data were added.
- [ ] Commit the verified implementation on `codex/original-contract-save`; do not push or deploy unless separately requested.

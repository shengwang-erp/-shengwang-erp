# Warehouse Photo Pending Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sanitized pending discovery and deletion-ID-only recovery with atomic requester takeover, rotated credentials, database-trusted 30-minute leases, and president/SW-000 authorization.

**Architecture:** Extend the existing photo outbox with original/current requester and assignment time, then expose one sanitized list RPC and one claim/recover RPC. Claim uses the existing variant-first lock order, rotates the deletion ID on takeover, writes immutable history, and returns the existing exact full ticket only after authorization. The browser service validates the two new exact response shapes and reuses the existing remove/finalize state machine.

**Tech Stack:** PostgreSQL 15, Supabase RLS/Storage, pgTAP, JavaScript ES modules, Node test runner, Supabase JS.

## Global Constraints

- No deployment or external network access.
- Use only a fresh fail-closed local Supabase project on explicit non-default ports.
- Follow strict RED before implementation and GREEN after each task.
- Candidate objects contain exactly `deletionId`, `kind`, `createdAt`, `originalRequesterLabel`.
- Full tickets contain exactly `deletionId`, `kind`, `photoId`, `variantId`, `objectPath`, `storageDeleted`.
- Takeover rotates `deletionId`, changes current requester, resets database `assigned_at`, and permanently invalidates the old ID.
- Other managers claim immediately when the current requester is unavailable or lacks manage permission; otherwise the exact boundary is 30 minutes.
- No candidate response contains paths, photo metadata, employee number, profile UUID, or Auth UUID.
- President authorization comes from the central effective-permission resolver; SW-000 continues through existing `all`.

---

### Task 1: Central President Permission Mapping

**Files:**
- Modify: `supabase/migrations/202607140001_employee_auth.sql`
- Modify: `supabase/tests/warehouse_permission_catalog.sql`
- Modify: `src/services/employeeAuthSchema.test.js`

**Interfaces:**
- Consumes: `private.employee_effective_permission_keys(uuid)`.
- Produces: active president effective keys include exact `warehouse.catalog.manage`; inactive president remains empty; SW-000 remains `all`.

- [ ] **Step 1: Write failing SQL and static tests**

Add assertions that an active president passes `has_current_permission('warehouse.catalog.manage')`, inactive/first-login presidents fail, and the central fixed-permission array contains the warehouse key without adding top-level permission-grant DML.

- [ ] **Step 2: Run focused tests and verify RED**

Run `node --test src/services/employeeAuthSchema.test.js` and later the isolated `warehouse_permission_catalog.sql`. Expected before implementation: president warehouse-manage assertion fails.

- [ ] **Step 3: Implement the minimal mapping**

Add `'warehouse.catalog.manage'` to the fixed permission rows selected only when `employee.position = '社长'` inside `private.employee_effective_permission_keys`; do not add name checks or automatic `permission_grants` rows.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: static test passes; isolated pgTAP confirms president true, inactive false, SW-000 `all` behavior unchanged.

---

### Task 2: Browser Service Pending and Recovery Contracts

**Files:**
- Modify: `src/services/warehouseMediaService.js`
- Modify: `src/services/warehouseMediaService.test.js`

**Interfaces:**
- Consumes RPC `list_warehouse_photo_delete_candidates_secure()` returning sanitized candidates.
- Consumes RPC `claim_warehouse_photo_delete_secure(p_deletion_id uuid)` returning a complete exact ticket.
- Produces methods `listPendingPhotoDeletes()` and `recoverPendingPhotoDelete(deletionId)`.

- [ ] **Step 1: Write candidate-list RED tests**

Test a dense exact array of exact four-field objects; reject path/photo/variant/employee identifiers, extra keys, sparse/accessor arrays, invalid UUID/kind/timestamp/label, and malformed RPC envelopes without invoking getters.

- [ ] **Step 2: Write recovery RED tests**

Assert recovery calls only claim by deletion ID, never list/sign/old row RPCs, removes the returned server path when present, skips removal for `storageDeleted: true`, and finalizes exact bindings. Cover orphan lost-finalize response and registered object-already-deleted with list/sign suppliers configured to fail if called.

- [ ] **Step 3: Run focused service tests and verify RED**

Run `node --test src/services/warehouseMediaService.test.js`. Expected: new methods absent.

- [ ] **Step 4: Implement minimal validators and methods**

Add exact candidate validation and both methods. Reuse `deleteTicket` and `finishDelete`; accept no caller-supplied path, variant, photo row, or metadata.

- [ ] **Step 5: Run focused service tests and verify GREEN**

Expected: all media service tests pass, including prior strict envelope/removal tests.

---

### Task 3: SQL Outbox Lease, Sanitized List, and Atomic Claim

**Files:**
- Modify: `supabase/migrations/202608080003_warehouse_catalog_media.sql`
- Modify: `supabase/tests/warehouse_catalog_media.sql`

**Interfaces:**
- Produces `public.list_warehouse_photo_delete_candidates_secure()` with no arguments.
- Produces `public.claim_warehouse_photo_delete_secure(uuid)`.
- Extends outbox with `original_requested_by_employee_profile_id` and `assigned_at`.
- Produces immutable private takeover receipts containing old/new ticket and requester identifiers plus reason/time.

- [ ] **Step 1: Add structural RED tests**

Assert exact columns, constraints, indexes, immutable takeover receipt trigger/ACL, RPC signatures, fixed search paths, authenticated-only EXECUTE, new fixed audit action, and absence of browser table access.

- [ ] **Step 2: Add authorization and disclosure RED tests**

Create active manager, unauthorized employee, inactive manager, president, and SW-000 fixtures. Assert unauthorized/inactive list/claim fail without paths; list returns exactly four safe fields and employee name only; direct pending predicates return false without active exact manage permission.

- [ ] **Step 3: Add lease and takeover RED tests**

Use controlled `assigned_at` fixture updates under owner role. Assert unavailable requester immediate visibility/claim, active authorized requester at 29:59.999 hidden/rejected, exact 30:00 visible/claimable, new ID and assigned time, immutable receipt/audit, old ID invalid, and only new requester Storage visibility.

- [ ] **Step 4: Add orphan/register/reorder RED tests**

Assert unrelated orphan pending permits register and reorder, exact orphan path registration rejects, and registered pending continues to block registration/reorder.

- [ ] **Step 5: Run isolated catalog pgTAP and verify RED**

Create a fresh explicit local project through the committed launcher workflow and run `warehouse_catalog_media.sql`. Expected: new schema/RPC/behavior assertions fail before implementation.

- [ ] **Step 6: Implement minimal schema and RPCs**

Use variant-first row locks, database `statement_timestamp()`, exact current-requester permission resolution through `private.employee_effective_permission_keys`, deletion-ID rotation on takeover, and server-derived ticket fields. Change register/reorder pending checks to distinguish registered pending from unrelated orphan pending.

- [ ] **Step 7: Run catalog pgTAP and verify GREEN**

Expected: all catalog/media tests pass with no path leakage and exact boundary behavior.

---

### Task 4: Concurrency and Real Storage HTTP

**Files:**
- Modify: `supabase/tests/warehouse_catalog_concurrency.sql`
- Modify: `supabase/tests/warehouse_photo_storage_http.mjs`
- Modify if required by stricter proof only: `supabase/tests/run_warehouse_catalog_concurrency.mjs`
- Modify: `supabase/tests/warehouse_catalog_concurrency_launcher.test.js`

**Interfaces:**
- Consumes claim/list/cancel/finalize RPCs and requester-bound Storage policies.
- Produces deterministic evidence for all takeover linearization cases.

- [ ] **Step 1: Add concurrency RED cases**

Add synchronized dblink tests for claim versus old cancel, claim versus old finalize, two claims of one old ID, and two finalizes. Assert one legal state transition, no metadata/object divergence, one immutable takeover receipt, and stable idempotent completion.

- [ ] **Step 2: Add HTTP RED cases**

Exercise sanitized list over REST, immediate disabled/no-manage takeover, pre-30 rejection, post-boundary claim with rotated ID, old requester Storage refusal, new requester exact remove, orphan lost-response recovery, and registered recovery without list/sign.

- [ ] **Step 3: Run launcher/concurrency/HTTP and verify RED**

Expected: missing list/claim behavior and old ownership rules fail.

- [ ] **Step 4: Make only test-supported integration adjustments**

Keep launcher proof before fixtures and preserve explicit project/workdir/container/context/non-default ports and fresh nonce validation. Do not add manual markers or default-port fallback.

- [ ] **Step 5: Run concurrency and HTTP and verify GREEN**

Expected: all concurrency TAP and real Storage HTTP scenarios pass with exact terminal object/metadata/outbox counts.

---

### Task 5: Full Verification, Cleanup, Report, and Fix Commit

**Files:**
- Update ignored local report: `.superpowers/task-03-report.md`
- Commit all approved runtime/test changes.

**Interfaces:**
- Produces a clean repository and no local Supabase resources.

- [ ] **Step 1: Run focused and full gates**

Run focused service/launcher Node tests, `npm test`, `npm run build`, catalog/media pgTAP, combined warehouse pgTAP, fail-closed fresh launcher, real HTTP, and full DB pgTAP. Separate only proven pre-existing baseline failures.

- [ ] **Step 2: Run security scans**

Scan for secrets and Task 3 pollution: public URLs, image base64, local persistence, legacy direct-delete RPC, path leakage in candidate responses, and hardcoded requester names/employee identifiers.

- [ ] **Step 3: Destroy isolated resources and verify absence**

Stop with no backup, remove the exact temporary workdir, and verify project-labelled containers/volumes/networks are absent and chosen API/DB ports have no listener.

- [ ] **Step 4: Update report and review diff**

Record RED/GREEN evidence, review line references, permission mapping, takeover invariants, full gates, known baseline, and cleanup proof. Run `git diff --check` and inspect staged file scope.

- [ ] **Step 5: Create the independent fix commit**

Commit with a focused `fix:` message, then verify `git status --short` is empty.

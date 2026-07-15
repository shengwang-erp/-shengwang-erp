# Project File Archive and Permanent Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` and execute one task at a time. Every behavior change starts with a failing test and ends with fresh verification.

**Goal:** Add project-level ordinary file management for 项目合同、效果图、增减项单据 with immutable versions, private standard/TUS uploads, server-side format verification, a SW-000-only deleted-project archive, and independently restorable long-term backups.

**Architecture:** PostgreSQL is authoritative for document identity, category authorization, version allocation, quotas, lifecycle transitions, audit events, and backup cutoffs. A private Supabase Storage bucket accepts only exact-path signed uploads issued by a narrowly scoped Edge Function. A bounded Node worker streams objects to temporary files, verifies size/SHA-256/actual format in a constrained child process, and activates a version only after final authorization. React owns only mounted-page upload state and short-lived URLs. A separate S3-compatible target plus asymmetric KMS marker supplies disaster-recovery copies; production resources remain out of scope until separately approved.

**Tech stack:** React 19, Vite 6, Node `node:test`, Supabase JS 2.110.x, PostgreSQL 15, pgTAP, Supabase Storage, `tus-js-client@4.3.1`, Supabase CLI `2.109.1`, AWS SDK v3 S3/KMS clients `3.1083.0`.

**Governing design:** `docs/superpowers/specs/2026-07-15-project-file-archive-permanent-storage-design.md`. This plan replaces `docs/superpowers/plans/2026-07-15-project-documents.md`; the old plan remains historical and must not be executed.

## Non-negotiable decisions

- Categories are exactly `project_contract`, `rendering`, and `contract_change_document`.
- `project_contract` and `contract_change_document` allow PDF, DOC/DOCX, XLS/XLSX, JPG/JPEG, PNG, and WEBP. `rendering` allows JPG/JPEG, PNG, WEBP, HEIC/HEIF, and PDF. Nothing else is accepted.
- 增减项单据 is an ordinary project file and has no foreign key to a contract-change record.
- `rendering` requires an active canonical employee with completed first-password change and `module.projects.view`. The two sensitive categories additionally require 设计部、财务部、社长, or employee number `SW-000`.
- Upload, new version, abandon, and void additionally require `module.projects.update`; the server repeats authorization at reserve, ticket, finalize request, activation, void, and access time.
- A soft-deleted project is invisible to ordinary project/document APIs. Only active `SW-000` receives the separate read-only archive projection.
- Bucket ID is `erp-project-documents`, private, 50 MiB max, and has no authenticated INSERT/SELECT/UPDATE/DELETE policy. Every standard and TUS object upload supplies cache-control value `0`, and the verifier rejects any object whose stored metadata differs.
- File paths are exactly `<projectId>/<documentId>/<version>` and contain no business name or extension. Uploads never use upsert.
- Maximum file size is `52_428_800`; standard upload is used through `6_291_456` bytes and TUS only above it. At most three browser transfers run concurrently.
- Upload ticket issuance ends five minutes after reservation; signed upload validity is two hours. Cleanup eligibility is reservation time plus five minutes, two hours, twenty-four hours, and one hour of grace.
- Preview/download URLs last exactly 300 seconds and are never persisted. Office files force attachment. The UI warns that files are format-checked but not virus-scanned.
- Office documents are never sent to a third-party preview service; images are not transcoded. HEIC/HEIF preview appears only when the current browser supports it, otherwise the UI offers download.
- A permission change or project deletion blocks every new access request immediately; a previously issued URL has an accepted residual window of at most 300 seconds.
- Active and void versions have no physical-delete business path. Metadata rows and audit rows cannot be deleted; audit rows cannot be updated.
- Browser state must not write document metadata, files, upload tickets, resume URLs, signed access URLs, or progress to localStorage, sessionStorage, IndexedDB, or Cache Storage.
- The verifier is a Node worker. Each parser child runs inside a hard 128 MiB total memory+swap boundary with a 64 MiB V8 heap ceiling and a 60-second wall-clock limit; a heap flag alone is not the isolation boundary.
- No production migration, function deployment, bucket mutation, worker schedule, backup target, KMS key, or production data purge is authorized by this plan.

## Current-worktree guard

The executor must preserve the current uncommitted project-page work and unrelated account work. Before every commit run `git status --short` and stage only the task's named files. In particular, never stage or edit:

- `src/auth/AuthGate.jsx`
- `src/features/employees/personnelPageContract.test.js`
- `supabase/functions/employee-bootstrap-admin/handler.js`
- `supabase/functions/employee-bootstrap-admin/handler.test.js`

`src/App.jsx`, `src/styles.css`, `src/features/projects/ProjectPage.jsx`, `src/features/projects/projectPageContract.test.js`, and `src/features/projects/projectAppIntegration.test.js` already contain in-progress user work. Patch only the named anchors; do not reconstruct or reformat those files.

## Interface contract

The browser document adapter is exactly:

```js
export class ProjectDocumentServiceError extends Error {
  constructor(code, message, { status = 0, authInvalid = false, retryAfterSeconds = null } = {}) {
    super(message)
    this.name = 'ProjectDocumentServiceError'
    this.code = code
    this.status = status
    this.authInvalid = authInvalid
    this.retryAfterSeconds = Number.isInteger(retryAfterSeconds) && retryAfterSeconds >= 0
      ? Math.min(retryAfterSeconds, 86400)
      : null
  }
}

export function createProjectDocumentService(client, dependencies = {}) {
  return {
    listProjectDocuments,
    listProjectDocumentHistory,
    listMyIncompleteProjectDocuments,
    reserveProjectDocument,
    issueProjectDocumentUploadTicket,
    uploadReservedProjectDocument,
    requestProjectDocumentFinalize,
    abandonProjectDocumentUpload,
    voidProjectDocument,
    createProjectDocumentAccess,
    listDeletedProjectArchive,
    listDeletedProjectDocuments,
    listProjectDocumentOperationalAlerts,
    getProjectDocumentBackupStatus,
  }
}

export const projectDocumentService = createProjectDocumentService(supabase, {
  configured: isSupabaseConfigured,
})
```

Supported injected dependencies are exactly `{ configured, hashFile, tusUploadFactory, fetchImpl, cryptoImpl, now, setTimeoutImpl, clearTimeoutImpl }`; production supplies only `configured`, while tests inject the remaining boundaries.

The method signatures are fixed:

```js
listProjectDocuments(projectId, { cursor = null, limit = 50 } = {})
listProjectDocumentHistory(logicalDocumentId, { cursor = null, limit = 50 } = {})
listMyIncompleteProjectDocuments(projectId, { cursor = null, limit = 50 } = {})
reserveProjectDocument({
  projectId,
  documentKind,
  logicalDocumentId = null,
  file,
})
issueProjectDocumentUploadTicket(documentId)
uploadReservedProjectDocument({
  reservation,
  ticket,
  file,
  resumeUrl = '',
  onProgress,
  signal,
})
requestProjectDocumentFinalize(documentId)
abandonProjectDocumentUpload(documentId)
voidProjectDocument({ documentId, reason })
createProjectDocumentAccess({ documentId, disposition })
listDeletedProjectArchive({ cursor = null, limit = 50 } = {})
listDeletedProjectDocuments(projectId, { cursor = null, limit = 50 } = {})
listProjectDocumentOperationalAlerts({ cursor = null, limit = 50 } = {})
getProjectDocumentBackupStatus()
```

`disposition` is exactly `preview` or `download`. A TUS interruption may return the client-only `resumeUrl`; no RPC accepts it.

The service validates the `File` and computes SHA-256 itself before calling the reserve RPC. The caller never supplies a checksum separately.

**Safe response shapes:**

```js
const reservation = {
  documentId: '11111111-1111-4111-8111-111111111111',
  projectId: 'P001',
  documentKind: 'project_contract',
  logicalDocumentId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  originalFileName: '契約書.pdf',
  fileExtension: 'pdf',
  declaredContentType: 'application/pdf',
  canonicalContentType: 'application/pdf',
  expectedSizeBytes: 1024,
  expectedChecksumSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'pending',
  uploadTicketIssuableUntil: '2026-07-15T00:05:00.000Z',
  createdByEmployeeNumber: 'SW-001',
  createdByEmployeeName: '上传人',
  createdAt: '2026-07-15T00:00:00.000Z',
}

const listedVersion = {
  documentId: '11111111-1111-4111-8111-111111111111',
  projectId: 'P001',
  documentKind: 'project_contract',
  logicalDocumentId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  originalFileName: '契約書.pdf',
  fileExtension: 'pdf',
  verifiedContentType: 'application/pdf',
  verifiedSizeBytes: 1024,
  verifiedChecksumSha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  status: 'active',
  createdByEmployeeNumber: 'SW-001',
  createdByEmployeeName: '上传人',
  createdAt: '2026-07-15T00:00:00.000Z',
  completedAt: '2026-07-15T00:01:00.000Z',
  voidedByEmployeeNumber: null,
  voidedAt: null,
  voidReason: null,
  failureCode: null,
}

const incompleteVersion = {
  documentId: '33333333-3333-4333-8333-333333333333',
  projectId: 'P001',
  documentKind: 'rendering',
  logicalDocumentId: '22222222-2222-4222-8222-222222222222',
  version: 2,
  originalFileName: '完成效果.png',
  expectedSizeBytes: 2048,
  status: 'queued',
  createdAt: '2026-07-15T00:02:00.000Z',
  canAbandon: false,
  failureCode: null,
}

const uploadTicket = {
  bucketId: 'erp-project-documents',
  objectPath: 'P001/11111111-1111-4111-8111-111111111111/1',
  token: 'short-lived-token',
  expiresAt: '2026-07-15T02:00:00.000Z',
  contentType: 'application/pdf',
}

const finalizeResult = {
  documentId: '11111111-1111-4111-8111-111111111111',
  status: 'queued',
  retryAfterSeconds: 1,
}

const uploadResult = {
  documentId: '11111111-1111-4111-8111-111111111111',
  status: 'pending',
  resumeUrl: '',
}

const abandonResult = {
  documentId: '33333333-3333-4333-8333-333333333333',
  status: 'cleanup_pending',
}

const accessResult = {
  url: 'http://127.0.0.1:54321/storage/v1/object/sign/erp-project-documents/example?token=example',
  expiresAt: '2026-07-15T00:06:00.000Z',
  disposition: 'download',
  originalFileName: '契約書.pdf',
  contentType: 'application/pdf',
}

const listedPage = {
  items: [listedVersion],
  nextCursor: 'opaque-server-validated-keyset-or-null',
}

const documentGroup = {
  logicalDocumentId: '22222222-2222-4222-8222-222222222222',
  projectId: 'P001',
  documentKind: 'project_contract',
  createdAt: '2026-07-15T00:00:00.000Z',
  latestVersionNumber: 3,
  currentVersion: listedVersion,
  hasHistory: true,
}

const operationalAlert = {
  alertId: '44444444-4444-4444-8444-444444444444',
  alertKind: 'project_capacity_warning',
  projectId: 'P001',
  safeCode: 'PROJECT_CAPACITY_80_PERCENT',
  createdAt: '2026-07-15T00:03:00.000Z',
}
```

Every list method returns `{ items, nextCursor }`, validates `limit` as an integer from 1 through 100, and uses a server-generated keyset cursor rather than an offset or the PostgREST row cap. Project-document group pages order by `(logical_created_at, logical_document_id) DESC`; history pages by `(version, document_id) DESC`; incomplete pages by `(created_at, document_id) DESC`; deleted-project pages by immutable `(deleted_at, record_key) DESC`; and alert pages by `(created_at, alert_id) DESC`. The cursor is opaque to the component and is accepted only by its matching RPC.

`listProjectDocuments` and `listDeletedProjectDocuments` return safe `documentGroup` items, not partial raw-version groups. `currentVersion` is the server-authoritative highest active version across the complete logical history (or `null`), so a page boundary can never produce a false fallback. `listProjectDocumentHistory` pages the active/void/failed versions for one logical parent and derives active-vs-deleted archive authorization entirely on the server; the browser cannot supply an archive flag. Failed history rows retain expected size, creator/time, and a safe `failureCode` while verified fields may be `null`. `listMyIncompleteProjectDocuments` returns only the caller's `pending/queued/finalizing/cleanup_pending` summaries; caller-owned cleanup-pending includes its safe `failureCode` immediately, even though physical cleanup waits 27h5m. Raw standard/TUS completion returns `uploadResult` and leaves the database row pending; only finalize request may return `queued`, `finalizing`, or an existing `active` projection. Abandon returns `abandonResult`; void returns the safe version with `status: 'void'`. The archive project list items contain only `{ projectId, projectName, customerName, deletedAt }`. Operational-alert items contain only the five fields shown above and are available only to active `SW-000`.

The backup-status projection is exactly `{ disasterRecoveryEnabled, latestBackup, latestFullInventory, latestRestoreDrill }`; each nested value is either `null` or a safe `{ status, startedAt, completedAt, objectCount, totalBytes, failureCode }` projection. It reports `disasterRecoveryEnabled: true` only after a completed backup, completed full inventory, and completed isolated restore drill are all recorded.

Safe client error codes are `AUTH_REQUIRED`, `AUTH_INVALID`, `PROJECT_NOT_FOUND`, `PROJECT_DOCUMENT_FORBIDDEN`, `PROJECT_DOCUMENT_NOT_FOUND`, `PROJECT_DOCUMENT_INPUT_INVALID`, `PROJECT_DOCUMENT_TYPE_INVALID`, `PROJECT_DOCUMENT_TOO_LARGE`, `PROJECT_DOCUMENT_LIMIT_REACHED`, `PROJECT_DOCUMENT_QUEUE_FULL`, `PROJECT_DOCUMENT_TICKET_EXPIRED`, `PROJECT_DOCUMENT_STATE_CONFLICT`, `PROJECT_DOCUMENT_UPLOAD_FAILED`, `PROJECT_DOCUMENT_PROCESSING`, and `PROJECT_DOCUMENT_SERVICE_UNAVAILABLE`. No provider error, object path, SQL detail, token, or lease is copied into an error.

For every document-ID operation (ticket, finalize, abandon, void, access), nonexistent ID, hidden sensitive category, deleted project, wrong owner, and otherwise inaccessible state all return the same `PROJECT_DOCUMENT_NOT_FOUND` response. `PROJECT_DOCUMENT_FORBIDDEN` is reserved for a caller who is already authorized to know the project exists but lacks a project-level list/reserve capability; no response may be used to enumerate hidden documents.

`ProjectDocumentsPanel` owns document state and receives:

```js
{
  projectId,
  canViewSensitiveDocuments,
  canUpdateProject,
  onAuthInvalid,
  service = projectDocumentService,
}
```

`DeletedProjectArchive` owns archive state and receives:

```js
{
  canViewArchive,
  onBack,
  onAuthInvalid,
  service = projectDocumentService,
}
```

Only safe list projections reach the browser. A normal or archive list never contains `bucket_id`, `object_path`, `processing_token`, `processing_lease_until`, job IDs, provider errors, tickets, or URLs. The short-lived upload-ticket response may contain `bucketId`, `objectPath`, `token`, `expiresAt`, and canonical `contentType` because the browser needs them for that one upload; the mounted panel keeps them only in memory.

## Dependency and file order

1. Finish the existing secure project runtime boundary so saved projects have server identities.
2. Add pure document domain, permissions, upload state, and pinned tooling.
3. Add immutable document tables/public RPCs, then worker state/backup migrations.
4. Add Edge upload-ticket and access functions.
5. Add bounded Node verifier/reaper/cleanup workers and Storage HTTP gate.
6. Add browser service, document panel, deleted archive, and minimal ProjectPage integration.
7. Add independent backup/restore tooling and complete verification.

### Task 1: Complete the secure project runtime prerequisite

**Files:**
- Create: `src/services/projectService.test.js`
- Create: `src/services/recordTableConfig.test.js`
- Create: `src/services/dashboardService.test.js`
- Modify: `src/services/projectService.js`
- Modify: `src/services/baseRecordService.js`
- Modify: `src/services/baseRecordService.test.js`
- Modify: `src/services/recordTableConfig.js`
- Modify: `src/services/dashboardService.js`
- Modify: `src/services/contractRevenueService.js`
- Modify: `src/services/contractRevenueService.test.js`
- Modify: `src/services/contractRevenueMigration.js`
- Modify: `src/services/contractRevenueMigration.test.js`
- Modify: `src/services/contractRevenueLocalMigration.js`
- Modify: `src/services/contractRevenueLocalMigration.test.js`
- Modify: `src/services/persistenceSecurityContract.test.js`
- Modify: `src/features/contract-revenue/ContractRevenuePage.jsx`
- Modify: `src/features/contract-revenue/ContractRevenueMigrationPanel.jsx`
- Modify: `src/features/contract-revenue/appRevenueIntegration.test.js`
- Modify: `src/features/contract-revenue/contractRevenueMigrationPanel.test.js`
- Modify: `src/features/contract-revenue/contractRevenuePage.test.js`
- Create from current worktree: `src/features/projects/ProjectPage.jsx`
- Create from current worktree: `src/features/projects/projectPageContract.test.js`
- Create from current worktree: `src/features/projects/projectAppIntegration.test.js`
- Modify: `src/dashboardLayout.test.js`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Interfaces:**

```js
createProjectService(client, { configured })
projectService.listProjects()
projectService.createProject(payload)
projectService.updateProject(projectId, patch)
projectService.softDeleteProject(projectId)
```

- [ ] **Step 1: Write failing project-service tests.** Assert the four methods call only `list_projects_secure`, `create_project_secure`, `update_project_secure`, and `soft_delete_project_secure`; validate safe projections; map auth failures to `ProjectServiceError.authInvalid`; reject unconfigured access without touching a generic adapter. The deleted-project timestamp is added by the first forward document migration, not by rewriting the already-committed 001 migration.

```js
test('project writes use only secure RPCs', async () => {
  const calls = []
  const service = createProjectService({
    rpc: async (name, args) => {
      calls.push([name, args])
      return { data: name === 'soft_delete_project_secure' ? 'P001' : { projectId: 'P001' }, error: null }
    },
  }, { configured: true })
  await service.createProject({ projectName: '安全项目' })
  await service.updateProject('P001', { remark: '更新' })
  await service.softDeleteProject('P001')
  assert.deepEqual(calls.map(([name]) => name), [
    'create_project_secure',
    'update_project_secure',
    'soft_delete_project_secure',
  ])
})
```

- [ ] **Step 2: Run RED.**

```bash
node --test src/services/projectService.test.js
```

- [ ] **Step 3: Implement only the strict project RPC adapter.** Add `ProjectServiceError`, safe response validation, auth-invalid mapping, configured-state failure, singleton exports, and no generic fallback. Leave the already-committed project migration untouched; the document migration adds the forward-compatible deleted timestamp later.

- [ ] **Step 4: Run the project-service test GREEN.**

```bash
node --test src/services/projectService.test.js
```

- [ ] **Step 5: Write failing adapter/quarantine tests before changing them.** In `baseRecordService.test.js`, `recordTableConfig.test.js`, `dashboardService.test.js`, `contractRevenueService.test.js`, `contractRevenueMigration.test.js`, `contractRevenueLocalMigration.test.js`, and `persistenceSecurityContract.test.js`, assert removal of all four generic mappings, injected dashboard inputs, explicit revenue table methods, one transactional migration RPC per project, and the bounded legacy-key quarantine described below.

- [ ] **Step 6: Run the adapter tests RED.**

```bash
node --test src/services/baseRecordService.test.js src/services/recordTableConfig.test.js src/services/dashboardService.test.js src/services/contractRevenueService.test.js src/services/contractRevenueMigration.test.js src/services/contractRevenueLocalMigration.test.js src/services/persistenceSecurityContract.test.js
```

- [ ] **Step 7: Implement the adapters and migration quarantine.** Remove all four project/revenue mappings from `baseRecordService` and `recordTableConfig`; make dashboard inputs injected safe projections; route explicit administrator legacy conversion through the existing `migrate_legacy_project_contract_secure(p_project_id, p_expected_legacy_contract, p_opening_receipt)` RPC, where `p_opening_receipt` is one validated receipt or null; and replace the contract-revenue generic adapter with explicit authorized table methods.

  Before the separate production migration checkpoint, only `contractRevenueLocalMigration.js` may contain and read `erp.projects`, `erp.projectContractChanges`, `erp.projectPaymentPlans`, `erp.projectReceipts`, or `erp.contractRevenueMigrationBackups`; the administrator-only migration panel may invoke that service only after an explicit migration action. The service validates a bounded snapshot and sends one project plus its single opening receipt to the transactional RPC; it never rehydrates App state or uses generic CRUD. Update the panel to show secure RPC results and idempotent replay state instead of claiming that only local data is changed. Do not purge the five keys or remove this quarantined panel until backup path, server counts/samples, idempotent replay, and explicit user approval are recorded.

- [ ] **Step 8: Run the adapter tests GREEN.**

```bash
node --test src/services/baseRecordService.test.js src/services/recordTableConfig.test.js src/services/dashboardService.test.js src/services/contractRevenueService.test.js src/services/contractRevenueMigration.test.js src/services/contractRevenueLocalMigration.test.js src/services/persistenceSecurityContract.test.js
```

- [ ] **Step 9: Write failing App/financial integration contracts before changing App.** Preserve the current extracted `ProjectPage.jsx` and its namespaced styles, then update `projectPageContract.test.js`, `projectAppIntegration.test.js`, `appRevenueIntegration.test.js`, `contractRevenueMigrationPanel.test.js`, `contractRevenuePage.test.js`, and `dashboardLayout.test.js`. Assert session-only state, authenticated secure loading, awaited server mutations, no browser project ID allocation, pre-call financial gating, authorized route/dashboard rendering, `canUpdateFinancials`, and the administrator-only migration panel.

- [ ] **Step 10: Run integration RED.**

```bash
node --test src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/features/contract-revenue/contractRevenueMigrationPanel.test.js src/features/contract-revenue/contractRevenuePage.test.js src/dashboardLayout.test.js
```

- [ ] **Step 11: Implement the runtime integration.** In `App.jsx`, replace project/revenue `usePersistentState` calls with session `useState`, load only after authentication, await secure mutations, take returned server rows as truth, and fail closed before any financial load/snapshot/route. Add `canUpdateFinancials` to `ContractRevenuePage`.

- [ ] **Step 12: Run all prerequisite tests GREEN.** The contracts assert runtime code does not call generic CRUD with any of the four project/revenue keys, only `contractRevenueLocalMigration.js` contains the five literal legacy keys outside tests, no browser code allocates project IDs, no financial rows load before `canViewProjectFinancials(currentUser)`, and unauthorized snapshots never reach Home/Dashboard/contract-revenue routes.

```bash
node --test src/services/projectService.test.js src/services/baseRecordService.test.js src/services/recordTableConfig.test.js src/services/dashboardService.test.js src/services/contractRevenueService.test.js src/services/contractRevenueMigration.test.js src/services/contractRevenueLocalMigration.test.js src/services/projectCoreSecuritySchema.test.js src/services/persistenceSecurityContract.test.js
node --test src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/features/contract-revenue/contractRevenueMigrationPanel.test.js src/features/contract-revenue/contractRevenuePage.test.js src/dashboardLayout.test.js
npm run build
```

- [ ] **Step 13: Commit only prerequisite files.**

```bash
git add src/services/projectService.js src/services/projectService.test.js src/services/baseRecordService.js src/services/baseRecordService.test.js src/services/recordTableConfig.js src/services/recordTableConfig.test.js src/services/dashboardService.js src/services/dashboardService.test.js src/services/contractRevenueService.js src/services/contractRevenueService.test.js src/services/contractRevenueMigration.js src/services/contractRevenueMigration.test.js src/services/contractRevenueLocalMigration.js src/services/contractRevenueLocalMigration.test.js src/services/persistenceSecurityContract.test.js src/features/contract-revenue/ContractRevenuePage.jsx src/features/contract-revenue/ContractRevenueMigrationPanel.jsx src/features/contract-revenue/appRevenueIntegration.test.js src/features/contract-revenue/contractRevenueMigrationPanel.test.js src/features/contract-revenue/contractRevenuePage.test.js src/features/projects/ProjectPage.jsx src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js src/dashboardLayout.test.js src/App.jsx src/styles.css
git commit -m "feat: route projects through secure runtime"
```

### Task 2: Add document domain, UI permissions, upload reducer, and pinned tools

**Files:**
- Create: `src/features/projects/projectDocumentDomain.js`
- Create: `src/features/projects/projectDocumentDomain.test.js`
- Create: `src/features/projects/projectDocumentPermissions.js`
- Create: `src/features/projects/projectDocumentPermissions.test.js`
- Create: `src/features/projects/projectDocumentUploadState.js`
- Create: `src/features/projects/projectDocumentUploadState.test.js`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

```js
PROJECT_DOCUMENT_KINDS
MAX_PROJECT_DOCUMENT_BYTES
TUS_THRESHOLD_BYTES
SIGNED_ACCESS_TTL_SECONDS
sanitizeDisplayFileName(value)
sanitizeVoidReason(value)
validateProjectDocumentFile({ documentKind, file })
buildProjectDocumentGroups(rows)
canViewProjectDocumentKind(employee, documentKind)
canUpdateProjectDocumentKind(employee, documentKind)
canViewDeletedProjectArchive(employee)
projectDocumentUploadReducer(state, action)
runWithConcurrency(items, 3, worker)
```

- [ ] **Step 1: Write failing domain tests.** Cover exact kinds, 50/6 MiB boundaries, the exact allowlists above, rendering HEIC/HEIF with empty declared MIME normalization, all other empty MIME values rejected, mismatched extension/MIME rejection, 255 UTF-8-byte sanitized names, 1–500 character void reasons, highest-active fallback after a void, and no version reuse. Filename sanitization removes directory components, CR/LF, NUL, bidi controls, and all Unicode control/format characters before NFC normalization and byte truncation.

```js
test('categories and byte boundaries are exact', () => {
  assert.deepEqual(PROJECT_DOCUMENT_KINDS, [
    'project_contract',
    'rendering',
    'contract_change_document',
  ])
  assert.equal(MAX_PROJECT_DOCUMENT_BYTES, 50 * 1024 * 1024)
  assert.equal(TUS_THRESHOLD_BYTES, 6 * 1024 * 1024)
  assert.equal(validateProjectDocumentFile({
    documentKind: 'rendering',
    file: { name: '效果.heic', type: '', size: 1024 },
  }).canonicalContentType, 'image/heic')
})
```

- [ ] **Step 2: Write failing permission and reducer tests.** Cover active/employed/changed-password prerequisites; rendering view/update; sensitive fixed whitelist; SW-000-only archive; three-transfer concurrency; state sequence `hashing -> reserving -> uploading -> finalizing -> active`; interruption resume URL in memory; abandon only while pending; and 1/2/4/8/10-second polling capped at five minutes.

- [ ] **Step 3: Run RED.**

```bash
node --test src/features/projects/projectDocumentDomain.test.js src/features/projects/projectDocumentPermissions.test.js src/features/projects/projectDocumentUploadState.test.js
```

- [ ] **Step 4: Install exact dependencies.**

```bash
npm install --save-exact tus-js-client@4.3.1 @aws-sdk/client-s3@3.1083.0 @aws-sdk/client-kms@3.1083.0
npm install --save-dev --save-exact supabase@2.109.1
```

- [ ] **Step 5: Implement pure modules and run GREEN.** Never import the Supabase client into these files.

```bash
node --test src/features/projects/projectDocumentDomain.test.js src/features/projects/projectDocumentPermissions.test.js src/features/projects/projectDocumentUploadState.test.js
```

- [ ] **Step 6: Commit the pure slice.**

```bash
git add package.json package-lock.json src/features/projects/projectDocumentDomain.js src/features/projects/projectDocumentDomain.test.js src/features/projects/projectDocumentPermissions.js src/features/projects/projectDocumentPermissions.test.js src/features/projects/projectDocumentUploadState.js src/features/projects/projectDocumentUploadState.test.js
git commit -m "feat: define project file archive domain"
```

### Task 3: Create immutable document metadata and public browser RPCs

**Files:**
- Create: `supabase/migrations/202607150002_project_documents.sql`
- Create: `src/services/projectDocumentSchema.test.js`
- Create: `supabase/tests/project_documents.sql`
- Modify: `docs/supabase-schema.md`

**Database objects:**

- `project_document_logicals`
- `project_documents`
- `project_document_events`
- private Storage bucket `erp-project-documents`
- fixed helpers `can_current_employee_view_project_document_kind(text)` and `can_current_employee_update_project_document_kind(text)`
- browser RPCs listed below

```sql
list_project_documents_secure(p_project_id text, p_cursor text default null, p_limit integer default 50)
list_project_document_history_secure(p_logical_document_id uuid, p_cursor text default null, p_limit integer default 50)
list_my_incomplete_project_documents_secure(p_project_id text, p_cursor text default null, p_limit integer default 50)
abandon_project_document_upload_secure(p_document_id uuid)
void_project_document_secure(p_document_id uuid, p_reason text)
list_deleted_project_archive_secure(p_cursor text default null, p_limit integer default 50)
list_deleted_project_documents_secure(p_project_id text, p_cursor text default null, p_limit integer default 50)
```

**Required version columns:** `document_id`, `project_id`, `document_kind`, `logical_document_id`, `version`, `bucket_id`, `object_path`, sanitized original name, extension, original declared MIME, canonical upload MIME, verified MIME, expected/verified size, expected/verified SHA-256, status, processing token/lease, ticket issuance deadline, cleanup deadline, creator ID/number/name snapshots, creation/completion times, void actor snapshots/time/reason, and safe failure code. `project_document_logicals` carries immutable project/kind/creator identity plus `last_reserved_version`.

- [ ] **Step 1: Write failing static and pgTAP contracts before the migration.** The Node contract asserts the forward `projects.deleted_at` alteration/backfill/immutable trigger and exact document table/function/check names, the composite parent FK, unique `(logical_document_id, version)`, exact object-path constraint, all three immutable/delete triggers, fixed search paths, `REVOKE ALL`, minimal `GRANT EXECUTE`, no authenticated Storage policy, explicit drops only for the three obsolete `erp-project-documents` policy names, and a fixture policy on another bucket remains unchanged. It also proves the schema/service contain neither `contract_change_id` nor any FK/reference to `project_contract_changes`; `contract_change_document` remains an ordinary project file. `project_documents.sql` tests role/category filtering, server sanitization/type validation, keyset pagination with more than 1,000 logical parents, more than 1,000 retained versions under one parent, and more than 1,000 deleted projects; authoritative `currentVersion` must remain correct when the active fallback is outside the first history page. Also cover list/history/incomplete/abandon/void behavior, archive denial, immutable rows/events, and hard-delete restriction.

```js
test('document rows are immutable and browser table access is closed', () => {
  assert.match(sql, /create table public\.project_document_logicals/i)
  assert.match(sql, /create table public\.project_documents/i)
  assert.match(sql, /create trigger reject_project_document_delete/i)
  assert.match(sql, /revoke all on public\.project_documents from anon, authenticated/i)
  assert.doesNotMatch(sql, /create policy[\s\S]+storage\.objects[\s\S]+to authenticated/i)
})
```

- [ ] **Step 2: Run both contracts RED.** The static test fails because the migration is absent; pgTAP fails because the tables/functions are absent.

```bash
node --test src/services/projectDocumentSchema.test.js
npx supabase start
npx supabase db reset
npx supabase test db supabase/tests/project_documents.sql
```

- [ ] **Step 3: Implement the forward schema, server input rules, and immutable state rules.** At the start of this migration, add nullable `projects.deleted_at`, backfill existing deleted rows from their deletion-time `updated_at`, add the status/timestamp consistency check and an immutable timestamp trigger, and replace `soft_delete_project_secure` with a same-lock update that sets `deleted_at=statement_timestamp()` exactly once. Do not rewrite 001. Then use `projects(record_key)` with `ON DELETE RESTRICT`; store actor snapshots; enforce `pending`, `queued`, `finalizing`, `active`, `void`, `failed`, `cleanup_pending`; enforce all identity/verified-field invariants in triggers; create bucket with union MIME allowlist, `public=false`, `file_size_limit=52428800`, and no authenticated policies.

  The database, not browser output, derives basename and extension; strips `/`, `\\`, CR/LF, NUL, bidi controls, and every Unicode control/format character; normalizes NFC; rejects empty names; and truncates only at a character boundary to at most 255 UTF-8 bytes. The void reason uses the same control cleanup, trims whitespace, and requires 1–500 characters. Fixed server mappings validate category+extension+declared MIME, positive size through 52,428,800 bytes, and exactly 64 lowercase SHA-256 hex characters. Only HEIC/HEIF may retain an empty original declared MIME; the server stores `image/heic` or `image/heif` as canonical upload MIME while preserving the empty declaration.

- [ ] **Step 4: Implement safe projections.** Sensitive rows must be absent rather than redacted. Ordinary APIs reject deleted projects uniformly. Archive APIs are SW-000-only and read-only. Group pages include the authoritative highest active `currentVersion`; history is a separate keyset-paged RPC and never computes fallback from a partial client page. Each list returns one JSON `{ items, nextCursor }` page, validates limit 1–100, and uses the exact keysets in the Interface contract so PostgREST's 1,000-row cap cannot hide permanent history. No public projection returns internal path, token, lease, or job data. Do not expose `reserve_project_document_secure` in this migration because its global queue constraint depends on the next migration.

- [ ] **Step 5: Run static and database GREEN, then commit.**

```bash
node --test src/services/projectDocumentSchema.test.js src/services/projectCoreSecuritySchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_documents.sql
git add supabase/migrations/202607150002_project_documents.sql src/services/projectDocumentSchema.test.js supabase/tests/project_documents.sql docs/supabase-schema.md
git commit -m "feat: add immutable project document metadata"
```

### Task 4: Add reservation admission, quotas, and scoped targets

**Files:**
- Create: `supabase/migrations/202607150003_project_document_reservations.sql`
- Create: `src/services/projectDocumentReservationSchema.test.js`
- Create: `supabase/tests/project_document_reservations.sql`
- Modify: `docs/supabase-schema.md`

**Browser RPCs:**

```sql
reserve_project_document_secure(
  p_project_id text,
  p_document_kind text,
  p_logical_document_id uuid,
  p_original_file_name text,
  p_declared_content_type text,
  p_expected_size_bytes bigint,
  p_expected_checksum_sha256 text
)
set_project_document_quota_override_secure(
  p_project_id text,
  p_employee_number text,
  p_project_capacity_bytes bigint,
  p_employee_hourly_reservation_limit integer,
  p_employee_rolling_24h_bytes bigint,
  p_expires_at timestamptz,
  p_reason text
)
revoke_project_document_quota_override_secure(p_override_id uuid, p_reason text)
list_project_document_operational_alerts_secure(p_cursor text default null, p_limit integer default 50)
```

The browser passes SQL `null` for a new logical parent. Only active `SW-000` may set/revoke an override. At least one scope and one matching raised value are required: project capacity requires `p_project_id`; employee hourly/24-hour values require `p_employee_number`; both scopes may appear in one override. Values may only raise defaults, expiry must be in the future and no more than seven days, and every set/revoke records old/new values, reason, actor snapshot, and time. The implementation-stage management caller is the loopback-only CLI in Task 8; production use is not authorized by this plan.

**Service-role RPCs:** `project_document_upload_ticket_target_internal(p_document_id uuid, p_actor_auth_user_id uuid)`, `project_document_access_target_internal(p_document_id uuid, p_actor_auth_user_id uuid, p_disposition text)`, and `record_project_document_access_outcome_internal(p_request_id uuid, p_actor_auth_user_id uuid, p_succeeded boolean, p_safe_code text)`.

- [ ] **Step 1: Write reservation-only static and pgTAP tests first.** Cover the reserve signature/grant, fixed global→employee→project→logical lock order, malicious server inputs, same-parent concurrent versions, cross-project employee races, global-slot races, and all default quota boundaries. Do not add override, alert, or target assertions yet.

- [ ] **Step 2: Run RED against the current 002-only schema.**

```bash
node --test src/services/projectDocumentReservationSchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_document_reservations.sql
```

- [ ] **Step 3: Implement reservation admission only.** The transaction takes locks in the exact order global quota advisory lock → employee advisory lock → project advisory lock → existing logical parent `FOR UPDATE`, then re-counts and inserts. Interactive 5-per-employee and 20-per-project limits count `pending/queued/finalizing`; transition to `cleanup_pending` releases those slots immediately. Hourly count and rolling 24-hour bytes count every immutable reservation created in the window regardless of its current/final status (`pending`, `queued`, `finalizing`, `cleanup_pending`, `active`, `void`, or `failed`), so failure cannot refund abuse/rate accounting. The global ceiling 200 counts `pending/queued/finalizing`; reserve occupies one atomically, so later finalize bursts cannot exceed it. Active/void bytes and all unfinished expected bytes, including cleanup-pending, count toward 20 GiB capacity; failed rows do not count toward stored capacity.

- [ ] **Step 4: Run reservation GREEN before adding overrides.**

```bash
node --test src/services/projectDocumentReservationSchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_document_reservations.sql
```

- [ ] **Step 5: Extend the tests and run a second RED.** Add exact override/revoke/alert/target signatures and grants, scope validation, expiry, audit, capacity 80% and global queue 160/200 alert thresholds, one-per-type/resource/hour dedupe, SW-000 paginated safe alert projection, target ownership/ticket deadline, and access authorization/outcomes. Guessed/missing/hidden/deleted/wrong-owner document IDs must be indistinguishable as `PROJECT_DOCUMENT_NOT_FOUND`.

```bash
node --test src/services/projectDocumentReservationSchema.test.js
npx supabase test db supabase/tests/project_document_reservations.sql
```

- [ ] **Step 6: Add the SW-000 override, durable alert, and target slices.** Create `project_document_quota_overrides` and append-only `project_document_operational_alerts`; revoke direct anon/authenticated table privileges. Capacity and queue-threshold paths insert safe, deduplicated alerts. Revoke stops future override use without deleting data. Upload target rechecks pending ownership/project/update permission/five-minute deadline. Access target appends `access_authorized` and returns a random request ID; the outcome RPC matches it and records only `access_link_issued` or `access_link_failed` plus a safe code. A production external alert sink/credential is deliberately not configured locally.

- [ ] **Step 7: Run GREEN and commit.**

```bash
node --test src/services/projectDocumentReservationSchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_document_reservations.sql
git add supabase/migrations/202607150003_project_document_reservations.sql src/services/projectDocumentReservationSchema.test.js supabase/tests/project_document_reservations.sql docs/supabase-schema.md
git commit -m "feat: reserve project document versions safely"
```

### Task 5: Add verification claims, retries, reaper, and cleanup

**Files:**
- Create: `supabase/migrations/202607150004_project_document_workers.sql`
- Create: `src/services/projectDocumentWorkerSchema.test.js`
- Create: `supabase/tests/project_document_worker_claims.sql`
- Create: `supabase/tests/project_document_worker_recovery.sql`
- Modify: `docs/supabase-schema.md`

**RPCs:** `request_project_document_finalize_secure`, `claim_project_document_verification_internal`, `renew_project_document_verification_lease_internal`, `finalize_project_document_internal`, `requeue_project_document_verification_internal`, `move_project_document_to_cleanup_internal`, `reap_project_document_jobs_internal`, `claim_project_document_cleanup_internal`, `complete_project_document_cleanup_internal`, `release_project_document_cleanup_internal`, and service-role-only `reset_project_document_cleanup_internal(p_document_id uuid, p_reason text)`.

- [ ] **Step 1: Write failing static and claim/finalize pgTAP tests.** Assert one job per document, no job token/lease, claim creates the sole version token, idempotent finalize request, final live authorization, size/hash/type agreement, live lease matching, and active/void/failed list projections.

- [ ] **Step 2: Run claim RED.**

```bash
node --test src/services/projectDocumentWorkerSchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_document_worker_claims.sql
```

- [ ] **Step 3: Implement only queue, claim, renew, and atomic activation; run GREEN.** A 2-minute lease renews every 30 seconds. Worker-owned changes require `finalizing + token + unexpired lease`; activation repeats employee/category/update/project-not-deleted authorization.

```bash
npx supabase db reset
npx supabase test db supabase/tests/project_document_worker_claims.sql
```

- [ ] **Step 4: Write and run recovery RED before implementing it.** Test transient/terminal errors, crash recovery, never-claimed deadline, all cleanup races, cleanup delay, retry exhaustion alerting, and audited manual reset. `retry_count=0` is the initial claim; five retries use 5s, 30s, 2m, 10m, and 30m, for at most six claims, with the two-hour deadline winning.

```bash
npx supabase test db supabase/tests/project_document_worker_recovery.sql
```

- [ ] **Step 5: Implement reaper and cleanup; run recovery GREEN.** Reaper alone matches expired leases and never deletes. Every `cleanup_pending` source, including deterministic verifier failure and abandoned pending, remains unclaimable until `cleanup_not_before` (27h5m after reservation), preventing a still-valid upload/TUS credential from recreating a deleted path. Cleanup takes a fresh 2-minute token/lease. After delete failure 1 set the next claim to +1 minute; failure 2 to +5 minutes; failure 3 to +15 minutes; failure 4 to +1 hour; failures 5 through 9 to +4 hours. Claim always enforces that timestamp. Failure 10 keeps `cleanup_pending`, inserts the deduplicated durable `cleanup_retry_exhausted` alert, and disables automatic claims until `reset_project_document_cleanup_internal` is invoked with a sanitized audit reason by a service-role operator.

```bash
npx supabase db reset
npx supabase test db supabase/tests/project_document_worker_claims.sql
npx supabase test db supabase/tests/project_document_worker_recovery.sql
```

- [ ] **Step 6: Commit the worker database slice.**

```bash
git add supabase/migrations/202607150004_project_document_workers.sql src/services/projectDocumentWorkerSchema.test.js supabase/tests/project_document_worker_claims.sql supabase/tests/project_document_worker_recovery.sql docs/supabase-schema.md
git commit -m "feat: add project document processing state machine"
```

### Task 6: Add backup cutoffs, inventory, and restore-drill status

**Files:**
- Create: `supabase/migrations/202607150005_project_document_backup.sql`
- Create: `src/services/projectDocumentBackupSchema.test.js`
- Create: `supabase/tests/project_document_backup.sql`
- Modify: `docs/supabase-schema.md`

**RPCs:** `freeze_project_document_backup_internal`, `read_project_document_backup_page_internal(p_run_id uuid, p_section text, p_after_sort_key text, p_limit integer)`, `complete_project_document_backup_internal`, `fail_project_document_backup_internal`, `start_project_document_recovery_check_internal`, `complete_project_document_recovery_check_internal`, `fail_project_document_recovery_check_internal`, and `get_project_document_backup_status_secure`.

- [ ] **Step 1: Write static and pgTAP RED tests.** Assert backup run/frozen-snapshot/item/recovery-check tables, no stored credentials, one-transaction cutoff, full archive schema, active/void inventory, in-flight `recovery_interrupted` conversion, no verification jobs, SW-000-only safe status, and the exact `{ disasterRecoveryEnabled, latestBackup, latestFullInventory, latestRestoreDrill }` projection. Seed more than 1,000 rows in every unbounded frozen section and prove `read_project_document_backup_page_internal` walks deterministic keysets to the exact count/hash without offset pagination or truncation. Force backup, full-inventory, and restore-drill failures and assert each writes one hourly-deduplicated durable alert with a safe code, then appears in the SW-000 projection.

```bash
node --test src/services/projectDocumentBackupSchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_document_backup.sql
```

- [ ] **Step 2: Implement cutoff/fail paths and run their tests GREEN.** Freeze UTC cutoff, projects/actors/logicals/all versions/events, active/void objects, and the exact `archive_schema_version` identifier in one transaction; the canonical schema bytes are materialized later by Task 14, not generated by SQL. Store deterministic section/sort keys and expose pages of 1–500 rows only through the service-role reader; callers continue until `nextSortKey=null`. Backup, inventory, and restore-drill failures write safe deduplicated durable operational alerts in the same completion/failure transaction.

- [ ] **Step 3: Implement completion and recovery checks; run full GREEN.** A completed backup records schema version, cutoff, manifest hash, count, bytes, all data/schema/manifest destination version IDs, and the separately returned marker version ID after readback. Recovery checks have kind `full_inventory` or `restore_drill`, safe status/times/counts/bytes/failure code, and no credentials. Disaster recovery becomes true only when all three latest records are completed.

```bash
node --test src/services/projectDocumentBackupSchema.test.js
npx supabase db reset
npx supabase test db supabase/tests/project_document_backup.sql
```

- [ ] **Step 4: Commit.**

```bash
git add supabase/migrations/202607150005_project_document_backup.sql src/services/projectDocumentBackupSchema.test.js supabase/tests/project_document_backup.sql docs/supabase-schema.md
git commit -m "feat: track project document recovery points"
```

### Task 7: Add exact-path upload-ticket and signed-access Edge Functions

**Files:**
- Create: `supabase/functions/project-document-upload-ticket/index.ts`
- Create: `supabase/functions/project-document-upload-ticket/handler.js`
- Create: `supabase/functions/project-document-upload-ticket/handler.test.js`
- Create: `supabase/functions/project-document-upload-ticket/security-contract.test.js`
- Create: `supabase/functions/project-document-access/index.ts`
- Create: `supabase/functions/project-document-access/handler.js`
- Create: `supabase/functions/project-document-access/handler.test.js`
- Create: `supabase/functions/project-document-access/security-contract.test.js`
- Create: `supabase/functions/project-documents-local.env.example`
- Modify: `supabase/config.toml`

- [ ] **Step 1: Write failing handler tests.** Follow the injected-dependency pattern in `permission-templates`. Require POST JSON with exact fields, bounded request size, live `requireActiveEmployee`, admin RPC target lookup, safe provider-error mapping, no target/token logging, and no caller-provided bucket/path/filename/TTL/category. Missing/hidden/deleted/wrong-owner document targets have the same safe not-found response. Access tests require an `access_authorized` request ID from target lookup and verify that both signing success and signing failure call the outcome RPC with only a boolean and safe failure code.

```js
test('upload ticket signs only the database-selected path without upsert', async () => {
  const signed = []
  const handler = createProjectDocumentUploadTicketHandler({
    requireActiveEmployee: async () => ({ authUserId: 'user-1' }),
    findUploadTarget: async () => ({
      bucketId: 'erp-project-documents',
      objectPath: 'P001/11111111-1111-4111-8111-111111111111/1',
      contentType: 'application/pdf',
      expiresAt: '2026-07-15T02:00:00.000Z',
    }),
    createSignedUploadUrl: async (target, options) => {
      signed.push([target, options])
      return { token: 'short-lived-token' }
    },
  })
  const response = await handler(jsonRequest({ documentId: '11111111-1111-4111-8111-111111111111' }))
  assert.equal(response.status, 200)
  assert.deepEqual(signed[0][1], { upsert: false })
})
```

- [ ] **Step 2: Run RED.**

```bash
node --test supabase/functions/project-document-upload-ticket/*.test.js supabase/functions/project-document-access/*.test.js
```

- [ ] **Step 3: Implement upload tickets.** The internal RPC accepts `documentId` plus authenticated actor ID, rechecks pending ownership/permission/project/ticket window, and returns the database path only to the service-role caller. Sign with `{ upsert: false }`; return a two-hour expiry and canonical MIME. Never store the token.

- [ ] **Step 4: Implement access links.** The target RPC rechecks active/void access and archive mode derived from project state, appends `access_authorized`, and returns a random request ID plus target metadata to the function. Generate a 300-second URL. Preview only browser-safe image/PDF types; force Office and unsupported types to attachment using the sanitized original filename. After signing, call the service-role-only outcome RPC to append `access_link_issued`; on provider failure append `access_link_failed` with a safe code before returning a safe error. Neither outcome contains the URL or provider message.

- [ ] **Step 5: Enable JWT verification and run GREEN.** The tracked env example is explicitly loopback-only and contains `CORS_ALLOWED_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:5174,http://localhost:5174`, fixed non-production `AUTH_ID_DERIVATION_SECRET` and `LOGIN_RATE_LIMIT_SECRET` values, and one fixed local acceptance password. It contains no Supabase URL, anon key, service-role key, or cloud credential. Preserve the existing local auth `site_url`, add both `http://127.0.0.1:5174/**` and `http://localhost:5174/**` to `auth.additional_redirect_urls`, and test that both origins are accepted without removing 5173. The seed script derives Auth aliases with the same local derivation secret. Document E2E requests send `Origin: http://127.0.0.1:5174`, and every local `functions serve` command passes this env file.

```toml
[functions.project-document-upload-ticket]
verify_jwt = true

[functions.project-document-access]
verify_jwt = true
```

```bash
node --test supabase/functions/project-document-upload-ticket/*.test.js supabase/functions/project-document-access/*.test.js
git add supabase/functions/project-document-upload-ticket supabase/functions/project-document-access supabase/functions/project-documents-local.env.example supabase/config.toml
git commit -m "feat: issue scoped project document links"
```

### Task 8: Prove signed standard/TUS Storage behavior before building workers

**Files:**
- Create: `scripts/project-documents/storage-http-client.mjs`
- Create: `scripts/project-documents/storage-http-client.test.mjs`
- Create: `scripts/project-documents/local-supabase-env.mjs`
- Create: `scripts/project-documents/local-supabase-env.test.mjs`
- Create: `scripts/project-document-storage-http.e2e.mjs`
- Create: `scripts/start-project-document-local-app.mjs`
- Create: `scripts/start-project-document-local-app.test.mjs`
- Create: `scripts/seed-project-document-local-acceptance.mjs`
- Create: `scripts/seed-project-document-local-acceptance.test.mjs`
- Create: `scripts/manage-project-document-quota-local.mjs`
- Create: `scripts/manage-project-document-quota-local.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write HTTP-client and local-env tests RED.** Assert standard upload uses the exact ticket path/token, `upsert:false`, canonical MIME, and `cacheControl:'0'`. Assert TUS uses 6 MiB chunks, `x-signature`, `x-upsert:false`, metadata `cacheControl:'0'`, no persistent fingerprint store, and an explicit in-memory resume URL. The env parser accepts only loopback API/Storage/Functions URLs from `supabase status -o json`, returns the local anon/service keys without logging them, and rejects the current remote `.env.local` values.

```bash
node --test scripts/project-documents/storage-http-client.test.mjs scripts/project-documents/local-supabase-env.test.mjs
```

- [ ] **Step 2: Implement the protocol client/env parser and run unit GREEN.** Keep URL/token/resume/key state in arguments and return values only; never log or persist them.

```bash
node --test scripts/project-documents/storage-http-client.test.mjs scripts/project-documents/local-supabase-env.test.mjs
```

- [ ] **Step 3: Write start/seed/quota-management tests RED.** The start helper must spawn Vite on `127.0.0.1:5174 --strictPort` with process-only `VITE_SUPABASE_URL`, both `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_ANON_KEY` set to the same loopback local publishable/anon value, and `VITE_LOCAL_DEMO_MODE=false` from the loopback status result. This explicitly defeats the publishable-key precedence in `src/lib/supabaseClient.js`; it never reads/changes `.env.local` and never prints a key. Before spawning, bind-probe port 5174 and exit nonzero if occupied; never kill a process, select another port, or touch existing 5173. The idempotent seed helper must refuse non-loopback hosts, derive Auth aliases using the tracked local-only secret, and create SW-000, design, finance, president, ordinary updater, view-only, disabled, and departed accounts plus exact project permissions and `LOCAL-DOC-001`.

  The quota CLI also refuses non-loopback hosts. It signs in as the seeded SW-000 using the fixed local-only acceptance password, supports exact `set` arguments for the Task 4 RPC and `revoke --override-id --reason`, prints only the safe override ID/scope/expiry, and never logs a password, session, anon key, or service-role key. Tests cover non-SW-000 denial, missing/mismatched scopes, server error mapping, and successful set/revoke.

```bash
node --test scripts/start-project-document-local-app.test.mjs scripts/seed-project-document-local-acceptance.test.mjs scripts/manage-project-document-quota-local.test.mjs
```

- [ ] **Step 4: Implement start/seed/quota helpers and run GREEN.** The seed output may print employee numbers and the fixed local-only acceptance password, but never session, anon, or service-role tokens.

```bash
node --test scripts/start-project-document-local-app.test.mjs scripts/seed-project-document-local-acceptance.test.mjs scripts/manage-project-document-quota-local.test.mjs
```

- [ ] **Step 5: Write the loopback-only E2E gate.** Read local URLs/keys from `npx supabase status -o json`; refuse non-loopback hosts; create a disposable auth user/canonical employee/project; reserve and ticket one standard file and one TUS file. Prove standard upload, TUS interruption/resume, stored cache-control `0`, and overwrite rejection. With the authenticated user token and matching local Origin, prove direct upload, known-path GET, update, and delete all fail; for list, accept either a safe 4xx or HTTP 200 with zero rows and no canary name/metadata because RLS may intentionally hide rows. After authenticated update/delete attempts, re-read the canary with service-role storage and assert object bytes, metadata, checksum, and version remain unchanged. This task does not finalize or activate either version and therefore does not depend on a verifier.

```json
{
  "scripts": {
    "test:storage:project-documents": "node scripts/project-document-storage-http.e2e.mjs",
    "seed:project-documents:local": "node scripts/seed-project-document-local-acceptance.mjs",
    "dev:project-documents:local": "node scripts/start-project-document-local-app.mjs",
    "manage:project-documents:quota:local": "node scripts/manage-project-document-quota-local.mjs"
  }
}
```

- [ ] **Step 6: Run the real gate.** Keep `npx supabase functions serve` running in a second terminal.

```bash
npx supabase start
npx supabase db reset
npx supabase status
```

Second terminal:

```bash
npx supabase functions serve --env-file supabase/functions/project-documents-local.env.example
```

Test terminal:

```bash
npm run test:storage:project-documents
```

- [ ] **Step 7: Commit only after standard, TUS, overwrite, all direct-denial assertions, and local harness tests pass.**

```bash
git add scripts/project-documents/storage-http-client.mjs scripts/project-documents/storage-http-client.test.mjs scripts/project-documents/local-supabase-env.mjs scripts/project-documents/local-supabase-env.test.mjs scripts/project-document-storage-http.e2e.mjs scripts/start-project-document-local-app.mjs scripts/start-project-document-local-app.test.mjs scripts/seed-project-document-local-acceptance.mjs scripts/seed-project-document-local-acceptance.test.mjs scripts/manage-project-document-quota-local.mjs scripts/manage-project-document-quota-local.test.mjs package.json package-lock.json
git commit -m "test: prove private project document uploads"
```

### Task 9: Build the bounded format inspector and resource benchmark

**Files:**
- Create: `scripts/project-documents/config.mjs`
- Create: `scripts/project-documents/verify-stream.mjs`
- Create: `scripts/project-documents/bounded-formats.mjs`
- Create: `scripts/project-documents/parser-child.mjs`
- Create: `scripts/project-documents/isolated-parser-runner.mjs`
- Create: `scripts/project-documents/parser.Containerfile`
- Create: `scripts/project-documents/.dockerignore`
- Create: `scripts/project-documents/config.test.mjs`
- Create: `scripts/project-documents/verify-stream.test.mjs`
- Create: `scripts/project-documents/bounded-formats.test.mjs`
- Create: `scripts/project-documents/parser-child.test.mjs`
- Create: `scripts/project-documents/isolated-parser-runner.test.mjs`
- Create: `scripts/project-documents/parser-build-context.test.mjs`
- Create: `scripts/project-documents/.dockerignore`
- Create: `scripts/benchmark-project-document-inspector.mjs`
- Create: `docs/project-document-worker-benchmark.md`

**Inspector limits:** 10,000 ZIP entries, 100 MiB declared per entry, 200 MiB declared total, no nested archive, no macro-enabled OOXML, bounded OLE sector chain/fan-out/cycle detection, bounded HEIC box count/depth/length, one 50 MiB input stream, a hard 128 MiB container memory+swap ceiling, and a 60-second deadline. A V8 heap flag alone is not an acceptable memory boundary.

- [ ] **Step 1: Write basic signature/stream tests RED.** Cover valid/truncated PDF/JPEG/PNG/WEBP, expected size/hash mismatch, 50 MiB streaming without whole-file buffering, mode-0600 temp files, and guaranteed unlink.

- [ ] **Step 2: Run RED.**

```bash
node --test scripts/project-documents/config.test.mjs scripts/project-documents/bounded-formats.test.mjs scripts/project-documents/verify-stream.test.mjs
```

- [ ] **Step 3: Implement only basic signatures and streaming; run GREEN.** Stream to a mode-0600 temporary file while hashing SHA-256/counting bytes, compare expected size/hash before parsing, and always unlink.

- [ ] **Step 4: Add ZIP/OOXML tests RED, then implement and run GREEN.** Generate DOCX/XLSX, macro-enabled packages, nested archives, ZIP bomb declarations, malformed central directories, more than 10,000 entries, 100 MiB single declarations, and 200 MiB total declarations. Read bounded metadata only; never extract entries.

```bash
node --test scripts/project-documents/bounded-formats.test.mjs
```

- [ ] **Step 5: Add OLE/HEIC tests RED, then implement and run GREEN.** Cover distinct DOC/XLS directory types, OLE sector cycles/fan-out, valid/invalid HEIC brands, excessive boxes/depth/length, truncation, and fixed fuzz regressions.

```bash
node --test scripts/project-documents/bounded-formats.test.mjs scripts/project-documents/parser-child.test.mjs
```

- [ ] **Step 6: Write isolation/context tests RED, then implement the hard boundary.** The runner invokes a resolved immutable local image ID (or an approved production `repo@sha256:<digest>`, never a mutable tag) with `--network none --read-only --memory=128m --memory-swap=128m --pids-limit=32 --cpus=1 --cap-drop=ALL --security-opt=no-new-privileges`, mounts only the temp input read-only, runs Node with a 64 MiB V8 heap, accepts one bounded JSON result, and force-removes the container after 60 seconds. It refuses to process a production job when the hard-limit runner is unavailable; there is no unbounded fallback. Build the image with the narrow context `scripts/project-documents`, whose `.dockerignore` allowlists only parser source/manifest files and excludes `.env*`, `.git`, `node_modules`, and the repository tree; tests inspect the context manifest and image layers. Tests cover timeout, OOM, malformed output, nonzero exit, cleanup, mutable-tag rejection, and production digest allowlisting.

```bash
node --test scripts/project-documents/isolated-parser-runner.test.mjs
docker build -f scripts/project-documents/parser.Containerfile -t shengwang-project-document-parser:local scripts/project-documents
docker image inspect --format '{{.Id}}' shengwang-project-document-parser:local
```

- [ ] **Step 7: Benchmark worst-case 50 MiB files under the hard limit.** Record CPU, wall time, peak cgroup memory, exit/OOM state, and rejection reason for every allowed family and malicious family in `docs/project-document-worker-benchmark.md`. A failing or marginless family blocks production enabling; it does not get bypassed.

```bash
node scripts/benchmark-project-document-inspector.mjs
node --test scripts/project-documents/*.test.mjs
```

The local tag is only a build convenience; the runner receives the inspected immutable image ID. Any production worker configuration using a tag instead of an approved digest must fail closed.

- [ ] **Step 8: Commit inspector and measured report.**

```bash
git add scripts/project-documents/config.mjs scripts/project-documents/verify-stream.mjs scripts/project-documents/bounded-formats.mjs scripts/project-documents/parser-child.mjs scripts/project-documents/isolated-parser-runner.mjs scripts/project-documents/parser.Containerfile scripts/project-documents/.dockerignore scripts/project-documents/*.test.mjs scripts/benchmark-project-document-inspector.mjs docs/project-document-worker-benchmark.md
git commit -m "feat: verify project document content safely"
```

### Task 10: Implement verifier, reaper, and cleanup runners

**Files:**
- Create: `scripts/project-documents/repository.mjs`
- Create: `scripts/project-documents/storage-http.mjs`
- Create: `scripts/project-document-verifier.mjs`
- Create: `scripts/project-document-reaper.mjs`
- Create: `scripts/project-document-cleanup.mjs`
- Create: `scripts/run-project-document-workers-local.mjs`
- Create: `scripts/project-document-active-access.e2e.mjs`
- Create: `scripts/project-documents/repository.test.mjs`
- Create: `scripts/project-documents/storage-http.test.mjs`
- Create: `scripts/project-document-verifier.test.mjs`
- Create: `scripts/project-document-reaper.test.mjs`
- Create: `scripts/project-document-cleanup.test.mjs`
- Create: `scripts/run-project-document-workers-local.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write repository/storage/verifier tests RED.** Cover empty queue, single claim, exact streaming object GET, 30-second lease renewal, size/hash/type/cache-control agreement, isolated parser result, successful activation, final authorization denial, each transient retry delay, deterministic failure to cleanup-pending, and safe logs.

- [ ] **Step 2: Run RED.**

```bash
node --test scripts/project-documents/repository.test.mjs scripts/project-documents/storage-http.test.mjs scripts/project-document-verifier.test.mjs
```

- [ ] **Step 3: Implement the verifier and run GREEN.** Use the service-role client only in Node. Preflight Docker, the immutable parser image, and the hard-limit runner before claiming; if infrastructure disappears after a claim (Docker/image/spawn/IPC failure), release/requeue under the normal retry/deadline and never delete the object. Download the exact object as a stream, renew the lease, invoke the hard-limit inspector, and finalize with verified size/hash/type. Stored cache-control must equal `0`. Only Storage/network timeout failures and infrastructure outages retry; a parser result that attributes timeout/OOM/malformed format to the inspected input, or a size/hash/type/cache/final-auth mismatch, moves to cleanup-pending with a safe code.

```bash
node --test scripts/project-documents/repository.test.mjs scripts/project-documents/storage-http.test.mjs scripts/project-document-verifier.test.mjs
```

- [ ] **Step 4: Write reaper tests RED, then implement and run GREEN.** Cover expired lease requeue, five-retry/two-hour exhaustion, never-claimed deadline, live lease untouched, and no object deletion.

```bash
node --test scripts/project-document-reaper.test.mjs
```

- [ ] **Step 5: Write cleanup tests RED before implementing cleanup.** For abandoned, deterministic-failure, auth-failure, and retry-exhausted rows, assert cleanup claim is denied before `cleanup_not_before` and allowed afterward. Cover new claim token replacement, exact object delete, ten-attempt alert retention, delete retry, active/void/queued/finalizing rejection, and an old verifier unable to activate after cleanup claim.

```bash
node --test scripts/project-document-cleanup.test.mjs
```

- [ ] **Step 6: Implement cleanup and run GREEN.** Promote eligible abandoned pending, claim only deadline-eligible cleanup-pending, delete the exact failed object, and close metadata/job as failed only after confirmed absence. A deletion failure releases the claim with the database schedule and never broadens target state.

```bash
node --test scripts/project-document-reaper.test.mjs scripts/project-document-cleanup.test.mjs
```

- [ ] **Step 7: Write the local coordinator test RED, implement, and run GREEN.** It refuses non-loopback status, runs verifier every second, reaper every 30 seconds, cleanup every 60 seconds, prevents overlapping cycles, handles signals, and never prints keys/tokens/paths. Add `workers:project-documents:local` and `test:access:project-documents` package scripts for the coordinator and active-access E2E.

```bash
node --test scripts/run-project-document-workers-local.test.mjs
```

- [ ] **Step 8: Run a real active-access E2E.** On the local stack, upload a valid small file, request finalize, execute the real verifier once through the hard-limit parser, poll active, request preview/download links, and verify 300-second expiry, forced attachment where required, `nosniff`, and zero-cache response behavior. It refuses non-loopback URLs and records no raw link/provider error in audit events. Keep local Edge Functions running with the tracked env file.

```bash
node scripts/project-document-active-access.e2e.mjs
```

- [ ] **Step 9: Run the whole runner suite GREEN and commit.**

```bash
node --test scripts/project-documents/*.test.mjs scripts/project-document-verifier.test.mjs scripts/project-document-reaper.test.mjs scripts/project-document-cleanup.test.mjs scripts/run-project-document-workers-local.test.mjs
git add scripts/project-documents/repository.mjs scripts/project-documents/repository.test.mjs scripts/project-documents/storage-http.mjs scripts/project-documents/storage-http.test.mjs scripts/project-document-verifier.mjs scripts/project-document-reaper.mjs scripts/project-document-cleanup.mjs scripts/project-document-verifier.test.mjs scripts/project-document-reaper.test.mjs scripts/project-document-cleanup.test.mjs scripts/run-project-document-workers-local.mjs scripts/run-project-document-workers-local.test.mjs scripts/project-document-active-access.e2e.mjs package.json package-lock.json
git commit -m "feat: process project document verification queue"
```

### Task 11: Implement the browser document service

**Files:**
- Create: `src/features/projects/projectDocumentService.js`
- Create: `src/features/projects/projectDocumentService.test.js`

- [ ] **Step 1: Write failing service tests.** Assert the exact factory/dependencies/singleton, safe method arguments and response validators, `listProjectDocuments` group-page cursor/limit RPC args, `listProjectDocumentHistory` cursor/limit and server-authoritative current fallback, paged incomplete/archive/alert projections, SHA-256 computed internally before reserve, standard signed upload at or below 6 MiB, TUS above it, standard and TUS cache-control `0`, `x-signature`, `x-upsert:false`, six MiB chunks, `storeFingerprintForResuming:false`, no `findPreviousUploads`, explicit `uploadUrl` resume, abort/progress, three-transfer cap, uniform not-found results for guessed document IDs, bounded `retryAfterSeconds` mapping for queue-full, safe error mapping, and no persistent storage calls.

- [ ] **Step 2: Run RED.**

```bash
node --test src/features/projects/projectDocumentService.test.js
```

- [ ] **Step 3: Implement the service.** Dynamically import `tus-js-client`. Use `client.functions.invoke` for ticket/access, public secure RPCs for metadata operations, and the exact injected boundaries in the Interface contract. A successful standard/TUS transfer returns `{ documentId, status: 'pending', resumeUrl: '' }` and does not change or guess database state; only the subsequent finalize RPC may return queued/finalizing/active. Never mark active in the browser. Merge pages only by opaque cursor, reject mismatched cursors/limits, and expose `retryAfterSeconds` only when the server returns a bounded queue-full hint.

- [ ] **Step 4: Run GREEN and build.**

```bash
node --test src/features/projects/projectDocumentService.test.js
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/features/projects/projectDocumentService.js src/features/projects/projectDocumentService.test.js
git commit -m "feat: upload project documents privately"
```

### Task 12: Build the project document panel

**Files:**
- Create: `src/features/projects/ProjectDocumentsPanel.jsx`
- Create: `src/features/projects/projectDocumentsPanelContract.test.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Write the failing component contract.** Assert exact three headings, sensitive groups absent when unauthorized, paged logical groups with a Load More action, server-authoritative `currentVersion` even when its history row is on a later page, history-page loading/merge, current/history/fallback display including safe cleanup/failed reasons, uploader/time/size/version, view/download/new-version/void actions, required void reason, file input allowlists, max-three queue, incomplete-upload summaries/abandon, progress, 1/2/4/8/10 polling, five-minute background message, auth-invalid callback, and the exact warning “文件未经病毒扫描，请确认来源后打开”. Assert Office actions always request `download`, no third-party preview URL exists, and HEIC/HEIF preview is shown only when an injected browser-capability check succeeds.

- [ ] **Step 2: Run RED.**

```bash
node --test src/features/projects/projectDocumentsPanelContract.test.js
```

- [ ] **Step 3: Implement mounted-memory behavior.** Use the pure reducer and service. Hash/reserve/ticket/upload/finalize each selected file independently. Keep group current summaries separate from paged history; never recompute fallback from the loaded slice. Closing/unmounting aborts requests, revokes object URLs, and drops resume URLs. Existing active versions stay visible on every failure. Preview/download requests are made only on click.

- [ ] **Step 4: Add only namespaced CSS.** Append `.project-document-*` rules at the end of `src/styles.css`; do not alter existing project/account selectors. Provide desktop and max-width 680px layouts, visible focus, progress semantics, and long-name wrapping.

- [ ] **Step 5: Run GREEN/build and commit.**

```bash
node --test src/features/projects/projectDocumentsPanelContract.test.js src/features/projects/projectDocumentUploadState.test.js
npm run build
git add src/features/projects/ProjectDocumentsPanel.jsx src/features/projects/projectDocumentsPanelContract.test.js src/styles.css
git commit -m "feat: add project document management panel"
```

### Task 13: Add SW-000 archive and minimally integrate ProjectPage

**Files:**
- Create: `src/features/projects/DeletedProjectArchive.jsx`
- Create: `src/features/projects/deletedProjectArchiveContract.test.js`
- Modify: `src/features/projects/ProjectPage.jsx`
- Modify: `src/features/projects/projectPageContract.test.js`
- Modify: `src/features/projects/projectAppIntegration.test.js`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Write failing archive/integration contracts.** Assert only SW-000 sees “已删除项目档案”; archive is read-only; it shows backup/full-inventory/restore-drill status and paged operational alerts from the server; archive project/document groups and per-logical history use Load More cursors; normal deleted projects cannot open; every saved active project card has one “文件管理” button; new-project form has no upload; only one panel mounts; deletion closes its panel; App passes only `onAuthInvalid={onLogout}` and owns no document rows/progress/URLs.

- [ ] **Step 2: Run RED.**

```bash
node --test src/features/projects/deletedProjectArchiveContract.test.js src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js
```

- [ ] **Step 3: Implement archive as a ProjectPage subview.** `DeletedProjectArchive` loads paged deleted-project groups, paged documents/history on demand, and the safe SW-000 operational-alert page; it requests preview/download only and exposes no upload/new-version/void/restore/alert-ack action.

- [ ] **Step 4: Patch ProjectPage anchors only.** Add `openDocumentProjectId` and `archiveOpen`; compute document UI permissions; add the header archive action and card file action; mount one panel after record actions; pass `onAuthInvalid`. Do not create a global route or App-level document state.

- [ ] **Step 5: Run GREEN/build and inspect the staged diff.**

```bash
node --test src/features/projects/deletedProjectArchiveContract.test.js src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js
npm run build
git diff -- src/App.jsx src/features/projects/ProjectPage.jsx src/styles.css
```

- [ ] **Step 6: Commit only integration files.**

```bash
git add src/features/projects/DeletedProjectArchive.jsx src/features/projects/deletedProjectArchiveContract.test.js src/features/projects/ProjectPage.jsx src/features/projects/projectPageContract.test.js src/features/projects/projectAppIntegration.test.js src/App.jsx src/styles.css
git commit -m "feat: connect project files and deleted archive"
```

### Task 14: Build independent S3/KMS backup and isolated restore

**Files:**
- Create: `scripts/backup-project-documents.mjs`
- Create: `scripts/inventory-project-documents.mjs`
- Create: `scripts/restore-project-documents.mjs`
- Create: `scripts/project-document-backup-roundtrip.mjs`
- Create: `scripts/project-document-backup/source-adapter.mjs`
- Create: `scripts/project-document-backup/s3-adapter.mjs`
- Create: `scripts/project-document-backup/kms-adapter.mjs`
- Create: `scripts/project-document-backup/manifest.mjs`
- Create: `scripts/project-document-backup/archive-schema.mjs`
- Create: `scripts/project-document-backup/config.mjs`
- Create: `scripts/project-document-backup/filesystem-test-adapter.mjs`
- Create: `scripts/project-document-backup/source-adapter.test.mjs`
- Create: `scripts/project-document-backup/s3-adapter.test.mjs`
- Create: `scripts/project-document-backup/kms-adapter.test.mjs`
- Create: `scripts/project-document-backup/manifest.test.mjs`
- Create: `scripts/project-document-backup/archive-schema.test.mjs`
- Create: `scripts/project-document-backup/filesystem-test-adapter.test.mjs`
- Create: `scripts/backup-project-documents.test.mjs`
- Create: `scripts/inventory-project-documents.test.mjs`
- Create: `scripts/restore-project-documents.test.mjs`
- Create: `scripts/project-document-backup-roundtrip.test.mjs`
- Create: `scripts/project-document-backup/config.test.mjs`
- Modify: `.env.example`
- Create: `docs/project-document-backup-and-restore.md`

- [ ] **Step 1: Write manifest/archive-schema tests RED, implement, then run GREEN.** Cover canonical JSON bytes, stable hashes, complete project/actor/logical/version/event schema, parent ordering, active/void object references, in-flight `recovery_interrupted`, and exclusion of verification jobs. `archive_schema_version` is the only schema authority recorded by the Task 6 cutoff; `archive-schema.mjs` maps that version to one canonical byte sequence, and restore rejects unknown versions rather than generating competing DDL from the database.

```bash
node --test scripts/project-document-backup/manifest.test.mjs scripts/project-document-backup/archive-schema.test.mjs
```

- [ ] **Step 2: Write S3/KMS/filesystem-adapter/config tests RED, implement, then run GREEN.** Cover content-addressed dedupe, encryption/versioning/Object-Lock requirements, exact target version IDs/ETags/SHA, canonical marker payloads larger than 4,096 bytes signed by SHA-256 digest with `MessageType=DIGEST`, version-specific readback, writer delete absence, separate restore credentials, partial run visibility, latest-object substitution rejection, rejection when `COMPLETED.json` names a key/algorithm outside the configured historical trust map, and rejection when the signing algorithm's digest is not `SHA_256`. The filesystem adapter is test-only and persists versioned objects under one temporary directory shared by backup and restore.

```bash
node --test scripts/project-document-backup/s3-adapter.test.mjs scripts/project-document-backup/kms-adapter.test.mjs scripts/project-document-backup/filesystem-test-adapter.test.mjs
```

- [ ] **Step 3: Write source/backup orchestration tests RED before implementation.** Cover cutoff freeze/fail, immutable content reuse, full self-contained run, marker written last, source completion only after readback, safe failure, and idempotent replay.

```bash
node --test scripts/project-document-backup/source-adapter.test.mjs scripts/backup-project-documents.test.mjs
```

- [ ] **Step 4: Implement backup and run GREEN.** Upload missing content under `objects/sha256/<two-hex>/<sha256>`, materialize the frozen `archive_schema_version` into its canonical schema bytes under the immutable run prefix, and consume every frozen source page with keyset continuation until `nextSortKey=null`. Build the signed marker payload from schema version, UTC cutoff, manifest SHA-256, count, bytes, and every data/schema/manifest object version ID; canonicalize it, hash it with SHA-256, validate the configured signing algorithm is one of the SHA-256-family KMS algorithms (`RSASSA_PSS_SHA_256` or `ECDSA_SHA_256`) and the digest setting is `SHA_256`, then call KMS `Sign` with `MessageType=DIGEST`, recording key ID, signing algorithm, and digest algorithm. The signed payload excludes `COMPLETED.json` itself. After PUT, capture `markerVersionId`, read exactly that version back, verify signature/manifest, and store the separate marker version ID in the source backup run.

```bash
node --test scripts/project-document-backup/source-adapter.test.mjs scripts/backup-project-documents.test.mjs
```

- [ ] **Step 5: Write full-inventory and restore tests RED, implement, then run GREEN.** Inventory follows every S3 continuation token and every marker/object-version page, checking every referenced target version/count/bytes/hash and recording a `full_inventory` recovery check. Restore enumerates all marker versions with continuation, first requires the marker key ID + signing algorithm + `digestAlgorithm=SHA_256` tuple to match a configured rotation-aware trust map (never trusts the marker to choose its own verifier), then calls KMS `Verify` through the separate restore identity, verifies the digest signature/manifest, imports parent/snapshot/version/event order, restores exact object versions, recomputes every SHA, rejects any mismatch, never replays jobs/public URLs, and records `restore_drill` only after a successful isolated restore. Pagination fixtures contain more than 1,000 source rows and object versions and assert exact counts/hashes after inventory and restore.

```bash
node --test scripts/inventory-project-documents.test.mjs scripts/restore-project-documents.test.mjs
```

- [ ] **Step 6: Add a single-process real roundtrip harness.** It creates one temporary versioned filesystem target, performs a non-dry-run backup, writes/reads a real marker version, runs full inventory, restores from the same target, verifies every relationship/hash, and checks all three status records. It removes the temporary directory afterward. Two unrelated memory processes are forbidden because they cannot prove a shared recovery point.

```bash
node --test scripts/project-document-backup-roundtrip.test.mjs
node scripts/project-document-backup-roundtrip.mjs
```

- [ ] **Step 7: Document exact server-only environment names and operational separation.** `.env.example` contains names only, no real values, using exactly `PROJECT_DOCUMENT_LOCAL_ONLY`, `PROJECT_DOCUMENT_SOURCE_SUPABASE_URL`, `PROJECT_DOCUMENT_SOURCE_SERVICE_ROLE_KEY`, `PROJECT_DOCUMENT_BACKUP_S3_ENDPOINT`, `PROJECT_DOCUMENT_BACKUP_S3_REGION`, `PROJECT_DOCUMENT_BACKUP_S3_BUCKET`, `PROJECT_DOCUMENT_BACKUP_S3_ACCESS_KEY_ID`, `PROJECT_DOCUMENT_BACKUP_S3_SECRET_ACCESS_KEY`, `PROJECT_DOCUMENT_BACKUP_KMS_REGION`, `PROJECT_DOCUMENT_BACKUP_KMS_KEY_ID`, `PROJECT_DOCUMENT_BACKUP_KMS_SIGNING_ALGORITHM`, `PROJECT_DOCUMENT_BACKUP_KMS_DIGEST_ALGORITHM`, `PROJECT_DOCUMENT_RESTORE_S3_ACCESS_KEY_ID`, `PROJECT_DOCUMENT_RESTORE_S3_SECRET_ACCESS_KEY`, `PROJECT_DOCUMENT_RESTORE_KMS_REGION`, `PROJECT_DOCUMENT_RESTORE_KMS_TRUST_MAP`, `PROJECT_DOCUMENT_RESTORE_KMS_VERIFY_ROLE_ARN`, and `PROJECT_DOCUMENT_PARSER_IMAGE_DIGEST`. The trust-map is a JSON array of `{ keyId, signingAlgorithm, digestAlgorithm: "SHA_256" }` entries; production uses KMS `Sign` with the writer identity and KMS `Verify` with the separate restore identity. Config tests reject missing region/trust-map/verify identity, missing writer/restore separation, a restore credential in the writer set, a mutable parser tag, a KMS tuple not in the trust map, a non-SHA-256 digest, or any production URL/credential when `PROJECT_DOCUMENT_LOCAL_ONLY=true`. The runbook covers an independent account/credential domain, encryption, versioning, no expiry lifecycle, Object Lock/delete protection, writer no-delete/no-retention-shortening policy, separate restore identity, daily incrementals, weekly inventory, quarterly isolated restore, alerts, and truthful UI status.

- [ ] **Step 8: Run all GREEN and commit.**

```bash
node --test scripts/project-document-backup/*.test.mjs scripts/backup-project-documents.test.mjs scripts/inventory-project-documents.test.mjs scripts/restore-project-documents.test.mjs scripts/project-document-backup-roundtrip.test.mjs
node scripts/project-document-backup-roundtrip.mjs
git add scripts/backup-project-documents.mjs scripts/backup-project-documents.test.mjs scripts/inventory-project-documents.mjs scripts/inventory-project-documents.test.mjs scripts/restore-project-documents.mjs scripts/restore-project-documents.test.mjs scripts/project-document-backup-roundtrip.mjs scripts/project-document-backup-roundtrip.test.mjs scripts/project-document-backup .env.example docs/project-document-backup-and-restore.md
git commit -m "feat: add restorable project document backups"
```

### Task 15: Full local verification and browser acceptance

**Files:**
- Modify only test/docs files needed to record real results.

- [ ] **Step 1: Run every focused suite fresh.**

```bash
node --test src/features/projects/*.test.js
node --test src/services/project*.test.js
node --test supabase/functions/project-document-upload-ticket/*.test.js supabase/functions/project-document-access/*.test.js
node --test scripts/project-documents/*.test.mjs scripts/project-document-*.test.mjs scripts/project-document-backup/*.test.mjs scripts/*project-document*.test.mjs
```

- [ ] **Step 2: Run database and real Storage HTTP gates.**

```bash
npx supabase start
npx supabase status
npx supabase db reset
npx supabase test db
```

Second terminal:

```bash
npx supabase functions serve --env-file supabase/functions/project-documents-local.env.example
```

Test terminal:

```bash
npm run test:storage:project-documents
npm run test:access:project-documents
```

- [ ] **Step 3: Run full regressions and production build.**

```bash
npm test
npm run build
```

- [ ] **Step 4: Scan for prohibited behavior.**

```bash
rg -n --glob '!*.test.*' --glob '!*.e2e.*' "getPublicUrl|upsert:\s*true|localStorage|sessionStorage|indexedDB|caches\." src/features/projects supabase/functions/project-document-* scripts/project-document* scripts/project-documents
rg -n "project_contract|rendering|contract_change_document" src supabase scripts
rg -n "bucket_id|object_path|processing_token|processing_lease_until" src/features/projects
```

Expected: no public URL/upsert/persistence use in document production code; all three exact categories are present; internal fields appear only in ticket handling or source-contract assertions, never ordinary list rendering.

- [ ] **Step 5: Start the isolated local browser fixture.** After the reset, seed all eight local-only accounts and `LOCAL-DOC-001`. Keep Edge Functions, the local worker coordinator, and Vite-local on three separate terminals. The Vite helper injects the CLI loopback URL/anon key and `VITE_LOCAL_DEMO_MODE=false` into that process only. It uses port 5174; leave the existing 5173 process and its non-loopback `.env.local` untouched and perform no write test there.

```bash
npm run seed:project-documents:local
```

Worker terminal:

```bash
npm run workers:project-documents:local
```

Local-app terminal:

```bash
npm run dev:project-documents:local
```

The helper must use Vite `--strictPort 5174`; a preflight failure for an occupied 5174 is an expected safe stop, not permission to fall back to another port. It injects both `VITE_SUPABASE_PUBLISHABLE_KEY` and `VITE_SUPABASE_ANON_KEY` from the loopback CLI result, plus `VITE_SUPABASE_URL` and `VITE_LOCAL_DEMO_MODE=false`, only into that process.

- [ ] **Step 6: Browser-test only `http://127.0.0.1:5174`.** Use SW-000, design, finance, president, ordinary updater, view-only employee, and disabled/departed accounts from the seed output. Verify small standard uploads for every type family; an interrupted/resumed TUS file above 6 MiB; rejection above 50 MiB; forged type; max-three transfers; immediate safe cleanup failure message; history/new version/void/fallback; exact virus warning; Office forced download/no third-party preview; HEIC preview only when supported; five-minute links; sensitive group absence; soft-delete denial; SW-000 read-only archive; and backup/inventory/restore status truthfulness.

- [ ] **Step 7: Record explicit evidence and limitations.** Report counts and command outputs for Node, pgTAP, standard/TUS/direct-denial HTTP, active-access headers, hard-memory parser benchmark, build, browser matrix, and filesystem-backed backup/inventory/restore roundtrip. If Docker, local Storage, a required account, or a sample is unavailable, label that item unverified and do not claim the whole feature complete.
- [ ] **Step 7: Record explicit evidence and limitations.** Rebuild the parser from the narrow context and rerun the isolated benchmark before recording evidence:

```bash
docker build -f scripts/project-documents/parser.Containerfile -t shengwang-project-document-parser:local scripts/project-documents
docker image inspect --format '{{.Id}}' shengwang-project-document-parser:local
node scripts/benchmark-project-document-inspector.mjs
```

Report counts and command outputs for Node, pgTAP, standard/TUS/direct-denial HTTP, active-access headers, hard-memory parser benchmark, build, browser matrix, and filesystem-backed backup/inventory/restore roundtrip. If Docker, local Storage, a required account, or a sample is unavailable, label that item unverified and do not claim the whole feature complete.

- [ ] **Step 8: Commit only verification corrections or documentation.**

```bash
git status --short
git diff --check
```

## Completion boundary

Local completion means all implementation files exist, focused/full tests and build pass, local PostgreSQL/Storage/active-access gates pass, hard-limit parser tests pass, browser role testing on the loopback-only 5174 instance passes, and filesystem-backed backup/inventory/restore verification passes. It does not mean production upload or disaster recovery is enabled.

Production enablement requires a new explicit approval covering: project-core legacy migration evidence and five-key purge; database migrations; private bucket; Edge functions; Node worker/reaper/cleanup hosting and schedules; capacity/queue alerts; independent S3-compatible target; KMS key; Object Lock/delete protection; writer/restore credentials; first complete backup; marker verification; and an isolated restore drill.

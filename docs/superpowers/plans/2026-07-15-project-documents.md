# Project Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private, permission-filtered contract, drawing, and client-legal document storage with immutable versions, resumable uploads, signed viewing/downloading, and void history to saved projects.

**Architecture:** PostgreSQL owns document identity, version allocation, audit identity, category authorization, and lifecycle state; a private Supabase Storage bucket accepts only paths backed by matching `pending` metadata. The browser validates files, reserves metadata through RPC, uses standard upload up to 6 MiB and TUS above 6 MiB, then finalizes metadata; React keeps file metadata and upload state in authenticated-session memory only. This plan is implemented after the core project plan and consumes its fixed financial whitelist, secure project service, permissions helper, and extracted `ProjectPage` without reimplementing them.

**Tech Stack:** React 19, Vite 6, Node `node:test`, Supabase JS 2.110+, PostgreSQL 15/RLS/pgTAP, Supabase Storage, `tus-js-client@4.3.1`

## Global Constraints

- Implement this plan only after the core project plan has landed and its tests pass.
- Consume `public.can_current_employee_view_project_financials()`, `isProjectFinancialWhitelistEmployee(currentUser)`, `canViewProjectFinancials(currentUser)`, `canUpdateProjectFinancials(currentUser)`, the secure project callbacks, and the extracted `ProjectPage`; do not create a second financial-identity rule or return to generic `projects` table access.
- `src/services/projectService.js` remains the sole project CRUD adapter; document calls belong only in `src/features/projects/projectDocumentService.js`.
- `ProjectPage` continues to receive exactly `projects`, `projectRevenueSnapshots`, `currentUser`, `employeeDirectory`, `directoryState`, `onRetryDirectory`, `onCreateProject`, `onUpdateProject`, `onDeleteProject`, `onOpenContractRevenue`, and `onBack`; this plan does not change that core interface.
- Bucket ID is exactly `erp-project-documents` and `public` is exactly `false`; no policy on any other bucket may be added, dropped, or broadened.
- Categories are exactly `contract`, `drawing`, and `legal`; drawing follows project-view permission, while contract/legal follow the fixed financial whitelist.
- Upload/void requires category visibility plus `module.projects.update`; listing/viewing/downloading requires `module.projects.view` plus category visibility.
- A file must be no larger than `50 MiB` (`52_428_800` bytes). Files larger than `6 MiB` (`6_291_456` bytes) use TUS; exactly 6 MiB uses standard upload.
- Use exactly `tus-js-client@4.3.1`, `6 * 1024 * 1024` TUS chunks, `x-upsert: false`, and one immutable path per reservation.
- Signed URL expiry is exactly `300` seconds. Never call `getPublicUrl`, store a signed URL, or render a permanent object URL.
- Object paths are exactly `<projectId>/<documentId>/<version>` and therefore contain no customer name, project name, original file name, or file extension.
- Contract/legal allow PDF, JPG/JPEG, PNG, WEBP, DOC/DOCX, and XLS/XLSX. Drawing additionally allows DWG, DXF, and ZIP. Both extension and declared MIME must match the fixed allowlist; empty/unknown MIME is rejected.
- Every upload or replacement creates a new immutable row. Never use Storage upsert, overwrite an object, update an older version, or physically delete an `active`/`void` historical object.
- Upload interruption preserves the same `pending` reservation so TUS can resume. Only a completed object whose metadata finalization failed triggers immediate Storage removal and lifecycle reconciliation to `void` or `cleanup_pending`.
- Project/document metadata and upload state stay in React memory for the authenticated session. Do not add localStorage/sessionStorage/IndexedDB writes.
- Do not touch or stage `supabase/functions/employee-bootstrap-admin/handler.js` or `supabase/functions/employee-bootstrap-admin/handler.test.js`; they contain pre-existing uncommitted work.
- Run `supabase db reset` and `supabase test db` when a local Supabase runtime is available. If it is unavailable, report pgTAP as unexecuted; static Node contracts are not a substitute for database integration.

---

## Core-plan interface checkpoint

Before Task 1, verify these exact prerequisites. If the core plan chose different names, update this document and its snippets in one documentation-only commit before implementing; do not add compatibility aliases silently.

```js
// src/features/projects/projectPermissions.js
export function isProjectFinancialWhitelistEmployee(currentUser = {}) {}
export function canViewProjectFinancials(currentUser = {}) {}
export function canUpdateProjectFinancials(currentUser = {}) {}

// src/services/projectService.js
export class ProjectServiceError extends Error {}
export function createProjectService(client, { configured } = {}) {
  return {
    listProjects: async () => [],
    createProject: async (project) => ({}),
    updateProject: async (projectId, patch) => ({}),
    softDeleteProject: async (projectId) => projectId,
  }
}
export const listProjects = async () => []
export const createProject = async (project) => ({})
export const updateProject = async (projectId, patch) => ({})
export const softDeleteProject = async (projectId) => projectId

// src/features/projects/ProjectPage.jsx
export function ProjectPage({
  projects,
  projectRevenueSnapshots,
  currentUser,
  employeeDirectory,
  directoryState,
  onRetryDirectory,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onOpenContractRevenue,
  onBack,
}) {}
```

The database prerequisite is:

```sql
public.can_current_employee_view_project_financials() returns boolean
```

It must already require a changed-password, active, employed, non-deleted canonical employee and return true only for `设计部`, `财务部`, `社长`, or employee number `SW-000`.

The document service contract added by this plan is exactly six methods:

```js
{
  listProjectDocuments(projectId),
  reserveProjectDocument({ projectId, category, logicalDocumentId, file, checksumSha256 }),
  uploadReservedDocument({ reservation, file, onProgress, signal }),
  completeProjectDocument(documentId),
  voidProjectDocument({ documentId, reason }),
  createProjectDocumentSignedUrl({ documentId, disposition }),
}
```

`reserveProjectDocument()` resolves to the RPC projection below. `uploadReservedDocument()` accepts that same object without deriving or changing any server identity/path field:

```js
{
  documentId: 'uuid',
  projectId: 'P001',
  category: 'contract',
  logicalDocumentId: 'uuid',
  version: 1,
  bucketId: 'erp-project-documents',
  objectPath: 'P001/uuid/1',
  originalFileName: '契約.pdf',
  contentType: 'application/pdf',
  sizeBytes: 1024,
  checksumSha256: null,
  status: 'pending',
  createdByEmployeeId: 'uuid',
  createdByEmployeeNumber: 'SW-001',
  createdByEmployeeName: '上传人',
  createdAt: '2026-07-15T00:00:00.000Z',
  completedAt: null,
  voidedByEmployeeId: null,
  voidedAt: null,
  voidReason: null,
}
```

After a TUS interruption only, the thrown safe error may carry a client-only copy `{ ...reservation, resumeUrl }`; `resumeUrl` comes from `upload.url`, is passed back as TUS `uploadUrl`, and lives only in the mounted panel. It is never sent to an RPC or persisted.

The panel production contract is exactly `{ projectId, canViewSensitiveDocuments, canUpdateProject }`. Its fourth destructured prop `service = projectDocumentService` exists only for direct component tests; production `ProjectPage` never supplies it. `ProjectPage` computes `canViewSensitiveDocuments={canViewProjectFinancials(currentUser)}` once, and the panel never receives `currentUser` or reimplements identity rules.

### Task 1: File validation and version view model

**Files:**
- Create: `src/features/projects/projectDocumentDomain.js`
- Test: `src/features/projects/projectDocumentDomain.test.js`

**Interfaces:**
- Consumes: browser `File`-like values with `{ name: string, type: string, size: number }`.
- Produces: `PROJECT_DOCUMENT_BUCKET`, `PROJECT_DOCUMENT_CATEGORIES`, `MAX_PROJECT_DOCUMENT_BYTES`, `TUS_THRESHOLD_BYTES`, `SIGNED_URL_TTL_SECONDS`, `ProjectDocumentValidationError`, `validateProjectDocumentFile({ category, file })`, and `buildProjectDocumentGroups(rows)`.

- [ ] **Step 1: Write the failing domain tests**

```js
// src/features/projects/projectDocumentDomain.test.js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_PROJECT_DOCUMENT_BYTES,
  SIGNED_URL_TTL_SECONDS,
  TUS_THRESHOLD_BYTES,
  buildProjectDocumentGroups,
  validateProjectDocumentFile,
} from './projectDocumentDomain.js'

const file = (name, type, size = 1024) => ({ name, type, size, lastModified: 1 })

test('fixed byte and signed-url limits do not drift', () => {
  assert.equal(MAX_PROJECT_DOCUMENT_BYTES, 50 * 1024 * 1024)
  assert.equal(TUS_THRESHOLD_BYTES, 6 * 1024 * 1024)
  assert.equal(SIGNED_URL_TTL_SECONDS, 300)
})

test('contract and legal accept only matching office/image MIME pairs', () => {
  for (const category of ['contract', 'legal']) {
    assert.equal(validateProjectDocumentFile({ category, file: file('a.PDF', 'application/pdf') }).extension, 'pdf')
    assert.equal(validateProjectDocumentFile({ category, file: file('a.jpeg', 'image/jpeg') }).extension, 'jpeg')
    assert.equal(validateProjectDocumentFile({ category, file: file('a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') }).extension, 'docx')
    assert.throws(
      () => validateProjectDocumentFile({ category, file: file('a.pdf', 'image/png') }),
      (error) => error.code === 'FILE_TYPE_MISMATCH',
    )
    assert.throws(
      () => validateProjectDocumentFile({ category, file: file('a.pdf', '') }),
      (error) => error.code === 'FILE_TYPE_MISMATCH',
    )
  }
})

test('drawing alone accepts matching CAD and ZIP MIME pairs', () => {
  assert.equal(validateProjectDocumentFile({ category: 'drawing', file: file('a.dwg', 'image/vnd.dwg') }).extension, 'dwg')
  assert.equal(validateProjectDocumentFile({ category: 'drawing', file: file('a.dxf', 'image/vnd.dxf') }).extension, 'dxf')
  assert.equal(validateProjectDocumentFile({ category: 'drawing', file: file('a.zip', 'application/zip') }).extension, 'zip')
  assert.throws(
    () => validateProjectDocumentFile({ category: 'contract', file: file('a.dwg', 'image/vnd.dwg') }),
    (error) => error.code === 'FILE_TYPE_MISMATCH',
  )
})

test('size boundary is inclusive and the TUS decision is strictly greater than 6 MiB', () => {
  assert.equal(validateProjectDocumentFile({ category: 'contract', file: file('a.pdf', 'application/pdf', MAX_PROJECT_DOCUMENT_BYTES) }).useTus, true)
  assert.equal(validateProjectDocumentFile({ category: 'contract', file: file('a.pdf', 'application/pdf', TUS_THRESHOLD_BYTES) }).useTus, false)
  assert.equal(validateProjectDocumentFile({ category: 'contract', file: file('a.pdf', 'application/pdf', TUS_THRESHOLD_BYTES + 1) }).useTus, true)
  assert.throws(
    () => validateProjectDocumentFile({ category: 'contract', file: file('a.pdf', 'application/pdf', MAX_PROJECT_DOCUMENT_BYTES + 1) }),
    (error) => error.code === 'FILE_TOO_LARGE',
  )
})

test('groups choose the greatest active version and keep older and void rows in history', () => {
  const groups = buildProjectDocumentGroups([
    { documentId: 'd3', logicalDocumentId: 'l1', category: 'contract', version: 3, status: 'void' },
    { documentId: 'd2', logicalDocumentId: 'l1', category: 'contract', version: 2, status: 'active' },
    { documentId: 'd1', logicalDocumentId: 'l1', category: 'contract', version: 1, status: 'active' },
    { documentId: 'd4', logicalDocumentId: 'l2', category: 'drawing', version: 1, status: 'active' },
  ])
  assert.equal(groups.contract[0].current.documentId, 'd2')
  assert.deepEqual(groups.contract[0].history.map(({ documentId }) => documentId), ['d3', 'd1'])
  assert.equal(groups.contract[0].latest.documentId, 'd3')
  assert.equal(groups.contract[0].fallbackMessage, '最新版本已作废，当前回退至 v2')
  assert.equal(groups.drawing[0].current.documentId, 'd4')
  assert.equal(groups.drawing[0].fallbackMessage, '')
  assert.deepEqual(groups.legal, [])
})
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test src/features/projects/projectDocumentDomain.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `projectDocumentDomain.js`.

- [ ] **Step 3: Implement the domain exactly once**

```js
// src/features/projects/projectDocumentDomain.js
export const PROJECT_DOCUMENT_BUCKET = 'erp-project-documents'
export const PROJECT_DOCUMENT_CATEGORIES = Object.freeze(['contract', 'drawing', 'legal'])
export const MAX_PROJECT_DOCUMENT_BYTES = 50 * 1024 * 1024
export const TUS_THRESHOLD_BYTES = 6 * 1024 * 1024
export const SIGNED_URL_TTL_SECONDS = 300

const MIME_BY_EXTENSION = Object.freeze({
  pdf: ['application/pdf'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  png: ['image/png'],
  webp: ['image/webp'],
  doc: ['application/msword'],
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls: ['application/vnd.ms-excel'],
  xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  dwg: ['image/vnd.dwg', 'application/acad', 'application/x-acad', 'application/dwg', 'application/x-dwg'],
  dxf: ['image/vnd.dxf', 'application/dxf', 'application/x-dxf'],
  zip: ['application/zip', 'application/x-zip-compressed'],
})

const BASE_EXTENSIONS = Object.freeze(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx', 'xls', 'xlsx'])
const EXTENSIONS_BY_CATEGORY = Object.freeze({
  contract: BASE_EXTENSIONS,
  legal: BASE_EXTENSIONS,
  drawing: Object.freeze([...BASE_EXTENSIONS, 'dwg', 'dxf', 'zip']),
})

export class ProjectDocumentValidationError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProjectDocumentValidationError'
    this.code = code
  }
}

export function validateProjectDocumentFile({ category, file }) {
  if (!PROJECT_DOCUMENT_CATEGORIES.includes(category)) {
    throw new ProjectDocumentValidationError('INVALID_CATEGORY', '不支持的文件分类')
  }
  if (!file || typeof file.name !== 'string' || !Number.isInteger(file.size) || file.size <= 0) {
    throw new ProjectDocumentValidationError('INVALID_FILE', '请选择有效文件')
  }
  if (file.size > MAX_PROJECT_DOCUMENT_BYTES) {
    throw new ProjectDocumentValidationError('FILE_TOO_LARGE', '单个文件不能超过 50 MiB')
  }
  const extension = file.name.includes('.') ? file.name.split('.').pop().toLowerCase() : ''
  const contentType = typeof file.type === 'string' ? file.type.trim().toLowerCase() : ''
  const allowedMimes = MIME_BY_EXTENSION[extension] ?? []
  if (!EXTENSIONS_BY_CATEGORY[category].includes(extension) || !allowedMimes.includes(contentType)) {
    throw new ProjectDocumentValidationError('FILE_TYPE_MISMATCH', '文件扩展名与 MIME 类型不匹配')
  }
  return { extension, contentType, useTus: file.size > TUS_THRESHOLD_BYTES }
}

export function buildProjectDocumentGroups(rows = []) {
  const grouped = { contract: new Map(), drawing: new Map(), legal: new Map() }
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!PROJECT_DOCUMENT_CATEGORIES.includes(row?.category) || !row.logicalDocumentId) continue
    const records = grouped[row.category].get(row.logicalDocumentId) ?? []
    records.push(row)
    grouped[row.category].set(row.logicalDocumentId, records)
  }
  return Object.fromEntries(PROJECT_DOCUMENT_CATEGORIES.map((category) => [
    category,
    [...grouped[category].entries()].map(([logicalDocumentId, records]) => {
      const ordered = [...records].sort((left, right) => right.version - left.version)
      const latest = ordered[0] ?? null
      const current = ordered.find(({ status }) => status === 'active') ?? null
      const fallbackMessage = latest?.status === 'void' && current
        ? `最新版本已作废，当前回退至 v${current.version}`
        : ''
      return {
        logicalDocumentId,
        latest,
        current,
        fallbackMessage,
        history: ordered.filter((row) => row !== current),
      }
    }).sort((left, right) => (right.current?.createdAt ?? '').localeCompare(left.current?.createdAt ?? '')),
  ]))
}
```

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test src/features/projects/projectDocumentDomain.test.js`

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit the domain slice**

```bash
git add src/features/projects/projectDocumentDomain.js src/features/projects/projectDocumentDomain.test.js
git commit -m "feat: validate project document files"
```

### Task 2: Private bucket, immutable metadata, secure RPCs, and Storage policies

**Files:**
- Create: `supabase/migrations/202607150002_project_documents.sql`
- Create: `src/services/projectDocumentSchema.test.js`
- Modify: `docs/supabase-schema.sql` (append the same idempotent schema/RPC/policy definitions after the core project-security section)
- Modify: `docs/supabase-schema.md` (document the private bucket, immutable version table, six browser RPC boundaries, three private Storage policy helpers, and cleanup-pending operations)

**Interfaces:**
- Consumes: `public.projects(record_key, status)`, `public.employee_profiles`, `public.has_current_permission(text)`, and `public.can_current_employee_view_project_financials()` from the core migration `202607150001_project_core_security.sql`.
- Produces: private bucket `erp-project-documents`; table `public.project_documents`; RPCs `list_project_documents_secure(text)`, `reserve_project_document_upload_secure(text,text,uuid,text,text,bigint,text)`, `complete_project_document_upload_secure(uuid)`, `reconcile_project_document_upload_failure_secure(uuid)`, `void_project_document_secure(uuid,text)`, and the internal service target RPC `project_document_signing_target_secure(uuid)`.

- [ ] **Step 1: Write a static security contract before the migration**

```js
// src/services/projectDocumentSchema.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const sql = readFileSync(new URL('../../supabase/migrations/202607150002_project_documents.sql', import.meta.url), 'utf8')

test('document migration creates one private 50 MiB bucket and immutable metadata', () => {
  assert.match(sql, /'erp-project-documents'[\s\S]*false[\s\S]*52428800/i)
  assert.match(sql, /create table public\.project_documents/i)
  assert.match(sql, /unique \(logical_document_id, version\)/i)
  assert.match(sql, /object_path text not null unique/i)
  assert.match(sql, /status in \('pending', 'active', 'void', 'cleanup_pending'\)/i)
  assert.doesNotMatch(sql, /update[\s\S]{0,160}object_path\s*=/i)
})

test('all document operations are RPC-only and use the fixed whitelist', () => {
  for (const name of ['list_project_documents_secure', 'reserve_project_document_upload_secure', 'complete_project_document_upload_secure', 'reconcile_project_document_upload_failure_secure', 'void_project_document_secure', 'project_document_signing_target_secure']) {
    assert.match(sql, new RegExp(`create or replace function public\\.${name}`))
    assert.match(sql, new RegExp(`grant execute on function public\\.${name}`))
  }
  assert.match(sql, /public\.can_current_employee_view_project_financials\(\)/i)
  assert.match(sql, /public\.has_current_permission\('module\.projects\.view'\)/i)
  assert.match(sql, /public\.has_current_permission\('module\.projects\.update'\)/i)
  assert.match(sql, /revoke all on table public\.project_documents from public, anon, authenticated/i)
})

test('storage policies are bucket-scoped, insert-only for upload, and never permit active deletion', () => {
  const policySql = sql.slice(sql.indexOf('drop policy if exists project_documents_select'))
  assert.match(sql, /on storage\.objects for select to authenticated/i)
  assert.match(sql, /on storage\.objects for insert to authenticated/i)
  assert.match(sql, /on storage\.objects for delete to authenticated/i)
  assert.match(sql, /bucket_id = 'erp-project-documents'/i)
  assert.match(sql, /document\.status in \('pending', 'cleanup_pending'\)/i)
  assert.doesNotMatch(sql, /on storage\.objects for update/i)
  assert.doesNotMatch(sql, /bucket_id\s*<>|bucket_id\s+is\s+distinct/i)
  assert.ok((sql.match(/project\.status\s*<>\s*'deleted'/gi) ?? []).length >= 6)
  for (const helper of [
    'project_document_storage_select_allowed',
    'project_document_storage_upload_allowed',
    'project_document_storage_delete_allowed',
  ]) {
    assert.match(sql, new RegExp(`create or replace function private\\.${helper}\\(\\s*p_bucket_id text,\\s*p_object_path text\\s*\\)[\\s\\S]*?security definer[\\s\\S]*?set search_path = pg_catalog, public, private`, 'i'))
    assert.match(sql, new RegExp(`revoke all on function private\\.${helper}\\(text,text\\) from public, anon, authenticated, service_role`, 'i'))
    assert.match(sql, new RegExp(`grant execute on function private\\.${helper}\\(text,text\\) to authenticated`, 'i'))
    assert.doesNotMatch(sql, new RegExp(`grant execute on function private\\.${helper}\\(text,text\\) to anon`, 'i'))
  }
  assert.match(policySql, /private\.project_document_storage_select_allowed\(bucket_id, name\)/i)
  assert.match(policySql, /private\.project_document_storage_upload_allowed\(bucket_id, name\)/i)
  assert.match(policySql, /private\.project_document_storage_delete_allowed\(bucket_id, name\)/i)
  assert.doesNotMatch(policySql, /exists\s*\([\s\S]*public\.project_documents/i)
  assert.doesNotMatch(sql, /grant\s+(select|all)[\s\S]{0,80}public\.project_documents[\s\S]{0,80}authenticated/i)
})

test('server validates category, extension, MIME, size, object existence, and exact path', () => {
  assert.match(sql, /52428800/)
  assert.match(sql, /application\/pdf/i)
  assert.match(sql, /image\/vnd\.dwg/i)
  assert.match(sql, /object_path := p_project_id \|\| '\/' \|\| document_id::text \|\| '\/' \|\| next_version::text/i)
  assert.match(sql, /storage\.objects/i)
  assert.match(sql, /metadata->>'size'/i)
  assert.match(sql, /metadata->>'mimetype'/i)
})
```

- [ ] **Step 2: Run the contract and confirm RED**

Run: `node --test src/services/projectDocumentSchema.test.js`

Expected: FAIL with `ENOENT` for `202607150002_project_documents.sql`.

- [ ] **Step 3: Add the metadata schema, private helpers, and private bucket**

Start the migration with the following concrete definitions; copy the same definitions to `docs/supabase-schema.sql` after they pass locally.

```sql
create table public.project_documents (
  document_id uuid primary key default gen_random_uuid(),
  project_id text not null,
  category text not null check (category in ('contract', 'drawing', 'legal')),
  logical_document_id uuid not null,
  version integer not null check (version > 0),
  bucket_id text not null check (bucket_id = 'erp-project-documents'),
  object_path text not null unique,
  original_file_name text not null check (btrim(original_file_name) <> ''),
  content_type text not null check (btrim(content_type) <> ''),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'active', 'void', 'cleanup_pending')),
  created_by_employee_id uuid not null references public.employee_profiles(id),
  created_by_employee_number text not null,
  created_by_employee_name text not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  voided_by_employee_id uuid references public.employee_profiles(id),
  voided_at timestamptz,
  void_reason text,
  unique (logical_document_id, version)
);

create index project_documents_project_category_idx
  on public.project_documents (project_id, category, logical_document_id, version desc);
create index project_documents_cleanup_idx
  on public.project_documents (status, created_at)
  where status = 'cleanup_pending';

alter table public.project_documents enable row level security;
revoke all on table public.project_documents from public, anon, authenticated;
grant all on table public.project_documents to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'erp-project-documents',
  'erp-project-documents',
  false,
  52428800,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/vnd.dwg', 'application/acad', 'application/x-acad', 'application/dwg', 'application/x-dwg',
    'image/vnd.dxf', 'application/dxf', 'application/x-dxf',
    'application/zip', 'application/x-zip-compressed'
  ]::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function private.current_project_document_employee()
returns public.employee_profiles
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare actor public.employee_profiles%rowtype;
begin
  select profile.* into actor
  from public.employee_profiles profile
  where profile.auth_user_id = auth.uid()
    and profile.employment_status = '在职'
    and profile.account_status = 'active'
    and profile.must_change_password = false
    and profile.deleted_at is null;
  if not found then raise exception using errcode = '42501', message = 'active employee required'; end if;
  return actor;
end;
$$;

create or replace function private.can_access_project_document_category(p_category text, p_write boolean)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select p_category in ('contract', 'drawing', 'legal')
    and public.has_current_permission('module.projects.view')
    and (not p_write or public.has_current_permission('module.projects.update'))
    and (p_category = 'drawing' or public.can_current_employee_view_project_financials());
$$;

create or replace function private.project_document_file_is_valid(p_category text, p_name text, p_type text, p_size bigint)
returns boolean
language plpgsql immutable
set search_path = pg_catalog
as $$
declare extension text := lower(substring(p_name from '\.([^.]*)$'));
begin
  if p_size not between 1 and 52428800 then return false; end if;
  if p_category not in ('contract', 'drawing', 'legal') then return false; end if;
  if (extension, lower(p_type)) in (
    ('pdf','application/pdf'), ('jpg','image/jpeg'), ('jpeg','image/jpeg'),
    ('png','image/png'), ('webp','image/webp'), ('doc','application/msword'),
    ('docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    ('xls','application/vnd.ms-excel'),
    ('xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ) then return true; end if;
  return p_category = 'drawing' and (extension, lower(p_type)) in (
    ('dwg','image/vnd.dwg'), ('dwg','application/acad'), ('dwg','application/x-acad'),
    ('dwg','application/dwg'), ('dwg','application/x-dwg'),
    ('dxf','image/vnd.dxf'), ('dxf','application/dxf'), ('dxf','application/x-dxf'),
    ('zip','application/zip'), ('zip','application/x-zip-compressed')
  );
end;
$$;

create or replace function private.project_document_json(document public.project_documents)
returns jsonb
language sql stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'documentId', document.document_id,
    'projectId', document.project_id,
    'category', document.category,
    'logicalDocumentId', document.logical_document_id,
    'version', document.version,
    'bucketId', document.bucket_id,
    'objectPath', document.object_path,
    'originalFileName', document.original_file_name,
    'contentType', document.content_type,
    'sizeBytes', document.size_bytes,
    'checksumSha256', document.checksum_sha256,
    'status', document.status,
    'createdByEmployeeId', document.created_by_employee_id,
    'createdByEmployeeNumber', document.created_by_employee_number,
    'createdByEmployeeName', document.created_by_employee_name,
    'createdAt', document.created_at,
    'completedAt', document.completed_at,
    'voidedByEmployeeId', document.voided_by_employee_id,
    'voidedAt', document.voided_at,
    'voidReason', document.void_reason
  );
$$;

create or replace function private.project_document_storage_select_allowed(
  p_bucket_id text,
  p_object_path text
)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private
as $$
  select p_bucket_id = 'erp-project-documents' and exists (
    select 1
    from public.project_documents document
    where document.bucket_id = p_bucket_id
      and document.object_path = p_object_path
      and document.status in ('active', 'void')
      and exists (
        select 1 from public.projects project
        where project.record_key = document.project_id and project.status <> 'deleted'
      )
      and private.can_access_project_document_category(document.category, false)
  );
$$;

create or replace function private.project_document_storage_upload_allowed(
  p_bucket_id text,
  p_object_path text
)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private
as $$
  select p_bucket_id = 'erp-project-documents' and exists (
    select 1
    from public.project_documents document
    join public.employee_profiles creator
      on creator.id = document.created_by_employee_id
    where document.bucket_id = p_bucket_id
      and document.object_path = p_object_path
      and document.status = 'pending'
      and creator.auth_user_id = auth.uid()
      and exists (
        select 1 from public.projects project
        where project.record_key = document.project_id and project.status <> 'deleted'
      )
      and private.can_access_project_document_category(document.category, true)
  );
$$;

create or replace function private.project_document_storage_delete_allowed(
  p_bucket_id text,
  p_object_path text
)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public, private
as $$
  select p_bucket_id = 'erp-project-documents' and exists (
    select 1
    from public.project_documents document
    join public.employee_profiles creator
      on creator.id = document.created_by_employee_id
    where document.bucket_id = p_bucket_id
      and document.object_path = p_object_path
      and document.status in ('pending', 'cleanup_pending')
      and creator.auth_user_id = auth.uid()
      and exists (
        select 1 from public.projects project
        where project.record_key = document.project_id and project.status <> 'deleted'
      )
      and public.is_current_employee_active()
  );
$$;
```

- [ ] **Step 4: Add the lifecycle and signing-target RPCs**

Use the exact signatures below. Each function is `security definer`, has a fixed `search_path`, calls `private.current_project_document_employee()`, and rejects with SQLSTATE `42501` before revealing whether a project/document exists.

```sql
create or replace function public.list_project_documents_secure(p_project_id text)
returns setof jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $$
declare document public.project_documents%rowtype;
begin
  perform private.current_project_document_employee();
  if not public.has_current_permission('module.projects.view') then
    raise exception using errcode = '42501', message = 'project view permission required';
  end if;
  if not exists (select 1 from public.projects where record_key = p_project_id and status <> 'deleted') then return; end if;
  for document in
    select d.* from public.project_documents d
    where d.project_id = p_project_id
      and d.status in ('active', 'void')
      and private.can_access_project_document_category(d.category, false)
    order by d.category, d.logical_document_id, d.version desc
  loop return next private.project_document_json(document); end loop;
end;
$$;

create or replace function public.reserve_project_document_upload_secure(
  p_project_id text,
  p_category text,
  p_logical_document_id uuid,
  p_original_file_name text,
  p_content_type text,
  p_size_bytes bigint,
  p_checksum_sha256 text default null
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare
  actor public.employee_profiles%rowtype;
  document public.project_documents%rowtype;
  target_logical_id uuid := coalesce(p_logical_document_id, gen_random_uuid());
  next_version integer;
begin
  actor := private.current_project_document_employee();
  if not private.can_access_project_document_category(p_category, true) then
    raise exception using errcode = '42501', message = 'project document update permission required';
  end if;
  if p_project_id !~ '^[A-Za-z0-9_-]{1,128}$'
    or not exists (select 1 from public.projects where record_key = p_project_id and status <> 'deleted')
  then raise exception using errcode = '22023', message = 'invalid project'; end if;
  if not private.project_document_file_is_valid(p_category, p_original_file_name, p_content_type, p_size_bytes)
    or (p_checksum_sha256 is not null and p_checksum_sha256 !~ '^[0-9a-f]{64}$')
  then raise exception using errcode = '22023', message = 'invalid project document'; end if;
  if p_logical_document_id is not null and not exists (
    select 1 from public.project_documents d
    where d.logical_document_id = p_logical_document_id
      and d.project_id = p_project_id and d.category = p_category
  ) then raise exception using errcode = '22023', message = 'invalid logical document'; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_logical_id::text, 0));
  select coalesce(max(d.version), 0) + 1 into next_version
  from public.project_documents d where d.logical_document_id = target_logical_id;

  document.document_id := gen_random_uuid();
  document.project_id := p_project_id;
  document.category := p_category;
  document.logical_document_id := target_logical_id;
  document.version := next_version;
  document.bucket_id := 'erp-project-documents';
  document.object_path := p_project_id || '/' || document.document_id::text || '/' || next_version::text;
  document.original_file_name := p_original_file_name;
  document.content_type := lower(p_content_type);
  document.size_bytes := p_size_bytes;
  document.checksum_sha256 := p_checksum_sha256;
  document.status := 'pending';
  document.created_by_employee_id := actor.id;
  document.created_by_employee_number := actor.employee_number;
  document.created_by_employee_name := actor.name;
  insert into public.project_documents (
    document_id, project_id, category, logical_document_id, version,
    bucket_id, object_path, original_file_name, content_type, size_bytes,
    checksum_sha256, status, created_by_employee_id,
    created_by_employee_number, created_by_employee_name
  ) values (
    document.document_id, document.project_id, document.category,
    document.logical_document_id, document.version, document.bucket_id,
    document.object_path, document.original_file_name, document.content_type,
    document.size_bytes, document.checksum_sha256, document.status,
    document.created_by_employee_id, document.created_by_employee_number,
    document.created_by_employee_name
  ) returning * into document;
  return private.project_document_json(document);
end;
$$;

create or replace function public.complete_project_document_upload_secure(p_document_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private, storage
as $$
declare actor public.employee_profiles%rowtype; document public.project_documents%rowtype; object_row storage.objects%rowtype;
begin
  actor := private.current_project_document_employee();
  select * into document from public.project_documents where document_id = p_document_id for update;
  if not found or document.created_by_employee_id <> actor.id
    or not private.can_access_project_document_category(document.category, true)
    or not exists (
      select 1 from public.projects project
      where project.record_key = document.project_id and project.status <> 'deleted'
    )
  then raise exception using errcode = '42501', message = 'project document update permission required'; end if;
  if document.status = 'active' then return private.project_document_json(document); end if;
  if document.status <> 'pending' then raise exception using errcode = '22023', message = 'document is not pending'; end if;
  select * into object_row from storage.objects
  where bucket_id = document.bucket_id and name = document.object_path;
  if not found
    or coalesce((object_row.metadata->>'size')::bigint, -1) <> document.size_bytes
    or lower(coalesce(object_row.metadata->>'mimetype', '')) <> document.content_type
  then raise exception using errcode = '22023', message = 'uploaded object does not match reservation'; end if;
  update public.project_documents set status = 'active', completed_at = now()
  where document_id = p_document_id returning * into document;
  return private.project_document_json(document);
end;
$$;

create or replace function public.reconcile_project_document_upload_failure_secure(p_document_id uuid)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private, storage
as $$
declare actor public.employee_profiles%rowtype; document public.project_documents%rowtype; object_exists boolean;
begin
  actor := private.current_project_document_employee();
  select * into document from public.project_documents where document_id = p_document_id for update;
  if not found or document.created_by_employee_id <> actor.id
    or not exists (
      select 1 from public.projects project
      where project.record_key = document.project_id and project.status <> 'deleted'
    )
  then raise exception using errcode = '42501', message = 'project document update permission required'; end if;
  if document.status = 'active' then return private.project_document_json(document); end if;
  if document.status not in ('pending', 'cleanup_pending') then return private.project_document_json(document); end if;
  select exists(select 1 from storage.objects o where o.bucket_id = document.bucket_id and o.name = document.object_path)
    into object_exists;
  update public.project_documents set
    status = case when object_exists then 'cleanup_pending' else 'void' end,
    voided_by_employee_id = case when object_exists then null else actor.id end,
    voided_at = case when object_exists then null else now() end,
    void_reason = case when object_exists then null else 'upload_compensation' end
  where document_id = p_document_id returning * into document;
  return private.project_document_json(document);
end;
$$;

create or replace function public.void_project_document_secure(p_document_id uuid, p_void_reason text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, private
as $$
declare actor public.employee_profiles%rowtype; document public.project_documents%rowtype;
begin
  actor := private.current_project_document_employee();
  select * into document from public.project_documents where document_id = p_document_id for update;
  if not found or not private.can_access_project_document_category(document.category, true)
    or not exists (
      select 1 from public.projects project
      where project.record_key = document.project_id and project.status <> 'deleted'
    )
  then raise exception using errcode = '42501', message = 'project document update permission required'; end if;
  if document.status <> 'active' or btrim(coalesce(p_void_reason, '')) = '' or length(btrim(p_void_reason)) > 500
  then raise exception using errcode = '22023', message = 'invalid void request'; end if;
  update public.project_documents set
    status = 'void', voided_by_employee_id = actor.id, voided_at = now(), void_reason = btrim(p_void_reason)
  where document_id = p_document_id returning * into document;
  return private.project_document_json(document);
end;
$$;

create or replace function public.project_document_signing_target_secure(p_document_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public, private
as $$
declare document public.project_documents%rowtype;
begin
  perform private.current_project_document_employee();
  select * into document
  from public.project_documents
  where document_id = p_document_id and status in ('active', 'void');
  if not found
    or not private.can_access_project_document_category(document.category, false)
    or not exists (
      select 1 from public.projects project
      where project.record_key = document.project_id and project.status <> 'deleted'
    )
  then raise exception using errcode = '42501', message = 'project document view permission required'; end if;
  return jsonb_build_object(
    'bucketId', document.bucket_id,
    'objectPath', document.object_path,
    'originalFileName', document.original_file_name
  );
end;
$$;
```

- [ ] **Step 5: Lock function grants and add bucket-scoped Storage policies**

```sql
revoke all on function private.current_project_document_employee() from public, anon, authenticated;
revoke all on function private.can_access_project_document_category(text, boolean) from public, anon, authenticated;
revoke all on function private.project_document_file_is_valid(text, text, text, bigint) from public, anon, authenticated;
revoke all on function private.project_document_json(public.project_documents) from public, anon, authenticated;
revoke usage on schema private from public, anon, authenticated;
revoke all on function private.project_document_storage_select_allowed(text,text) from public, anon, authenticated, service_role;
revoke all on function private.project_document_storage_upload_allowed(text,text) from public, anon, authenticated, service_role;
revoke all on function private.project_document_storage_delete_allowed(text,text) from public, anon, authenticated, service_role;
grant execute on function private.project_document_storage_select_allowed(text,text) to authenticated;
grant execute on function private.project_document_storage_upload_allowed(text,text) to authenticated;
grant execute on function private.project_document_storage_delete_allowed(text,text) to authenticated;

revoke all on function public.list_project_documents_secure(text) from public, anon;
revoke all on function public.reserve_project_document_upload_secure(text,text,uuid,text,text,bigint,text) from public, anon;
revoke all on function public.complete_project_document_upload_secure(uuid) from public, anon;
revoke all on function public.reconcile_project_document_upload_failure_secure(uuid) from public, anon;
revoke all on function public.void_project_document_secure(uuid,text) from public, anon;
revoke all on function public.project_document_signing_target_secure(uuid) from public, anon;
grant execute on function public.list_project_documents_secure(text) to authenticated, service_role;
grant execute on function public.reserve_project_document_upload_secure(text,text,uuid,text,text,bigint,text) to authenticated, service_role;
grant execute on function public.complete_project_document_upload_secure(uuid) to authenticated, service_role;
grant execute on function public.reconcile_project_document_upload_failure_secure(uuid) to authenticated, service_role;
grant execute on function public.void_project_document_secure(uuid,text) to authenticated, service_role;
grant execute on function public.project_document_signing_target_secure(uuid) to authenticated, service_role;

drop policy if exists project_documents_select on storage.objects;
create policy project_documents_select on storage.objects for select to authenticated using (
  private.project_document_storage_select_allowed(bucket_id, name)
);

drop policy if exists project_documents_insert on storage.objects;
create policy project_documents_insert on storage.objects for insert to authenticated with check (
  private.project_document_storage_upload_allowed(bucket_id, name)
);

drop policy if exists project_documents_delete_pending on storage.objects;
create policy project_documents_delete_pending on storage.objects for delete to authenticated using (
  private.project_document_storage_delete_allowed(bucket_id, name)
);
```

The three `authenticated` EXECUTE grants exist solely because PostgreSQL evaluates each already-resolved policy expression as the requesting role. `authenticated` still has no `USAGE` on `private`, cannot resolve/call these helpers directly through the exposed API schemas, and receives no `SELECT` privilege on `public.project_documents`; `service_role` bypasses Storage RLS and needs no helper grant.

- [ ] **Step 6: Run the static contract and migrate a fresh local database**

Run: `node --test src/services/projectDocumentSchema.test.js`

Expected: PASS, 4 tests.

Run: `supabase db reset`

Expected: exit 0; migrations `202607150001` then `202607150002` apply without SQL errors and bucket `erp-project-documents` is private.

Update `docs/supabase-schema.md` with the exact table/status/category names, 50 MiB limit, 300-second signed URL rule, and the rule that `cleanup_pending` objects are removed only through a controlled service-role cleanup run; do not document any public URL or browser table access.

- [ ] **Step 7: Commit the database slice**

```bash
git add supabase/migrations/202607150002_project_documents.sql src/services/projectDocumentSchema.test.js docs/supabase-schema.sql docs/supabase-schema.md
git commit -m "feat: secure project document storage"
```

### Task 3: Executable pgTAP authorization and lifecycle matrix

**Files:**
- Create: `supabase/tests/project_documents.sql`
- Modify: `src/services/projectDocumentSchema.test.js`

**Interfaces:**
- Consumes: the six document RPCs, three private Storage policy helpers, and three Storage policies from Task 2.
- Produces: executable proof that drawing differs from contract/legal, writes need update, active history cannot be deleted, version numbers are unique, and other buckets remain unchanged.

- [ ] **Step 1: Extend the Node contract so pgTAP cannot be omitted**

```js
// append to src/services/projectDocumentSchema.test.js
test('pgTAP covers every category and lifecycle state', () => {
  const pgTap = readFileSync(new URL('../../supabase/tests/project_documents.sql', import.meta.url), 'utf8')
  for (const phrase of [
    'drawing viewer sees drawing metadata',
    'drawing viewer does not receive contract metadata',
    'financial viewer receives contract and legal metadata',
    'view-only financial user cannot reserve a version',
    'version allocation is monotonic',
    'completion rejects a mismatched object',
    'active objects cannot be physically deleted',
    'other bucket policy is unchanged',
    'direct metadata table access remains denied',
    'storage select policy works without metadata table access',
    'storage upload policy works without metadata table access',
    'storage delete policy works without metadata table access',
    'anon cannot execute storage policy helpers',
  ]) assert.match(pgTap, new RegExp(phrase, 'i'))
})
```

- [ ] **Step 2: Run the contract and confirm RED**

Run: `node --test src/services/projectDocumentSchema.test.js`

Expected: FAIL with `ENOENT` for `supabase/tests/project_documents.sql`.

- [ ] **Step 3: Write the pgTAP test with fixed actors and assertions**

The file uses deterministic UUIDs, inserts canonical employee profiles as the migration owner, grants `module.projects.view/update` through `permission_grants`, and switches `request.jwt.claim.sub` before each authorization assertion:

```sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, auth, storage, extensions;
select plan(22);

insert into storage.buckets(id,name,public) values ('fixture-other-bucket','fixture-other-bucket',false);
create policy fixture_other_bucket_select on storage.objects for select using (bucket_id = 'fixture-other-bucket');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000001','authenticated','authenticated','drawing@invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000002','authenticated','authenticated','design@invalid','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','81000000-0000-4000-8000-000000000003','authenticated','authenticated','finance-view@invalid','',now(),'{}','{}',now(),now());

insert into public.employee_profiles (id,employee_number,auth_user_id,name,department,position,employment_status,account_status,must_change_password,is_hidden_system_account) values
('82000000-0000-4000-8000-000000000001','SW-8101','81000000-0000-4000-8000-000000000001','图纸员工','工程部','大工','在职','active',false,false),
('82000000-0000-4000-8000-000000000002','SW-8102','81000000-0000-4000-8000-000000000002','设计员工','设计部','设计师','在职','active',false,false),
('82000000-0000-4000-8000-000000000003','SW-8103','81000000-0000-4000-8000-000000000003','财务只读','财务部','会计','在职','active',false,false);

insert into public.permission_grants(subject_type,subject_code,permission_key) values
('department','工程部','module.projects.view'),('department','工程部','module.projects.update'),
('department','设计部','module.projects.view'),('department','设计部','module.projects.update'),
('department','财务部','module.projects.view');
insert into public.projects(record_key,payload,status) values ('P-DOC-1','{"projectId":"P-DOC-1"}','active');

insert into public.project_documents(document_id,project_id,category,logical_document_id,version,bucket_id,object_path,original_file_name,content_type,size_bytes,status,created_by_employee_id,created_by_employee_number,created_by_employee_name,completed_at) values
('83000000-0000-4000-8000-000000000001','P-DOC-1','drawing','84000000-0000-4000-8000-000000000001',1,'erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000001/1','plan.pdf','application/pdf',10,'active','82000000-0000-4000-8000-000000000001','SW-8101','图纸员工',now()),
('83000000-0000-4000-8000-000000000002','P-DOC-1','contract','84000000-0000-4000-8000-000000000002',1,'erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000002/1','contract.pdf','application/pdf',10,'active','82000000-0000-4000-8000-000000000002','SW-8102','设计员工',now()),
('83000000-0000-4000-8000-000000000003','P-DOC-1','legal','84000000-0000-4000-8000-000000000003',1,'erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000003/1','legal.pdf','application/pdf',10,'active','82000000-0000-4000-8000-000000000002','SW-8102','设计员工',now()),
('83000000-0000-4000-8000-000000000004','P-DOC-1','contract','84000000-0000-4000-8000-000000000004',1,'erp-project-documents','P-DOC-1/mismatch/1','mismatch.pdf','application/pdf',10,'pending','82000000-0000-4000-8000-000000000002','SW-8102','设计员工',null),
('83000000-0000-4000-8000-000000000005','P-DOC-1','drawing','84000000-0000-4000-8000-000000000005',1,'erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000005/1','resume.dwg','image/vnd.dwg',10,'pending','82000000-0000-4000-8000-000000000001','SW-8101','图纸员工',null);

insert into storage.objects(bucket_id,name,metadata) values
('erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000001/1','{"size":10,"mimetype":"application/pdf"}'),
('erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000002/1','{"size":10,"mimetype":"application/pdf"}'),
('erp-project-documents','P-DOC-1/83000000-0000-4000-8000-000000000003/1','{"size":10,"mimetype":"application/pdf"}'),
('erp-project-documents','P-DOC-1/mismatch/1','{"size":9,"mimetype":"image/png"}');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select throws_like(
  $$select * from public.project_documents$$,
  '%permission denied for table project_documents%',
  'direct metadata table access remains denied'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'authenticated cannot resolve private policy helpers directly'
);
select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'project_document_storage_select_allowed',
        'project_document_storage_upload_allowed',
        'project_document_storage_delete_allowed'
      )
      and has_function_privilege('anon', procedure.oid, 'EXECUTE')
  ),
  'anon cannot execute storage policy helpers'
);
select is(
  (select count(*) from storage.objects where name='P-DOC-1/83000000-0000-4000-8000-000000000001/1'),
  1::bigint,
  'storage select policy works without metadata table access'
);
select is(
  (select count(*) from storage.objects where name='P-DOC-1/83000000-0000-4000-8000-000000000002/1'),
  0::bigint,
  'storage select policy hides sensitive objects from a drawing-only employee'
);
select lives_ok(
  $$insert into storage.objects(bucket_id,name,metadata) values (
      'erp-project-documents',
      'P-DOC-1/83000000-0000-4000-8000-000000000005/1',
      '{"size":10,"mimetype":"image/vnd.dwg"}'::jsonb
    )$$,
  'storage upload policy works without metadata table access'
);
select results_eq(
  $$with deleted as (
      delete from storage.objects
      where name='P-DOC-1/83000000-0000-4000-8000-000000000005/1'
      returning 1
    ) select count(*)::bigint from deleted$$,
  $$values (1::bigint)$$,
  'storage delete policy works without metadata table access'
);
select is((select count(*) from public.list_project_documents_secure('P-DOC-1')),1::bigint,'drawing viewer sees drawing metadata');
select is((select count(*) from public.list_project_documents_secure('P-DOC-1') row where row->>'category'='contract'),0::bigint,'drawing viewer does not receive contract metadata');
select lives_ok($$select public.reserve_project_document_upload_secure('P-DOC-1','drawing',null,'next.dwg','image/vnd.dwg',6291457,null)$$,'drawing editor can reserve a TUS version');
select throws_ok($$select public.reserve_project_document_upload_secure('P-DOC-1','contract',null,'hidden.pdf','application/pdf',10,null)$$,'42501','project document update permission required','non-financial editor cannot reserve sensitive metadata');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.list_project_documents_secure('P-DOC-1')),3::bigint,'financial viewer receives contract and legal metadata');
select throws_ok($$select public.reserve_project_document_upload_secure('P-DOC-1','drawing',null,'bad.pdf','image/png',10,null)$$,'22023','invalid project document','extension and MIME mismatch is rejected server-side');
select is(
  (public.reserve_project_document_upload_secure('P-DOC-1','contract','84000000-0000-4000-8000-000000000002','contract-v2.pdf','application/pdf',10,null)->>'version')::integer,
  2,
  'version allocation is monotonic'
);

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.list_project_documents_secure('P-DOC-1')),3::bigint,'view-only financial user receives sensitive metadata');
select throws_ok($$select public.reserve_project_document_upload_secure('P-DOC-1','legal',null,'legal2.pdf','application/pdf',10,null)$$,'42501','project document update permission required','view-only financial user cannot reserve a version');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.complete_project_document_upload_secure('83000000-0000-4000-8000-000000000004')$$,'22023','uploaded object does not match reservation','completion rejects a mismatched object');
select results_eq(
  $$with deleted as (
      delete from storage.objects
      where name='P-DOC-1/83000000-0000-4000-8000-000000000002/1'
      returning 1
    ) select count(*)::bigint from deleted$$,
  $$values (0::bigint)$$,
  'active objects cannot be physically deleted'
);

reset role;
select is((select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname = any(array['project_documents_select','project_documents_insert','project_documents_delete_pending'])),3::bigint,'exactly three document policies exist');
select ok(
  (select qual like '%project_document_storage_select_allowed%'
   from pg_policies where schemaname='storage' and tablename='objects' and policyname='project_documents_select')
  and
  (select qual like '%project_document_storage_delete_allowed%'
   from pg_policies where schemaname='storage' and tablename='objects' and policyname='project_documents_delete_pending'),
  'select and delete policies call only their bucket-scoped helpers'
);
select ok(
  (select with_check like '%project_document_storage_upload_allowed%'
   from pg_policies where schemaname='storage' and tablename='objects' and policyname='project_documents_insert'),
  'insert policy calls only its bucket-scoped helper'
);
select ok(
  exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='fixture_other_bucket_select'),
  'other bucket policy is unchanged'
);

select * from finish();
rollback;
```

- [ ] **Step 4: Run the 22 planned database assertions**

Run: `supabase test db`

Expected: PASS; `project_documents.sql` reports all assertions successful and no `planned N tests but ran M` error.

- [ ] **Step 5: Commit executable database coverage**

```bash
git add supabase/tests/project_documents.sql src/services/projectDocumentSchema.test.js
git commit -m "test: cover project document authorization"
```

### Task 4: RPC client, standard upload, resumable TUS, signed URLs, and compensation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/features/projects/projectDocumentService.js`
- Test: `src/features/projects/projectDocumentService.test.js`

**Interfaces:**
- Consumes: Supabase client `auth.getSession`, `rpc`, and `storage.from`; `tus.Upload`; Task 1 validation.
- Produces exactly six public methods: `listProjectDocuments`, `reserveProjectDocument`, `uploadReservedDocument`, `completeProjectDocument`, `voidProjectDocument`, and `createProjectDocumentSignedUrl`.

- [ ] **Step 1: Install the pinned client dependency**

Run: `npm install --save-exact tus-js-client@4.3.1`

Expected: exit 0; both manifests contain exactly `"tus-js-client": "4.3.1"`.

- [ ] **Step 2: Write focused service tests**

Create a fake Supabase client that records RPC, upload, remove, signed-URL, and session calls. `FakeUpload.start()` invokes `onProgress(7, 10)` then `onSuccess()`; its failing mode sets `this.url='https://upload.invalid/resume-1'` before calling `onError`. Assert:

```js
test('service exposes exactly the six approved operations', () => {
  assert.deepEqual(Object.keys(service).sort(), [
    'completeProjectDocument',
    'createProjectDocumentSignedUrl',
    'listProjectDocuments',
    'reserveProjectDocument',
    'uploadReservedDocument',
    'voidProjectDocument',
  ])
})

test('reserve sends only validated metadata and no client audit identity', async () => {
  const reservation = await service.reserveProjectDocument({ projectId: 'P001', category: 'contract', logicalDocumentId: null, file: pdf })
  assert.equal(reservation.objectPath, 'P001/document-1/1')
  assert.deepEqual(rpcCalls[0], ['reserve_project_document_upload_secure', {
    p_project_id: 'P001', p_category: 'contract', p_logical_document_id: null,
    p_original_file_name: '契約.pdf', p_content_type: 'application/pdf', p_size_bytes: 1024,
    p_checksum_sha256: null,
  }])
  assert.equal(JSON.stringify(rpcCalls[0]).includes('createdBy'), false)
})

test('files through 6 MiB use standard immutable upload', async () => {
  await service.uploadReservedDocument({ reservation, file: sixMiBPdf, onProgress, signal: new AbortController().signal })
  assert.deepEqual(uploadCalls[0], ['P001/document-1/1', sixMiBPdf, {
    cacheControl: '3600', contentType: 'application/pdf', upsert: false,
  }])
  assert.equal(rpcCalls.some(([name]) => name === 'complete_project_document_upload_secure'), false)
})

test('files above 6 MiB use TUS without persistent URL storage or file names in fingerprints', async () => {
  await service.uploadReservedDocument({
    reservation: { ...reservation, resumeUrl: 'https://upload.invalid/resume-1' },
    file: largePdf,
    onProgress,
    signal: new AbortController().signal,
  })
  assert.equal(FakeUpload.last.options.chunkSize, 6 * 1024 * 1024)
  assert.equal(FakeUpload.last.options.headers['x-upsert'], 'false')
  assert.equal(FakeUpload.last.options.metadata.objectName, reservation.objectPath)
  assert.equal(FakeUpload.last.options.metadata.bucketName, 'erp-project-documents')
  assert.equal(FakeUpload.last.options.uploadUrl, 'https://upload.invalid/resume-1')
  assert.equal(FakeUpload.last.options.storeFingerprintForResuming, false)
  assert.equal(Object.hasOwn(FakeUpload.last.options, 'urlStorage'), false)
  assert.equal(await FakeUpload.last.options.fingerprint(largePdf), `erp-project-documents:${reservation.objectPath}:${largePdf.size}`)
  assert.equal((await FakeUpload.last.options.fingerprint(largePdf)).includes(largePdf.name), false)
  assert.deepEqual(progressValues.at(-1), { uploaded: 7, total: 10, percent: 70 })
})

test('upload interruption preserves reservation and does not compensate', async () => {
  FakeUpload.fail = true
  await assert.rejects(
    service.uploadReservedDocument({ reservation, file: largePdf, signal: new AbortController().signal }),
    (error) => error.code === 'UPLOAD_INTERRUPTED'
      && error.reservation.documentId === reservation.documentId
      && error.reservation.resumeUrl === 'https://upload.invalid/resume-1',
  )
  assert.equal(removeCalls.length, 0)
  assert.equal(rpcCalls.some(([name]) => name === 'reconcile_project_document_upload_failure_secure'), false)
})

test('finalization failure removes the pending object then reconciles lifecycle', async () => {
  rpcErrors.complete_project_document_upload_secure = new Error('finalize failed')
  await assert.rejects(service.completeProjectDocument(reservation.documentId), (error) => error.code === 'METADATA_FINALIZATION_FAILED')
  assert.deepEqual(removeCalls, [[reservation.objectPath]])
  assert.deepEqual(rpcCalls.at(-1), ['reconcile_project_document_upload_failure_secure', { p_document_id: reservation.documentId }])
})

test('signed URL API accepts only document identity and disposition for exactly 300 seconds', async () => {
  assert.equal(await service.createProjectDocumentSignedUrl({ documentId: 'document-1', disposition: 'attachment' }), 'https://signed.invalid')
  assert.deepEqual(rpcCalls.at(-1), ['project_document_signing_target_secure', { p_document_id: 'document-1' }])
  assert.deepEqual(signedCalls[0], ['P001/document-1/1', 300, { download: '契約.pdf' }])
  assert.equal(source.includes('getPublicUrl'), false)
  assert.equal(source.includes('localStorage'), false)
  assert.equal(source.includes('findPreviousUploads'), false)
})
```

- [ ] **Step 3: Run the service test and confirm RED**

Run: `node --test src/features/projects/projectDocumentService.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `projectDocumentService.js`.

- [ ] **Step 4: Implement the service with phase-specific errors**

Use this exact six-method public shape. Upload and completion are separate calls: interrupted upload errors never compensate, while `completeProjectDocument()` owns finalization and compensation.

```js
import * as tus from 'tus-js-client'
import { supabase } from '../../lib/supabaseClient.js'
import {
  PROJECT_DOCUMENT_BUCKET,
  SIGNED_URL_TTL_SECONDS,
  validateProjectDocumentFile,
} from './projectDocumentDomain.js'

export class ProjectDocumentServiceError extends Error {
  constructor(code, message, options = {}) {
    super(message)
    this.name = 'ProjectDocumentServiceError'
    this.code = code
    this.reservation = options.reservation ?? null
    this.cause = options.cause
    this.cleanupError = options.cleanupError ?? null
  }
}

export function buildProjectDocumentTusEndpoint(supabaseUrl) {
  const url = new URL(supabaseUrl)
  if (url.hostname.endsWith('.supabase.co')) {
    url.hostname = url.hostname.replace(/\.supabase\.co$/, '.storage.supabase.co')
  }
  url.pathname = '/storage/v1/upload/resumable'
  url.search = ''
  return url.toString()
}

export function createProjectDocumentService(client, {
  Upload = tus.Upload,
  supabaseUrl = import.meta.env?.VITE_SUPABASE_URL ?? '',
} = {}) {
  const requireData = (result, code) => {
    if (result?.error) throw new ProjectDocumentServiceError(code, '项目文件操作失败', { cause: result.error })
    return result?.data
  }

  const call = async (name, args, code = 'DOCUMENT_REQUEST_FAILED') =>
    requireData(await client.rpc(name, args), code)

  async function listProjectDocuments(projectId) {
    const rows = await call('list_project_documents_secure', { p_project_id: projectId })
    return Array.isArray(rows) ? rows : []
  }

  async function reserveProjectDocument({ projectId, category, logicalDocumentId = null, file, checksumSha256 = null }) {
    const validated = validateProjectDocumentFile({ category, file })
    return call('reserve_project_document_upload_secure', {
      p_project_id: projectId,
      p_category: category,
      p_logical_document_id: logicalDocumentId,
      p_original_file_name: file.name,
      p_content_type: validated.contentType,
      p_size_bytes: file.size,
      p_checksum_sha256: checksumSha256,
    }, 'RESERVATION_FAILED')
  }

  async function standardUpload(reservation, file, onProgress, signal) {
    if (signal?.aborted) throw new DOMException('Upload aborted', 'AbortError')
    requireData(await client.storage.from(PROJECT_DOCUMENT_BUCKET).upload(reservation.objectPath, file, {
      cacheControl: '3600', contentType: file.type.toLowerCase(), upsert: false,
    }), 'UPLOAD_INTERRUPTED')
    onProgress?.({ uploaded: file.size, total: file.size, percent: 100 })
  }

  async function tusUpload(reservation, file, onProgress, signal) {
    const session = requireData(await client.auth.getSession(), 'AUTH_SESSION_INVALID')?.session
    if (!session?.access_token) throw new ProjectDocumentServiceError('AUTH_SESSION_INVALID', '登录状态无效，请重新登录')
    return new Promise((resolve, reject) => {
      let settled = false
      let upload
      const finish = (callback, value) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        callback(value)
      }
      const onAbort = () => {
        upload.abort(false)
          .catch(() => undefined)
          .finally(() => finish(reject, new DOMException('Upload aborted', 'AbortError')))
      }
      upload = new Upload(file, {
        endpoint: buildProjectDocumentTusEndpoint(supabaseUrl),
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: { authorization: `Bearer ${session.access_token}`, 'x-upsert': 'false' },
        uploadDataDuringCreation: true,
        storeFingerprintForResuming: false,
        uploadUrl: reservation.resumeUrl ?? null,
        chunkSize: 6 * 1024 * 1024,
        fingerprint: () => Promise.resolve([
          PROJECT_DOCUMENT_BUCKET, reservation.objectPath, file.size,
        ].join(':')),
        metadata: {
          bucketName: PROJECT_DOCUMENT_BUCKET,
          objectName: reservation.objectPath,
          contentType: file.type.toLowerCase(),
          cacheControl: '3600',
        },
        onProgress(uploaded, total) {
          onProgress?.({ uploaded, total, percent: total ? Math.round((uploaded / total) * 100) : 0 })
        },
        onError(cause) {
          finish(reject, new ProjectDocumentServiceError(
            'UPLOAD_INTERRUPTED',
            '上传中断，可继续上传',
            {
              reservation: { ...reservation, resumeUrl: upload.url ?? reservation.resumeUrl ?? null },
              cause,
            },
          ))
        },
        onSuccess() { finish(resolve) },
      })
      if (signal?.aborted) onAbort()
      else {
        signal?.addEventListener('abort', onAbort, { once: true })
        upload.start()
      }
    })
  }

  async function compensate(documentId) {
    const state = await call('reconcile_project_document_upload_failure_secure', {
      p_document_id: documentId,
    }, 'CLEANUP_RECONCILIATION_FAILED')
    if (state.status === 'active' || state.status === 'void') return state
    await client.storage.from(PROJECT_DOCUMENT_BUCKET).remove([state.objectPath])
    return call('reconcile_project_document_upload_failure_secure', {
      p_document_id: documentId,
    }, 'CLEANUP_RECONCILIATION_FAILED')
  }

  async function uploadReservedDocument({ reservation, file, onProgress, signal }) {
    const { useTus } = validateProjectDocumentFile({ category: reservation.category, file })
    try {
      if (useTus) await tusUpload(reservation, file, onProgress, signal)
      else await standardUpload(reservation, file, onProgress, signal)
    } catch (cause) {
      if (cause instanceof ProjectDocumentServiceError && cause.code === 'UPLOAD_INTERRUPTED') throw cause
      throw new ProjectDocumentServiceError('UPLOAD_INTERRUPTED', '上传中断，可继续上传', { reservation, cause })
    }
    return reservation
  }

  async function completeProjectDocument(documentId) {
    try {
      return await call('complete_project_document_upload_secure', {
        p_document_id: documentId,
      }, 'METADATA_FINALIZATION_FAILED')
    } catch (cause) {
      let cleanupError = null
      let reconciled = null
      try {
        reconciled = await compensate(documentId)
      } catch (error) {
        cleanupError = error
      }
      if (reconciled?.status === 'active') return reconciled
      throw new ProjectDocumentServiceError(
        'METADATA_FINALIZATION_FAILED',
        '文件未保存，已尝试清理上传对象',
        { cause, cleanupError },
      )
    }
  }

  async function createProjectDocumentSignedUrl({ documentId, disposition }) {
    if (!['inline', 'attachment'].includes(disposition)) {
      throw new ProjectDocumentServiceError('SIGNED_URL_INPUT_INVALID', '文件打开方式无效')
    }
    const target = await call('project_document_signing_target_secure', {
      p_document_id: documentId,
    }, 'SIGNED_URL_FAILED')
    if (target?.bucketId !== PROJECT_DOCUMENT_BUCKET
      || typeof target.objectPath !== 'string'
      || typeof target.originalFileName !== 'string') {
      throw new ProjectDocumentServiceError('SIGNED_URL_FAILED', '文件访问目标无效')
    }
    const options = disposition === 'attachment'
      ? { download: target.originalFileName }
      : undefined
    const result = await client.storage.from(target.bucketId)
      .createSignedUrl(target.objectPath, SIGNED_URL_TTL_SECONDS, options)
    return requireData(result, 'SIGNED_URL_FAILED')?.signedUrl
  }

  async function voidProjectDocument({ documentId, reason }) {
    return call('void_project_document_secure', { p_document_id: documentId, p_void_reason: reason }, 'VOID_FAILED')
  }

  return Object.freeze({
    listProjectDocuments,
    reserveProjectDocument,
    uploadReservedDocument,
    completeProjectDocument,
    voidProjectDocument,
    createProjectDocumentSignedUrl,
  })
}

export const projectDocumentService = createProjectDocumentService(supabase)
```

`compensate()` and the reconcile RPC remain private implementation details. The React panel may display a safe finalization error, but it has no cleanup/retry-cleanup service button and never creates a second reservation implicitly.

- [ ] **Step 5: Run service and dependency checks**

Run: `node --test src/features/projects/projectDocumentService.test.js src/features/projects/projectDocumentDomain.test.js`

Expected: PASS; service tests prove standard/TUS boundary, resume, compensation, and 300-second signed URL behavior.

Run: `npm ls tus-js-client`

Expected: `tus-js-client@4.3.1` and no invalid/extraneous marker.

- [ ] **Step 6: Commit the client slice**

```bash
git add package.json package-lock.json src/features/projects/projectDocumentService.js src/features/projects/projectDocumentService.test.js
git commit -m "feat: upload project documents with tus"
```

### Task 5: Version/history/void document panel

**Files:**
- Create: `src/features/projects/ProjectDocumentsPanel.jsx`
- Test: `src/features/projects/projectDocumentsPanel.test.js`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes in production exactly `{ projectId, canViewSensitiveDocuments, canUpdateProject }`; direct tests may additionally inject `service`, which defaults to `projectDocumentService` and still exposes only Task 4's six methods.
- Produces: `ProjectDocumentsPanel` rendering allowed category groups, in-memory progress, resume, current version, expandable history, signed view/download, new version, and void actions.

- [ ] **Step 1: Write a source/UI contract before JSX**

```js
// src/features/projects/projectDocumentsPanel.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./ProjectDocumentsPanel.jsx', import.meta.url), 'utf8')

test('panel hides sensitive groups rather than rendering unauthorized placeholders', () => {
  assert.match(source, /canViewSensitiveDocuments/)
  assert.doesNotMatch(source, /currentUser|canViewProjectFinancials/)
  assert.match(source, /合同/)
  assert.match(source, /图纸/)
  assert.match(source, /甲方法律文件/)
  assert.doesNotMatch(source, /无权限|权限不足/)
})

test('panel exposes current, history, version, void, view, download, progress, and resume controls', () => {
  for (const label of ['当前版本', '历史版本', '新版本', '作废', '查看', '下载', '继续上传', '最新版本已作废，当前回退至']) {
    assert.match(source, new RegExp(label))
  }
  assert.match(source, /upload\.percent/)
  assert.match(source, /service\.createProjectDocumentSignedUrl/)
  assert.match(source, /service\.voidProjectDocument/)
  assert.match(source, /service\.completeProjectDocument/)
})

test('panel state is memory-only and never persists metadata or signed URLs', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|urlStorage|getPublicUrl/)
  assert.match(source, /useState\(\[\]\)/)
  assert.match(source, /URL\.revokeObjectURL|window\.open/)
})
```

- [ ] **Step 2: Run the UI contract and confirm RED**

Run: `node --test src/features/projects/projectDocumentsPanel.test.js`

Expected: FAIL with `ENOENT` for `ProjectDocumentsPanel.jsx`.

- [ ] **Step 3: Implement the panel state machine**

The component must implement these exact transitions:

```js
const EMPTY_UPLOAD = { status: 'idle', percent: 0, file: null, reservation: null, error: '' }
const uploadControllersRef = useRef(new Map())

const refresh = useCallback(async () => {
  setLoadState({ loading: true, error: '' })
  try {
    setDocuments(await service.listProjectDocuments(projectId))
    setLoadState({ loading: false, error: '' })
  } catch (error) {
    setDocuments([])
    setLoadState({ loading: false, error: error.message })
  }
}, [projectId, service])

useEffect(() => () => {
  for (const controller of uploadControllersRef.current.values()) controller.abort()
  uploadControllersRef.current.clear()
}, [])

useEffect(() => {
  refresh()
}, [refresh])

async function startUpload(category, logicalDocumentId, file, existingReservation = null) {
  const controller = new AbortController()
  uploadControllersRef.current.get(category)?.abort()
  uploadControllersRef.current.set(category, controller)
  setUploads((state) => ({ ...state, [category]: { status: 'uploading', percent: 0, file, reservation: existingReservation, error: '' } }))
  try {
    const reservation = existingReservation ?? await service.reserveProjectDocument({ projectId, category, logicalDocumentId, file })
    setUploads((state) => ({ ...state, [category]: { ...state[category], reservation } }))
    const uploadedReservation = await service.uploadReservedDocument({
      reservation,
      file,
      onProgress: ({ percent }) => setUploads((state) => ({ ...state, [category]: { ...state[category], percent } })),
      signal: controller.signal,
    })
    await service.completeProjectDocument(uploadedReservation.documentId)
    setUploads((state) => ({ ...state, [category]: EMPTY_UPLOAD }))
    await refresh()
  } catch (error) {
    setUploads((state) => ({
      ...state,
      [category]: {
        ...state[category],
        status: error.code === 'UPLOAD_INTERRUPTED' ? 'interrupted' : 'failed',
        reservation: error.reservation ?? state[category].reservation,
        error: error.message,
      },
    }))
  } finally {
    if (uploadControllersRef.current.get(category) === controller) {
      uploadControllersRef.current.delete(category)
    }
  }
}
```

Render category descriptors from a fixed array and filter before rendering:

```js
const categories = [
  { key: 'contract', label: '合同', sensitive: true },
  { key: 'drawing', label: '图纸', sensitive: false },
  { key: 'legal', label: '甲方法律文件', sensitive: true },
]
const visibleCategories = categories.filter(({ sensitive }) => !sensitive || canViewSensitiveDocuments)
```

For each logical document, render `current` first with original file name, formatted byte size, `v${version}`, uploader, timestamp, and buttons. When `fallbackMessage` is non-empty, render exactly “最新版本已作废，当前回退至 vN” above the current row; keep the void latest row in history. Render “新版本” whenever `canUpdateProject` and the logical group exists, even if it has no active current row; pass the group's `logicalDocumentId`. Render “作废” only when `canUpdateProject && current`; require a non-empty `window.prompt('请输入作废原因')`, call `service.voidProjectDocument({ documentId: current.documentId, reason })`, and refresh only after success. Do not optimistically remove rows.

For view/download, create a fresh signed URL at click time:

```js
async function openDocument(document, download) {
  try {
    const signedUrl = await service.createProjectDocumentSignedUrl({
      documentId: document.documentId,
      disposition: download ? 'attachment' : 'inline',
    })
    window.open(signedUrl, '_blank', 'noopener,noreferrer')
  } catch (error) {
    setLoadState({ loading: false, error: error.message })
  }
}
```

Use one hidden `<input type="file">` per category. A new-file action passes `logicalDocumentId=null`; a new-version action sets the pending logical ID before invoking `.click()`. `accept` is only a convenience and must list the extensions; domain validation remains authoritative.

Interrupted state renders `继续上传`, calling `startUpload(category, logicalDocumentId, upload.file, upload.reservation)`. The error's client-only `reservation.resumeUrl` remains only in React state and is discarded on panel unmount/logout. Failed finalization renders the safe error; compensation is internal and the UI never calls a cleanup method or reserves/uploads a second object implicitly.

History is collapsed by default. Expanding it renders every row from `history`, including void reason/status, with view/download subject to current signed-URL authorization. A group whose latest version is void but has an older active row displays the explicit fallback message and the older active row as current, matching Task 1.

- [ ] **Step 4: Add focused styles without changing global record-card behavior**

Add `.project-documents-panel`, `.project-document-category`, `.project-document-row`, `.project-document-meta`, `.project-document-progress`, and `.project-document-history` rules. At widths below the existing mobile breakpoint, stack row actions and keep progress width at 100%. Do not modify unrelated employee/admin selectors.

- [ ] **Step 5: Run domain, service, and UI contracts**

Run: `node --test src/features/projects/projectDocumentDomain.test.js src/features/projects/projectDocumentService.test.js src/features/projects/projectDocumentsPanel.test.js`

Expected: PASS.

- [ ] **Step 6: Commit the UI slice**

```bash
git add src/features/projects/ProjectDocumentsPanel.jsx src/features/projects/projectDocumentsPanel.test.js src/styles.css
git commit -m "feat: manage project document versions"
```

### Task 6: Connect saved projects to the document panel without cache leakage

**Files:**
- Modify: `src/features/projects/ProjectPage.jsx`
- Modify: `src/App.jsx`
- Test: `src/features/projects/projectDocumentsIntegration.test.js`

**Interfaces:**
- Consumes: the core `ProjectPage` props and `project.projectId`; Task 5 `ProjectDocumentsPanel`.
- Produces: one “文件管理” toggle per persisted project card and no document UI in the unsaved create form.

- [ ] **Step 1: Write the failing integration contract**

```js
// src/features/projects/projectDocumentsIntegration.test.js
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const page = readFileSync(new URL('./ProjectPage.jsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../App.jsx', import.meta.url), 'utf8')

test('saved project cards own a lazy document panel with precomputed visibility and update capability', () => {
  assert.match(page, /文件管理/)
  assert.match(page, /<ProjectDocumentsPanel/)
  assert.match(page, /projectId=\{project\.projectId\}/)
  assert.match(page, /canViewSensitiveDocuments=\{canViewProjectFinancials\(currentUser\)\}/)
  assert.match(page, /canUpdateProject=/)
  assert.match(page, /openDocumentProjectId === project\.projectId/)
})

test('App forwards current user but does not load or persist document metadata', () => {
  assert.match(app, /<ProjectPage[\s\S]*currentUser=\{currentUser\}/)
  assert.doesNotMatch(app, /projectDocuments|erp\.projectDocuments/)
  assert.doesNotMatch(app, /STORAGE_KEYS[\s\S]{0,200}document/i)
})

test('project creation does not expose upload before the secure create RPC returns a project id', () => {
  const formBlock = page.match(/<form[\s\S]*?<\/form>/)?.[0] ?? ''
  assert.doesNotMatch(formBlock, /ProjectDocumentsPanel|文件管理|type="file"/)
})
```

- [ ] **Step 2: Run the integration contract and confirm RED**

Run: `node --test src/features/projects/projectDocumentsIntegration.test.js`

Expected: FAIL because `ProjectPage` has no document panel import/toggle.

- [ ] **Step 3: Wire the panel into `ProjectPage`**

Import `canEdit` from `src/utils/permissions.js` and import `ProjectDocumentsPanel`; leave the core component signature unchanged.

Add memory-only state:

```js
const [openDocumentProjectId, setOpenDocumentProjectId] = useState('')
```

In each saved project card, add:

```jsx
<button
  className="ghost-button"
  type="button"
  aria-expanded={openDocumentProjectId === project.projectId}
  onClick={() => setOpenDocumentProjectId((current) => current === project.projectId ? '' : project.projectId)}
>
  文件管理
</button>
{openDocumentProjectId === project.projectId && (
  <ProjectDocumentsPanel
    projectId={project.projectId}
    canViewSensitiveDocuments={canViewProjectFinancials(currentUser)}
    canUpdateProject={canEdit(currentUser, '工程项目')}
  />
)}
```

Do not preload all project document lists: mounting the expanded panel triggers exactly one project-scoped list RPC. Closing it unmounts and clears its state. On logout, the core `AuthenticatedApp` unmount clears all document metadata and TUS UI state.

- [ ] **Step 4: Forward `currentUser` from `App.jsx` and leave service defaulting inside the page/panel**

The core page call becomes:

```jsx
<ProjectPage
  projects={projects}
  projectRevenueSnapshots={projectRevenueSnapshots}
  currentUser={currentUser}
  employeeDirectory={projectEmployeeDirectory}
  directoryState={projectEmployeeDirectoryState}
  onRetryDirectory={refreshProjectEmployeeDirectory}
  onCreateProject={handleCreateProject}
  onUpdateProject={handleUpdateProject}
  onDeleteProject={handleDeleteProject}
  onOpenContractRevenue={openContractRevenue}
  onBack={() => setCurrentView('home')}
/>
```

Do not introduce document state or document service calls in `App.jsx`.

- [ ] **Step 5: Run integration and project regressions**

Run: `node --test src/features/projects/projectDocumentsIntegration.test.js src/features/projects/projectDocumentsPanel.test.js src/features/projects/projectDocumentDomain.test.js src/features/projects/projectDocumentService.test.js`

Expected: PASS.

Run: `node --test src/features/contract-revenue/*.test.js`

Expected: PASS; project financial display and contract-income flows remain intact.

- [ ] **Step 6: Commit the integration slice**

```bash
git add src/features/projects/ProjectPage.jsx src/features/projects/projectDocumentsIntegration.test.js src/App.jsx
git commit -m "feat: connect project document management"
```

### Task 7: Full verification, deployment evidence, and handoff

**Files:**
- Modify only if commands expose a real omission: files already named in Tasks 1–6.

**Interfaces:**
- Consumes: all previous tasks plus the core project implementation.
- Produces: fresh automated, database, build, browser, and worktree-scope evidence.

- [ ] **Step 1: Run the complete Node suite**

Run: `npm test`

Expected: exit 0; no failed, cancelled, or skipped project-document tests.

- [ ] **Step 2: Run a production build**

Run: `npm run build`

Expected: exit 0 and Vite reports a completed production build. Record the TUS bundle-size delta; if Vite reports a chunk warning, lazy-load the document panel/TUS module rather than raising the global warning limit.

- [ ] **Step 3: Recreate and test the database from zero**

Run: `supabase db reset && supabase test db`

Expected: exit 0; core project security applies before document security, all pgTAP files pass, and no other Storage bucket/policy changes.

- [ ] **Step 4: Verify the two-role authorization matrix in a browser**

With one active `工程部` account having project view/update and one active whitelist account having project view/update:

1. Engineering sees only 图纸; it never receives/renders 合同 or 甲方法律文件 metadata.
2. Whitelist sees all three groups; a whitelist view-only account sees but cannot upload/version/void.
3. Upload exactly 6 MiB and confirm standard upload; upload 6 MiB + 1 byte and confirm visible TUS progress.
4. Interrupt the large upload, click 继续上传, and confirm the same `documentId/objectPath/version` completes; database evidence must show TUS Storage INSERT passed through `private.project_document_storage_upload_allowed` while direct authenticated `SELECT public.project_documents` remained denied.
5. Upload a new version and confirm the old version remains in history; void the current version and confirm no object is physically deleted.
6. Click 查看 and 下载 and confirm each request creates a new URL expiring in 300 seconds; revoke permission and confirm the next signed-URL request fails.
7. Try mismatched extension/MIME and 50 MiB + 1 byte and confirm rejection occurs before reservation.
8. Force finalization failure and confirm Storage removal is attempted; if removal is denied, confirm metadata is `cleanup_pending` for service-role cleanup.

- [ ] **Step 5: Audit sensitive cache and URL leakage**

Run:

```bash
rg -n "erp\.projectDocuments|projectDocuments.*localStorage|localStorage.*projectDocuments|getPublicUrl|findPreviousUploads|urlStorage" src
```

Expected: no matches and exit 1.

Run: `rg -n "SIGNED_URL_TTL_SECONDS = 300|storeFingerprintForResuming: false" src/features/projects`

Expected: exactly the 300-second domain constant and the non-persistent TUS option appear.

Run:

```bash
rg -n "customerName|projectName|originalFileName" src/features/projects/projectDocumentService.js supabase/migrations/202607150002_project_documents.sql
```

Expected: `originalFileName` appears only in RPC metadata/download options, never in `objectPath`; customer/project names do not appear in path construction.

- [ ] **Step 6: Prove pre-existing work was untouched**

Run: `git diff -- supabase/functions/employee-bootstrap-admin/handler.js supabase/functions/employee-bootstrap-admin/handler.test.js`

Expected: the same pre-existing diff present before implementation; no hunk references project documents and neither file appears in any Task 1–6 commit.

Run: `git status --short`

Expected: only the two pre-existing employee-bootstrap-admin modifications remain, or the worktree is otherwise clean if their owner committed them separately.

- [ ] **Step 7: Final implementation commit only if verification required a correction**

```bash
git add package.json package-lock.json docs/supabase-schema.sql docs/supabase-schema.md \
  supabase/migrations/202607150002_project_documents.sql \
  supabase/tests/project_documents.sql \
  src/App.jsx src/styles.css src/services/projectDocumentSchema.test.js \
  src/features/projects/projectDocumentDomain.js \
  src/features/projects/projectDocumentDomain.test.js \
  src/features/projects/projectDocumentService.js \
  src/features/projects/projectDocumentService.test.js \
  src/features/projects/ProjectDocumentsPanel.jsx \
  src/features/projects/projectDocumentsPanel.test.js \
  src/features/projects/ProjectPage.jsx \
  src/features/projects/projectDocumentsIntegration.test.js
git commit -m "fix: complete project document verification"
```

Do not create an empty commit. Report any unavailable local Supabase/browser verification explicitly instead of claiming it passed.

## Deployment order

1. Back up `projects`, contract-revenue tables, and Storage metadata.
2. Deploy the core `202607150001_project_core_security.sql` migration.
3. Deploy `202607150002_project_documents.sql`; verify the bucket is private and only the three bucket-scoped policies exist.
4. Run the pgTAP matrix with controlled test identities.
5. Deploy the frontend containing `tus-js-client@4.3.1`.
6. Run the two-role browser acceptance matrix.

Never deploy the document frontend before both secure project RPCs and document RPC/Storage policies are live. Never create a public bucket as a transition.

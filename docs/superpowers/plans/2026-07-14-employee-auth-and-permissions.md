# Employee Auth and Department/Position Permissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace browser-only employee login with Supabase Auth, database-generated `SW-xxx` numbers, one-time credentials, strict account-state checks, and permissions derived exclusively from department and position templates.

**Architecture:** The browser holds only the Supabase publishable key and user session. Supabase Edge Functions orchestrate login and privileged employee operations with service-role credentials, while PostgreSQL stores normalized employee identities and evaluates active status plus effective permissions on every protected request through RLS. The existing React personnel page consumes focused auth/employee services and no longer owns password, employee-number, role, or personal-permission logic.

**Tech Stack:** React 19, Vite 6, `@supabase/supabase-js` 2.x, Node `node:test`, Supabase PostgreSQL migrations, Supabase Edge Functions (Deno/TypeScript)

## Global Constraints

- Hidden super administrator is `SW-000`; it never consumes the normal sequence or appears in personnel lists.
- Normal employee numbers start at `SW-001`, are database generated, immutable, never reused, and expand beyond three digits.
- Departments are exactly: 总务部、营业部、事务部、后勤部、设计部、工程部、仓库管理部、电商部、采购部、财务部.
- Positions are exactly: 社长、总务部长、营业部长、部长、主任、主任设计师、设计师、仓库管理员、工事部长、职长、大工、中工、小工、会计主管、会计.
- Employee effective permission is the union of department and position grants; there are no individual grants or overrides.
- Only `SW-000` and active employees whose position is 社长 may provision employees, change department/position, manage account state, reset passwords, or edit permission templates.
- Only active accounts with employment status 在职 may access protected data.
- The user-specified existing `SW-000` password is provided only through a deployment secret; its literal value must not be added to Git-managed files.
- No service-role key, password, hidden Auth alias, or trusted current-user snapshot may be stored in browser business state.
- Missing Supabase configuration fails closed; it never enables legacy local login.

---

### Task 1: Employee auth domain constants and validation

**Files:**
- Create: `src/auth/employeeAuthDomain.js`
- Test: `src/auth/employeeAuthDomain.test.js`
- Modify: `src/utils/permissions.js`

**Interfaces:**
- Produces: `DEPARTMENT_OPTIONS`, `POSITION_OPTIONS`, `normalizeEmployeeNumber(value)`, `isEmployeeNumber(value)`, `buildInternalAuthAlias(employeeNumber, secret, cryptoImpl)`, `generateTemporaryPassword(randomBytes)`, `mergePermissionKeys(departmentKeys, positionKeys)`, and `isPersonnelAdministrator(employee)`.
- Consumers: frontend forms, Edge shared modules, permission UI, and tests in later tasks.

- [ ] Write failing `node:test` cases proving the exact department/position lists, `SW-000`/`SW-001` normalization, invalid number rejection, 12-character password composition, permission union without duplicates, and `SW-000`/社长 management rules.
- [ ] Run `node --test src/auth/employeeAuthDomain.test.js`; expect failures because the module does not exist.
- [ ] Implement the pure module. Use `/^SW-\d{3,}$/`; password alphabet must exclude `0O1Il` and contain uppercase, lowercase, and digits.
- [ ] Update `permissions.js` so UI authorization reads effective permission keys and removes employee-specific default grants.
- [ ] Run the focused test and `npm test`; expect all tests to pass.
- [ ] Commit with `feat: add employee auth domain rules`.

### Task 2: Normalized employee schema, number reservation, permission grants, and RLS

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/202607140001_employee_auth.sql`
- Create: `supabase/tests/employee_auth.sql`
- Modify: `docs/supabase-schema.md`
- Modify: `docs/supabase-schema.sql`

**Interfaces:**
- Produces database tables `employee_profiles`, `employee_provisioning_requests`, `permission_grants`, `auth_login_attempts`, and `employee_security_audit`; functions `reserve_employee_number(uuid)`, `current_employee_profile()`, `is_current_employee_active()`, and `has_current_permission(text)`; immutable-number trigger; safe employee directory function.
- Consumers: all Edge Functions and authenticated business-table RLS policies.

- [ ] Write SQL assertions for `SW-001` allocation, immutable numbers, fixed department/position checks, permission union, hidden `SW-000`, and denial for anon/disabled users.
- [ ] Add an additive migration that creates enums/checks, normalized tables, indexes, provisioning state, audit data, a sequence starting at 1, and SECURITY DEFINER helpers with fixed `search_path`.
- [ ] Replace every `prototype select/insert/update` policy with authenticated policies that call current-state and permission helpers. Revoke anon business-table access and direct authenticated writes to employee security tables.
- [ ] Add safe employee-directory and authorized detail RPCs that never return password/Auth alias fields and conditionally return sensitive columns.
- [ ] Update schema documentation and the bootstrap schema to match the migration.
- [ ] Run `supabase db reset` and `supabase test db` when the CLI/runtime is available; otherwise run SQL static contract tests and record the unavailable integration environment explicitly.
- [ ] Commit with `feat: add employee auth database security`.

### Task 3: Shared Edge Function security primitives

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/responses.ts`
- Create: `supabase/functions/_shared/clients.ts`
- Create: `supabase/functions/_shared/employee-auth.ts`
- Create: `supabase/functions/_shared/employee-auth.test.js`

**Interfaces:**
- Produces: `withCors(request, handler)`, `jsonResponse(body, status)`, `createAdminClient()`, `createUserClient(accessToken)`, `requireActiveEmployee(request)`, `requirePersonnelAdministrator(request)`, `deriveAuthEmail(employeeNumber)`, and `createTemporaryPassword()`.
- Consumers: all Edge Function handlers.

- [ ] Write dependency-injected Node tests for missing/malformed bearer tokens, disabled accounts, non-admin accounts, deterministic alias derivation, temporary-password generation, and sanitized error payloads.
- [ ] Run `node --test supabase/functions/_shared/employee-auth.test.js`; expect module-not-found failures.
- [ ] Implement shared helpers with separate admin and user clients. Never initialize admin clients with a caller JWT and never log request bodies or credentials.
- [ ] Ensure the internal alias uses HMAC-SHA256 with `AUTH_ID_DERIVATION_SECRET`; return only an opaque syntactically valid Auth email.
- [ ] Run the focused tests and `npm test`.
- [ ] Commit with `feat: add edge auth security helpers`.

### Task 4: Login, password change, and SW-000 bootstrap

**Files:**
- Create: `supabase/functions/employee-login/index.ts`
- Create: `supabase/functions/employee-change-password/index.ts`
- Create: `supabase/functions/employee-bootstrap-admin/index.ts`
- Create: `supabase/functions/employee-login/handler.js`
- Test: `supabase/functions/employee-login/handler.test.js`
- Create: `scripts/bootstrap-sw000.mjs`
- Modify: `.env.example`

**Interfaces:**
- `employee-login` consumes `{ employeeNumber, password }` and returns only `{ access_token, refresh_token, expires_at, expires_in }`.
- `employee-change-password` consumes authenticated `{ password }` and clears `must_change_password` only after Auth update succeeds.
- bootstrap consumes `SW000_BOOTSTRAP_PASSWORD` from server environment and is idempotent.

- [ ] Write handler tests for valid, invalid, unknown, disabled, non-在职, rate-limited, and locked login attempts; assert the opaque alias is not a separate response field.
- [ ] Implement rate limiting at five failures per 15 minutes with a 15-minute lock and audit records.
- [ ] Implement login using a non-admin Auth client for `signInWithPassword`; never use email/phone as browser input.
- [ ] Implement first-password change; deny business access while `must_change_password` is true, except profile/change-password/logout paths.
- [ ] Implement idempotent `SW-000` bootstrap using only `SW000_BOOTSTRAP_PASSWORD`; do not include a default value in code or examples.
- [ ] Run focused tests, `npm test`, and a repository scan for the historic password literal.
- [ ] Commit with `feat: add employee auth endpoints`.

### Task 5: Employee provisioning, update, disable, and password reset functions

**Files:**
- Create: `supabase/functions/employee-provision/index.ts`
- Create: `supabase/functions/employee-provision/handler.js`
- Test: `supabase/functions/employee-provision/handler.test.js`
- Create: `supabase/functions/employee-admin/index.ts`
- Create: `supabase/functions/employee-admin/handler.js`
- Test: `supabase/functions/employee-admin/handler.test.js`

**Interfaces:**
- `employee-provision` consumes `{ requestId, profile }`; returns `{ employee, initialPassword }` only on first successful completion.
- `employee-admin` supports `update_profile`, `set_account_status`, and `reset_temporary_password`; employee numbers are never accepted as mutable fields.

- [ ] Write failing tests for idempotent reservation, required fixed department/position, secure password generation, Auth creation, profile association, Auth deletion compensation, compensation-pending state, immutable number rejection, disable-before-ban ordering, and single-display reset passwords.
- [ ] Implement provisioning in the exact sequence: reserve number, generate password, derive alias, create Auth user, create profile; on profile failure delete the newly created Auth user.
- [ ] Return stable Chinese-safe error codes and never echo supplier errors, credentials, or aliases.
- [ ] Implement admin updates with fresh caller-state checks. Disable database access before banning Auth; re-enable Auth before activating the profile.
- [ ] Run focused tests and `npm test`.
- [ ] Commit with `feat: provision and manage employee accounts`.

### Task 6: Browser session gate and employee-number login page

**Files:**
- Create: `src/services/employeeAuthService.js`
- Test: `src/services/employeeAuthService.test.js`
- Create: `src/auth/AuthGate.jsx`
- Create: `src/auth/LoginPage.jsx`
- Create: `src/auth/ChangeTemporaryPasswordPage.jsx`
- Modify: `src/lib/supabaseClient.js`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`
- Copy: `public/sw-erp-logo.jpg` from the current user working tree

**Interfaces:**
- Produces `loginWithEmployeeNumber`, `logout`, `getCurrentEmployee`, `changeTemporaryPassword`, and `<AuthGate>`.
- `<AuthGate>` renders loading/config-error/login/change-password/authenticated states and mounts the ERP only after current employee validation.

- [ ] Write service tests for Edge invoke payloads, `setSession`, error normalization, logout, and missing configuration.
- [ ] Add source-contract tests proving there is no name/email/phone/self-registration path and no `localStorage.currentUser` security gate.
- [ ] Implement a publishable Supabase client with persisted Auth session and no service-role configuration.
- [ ] Replace browser name/password matching and default-admin creation with `<AuthGate>` and employee-number login.
- [ ] Preserve the current black-gold login design and logo; change copy to 员工编号/密码.
- [ ] Ensure business data hooks do not mount before authentication and fail closed when configuration is missing.
- [ ] Run focused tests, `npm test`, and `npm run build`.
- [ ] Commit with `feat: replace local login with supabase auth`.

### Task 7: Personnel page and one-time credentials UI

**Files:**
- Create: `src/services/employeeAdminService.js`
- Test: `src/services/employeeAdminService.test.js`
- Create: `src/features/employees/EmployeeCredentialsDialog.jsx`
- Create: `src/features/employees/PersonnelPage.jsx`
- Test: `src/features/employees/personnelPageContract.test.js`
- Modify: `src/App.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Personnel page consumes `employees`, `currentEmployee`, and employee admin service methods.
- Credentials dialog consumes `{ employeeNumber, initialPassword, onClose }` and keeps values only in component memory.

- [ ] Write contracts asserting fixed department/position options, both required, generated-number copy, immutable edit number, no username/passwordHash/role/personal-permission controls, hidden `SW-000`, and account-management actions.
- [ ] Implement service calls with a client-generated UUID idempotency key and no optimistic employee insertion.
- [ ] Extract personnel UI from the monolithic `App.jsx`; retain existing profile/salary fields while removing login and personal-permission sections.
- [ ] Add the one-time credential dialog with copy-number, copy-password, copy-all, and explicit close acknowledgement; never persist credentials.
- [ ] Add enable/disable and reset-temporary-password actions for `SW-000`/社长 only.
- [ ] Run focused tests, `npm test`, and `npm run build`.
- [ ] Commit with `feat: secure employee management workflow`.

### Task 8: Department and position permission-template UI

**Files:**
- Create: `supabase/functions/permission-templates/index.ts`
- Create: `src/services/permissionTemplateService.js`
- Test: `src/services/permissionTemplateService.test.js`
- Create: `src/features/employees/PermissionTemplateEditor.jsx`
- Test: `src/features/employees/permissionTemplateContract.test.js`
- Modify: `src/features/employees/PersonnelPage.jsx`
- Modify: `src/styles.css`

**Interfaces:**
- Service returns `{ departments: Record<string,string[]>, positions: Record<string,string[]> }` and accepts an atomic replacement for one subject.
- Editor renders module action and sensitive-permission matrices and is visible only to `SW-000`/社长.

- [ ] Write failing service and source-contract tests for authenticated reads, server-authorized writes, exact subjects, no individual employee template, and atomic replace payloads.
- [ ] Implement the Edge endpoint with fresh active/admin checks and server audit records.
- [ ] Implement department/position tabs and permission matrices using stable permission keys plus Chinese labels.
- [ ] Refresh current effective permissions after template save; do not cache grants in employee profiles.
- [ ] Run focused tests, `npm test`, and `npm run build`.
- [ ] Commit with `feat: add department and position permission templates`.

### Task 9: Legacy-data quarantine and secure business persistence

**Files:**
- Modify: `src/services/baseRecordService.js`
- Test: `src/services/baseRecordService.test.js`
- Create: `src/services/employeeMigrationService.js`
- Test: `src/services/employeeMigrationService.test.js`
- Modify: `src/App.jsx`
- Modify: `README.md`

**Interfaces:**
- Base persistence requires an authenticated active session and relies on strict RLS; it no longer reads audit identity from localStorage.
- Migration service reports legacy employee IDs and removes legacy auth fields without auto-rewriting historical business JSON.

- [ ] Write tests proving unauthenticated operations fail before network writes, audit fields do not come from browser identity, and employee lists are not saved through whole-table `saveList`.
- [ ] Remove `readCurrentUser`, default-admin upsert, employee whole-list upsert/soft-delete, and local-cache fallback after authorization errors.
- [ ] Add legacy employee audit/report support and remove `passwordHash`/username from migrated payloads.
- [ ] Update README with deployment order, Edge secrets, bootstrap command, fail-closed behavior, and migration warnings.
- [ ] Run focused tests, `npm test`, and `npm run build`.
- [ ] Commit with `refactor: enforce authenticated business persistence`.

### Task 10: Full security verification and running-app handoff

**Files:**
- Create: `src/employeeAuthSecurity.test.js`
- Modify: only files required by discovered verification defects

**Interfaces:**
- Produces a verified build and a running local preview from the feature worktree.

- [ ] Run `npm test`; expect every existing and new test to pass.
- [ ] Run `npm run build`; expect exit code 0.
- [ ] Run static scans over `src`, `supabase`, scripts, and `dist` for service-role configuration, committed bootstrap password, legacy default-admin credentials, `passwordHash`, self-registration, and `localStorage.currentUser`; allow only migration-removal documentation/test fixtures that do not contain a secret value.
- [ ] Run database/Edge integration tests with local Supabase if available; otherwise report the exact unavailable dependency and do not claim deployed integration success.
- [ ] Start the feature worktree on a free local port and use the in-app browser to verify login configuration state, employee-number form, fixed personnel options, immutable number UI, one-time credentials dialog, and responsive layout.
- [ ] Review `git diff`, confirm no unrelated user files were overwritten, and run final tests once more.
- [ ] Commit verification-only fixes with `test: verify employee auth security`.

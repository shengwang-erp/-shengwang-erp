# Department Attendance Modes and Company Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing attendance and labor-accounting system so engineering staff use project attendance, all other departments use location-recorded non-project attendance, administrators can exempt selected employees from daily attendance, location exceptions receive audited accounting review without changing pay, and monthly company payroll exports remain leadership-ready.

**Architecture:** Keep one normalized attendance domain and add an explicit `project | general` session mode plus a server-owned employee attendance policy. Introduce versioned v2 attendance RPCs so the database can deploy before the new frontend without breaking the strict v1 client. Extend the existing daily-resolution and monthly-payroll models with structured location review and company-personnel cost fields, then adapt the authoritative filtered monthly payroll into the shared accounting report renderer.

**Tech Stack:** React 19, Vite 6, Node `node:test`, Supabase PostgreSQL/PLpgSQL/pgTAP, Supabase Edge Functions, ExcelJS 4.4, existing accounting report model and print renderer.

## Global Constraints

- Only `department = '工程部'` uses project attendance; every other department uses general attendance.
- Engineering staff must select an eligible project; there is no project-less engineering clock flow.
- General attendance stores device location but performs no office, warehouse, or project geofence comparison.
- All employees who require attendance must obtain a valid device location; denied, timed-out, or invalid location writes nothing.
- Engineering project clock-in and clock-out both warn outside the project radius, allow a confirmed write, and preserve the authoritative out-of-range fact.
- Out-of-range accounting outcomes are exactly `confirmed_valid` and `recorded_abnormal`; both preserve normal pay, attendance units, and project cost.
- An out-of-range daily resolution cannot be confirmed without an outcome and a non-empty accounting note.
- `attendance_required = false` is administrator-controlled, creates no fake clock events, creates no missing-clock issues, and defaults to full scheduled monthly pay.
- General and exempt payroll is company-personnel cost and must never create an `attendance_project_allocations` row.
- Existing project attendance, abnormal-reason text, confirmed daily resolutions, locked payroll, and project costs remain unchanged and traceable.
- Excel/PDF/print output follows the current month, department, employee, and pending-status filters; it uses neutral white A4 styling and existing salary permissions.
- No new runtime dependency is allowed.
- Every production mutation remains RPC-only, server-authorized, idempotent, and audited.

---

## File and interface map

- `supabase/migrations/202608120001_department_attendance_modes.sql` owns the employee policy columns, session/event mode constraints, v2 attendance JSON helpers, and v2 clock RPCs.
- `supabase/migrations/202608120002_attendance_location_review_and_company_payroll.sql` owns structured location review, exempt attendance classification, company cost snapshots, and payroll/report RPC changes.
- `src/services/attendanceService.js` is the only browser boundary for v2 attendance DTO validation and mutation calls.
- `src/features/attendance/attendancePolicy.js` contains pure policy/view-state helpers; React components do not infer policy from arbitrary client roles.
- `src/features/attendance/AttendanceOutOfRangeDialog.jsx` owns the cancel/confirm interaction without performing writes itself.
- `src/features/attendance/GeneralAttendanceSession.jsx` owns the simplified non-project open-session UI.
- `src/services/laborAccountingService.js` validates the extended daily and monthly DTOs and sends review fields.
- `src/features/labor-accounting/AttendanceResolutionDialog.jsx` owns the accounting location-review controls and general-session cost isolation UI.
- `src/features/accounting-reports/monthlyPayrollReport.js` adapts the exact visible monthly payroll rows into the existing immutable report model.
- `src/features/labor-accounting/MonthlyPayrollTab.jsx` owns filter state and wires the shared report actions to the currently visible authoritative rows.

---

### Task 1: Add a backward-compatible attendance policy and v2 database contract

**Files:**
- Create: `supabase/migrations/202608120001_department_attendance_modes.sql`
- Create: `supabase/tests/department_attendance_modes.sql`
- Create: `src/services/departmentAttendanceSchema.test.js`
- Modify: `docs/supabase-schema.md`
- Modify: `docs/today-attendance-operations.md`

**Interfaces:**
- Consumes: existing `employee_profiles`, `project_attendance_sessions`, `project_attendance_events`, v1 attendance RPCs, project eligibility helper, and immutable photo/work-point tables.
- Produces: `employee_profiles.attendance_required boolean`; session `attendance_mode`; v2 RPCs `list_attendance_projects_v2_secure()`, `get_my_today_attendance_v2_secure()`, `clock_in_project_v2_secure(...)`, `clock_in_general_secure(...)`, `clock_out_attendance_v2_secure(...)`; the union response described below.

- [ ] **Step 1: Write the failing static and pgTAP contracts**

Create `src/services/departmentAttendanceSchema.test.js` with literal migration checks that fail before the migration exists:

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(
  new URL('../../supabase/migrations/202608120001_department_attendance_modes.sql', import.meta.url),
  'utf8',
).catch(() => '')

test('department attendance migration is versioned and keeps v1 RPCs during rollout', () => {
  assert.match(migration, /add column attendance_required boolean not null default true/iu)
  assert.match(migration, /attendance_mode[^;]+project[^;]+general/isu)
  assert.match(migration, /create or replace function public\.get_my_today_attendance_v2_secure/iu)
  assert.match(migration, /create or replace function public\.clock_in_general_secure/iu)
  assert.doesNotMatch(migration, /drop function[^;]+get_my_today_attendance_secure/iu)
  assert.doesNotMatch(migration, /drop function[^;]+clock_in_project_secure/iu)
})

test('general attendance is structurally unable to carry project cost identity', () => {
  assert.match(migration, /attendance_session_mode_payload_check/iu)
  assert.match(migration, /attendance_mode = 'general'[\s\S]+project_id is null/iu)
  assert.match(migration, /result = 'not_applicable'[\s\S]+distance_meters is null/iu)
})
```

Create `supabase/tests/department_attendance_modes.sql` with a fixed engineering actor, a non-engineering actor, an exempt actor, an eligible project, and assertions beginning with:

```sql
select has_column('public', 'employee_profiles', 'attendance_required');
select has_column('public', 'project_attendance_sessions', 'attendance_mode');
select has_function('public', 'get_my_today_attendance_v2_secure', array[]::text[]);
select has_function('public', 'clock_in_general_secure', array[
  'uuid','double precision','double precision','numeric','timestamp with time zone'
]);
select has_function('public', 'clock_in_project_v2_secure', array[
  'text','uuid','double precision','double precision','numeric',
  'timestamp with time zone','boolean'
]);
select has_function('public', 'clock_out_attendance_v2_secure', array[
  'uuid','uuid','double precision','double precision','numeric',
  'timestamp with time zone','boolean'
]);
```

The pgTAP cases must prove: existing rows backfill to `project`; engineering cannot call general clock; non-engineering cannot call project clock; exempt staff cannot clock; general events store `result = 'not_applicable'` and null distance/radius; project first-call outside radius returns `confirmation_required` without writing; confirmed retry writes one abnormal event; repeated confirmed retry returns the same event; clock-out applies the same confirmation flow; work-point/photo mutation rejects general sessions; v1 RPC signatures remain executable.

- [ ] **Step 2: Run the RED contracts**

Run:

```bash
node --test src/services/departmentAttendanceSchema.test.js
npx supabase test db supabase/tests/department_attendance_modes.sql --local --workdir /private/tmp/kaobeierp-department-attendance-db
```

Expected: the Node test fails because the migration is absent; pgTAP fails on missing columns and v2 RPCs.

- [ ] **Step 3: Implement the migration and exact v2 response union**

Start the migration with additive, backfilled columns and mode coherence constraints:

```sql
begin;

alter table public.employee_profiles
  add column attendance_required boolean not null default true,
  add column attendance_policy_updated_at timestamptz,
  add column attendance_policy_updated_by uuid
    references public.employee_profiles(id) on delete restrict;

alter table public.project_attendance_sessions
  add column attendance_mode text not null default 'project';

alter table public.project_attendance_sessions
  alter column project_id drop not null,
  alter column project_name_snapshot drop not null,
  alter column project_address_snapshot drop not null,
  alter column project_latitude_snapshot drop not null,
  alter column project_longitude_snapshot drop not null,
  alter column attendance_radius_meters_snapshot drop not null;

alter table public.project_attendance_events
  add column out_of_range_confirmed_at timestamptz,
  alter column distance_meters drop not null,
  alter column radius_meters drop not null;
```

Replace the old project-only check constraints with `attendance_session_mode_payload_check` and an event check that enforces:

```sql
check (
  (attendance_mode = 'project' and project_id is not null
    and project_name_snapshot is not null
    and project_address_snapshot is not null
    and project_latitude_snapshot is not null
    and project_longitude_snapshot is not null
    and attendance_radius_meters_snapshot is not null)
  or
  (attendance_mode = 'general' and project_id is null
    and project_name_snapshot is null
    and project_address_snapshot is null
    and project_latitude_snapshot is null
    and project_longitude_snapshot is null
    and attendance_radius_meters_snapshot is null)
)
```

The v2 clock RPCs return exactly one of these JSON shapes:

```js
// No event or session write occurred.
{
  status: 'confirmation_required',
  confirmation: {
    projectId: 'P001', projectName: '东京站现场',
    distanceMeters: 420.5, radiusMeters: 300, accuracyMeters: 12,
  },
}

// A write succeeded or an idempotent prior write was returned.
{ status: 'saved', session: { /* v2 session */ }, event: { /* v2 event */ } }
```

`get_my_today_attendance_v2_secure()` returns the existing fields plus:

```js
policy: {
  attendanceRequired: true,
  attendanceMode: 'project', // 'project' | 'general' | 'exempt'
}
```

For `general` sessions, JSON project snapshot fields are `null`, `workPoints` is `[]`, event `distanceMeters` and `radiusMeters` are `null`, and event result is `not_applicable`. For project sessions, all current fields retain their meaning. Keep all v1 functions and grants unchanged during rollout. Revoke public/anon execution from every v2 function and grant only `authenticated` and `service_role` as in the v1 migration.

- [ ] **Step 4: Update database documentation and rollout order**

Document the safe sequence in `docs/today-attendance-operations.md`:

```text
1. Apply 202608120001_department_attendance_modes.sql.
2. Verify v1 and v2 RPC signatures are both executable.
3. Deploy the frontend that calls v2 RPCs.
4. Keep v1 RPCs until a later independently reviewed cleanup migration.
```

Add the new columns, constraints, and RPCs to `docs/supabase-schema.md`.

- [ ] **Step 5: Run focused GREEN verification**

Run:

```bash
node --test src/services/departmentAttendanceSchema.test.js
npx supabase test db supabase/tests/today_attendance.sql supabase/tests/department_attendance_modes.sql --local --workdir /private/tmp/kaobeierp-department-attendance-db
```

Expected: all assertions pass; the original v1 attendance suite remains green.

- [ ] **Step 6: Commit Task 1**

```bash
git add supabase/migrations/202608120001_department_attendance_modes.sql supabase/tests/department_attendance_modes.sql src/services/departmentAttendanceSchema.test.js docs/supabase-schema.md docs/today-attendance-operations.md
git commit -m "feat: add department attendance data modes"
```

---

### Task 2: Expose the administrator-owned daily-attendance setting

**Files:**
- Modify: `src/services/employeeAdminService.js`
- Modify: `src/services/employeeAdminService.test.js`
- Modify: `src/features/employees/PersonnelPage.jsx`
- Modify: `src/features/employees/personnelPageContract.test.js`
- Modify: `supabase/functions/employee-admin/handler.js`
- Modify: `supabase/functions/employee-admin/handler.test.js`
- Modify: `supabase/migrations/202608120001_department_attendance_modes.sql`
- Modify: `supabase/tests/department_attendance_modes.sql`

**Interfaces:**
- Consumes: Task 1 `attendance_required`; existing administrator authorization and `update_employee_profile_admin` audit path.
- Produces: service/detail field `attendanceRequired: boolean`; personnel form checkbox; administrator patch `{ attendanceRequired: boolean }`.

- [ ] **Step 1: Write failing service, Edge Function, UI, and pgTAP tests**

Add these assertions:

```js
// employeeAdminService.test.js
await service.updateProfile({
  employeeId: EMPLOYEE_ID,
  patch: { attendanceRequired: false },
})
assert.deepEqual(invocations[0].body.patch, { attendanceRequired: false })

// personnelPageContract.test.js
assert.match(pageSource, /name="attendanceRequired"/u)
assert.match(pageSource, /需要每日打卡/u)
assert.match(pageSource, /免打卡人员按正常全勤进入月度工资/u)

// employee-admin/handler.test.js
assert.deepEqual(input.patch, { attendanceRequired: false })
```

Add pgTAP assertions that an administrator update changes the target, a non-administrator call fails, the audit row lists `attendanceRequired`, and the employee cannot update their own policy directly.

- [ ] **Step 2: Run the RED tests**

Run:

```bash
node --test src/services/employeeAdminService.test.js src/features/employees/personnelPageContract.test.js supabase/functions/employee-admin/handler.test.js
```

Expected: tests fail because the field is not allowlisted or rendered.

- [ ] **Step 3: Implement strict boolean transport and server authorization**

Add `attendanceRequired` to `PROFILE_FIELDS`, `DETAIL_BASE_FIELDS`, and the page's `CORE_EDITABLE_FIELDS`. Normalize it without string coercion:

```js
if (key === 'attendanceRequired') {
  if (typeof value !== 'boolean') throw adminError('EMPLOYEE_ADMIN_INPUT_INVALID')
  return value
}
```

Add the same boolean validation to `validateProfileInput()` used by `employee-admin`. Extend `update_employee_profile_admin` only for this camel-case key:

```sql
attendance_required = case
  when p_patch ? 'attendanceRequired'
    then (p_patch->>'attendanceRequired')::boolean
  else profile.attendance_required
end,
attendance_policy_updated_at = case
  when p_patch ? 'attendanceRequired' then statement_timestamp()
  else profile.attendance_policy_updated_at
end,
attendance_policy_updated_by = case
  when p_patch ? 'attendanceRequired' then actor_profile.id
  else profile.attendance_policy_updated_by
end
```

The RPC must resolve `actor_profile` from `p_actor_auth_user_id`, require the existing personnel-administrator authorization, and continue writing `employee.profile_updated` with the changed field list.

- [ ] **Step 4: Add the personnel form control**

Initialize new employees with `attendanceRequired: true`, load the exact detail value on edit, and render:

```jsx
<label className="personnel-checkbox-field">
  <input
    name="attendanceRequired"
    type="checkbox"
    checked={formState.values.attendanceRequired === true}
    onChange={(event) => handleFieldChange('attendanceRequired', event.target.checked)}
  />
  <span>
    <strong>需要每日打卡</strong>
    <small>关闭后不产生缺卡异常，并按正常全勤进入月度工资。</small>
  </span>
</label>
```

Display the current mode on the employee card as `每日打卡` or `免打卡`, but do not expose a self-service toggle outside the administrator form.

- [ ] **Step 5: Run focused GREEN verification**

Run:

```bash
node --test src/services/employeeAdminService.test.js src/features/employees/personnelPageContract.test.js src/features/employees/personnelMutationPolicy.test.js supabase/functions/employee-admin/handler.test.js
npx supabase test db supabase/tests/employee_account_lifecycle.sql supabase/tests/department_attendance_modes.sql --local --workdir /private/tmp/kaobeierp-department-attendance-db
```

- [ ] **Step 6: Commit Task 2**

```bash
git add src/services/employeeAdminService.js src/services/employeeAdminService.test.js src/features/employees/PersonnelPage.jsx src/features/employees/personnelPageContract.test.js supabase/functions/employee-admin/handler.js supabase/functions/employee-admin/handler.test.js supabase/migrations/202608120001_department_attendance_modes.sql supabase/tests/department_attendance_modes.sql
git commit -m "feat: add employee attendance requirement setting"
```

---

### Task 3: Add strict v2 attendance DTOs and policy helpers

**Files:**
- Create: `src/features/attendance/attendancePolicy.js`
- Create: `src/features/attendance/attendancePolicy.test.js`
- Modify: `src/services/attendanceService.js`
- Modify: `src/services/attendanceService.test.js`
- Modify: `src/features/attendance/attendanceDomain.js`
- Modify: `src/features/attendance/attendanceDomain.test.js`

**Interfaces:**
- Consumes: Task 1 v2 JSON and RPC signatures.
- Produces: `resolveAttendanceExperience(policy, activeSession)`; service methods `clockIn(input)` and `clockOut(input)` returning `saved | confirmation_required`; normalized v2 session/event DTOs.

- [ ] **Step 1: Write failing policy and service tests**

Use literal table tests:

```js
assert.deepEqual(resolveAttendanceExperience(
  { attendanceRequired: false, attendanceMode: 'exempt' }, null,
), { kind: 'exempt' })
assert.deepEqual(resolveAttendanceExperience(
  { attendanceRequired: true, attendanceMode: 'general' }, null,
), { kind: 'general-clock-in' })
assert.deepEqual(resolveAttendanceExperience(
  { attendanceRequired: true, attendanceMode: 'project' }, projectSession,
), { kind: 'project-active', session: projectSession })
```

Service tests must assert exact calls:

```js
['clock_in_general_secure', {
  p_request_id: requestId,
  p_latitude: 35,
  p_longitude: 139,
  p_accuracy_meters: 10,
  p_device_recorded_at: deviceTime,
}]

['clock_in_project_v2_secure', {
  p_project_id: 'P001',
  p_request_id: requestId,
  p_latitude: 35,
  p_longitude: 139,
  p_accuracy_meters: 10,
  p_device_recorded_at: deviceTime,
  p_out_of_range_confirmed: false,
}]
```

Also reject: `general` session with any project field; project session with a null project field; `not_applicable` event with distance/radius; abnormal event without `outOfRangeConfirmedAt`; unknown extra response keys; NaN/Infinity; mode mismatch between policy and active session.

- [ ] **Step 2: Run RED tests**

```bash
node --test src/features/attendance/attendancePolicy.test.js src/features/attendance/attendanceDomain.test.js src/services/attendanceService.test.js
```

- [ ] **Step 3: Implement pure policy resolution**

```js
export function resolveAttendanceExperience(policy, activeSession) {
  if (policy?.attendanceRequired === false && policy?.attendanceMode === 'exempt') {
    return { kind: 'exempt' }
  }
  if (policy?.attendanceRequired !== true) throw new TypeError('invalid attendance policy')
  if (activeSession) {
    if (activeSession.attendanceMode !== policy.attendanceMode) {
      return { kind: 'policy-conflict', session: activeSession }
    }
    return {
      kind: activeSession.attendanceMode === 'project' ? 'project-active' : 'general-active',
      session: activeSession,
    }
  }
  if (policy.attendanceMode === 'project') return { kind: 'project-clock-in' }
  if (policy.attendanceMode === 'general') return { kind: 'general-clock-in' }
  throw new TypeError('invalid attendance policy')
}
```

- [ ] **Step 4: Implement exact DTO validation and mutation routing**

Replace v1 response constants with v2 keys:

```js
const POLICY_KEYS = ['attendanceRequired', 'attendanceMode']
const SESSION_KEYS = [
  'sessionId', 'attendanceMode', 'employeeProfileId',
  'employeeNumberSnapshot', 'employeeNameSnapshot',
  'projectId', 'projectNameSnapshot', 'projectAddressSnapshot',
  'projectLatitudeSnapshot', 'projectLongitudeSnapshot',
  'attendanceRadiusMetersSnapshot', 'workDate', 'status', 'openedAt',
  'closedAt', 'clockInEvent', 'clockOutEvent', 'workPoints',
]
const EVENT_KEYS = [
  'eventId', 'requestId', 'eventType', 'serverRecordedAt',
  'deviceRecordedAt', 'latitude', 'longitude', 'accuracyMeters',
  'distanceMeters', 'radiusMeters', 'result', 'abnormalReason',
  'outOfRangeConfirmedAt',
]
```

Expose this stable browser API:

```js
clockIn({ attendanceMode, projectId = null, requestId, location,
  outOfRangeConfirmed = false })
clockOut({ attendanceMode, sessionId, requestId, location,
  outOfRangeConfirmed = false })
```

Project clock-in calls `clock_in_project_v2_secure`; general clock-in calls `clock_in_general_secure`; all clock-out calls `clock_out_attendance_v2_secure`. Validate the result union before returning. Remove abnormal-reason input from new browser calls while retaining the domain normalizer only for historical read compatibility.

- [ ] **Step 5: Run focused GREEN tests**

```bash
node --test src/features/attendance/attendancePolicy.test.js src/features/attendance/attendanceDomain.test.js src/services/attendanceService.test.js src/features/attendance/attendanceLocationService.test.js
```

- [ ] **Step 6: Commit Task 3**

```bash
git add src/features/attendance/attendancePolicy.js src/features/attendance/attendancePolicy.test.js src/features/attendance/attendanceDomain.js src/features/attendance/attendanceDomain.test.js src/services/attendanceService.js src/services/attendanceService.test.js
git commit -m "feat: add department-aware attendance client contract"
```

---

### Task 4: Implement project, general, exempt, and out-of-range employee flows

**Files:**
- Create: `src/features/attendance/AttendanceOutOfRangeDialog.jsx`
- Create: `src/features/attendance/GeneralAttendanceSession.jsx`
- Modify: `src/features/attendance/AttendanceLocationAction.jsx`
- Modify: `src/features/attendance/TodayAttendancePage.jsx`
- Modify: `src/features/attendance/ActiveAttendanceSession.jsx`
- Modify: `src/features/attendance/TodayAttendanceHistory.jsx`
- Modify: `src/features/attendance/AttendanceRecordViewer.jsx`
- Modify: `src/features/attendance/todayAttendance.css`
- Modify: `src/features/attendance/todayAttendanceAppIntegration.test.js`
- Modify: `src/features/attendance/todayAttendancePageContract.test.js`

**Interfaces:**
- Consumes: Task 3 policy resolver and service union.
- Produces: one confirmation dialog; simplified general attendance UI; exempt notice; unchanged engineering work-point/photo workflow.

- [ ] **Step 1: Write failing real-render and controller tests**

Add cases that render `TodayAttendanceView` and assert:

```js
assert.equal(text(container).includes('选择打卡项目'), true) // project
assert.equal(text(container).includes('施工点位'), true)     // project active
assert.equal(text(container).includes('选择打卡项目'), false) // general
assert.equal(text(container).includes('施工点位'), false)     // general active
assert.equal(text(container).includes('已设置为免每日打卡'), true) // exempt
```

Test the confirmation flow with a fake service: first submission returns `confirmation_required`; no refresh occurs; dialog shows project/radius/distance; cancel performs no write; confirm resubmits the same request ID and same location with `outOfRangeConfirmed: true`; successful retry refreshes once. Repeat for clock-out. Assert positioning failure never opens confirmation and never calls the service.

- [ ] **Step 2: Run RED UI tests**

```bash
node --test src/features/attendance/todayAttendanceAppIntegration.test.js src/features/attendance/todayAttendancePageContract.test.js
```

- [ ] **Step 3: Make location action return a reusable submission without collecting a reason**

Remove the abnormal reason textarea from the active v2 flow. `AttendanceLocationAction` creates one request and location snapshot, calls `onSubmit`, and reports the union to its parent:

```js
const submission = { requestId: createRequestId(), location }
const result = await onSubmit(submission)
if (result.status === 'confirmation_required') {
  onConfirmationRequired?.({ submission, confirmation: result.confirmation })
  return
}
await onSuccess?.(result)
```

Do not request a second geolocation sample when the user presses “仍然打卡”; confirmation applies to the exact displayed sample and the server recalculates it.

- [ ] **Step 4: Add the focused confirmation dialog**

Render the project name, rounded distance, radius, and two actions:

```jsx
<button type="button" onClick={onCancel}>取消，重新定位</button>
<button type="button" className="primary-button" onClick={onConfirm}>
  仍然打卡
</button>
```

Use `role="dialog"`, `aria-modal="true"`, a labelled heading, focus trap, Escape-to-cancel while idle, and focus restoration to the originating clock button. Disable both actions while confirmation is being written.

- [ ] **Step 5: Branch the page by server policy**

Use `resolveAttendanceExperience(today.policy, today.activeSession)` exactly once in `TodayAttendanceView`:

- `project-clock-in`: existing picker plus location action.
- `project-active`: existing `ActiveAttendanceSession` with work points/photos.
- `general-clock-in`: location action targeting `null`, labelled `按当前位置打卡上班`.
- `general-active`: `GeneralAttendanceSession` with opened time and `按当前位置打卡下班`; no points/photos.
- `exempt`: status card explaining monthly normal-pay behavior; no clock button.
- `policy-conflict`: fail closed with “人员打卡设置已变化，请重新读取”.

History and record viewer display `公司 / 非项目` when `attendanceMode === 'general'`; they never invent a project ID. Keep the management photo viewer project-only.

- [ ] **Step 6: Add scoped responsive styling**

Add only `.attendance-page`-scoped rules for the exempt card, general session, and confirmation dialog. Desktop dialog maximum width is `520px`; mobile width is `calc(100vw - 32px)`. Preserve existing black-gold styling and minimum `44px` button height.

- [ ] **Step 7: Run focused GREEN tests**

```bash
node --test src/features/attendance/attendancePolicy.test.js src/services/attendanceService.test.js src/features/attendance/todayAttendanceAppIntegration.test.js src/features/attendance/todayAttendancePageContract.test.js src/features/attendance/attendanceLocationAttempt.test.js
```

- [ ] **Step 8: Commit Task 4**

```bash
git add src/features/attendance/AttendanceOutOfRangeDialog.jsx src/features/attendance/GeneralAttendanceSession.jsx src/features/attendance/AttendanceLocationAction.jsx src/features/attendance/TodayAttendancePage.jsx src/features/attendance/ActiveAttendanceSession.jsx src/features/attendance/TodayAttendanceHistory.jsx src/features/attendance/AttendanceRecordViewer.jsx src/features/attendance/todayAttendance.css src/features/attendance/todayAttendanceAppIntegration.test.js src/features/attendance/todayAttendancePageContract.test.js
git commit -m "feat: add department-specific attendance flows"
```

---

### Task 5: Add audited location review and company-personnel payroll semantics

**Files:**
- Create: `supabase/migrations/202608120002_attendance_location_review_and_company_payroll.sql`
- Create: `supabase/tests/attendance_location_review_and_company_payroll.sql`
- Create: `src/services/attendancePayrollSchema.test.js`
- Modify: `docs/attendance-accounting-operations.md`
- Modify: `docs/supabase-schema.md`

**Interfaces:**
- Consumes: Task 1 attendance modes/policy; existing daily resolution, project allocations, monthly payroll, and accounting audit log.
- Produces: daily `location_review_status`, `location_review_note`, reviewer/time; payroll `attendance_method_snapshot`, `company_personnel_cost`, `location_abnormal_count`, `location_review_summary`; extended accounting RPC DTOs.

- [ ] **Step 1: Write failing schema and pgTAP tests**

Create `src/services/attendancePayrollSchema.test.js` to assert the exact columns, status values, non-empty-note confirmation guard, general allocation guard, and exempt monthly branch. In pgTAP seed:

1. an engineering project day with an out-of-range event;
2. a non-engineering general day;
3. an exempt monthly employee;
4. a location-normal project day.

Assert that out-of-range confirmation fails without review, both review statuses preserve identical `attendance_units` and `final_project_cost`, general daily confirmation forces cost `0` and no allocation, exempt monthly confirmation succeeds without daily clock events/resolutions, and its base pay equals the configured full monthly amount.

- [ ] **Step 2: Run RED contracts**

```bash
node --test src/services/attendancePayrollSchema.test.js
npx supabase test db supabase/tests/attendance_location_review_and_company_payroll.sql --local --workdir /private/tmp/kaobeierp-department-attendance-db
```

- [ ] **Step 3: Add structured daily location review**

Add:

```sql
alter table public.attendance_day_resolutions
  add column location_review_status text,
  add column location_review_note text not null default '',
  add column location_reviewed_by_employee_profile_id uuid
    references public.employee_profiles(id) on delete restrict,
  add column location_reviewed_at timestamptz;
```

The check permits null review only when the day has no out-of-range fact. Confirmation RPC inputs become:

```text
p_location_review_status text
p_location_review_note text
```

When authoritative facts contain `abnormal_location`, confirmation requires status in `('confirmed_valid','recorded_abnormal')` and trimmed note length `1..2000`. When facts do not contain it, all review fields must be null/empty. Neither branch modifies `p_resolution_type`, `p_attendance_units`, or calculated project cost.

- [ ] **Step 4: Enforce project/company cost separation in the database**

Determine the day mode from authoritative sessions, not the client. For general-only facts:

```sql
if fact_mode = 'general' and (
  p_final_project_cost <> 0 or jsonb_array_length(p_allocations) <> 0
) then
  raise exception using
    errcode = '22023',
    message = 'general attendance cannot create project labor cost',
    hint = 'ATTENDANCE_GENERAL_PROJECT_COST_FORBIDDEN';
end if;
```

For project facts retain the current balanced-allocation rules. Historical days with project sessions remain project-mode even if the employee's current department changed.

- [ ] **Step 5: Add exempt payroll and company-cost snapshots**

Add payroll columns and carry the employee position into the monthly DTO:

```sql
attendance_method_snapshot text not null default 'project'
  check (attendance_method_snapshot in ('project','general','exempt')),
company_personnel_cost numeric not null default 0,
location_abnormal_count integer not null default 0,
location_review_summary text not null default ''
```

The monthly employee JSON returned by `list_monthly_payroll_secure` includes
`position` from the canonical employee profile. It is display metadata only;
confirmed money and attendance-method fields continue to come from the payroll
snapshot.

Monthly calculation rules are exact:

- `project`: existing confirmed daily-resolution and project-allocation rules.
- `general`: confirmed daily attendance drives pay; `projectAllocatedAmount = 0`, `projectUnallocatedAmount = 0`, and confirmed `netSalary` is the company-personnel cost.
- `exempt`: scheduled workdays are treated as full days for payroll readiness without creating daily resolutions; monthly salary uses the existing salary-type formula and manual overtime/bonus/deduction; project amounts are zero; `netSalary` is company-personnel cost.

Do not synthesize daily event or resolution rows for exempt employees. Snapshot the method at payroll confirmation.

- [ ] **Step 6: Extend immutable audit snapshots and response JSON**

Daily snapshots include review status, note, reviewer, and time. Monthly snapshots include attendance method, company cost, abnormal count, and summary. Ensure `recorded_abnormal` contributes a payroll remark; `confirmed_valid` is labelled as verified and does not remain in the pending count.

- [ ] **Step 7: Run focused GREEN database tests**

```bash
node --test src/services/attendancePayrollSchema.test.js
npx supabase test db supabase/tests/attendance_accounting.sql supabase/tests/attendance_location_review_and_company_payroll.sql --local --workdir /private/tmp/kaobeierp-department-attendance-db
```

- [ ] **Step 8: Commit Task 5**

```bash
git add supabase/migrations/202608120002_attendance_location_review_and_company_payroll.sql supabase/tests/attendance_location_review_and_company_payroll.sql src/services/attendancePayrollSchema.test.js docs/attendance-accounting-operations.md docs/supabase-schema.md
git commit -m "feat: add attendance review and company payroll data"
```

---

### Task 6: Add accounting review controls and company-payroll presentation

**Files:**
- Modify: `src/services/laborAccountingService.js`
- Modify: `src/services/laborAccountingService.test.js`
- Modify: `src/features/labor-accounting/AttendanceResolutionDialog.jsx`
- Modify: `src/features/labor-accounting/MonthlyPayrollTab.jsx`
- Modify: `src/features/labor-accounting/laborAccountingDomain.js`
- Modify: `src/features/labor-accounting/laborAccountingDomain.test.js`
- Modify: `src/features/labor-accounting/laborAccountingPageContract.test.js`
- Modify: `src/features/labor-accounting/laborAccounting.css`

**Interfaces:**
- Consumes: Task 5 daily/monthly DTOs.
- Produces: draft fields `locationReviewStatus`, `locationReviewNote`; monthly employee fields `position`, `attendanceMethod`, `companyPersonnelCost`, `locationAbnormalCount`, `locationReviewSummary`.

- [ ] **Step 1: Write failing DTO, blocker, payload, and render tests**

Add literal tests:

```js
assert.deepEqual(buildInitialResolutionDraft(detail), {
  resolutionType: 'full_day', attendanceUnits: 1,
  finalProjectCost: 12000, allocations: [/* existing project */],
  resolutionNote: '', locationReviewStatus: '', locationReviewNote: '', version: 0,
})

assert.deepEqual(
  resolutionConfirmBlockers(abnormalDetail, {
    ...draft, locationReviewStatus: '', locationReviewNote: '',
  }),
  ['请选择定位异常处理结果', '请填写定位异常处理备注'],
)
```

Render tests assert the two labels `确认有效` and `判定异常`, facts remain read-only, general sessions show `公司 / 非项目`, the project allocation editor is absent for general facts, and changing review status does not change resolution type, units, or amount. Monthly rows must show `项目打卡`, `非项目打卡`, or `免打卡` and company-personnel cost.

- [ ] **Step 2: Run RED tests**

```bash
node --test src/services/laborAccountingService.test.js src/features/labor-accounting/laborAccountingDomain.test.js src/features/labor-accounting/laborAccountingPageContract.test.js
```

- [ ] **Step 3: Extend strict service DTOs and exact mutation arguments**

Add review fields to compact/full resolution validators, session `attendanceMode`, nullable project identity, and monthly fields. Send:

```js
p_location_review_status: draft.locationReviewStatus || null,
p_location_review_note: draft.locationReviewNote.trim(),
```

Map `ATTENDANCE_GENERAL_PROJECT_COST_FORBIDDEN` to `非项目考勤不能计入项目人工成本`. Reject unknown enum values, extra keys, missing notes, negative company cost, and money fields returned to users without salary permission.

- [ ] **Step 4: Implement the daily accounting controls**

For `facts.issueCodes.includes('abnormal_location')`, render a dedicated fieldset before project allocation:

```jsx
<fieldset className="labor-location-review" disabled={controlsDisabled}>
  <legend>定位异常处理</legend>
  <label><input type="radio" value="confirmed_valid" />确认有效</label>
  <label><input type="radio" value="recorded_abnormal" />判定异常</label>
  <textarea aria-label="定位异常处理备注" rows="3" maxLength="2000" />
  <small>两种结论均不自动扣工资，也不改变人天和项目人工成本。</small>
</fieldset>
```

`resolutionConfirmBlockers` requires status and trimmed note only for abnormal-location facts. General-only facts force the initial and changed draft to `finalProjectCost: 0` and `allocations: []`, hide `AllocationFields`, and show `该员工工资计入公司人员成本，不进入项目成本`.

- [ ] **Step 5: Extend monthly payroll presentation**

Add attendance-method badge, location abnormal count/summary, and company-personnel cost to desktop and mobile rows. The summary adds `公司人员成本` beside existing project allocated/unallocated totals. Exempt rows show `免打卡 · 默认全勤`, and the calendar action explains that no fake daily records exist.

- [ ] **Step 6: Run focused GREEN tests**

```bash
node --test src/services/laborAccountingService.test.js src/features/labor-accounting/laborAccountingDomain.test.js src/features/labor-accounting/laborAccountingPageContract.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js
```

- [ ] **Step 7: Commit Task 6**

```bash
git add src/services/laborAccountingService.js src/services/laborAccountingService.test.js src/features/labor-accounting/AttendanceResolutionDialog.jsx src/features/labor-accounting/MonthlyPayrollTab.jsx src/features/labor-accounting/laborAccountingDomain.js src/features/labor-accounting/laborAccountingDomain.test.js src/features/labor-accounting/laborAccountingPageContract.test.js src/features/labor-accounting/laborAccounting.css
git commit -m "feat: add accounting attendance review workflow"
```

---

### Task 7: Export the filtered monthly payroll as a leadership-ready report

**Files:**
- Create: `src/features/accounting-reports/monthlyPayrollReport.js`
- Create: `src/features/accounting-reports/monthlyPayrollReport.test.js`
- Modify: `src/features/labor-accounting/MonthlyPayrollTab.jsx`
- Modify: `src/features/labor-accounting/laborAccountingPageContract.test.js`
- Modify: `src/features/accounting-reports/accountingReportExport.test.js`
- Modify: `src/features/accounting-reports/accountingReportPrintSheet.test.js`

**Interfaces:**
- Consumes: Task 6 already-filtered monthly payroll rows and the existing `AccountingReportActions`/ExcelJS/print pipeline.
- Produces: `createMonthlyPayrollReport({ employees, summary, month, department, employeeLabel, onlyPending, preparedBy, generatedAt })`.

- [ ] **Step 1: Write the failing hand-calculated report adapter test**

Use one engineering row, one general row, and one exempt row. Assert exact filter lines, record count, totals, and section names:

```js
assert.deepEqual(report.sections.map(({ sheetName }) => sheetName), [
  '工资汇总', '工资明细', '定位异常记录',
])
assert.deepEqual(report.filterLines, [
  { label: '工资月份', value: '2026-08' },
  { label: '部门', value: '全部部门' },
  { label: '员工', value: '全部员工' },
  { label: '状态', value: '全部状态' },
])
assert.deepEqual(report.summary, [
  { label: '员工人数', value: 3, format: 'number' },
  { label: '实发工资合计', value: 900000, format: 'money' },
  { label: '项目人工成本', value: 300000, format: 'money' },
  { label: '公司人员成本', value: 600000, format: 'money' },
  { label: '超范围记录', value: 1, format: 'number' },
])
```

Assert the adapter does not re-filter supplied rows, preserves numeric/date types, formula-like employee names remain readable in print, and Excel escaping occurs only at the writer boundary.

- [ ] **Step 2: Run RED adapter tests**

```bash
node --test src/features/accounting-reports/monthlyPayrollReport.test.js
```

- [ ] **Step 3: Implement the report adapter**

Create three sections:

1. `工资汇总`: project labor, company personnel, overtime, bonus, deduction, and net pay totals.
2. `工资明细`: employee number/name/department/position, attendance method, scheduled/full/half/absence days, abnormal count, base pay, overtime, bonus, deduction, net pay, project cost, company cost, status, and note.
3. `定位异常记录`: only supplied rows with `locationAbnormalCount > 0`; employee, count, review summary, and payroll note.

Use landscape A4, widths between 10 and 24, money/number/date formats, white neutral output inherited from the shared renderer, and filename `月度工资表_YYYY-MM`.

- [ ] **Step 4: Wire actions to the currently visible authoritative rows**

In `MonthlyPayrollTab`, build the report only when all are true:

```js
loadState.status === 'success'
report !== null
report.permissions.canViewSalary === true
```

Pass the already-filtered `employees` array, not the unfiltered response. Build a context identity containing month, department, employee ID, pending flag, response version identity, and output-block state so filter changes invalidate pending output:

```js
const contextIdentity = JSON.stringify({
  month, department, employeeProfileId, onlyPending,
  rows: employees.map((row) => `${row.employeeProfileId}:${row.version}`).join('|'),
})
```

Render `AccountingReportActions` above the summary cards with title `月度工资表`. Without salary-view permission, do not construct or mount a report model.

- [ ] **Step 5: Verify real Excel and print semantics**

Extend existing writer/print tests to assert: native numeric money cells; date cells; neutral fills; landscape A4; print area; repeated header; page numbers; signature area; proportional `colgroup`; long location review wraps rather than clips; three sheets round-trip through ExcelJS.

- [ ] **Step 6: Run focused GREEN tests**

```bash
node --test src/features/accounting-reports/monthlyPayrollReport.test.js src/features/accounting-reports/accountingReportModel.test.js src/features/accounting-reports/accountingReportExport.test.js src/features/accounting-reports/accountingReportPrintSheet.test.js src/features/labor-accounting/laborAccountingPageContract.test.js
```

- [ ] **Step 7: Commit Task 7**

```bash
git add src/features/accounting-reports/monthlyPayrollReport.js src/features/accounting-reports/monthlyPayrollReport.test.js src/features/labor-accounting/MonthlyPayrollTab.jsx src/features/labor-accounting/laborAccountingPageContract.test.js src/features/accounting-reports/accountingReportExport.test.js src/features/accounting-reports/accountingReportPrintSheet.test.js
git commit -m "feat: export filtered company payroll report"
```

---

### Task 8: Prove cross-module compatibility, production readiness, and deployment order

**Files:**
- Create: `src/features/attendance/departmentAttendanceEndToEnd.test.js`
- Modify: `docs/today-attendance-operations.md`
- Modify: `docs/attendance-accounting-operations.md`
- Modify: `docs/supabase-schema.md`

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces: an end-to-end regression contract, verified operations checklist, and deployment evidence; no new business behavior.

- [ ] **Step 1: Write the end-to-end regression contract**

Create a real-render/service-fake test covering this sequence:

```text
engineering project inside radius -> work point/photos -> clock-out -> project allocation
engineering project outside radius -> confirm -> accounting review -> unchanged pay/cost
general employee -> current-location in/out -> no work-point UI -> zero project allocation
exempt employee -> no clock UI/issues -> full monthly pay -> company cost
filtered monthly page -> Excel/print report uses the same visible rows and totals
```

Also add a fail-closed matrix for location denial, policy change during an open page, stale filter/export context, forbidden salary permission, repeated requests, and service failure.

- [ ] **Step 2: Run the full focused matrix**

```bash
node --test \
  src/services/departmentAttendanceSchema.test.js \
  src/services/attendancePayrollSchema.test.js \
  src/services/employeeAdminService.test.js \
  src/services/attendanceService.test.js \
  src/services/laborAccountingService.test.js \
  src/features/attendance/attendancePolicy.test.js \
  src/features/attendance/todayAttendanceAppIntegration.test.js \
  src/features/attendance/departmentAttendanceEndToEnd.test.js \
  src/features/labor-accounting/laborAccountingPageContract.test.js \
  src/features/labor-accounting/laborAccountingAppIntegration.test.js \
  src/features/accounting-reports/monthlyPayrollReport.test.js \
  src/features/accounting-reports/accountingReportExport.test.js
```

Expected: all focused tests pass with no skipped case.

- [ ] **Step 3: Run database regression in the isolated local workdir**

Refresh `/private/tmp/kaobeierp-department-attendance-db` from the repository Supabase directory, reset it, then run:

```bash
npx supabase db reset --local --workdir /private/tmp/kaobeierp-department-attendance-db
npx supabase test db supabase/tests/today_attendance.sql supabase/tests/department_attendance_modes.sql supabase/tests/attendance_accounting.sql supabase/tests/attendance_location_review_and_company_payroll.sql --local --workdir /private/tmp/kaobeierp-department-attendance-db
```

Expected: all original and new attendance/accounting pgTAP suites pass.

- [ ] **Step 4: Run full application verification**

```bash
npm test
npm run build
```

Expected: full Node suite passes; Vite production build exits `0`; only the already accepted chunk-size warning may remain.

- [ ] **Step 5: Perform browser QA using the user's active browser**

Verify at desktop `1440×1000` and mobile `390×844`:

- engineering project picker and work-point/photo workflow;
- general one-button location flow with no project fields;
- exempt notice with no clock action;
- project out-of-range dialog for in/out, cancel, and confirmed retry;
- accounting review controls and mandatory note;
- monthly project/company cost distinction;
- Excel download and print/PDF preview;
- no console error, clipped dialog, hidden primary action, or horizontal mobile overflow.

- [ ] **Step 6: Record the exact production deployment order**

Update operations docs with this mandatory order:

```text
1. Confirm a current Supabase backup and record migration versions.
2. Apply 202608120001 and verify v1 + v2 attendance RPCs.
3. Apply 202608120002 and run read-only accounting/payroll probes.
4. Deploy the verified Vercel production build.
5. Smoke-test one engineering account, one general account, one exempt account,
   one accountant account, and one salary-forbidden account.
6. Verify the main production alias and retain v1 RPCs for rollback compatibility.
```

- [ ] **Step 7: Commit Task 8**

```bash
git add src/features/attendance/departmentAttendanceEndToEnd.test.js docs/today-attendance-operations.md docs/attendance-accounting-operations.md docs/supabase-schema.md
git commit -m "test: verify department attendance payroll workflow"
```

---

## Final acceptance gate

Do not deploy until every item is true:

- The worktree contains only intentional task changes.
- Tasks 1–8 each have a passing focused test record and a coherent commit.
- Original v1 attendance and attendance-accounting pgTAP suites pass beside the new suites.
- `npm test` and `npm run build` pass from the final commit.
- General and exempt payroll cannot create project allocations at both RPC and UI layers.
- Both location-review outcomes produce identical pay, attendance units, and project cost for the same daily conclusion.
- Salary-forbidden users cannot obtain money through page state, print DOM, or Excel output.
- Production migration order, backup point, Vercel deployment URL, main alias, and smoke-test results are recorded before declaring completion.

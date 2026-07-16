# Attendance Payroll and Project Labor Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual-first labor page with a secure all-employee attendance dashboard, accountant resolution workflow, monthly payroll summary, and monthly/lifetime project labor-cost reporting.

**Architecture:** Keep `project_attendance_sessions` and events as immutable facts. Add normalized accounting settings, daily resolutions, project allocations, monthly payroll snapshots, and append-only audit rows behind SECURITY DEFINER RPCs. A new focused React feature reads strict RPC DTOs; existing accounting and owner dashboards consume one authoritative bridge summary so legacy and post-activation amounts never double count.

**Tech Stack:** React 19, Vite 6, Node test runner, Supabase JS 2, PostgreSQL/Supabase migrations, pgTAP, plain scoped CSS.

## Global Constraints

- Use server time in `Asia/Tokyo`; never trust client time for attendance classification.
- Monday through Saturday are required workdays by default; Sunday is optional and may still be worked.
- Default shift is 08:00–17:00 with a 60-minute break and an 8-hour standard day.
- Accounting units are exactly `0`, `0.5`, or `1`; actual minutes never multiply wages or project cost.
- Monthly salary base pay stays fixed; daily salary uses confirmed units; hourly salary uses 8 hours for a full day and 4 hours for a half day.
- Multi-project days require accountant-entered allocation amounts whose sum equals the confirmed daily project cost.
- Only confirmed allocations and payroll snapshots enter official totals.
- ERP-only alerting: no WeCom, email, or SMS work.
- Preserve immutable attendance facts and every existing legacy labor/salary record.
- Browser code must use secure RPCs only for this feature; no localStorage fallback and no direct table writes.
- Before an authorized user saves the activation date, return the approved default shift as an unconfigured preview and generate no historical or current missing-clock alerts.
- Reuse existing permission keys: `module.labor.*`, `module.project_costs.*`, `sensitive.salary_*`, and `module.settings.update`.
- Preserve unrelated dirty-worktree changes; stage and commit only files named by each task.

## File Map

### New files

- `src/features/labor-accounting/laborAccountingDomain.js` — deterministic day, payroll, allocation, and CSV rules.
- `src/features/labor-accounting/laborAccountingDomain.test.js` — rule matrix and CSV tests.
- `src/services/laborAccountingService.js` — strict RPC client and safe error mapping.
- `src/services/laborAccountingService.test.js` — exact RPC argument and DTO contract tests.
- `src/services/laborAccountingSchema.test.js` — migration contract and unsafe-pattern checks.
- `src/features/labor-accounting/LaborAccountingPage.jsx` — feature shell and tab orchestration.
- `src/features/labor-accounting/DailyAttendanceBoard.jsx` — date/filter/summary composition.
- `src/features/labor-accounting/AttendanceStatusTable.jsx` — desktop table and mobile cards.
- `src/features/labor-accounting/AccountingExceptionQueue.jsx` — persistent issue queue.
- `src/features/labor-accounting/AttendanceResolutionDialog.jsx` — daily resolution and allocation editor.
- `src/features/labor-accounting/MonthlyPayrollTab.jsx` — monthly employee payroll table and confirmation.
- `src/features/labor-accounting/ProjectLaborCostTab.jsx` — month/lifetime project reporting and export.
- `src/features/labor-accounting/AttendanceAccountingSettings.jsx` — schedule settings editor.
- `src/features/labor-accounting/useLaborAlertCount.js` — permission-aware focus/poll refresh.
- `src/features/labor-accounting/laborAccountingBridge.js` — authoritative summary precedence helpers.
- `src/features/labor-accounting/laborAccountingBridge.test.js` — legacy/new total precedence tests.
- `src/features/labor-accounting/laborAccountingPageContract.test.js` — JSX, copy, responsive, and permission contracts.
- `src/features/labor-accounting/laborAccountingAppIntegration.test.js` — App and menu wiring contracts.
- `src/features/labor-accounting/laborAccounting.css` — scoped responsive styling.
- `supabase/migrations/202607160001_attendance_accounting.sql` — tables, policies, helpers, RPCs, grants.
- `supabase/tests/attendance_accounting.sql` — pgTAP schema, permission, calculation, and concurrency tests.
- `docs/attendance-accounting-operations.md` — migration, verification, activation, and rollback runbook.

### Modified files

- `src/App.jsx` — replace `LaborPage`, load bridge summaries, and pass the alert hook result.
- `src/DesktopAdminShell.jsx` — display the labor alert badge.
- `src/desktopAdminShell.test.js` — badge rendering and accessibility contract.
- `docs/supabase-schema.sql` — append the production-equivalent accounting schema.
- `docs/supabase-schema.md` — document activation and permissions.
- `README.md` — link the operations runbook.

---

### Task 1: Pure attendance-accounting rules

**Files:**
- Create: `src/features/labor-accounting/laborAccountingDomain.js`
- Create: `src/features/labor-accounting/laborAccountingDomain.test.js`

**Interfaces:**
- Consumes: ISO dates, `HH:mm` shift strings, attendance sessions, salary snapshots, and allocation drafts.
- Produces: `classifyAttendanceDay(input)`, `calculatePayrollPreview(input)`, `suggestProjectCost(input)`, `validateProjectAllocations(input)`, `buildProjectLaborCsv(rows)`, and exported enum constants.

- [ ] **Step 1: Write failing classification and calculation tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ACCOUNTING_RESOLUTION_TYPES,
  buildProjectLaborCsv,
  calculatePayrollPreview,
  classifyAttendanceDay,
  suggestProjectCost,
  validateProjectAllocations,
} from './laborAccountingDomain.js'

const settings = {
  effectiveFrom: '2026-07-16',
  workWeekdays: [1, 2, 3, 4, 5, 6],
  workStartTime: '08:00',
  workEndTime: '17:00',
  breakMinutes: 60,
  standardDayMinutes: 480,
}

test('required weekdays and optional Sunday classify without inventing Sunday absence', () => {
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-18', nowTokyo: '2026-07-18T08:01:00+09:00', settings,
    sessions: [], resolution: null,
  }).issueCodes, ['missing_clock_in'])
  assert.deepEqual(classifyAttendanceDay({
    workDate: '2026-07-19', nowTokyo: '2026-07-19T12:00:00+09:00', settings,
    sessions: [], resolution: null,
  }), { scheduleRequired: false, dayStatus: 'optional_not_worked', issueCodes: [] })
})

test('salary previews use only whole and half-day units', () => {
  assert.equal(calculatePayrollPreview({ salaryType: '月薪', baseSalary: 320000,
    dailySalary: 0, hourlyWage: 0, fullDays: 20, halfDays: 2,
    overtimePay: 10000, bonus: 5000, deduction: 3000 }).netSalary, 332000)
  assert.equal(calculatePayrollPreview({ salaryType: '日薪', baseSalary: 0,
    dailySalary: 12000, hourlyWage: 0, fullDays: 20, halfDays: 1,
    overtimePay: 0, bonus: 0, deduction: 0 }).basePay, 246000)
  assert.equal(calculatePayrollPreview({ salaryType: '时薪', baseSalary: 0,
    dailySalary: 0, hourlyWage: 1500, fullDays: 2, halfDays: 1,
    overtimePay: 0, bonus: 0, deduction: 0 }).basePay, 30000)
})

test('project cost suggestions round yen and allocations must balance', () => {
  assert.equal(suggestProjectCost({ salaryType: '月薪', baseSalary: 320000,
    dailySalary: 0, hourlyWage: 0, attendanceUnits: 0.5 }), 6667)
  assert.deepEqual(validateProjectAllocations({ finalProjectCost: 10000,
    allocations: [{ projectId: 'P1', amount: 6000 }, { projectId: 'P2', amount: 4000 }] }),
  { valid: true, allocatedTotal: 10000, difference: 0 })
  assert.equal(validateProjectAllocations({ finalProjectCost: 10000,
    allocations: [{ projectId: 'P1', amount: 9999 }] }).valid, false)
})

test('CSV escapes quotes and starts with an Excel-compatible BOM', () => {
  const csv = buildProjectLaborCsv([{ projectName: '东京,"改修"', workDate: '2026-07-16',
    employeeNumber: 'SW-001', employeeName: '王强', attendanceUnits: 1, amount: 12000,
    accountingStatus: 'confirmed' }])
  assert.ok(csv.startsWith('\uFEFF项目,日期,员工编号,员工姓名,确认人天,分摊金额,状态\r\n'))
  assert.match(csv, /"东京,""改修"""/u)
})

assert.deepEqual(ACCOUNTING_RESOLUTION_TYPES,
  ['full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence'])
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test src/features/labor-accounting/laborAccountingDomain.test.js`  
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `laborAccountingDomain.js`.

- [ ] **Step 3: Implement the pure rules**

```js
export const ACCOUNTING_RESOLUTION_TYPES = Object.freeze([
  'full_day', 'half_day', 'rest', 'leave', 'comp_time', 'absence',
])
export const ATTENDANCE_ISSUE_CODES = Object.freeze([
  'missing_clock_in', 'late', 'early', 'missing_clock_out',
  'abnormal_location', 'overtime_pending',
])

const yen = (value) => Math.round(Number(value) || 0)
const units = (fullDays, halfDays) => (Number(fullDays) || 0) + (Number(halfDays) || 0) * 0.5

export function calculatePayrollPreview(input) {
  const attendanceUnits = units(input.fullDays, input.halfDays)
  const basePay = input.salaryType === '月薪'
    ? yen(input.baseSalary)
    : input.salaryType === '日薪'
      ? yen(attendanceUnits * (Number(input.dailySalary) || 0))
      : input.salaryType === '时薪'
        ? yen(((Number(input.fullDays) || 0) * 8 + (Number(input.halfDays) || 0) * 4) *
          (Number(input.hourlyWage) || 0))
        : 0
  const netSalary = basePay + yen(input.overtimePay) + yen(input.bonus) - yen(input.deduction)
  return { attendanceUnits, basePay, netSalary, valid: netSalary >= 0 }
}

export function suggestProjectCost(input) {
  const fullDay = input.salaryType === '月薪'
    ? yen((Number(input.baseSalary) || 0) / 24)
    : input.salaryType === '日薪'
      ? yen(input.dailySalary)
      : input.salaryType === '时薪'
        ? yen((Number(input.hourlyWage) || 0) * 8)
        : 0
  return yen(fullDay * Number(input.attendanceUnits || 0))
}

export function validateProjectAllocations({ finalProjectCost, allocations }) {
  const duplicate = new Set(allocations.map((item) => item.projectId)).size !== allocations.length
  const invalid = allocations.some((item) => !item.projectId || !Number.isInteger(Number(item.amount)) || Number(item.amount) < 0)
  const allocatedTotal = allocations.reduce((total, item) => total + Number(item.amount || 0), 0)
  const difference = yen(finalProjectCost) - allocatedTotal
  return { valid: !duplicate && !invalid && difference === 0, allocatedTotal, difference }
}
```

Implement `classifyAttendanceDay` with ISO weekday calculation, settings activation, resolution precedence, first clock-in/last clock-out comparisons, abnormal event scanning, and issue ordering exactly as the tests declare. Implement CSV with CRLF rows, integer yen, and RFC 4180 quote escaping.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test src/features/labor-accounting/laborAccountingDomain.test.js`  
Expected: all domain tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/features/labor-accounting/laborAccountingDomain.js src/features/labor-accounting/laborAccountingDomain.test.js
git commit -m "feat: add labor accounting domain rules"
```

### Task 2: Accounting tables, constraints, audit, and closed direct access

**Files:**
- Create: `supabase/migrations/202607160001_attendance_accounting.sql`
- Create: `supabase/tests/attendance_accounting.sql`
- Create: `src/services/laborAccountingSchema.test.js`

**Interfaces:**
- Consumes: `employee_profiles`, `projects`, `project_attendance_sessions`, `project_attendance_events`, existing permission helpers.
- Produces: five normalized tables, `private.current_attendance_accountant()`, immutable audit behavior, restrictive RLS, and the settings row.

- [ ] **Step 1: Write failing schema-contract tests**

```js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migration = await readFile(new URL('../../supabase/migrations/202607160001_attendance_accounting.sql', import.meta.url), 'utf8').catch(() => '')

test('accounting migration defines normalized tables and secure boundaries', () => {
  for (const table of ['attendance_accounting_settings', 'attendance_day_resolutions',
    'attendance_project_allocations', 'attendance_monthly_payrolls',
    'attendance_accounting_audit_log']) {
    assert.match(migration, new RegExp(`create table public\\.${table}`))
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`))
  }
  assert.match(migration, /unique\s*\(employee_profile_id,\s*work_date\)/u)
  assert.match(migration, /attendance_units[^;]+0\.5/u)
  assert.match(migration, /settings_key[^;]+default/u)
  assert.doesNotMatch(migration, /grant\s+(insert|update|delete).*authenticated/iu)
})
```

Start pgTAP with concrete table and privilege assertions:

```sql
begin;
select plan(18);
select has_table('public', 'attendance_accounting_settings');
select has_table('public', 'attendance_day_resolutions');
select has_table('public', 'attendance_project_allocations');
select has_table('public', 'attendance_monthly_payrolls');
select has_table('public', 'attendance_accounting_audit_log');
select ok(not has_table_privilege('authenticated', 'public.attendance_day_resolutions', 'INSERT'),
  'authenticated cannot insert resolutions directly');
select ok(not has_table_privilege('authenticated', 'public.attendance_project_allocations', 'UPDATE'),
  'authenticated cannot update allocations directly');
select ok(not has_table_privilege('authenticated', 'public.attendance_monthly_payrolls', 'DELETE'),
  'authenticated cannot delete payroll directly');
select ok(not has_table_privilege('authenticated', 'public.attendance_accounting_audit_log', 'INSERT'),
  'authenticated cannot forge audit rows');
select * from finish();
rollback;
```

- [ ] **Step 2: Run schema tests and verify RED**

Run: `node --test src/services/laborAccountingSchema.test.js`  
Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Implement DDL and security primitives**

Create all five tables with the exact columns and checks from the approved design. Use UUID primary keys via `gen_random_uuid()`, integer-yen checks (`amount = trunc(amount)`), foreign keys with `ON DELETE RESTRICT`, `version >= 1`, and timestamp defaults from `statement_timestamp()`.

Add these exact controls:

```sql
create or replace function private.current_attendance_accountant()
returns public.employee_profiles
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare actor public.employee_profiles%rowtype;
begin
  select employee.* into actor
  from public.employee_profiles employee
  where employee.auth_user_id = auth.uid()
    and employee.employment_status = '在职'
    and employee.account_status = 'active'
    and employee.must_change_password = false
    and employee.deleted_at is null;
  if not found or not public.has_current_permission('module.labor.view') then
    raise exception using errcode = '42501', message = 'labor accountant required';
  end if;
  return actor;
end;
$$;
```

Revoke PUBLIC/anon/authenticated access to private helpers. Enable and force RLS on all five tables. Grant table SELECT only to `service_role`; grant no direct browser DML. Do not seed a row with a forged updater identity. When no settings row exists, read RPCs return `{configured:false,effectiveFrom:null,workWeekdays:[1,2,3,4,5,6],workStartTime:'08:00',workEndTime:'17:00',breakMinutes:60,standardDayMinutes:480}` and suppress generated missing-clock alerts. The first authorized settings save inserts the single `settings_key='default'` row with the real actor ID.

- [ ] **Step 4: Run focused Node and pgTAP tests**

Run: `node --test src/services/laborAccountingSchema.test.js`  
Expected: PASS.

Run after local reset: `npx supabase test db supabase/tests/attendance_accounting.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db`  
Expected: all initial schema pgTAP assertions PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add supabase/migrations/202607160001_attendance_accounting.sql supabase/tests/attendance_accounting.sql src/services/laborAccountingSchema.test.js
git commit -m "feat: add attendance accounting schema"
```

### Task 3: Daily dashboard and alert RPCs

**Files:**
- Modify: `supabase/migrations/202607160001_attendance_accounting.sql`
- Modify: `supabase/tests/attendance_accounting.sql`
- Modify: `src/services/laborAccountingSchema.test.js`

**Interfaces:**
- Consumes: settings, active employee profiles, immutable attendance sessions/events, existing resolutions.
- Produces: `get_labor_alert_count_secure()` and `list_daily_attendance_dashboard_secure(date)` returning camelCase JSON.

- [ ] **Step 1: Add failing pgTAP cases for day classification and permission trimming**

Seed an accountant with `module.labor.view`, a viewer without it, a Saturday, a Sunday, normal/late/abnormal/open sessions, and a leave resolution. Assert:

```sql
select is(
  (public.list_daily_attendance_dashboard_secure('2026-07-18'::date)->'summary'->>'missingClockIn')::integer,
  1,
  'Saturday missing clock-in is an alert'
);
select is(
  (public.list_daily_attendance_dashboard_secure('2026-07-19'::date)->'summary'->>'missingClockIn')::integer,
  0,
  'Sunday absence is optional'
);
select throws_ok(
  $$select public.list_daily_attendance_dashboard_secure('2026-07-18'::date)$$,
  '42501', 'labor accountant required',
  'viewer without labor permission is denied'
);
```

Add a source-contract assertion for both exact SECURITY DEFINER signatures, explicit `search_path`, revoked PUBLIC execute, and grants only to `authenticated` and `service_role`.

- [ ] **Step 2: Run pgTAP and verify RED**

Run: `npx supabase test db supabase/tests/attendance_accounting.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db`  
Expected: FAIL because dashboard RPCs are missing.

- [ ] **Step 3: Implement server-side classification and read DTOs**

Implement private helpers:

```sql
private.attendance_accounting_settings_json() returns jsonb
private.attendance_issue_codes(employee_profile_id uuid, work_date date, now_tokyo timestamp) returns text[]
private.attendance_dashboard_employee_json(employee_profile_id uuid, work_date date, can_view_salary boolean) returns jsonb
```

`list_daily_attendance_dashboard_secure` must:

1. call `private.current_attendance_accountant()`;
2. reject null dates; dates before `effective_from` and all dates while settings are unconfigured produce no generated missing alerts;
3. select employees whose employment interval includes the requested date;
4. compute schedule-required from ISO weekday;
5. include all same-date sessions and event summaries;
6. let confirmed rest/leave/comp-time suppress missing-clock alerts;
7. emit issue codes in this order: abnormal location, missing clock-in, missing clock-out, late, early, overtime pending;
8. omit every salary value unless `sensitive.salary_view` is effective;
9. return `{ workDate, serverNowTokyo, settings, permissions, summary, filters, employees }` with stable keys.

The `permissions` object is exactly:

```json
{
  "canResolve": true,
  "canViewSalary": true,
  "canUpdateSalary": true,
  "canViewProjectCosts": true,
  "canUpdateProjectCosts": true,
  "canUpdateSettings": false
}
```

`get_labor_alert_count_secure()` calls the dashboard helper for the server Tokyo date and returns `{workDate, count, refreshedAt}`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the schema Node test and focused pgTAP file.  
Expected: exact RPC contract and Saturday/Sunday/permission assertions PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add supabase/migrations/202607160001_attendance_accounting.sql supabase/tests/attendance_accounting.sql src/services/laborAccountingSchema.test.js
git commit -m "feat: add attendance dashboard RPCs"
```

### Task 4: Resolution, payroll, project-cost, settings, and bridge RPCs

**Files:**
- Modify: `supabase/migrations/202607160001_attendance_accounting.sql`
- Modify: `supabase/tests/attendance_accounting.sql`
- Modify: `src/services/laborAccountingSchema.test.js`

**Interfaces:**
- Produces: all remaining RPCs named in the design plus `get_attendance_accounting_bridge_secure(date)`.
- Guarantees: atomic confirmation, version conflicts, audit rows, permission checks, month locks, legacy/new activation partitioning.

- [ ] **Step 1: Write failing pgTAP workflow and concurrency tests**

Add concrete tests for:

```sql
select throws_ok(
  $$select public.confirm_attendance_resolution_secure(
    '52000000-0000-4000-8000-000000000001', '2026-07-18',
    'full_day', 1, 12000, '[]'::jsonb, '', 1
  )$$,
  '22023', 'project allocations do not balance',
  'unbalanced allocation is rejected'
);
select throws_ok(
  $$select public.confirm_monthly_payroll_secure(
    '52000000-0000-4000-8000-000000000001', '2026-07-01', 0, 0, 0, '', 1
  )$$,
  '55000', 'monthly payroll has unresolved attendance',
  'month confirmation requires resolved workdays'
);
```

Also assert: salary viewer cannot update, labor updater without salary update cannot change money, project-cost updater is required for allocations, a stale `version` gets hint `ATTENDANCE_ACCOUNTING_VERSION_CONFLICT`, confirmation writes exactly one audit row, double confirmation is idempotent, reopening requires a non-empty reason, and direct event rows remain unchanged.
Assert that settings changes never rewrite confirmed day/payroll snapshots, and that `effective_from` cannot be moved after the first confirmed resolution without an explicit database migration.

- [ ] **Step 2: Run focused pgTAP and verify RED**

Run the focused pgTAP file.  
Expected: FAIL on missing write/report RPCs.

- [ ] **Step 3: Implement exact secure RPC surface**

Implement:

```text
get_attendance_resolution_detail_secure(uuid,date)
save_attendance_resolution_draft_secure(uuid,date,text,numeric,numeric,jsonb,text,integer)
confirm_attendance_resolution_secure(uuid,date,text,numeric,numeric,jsonb,text,integer)
list_monthly_payroll_secure(date,text,uuid,boolean)
save_monthly_payroll_draft_secure(uuid,date,numeric,numeric,numeric,text,integer)
confirm_monthly_payroll_secure(uuid,date,numeric,numeric,numeric,text,integer)
reopen_monthly_payroll_secure(uuid,text,integer)
list_project_labor_costs_secure(date,text,uuid,text)
export_project_labor_costs_secure(date,text,uuid)
get_attendance_accounting_settings_secure()
update_attendance_accounting_settings_secure(date,smallint[],time,time,integer,integer,integer)
get_attendance_accounting_bridge_secure(date)
```

Every write RPC calls `private.current_attendance_accountant()`, checks the exact permission combination, locks the target rows, validates `version`, derives salary snapshots from `employee_profiles`, computes suggested cost server-side, replaces allocation drafts transactionally, validates the allocation sum, appends audit JSON, and returns the freshly read DTO.

Bridge JSON must be:

```json
{
  "salaryMonth": "2026-07",
  "isAuthoritative": true,
  "salaryTotal": 3200000,
  "projectLaborTotal": 1756000,
  "projectLaborById": {"P001": 842000},
  "pendingCount": 3,
  "effectiveFrom": "2026-07-16"
}
```

For dates/months before activation, aggregate legacy JSONB rows. On/after activation, aggregate confirmed normalized rows and expose legacy post-activation rows only as reconciliation counts. Revoke PUBLIC execute and grant each public RPC only to `authenticated` and `service_role`.

- [ ] **Step 4: Run schema, pgTAP, and full database tests**

Run:

```bash
node --test src/services/laborAccountingSchema.test.js
npx supabase db reset --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db supabase/tests/attendance_accounting.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
```

Expected: focused schema/pgTAP and the full existing pgTAP suite PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add supabase/migrations/202607160001_attendance_accounting.sql supabase/tests/attendance_accounting.sql src/services/laborAccountingSchema.test.js
git commit -m "feat: add labor accounting workflows"
```

### Task 5: Strict frontend RPC service

**Files:**
- Create: `src/services/laborAccountingService.js`
- Create: `src/services/laborAccountingService.test.js`

**Interfaces:**
- Consumes: RPC JSON from Tasks 3–4.
- Produces: `createLaborAccountingService(client, options)` and singleton `laborAccountingService` with the exact method names below.

- [ ] **Step 1: Write failing service tests**

Test exact RPC calls:

```js
await service.listDailyDashboard({ workDate: '2026-07-18' })
await service.confirmResolution({
  employeeProfileId, workDate: '2026-07-18', resolutionType: 'full_day',
  attendanceUnits: 1, finalProjectCost: 12000,
  allocations: [{ projectId: 'P001', amount: 12000, allocationNote: '' }],
  resolutionNote: '', version: 1,
})
assert.deepEqual(calls[0], ['list_daily_attendance_dashboard_secure',
  { p_work_date: '2026-07-18' }])
assert.deepEqual(calls[1], ['confirm_attendance_resolution_secure', {
  p_employee_profile_id: employeeProfileId,
  p_work_date: '2026-07-18', p_resolution_type: 'full_day',
  p_attendance_units: 1, p_final_project_cost: 12000,
  p_allocations: [{ projectId: 'P001', amount: 12000, allocationNote: '' }],
  p_resolution_note: '', p_version: 1,
}])
```

Also test that missing/extra DTO fields, invalid issue codes, non-integer yen, invalid units, malformed project maps, private database messages, direct `.from(` usage, localStorage, and console logging all fail the contract.

- [ ] **Step 2: Run service test and verify RED**

Run: `node --test src/services/laborAccountingService.test.js`  
Expected: FAIL because the service file is missing.

- [ ] **Step 3: Implement strict validators and service methods**

Export methods:

```text
getAlertCount()
listDailyDashboard({workDate})
getResolutionDetail({employeeProfileId,workDate})
saveResolutionDraft(payload)
confirmResolution(payload)
listMonthlyPayroll({month,department,employeeProfileId,onlyPending})
saveMonthlyPayrollDraft(payload)
confirmMonthlyPayroll(payload)
reopenMonthlyPayroll({payrollId,reason,version})
listProjectLaborCosts({month,projectId,employeeProfileId,status})
exportProjectLaborCosts({month,projectId,employeeProfileId})
getSettings()
updateSettings(payload)
getBridgeSummary({month})
```

Use exact-object validators, UUID/ISO date/month/time validators, finite integer-yen validators, enum sets from the domain module, and safe error codes:

```js
const SAFE_ERRORS = Object.freeze({
  ATTENDANCE_ACCOUNTING_VERSION_CONFLICT: '记录已被其他人更新，请刷新后重试',
  ATTENDANCE_ACCOUNTING_ALLOCATION_UNBALANCED: '项目分摊金额与确认人工成本不一致',
  ATTENDANCE_ACCOUNTING_SALARY_REQUIRED: '员工工资标准未设置，请先到人员管理补充',
  ATTENDANCE_ACCOUNTING_OPEN_SESSION: '员工仍在打卡中，暂不能确认当日核算',
  ATTENDANCE_ACCOUNTING_MONTH_INCOMPLETE: '本月仍有未处理考勤，暂不能确认工资',
  ATTENDANCE_ACCOUNTING_MONTH_LOCKED: '该月份工资已经确认，请先重新打开',
})
```

Public service methods accept months as `YYYY-MM`; convert them to `YYYY-MM-01` only in RPC arguments and convert server month dates back to `YYYY-MM` in validated DTOs. The validator for daily dashboards requires the exact `permissions` keys defined in Task 3.

- [ ] **Step 4: Run service and existing attendance service tests**

Run: `node --test src/services/laborAccountingService.test.js src/services/attendanceService.test.js`  
Expected: both files PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/services/laborAccountingService.js src/services/laborAccountingService.test.js
git commit -m "feat: add labor accounting service"
```

### Task 6: Daily dashboard and resolution workflow UI

**Files:**
- Create: `src/features/labor-accounting/LaborAccountingPage.jsx`
- Create: `src/features/labor-accounting/DailyAttendanceBoard.jsx`
- Create: `src/features/labor-accounting/AttendanceStatusTable.jsx`
- Create: `src/features/labor-accounting/AccountingExceptionQueue.jsx`
- Create: `src/features/labor-accounting/AttendanceResolutionDialog.jsx`
- Create: `src/features/labor-accounting/laborAccounting.css`
- Create: `src/features/labor-accounting/laborAccountingPageContract.test.js`

**Interfaces:**
- Consumes: Task 5 service and dashboard/resolution DTOs.
- Produces: default daily board, filters, persistent exception queue, read-only facts, draft and confirm actions.

- [ ] **Step 1: Write failing JSX and static-render contracts**

Use Vite SSR loading as the attendance feature tests do, and assert:

```js
const markup = render(DailyAttendanceBoard, { dashboard, filters, onFiltersChange() {}, onOpenResolution() {} })
assert.match(markup, /今日应出勤/u)
assert.match(markup, /异常待处理/u)
assert.match(markup, /所有在职员工/u)
assert.match(markup, /未打卡/u)
assert.match(markup, /只看待处理/u)

const dialogMarkup = render(AttendanceResolutionDialog, {
  detail, draft, saving: false, error: '', onChange() {}, onSaveDraft() {}, onConfirm() {}, onClose() {},
})
assert.match(dialogMarkup, /原始打卡事实/u)
assert.match(dialogMarkup, /整天/u)
assert.match(dialogMarkup, /半天/u)
assert.match(dialogMarkup, /项目分摊金额/u)
assert.doesNotMatch(dialogMarkup, /修改打卡时间/u)
```

Check every new JSX file compiles, every form control has a label, the dialog has `role="dialog"` and `aria-modal="true"`, and CSS includes a narrow breakpoint that turns the desktop table into employee cards without horizontal overflow.

- [ ] **Step 2: Run component contract and verify RED**

Run: `node --test src/features/labor-accounting/laborAccountingPageContract.test.js`  
Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the daily feature vertically**

`LaborAccountingPage` owns `{activeTab, workDate, dashboard, loadState, selectedEmployee}` and injects the service for tests. `DailyAttendanceBoard` remains presentational. `AttendanceResolutionDialog` keeps a local draft with only:

```js
{
  resolutionType: 'full_day',
  attendanceUnits: 1,
  finalProjectCost: detail.suggestedProjectCost,
  allocations: detail.suggestedAllocations,
  resolutionNote: '',
  version: detail.resolution?.version ?? 0,
}
```

Disable confirm when a session is open, salary is missing, units do not match the resolution type, allocations do not balance, or a request is in flight. After successful save/confirm, close the dialog and reload the selected date; on `authInvalid`, call `onAuthInvalid`.

Style only under `.labor-accounting-page`; match existing black/gold shell and white content cards. Use text plus status dots so color is never the only signal.

- [ ] **Step 4: Run contract, service, and build**

Run:

```bash
node --test src/features/labor-accounting/laborAccountingPageContract.test.js src/services/laborAccountingService.test.js
npm run build
```

Expected: focused tests PASS and Vite build completes.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/features/labor-accounting/LaborAccountingPage.jsx src/features/labor-accounting/DailyAttendanceBoard.jsx src/features/labor-accounting/AttendanceStatusTable.jsx src/features/labor-accounting/AccountingExceptionQueue.jsx src/features/labor-accounting/AttendanceResolutionDialog.jsx src/features/labor-accounting/laborAccounting.css src/features/labor-accounting/laborAccountingPageContract.test.js
git commit -m "feat: build daily labor accounting board"
```

### Task 7: Monthly payroll, project costs, settings, and CSV export UI

**Files:**
- Create: `src/features/labor-accounting/MonthlyPayrollTab.jsx`
- Create: `src/features/labor-accounting/ProjectLaborCostTab.jsx`
- Create: `src/features/labor-accounting/AttendanceAccountingSettings.jsx`
- Modify: `src/features/labor-accounting/LaborAccountingPage.jsx`
- Modify: `src/features/labor-accounting/laborAccounting.css`
- Modify: `src/features/labor-accounting/laborAccountingPageContract.test.js`

**Interfaces:**
- Consumes: Task 5 monthly/project/settings methods and Task 1 CSV generator.
- Produces: the three remaining approved tabs and authorized export.

- [ ] **Step 1: Add failing tab contracts**

Assert rendered copies and values:

```js
assert.match(render(MonthlyPayrollTab, monthlyProps), /月度工资/u)
assert.match(render(MonthlyPayrollTab, monthlyProps), /整天/u)
assert.match(render(MonthlyPayrollTab, monthlyProps), /半天/u)
assert.match(render(MonthlyPayrollTab, monthlyProps), /实发工资/u)
assert.match(render(ProjectLaborCostTab, projectProps), /项目开工至今累计/u)
assert.match(render(ProjectLaborCostTab, projectProps), /全部项目费用对比/u)
assert.match(render(ProjectLaborCostTab, projectProps), /导出项目用工明细/u)
assert.match(render(AttendanceAccountingSettings, settingsProps), /周一/u)
assert.match(render(AttendanceAccountingSettings, settingsProps), /周六/u)
assert.match(render(AttendanceAccountingSettings, settingsProps), /08:00/u)
```

Also assert salary controls do not render when `permissions.canViewSalary` is false, the project tab does not render when `canViewProjectCosts` is false, employee-level project amounts require salary view, and settings fields are disabled without `canUpdateSettings`.

- [ ] **Step 2: Run contract test and verify RED**

Run the page contract test.  
Expected: FAIL on missing tab components.

- [ ] **Step 3: Implement remaining tabs**

Monthly payroll: month/department/employee/pending filters, five summary metrics, employee rows, overtime/bonus/deduction draft inputs, confirm and reopen actions with required reason.

Project costs: month/project/employee/status filters, four approved metrics, six-month bars, employee composition, daily allocation table, all-project comparison, source labels for legacy versus attendance-confirmed rows, reconciliation counts for post-activation legacy rows, and CSV export. Generate a Blob from `buildProjectLaborCsv`, create a temporary object URL, click an `<a download="项目用工费用-YYYY-MM.csv">`, and always revoke the URL.

Settings: `effectiveFrom`, weekday checkboxes, start/end native time fields, break minutes, standard day minutes, save status, and server-version conflict handling. Default selected weekdays must be Monday–Saturday, never Sunday.

- [ ] **Step 4: Run focused tests and build**

Run the domain, service, page contract tests and `npm run build`.  
Expected: all PASS.

- [ ] **Step 5: Commit Task 7**

```bash
git add src/features/labor-accounting/MonthlyPayrollTab.jsx src/features/labor-accounting/ProjectLaborCostTab.jsx src/features/labor-accounting/AttendanceAccountingSettings.jsx src/features/labor-accounting/LaborAccountingPage.jsx src/features/labor-accounting/laborAccounting.css src/features/labor-accounting/laborAccountingPageContract.test.js
git commit -m "feat: add payroll and project labor reports"
```

### Task 8: App route, menu badge, and alert refresh

**Files:**
- Create: `src/features/labor-accounting/useLaborAlertCount.js`
- Modify: `src/App.jsx`
- Modify: `src/DesktopAdminShell.jsx`
- Modify: `src/desktopAdminShell.test.js`
- Create: `src/features/labor-accounting/laborAccountingAppIntegration.test.js`

**Interfaces:**
- Consumes: current employee permissions and Task 5 singleton service.
- Produces: the new page at `currentView === 'labor'`, badge refresh on login/focus/confirmation/five-minute interval.

- [ ] **Step 1: Write failing integration contracts**

```js
assert.match(appSource, /import LaborAccountingPage from '.\/features\/labor-accounting\/LaborAccountingPage\.jsx'/u)
assert.match(appSource, /currentView === 'labor'[\s\S]*<LaborAccountingPage/u)
assert.doesNotMatch(appSource, /currentView === 'labor'[\s\S]{0,500}<LaborPage/u)
assert.match(shellSource, /laborAlertCount/u)
assert.match(shellSource, /aria-label=.*人工记录.*待处理/u)
```

Add a static shell render with `laborAlertCount={3}` and assert visible `3`; render with `0` and assert no badge. Test hook helpers so a failed refresh preserves the previous successful count and marks it stale instead of returning zero.

- [ ] **Step 2: Run integration tests and verify RED**

Run: `node --test src/features/labor-accounting/laborAccountingAppIntegration.test.js src/desktopAdminShell.test.js`  
Expected: FAIL on missing wiring.

- [ ] **Step 3: Implement route and alert lifecycle**

Replace only the `currentView === 'labor'` branch with:

```jsx
<LaborAccountingPage
  currentUser={currentUser}
  onBack={() => setCurrentView('home')}
  onAuthInvalid={onLogout}
  onAlertCountChange={refreshLaborAlertCount}
/>
```

`useLaborAlertCount` must skip requests without `module.labor.view`, refresh immediately, subscribe to `window.focus`, poll every `300000` ms, clean up both listener and timer, and return `{count, stale, refresh}`. Pass `count` to `DesktopAdminShell`; render the badge only on the `labor` menu item and only when `count > 0`.

Do not delete the old `LaborPage` function in this task; leaving dead code avoids a risky unrelated rewrite. The integration test must prove it is no longer routed.

- [ ] **Step 4: Run integration, full Node tests, and build**

Run focused integration tests, then `npm test`, then `npm run build`.  
Expected: all Node tests and build PASS.

- [ ] **Step 5: Commit Task 8**

```bash
git add src/App.jsx src/DesktopAdminShell.jsx src/desktopAdminShell.test.js src/features/labor-accounting/useLaborAlertCount.js src/features/labor-accounting/laborAccountingAppIntegration.test.js
git commit -m "feat: route labor dashboard and alerts"
```

### Task 9: Authoritative accounting bridge and legacy partition

**Files:**
- Create: `src/features/labor-accounting/laborAccountingBridge.js`
- Create: `src/features/labor-accounting/laborAccountingBridge.test.js`
- Modify: `src/App.jsx`
- Modify: `src/features/labor-accounting/laborAccountingAppIntegration.test.js`

**Interfaces:**
- Consumes: Task 4 bridge DTO, legacy in-memory records, requested month/project.
- Produces: no-double-count totals for accounting, project gross profit, and owner dashboard.

- [ ] **Step 1: Write failing bridge precedence tests**

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMonthlySalaryTotal, resolveProjectLaborTotal } from './laborAccountingBridge.js'

test('authoritative post-activation bridge replaces legacy totals', () => {
  const bridge = { isAuthoritative: true, salaryMonth: '2026-07', salaryTotal: 3200000,
    projectLaborById: { P001: 842000 } }
  assert.equal(resolveMonthlySalaryTotal({ month: '2026-07', legacyTotal: 999999, bridge }), 3200000)
  assert.equal(resolveProjectLaborTotal({ projectId: 'P001', legacyTotal: 999999, bridge }), 842000)
})

test('missing or non-authoritative bridge preserves legacy behavior', () => {
  assert.equal(resolveMonthlySalaryTotal({ month: '2026-06', legacyTotal: 900000, bridge: null }), 900000)
  assert.equal(resolveProjectLaborTotal({ projectId: 'P001', legacyTotal: 120000, bridge: { isAuthoritative: false } }), 120000)
})
```

- [ ] **Step 2: Run bridge test and verify RED**

Run the bridge test.  
Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement bridge and App consumption**

Implement the two pure precedence helpers plus `normalizeBridgeSummary`. In `App.jsx`, load the bridge only when the current view is `accounting`, `dashboard`, or `projects`, and only for the visible month. Preserve the last successful bridge during refresh; display an existing-page warning when stale.

Feed the resolved salary total into `getLaborAllocationInfo`, and the resolved per-project labor amount into project cost/gross-profit calculations. Do not add bridge totals on top of legacy labor; choose exactly one authoritative source per helper call.

- [ ] **Step 4: Run bridge, integration, accounting, dashboard, and build tests**

Run:

```bash
node --test src/features/labor-accounting/laborAccountingBridge.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/dashboardLayout.test.js
npm test
npm run build
```

Expected: focused and full Node suites PASS; build completes.

- [ ] **Step 5: Commit Task 9**

```bash
git add src/features/labor-accounting/laborAccountingBridge.js src/features/labor-accounting/laborAccountingBridge.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/App.jsx
git commit -m "feat: bridge confirmed labor costs into accounting"
```

### Task 10: Baseline schema docs, operations, and end-to-end verification

**Files:**
- Modify: `docs/supabase-schema.sql`
- Modify: `docs/supabase-schema.md`
- Create: `docs/attendance-accounting-operations.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: completed migration and UI.
- Produces: deployable baseline, activation runbook, rollback boundaries, and fresh verification evidence.

- [ ] **Step 1: Add failing documentation contracts**

Extend `laborAccountingSchema.test.js` to require the baseline schema to contain all accounting tables/RPCs and require the runbook to contain these literal commands:

```text
npm test
npm run build
npx supabase db reset --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db supabase/tests/attendance_accounting.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
```

Require sections named “启用日期”, “权限矩阵”, “历史数据核对”, “回滚边界”, and “验收清单”.

- [ ] **Step 2: Run documentation contract and verify RED**

Run the schema test.  
Expected: FAIL because baseline/runbook updates are missing.

- [ ] **Step 3: Update baseline and write the runbook**

Append the migration-equivalent schema to `docs/supabase-schema.sql` in dependency order. Document permission combinations, activation partition, Sunday behavior, CSV export, and no local fallback in `docs/supabase-schema.md`.

The runbook must instruct operators to:

1. back up and count legacy `labor_records`/`salary_records`;
2. apply migration `202607160001` after the existing attendance migration;
3. grant accountant templates the exact labor/project-cost/salary permissions;
4. choose an activation date and review post-activation legacy reconciliation rows;
5. run Node, build, reset, focused pgTAP, and full pgTAP commands;
6. verify SW-000, accountant, labor viewer without salary permission, ordinary employee, disabled employee, Sunday optional, Saturday missing, multi-project balance, month lock, and stale conflict in the browser;
7. roll back the frontend without dropping normalized data; never roll back by deleting attendance facts or audit rows.

- [ ] **Step 4: Run full automated verification**

Run:

```bash
npm test
npm run build
npx supabase db reset --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db supabase/tests/attendance_accounting.sql --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
npx supabase test db --local --workdir /private/tmp/kaobeierp-attendance-accounting-db
```

Expected: every command exits 0.

- [ ] **Step 5: Perform browser acceptance**

At the existing local app URL, verify desktop and narrow mobile widths:

- all active employees appear on a Saturday;
- Sunday without sessions is optional, not red;
- an unclocked Saturday employee appears in the persistent exception queue and menu badge;
- a confirmed leave removes the missing alert;
- multi-project confirmation is blocked until allocations balance;
- month payroll shows whole/half-day counts and confirms only after all issues resolve;
- project tab shows selected-month and lifetime totals and downloads a readable CSV;
- a labor viewer without salary permission cannot see individual wage amounts;
- the existing “今日打卡” employee flow still clocks in/out and shows photos.

- [ ] **Step 6: Commit Task 10**

```bash
git add docs/supabase-schema.sql docs/supabase-schema.md docs/attendance-accounting-operations.md README.md src/services/laborAccountingSchema.test.js
git commit -m "docs: add attendance accounting operations"
```

- [ ] **Step 7: Request final code review and verify the resulting diff**

Run `git status --short`, `git diff --stat HEAD~10..HEAD`, and the verification commands again after addressing review findings. Confirm unrelated pre-existing dirty files remain untouched and unstaged.

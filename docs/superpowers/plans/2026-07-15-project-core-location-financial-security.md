# Project Core, Location, Financial Security, and Session Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Build secure project master data with seven lifecycle states, canonical design/site assignees, manually confirmed map coordinates, a fixed server-side financial whitelist, and authenticated-session-only project/revenue state.

**Architecture:** Pure project-domain and geocoding modules own validation, snapshots, address staleness, throttling, and caching; an imperative Leaflet component owns the short-lived map instance, while ProjectPage owns only form/list interaction. PostgreSQL SECURITY DEFINER RPCs become the only browser boundary for project rows, fixed database predicates protect project financial data and contract-revenue tables, and React state replaces cross-account localStorage caches.

**Tech Stack:** React 19, Vite 6, Leaflet 1.9.4, Nominatim search adapter, Japan GSI tiles, Supabase JS 2.x, PostgreSQL migrations/RLS/SECURITY DEFINER RPCs, pgTAP, Node node:test

## Global Constraints

- Project statuses are exactly 报价中、设计中、待开工、进行中、暂停、已完工、已取消; a new project defaults to 报价中.
- Office users type the address manually; there is no “获取当前位置”, automatic completion, route planning, bulk geocoding, employee tracking, or background location.
- The default attendance radius is exactly 300 meters.
- Changing address text immediately makes saved coordinates unconfirmed; a failed geocode never overwrites the prior coordinates.
- 待开工 and 进行中 require a non-empty address, latitude in [-90, 90], longitude in [-180, 180], radius greater than zero, and confirmation against the current address.
- Geocoding is manual-only, uses a replaceable Nominatim adapter, caches one result per normalized address in browser memory, and starts no more than one provider request per 1000 ms.
- Map tiles use Japan GSI; the page displays both GSI tile attribution and OpenStreetMap/Nominatim attribution.
- Design assignees are only non-hidden employee_directory rows with department 设计部, employmentStatus 在职, and accountStatus active.
- Site assignees are only non-hidden employee_directory rows with department 工程部, employmentStatus 在职, and accountStatus active.
- Assignee values use employee_profiles.id and persist employee number/name snapshots; legacy manager remains read-only as 历史负责人 until a site assignee is explicitly selected.
- The startDate storage key remains unchanged, but every visible label is 开工日期; 工程结束日期/endDate is unchanged.
- Project amount is the existing adjustedTaxInclusiveAmount read model; the project form creates no projectAmount or other editable amount field.
- Financial visibility is fixed to active, 在职, first-password-completed employees whose department is 设计部 or 财务部, whose position is 社长, or whose employeeNumber is SW-000.
- Project page access still requires module.projects.view; financial mutation additionally requires module.projects.update. Editable templates cannot expand the fixed whitelist.
- Authenticated browsers receive projects only through list_projects_secure/create_project_secure/update_project_secure/soft_delete_project_secure and receive no direct projects table privileges, generic CRUD mapping, dashboard shortcut, migration shortcut, or fallback.
- Project IDs are allocated inside create_project_secure under a transaction-scoped advisory lock; the browser never chooses or retries Pxxx identifiers.
- update_project_secure is a merge-patch RPC: omitted keys, including every historical/current financial key, are preserved; explicit unknown keys and projectId changes are rejected.
- erp.projects, erp.projectContractChanges, erp.projectPaymentPlans, and erp.projectReceipts are the four runtime-sensitive keys. erp.contractRevenueMigrationBackups is a fifth, separate pre-deployment migration-backup key; first authenticated startup removes all five only after the administrator-controlled migration/backup window, and no released runtime code reads or rehydrates from them.
- Deleting the old migration UI, wiring the five-key purge, and deploying the new frontend are blocked until a human checkpoint records the backup path, server counts/samples, idempotent replay, and explicit user approval.
- Project/revenue record loading, snapshot construction, HomePage/DashboardPage inputs, financial dashboard cards, and the contract-revenue route all fail closed unless canViewProjectFinancials(currentUser) is true.
- public.can_current_employee_view_project_financials() is the single SQL financial helper shared by the core and document plans.
- This plan does not implement project document metadata, upload, TUS, signed URLs, Storage buckets/policies, document panels, or document cleanup. The old project-documents plan is superseded; the governing file design is `docs/superpowers/specs/2026-07-15-project-file-archive-permanent-storage-design.md`, and its executable replacement is `docs/superpowers/plans/2026-07-15-project-file-archive.md`.
- Preserve and exclude from every commit the pre-existing uncommitted files supabase/functions/employee-bootstrap-admin/handler.js and supabase/functions/employee-bootstrap-admin/handler.test.js.

---

## File map and dependency order

1. src/features/projects/projectDomain.js owns project shape, status/location rules, assignee filtering, and snapshots.
2. src/features/projects/projectPermissions.js owns display-only fixed whitelist helpers; PostgreSQL remains authoritative.
3. src/features/projects/projectLocationService.js owns address normalization, Nominatim adaptation, one-second pacing, and in-memory cache.
4. src/features/projects/ProjectLocationPicker.jsx owns the form-scoped Leaflet map, marker, radius circle, and manual lookup state.
5. supabase/migrations/202607150001_project_core_security.sql owns secure project RPCs, concurrency-safe IDs, fixed financial rules, transactional legacy conversion, contract-revenue RLS, and template cleanup.
6. src/services/projectService.js is the strict RPC client and response validator.
7. src/services/sensitiveRuntimeCache.js owns one-time removal of four runtime keys plus the distinct migration-backup key; App.jsx owns session memory arrays.
8. src/features/projects/ProjectPage.jsx owns project UI and calls injected async mutations.
9. src/services/dashboardService.js consumes an injected safe project projection; src/services/baseRecordService.js and src/services/recordTableConfig.js contain no projects mapping or direct project operation.
10. src/services/contractRevenueMigration.js and src/services/contractRevenueLocalMigration.js produce validated migration payloads for one transactional/re-entrant RPC; the released settings page contains no local read, write, upload, or rehydration panel.
11. src/App.jsx composes authenticated loading, canonical directory retry, revenue state, fail-closed snapshots/dashboard/routes, and post-migration key purge.

### Task 1: Project domain, lifecycle, location validity, and canonical assignee snapshots

**Files:**
- Create: src/features/projects/projectDomain.js
- Create: src/features/projects/projectDomain.test.js

**Interfaces:**
- Produces: PROJECT_STATUS_OPTIONS, DEFAULT_ATTENDANCE_RADIUS_METERS, localDateValue(date), createEmptyProject(today), normalizeProject(project), normalizeAddress(value), isProjectLocationConfirmed(project), updateProjectAddress(project, address), confirmProjectLocation(project, point, confirmedAt), eligibleProjectAssignees(directory, role), assignProjectEmployee(project, role, employee), validateProjectForSave(project), and buildProjectPayload(project).
- buildProjectPayload returns only mutable base fields; it never returns projectId, financial keys, or unknown keys. create gets its ID from PostgreSQL and update passes the ID as a separate argument.
- Consumes: employee_directory rows shaped as { id, employeeNumber, name, department, position, employmentStatus, accountStatus }.

- [ ] **Step 1: Write failing pure-domain tests**

~~~js
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_ATTENDANCE_RADIUS_METERS,
  PROJECT_STATUS_OPTIONS,
  assignProjectEmployee,
  confirmProjectLocation,
  createEmptyProject,
  eligibleProjectAssignees,
  isProjectLocationConfirmed,
  localDateValue,
  normalizeProject,
  updateProjectAddress,
  validateProjectForSave,
  buildProjectPayload,
} from './projectDomain.js'

const design = {
  id: '11111111-1111-4111-8111-111111111111',
  employeeNumber: 'SW-101',
  name: '设计一',
  department: '设计部',
  position: '设计师',
  employmentStatus: '在职',
  accountStatus: 'active',
}
const site = {
  ...design,
  id: '22222222-2222-4222-8222-222222222222',
  employeeNumber: 'SW-202',
  name: '现场一',
  department: '工程部',
  position: '职长',
}

test('status order and new-project defaults are exact', () => {
  assert.deepEqual(PROJECT_STATUS_OPTIONS, [
    '报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消',
  ])
  assert.deepEqual(createEmptyProject(() => '2026-07-15'), {
    projectId: '',
    projectName: '',
    customerName: '',
    address: '',
    latitude: null,
    longitude: null,
    attendanceRadiusMeters: 300,
    locationConfirmedAt: '',
    locationAddressSnapshot: '',
    status: '报价中',
    designAssigneeEmployeeId: '',
    designAssigneeEmployeeNumber: '',
    designAssigneeName: '',
    siteAssigneeEmployeeId: '',
    siteAssigneeEmployeeNumber: '',
    siteAssigneeName: '',
    startDate: '2026-07-15',
    endDate: '',
    remark: '',
  })
})

test('default date formatting uses local calendar getters instead of UTC ISO', () => {
  assert.equal(localDateValue({
    getFullYear: () => 2026,
    getMonth: () => 6,
    getDate: () => 15,
  }), '2026-07-15')
})

test('old projects normalize location fields and retain manager', () => {
  const project = normalizeProject({
    projectId: 'P001',
    manager: '旧负责人',
    latitude: null,
    longitude: '',
  })
  assert.equal(project.latitude, null)
  assert.equal(project.longitude, null)
  assert.equal(project.attendanceRadiusMeters, DEFAULT_ATTENDANCE_RADIUS_METERS)
  assert.equal(project.manager, '旧负责人')
  assert.equal(project.siteAssigneeName, '')
})

test('address edits preserve coordinates but invalidate confirmation', () => {
  const confirmed = confirmProjectLocation(
    { ...createEmptyProject(), address: '東京都江東区森下4-17-5' },
    { latitude: 35.687, longitude: 139.8 },
    '2026-07-15T01:02:03.000Z',
  )
  assert.equal(isProjectLocationConfirmed(confirmed), true)
  const changed = updateProjectAddress(confirmed, '東京都江東区森下4-17-6')
  assert.equal(changed.latitude, confirmed.latitude)
  assert.equal(changed.longitude, confirmed.longitude)
  assert.equal(changed.locationConfirmedAt, '')
  assert.equal(isProjectLocationConfirmed(changed), false)
  assert.equal(
    isProjectLocationConfirmed(updateProjectAddress(changed, confirmed.address)),
    false,
  )
  assert.equal(
    updateProjectAddress(confirmed, '　東京都江東区森下4-17-5　').locationConfirmedAt,
    confirmed.locationConfirmedAt,
  )
})

test('only active employed employees in the exact department are candidates', () => {
  const rows = [
    design,
    site,
    { ...design, id: '33333333-3333-4333-8333-333333333333', employmentStatus: '离职' },
    { ...site, id: '44444444-4444-4444-8444-444444444444', accountStatus: 'disabled' },
  ]
  assert.deepEqual(eligibleProjectAssignees(rows, 'design'), [design])
  assert.deepEqual(eligibleProjectAssignees(rows, 'site'), [site])
  assert.throws(() => assignProjectEmployee({}, 'design', site), /设计担当/)
  assert.deepEqual(assignProjectEmployee({}, 'site', site), {
    siteAssigneeEmployeeId: site.id,
    siteAssigneeEmployeeNumber: 'SW-202',
    siteAssigneeName: '现场一',
  })
})

test('pending-start and active status require confirmed current-address location', () => {
  for (const status of ['待开工', '进行中']) {
    const invalid = validateProjectForSave({
      ...createEmptyProject(),
      projectName: '测试项目',
      address: '東京都江東区',
      status,
    })
    assert.deepEqual(invalid[0], {
      field: 'location',
      code: 'location_required',
      message: '待开工或进行中的项目必须先确认施工位置和打卡范围',
    })
  }
  for (const status of ['报价中', '设计中', '暂停', '已完工', '已取消']) {
    assert.deepEqual(validateProjectForSave({
      ...createEmptyProject(),
      projectName: '测试项目',
      status,
    }), [])
  }
})

test('persistence payload excludes identity, financial, and unknown keys', () => {
  const payload = buildProjectPayload({
    ...createEmptyProject(),
    projectId: 'P999',
    projectName: '安全项目',
    adjustedTaxInclusiveAmount: 1100000,
    projectAmount: 1100000,
    unknownKey: 'reject-me',
  })
  assert.equal(payload.projectName, '安全项目')
  for (const key of [
    'projectId',
    'adjustedTaxInclusiveAmount',
    'projectAmount',
    'unknownKey',
  ]) assert.equal(Object.hasOwn(payload, key), false)
})
~~~

- [ ] **Step 2: Run the focused test and confirm RED**

Run: node --test src/features/projects/projectDomain.test.js

Expected: FAIL with ERR_MODULE_NOT_FOUND for projectDomain.js.

- [ ] **Step 3: Implement the complete pure domain**

Use immutable returns. normalizeAddress must call String(value).normalize('NFKC'), trim, and collapse all whitespace to one ASCII space. assignProjectEmployee accepts only role design or site, clears all three snapshot fields when employee is null, and throws for a non-eligible row. buildProjectPayload must return only these keys: projectName, customerName, address, latitude, longitude, attendanceRadiusMeters, locationConfirmedAt, locationAddressSnapshot, status, all six assignee fields, startDate, endDate, remark; it must never return projectId or spread unknown/financial keys.

~~~js
export const PROJECT_STATUS_OPTIONS = Object.freeze([
  '报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消',
])
export const DEFAULT_ATTENDANCE_RADIUS_METERS = 300
const LOCATION_REQUIRED = new Set(['待开工', '进行中'])
const ROLE_CONFIG = Object.freeze({
  design: { department: '设计部', prefix: 'designAssignee', label: '设计担当' },
  site: { department: '工程部', prefix: 'siteAssignee', label: '现场担当' },
})

export function normalizeAddress(value) {
  return typeof value === 'string'
    ? value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
    : ''
}

export function localDateValue(date = new Date()) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

export function createEmptyProject(today = () => localDateValue()) {
  return normalizeProject({ startDate: today() })
}

function parseCoordinate(value, minimum, maximum) {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && !value.trim())
  ) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

export function normalizeProject(project = {}) {
  const radius = Number(project.attendanceRadiusMeters)
  return {
    ...project,
    projectId: project.projectId || '',
    projectName: project.projectName || '',
    customerName: project.customerName || '',
    address: project.address || '',
    latitude: parseCoordinate(project.latitude, -90, 90),
    longitude: parseCoordinate(project.longitude, -180, 180),
    attendanceRadiusMeters: Number.isFinite(radius) && radius > 0
      ? radius
      : DEFAULT_ATTENDANCE_RADIUS_METERS,
    locationConfirmedAt: project.locationConfirmedAt || '',
    locationAddressSnapshot: project.locationAddressSnapshot || '',
    status: PROJECT_STATUS_OPTIONS.includes(project.status) ? project.status : '报价中',
    manager: project.manager || '',
    designAssigneeEmployeeId: project.designAssigneeEmployeeId || '',
    designAssigneeEmployeeNumber: project.designAssigneeEmployeeNumber || '',
    designAssigneeName: project.designAssigneeName || '',
    siteAssigneeEmployeeId: project.siteAssigneeEmployeeId || '',
    siteAssigneeEmployeeNumber: project.siteAssigneeEmployeeNumber || '',
    siteAssigneeName: project.siteAssigneeName || '',
    startDate: project.startDate || '',
    endDate: project.endDate || '',
    remark: project.remark || '',
  }
}

export function isProjectLocationConfirmed(project) {
  const value = normalizeProject(project)
  return Boolean(
    normalizeAddress(value.address) &&
    value.latitude !== null &&
    value.longitude !== null &&
    value.attendanceRadiusMeters > 0 &&
    value.locationConfirmedAt &&
    normalizeAddress(value.locationAddressSnapshot) === normalizeAddress(value.address)
  )
}

export function updateProjectAddress(project, address) {
  const nextAddress = typeof address === 'string' ? address : ''
  return {
    ...project,
    address: nextAddress,
    locationConfirmedAt:
      normalizeAddress(nextAddress) === normalizeAddress(project?.address)
        ? project?.locationConfirmedAt || ''
        : '',
  }
}

export function confirmProjectLocation(project, point, confirmedAt) {
  const latitude = Number(point?.latitude)
  const longitude = Number(point?.longitude)
  if (
    !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !normalizeAddress(project?.address) ||
    typeof confirmedAt !== 'string' || !confirmedAt
  ) throw new TypeError('定位确认数据无效')
  return {
    ...project,
    latitude,
    longitude,
    locationConfirmedAt: confirmedAt,
    locationAddressSnapshot: normalizeAddress(project.address),
  }
}

function isEligible(employee, role) {
  const config = ROLE_CONFIG[role]
  return Boolean(
    config &&
    employee &&
    employee.department === config.department &&
    employee.employmentStatus === '在职' &&
    employee.accountStatus === 'active' &&
    typeof employee.id === 'string' &&
    typeof employee.employeeNumber === 'string' &&
    typeof employee.name === 'string'
  )
}

export function eligibleProjectAssignees(directory, role) {
  return (Array.isArray(directory) ? directory : []).filter((employee) =>
    isEligible(employee, role)
  )
}

export function assignProjectEmployee(project, role, employee) {
  const config = ROLE_CONFIG[role]
  if (!config) throw new TypeError('担当类型无效')
  const prefix = config.prefix
  if (employee === null) {
    return {
      [prefix + 'EmployeeId']: '',
      [prefix + 'EmployeeNumber']: '',
      [prefix + 'Name']: '',
    }
  }
  if (!isEligible(employee, role)) throw new TypeError(config.label + '候选员工无效')
  return {
    [prefix + 'EmployeeId']: employee.id,
    [prefix + 'EmployeeNumber']: employee.employeeNumber,
    [prefix + 'Name']: employee.name,
  }
}

export function validateProjectForSave(project) {
  const value = normalizeProject(project)
  if (!value.projectName.trim()) {
    return [{ field: 'projectName', code: 'project_name_required', message: '请填写项目名称' }]
  }
  if (LOCATION_REQUIRED.has(value.status) && !isProjectLocationConfirmed(value)) {
    return [{
      field: 'location',
      code: 'location_required',
      message: '待开工或进行中的项目必须先确认施工位置和打卡范围',
    }]
  }
  return []
}

export function buildProjectPayload(project) {
  const value = normalizeProject(project)
  return Object.fromEntries([
    'projectName', 'customerName', 'address', 'latitude', 'longitude',
    'attendanceRadiusMeters', 'locationConfirmedAt', 'locationAddressSnapshot',
    'status', 'designAssigneeEmployeeId', 'designAssigneeEmployeeNumber',
    'designAssigneeName', 'siteAssigneeEmployeeId',
    'siteAssigneeEmployeeNumber', 'siteAssigneeName', 'startDate', 'endDate', 'remark',
  ].map((key) => [key, value[key]]))
}
~~~

- [ ] **Step 4: Run GREEN and commit**

Run: node --test src/features/projects/projectDomain.test.js

Expected: 7 tests pass, 0 fail.

~~~bash
git add src/features/projects/projectDomain.js src/features/projects/projectDomain.test.js
git commit -m "feat: add secure project domain rules"
~~~

### Task 2: Fixed project financial display rules and permission-template guard

**Files:**
- Create: src/features/projects/projectPermissions.js
- Create: src/features/projects/projectPermissions.test.js
- Modify: src/auth/permissionCatalog.js
- Modify: src/services/permissionTemplateService.js
- Modify: src/services/permissionTemplateService.test.js
- Modify: src/features/employees/PermissionTemplateEditor.jsx
- Modify: src/features/employees/permissionTemplateContract.test.js
- Modify: src/features/employees/permissionTemplateEditorState.js
- Modify: src/features/employees/permissionTemplateEditorState.test.js
- Modify: supabase/functions/permission-templates/handler.js
- Modify: supabase/functions/permission-templates/handler.test.js

**Interfaces:**
- Produces: isProjectFinancialWhitelistEmployee(employee), canViewProjectFinancials(employee), canUpdateProjectFinancials(employee), canTemplateSubjectReceiveProjectFinancials(subjectType, subjectCode), and templateContainsForbiddenProjectFinancialGrant(subjectType, subjectCode, permissionKeys).
- isProjectFinancialWhitelistEmployee is a pure identity predicate: it checks only department/position/employeeNumber. Active/account/password and module permission checks belong to canViewProjectFinancials/canUpdateProjectFinancials and the SQL helper.
- Database enforcement in Task 5 intentionally does not consume these browser helpers.

- [ ] **Step 1: Add failing identity and template tests**

~~~js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canUpdateProjectFinancials,
  canViewProjectFinancials,
  isProjectFinancialWhitelistEmployee,
} from './projectPermissions.js'

const active = {
  employeeNumber: 'SW-100',
  department: '工程部',
  position: '职长',
  employmentStatus: '在职',
  accountStatus: 'active',
  mustChangePassword: false,
  effectivePermissionKeys: ['module.projects.view', 'module.projects.update'],
}

test('the fixed four identities are whitelisted and other identities are not', () => {
  for (const patch of [
    { department: '设计部' },
    { department: '财务部' },
    { position: '社长' },
    { employeeNumber: 'SW-000' },
  ]) assert.equal(isProjectFinancialWhitelistEmployee({ ...active, ...patch }), true)
  assert.equal(isProjectFinancialWhitelistEmployee(active), false)
})

test('identity membership is pure while access helpers fail closed on account state', () => {
  const formerDesigner = { ...active, department: '设计部', employmentStatus: '离职' }
  const disabledFinance = { ...active, department: '财务部', accountStatus: 'disabled' }
  const temporaryPresident = { ...active, position: '社长', mustChangePassword: true }
  assert.equal(isProjectFinancialWhitelistEmployee(formerDesigner), true)
  assert.equal(isProjectFinancialWhitelistEmployee(disabledFinance), true)
  assert.equal(isProjectFinancialWhitelistEmployee(temporaryPresident), true)
  assert.equal(canViewProjectFinancials(formerDesigner), false)
  assert.equal(canViewProjectFinancials(disabledFinance), false)
  assert.equal(canUpdateProjectFinancials(temporaryPresident), false)
})

test('view and update also require the corresponding project module permission', () => {
  const designer = { ...active, department: '设计部' }
  assert.equal(canViewProjectFinancials(designer), true)
  assert.equal(canUpdateProjectFinancials(designer), true)
  assert.equal(canUpdateProjectFinancials({
    ...designer,
    effectivePermissionKeys: ['module.projects.view'],
  }), false)
})
~~~

Add the same forbidden/allowed matrix at all four editable layers:

~~~js
const financialKeys = [
  'sensitive.contract_amount_view',
  'sensitive.contract_amount_update',
]
for (const [subjectType, subjectCode] of [
  ['department', '工程部'],
  ['position', '主任'],
]) {
  assert.equal(
    templateContainsForbiddenProjectFinancialGrant(
      subjectType,
      subjectCode,
      financialKeys,
    ),
    true,
  )
}
for (const [subjectType, subjectCode] of [
  ['department', '设计部'],
  ['department', '财务部'],
  ['position', '社长'],
]) {
  assert.equal(
    templateContainsForbiddenProjectFinancialGrant(
      subjectType,
      subjectCode,
      financialKeys,
    ),
    false,
  )
}
~~~

permissionTemplateService.test.js must prove a forbidden replacement rejects locally with PERMISSION_TEMPLATE_INPUT_INVALID and performs zero Edge invocations. permissionTemplateEditorState.test.js must prove toggling either financial key is a no-op for forbidden subjects. permissionTemplateContract.test.js must prove both checkboxes are disabled with aria-disabled=true. handler.test.js must prove a crafted forbidden request returns 400 before authorization/admin-client creation, while 设计部/财务部/社长 reach replaceTemplate. The SQL guard and cleanup audit are created and verified in Task 5 together with `202607150001_project_core_security.sql`; Task 2 must not skip a test for a migration that does not yet exist.

- [ ] **Step 2: Run RED**

Run: node --test src/features/projects/projectPermissions.test.js supabase/functions/permission-templates/handler.test.js

Expected: projectPermissions.js is missing and the current handler incorrectly accepts 工程部 financial grants.

- [ ] **Step 3: Implement exact helpers and reuse the template predicate**

~~~js
import { canAccessModule, canEdit } from '../../utils/permissions.js'

export function isProjectFinancialWhitelistEmployee(employee = {}) {
  return (
    employee.department === '设计部' ||
    employee.department === '财务部' ||
    employee.position === '社长' ||
    employee.employeeNumber === 'SW-000'
  )
}

function isActiveProjectEmployee(employee = {}) {
  return (
    employee.employmentStatus === '在职' &&
    employee.accountStatus === 'active' &&
    employee.mustChangePassword === false
  )
}

export function canViewProjectFinancials(employee) {
  return isActiveProjectEmployee(employee) &&
    isProjectFinancialWhitelistEmployee(employee) &&
    canAccessModule(employee, '工程项目')
}

export function canUpdateProjectFinancials(employee) {
  return isActiveProjectEmployee(employee) &&
    isProjectFinancialWhitelistEmployee(employee) &&
    canEdit(employee, '工程项目')
}
~~~

Add this export to permissionCatalog.js and call it from both browser editor state and Edge validation:

~~~js
const PROJECT_FINANCIAL_KEYS = new Set([
  'sensitive.contract_amount_view',
  'sensitive.contract_amount_update',
])

export function canTemplateSubjectReceiveProjectFinancials(subjectType, subjectCode) {
  return (
    (subjectType === 'department' && ['设计部', '财务部'].includes(subjectCode)) ||
    (subjectType === 'position' && subjectCode === '社长')
  )
}

export function templateContainsForbiddenProjectFinancialGrant(
  subjectType,
  subjectCode,
  permissionKeys,
) {
  return permissionKeys.some((key) => PROJECT_FINANCIAL_KEYS.has(key)) &&
    !canTemplateSubjectReceiveProjectFinancials(subjectType, subjectCode)
}
~~~

permissionTemplateService.validateReplacementInput and Edge validateReplacement must both call templateContainsForbiddenProjectFinancialGrant and reject before mutation. permissionTemplateEditorState.togglePermissionTemplateDraft must return the unchanged editorData for a forbidden financial toggle. PermissionTemplateEditor must set disabled and aria-disabled on both checkboxes for forbidden subjects while leaving all unrelated keys interactive. The SQL function remains the final layer and cleans already-persisted forbidden grants with one safe audit record.

- [ ] **Step 4: Run GREEN and commit**

Run: node --test src/features/projects/projectPermissions.test.js src/services/permissionTemplateService.test.js src/features/employees/permissionTemplateEditorState.test.js src/features/employees/permissionTemplateContract.test.js supabase/functions/permission-templates/handler.test.js

Expected: all focused tests pass.

~~~bash
git add src/features/projects/projectPermissions.js src/features/projects/projectPermissions.test.js src/auth/permissionCatalog.js src/services/permissionTemplateService.js src/services/permissionTemplateService.test.js src/features/employees/PermissionTemplateEditor.jsx src/features/employees/permissionTemplateContract.test.js src/features/employees/permissionTemplateEditorState.js src/features/employees/permissionTemplateEditorState.test.js supabase/functions/permission-templates/handler.js supabase/functions/permission-templates/handler.test.js
git commit -m "feat: fix project financial visibility rules"
~~~

### Task 3: Replaceable manual geocoding adapter, pacing, and memory cache

**Files:**
- Create: src/features/projects/projectLocationService.js
- Create: src/features/projects/projectLocationService.test.js

**Interfaces:**
- Produces: GeocodingError, normalizeGeocodingAddress(value), createNominatimGeocoder(options), createProjectLocationService(options), and singleton projectLocationService.
- locateAddress(address, { signal }) resolves to { latitude, longitude, displayName } or null; it never mutates project form data.

- [ ] **Step 1: Write failing adapter/cache/pacing tests**

Use injected fetchImpl, now, and wait. Assert exact URL parameters format=jsonv2, limit=1, countrycodes=jp, q=normalized address; two simultaneous normalized-equivalent calls share one in-flight provider Promise; Promise.all for two distinct uncached addresses starts providers at least 1000 ms apart; a failed in-flight call is removed so retry reaches the adapter; HTTP 429 throws GeocodingError with code GEOCODING_UNAVAILABLE; an empty result returns null and is cached.

~~~js
test('normalized duplicates share one in-memory result', async () => {
  const calls = []
  const adapter = { geocode: async (address) => {
    calls.push(address)
    return { latitude: 35.68, longitude: 139.76, displayName: '東京都' }
  }}
  const service = createProjectLocationService({
    adapter,
    now: () => 1000,
    wait: async () => {},
  })
  assert.deepEqual(await service.locateAddress(' 東京都　千代田区 '), {
    latitude: 35.68, longitude: 139.76, displayName: '東京都',
  })
  await service.locateAddress('東京都 千代田区')
  assert.deepEqual(calls, ['東京都 千代田区'])
})

test('concurrent calls dedupe by address and serialize distinct provider starts', async () => {
  let clock = 0
  const starts = []
  const adapter = { geocode: async (address) => {
    starts.push([address, clock])
    return { latitude: 35.68, longitude: 139.76, displayName: address }
  }}
  const service = createProjectLocationService({
    adapter,
    now: () => clock,
    wait: async (milliseconds) => { clock += milliseconds },
  })
  await Promise.all([
    service.locateAddress('東京都 千代田区'),
    service.locateAddress('東京都　千代田区'),
  ])
  assert.deepEqual(starts, [['東京都 千代田区', 0]])
  await Promise.all([
    service.locateAddress('東京都 港区'),
    service.locateAddress('東京都 江東区'),
  ])
  assert.deepEqual(starts.slice(1), [
    ['東京都 港区', 1000],
    ['東京都 江東区', 2000],
  ])
})
~~~

- [ ] **Step 2: Run RED**

Run: node --test src/features/projects/projectLocationService.test.js

Expected: FAIL with ERR_MODULE_NOT_FOUND.

- [ ] **Step 3: Implement the service**

~~~js
import { normalizeAddress } from './projectDomain.js'

export class GeocodingError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GeocodingError'
    this.code = code
  }
}

export const normalizeGeocodingAddress = normalizeAddress

export function createNominatimGeocoder({
  fetchImpl = globalThis.fetch,
  endpoint = 'https://nominatim.openstreetmap.org/search',
} = {}) {
  return {
    async geocode(address, { signal } = {}) {
      const url = new URL(endpoint)
      url.search = new URLSearchParams({
        q: address,
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'jp',
      }).toString()
      let response
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        })
      } catch {
        throw new GeocodingError('GEOCODING_UNAVAILABLE', '地址服务暂不可用，请稍后重试')
      }
      if (!response.ok) {
        throw new GeocodingError('GEOCODING_UNAVAILABLE', '地址服务暂不可用，请稍后重试')
      }
      const rows = await response.json()
      if (!Array.isArray(rows) || rows.length === 0) return null
      const latitude = Number(rows[0].lat)
      const longitude = Number(rows[0].lon)
      if (
        !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      ) throw new GeocodingError('GEOCODING_RESPONSE_INVALID', '地址服务返回了无效位置')
      return {
        latitude,
        longitude,
        displayName: typeof rows[0].display_name === 'string' ? rows[0].display_name : address,
      }
    },
  }
}

export function createProjectLocationService({
  adapter = createNominatimGeocoder(),
  cache = new Map(),
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  minimumIntervalMs = 1000,
} = {}) {
  let lastRequestStartedAt = Number.NEGATIVE_INFINITY
  let providerQueue = Promise.resolve()
  const inFlight = new Map()

  function locateAddress(address, options = {}) {
    const key = normalizeGeocodingAddress(address)
    if (!key) return Promise.reject(
      new GeocodingError('ADDRESS_REQUIRED', '请先填写项目地址'),
    )
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (inFlight.has(key)) return inFlight.get(key)

    const request = providerQueue.then(async () => {
      const remaining = minimumIntervalMs - (now() - lastRequestStartedAt)
      if (remaining > 0) await wait(remaining)
      lastRequestStartedAt = now()
      const result = await adapter.geocode(key, options)
      cache.set(key, result)
      return result
    })
    providerQueue = request.catch(() => undefined)
    inFlight.set(key, request)
    request.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    )
    return request
  }
  return Object.freeze({ locateAddress })
}

export const projectLocationService = createProjectLocationService()
~~~

- [ ] **Step 4: Run GREEN and commit**

Run: node --test src/features/projects/projectLocationService.test.js

Expected: adapter, cache, empty-result, abort/error, and 1000 ms pacing tests all pass.

~~~bash
git add src/features/projects/projectLocationService.js src/features/projects/projectLocationService.test.js
git commit -m "feat: add manual project geocoding service"
~~~

### Task 4: Form-scoped Leaflet picker with GSI tiles and manual adjustment

**Files:**
- Modify: package.json
- Modify: package-lock.json
- Create: src/features/projects/ProjectLocationPicker.jsx
- Create: src/features/projects/projectLocationPickerContract.test.js
- Modify: src/styles.css

**Interfaces:**
- ProjectLocationPicker consumes { address, latitude, longitude, attendanceRadiusMeters, confirmed, onLocationConfirmed, onRadiusChange, locateAddress }.
- onLocationConfirmed receives exactly { latitude, longitude, confirmedAt }; ProjectPage adds the current address snapshot through confirmProjectLocation.

- [ ] **Step 1: Add a source-contract test before installing**

~~~js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./ProjectLocationPicker.jsx', import.meta.url), 'utf8').catch(() => '')

test('picker is manual, short-lived, attributed, and adjustable', () => {
  assert.match(source, /leaflet/)
  assert.match(source, /cyberjapandata\.gsi\.go\.jp\/xyz\/std/)
  assert.match(source, /地址定位/)
  assert.match(source, /OpenStreetMap contributors/)
  assert.match(source, /dragend/)
  assert.match(source, /map\.on\(['"]click/)
  assert.match(source, /circle/)
  assert.match(source, /map\.remove\(\)/)
  assert.doesNotMatch(source, /geolocation|getCurrentPosition|watchPosition/)
})
~~~

- [ ] **Step 2: Run RED**

Run: node --test src/features/projects/projectLocationPickerContract.test.js

Expected: assertions fail because the component is absent.

- [ ] **Step 3: Install the exact dependency**

Run: npm install leaflet@1.9.4 --save-exact

Expected: package.json contains "leaflet": "1.9.4" and package-lock.json resolves leaflet 1.9.4.

- [ ] **Step 4: Implement the component**

Create the map only inside useEffect after the component mounts, use L.map(containerRef.current), GSI URL https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png, a draggable L.marker, and L.circle with radius attendanceRadiusMeters. Map click, marker dragend, and successful locate call onLocationConfirmed with new Date().toISOString(). If locate returns null, show “地址未找到，请补充都道府县、市区町村和番地” and leave marker/coordinates unchanged. Catch GeocodingError as a retryable alert. Cleanup removes click/drag listeners and calls map.remove().

Render these exact accessible controls and copy:

~~~jsx
<button type="button" onClick={handleLocate} disabled={locating}>
  {locating ? '定位中…' : '地址定位'}
</button>
<div ref={containerRef} className="project-location-map" aria-label="项目施工位置地图" />
<p role="status">
  {confirmed ? '施工位置已确认' : '地址已变更，请重新定位'}
</p>
<p>
  纬度：{latitude ?? '未选择'}｜经度：{longitude ?? '未选择'}
</p>
<a href="https://maps.gsi.go.jp/help/howtouse.html" target="_blank" rel="noreferrer">
  地理院タイル
</a>
<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
  © OpenStreetMap contributors
</a>
~~~

The parent form owns the numeric radius input with min=1; the picker only updates its circle when the prop changes.

- [ ] **Step 5: Run focused tests/build and commit**

Run: node --test src/features/projects/projectLocationPickerContract.test.js

Expected: 1 test passes.

Run: npm run build

Expected: Vite exits 0 and resolves Leaflet CSS/assets without errors.

~~~bash
git add package.json package-lock.json src/features/projects/ProjectLocationPicker.jsx src/features/projects/projectLocationPickerContract.test.js src/styles.css
git commit -m "feat: add project location map picker"
~~~

### Task 5: Secure project RPCs and fixed financial RLS

**Files:**
- Create: supabase/migrations/202607150001_project_core_security.sql
- Create: supabase/tests/project_core_security.sql
- Create: src/services/projectCoreSecuritySchema.test.js
- Modify: supabase/tests/employee_auth.sql
- Modify: docs/supabase-schema.sql
- Modify: docs/supabase-schema.md

**Interfaces:**
- Produces public.can_current_employee_view_project_financials() -> boolean.
- Produces list_projects_secure() -> setof jsonb, create_project_secure(p_project jsonb) -> jsonb, update_project_secure(p_project_id text, p_patch jsonb) -> jsonb, soft_delete_project_secure(p_project_id text) -> text, and migrate_legacy_project_contract_secure(p_project_id text, p_expected_legacy_contract jsonb, p_opening_receipt jsonb) -> jsonb.
- list/create/update responses all apply the same fixed financial projection. A base-only update by a non-whitelist caller preserves stored financial keys without returning them.
- Direct authenticated projects access is revoked. The three contract-revenue tables retain direct RLS but use the fixed whitelist plus project view/update permissions.
- Every SECURITY DEFINER/private helper has a fixed search_path and explicit EXECUTE revocation; no function created here retains PostgreSQL's default PUBLIC EXECUTE.

- [ ] **Step 1: Write failing pgTAP and static SQL contracts**

The pgTAP fixture must create active users for 设计部, 财务部, 社长, SW-000, and ordinary 工程部; give all module.projects.view/update; insert one project containing originalContractTaxInclusiveAmount and one row in each revenue table as service_role. Assert:

1. ordinary 工程部 list_projects_secure returns the project without every key in private.project_financial_payload_keys();
2. the four whitelist identities receive the amount source keys;
3. authenticated SELECT/INSERT/UPDATE on public.projects throws permission denied;
4. ordinary 工程部 cannot select or mutate contract tables even if editable templates contain sensitive.contract_amount keys;
5. 设计部 can read; it cannot mutate without module.projects.update;
6. non-whitelist update_project_secure cannot add, change, or restore a financial key;
7. 待开工/进行中 writes without confirmed current-address coordinates fail 22023;
8. selected assignee IDs are canonical, eligible, and server-written snapshots;
9. forbidden template grants are deleted and audited, and future forbidden replacements fail;
10. anonymous, disabled, former, and must-change-password identities fail;
11. sequential create_project_secure calls return distinct server-generated Pxxx IDs in pgTAP, and a separate two-connection verification proves concurrent calls are distinct;
12. a base-only update preserves every pre-existing key returned by private.project_financial_payload_keys();
13. soft_delete_project_secure returns the deleted project ID as text;
14. migrate_legacy_project_contract_secure atomically creates the deterministic opening receipt and project schema fields, and an identical replay returns the already-migrated project without duplication;
15. anon cannot execute can_current_employee_view_project_financials or any private helper; authenticated/service_role can execute the public predicate/RPCs only as explicitly granted;
16. even a whitelist updater cannot submit derived snapshot/read-model keys, and a confirmation transition stores the authenticated employee snapshot/server timestamp rather than submitted actor values.
17. create/update responses to a non-whitelist caller omit every financial key even when the stored row retains them;
18. zero-paid legacy migration accepts `p_opening_receipt = null`, creates no receipt, migrates atomically, and replays idempotently;
19. confirmation actor/time keys are rejected outside a valid transition and are always canonicalized from the authenticated employee/server clock for a confirmed result;
20. project payloads must be JSON objects with a nonblank projectName and typed/ranged base values.

The cleanup assertion requires a two-phase upgrade check: apply through `202607140004`, insert a forbidden financial grant, apply this migration, then verify deletion plus exactly one safe cleanup audit. The concurrency assertion requires two committed database connections; a single pgTAP transaction is not evidence of concurrency. Record both commands/results in the task report.

Static test core:

~~~js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const sql = await readFile(new URL(
  '../../supabase/migrations/202607150001_project_core_security.sql',
  import.meta.url,
), 'utf8').catch(() => '')

test('project access is RPC-only and financial authorization is fixed', () => {
  assert.match(sql, /can_current_employee_view_project_financials/)
  assert.match(sql, /list_projects_secure/)
  assert.match(sql, /create_project_secure/)
  assert.match(sql, /update_project_secure/)
  assert.match(sql, /soft_delete_project_secure/)
  assert.match(sql, /migrate_legacy_project_contract_secure/)
  assert.match(sql, /pg_advisory_xact_lock/)
  assert.match(sql, /returns text[\s\S]*soft_delete_project_secure|soft_delete_project_secure[\s\S]*returns text/)
  assert.match(sql, /revoke all on table public\.projects from public, anon, authenticated/i)
  assert.doesNotMatch(sql, /has_current_permission\('sensitive\.contract_amount_(view|update)'\)/i)
  assert.match(sql, /department in \('设计部', '财务部'\)/)
  assert.match(sql, /position = '社长'/)
  assert.match(sql, /employee_number = 'SW-000'/)
  assert.match(sql, /revoke all on function private\.project_financial_payload_keys\(\)[\s\S]*from public, anon, authenticated, service_role/i)
  assert.match(sql, /revoke all on function private\.next_project_record_key\(\)[\s\S]*from public, anon, authenticated, service_role/i)
  assert.match(sql, /revoke all on function private\.validate_project_payload\(jsonb\)[\s\S]*from public, anon, authenticated, service_role/i)
  assert.match(sql, /revoke all on function public\.can_current_employee_view_project_financials\(\) from public, anon/i)
  assert.match(sql, /grant execute on function public\.can_current_employee_view_project_financials\(\) to authenticated, service_role/i)
})
~~~

- [ ] **Step 2: Run static RED**

Run: node --test src/services/projectCoreSecuritySchema.test.js

Expected: assertions fail because the migration is absent.

- [ ] **Step 3: Implement the fixed predicate, exhaustive financial key set, and safe projection**

The migration must begin with additive definitions and fixed search_path. Use this exact predicate and include every current/historical project financial key:

~~~sql
create or replace function public.can_current_employee_view_project_financials()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.employee_profiles as employee
    where employee.auth_user_id = auth.uid()
      and employee.deleted_at is null
      and employee.employment_status = '在职'
      and employee.account_status = 'active'
      and employee.must_change_password = false
      and (
        employee.department in ('设计部', '财务部')
        or employee.position = '社长'
        or employee.employee_number = 'SW-000'
      )
  );
$$;

create or replace function private.project_financial_payload_keys()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[
    'contractAmount','paidAmount','paymentProgress','paymentStatus',
    'revenuePaymentStatus','contractRevenueSchemaVersion',
    'contractRevenueSetupStatus','contractConfirmationStatus',
    'originalContractTaxExclusiveAmount','originalContractTaxRate',
    'originalContractTaxAmount','originalContractTaxInclusiveAmount',
    'contractConfirmedById','contractConfirmedByName','contractConfirmedAt',
    'needsManualReview','adjustedTaxExclusiveAmount','adjustedTaxAmount',
    'adjustedTaxInclusiveAmount','totalReceivedTaxInclusiveAmount',
    'outstandingTaxInclusiveAmount','overpaidTaxInclusiveAmount',
    'profitAnchorTaxExclusiveAmount','allocationStatus','allocationReason',
    'lockedStages','unlockedStages','lockedPlannedTaxInclusiveAmount',
    'remainingAssignableTaxInclusiveAmount','unallocatedTaxInclusiveAmount',
    'lockedAmountExcess'
  ]::text[];
$$;

create or replace function public.list_projects_secure()
returns setof jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.view')
  then
    raise exception using errcode = '42501', message = 'project view permission required';
  end if;
  return query
  select case
    when public.can_current_employee_view_project_financials()
      then project.payload
    else project.payload - private.project_financial_payload_keys()
  end
  from public.projects as project
  where project.status <> 'deleted'
  order by project.updated_at desc, project.record_key;
end;
$$;
~~~

- [ ] **Step 4: Implement transactional writes and server revalidation**

create_project_secure accepts an exact base allowlist without projectId, rejects every financial key, requires module.projects.create, allocates projectId inside PostgreSQL, validates the seven states/location, validates selected employee IDs against employee_profiles, overwrites submitted employee number/name with canonical snapshots, and adds contractRevenueSetupStatus=not_started itself. Use a transaction-scoped advisory lock around allocation; the existing projects.record_key UNIQUE constraint is the final invariant:

~~~sql
create or replace function private.next_project_record_key()
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  next_number bigint;
begin
  perform pg_advisory_xact_lock(
    pg_catalog.hashtextextended('public.projects.record_key', 0)
  );
  select coalesce(max(
      (pg_catalog.regexp_match(project.record_key, '^P([0-9]+)$'))[1]::bigint
    ), 0) + 1
    into next_number
    from public.projects as project
    where project.record_key ~ '^P[0-9]+$';
  return 'P' || pg_catalog.lpad(next_number::text, 3, '0');
end;
$$;
~~~

update_project_secure requires module.projects.update, locks the row FOR UPDATE, rejects projectId in p_patch, validates an exact base-plus-financial-source allowlist, and computes next_payload := current_payload || p_patch. It must never rebuild the row from p_patch, because omitted keys—including every historical/current financial key—must survive a project master edit. The financial write allowlist is exactly contractRevenueSchemaVersion, contractRevenueSetupStatus, contractConfirmationStatus, the four originalContractTax* fields, needsManualReview, contractConfirmedById, contractConfirmedByName, and contractConfirmedAt. Derived snapshot/read-model keys such as adjustedTaxInclusiveAmount, paidAmount, paymentProgress, allocation fields, locked/unlocked fields, and totals are projection-removal keys only and are never writable. A non-whitelist caller must be rejected if p_patch contains any key from private.project_financial_payload_keys(); a whitelist caller still needs module.projects.update. Reject submitted contractConfirmedById/Name/At outside a valid transition; whenever the resulting confirmation state is confirmed, overwrite actor ID/name from the authenticated canonical employee and write the server timestamp so actor-only patches cannot spoof metadata. If an assignee ID changes, require a currently active employee in the correct department and overwrite snapshots; if unchanged, preserve the stored snapshot so a renamed/retired historical assignee remains readable.

create_project_secure and update_project_secure must project their return through the same fixed predicate/key set as list_projects_secure. They may retain financial keys in storage, but must never disclose them to a non-whitelist response.

soft_delete_project_secure requires module.projects.delete, locks the row, sets status=deleted, and returns p_project_id as text:

~~~sql
create or replace function public.soft_delete_project_secure(p_project_id text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if not public.is_current_employee_active()
    or not public.has_current_permission('module.projects.delete')
  then
    raise exception using errcode = '42501', message = 'project delete permission required';
  end if;
  update public.projects
    set status = 'deleted'
    where record_key = p_project_id and status <> 'deleted';
  if not found then
    raise exception using errcode = 'P0002', message = 'project not found';
  end if;
  return p_project_id;
end;
$$;
~~~

Implement migrate_legacy_project_contract_secure as one PostgreSQL function call/transaction. It requires can_current_employee_view_project_financials() and module.projects.update, locks the project row, compares p_expected_legacy_contract.contractAmount/paidAmount with the current legacy payload, and either: (a) returns immediately when contractRevenueSchemaVersion >= 1; or (b) when paidAmount is greater than zero, inserts the deterministic opening receipt with ON CONFLICT (record_key) DO NOTHING and verifies an existing conflict belongs to the same project/amount/sourceCode; when paidAmount is zero it requires/accepts `p_opening_receipt = null` and creates no receipt. It then removes contractAmount/paidAmount/paymentProgress/paymentStatus and writes schema-version/original-contract fields. Any mismatch raises 40001 so neither receipt nor project update commits. Replaying the same request returns the migrated project and never duplicates a receipt.

Use a shared private.validate_project_payload(jsonb) that first requires a JSON object, a nonblank string projectName, the exact seven statuses, typed base fields, valid radius/coordinate ranges, and confirmed current-address location for 待开工/进行中. Compare addresses after PostgreSQL `normalize(value, NFKC)`, trim, and whitespace collapse so the server matches the client normalization contract; never silently write locationAddressSnapshot on ordinary save.

Revoke direct project privileges and expose only the five RPCs:

~~~sql
alter table public.projects enable row level security;
do $$
declare policy_name text;
begin
  for policy_name in
    select policyname from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'projects'
  loop
    execute format('drop policy if exists %I on public.projects', policy_name);
  end loop;
end;
$$;
revoke all on table public.projects from public, anon, authenticated;
grant all on table public.projects to service_role;
revoke all on function public.list_projects_secure() from public, anon;
revoke all on function public.create_project_secure(jsonb) from public, anon;
revoke all on function public.update_project_secure(text, jsonb) from public, anon;
revoke all on function public.soft_delete_project_secure(text) from public, anon;
revoke all on function public.migrate_legacy_project_contract_secure(text, jsonb, jsonb) from public, anon;
grant execute on function public.list_projects_secure() to authenticated, service_role;
grant execute on function public.create_project_secure(jsonb) to authenticated, service_role;
grant execute on function public.update_project_secure(text, jsonb) to authenticated, service_role;
grant execute on function public.soft_delete_project_secure(text) to authenticated, service_role;
grant execute on function public.migrate_legacy_project_contract_secure(text, jsonb, jsonb) to authenticated, service_role;
~~~

Keep assignee normalization inline in create_project_secure/update_project_secure so the complete private-helper surface is exactly the three functions below. Immediately after creating them, close every default function grant:

~~~sql
revoke all on function private.project_financial_payload_keys()
  from public, anon, authenticated, service_role;
revoke all on function private.next_project_record_key()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_project_payload(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.can_current_employee_view_project_financials()
  from public, anon;
grant execute on function public.can_current_employee_view_project_financials()
  to authenticated, service_role;
~~~

pgTAP must set role anon and assert calling the public predicate throws permission denied; information_schema.routine_privileges must show no PUBLIC/anon/authenticated/service_role EXECUTE rows for private helpers and no PUBLIC/anon EXECUTE row for the public predicate.

- [ ] **Step 5: Replace contract-revenue policies and close template bypass**

For project_contract_changes, project_payment_plans, and project_receipts, catalog-drop existing policies and drop only their three `enforce_*_status_permission` triggers; keep their `set_*_updated_at` triggers. Explicitly revoke all browser table privileges, grant only SELECT/INSERT/UPDATE to authenticated and all to service_role, then recreate policies: SELECT requires is_current_employee_active() + module.projects.view + can_current_employee_view_project_financials(), while INSERT/UPDATE requires is_current_employee_active() + module.projects.update + can_current_employee_view_project_financials(). Keep hard DELETE ungranted. Do not call sensitive.contract_amount permissions.

Delete permission_grants containing either contract amount key unless subject is department 设计部/财务部 or position 社长. Insert one employee_security_audit row with action project_financial_template_grants.cleaned and safe_details containing deletedCount only. Add this exact guard before replace_permission_template_admin deletes old rows:

~~~sql
if p_permission_keys && array[
  'sensitive.contract_amount_view',
  'sensitive.contract_amount_update'
]::text[]
and not (
  (p_subject_type = 'department' and p_subject_code in ('设计部', '财务部'))
  or (p_subject_type = 'position' and p_subject_code = '社长')
) then
  raise exception using errcode = '22023',
    message = 'fixed project financial whitelist violation';
end if;
~~~

`docs/supabase-schema.sql` currently mirrors only the first employee-auth migration and is not a complete final bootstrap. Do not append a replacement function whose later private dependencies are absent. Mark ordered files in `supabase/migrations/` as the canonical fresh-install path, retain the SQL document only as a clearly labeled historical base reference, and document the RPC-only boundary/deployment order in docs/supabase-schema.md.

- [ ] **Step 6: Run SQL tests and commit**

Run: node --test src/services/projectCoreSecuritySchema.test.js

Expected: static contract passes.

Run: supabase db reset

Expected: all migrations apply successfully.

Run: supabase test db supabase/tests/project_core_security.sql

Expected: pgTAP prints all assertions ok and exits 0. If Docker/local Supabase is unavailable, record the exact command/error in the execution handoff and do not claim database integration passed.

Run the complete pgTAP suite after updating `supabase/tests/employee_auth.sql` for the final 69-policy count, zero direct projects policies, and RPC-only project denials:

Run: supabase test db

Expected: every existing and new pgTAP suite passes. Also perform the documented two-phase upgrade-cleanup check and two-connection create concurrency check; do not claim either property from a single post-migration transaction.

~~~bash
git add supabase/migrations/202607150001_project_core_security.sql supabase/tests/project_core_security.sql supabase/tests/employee_auth.sql src/services/projectCoreSecuritySchema.test.js docs/supabase-schema.sql docs/supabase-schema.md
git commit -m "feat: secure project and financial database access"
~~~

### Task 6: Strict project RPC client

**Files:**
- Modify: src/services/projectService.js:1-11
- Create: src/services/projectService.test.js

**Interfaces:**
- createProjectService(client, { configured }) returns exactly { listProjects, createProject, updateProject, softDeleteProject }.
- createProject(projectWithoutId) receives a base payload with no projectId and returns the server-generated project.
- updateProject(projectId, patch) sends a merge patch; softDeleteProject(projectId) resolves to the same projectId text.
- The singleton wrappers have identical names/signatures and use only list_projects_secure/create_project_secure/update_project_secure/soft_delete_project_secure. No migration method is exposed from projectService.

- [ ] **Step 1: Write failing service tests**

Test exact RPC argument shapes, strict response records, unknown-key rejection only for transport envelopes (project payload retains known contract fields for whitelisted callers), local input rejection, 401/403 safe errors, and configuration failure before an RPC call.

~~~js
test('uses only secure project RPCs', async () => {
  const calls = []
  const client = { rpc: async (...args) => {
    calls.push(args)
    if (args[0] === 'list_projects_secure') return { data: [], error: null }
    if (args[0] === 'soft_delete_project_secure') return { data: 'P001', error: null }
    return { data: { projectId: 'P001', projectName: '项目', status: '报价中' }, error: null }
  }}
  const service = createProjectService(client, { configured: true })
  assert.deepEqual(Object.keys(service).sort(), [
    'createProject', 'listProjects', 'softDeleteProject', 'updateProject',
  ])
  await service.listProjects()
  await service.createProject({ projectName: '项目' })
  await service.updateProject('P001', { projectName: '新项目' })
  assert.equal(await service.softDeleteProject('P001'), 'P001')
  assert.deepEqual(calls, [
    ['list_projects_secure'],
    ['create_project_secure', { p_project: { projectName: '项目' } }],
    ['update_project_secure', { p_project_id: 'P001', p_patch: { projectName: '新项目' } }],
    ['soft_delete_project_secure', { p_project_id: 'P001' }],
  ])
})
~~~

- [ ] **Step 2: Run RED**

Run: node --test src/services/projectService.test.js

Expected: current getList/create/update aliases do not call the secure RPC names.

- [ ] **Step 3: Replace the generic CRUD proxy**

Follow EmployeeAdminError style: ProjectServiceError codes CONFIGURATION_ERROR, PROJECT_INPUT_INVALID, PROJECT_RESPONSE_INVALID, AUTH_SESSION_INVALID, ACCESS_DENIED, PROJECT_OPERATION_FAILED. list must receive an array of plain objects; create must reject any supplied projectId; update must reject projectId in the patch; project-returning RPCs must match the requested ID. soft delete must receive exactly the requested ID string. Never retry through baseRecordService and never read/write localStorage.

~~~js
export function createProjectService(client, { configured = Boolean(client) } = {}) {
  async function call(name, args) {
    if (!configured || typeof client?.rpc !== 'function') throw projectError('CONFIGURATION_ERROR')
    const result = args === undefined ? await client.rpc(name) : await client.rpc(name, args)
    if (result?.error) throw normalizeProjectError(result.error)
    return result?.data
  }
  return Object.freeze({
    async listProjects() {
      const data = await call('list_projects_secure')
      if (!Array.isArray(data) || data.some((row) => !isPlainObject(row))) {
        throw projectError('PROJECT_RESPONSE_INVALID')
      }
      return data
    },
    async createProject(project) {
      const input = requirePlainProject(project)
      if (Object.hasOwn(input, 'projectId')) throw projectError('PROJECT_INPUT_INVALID')
      return requireNewProjectResponse(await call('create_project_secure', { p_project: input }))
    },
    async updateProject(projectId, patch) {
      const id = requireProjectId(projectId)
      const input = requirePlainProject(patch)
      if (Object.hasOwn(input, 'projectId')) throw projectError('PROJECT_INPUT_INVALID')
      return requireProjectResponse(await call('update_project_secure', {
        p_project_id: id,
        p_patch: input,
      }), id)
    },
    async softDeleteProject(projectId) {
      const id = requireProjectId(projectId)
      const deletedId = await call('soft_delete_project_secure', {
        p_project_id: id,
      })
      if (deletedId !== id) throw projectError('PROJECT_RESPONSE_INVALID')
      return deletedId
    },
  })
}
~~~

- [ ] **Step 4: Run GREEN and commit**

Run: node --test src/services/projectService.test.js

Expected: all RPC, validation, and safe-error cases pass.

~~~bash
git add src/services/projectService.js src/services/projectService.test.js
git commit -m "refactor: route projects through secure RPCs"
~~~

### Task 7: Remove direct project mappings, make legacy conversion transactional, and quarantine migration UI

**Files:**
- Modify: src/services/baseRecordService.js
- Modify: src/services/baseRecordService.test.js
- Modify: src/services/recordTableConfig.js
- Create: src/services/recordTableConfig.test.js
- Modify: src/services/dashboardService.js
- Create: src/services/dashboardService.test.js
- Modify: src/services/contractRevenueMigration.js
- Modify: src/services/contractRevenueMigration.test.js
- Create: scripts/migrate-legacy-project-contracts.mjs
- Create: scripts/migrate-legacy-project-contracts.test.mjs
- Delete: src/services/contractRevenueLocalMigration.js
- Delete: src/services/contractRevenueLocalMigration.test.js
- Delete: src/features/contract-revenue/ContractRevenueMigrationPanel.jsx
- Modify: src/features/contract-revenue/contractRevenueMigrationPanel.test.js
- Modify: src/App.jsx:1-42,2475-2510,2760-2875,7519-7800

**Interfaces:**
- recordTableConfigs has no entries for erp.projects, erp.projectContractChanges, erp.projectPaymentPlans, or erp.projectReceipts; baseRecordService never accepts any of those keys through getList/getById/create/update/softDelete/saveList/upsertRecord/migrateLocalStorageToSupabase.
- getDashboardSourceData({ projects }) consumes the already-authorized project projection supplied by App and never loads projects itself.
- createContractRevenueMigrationService(client, { configured }) returns { migrateLegacyProjectContract } inside contractRevenueMigration.js; this dedicated migration client is not part of projectService.
- persistLegacyContractRevenueMigration(preview, { migrateLegacyProjectContract }) delegates each project to migrate_legacy_project_contract_secure; one project is one database transaction and an identical retry is idempotent.
- scripts/migrate-legacy-project-contracts.mjs consumes an administrator-exported JSON backup file, never browser localStorage, and invokes the dedicated migration client with an authenticated whitelist/update account.
- The released settings page has no ContractRevenueMigrationPanel, generic sensitive-key upload, local project/receipt preview, backup reader, or state rehydration callback.

- [ ] **Step 1: Write failing direct-access and decommission contracts**

~~~js
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'

const [baseSource, configSource, dashboardSource, appSource, migrationSource] =
  await Promise.all([
    readFile(new URL('./baseRecordService.js', import.meta.url), 'utf8'),
    readFile(new URL('./recordTableConfig.js', import.meta.url), 'utf8'),
    readFile(new URL('./dashboardService.js', import.meta.url), 'utf8'),
    readFile(new URL('../App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./contractRevenueMigration.js', import.meta.url), 'utf8'),
  ])

test('no production generic service or dashboard path targets projects', () => {
  for (const key of [
    'erp.projects',
    'erp.projectContractChanges',
    'erp.projectPaymentPlans',
    'erp.projectReceipts',
  ]) {
    assert.equal(configSource.includes(key), false)
    assert.equal(baseSource.includes(key), false)
  }
  assert.doesNotMatch(dashboardSource, /getList\(['"]erp\.projects['"]\)/)
  assert.doesNotMatch(migrationSource, /upsertRecord|saveList|['"]erp\.projects['"]/)
})

test('released settings and source contain no local contract migration UI', async () => {
  assert.doesNotMatch(appSource, /ContractRevenueMigrationPanel/)
  assert.doesNotMatch(appSource, /onLocalContractRevenueMigrationComplete/)
  assert.doesNotMatch(appSource, /localStorage → Supabase 数据迁移/)
  await assert.rejects(
    stat(new URL('../features/contract-revenue/ContractRevenueMigrationPanel.jsx', import.meta.url)),
    (error) => error?.code === 'ENOENT',
  )
  await assert.rejects(
    stat(new URL('./contractRevenueLocalMigration.js', import.meta.url)),
    (error) => error?.code === 'ENOENT',
  )
})
~~~

baseRecordService.test.js must call every generic operation with each of the four runtime-sensitive keys and expect STORAGE_KEY_NOT_ALLOWED before client.from; migrateLocalStorageToSupabase must skip all four. dashboardService.test.js injects [{ projectId: 'P001' }] and proves no generic project call is made. contractRevenueMigration.test.js must prove one migrateLegacyProjectContract call contains projectId, expectedLegacyContract, and deterministic openingReceipt; a replay result with contractRevenueSchemaVersion=1 counts as migrated without another receipt.

- [ ] **Step 2: Run RED**

Run: node --test src/services/baseRecordService.test.js src/services/recordTableConfig.test.js src/services/dashboardService.test.js src/services/contractRevenueMigration.test.js src/features/contract-revenue/contractRevenueMigrationPanel.test.js

Expected: current config/dashboard/migration/settings code still contains direct/local project paths.

- [ ] **Step 3: Remove generic project mapping and inject safe dashboard projects**

Delete all four project/contract-revenue entries from src/services/recordTableConfig.js and remove the same four keys from LEGACY_MIGRATION_ALLOWED_STORAGE_KEYS in src/services/baseRecordService.js. Task 8 moves normal contract-revenue CRUD to explicit table adapters protected by fixed RLS; generic CRUD/local migration must not recognize any sensitive key.

Replace dashboardService project loading with the exact dependency:

~~~js
import { getList } from './baseRecordService.js'

export async function getDashboardSourceData({ projects = [] } = {}) {
  if (!Array.isArray(projects)) throw new TypeError('projects必须是安全项目数组')
  const [
    employees,
    laborRecords,
    purchaseRecords,
    inventoryItems,
    vehicleUsageRecords,
    lifelongToolAssignments,
    toolResponsibilityRecords,
  ] = await Promise.all([
    getList('erp.employees'),
    getList('erp.laborRecords'),
    getList('erp.purchaseRecords'),
    getList('erp.inventoryItems'),
    getList('erp.vehicleUsageRecords'),
    getList('erp.lifelongToolAssignments'),
    getList('erp.toolResponsibilityRecords'),
  ])
  return {
    employees: employees || [],
    projects,
    laborRecords: laborRecords || [],
    purchaseRecords: purchaseRecords || [],
    inventoryItems: inventoryItems || [],
    vehicleUsageRecords: vehicleUsageRecords || [],
    lifelongToolAssignments: lifelongToolAssignments || [],
    toolResponsibilityRecords: toolResponsibilityRecords || [],
  }
}
~~~

- [ ] **Step 4: Route legacy conversion through one transactional/re-entrant RPC**

Keep previewLegacyContractRevenueMigration as a pure function over explicitly supplied arrays. Replace its persistence adapter with:

~~~js
export function createContractRevenueMigrationService(
  client,
  { configured = Boolean(client) } = {},
) {
  return Object.freeze({
    async migrateLegacyProjectContract({
      projectId,
      expectedLegacyContract,
      openingReceipt,
    }) {
      if (!configured || typeof client?.rpc !== 'function') {
        throw new Error('合同迁移服务未配置')
      }
      const result = await client.rpc('migrate_legacy_project_contract_secure', {
        p_project_id: projectId,
        p_expected_legacy_contract: expectedLegacyContract,
        p_opening_receipt: openingReceipt,
      })
      if (result?.error) throw new Error('合同迁移失败，请刷新后重试')
      if (
        !result?.data ||
        typeof result.data !== 'object' ||
        result.data.projectId !== projectId
      ) throw new Error('合同迁移服务响应无效')
      return result.data
    },
  })
}

export async function persistLegacyContractRevenueMigration(
  preview,
  { migrateLegacyProjectContract },
) {
  if (typeof migrateLegacyProjectContract !== 'function') {
    throw new TypeError('migrateLegacyProjectContract不能为空')
  }
  const items = Array.isArray(preview?.items) ? preview.items : []
  const projects = []
  for (const item of items) {
    projects.push(await migrateLegacyProjectContract({
      projectId: item.project.projectId,
      expectedLegacyContract: {
        contractAmount: item.legacyContractAmount,
        paidAmount: item.legacyPaidAmount,
      },
      openingReceipt: item.openingReceipt,
    }))
  }
  return {
    migratedProjectCount: projects.length,
    projects,
  }
}
~~~

Ensure preview items retain legacyContractAmount and legacyPaidAmount solely for the compare-and-swap RPC, while project contains the sanitized target. The database function from Task 5 owns receipt+project atomicity and replay detection; JavaScript must not write the receipt and project separately.

Implement the one-off script with required --input /absolute/backup.json, VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, MIGRATION_EMPLOYEE_NUMBER, and a prompted/non-logged password; authenticate, preview, call persistLegacyContractRevenueMigration, print only project IDs/counts, and return nonzero on any exception. Its test injects a fake migration service and proves two executions send identical RPC payloads and log no contract amounts/password/token.

- [ ] **Step 5: Stop for the mandatory human data-preservation checkpoint**

Do not delete the old UI, add the five-key purge effect, or deploy the new frontend yet. With the administrator and user:

1. export and record the absolute backup location from the old release;
2. apply the database RPC migration;
3. run the one-off transactional script against that backup;
4. compare server project/receipt counts with the preview and inspect at least three migrated projects, including one zero-paid and one opening-receipt case;
5. replay the script and confirm zero duplicate receipts/no changed project payloads;
6. record the evidence and obtain explicit user confirmation that migration and backup are accepted.

Expected checkpoint result: a written confirmation containing backup path, preview/server counts, sampled project IDs, replay result, and approver. Without that confirmation, stop: do not perform Step 6, Task 8 purge wiring, or frontend deployment.

- [ ] **Step 6: Remove all released local migration/read-back UI after confirmation**

Delete src/services/contractRevenueLocalMigration.js, its test, and ContractRevenueMigrationPanel.jsx. Rewrite contractRevenueMigrationPanel.test.js as the decommission contract from Step 1. Remove its import/render, storageKeys prop, onLocalContractRevenueMigrationComplete, handleMigration, migrationResults, migrateLocalStorageToSupabase call, and the entire “localStorage → Supabase 数据迁移” section from SystemSettingsPage. Keep only cloud configuration status and SW-000 recovery-account information. The old release is the administrator-controlled pre-deployment migration tool; the new release must not read, upload, restore, or rehydrate any sensitive legacy key.

- [ ] **Step 7: Run GREEN and commit**

Run: node --test src/services/baseRecordService.test.js src/services/recordTableConfig.test.js src/services/dashboardService.test.js src/services/contractRevenueMigration.test.js scripts/migrate-legacy-project-contracts.test.mjs src/features/contract-revenue/contractRevenueMigrationPanel.test.js

Expected: all pass and no production generic project path remains.

~~~bash
git add src/services/baseRecordService.js src/services/baseRecordService.test.js src/services/recordTableConfig.js src/services/recordTableConfig.test.js src/services/dashboardService.js src/services/dashboardService.test.js src/services/contractRevenueMigration.js src/services/contractRevenueMigration.test.js scripts/migrate-legacy-project-contracts.mjs scripts/migrate-legacy-project-contracts.test.mjs src/services/contractRevenueLocalMigration.js src/services/contractRevenueLocalMigration.test.js src/features/contract-revenue/ContractRevenueMigrationPanel.jsx src/features/contract-revenue/contractRevenueMigrationPanel.test.js src/App.jsx
git commit -m "security: remove direct and local project data paths"
~~~

### Task 8: Session-memory-only project/revenue state and legacy-key purge

**Files:**
- Create: src/services/sensitiveRuntimeCache.js
- Create: src/services/sensitiveRuntimeCache.test.js
- Modify: src/services/contractRevenueService.js:35-155
- Modify: src/services/contractRevenueService.test.js
- Modify: src/App.jsx:38-42,1270-1371,1674-1696,1908-1914,2227-2250

**Interfaces:**
- SENSITIVE_RUNTIME_STORAGE_KEYS is exactly the four specified keys.
- CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY is exactly erp.contractRevenueMigrationBackups and is explicitly not a runtime key.
- LEGACY_PROJECT_SENSITIVE_STORAGE_KEYS combines the four runtime keys plus the one migration-backup key.
- clearLegacyProjectBrowserData(storage) removes all five and returns the removed key list.
- contractRevenueService persists original-contract project changes through projectService.updateProject and uses explicit Supabase table adapters for project_contract_changes, project_payment_plans, and project_receipts; it never calls baseRecordService or uses erp.* storage keys.
- This task begins only after Task 7 Step 5 has recorded explicit user approval; the purge effect ships only with the final cutover frontend.

- [ ] **Step 1: Write failing storage and service tests**

~~~js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY,
  LEGACY_PROJECT_SENSITIVE_STORAGE_KEYS,
  SENSITIVE_RUNTIME_STORAGE_KEYS,
  clearLegacyProjectBrowserData,
} from './sensitiveRuntimeCache.js'

test('distinguishes four runtime keys and purges those plus the migration backup', () => {
  const removed = []
  const storage = { removeItem: (key) => removed.push(key) }
  assert.deepEqual(SENSITIVE_RUNTIME_STORAGE_KEYS, [
    'erp.projects',
    'erp.projectContractChanges',
    'erp.projectPaymentPlans',
    'erp.projectReceipts',
  ])
  assert.equal(
    CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY,
    'erp.contractRevenueMigrationBackups',
  )
  assert.equal(SENSITIVE_RUNTIME_STORAGE_KEYS.includes(
    CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY,
  ), false)
  assert.deepEqual(clearLegacyProjectBrowserData(storage), [
    ...SENSITIVE_RUNTIME_STORAGE_KEYS,
    'erp.contractRevenueMigrationBackups',
  ])
  assert.deepEqual(removed, LEGACY_PROJECT_SENSITIVE_STORAGE_KEYS)
})
~~~

Extend contractRevenueService.test.js so persistProject removes projectId, sends only the exact financial source-field allowlist, drops stale project-master and derived snapshot fields, and calls an injected updateProject(projectId, patch). For each revenue collection, assert the service uses the exact explicit table name/select/upsert shape, relies on fixed RLS, and contains no baseRecordService import or erp.* storage key. Add a source contract proving App does not pass any of the five legacy-sensitive keys to usePersistentState, readStorage, localStorage.getItem, or localStorage.setItem.

- [ ] **Step 2: Run RED**

Run: node --test src/services/sensitiveRuntimeCache.test.js src/services/contractRevenueService.test.js

Expected: module missing and persistProject still upserts erp.projects.

- [ ] **Step 3: Implement purge and secure original-contract persistence**

~~~js
export const SENSITIVE_RUNTIME_STORAGE_KEYS = Object.freeze([
  'erp.projects',
  'erp.projectContractChanges',
  'erp.projectPaymentPlans',
  'erp.projectReceipts',
])

export const CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY =
  'erp.contractRevenueMigrationBackups'

export const LEGACY_PROJECT_SENSITIVE_STORAGE_KEYS = Object.freeze([
  ...SENSITIVE_RUNTIME_STORAGE_KEYS,
  CONTRACT_REVENUE_MIGRATION_BACKUP_STORAGE_KEY,
])

export function clearLegacyProjectBrowserData(storage = globalThis.localStorage) {
  if (!storage || typeof storage.removeItem !== 'function') return []
  for (const key of LEGACY_PROJECT_SENSITIVE_STORAGE_KEYS) storage.removeItem(key)
  return [...LEGACY_PROJECT_SENSITIVE_STORAGE_KEYS]
}
~~~

Inject updateProject and a Supabase client into createContractRevenueService. persistProject sanitizes read-model snapshot fields, extracts projectId, then builds a fresh patch containing only the exact financial source-field allowlist from Task 5; it must not resend stale project-master fields or any derived snapshot field. It calls updateProject(projectId, patch) and returns the server response. Implement load/create/update/void for changes/plans/receipts directly against project_contract_changes, project_payment_plans, and project_receipts, validating record_key/payload/status envelopes and relying on Task 5 fixed RLS. Remove CONTRACT_REVENUE_STORAGE_KEYS and every baseRecordService dependency; no production code outside sensitiveRuntimeCache.js may contain an erp.project* key.

In AuthenticatedApp, replace the four usePersistentState calls with useState([]), load listProjects plus the three contract list methods into memory after authentication, and call clearLegacyProjectBrowserData once in an effect. Remove refreshStoredProjectsFromLocal, refreshProjectReceiptsFromLocal, createLocalStorageUpsertRecord, backup reads, and every local migration completion callback that repopulates runtime state from localStorage. The pre-deployment backup is consumed by the old release/administrator workflow; after deployment the new release removes it and has no read, restore, upload, or rehydration path.

- [ ] **Step 4: Run GREEN and commit**

Run: node --test src/services/sensitiveRuntimeCache.test.js src/services/contractRevenueService.test.js src/services/persistenceSecurityContract.test.js

Expected: all pass and source scan finds no live sensitive cache path.

~~~bash
git add src/services/sensitiveRuntimeCache.js src/services/sensitiveRuntimeCache.test.js src/services/contractRevenueService.js src/services/contractRevenueService.test.js src/App.jsx
git commit -m "security: keep project financial state in session memory"
~~~

### Task 9: Extract ProjectPage and implement project form/card UI

**Files:**
- Create: src/features/projects/ProjectPage.jsx
- Create: src/features/projects/projectPageContract.test.js
- Modify: src/App.jsx:2941-3195
- Modify: src/styles.css

**Interfaces:**
- ProjectPage props are exactly { projects, projectRevenueSnapshots, currentUser, employeeDirectory, directoryState, onRetryDirectory, onCreateProject, onUpdateProject, onDeleteProject, onOpenContractRevenue, onBack }.
- Mutation callbacks are async and resolve to the server-returned safe project projection; the page never applies optimistic insertion/deletion.

- [ ] **Step 1: Write the UI source contract**

~~~js
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./ProjectPage.jsx', import.meta.url), 'utf8').catch(() => '')

test('project page has new fields, fixed copy, and no editable amount', () => {
  for (const copy of [
    '设计担当', '现场担当', '开工日期', '工程结束日期',
    '地址定位', '打卡范围', '历史负责人',
  ]) assert.match(source, new RegExp(copy))
  assert.doesNotMatch(source, /label=["']开始日期|>开始日期</)
  assert.doesNotMatch(source, /name=["']projectAmount|label=["']项目金额/)
  assert.doesNotMatch(source, /获取当前位置|navigator\.geolocation/)
})

test('financial cards and contract entry are gated as one block', () => {
  assert.match(source, /canViewProjectFinancials\(currentUser\)/)
  assert.match(source, /adjustedTaxInclusiveAmount/)
  assert.match(source, /未录入/)
  assert.match(source, /合同收入/)
  assert.doesNotMatch(source, /无金额权限/)
})
~~~

- [ ] **Step 2: Run RED**

Run: node --test src/features/projects/projectPageContract.test.js

Expected: assertions fail because ProjectPage is still inside App.jsx.

- [ ] **Step 3: Implement async form behavior**

ProjectPage initializes createEmptyProject(), uses updateProjectAddress for typing, renders ProjectLocationPicker only while the form is open, confirms map/geocoder points with confirmProjectLocation, and uses assignProjectEmployee on select changes. Directory loading disables both selects; directory error clears options, displays “规范员工目录加载失败” with a 重试 button, preserves stored assignee names as read-only text, and never falls back to erp.employees.

On submit:

~~~js
const issues = validateProjectForSave(form)
if (issues.length > 0) {
  setError(issues[0].message)
  if (issues[0].field === 'location') locationSectionRef.current?.focus()
  return
}
setSaving(true)
setError('')
try {
  const payload = buildProjectPayload(form)
  if (editingProjectId) await onUpdateProject(editingProjectId, payload)
  else await onCreateProject(payload)
  resetForm()
} catch (operationError) {
  setError(operationError?.name === 'ProjectServiceError'
    ? operationError.message
    : '项目保存失败，请稍后重试')
} finally {
  setSaving(false)
}
~~~

Do not automatically open contract revenue after creating a project. Only a financially authorized user sees the contract button and may open it explicitly.

- [ ] **Step 4: Implement cards and compatibility**

Cards show location confirmed/unconfirmed, radius, design/site snapshot names, 开工日期, end date, and remark. If siteAssigneeName is empty and manager exists, render 历史负责人: manager. Compute the revenue read model only when canViewProjectFinancials(currentUser) is true; render 项目金额, 已收款, 收款进度, status, and 合同收入 within that same conditional. If adjustedTaxInclusiveAmount is absent/non-positive, show 未录入 instead of ¥0. Unauthorized users receive no financial labels, placeholder, or entry button.

Delete waits for confirmation and onDeleteProject; remove the card only after the callback resolves. Editing/deleting buttons follow module create/update/delete permissions already on currentUser.

- [ ] **Step 5: Run focused suite/build and commit**

Run: node --test src/features/projects/projectDomain.test.js src/features/projects/projectPageContract.test.js src/features/projects/projectLocationPickerContract.test.js

Expected: all pass.

Run: npm run build

Expected: exit 0.

~~~bash
git add src/features/projects/ProjectPage.jsx src/features/projects/projectPageContract.test.js src/App.jsx src/styles.css
git commit -m "feat: add project master and location page"
~~~

### Task 10: Authenticated App composition, canonical directory retry, and regression verification

**Files:**
- Modify: src/App.jsx:1-42,1638-1970,2035-2350
- Create: src/features/projects/projectAppIntegration.test.js
- Modify: src/features/contract-revenue/appRevenueIntegration.test.js
- Modify: src/features/contract-revenue/ContractRevenuePage.jsx
- Modify: src/features/contract-revenue/contractRevenuePage.test.js
- Modify: src/dashboardLayout.test.js
- Modify: README.md

**Interfaces:**
- App may load listProjects() after authentication because HomePage/DashboardPage need project master data. It must not preload employee_directory globally.
- employeeAdminService.listEmployeeDirectory() runs independently only when currentView === 'projects'; leaving that view clears candidates, and retry invokes only the directory request.
- App calls loadContractChanges(), loadPaymentPlans(), and loadProjectReceipts() only when canViewProjectFinancials(currentUser) is true. A non-whitelist identity clears all three arrays and performs zero financial-table calls.
- ProjectPage receives the exact props defined in Task 9. All successful project mutations replace/insert/remove state using server-returned projections.
- Revenue snapshot construction, projectRevenueProjects, HomePage/DashboardPage financial inputs, DashboardPage financial/profit rendering, openContractRevenue, and the contractRevenue route all use the same canViewProjectFinancials result and fail closed.

- [ ] **Step 1: Add failing integration contracts**

Assert App imports the extracted ProjectPage/projectService/cache purge, contains no local function ProjectPage, calls employee_directory only when entering projects, clears candidates on exit, exposes an independent directory retry, keeps project/revenue arrays in useState, and never reads any of the five legacy-sensitive keys into those arrays. With a non-whitelist currentUser, assert the three contract load functions are not called, their arrays are empty, buildProjectRevenueSnapshotCollection is not invoked, HomePage receives raw secure projects, DashboardPage receives canViewFinancials=false, and ContractRevenuePage is unreachable. With a whitelist currentUser, assert the three financial loads run; mutation controls additionally require canUpdateProjectFinancials(currentUser).

- [ ] **Step 2: Run RED**

Run: node --test src/features/projects/projectAppIntegration.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/features/contract-revenue/contractRevenuePage.test.js src/dashboardLayout.test.js

Expected: contracts fail against the old App composition and ungated contract route.

- [ ] **Step 3: Wire secure loading/mutations**

Create refreshProjects and refreshProjectDirectory with separate request-generation refs so stale/unmounted responses cannot reopen data. refreshProjects may run after authentication; refreshProjectDirectory runs only for currentView projects. A failed projects/revenue request sets the existing persistenceFailure and clears the relevant arrays. A directory failure only clears candidates, sets its retryable error, and leaves project snapshot names visible.

Gate financial loading and snapshot calculation before any supplier call:

~~~js
const canViewFinancials = canViewProjectFinancials(currentUser)

useEffect(() => {
  let active = true
  if (!canViewFinancials) {
    setProjectContractChanges([])
    setProjectPaymentPlans([])
    setProjectReceipts([])
    return () => { active = false }
  }
  Promise.all([
    loadContractChanges(),
    loadPaymentPlans(),
    loadProjectReceipts(),
  ]).then(([changes, plans, receipts]) => {
    if (!active) return
    setProjectContractChanges(changes)
    setProjectPaymentPlans(plans)
    setProjectReceipts(receipts)
  }).catch((error) => {
    if (!active) return
    setProjectContractChanges([])
    setProjectPaymentPlans([])
    setProjectReceipts([])
    setPersistenceFailure(toSafePersistenceFailure(error))
  })
  return () => { active = false }
}, [canViewFinancials])

const projectRevenueSnapshots = useMemo(
  () => canViewFinancials
    ? buildProjectRevenueSnapshotCollection(
      projects,
      projectContractChanges,
      projectPaymentPlans,
      projectReceipts,
    )
    : new Map(),
  [
    canViewFinancials,
    projects,
    projectContractChanges,
    projectPaymentPlans,
    projectReceipts,
  ],
)
~~~

Use server responses:

~~~js
const handleCreateProject = async (payload) => {
  const created = await createProject(payload)
  setStoredProjects((current) => [created, ...current.filter(
    (project) => project.projectId !== created.projectId
  )])
  return created
}

const handleUpdateProject = async (projectId, patch) => {
  const updated = await updateProject(projectId, patch)
  setStoredProjects((current) => current.map(
    (project) => project.projectId === projectId ? updated : project
  ))
  return updated
}

const handleDeleteProject = async (projectId) => {
  await softDeleteProject(projectId)
  setStoredProjects((current) => current.filter(
    (project) => project.projectId !== projectId
  ))
}
~~~

Pass raw secure projects to HomePage for every user. Pass canViewFinancials and whitelist-only projectRevenueProjects to DashboardPage; when false, DashboardPage must use empty financialScopeProjects, return empty financialStats/profitStats, and not render their sections. Guard openContractRevenue and the contract route with canViewFinancials. Pass canUpdateFinancials=canUpdateProjectFinancials(currentUser) to ContractRevenuePage and its sections so mutation controls are absent when false. Server RLS/RPC remains the decisive check.

- [ ] **Step 4: Document deployment and manual acceptance**

README order must be: use the old release to export and record the backup; deploy 202607150001 database RPC/security migration; run the one-off transactional/re-entrant migration script; verify counts, three samples, and replay; obtain explicit user approval; only then remove the old UI and deploy the new frontend; first authenticated startup removes the four runtime keys plus erp.contractRevenueMigrationBackups (five total). State that frontend-before-approval deployment is forbidden and the released settings page cannot restore the removed backup.

Manual browser acceptance must cover: create/edit; all seven statuses; 待开工/进行中 focus on missing location; successful lookup; no-result/error preserving old point; map click/drag; 300 m default; changed address stale message; design/site candidate filters and directory retry; legacy manager; 开工日期 copy; white/nonwhite financial rendering; and localStorage inspection across logout/login.

- [ ] **Step 5: Run the full fresh verification**

Run: npm test

Expected: all Node tests pass, 0 fail.

Run: npm run build

Expected: Vite exits 0 with no build errors.

Run: rg -n "(getList|getById|create|update|softDelete|saveList|upsertRecord)\\(['\"]erp\\.projects|['\"]erp\\.projects['\"]\\s*:\\s*\\{\\s*tableName" src --glob '!**/*.test.js'

Expected: no matches; production generic project CRUD/mapping is zero.

Run: rg -n "\\.from\\(['\"]projects['\"]\\)|tableName:\\s*['\"]projects['\"]" src --glob '!**/*.test.js'

Expected: no matches; production browser services have no direct projects table client.

Run: rg -n "localStorage\\.(getItem|setItem)\\([^\\n]*(erp\\.projects|erp\\.projectContractChanges|erp\\.projectPaymentPlans|erp\\.projectReceipts|erp\\.contractRevenueMigrationBackups)" src --glob '!**/*.test.js'

Expected: no production-source matches.

Run: rg -n "erp\\.projects|erp\\.projectContractChanges|erp\\.projectPaymentPlans|erp\\.projectReceipts|erp\\.contractRevenueMigrationBackups" src --glob '!**/*.test.js'

Expected: matches exist only in src/services/sensitiveRuntimeCache.js constants and its explicit removeItem purge; recordTableConfig, baseRecordService, App, dashboardService, migration services, settings, and feature components have zero matches.

Run: git diff --check

Expected: no whitespace errors.

Run: git status --short

Expected: the two pre-existing employee-bootstrap-admin modifications remain unstaged/uncommitted and no task commit contains them.

- [ ] **Step 6: Commit verification/docs fixes only**

~~~bash
git add src/App.jsx src/features/projects/projectAppIntegration.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/features/contract-revenue/ContractRevenuePage.jsx src/features/contract-revenue/contractRevenuePage.test.js src/dashboardLayout.test.js README.md
git commit -m "test: verify project core security workflow"
~~~

## Final execution checkpoint

- [ ] Confirm each task commit excludes supabase/functions/employee-bootstrap-admin/handler.js and supabase/functions/employee-bootstrap-admin/handler.test.js.
- [ ] Confirm the project-documents subsystem is absent from this plan's changes.
- [ ] Confirm npm test and npm run build have fresh passing output.
- [ ] Confirm pgTAP ran against a reset local Supabase instance, or report the exact unavailable dependency without claiming database verification.
- [ ] Confirm a whitelist and ordinary project-view account receive materially different list_projects_secure payloads.
- [ ] Confirm switching accounts in one browser cannot reconstruct project/revenue data from localStorage.
- [ ] Confirm the recorded human checkpoint includes the absolute backup path, preview/server counts, three sampled project IDs, idempotent replay result, and explicit approval before old UI deletion/five-key purge/frontend deployment.

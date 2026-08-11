# Permission-Aware Contract Revenue Runtime Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent every account without contract-finance access from crashing when its authorized project directory omits contract amounts, without weakening finance validation or changing permissions/data.

**Architecture:** Preserve the closed four-field project reference projection for relation-only accounts, instead of adding zero-valued finance fields during full-project normalization. Add one pure permission adapter immediately in front of the existing strict contract-revenue snapshot collection. `AuthenticatedApp` passes the effective contract-revenue view bit into that adapter and includes both access bits in memo dependencies, so login/permission changes recompute from a clean state. The domain calculator remains unchanged and continues rejecting invalid data for authorized finance users.

**Tech Stack:** React 19, JavaScript ES modules, Node test runner, Vite 6, Vercel.

## Global Constraints

- Do not modify database rows, migrations, department permissions, position permissions, or user permissions.
- An account without contract-finance view permission must not invoke contract-revenue calculations.
- An authorized finance account must retain the existing strict validation behavior.
- Do not catch and suppress arbitrary contract-revenue errors or convert invalid authorized finance data to zero.
- The fix must apply to all departments, positions, accounts, browsers, and devices through the shared authenticated runtime.
- Follow strict RED-GREEN-REFACTOR: observe the regression test fail before editing implementation code.

---

### Task 1: Permission-aware project and contract-revenue runtime

**Files:**
- Create: `src/features/contract-revenue/contractRevenueRuntime.js`
- Create: `src/features/contract-revenue/contractRevenueRuntime.test.js`
- Modify: `src/App.jsx:7-13,3286-3297`
- Modify: `src/features/contract-revenue/appRevenueIntegration.test.js:7-22`

**Interfaces:**
- Consumes: `buildProjectRevenueSnapshotCollection(projects, changes, plans, receipts) => Map` from `contractRevenueCalculations.js`.
- Produces: `buildProjectRevenueSnapshotsForAccess({ canViewRevenue, projects, changes, plans, receipts }) => Map`.
- `canViewRevenue === false` returns a fresh empty `Map` before any project validation.
- `canViewRevenue === true` delegates unchanged arrays to the strict domain calculator.

- [ ] **Step 1: Write the failing permission-adapter tests**

Create `src/features/contract-revenue/contractRevenueRuntime.test.js`:

```js
import assert from 'node:assert/strict'
import test from 'node:test'

import { ContractRevenueValidationError } from './contractRevenueValidation.js'
import { buildProjectRevenueSnapshotsForAccess } from './contractRevenueRuntime.js'

const projectedProject = Object.freeze({
  projectId: 'P-REFERENCE',
  projectName: '关联项目',
  status: '进行中',
  address: 'Tokyo',
})

test('denied revenue access skips strict calculations for projected projects', () => {
  const snapshots = buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: false,
    projects: [projectedProject],
  })

  assert.ok(snapshots instanceof Map)
  assert.equal(snapshots.size, 0)
  assert.equal(Object.hasOwn(projectedProject, 'contractAmount'), false)
  assert.equal(Object.hasOwn(projectedProject, 'paidAmount'), false)
})

test('authorized revenue access retains strict contract validation', () => {
  assert.throws(
    () => buildProjectRevenueSnapshotsForAccess({
      canViewRevenue: true,
      projects: [{ ...projectedProject, contractAmount: 0, paidAmount: 0 }],
    }),
    (error) => error instanceof ContractRevenueValidationError &&
      error.field === 'contractAmount',
  )
})

test('revoking revenue access returns a fresh empty snapshot collection', () => {
  const authorized = buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: true,
    projects: [{
      projectId: 'P-FULL',
      projectName: '完整项目',
      contractAmount: 500000,
      paidAmount: 0,
    }],
  })
  const denied = buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: false,
    projects: [projectedProject],
  })

  assert.equal(authorized.size, 1)
  assert.equal(denied.size, 0)
  assert.notEqual(denied, authorized)
})
```

- [ ] **Step 2: Run the new test and capture RED**

Run:

```bash
node --test src/features/contract-revenue/contractRevenueRuntime.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `contractRevenueRuntime.js`; this proves the test precedes implementation.

- [ ] **Step 3: Implement the minimal permission adapter**

Create `src/features/contract-revenue/contractRevenueRuntime.js`:

```js
import { buildProjectRevenueSnapshotCollection } from './contractRevenueCalculations.js'

export function buildProjectRevenueSnapshotsForAccess({
  canViewRevenue,
  projects = [],
  changes = [],
  plans = [],
  receipts = [],
} = {}) {
  if (!canViewRevenue) return new Map()
  return buildProjectRevenueSnapshotCollection(projects, changes, plans, receipts)
}
```

- [ ] **Step 4: Run the adapter tests and capture GREEN**

Run:

```bash
node --test src/features/contract-revenue/contractRevenueRuntime.test.js
```

Expected: 3 tests pass. The denied test must not throw, and the authorized invalid-data test must still throw `ContractRevenueValidationError`.

- [ ] **Step 5: Add an App wiring regression assertion**

Update the first test in `src/features/contract-revenue/appRevenueIntegration.test.js` to assert all of the following source contracts:

```js
assert.match(
  appSource,
  /import \{ buildProjectRevenueSnapshotsForAccess \} from '.\/features\/contract-revenue\/contractRevenueRuntime\.js'/u,
)
assert.match(
  appSource,
  /buildProjectRevenueSnapshotsForAccess\(\{[\s\S]*?canViewRevenue:\s*contractRevenueAccess\.view,[\s\S]*?projects,[\s\S]*?changes:\s*projectContractChanges,[\s\S]*?plans:\s*projectPaymentPlans,[\s\S]*?receipts:\s*projectReceipts,[\s\S]*?\}\)/u,
)
assert.match(
  appSource,
  /\[projects, projectContractChanges, projectPaymentPlans, projectReceipts, contractRevenueAccess\.view\]/u,
)
assert.match(
  appSource,
  /projectReferenceAccess\.full[\s\S]*?storedProjects\.map\(\(project\) => normalizeProject\(project\)\)[\s\S]*?:[\s\S]*?storedProjects\.map\(\(project\) => \(\{ \.\.\.project \}\)\)/u,
)
```

Remove the obsolete assertion that `App.jsx` directly calls `buildProjectRevenueSnapshotCollection`.

- [ ] **Step 6: Run the App wiring test and capture RED**

Run:

```bash
node --test src/features/contract-revenue/appRevenueIntegration.test.js
```

Expected: FAIL because `App.jsx` still normalizes relation-only references as full projects and calls the strict calculator directly.

- [ ] **Step 7: Wire the adapter into the shared authenticated runtime**

In `src/App.jsx`, preserve the closed project-reference DTO for relation-only accounts:

```js
const projects = useMemo(
  () => projectReferenceAccess.full
    ? storedProjects.map((project) => normalizeProject(project))
    : storedProjects.map((project) => ({ ...project })),
  [storedProjects, projectReferenceAccess.full],
)
```

Then replace the revenue imports and memo wiring:

```js
import { buildProjectRevenueReadModel } from './features/contract-revenue/contractRevenueCalculations'
import { buildProjectRevenueSnapshotsForAccess } from './features/contract-revenue/contractRevenueRuntime.js'
```

Replace the existing snapshot memo body with:

```js
const projectRevenueSnapshots = useMemo(
  () => buildProjectRevenueSnapshotsForAccess({
    canViewRevenue: contractRevenueAccess.view,
    projects,
    changes: projectContractChanges,
    plans: projectPaymentPlans,
    receipts: projectReceipts,
  }),
  [
    projects,
    projectContractChanges,
    projectPaymentPlans,
    projectReceipts,
    contractRevenueAccess.view,
  ],
)
```

Do not change `buildProjectRevenueSnapshotCollection`, finance permissions, project RPCs, or persisted project values.

- [ ] **Step 8: Run focused tests and inspect the diff**

Run:

```bash
node --test \
  src/features/contract-revenue/contractRevenueRuntime.test.js \
  src/features/contract-revenue/appRevenueIntegration.test.js \
  src/features/contract-revenue/contractRevenueSnapshot.test.js \
  src/features/project-cost-ledger/projectCostLedgerAppIntegration.test.js
git diff --check
git diff -- src/App.jsx src/features/contract-revenue
```

Expected: all focused tests pass; `git diff --check` emits no output; the diff contains only the adapter, its regression tests, and App wiring.

- [ ] **Step 9: Commit the root-cause fix**

```bash
git add \
  src/App.jsx \
  src/features/contract-revenue/contractRevenueRuntime.js \
  src/features/contract-revenue/contractRevenueRuntime.test.js \
  src/features/contract-revenue/appRevenueIntegration.test.js
git commit -m "fix: gate contract revenue runtime by permission"
```

### Task 2: Full verification and production deployment

**Files:**
- Verify only: repository test suite and generated `dist/` output.
- Deploy only: Vercel production project already attached to this worktree.

**Interfaces:**
- Consumes: committed Task 1 revision.
- Produces: a Ready Vercel production deployment attached to `https://shengwang-erp.vercel.app`.

- [ ] **Step 1: Verify the complete repository**

Run:

```bash
npm test
npm run build
git diff --check HEAD~1..HEAD
git status --short
```

Expected: every test passes, the Vite production build succeeds, diff check is clean, and the worktree is clean.

- [ ] **Step 2: Deploy the verified commit to production**

Run:

```bash
vercel --prod --yes
```

Expected: Vercel reports `Ready` and attaches the production alias `https://shengwang-erp.vercel.app`.

- [ ] **Step 3: Verify the live production alias and revision marker**

Run:

```bash
curl -I https://shengwang-erp.vercel.app
vercel inspect https://shengwang-erp.vercel.app
```

Expected: HTTP 200, production deployment state `Ready`, and the alias points at the newly deployed build.

- [ ] **Step 4: User acceptance check**

Ask the user to reload the already-open SW-008 session on computer and then verify the same account on the iPhone home-screen web app. Acceptance requires the homepage to remain usable beyond the previous one-second failure window, while contract-finance data remains hidden.

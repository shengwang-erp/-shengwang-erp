# Project Cost Dialog Portal Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the existing black-gold, centered, desktop-first presentation for all three project cost dialogs rendered through `document.body` portals.

**Architecture:** Keep each dialog portal attached directly to `document.body`, but make the existing backdrop node the black-gold theme host by adding `erp-black-gold` beside `project-cost-dialog-backdrop`. Change only the backdrop CSS selector to target both classes on the same node; all descendant dialog selectors and business behavior remain unchanged.

**Tech Stack:** React 19, React DOM portals, Vite 6, plain CSS, Node.js built-in test runner, PostCSS selector parsing.

## Global Constraints

- Preserve every existing dialog field, permission check, validation rule, submit flow, audit flow, focus trap, Escape behavior, and close behavior.
- Apply the fix to `ProjectCostManualEntryDialog`, `ProjectCostAdjustmentDialog`, and `ProjectCostAllocationDialog`.
- Keep the portal target as `document.body`; do not move the portal under the ERP application container.
- Keep project cost styles scoped to the black-gold theme; do not introduce unscoped global dialog selectors or mutate the `body` theme class.
- Desktop remains the primary environment: 760px maximum width for manual/adjustment dialogs and 900px for allocation; retain the existing 760px single-column breakpoint.
- Do not change the database, API, service interfaces, export logic, or accounting-cost main page.

---

### Task 1: Restore the Portal Theme Contract for All Project Cost Dialogs

**Files:**
- Modify: `src/features/project-cost-ledger/projectCostLedgerDialogs.test.js:466-510`
- Modify: `src/features/project-cost-ledger/ProjectCostLedgerSection.test.js:672-682`
- Modify: `src/features/project-cost-ledger/ProjectCostManualEntryDialog.jsx:94-96`
- Modify: `src/features/project-cost-ledger/ProjectCostAdjustmentDialog.jsx:149-151`
- Modify: `src/features/project-cost-ledger/ProjectCostAllocationDialog.jsx:189-191`
- Modify: `src/features/project-cost-ledger/projectCostLedger.css:388-402,612-618`

**Interfaces:**
- Consumes: React DOM `createPortal(content, document.body)` and the existing `project-cost-dialog-backdrop` DOM contract.
- Produces: A direct `document.body` child whose `classList` contains both `erp-black-gold` and `project-cost-dialog-backdrop`; CSS selector `.erp-black-gold.project-cost-dialog-backdrop` styles that node while existing `.erp-black-gold .project-cost-dialog ...` rules style its descendants.

- [ ] **Step 1: Add a failing DOM regression assertion for all three dialogs**

In `projectCostLedgerDialogs.test.js`, replace the existing direct-body assertion inside `all three StrictMode dialogs focus, trap, escape, restore and inert background accessibly` with:

```js
const backdrop = dialog.parentNode
assert.equal(backdrop.parentNode, dom.document.body, 'modal portal is a direct body child')
assert.ok(backdrop.classList.contains('project-cost-dialog-backdrop'))
assert.ok(backdrop.classList.contains('erp-black-gold'), 'portal root carries the black-gold theme')
```

The existing loop renders adjustment, allocation, and manual dialogs, so one contract assertion covers all three components without duplicating setup.

- [ ] **Step 2: Add a failing CSS selector regression assertion**

In `ProjectCostLedgerSection.test.js`, extend `black-gold CSS enforces the readable table dimensions without white or blue surfaces` immediately after reading the CSS:

```js
assert.match(css, /\.erp-black-gold\.project-cost-dialog-backdrop\s*\{/u)
assert.match(css, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.erp-black-gold\.project-cost-dialog-backdrop\s*\{/u)
```

Keep the existing PostCSS walk that verifies every selector remains black-gold scoped.

- [ ] **Step 3: Run the two focused test files and verify the new assertions fail**

Run:

```bash
node --test src/features/project-cost-ledger/projectCostLedgerDialogs.test.js src/features/project-cost-ledger/ProjectCostLedgerSection.test.js
```

Expected: FAIL because the portal backdrop lacks `erp-black-gold` and the stylesheet still contains the descendant selector `.erp-black-gold .project-cost-dialog-backdrop`.

- [ ] **Step 4: Add the theme class to each portal backdrop**

In each of the three dialog components, change only the portal root class:

```jsx
<div className="erp-black-gold project-cost-dialog-backdrop" role="presentation">
```

Do not add wrapper elements, change the portal target, or alter dialog state and event handlers.

- [ ] **Step 5: Change the backdrop selectors to target the themed node itself**

In `projectCostLedger.css`, change the base selector and the mobile override from:

```css
.erp-black-gold .project-cost-dialog-backdrop
```

to:

```css
.erp-black-gold.project-cost-dialog-backdrop
```

Leave `.erp-black-gold .project-cost-dialog`, all input/button rules, the 760px/900px widths, internal scrolling, and the single-column media rules unchanged.

- [ ] **Step 6: Re-run focused tests and verify they pass**

Run:

```bash
node --test src/features/project-cost-ledger/projectCostLedgerDialogs.test.js src/features/project-cost-ledger/ProjectCostLedgerSection.test.js
```

Expected: PASS, including all existing submit, focus, Escape, inert-background, sizing, and theme-scope assertions.

- [ ] **Step 7: Run the complete automated regression suite**

Run:

```bash
npm test
```

Expected: exit code 0 with no failing Node test files.

- [ ] **Step 8: Build the production bundle**

Run:

```bash
npm run build
```

Expected: Vite production build exits 0 and writes the normal `dist` assets without JSX or CSS errors.

- [ ] **Step 9: Verify the dialogs visually in a desktop browser**

Run the local Vite server:

```bash
npm run dev -- --host 127.0.0.1
```

Open the local ERP in Chrome, sign in through the existing local/demo route, enter 会计成本, and verify:

1. 新增调整费用 opens centered over a dark blurred backdrop and uses the existing black-gold two-column form.
2. 调整金额 opens with the same themed backdrop and the 760px dialog treatment.
3. 拆分项目 opens with the same theme and its 900px desktop width.
4. A short-height viewport scrolls inside the dialog instead of placing an unstyled form below the page.
5. A viewport at or below 760px changes the form and allocation rows to one column without horizontal overflow.
6. Cancel, Escape, focus cycling, disabled submit states, and closing behavior still work.

- [ ] **Step 10: Inspect the final diff and commit the implementation**

Run:

```bash
git diff --check
git diff -- src/features/project-cost-ledger/projectCostLedgerDialogs.test.js src/features/project-cost-ledger/ProjectCostLedgerSection.test.js src/features/project-cost-ledger/ProjectCostManualEntryDialog.jsx src/features/project-cost-ledger/ProjectCostAdjustmentDialog.jsx src/features/project-cost-ledger/ProjectCostAllocationDialog.jsx src/features/project-cost-ledger/projectCostLedger.css
git status --short
```

Expected: only the approved tests, three dialog roots, and two backdrop selector occurrences differ; `git diff --check` prints nothing.

Commit:

```bash
git add src/features/project-cost-ledger/projectCostLedgerDialogs.test.js src/features/project-cost-ledger/ProjectCostLedgerSection.test.js src/features/project-cost-ledger/ProjectCostManualEntryDialog.jsx src/features/project-cost-ledger/ProjectCostAdjustmentDialog.jsx src/features/project-cost-ledger/ProjectCostAllocationDialog.jsx src/features/project-cost-ledger/projectCostLedger.css
git commit -m "fix: restore project cost dialog theme"
```

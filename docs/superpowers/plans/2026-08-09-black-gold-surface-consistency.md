# Black-Gold Surface Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every known white, pale-blue, and pale-gray business surface from the authenticated ERP while preserving authentication, print, label, layout, and business behavior.

**Architecture:** Extend the existing `.erp-black-gold` theme layer rather than rewriting page components or legacy styles. Add exact PostCSS contract assertions first, then implement scoped shared and page-specific overrides in `src/blackGoldTheme.css`; preserve all existing theme tokens and semantic status colors.

**Tech Stack:** React 19, CSS, PostCSS, Node.js test runner, Vite, Chrome visual verification.

## Global Constraints

- All new selectors must begin with `.erp-black-gold` and must not target login or auth selectors.
- Use only existing `--erp-*` palette tokens; do not add page-local colors.
- Keep layout, spacing, radius, typography, fields, routes, permissions, and data behavior unchanged.
- Preserve red, green, orange, and blue semantic status surfaces.
- Do not modify `warehouseLabel.css` or `warehouseReportPrint.css`.
- Preserve the existing uncommitted purchase-arrival fix in `src/App.jsx`, `src/features/warehouse/purchaseWarehouseBridge.js`, and its test; do not stage those files in theme commits.

---

### Task 1: Shared Legacy Form Surfaces

**Files:**
- Modify: `src/blackGoldTheme.test.js:113-164`
- Modify: `src/blackGoldTheme.css:360-445`

**Interfaces:**
- Consumes: Existing theme tokens declared on `.erp-black-gold` and the test helper `declarationsFor(selector, media)`.
- Produces: Authenticated-theme declarations for `.form-group`, `.form-group legend`, `.readonly-field strong`, and `.field span`.

- [ ] **Step 1: Write the failing shared-surface contract test**

Append this test to `src/blackGoldTheme.test.js`:

```js
test('shared legacy form groups and readonly fields use black-gold surfaces', () => {
  const formGroup = declarationsFor('.erp-black-gold .form-group')
  assert.equal(formGroup.get('background'), 'var(--erp-bg-surface)')
  assert.equal(formGroup.get('border'), '1px solid var(--erp-border-subtle)')
  assert.equal(formGroup.get('color'), 'var(--erp-text-primary)')

  const legend = declarationsFor('.erp-black-gold .form-group legend')
  assert.equal(legend.get('color'), 'var(--erp-accent-gold-soft)')
  assert.equal(legend.get('background'), 'var(--erp-bg-canvas)')

  const readonly = declarationsFor('.erp-black-gold .readonly-field strong')
  assert.equal(readonly.get('color'), 'var(--erp-text-primary)')
  assert.equal(readonly.get('background'), 'var(--erp-bg-elevated)')
  assert.equal(readonly.get('border'), '1px solid var(--erp-border-subtle)')

  assert.equal(
    declarationsFor('.erp-black-gold .field span').get('color'),
    'var(--erp-accent-gold)',
  )
})
```

- [ ] **Step 2: Run the test and confirm the intended failure**

Run: `node --test src/blackGoldTheme.test.js`

Expected: FAIL because `.erp-black-gold .form-group` lacks a background declaration and the remaining exact selectors do not yet exist.

- [ ] **Step 3: Implement the minimal shared overrides**

Replace the current border-only `.form-group` grouping in `src/blackGoldTheme.css` with exact rules containing:

```css
.erp-black-gold .form-group {
  border: 1px solid var(--erp-border-subtle);
  color: var(--erp-text-primary);
  background: var(--erp-bg-surface);
}

.erp-black-gold .form-group legend {
  border: 1px solid var(--erp-border-gold-muted);
  color: var(--erp-accent-gold-soft);
  background: var(--erp-bg-canvas);
}

.erp-black-gold .field span {
  color: var(--erp-accent-gold);
}

.erp-black-gold .readonly-field strong {
  border: 1px solid var(--erp-border-subtle);
  color: var(--erp-text-primary);
  background: var(--erp-bg-elevated);
}
```

Keep `.personnel-fieldset`, `.record-header`, `.section-heading`, and `.labor-section-heading` in their existing border-only grouping.

- [ ] **Step 4: Run the shared theme test**

Run: `node --test src/blackGoldTheme.test.js`

Expected: PASS.

- [ ] **Step 5: Commit only the shared theme slice**

```bash
git add src/blackGoldTheme.css src/blackGoldTheme.test.js
git commit -m "fix: darken shared ERP form surfaces"
```

### Task 2: Page-Specific High-Specificity Surfaces

**Files:**
- Modify: `src/blackGoldTheme.test.js`
- Modify: `src/blackGoldTheme.css`

**Interfaces:**
- Consumes: Shared overrides from Task 1 and existing black-gold palette tokens.
- Produces: Higher-specificity authenticated-theme rules for Personnel, Labor Accounting, Today Attendance, and Project Location surfaces whose feature CSS otherwise wins the cascade.

- [ ] **Step 1: Write the failing page-surface contract test**

Append this test to `src/blackGoldTheme.test.js`:

```js
test('page-specific light surfaces are overridden inside the authenticated theme', () => {
  const expected = new Map([
    ['.erp-black-gold .personnel-summary > div', 'var(--erp-bg-surface)'],
    ['.erp-black-gold .personnel-empty', 'var(--erp-bg-surface)'],
    ['.erp-black-gold .personnel-sensitive-section', 'var(--erp-bg-elevated)'],
    ['.erp-black-gold .personnel-field input[readonly]', 'var(--erp-bg-elevated)'],
    ['.erp-black-gold .labor-accounting-page .labor-loading-panel', 'var(--erp-bg-surface)'],
    ['.erp-black-gold .labor-accounting-page .labor-checkbox-filter', 'var(--erp-bg-elevated)'],
    ['.erp-black-gold .attendance-page .attendance-back', 'var(--erp-accent-gold-surface)'],
    ['.erp-black-gold .attendance-page .attendance-photo-control', 'var(--erp-bg-surface)'],
    ['.erp-black-gold .project-page .project-location-picker', 'var(--erp-bg-elevated)'],
    ['.erp-black-gold .project-page .project-location-coordinates', 'var(--erp-bg-surface)'],
  ])
  for (const [selector, background] of expected) {
    assert.equal(declarationsFor(selector).get('background'), background, selector)
  }
})
```

- [ ] **Step 2: Run the test and confirm the intended failure**

Run: `node --test src/blackGoldTheme.test.js`

Expected: FAIL on the first missing page-specific selector.

- [ ] **Step 3: Implement Personnel overrides**

Add scoped rules that set Personnel summary cards, empty states, sensitive fieldsets, readonly fields, form fields, filters, cards, headings, and generated-number surfaces to the existing black-gold backgrounds, borders, and text colors. Use these exact selector anchors:

```css
.erp-black-gold .personnel-summary > div
.erp-black-gold .personnel-empty
.erp-black-gold .personnel-sensitive-section
.erp-black-gold .personnel-field input[readonly]
.erp-black-gold .personnel-generated-number
.erp-black-gold .personnel-section-heading h2
.erp-black-gold .personnel-section-heading span
```

- [ ] **Step 4: Implement Labor Accounting overrides**

Add `.erp-black-gold .labor-accounting-page`-scoped rules for controls, checkbox filters, loading panels, ordinary panels/cards, table headers/cells, option fieldsets, and non-semantic empty states. Use dark surfaces and existing text tokens; preserve `.labor-page-error`, warning, success, and danger rules.

```css
.erp-black-gold .labor-accounting-page .labor-loading-panel {
  border-color: var(--erp-border-subtle);
  color: var(--erp-text-primary);
  background: var(--erp-bg-surface);
}

.erp-black-gold .labor-accounting-page .labor-checkbox-filter {
  border-color: var(--erp-border-subtle);
  color: var(--erp-text-secondary);
  background: var(--erp-bg-elevated);
}
```

- [ ] **Step 5: Implement Today Attendance and Project Location overrides**

Add scoped rules for the attendance back button, ordinary controls, photo controls, and non-semantic cards. Keep normal/abnormal/error status surfaces semantic. Add project-location overrides for the picker, action, coordinates, resolved address, and attribution; do not recolor Leaflet map tiles.

```css
.erp-black-gold .attendance-page .attendance-back {
  border-color: var(--erp-border-gold-muted);
  color: var(--erp-text-primary);
  background: var(--erp-accent-gold-surface);
}

.erp-black-gold .project-page .project-location-picker {
  border-color: var(--erp-border-subtle);
  color: var(--erp-text-secondary);
  background: var(--erp-bg-elevated);
}
```

- [ ] **Step 6: Run theme and page-focused tests**

Run: `node --test src/blackGoldTheme.test.js src/features/attendance/todayAttendancePageContract.test.js src/features/labor-accounting/*.test.js`

Expected: PASS.

- [ ] **Step 7: Commit only page-specific theme files**

```bash
git add src/blackGoldTheme.css src/blackGoldTheme.test.js
git commit -m "fix: unify black-gold business surfaces"
```

### Task 3: Full Regression and Visual Acceptance

**Files:**
- Modify only if visual evidence exposes an uncovered selector: `src/blackGoldTheme.css`, `src/blackGoldTheme.test.js`
- Evidence: `/Users/yu/Documents/亚马逊请求书/audit/black-gold-theme/`

**Interfaces:**
- Consumes: Completed shared and page-specific theme rules.
- Produces: Passing repository verification and before/after visual evidence for authenticated ERP pages.

- [ ] **Step 1: Run the full automated suite**

Run: `npm test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Run the production build**

Run: `npm run build`

Expected: Vite exits with code 0. Existing chunk-size warnings are acceptable; new CSS or syntax warnings are not.

- [ ] **Step 3: Verify desktop pages in Chrome**

At the current desktop viewport, visit every visible first-level menu route and capture stable screenshots. Confirm that Home, Owner Dashboard, Projects, Personnel, Accounting, Labor, Warehouse, Stock Out, Stock Return, Purchases, Vehicles, Tools, Attendance, and Settings contain no white/pale business cards, while semantic status colors remain distinct.

- [ ] **Step 4: Verify mobile reflow**

Use the browser-supported viewport override at `390 × 844`, then verify one shared-form page (Purchases), one feature-CSS page (Labor or Attendance), the bottom navigation, form stacking, and horizontal scrolling. Restore the desktop viewport after capture.

- [ ] **Step 5: Fix any visual miss with a new failing assertion first**

For each newly observed light surface, add its exact `.erp-black-gold` selector and expected token to the page-surface contract test, run to observe failure, add the minimal CSS override, and rerun the test. Do not add broad wildcard rules.

- [ ] **Step 6: Re-run final verification**

Run: `node --test src/blackGoldTheme.test.js`

Run: `npm test`

Run: `npm run build`

Expected: all commands pass, and same-viewport after screenshots show black-gold surfaces without layout or readability regressions.

- [ ] **Step 7: Commit any visual-QA follow-up only when files changed**

```bash
git add src/blackGoldTheme.css src/blackGoldTheme.test.js
git commit -m "fix: close black-gold visual gaps"
```

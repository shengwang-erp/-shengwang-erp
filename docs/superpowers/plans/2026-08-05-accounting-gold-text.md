# Accounting Gold Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining dark-blue accounting labels with the existing black-gold theme color while keeping monetary values white and leaving all business data untouched.

**Architecture:** Add narrowly scoped overrides under `.erp-black-gold .accounting-cost-page` so legacy light-theme declarations cannot leak into the accounting module. Protect the visual contract with the existing PostCSS-based theme test, then verify the full application locally before deploying the same working tree to Vercel.

**Tech Stack:** React, CSS custom properties, PostCSS, Node.js test runner, Vite, Vercel.

## Global Constraints

- Scope every new selector to `.erp-black-gold .accounting-cost-page`.
- Use `var(--erp-accent-gold-soft)` for accounting labels and subsection text.
- Keep `.stat-card strong` on `var(--erp-text-primary)` so amounts remain white.
- Do not change backgrounds, borders, status colors, database schema, permissions, or business records.
- Preserve all unrelated working-tree changes.

---

### Task 1: Protect and implement accounting gold labels

**Files:**
- Modify: `src/blackGoldTheme.test.js`
- Modify: `src/blackGoldTheme.css`

**Interfaces:**
- Consumes: Existing theme tokens `--erp-accent-gold-soft` and `--erp-text-primary`.
- Produces: Accounting-page CSS selectors whose computed declarations override legacy blue text only inside `.accounting-cost-page`.

- [ ] **Step 1: Write the failing regression test**

Add this test to `src/blackGoldTheme.test.js`:

```js
test('accounting labels are gold while monetary values remain white', () => {
  for (const selector of [
    '.erp-black-gold .accounting-cost-page .subsection-title h2',
    '.erp-black-gold .accounting-cost-page .subsection-title span',
    '.erp-black-gold .accounting-cost-page .stat-card span',
  ]) {
    assert.equal(
      declarationsFor(selector).get('color'),
      'var(--erp-accent-gold-soft)',
      selector,
    )
  }

  assert.equal(
    declarationsFor('.erp-black-gold .stat-card strong').get('color'),
    'var(--erp-text-primary)',
  )
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test src/blackGoldTheme.test.js`

Expected: FAIL because the three accounting-specific selectors do not yet define `color: var(--erp-accent-gold-soft)`.

- [ ] **Step 3: Add the minimal accounting-specific CSS**

Add this rule next to the existing `.stat-card` theme overrides in `src/blackGoldTheme.css`:

```css
.erp-black-gold .accounting-cost-page .subsection-title h2,
.erp-black-gold .accounting-cost-page .subsection-title span,
.erp-black-gold .accounting-cost-page .stat-card span {
  color: var(--erp-accent-gold-soft);
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node --test src/blackGoldTheme.test.js`

Expected: PASS with zero failures.

- [ ] **Step 5: Run the complete automated verification**

Run: `npm test`

Expected: All tests pass with zero failures.

Run: `npm run build`

Expected: Vite production build exits with code 0.

- [ ] **Step 6: Review and commit only the theme files**

Run:

```bash
git diff --check -- src/blackGoldTheme.css src/blackGoldTheme.test.js
git diff -- src/blackGoldTheme.css src/blackGoldTheme.test.js
git add src/blackGoldTheme.css src/blackGoldTheme.test.js
git commit -m "Fix accounting labels in black gold theme"
```

Expected: The commit contains only the black-gold theme and its regression test; unrelated contract, project, or database files remain unstaged.

---

### Task 2: Verify the local accounting page visually

**Files:**
- No source-file changes expected.

**Interfaces:**
- Consumes: The production build and the existing recovery/admin account.
- Produces: Visual evidence that accounting labels are gold and amounts remain white at desktop width.

- [ ] **Step 1: Start the local application**

Run: `npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL and no startup errors.

- [ ] **Step 2: Inspect the target route without changing business data**

Open the local ERP, sign in with the existing recovery/admin account if needed, and navigate to `会计成本 → 月度汇总`.

Expected visual result:

- “月度汇总”“待核算成本” and their right-side notes are gold.
- Every summary-card label is gold.
- Currency and percentage values are white.
- Borders, top accents, backgrounds, inputs, and status colors are unchanged.

- [ ] **Step 3: Stop the local server**

Stop only the Vite process started in Step 1. Do not alter Supabase or any database process.

---

### Task 3: Deploy and verify production

**Files:**
- No source-file changes expected.

**Interfaces:**
- Consumes: The locally verified working tree and the existing Vercel project configuration.
- Produces: Updated production styling at `https://shengwang-erp.vercel.app/`.

- [ ] **Step 1: Re-run the release gates immediately before deployment**

Run:

```bash
npm test
npm run build
```

Expected: Both commands exit with code 0 and report zero test failures.

- [ ] **Step 2: Deploy the verified working tree**

Run: `vercel --prod --yes`

Expected: Vercel returns a successful production deployment and aliases it to `shengwang-erp.vercel.app`.

- [ ] **Step 3: Verify the production page**

Open `https://shengwang-erp.vercel.app/`, refresh, and navigate to `会计成本 → 月度汇总`.

Expected: Production matches the local visual checklist, and existing accounting amounts remain unchanged.

- [ ] **Step 4: Confirm no database operation occurred**

Review the executed commands and confirm that no Supabase migration, SQL statement, RPC write, or business-record mutation was run during this plan.

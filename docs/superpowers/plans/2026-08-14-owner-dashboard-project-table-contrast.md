# Owner Dashboard Project Table Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every project-detail label and value readable on the owner dashboard's black surface while preserving existing semantic colors.

**Architecture:** Keep the fix inside the existing scoped executive-dashboard stylesheet. Add a PostCSS contract test that binds each project-table role to an existing black-gold theme token, then make the smallest CSS token changes needed to satisfy it.

**Tech Stack:** React, CSS, PostCSS, Node test runner, Vite, Vercel.

## Global Constraints

- Do not modify dashboard calculations, data adapters, permissions, or database state.
- Do not change shared table styling outside `.executive-project-table`.
- Use existing `--erp-*` theme tokens; do not introduce literal production colors.
- Preserve warning and negative semantic colors.

---

### Task 1: Lock and implement the project-table contrast hierarchy

**Files:**
- Modify: `src/features/executive-dashboard/executiveDashboardPage.test.js`
- Modify: `src/features/executive-dashboard/executiveDashboard.css`

**Interfaces:**
- Consumes: existing `.erp-black-gold .executive-project-table` markup and `--erp-text-primary`, `--erp-text-secondary`, `--erp-accent-gold` theme tokens.
- Produces: explicit role-based colors for headers, body cells, project names, project IDs, and ready profit values.

- [ ] **Step 1: Write the failing PostCSS contract test**

Assert that the project table uses primary text for body cells and names, secondary text for headers and IDs, and gold for ready profit values.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `node --test src/features/executive-dashboard/executiveDashboardPage.test.js`

Expected: the new contrast contract fails because the body still inherits secondary text, the header and ID use muted text, and profit uses primary text.

- [ ] **Step 3: Apply the minimal scoped CSS token changes**

Update only the existing project-table selectors so each role matches the approved hierarchy. Leave pending cost, missing-profit, status pills, and all other panels unchanged.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
node --test src/features/executive-dashboard/executiveDashboardPage.test.js
npm test
npm run build
```

Expected: all commands exit `0` with no new warnings beyond the repository's accepted chunk-size advisory.

- [ ] **Step 5: Commit and deploy**

```bash
git add docs/superpowers/specs/2026-08-14-owner-dashboard-project-table-contrast-design.md docs/superpowers/plans/2026-08-14-owner-dashboard-project-table-contrast.md src/features/executive-dashboard/executiveDashboardPage.test.js src/features/executive-dashboard/executiveDashboard.css
git commit -m "fix: improve owner dashboard table contrast"
git push
vercel --prod
```

- [ ] **Step 6: Verify the production page**

Open `https://shengwang-erp.vercel.app/`, enter the owner dashboard with the existing administrator session, and confirm the project table remains readable on the black surface.


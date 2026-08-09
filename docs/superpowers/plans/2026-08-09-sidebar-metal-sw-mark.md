# Sidebar Metallic SW Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a circular metallic SW sidebar mark, show it for approval first, then replace only the desktop sidebar’s existing text mark.

**Architecture:** Image generation and application integration are separate approval-gated tasks. Task 1 creates and validates a transparent preview without touching runtime code; Task 2 runs only after user approval and adds one project asset plus a semantic `<img>` consumer covered by the existing desktop shell contract tests.

**Tech Stack:** React 19, Vite 6, CSS, Node test runner, built-in ImageGen, PNG alpha post-processing.

## Global Constraints

- Final master asset is exactly 1024 × 1024 PNG with transparent pixels outside a complete circular badge.
- Badge uses a near-black brown-bronze base, a thin warm-gold or antique-bronze rim, and a silver-white beveled `SW` plus enclosing oval.
- No “生旺株式会社”, `ERP`, watermark, extra text, square frame, square corner residue, or shadow extending outside the circle.
- Runtime display size remains exactly 44 × 44 px.
- Only `.desktop-admin-brand-mark` changes; login/auth, PWA, favicon, and mobile icons remain unchanged.
- Do not modify runtime code until the user approves the generated preview.

---

### Task 1: Generate and validate the preview asset

**Files:**
- Create: `/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/source-preview.png`
- Create: `/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/sidebar-metal-sw-mark-preview.png`
- Reference: `/Users/yu/Desktop/a1fa86eedd83637771603e2a5e87f5c0.jpg`
- Reference: `/var/folders/bx/f0xx_3z10tbcb6qtsx74hbcm0000gn/T/codex-clipboard-bd876c2d-f9d1-4b9e-9309-62cf858185a5.png`

**Interfaces:**
- Consumes: the approved visual specification and the two user-provided reference images.
- Produces: one transparent 1024 × 1024 preview PNG for user approval; no application code references it yet.

- [ ] **Step 1: Generate one focused candidate**

Use built-in ImageGen with both references and this exact prompt:

```text
Use case: logo-brand
Asset type: 44px desktop ERP sidebar brand mark, rendered as a 1024x1024 source
Input images: Image 1 is the current ERP sidebar context and scale reference; Image 2 is the metallic material and SW structure reference.
Primary request: create a new compact circular metallic SW badge for the sidebar; use the references for material, proportions, and brand character, but do not crop or copy the square reference image.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for later removal; one uniform color, no shadows, gradients, texture, reflections, floor plane, or lighting variation in the background.
Subject: one complete centered circular badge with a near-black dark bronze face, thin warm antique-gold beveled rim, and a crisp silver-white beveled SW monogram enclosed by a silver oval sweep.
Style/medium: premium restrained 3D metal product rendering, polished but not glossy-plastic, strong silhouette at 44px.
Composition/framing: centered, symmetrical, generous even padding, all badge pixels contained inside the circle.
Lighting/mood: controlled studio highlights that describe the metal while preserving dark ERP contrast.
Text (verbatim): "SW"
Constraints: only SW and the enclosing oval; the circle must read cleanly at 44px; do not use #00ff00 in the badge; no cast shadow or reflection outside the circle.
Avoid: square plate, rounded-square frame, company name, ERP, other text, watermark, decorative flourishes, tiny detail, green spill.
```

- [ ] **Step 2: Remove the chroma key into a transparent preview**

Copy the generated source to `source-preview.png`, then run:

```bash
python /Users/yu/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py \
  --input /Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/source-preview.png \
  --out /Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/sidebar-metal-sw-mark-preview.png \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill
```

- [ ] **Step 3: Validate the preview before showing it**

Check the PNG dimensions and alpha channel, confirm all four corners are transparent, inspect it once at full size and once rendered at 44 × 44 px, and reject the candidate if the SW/oval becomes unreadable or any square boundary remains.

- [ ] **Step 4: Show the candidate and stop for approval**

Render `sidebar-metal-sw-mark-preview.png` to the user. Do not copy it into `public/` and do not modify React or CSS until the user explicitly approves this candidate.

### Task 2: Integrate the approved mark into the desktop sidebar

**Files:**
- Create: `public/sw-sidebar-mark.png`
- Modify: `src/DesktopAdminShell.jsx:28-33`
- Modify: `src/styles.css:2117-2133`
- Modify: `src/blackGoldTheme.css:70-76`
- Test: `src/desktopAdminShell.test.js`

**Interfaces:**
- Consumes: the user-approved transparent preview from Task 1.
- Produces: `/sw-sidebar-mark.png` rendered by an accessible desktop sidebar image at 44 × 44 px.

- [ ] **Step 1: Write the failing shell contract test**

Add assertions to `src/desktopAdminShell.test.js`:

```js
test('desktop brand uses the approved circular metallic image only in the sidebar', () => {
  assert.match(
    shellSource,
    /<img[\s\S]*?className="desktop-admin-brand-mark"[\s\S]*?src="\/sw-sidebar-mark\.png"[\s\S]*?alt="生旺株式会社标志"/u,
  )
  assert.doesNotMatch(shellSource, /desktop-admin-brand-mark"[^>]*>[\s\S]*?SW[\s\S]*?<\/span>/u)
  assert.match(cssSource, /\.desktop-admin-brand-mark\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*border-radius:\s*50%[^}]*object-fit:\s*contain/su)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/desktopAdminShell.test.js`

Expected: FAIL because `DesktopAdminShell.jsx` still renders the text-only `SW` span.

- [ ] **Step 3: Add the approved asset and minimal markup/styles**

Copy the approved 1024 × 1024 alpha PNG to `public/sw-sidebar-mark.png`. Replace the existing brand mark span with:

```jsx
<img
  className="desktop-admin-brand-mark"
  src="/sw-sidebar-mark.png"
  alt="生旺株式会社标志"
/>
```

Set the base mark CSS to `display: block`, `width: 44px`, `height: 44px`, `border: 0`, `border-radius: 50%`, `object-fit: contain`, and `background: transparent`. Keep only a restrained circular drop shadow. Update the scoped black-gold override so it does not restore the legacy text color, border, or background.

- [ ] **Step 4: Run focused and regression tests**

Run:

```bash
node --test src/desktopAdminShell.test.js src/blackGoldTheme.test.js src/auth/frontendAuthContract.test.js src/homeScreenIcon.test.js
npm test
npm run build
```

Expected: all tests pass; production build exits 0; auth and install icons still reference their existing assets.

- [ ] **Step 5: Verify in Chrome and commit**

Open the local ERP Home page at the desktop viewport, confirm the image is circular with no square residue, visually clear at 44px, aligned with both brand text lines, and unchanged across at least Home and Purchase Management. Then commit only the new asset, shell markup, CSS, tests, and this task’s related documentation.

```bash
git add public/sw-sidebar-mark.png src/DesktopAdminShell.jsx src/styles.css src/blackGoldTheme.css src/desktopAdminShell.test.js
git commit -m "feat: add metallic sidebar brand mark"
```


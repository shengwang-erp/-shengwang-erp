# Sidebar Metallic SW Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a horizontal oval metallic SW sidebar mark, show it for approval first, then replace only the desktop sidebar’s existing text mark.

**Architecture:** Image generation and application integration are separate approval-gated tasks. Task 1 creates and validates a transparent preview without touching runtime code; Task 2 runs only after user approval and adds one project asset plus a semantic `<img>` consumer covered by the existing desktop shell contract tests.

**Tech Stack:** React 19, Vite 6, CSS, Node test runner, built-in ImageGen, PNG alpha post-processing.

## Global Constraints

- Final master asset is exactly 1120 × 800 PNG with transparent pixels outside a complete horizontal oval badge; aspect ratio is exactly 1.4:1.
- Badge uses a near-black brown-bronze base, a thin warm-gold or antique-bronze rim, and a silver-white beveled `SW` plus enclosing oval.
- No “生旺株式会社”, `ERP`, watermark, extra text, square frame, square corner residue, or shadow extending outside the circle.
- Runtime display size is exactly 56 × 40 px and the sidebar brand grid reserves a 56px image column.
- Only `.desktop-admin-brand-mark` changes; login/auth, PWA, favicon, and mobile icons remain unchanged.
- Do not modify runtime code until the user approves the generated preview.

---

### Task 1: Generate and validate the preview asset

**Files:**
- Create: `/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/source-oval-preview.png`
- Create: `/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/oval-transparent-raw.png`
- Create: `/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/sidebar-metal-sw-oval-preview.png`
- Reference: `/Users/yu/Desktop/a1fa86eedd83637771603e2a5e87f5c0.jpg`
- Reference: `/var/folders/bx/f0xx_3z10tbcb6qtsx74hbcm0000gn/T/codex-clipboard-bd876c2d-f9d1-4b9e-9309-62cf858185a5.png`

**Interfaces:**
- Consumes: the approved visual specification and the two user-provided reference images.
- Produces: one transparent 1120 × 800 horizontal oval preview PNG for user approval; no application code references it yet.

- [ ] **Step 1: Generate one focused candidate**

Use built-in ImageGen with both references and this exact prompt:

```text
Use case: logo-brand
Asset type: 56x40px desktop ERP sidebar brand mark, rendered as a high-resolution landscape source
Input images: Image 1 is the current ERP sidebar context and scale reference; Image 2 is the metallic material and SW structure reference.
Primary request: create a new compact horizontal oval metallic SW badge for the sidebar; use the references for material, proportions, and brand character, but do not crop, stretch, or copy the square reference image.
Scene/backdrop: perfectly flat solid #00ff00 chroma-key background for later removal; one uniform color, no shadows, gradients, texture, reflections, floor plane, or lighting variation in the background.
Subject: one complete centered horizontal oval badge with an overall 1.4:1 silhouette, a near-black dark bronze face, thin warm antique-gold beveled rim, and a crisp silver-white beveled SW monogram enclosed by a silver oval sweep.
Style/medium: premium restrained 3D metal product rendering, polished but not glossy-plastic, strong silhouette at 56x40px.
Composition/framing: centered, symmetrical, generous even padding, all badge pixels contained inside the horizontal oval.
Lighting/mood: controlled studio highlights that describe the metal while preserving dark ERP contrast.
Text (verbatim): "SW"
Constraints: only SW and the enclosing oval; the entire badge must be visibly wider than tall and read cleanly at 56x40px; do not use #00ff00 in the badge; no cast shadow or reflection outside the oval.
Avoid: circular outer badge, square plate, rounded-square frame, stretched lettering, company name, ERP, other text, watermark, decorative flourishes, tiny detail, green spill.
```

- [ ] **Step 2: Remove the chroma key into a transparent preview**

Copy the generated source to `source-oval-preview.png`, then run:

```bash
python /Users/yu/.codex/skills/.system/imagegen/scripts/remove_chroma_key.py \
  --input /Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/source-oval-preview.png \
  --out /Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/oval-transparent-raw.png \
  --auto-key border \
  --soft-matte \
  --transparent-threshold 12 \
  --opaque-threshold 220 \
  --despill
```

Normalize the transparent mark to the exact 1120 × 800 deliverable without stretching:

```python
from PIL import Image

source = Image.open('/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/oval-transparent-raw.png').convert('RGBA')
bounds = source.getbbox()
if bounds is None:
    raise SystemExit('generated mark is fully transparent')
mark = source.crop(bounds)
mark.thumbnail((1056, 736), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (1120, 800), (0, 0, 0, 0))
offset = ((1120 - mark.width) // 2, (800 - mark.height) // 2)
canvas.alpha_composite(mark, offset)
canvas.save('/Users/yu/Documents/亚马逊请求书/audit/sidebar-metal-sw-mark/sidebar-metal-sw-oval-preview.png')
```

- [ ] **Step 3: Validate the preview before showing it**

Check that the PNG is exactly 1120 × 800 with an alpha channel, confirm all four corners are transparent, inspect it once at full size and once rendered at 56 × 40 px, and reject the candidate if the SW/oval becomes unreadable, the outer badge reads as circular, or any square boundary remains.

- [ ] **Step 4: Show the candidate and stop for approval**

Render `sidebar-metal-sw-oval-preview.png` to the user. Do not copy it into `public/` and do not modify React or CSS until the user explicitly approves this candidate.

### Task 2: Integrate the approved mark into the desktop sidebar

**Files:**
- Create: `public/sw-sidebar-mark.png`
- Modify: `src/DesktopAdminShell.jsx:28-33`
- Modify: `src/styles.css:2117-2133`
- Modify: `src/blackGoldTheme.css:70-76`
- Test: `src/desktopAdminShell.test.js`

**Interfaces:**
- Consumes: the user-approved transparent preview from Task 1.
- Produces: `/sw-sidebar-mark.png` rendered by an accessible desktop sidebar image at 56 × 40 px.

- [ ] **Step 1: Write the failing shell contract test**

Add assertions to `src/desktopAdminShell.test.js`:

```js
test('desktop brand uses the approved circular metallic image only in the sidebar', () => {
  assert.match(
    shellSource,
    /<img[\s\S]*?className="desktop-admin-brand-mark"[\s\S]*?src="\/sw-sidebar-mark\.png"[\s\S]*?alt="生旺株式会社标志"/u,
  )
  assert.doesNotMatch(shellSource, /desktop-admin-brand-mark"[^>]*>[\s\S]*?SW[\s\S]*?<\/span>/u)
  assert.match(cssSource, /\.desktop-admin-brand\s*\{[^}]*grid-template-columns:\s*56px\s+minmax\(0,\s*1fr\)/su)
  assert.match(cssSource, /\.desktop-admin-brand-mark\s*\{[^}]*width:\s*56px[^}]*height:\s*40px[^}]*border-radius:\s*50%[^}]*object-fit:\s*contain/su)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/desktopAdminShell.test.js`

Expected: FAIL because `DesktopAdminShell.jsx` still renders the text-only `SW` span.

- [ ] **Step 3: Add the approved asset and minimal markup/styles**

Copy the approved 1120 × 800 alpha PNG to `public/sw-sidebar-mark.png`. Replace the existing brand mark span with:

```jsx
<img
  className="desktop-admin-brand-mark"
  src="/sw-sidebar-mark.png"
  alt="生旺株式会社标志"
/>
```

Set the brand grid’s first column to `56px`. Set the base mark CSS to `display: block`, `width: 56px`, `height: 40px`, `border: 0`, `border-radius: 50%`, `object-fit: contain`, and `background: transparent`. Keep only a restrained oval drop shadow. Update the scoped black-gold override so it does not restore the legacy text color, border, or background.

- [ ] **Step 4: Run focused and regression tests**

Run:

```bash
node --test src/desktopAdminShell.test.js src/blackGoldTheme.test.js src/auth/frontendAuthContract.test.js src/homeScreenIcon.test.js
npm test
npm run build
```

Expected: all tests pass; production build exits 0; auth and install icons still reference their existing assets.

- [ ] **Step 5: Verify in Chrome and commit**

Open the local ERP Home page at the desktop viewport, confirm the image is a horizontal oval with no circular or square residue, visually clear at 56 × 40px, aligned with both brand text lines, and unchanged across at least Home and Purchase Management. Then commit only the new asset, shell markup, CSS, tests, and this task’s related documentation.

```bash
git add public/sw-sidebar-mark.png src/DesktopAdminShell.jsx src/styles.css src/blackGoldTheme.css src/desktopAdminShell.test.js
git commit -m "feat: add metallic sidebar brand mark"
```

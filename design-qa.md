# 会计成本中心电脑端报表布局 Design QA

## Comparison target and evidence

- Source visual truth: `/var/folders/bx/f0xx_3z10tbcb6qtsx74hbcm0000gn/T/codex-clipboard-a833b6f9-cbb4-420a-8463-4a6a863ac627.png`.
- Source pixels: 2440 × 842. The source is a cropped project-cost navigation/action-card reference; CSS viewport and device density metadata are unavailable.
- Browser implementation: real production `AccountingCostPage`, mounted only for QA through the git-ignored fixture at `.superpowers/sdd/2026-08-12-accounting-center-desktop-report-layout/qa/` because the normal local entry stops at the unconfigured authentication screen.
- Primary implementation evidence: `.superpowers/sdd/2026-08-12-accounting-center-desktop-report-layout/qa/implementation-1440-project-cost.jpg`.
- Primary CSS viewport: 1440 × 1000, browser-reported device pixel ratio 2. The in-app Browser capture is 1425 × 925 encoded pixels because its screenshot surface omits browser scrollbar/chrome regions.
- Responsive evidence:
  - `.superpowers/sdd/2026-08-12-accounting-center-desktop-report-layout/qa/implementation-1023-purchase.jpg` — 1023 × 1000 CSS viewport, DPR 1, 1008 × 921 capture.
  - `.superpowers/sdd/2026-08-12-accounting-center-desktop-report-layout/qa/implementation-640-monthly.jpg` — 640 × 900 CSS viewport, DPR 1, 625 × 879 capture.
- Additional 1440 × 1000 states: `implementation-1440-salary.jpg`, `implementation-1440-operating.jpg`, `implementation-1440-purchase.jpg`, and `implementation-1440-monthly.jpg` in the same QA directory.
- State: black-gold theme; realistic August 2026 accounting data; all five visible sections authorized; report actions ready.
- Density normalization: no source resampling was used because the source is a detail crop without reliable CSS/density metadata. The source and the 1440 project-cost capture were opened together in one comparison input, and fidelity was judged on the same navigation/action-card state and focused geometry rather than claiming false full-frame pixel equivalence.

## Full-view and focused comparison

- Full-view comparison: the source and `implementation-1440-project-cost.jpg` were viewed together. Both show the black canvas, one-line section navigation, selected project-cost state, gold-topped rounded action card, left-aligned title/subtitle, right-aligned action group, muted secondary copy, and gold-accented controls.
- Focused region comparison: the navigation and operation-card region is large and legible in both artifacts, so a separate resampled crop was unnecessary. Browser geometry confirmed the 1440 navigation is one row with five equal 211.6px items and no internal overflow; the project-cost action card is 1060 × 104.7 CSS px.
- The source is a cropped styling reference rather than a complete 1440 page mock. Differences outside the navigation/action-card region, such as the implementation page header and following business filters, are expected product context rather than design drift.

## Findings

- No actionable P0, P1, or P2 mismatch was found.
- Fonts and typography: the implementation uses the established `Inter, "Noto Sans SC", "PingFang SC", "Hiragino Sans GB", sans-serif` ERP stack. Gold 22px report titles, muted scope copy, bold button labels, line height, wrapping, and numeric treatment preserve the source hierarchy. No truncation or cramped labels appeared at the checked widths.
- Spacing and layout rhythm: at 1440px, the four new report cards are 1060 × 105 CSS px with 20–22px internal/marginal rhythm, title/scope on the left, and controls on the right. Excel, PDF, and Print buttons are each 42.5px high. The PDF guidance is the only `small` element and is nested only under `.accounting-report-pdf-action`.
- Colors and visual tokens: canvas `#080806`, surface `#0f0f0d`, elevated `#171612`, gold accents, muted borders, and white/secondary text match the selected black-gold reference direction. Active navigation, cards, controls, borders, and focus rings consistently use the shared theme tokens.
- Image quality and asset fidelity: this interface and the selected action-card reference contain no required logo, illustration, product image, avatar, or decorative raster asset in the compared region. No new image asset was added and no image was replaced with CSS art, inline SVG, emoji, or a placeholder.
- Copy and content: all five labels are present and coherent. The four new titles are `工资记录报表`, `经营费用明细`, `采购对账报表`, and `月度成本汇总`; scope text is current and readable. `在打印窗口选择“另存为 PDF”` appears only under the PDF button. Purchase accounting does not duplicate its old heading.
- Responsive behavior: at 1023px the report card is a true top/bottom column layout and all three output controls remain equal height. At 640px the five 180px navigation items stay on one row (`scrollWidth 900 > clientWidth 599`) and horizontally scroll to the selected monthly item without page-level horizontal overflow.
- Interactions: all five section buttons changed the visible section. Excel was clicked successfully in Salary, Operating Expense, Purchase Accounting, and Monthly Summary; Salary PDF and Print each invoked the print dependency; Project Cost `拆分项目` displayed its intended guidance. Purchase filters remain below the report card.
- Accessibility: navigation and report actions are native buttons; the toolbar exposes an accessible region label; disabled state remains semantic; keyboard focus shows a 2px gold outline with 2px offset; reduced-motion styles are present. Contrast and target sizing were readable at all checked widths.
- Console: the final clean in-app Browser session reported zero warnings and zero errors after all section switches and again at 1023px and 640px.

## Open Questions

- None blocking. The source has no viewport/density metadata and is intentionally treated as a focused styling reference, not an equal-size full-page screenshot.

## Comparison history

1. First browser comparison: source reference and 1440 project-cost state opened in the same image input. No P0/P1/P2 finding; no production fix was made.
2. Responsive validation: 1023 purchase and 640 monthly captures confirmed the specified stack/scroll behavior. No P0/P1/P2 finding; no production fix was made.
3. Final clean-session interaction/console pass: all five sections, report actions, 1023px, and 640px rechecked with zero console warning/error. Verdict unchanged.

## Implementation checklist

- [x] Five visible section entries remain one row and equal width at 1440px.
- [x] Four report action cards match the project-cost visual language.
- [x] Three report buttons use equal height; PDF help belongs only to PDF.
- [x] Purchase filter panel follows its action card.
- [x] 1023px card stack verified.
- [x] Narrow navigation horizontal scroll verified.
- [x] Section changes, usable output controls, keyboard focus, and console verified.
- [x] No new image asset or production-only QA code introduced.

## Follow-up polish

- P3: if this control group is later formalized as ARIA tabs, add `tablist`/`tab`/`aria-selected` semantics as one coordinated accessibility enhancement; the current native-button interaction and visible focus are functional.

final result: passed

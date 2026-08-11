# Accounting Center Report Exports — final fix report

Date: 2026-08-12

Reviewed base: `97a10eb`

Branch: `codex/accounting-center-report-exports`
Scope: the seven Important findings in `final-review-findings.md`; no deployment or integration performed.

## Outcome

All seven Important findings are implemented and covered by observed RED-to-GREEN tests. Salary, Operating Expense, Purchase Accounting, and Monthly Summary retain their approved filters and permission boundaries. Project Cost production behavior was not changed and its focused export/print/load regression tests remain green.

The fix-wave Git object ID is reported in the task handoff because a commit cannot contain its own final hash. This report and all implementation/test files are included in that one coherent fix-wave commit. The parent reviewed commit remains `97a10eb`.

## Finding 1 — StrictMode action deadlock

### Implementation

- `AccountingReportActions` now re-arms `mountedRef.current = true` in effect setup.
- Effect cleanup still marks the component unmounted and increments the generation, preserving stale-output cancellation.
- Excel retains its generation/identity guard, and PDF/Print still mount a portal before calling the shared native print dependency.
- Added StrictMode-wrapped Excel, PDF, and Print tests for exactly-once callbacks, pending-state recovery, and stale cancellation.

Files:

- `src/features/accounting-reports/AccountingReportActions.jsx`
- `src/features/accounting-reports/AccountingReportActions.test.js`

### RED evidence

Command:

```text
node --test src/features/accounting-reports/AccountingReportActions.test.js
```

Observed before the production edit: the three new StrictMode behaviors failed. Excel's output guard was false after the development setup→cleanup→setup cycle, its pending state did not clear, and PDF/Print did not reach the injected callback.

### GREEN evidence

The action suite passed all 10 tests. The final focused run also passed these cases:

- StrictMode Excel invokes once, clears pending, and keeps its guard current.
- StrictMode PDF and Print each invoke once after portal mount and clear pending.
- A StrictMode context change invalidates the stale Excel guard.
- A click-turn context change prevents stale printing and leaves actions usable.

## Finding 2 — Salary/Operating source readiness

### Implementation

- Added normalized direct-source projections for `salaryRecords` and `operatingExpenseRecords` using each direct accounting read gate.
- Passed those source descriptors into the Salary and Operating sections.
- Both sections now fail closed unless the source is non-stale `ready` data with an array payload.
- Loading, error, stale, malformed-ready, and forbidden states produce no report model, disable all output actions, expose no fallback rows, and show a clear state-specific reason.
- Legitimate ready-zero data keeps the report/actions enabled and produces the approved explicit empty report.
- Context identity includes source status, source update time, and the actual report output.
- The direct Operating source uses a separate `operatingExpenseRecords` key. The existing `operatingExpenses` projection is retained for Monthly Summary so its broader approved monthly-summary/dashboard grant is not narrowed.

Files:

- `src/App.jsx`
- `src/features/accounting-reports/accountingCostReportIntegration.test.js`

### RED evidence

Command:

```text
node --test src/features/accounting-reports/accountingCostReportIntegration.test.js
```

Observed before the readiness edit: Salary and Operating loading/error/stale/forbidden cases still exposed fallback rows and left output available; the eight state-matrix subtests failed their fail-closed assertions.

During final cross-finding review, a separate behavioral regression test was added before correcting the source key:

```text
node --test --test-name-pattern="operating report readiness stays independent" src/features/accounting-reports/accountingCostReportIntegration.test.js
```

Observed RED: `0 pass / 1 fail`; the direct Operating Excel action was disabled (`actual true`, `expected false`) when the Monthly Summary projection was forbidden despite the direct projection being ready.

### GREEN evidence

- The targeted permission-projection regression passed `1/1` after separating the keys.
- The integration file passed `26/26`, including both four-state matrices, Salary ready-zero, Operating ready-zero, and direct-vs-monthly permission independence.
- Final focused run passed all associated cases.

## Finding 3 — Purchase authorized payment readiness

### Implementation

- Only an explicit `forbidden` payment source permits an accrual-only report.
- Any authorized non-ready state (missing/loading, error, stale, malformed-ready, or a non-ready current-payable model) blocks output.
- Blocked states show either “采购付款数据正在加载” or “采购付款数据暂不可用” without exposing payment-derived facts.
- The report and its context identity include the payment block state.
- The matrix covers loading, error, stale, forbidden, ready, and legitimate ready-zero payment data; all three output controls are asserted.

Files:

- `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- `src/features/purchase-accounting/purchaseAccountingSection.test.js`

### RED evidence

Command:

```text
node --test src/features/purchase-accounting/purchaseAccountingSection.test.js
```

Observed before the production edit: loading/error/stale authorized payment sources were treated like forbidden sources, so the report action stayed enabled and an accrual-only report could be exported. The new blocked-action and reason assertions failed.

### GREEN evidence

The Purchase Accounting file passed `36/36`; its readiness matrix passed loading, error, stale, forbidden, ready, and ready-zero subtests. Final focused and full runs include the same matrix.

## Finding 4 — Purchase payment-status filter parity

### Implementation

- Added report-only fact derivation from the post-filter cohort.
- Report purchase cost, opening paid amount, in-month payment cash, outstanding amount, missing-invoice count, and relevant anomalies are recomputed from exactly the rows represented by the report.
- Payment cash is restricted to filtered purchase IDs and the selected month.
- Anomalies are restricted to the same visible purchase-ID cohort.
- Screen reconciliation cards and anomaly guidance continue to use the unfiltered read model; only exported report facts change.
- Report output itself is included in context identity so summary-only and anomaly-only refreshes invalidate a delayed output.

Files:

- `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- `src/features/purchase-accounting/purchaseAccountingSection.test.js`

### RED evidence

The new parity assertion selected `付款状态：部分付款` and one `PO-AUG` detail row. Before the production edit, the captured report returned unfiltered values:

```text
采购成本: actual 9000, expected 5000
未付余额: actual 7000, expected 3000
缺少发票: actual 2, expected 1
异常数量: actual 1, expected 0
```

It also included the unrelated orphan-payment anomaly.

### GREEN evidence

The parity test now proves the screen remains at ¥9,000 / ¥7,000 / 2 invoices with its orphan warning, while the report contains one row and ¥5,000 / ¥3,000 / 1 invoice / 0 relevant anomalies. Summary-only and anomaly-only stale-output invalidation tests also pass.

## Finding 5 — Generation metadata and filename date

### Implementation

- Added `createAccountingReportOutputSnapshot(report, generatedAt)`.
- Each initiated Excel/PDF/Print action creates exactly one deeply frozen output snapshot at click time.
- The original render-time report remains unchanged; no clock value participates in render-time context identity.
- One instant supplies both the ISO `generatedAt` header value and the safe `_YYYY-MM-DD` filename suffix.
- The helper is idempotent for the same date suffix and rejects an invalid timestamp.
- Excel metadata now includes `记录数` in addition to generation time and preparer.
- Real Salary, Operating, Purchase, and Monthly action tests capture the initiated production report and assert nonblank timestamp, record count, preparer, and dated safe filename.

Files:

- `src/features/accounting-reports/accountingReportModel.js`
- `src/features/accounting-reports/accountingReportModel.test.js`
- `src/features/accounting-reports/AccountingReportActions.jsx`
- `src/features/accounting-reports/AccountingReportActions.test.js`
- `src/features/accounting-reports/accountingReportExport.js`
- `src/features/accounting-reports/accountingReportExport.test.js`
- `src/features/accounting-reports/accountingCostReportIntegration.test.js`
- `src/features/purchase-accounting/purchaseAccountingSection.test.js`

### RED evidence

Observed before the production edits:

- the output-snapshot helper did not exist;
- action tests received the original report reference and had no injectable click-time clock;
- all four real captured reports had an empty `generatedAt` and undated filename;
- Excel workbook metadata had no `记录数` row.

### GREEN evidence

Tests capture `2026-08-12T03:04:05.678Z` and filenames such as:

- `工资报表_2026-07_2026-08-12`
- `经营费用报表_2026-07_2026-08-12`
- `采购对账报表_2026-08_2026-08-12`
- `月度成本汇总_2026-08_2026-08-12`

They also prove the source report is unchanged, the snapshot is recursively frozen, `now()` runs once per initiated output, and Excel writes record count.

## Finding 6 — Actual adapter formatting and widths

### Implementation

- Added shared cell resolution for column format, row-selected `formatKey`, optional per-cell `row.formats`, and explicit/inferred alignment.
- Money, number, and percent values align right; dates align center; text aligns left unless explicitly overridden.
- Excel preserves typed numeric values for money, numbers, and percentages. Percentage display uses a literal percent number format (`0.####"%"`) matching the adapters' human percentage values.
- Print and Excel use the same format/alignment resolver.
- Salary month/date, Operating allocation, and Purchase payment/invoice status alignment is explicit or inferred as required.
- Monthly and Purchase mixed-format summary rows carry their per-row format into both renderers.
- Print markup emits a proportional `<colgroup>` from declared column widths.

Files:

- `src/features/accounting-reports/accountingReportModel.js`
- `src/features/accounting-reports/AccountingReportPrintSheet.jsx`
- `src/features/accounting-reports/accountingReportExport.js`
- `src/features/accounting-reports/salaryReport.js`
- `src/features/accounting-reports/operatingExpenseReport.js`
- `src/features/accounting-reports/purchaseAccountingReport.js`
- `src/features/accounting-reports/monthlySummaryReport.js`
- `src/features/accounting-reports/AccountingReportPrintSheet.test.js`
- `src/features/accounting-reports/accountingReportExport.test.js`

### RED evidence

The real four-adapter tests failed before the renderer edits:

- print dates/statuses defaulted left;
- mixed Monthly/Purchase values rendered raw because only `column.format` was read;
- print markup contained no proportional `<colgroup>`;
- Excel did not resolve mixed row formats into typed money/percentage cells and aligned dates left.

### GREEN evidence

Real Salary, Operating, Purchase, and Monthly workbook/print tests pass. They assert typed values, number formats, money/number/date/status alignment, formatted mixed rows, and 11 proportional Salary detail columns.

## Finding 7 — Multipage numbering and repeated-header semantics

### Implementation

- Both named portrait and landscape `@page` rules now define a Chromium margin box at `@bottom-center` with `第 <page> 页 / 共 <pages> 页` counters.
- The normal-flow footer contains signatures only; the ineffective last-page-only page-number span was removed.
- Excel records the safe metadata boundary after the editable notice.
- Single-section worksheets repeat metadata through their exact detail-table header.
- Multi-section worksheets repeat safe metadata only, never the first section header across unrelated later sections.
- Added forced-multipage structures with 80 Salary rows and 60 Monthly metrics in both print and workbook tests.

Files:

- `src/features/accounting-reports/AccountingReportPrintSheet.jsx`
- `src/features/accounting-reports/accountingReportPrint.css`
- `src/features/accounting-reports/accountingReportExport.js`
- `src/features/accounting-reports/AccountingReportPrintSheet.test.js`
- `src/features/accounting-reports/accountingReportExport.test.js`

### RED evidence

Observed before the production edits:

- `@bottom-center` count was `0`;
- print markup still contained the normal-flow page-number footer;
- a forced multi-section Monthly sheet repeated through the first section header (`1:70` in the RED fixture) instead of safe metadata (`1:8`).

### GREEN evidence

- CSS contains two named-page `@bottom-center` margin boxes and both page/page-count counters.
- Forced Salary workbook repeats `1:<salary header row>`.
- Forced Monthly workbook repeats only `1:<editable notice row>`.
- Both forced print models retain the correct named page, complete rows, repeated table-header CSS, and signature-only footer.

## Final command evidence

### Focused accounting/format/pagination/StrictMode/Project Cost matrix

```text
node --test src/features/accounting-reports/*.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/project-cost-ledger/projectCostLedgerExport.test.js src/features/project-cost-ledger/ProjectCostPrintSheet.test.js
```

Result: `120 tests`, `120 pass`, `0 fail`, `0 cancelled`, `0 skipped`, `0 todo`; duration `1569.360958 ms`.

### Full repository suite

```text
npm test
```

Result: `1791 tests`, `1791 pass`, `0 fail`, `0 cancelled`, `0 skipped`, `0 todo`; duration `11805.255791 ms`.

### Production build

```text
npm run build
```

Result: PASS. Vite `6.4.3`; `528` modules transformed; built in `4.43 s`.

The build emitted the repository's existing advisory that some minified chunks exceed 500 kB. It is non-fatal and unrelated to report correctness; ExcelJS remains dynamically imported and its production-boundary test passes.

### Static hygiene

```text
git diff --check
```

Result before report creation: PASS with no whitespace errors. It is rerun after the report and before commit.

## Browser evidence and limitations

Command:

```text
npm run dev -- --host 127.0.0.1 --port 5179
```

The in-app browser opened `http://127.0.0.1:5179/`. The only reachable application state was:

```text
系统配置未完成
认证服务尚未配置，请联系系统管理员。
```

No authenticated Accounting Center or Excel/PDF/Print controls were available, so the browser session could not invoke those callbacks or observe the operating-system download dialog / print preview. No claim is made about unavailable native surfaces. Browser tabs were finalized and the development server was stopped.

The requested callback/cleanup behavior is nevertheless executed in DOM integration tests rather than inferred from source:

- StrictMode Excel/PDF/Print callback count is exactly one.
- buttons recover from pending state;
- stale output guards cancel;
- PDF/Print callback observes the portal mounted;
- the portal is removed after completion;
- workbook download tests execute the guarded link click and Blob URL revocation;
- print tests execute body-class restoration after success and failure.

## Whole-diff self-review

- Re-read all seven findings and the approved design/plan against the production diff.
- Checked that timestamps are created only at initiation and each output keeps one immutable snapshot.
- Checked that malformed and stale states remain fail-closed; no rule was weakened to satisfy ready-zero coverage.
- Checked that forbidden Purchase payment data is omitted while authorized non-ready data blocks output.
- Checked that Purchase screen reconciliation remains unfiltered while report facts share one filtered cohort.
- Checked real four-adapter paths in both Excel and print, including percentage typing and proportional widths.
- Checked single- vs multi-section repeated-row boundaries and signature/page-number separation.
- Found and corrected the direct-Operating vs Monthly Summary projection-key collision through a new observed RED→GREEN regression test.
- Project Cost production files are untouched; its focused export, print, atomic-load, audit, and stale-guard tests all pass.

## Changed files

- `src/App.jsx`
- `src/features/accounting-reports/AccountingReportActions.jsx`
- `src/features/accounting-reports/AccountingReportActions.test.js`
- `src/features/accounting-reports/AccountingReportPrintSheet.jsx`
- `src/features/accounting-reports/AccountingReportPrintSheet.test.js`
- `src/features/accounting-reports/accountingCostReportIntegration.test.js`
- `src/features/accounting-reports/accountingReportExport.js`
- `src/features/accounting-reports/accountingReportExport.test.js`
- `src/features/accounting-reports/accountingReportModel.js`
- `src/features/accounting-reports/accountingReportModel.test.js`
- `src/features/accounting-reports/accountingReportPrint.css`
- `src/features/accounting-reports/monthlySummaryReport.js`
- `src/features/accounting-reports/operatingExpenseReport.js`
- `src/features/accounting-reports/purchaseAccountingReport.js`
- `src/features/accounting-reports/salaryReport.js`
- `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- `src/features/purchase-accounting/purchaseAccountingSection.test.js`
- `.superpowers/sdd/2026-08-11-accounting-center-report-exports/final-fix-report.md`

## Remaining concerns

No unresolved functional or test concern is known. The only limitations are the local browser's unconfigured authentication service (which prevents an authenticated native-surface recheck) and the existing non-fatal Vite chunk-size advisory. No deployment was performed.

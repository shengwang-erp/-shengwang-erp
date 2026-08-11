# Accounting Center Report Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add leadership-ready Excel, PDF, and print output to Salary Records, Operating Expenses, Purchase Reconciliation, and Monthly Summary while preserving each screen's active filters.

**Architecture:** Introduce one shared, immutable accounting-report model and two renderers: ExcelJS for editable workbooks and a portalled React print sheet for browser print/PDF. Each accounting section owns a small adapter that converts its already-authorized, already-filtered visible data into the shared model, so export totals and page totals cannot drift.

**Tech Stack:** React 19, Vite 6, Node test runner, ExcelJS 4.4, existing custom React DOM test harness, CSS paged media.

## Global Constraints

- Add export support only to 工资记录、经营费用、采购对账、月度汇总; do not change the existing 项目成本 export behavior.
- Every output uses the current page filters; do not add an all-history export option.
- Excel is an editable working copy and must say `本文件为 ERP 导出副本，可编辑；修改不会回写系统。`.
- PDF and print share the browser print flow; the PDF button opens the print dialog for `另存为 PDF`.
- Export documents use white A4 paper, black/dark-gray text, light-gray headers, thin gray borders, and no black-gold document styling.
- Body text is 10–11 pt, table headers are 10.5–11 pt, section headings are 12–14 pt, and report titles are 16–18 pt.
- Salary, operating-expense, and purchase reports use A4 landscape; monthly summary uses A4 portrait unless its final table width proves that landscape is required.
- Amounts are right-aligned with thousands separators; dates/statuses are centered; long remarks wrap without shrinking the font.
- The footer contains 制表人、复核人、审批人; 制表人 is the current login name and the other two fields remain blank.
- Loading, stale, error, or structurally incomplete authoritative data must fail closed; a ready filter with zero rows exports an explicit `当前筛选条件下无记录` report.
- Export respects existing view permissions and never adds an import or write-back route.

---

## File Map

**Create**

- `src/features/accounting-reports/accountingReportModel.js` — validates/freezes the shared report contract, formats metadata, and neutralizes spreadsheet formulas.
- `src/features/accounting-reports/accountingReportModel.test.js` — contract, filename, immutability, zero-row, and formula-safety tests.
- `src/features/accounting-reports/accountingReportExport.js` — builds/downloads ExcelJS workbooks and scopes native printing.
- `src/features/accounting-reports/accountingReportExport.test.js` — workbook appearance, A4 settings, signatures, formulas, download guard, and print-scope tests.
- `src/features/accounting-reports/AccountingReportPrintSheet.jsx` — generic portalled leadership report for PDF/print.
- `src/features/accounting-reports/AccountingReportActions.jsx` — shared three-button controller and stale-output guard.
- `src/features/accounting-reports/accountingReportPrint.css` — isolated white-paper A4 layout and pagination rules.
- `src/features/accounting-reports/AccountingReportPrintSheet.test.js` — print markup, portal isolation, typography, and paged-media tests.
- `src/features/accounting-reports/accountingReportActions.test.js` — Excel/PDF/print interaction and filter-change cancellation tests.
- `src/features/accounting-reports/salaryReport.js` — salary summary/detail adapter.
- `src/features/accounting-reports/operatingExpenseReport.js` — category/project summary and detail adapter.
- `src/features/accounting-reports/purchaseAccountingReport.js` — reconciliation summary/detail/anomaly adapter.
- `src/features/accounting-reports/monthlySummaryReport.js` — multi-section monthly summary adapter.
- `src/features/accounting-reports/accountingReportAdapters.test.js` — exact filters, totals, column definitions, and empty report tests for all four adapters.
- `src/features/accounting-reports/accountingCostReportIntegration.test.js` — section wiring, permissions, readiness, and action availability tests.
- `src/features/accounting-reports/accountingReportActions.css` — desktop-oriented action strip that follows the ERP page theme only on screen.

**Modify**

- `src/App.jsx` — pass the current user's display name, add operating scope/project filters, build Salary/Operating/Monthly report models, and mount shared actions.
- `src/features/purchase-accounting/PurchaseAccountingSection.jsx` — accept the preparer name, build the purchase report from filtered rows, and mount shared actions.
- `src/features/purchase-accounting/purchaseAccountingSection.test.js` — assert purchase action/readiness/filter wiring without weakening existing reconciliation tests.

---

### Task 1: Shared Immutable Report Contract

**Files:**
- Create: `src/features/accounting-reports/accountingReportModel.js`
- Create: `src/features/accounting-reports/accountingReportModel.test.js`

**Interfaces:**
- Produces: `createAccountingReportModel(input)`, `escapeAccountingSpreadsheetText(value)`, `formatAccountingReportDisplayValue(value, format)`, `formatAccountingReportFileName(value)`, and the JSDoc contracts `AccountingReportModel`, `AccountingReportSection`, `AccountingReportColumn`.
- `createAccountingReportModel` returns a deeply frozen object with `{ id, title, companyName, generatedAt, preparedBy, orientation, fileName, filterLines, recordCount, summary, sections, notes, editableNotice }`.

- [ ] **Step 1: Write failing model tests**

```js
test('report contract is immutable, formula-safe, and keeps a zero-row section', () => {
  const report = createAccountingReportModel({
    id: 'salary', title: '工资记录表', companyName: '生旺株式会社',
    generatedAt: '2026-08-11T03:00:00.000Z', preparedBy: '=管理员',
    orientation: 'landscape', fileName: '工资记录_2026-08',
    filterLines: [{ label: '月份', value: '2026-08' }], recordCount: 0,
    summary: [{ label: '实发工资合计', value: 0, format: 'money' }],
    sections: [{ id: 'detail', title: '工资明细', sheetName: '工资明细', columns: [
      { key: 'employeeName', label: '员工', width: 18, align: 'left', format: 'text' },
    ], rows: [], emptyText: '当前筛选条件下无记录' }], notes: [],
  })
  assert.equal(report.preparedBy, '=管理员')
  assert.equal(escapeAccountingSpreadsheetText(report.preparedBy), "'=管理员")
  assert.equal(report.sections[0].emptyText, '当前筛选条件下无记录')
  assert.ok(Object.isFrozen(report.sections[0].columns))
  assert.equal(formatAccountingReportFileName('工资/记录:2026-08'), '工资_记录_2026-08')
})
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `node --test src/features/accounting-reports/accountingReportModel.test.js`  
Expected: FAIL because `accountingReportModel.js` does not exist.

- [ ] **Step 3: Implement the exact report contract**

```js
export const ACCOUNTING_REPORT_EDITABLE_NOTICE =
  '本文件为 ERP 导出副本，可编辑；修改不会回写系统。'

export function escapeAccountingSpreadsheetText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string') return value
  return /^(?:[\u0000-\u0020]*[=+\-@]|[\t\r\n])/u.test(value) ? `'${value}` : value
}

export function formatAccountingReportFileName(value) {
  return String(value || '会计报表').replace(/[\\/:*?"<>|]/gu, '_')
}
```

Validate `orientation` against `portrait|landscape`, require unique section IDs and non-empty sheet names/columns, clone all arrays, set the zero-row message when omitted, and recursively freeze the result. Preserve human-readable text in the model for print/PDF; call `escapeAccountingSpreadsheetText` only while writing Excel cells. `formatAccountingReportDisplayValue` must format `money`, `number`, `percent`, `date`, and `text` consistently for the print renderer.

- [ ] **Step 4: Run the model tests and verify GREEN**

Run: `node --test src/features/accounting-reports/accountingReportModel.test.js`  
Expected: PASS with contract validation, deep-freeze, safe filename, and formula-neutralization assertions.

- [ ] **Step 5: Commit the contract**

```bash
git add src/features/accounting-reports/accountingReportModel.js src/features/accounting-reports/accountingReportModel.test.js
git commit -m "feat: add accounting report model"
```

### Task 2: White-Paper Excel Renderer

**Files:**
- Create: `src/features/accounting-reports/accountingReportExport.js`
- Create: `src/features/accounting-reports/accountingReportExport.test.js`

**Interfaces:**
- Consumes: frozen `AccountingReportModel` from Task 1.
- Produces: `createAccountingReportWorkbook(ExcelJS, report)`, `exportAccountingReportXlsx(report, { outputGuard } = {})`, and `printAccountingReport(printOperation, documentRef)`.

- [ ] **Step 1: Write failing workbook tests**

Use a two-section fixture and assert all of the following exact properties:

```js
assert.equal(sheet.pageSetup.paperSize, 9)
assert.equal(sheet.pageSetup.orientation, 'landscape')
assert.equal(sheet.pageSetup.fitToWidth, 1)
assert.equal(sheet.getCell('A1').font.size, 18)
assert.equal(sheet.getRow(firstHeaderRow).height, 26)
assert.equal(sheet.getCell(firstHeaderRow, 1).fill.fgColor.argb, 'FFF2F2F2')
assert.equal(sheet.getCell(firstHeaderRow, 1).font.color.argb, 'FF111111')
assert.ok(sheet.getRows(1, sheet.rowCount).some((row) =>
  row.values.includes('本文件为 ERP 导出副本，可编辑；修改不会回写系统。')))
assert.ok(sheet.getRows(1, sheet.rowCount).some((row) => row.values.includes('复核人：')))
assert.ok(sheet.getRows(1, sheet.rowCount).some((row) => row.values.includes('审批人：')))
```

Also assert 24–28 point data rows, thin gray borders, wrapped long text, money formats, frozen first table header, print title rows, a bounded print area, literal dynamic `import('exceljs')`, Blob URL revocation, cancellation when `outputGuard()` turns false, and restored body classes after print success/failure.

- [ ] **Step 2: Run workbook tests and verify RED**

Run: `node --test src/features/accounting-reports/accountingReportExport.test.js`  
Expected: FAIL because the renderer exports are missing.

- [ ] **Step 3: Implement the Excel renderer**

Use these public constants and rules:

```js
export const ACCOUNTING_REPORT_MONEY_FORMAT = '¥#,##0;[Red]-¥#,##0'
const PAPER_A4 = 9
const COLORS = Object.freeze({ text: 'FF111111', muted: 'FF555555', header: 'FFF2F2F2', border: 'FFB7B7B7' })
```

Create sheets in first-seen `section.sheetName` order. Write title/company/filter/generated/preparer/editable-notice rows once per sheet; then write summary rows and each section sequentially. Merge metadata rows across the section's full column count, give table headers a light-gray fill and dark text, emit the empty-state row when `rows.length === 0`, append the three signature fields, configure A4/fit-to-width/repeated headers/margins/print area, and add auto-filter only to a sheet containing one detail section.

`exportAccountingReportXlsx` must dynamically import ExcelJS, check `outputGuard` before import, after import, after serialization, and before link click, then revoke the Blob URL in `finally`.

`printAccountingReport` must add `accounting-report-printing` to the existing body class string, invoke native print, and restore the exact original class in `finally`.

- [ ] **Step 4: Run workbook tests and verify GREEN**

Run: `node --test src/features/accounting-reports/accountingReportExport.test.js`  
Expected: PASS.

- [ ] **Step 5: Commit the renderer**

```bash
git add src/features/accounting-reports/accountingReportExport.js src/features/accounting-reports/accountingReportExport.test.js
git commit -m "feat: add white paper accounting workbook export"
```

### Task 3: Shared Print Sheet and Action Controller

**Files:**
- Create: `src/features/accounting-reports/AccountingReportPrintSheet.jsx`
- Create: `src/features/accounting-reports/AccountingReportActions.jsx`
- Create: `src/features/accounting-reports/accountingReportPrint.css`
- Create: `src/features/accounting-reports/accountingReportActions.css`
- Create: `src/features/accounting-reports/AccountingReportPrintSheet.test.js`
- Create: `src/features/accounting-reports/AccountingReportActions.test.js`

**Interfaces:**
- Consumes: `report`, `disabled`, `contextIdentity`, and optional dependency-injection props `exportExcel`/`printReport` used by focused tests; production defaults are `exportAccountingReportXlsx` and `printAccountingReport`.
- Produces: `<AccountingReportActions report disabled contextIdentity onError />` and `<AccountingReportPrintSheet report />`.

- [ ] **Step 1: Write failing print markup and CSS tests**

```js
const html = renderToStaticMarkup(createElement(AccountingReportPrintSheet, { report }))
for (const text of ['生旺株式会社', '工资记录表', '筛选条件', '制表人', '复核人', '审批人']) {
  assert.match(html, new RegExp(text, 'u'))
}
assert.match(css, /@page\s+accounting-report-landscape\s*\{[^}]*size:\s*A4 landscape/isu)
assert.match(css, /@page\s+accounting-report-portrait\s*\{[^}]*size:\s*A4 portrait/isu)
assert.match(css, /font-size:\s*10pt/iu)
assert.match(css, /thead\s*\{[^}]*display:\s*table-header-group/isu)
assert.match(css, /break-inside:\s*avoid/iu)
assert.doesNotMatch(css, /#(?:c69a45|d6a84b|b88736)/iu)
assert.doesNotMatch(css, /background(?:-color)?:\s*#(?:000|000000|171513)/iu)
```

Mount through `installWarehouseReactDom()` and assert the portal root is a direct child of `document.body` and is removed on unmount.

- [ ] **Step 2: Write failing action-controller tests**

Render the controller and assert that it shows `导出 Excel`, `导出 PDF`, `打印`, and `在打印窗口选择“另存为 PDF”`; disabled state blocks all three; Excel calls the injected export with the current frozen model; PDF/print mount the sheet before calling print; changing `contextIdentity` before an async export finishes prevents download/print and clears the pending state.

- [ ] **Step 3: Run both tests and verify RED**

Run: `node --test src/features/accounting-reports/AccountingReportPrintSheet.test.js src/features/accounting-reports/AccountingReportActions.test.js`  
Expected: FAIL because both components and CSS are absent.

- [ ] **Step 4: Implement the print sheet**

Render a normal-flow portalled root under `document.body` with this hierarchy:

```jsx
<article className={`accounting-report-sheet ${report.orientation}`}>
  <header>
    <strong>{report.companyName}</strong>
    <h1>{report.title}</h1>
    <dl>{report.filterLines.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <p>生成时间：{report.generatedAt}　制表人：{report.preparedBy}　记录数：{report.recordCount}</p>
  </header>
  <section className="accounting-report-summary">
    <h2>汇总</h2>
    <table><tbody>{report.summary.map(({ label, value, format }) => <tr key={label}><th>{label}</th><td>{formatAccountingReportDisplayValue(value, format)}</td></tr>)}</tbody></table>
  </section>
  {report.sections.map((section) => <section key={section.id}>
    <h2>{section.title}</h2>
    <table>
      <thead><tr>{section.columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
      <tbody>{section.rows.length === 0
        ? <tr><td colSpan={section.columns.length}>{section.emptyText}</td></tr>
        : section.rows.map((row, index) => <tr key={`${section.id}:${index}`}>{section.columns.map((column) => <td className={`align-${column.align}`} key={column.key}>{formatAccountingReportDisplayValue(row[column.key], column.format)}</td>)}</tr>)}</tbody>
    </table>
  </section>)}
  <aside>{report.notes.map((note) => <p key={note}>{note}</p>)}</aside>
  <footer><span>制表人：{report.preparedBy}</span><span>复核人：</span><span>审批人：</span><span className="accounting-report-page-number" /></footer>
</article>
```

The CSS must hide the portal on screen; during `body.accounting-report-printing`, hide only body siblings, show the root, select the named portrait/landscape page, repeat table headers, prevent row splits, use 10 pt body text, 10.5–11 pt headers, 24–28 pt-equivalent row padding, white background, `#111` text, `#f2f2f2` headers, and thin gray borders. Set `.accounting-report-page-number::after { content: "第 " counter(page) " 页"; }` inside print media.

- [ ] **Step 5: Implement the action controller**

Use an internal monotonically increasing generation ref and the `contextIdentity` prop. Excel calls `exportAccountingReportXlsx(report, { outputGuard })`. PDF and Print set a `print-ready` state, render `AccountingReportPrintSheet`, then call `printAccountingReport()` from an effect on the next microtask; every completion path clears state only when its generation is still current. Errors call `onError('报表生成失败，当前页面和筛选已保留')`.

- [ ] **Step 6: Run both tests and verify GREEN**

Run: `node --test src/features/accounting-reports/AccountingReportPrintSheet.test.js src/features/accounting-reports/AccountingReportActions.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit shared print UI**

```bash
git add src/features/accounting-reports/AccountingReportPrintSheet.jsx src/features/accounting-reports/AccountingReportActions.jsx src/features/accounting-reports/accountingReportPrint.css src/features/accounting-reports/accountingReportActions.css src/features/accounting-reports/AccountingReportPrintSheet.test.js src/features/accounting-reports/AccountingReportActions.test.js
git commit -m "feat: add accounting report print framework"
```

### Task 4: Salary and Operating-Expense Adapters

**Files:**
- Create: `src/features/accounting-reports/salaryReport.js`
- Create: `src/features/accounting-reports/operatingExpenseReport.js`
- Create: `src/features/accounting-reports/accountingReportAdapters.test.js`

**Interfaces:**
- Produces: `createSalaryReport({ records, month, employee, preparedBy, generatedAt })`.
- Produces: `createOperatingExpenseReport({ records, month, expenseType, allocationScope, projectId, projectName, preparedBy, generatedAt })`.

- [ ] **Step 1: Write failing adapter tests**

For salary, assert the report contains only supplied filtered rows, uses two sheets named `工资汇总` and `工资明细`, totals basic salary/overtime/bonus/deduction/net salary, counts unique employees, includes the month and employee filter, and exposes these detail columns in order:

```js
['工资编号', '工资月份', '员工', '基本工资', '出勤天数', '加班费', '奖金', '扣款', '实发工资', '记录日期', '备注']
```

For operating expenses, assert two sheets named `费用汇总` and `费用明细`, exact total/count/company/project amounts, category and project summary sections, and detail columns:

```js
['费用编号', '日期', '费用类别', '金额', '费用归属', '项目', '经办人', '备注']
```

Include `=HYPERLINK(...)`, `+经办人`, and an empty result fixture. Assert the adapters preserve the exact human-readable strings, while `escapeAccountingSpreadsheetText` neutralizes them when the Excel renderer writes cells.

- [ ] **Step 2: Run adapter tests and verify RED**

Run: `node --test src/features/accounting-reports/accountingReportAdapters.test.js`  
Expected: FAIL because both adapters are absent.

- [ ] **Step 3: Implement salary adapter**

Build the summary and detail from the supplied records only; do not filter a second time. Convert amount fields through a finite-number helper, group unique employees by `employeeId || employeeName`, and use `month || '不限月份'` plus `employee.trim() || '全部员工'` in `filterLines`.

- [ ] **Step 4: Implement operating-expense adapter**

Build category/project aggregates from the supplied records only. Label `allocateToProject` rows `项目费用`, all others `公司费用`, and use `未绑定项目` when required text is missing. The report model uses landscape orientation and a filename containing the selected month.

- [ ] **Step 5: Run adapter tests and verify GREEN**

Run: `node --test src/features/accounting-reports/accountingReportAdapters.test.js`  
Expected: PASS for salary, operating expenses, empty filters, totals, columns, and formula safety.

- [ ] **Step 6: Commit both adapters**

```bash
git add src/features/accounting-reports/salaryReport.js src/features/accounting-reports/operatingExpenseReport.js src/features/accounting-reports/accountingReportAdapters.test.js
git commit -m "feat: build salary and expense reports"
```

### Task 5: Salary and Operating-Expense Screen Integration

**Files:**
- Modify: `src/App.jsx:4341-4370`
- Modify: `src/App.jsx:6870-7654`
- Create: `src/features/accounting-reports/accountingCostReportIntegration.test.js`

**Interfaces:**
- Consumes: Task 3 actions and Task 4 adapters.
- Adds `reportPreparedBy` to `AccountingCostPage`, `SalaryRecordsSection`, and `OperatingExpenseSection`.

- [ ] **Step 1: Write failing integration tests**

Load `/src/App.jsx` through Vite, render `AccountingCostPage` with access narrowed to one visible section, and assert:

```js
for (const label of ['导出 Excel', '导出 PDF', '打印']) {
  assert.ok(button(container, label))
}
```

For salary, change month and employee inputs and verify the on-screen records contain exactly the matching employee row. For operating expenses, assert new `费用归属` and `项目` selectors, choose `项目费用` plus one project, and verify the on-screen records contain only that project. Read the module source and assert the salary and operating adapters receive `records: filteredRecords`, the active filter values, and `reportPreparedBy`; the adapter tests provide the exact report-row assertions.

- [ ] **Step 2: Run integration test and verify RED**

Run: `node --test src/features/accounting-reports/accountingCostReportIntegration.test.js`  
Expected: FAIL because the actions, preparer prop, and operating filters are not wired.

- [ ] **Step 3: Pass the minimum identity**

At the authenticated call site add:

```jsx
access={accountingAccess}
reportPreparedBy={currentUser.name || currentUser.employeeId || '当前用户'}
projectCostLedgerService={activeProjectCostLedgerService}
```

The first and third lines already exist; insert only the middle line and preserve every other existing prop.

Do not pass the full `currentUser` object into export components.

- [ ] **Step 4: Wire salary actions**

Memoize the salary report from `filteredRecords`, `monthFilter`, `employeeFilter`, and `reportPreparedBy`. Mount `AccountingReportActions` beside the section title with a context identity containing both filters and the record IDs/updated values used in the report. Keep exports enabled for a ready zero-row result.

- [ ] **Step 5: Add operating scope/project filters and actions**

Add state values `allocationScopeFilter` and `projectFilter`. Filter with:

```js
const scopeMatched = allocationScopeFilter === 'project'
  ? record.allocateToProject === true
  : allocationScopeFilter === 'company'
    ? record.allocateToProject !== true
    : true
const projectMatched = projectFilter ? record.projectId === projectFilter : true
```

Reset `projectFilter` when scope changes away from `project`; render the project selector only for project scope. Build the report from the resulting `filteredRecords` and mount shared actions.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node --test src/features/accounting-reports/accountingCostReportIntegration.test.js src/features/accounting-reports/accountingReportAdapters.test.js`  
Expected: PASS.

- [ ] **Step 7: Commit screen integration**

```bash
git add src/App.jsx src/features/accounting-reports/accountingCostReportIntegration.test.js
git commit -m "feat: export salary and operating expense reports"
```

### Task 6: Purchase Reconciliation Report

**Files:**
- Create: `src/features/accounting-reports/purchaseAccountingReport.js`
- Modify: `src/features/accounting-reports/accountingReportAdapters.test.js`
- Modify: `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- Modify: `src/features/purchase-accounting/purchaseAccountingSection.test.js`
- Modify: `src/App.jsx:6988-7000`

**Interfaces:**
- Produces: `createPurchaseAccountingReport({ rows, summary, anomalies, month, projectLabel, source, paymentStatus, paymentVisible, preparedBy, generatedAt })`.
- `PurchaseAccountingSection` accepts `reportPreparedBy`; export and print dependency injection remains encapsulated in the shared action-controller tests.

- [ ] **Step 1: Add failing purchase adapter tests**

Assert sheets `对账汇总` and `对账明细`; summary values for purchase cost, payment cash, outstanding balance, missing invoices, and anomaly count; filter lines for month/project/source/payment status; anomaly text in a separate summary section; and conditional omission of paid/unpaid/payment-status columns when `paymentVisible === false`.

Expected visible detail headers when payment is available:

```js
['采购编号', '日期', '商品', '供应商', '项目', '采购来源', '采购成本', '已付', '未付', '付款状态', '发票状态']
```

- [ ] **Step 2: Add failing purchase component tests**

Extend the existing purchase test fixture to assert all three actions appear only when `accrualState.status === 'ready'`; filtering still narrows the visible rows by month/project/source/payment status; payment fields are excluded when the payment source is not ready; and loading/error/forbidden accrual states render no export buttons. Add a source assertion that `createPurchaseAccountingReport` receives the already-filtered `rows`, current `readModel.summary/anomalies`, and `reportPreparedBy`; the adapter test verifies the exact report rows.

- [ ] **Step 3: Run purchase tests and verify RED**

Run: `node --test src/features/accounting-reports/accountingReportAdapters.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js`  
Expected: FAIL on the missing purchase adapter and actions.

- [ ] **Step 4: Implement purchase adapter and wiring**

Build the report from the already-filtered `rows` variable and current `readModel.summary/anomalies`. Pass a stable project display label from `availableProjects`. Mount shared actions only in the ready return branch and pass `reportPreparedBy` from `AccountingCostPage`. The context identity must include month, project, source, payment status, readiness, and the filtered purchase IDs/payment totals.

- [ ] **Step 5: Run purchase tests and verify GREEN**

Run: `node --test src/features/accounting-reports/accountingReportAdapters.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js`  
Expected: PASS without changes to reconciliation calculations.

- [ ] **Step 6: Commit purchase export**

```bash
git add src/App.jsx src/features/accounting-reports/purchaseAccountingReport.js src/features/accounting-reports/accountingReportAdapters.test.js src/features/purchase-accounting/PurchaseAccountingSection.jsx src/features/purchase-accounting/purchaseAccountingSection.test.js
git commit -m "feat: export purchase reconciliation reports"
```

### Task 7: Monthly Summary Report

**Files:**
- Create: `src/features/accounting-reports/monthlySummaryReport.js`
- Modify: `src/features/accounting-reports/accountingReportAdapters.test.js`
- Modify: `src/features/accounting-reports/accountingCostReportIntegration.test.js`
- Modify: `src/App.jsx:7654-8050`

**Interfaces:**
- Produces: `createMonthlySummaryReport({ month, coreMetrics, sourceMetrics, pendingMetrics, notes, preparedBy, generatedAt, scopeLabel })`.
- Adds `reportPreparedBy` to `MonthlySummarySection`.

- [ ] **Step 1: Write failing monthly adapter tests**

Assert portrait A4, one sheet named `月度汇总`, and four ordered sections:

```js
['核心成本汇总', '采购来源汇总', '待核算成本', '数据口径说明']
```

Verify every visible metric preserves its exact label/value, pending rows include amount and item count, company total appears only when supplied, permission-limited output says `按当前账号可见范围`, and notes include the no-double-counting accounting explanation.

- [ ] **Step 2: Write failing monthly integration tests**

Assert actions are disabled or absent while any allowed authoritative source is loading/error/stale, while the project ledger is incomplete, or when model construction fails. Assert forbidden sources do not leak rows and do not by themselves block a report for the remaining authorized scope. In the ready case, assert exported values equal the labels and amounts rendered in the stats grid.

- [ ] **Step 3: Run monthly tests and verify RED**

Run: `node --test src/features/accounting-reports/accountingReportAdapters.test.js src/features/accounting-reports/accountingCostReportIntegration.test.js`  
Expected: FAIL because monthly arrays and export actions are absent.

- [ ] **Step 4: Refactor the existing visible metrics into shared arrays**

Create `coreMetrics`, `sourceMetrics`, and `pendingMetrics` with `{ label, value, format, count? }`. Render the existing cards by mapping these arrays, then pass the same arrays to `createMonthlySummaryReport`. This is a behavior-preserving refactor: do not recompute totals in the adapter.

- [ ] **Step 5: Define fail-closed readiness and mount actions**

Set `reportBlocked` when an allowed source is loading/error/stale, `costModelError` is true, or `projectLedgerStatus === 'incomplete'`. Forbidden sources are omitted and `scopeLabel` becomes `按当前账号可见范围`; they are never converted to zero-value rows. Mount actions beside the title and use month, source-state statuses, visible metric values, and preparer name in the context identity.

- [ ] **Step 6: Run monthly tests and verify GREEN**

Run: `node --test src/features/accounting-reports/accountingReportAdapters.test.js src/features/accounting-reports/accountingCostReportIntegration.test.js`  
Expected: PASS and existing monthly-summary assertions remain green.

- [ ] **Step 7: Commit monthly export**

```bash
git add src/App.jsx src/features/accounting-reports/monthlySummaryReport.js src/features/accounting-reports/accountingReportAdapters.test.js src/features/accounting-reports/accountingCostReportIntegration.test.js
git commit -m "feat: export monthly accounting summaries"
```

### Task 8: Full Regression and Visual Print Verification

**Files:**
- Modify only files identified by failing tests or observed print defects; do not broaden feature scope.

**Interfaces:**
- Consumes all previous tasks.
- Produces a deployable build with evidence for tests, workbook structure, and A4 rendering.

- [ ] **Step 1: Run all focused accounting report tests**

Run:

```bash
node --test src/features/accounting-reports/*.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/project-cost-ledger/projectCostLedgerExport.test.js src/features/project-cost-ledger/ProjectCostPrintSheet.test.js
```

Expected: PASS; the existing project-cost tests prove that feature was not replaced or regressed.

- [ ] **Step 2: Run the full suite**

Run: `npm test`  
Expected: all tests pass with zero failures.

- [ ] **Step 3: Build production assets**

Run: `npm run build`  
Expected: Vite exits 0 and writes the production bundle.

- [ ] **Step 4: Inspect generated workbooks programmatically**

Create each report from test fixtures and load the generated buffer back through ExcelJS. Assert sheet names, title/filter/preparer text, signature rows, A4 orientation, print area, minimum column width, non-black header fill, and exact displayed totals after round-trip.

- [ ] **Step 5: Verify all four reports in Chrome**

Run the local app, open each accounting tab on a desktop viewport, apply non-default filters, click Excel/PDF/Print, and verify:

- Buttons stay within the desktop action row.
- The print preview is white A4 with no ERP navigation or dark background.
- Text remains readable without scaling below 10 pt.
- Table headers repeat, rows are not split, long remarks wrap, totals are visually separated, and signature space is present.
- PDF/print content and Excel rows match the applied filters.
- A zero-result filter prints the explicit no-record row.

- [ ] **Step 6: Commit only verified corrections**

```bash
git add src
git commit -m "test: verify accounting report exports"
```

Skip this commit when verification required no code or test correction.

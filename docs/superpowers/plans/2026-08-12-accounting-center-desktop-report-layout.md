# Accounting Center Desktop Report Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将会计成本中心的顶部栏目入口和四个新增报表操作区统一为“项目成本”式电脑端布局，同时保持所有业务、权限、筛选和导出行为不变。

**Architecture:** 扩展现有 `AccountingReportActions`，让它同时负责报表标题、当前筛选范围和三个输出按钮的共享卡片结构；各业务栏目只传入自己的标题，筛选范围直接由现有 `report.filterLines` 生成。顶部栏目入口仍由 `AccountingCostPage` 维护，只用会计中心作用域内的 CSS 改为单行等分；采购对账仅调整操作卡片在 DOM 中的位置，不重写模型或状态。

**Tech Stack:** React 19、Vite 6、原生 CSS、Node.js `node:test`、项目自带 React DOM 测试工具。

## Global Constraints

- 电脑端优先；顶部所有当前可见入口保持单行等分，窄屏横向滚动而不折行。
- 工资记录、经营费用、采购对账、月度汇总采用与项目成本一致的黑金横向操作卡片。
- 现有筛选、录入、统计卡片、数据表格、权限、输出快照、Excel、PDF 和打印逻辑不得改变。
- PDF 提示必须固定在“导出 PDF”按钮下方，不得影响其他按钮对齐。
- 不新增依赖，不修改白纸报表输出样式，不做无关重构。
- 所有真实渲染测试不得依赖测试 DOM 未实现的 `classList`；使用 `className` 或节点关系断言。

---

### Task 1: 共享报表操作卡片

**Files:**
- Modify: `src/features/accounting-reports/AccountingReportActions.jsx`
- Modify: `src/features/accounting-reports/accountingReportActions.css`
- Test: `src/features/accounting-reports/AccountingReportActions.test.js`

**Interfaces:**
- Consumes: 既有 `report`, `disabled`, `contextIdentity`, `exportExcel`, `printReport`, `now` props。
- Produces: 新增可选 prop `title: string`；组件渲染 `.accounting-report-toolbar`、`.accounting-report-toolbar-copy` 和现有 `.accounting-report-actions`。筛选说明由 `report.filterLines` 生成，报表不可用时显示“跟随当前页面筛选条件输出”。

- [ ] **Step 1: 写共享卡片结构的失败测试**

在现有静态渲染测试后增加：

```js
test('renders a project-cost-style report toolbar with title and current scope', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportActions, {
    title: '工资记录报表', report, contextIdentity: 'layout',
    exportExcel() {}, printReport() {},
  }))
  assert.match(html, /class="accounting-report-toolbar"/u)
  assert.match(html, /class="accounting-report-toolbar-copy"/u)
  assert.match(html, /<strong>工资记录报表<\/strong>/u)
  assert.match(html, /月份：2026-07/u)
  assert.match(html, /class="accounting-report-pdf-action"[\s\S]*导出 PDF[\s\S]*另存为 PDF/u)
})
```

把测试用 `report.filterLines` 调整为含“月份：2026-07”的字面量，确保说明来自真实报表模型而不是硬编码。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/features/accounting-reports/AccountingReportActions.test.js`

Expected: FAIL，缺少 `accounting-report-toolbar` 和标题/筛选说明。

- [ ] **Step 3: 实现最小共享卡片结构**

在组件中增加纯函数和 prop：

```jsx
function reportScopeText(report) {
  const lines = Array.isArray(report?.filterLines) ? report.filterLines : []
  const scope = lines
    .filter(({ label, value }) => label && value)
    .map(({ label, value }) => `${label}：${value}`)
    .join(' · ')
  return scope || '跟随当前页面筛选条件输出'
}

export default function AccountingReportActions({
  title = '会计报表', report, disabled = false, contextIdentity, /* existing props */
}) {
  // 保留所有现有状态和输出逻辑
  return <>
    <section className="accounting-report-toolbar" aria-label={`${title}输出操作`}>
      <div className="accounting-report-toolbar-copy">
        <strong>{title}</strong>
        <span>{reportScopeText(report)}</span>
      </div>
      <div className="accounting-report-actions">
        {/* 原有三个按钮和 PDF 提示原样移入 */}
      </div>
    </section>
    {/* 原有打印组件保持不变 */}
  </>
}
```

在 `accountingReportActions.css` 中使用项目成本同源尺寸和主题变量：

```css
.erp-black-gold .accounting-report-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin: 20px 0 22px;
  padding: 20px 22px;
  border: 1px solid var(--erp-border-subtle);
  border-top: 2px solid var(--erp-accent-gold);
  border-radius: 14px;
  background: var(--erp-bg-surface);
}

.erp-black-gold .accounting-report-toolbar-copy { display: grid; gap: 6px; min-width: 0; }
.erp-black-gold .accounting-report-toolbar-copy strong { color: var(--erp-accent-gold-soft); font-size: 22px; }
.erp-black-gold .accounting-report-toolbar-copy span { color: var(--erp-text-muted); line-height: 1.55; }
.erp-black-gold .accounting-report-actions { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 10px; }
.erp-black-gold .accounting-report-actions button {
  min-height: 42px; padding: 9px 15px; border: 1px solid var(--erp-border-gold-muted);
  border-radius: 9px; color: var(--erp-accent-gold-soft);
  background: var(--erp-accent-gold-surface); font-weight: 700;
}
.erp-black-gold .accounting-report-pdf-action { align-items: stretch; text-align: center; }
.erp-black-gold .accounting-report-pdf-action small { color: var(--erp-text-muted); white-space: nowrap; }

@media (max-width: 1023px) {
  .erp-black-gold .accounting-report-toolbar { flex-direction: column; align-items: stretch; }
}
```

保留非黑金环境的基础可用样式，不覆盖现有打印 DOM。

- [ ] **Step 4: 运行共享组件测试并确认 GREEN**

Run: `node --test src/features/accounting-reports/AccountingReportActions.test.js`

Expected: PASS，既有 StrictMode、延迟输出、错误恢复和打印挂载用例全部继续通过。

- [ ] **Step 5: 提交共享卡片**

```bash
git add src/features/accounting-reports/AccountingReportActions.jsx \
  src/features/accounting-reports/accountingReportActions.css \
  src/features/accounting-reports/AccountingReportActions.test.js
git commit -m "feat: add accounting report toolbar card"
```

---

### Task 2: 顶部单行标签与三个 App 内栏目接线

**Files:**
- Modify: `src/App.jsx:6938-7000, 7150-7160, 7697-7707, 8195-8205`
- Modify: `src/blackGoldTheme.css:1001-1019`
- Modify: `src/styles.css:1048-1072, 2933-2942`
- Test: `src/features/accounting-reports/accountingCostReportIntegration.test.js`

**Interfaces:**
- Consumes: Task 1 的 `AccountingReportActions({ title, report, ... })`。
- Produces: 会计中心顶部 `.accounting-entry-grid` 单行可滚动布局；工资、经营费用、月度汇总分别传入“工资记录报表”“经营费用明细”“月度成本汇总”。

- [ ] **Step 1: 写三个栏目与顶部标签的失败测试**

在真实 `AccountingCostPage` 挂载测试中增加：

```js
test('desktop accounting navigation and app report sections expose the unified toolbar contract', async () => {
  const scenario = await mount({
    salaryRecords: [], operatingExpenseRecords: [],
    reportPreparedBy: '系统管理员',
    reportActionDependencies: { exportExcel() {}, printReport() {} },
  })
  try {
    const navigation = findWarehouseTestElement(scenario.container, (element) =>
      element.className === 'accounting-entry-grid')
    assert.ok(navigation)
    assert.equal(navigation.children.length, 5)
    assert.deepEqual(navigation.children.map((item) => item.textContent), [
      '工资记录', '项目成本', '经营费用', '采购对账', '月度汇总',
    ])
    assert.match(scenario.container.textContent, /工资记录报表/u)
    assert.doesNotMatch(scenario.container.textContent, /公司级成本/u)
  } finally {
    await cleanup(scenario)
  }
})
```

另用现有 `button(container, label).click()` 逐次切换到经营费用和月度汇总，断言对应标题出现且每个页面只有一个 `.accounting-report-toolbar`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `node --test src/features/accounting-reports/accountingCostReportIntegration.test.js`

Expected: FAIL，栏目仍渲染旧 `SectionTitle`，没有三个新标题或统一卡片。

- [ ] **Step 3: 接入三个栏目并删除重复标题**

将三处旧结构：

```jsx
<div className="section-title-with-actions">
  <SectionTitle title="工资记录" note="公司级成本" />
  <AccountingReportActions ... />
</div>
```

替换为：

```jsx
<AccountingReportActions
  title="工资记录报表"
  report={salaryReport}
  disabled={!sourceReady}
  contextIdentity={salaryReportIdentity}
  {...reportActionDependencies}
/>
```

经营费用使用 `title="经营费用明细"`，月度汇总使用 `title="月度成本汇总"`。不移动这三个栏目的表单、筛选或统计 DOM。

- [ ] **Step 4: 收紧顶部栏目为单行电脑端标签**

在会计中心作用域内覆盖旧网格和大卡片尺寸：

```css
.accounting-cost-page .accounting-entry-grid {
  display: flex;
  flex-wrap: nowrap;
  gap: 0;
  overflow-x: auto;
  margin-bottom: 22px;
  border: 1px solid var(--erp-border-subtle, #dce4ef);
  border-radius: 12px;
}

.accounting-cost-page .accounting-entry {
  flex: 1 0 180px;
  min-height: 58px;
  border-radius: 0;
  box-shadow: none;
  white-space: nowrap;
}
```

在 `blackGoldTheme.css` 中保留现有选中颜色，并为相邻按钮增加细分隔线；首尾圆角由容器裁切。不要改变其他页面复用的 `.accounting-entry`。

- [ ] **Step 5: 运行 App 集成测试并确认 GREEN**

Run: `node --test src/features/accounting-reports/accountingCostReportIntegration.test.js src/features/accounting-reports/AccountingReportActions.test.js`

Expected: PASS，所有权限、就绪状态、筛选和输出一致性用例继续通过。

- [ ] **Step 6: 提交顶部标签和三个栏目**

```bash
git add src/App.jsx src/styles.css src/blackGoldTheme.css \
  src/features/accounting-reports/accountingCostReportIntegration.test.js
git commit -m "feat: align accounting desktop report sections"
```

---

### Task 3: 采购对账操作卡片与内容顺序

**Files:**
- Modify: `src/features/purchase-accounting/PurchaseAccountingSection.jsx:245-335`
- Test: `src/features/purchase-accounting/purchaseAccountingSection.test.js`

**Interfaces:**
- Consumes: Task 1 的 `AccountingReportActions({ title, report, ... })`。
- Produces: 采购对账 ready 状态中，操作卡片位于筛选面板之前；非 ready 权限/加载提示仍 fail closed。

- [ ] **Step 1: 写采购页面顺序的失败测试**

在静态渲染测试中增加：

```js
test('purchase accounting places the unified report toolbar before filters', () => {
  const html = renderSection({ projects, purchaseRecords, purchasePaymentRecords })
  assert.match(html, /采购对账报表/u)
  const toolbar = html.indexOf('accounting-report-toolbar')
  const filters = html.indexOf('filter-panel')
  const stats = html.indexOf('stats-grid')
  assert.ok(toolbar >= 0)
  assert.ok(filters > toolbar)
  assert.ok(stats > filters)
  assert.equal((html.match(/<h2 id="purchase-accounting-title">/gu) || []).length, 0)
})
```

保留既有 `payment readiness` 用例作为按钮禁用和权限回归保护。

- [ ] **Step 2: 运行采购测试并确认 RED**

Run: `node --test src/features/purchase-accounting/purchaseAccountingSection.test.js`

Expected: FAIL，当前操作组件位于筛选面板之后且仍渲染旧 subsection title。

- [ ] **Step 3: 调整 ready 状态的视觉顺序**

在 ready 分支中删除重复的旧标题，将共享卡片放在筛选面板之前：

```jsx
<section aria-labelledby="purchase-accounting-title">
  <AccountingReportActions
    title="采购对账报表"
    report={report}
    disabled={paymentReportBlocked}
    contextIdentity={reportContextIdentity}
    {...reportActionDependencies}
  />
  <div className="filter-panel">{/* 原筛选字段原样保留 */}</div>
  {/* 原状态提示、统计卡片、说明和表格原样保留 */}
</section>
```

为操作卡片的标题提供稳定 `id` 或把 `section` 的 `aria-labelledby` 改为与新标题一致的可访问关系。非 ready 分支仍显示“采购对账”和当前错误/加载说明，不暴露报表操作。

- [ ] **Step 4: 运行采购与共享组件测试并确认 GREEN**

Run: `node --test src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/accounting-reports/AccountingReportActions.test.js`

Expected: PASS，采购付款权限、筛选报表事实和延迟导出 guard 用例不回归。

- [ ] **Step 5: 提交采购布局**

```bash
git add src/features/purchase-accounting/PurchaseAccountingSection.jsx \
  src/features/purchase-accounting/purchaseAccountingSection.test.js
git commit -m "feat: align purchase accounting report toolbar"
```

---

### Task 4: 完整验证与电脑端设计 QA

**Files:**
- Create: `design-qa.md`
- Modify only if QA exposes an in-scope P0/P1/P2 issue: files listed in Tasks 1–3 and their tests。

**Interfaces:**
- Consumes: Tasks 1–3 的完整页面实现。
- Produces: `design-qa.md`，最终必须包含 `final result: passed`；若认证或浏览器环境阻止相同状态对比，则写 `final result: blocked` 并明确说明，不虚报视觉通过。

- [ ] **Step 1: 运行聚焦测试矩阵**

Run:

```bash
node --test \
  src/features/accounting-reports/AccountingReportActions.test.js \
  src/features/accounting-reports/accountingCostReportIntegration.test.js \
  src/features/purchase-accounting/purchaseAccountingSection.test.js \
  src/features/project-cost-ledger/ProjectCostLedgerSection.test.js
```

Expected: PASS，项目成本参考布局及四个新增报表栏目均无行为回归。

- [ ] **Step 2: 运行完整测试和生产构建**

Run: `npm test`

Expected: 全部测试通过，0 fail。

Run: `npm run build`

Expected: Vite production build 成功；允许既有 chunk-size warning，不允许新增 error。

- [ ] **Step 3: 启动本地页面并做电脑端浏览器检查**

Run: `npm run dev -- --host 127.0.0.1 --port 4173`

在 1440×1000 视口逐栏检查：

- 五个可见入口同一行、等宽、当前项突出，月度汇总不掉行。
- 工资、经营费用、采购对账、月度汇总均为标题左、按钮右的完整卡片。
- 三个按钮高度一致；PDF 提示只在 PDF 按钮下方。
- 采购对账的筛选区位于卡片下方；其余内容顺序不变。
- 1023px 附近卡片转为上下布局；更窄宽度标签栏横向滚动而不折行。
- 浏览器控制台无新增错误，栏目切换和可用的导出按钮仍可点击。

- [ ] **Step 4: 写设计 QA 并修复阻断问题**

`design-qa.md` 至少记录参考截图、检查视口、各栏目结果、控制台结果和最终结论。发现 P0/P1/P2 时先补失败测试，再做最小修复，并重复 Steps 1–3；P3 仅记录为后续建议。

- [ ] **Step 5: 提交 QA 与必要修正**

```bash
git add design-qa.md src/App.jsx src/styles.css src/blackGoldTheme.css \
  src/features/accounting-reports/AccountingReportActions.jsx \
  src/features/accounting-reports/accountingReportActions.css \
  src/features/accounting-reports/AccountingReportActions.test.js \
  src/features/accounting-reports/accountingCostReportIntegration.test.js \
  src/features/purchase-accounting/PurchaseAccountingSection.jsx \
  src/features/purchase-accounting/purchaseAccountingSection.test.js
git commit -m "test: verify accounting desktop report layout"
```

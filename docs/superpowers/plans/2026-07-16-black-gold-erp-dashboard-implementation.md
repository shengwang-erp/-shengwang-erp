# 黑金 ERP 与老板驾驶舱升级实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将登录后的 ERP 统一为深黑金响应式后台，并用真实且权限安全的数据实现含税收款、税抜利润、权责成本、已记录现金流和业务异常图表。

**Architecture:** 保留现有 React/Vite 页面和持久化体系，在外层增加统一路由/权限策略和独立主题作用域；把现金来源、人工窗口、成本及驾驶舱汇总拆成纯函数领域模块，由会计月度汇总和老板驾驶舱共同消费。图表使用可访问的原生 SVG，`App.jsx` 只负责数据加载、权限投影和页面接线。

**Tech Stack:** React 19、Vite 6、Node.js `node:test`、Supabase 现有安全 RPC、原生 SVG、CSS。

## Global Constraints

- 工作目录固定为 `/Users/yu/Documents/kaobeierp/employee-auth-worktree`，分支为 `codex/employee-auth-security`。
- 执行前必须读取并使用 `superpowers:using-git-worktrees`；当前已有隔离 worktree 时只验证，不另建冲突 worktree。
- 不修改、不格式化、不暂存现有脏文件 `src/styles.css`、`src/features/projects/ProjectPage.jsx`、项目文档迁移文件及其他用户改动。
- 黑金主题令牌与对旧页的覆盖只写入新文件 `src/blackGoldTheme.css`；`executiveDashboard.css` 只保留驾驶舱结构/布局。两个文件的所有选择器都必须以 `.erp-black-gold` 为作用域；登录页保持作用域外。
- 视觉验收参考图为 `/Users/yu/Desktop/Co de x/351a0903518b117f2011afd6303f72f7.png`；参考其黑金层级、信息密度与图表气质，不复制图中演示数字。
- 固定颜色令牌：背景 `#080806`，一级表面 `#0f0f0d`，二级表面 `#171612`，悬浮表面 `#211f18`，边框 `#3a3120`，品牌金 `#d6aa5c`，高亮金 `#f0c56d`，正文 `#f4efe4`，次要文字 `#9c9485`，正常绿 `#63b36a`，风险红 `#e05c46`，警告橙 `#d98a3d`，信息蓝 `#6d94bd`。
- 响应式边界：`<768px` 移动底栏，`768–1023px` 紧凑换行，`>=1024px` 固定桌面侧栏和顶部栏。
- 不新增图表依赖，不修改 `package.json` 依赖；图表只使用原生 SVG。
- 不生成演示数据。只有 `status: 'ready' + data: []` 可以解释为真实零值；`loading/error/forbidden` 及 `stale: true` 必须显式呈现。
- 收款显示含税字段；利润只使用 `profitAnchorTaxExclusiveAmount`；严禁用含税合同额计算利润。
- 不放宽现有表 RLS。为落实已确认的“采购发生额只需采购查看权、付款数据另需敏感权”，Task 7 通过新的安全 RPC 返回去除付款字段的采购权责数据；付款表和完整采购记录仍受原敏感权限保护。除该增量 RPC 及其测试外，不修改其他 migration、RLS 或 grant。
- 现金流只统计具备 `recorded` 来源标记的数据；兼容默认日期或付款方式不得获得现金资格。
- 每个任务遵循 RED → GREEN → 回归 → 独立提交；提交时只暂存该任务列出的文件。

---

### Task 1: 月份窗口与逐源状态基础

**Files:**
- Create: `src/features/executive-dashboard/dashboardTime.js`
- Create: `src/features/executive-dashboard/dashboardTime.test.js`
- Create: `src/services/businessSourceState.js`
- Create: `src/services/businessSourceState.test.js`

**Interfaces:**
- Produces: `normalizeMonth(value)`, `buildMonthWindow(endMonth, length)`, `monthOfDate(value)`, `isDateInMonth(value, month)`.
- Produces: `toBusinessSourceState(cloudState, options)`, `resolveRequiredSources(states, keys)`, `classifyBusinessSourceError(error)`.
- Source states use `{ status, data, code, message, source, stale, updatedAt, fatal }` where status is `loading | ready | error | forbidden`; 过期是独立布尔值，不是第五种状态。

- [ ] **Step 1: Write the failing month and source-state tests**

```js
// src/features/executive-dashboard/dashboardTime.test.js
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMonthWindow, isDateInMonth, monthOfDate, normalizeMonth } from './dashboardTime.js'

test('buildMonthWindow returns twelve ordered months across a year boundary', () => {
  assert.deepEqual(buildMonthWindow('2026-02', 12), [
    '2025-03', '2025-04', '2025-05', '2025-06', '2025-07', '2025-08',
    '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  ])
})

test('month parsing rejects invalid calendar months and accepts exact ISO dates', () => {
  assert.equal(normalizeMonth('2026-13'), '')
  assert.equal(normalizeMonth('1899-12'), '')
  assert.equal(normalizeMonth('2101-01'), '')
  assert.equal(normalizeMonth('2026-07'), '2026-07')
  assert.equal(monthOfDate('2026-02-31'), '')
  assert.equal(isDateInMonth('2026-07-31', '2026-07'), true)
  assert.equal(isDateInMonth('2026-08-01', '2026-07'), false)
})
```

```js
// src/services/businessSourceState.test.js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  classifyBusinessSourceError,
  resolveRequiredSources,
  toBusinessSourceState,
} from './businessSourceState.js'

test('only an authorized completed source becomes ready', () => {
  assert.deepEqual(
    toBusinessSourceState(
      { loading: false, error: '', source: 'supabase' },
      { readAllowed: true, data: [] },
    ),
    {
      status: 'ready', data: [], code: '', message: '', source: 'supabase',
      stale: false, updatedAt: null, fatal: false,
    },
  )
  assert.equal(toBusinessSourceState({}, { readAllowed: false, data: [] }).status, 'forbidden')
  assert.equal(toBusinessSourceState({
    loading: false, error: '没有权限执行此数据操作',
    code: 'ACCESS_DENIED', source: 'blocked',
  }, { data: [] }).status, 'forbidden')
})

test('required-source resolution never treats loading, forbidden, or error as zero', () => {
  const result = resolveRequiredSources({
    projects: { status: 'ready', data: [] },
    receipts: { status: 'error', data: [] },
  }, ['projects', 'receipts'])
  assert.equal(result.status, 'error')
  assert.deepEqual(result.blockingSources, ['receipts'])
})

test('a missing required source is loading and a stale source remains ready but disclosed', () => {
  assert.deepEqual(resolveRequiredSources({}, ['projects']), {
    status: 'loading', blockingSources: ['projects'], staleSources: [],
  })
  assert.deepEqual(resolveRequiredSources({
    projects: { status: 'ready', data: [], stale: true },
  }, ['projects']), {
    status: 'ready', blockingSources: [], staleSources: ['projects'],
  })
  assert.equal(resolveRequiredSources({
    projects: { status: 'unknown', data: [] },
  }, ['projects']).status, 'error')
})

test('error classification keeps auth/config fatal and access denial local', () => {
  assert.deepEqual(classifyBusinessSourceError({ code: 'ACCESS_DENIED' }), {
    status: 'forbidden', fatal: false, code: 'ACCESS_DENIED', message: '无权读取该数据',
  })
  assert.equal(classifyBusinessSourceError({ code: 'AUTH_SESSION_INVALID' }).fatal, true)
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
node --test src/features/executive-dashboard/dashboardTime.test.js src/services/businessSourceState.test.js
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for the two implementation files.

- [ ] **Step 3: Implement strict month arithmetic and source-state resolution**

```js
// src/features/executive-dashboard/dashboardTime.js
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/u
const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u

export function normalizeMonth(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = MONTH_PATTERN.exec(text)
  if (!match) return ''
  const year = Number(match[1])
  return year >= 1900 && year <= 2100 ? text : ''
}

export function buildMonthWindow(endMonth, length = 12) {
  const normalized = normalizeMonth(endMonth)
  if (!normalized || !Number.isSafeInteger(length) || length < 1 || length > 120) return []
  const [year, month] = normalized.split('-').map(Number)
  const endIndex = year * 12 + month - 1
  if (endIndex - length + 1 < 1900 * 12) return []
  return Array.from({ length }, (_, offset) => {
    const index = endIndex - length + 1 + offset
    const itemYear = Math.floor(index / 12)
    const itemMonth = index % 12 + 1
    return `${String(itemYear).padStart(4, '0')}-${String(itemMonth).padStart(2, '0')}`
  })
}

export function monthOfDate(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  const match = DATE_PATTERN.exec(text)
  if (!match) return ''
  const [, yearText, monthText, dayText] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (year < 1900 || year > 2100) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day ? text.slice(0, 7) : ''
}

export function isDateInMonth(value, month) {
  return monthOfDate(value) === normalizeMonth(month) && normalizeMonth(month) !== ''
}
```

```js
// src/services/businessSourceState.js
const FATAL_CODES = new Set([
  'AUTH_SESSION_INVALID', 'CONFIGURATION_ERROR', 'AUTH_SERVICE_UNAVAILABLE',
])

export function classifyBusinessSourceError(error = {}) {
  const code = typeof error?.code === 'string' && error.code
    ? error.code
    : 'DATA_OPERATION_FAILED'
  if (code === 'ACCESS_DENIED') {
    return { status: 'forbidden', fatal: false, code, message: '无权读取该数据' }
  }
  return {
    status: 'error', fatal: FATAL_CODES.has(code), code,
    message: error?.message || '业务数据读取失败',
  }
}

export function toBusinessSourceState(cloudState = {}, {
  readAllowed = true, data = null, stale = false, updatedAt = null,
} = {}) {
  if (!readAllowed) {
    return {
      status: 'forbidden', data: null, code: 'ACCESS_DENIED', message: '无权读取该数据',
      source: 'blocked', stale: false, updatedAt, fatal: false,
    }
  }
  if (cloudState.loading) {
    return {
      status: 'loading', data: null, code: '', message: '',
      source: cloudState.source || '', stale: false, updatedAt, fatal: false,
    }
  }
  if (cloudState.error || cloudState.code) {
    const classified = classifyBusinessSourceError({
      code: cloudState.code || 'DATA_OPERATION_FAILED', message: cloudState.error,
    })
    return { ...classified, data: null, source: cloudState.source || 'blocked', stale: false, updatedAt }
  }
  return {
    status: 'ready', data, code: '', message: '', fatal: false,
    source: cloudState.source || 'supabase', stale: Boolean(stale), updatedAt,
  }
}

export function resolveRequiredSources(states = {}, requiredKeys = []) {
  const validStatuses = new Set(['loading', 'ready', 'error', 'forbidden'])
  const statusOf = (key) => {
    const value = states[key]?.status
    if (value === undefined) return 'loading'
    return validStatuses.has(value) ? value : 'error'
  }
  const blockingSources = requiredKeys.filter((key) => statusOf(key) !== 'ready')
  const staleSources = requiredKeys.filter((key) =>
    statusOf(key) === 'ready' && states[key]?.stale === true)
  const priority = ['forbidden', 'error', 'loading']
  const status = priority.find((candidate) =>
    blockingSources.some((key) => statusOf(key) === candidate)) || 'ready'
  return { status, blockingSources, staleSources }
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: 6 tests PASS.

- [ ] **Step 5: Commit the foundation**

```bash
git add src/features/executive-dashboard/dashboardTime.js src/features/executive-dashboard/dashboardTime.test.js src/services/businessSourceState.js src/services/businessSourceState.test.js
git commit -m "feat: add dashboard time and source state contracts"
```

---

### Task 2: 现金事实来源与采购付款资格

**Files:**
- Create: `src/features/cost-accounting/cashFactProvenance.js`
- Create: `src/features/cost-accounting/cashFactProvenance.test.js`
- Modify: `src/App.jsx` (`normalizePurchasePaymentRecord`, `normalizeFuelRecord`, `normalizeVehicleExpenseRecord` and their submit handlers)
- Modify: `src/features/purchase-accounting/purchaseAccountingDomain.js`
- Modify: `src/features/purchase-accounting/purchaseAccountingDomain.test.js`
- Modify: `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- Modify: `src/features/purchase-accounting/purchaseAccountingSection.test.js`

**Interfaces:**
- Produces: `PURCHASE_PAYMENT_CASH_SCHEMA`, `VEHICLE_FUEL_CASH_SCHEMA`, `VEHICLE_EXPENSE_CASH_SCHEMA`.
- Produces: `normalizeCashFactProvenance(record, schema, defaults)`, `isRecordedCashFact(record, schema)`, `isLegacyInferredCashFact(record, schema)`, `markCashFactAsRecorded(record, schema)`.
- Extends purchase read model with `cashPaymentRows`; `monthPaymentCash` only sums those rows.

- [ ] **Step 1: Write failing provenance and purchase-cash tests**

```js
// src/features/cost-accounting/cashFactProvenance.test.js
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PURCHASE_PAYMENT_CASH_SCHEMA,
  VEHICLE_FUEL_CASH_SCHEMA,
  isLegacyInferredCashFact,
  isRecordedCashFact,
  markCashFactAsRecorded,
  normalizeCashFactProvenance,
} from './cashFactProvenance.js'

test('compatibility defaults never become recorded after repeated normalization', () => {
  const first = normalizeCashFactProvenance({}, VEHICLE_FUEL_CASH_SCHEMA, {
    defaultDate: '2026-07-16', defaultPaymentMethod: '现金',
  })
  const second = normalizeCashFactProvenance(first, VEHICLE_FUEL_CASH_SCHEMA, {
    defaultDate: '2026-07-16', defaultPaymentMethod: '现金',
  })
  assert.equal(first.fuelDateSource, 'defaulted')
  assert.equal(first.paymentMethodSource, 'defaulted')
  assert.equal(second.fuelDateSource, 'defaulted')
  assert.equal(isRecordedCashFact(second, VEHICLE_FUEL_CASH_SCHEMA), false)
})

test('a submitted payment is explicitly recorded', () => {
  const saved = markCashFactAsRecorded({ paymentDate: '2026-07-10' }, PURCHASE_PAYMENT_CASH_SCHEMA)
  assert.equal(saved.paymentDateSource, 'recorded')
  assert.equal(isRecordedCashFact(saved, PURCHASE_PAYMENT_CASH_SCHEMA), true)
})

test('empty or invalid submitted values cannot be upgraded by UI defaults', () => {
  const empty = normalizeCashFactProvenance(
    markCashFactAsRecorded({}, VEHICLE_FUEL_CASH_SCHEMA),
    VEHICLE_FUEL_CASH_SCHEMA,
    { defaultDate: '2026-07-16', defaultPaymentMethod: '现金' },
  )
  const invalid = markCashFactAsRecorded(
    { paymentDate: '2026-02-31' },
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )
  assert.equal(empty.fuelDateSource, 'defaulted')
  assert.equal(empty.paymentMethodSource, 'defaulted')
  assert.equal(isRecordedCashFact(empty, VEHICLE_FUEL_CASH_SCHEMA), false)
  assert.equal(invalid.paymentDateSource, 'defaulted')
  assert.equal(isRecordedCashFact(invalid, PURCHASE_PAYMENT_CASH_SCHEMA), false)
})

test('legacy persisted dates remain usable but carry an audit disclosure marker', () => {
  const legacy = normalizeCashFactProvenance(
    { paymentDate: '2026-07-01' },
    PURCHASE_PAYMENT_CASH_SCHEMA,
  )
  assert.equal(legacy.paymentDateSource, 'recorded')
  assert.equal(legacy.paymentDateLegacyInferred, true)
  assert.equal(isLegacyInferredCashFact(legacy, PURCHASE_PAYMENT_CASH_SCHEMA), true)
})
```

Add to `purchaseAccountingDomain.test.js`:

```js
test('defaulted payment dates affect payable balance but never month cash', () => {
  const model = buildPurchaseAccountingReadModel({
    month: '2026-07',
    purchaseRecords: [{ purchaseId: 'PO-1', totalCost: 1000, purchaseDate: '2026-07-01' }],
    paymentRecords: [{
      paymentId: 'PAY-1', purchaseId: 'PO-1', paymentDate: '2026-07-16',
      paymentDateSource: 'defaulted', jpyAmount: 400,
    }],
  })
  assert.equal(model.rows[0].paidAmount, 400)
  assert.equal(model.summary.currentOutstanding, 600)
  assert.equal(model.summary.monthPaymentCash, 0)
  assert.deepEqual(model.cashPaymentRows, [])
})
```

- [ ] **Step 2: Run the tests and verify RED**

```bash
node --test src/features/cost-accounting/cashFactProvenance.test.js src/features/purchase-accounting/purchaseAccountingDomain.test.js
```

Expected: FAIL because the provenance module and `cashPaymentRows` do not exist.

- [ ] **Step 3: Implement provenance without allowing re-normalization upgrades**

```js
// src/features/cost-accounting/cashFactProvenance.js
import { monthOfDate } from '../executive-dashboard/dashboardTime.js'

const RECORDED = 'recorded'
const DEFAULTED = 'defaulted'

export const PURCHASE_PAYMENT_CASH_SCHEMA = Object.freeze({
  dateField: 'paymentDate', dateSourceField: 'paymentDateSource',
  dateLegacyField: 'paymentDateLegacyInferred',
})
export const VEHICLE_FUEL_CASH_SCHEMA = Object.freeze({
  dateField: 'fuelDate', dateSourceField: 'fuelDateSource',
  dateLegacyField: 'fuelDateLegacyInferred',
  methodField: 'paymentMethod', methodSourceField: 'paymentMethodSource',
  methodLegacyField: 'paymentMethodLegacyInferred',
})
export const VEHICLE_EXPENSE_CASH_SCHEMA = Object.freeze({
  dateField: 'expenseDate', dateSourceField: 'expenseDateSource',
  dateLegacyField: 'expenseDateLegacyInferred',
  methodField: 'paymentMethod', methodSourceField: 'paymentMethodSource',
  methodLegacyField: 'paymentMethodLegacyInferred',
})

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function validDate(value) {
  return monthOfDate(value) !== ''
}

function resolveSource(record, valueField, sourceField, legacyField, validator) {
  if (record?.[sourceField] === RECORDED || record?.[sourceField] === DEFAULTED) {
    return {
      source: record[sourceField],
      legacyInferred: record?.[legacyField] === true,
    }
  }
  return validator(record?.[valueField])
    ? { source: RECORDED, legacyInferred: true }
    : { source: DEFAULTED, legacyInferred: false }
}

export function normalizeCashFactProvenance(record = {}, schema, {
  defaultDate = '', defaultPaymentMethod = '',
} = {}) {
  const date = resolveSource(
    record, schema.dateField, schema.dateSourceField, schema.dateLegacyField, validDate,
  )
  const next = {
    ...record,
    [schema.dateField]: hasText(record[schema.dateField]) ? record[schema.dateField] : defaultDate,
    [schema.dateSourceField]: date.source,
    [schema.dateLegacyField]: date.legacyInferred,
  }
  if (schema.methodField) {
    const method = resolveSource(
      record, schema.methodField, schema.methodSourceField, schema.methodLegacyField, hasText,
    )
    next[schema.methodSourceField] = method.source
    next[schema.methodLegacyField] = method.legacyInferred
    next[schema.methodField] = hasText(record[schema.methodField])
      ? record[schema.methodField]
      : defaultPaymentMethod
  }
  return next
}

export function markCashFactAsRecorded(record = {}, schema) {
  const next = {
    ...record,
    [schema.dateSourceField]: validDate(record[schema.dateField]) ? RECORDED : DEFAULTED,
    [schema.dateLegacyField]: false,
  }
  if (schema.methodField) {
    next[schema.methodSourceField] = hasText(record[schema.methodField]) ? RECORDED : DEFAULTED
    next[schema.methodLegacyField] = false
  }
  return next
}

export function isRecordedCashFact(record = {}, schema) {
  if (record[schema.dateSourceField] !== RECORDED || !validDate(record[schema.dateField])) return false
  return !schema.methodField || (
    record[schema.methodSourceField] === RECORDED && hasText(record[schema.methodField])
  )
}

export function isLegacyInferredCashFact(record = {}, schema) {
  return record[schema.dateLegacyField] === true ||
    Boolean(schema.methodLegacyField && record[schema.methodLegacyField] === true)
}
```

In each `App.jsx` normalizer, call `normalizeCashFactProvenance` before applying defaults and include the source/audit fields in the returned object. In each submit handler, call `markCashFactAsRecorded` on the raw form before the normalizer. Do not normalize every untouched row without preserving its existing source fields. Empty or invalid submitted values stay `defaulted`; legacy rows with valid persisted values may enter cash but must retain the `LegacyInferred` marker so the cash-flow coverage panel permanently discloses that historical defaults cannot be distinguished retrospectively.

In `purchaseAccountingDomain.js`, compute:

```js
const cashPaymentRows = paymentRows.filter((row) =>
  isRecordedCashFact(row, PURCHASE_PAYMENT_CASH_SCHEMA),
)
```

Return `cashPaymentRows` and calculate `monthPaymentCash` from it. Keep `paymentRows` for paid/unpaid derivation.

- [ ] **Step 4: Run provenance, purchase, and UI-label tests**

```bash
node --test src/features/cost-accounting/cashFactProvenance.test.js src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js
```

Expected: all tests PASS; purchase UI uses “本月已记录付款” and “当前未付采购款”.

- [ ] **Step 5: Commit the cash provenance change**

```bash
git add src/features/cost-accounting/cashFactProvenance.js src/features/cost-accounting/cashFactProvenance.test.js src/App.jsx src/features/purchase-accounting/purchaseAccountingDomain.js src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js
git commit -m "feat: preserve recorded cash provenance"
```

---

### Task 3: 十二个月人工核算窗口与缓存加载器

**Files:**
- Create: `src/services/dashboardLaborBridgeService.js`
- Create: `src/services/dashboardLaborBridgeService.test.js`
- Create: `src/features/cost-accounting/laborCostWindow.js`
- Create: `src/features/cost-accounting/laborCostWindow.test.js`

**Interfaces:**
- Consumes: `buildMonthWindow()` from Task 1 and existing `laborAccountingService.getBridgeSummary({ month })`.
- Produces: `createDashboardLaborBridgeLoader({ getBridgeSummary, cache, maxConcurrency, maxAgeMs, now })` with `load({ actorScope, endMonth, length, snapshotMonth, signal, refresh })` and `clear(actorScope)`.
- Loader result is `{ windowStatus, data, windowIncompleteMonths, windowStaleMonths, snapshotMonth, snapshotStatus, snapshotStale, updatedAtByMonth }`; `data` is a month-to-normalized-bridge map. The selected window status and current cumulative snapshot status are independent.
- Produces: `buildLaborCostWindow({ months, snapshotMonth, bridgeState, salaryRecords, employees, laborRecords })`.

- [ ] **Step 1: Write failing cache, failure, and cross-year tests**

```js
// src/services/dashboardLaborBridgeService.test.js
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDashboardLaborBridgeLoader } from './dashboardLaborBridgeService.js'

test('overlapping windows reuse cached month requests', async () => {
  const calls = []
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls.push(month)
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02' })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-03', length: 2, snapshotMonth: '2026-03' })
  assert.deepEqual(calls, ['2026-01', '2026-02', '2026-03'])
})

test('cache entries never cross actor scope', async () => {
  let calls = 0
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      calls += 1
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  await loader.load({ actorScope: 'tenant-1:E-2', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  assert.equal(calls, 2)
})

test('an expired cached month is disclosed as stale when refresh fails', async () => {
  let nowMs = 0
  let offline = false
  const loader = createDashboardLaborBridgeLoader({
    now: () => new Date(nowMs), maxAgeMs: 1000,
    getBridgeSummary: async ({ month }) => {
      if (offline) throw new Error('offline')
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  nowMs = 2000
  offline = true
  const state = await loader.load({ actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 1, snapshotMonth: '2026-02' })
  assert.deepEqual(state.windowStaleMonths, ['2026-02'])
  assert.equal(state.snapshotStale, true)
  assert.equal(state.windowStatus, 'ready')
})

test('a failed uncached month is incomplete instead of zero', async () => {
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      if (month === '2026-01') throw new Error('offline')
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-02',
  })
  assert.equal(state.windowStatus, 'error')
  assert.deepEqual(state.windowIncompleteMonths, ['2026-01'])
  assert.equal(Object.hasOwn(state.data, '2026-01'), false)
})

test('a current snapshot failure never poisons a complete historical window', async () => {
  const loader = createDashboardLaborBridgeLoader({
    getBridgeSummary: async ({ month }) => {
      if (month === '2026-07') throw new Error('snapshot offline')
      return { salaryMonth: month, isAuthoritative: true, salaryTotal: 1,
        projectLaborTotal: 1, projectLaborById: { P1: 1 },
        projectLaborLifetimeTotal: 1, projectLaborLifetimeById: { P1: 1 },
        pendingCount: 0, effectiveFrom: '2025-01-01' }
    },
  })
  const state = await loader.load({
    actorScope: 'tenant-1:E-1', endMonth: '2026-02', length: 2, snapshotMonth: '2026-07',
  })
  assert.equal(state.windowStatus, 'ready')
  assert.deepEqual(state.windowIncompleteMonths, [])
  assert.equal(state.snapshotStatus, 'error')
  assert.equal(Object.hasOwn(state.data, '2026-07'), false)
})
```

```js
// src/features/cost-accounting/laborCostWindow.test.js
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildLaborCostWindow } from './laborCostWindow.js'

const bridge = (overrides = {}) => ({
  salaryMonth: '2026-07', isAuthoritative: true,
  salaryTotal: 300, projectLaborTotal: 200, projectLaborById: { P1: 200 },
  projectLaborLifetimeTotal: 500, projectLaborLifetimeById: { P1: 500 },
  pendingCount: 0, effectiveFrom: '2026-07-01', ...overrides,
})

test('formal months and pre-activation legacy months share one explicit window', () => {
  const model = buildLaborCostWindow({
    months: ['2026-06', '2026-07'],
    snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'ready',
      data: {
        '2026-06': bridge({
          salaryMonth: '2026-06', isAuthoritative: false,
          salaryTotal: 0, projectLaborTotal: 0, projectLaborById: {}, pendingCount: 0,
        }),
        '2026-07': bridge(),
      },
      windowIncompleteMonths: [], windowStaleMonths: ['2026-06'], snapshotMonth: '2026-07',
      snapshotStatus: 'ready', snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [{ salaryMonth: '2026-06', netSalary: 100 }],
    employees: [],
    laborRecords: [{ workDate: '2026-06-10', projectId: 'P1', laborCost: 80 }],
  })
  assert.deepEqual(model.monthly.map((row) => ({
    month: row.month, salaryTotal: row.salaryTotal,
    projectLaborTotal: row.projectLaborTotal, source: row.source, stale: row.stale,
  })), [
    { month: '2026-06', salaryTotal: 100, projectLaborTotal: 80, source: 'legacy', stale: true },
    { month: '2026-07', salaryTotal: 300, projectLaborTotal: 200, source: 'formal', stale: false },
  ])
  assert.deepEqual(model.projectLaborLifetimeById, { P1: 500 })
})

test('an incomplete month carries null amounts instead of fabricated zero', () => {
  const model = buildLaborCostWindow({
    months: ['2026-05'],
    snapshotMonth: '2026-07',
    bridgeState: {
      windowStatus: 'error', data: {}, windowIncompleteMonths: ['2026-05'],
      windowStaleMonths: [], snapshotMonth: '2026-07', snapshotStatus: 'error',
      snapshotStale: false, updatedAtByMonth: {},
    },
    salaryRecords: [{ salaryMonth: '2026-05', netSalary: 999 }],
    employees: [],
    laborRecords: [{ workDate: '2026-05-10', projectId: 'P1', laborCost: 888 }],
  })
  assert.deepEqual(model.monthly[0], {
    month: '2026-05', status: 'error', stale: false,
    salaryTotal: null, projectLaborTotal: null, projectLaborById: null,
    source: null, pendingCount: null,
  })
  assert.equal(model.projectLaborLifetimeById, null)
  assert.equal(model.lifetimeStatus, 'error')
})
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test src/services/dashboardLaborBridgeService.test.js src/features/cost-accounting/laborCostWindow.test.js
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement bounded cached loading and deterministic labor projection**

Implement a queue capped by `maxConcurrency` (default `4`) and a default `maxAgeMs` of five minutes. Require non-empty `actorScope`; cache keys are `${actorScope}:${month}` and identity/permission changes call `clear(previousActorScope)`. Cache each successfully normalized month as `{ value, updatedAt }`; invalid bridge payloads are failures, not zero data. Fresh normal loads reuse cache. Expired or `refresh: true` entries are retried; on failure an existing cache entry is reused with `stale: true`, while an uncached failure is classified against the selected window and snapshot separately. Check `signal.aborted` before starting each request and before returning, and throw a DOM-compatible `AbortError` without publishing a partial result.

Request the union of the selected 12-month window and `snapshotMonth` (the actual current business month). A historical selected month must never supply the current cumulative labor/profit snapshot. The App does not call this loader at all when labor/salary/project-cost access is forbidden.

The loader returns this exact shape in requested month order:

```js
{
  windowStatus: windowIncompleteMonths.length ? 'error' : 'ready',
  data: Object.fromEntries(successfulMonths.map((month) => [month, normalizedBridge])),
  windowIncompleteMonths,
  windowStaleMonths,
  snapshotMonth,
  snapshotStatus: snapshotValue ? 'ready' : 'error',
  snapshotStale,
  updatedAtByMonth,
}
```

Compute `windowIncompleteMonths/windowStaleMonths` only from `buildMonthWindow(endMonth, length)`. A `snapshotMonth` outside that window never enters those arrays. Compute `snapshotStatus/snapshotStale` only from the exact snapshot entry. When snapshot and window share a month, that one request may affect both projections without merging the two fields.

`buildLaborCostWindow` must return exactly:

```js
{
  monthly: months.map((month) => ({
    month,
    status: 'ready' | 'error',
    stale: boolean,
    salaryTotal,
    projectLaborTotal,
    projectLaborById,
    source: 'formal' | 'legacy' | null,
    pendingCount,
  })),
  projectLaborLifetimeById: object | null,
  lifetimeStatus: 'ready' | 'error',
  lifetimeStale: boolean,
  incompleteMonths: bridgeState.windowIncompleteMonths,
  staleMonths: bridgeState.windowStaleMonths,
}
```

Use existing `normalizeBridgeSummary`, `resolveMonthlySalaryTotal`, and `resolveMonthlyProjectLaborTotal`, but call legacy resolution only after a successfully normalized bridge explicitly reports `isAuthoritative: false`. For each such pre-activation month, derive legacy salary from that month's persisted salary rows (falling back to active monthly employees only when no salary row exists) and legacy project labor from normalized labor rows in that month. A missing/invalid bridge on or after activation is incomplete and never falls back to legacy.

Resolve `projectLaborLifetimeById` only from the exact `snapshotMonth` bridge. If that bridge is authoritative, use its lifetime map. If it successfully reports pre-activation, aggregate legacy `laborRecords` by project. If it is missing, return `projectLaborLifetimeById: null` and `lifetimeStatus: 'error'`; if an expired cache is reused, mark `lifetimeStale: true`. Never use the latest month inside the historical trend window as the current snapshot, and never replace an incomplete amount with zero.

- [ ] **Step 4: Run focused and existing bridge tests**

```bash
node --test src/services/dashboardLaborBridgeService.test.js src/features/cost-accounting/laborCostWindow.test.js src/features/labor-accounting/laborAccountingBridge.test.js src/services/laborAccountingService.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the labor window**

```bash
git add src/services/dashboardLaborBridgeService.js src/services/dashboardLaborBridgeService.test.js src/features/cost-accounting/laborCostWindow.js src/features/cost-accounting/laborCostWindow.test.js
git commit -m "feat: load cached dashboard labor windows"
```

---

### Task 4: 统一权责成本与已记录现金流领域模型

**Files:**
- Create: `src/features/cost-accounting/costAccountingDomain.js`
- Create: `src/features/cost-accounting/costAccountingDomain.test.js`
- Create: `src/features/cost-accounting/recordedCashFlowDomain.js`
- Create: `src/features/cost-accounting/recordedCashFlowDomain.test.js`

**Interfaces:**
- Consumes: month helpers, labor window, purchase read-model rows, and provenance schemas.
- Produces: `classifyManualProjectCosts(records)`.
- Produces: `buildCostAccountingReadModel(input)` with `monthlyByMonth`, `projectLifetimeById`, `selectedComposition`, `companyMonthlyTotal`, `pending`, and `anomalies`.
- Produces: `buildRecordedCashFlow(input)` with `series`, `coverage`, and `anomalies`.

`buildCostAccountingReadModel` accepts exactly `{ months, selectedMonth, projectId, activeProjectIds, laborWindow, purchaseRows, fuelRecords, vehicleExpenseRecords, vehicleIssueRecords, manualProjectCosts, operatingExpenses }`. `buildRecordedCashFlow` accepts `{ months, projectId, activeProjectIds, receipts, purchasePaymentRows, fuelRecords, vehicleExpenseRecords, laborWindow, operatingExpenses, manualProjectCosts, vehicleIssueRecords }`. The last four inputs are coverage-only facts and never become cash outflow. A project filter keeps only explicitly project-bound facts; company salary and unallocated operating expense never masquerade as project cost.

- [ ] **Step 1: Write failing cost-priority and cash-coverage tests**

Create this canonical July fixture (IDs omitted below must be added in the test so anomaly keys remain stable):

```js
const july = {
  months: ['2026-07'], selectedMonth: '2026-07', projectId: 'all', activeProjectIds: ['P1'],
  laborWindow: {
    monthly: [{
      month: '2026-07', status: 'ready', stale: false, salaryTotal: 300000,
      projectLaborTotal: 200000, projectLaborById: { P1: 200000 },
      source: 'formal', pendingCount: 0,
    }],
    projectLaborLifetimeById: { P1: 300000 }, lifetimeStatus: 'ready',
    lifetimeStale: false, incompleteMonths: [], staleMonths: [],
  },
  purchaseRows: [{
    purchaseId: 'PO-1', purchaseDate: '2026-07-03', projectId: 'P1',
    purchaseStatus: '正常', totalCost: 80000,
  }],
  fuelRecords: [{
    fuelRecordId: 'F-1', fuelDate: '2026-07-04', fuelDateSource: 'recorded',
    paymentMethod: '现金', paymentMethodSource: 'recorded', fuelAmount: 5000,
    allocateToProject: true, projectId: 'P1',
  }],
  vehicleExpenseRecords: [{
    vehicleExpenseId: 'VE-1', expenseDate: '2026-07-05', expenseDateSource: 'recorded',
    paymentMethod: '卡', paymentMethodSource: 'recorded', amount: 7000,
    allocateToProject: true, projectId: 'P1',
  }],
  vehicleIssueRecords: [{
    issueId: 'VI-1', issueDate: '2026-07-06', repairCost: 9000,
    allocateToProject: true, projectId: 'P1',
  }],
  manualProjectCosts: [
    ['M-L', '人工费', 1000], ['M-M', '材料费', 2000],
    ['M-T', '工具费', 3000], ['M-V', '车辆费', 4000],
    ['M-O', '外包费', 20000], ['M-R', '运输费', 15000],
    ['M-X', '其他费用', 10000],
  ].map(([costRecordId, costType, amount]) => ({
    costRecordId, costType, amount, projectId: 'P1', date: '2026-07-07',
  })),
  operatingExpenses: [{
    operatingExpenseId: 'OE-1', date: '2026-07-08', amount: 5000,
    allocateToProject: true, projectId: 'P1',
  }],
}
```

Use it to assert:

```js
assert.equal(model.companyMonthlyTotal.salary, 300000)
assert.equal(model.companyMonthlyTotal.purchase, 80000)
assert.equal(model.companyMonthlyTotal.vehicle, 12000)
assert.equal(model.companyMonthlyTotal.manual, 45000) // 外包、运输、其他 only
assert.equal(model.pending.manualLaborCosts.length, 1)
assert.equal(model.pending.manualMaterialCosts.length, 1)
assert.equal(model.pending.manualToolCosts.length, 1)
assert.equal(model.pending.manualVehicleCosts.length, 1)
assert.equal(model.pending.vehicleRepairEstimates.length, 1)
assert.equal(model.projectLifetimeById.P1.operating, 5000)
```

For cash flow, add an active P1 receipt `{ receiptId: 'R-1', receivedDate: '2026-07-10', taxInclusiveAmount: 150000 }`, a void receipt, a duplicate ID, an invalid-date receipt, an unbound receipt, one recorded P1 purchase payment, one defaulted vehicle row, and one valid recorded P1 vehicle row. Assert exact July `income`, `purchaseOutflow`, `vehicleOutflow`, `totalOutflow`, and `net`; in a `projectId: 'P1'` run, only explicitly P1-bound facts remain and the unbound receipt is excluded/reported. Assert `coverage` contains fixed entries for `salary_payment_missing`, `operating_payment_missing`, `manual_payment_missing`, `repair_payment_missing`, `historical_default_ambiguity`, and `missing_payment_date`, each with `{ code, label, excludedCount, note }`; derive counts from nonzero `laborWindow.monthly` salary months (or the selected project's nonzero allocation months), applicable operating/manual/repair rows, legacy-inferred provenance flags, and missing/defaulted payment fields respectively, using the same month/project scope as the series. None of those coverage-only amounts may enter the series. Void/deleted, duplicate, invalid amount/date, and missing-project rows each produce a stable anomaly code and do not pollute totals.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test src/features/cost-accounting/costAccountingDomain.test.js src/features/cost-accounting/recordedCashFlowDomain.test.js
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement explicit cost classification and aggregation**

Use these immutable sets:

```js
const PENDING_MANUAL_TYPES = new Set(['人工费', '材料费', '工具费', '车辆费'])
const CONFIRMED_MANUAL_TYPES = new Set(['外包费', '运输费', '其他费用'])
```

`classifyManualProjectCosts` returns confirmed rows and four pending row arrays. `buildCostAccountingReadModel` must:

- use company salary total for company labor, but project allocation for project cost;
- count purchase rows by `purchaseDate` and `projectId`, never payment rows;
- count `fuelAmount` and vehicle expense `amount` only when the date is valid and, for project allocation, `allocateToProject === true` with an ID in `activeProjectIds`; keep issue `repairCost` in pending only;
- count every operating expense once at company level and also allocate it to a project view without adding a second company fact;
- allocate an operating expense to a project only when `allocateToProject === true` and its `projectId` is in `activeProjectIds`; otherwise it remains company-only and any contradictory project fields are ignored/reported;
- exclude inventory balances;
- return a monthly row for every requested month and mark incomplete labor months instead of filling their labor with zero.
- build `monthlyByMonth` only from facts inside the requested window, but build `projectLifetimeById` from every valid historical authoritative fact supplied in the input arrays plus the current labor-lifetime snapshot; changing the selected month must not truncate current cumulative project cost.

Normalize every monetary input through one local `safeYen(value)` contract: only finite, safe, non-negative integers are accepted. Invalid/negative/fractional values and rows missing a required date/project relation are omitted from the corresponding total and appended to `anomalies` with `{ source, recordId, code, message }`. Company totals are checked for safe-integer overflow before publishing.

`buildRecordedCashFlow` must accept only active receipts and `isRecordedCashFact(...)` purchase/vehicle rows. Each series row is:

```js
{
  month,
  income,
  purchaseOutflow,
  vehicleOutflow,
  totalOutflow: purchaseOutflow + vehicleOutflow,
  net: income - purchaseOutflow - vehicleOutflow,
}
```

- [ ] **Step 4: Run cost, cash, purchase, and labor tests**

```bash
node --test src/features/cost-accounting/costAccountingDomain.test.js src/features/cost-accounting/recordedCashFlowDomain.test.js src/features/cost-accounting/cashFactProvenance.test.js src/features/cost-accounting/laborCostWindow.test.js src/features/purchase-accounting/purchaseAccountingDomain.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the shared accounting domains**

```bash
git add src/features/cost-accounting/costAccountingDomain.js src/features/cost-accounting/costAccountingDomain.test.js src/features/cost-accounting/recordedCashFlowDomain.js src/features/cost-accounting/recordedCashFlowDomain.test.js
git commit -m "feat: unify executive cost and cash models"
```

---

### Task 5: 统一后台路由与业务 UI 权限策略

**Files:**
- Create: `src/navigation/adminRoutes.js`
- Create: `src/navigation/adminRoutes.test.js`
- Create: `src/auth/businessAccess.js`
- Create: `src/auth/businessAccess.test.js`

**Interfaces:**
- Produces: `ADMIN_ROUTES`, `MOBILE_PRIMARY_TABS`, `getAdminRoute(view)`, `normalizeAdminView(view)`.
- Produces: `canAccessView(user, view)`, `getVisibleAdminRoutes(user)`, `getDashboardAccess(user)`, `getAccountingAccess(user)`, `getPurchaseAccess(user)`.
- Consumes existing `canAccessModule`, `canCreate`, `canEdit`, `canDelete`, `canViewSensitive`, `isSuperAdmin`, `canViewProjectFinancials`, `canUpdateProjectFinancials`.
- Route objects use `{ view, label, iconText, moduleName, desktop, mobileTab, menuOrder, normalizeTo }`; no component owns a second permission-to-route mapping.

`getDashboardAccess` returns field-level gates, not one coarse “full” boolean:

```js
{
  page,
  projectSnapshot,
  contracts: { view, amounts },
  profit: { view, completeCostRequired: true },
  attendance: { view, identities },
  labor: { view, amounts },
  purchase: { accrual, payments, payable, anomalies },
  vehicle: { view, amounts },
  inventory: { view, amounts },
  tools: { view, amounts },
  costCategories: { labor, purchase, vehicle, manualSupplement, operatingExpense },
}
```

Every sensitive amount additionally requires `sensitive.owner_dashboard_full_view`; contract/profit/project-financial fields retain their stricter whitelist and sensitive requirements. A complete cost/profit total is allowed only when all contributing category gates are true.

- [ ] **Step 1: Write failing route and permission matrix tests**

Tests must cover all 13 desktop routes, `contractRevenue` as a projects child, `workbench/messages/profile` as mobile-only views, SW-000, effective `all`, zero permission, owner-dashboard base access without sensitive data, full financial access, accounting section actions, purchase actions, and the fixed project-financial whitelist.

```js
const activeUser = (effectivePermissionKeys = [], overrides = {}) => ({
  employeeId: 'E-1', employeeNumber: 'SW-101', name: '测试员工',
  department: '工程部', position: '社员', employmentStatus: '在职',
  accountStatus: 'active', mustChangePassword: false,
  effectivePermissionKeys, ...overrides,
})
const activeFinanceUser = (effectivePermissionKeys = []) => activeUser(
  effectivePermissionKeys,
  { employeeId: 'E-FIN', department: '财务部', position: '会计' },
)

test('dashboard shell permission never implies financial data permission', () => {
  const user = activeUser(['module.owner_dashboard.view'])
  const access = getDashboardAccess(user)
  assert.equal(access.page, true)
  assert.equal(access.contracts.view, false)
  assert.equal(access.contracts.amounts, false)
  assert.equal(access.profit.view, false)
  assert.deepEqual(access.costCategories, {
    labor: false, purchase: false, vehicle: false,
    manualSupplement: false, operatingExpense: false,
  })
})

test('direct project revenue access keeps the fixed project-financial whitelist', () => {
  assert.equal(canAccessView(activeUser(['module.projects.view']), 'contractRevenue'), false)
  assert.equal(canAccessView(activeFinanceUser(['module.projects.view']), 'contractRevenue'), true)
})
```

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test src/navigation/adminRoutes.test.js src/auth/businessAccess.test.js
```

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement the complete route table and access projections**

`ADMIN_ROUTES` contains the existing route metadata for `home`, `dashboard`, `projects`, `employees`, `accounting`, `labor`, `stockOut`, `stockReturn`, `purchase`, `vehicle`, `toolBorrow`, `todayAttendance`, and `settings`; add mobile-only `workbench`, `messages`, and `profile`. `contractRevenue` normalizes to `projects` for menu state but calls `canViewProjectFinancials` for access.

`home`, `todayAttendance`, and `profile` require only an active authenticated employee. Every other view requires its declared module; `messages` and `workbench` are shells whose items are filtered again through `canAccessView`. Every financial access projection is a plain object. Purchase accrual records/actions follow `module.purchases.*`; payment rows, payable balances and payment anomalies additionally require `sensitive.purchase_payments_view/update`. Task 7's sanitized RPC prevents payment fields leaking when only accrual access is granted. `owner_dashboard_full_view` never overrides the fixed project-financial whitelist.

- [ ] **Step 4: Run access tests and existing permission tests**

```bash
node --test src/navigation/adminRoutes.test.js src/auth/businessAccess.test.js src/auth/employeeAuthDomain.test.js src/features/projects/projectPermissions.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the policy layer**

```bash
git add src/navigation/adminRoutes.js src/navigation/adminRoutes.test.js src/auth/businessAccess.js src/auth/businessAccess.test.js
git commit -m "feat: centralize admin UI access policy"
```

---

### Task 6: 路由二次守卫与桌面入口接线

**Files:**
- Modify: `src/DesktopAdminShell.jsx`
- Modify: `src/App.jsx` (`AuthenticatedApp`, navigation handler, route branches, project financial update prop)
- Modify: `src/desktopAdminShell.test.js`
- Create: `src/auth/businessAccessIntegration.test.js`
- Modify: `src/features/attendance/todayAttendanceAppIntegration.test.js`

**Interfaces:**
- Consumes: Task 5 route/access exports.
- Produces: a single authorized view used by menu, Home/workbench entry, navigation callback, and render branch.

- [ ] **Step 1: Write failing integration tests**

Use Vite SSR to render `DesktopAdminShell` with a zero-module employee and assert only Home and Today Attendance desktop items are present. Add source/integration assertions that an unauthorized `currentView='dashboard'` resolves to Home, while `contractRevenue` requires `canViewProjectFinancials`. Assert the project revenue update prop calls `canUpdateProjectFinancials(currentUser)`, not `canEdit(currentUser, 'projects')`.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test src/auth/businessAccessIntegration.test.js src/desktopAdminShell.test.js src/features/attendance/todayAttendanceAppIntegration.test.js
```

Expected: FAIL because shell and App still use local menu/filter logic.

- [ ] **Step 3: Wire the centralized guard**

Delete `desktopMenuItems` from `DesktopAdminShell.jsx`; call `getVisibleAdminRoutes(currentUser)`. In `AuthenticatedApp` compute:

```js
const authorizedView = canAccessView(currentUser, currentView) ? currentView : 'home'
```

Use `authorizedView` for every route branch and bridge target calculation. In `handlePersonnelAwareNavigate`, reject a next view before changing state when `canAccessView` is false, while retaining the personnel unsaved-change block. Add an effect that normalizes a stale unauthorized view back to Home. Replace the bad project-finance edit check with `canUpdateProjectFinancials(currentUser)`.

- [ ] **Step 4: Run route and shell regression tests**

```bash
node --test src/navigation/adminRoutes.test.js src/auth/businessAccess.test.js src/auth/businessAccessIntegration.test.js src/desktopAdminShell.test.js src/features/attendance/todayAttendanceAppIntegration.test.js src/features/projects/projectPermissions.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit guarded navigation**

```bash
git add src/DesktopAdminShell.jsx src/App.jsx src/desktopAdminShell.test.js src/auth/businessAccessIntegration.test.js src/features/attendance/todayAttendanceAppIntegration.test.js
git commit -m "fix: enforce admin route permissions"
```

---

### Task 7: 会计、采购动作权限与逐源加载状态

**Files:**
- Modify: `src/App.jsx` (`usePersistentState`, persistent-state callers, Accounting and Purchase pages)
- Modify: `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- Modify: `src/services/persistenceSecurityContract.test.js`
- Modify: `src/services/purchaseService.js`
- Create: `src/services/purchaseService.test.js`
- Create: `supabase/migrations/202607160002_purchase_accrual_access.sql`
- Create: `supabase/tests/purchase_accrual_access.sql`
- Modify: `src/features/purchase-accounting/purchaseAccountingDomain.js`
- Modify: `src/features/purchase-accounting/purchaseAccountingDomain.test.js`
- Modify: `src/features/purchase-accounting/purchaseAccountingSection.test.js`
- Modify: `src/features/labor-accounting/laborAccountingAppIntegration.test.js`
- Modify: `src/auth/businessAccessIntegration.test.js`

**Interfaces:**
- Consumes: Task 1 source-state functions and Task 5 access projections.
- `usePersistentState` adds `readAllowed`, `onFatalError`, and `onWriteError` to its current option fields and still returns `[data, setter, rawCloudState]`; existing migration/storage/service options retain their present names and behavior.
- `rawCloudState` is always `{ loading, error, code, source, updatedAt }` and never contains a normalized `status`. `AuthenticatedApp` calls `toBusinessSourceState` exactly once per raw persistent/Promise source. Labor loader results are first adapted to that raw shape, then projected once; no normalized source state is fed back through the converter.
- Accounting/Purchase receive access objects and never render an unauthorized tab, form, action, amount, or aggregate.
- `purchaseService` uses `list_purchase_records_secure`, `upsert_purchase_record_secure`, and `soft_delete_purchase_record_secure` for purchase records; payment rows continue through their existing sensitive table path.
- `buildPurchaseAccountingReadModel` accepts `paymentState`; when it is forbidden/loading/error, accrual rows remain usable but payable/payment totals and payment-derived anomalies return the same blocked state and are never inferred from redacted purchase payloads.

- [ ] **Step 1: Write failing security and source-state integration tests**

Cover these exact cases:

- `readAllowed:false` performs no cloud read and returns raw `{ loading:false, error:'无权读取该数据', code:'ACCESS_DENIED', source:'blocked', updatedAt:null }`; the single App projection produces `forbidden`.
- `ACCESS_DENIED` clears local compatibility data but does not become a fake empty ready source.
- session/config failures remain fatal; write failures remain globally fail-closed.
- Accounting defaults to the first authorized section, hides salary without `salary_view`, and hides a total when a hidden category could be inferred.
- Purchase create/update/delete/payment buttons follow their action and sensitive permissions.
- A user with `module.purchases.view` but no payment-sensitive permission receives active purchase accrual fields and never receives `openingPaidAmount`, `paidAmount`, `unpaidAmount`, or `paymentStatus`; a user lacking the purchase module gets SQLSTATE `42501` and no rows.
- A non-payment-sensitive purchase update preserves server-side payment fields and cannot overwrite them, while an authorized payment editor can update them.
- The purchase read model given `paymentState: { status: 'forbidden', data: null }` still returns July purchase accrual `80000`, but its current payable/month payment/payment health blocks are forbidden with `data: null` and no `legacy_opening_payment` anomaly.
- Dashboard source objects retain loading/error/forbidden instead of bare arrays.
- Persistent, Promise, and labor-loader adapters each have a test proving one raw-to-standard projection and no `forbidden/error` to `ready` upgrade.
- Forbidden labor/salary/project-cost access never calls the bridge loader; actor or effective-permission changes abort in-flight loads and clear the previous actor-scope cache.

- [ ] **Step 2: Run the focused security tests and verify RED**

```bash
node --test src/auth/businessAccessIntegration.test.js src/services/persistenceSecurityContract.test.js src/services/purchaseService.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js
```

Expected: at least one failure for every case above.

- [ ] **Step 3: Implement fail-closed reads and component-level access**

Before each persistent read, calculate the matching access projection and pass `readAllowed`. Preserve the third state from every dashboard dependency. For project and contract-revenue Promise loads, add explicit `{ loading, error, source }` state rather than using `[]` for every outcome.

The migration adds security-definer RPCs without changing table RLS. `list_purchase_records_secure()` checks `is_current_employee_active()` and `module.purchases.view`; it returns the standard record envelope but removes `openingPaidAmount`, `paidAmount`, `unpaidAmount`, and `paymentStatus` from `payload` unless `sensitive.purchase_payments_view` is present. `upsert_purchase_record_secure(record_key, payload, status)` accepts only `status = 'active'`, distinguishes insert/update server-side, and checks the corresponding module action permission; without `sensitive.purchase_payments_update`, it strips those four incoming keys and merges the existing server values back so a normal purchase edit cannot erase or alter payment facts. `soft_delete_purchase_record_secure(record_key)` is the only deleted-state path and requires `module.purchases.delete`. Revoke execution from `public/anon`, grant only `authenticated/service_role`, pin `search_path`, validate JSON object/record key/status, reject client audit fields, and test inactive account, missing module, read redaction, mutation preservation, payment-authorized mutation, upsert-delete bypass, soft delete, and direct-table RLS remaining unchanged.

In App, replace the generic purchase-record persistence path with `purchaseService`; keep the same explicit source-state contract and optimistic UI rollback. Do not call the payment-record loader without sensitive payment-view access. Pass its source state to the purchase read model. Purchase forms render accrual fields from sanitized records; payment/opening-paid controls are omitted unless payment update access is true. A redacted record must never trigger legacy-opening estimates or a fake “全部未付” total.

Accounting section access shape:

```js
{
  salary: { view, create, update, delete },
  projectCost: { view, create, update, delete },
  operatingExpense: { view, create, update, delete },
  purchaseAccounting: { view },
  monthlySummary: {
    salary, projectCost, operatingExpense, purchaseAccrual, purchasePayments,
  },
}
```

Purchase section access shape:

```js
{
  records: { view, create, update, delete },
  payments: { view, create, update, delete },
  stockIn: { view, create, update, delete },
  summary: { view },
}
```

Map each boolean from the existing permission helpers, never from UI labels. In particular: salary amount view requires `module.salaries.view + sensitive.salary_view`; labor amount view additionally requires `module.project_costs.view`; purchase accrual records require `module.purchases.view`, while payment/current-payable fields require `sensitive.purchase_payments_view` and payment mutations require `sensitive.purchase_payments_update`; project financial mutations require `canUpdateProjectFinancials`. When a monthly total contains any hidden category, return `{ status: 'forbidden', data: null }` for that total instead of subtracting or publishing a partial number.

If no Accounting/Purchase section is authorized, render a neutral “当前账号无可用功能” state. Do not alter RLS.

- [ ] **Step 4: Run the verified 72-test security baseline plus new tests**

```bash
node --test src/auth/businessAccess.test.js src/auth/businessAccessIntegration.test.js src/services/businessSourceState.test.js src/auth/employeeAuthDomain.test.js src/desktopAdminShell.test.js src/features/projects/projectPermissions.test.js src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/services/baseRecordService.test.js src/services/purchaseService.test.js src/services/dashboardService.test.js src/services/persistenceSecurityContract.test.js
DB_WORKDIR="$(mktemp -d /private/tmp/kaobeierp-dashboard-db.XXXXXX)"
mkdir -p "$DB_WORKDIR/supabase"
rsync -a --exclude 'migrations/202607150002_project_documents.sql' --exclude 'tests/project_documents.sql' supabase/ "$DB_WORKDIR/supabase/"
perl -0pi -e 's/project_id = "shengwang-erp"/project_id = "shengwang-dashboard-test-20260716"/; s/port = 54321/port = 55321/; s/port = 54322/port = 55322/; s/shadow_port = 54320/shadow_port = 55320/' "$DB_WORKDIR/supabase/config.toml"
npx supabase start --workdir "$DB_WORKDIR"
npx supabase db reset --local --workdir "$DB_WORKDIR"
npx supabase test db "$DB_WORKDIR/supabase/tests/purchase_accrual_access.sql" --local --workdir "$DB_WORKDIR"
npx supabase stop --no-backup --workdir "$DB_WORKDIR"
```

Expected: Node tests and focused pgTAP PASS; no persistence read occurs for forbidden sources, and the copied temporary project proves sanitized purchase reads cannot expose payment fields. Do not copy, run, modify, or stage the protected untracked project-document migration/test excluded above.

- [ ] **Step 5: Commit UI permission and state wiring**

```bash
git add src/App.jsx src/features/purchase-accounting/PurchaseAccountingSection.jsx src/services/persistenceSecurityContract.test.js src/services/purchaseService.js src/services/purchaseService.test.js supabase/migrations/202607160002_purchase_accrual_access.sql supabase/tests/purchase_accrual_access.sql src/features/purchase-accounting/purchaseAccountingDomain.js src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/auth/businessAccessIntegration.test.js
git commit -m "fix: guard financial UI and source loading"
```

---

### Task 8: 老板驾驶舱统一读模型

**Files:**
- Create: `src/features/executive-dashboard/executiveDashboardDomain.js`
- Create: `src/features/executive-dashboard/executiveDashboardDomain.test.js`

**Interfaces:**
- Consumes: `buildMonthWindow`, source states, `buildPurchaseAccountingReadModel`, `buildCostAccountingReadModel`, `buildRecordedCashFlow`, contract-revenue snapshots, and access projection.
- Produces: `buildExecutiveDashboardReadModel({ asOfDate, selectedMonth, filters, access, sources })`.
- Output blocks: `meta`, `kpis`, `revenue`, `projectStatus`, `cashFlow`, `costs`, `alerts`, `purchaseOperations`, `laborOperations`, `vehicleOperations`, `inventoryOperations`, `toolOperations`, `projectRanking`, `projectRows`, `sourceIssues`.
- `filters` is `{ projectId, projectStatus, rankingMetric, page, pageSize }`; `rankingMetric` is `profit | margin | revenue | confirmedCost`, project status is `all` or one of the seven lifecycle statuses, and invalid filter/page values normalize to safe defaults. `sources` contains separate standard source states for `projects`, `contractRevenue`, `receipts`, `laborWindow`, `purchaseAccrual`, `purchasePayments`, `projectCosts`, `operatingExpenses`, `vehicles`, `vehicleUsage`, `fuel`, `vehicleExpenses`, `vehicleIssues`, `attendance`, `inventoryItems`, `stockInRecords`, `stockOutRecords`, `stockReturnRecords`, `toolRecords`, `toolBorrowRecords`, `toolReturnRecords`, `lifelongToolAssignments`, and `toolResponsibilityRecords`. Composite names like bare `purchases`, `inventory`, or `tools` are not accepted because their sub-sources have different permissions/failure states.

Required-source groups are fixed so a failed unrelated source does not blank the page:

| Block | Required sources |
| --- | --- |
| project count/status | `projects` |
| contract/received/outstanding | `projects`, `contractRevenue` |
| profit/ranking/project financial rows | contract group plus current labor lifetime, `purchaseAccrual`, project costs, operating expenses, fuel/vehicle expense/issue |
| 12-month cash | `receipts`, `purchasePayments` when authorized, fuel, vehicle expenses |
| cost composition | labor window, `purchaseAccrual`, project costs, operating expenses, fuel, vehicle expenses, vehicle issues |
| attendance/labor operations | attendance and labor window respectively |
| purchase occurrence | `purchaseAccrual`; payment/payable/health adds `purchasePayments` without blocking occurrence cost |
| vehicle operations | vehicles, vehicle usage, fuel, vehicle expenses, vehicle issues |
| inventory operations | inventory items and stock in/out/return states |
| tool operations | tool master, borrow, return, lifelong assignment and responsibility states |

Any required source not visible to the user blocks only the amount/aggregate that would otherwise reveal it; independent permitted blocks remain renderable.

- [ ] **Step 1: Write the failing dashboard truth-table tests**

Use fixtures with two projects, active/void receipts, tax-inclusive contract totals, different `profitAnchorTaxExclusiveAmount`, 12 months of costs/cash, current purchase outstanding, all seven project lifecycle statuses, and one forbidden source. Assert:

- KPI contract/received/outstanding use tax-inclusive values.
- Profit and margin use only the tax-exclusive anchor.
- Legacy compatibility projects carry `历史税额未拆分`; missing anchors carry `待完成合同收入确认` and do not become zero-profit ranking rows.
- Month selection changes 12-month trend and monthly operations but not current snapshot KPI/ranking.
- Selecting a historical month still uses `laborWindow.projectLaborLifetimeById` from the separately loaded current `snapshotMonth`; a failed current labor snapshot blocks cumulative cost/profit/ranking without blocking historical monthly operations.
- Project status buckets are mutually exclusive and contain no payment status.
- Current purchase outstanding/health ignore month selection.
- A required source error/forbidden produces a blocked block, not a partial total.
- Project rows include confirmed and pending-manual cost separately.
- Attendance status/abnormal count, labor fee/pending confirmation, purchase accrual/payment/current payable/health, vehicle fee/use/issue, inventory status, and tool-borrow status each apply their own month/project/snapshot rule; a forbidden tool source does not block inventory and vice versa.
- Alerts use `{ id, type, severity, title, reason, count, amount, targetView, canNavigate, recordRef }`; permission filtering removes sensitive `amount/recordRef` and target links before output, rather than hiding them in CSS.
- With each sensitive permission removed in turn, contract/profit/salary/payment fields and all totals that could reveal them by subtraction become `{ status: 'forbidden', data: null }`; non-sensitive project-count/status cards remain available.

The test must also assert five KPI scope labels (`当前有效项目`, `当前含税合同额`, `当前累计含税收款`, `当前含税未收`, `当前累计税抜预计利润`), that only month-fact blocks compare with the prior month, and that an all-zero prior month does not render a percentage change.
When one selected project has a valid profit anchor and another lacks one, the aggregate profit KPI is `status: 'error'` with an incomplete-income message and does not publish a partial sum; the valid row may still show its project profit. Cost total/profit/ranking are likewise blocked whenever an authorized viewer lacks any contributing cost category needed for a complete total.

- [ ] **Step 2: Run the domain test and verify RED**

```bash
node --test src/features/executive-dashboard/executiveDashboardDomain.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement the read model without UI calculations**

The read model must perform all filtering and aggregation. React components may only format returned values. Normalize the selected month and derive its 12-month window once. Use `resolveRequiredSources` per block; remove unauthorized source data before calling cost/cash domains. Current project/status/contract/receipt/outstanding/profit and current purchase health/payable ignore month filtering but respect project filtering. Attendance, labor, purchase occurrence/payment, vehicle and operational exceptions use the selected natural month. Sort project ranking deterministically by selected metric descending, then project name, and paginate project rows after project/status filtering.

`meta` is `{ asOfDate, selectedMonth, windowStartMonth, windowEndMonth, projectScopeLabel, monthScopeLabel }`; validate `asOfDate` as an ISO calendar date so tests and UI never depend on ambient `new Date()` calls.

Return each block as:

```js
{
  status: 'ready' | 'loading' | 'error' | 'forbidden',
  stale: boolean,
  data: null | object | array,
  code: '',
  message: '',
  requiredSources: [],
  updatedAt: null | string,
}
```

`alerts` is built from attendance exceptions, pending labor records, purchase read-model anomalies/current payable, unbound project facts, vehicle issues, pending manual costs, missing profit anchors, and source issues. Each alert is projected through access before it enters the output; unauthorized targets set `canNavigate: false`, and unauthorized amounts/identities are omitted. `sourceIssues` contains only metadata `{ source, status, stale, message }`; it never copies forbidden records. Profit rows with no valid `profitAnchorTaxExclusiveAmount` carry `profitStatus: 'missing_anchor'`; legacy-compatible anchors carry `profitStatus: 'legacy_compatibility'`. Over-receipts clamp outstanding to zero and add a health issue with the excess amount.

- [ ] **Step 4: Run dashboard plus accounting domain tests**

```bash
node --test src/features/executive-dashboard/executiveDashboardDomain.test.js src/features/cost-accounting/costAccountingDomain.test.js src/features/cost-accounting/recordedCashFlowDomain.test.js src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/contract-revenue/contractRevenueCalculations.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the dashboard domain**

```bash
git add src/features/executive-dashboard/executiveDashboardDomain.js src/features/executive-dashboard/executiveDashboardDomain.test.js
git commit -m "feat: build executive dashboard read model"
```

---

### Task 9: 原生 SVG 图表与驾驶舱页面

**Files:**
- Create: `src/features/executive-dashboard/ExecutiveCharts.jsx`
- Create: `src/features/executive-dashboard/ExecutiveDashboardPage.jsx`
- Create: `src/features/executive-dashboard/executiveDashboard.css`
- Create: `src/features/executive-dashboard/executiveDashboardPage.test.js`
- Modify: `src/dashboardLayout.test.js`

**Interfaces:**
- Produces: `DonutChart`, `BarChart`, `LineChart`, `HorizontalBarChart`.
- Produces: `ExecutiveDashboardPage({ model, filters, viewerName, onFiltersChange, onNavigate })`.
- Consumes only the Task 8 read model; no component reads raw business arrays.
- `executiveDashboard.css` contains layout/component selectors only, every selector is rooted at `.erp-black-gold`, and `ExecutiveDashboardPage.jsx` imports it directly. Theme color values come from `src/blackGoldTheme.css` variables.

- [ ] **Step 1: Write failing Vite SSR component tests**

Load JSX with a middleware-mode Vite server and render using `react-dom/server`. Assert:

- every chart SVG has `role="img"`, an accessible label, `<title>`, text legend, and a stable empty state;
- the page renders five KPI cards, project/month filters, collection donut, lifecycle bar chart, 12-month cash line, cost composition, profitability ranking, authorized alerts, and project table;
- the header renders `欢迎回来，{viewerName}`, the `meta.asOfDate`, project scope, selected natural month, and 12-month window without implying historical KPI snapshots;
- `loading/error/forbidden` blocks render distinct messages and `ready + stale` renders data with an explicit “数据可能已过期” notice;
- missing-profit rows display status text rather than `¥0`;
- the table includes `待核对手工成本` and uses a scroll wrapper.

- [ ] **Step 2: Run the component test and verify RED**

```bash
node --test src/features/executive-dashboard/executiveDashboardPage.test.js
```

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement charts and the responsive 12-column page**

Use shared single-value chart props for donut/bar/horizontal ranking:

```js
{
  title: string,
  description: string,
  data: Array<{ key: string, label: string, value: number, color?: string }>,
  valueFormatter: (value: number) => string,
}
```

`LineChart` uses a separate interface:

```js
{
  title: string,
  description: string,
  points: Array<{ month: string, income: number, outflow: number, net: number }>,
  series: Array<{ key: 'income' | 'outflow' | 'net', label: string, color: string }>,
  valueFormatter: (value: number) => string,
}
```

Clamp SVG geometry, handle all-zero ranges, place `<title>` inside focusable points/bars, and render the same values in a textual legend. Use CSS grid areas for desktop, two columns for 768–1023, and one column below 768. Do not hard-code colors outside theme variables. Extend `blackGoldTheme.test.js` or the page test to parse `executiveDashboard.css` and reject any unscoped selector.

- [ ] **Step 4: Run page, domain, and layout tests**

```bash
node --test src/features/executive-dashboard/executiveDashboardPage.test.js src/features/executive-dashboard/executiveDashboardDomain.test.js src/dashboardLayout.test.js
```

Expected: all tests PASS after `dashboardLayout.test.js` is updated to inspect the new page/CSS paths.

- [ ] **Step 5: Commit charts and page**

```bash
git add src/features/executive-dashboard/ExecutiveCharts.jsx src/features/executive-dashboard/ExecutiveDashboardPage.jsx src/features/executive-dashboard/executiveDashboard.css src/features/executive-dashboard/executiveDashboardPage.test.js src/dashboardLayout.test.js
git commit -m "feat: add black gold executive dashboard charts"
```

---

### Task 10: App、会计汇总与驾驶舱接线

**Files:**
- Modify: `src/App.jsx`
- Modify: `src/features/purchase-accounting/PurchaseAccountingSection.jsx`
- Modify: `src/features/purchase-accounting/purchaseAccountingSection.test.js`
- Modify: `src/features/labor-accounting/laborAccountingAppIntegration.test.js`
- Modify: `src/features/contract-revenue/appRevenueIntegration.test.js`
- Create: `src/features/executive-dashboard/executiveDashboardAppIntegration.test.js`
- Create: `src/features/cost-accounting/costAccountingAppIntegration.test.js`

**Interfaces:**
- Consumes all Tasks 1–9.
- `DashboardPage` remains a thin local wrapper for compatibility tests, but delegates to `ExecutiveDashboardPage`.
- `MonthlySummarySection` consumes `buildCostAccountingReadModel`; it no longer owns a duplicate cost formula.
- `AuthenticatedApp` owns `{ selectedMonth, projectId, projectStatus, rankingMetric, page, pageSize }` because the selected month drives the 12-month labor request before page render.

- [ ] **Step 1: Write failing cross-page integration tests**

Assert the Dashboard route passes the exact named source-state map from Task 8, including separate `purchaseAccrual/purchasePayments`, vehicle master/usage/cost sources, inventory movement sources, tool borrow/return/assignment sources, `projectReceipts`, operating expenses, raw cash provenance, labor window, and access. Render the wrapper with July purchase/August payment and verify Dashboard and Monthly Summary use the same purchase/cost totals. In `costAccountingAppIntegration.test.js`, assert all dashboard/project financial projections consume shared project rows, manual labor/material/tool/vehicle and `repairCost` remain pending, and the App no longer contains/uses `getProjectCostTotal`, `getProjectVehicleCostTotal`, `getVehicleCostTotal`, or `getGrossProfitInfo`. Assert no dashboard/project profit path subtracts cost from `adjustedTaxInclusiveAmount`.

- [ ] **Step 2: Run integration tests and verify RED**

```bash
node --test src/features/executive-dashboard/executiveDashboardAppIntegration.test.js src/features/cost-accounting/costAccountingAppIntegration.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/contract-revenue/appRevenueIntegration.test.js
```

Expected: FAIL because App still renders the legacy dashboard and Monthly Summary owns old calculations.

- [ ] **Step 3: Wire source states, labor loader, shared domains, and page navigation**

In `AuthenticatedApp`:

- preserve every `usePersistentState` third return;
- adapt persistent/Promise/labor results to the raw cloud contract and project each source exactly once through `toBusinessSourceState` using `getDashboardAccess`;
- load the selected 12-month labor window plus the actual current-month cumulative snapshot with abort/actor-scope/identity protection; clear the prior actor cache on logout or permission/profile change;
- pass `projectReceipts` and cash-provenance-aware rows;
- keep fatal auth/config failures global and optional source errors local;
- pass `onNavigate` so alerts open only authorized pages.
- initialize the dashboard query to the current month, `projectId/projectStatus = 'all'`, `rankingMetric = 'profit'`, `page = 1`, and `pageSize = 10`; validate every update and reset `page` to 1 when month/project/status/ranking changes.
- pass a validated `todayValue()` as `asOfDate` and `currentUser.name` as `viewerName`; no chart/domain component reads the wall clock itself.

Derive `actorScope` from the authenticated employee ID plus a stable sorted hash/string of `effectivePermissionKeys` (and the configured tenant/project identifier if one exists). Never use employee display name. Abort the previous request and call `loader.clear(previousActorScope)` before loading under a changed scope.

Replace the legacy Dashboard body with:

```jsx
function DashboardPage({ asOfDate, selectedMonth, filters, access, sources, viewerName, onFiltersChange, onNavigate }) {
  const model = buildExecutiveDashboardReadModel({
    asOfDate,
    selectedMonth,
    filters,
    access,
    sources,
  })
  return (
    <ExecutiveDashboardPage
      model={model}
      filters={{ selectedMonth, ...filters }}
      viewerName={viewerName}
      onFiltersChange={onFiltersChange}
      onNavigate={onNavigate}
    />
  )
}
```

Move `MonthlySummarySection` totals to the shared cost model. Display pending manual costs and repair estimates separately. Build the dashboard project-table rows from the same `projectLifetimeById` map used by accounting; navigation to the existing Project page keeps the authoritative contract snapshot, while no separate cost/profit formula survives there or in App. Remove the four duplicate helpers named in Step 1 after tests prove no caller remains. Do not edit the pre-existing untracked `src/features/projects/ProjectPage.jsx` in this task.

- [ ] **Step 4: Run all dashboard/accounting integration tests**

```bash
node --test src/features/executive-dashboard/executiveDashboardAppIntegration.test.js src/features/cost-accounting/costAccountingAppIntegration.test.js src/features/executive-dashboard/executiveDashboardPage.test.js src/features/executive-dashboard/executiveDashboardDomain.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/services/dashboardService.test.js
```

Expected: all tests PASS.

- [ ] **Step 5: Commit the application wiring**

```bash
git add src/App.jsx src/features/purchase-accounting/PurchaseAccountingSection.jsx src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/features/executive-dashboard/executiveDashboardAppIntegration.test.js src/features/cost-accounting/costAccountingAppIntegration.test.js
git commit -m "feat: wire shared accounting into dashboard"
```

---

### Task 11: 移动工作台、消息、我的与统一黑金主题

**Files:**
- Create: `src/blackGoldTheme.css`
- Create: `src/blackGoldTheme.test.js`
- Create: `src/navigation/MobileBottomNavigation.jsx`
- Create: `src/navigation/mobileBottomNavigation.test.js`
- Create: `src/features/workbench/workbenchModel.js`
- Create: `src/features/workbench/workbenchModel.test.js`
- Create: `src/features/workbench/authorizedHomeModel.js`
- Create: `src/features/workbench/authorizedHomeModel.test.js`
- Create: `src/features/workbench/MobileWorkbenchPage.jsx`
- Create: `src/features/workbench/MobileMessagesPage.jsx`
- Create: `src/features/workbench/MobileProfilePage.jsx`
- Modify: `src/main.jsx`
- Modify: `src/DesktopAdminShell.jsx`
- Modify: `src/App.jsx` (`HomePage` module source and mobile-only branches)
- Modify: `src/desktopAdminShell.test.js`
- Modify: `src/features/attendance/todayAttendanceAppIntegration.test.js`

**Interfaces:**
- Consumes: Task 5 routes/access and Task 8 authorized alerts.
- Produces: fixed mobile bottom navigation for `home`, `workbench`, `messages`, `profile`.
- Produces: `buildWorkbenchItems({ user, counts })` and `buildAuthorizedMessages({ access, alerts })`.
- Produces: `buildAuthorizedHomeModel({ user, routes, sourceStates })`; Home receives this projected model and never receives unfiltered raw business arrays.
- Workbench items are `{ view, label, iconText, badgeCount }`; messages are `{ id, severity, title, summary, count, amount, targetView, canNavigate }`. Both builders discard unauthorized items before calculating visible badge totals.

- [ ] **Step 1: Write failing navigation, workbench, and theme-contract tests**

Tests must assert:

- four bottom tabs with `aria-current`, safe-area padding, and no unauthorized badge counts;
- workbench shows only real authorized routes and never creates a dead “仓库库存” route;
- Home computes counts/amounts only from authorized `ready` sources, displays source state for authorized failures, and never calculates hidden project, purchase, cost, inventory, or employee aggregates;
- messages remove unauthorized content before rendering;
- profile shows current employee name/department/position, permission-visible module range, and logout;
- `main.jsx` imports `styles.css` first and `blackGoldTheme.css` second;
- every theme selector is scoped by `.erp-black-gold` and exact tokens/breakpoints exist;
- no login/auth selector is present in the theme file.

Add a source-contract assertion that `HomePage`, `MobileWorkbenchPage`, `MobileMessagesPage`, `MobileBottomNavigation`, and `DesktopAdminShell` all import route/access metadata rather than declaring module-name arrays locally. Use SSR fixtures for an ordinary employee, a finance employee, and SW-000 so badge counts and message amounts cannot leak across permission boundaries.

- [ ] **Step 2: Run tests and verify RED**

```bash
node --test src/navigation/mobileBottomNavigation.test.js src/features/workbench/workbenchModel.test.js src/features/workbench/authorizedHomeModel.test.js src/blackGoldTheme.test.js src/desktopAdminShell.test.js
```

Expected: FAIL with missing files and markup.

- [ ] **Step 3: Implement mobile pages and extract the shared workbench model**

Add `workbench`, `messages`, and `profile` render branches in `AuthenticatedApp`. Reuse route metadata and access policy; do not duplicate module permission names in `HomePage`. Build the Home model before render from per-source states and access; remove raw projects/purchases/costs/employee arrays from `HomePage` props. `MobileMessagesPage` receives already-authorized message objects and checks target view again before rendering a button.

Mount `MobileBottomNavigation` inside `DesktopAdminShell`. Set the root class exactly to:

```jsx
<div className="erp-black-gold desktop-admin-layout">
```

Move the labor badge's inline colors to `.desktop-admin-alert-badge` and `.is-stale`, while preserving `data-labor-alert-badge` and accessible labels.

- [ ] **Step 4: Create the scoped theme after all existing styles**

Add to `main.jsx`:

```js
import './styles.css'
import './blackGoldTheme.css'
```

In `blackGoldTheme.css`, define the exact Global Constraints tokens on `.erp-black-gold`. Explicitly cover:

- desktop frame classes (`desktop-admin-*`);
- Home/workbench classes (`top-panel`, `summary-*`, `module-*`);
- all shared business containers (`page-*`, `form-*`, `field`, `filter-panel`, `stats-grid`, `stat-card`, `record-*`, `payment-table*`, `empty-state`);
- buttons, inputs, selects, textareas, focus-visible, disabled, danger/warning/success statuses;
- existing project, personnel, labor-accounting, attendance, contract-revenue, purchase, vehicle, inventory, and tool page root classes through scoped overrides;
- fixed mobile bottom bar and content bottom padding below 768px;
- forced override of the old 901px desktop rule so 901–1023px remains compact without a fixed sidebar;
- reduced-motion behavior.

Do not add a single unscoped `body`, `html`, `button`, `input`, `.login-*`, or `.auth-*` rule.

- [ ] **Step 5: Run mobile/theme/shell regressions**

```bash
node --test src/navigation/adminRoutes.test.js src/navigation/mobileBottomNavigation.test.js src/features/workbench/workbenchModel.test.js src/features/workbench/authorizedHomeModel.test.js src/blackGoldTheme.test.js src/desktopAdminShell.test.js src/features/attendance/todayAttendanceAppIntegration.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/features/contract-revenue/contractRevenueLayout.test.js src/auth/frontendAuthContract.test.js
```

Expected: all tests PASS; `src/styles.css` remains byte-for-byte untouched by this task.

- [ ] **Step 6: Commit mobile navigation and theme**

```bash
git add src/blackGoldTheme.css src/blackGoldTheme.test.js src/navigation/MobileBottomNavigation.jsx src/navigation/mobileBottomNavigation.test.js src/features/workbench/workbenchModel.js src/features/workbench/workbenchModel.test.js src/features/workbench/authorizedHomeModel.js src/features/workbench/authorizedHomeModel.test.js src/features/workbench/MobileWorkbenchPage.jsx src/features/workbench/MobileMessagesPage.jsx src/features/workbench/MobileProfilePage.jsx src/main.jsx src/DesktopAdminShell.jsx src/App.jsx src/desktopAdminShell.test.js src/features/attendance/todayAttendanceAppIntegration.test.js
git commit -m "feat: unify ERP with black gold responsive shell"
```

---

### Task 12: 全量回归、浏览器验收与独立代码复审

**Files:**
- Modify only if a test or browser defect requires a scoped fix; never stage unrelated dirty files.

**Interfaces:**
- Consumes the complete feature.
- Produces verified desktop/mobile behavior and an evidence-backed handoff.

- [ ] **Step 1: Run the complete focused feature suite**

```bash
node --test src/features/executive-dashboard/dashboardTime.test.js src/services/businessSourceState.test.js src/features/cost-accounting/cashFactProvenance.test.js src/services/dashboardLaborBridgeService.test.js src/features/cost-accounting/laborCostWindow.test.js src/features/cost-accounting/costAccountingDomain.test.js src/features/cost-accounting/recordedCashFlowDomain.test.js src/features/cost-accounting/costAccountingAppIntegration.test.js src/navigation/adminRoutes.test.js src/auth/businessAccess.test.js src/auth/businessAccessIntegration.test.js src/features/executive-dashboard/executiveDashboardDomain.test.js src/features/executive-dashboard/executiveDashboardPage.test.js src/features/executive-dashboard/executiveDashboardAppIntegration.test.js src/navigation/mobileBottomNavigation.test.js src/features/workbench/workbenchModel.test.js src/features/workbench/authorizedHomeModel.test.js src/blackGoldTheme.test.js src/desktopAdminShell.test.js src/dashboardLayout.test.js src/features/purchase-accounting/purchaseAccountingDomain.test.js src/features/purchase-accounting/purchaseAccountingSection.test.js src/features/labor-accounting/laborAccountingBridge.test.js src/features/labor-accounting/laborAccountingAppIntegration.test.js src/features/contract-revenue/contractRevenueCalculations.test.js src/features/contract-revenue/appRevenueIntegration.test.js src/services/purchaseService.test.js src/services/persistenceSecurityContract.test.js
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run full tests, build, and whitespace validation**

```bash
npm test
npm run build
DB_WORKDIR="$(mktemp -d /private/tmp/kaobeierp-dashboard-final-db.XXXXXX)"
mkdir -p "$DB_WORKDIR/supabase"
rsync -a --exclude 'migrations/202607150002_project_documents.sql' --exclude 'tests/project_documents.sql' supabase/ "$DB_WORKDIR/supabase/"
perl -0pi -e 's/project_id = "shengwang-erp"/project_id = "shengwang-dashboard-final-20260716"/; s/port = 54321/port = 56321/; s/port = 54322/port = 56322/; s/shadow_port = 54320/shadow_port = 56320/' "$DB_WORKDIR/supabase/config.toml"
npx supabase start --workdir "$DB_WORKDIR"
npx supabase db reset --local --workdir "$DB_WORKDIR"
npx supabase test db "$DB_WORKDIR/supabase/tests/purchase_accrual_access.sql" --local --workdir "$DB_WORKDIR"
npx supabase stop --no-backup --workdir "$DB_WORKDIR"
git diff --check
```

Expected: full tests, build, isolated purchase pgTAP, and diff check PASS; any full-suite failure must be compared with the pre-existing dirty-worktree baseline and no new failure is accepted. The excluded protected project-document files remain untouched.

- [ ] **Step 3: Use the browser-control skill for fixed viewport QA**

Read `browser:control-in-app-browser` before browser actions. Open `http://127.0.0.1:4177/` and verify:

- `1440×900`: fixed sidebar/topbar, five KPI cards, donut/bar/line/ranking charts, alerts, scrollable project table, Accounting/Purchase amounts consistent.
- `1024×768`: compact layout wraps without the old 901px sidebar collision.
- `390×844`: bottom tabs, workbench grid, authorized messages, profile/logout, stacked dashboard charts, horizontal table scroll, safe-area spacing.
- Login page remains unchanged outside `.erp-black-gold`.
- Home, Dashboard, Projects, Personnel, Accounting, Labor, Stock Out/Return, Purchase, Vehicle, Tools, Attendance, and Settings all use the same black/gold surfaces with readable forms.
- Browser console has no new error or critical warning.

- [ ] **Step 4: Reconcile real local amounts**

For one project and one selected month, compare Dashboard, Accounting Monthly Summary, Purchase Reconciliation, and project detail values for contract, received, outstanding, purchase accrual, recorded purchase payment, current payable, labor, confirmed total cost, pending manual cost, and estimated profit. Every shared value must match its authority page.

- [ ] **Step 5: Request independent code review and fix all Critical/Important findings**

Read and use `superpowers:requesting-code-review`. Give the reviewer the approved spec, this plan, commit range, protected dirty-file list, and verification output. Repeat review after fixes until Critical `0` and Important `0`.

- [ ] **Step 6: Perform verification-before-completion**

Read and use `superpowers:verification-before-completion`. Re-run the affected focused tests, `npm run build`, `git diff --check`, and inspect `git status --short`. Report exact test counts, build result, browser viewports, known pre-existing failures, and every changed/committed file without claiming untouched user files.

---

## Specification Coverage Map

| Confirmed requirement | Implementation tasks | Acceptance evidence |
| --- | --- | --- |
| Unified scoped black/gold backend; login unchanged | 9, 11 | Theme contract test, desktop/mid/mobile browser QA |
| Responsive desktop shell and four-tab mobile shell | 5, 6, 11 | Route, shell, workbench, message and 390×844 QA |
| Five current-snapshot KPIs and finance-first dashboard | 8, 9, 10 | Domain truth table, SSR page test, 1440×900 QA |
| Native accessible donut/bar/line/ranking charts | 9 | SVG accessibility/empty-state SSR tests |
| Tax-inclusive contract/receipts and tax-exclusive profit | 8, 10 | Revenue/domain integration tests and local amount reconciliation |
| Shared accrual cost model without labor/purchase/vehicle double count | 3, 4, 10 | Cost priority and cross-page equality tests |
| Recorded-cash-only 12-month series and coverage disclosure | 1, 2, 4, 8 | Provenance, cash coverage, July/August timing tests |
| Current purchase payable/health snapshot and accounting linkage | 2, 4, 8, 10 | Purchase read-model and cross-page integration tests |
| Per-source loading/error/forbidden/stale handling | 1, 3, 7, 8, 9 | Source-state, labor failure and blocked-block tests |
| Fail-closed route, amount, action, alert and badge permissions | 5, 6, 7, 8, 11 | Security baseline, route guard, SSR permission fixtures |
| Selected-month operations, 12-month trends and project filtering | 1, 3, 4, 8 | Cross-year window and dashboard filter truth-table tests |
| Real-data reconciliation and no demo data | All; final gate 12 | Full tests/build, browser console, four-page amount comparison |

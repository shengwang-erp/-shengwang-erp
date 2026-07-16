import {
  BarChart,
  DonutChart,
  HorizontalBarChart,
  LineChart,
} from './ExecutiveCharts.jsx'
import { getAdminRoute } from '../../navigation/adminRoutes.js'
import './executiveDashboard.css'

const BLOCK_STATUSES = new Set(['ready', 'loading', 'error', 'forbidden'])
const PROJECT_STATUSES = Object.freeze([
  'all', '报价中', '设计中', '待开工', '进行中', '暂停', '已完工', '已取消',
])
const RANKING_OPTIONS = Object.freeze([
  ['profit', '预计利润'],
  ['margin', '利润率'],
  ['revenue', '含税合同额'],
  ['confirmedCost', '已确认成本'],
])
const KPI_DEFINITIONS = Object.freeze([
  ['activeProjects', '当前有效项目', 'count'],
  ['contractTaxInclusive', '当前含税合同额', 'money'],
  ['receivedTaxInclusive', '当前累计含税收款', 'money'],
  ['outstandingTaxInclusive', '当前含税未收', 'money'],
  ['estimatedProfitTaxExclusive', '当前累计税抜预计利润', 'money'],
])
const KPI_STATUSES = new Set(['ready', 'loading', 'error', 'forbidden'])
const RANKING_METRICS = new Set(RANKING_OPTIONS.map(([key]) => key))
const PROFIT_STATUSES = new Set(['ready', 'legacy_compatibility', 'missing_anchor'])
const MONTH_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])$/u
const PROJECT_STATUS_VALUES = PROJECT_STATUSES.slice(1)
const PROJECT_STATUS_SET = new Set(PROJECT_STATUS_VALUES)
const KPI_KEYS = new Set(KPI_DEFINITIONS.map(([key]) => key))

function ownValue(value, key, fallback = null) {
  try {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
      return fallback
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : fallback
  } catch {
    return fallback
  }
}

function isRecord(value) {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  } catch {
    return false
  }
}

function isArray(value) {
  try {
    return Array.isArray(value)
  } catch {
    return false
  }
}

function isOwnDataRecord(value) {
  try {
    if (!isRecord(value) || Object.getOwnPropertySymbols(value).length !== 0) return false
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Object.getOwnPropertyNames(value).every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
    })
  } catch {
    return false
  }
}

function hasOwnDataFields(value, fields) {
  if (!isOwnDataRecord(value)) return false
  return fields.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value')
  })
}

function isDenseDataArray(value, validator = () => true) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
        Object.getOwnPropertySymbols(value).length !== 0) return false
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
    const length = lengthDescriptor?.value
    if (!Number.isSafeInteger(length) || length < 0) return false
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== length + 1) return false
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (descriptor?.enumerable !== true || !Object.hasOwn(descriptor, 'value') ||
          !validator(descriptor.value, index)) return false
    }
    return true
  } catch {
    return false
  }
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNullableFiniteNumber(value) {
  return value === null || isFiniteNumber(value)
}

function isNonNegativeNumber(value) {
  return isFiniteNumber(value) && value >= 0
}

function isNullableNonNegativeNumber(value) {
  return value === null || isNonNegativeNumber(value)
}

function isNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function isNonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim() === value
}

function isMonth(value) {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

function isNullableDataRecord(value) {
  return value === null || isOwnDataRecord(value)
}

function isRecordArray(value) {
  return isDenseDataArray(value, isOwnDataRecord)
}

function validKpis(data) {
  if (!isDenseDataArray(data) || data.length !== KPI_DEFINITIONS.length) return false
  const seen = new Set()
  for (let index = 0; index < data.length; index += 1) {
    const item = ownValue(data, index)
    if (!hasOwnDataFields(item, ['key', 'label', 'status', 'value', 'comparison', 'message'])) {
      return false
    }
    const key = ownValue(item, 'key')
    const status = ownValue(item, 'status')
    const value = ownValue(item, 'value')
    if (!KPI_KEYS.has(key) || seen.has(key) || !isNonEmptyText(ownValue(item, 'label')) ||
        !KPI_STATUSES.has(status) || typeof ownValue(item, 'message') !== 'string' ||
        !isNullableDataRecord(ownValue(item, 'comparison')) ||
        (status === 'ready' ? !isFiniteNumber(value) : value !== null)) return false
    if (key === 'activeProjects' && !isNonNegativeInteger(value)) return false
    seen.add(key)
  }
  return seen.size === KPI_KEYS.size
}

function validRevenue(data) {
  if (!hasOwnDataFields(data, [
    'contractTaxInclusiveAmount', 'receivedTaxInclusiveAmount',
    'outstandingTaxInclusiveAmount', 'collectionRate', 'comparison', 'issues',
  ])) return false
  return isNonNegativeNumber(ownValue(data, 'contractTaxInclusiveAmount')) &&
    isNonNegativeNumber(ownValue(data, 'receivedTaxInclusiveAmount')) &&
    isNonNegativeNumber(ownValue(data, 'outstandingTaxInclusiveAmount')) &&
    isNullableNonNegativeNumber(ownValue(data, 'collectionRate')) &&
    isNullableDataRecord(ownValue(data, 'comparison')) &&
    isRecordArray(ownValue(data, 'issues'))
}

function validProjectStatus(data) {
  if (!isDenseDataArray(data) || data.length !== PROJECT_STATUS_VALUES.length) return false
  const seen = new Set()
  for (let index = 0; index < data.length; index += 1) {
    const row = ownValue(data, index)
    if (!hasOwnDataFields(row, ['status', 'count'])) return false
    const status = ownValue(row, 'status')
    if (!PROJECT_STATUS_SET.has(status) || seen.has(status) ||
        !isNonNegativeInteger(ownValue(row, 'count'))) return false
    seen.add(status)
  }
  return seen.size === PROJECT_STATUS_SET.size
}

function validCashFlow(data) {
  if (!hasOwnDataFields(data, [
    'series', 'points', 'coverage', 'anomalies', 'componentStatus', 'comparison',
  ])) return false
  const points = ownValue(data, 'points')
  const validPoints = isDenseDataArray(points, (point) =>
    hasOwnDataFields(point, ['month', 'income', 'outflow', 'net']) &&
      isMonth(ownValue(point, 'month')) &&
      isNullableNonNegativeNumber(ownValue(point, 'income')) &&
      isNullableNonNegativeNumber(ownValue(point, 'outflow')) &&
      isNullableFiniteNumber(ownValue(point, 'net')))
  const validSeries = isDenseDataArray(ownValue(data, 'series'), (point) =>
    hasOwnDataFields(point, [
      'month', 'income', 'outflow', 'net', 'purchaseOutflow', 'vehicleOutflow',
    ]) && isMonth(ownValue(point, 'month')) &&
      isNullableNonNegativeNumber(ownValue(point, 'income')) &&
      isNullableNonNegativeNumber(ownValue(point, 'outflow')) &&
      isNullableFiniteNumber(ownValue(point, 'net')) &&
      isNullableNonNegativeNumber(ownValue(point, 'purchaseOutflow')) &&
      isNullableNonNegativeNumber(ownValue(point, 'vehicleOutflow')))
  const validCoverage = isDenseDataArray(ownValue(data, 'coverage'), (row) =>
    hasOwnDataFields(row, ['code', 'label', 'excludedCount', 'note']) &&
      isNonEmptyText(ownValue(row, 'code')) && isNonEmptyText(ownValue(row, 'label')) &&
      isNonNegativeInteger(ownValue(row, 'excludedCount')) &&
      typeof ownValue(row, 'note') === 'string')
  const componentStatus = ownValue(data, 'componentStatus')
  const validComponents = hasOwnDataFields(componentStatus, [
    'income', 'purchaseOutflow', 'vehicleOutflow', 'outflow', 'net',
  ]) && ['income', 'purchaseOutflow', 'vehicleOutflow', 'outflow', 'net']
    .every((key) => KPI_STATUSES.has(ownValue(componentStatus, key)))
  const comparison = ownValue(data, 'comparison')
  const validComparison = hasOwnDataFields(comparison, ['income', 'outflow', 'net']) &&
    ['income', 'outflow', 'net'].every((key) =>
      isNullableDataRecord(ownValue(comparison, key)))
  return validPoints && validSeries && validCoverage &&
    isRecordArray(ownValue(data, 'anomalies')) &&
    validComponents && validComparison
}

function validCosts(data) {
  if (!hasOwnDataFields(data, [
    'month', 'scope', 'labor', 'purchase', 'vehicle', 'manual', 'operating', 'total',
    'incomplete', 'monthlyByMonth', 'pending', 'anomalies', 'comparison',
  ])) return false
  return isMonth(ownValue(data, 'month')) && isNonEmptyText(ownValue(data, 'scope')) &&
    ['labor', 'purchase', 'vehicle', 'manual', 'operating', 'total']
      .every((key) => isNonNegativeNumber(ownValue(data, key))) &&
    ownValue(data, 'incomplete') === false &&
    isOwnDataRecord(ownValue(data, 'monthlyByMonth')) &&
    isOwnDataRecord(ownValue(data, 'pending')) &&
    isRecordArray(ownValue(data, 'anomalies')) &&
    isNullableDataRecord(ownValue(data, 'comparison'))
}

function validRanking(data) {
  return isDenseDataArray(data, (row) => {
    if (!hasOwnDataFields(row, [
      'projectId', 'projectName', 'projectStatus', 'metric', 'value', 'profit',
      'margin', 'revenue', 'confirmedCost',
    ])) return false
    return isNonEmptyText(ownValue(row, 'projectId')) &&
      isNonEmptyText(ownValue(row, 'projectName')) &&
      PROJECT_STATUS_SET.has(ownValue(row, 'projectStatus')) &&
      RANKING_METRICS.has(ownValue(row, 'metric')) &&
      isFiniteNumber(ownValue(row, 'value')) &&
      isNullableFiniteNumber(ownValue(row, 'profit')) &&
      isNullableFiniteNumber(ownValue(row, 'margin')) &&
      isNullableNonNegativeNumber(ownValue(row, 'revenue')) &&
      isNullableNonNegativeNumber(ownValue(row, 'confirmedCost'))
  })
}

function validAlerts(data) {
  return isDenseDataArray(data, (alert) => {
    if (!hasOwnDataFields(alert, [
      'id', 'type', 'severity', 'title', 'reason', 'count', 'amount',
      'targetView', 'canNavigate', 'recordRef',
    ])) return false
    const targetView = ownValue(alert, 'targetView')
    const recordRef = ownValue(alert, 'recordRef')
    return isNonEmptyText(ownValue(alert, 'id')) && isNonEmptyText(ownValue(alert, 'type')) &&
      ['info', 'warning', 'error'].includes(ownValue(alert, 'severity')) &&
      isNonEmptyText(ownValue(alert, 'title')) && isNonEmptyText(ownValue(alert, 'reason')) &&
      isNonNegativeInteger(ownValue(alert, 'count')) &&
      isNullableNonNegativeNumber(ownValue(alert, 'amount')) &&
      (targetView === null || isNonEmptyText(targetView)) &&
      typeof ownValue(alert, 'canNavigate') === 'boolean' &&
      (recordRef === null || isNonEmptyText(recordRef))
  })
}

function validProjectOptionRows(value) {
  const seen = new Set()
  if (!isDenseDataArray(value)) return false
  for (let index = 0; index < value.length; index += 1) {
    const row = ownValue(value, index)
    if (!hasOwnDataFields(row, ['projectId', 'projectName'])) return false
    const projectId = ownValue(row, 'projectId')
    if (!isNonEmptyText(projectId) || seen.has(projectId) ||
        !isNonEmptyText(ownValue(row, 'projectName'))) return false
    seen.add(projectId)
  }
  return true
}

function validProjectRow(row) {
  if (!hasOwnDataFields(row, [
    'projectId', 'projectName', 'projectStatus', 'contractTaxInclusiveAmount',
    'receivedTaxInclusiveAmount', 'outstandingTaxInclusiveAmount', 'confirmedCost',
    'profitAnchorTaxExclusiveAmount', 'pendingManualCost', 'estimatedProfit', 'margin',
    'profitStatus', 'profitStatusLabel',
  ])) return false
  return isNonEmptyText(ownValue(row, 'projectId')) &&
    isNonEmptyText(ownValue(row, 'projectName')) &&
    PROJECT_STATUS_SET.has(ownValue(row, 'projectStatus')) &&
    ['contractTaxInclusiveAmount', 'receivedTaxInclusiveAmount',
      'outstandingTaxInclusiveAmount', 'profitAnchorTaxExclusiveAmount', 'confirmedCost']
      .every((key) => isNullableNonNegativeNumber(ownValue(row, key))) &&
    isNonNegativeNumber(ownValue(row, 'pendingManualCost')) &&
    isNullableFiniteNumber(ownValue(row, 'estimatedProfit')) &&
    isNullableFiniteNumber(ownValue(row, 'margin')) &&
    PROFIT_STATUSES.has(ownValue(row, 'profitStatus')) &&
    typeof ownValue(row, 'profitStatusLabel') === 'string'
}

function validProjectRows(data) {
  if (!hasOwnDataFields(data, [
    'projectOptions', 'items', 'page', 'pageSize', 'totalItems', 'totalPages',
  ])) return false
  const page = ownValue(data, 'page')
  const pageSize = ownValue(data, 'pageSize')
  const totalItems = ownValue(data, 'totalItems')
  const totalPages = ownValue(data, 'totalPages')
  return validProjectOptionRows(ownValue(data, 'projectOptions')) &&
    isDenseDataArray(ownValue(data, 'items'), validProjectRow) &&
    Number.isSafeInteger(page) && page >= 1 &&
    Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100 &&
    isNonNegativeInteger(totalItems) && Number.isSafeInteger(totalPages) && totalPages >= 1 &&
    page <= totalPages
}

function safeText(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function safePositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function formatInteger(value) {
  const safe = safeNumber(value)
  if (safe === null) return '—'
  return Math.round(safe).toLocaleString('ja-JP')
}

function formatYen(value) {
  const safe = safeNumber(value)
  return safe === null ? '—' : `¥${formatInteger(safe)}`
}

function formatPercent(value) {
  const safe = safeNumber(value)
  return safe === null ? '—' : `${safe.toLocaleString('ja-JP')}%`
}

function normalizedBlock(model, key) {
  const raw = ownValue(model, key)
  if (!isRecord(raw)) {
    return {
      status: 'error', stale: false, data: null,
      message: '数据格式异常', code: 'INVALID_VIEW_MODEL',
    }
  }
  const rawStatus = ownValue(raw, 'status')
  const status = BLOCK_STATUSES.has(rawStatus) ? rawStatus : 'error'
  return {
    status,
    stale: status === 'ready' && ownValue(raw, 'stale') === true,
    data: status === 'ready' ? ownValue(raw, 'data') : null,
    message: safeText(ownValue(raw, 'message')),
    code: safeText(ownValue(raw, 'code')),
  }
}

function validatedBlock(model, key, validator, label) {
  const block = normalizedBlock(model, key)
  if (block.status !== 'ready') return block
  let valid = false
  try {
    valid = validator(block.data) === true
  } catch {
    valid = false
  }
  return valid ? block : {
    status: 'error', stale: false, data: null,
    message: `${label}数据格式异常`, code: 'INVALID_VIEW_MODEL',
  }
}

function stateMessage(block) {
  if (block.status === 'loading') return '数据正在加载'
  if (block.status === 'forbidden') {
    return block.message
      ? `当前权限下无法查看：${block.message}`
      : '当前权限下无法查看此模块'
  }
  return block.message && block.message !== '数据格式异常'
    ? `数据暂不可用：${block.message}`
    : '数据格式异常，暂无法显示'
}

function StateNotice({ block }) {
  const status = block.status === 'loading' ? 'status' : 'alert'
  return (
    <div className={`executive-block-state executive-block-state-${block.status}`} role={status}>
      <strong>{block.status === 'loading' ? '加载中' : block.status === 'forbidden' ? '权限受限' : '暂不可用'}</strong>
      <span>{stateMessage(block)}</span>
    </div>
  )
}

function MalformedData({ label }) {
  return (
    <div className="executive-block-state executive-block-state-error" role="alert">
      <strong>暂不可用</strong>
      <span>{label}数据格式异常，暂无法显示</span>
    </div>
  )
}

function DashboardPanel({ area, eyebrow, title, block, children, className = '' }) {
  let content = null
  if (block.status === 'ready') {
    try {
      content = typeof children === 'function' ? children(block.data) : children
    } catch {
      content = <MalformedData label={title} />
    }
  }
  return (
    <section
      className={`executive-dashboard-panel executive-dashboard-area-${area} ${className}`.trim()}
      data-dashboard-block={area}
    >
      <header className="executive-panel-heading">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        {block.status === 'ready' ? <em>READY</em> : <em>{block.status.toUpperCase()}</em>}
      </header>
      {block.status !== 'ready' ? <StateNotice block={block} /> : (
        <>
          {block.stale ? <p className="executive-stale-notice" role="status">数据可能已过期</p> : null}
          {content}
        </>
      )}
    </section>
  )
}

function filterSnapshot(filters, fallbackMonth, projectIds) {
  const projectId = ownValue(filters, 'projectId')
  const selectedMonth = ownValue(filters, 'selectedMonth')
  const pageSize = ownValue(filters, 'pageSize')
  return {
    projectId: projectId === 'all' || projectIds.has(projectId) ? projectId : 'all',
    projectStatus: PROJECT_STATUSES.includes(ownValue(filters, 'projectStatus'))
      ? ownValue(filters, 'projectStatus')
      : 'all',
    rankingMetric: RANKING_METRICS.has(ownValue(filters, 'rankingMetric'))
      ? ownValue(filters, 'rankingMetric')
      : 'profit',
    selectedMonth: isMonth(selectedMonth)
      ? selectedMonth
      : isMonth(fallbackMonth) ? fallbackMonth : '',
    page: safePositiveInteger(ownValue(filters, 'page'), 1),
    pageSize: Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100
      ? pageSize
      : 10,
  }
}

function projectOptions(projectRowsBlock) {
  const options = new Map([['all', '全部项目']])
  const data = projectRowsBlock.status === 'ready' ? projectRowsBlock.data : null
  const rows = isRecord(data) && isArray(ownValue(data, 'projectOptions'))
    ? ownValue(data, 'projectOptions')
    : []
  for (let index = 0; index < rows.length; index += 1) {
    const row = ownValue(rows, index)
    const projectId = safeText(ownValue(row, 'projectId'))
    if (projectId) options.set(projectId, safeText(ownValue(row, 'projectName'), projectId))
  }
  return [...options.entries()]
}

function DashboardFilters({ value, projects, onChange }) {
  return (
    <div className="executive-dashboard-filters" aria-label="驾驶舱筛选条件">
      <label>
        <span>项目范围</span>
        <select
          value={value.projectId}
          data-testid="dashboard-project-filter"
          onChange={(event) => onChange('projectId', event.target.value)}
        >
          {projects.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </label>
      <label>
        <span>自然月</span>
        <input
          type="month"
          value={value.selectedMonth}
          data-testid="dashboard-month-filter"
          onChange={(event) => onChange('selectedMonth', event.target.value)}
        />
      </label>
      <label>
        <span>项目状态</span>
        <select
          value={value.projectStatus}
          data-testid="dashboard-status-filter"
          onChange={(event) => onChange('projectStatus', event.target.value)}
        >
          {PROJECT_STATUSES.map((status) => (
            <option value={status} key={status}>{status === 'all' ? '全部状态' : status}</option>
          ))}
        </select>
      </label>
      <label>
        <span>排行口径</span>
        <select
          value={value.rankingMetric}
          data-testid="dashboard-ranking-filter"
          onChange={(event) => onChange('rankingMetric', event.target.value)}
        >
          {RANKING_OPTIONS.map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
      </label>
    </div>
  )
}

function KpiValue({ item, format }) {
  const status = safeText(ownValue(item, 'status'), 'error')
  const value = safeNumber(ownValue(item, 'value'))
  if (status !== 'ready' || value === null) {
    return (
      <span className="executive-kpi-unavailable">
        {safeText(ownValue(item, 'message'), status === 'forbidden' ? '当前权限不可见' : '数据暂不可用')}
      </span>
    )
  }
  return <strong>{format === 'count' ? `${formatInteger(value)} 个` : formatYen(value)}</strong>
}

function KpiGrid({ block }) {
  if (block.status !== 'ready') {
    return <div className="executive-kpi-state"><StateNotice block={block} /></div>
  }
  const rawItems = isArray(block.data) ? block.data : []
  const byKey = new Map()
  for (let index = 0; index < rawItems.length; index += 1) {
    const item = ownValue(rawItems, index)
    const key = safeText(ownValue(item, 'key'))
    if (key && !byKey.has(key)) byKey.set(key, item)
  }
  return (
    <section className="executive-kpi-grid" aria-label="截至日当前累计关键指标">
      {block.stale ? <p className="executive-stale-notice" role="status">数据可能已过期</p> : null}
      {KPI_DEFINITIONS.map(([key, fallbackLabel, format], index) => {
        const item = byKey.get(key) || { status: 'error', value: null, message: '数据格式异常' }
        return (
          <article className="executive-kpi-card" data-kpi-card={key} key={key}>
            <span className="executive-kpi-index">0{index + 1}</span>
            <p>{safeText(ownValue(item, 'label'), fallbackLabel)}</p>
            <KpiValue item={item} format={format} />
          </article>
        )
      })}
    </section>
  )
}

function revenueChart(data) {
  if (!isRecord(data)) return <MalformedData label="收款结构" />
  return (
    <>
      <DonutChart
        title="收款结构"
        description="当前累计含税收款与当前含税未收"
        data={[
          { key: 'received', label: '累计含税收款', value: ownValue(data, 'receivedTaxInclusiveAmount'), color: 'var(--erp-chart-gold)' },
          { key: 'outstanding', label: '含税未收', value: ownValue(data, 'outstandingTaxInclusiveAmount'), color: 'var(--erp-chart-slate)' },
        ]}
        valueFormatter={formatYen}
      />
      <dl className="executive-inline-metrics">
        <div><dt>当前含税合同额</dt><dd>{formatYen(ownValue(data, 'contractTaxInclusiveAmount'))}</dd></div>
        <div><dt>收款率</dt><dd>{formatPercent(ownValue(data, 'collectionRate'))}</dd></div>
      </dl>
    </>
  )
}

function lifecycleChart(data) {
  if (!isArray(data)) return <MalformedData label="项目生命周期" />
  const rows = []
  for (let index = 0; index < data.length; index += 1) {
    const item = ownValue(data, index)
    rows.push({
      key: safeText(ownValue(item, 'status'), `status-${index}`),
      label: safeText(ownValue(item, 'status'), '未设置'),
      value: ownValue(item, 'count'),
      color: index === 3 ? 'var(--erp-chart-gold)' : 'var(--erp-chart-bronze)',
    })
  }
  return (
    <BarChart
      title="项目生命周期"
      description="当前筛选范围内的互斥项目状态"
      data={rows}
      valueFormatter={(value) => `${formatInteger(value)} 个`}
    />
  )
}

function cashChart(data) {
  if (!isRecord(data) || !isArray(ownValue(data, 'points'))) {
    return <MalformedData label="现金趋势" />
  }
  return (
    <LineChart
      title="12 个月现金趋势"
      description="按事实发生月展示现金收入、现金流出与净现金"
      points={ownValue(data, 'points')}
      series={[
        { key: 'income', label: '现金收入', color: 'var(--erp-chart-positive)' },
        { key: 'outflow', label: '现金流出', color: 'var(--erp-chart-negative)' },
        { key: 'net', label: '净现金', color: 'var(--erp-chart-gold)' },
      ]}
      valueFormatter={formatYen}
    />
  )
}

function costChart(data) {
  if (!isRecord(data)) return <MalformedData label="成本构成" />
  return (
    <>
      <BarChart
        title="成本构成"
        description={`${safeText(ownValue(data, 'month'), '所选自然月')}已确认成本口径`}
        data={[
          { key: 'labor', label: '人工', value: ownValue(data, 'labor'), color: 'var(--erp-chart-gold)' },
          { key: 'purchase', label: '采购', value: ownValue(data, 'purchase'), color: 'var(--erp-chart-amber)' },
          { key: 'vehicle', label: '车辆', value: ownValue(data, 'vehicle'), color: 'var(--erp-chart-bronze)' },
          { key: 'manual', label: '手工补充', value: ownValue(data, 'manual'), color: 'var(--erp-chart-ivory)' },
          { key: 'operating', label: '运营费用', value: ownValue(data, 'operating'), color: 'var(--erp-chart-slate)' },
        ]}
        valueFormatter={formatYen}
      />
      <p className="executive-panel-total"><span>所选月成本合计</span><strong>{formatYen(ownValue(data, 'total'))}</strong></p>
    </>
  )
}

function rankingChart(data, rankingMetric) {
  if (!isArray(data)) return <MalformedData label="盈利能力排行" />
  const rows = []
  for (let index = 0; index < data.length; index += 1) {
    const item = ownValue(data, index)
    rows.push({
      key: safeText(ownValue(item, 'projectId'), `rank-${index}`),
      label: safeText(ownValue(item, 'projectName'), '未命名项目'),
      value: ownValue(item, 'value'),
      color: safeNumber(ownValue(item, 'value')) !== null && ownValue(item, 'value') < 0
        ? 'var(--erp-chart-negative)'
        : index === 0 ? 'var(--erp-chart-gold)' : 'var(--erp-chart-bronze)',
    })
  }
  const formatter = rankingMetric === 'margin' ? formatPercent : formatYen
  return (
    <HorizontalBarChart
      title="盈利能力排行"
      description="只展示读模型允许发布的项目与所选排行口径"
      data={rows}
      valueFormatter={formatter}
    />
  )
}

function canonicalNavigationTarget(value) {
  const targetView = safeText(value)
  if (!targetView) return ''
  const route = getAdminRoute(targetView)
  return route?.view === targetView ? targetView : ''
}

function Alerts({ data, onNavigate }) {
  if (!isArray(data)) return <MalformedData label="授权预警" />
  const items = []
  for (let index = 0; index < data.length; index += 1) {
    const alert = ownValue(data, index)
    if (!isRecord(alert)) continue
    const id = safeText(ownValue(alert, 'id'), `alert-${index}`)
    const severity = ['info', 'warning', 'error'].includes(ownValue(alert, 'severity'))
      ? ownValue(alert, 'severity')
      : 'info'
    const targetView = canonicalNavigationTarget(ownValue(alert, 'targetView'))
    const canNavigate = ownValue(alert, 'canNavigate') === true && Boolean(targetView)
    items.push(
      <li className={`executive-alert executive-alert-${severity}`} key={`${id}-${index}`}>
        <div className="executive-alert-marker" aria-hidden="true" />
        <div className="executive-alert-copy">
          <div><strong>{safeText(ownValue(alert, 'title'), '数据提示')}</strong><span>{formatInteger(ownValue(alert, 'count'))} 项</span></div>
          <p>{safeText(ownValue(alert, 'reason'), '请核对相关业务数据。')}</p>
          {canNavigate && safeNumber(ownValue(alert, 'amount')) !== null
            ? <em>{formatYen(ownValue(alert, 'amount'))}</em>
            : null}
        </div>
        {canNavigate && typeof onNavigate === 'function' ? (
          <button
            type="button"
            data-testid={`dashboard-alert-action-${id}`}
            onClick={() => onNavigate(targetView)}
          >
            查看
          </button>
        ) : null}
      </li>,
    )
  }
  return items.length > 0
    ? <ul className="executive-alert-list">{items}</ul>
    : <p className="executive-empty-copy">当前筛选范围内暂无授权预警</p>
}

function moneyCell(value) {
  return safeNumber(value) === null ? '—' : formatYen(value)
}

function ProjectTable({ data, onPageChange }) {
  if (!isRecord(data) || !isArray(ownValue(data, 'items'))) {
    return <MalformedData label="项目经营明细" />
  }
  const items = ownValue(data, 'items')
  const page = safePositiveInteger(ownValue(data, 'page'), 1)
  const totalPages = safePositiveInteger(ownValue(data, 'totalPages'), 1)
  const totalItems = Number.isSafeInteger(ownValue(data, 'totalItems')) && ownValue(data, 'totalItems') >= 0
    ? ownValue(data, 'totalItems')
    : items.length
  const rows = []
  for (let index = 0; index < items.length; index += 1) {
    const row = ownValue(items, index)
    if (!isRecord(row)) continue
    const projectId = safeText(ownValue(row, 'projectId'), `row-${index + 1}`)
    const profit = safeNumber(ownValue(row, 'estimatedProfit'))
    const profitStatus = safeText(ownValue(row, 'profitStatus'), 'missing_anchor')
    const statusLabel = safeText(ownValue(row, 'profitStatusLabel'), '利润数据暂不可用')
    rows.push(
      <tr key={`${projectId}-${index}`}>
        <th scope="row"><strong>{safeText(ownValue(row, 'projectName'), '未命名项目')}</strong><span>{projectId}</span></th>
        <td><span className="executive-status-pill">{safeText(ownValue(row, 'projectStatus'), '未设置')}</span></td>
        <td>{moneyCell(ownValue(row, 'contractTaxInclusiveAmount'))}</td>
        <td>{moneyCell(ownValue(row, 'receivedTaxInclusiveAmount'))}</td>
        <td>{moneyCell(ownValue(row, 'outstandingTaxInclusiveAmount'))}</td>
        <td>{moneyCell(ownValue(row, 'confirmedCost'))}</td>
        <td className="executive-pending-cost">{moneyCell(ownValue(row, 'pendingManualCost'))}</td>
        <td data-profit-cell={projectId}>
          {profitStatus === 'missing_anchor' || profit === null
            ? <span className="executive-profit-status">{statusLabel}</span>
            : <><strong>{formatYen(profit)}</strong>{statusLabel ? <small>{statusLabel}</small> : null}</>}
        </td>
        <td>{profitStatus === 'missing_anchor' ? '—' : formatPercent(ownValue(row, 'margin'))}</td>
      </tr>,
    )
  }
  return (
    <>
      <div className="executive-project-table-scroll" tabIndex="0" aria-label="项目经营明细横向滚动区域">
        <table className="executive-project-table">
          <thead>
            <tr>
              <th scope="col">项目</th><th scope="col">状态</th><th scope="col">含税合同额</th>
              <th scope="col">累计含税收款</th><th scope="col">含税未收</th><th scope="col">已确认成本</th>
              <th scope="col">待核对手工成本</th><th scope="col">预计利润（税抜）</th><th scope="col">利润率</th>
            </tr>
          </thead>
          <tbody>{rows.length > 0 ? rows : <tr><td colSpan="9">当前筛选范围内暂无项目</td></tr>}</tbody>
        </table>
      </div>
      <footer className="executive-table-pagination">
        <span>共 {formatInteger(totalItems)} 个项目 · 第 {page}/{totalPages} 页</span>
        <div>
          <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
          <button
            type="button"
            disabled={page >= totalPages}
            data-testid="dashboard-next-page"
            onClick={() => onPageChange(page + 1)}
          >下一页</button>
        </div>
      </footer>
    </>
  )
}

export function ExecutiveDashboardPage({
  model,
  filters,
  viewerName,
  onFiltersChange,
  onNavigate,
}) {
  const meta = isRecord(ownValue(model, 'meta')) ? ownValue(model, 'meta') : {}
  const selectedMonth = safeText(ownValue(meta, 'selectedMonth'))
  const blocks = {
    kpis: validatedBlock(model, 'kpis', validKpis, '关键指标'),
    revenue: validatedBlock(model, 'revenue', validRevenue, '收款结构'),
    projectStatus: validatedBlock(model, 'projectStatus', validProjectStatus, '项目生命周期'),
    cashFlow: validatedBlock(model, 'cashFlow', validCashFlow, '现金趋势'),
    costs: validatedBlock(model, 'costs', validCosts, '成本构成'),
    ranking: validatedBlock(model, 'projectRanking', validRanking, '盈利能力排行'),
    alerts: validatedBlock(model, 'alerts', validAlerts, '授权预警'),
    rows: validatedBlock(model, 'projectRows', validProjectRows, '项目经营明细'),
  }
  const scopeLabel = safeText(ownValue(meta, 'projectScopeLabel'), '全部项目')
  const options = projectOptions(blocks.rows)
  const projectIds = new Set(options.map(([projectId]) => projectId))
  const filterValue = filterSnapshot(filters, selectedMonth, projectIds)
  const emitFilter = (key, value) => {
    if (typeof onFiltersChange !== 'function') return
    onFiltersChange(filterSnapshot({
      ...filterValue,
      [key]: value,
      page: key === 'page' ? value : 1,
    }, selectedMonth, projectIds))
  }

  return (
    <main className="erp-black-gold executive-dashboard-page">
      <header className="executive-dashboard-hero">
        <div className="executive-hero-copy">
          <span className="executive-eyebrow">EXECUTIVE CONTROL CENTER</span>
          <h1>欢迎回来，{safeText(viewerName, '管理者')}</h1>
          <p>KPI 为截至日当前累计快照，不随所选自然月回溯。</p>
        </div>
        <dl className="executive-scope-strip">
          <div><dt>当前快照截至</dt><dd>{safeText(ownValue(meta, 'asOfDate'), '日期待确认')}</dd></div>
          <div><dt>项目范围</dt><dd>{scopeLabel}</dd></div>
          <div><dt>自然月</dt><dd>{safeText(ownValue(meta, 'monthScopeLabel'), selectedMonth || '月份待确认')}</dd></div>
          <div>
            <dt>12 个月现金窗口</dt>
            <dd>{safeText(ownValue(meta, 'windowStartMonth'), '—')} — {safeText(ownValue(meta, 'windowEndMonth'), '—')}</dd>
          </div>
        </dl>
      </header>

      <DashboardFilters value={filterValue} projects={options} onChange={emitFilter} />
      <KpiGrid block={blocks.kpis} />

      <div className="executive-dashboard-grid">
        <DashboardPanel area="collection" eyebrow="REVENUE" title="收款结构" block={blocks.revenue}>
          {revenueChart}
        </DashboardPanel>
        <DashboardPanel area="lifecycle" eyebrow="PORTFOLIO" title="项目生命周期" block={blocks.projectStatus}>
          {lifecycleChart}
        </DashboardPanel>
        <DashboardPanel area="cash" eyebrow="CASH FLOW" title="12 个月现金趋势" block={blocks.cashFlow}>
          {cashChart}
        </DashboardPanel>
        <DashboardPanel area="cost" eyebrow="COST CONTROL" title="成本构成" block={blocks.costs}>
          {costChart}
        </DashboardPanel>
        <DashboardPanel area="ranking" eyebrow="PROFITABILITY" title="盈利能力排行" block={blocks.ranking}>
          {(data) => rankingChart(data, filterValue.rankingMetric)}
        </DashboardPanel>
        <DashboardPanel area="alerts" eyebrow="AUTHORIZED SIGNALS" title="授权预警" block={blocks.alerts}>
          {(data) => <Alerts data={data} onNavigate={onNavigate} />}
        </DashboardPanel>
        <DashboardPanel area="projects" eyebrow="PROJECT LEDGER" title="项目经营明细" block={blocks.rows}>
          {(data) => <ProjectTable data={data} onPageChange={(page) => emitFilter('page', page)} />}
        </DashboardPanel>
      </div>
    </main>
  )
}

export default ExecutiveDashboardPage

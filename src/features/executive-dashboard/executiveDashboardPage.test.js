import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

const cssSource = await readFile(
  new URL('./executiveDashboard.css', import.meta.url),
  'utf8',
).catch(() => '')

async function loadComponents() {
  const server = await createServer({
    root: process.cwd(),
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    const [charts, page] = await Promise.all([
      server.ssrLoadModule('/src/features/executive-dashboard/ExecutiveCharts.jsx'),
      server.ssrLoadModule('/src/features/executive-dashboard/ExecutiveDashboardPage.jsx'),
    ])
    return { error: null, charts, page }
  } catch (error) {
    return { error, charts: null, page: null }
  } finally {
    await server.close()
  }
}

const loaded = await loadComponents()

function moduleFor(name) {
  assert.ifError(loaded.error)
  assert.ok(loaded[name])
  return loaded[name]
}

function render(Component, props) {
  return renderToStaticMarkup(createElement(Component, props))
}

function ready(data, overrides = {}) {
  return {
    status: 'ready',
    stale: false,
    data,
    code: '',
    message: '',
    requiredSources: [],
    updatedAt: '2026-07-17T01:00:00.000Z',
    ...overrides,
  }
}

const filters = Object.freeze({
  projectId: 'P1',
  projectStatus: 'all',
  rankingMetric: 'profit',
  selectedMonth: '2026-07',
  page: 1,
  pageSize: 10,
})

function dashboardModel(overrides = {}) {
  return {
    meta: {
      asOfDate: '2026-07-17',
      selectedMonth: '2026-07',
      windowStartMonth: '2025-08',
      windowEndMonth: '2026-07',
      projectScopeLabel: '东京站改修',
      monthScopeLabel: '2026-07',
    },
    kpis: ready([
      { key: 'activeProjects', label: '当前有效项目', status: 'ready', value: 3, comparison: null, message: '' },
      { key: 'contractTaxInclusive', label: '当前含税合同额', status: 'ready', value: 1200000, comparison: null, message: '' },
      { key: 'receivedTaxInclusive', label: '当前累计含税收款', status: 'ready', value: 700000, comparison: null, message: '' },
      { key: 'outstandingTaxInclusive', label: '当前含税未收', status: 'ready', value: 500000, comparison: null, message: '' },
      { key: 'estimatedProfitTaxExclusive', label: '当前累计税抜预计利润', status: 'ready', value: 360000, comparison: null, message: '' },
    ]),
    revenue: ready({
      contractTaxInclusiveAmount: 1200000,
      receivedTaxInclusiveAmount: 700000,
      outstandingTaxInclusiveAmount: 500000,
      collectionRate: 58.3,
      comparison: null,
      issues: [],
    }),
    projectStatus: ready([
      { status: '报价中', count: 1 },
      { status: '设计中', count: 0 },
      { status: '待开工', count: 0 },
      { status: '进行中', count: 2 },
      { status: '暂停', count: 0 },
      { status: '已完工', count: 0 },
      { status: '已取消', count: 0 },
    ]),
    cashFlow: ready({
      points: [
        { month: '2026-05', income: 200000, outflow: 130000, net: 70000 },
        { month: '2026-06', income: 0, outflow: 80000, net: -80000 },
        { month: '2026-07', income: 500000, outflow: 170000, net: 330000 },
      ],
      series: [],
      coverage: {},
      anomalies: [],
      componentStatus: { income: 'ready', outflow: 'ready', net: 'ready' },
      comparison: {},
    }),
    costs: ready({
      month: '2026-07',
      scope: 'P1',
      labor: 80000,
      purchase: 45000,
      vehicle: 15000,
      manual: 20000,
      operating: 10000,
      total: 170000,
      incomplete: false,
      monthlyByMonth: {},
      pending: {},
      anomalies: [],
      comparison: null,
    }),
    alerts: ready([
      {
        id: 'purchase:current-payable',
        type: 'purchase_payable',
        severity: 'warning',
        title: '采购应付待处理',
        reason: '当前仍有采购应付余额。',
        count: 1,
        amount: 25000,
        targetView: 'purchase',
        canNavigate: true,
        recordRef: null,
      },
      {
        id: 'source:inventory',
        type: 'source_issue',
        severity: 'info',
        title: '数据源状态提示',
        reason: '库存数据可能已过期。',
        count: 1,
        amount: null,
        targetView: null,
        canNavigate: false,
        recordRef: null,
      },
    ]),
    projectRanking: ready([
      { projectId: 'P1', projectName: '东京站改修', projectStatus: '进行中', metric: 'profit', value: 360000 },
      { projectId: 'P2', projectName: '横滨仓库', projectStatus: '设计中', metric: 'profit', value: -20000 },
    ]),
    projectRows: ready({
      items: [
        {
          projectId: 'P1',
          projectName: '东京站改修',
          projectStatus: '进行中',
          contractTaxInclusiveAmount: 1200000,
          receivedTaxInclusiveAmount: 700000,
          outstandingTaxInclusiveAmount: 500000,
          confirmedCost: 640000,
          pendingManualCost: 47000,
          estimatedProfit: 360000,
          margin: 36,
          profitStatus: 'ready',
          profitStatusLabel: '',
        },
        {
          projectId: 'P2',
          projectName: '横滨仓库',
          projectStatus: '设计中',
          contractTaxInclusiveAmount: 300000,
          receivedTaxInclusiveAmount: 0,
          outstandingTaxInclusiveAmount: 300000,
          confirmedCost: 50000,
          pendingManualCost: 9000,
          estimatedProfit: null,
          margin: null,
          profitStatus: 'missing_anchor',
          profitStatusLabel: '待完成合同收入确认',
        },
      ],
      page: 1,
      pageSize: 10,
      totalItems: 12,
      totalPages: 2,
    }),
    ...overrides,
  }
}

function materializedElements(node, output = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return output
  if (Array.isArray(node)) {
    for (const child of node) materializedElements(child, output)
    return output
  }
  if (typeof node !== 'object') return output
  if (typeof node.type === 'function') {
    return materializedElements(node.type(node.props || {}), output)
  }
  output.push(node)
  materializedElements(node.props?.children, output)
  return output
}

test('native SVG charts expose titles, text equivalents, focusable marks, and finite empty geometry', () => {
  const { DonutChart, BarChart, LineChart, HorizontalBarChart } = moduleFor('charts')
  const valueFormatter = (value) => `¥${value}`
  const common = {
    title: '测试图表',
    description: '用于管理层决策的测试数据',
    data: [
      { key: 'a', label: '甲', value: 60, color: 'var(--erp-chart-gold)' },
      { key: 'b', label: '乙', value: 40, color: 'var(--erp-chart-amber)' },
    ],
    valueFormatter,
  }
  const chartMarkup = [
    render(DonutChart, common),
    render(BarChart, common),
    render(HorizontalBarChart, { ...common, data: [...common.data, { key: 'loss', label: '亏损', value: -5 }] }),
    render(LineChart, {
      title: '现金趋势',
      description: '收入、流出与净现金',
      points: [
        { month: '2026-06', income: 100, outflow: 50, net: 50 },
        { month: '2026-07', income: 0, outflow: 20, net: -20 },
      ],
      series: [
        { key: 'income', label: '收入', color: 'var(--erp-chart-positive)' },
        { key: 'outflow', label: '流出', color: 'var(--erp-chart-negative)' },
        { key: 'net', label: '净现金', color: 'var(--erp-chart-gold)' },
      ],
      valueFormatter,
    }),
  ]

  for (const markup of chartMarkup) {
    assert.match(markup, /<svg[^>]*role="img"[^>]*aria-label="[^"]+"/u)
    assert.match(markup, /<title>/u)
    assert.match(markup, /executive-chart-(?:legend|data-table)/u)
    assert.match(markup, /tabindex="0"/u)
    assert.doesNotMatch(markup, /NaN|Infinity/u)
  }

  const unstableInputs = [
    render(DonutChart, { ...common, data: [] }),
    render(BarChart, { ...common, data: common.data.map((item) => ({ ...item, value: 0 })) }),
    render(HorizontalBarChart, { ...common, data: [{ key: 'bad', label: '异常', value: Number.POSITIVE_INFINITY }] }),
    render(LineChart, {
      title: '空现金趋势', description: '无有效点',
      points: [{ month: '2026-07', income: Number.NaN, outflow: Number.POSITIVE_INFINITY, net: null }],
      series: [{ key: 'net', label: '净现金', color: 'var(--erp-chart-gold)' }],
      valueFormatter,
    }),
  ]
  for (const markup of unstableInputs) {
    assert.match(markup, /暂无可展示数据|当前数据均为零/u)
    assert.doesNotMatch(markup, /NaN|Infinity/u)
  }

  const crowdedRanking = render(HorizontalBarChart, {
    ...common,
    data: Array.from({ length: 30 }, (_, index) => ({
      key: `project-${index}`,
      label: `项目 ${index + 1}`,
      value: 30 - index,
    })),
  })
  const rankingRects = [...crowdedRanking.matchAll(/<rect[^>]*\sy="([\d.-]+)"[^>]*\sheight="([\d.-]+)"/gu)]
  assert.ok(rankingRects.length > 0)
  for (const [, rawY, rawHeight] of rankingRects) {
    assert.ok(Number(rawY) >= 0)
    assert.ok(Number(rawY) + Number(rawHeight) <= 244)
  }
})

test('ready dashboard renders five current KPIs and every required management block', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const markup = render(ExecutiveDashboardPage, {
    model: dashboardModel(),
    filters,
    viewerName: '山田社长',
    onFiltersChange() {},
    onNavigate() {},
  })

  assert.equal((markup.match(/data-kpi-card=/gu) || []).length, 5)
  for (const label of [
    '当前有效项目', '当前含税合同额', '当前累计含税收款',
    '当前含税未收', '当前累计税抜预计利润',
  ]) assert.match(markup, new RegExp(label, 'u'))

  for (const label of [
    '欢迎回来，山田社长', '2026-07-17', '东京站改修', '2026-07',
    '2025-08', '12 个月现金窗口', '项目范围', '自然月',
    '收款结构', '项目生命周期', '12 个月现金趋势', '成本构成',
    '盈利能力排行', '授权预警', '项目经营明细', '待核对手工成本',
  ]) assert.match(markup, new RegExp(label, 'u'))
  assert.match(markup, /KPI 为截至日当前累计快照，不随所选自然月回溯/u)
  assert.match(markup, /class="executive-project-table-scroll"/u)
})

test('loading, error, forbidden, and ready-stale blocks remain visibly distinct', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const base = dashboardModel()
  const markup = render(ExecutiveDashboardPage, {
    model: dashboardModel({
      revenue: { ...base.revenue, status: 'loading', data: null, message: '数据正在加载' },
      projectStatus: { ...base.projectStatus, status: 'error', data: null, message: '生命周期来源失败' },
      costs: { ...base.costs, status: 'forbidden', data: null, message: '成本权限不足' },
      cashFlow: { ...base.cashFlow, stale: true },
    }),
    filters,
    viewerName: '测试用户',
  })

  assert.match(markup, /数据正在加载/u)
  assert.match(markup, /数据暂不可用：生命周期来源失败/u)
  assert.match(markup, /当前权限下无法查看：成本权限不足/u)
  assert.match(markup, /数据可能已过期/u)
  assert.match(markup, /12 个月现金趋势/u)
})

test('missing-profit rows publish status text instead of inventing a zero value', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const markup = render(ExecutiveDashboardPage, {
    model: dashboardModel(), filters, viewerName: '财务负责人',
  })
  assert.match(markup, /data-profit-cell="P2"[^>]*>\s*<span[^>]*>待完成合同收入确认/u)
  assert.doesNotMatch(markup, /data-profit-cell="P2"[^>]*>\s*¥0/u)
})

test('real page controls emit merged filters and only authorized alerts navigate', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const filterCalls = []
  const navigationCalls = []
  const tree = ExecutiveDashboardPage({
    model: dashboardModel(),
    filters,
    viewerName: '操作员',
    onFiltersChange: (next) => filterCalls.push(next),
    onNavigate: (target) => navigationCalls.push(target),
  })
  const elements = materializedElements(tree)
  const control = (id) => elements.find((element) => element.props?.['data-testid'] === id)

  control('dashboard-project-filter').props.onChange({ target: { value: 'P2' } })
  control('dashboard-month-filter').props.onChange({ target: { value: '2026-06' } })
  control('dashboard-ranking-filter').props.onChange({ target: { value: 'margin' } })
  control('dashboard-next-page').props.onClick()
  control('dashboard-alert-action-purchase:current-payable').props.onClick()

  assert.deepEqual(filterCalls.map((call) => ({
    projectId: call.projectId,
    selectedMonth: call.selectedMonth,
    rankingMetric: call.rankingMetric,
    page: call.page,
  })), [
    { projectId: 'P2', selectedMonth: '2026-07', rankingMetric: 'profit', page: 1 },
    { projectId: 'P1', selectedMonth: '2026-06', rankingMetric: 'profit', page: 1 },
    { projectId: 'P1', selectedMonth: '2026-07', rankingMetric: 'margin', page: 1 },
    { projectId: 'P1', selectedMonth: '2026-07', rankingMetric: 'profit', page: 2 },
  ])
  assert.deepEqual(navigationCalls, ['purchase'])
  assert.equal(control('dashboard-alert-action-source:inventory'), undefined)

  const base = dashboardModel()
  const nonAuthorizedMarkup = render(ExecutiveDashboardPage, {
    model: dashboardModel({
      alerts: ready(base.alerts.data.map((alert) => alert.canNavigate
        ? alert
        : { ...alert, amount: 987654, recordRef: 'PRIVATE-RECORD' })),
    }),
    filters,
    viewerName: '操作员',
    onNavigate() {},
  })
  assert.doesNotMatch(nonAuthorizedMarkup, /987,654|PRIVATE-RECORD/u)
})

test('malformed models and block payloads fail safely without leaking invalid SVG numbers', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const hostile = {}
  Object.defineProperty(hostile, 'data', {
    enumerable: true,
    get() { throw new Error('must not execute malformed data getters') },
  })
  const markup = render(ExecutiveDashboardPage, {
    model: dashboardModel({
      revenue: { status: 'ready', stale: false, data: 'bad' },
      projectStatus: hostile,
      cashFlow: ready({ points: [{ month: 'bad', income: Number.NaN, outflow: Infinity, net: -Infinity }] }),
      costs: ready(null),
      alerts: ready({}),
      projectRanking: ready([null, { projectName: '异常', value: Number.NaN }]),
      projectRows: ready({ items: 'bad', page: Number.NaN, totalPages: Infinity }),
    }),
    filters: null,
    viewerName: '',
  })

  assert.match(markup, /数据格式异常|暂无可展示数据/u)
  assert.doesNotMatch(markup, /NaN|Infinity/u)
  assert.doesNotThrow(() => render(ExecutiveDashboardPage, { model: null, filters: null }))
})

test('dashboard CSS is directly imported, fully scoped, variable-colored, and defines all responsive tiers', async () => {
  const pageSource = await readFile(
    new URL('./ExecutiveDashboardPage.jsx', import.meta.url),
    'utf8',
  ).catch(() => '')
  assert.match(pageSource, /import\s+'\.\/executiveDashboard\.css'/u)
  assert.ok(cssSource.length > 0)
  assert.doesNotMatch(cssSource, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/iu)

  const withoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//gu, '')
  const selectors = [...withoutComments.matchAll(/([^{}]+)\{/gu)]
    .map((match) => match[1].trim())
    .filter((selector) => selector && !selector.startsWith('@'))
  assert.ok(selectors.length > 0)
  for (const selectorList of selectors) {
    for (const selector of selectorList.split(',')) {
      assert.match(selector.trim(), /^\.erp-black-gold(?:\b|\s|\.|:|\[)/u)
    }
  }

  assert.match(cssSource, /@media\s*\(min-width:\s*768px\)\s*and\s*\(max-width:\s*1023px\)/u)
  assert.match(cssSource, /@media\s*\(min-width:\s*1024px\)/u)
  assert.match(cssSource, /grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/u)
  assert.doesNotMatch(
    cssSource,
    /\.executive-chart-table-scroll\s*\{[^}]*max-height:\s*1px[^}]*overflow:\s*hidden/su,
  )
})

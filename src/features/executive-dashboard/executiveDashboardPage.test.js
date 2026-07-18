import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import postcss from 'postcss'
import { createServer } from 'vite'

import { buildExecutiveDashboardReadModel } from './executiveDashboardDomain.js'

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
      coverage: [],
      anomalies: [],
      componentStatus: {
        income: 'ready', purchaseOutflow: 'ready', vehicleOutflow: 'ready',
        outflow: 'ready', net: 'ready',
      },
      comparison: { income: null, outflow: null, net: null },
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
      {
        projectId: 'P1', projectName: '东京站改修', projectStatus: '进行中',
        metric: 'profit', value: 360000, profit: 360000, margin: 36,
        revenue: 1200000, confirmedCost: 640000,
      },
      {
        projectId: 'P2', projectName: '横滨仓库', projectStatus: '设计中',
        metric: 'profit', value: -20000, profit: -20000, margin: -5,
        revenue: 300000, confirmedCost: 320000,
      },
    ]),
    projectRows: ready({
      projectOptions: [
        { projectId: 'P1', projectName: '东京站改修' },
        { projectId: 'P2', projectName: '横滨仓库' },
        { projectId: 'P3', projectName: '大阪设备更新' },
      ],
      items: [
        {
          projectId: 'P1',
          projectName: '东京站改修',
          projectStatus: '进行中',
          contractTaxInclusiveAmount: 1200000,
          receivedTaxInclusiveAmount: 700000,
          outstandingTaxInclusiveAmount: 500000,
          profitAnchorTaxExclusiveAmount: 1000000,
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
          profitAnchorTaxExclusiveAmount: null,
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

const DOMAIN_MONTHS = Object.freeze([
  '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01',
  '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
])

function domainReady(data) {
  return {
    status: 'ready', data, code: '', message: '', stale: false,
    updatedAt: '2026-07-17T00:00:00.000Z',
  }
}

function actualFullAccessDashboardModel() {
  const empty = () => domainReady([])
  return buildExecutiveDashboardReadModel({
    asOfDate: '2026-07-17',
    selectedMonth: '2026-07',
    filters: {
      projectId: 'P1', projectStatus: 'all', rankingMetric: 'profit', page: 1, pageSize: 10,
    },
    access: {
      page: true,
      projectSnapshot: true,
      contracts: { view: true, amounts: true },
      profit: { view: true, completeCostRequired: true },
      attendance: { view: true, identities: true },
      labor: { view: true, amounts: true },
      purchase: { accrual: true, payments: true, payable: true, anomalies: true },
      vehicle: { view: true, amounts: true },
      inventory: { view: true, amounts: true },
      tools: { view: true, amounts: true },
      costCategories: {
        labor: true, purchase: true, vehicle: true,
        manualSupplement: true, operatingExpense: true,
      },
    },
    sources: {
      projects: domainReady([{ projectId: 'P1', projectName: '实际模型项目', status: '进行中' }]),
      contractRevenue: domainReady([{
        projectId: 'P1', adjustedTaxInclusiveAmount: 100,
        totalReceivedTaxInclusiveAmount: 50,
        profitAnchorTaxExclusiveAmount: 90,
        allocationStatus: 'auto_allocated',
      }]),
      receipts: empty(),
      laborWindow: domainReady({
        monthly: DOMAIN_MONTHS.map((month) => ({
          month, status: 'ready', stale: false, source: 'formal', pendingCount: 0,
          salaryTotal: 0, projectLaborTotal: 0, projectLaborById: { P1: 0 },
        })),
        projectLaborLifetimeById: { P1: 0 },
        lifetimeStatus: 'ready',
        lifetimeStale: false,
        incompleteMonths: [],
        staleMonths: [],
      }),
      purchaseAccrual: empty(),
      purchasePayments: empty(),
      projectCosts: empty(),
      operatingExpenses: empty(),
      vehicles: empty(),
      vehicleUsage: empty(),
      fuel: empty(),
      vehicleExpenses: empty(),
      vehicleIssues: empty(),
      attendance: empty(),
      inventoryItems: empty(),
      stockInRecords: empty(),
      stockOutRecords: empty(),
      stockReturnRecords: empty(),
      toolRecords: domainReady([{ toolId: 'T1', currentStatus: '借出', totalCost: 10 }]),
      toolBorrowRecords: empty(),
      toolReturnRecords: empty(),
      lifelongToolAssignments: empty(),
      toolResponsibilityRecords: domainReady([{
        responsibilityRecordId: 'TR-ACTUAL', toolId: 'T1', projectId: 'P1',
        compensationStatus: '未赔偿', compensationAmount: 9,
      }]),
    },
  })
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

function withoutField(record, field) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== field))
}

test('native SVG charts expose titles, text equivalents, external focus targets, and finite empty geometry', () => {
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
  const chartCases = [
    {
      markup: render(DonutChart, common),
      markLabels: ['甲：¥60', '乙：¥40'],
    },
    {
      markup: render(BarChart, common),
      markLabels: ['甲：¥60', '乙：¥40'],
    },
    {
      markup: render(HorizontalBarChart, { ...common, data: [...common.data, { key: 'loss', label: '亏损', value: -5 }] }),
      markLabels: ['甲：¥60', '乙：¥40', '亏损：¥-5'],
    },
    {
      markup: render(LineChart, {
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
      markLabels: [
        '2026-06 收入：¥100',
        '2026-07 收入：¥0',
        '2026-06 流出：¥50',
        '2026-07 流出：¥20',
        '2026-06 净现金：¥50',
        '2026-07 净现金：¥-20',
      ],
    },
  ]

  for (const { markup, markLabels } of chartCases) {
    assert.match(markup, /<svg[^>]*role="group"[^>]*aria-label="[^"]+"/u)
    assert.match(markup, /executive-chart-(?:legend|data-table)/u)
    const svgMarkup = markup.match(/<svg[\s\S]*?<\/svg>/u)?.[0] || ''
    const focusableMarks = [...svgMarkup.matchAll(/<(?:circle|rect)\b[^>]*\btabindex="0"[^>]*>/gu)]
      .map((match) => match[0])
    assert.equal(focusableMarks.length, markLabels.length)
    assert.equal((svgMarkup.match(/\btabindex="0"/gu) || []).length, markLabels.length)
    assert.equal((svgMarkup.match(/<title>/gu) || []).length, markLabels.length + 1)
    for (const markLabel of markLabels) {
      assert.ok(focusableMarks.some((mark) => (
        mark.includes('role="img"') && mark.includes(`aria-label="${markLabel}"`)
      )), `expected one keyboard-focusable SVG mark for ${markLabel}`)
    }
    assert.match(markup, /<ul class="executive-chart-legend"[^>]*>[\s\S]*?<li[^>]*tabindex="0"[^>]*aria-label=/u)
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
    const svgMarkup = markup.match(/<svg[\s\S]*?<\/svg>/u)?.[0] || ''
    assert.doesNotMatch(svgMarkup, /tabindex=/u)
  }

  const invalidDonuts = [
    render(DonutChart, { ...common, data: [{ key: 'negative', label: '负数', value: -1 }] }),
    render(DonutChart, { ...common, data: [{ key: 'nan', label: '非数值', value: Number.NaN }] }),
    render(DonutChart, { ...common, data: [{ key: 'infinite', label: '无穷', value: Number.POSITIVE_INFINITY }] }),
  ]
  for (const markup of invalidDonuts) {
    assert.match(markup, /图表数据无效/u)
    assert.doesNotMatch(markup, /当前数据均为零|NaN|Infinity/u)
  }
  const zeroDonut = render(DonutChart, {
    ...common,
    data: common.data.map((row) => ({ ...row, value: 0 })),
  })
  assert.match(zeroDonut, /当前数据均为零/u)
  assert.doesNotMatch(zeroDonut, /图表数据无效/u)

  const maxDonut = render(DonutChart, {
    ...common,
    data: [
      { key: 'max-a', label: '极大甲', value: Number.MAX_VALUE },
      { key: 'max-b', label: '极大乙', value: Number.MAX_VALUE },
    ],
    valueFormatter: (value) => value.toExponential(3),
  })
  assert.equal((maxDonut.match(/stroke-dasharray="50 50"/gu) || []).length, 2)
  assert.doesNotMatch(maxDonut, /当前数据均为零|图表数据无效|NaN|Infinity/u)

  const crowdedRanking = render(HorizontalBarChart, {
    ...common,
    data: Array.from({ length: 30 }, (_, index) => ({
      key: `project-${index}`,
      label: `项目 ${index + 1}`,
      value: 30 - index,
    })),
  })
  const rankingRects = [...crowdedRanking.matchAll(/<rect[^>]*\sy="([\d.-]+)"[^>]*\sheight="([\d.-]+)"/gu)]
  const rankingViewBoxHeight = Number(crowdedRanking.match(/viewBox="0 0 680 ([\d.]+)"/u)?.[1])
  assert.equal(rankingRects.length, 30)
  assert.ok(rankingViewBoxHeight > 280)
  for (const [, rawY, rawHeight] of rankingRects) {
    assert.ok(Number(rawY) >= 0)
    assert.ok(Number(rawY) + Number(rawHeight) <= rankingViewBoxHeight)
  }

  const allNegative = render(HorizontalBarChart, {
    ...common,
    data: [
      { key: 'loss-a', label: '亏损甲', value: -10 },
      { key: 'loss-b', label: '亏损乙', value: -30 },
    ],
  })
  assert.doesNotMatch(allNegative, /当前数据均为零/u)
  assert.match(allNegative, /亏损甲：¥-10/u)
  assert.match(allNegative, /width="[1-9][\d.]*"/u)

  const negativeTail = render(HorizontalBarChart, {
    ...common,
    data: [
      ...Array.from({ length: 8 }, (_, index) => ({
        key: `zero-${index}`, label: `零值 ${index + 1}`, value: 0,
      })),
      { key: 'tail-loss', label: '尾部亏损', value: -12 },
    ],
  })
  assert.doesNotMatch(negativeTail, /当前数据均为零/u)
  assert.match(negativeTail.match(/<svg[\s\S]*?<\/svg>/u)?.[0] || '', /尾部亏损/u)
})

test('mixed zero bar charts keep invisible zero geometry out of the SVG focus order', () => {
  const { BarChart, HorizontalBarChart } = moduleFor('charts')
  const common = {
    title: '混合零值图表',
    description: '零值不应形成不可见焦点',
    data: [
      { key: 'zero', label: '零项', value: 0, color: 'var(--erp-chart-gold)' },
      { key: 'positive', label: '非零项', value: 25, color: 'var(--erp-chart-amber)' },
    ],
    valueFormatter: (value) => `¥${value}`,
  }

  for (const Chart of [BarChart, HorizontalBarChart]) {
    const markup = render(Chart, common)
    const svgMarkup = markup.match(/<svg[\s\S]*?<\/svg>/u)?.[0] || ''
    const focusableBars = [...svgMarkup.matchAll(/<rect\b[^>]*\btabindex="0"[^>]*>/gu)]
      .map((match) => match[0])

    assert.equal(focusableBars.length, 1)
    assert.match(focusableBars[0], /role="img"[^>]*aria-label="非零项：¥25"/u)
    assert.doesNotMatch(svgMarkup, /<rect\b[^>]*aria-label="零项：¥0"/u)
    assert.match(svgMarkup, />零项<\/text>/u)
  }
})

test('line chart maps signed finite extremes to three exact ordered coordinates', () => {
  const { LineChart } = moduleFor('charts')
  const maximum = Number.MAX_VALUE
  const markup = render(LineChart, {
    title: '极值现金趋势',
    description: '有限极值必须保持有序且互不重叠',
    points: [
      { month: '2026-05', income: 0, outflow: 0, net: -maximum },
      { month: '2026-06', income: 0, outflow: 0, net: 0 },
      { month: '2026-07', income: 0, outflow: 0, net: maximum },
    ],
    series: [{ key: 'net', label: '净现金', color: 'var(--erp-chart-gold)' }],
    valueFormatter: (value) => value.toExponential(3),
  })
  const svgMarkup = markup.match(/<svg[\s\S]*?<\/svg>/u)?.[0] || ''

  assert.match(svgMarkup, /points="50,218 348,120 646,22"/u)
  assert.deepEqual(
    [...svgMarkup.matchAll(/<circle[^>]*\scy="([\d.]+)"/gu)].map((match) => Number(match[1])),
    [218, 120, 22],
  )
  assert.doesNotMatch(markup, /NaN|Infinity/u)
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

test('every ready block rejects partial payloads instead of formatting invented values', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const base = dashboardModel()
  const cases = [
    ['kpis', ready(base.kpis.data.slice(0, 4)), '关键指标'],
    ['revenue', ready(withoutField(base.revenue.data, 'receivedTaxInclusiveAmount')), '收款结构'],
    ['projectStatus', ready(base.projectStatus.data.map((row, index) => index === 0 ? withoutField(row, 'count') : row)), '项目生命周期'],
    ['cashFlow', ready({ ...base.cashFlow.data, points: [withoutField(base.cashFlow.data.points[0], 'net')] }), '现金趋势'],
    ['costs', ready(withoutField(base.costs.data, 'labor')), '成本构成'],
    ['projectRanking', ready([withoutField(base.projectRanking.data[0], 'value')]), '盈利能力排行'],
    ['alerts', ready([null]), '授权预警'],
    ['projectRows', ready(withoutField(base.projectRows.data, 'projectOptions')), '项目经营明细'],
  ]

  for (const [key, block, label] of cases) {
    const markup = render(ExecutiveDashboardPage, {
      model: dashboardModel({ [key]: block }), filters, viewerName: '校验员',
    })
    assert.match(markup, new RegExp(`${label}数据格式异常`, 'u'), key)
  }
})

test('malformed ready rows fail the whole block without invoking accessors', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const base = dashboardModel()
  let getterReads = 0
  const accessor = (record, field) => {
    const output = withoutField(record, field)
    Object.defineProperty(output, field, {
      enumerable: true,
      get() {
        getterReads += 1
        throw new Error('must not read malformed row accessor')
      },
    })
    return output
  }
  const cases = [
    ['projectRanking', ready([accessor(base.projectRanking.data[0], 'value')]), '盈利能力排行'],
    ['alerts', ready([accessor(base.alerts.data[0], 'title')]), '授权预警'],
    ['projectRows', ready({
      ...base.projectRows.data,
      items: [accessor(base.projectRows.data.items[0], 'projectName')],
    }), '项目经营明细'],
    ['projectRows', ready({
      ...base.projectRows.data,
      projectOptions: [accessor(base.projectRows.data.projectOptions[0], 'projectName')],
    }), '项目经营明细'],
  ]

  for (const [key, block, label] of cases) {
    const markup = render(ExecutiveDashboardPage, {
      model: dashboardModel({ [key]: block }), filters, viewerName: '安全校验员',
    })
    assert.match(markup, new RegExp(`${label}数据格式异常`, 'u'), key)
  }
  assert.equal(getterReads, 0)
})

test('real page controls emit merged filters and only authorized alerts navigate', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const filterCalls = []
  const navigationCalls = []
  const baseModel = dashboardModel()
  const model = dashboardModel({
    alerts: ready([
      ...baseModel.alerts.data,
      {
        id: 'contract:review', type: 'contract_review', severity: 'warning',
        title: '合同待复核', reason: '需要复核合同收入。', count: 1, amount: null,
        targetView: 'contractRevenue', canNavigate: true, recordRef: 'P1',
      },
      {
        id: 'rogue:target', type: 'rogue', severity: 'warning',
        title: '未知目标', reason: '不得导航。', count: 1, amount: 987654,
        targetView: 'not-a-route', canNavigate: true, recordRef: 'PRIVATE-ROUTE',
      },
    ]),
  })
  const tree = ExecutiveDashboardPage({
    model,
    filters,
    viewerName: '操作员',
    onFiltersChange: (next) => filterCalls.push(next),
    onNavigate: (target) => navigationCalls.push(target),
  })
  const elements = materializedElements(tree)
  const control = (id) => elements.find((element) => element.props?.['data-testid'] === id)

  control('dashboard-project-filter').props.onChange({ target: { value: 'P3' } })
  control('dashboard-month-filter').props.onChange({ target: { value: '2026-06' } })
  control('dashboard-ranking-filter').props.onChange({ target: { value: 'margin' } })
  control('dashboard-next-page').props.onClick()
  control('dashboard-alert-action-purchase:current-payable').props.onClick()
  control('dashboard-alert-action-contract:review').props.onClick()

  assert.deepEqual(filterCalls.map((call) => ({
    projectId: call.projectId,
    selectedMonth: call.selectedMonth,
    rankingMetric: call.rankingMetric,
    page: call.page,
  })), [
    { projectId: 'P3', selectedMonth: '2026-07', rankingMetric: 'profit', page: 1 },
    { projectId: 'P1', selectedMonth: '2026-06', rankingMetric: 'profit', page: 1 },
    { projectId: 'P1', selectedMonth: '2026-07', rankingMetric: 'margin', page: 1 },
    { projectId: 'P1', selectedMonth: '2026-07', rankingMetric: 'profit', page: 2 },
  ])
  assert.deepEqual(navigationCalls, ['purchase', 'contractRevenue'])
  assert.equal(control('dashboard-alert-action-source:inventory'), undefined)
  assert.equal(control('dashboard-alert-action-rogue:target'), undefined)

  const modelMarkup = render(ExecutiveDashboardPage, {
    model, filters, viewerName: '操作员', onNavigate() {},
  })
  assert.match(modelMarkup, /<option value="P3">大阪设备更新<\/option>/u)
  assert.doesNotMatch(modelMarkup, /987,654|PRIVATE-ROUTE/u)

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

test('full-access Task 8 model navigates its registered tool alert and still rejects a rogue target', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const actualModel = actualFullAccessDashboardModel()
  const toolAlert = actualModel.alerts.data.find((alert) => alert.type === 'tool_responsibility')
  assert.ok(toolAlert)
  assert.equal(toolAlert.canNavigate, true)
  assert.equal(toolAlert.targetView, 'toolBorrow')

  const model = {
    ...actualModel,
    alerts: {
      ...actualModel.alerts,
      data: [...actualModel.alerts.data, {
        id: 'rogue:actual-model', type: 'rogue', severity: 'warning',
        title: '伪造实际模型目标', reason: '不得导航。', count: 1, amount: 765432,
        targetView: 'tools', canNavigate: true, recordRef: 'ROGUE-ACTUAL-REF',
      }],
    },
  }
  const navigationCalls = []
  const tree = ExecutiveDashboardPage({
    model,
    filters,
    viewerName: '实际模型校验员',
    onNavigate: (target) => navigationCalls.push(target),
  })
  const elements = materializedElements(tree)
  const control = (id) => elements.find((element) => element.props?.['data-testid'] === id)
  const toolAction = control(`dashboard-alert-action-${toolAlert.id}`)

  assert.ok(toolAction)
  toolAction.props.onClick()
  assert.deepEqual(navigationCalls, ['toolBorrow'])
  assert.equal(control('dashboard-alert-action-rogue:actual-model'), undefined)

  const markup = render(ExecutiveDashboardPage, { model, filters, viewerName: '实际模型校验员' })
  assert.match(markup, /工具赔偿待处理/u)
  assert.doesNotMatch(markup, /765,432|ROGUE-ACTUAL-REF/u)
})

test('filter callbacks emit only normalized canonical filter state', () => {
  const { ExecutiveDashboardPage } = moduleFor('page')
  const calls = []
  const tree = ExecutiveDashboardPage({
    model: dashboardModel(),
    filters: {
      projectId: 'UNKNOWN', projectStatus: '未知', rankingMetric: 'unsafe',
      selectedMonth: '2026-13', page: 0, pageSize: 101, extraSecret: 'do-not-copy',
    },
    viewerName: '筛选校验员',
    onFiltersChange: (next) => calls.push(next),
  })
  const elements = materializedElements(tree)
  const control = (id) => elements.find((element) => element.props?.['data-testid'] === id)

  control('dashboard-project-filter').props.onChange({ target: { value: 'P3' } })
  control('dashboard-project-filter').props.onChange({ target: { value: 'PRIVATE' } })
  control('dashboard-month-filter').props.onChange({ target: { value: '2026-02' } })
  control('dashboard-month-filter').props.onChange({ target: { value: '2026-13' } })
  control('dashboard-status-filter').props.onChange({ target: { value: '进行中' } })
  control('dashboard-status-filter').props.onChange({ target: { value: '伪造状态' } })
  control('dashboard-ranking-filter').props.onChange({ target: { value: 'margin' } })
  control('dashboard-ranking-filter').props.onChange({ target: { value: '伪造口径' } })

  assert.deepEqual(calls, [
    { projectId: 'P3', projectStatus: 'all', rankingMetric: 'profit', selectedMonth: '2026-07', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', selectedMonth: '2026-07', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', selectedMonth: '2026-02', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', selectedMonth: '2026-07', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: '进行中', rankingMetric: 'profit', selectedMonth: '2026-07', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', selectedMonth: '2026-07', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'margin', selectedMonth: '2026-07', page: 1, pageSize: 10 },
    { projectId: 'all', projectStatus: 'all', rankingMetric: 'profit', selectedMonth: '2026-07', page: 1, pageSize: 10 },
  ])
  for (const call of calls) {
    assert.deepEqual(Object.keys(call), [
      'projectId', 'projectStatus', 'rankingMetric', 'selectedMonth', 'page', 'pageSize',
    ])
  }

  const hundredCalls = []
  const validTree = ExecutiveDashboardPage({
    model: dashboardModel(),
    filters: { ...filters, pageSize: 100 },
    onFiltersChange: (next) => hundredCalls.push(next),
  })
  const validElements = materializedElements(validTree)
  validElements.find((element) => element.props?.['data-testid'] === 'dashboard-month-filter')
    .props.onChange({ target: { value: '2026-06' } })
  assert.equal(hundredCalls[0].pageSize, 100)
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
  assert.match(pageSource, /import\s+\{\s*getAdminRoute\s*\}\s+from\s+'\.\.\/\.\.\/navigation\/adminRoutes\.js'/u)
  assert.ok(cssSource.length > 0)
  const root = postcss.parse(cssSource, { from: 'executiveDashboard.css' })
  const rules = []
  root.walkRules((rule) => {
    rules.push(rule)
    for (const selector of rule.selectors) {
      assert.match(selector.trim(), /^\.erp-black-gold(?:\b|\s|\.|:|\[)/u)
    }
  })
  assert.ok(rules.length > 0)

  const colorProperty = /^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?|outline|box-shadow|text-shadow|fill|stroke)$/u
  root.walkDecls((declaration) => {
    if (!colorProperty.test(declaration.prop)) return
    assert.doesNotMatch(declaration.value, /(?:^|\W)(?:linear|radial|conic)-gradient\s*\(/iu)
    assert.ok(
      declaration.value.trim() === 'none' || declaration.value.includes('var('),
      `${declaration.prop} must use a CSS variable: ${declaration.value}`,
    )
  })

  const mediaParams = []
  root.walkAtRules((atRule) => {
    assert.equal(atRule.name, 'media')
    mediaParams.push(atRule.params.replace(/\s+/gu, ' ').trim())
  })
  assert.deepEqual(mediaParams.sort(), [
    '(max-width: 767px)',
    '(min-width: 1024px)',
    '(min-width: 768px) and (max-width: 1023px)',
  ].sort())

  const desktopGrid = rules.find((rule) =>
    rule.selectors.includes('.erp-black-gold .executive-dashboard-grid') &&
      rule.parent?.type === 'atrule' && rule.parent.params === '(min-width: 1024px)')
  assert.ok(desktopGrid)
  assert.equal(
    desktopGrid.nodes.find((node) => node.type === 'decl' && node.prop === 'grid-template-columns')?.value,
    'repeat(12, minmax(0, 1fr))',
  )

  const scrollRules = rules.filter((rule) =>
    rule.selectors.some((selector) =>
      /\.executive-(?:chart|project)-table-scroll\b/u.test(selector)))
  assert.ok(scrollRules.length > 0)
  for (const rule of scrollRules) {
    const declarations = new Map(
      rule.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]),
    )
    assert.notEqual(declarations.get('max-height'), '1px')
    assert.notEqual(declarations.get('overflow'), 'hidden')
  }
})

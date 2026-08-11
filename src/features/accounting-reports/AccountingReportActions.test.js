import assert from 'node:assert/strict'
import { act, createElement, StrictMode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test, { after } from 'node:test'
import { createServer } from 'vite'

import { createAccountingReportModel } from './accountingReportModel.js'
import {
  findWarehouseTestElement,
  installWarehouseReactDom,
} from '../warehouse/warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(), cacheDir: '/private/tmp/task3-accounting-actions-vite-cache',
  configFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true },
})
const loaded = await server.ssrLoadModule('/src/features/accounting-reports/AccountingReportActions.jsx')
after(() => server.close())
const AccountingReportActions = loaded.default

const report = createAccountingReportModel({
  id: 'summary-2026-07', title: '月度会计汇总', generatedAt: '2026-08-11 10:00',
  preparedBy: '会计甲', orientation: 'portrait', fileName: '月度会计汇总',
  filterLines: [{ label: '月份', value: '2026-07' }], recordCount: 1,
  summary: [{ label: '总额', value: 1000, format: 'money' }],
  sections: [{
    id: 'summary', title: '汇总明细', sheetName: '汇总明细',
    columns: [{ key: 'label', label: '项目' }, { key: 'amount', label: '金额', format: 'money', align: 'right' }],
    rows: [{ label: '材料费', amount: 1000 }],
  }], notes: [],
})

function button(container, label) {
  const found = findWarehouseTestElement(container, (element) =>
    element.nodeName === 'BUTTON' && element.textContent === label)
  assert.ok(found, `button ${label}`)
  return found
}

function portalRoot(document) {
  return findWarehouseTestElement(document.body, (element) =>
    element.className === 'accounting-report-print-root')
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function mount(props = {}, { strict = false } = {}) {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const render = async (overrides = {}) => {
    await act(async () => {
      const actions = createElement(AccountingReportActions, {
        report, contextIdentity: 'context-a', ...props, ...overrides,
      })
      root.render(strict ? createElement(StrictMode, null, actions) : actions)
    })
  }
  await render()
  return { dom, container, root, render }
}

test('StrictMode Excel invokes once, clears pending, and keeps its guard current', async () => {
  let calls = 0
  let capturedGuard
  const scenario = await mount({
    exportExcel: async (_currentReport, { outputGuard }) => {
      calls += 1
      capturedGuard = outputGuard
      assert.equal(outputGuard(), true)
    },
    printReport() {},
  }, { strict: true })
  try {
    await act(async () => { button(scenario.container, '导出 Excel').click() })
    assert.equal(calls, 1)
    assert.equal(capturedGuard(), true)
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
  } finally {
    await cleanup(scenario)
  }
})

test('StrictMode PDF and print each invoke once after mounting and clear pending', async () => {
  for (const label of ['导出 PDF', '打印']) {
    let calls = 0
    const scenario = await mount({
      exportExcel() {},
      printReport: () => {
        calls += 1
        assert.ok(portalRoot(scenario.dom.document), 'print sheet is mounted')
      },
    }, { strict: true })
    try {
      await act(async () => { button(scenario.container, label).click() })
      assert.equal(calls, 1)
      assert.equal(portalRoot(scenario.dom.document), null)
      assert.equal(button(scenario.container, label).disabled, false)
    } finally {
      await cleanup(scenario)
    }
  }
})

test('StrictMode still invalidates a stale Excel guard after a context change', async () => {
  const release = deferred()
  let downloads = 0
  let capturedGuard
  const scenario = await mount({
    exportExcel: async (_currentReport, { outputGuard }) => {
      capturedGuard = outputGuard
      await release.promise
      if (outputGuard()) downloads += 1
    },
    printReport() {},
  }, { strict: true })
  try {
    await act(async () => { button(scenario.container, '导出 Excel').click() })
    assert.equal(capturedGuard(), true)
    await scenario.render({ contextIdentity: 'context-b' })
    assert.equal(capturedGuard(), false)
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    release.resolve()
    await act(async () => { await release.promise })
    assert.equal(downloads, 0)
  } finally {
    release.resolve()
    await cleanup(scenario)
  }
})

async function cleanup(scenario) {
  await act(async () => { scenario.root.unmount() })
  scenario.dom.cleanup()
}

test('action controller exposes the three plain-language output choices and their PDF guidance', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportActions, {
    report, contextIdentity: 'static', exportExcel() {}, printReport() {},
  }))
  for (const text of ['导出 Excel', '导出 PDF', '打印', '在打印窗口选择“另存为 PDF”']) {
    assert.match(html, new RegExp(text, 'u'), text)
  }
})

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

test('shows the current-page scope when the report is unavailable', () => {
  const html = renderToStaticMarkup(createElement(AccountingReportActions, {
    title: '工资记录报表', contextIdentity: 'unavailable',
    exportExcel() {}, printReport() {},
  }))
  assert.match(html, /跟随当前页面筛选条件输出/u)
})

test('disabled state blocks every report output action', async () => {
  let calls = 0
  const scenario = await mount({
    disabled: true,
    exportExcel: async () => { calls += 1 },
    printReport: async () => { calls += 1 },
  })
  try {
    for (const label of ['导出 Excel', '导出 PDF', '打印']) {
      assert.equal(button(scenario.container, label).disabled, true)
      button(scenario.container, label).click()
    }
    await act(async () => {})
    assert.equal(calls, 0)
    assert.equal(portalRoot(scenario.dom.document), null)
  } finally {
    await cleanup(scenario)
  }
})

test('Excel receives one click-time frozen snapshot and an output guard while all actions are pending', async () => {
  const completion = deferred()
  let received
  let guard
  let nowCalls = 0
  const scenario = await mount({
    now: () => {
      nowCalls += 1
      return new Date('2026-08-12T03:04:05.678Z')
    },
    exportExcel: async (currentReport, options) => {
      received = currentReport
      guard = options.outputGuard
      await completion.promise
    },
    printReport() {},
  })
  try {
    await act(async () => { button(scenario.container, '导出 Excel').click() })
    assert.notEqual(received, report)
    assert.equal(Object.isFrozen(received), true)
    assert.equal(nowCalls, 1)
    assert.equal(report.generatedAt, '2026-08-11 10:00')
    assert.equal(received.generatedAt, '2026-08-12T03:04:05.678Z')
    assert.equal(received.fileName, '月度会计汇总_2026-08-12')
    assert.equal(received.preparedBy, '会计甲')
    assert.equal(received.recordCount, 1)
    assert.equal(typeof guard, 'function')
    assert.equal(guard(), true)
    for (const label of ['导出 Excel', '导出 PDF', '打印']) {
      assert.equal(button(scenario.container, label).disabled, true)
    }
    completion.resolve()
    await act(async () => { await completion.promise })
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
  } finally {
    await cleanup(scenario)
  }
})

test('PDF and print mount their click-time snapshot before invoking the shared print dependency', async () => {
  for (const label of ['导出 PDF', '打印']) {
    let calls = 0
    let nowCalls = 0
    const scenario = await mount({
      exportExcel() {},
      now: () => {
        nowCalls += 1
        return new Date('2026-08-12T03:04:05.678Z')
      },
      printReport: () => {
        calls += 1
        const root = portalRoot(scenario.dom.document)
        assert.ok(root, 'print sheet is mounted')
        assert.match(root.textContent, /月度会计汇总/u)
        assert.match(root.textContent, /2026-08-12T03:04:05\.678Z/u)
      },
    })
    try {
      await act(async () => { button(scenario.container, label).click() })
      assert.equal(calls, 1)
      assert.equal(nowCalls, 1)
      assert.equal(portalRoot(scenario.dom.document), null)
    } finally {
      await cleanup(scenario)
    }
  }
})

test('a context change invalidates an unfinished Excel output and clears pending state', async () => {
  const release = deferred()
  let downloads = 0
  let capturedGuard
  const scenario = await mount({
    exportExcel: async (_currentReport, { outputGuard }) => {
      capturedGuard = outputGuard
      await release.promise
      if (outputGuard()) downloads += 1
    },
    printReport() {},
  })
  try {
    await act(async () => { button(scenario.container, '导出 Excel').click() })
    assert.equal(capturedGuard(), true)
    await scenario.render({ contextIdentity: 'context-b' })
    assert.equal(capturedGuard(), false)
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
    release.resolve()
    await act(async () => { await release.promise })
    assert.equal(downloads, 0)
  } finally {
    release.resolve()
    await cleanup(scenario)
  }
})

test('a context change in the click turn prevents a stale print and leaves actions usable', async () => {
  let prints = 0
  const scenario = await mount({ exportExcel() {}, printReport: () => { prints += 1 } })
  try {
    await act(async () => {
      button(scenario.container, '打印').click()
      scenario.root.render(createElement(AccountingReportActions, {
        report, contextIdentity: 'context-b', exportExcel() {}, printReport: () => { prints += 1 },
      }))
    })
    assert.equal(prints, 0)
    assert.equal(portalRoot(scenario.dom.document), null)
    assert.equal(button(scenario.container, '打印').disabled, false)
  } finally {
    await cleanup(scenario)
  }
})

test('current-generation failures preserve context and report the shared error message', async () => {
  const errors = []
  const scenario = await mount({
    exportExcel: async () => { throw new Error('writer failed') },
    printReport() {},
    onError: (message) => errors.push(message),
  })
  try {
    await act(async () => { button(scenario.container, '导出 Excel').click() })
    assert.deepEqual(errors, ['报表生成失败，当前页面和筛选已保留'])
    assert.equal(button(scenario.container, '导出 Excel').disabled, false)
  } finally {
    await cleanup(scenario)
  }
})

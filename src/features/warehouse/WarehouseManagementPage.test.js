import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from './warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const warehouseId = '10000000-0000-4000-8000-000000000001'
const sharedWarehouseId = '10000000-0000-4000-8000-000000000002'
const locationId = '20000000-0000-4000-8000-000000000001'
const sharedLocationId = '20000000-0000-4000-8000-000000000002'
const variantA = '30000000-0000-4000-8000-000000000001'
const variantB = '30000000-0000-4000-8000-000000000002'

const snapshot = Object.freeze({
  catalog: Object.freeze({
    items: Object.freeze([
      Object.freeze({ id: '40000000-0000-4000-8000-000000000001', name: '铜管', category: '材料', active: true }),
    ]),
    variants: Object.freeze([
      Object.freeze({ id: variantA, itemId: '40000000-0000-4000-8000-000000000001', sku: 'CU-6', model: 'R410A', size: '6mm', unit: '米', minimumStock: 3, active: true }),
      Object.freeze({ id: variantB, itemId: '40000000-0000-4000-8000-000000000001', sku: 'TOOL-1', model: '共享', size: '', unit: '把', minimumStock: 1, active: true }),
    ]),
  }),
  locations: Object.freeze({
    sites: Object.freeze([
      Object.freeze({ id: warehouseId, code: 'MAIN', name: '本社仓', kind: 'normal', active: true }),
      Object.freeze({ id: sharedWarehouseId, code: 'TOOLS', name: '共享工具仓位', kind: 'shared_tool', active: true }),
    ]),
    locations: Object.freeze([
      Object.freeze({ id: locationId, warehouseId, shelfCode: 'A-01', shelfName: '一号架', active: true }),
      Object.freeze({ id: sharedLocationId, warehouseId: sharedWarehouseId, shelfCode: 'T-01', shelfName: '工具架', active: true }),
    ]),
  }),
  balances: Object.freeze([
    Object.freeze({ variantId: variantA, warehouseId, locationId, quantity: 2, unitCost: 90, stockValue: 180 }),
    Object.freeze({ variantId: variantB, warehouseId: sharedWarehouseId, locationId: sharedLocationId, quantity: 5, unitCost: 40, stockValue: 200 }),
  ]),
  receiptRows: Object.freeze([]),
  context: Object.freeze({ stockOutRequests: Object.freeze([]), returnRequests: Object.freeze([]), minorWorkOrders: Object.freeze([]) }),
})

async function loadWarehouseModules() {
  const server = await createServer({
    root: process.cwd(), configFile: false, logLevel: 'silent', appType: 'custom',
    cacheDir: '/private/tmp/codex-warehouse-management-vite-cache',
    server: { middlewareMode: true },
  })
  try {
    const [page, overview, operations] = await Promise.all([
      server.ssrLoadModule('/src/features/warehouse/WarehouseManagementPage.jsx'),
      server.ssrLoadModule('/src/features/warehouse/WarehouseOverview.jsx'),
      server.ssrLoadModule('/src/features/warehouse/WarehouseOperations.jsx'),
    ])
    return { page, overview, operations }
  }
  finally { await server.close() }
}

test('overview uses authoritative snapshots and redacts cost without permission', async () => {
  const { overview: { buildWarehouseOverviewModel } } = await loadWarehouseModules()
  const redacted = buildWarehouseOverviewModel(snapshot, false)
  assert.deepEqual(redacted.summary, { totalSku: 2, totalQuantity: 7, lowStockSku: 1, stockValue: null })
  assert.equal(redacted.locations.find((row) => row.siteId === sharedWarehouseId).kindLabel, '共享工具仓位')
  assert.equal(JSON.stringify(redacted).includes('180'), false)

  const allowed = buildWarehouseOverviewModel(snapshot, true)
  assert.equal(allowed.summary.stockValue, 380)
  assert.equal(Object.isFrozen(allowed), true)
})

test('second-version warehouse page exposes exactly five task tabs and preview is display-only', async () => {
  const { page: { default: WarehouseManagementPage, isWarehousePreviewEnabled } } = await loadWarehouseModules()
  const access = Object.freeze({
    page: true, manageCatalog: true, confirmStockFlow: true, transfer: true,
    stocktake: true, viewCost: false, exportReports: false,
  })
  assert.equal(isWarehousePreviewEnabled(true, 'true'), true)
  assert.equal(isWarehousePreviewEnabled(true, 'TRUE'), false)
  assert.equal(isWarehousePreviewEnabled(false, 'true'), false)

  const html = renderToStaticMarkup(createElement(WarehouseManagementPage, {
    access, initialSnapshot: snapshot, preview: true,
    warehouseService: {}, warehouseConfirmationService: {}, warehouseMediaService: {},
  }))
  for (const label of ['库存总览', '物品档案', '出入库作业', '月度盘点', '报表打印']) {
    assert.match(html, new RegExp(label, 'u'))
  }
  assert.match(html, /第二版 \+ 仓库移植测试/u)
  assert.equal((html.match(/role="tab"/gu) || []).length, 5)
})

test('authoritative page loader includes pending purchase receipt line identities only for receipt confirmers', async () => {
  const { page: { loadWarehouseSnapshot } } = await loadWarehouseModules()
  const calls = []
  const receiptRows = [{ receiptId: 'R1', receiptLineId: 'RL1' }]
  const warehouseService = {
    async listCatalog() { return snapshot.catalog },
    async listLocations() { return snapshot.locations },
    async listBalances(filters) { calls.push(['balances', filters]); return snapshot.balances },
    async listReport(type, filters) { calls.push(['report', type, filters]); return { rows: receiptRows } },
  }
  const warehouseConfirmationService = {
    async listRequestContext() { return snapshot.context },
  }
  const result = await loadWarehouseSnapshot({
    access: { confirmReceipt: true }, warehouseService, warehouseConfirmationService,
  })
  assert.equal(result.receiptRows, receiptRows)
  assert.deepEqual(calls, [
    ['balances', { page: 1, pageSize: 500 }],
    ['report', 'receipts', { status: 'pending', page: 1, pageSize: 500 }],
  ])

  calls.length = 0
  const viewerResult = await loadWarehouseSnapshot({
    access: { confirmReceipt: false }, warehouseService, warehouseConfirmationService,
  })
  assert.deepEqual(viewerResult.receiptRows, [])
  assert.deepEqual(calls, [['balances', { page: 1, pageSize: 500 }]])
})

test('warehouse management stays a lazy production root and does not import old persistence or tool-borrow mutation code', async () => {
  const [page, catalog, app] = await Promise.all([
    readFile(new URL('./WarehouseManagementPage.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./WarehouseCatalog.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../../App.jsx', import.meta.url), 'utf8'),
  ])
  assert.match(page, /lazy\(\(\)\s*=>\s*import\(['"]\.\/WarehouseCatalog\.jsx['"]\)\)/u)
  assert.match(page, /lazy\(\(\)\s*=>\s*import\(['"]\.\/WarehouseReports\.jsx['"]\)\)/u)
  assert.match(app, /lazy\(\(\)\s*=>\s*import\(['"]\.\/features\/warehouse\/WarehouseManagementPage\.jsx['"]\)\)/u)
  assert.doesNotMatch(`${page}\n${catalog}`, /warehousePersistence|toolBorrowRecords|commitToolBorrow/u)
})

test('warehouse operation fence preserves document and line identities for an exact network retry', async () => {
  const { operations: { createWarehouseOperationFence } } = await loadWarehouseModules()
  let sequence = 0
  const fence = createWarehouseOperationFence(() => `id-${++sequence}`)
  const first = fence.acquire('stocktake', 'same-payload', 2)
  const retry = fence.acquire('stocktake', 'same-payload', 2)
  assert.equal(retry, first)
  assert.deepEqual(first, {
    fingerprint: 'same-payload',
    idempotencyKey: 'stocktake:id-1',
    documentId: 'id-2',
    lineIds: ['id-3', 'id-4'],
  })

  const corrected = fence.acquire('stocktake', 'corrected-payload', 2)
  assert.notEqual(corrected, first)
  fence.complete('stocktake', first)
  assert.equal(fence.acquire('stocktake', 'corrected-payload', 2), corrected)
  fence.complete('stocktake', corrected)
  assert.notEqual(fence.acquire('stocktake', 'corrected-payload', 2), corrected)
})

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function operationForm(root, heading) {
  return elements(root, (element) =>
    element.nodeName === 'FORM' && element.textContent.includes(heading))[0]
}

function operationField(root, label) {
  const wrapper = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))[0]
  return elements(wrapper, (element) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.nodeName))[0]
}

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

test('transfer and whole-document reversal call only authoritative confirmation service then refresh snapshots', async () => {
  const { operations: { default: WarehouseOperations } } = await loadWarehouseModules()
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const calls = []
  let refreshes = 0
  const service = {
    async confirmTransfer(input) { calls.push(['transfer', input]); return {} },
    async reverseOperation(input) { calls.push(['reverse', input]); return {} },
  }
  try {
    await act(async () => { root.render(createElement(WarehouseOperations, {
      snapshot,
      access: { transfer: true, confirmStockFlow: true },
      warehouseConfirmationService: service,
      onChanged: async () => { refreshes += 1 },
    })) })

    const transferForm = operationForm(container, '仓间/货架调拨')
    await change(operationField(transferForm, '调拨原因'), '货架整理')
    await act(async () => { transferForm.dispatchEvent(new TestEvent('submit')) })
    assert.equal(calls[0][0], 'transfer')
    assert.equal(calls[0][1].sourceWarehouseId, warehouseId)
    assert.equal(calls[0][1].destinationWarehouseId, sharedWarehouseId)
    assert.equal(calls[0][1].reason, '货架整理')
    assert.equal(refreshes, 1)

    const reversalForm = operationForm(container, '整单冲销')
    await change(operationField(reversalForm, '原单编号'), '50000000-0000-4000-8000-000000000001')
    await change(operationField(reversalForm, '冲销原因'), '整单录入错误')
    await act(async () => { reversalForm.dispatchEvent(new TestEvent('submit')) })
    assert.equal(calls[1][0], 'reverse')
    assert.equal(calls[1][1].sourceDocumentType, 'warehouse_stock_out')
    assert.equal(calls[1][1].reason, '整单录入错误')
    assert.equal(refreshes, 2)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('warehouse receipt confirmer selects the actual shelf before purchase arrival increases stock', async () => {
  const { operations: { default: WarehouseOperations } } = await loadWarehouseModules()
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const calls = []
  let refreshes = 0
  const receiptLineId = '60000000-0000-4000-8000-000000000001'
  const receiptId = '60000000-0000-4000-8000-000000000002'
  const receiptSnapshot = {
    ...snapshot,
    receiptRows: [{
      receiptId, receiptLineId, purchaseRecordKey: 'PURCHASE-1',
      variantId: variantA, itemName: '铜管', sku: 'CU-6', model: 'R410A',
      quantity: 3, unit: '米',
    }],
  }
  try {
    await act(async () => { root.render(createElement(WarehouseOperations, {
      snapshot: receiptSnapshot,
      access: { confirmReceipt: true },
      warehouseConfirmationService: {
        async confirmReceipt(input) { calls.push(input); return {} },
      },
      onChanged: async () => { refreshes += 1 },
    })) })
    const receiptCard = elements(container, (element) =>
      element.className.split(/\s+/u).includes('warehouse-receipt-card'))[0]
    await change(operationField(receiptCard, '确认入库货架'), locationId)
    const confirm = elements(receiptCard, (element) =>
      element.nodeName === 'BUTTON' && element.textContent.includes('确认采购入库'))[0]
    await act(async () => { confirm.click() })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].receiptId, receiptId)
    assert.deepEqual(calls[0].lines, [{
      receiptLineId, confirmedQuantity: 3, warehouseId, locationId,
    }])
    assert.equal(refreshes, 1)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

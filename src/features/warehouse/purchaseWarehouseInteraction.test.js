import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import test from 'node:test'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from './warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

async function loadArrivalComponents() {
  const server = await createServer({
    root: process.cwd(), configFile: false, logLevel: 'silent', appType: 'custom',
    plugins: [{
      name: 'purchase-arrival-interaction-export',
      enforce: 'pre',
      resolveId(source) {
        return source === 'leaflet' ? '\0purchase-arrival-leaflet-stub' : null
      },
      load(id) {
        if (id !== '\0purchase-arrival-leaflet-stub') return null
        return 'export default { icon: () => ({}) }'
      },
      transform(code, id) {
        if (!id.endsWith('/src/App.jsx')) return null
        return code
          .replace(
            "import { useCallback, useEffect, useMemo, useRef, useState } from 'react'",
            "import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'",
          )
          .replace(
            'function PurchaseListSection({',
            'export function PurchaseListSection({',
          )
          .replace(
            'function PurchaseStockInSection({',
            'export function PurchaseStockInSection({',
          )
          .replace(
            'function PurchaseSummarySection({',
            'export function PurchaseSummarySection({',
          )
      },
    }],
    ssr: { noExternal: ['leaflet'] },
    server: { middlewareMode: true },
  })
  try { return await server.ssrLoadModule('/src/App.jsx') }
  finally { await server.close() }
}

const {
  PurchaseListSection,
  PurchaseStockInSection,
  PurchaseSummarySection,
} = await loadArrivalComponents()

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function field(root, label) {
  const wrapper = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))[0]
  return elements(wrapper, (element) => ['INPUT', 'SELECT'].includes(element.nodeName))[0]
}

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

async function submit(form) {
  await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

const purchase = {
  purchaseId: 'PO-001', purchaseStatus: '正常', itemName: '空调铜管',
  purchaseSource: '日本采购', platform: '线下采购', purchaseType: '材料',
  projectId: '', paymentStatus: '未付款', arrivalStatus: '已到货',
  purchaseDate: '2026-08-09', supplierName: '测试供应商', quantity: 5,
  unit: '米', currency: 'JPY', originalAmount: 500, totalCost: 500,
  unpaidAmount: 500, projectName: '', employeeName: '采购员',
}
const variant = {
  id: '84000000-0000-4000-8000-000000000001',
  itemId: '85000000-0000-4000-8000-000000000001',
  itemName: '空调铜管', sku: 'CU-001', model: 'R410A', size: '9mm',
  material: '铜', unit: '米',
}
const readyContext = {
  status: 'ready', variants: [variant], purchases: [{
    purchaseRecordKey: 'PO-001', orderedQuantity: 5, pendingQuantity: 0,
    confirmedQuantity: 0, remainingQuantity: 5, hasReceipt: false,
  }],
}

test('arrival loading/error UI disables controls and never labels unknown data as unstocked', async () => {
  const dom = installWarehouseReactDom()
  const listContainer = dom.createContainer()
  const formContainer = dom.createContainer()
  const listRoot = createRoot(listContainer)
  const formRoot = createRoot(formContainer)
  try {
    await act(async () => { listRoot.render(createElement(PurchaseListSection, {
      projects: [], records: [purchase], setRecords() {}, paymentRecords: [],
      stockInRecords: [], arrivalPurchases: [], arrivalContextStatus: 'loading',
      access: { update: false, delete: false }, paymentVisible: false,
    })) })
    assert.match(listContainer.textContent, /状态暂不可用/u)
    assert.doesNotMatch(listContainer.textContent, /入库状态未入库/u)
    assert.equal(field(listContainer, '入库状态').disabled, true)

    await act(async () => { formRoot.render(createElement(PurchaseStockInSection, {
      access: { create: true }, purchaseRecords: [purchase],
      arrivalContext: { status: 'error', variants: [], purchases: [] },
      arrivalBridge: { submitWarehouseArrival: async () => assert.fail('must stay disabled') },
      onRefreshArrivalContext: async () => assert.fail('must not refresh'),
    })) })
    assert.match(formContainer.textContent, /仓库到货状态暂不可用/u)
    assert.equal(field(formContainer, '采购记录').disabled, true)
    assert.equal(field(formContainer, '仓库物品型号').disabled, true)
    assert.equal(field(formContainer, '本次到货数量').disabled, true)
    assert.equal(elements(formContainer, (element) =>
      element.nodeName === 'BUTTON' && element.getAttribute('type') === 'submit')[0].disabled, true)
  } finally {
    await act(async () => { listRoot.unmount(); formRoot.unmount() })
    dom.cleanup()
  }
})

test('purchase summary uses authoritative arrival status and fails closed when it is unavailable', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const statusCard = (label) => elements(container, (element) =>
    element.className.split(/\s+/u).includes('stat-card') &&
    element.textContent.endsWith(label))[0]
  try {
    await act(async () => { root.render(createElement(PurchaseSummarySection, {
      purchaseRecords: [purchase],
      stockInRecords: [{ sourcePurchaseId: 'PO-001', stockInQuantity: 5 }],
      inventoryItems: [], paymentVisible: false,
      arrivalContext: {
        ...readyContext,
        purchases: [{
          ...readyContext.purchases[0], pendingQuantity: 2, remainingQuantity: 3,
          hasReceipt: true,
        }],
      },
    })) })
    assert.equal(statusCard('未入库采购数量').textContent, '0未入库采购数量')
    assert.equal(statusCard('待仓库确认采购数量').textContent, '1待仓库确认采购数量')
    assert.equal(statusCard('部分入库采购数量').textContent, '0部分入库采购数量')
    assert.equal(statusCard('已入库采购数量').textContent, '0已入库采购数量')

    await act(async () => { root.render(createElement(PurchaseSummarySection, {
      purchaseRecords: [purchase], stockInRecords: [], inventoryItems: [],
      paymentVisible: false,
      arrivalContext: { status: 'error', variants: [], purchases: [] },
    })) })
    assert.match(container.textContent, /入库状态暂不可用/u)
    assert.equal(statusCard('未入库采购数量'), undefined)
    assert.equal(statusCard('待仓库确认采购数量'), undefined)
    assert.equal(statusCard('部分入库采购数量'), undefined)
    assert.equal(statusCard('已入库采购数量'), undefined)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('arrival interaction retries the same exact request and refreshes only after success', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const calls = []
  const errors = []
  const alerts = []
  let refreshes = 0
  const firstAttempt = deferred()
  const arrivalBridge = {
    async submitWarehouseArrival(input) {
      calls.push(input)
      if (calls.length === 1) return firstAttempt.promise
      return { id: 'receipt-1', status: 'pending' }
    },
  }
  try {
    window.alert = (message) => alerts.push(message)
    await act(async () => { root.render(createElement(PurchaseStockInSection, {
      access: { create: true }, purchaseRecords: [purchase], arrivalContext: readyContext,
      arrivalBridge, createIdempotencyId: () => 'stable-random-id',
      onPersistenceError: (error) => errors.push(error),
      onRefreshArrivalContext: async () => { refreshes += 1 },
    })) })
    await change(field(container, '采购记录'), 'PO-001')
    await change(field(container, '仓库物品型号'), variant.id)
    const quantityField = field(container, '本次到货数量')
    assert.equal(quantityField.getAttribute('min'), '0.001')
    assert.equal(quantityField.getAttribute('step'), '0.001')
    await change(quantityField, '2.125')
    const arrivalForm = elements(container, (element) => element.nodeName === 'FORM')[0]

    await submit(arrivalForm)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], {
      purchaseRecordKey: 'PO-001', variantId: variant.id,
      requestedQuantity: 2.125, idempotencyKey: 'arrival-stable-random-id',
    })
    assert.equal(field(container, '采购记录').disabled, true)
    assert.equal(field(container, '仓库物品型号').disabled, true)
    assert.equal(field(container, '本次到货数量').disabled, true)
    assert.equal(elements(container, (element) =>
      element.nodeName === 'BUTTON' && element.getAttribute('type') === 'submit')[0].disabled, true)
    await act(async () => { firstAttempt.reject(new Error('network down')) })
    await act(async () => {})
    assert.equal(refreshes, 0)
    assert.equal(errors.length, 1)
    assert.doesNotMatch(container.textContent, /当前库存尚未增加/u)
    assert.equal(field(container, '采购记录').value, 'PO-001')
    assert.equal(field(container, '本次到货数量').value, '2.125')

    await submit(arrivalForm)
    await act(async () => {})
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1], calls[0])
    assert.equal(refreshes, 1)
    assert.match(container.textContent, /等待仓库负责人确认；当前库存尚未增加/u)
    assert.doesNotMatch(container.textContent, /采购数量/u)

    await submit(arrivalForm)
    assert.equal(calls.length, 2)
    assert.match(alerts.at(-1), /请选择采购记录/u)
    await change(field(container, '采购记录'), 'PO-001')
    await submit(arrivalForm)
    assert.equal(calls.length, 2)
    assert.match(alerts.at(-1), /请选择仓库物品型号/u)
    await change(field(container, '仓库物品型号'), variant.id)
    await submit(arrivalForm)
    assert.equal(calls.length, 2)
    assert.match(alerts.at(-1), /到货数量必须大于 0/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

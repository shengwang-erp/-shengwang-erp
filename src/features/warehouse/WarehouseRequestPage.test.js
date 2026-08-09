import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'
import { installWarehouseReactDom, TestEvent } from './warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const server = await createServer({
  root: process.cwd(), configFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true },
})
const pageModule = await server.ssrLoadModule(
  '/src/features/warehouse/WarehouseRequestPage.jsx',
)
const {
  default: WarehouseRequestPage, tokyoDate, createDraftKeyStore, sumWarehouseQuantities,
} = pageModule
await server.close()

const catalog = {
  items: [{ id: 'i1', name: '铜管', category: '空调', brand: 'A厂', description: '', active: true }],
  variants: [{
    id: 'v1', itemId: 'i1', sku: 'CU-6', model: 'R410A', size: '6mm',
    material: '铜', unit: '米', minimumStock: 2, defaultPurchasePrice: null,
    systemQr: 'SWERP:VARIANT:v1', manufacturerQr: null, active: true,
  }],
}
const locations = {
  sites: [{ id: 'w1', name: '本社仓', code: 'MAIN', kind: 'normal', active: true }],
  locations: [{ id: 'l1', warehouseId: 'w1', shelfCode: 'A-01', shelfName: '一号架', active: true }],
}
const context = {
  stockOutRequests: [], returnRequests: [],
  minorWorkOrders: [{ id: 'm1', title: '未来社空调安装', customerName: '未来社', workDate: '2026-08-09', locationText: '东京', description: '', status: 'open', assignedProjectId: null, materialCost: null }],
}

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

function field(root, label) {
  const wrapper = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))[0]
  return elements(wrapper, (element) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName))[0]
}

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

test('request page exposes detailed warehouse-linked fields without the old generic free-text form', () => {
  const html = renderToStaticMarkup(createElement(WarehouseRequestPage, {
    mode: 'stockOut', projects: [{ projectId: 'P1', projectName: '正式项目' }],
    initialCatalog: catalog, initialLocations: locations, initialBalances: [],
    initialContext: context, viewCost: false, canRequest: true, canConfirm: false,
    warehouseService: {}, confirmationService: {},
  }))
  for (const label of ['物品与型号', '规格尺寸', '材质', '单位', '领用数量', '出库去向', '领用人', '用途说明', '扫描二维码']) {
    assert.match(html, new RegExp(label, 'u'))
  }
  assert.doesNotMatch(html, /材料名称/u)
  assert.doesNotMatch(html, /冻结成本|采购单价/u)
  assert.match(html, /小工事|公司内部使用/u)
})

test('return page is bound to remaining original issues and shows confirmer pending state', () => {
  const seeded = {
    ...context,
    stockOutRequests: [{
      id: 'so1', destinationType: 'project', projectId: 'P1', minorWorkOrderId: null,
      destinationNameSnapshot: '正式项目', purpose: '安装', receiver: '王师傅',
      requestDate: '2026-08-09', status: 'confirmed', submittedAt: '2026-08-09T00:00:00Z',
      lines: [{ id: 'sol1', variantId: 'v1', requestedQuantity: 3, confirmedQuantity: 3, remainingReturnable: 2, frozenTotalCost: 300 }],
    }],
    returnRequests: [{
      id: 'sr1', originalStockOutId: 'so1', destinationNameSnapshot: '正式项目',
      reason: '剩余', receiver: '仓库负责人', requestDate: '2026-08-09', status: 'pending',
      lines: [{ id: 'srl1', originalStockOutLineId: 'sol1', variantId: 'v1', requestedQuantity: 1, confirmedQuantity: null, frozenTotalCost: null }],
    }],
  }
  const html = renderToStaticMarkup(createElement(WarehouseRequestPage, {
    mode: 'stockReturn', projects: [], initialCatalog: catalog,
    initialLocations: locations, initialBalances: [], initialContext: seeded,
    viewCost: true, canRequest: true, canConfirm: true, warehouseService: {}, confirmationService: {},
  }))
  assert.match(html, /原出库单/u)
  assert.match(html, /剩余可退：2 米/u)
  assert.match(html, /原去向：正式项目/u)
  assert.match(html, /待仓库负责人确认/u)
  assert.match(html, /确认退回/u)
})

test('confirm-only warehouse user sees pending confirmation but no request controls', () => {
  const pending = {
    ...context,
    stockOutRequests: [{
      id: 'so-confirm-only', destinationType: 'internal_use', projectId: null,
      minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
      receiver: '王师傅', requestDate: '2026-08-09', status: 'pending',
      lines: [{ id: 'sol-confirm-only', variantId: 'v1', requestedQuantity: 2, confirmedQuantity: null, frozenTotalCost: null }],
    }], returnRequests: [],
  }
  const html = renderToStaticMarkup(createElement(WarehouseRequestPage, {
    mode: 'stockOut', projects: [], initialCatalog: catalog,
    initialLocations: locations,
    initialBalances: [{ variantId: 'v1', warehouseId: 'w1', locationId: 'l1', quantity: 5 }],
    initialContext: pending, viewCost: false, canRequest: false, canConfirm: true,
    warehouseService: {}, confirmationService: {},
  }))
  assert.match(html, /仓库负责人待确认/u)
  assert.match(html, /确认出库并扣减库存/u)
  assert.match(html, /驳回原因/u)
  assert.match(html, /驳回申请/u)
  assert.doesNotMatch(html, /新建出库申请|提交出库申请|扫描二维码|新建小工事/u)
})

test('formal-project selector adopts the first project after asynchronous project loading', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  try {
    const root = createRoot(container)
    const submissions = []
    const common = {
      mode: 'stockOut', initialCatalog: catalog, initialLocations: locations,
      initialBalances: [], initialContext: context, canRequest: true, canConfirm: false,
      currentUser: { name: '王师傅' },
      warehouseService: {
        submitStockOut: async (input) => { submissions.push(input); return { id: 'so-async' } },
      },
      confirmationService: {},
    }
    await act(async () => {
      root.render(createElement(WarehouseRequestPage, { ...common, projects: [] }))
    })
    assert.equal(field(container, '项目').value, '')

    await act(async () => {
      root.render(createElement(WarehouseRequestPage, {
        ...common,
        projects: [{ projectId: 'P-ASYNC', projectName: '异步载入项目' }],
      }))
    })
    const projectSelect = field(container, '项目')
    assert.equal(projectSelect.options[0].selected, true)
    await change(field(container, '用途说明'), '异步项目出库验证')
    const form = elements(container, (element) =>
      element.nodeName === 'FORM' && element.textContent.includes('提交出库申请'))[0]
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].projectId, 'P-ASYNC')
    await act(async () => { root.unmount() })
  } finally { dom.cleanup() }
})

test('request-only user keeps confirmed and rejected records visible with outcome details', () => {
  const history = {
    ...context,
    stockOutRequests: [
      {
        id: 'so-confirmed', destinationType: 'internal_use', projectId: null,
        minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
        receiver: '王师傅', requestDate: '2026-08-08', status: 'confirmed',
        confirmedAt: '2026-08-09T01:02:03+00:00', rejectionReason: null,
        lines: [{ id: 'sol-confirmed', variantId: 'v1', requestedQuantity: 1, confirmedQuantity: 1, remainingReturnable: 1, frozenTotalCost: null }],
      },
      {
        id: 'so-rejected', destinationType: 'internal_use', projectId: null,
        minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
        receiver: '李师傅', requestDate: '2026-08-09', status: 'rejected',
        confirmedByEmployeeProfileId: 'a5000000-0000-4000-8000-000000000002',
        confirmedAt: '2026-08-09T02:02:03+00:00', rejectionReason: '用途说明不足',
        lines: [{ id: 'sol-rejected', variantId: 'v1', requestedQuantity: 2, confirmedQuantity: null, remainingReturnable: 0, frozenTotalCost: null }],
      },
    ], returnRequests: [],
  }
  const html = renderToStaticMarkup(createElement(WarehouseRequestPage, {
    mode: 'stockOut', projects: [], initialCatalog: catalog, initialLocations: locations,
    initialBalances: [], initialContext: history, viewCost: false,
    canRequest: true, canConfirm: false, warehouseService: {}, confirmationService: {},
  }))
  assert.match(html, /我的申请进度/u)
  assert.match(html, /已确认/u)
  assert.match(html, /确认时间：2026-08-09T01:02:03\+00:00/u)
  assert.match(html, /已驳回/u)
  assert.match(html, /驳回原因：用途说明不足/u)
})

test('user with request and confirm permissions sees pending queue plus own history', () => {
  const profileId = 'a5000000-0000-4000-8000-000000000001'
  const seeded = {
    ...context,
    stockOutRequests: [
      {
        id: 'so-other-pending', destinationNameSnapshot: '他人申请', receiver: '李师傅',
        requestDate: '2026-08-09', status: 'pending',
        submittedByEmployeeProfileId: 'a5000000-0000-4000-8000-000000000002',
        lines: [{ id: 'sol-other', variantId: 'v1', requestedQuantity: 1, confirmedQuantity: null, remainingReturnable: 0, frozenTotalCost: null }],
      },
      {
        id: 'so-own-confirmed', destinationNameSnapshot: '自己的已确认申请', receiver: '王师傅',
        requestDate: '2026-08-08', status: 'confirmed', submittedByEmployeeProfileId: profileId,
        confirmedAt: '2026-08-09T01:00:00Z', rejectionReason: null,
        lines: [{ id: 'sol-own', variantId: 'v1', requestedQuantity: 1, confirmedQuantity: 1, remainingReturnable: 1, frozenTotalCost: null }],
      },
    ], returnRequests: [],
  }
  const html = renderToStaticMarkup(createElement(WarehouseRequestPage, {
    mode: 'stockOut', currentUser: { id: profileId }, projects: [],
    initialCatalog: catalog, initialLocations: locations, initialBalances: [],
    initialContext: seeded, canRequest: true, canConfirm: true,
    warehouseService: {}, confirmationService: {},
  }))
  assert.match(html, /仓库负责人待确认/u)
  assert.match(html, /他人申请/u)
  assert.match(html, /我的申请进度/u)
  assert.match(html, /自己的已确认申请/u)
})

test('Tokyo business date and draft idempotency keys survive retry and rotate only after success', () => {
  assert.equal(tokyoDate(new Date('2026-08-08T15:30:00Z')), '2026-08-09')
  let next = 0
  const keys = createDraftKeyStore(() => `key-${++next}`)
  assert.equal(keys.current('submit'), 'key-1')
  assert.equal(keys.current('submit'), 'key-1')
  keys.complete('submit')
  assert.equal(keys.current('submit'), 'key-2')
})

test('warehouse confirmer must choose an explicit shelf with its per-location quantity', () => {
  const pending = {
    ...context,
    stockOutRequests: [{
      id: 'so-pending', destinationType: 'internal_use', projectId: null,
      minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
      receiver: '王师傅', requestDate: '2026-08-09', status: 'pending',
      lines: [{ id: 'sol-pending', variantId: 'v1', requestedQuantity: 2, confirmedQuantity: null, frozenTotalCost: null }],
    }], returnRequests: [],
  }
  const html = renderToStaticMarkup(createElement(WarehouseRequestPage, {
    mode: 'stockOut', projects: [], initialCatalog: catalog, initialLocations: locations,
    initialBalances: [{ variantId: 'v1', warehouseId: 'w1', locationId: 'l1', quantity: 5 }],
    initialContext: pending, viewCost: false, canRequest: true, canConfirm: true,
    warehouseService: {}, confirmationService: {},
  }))
  assert.match(html, /确认货架区/u)
  assert.match(html, /本社仓 · A-01 一号架 · 可用 5 米/u)
  assert.match(html, /库存分布/u)
})

test('minor-work creation stays collapsed until that destination is selected', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(WarehouseRequestPage, {
      mode: 'stockOut', projects: [], initialCatalog: catalog, initialLocations: locations,
      initialBalances: [], initialContext: context, viewCost: false,
      canRequest: true, canConfirm: false, warehouseService: {}, confirmationService: {},
    })) })
    assert.doesNotMatch(container.textContent, /新建小工事/u)
    await change(field(container, '出库去向'), 'minor_work_order')
    for (const text of ['新建小工事', '客户名称', '工作日期', '作业地点', '工作说明']) {
      assert.match(container.textContent, new RegExp(text, 'u'))
    }
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('minor-work outbound submits the exact authoritative customer-title snapshot', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const submissions = []
  try {
    await act(async () => { root.render(createElement(WarehouseRequestPage, {
      mode: 'stockOut', projects: [], currentUser: { name: '王师傅' },
      initialCatalog: catalog, initialLocations: locations, initialBalances: [],
      initialContext: context, canRequest: true, canConfirm: false,
      warehouseService: { submitStockOut: async (input) => { submissions.push(input); return { id: 'so-minor' } } },
      confirmationService: {},
    })) })
    await change(field(container, '出库去向'), 'minor_work_order')
    await change(field(container, '用途说明'), '空调安装')
    const form = elements(container, (element) =>
      element.nodeName === 'FORM' && element.textContent.includes('提交出库申请'))[0]
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
    assert.equal(submissions.length, 1)
    assert.equal(submissions[0].minorWorkOrderId, 'm1')
    assert.equal(submissions[0].destinationNameSnapshot, '未来社・未来社空调安装')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('DOM flow loads the selected variant photo and reuses submit idempotency after network failure', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const submissions = []
  const warehouseService = {
    async submitStockOut(input) {
      submissions.push(input)
      if (submissions.length === 1) throw new Error('网络中断')
      return { id: `so-${submissions.length}` }
    },
  }
  try {
    await act(async () => { root.render(createElement(WarehouseRequestPage, {
      mode: 'stockOut', projects: [{ projectId: 'P1', projectName: '正式项目' }],
      currentUser: { name: '王师傅' }, initialCatalog: catalog, initialLocations: locations,
      initialBalances: [{ variantId: 'v1', warehouseId: 'w1', locationId: 'l1', quantity: 5 }],
      initialContext: context, canRequest: true, warehouseService, confirmationService: {},
      warehouseMediaService: { listVariantPhotos: async () => [{ signedUrl: 'https://example.test/photo.jpg' }] },
    })) })
    await act(async () => {})
    assert.ok(elements(container, (element) =>
      element.nodeName === 'IMG' && element.getAttribute('src') === 'https://example.test/photo.jpg')[0])
    await change(field(container, '用途说明'), '空调安装')
    const form = elements(container, (element) =>
      element.nodeName === 'FORM' && element.textContent.includes('提交出库申请'))[0]
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
    assert.equal(submissions.length, 2)
    assert.equal(submissions[0].idempotencyKey, submissions[1].idempotencyKey)
    await act(async () => { form.dispatchEvent(new TestEvent('submit')) })
    assert.notEqual(submissions[2].idempotencyKey, submissions[1].idempotencyKey)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('return photo loader follows the selected non-first original variant and invalid auth', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const calls = []
  let authInvalid = 0
  const secondCatalog = {
    ...catalog,
    variants: [catalog.variants[0], {
      ...catalog.variants[0], id: 'v2', sku: 'CU-9', model: 'R32', size: '9mm',
    }],
  }
  const returnContext = {
    ...context,
    stockOutRequests: [{
      id: 'so-v2', destinationType: 'internal_use', destinationNameSnapshot: '公司内部使用',
      purpose: '安装', receiver: '王师傅', requestDate: '2026-08-09', status: 'confirmed',
      lines: [
        { id: 'sol-v1', variantId: 'v1', requestedQuantity: 1, confirmedQuantity: 1, remainingReturnable: 1, frozenTotalCost: null },
        { id: 'sol-v2', variantId: 'v2', requestedQuantity: 1, confirmedQuantity: 1, remainingReturnable: 1, frozenTotalCost: null },
      ],
    }], returnRequests: [],
  }
  try {
    await act(async () => { root.render(createElement(WarehouseRequestPage, {
      mode: 'stockReturn', projects: [], initialCatalog: secondCatalog,
      initialLocations: locations, initialBalances: [], initialContext: returnContext,
      canRequest: true, canConfirm: false, warehouseService: {}, confirmationService: {},
      onAuthInvalid: () => { authInvalid += 1 },
      warehouseMediaService: {
        async listVariantPhotos(id) {
          calls.push(id)
          return [{ signedUrl: `https://example.test/${id}.jpg` }]
        },
      },
    })) })
    await act(async () => {})
    await change(field(container, '原出库物品'), 'sol-v2')
    await act(async () => {})
    assert.equal(field(container, '原出库物品').value, 'sol-v2')
    assert.deepEqual(calls, ['v1', 'v2'])
    assert.ok(elements(container, (element) =>
      element.nodeName === 'IMG' && element.getAttribute('src') === 'https://example.test/v2.jpg')[0])

    await act(async () => { root.unmount() })
    const secondRoot = createRoot(container)
    await act(async () => { secondRoot.render(createElement(WarehouseRequestPage, {
      mode: 'stockOut', projects: [], initialCatalog: catalog, initialLocations: locations,
      initialBalances: [], initialContext: context, canRequest: true,
      warehouseService: {}, confirmationService: {}, onAuthInvalid: () => { authInvalid += 1 },
      warehouseMediaService: { listVariantPhotos: async () => { throw Object.assign(new Error('expired'), { authInvalid: true }) } },
    })) })
    await act(async () => {})
    assert.equal(authInvalid, 1)
    await act(async () => { secondRoot.unmount() })
  } finally {
    dom.cleanup()
  }
})

test('warehouse quantities add and compare in exact thousandth units', async () => {
  assert.equal(sumWarehouseQuantities([0.1, 0.2]), 0.3)
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const confirmed = []
  const pending = {
    ...context,
    stockOutRequests: [{
      id: 'so-decimal', destinationType: 'internal_use', destinationNameSnapshot: '公司内部使用',
      purpose: '安装', receiver: '王师傅', requestDate: '2026-08-09', status: 'pending',
      lines: [{ id: 'sol-decimal', variantId: 'v1', requestedQuantity: 0.3, confirmedQuantity: null, frozenTotalCost: null }],
    }], returnRequests: [],
  }
  try {
    await act(async () => { root.render(createElement(WarehouseRequestPage, {
      mode: 'stockOut', projects: [], initialCatalog: catalog, initialLocations: locations,
      initialBalances: [{ variantId: 'v1', warehouseId: 'w1', locationId: 'l1', quantity: 0.3 }],
      initialContext: pending, canRequest: false, canConfirm: true, warehouseService: {},
      confirmationService: { confirmStockOut: async (input) => { confirmed.push(input) } },
    })) })
    await change(field(container, '确认货架区'), 'l1')
    const button = elements(container, (element) =>
      element.nodeName === 'BUTTON' && element.textContent === '确认出库并扣减库存')[0]
    await act(async () => { button.click() })
    assert.equal(confirmed.length, 1)
    assert.equal(confirmed[0].lines[0].confirmedQuantity, 0.3)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('DOM confirmer selects one concrete shelf before authoritative stock deduction', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const confirmed = []
  const pending = {
    ...context,
    stockOutRequests: [{
      id: 'so-pending', destinationType: 'internal_use', projectId: null,
      minorWorkOrderId: null, destinationNameSnapshot: '公司内部使用', purpose: '维修',
      receiver: '王师傅', requestDate: '2026-08-09', status: 'pending',
      lines: [{ id: 'sol-pending', variantId: 'v1', requestedQuantity: 2, confirmedQuantity: null, frozenTotalCost: null }],
    }], returnRequests: [],
  }
  try {
    await act(async () => { root.render(createElement(WarehouseRequestPage, {
      mode: 'stockOut', projects: [], initialCatalog: catalog, initialLocations: locations,
      initialBalances: [{ variantId: 'v1', warehouseId: 'w1', locationId: 'l1', quantity: 5 }],
      initialContext: pending, viewCost: false, canConfirm: true,
      warehouseService: {}, confirmationService: { confirmStockOut: async (input) => { confirmed.push(input) } },
    })) })
    const button = elements(container, (element) =>
      element.nodeName === 'BUTTON' && element.textContent === '确认出库并扣减库存')[0]
    await act(async () => { button.click() })
    assert.equal(confirmed.length, 0)
    assert.match(container.textContent, /库存不足或没有可用货架区/u)
    await change(field(container, '确认货架区'), 'l1')
    await act(async () => { button.click() })
    assert.equal(confirmed.length, 1)
    assert.deepEqual(confirmed[0].lines[0], {
      stockOutLineId: 'sol-pending', confirmedQuantity: 2,
      warehouseId: 'w1', locationId: 'l1',
    })
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

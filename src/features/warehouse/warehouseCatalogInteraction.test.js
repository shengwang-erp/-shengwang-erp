import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import test from 'node:test'
import { createServer } from 'vite'

import { installWarehouseReactDom, TestEvent } from './warehouseReactDomTestUtils.js'

const bootstrapDom = installWarehouseReactDom()
const { createRoot } = await import('react-dom/client')
bootstrapDom.cleanup()

const CATALOG = {
  items: [
    { id: 'item-a', name: '铜管', category: '空调', brand: 'A厂', description: '冷媒管', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'item-b', name: '保温棉', category: '保温', brand: 'B厂', description: '保温材料', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
  variants: [
    { id: 'variant-a1', itemId: 'item-a', sku: 'CU-6', model: 'R410A', size: '6mm', material: '铜', unit: '米', minimumStock: 2, defaultPurchasePrice: 11.5, systemQr: 'SWERP:VARIANT:variant-a1', manufacturerQr: null, active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'variant-a2', itemId: 'item-a', sku: 'CU-9', model: 'R32', size: '9mm', material: '铜', unit: '米', minimumStock: 3, defaultPurchasePrice: 15, systemQr: 'SWERP:VARIANT:variant-a2', manufacturerQr: 'M-CU-9', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'variant-b', itemId: 'item-b', sku: 'INS-20', model: 'STANDARD', size: '20mm', material: '橡塑', unit: '根', minimumStock: 4, defaultPurchasePrice: 8, systemQr: 'SWERP:VARIANT:variant-b', manufacturerQr: null, active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
}

const LOCATIONS = {
  sites: [
    { id: 'site-a', code: 'MAIN', name: '本社仓', kind: 'normal', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'site-project', code: 'SITE-A', name: 'A项目现场仓', kind: 'project_site', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
  locations: [
    { id: 'shelf-a', warehouseId: 'site-a', shelfCode: 'A-01', shelfName: '一号架', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
    { id: 'shelf-project', warehouseId: 'site-project', shelfCode: 'ZONE-1', shelfName: '现场材料区', active: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
  ],
}

const EMPTY_LOCATIONS = { sites: [], locations: [] }

async function loadCatalogModule() {
  const server = await createServer({
    root: process.cwd(), configFile: false, logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true },
  })
  try { return await server.ssrLoadModule('/src/features/warehouse/WarehouseCatalog.jsx') }
  finally { await server.close() }
}

const catalogModule = await loadCatalogModule()

function deferred() {
  let resolve
  let reject
  const promise = new Promise((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function elements(root, predicate, result = []) {
  if (root?.nodeType === 1 && predicate(root)) result.push(root)
  for (const child of root?.childNodes ?? []) elements(child, predicate, result)
  return result
}

const byClass = (root, className) => elements(root, (element) =>
  element.className.split(/\s+/u).includes(className))[0]
const byText = (root, nodeName, text) => elements(root, (element) =>
  element.nodeName === nodeName && element.textContent.trim() === text)[0]
const field = (root, label) => {
  const wrapper = elements(root, (element) =>
    element.nodeName === 'LABEL' && element.textContent.startsWith(label))[0]
  const nested = elements(wrapper, (element) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.nodeName))[0]
  if (nested) return nested
  const targetId = wrapper?.getAttribute('for')
  return elements(root, (element) => targetId && element.getAttribute('id') === targetId)[0]
}
const form = (root, heading) => elements(root, (element) =>
  element.nodeName === 'FORM' && element.textContent.includes(heading))[0]

async function change(element, value) {
  await act(async () => {
    element.value = value
    element.dispatchEvent(new TestEvent('input'))
    element.dispatchEvent(new TestEvent('change'))
  })
}

async function click(element) {
  await act(async () => { element.click() })
}

async function submit(element) {
  await act(async () => { element.dispatchEvent(new TestEvent('submit')) })
}

function renderProps(overrides = {}) {
  return {
    warehouseService: {}, warehouseMediaService: {}, initialCatalog: CATALOG,
    initialLocations: LOCATIONS, initialPhotosByVariant: {}, manageCatalog: false,
    viewCost: false, companyName: '盛旺株式会社', ...overrides,
  }
}

test('async loaders suppress stale responses, surface safe failures, and ignore completion after unmount', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const oldCatalog = deferred()
  const newCatalog = deferred()
  const lateCatalog = deferred()
  const service = (catalogPromise) => ({
    listCatalog: () => catalogPromise,
    listLocations: async () => EMPTY_LOCATIONS,
  })
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialCatalog: null, initialLocations: null, warehouseService: service(oldCatalog.promise) }))) })
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialCatalog: null, initialLocations: null, warehouseService: service(newCatalog.promise) }))) })
    newCatalog.resolve({ items: [{ ...CATALOG.items[0], id: 'new-item', name: '新目录' }], variants: [] })
    await act(async () => {})
    oldCatalog.resolve({ items: [{ ...CATALOG.items[0], id: 'old-item', name: '旧目录' }], variants: [] })
    await act(async () => {})
    assert.match(container.textContent, /新目录/u)
    assert.doesNotMatch(container.textContent, /旧目录/u)

    const failed = Promise.reject(new Error('目录暂时不可用'))
    failed.catch(() => {})
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialCatalog: null, initialLocations: null, warehouseService: service(failed) }))) })
    await act(async () => {})
    assert.match(container.textContent, /目录暂时不可用/u)

    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialCatalog: null, initialLocations: null, warehouseService: service(lateCatalog.promise) }))) })
    await act(async () => { root.unmount() })
    lateCatalog.resolve(CATALOG)
    await act(async () => {})
    assert.equal(container.textContent, '')
  } finally {
    if (container.firstChild) await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('search, item and variant selection, scan resolution, and current-variant label work through real events', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const warehouseService = {
    resolveQr: async () => ({ id: 'variant-b', itemId: 'item-b' }),
  }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ warehouseService }))) })
    const cards = byClass(container, 'warehouse-catalog-cards')
    await change(field(container, '搜索物品、SKU、型号或二维码'), 'INS-20')
    assert.match(cards.textContent, /保温棉/u)
    assert.doesNotMatch(cards.textContent, /铜管/u)
    await change(field(container, '搜索物品、SKU、型号或二维码'), '')
    assert.match(cards.textContent, /铜管/u)

    await click(byText(cards, 'BUTTON', '铜管空调 · A厂2 个型号 · 启用'))
    await click(byText(container, 'BUTTON', 'CU-9'))
    await click(byText(container, 'BUTTON', '生成标签'))
    assert.equal(byClass(container, 'warehouse-label-print-sheet__code').textContent, 'SWERP:VARIANT:variant-a2')

    await click(byText(container, 'BUTTON', '扫描二维码'))
    await act(async () => {})
    const manual = elements(container, (element) => element.getAttribute('id') === 'warehouse-qr-manual-input')[0]
    await change(manual, 'M-CODE')
    await submit(elements(container, (element) => element.nodeName === 'FORM' && element.textContent.includes('手动输入二维码'))[0])
    await act(async () => {})
    assert.match(byClass(container, 'warehouse-catalog-detail-header').textContent, /保温棉/u)
    assert.match(byClass(container, 'warehouse-catalog-variant-codes').textContent, /SWERP:VARIANT:variant-b/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('an in-flight manual scan survives an unrelated signed-photo completion rerender', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const lookup = deferred()
  const photoLoad = deferred()
  const warehouseService = { resolveQr: () => lookup.promise }
  const warehouseMediaService = { listVariantPhotos: () => photoLoad.promise }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ warehouseService, warehouseMediaService, initialPhotosByVariant: null }))) })
    await click(byText(container, 'BUTTON', '扫描二维码'))
    await act(async () => {})
    const manual = elements(container, (element) => element.getAttribute('id') === 'warehouse-qr-manual-input')[0]
    await change(manual, 'DEFERRED-CODE')
    await submit(elements(container, (element) => element.nodeName === 'FORM' && element.textContent.includes('手动输入二维码'))[0])
    await act(async () => {})

    photoLoad.resolve([])
    await act(async () => {})
    lookup.resolve({ id: 'variant-b', itemId: 'item-b' })
    await act(async () => {})

    assert.match(byClass(container, 'warehouse-catalog-detail-header').textContent, /保温棉/u)
    assert.equal(byClass(container, 'warehouse-qr-scanner'), undefined)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('manager mutations send exact service payloads, reject empty numbers, update state, and retain failed drafts', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const calls = []
  let failItem = false
  const warehouseService = {
    async saveItem(payload) {
      calls.push(['item', payload])
      if (failItem) throw new Error('物品保存失败，请重试')
      return { ...CATALOG.items[0], ...payload }
    },
    async saveVariant(payload) { calls.push(['variant', payload]); return { ...CATALOG.variants[0], ...payload, systemQr: CATALOG.variants[0].systemQr } },
    async saveSite(payload) { calls.push(['site', payload]); return { ...LOCATIONS.sites[0], ...payload } },
    async saveLocation(payload) { calls.push(['location', payload]); return { ...LOCATIONS.locations[0], ...payload } },
  }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ warehouseService, manageCatalog: true }))) })
    await change(field(form(container, '物品资料'), '物品名称'), '新铜管')
    await submit(form(container, '物品资料'))
    assert.deepEqual(calls[0], ['item', { id: 'item-a', name: '新铜管', category: '空调', brand: 'A厂', description: '冷媒管', active: true }])
    assert.match(container.textContent, /物品已保存/u)

    await change(field(form(container, '型号资料'), '默认采购价'), '')
    await submit(form(container, '型号资料'))
    assert.equal(calls.filter(([kind]) => kind === 'variant').length, 0)
    assert.match(container.textContent, /请输入默认采购价/u)
    await change(field(form(container, '型号资料'), '默认采购价'), '19.25')
    await change(field(form(container, '型号资料'), '最低库存'), '7')
    await submit(form(container, '型号资料'))
    assert.deepEqual(calls.find(([kind]) => kind === 'variant'), ['variant', {
      id: 'variant-a1', itemId: 'item-a', sku: 'CU-6', model: 'R410A', size: '6mm',
      material: '铜', unit: '米', minimumStock: 7, defaultPurchasePrice: 19.25,
      manufacturerQr: null, active: true,
    }])

    await submit(form(container, '仓库资料'))
    await submit(form(container, '货架区资料'))
    assert.deepEqual(calls.find(([kind]) => kind === 'site'), ['site', { id: 'site-a', code: 'MAIN', name: '本社仓', kind: 'normal', active: true }])
    assert.deepEqual(calls.find(([kind]) => kind === 'location'), ['location', { id: 'shelf-a', warehouseId: 'site-a', shelfCode: 'A-01', shelfName: '一号架', active: true }])

    await click(elements(container, (element) => element.getAttribute('aria-label') === '编辑仓库 A项目现场仓')[0])
    assert.equal(field(form(container, '仓库资料'), '仓库名称').value, 'A项目现场仓')
    await submit(form(container, '仓库资料'))
    assert.deepEqual(calls.at(-1), ['site', { id: 'site-project', code: 'SITE-A', name: 'A项目现场仓', kind: 'project_site', active: true }])
    await click(elements(container, (element) => element.getAttribute('aria-label') === '编辑货架区 现场材料区')[0])
    assert.equal(field(form(container, '货架区资料'), '货架名称').value, '现场材料区')
    await submit(form(container, '货架区资料'))
    assert.deepEqual(calls.at(-1), ['location', { id: 'shelf-project', warehouseId: 'site-project', shelfCode: 'ZONE-1', shelfName: '现场材料区', active: true }])

    failItem = true
    await change(field(form(container, '物品资料'), '物品名称'), '保留的草稿')
    await submit(form(container, '物品资料'))
    assert.equal(field(form(container, '物品资料'), '物品名称').value, '保留的草稿')
    assert.match(container.textContent, /物品保存失败，请重试/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('saving a new item resets the variant editor and binds its next variant to the new item', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const calls = []
  const ids = ['new-item', 'new-variant']
  const warehouseService = {
    async saveItem(payload) { calls.push(['item', payload]); return { ...CATALOG.items[0], ...payload } },
    async saveVariant(payload) { calls.push(['variant', payload]); return { ...CATALOG.variants[0], ...payload, systemQr: `SWERP:VARIANT:${payload.id}` } },
  }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ warehouseService, manageCatalog: true, createId: () => ids.shift() }))) })
    await click(byText(container, 'BUTTON', '新增物品'))
    await change(field(form(container, '物品资料'), '物品名称'), '新物品')
    await submit(form(container, '物品资料'))
    assert.equal(field(form(container, '型号资料'), 'SKU').value, '')

    await change(field(form(container, '型号资料'), 'SKU'), 'NEW-SKU')
    await change(field(form(container, '型号资料'), '单位'), '个')
    await change(field(form(container, '型号资料'), '最低库存'), '1')
    await change(field(form(container, '型号资料'), '默认采购价'), '2.5')
    await submit(form(container, '型号资料'))
    assert.equal(calls.at(-1)[0], 'variant')
    assert.equal(calls.at(-1)[1].id, 'new-variant')
    assert.equal(calls.at(-1)[1].itemId, 'new-item')
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('photo lifecycle never leaks a previous variant URL and reorder refreshes signed URLs', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const first = deferred()
  const second = deferred()
  const requests = new Map([['variant-a1', first], ['variant-b', second]])
  const warehouseMediaService = {
    listVariantPhotos: (variantId) => requests.get(variantId)?.promise ?? Promise.resolve([]),
  }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialPhotosByVariant: null, warehouseMediaService }))) })
    await click(byText(byClass(container, 'warehouse-catalog-cards'), 'BUTTON', '保温棉保温 · B厂1 个型号 · 启用'))
    second.reject(new Error('照片暂时无法打开'))
    await act(async () => {})
    assert.match(container.textContent, /照片暂时无法打开/u)
    assert.equal(elements(container, (element) => element.nodeName === 'IMG').length, 0)
    first.resolve([{ id: 'photo-old', variantId: 'variant-a1', sortOrder: 0, signedUrl: 'https://signed.invalid/old' }])
    await act(async () => {})
    assert.doesNotMatch(container.textContent, /signed\.invalid\/old/u)
    assert.equal(elements(container, (element) => element.getAttribute('src') === 'https://signed.invalid/old').length, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }

  const dom2 = installWarehouseReactDom()
  const container2 = dom2.createContainer()
  const root2 = createRoot(container2)
  const reordered = [
    { id: 'photo-2', variantId: 'variant-a1', sortOrder: 0, signedUrl: 'https://signed.invalid/new-2' },
    { id: 'photo-1', variantId: 'variant-a1', sortOrder: 1, signedUrl: 'https://signed.invalid/new-1' },
  ]
  const calls = []
  const managerMedia = {
    async reorderVariantPhotos(variantId, photoIds) { calls.push([variantId, photoIds]); return photoIds.map((id, sortOrder) => ({ id, variantId, sortOrder })) },
    async listVariantPhotos() { return reordered },
  }
  const seeded = { 'variant-a1': [
    { id: 'photo-1', variantId: 'variant-a1', sortOrder: 0, signedUrl: 'https://signed.invalid/one' },
    { id: 'photo-2', variantId: 'variant-a1', sortOrder: 1, signedUrl: 'https://signed.invalid/two' },
  ] }
  try {
    await act(async () => { root2.render(createElement(catalogModule.default, renderProps({ manageCatalog: true, warehouseMediaService: managerMedia, initialPhotosByVariant: seeded }))) })
    await click(elements(container2, (element) => element.nodeName === 'BUTTON' && element.textContent === '下移' && !element.disabled)[0])
    assert.deepEqual(calls, [['variant-a1', ['photo-2', 'photo-1']]])
    assert.equal(elements(container2, (element) => element.getAttribute('src') === 'https://signed.invalid/new-2').length, 1)
    assert.equal(elements(container2, (element) => element.getAttribute('src') === null && element.nodeName === 'IMG').length, 0)
  } finally {
    await act(async () => { root2.unmount() })
    dom2.cleanup()
  }
})

test('a failed signed-photo refresh clears an earlier URL for the same selected variant', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const first = deferred()
  const firstMedia = { listVariantPhotos: () => first.promise }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialPhotosByVariant: null, warehouseMediaService: firstMedia }))) })
    first.resolve([{ id: 'photo-a', variantId: 'variant-a1', sortOrder: 0, signedUrl: 'https://signed.invalid/expired' }])
    await act(async () => {})
    assert.equal(elements(container, (element) => element.getAttribute('src') === 'https://signed.invalid/expired').length, 1)

    const failingMedia = { listVariantPhotos: async () => { throw new Error('签名刷新失败') } }
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ initialPhotosByVariant: null, warehouseMediaService: failingMedia }))) })
    await act(async () => {})
    assert.match(container.textContent, /签名刷新失败/u)
    assert.equal(elements(container, (element) => element.getAttribute('src') === 'https://signed.invalid/expired').length, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('photo delete projects exact metadata and clears the deleted image when signed refresh fails', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const photo = {
    id: 'photo-delete', variantId: 'variant-a1', objectPath: 'variant-a1/photo-delete.jpg',
    sortOrder: 0, mimeType: 'image/jpeg', byteSize: 123, createdAt: '2026-01-01T00:00:00Z',
    signedUrl: 'https://signed.invalid/delete-me',
  }
  let deletedPayload
  const warehouseMediaService = {
    async deleteVariantPhoto(payload) {
      deletedPayload = payload
      const expected = ['byteSize', 'createdAt', 'id', 'mimeType', 'objectPath', 'sortOrder', 'variantId']
      assert.deepEqual(Object.keys(payload).sort(), expected)
      return true
    },
    async listVariantPhotos() { throw new Error('照片签名刷新失败') },
  }
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ manageCatalog: true, warehouseMediaService, initialPhotosByVariant: { 'variant-a1': [photo] } }))) })
    await click(byText(container, 'BUTTON', '删除照片'))
    assert.equal(deletedPayload.id, 'photo-delete')
    assert.equal(Object.hasOwn(deletedPayload, 'signedUrl'), false)
    assert.equal(elements(container, (element) => element.getAttribute('src') === photo.signedUrl).length, 0)
    assert.match(container.textContent, /照片签名刷新失败/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('same-variant photo mutations serialize against real server state and ignore completion after unmount', async () => {
  const photos = [
    {
      id: 'photo-first', variantId: 'variant-a1', objectPath: 'variant-a1/photo-first.jpg',
      sortOrder: 0, mimeType: 'image/jpeg', byteSize: 101, createdAt: '2026-01-01T00:00:00Z',
      signedUrl: 'https://signed.invalid/first',
    },
    {
      id: 'photo-second', variantId: 'variant-a1', objectPath: 'variant-a1/photo-second.jpg',
      sortOrder: 1, mimeType: 'image/jpeg', byteSize: 102, createdAt: '2026-01-01T00:00:00Z',
      signedUrl: 'https://signed.invalid/second',
    },
  ]
  const firstDelete = deferred()
  const secondDelete = deferred()
  let serverPhotos = [...photos]
  const deleteCalls = []
  let listCalls = 0
  const warehouseMediaService = {
    deleteVariantPhoto: ({ id }) => {
      deleteCalls.push(id)
      return id === 'photo-first' ? firstDelete.promise : secondDelete.promise
    },
    async listVariantPhotos() { listCalls += 1; return [...serverPhotos] },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ manageCatalog: true, warehouseMediaService, initialPhotosByVariant: { 'variant-a1': photos } }))) })
    const deleteButtons = elements(container, (element) => element.nodeName === 'BUTTON' && element.textContent === '删除照片')
    await act(async () => {
      deleteButtons[0].click()
      deleteButtons[1].click()
    })
    assert.deepEqual(deleteCalls, ['photo-first'])

    serverPhotos = [photos[1]]
    firstDelete.resolve(true)
    await act(async () => {})
    assert.equal(listCalls, 1)
    assert.deepEqual(deleteCalls, ['photo-first', 'photo-second'])
    assert.equal(elements(container, (element) => element.getAttribute('src') === photos[0].signedUrl).length, 0)
    assert.equal(elements(container, (element) => element.getAttribute('src') === photos[1].signedUrl).length, 1)

    serverPhotos = []
    secondDelete.resolve(true)
    await act(async () => {})
    assert.equal(listCalls, 2)
    assert.equal(elements(container, (element) => element.nodeName === 'IMG').length, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }

  const lateDelete = deferred()
  let lateListCalls = 0
  const lateMediaService = {
    deleteVariantPhoto: () => lateDelete.promise,
    async listVariantPhotos() { lateListCalls += 1; return [] },
  }
  const lateDom = installWarehouseReactDom()
  const lateContainer = lateDom.createContainer()
  const lateRoot = createRoot(lateContainer)
  try {
    await act(async () => { lateRoot.render(createElement(catalogModule.default, renderProps({ manageCatalog: true, warehouseMediaService: lateMediaService, initialPhotosByVariant: { 'variant-a1': [photos[0]] } }))) })
    await act(async () => { byText(lateContainer, 'BUTTON', '删除照片').click() })
    await act(async () => { lateRoot.unmount() })
    lateDelete.resolve(true)
    await act(async () => {})
    assert.equal(lateListCalls, 0)
    assert.equal(lateContainer.textContent, '')
  } finally {
    if (lateContainer.firstChild) await act(async () => { lateRoot.unmount() })
    lateDom.cleanup()
  }
})

test('photo mutation queues continue after failure and remain independent across variants', async () => {
  const firstPhoto = {
    id: 'photo-fails', variantId: 'variant-a1', objectPath: 'variant-a1/photo-fails.jpg',
    sortOrder: 0, mimeType: 'image/jpeg', byteSize: 201, createdAt: '2026-01-01T00:00:00Z',
    signedUrl: 'https://signed.invalid/fails',
  }
  const secondPhoto = {
    id: 'photo-recovers', variantId: 'variant-a1', objectPath: 'variant-a1/photo-recovers.jpg',
    sortOrder: 1, mimeType: 'image/jpeg', byteSize: 202, createdAt: '2026-01-01T00:00:00Z',
    signedUrl: 'https://signed.invalid/recovers',
  }
  const failedDelete = deferred()
  const recoveredDelete = deferred()
  const calls = []
  let serverPhotos = [firstPhoto, secondPhoto]
  const recoveryMediaService = {
    deleteVariantPhoto: ({ id }) => {
      calls.push(id)
      return id === firstPhoto.id ? failedDelete.promise : recoveredDelete.promise
    },
    async listVariantPhotos() { return [...serverPhotos] },
  }
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps({ manageCatalog: true, warehouseMediaService: recoveryMediaService, initialPhotosByVariant: { 'variant-a1': serverPhotos } }))) })
    const deleteButtons = elements(container, (element) => element.nodeName === 'BUTTON' && element.textContent === '删除照片')
    await act(async () => { deleteButtons[0].click(); deleteButtons[1].click() })
    assert.deepEqual(calls, [firstPhoto.id])

    failedDelete.reject(new Error('第一张删除失败'))
    await act(async () => {})
    assert.deepEqual(calls, [firstPhoto.id, secondPhoto.id])

    serverPhotos = [firstPhoto]
    recoveredDelete.resolve(true)
    await act(async () => {})
    assert.equal(elements(container, (element) => element.getAttribute('src') === firstPhoto.signedUrl).length, 1)
    assert.equal(elements(container, (element) => element.getAttribute('src') === secondPhoto.signedUrl).length, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }

  const otherPhoto = {
    id: 'photo-other-variant', variantId: 'variant-b', objectPath: 'variant-b/photo-other.jpg',
    sortOrder: 0, mimeType: 'image/jpeg', byteSize: 203, createdAt: '2026-01-01T00:00:00Z',
    signedUrl: 'https://signed.invalid/other',
  }
  const firstVariantDelete = deferred()
  const otherVariantDelete = deferred()
  const parallelCalls = []
  let parallelListCalls = 0
  const parallelMediaService = {
    deleteVariantPhoto: ({ id, variantId }) => {
      parallelCalls.push([variantId, id])
      return variantId === 'variant-a1' ? firstVariantDelete.promise : otherVariantDelete.promise
    },
    async listVariantPhotos() { parallelListCalls += 1; return [] },
  }
  const parallelDom = installWarehouseReactDom()
  const parallelContainer = parallelDom.createContainer()
  const parallelRoot = createRoot(parallelContainer)
  try {
    await act(async () => { parallelRoot.render(createElement(catalogModule.default, renderProps({ manageCatalog: true, warehouseMediaService: parallelMediaService, initialPhotosByVariant: { 'variant-a1': [firstPhoto], 'variant-b': [otherPhoto] } }))) })
    await click(byText(parallelContainer, 'BUTTON', '删除照片'))
    await click(byText(byClass(parallelContainer, 'warehouse-catalog-cards'), 'BUTTON', '保温棉保温 · B厂1 个型号 · 启用'))
    await click(byText(parallelContainer, 'BUTTON', '删除照片'))
    assert.deepEqual(parallelCalls, [
      ['variant-a1', firstPhoto.id],
      ['variant-b', otherPhoto.id],
    ])

    await act(async () => { parallelRoot.unmount() })
    firstVariantDelete.resolve(true)
    otherVariantDelete.resolve(true)
    await act(async () => {})
    assert.equal(parallelListCalls, 0)
  } finally {
    if (parallelContainer.firstChild) await act(async () => { parallelRoot.unmount() })
    parallelDom.cleanup()
  }
})

test('real viewer host has no mutation controls or warehouse cost DOM', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(catalogModule.default, renderProps())) })
    assert.doesNotMatch(container.textContent, /新增物品|编辑物品|保存物品|默认采购价|上传照片|删除照片/u)
    assert.match(container.textContent, /扫描二维码/u)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

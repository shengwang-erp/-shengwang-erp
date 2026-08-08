import assert from 'node:assert/strict'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import test from 'node:test'
import { createServer } from 'vite'

import {
  buildVariantSystemQr,
  buildWarehouseSku,
  validateVariant,
} from './warehouseCatalog.js'

test('warehouse SKU and system QR builders use canonical formats', () => {
  assert.equal(buildWarehouseSku(7), 'SW-000007')
  assert.equal(buildVariantSystemQr('V-007'), 'SWERP:VARIANT:V-007')
})

test('variant validation normalizes manufacturer QR uniqueness and protects system QR space', () => {
  const variants = [{
    variantId: 'V-001',
    sku: 'SW-000001',
    manufacturerQr: ' Maker-ABC ',
    systemQr: 'SWERP:VARIANT:V-001',
  }]

  assert.deepEqual(validateVariant({
    variantId: 'V-002',
    sku: 'SW-000002',
    manufacturerQr: ' maker-abc ',
    systemQr: 'SWERP:VARIANT:V-002',
  }, variants), { error: '厂家二维码已存在' })

  assert.deepEqual(validateVariant({
    variantId: 'V-003',
    sku: 'SW-000003',
    manufacturerQr: '  swerp:variant:external ',
    systemQr: 'SWERP:VARIANT:V-003',
  }, variants), { error: '厂家二维码不能使用系统保留前缀' })
})

const IDS = Object.freeze({
  item: '92000000-0000-4000-8000-000000000001',
  secondItem: '92000000-0000-4000-8000-000000000002',
  variant: '93000000-0000-4000-8000-000000000001',
  secondVariant: '93000000-0000-4000-8000-000000000002',
  site: '90000000-0000-4000-8000-000000000001',
  projectSite: '90000000-0000-4000-8000-000000000002',
  sharedTool: '90000000-0000-4000-8000-000000000003',
  location: '91000000-0000-4000-8000-000000000001',
  projectLocation: '91000000-0000-4000-8000-000000000002',
})

const CATALOG = Object.freeze({
  items: Object.freeze([
    Object.freeze({
      id: IDS.item,
      name: '冷媒铜管',
      category: '空调材料',
      brand: '厂家A',
      description: 'R410A 冷媒用铜管',
      active: true,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    }),
    Object.freeze({
      id: IDS.secondItem,
      name: '保温棉',
      category: '保温材料',
      brand: '厂家B',
      description: '管道保温',
      active: false,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    }),
  ]),
  variants: Object.freeze([
    Object.freeze({
      id: IDS.variant,
      itemId: IDS.item,
      sku: 'CU-6MM',
      model: 'R410A',
      size: '6mm',
      material: '铜',
      unit: '米',
      minimumStock: 20,
      defaultPurchasePrice: 118.25,
      systemQr: `SWERP:VARIANT:${IDS.variant}`,
      manufacturerQr: 'MAKER-CU-6',
      active: true,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    }),
    Object.freeze({
      id: IDS.secondVariant,
      itemId: IDS.secondItem,
      sku: 'INS-20',
      model: 'STANDARD',
      size: '20mm',
      material: '橡塑',
      unit: '根',
      minimumStock: 5,
      defaultPurchasePrice: 25.5,
      systemQr: `SWERP:VARIANT:${IDS.secondVariant}`,
      manufacturerQr: null,
      active: false,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-01T00:00:00Z',
    }),
  ]),
})

const LOCATIONS = Object.freeze({
  sites: Object.freeze([
    Object.freeze({ id: IDS.site, code: 'MAIN', name: '本社仓', kind: 'normal', active: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }),
    Object.freeze({ id: IDS.projectSite, code: 'SITE-A', name: 'A项目现场仓', kind: 'project_site', active: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }),
    Object.freeze({ id: IDS.sharedTool, code: 'TOOLS', name: '共享工具仓', kind: 'shared_tool', active: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }),
  ]),
  locations: Object.freeze([
    Object.freeze({ id: IDS.location, warehouseId: IDS.site, shelfCode: 'A-01', shelfName: 'A区一号架', active: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }),
    Object.freeze({ id: IDS.projectLocation, warehouseId: IDS.projectSite, shelfCode: 'ZONE-1', shelfName: '现场材料区', active: true, createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' }),
  ]),
})

const PHOTOS = Object.freeze({
  [IDS.variant]: Object.freeze([
    Object.freeze({ id: '94000000-0000-4000-8000-000000000001', variantId: IDS.variant, objectPath: `${IDS.variant}/95000000-0000-4000-8000-000000000001.jpg`, sortOrder: 0, mimeType: 'image/jpeg', byteSize: 1000, createdAt: '2026-08-01T00:00:00Z', signedUrl: 'https://signed.invalid/first' }),
    Object.freeze({ id: '94000000-0000-4000-8000-000000000002', variantId: IDS.variant, objectPath: `${IDS.variant}/95000000-0000-4000-8000-000000000002.webp`, sortOrder: 1, mimeType: 'image/webp', byteSize: 900, createdAt: '2026-08-01T00:00:00Z', signedUrl: 'https://signed.invalid/second' }),
  ]),
})

async function loadCatalogModule() {
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/features/warehouse/WarehouseCatalog.jsx')
  } catch {
    return {}
  } finally {
    await server.close()
  }
}

const catalogModule = await loadCatalogModule()

function renderCatalog(overrides = {}) {
  return renderToStaticMarkup(createElement(catalogModule.default, {
    warehouseService: {},
    warehouseMediaService: {},
    initialCatalog: CATALOG,
    initialLocations: LOCATIONS,
    initialPhotosByVariant: PHOTOS,
    manageCatalog: false,
    viewCost: false,
    companyName: '盛旺株式会社',
    ...overrides,
  }))
}

test('catalog search matches complete item and variant fields without mutating source data', () => {
  assert.equal(typeof catalogModule.filterWarehouseCatalogItems, 'function')
  const before = JSON.stringify(CATALOG)

  assert.deepEqual(
    catalogModule.filterWarehouseCatalogItems(CATALOG, 'maker-cu-6').map(({ id }) => id),
    [IDS.item],
  )
  assert.deepEqual(
    catalogModule.filterWarehouseCatalogItems(CATALOG, '保温材料').map(({ id }) => id),
    [IDS.secondItem],
  )
  assert.deepEqual(catalogModule.filterWarehouseCatalogItems(CATALOG, '不存在'), [])
  assert.equal(JSON.stringify(CATALOG), before)
})

test('inventory viewer receives searchable cards, scan and read-only complete detail without mutation or price', () => {
  assert.equal(typeof catalogModule.default, 'function')
  const html = renderCatalog()

  for (const text of [
    '搜索物品、SKU、型号或二维码', '冷媒铜管', '空调材料', '厂家A',
    'R410A 冷媒用铜管', 'CU-6MM', 'R410A', '6mm', '铜', '米',
    '20', `SWERP:VARIANT:${IDS.variant}`, 'MAKER-CU-6', '扫描二维码',
    '本社仓', '普通仓库', 'A区一号架', 'A项目现场仓', '项目现场仓',
    '现场材料区（ZONE-1） · 启用', '共享工具仓',
  ]) assert.match(html, new RegExp(text, 'u'), text)

  assert.match(html, /class="[^"]*warehouse-catalog-photo-carousel/u)
  assert.ok(html.indexOf('https://signed.invalid/first') < html.indexOf('https://signed.invalid/second'))
  assert.doesNotMatch(html, /默认采购价|¥|新增物品|编辑物品|保存物品|上传照片|删除照片/u)
  assert.doesNotMatch(html, /data:image|createPublicUrl|public\/warehouse-item-photos/u)
})

test('catalog manager can edit every item and multi-variant field including warehouse purchase price', () => {
  const html = renderCatalog({ manageCatalog: true, viewCost: true })

  for (const text of [
    '新增物品', '编辑物品', '保存物品', '新增型号', '编辑型号', '保存型号',
    '物品名称', '分类', '品牌', '说明', '启用状态', '型号', '尺寸', '材质',
    '单位', 'SKU', '最低库存', '默认采购价', '厂家二维码', '系统二维码',
    '新增仓库', '编辑仓库', '仓库类型', '仓库编码', '仓库名称',
    '新增货架区', '编辑货架区', '货架编码', '货架名称',
    '上传照片', '上移', '下移', '删除照片',
  ]) assert.match(html, new RegExp(text, 'u'), text)
  assert.match(html, /118\.25/u)
  assert.match(html, /value="project_site"/u)
  assert.match(html, /value="shared_tool"/u)
})

test('manageCatalog effectively exposes warehouse purchase price while unrelated cost text stays absent', () => {
  const html = renderCatalog({ manageCatalog: true, viewCost: false })

  assert.match(html, /默认采购价/u)
  assert.match(html, /118\.25/u)
  assert.doesNotMatch(html, /工程成本|项目成本|会计成本|工资|利润/u)
})

test('malformed permission props fail closed instead of relying on truthiness', () => {
  const html = renderCatalog({ manageCatalog: 'true', viewCost: 1 })

  assert.doesNotMatch(html, /默认采购价|新增物品|编辑物品|保存物品|上传照片|删除照片/u)
  assert.match(html, /扫描二维码/u)
})

test('project-site warehouse remains one site with shelf zones and never renders nested sub-warehouse controls', () => {
  const html = renderCatalog({ manageCatalog: true, viewCost: true })
  const projectStart = html.indexOf('A项目现场仓')
  const projectEnd = html.indexOf('共享工具仓')
  const projectMarkup = html.slice(projectStart, projectEnd)

  assert.match(projectMarkup, /项目现场仓/u)
  assert.match(projectMarkup, /现场材料区/u)
  assert.doesNotMatch(projectMarkup, /子仓库|新增子仓|subwarehouse/u)
})

import React from 'react'

const SITE_KIND_LABELS = Object.freeze({
  normal: '普通仓库',
  project_site: '项目现场仓',
  shared_tool: '共享工具仓位',
})

function safeRows(value) {
  return Array.isArray(value) ? value : []
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function freeze(value) {
  if (Array.isArray(value)) value.forEach(freeze)
  else if (value && typeof value === 'object') Object.values(value).forEach(freeze)
  return Object.freeze(value)
}

export function buildWarehouseOverviewModel(snapshot = {}, viewCost = false) {
  const catalog = snapshot?.catalog ?? {}
  const locationData = snapshot?.locations ?? {}
  const variants = safeRows(catalog.variants).filter((variant) => variant?.active !== false)
  const balances = safeRows(snapshot?.balances)
  const sites = safeRows(locationData.sites)
  const locations = safeRows(locationData.locations)
  const quantityByVariant = new Map()
  let totalQuantity = 0
  let stockValue = 0

  for (const balance of balances) {
    const quantity = number(balance?.quantity)
    totalQuantity += quantity
    quantityByVariant.set(
      balance?.variantId,
      (quantityByVariant.get(balance?.variantId) ?? 0) + quantity,
    )
    if (viewCost === true) stockValue += number(balance?.stockValue)
  }

  const siteById = new Map(sites.map((site) => [site.id, site]))
  const locationRows = locations.map((location) => {
    const site = siteById.get(location.warehouseId)
    const quantity = balances
      .filter((balance) => balance.locationId === location.id)
      .reduce((sum, balance) => sum + number(balance.quantity), 0)
    return {
      siteId: site?.id ?? location.warehouseId,
      siteName: site?.name ?? '未知仓库',
      siteCode: site?.code ?? '',
      kind: site?.kind ?? 'normal',
      kindLabel: SITE_KIND_LABELS[site?.kind] ?? '普通仓库',
      locationId: location.id,
      shelfCode: location.shelfCode,
      shelfName: location.shelfName,
      quantity,
      active: site?.active !== false && location.active !== false,
    }
  })

  return freeze({
    summary: {
      totalSku: variants.length,
      totalQuantity,
      lowStockSku: variants.filter((variant) =>
        (quantityByVariant.get(variant.id) ?? 0) < number(variant.minimumStock)).length,
      stockValue: viewCost === true ? stockValue : null,
    },
    locations: locationRows,
  })
}

const format = (value) => new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits: 4,
}).format(value)

export default function WarehouseOverview({ snapshot, viewCost = false }) {
  const model = buildWarehouseOverviewModel(snapshot, viewCost)
  return (
    <section className="warehouse-overview" aria-labelledby="warehouse-overview-title">
      <header className="warehouse-section-heading">
        <div><p>WAREHOUSE OVERVIEW</p><h2 id="warehouse-overview-title">库存总览</h2></div>
        <span>数据来自仓库云端台账</span>
      </header>
      <div className="warehouse-summary-grid">
        <article><span>物品型号</span><strong>{model.summary.totalSku}</strong><small>SKU</small></article>
        <article><span>现有库存</span><strong>{format(model.summary.totalQuantity)}</strong><small>按各型号单位汇总，仅作数量概览</small></article>
        <article className={model.summary.lowStockSku > 0 ? 'is-warning' : ''}><span>低库存型号</span><strong>{model.summary.lowStockSku}</strong><small>需要补货关注</small></article>
        {viewCost && <article><span>库存金额</span><strong>¥{format(model.summary.stockValue)}</strong><small>按仓库批次成本计算</small></article>}
      </div>
      <section className="warehouse-location-overview">
        <h3>仓库与货架区</h3>
        {model.locations.length === 0 && <p className="warehouse-empty">尚未建立仓库和货架区。</p>}
        <div className="warehouse-location-grid">{model.locations.map((row) => (
          <article key={row.locationId} className={row.kind === 'shared_tool' ? 'is-shared-tool' : ''}>
            <div><strong>{row.siteName}</strong><span>{row.kindLabel}</span></div>
            <p>{row.shelfName}（{row.shelfCode}）</p>
            <small>{row.active ? '启用' : '停用'} · 当前数量 {format(row.quantity)}</small>
          </article>
        ))}</div>
        <p className="warehouse-shared-tool-note">共享工具仓位只记录物品位置；借用、归还仍使用原有“借工具”流程。</p>
      </section>
    </section>
  )
}

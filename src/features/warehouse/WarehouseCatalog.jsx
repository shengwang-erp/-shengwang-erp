import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import './warehouse.css'
import WarehouseLabelSheet from './WarehouseLabelSheet.jsx'
import WarehouseQrScanner from './WarehouseQrScanner.jsx'
import { matchesWarehouseCatalogSearch } from './warehouseCatalog.js'

const EMPTY_CATALOG = Object.freeze({ items: Object.freeze([]), variants: Object.freeze([]) })
const EMPTY_LOCATIONS = Object.freeze({ sites: Object.freeze([]), locations: Object.freeze([]) })
const SITE_KIND_LABELS = Object.freeze({
  normal: '普通仓库',
  project_site: '项目现场仓',
  shared_tool: '共享工具仓',
})

const itemDraft = (item = {}) => ({
  id: item.id ?? '',
  name: item.name ?? '',
  category: item.category ?? '',
  brand: item.brand ?? '',
  description: item.description ?? '',
  active: item.active ?? true,
})

const variantDraft = (variant = {}, itemId = '') => ({
  id: variant.id ?? '',
  itemId: variant.itemId ?? itemId,
  sku: variant.sku ?? '',
  model: variant.model ?? '',
  size: variant.size ?? '',
  material: variant.material ?? '',
  unit: variant.unit ?? '',
  minimumStock: variant.minimumStock ?? 0,
  defaultPurchasePrice: variant.defaultPurchasePrice ?? 0,
  manufacturerQr: variant.manufacturerQr ?? '',
  active: variant.active ?? true,
})

const siteDraft = (site = {}) => ({
  id: site.id ?? '',
  code: site.code ?? '',
  name: site.name ?? '',
  kind: site.kind ?? 'normal',
  active: site.active ?? true,
})

const locationDraft = (location = {}, warehouseId = '') => ({
  id: location.id ?? '',
  warehouseId: location.warehouseId ?? warehouseId,
  shelfCode: location.shelfCode ?? '',
  shelfName: location.shelfName ?? '',
  active: location.active ?? true,
})

const randomId = () => globalThis.crypto?.randomUUID?.() ?? ''
const errorMessage = (error) => error?.message || '操作失败，请重试'
const photoMutationPayload = (photo) => ({
  id: photo.id,
  variantId: photo.variantId,
  objectPath: photo.objectPath,
  sortOrder: photo.sortOrder,
  mimeType: photo.mimeType,
  byteSize: photo.byteSize,
  createdAt: photo.createdAt,
})

export function filterWarehouseCatalogItems(catalog = EMPTY_CATALOG, query = '') {
  const items = Array.isArray(catalog?.items) ? catalog.items : []
  const variants = Array.isArray(catalog?.variants) ? catalog.variants : []
  return items.filter((item) => matchesWarehouseCatalogSearch(
    item,
    variants.filter((variant) => variant.itemId === item.id),
    query,
  ))
}

function Field({ label, children }) {
  return <label className="warehouse-catalog-field"><span>{label}</span>{children}</label>
}

export default function WarehouseCatalog({
  warehouseService,
  warehouseMediaService,
  initialCatalog = null,
  initialLocations = null,
  initialPhotosByVariant = null,
  manageCatalog = false,
  viewCost = false,
  companyName = '',
  createId = randomId,
}) {
  const [catalog, setCatalog] = useState(initialCatalog ?? EMPTY_CATALOG)
  const [locationData, setLocationData] = useState(initialLocations ?? EMPTY_LOCATIONS)
  const [photosByVariant, setPhotosByVariant] = useState(initialPhotosByVariant ?? {})
  const [query, setQuery] = useState('')
  const [selectedItemId, setSelectedItemId] = useState(initialCatalog?.items?.[0]?.id ?? '')
  const [selectedVariantId, setSelectedVariantId] = useState(initialCatalog?.variants?.[0]?.id ?? '')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [labelVariant, setLabelVariant] = useState(null)
  const [message, setMessage] = useState('')
  const [itemForm, setItemForm] = useState(() => itemDraft(initialCatalog?.items?.[0]))
  const [variantForm, setVariantForm] = useState(() => variantDraft(
    initialCatalog?.variants?.[0],
    initialCatalog?.items?.[0]?.id,
  ))
  const [siteForm, setSiteForm] = useState(() => siteDraft(initialLocations?.sites?.[0]))
  const [shelfForm, setShelfForm] = useState(() => locationDraft(
    initialLocations?.locations?.[0],
    initialLocations?.sites?.[0]?.id,
  ))
  const [photoMutationBusyByVariant, setPhotoMutationBusyByVariant] = useState({})
  const canManageCatalog = manageCatalog === true
  const effectiveViewCost = canManageCatalog || viewCost === true
  const mountedRef = useRef(false)
  const photoGenerationRef = useRef(new Map())
  const photoMutationQueuesRef = useRef(new Map())
  const catalogRef = useRef(catalog)
  catalogRef.current = catalog
  const issuePhotoGeneration = useCallback((variantId) => {
    const token = (photoGenerationRef.current.get(variantId) ?? 0) + 1
    photoGenerationRef.current.set(variantId, token)
    return token
  }, [])
  const isCurrentPhotoGeneration = useCallback((variantId, token) => (
    mountedRef.current && photoGenerationRef.current.get(variantId) === token
  ), [])
  const enqueuePhotoMutation = useCallback((variantId, operation) => {
    const wasIdle = !photoMutationQueuesRef.current.has(variantId)
    const previous = photoMutationQueuesRef.current.get(variantId) ?? Promise.resolve()
    if (wasIdle && mountedRef.current) {
      setPhotoMutationBusyByVariant((current) => ({ ...current, [variantId]: true }))
    }
    const queued = previous.catch(() => {}).then(() => {
      if (!mountedRef.current) return false
      return operation()
    })
    photoMutationQueuesRef.current.set(variantId, queued)
    return queued.finally(() => {
      if (photoMutationQueuesRef.current.get(variantId) === queued) {
        photoMutationQueuesRef.current.delete(variantId)
        if (mountedRef.current) {
          setPhotoMutationBusyByVariant((current) => {
            const next = { ...current }
            delete next[variantId]
            return next
          })
        }
      }
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      photoGenerationRef.current.clear()
      photoMutationQueuesRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (initialCatalog || typeof warehouseService?.listCatalog !== 'function') return undefined
    let active = true
    warehouseService.listCatalog().then((next) => {
      if (!active) return
      setCatalog(next)
      const firstItem = next.items[0]
      const firstVariant = next.variants.find((variant) => variant.itemId === firstItem?.id)
      setSelectedItemId(firstItem?.id ?? '')
      setSelectedVariantId(firstVariant?.id ?? '')
      setItemForm(itemDraft(firstItem))
      setVariantForm(variantDraft(firstVariant, firstItem?.id))
    }).catch((error) => active && setMessage(errorMessage(error)))
    return () => { active = false }
  }, [initialCatalog, warehouseService])

  useEffect(() => {
    if (initialLocations || typeof warehouseService?.listLocations !== 'function') return undefined
    let active = true
    warehouseService.listLocations().then((next) => {
      if (!active) return
      setLocationData(next)
      setSiteForm(siteDraft(next.sites[0]))
      setShelfForm(locationDraft(next.locations[0], next.sites[0]?.id))
    }).catch((error) => active && setMessage(errorMessage(error)))
    return () => { active = false }
  }, [initialLocations, warehouseService])

  const visibleItems = useMemo(
    () => filterWarehouseCatalogItems(catalog, query),
    [catalog, query],
  )
  const selectedItem = catalog.items.find((item) => item.id === selectedItemId)
    ?? visibleItems[0]
    ?? null
  const selectedVariants = catalog.variants.filter((variant) => variant.itemId === selectedItem?.id)
  const selectedVariant = selectedVariants.find((variant) => variant.id === selectedVariantId)
    ?? selectedVariants[0]
    ?? null
  const photos = [...(photosByVariant[selectedVariant?.id] ?? [])]
    .sort((left, right) => left.sortOrder - right.sortOrder)
  const photoMutationBusy = selectedVariant?.id
    ? photoMutationBusyByVariant[selectedVariant.id] === true
    : false

  useEffect(() => {
    if (
      !selectedVariant?.id
      || initialPhotosByVariant?.[selectedVariant.id]
      || typeof warehouseMediaService?.listVariantPhotos !== 'function'
    ) return undefined
    const variantId = selectedVariant.id
    const token = issuePhotoGeneration(variantId)
    let active = true
    setPhotosByVariant((current) => ({ ...current, [variantId]: [] }))
    warehouseMediaService.listVariantPhotos(variantId).then((next) => {
      if (active && isCurrentPhotoGeneration(variantId, token)) {
        setPhotosByVariant((current) => ({ ...current, [variantId]: next }))
      }
    }).catch((error) => {
      if (active && isCurrentPhotoGeneration(variantId, token)) {
        setMessage(errorMessage(error))
      }
    })
    return () => { active = false }
  }, [initialPhotosByVariant, isCurrentPhotoGeneration, issuePhotoGeneration, selectedVariant?.id, warehouseMediaService])

  const chooseItem = (item) => {
    const firstVariant = catalog.variants.find((variant) => variant.itemId === item.id)
    setSelectedItemId(item.id)
    setSelectedVariantId(firstVariant?.id ?? '')
    setItemForm(itemDraft(item))
    setVariantForm(variantDraft(firstVariant, item.id))
    setLabelVariant(null)
  }
  const chooseVariant = (variant) => {
    setSelectedVariantId(variant.id)
    setVariantForm(variantDraft(variant, variant.itemId))
    setLabelVariant(null)
  }
  const replaceItem = (saved) => setCatalog((current) => ({
    ...current,
    items: current.items.some((item) => item.id === saved.id)
      ? current.items.map((item) => item.id === saved.id ? saved : item)
      : [...current.items, saved],
  }))
  const replaceVariant = (saved) => setCatalog((current) => ({
    ...current,
    variants: current.variants.some((variant) => variant.id === saved.id)
      ? current.variants.map((variant) => variant.id === saved.id ? saved : variant)
      : [...current.variants, saved],
  }))
  const submitItem = async (event) => {
    event.preventDefault()
    const creating = !itemForm.id
    try {
      const saved = await warehouseService.saveItem({ ...itemForm, id: itemForm.id || createId() })
      replaceItem(saved)
      setSelectedItemId(saved.id)
      setItemForm(itemDraft(saved))
      if (creating) {
        setSelectedVariantId('')
        setVariantForm(variantDraft({}, saved.id))
        setLabelVariant(null)
      }
      setMessage('物品已保存')
    } catch (error) { setMessage(errorMessage(error)) }
  }
  const submitVariant = async (event) => {
    event.preventDefault()
    const minimumStockText = String(variantForm.minimumStock).trim()
    const purchasePriceText = String(variantForm.defaultPurchasePrice).trim()
    if (!minimumStockText) {
      setMessage('请输入最低库存')
      return
    }
    if (!purchasePriceText) {
      setMessage('请输入默认采购价')
      return
    }
    const minimumStock = Number(minimumStockText)
    const defaultPurchasePrice = Number(purchasePriceText)
    if (!Number.isFinite(minimumStock) || minimumStock < 0) {
      setMessage('最低库存必须是大于或等于 0 的数字')
      return
    }
    if (!Number.isFinite(defaultPurchasePrice) || defaultPurchasePrice < 0) {
      setMessage('默认采购价必须是大于或等于 0 的数字')
      return
    }
    try {
      const payload = {
        ...variantForm,
        id: variantForm.id || createId(),
        itemId: variantForm.itemId || selectedItem?.id,
        minimumStock,
        defaultPurchasePrice,
        manufacturerQr: variantForm.manufacturerQr || null,
      }
      const saved = await warehouseService.saveVariant(payload)
      replaceVariant(saved)
      setSelectedVariantId(saved.id)
      setVariantForm(variantDraft(saved, saved.itemId))
      setMessage('型号已保存')
    } catch (error) { setMessage(errorMessage(error)) }
  }
  const submitSite = async (event) => {
    event.preventDefault()
    try {
      const saved = await warehouseService.saveSite({ ...siteForm, id: siteForm.id || createId() })
      setLocationData((current) => ({
        ...current,
        sites: current.sites.some((site) => site.id === saved.id)
          ? current.sites.map((site) => site.id === saved.id ? saved : site)
          : [...current.sites, saved],
      }))
      setSiteForm(siteDraft(saved))
      setMessage('仓库已保存')
    } catch (error) { setMessage(errorMessage(error)) }
  }
  const submitShelf = async (event) => {
    event.preventDefault()
    try {
      const saved = await warehouseService.saveLocation({ ...shelfForm, id: shelfForm.id || createId() })
      setLocationData((current) => ({
        ...current,
        locations: current.locations.some((location) => location.id === saved.id)
          ? current.locations.map((location) => location.id === saved.id ? saved : location)
          : [...current.locations, saved],
      }))
      setShelfForm(locationDraft(saved, saved.warehouseId))
      setMessage('货架区已保存')
    } catch (error) { setMessage(errorMessage(error)) }
  }
  const refreshPhotos = async (variantId, token) => {
    if (!isCurrentPhotoGeneration(variantId, token)) return false
    setPhotosByVariant((current) => ({ ...current, [variantId]: [] }))
    const next = await warehouseMediaService.listVariantPhotos(variantId)
    if (!isCurrentPhotoGeneration(variantId, token)) return false
    setPhotosByVariant((current) => ({ ...current, [variantId]: next }))
    return true
  }
  const uploadPhoto = async (event) => {
    const file = event.target.files?.[0]
    if (!file || !selectedVariant) return
    const variantId = selectedVariant.id
    event.target.value = ''
    try {
      const refreshed = await enqueuePhotoMutation(variantId, async () => {
        await warehouseMediaService.uploadVariantPhoto({ variantId, file })
        const token = issuePhotoGeneration(variantId)
        return refreshPhotos(variantId, token)
      })
      if (refreshed) setMessage('照片已上传')
    } catch (error) {
      if (mountedRef.current) setMessage(errorMessage(error))
    }
  }
  const movePhoto = async (index, offset) => {
    const target = index + offset
    if (!selectedVariant || target < 0 || target >= photos.length) return
    const next = [...photos]
    ;[next[index], next[target]] = [next[target], next[index]]
    const variantId = selectedVariant.id
    try {
      await enqueuePhotoMutation(variantId, async () => {
        await warehouseMediaService.reorderVariantPhotos(
          variantId,
          next.map((photo) => photo.id),
        )
        const token = issuePhotoGeneration(variantId)
        return refreshPhotos(variantId, token)
      })
    } catch (error) {
      if (mountedRef.current) setMessage(errorMessage(error))
    }
  }
  const deletePhoto = async (photo) => {
    try {
      const refreshed = await enqueuePhotoMutation(photo.variantId, async () => {
        await warehouseMediaService.deleteVariantPhoto(photoMutationPayload(photo))
        const token = issuePhotoGeneration(photo.variantId)
        return refreshPhotos(photo.variantId, token)
      })
      if (refreshed) setMessage('照片已删除')
    } catch (error) {
      if (mountedRef.current) setMessage(errorMessage(error))
    }
  }
  const scannerResolved = useCallback((resolution) => {
    const currentCatalog = catalogRef.current
    const item = currentCatalog.items.find((candidate) => candidate.id === resolution.itemId)
    const variant = currentCatalog.variants.find((candidate) => candidate.id === resolution.id)
    if (item) {
      setSelectedItemId(item.id)
      setItemForm(itemDraft(item))
    }
    if (variant && variant.itemId === item?.id) {
      setSelectedVariantId(variant.id)
      setVariantForm(variantDraft(variant, variant.itemId))
    }
    setLabelVariant(null)
    setScannerOpen(false)
  }, [])
  const label = labelVariant && selectedItem ? {
    companyName,
    itemName: selectedItem.name,
    model: labelVariant.model,
    size: labelVariant.size,
    material: labelVariant.material,
    sku: labelVariant.sku,
    unit: labelVariant.unit,
    systemQr: labelVariant.systemQr,
  } : null

  return (
    <section className="warehouse-catalog" aria-labelledby="warehouse-catalog-title">
      <header className="warehouse-catalog-header">
        <div><p className="warehouse-catalog-eyebrow">WAREHOUSE CATALOG</p><h2 id="warehouse-catalog-title">仓库物品目录</h2></div>
        <button type="button" className="warehouse-touch-target" onClick={() => setScannerOpen(true)}>扫描二维码</button>
      </header>
      <div className="warehouse-catalog-search">
        <label htmlFor="warehouse-catalog-search">搜索物品、SKU、型号或二维码</label>
        <input id="warehouse-catalog-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {message && <p className="warehouse-catalog-message" role="status">{message}</p>}

      <div className="warehouse-catalog-layout">
        <nav className="warehouse-catalog-cards" aria-label="物品目录">
          {visibleItems.map((item) => {
            const variants = catalog.variants.filter((variant) => variant.itemId === item.id)
            return <button key={item.id} type="button" className={item.id === selectedItem?.id ? 'is-selected' : ''} onClick={() => chooseItem(item)}>
              <strong>{item.name}</strong><span>{item.category || '未分类'} · {item.brand || '未设置品牌'}</span><small>{variants.length} 个型号 · {item.active ? '启用' : '停用'}</small>
            </button>
          })}
          {visibleItems.length === 0 && <p>没有匹配的物品</p>}
        </nav>

        <div className="warehouse-catalog-detail">
          {selectedItem ? <>
            <header className="warehouse-catalog-detail-header">
              <div><h3>{selectedItem.name}</h3><p>{selectedItem.category} · {selectedItem.brand}</p></div>
              <span className={selectedItem.active ? 'is-active' : 'is-inactive'}>{selectedItem.active ? '启用' : '停用'}</span>
            </header>
            <p className="warehouse-catalog-description">{selectedItem.description || '暂无说明'}</p>
            <div className="warehouse-catalog-table-wrap">
              <table><thead><tr><th>SKU</th><th>型号</th><th>尺寸</th><th>材质</th><th>单位</th><th>最低库存</th>{effectiveViewCost && <th>默认采购价</th>}<th>状态</th></tr></thead>
                <tbody>{selectedVariants.map((variant) => <tr key={variant.id} className={variant.id === selectedVariant?.id ? 'is-selected' : ''}><td><button type="button" className="warehouse-catalog-variant-select" onClick={() => chooseVariant(variant)}>{variant.sku}</button></td><td>{variant.model}</td><td>{variant.size}</td><td>{variant.material}</td><td>{variant.unit}</td><td>{variant.minimumStock}</td>{effectiveViewCost && <td>{variant.defaultPurchasePrice}</td>}<td>{variant.active ? '启用' : '停用'}</td></tr>)}</tbody></table>
            </div>
            {selectedVariant && <section className="warehouse-catalog-variant-detail">
              <div className="warehouse-catalog-variant-codes"><span>系统二维码：<code>{selectedVariant.systemQr}</code></span><span>厂家二维码：<code>{selectedVariant.manufacturerQr || '未设置'}</code></span></div>
              <button type="button" onClick={() => setLabelVariant(selectedVariant)}>生成标签</button>
              <div className="warehouse-catalog-photo-carousel" aria-label="型号照片">
                {photos.map((photo, index) => <figure key={photo.id} className="warehouse-catalog-photo"><img src={photo.signedUrl} alt={`${selectedItem.name} 照片 ${index + 1}`} /><figcaption>{index + 1} / {photos.length}</figcaption>{canManageCatalog && <div className="warehouse-catalog-photo-actions"><button type="button" onClick={() => movePhoto(index, -1)} disabled={photoMutationBusy || index === 0}>上移</button><button type="button" onClick={() => movePhoto(index, 1)} disabled={photoMutationBusy || index === photos.length - 1}>下移</button><button type="button" onClick={() => deletePhoto(photo)} disabled={photoMutationBusy}>删除照片</button></div>}</figure>)}
                {photos.length === 0 && <p>暂无照片</p>}
              </div>
              {canManageCatalog && <label className="warehouse-catalog-upload">上传照片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadPhoto} disabled={photoMutationBusy} /></label>}
            </section>}
          </> : <p>请选择物品</p>}
        </div>
      </div>

      {canManageCatalog && <section className="warehouse-catalog-manager" aria-label="目录维护">
        <div className="warehouse-catalog-actions"><button type="button" onClick={() => setItemForm(itemDraft())}>新增物品</button><button type="button" onClick={() => setItemForm(itemDraft(selectedItem))}>编辑物品</button><button type="button" onClick={() => setVariantForm(variantDraft({}, selectedItem?.id))}>新增型号</button><button type="button" onClick={() => setVariantForm(variantDraft(selectedVariant, selectedItem?.id))}>编辑型号</button></div>
        <form className="warehouse-catalog-form" onSubmit={submitItem}><h3>物品资料</h3><div className="warehouse-catalog-form-grid"><Field label="物品名称"><input required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} /></Field><Field label="分类"><input value={itemForm.category} onChange={(event) => setItemForm({ ...itemForm, category: event.target.value })} /></Field><Field label="品牌"><input value={itemForm.brand} onChange={(event) => setItemForm({ ...itemForm, brand: event.target.value })} /></Field><Field label="说明"><textarea value={itemForm.description} onChange={(event) => setItemForm({ ...itemForm, description: event.target.value })} /></Field><Field label="启用状态"><input type="checkbox" checked={itemForm.active} onChange={(event) => setItemForm({ ...itemForm, active: event.target.checked })} /></Field></div><button type="submit">保存物品</button></form>
        <form className="warehouse-catalog-form" onSubmit={submitVariant}><h3>型号资料</h3><div className="warehouse-catalog-form-grid"><Field label="SKU"><input required value={variantForm.sku} onChange={(event) => setVariantForm({ ...variantForm, sku: event.target.value })} /></Field><Field label="型号"><input value={variantForm.model} onChange={(event) => setVariantForm({ ...variantForm, model: event.target.value })} /></Field><Field label="尺寸"><input value={variantForm.size} onChange={(event) => setVariantForm({ ...variantForm, size: event.target.value })} /></Field><Field label="材质"><input value={variantForm.material} onChange={(event) => setVariantForm({ ...variantForm, material: event.target.value })} /></Field><Field label="单位"><input required value={variantForm.unit} onChange={(event) => setVariantForm({ ...variantForm, unit: event.target.value })} /></Field><Field label="最低库存"><input type="number" min="0" step="0.0001" value={variantForm.minimumStock} onChange={(event) => setVariantForm({ ...variantForm, minimumStock: event.target.value })} /></Field><Field label="默认采购价"><input type="number" min="0" step="0.0001" value={variantForm.defaultPurchasePrice} onChange={(event) => setVariantForm({ ...variantForm, defaultPurchasePrice: event.target.value })} /></Field><Field label="厂家二维码"><input value={variantForm.manufacturerQr} onChange={(event) => setVariantForm({ ...variantForm, manufacturerQr: event.target.value })} /></Field><Field label="系统二维码"><input readOnly value={selectedVariant?.systemQr ?? '保存后由系统生成'} /></Field><Field label="启用状态"><input type="checkbox" checked={variantForm.active} onChange={(event) => setVariantForm({ ...variantForm, active: event.target.checked })} /></Field></div><button type="submit">保存型号</button></form>
      </section>}

      <section className="warehouse-catalog-sites" aria-labelledby="warehouse-site-title"><header><h3 id="warehouse-site-title">仓库与货架区</h3>{canManageCatalog && <div className="warehouse-catalog-actions"><button type="button" onClick={() => setSiteForm(siteDraft())}>新增仓库</button><button type="button" onClick={() => setSiteForm(siteDraft(locationData.sites[0]))}>编辑仓库</button><button type="button" onClick={() => setShelfForm(locationDraft({}, siteForm.id || locationData.sites[0]?.id))}>新增货架区</button><button type="button" onClick={() => setShelfForm(locationDraft(locationData.locations[0]))}>编辑货架区</button></div>}</header>
        <div className="warehouse-catalog-site-grid">{locationData.sites.map((site) => <article key={site.id} className="warehouse-catalog-site-card">
          <div className="warehouse-catalog-site-actions"><h4>{site.name}</h4>{canManageCatalog && <button type="button" aria-label={`编辑仓库 ${site.name}`} onClick={() => setSiteForm(siteDraft(site))}>编辑仓库</button>}</div>
          <p>{SITE_KIND_LABELS[site.kind]} · {site.code} · {site.active ? '启用' : '停用'}</p>
          <ul>{locationData.locations.filter((location) => location.warehouseId === site.id).map((location) => <li key={location.id} className="warehouse-catalog-shelf-row"><span>{location.shelfName}（{location.shelfCode}） · {location.active ? '启用' : '停用'}</span>{canManageCatalog && <button type="button" aria-label={`编辑货架区 ${location.shelfName}`} onClick={() => setShelfForm(locationDraft(location))}>编辑货架区</button>}</li>)}</ul>
        </article>)}</div>
        {canManageCatalog && <div className="warehouse-catalog-site-forms"><form className="warehouse-catalog-form" onSubmit={submitSite}><h3>仓库资料</h3><div className="warehouse-catalog-form-grid"><Field label="仓库编码"><input required value={siteForm.code} onChange={(event) => setSiteForm({ ...siteForm, code: event.target.value })} /></Field><Field label="仓库名称"><input required value={siteForm.name} onChange={(event) => setSiteForm({ ...siteForm, name: event.target.value })} /></Field><Field label="仓库类型"><select value={siteForm.kind} onChange={(event) => setSiteForm({ ...siteForm, kind: event.target.value })}><option value="normal">普通仓库</option><option value="project_site">项目现场仓</option><option value="shared_tool">共享工具仓</option></select></Field><Field label="启用状态"><input type="checkbox" checked={siteForm.active} onChange={(event) => setSiteForm({ ...siteForm, active: event.target.checked })} /></Field></div><button type="submit">保存仓库</button></form>
          <form className="warehouse-catalog-form" onSubmit={submitShelf}><h3>货架区资料</h3><div className="warehouse-catalog-form-grid"><Field label="所属仓库"><select required value={shelfForm.warehouseId} onChange={(event) => setShelfForm({ ...shelfForm, warehouseId: event.target.value })}>{locationData.sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field><Field label="货架编码"><input required value={shelfForm.shelfCode} onChange={(event) => setShelfForm({ ...shelfForm, shelfCode: event.target.value })} /></Field><Field label="货架名称"><input required value={shelfForm.shelfName} onChange={(event) => setShelfForm({ ...shelfForm, shelfName: event.target.value })} /></Field><Field label="启用状态"><input type="checkbox" checked={shelfForm.active} onChange={(event) => setShelfForm({ ...shelfForm, active: event.target.checked })} /></Field></div><button type="submit">保存货架区</button></form></div>}
      </section>
      <WarehouseQrScanner open={scannerOpen} warehouseService={warehouseService} onResolved={scannerResolved} onClose={() => setScannerOpen(false)} />
      {label && <WarehouseLabelSheet label={label} />}
    </section>
  )
}

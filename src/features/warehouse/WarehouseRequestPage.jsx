import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import './warehouse.css'
import {
  addScaledUnits,
  parseQuantityUnits,
  quantityUnitsToNumber,
} from './warehouseDecimal.js'

const WarehouseQrScanner = lazy(() => import('./WarehouseQrScanner.jsx'))

const EMPTY_CATALOG = Object.freeze({ items: Object.freeze([]), variants: Object.freeze([]) })
const EMPTY_LOCATIONS = Object.freeze({ sites: Object.freeze([]), locations: Object.freeze([]) })
const EMPTY_CONTEXT = Object.freeze({
  stockOutRequests: Object.freeze([]),
  returnRequests: Object.freeze([]),
  minorWorkOrders: Object.freeze([]),
})

const createKey = (prefix) => `${prefix}:${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
const messageOf = (error) => error?.message || '操作失败，请重试'
const projectIdOf = (project) => project?.projectId ?? project?.id ?? project?.recordKey ?? ''
const projectNameOf = (project) => project?.projectName ?? project?.name ?? projectIdOf(project)

export function tokyoDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${byType.year}-${byType.month}-${byType.day}`
}

export function createDraftKeyStore(factory = createKey) {
  const keys = new Map()
  return Object.freeze({
    current(scope) {
      if (!keys.has(scope)) keys.set(scope, factory(scope))
      return keys.get(scope)
    },
    complete(scope) { keys.delete(scope) },
  })
}

export function sumWarehouseQuantities(values) {
  return quantityUnitsToNumber(values.reduce(
    (total, value) => addScaledUnits(total, parseQuantityUnits(value)),
    0n,
  ))
}

function Field({ label, children, className = '' }) {
  return <label className={`warehouse-request-field ${className}`}><span>{label}</span>{children}</label>
}

function VariantDetails({ item, variant, photo, viewCost }) {
  if (!variant) return <p className="warehouse-request-empty">请选择仓库物品型号。</p>
  return (
    <article className="warehouse-request-variant" aria-label="物品明细">
      {(photo?.signedUrl || photo?.url) && <img src={photo.signedUrl || photo.url} alt={`${item?.name || '物品'}照片`} />}
      <div><strong>{item?.name || '未命名物品'} · {variant.sku}</strong>
        <span>型号：{variant.model || '—'}</span>
        <span>规格尺寸：{variant.size || '—'}</span>
        <span>材质：{variant.material || '—'}</span>
        <span>单位：{variant.unit}</span>
        {viewCost && variant.defaultPurchasePrice !== null && (
          <span>参考采购单价：¥{variant.defaultPurchasePrice}</span>
        )}
      </div>
    </article>
  )
}

function StatusPill({ status }) {
  const labels = { pending: '待仓库负责人确认', confirmed: '已确认', rejected: '已驳回', void: '已作废' }
  return <span className={`warehouse-request-status status-${status}`}>{labels[status] || status}</span>
}

export default function WarehouseRequestPage({
  mode = 'stockOut',
  projects = [],
  currentUser = null,
  onBack,
  onAuthInvalid,
  warehouseService,
  confirmationService,
  warehouseMediaService,
  initialCatalog = null,
  initialLocations = null,
  initialBalances = null,
  initialContext = null,
  photosByVariant = {},
  viewCost = false,
  canRequest = false,
  canConfirm = false,
}) {
  const initialReturnableIssue = initialContext?.stockOutRequests?.find((request) =>
    request.status === 'confirmed' && request.lines?.some((line) => Number(line.remainingReturnable) > 0))
  const initialReturnableLine = initialReturnableIssue?.lines?.find((line) =>
    Number(line.remainingReturnable) > 0)
  const [catalog, setCatalog] = useState(initialCatalog ?? EMPTY_CATALOG)
  const [locations, setLocations] = useState(initialLocations ?? EMPTY_LOCATIONS)
  const [balances, setBalances] = useState(initialBalances ?? [])
  const [context, setContext] = useState(initialContext ?? EMPTY_CONTEXT)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [variantId, setVariantId] = useState(initialCatalog?.variants?.[0]?.id ?? '')
  const [quantity, setQuantity] = useState('1')
  const [destinationType, setDestinationType] = useState('project')
  const [projectId, setProjectId] = useState(projectIdOf(projects[0]))
  const [minorWorkOrderId, setMinorWorkOrderId] = useState(initialContext?.minorWorkOrders?.[0]?.id ?? '')
  const [internalName, setInternalName] = useState('公司内部使用')
  const [receiver, setReceiver] = useState(currentUser?.name ?? '')
  const [purpose, setPurpose] = useState('')
  const [requestDate, setRequestDate] = useState(tokyoDate)
  const [originalStockOutId, setOriginalStockOutId] = useState(initialReturnableIssue?.id ?? '')
  const [originalLineId, setOriginalLineId] = useState(initialReturnableLine?.id ?? '')
  const [reason, setReason] = useState('现场未使用材料退回')
  const [loadedPhotosByVariant, setLoadedPhotosByVariant] = useState(photosByVariant)
  const [locationSelection, setLocationSelection] = useState({})
  const [rejectionReasons, setRejectionReasons] = useState({})
  const [minorDraft, setMinorDraft] = useState({
    title: '', customerName: '', workDate: tokyoDate(), locationText: '', description: '',
  })
  const generationRef = useRef(0)
  const photoGenerationRef = useRef(0)
  const draftKeysRef = useRef(null)
  if (draftKeysRef.current === null) draftKeysRef.current = createDraftKeyStore(createKey)

  const load = useCallback(async () => {
    if (!warehouseService?.listCatalog || !confirmationService?.listRequestContext) return
    const generation = ++generationRef.current
    setLoading(true)
    setError('')
    try {
      const [nextCatalog, nextLocations, nextBalances, nextContext] = await Promise.all([
        warehouseService.listCatalog(), warehouseService.listLocations(),
        warehouseService.listBalances(), confirmationService.listRequestContext(),
      ])
      if (generation !== generationRef.current) return
      setCatalog(nextCatalog)
      setLocations(nextLocations)
      setBalances(nextBalances)
      setContext(nextContext)
      setVariantId((current) => current || nextCatalog.variants[0]?.id || '')
      setMinorWorkOrderId((current) => current || nextContext.minorWorkOrders[0]?.id || '')
    } catch (loadError) {
      if (generation !== generationRef.current) return
      if (loadError?.authInvalid) onAuthInvalid?.()
      setError(messageOf(loadError))
    } finally {
      if (generation === generationRef.current) setLoading(false)
    }
  }, [confirmationService, onAuthInvalid, warehouseService])

  useEffect(() => {
    if (initialCatalog === null || initialLocations === null ||
        initialBalances === null || initialContext === null) void load()
    return () => { generationRef.current += 1 }
  }, [initialBalances, initialCatalog, initialContext, initialLocations, load])

  useEffect(() => {
    const availableProjectIds = projects.map(projectIdOf).filter(Boolean)
    setProjectId((current) => availableProjectIds.includes(current)
      ? current
      : (availableProjectIds[0] || ''))
  }, [projects])

  const itemById = useMemo(() => new Map(catalog.items.map((item) => [item.id, item])), [catalog])
  const variants = useMemo(() => catalog.variants.filter((variant) => {
    const item = itemById.get(variant.itemId)
    const haystack = `${item?.name || ''} ${variant.sku} ${variant.model} ${variant.size} ${variant.material}`.toLowerCase()
    return variant.active !== false && haystack.includes(query.trim().toLowerCase())
  }), [catalog.variants, itemById, query])
  const selectedVariant = catalog.variants.find((variant) => variant.id === variantId)
  const selectedItem = selectedVariant ? itemById.get(selectedVariant.itemId) : null
  const availableBalances = balances.filter((balance) => balance.variantId === variantId)
  const available = sumWarehouseQuantities(availableBalances.map((balance) => balance.quantity))
  const availableUnits = parseQuantityUnits(available)
  let requestedUnits = null
  try { requestedUnits = parseQuantityUnits(Number(quantity)) } catch { requestedUnits = null }
  const stockIsLow = requestedUnits === null || availableUnits < requestedUnits
  const siteById = new Map(locations.sites.map((site) => [site.id, site]))
  const locationById = new Map(locations.locations.map((location) => [location.id, location]))
  const locationLabel = (balance, unit = '') => {
    const location = locationById.get(balance.locationId)
    const site = siteById.get(balance.warehouseId)
    return `${site?.name || '仓库'} · ${location?.shelfCode || ''} ${location?.shelfName || ''} · 可用 ${balance.quantity} ${unit}`
  }
  const returnableIssues = useMemo(() => context.stockOutRequests.filter((request) =>
    request.status === 'confirmed' && request.lines.some((line) =>
      parseQuantityUnits(line.remainingReturnable) > 0n)), [context.stockOutRequests])
  const selectedIssue = returnableIssues.find((request) => request.id === originalStockOutId)
  const selectedReturnLine = selectedIssue?.lines.find((line) => line.id === originalLineId)
  const photoVariantId = mode === 'stockReturn' ? selectedReturnLine?.variantId : variantId

  useEffect(() => {
    if (!photoVariantId || !warehouseMediaService?.listVariantPhotos || loadedPhotosByVariant[photoVariantId]) {
      return undefined
    }
    const generation = ++photoGenerationRef.current
    void warehouseMediaService.listVariantPhotos(photoVariantId).then((photos) => {
      if (generation !== photoGenerationRef.current) return
      setLoadedPhotosByVariant((current) => ({ ...current, [photoVariantId]: photos }))
    }).catch((photoError) => {
      if (generation !== photoGenerationRef.current) return
      if (photoError?.authInvalid) onAuthInvalid?.()
    })
    return () => { photoGenerationRef.current += 1 }
  }, [loadedPhotosByVariant, onAuthInvalid, photoVariantId, warehouseMediaService])

  useEffect(() => {
    if (mode !== 'stockReturn' || returnableIssues.length === 0) return
    const issue = returnableIssues.find((entry) => entry.id === originalStockOutId) ?? returnableIssues[0]
    const line = issue.lines.find((entry) => parseQuantityUnits(entry.remainingReturnable) > 0n)
    setOriginalStockOutId(issue.id)
    setOriginalLineId((current) => issue.lines.some((entry) =>
      entry.id === current && parseQuantityUnits(entry.remainingReturnable) > 0n)
      ? current
      : line?.id ?? '')
  }, [mode, originalStockOutId, returnableIssues])

  const destinationName = destinationType === 'project'
    ? projectNameOf(projects.find((project) => projectIdOf(project) === projectId))
    : destinationType === 'minor_work_order'
      ? (() => {
          const job = context.minorWorkOrders.find((entry) => entry.id === minorWorkOrderId)
          return job ? `${job.customerName}・${job.title}` : ''
        })()
      : internalName

  const submitStockOut = async (event) => {
    event.preventDefault()
    if (!canRequest) return
    setBusy(true); setError(''); setNotice('')
    try {
      await warehouseService.submitStockOut({
        destinationType,
        projectId: destinationType === 'project' ? projectId : null,
        minorWorkOrderId: destinationType === 'minor_work_order' ? minorWorkOrderId : null,
        destinationNameSnapshot: destinationName,
        purpose, receiver, requestDate,
        idempotencyKey: draftKeysRef.current.current('stock-out-submit'),
        lines: [{ variantId, requestedQuantity: Number(quantity) }],
      })
      draftKeysRef.current.complete('stock-out-submit')
      setNotice('出库申请已提交，待仓库负责人确认后才会扣减库存。')
      await load()
    } catch (submitError) { setError(messageOf(submitError)) }
    finally { setBusy(false) }
  }

  const submitReturn = async (event) => {
    event.preventDefault()
    if (!canRequest) return
    setBusy(true); setError(''); setNotice('')
    try {
      await warehouseService.submitReturn({
        originalStockOutId, reason, receiver, requestDate,
        idempotencyKey: draftKeysRef.current.current('return-submit'),
        lines: [{ originalStockOutLineId: originalLineId, requestedQuantity: Number(quantity) }],
      })
      draftKeysRef.current.complete('return-submit')
      setNotice('退回申请已提交，待仓库负责人确认后才会增加库存。')
      await load()
    } catch (submitError) { setError(messageOf(submitError)) }
    finally { setBusy(false) }
  }

  const confirmStockOut = async (request) => {
    const lines = request.lines.map((line) => {
      const locationId = locationSelection[`${request.id}:${line.id}`]
      const candidate = balances.find((balance) =>
        balance.variantId === line.variantId && balance.locationId === locationId)
      if (!candidate) throw new Error('库存不足或没有可用货架区，不能确认出库。')
      if (parseQuantityUnits(candidate.quantity) < parseQuantityUnits(line.requestedQuantity)) {
        throw new Error('所选货架区库存不足，不能确认出库。')
      }
      return {
        stockOutLineId: line.id, confirmedQuantity: line.requestedQuantity,
        warehouseId: candidate.warehouseId, locationId: candidate.locationId,
      }
    })
    const scope = `stock-out-confirm:${request.id}`
    await confirmationService.confirmStockOut({
      requestId: request.id, idempotencyKey: draftKeysRef.current.current(scope), lines,
    })
    draftKeysRef.current.complete(scope)
  }

  const confirmReturn = async (request) => {
    const scope = `return-confirm:${request.id}`
    await confirmationService.confirmReturn({
      returnId: request.id,
      idempotencyKey: draftKeysRef.current.current(scope),
      lines: request.lines.map((line) => ({
        returnLineId: line.id, confirmedQuantity: line.requestedQuantity,
      })),
    })
    draftKeysRef.current.complete(scope)
  }

  const createMinorWorkOrder = async () => {
    if (!canRequest) return
    setBusy(true); setError(''); setNotice('')
    try {
      const created = await warehouseService.createMinorWorkOrder(minorDraft)
      setContext((current) => ({
        ...current,
        minorWorkOrders: [created, ...current.minorWorkOrders.filter((job) => job.id !== created.id)],
      }))
      setMinorWorkOrderId(created.id)
      setDestinationType('minor_work_order')
      setMinorDraft({ title: '', customerName: '', workDate: tokyoDate(), locationText: '', description: '' })
      setNotice('小工事已建立，可直接作为本次出库去向。')
    } catch (createError) { setError(messageOf(createError)) }
    finally { setBusy(false) }
  }

  const confirm = async (request, kind) => {
    setBusy(true); setError(''); setNotice('')
    try {
      if (kind === 'out') await confirmStockOut(request)
      else await confirmReturn(request)
      setNotice(kind === 'out' ? '出库已确认，库存已扣减。' : '退回已确认，库存已按原批次价格增加。')
      await load()
    } catch (confirmError) { setError(messageOf(confirmError)) }
    finally { setBusy(false) }
  }

  const reject = async (request, kind) => {
    const rejectionReason = rejectionReasons[request.id]?.trim() || ''
    if (!rejectionReason) {
      setError('请输入驳回原因。')
      return
    }
    setBusy(true); setError(''); setNotice('')
    const scope = `${kind === 'out' ? 'stock-out' : 'return'}-reject:${request.id}`
    try {
      if (kind === 'out') {
        await confirmationService.rejectStockOut({
          requestId: request.id,
          reason: rejectionReason,
          idempotencyKey: draftKeysRef.current.current(scope),
        })
      } else {
        await confirmationService.rejectReturn({
          returnId: request.id,
          reason: rejectionReason,
          idempotencyKey: draftKeysRef.current.current(scope),
        })
      }
      draftKeysRef.current.complete(scope)
      setNotice('申请已驳回，库存没有发生变化。')
      setRejectionReasons((current) => ({ ...current, [request.id]: '' }))
      await load()
    } catch (rejectError) { setError(messageOf(rejectError)) }
    finally { setBusy(false) }
  }

  const documents = mode === 'stockOut' ? context.stockOutRequests : context.returnRequests
  const actorProfileId = typeof currentUser?.id === 'string' ? currentUser.id : ''
  const panels = canConfirm
    ? [
        {
          key: 'pending', title: '仓库负责人待确认', confirm: true,
          empty: '当前没有待确认单据。',
          requests: documents.filter((request) => request.status === 'pending'),
        },
        ...(canRequest && actorProfileId ? [{
          key: 'history', title: '我的申请进度', confirm: false,
          empty: '当前没有申请记录。',
          requests: documents.filter((request) =>
            request.submittedByEmployeeProfileId === actorProfileId),
        }] : []),
      ]
    : [{
        key: 'history', title: '我的申请进度', confirm: false,
        empty: '当前没有申请记录。', requests: documents,
      }]

  return (
    <main className="warehouse-management-page warehouse-request-page">
      <header className="warehouse-request-header">
        <div><p>仓库管理 · 安全申请流程</p><h1>{mode === 'stockOut' ? '我要出库' : '我要退回'}</h1></div>
        {onBack && <button type="button" className="ghost-button" onClick={onBack}>返回首页</button>}
      </header>
      {loading && <p role="status">正在读取仓库实时数据…</p>}
      {error && <div className="warehouse-request-alert is-error" role="alert">{error}<button type="button" onClick={load}>重试</button></div>}
      {notice && <div className="warehouse-request-alert is-success" role="status">{notice}</div>}

      {canRequest && <section className="warehouse-request-panel">
        <div className="warehouse-request-panel-title">
          <h2>{mode === 'stockOut' ? '新建出库申请' : '按原出库单退回'}</h2>
          {mode === 'stockOut' && <button type="button" onClick={() => setScannerOpen(true)}>扫描二维码</button>}
        </div>
        {mode === 'stockOut' ? (
          <form className="warehouse-request-form" onSubmit={submitStockOut}>
            <Field label="搜索物品"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="名称、货号、型号、尺寸" /></Field>
            <Field label="物品与型号"><select required value={variantId} onChange={(event) => setVariantId(event.target.value)}>{variants.map((variant) => <option key={variant.id} value={variant.id}>{itemById.get(variant.itemId)?.name} · {variant.sku} · {variant.model}</option>)}</select></Field>
            <VariantDetails item={selectedItem} variant={selectedVariant} photo={loadedPhotosByVariant[variantId]?.[0]} viewCost={viewCost} />
            <p className={`warehouse-request-stock ${stockIsLow ? 'is-low' : ''}`}>实时可用库存：{available} {selectedVariant?.unit || ''}{stockIsLow && '（库存不足，仓库负责人不能确认）'}</p>
            <div className="warehouse-request-distribution"><strong>库存分布</strong>{balances.filter((balance) => balance.variantId === variantId).map((balance) => <span key={`${balance.warehouseId}:${balance.locationId}`}>{locationLabel(balance, selectedVariant?.unit)}</span>)}</div>
            <Field label="领用数量"><input required min="0.001" step="0.001" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
            <Field label="出库去向"><select value={destinationType} onChange={(event) => setDestinationType(event.target.value)}><option value="project">正式项目</option><option value="minor_work_order">小工事</option><option value="internal_use">公司内部使用</option></select></Field>
            {destinationType === 'project' && <Field label="项目"><select required value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={projectIdOf(project)} value={projectIdOf(project)}>{projectNameOf(project)}</option>)}</select></Field>}
            {destinationType === 'minor_work_order' && <Field label="小工事"><select required value={minorWorkOrderId} onChange={(event) => setMinorWorkOrderId(event.target.value)}>{context.minorWorkOrders.map((job) => <option key={job.id} value={job.id}>{job.title} · {job.customerName}</option>)}</select></Field>}
            {destinationType === 'internal_use' && <Field label="内部用途名称"><input required value={internalName} onChange={(event) => setInternalName(event.target.value)} /></Field>}
            {destinationType === 'minor_work_order' && <fieldset className="warehouse-request-minor-create"><legend>新建小工事（不进入主项目）</legend>
              <Field label="小工事名称"><input value={minorDraft.title} onChange={(event) => setMinorDraft((draft) => ({ ...draft, title: event.target.value }))} /></Field>
              <Field label="客户名称"><input value={minorDraft.customerName} onChange={(event) => setMinorDraft((draft) => ({ ...draft, customerName: event.target.value }))} /></Field>
              <Field label="工作日期"><input type="date" value={minorDraft.workDate} onChange={(event) => setMinorDraft((draft) => ({ ...draft, workDate: event.target.value }))} /></Field>
              <Field label="作业地点"><input value={minorDraft.locationText} onChange={(event) => setMinorDraft((draft) => ({ ...draft, locationText: event.target.value }))} /></Field>
              <Field label="工作说明"><textarea value={minorDraft.description} onChange={(event) => setMinorDraft((draft) => ({ ...draft, description: event.target.value }))} /></Field>
              <button type="button" disabled={busy || !minorDraft.title || !minorDraft.customerName || !minorDraft.locationText} onClick={() => void createMinorWorkOrder()}>建立并选用小工事</button>
            </fieldset>}
            <Field label="领用人"><input required value={receiver} onChange={(event) => setReceiver(event.target.value)} /></Field>
            <Field label="用途说明"><textarea required value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
            <Field label="申请日期"><input required type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></Field>
            <button className="primary-button" disabled={busy || !variantId} type="submit">提交出库申请</button>
          </form>
        ) : (
          <form className="warehouse-request-form" onSubmit={submitReturn}>
            <Field label="原出库单"><select required value={originalStockOutId} onChange={(event) => { const id = event.target.value; setOriginalStockOutId(id); const issue = returnableIssues.find((entry) => entry.id === id); setOriginalLineId(issue?.lines.find((line) => Number(line.remainingReturnable) > 0)?.id || '') }}>{returnableIssues.map((issue) => <option key={issue.id} value={issue.id}>{issue.requestDate} · {issue.destinationNameSnapshot} · {issue.receiver}</option>)}</select></Field>
            <Field label="原出库物品"><select required value={originalLineId} onChange={(event) => setOriginalLineId(event.target.value)}>{selectedIssue?.lines.filter((line) => Number(line.remainingReturnable) > 0).map((line) => { const variant = catalog.variants.find((entry) => entry.id === line.variantId); return <option key={line.id} value={line.id}>{itemById.get(variant?.itemId)?.name} · {variant?.sku} · 剩余可退 {line.remainingReturnable}</option> })}</select></Field>
            {selectedReturnLine && (() => { const variant = catalog.variants.find((entry) => entry.id === selectedReturnLine.variantId); return <><VariantDetails item={itemById.get(variant?.itemId)} variant={variant} photo={loadedPhotosByVariant[variant?.id]?.[0]} viewCost={false} /><p>剩余可退：{selectedReturnLine.remainingReturnable} {variant?.unit}</p><p>原去向：{selectedIssue.destinationNameSnapshot}</p>{viewCost && selectedReturnLine.frozenTotalCost !== null && <p>原出库冻结成本：¥{selectedReturnLine.frozenTotalCost}</p>}</> })()}
            <Field label="退回数量"><input required min="0.001" max={selectedReturnLine?.remainingReturnable} step="0.001" type="number" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
            <Field label="退回原因"><textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
            <Field label="交回人"><input required value={receiver} onChange={(event) => setReceiver(event.target.value)} /></Field>
            <Field label="申请日期"><input required type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} /></Field>
            <button className="primary-button" disabled={busy || !originalLineId} type="submit">提交退回申请</button>
          </form>
        )}
      </section>}

      {panels.map((panel) => <section className="warehouse-request-panel" key={panel.key}>
        <h2>{panel.title}</h2>
        {panel.requests.length === 0 && <p className="warehouse-request-empty">{panel.empty}</p>}
        <div className="warehouse-request-list">{panel.requests.map((request) => (
          <article key={request.id} className="warehouse-request-card">
            <div><strong>{request.destinationNameSnapshot || request.reason}</strong><StatusPill status={request.status} /></div>
            <p>{request.requestDate} · {request.receiver}</p>
            {request.status === 'confirmed' && request.confirmedAt && <p>确认时间：{request.confirmedAt}</p>}
            {request.status === 'rejected' && request.rejectionReason && <p className="warehouse-request-rejection">驳回原因：{request.rejectionReason}</p>}
            {request.lines.map((line) => { const variant = catalog.variants.find((entry) => entry.id === line.variantId); const lineBalances = balances.filter((balance) => balance.variantId === line.variantId && Number(balance.quantity) > 0); return <div className="warehouse-request-confirm-line" key={line.id}><p>{itemById.get(variant?.itemId)?.name || '物品'} · {variant?.model || ''} · {line.requestedQuantity} {variant?.unit || ''}{viewCost && line.frozenTotalCost !== null ? ` · ¥${line.frozenTotalCost}` : ''}</p>{panel.confirm && mode === 'stockOut' && <Field label="确认货架区"><select required value={locationSelection[`${request.id}:${line.id}`] || ''} onChange={(event) => setLocationSelection((current) => ({ ...current, [`${request.id}:${line.id}`]: event.target.value }))}><option value="">请选择仓库与货架</option>{lineBalances.map((balance) => <option key={`${balance.warehouseId}:${balance.locationId}`} value={balance.locationId}>{locationLabel(balance, variant?.unit)}</option>)}</select></Field>}</div> })}
            {panel.confirm && <div className="warehouse-request-decision-actions">
              <button type="button" disabled={busy} onClick={() => void confirm(request, mode === 'stockOut' ? 'out' : 'return')}>{mode === 'stockOut' ? '确认出库并扣减库存' : '确认退回'}</button>
              <Field label="驳回原因"><input value={rejectionReasons[request.id] || ''} onChange={(event) => setRejectionReasons((current) => ({ ...current, [request.id]: event.target.value }))} /></Field>
              <button type="button" className="ghost-button" disabled={busy} onClick={() => void reject(request, mode === 'stockOut' ? 'out' : 'return')}>驳回申请</button>
            </div>}
          </article>
        ))}</div>
      </section>)}
      {canRequest && scannerOpen && <Suspense fallback={<p role="status">正在载入扫码器…</p>}><WarehouseQrScanner open warehouseService={warehouseService} onClose={() => setScannerOpen(false)} onResolved={(resolved) => { setVariantId(resolved.id); setQuery(resolved.sku); setScannerOpen(false) }} /></Suspense>}
    </main>
  )
}

import React, { useEffect, useMemo, useRef, useState } from 'react'

import { parseQuantityUnits } from './warehouseDecimal.js'

const createId = () => globalThis.crypto?.randomUUID?.() ?? '00000000-0000-4000-8000-000000000001'
const messageOf = (error) => error?.message || '仓库操作失败，请刷新后重试'
const monthNow = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit',
}).format(new Date()).slice(0, 7)

function Field({ label, children }) {
  return <label className="warehouse-operation-field"><span>{label}</span>{children}</label>
}

function itemMaps(catalog) {
  const items = Array.isArray(catalog?.items) ? catalog.items : []
  const variants = Array.isArray(catalog?.variants) ? catalog.variants : []
  return {
    variants,
    itemById: new Map(items.map((item) => [item.id, item])),
    variantById: new Map(variants.map((variant) => [variant.id, variant])),
  }
}

function locationMaps(locationData) {
  const sites = Array.isArray(locationData?.sites) ? locationData.sites : []
  const locations = Array.isArray(locationData?.locations) ? locationData.locations : []
  return {
    sites,
    locations,
    siteById: new Map(sites.map((site) => [site.id, site])),
    locationById: new Map(locations.map((location) => [location.id, location])),
  }
}

function locationLabel(location, siteById) {
  const site = siteById.get(location?.warehouseId)
  return `${site?.name || '未知仓库'} · ${location?.shelfName || location?.shelfCode || '未知货架'}`
}

function pendingCount(context, key) {
  return (Array.isArray(context?.[key]) ? context[key] : [])
    .filter((document) => document?.status === 'pending').length
}

export function createWarehouseOperationFence(idFactory = createId) {
  const entries = new Map()
  return Object.freeze({
    acquire(scope, fingerprint, lineCount = 0) {
      const existing = entries.get(scope)
      if (existing?.fingerprint === fingerprint) return existing.identity
      const identity = Object.freeze({
        fingerprint,
        idempotencyKey: `${scope}:${idFactory()}`,
        documentId: idFactory(),
        lineIds: Object.freeze(Array.from({ length: lineCount }, () => idFactory())),
      })
      entries.set(scope, { fingerprint, identity })
      return identity
    },
    complete(scope, identity) {
      if (entries.get(scope)?.identity === identity) entries.delete(scope)
    },
  })
}

export default function WarehouseOperations({
  mode = 'operations',
  snapshot,
  access = {},
  warehouseConfirmationService,
  onChanged,
  onNavigate,
}) {
  const { variants, itemById, variantById } = useMemo(
    () => itemMaps(snapshot?.catalog),
    [snapshot?.catalog],
  )
  const { sites, locations, siteById, locationById } = useMemo(
    () => locationMaps(snapshot?.locations),
    [snapshot?.locations],
  )
  const balances = Array.isArray(snapshot?.balances) ? snapshot.balances : []
  const receiptRows = Array.isArray(snapshot?.receiptRows) ? snapshot.receiptRows : []
  const receiptGroups = useMemo(() => {
    const groups = new Map()
    for (const row of receiptRows) {
      if (!groups.has(row.receiptId)) groups.set(row.receiptId, [])
      groups.get(row.receiptId).push(row)
    }
    return [...groups.entries()].map(([receiptId, rows]) => ({ receiptId, rows }))
  }, [receiptRows])
  const reversalOptions = [
    access.confirmReceipt && ['warehouse_receipt', '采购入库'],
    access.confirmStockFlow && ['warehouse_stock_out', '出库'],
    access.confirmStockFlow && ['warehouse_return', '退回'],
    access.transfer && ['warehouse_transfer', '调拨'],
    access.stocktake && ['warehouse_stocktake', '盘点'],
  ].filter(Boolean)
  const canOpenStockFlow = access.requestStockFlow || access.confirmStockFlow
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const operationFence = useRef(null)
  if (operationFence.current === null) operationFence.current = createWarehouseOperationFence()

  const [transfer, setTransfer] = useState(() => ({
    variantId: balances[0]?.variantId ?? variants[0]?.id ?? '',
    sourceLocationId: balances[0]?.locationId ?? '',
    destinationLocationId: locations.find((location) => location.id !== balances[0]?.locationId)?.id ?? '',
    quantity: '1', reason: '',
  }))
  const [reversal, setReversal] = useState({
    sourceDocumentType: reversalOptions[0]?.[0] ?? '', sourceDocumentId: '', reason: '',
  })
  const [warehouseId, setWarehouseId] = useState(sites[0]?.id ?? '')
  const [stocktakeMonth, setStocktakeMonth] = useState(monthNow)
  const [counts, setCounts] = useState({})
  const [differenceTypes, setDifferenceTypes] = useState({})
  const [reasons, setReasons] = useState({})
  const [approvedCosts, setApprovedCosts] = useState({})
  const [receiptLocationSelection, setReceiptLocationSelection] = useState({})

  const stocktakeBalances = useMemo(
    () => balances.filter((balance) => balance.warehouseId === warehouseId),
    [balances, warehouseId],
  )
  useEffect(() => {
    setCounts(Object.fromEntries(stocktakeBalances.map((balance) => [
      `${balance.variantId}:${balance.locationId}`, String(balance.quantity),
    ])))
    setDifferenceTypes({})
    setReasons({})
    setApprovedCosts({})
  }, [stocktakeBalances])
  useEffect(() => {
    if (reversalOptions.some(([value]) => value === reversal.sourceDocumentType)) return
    setReversal((current) => ({
      ...current,
      sourceDocumentType: reversalOptions[0]?.[0] ?? '',
    }))
  }, [access.confirmReceipt, access.confirmStockFlow, access.stocktake, access.transfer, reversal.sourceDocumentType])

  const run = async (scope, identity, operation, success) => {
    setBusy(true)
    setMessage('')
    try {
      await operation(identity.idempotencyKey)
      operationFence.current.complete(scope, identity)
      await onChanged?.()
      setMessage(success)
    } catch (error) {
      setMessage(messageOf(error))
    } finally {
      setBusy(false)
    }
  }

  const submitTransfer = (event) => {
    event.preventDefault()
    const source = locationById.get(transfer.sourceLocationId)
    const destination = locationById.get(transfer.destinationLocationId)
    if (!source || !destination) return setMessage('请选择有效的来源与目标货架区')
    const fingerprint = JSON.stringify(transfer)
    const identity = operationFence.current.acquire('transfer', fingerprint)
    return run('transfer', identity, (idempotencyKey) => warehouseConfirmationService.confirmTransfer({
      transferId: identity.documentId,
      variantId: transfer.variantId,
      sourceWarehouseId: source.warehouseId,
      sourceLocationId: source.id,
      destinationWarehouseId: destination.warehouseId,
      destinationLocationId: destination.id,
      quantity: Number(transfer.quantity),
      reason: transfer.reason.trim(),
      idempotencyKey,
    }), '调拨已确认，来源与目标库存已经同步更新。')
  }

  const submitReversal = (event) => {
    event.preventDefault()
    const fingerprint = JSON.stringify(reversal)
    const identity = operationFence.current.acquire('reversal', fingerprint)
    return run('reversal', identity, (idempotencyKey) => warehouseConfirmationService.reverseOperation({
      sourceDocumentType: reversal.sourceDocumentType,
      sourceDocumentId: reversal.sourceDocumentId.trim(),
      reason: reversal.reason.trim(),
      idempotencyKey,
    }), '整单冲销完成，原单保留并已追加相反库存流水。')
  }

  const confirmReceipt = (receipt) => {
    let lines
    try {
      lines = receipt.rows.map((row) => {
        const location = locationById.get(receiptLocationSelection[row.receiptLineId])
        if (!location || location.active === false) throw new Error()
        return {
          receiptLineId: row.receiptLineId,
          confirmedQuantity: row.quantity,
          warehouseId: location.warehouseId,
          locationId: location.id,
        }
      })
    } catch {
      setMessage('请为每一项到货选择有效仓库货架')
      return
    }
    const scope = `receipt:${receipt.receiptId}`
    const identity = operationFence.current.acquire(scope, JSON.stringify(lines))
    return run(scope, identity, (idempotencyKey) => warehouseConfirmationService.confirmReceipt({
      receiptId: receipt.receiptId, idempotencyKey, lines,
    }), '采购到货已确认，库存已经按采购批次价格增加。')
  }

  const submitStocktake = (event) => {
    event.preventDefault()
    let lines
    try {
      lines = stocktakeBalances.map((balance) => {
        const identity = `${balance.variantId}:${balance.locationId}`
        const countedQuantity = Number(counts[identity])
        if (!Number.isFinite(countedQuantity) || countedQuantity < 0) throw new TypeError()
        const book = parseQuantityUnits(balance.quantity)
        const counted = parseQuantityUnits(countedQuantity)
        const inferred = counted === book ? 'no_change' : counted > book ? 'gain' : 'loss'
        const differenceType = differenceTypes[identity] || inferred
        return {
          variantId: balance.variantId,
          locationId: balance.locationId, countedQuantity,
          differenceType,
          reason: differenceType === 'no_change' ? '' : (reasons[identity] || '').trim(),
          approvedUnitCost: differenceType === 'gain' && Number(balance.quantity) === 0 && approvedCosts[identity]
            ? Number(approvedCosts[identity])
            : null,
        }
      })
    } catch {
      setMessage('盘点数量无效，请检查后重试')
      return
    }
    const fingerprint = JSON.stringify({ warehouseId, stocktakeMonth, lines })
    const identity = operationFence.current.acquire('stocktake', fingerprint, lines.length)
    const identifiedLines = lines.map((line, index) => ({
      ...line, stocktakeLineId: identity.lineIds[index],
    }))
    return run('stocktake', identity, (idempotencyKey) => warehouseConfirmationService.confirmStocktake({
      stocktakeId: identity.documentId,
      warehouseId,
      stocktakeMonth,
      idempotencyKey,
      lines: identifiedLines,
    }), `${stocktakeMonth} 月盘点已确认，差异已写入库存流水。`)
  }

  if (mode === 'stocktake') {
    if (!access.stocktake) return <p className="warehouse-empty">当前账号没有月度盘点确认权限。</p>
    return (
      <section className="warehouse-operations" aria-labelledby="warehouse-stocktake-title">
        <header className="warehouse-section-heading"><div><p>MONTHLY STOCKTAKE</p><h2 id="warehouse-stocktake-title">月度盘点</h2></div><span>每仓每月确认一次</span></header>
        {message && <p role="status" className="warehouse-operation-message">{message}</p>}
        <form className="warehouse-operation-card" onSubmit={submitStocktake}>
          <div className="warehouse-operation-grid">
            <Field label="盘点仓库"><select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{sites.filter((site) => site.active !== false).map((site) => <option key={site.id} value={site.id}>{site.name}{site.kind === 'shared_tool' ? '（共享工具仓位）' : ''}</option>)}</select></Field>
            <Field label="盘点月份"><input required type="month" value={stocktakeMonth} onChange={(event) => setStocktakeMonth(event.target.value)} /></Field>
          </div>
          <div className="warehouse-operation-table-wrap"><table><thead><tr><th>物品型号</th><th>货架区</th><th>账面数量</th><th>实盘数量</th><th>差异类型</th><th>差异说明</th>{access.viewCost && <th>零库存盘盈核准单价</th>}</tr></thead><tbody>{stocktakeBalances.map((balance) => {
            const identity = `${balance.variantId}:${balance.locationId}`
            const variant = variantById.get(balance.variantId)
            const item = itemById.get(variant?.itemId)
            const counted = Number(counts[identity] ?? balance.quantity)
            const inferred = counted === Number(balance.quantity) ? 'no_change' : counted > Number(balance.quantity) ? 'gain' : 'loss'
            const differenceType = differenceTypes[identity] || inferred
            return <tr key={identity}><td>{item?.name || '物品'} · {variant?.sku}</td><td>{locationLabel(locationById.get(balance.locationId), siteById)}</td><td>{balance.quantity} {variant?.unit}</td><td><input required min="0" step="0.0001" type="number" value={counts[identity] ?? ''} onChange={(event) => setCounts((current) => ({ ...current, [identity]: event.target.value }))} /></td><td><select value={differenceType} onChange={(event) => setDifferenceTypes((current) => ({ ...current, [identity]: event.target.value }))}><option value="no_change">无差异</option><option value="gain">盘盈</option><option value="loss">盘亏</option><option value="damaged">损坏</option><option value="scrapped">报废</option></select></td><td><input required={differenceType !== 'no_change'} disabled={differenceType === 'no_change'} value={reasons[identity] || ''} onChange={(event) => setReasons((current) => ({ ...current, [identity]: event.target.value }))} /></td>{access.viewCost && <td><input min="0" step="0.0001" type="number" disabled={differenceType !== 'gain' || Number(balance.quantity) !== 0} value={approvedCosts[identity] || ''} onChange={(event) => setApprovedCosts((current) => ({ ...current, [identity]: event.target.value }))} /></td>}</tr>
          })}</tbody></table></div>
          {stocktakeBalances.length === 0 && <p className="warehouse-empty">该仓库当前没有可盘点的库存行。</p>}
          <button type="submit" disabled={busy || stocktakeBalances.length === 0}>确认本月盘点</button>
        </form>
      </section>
    )
  }

  const canReverse = reversalOptions.length > 0
  return (
    <section className="warehouse-operations" aria-labelledby="warehouse-operations-title">
      <header className="warehouse-section-heading"><div><p>WAREHOUSE OPERATIONS</p><h2 id="warehouse-operations-title">出入库与库存作业</h2></div><span>确认后才改变库存</span></header>
      {message && <p role="status" className="warehouse-operation-message">{message}</p>}
      <div className="warehouse-operation-grid">
        {access.confirmReceipt && <article className="warehouse-operation-card warehouse-receipt-confirmations"><h3>采购到货待确认</h3>{receiptGroups.length === 0 && <p className="warehouse-empty">当前没有待确认的采购到货。</p>}{receiptGroups.map((receipt) => <section key={receipt.receiptId} className="warehouse-receipt-card"><strong>采购单：{receipt.rows[0]?.purchaseRecordKey}</strong><small>入库单：{receipt.receiptId}</small>{receipt.rows.map((row) => <div key={row.receiptLineId} className="warehouse-receipt-line"><span>{row.itemName} · {row.sku} · {row.model} · {row.quantity} {row.unit}</span><Field label="确认入库货架"><select required value={receiptLocationSelection[row.receiptLineId] || ''} onChange={(event) => setReceiptLocationSelection((current) => ({ ...current, [row.receiptLineId]: event.target.value }))}><option value="">请选择仓库与货架</option>{locations.filter((location) => location.active !== false && siteById.get(location.warehouseId)?.active !== false).map((location) => <option key={location.id} value={location.id}>{locationLabel(location, siteById)}</option>)}</select></Field></div>)}<button type="button" disabled={busy || receipt.rows.some((row) => !receiptLocationSelection[row.receiptLineId])} onClick={() => void confirmReceipt(receipt)}>确认采购入库并增加库存</button></section>)}</article>}
        <article className="warehouse-operation-card"><h3>待确认申请</h3><p>待确认出库：<strong>{pendingCount(snapshot?.context, 'stockOutRequests')}</strong></p><p>待确认退回：<strong>{pendingCount(snapshot?.context, 'returnRequests')}</strong></p>{canOpenStockFlow ? <div className="warehouse-operation-actions"><button type="button" onClick={() => onNavigate?.('stockOut')}>打开我要出库</button><button type="button" onClick={() => onNavigate?.('stockReturn')}>打开我要退回</button></div> : <p className="warehouse-empty">当前账号只能查看仓库，不能申请或确认出库。</p>}<small>仓库负责人确认出库后才扣库存；确认退回后才增加库存。</small></article>
        {access.transfer && <form className="warehouse-operation-card" onSubmit={submitTransfer}><h3>仓间/货架调拨</h3><Field label="物品型号"><select required value={transfer.variantId} onChange={(event) => setTransfer({ ...transfer, variantId: event.target.value })}>{variants.filter((variant) => variant.active !== false).map((variant) => <option key={variant.id} value={variant.id}>{itemById.get(variant.itemId)?.name} · {variant.sku} · {variant.model}</option>)}</select></Field><Field label="来源货架"><select required value={transfer.sourceLocationId} onChange={(event) => setTransfer({ ...transfer, sourceLocationId: event.target.value })}><option value="">请选择</option>{balances.filter((balance) => balance.variantId === transfer.variantId && Number(balance.quantity) > 0).map((balance) => <option key={`${balance.variantId}:${balance.locationId}`} value={balance.locationId}>{locationLabel(locationById.get(balance.locationId), siteById)} · 可用 {balance.quantity}</option>)}</select></Field><Field label="目标货架"><select required value={transfer.destinationLocationId} onChange={(event) => setTransfer({ ...transfer, destinationLocationId: event.target.value })}><option value="">请选择</option>{locations.filter((location) => location.active !== false && location.id !== transfer.sourceLocationId).map((location) => <option key={location.id} value={location.id}>{locationLabel(location, siteById)}</option>)}</select></Field><Field label="调拨数量"><input required min="0.0001" step="0.0001" type="number" value={transfer.quantity} onChange={(event) => setTransfer({ ...transfer, quantity: event.target.value })} /></Field><Field label="调拨原因"><textarea required value={transfer.reason} onChange={(event) => setTransfer({ ...transfer, reason: event.target.value })} /></Field><button type="submit" disabled={busy}>确认调拨</button></form>}
        {canReverse && <form className="warehouse-operation-card" onSubmit={submitReversal}><h3>整单冲销</h3><p className="warehouse-operation-warning">冲销不会删除原单，而是保留原单并追加一组相反流水。请只在整单确实做错时使用。</p><Field label="原单类型"><select value={reversal.sourceDocumentType} onChange={(event) => setReversal({ ...reversal, sourceDocumentType: event.target.value })}>{reversalOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="原单编号"><input required value={reversal.sourceDocumentId} onChange={(event) => setReversal({ ...reversal, sourceDocumentId: event.target.value })} placeholder="从报表复制完整单号" /></Field><Field label="冲销原因"><textarea required value={reversal.reason} onChange={(event) => setReversal({ ...reversal, reason: event.target.value })} /></Field><button type="submit" disabled={busy}>确认整单冲销</button></form>}
      </div>
    </section>
  )
}

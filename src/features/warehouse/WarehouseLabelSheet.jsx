import React, { useEffect, useState } from 'react'

import './warehouseLabel.css'
import { normalizeWarehouseQrInput } from './warehouseQr.js'

const loadQrcodeModule = () => import('qrcode')

export async function loadWarehouseLabelQrDataUrl(
  systemQr,
  loadQrcode = loadQrcodeModule,
) {
  const value = normalizeWarehouseQrInput(systemQr)
  const module = await loadQrcode()
  const toDataURL = typeof module?.toDataURL === 'function'
    ? module.toDataURL
    : module?.default?.toDataURL
  if (typeof toDataURL !== 'function') throw new Error('二维码标签渲染失败')
  return toDataURL(value, { errorCorrectionLevel: 'M', margin: 1, width: 256 })
}

export default function WarehouseLabelSheet({ label, qrDataUrl = '', onPrint }) {
  const [renderedQr, setRenderedQr] = useState(qrDataUrl)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let active = true
    if (!label || qrDataUrl) {
      setRenderedQr(qrDataUrl)
      return () => { active = false }
    }
    setMessage('')
    void loadWarehouseLabelQrDataUrl(label.systemQr).then(
      (value) => { if (active) setRenderedQr(value) },
      () => { if (active) setMessage('二维码标签生成失败，请重试') },
    )
    return () => { active = false }
  }, [label, qrDataUrl])

  if (!label) return null

  const print = async () => {
    try {
      const value = renderedQr || await loadWarehouseLabelQrDataUrl(label.systemQr)
      if (!renderedQr) setRenderedQr(value)
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (typeof onPrint === 'function') onPrint()
      else globalThis.window?.print?.()
    } catch {
      setMessage('二维码标签生成失败，请重试')
    }
  }

  const hasLocation = Boolean(label.warehouseName || label.shelfName)
  return (
    <section className="warehouse-label-print-sheet" aria-label="仓库物品标签">
      <div className="warehouse-label-print-sheet__actions">
        <button type="button" onClick={print}>打印标签</button>
      </div>
      <article className="warehouse-label-print-sheet__label">
        <header className="warehouse-label-print-sheet__header">
          <strong>{label.companyName}</strong>
          <span>{label.itemName}</span>
        </header>
        <div className="warehouse-label-print-sheet__body">
          <div className="warehouse-label-print-sheet__details">
            <span>型号：{label.model}</span>
            <span>尺寸：{label.size}</span>
            <span>材质：{label.material}</span>
            <span>SKU：{label.sku}</span>
            <span>单位：{label.unit}</span>
            {hasLocation && (
              <span className="warehouse-label-print-sheet__location">
                库位：{[label.warehouseName, label.shelfName].filter(Boolean).join(' / ')}
              </span>
            )}
          </div>
          {renderedQr && (
            <img
              className="warehouse-label-print-sheet__qr"
              src={renderedQr}
              alt={`系统二维码 ${label.systemQr}`}
            />
          )}
        </div>
        <code className="warehouse-label-print-sheet__code">{label.systemQr}</code>
        {message && <p className="warehouse-label-print-sheet__message" role="status">{message}</p>}
      </article>
    </section>
  )
}

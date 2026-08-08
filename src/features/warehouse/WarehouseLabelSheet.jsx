import React, { useEffect, useRef, useState } from 'react'

import './warehouseLabel.css'
import { normalizeWarehouseQrInput } from './warehouseQr.js'

const loadQrcodeModule = () => import('qrcode')
const EMPTY_QR_STATE = Object.freeze({ systemQr: '', dataUrl: '', status: 'idle' })
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10])

function normalizedSystemQr(value) {
  try { return normalizeWarehouseQrInput(value) } catch { return '' }
}

function isPngDataUrl(value) {
  if (typeof value !== 'string') return false
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value)
  if (!match || match[1].length % 4 !== 0 || typeof globalThis.atob !== 'function') return false
  try {
    const decoded = globalThis.atob(match[1])
    return PNG_SIGNATURE.every((byte, index) => decoded.charCodeAt(index) === byte)
  } catch {
    return false
  }
}

function trustedInjectedQr(value, systemQr) {
  if (!value || typeof value !== 'object') return ''
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return ''
    const keys = Reflect.ownKeys(value)
    if (keys.length !== 2 || !keys.includes('systemQr') || !keys.includes('dataUrl')) return ''
    const keyDescriptor = Object.getOwnPropertyDescriptor(value, 'systemQr')
    const urlDescriptor = Object.getOwnPropertyDescriptor(value, 'dataUrl')
    if (!keyDescriptor || !urlDescriptor || !('value' in keyDescriptor) || !('value' in urlDescriptor)) return ''
    return normalizedSystemQr(keyDescriptor.value) === systemQr && isPngDataUrl(urlDescriptor.value)
      ? urlDescriptor.value
      : ''
  } catch {
    return ''
  }
}

function initialQrState(label, injected) {
  const systemQr = normalizedSystemQr(label?.systemQr)
  const dataUrl = trustedInjectedQr(injected, systemQr)
  return systemQr && dataUrl
    ? { systemQr, dataUrl, status: 'decoding' }
    : EMPTY_QR_STATE
}

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

export default function WarehouseLabelSheet({
  label,
  qrDataUrl = null,
  loadQrDataUrl = loadWarehouseLabelQrDataUrl,
  onPrint,
}) {
  const systemQr = normalizedSystemQr(label?.systemQr)
  const injectedDataUrl = trustedInjectedQr(qrDataUrl, systemQr)
  const [qrState, setQrState] = useState(() => initialQrState(label, qrDataUrl))
  const mountedRef = useRef(false)
  const generationRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const token = generationRef.current + 1
    generationRef.current = token
    let active = true
    if (!systemQr) {
      setQrState(EMPTY_QR_STATE)
      return () => {
        active = false
        if (generationRef.current === token) generationRef.current += 1
      }
    }
    if (injectedDataUrl) {
      setQrState({ systemQr, dataUrl: injectedDataUrl, status: 'decoding' })
    } else {
      setQrState({ systemQr, dataUrl: '', status: 'generating' })
      void loadQrDataUrl(systemQr).then(
        (dataUrl) => {
          if (!active || !mountedRef.current || generationRef.current !== token) return
          setQrState(isPngDataUrl(dataUrl)
            ? { systemQr, dataUrl, status: 'decoding' }
            : { systemQr, dataUrl: '', status: 'failed' })
        },
        () => {
          if (active && mountedRef.current && generationRef.current === token) {
            setQrState({ systemQr, dataUrl: '', status: 'failed' })
          }
        },
      )
    }
    return () => {
      active = false
      if (generationRef.current === token) generationRef.current += 1
    }
  }, [injectedDataUrl, loadQrDataUrl, systemQr])

  if (!label) return null

  const currentQr = qrState.systemQr === systemQr ? qrState : EMPTY_QR_STATE
  const printable = currentQr.status === 'ready' && isPngDataUrl(currentQr.dataUrl)
  const imageReady = async (event) => {
    const image = event.currentTarget
    const dataUrl = currentQr.dataUrl
    const token = generationRef.current
    try { await image.decode?.() } catch {
      if (mountedRef.current && generationRef.current === token) {
        setQrState({ systemQr, dataUrl: '', status: 'failed' })
      }
      return
    }
    if (!mountedRef.current || generationRef.current !== token) return
    setQrState((current) => (
      current.systemQr === systemQr
      && current.dataUrl === dataUrl
      && current.status === 'decoding'
        ? { ...current, status: 'ready' }
        : current
    ))
  }
  const imageFailed = () => {
    const token = generationRef.current
    if (!mountedRef.current) return
    setQrState((current) => (
      generationRef.current === token && current.systemQr === systemQr
        ? { systemQr, dataUrl: '', status: 'failed' }
        : current
    ))
  }
  const print = () => {
    if (!printable) return
    if (typeof onPrint === 'function') onPrint()
    else globalThis.window?.print?.()
  }

  const hasLocation = Boolean(label.warehouseName || label.shelfName)
  return (
    <section className="warehouse-label-print-sheet" aria-label="仓库物品标签">
      <div className="warehouse-label-print-sheet__actions">
        <button type="button" onClick={print} disabled={!printable}>打印标签</button>
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
          {currentQr.dataUrl && (
            <img
              className="warehouse-label-print-sheet__qr"
              src={currentQr.dataUrl}
              alt={`系统二维码 ${systemQr}`}
              onLoad={imageReady}
              onError={imageFailed}
            />
          )}
        </div>
        <code className="warehouse-label-print-sheet__code">{systemQr}</code>
        {currentQr.status === 'failed' && (
          <p className="warehouse-label-print-sheet__message" role="status">
            二维码标签生成失败，请重试
          </p>
        )}
      </article>
    </section>
  )
}

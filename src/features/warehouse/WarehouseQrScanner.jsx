import React, { useEffect, useRef, useState } from 'react'

import { normalizeWarehouseQrInput } from './warehouseQr.js'

const PERMISSION_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])
const RETRYABLE_DECODE_ERROR_NAMES = new Set([
  'NotFoundException', 'ChecksumException', 'FormatException',
])

const loadZxingBrowser = () => import('@zxing/browser')

function scannerMessage(error) {
  return PERMISSION_ERROR_NAMES.has(error?.name)
    ? '无法使用相机，请在浏览器设置中允许相机权限，或改用手动输入'
    : '二维码扫描暂不可用，请重试或改用手动输入'
}

function scannedText(result) {
  if (!result || typeof result.getText !== 'function') return null
  const value = result.getText()
  return typeof value === 'string' ? value : null
}

export function createWarehouseQrScannerController({
  loadZxing = loadZxingBrowser,
  resolveQr,
  onResolved,
  onUnknown,
  onError,
}) {
  let closed = false
  let resourcesStopped = false
  let controls = null
  let videoElement = null
  const stoppedControls = new WeakSet()

  const stopControl = (value) => {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
    if (stoppedControls.has(value)) return
    stoppedControls.add(value)
    try { value.stop?.() } catch { /* cleanup remains best-effort */ }
  }

  const stopResources = (extraControls = null) => {
    closed = true
    const stream = videoElement?.srcObject
    let tracks = []
    try { tracks = typeof stream?.getTracks === 'function' ? stream.getTracks() : [] } catch {}
    stopControl(extraControls)
    stopControl(controls)
    if (!resourcesStopped) {
      resourcesStopped = true
      for (const track of tracks) {
        try { track?.stop?.() } catch { /* continue stopping remaining tracks */ }
      }
      try {
        if (videoElement && 'srcObject' in videoElement) videoElement.srcObject = null
      } catch {}
    }
  }

  const reportLookup = async (rawCode, extraControls = null) => {
    stopResources(extraControls)
    let code
    try {
      code = normalizeWarehouseQrInput(rawCode)
    } catch {
      onError('请输入有效的二维码内容')
      return null
    }
    try {
      const resolution = await resolveQr(code)
      if (resolution === null) onUnknown(code)
      else onResolved(resolution)
      return resolution
    } catch {
      onError('二维码查询失败，请重试或改用手动输入')
      return null
    }
  }

  return Object.freeze({
    async open(video) {
      if (closed) return
      videoElement = video
      try {
        const zxing = await loadZxing()
        if (closed) return
        if (typeof zxing?.BrowserQRCodeReader !== 'function') throw new Error('reader unavailable')
        const reader = new zxing.BrowserQRCodeReader()
        const nextControls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoElement,
          (result, error, callbackControls) => {
            if (closed) {
              stopResources(callbackControls)
              return
            }
            const text = scannedText(result)
            if (text !== null) {
              void reportLookup(text, callbackControls)
              return
            }
            if (error && !RETRYABLE_DECODE_ERROR_NAMES.has(error.name)) {
              stopResources(callbackControls)
              onError(scannerMessage(error))
            }
          },
        )
        controls = nextControls
        if (closed) stopControl(nextControls)
      } catch (error) {
        stopResources()
        onError(scannerMessage(error))
      }
    },
    submitManual(code) {
      return reportLookup(code)
    },
    close() {
      stopResources()
    },
  })
}

export default function WarehouseQrScanner({
  open,
  warehouseService,
  onResolved,
  onClose,
}) {
  const videoRef = useRef(null)
  const controllerRef = useRef(null)
  const [manualCode, setManualCode] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return undefined
    setMessage('')
    const controller = createWarehouseQrScannerController({
      resolveQr: (code) => warehouseService.resolveQr(code),
      onResolved,
      onUnknown: () => setMessage('未找到对应物品，请检查二维码后重试'),
      onError: setMessage,
    })
    controllerRef.current = controller
    void controller.open(videoRef.current)
    return () => {
      controller.close()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [open, warehouseService, onResolved])

  if (!open) return null

  const close = () => {
    controllerRef.current?.close()
    onClose()
  }
  const submitManual = async (event) => {
    event.preventDefault()
    setMessage('')
    await controllerRef.current?.submitManual(manualCode)
  }

  return (
    <div className="warehouse-qr-scanner" role="dialog" aria-modal="true" aria-label="扫描物品二维码">
      <div className="warehouse-qr-scanner__panel">
        <div className="warehouse-qr-scanner__heading">
          <h2>扫描物品二维码</h2>
          <button type="button" onClick={close} aria-label="关闭二维码扫描">关闭</button>
        </div>
        <video ref={videoRef} muted playsInline aria-label="二维码相机预览" />
        {message && <p role="status">{message}</p>}
        <form onSubmit={submitManual}>
          <label htmlFor="warehouse-qr-manual-input">手动输入二维码</label>
          <input
            id="warehouse-qr-manual-input"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            autoComplete="off"
          />
          <button type="submit">查询</button>
        </form>
      </div>
    </div>
  )
}

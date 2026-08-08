import React, { useEffect, useRef, useState } from 'react'

import { normalizeWarehouseQrInput } from './warehouseQr.js'

const PERMISSION_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])
const RETRYABLE_DECODE_ERROR_NAMES = new Set([
  'NotFoundException', 'ChecksumException', 'FormatException',
])
const CAMERA_BUSY_MESSAGE = '相机正在关闭，请稍后重试或改用手动输入'
const EXTERNAL_CAMERA_BUSY_MESSAGE = '相机正在被其他操作使用，请稍后或手动输入'
const videoSessionOwners = new WeakMap()
const streamSessionOwners = new WeakMap()
const componentIdentityKeys = new WeakMap()
const modalIsolationStack = []
let releaseTopIsolation = () => {}
let nextComponentIdentityKey = 0

const loadZxingBrowser = () => import('@zxing/browser')

function componentIdentityKey(value) {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return `${typeof value}:${String(value)}`
  }
  if (!componentIdentityKeys.has(value)) {
    nextComponentIdentityKey += 1
    componentIdentityKeys.set(value, nextComponentIdentityKey)
  }
  return componentIdentityKeys.get(value)
}

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

function isolateBackground(element) {
  const isolated = []
  let current = element
  while (current?.parentElement) {
    const parent = current.parentElement
    for (const sibling of parent.children) {
      if (sibling === current) continue
      isolated.push({
        sibling,
        inert: sibling.inert === true,
        ariaHidden: sibling.getAttribute('aria-hidden'),
      })
      sibling.inert = true
      sibling.setAttribute('aria-hidden', 'true')
    }
    current = parent
  }
  return () => {
    for (const state of isolated.reverse()) {
      state.sibling.inert = state.inert
      if (state.ariaHidden === null) state.sibling.removeAttribute('aria-hidden')
      else state.sibling.setAttribute('aria-hidden', state.ariaHidden)
    }
  }
}

function registerModalIsolation(element) {
  releaseTopIsolation()
  modalIsolationStack.push(element)
  releaseTopIsolation = isolateBackground(element)
  return () => {
    releaseTopIsolation()
    const index = modalIsolationStack.lastIndexOf(element)
    if (index >= 0) modalIsolationStack.splice(index, 1)
    const nextTop = modalIsolationStack.at(-1)
    releaseTopIsolation = nextTop ? isolateBackground(nextTop) : () => {}
  }
}

const focusableElements = (dialog) => Array.from(dialog?.querySelectorAll?.(
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
) ?? []).filter((element) => !element.closest?.('[inert]'))

export function createWarehouseQrScannerController({
  loadZxing = loadZxingBrowser,
  resolveQr,
  onResolved,
  onUnknown,
  onError,
}) {
  let disposed = false
  let generation = 0
  let activeSession = null
  const stoppedControls = new WeakSet()
  const stoppedTracks = new WeakSet()
  const isResourceObject = (value) => Boolean(value)
    && (typeof value === 'object' || typeof value === 'function')

  const invokeStop = (value) => {
    let result
    try { result = value.stop?.() } catch { return null }
    if (!result || (typeof result !== 'object' && typeof result !== 'function')) return null
    try {
      if (typeof result.then !== 'function') return null
      return Promise.resolve(result).catch(() => {})
    } catch {
      return null
    }
  }

  const stopControl = (value) => {
    if (!isResourceObject(value)) return null
    if (stoppedControls.has(value)) return null
    stoppedControls.add(value)
    return invokeStop(value)
  }

  const inspectVideoStream = (video) => {
    try { return { ok: true, value: video.srcObject } } catch {
      return { ok: false, value: undefined }
    }
  }

  const readVideoStream = (video) => {
    const inspection = inspectVideoStream(video)
    return inspection.ok ? inspection.value : null
  }

  const rememberOwnedStream = (session, stream) => {
    if (!isResourceObject(stream)) return
    if (session.ownedStreams.size > 0 && !session.ownedStreams.has(stream)) return
    const owner = streamSessionOwners.get(stream)
    if (owner && owner !== session) return
    streamSessionOwners.set(stream, session)
    session.ownedStreams.add(stream)
  }

  const captureCallbackOwnedStream = (session, callbackControls) => {
    if (!isResourceObject(callbackControls)) return null
    if (videoSessionOwners.get(session.video) !== session) return null
    const inspection = inspectVideoStream(session.video)
    if (!inspection.ok) return null
    rememberOwnedStream(session, inspection.value)
    return inspection.value
  }

  const finalizeSessionCleanup = (session) => {
    for (const stream of session.ownedStreams) {
      if (streamSessionOwners.get(stream) !== session) continue
      let tracks = []
      try { tracks = typeof stream?.getTracks === 'function' ? stream.getTracks() : [] } catch {}
      for (const track of tracks) {
        if (!track || (typeof track !== 'object' && typeof track !== 'function')) continue
        let ended = false
        try { ended = track.readyState === 'ended' } catch {}
        if (ended || stoppedTracks.has(track)) continue
        stoppedTracks.add(track)
        invokeStop(track)
      }
    }
    const currentStream = readVideoStream(session.video)
    const ownsCurrentStream = videoSessionOwners.get(session.video) === session
      && streamSessionOwners.get(currentStream) === session
    if (ownsCurrentStream) {
      try {
        if (
          videoSessionOwners.get(session.video) === session
          && session.video.srcObject === currentStream
        ) session.video.srcObject = null
      } catch {}
    }
    const stillOwnsAttachedStream = videoSessionOwners.get(session.video) === session
      && streamSessionOwners.get(readVideoStream(session.video)) === session
    const controlsCleanupComplete = session.controlsResolved
      && (!isResourceObject(session.returnedControls) || session.authoritativeControlStopped)
    session.cleanupFinalized = session.closeRequested
      && session.openSettled
      && controlsCleanupComplete
      && !stillOwnsAttachedStream
    if (session.cleanupFinalized && videoSessionOwners.get(session.video) === session) {
      videoSessionOwners.delete(session.video)
      session.leaseReleased = true
    }
  }

  const stopSession = (session, callbackControls = null) => {
    if (!session) {
      stopControl(callbackControls)
      return
    }
    session.closeRequested = true
    if (session.cleanupFinalized) return
    if (session.cleanupInProgress) return
    session.cleanupInProgress = true
    let controlSettlement = null
    if (!session.authoritativeControlStopped) {
      const authoritativeControls = isResourceObject(session.returnedControls)
        ? session.returnedControls
        : (isResourceObject(callbackControls) ? callbackControls : null)
      if (authoritativeControls) {
        session.authoritativeControlStopped = true
        controlSettlement = stopControl(authoritativeControls)
      }
    }
    const finishCleanup = () => {
      finalizeSessionCleanup(session)
      session.cleanupInProgress = false
    }
    if (controlSettlement) {
      void controlSettlement.then(finishCleanup)
      return
    }
    finishCleanup()
  }

  const isCurrent = (token) => !disposed && generation === token

  const reportLookup = async (rawCode, extraControls = null) => {
    if (disposed) return null
    const token = ++generation
    const session = activeSession
    activeSession = null
    stopSession(session, extraControls)
    let code
    try {
      code = normalizeWarehouseQrInput(rawCode)
    } catch {
      if (isCurrent(token)) onError('请输入有效的二维码内容')
      return null
    }
    try {
      const resolution = await resolveQr(code)
      if (!isCurrent(token)) return null
      if (resolution === null) onUnknown(code)
      else onResolved(resolution)
      return resolution
    } catch {
      if (isCurrent(token)) onError('二维码查询失败，请重试或改用手动输入')
      return null
    }
  }

  return Object.freeze({
    async open(video) {
      if (disposed) return null
      const token = ++generation
      stopSession(activeSession)
      const canLeaseVideo = video && (typeof video === 'object' || typeof video === 'function')
      const currentLease = canLeaseVideo ? videoSessionOwners.get(video) : null
      if (currentLease && !currentLease.leaseReleased) {
        if (isCurrent(token)) {
          try { onError(CAMERA_BUSY_MESSAGE) } catch { /* UI callback cannot bypass the lease */ }
        }
        return null
      }
      const initialStream = inspectVideoStream(video)
      if (!initialStream.ok || initialStream.value !== null) {
        if (isCurrent(token)) {
          try { onError(EXTERNAL_CAMERA_BUSY_MESSAGE) } catch { /* UI callback cannot start over external media */ }
        }
        return null
      }
      const session = {
        video,
        returnedControls: null,
        ownedStreams: new Set(),
        closeRequested: false,
        authoritativeControlStopped: false,
        cleanupFinalized: false,
        cleanupInProgress: false,
        controlsResolved: false,
        openSettled: false,
        leaseReleased: false,
      }
      if (canLeaseVideo) {
        videoSessionOwners.set(video, session)
      }
      activeSession = session
      try {
        const zxing = await loadZxing()
        if (!isCurrent(token)) {
          stopSession(session)
          return null
        }
        if (typeof zxing?.BrowserQRCodeReader !== 'function') throw new Error('reader unavailable')
        const reader = new zxing.BrowserQRCodeReader()
        const decoding = reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          session.video,
          (result, error, callbackControls) => {
            captureCallbackOwnedStream(session, callbackControls)
            if (!isCurrent(token)) {
              stopSession(session, callbackControls)
              return
            }
            const text = scannedText(result)
            if (text !== null) {
              void reportLookup(text, callbackControls)
              return
            }
            if (error && !RETRYABLE_DECODE_ERROR_NAMES.has(error.name)) {
              generation += 1
              activeSession = null
              stopSession(session, callbackControls)
              onError(scannerMessage(error))
            }
          },
        )
        const nextControls = await decoding
        session.returnedControls = nextControls
        session.controlsResolved = true
        if (!isCurrent(token)) {
          stopSession(session, nextControls)
          return null
        }
        return nextControls
      } catch (error) {
        session.controlsResolved = true
        stopSession(session)
        if (!isCurrent(token)) return null
        generation += 1
        activeSession = null
        onError(scannerMessage(error))
        return null
      } finally {
        session.openSettled = true
        session.controlsResolved = true
        if (session.closeRequested) stopSession(session)
      }
    },
    submitManual(code) {
      return reportLookup(code)
    },
    close() {
      if (disposed) return
      disposed = true
      generation += 1
      stopSession(activeSession)
      activeSession = null
    },
  })
}

export default function WarehouseQrScanner({
  open,
  loadZxing = loadZxingBrowser,
  warehouseService,
  onResolved,
  onClose,
}) {
  const videoRef = useRef(null)
  const dialogRef = useRef(null)
  const closeButtonRef = useRef(null)
  const controllerRef = useRef(null)
  const [manualCode, setManualCode] = useState('')
  const [message, setMessage] = useState('')
  const videoSessionKey = [loadZxing, warehouseService, onResolved]
    .map(componentIdentityKey)
    .join(':')

  useEffect(() => {
    if (!open) return undefined
    setMessage('')
    const controller = createWarehouseQrScannerController({
      loadZxing,
      resolveQr: (code) => warehouseService.resolveQr(code),
      onResolved,
      onUnknown: () => setMessage('未找到对应物品，请检查二维码后重试'),
      onError: setMessage,
    })
    controllerRef.current = controller
    let cancelled = false
    void Promise.resolve().then(() => {
      if (cancelled) return null
      return controller.open(videoRef.current)
    }).catch(() => {})
    return () => {
      cancelled = true
      controller.close()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [open, loadZxing, warehouseService, onResolved])

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined
    const previousFocus = globalThis.document?.activeElement
    const releaseBackground = registerModalIsolation(dialogRef.current)
    closeButtonRef.current?.focus?.()
    return () => {
      releaseBackground()
      if (previousFocus && globalThis.document?.contains?.(previousFocus)) {
        previousFocus.focus?.()
      }
    }
  }, [open])

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
  const handleDialogKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = focusableElements(dialogRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)
    const active = globalThis.document?.activeElement
    if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div ref={dialogRef} className="warehouse-qr-scanner" role="dialog" aria-modal="true" aria-label="扫描物品二维码" onKeyDown={handleDialogKeyDown}>
      <div className="warehouse-qr-scanner__panel">
        <div className="warehouse-qr-scanner__heading">
          <h2>扫描物品二维码</h2>
          <button ref={closeButtonRef} type="button" onClick={close} aria-label="关闭二维码扫描">关闭</button>
        </div>
        <video
          key={`warehouse-qr-video-${videoSessionKey}`}
          ref={videoRef}
          muted
          playsInline
          aria-label="二维码相机预览"
        />
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

import React, { useEffect, useRef, useState } from 'react'

import { normalizeWarehouseQrInput } from './warehouseQr.js'

const PERMISSION_ERROR_NAMES = new Set(['NotAllowedError', 'PermissionDeniedError', 'SecurityError'])
const RETRYABLE_DECODE_ERROR_NAMES = new Set([
  'NotFoundException', 'ChecksumException', 'FormatException',
])
const videoSessionOwners = new WeakMap()
const streamSessionOwners = new WeakMap()
const componentIdentityKeys = new WeakMap()
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
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null
    if (stoppedControls.has(value)) return null
    stoppedControls.add(value)
    return invokeStop(value)
  }

  const readVideoStream = (video) => {
    try { return video?.srcObject ?? null } catch { return null }
  }

  const rememberOwnedStream = (session, stream) => {
    if (!stream || (typeof stream !== 'object' && typeof stream !== 'function')) return
    const owner = streamSessionOwners.get(stream)
    if (owner && owner !== session) return
    streamSessionOwners.set(stream, session)
    session.ownedStreams.add(stream)
    session.latestOwnedStream = stream
  }

  const captureCurrentOwnedStream = (session) => {
    if (videoSessionOwners.get(session.video) !== session) return null
    const stream = readVideoStream(session.video)
    rememberOwnedStream(session, stream)
    return stream
  }

  const protectForeignStream = (session) => {
    const owner = videoSessionOwners.get(session.video)
    if (!owner || owner === session || owner.closeRequested) return null
    const stream = readVideoStream(session.video)
    if (!stream) return null
    rememberOwnedStream(owner, stream)
    try {
      if (session.video.srcObject !== stream) return null
      session.video.srcObject = null
      return { owner, stream, video: session.video }
    } catch {
      return null
    }
  }

  const restoreProtectedStream = (protection) => {
    if (!protection) return
    const { owner, stream, video } = protection
    if (videoSessionOwners.get(video) !== owner || owner.closeRequested) return
    if (readVideoStream(video) !== null) return
    const latest = owner.latestOwnedStream ?? stream
    if (streamSessionOwners.get(latest) !== owner) return
    try {
      if (
        videoSessionOwners.get(video) === owner
        && !owner.closeRequested
        && video.srcObject === null
      ) video.srcObject = latest
    } catch {}
  }

  const finalizeSessionCleanup = (session) => {
    captureCurrentOwnedStream(session)
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
    session.cleanupFinalized = session.closeRequested
      && session.authoritativeControlStopped
      && !stillOwnsAttachedStream
    if (session.cleanupFinalized && videoSessionOwners.get(session.video) === session) {
      videoSessionOwners.delete(session.video)
    }
  }

  const stopSession = (session, callbackControls = null) => {
    if (!session) {
      stopControl(callbackControls)
      return
    }
    session.closeRequested = true
    captureCurrentOwnedStream(session)
    if (session.cleanupFinalized) return
    if (session.cleanupInProgress) return
    session.cleanupInProgress = true
    let protection = null
    let controlSettlement = null
    if (!session.authoritativeControlStopped) {
      const authoritativeControls = session.returnedControls ?? callbackControls
      if (authoritativeControls) {
        session.authoritativeControlStopped = true
        protection = protectForeignStream(session)
        controlSettlement = stopControl(authoritativeControls)
      }
    }
    const finishCleanup = () => {
      restoreProtectedStream(protection)
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
      const session = {
        video,
        returnedControls: null,
        ownedStreams: new Set(),
        latestOwnedStream: null,
        closeRequested: false,
        authoritativeControlStopped: false,
        cleanupFinalized: false,
        cleanupInProgress: false,
      }
      const previousOwner = video && (typeof video === 'object' || typeof video === 'function')
        ? videoSessionOwners.get(video)
        : null
      if (video && (typeof video === 'object' || typeof video === 'function')) {
        videoSessionOwners.set(video, session)
        if (!previousOwner) captureCurrentOwnedStream(session)
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
        let decoding
        try {
          decoding = reader.decodeFromConstraints(
            { video: { facingMode: { ideal: 'environment' } } },
            session.video,
            (result, error, callbackControls) => {
              captureCurrentOwnedStream(session)
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
        } finally {
          captureCurrentOwnedStream(session)
        }
        const nextControls = await decoding
        captureCurrentOwnedStream(session)
        session.returnedControls = nextControls
        if (!isCurrent(token)) {
          stopSession(session, nextControls)
          return null
        }
        return nextControls
      } catch (error) {
        stopSession(session)
        if (!isCurrent(token)) return null
        generation += 1
        activeSession = null
        onError(scannerMessage(error))
        return null
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
    void controller.open(videoRef.current)
    return () => {
      controller.close()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [open, loadZxing, warehouseService, onResolved])

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

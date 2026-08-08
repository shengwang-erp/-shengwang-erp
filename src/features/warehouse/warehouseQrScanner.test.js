import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { StrictMode, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import {
  installWarehouseReactDom,
} from './warehouseReactDomTestUtils.js'

const source = await readFile(
  new URL('./WarehouseQrScanner.jsx', import.meta.url),
  'utf8',
).catch(() => '')

async function loadScannerModule() {
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/features/warehouse/WarehouseQrScanner.jsx')
  } catch {
    return {}
  } finally {
    await server.close()
  }
}

const scannerModule = await loadScannerModule()

function mediaFixture(trackCount = 2) {
  const tracks = Array.from({ length: trackCount }, () => ({
    readyState: 'live',
    stops: 0,
    stop() { this.stops += 1; this.readyState = 'ended' },
  }))
  return {
    tracks,
    video: { srcObject: { getTracks: () => tracks } },
  }
}

function deferredReader() {
  let callback
  const controls = { stops: 0, stop() { this.stops += 1 } }
  class BrowserQRCodeReader {
    async decodeFromConstraints(constraints, video, next) {
      assert.deepEqual(constraints, { video: { facingMode: { ideal: 'environment' } } })
      assert.ok(video)
      callback = next
      return controls
    }
  }
  return {
    controls,
    load: async () => ({ BrowserQRCodeReader }),
    emit(result, error) { callback?.(result, error, controls) },
  }
}

test('scanner dependency stays unloaded until open and manual entry resolves without camera access', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let imports = 0
  const resolved = []
  const unknown = []
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { imports += 1; return {} },
    resolveQr: async (code) => code === 'Maker-AbC' ? { id: 'variant-1' } : null,
    onResolved: (value) => resolved.push(value),
    onUnknown: (code) => unknown.push(code),
    onError() {},
  })

  assert.equal(imports, 0)
  await controller.submitManual(' \ufeffMaker-AbC　')
  await controller.submitManual(' UNKNOWN ')

  assert.equal(imports, 0)
  assert.deepEqual(resolved, [{ id: 'variant-1' }])
  assert.deepEqual(unknown, ['UNKNOWN'])
})

test('successful camera decode stops ZXing controls and every media track before resolving', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const reader = deferredReader()
  const media = mediaFixture(3)
  const resolved = []
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: reader.load,
    resolveQr: async (code) => ({ id: 'variant-1', code }),
    onResolved: (value) => resolved.push(value),
    onUnknown() {},
    onError() {},
  })

  await controller.open(media.video)
  reader.emit({ getText: () => 'SWERP:VARIANT:V-1' })
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(reader.controls.stops, 1)
  assert.deepEqual(media.tracks.map((track) => track.stops), [1, 1, 1])
  assert.deepEqual(resolved, [{ id: 'variant-1', code: 'SWERP:VARIANT:V-1' }])
})

test('real-like returned wrapper is the one cleanup authority and stops original controls and tracks once', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const video = { srcObject: { getTracks: () => [track] } }
  let callback
  const originalControls = {
    stops: 0,
    stop() { this.stops += 1; track.stop() },
  }
  const returnedWrapper = {
    stops: 0,
    stop() {
      this.stops += 1
      callback?.(null, Object.assign(new Error('reader stopped'), { name: 'NotFoundException' }), originalControls)
      originalControls.stop()
    },
  }
  class BrowserQRCodeReader {
    async decodeFromConstraints(_constraints, _video, next) {
      callback = next
      return returnedWrapper
    }
  }
  const resolved = []
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => ({ id: 'variant-1' }),
    onResolved: (value) => resolved.push(value.id),
    onUnknown() {}, onError() {},
  })

  await controller.open(video)
  callback({ getText: () => 'REAL-LIKE' }, null, originalControls)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(resolved, ['variant-1'])
  assert.equal(returnedWrapper.stops, 1)
  assert.equal(originalControls.stops, 1)
  assert.equal(track.stops, 1)
})

test('early callback cleanup uses original controls once and discards a late returned wrapper', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const video = { srcObject: { getTracks: () => [track] } }
  let releaseWrapper
  const originalControls = {
    stops: 0,
    stop() { this.stops += 1; track.stop() },
  }
  const returnedWrapper = {
    stops: 0,
    stop() { this.stops += 1; originalControls.stop() },
  }
  class BrowserQRCodeReader {
    decodeFromConstraints(_constraints, _video, callback) {
      callback({ getText: () => 'EARLY' }, null, originalControls)
      return new Promise((resolve) => { releaseWrapper = () => resolve(returnedWrapper) })
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => ({ id: 'variant-early' }),
    onResolved() {}, onUnknown() {}, onError() {},
  })

  const opening = controller.open(video)
  await new Promise((resolve) => setImmediate(resolve))
  releaseWrapper()
  await opening

  assert.equal(originalControls.stops, 1)
  assert.equal(returnedWrapper.stops, 0)
  assert.equal(track.stops, 1)
})

test('async controls stop rejection is observed without unhandled cleanup failure', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const media = mediaFixture(1)
  let thenCalls = 0
  const controls = {
    stop() {
      return {
        then(_resolve, reject) {
          thenCalls += 1
          reject(new Error('private torch shutdown failure'))
        },
      }
    },
  }
  class BrowserQRCodeReader {
    async decodeFromConstraints() { return controls }
  }
  const unhandled = []
  const captureUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', captureUnhandled)
  try {
    const controller = scannerModule.createWarehouseQrScannerController({
      loadZxing: async () => ({ BrowserQRCodeReader }),
      resolveQr: async () => null,
      onResolved() {}, onUnknown() {}, onError() {},
    })
    await controller.open(media.video)
    controller.close()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', captureUnhandled)
  }

  assert.equal(thenCalls, 1)
  assert.deepEqual(unhandled, [])
  assert.deepEqual(media.tracks.map((track) => track.stops), [1])
})

test('close and unmount cleanup are idempotent and stop controls plus every track', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const reader = deferredReader()
  const media = mediaFixture()
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: reader.load,
    resolveQr: async () => null,
    onResolved() {},
    onUnknown() {},
    onError() {},
  })

  await controller.open(media.video)
  controller.close()
  controller.close()

  assert.equal(reader.controls.stops, 1)
  assert.deepEqual(media.tracks.map((track) => track.stops), [1, 1])
})

test('close during a late import or late controls resolution never starts or leaks camera resources', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let releaseImport
  let readerConstructions = 0
  const importMedia = mediaFixture()
  const importController = scannerModule.createWarehouseQrScannerController({
    loadZxing: () => new Promise((resolve) => { releaseImport = resolve }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })
  const importOpening = importController.open(importMedia.video)
  importController.close()
  releaseImport({
    BrowserQRCodeReader: class { constructor() { readerConstructions += 1 } },
  })
  await importOpening

  assert.equal(readerConstructions, 0)
  assert.deepEqual(importMedia.tracks.map((track) => track.stops), [1, 1])

  let releaseControls
  let decodeStarted
  const controls = { stops: 0, stop() { this.stops += 1 } }
  const controlsStarted = new Promise((resolve) => { decodeStarted = resolve })
  const controlsMedia = mediaFixture(3)
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      decodeStarted()
      return new Promise((resolve) => { releaseControls = () => resolve(controls) })
    }
  }
  const controlsController = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })
  const controlsOpening = controlsController.open(controlsMedia.video)
  await controlsStarted
  controlsController.close()
  releaseControls()
  await controlsOpening

  assert.equal(controls.stops, 1)
  assert.deepEqual(controlsMedia.tracks.map((track) => track.stops), [1, 1, 1])
})

test('close before media attachment stops late returned controls and detaches the late stream', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let releaseControls
  let markDecodeStarted
  const decodeStarted = new Promise((resolve) => { markDecodeStarted = resolve })
  const controls = { stops: 0, stop() { this.stops += 1 } }
  const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const lateStream = { getTracks: () => [track] }
  const video = { srcObject: null }
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      markDecodeStarted()
      return new Promise((resolve) => { releaseControls = () => resolve(controls) })
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })

  const opening = controller.open(video)
  await decodeStarted
  controller.close()
  video.srcObject = lateStream
  releaseControls()
  await opening

  assert.equal(controls.stops, 1)
  assert.equal(track.stops, 1)
  assert.equal(video.srcObject, null)
})

test('late callback controls become cleanup authority and a later returned wrapper is discarded', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let callback
  let releaseWrapper
  let markDecodeStarted
  const decodeStarted = new Promise((resolve) => { markDecodeStarted = resolve })
  const originalControls = { stops: 0, stop() { this.stops += 1 } }
  const returnedWrapper = { stops: 0, stop() { this.stops += 1; originalControls.stop() } }
  const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const lateStream = { getTracks: () => [track] }
  const video = { srcObject: null }
  class BrowserQRCodeReader {
    decodeFromConstraints(_constraints, _video, next) {
      callback = next
      markDecodeStarted()
      return new Promise((resolve) => { releaseWrapper = () => resolve(returnedWrapper) })
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })

  const opening = controller.open(video)
  await decodeStarted
  controller.close()
  video.srcObject = lateStream
  callback(null, Object.assign(new Error('reader stopped'), { name: 'NotFoundException' }), originalControls)
  releaseWrapper()
  await opening

  assert.equal(originalControls.stops, 1)
  assert.equal(returnedWrapper.stops, 0)
  assert.equal(track.stops, 1)
  assert.equal(video.srcObject, null)
})

test('late returned controls observe a rejecting stop thenable without losing stream fallback', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let releaseControls
  let markDecodeStarted
  let thenCalls = 0
  const decodeStarted = new Promise((resolve) => { markDecodeStarted = resolve })
  const controls = {
    stop() {
      return {
        then(_resolve, reject) {
          thenCalls += 1
          reject(new Error('private late shutdown failure'))
        },
      }
    },
  }
  const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const lateStream = { getTracks: () => [track] }
  const video = { srcObject: null }
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      markDecodeStarted()
      return new Promise((resolve) => { releaseControls = () => resolve(controls) })
    }
  }
  const unhandled = []
  const captureUnhandled = (error) => unhandled.push(error)
  process.on('unhandledRejection', captureUnhandled)
  try {
    const controller = scannerModule.createWarehouseQrScannerController({
      loadZxing: async () => ({ BrowserQRCodeReader }),
      resolveQr: async () => null,
      onResolved() {}, onUnknown() {}, onError() {},
    })
    const opening = controller.open(video)
    await decodeStarted
    controller.close()
    video.srcObject = lateStream
    releaseControls()
    await opening
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', captureUnhandled)
  }

  assert.equal(thenCalls, 1)
  assert.deepEqual(unhandled, [])
  assert.equal(track.stops, 1)
  assert.equal(video.srcObject, null)
})

test('late cleanup skips ended tracks and stops every live track exactly once', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let releaseControls
  let markDecodeStarted
  const decodeStarted = new Promise((resolve) => { markDecodeStarted = resolve })
  const controls = { stops: 0, stop() { this.stops += 1 } }
  const tracks = [
    { readyState: 'ended', stops: 0, stop() { this.stops += 1 } },
    { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } },
    { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } },
  ]
  const lateStream = { getTracks: () => tracks }
  const video = { srcObject: null }
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      markDecodeStarted()
      return new Promise((resolve) => { releaseControls = () => resolve(controls) })
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })

  const opening = controller.open(video)
  await decodeStarted
  controller.close()
  video.srcObject = lateStream
  releaseControls()
  await opening

  assert.equal(controls.stops, 1)
  assert.deepEqual(tracks.map((track) => track.stops), [0, 1, 1])
  assert.equal(video.srcObject, null)
})

test('close disposes pending manual lookup and rejects every later manual submission', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let release
  let calls = 0
  const outcomes = []
  const controller = scannerModule.createWarehouseQrScannerController({
    resolveQr: () => {
      calls += 1
      return new Promise((resolve) => { release = resolve })
    },
    onResolved: (value) => outcomes.push(['resolved', value.id]),
    onUnknown: (code) => outcomes.push(['unknown', code]),
    onError: (message) => outcomes.push(['error', message]),
  })

  const pending = controller.submitManual('OLD-SLOW')
  controller.close()
  release({ id: 'old-variant' })
  assert.equal(await pending, null)
  assert.equal(await controller.submitManual('AFTER-CLOSE'), null)

  assert.equal(calls, 1)
  assert.deepEqual(outcomes, [])
})

test('a newer manual lookup wins and stale success null and error outcomes cannot publish', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const pending = new Map()
  const outcomes = []
  const controller = scannerModule.createWarehouseQrScannerController({
    resolveQr: (code) => new Promise((resolve, reject) => pending.set(code, { resolve, reject })),
    onResolved: (value) => outcomes.push(['resolved', value.id]),
    onUnknown: (code) => outcomes.push(['unknown', code]),
    onError: (message) => outcomes.push(['error', message]),
  })

  const oldSuccess = controller.submitManual('OLD-SUCCESS')
  const current = controller.submitManual('NEW-FAST')
  pending.get('NEW-FAST').resolve({ id: 'new-variant' })
  assert.deepEqual(await current, { id: 'new-variant' })
  pending.get('OLD-SUCCESS').resolve({ id: 'old-variant' })
  assert.equal(await oldSuccess, null)

  const oldNull = controller.submitManual('OLD-NULL')
  const newer = controller.submitManual('NEWER-FAST')
  pending.get('NEWER-FAST').resolve({ id: 'newer-variant' })
  await newer
  pending.get('OLD-NULL').resolve(null)
  assert.equal(await oldNull, null)

  const oldError = controller.submitManual('OLD-ERROR')
  const newest = controller.submitManual('NEWEST-FAST')
  pending.get('NEWEST-FAST').resolve({ id: 'newest-variant' })
  await newest
  pending.get('OLD-ERROR').reject(new Error('private stale failure'))
  assert.equal(await oldError, null)

  assert.deepEqual(outcomes, [
    ['resolved', 'new-variant'],
    ['resolved', 'newer-variant'],
    ['resolved', 'newest-variant'],
  ])
})

test('permission denial and fatal reader errors stop resources and expose friendly Chinese guidance', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  for (const error of [
    Object.assign(new Error('private permission detail'), { name: 'NotAllowedError' }),
    Object.assign(new Error('private reader detail'), { name: 'CameraFailure' }),
  ]) {
    const media = mediaFixture()
    const messages = []
    class BrowserQRCodeReader {
      async decodeFromConstraints() { throw error }
    }
    const controller = scannerModule.createWarehouseQrScannerController({
      loadZxing: async () => ({ BrowserQRCodeReader }),
      resolveQr: async () => null,
      onResolved() {},
      onUnknown() {},
      onError: (message) => messages.push(message),
    })

    await controller.open(media.video)

    assert.deepEqual(media.tracks.map((track) => track.stops), [1, 1])
    assert.equal(messages.length, 1)
    assert.match(messages[0], error.name === 'NotAllowedError' ? /允许.*相机|相机.*权限/u : /扫描.*手动/u)
    assert.doesNotMatch(messages[0], /private|permission detail|reader detail/iu)
  }
})

test('scanner component renders manual fallback without importing ZXing during SSR', () => {
  assert.equal(typeof scannerModule.default, 'function')
  const html = renderToStaticMarkup(createElement(scannerModule.default, {
    open: true,
    warehouseService: { resolveQr: async () => null },
    onResolved() {},
    onClose() {},
  }))

  assert.match(html, /video/u)
  assert.match(html, /手动输入/u)
  assert.match(source, /import\(['"]@zxing\/browser['"]\)/u)
})

test('StrictMode cleanup and reopen suppress stale scanner callbacks and clean each camera once', async () => {
  const dom = installWarehouseReactDom()
  const root = createRoot(dom.createContainer())
  const sessions = []
  const lookups = new Map()
  const outcomes = []
  let imports = 0
  const loadZxing = async () => {
    imports += 1
    return {
      BrowserQRCodeReader: class {
        decodeFromConstraints(_constraints, video, callback) {
          const tracks = [{ stops: 0, stop() { this.stops += 1 } }]
          const controls = { stops: 0, stop() { this.stops += 1 } }
          video.srcObject = { getTracks: () => tracks }
          sessions.push({ callback, controls, tracks })
          return Promise.resolve(controls)
        }
      },
    }
  }
  const warehouseService = {
    resolveQr(code) {
      return new Promise((resolve, reject) => lookups.set(code, { resolve, reject }))
    },
  }
  const render = (open) => createElement(StrictMode, null, createElement(scannerModule.default, {
    open,
    loadZxing,
    warehouseService,
    onResolved: (value) => outcomes.push(value.id),
    onClose() {},
  }))

  try {
    await act(async () => { root.render(render(true)) })
    assert.equal(imports, 2)
    assert.equal(sessions.length, 1)

    sessions[0].callback({ getText: () => 'OLD-SLOW' }, null, sessions[0].controls)
    await act(async () => {})
    assert.equal(lookups.has('OLD-SLOW'), true)

    await act(async () => { root.render(render(false)) })
    await act(async () => { root.render(render(true)) })
    assert.equal(sessions.length, 2)
    sessions[1].callback({ getText: () => 'NEW-FAST' }, null, sessions[1].controls)
    await act(async () => {})
    lookups.get('NEW-FAST').resolve({ id: 'new-variant' })
    await act(async () => {})
    assert.deepEqual(outcomes, ['new-variant'])

    lookups.get('OLD-SLOW').resolve({ id: 'old-variant' })
    await act(async () => {})
    assert.deepEqual(outcomes, ['new-variant'])

    await act(async () => { root.unmount() })
    for (const session of sessions) {
      assert.equal(session.controls.stops, 1)
      assert.deepEqual(session.tracks.map((track) => track.stops), [1])
    }
  } finally {
    dom.cleanup()
  }
})

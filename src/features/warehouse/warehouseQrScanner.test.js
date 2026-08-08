import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { StrictMode, act, createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import {
  findWarehouseTestElement,
  installWarehouseReactDom,
  TestEvent,
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
  const stream = { getTracks: () => tracks }
  return { tracks, stream, video: { srcObject: null } }
}

function deferredReader(stream) {
  let callback
  let activeVideo
  const controls = {
    stops: 0,
    stop() {
      this.stops += 1
      for (const track of stream?.getTracks?.() ?? []) track.stop()
      if (activeVideo?.srcObject === stream) activeVideo.srcObject = null
    },
  }
  class BrowserQRCodeReader {
    async decodeFromConstraints(constraints, video, next) {
      assert.deepEqual(constraints, { video: { facingMode: { ideal: 'environment' } } })
      assert.ok(video)
      video.srcObject = stream
      activeVideo = video
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
  const media = mediaFixture(3)
  const reader = deferredReader(media.stream)
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
  const stream = { getTracks: () => [track] }
  const video = { srcObject: null }
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
    async decodeFromConstraints(_constraints, nextVideo, next) {
      nextVideo.srcObject = stream
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
  const stream = { getTracks: () => [track] }
  const video = { srcObject: null }
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
    decodeFromConstraints(_constraints, nextVideo, callback) {
      nextVideo.srcObject = stream
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
    async decodeFromConstraints(_constraints, video) {
      video.srcObject = media.stream
      return controls
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
    await controller.open(media.video)
    controller.close()
    await new Promise((resolve) => setImmediate(resolve))
  } finally {
    process.off('unhandledRejection', captureUnhandled)
  }

  assert.equal(thenCalls, 1)
  assert.deepEqual(unhandled, [])
  assert.deepEqual(media.tracks.map((track) => track.stops), [0])
  assert.equal(media.video.srcObject, media.stream)
})

test('close and unmount cleanup are idempotent and stop controls plus every track', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const media = mediaFixture()
  const reader = deferredReader(media.stream)
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
  assert.deepEqual(importMedia.tracks.map((track) => track.stops), [0, 0])

  let releaseControls
  let decodeStarted
  const controls = {
    stops: 0,
    stop() {
      this.stops += 1
      for (const track of controlsMedia.stream.getTracks()) track.stop()
      if (controlsMedia.video.srcObject === controlsMedia.stream) controlsMedia.video.srcObject = null
    },
  }
  const controlsStarted = new Promise((resolve) => { decodeStarted = resolve })
  const controlsMedia = mediaFixture(3)
  class BrowserQRCodeReader {
    decodeFromConstraints(_constraints, video) {
      video.srcObject = controlsMedia.stream
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

test('close before media attachment stops late returned controls without adopting the late stream', async () => {
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
  assert.equal(track.stops, 0)
  assert.equal(video.srcObject, lateStream)
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

test('late rejecting controls are observed without adopting an unproven stream', async () => {
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
  assert.equal(track.stops, 0)
  assert.equal(video.srcObject, lateStream)
})

test('late cleanup skips ended tracks and stops every live track exactly once', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let releaseControls
  let callback
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
    decodeFromConstraints(_constraints, _video, next) {
      callback = next
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
  callback(null, Object.assign(new Error('reader stopped'), { name: 'NotFoundException' }), controls)
  releaseControls()
  await opening

  assert.equal(controls.stops, 1)
  assert.deepEqual(tracks.map((track) => track.stops), [0, 1, 1])
  assert.equal(video.srcObject, null)
})

test('video lease rejects a second controller before old decode settles and admits it after release', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const video = { srcObject: null }
  const oldTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const newTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const oldStream = { getTracks: () => [oldTrack] }
  const newStream = { getTracks: () => [newTrack] }
  let releaseOldControls
  let markOldStarted
  let newLoaderCalls = 0
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve })
  const oldControls = {
    stops: 0,
    stop() {
      this.stops += 1
      oldTrack.stop()
      if (video.srcObject === oldStream) video.srcObject = null
    },
  }
  const newControls = { stops: 0, stop() { this.stops += 1 } }
  class OldReader {
    decodeFromConstraints() {
      video.srcObject = oldStream
      markOldStarted()
      return new Promise((resolve) => { releaseOldControls = () => resolve(oldControls) })
    }
  }
  class NewReader {
    async decodeFromConstraints() {
      video.srcObject = newStream
      return newControls
    }
  }
  const callbacks = { resolveQr: async () => null, onResolved() {}, onUnknown() {}, onError() {} }
  const oldController = scannerModule.createWarehouseQrScannerController({
    ...callbacks,
    loadZxing: async () => ({ BrowserQRCodeReader: OldReader }),
  })
  const messages = []
  const newController = scannerModule.createWarehouseQrScannerController({
    ...callbacks,
    loadZxing: async () => { newLoaderCalls += 1; return { BrowserQRCodeReader: NewReader } },
    onError: (message) => messages.push(message),
  })

  const oldOpening = oldController.open(video)
  await oldStarted
  oldController.close()
  const blocked = await newController.open(video)

  assert.equal(blocked, null)
  assert.equal(newLoaderCalls, 0)
  assert.deepEqual(messages, ['相机正在关闭，请稍后重试或改用手动输入'])
  assert.notEqual(video.srcObject, newStream)

  releaseOldControls()
  await oldOpening
  const opened = await newController.open(video)

  assert.equal(opened, newControls)
  assert.equal(newLoaderCalls, 1)
  assert.equal(oldControls.stops, 1)
  assert.equal(oldTrack.stops, 1)
  assert.equal(newControls.stops, 0)
  assert.equal(newTrack.stops, 0)
  assert.equal(video.srcObject, newStream)
})

for (const outcome of ['resolve', 'reject']) {
  test(`video lease remains busy until old asynchronous controls ${outcome}`, async () => {
    assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
    const video = { srcObject: null }
    const oldTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
    const newTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
    const oldStream = { getTracks: () => [oldTrack] }
    const newStream = { getTracks: () => [newTrack] }
    let finishOldStop
    let newLoaderCalls = 0
    const oldControls = {
      stops: 0,
      stop() {
        this.stops += 1
        oldTrack.stop()
        if (video.srcObject === oldStream) video.srcObject = null
        return new Promise((resolve, reject) => {
          finishOldStop = () => outcome === 'resolve'
            ? resolve()
            : reject(new Error('private old stop failure'))
        })
      },
    }
    const newControls = { stops: 0, stop() { this.stops += 1 } }
    class OldReader {
      async decodeFromConstraints() {
        video.srcObject = oldStream
        return oldControls
      }
    }
    class NewReader {
      async decodeFromConstraints() {
        video.srcObject = newStream
        return newControls
      }
    }
    const callbacks = { resolveQr: async () => null, onResolved() {}, onUnknown() {}, onError() {} }
    const oldController = scannerModule.createWarehouseQrScannerController({
      ...callbacks,
      loadZxing: async () => ({ BrowserQRCodeReader: OldReader }),
    })
    const messages = []
    const newController = scannerModule.createWarehouseQrScannerController({
      ...callbacks,
      loadZxing: async () => { newLoaderCalls += 1; return { BrowserQRCodeReader: NewReader } },
      onError: (message) => messages.push(message),
    })
    const unhandled = []
    const captureUnhandled = (error) => unhandled.push(error)
    process.on('unhandledRejection', captureUnhandled)
    try {
      await oldController.open(video)
      oldController.close()
      const blocked = await newController.open(video)

      assert.equal(blocked, null)
      assert.equal(newLoaderCalls, 0)
      assert.deepEqual(messages, ['相机正在关闭，请稍后重试或改用手动输入'])

      finishOldStop()
      await new Promise((resolve) => setImmediate(resolve))
      const opened = await newController.open(video)

      assert.equal(opened, newControls)
      assert.equal(newLoaderCalls, 1)
      assert.equal(oldControls.stops, 1)
      assert.equal(oldTrack.stops, 1)
      assert.equal(newTrack.stops, 0)
      assert.equal(video.srcObject, newStream)
      assert.deepEqual(unhandled, [])
    } finally {
      process.off('unhandledRejection', captureUnhandled)
    }
  })
}

test('same controller cannot reopen one video until its prior session lease releases', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const video = { srcObject: null }
  const oldTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const newTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const oldStream = { getTracks: () => [oldTrack] }
  const newStream = { getTracks: () => [newTrack] }
  let releaseOldControls
  let markOldStarted
  let loaderCalls = 0
  let decodeCalls = 0
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve })
  const oldControls = {
    stops: 0,
    stop() {
      this.stops += 1
      oldTrack.stop()
      if (video.srcObject === oldStream) video.srcObject = null
    },
  }
  const newControls = { stops: 0, stop() { this.stops += 1 } }
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      decodeCalls += 1
      if (decodeCalls === 1) {
        video.srcObject = oldStream
        markOldStarted()
        return new Promise((resolve) => { releaseOldControls = () => resolve(oldControls) })
      }
      video.srcObject = newStream
      return Promise.resolve(newControls)
    }
  }
  const messages = []
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { loaderCalls += 1; return { BrowserQRCodeReader } },
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {},
    onError: (message) => messages.push(message),
  })

  const oldOpening = controller.open(video)
  await oldStarted
  const blocked = await controller.open(video)

  assert.equal(blocked, null)
  assert.equal(loaderCalls, 1)
  assert.deepEqual(messages, ['相机正在关闭，请稍后重试或改用手动输入'])

  releaseOldControls()
  await oldOpening
  const opened = await controller.open(video)

  assert.equal(opened, newControls)
  assert.equal(loaderCalls, 2)
  assert.equal(oldControls.stops, 1)
  assert.equal(oldTrack.stops, 1)
  assert.equal(newTrack.stops, 0)
  assert.equal(video.srcObject, newStream)
})

test('old cleanup never adopts or detaches an unreported external stream replacement', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const video = { srcObject: null }
  const oldTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const oldStream = { getTracks: () => [oldTrack] }
  const externalStream = { getTracks: () => [externalTrack] }
  let finishOldStop
  const oldControls = {
    stops: 0,
    stop() {
      this.stops += 1
      oldTrack.stop()
      return new Promise((resolve) => { finishOldStop = resolve })
    },
  }
  class BrowserQRCodeReader {
    async decodeFromConstraints() {
      video.srcObject = oldStream
      return oldControls
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })

  await controller.open(video)
  controller.close()
  video.srcObject = externalStream
  finishOldStop()
  await new Promise((resolve) => setImmediate(resolve))

  assert.equal(oldControls.stops, 1)
  assert.equal(oldTrack.stops, 1)
  assert.equal(externalTrack.stops, 0)
  assert.equal(video.srcObject, externalStream)
})

test('a disposed controller rejects camera open without loader or error callback', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let loaderCalls = 0
  const messages = []
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { loaderCalls += 1; return {} },
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {},
    onError: (message) => messages.push(message),
  })
  controller.close()

  assert.equal(await controller.open({ srcObject: null }), null)
  assert.equal(loaderCalls, 0)
  assert.deepEqual(messages, [])
})

test('a throwing busy error callback is contained and cannot bypass the held video lease', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const video = { srcObject: null }
  let releaseOldControls
  let markOldStarted
  let newLoaderCalls = 0
  let busyCalls = 0
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve })
  const oldControls = { stop() {} }
  const newControls = { stop() {} }
  class OldReader {
    decodeFromConstraints() {
      markOldStarted()
      return new Promise((resolve) => { releaseOldControls = () => resolve(oldControls) })
    }
  }
  class NewReader {
    async decodeFromConstraints() { return newControls }
  }
  const oldController = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader: OldReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })
  const newController = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { newLoaderCalls += 1; return { BrowserQRCodeReader: NewReader } },
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {},
    onError() { busyCalls += 1; throw new Error('private UI callback failure') },
  })

  const oldOpening = oldController.open(video)
  await oldStarted
  oldController.close()
  const blocked = await newController.open(video)

  assert.equal(blocked, null)
  assert.equal(busyCalls, 1)
  assert.equal(newLoaderCalls, 0)

  releaseOldControls()
  await oldOpening
  assert.equal(await newController.open(video), newControls)
  assert.equal(newLoaderCalls, 1)
})

test('a preoccupied video stays external and can be opened only after it becomes empty', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const externalTrackA = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalTrackB = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const scannerTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalStreamA = { getTracks: () => [externalTrackA] }
  const externalStreamB = { getTracks: () => [externalTrackB] }
  const scannerStream = { getTracks: () => [scannerTrack] }
  const video = { srcObject: externalStreamA }
  const controls = {
    stops: 0,
    stop() {
      this.stops += 1
      scannerTrack.stop()
      if (video.srcObject === scannerStream) video.srcObject = null
    },
  }
  let loaderCalls = 0
  const messages = []
  class BrowserQRCodeReader {
    async decodeFromConstraints() {
      video.srcObject = scannerStream
      return controls
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { loaderCalls += 1; return { BrowserQRCodeReader } },
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {},
    onError(message) {
      messages.push(message)
      video.srcObject = externalStreamB
    },
  })

  assert.equal(await controller.open(video), null)
  assert.equal(loaderCalls, 0)
  assert.deepEqual(messages, ['相机正在被其他操作使用，请稍后或手动输入'])
  assert.equal(externalTrackA.stops, 0)
  assert.equal(externalTrackB.stops, 0)
  assert.equal(video.srcObject, externalStreamB)

  video.srcObject = null
  assert.equal(await controller.open(video), controls)
  assert.equal(loaderCalls, 1)
  controller.close()
  assert.equal(scannerTrack.stops, 1)
})

test('a throwing external-camera busy callback is contained without loading or touching its stream', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const stream = { getTracks: () => [track] }
  const video = { srcObject: stream }
  let loaderCalls = 0
  let errorCalls = 0
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { loaderCalls += 1; return {} },
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {},
    onError() { errorCalls += 1; throw new Error('private UI callback failure') },
  })

  assert.equal(await controller.open(video), null)
  assert.equal(errorCalls, 1)
  assert.equal(loaderCalls, 0)
  assert.equal(track.stops, 0)
  assert.equal(video.srcObject, stream)
})

test('an unreadable video source fails closed without a lease and opens after its getter recovers', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  let readThrows = true
  let attachedStream = null
  const video = {
    get srcObject() {
      if (readThrows) throw new Error('private srcObject getter failure')
      return attachedStream
    },
    set srcObject(value) { attachedStream = value },
  }
  const controls = { stop() {} }
  let loaderCalls = 0
  const messages = []
  class BrowserQRCodeReader {
    async decodeFromConstraints() { return controls }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => { loaderCalls += 1; return { BrowserQRCodeReader } },
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {},
    onError: (message) => messages.push(message),
  })

  assert.equal(await controller.open(video), null)
  assert.equal(loaderCalls, 0)
  assert.deepEqual(messages, ['相机正在被其他操作使用，请稍后或手动输入'])

  readThrows = false
  assert.equal(await controller.open(video), controls)
  assert.equal(loaderCalls, 1)
})

test('an undefined or missing video source fails closed without mutation or a retained lease', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  for (const [kind, video] of [
    ['undefined', { srcObject: undefined }],
    ['missing', {}],
  ]) {
    const hadOwnSource = Object.hasOwn(video, 'srcObject')
    const controls = { stop() {} }
    let loaderCalls = 0
    const messages = []
    class BrowserQRCodeReader {
      async decodeFromConstraints() { return controls }
    }
    const controller = scannerModule.createWarehouseQrScannerController({
      loadZxing: async () => { loaderCalls += 1; return { BrowserQRCodeReader } },
      resolveQr: async () => null,
      onResolved() {}, onUnknown() {},
      onError: (message) => messages.push(message),
    })

    assert.equal(await controller.open(video), null, kind)
    assert.equal(loaderCalls, 0, kind)
    assert.deepEqual(messages, ['相机正在被其他操作使用，请稍后或手动输入'], kind)
    assert.equal(Object.hasOwn(video, 'srcObject'), hadOwnSource, kind)
    assert.equal(video.srcObject, undefined, kind)

    video.srcObject = null
    assert.equal(await controller.open(video), controls, kind)
    assert.equal(loaderCalls, 1, kind)
    controller.close()
  }
})

test('returned controls clean their internal stream but leave a later external replacement attached', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const scannerTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const scannerStream = { getTracks: () => [scannerTrack] }
  const externalStream = { getTracks: () => [externalTrack] }
  const video = { srcObject: null }
  const controls = {
    stops: 0,
    stop() {
      this.stops += 1
      scannerTrack.stop()
      if (video.srcObject === scannerStream) video.srcObject = null
    },
  }
  let releaseControls
  let markStarted
  const started = new Promise((resolve) => { markStarted = resolve })
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      video.srcObject = scannerStream
      markStarted()
      return new Promise((resolve) => { releaseControls = () => resolve(controls) })
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })

  const opening = controller.open(video)
  await started
  video.srcObject = externalStream
  releaseControls()
  assert.equal(await opening, controls)
  controller.close()

  assert.equal(controls.stops, 1)
  assert.equal(scannerTrack.stops, 1)
  assert.equal(externalTrack.stops, 0)
  assert.equal(video.srcObject, externalStream)
})

test('decode controls settle never adopts an external stream without callback provenance', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const internalTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalStream = { getTracks: () => [externalTrack] }
  const video = { srcObject: null }
  const controls = {
    stops: 0,
    stop() {
      this.stops += 1
      internalTrack.stop()
    },
  }
  let releaseControls
  class BrowserQRCodeReader {
    decodeFromConstraints() {
      return new Promise((resolve) => {
        releaseControls = () => {
          resolve(controls)
        }
      })
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async () => null,
    onResolved() {}, onUnknown() {}, onError() {},
  })

  const opening = controller.open(video)
  await new Promise((resolve) => setImmediate(resolve))
  video.srcObject = externalStream
  releaseControls()
  assert.equal(await opening, controls)
  controller.close()

  assert.equal(controls.stops, 1)
  assert.equal(internalTrack.stops, 1)
  assert.equal(externalTrack.stops, 0)
  assert.equal(video.srcObject, externalStream)
})

test('a primitive callback controls value resolves its QR without granting stream ownership', async () => {
  assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
  const externalTrack = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
  const externalStream = { getTracks: () => [externalTrack] }
  const video = { srcObject: null }
  const controls = { stops: 0, stop() { this.stops += 1 } }
  const resolved = []
  class BrowserQRCodeReader {
    decodeFromConstraints(_constraints, nextVideo, callback) {
      nextVideo.srcObject = externalStream
      callback({ getText: () => 'PRIMITIVE-CONTROLS' }, null, 7)
      return Promise.resolve(controls)
    }
  }
  const controller = scannerModule.createWarehouseQrScannerController({
    loadZxing: async () => ({ BrowserQRCodeReader }),
    resolveQr: async (code) => ({ id: 'variant-primitive', code }),
    onResolved: (value) => resolved.push(value),
    onUnknown() {}, onError() {},
  })

  assert.equal(await controller.open(video), null)
  await new Promise((resolve) => setImmediate(resolve))

  assert.deepEqual(resolved, [{ id: 'variant-primitive', code: 'PRIMITIVE-CONTROLS' }])
  assert.equal(controls.stops, 1)
  assert.equal(externalTrack.stops, 0)
  assert.equal(video.srcObject, externalStream)
})

for (const failure of ['loader reject', 'decode reject', 'decode sync throw']) {
  test(`video lease releases after ${failure}`, async () => {
    assert.equal(typeof scannerModule.createWarehouseQrScannerController, 'function')
    const video = { srcObject: null }
    const track = { readyState: 'live', stops: 0, stop() { this.stops += 1; this.readyState = 'ended' } }
    const stream = { getTracks: () => [track] }
    const firstMessages = []
    class FailingReader {
      decodeFromConstraints() {
        video.srcObject = stream
        if (failure === 'decode sync throw') throw new Error('private sync decode failure')
        return Promise.reject(new Error('private async decode failure'))
      }
    }
    const firstController = scannerModule.createWarehouseQrScannerController({
      loadZxing: failure === 'loader reject'
        ? async () => { throw new Error('private loader failure') }
        : async () => ({ BrowserQRCodeReader: FailingReader }),
      resolveQr: async () => null,
      onResolved() {}, onUnknown() {},
      onError: (message) => firstMessages.push(message),
    })
    const nextControls = { stop() {} }
    let nextLoaderCalls = 0
    class NextReader {
      async decodeFromConstraints() { return nextControls }
    }
    const nextController = scannerModule.createWarehouseQrScannerController({
      loadZxing: async () => { nextLoaderCalls += 1; return { BrowserQRCodeReader: NextReader } },
      resolveQr: async () => null,
      onResolved() {}, onUnknown() {}, onError() {},
    })

    assert.equal(await firstController.open(video), null)
    assert.equal(firstMessages.length, 1)
    assert.doesNotMatch(firstMessages[0], /private|loader|decode/iu)
    if (failure !== 'loader reject') {
      assert.equal(track.stops, 0)
      assert.equal(video.srcObject, stream)
      video.srcObject = null
    }
    assert.equal(await nextController.open(video), nextControls)
    assert.equal(nextLoaderCalls, 1)
    assert.equal(track.stops, 0)
  })
}

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
    const controls = { stops: 0, stop() { this.stops += 1 } }
    class BrowserQRCodeReader {
      async decodeFromConstraints(_constraints, video, callback) {
        video.srcObject = media.stream
        callback(null, error, controls)
        return controls
      }
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
    assert.equal(controls.stops, 1)
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

test('effect startup microtask cancels an unmounted scanner before loading the camera', async () => {
  const dom = installWarehouseReactDom()
  const root = createRoot(dom.createContainer())
  let loaderCalls = 0
  const loadZxing = async () => { loaderCalls += 1; return {} }
  const warehouseService = { resolveQr: async () => null }
  function Harness() {
    const [mounted, setMounted] = useState(true)
    useEffect(() => { setMounted(false) }, [])
    return mounted ? createElement(scannerModule.default, {
      open: true,
      loadZxing,
      warehouseService,
      onResolved() {},
      onClose() {},
    }) : null
  }

  try {
    await act(async () => { root.render(createElement(StrictMode, null, createElement(Harness))) })
    assert.equal(loaderCalls, 0)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('effect prop change cancels every old dependency and starts only the new keyed video session', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const oldCalls = { loader: 0, service: 0, resolved: 0 }
  const newCalls = { loader: 0, service: 0, resolved: 0 }
  let newCallback
  const oldLoader = async () => { oldCalls.loader += 1; return {} }
  const newLoader = async () => {
    newCalls.loader += 1
    return {
      BrowserQRCodeReader: class {
        async decodeFromConstraints(_constraints, _video, callback) {
          newCallback = callback
          return { stop() {} }
        }
      },
    }
  }
  const oldService = { resolveQr: async () => { oldCalls.service += 1; return { id: 'old' } } }
  const newService = { resolveQr: async () => { newCalls.service += 1; return { id: 'new' } } }
  const oldResolved = () => { oldCalls.resolved += 1 }
  const newResolved = () => { newCalls.resolved += 1 }
  function Harness() {
    const [fresh, setFresh] = useState(false)
    useEffect(() => { setFresh(true) }, [])
    return createElement(scannerModule.default, {
      open: true,
      loadZxing: fresh ? newLoader : oldLoader,
      warehouseService: fresh ? newService : oldService,
      onResolved: fresh ? newResolved : oldResolved,
      onClose() {},
    })
  }

  try {
    await act(async () => { root.render(createElement(Harness)) })
    assert.deepEqual(oldCalls, { loader: 0, service: 0, resolved: 0 })
    assert.equal(newCalls.loader, 1)
    assert.equal(typeof newCallback, 'function')

    newCallback({ getText: () => 'NEW-SESSION' }, null, { stop() {} })
    await act(async () => {})

    assert.deepEqual(oldCalls, { loader: 0, service: 0, resolved: 0 })
    assert.deepEqual(newCalls, { loader: 1, service: 1, resolved: 1 })
    assert.ok(findWarehouseTestElement(container, (element) => element.nodeName === 'VIDEO'))
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
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
    assert.equal(imports, 1)
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

test('React gives every restarted or reopened camera session a distinct keyed video element', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const createLoader = () => async () => ({
    BrowserQRCodeReader: class {
      async decodeFromConstraints() { return { stop() {} } }
    },
  })
  let loadZxing = createLoader()
  const warehouseService = { resolveQr: async () => null }
  const onResolved = () => {}
  const render = (open) => createElement(scannerModule.default, {
    open,
    loadZxing,
    warehouseService,
    onResolved,
    onClose() {},
  })

  try {
    await act(async () => { root.render(render(true)) })
    const firstVideo = findWarehouseTestElement(container, (element) => element.nodeName === 'VIDEO')
    assert.ok(firstVideo)

    loadZxing = createLoader()
    await act(async () => { root.render(render(true)) })
    const restartedVideo = findWarehouseTestElement(container, (element) => element.nodeName === 'VIDEO')
    assert.ok(restartedVideo)
    assert.notEqual(restartedVideo, firstVideo)

    await act(async () => { root.render(render(false)) })
    assert.equal(container.contains(restartedVideo), false)
    await act(async () => { root.render(render(true)) })
    const secondVideo = findWarehouseTestElement(container, (element) => element.nodeName === 'VIDEO')

    assert.ok(secondVideo)
    assert.notEqual(secondVideo, restartedVideo)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('scanner dialog traps boundary focus, closes on Escape, and restores its surviving trigger', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const loadZxing = async () => ({})
  const warehouseService = { resolveQr: async () => null }
  const onResolved = () => {}
  let mounted = true
  function Harness() {
    const [open, setOpen] = useState(false)
    return createElement('div', null,
      createElement('button', { type: 'button', onClick: () => setOpen(true) }, '打开扫码'),
      createElement(scannerModule.default, {
        open,
        loadZxing,
        warehouseService,
        onResolved,
        onClose: () => setOpen(false),
      }),
    )
  }
  try {
    await act(async () => { root.render(createElement(Harness)) })
    const trigger = findWarehouseTestElement(container, (element) => element.nodeName === 'BUTTON' && element.textContent === '打开扫码')
    trigger.focus()
    await act(async () => { trigger.click() })
    const dialog = findWarehouseTestElement(container, (element) => element.className === 'warehouse-qr-scanner')
    const closeButton = findWarehouseTestElement(dialog, (element) => element.nodeName === 'BUTTON' && element.textContent === '关闭')
    const queryButton = findWarehouseTestElement(dialog, (element) => element.nodeName === 'BUTTON' && element.textContent === '查询')
    const initialFocus = dom.document.activeElement
    const backgroundWasIsolated = trigger.inert === true && trigger.getAttribute('aria-hidden') === 'true'

    queryButton.focus()
    await act(async () => { dialog.dispatchEvent(new TestEvent('keydown', { key: 'Tab' })) })
    const forwardWrap = dom.document.activeElement
    closeButton.focus()
    await act(async () => { dialog.dispatchEvent(new TestEvent('keydown', { key: 'Tab', shiftKey: true })) })
    const backwardWrap = dom.document.activeElement

    await act(async () => { dialog.dispatchEvent(new TestEvent('keydown', { key: 'Escape' })) })
    const escaped = findWarehouseTestElement(container, (element) => element.className === 'warehouse-qr-scanner') === null
    if (!escaped) {
      await act(async () => { closeButton.click() })
    }
    const restoredFocus = dom.document.activeElement
    const backgroundWasRestored = trigger.inert !== true && trigger.getAttribute('aria-hidden') === null
    await act(async () => { root.unmount() })
    mounted = false

    assert.equal(initialFocus, closeButton)
    assert.equal(backgroundWasIsolated, true)
    assert.equal(forwardWrap, closeButton)
    assert.equal(backwardWrap, queryButton)
    assert.equal(escaped, true)
    assert.equal(restoredFocus, trigger)
    assert.equal(backgroundWasRestored, true)
  } finally {
    if (mounted) root.unmount()
    dom.cleanup()
  }
})

test('modal isolation stack restores the underlying scanner before the page in nested order', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const loadZxing = async () => ({})
  const warehouseService = { resolveQr: async () => null }
  const onResolved = () => {}
  const collectDialogs = (node, result = []) => {
    if (node?.nodeType === 1 && node.className === 'warehouse-qr-scanner') result.push(node)
    for (const child of node?.childNodes ?? []) collectDialogs(child, result)
    return result
  }
  function Harness() {
    const [firstOpen, setFirstOpen] = useState(false)
    const [secondOpen, setSecondOpen] = useState(false)
    return createElement('div', null,
      createElement('button', { type: 'button', onClick: () => setFirstOpen(true) }, '打开第一层'),
      createElement('button', { type: 'button', onClick: () => setSecondOpen(true) }, '打开第二层'),
      createElement(scannerModule.default, { open: firstOpen, loadZxing, warehouseService, onResolved, onClose: () => setFirstOpen(false) }),
      createElement(scannerModule.default, { open: secondOpen, loadZxing, warehouseService, onResolved, onClose: () => setSecondOpen(false) }),
    )
  }
  try {
    await act(async () => { root.render(createElement(Harness)) })
    const firstTrigger = findWarehouseTestElement(container, (element) => element.nodeName === 'BUTTON' && element.textContent === '打开第一层')
    const secondTrigger = findWarehouseTestElement(container, (element) => element.nodeName === 'BUTTON' && element.textContent === '打开第二层')
    firstTrigger.focus()
    await act(async () => { firstTrigger.click() })
    const firstDialog = collectDialogs(container)[0]
    const firstClose = findWarehouseTestElement(firstDialog, (element) => element.nodeName === 'BUTTON' && element.textContent === '关闭')
    firstClose.focus()

    await act(async () => { secondTrigger.click() })
    const dialogs = collectDialogs(container)
    const secondDialog = dialogs[1]
    assert.equal(firstDialog.inert, true)
    assert.equal(dom.document.activeElement, findWarehouseTestElement(secondDialog, (element) => element.nodeName === 'BUTTON' && element.textContent === '关闭'))

    await act(async () => { secondDialog.dispatchEvent(new TestEvent('keydown', { key: 'Escape' })) })
    assert.deepEqual(collectDialogs(container), [firstDialog])
    assert.equal(firstDialog.inert, false)
    assert.equal(dom.document.activeElement, firstClose)

    await act(async () => { firstDialog.dispatchEvent(new TestEvent('keydown', { key: 'Escape' })) })
    assert.deepEqual(collectDialogs(container), [])
    assert.equal(dom.document.activeElement, firstTrigger)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

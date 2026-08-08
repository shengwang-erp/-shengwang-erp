import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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
    stops: 0,
    stop() { this.stops += 1 },
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

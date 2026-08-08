import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

import {
  findWarehouseTestElement,
  installWarehouseReactDom,
  TestEvent,
} from './warehouseReactDomTestUtils.js'

const [componentSource, cssSource] = await Promise.all([
  readFile(new URL('./WarehouseLabelSheet.jsx', import.meta.url), 'utf8').catch(() => ''),
  readFile(new URL('./warehouseLabel.css', import.meta.url), 'utf8').catch(() => ''),
])

async function loadLabelModule() {
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    logLevel: 'silent',
    appType: 'custom',
    server: { middlewareMode: true },
  })
  try {
    return await server.ssrLoadModule('/src/features/warehouse/WarehouseLabelSheet.jsx')
  } catch {
    return {}
  } finally {
    await server.close()
  }
}

const labelModule = await loadLabelModule()
const LABEL = Object.freeze({
  companyName: '盛旺株式会社',
  itemName: '铜管',
  model: 'R410A',
  size: '6mm',
  material: '铜',
  sku: 'CU-6MM',
  unit: '米',
  systemQr: 'SWERP:VARIANT:93000000-0000-4000-8000-000000000001',
  warehouseName: '本社仓',
  shelfName: 'A区一号架',
})
const LABEL_A = Object.freeze({ ...LABEL, systemQr: 'SWERP:VARIANT:LABEL-A', itemName: '物品A' })
const LABEL_B = Object.freeze({ ...LABEL, systemQr: 'SWERP:VARIANT:LABEL-B', itemName: '物品B' })
const LABEL_C = Object.freeze({ ...LABEL, systemQr: 'SWERP:VARIANT:LABEL-C', itemName: '物品C' })
const PNG_A = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAQ=='
const PNG_B = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAg=='
const PNG_C = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAw=='

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

test('label QR dependency loads only when QR rendering is requested and receives the system QR', async () => {
  assert.equal(typeof labelModule.loadWarehouseLabelQrDataUrl, 'function')
  let imports = 0
  let received
  const loadQrcode = async () => {
    imports += 1
    return {
      toDataURL: async (value, options) => {
        received = { value, options }
        return 'data:image/png;base64,warehouse-label'
      },
    }
  }

  assert.equal(imports, 0)
  const url = await labelModule.loadWarehouseLabelQrDataUrl(LABEL.systemQr, loadQrcode)

  assert.equal(imports, 1)
  assert.equal(url, 'data:image/png;base64,warehouse-label')
  assert.deepEqual(received, {
    value: LABEL.systemQr,
    options: { errorCorrectionLevel: 'M', margin: 1, width: 256 },
  })
  assert.match(componentSource, /import\(['"]qrcode['"]\)/u)
})

test('printable label contains company, item, variant, SKU, unit, system QR and optional location', () => {
  assert.equal(typeof labelModule.default, 'function')
  const html = renderToStaticMarkup(createElement(labelModule.default, {
    label: LABEL,
    qrDataUrl: { systemQr: LABEL.systemQr, dataUrl: PNG_A },
  }))

  for (const text of [
    '盛旺株式会社', '铜管', 'R410A', '6mm', '铜', 'CU-6MM', '米',
    LABEL.systemQr, '本社仓', 'A区一号架',
  ]) assert.match(html, new RegExp(text, 'u'))
  assert.match(html, /class="warehouse-label-print-sheet/u)
  assert.match(html, /data:image\/png;base64,iVBORw0KGgo/u)

  const withoutLocation = renderToStaticMarkup(createElement(labelModule.default, {
    label: { ...LABEL, warehouseName: null, shelfName: null },
    qrDataUrl: { systemQr: LABEL.systemQr, dataUrl: PNG_A },
  }))
  assert.doesNotMatch(withoutLocation, /本社仓|A区一号架/u)
})

test('label print CSS uses one named page and only warehouse-label scoped selectors', () => {
  assert.match(cssSource, /@page\s+warehouse-label\s*\{/u)
  assert.doesNotMatch(cssSource, /@page\s*\{/u)
  assert.match(cssSource, /\.warehouse-label-print-sheet\s*\{[^}]*\bpage:\s*warehouse-label\s*;/su)
  assert.doesNotMatch(cssSource, /(^|[},])\s*(?:html|body|main|#root|\*)\s*[{,]/gmu)

  const selectors = cssSource.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('{') && !line.startsWith('@'))
    .map((line) => line.slice(0, -1).trim())
    .flatMap((selector) => selector.split(',').map((part) => part.trim()))
  assert.ok(selectors.length > 0)
  for (const selector of selectors) {
    assert.match(selector, /^\.warehouse-label-print-sheet(?:\b|__|\s|:)/u)
  }
})

test('label change immediately hides the old QR, disables print, and never restores it on failure', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const pending = new Map()
  const prints = []
  const loadQrDataUrl = (systemQr) => {
    const task = deferred()
    pending.set(systemQr, task)
    return task.promise
  }
  const render = (label) => createElement(labelModule.default, {
    label,
    loadQrDataUrl,
    onPrint: () => prints.push(label.systemQr),
  })

  try {
    await act(async () => { root.render(render(LABEL_A)) })
    assert.equal(pending.has(LABEL_A.systemQr), true)
    pending.get(LABEL_A.systemQr).resolve(PNG_A)
    await act(async () => {})
    let image = findWarehouseTestElement(container, (node) => node.tagName === 'IMG')
    let button = findWarehouseTestElement(container, (node) => node.tagName === 'BUTTON')
    assert.equal(image?.getAttribute('src'), PNG_A)
    assert.equal(button.disabled, true)
    await act(async () => { image.dispatchEvent(new TestEvent('load')) })
    assert.equal(button.disabled, false)

    await act(async () => { root.render(render(LABEL_B)) })
    image = findWarehouseTestElement(container, (node) => node.tagName === 'IMG')
    button = findWarehouseTestElement(container, (node) => node.tagName === 'BUTTON')
    assert.equal(image, null)
    assert.equal(button.disabled, true)
    await act(async () => { button.click() })
    assert.deepEqual(prints, [])

    pending.get(LABEL_B.systemQr).reject(new Error('B failed'))
    await act(async () => {})
    image = findWarehouseTestElement(container, (node) => node.tagName === 'IMG')
    assert.equal(image, null)
    assert.equal(button.disabled, true)
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('rapid A-B-C effects publish only C after image decode and repeated print never regenerates QR', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  const pending = new Map()
  const calls = []
  const prints = []
  const loadQrDataUrl = (systemQr) => {
    calls.push(systemQr)
    const task = deferred()
    pending.set(systemQr, task)
    return task.promise
  }
  const render = (label) => createElement(labelModule.default, {
    label,
    loadQrDataUrl,
    onPrint: () => prints.push(label.systemQr),
  })

  try {
    await act(async () => { root.render(render(LABEL_A)) })
    await act(async () => { root.render(render(LABEL_B)) })
    await act(async () => { root.render(render(LABEL_C)) })
    pending.get(LABEL_B.systemQr).resolve(PNG_B)
    pending.get(LABEL_A.systemQr).resolve(PNG_A)
    await act(async () => {})
    assert.equal(findWarehouseTestElement(container, (node) => node.tagName === 'IMG'), null)

    pending.get(LABEL_C.systemQr).resolve(PNG_C)
    await act(async () => {})
    const image = findWarehouseTestElement(container, (node) => node.tagName === 'IMG')
    const button = findWarehouseTestElement(container, (node) => node.tagName === 'BUTTON')
    assert.equal(image?.getAttribute('src'), PNG_C)
    assert.equal(button.disabled, true)
    const decoding = deferred()
    image.decode = () => decoding.promise
    await act(async () => { image.dispatchEvent(new TestEvent('load')) })
    assert.equal(button.disabled, true)
    decoding.resolve()
    await act(async () => {})
    assert.equal(button.disabled, false)
    await act(async () => { button.click(); button.click() })

    assert.deepEqual(prints, [LABEL_C.systemQr, LABEL_C.systemQr])
    assert.deepEqual(calls, [LABEL_A.systemQr, LABEL_B.systemQr, LABEL_C.systemQr])
  } finally {
    await act(async () => { root.unmount() })
    dom.cleanup()
  }
})

test('unmount drops pending QR work and injected PNG data requires an exact matching trusted key', async () => {
  const dom = installWarehouseReactDom()
  const container = dom.createContainer()
  const root = createRoot(container)
  let firstMounted = true
  let secondRoot = null
  const pending = deferred()
  const calls = []
  const loadQrDataUrl = (systemQr) => {
    calls.push(systemQr)
    return pending.promise
  }

  try {
    await act(async () => {
      root.render(createElement(labelModule.default, {
        label: LABEL_A,
        qrDataUrl: { systemQr: LABEL_B.systemQr, dataUrl: PNG_B },
        loadQrDataUrl,
      }))
    })
    assert.equal(findWarehouseTestElement(container, (node) => node.tagName === 'IMG'), null)
    assert.deepEqual(calls, [LABEL_A.systemQr])

    await act(async () => { root.unmount() })
    firstMounted = false
    pending.resolve(PNG_A)
    await act(async () => {})

    secondRoot = createRoot(container)
    await act(async () => {
      secondRoot.render(createElement(labelModule.default, {
        label: LABEL_A,
        qrDataUrl: { systemQr: ` \ufeff${LABEL_A.systemQr}　`, dataUrl: PNG_A },
        loadQrDataUrl: () => { throw new Error('matching injection must not regenerate') },
      }))
    })
    const image = findWarehouseTestElement(container, (node) => node.tagName === 'IMG')
    const button = findWarehouseTestElement(container, (node) => node.tagName === 'BUTTON')
    assert.equal(image?.getAttribute('src'), PNG_A)
    assert.equal(button.disabled, true)
    await act(async () => { image.dispatchEvent(new TestEvent('load')) })
    assert.equal(button.disabled, false)
    await act(async () => { secondRoot.unmount() })
    secondRoot = null
  } finally {
    if (firstMounted) await act(async () => { root.unmount() })
    if (secondRoot) await act(async () => { secondRoot.unmount() })
    dom.cleanup()
  }
})

test('matching-key injection rejects non-PNG data, extra fields, and unkeyed strings', async () => {
  const dom = installWarehouseReactDom()
  try {
    for (const qrDataUrl of [
      { systemQr: LABEL_A.systemQr, dataUrl: 'data:image/png;base64,bm90LXBuZw==' },
      { systemQr: LABEL_A.systemQr, dataUrl: PNG_A, extra: true },
      PNG_A,
      new Proxy({}, { getPrototypeOf() { throw new Error('unsafe injection proxy') } }),
    ]) {
      const container = dom.createContainer()
      const root = createRoot(container)
      const pending = deferred()
      let loads = 0
      await act(async () => {
        root.render(createElement(labelModule.default, {
          label: LABEL_A,
          qrDataUrl,
          loadQrDataUrl: () => { loads += 1; return pending.promise },
        }))
      })
      assert.equal(findWarehouseTestElement(container, (node) => node.tagName === 'IMG'), null)
      assert.equal(loads, 1)
      await act(async () => { root.unmount() })
      pending.resolve(PNG_A)
      await act(async () => {})
    }
  } finally {
    dom.cleanup()
  }
})

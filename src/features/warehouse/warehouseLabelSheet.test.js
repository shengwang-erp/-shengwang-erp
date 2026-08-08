import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import test from 'node:test'
import { createServer } from 'vite'

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
    qrDataUrl: 'data:image/png;base64,warehouse-label',
  }))

  for (const text of [
    '盛旺株式会社', '铜管', 'R410A', '6mm', '铜', 'CU-6MM', '米',
    LABEL.systemQr, '本社仓', 'A区一号架',
  ]) assert.match(html, new RegExp(text, 'u'))
  assert.match(html, /class="warehouse-label-print-sheet/u)
  assert.match(html, /data:image\/png;base64,warehouse-label/u)

  const withoutLocation = renderToStaticMarkup(createElement(labelModule.default, {
    label: { ...LABEL, warehouseName: null, shelfName: null },
    qrDataUrl: 'data:image/png;base64,warehouse-label',
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

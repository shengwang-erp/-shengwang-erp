import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const CHECKER_PATH = path.join(REPOSITORY_ROOT, 'scripts/verify-warehouse-lazy-dependencies.mjs')
const REQUIRED_DEPENDENCIES = Object.freeze({
  '@zxing/browser': '^0.2.1',
  exceljs: '^4.4.0',
  qrcode: '^1.5.4',
})

function runChecker(root) {
  return spawnSync(process.execPath, [CHECKER_PATH, root], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  })
}

async function createUnownedFixture(source, filename = 'entry.js') {
  const root = await mkdtemp(path.join(tmpdir(), 'warehouse-lazy-contract-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ dependencies: REQUIRED_DEPENDENCIES }, null, 2)}\n`,
  )
  await writeFile(path.join(root, 'src', filename), source)
  return root
}

async function createFixture(source, filename = 'entry.js') {
  const root = await createUnownedFixture(source, filename)
  const ownedDirectory = path.join(root, 'src', 'features', 'warehouse')
  await mkdir(ownedDirectory, { recursive: true })
  await writeFile(
    path.join(ownedDirectory, 'WarehouseQrScanner.jsx'),
    "export const loadScanner = () => import('@zxing/browser')\n",
  )
  await writeFile(
    path.join(ownedDirectory, 'WarehouseLabelSheet.jsx'),
    "export const loadLabelQr = () => import('qrcode')\n",
  )
  await writeFile(
    path.join(ownedDirectory, 'WarehouseCatalog.jsx'),
    "import './WarehouseQrScanner.jsx'\nimport './WarehouseLabelSheet.jsx'\nexport default function WarehouseCatalog() { return null }\n",
  )
  return root
}

async function createOwnedFixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'warehouse-lazy-owned-contract-'))
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ dependencies: REQUIRED_DEPENDENCIES }, null, 2)}\n`,
  )
  const ownedFiles = {
    'WarehouseCatalog.jsx': "import './WarehouseQrScanner.jsx'\nimport './WarehouseLabelSheet.jsx'\nexport default function WarehouseCatalog() { return null }\n",
    ...files,
  }
  for (const [filename, source] of Object.entries(ownedFiles)) {
    const target = path.join(root, 'src', 'features', 'warehouse', filename)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, source)
  }
  return root
}

async function createCatalogGraphFixture({ connectScanner = true, connectLabel = true } = {}) {
  const imports = [
    connectScanner ? "import WarehouseQrScanner from './WarehouseQrScanner.jsx'" : '',
    connectLabel ? "import WarehouseLabelSheet from './WarehouseLabelSheet.jsx'" : '',
  ].filter(Boolean).join('\n')
  return createOwnedFixture({
    'WarehouseCatalog.jsx': `${imports}\nexport default function WarehouseCatalog() { return null }\n`,
    'WarehouseQrScanner.jsx': `export const loadScanner = () => import('@zxing/browser')\n`,
    'WarehouseLabelSheet.jsx': `export const loadLabelQr = () => import('qrcode')\n`,
  })
}

test('warehouse media dependencies are direct dependencies and production source has no eager imports', () => {
  const result = runChecker(REPOSITORY_ROOT)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('static ESM imports of warehouse media dependencies fail the executable boundary', async (t) => {
  const root = await createFixture("import QRCode from 'qrcode'\nexport default QRCode\n")
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static import.*qrcode/iu)
})

test('static ESM re-exports of warehouse media dependencies fail the executable boundary', async (t) => {
  const root = await createFixture(`
export { default as QRCode } from 'qrcode'
export * from 'exceljs'
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static import.*qrcode/iu)
  assert.match(`${result.stdout}${result.stderr}`, /static import.*exceljs/iu)
})

test('CommonJS require of warehouse media dependencies fails the executable boundary', async (t) => {
  const root = await createFixture("const ExcelJS = require('exceljs')\nexport default ExcelJS\n")
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*exceljs/iu)
})

test('TypeScript import-equals of a warehouse media dependency fails the executable boundary', async (t) => {
  const root = await createFixture(
    "import ExcelJS = require('exceljs')\nexport default ExcelJS\n",
    'entry.ts',
  )
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /TypeScript import-equals.*exceljs/iu)
})

test('optional require and module.require of warehouse media dependencies fail the boundary', async (t) => {
  const root = await createFixture(`
require?.('qrcode')
module.require('@zxing/browser')
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /optional static require.*qrcode/iu)
  assert.match(`${result.stdout}${result.stderr}`, /module\.require.*@zxing\/browser/iu)
})

test('a simple alias of the CommonJS require function fails closed', async (t) => {
  const root = await createFixture("const load = require\nload('exceljs')\n")
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /require alias.*load/iu)
})

test('MTS and CTS production sources are parsed and audited', async (t) => {
  const mtsRoot = await createFixture(
    "import QRCode from 'qrcode'\nconst code: string = 'x'\nexport default QRCode\n",
    'entry.mts',
  )
  const ctsRoot = await createFixture(
    "import ZXing = require('@zxing/browser')\nexport = ZXing\n",
    'entry.cts',
  )
  t.after(() => Promise.all([
    rm(mtsRoot, { recursive: true, force: true }),
    rm(ctsRoot, { recursive: true, force: true }),
  ]))

  const mtsResult = runChecker(mtsRoot)
  const ctsResult = runChecker(ctsRoot)

  assert.notEqual(mtsResult.status, 0)
  assert.match(`${mtsResult.stdout}${mtsResult.stderr}`, /static import.*qrcode/iu)
  assert.notEqual(ctsResult.status, 0)
  assert.match(`${ctsResult.stdout}${ctsResult.stderr}`, /TypeScript import-equals.*@zxing\/browser/iu)
})

test('ordinary strings, functions, and object methods named require are not CommonJS imports', async (t) => {
  const root = await createFixture(`
const text = "require('exceljs')"
function require(value) { return value }
require('qrcode')
const loader = { require(value) { return value } }
loader.require('@zxing/browser')
export { text, loader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('nested object and class method var bindings never hide outer global require calls', async (t) => {
  const root = await createFixture(`
function fromObjectMethod() {
  const holder = { load() { var require } }
  require('exceljs')
  return holder
}
function fromClassMethod() {
  class Loader { load() { var require } }
  require('qrcode')
  return Loader
}
export { fromObjectMethod, fromClassMethod }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*exceljs/iu)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*qrcode/iu)
})

test('export-wrapped local require function and module constant shadow CommonJS globals', async (t) => {
  const root = await createFixture(`
export function require(value) { return value }
export const module = { require(value) { return value } }
require('exceljs')
module.require('qrcode')
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('export-default local require function shadows the CommonJS global', async (t) => {
  const root = await createFixture(`
export default function require(value) { return value }
require('@zxing/browser')
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('object and class method parameters shadow require and module only inside each method', async (t) => {
  const root = await createFixture(`
const objectLoader = {
  load(require) { return require('exceljs') },
}
class ClassLoader {
  load(module) { return module.require('qrcode') }
}
export { objectLoader, ClassLoader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('for-of, switch, and block lexical bindings shadow CommonJS names only in their scopes', async (t) => {
  const root = await createFixture(`
for (const require of [(value) => value]) {
  require('exceljs')
}
switch ('warehouse') {
  case 'warehouse':
    const module = { require(value) { return value } }
    module.require('qrcode')
    break
}
{
  const require = (value) => value
  require('@zxing/browser')
}
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('nested method shadows never weaken global require and module.require checks', async (t) => {
  const root = await createFixture(`
const objectLoader = { load(require) { return require('safe-local-package') } }
class ClassLoader { load(module) { return module.require('safe-local-package') } }
require('exceljs')
module.require('qrcode')
export { objectLoader, ClassLoader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*exceljs/iu)
  assert.match(`${result.stdout}${result.stderr}`, /module\.require.*qrcode/iu)
})

test('method parameters do not shadow global CommonJS calls in computed method keys', async (t) => {
  const root = await createFixture(`
const objectLoader = {
  [require('exceljs')](require) { return require('safe-local-package') },
}
class ClassLoader {
  [module.require('qrcode')](module) { return module.require('safe-local-package') }
}
export { objectLoader, ClassLoader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*exceljs/iu)
  assert.match(`${result.stdout}${result.stderr}`, /module\.require.*qrcode/iu)
})

test('body var bindings do not hide global heavy requires in function and method defaults', async (t) => {
  const root = await createFixture(`
function functionDefault(value = require('exceljs')) { var require; return value }
const objectLoader = {
  load(value = require('qrcode')) { var require; return value },
}
class ClassLoader {
  load(value = require('@zxing/browser')) { var require; return value }
}
export { functionDefault, objectLoader, ClassLoader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*exceljs/iu)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*qrcode/iu)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*@zxing\/browser/iu)
})

test('global require and module.require aliases in parameter defaults fail closed', async (t) => {
  const root = await createFixture(`
function loadWarehouse(load = require) { return load('exceljs') }
const loader = {
  load(loadModule = module.require) { return loadModule('qrcode') },
}
export { loadWarehouse, loader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /parameter require alias.*load/iu)
  assert.match(`${result.stdout}${result.stderr}`, /parameter module\.require alias.*loadModule/iu)
})

test('outer local CommonJS names and parameter TDZ shadows keep defaults local', async (t) => {
  const root = await createFixture(`
function outer(require, module) {
  function inner(value = require('exceljs'), other = module.require('qrcode')) {
    return [value, other]
  }
  return inner
}
function parameterTdz(require = require('@zxing/browser')) { return require }
export { outer, parameterTdz }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('static blocks retain nested var bindings without leaking them outside the class', async (t) => {
  const localRoot = await createFixture(`
class Loader {
  static {
    { var require = (value) => value }
    require('exceljs')
  }
}
export { Loader }
`)
  const globalRoot = await createFixture(`
class Loader { static { var require = (value) => value } }
require('qrcode')
export { Loader }
`)
  t.after(() => Promise.all([
    rm(localRoot, { recursive: true, force: true }),
    rm(globalRoot, { recursive: true, force: true }),
  ]))

  const localResult = runChecker(localRoot)
  const globalResult = runChecker(globalRoot)

  assert.equal(localResult.status, 0, `${localResult.stdout}${localResult.stderr}`)
  assert.notEqual(globalResult.status, 0)
  assert.match(`${globalResult.stdout}${globalResult.stderr}`, /static require.*qrcode/iu)
})

test('class declaration and expression names are local in their correct inner and outer scopes', async (t) => {
  const root = await createFixture(`
class require {
  method(value = require('exceljs')) { return value }
}
require('qrcode')
const Loader = class module {
  method(value = module.require('@zxing/browser')) { return value }
}
export { require, Loader }
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('TypeScript parameter properties bind locally and global aliases still fail closed', async (t) => {
  const localRoot = await createFixture(`
class Loader {
  constructor(public require: (value: string) => string) {
    require('exceljs')
  }
}
export { Loader }
`, 'entry.ts')
  const aliasRoot = await createFixture(`
class Loader {
  constructor(public load = require) {
    this.load('qrcode')
  }
}
export { Loader }
`, 'entry.ts')
  t.after(() => Promise.all([
    rm(localRoot, { recursive: true, force: true }),
    rm(aliasRoot, { recursive: true, force: true }),
  ]))

  const localResult = runChecker(localRoot)
  const aliasResult = runChecker(aliasRoot)

  assert.equal(localResult.status, 0, `${localResult.stdout}${localResult.stderr}`)
  assert.notEqual(aliasResult.status, 0)
  assert.match(`${aliasResult.stdout}${aliasResult.stderr}`, /parameter require alias.*load/iu)
})

test('TypeScript namespaces keep var bindings inside their own module scope', async (t) => {
  const localRoot = await createFixture(`
namespace LocalWarehouse {
  export var require = (value: string) => value
  require('exceljs')
}
export { LocalWarehouse }
`, 'entry.ts')
  const globalRoot = await createFixture(`
namespace LocalWarehouse {
  export var require = (value: string) => value
}
require('qrcode')
export { LocalWarehouse }
`, 'entry.ts')
  t.after(() => Promise.all([
    rm(localRoot, { recursive: true, force: true }),
    rm(globalRoot, { recursive: true, force: true }),
  ]))

  const localResult = runChecker(localRoot)
  const globalResult = runChecker(globalRoot)

  assert.equal(localResult.status, 0, `${localResult.stdout}${localResult.stderr}`)
  assert.notEqual(globalResult.status, 0)
  assert.match(`${globalResult.stdout}${globalResult.stderr}`, /static require.*qrcode/iu)
})

test('literal dynamic imports of all warehouse media dependencies pass the executable boundary', async (t) => {
  const root = await createFixture(`
export async function loadWarehouseMedia() {
  return Promise.all([
    import('@zxing/browser'),
    import('exceljs'),
    import('qrcode'),
  ])
}
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('fixture-only dynamic imports cannot satisfy real warehouse-owned QR callsites', async (t) => {
  const root = await createUnownedFixture(`
export async function fakeWarehouseMedia() {
  return Promise.all([import('@zxing/browser'), import('qrcode')])
}
`)
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /WarehouseQrScanner\.jsx.*@zxing\/browser/iu)
  assert.match(`${result.stdout}${result.stderr}`, /WarehouseLabelSheet\.jsx.*qrcode/iu)
})

test('literal dynamic imports in exact warehouse-owned scanner and label modules satisfy the QR boundary', async (t) => {
  const root = await createOwnedFixture({
    'WarehouseQrScanner.jsx': `export const loadScanner = () => import('@zxing/browser')\n`,
    'WarehouseLabelSheet.jsx': `export const loadLabelQr = () => import('qrcode')\n`,
  })
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('repository has executable literal dynamic QR callsites in the real owned modules', () => {
  const result = runChecker(REPOSITORY_ROOT)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

test('disconnected owned QR callsites fail catalog-root reachability', async (t) => {
  const scannerDisconnected = await createCatalogGraphFixture({ connectScanner: false })
  const labelDisconnected = await createCatalogGraphFixture({ connectLabel: false })
  t.after(() => Promise.all([
    rm(scannerDisconnected, { recursive: true, force: true }),
    rm(labelDisconnected, { recursive: true, force: true }),
  ]))

  const scannerResult = runChecker(scannerDisconnected)
  const labelResult = runChecker(labelDisconnected)

  assert.notEqual(scannerResult.status, 0)
  assert.match(`${scannerResult.stdout}${scannerResult.stderr}`, /WarehouseCatalog\.jsx.*WarehouseQrScanner\.jsx.*reachable/iu)
  assert.notEqual(labelResult.status, 0)
  assert.match(`${labelResult.stdout}${labelResult.stderr}`, /WarehouseCatalog\.jsx.*WarehouseLabelSheet\.jsx.*reachable/iu)
})

test('real scanner and label dynamic callsites are reachable from WarehouseCatalog import graph', () => {
  const result = runChecker(REPOSITORY_ROOT)

  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
})

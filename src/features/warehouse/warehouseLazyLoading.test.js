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

async function createFixture(source) {
  const root = await mkdtemp(path.join(tmpdir(), 'warehouse-lazy-contract-'))
  await mkdir(path.join(root, 'src'), { recursive: true })
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify({ dependencies: REQUIRED_DEPENDENCIES }, null, 2)}\n`,
  )
  await writeFile(path.join(root, 'src', 'entry.js'), source)
  return root
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

test('CommonJS require of warehouse media dependencies fails the executable boundary', async (t) => {
  const root = await createFixture("const ExcelJS = require('exceljs')\nexport default ExcelJS\n")
  t.after(() => rm(root, { recursive: true, force: true }))

  const result = runChecker(root)

  assert.notEqual(result.status, 0)
  assert.match(`${result.stdout}${result.stderr}`, /static require.*exceljs/iu)
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

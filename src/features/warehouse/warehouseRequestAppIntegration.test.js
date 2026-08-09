import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [app, page] = await Promise.all([
  readFile(new URL('../../App.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./WarehouseRequestPage.jsx', import.meta.url), 'utf8'),
])

test('second-version App lazy-loads detailed request pages inside the existing shell', () => {
  assert.match(app, /lazy\(\(\)\s*=>\s*import\(['"]\.\/features\/warehouse\/WarehouseRequestPage\.jsx['"]\)\)/u)
  assert.match(app, /authorizedView === 'stockOut' \|\| authorizedView === 'stockReturn'/u)
  assert.match(app, /!warehouseAccess\.requestStockFlow && !warehouseAccess\.confirmStockFlow/u)
  assert.match(app, /canRequest=\{warehouseAccess\.requestStockFlow\}/u)
  assert.match(app, /canConfirm=\{warehouseAccess\.confirmStockFlow\}/u)
  assert.match(app, /renderInDesktopShell\([\s\S]*<WarehouseRequestPage/u)
})

test('request page uses only authoritative warehouse services and no legacy browser persistence', () => {
  assert.doesNotMatch(page, /localStorage|sessionStorage|stockOutRecords|stockReturnRecords/u)
  assert.match(page, /warehouseService\.submitStockOut/u)
  assert.match(page, /warehouseService\.submitReturn/u)
  assert.match(page, /confirmationService\.confirmStockOut/u)
  assert.match(page, /confirmationService\.confirmReturn/u)
})

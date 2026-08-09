import assert from 'node:assert/strict'
import test from 'node:test'

import {
  forbiddenChangedPaths,
  forbiddenTokensInContent,
} from './verify-warehouse-forward-port.mjs'

test('forward-port verifier rejects deployment secrets, archived files, and legacy shared modules in the migration diff', () => {
  assert.deepEqual(forbiddenChangedPaths([
    'src/features/warehouse/WarehouseCatalog.jsx',
    '.env.warehouse-preview.example',
    '.env.production',
    '.vercel/project.json',
    'vercel.json',
    'src/services/sessionOperationFence.js',
    'notes/ERP第一版备份.txt',
  ]), [
    '.env.production',
    '.vercel/project.json',
    'vercel.json',
    'src/services/sessionOperationFence.js',
    'notes/ERP第一版备份.txt',
  ])
})

test('forward-port verifier detects old warehouse persistence and direct stock-in calls without false matching the secure service name', () => {
  assert.deepEqual(
    forbiddenTokensInContent('src/features/warehouse/Page.jsx', "import old from '../../services/baseRecordService.js'; window.localStorage.getItem('x')"),
    ['baseRecordService', 'localStorage'],
  )
  assert.deepEqual(
    forbiddenTokensInContent('src/App.jsx', 'purchaseService.commitStockIn(payload)'),
    ['commitStockIn', 'App commitStockIn call'],
  )
  assert.deepEqual(
    forbiddenTokensInContent('src/services/warehouseService.js', 'export function createWarehouseService() {}'),
    [],
  )
})

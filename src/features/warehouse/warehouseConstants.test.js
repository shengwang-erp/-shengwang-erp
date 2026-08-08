import assert from 'node:assert/strict'
import { parse } from '@babel/parser'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import * as warehouseConstants from './warehouseConstants.js'
import {
  MOVEMENT_TYPES,
  WAREHOUSE_PERMISSION_KEYS,
  WAREHOUSE_STATUS,
} from './warehouseConstants.js'

test('warehouse constants keep neutral workflow and movement values', () => {
  assert.deepEqual(WAREHOUSE_STATUS, {
    pending: '待仓库确认',
    confirmed: '已确认',
    rejected: '已驳回',
    void: '已冲销',
  })
  assert.equal(Object.isFrozen(WAREHOUSE_STATUS), true)

  assert.deepEqual(MOVEMENT_TYPES, {
    stockIn: '采购入库',
    stockOut: '项目出库',
    returnIn: '项目退回',
    transferOut: '调拨出库',
    transferIn: '调拨入库',
    gain: '盘盈',
    loss: '盘亏',
    damaged: '损坏',
    scrapped: '报废',
    stocktakeNoChange: '盘点无差异',
    reversal: '冲销',
  })
  assert.equal(Object.isFrozen(MOVEMENT_TYPES), true)
})

test('warehouse action keys are owned locally by the second version', () => {
  assert.deepEqual(WAREHOUSE_PERMISSION_KEYS, {
    catalogManage: 'warehouse.catalog.manage',
    receiptSubmit: 'warehouse.receipt.submit',
    receiptConfirm: 'warehouse.receipt.confirm',
    stockFlowRequest: 'warehouse.stock_flow.request',
    stockFlowConfirm: 'warehouse.stock_flow.confirm',
    transferManage: 'warehouse.transfer.manage',
    stocktakeConfirm: 'warehouse.stocktake.confirm',
    costView: 'warehouse.cost.view',
    reportExport: 'warehouse.report.export',
  })
  assert.equal(Object.isFrozen(WAREHOUSE_PERMISSION_KEYS), true)
})

test('phase-one pure warehouse imports stay inside the declared second-version boundary', () => {
  assert.deepEqual(Object.keys(warehouseConstants).sort(), [
    'MOVEMENT_TYPES',
    'WAREHOUSE_PERMISSION_KEYS',
    'WAREHOUSE_STATUS',
  ])

  const destinationRoot = fileURLToPath(new URL('../../../', import.meta.url))
  const allowedImports = new Map([
    ['warehouseConstants.js', []],
    ['warehouseDate.js', []],
    ['warehouseQr.js', []],
    ['warehouseCatalog.js', ['./warehouseQr.js']],
    ['warehouseDomain.js', ['./warehouseConstants.js', './warehouseDate.js']],
    ['warehousePage.js', [
      './warehouseCatalog.js',
      './warehouseConstants.js',
      './warehouseDomain.js',
    ]],
    ['warehouseAccounting.js', ['./warehouseConstants.js']],
  ])

  for (const [file, expectedImports] of allowedImports) {
    const source = readFileSync(resolve(destinationRoot, 'src/features/warehouse', file), 'utf8')
    const ast = parse(source, { sourceType: 'module' })
    const actualImports = []
    const visit = (node) => {
      if (!node || typeof node !== 'object') return
      if (
        (node.type === 'ImportDeclaration'
          || node.type === 'ExportAllDeclaration'
          || node.type === 'ExportNamedDeclaration')
        && node.source?.type === 'StringLiteral'
      ) {
        actualImports.push(node.source.value)
      } else if (
        node.type === 'CallExpression'
        && (node.callee?.type === 'Import' || node.callee?.name === 'require')
        && node.arguments?.[0]?.type === 'StringLiteral'
      ) {
        actualImports.push(node.arguments[0].value)
      } else if (node.type === 'ImportExpression' && node.source?.type === 'StringLiteral') {
        actualImports.push(node.source.value)
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit)
        else visit(value)
      }
    }
    visit(ast.program)
    actualImports.sort()
    assert.deepEqual(actualImports, [...expectedImports].sort(), file)
  }

  const result = spawnSync(process.execPath, [
    'scripts/validate-warehouse-forward-port-boundary.mjs',
    '--audit-destination',
    '--destination-stage',
    'phase-1-pure',
    '--manifest',
    'docs/warehouse-forward-port-manifest.json',
    '--destination-root',
    '.',
  ], {
    cwd: destinationRoot,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), 'Destination audit passed: 7 modules for stage phase-1-pure')
})

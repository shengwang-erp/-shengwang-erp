import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PERMISSION_CATALOG,
  WAREHOUSE_PERMISSION_CATALOG,
} from './permissionCatalog.js'
import { getWarehouseAccess } from './businessAccess.js'
import { WAREHOUSE_PERMISSION_KEYS } from '../features/warehouse/warehouseConstants.js'
import { hasEffectivePermissionKey } from '../utils/permissions.js'

const EXPECTED_WAREHOUSE_PERMISSION_KEYS = Object.freeze({
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

const EXPECTED_WAREHOUSE_PERMISSION_CATALOG = Object.freeze([
  Object.freeze({ key: 'warehouse.catalog.manage', label: '管理仓库物品与仓位' }),
  Object.freeze({ key: 'warehouse.receipt.submit', label: '提交采购到货' }),
  Object.freeze({ key: 'warehouse.receipt.confirm', label: '确认采购入库' }),
  Object.freeze({ key: 'warehouse.stock_flow.request', label: '发起出库与退回申请' }),
  Object.freeze({ key: 'warehouse.stock_flow.confirm', label: '确认出库与退回' }),
  Object.freeze({ key: 'warehouse.transfer.manage', label: '管理仓间调拨' }),
  Object.freeze({ key: 'warehouse.stocktake.confirm', label: '确认库存盘点' }),
  Object.freeze({ key: 'warehouse.cost.view', label: '查看仓库成本' }),
  Object.freeze({ key: 'warehouse.report.export', label: '导出仓库报表' }),
])

const NO_WAREHOUSE_ACCESS = Object.freeze({
  page: false,
  manageCatalog: false,
  submitReceipt: false,
  confirmReceipt: false,
  requestStockFlow: false,
  confirmStockFlow: false,
  transfer: false,
  stocktake: false,
  viewCost: false,
  exportReports: false,
})

function activeUser(effectivePermissionKeys = [], overrides = {}) {
  return {
    employeeId: 'E-WAREHOUSE-1',
    employeeNumber: 'SW-801',
    name: '仓库权限测试',
    department: '仓库管理部',
    position: '仓库管理员',
    employmentStatus: '在职',
    accountStatus: 'active',
    mustChangePassword: false,
    effectivePermissionKeys,
    ...overrides,
  }
}

test('warehouse catalog exposes the roadmap nine stable keys as frozen label records', () => {
  assert.deepEqual(WAREHOUSE_PERMISSION_KEYS, EXPECTED_WAREHOUSE_PERMISSION_KEYS)
  assert.deepEqual(WAREHOUSE_PERMISSION_CATALOG, EXPECTED_WAREHOUSE_PERMISSION_CATALOG)
  assert.deepEqual(
    PERMISSION_CATALOG.slice(-EXPECTED_WAREHOUSE_PERMISSION_CATALOG.length),
    EXPECTED_WAREHOUSE_PERMISSION_CATALOG.map(({ key }) => key),
  )
  assert.equal(new Set(PERMISSION_CATALOG).size, PERMISSION_CATALOG.length)
  assert.equal(Object.isFrozen(WAREHOUSE_PERMISSION_CATALOG), true)
  assert.ok(WAREHOUSE_PERMISSION_CATALOG.every(Object.isFrozen))
})

test('effective permission lookup honors exact grants, all and the existing SW-000 bypass', () => {
  const catalogOnly = activeUser([WAREHOUSE_PERMISSION_KEYS.catalogManage])
  assert.equal(
    hasEffectivePermissionKey(catalogOnly, WAREHOUSE_PERMISSION_KEYS.catalogManage),
    true,
  )
  assert.equal(
    hasEffectivePermissionKey(catalogOnly, WAREHOUSE_PERMISSION_KEYS.receiptConfirm),
    false,
  )
  assert.equal(
    hasEffectivePermissionKey(activeUser(['all']), WAREHOUSE_PERMISSION_KEYS.receiptConfirm),
    true,
  )
  assert.equal(
    hasEffectivePermissionKey(
      activeUser([], { employeeNumber: 'SW-000' }),
      WAREHOUSE_PERMISSION_KEYS.receiptConfirm,
    ),
    true,
  )
  assert.equal(hasEffectivePermissionKey(null, WAREHOUSE_PERMISSION_KEYS.catalogManage), false)
  assert.equal(hasEffectivePermissionKey(catalogOnly, ''), false)
})

test('warehouse page and action projections require independent exact grants', () => {
  const requester = getWarehouseAccess(activeUser([
    'module.inventory.view',
    WAREHOUSE_PERMISSION_KEYS.receiptSubmit,
    WAREHOUSE_PERMISSION_KEYS.stockFlowRequest,
  ]))
  assert.deepEqual(requester, {
    ...NO_WAREHOUSE_ACCESS,
    page: true,
    submitReceipt: true,
    requestStockFlow: true,
  })
  assert.equal(requester.confirmReceipt, false)
  assert.equal(requester.confirmStockFlow, false)

  const confirmer = getWarehouseAccess(activeUser([
    'module.inventory.view',
    WAREHOUSE_PERMISSION_KEYS.receiptConfirm,
    WAREHOUSE_PERMISSION_KEYS.stockFlowConfirm,
  ]))
  assert.equal(confirmer.submitReceipt, false)
  assert.equal(confirmer.confirmReceipt, true)
  assert.equal(confirmer.requestStockFlow, false)
  assert.equal(confirmer.confirmStockFlow, true)

  const actionWithoutPage = getWarehouseAccess(activeUser([
    WAREHOUSE_PERMISSION_KEYS.catalogManage,
  ]))
  assert.deepEqual(actionWithoutPage, NO_WAREHOUSE_ACCESS)
})

test('active SW-000 receives all warehouse actions without a new credential or grant path', () => {
  assert.deepEqual(
    getWarehouseAccess(activeUser([], { employeeNumber: 'SW-000' })),
    Object.fromEntries(Object.keys(NO_WAREHOUSE_ACCESS).map((key) => [key, true])),
  )
})

test('inactive, disabled and first-login users fail closed even with all or SW-000 identity', () => {
  const ineligibleUsers = [
    activeUser(['all'], { employmentStatus: '退职' }),
    activeUser(['all'], { accountStatus: 'disabled' }),
    activeUser(['all'], { mustChangePassword: true }),
    activeUser([], { employeeNumber: 'SW-000', employmentStatus: '退职' }),
    activeUser([], { employeeNumber: 'SW-000', accountStatus: 'disabled' }),
    activeUser([], { employeeNumber: 'SW-000', mustChangePassword: true }),
  ]

  for (const user of ineligibleUsers) {
    assert.deepEqual(getWarehouseAccess(user), NO_WAREHOUSE_ACCESS)
  }
})

test('warehouse projections fail closed for malformed users and are frozen', () => {
  let getterCalls = 0
  const accessor = activeUser(['all'])
  Object.defineProperty(accessor, 'accountStatus', {
    configurable: true,
    get() {
      getterCalls += 1
      return 'active'
    },
  })

  for (const user of [null, undefined, [], Object.create(activeUser(['all'])), accessor]) {
    const access = getWarehouseAccess(user)
    assert.deepEqual(access, NO_WAREHOUSE_ACCESS)
    assert.equal(Object.isFrozen(access), true)
  }
  assert.equal(getterCalls, 0)

  const granted = getWarehouseAccess(activeUser(['all']))
  assert.equal(Object.isFrozen(granted), true)
  assert.throws(() => {
    granted.page = false
  }, TypeError)
})

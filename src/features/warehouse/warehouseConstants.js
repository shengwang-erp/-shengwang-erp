export const WAREHOUSE_PERMISSION_KEYS = Object.freeze({
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

export const WAREHOUSE_STATUS = Object.freeze({
  pending: '待仓库确认',
  confirmed: '已确认',
  rejected: '已驳回',
  void: '已冲销',
})

export const MOVEMENT_TYPES = Object.freeze({
  stockIn: '采购入库',
  stockOut: '项目出库',
  returnIn: '项目退回',
  transferOut: '调拨出库',
  transferIn: '调拨入库',
  gain: '盘盈',
  loss: '盘亏',
  stocktakeNoChange: '盘点无差异',
  damaged: '损坏',
  scrapped: '报废',
  reversal: '冲销',
})

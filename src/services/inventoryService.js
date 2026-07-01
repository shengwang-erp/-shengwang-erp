import { create, getById, getList, softDelete, update } from './baseRecordService'

const inventoryKey = 'erp.inventoryItems'
const stockInKey = 'erp.stockInRecords'
const stockOutKey = 'erp.stockOutRecords'

export const inventoryService = {
  getList: () => getList(inventoryKey),
  getById: (id) => getById(inventoryKey, id),
  create: (record) => create(inventoryKey, record),
  update: (id, patch) => update(inventoryKey, id, patch),
  softDelete: (id) => softDelete(inventoryKey, id),
  getStockInList: () => getList(stockInKey),
  getStockOutList: () => getList(stockOutKey),
}

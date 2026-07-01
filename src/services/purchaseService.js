import { create, getById, getList, softDelete, update } from './baseRecordService'

const purchaseKey = 'erp.purchaseRecords'
const paymentKey = 'erp.purchasePaymentRecords'

export const purchaseService = {
  getList: () => getList(purchaseKey),
  getById: (id) => getById(purchaseKey, id),
  create: (record) => create(purchaseKey, record),
  update: (id, patch) => update(purchaseKey, id, patch),
  softDelete: (id) => softDelete(purchaseKey, id),
  getPaymentList: () => getList(paymentKey),
}

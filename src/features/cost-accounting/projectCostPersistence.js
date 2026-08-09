import { assertManualProjectCostMutable } from '../warehouse/warehouseAccounting.js'

export function createManualProjectCostPersistence({
  upsertRecord,
  softDelete,
  storageKey,
}) {
  if (typeof upsertRecord !== 'function' || typeof softDelete !== 'function' ||
      typeof storageKey !== 'string' || storageKey.length === 0) {
    throw new TypeError('manual project cost persistence configuration is invalid')
  }

  return Object.freeze({
    async save(record) {
      assertManualProjectCostMutable(record)
      return upsertRecord(storageKey, record)
    },
    async remove(record) {
      assertManualProjectCostMutable(record)
      const recordKey = record?.costRecordId
      if (typeof recordKey !== 'string' || recordKey.length === 0) {
        throw new TypeError('manual project cost record key is invalid')
      }
      return softDelete(storageKey, recordKey)
    },
  })
}

import { create, getById, getList, softDelete, update } from './baseRecordService'

const storageKey = 'erp.projects'

export const projectService = {
  getList: () => getList(storageKey),
  getById: (id) => getById(storageKey, id),
  create: (record) => create(storageKey, record),
  update: (id, patch) => update(storageKey, id, patch),
  softDelete: (id) => softDelete(storageKey, id),
}

import {
  MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES,
  buildWarehousePhotoObjectPath,
  compressWarehousePhoto,
  validateWarehousePhotoFile,
} from '../features/warehouse/warehouseMedia.js'

export const WAREHOUSE_PHOTO_BUCKET = 'warehouse-item-photos'
export const WAREHOUSE_PHOTO_SIGNED_URL_TTL_SECONDS = 300
export const MAX_WAREHOUSE_VARIANT_PHOTOS = 8

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(jpg|png|webp)$/u
const MIME_BY_EXTENSION = Object.freeze({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })
const RPC_RESULT_FIELDS = Object.freeze(['data', 'error', 'count', 'status', 'statusText'])
const RPC_RESULT_FIELD_SET = new Set([...RPC_RESULT_FIELDS, 'success'])
const STORAGE_RESULT_FIELDS = Object.freeze(['data', 'error'])
const PHOTO_FIELDS = Object.freeze([
  'id', 'variantId', 'objectPath', 'sortOrder', 'mimeType', 'byteSize', 'createdAt',
])
const DELETE_TICKET_FIELDS = Object.freeze([
  'deletionId', 'kind', 'photoId', 'variantId', 'objectPath', 'storageDeleted',
])
const DELETE_CANDIDATE_FIELDS = Object.freeze([
  'deletionId', 'kind', 'createdAt', 'originalRequesterLabel',
])
const SAFE_ERRORS = Object.freeze({
  WAREHOUSE_PHOTO_NOT_CONFIGURED: '云端图片服务未配置，请联系管理员',
  WAREHOUSE_PHOTO_INPUT_INVALID: '图片请求无效，请刷新后重试',
  WAREHOUSE_PHOTO_LIMIT_REACHED: '每个型号最多上传 8 张图片',
  WAREHOUSE_PHOTO_INVALID_RESPONSE: '图片服务返回了无效数据',
  WAREHOUSE_PHOTO_UPLOAD_FAILED: '图片上传失败，请重试',
  WAREHOUSE_PHOTO_SIGN_FAILED: '暂时无法打开图片',
  WAREHOUSE_PHOTO_DELETE_FAILED: '图片删除失败，请重试',
  WAREHOUSE_PHOTO_ORPHAN_CLEANUP_FAILED: '上传未完成且临时图片清理失败，请联系管理员',
  WAREHOUSE_PHOTO_SERVICE_UNAVAILABLE: '图片服务暂不可用，请稍后重试',
  AUTH_SESSION_INVALID: '登录状态无效，请重新登录',
  ACCESS_DENIED: '没有权限操作仓库图片',
})

export class WarehouseMediaServiceError extends Error {
  constructor(code) {
    const safeCode = Object.hasOwn(SAFE_ERRORS, code)
      ? code
      : 'WAREHOUSE_PHOTO_SERVICE_UNAVAILABLE'
    super(SAFE_ERRORS[safeCode])
    this.name = 'WarehouseMediaServiceError'
    this.code = safeCode
  }
}

const fail = (code) => new WarehouseMediaServiceError(code)

function plainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (Object.getPrototypeOf(value) !== Object.prototype) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.values(descriptors).some((descriptor) =>
    !('value' in descriptor) || descriptor.enumerable !== true)) return null
  return descriptors
}

function exactObject(value, fields) {
  const descriptors = plainObject(value)
  if (
    !descriptors ||
    Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
    Object.keys(descriptors).sort().join('\u0000') !== [...fields].sort().join('\u0000')
  ) {
    throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
}

function denseArrayDescriptors(value, maximumLength = Number.MAX_SAFE_INTEGER) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    !Number.isSafeInteger(value.length) ||
    value.length > maximumLength
  ) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.some((key) => typeof key !== 'string')) return null
  const expected = Array.from({ length: value.length }, (_, index) => String(index))
  expected.push('length')
  if (keys.sort().join('\u0000') !== expected.sort().join('\u0000')) return null
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[index]
    if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) return null
  }
  return descriptors
}

function uuid(value, input = false) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw fail(input ? 'WAREHOUSE_PHOTO_INPUT_INVALID' : 'WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  return value
}

function photoResponse(value, expectedVariantId) {
  const row = exactObject(value, PHOTO_FIELDS)
  const id = uuid(row.id)
  const variantId = uuid(row.variantId)
  const match = typeof row.objectPath === 'string' ? PATH.exec(row.objectPath) : null
  if (
    variantId !== expectedVariantId ||
    !match ||
    match[1] !== variantId ||
    MIME_BY_EXTENSION[match[3]] !== row.mimeType ||
    !Number.isSafeInteger(row.sortOrder) ||
    row.sortOrder < 0 ||
    row.sortOrder >= MAX_WAREHOUSE_VARIANT_PHOTOS ||
    !Number.isSafeInteger(row.byteSize) ||
    row.byteSize < 1 ||
    row.byteSize >= MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES ||
    typeof row.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(row.createdAt))
  ) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  return Object.freeze({
    id,
    variantId,
    objectPath: row.objectPath,
    sortOrder: row.sortOrder,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
  })
}

function photoList(value, expectedVariantId) {
  const descriptors = denseArrayDescriptors(value, MAX_WAREHOUSE_VARIANT_PHOTOS)
  if (!descriptors) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  const rows = Array.from(
    { length: value.length },
    (_, index) => photoResponse(descriptors[index].value, expectedVariantId),
  )
  if (rows.some((row, index) => row.sortOrder !== index)) {
    throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  return Object.freeze(rows)
}

function normalizeSupplierError(error, status) {
  if (error instanceof WarehouseMediaServiceError) return error
  const descriptors = plainObject(error)
  const code = typeof descriptors?.code?.value === 'string' ? descriptors.code.value : ''
  const hint = typeof descriptors?.hint?.value === 'string' ? descriptors.hint.value : ''
  if (status === 401 || code === 'PGRST301' || code === 'JWT_EXPIRED') {
    return fail('AUTH_SESSION_INVALID')
  }
  if (status === 403 || code === '42501') return fail('ACCESS_DENIED')
  if (code === '55000' && hint === 'WAREHOUSE_PHOTO_LIMIT_REACHED') {
    return fail('WAREHOUSE_PHOTO_LIMIT_REACHED')
  }
  return fail('WAREHOUSE_PHOTO_SERVICE_UNAVAILABLE')
}

function storageData(result) {
  let envelope
  try {
    envelope = exactObject(result, STORAGE_RESULT_FIELDS)
  } catch {
    return null
  }
  if (envelope.error !== null) return null
  return envelope.data
}

function storageField(result, field) {
  const data = storageData(result)
  const descriptors = plainObject(data)
  if (!descriptors || !descriptors[field] || typeof descriptors[field].value !== 'string') return null
  return descriptors[field].value
}

function exactRemovedPath(result, expectedPath) {
  const data = storageData(result)
  const descriptors = denseArrayDescriptors(data, 1)
  if (!descriptors || data.length !== 1) return false
  const row = plainObject(descriptors[0].value)
  return Boolean(row?.name && row.name.value === expectedPath)
}

function removalOutcome(result, expectedPath) {
  let envelope
  try {
    envelope = exactObject(result, STORAGE_RESULT_FIELDS)
  } catch {
    return 'ambiguous'
  }
  if (envelope.error !== null) {
    return plainObject(envelope.error) ? 'failed' : 'ambiguous'
  }
  return exactRemovedPath(result, expectedPath) ? 'removed' : 'ambiguous'
}

function deleteTicket(value, expectedVariantId, expectedPhotoId) {
  const ticket = exactObject(value, DELETE_TICKET_FIELDS)
  const deletionId = uuid(ticket.deletionId)
  const variantId = uuid(ticket.variantId)
  const photoId = ticket.photoId === null ? null : uuid(ticket.photoId)
  if (
    !['registered', 'orphan'].includes(ticket.kind) ||
    (ticket.kind === 'registered') !== (photoId !== null) ||
    (expectedVariantId !== undefined && variantId !== expectedVariantId) ||
    (expectedPhotoId !== undefined && photoId !== expectedPhotoId) ||
    typeof ticket.storageDeleted !== 'boolean'
  ) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  const pathMatch = typeof ticket.objectPath === 'string' ? PATH.exec(ticket.objectPath) : null
  if (!pathMatch || pathMatch[1] !== variantId) {
    throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  return Object.freeze({ ...ticket, deletionId, variantId, photoId })
}

function deleteCandidate(value) {
  const candidate = exactObject(value, DELETE_CANDIDATE_FIELDS)
  if (
    !['registered', 'orphan'].includes(candidate.kind) ||
    typeof candidate.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(candidate.createdAt)) ||
    typeof candidate.originalRequesterLabel !== 'string' ||
    candidate.originalRequesterLabel.length < 1 ||
    candidate.originalRequesterLabel.length > 100 ||
    candidate.originalRequesterLabel !== candidate.originalRequesterLabel.trim()
  ) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  return Object.freeze({ ...candidate, deletionId: uuid(candidate.deletionId) })
}

function deleteCandidateList(value) {
  const descriptors = denseArrayDescriptors(value)
  if (!descriptors) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  return Object.freeze(Array.from(
    { length: value.length },
    (_, index) => deleteCandidate(descriptors[index].value),
  ))
}

export function createWarehouseMediaService(client, options = {}) {
  const optionDescriptors = plainObject(options)
  const allowedOptions = new Set(['configured', 'randomUuid', 'compressPhoto'])
  if (!optionDescriptors || Object.keys(optionDescriptors).some((key) => !allowedOptions.has(key))) {
    throw fail('WAREHOUSE_PHOTO_NOT_CONFIGURED')
  }
  const configured = optionDescriptors.configured?.value ?? Boolean(client)
  const randomUuid = optionDescriptors.randomUuid?.value ?? (() => globalThis.crypto.randomUUID())
  const compressPhoto = optionDescriptors.compressPhoto?.value ?? compressWarehousePhoto
  if (
    typeof configured !== 'boolean' ||
    typeof randomUuid !== 'function' ||
    typeof compressPhoto !== 'function'
  ) throw fail('WAREHOUSE_PHOTO_NOT_CONFIGURED')

  const ensureClient = () => {
    if (
      !configured ||
      typeof client?.rpc !== 'function' ||
      typeof client?.storage?.from !== 'function'
    ) throw fail('WAREHOUSE_PHOTO_NOT_CONFIGURED')
  }
  const call = async (name, args) => {
    ensureClient()
    let result
    try {
      result = await client.rpc(name, args)
    } catch (error) {
      throw normalizeSupplierError(error)
    }
    const descriptors = plainObject(result)
    if (
      !descriptors ||
      Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string') ||
      RPC_RESULT_FIELDS.some((field) => !Object.hasOwn(descriptors, field)) ||
      Object.keys(descriptors).some((field) => !RPC_RESULT_FIELD_SET.has(field))
    ) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
    const envelope = Object.fromEntries(
      RPC_RESULT_FIELDS.map((field) => [field, descriptors[field].value]),
    )
    const success = Object.hasOwn(descriptors, 'success')
      ? descriptors.success.value
      : undefined
    if (
      (success !== undefined && typeof success !== 'boolean') ||
      !Number.isSafeInteger(envelope.status) ||
      typeof envelope.statusText !== 'string' ||
      (envelope.count !== null && !Number.isSafeInteger(envelope.count)) ||
      (envelope.error !== null && !plainObject(envelope.error))
    ) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
    if (envelope.error !== null) throw normalizeSupplierError(envelope.error, envelope.status)
    if (success === false) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
    return envelope.data
  }
  const bucket = () => {
    ensureClient()
    return client.storage.from(WAREHOUSE_PHOTO_BUCKET)
  }
  const listMetadata = async (variantId) => photoList(
    await call('list_warehouse_variant_photos_secure', { p_variant_id: uuid(variantId, true) }),
    variantId,
  )
  const cancelDelete = async (ticket) => call('cancel_warehouse_photo_delete_secure', {
    p_deletion_id: ticket.deletionId,
    p_variant_id: ticket.variantId,
    p_photo_id: ticket.photoId,
  })
  const finishDelete = async (ticket, storageFailureCode) => {
    if (!ticket.storageDeleted) {
      let removal
      try {
        removal = await bucket().remove([ticket.objectPath])
      } catch {
        throw fail(storageFailureCode)
      }
      const outcome = removalOutcome(removal, ticket.objectPath)
      if (outcome === 'failed') {
        try { await cancelDelete(ticket) } catch { /* pending stays recoverable */ }
        throw fail(storageFailureCode)
      }
      if (outcome !== 'removed') throw fail(storageFailureCode)
    }
    const finalized = await call('finalize_warehouse_photo_delete_secure', {
      p_deletion_id: ticket.deletionId,
      p_variant_id: ticket.variantId,
      p_photo_id: ticket.photoId,
    })
    if (finalized !== true) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
    return true
  }

  return Object.freeze({
    async listVariantPhotos(variantId) {
      const rows = await listMetadata(variantId)
      const result = []
      for (const row of rows) {
        let signed
        try {
          signed = await bucket().createSignedUrl(
            row.objectPath,
            WAREHOUSE_PHOTO_SIGNED_URL_TTL_SECONDS,
          )
        } catch {
          throw fail('WAREHOUSE_PHOTO_SIGN_FAILED')
        }
        const signedUrl = storageField(signed, 'signedUrl')
        if (!signedUrl) {
          throw fail('WAREHOUSE_PHOTO_SIGN_FAILED')
        }
        result.push(Object.freeze({ ...row, signedUrl }))
      }
      return Object.freeze(result)
    },
    async uploadVariantPhoto({ variantId, file } = {}) {
      uuid(variantId, true)
      validateWarehousePhotoFile(file)
      let compressed
      try {
        compressed = await compressPhoto(file)
      } catch (error) {
        if (error?.code) throw error
        throw fail('WAREHOUSE_PHOTO_UPLOAD_FAILED')
      }
      if (
        !(compressed instanceof Blob) ||
        !MIME_BY_EXTENSION[compressed.type === 'image/jpeg' ? 'jpg' : compressed.type.split('/')[1]] ||
        compressed.size < 1 ||
        compressed.size >= MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES
      ) throw fail('WAREHOUSE_PHOTO_UPLOAD_FAILED')
      const path = buildWarehousePhotoObjectPath({
        variantId,
        objectId: uuid(randomUuid(), true),
        mimeType: compressed.type,
      })
      let upload
      try {
        upload = await bucket().upload(path, compressed, {
          contentType: compressed.type,
          cacheControl: '3600',
          upsert: false,
        })
      } catch {
        throw fail('WAREHOUSE_PHOTO_UPLOAD_FAILED')
      }
      if (storageField(upload, 'path') !== path) {
        throw fail('WAREHOUSE_PHOTO_UPLOAD_FAILED')
      }
      try {
        return photoResponse(await call('register_warehouse_variant_photo_secure', {
          p_variant_id: variantId,
          p_object_path: path,
          p_mime_type: compressed.type,
          p_byte_size: compressed.size,
        }), variantId)
      } catch (registrationError) {
        try {
          const ticket = deleteTicket(
            await call('begin_warehouse_photo_orphan_delete_secure', {
              p_variant_id: variantId,
              p_object_path: path,
            }),
            variantId,
            null,
          )
          if (ticket.kind !== 'orphan') throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
          await finishDelete(ticket, 'WAREHOUSE_PHOTO_ORPHAN_CLEANUP_FAILED')
        } catch {
          throw fail('WAREHOUSE_PHOTO_ORPHAN_CLEANUP_FAILED')
        }
        throw registrationError
      }
    },
    async reorderVariantPhotos(variantId, photoIds) {
      uuid(variantId, true)
      if (
        !Array.isArray(photoIds) ||
        photoIds.length < 1 ||
        photoIds.length > MAX_WAREHOUSE_VARIANT_PHOTOS ||
        new Set(photoIds).size !== photoIds.length
      ) throw fail('WAREHOUSE_PHOTO_INPUT_INVALID')
      for (const id of photoIds) uuid(id, true)
      return photoList(await call('reorder_warehouse_variant_photos_secure', {
        p_variant_id: variantId,
        p_photo_ids: [...photoIds],
      }), variantId)
    },
    async deleteVariantPhoto(photo) {
      let row
      try {
        row = photoResponse(photo, photo?.variantId)
      } catch {
        throw fail('WAREHOUSE_PHOTO_INPUT_INVALID')
      }
      const ticket = deleteTicket(await call('begin_warehouse_variant_photo_delete_secure', {
        p_variant_id: row.variantId,
        p_photo_id: row.id,
      }), row.variantId, row.id)
      if (ticket.kind !== 'registered') throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
      return finishDelete(ticket, 'WAREHOUSE_PHOTO_DELETE_FAILED')
    },
    async listPendingPhotoDeletes() {
      return deleteCandidateList(
        await call('list_warehouse_photo_delete_candidates_secure'),
      )
    },
    async recoverPendingPhotoDelete(deletionId) {
      const ticket = deleteTicket(await call('claim_warehouse_photo_delete_secure', {
        p_deletion_id: uuid(deletionId, true),
      }))
      return finishDelete(
        ticket,
        ticket.kind === 'orphan'
          ? 'WAREHOUSE_PHOTO_ORPHAN_CLEANUP_FAILED'
          : 'WAREHOUSE_PHOTO_DELETE_FAILED',
      )
    },
  })
}

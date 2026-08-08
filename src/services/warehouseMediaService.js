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
const RESULT_FIELDS = new Set(['data', 'error', 'status', 'statusText', 'count'])
const PHOTO_FIELDS = Object.freeze([
  'id', 'variantId', 'objectPath', 'sortOrder', 'mimeType', 'byteSize', 'createdAt',
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
  if (!descriptors || Object.keys(descriptors).sort().join('\u0000') !== [...fields].sort().join('\u0000')) {
    throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]))
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
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  if (value.length > MAX_WAREHOUSE_VARIANT_PHOTOS) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  const rows = value.map((entry) => photoResponse(entry, expectedVariantId))
  if (rows.some((row, index) => row.sortOrder !== index)) {
    throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
  }
  return Object.freeze(rows)
}

function normalizeSupplierError(error, status) {
  if (error instanceof WarehouseMediaServiceError) return error
  if (status === 401 || error?.code === 'PGRST301' || error?.code === 'JWT_EXPIRED') {
    return fail('AUTH_SESSION_INVALID')
  }
  if (status === 403 || error?.code === '42501') return fail('ACCESS_DENIED')
  if (error?.code === '55000' && error?.hint === 'WAREHOUSE_PHOTO_LIMIT_REACHED') {
    return fail('WAREHOUSE_PHOTO_LIMIT_REACHED')
  }
  return fail('WAREHOUSE_PHOTO_SERVICE_UNAVAILABLE')
}

function validStorageResult(result, field) {
  const descriptors = plainObject(result)
  if (!descriptors) return false
  const error = descriptors.error?.value
  if (error) return false
  return field ? Boolean(descriptors.data?.value?.[field]) : descriptors.data?.value !== null
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
      !descriptors.data ||
      Object.keys(descriptors).some((key) => !RESULT_FIELDS.has(key))
    ) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
    const error = descriptors.error?.value
    const status = descriptors.status?.value
    if (error) throw normalizeSupplierError(error, status)
    return descriptors.data.value
  }
  const bucket = () => {
    ensureClient()
    return client.storage.from(WAREHOUSE_PHOTO_BUCKET)
  }
  const listMetadata = async (variantId) => photoList(
    await call('list_warehouse_variant_photos_secure', { p_variant_id: uuid(variantId, true) }),
    variantId,
  )

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
        if (!validStorageResult(signed, 'signedUrl') || typeof signed.data.signedUrl !== 'string') {
          throw fail('WAREHOUSE_PHOTO_SIGN_FAILED')
        }
        result.push(Object.freeze({ ...row, signedUrl: signed.data.signedUrl }))
      }
      return Object.freeze(result)
    },
    async uploadVariantPhoto({ variantId, file } = {}) {
      uuid(variantId, true)
      validateWarehousePhotoFile(file)
      const existing = await listMetadata(variantId)
      if (existing.length >= MAX_WAREHOUSE_VARIANT_PHOTOS) {
        throw fail('WAREHOUSE_PHOTO_LIMIT_REACHED')
      }
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
      if (!validStorageResult(upload, 'path') || upload.data.path !== path) {
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
        let cleanup
        try {
          cleanup = await bucket().remove([path])
        } catch {
          throw fail('WAREHOUSE_PHOTO_ORPHAN_CLEANUP_FAILED')
        }
        if (!validStorageResult(cleanup)) {
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
      let removal
      try {
        removal = await bucket().remove([row.objectPath])
      } catch {
        throw fail('WAREHOUSE_PHOTO_DELETE_FAILED')
      }
      if (!validStorageResult(removal)) throw fail('WAREHOUSE_PHOTO_DELETE_FAILED')
      const deleted = await call('delete_warehouse_variant_photo_secure', {
        p_variant_id: row.variantId,
        p_photo_id: row.id,
        p_object_path: row.objectPath,
      })
      if (deleted !== true) throw fail('WAREHOUSE_PHOTO_INVALID_RESPONSE')
      return true
    },
  })
}

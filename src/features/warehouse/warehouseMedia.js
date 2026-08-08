export const MAX_WAREHOUSE_PHOTO_BYTES = 12 * 1024 * 1024
export const MAX_WAREHOUSE_PHOTO_EDGE = 2000
export const MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES = 2 * 1024 * 1024

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
})
const EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
})

export class WarehouseMediaError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WarehouseMediaError'
    this.code = code
  }
}

const fail = (code, message) => new WarehouseMediaError(code, message)

export function validateWarehousePhotoFile(file) {
  const name = typeof file?.name === 'string' ? file.name.trim() : ''
  const separator = name.lastIndexOf('.')
  const suppliedExtension = separator > 0 && separator < name.length - 1
    ? name.slice(separator + 1).toLowerCase()
    : ''
  const mimeType = typeof file?.type === 'string' ? file.type.toLowerCase() : ''
  const expectedMimeType = MIME_BY_EXTENSION[suppliedExtension]
  if (!expectedMimeType || expectedMimeType !== mimeType || !EXTENSION_BY_MIME[mimeType]) {
    throw fail(
      'WAREHOUSE_PHOTO_TYPE_INVALID',
      '只允许扩展名与类型一致的 JPEG、PNG 或 WebP 图片',
    )
  }
  if (
    !Number.isSafeInteger(file?.size) ||
    file.size < 1 ||
    file.size > MAX_WAREHOUSE_PHOTO_BYTES
  ) {
    throw fail('WAREHOUSE_PHOTO_SIZE_INVALID', '图片大小必须在 1 字节至 12 MiB 之间')
  }
  return Object.freeze({
    mimeType,
    byteSize: file.size,
    extension: EXTENSION_BY_MIME[mimeType],
  })
}

export function buildWarehousePhotoObjectPath({ variantId, objectId, mimeType }) {
  if (
    typeof variantId !== 'string' ||
    typeof objectId !== 'string' ||
    !UUID.test(variantId) ||
    !UUID.test(objectId) ||
    !EXTENSION_BY_MIME[mimeType]
  ) {
    throw fail('WAREHOUSE_PHOTO_PATH_INVALID', '图片对象路径无效')
  }
  return `${variantId}/${objectId}.${EXTENSION_BY_MIME[mimeType]}`
}

async function decodeWithBrowser(file) {
  if (typeof globalThis.createImageBitmap !== 'function') {
    throw fail('WAREHOUSE_PHOTO_COMPRESSION_FAILED', '当前浏览器无法处理图片')
  }
  const source = await globalThis.createImageBitmap(file)
  return { source, width: source.width, height: source.height }
}

async function renderWithBrowser({ source, width, height, mimeType, quality }) {
  let canvas
  if (typeof globalThis.OffscreenCanvas === 'function') {
    canvas = new globalThis.OffscreenCanvas(width, height)
  } else if (globalThis.document?.createElement) {
    canvas = globalThis.document.createElement('canvas')
    canvas.width = width
    canvas.height = height
  } else {
    throw fail('WAREHOUSE_PHOTO_COMPRESSION_FAILED', '当前浏览器无法处理图片')
  }
  const context = canvas.getContext?.('2d')
  if (!context) throw fail('WAREHOUSE_PHOTO_COMPRESSION_FAILED', '当前浏览器无法处理图片')
  context.drawImage(source, 0, 0, width, height)
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: mimeType, quality })
  }
  if (typeof canvas.toBlob !== 'function') {
    throw fail('WAREHOUSE_PHOTO_COMPRESSION_FAILED', '当前浏览器无法处理图片')
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(
        fail('WAREHOUSE_PHOTO_COMPRESSION_FAILED', '图片压缩失败'),
      ),
      mimeType,
      quality,
    )
  })
}

export async function compressWarehousePhoto(file, adapter = {}) {
  const metadata = validateWarehousePhotoFile(file)
  const decode = typeof adapter?.decode === 'function' ? adapter.decode : decodeWithBrowser
  const render = typeof adapter?.render === 'function' ? adapter.render : renderWithBrowser
  let decoded
  try {
    decoded = await decode(file)
    if (
      !decoded ||
      !Number.isFinite(decoded.width) ||
      !Number.isFinite(decoded.height) ||
      decoded.width < 1 ||
      decoded.height < 1
    ) throw new Error('invalid dimensions')
    const initialScale = Math.min(
      1,
      MAX_WAREHOUSE_PHOTO_EDGE / Math.max(decoded.width, decoded.height),
    )
    let width = Math.max(1, Math.round(decoded.width * initialScale))
    let height = Math.max(1, Math.round(decoded.height * initialScale))
    let quality = 0.86
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const blob = await render({
        source: decoded.source,
        width,
        height,
        mimeType: metadata.mimeType,
        quality,
      })
      if (
        blob instanceof Blob &&
        blob.type === metadata.mimeType &&
        blob.size > 0 &&
        blob.size < MAX_WAREHOUSE_PHOTO_OUTPUT_BYTES
      ) return blob
      if (metadata.mimeType !== 'image/png' && quality > 0.56) {
        quality = Math.max(0.56, quality - 0.15)
      } else if (width > 1 || height > 1) {
        width = Math.max(1, Math.floor(width * 0.8))
        height = Math.max(1, Math.floor(height * 0.8))
      } else {
        break
      }
    }
  } catch (error) {
    if (error instanceof WarehouseMediaError) throw error
  } finally {
    decoded?.source?.close?.()
  }
  throw fail('WAREHOUSE_PHOTO_COMPRESSION_FAILED', '图片无法压缩到 2 MiB 以下')
}

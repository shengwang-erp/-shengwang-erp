import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function pngDimensions(filePath) {
  const bytes = fs.readFileSync(filePath)
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

test('declares the supplied ERP icon for iOS and web installs', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  for (const href of [
    '/apple-touch-icon.png',
    '/apple-touch-icon-167x167.png',
    '/apple-touch-icon-152x152.png',
    '/favicon-32x32.png',
  ]) {
    assert.match(html, new RegExp(`href=["']${href.replaceAll('/', '\\/')}["']`))
  }
  assert.match(html, /rel=["']manifest["']/)

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/manifest.webmanifest'), 'utf8'))
  assert.equal(manifest.name, '生旺 ERP 数据中心')
  assert.equal(manifest.short_name, '生旺ERP')
  assert.equal(manifest.display, 'browser')
  assert.deepEqual(manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })), [
    { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
    { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
  ])

  for (const [file, size] of [
    ['apple-touch-icon.png', 180],
    ['apple-touch-icon-167x167.png', 167],
    ['apple-touch-icon-152x152.png', 152],
    ['favicon-32x32.png', 32],
    ['pwa-192x192.png', 192],
    ['pwa-512x512.png', 512],
  ]) {
    assert.deepEqual(pngDimensions(path.join(root, 'public', file)), { width: size, height: size })
  }
})

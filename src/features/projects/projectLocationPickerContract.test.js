import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const source = await readFile(new URL('./ProjectLocationPicker.jsx', import.meta.url), 'utf8').catch(() => '')

test('picker is manual, short-lived, attributed, adjustable, and stale-safe', () => {
  assert.match(source, /import L from ['"]leaflet['"]/)
  assert.match(source, /import ['"]leaflet\/dist\/leaflet\.css['"]/)
  assert.match(source, /L\.map\(containerRef\.current\)/)
  assert.match(source, /https:\/\/cyberjapandata\.gsi\.go\.jp\/xyz\/std\/\{z\}\/\{x\}\/\{y\}\.png/)
  assert.match(source, /地址定位/)
  assert.match(source, /https:\/\/maps\.gsi\.go\.jp\/help\/howtouse\.html/)
  assert.match(source, /https:\/\/www\.openstreetmap\.org\/copyright/)
  assert.match(source, /OpenStreetMap contributors/)

  assert.match(source, /map\.on\(['"]click['"]/)
  assert.match(source, /marker\.on\(['"]dragend['"]/)
  assert.match(source, /draggable:\s*true/)
  assert.match(source, /L\.circle\(/)
  assert.match(source, /marker\.setLatLng\(/)
  assert.match(source, /circle\.setLatLng\(/)
  assert.match(source, /circle\.setRadius\(/)
  assert.match(source, /map\.off\(['"]click['"]/)
  assert.match(source, /marker\.off\(['"]dragend['"]/)
  assert.match(source, /map\.remove\(\)/)
  assert.match(source, /typeof value !== ['"]number['"] && typeof value !== ['"]string['"]/)
  assert.match(source, /typeof value === ['"]string['"] && !value\.trim\(\)/)

  assert.doesNotMatch(source, /navigator\.geolocation|getCurrentPosition|watchPosition/)
  assert.doesNotMatch(source, /<input[^>]*type=['"]number['"]/)
  assert.doesNotMatch(source, /onRadiusChange\s*\(/)

  const confirmationCalls = [...source.matchAll(/onLocationConfirmed\s*\(\s*\{([\s\S]*?)\}\s*\)/g)]
  assert.equal(confirmationCalls.length, 1)
  const confirmationKeys = [...confirmationCalls[0][1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:/gm)]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(confirmationKeys, ['confirmedAt', 'latitude', 'longitude'])
  assert.match(confirmationCalls[0][1], /new Date\(\)\.toISOString\(\)/)

  assert.match(source, /地址未找到，请补充都道府县、市区町村和番地/)
  assert.match(source, /地址定位失败，请稍后重试/)
  assert.match(source, /GeocodingError/)
  assert.match(source, /role=['"]alert['"]/)
  assert.match(source, /role=['"]status['"]/)
  assert.match(source, /施工位置已确认/)
  assert.match(source, /地址已变更，请重新定位/)
  assert.match(source, /aria-label=['"]项目施工位置地图['"]/)
  assert.doesNotMatch(source, /set(?:Error|LocateError)\s*\(\s*(?:error|cause)\.message/)

  assert.match(source, /locateAddress\(address,\s*\{\s*signal:/)
  assert.match(source, /new AbortController\(\)/)
  assert.match(source, /\.abort\(\)/)
  assert.match(source, /requestIdRef\.current/)
  assert.match(source, /requestId\s*!==\s*requestIdRef\.current/)
  assert.match(source, /latestLocateInputRef\.current/)
  assert.match(source, /isLocateInputCurrent\(requestInput\)/)
  assert.match(source, /mountedRef\.current/)
  assert.match(source, /AbortError/)
})

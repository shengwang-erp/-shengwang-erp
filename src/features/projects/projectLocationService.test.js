import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeAddress } from './projectDomain.js'
import {
  GeocodingError,
  createGsiAddressGeocoder,
  createJapanAddressGeocoder,
  createNominatimGeocoder,
  createProjectLocationService,
  normalizeGeocodingAddress,
  projectLocationService,
} from './projectLocationService.js'

const UNAVAILABLE_MESSAGE = '地址服务暂不可用，请稍后重试'
const INVALID_RESPONSE_MESSAGE = '地址服务返回了无效位置'

function responseWithJson(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => body,
  }
}

async function assertGeocodingError(action, code, message) {
  await assert.rejects(action, (error) => {
    assert.equal(error instanceof GeocodingError, true)
    assert.equal(error.name, 'GeocodingError')
    assert.equal(error.code, code)
    assert.equal(error.message, message)
    return true
  })
}

test('reuses project address normalization', () => {
  assert.strictEqual(normalizeGeocodingAddress, normalizeAddress)
  assert.equal(normalizeGeocodingAddress('  東京都\t千代田区　１－１  '), '東京都 千代田区 1-1')
})

test('GSI request preserves the normalized Japanese address and reads longitude-latitude geometry order', async () => {
  const calls = []
  const signal = new AbortController().signal
  const geocoder = createGsiAddressGeocoder({
    endpoint: 'https://gsi.example/address-search?stale=value',
    fetchImpl: async (...args) => {
      calls.push(args)
      return responseWithJson([{
        geometry: {
          coordinates: [139.803818, 35.686592],
          type: 'Point',
        },
        type: 'Feature',
        properties: {
          addressCode: '',
          title: '東京都江東区森下四丁目１７番５号',
        },
      }])
    },
  })

  assert.deepEqual(await geocoder.geocode('　東京都江東区森下４－１７－５ ', { signal }), {
    latitude: 35.686592,
    longitude: 139.803818,
    displayName: '東京都江東区森下四丁目１７番５号',
  })
  assert.equal(calls.length, 1)
  const [requestUrl, requestOptions] = calls[0]
  assert.equal(
    requestUrl.toString(),
    'https://gsi.example/address-search?q=%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%B1%9F%E6%9D%B1%E5%8C%BA%E6%A3%AE%E4%B8%8B4-17-5',
  )
  assert.deepEqual(requestOptions, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
})

test('Japan address geocoder keeps GSI first and uses Nominatim only when GSI has no match', async () => {
  const calls = []
  const fallbackResult = {
    latitude: 35.6824664,
    longitude: 139.765473,
    displayName: '東京駅(改札外), 千代田区, 東京都, 日本',
  }
  const geocoder = createJapanAddressGeocoder({
    primary: {
      geocode: async (address, options) => {
        calls.push(['gsi', address, options])
        return null
      },
    },
    fallback: {
      geocode: async (address, options) => {
        calls.push(['nominatim', address, options])
        return fallbackResult
      },
    },
  })
  const signal = new AbortController().signal

  assert.strictEqual(await geocoder.geocode('東京駅', { signal }), fallbackResult)
  assert.deepEqual(calls, [
    ['gsi', '東京駅', { signal }],
    ['nominatim', '東京駅', { signal }],
  ])
})

test('Japan address geocoder uses the fallback when GSI is temporarily unavailable', async () => {
  const fallbackResult = {
    latitude: 35.68,
    longitude: 139.76,
    displayName: '备用结果',
  }
  let fallbackCalls = 0
  const geocoder = createJapanAddressGeocoder({
    primary: {
      geocode: async () => { throw new GeocodingError('GEOCODING_UNAVAILABLE', UNAVAILABLE_MESSAGE) },
    },
    fallback: {
      geocode: async () => {
        fallbackCalls += 1
        return fallbackResult
      },
    },
  })

  assert.strictEqual(await geocoder.geocode('東京都江東区森下'), fallbackResult)
  assert.equal(fallbackCalls, 1)
})

test('an aborted GSI lookup never starts the fallback provider', async () => {
  const controller = new AbortController()
  let fallbackCalls = 0
  const geocoder = createJapanAddressGeocoder({
    primary: {
      geocode: async () => {
        controller.abort()
        throw new DOMException('aborted', 'AbortError')
      },
    },
    fallback: {
      geocode: async () => {
        fallbackCalls += 1
        return null
      },
    },
  })

  await assert.rejects(
    () => geocoder.geocode('東京都江東区森下', { signal: controller.signal }),
    (error) => error?.name === 'AbortError',
  )
  assert.equal(fallbackCalls, 0)
})

test('Nominatim request uses exact normalized URL values, GET headers, and signal', async () => {
  const calls = []
  const signal = new AbortController().signal
  const geocoder = createNominatimGeocoder({
    endpoint: 'https://geocoder.example/search?stale=value',
    fetchImpl: async (...args) => {
      calls.push(args)
      return responseWithJson([{
        lat: '35.681236',
        lon: '139.767125',
        display_name: '東京駅',
      }])
    },
  })

  assert.deepEqual(await geocoder.geocode('　東京都\t千代田区　１－１ ', { signal }), {
    latitude: 35.681236,
    longitude: 139.767125,
    displayName: '東京駅',
  })
  assert.equal(calls.length, 1)
  const [requestUrl, requestOptions] = calls[0]
  assert.equal(
    requestUrl.toString(),
    'https://geocoder.example/search?q=%E6%9D%B1%E4%BA%AC%E9%83%BD+%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA+1-1&format=jsonv2&limit=1&countrycodes=jp',
  )
  assert.deepEqual([...requestUrl.searchParams], [
    ['q', '東京都 千代田区 1-1'],
    ['format', 'jsonv2'],
    ['limit', '1'],
    ['countrycodes', 'jp'],
  ])
  assert.deepEqual(requestOptions, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal,
  })
})

test('Nominatim falls back to the normalized address for a missing display name', async () => {
  const geocoder = createNominatimGeocoder({
    fetchImpl: async () => responseWithJson([{
      lat: '35.68',
      lon: '139.76',
      display_name: '',
    }]),
  })

  assert.deepEqual(await geocoder.geocode('　東京都　千代田区 '), {
    latitude: 35.68,
    longitude: 139.76,
    displayName: '東京都 千代田区',
  })
})

test('HTTP 429 becomes a safe GEOCODING_UNAVAILABLE error', async () => {
  const geocoder = createNominatimGeocoder({
    fetchImpl: async () => responseWithJson({ provider: 'rate limited' }, {
      ok: false,
      status: 429,
    }),
  })

  await assertGeocodingError(
    () => geocoder.geocode('東京都'),
    'GEOCODING_UNAVAILABLE',
    UNAVAILABLE_MESSAGE,
  )
})

test('fetch failures become safe GEOCODING_UNAVAILABLE errors', async () => {
  const geocoder = createNominatimGeocoder({
    fetchImpl: async () => {
      throw new Error('provider-secret-network-error')
    },
  })

  await assertGeocodingError(
    () => geocoder.geocode('東京都'),
    'GEOCODING_UNAVAILABLE',
    UNAVAILABLE_MESSAGE,
  )
})

test('an empty provider result returns null and is cached', async () => {
  let providerCalls = 0
  const adapter = createNominatimGeocoder({
    fetchImpl: async () => {
      providerCalls += 1
      return responseWithJson([])
    },
  })
  const service = createProjectLocationService({ adapter })

  assert.equal(await service.locateAddress(' 東京都　千代田区 '), null)
  assert.equal(await service.locateAddress('東京都 千代田区'), null)
  assert.equal(providerCalls, 1)
})

test('malformed payloads and coordinates become safe GEOCODING_RESPONSE_INVALID errors', async (t) => {
  const cases = [
    ['non-array payload', { unexpected: true }],
    ['missing row', [null]],
    ['missing latitude', [{ lon: '139.76' }]],
    ['blank latitude', [{ lat: ' ', lon: '139.76' }]],
    ['non-finite latitude', [{ lat: 'NaN', lon: '139.76' }]],
    ['out-of-range latitude', [{ lat: '90.1', lon: '139.76' }]],
    ['missing longitude', [{ lat: '35.68' }]],
    ['out-of-range longitude', [{ lat: '35.68', lon: '-180.1' }]],
  ]

  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const geocoder = createNominatimGeocoder({
        fetchImpl: async () => responseWithJson(body),
      })
      await assertGeocodingError(
        () => geocoder.geocode('東京都'),
        'GEOCODING_RESPONSE_INVALID',
        INVALID_RESPONSE_MESSAGE,
      )
    })
  }

  await t.test('JSON parsing failure does not leak the provider error', async () => {
    const geocoder = createNominatimGeocoder({
      fetchImpl: async () => ({
        ok: true,
        json: async () => {
          throw new Error('provider-secret-json-error')
        },
      }),
    })
    await assertGeocodingError(
      () => geocoder.geocode('東京都'),
      'GEOCODING_RESPONSE_INVALID',
      INVALID_RESPONSE_MESSAGE,
    )
  })
})

test('normalized duplicate sequential calls use one cached provider result', async () => {
  const calls = []
  const providerResult = {
    latitude: 35.68,
    longitude: 139.76,
    displayName: '東京都',
  }
  const service = createProjectLocationService({
    adapter: {
      geocode: async (address) => {
        calls.push(address)
        return providerResult
      },
    },
  })

  const first = await service.locateAddress(' 東京都　千代田区 ')
  const second = await service.locateAddress('東京都\t千代田区')
  assert.strictEqual(first, providerResult)
  assert.strictEqual(second, providerResult)
  assert.deepEqual(calls, ['東京都 千代田区'])
})

test('simultaneous normalized duplicates share the exact in-flight Promise and provider call', async () => {
  const calls = []
  const service = createProjectLocationService({
    adapter: {
      geocode: async (address, options) => {
        calls.push([address, options])
        return { latitude: 35.68, longitude: 139.76, displayName: address }
      },
    },
  })
  const signal = new AbortController().signal

  const first = service.locateAddress(' 東京都　千代田区 ', { signal })
  const second = service.locateAddress('東京都 千代田区')
  assert.strictEqual(first, second)
  assert.deepEqual(await Promise.all([first, second]), [
    { latitude: 35.68, longitude: 139.76, displayName: '東京都 千代田区' },
    { latitude: 35.68, longitude: 139.76, displayName: '東京都 千代田区' },
  ])
  assert.deepEqual(calls, [['東京都 千代田区', { signal }]])
})

test('distinct concurrent uncached addresses start at least the default 1000ms apart', async () => {
  let clock = 0
  const starts = []
  const waits = []
  const service = createProjectLocationService({
    adapter: {
      geocode: async (address) => {
        starts.push([address, clock])
        return { latitude: 35.68, longitude: 139.76, displayName: address }
      },
    },
    now: () => clock,
    wait: async (milliseconds) => {
      waits.push(milliseconds)
      clock += milliseconds
    },
  })

  await Promise.all([
    service.locateAddress('東京都 港区'),
    service.locateAddress('東京都 江東区'),
  ])
  assert.deepEqual(starts, [
    ['東京都 港区', 0],
    ['東京都 江東区', 1000],
  ])
  assert.deepEqual(waits, [1000])
})

test('failed in-flight entries are removed so a retry reaches the adapter', async () => {
  let providerCalls = 0
  const failure = new Error('temporary failure')
  const service = createProjectLocationService({
    adapter: {
      geocode: async () => {
        providerCalls += 1
        if (providerCalls === 1) throw failure
        return { latitude: 35.68, longitude: 139.76, displayName: '東京都' }
      },
    },
    minimumIntervalMs: 0,
  })

  await assert.rejects(() => service.locateAddress('東京都'), (error) => error === failure)
  assert.deepEqual(await service.locateAddress('東京都'), {
    latitude: 35.68,
    longitude: 139.76,
    displayName: '東京都',
  })
  assert.equal(providerCalls, 2)
})

test('the provider queue continues after a failure', async () => {
  let clock = 0
  const starts = []
  const failure = new Error('first request failed')
  const service = createProjectLocationService({
    adapter: {
      geocode: async (address) => {
        starts.push([address, clock])
        if (address === '失敗住所') throw failure
        return { latitude: 35.68, longitude: 139.76, displayName: address }
      },
    },
    now: () => clock,
    wait: async (milliseconds) => {
      clock += milliseconds
    },
  })

  const [failed, succeeded] = await Promise.allSettled([
    service.locateAddress('失敗住所'),
    service.locateAddress('東京都'),
  ])
  assert.equal(failed.status, 'rejected')
  assert.strictEqual(failed.reason, failure)
  assert.deepEqual(succeeded, {
    status: 'fulfilled',
    value: { latitude: 35.68, longitude: 139.76, displayName: '東京都' },
  })
  assert.deepEqual(starts, [
    ['失敗住所', 0],
    ['東京都', 1000],
  ])
})

test('empty normalized addresses reject with ADDRESS_REQUIRED without a provider call', async () => {
  let providerCalls = 0
  const service = createProjectLocationService({
    adapter: {
      geocode: async () => {
        providerCalls += 1
        return null
      },
    },
  })

  for (const address of ['', ' \t　', null, undefined]) {
    await assertGeocodingError(
      () => service.locateAddress(address),
      'ADDRESS_REQUIRED',
      '请先填写项目地址',
    )
  }
  assert.equal(providerCalls, 0)
})

test('exports a singleton project location service', () => {
  assert.equal(typeof projectLocationService.locateAddress, 'function')
  assert.equal(Object.isFrozen(projectLocationService), true)
})

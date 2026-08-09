import { normalizeAddress } from './projectDomain.js'

const GEOCODING_UNAVAILABLE_MESSAGE = '地址服务暂不可用，请稍后重试'
const GEOCODING_RESPONSE_INVALID_MESSAGE = '地址服务返回了无效位置'

export class GeocodingError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GeocodingError'
    this.code = code
  }
}

export const normalizeGeocodingAddress = normalizeAddress

function unavailableError() {
  return new GeocodingError(
    'GEOCODING_UNAVAILABLE',
    GEOCODING_UNAVAILABLE_MESSAGE,
  )
}

function invalidResponseError() {
  return new GeocodingError(
    'GEOCODING_RESPONSE_INVALID',
    GEOCODING_RESPONSE_INVALID_MESSAGE,
  )
}

function parseProviderCoordinate(value, minimum, maximum) {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : null
}

export function createGsiAddressGeocoder({
  fetchImpl = globalThis.fetch,
  endpoint = 'https://msearch.gsi.go.jp/address-search/AddressSearch',
} = {}) {
  return {
    async geocode(address, { signal } = {}) {
      const normalizedAddress = normalizeGeocodingAddress(address)
      const url = new URL(endpoint)
      url.search = new URLSearchParams({ q: normalizedAddress }).toString()

      let response
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        })
      } catch (error) {
        if (signal?.aborted || error?.name === 'AbortError') throw error
        throw unavailableError()
      }
      if (!response?.ok) throw unavailableError()

      let rows
      try {
        rows = await response.json()
      } catch {
        throw invalidResponseError()
      }
      if (!Array.isArray(rows)) throw invalidResponseError()
      if (rows.length === 0) return null

      const row = rows[0]
      const coordinates = row?.geometry?.coordinates
      if (!row || typeof row !== 'object' || !Array.isArray(coordinates)) {
        throw invalidResponseError()
      }
      const longitude = parseProviderCoordinate(coordinates[0], -180, 180)
      const latitude = parseProviderCoordinate(coordinates[1], -90, 90)
      if (latitude === null || longitude === null) throw invalidResponseError()

      const title = row?.properties?.title
      return {
        latitude,
        longitude,
        displayName:
          typeof title === 'string' && title.trim()
            ? title.trim()
            : normalizedAddress,
      }
    },
  }
}

export function createNominatimGeocoder({
  fetchImpl = globalThis.fetch,
  endpoint = 'https://nominatim.openstreetmap.org/search',
} = {}) {
  return {
    async geocode(address, { signal } = {}) {
      const normalizedAddress = normalizeGeocodingAddress(address)
      const url = new URL(endpoint)
      url.search = new URLSearchParams({
        q: normalizedAddress,
        format: 'jsonv2',
        limit: '1',
        countrycodes: 'jp',
      }).toString()

      let response
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal,
        })
      } catch {
        throw unavailableError()
      }
      if (!response?.ok) throw unavailableError()

      let rows
      try {
        rows = await response.json()
      } catch {
        throw invalidResponseError()
      }
      if (!Array.isArray(rows)) throw invalidResponseError()
      if (rows.length === 0) return null

      const row = rows[0]
      if (!row || typeof row !== 'object') throw invalidResponseError()
      const latitude = parseProviderCoordinate(row.lat, -90, 90)
      const longitude = parseProviderCoordinate(row.lon, -180, 180)
      if (latitude === null || longitude === null) throw invalidResponseError()

      return {
        latitude,
        longitude,
        displayName:
          typeof row.display_name === 'string' && row.display_name.trim()
            ? row.display_name
            : normalizedAddress,
      }
    },
  }
}

export function createJapanAddressGeocoder({
  primary = createGsiAddressGeocoder(),
  fallback = createNominatimGeocoder(),
} = {}) {
  return {
    async geocode(address, options = {}) {
      try {
        const result = await primary.geocode(address, options)
        if (result !== null) return result
      } catch (error) {
        if (options.signal?.aborted || error?.name === 'AbortError') throw error
      }
      return fallback.geocode(address, options)
    },
  }
}

export function createProjectLocationService({
  adapter = createJapanAddressGeocoder(),
  cache = new Map(),
  now = () => Date.now(),
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  minimumIntervalMs = 1000,
} = {}) {
  let lastRequestStartedAt = Number.NEGATIVE_INFINITY
  let providerQueue = Promise.resolve()
  const inFlight = new Map()

  function locateAddress(address, { signal } = {}) {
    const key = normalizeGeocodingAddress(address)
    if (!key) {
      return Promise.reject(new GeocodingError(
        'ADDRESS_REQUIRED',
        '请先填写项目地址',
      ))
    }
    if (cache.has(key)) return Promise.resolve(cache.get(key))
    if (inFlight.has(key)) return inFlight.get(key)

    const request = providerQueue.then(async () => {
      const remaining = minimumIntervalMs - (now() - lastRequestStartedAt)
      if (remaining > 0) await wait(remaining)
      lastRequestStartedAt = now()
      const result = await adapter.geocode(key, { signal })
      cache.set(key, result)
      return result
    })

    providerQueue = request.then(
      () => undefined,
      () => undefined,
    )
    inFlight.set(key, request)
    request.then(
      () => inFlight.delete(key),
      () => inFlight.delete(key),
    )
    return request
  }

  return Object.freeze({ locateAddress })
}

export const projectLocationService = createProjectLocationService()

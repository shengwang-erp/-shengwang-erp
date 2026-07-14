// deno-lint-ignore-file no-process-global -- This deployment helper runs with Node.js.
import { pathToFileURL } from 'node:url'

const DEFAULT_TIMEOUT_MS = 15_000

function parseSecretCollection(value) {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
        ? Object.values(parsed)
        : []
      return values.filter((item) => typeof item === 'string' && item.trim()).map((item) =>
        item.trim()
      )
    } catch {
      return []
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
}

function selectServerKey(env) {
  return env.SUPABASE_SECRET_KEY?.trim() ||
    parseSecretCollection(env.SUPABASE_SECRET_KEYS)[0] ||
    env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ''
}

function endpointUrl(value) {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    const localHttp = url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
    if (url.protocol !== 'https:' && !localHttp) return null
    if (url.username || url.password || url.search || url.hash) return null
    return `${url.origin}/functions/v1/employee-bootstrap-admin`
  } catch {
    return null
  }
}

function validSuccessPayload(body) {
  return Boolean(
    body &&
      !Array.isArray(body) &&
      typeof body === 'object' &&
      Object.keys(body).length === 3 &&
      body.ok === true &&
      body.employeeNumber === 'SW-000' &&
      typeof body.created === 'boolean',
  )
}

export async function runBootstrap({
  env = process.env,
  fetchImpl = globalThis.fetch,
  writeOut = (message) => console.log(message),
  writeErr = (message) => console.error(message),
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = endpointUrl(env.SUPABASE_URL)
  const serverKey = selectServerKey(env)
  if (!url || !serverKey || typeof fetchImpl !== 'function') {
    writeErr('SW-000 bootstrap configuration is missing.')
    return 1
  }

  let response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        apikey: serverKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    writeErr('SW-000 bootstrap request failed.')
    return 1
  }

  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? response.status : 0
    writeErr(`SW-000 bootstrap failed (HTTP ${status}).`)
    return 1
  }

  let body
  try {
    body = await response.json()
  } catch {
    writeErr('SW-000 bootstrap returned an invalid response.')
    return 1
  }
  if (!validSuccessPayload(body)) {
    writeErr('SW-000 bootstrap returned an invalid response.')
    return 1
  }

  writeOut(`SW-000 bootstrap completed (${body.created ? 'created' : 'already exists'}).`)
  return 0
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  process.exitCode = await runBootstrap()
}

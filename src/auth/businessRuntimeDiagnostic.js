const BUILD_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/u
const SAFE_COMPONENT_FRAME_PATTERN = /^\s*at\s+([A-Za-z_$][A-Za-z0-9_$]{0,63})(?=[\s(]|$)/u
const MAX_COMPONENT_NAMES = 12
const ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
])
const PLATFORMS = new Set(['iOS', 'Other'])
const BROWSERS = new Set(['Safari Web App', 'Chrome iOS', 'Firefox iOS', 'Web Browser'])
const BUILT_DIAGNOSTICS = new WeakSet()

function ownDataValue(object, key, fallback) {
  if ((typeof object !== 'object' || object === null) && typeof object !== 'function') {
    return fallback
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : fallback
  } catch {
    return fallback
  }
}

function bounded(value, limit, fallback = '') {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit)
    : fallback
}

function safeBuildId(value) {
  const candidate = bounded(value, 64)
  if (!BUILD_ID_PATTERN.test(candidate)) return 'unversioned'
  return candidate.slice(0, 12)
}

function safeOccurredAt(value) {
  if (typeof value !== 'string') return 'unknown'
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : 'unknown'
}

function safeErrorName(error) {
  let current = error
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    const name = ownDataValue(current, 'name', '')
    if (typeof name === 'string' && ERROR_NAMES.has(name)) return name
    if ((typeof current !== 'object' || current === null) && typeof current !== 'function') break
    try {
      current = Object.getPrototypeOf(current)
    } catch {
      break
    }
  }
  return 'Error'
}

function fingerprintMessage(value) {
  const message = typeof value === 'string' ? value : ''
  let hash = 0x811c9dc5
  for (let index = 0; index < message.length; index += 1) {
    hash ^= message.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `fingerprint:${hash.toString(16).padStart(8, '0')}`
}

function safeComponentStack(value) {
  if (typeof value !== 'string') return 'Unavailable'
  const names = []
  for (const line of value.split(/\r?\n/u)) {
    const match = SAFE_COMPONENT_FRAME_PATTERN.exec(line)
    if (match) names.push(match[1])
    if (names.length === MAX_COMPONENT_NAMES) break
  }
  return names.length > 0 ? names.join('\n') : 'Unavailable'
}

function safePlatform(value) {
  return typeof value === 'string' && PLATFORMS.has(value) ? value : 'Other'
}

function safeBrowser(value) {
  return typeof value === 'string' && BROWSERS.has(value) ? value : 'Web Browser'
}

export function buildBusinessRuntimeDiagnostic(input = {}) {
  const error = ownDataValue(input, 'error', null)
  const runtimeInput = ownDataValue(input, 'runtime', null)
  const buildId = safeBuildId(ownDataValue(input, 'buildId', ''))
  const runtime = Object.freeze({
    platform: safePlatform(ownDataValue(runtimeInput, 'platform', '')),
    browser: safeBrowser(ownDataValue(runtimeInput, 'browser', '')),
  })
  const diagnostic = Object.freeze({
    category: 'UI_RUNTIME_ERROR',
    code: `UI_RUNTIME_ERROR-${buildId}`,
    buildId,
    occurredAt: safeOccurredAt(ownDataValue(input, 'occurredAt', '')),
    errorName: safeErrorName(error),
    message: fingerprintMessage(ownDataValue(error, 'message', '')),
    componentStack: safeComponentStack(ownDataValue(input, 'componentStack', '')),
    runtime,
  })
  BUILT_DIAGNOSTICS.add(diagnostic)
  return diagnostic
}

export function formatBusinessRuntimeDiagnostic(diagnostic) {
  if (BUILT_DIAGNOSTICS.has(diagnostic)) return JSON.stringify(diagnostic, null, 2)
  const runtime = ownDataValue(diagnostic, 'runtime', null)
  const projected = buildBusinessRuntimeDiagnostic({
    error: {
      name: ownDataValue(diagnostic, 'errorName', ''),
      message: ownDataValue(diagnostic, 'message', ''),
    },
    componentStack: ownDataValue(diagnostic, 'componentStack', ''),
    buildId: ownDataValue(diagnostic, 'buildId', ''),
    occurredAt: ownDataValue(diagnostic, 'occurredAt', ''),
    runtime: {
      platform: ownDataValue(runtime, 'platform', ''),
      browser: ownDataValue(runtime, 'browser', ''),
    },
  })
  return JSON.stringify(projected, null, 2)
}

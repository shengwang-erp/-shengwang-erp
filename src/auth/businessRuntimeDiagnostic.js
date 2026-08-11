const MESSAGE_LIMIT = 320
const STACK_LIMIT = 2400
const BUILD_ID_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/u

function bounded(value, limit, fallback = '') {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, limit)
    : fallback
}

function redact(value) {
  return value
    .replace(/\bSW-\d{3,}\b/giu, '[REDACTED_EMPLOYEE]')
    .replace(/\bBearer\s+[^\s]+/giu, 'Bearer [REDACTED_TOKEN]')
    .replace(/\b[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[REDACTED_TOKEN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_EMAIL]')
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

export function buildBusinessRuntimeDiagnostic(input = {}) {
  const buildId = safeBuildId(input.buildId)
  const errorName = bounded(redact(bounded(input.error?.name, 80, 'Error')), 80, 'Error')
  const message = bounded(redact(bounded(input.error?.message, MESSAGE_LIMIT, 'Unknown render failure')), MESSAGE_LIMIT, 'Unknown render failure')
  const componentStack = bounded(redact(bounded(input.componentStack, STACK_LIMIT, 'Unavailable')), STACK_LIMIT, 'Unavailable')
  const platform = bounded(input.runtime?.platform, 40, 'Unknown')
  const browser = bounded(input.runtime?.browser, 40, 'Unknown')
  return Object.freeze({
    category: 'UI_RUNTIME_ERROR',
    code: `UI_RUNTIME_ERROR-${buildId}`,
    buildId,
    occurredAt: safeOccurredAt(input.occurredAt),
    errorName,
    message,
    componentStack,
    runtime: Object.freeze({ platform, browser }),
  })
}

export function formatBusinessRuntimeDiagnostic(diagnostic) {
  return JSON.stringify(diagnostic, null, 2)
}

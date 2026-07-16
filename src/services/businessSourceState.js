const FATAL_CODES = new Set([
  'AUTH_SESSION_INVALID', 'CONFIGURATION_ERROR', 'AUTH_SERVICE_UNAVAILABLE',
])

export function classifyBusinessSourceError(error = {}) {
  const code = typeof error?.code === 'string' && error.code
    ? error.code
    : 'DATA_OPERATION_FAILED'
  if (code === 'ACCESS_DENIED') {
    return { status: 'forbidden', fatal: false, code, message: '无权读取该数据' }
  }
  return {
    status: 'error', fatal: FATAL_CODES.has(code), code,
    message: error?.message || '业务数据读取失败',
  }
}

export function toBusinessSourceState(cloudState = {}, {
  readAllowed = true, data = null, stale = false, updatedAt = null,
} = {}) {
  if (!readAllowed) {
    return {
      status: 'forbidden', data: null, code: 'ACCESS_DENIED', message: '无权读取该数据',
      source: 'blocked', stale: false, updatedAt, fatal: false,
    }
  }
  if (cloudState.loading) {
    return {
      status: 'loading', data: null, code: '', message: '',
      source: cloudState.source || '', stale: false, updatedAt, fatal: false,
    }
  }
  if (cloudState.error || cloudState.code) {
    const classified = classifyBusinessSourceError({
      code: cloudState.code || 'DATA_OPERATION_FAILED', message: cloudState.error,
    })
    return { ...classified, data: null, source: cloudState.source || 'blocked', stale: false, updatedAt }
  }
  return {
    status: 'ready', data, code: '', message: '', fatal: false,
    source: cloudState.source || 'supabase', stale: Boolean(stale), updatedAt,
  }
}

export function resolveRequiredSources(states = {}, requiredKeys = []) {
  const validStatuses = new Set(['loading', 'ready', 'error', 'forbidden'])
  const statusOf = (key) => {
    const value = states[key]?.status
    if (value === undefined) return 'loading'
    return validStatuses.has(value) ? value : 'error'
  }
  const blockingSources = requiredKeys.filter((key) => statusOf(key) !== 'ready')
  const staleSources = requiredKeys.filter((key) =>
    statusOf(key) === 'ready' && states[key]?.stale === true)
  const priority = ['forbidden', 'error', 'loading']
  const status = priority.find((candidate) =>
    blockingSources.some((key) => statusOf(key) === candidate)) || 'ready'
  return { status, blockingSources, staleSources }
}

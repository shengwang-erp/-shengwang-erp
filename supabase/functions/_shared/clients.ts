import { EdgeSecurityError } from './responses.ts'

type CreateClientFactory = (
  url: string,
  key: string,
  options: Record<string, unknown>,
) => unknown

type ClientDependencies = {
  getEnv?: (name: string) => string | undefined
  createClient?: CreateClientFactory
  fetchImpl?: typeof fetch
  authRequestTimeoutMs?: number
  requestSignal?: AbortSignal
  setTimeoutImpl?: (callback: () => void, milliseconds: number) => number
  clearTimeoutImpl?: (timer: number) => void
}
const DEFAULT_AUTH_REQUEST_TIMEOUT_MS = 30_000

function runtimeEnvironment(name: string) {
  const runtime = globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } }
    process?: { env?: Record<string, string | undefined> }
  }
  return runtime.Deno?.env?.get?.(name) ?? runtime.process?.env?.[name]
}

function configurationError() {
  return new EdgeSecurityError('CONFIGURATION_ERROR', '认证服务未配置', 500)
}

function requiredConfiguration(
  getEnv: (name: string) => string | undefined,
  name: string,
) {
  const value = getEnv(name)
  if (!value?.trim()) throw configurationError()
  return value.trim()
}

function configurationCollection(value: string | undefined) {
  if (!value?.trim()) return []
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
  }
  try {
    const parsed = JSON.parse(trimmed)
    const values = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object'
      ? Object.values(parsed)
      : []
    return values
      .filter((item): item is string =>
        typeof item === 'string' && Boolean(item.trim())
      )
      .map((item) => item.trim())
  } catch {
    throw configurationError()
  }
}

function firstConfiguredKey(
  getEnv: (name: string) => string | undefined,
  names: string[],
) {
  for (const name of names) {
    const values = configurationCollection(getEnv(name))
    if (values.length > 0) return values[0]
  }
  throw configurationError()
}

async function loadCreateClient(factory?: CreateClientFactory) {
  if (factory) return factory

  try {
    // Keep the Edge dependency version-pinned while Node tests inject a local factory.
    // deno-lint-ignore no-import-prefix
    const module = await import('npm:@supabase/supabase-js@2')
    return module.createClient as CreateClientFactory
  } catch {
    throw new EdgeSecurityError(
      'AUTH_SERVICE_UNAVAILABLE',
      '认证服务暂不可用',
      503,
    )
  }
}

const statelessAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
}

function boundedAdminFetch(dependencies: ClientDependencies) {
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
  const timeoutMs = dependencies.authRequestTimeoutMs ??
    DEFAULT_AUTH_REQUEST_TIMEOUT_MS
  const setTimeoutImpl = dependencies.setTimeoutImpl ?? globalThis.setTimeout
  const clearTimeoutImpl = dependencies.clearTimeoutImpl ??
    globalThis.clearTimeout
  if (
    typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw configurationError()
  }

  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const controller = new AbortController()
    const sourceSignals = [dependencies.requestSignal, init.signal].filter(
      (signal): signal is AbortSignal => Boolean(signal),
    )
    const listeners: Array<{ signal: AbortSignal; abort: () => void }> = []
    for (const signal of sourceSignals) {
      const abort = () => controller.abort(signal.reason)
      if (signal.aborted) abort()
      else {
        signal.addEventListener('abort', abort, { once: true })
        listeners.push({ signal, abort })
      }
    }
    const timer = setTimeoutImpl(() => {
      controller.abort(
        new DOMException('Auth request timed out', 'TimeoutError'),
      )
    }, timeoutMs)
    try {
      return await fetchImpl(input, { ...init, signal: controller.signal })
    } finally {
      clearTimeoutImpl(timer)
      for (const listener of listeners) {
        listener.signal.removeEventListener('abort', listener.abort)
      }
    }
  }
}

export async function createAdminClient(dependencies: ClientDependencies = {}) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const url = requiredConfiguration(getEnv, 'SUPABASE_URL')
  const serviceRoleKey = firstConfiguredKey(getEnv, [
    'SUPABASE_SECRET_KEY',
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])
  const createClient = await loadCreateClient(dependencies.createClient)

  try {
    return createClient(url, serviceRoleKey, {
      auth: statelessAuthOptions,
      global: { fetch: boundedAdminFetch(dependencies) },
    })
  } catch {
    throw new EdgeSecurityError(
      'AUTH_SERVICE_UNAVAILABLE',
      '认证服务暂不可用',
      503,
    )
  }
}

export async function createUserClient(
  accessToken: string,
  dependencies: ClientDependencies = {},
) {
  if (typeof accessToken !== 'string' || !/^[^\s,]+$/u.test(accessToken)) {
    throw new EdgeSecurityError('AUTH_TOKEN_INVALID', '登录凭证无效', 401)
  }

  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const url = requiredConfiguration(getEnv, 'SUPABASE_URL')
  const publicKey = firstConfiguredKey(getEnv, [
    'SUPABASE_PUBLISHABLE_KEY',
    'SUPABASE_PUBLISHABLE_KEYS',
    'SUPABASE_ANON_KEY',
  ])
  const createClient = await loadCreateClient(dependencies.createClient)

  try {
    return createClient(url, publicKey, {
      auth: statelessAuthOptions,
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    })
  } catch {
    throw new EdgeSecurityError(
      'AUTH_SERVICE_UNAVAILABLE',
      '认证服务暂不可用',
      503,
    )
  }
}

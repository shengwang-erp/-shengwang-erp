import { EdgeSecurityError } from './responses.ts'

type CreateClientFactory = (
  url: string,
  key: string,
  options: Record<string, unknown>,
) => unknown

type ClientDependencies = {
  getEnv?: (name: string) => string | undefined
  createClient?: CreateClientFactory
}

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

async function loadCreateClient(factory?: CreateClientFactory) {
  if (factory) return factory

  try {
    // Keep the Edge dependency version-pinned while Node tests inject a local factory.
    // deno-lint-ignore no-import-prefix
    const module = await import('npm:@supabase/supabase-js@2')
    return module.createClient as CreateClientFactory
  } catch {
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }
}

const statelessAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
}

export async function createAdminClient(dependencies: ClientDependencies = {}) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const url = requiredConfiguration(getEnv, 'SUPABASE_URL')
  const serviceRoleKey = requiredConfiguration(getEnv, 'SUPABASE_SERVICE_ROLE_KEY')
  const createClient = await loadCreateClient(dependencies.createClient)

  try {
    return createClient(url, serviceRoleKey, { auth: statelessAuthOptions })
  } catch {
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
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
  const publicKey = getEnv('SUPABASE_PUBLISHABLE_KEY')?.trim() ||
    getEnv('SUPABASE_ANON_KEY')?.trim()
  if (!publicKey) throw configurationError()
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
    throw new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
  }
}

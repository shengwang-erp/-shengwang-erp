import { EdgeSecurityError, safeErrorResponse } from './responses.ts'

type CorsDependencies = {
  getEnv?: (name: string) => string | undefined
}

type EdgeHandler = (request: Request) => Response | Promise<Response>

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

function readAllowedOrigins(getEnv: (name: string) => string | undefined) {
  const configured = getEnv('CORS_ALLOWED_ORIGINS')
  if (!configured?.trim()) throw configurationError()

  const origins = configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  if (origins.length === 0 || origins.includes('*')) throw configurationError()

  for (const origin of origins) {
    try {
      const parsed = new URL(origin)
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        throw configurationError()
      }
    } catch (error) {
      if (error instanceof EdgeSecurityError) throw error
      throw configurationError()
    }
  }

  return new Set(origins)
}

function corsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

function attachCorsHeaders(response: Response, origin: string) {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export async function withCors(
  request: Request,
  handler: EdgeHandler,
  dependencies: CorsDependencies = {},
) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  let allowedOrigins: Set<string>

  try {
    allowedOrigins = readAllowedOrigins(getEnv)
  } catch (error) {
    return safeErrorResponse(error)
  }

  const origin = request.headers.get('origin')
  if (origin && !allowedOrigins.has(origin)) {
    return safeErrorResponse(
      new EdgeSecurityError('CORS_ORIGIN_DENIED', '请求来源不被允许', 403),
    )
  }

  if (request.method === 'OPTIONS') {
    if (!origin) {
      return safeErrorResponse(
        new EdgeSecurityError('CORS_ORIGIN_DENIED', '请求来源不被允许', 403),
      )
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  try {
    const response = await handler(request)
    return origin ? attachCorsHeaders(response, origin) : response
  } catch (error) {
    const response = safeErrorResponse(error)
    return origin ? attachCorsHeaders(response, origin) : response
  }
}

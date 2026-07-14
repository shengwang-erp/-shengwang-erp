import { isEmployeeNumber, normalizeEmployeeNumber } from '../../../src/auth/employeeAuthDomain.js'
import { createAdminClient as createDefaultAdminClient } from '../_shared/clients.ts'
import { deriveAuthEmail as deriveDefaultAuthEmail } from '../_shared/employee-auth.ts'
import { EdgeSecurityError, jsonResponse, safeErrorResponse } from '../_shared/responses.ts'

const MAX_REQUEST_BYTES = 4096
const MAX_EMPLOYEE_NUMBER_LENGTH = 32
const MAX_PASSWORD_LENGTH = 256
const SOURCE_VALUE_LIMIT = 128

export const TRUSTED_SOURCE_HEADER_PRIORITY = Object.freeze([
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
])

function runtimeEnvironment(name) {
  return globalThis.Deno?.env?.get?.(name) ?? globalThis.process?.env?.[name]
}

function configurationError() {
  return new EdgeSecurityError('CONFIGURATION_ERROR', '认证服务未配置', 500)
}

function authServiceError() {
  return new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
}

function loginFailedError() {
  return new EdgeSecurityError('LOGIN_FAILED', '员工编号或密码错误', 401)
}

function loginLockedError() {
  return new EdgeSecurityError('LOGIN_LOCKED', '登录尝试过多，请稍后再试', 429)
}

function accountUnavailableError() {
  return new EdgeSecurityError('ACCOUNT_UNAVAILABLE', '当前账号不可登录', 403)
}

function sourceIdentityError() {
  return new EdgeSecurityError('SOURCE_IDENTITY_INVALID', '请求来源无效', 400)
}

function identityMismatchError() {
  return new EdgeSecurityError('AUTH_IDENTITY_MISMATCH', '认证关联无效', 403)
}

function base64Url(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return globalThis
    .btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '')
}

function normalizePort(value) {
  if (!/^\d{1,5}$/u.test(value)) throw sourceIdentityError()
  const port = Number(value)
  if (port < 1 || port > 65535) throw sourceIdentityError()
}

function normalizeIpv4(value) {
  let address = value
  const portSeparator = value.lastIndexOf(':')
  if (portSeparator !== -1) {
    if (value.indexOf(':') !== portSeparator) throw sourceIdentityError()
    normalizePort(value.slice(portSeparator + 1))
    address = value.slice(0, portSeparator)
  }
  const parts = address.split('.')
  if (
    parts.length !== 4 ||
    parts.some((part) => !/^\d{1,3}$/u.test(part) || Number(part) > 255)
  ) {
    throw sourceIdentityError()
  }
  return parts.map((part) => String(Number(part))).join('.')
}

function normalizeIpv6(value) {
  let address = value
  if (value.startsWith('[')) {
    const match = value.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/u)
    if (!match) throw sourceIdentityError()
    address = match[1]
    if (match[2]) normalizePort(match[2])
  }
  if (!address.includes(':') || !/^[0-9a-f:.]+$/iu.test(address)) {
    throw sourceIdentityError()
  }
  try {
    const hostname = new URL(`http://[${address}]/`).hostname
    if (!hostname.startsWith('[') || !hostname.endsWith(']')) throw sourceIdentityError()
    return hostname.slice(1, -1).toLowerCase()
  } catch (error) {
    if (error instanceof EdgeSecurityError) throw error
    throw sourceIdentityError()
  }
}

function normalizeProxyIp(value) {
  const normalized = value.trim().toLowerCase()
  if (
    !normalized ||
    normalized.length > SOURCE_VALUE_LIMIT ||
    [...normalized].some((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127)
    })
  ) {
    throw sourceIdentityError()
  }
  return normalized.includes('.') && normalized.split(':').length <= 2
    ? normalizeIpv4(normalized)
    : normalizeIpv6(normalized)
}

function trustedSourceValue(request) {
  for (const headerName of TRUSTED_SOURCE_HEADER_PRIORITY) {
    const header = request.headers.get(headerName)
    if (!header) continue
    if (header.length > SOURCE_VALUE_LIMIT) throw sourceIdentityError()
    const firstValue = headerName === 'x-forwarded-for' ? header.split(',')[0] : header
    return normalizeProxyIp(firstValue)
  }
  throw sourceIdentityError()
}

export async function deriveSourceFingerprint(request, dependencies = {}) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const secret = getEnv('LOGIN_RATE_LIMIT_SECRET')
  if (!secret?.trim()) throw configurationError()
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto
  if (!cryptoImpl?.subtle) throw authServiceError()

  try {
    const encoder = new TextEncoder()
    const key = await cryptoImpl.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const digest = await cryptoImpl.subtle.sign(
      'HMAC',
      key,
      encoder.encode(trustedSourceValue(request)),
    )
    return base64Url(new Uint8Array(digest))
  } catch (error) {
    if (error instanceof EdgeSecurityError) throw error
    throw authServiceError()
  }
}

async function loadCreateClient(factory) {
  if (factory) return factory
  try {
    // Node tests inject this dependency; production stays pinned for Supabase Edge.
    // deno-lint-ignore no-import-prefix
    const module = await import('npm:@supabase/supabase-js@2')
    return module.createClient
  } catch {
    throw authServiceError()
  }
}

export async function createPublicAuthClient(dependencies = {}) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const url = getEnv('SUPABASE_URL')?.trim()
  let namedPublishableKey = ''
  const configuredCollection = getEnv('SUPABASE_PUBLISHABLE_KEYS')?.trim()
  if (configuredCollection) {
    try {
      const parsed = JSON.parse(configuredCollection)
      const values = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object'
        ? Object.values(parsed)
        : []
      namedPublishableKey = values.find(
        (value) => typeof value === 'string' && value.trim(),
      )?.trim() ?? ''
    } catch {
      throw configurationError()
    }
  }
  const publicKey = getEnv('SUPABASE_PUBLISHABLE_KEY')?.trim() || namedPublishableKey ||
    getEnv('SUPABASE_ANON_KEY')?.trim()
  if (!url || !publicKey) throw configurationError()
  const createClient = await loadCreateClient(dependencies.createClient)

  try {
    return createClient(url, publicKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  } catch {
    throw authServiceError()
  }
}

async function readJsonObject(request) {
  if (request.method !== 'POST') {
    throw new EdgeSecurityError('METHOD_NOT_ALLOWED', '请求方法不被允许', 405)
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new EdgeSecurityError('CONTENT_TYPE_INVALID', '请求格式无效', 415)
  }
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    throw new EdgeSecurityError('REQUEST_TOO_LARGE', '请求内容过大', 413)
  }

  let text
  try {
    text = await request.text()
  } catch {
    throw new EdgeSecurityError('REQUEST_INVALID', '请求内容无效', 400)
  }
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
    throw new EdgeSecurityError('REQUEST_TOO_LARGE', '请求内容过大', 413)
  }

  try {
    const parsed = JSON.parse(text)
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
      throw new TypeError('object required')
    }
    return parsed
  } catch {
    throw new EdgeSecurityError('REQUEST_INVALID', '请求内容无效', 400)
  }
}

async function parseLoginInput(request) {
  const body = await readJsonObject(request)
  const keys = Object.keys(body)
  if (
    keys.length !== 2 ||
    !keys.includes('employeeNumber') ||
    !keys.includes('password') ||
    typeof body.employeeNumber !== 'string' ||
    typeof body.password !== 'string' ||
    body.employeeNumber.length > MAX_EMPLOYEE_NUMBER_LENGTH ||
    body.password.length === 0 ||
    body.password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new EdgeSecurityError('LOGIN_INPUT_INVALID', '员工编号或密码格式无效', 400)
  }

  const employeeNumber = normalizeEmployeeNumber(body.employeeNumber)
  if (!isEmployeeNumber(employeeNumber)) {
    throw new EdgeSecurityError('LOGIN_INPUT_INVALID', '员工编号或密码格式无效', 400)
  }
  return { employeeNumber, password: body.password }
}

function firstRow(data) {
  if (Array.isArray(data)) return data.length === 1 ? data[0] : null
  return data && typeof data === 'object' ? data : null
}

async function defaultBeginLoginAttempt(adminClient, key) {
  const { data, error } = await adminClient.rpc('begin_employee_login_attempt', {
    p_employee_number: key.employeeNumber,
    p_source_fingerprint: key.sourceFingerprint,
  })
  if (error) throw authServiceError()
  const row = firstRow(data)
  if (!row) throw authServiceError()
  const attemptId = row.attempt_id ?? row.attemptId ?? null
  const allowed = row.allowed === true
  if (allowed && attemptId === null) throw authServiceError()
  return {
    allowed,
    attemptId,
    locked: row.locked === true,
    failureCount: Number(row.failure_count ?? row.failureCount ?? 0),
    lockedUntil: row.locked_until ?? row.lockedUntil ?? null,
  }
}

async function defaultFindEmployeeByNumber(adminClient, employeeNumber) {
  const { data, error } = await adminClient
    .from('employee_profiles')
    .select(
      'id,employee_number,auth_user_id,employment_status,account_status,must_change_password,deleted_at',
    )
    .eq('employee_number', employeeNumber)
    .maybeSingle()
  if (error) throw authServiceError()
  return data ?? null
}

async function defaultFinalizeLoginFailure(adminClient, failure) {
  const { data, error } = await adminClient.rpc('finalize_employee_login_failure', {
    p_attempt_id: failure.attemptId,
    p_employee_number: failure.employeeNumber,
    p_source_fingerprint: failure.sourceFingerprint,
    p_failure_code: failure.failureCode,
  })
  if (error) throw authServiceError()
  const row = firstRow(data)
  if (!row) throw authServiceError()
  return {
    locked: row.locked === true,
    failureCount: Number(row.failure_count ?? row.failureCount ?? 0),
    lockedUntil: row.locked_until ?? row.lockedUntil ?? null,
  }
}

export async function completeLoginSuccessRpc(adminClient, attempt) {
  const { data, error } = await adminClient.rpc('complete_employee_login_success', {
    p_attempt_id: attempt.attemptId,
    p_employee_number: attempt.employeeNumber,
    p_source_fingerprint: attempt.sourceFingerprint,
  })
  if (error || data !== true) throw authServiceError()
}

export async function cancelLoginAttemptRpc(adminClient, attempt) {
  const { data, error } = await adminClient.rpc('cancel_employee_login_attempt', {
    p_attempt_id: attempt.attemptId,
    p_employee_number: attempt.employeeNumber,
    p_source_fingerprint: attempt.sourceFingerprint,
  })
  if (error || data !== true) throw authServiceError()
}

function profileFailure(profile) {
  if (!profile || !profile.auth_user_id || profile.deleted_at) return loginFailedError()
  if (profile.employment_status !== '在职' || profile.account_status !== 'active') {
    return accountUnavailableError()
  }
  return null
}

function safeSession(session) {
  if (
    !session ||
    typeof session.access_token !== 'string' ||
    !session.access_token ||
    typeof session.refresh_token !== 'string' ||
    !session.refresh_token ||
    !Number.isFinite(session.expires_at) ||
    !Number.isFinite(session.expires_in)
  ) {
    throw authServiceError()
  }
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    expires_in: session.expires_in,
  }
}

async function finalizeFailure(finalizeLoginFailure, adminClient, attempt, failureCode, error) {
  const result = await finalizeLoginFailure(adminClient, {
    ...attempt,
    failureCode,
  })
  return result?.locked ? loginLockedError() : error
}

export function createEmployeeLoginHandler(dependencies = {}) {
  const createAdminClient = dependencies.createAdminClient ?? createDefaultAdminClient
  const createPublicClient = dependencies.createPublicAuthClient ?? createPublicAuthClient
  const fingerprint = dependencies.deriveSourceFingerprint ?? deriveSourceFingerprint
  const beginLoginAttempt = dependencies.beginLoginAttempt ?? defaultBeginLoginAttempt
  const findEmployeeByNumber = dependencies.findEmployeeByNumber ?? defaultFindEmployeeByNumber
  const deriveAuthEmail = dependencies.deriveAuthEmail ?? deriveDefaultAuthEmail
  const finalizeLoginFailure = dependencies.finalizeLoginFailure ?? defaultFinalizeLoginFailure
  const completeLoginSuccess = dependencies.completeLoginSuccess ?? completeLoginSuccessRpc
  const cancelLoginAttempt = dependencies.cancelLoginAttempt ?? cancelLoginAttemptRpc

  return async function employeeLoginHandler(request) {
    let adminClient
    let attempt
    let attemptSettled = false
    try {
      const { employeeNumber, password } = await parseLoginInput(request)
      const sourceFingerprint = await fingerprint(request)
      const key = { employeeNumber, sourceFingerprint }
      adminClient = await createAdminClient()
      const rateState = await beginLoginAttempt(adminClient, key)
      if (rateState?.allowed !== true) throw loginLockedError()
      attempt = { ...key, attemptId: rateState.attemptId }

      const profile = await findEmployeeByNumber(adminClient, employeeNumber)
      const profileError = profileFailure(profile)
      if (profileError) {
        const failureCode = profileError.code === 'LOGIN_FAILED'
          ? 'INVALID_CREDENTIALS'
          : 'ACCOUNT_UNAVAILABLE'
        const responseError = await finalizeFailure(
          finalizeLoginFailure,
          adminClient,
          attempt,
          failureCode,
          profileError,
        )
        attemptSettled = true
        throw responseError
      }

      const email = await deriveAuthEmail(employeeNumber)
      const publicClient = await createPublicClient()
      let authResult
      try {
        authResult = await publicClient.auth.signInWithPassword({ email, password })
      } catch {
        throw authServiceError()
      }
      if (authResult?.error || !authResult?.data?.session) {
        const responseError = await finalizeFailure(
          finalizeLoginFailure,
          adminClient,
          attempt,
          'INVALID_CREDENTIALS',
          loginFailedError(),
        )
        attemptSettled = true
        throw responseError
      }

      const returnedIds = [
        authResult.data.user?.id,
        authResult.data.session.user?.id,
      ].filter((value) => typeof value === 'string' && value)
      if (
        returnedIds.length === 0 ||
        returnedIds.some((authUserId) => authUserId !== profile.auth_user_id)
      ) {
        throw identityMismatchError()
      }
      const session = safeSession(authResult.data.session)
      await completeLoginSuccess(adminClient, attempt)
      attemptSettled = true
      return jsonResponse(session, 200)
    } catch (error) {
      if (adminClient && attempt && !attemptSettled) {
        try {
          await cancelLoginAttempt(adminClient, attempt)
        } catch {
          // Preserve the original sanitized failure; the pending row expires by retention policy.
        }
      }
      return safeErrorResponse(error)
    }
  }
}

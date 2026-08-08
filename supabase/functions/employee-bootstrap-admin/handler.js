import { createAdminClient as createDefaultAdminClient } from '../_shared/clients.ts'
import { deriveAuthEmail as deriveDefaultAuthEmail } from '../_shared/employee-auth.ts'
import { EdgeSecurityError, jsonResponse, safeErrorResponse } from '../_shared/responses.ts'

const EMPLOYEE_NUMBER = 'SW-000'
const MAX_REQUEST_BYTES = 1024
const MAX_SECRET_LENGTH = 8192
const AUTH_PAGE_SIZE = 100
const MAX_AUTH_PAGES = 100

function runtimeEnvironment(name) {
  return globalThis.Deno?.env?.get?.(name) ?? globalThis.process?.env?.[name]
}

function configurationError() {
  return new EdgeSecurityError('CONFIGURATION_ERROR', '认证服务未配置', 500)
}

function bootstrapConflict() {
  return new EdgeSecurityError('BOOTSTRAP_STATE_CONFLICT', 'SW-000 引导状态冲突', 409)
}

function bootstrapFailed() {
  return new EdgeSecurityError('BOOTSTRAP_FAILED', 'SW-000 引导失败', 503)
}

function collectSecretValues(value) {
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
      throw configurationError()
    }
  }
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean)
}

export function configuredServerSecretKeys(getEnv = runtimeEnvironment) {
  const values = [
    ...collectSecretValues(getEnv('SUPABASE_SECRET_KEYS')),
    ...collectSecretValues(getEnv('SUPABASE_SECRET_KEY')),
    ...collectSecretValues(getEnv('SUPABASE_SERVICE_ROLE_KEY')),
  ]
  const keys = [...new Set(values)]
  if (keys.length === 0 || keys.some((key) => key.length > MAX_SECRET_LENGTH)) {
    throw configurationError()
  }
  return keys
}

function timingSafeEqual(left, right) {
  const encoder = new TextEncoder()
  const leftBytes = encoder.encode(left)
  const rightBytes = encoder.encode(right)
  const length = Math.max(leftBytes.length, rightBytes.length)
  let difference = leftBytes.length ^ rightBytes.length
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0)
  }
  return difference === 0
}

function authEmailsMatch(left, right) {
  return typeof left === 'string' && typeof right === 'string' &&
    left.toLowerCase() === right.toLowerCase()
}

function authorizeRequest(request, getEnv) {
  const providedKey = request.headers.get('apikey')
  const configuredKeys = configuredServerSecretKeys(getEnv)
  if (
    !providedKey ||
    providedKey.length > MAX_SECRET_LENGTH ||
    !configuredKeys.reduce(
      (matched, configuredKey) => timingSafeEqual(providedKey, configuredKey) || matched,
      false,
    )
  ) {
    throw new EdgeSecurityError('BOOTSTRAP_UNAUTHORIZED', '引导请求未授权', 401)
  }
}

async function validateEmptyBody(request) {
  if (request.method !== 'POST') {
    throw new EdgeSecurityError('METHOD_NOT_ALLOWED', '请求方法不被允许', 405)
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json') {
    throw new EdgeSecurityError('CONTENT_TYPE_INVALID', '请求格式无效', 415)
  }
  const text = await request.text()
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
    throw new EdgeSecurityError('REQUEST_TOO_LARGE', '请求内容过大', 413)
  }
  try {
    const body = JSON.parse(text)
    if (
      !body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length !== 0
    ) {
      throw new TypeError('empty object required')
    }
  } catch {
    throw new EdgeSecurityError('BOOTSTRAP_INPUT_INVALID', '引导请求内容无效', 400)
  }
}

export async function findAuthUsersByEmail(adminClient, email) {
  const matches = []
  for (let page = 1; page <= MAX_AUTH_PAGES; page += 1) {
    let result
    try {
      result = await adminClient.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE })
    } catch {
      throw bootstrapFailed()
    }
    if (result?.error || !Array.isArray(result?.data?.users)) throw bootstrapFailed()
    matches.push(...result.data.users.filter((user) => authEmailsMatch(user?.email, email)))
    const hasPaginationMarker = Object.hasOwn(result.data, 'nextPage') ||
      Object.hasOwn(result.data, 'next_page')
    const nextPage = result.data.nextPage ?? result.data.next_page ?? null
    if (hasPaginationMarker && nextPage === null) return matches
    if (!hasPaginationMarker && result.data.users.length < AUTH_PAGE_SIZE) return matches
    if (!hasPaginationMarker && result.data.users.length >= AUTH_PAGE_SIZE) continue
    if (Number(nextPage) !== page + 1) throw bootstrapFailed()
  }
  throw bootstrapFailed()
}

async function defaultGetAuthUserById(adminClient, authUserId) {
  const result = await adminClient.auth.admin.getUserById(authUserId)
  if (result?.error) throw bootstrapFailed()
  return result?.data?.user ?? null
}

async function defaultFindProfileByNumber(adminClient, employeeNumber) {
  const { data, error } = await adminClient
    .from('employee_profiles')
    .select(
      'id,employee_number,auth_user_id,name,department,position,employment_status,account_status,must_change_password,is_hidden_system_account,deleted_at',
    )
    .eq('employee_number', employeeNumber)
    .maybeSingle()
  if (error) throw bootstrapFailed()
  return data ?? null
}

async function defaultCreateAuthUser(adminClient, input) {
  const result = await adminClient.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { employeeNumber: EMPLOYEE_NUMBER },
  })
  if (result?.error || !result?.data?.user?.id) throw bootstrapFailed()
  return result.data.user
}

async function defaultCreateProfile(adminClient, input) {
  const { data, error } = await adminClient
    .from('employee_profiles')
    .insert(input)
    .select(
      'id,employee_number,auth_user_id,name,department,position,employment_status,account_status,must_change_password,is_hidden_system_account,deleted_at',
    )
    .single()
  if (error || !data) throw bootstrapFailed()
  return data
}

async function defaultLinkProfile(adminClient, input) {
  const { data, error } = await adminClient
    .from('employee_profiles')
    .update({ auth_user_id: input.authUserId })
    .eq('id', input.profileId)
    .is('auth_user_id', null)
    .select(
      'id,employee_number,auth_user_id,name,department,position,employment_status,account_status,must_change_password,is_hidden_system_account,deleted_at',
    )
    .single()
  if (error || !data) throw bootstrapFailed()
  return data
}

function profileIsLegal(profile, allowNullLink = true) {
  return Boolean(
    profile &&
      profile.employee_number === EMPLOYEE_NUMBER &&
      (allowNullLink || profile.auth_user_id) &&
      profile.department === '总务部' &&
      profile.position === '社长' &&
      profile.employment_status === '在职' &&
      profile.account_status === 'active' &&
      profile.must_change_password === false &&
      profile.is_hidden_system_account === true &&
      !profile.deleted_at,
  )
}

function profileInput(authUserId) {
  return {
    employee_number: EMPLOYEE_NUMBER,
    auth_user_id: authUserId,
    name: 'システム管理者',
    department: '总务部',
    position: '社长',
    employment_status: '在职',
    account_status: 'active',
    must_change_password: false,
    is_hidden_system_account: true,
    deleted_at: null,
  }
}

async function inspectState(adminClient, email, operations) {
  const [profile, authMatches] = await Promise.all([
    operations.findProfileByNumber(adminClient, EMPLOYEE_NUMBER),
    operations.findAuthUsersByEmail(adminClient, email),
  ])
  if (authMatches.length > 1) throw bootstrapConflict()
  if (profile && !profileIsLegal(profile, true)) throw bootstrapConflict()

  let linkedAuthUser = null
  if (profile?.auth_user_id) {
    linkedAuthUser = await operations.getAuthUserById(adminClient, profile.auth_user_id)
    if (!linkedAuthUser || !authEmailsMatch(linkedAuthUser.email, email)) throw bootstrapConflict()
    if (authMatches.length !== 1 || authMatches[0].id !== linkedAuthUser.id) {
      throw bootstrapConflict()
    }
  }
  return { profile, authUser: authMatches[0] ?? null, linkedAuthUser }
}

function stateIsComplete(state) {
  return Boolean(
    profileIsLegal(state.profile, false) &&
      state.authUser &&
      state.linkedAuthUser &&
      state.profile.auth_user_id === state.authUser.id &&
      state.authUser.id === state.linkedAuthUser.id,
  )
}

export function createEmployeeBootstrapAdminHandler(dependencies = {}) {
  const getEnv = dependencies.getEnv ?? runtimeEnvironment
  const createAdminClient = dependencies.createAdminClient ?? createDefaultAdminClient
  const deriveAuthEmail = dependencies.deriveAuthEmail ?? deriveDefaultAuthEmail
  const operations = {
    findAuthUsersByEmail: dependencies.findAuthUsersByEmail ?? findAuthUsersByEmail,
    getAuthUserById: dependencies.getAuthUserById ?? defaultGetAuthUserById,
    findProfileByNumber: dependencies.findProfileByNumber ?? defaultFindProfileByNumber,
    createAuthUser: dependencies.createAuthUser ?? defaultCreateAuthUser,
    createProfile: dependencies.createProfile ?? defaultCreateProfile,
    linkProfile: dependencies.linkProfile ?? defaultLinkProfile,
  }

  return async function employeeBootstrapAdminHandler(request) {
    try {
      authorizeRequest(request, getEnv)
      await validateEmptyBody(request)
      const password = getEnv('SW000_BOOTSTRAP_PASSWORD')
      if (!password?.trim() || password.length > 256) throw configurationError()

      const email = await deriveAuthEmail(EMPLOYEE_NUMBER)
      const adminClient = await createAdminClient()
      let state = await inspectState(adminClient, email, operations)
      if (stateIsComplete(state)) {
        return jsonResponse({ ok: true, employeeNumber: EMPLOYEE_NUMBER, created: false }, 200)
      }

      let changedByThisCall = false
      let authUser = state.authUser
      if (!authUser) {
        try {
          authUser = await operations.createAuthUser(adminClient, { email, password })
          if (!authUser?.id) throw bootstrapFailed()
          changedByThisCall = true
        } catch {
          state = await inspectState(adminClient, email, operations)
          authUser = state.authUser
          if (!authUser) throw bootstrapFailed()
        }
      }

      if (!state.profile) {
        try {
          await operations.createProfile(adminClient, profileInput(authUser.id))
          changedByThisCall = true
        } catch {
          const recovered = await inspectState(adminClient, email, operations)
          if (!stateIsComplete(recovered)) throw bootstrapFailed()
        }
      } else if (!state.profile.auth_user_id) {
        try {
          await operations.linkProfile(adminClient, {
            profileId: state.profile.id,
            authUserId: authUser.id,
          })
          changedByThisCall = true
        } catch {
          const recovered = await inspectState(adminClient, email, operations)
          if (!stateIsComplete(recovered)) throw bootstrapFailed()
        }
      }

      const finalState = await inspectState(adminClient, email, operations)
      if (!stateIsComplete(finalState)) throw bootstrapConflict()
      return jsonResponse(
        { ok: true, employeeNumber: EMPLOYEE_NUMBER, created: changedByThisCall },
        200,
      )
    } catch (error) {
      if (error instanceof EdgeSecurityError) return safeErrorResponse(error)
      return safeErrorResponse(bootstrapFailed())
    }
  }
}

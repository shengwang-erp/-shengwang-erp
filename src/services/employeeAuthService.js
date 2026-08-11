import { isEmployeeNumber, normalizeEmployeeNumber } from '../auth/employeeAuthDomain.js'
import {
  clearPersistedSupabaseSession,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabaseClient.js'

const SESSION_FIELDS = Object.freeze([
  'access_token',
  'expires_at',
  'expires_in',
  'refresh_token',
])

const SAFE_ERROR_MESSAGES = Object.freeze({
  ACCOUNT_DISABLED: '当前账号不可登录，请联系管理员',
  ACCOUNT_UNAVAILABLE: '当前账号不可登录，请联系管理员',
  AUTH_INVALID: '登录状态无效，请重新登录',
  AUTH_RESPONSE_INVALID: '认证服务响应无效，请稍后重试',
  AUTH_SERVICE_UNAVAILABLE: '认证服务暂不可用，请稍后重试',
  AUTH_SESSION_INVALID: '登录状态无效，请重新登录',
  AUTH_TOKEN_INVALID: '登录状态无效，请重新登录',
  CONFIGURATION_ERROR: '认证服务未配置，请联系系统管理员',
  EMPLOYEE_INACTIVE: '当前账号不可登录，请联系管理员',
  EMPLOYEE_NOT_LINKED: '当前账号不可登录，请联系管理员',
  LOGIN_FAILED: '员工编号或密码错误',
  LOGIN_INPUT_INVALID: '请填写有效的员工编号和密码',
  LOGIN_LOCKED: '登录尝试过多，请稍后再试',
  PASSWORD_INPUT_INVALID: '请输入符合要求的新密码',
  PASSWORD_POLICY_INVALID: '新密码至少12位，且需包含大写字母、小写字母和数字',
  PASSWORD_STATE_SYNC_FAILED: '密码已更新，请重新登录后继续',
  PASSWORD_UPDATE_FAILED: '密码更新失败，请稍后重试',
})

export class EmployeeAuthError extends Error {
  constructor(code, message = SAFE_ERROR_MESSAGES[code]) {
    super(message || '认证服务暂不可用，请稍后重试')
    this.name = 'EmployeeAuthError'
    this.code = code || 'AUTH_SERVICE_UNAVAILABLE'
  }
}

function authError(code) {
  return new EmployeeAuthError(code, SAFE_ERROR_MESSAGES[code])
}

function authReadError(result) {
  const status = result?.status ?? result?.error?.status
  return authError(status === 401 || status === 403
    ? 'AUTH_SESSION_INVALID'
    : 'AUTH_SERVICE_UNAVAILABLE')
}

function assertConfigured(client, configured) {
  if (!configured || !client) throw authError('CONFIGURATION_ERROR')
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function validateSessionResponse(value) {
  if (!isPlainObject(value)) throw authError('AUTH_RESPONSE_INVALID')
  const keys = Object.keys(value).sort()
  if (
    keys.length !== SESSION_FIELDS.length ||
    keys.some((key, index) => key !== SESSION_FIELDS[index]) ||
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    typeof value.refresh_token !== 'string' ||
    !value.refresh_token ||
    !Number.isFinite(value.expires_at) ||
    !Number.isFinite(value.expires_in)
  ) {
    throw authError('AUTH_RESPONSE_INVALID')
  }
  return value
}

async function parseEdgeError(error) {
  let body = null
  try {
    if (error?.context instanceof Response) body = await error.context.clone().json()
  } catch {
    body = null
  }
  const code = body?.error?.code
  return typeof code === 'string' && SAFE_ERROR_MESSAGES[code]
    ? authError(code)
    : authError('AUTH_SERVICE_UNAVAILABLE')
}

function singleProfile(data) {
  if (Array.isArray(data)) return data.length === 1 ? data[0] : null
  return isPlainObject(data) ? data : null
}

function profileValue(profile, camelName, snakeName) {
  return profile?.[camelName] ?? profile?.[snakeName]
}

function mapCurrentEmployee(data) {
  const profile = singleProfile(data)
  if (!profile) throw authError('AUTH_SESSION_INVALID')

  const employeeNumber = normalizeEmployeeNumber(
    profileValue(profile, 'employeeNumber', 'employee_number'),
  )
  const employmentStatus = profileValue(profile, 'employmentStatus', 'employment_status')
  const accountStatus = profileValue(profile, 'accountStatus', 'account_status')
  const mustChangePassword = profileValue(
    profile,
    'mustChangePassword',
    'must_change_password',
  )
  const isHiddenSystemAccount = profileValue(
    profile,
    'isHiddenSystemAccount',
    'is_hidden_system_account',
  )
  const effectivePermissionKeys = profileValue(
    profile,
    'effectivePermissionKeys',
    'effective_permission_keys',
  )

  if (
    !isEmployeeNumber(employeeNumber) ||
    typeof profile.id !== 'string' ||
    !profile.id ||
    typeof profile.name !== 'string' ||
    !profile.name ||
    typeof profile.department !== 'string' ||
    typeof profile.position !== 'string' ||
    typeof mustChangePassword !== 'boolean' ||
    typeof isHiddenSystemAccount !== 'boolean' ||
    !Array.isArray(effectivePermissionKeys) ||
    effectivePermissionKeys.some((key) => typeof key !== 'string')
  ) {
    throw authError('AUTH_SESSION_INVALID')
  }
  if (accountStatus !== 'active' || employmentStatus !== '在职') {
    throw authError('ACCOUNT_UNAVAILABLE')
  }

  return {
    id: profile.id,
    employeeNumber,
    name: profile.name,
    department: profile.department,
    position: profile.position,
    employmentStatus,
    accountStatus,
    mustChangePassword,
    isHiddenSystemAccount,
    effectivePermissionKeys: [...new Set(effectivePermissionKeys)],
  }
}

export function createEmployeeAuthService(
  client,
  {
    configured = Boolean(client),
    clearPersistedSession = async () => {},
  } = {},
) {
  async function clearLocalSession() {
    try {
      await clearPersistedSession()
    } catch {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
  }

  async function loginWithEmployeeNumber({ employeeNumber, password } = {}) {
    assertConfigured(client, configured)
    const normalizedEmployeeNumber = normalizeEmployeeNumber(employeeNumber)
    if (
      !isEmployeeNumber(normalizedEmployeeNumber) ||
      typeof password !== 'string' ||
      !password
    ) {
      throw authError('LOGIN_INPUT_INVALID')
    }

    let invokeResult
    try {
      invokeResult = await client.functions.invoke('employee-login', {
        body: { employeeNumber: normalizedEmployeeNumber, password },
      })
    } catch {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    const { data, error } = invokeResult ?? {}
    if (error) throw await parseEdgeError(error)

    const edgeSession = validateSessionResponse(data)
    let setSessionResult
    try {
      setSessionResult = await client.auth.setSession({
        access_token: edgeSession.access_token,
        refresh_token: edgeSession.refresh_token,
      })
    } catch {
      setSessionResult = null
    }
    const { data: sessionResult, error: sessionError } = setSessionResult ?? {}
    if (sessionError || !sessionResult?.session) {
      try {
        await client.auth.signOut({ scope: 'local' })
      } catch {
        // The gate still remains closed if local session cleanup reports an error.
      }
      await clearLocalSession()
      throw authError('AUTH_SESSION_INVALID')
    }
    return sessionResult.session
  }

  async function getSession() {
    assertConfigured(client, configured)
    let result
    try {
      result = await client.auth.getSession()
    } catch {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    const { data, error } = result ?? {}
    if (error) throw authReadError(result)
    return data?.session ?? null
  }

  function onAuthStateChange(callback) {
    assertConfigured(client, configured)
    let result
    try {
      result = client.auth.onAuthStateChange(callback)
    } catch {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    const subscription = result?.data?.subscription
    if (!subscription || typeof subscription.unsubscribe !== 'function') {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    return subscription
  }

  async function getCurrentEmployee() {
    assertConfigured(client, configured)
    let result
    try {
      result = await client.rpc('current_employee_profile')
    } catch {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    const { data, error } = result ?? {}
    if (error) throw authReadError(result)
    return mapCurrentEmployee(data)
  }

  async function changeTemporaryPassword(password) {
    assertConfigured(client, configured)
    if (typeof password !== 'string' || !password) {
      throw authError('PASSWORD_INPUT_INVALID')
    }
    let result
    try {
      result = await client.functions.invoke('employee-change-password', {
        body: { password },
      })
    } catch {
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    const { data, error } = result ?? {}
    if (error) throw await parseEdgeError(error)
    if (!isPlainObject(data) || Object.keys(data).length !== 1 || data.ok !== true) {
      throw authError('AUTH_RESPONSE_INVALID')
    }
  }

  async function logout() {
    assertConfigured(client, configured)
    let result
    try {
      result = await client.auth.signOut({ scope: 'local' })
    } catch {
      await clearLocalSession()
      throw authError('AUTH_SERVICE_UNAVAILABLE')
    }
    await clearLocalSession()
    if (!result) throw authError('AUTH_SERVICE_UNAVAILABLE')
  }

  return Object.freeze({
    changeTemporaryPassword,
    getCurrentEmployee,
    getSession,
    loginWithEmployeeNumber,
    logout,
    onAuthStateChange,
  })
}

export const employeeAuthService = createEmployeeAuthService(supabase, {
  configured: isSupabaseConfigured,
  clearPersistedSession: clearPersistedSupabaseSession,
})

export const loginWithEmployeeNumber = (...args) =>
  employeeAuthService.loginWithEmployeeNumber(...args)
export const getCurrentEmployee = (...args) => employeeAuthService.getCurrentEmployee(...args)
export const changeTemporaryPassword = (...args) =>
  employeeAuthService.changeTemporaryPassword(...args)
export const logout = (...args) => employeeAuthService.logout(...args)

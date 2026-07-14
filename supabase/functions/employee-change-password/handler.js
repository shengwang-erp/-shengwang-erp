import {
  createAdminClient as createDefaultAdminClient,
  createUserClient as createDefaultUserClient,
} from '../_shared/clients.ts'
import { EdgeSecurityError, jsonResponse, safeErrorResponse } from '../_shared/responses.ts'

const MAX_REQUEST_BYTES = 2048
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128

function authServiceError() {
  return new EdgeSecurityError('AUTH_SERVICE_UNAVAILABLE', '认证服务暂不可用', 503)
}

function parseBearerToken(request) {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s,]+)$/iu)
  if (!match) throw new EdgeSecurityError('AUTH_TOKEN_INVALID', '登录凭证无效', 401)
  return match[1]
}

async function readPasswordInput(request) {
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

  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw new EdgeSecurityError('REQUEST_INVALID', '请求内容无效', 400)
  }
  if (
    !body ||
    Array.isArray(body) ||
    typeof body !== 'object' ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, 'password') ||
    typeof body.password !== 'string'
  ) {
    throw new EdgeSecurityError('PASSWORD_INPUT_INVALID', '新密码格式无效', 400)
  }

  const password = body.password
  if (
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH ||
    !/[A-Z]/u.test(password) ||
    !/[a-z]/u.test(password) ||
    !/[0-9]/u.test(password) ||
    /\s/u.test(password)
  ) {
    throw new EdgeSecurityError(
      'PASSWORD_POLICY_INVALID',
      '新密码至少12位，且需包含大写字母、小写字母和数字',
      400,
    )
  }
  return password
}

function resolveProfile(data) {
  if (Array.isArray(data)) {
    return data.length === 1 && data[0] && typeof data[0] === 'object' ? data[0] : null
  }
  return data && typeof data === 'object' ? data : null
}

function profileValue(profile, camelName, snakeName) {
  return profile[camelName] ?? profile[snakeName]
}

function validateCallerProfile(profile) {
  if (
    !profile ||
    profileValue(profile, 'deletedAt', 'deleted_at') ||
    profileValue(profile, 'isDeleted', 'is_deleted') === true
  ) {
    throw new EdgeSecurityError('EMPLOYEE_NOT_LINKED', '员工账号未关联', 403)
  }
  if (profileValue(profile, 'accountStatus', 'account_status') !== 'active') {
    throw new EdgeSecurityError('ACCOUNT_DISABLED', '账号已停用', 403)
  }
  if (profileValue(profile, 'employmentStatus', 'employment_status') !== '在职') {
    throw new EdgeSecurityError('EMPLOYEE_INACTIVE', '当前员工状态不可访问', 403)
  }
}

export function createEmployeeChangePasswordHandler(dependencies = {}) {
  const createUserClient = dependencies.createUserClient ?? createDefaultUserClient
  const createAdminClient = dependencies.createAdminClient ?? createDefaultAdminClient

  return async function employeeChangePasswordHandler(request) {
    try {
      const password = await readPasswordInput(request)
      const accessToken = parseBearerToken(request)
      const userClient = await createUserClient(accessToken)

      let authResult
      try {
        authResult = await userClient.auth.getUser(accessToken)
      } catch {
        throw new EdgeSecurityError('AUTH_INVALID', '登录状态无效，请重新登录', 401)
      }
      const authUser = authResult?.data?.user
      if (authResult?.error || !authUser?.id) {
        throw new EdgeSecurityError('AUTH_INVALID', '登录状态无效，请重新登录', 401)
      }

      let profileResult
      try {
        profileResult = await userClient.rpc('current_employee_profile')
      } catch {
        throw authServiceError()
      }
      if (profileResult?.error) throw authServiceError()
      validateCallerProfile(resolveProfile(profileResult?.data))

      const adminClient = await createAdminClient()
      let updateResult
      try {
        updateResult = await adminClient.auth.admin.updateUserById(authUser.id, { password })
      } catch {
        throw new EdgeSecurityError('PASSWORD_UPDATE_FAILED', '密码更新失败，请稍后重试', 503)
      }
      if (updateResult?.error || updateResult?.data?.user?.id !== authUser.id) {
        throw new EdgeSecurityError('PASSWORD_UPDATE_FAILED', '密码更新失败，请稍后重试', 503)
      }

      let flagResult
      try {
        flagResult = await adminClient.rpc('complete_employee_password_change', {
          p_auth_user_id: authUser.id,
        })
      } catch {
        throw new EdgeSecurityError(
          'PASSWORD_STATE_SYNC_FAILED',
          '密码已更新，请重新登录后重试状态同步',
          503,
        )
      }
      if (flagResult?.error || flagResult?.data !== true) {
        throw new EdgeSecurityError(
          'PASSWORD_STATE_SYNC_FAILED',
          '密码已更新，请重新登录后重试状态同步',
          503,
        )
      }

      return jsonResponse({ ok: true }, 200)
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
}

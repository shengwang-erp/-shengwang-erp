import { createAdminClient as createDefaultAdminClient } from '../_shared/clients.ts'
import {
  createTemporaryPassword as createDefaultTemporaryPassword,
  requirePersonnelAdministrator as requireDefaultPersonnelAdministrator,
} from '../_shared/employee-auth.ts'
import {
  EdgeSecurityError,
  jsonResponse,
  safeErrorResponse,
} from '../_shared/responses.ts'
import {
  DEPARTMENT_OPTIONS,
  POSITION_OPTIONS,
} from '../../../src/auth/employeeAuthDomain.js'
import {
  assertSensitiveProfilePermissions,
  validateProfileInput,
} from '../employee-provision/handler.js'

const MAX_REQUEST_BYTES = 32 * 1024
export const HANDLER_DEADLINE_MS = 45_000
const RESET_PASSWORD_DOMAIN = 'shengwang-erp:employee-password-reset:v1'
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function inputError() {
  return new EdgeSecurityError(
    'EMPLOYEE_ADMIN_INPUT_INVALID',
    '员工管理请求格式无效',
    400,
  )
}

function serviceError(code, message) {
  return new EdgeSecurityError(code, message, 503)
}

function runtimeEnvironment(name) {
  return globalThis.Deno?.env?.get?.(name) ?? globalThis.process?.env?.[name]
}

function createRequestDeadline() {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => {
    controller.abort(
      new DOMException('Employee admin deadline exceeded', 'TimeoutError'),
    )
  }, HANDLER_DEADLINE_MS)
  return {
    signal: controller.signal,
    close: () => globalThis.clearTimeout(timer),
  }
}

export async function derivePasswordResetCredential(
  resetRequestId,
  employeeId,
  dependencies = {},
) {
  const secret = (dependencies.getEnv ?? runtimeEnvironment)(
    'AUTH_ID_DERIVATION_SECRET',
  )
  const cryptoImpl = dependencies.cryptoImpl ?? globalThis.crypto
  if (!secret?.trim() || !cryptoImpl?.subtle) {
    throw new EdgeSecurityError('CONFIGURATION_ERROR', '认证服务未配置', 500)
  }
  try {
    const encoder = new TextEncoder()
    const key = await cryptoImpl.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const digest = new Uint8Array(
      await cryptoImpl.subtle.sign(
        'HMAC',
        key,
        encoder.encode(
          `${RESET_PASSWORD_DOMAIN}\0${resetRequestId}\0${employeeId}`,
        ),
      ),
    )
    return createDefaultTemporaryPassword({ randomBytes: () => digest })
  } catch (error) {
    if (error instanceof EdgeSecurityError) throw error
    throw serviceError('PASSWORD_RESET_FAILED', '临时密码生成失败')
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

async function readAdminInput(request) {
  if (request.method !== 'POST') {
    throw new EdgeSecurityError('METHOD_NOT_ALLOWED', '请求方法不被允许', 405)
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]
    ?.trim().toLowerCase()
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
    throw inputError()
  }
  if (new TextEncoder().encode(text).length > MAX_REQUEST_BYTES) {
    throw new EdgeSecurityError('REQUEST_TOO_LARGE', '请求内容过大', 413)
  }
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw inputError()
  }
  if (!isPlainObject(body) || typeof body.operation !== 'string') {
    throw inputError()
  }

  if (body.operation === 'update_profile') {
    if (
      Object.keys(body).length !== 3 ||
      !UUID_PATTERN.test(body.employeeId ?? '') ||
      !Object.hasOwn(body, 'patch')
    ) {
      throw inputError()
    }
    let patch
    try {
      patch = validateProfileInput(body.patch, { partial: true })
    } catch {
      throw inputError()
    }
    return {
      operation: body.operation,
      employeeId: body.employeeId.toLowerCase(),
      patch,
    }
  }
  if (body.operation === 'set_account_status') {
    if (
      Object.keys(body).length !== 3 ||
      !UUID_PATTERN.test(body.employeeId ?? '') ||
      !['active', 'disabled'].includes(body.accountStatus)
    ) {
      throw inputError()
    }
    return {
      operation: body.operation,
      employeeId: body.employeeId.toLowerCase(),
      accountStatus: body.accountStatus,
    }
  }
  if (body.operation === 'reset_temporary_password') {
    if (
      Object.keys(body).length !== 2 ||
      !UUID_PATTERN.test(body.employeeId ?? '')
    ) {
      throw inputError()
    }
    return {
      operation: body.operation,
      employeeId: body.employeeId.toLowerCase(),
    }
  }
  throw inputError()
}

function safeEmployee(value) {
  if (!isPlainObject(value)) {
    throw serviceError('EMPLOYEE_ADMIN_FAILED', '员工管理操作失败')
  }
  const read = (camel, snake) => value[camel] ?? value[snake]
  const employee = {
    id: read('id', 'id'),
    employeeNumber: read('employeeNumber', 'employee_number'),
    name: read('name', 'name'),
    department: read('department', 'department'),
    position: read('position', 'position'),
    employmentStatus: read('employmentStatus', 'employment_status'),
    accountStatus: read('accountStatus', 'account_status'),
    mustChangePassword: read('mustChangePassword', 'must_change_password'),
  }
  if (
    !UUID_PATTERN.test(employee.id ?? '') ||
    !/^SW-\d{3,}$/u.test(employee.employeeNumber ?? '') ||
    typeof employee.name !== 'string' ||
    !DEPARTMENT_OPTIONS.includes(employee.department) ||
    !POSITION_OPTIONS.includes(employee.position) ||
    !['在职', '离职', '休假', '停工'].includes(employee.employmentStatus) ||
    !['active', 'disabled'].includes(employee.accountStatus) ||
    typeof employee.mustChangePassword !== 'boolean'
  ) {
    throw serviceError('EMPLOYEE_ADMIN_FAILED', '员工管理操作失败')
  }
  return employee
}

function rpcObject(result, code = 'EMPLOYEE_ADMIN_FAILED') {
  if (result?.error || !isPlainObject(result?.data)) {
    throw serviceError(code, '员工管理操作失败')
  }
  return result.data
}

async function updateEmployeeProfileRpc(client, input) {
  return safeEmployee(
    rpcObject(
      await client.rpc('update_employee_profile_admin', {
        p_employee_id: input.employeeId,
        p_patch: input.patch,
        p_actor_auth_user_id: input.actorAuthUserId,
      }),
    ),
  )
}

async function disableEmployeeAccountRpc(client, input) {
  const data = rpcObject(
    await client.rpc('disable_employee_account_admin', {
      p_employee_id: input.employeeId,
      p_actor_auth_user_id: input.actorAuthUserId,
    }),
    'ACCOUNT_STATUS_UPDATE_FAILED',
  )
  if (!UUID_PATTERN.test(data.authUserId ?? data.auth_user_id ?? '')) {
    throw serviceError('ACCOUNT_STATUS_UPDATE_FAILED', '账号状态更新失败')
  }
  if ((data.sessionsRevoked ?? data.sessions_revoked) !== true) {
    throw serviceError('ACCOUNT_SESSION_REVOKE_FAILED', '账号会话撤销失败')
  }
  return {
    employee: safeEmployee(data.employee),
    authUserId: data.authUserId ?? data.auth_user_id,
    sessionsRevoked: true,
  }
}

async function getEmployeeAdminTargetRpc(client, input) {
  const data = rpcObject(
    await client.rpc('get_employee_admin_target', {
      p_employee_id: input.employeeId,
    }),
    'EMPLOYEE_TARGET_INVALID',
  )
  const authUserId = data.authUserId ?? data.auth_user_id
  if (!UUID_PATTERN.test(authUserId ?? '')) {
    throw new EdgeSecurityError(
      'EMPLOYEE_TARGET_INVALID',
      '员工账号不可操作',
      409,
    )
  }
  return { employee: safeEmployee(data.employee), authUserId }
}

async function setAuthBanDefault(client, authUserId, disabled) {
  const result = await client.auth.admin.updateUserById(authUserId, {
    ban_duration: disabled ? '876000h' : 'none',
  })
  if (result?.error || result?.data?.user?.id !== authUserId) {
    throw serviceError('ACCOUNT_AUTH_SYNC_FAILED', '账号状态同步失败')
  }
  return true
}

async function activateEmployeeAccountRpc(client, input) {
  return safeEmployee(
    rpcObject(
      await client.rpc('activate_employee_account_admin', {
        p_employee_id: input.employeeId,
        p_auth_user_id: input.authUserId,
        p_actor_auth_user_id: input.actorAuthUserId,
      }),
      'ACCOUNT_STATUS_UPDATE_FAILED',
    ),
  )
}

async function updateAuthPasswordDefault(client, authUserId, password) {
  const result = await client.auth.admin.updateUserById(authUserId, {
    password,
  })
  if (result?.error || result?.data?.user?.id !== authUserId) {
    throw serviceError('PASSWORD_RESET_FAILED', '临时密码生成失败')
  }
  return true
}

async function claimPasswordResetRpc(client, input) {
  const data = rpcObject(
    await client.rpc('claim_employee_password_reset', {
      p_employee_id: input.employeeId,
      p_proposed_request_id: input.proposedRequestId,
      p_owner_token: input.ownerToken,
      p_actor_auth_user_id: input.actorAuthUserId,
    }),
    'PASSWORD_RESET_FAILED',
  )
  const requestId = data.requestId ?? data.request_id
  const authUserId = data.authUserId ?? data.auth_user_id
  if (
    !UUID_PATTERN.test(requestId ?? '') ||
    !['pending', 'cooldown'].includes(data.status) ||
    typeof data.ownerAcquired !== 'boolean' ||
    (data.ownerAcquired && !UUID_PATTERN.test(authUserId ?? ''))
  ) {
    throw serviceError('PASSWORD_RESET_FAILED', '临时密码生成失败')
  }
  return {
    ownerAcquired: data.ownerAcquired,
    status: data.status,
    requestId,
    authUserId,
    employee: safeEmployee(data.employee),
  }
}

async function renewPasswordResetOwnerRpc(client, input) {
  const result = await client.rpc('renew_employee_password_reset_owner', {
    p_employee_id: input.employeeId,
    p_request_id: input.requestId,
    p_owner_token: input.ownerToken,
    p_auth_user_id: input.authUserId,
  })
  if (result?.error || result?.data !== true) {
    throw new EdgeSecurityError(
      'PASSWORD_RESET_IN_PROGRESS',
      '临时密码正在生成，请稍后重试',
      409,
    )
  }
  return true
}

async function completePasswordResetRpc(client, input) {
  return safeEmployee(
    rpcObject(
      await client.rpc('complete_employee_password_reset', {
        p_employee_id: input.employeeId,
        p_request_id: input.requestId,
        p_owner_token: input.ownerToken,
        p_auth_user_id: input.authUserId,
        p_actor_auth_user_id: input.actorAuthUserId,
      }),
      'PASSWORD_STATE_SYNC_FAILED',
    ),
  )
}

function assertResetTarget(target) {
  if (
    target.employee.employeeNumber === 'SW-000' ||
    target.employee.accountStatus !== 'active' ||
    target.employee.employmentStatus !== '在职'
  ) {
    throw new EdgeSecurityError(
      'EMPLOYEE_TARGET_INVALID',
      '员工账号不可操作',
      409,
    )
  }
}

export function createEmployeeAdminHandler(dependencies = {}) {
  const requestDeadlineFactory = dependencies.createRequestDeadline ??
    createRequestDeadline
  const operations = {
    randomUUID: dependencies.randomUUID ??
      (() => globalThis.crypto.randomUUID()),
    requirePersonnelAdministrator: dependencies.requirePersonnelAdministrator ??
      requireDefaultPersonnelAdministrator,
    createAdminClient: dependencies.createAdminClient ??
      createDefaultAdminClient,
    updateEmployeeProfile: dependencies.updateEmployeeProfile ??
      updateEmployeeProfileRpc,
    disableEmployeeAccount: dependencies.disableEmployeeAccount ??
      disableEmployeeAccountRpc,
    getEmployeeAdminTarget: dependencies.getEmployeeAdminTarget ??
      getEmployeeAdminTargetRpc,
    setAuthBan: dependencies.setAuthBan ?? setAuthBanDefault,
    activateEmployeeAccount: dependencies.activateEmployeeAccount ??
      activateEmployeeAccountRpc,
    claimPasswordReset: dependencies.claimPasswordReset ??
      claimPasswordResetRpc,
    deriveResetPassword: dependencies.deriveResetPassword ??
      ((input) =>
        derivePasswordResetCredential(input.requestId, input.employeeId)),
    renewPasswordResetOwner: dependencies.renewPasswordResetOwner ??
      renewPasswordResetOwnerRpc,
    updateAuthPassword: dependencies.updateAuthPassword ??
      updateAuthPasswordDefault,
    completePasswordReset: dependencies.completePasswordReset ??
      completePasswordResetRpc,
  }

  return async function employeeAdminHandler(request) {
    const deadline = requestDeadlineFactory()
    try {
      const input = await readAdminInput(request)
      const actor = await operations.requirePersonnelAdministrator(request)
      if (input.operation === 'update_profile') {
        assertSensitiveProfilePermissions(actor, input.patch)
      }
      const adminClient = await operations.createAdminClient({
        requestSignal: deadline.signal,
      })

      if (input.operation === 'update_profile') {
        const employee = safeEmployee(
          await operations.updateEmployeeProfile(adminClient, {
            ...input,
            actorAuthUserId: actor.authUserId,
          }),
        )
        return jsonResponse({ employee }, 200)
      }

      if (
        input.operation === 'set_account_status' &&
        input.accountStatus === 'disabled'
      ) {
        const result = await operations.disableEmployeeAccount(adminClient, {
          employeeId: input.employeeId,
          actorAuthUserId: actor.authUserId,
        })
        const employee = safeEmployee(result.employee)
        if (result.sessionsRevoked !== true) {
          throw serviceError(
            'ACCOUNT_SESSION_REVOKE_FAILED',
            '账号已停用，会话撤销失败',
          )
        }
        try {
          await operations.setAuthBan(adminClient, result.authUserId, true)
        } catch {
          throw serviceError(
            'ACCOUNT_AUTH_SYNC_FAILED',
            '账号已停用，认证状态同步失败',
          )
        }
        return jsonResponse({ employee }, 200)
      }

      if (input.operation === 'set_account_status') {
        const target = await operations.getEmployeeAdminTarget(adminClient, {
          employeeId: input.employeeId,
        })
        if (target.employee.employeeNumber === 'SW-000') {
          throw new EdgeSecurityError(
            'EMPLOYEE_TARGET_INVALID',
            '员工账号不可操作',
            409,
          )
        }
        try {
          await operations.setAuthBan(adminClient, target.authUserId, false)
        } catch {
          throw serviceError('ACCOUNT_AUTH_SYNC_FAILED', '账号认证状态同步失败')
        }
        const employee = safeEmployee(
          await operations.activateEmployeeAccount(adminClient, {
            employeeId: input.employeeId,
            authUserId: target.authUserId,
            actorAuthUserId: actor.authUserId,
          }),
        )
        return jsonResponse({ employee }, 200)
      }

      const proposedRequestId = operations.randomUUID()
      const ownerToken = operations.randomUUID()
      if (
        !UUID_PATTERN.test(proposedRequestId) || !UUID_PATTERN.test(ownerToken)
      ) {
        throw serviceError('PASSWORD_RESET_FAILED', '临时密码生成失败')
      }
      const reset = await operations.claimPasswordReset(adminClient, {
        employeeId: input.employeeId,
        proposedRequestId,
        ownerToken,
        actorAuthUserId: actor.authUserId,
      })
      assertResetTarget(reset)
      if (reset.ownerAcquired !== true) {
        const code = reset.status === 'cooldown'
          ? 'PASSWORD_RESET_RECENTLY_COMPLETED'
          : 'PASSWORD_RESET_IN_PROGRESS'
        throw new EdgeSecurityError(
          code,
          '临时密码正在生成或刚刚完成，请稍后重试',
          409,
        )
      }
      const temporaryPassword = await operations.deriveResetPassword({
        requestId: reset.requestId,
        employeeId: input.employeeId,
      })
      await operations.renewPasswordResetOwner(adminClient, {
        employeeId: input.employeeId,
        requestId: reset.requestId,
        ownerToken,
        authUserId: reset.authUserId,
      })
      if (deadline.signal.aborted) {
        throw serviceError('PASSWORD_RESET_FAILED', '临时密码生成失败')
      }
      await operations.updateAuthPassword(
        adminClient,
        reset.authUserId,
        temporaryPassword,
      )
      const employee = safeEmployee(
        await operations.completePasswordReset(adminClient, {
          employeeId: input.employeeId,
          requestId: reset.requestId,
          ownerToken,
          authUserId: reset.authUserId,
          actorAuthUserId: actor.authUserId,
        }),
      )
      return jsonResponse({ employee, temporaryPassword }, 200)
    } catch (error) {
      return safeErrorResponse(error)
    } finally {
      deadline.close()
    }
  }
}
